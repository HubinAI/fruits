import { describe, it, expect } from 'vitest';
import { createRegistry } from '../src/core/content';
import { resolveSnapshot } from '../src/core/buildSnapshot';
import { PhysWorld, createBox, Category } from '../src/physics/adapter';
import { createVehicle, settleVehicleToRestPose } from '../src/battle/vehicleAssembly';
import { driveVehicle } from '../src/battle/movement';
import { getPreset } from '../src/lab/presets';

const registry = createRegistry();
const DT = 1000 / 60;
const GROUND_Y = 700;

/** 创建单辆车 + 地面，返回 vehicle 与 world。settle=false 用于空中出生。 */
function setupSingle(presetId: string, x = 600, y = 650, settle = true): { world: PhysWorld; v: ReturnType<typeof createVehicle> } {
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
    1,
  );
  if (settle) settleVehicleToRestPose(v, GROUND_Y);
  return { world, v };
}

/** 手动更新 grounded 状态（模拟 ContactRouter 的 wheel↔ground 检测） */
function updateGrounded(v: ReturnType<typeof createVehicle>, groundY = GROUND_Y): void {
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
    // 5 秒内姿态稳定，不出现大幅抬头（wheelie）/ 翻转（阈值 ~13°）
    expect(maxAbsAngle).toBeLessThan(0.23);
  });

  it('全轮腾空时驱动力为 0（不产生凭空牵引）', () => {
    const { world, v } = setupSingle('lightVehicle', 600, 200, false); // 空中 spawn，不沉降
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
  /** 初始静止姿态（settle 后、未 step）：由轮径差几何确定，确定性。 */
  function initialAngle(presetId: string): number {
    const { v } = setupSingle(presetId);
    return v.body.angle;
  }

  it('轮径 override 生效 + 初始姿态方向相反且明显不同 + 多次 Reset 无翻车', () => {
    // 轮径 override 生效（几何前提）
    const { v } = setupSingle('noseDown');
    const rear = v.wheels.find((w) => w.id === 'rear')!;
    const front = v.wheels.find((w) => w.id === 'front')!;
    expect(rear.def.radius).toBe(24);
    expect(front.def.radius).toBe(12);

    // 初始姿态：noseDown（前小后大）前倾（正角），noseUp（前大后小）后倾（负角）
    const d0 = initialAngle('noseDown');
    const u0 = initialAngle('noseUp');
    expect(d0).toBeGreaterThan(0.05);      // noseDown 前倾
    expect(u0).toBeLessThan(-0.05);        // noseUp 后倾
    expect(d0 - u0).toBeGreaterThan(0.15); // 两种组合明显不同（> ~8.6°）

    // 多次 Reset 后物理演化不翻车（|angle| 均 < ~29°）
    for (const presetId of ['noseDown', 'noseUp']) {
      for (let k = 0; k < 8; k++) {
        const { world, v: vv } = setupSingle(presetId);
        for (let i = 0; i < 180; i++) world.step(DT);
        expect(Math.abs(vv.body.angle)).toBeLessThan(0.5);
      }
    }
  });
});
