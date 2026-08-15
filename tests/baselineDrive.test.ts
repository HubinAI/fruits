import { describe, it, expect } from 'vitest';
import { createRegistry } from '../src/core/content';
import { resolveSnapshot } from '../src/core/buildSnapshot';
import { PhysWorld, createBox, Category } from '../src/physics/adapter';
import { createVehicle } from '../src/battle/vehicleAssembly';
import { driveVehicle } from '../src/battle/movement';
import { getPreset } from '../src/lab/presets';

const registry = createRegistry();
const DT = 1000 / 60;

/** 创建单辆车 + 地面，返回 vehicle 与 world */
function setupSingle(presetId: string, x = 600, y = 650): { world: PhysWorld; v: ReturnType<typeof createVehicle> } {
  const world = new PhysWorld();
  const ground = createBox(800, 1150, 2400, 900, 0, {
    filter: { category: Category.GROUND, mask: Category.VEHICLE_A | Category.VEHICLE_B },
    friction: 1,
  });
  ground.isStatic = true;
  world.add(ground);
  const v = createVehicle(
    world,
    resolveSnapshot(getPreset(presetId)!.build(), registry),
    'A',
    { x, y },
    0,
  );
  return { world, v };
}

/** 手动更新 grounded 状态（模拟 ContactRouter 的 wheel↔ground 检测） */
function updateGrounded(v: ReturnType<typeof createVehicle>, groundY = 700): void {
  for (const w of v.wheels) {
    const bottom = w.body.position.y + w.def.radius;
    w.grounded = bottom >= groundY - 1;
  }
}

describe('Baseline Drive Stability', () => {
  it('标准双轮车无敌人驱动 5 秒，不出现大幅抬头/翻转', () => {
    const { world, v } = setupSingle('lightVehicle');
    let maxAbsAngle = 0;
    for (let i = 0; i < 300; i++) {
      world.step(DT);
      updateGrounded(v);
      driveVehicle(v, DT, 1);
      maxAbsAngle = Math.max(maxAbsAngle, Math.abs(v.body.angle));
    }
    // 前进距离应明显（车真的在走，5 秒约前进 200px）
    expect(v.body.position.x).toBeGreaterThan(700);
    // 5 秒内姿态稳定，不出现大幅抬头（wheelie）/ 翻转（阈值 ~11.5°）
    expect(maxAbsAngle).toBeLessThan(0.2);
  });

  it('全轮腾空时驱动力为 0（不产生凭空牵引）', () => {
    const { world, v } = setupSingle('lightVehicle', 600, 200); // 空中 spawn
    const startX = v.body.position.x;
    for (let i = 0; i < 20; i++) {
      world.step(DT);
      updateGrounded(v);
      driveVehicle(v, DT, 1);
    }
    // 空中无接地轮，水平位移应极小（仅重力下落，无水平牵引）
    expect(Math.abs(v.body.position.x - startX)).toBeLessThan(2);
  });
});

describe('Scenario C Reset 姿态稳定性', () => {
  function settleAngle(presetId: string): number {
    const { world, v } = setupSingle(presetId);
    for (let i = 0; i < 180; i++) world.step(DT);
    return v.body.angle;
  }

  it('同一 Build 多次重建，落地姿态大体一致（Reset 稳定 + 轮径 override 生效）', () => {
    // 轮径 override 生效（几何前提：前后轮底部高度差 = 轮径差 → 落地倾角来源）
    const { v } = setupSingle('noseDown');
    const rear = v.wheels.find((w) => w.id === 'rear')!;
    const front = v.wheels.find((w) => w.id === 'front')!;
    expect(rear.def.radius).toBe(24);
    expect(front.def.radius).toBe(12);

    // 多次重建落地，中位数姿态稳定（不翻车），方向保留（noseDown 更前倾）
    const down = Array.from({ length: 6 }, () => settleAngle('noseDown')).sort((a, b) => a - b);
    const up = Array.from({ length: 6 }, () => settleAngle('noseUp')).sort((a, b) => a - b);
    // 中位数姿态稳定（接近水平，不翻车）
    expect(Math.abs(down[3])).toBeLessThan(0.3);
    expect(Math.abs(up[3])).toBeLessThan(0.3);
    // noseDown（前小后大）比 noseUp（前大后小）更前倾（方向保留）
    expect(down[3]).toBeGreaterThan(up[3]);
  });
});
