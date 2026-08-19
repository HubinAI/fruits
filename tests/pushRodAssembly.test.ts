/**
 * Queue Q04-F2｜Push Rod Content + Prismatic Mount targeted test
 *
 * 覆盖 Q04-F2 验收：
 * 1. pushRod Content：category='gadget'、behavior='pushRod'、无 baseDamage、
 *    真实 mass/energy、单长矩形 collider 从挂点向车辆前方延伸（offset.x 前移）；
 * 2. Assembly：behavior==='pushRod' → Prismatic（translation=0 时 pivot 与功能挂点重合、
 *    只能沿轴移动、不能自由旋转）；
 * 3. facing A/B 均朝自身前方伸缩（axis 本地 ±X，非固定世界 X）；
 * 4. 同车 Collider 不互卡（伸缩扫过车身区域 step 无异常、车体不被推飞）；
 * 5. Hammer → Revolute、Cannon/Ram → Weld 装配回归。
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

function pushRodBuild(): BuildSnapshot {
  return {
    id: 'pushRodCar',
    bodyDefId: 'boxBody',
    quality: 1,
    movements: [
      { hardpointId: 'rear', defId: 'wheelStd' },
      { hardpointId: 'front', defId: 'wheelStd' },
    ],
    functionals: [{ hardpointId: 'front', defId: 'pushRod' }],
  };
}

function makeVehicle(facing: 1 | -1, build: BuildSnapshot = pushRodBuild()): {
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
    facing,
  );
  settlePlanckVehicleToRestPose(world, v, ground);
  return { world, v };
}

function pushRodPart(v: PlanckVehicle) {
  const part = v.parts.find((p) => p.def.behavior === 'pushRod');
  expect(part).toBeDefined();
  return part!;
}

describe('Q04-F2 Push Rod Content + Prismatic Mount', () => {
  it('pushRod Content：gadget / pushRod / 无 baseDamage / 真实质量能量 / 长矩形前方延伸', () => {
    const def = registry.functionals.get('pushRod') as FunctionalPartDef;
    expect(def).toBeDefined();
    expect(def.category).toBe('gadget');
    expect(def.behavior).toBe('pushRod');
    expect(def.behaviorParams).toBeUndefined(); // 无 baseDamage
    expect(def.mass).toBeGreaterThan(0);
    expect(def.energy).toBeGreaterThan(0);
    expect(def.collider.shape).toBe('box');
    const w = def.collider.width ?? 0;
    const h = def.collider.height ?? 0;
    expect(w).toBeGreaterThan(h); // 长矩形
    expect(w).toBeGreaterThanOrEqual(60);
    // collider 从挂点向前方延伸：offset.x > 0 且形状起点 ≈ pivot（offset.x - w/2 ≈ 0）
    expect(def.collider.offset.x).toBeGreaterThan(0);
    expect(def.collider.offset.x - w / 2).toBeCloseTo(0, 6);
  });

  it('Prismatic 装配：translation=0 时 pivot 与功能挂点重合', () => {
    const { world, v } = makeVehicle(1);
    const part = pushRodPart(v);
    const chassis = world.getPosition(v.body);
    const hp = part.hardpoint.localPosition;
    const hpWorld = { x: chassis.x + hp.x, y: chassis.y + hp.y };
    const partPos = world.getPosition(part.body);
    expect(partPos.x).toBeCloseTo(hpWorld.x, 1);
    expect(partPos.y).toBeCloseTo(hpWorld.y, 1);
    // joint 是真实 Prismatic：translation 可用且初始 0
    expect(world.getPrismaticTranslation(part.joint)).toBeCloseTo(0, 6);
  });

  it('只能沿轴移动、不能自由旋转；facing=+1 朝 +X 伸缩', () => {
    const { world, v } = makeVehicle(1);
    const part = pushRodPart(v);
    const angle0 = world.getAngle(part.body);
    const y0 = world.getPosition(part.body).y;

    // motor 驱动沿 +axis（+X 前方）伸出
    world.setPrismaticMotor(part.joint, {
      enabled: true,
      speedPxPerStep: 2,
      maxForceN: 200,
    });
    for (let i = 0; i < 40; i++) world.stepFixed(1);
    const pos = world.getPosition(part.body);
    const chassis = world.getPosition(v.body);
    expect(pos.x).toBeGreaterThan(chassis.x + 75 + 30); // 沿 +X 明显前移
    // y 基本不变（axis 水平；±2px 容差吸收车体重力沉降/微动的正常小量）
    expect(Math.abs(pos.y - y0)).toBeLessThan(2);
    // 不能自由旋转（Prismatic 锁旋转）
    expect(Math.abs(world.getAngle(part.body) - angle0)).toBeLessThan(0.05);
    expect(world.getPrismaticTranslation(part.joint)).toBeGreaterThan(30);
  });

  it('facing=-1 朝 -X 伸缩（axis 镜像后前方）', () => {
    const { world, v } = makeVehicle(-1);
    const part = pushRodPart(v);
    world.setPrismaticMotor(part.joint, {
      enabled: true,
      speedPxPerStep: 2,
      maxForceN: 200,
    });
    for (let i = 0; i < 40; i++) world.stepFixed(1);
    const pos = world.getPosition(part.body);
    // A facing=-1 → 前方为 -X → part 沿 -X 前移
    const chassis = world.getPosition(v.body);
    expect(pos.x).toBeLessThan(chassis.x - 75 - 30);
    expect(world.getPrismaticTranslation(part.joint)).toBeGreaterThan(30); // 沿 axis 正向
  });

  it('同车 Collider 不互卡：伸缩扫过车身区域 step 无异常、车体不被推飞', () => {
    const { world, v } = makeVehicle(1);
    const part = pushRodPart(v);
    const chassisX0 = world.getPosition(v.body).x;
    // 反复伸/缩
    for (let cycle = 0; cycle < 3; cycle++) {
      world.setPrismaticMotor(part.joint, {
        enabled: true,
        speedPxPerStep: 3,
        maxForceN: 300,
      });
      for (let i = 0; i < 40; i++) {
        expect(() => world.stepFixed(1)).not.toThrow();
      }
      world.setPrismaticMotor(part.joint, {
        enabled: true,
        speedPxPerStep: -3,
        maxForceN: 300,
      });
      for (let i = 0; i < 40; i++) {
        expect(() => world.stepFixed(1)).not.toThrow();
      }
    }
    const chassisX1 = world.getPosition(v.body).x;
    expect(Math.abs(chassisX1 - chassisX0)).toBeLessThan(20); // 未被推飞
  });

  it('Hammer → Revolute、Cannon/Ram → Weld 装配回归', () => {
    // hammer 车：joint 是 Revolute（getRevoluteAngle 可用，getPrismaticTranslation 报错）
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
    const { world: w1, v: v1 } = makeVehicle(1, hammerBuild);
    const hammerPart = v1.parts.find((p) => p.def.behavior === 'hammer')!;
    expect(w1.getRevoluteAngle(hammerPart.joint)).toBeCloseTo(0, 6);
    expect(() => w1.getPrismaticTranslation(hammerPart.joint)).toThrow();

    // cannon 车：Weld（两种 joint API 都报错）
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
    const { world: w2, v: v2 } = makeVehicle(1, cannonBuild);
    const cannonPart = v2.parts.find((p) => p.def.behavior === 'cannon')!;
    expect(() => w2.getRevoluteAngle(cannonPart.joint)).toThrow();
    expect(() => w2.getPrismaticTranslation(cannonPart.joint)).toThrow();

    // ram 车：Weld
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
    const { world: w3, v: v3 } = makeVehicle(1, ramBuild);
    const ramPart = v3.parts.find((p) => p.def.behavior === 'ram')!;
    expect(() => w3.getRevoluteAngle(ramPart.joint)).toThrow();
    expect(() => w3.getPrismaticTranslation(ramPart.joint)).toThrow();
  });
});
