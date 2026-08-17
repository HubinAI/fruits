/**
 * Queue F-02M-A6A｜Planck 双轮车架静态停稳诊断（保留不回删）
 *
 * 场景：Y-down 重力 {x:0,y:10}，静态地面（中心 y=700、高 80、顶面 660）；
 * 1 个 dynamic box chassis（120×40、50kg、中心 (0,585)）+
 * 2 个 dynamic circle wheel（半径 20、各 10kg、中心 (±40,637)）；
 * 两个原生 RevoluteJoint：chassis 本地锚点 (±40,52)、wheel 本地锚点 (0,0)。
 * 无弹簧/支柱/位置修正/姿态锁/驱动/force/torque/impulse；轮子自由旋转。
 * 固定步进 600 步，采集车架静态停稳数据。
 */
import { describe, it, expect } from 'vitest';
import { PlanckWorld, type BodyHandle, type JointHandle } from '../src/physics/planckWorld';

const GROUND_TOP = 660; // 地面顶面
const CHASSIS_W = 120;
const CHASSIS_H = 40;
const CHASSIS_MASS = 50;
const WHEEL_R = 20;
const WHEEL_MASS = 10;
const CHASSIS_Y0 = 585;
const WHEEL_Y0 = 637;
const WHEEL_X = 40;
// chassis 本地锚点：wheel 中心相对 chassis 中心 = (±40, 637-585=+52)
const CHASSIS_ANCHOR_Y = WHEEL_Y0 - CHASSIS_Y0; // 52

interface Vehicle {
  chassis: BodyHandle;
  wheelL: BodyHandle;
  wheelR: BodyHandle;
  jL: JointHandle;
  jR: JointHandle;
}

