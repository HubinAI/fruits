import { describe, it, expect } from 'vitest';
import { createRegistry } from '../src/core/content';
import { resolveSnapshot } from '../src/core/buildSnapshot';
import { PhysWorld, createBox, Category } from '../src/physics/adapter';
import { BattleOrchestrator } from '../src/battle/battleOrchestrator';
import { createVehicle } from '../src/battle/vehicleAssembly';
import { getPreset } from '../src/lab/presets';
import { getScenario } from '../src/lab/scenarios';
import type { BuildSnapshot } from '../src/core/types';

const registry = createRegistry();
const DT = 1000 / 60;

/** 运行一次对撞，返回两车位移与最大角速度 */
function runCollision(
  buildA: BuildSnapshot,
  buildB: BuildSnapshot,
  steps = 400,
): { dxA: number; dxB: number; maxAngVel: number } {
  const orch = new BattleOrchestrator(buildA, buildB, registry, {
    autoDrive: true,
    spawnA: { x: 450, y: 650, facing: 1 },
    spawnB: { x: 1150, y: 650, facing: -1 },
  });
  const startA = orch.vehicleA.body.position.x;
  const startB = orch.vehicleB.body.position.x;
  let maxAngVel = 0;
  for (let i = 0; i < steps; i++) {
    orch.step(DT);
    maxAngVel = Math.max(
      maxAngVel,
      Math.abs(orch.vehicleA.body.angularVelocity),
      Math.abs(orch.vehicleB.body.angularVelocity),
    );
  }
  return {
    dxA: Math.abs(orch.vehicleA.body.position.x - startA),
    dxB: Math.abs(orch.vehicleB.body.position.x - startB),
    maxAngVel,
  };
}

describe('Scenario 确定性基础检查', () => {
  it('Scenario A：轻车位移明显大于重车（动量守恒），结果性质可复现', () => {
    const light = getPreset('lightVehicle')!.build();
    const heavy = getPreset('heavyVehicle')!.build();
    const r1 = runCollision(light, heavy);
    const r2 = runCollision(light, heavy);
    // 两次运行轻车位移都明显大于重车
    expect(r1.dxA).toBeGreaterThan(r1.dxB * 1.2);
    expect(r2.dxA).toBeGreaterThan(r2.dxB * 1.2);
  });

  it('Scenario B：偏心碰撞（高车身撞低车身上部）产生明显 Z 轴角速度', () => {
    // 直接用 Lab 真实 Scenario（12 vs 26 轮径，B 车身高撞 A 车身上部）
    const sc = getScenario('B')!;
    const orch = new BattleOrchestrator(sc.buildA, sc.buildB, registry, sc.config);
    let maxAngVel = 0;
    for (let i = 0; i < 400; i++) {
      orch.step(DT);
      maxAngVel = Math.max(
        maxAngVel,
        Math.abs(orch.vehicleA.body.angularVelocity),
        Math.abs(orch.vehicleB.body.angularVelocity),
      );
    }
    // 偏心碰撞产生可感知的旋转（gravity 标定后实测 ~0.010 rad/step ≈ 34°/s，阈值取 > ~27°/s 留余量）
    expect(maxAngVel).toBeGreaterThan(0.008);
  });

  it('Scenario C：轮径 override 生效，前后轮底部高度差产生倾角（几何）', () => {
    // 几何验证：轮径 override 生效，前后轮底部高度差 = 轮径差（落地倾角的几何来源）
    const world = new PhysWorld();
    const ground = createBox(800, 1150, 2000, 900, 0, {
      filter: { category: Category.GROUND, mask: Category.VEHICLE_A | Category.VEHICLE_B },
      friction: 1,
    });
    ground.isStatic = true;
    world.add(ground);
    const v = createVehicle(
      world,
      resolveSnapshot(getPreset('noseDown')!.build(), registry),
      'A',
      { x: 600, y: 650 },
      1,
    );
    const rear = v.wheels.find((w) => w.id === 'rear')!;
    const front = v.wheels.find((w) => w.id === 'front')!;
    expect(rear.def.radius).toBe(24); // 后大
    expect(front.def.radius).toBe(12); // 前小
    // 前后轮底部高度差 = 轮径差 12px → 车落地后前倾（倾角 = atan(12/轴距)）
    expect(rear.def.radius - front.def.radius).toBe(12);
  });

  it('Scenario E：前重 / 后重改变 COM 与 Inertia（总质量相同）', () => {
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
    expect(front.com.x).toBeGreaterThan(rear.com.x); // 前重 COM 靠前
    expect(front.inertia).not.toBeCloseTo(rear.inertia, 2); // Inertia 对应差异
  });
});
