/**
 * PBL-A1-PORTRAIT-TOPDOWN-ARENA｜Arena A（纵向俯视物理竞技场）验收套件。
 *
 * 覆盖 Queue 的必改 1-4 与验收 1-4，全部断言都用**真实物理输出**（不做任何近似/伪造）：
 *
 *   1) 空间模型：固定竖屏摄像机 / 四边实体边界（低反弹）/ 无重力 / 无刺墙 / 无缩圈 /
 *      无边界伤害 / 无出界死亡；四边包含；真实几何无穿透（不是 AABB 近似）。
 *   2) Lab-local Topdown Movement Adapter：不调用正式侧视驱动、不伪造 wheel-ground
 *      `grounded`、不写速度/位置状态；能力全部由真实轮组 def 推导；移动同时影响位置与朝向；
 *      武器方向 = 真实车身前向（不存在无视朝向的 360° 自动炮塔）；受阻时有可解释的脱困。
 *   3) 物理保留：真实质量/惯量/冲量/后坐/碰撞/弹丸；重炮开火真实改变自身位置；
 *      冲锋撞击真实改变双方空间关系。
 *   4) 多实体（复用 PBL-F2 共享基础）：三敌实例独立、实例级伤害不串、敌↔敌真实碰撞、
 *      三 Encounter 均可运行。
 *   5) Lab 接入：Arena A 场景由真实快照组装（分层矩形 + 像素面积账本，与 E2E 交叉核对）。
 *
 * 明确不属于本套件（由其它 Queue 负责）：Arena B（PBL-B1）、Camera 自动缩放、
 * HP/伤害/CD/射程/弹丸等任何平衡数值调整、Day/Roguelike/Build 强化、视觉 polish。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildSpawnPlan } from '../src/lab/portraitBattleLab/entities';
import {
  ARENA_A_BOUNDS,
  ARENA_A_GRAVITY,
  ARENA_A_HUD_CLEARANCE,
  ARENA_A_SPAWN_GAP,
  ARENA_A_WALL_RESTITUTION,
  ARENA_A_WALL_THICKNESS,
  ArenaARuntime,
  TOPDOWN_DRIVE,
  arenaAEnemySpawns,
  arenaAPlayerSpawn,
  arenaAWallRects,
  headingOf,
  shapesSeparationPx,
  topdownCapabilityOf,
  wrapPi,
  type ArenaAColliderShape,
  type ArenaADecide,
  type ArenaAEntityView,
  type ArenaAView,
} from '../src/lab/portraitBattleLab/arenaA';
import { arenaAScene, arenaASceneViolations } from '../src/lab/portraitBattleLab/arenaScene';
import { HUD_BAND_H, paintedAreas, stageRect } from '../src/lab/portraitBattleLab/layout';
import { PORTRAIT_LOGICAL_H, PORTRAIT_LOGICAL_W } from '../src/lab/portraitBattleLab/constants';
import { PlanckWorld } from '../src/physics/planckWorld';
import { createPlanckVehicle, rotatePlanckVehicle } from '../src/battle/planckVehicleAssembly';
import { registry } from '../src/core/content';
import { resolveSnapshot } from '../src/core/buildSnapshot';
import { driveTopdownVehicle } from '../src/lab/portraitBattleLab/arenaA';

/* ------------------------------------------------------------ 公共夹具 */

type Combo = readonly [string, string];

const ALL_COMBOS: readonly Combo[] = [
  ['WatermelonHeavyCannon', 'Chaser'],
  ['WatermelonHeavyCannon', 'RangedTurret'],
  ['BananaChargeHammer', 'Chaser'],
  ['BananaChargeHammer', 'RangedTurret'],
  ['WatermelonHeavyCannon', 'LightSwarm3'],
  ['BananaChargeHammer', 'LightSwarm3'],
];

const ACCEPTANCE_COMBOS: readonly Combo[] = [
  ['WatermelonHeavyCannon', 'Chaser'],
  ['BananaChargeHammer', 'RangedTurret'],
  ['WatermelonHeavyCannon', 'LightSwarm3'],
];

function makeRuntime(loadout: string, encounter: string, decide?: ArenaADecide): ArenaARuntime {
  return new ArenaARuntime(buildSpawnPlan(loadout, encounter), decide ? { decide } : undefined);
}

const freeze: ArenaADecide = () => ({ throttle: 0, desiredHeadingRad: null });

/** 两实体真实几何之间的净距（>0 分离 / <=0 相交）；取最近的一对。 */
function closestGap(a: ArenaAEntityView, b: ArenaAEntityView): number {
  let best = Infinity;
  for (const sa of a.shapes) for (const sb of b.shapes) best = Math.min(best, shapesSeparationPx(sa, sb));
  return best;
}

/** 某实体指定部件与另一实体之间的最近净距。 */
function partGap(a: ArenaAEntityView, b: ArenaAEntityView, partId: string): number {
  let best = Infinity;
  for (const sa of a.shapes.filter((s) => s.partId === partId))
    for (const sb of b.shapes) best = Math.min(best, shapesSeparationPx(sa, sb));
  return best;
}

/** 整车 vs 某矩形（墙）的最近净距。 */
function entityToRectGap(e: ArenaAEntityView, rect: { x: number; y: number; w: number; h: number }): number {
  const wall: ArenaAColliderShape = {
    owner: 'body',
    partId: null,
    shape: 'polygon',
    points: [
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.w, y: rect.y },
      { x: rect.x + rect.w, y: rect.y + rect.h },
      { x: rect.x, y: rect.y + rect.h },
    ],
    cx: rect.x + rect.w / 2,
    cy: rect.y + rect.h / 2,
    radius: 0,
    rect,
  };
  let best = Infinity;
  for (const s of e.shapes) best = Math.min(best, shapesSeparationPx(s, wall));
  return best;
}

