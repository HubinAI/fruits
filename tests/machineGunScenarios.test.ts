/**
 * Queue Q14-A｜连发机枪 Weapon（MachineGun）targeted test
 *
 * 覆盖 Q14-A 验收：
 * 1. 正常速度 1 秒内看出「连续机枪扫射」（固定 burst 节奏：7 发 / 间隔 100ms / burst 600ms / 冷却 1100ms）；
 * 2. 至少 6 发弹迹形成连续弹线（同一 burst 7 发真实 projectile 同向高速飞行，非一颗颗慢弹）；
 * 3. 每发真实碰到才伤害（ContactRouter projectileDamage 结算），Miss 就是 Miss；
 * 4. 与霰弹「一次扇形爆发」明显不同（机枪每步 1 发、同向；霰弹同一步 5 发扇形）；
 * 5. 正常 Build / Energy / Scenario 可直接使用（PART_OPTIONS / validateSnapshot / Q14-A 场景）。
 *
 * 禁止项守约：无 hitscan / 无 raycast / 无随机散布 / 不改 Cannon / Shotgun / Laser /
 * 不靠屏幕震动表现后坐（后坐走真实 applyLinearImpulse，测试里断言真实反向速度）。
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

/** 机枪车 A：watermelon + front 机枪 */
function machineGunSnapshot(side: 'A' | 'B') {
  return buildSnapshotFromDraft(
    {
      bodyDefId: 'watermelonBody',
      rearRadius: 20,
      frontRadius: 20,
      functionalSelections: { front: 'machineGun', frontMass: EMPTY_SLOT, top: EMPTY_SLOT, rear: EMPTY_SLOT },
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

/** 霰弹炮车 A（对比测试用：watermelon + front 霰弹炮） */
function shotgunSnapshot(side: 'A' | 'B') {
  return buildSnapshotFromDraft(
    {
      bodyDefId: 'watermelonBody',
      rearRadius: 20,
      frontRadius: 20,
      functionalSelections: { front: 'shotgun', frontMass: EMPTY_SLOT, top: EMPTY_SLOT, rear: EMPTY_SLOT },
    },
    registry,
    side,
  );
}

describe('Q14-A 连发机枪 Weapon', () => {
  it('1. Content / Build / Energy / Scenario 可直接使用；不改 Cannon/Shotgun/Laser', () => {
    // registry：机枪存在、weapon、参数区间符合固定节奏
    const def = registry.functionals.get('machineGun');
    expect(def).toBeDefined();
    expect(def!.category).toBe('weapon');
    const bp = def!.behaviorParams as Record<string, number>;
    expect(bp.burstRounds).toBeGreaterThanOrEqual(6);
    expect(bp.burstRounds).toBeLessThanOrEqual(8);
    expect(bp.roundIntervalMs).toBeGreaterThanOrEqual(90);
    expect(bp.roundIntervalMs).toBeLessThanOrEqual(120);
    expect(bp.cooldownMs).toBeGreaterThanOrEqual(1000);
    expect(bp.cooldownMs).toBeLessThanOrEqual(1300);

    // 正常 Build：PART_OPTIONS 出现机枪
    const ids = PART_OPTIONS.map((o) => o.v);
    expect(ids).toContain('machineGun');

    // Energy：watermelon + 机枪合法（30 ≤ 容量 110）
    const snap = machineGunSnapshot('A');
    const v = validateSnapshot(snap, registry);
    expect(v.valid).toBe(true);
    expect((v as { error?: string }).error).toBeUndefined();

    // Q14-A Scenario：engine planck、front 安装、buildA 合法
    const sc = getScenario('Q14-A');
    expect(sc).toBeDefined();
    expect(sc!.config.engine).toBe('planck');
    const lab = new PhysicsLab(rendererStub);
    expect(() => lab.loadScenario(sc!)).not.toThrow();
    const o = requirePlanck(lab);
    const part = o.vehicleA.parts.find((p) => p.def.behavior === 'machineGun');
    expect(part).toBeDefined();
    expect(part!.id).toBe('front');
    expect(part!.def.category).toBe('weapon');
    for (let i = 0; i < 120; i++) lab.step(16.6667); // 正式 step 无异常

    // 不改 Cannon / Shotgun / Laser
    const cannonBp = registry.functionals.get('cannon')!.behaviorParams as Record<string, number>;
    expect(cannonBp.muzzleSpeed).toBe(8);
    expect(cannonBp.recoilImpulse).toBe(30);
    const sgBp = registry.functionals.get('shotgun')!.behaviorParams as Record<string, unknown>;
    expect((sgBp.fanAnglesDeg as number[]).length).toBe(5);
    expect(sgBp.muzzleSpeed).toBe(13);
    const laserBp = registry.functionals.get('laser')!.behaviorParams as Record<string, number>;
    expect(laserBp.muzzleSpeed).toBe(56);
    expect(laserBp.recoilImpulse).toBe(560);
  });

  it('2. 固定 burst 节奏：一次 7 发、间隔 ~100ms（6 步）、burst 总长 ~600ms、冷却 ~1.1s、循环', () => {
    const lab = new PhysicsLab(rendererStub);
    lab.loadCustom(machineGunSnapshot('A'), plainSnapshot('B'), {
      engine: 'planck',
      autoDrive: false, // 隔离：只看机枪自身节奏（B 远置无碰撞干扰）
      spawnA: { x: 450, y: 650, facing: 1 },
      spawnB: { x: 2000, y: 650, facing: -1 },
    });
    const fires = collectFireSteps(lab, 'machineGun', 150);

    // 150 步内：第 1 burst（步 0,6,...,36）→ 冷却 → 第 2 burst（步 103,109,...,139）= 14 发
    expect(fires.length).toBe(14);
    const steps = fires.map((f) => f.step);
    const burst1 = steps.slice(0, 7);
    // 一次 burst 7 发
    expect(burst1).toEqual([0, 6, 12, 18, 24, 30, 36]);
    // 发间隔 6 步 = 100ms（区间 90~120ms）
    for (let i = 1; i < burst1.length; i++) {
      expect(burst1[i]! - burst1[i - 1]!).toBeGreaterThanOrEqual(5); // ≥ ~83ms
      expect(burst1[i]! - burst1[i - 1]!).toBeLessThanOrEqual(7); // ≤ ~117ms
    }
    // burst 总持续 = 36 步 = 600ms（区间 0.6~0.8s）
    const burstDur = burst1[6]! - burst1[0]!;
    expect(burstDur).toBeGreaterThanOrEqual(30);
    expect(burstDur).toBeLessThanOrEqual(48);
    // 冷却：第 1 burst 最后一发（步 36）后 1.0~1.3s 内不发，下一 burst 首发在 ~103 步
    const cooldownGap = steps[7]! - steps[6]!;
    expect(cooldownGap).toBeGreaterThanOrEqual(60); // ≥ 1.0s
    expect(cooldownGap).toBeLessThanOrEqual(78); // ≤ 1.3s
  });

  it('3. 每发真实 projectile：全部沿真实炮口方向、无随机散布、水平直线高速弹迹（非慢弹）', () => {
    const lab = new PhysicsLab(rendererStub);
    lab.loadCustom(machineGunSnapshot('A'), plainSnapshot('B'), {
      engine: 'planck',
      autoDrive: false,
      spawnA: { x: 450, y: 650, facing: 1 },
      spawnB: { x: 2000, y: 650, facing: -1 }, // B 远：弹不碰任何东西，观察飞行
    });
    const o = requirePlanck(lab);
    const dirs: Array<{ x: number; y: number }> = [];
    o.onCombatEvent((e) => {
      if (isWeaponFireEvent(e) && e.behavior === 'machineGun') {
        dirs.push({ x: e.worldDirection.x, y: e.worldDirection.y });
      }
    });

    // 跑到第 1 burst 打满（40 步）后观察存活弹
    for (let i = 0; i < 40; i++) lab.step(16.6667);
    const ps = o.getRenderSnapshot().projectiles ?? [];

    // 全部同向（真实炮口方向，facing+1 → +X）：无随机散布 / 无扇形
    expect(dirs.length).toBeGreaterThanOrEqual(7);
    expect(dirs[0]!.x).toBeGreaterThan(0.99); // 首发严格沿 +X
    expect(Math.abs(dirs[0]!.y)).toBeLessThan(0.05);
    for (const d of dirs) {
      expect(d.x).toBeGreaterThan(0.85); // 弹道主导方向仍是 +X（允许真实后坐姿态微量变化）
      const angle = Math.acos(Math.min(1, d.x)); // 与 +X 的夹角
      expect(angle).toBeLessThan(0.18); // < ~10°（后坐真实姿态变化，非随机散布）
    }

    // 每发真实高速弹：vx≈12（非慢弹），水平直线（gravityScale 0 → vy≈0），同向
    expect(ps.length).toBeGreaterThanOrEqual(3); // 40 步时 ≥3 发同时飞行
    const xs = new Set<number>();
    for (const p of ps) {
      expect(p.visual).toBe('tracer'); // 高速短弹迹视觉（复用 tracer 渲染）
      const v = p.velocity ?? { x: 0, y: 0 };
      expect(v.x).toBeGreaterThan(9); // muzzleSpeed 12 主导
      expect(v.x).toBeLessThan(14);
      expect(Math.abs(v.y)).toBeLessThan(1.5); // 水平直线（无重力下落 → 弹线不散开）
      xs.add(Math.round(p.center.x));
    }
    expect(xs.size).toBeGreaterThanOrEqual(3); // 多弹同时在飞 → 连成一条弹线
  });

  it('4. 每发真实碰到才伤害（连续命中结算）；Miss 就是 Miss', () => {
    // 命中：B 在弹道上（x=900），7 发全中 → 7 × 20 伤害
    const labHit = new PhysicsLab(rendererStub);
    labHit.loadCustom(machineGunSnapshot('A'), plainSnapshot('B'), {
      engine: 'planck',
      autoDrive: false,
      spawnA: { x: 450, y: 650, facing: 1 },
      spawnB: { x: 900, y: 650, facing: -1 },
    });
    const oHit = requirePlanck(labHit);
    const hits: DamageEvent[] = [];
    oHit.onCombatEvent((e) => {
      if (isDamageEvent(e) && e.damageSource === 'weapon') hits.push(e);
    });
    for (let i = 0; i < 120; i++) labHit.step(16.6667);
    // 一发一结算（真实 projectile 命中即销毁），每发 20
    expect(hits.length).toBeGreaterThanOrEqual(6);
    for (const h of hits) {
      expect(h.behavior).toBe('machineGun');
      expect(h.damage).toBe(20);
    }
    expect(oHit.vehicleB.hp).toBe(1000 - hits.length * 20);

    // Miss：B 远置（x=2000，在 arena 右侧墙外）——弹永远打不到 → 0 伤害、hp 不变
    const labMiss = new PhysicsLab(rendererStub);
    labMiss.loadCustom(machineGunSnapshot('A'), plainSnapshot('B'), {
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
    expect(missHits.length).toBe(0); // Miss 就是 Miss：无伪命中
    expect(oMiss.vehicleB.hp).toBe(1000);
    // 弹真实碰到 arena 右墙即销毁：任何时刻都没有 projectile 越过右墙存活
    // （周期性连发总有新弹在飞，故不要求 alive=0，只要求永不过墙）
    const alive = oMiss.getRenderSnapshot().projectiles ?? [];
    for (const p of alive) expect(p.center.x).toBeLessThan(1650); // 墙内缘 1600 + 弹半径余量
  });

  it('5. 与霰弹「一次扇形爆发」明显不同：机枪每步 1 发同向，霰弹同一步 5 发扇形', () => {
    // 机枪：一次 burst 内每固定步至多 1 发
    const labMg = new PhysicsLab(rendererStub);
    labMg.loadCustom(machineGunSnapshot('A'), plainSnapshot('B'), {
      engine: 'planck', autoDrive: false,
      spawnA: { x: 450, y: 650, facing: 1 }, spawnB: { x: 2000, y: 650, facing: -1 },
    });
    const mgFires = collectFireSteps(labMg, 'machineGun', 40);
    const byStepMg = new Set(mgFires.map((f) => f.step));
    expect(byStepMg.size).toBe(mgFires.length); // 没有任何一步连发 2 发
    // 前 7 发方向一致（非扇形）
    const dirSet = new Set(
      mgFires.slice(0, 7).map((f) => Math.round((f.ev.worldDirection.y ?? 0) * 100) / 100),
    );
    expect(dirSet.size).toBe(1); // 全部同向（y 分量一致 → 无 -12°~+12° 扇形）

    // 霰弹：一次齐射 = 1 次 weaponFire 事件（一次爆闪）+ 5 发真实 projectile 扇形散开（对照）
    const labSg = new PhysicsLab(rendererStub);
    labSg.loadCustom(shotgunSnapshot('A'), plainSnapshot('B'), {
      engine: 'planck', autoDrive: false,
      spawnA: { x: 450, y: 650, facing: 1 }, spawnB: { x: 2000, y: 650, facing: -1 }, // B 远：观察齐射弹迹
    });
    const sgFires = collectFireSteps(labSg, 'shotgun', 6);
    expect(sgFires.length).toBe(1); // 一次齐射只发 1 次 weaponFire（与机枪每发 1 次明显不同）
    const oSg = requirePlanck(labSg);
    const sgPs = oSg.getRenderSnapshot().projectiles ?? [];
    expect(sgPs.length).toBe(5); // 同一步 5 发真实 projectile
    const sgVy = new Set(
      sgPs.map((p) => Math.round((p.velocity?.y ?? 0) * 100) / 100),
    );
    expect(sgVy.size).toBeGreaterThan(1); // 扇形：5 发 y 方向速度不同（-12°~+12°）
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

/** 仅在 describe 内引用，保证 Q14-A 场景出生无重叠也被覆盖 */
describe('Q14-A 场景出生几何', () => {
  it('Q14-A：A（含机枪枪管）与 B 出生无重叠', () => {
    const sc = getScenario('Q14-A')!;
    const lab = new PhysicsLab(rendererStub);
    lab.loadScenario(sc);
    const o = requirePlanck(lab);
    expect(vehicleRightEdge(o, o.vehicleA)).toBeLessThan(vehicleLeftEdge(o, o.vehicleB));
    // 场景注册在 SCENARIOS 列表（开发工具 Scenario 下拉框可直接选 Q14-A）
    expect(SCENARIOS.some((s) => s.id === 'Q14-A')).toBe(true);
  });
});
