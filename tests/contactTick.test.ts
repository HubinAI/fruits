/**
 * Queue W1-HIT-1｜Generic Contact Hit Policy targeted test
 *
 * 覆盖 W1-HIT-1 验收：
 * 1. contactOnce 与当前行为完全一致（无 hitPolicy → baseDamage 一次，Hammer 等零变化）；
 * 2. 1 秒持续接触产生可预测 tick 数（interval 1000ms → advance 时间驱动）；
 * 3. contact end 后立即停止（end 事件移除 → 后续 advance 不再扣血）；
 * 4. 同一物理步多 contact pair 不重复（batch 合并 → 单 key 登记）；
 * 5. 两件独立 weapon（不同 hardpoint）独立 tick。
 */
import { describe, it, expect } from 'vitest';
import Matter from 'matter-js';
import { createRegistry } from '../src/core/content';
import type { BuildSnapshot } from '../src/core/types';
import { getMeta, type ContactEvent } from '../src/physics/adapter';
import { BattleOrchestrator } from '../src/battle/battleOrchestrator';
import { ContactRouter, readHitPolicy } from '../src/battle/contactRouter';
import { DamageResolver } from '../src/battle/damageResolver';
import { CombatEventBus } from '../src/battle/combatEvents';
import type { Vehicle } from '../src/battle/vehicleAssembly';

const registry = createRegistry();

/** contactTick 测试武器（圆锯语义；interval 1000ms / damage 10） */
const SAW_HIT_POLICY = { mode: 'contactTick' as const, intervalMs: 1000, damage: 10 };
registry.functionals.set('saw', {
  id: 'saw',
  name: '锯',
  category: 'weapon',
  mass: 20,
  energy: 25,
  collider: { shape: 'box', width: 40, height: 10, offset: { x: 20, y: 0 } },
  behavior: 'ram',
  behaviorParams: { hitPolicy: SAW_HIT_POLICY },
});

function wheels() {
  return [
    { hardpointId: 'rear', defId: 'wheelStd' },
    { hardpointId: 'front', defId: 'wheelStd' },
  ];
}

function sawBuild(id: string, parts: Array<{ hardpointId: string; defId: string }>): BuildSnapshot {
  return { id, bodyDefId: 'boxBody', quality: 1, movements: wheels(), functionals: parts };
}

function plainBuild(id: string): BuildSnapshot {
  return { id, bodyDefId: 'boxBody', quality: 1, movements: wheels(), functionals: [] };
}

function makeOrch(a: BuildSnapshot, b: BuildSnapshot): BattleOrchestrator {
  return new BattleOrchestrator(a, b, registry, {
    autoDrive: true,
    spawnA: { x: 400, y: 640, facing: 1 },
    spawnB: { x: 900, y: 640, facing: -1 },
  });
}

function makeRouter(orch: BattleOrchestrator): ContactRouter {
  return new ContactRouter(
    [orch.vehicleA, orch.vehicleB],
    new DamageResolver(new CombatEventBus()),
    { threshold: 999, damagePerSpeed: 0.5, maxDamage: 120 }, // Impact 隔离
  );
}

function findBodySubPart(v: Vehicle): Matter.Body {
  return v.body.parts.find((p) => p !== v.body && String(getMeta(p).partId ?? '').startsWith('body'))!;
}

function weaponParts(v: Vehicle): Matter.Body[] {
  return v.parts.filter((p) => p.def.category === 'weapon').map((p) => p.body);
}

function makeStart(
  bodyA: Matter.Body,
  bodyB: Matter.Body,
  relVel: number,
  batch?: { timestamp?: number; index: number; size: number },
): ContactEvent {
  return {
    bodyA,
    bodyB,
    contactPoint: { x: 500, y: 400 },
    normal: { x: 1, y: 0 },
    relativeVelocity: relVel,
    phase: 'start',
    ...(batch
      ? { batch: { timestamp: batch.timestamp ?? 1000, index: batch.index, size: batch.size } }
      : {}),
  };
}

function makeEnd(bodyA: Matter.Body, bodyB: Matter.Body): ContactEvent {
  return {
    bodyA,
    bodyB,
    contactPoint: { x: 500, y: 400 },
    normal: { x: 1, y: 0 },
    relativeVelocity: 1,
    phase: 'end',
  };
}

