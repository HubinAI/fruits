/**
 * Queue F-02M-B10A2｜正式 Planck Wheel Movement 测试
 *
 * 使用真实 createPlanckVehicle（boxBody + wheelStd×2），正式 drivePlanckVehicle：
 * 1. grounded=false 或 enabled=false → motor 不驱动（车不动）；
 * 2. target=1.5、grounded=true：A(+1)/B(-1) 独立世界 600 步，方向镜像；
 *    复验 B10D1 的速度/姿态/锚点/穿透/有限数；
 * 3. ON→OFF：关闭后继续同向滑行，关闭瞬间 |Δvx|<0.1，不制动、不反向。
 */
import { describe, it, expect } from 'vitest';
import { createRegistry } from '../src/core/content';
import { resolveSnapshot } from '../src/core/buildSnapshot';
import { getPreset } from '../src/lab/presets';
import { PlanckWorld } from '../src/physics/planckWorld';
import {
  createPlanckVehicle,
  type PlanckVehicle,
} from '../src/battle/planckVehicleAssembly';
import { drivePlanckVehicle } from '../src/battle/planckMovement';

const registry = createRegistry();

/** 真实 Planck 车辆（boxBody + wheelStd×2），贴地 spawn（chassis y=613 → wheel 最低点=660） */
function makeVehicle(facing: 1 | -1): { world: PlanckWorld; v: PlanckVehicle } {
  const world = new PlanckWorld({ x: 0, y: 10 });
  world.createStaticGround(0, 700, 4000, 80); // 顶面 660
  const resolved = resolveSnapshot(getPreset('lightVehicle')!.build(), registry);
  const v = createPlanckVehicle(world, resolved, 'A', { x: 0, y: 613 }, facing);
  return { world, v };
}

/** 标记全部 wheel 接地（模拟 Router wheel-ground begin 后的状态） */
function setGrounded(v: PlanckVehicle, grounded: boolean): void {
  for (const w of v.wheels) w.grounded = grounded;
}

/** 采集一次运行的状态汇总 */
interface RunSummary {
  dist: number;
  vx: number;
  maxAngle: number;
  finalAngle: number;
  maxAnchorErr: number;
  maxPenetration: number;
  maxSpeed: number;
  nan: boolean;
  wheelOmega: number;
  slip: number;
}

function run(
  world: PlanckWorld,
  v: PlanckVehicle,
  steps: number,
): RunSummary {
  let maxAngle = 0;
  let finalAngle = 0;
  let maxAnchorErr = 0;
  let maxPenetration = 0;
  let maxSpeed = 0;
  let nan = false;
  const x0 = world.getPosition(v.body).x;
  for (let i = 0; i < steps; i++) {
    world.stepFixed(1);
    const pos = world.getPosition(v.body);
    const vel = world.getLinearVelocity(v.body);
    const angle = world.getAngle(v.body);
    maxAngle = Math.max(maxAngle, Math.abs(angle));
    finalAngle = angle;
    maxSpeed = Math.max(maxSpeed, Math.abs(vel.x), Math.abs(vel.y));
    for (const w of v.wheels) {
      maxAnchorErr = Math.max(maxAnchorErr, world.getJointAnchorErrorPx(w.joint));
      const wp = world.getPosition(w.body);
      maxPenetration = Math.max(maxPenetration, Math.max(0, wp.y + w.def.radius - 660));
    }
    if (![pos.x, pos.y, vel.x, vel.y, angle].every(Number.isFinite)) nan = true;
  }
  const vel = world.getLinearVelocity(v.body);
  const front = v.wheels.find((w) => w.id === 'front')!;
  const wheelOmega = world.getAngularVelocity(front.body);
  return {
    dist: world.getPosition(v.body).x - x0,
    vx: vel.x,
    maxAngle,
    finalAngle,
    maxAnchorErr,
    maxPenetration,
    maxSpeed,
    nan,
    wheelOmega,
    slip: Math.abs(vel.x - wheelOmega * front.def.radius),
  };
}

