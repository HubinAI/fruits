import { describe, it, expect } from 'vitest';
import type { CombatVehicleState } from '../src/battle/combatVehicle';
// Matter 构造（验证兼容性用）
import { createVehicle } from '../src/battle/vehicleAssembly';
import { PhysWorld } from '../src/physics/adapter';
// Planck 构造（验证兼容性用）
import { PlanckWorld } from '../src/physics/planckWorld';
import { createPlanckVehicle } from '../src/battle/planckVehicleAssembly';
// DamageResolver 引擎中立验证
import { DamageResolver } from '../src/battle/damageResolver';
import { CombatEventBus, type DamageRequest } from '../src/battle/combatEvents';
// 内容/解析
import { createRegistry } from '../src/core/content';
import { resolveSnapshot } from '../src/core/buildSnapshot';
import { getPreset } from '../src/lab/presets';

const registry = createRegistry();

/** 构造 Matter Vehicle（lightVehicle：boxBody + 双轮 + ram） */
function makeMatterVehicle() {
  const world = new PhysWorld({ x: 0, y: 0, scale: 0 });
  const resolved = resolveSnapshot(getPreset('lightVehicle')!.build(), registry);
  return createVehicle(world, resolved, 'A', { x: 0, y: 0 });
}

/** 构造 Planck Vehicle（lightVehicle：boxBody + 双轮 + ram） */
function makePlanckVehicle() {
  const world = new PlanckWorld();
  const resolved = resolveSnapshot(getPreset('lightVehicle')!.build(), registry);
  return createPlanckVehicle(world, resolved, 'A', { x: 0, y: 0 });
}

describe('F-02M-B9A · CombatVehicleState 引擎中立契约', () => {
  it('类型级：Matter Vehicle 与 PlanckVehicle 均兼容 CombatVehicleState（赋值证明）', () => {
    const matterVehicle = makeMatterVehicle();
    const planckVehicle = makePlanckVehicle();

    // 编译期结构类型兼容证明（若有 as any/as unknown 则本测试无意义）
    const v1: CombatVehicleState = matterVehicle;
    const v2: CombatVehicleState = planckVehicle;

    // 运行时确认字段齐全
    expect(v1.id).toBe('lightVehicle');
    expect(v2.id).toBe('lightVehicle');
    expect(v1.team).toBe('A');
    expect(v2.team).toBe('A');
    expect(v1.wheels.length).toBeGreaterThan(0);
    expect(v2.wheels.length).toBeGreaterThan(0);
    expect(v1.parts.length).toBeGreaterThan(0);
    expect(v2.parts.length).toBeGreaterThan(0);
    expect(v1.maxHp).toBe(1000);
    expect(v2.maxHp).toBe(1000);

    // wheels 元素可读 id/grounded；parts 元素可读 id/def
    expect(v1.wheels[0]!.id).toBeTruthy();
    expect(v2.wheels[0]!.id).toBeTruthy();
    expect(v1.parts[0]!.def.category).toBe('weapon');
    expect(v2.parts[0]!.def.id).toBe('ramHead');
  });

  it('运行时：hp 与 wheel.grounded 可写（两引擎一致）', () => {
    const matterVehicle = makeMatterVehicle();
    const planckVehicle = makePlanckVehicle();

    // hp 可写（Damage Resolver 语义）
    matterVehicle.hp = 500;
    planckVehicle.hp = 700;
    expect(matterVehicle.hp).toBe(500);
    expect(planckVehicle.hp).toBe(700);
    expect(matterVehicle.maxHp).toBe(1000);
    expect(planckVehicle.maxHp).toBe(1000);

    // wheel.grounded 可写（Grounded 路由语义）
    matterVehicle.wheels[0]!.grounded = true;
    planckVehicle.wheels[0]!.grounded = true;
    expect(matterVehicle.wheels[0]!.grounded).toBe(true);
    expect(planckVehicle.wheels[0]!.grounded).toBe(true);

    // grounded 互不污染（两引擎独立实例）
    matterVehicle.wheels[1]!.grounded = false;
    expect(matterVehicle.wheels[1]!.grounded).toBe(false);
    expect(planckVehicle.wheels[1]!.grounded).toBe(false);
  });

  it('同一 DamageResolver 对 Matter/Planck 车辆均正确扣血（事件字段一致）', () => {
    const bus = new CombatEventBus();
    const resolver = new DamageResolver(bus);
    const received: number[] = [];
    bus.subscribe((ev) => received.push(ev.timestamp));

    // 相互独立的新鲜 fixture
    const matterVehicle = makeMatterVehicle();
    const planckVehicle = makePlanckVehicle();

    const req: DamageRequest = {
      source: 'B',
      target: 'A',
      damageSource: 'weapon',
      partId: 'part:front',
      behavior: 'ram',
      contactPoint: { x: 1, y: 2 },
      contactNormal: { x: 1, y: 0 },
      relativeVelocity: 1.5,
      damage: 80,
    };

    // 同一 resolver、同一请求，作用于两个引擎的车辆
    const evM = resolver.applyDamage(matterVehicle, req, 1234);
    const evP = resolver.applyDamage(planckVehicle, req, 5678);

    // HP 均正确修改（1000 - 80 = 920）
    expect(matterVehicle.hp).toBe(920);
    expect(planckVehicle.hp).toBe(920);

    // 事件字段与请求一致
    expect(evM.hpBefore).toBe(1000);
    expect(evM.hpAfter).toBe(920);
    expect(evM.timestamp).toBe(1234);
    expect(evM.damage).toBe(80);
    expect(evM.source).toBe('B');
    expect(evM.partId).toBe('part:front');
    expect(evP.hpBefore).toBe(1000);
    expect(evP.hpAfter).toBe(920);
    expect(evP.timestamp).toBe(5678);

    // 事件总线收到两次（各自 timestamp）
    expect(received).toEqual([1234, 5678]);
  });

  it('过量伤害将 HP 截断为 0（两引擎一致）', () => {
    const bus = new CombatEventBus();
    const resolver = new DamageResolver(bus);
    const matterVehicle = makeMatterVehicle();
    const planckVehicle = makePlanckVehicle();

    const req: DamageRequest = {
      source: 'B',
      target: 'A',
      damageSource: 'impact',
      contactPoint: { x: 0, y: 0 },
      contactNormal: { x: 1, y: 0 },
      relativeVelocity: 3,
      damage: 5000, // 过量
    };

    const evM = resolver.applyDamage(matterVehicle, req, 99);
    const evP = resolver.applyDamage(planckVehicle, req, 100);

    expect(matterVehicle.hp).toBe(0);
    expect(planckVehicle.hp).toBe(0);
    expect(evM.hpAfter).toBe(0);
    expect(evP.hpAfter).toBe(0);
    expect(evM.hpBefore).toBe(1000);
    expect(evP.hpBefore).toBe(1000);
  });
});
