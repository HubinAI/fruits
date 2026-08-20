/**
 * Queue W1-END-2｜Closing Spike Wall Hazard Damage
 *
 * 真实 Planck 碰撞作为接触来源，正式 ContactRouter / DamageResolver 作为结果端：
 * 1. Active 接触 hazard = 0 damage（不登记 tick）；
 * 2. Warning 接触 hazard = 0 damage（只警告不刺伤）；
 * 3. Closing 接触后 HP 按固定物理时间周期下降（contactTick Foundation 复用）；
 * 4. 离开刺墙（contact end）立即停止后续 tick；
 * 5. Combat Event 标记 damageSource:'hazard'（type:'damage'）；
 * 6. 双方同时被刺墙压死 → W1-END-1 seed 仍产出唯一赢家（orchestrator 级）；
 * 7. Closing 物理推进语义保持不变（hazard 伤害不影响刺墙推进）。
 *
 * 普通左右墙 / Ground 无 hazard 伤害；无 setHP=0；无刺墙专属击退；Renderer 不参与判定。
 */
import { describe, it, expect } from 'vitest';
import { createRegistry } from '../src/core/content';
import type { BuildSnapshot } from '../src/core/types';
import { resolveSnapshot } from '../src/core/buildSnapshot';
import { ContactRouter } from '../src/battle/contactRouter';
import { DamageResolver } from '../src/battle/damageResolver';
import { CombatEventBus, isDamageEvent, type DamageEvent } from '../src/battle/combatEvents';
import { deterministicTieBreak, resolveBattleResult } from '../src/battle/battleContract';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import { PHYSICS_HZ } from '../src/physics/units';
import {
  createPlanckVehicle,
  type PlanckVehicle,
} from '../src/battle/planckVehicleAssembly';
import { PlanckWorld } from '../src/physics/planckWorld';

const registry = createRegistry();

/** 无武器双轮 build（hazard 压死测试：排除 weapon/impact 干扰） */
function plainBuild(side: 'A' | 'B'): BuildSnapshot {
  return {
    id: side === 'A' ? 'hazardCarA' : 'hazardCarB',
    bodyDefId: 'boxBody',
    quality: 1,
    movements: [
      { hardpointId: 'rear', defId: 'wheelStd' },
      { hardpointId: 'front', defId: 'wheelStd' },
    ],
    functionals: [],
  };
}

/** 独立状态世界：装配真实 PlanckVehicle（只作为 Router 只读战斗状态容器） */
function makeState(side: 'A' | 'B'): PlanckVehicle {
  const world = new PlanckWorld();
  const resolved = resolveSnapshot(plainBuild(side), registry);
  return createPlanckVehicle(world, resolved, side, { x: 0, y: 0 });
}

const HAZARD_TICK_MS = 1000;
const HAZARD_DMG = 40;

/**
 * 碰撞世界：hazard 刺墙（kinematic，OwnerTag kind:'hazard'）+ 车辆 box（team A），
 * 车辆以速度驶近刺墙 → 真实 begin 接触。返回 world + 车辆 body + 监听计数。
 */
function makeHazardWorld() {
  const world = new PlanckWorld({ x: 0, y: 10 });
  const hazard = world.createKinematicBox(0, 640, 40, 200, {
    friction: 0.2,
    restitution: 0,
  });
  world.setOwnerTag(hazard, { kind: 'hazard' });
  const car = world.createDynamicBox(70, 640, 60, 40, 50);
  world.setOwnerTag(car, { kind: 'vehicle', vehicleId: 'hazardCarA', team: 'A' });
  world.setLinearVelocity(car, -1, 0); // 朝 hazard 靠近
  return { world, hazard, car };
}

/** 步进直到 hazard 接触开始（router.debug.lastContact 出现），返回所用步数 */
function stepUntilHazardContact(
  world: PlanckWorld,
  router: ContactRouter,
  maxSteps = 900,
): number {
  let steps = 0;
  for (; steps < maxSteps; steps++) {
    const before = router.debug.lastContact;
    world.stepFixed(1);
    if (router.debug.lastContact !== before && router.debug.lastContact !== null) {
      return steps + 1;
    }
  }
  return steps;
}

