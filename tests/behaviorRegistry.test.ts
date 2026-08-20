/**
 * Queue W1-BH-1｜Generic Behavior Runtime Registry targeted test
 *
 * 覆盖 W1-BH-1 验收：
 * 1. 注册表含 cannon / hammer / pushRod；未知 behavior → undefined（不报错）；
 * 2. factory 创建统一 PartBehaviorRuntime；cannon runtime 真正驱动发射
 *    （beforePhysicsStep → projectile 出现 → getRenderProjectiles 贡献 1 个）；
 * 3. 生命周期差异正确：cannon 有 afterPhysicsStep / destroyOutOfBoundsProjectiles /
 *    getRenderProjectiles；hammer / pushRod 无 projectile 相关能力（undefined）。
 */
import { describe, it, expect } from 'vitest';
import { createRegistry } from '../src/core/content';
import { resolveSnapshot } from '../src/core/buildSnapshot';
import { PlanckWorld } from '../src/physics/planckWorld';
import {
  createPlanckVehicle,
  settlePlanckVehicleToRestPose,
} from '../src/battle/planckVehicleAssembly';
import { getBehaviorFactory, registeredBehaviorIds } from '../src/battle/behaviorRegistry';
import type { PartBehaviorRuntime } from '../src/battle/behaviorRuntime';
import type { BuildSnapshot } from '../src/core/types';

const registry = createRegistry();

function makeVehicle(partDefId: string) {
  const world = new PlanckWorld({ x: 0, y: 10 });
  const ground = world.createStaticGround(0, 700, 4000, 80);
  world.setOwnerTag(ground, { kind: 'ground' });
  const build: BuildSnapshot = {
    id: 'car',
    bodyDefId: 'boxBody',
    quality: 1,
    movements: [
      { hardpointId: 'rear', defId: 'wheelStd' },
      { hardpointId: 'front', defId: 'wheelStd' },
    ],
    functionals: [{ hardpointId: 'front', defId: partDefId }],
  };
  const v = createPlanckVehicle(world, resolveSnapshot(build, registry), 'A', { x: 400, y: 640 }, 1);
  settlePlanckVehicleToRestPose(world, v, ground);
  return { world, vehicle: v, part: v.parts[0]! };
}

function makeRuntime(behaviorId: string): {
  runtime: PartBehaviorRuntime;
  world: PlanckWorld;
} {
  const { world, vehicle, part } = makeVehicle(
    behaviorId === 'cannon' ? 'cannon' : behaviorId === 'hammer' ? 'hammer' : 'pushRod',
  );
  const factory = getBehaviorFactory(behaviorId)!;
  const runtime = factory({ vehicle, part, emit: () => {} });
  return { runtime, world };
}

describe('W1-BH-1 Behavior Registry', () => {
  it('1. 注册表含 cannon/hammer/pushRod；未知 behavior → undefined', () => {
    expect(registeredBehaviorIds().sort()).toEqual(['cannon', 'hammer', 'pushRod']);
    expect(getBehaviorFactory('cannon')).toBeDefined();
    expect(getBehaviorFactory('hammer')).toBeDefined();
    expect(getBehaviorFactory('pushRod')).toBeDefined();
    expect(getBehaviorFactory('ram')).toBeUndefined(); // 未注册（Weld-only）
    expect(getBehaviorFactory('noSuch')).toBeUndefined();
  });

  it('2. cannon runtime：beforePhysicsStep 真正发射 → projectile 渲染贡献 1 个', () => {
    const { runtime, world } = makeRuntime('cannon');
    // 首个 fixed step 就绪即发射
    runtime.beforePhysicsStep(world, 0);
    const shots = runtime.getRenderProjectiles!(world);
    expect(shots.length).toBe(1);
    expect(shots[0]!.team).toBe('A');
    expect(shots[0]!.radius).toBeGreaterThan(0);
  });

  it('3. 生命周期差异：cannon 有 projectile 能力；hammer/pushRod 无', () => {
    const c = makeRuntime('cannon');
    expect(typeof c.runtime.afterPhysicsStep).toBe('function');
    expect(typeof c.runtime.destroyOutOfBoundsProjectiles).toBe('function');
    expect(typeof c.runtime.getRenderProjectiles).toBe('function');

    for (const id of ['hammer', 'pushRod'] as const) {
      const r = makeRuntime(id);
      expect(r.runtime.afterPhysicsStep).toBeUndefined();
      expect(r.runtime.destroyOutOfBoundsProjectiles).toBeUndefined();
      expect(r.runtime.getRenderProjectiles).toBeUndefined();
      // 状态机仍可驱动（不抛错）
      expect(() => r.runtime.beforePhysicsStep(r.world, 0)).not.toThrow();
    }
  });
});
