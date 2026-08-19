/**
 * Lift Roller Behavior（Q05-C1）：Continuous Revolute Motor。
 *
 * - 每固定步维持持续旋转（enabled:true + 固定 speedRadPerStep + 固定 maxTorqueNm）；
 * - 无状态机、无 limit（Q05-F1 装配不设 limit）、不读敌方位置；
 * - 所有顶起 / 位移 / 姿态改变只能来自 roller collider + motor + contact solver
 *   （禁止 setPosition / setVelocity / 固定 upward velocity / 补偿 impulse / 手工 grounded）；
 * - 同一套 motor 参数用于所有目标（禁止按质量动态调整）；
 * - Direct Damage = 0：Gadget 天然绕过 ContactRouter weapon 路径。
 */
import type { PlanckWorld } from '../physics/planckWorld';
import type { PlanckPartRuntime, PlanckVehicle } from './planckVehicleAssembly';

/**
 * 首版默认参数（明显夸张验证方向；同一套用于所有目标）。
 * 可从 behaviorParams 按同名 key 覆盖（缺省用此默认）。
 */
export const LIFT_ROLLER_DEFAULT_PARAMS = {
  /** 持续旋转速度（rad/step） */
  speedRadPerStep: 0.25,
  /** Revolute motor 最大扭矩（Planck N·m，原值） */
  maxTorqueNm: 300,
} as const;

interface LiftRollerParams {
  speedRadPerStep: number;
  maxTorqueNm: number;
}

function readLiftRollerParams(part: PlanckPartRuntime): LiftRollerParams {
  const p = (part.def.behaviorParams ?? {}) as Record<string, unknown>;
  const num = (key: string, def: number): number => {
    const v = p[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : def;
  };
  return {
    speedRadPerStep: num('speedRadPerStep', LIFT_ROLLER_DEFAULT_PARAMS.speedRadPerStep),
    maxTorqueNm: num('maxTorqueNm', LIFT_ROLLER_DEFAULT_PARAMS.maxTorqueNm),
  };
}

export class LiftRollerBehavior {
  private readonly params: LiftRollerParams;

  constructor(part: PlanckPartRuntime) {
    this.params = readLiftRollerParams(part);
  }

  /** 当前 motor speed（只读，供测试/调试） */
  get speedRadPerStep(): number {
    return this.params.speedRadPerStep;
  }

  /**
   * 固定步推进一次（在 Orchestrator 的 onBeforeStep 内调用）：
   * 维持 continuous Revolute motor（重复设置幂等）。
   */
  stepFixed(
    world: PlanckWorld,
    _vehicle: PlanckVehicle,
    part: PlanckPartRuntime,
  ): void {
    world.setRevoluteMotor(part.joint, {
      enabled: true,
      speedRadPerStep: this.params.speedRadPerStep,
      maxTorqueNm: this.params.maxTorqueNm,
    });
  }
}