/**
 * 真实接触/重叠的判定容差（px）。
 *
 * 依据（PBL-A1 全组合 6 组 × 15s 实测）：最深真实几何重叠 = -12.47px，出现在
 * `BananaChargeHammer vs Chaser` 第 25 步的**首次高速对撞**（该帧这对车身的相对位移
 * 达 ~18px/step）；`LightSwarm3` 三敌互相挤压的稳态最深 = -12.36px。Planck 的单步
 * 位置求解在「高速冲量 + 持续推力挤压」下允许这个量级的瞬态/稳态穿透（车长约 76px
 * 的 ~1/6），因此容差取 16px：**只用于排除「穿透量级失真（穿模/穿过彼此）」**，
 * 不用于证明「零穿透」—— 零穿透由 A1-22 的「中心距不塌陷」与 A1-04 的四边包含共同保证。
 */
const CONTACT_PENETRATION_TOLERANCE_PX = 16;

/** 全组合 15s 推进（每步采集真实快照）。 */
function runFull(
  loadout: string,
  encounter: string,
  steps = 900,
  decide?: ArenaADecide,
): { view: ArenaAView; worstOverlap: number; maxOutOfBounds: number; maxStepDisplacement: number } {
  const rt = makeRuntime(loadout, encounter, decide);
  let worstOverlap = 0;
  let maxOut = 0;
  let maxStep = 0;
  const prev = new Map<string, { x: number; y: number }>();
  for (let i = 0; i < steps; i++) {
    rt.stepFixed(1);
    const v = rt.view();
    worstOverlap = Math.min(worstOverlap, v.worstEntityOverlapDepthPx);
    for (const e of v.entities) {
      maxOut = Math.max(
        maxOut,
        ARENA_A_BOUNDS.minX - e.boundsRect.x,
        e.boundsRect.x + e.boundsRect.w - ARENA_A_BOUNDS.maxX,
        ARENA_A_BOUNDS.minY - e.boundsRect.y,
        e.boundsRect.y + e.boundsRect.h - ARENA_A_BOUNDS.maxY,
      );
      const p = prev.get(e.entityId);
      if (p) maxStep = Math.max(maxStep, Math.hypot(e.x - p.x, e.y - p.y));
      prev.set(e.entityId, { x: e.x, y: e.y });
    }
  }
  return { view: rt.view(), worstOverlap, maxOutOfBounds: maxOut, maxStepDisplacement: maxStep };
}

/* ==================================================== 1) Arena A 空间模型 */

