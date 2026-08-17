/**
 * Queue F-02M-A7｜Wheel friction 与自然滚动（保留不回删）
 *
 * 固定对照：单 wheel 在 ground 上以初始 vx=0.5、omega=0 滑行，
 * 分别运行 friction=0 与 friction=1 各 600 步，观察自然滚动行为。
 * 禁止参数扫描、motor、force、torque、impulse。
 *
 * Y-down：重力 {x:0,y:10}；ground 中心 y=700、高 80（friction=1，顶面 660）；
 * wheel 中心 y=637、半径 20、10kg（底部 657，初始距地面 3px）。
 */
import { describe, it, expect } from 'vitest';
import { PlanckWorld, type BodyHandle } from '../src/physics/planckWorld';

const GROUND_TOP = 660;
const WHEEL_R = 20;
const WHEEL_Y0 = 637;
const VX0 = 0.5;

function runRoll(friction: number): {
  finalX: number;
  vx: number;
  vy: number;
  omega: number;
  slip: number;
  distX: number;
  maxSpeed: number;
  maxPenetration: number;
  nan: boolean;
} {
  const world = new PlanckWorld({ x: 0, y: 10 });
  world.createStaticGround(0, 700, 4000, 80);
  const wheel: BodyHandle = world.createDynamicCircle(0, WHEEL_Y0, WHEEL_R, 10, { friction });
  world.setLinearVelocity(wheel, VX0, 0); // omega 初始为 0（默认）

  let maxSpeed = 0;
  let maxPenetration = 0;
  let nan = false;
  for (let i = 0; i < 600; i++) {
    world.stepFixed(1);
    const p = world.getPosition(wheel);
    const vel = world.getLinearVelocity(wheel);
    maxSpeed = Math.max(maxSpeed, Math.abs(vel.x), Math.abs(vel.y));
    const pen = p.y + WHEEL_R - GROUND_TOP;
    maxPenetration = Math.max(maxPenetration, Math.max(0, pen));
    const a = world.getAngle(wheel);
    const w = world.getAngularVelocity(wheel);
    if (![p.x, p.y, vel.x, vel.y, a, w].every(Number.isFinite)) nan = true;
  }

  const p = world.getPosition(wheel);
  const vel = world.getLinearVelocity(wheel);
  const omega = world.getAngularVelocity(wheel);
  return {
    finalX: p.x,
    vx: vel.x,
    vy: vel.y,
    omega,
    slip: Math.abs(vel.x - omega * WHEEL_R),
    distX: p.x - 0,
    maxSpeed,
    maxPenetration,
    nan,
  };
}

describe('F-02M-A7 · Wheel friction 与自然滚动', () => {
  it('friction=0 无摩擦滑行 vs friction=1 自然滚动（600 步）', () => {
    const r0 = runRoll(0);
    const r1 = runRoll(1);

    console.log(
      `[A7-0] friction=0 最终 vx=${r0.vx.toFixed(4)} omega=${r0.omega.toExponential(3)} ` +
        `omega×r=${(r0.omega * WHEEL_R).toExponential(3)} 滑差=${r0.slip.toFixed(6)} ` +
        `行驶=${r0.distX.toFixed(2)}px maxSpeed=${r0.maxSpeed.toFixed(4)} maxPen=${r0.maxPenetration.toFixed(4)} NaN=${r0.nan}`,
    );
    console.log(
      `[A7-1] friction=1 最终 vx=${r1.vx.toFixed(4)} omega=${r1.omega.toFixed(5)} ` +
        `omega×r=${(r1.omega * WHEEL_R).toFixed(4)} 滑差=${r1.slip.toFixed(6)} ` +
        `行驶=${r1.distX.toFixed(2)}px maxSpeed=${r1.maxSpeed.toFixed(4)} maxPen=${r1.maxPenetration.toFixed(4)} NaN=${r1.nan}`,
    );

    // friction=0：omega 保持 ~0，vx 保持约 0.5（无摩擦滑行）
    expect(r0.nan).toBe(false);
    expect(Math.abs(r0.omega)).toBeLessThan(1e-6);
    expect(Math.abs(r0.vx - VX0)).toBeLessThan(0.05);
    expect(r0.maxSpeed).toBeLessThan(3);
    expect(r0.maxPenetration).toBeLessThanOrEqual(0.5);

    // friction=1：自然滚动（omega 显著非零、近纯滚动、前进）
    expect(r1.nan).toBe(false);
    expect(Math.abs(r1.omega)).toBeGreaterThan(0.005);
    expect(r1.slip).toBeLessThan(0.03);
    expect(r1.distX).toBeGreaterThan(150);
    expect(r1.maxSpeed).toBeLessThan(3);
    expect(r1.maxPenetration).toBeLessThanOrEqual(0.5);
  });
});
