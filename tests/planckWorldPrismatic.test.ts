/**
 * Queue Q04-F1｜Prismatic Joint Foundation targeted test
 *
 * 覆盖 Q04-F1 验收：
 * 1. motor 可真实驱动 translation（+speed → +px，方向与 axis 一致）；
 * 2. limit 能真实阻止越界（motor 撞 upper/lower 停下）；
 * 3. disable limit 后可继续移动；
 * 4. +X / -X axis 正方向正确；
 * 5. zero axis / invalid range / wrong joint / cross-world 明确失败。
 *
 * 物理设定：无重力 world；bodyA 大质量锚（导轨），bodyB 滑块沿 axis 平移。
 * Prismatic 约束 1 平移 + 锁旋转 → bodyB 沿 axis 直线移动。
 */
import { describe, it, expect } from 'vitest';
import { PlanckWorld } from '../src/physics/planckWorld';

function makeRig(axis: { x: number; y: number }) {
  const world = new PlanckWorld({ x: 0, y: 0 });
  const a = world.createDynamicBox(0, 0, 200, 40, 10000); // 大质量锚（导轨）
  const b = world.createDynamicBox(0, 0, 40, 20, 10); // 滑块
  const j = world.createPrismaticJoint(a, { x: 0, y: 0 }, b, { x: 0, y: 0 }, axis);
  return { world, a, b, j };
}