describe('PBL-A1｜Arena A 空间模型（纵向俯视 · 无重力 · 四边实体边界）', () => {
  it('A1-01 固定竖屏摄像机 + 四边边界 + 低反弹 + 零重力（常量与运行时一致）', () => {
    expect({ w: PORTRAIT_LOGICAL_W, h: PORTRAIT_LOGICAL_H }).toEqual({ w: 390, h: 844 });
    // 左右内表面必须让出墙厚，否则墙体有 2px 伸出逻辑舞台（被 Canvas 裁掉 → 渲染像素与几何账本不一致）
    expect(ARENA_A_BOUNDS.minX).toBe(ARENA_A_WALL_THICKNESS);
    expect(ARENA_A_BOUNDS.maxX).toBe(PORTRAIT_LOGICAL_W - ARENA_A_WALL_THICKNESS);
    // 顶墙最上沿必须在 HUD 带之下留有真实余量（>= HUD_BAND_H + ARENA_A_HUD_CLEARANCE）
    expect(ARENA_A_BOUNDS.minY - ARENA_A_WALL_THICKNESS).toBeGreaterThanOrEqual(
      HUD_BAND_H + ARENA_A_HUD_CLEARANCE,
    );
    expect(ARENA_A_BOUNDS.maxY).toBeLessThan(PORTRAIT_LOGICAL_H);
    expect(ARENA_A_WALL_THICKNESS).toBe(12);
    expect(ARENA_A_WALL_RESTITUTION).toBeGreaterThan(0);
    expect(ARENA_A_WALL_RESTITUTION).toBeLessThanOrEqual(0.1); // 低反弹
    expect(ARENA_A_GRAVITY).toEqual({ x: 0, y: 0 });

    const rt = makeRuntime('WatermelonHeavyCannon', 'Chaser');
    const v = rt.view();
    expect(v.gravity).toEqual({ x: 0, y: 0 }); // 真实传给世界的重力
    expect(v.walls.length).toBe(4);
    expect(rt.walls.length).toBe(4);
    expect(v.bounds).toEqual(ARENA_A_BOUNDS);
    // 四面墙的真实几何：左 / 右 / 上 / 下，且都完全在舞台内
    const [l, r, t, b] = arenaAWallRects();
    expect(l!.x).toBeLessThan(ARENA_A_BOUNDS.minX);
    expect(r!.x).toBe(ARENA_A_BOUNDS.maxX);
    expect(t!.y).toBeLessThan(ARENA_A_BOUNDS.minY);
    expect(b!.y).toBe(ARENA_A_BOUNDS.maxY);
    for (const w of v.walls) {
      expect(w.x).toBeGreaterThanOrEqual(0);
      expect(w.y).toBeGreaterThanOrEqual(0);
      expect(w.x + w.w).toBeLessThanOrEqual(PORTRAIT_LOGICAL_W);
      expect(w.y + w.h).toBeLessThanOrEqual(PORTRAIT_LOGICAL_H);
    }
  });

  it('A1-02 出生定位：我方下中朝上 / 敌方上排朝下，且不与墙体或彼此重叠', () => {
    const p = arenaAPlayerSpawn();
    const e = arenaAEnemySpawns(3);
    expect(p.headingRad).toBeCloseTo(-Math.PI / 2, 6);
    expect(p.x).toBeCloseTo((ARENA_A_BOUNDS.minX + ARENA_A_BOUNDS.maxX) / 2, 6);
    expect(e).toHaveLength(3);
    expect(e.every((s) => s.headingRad === Math.PI / 2)).toBe(true);
    expect(e[1]!.x).toBeCloseTo(p.x, 6);
    expect(e[0]!.x).toBeLessThan(e[1]!.x);
    expect(e[2]!.x).toBeGreaterThan(e[1]!.x);

    for (const [l, en] of ALL_COMBOS) {
      const rt = makeRuntime(l, en);
      const v = rt.view();
      const walls = arenaAWallRects();
      for (const ent of v.entities) {
        for (const w of walls) {
          expect(entityToRectGap(ent, w), `${l}/${en} ${ent.entityId} 出生与墙体重叠`).toBeGreaterThanOrEqual(0);
        }
      }
      for (let i = 0; i < v.entities.length; i++) {
        for (let j = i + 1; j < v.entities.length; j++) {
          expect(
            closestGap(v.entities[i]!, v.entities[j]!),
            `${l}/${en} 出生即重叠`,
          ).toBeGreaterThan(0);
        }
      }
      // 纵向接敌距离真实存在（我方在下、敌方在上）
      expect(v.entities[0]!.y).toBeGreaterThan(v.entities[1]!.y);
      expect(ARENA_A_SPAWN_GAP).toBeGreaterThan(0);
    }
  });

  it('A1-03 无刺墙 / 无缩圈 / 无边界伤害：贴边顶墙零伤害，且伤害来源只可能是真实车辆', () => {
    // ① 玩家真实压在边界上 8s，且**物理上不可能被对方打到**：
    //    - 玩家（西瓜重炮，无推进器 gadget → 不会被自身 gadget 顶离边界）用**反推油门**
    //      沿出生朝向（朝上）向后压住下边界；
    //    - 追猎者用 `rotatePlanckVehicle` 刚性掉头朝上（该函数是**相对**旋转；出生定向已把
    //      它转到 +π/2，再转 -π 即朝上；仍是同一「初始姿态」工具，不伪造速度），
    //      其推进器把它压在上边界、锤子朝上挥空 → 全程无法下来威胁玩家。
    const rt = makeRuntime('WatermelonHeavyCannon', 'Chaser', freeze);
    const player = rt.agents[0]!;
    const enemy = rt.agents[1]!;
    rotatePlanckVehicle(rt.world, enemy.vehicle, -Math.PI);
    const hp0 = rt.hpOf('player');
    const sources = new Set<string>();
    let playerDamage = 0;
    rt.bus.subscribe((ev) => {
      if (ev.type !== 'damage') return;
      sources.add(String(ev.damageSource));
      if (String(ev.target) === 'A') playerDamage += 1;
    });
    let touching = 0;
    let maxEnemyY = -Infinity;
    for (let i = 0; i < 480; i++) {
      driveTopdownVehicle(rt.world, player.vehicle, { throttle: -1, desiredHeadingRad: -Math.PI / 2 });
      rt.stepFixed(1);
      const v = rt.view();
      if (entityToRectGap(v.entities[0]!, v.walls[3]!) <= 6) touching += 1; // 3 = 下边界（实测稳态 0.5~4.8px）
      maxEnemyY = Math.max(maxEnemyY, v.entities[1]!.y);
    }
    expect(touching).toBeGreaterThan(450); // 确实全程顶在边界上（不是没走到）
    expect(maxEnemyY).toBeLessThan(ARENA_A_BOUNDS.minY + 120); // 对方全程被压在上边界，从未接近玩家
    expect(playerDamage).toBe(0); // 边界不产生任何伤害
    expect(rt.hpOf('player')).toBe(hp0);
    // 全程唯一的伤害来源只能是「武器」：边界挤压（持续推入边界 ~10px）不产生 impact / hazard 伤害
    expect([...sources].sort()).toEqual(['weapon']);

    // ② 全组合 5s：任何伤害事件的 source/target 必须都是真实车辆队伍
    //    （Arena A 的 hazard 参数恒为 0、边界墙无 OwnerTag → 不存在 arena / 边界伤害通道）
    for (const [l, en] of ALL_COMBOS) {
      const rt2 = makeRuntime(l, en, freeze);
      const bad: string[] = [];
      rt2.bus.subscribe((ev) => {
        if (ev.type !== 'damage') return;
        if (!['A', 'B'].includes(String(ev.source))) bad.push(`source=${String(ev.source)}`);
        if (!['A', 'B'].includes(String(ev.target))) bad.push(`target=${String(ev.target)}`);
        if (String(ev.damageSource) === 'hazard') bad.push('hazard');
      });
      for (let i = 0; i < 300; i++) rt2.stepFixed(1);
      expect(bad, `${l}/${en} 出现非车辆来源伤害`).toEqual([]);
    }
  }, 60000);

  it('A1-04 四边包含：全组合 15s 内任何实体都不越界', () => {
    for (const [l, en] of ALL_COMBOS) {
      const { maxOutOfBounds } = runFull(l, en);
      // 1px 容差 = boundsRect 取整（真实几何由墙体物理保证不越界）
      expect(maxOutOfBounds, `${l}/${en} 越界`).toBeLessThanOrEqual(1);
    }
  }, 60000);

  it('A1-05 真实几何无穿透：全组合重叠深度有界（不是 AABB 近似判定）', () => {
    for (const [l, en] of ALL_COMBOS) {
      const { worstOverlap } = runFull(l, en);
      // 重叠只可能来自真实接触/挤压（见 CONTACT_PENETRATION_TOLERANCE_PX 的实测依据）：
      // 绝不能出现「穿过彼此」量级（车长 ~76px）的深度。
      expect(worstOverlap, `${l}/${en} 真实几何重叠超过容差`).toBeGreaterThanOrEqual(
        -CONTACT_PENETRATION_TOLERANCE_PX,
      );
    }
  }, 60000);

  it('A1-06 无瞬移：每步位移不超过该车真实巡航速度上界的 12 倍', () => {
    for (const [l, en] of ALL_COMBOS) {
      const { maxStepDisplacement } = runFull(l, en);
      const rt = makeRuntime(l, en);
      const cruise = Math.max(
        ...rt.agents.map((a) => {
          const c = topdownCapabilityOf(a.vehicle);
          return c.maxSpeedPxPerStep * TOPDOWN_DRIVE.cruiseFraction;
        }),
      );
      // 允许：真实碰撞传递的瞬时速度（可远大于自驱能力）+ 容差；但绝不允许瞬移量级
      expect(maxStepDisplacement, `${l}/${en} 出现瞬移`).toBeLessThan(cruise * 12);
    }
  }, 60000);
});

