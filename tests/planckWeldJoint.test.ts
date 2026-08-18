/**
 * Queue F-02M-B6A｜Planck Fixed Mount / Weld 最小实现（保留不回删）
 *
 * 验证：
 * 1. 两刚体初始存在非零相对角度（0.5 rad），Weld 后经历重力/落地/运动，
 *    锚点最大误差 < 1px、相对角度漂移 < 0.01 rad（不逐步纠偏）；
 * 2. setAngle 非有限角度抛错；跨 World handle 抛错；
 * 3. setAngle 保留位置、不清零速度。
 */
import { describe, it, expect } from 'vitest';
import { PlanckWorld, type BodyHandle } from '../src/physics/planckWorld';

describe('F-02M-B6A · Planck Weld Joint', () => {
  it('Weld 保持非零相对角度，经重力/落地/运动锚点误差<1px、相对角漂移<0.01rad', () => {
    const world = new PlanckWorld({ x: 0, y: 10 });
    world.createStaticGround(0, 700, 4000, 80);

    // 两刚体初始非零相对角度：A 贴地（底部=groundTop 660）、B 相对偏移+旋转 0.5 rad
    const a: BodyHandle = world.createDynamicBox(0, 640, 40, 40, 5);
    const b: BodyHandle = world.createDynamicBox(20, 620, 40, 40, 5);
    world.setAngle(b, 0.5);
    const initialRelAngle = world.getAngle(b) - world.getAngle(a);
    expect(Math.abs(initialRelAngle - 0.5)).toBeLessThan(1e-9);

    // Weld：锚点 A(0,0) ↔ B(0,0)，保存当前相对角度（不归零）
    const joint = world.createWeldJoint(a, { x: 0, y: 0 }, b, { x: 0, y: 0 });

    // 同速水平运动 + 重力微沉降（仅 stepFixed，无任何逐步 setPosition/setAngle 纠偏）
    world.setLinearVelocity(a, 1, 0);
    world.setLinearVelocity(b, 1, 0);
    let maxAnchorErr = 0;
    let maxRelDrift = 0;
    for (let i = 0; i < 400; i++) {
      world.stepFixed(1);
      maxAnchorErr = Math.max(maxAnchorErr, world.getJointAnchorErrorPx(joint));
      const rel = world.getAngle(b) - world.getAngle(a);
      maxRelDrift = Math.max(maxRelDrift, Math.abs(rel - initialRelAngle));
    }

    const posA = world.getPosition(a);
    const posB = world.getPosition(b);
    console.log(
      `[B6A-1] 锚点maxErr=${maxAnchorErr.toFixed(6)}px 相对角漂移max=${maxRelDrift.toFixed(6)}rad ` +
        `终态 A=(${posA.x.toFixed(1)},${posA.y.toFixed(1)}) B=(${posB.x.toFixed(1)},${posB.y.toFixed(1)}) ` +
        `angleA=${world.getAngle(a).toFixed(4)} angleB=${world.getAngle(b).toFixed(4)}`,
    );
    // 两刚体一起运动（B 相对 A 保持恒定偏移）
    expect(posA.x).toBeGreaterThan(300); // 水平运动
    expect(maxAnchorErr).toBeLessThan(1);
    expect(maxRelDrift).toBeLessThan(0.01);
  });

  it('setAngle：有限数校验、保留位置、不清零速度', () => {
    const world = new PlanckWorld();
    const body: BodyHandle = world.createDynamicBox(0, 0, 40, 40, 5);
    world.setLinearVelocity(body, 2, 3);

    // 非有限角度抛错
    expect(() => world.setAngle(body, Number.NaN)).toThrow();
    expect(() => world.setAngle(body, Infinity)).toThrow();

    // 有限角度：位置保留、速度不清零
    world.setAngle(body, 0.75);
    expect(world.getAngle(body)).toBeCloseTo(0.75, 9);
    const pos = world.getPosition(body);
    expect(pos.x).toBe(0);
    expect(pos.y).toBe(0);
    const vel = world.getLinearVelocity(body);
    expect(vel.x).toBeCloseTo(2, 9);
    expect(vel.y).toBeCloseTo(3, 9);
  });

  it('跨 World handle 抛错', () => {
    const wa = new PlanckWorld();
    const wb = new PlanckWorld();
    const aBody = wa.createDynamicBox(0, 0, 40, 40, 5);
    const bBody = wa.createDynamicBox(10, 0, 40, 40, 5);
    const foreignBody = wb.createDynamicBox(0, 0, 40, 40, 5);
    // bBody（wa 的）不能用于 wb 的 weld
    expect(() => wb.createWeldJoint(aBody, { x: 0, y: 0 }, foreignBody, { x: 0, y: 0 })).toThrow();
    expect(() => wa.createWeldJoint(aBody, { x: 0, y: 0 }, bBody, { x: 0, y: 0 })).not.toThrow();
    // 跨 World 用 getAngle/setAngle
    expect(() => wb.getAngle(aBody)).toThrow();
    expect(() => wb.setAngle(aBody, 1)).toThrow();
  });
});
