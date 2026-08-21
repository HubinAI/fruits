/**
 * Queue Q14-B｜喷火器 Weapon（Flamethrower）targeted test
 *
 * 覆盖 Q14-B 验收：
 * 1. 第一眼是「持续喷火」不是橙色子弹（flame 视觉标记 + 密集颗粒流）；
 * 2. 火流长度明显短于普通远程武器（短命 projectile 超时消散 → 射程 ≈1.1 西瓜长）；
 * 3. 贴近时多颗真实 projectile 连续命中（多 damage 事件逐颗结算）；
 * 4. 距离不足时火流自然消散，不能隔远继续伤害（远置 0 伤害、hp 不变）；
 * 5. 停火后画面无残留永久火焰（冷却期 alive=0）。
 *
 * 禁止项守约：无 cone raycast / 无隐藏距离扣血 / 无 Particle Foundation /
 * 不改 Shotgun / MachineGun / 火流非慢珠（正常可读速度）/ 无新增测试依赖。
 */
import { describe, it, expect } from 'vitest';
import { getScenario, SCENARIOS } from '../src/lab/scenarios';
import { PhysicsLab } from '../src/lab/physicsLab';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import type { Renderer } from '../src/render/renderer';
import {
  isDamageEvent,
  isWeaponFireEvent,
  type DamageEvent,
  type WeaponFireEvent,
} from '../src/battle/combatEvents';
import type { PlanckVehicle } from '../src/battle/planckVehicleAssembly';
import type { BodyHandle } from '../src/physics/planckWorld';
import { buildSnapshotFromDraft, EMPTY_SLOT } from '../src/lab/buildEditorModel';
import { registry } from '../src/core/content';
import { PART_OPTIONS } from '../src/core/partOptions';
import { validateSnapshot } from '../src/core/buildValidator';

const rendererStub = { bind: () => {} } as unknown as Renderer;

function requirePlanck(lab: PhysicsLab): PlanckBattleOrchestrator {
  const o = lab.orchestrator;
  if (!(o instanceof PlanckBattleOrchestrator)) {
    throw new Error('未选择 PlanckBattleOrchestrator（engine selector 失效）');
  }
  return o;
}

/** 收集指定 behavior 的 weaponFire 事件（0 基物理步序，事件发生时记录） */
function collectFireSteps(
  lab: PhysicsLab,
  behavior: string,
  steps: number,
): Array<{ step: number; ev: WeaponFireEvent }> {
  const o = requirePlanck(lab);
  const out: Array<{ step: number; ev: WeaponFireEvent }> = [];
  let step = 0;
  o.onCombatEvent((e) => {
    if (isWeaponFireEvent(e) && e.behavior === behavior) out.push({ step, ev: e });
  });
  for (let i = 0; i < steps; i++) {
    lab.step(16.6667);
    step++;
  }
  return out;
}

/** 喷火器车 A：watermelon + front 喷火器 */
function flamethrowerSnapshot(side: 'A' | 'B') {
  return buildSnapshotFromDraft(
    {
      bodyDefId: 'watermelonBody',
      rearRadius: 20,
      frontRadius: 20,
      functionalSelections: { front: 'flamethrower', frontMass: EMPTY_SLOT, top: EMPTY_SLOT, rear: EMPTY_SLOT },
    },
    registry,
    side,
  );
}

/** B 无攻击件目标车（boxBody） */
function plainSnapshot(side: 'A' | 'B') {
  return buildSnapshotFromDraft(
    { bodyDefId: 'boxBody', rearRadius: 20, frontRadius: 20, functionalSelections: {} },
    registry,
    side,
  );
}

/** 喷火器真实炮口世界 x（part 原点 + facing×（offset+halfW）） */
function muzzleX(o: PlanckBattleOrchestrator, v: PlanckVehicle): number {
  const part = v.parts.find((p) => p.def.behavior === 'flamethrower')!;
  const c = part.def.collider;
  const halfW = (c.width ?? 0) / 2;
  return o.world.getPosition(part.body).x + v.facing * ((c.offset?.x ?? 0) + halfW);
}

