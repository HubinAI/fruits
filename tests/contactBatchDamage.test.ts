/**
 * Queue F-02C-A2｜ContactRouter 批次伤害去重（只实现，不提交）
 *
 * 复用正式 BattleOrchestrator 创建真实 Vehicle，人工向 ContactRouter 投递
 * ContactEvent（不推进第二套物理模拟）。
 *
 * 验收：
 * 1. 同批 4 条敌车接触（注入 Impact threshold=1）：只结算一次 Impact，
 *    HP 变化按该批最大 relativeVelocity 计算；
 * 2. 同一 ramHead 同批接触两个目标 sub-part（Impact threshold=999 隔离）：
 *    defender 只损失一次 baseDamage=80；
 * 3. 无 batch 单条 start：保持旧行为，正常结算一次。
 */
import { describe, it, expect } from 'vitest';
import Matter from 'matter-js';
import { createRegistry } from '../src/core/content';
import type { BuildSnapshot } from '../src/core/types';
import { getMeta, type ContactEvent } from '../src/physics/adapter';
import { BattleOrchestrator } from '../src/battle/battleOrchestrator';
import { ContactRouter } from '../src/battle/contactRouter';
import { DamageResolver } from '../src/battle/damageResolver';
import { CombatEventBus } from '../src/battle/combatEvents';
import { getPreset } from '../src/lab/presets';
import type { Vehicle } from '../src/battle/vehicleAssembly';

const registry = createRegistry();
const lightSnapshot = getPreset('lightVehicle')!.build();
const bodyOnly: BuildSnapshot = { ...lightSnapshot, functionals: [] };

/** 构造正式 orchestrator（真实 Vehicle；不 step，无物理推进） */
function makeOrchestrator(buildA: BuildSnapshot, buildB: BuildSnapshot): BattleOrchestrator {
  return new BattleOrchestrator(buildA, buildB, registry, {
    autoDrive: true,
    spawnA: { x: 400, y: 640, facing: 1 },
    spawnB: { x: 900, y: 640, facing: -1 },
  });
}

/** 自建 router（注入测试用 impactConfig，正式阈值/伤害公式不变） */
function makeRouter(
  orch: BattleOrchestrator,
  impactThreshold: number,
): ContactRouter {
  return new ContactRouter(
    [orch.vehicleA, orch.vehicleB],
    new DamageResolver(new CombatEventBus()),
    { threshold: impactThreshold, damagePerSpeed: 0.5, maxDamage: 120 },
  );
}

/** 查找 vehicle 上 partId 前缀匹配的 sub-part（排除 parent） */
function findParts(v: Vehicle, partIdPrefix: string): Matter.Body[] {
  return v.body.parts.filter(
    (p) =>
      p !== v.body &&
      String(getMeta(p).partId ?? '').startsWith(partIdPrefix),
  );
}

/** 人工构造 start 事件（可选 batch 边界；timestamp 缺省 1000） */
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
      ? {
          batch: {
            timestamp: batch.timestamp ?? 1000,
            index: batch.index,
            size: batch.size,
          },
        }
      : {}),
  };
}

describe('F-02C-A2 · 验收1：同批 4 条敌车接触只结算一次 Impact', () => {
  it('Impact 用批内最大 relVel，HP 只减一次', () => {
    const orch = makeOrchestrator(lightSnapshot, bodyOnly);
    const router = makeRouter(orch, 1); // 注入 threshold=1 使低速也可触发
    const aBody = findParts(orch.vehicleA, 'body')[0]!;
    const bBody = findParts(orch.vehicleB, 'body')[0]!;
    const hpABefore = orch.vehicleA.hp;
    const hpBBefore = orch.vehicleB.hp;

    // 同批 4 条（relVel 递增），最大 4.5
    const relVels = [1.5, 2.5, 3.5, 4.5];
    relVels.forEach((rv, i) => {
      router.handleContact(makeStart(aBody, bBody, rv, { index: i, size: 4 }));
    });

    // 去重后：只结算一次，damage=(4.5-1)*0.5=1.75，双方各半 0.875
    const expectedEach = ((4.5 - 1) * 0.5) / 2;
    expect(orch.vehicleA.hp).toBeCloseTo(hpABefore - expectedEach, 5);
    expect(orch.vehicleB.hp).toBeCloseTo(hpBBefore - expectedEach, 5);
    // lastImpact 用最大 relVel 事件
    expect(router.debug.lastImpact?.relativeVelocity).toBeCloseTo(4.5, 5);
    expect(router.debug.lastImpact?.damage).toBeCloseTo(1.75, 5);
  });
});

