/**
 * PBL-F2-MULTI-ENTITY-COMBAT-FOUNDATION｜共享 Battle Foundation 多实体能力（1 player + N enemies）
 *
 * 本文件只验证「共享底层能力」，不含 Arena A/B、不含 Lab-only fake router、
 * 不含代理碰撞体 / 隐形 Body / 位置排斥力——所有断言都来自真实 PlanckWorld 碰撞事件
 * 与正式 ContactRouter / DamageResolver。
 *
 * 验收：
 * 1. 实例级结算：Impact / Weapon / Projectile / Grounded 按唯一 `OwnerTag.vehicleId`
 *    路由到真实车辆实例，而不是「该 team 的第一辆车」；
 * 2. 同队车辆碰撞策略：正式默认（team-exclusive）行为字面不变；
 *    instance-exclusive 下同队不同车辆发生真实物理碰撞；
 * 3. destroy 一个敌人不影响另外两个；
 * 4. 三敌由同一套正式内容复制，只有实例身份不同（HP / Body / Damage / Projectile 独立）。
 */
import { describe, it, expect } from 'vitest';
import { createRegistry } from '../src/core/content';
import type { BuildSnapshot } from '../src/core/types';
import { resolveSnapshot } from '../src/core/buildSnapshot';
import { ContactRouter } from '../src/battle/contactRouter';
import { DamageResolver } from '../src/battle/damageResolver';
import { CombatEventBus, isDamageEvent, type BattleEvent } from '../src/battle/combatEvents';
import {
  createPlanckVehicle,
  resolveVehicleCollisionFilter,
  type PlanckVehicle,
} from '../src/battle/planckVehicleAssembly';
import { spawnWeaponProjectile } from '../src/battle/weaponProjectile';
import { PlanckWorld, type BodyHandle } from '../src/physics/planckWorld';

const registry = createRegistry();

/** projectileDamage=80（正式 cannon），baseDamage=0（正式 cannon 无 ram 伤害） */
const CANNON_PROJECTILE_DAMAGE = 80;

/**
 * 同一套正式内容：boxBody + wheelStd×2 + cannon。
 * 三敌必须是「同一模板复制、只有实例身份不同」——故只换 id，数值零改动。
 */
function baseBuild(): BuildSnapshot {
  return {
    id: 'pbl-f2-build',
    bodyDefId: 'boxBody',
    quality: 1,
    movements: [
      { hardpointId: 'rear', defId: 'wheelStd' },
      { hardpointId: 'front', defId: 'wheelStd' },
    ],
    functionals: [{ hardpointId: 'front', defId: 'cannon' }],
  };
}

/** 同一模板 + 唯一实例 id（= OwnerTag.vehicleId = CombatVehicleState.id） */
function buildWithId(id: string): BuildSnapshot {
  const b = baseBuild();
  return {
    ...b,
    id,
    movements: b.movements.map((m) => ({ ...m })),
    functionals: b.functionals.map((f) => ({ ...f })),
  };
}

const ENEMY_IDS = ['enemy-B1', 'enemy-B2', 'enemy-B3'] as const;
const PLAYER_ID = 'player-A';

interface Ensemble {
  /** 状态世界本体：destroy 必须在车辆所属 world 内进行 */
  world: PlanckWorld;
  player: PlanckVehicle;
  b1: PlanckVehicle;
  b2: PlanckVehicle;
  b3: PlanckVehicle;
  /** 数组顺序固定为 [player, B1, B2, B3]：旧 team 反查必然命中 B1 */
  vehicles: PlanckVehicle[];
}

/**
 * 状态世界：装配真实 1 player + 3 enemies。
 * 与碰撞世界分离（沿用 B9C 惯例）——本 world 不推进物理，只作为 Router 的
 * 真实战斗状态容器；车辆之间位置互不重叠，避免装配期求解器干扰。
 */
function makeEnsemble(): Ensemble {
  const world = new PlanckWorld();
  const player = createPlanckVehicle(
    world,
    resolveSnapshot(buildWithId(PLAYER_ID), registry),
    'A',
    { x: 0, y: 0 },
    1,
  );
  const enemies = ENEMY_IDS.map((id, i) =>
    createPlanckVehicle(
      world,
      resolveSnapshot(buildWithId(id), registry),
      'B',
      { x: 4000 + i * 1500, y: 0 },
      1,
    ),
  );
  const [b1, b2, b3] = enemies as [PlanckVehicle, PlanckVehicle, PlanckVehicle];
  return { world, player, b1, b2, b3, vehicles: [player, b1, b2, b3] };
}

