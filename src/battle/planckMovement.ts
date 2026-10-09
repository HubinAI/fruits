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

/**
 * 无任何有效 Movement 时的**安全 fallback** 持续速度（px/step）。
 *
 * MOVEMENT-CRUISE-SPEED-FOUNDATION-R1：与「改前玩家 auto-drive 的唯一常量」
 * `AUTO_DRIVE_TARGET_SPEED_PX_PER_STEP = 1.5` **同值**，因此卸掉全部轮组的既有
 * Build 行为逐字节不变。
 *
 * ⚠️ 语义是「**不额外创造推进能力**」：双侧皆无 Movement 时回落到既有基线值，
 * 而不是给一个更高（会凭空增强无轮车）的数字。
 */
export const FALLBACK_CRUISE_SPEED_PX_PER_STEP = 1.5;

/**
 * MOVEMENT-CRUISE-SPEED-FOUNDATION-R1｜整车持续速度解析（唯一真源）。
 *
 * 规则（按 Queue 必改 2）：
 * 1. **前后均装备 Movement** → 取两者 `cruiseSpeedPxPerStep` 的**较低者**
 *    （速度是短板效应：慢的一侧决定整车能跑多快）；
 * 2. **只有一侧有效** → 使用该侧数值；
 * 3. **无有效 Movement** → `FALLBACK_CRUISE_SPEED_PX_PER_STEP`（安全 fallback，
 *    不额外创造推进能力）。
 *
 * 非法值（非有限 / 负数）一律视为**该侧无效**，走 fallback；
 * `maxRPM` 仍由 `drivePlanckVehicle` 在轮组层独立裁决，本函数**不介入**。
 */
export function resolveVehicleCruiseSpeedPxPerStep(
  wheels: readonly { def: { cruiseSpeedPxPerStep: number } }[],
  fallback: number = FALLBACK_CRUISE_SPEED_PX_PER_STEP,
): number {
  let min: number | null = null;
  for (const w of wheels) {
    const v = w.def.cruiseSpeedPxPerStep;
    if (!Number.isFinite(v) || v < 0) continue; // 非法 ⇒ 该侧不参与
    if (min === null || v < min) min = v;
  }
  return min === null ? fallback : min;
}