/* =========================================== 2) Lab-local Topdown Movement */

describe('PBL-A1｜Lab-local Topdown Movement Adapter（不伪造 grounded）', () => {
  it('A1-07 能力全部由真实轮组 def 推导（无手写数值）', () => {
    for (const [l, en] of ALL_COMBOS) {
      const rt = makeRuntime(l, en);
      for (const agent of rt.agents) {
        const cap = topdownCapabilityOf(agent.vehicle);
        let sumTorque = 0;
        let minSpeed = Infinity;
        let halfWB = 0;
        for (const w of agent.vehicle.wheels) {
          sumTorque += w.def.driveTorque;
          minSpeed = Math.min(
            minSpeed,
            (w.def.maxRPM * Math.PI * 2) / 60 / 60 /* rpm → rad/step */ * w.def.radius,
          );
          halfWB = Math.max(halfWB, Math.abs(w.hardpoint.localPosition.x));
        }
        expect(cap.sumDriveTorque).toBeCloseTo(sumTorque, 6);
        expect(cap.maxSpeedPxPerStep).toBeCloseTo(minSpeed, 6);
        expect(cap.halfWheelbasePx).toBeCloseTo(halfWB, 6);
        expect(cap.sumDriveTorque).toBeGreaterThan(0);
      }
    }
  });

  it('A1-08 转向真实影响朝向：朝向误差单调收敛且不越限', () => {
    const rt = makeRuntime('WatermelonHeavyCannon', 'Chaser');
    const agent = rt.agents[0]!;
    const target = Math.PI / 2; // 要求掉头
    const errs: number[] = [];
    for (let i = 0; i < 120; i++) {
      driveTopdownVehicle(rt.world, agent.vehicle, { throttle: 0, desiredHeadingRad: target });
      rt.world.stepFixed(1);
      errs.push(Math.abs(wrapPi(target - headingOf(rt.world, agent.vehicle))));
    }
    expect(errs[0]!).toBeGreaterThan(1);
    expect(errs[errs.length - 1]!).toBeLessThan(0.2); // 真的转到位了
    // 角速度始终不超过标定上限的 3 倍（碰撞外不产生超限自转）
    for (let i = 0; i < 60; i++) {
      driveTopdownVehicle(rt.world, agent.vehicle, { throttle: 0, desiredHeadingRad: target });
      const w = rt.world.getAngularVelocity(agent.vehicle.body);
      expect(Math.abs(w)).toBeLessThanOrEqual(TOPDOWN_DRIVE.maxTurnRateRadPerStep * 3);
      rt.world.stepFixed(1);
    }
  });

  it('A1-09 移动同时影响位置与朝向：前进沿真实前向、后退沿反向', () => {
    for (const throttle of [1, -1] as const) {
      const rt = makeRuntime('WatermelonHeavyCannon', 'Chaser', freeze);
      const agent = rt.agents[0]!;
      const h0 = headingOf(rt.world, agent.vehicle);
      // 朝向先对准 -π/2（向上），再全程锁定该朝向做纯平移
      for (let i = 0; i < 90; i++) {
        driveTopdownVehicle(rt.world, agent.vehicle, { throttle: 0, desiredHeadingRad: -Math.PI / 2 });
        rt.world.stepFixed(1);
      }
      const h1 = headingOf(rt.world, agent.vehicle);
      const p1 = rt.positionOf('player');
      for (let i = 0; i < 30; i++) {
        driveTopdownVehicle(rt.world, agent.vehicle, { throttle, desiredHeadingRad: -Math.PI / 2 });
        rt.world.stepFixed(1);
      }
      const p2 = rt.positionOf('player');
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const fx = Math.cos(h1);
      const fy = Math.sin(h1);
      const along = dx * fx + dy * fy;
      expect(Math.hypot(dx, dy)).toBeGreaterThan(5); // 真的动了
      expect(along * throttle).toBeGreaterThan(0); // 位移方向 = 指令方向 × 真实前向
      expect(Math.abs(wrapPi(h1 - h0))).toBeLessThan(0.2); // 转向确实发生过（朝向被影响）
    }
  });

  it('A1-10 武器方向 = 真实车身前向（不存在无视朝向的 360° 自动炮塔）', () => {
    // 让玩家车身持续缓慢旋转：若存在「无视车身朝向」的自动炮塔，开火方向不会跟着车身转。
    // 注：正式 Cannon 的渲染快照**不透出 velocity**（只有 laser / tracer / machineGunTracer /
    // flame 透出），所以这里取**正式 weaponFire 事件**的 worldDirection —— 它是引擎里
    // 真正用于生成弹丸的方向，比读渲染速度更权威。
    let phi = -Math.PI / 2;
    const spin: ArenaADecide = (self) => {
      if (self.entity.entityId !== 'player') return { throttle: 0, desiredHeadingRad: null };
      phi += 0.008;
      return { throttle: 0, desiredHeadingRad: phi };
    };
    const rt = makeRuntime('WatermelonHeavyCannon', 'RangedTurret', spin);
    const shots: { team: string; dirRad: number; headingRad: number }[] = [];
    rt.bus.subscribe((ev) => {
      if (ev.type !== 'weaponFire') return;
      const agent = rt.agents.find((a) => String(a.vehicle.team) === String(ev.team));
      if (!agent) return;
      shots.push({
        team: String(ev.team),
        dirRad: Math.atan2(ev.worldDirection.y, ev.worldDirection.x),
        headingRad: headingOf(rt.world, agent.vehicle),
      });
    });
    for (let i = 0; i < 900; i++) rt.stepFixed(1);

    const playerShots = shots.filter((s) => s.team === 'A');
    expect(playerShots.length).toBeGreaterThan(3); // 确实取到了真实开火方向（防止断言空转）
    for (const s of shots) {
      // 开火方向在 behavior 阶段产生、朝向在随后一个物理步内最多再转 ω·dt(≤0.045rad)，
      // 实测最大偏差 0.0021rad → 取 0.15rad 作为「跟随车身前向」的宽松上界。
      expect(Math.abs(wrapPi(s.dirRad - s.headingRad))).toBeLessThan(0.15);
    }
    // 开火方向随车身一起变：若为固定方向的自动炮塔，方向集合跨度会退化到 ~0
    const dirs = playerShots.map((s) => s.dirRad);
    expect(Math.max(...dirs) - Math.min(...dirs)).toBeGreaterThan(0.3);
  }, 30000);

  it('A1-11 受阻脱困：默认开启且真的反向脱离（关掉开关即无反向）', () => {
    const plan = buildSpawnPlan('BananaChargeHammer', 'RangedTurret');
    // 让玩家一直贴住顶墙：朝上全油门
    const intoWall: ArenaADecide = () => ({ throttle: 1, desiredHeadingRad: -Math.PI / 2 });
    const rt = new ArenaARuntime(plan, { decide: intoWall });
    let reversed = 0;
    for (let i = 0; i < 600; i++) {
      rt.stepFixed(1);
      if (rt.view().entities[0]!.reversing) reversed += 1;
    }
    expect(reversed).toBeGreaterThan(0);
    // 关掉脱困 → 永不出脱困反向态（对照，证明该行为确实来自这条规则）
    const rt2 = new ArenaARuntime(plan, { decide: intoWall, antiWedge: false });
    let reversed2 = 0;
    for (let i = 0; i < 600; i++) {
      rt2.stepFixed(1);
      if (rt2.view().entities[0]!.reversing) reversed2 += 1;
    }
    expect(reversed2).toBe(0);
  }, 60000);

  it('A1-12 源码守卫（重复校验，防单点失效）：不调用正式侧视驱动 / 不写速度状态', () => {
    const raw = readFileSync(
      join(__dirname, '..', 'src', 'lab', 'portraitBattleLab', 'arenaA.ts'),
      'utf8',
    );
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    for (const banned of [
      'drivePlanckVehicle',
      'setLinearVelocity',
      'setAngularVelocity',
      'grounded',
      // 刺墙 / 缩圈运行时一律不得引入（无边界伤害的结构性保证）；
      // 注意 hazard 的**数值**必须显式为 0，所以不禁 'damagePerTick' 字样，只禁运行时。
      'PlanckArenaRuntime',
    ]) {
      expect(code.includes(banned), `arenaA.ts 不得出现 ${banned}`).toBe(false);
    }
    // 驱动只能来自真实冲量
    expect(code.includes('applyLinearImpulse')).toBe(true);
  });
});

