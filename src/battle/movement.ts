/**
 * Movement Foundation：轮子真实驱动。
 *
 * 禁止 `vehicle.x += speed * dt` 之类的假移动。
 * Wheel 通过「地面接触 + Motor / Drive + Grip」提供真实牵引：
 * - 只有实际接地的 Wheel 提供驱动；
 * - 全轮腾空时，不产生凭空水平驱动力；
 * - 推不动目标 / 顶墙时允许 Wheel 打滑；
 * - 前后不同 Radius 真实改变 Body 倾角（几何自然结果）。
 *
 * 驱动实现（01A 稳定性返修后）：
 * - 牵引力用真实 `applyForce` 施加在 wheel 顶部（y - radius），力朝前进方向，
 *   同时产生向前平动（经 constraint 传车身）与正向滚动力矩（wheel 视觉滚动）。
 * - 不再用 `setAngularVelocity` 强制 wheel 角速度 —— 那是「无碰撞抬头」的根因：
 *   Matter 无真正 revolute joint，length=0 高刚度约束会被强制角速度顶起后轴。
 * - 施加「目标速度控制」：接近目标线速度后驱动力按比例衰减，达到目标速度即停止，
 *   避免固定驱动力导致的持续加速 → 持续抬头（真实物理：匀速时牵引力≈0，车身回正）。
 */
import type { Vehicle } from './vehicleAssembly';
import { applyForceAt } from '../physics/adapter';

/** 目标线速度（px/step ≈ 90 px/s）。经验标定：Matter 摩擦弱，实际可达匀速远低于理论值。 */
const TARGET_SPEED = 1.5;
/** 比例控制的速度窗口（px/step）：速度差在此区间内按比例衰减驱动力。 */
const SPEED_WINDOW = 2.0;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
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
  void dtMs;

  // 目标速度控制：当前前进速度（沿车头方向）达到目标后不再施加驱动力
  const currentSpeed = v.body.velocity.x * direction;
  const diff = TARGET_SPEED - currentSpeed;
  if (diff <= 0) return;
  const ratio = clamp01(diff / SPEED_WINDOW);

  for (const wheel of v.wheels) {
    // 只有实际接地的 Wheel 提供驱动；腾空轮不贡献牵引
    if (!wheel.grounded) continue;

    // 牵引力施加在 wheel 顶部（世界坐标上方 radius 处），力朝前进方向。
    const top = {
      x: wheel.body.position.x,
      y: wheel.body.position.y - wheel.def.radius,
    };
    const force = wheel.def.driveForce * wheel.def.grip * direction * ratio;
    applyForceAt(wheel.body, top, force, 0);
  }
}
