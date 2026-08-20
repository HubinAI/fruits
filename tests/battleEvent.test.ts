/**
 * Queue W1-EV-1｜Battle Event 正式结构 targeted test
 *
 * 覆盖 W1-EV-1 验收：
 * 1. DamageEvent 原数据完整（type:'damage' + 现有 CombatEvent 全部字段）；
 * 2. Cannon 每真实发射一次对应一次 weaponFire（onFire 在真正创建 projectile 后回调）；
 * 3. Death 只出现一次（HP 首次 >0 → <=0；之后扣血不再发）；
 * 4. 类型谓词正确判别（Renderer 消费侧不允许自行猜 death/fire——必须按 type 判别）。
 */
import { describe, it, expect } from 'vitest';
import { CombatEventBus, isDamageEvent, isDeathEvent, isWeaponFireEvent } from '../src/battle/combatEvents';
import { DamageResolver } from '../src/battle/damageResolver';
import { CannonBehavior } from '../src/battle/cannonBehavior';
import type { CombatVehicleState, CombatPartState, CombatWheelState } from '../src/battle/combatVehicle';
import { createRegistry } from '../src/core/content';
import type { FunctionalPartDef } from '../src/core/types';
import { resolveSnapshot } from '../src/core/buildSnapshot';
import { PlanckWorld } from '../src/physics/planckWorld';
import {
  createPlanckVehicle,
  settlePlanckVehicleToRestPose,
} from '../src/battle/planckVehicleAssembly';

const registry = createRegistry();

/** 最小 CombatVehicleState（DamageResolver 契约层 stub） */
function vehicleState(team: 'A' | 'B', hp: number): CombatVehicleState {
  return {
    id: team,
    team,
    hp,
    wheels: [] as readonly CombatWheelState[],
    parts: [] as readonly CombatPartState[],
  };
}

