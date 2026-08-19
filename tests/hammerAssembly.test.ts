/**
 * Queue Q03-F2｜Hammer Content + Revolute Mount targeted test
 *
 * 覆盖 Q03-F2 验收：
 * 1. hammer Content：category='weapon'、behavior='hammer'、有 baseDamage、明显质量、
 *    长矩形 collider 且 pivot（body 原点）在矩形一端附近（质量中心远离 pivot）；
 * 2. Assembly：behavior==='hammer' 的 part 用 Revolute（pivot 与功能挂点真实重合、
 *    可自由绕 pivot 旋转）；其他 Functional Part（cannon / ram）仍为 Weld；
 * 3. 自身车体无同车 collider 卡死（Hammer 摆动扫过车身不推飞、step 无异常）。
 */
import { describe, it, expect } from 'vitest';
import { createRegistry } from '../src/core/content';
import type { BuildSnapshot, FunctionalPartDef } from '../src/core/types';
import { resolveSnapshot } from '../src/core/buildSnapshot';
import { PlanckWorld } from '../src/physics/planckWorld';
import {
  createPlanckVehicle,
  settlePlanckVehicleToRestPose,
  type PlanckVehicle,
} from '../src/battle/planckVehicleAssembly';

const registry = createRegistry();

function hammerBuild(): BuildSnapshot {
  return {
    id: 'hammerCar',
    bodyDefId: 'boxBody',
    quality: 1,
    movements: [
      { hardpointId: 'rear', defId: 'wheelStd' },
      { hardpointId: 'front', defId: 'wheelStd' },
    ],
    functionals: [{ hardpointId: 'front', defId: 'hammer' }],
  };
}

/** 真实 Planck 装配 + 贴地静置（地面带 OwnerTag，与正式 Arena 一致） */
function makeVehicle(build: BuildSnapshot = hammerBuild()): {
  world: PlanckWorld;
  v: PlanckVehicle;
} {
  const world = new PlanckWorld({ x: 0, y: 10 });
  const ground = world.createStaticGround(0, 700, 4000, 80);
  world.setOwnerTag(ground, { kind: 'ground' });
  const v = createPlanckVehicle(
    world,
    resolveSnapshot(build, registry),
    'A',
    { x: 400, y: 640 },
    1,
  );
  settlePlanckVehicleToRestPose(world, v, ground);
  return { world, v };
}

function hammerPart(v: PlanckVehicle) {
  const part = v.parts.find((p) => p.def.behavior === 'hammer');
  expect(part).toBeDefined();
  return part!;
}