describe('Q04-F1 Prismatic Joint Foundation', () => {
  it('motor 真实驱动 translation：+speed 沿 +axis 方向移动（+X）', () => {
    const { world, j } = makeRig({ x: 1, y: 0 });
    expect(world.getPrismaticTranslation(j)).toBeCloseTo(0, 6);

    world.setPrismaticMotor(j, { enabled: true, speedPxPerStep: 2, maxForceN: 100 });
    for (let i = 0; i < 30; i++) world.stepFixed(1);
    // 滑块沿 +X：translation 明显增长（~2px/step × 加速段，> 30px）
    expect(world.getPrismaticTranslation(j)).toBeGreaterThan(30);
  });

  it('motor 真实驱动 translation：-speed 沿 -axis 方向移动（-X）', () => {
    const { world, j } = makeRig({ x: 1, y: 0 });
    world.setPrismaticMotor(j, { enabled: true, speedPxPerStep: -2, maxForceN: 100 });
    for (let i = 0; i < 30; i++) world.stepFixed(1);
    expect(world.getPrismaticTranslation(j)).toBeLessThan(-30);
  });

  it('limit 真实阻止越界：motor 撞 upper 停下、撞 lower 停下', () => {
    const { world, j } = makeRig({ x: 1, y: 0 });
    world.setPrismaticMotor(j, { enabled: true, speedPxPerStep: 2, maxForceN: 100 });
    world.setPrismaticLimit(j, { enabled: true, lowerPx: -40, upperPx: 40 });

    for (let i = 0; i < 120; i++) world.stepFixed(1);
    const tUpper = world.getPrismaticTranslation(j);
    expect(tUpper).toBeLessThanOrEqual(40 + 1.5);
    expect(tUpper).toBeGreaterThan(30); // 确实顶到 upper 附近

    // 反向 motor → 撞 lower
    world.setPrismaticMotor(j, { enabled: true, speedPxPerStep: -2, maxForceN: 100 });
    for (let i = 0; i < 200; i++) world.stepFixed(1);
    const tLower = world.getPrismaticTranslation(j);
    expect(tLower).toBeGreaterThanOrEqual(-40 - 1.5);
    expect(tLower).toBeLessThan(-30);
  });

  it('disable limit 后可继续移动（超过原 upper）', () => {
    const { world, j } = makeRig({ x: 1, y: 0 });
    world.setPrismaticMotor(j, { enabled: true, speedPxPerStep: 2, maxForceN: 100 });
    world.setPrismaticLimit(j, { enabled: true, lowerPx: -40, upperPx: 40 });
    for (let i = 0; i < 120; i++) world.stepFixed(1);
    expect(world.getPrismaticTranslation(j)).toBeLessThanOrEqual(41.5);

    world.setPrismaticLimit(j, { enabled: false, lowerPx: -40, upperPx: 40 });
    for (let i = 0; i < 60; i++) world.stepFixed(1);
    expect(world.getPrismaticTranslation(j)).toBeGreaterThan(60); // 远超原 upper
  });

  it('+X / -X axis 正方向正确', () => {
    // axis=+X：motor +speed 沿 +axis（+X）驱动 bodyB 移向 +X
    const rig1 = makeRig({ x: 1, y: 0 });
    rig1.world.setPrismaticMotor(rig1.j, {
      enabled: true,
      speedPxPerStep: 2,
      maxForceN: 100,
    });
    for (let i = 0; i < 30; i++) rig1.world.stepFixed(1);
    expect(rig1.world.getPosition(rig1.b).x).toBeGreaterThan(30); // bodyB 沿 +X
    expect(rig1.world.getPrismaticTranslation(rig1.j)).toBeGreaterThan(30);

    // axis=-X：motor +speed 沿 +axis（-X）驱动 bodyB 移向 -X
    const rig2 = makeRig({ x: -1, y: 0 });
    rig2.world.setPrismaticMotor(rig2.j, {
      enabled: true,
      speedPxPerStep: 2,
      maxForceN: 100,
    });
    for (let i = 0; i < 30; i++) rig2.world.stepFixed(1);
    expect(rig2.world.getPosition(rig2.b).x).toBeLessThan(-30); // bodyB 沿 -X
    // translation = 沿 localAxisA 的带符号位移（dot(axis, displacement)）：
    // 正值恒为「沿 axis 正向」，与 axis 世界方向无关
    expect(rig2.world.getPrismaticTranslation(rig2.j)).toBeGreaterThan(30);
  });

  it('zero axis / invalid range / wrong joint / cross-world 明确失败', () => {
    const { world, a, b, j } = makeRig({ x: 1, y: 0 });
    // zero axis
    expect(() =>
      world.createPrismaticJoint(a, { x: 0, y: 0 }, b, { x: 0, y: 0 }, { x: 0, y: 0 }),
    ).toThrow();
    // invalid range
    expect(() =>
      world.setPrismaticLimit(j, { enabled: true, lowerPx: 50, upperPx: 10 }),
    ).toThrow();
    expect(() =>
      world.setPrismaticLimit(j, { enabled: true, lowerPx: Number.NaN, upperPx: 10 }),
    ).toThrow();
    expect(() =>
      world.setPrismaticMotor(j, { enabled: true, speedPxPerStep: 2, maxForceN: -5 }),
    ).toThrow();
    // wrong joint（Weld 非 Prismatic）
    const w2 = new PlanckWorld({ x: 0, y: 0 });
    const wa = w2.createDynamicBox(0, 0, 40, 20, 10);
    const wb = w2.createDynamicBox(40, 0, 40, 20, 10);
    const weld = w2.createWeldJoint(wa, { x: 0, y: 0 }, wb, { x: -20, y: 0 });
    expect(() => world.getPrismaticTranslation(weld)).toThrow();
    expect(() =>
      world.setPrismaticMotor(weld, { enabled: true, speedPxPerStep: 1, maxForceN: 10 }),
    ).toThrow();
    // cross-world（w2 的 Prismatic handle 对 world 使用）
    const j2 = w2.createPrismaticJoint(
      wa,
      { x: 0, y: 0 },
      wb,
      { x: -20, y: 0 },
      { x: 1, y: 0 },
    );
    expect(() => world.getPrismaticTranslation(j2)).toThrow();
    expect(() =>
      world.setPrismaticLimit(j2, { enabled: true, lowerPx: -10, upperPx: 10 }),
    ).toThrow();
    // 正常 handle 不受误伤
    expect(world.getPrismaticTranslation(j)).toBeCloseTo(0, 6);
  });
});
