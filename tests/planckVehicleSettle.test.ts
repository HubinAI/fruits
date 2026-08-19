/**
 * Queue F-02M-B16B｜Planck 整车无冲量贴地静置测试
 *
 * 覆盖：
 * 1. 等轮径贴地：collision maxY 与 ground minY 差 <1e-6，chassis angle≈0；
 * 2. 前后轮径不同：chassis angle 与公式一致；facing ±1 角度/位置镜像；
 * 3. Revolute/Weld anchor error 均 <0.01px；
 * 4. 贴地前人为设置的速度全部归零；
 * 5. 静置后 120 步：无 NaN、无明显弹跳/穿透、最终 vy <0.05px/step；
 * 6. vehicle.com 与各 body 当前质量加权结果一致。
 */
import { describe, it, expect } from 'vitest';
import { createRegistry } from '../src/core/content';
import {
  resolveSnapshot,
  type ResolvedSnapshot,
} from '../src/core/buildSnapshot';
import { PlanckWorld, type BodyHandle } from '../src/physics/planckWorld';
import {
  createPlanckVehicle,
  settlePlanckVehicleToRestPose,
  type PlanckVehicle,
} from '../src/battle/planckVehicleAssembly';

const registry = createRegistry();

/** boxBody + wheelStd×2（rear/front）+ ramHead@front */
function boxWithWheelsAndRam(): ResolvedSnapshot {
  return resolveSnapshot(
    {
      id: 'settleTest',
      bodyDefId: 'boxBody',
      quality: 1,
      movements: [
        { hardpointId: 'rear', defId: 'wheelStd' },
        { hardpointId: 'front', defId: 'wheelStd' },
      ],
      functionals: [{ hardpointId: 'front', defId: 'ramHead' }],
    },
    registry,
  );
}

/** 浅拷贝 def 修改前后轮半径（不污染 registry） */
function withWheelRadii(
  resolved: ResolvedSnapshot,
  rearR: number,
  frontR: number,
): ResolvedSnapshot {
  return {
    ...resolved,
    movements: resolved.movements.map((m, i) => ({
      ...m,
      def: { ...m.def, radius: i === 0 ? rearR : frontR },
    })),
  };
}

/** ground：顶 y=700（中心 750、半高 50） */
function makeGround(world: PlanckWorld): BodyHandle {
  return world.createStaticBox(400, 750, 800, 100, { friction: 1 });
}

/** 合并整车碰撞边界 */
function mergedCollisionBounds(
  world: PlanckWorld,
  v: PlanckVehicle,
): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const merge = (bb: { minX: number; minY: number; maxX: number; maxY: number }): void => {
    minX = Math.min(minX, bb.minX);
    minY = Math.min(minY, bb.minY);
    maxX = Math.max(maxX, bb.maxX);
    maxY = Math.max(maxY, bb.maxY);
  };
  merge(world.getCollisionBounds(v.body));
  for (const w of v.wheels) merge(world.getCollisionBounds(w.body));
  for (const p of v.parts) merge(world.getCollisionBounds(p.body));
  return { minX, minY, maxX, maxY };
}

describe('F-02M-B16B · 1. 等轮径贴地', () => {
  it('collision maxY 与 ground minY 差 <1e-6；chassis angle≈0', () => {
    const world = new PlanckWorld({ x: 0, y: 10 });
    const ground = makeGround(world);
    const v = createPlanckVehicle(world, boxWithWheelsAndRam(), 'A', { x: 400, y: 600 }, 1);
    settlePlanckVehicleToRestPose(world, v, ground);
    const vb = mergedCollisionBounds(world, v);
    const gb = world.getCollisionBounds(ground);
    console.log(
      `[settle-eq] vehicleMaxY=${vb.maxY.toFixed(9)} groundMinY=${gb.minY.toFixed(9)} diff=${Math.abs(vb.maxY - gb.minY).toExponential(3)}`,
    );
    expect(Math.abs(vb.maxY - gb.minY)).toBeLessThan(1e-6);
    // 等轮径 → theta=0
    expect(Math.abs(world.getAngle(v.body))).toBeLessThan(1e-9);
  });
});

