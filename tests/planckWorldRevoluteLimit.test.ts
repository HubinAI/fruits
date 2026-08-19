/**
 * Queue Q03-F1｜Revolute Angle + Limit Foundation targeted test
 *
 * 覆盖 Q03-F1 验收：
 * 1. getRevoluteAngle 返回真实 joint relative angle（rad），随真实运动变化；
 * 2. setRevoluteLimit 能真实挡住旋转（motor 驱动撞 upper 停下）；
 * 3. disable 后不再受 limit；
 * 4. invalid handle（跨 world / 非 Revolute）明确报错；
 * 5. invalid range（lower > upper / NaN / enabled 非 boolean）明确报错。
 *
 * 物理设定：无重力 world；bodyA 大质量锚（~10000），bodyB 小质量远端质量，
 * Revolute pivot 在两体锚点精确重合处；motor 驱动 bodyB 绕 pivot 旋转。
 */
import { describe, it, expect } from 'vitest';
import { PlanckWorld } from '../src/physics/planckWorld';

/** 摆锤刚体：bodyA 大质量锚（pivot），bodyB 远端质量（锤头），motor 驱动 */
function makeRig() {
  const world = new PlanckWorld({ x: 0, y: 0 });
  const a = world.createDynamicBox(0, 0, 120, 30, 10000);
  const b = world.createDynamicBox(60, 0, 24, 10, 20);
  // pivot 世界点 = (0,0)：bodyA 本地锚 (0,0)；bodyB 本地锚 (-60,0) → 世界 (60-60, 0) = (0,0)
  const j = world.createRevoluteJoint(a, { x: 0, y: 0 }, b, { x: -60, y: 0 });
  return { world, a, b, j };
}

describe('Q03-F1 Revolute Angle + Limit', () => {
  it('getRevoluteAngle：motor 驱动下 angle 随真实运动单调增长（rad）', () => {
    const { world, j } = makeRig();
    expect(world.getRevoluteAngle(j)).toBeCloseTo(0, 6);

    world.setRevoluteMotor(j, {
      enabled: true,
      speedRadPerStep: 0.05,
      maxTorqueNm: 50,
    });
    for (let i = 0; i < 20; i++) world.stepFixed(1);
    const a1 = world.getRevoluteAngle(j);
    expect(a1).toBeGreaterThan(0.2); // 已明显转动
    for (let i = 0; i < 40; i++) world.stepFixed(1);
    const a2 = world.getRevoluteAngle(j);
    expect(a2).toBeGreaterThan(a1); // 继续增长（无 limit）
  });

  it('setRevoluteLimit：limit 真实挡住旋转（motor 撞 upper 停下）', () => {
    const { world, j } = makeRig();
    world.setRevoluteMotor(j, {
      enabled: true,
      speedRadPerStep: 0.05,
      maxTorqueNm: 50,
    });
    world.setRevoluteLimit(j, { enabled: true, lowerRad: -0.2, upperRad: 0.5 });

    for (let i = 0; i < 60; i++) world.stepFixed(1);
    const a60 = world.getRevoluteAngle(j);
    // 停在 upper ≈ 0.5（原生 limit 硬约束，求解余量 < 0.06 rad）
    expect(a60).toBeLessThanOrEqual(0.5 + 0.06);
    expect(Math.abs(a60 - 0.5)).toBeLessThan(0.06);

    // 再转 60 步也不增长（持续被挡）
    for (let i = 0; i < 60; i++) world.stepFixed(1);
    const a120 = world.getRevoluteAngle(j);
    expect(a120).toBeLessThanOrEqual(a60 + 0.01);
  });

  it('disable limit 后不再受约束（继续转动超过原 upper）', () => {
    const { world, j } = makeRig();
    world.setRevoluteMotor(j, {
      enabled: true,
      speedRadPerStep: 0.05,
      maxTorqueNm: 50,
    });
    world.setRevoluteLimit(j, { enabled: true, lowerRad: -0.2, upperRad: 0.5 });
    for (let i = 0; i < 60; i++) world.stepFixed(1);
    expect(world.getRevoluteAngle(j)).toBeLessThanOrEqual(0.56);

    world.setRevoluteLimit(j, { enabled: false, lowerRad: -0.2, upperRad: 0.5 });
    for (let i = 0; i < 60; i++) world.stepFixed(1);
    // disable 后 60 步（≈3 rad 自由行程）远超原 upper
    expect(world.getRevoluteAngle(j)).toBeGreaterThan(0.58);
  });

  it('invalid handle：跨 world / 非 Revolute 明确报错', () => {
    const { world, j } = makeRig();
    // 非 Revolute（Weld）→ getRevoluteAngle / setRevoluteLimit 都报错
    const w2 = new PlanckWorld({ x: 0, y: 0 });
    const wa = w2.createDynamicBox(0, 0, 40, 20, 10);
    const wb = w2.createDynamicBox(40, 0, 40, 20, 10);
    const weld = w2.createWeldJoint(wa, { x: 0, y: 0 }, wb, { x: -20, y: 0 });
    expect(() => world.getRevoluteAngle(weld)).toThrow();
    expect(() =>
      world.setRevoluteLimit(weld, { enabled: true, lowerRad: -1, upperRad: 1 }),
    ).toThrow();
    // 跨 world：w2 的 Revolute handle 对 world 使用 → 报错
    const j2 = w2.createRevoluteJoint(wa, { x: 0, y: 0 }, wb, { x: -20, y: 0 });
    expect(() => world.getRevoluteAngle(j2)).toThrow();
    expect(() =>
      world.setRevoluteLimit(j2, { enabled: true, lowerRad: -1, upperRad: 1 }),
    ).toThrow();
    // 正常 handle 仍可用（确认不是误伤）
    expect(world.getRevoluteAngle(j)).toBeCloseTo(0, 6);
  });

  it('invalid range：lower > upper / NaN / enabled 非 boolean 明确报错', () => {
    const { world, j } = makeRig();
    expect(() =>
      world.setRevoluteLimit(j, { enabled: true, lowerRad: 0.5, upperRad: -0.5 }),
    ).toThrow();
    expect(() =>
      world.setRevoluteLimit(j, { enabled: true, lowerRad: Number.NaN, upperRad: 1 }),
    ).toThrow();
    expect(() =>
      world.setRevoluteLimit(j, { enabled: true, lowerRad: -1, upperRad: Number.POSITIVE_INFINITY }),
    ).toThrow();
    expect(() =>
      world.setRevoluteLimit(j, { enabled: 'yes' as unknown as boolean, lowerRad: -1, upperRad: 1 }),
    ).toThrow();
    // 合法配置不受影响
    expect(() =>
      world.setRevoluteLimit(j, { enabled: true, lowerRad: -0.2, upperRad: 0.5 }),
    ).not.toThrow();
  });
});