function makeHarness(vehicles: PlanckVehicle[]): {
  router: ContactRouter;
  events: BattleEvent[];
} {
  const events: BattleEvent[] = [];
  const bus = new CombatEventBus();
  bus.subscribe((e) => events.push(e));
  return { router: new ContactRouter(vehicles, new DamageResolver(bus)), events };
}

/**
 * 碰撞世界：真实 ground + 单个敌车 chassis（OwnerTag.vehicleId 指向目标实例）。
 * 零重力 → 所有测试体静止，只有被显式赋速的测试体运动，几何完全可控。
 */
function makeStrikeWorld(targetInstanceId: string): {
  world: PlanckWorld;
  chassis: BodyHandle;
} {
  const world = new PlanckWorld({ x: 0, y: 0 });
  const chassis = world.createDynamicBox(0, 640, 150, 55, 50, {
    friction: 0.5,
    restitution: 0.05,
  });
  world.setOwnerTag(chassis, {
    kind: 'vehicle',
    vehicleId: targetInstanceId,
    partId: 'body',
    team: 'B',
  });
  return { world, chassis };
}

/** 逐步推进直到出现首次伤害（或达到步数上限）；返回消耗步数 */
function stepUntilDamage(
  world: PlanckWorld,
  router: ContactRouter,
  maxSteps = 600,
): number {
  for (let i = 1; i <= maxSteps; i++) {
    const before = router.debug.lastDamage;
    world.stepFixed(1);
    if (router.debug.lastDamage !== before) return i;
  }
  return -1;
}

function destroyVehicle(world: PlanckWorld, v: PlanckVehicle): void {
  for (const w of v.wheels) world.destroyBody(w.body);
  for (const p of v.parts) world.destroyBody(p.body);
  world.destroyBody(v.body);
}

describe('PBL-F2 · 多实体实例身份（1 player + 3 enemies）', () => {
  it('三敌由同一模板复制且拥有唯一 vehicleId（实例身份唯一）', () => {
    const ens = makeEnsemble();

    const ids = ens.vehicles.map((v) => v.id);
    expect(ids).toEqual([PLAYER_ID, ...ENEMY_IDS]);
    expect(new Set(ids).size).toBe(4);

    // 实例身份唯一 + 数值完全一致（同一模板复制，不复制成独立平衡参数）
    const baseKeys = ens.vehicles.map((v) => JSON.stringify({
      hp: v.maxHp,
      totalMass: v.totalMass,
      parts: v.parts.map((p) => [p.id, p.def.id, p.def.behaviorParams]),
      wheels: v.wheels.map((w) => [w.id, w.def.id, w.def.radius, w.def.mass]),
    }));
    expect(new Set(baseKeys).size).toBe(1);
  });
});

describe('PBL-F2 · Projectile 实例级结算（不串敌）', () => {
  it('弹丸命中 B2 只扣 B2；B1 / B3 保持满血', () => {
    const ens = makeEnsemble();
    const { router, events } = makeHarness(ens.vehicles);

    const { world } = makeStrikeWorld(ens.b2.id);

    // 真实玩家车装配在碰撞世界：用正式 spawnWeaponProjectile 发真实弹（真实 CCD /
    // 正式 projectile Owner 过滤：group -1，不与任何车辆实例 group 冲突）
    const shooter = createPlanckVehicle(
      world,
      resolveSnapshot(buildWithId(PLAYER_ID), registry),
      'A',
      { x: -520, y: 640 },
      1,
    );
    const cannon = shooter.parts.find((p) => p.id === 'front')!;
    world.setBatchedContactListener((e) => router.handlePlanckContact(world, e));

    spawnWeaponProjectile(world, shooter, cannon, {
      dir: { x: 1, y: 0 },
      muzzleSpeed: 8,
      projectileRadius: cannon.def.behaviorParams!.projectileRadius as number,
      projectileMass: cannon.def.behaviorParams!.projectileMass as number,
      gravityScale: 0,
    });

    const steps = stepUntilDamage(world, router);
    expect(steps).toBeGreaterThan(0);

    const damageEvents = events.filter(isDamageEvent);
    console.log(
      `[PBL-F2-PROJ] steps=${steps} damageEvents=${damageEvents.length} ` +
        `target=${router.debug.lastDamage?.target} hp B1=${ens.b1.hp} B2=${ens.b2.hp} B3=${ens.b3.hp}`,
    );

    // 唯一被扣血的是 B2（实例级路由）
    expect(ens.b2.hp).toBe(1000 - CANNON_PROJECTILE_DAMAGE);
    expect(ens.b1.hp).toBe(1000);
    expect(ens.b3.hp).toBe(1000);
    expect(router.debug.lastDamage?.target).toBe(ens.b2.id);
    expect(damageEvents).toHaveLength(1);
  });
});