/** 步进直到车辆离开 hazard 区域（contact end 已投递） */
function stepUntilHazardEnd(
  world: PlanckWorld,
  car: ReturnType<typeof makeHazardWorld>['car'],
  maxSteps = 600,
): number {
  world.setLinearVelocity(car, 3, 0); // 拉开
  let steps = 0;
  for (; steps < maxSteps; steps++) {
    world.stepFixed(1);
    if (world.getPosition(car).x > 80) break;
  }
  return steps;
}

describe('W1-END-2 · hazard 伤害门控与 tick', () => {
  function makeRouter(state: PlanckVehicle) {
    const bus = new CombatEventBus();
    const events: DamageEvent[] = [];
    bus.subscribe((e) => {
      if (isDamageEvent(e)) events.push(e);
    });
    const router = new ContactRouter(
      [state],
      new DamageResolver(bus),
      { threshold: 999, damagePerSpeed: 0.5, maxDamage: 120 }, // 隔离 Impact
      { tickMs: HAZARD_TICK_MS, damagePerTick: HAZARD_DMG },
    );
    return { router, events };
  }

  it('1. Active 接触 hazard = 0 damage（不登记 tick）', () => {
    const state = makeState('A');
    const { router } = makeRouter(state);
    const { world } = makeHazardWorld();
    world.setBatchedContactListener((e) => router.handlePlanckContact(world, e, 'Active'));

    const steps = stepUntilHazardContact(world, router);
    expect(steps).toBeGreaterThan(0); // 接触确实发生
    // 持续推进 tick（Active 阶段）→ 0 伤害
    router.advanceContactTicks(1000, 'Active');
    router.advanceContactTicks(2000, 'Active');
    router.advanceContactTicks(3000, 'Active');
    expect(state.hp).toBe(1000);
    expect(router.debug.lastDamage).toBeNull();
  });

  it('2. Warning 接触 hazard = 0 damage（只警告不刺伤）', () => {
    const state = makeState('A');
    const { router } = makeRouter(state);
    const { world } = makeHazardWorld();
    world.setBatchedContactListener((e) => router.handlePlanckContact(world, e, 'Warning'));

    const steps = stepUntilHazardContact(world, router);
    expect(steps).toBeGreaterThan(0);
    router.advanceContactTicks(1000, 'Warning');
    router.advanceContactTicks(2000, 'Warning');
    router.advanceContactTicks(3000, 'Warning');
    expect(state.hp).toBe(1000);
    expect(router.debug.lastDamage).toBeNull();
  });

  it('3. Closing 接触后 HP 按固定物理时间周期下降（首 tick 从接触开始计时）', () => {
    const state = makeState('A');
    const { router, events } = makeRouter(state);
    const { world } = makeHazardWorld();
    world.setBatchedContactListener((e) => router.handlePlanckContact(world, e, 'Closing'));

    const steps = stepUntilHazardContact(world, router);
    expect(steps).toBeGreaterThan(0);
    const contactAt = 10_000; // 固定物理时间基准（接触已建立）
    router.advanceContactTicks(contactAt, 'Closing'); // 记录 startedAt，不 tick
    expect(state.hp).toBe(1000);
    router.advanceContactTicks(contactAt + 999, 'Closing'); // < interval：无 tick
    expect(state.hp).toBe(1000);
    router.advanceContactTicks(contactAt + 1000, 'Closing'); // 首 tick
    expect(state.hp).toBe(1000 - HAZARD_DMG);
    router.advanceContactTicks(contactAt + 2000, 'Closing'); // 次 tick
    expect(state.hp).toBe(1000 - HAZARD_DMG * 2);
    // Combat Event 标记 hazard
    const hazardEvents = events.filter((e) => e.damageSource === 'hazard');
    expect(hazardEvents.length).toBe(2);
    expect(hazardEvents[0]!.damage).toBe(HAZARD_DMG);
    expect(hazardEvents[0]!.type).toBe('damage');
    expect(hazardEvents[0]!.target).toBe('A');
    expect(hazardEvents[0]!.source).toBe('A'); // source/target 均为被压车辆
  });

  it('4. 离开刺墙（contact end）立即停止后续 tick', () => {
    const state = makeState('A');
    const { router } = makeRouter(state);
    const { world, car } = makeHazardWorld();
    world.setBatchedContactListener((e) => router.handlePlanckContact(world, e, 'Closing'));

    const steps = stepUntilHazardContact(world, router);
    expect(steps).toBeGreaterThan(0);
    const contactAt = 10_000;
    router.advanceContactTicks(contactAt, 'Closing'); // 记录 startedAt
    router.advanceContactTicks(contactAt + 1000, 'Closing'); // 首 tick
    expect(state.hp).toBe(1000 - HAZARD_DMG);

    // 拉开：接触 end → hazard tick 移除
    stepUntilHazardEnd(world, car);
    const hpAfterEnd = state.hp;
    // 再推很久 → 无新伤害
    router.advanceContactTicks(contactAt + 20_000, 'Closing');
    expect(state.hp).toBe(hpAfterEnd);
  });

  it('5. 普通墙 / Ground 接触不产生 hazard 伤害', () => {
    const state = makeState('A');
    const { router } = makeRouter(state);
    const world = new PlanckWorld({ x: 0, y: 10 });
    // 普通墙（OwnerTag kind:'arena'）+ Ground（kind:'ground'）
    const wall = world.createKinematicBox(0, 640, 40, 200);
    world.setOwnerTag(wall, { kind: 'arena' });
    const ground = world.createStaticGround(0, 700, 4000, 80);
    world.setOwnerTag(ground, { kind: 'ground' });
    const car = world.createDynamicBox(70, 640, 60, 40, 50);
    world.setOwnerTag(car, { kind: 'vehicle', vehicleId: 'hazardCarA', team: 'A' });
    world.setLinearVelocity(car, -1, 0);
    world.setBatchedContactListener((e) => router.handlePlanckContact(world, e, 'Closing'));

    const before = router.debug.lastContact;
    for (let i = 0; i < 300; i++) {
      world.stepFixed(1);
      if (router.debug.lastContact !== before) break;
    }
    router.advanceContactTicks(10_000, 'Closing');
    router.advanceContactTicks(11_000, 'Closing');
    expect(state.hp).toBe(1000);
    expect(router.debug.lastDamage).toBeNull();
  });

  it('6. 真实 battle：Closing 压死产生唯一赢家 + 刺墙物理推进语义不变', () => {
    const STEP = 1000 / PHYSICS_HZ;
    const o = new PlanckBattleOrchestrator(
      plainBuild('A'),
      plainBuild('B'),
      registry,
      {
        // 与各自刺墙轻微重叠出生：Closing 起始后真实 begin 接触 → hazard tick
        spawnA: { x: -20, y: 640, facing: 1 },
        spawnB: { x: 1620, y: 640, facing: -1 },
        settleToGround: true,
        autoDrive: false, // 站桩：只被刺墙挤压
        randomSeed: 2026,
        impact: { threshold: 999 }, // 隔离 Impact（只测 hazard）
        arena: {
          phases: {
            activeMs: STEP * 20,
            warningMs: STEP * 10,
            closingMs: STEP * 300,
          },
          closingSpeed: 4,
          hazardTickMs: STEP * 2,
          hazardDamagePerTick: 1000, // 首 tick 即致死
        },
      },
    );
    o.arena.setPhase('Closing');
    const hazardEvents: string[] = [];
    o.onCombatEvent((e) => {
      if (isDamageEvent(e) && e.damageSource === 'hazard') {
        hazardEvents.push(e.target);
      }
    });

    const wall0 = o.world.getPosition(o.arena.closingWalls[0]!.body).x; // 左墙 -120
    const wall1 = o.world.getPosition(o.arena.closingWalls[1]!.body).x; // 右墙 1720

    for (let i = 0; i < 600 && !o.result; i++) {
      o.step(STEP);
    }
    const r = o.result!;
    expect(r).not.toBeNull();

    // hazard 在真实 battle 中真实产生伤害（至少一方被刺墙压死）
    expect(hazardEvents.length).toBeGreaterThan(0);
    // 正式战斗无平局：唯一赢家 + endReason='hp'（hazard 收束导致死亡）
    expect(r.winner).toBe(hazardEvents[0] === 'A' ? 'B' : 'A');
    expect(['A', 'B']).toContain(r.winner);
    expect(r.endReason).toBe('hp');
    // Closing 物理推进语义保持不变：左右刺墙真实相向推进（hazard 伤害不影响墙）
    expect(o.world.getPosition(o.arena.closingWalls[0]!.body).x).toBeGreaterThan(wall0);
    expect(o.world.getPosition(o.arena.closingWalls[1]!.body).x).toBeLessThan(wall1);
  });

  it('7. 双方同一 fixed-step 被 hazard 压死 → W1-END-1 seed 仍产出唯一赢家（router 确定性）', () => {
    const a = makeState('A');
    const b = makeState('B');
    const router = new ContactRouter(
      [a, b],
      new DamageResolver(new CombatEventBus()),
      { threshold: 999, damagePerSpeed: 0.5, maxDamage: 120 },
      { tickMs: 1000, damagePerTick: 1000 }, // 首 tick 即致死
    );
    // 碰撞世界：左侧 hazard→carA、右侧 hazard→carB（对称）
    const world = new PlanckWorld({ x: 0, y: 10 });
    world.createStaticGround(0, 700, 4000, 80); // 落地保持接触（无 tag：仅物理阻挡，不参与路由）
    const hzL = world.createKinematicBox(-30, 640, 40, 200);
    world.setOwnerTag(hzL, { kind: 'hazard' });
    const carA = world.createDynamicBox(30, 640, 60, 40, 50);
    world.setOwnerTag(carA, { kind: 'vehicle', vehicleId: 'hazardCarA', team: 'A' });
    world.setLinearVelocity(carA, -1, 0); // 朝左墙
    const hzR = world.createKinematicBox(800, 640, 40, 200);
    world.setOwnerTag(hzR, { kind: 'hazard' });
    const carB = world.createDynamicBox(740, 640, 60, 40, 50);
    world.setOwnerTag(carB, { kind: 'vehicle', vehicleId: 'hazardCarB', team: 'B' });
    world.setLinearVelocity(carB, 1, 0); // 朝右墙
    world.setBatchedContactListener((e) => router.handlePlanckContact(world, e, 'Closing'));

    // 步进到双方都建立 hazard 接触（两车各撞一墙，均持续接触）
    for (let i = 0; i < 900; i++) {
      world.stepFixed(1);
    }
    // 同一 fixed-step 语义：一次 advanceContactTicks 内所有活跃 hazard tick 齐发 → 双方同时死亡
    router.advanceContactTicks(10_000, 'Closing'); // 记录 startedAt
    router.advanceContactTicks(11_000, 'Closing'); // 首 tick 齐发
    expect(a.hp).toBe(0);
    expect(b.hp).toBe(0);

    // W1-END-1：双死 → deterministicTieBreak(seed) 唯一赢家（同 seed 重跑一致）
    const seed = 7;
    const r = resolveBattleResult('Closing', a.hp, b.hp, seed)!;
    expect(r.winner).toBe(deterministicTieBreak(seed));
    expect(['A', 'B']).toContain(r.winner);
    expect(r.endReason).toBe('hp');
    expect(r.winner).toBe(deterministicTieBreak(seed)); // 重跑一致
  });
});
