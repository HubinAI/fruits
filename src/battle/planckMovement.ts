/**
 * 正式 Planck Wheel Movement（Queue F-02M-B10A2）。
 *
 * 统一驱动入口：对 `PlanckVehicle` 的全部 wheel 施加 Revolute motor，
 * 参数由 wheel 真实 def（radius/mass/driveTorque/maxRPM）经 units.ts 推导，
 * 全部换算走已验证契约（B10D1 / B10A1）。
 *
 * 约束：
 * - 禁止 force/impulse、setVelocity、setPosition、姿态锁、经验倍率、
 *   grip 二次乘扭矩；
 * - 禁止 Matter/adapter import、Planck native 类型、as any / as unknown；
 * - disabled 只关闭 motor：不改 body/wheel 速度、不刹停、不归零。
 */
import type { PlanckWorld } from '../physics/planckWorld';
import type { PlanckVehicle } from './planckVehicleAssembly';
import {
  angularAccelerationToTorqueNm,
  rpmToRadPerStep,
  solidDiskInertiaKgM2,
} from '../physics/units';

/** 驱动指令（引擎中立语义：worldDirection 面向 world +x） */
export interface PlanckDriveCommand {
  enabled: boolean;
  /** +1 朝 +x、-1 朝 -x（与 facing 无关，由调用方决定） */
  worldDirection: 1 | -1;
  /** 目标线速度（px/step，非负） */
  targetSpeedPxPerStep: number;
}

/**
 * 对车辆全部 wheel 施加 motor 驱动。
 * 每个 wheel：
 *   targetAngularSpeed = targetSpeedPxPerStep / radius
 *   rpmLimit           = rpmToRadPerStep(maxRPM)
 *   speedRadPerStep    = worldDirection × min(targetAngularSpeed, rpmLimit)
 *   inertia            = solidDiskInertiaKgM2(mass, radius)
 *   maxTorqueNm        = angularAccelerationToTorqueNm(driveTorque, inertia)
 *   motor.enabled      = command.enabled && wheel.grounded
 */
export function drivePlanckVehicle(
  world: PlanckWorld,
  vehicle: PlanckVehicle,
  command: PlanckDriveCommand,
): void {
  if (
    !Number.isFinite(command.targetSpeedPxPerStep) ||
    command.targetSpeedPxPerStep < 0
  ) {
    throw new Error(
      `PlanckDrive: targetSpeedPxPerStep 必须为有限且 >= 0（收到 ${command.targetSpeedPxPerStep}）`,
    );
  }
  for (const w of vehicle.wheels) {
    const targetAngularSpeed = command.targetSpeedPxPerStep / w.def.radius;
    const rpmLimit = rpmToRadPerStep(w.def.maxRPM);
    const speedRadPerStep =
      command.worldDirection * Math.min(targetAngularSpeed, rpmLimit);
    const inertia = solidDiskInertiaKgM2(w.def.mass, w.def.radius);
    const maxTorqueNm = angularAccelerationToTorqueNm(
      w.def.driveTorque,
      inertia,
    );
    world.setRevoluteMotor(w.joint, {
      enabled: command.enabled && w.grounded,
      speedRadPerStep,
      maxTorqueNm,
    });
  }
}