describe('W1-HIT-1 Contact Hit Policy', () => {
  it('0. readHitPolicy：缺省 contactOnce；合法 contactTick；非法回退 contactOnce', () => {
    expect(readHitPolicy(undefined)).toEqual({ mode: 'contactOnce' });
    expect(readHitPolicy({ baseDamage: 80 })).toEqual({ mode: 'contactOnce' });
    expect(readHitPolicy({ hitPolicy: { mode: 'contactTick', intervalMs: 500, damage: 5 } })).toEqual(
      { mode: 'contactTick', intervalMs: 500, damage: 5, minRelativeVelocity: undefined },
    );
    expect(readHitPolicy({ hitPolicy: { mode: 'contactTick', intervalMs: 0, damage: 5 } })).toEqual(
      { mode: 'contactOnce' }, // 非法 interval → 回退
    );
    expect(
      readHitPolicy({ hitPolicy: { mode: 'contactTick', intervalMs: 500, damage: 5, minRelativeVelocity: 2 } }),
    ).toEqual({ mode: 'contactTick', intervalMs: 500, damage: 5, minRelativeVelocity: 2 });
  });

  it('1. contactOnce 与当前行为完全一致（无 hitPolicy → baseDamage 一次）', () => {
    const light = registry.functionals.get('ramHead')!;
    const build: BuildSnapshot = {
      id: 'ramCar',
      bodyDefId: 'boxBody',
      quality: 1,
      movements: wheels(),
      functionals: [{ hardpointId: 'front', defId: 'ramHead' }],
    };
    const orch = makeOrch(build, plainBuild('B'));
    const router = makeRouter(orch);
    const ram = weaponParts(orch.vehicleA)[0]!;
    const bBody = findBodySubPart(orch.vehicleB);
    const hpB0 = orch.vehicleB.hp;

    router.handleContact(makeStart(ram, bBody, 3.0)); // relVel >= weapon threshold
    // contactOnce：一次 baseDamage=80；tick 不参与
    router.advanceContactTicks(0);
    router.advanceContactTicks(10000);
    expect(orch.vehicleB.hp).toBeCloseTo(hpB0 - (light.behaviorParams!.baseDamage as number), 5);
  });

  it('2. contactTick：1 秒持续接触产生可预测 tick 数', () => {
    const orch = makeOrch(sawBuild('A', [{ hardpointId: 'front', defId: 'saw' }]), plainBuild('B'));
    const router = makeRouter(orch);
    const saw = weaponParts(orch.vehicleA)[0]!;
    const bBody = findBodySubPart(orch.vehicleB);
    const hpB0 = orch.vehicleB.hp;

    router.handleContact(makeStart(saw, bBody, 3.0));
    // 首步 advance：开始计时（不 tick）
    router.advanceContactTicks(0);
    expect(orch.vehicleB.hp).toBe(hpB0);
    // 999ms：未到 interval → 无 tick
    router.advanceContactTicks(999);
    expect(orch.vehicleB.hp).toBe(hpB0);
    // 1000ms：第 1 tick
    router.advanceContactTicks(1000);
    expect(orch.vehicleB.hp).toBe(hpB0 - 10);
    // 2000ms：第 2 tick（累计 2 次）
    router.advanceContactTicks(2000);
    expect(orch.vehicleB.hp).toBe(hpB0 - 20);
    // 2500ms：仍 2 次（不足下一个 interval）
    router.advanceContactTicks(2500);
    expect(orch.vehicleB.hp).toBe(hpB0 - 20);
  });

  it('3. contact end 后立即停止（后续 advance 不再扣血）', () => {
    const orch = makeOrch(sawBuild('A', [{ hardpointId: 'front', defId: 'saw' }]), plainBuild('B'));
    const router = makeRouter(orch);
    const saw = weaponParts(orch.vehicleA)[0]!;
    const bBody = findBodySubPart(orch.vehicleB);
    const hpB0 = orch.vehicleB.hp;

    router.handleContact(makeStart(saw, bBody, 3.0));
    router.advanceContactTicks(0);
    router.advanceContactTicks(2000); // 2 tick
    expect(orch.vehicleB.hp).toBe(hpB0 - 20);

    router.handleContact(makeEnd(saw, bBody)); // 接触结束
    router.advanceContactTicks(4000); // 足够长时间
    router.advanceContactTicks(10000);
    expect(orch.vehicleB.hp).toBe(hpB0 - 20); // 不再扣血

    // 重新接触 → 重新开始计时（新 tick 周期）
    router.handleContact(makeStart(saw, bBody, 3.0));
    router.advanceContactTicks(10500);
    expect(orch.vehicleB.hp).toBe(hpB0 - 20); // 新周期刚开始（首次 advance 计时）
    router.advanceContactTicks(11500);
    expect(orch.vehicleB.hp).toBe(hpB0 - 30); // 新周期第 1 tick
  });

  it('4. 同一物理步多 contact pair 不重复（batch 合并 → 单 key 登记，tick 单份）', () => {
    const orch = makeOrch(sawBuild('A', [{ hardpointId: 'front', defId: 'saw' }]), plainBuild('B'));
    const router = makeRouter(orch);
    const saw = weaponParts(orch.vehicleA)[0]!;
    const bBody = findBodySubPart(orch.vehicleB);
    const bWheel = orch.vehicleB.wheels.find((w) => w.id === 'front')!.body;
    const hpB0 = orch.vehicleB.hp;

    // 同一 saw 同批接触 B 两个 sub-part → 只登记一次（batch 合并）
    router.handleContact(makeStart(saw, bBody, 3.0, { index: 0, size: 2 }));
    router.handleContact(makeStart(saw, bWheel, 4.0, { index: 1, size: 2 }));
    router.advanceContactTicks(0);
    router.advanceContactTicks(2000); // 2 tick
    expect(orch.vehicleB.hp).toBe(hpB0 - 20); // 单份 tick（非双份 40）
  });

  it('5. 两件独立 weapon（不同 hardpoint）独立 tick', () => {
    const orch = makeOrch(
      sawBuild('A', [
        { hardpointId: 'front', defId: 'saw' },
        { hardpointId: 'top', defId: 'saw' },
      ]),
      plainBuild('B'),
    );
    const router = makeRouter(orch);
    const [sawA, sawB] = weaponParts(orch.vehicleA); // front / top
    const bBody = findBodySubPart(orch.vehicleB);
    const hpB0 = orch.vehicleB.hp;

    // 两个 part 各自接触 B（同批）
    router.handleContact(makeStart(sawA, bBody, 3.0, { index: 0, size: 2 }));
    router.handleContact(makeStart(sawB, bBody, 3.0, { index: 1, size: 2 }));
    router.advanceContactTicks(0);
    router.advanceContactTicks(2000); // 各自 2 tick → 共 4 次 × 10
    expect(orch.vehicleB.hp).toBe(hpB0 - 40);

    // 只结束 sawA 的接触 → sawB 继续独立 tick
    router.handleContact(makeEnd(sawA, bBody));
    router.advanceContactTicks(3000);
    expect(orch.vehicleB.hp).toBe(hpB0 - 50); // sawB 多 1 tick（10）
  });

  it('6. Q13-A-R1：saw 有效 contactTick → getActiveSparks 返回真实接触点火花；接触 end → 空', () => {
    const orch = makeOrch(sawBuild('A', [{ hardpointId: 'front', defId: 'saw' }]), plainBuild('B'));
    const router = makeRouter(orch);
    const saw = weaponParts(orch.vehicleA)[0]!;
    const bBody = findBodySubPart(orch.vehicleB);
    // 接触开始（relVel 达标 → 登记 contactTick 活跃接触）
    router.handleContact(makeStart(saw, bBody, 3.0));
    router.advanceContactTicks(0);
    const sparks = router.getActiveSparks();
    expect(sparks.length).toBe(1); // 仅 saw 一个活跃 contactTick → 一个火花
    const sp = sparks[0]!;
    expect(sp.x).toBe(500); // 真实接触点（makeStart contactPoint）
    expect(sp.y).toBe(400);
    expect(sp.team).toBe('A'); // 火花归属锯片方（attacker team）
    expect(Number.isFinite(sp.nx) && Number.isFinite(sp.ny)).toBe(true); // 接触法线有效
    // 接触结束 → 火花立即消失（停推即空，纯表现）
    router.handleContact(makeEnd(saw, bBody));
    expect(router.getActiveSparks().length).toBe(0);
  });
});
