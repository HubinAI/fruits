/**
 * Heavy Hammer（挥击武器）驱动。
 *
 * - Hammer arm 是 compound（杆 + 锤头），通过 Revolute Joint 绕 hardpoint 旋转；
 * - 冷却到点后，给 arm 施加一次角速度冲量（真实物理），arm 绕 hardpoint 挥击，
 *   命中走正式 Contact → Damage Resolver（由 contactRouter 处理），本模块只管挥击；
 * - 挥击方向由 facing 决定（左右镜像）；无自动瞄准、无追踪、允许挥空。
 * - part.swinging 记录「挥击中」状态（剩余 ms），供 contactRouter 判定有效接触
 *   （Matter 软约束会快速衰减 arm 角速度，不能可靠用角速度阈值判定挥击）。
 */
import type { HammerParams } from '../core/types';
import { setAngularVelocity } from '../physics/adapter';
import type { Vehicle } from './vehicleAssembly';

/** 挥击持续时间（ms）：开火后这段时间内命中判定为「挥击中」 */
const SWING_DURATION_MS = 1200;

/**
 * 更新 Hammer 冷却并触发挥击。
 * 由 BattleOrchestrator 每步调用（对每辆车）。
 */
export function updateHammerSwing(v: Vehicle, dtMs: number): void {
  for (const part of v.parts) {
    if (part.def.behavior !== 'hammer') continue;
    const params = part.def.behaviorParams as unknown as HammerParams;

    // 挥击状态递减
    if (part.swinging > 0) part.swinging = Math.max(0, part.swinging - dtMs);

    const remain = (v.weaponCooldowns.get(part.id) ?? 0) - dtMs;
    if (remain > 0) {
      v.weaponCooldowns.set(part.id, remain);
      continue;
    }
    // 冷却到点：给 arm 施加挥击角速度（facing 决定方向，左右镜像）
    v.weaponCooldowns.set(part.id, params.cooldown);
    setAngularVelocity(part.body, params.swingSpeed * v.facing);
    part.swinging = SWING_DURATION_MS;
  }
}
