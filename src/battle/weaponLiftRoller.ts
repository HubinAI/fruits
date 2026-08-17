/**
 * Lift Roller（举升滚轮 Gadget）驱动。
 *
 * - 滚轮是 circle 刚体 + Revolute Joint 挂 Hardpoint（vehicleAssembly 装配）；
 * - 每步 setAngularVelocity 让滚轮持续真实旋转（Spin-up → 持续）；
 * - Direct Damage = 0：滚轮是 Gadget，contactRouter 对 category !== 'weapon' 不结算伤害；
 * - 抬升 / 姿态变化来自滚轮轮面切向速度 + 摩擦与目标的真实接触（Matter 碰撞求解器），
 *   不调用任何 Flip / Launch / Knockback / 固定向上速度；
 * - 反作用：滚轮自身质量真实参与碰撞，目标对滚轮的反作用通过 Revolute Joint 传回车体。
 */
import type { LiftRollerParams } from '../core/types';
import { setAngularVelocity } from '../physics/adapter';
import type { Vehicle } from './vehicleAssembly';

/**
 * 更新 Lift Roller 持续旋转。
 * 由 BattleOrchestrator 每步调用（对每辆车）。
 * facing 镜像：spinDirection 是 facing=1（朝右）时的抬升方向，
 * facing=-1（朝左）时旋转方向镜像，保证滚轮始终朝「敌人方向」抬升。
 */
export function updateLiftRoller(v: Vehicle): void {
  for (const part of v.parts) {
    if (part.def.behavior !== 'liftRoller') continue;
    const params = part.def.behaviorParams as unknown as LiftRollerParams;
    setAngularVelocity(part.body, v.facing * params.spinDirection * params.rpm);
  }
}