describe('F-02M-B10A2 · 正式 Planck Wheel Movement', () => {
  it('grounded=false 或 enabled=false：motor 不驱动车辆', () => {
    // a) grounded=false（默认）且 enabled=true
    const { world: w1, v: v1 } = makeVehicle(1);
    drivePlanckVehicle(w1, v1, { enabled: true, worldDirection: 1, targetSpeedPxPerStep: 1.5 });
    for (let i = 0; i < 300; i++) w1.stepFixed(1);
    const d1 = Math.abs(w1.getPosition(v1.body).x);

    // b) grounded=true 但 enabled=false
    const { world: w2, v: v2 } = makeVehicle(1);
    setGrounded(v2, true);
    drivePlanckVehicle(w2, v2, { enabled: false, worldDirection: 1, targetSpeedPxPerStep: 1.5 });
    for (let i = 0; i < 300; i++) w2.stepFixed(1);
    const d2 = Math.abs(w2.getPosition(v2.body).x);

    expect(d1).toBeLessThan(1); // 未接地 → 不驱动
    expect(d2).toBeLessThan(1); // 未启用 → 不驱动
    console.log(`[B10A2-1] grounded=false 位移=${d1.toFixed(4)}px | enabled=false 位移=${d2.toFixed(4)}px`);
  });

  it('target=1.5、grounded=true：A(+1) 与 B(-1) 镜像驱动 600 步（复验 B10D1）', () => {
    // 推导参数复验：speed=0.075 rad/step、torque=20 N·m（wheelStd: r20/m10/driveTorque100/maxRPM300）
    // targetAngularSpeed = 1.5/20 = 0.075 < rpmLimit(0.5236) → speed=0.075
    const { world: wa, v: va } = makeVehicle(1);
    const { world: wb, v: vb } = makeVehicle(-1);
    setGrounded(va, true);
    setGrounded(vb, true);
    drivePlanckVehicle(wa, va, { enabled: true, worldDirection: 1, targetSpeedPxPerStep: 1.5 });
    drivePlanckVehicle(wb, vb, { enabled: true, worldDirection: -1, targetSpeedPxPerStep: 1.5 });

    const a = run(wa, va, 600);
    const b = run(wb, vb, 600);

    console.log(
      `[B10A2-2] A dist=${a.dist.toFixed(2)} vx=${a.vx.toFixed(4)} ω=${a.wheelOmega.toFixed(5)} slip=${a.slip.toFixed(4)} ` +
        `angle=${a.maxAngle.toFixed(5)}/${a.finalAngle.toFixed(5)} anchor=${a.maxAnchorErr.toFixed(5)} ` +
        `pen=${a.maxPenetration.toFixed(4)} maxSpeed=${a.maxSpeed.toFixed(4)}`,
    );
    console.log(
      `[B10A2-2] B dist=${b.dist.toFixed(2)} vx=${b.vx.toFixed(4)} ω=${b.wheelOmega.toFixed(5)} slip=${b.slip.toFixed(4)} ` +
        `angle=${b.maxAngle.toFixed(5)}/${b.finalAngle.toFixed(5)} anchor=${b.maxAnchorErr.toFixed(5)} ` +
        `pen=${b.maxPenetration.toFixed(4)} maxSpeed=${b.maxSpeed.toFixed(4)} |vx差|=${Math.abs(Math.abs(a.vx) - Math.abs(b.vx)).toFixed(4)}`,
    );

    expect(a.dist).toBeGreaterThan(100);
    expect(b.dist).toBeLessThan(-100);
    expect(a.vx).toBeGreaterThan(0);
    expect(b.vx).toBeLessThan(0);
    expect(Math.abs(Math.abs(a.vx) - Math.abs(b.vx))).toBeLessThan(0.05);
    expect(a.maxAnchorErr).toBeLessThan(2);
    expect(b.maxAnchorErr).toBeLessThan(2);
    expect(a.maxAngle).toBeLessThan(0.0524);
    expect(b.maxAngle).toBeLessThan(0.0524);
    expect(Math.abs(a.finalAngle)).toBeLessThan(0.0175);
    expect(Math.abs(b.finalAngle)).toBeLessThan(0.0175);
    expect(a.maxSpeed).toBeLessThan(3);
    expect(b.maxSpeed).toBeLessThan(3);
    expect(a.maxPenetration).toBeLessThanOrEqual(0.5);
    expect(b.maxPenetration).toBeLessThanOrEqual(0.5);
    expect(a.nan).toBe(false);
    expect(b.nan).toBe(false);
    // 推导复验：ω 达到目标 0.075 rad/step（镜像符号），近纯滚动
    expect(Math.abs(Math.abs(a.wheelOmega) - 0.075)).toBeLessThan(1e-3);
    expect(Math.abs(Math.abs(b.wheelOmega) - 0.075)).toBeLessThan(1e-3);
    expect(a.slip).toBeLessThan(0.03);
    expect(b.slip).toBeLessThan(0.03);
  });

  it('ON→OFF：关闭后继续同向滑行，|Δvx|<0.1，不制动不反向', () => {
    const { world, v } = makeVehicle(1);
    setGrounded(v, true);

    // ON 阶段 600 步
    drivePlanckVehicle(world, v, { enabled: true, worldDirection: 1, targetSpeedPxPerStep: 1.5 });
    for (let i = 0; i < 600; i++) world.stepFixed(1);
    const vxBeforeOff = world.getLinearVelocity(v.body).x;
    const xAtOff = world.getPosition(v.body).x;

    // OFF（grounded 保持 true、enabled=false → 只关闭 motor）
    drivePlanckVehicle(world, v, { enabled: false, worldDirection: 1, targetSpeedPxPerStep: 1.5 });
    world.stepFixed(1);
    const vxAfterOff1 = world.getLinearVelocity(v.body).x;
    const deltaVx = Math.abs(vxAfterOff1 - vxBeforeOff);

    // 继续 300 步滑行
    const x300 = (() => {
      for (let i = 0; i < 300; i++) world.stepFixed(1);
      return world.getPosition(v.body).x;
    })();
    const vxFinal = world.getLinearVelocity(v.body).x;

    console.log(
      `[B10A2-3] 关闭前 vx=${vxBeforeOff.toFixed(4)} 关闭瞬间 vx=${vxAfterOff1.toFixed(4)} |Δvx|=${deltaVx.toFixed(4)} ` +
        `OFF 后 300 步位移=${(x300 - xAtOff).toFixed(2)}px 最终 vx=${vxFinal.toFixed(4)}`,
    );

    expect(deltaVx).toBeLessThan(0.1); // 关闭瞬间无速度跳变
    expect(x300 - xAtOff).toBeGreaterThan(100); // 继续同向滑行 >100px
    expect(vxFinal).toBeGreaterThan(0.05); // 不制动
    expect(vxFinal).toBeGreaterThan(0); // 不反向
  });
});
