/**
 * Queue F-02M-A3｜Planck 最小适配内核（targeted regression）
 *
 * 覆盖：
 * 1. Box/Circle：位置/线速度/角速度正负往返、输入质量与实际质量误差 <1e-9；
 * 2. Revolute 反作用：chassis 50kg + wheel 10kg（wheel 本地 (40px,0)），
 *    wheel 初速 1px/step，300 步：同向运动、总动量误差 <1e-6、锚点误差 <0.2px；
 * 3. 自由旋转：wheel 非零角速度 60 步：相对旋转明显、锚点误差 <0.2px；
 * 4. 跨 World handle 抛错；
 * 5. 无 NaN/Infinity。
 */
import { describe, it, expect } from 'vitest';
import { PlanckWorld, type BodyHandle } from '../src/physics/planckWorld';
import { pxPerStepToMps } from '../src/physics/units';

function assertFiniteAll(...vals: number[]): void {
  for (const v of vals) expect(Number.isFinite(v)).toBe(true);
}

describe('F-02M-A3 · 1. Box/Circle 基础', () => {
  it('Box 位置/线速度/角速度往返 + 质量匹配', () => {
    const world = new PlanckWorld();
    const b = world.createDynamicBox(100, 200, 50, 30, 5);
    // 位置往返
    const pos = world.getPosition(b);
    expect(pos.x).toBeCloseTo(100, 9);
    expect(pos.y).toBeCloseTo(200, 9);
    // 线速度往返（正负）
    world.setLinearVelocity(b, 1.5, -2.5);
    const v = world.getLinearVelocity(b);
    expect(v.x).toBeCloseTo(1.5, 9);
    expect(v.y).toBeCloseTo(-2.5, 9);
    // 角速度往返（负值）
    world.setAngularVelocity(b, -3);
    expect(world.getAngularVelocity(b)).toBeCloseTo(-3, 9);
    // 质量
    expect(world.getMass(b)).toBeCloseTo(5, 9);
    expect(Math.abs(world.getMass(b) - 5)).toBeLessThan(1e-9);
    assertFiniteAll(pos.x, pos.y, v.x, v.y, world.getAngle(b), world.getAngularVelocity(b), world.getMass(b));
  });

  it('Circle 位置/速度往返 + 质量匹配', () => {
    const world = new PlanckWorld();
    const c = world.createDynamicCircle(-50, 80, 15, 2.5);
    const pos = world.getPosition(c);
    expect(pos.x).toBeCloseTo(-50, 9);
    expect(pos.y).toBeCloseTo(80, 9);
    world.setLinearVelocity(c, -0.75, 0.25);
    const v = world.getLinearVelocity(c);
    expect(v.x).toBeCloseTo(-0.75, 9);
    expect(v.y).toBeCloseTo(0.25, 9);
    expect(Math.abs(world.getMass(c) - 2.5)).toBeLessThan(1e-9);
  });

  it('非法输入立即抛错（非有限/非正）', () => {
    const world = new PlanckWorld();
    expect(() => world.createDynamicBox(NaN, 0, 10, 10, 1)).toThrow();
    expect(() => world.createDynamicBox(0, 0, -10, 10, 1)).toThrow();
    expect(() => world.createDynamicBox(0, 0, 10, 10, 0)).toThrow();
    expect(() => world.createDynamicCircle(0, 0, Infinity, 1)).toThrow();
    expect(() => world.createDynamicCircle(0, 0, 10, -1)).toThrow();
  });
});

