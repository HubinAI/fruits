import { describe, it, expect } from 'vitest';
import { createRegistry } from '../src/core/content';
import { resolveSnapshot } from '../src/core/buildSnapshot';
import { PhysWorld } from '../src/physics/adapter';
import { createVehicle } from '../src/battle/vehicleAssembly';
import { getPreset } from '../src/lab/presets';

const registry = createRegistry();

describe('Mass / COM 聚合', () => {
  it('totalMass 聚合 = body + wheels + parts', () => {
    const build = getPreset('lightVehicle')!.build();
    const resolved = resolveSnapshot(build, registry);
    // boxBody baseMass 50 + 2 wheel(10) + ramHead(30) = 100
    expect(resolved.totalMass).toBe(100);
  });

  it('frontHeavy 与 rearHeavy 总质量相同', () => {
    const f = resolveSnapshot(getPreset('frontHeavy')!.build(), registry);
    const r = resolveSnapshot(getPreset('rearHeavy')!.build(), registry);
    expect(f.totalMass).toBe(r.totalMass);
  });

  it('frontHeavy 的 COM 明显前移，rearHeavy 明显后移', () => {
    const world = new PhysWorld();
    const fv = createVehicle(
      world,
      resolveSnapshot(getPreset('frontHeavy')!.build(), registry),
      'A',
      { x: 0, y: 0 },
      1,
    );
    const rv = createVehicle(
      world,
      resolveSnapshot(getPreset('rearHeavy')!.build(), registry),
      'B',
      { x: 0, y: 0 },
      1,
    );
    // frontHeavy：ramHead(+60, 30) + testMass(+40, 60)，质量集中前部 → COM x > 0
    // rearHeavy：ramHead(+60, 30) + testMass(-60, 60)，后部有质量 → COM x 更小
    expect(fv.com.x).toBeGreaterThan(rv.com.x);
  });

  it('部件质量与位置真实参与 COM（非仅总重量）', () => {
    // 相同 totalMass，但质量位置不同 → COM 不同
    const front = createVehicle(
      new PhysWorld(),
      resolveSnapshot(getPreset('frontHeavy')!.build(), registry),
      'A',
      { x: 0, y: 0 },
      1,
    );
    const rear = createVehicle(
      new PhysWorld(),
      resolveSnapshot(getPreset('rearHeavy')!.build(), registry),
      'B',
      { x: 0, y: 0 },
      1,
    );
    expect(front.totalMass).toBe(rear.totalMass);
    expect(front.com.x).not.toBeCloseTo(rear.com.x, 1);
  });
});