describe('F-02M-B16B · 2. 轮径差姿态与 facing 镜像', () => {
  it('chassis angle 与公式一致；facing ±1 角度/位置镜像', () => {
    const wheelbase = 110; // boxBody hardpoints rear(-55)/front(55)
    const theta = Math.atan2(20 - 15, wheelbase);

    // A facing=1
    const wa = new PlanckWorld();
    const ga = makeGround(wa);
    const va = createPlanckVehicle(
      wa,
      withWheelRadii(boxWithWheelsAndRam(), 20, 15),
      'A',
      { x: 400, y: 600 },
      1,
    );
    settlePlanckVehicleToRestPose(wa, va, ga);
    const angleA = wa.getAngle(va.body);
    expect(angleA).toBeCloseTo(theta, 9);

    // B facing=-1
    const wb = new PlanckWorld();
    const gb = makeGround(wb);
    const vb = createPlanckVehicle(
      wb,
      withWheelRadii(boxWithWheelsAndRam(), 20, 15),
      'B',
      { x: 400, y: 600 },
      -1,
    );
    settlePlanckVehicleToRestPose(wb, vb, gb);
    const angleB = wb.getAngle(vb.body);
    expect(angleB).toBeCloseTo(-theta, 9);

    // 位置镜像：B rear 轮 x 关于车中心（400）镜像 A rear 轮
    const aRear = wa.getPosition(va.wheels.find((w) => w.id === 'rear')!.body);
    const bRear = wb.getPosition(vb.wheels.find((w) => w.id === 'rear')!.body);
    console.log(
      `[settle-diff] theta=${theta.toFixed(6)} angleA=${angleA.toFixed(6)} angleB=${angleB.toFixed(6)} ` +
        `aRear=(${aRear.x.toFixed(3)},${aRear.y.toFixed(3)}) bRear=(${bRear.x.toFixed(3)},${bRear.y.toFixed(3)})`,
    );
    expect(bRear.x).toBeCloseTo(2 * 400 - aRear.x, 6);
    expect(bRear.y).toBeCloseTo(aRear.y, 6);
  });
});

describe('F-02M-B16B · 3. 铰链锚点误差', () => {
  it('Revolute/Weld anchor error 均 <0.01px', () => {
    const world = new PlanckWorld();
    const ground = makeGround(world);
    const v = createPlanckVehicle(world, boxWithWheelsAndRam(), 'A', { x: 400, y: 600 }, 1);
    settlePlanckVehicleToRestPose(world, v, ground);
    for (const w of v.wheels) {
      const e = world.getJointAnchorErrorPx(w.joint);
      console.log(`[anchor] wheel:${w.id} err=${e.toExponential(3)}px`);
      expect(e).toBeLessThan(0.01);
    }
    for (const p of v.parts) {
      const e = world.getJointAnchorErrorPx(p.joint);
      console.log(`[anchor] part:${p.id} err=${e.toExponential(3)}px`);
      expect(e).toBeLessThan(0.01);
    }
  });
});

describe('F-02M-B16B · 4. 速度归零', () => {
  it('贴地前人为设置的速度全部归零（线/角）', () => {
    const world = new PlanckWorld();
    const ground = makeGround(world);
    const v = createPlanckVehicle(world, boxWithWheelsAndRam(), 'A', { x: 400, y: 600 }, 1);
    // 人为速度
    world.setLinearVelocity(v.body, 5, 3);
    world.setAngularVelocity(v.body, 2);
    for (const w of v.wheels) {
      world.setLinearVelocity(w.body, -2, 4);
      world.setAngularVelocity(w.body, 1.5);
    }
    for (const p of v.parts) {
      world.setLinearVelocity(p.body, 7, -1);
      world.setAngularVelocity(p.body, -3);
    }
    settlePlanckVehicleToRestPose(world, v, ground);
    // 全部归零
    const check = (body: BodyHandle): void => {
      const l = world.getLinearVelocity(body);
      expect(Math.abs(l.x)).toBeLessThan(1e-12);
      expect(Math.abs(l.y)).toBeLessThan(1e-12);
      expect(Math.abs(world.getAngularVelocity(body))).toBeLessThan(1e-12);
    };
    check(v.body);
    for (const w of v.wheels) check(w.body);
    for (const p of v.parts) check(p.body);
  });
});