describe('F-02M-A3 · 2. Revolute 反作用', () => {
  it('chassis 50kg + wheel 10kg（wheel 初速 1px/step）300 步动量守恒', () => {
    const world = new PlanckWorld();
    const chassis = world.createDynamicBox(0, 0, 100, 30, 50);
    const wheel = world.createDynamicCircle(40, 0, 15, 10);
    const joint = world.createRevoluteJoint(
      chassis,
      { x: 40, y: 0 },
      wheel,
      { x: 0, y: 0 },
    );
    world.setLinearVelocity(wheel, 1, 0); // 1px/step

    let maxErrPx = 0;
    let nan = false;
    for (let i = 0; i < 300; i++) {
      world.stepFixed(1);
      const e = world.getJointAnchorErrorPx(joint);
      if (e > maxErrPx) maxErrPx = e;
      const v = world.getLinearVelocity(chassis);
      const w = world.getLinearVelocity(wheel);
      if (![v.x, v.y, w.x, w.y, world.getAngle(chassis), world.getAngle(wheel)].every(Number.isFinite)) nan = true;
    }

    const vCh = world.getLinearVelocity(chassis);
    const vWh = world.getLinearVelocity(wheel);
    const mCh = world.getMass(chassis);
    const mWh = world.getMass(wheel);
    // 总动量（kg·m/s）：初始 = 10kg * 0.6m/s = 6
    const totalP = mCh * pxPerStepToMps(vCh.x) + mWh * pxPerStepToMps(vWh.x);
    console.log(
      `[S2] vCh=${vCh.x.toFixed(4)} vWh=${vWh.x.toFixed(4)} mCh=${mCh.toFixed(2)} mWh=${mWh.toFixed(2)} ` +
        `总动量=${totalP.toFixed(8)} 动量误差=${Math.abs(totalP - 6).toExponential(3)} maxAnchorErr=${maxErrPx.toExponential(3)}px NaN=${nan}`,
    );
    // 同向运动
    expect(vCh.x).toBeGreaterThan(0);
    expect(vWh.x).toBeGreaterThan(0);
    // 动量守恒（初始总动量 = 10 * 0.6 = 6 kg·m/s）
    expect(Math.abs(totalP - 6)).toBeLessThan(1e-6);
    // 锚点误差 < 0.2px
    expect(maxErrPx).toBeLessThan(0.2);
    expect(nan).toBe(false);
  });
});

describe('F-02M-A3 · 3. 自由旋转', () => {
  it('wheel 非零角速度 60 步后相对 chassis 明显旋转', () => {
    const world = new PlanckWorld();
    const chassis = world.createDynamicBox(0, 0, 100, 30, 50);
    const wheel = world.createDynamicCircle(40, 0, 15, 10);
    const joint = world.createRevoluteJoint(
      chassis,
      { x: 40, y: 0 },
      wheel,
      { x: 0, y: 0 },
    );
    world.setAngularVelocity(wheel, 2); // 2 rad/step

    let maxErrPx = 0;
    for (let i = 0; i < 60; i++) {
      world.stepFixed(1);
      const e = world.getJointAnchorErrorPx(joint);
      if (e > maxErrPx) maxErrPx = e;
    }

    const aCh = world.getAngle(chassis);
    const aWh = world.getAngle(wheel);
    const rel = aWh - aCh;
    console.log(
      `[S3] chassisAngle=${aCh.toFixed(4)} wheelAngle=${aWh.toFixed(4)} 相对旋转=${rel.toFixed(4)} rad ` +
        `maxAnchorErr=${maxErrPx.toExponential(3)}px`,
    );
    // 明显相对旋转（2 rad/step * 60 step = 120 rad）
    expect(Math.abs(rel)).toBeGreaterThan(10);
    expect(maxErrPx).toBeLessThan(0.2);
  });
});

describe('F-02M-A3 · 4. 跨 World handle 抛错', () => {
  it('world A 的 handle 传给 world B 必须抛错', () => {
    const wa = new PlanckWorld();
    const wb = new PlanckWorld();
    const aBody = wa.createDynamicBox(0, 0, 10, 10, 1);
    // wb 使用 wa 的 handle
    expect(() => wb.getPosition(aBody)).toThrow();
    expect(() => wb.setLinearVelocity(aBody, 1, 0)).toThrow();
    // joint 跨 world
    const j = wa.createRevoluteJoint(aBody, { x: 0, y: 0 }, aBody, { x: 0, y: 0 });
    expect(() => wb.getJointAnchorErrorPx(j)).toThrow();
    // 伪造 handle（opaque 后外部无法构造，空对象断言必失效）
    expect(() => wa.getPosition({} as BodyHandle)).toThrow();
  });
});

describe('F-02M-A3 · 5. stepFixed 非法步数抛错', () => {
  it('0 / 负数 / 1.5 / NaN 全部抛错，1 正常执行', () => {
    const world = new PlanckWorld();
    const b = world.createDynamicBox(0, 0, 10, 10, 1);
    world.setLinearVelocity(b, 1, 0);
    expect(() => world.stepFixed(0)).toThrow();
    expect(() => world.stepFixed(-1)).toThrow();
    expect(() => world.stepFixed(1.5)).toThrow();
    expect(() => world.stepFixed(NaN)).toThrow();
    expect(() => world.stepFixed(Infinity)).toThrow();
    // 合法：1 步正常推进（位置变化）
    const p0 = world.getPosition(b).x;
    world.stepFixed(1);
    const p1 = world.getPosition(b).x;
    expect(p1).not.toBe(p0);
    // 默认参数 = 1
    world.stepFixed();
  });
});
