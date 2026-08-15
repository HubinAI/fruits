/**
 * Vehicle Facing 装配正确性测试。
 *
 * 验证 01B 的「镜像朝向」实现：facing=-1（朝左）的车，wheel 位置必须与
 * facing=1（朝右）镜像对称，且 constraint 挂点与 wheel 实际位置一致
 * （否则软约束会把 wheel 拉回未镜像的错误侧）。
 */
import { describe, it, expect } from 'vitest';
import { createRegistry } from '../src/core/content';
import { resolveSnapshot } from '../src/core/buildSnapshot';
import { PhysWorld, createBox, Category } from '../src/physics/adapter';
import { createVehicle, settleVehicleToRestPose } from '../src/battle/vehicleAssembly';
import { getPreset } from '../src/lab/presets';

const registry = createRegistry();
const DT = 1000 / 60;
const GROUND_Y = 700;

function wheelOffsets(facing: 1 | -1): { rearDx: number; frontDx: number } {
  const world = new PhysWorld();
  const ground = createBox(800, 1150, 2400, 900, 0, {
    filter: { category: Category.GROUND, mask: Category.VEHICLE_A | Category.VEHICLE_B },
    friction: 1,
  });
  ground.isStatic = true;
  world.add(ground);
  const v = createVehicle(
    world,
    resolveSnapshot(getPreset('lightVehicle')!.build(), registry),
    'A',
    { x: 600, y: 650 },
    facing,
  );
  settleVehicleToRestPose(v, GROUND_Y);
  for (let i = 0; i < 30; i++) world.step(DT);
  const rear = v.wheels.find((w) => w.id === 'rear')!;
  const front = v.wheels.find((w) => w.id === 'front')!;
  return {
    rearDx: rear.body.position.x - v.body.position.x,
    frontDx: front.body.position.x - v.body.position.x,
  };
}

describe('Vehicle Facing 镜像装配', () => {
  it('facing=-1 的 wheel 位置与 facing=1 镜像对称', () => {
    const right = wheelOffsets(1);
    const left = wheelOffsets(-1);
    // rear 在 body 的另一侧：left.rearDx ≈ -right.rearDx
    expect(Math.abs(left.rearDx + right.rearDx)).toBeLessThan(10);
    expect(Math.abs(left.frontDx + right.frontDx)).toBeLessThan(10);
    // 且 rear/front 确实分居 body 两侧（不是都在同侧）
    expect(right.rearDx).toBeLessThan(0);
    expect(right.frontDx).toBeGreaterThan(0);
    expect(left.rearDx).toBeGreaterThan(0);
    expect(left.frontDx).toBeLessThan(0);
  });
});