describe('Q14-B 喷火器 Weapon', () => {
  it('1. Content / Build / Energy / Scenario 可直接使用；不改 Shotgun / MachineGun', () => {
    const def = registry.functionals.get('flamethrower');
    expect(def).toBeDefined();
    expect(def!.category).toBe('weapon');
    const bp = def!.behaviorParams as Record<string, number>;
    // 持续喷射 0.8~1.2s；短冷却
    expect(bp.sprayMs).toBeGreaterThanOrEqual(800);
    expect(bp.sprayMs).toBeLessThanOrEqual(1200);
    expect(bp.cooldownMs).toBeLessThanOrEqual(800);
    // 射程 ≈ muzzleSpeed × (flameLifetimeMs / 16.667) ≈ 1~1.5 个西瓜长（170~255px）
    const range = bp.muzzleSpeed * (bp.flameLifetimeMs / 16.667);
    expect(range).toBeGreaterThanOrEqual(170);
    expect(range).toBeLessThanOrEqual(255);

    // 正常 Build：PART_OPTIONS 出现喷火器
    const ids = PART_OPTIONS.map((o) => o.v);
    expect(ids).toContain('flamethrower');

    // Energy：watermelon + 喷火器合法
    const snap = flamethrowerSnapshot('A');
    const v = validateSnapshot(snap, registry);
    expect(v.valid).toBe(true);

    // Q14-B Scenario：engine planck、front 安装、正式 step 无异常
    const sc = getScenario('Q14-B');
    expect(sc).toBeDefined();
    expect(sc!.config.engine).toBe('planck');
    const lab = new PhysicsLab(rendererStub);
    expect(() => lab.loadScenario(sc!)).not.toThrow();
    const o = requirePlanck(lab);
    const part = o.vehicleA.parts.find((p) => p.def.behavior === 'flamethrower');
    expect(part).toBeDefined();
    expect(part!.id).toBe('front');
    expect(part!.def.category).toBe('weapon');
    for (let i = 0; i < 120; i++) lab.step(16.6667);

    // 不改 Shotgun / MachineGun
    const sgBp = registry.functionals.get('shotgun')!.behaviorParams as Record<string, unknown>;
    expect((sgBp.fanAnglesDeg as number[]).length).toBe(5);
    expect(sgBp.muzzleSpeed).toBe(13);
    const mgBp = registry.functionals.get('machineGun')!.behaviorParams as Record<string, number>;
    expect(mgBp.burstRounds).toBe(7);
    expect(mgBp.muzzleSpeed).toBe(12);
  });

  it('2. 持续喷射节奏：密集颗粒流（间隔 ~2 步）+ 短冷却窗口（~0.6s）+ 循环；确定性 -6/0/+6° 循环分叉', () => {
    const lab = new PhysicsLab(rendererStub);
    lab.loadCustom(flamethrowerSnapshot('A'), plainSnapshot('B'), {
      engine: 'planck',
      autoDrive: false, // 隔离：只看喷火器自身节奏（B 远置无碰撞干扰）
      spawnA: { x: 450, y: 650, facing: 1 },
      spawnB: { x: 2000, y: 650, facing: -1 },
    });
    const fires = collectFireSteps(lab, 'flamethrower', 200);
    const steps = fires.map((f) => f.step);

    // 密集：200 步内 ~66 颗（60 步喷射 × 30 + 冷却 36 步循环）
    expect(fires.length).toBeGreaterThanOrEqual(55);
    expect(fires.length).toBeLessThanOrEqual(80);

    // 喷射窗口连续密集（相邻颗粒间隔 ≤4 步）；存在一个明显短冷却 gap（30~50 步）
    const gaps: number[] = [];
    for (let i = 1; i < steps.length; i++) gaps.push(steps[i]! - steps[i - 1]!);
    const maxGap = Math.max(...gaps);
    expect(maxGap).toBeGreaterThanOrEqual(30); // ≥ ~0.5s（短冷却）
    expect(maxGap).toBeLessThanOrEqual(50); // ≤ ~0.83s
    const denseCount = gaps.filter((g) => g <= 4).length;
    expect(denseCount).toBeGreaterThan(gaps.length / 2); // 多数为连续密集颗粒

    // 首次喷射持续 ≈ 0.8~1.2s（首尾间隔 48~72 步）：
    // 找到首个「冷却大间隔」位置（steps[i]-steps[i-1] == maxGap），第 1 簇最后一颗在其前
    let cooldownIdx = -1;
    for (let i = 1; i < steps.length; i++) {
      if (steps[i]! - steps[i - 1]! === maxGap) {
        cooldownIdx = i;
        break;
      }
    }
    expect(cooldownIdx).toBeGreaterThan(0);
    const lastOfFirst = steps[cooldownIdx - 1]!;
    const sprayDur = lastOfFirst - steps[0]!;
    expect(sprayDur).toBeGreaterThanOrEqual(48);
    expect(sprayDur).toBeLessThanOrEqual(72);

    // 确定性分叉：worldDirection.y 以 3 为周期循环 [-6°,0°,+6°]（sin 值），无随机
    const ys = fires.slice(0, 6).map((f) => f.ev.worldDirection.y);
    const expectY = (deg: number) => Math.sin((deg * Math.PI) / 180);
    expect(Math.abs(ys[0]! - expectY(-6))).toBeLessThan(0.02);
    expect(Math.abs(ys[1]!)).toBeLessThan(0.02);
    expect(Math.abs(ys[2]! - expectY(6))).toBeLessThan(0.02);
    for (let i = 3; i < 6; i++) {
      expect(Math.abs(ys[i]! - ys[i - 3]!)).toBeLessThan(0.02); // 周期 3 循环
    }
  });

  it('3. 短射程：粒子超时消散（max x < 炮口+240px）；停火后冷却期 alive=0（无残留火焰）；flame 视觉', () => {
    const lab = new PhysicsLab(rendererStub);
    lab.loadCustom(flamethrowerSnapshot('A'), plainSnapshot('B'), {
      engine: 'planck',
      autoDrive: false,
      spawnA: { x: 450, y: 650, facing: 1 },
      spawnB: { x: 2000, y: 650, facing: -1 }, // B 远：观察火流自然消散
    });
    const o = requirePlanck(lab);
    const mx = muzzleX(o, o.vehicleA);

    // 喷射中（步 50）：存活火焰颗粒都在短射程内（非远程弹）
    for (let i = 0; i < 50; i++) lab.step(16.6667);
    let ps = o.getRenderSnapshot().projectiles ?? [];
    expect(ps.length).toBeGreaterThanOrEqual(3); // 多颗粒同时存在 → 火流
    for (const p of ps) {
      expect(p.visual).toBe('flame'); // 第一眼是火流，不是小圆弹
      expect(p.center.x).toBeLessThan(mx + 240); // 射程 ≤ ~240px（≈1.4 西瓜长上限）
      const v = p.velocity ?? { x: 0, y: 0 };
      expect(v.x).toBeGreaterThan(8); // 正常可读速度（非慢珠）
      expect(Math.abs(v.y)).toBeLessThan(1.5); // 水平直飞（gravityScale 0）
    }

    // 停火（首次喷射于 ~58 步结束 + 寿命 20 步 → 78 步全部超时销毁）：85 步冷却期 alive=0
    for (let i = 50; i < 85; i++) lab.step(16.6667);
    ps = o.getRenderSnapshot().projectiles ?? [];
    expect(ps.length).toBe(0); // 停火后无残留永久火焰

    // 下一轮喷射恢复：110 步（spray2 已开始）→ 又有火焰颗粒
    for (let i = 85; i < 110; i++) lab.step(16.6667);
    ps = o.getRenderSnapshot().projectiles ?? [];
    expect(ps.length).toBeGreaterThan(0);
  });

  it('4. 贴近时多颗真实 projectile 连续命中；远距 0 伤害（火流自然消散）', () => {
    // 命中：B 在火流射程内（x=660）→ 多颗颗粒连续命中
    const labHit = new PhysicsLab(rendererStub);
    labHit.loadCustom(flamethrowerSnapshot('A'), plainSnapshot('B'), {
      engine: 'planck',
      autoDrive: false,
      spawnA: { x: 450, y: 650, facing: 1 },
      spawnB: { x: 660, y: 650, facing: -1 },
    });
    const oHit = requirePlanck(labHit);
    const hits: DamageEvent[] = [];
    oHit.onCombatEvent((e) => {
      if (isDamageEvent(e) && e.damageSource === 'weapon') hits.push(e);
    });
    for (let i = 0; i < 120; i++) labHit.step(16.6667);
    expect(hits.length).toBeGreaterThanOrEqual(8); // 贴近 → 多颗连续命中
    for (const h of hits) {
      expect(h.behavior).toBe('flamethrower');
      expect(h.damage).toBe(8); // 每颗粒小伤逐颗结算
    }
    expect(oHit.vehicleB.hp).toBe(1000 - hits.length * 8);

    // Miss：B 远置（x=2000，火流射程外）→ 0 伤害、hp 不变（不能隔远继续伤害）
    const labMiss = new PhysicsLab(rendererStub);
    labMiss.loadCustom(flamethrowerSnapshot('A'), plainSnapshot('B'), {
      engine: 'planck',
      autoDrive: false,
      spawnA: { x: 450, y: 650, facing: 1 },
      spawnB: { x: 2000, y: 650, facing: -1 },
    });
    const oMiss = requirePlanck(labMiss);
    const missHits: DamageEvent[] = [];
    oMiss.onCombatEvent((e) => {
      if (isDamageEvent(e) && e.damageSource === 'weapon') missHits.push(e);
    });
    for (let i = 0; i < 250; i++) labMiss.step(16.6667);
    expect(missHits.length).toBe(0); // 距离不足 → 火流自然消散，无伪命中
    expect(oMiss.vehicleB.hp).toBe(1000);
  });

  it('5. Q14-B 场景：A（含喷口）与 B 出生无重叠；场景已注册（Scenario 下拉框可直接选）', () => {
    const sc = getScenario('Q14-B')!;
    const lab = new PhysicsLab(rendererStub);
    lab.loadScenario(sc);
    const o = requirePlanck(lab);
    expect(SCENARIOS.some((s) => s.id === 'Q14-B')).toBe(true);
    const part = o.vehicleA.parts.find((p) => p.def.behavior === 'flamethrower')!;
    expect(part.id).toBe('front');
    expect(vehicleRightEdge(o, o.vehicleA)).toBeLessThan(vehicleLeftEdge(o, o.vehicleB));
  });
});