describe('PBL-F2 · Impact 实例级结算（不串敌）', () => {
  it('撞击命中 B3 只作用 B3；B1 / B2 保持满血', () => {
    const ens = makeEnsemble();
    const { router } = makeHarness(ens.vehicles);

    const { world } = makeStrikeWorld(ens.b3.id);

    // 真实 Planck 碰撞体：team A 的 part:front（instance id = player-A）
    const ram = world.createDynamicBox(-75, 640, 20, 112, 5);
    world.setOwnerTag(ram, {
      kind: 'vehicle',
      vehicleId: ens.player.id,
      partId: 'part:front',
      team: 'A',
    });
    world.setBatchedContactListener((e) => router.handlePlanckContact(world, e));
    world.setLinearVelocity(ram, 2, 0);

    let impactSeen = false;
    for (let i = 0; i < 600 && !impactSeen; i++) {
      world.stepFixed(1);
      impactSeen = router.debug.lastImpact !== null;
    }

    console.log(
      `[PBL-F2-IMPACT] impactSeen=${impactSeen} impact=${JSON.stringify(router.debug.lastImpact)} ` +
        `hp B1=${ens.b1.hp} B2=${ens.b2.hp} B3=${ens.b3.hp}`,
    );

    expect(impactSeen).toBe(true);
    // Impact 只作用命中实例；其余两敌零变化
    expect(ens.b3.hp).toBeLessThan(1000);
    expect(ens.b1.hp).toBe(1000);
    expect(ens.b2.hp).toBe(1000);
  });
});

describe('PBL-F2 · 同队车辆碰撞策略', () => {
  it('正式默认碰撞过滤数值字面不变（1v1 零回归的机械证据）', () => {
    const GROUND = 0x0001;
    const ARENA = 0x0002;
    const VEHICLE_A = 0x0004;
    const VEHICLE_B = 0x0008;
    const PROJECTILE = 0x0010;
    const HAZARD = 0x0020;

    // 决策 A：mask 不含己方车辆类别、group 固定 -1
    expect(resolveVehicleCollisionFilter('A')).toEqual({
      categoryBits: VEHICLE_A,
      maskBits: GROUND | ARENA | PROJECTILE | HAZARD | VEHICLE_B,
      groupIndex: -1,
    });
    // 决策 B：mask 不含己方车辆类别、group 固定 -2
    expect(resolveVehicleCollisionFilter('B')).toEqual({
      categoryBits: VEHICLE_B,
      maskBits: GROUND | ARENA | PROJECTILE | HAZARD | VEHICLE_A,
      groupIndex: -2,
    });
    // 显式传 team-exclusive 与缺省完全一致
    expect(resolveVehicleCollisionFilter('B', { policy: 'team-exclusive' })).toEqual(
      resolveVehicleCollisionFilter('B'),
    );
    // 显式传未知 policy 也回落正式规则（防御未来误用）
    expect(
      resolveVehicleCollisionFilter('B', { policy: 'nope' as 'team-exclusive' }),
    ).toEqual(resolveVehicleCollisionFilter('B'));

    // instance-exclusive：mask 含己方类别，group 唯一且避开正式 projectile 的 -1 / -2
    const b1 = resolveVehicleCollisionFilter('B', {
      policy: 'instance-exclusive',
      instanceIndex: 1,
    });
    const b2 = resolveVehicleCollisionFilter('B', {
      policy: 'instance-exclusive',
      instanceIndex: 2,
    });
    expect(b1.maskBits).toBe(GROUND | ARENA | PROJECTILE | HAZARD | VEHICLE_A | VEHICLE_B);
    expect(b1.groupIndex).toBe(-101);
    expect(b2.groupIndex).toBe(-102);
    expect(b1.groupIndex).not.toBe(-1);
    expect(b1.groupIndex).not.toBe(-2);
    // 缺 instanceIndex / 非法 → 明确抛错，不静默回退
    expect(() =>
      resolveVehicleCollisionFilter('B', { policy: 'instance-exclusive' }),
    ).toThrow(/instanceIndex/);
  });

  /**
   * 同队两车（enemy-B1 / enemy-B2）装配在重叠位置：
   * - 正式默认（team-exclusive）→ 负数 group 相同，B↔B 永不碰撞，位置不变；
   * - instance-exclusive → 实例独享负数 group + mask 含己方类别 → 真实分离。
   */
  function overlapProbe(collision?: { policy: 'instance-exclusive'; instanceIndex: number }): {
    separation: number;
    events: BattleEvent[];
  } {
    const world = new PlanckWorld({ x: 0, y: 0 });
    const v1 = createPlanckVehicle(
      world,
      resolveSnapshot(buildWithId(ENEMY_IDS[0]), registry),
      'B',
      { x: 0, y: 0 },
      1,
      collision && { ...collision, instanceIndex: 1 },
    );
    const v2 = createPlanckVehicle(
      world,
      resolveSnapshot(buildWithId(ENEMY_IDS[1]), registry),
      'B',
      { x: 20, y: 0 },
      1,
      collision && { ...collision, instanceIndex: 2 },
    );
    const { router, events } = makeHarness([v1, v2]);
    world.setBatchedContactListener((e) => router.handlePlanckContact(world, e));
    for (let i = 0; i < 240; i++) world.stepFixed(1);
    const p1 = world.getPosition(v1.body);
    const p2 = world.getPosition(v2.body);
    return { separation: Math.hypot(p1.x - p2.x, p1.y - p2.y), events };
  }

  it('正式默认（team-exclusive）行为字面不变：同队车辆仍不碰撞', () => {
    const { separation } = overlapProbe();
    console.log(`[PBL-F2-SAMETEAM] default separation=${separation}`);
    expect(separation).toBeCloseTo(20, 0);
  });

  it('instance-exclusive：同队不同车辆真实物理碰撞并分离（非代理体 / 非排斥力）', () => {
    const { separation, events } = overlapProbe({
      policy: 'instance-exclusive',
      instanceIndex: 1,
    });
    const damageEvents = events.filter(isDamageEvent);
    console.log(
      `[PBL-F2-SAMETEAM] instance-exclusive separation=${separation} damageEvents=${damageEvents.length}`,
    );
    // 真实碰撞把两车推开（旧行为下保持 20px 重叠）
    expect(separation).toBeGreaterThan(40);
    // 同队碰撞不产生友伤（正式同队无伤害语义不变）
    expect(damageEvents).toHaveLength(0);
  });
});