function buildVehicle(world: PlanckWorld): Vehicle {
  const chassis = world.createDynamicBox(0, CHASSIS_Y0, CHASSIS_W, CHASSIS_H, CHASSIS_MASS);
  const wheelL = world.createDynamicCircle(-WHEEL_X, WHEEL_Y0, WHEEL_R, WHEEL_MASS);
  const wheelR = world.createDynamicCircle(WHEEL_X, WHEEL_Y0, WHEEL_R, WHEEL_MASS);
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

describe('F-02M-A6A · 双轮车架静态停稳', () => {
  it('600 步停稳：轮心稳定、姿态收敛、无穿透/NaN/脱离', () => {
    const world = new PlanckWorld({ x: 0, y: 10 });
    world.createStaticGround(0, 700, 4000, 80);
    const v = buildVehicle(world);

    let maxErrL = 0;
    let maxErrR = 0;
    let maxChassisAngle = 0;
    let maxSpeedComp = 0;
    let maxPenetration = 0;
    let nan = false;
    const sampleSteps = new Set([0, 120, 300, 600]);
    const samples: string[] = [];

    for (let i = 0; i <= 600; i++) {
      if (sampleSteps.has(i)) {
        const c = world.getPosition(v.chassis);
        const cv = world.getLinearVelocity(v.chassis);
        const ca = world.getAngle(v.chassis);
        const wl = world.getPosition(v.wheelL);
        const wlv = world.getLinearVelocity(v.wheelL);
        const wla = world.getAngle(v.wheelL);
        const wr = world.getPosition(v.wheelR);
        const wrv = world.getLinearVelocity(v.wheelR);
        const wra = world.getAngle(v.wheelR);
        samples.push(
          `[A6A-s] step=${i}  chassis pos=(${c.x.toFixed(2)},${c.y.toFixed(2)}) vel=(${cv.x.toFixed(3)},${cv.y.toFixed(3)}) angle=${ca.toFixed(5)}  ` +
            `wheelL pos=(${wl.x.toFixed(2)},${wl.y.toFixed(2)}) vel=(${wlv.x.toFixed(3)},${wlv.y.toFixed(3)}) angle=${wla.toFixed(5)}  ` +
            `wheelR pos=(${wr.x.toFixed(2)},${wr.y.toFixed(2)}) vel=(${wrv.x.toFixed(3)},${wrv.y.toFixed(3)}) angle=${wra.toFixed(5)}`,
        );
      }
      if (i === 600) break;
      world.stepFixed(1);

      const eL = world.getJointAnchorErrorPx(v.jL);
      const eR = world.getJointAnchorErrorPx(v.jR);
      maxErrL = Math.max(maxErrL, eL);
      maxErrR = Math.max(maxErrR, eR);

      const cA = Math.abs(world.getAngle(v.chassis));
      maxChassisAngle = Math.max(maxChassisAngle, cA);

      for (const h of [v.chassis, v.wheelL, v.wheelR]) {
        const p = world.getPosition(h);
        const vel = world.getLinearVelocity(h);
        maxSpeedComp = Math.max(maxSpeedComp, Math.abs(vel.x), Math.abs(vel.y));
        const a = world.getAngle(h);
        const w = world.getAngularVelocity(h);
        if (![p.x, p.y, vel.x, vel.y, a, w, eL, eR].every(Number.isFinite)) nan = true;
      }

      // wheel 对地穿透：wheel 底部（y+半径）越过 ground 顶面的量
      const penL = world.getPosition(v.wheelL).y + WHEEL_R - GROUND_TOP;
      const penR = world.getPosition(v.wheelR).y + WHEEL_R - GROUND_TOP;
      maxPenetration = Math.max(maxPenetration, Math.max(0, penL), Math.max(0, penR));
    }

    const finalChassisPos = world.getPosition(v.chassis);
    const finalAngle = world.getAngle(v.chassis);
    const finalErrL = world.getJointAnchorErrorPx(v.jL);
    const finalErrR = world.getJointAnchorErrorPx(v.jR);
    console.log(samples.join('\n'));
    console.log(
      `[A6A] 最终 chassis pos=(${finalChassisPos.x.toFixed(2)},${finalChassisPos.y.toFixed(2)})  ` +
        `maxErrL=${maxErrL.toFixed(5)} maxErrR=${maxErrR.toFixed(5)} 最终Err=(${finalErrL.toFixed(5)},${finalErrR.toFixed(5)})  ` +
        `maxChassisAngle=${maxChassisAngle.toFixed(5)} 最终angle=${finalAngle.toFixed(5)}  ` +
        `maxSpeedComp=${maxSpeedComp.toFixed(4)}  maxPenetration=${maxPenetration.toFixed(4)}  nan=${nan}`,
    );

    expect(nan).toBe(false);
    // 两 joint 最大 anchor error < 1px（无轮体脱离）
    expect(maxErrL).toBeLessThan(1);
    expect(maxErrR).toBeLessThan(1);
    // chassis 最终 |angle| < 0.0175 rad
    expect(Math.abs(finalAngle)).toBeLessThan(0.0175);
    // 任一 body 最大速度分量 < 3px/step（无爆发）
    expect(maxSpeedComp).toBeLessThan(3);
    // wheel 对地最大穿透 <= 0.5px
    expect(maxPenetration).toBeLessThanOrEqual(0.5);
  });

  it('B 水平运动：停稳后整车同速滑行 600 步', () => {
    const world = new PlanckWorld({ x: 0, y: 10 });
    world.createStaticGround(0, 700, 4000, 80);
    const v = buildVehicle(world);

    // 先静态停稳 180 步
    for (let i = 0; i < 180; i++) world.stepFixed(1);

    // 同时给 chassis + 两 wheel 相同水平速度（无驱动/force/torque/impulse）
    world.setLinearVelocity(v.chassis, 0.5, 0);
    world.setLinearVelocity(v.wheelL, 0.5, 0);
    world.setLinearVelocity(v.wheelR, 0.5, 0);

    const x0 = world.getPosition(v.chassis).x;
    let maxErrL = 0;
    let maxErrR = 0;
    let maxChassisAngle = 0;
    let maxSpeedComp = 0;
    let maxPenetration = 0;
    let nan = false;
    const sampleSteps = new Set([0, 120, 300, 600]);
    const samples: string[] = [];

    for (let i = 0; i <= 600; i++) {
      if (sampleSteps.has(i)) {
        const c = world.getPosition(v.chassis);
        const cv = world.getLinearVelocity(v.chassis);
        const ca = world.getAngle(v.chassis);
        const wl = world.getPosition(v.wheelL);
        const wlv = world.getLinearVelocity(v.wheelL);
        const wla = world.getAngle(v.wheelL);
        const wr = world.getPosition(v.wheelR);
        const wrv = world.getLinearVelocity(v.wheelR);
        const wra = world.getAngle(v.wheelR);
        samples.push(
          `[A6B-s] step=${i}  chassis pos=(${c.x.toFixed(2)},${c.y.toFixed(2)}) vel=(${cv.x.toFixed(3)},${cv.y.toFixed(3)}) angle=${ca.toFixed(5)}  ` +
            `wheelL pos=(${wl.x.toFixed(2)},${wl.y.toFixed(2)}) vel=(${wlv.x.toFixed(3)},${wlv.y.toFixed(3)}) angle=${wla.toFixed(5)}  ` +
            `wheelR pos=(${wr.x.toFixed(2)},${wr.y.toFixed(2)}) vel=(${wrv.x.toFixed(3)},${wrv.y.toFixed(3)}) angle=${wra.toFixed(5)}`,
        );
      }
      if (i === 600) break;
      world.stepFixed(1);

      const eL = world.getJointAnchorErrorPx(v.jL);
      const eR = world.getJointAnchorErrorPx(v.jR);
      maxErrL = Math.max(maxErrL, eL);
      maxErrR = Math.max(maxErrR, eR);

      const cA = Math.abs(world.getAngle(v.chassis));
      maxChassisAngle = Math.max(maxChassisAngle, cA);

      for (const h of [v.chassis, v.wheelL, v.wheelR]) {
        const p = world.getPosition(h);
        const vel = world.getLinearVelocity(h);
        maxSpeedComp = Math.max(maxSpeedComp, Math.abs(vel.x), Math.abs(vel.y));
        const a = world.getAngle(h);
        const w = world.getAngularVelocity(h);
        if (![p.x, p.y, vel.x, vel.y, a, w, eL, eR].every(Number.isFinite)) nan = true;
      }

      const penL = world.getPosition(v.wheelL).y + WHEEL_R - GROUND_TOP;
      const penR = world.getPosition(v.wheelR).y + WHEEL_R - GROUND_TOP;
      maxPenetration = Math.max(maxPenetration, Math.max(0, penL), Math.max(0, penR));
    }

    const finalChassisPos = world.getPosition(v.chassis);
    const finalAngle = world.getAngle(v.chassis);
    const distX = finalChassisPos.x - x0;
    const finalErrL = world.getJointAnchorErrorPx(v.jL);
    const finalErrR = world.getJointAnchorErrorPx(v.jR);
    console.log(samples.join('\n'));
    console.log(
      `[A6B] 行驶距离=${distX.toFixed(2)}px  maxErrL=${maxErrL.toFixed(5)} maxErrR=${maxErrR.toFixed(5)} 最终Err=(${finalErrL.toFixed(5)},${finalErrR.toFixed(5)})  ` +
        `maxChassisAngle=${maxChassisAngle.toFixed(5)} 最终angle=${finalAngle.toFixed(5)}  ` +
        `maxSpeedComp=${maxSpeedComp.toFixed(4)}  maxPenetration=${maxPenetration.toFixed(4)}  nan=${nan}`,
    );

    expect(nan).toBe(false);
    // 行驶方向正确（+x）且位移 > 200px
    expect(distX).toBeGreaterThan(200);
    // 两 joint 最大 anchor error < 2px（无脱轴）
    expect(maxErrL).toBeLessThan(2);
    expect(maxErrR).toBeLessThan(2);
    // chassis 最大 |angle| < 0.0524 rad、最终 < 0.0175 rad
    expect(maxChassisAngle).toBeLessThan(0.0524);
    expect(Math.abs(finalAngle)).toBeLessThan(0.0175);
    // 最大速度分量 < 3px/step（无爆发）
    expect(maxSpeedComp).toBeLessThan(3);
    // wheel 对地最大穿透 <= 0.5px
    expect(maxPenetration).toBeLessThanOrEqual(0.5);
  });

  it('C 扰动恢复：单次小角速度扰动后 600 步恢复稳定', () => {
    const world = new PlanckWorld({ x: 0, y: 10 });
    world.createStaticGround(0, 700, 4000, 80);
    const v = buildVehicle(world);

    // 静态停稳 180 步
    for (let i = 0; i < 180; i++) world.stepFixed(1);

    // 单次受控扰动：chassis 角速度（仅一次，禁止追加/调参/驱动/force/impulse/位置修正/姿态锁）
    world.setAngularVelocity(v.chassis, 0.002);

    let maxErrL = 0;
    let maxErrR = 0;
    let maxChassisAngle = 0;
    let maxSpeedComp = 0;
    let maxPenetration = 0;
    let nan = false;
    const sampleSteps = new Set([0, 30, 120, 300, 600]);
    const samples: string[] = [];

    for (let i = 0; i <= 600; i++) {
      if (sampleSteps.has(i)) {
        const c = world.getPosition(v.chassis);
        const cv = world.getLinearVelocity(v.chassis);
        const ca = world.getAngle(v.chassis);
        const cw = world.getAngularVelocity(v.chassis);
        const wl = world.getPosition(v.wheelL);
        const wla = world.getAngle(v.wheelL);
        const wr = world.getPosition(v.wheelR);
        const wra = world.getAngle(v.wheelR);
        samples.push(
          `[A6C-s] step=${i}  chassis pos=(${c.x.toFixed(2)},${c.y.toFixed(2)}) vel=(${cv.x.toFixed(3)},${cv.y.toFixed(3)}) angle=${ca.toFixed(6)} omega=${cw.toFixed(6)}  ` +
            `wheelL pos=(${wl.x.toFixed(2)},${wl.y.toFixed(2)}) angle=${wla.toFixed(5)}  wheelR pos=(${wr.x.toFixed(2)},${wr.y.toFixed(2)}) angle=${wra.toFixed(5)}`,
        );
      }
      if (i === 600) break;
      world.stepFixed(1);

      const eL = world.getJointAnchorErrorPx(v.jL);
      const eR = world.getJointAnchorErrorPx(v.jR);
      maxErrL = Math.max(maxErrL, eL);
      maxErrR = Math.max(maxErrR, eR);

      const cA = Math.abs(world.getAngle(v.chassis));
      maxChassisAngle = Math.max(maxChassisAngle, cA);

      for (const h of [v.chassis, v.wheelL, v.wheelR]) {
        const p = world.getPosition(h);
        const vel = world.getLinearVelocity(h);
        maxSpeedComp = Math.max(maxSpeedComp, Math.abs(vel.x), Math.abs(vel.y));
        const a = world.getAngle(h);
        const w = world.getAngularVelocity(h);
        if (![p.x, p.y, vel.x, vel.y, a, w, eL, eR].every(Number.isFinite)) nan = true;
      }

      const penL = world.getPosition(v.wheelL).y + WHEEL_R - GROUND_TOP;
      const penR = world.getPosition(v.wheelR).y + WHEEL_R - GROUND_TOP;
      maxPenetration = Math.max(maxPenetration, Math.max(0, penL), Math.max(0, penR));
    }

    const finalAngle = world.getAngle(v.chassis);
    const finalOmega = world.getAngularVelocity(v.chassis);
    const finalErrL = world.getJointAnchorErrorPx(v.jL);
    const finalErrR = world.getJointAnchorErrorPx(v.jR);

    // 扰动生效确认：全程出现过非零 chassis angle（否则停止报告，不自行增大参数）
    const disturbanceEffective = maxChassisAngle > 1e-6;

    console.log(samples.join('\n'));
    console.log(
      `[A6C] maxErrL=${maxErrL.toFixed(5)} maxErrR=${maxErrR.toFixed(5)} 最终Err=(${finalErrL.toFixed(5)},${finalErrR.toFixed(5)})  ` +
        `maxChassisAngle=${maxChassisAngle.toFixed(6)} 最终angle=${finalAngle.toFixed(6)} 最终omega=${finalOmega.toExponential(3)}  ` +
        `maxSpeedComp=${maxSpeedComp.toFixed(4)}  maxPenetration=${maxPenetration.toFixed(4)}  nan=${nan}  disturbanceEffective=${disturbanceEffective}`,
    );

    if (!disturbanceEffective) {
      console.log('[结论] 扰动未生效（chassis angle 恒为 0），停止报告，不自行增大参数');
      expect(disturbanceEffective).toBe(true);
      return;
    }

    expect(nan).toBe(false);
    // 两 joint 最大 anchor error < 2px
    expect(maxErrL).toBeLessThan(2);
    expect(maxErrR).toBeLessThan(2);
    // chassis 最大 |angle| < 0.0524 rad、最终 < 0.0175 rad
    expect(maxChassisAngle).toBeLessThan(0.0524);
    expect(Math.abs(finalAngle)).toBeLessThan(0.0175);
    // 最终 |angularVelocity| < 0.001 rad/step（已恢复静止）
    expect(Math.abs(finalOmega)).toBeLessThan(0.001);
    // 最大速度分量 < 3px/step
    expect(maxSpeedComp).toBeLessThan(3);
    // wheel 对地最大穿透 <= 0.5px
    expect(maxPenetration).toBeLessThanOrEqual(0.5);

    console.log('[结论] Planck 双轮 Revolute 结构通过，可进入 A7');
  });
});
