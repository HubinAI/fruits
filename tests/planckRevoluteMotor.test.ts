/**
 * Queue F-02M-A8｜Planck Revolute motor ON/OFF 驱动验证（保留不回删）
 *
 * 复用 A6 双轮车架与地面，两轮 friction=1；
 * motor speed=0.02 rad/step、maxTorque=5 N·m，不扫描参数。
 *
 * 测试1 OFF 控制：停稳后 motor 保持 disabled，车不自行行驶。
 * 测试2 ON→OFF：启 motor 前进（+x），关闭后惯性滑行（不得刹停/归零/反向）。
 *
 * Y-down：重力 {x:0,y:10}；ground 中心 y=700、高 80（顶面 660）；
 * chassis 120×40/50kg 中心(0,585)；wheel r20/10kg friction=1 中心(±40,637)；
 * RevoluteJoint chassis 本地锚(±40,52)、wheel 本地锚(0,0)。
 */
import { describe, it, expect } from 'vitest';
import { PlanckWorld, type BodyHandle, type JointHandle } from '../src/physics/planckWorld';

const GROUND_TOP = 660;
const CHASSIS_W = 120;
const CHASSIS_H = 40;
const CHASSIS_MASS = 50;
const WHEEL_R = 20;
const WHEEL_MASS = 10;
const CHASSIS_Y0 = 585;
const WHEEL_Y0 = 637;
const WHEEL_X = 40;
const CHASSIS_ANCHOR_Y = WHEEL_Y0 - CHASSIS_Y0; // 52

const MOTOR = { enabled: true, speedRadPerStep: 0.02, maxTorqueNm: 5 };
const MOTOR_OFF = { ...MOTOR, enabled: false };

interface Vehicle {
  chassis: BodyHandle;
  wheelL: BodyHandle;
  wheelR: BodyHandle;
  jL: JointHandle;
  jR: JointHandle;
}

function buildVehicle(world: PlanckWorld): Vehicle {
  const chassis = world.createDynamicBox(0, CHASSIS_Y0, CHASSIS_W, CHASSIS_H, CHASSIS_MASS);
  const wheelL = world.createDynamicCircle(-WHEEL_X, WHEEL_Y0, WHEEL_R, WHEEL_MASS, { friction: 1 });
  const wheelR = world.createDynamicCircle(WHEEL_X, WHEEL_Y0, WHEEL_R, WHEEL_MASS, { friction: 1 });
  const jL = world.createRevoluteJoint(
    chassis,
    { x: -WHEEL_X, y: CHASSIS_ANCHOR_Y },
    wheelL,
    { x: 0, y: 0 },
  );
  const jR = world.createRevoluteJoint(
    chassis,
    { x: WHEEL_X, y: CHASSIS_ANCHOR_Y },
    wheelR,
    { x: 0, y: 0 },
  );
  return { chassis, wheelL, wheelR, jL, jR };
}

function stateLine(world: PlanckWorld, v: Vehicle, label: string, step: number): string {
  const c = world.getPosition(v.chassis);
  const cv = world.getLinearVelocity(v.chassis);
  const ca = world.getAngle(v.chassis);
  const oL = world.getAngularVelocity(v.wheelL);
  const oR = world.getAngularVelocity(v.wheelR);
  const eL = world.getJointAnchorErrorPx(v.jL);
  const eR = world.getJointAnchorErrorPx(v.jR);
  return (
    `[${label}] step=${step} chassis=(${c.x.toFixed(2)},${c.y.toFixed(2)}) vx=${cv.x.toFixed(4)} angle=${ca.toFixed(5)} ` +
    `wheelOmega=(${oL.toFixed(4)},${oR.toFixed(4)}) anchorErr=(${eL.toFixed(5)},${eR.toFixed(5)})`
  );
}

