/**
 * Movement Foundation：轮子真实驱动。
 *
 * 禁止 `vehicle.x += speed * dt` 之类的假移动。
 * Wheel 通过「地面接触 + Motor / Drive + Grip」提供真实牵引：
 * - 只有实际接地的 Wheel 提供驱动（施加真实水平牵引力 + 驱动转速）；
 * - 全轮腾空时，不产生凭空水平驱动力；
 * - 推不动目标 / 顶墙时允许 Wheel 打滑（角速度到 maxRPM 但车身被约束住）；
 * - 前后不同 Radius 真实改变 Body 倾角（几何自然结果）。
 *
 * 说明：Matter 的 Coulomb 摩擦模型对「纯滚动」的法向力（源于穿透）在静态平衡时趋近于 0，
 * 单靠 setAngularVelocity 无法高效驱动整车；因此接地轮额外施加真实水平牵引力（applyForce，
 * 通过物理积分产生加速度，而非直接改坐标），腾空轮则完全不施力。
 */
import type { Vehicle } from './vehicleAssembly';
import { addAngularVelocity, applyForce } from '../physics/adapter';

/** RPM → 弧度/秒 */
const RPM_TO_RAD = (Math.PI * 2) / 60;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * 驱动整车。
 * @param direction 前进方向：+1 朝车头（+X 局部）前进，-1 倒退。
 * @param dtMs 本物理步时长（ms）。
 */
export function driveVehicle(
  v: Vehicle,
  dtMs: number,
  direction: 1 | -1 = 1,
): void {
  const dtSec = dtMs / 1000;
  for (const wheel of v.wheels) {
    // 只有实际接地的 Wheel 提供驱动；腾空轮不贡献牵引
    if (!wheel.grounded) continue;

    // 1. 驱动 wheel 转速（Motor / Drive Torque，视觉 + 物理）
    const targetAV = wheel.def.maxRPM * RPM_TO_RAD * direction;
    const current = wheel.body.angularVelocity;
    const diff = targetAV - current;
    const maxDelta = wheel.def.driveTorque * dtSec;
    addAngularVelocity(wheel.body, clamp(diff, -maxDelta, maxDelta));

    // 2. 施加真实水平牵引力（Drive Force × Grip，作用于车身）
    applyForce(v.body, wheel.def.driveForce * wheel.def.grip * direction, 0);
  }
}