describe('PBL-F2 · destroy 隔离', () => {
  it('销毁 B1 / B2 后，命中 B3 仍只结算到 B3', () => {
    const ens = makeEnsemble();
    const { router, events } = makeHarness(ens.vehicles);

    // 销毁数组中最靠前的两个 team B 实例（旧 team 反查必然命中已销毁的 B1）
    destroyVehicle(ens.world, ens.b1);
    destroyVehicle(ens.world, ens.b2);

    const { world } = makeStrikeWorld(ens.b3.id);
    const shooter = createPlanckVehicle(
      world,
      resolveSnapshot(buildWithId(PLAYER_ID), registry),
      'A',
      { x: -520, y: 640 },
      1,
    );
    const cannon = shooter.parts.find((p) => p.id === 'front')!;
    world.setBatchedContactListener((e) => router.handlePlanckContact(world, e));
    spawnWeaponProjectile(world, shooter, cannon, {
      dir: { x: 1, y: 0 },
      muzzleSpeed: 8,
      projectileRadius: cannon.def.behaviorParams!.projectileRadius as number,
      projectileMass: cannon.def.behaviorParams!.projectileMass as number,
      gravityScale: 0,
    });

    const steps = stepUntilDamage(world, router);
    const damageEvents = events.filter(isDamageEvent);
    console.log(
      `[PBL-F2-DESTROY] steps=${steps} damageEvents=${damageEvents.length} ` +
        `target=${router.debug.lastDamage?.target} hp B1=${ens.b1.hp} B2=${ens.b2.hp} B3=${ens.b3.hp}`,
    );

    expect(steps).toBeGreaterThan(0);
    expect(ens.b3.hp).toBe(1000 - CANNON_PROJECTILE_DAMAGE);
    expect(ens.b1.hp).toBe(1000);
    expect(ens.b2.hp).toBe(1000);
    expect(router.debug.lastDamage?.target).toBe(ens.b3.id);
    expect(damageEvents).toHaveLength(1);
  });
});
