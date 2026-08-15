import { describe, it, expect } from 'vitest';
import { createRegistry } from '../src/core/content';
import { BattleOrchestrator } from '../src/battle/battleOrchestrator';
import type { ContactEvent } from '../src/physics/adapter';
import { getPreset } from '../src/lab/presets';

const registry = createRegistry();
const light = getPreset('lightVehicle')!.build();

function makeOrch(): BattleOrchestrator {
  return new BattleOrchestrator(light, light, registry, { autoDrive: false });
}

function contactEv(orch: BattleOrchestrator, phase: ContactEvent['phase'], relV: number): ContactEvent {
  return {
    bodyA: orch.vehicleA.body,
    bodyB: orch.vehicleB.body,
    contactPoint: { x: 800, y: 650 },
    normal: { x: -1, y: 0 },
    relativeVelocity: relV,
    phase,
  };
}

describe('Impact 重复触发保护', () => {
  it('低速持续挤压不掉血', () => {
    const orch = makeOrch();
    const hp0 = orch.vehicleB.hp;
    orch.router.handleContact(contactEv(orch, 'start', 1)); // 低于 threshold=6
    expect(orch.vehicleB.hp).toBe(hp0);
  });

  it('达到阈值才产生有限 Impact Damage', () => {
    const orch = makeOrch();
    const hp0 = orch.vehicleB.hp;
    orch.router.handleContact(contactEv(orch, 'start', 20));
    expect(orch.vehicleB.hp).toBeLessThan(hp0);
  });

  it('持续贴合（active）不每帧重复扣血', () => {
    const orch = makeOrch();
    orch.router.handleContact(contactEv(orch, 'start', 20));
    const hpAfterStart = orch.vehicleB.hp;
    for (let i = 0; i < 10; i++) {
      orch.router.handleContact(contactEv(orch, 'active', 20));
    }
    expect(orch.vehicleB.hp).toBe(hpAfterStart);
  });

  it('分离后再次高速接触，重新触发 Impact', () => {
    const orch = makeOrch();
    orch.router.handleContact(contactEv(orch, 'start', 20));
    const hp1 = orch.vehicleB.hp;
    // 模拟分离 → 再次撞击（新的 collisionStart）
    orch.router.handleContact(contactEv(orch, 'start', 20));
    expect(orch.vehicleB.hp).toBeLessThan(hp1);
  });
});
