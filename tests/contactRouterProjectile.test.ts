/**
 * Queue Q02-F2｜ContactRouter Projectile Route targeted test
 *
 * 覆盖 Q02-F2 验收：
 * 1. hostile projectile 命中：只扣一次 behaviorParams.projectileDamage（damageSource='weapon'），
 *    且 projectile 不参与 vehicle Impact Damage；
 * 2. same-team projectile：0 damage（但接触事实仍记录）；
 * 3. contact fact：区分 projectile body 与另一方 Owner、drain 读取后清空不重复、
 *    hostile vehicle / arena 均可被消费；
 * 4. 同一 batch（同来源武器 + 同目标）多个 projectile begin 只结算一次。
 *
 * 碰撞事件来自真实 PlanckWorld（真实 projectile body / chassis body + OwnerTag），
 * 战斗状态用引擎中立 CombatVehicleState（Router 契约）。
 */
import { describe, it, expect } from 'vitest';
import { ContactRouter } from '../src/battle/contactRouter';
import { DamageResolver } from '../src/battle/damageResolver';
import { CombatEventBus, isDamageEvent, type BattleEvent, type DamageEvent } from '../src/battle/combatEvents';
import type { CombatVehicleState } from '../src/battle/combatVehicle';
import type { FunctionalPartDef } from '../src/core/types';
import { PlanckWorld, type BodyHandle } from '../src/physics/planckWorld';

/** 测试用 cannon 武器部件：projectileDamage=60 */
const cannonDef: FunctionalPartDef = {
  id: 'cannon-1',
  name: 'test cannon',
  category: 'weapon',
  mass: 2,
  energy: 10,
  collider: { shape: 'box', width: 10, height: 10, offset: { x: 0, y: 0 } },
  behavior: 'cannon',
  behaviorParams: { projectileDamage: 60 },
};

function makeState(team: 'A' | 'B'): CombatVehicleState {
  return {
    id: `vehicle-${team}`,
    team,
    hp: 1000,
    maxHp: 1000,
    wheels: [],
    parts: [{ id: 'cannon-1', def: cannonDef }],
  };
}

function makeHarness(a: CombatVehicleState, b: CombatVehicleState) {
  const events: BattleEvent[] = [];
  const bus = new CombatEventBus();
  bus.subscribe((e) => events.push(e));
  const router = new ContactRouter([a, b], new DamageResolver(bus));
  return { router, events };
}

/**
 * 真实 Planck 碰撞世界：目标 chassis（team targetTeam）静止于 (0,640)，
 * projectile（team projTeam，OwnerTag.partId='part:cannon-1'）自 (-300,640)
 * 以 8 px/step 向右飞行（零重力水平直飞），命中 chassis 左面（x≈-66，含 r=6）。
 */
function makeHitWorld(projTeam: 'A' | 'B', targetTeam: 'A' | 'B') {
  const world = new PlanckWorld();
  const chassis = world.createDynamicBox(0, 640, 120, 40, 500);
  world.setOwnerTag(chassis, {
    kind: 'vehicle',
    vehicleId: `vehicle-${targetTeam}`,
    team: targetTeam,
  });
  const proj = world.createDynamicCircle(-300, 640, 6, 0.5);
  world.setOwnerTag(proj, {
    kind: 'projectile',
    vehicleId: `vehicle-${projTeam}`,
    partId: 'part:cannon-1',
    team: projTeam,
  });
  world.setLinearVelocity(proj, 8, 0);
  return { world, chassis, proj };
}