describe('W1-EV-1 Battle Event 结构', () => {
  it('1. DamageEvent 原数据完整：type=damage + 全部原字段', () => {
    const bus = new CombatEventBus();
    const resolver = new DamageResolver(bus);
    const target = vehicleState('B', 1000);
    const received: unknown[] = [];
    bus.subscribe((e) => received.push(e));

    resolver.applyDamage(
      target,
      {
        source: 'A',
        target: 'B',
        damageSource: 'weapon',
        partId: 'ramHead',
        behavior: 'ram',
        contactPoint: { x: 500, y: 600 },
        contactNormal: { x: 1, y: 0 },
        relativeVelocity: 2,
        damage: 80,
      },
      1234,
    );

    expect(received.length).toBe(1); // 未死亡：只发 damage
    const ev = received[0];
    expect(isDamageEvent(ev as never)).toBe(true);
    const d = ev as Extract<typeof ev, { type: 'damage' }>;
    expect(d.type).toBe('damage');
    expect(d.source).toBe('A');
    expect(d.target).toBe('B');
    expect(d.damageSource).toBe('weapon');
    expect(d.partId).toBe('ramHead');
    expect(d.behavior).toBe('ram');
    expect(d.contactPoint).toEqual({ x: 500, y: 600 });
    expect(d.contactNormal).toEqual({ x: 1, y: 0 });
    expect(d.relativeVelocity).toBe(2);
    expect(d.damage).toBe(80);
    expect(d.hpBefore).toBe(1000);
    expect(d.hpAfter).toBe(920);
    expect(d.timestamp).toBe(1234);
  });

  it('2. Cannon 每真实发射一次对应一次 weaponFire（onFire 在创建 projectile 后回调）', () => {
    const world = new PlanckWorld({ x: 0, y: 10 });
    const ground = world.createStaticGround(0, 700, 4000, 80);
    world.setOwnerTag(ground, { kind: 'ground' });
    const v = createPlanckVehicle(
      world,
      resolveSnapshot(
        {
          id: 'cannonCar',
          bodyDefId: 'boxBody',
          quality: 1,
          movements: [
            { hardpointId: 'rear', defId: 'wheelStd' },
            { hardpointId: 'front', defId: 'wheelStd' },
          ],
          functionals: [{ hardpointId: 'front', defId: 'cannon' }],
        },
        registry,
      ),
      'A',
      { x: 400, y: 640 },
      1,
    );
    settlePlanckVehicleToRestPose(world, v, ground);
    const part = v.parts.find((p) => p.def.behavior === 'cannon')!;

    const fires: Array<{ team: string; partId: string; behavior: string }> = [];
    const behavior = new CannonBehavior(part, (e) => {
      fires.push({ team: e.team, partId: e.partId, behavior: e.behavior });
    });

    // 跑足够步数（冷却 1000ms ≈ 60 fixed steps → 约 2 次发射）
    let firedCount = 0;
    for (let i = 0; i < 121; i++) {
      const r = behavior.stepFixed(world, v, part);
      if (r.fired) firedCount++;
    }
    // 每次真实发射（fired=true）→ 恰好一次 weaponFire
    expect(firedCount).toBeGreaterThanOrEqual(2);
    expect(fires.length).toBe(firedCount);
    for (const f of fires) {
      expect(f.team).toBe('A');
      expect(f.partId).toBe('part:front');
      expect(f.behavior).toBe('cannon');
    }
  });

  it('3. Death 只出现一次：HP 首次 >0 → <=0 发一次；之后扣血不再发', () => {
    const bus = new CombatEventBus();
    const resolver = new DamageResolver(bus);
    const target = vehicleState('B', 100);
    const deaths: unknown[] = [];
    const damages: unknown[] = [];
    bus.subscribe((e) => {
      if (e.type === 'death') deaths.push(e);
      else if (e.type === 'damage') damages.push(e);
    });

    // 扣 60 → hp 40（未死亡）
    resolver.applyDamage(target, {
      source: 'A', target: 'B', damageSource: 'weapon', contactPoint: { x: 0, y: 0 },
      contactNormal: { x: 1, y: 0 }, relativeVelocity: 2, damage: 60,
    }, 1);
    expect(deaths.length).toBe(0);
    // 扣 60 → hp 0（首次跨零 → death 恰一次）
    resolver.applyDamage(target, {
      source: 'A', target: 'B', damageSource: 'weapon', contactPoint: { x: 0, y: 0 },
      contactNormal: { x: 1, y: 0 }, relativeVelocity: 2, damage: 60,
    }, 2);
    expect(deaths.length).toBe(1);
    const death = deaths[0] as { type: 'death'; team: string; sourceTeam: string; damageSource: string; timestamp: number };
    expect(death.team).toBe('B');
    expect(death.sourceTeam).toBe('A');
    expect(death.damageSource).toBe('weapon');
    expect(death.timestamp).toBe(2);
    // 再扣血 → hp 仍 0，不再发 death
    resolver.applyDamage(target, {
      source: 'A', target: 'B', damageSource: 'impact', contactPoint: { x: 0, y: 0 },
      contactNormal: { x: 1, y: 0 }, relativeVelocity: 2, damage: 30,
    }, 3);
    expect(deaths.length).toBe(1);
    expect(damages.length).toBe(3); // 每次扣血都有 damage 事件
  });

  it('4. 类型谓词正确判别（消费侧按 type 区分，不自行猜）', () => {
    const damage = { type: 'damage' as const, source: 'A', target: 'B', damageSource: 'weapon' as const, partId: 'p', contactPoint: { x: 0, y: 0 }, contactNormal: { x: 1, y: 0 }, relativeVelocity: 1, damage: 10, hpBefore: 100, hpAfter: 90, timestamp: 0 };
    const fire = { type: 'weaponFire' as const, team: 'A' as const, partId: 'part:front', behavior: 'cannon', worldPosition: { x: 1, y: 2 }, worldDirection: { x: 1, y: 0 }, timestamp: 0 };
    const death = { type: 'death' as const, team: 'B' as const, sourceTeam: 'A' as const, damageSource: 'weapon' as const, timestamp: 0 };
    expect(isDamageEvent(damage)).toBe(true);
    expect(isDamageEvent(fire)).toBe(false);
    expect(isDamageEvent(death)).toBe(false);
    expect(isWeaponFireEvent(fire)).toBe(true);
    expect(isWeaponFireEvent(damage)).toBe(false);
    expect(isDeathEvent(death)).toBe(true);
    expect(isDeathEvent(damage)).toBe(false);
  });
});