describe('Q03-F2 Hammer Content + Revolute Mount', () => {
  it('hammer Content：weapon / behavior / baseDamage / 明显质量 / 长矩形远端质量', () => {
    const def = registry.functionals.get('hammer') as FunctionalPartDef;
    expect(def).toBeDefined();
    expect(def.category).toBe('weapon');
    expect(def.behavior).toBe('hammer');
    expect((def.behaviorParams as Record<string, unknown>).baseDamage).toBeGreaterThan(0);
    expect(def.mass).toBeGreaterThan(20); // 明显质量（ram 30 / cannon 20 之上）
    expect(def.collider.shape).toBe('box');
    const w = def.collider.width ?? 0;
    const h = def.collider.height ?? 0;
    expect(w).toBeGreaterThan(h); // 长矩形
    expect(w).toBeGreaterThanOrEqual(40);
    // pivot 在矩形一端附近：collider 中心明显前移（offset.x > 0 且接近柄长）
    expect(def.collider.offset.x).toBeGreaterThan(20);
    // 质量中心远离 pivot：collider 中心 = offset.x（> 20px）
  });

  it('Hammer 装配为 Revolute：pivot 与功能挂点真实重合，可自由绕 pivot 旋转', () => {
    const { world, v } = makeVehicle();
    const part = hammerPart(v);

    // pivot = 功能挂点世界位置：chassis 当前位置 + 硬点本地坐标（贴地静置后取真实 chassis）
    const chassis = world.getPosition(v.body);
    const hp = part.hardpoint.localPosition;
    const hpWorld = { x: chassis.x + hp.x, y: chassis.y + hp.y };
    const partPos = world.getPosition(part.body);
    expect(partPos.x).toBeCloseTo(hpWorld.x, 1);
    expect(partPos.y).toBeCloseTo(hpWorld.y, 1);

    // joint 是真实 Revolute（非 Weld）：getRevoluteAngle 可用且初始 0
    expect(world.getRevoluteAngle(part.joint)).toBeCloseTo(0, 6);

    // 自由旋转：直接给 hammer part 角速度 → 相对角变化（revolute 不约束角度）
    world.setAngularVelocity(part.body, 0.1);
    for (let i = 0; i < 30; i++) world.stepFixed(1);
    const a = world.getRevoluteAngle(part.joint);
    expect(a).toBeGreaterThan(0.5);
    // 旋转绕 pivot：part body 原点（pivot）基本不动（锤头扫动；chassis 反作用微动，容差 5px）
    const posAfter = world.getPosition(part.body);
    expect(Math.abs(posAfter.x - hpWorld.x)).toBeLessThan(5);
    expect(Math.abs(posAfter.y - hpWorld.y)).toBeLessThan(5);
    // 锤头（collider 中心 = part 原点 + offset 旋转）确实离开初始水平位置
    const headAngle = world.getAngle(part.body);
    expect(Math.abs(headAngle)).toBeGreaterThan(0.3);
  });

  it('同车无 collider 卡死：Hammer 摆动扫过车身，step 无异常且不推飞车身', () => {
    const { world, v } = makeVehicle();
    const part = hammerPart(v);
    const chassisX0 = world.getPosition(v.body).x;

    // 大角速度让锤头反复扫过车身区域（同车负 group：不产生同车接触）
    world.setAngularVelocity(part.body, 0.2);
    for (let i = 0; i < 120; i++) {
      expect(() => world.stepFixed(1)).not.toThrow();
    }
    // 锤仍在车上、joint 仍有效
    expect(world.getRevoluteAngle(part.joint)).not.toBe(Number.NaN);
    // 车体未被推飞（位移远小于锤长 60+ 的异常级，摩擦/重力稳定）
    const chassisX1 = world.getPosition(v.body).x;
    expect(Math.abs(chassisX1 - chassisX0)).toBeLessThan(20);
  });

  it('Cannon / Ram 仍为 Weld（非 Revolute）', () => {
    // cannon 车
    const cannonBuild: BuildSnapshot = {
      id: 'cannonCar',
      bodyDefId: 'wedgeBody',
      quality: 1,
      movements: [
        { hardpointId: 'rear', defId: 'wheelStd' },
        { hardpointId: 'front', defId: 'wheelStd' },
      ],
      functionals: [{ hardpointId: 'front', defId: 'cannon' }],
    };
    const { world: w1, v: v1 } = makeVehicle(cannonBuild);
    const cannonPart = v1.parts.find((p) => p.def.behavior === 'cannon')!;
    expect(() => w1.getRevoluteAngle(cannonPart.joint)).toThrow(); // Weld → 报错

    // ram 车
    const ramBuild: BuildSnapshot = {
      id: 'ramCar',
      bodyDefId: 'boxBody',
      quality: 1,
      movements: [
        { hardpointId: 'rear', defId: 'wheelStd' },
        { hardpointId: 'front', defId: 'wheelStd' },
      ],
      functionals: [{ hardpointId: 'front', defId: 'ramHead' }],
    };
    const { world: w2, v: v2 } = makeVehicle(ramBuild);
    const ramPart = v2.parts.find((p) => p.def.behavior === 'ram')!;
    expect(() => w2.getRevoluteAngle(ramPart.joint)).toThrow(); // Weld → 报错
  });
});