describe('Q02-F2 ContactRouter Projectile Route', () => {
  it('hostile projectile 命中：只扣一次 projectileDamage=60，且不参与 Impact', () => {
    const a = makeState('A');
    const b = makeState('B');
    const { router, events } = makeHarness(a, b);
    const { world } = makeHitWorld('A', 'B');
    world.setBatchedContactListener((e) => router.handlePlanckContact(world, e));

    let hit = false;
    for (let i = 0; i < 400 && !hit; i++) {
      world.stepFixed(1);
      hit = events.some((ev) => isDamageEvent(ev) && ev.damageSource === 'weapon');
    }
    expect(hit).toBe(true);

    // 只扣一次 projectileDamage=60（无重复、非 Impact 半伤）
    const weaponHits = events.filter(
      (ev): ev is DamageEvent =>
        isDamageEvent(ev) && ev.damageSource === 'weapon' && ev.partId === 'cannon-1',
    );
    expect(weaponHits.length).toBe(1);
    expect(weaponHits[0]!.damage).toBe(60);
    expect(weaponHits[0]!.behavior).toBe('cannon');
    expect(b.hp).toBe(940);
    // projectile 不参与 vehicle Impact Damage
    expect(events.some((ev) => isDamageEvent(ev) && ev.damageSource === 'impact')).toBe(false);
    expect(router.debug.lastImpact).toBeNull();
  });

  it('same-team projectile：0 damage（但接触事实仍记录）', () => {
    const a = makeState('A');
    const b = makeState('B');
    const { router, events } = makeHarness(a, b);
    const { world } = makeHitWorld('A', 'A');
    world.setBatchedContactListener((e) => router.handlePlanckContact(world, e));
    world.stepFixed(200);

    expect(a.hp).toBe(1000);
    expect(events.length).toBe(0);
    const facts = router.drainProjectileContactFacts();
    expect(facts.length).toBeGreaterThanOrEqual(1);
    expect(facts[0]!.projectileTeam).toBe('A');
    expect(facts[0]!.otherKind).toBe('vehicle');
    expect(facts[0]!.otherTeam).toBe('A');
  });

  it('contact fact：区分 projectile body、drain 后清空不重复', () => {
    const a = makeState('A');
    const b = makeState('B');
    const { router } = makeHarness(a, b);
    const { world, proj } = makeHitWorld('A', 'B');
    world.setBatchedContactListener((e) => router.handlePlanckContact(world, e));

    world.stepFixed(120);
    const facts1 = router.drainProjectileContactFacts();
    expect(facts1.length).toBe(1);
    // 区分 projectile 实例：同一 opaque BodyHandle 引用
    expect(facts1[0]!.projectileBody).toBe(proj);
    expect(facts1[0]!.projectileTeam).toBe('A');
    expect(facts1[0]!.projectilePartId).toBe('part:cannon-1');
    expect(facts1[0]!.otherKind).toBe('vehicle');
    expect(facts1[0]!.otherTeam).toBe('B');
    expect(typeof facts1[0]!.relativeVelocity).toBe('number');
    // 继续步进（projectile 已停靠，无新 begin）→ drain 为空，不重复
    world.stepFixed(60);
    expect(router.drainProjectileContactFacts().length).toBe(0);
  });

  it('projectile ↔ arena 墙：记录 fact(otherKind=arena)，不产生伤害', () => {
    const a = makeState('A');
    const b = makeState('B');
    const { router, events } = makeHarness(a, b);

    const world = new PlanckWorld();
    const wall = world.createStaticBox(0, 640, 20, 400);
    world.setOwnerTag(wall, { kind: 'arena' });
    const proj = world.createDynamicCircle(-300, 640, 6, 0.5);
    world.setOwnerTag(proj, {
      kind: 'projectile',
      vehicleId: 'vehicle-A',
      partId: 'part:cannon-1',
      team: 'A',
    });
    world.setLinearVelocity(proj, 8, 0);
    world.setBatchedContactListener((e) => router.handlePlanckContact(world, e));

    world.stepFixed(120);
    expect(events.length).toBe(0); // arena 非 vehicle → 无伤害
    const facts = router.drainProjectileContactFacts();
    expect(facts.length).toBeGreaterThanOrEqual(1);
    expect(facts[0]!.otherKind).toBe('arena');
    expect(facts[0]!.otherTeam).toBeUndefined();
  });

  it('同一 batch 两个不同 projectile（同来源武器同目标）：各自结算一次 projectileDamage', () => {
    const a = makeState('A');
    const b = makeState('B');
    const { router, events } = makeHarness(a, b);

    const world = new PlanckWorld();
    const chassis = world.createDynamicBox(0, 640, 120, 40, 500);
    world.setOwnerTag(chassis, { kind: 'vehicle', vehicleId: 'vehicle-B', team: 'B' });
    const mk = (y: number): BodyHandle => {
      const p = world.createDynamicCircle(-120, y, 6, 0.5);
      world.setOwnerTag(p, {
        kind: 'projectile',
        vehicleId: 'vehicle-A',
        partId: 'part:cannon-1',
        team: 'A',
      });
      world.setLinearVelocity(p, 8, 0);
      return p;
    };
    mk(632);
    mk(648);

    // 记录 projectile 相关 begin 的 batch 分布（验证同一 batch 两 begin）
    const projBeginBatches = new Map<number, number>();
    world.setBatchedContactListener((e) => {
      router.handlePlanckContact(world, e);
      if (e.phase === 'begin' && e.batch) {
        const ta = world.getOwnerTag(e.bodyA);
        const tb = world.getOwnerTag(e.bodyB);
        if (ta?.kind === 'projectile' || tb?.kind === 'projectile') {
          projBeginBatches.set(
            e.batch.timestamp,
            (projBeginBatches.get(e.batch.timestamp) ?? 0) + 1,
          );
        }
      }
    });

    let hit = false;
    for (let i = 0; i < 200 && !hit; i++) {
      world.stepFixed(1);
      hit = events.some((ev) => isDamageEvent(ev) && ev.damageSource === 'weapon');
    }
    expect(hit).toBe(true);

    // 存在同一 batch 含 2 个 projectile begin（同一物理步两弹同时命中）
    expect([...projBeginBatches.values()].some((n) => n >= 2)).toBe(true);
    // 实例级去重：两个不同 projectile（即使 team/partId/target 相同）各自结算一次
    const weaponHits = events.filter(
      (ev) => isDamageEvent(ev) && ev.damageSource === 'weapon' && ev.partId === 'cannon-1',
    );
    expect(weaponHits.length).toBe(2);
    expect(b.hp).toBe(880); // 1000 - 60×2
  });

  it('同一 projectile（复合多 fixture）同一 batch 多 contact pair：只结算一次 projectileDamage', () => {
    const a = makeState('A');
    const b = makeState('B');
    const { router, events } = makeHarness(a, b);

    const world = new PlanckWorld();
    const chassis = world.createDynamicBox(0, 640, 120, 40, 500);
    world.setOwnerTag(chassis, { kind: 'vehicle', vehicleId: 'vehicle-B', team: 'B' });
    // 复合 projectile：两个 8×8 box 上下拼成平直前脸（offset y=±8）→ 同一步双 contact pair
    const proj = world.createDynamicCompound(
      -120,
      640,
      [
        { shape: 'box', width: 8, height: 8, offset: { x: 0, y: -8 } },
        { shape: 'box', width: 8, height: 8, offset: { x: 0, y: 8 } },
      ],
      0.5,
    );
    world.setOwnerTag(proj, {
      kind: 'projectile',
      vehicleId: 'vehicle-A',
      partId: 'part:cannon-1',
      team: 'A',
    });
    world.setLinearVelocity(proj, 8, 0);

    // 记录该 projectile 相关 begin 的 batch 分布（验证同一 batch 双 begin）
    const projBeginBatches = new Map<number, number>();
    world.setBatchedContactListener((e) => {
      router.handlePlanckContact(world, e);
      if (e.phase === 'begin' && e.batch) {
        const ta = world.getOwnerTag(e.bodyA);
        const tb = world.getOwnerTag(e.bodyB);
        if (ta?.kind === 'projectile' || tb?.kind === 'projectile') {
          projBeginBatches.set(
            e.batch.timestamp,
            (projBeginBatches.get(e.batch.timestamp) ?? 0) + 1,
          );
        }
      }
    });

    let hit = false;
    for (let i = 0; i < 200 && !hit; i++) {
      world.stepFixed(1);
      hit = events.some((ev) => isDamageEvent(ev) && ev.damageSource === 'weapon');
    }
    expect(hit).toBe(true);

    // 同一 projectile 同一 batch 两个 contact pair 均命中 chassis
    expect([...projBeginBatches.values()].some((n) => n >= 2)).toBe(true);
    // 实例级去重：同一实例只结算一次
    const weaponHits = events.filter(
      (ev) => isDamageEvent(ev) && ev.damageSource === 'weapon' && ev.partId === 'cannon-1',
    );
    expect(weaponHits.length).toBe(1);
    expect(b.hp).toBe(940);
  });
});