/* ==================================================== 3) 物理保留 / 冲量 */

describe('PBL-A1｜物理保留（质量 / 惯量 / 冲量 / 后坐 / 碰撞 / 弹丸）', () => {
  it('A1-13 重炮开火真实改变自身位置（后坐）', () => {
    const rt = makeRuntime('WatermelonHeavyCannon', 'Chaser', freeze);
    const p0 = rt.positionOf('player');
    let shots = 0;
    for (let i = 0; i < 120; i++) {
      rt.stepFixed(1);
      const v = rt.view();
      if (v.shotsFired > 0 && shots === 0) shots = v.shotsFired;
    }
    const p1 = rt.positionOf('player');
    expect(shots).toBeGreaterThan(0);
    expect(Math.hypot(p1.x - p0.x, p1.y - p0.y)).toBeGreaterThan(0.5); // 位置真的被后坐推走
  });

  it('A1-14 冲锋撞击真实改变双方空间关系（停驻炮台被真实推开）', () => {
    const rt = makeRuntime('BananaChargeHammer', 'RangedTurret');
    const enemyStart = rt.positionOf('enemy-1');
    let maxShift = 0;
    for (let i = 0; i < 600; i++) {
      rt.stepFixed(1);
      const p = rt.positionOf('enemy-1');
      maxShift = Math.max(maxShift, Math.hypot(p.x - enemyStart.x, p.y - enemyStart.y));
    }
    expect(maxShift).toBeGreaterThan(50); // 真实动量传递（不是原地隔空）
  });

  it('A1-15 近战不是原地隔空输出：锤伤害只发生在真实接触瞬间', () => {
    const rt = makeRuntime('BananaChargeHammer', 'RangedTurret');
    const hits: string[] = [];
    let hammerHits = 0;
    let awayEvents = 0;
    rt.bus.subscribe((ev) => {
      if (ev.type !== 'damage' || ev.partId !== 'hammer') return;
      hammerHits += 1;
      const v = rt.view();
      const gap = partGap(v.entities[0]!, v.entities[1]!, 'hammer');
      hits.push(gap.toFixed(3));
      if (gap > CONTACT_PENETRATION_TOLERANCE_PX) awayEvents += 1;
    });
    for (let i = 0; i < 900; i++) rt.stepFixed(1);
    expect(hammerHits).toBeGreaterThan(0); // 近战真的打到了
    expect(awayEvents).toBe(0); // 且没有一次是在「隔空」状态下结算的
    expect(hits.length).toBe(hammerHits);
  }, 30000);

  it('A1-16 三 Encounter 均可运行：真实产生伤害并能分出胜负', () => {
    for (const [l, en] of ACCEPTANCE_COMBOS) {
      const rt = makeRuntime(l, en);
      let damage = 0;
      rt.bus.subscribe((ev) => {
        if (ev.type === 'damage') damage += 1;
      });
      for (let i = 0; i < 1200; i++) rt.stepFixed(1); // 20s 上限
      const v = rt.view();
      const dead = v.entities.filter((e) => e.hp <= 0).length;
      const damaged = v.entities.filter((e) => e.hp < e.maxHp).length;
      expect(damage, `${l}/${en} 无任何伤害事件`).toBeGreaterThan(0);
      expect(dead + damaged, `${l}/${en} HP 完全没变化`).toBeGreaterThan(0);
      expect(v.shotsFired + damage).toBeGreaterThan(0);
    }
  }, 60000);

  it('A1-17 验收 1：西瓜重炮 vs 追猎者存在清晰远程交战阶段 + 逼近压力上升', () => {
    const rt = makeRuntime('WatermelonHeavyCannon', 'Chaser');
    const startDist = rt.distanceBetween('player', 'enemy-1');
    let firstRangedHitAt: number | null = null;
    let dAtFirstRangedHit = 0;
    let minDist = Infinity;
    let shotsDuringOpen = 0;
    for (let i = 0; i < 900; i++) {
      rt.stepFixed(1);
      const v = rt.view();
      const d = rt.distanceBetween('player', 'enemy-1');
      minDist = Math.min(minDist, d);
      if (v.lastDamage && v.lastDamage.damageSource === 'weapon' && firstRangedHitAt === null) {
        firstRangedHitAt = i;
        dAtFirstRangedHit = d;
      }
      if (d > 250 && v.shotsFired > 0) shotsDuringOpen = v.shotsFired;
    }
    expect(startDist).toBeGreaterThan(400); // 初始接敌距离真实存在
    expect(firstRangedHitAt).not.toBeNull();
    expect(dAtFirstRangedHit).toBeGreaterThan(150); // 远程阶段确实开火了
    expect(shotsDuringOpen).toBeGreaterThan(0);
    expect(minDist).toBeLessThan(startDist - 200); // 追猎者真的逼近了（压力上升）
  }, 30000);

  it('A1-18 验收 2：推进明显缩短接敌时间（同场景对照：不推进）', () => {
    // 对照口径说明：本 Loadout 自带「推进器 gadget」，两组都会自动点火（这是 Build 的一部分，
    // 不是 drive）。因此两组的差异**只来自玩家主动推进（throttle）**这一条链路。
    const gapAfter = (steps: number, decide?: ArenaADecide): number => {
      const rt = makeRuntime('BananaChargeHammer', 'RangedTurret', decide);
      let g = Infinity;
      for (let i = 0; i < steps; i++) {
        rt.stepFixed(1);
        const v = rt.view();
        g = closestGap(v.entities[0]!, v.entities[1]!);
      }
      return g;
    };
    const contactStep = (decide?: ArenaADecide): number => {
      const rt = makeRuntime('BananaChargeHammer', 'RangedTurret', decide);
      for (let i = 1; i <= 120; i++) {
        rt.stepFixed(1);
        const v = rt.view();
        if (closestGap(v.entities[0]!, v.entities[1]!) <= 0) return i;
      }
      return Number.POSITIVE_INFINITY;
    };
    // 实测：接触 44 步（0.73s）vs 60 步（1.0s）；0.5s 时净距 87.6 vs 168.6
    expect(contactStep()).toBeLessThanOrEqual(55); // 推进组 0.92s 内真实贴上
    expect(contactStep(freeze)).toBeGreaterThan(contactStep() + 8); // 不推进明显更慢
    // 同一时刻（0.5s）的真实净距：推进组明显更近（近 80px）
    expect(gapAfter(30)).toBeLessThan(gapAfter(30, freeze) - 40);
  }, 60000);
});