describe('F-02M-B16B · 5. 120 步静置稳定', () => {
  it('无 NaN、无明显弹跳/穿透、最终 vy <0.05px/step', () => {
    const world = new PlanckWorld({ x: 0, y: 10 });
    const ground = makeGround(world);
    const v = createPlanckVehicle(world, boxWithWheelsAndRam(), 'A', { x: 400, y: 600 }, 1);
    settlePlanckVehicleToRestPose(world, v, ground);
    const gMinY = world.getCollisionBounds(ground).minY;
    let nan = false;
    let maxPen = 0;
    let lastVy = 0;
    for (let i = 0; i < 120; i++) {
      world.stepFixed(1);
      const vb = mergedCollisionBounds(world, v);
      if (![vb.minX, vb.minY, vb.maxX, vb.maxY].every(Number.isFinite)) nan = true;
      const pen = vb.maxY - gMinY;
      if (pen > maxPen) maxPen = pen;
      lastVy = world.getLinearVelocity(v.body).y;
      if (!Number.isFinite(lastVy)) nan = true;
    }
    const finalY = world.getPosition(v.body).y;
    console.log(
      `[settle-120] maxPen=${maxPen.toFixed(6)} finalVy=${lastVy.toFixed(6)} chassisY=${finalY.toFixed(3)} nan=${nan}`,
    );
    expect(nan).toBe(false);
    expect(maxPen).toBeLessThan(2); // 无穿透（skin 容差内）
    expect(Math.abs(lastVy)).toBeLessThan(0.05);
  });
});

describe('F-02M-B16B · 6. COM 一致性', () => {
  it('vehicle.com 与各 body 当前质量加权结果一致（totalMass 不变）', () => {
    const world = new PlanckWorld();
    const ground = makeGround(world);
    const v = createPlanckVehicle(world, boxWithWheelsAndRam(), 'A', { x: 400, y: 600 }, 1);
    const totalMassBefore = v.totalMass;
    settlePlanckVehicleToRestPose(world, v, ground);
    let mx = 0;
    let my = 0;
    const acc = (body: BodyHandle): void => {
      const m = world.getMass(body);
      const c = world.getCenterOfMass(body);
      mx += c.x * m;
      my += c.y * m;
    };
    acc(v.body);
    for (const w of v.wheels) acc(w.body);
    for (const p of v.parts) acc(p.body);
    expect(v.totalMass).toBe(totalMassBefore);
    expect(v.com.x).toBeCloseTo(mx / v.totalMass, 6);
    expect(v.com.y).toBeCloseTo(my / v.totalMass, 6);
  });
});