/* ---------- Q14-B-R1：火流连续（填充火焰叶）+ Scenario 隔离验收 ---------- */
describe('Q14-B-R1 火流连续与隔离验收', () => {
  it('1. 火流连续：存活火焰颗粒按 x 排序相邻间距 ≤ 叶长 40px（相邻叶重叠 → 无断节）；末端自然消失', () => {
    const lab = new PhysicsLab(rendererStub);
    lab.loadCustom(flamethrowerSnapshot('A'), plainSnapshot('B'), {
      engine: 'planck',
      autoDrive: false,
      spawnA: { x: 450, y: 650, facing: 1 },
      spawnB: { x: 2000, y: 650, facing: -1 }, // B 远：观察火流连续与消散
    });
    const o = requirePlanck(lab);
    for (let i = 0; i < 50; i++) lab.step(16.6667); // 喷射中段
    const ps = o.getRenderSnapshot().projectiles ?? [];
    expect(ps.length).toBeGreaterThanOrEqual(3);
    for (const p of ps) expect(p.visual).toBe('flame');
    const xs = ps.map((p) => p.center.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) {
      // 相邻火焰叶间距 ≤ 外叶长 40px → 明显重叠 → 正常速度连成连续火流（无断节）
      expect(xs[i]! - xs[i - 1]!).toBeLessThanOrEqual(40);
    }
    // 末端自然消失：冷却期（85 步）无残留火焰
    for (let i = 50; i < 85; i++) lab.step(16.6667);
    expect((o.getRenderSnapshot().projectiles ?? []).length).toBe(0);
  });

  it('2. Q14-B Scenario 隔离：B=banana、autoDrive=false、整 spray 无车体接触、火流命中香蕉', () => {
    const sc = getScenario('Q14-B')!;
    expect(sc.config.autoDrive).toBe(false);
    expect(sc.buildA.bodyDefId).toBe('watermelonBody');
    expect(sc.buildB.bodyDefId).toBe('bananaBody'); // 正常玩家香蕉目标（非 boxBody/tallBody 代替）

    const lab = new PhysicsLab(rendererStub);
    lab.loadScenario(sc);
    const o = requirePlanck(lab);
    const hits: DamageEvent[] = [];
    o.onCombatEvent((e) => {
      if (isDamageEvent(e) && e.damageSource === 'weapon') hits.push(e);
    });
    // 一个完整 spray（60 步）+ 冷却余量到 100 步：每步两车无车体接触（不靠碰撞遮住火流）
    let minGap = Infinity;
    for (let i = 0; i < 100; i++) {
      lab.step(16.6667);
      minGap = Math.min(
        minGap,
        vehicleLeftEdge(o, o.vehicleB) - vehicleRightEdge(o, o.vehicleA),
      );
    }
    expect(minGap).toBeGreaterThan(0); // 从未车体接触
    expect(hits.length).toBeGreaterThanOrEqual(8); // 火流命中香蕉（真实 projectile 连续受击）
    for (const h of hits) {
      expect(h.behavior).toBe('flamethrower');
      expect(h.damage).toBe(8);
    }
    expect(o.vehicleB.hp).toBe(900 - hits.length * 8); // bananaBody 基础 HP=900
  });
});

/** 车辆整体右缘（chassis + parts 真实碰撞几何 maxX）——场景出生无重叠用 */
function vehicleRightEdge(orch: PlanckBattleOrchestrator, v: PlanckVehicle): number {
  let maxX = -Infinity;
  const acc = (b: BodyHandle): void => {
    maxX = Math.max(maxX, orch.world.getBounds(b).maxX);
  };
  acc(v.body);
  for (const p of v.parts) acc(p.body);
  return maxX;
}

/** 车辆整体左缘（chassis + parts 真实碰撞几何 minX） */
function vehicleLeftEdge(orch: PlanckBattleOrchestrator, v: PlanckVehicle): number {
  let minX = Infinity;
  const acc = (b: BodyHandle): void => {
    minX = Math.min(minX, orch.world.getBounds(b).minX);
  };
  acc(v.body);
  for (const p of v.parts) acc(p.body);
  return minX;
}