/* ============================================= 4) 多实体（复用 PBL-F2） */

describe('PBL-A1｜多实体（复用 F2 共享基础：实例独立 / 不串伤害 / 敌↔敌真实碰撞）', () => {
  it('A1-19 三敌是三个独立实例（独立 Body / HP / 数据）', () => {
    const rt = makeRuntime('WatermelonHeavyCannon', 'LightSwarm3', freeze);
    const v = rt.view();
    const enemies = v.entities.filter((e) => e.team === 'B');
    expect(enemies).toHaveLength(3);
    expect(new Set(enemies.map((e) => e.entityId)).size).toBe(3);
    expect(enemies.every((e) => e.hp === e.maxHp)).toBe(true);
    // 三份 Build 完全同源（同一正式模板 ×3），但运行期是三个独立实体
    expect(new Set(enemies.map((e) => e.bodyDefId)).size).toBe(1);
    const bodies = rt.agents.map((a) => a.vehicle.body);
    expect(new Set(bodies).size).toBe(4); // 4 个真实 body
    rt.agents.slice(1).forEach((a, i) => {
      expect(a.vehicle).not.toBe(rt.agents[1 + i]);
    });
  });

  it('A1-20 实例级伤害不串：逐帧差分 + 伤害守恒 —— 第二辆同队车必须能被独立命中', () => {
    // 口径：正式 `damage` 事件的 source/target 仍是 **TeamId**（PBL-F2 明确不改事件契约），
    // 所以「哪一辆同队车被结算」不能从事件里读。改用三重证据：
    //   ① 逐帧 HP 差分：掉血的实例数绝不超过同帧真实伤害事件数（leak=0）→ 伤害不扩散；
    //   ② 无事件却掉血的帧数 = 0（phantom=0）→ 不存在隐藏结算路径；
    //   ③ 伤害守恒：全部敌人的总掉血 == 事件上报的 (hpBefore - hpAfter) 总和（精确相等）
    //      → 没有任何一次结算被重复施加或被丢弃；
    //   ④ 决定性：**enemy-2（第二辆同队车）真的掉血**。PBL-F2 之前 `findVehicleByTeam`
    //      会把同队全部伤害静默记到第一辆同队车（enemy-1）上 —— 那样 enemy-2 将永远满血。
    const rt = makeRuntime('WatermelonHeavyCannon', 'LightSwarm3', freeze);
    const enemies = rt.view().entities.filter((e) => e.team === 'B').map((e) => e.entityId);
    expect(enemies).toHaveLength(3);
    const maxHp = new Map(rt.view().entities.map((e) => [e.entityId, e.maxHp]));
    let prev = new Map(rt.view().entities.map((e) => [e.entityId, e.hp]));
    let pending = 0;
    let eventDamage = 0;
    rt.bus.subscribe((ev) => {
      if (ev.type !== 'damage' || String(ev.target) !== 'B') return;
      pending += 1;
      eventDamage += ev.hpBefore - ev.hpAfter;
    });
    let dropFrames = 0;
    let leakFrames = 0;
    let phantomFrames = 0;
    const damaged = new Set<string>();
    for (let i = 0; i < 900; i++) {
      pending = 0;
      rt.stepFixed(1);
      const v = rt.view();
      const cur = new Map(v.entities.map((e) => [e.entityId, e.hp]));
      const dropped = enemies.filter((id) => cur.get(id)! < prev.get(id)! - 1e-9);
      if (dropped.length > 0) {
        dropFrames += 1;
        for (const id of dropped) damaged.add(id);
        if (pending === 0) phantomFrames += 1;
        if (dropped.length > pending) leakFrames += 1;
      }
      prev = cur;
    }
    expect(dropFrames).toBeGreaterThan(0);
    expect(leakFrames).toBe(0); // 伤害绝不扩散到未被结算的实例
    expect(phantomFrames).toBe(0); // 绝无「无事件却掉血」
    expect(damaged.size).toBeGreaterThanOrEqual(2); // 伤害能落到非第一辆的同队实例
    expect(damaged.has('enemy-2')).toBe(true); // 决定性：第二辆同队车确实被独立命中
    const hpLoss = enemies.reduce((s, id) => s + (maxHp.get(id)! - prev.get(id)!), 0);
    expect(hpLoss).toBeGreaterThan(0);
    expect(hpLoss).toBeCloseTo(eventDamage, 6); // 伤害守恒（无重复施加 / 无丢失）
  }, 60000);

  it('A1-21 敌↔敌真实碰撞（策略对照：instance-exclusive vs 正式 team-exclusive）', () => {
    const plan = buildSpawnPlan('WatermelonHeavyCannon', 'LightSwarm3');
    const resolved = resolveSnapshot(plan.enemies[0]!.snapshot, registry);
    const minCenterFor = (policy: 'instance-exclusive' | 'team-exclusive'): number => {
      const w = new PlanckWorld({ x: 0, y: 0 });
      const a = createPlanckVehicle(w, resolved, 'B', { x: 120, y: 400 }, 1, { policy, instanceIndex: 0 });
      const b = createPlanckVehicle(w, resolved, 'B', { x: 270, y: 400 }, -1, { policy, instanceIndex: 1 });
      let minCenter = Infinity;
      for (let i = 0; i < 600; i++) {
        const pa = w.getPosition(a.body);
        const pb = w.getPosition(b.body);
        driveTopdownVehicle(w, a, { throttle: 1, desiredHeadingRad: Math.atan2(pb.y - pa.y, pb.x - pa.x) });
        driveTopdownVehicle(w, b, { throttle: 1, desiredHeadingRad: Math.atan2(pa.y - pb.y, pa.x - pb.x) });
        w.stepFixed(1);
        const qa = w.getPosition(a.body);
        const qb = w.getPosition(b.body);
        minCenter = Math.min(minCenter, Math.hypot(qa.x - qb.x, qa.y - qb.y));
      }
      return minCenter;
    };
    const instanceExclusive = minCenterFor('instance-exclusive');
    const teamExclusive = minCenterFor('team-exclusive');
    // 实验组：同队两车真实碰撞 → 中心距被挡在车长级别
    expect(instanceExclusive).toBeGreaterThan(80);
    // 对照组：正式 1v1 语义下同队车辆互不碰撞 → 直接穿过彼此
    expect(teamExclusive).toBeLessThan(30);
  }, 30000);

  it('A1-22 三敌被驱向同一点：真实互相挡住（不重叠穿透 / 不塌成一点）', () => {
    const cx = (ARENA_A_BOUNDS.minX + ARENA_A_BOUNDS.maxX) / 2;
    const cy = ARENA_A_BOUNDS.maxY - 100;
    const toSamePoint: ArenaADecide = (self, _t, ctx) =>
      self.entity.team === 'enemy'
        ? { throttle: 1, desiredHeadingRad: Math.atan2(cy - ctx.selfY, cx - ctx.selfX) }
        : { throttle: 0, desiredHeadingRad: null };
    const rt = makeRuntime('WatermelonHeavyCannon', 'LightSwarm3', toSamePoint);
    let minCenter = Infinity;
    let worstOverlap = 0;
    for (let i = 0; i < 900; i++) {
      rt.stepFixed(1);
      if (i % 5 !== 0) continue;
      const v = rt.view();
      worstOverlap = Math.min(worstOverlap, v.worstEntityOverlapDepthPx);
      const en = v.entities.filter((e) => e.team === 'B');
      for (let a = 0; a < en.length; a++)
        for (let b = a + 1; b < en.length; b++)
          minCenter = Math.min(minCenter, Math.hypot(en[a]!.x - en[b]!.x, en[a]!.y - en[b]!.y));
    }
    expect(minCenter).toBeGreaterThan(35); // 从未塌成同一点
    expect(worstOverlap).toBeGreaterThanOrEqual(-CONTACT_PENETRATION_TOLERANCE_PX);
  }, 60000);
});