describe('F-02M-A8 · Revolute motor ON/OFF 驱动', () => {
  it('测试1 OFF 控制：motor 保持 disabled，车不自行行驶', () => {
    const world = new PlanckWorld({ x: 0, y: 10 });
    world.createStaticGround(0, 700, 4000, 80);
    const v = buildVehicle(world);
    // 显式保持 disabled（默认即 disabled；再次调用确认无副作用）
    world.setRevoluteMotor(v.jL, MOTOR_OFF);
    world.setRevoluteMotor(v.jR, MOTOR_OFF);

    // 停稳 180 步
    for (let i = 0; i < 180; i++) world.stepFixed(1);
    const x0 = world.getPosition(v.chassis).x;

    let maxSpeed = 0;
    let maxPen = 0;
    let maxErr = 0;
    let nan = false;
    // 再运行 300 步（motor 仍 disabled）
    for (let i = 0; i < 300; i++) {
      world.stepFixed(1);
      const p = world.getPosition(v.chassis);
      const vel = world.getLinearVelocity(v.chassis);
      maxSpeed = Math.max(maxSpeed, Math.abs(vel.x), Math.abs(vel.y));
      maxPen = Math.max(maxPen, Math.max(0, p.y + CHASSIS_H / 2 - GROUND_TOP));
      maxErr = Math.max(maxErr, world.getJointAnchorErrorPx(v.jL), world.getJointAnchorErrorPx(v.jR));
      for (const h of [v.chassis, v.wheelL, v.wheelR]) {
        const pos = world.getPosition(h);
        const lv = world.getLinearVelocity(h);
        const a = world.getAngle(h);
        const w = world.getAngularVelocity(h);
        if (![pos.x, pos.y, lv.x, lv.y, a, w].every(Number.isFinite)) nan = true;
      }
    }

    const pos = world.getPosition(v.chassis);
    const vel = world.getLinearVelocity(v.chassis);
    const dx = pos.x - x0;
    console.log(
      `[A8-1] 停稳后 300 步（motor disabled）：位移=${dx.toFixed(4)}px vx=${vel.x.toFixed(5)} ` +
        `maxSpeed=${maxSpeed.toFixed(4)} maxPen=${maxPen.toFixed(4)} maxErr=${maxErr.toFixed(5)} NaN=${nan}`,
    );

    expect(nan).toBe(false);
    // chassis 水平位移 < 1px、|vx| < 0.01（不被电机主动驱动）
    expect(Math.abs(dx)).toBeLessThan(1);
    expect(Math.abs(vel.x)).toBeLessThan(0.01);
    // 无爆发/穿透/脱离
    expect(maxSpeed).toBeLessThan(3);
    expect(maxPen).toBeLessThanOrEqual(0.5);
    expect(maxErr).toBeLessThan(2);
  });

  it('测试2 ON→OFF：电机驱动前进，关闭后惯性滑行（不刹停/不反向）', () => {
    const world = new PlanckWorld({ x: 0, y: 10 });
    world.createStaticGround(0, 700, 4000, 80);
    const v = buildVehicle(world);

    // 停稳 180 步
    for (let i = 0; i < 180; i++) world.stepFixed(1);
    const xStart = world.getPosition(v.chassis).x;

    let maxSpeed = 0;
    let maxPen = 0;
    let maxErr = 0;
    let maxChassisAngle = 0;
    let nan = false;
    const onSamples: string[] = [];
    const offSamples: string[] = [];

    // ---- ON 300 步 ----
    world.setRevoluteMotor(v.jL, MOTOR);
    world.setRevoluteMotor(v.jR, MOTOR);
    for (let i = 0; i <= 300; i++) {
      if (i === 0 || i === 60 || i === 180 || i === 300) {
        onSamples.push(stateLine(world, v, 'A8-2ON', i));
      }
      if (i === 300) break;
      world.stepFixed(1);
      const vel = world.getLinearVelocity(v.chassis);
      maxSpeed = Math.max(maxSpeed, Math.abs(vel.x), Math.abs(vel.y));
      maxErr = Math.max(maxErr, world.getJointAnchorErrorPx(v.jL), world.getJointAnchorErrorPx(v.jR));
      maxChassisAngle = Math.max(maxChassisAngle, Math.abs(world.getAngle(v.chassis)));
      const p = world.getPosition(v.chassis);
      maxPen = Math.max(maxPen, Math.max(0, p.y + CHASSIS_H / 2 - GROUND_TOP));
      for (const h of [v.chassis, v.wheelL, v.wheelR]) {
        const pos = world.getPosition(h);
        const lv = world.getLinearVelocity(h);
        const a = world.getAngle(h);
        const w = world.getAngularVelocity(h);
        if (![pos.x, pos.y, lv.x, lv.y, a, w].every(Number.isFinite)) nan = true;
      }
    }
    const xOnEnd = world.getPosition(v.chassis).x;
    const onDist = xOnEnd - xStart;
    const vxBeforeOff = world.getLinearVelocity(v.chassis).x;

    // ---- OFF 300 步 ----
    world.setRevoluteMotor(v.jL, MOTOR_OFF);
    world.setRevoluteMotor(v.jR, MOTOR_OFF);
    let vxStep1AfterOff = 0;
    for (let i = 1; i <= 300; i++) {
      world.stepFixed(1);
      if (i === 1) {
        offSamples.push(stateLine(world, v, 'A8-2OFF', i));
        vxStep1AfterOff = world.getLinearVelocity(v.chassis).x; // 关闭后第一步瞬时 vx
      }
      const vel = world.getLinearVelocity(v.chassis);
      maxSpeed = Math.max(maxSpeed, Math.abs(vel.x), Math.abs(vel.y));
      maxErr = Math.max(maxErr, world.getJointAnchorErrorPx(v.jL), world.getJointAnchorErrorPx(v.jR));
      maxChassisAngle = Math.max(maxChassisAngle, Math.abs(world.getAngle(v.chassis)));
      const p = world.getPosition(v.chassis);
      maxPen = Math.max(maxPen, Math.max(0, p.y + CHASSIS_H / 2 - GROUND_TOP));
      for (const h of [v.chassis, v.wheelL, v.wheelR]) {
        const pos = world.getPosition(h);
        const lv = world.getLinearVelocity(h);
        const a = world.getAngle(h);
        const w = world.getAngularVelocity(h);
        if (![pos.x, pos.y, lv.x, lv.y, a, w].every(Number.isFinite)) nan = true;
      }
      if (i === 120 || i === 300) offSamples.push(stateLine(world, v, 'A8-2OFF', i));
    }

    const finalPos = world.getPosition(v.chassis);
    const finalVx = world.getLinearVelocity(v.chassis).x;
    const finalAngle = world.getAngle(v.chassis);
    const totalDist = finalPos.x - xStart;
    const deltaVx = vxStep1AfterOff - vxBeforeOff; // 关闭前后第一步瞬时速度差

    console.log(onSamples.join('\n'));
    console.log(offSamples.join('\n'));
    console.log(
      `[A8-2] ON 阶段行驶=${onDist.toFixed(2)}px 全程总行驶=${totalDist.toFixed(2)}px ` +
        `关闭前 vx=${vxBeforeOff.toFixed(4)} 关闭后第一步 vx=${vxStep1AfterOff.toFixed(4)} Δvx(瞬时)=${deltaVx.toFixed(4)} ` +
        `最终 vx=${finalVx.toFixed(4)} ` +
        `maxChassisAngle=${maxChassisAngle.toFixed(5)} 最终angle=${finalAngle.toFixed(5)} ` +
        `maxErr=${maxErr.toFixed(5)} maxSpeed=${maxSpeed.toFixed(4)} maxPen=${maxPen.toFixed(4)} NaN=${nan}`,
    );

    expect(nan).toBe(false);
    // ON 阶段向 +x 行驶 > 50px
    expect(onDist).toBeGreaterThan(50);
    // 全程总行驶 > 100px
    expect(totalDist).toBeGreaterThan(100);
    // 关闭后仍同向滑行，最终 vx > 0.05
    expect(finalVx).toBeGreaterThan(0.05);
    // 关闭瞬间无速度跳变（motor 只停止施加扭矩，不刹停/不反向）
    expect(Math.abs(deltaVx)).toBeLessThan(0.1);
    // 约束健康
    expect(maxErr).toBeLessThan(2);
    expect(maxChassisAngle).toBeLessThan(0.0524);
    expect(Math.abs(finalAngle)).toBeLessThan(0.0175);
    expect(maxSpeed).toBeLessThan(3);
    expect(maxPen).toBeLessThanOrEqual(0.5);
  });
});