describe('F-02M-B16B · 7. 连续调用两次幂等', () => {
  it('第二次调用后所有 body 的 position/angle/速度/COM/bounds/锚点误差相对第一次不漂移', () => {
    const world = new PlanckWorld({ x: 0, y: 10 });
    const ground = makeGround(world);
    const v = createPlanckVehicle(world, boxWithWheelsAndRam(), 'A', { x: 400, y: 600 }, 1);

    type Vec = { x: number; y: number };
    type BodySnap = { pos: Vec; angle: number; lin: Vec; ang: number };
    type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
    type Snap = {
      chassis: BodySnap;
      wheels: (BodySnap & { anchor: number })[];
      parts: (BodySnap & { anchor: number })[];
      com: Vec;
      bounds: Bounds;
    };
    const snap = (): Snap => {
      const b = (body: BodyHandle): BodySnap => ({
        pos: world.getPosition(body),
        angle: world.getAngle(body),
        lin: world.getLinearVelocity(body),
        ang: world.getAngularVelocity(body),
      });
      return {
        chassis: b(v.body),
        wheels: v.wheels.map((w) => ({ ...b(w.body), anchor: world.getJointAnchorErrorPx(w.joint) })),
        parts: v.parts.map((p) => ({ ...b(p.body), anchor: world.getJointAnchorErrorPx(p.joint) })),
        com: { x: v.com.x, y: v.com.y },
        bounds: mergedCollisionBounds(world, v),
      };
    };

    settlePlanckVehicleToRestPose(world, v, ground);
    const s1 = snap();
    // 不推进物理步，立即第二次调用
    settlePlanckVehicleToRestPose(world, v, ground);
    const s2 = snap();

    const cd = (a: Vec, b: Vec): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
    let maxPos = 0;
    let maxAng = 0;
    let maxVel = 0;
    let maxCom = 0;
    let maxBounds = 0;
    let maxAnchor = 0;

    maxPos = Math.max(maxPos, cd(s1.chassis.pos, s2.chassis.pos));
    maxAng = Math.max(maxAng, Math.abs(s1.chassis.angle - s2.chassis.angle));
    maxVel = Math.max(maxVel, cd(s1.chassis.lin, s2.chassis.lin), Math.abs(s1.chassis.ang - s2.chassis.ang));

    s1.wheels.forEach((w1, i) => {
      const w2 = s2.wheels[i];
      maxPos = Math.max(maxPos, cd(w1.pos, w2.pos));
      maxAng = Math.max(maxAng, Math.abs(w1.angle - w2.angle));
      maxVel = Math.max(maxVel, cd(w1.lin, w2.lin), Math.abs(w1.ang - w2.ang));
      maxAnchor = Math.max(maxAnchor, w2.anchor);
      expect(w2.anchor).toBeLessThanOrEqual(w1.anchor + 1e-12); // 不增加
      expect(w2.anchor).toBeLessThan(0.01); // < 0.01px
    });
    s1.parts.forEach((p1, i) => {
      const p2 = s2.parts[i];
      maxPos = Math.max(maxPos, cd(p1.pos, p2.pos));
      maxAng = Math.max(maxAng, Math.abs(p1.angle - p2.angle));
      maxVel = Math.max(maxVel, cd(p1.lin, p2.lin), Math.abs(p1.ang - p2.ang));
      maxAnchor = Math.max(maxAnchor, p2.anchor);
      expect(p2.anchor).toBeLessThanOrEqual(p1.anchor + 1e-12);
      expect(p2.anchor).toBeLessThan(0.01);
    });

    maxCom = cd(s1.com, s2.com);
    const bd = (k: 'minX' | 'minY' | 'maxX' | 'maxY'): number => Math.abs(s1.bounds[k] - s2.bounds[k]);
    maxBounds = Math.max(bd('minX'), bd('minY'), bd('maxX'), bd('maxY'));

    // 第二次后绝对速度仍归零（<1e-12）
    const absVel = (bs: BodySnap): number => Math.max(cd(bs.lin, { x: 0, y: 0 }), Math.abs(bs.ang));
    expect(absVel(s2.chassis)).toBeLessThan(1e-12);
    s2.wheels.forEach((w) => expect(absVel(w)).toBeLessThan(1e-12));
    s2.parts.forEach((p) => expect(absVel(p)).toBeLessThan(1e-12));

    // 无 NaN/Infinity
    [maxPos, maxAng, maxVel, maxCom, maxBounds, maxAnchor].forEach((x) =>
      expect(Number.isFinite(x)).toBe(true),
    );

    console.log(
      `[idempotency] maxPos=${maxPos.toExponential(3)} maxAng=${maxAng.toExponential(3)} ` +
        `maxCom=${maxCom.toExponential(3)} maxBounds=${maxBounds.toExponential(3)} maxAnchor=${maxAnchor.toExponential(3)}`,
    );

    expect(maxPos).toBeLessThan(1e-9);
    expect(maxAng).toBeLessThan(1e-9);
    expect(maxVel).toBeLessThan(1e-12);
    expect(maxCom).toBeLessThan(1e-9);
    expect(maxBounds).toBeLessThan(1e-9);
  });
});