describe('F-02C-A2 · 验收2：同一 ramHead 同批两目标只结算一次 Weapon', () => {
  it('defender 只损失一次 baseDamage=80（Impact 以 999 隔离）', () => {
    const orch = makeOrchestrator(lightSnapshot, bodyOnly);
    const router = makeRouter(orch, 999); // Impact 不触发，隔离验证 Weapon
    // ramHead 是独立 body（PartRuntime.body，不在 vehicle.body.parts 内）
    const ram = orch.vehicleA.parts.find((p) => p.def.category === 'weapon')!.body;
    const bBody = findParts(orch.vehicleB, 'body')[0]!; // B 车身 sub-part
    // wheel 是独立 body（不属于 vehicle.body.parts），从 wheels 运行时取
    const bWheel = orch.vehicleB.wheels.find((w) => w.id === 'front')!.body;
    const hpBBefore = orch.vehicleB.hp;

    // 同一 ramHead 同批接触两个目标 sub-part（relVel 3.0 / 4.0，均 ≥ weapon threshold=2）
    router.handleContact(makeStart(ram, bBody, 3.0, { index: 0, size: 2 }));
    router.handleContact(makeStart(ram, bWheel, 4.0, { index: 1, size: 2 }));

    // 去重后：同一武器同一敌车只结算一次 baseDamage=80
    expect(orch.vehicleB.hp).toBeCloseTo(hpBBefore - 80, 5);
    expect(router.debug.lastDamage?.damage).toBe(80);
    // A 无 Impact（999 隔离），HP 不变
    expect(orch.vehicleA.hp).toBeCloseTo(1000, 5);
  });
});

describe('F-02C-A2 · 验收3：无 batch 单条 start 保持旧行为', () => {
  it('正常结算一次 Impact', () => {
    const orch = makeOrchestrator(lightSnapshot, bodyOnly);
    const router = makeRouter(orch, 1);
    const aBody = findParts(orch.vehicleA, 'body')[0]!;
    const bBody = findParts(orch.vehicleB, 'body')[0]!;
    const hpABefore = orch.vehicleA.hp;
    const hpBBefore = orch.vehicleB.hp;

    // 无 batch 的单条 start（relVel=5）
    router.handleContact(makeStart(aBody, bBody, 5.0));

    // 旧行为：结算一次，damage=(5-1)*0.5=2，双方各半 1.0
    const expectedEach = ((5 - 1) * 0.5) / 2;
    expect(orch.vehicleA.hp).toBeCloseTo(hpABefore - expectedEach, 5);
    expect(orch.vehicleB.hp).toBeCloseTo(hpBBefore - expectedEach, 5);
    expect(router.debug.lastImpact?.relativeVelocity).toBeCloseTo(5.0, 5);
  });
});

describe('F-02C-A2R · 回归：中断旧批不污染新批', () => {
  it('旧批 relativeVelocity=100 被丢弃，只按新批 4 结算一次', () => {
    const orch = makeOrchestrator(lightSnapshot, bodyOnly);
    const router = makeRouter(orch, 1);
    const aBody = findParts(orch.vehicleA, 'body')[0]!;
    const bBody = findParts(orch.vehicleB, 'body')[0]!;
    const hpABefore = orch.vehicleA.hp;
    const hpBBefore = orch.vehicleB.hp;

    // 旧批第一条：timestamp=1000, index=0, size=2, relVel=100（不投递 index=1，批次未完成）
    router.handleContact(makeStart(aBody, bBody, 100, { timestamp: 1000, index: 0, size: 2 }));

    // 完整新批：timestamp=2000, index=0, size=1, relVel=4（index=0 必须无条件丢弃旧 buffer）
    router.handleContact(makeStart(aBody, bBody, 4, { timestamp: 2000, index: 0, size: 1 }));

    // 只按新批 relVel=4 结算一次：damage=(4-1)*0.5=1.5，双方各半 0.75
    const expectedEach = ((4 - 1) * 0.5) / 2;
    expect(orch.vehicleA.hp).toBeCloseTo(hpABefore - expectedEach, 5);
    expect(orch.vehicleB.hp).toBeCloseTo(hpBBefore - expectedEach, 5);
    // 若旧批污染：会按 relVel=100 结算（damage=(100-1)*0.5=49.5，各半 24.75）
    expect(orch.vehicleA.hp).not.toBeCloseTo(hpABefore - ((100 - 1) * 0.5) / 2, 5);
    expect(router.debug.lastImpact?.relativeVelocity).toBeCloseTo(4, 5);
    expect(router.debug.lastImpact?.relativeVelocity).not.toBe(100);
  });
});