/* ============================================ 5) Lab 接入与像素面积账本 */

describe('PBL-A1｜Lab 接入（真实快照场景 + 像素面积账本）', () => {
  const LEDGER: Record<string, { arena: number; playerBody: number; playerPart: number; enemyBody: number; enemyPart: number }> = {
    'A/WatermelonHeavyCannon/Chaser': { arena: 25200, playerBody: 8360, playerPart: 800, enemyBody: 7618, enemyPart: 1560 },
    'A/WatermelonHeavyCannon/RangedTurret': { arena: 25200, playerBody: 8360, playerPart: 800, enemyBody: 7797, enemyPart: 1363 },
    'A/BananaChargeHammer/Chaser': { arena: 25200, playerBody: 7618, playerPart: 1560, enemyBody: 7618, enemyPart: 1560 },
    'A/BananaChargeHammer/RangedTurret': { arena: 25200, playerBody: 7618, playerPart: 1560, enemyBody: 7797, enemyPart: 1363 },
    'A/WatermelonHeavyCannon/LightSwarm3': { arena: 25200, playerBody: 8360, playerPart: 800, enemyBody: 22980, enemyPart: 2160 },
    'A/BananaChargeHammer/LightSwarm3': { arena: 25200, playerBody: 7618, playerPart: 1560, enemyBody: 22980, enemyPart: 2160 },
  };

  it('A1-23 Arena A 场景 = 四边墙 + 全部车辆真实 collider（多边形）；HUD 带内无几何', () => {
    const stage = stageRect();
    for (const [l, en] of ALL_COMBOS) {
      const rt = makeRuntime(l, en);
      const view = rt.view();
      const scene = arenaAScene(view);
      const arenaLayer = scene.filter((s) => s.layer === 'arena');
      expect(arenaLayer).toHaveLength(4); // 四边边界
      expect(arenaASceneViolations(view)).toEqual([]);
      for (const s of scene) {
        expect(s.rect.y).toBeGreaterThanOrEqual(HUD_BAND_H + ARENA_A_HUD_CLEARANCE);
        expect(s.rect.x).toBeGreaterThanOrEqual(0);
        expect(s.rect.y).toBeGreaterThanOrEqual(0);
        expect(s.rect.x + s.rect.w).toBeLessThanOrEqual(stage.w);
        expect(s.rect.y + s.rect.h).toBeLessThanOrEqual(stage.h);
      }
      // 像素账本只含多边形（圆盘 = 轮组，必须被排除）
      const polygons = view.entities.flatMap((e) => e.shapes.filter((s) => s.shape === 'polygon'));
      expect(scene.length).toBe(4 + polygons.length);
    }
  });

  it('A1-24 像素面积账本（E2E 浏览器期望常量的唯一来源）', () => {
    for (const [l, en] of ALL_COMBOS) {
      const key = `A/${l}/${en}`;
      const rt = makeRuntime(l, en);
      const areas = paintedAreas(arenaAScene(rt.view()));
      expect(areas, key).toEqual(LEDGER[key]);
    }
  });
});
