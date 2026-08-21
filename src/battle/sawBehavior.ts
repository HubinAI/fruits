/**
 * Saw Behavior（Q13-A）：持续单方向高速旋转的圆形锯片。
 *
 * - 运动完全来自 Revolute motor（setRevoluteMotor 每固定步驱动），禁止
 *   setAngle / teleport / 隐藏力 / 固定击退 / 直接扣血；
 * - 无状态机 / 无 limit：motor 持续 enabled、单一方向（正）、恒定角速度；
 *   圆心 = Revolute 枢轴（part 原点 = 功能挂点），锯片原地自转（不公转）；
 * - 第一版转速故意明显（默认 spinSpeedRadPerStep 0.4 ≈ 24 rad/s ≈ 3.8 rev/s），
 *   正常速度一眼可见锯片在转（后续真人验收再回收）；
 * - 伤害完全复用 ContactRouter 的 contactTick hitPolicy（Weapon Contact 持续接触
 *   按固定物理时间结算），本模块不创建任何伤害系统；
 * - 旋转反作用：motor 扭矩反作用经 Revolute 传给 chassis（牛顿第三定律，无额外代码），
 *   自车与对手均受真实碰撞反作用。
 */
import type { PlanckWorld } from '../physics/planckWorld';
import type { PlanckPartRuntime, PlanckVehicle } from './planckVehicleAssembly';

/** 首版默认参数（明显夸张、正常速度可看懂；不做 10% 级平衡）。 */
export const SAW_DEFAULT_PARAMS = {
  /** 持续单方向旋转角速度（rad/step） */
  spinSpeedRadPerStep: 0.4,
  /**
   * Revolute motor 最大扭矩（Planck N·m）。首版明显夸张：顶住接触摩擦保持
   * 高速旋转，且反作用在 chassis 上肉眼可见（与 Hammer 400 同量级）。
   */
  maxTorqueNm: 400,
} as const;

interface SawParams {
  spinSpeedRadPerStep: number;
  maxTorqueNm: number;
}

function readSawParams(part: PlanckPartRuntime): SawParams {
  const p = (part.def.behaviorParams ?? {}) as Record<string, unknown>;
  const num = (key: string, def: number): number => {
    const v = p[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : def;
  };
  return {
    spinSpeedRadPerStep: num('spinSpeedRadPerStep', SAW_DEFAULT_PARAMS.spinSpeedRadPerStep),
    maxTorqueNm: num('maxTorqueNm', SAW_DEFAULT_PARAMS.maxTorqueNm),
  };
}

export class SawBehavior {
  private readonly params: SawParams;

  constructor(part: PlanckPartRuntime) {
    this.params = readSawParams(part);
  }

  /**
   * 固定步推进一次（在 Orchestrator 的 onBeforeStep 内调用）。
   * 持续单方向高速旋转：motor 始终 enabled，无状态机 / 无 limit。
   */
  stepFixed(
    world: PlanckWorld,
    _vehicle: PlanckVehicle,
    part: PlanckPartRuntime,
  ): void {
    world.setRevoluteMotor(part.joint, {
      enabled: true,
      speedRadPerStep: this.params.spinSpeedRadPerStep,
      maxTorqueNm: this.params.maxTorqueNm,
    });
  }
}
