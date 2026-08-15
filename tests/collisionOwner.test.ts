import { describe, it, expect } from 'vitest';
import { createRegistry } from '../src/core/content';
import { resolveSnapshot } from '../src/core/buildSnapshot';
import { PhysWorld, Category } from '../src/physics/adapter';
import { createVehicle } from '../src/battle/vehicleAssembly';
import { getPreset } from '../src/lab/presets';

const registry = createRegistry();

describe('Collision Owner 过滤', () => {
  it('同车所有 body 使用相同负数 group（默认关闭普通 Collider 互撞）', () => {
    const world = new PhysWorld();
    const v = createVehicle(
      world,
      resolveSnapshot(getPreset('lightVehicle')!.build(), registry),
      'A',
      { x: 0, y: 0 },
      1,
    );
    const allBodies = [v.body, ...v.wheels.map((w) => w.body), ...v.parts.map((p) => p.body)];
    const groups = new Set(allBodies.map((b) => b.collisionFilter.group));
    // 同车所有 body 同 group，且为负数（永不互撞）
    expect(groups.size).toBe(1);
    const g = allBodies[0].collisionFilter.group;
    expect(g).toBeLessThan(0);
  });

  it('不同车使用不同负数 group 与不同 category', () => {
    const world = new PhysWorld();
    const va = createVehicle(
      world,
      resolveSnapshot(getPreset('lightVehicle')!.build(), registry),
      'A',
      { x: 0, y: 0 },
      1,
    );
    const vb = createVehicle(
      world,
      resolveSnapshot(getPreset('lightVehicle')!.build(), registry),
      'B',
      { x: 10, y: 0 },
      1,
    );
    expect(va.body.collisionFilter.group).not.toBe(vb.body.collisionFilter.group);
    expect(va.body.collisionFilter.category).toBe(Category.VEHICLE_A);
    expect(vb.body.collisionFilter.category).toBe(Category.VEHICLE_B);
  });

  it('A 车 mask 不含自身 VEHICLE_A，B 车 mask 不含自身 VEHICLE_B', () => {
    const world = new PhysWorld();
    const va = createVehicle(
      world,
      resolveSnapshot(getPreset('lightVehicle')!.build(), registry),
      'A',
      { x: 0, y: 0 },
      1,
    );
    const vb = createVehicle(
      world,
      resolveSnapshot(getPreset('lightVehicle')!.build(), registry),
      'B',
      { x: 10, y: 0 },
      1,
    );
    expect((va.body.collisionFilter.mask ?? 0) & Category.VEHICLE_A).toBe(0);
    expect((vb.body.collisionFilter.mask ?? 0) & Category.VEHICLE_B).toBe(0);
  });
});
