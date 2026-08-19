/**
 * Queue Q05-F1｜Lift Roller Content + Revolute Mount targeted test
 *
 * 覆盖 Q05-F1 验收：
 * 1. liftRoller Content：category='gadget'、behavior='liftRoller'、无 baseDamage、
 *    真实 mass/energy、单 circle collider（pivot = circle center = part 原点，radius 明显）；
 * 2. Assembly：behavior==='hammer' || behavior==='liftRoller' → Revolute；
 *    pushRod → Prismatic；其他（ram / cannon）→ Weld；
 * 3. Lift Roller 可自由连续旋转（不设 Revolute limit：motor 持续驱动角度累计远超 2π）；
 * 4. 同车 Collider 不互卡（高速旋转 step 无异常、车体不被推飞）；
 * 5. Gadget 不具备 baseDamage。
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

function liftRollerBuild(): BuildSnapshot {
  return {
    id: 'liftRollerCar',
    bodyDefId: 'boxBody',
    quality: 1,
    movements: [
      { hardpointId: 'rear', defId: 'wheelStd' },
      { hardpointId: 'front', defId: 'wheelStd' },
    ],
    functionals: [{ hardpointId: 'front', defId: 'liftRoller' }],
  };
}

function makeVehicle(build: BuildSnapshot = liftRollerBuild()): {
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

function liftPart(v: PlanckVehicle) {
  const part = v.parts.find((p) => p.def.behavior === 'liftRoller');
  expect(part).toBeDefined();
  return part!;
}

describe('Q05-F1 Lift Roller Content + Revolute Mount', () => {
  it('liftRoller Content：gadget / liftRoller / 无 baseDamage / circle / pivot=center / 明显 radius', () => {
    const def = registry.functionals.get('liftRoller') as FunctionalPartDef;
    expect(def).toBeDefined();
    expect(def.category).toBe('gadget');
    expect(def.behavior).toBe('liftRoller');
    expect(def.behaviorParams).toBeUndefined(); // 无 baseDamage
    expect(def.mass).toBeGreaterThan(0);
    expect(def.energy).toBeGreaterThan(0);
    expect(def.collider.shape).toBe('circle');
    expect(def.collider.radius ?? 0).toBeGreaterThan(15); // 首版明显，不做小尺寸微调
    // pivot = circle center：offset 为 0
    expect(def.collider.offset.x).toBe(0);
    expect(def.collider.offset.y).toBe(0);
  });

  it('Revolute 装配：pivot 与 hardpoint 中心重合；可自由连续旋转（无 limit）', () => {
    const { world, v } = makeVehicle();
    const part = liftPart(v);
    const chassis = world.getPosition(v.body);
    const hp = part.hardpoint.localPosition;
    const hpWorld = { x: chassis.x + hp.x, y: chassis.y + hp.y };
    const partPos = world.getPosition(part.body);
    expect(partPos.x).toBeCloseTo(hpWorld.x, 1);
    expect(partPos.y).toBeCloseTo(hpWorld.y, 1);

    // joint 是真实 Revolute
    expect(world.getRevoluteAngle(part.joint)).toBeCloseTo(0, 6);

    // 连续旋转：motor 持续驱动，不设 limit → 角度累计远超 2π（多圈）
    world.setRevoluteMotor(part.joint, {
      enabled: true,
      speedRadPerStep: 0.15,
      maxTorqueNm: 200,
    });
    let totalAngle = 0;
    let prev = 0;
    for (let i = 0; i < 150; i++) {
      world.stepFixed(1);
      const a = world.getRevoluteAngle(part.joint);
      // 累计绝对角位移（连续旋转，绕圈跨越 ±π 边界）
      let delta = a - prev;
      if (delta > Math.PI) delta -= Math.PI * 2;
      if (delta < -Math.PI) delta += Math.PI * 2;
      totalAngle += Math.abs(delta);
      prev = a;
    }
    expect(totalAngle).toBeGreaterThan(Math.PI * 2); // 转过一整圈以上（连续、无 limit 阻挡）
  });

  it('同车 Collider 不互卡：高速连续旋转 step 无异常、车体不被推飞', () => {
    const { world, v } = makeVehicle();
    const part = liftPart(v);
    const chassisX0 = world.getPosition(v.body).x;
    world.setRevoluteMotor(part.joint, {
      enabled: true,
      speedRadPerStep: 0.3,
      maxTorqueNm: 400,
    });
    for (let i = 0; i < 150; i++) {
      expect(() => world.stepFixed(1)).not.toThrow();
    }
    const chassisX1 = world.getPosition(v.body).x;
    expect(Math.abs(chassisX1 - chassisX0)).toBeLessThan(20);
  });

  it('装配回归：Hammer → Revolute；Push Rod → Prismatic；Cannon / Ram → Weld', () => {
    // hammer：Revolute
    const hammerBuild: BuildSnapshot = {
      id: 'hammerCar',
      bodyDefId: 'boxBody',
      quality: 1,
      movements: [
        { hardpointId: 'rear', defId: 'wheelStd' },
        { hardpointId: 'front', defId: 'wheelStd' },
      ],
      functionals: [{ hardpointId: 'front', defId: 'hammer' }],
    };
    const { world: w1, v: v1 } = makeVehicle(hammerBuild);
    const hammerPart = v1.parts.find((p) => p.def.behavior === 'hammer')!;
    expect(w1.getRevoluteAngle(hammerPart.joint)).toBeCloseTo(0, 6);

    // pushRod：Prismatic
    const pushRodBuild: BuildSnapshot = {
      id: 'pushRodCar',
      bodyDefId: 'boxBody',
      quality: 1,
      movements: [
        { hardpointId: 'rear', defId: 'wheelStd' },
        { hardpointId: 'front', defId: 'wheelStd' },
      ],
      functionals: [{ hardpointId: 'front', defId: 'pushRod' }],
    };
    const { world: w2, v: v2 } = makeVehicle(pushRodBuild);
    const pushRodPart = v2.parts.find((p) => p.def.behavior === 'pushRod')!;
    expect(w2.getPrismaticTranslation(pushRodPart.joint)).toBeCloseTo(0, 6);

    // cannon：Weld
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
    const { world: w3, v: v3 } = makeVehicle(cannonBuild);
    const cannonPart = v3.parts.find((p) => p.def.behavior === 'cannon')!;
    expect(() => w3.getRevoluteAngle(cannonPart.joint)).toThrow();
    expect(() => w3.getPrismaticTranslation(cannonPart.joint)).toThrow();

    // ram：Weld
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
    const { world: w4, v: v4 } = makeVehicle(ramBuild);
    const ramPart = v4.parts.find((p) => p.def.behavior === 'ram')!;
    expect(() => w4.getRevoluteAngle(ramPart.joint)).toThrow();
    expect(() => w4.getPrismaticTranslation(ramPart.joint)).toThrow();
  });
});
