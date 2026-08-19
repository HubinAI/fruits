/**
 * Hammer Behavior（Q03-C1）：最小自动摆锤循环 Wind-up → Swing → Recover。
 *
 * - 运动完全来自 Revolute motor + limit（getRevoluteAngle 读相位 / setRevoluteLimit 固定弧 /
 *   setRevoluteMotor 驱动），禁止 setAngle / teleport / fixed knockback / 直接扣血；
 * - 固定弧 / 固定周期 / 不追踪敌人：敌人在弧内可命中、弧外真实打空；
 * - 伤害完全复用 ContactRouter baseDamage weapon 路径（锤头 = weapon part 直击）；
 * - 挥击反作用：motor 扭矩反作用经 Revolute 传给 chassis（牛顿第三定律，无额外代码）。
 */
import type { PlanckWorld } from '../physics/planckWorld';
import type { PlanckPartRuntime, PlanckVehicle } from './planckVehicleAssembly';

export type HammerPhase = 'windup' | 'windup-pause' | 'swing' | 'recover';

/**
 * 首版默认参数（明显夸张、正常速度可看懂；不做 10% 级平衡）。
 * 可从 behaviorParams 按同名 key 覆盖（缺省用此默认）。
 */
export const HAMMER_DEFAULT_PARAMS = {
  /** 后限位（rad）：锤头向后抬起 */
  lowerRad: -0.9,
  /** 前限位（rad）：锤头向前挥出 */
  upperRad: 1.2,
  /** Wind-up 向后移动速度（rad/step） */
  windupSpeedRadPerStep: 0.05,
  /** Swing 向前高速挥击（rad/step） */
  swingSpeedRadPerStep: 0.18,
  /** Recover 慢速回后限位（rad/step） */
  recoverSpeedRadPerStep: 0.04,
  /** Wind-up 到位后停顿步数（明显停顿） */
  windupPauseSteps: 20,
  /**
   * Revolute motor 最大扭矩（Planck N·m）。首版明显夸张：
   * 锤头 40kg 质心离 pivot 0.4m → 重力矩 ≈ 160 N·m，60 不足以让 swing 逆重力挥到前限位；
   * 400 保证 swing 有力挥满弧、且反作用在 chassis 上肉眼可见。
   */
  maxTorqueNm: 400,
} as const;

interface HammerParams {
  lowerRad: number;
  upperRad: number;
  windupSpeedRadPerStep: number;
  swingSpeedRadPerStep: number;
  recoverSpeedRadPerStep: number;
  windupPauseSteps: number;
  maxTorqueNm: number;
}

/** 到位判定容差（rad）：motor 撞 limit 有 ~0.03 rad 求解余量 */
const ANGLE_EPS = 0.05;

function readHammerParams(part: PlanckPartRuntime): HammerParams {
  const p = (part.def.behaviorParams ?? {}) as Record<string, unknown>;
  const num = (key: string, def: number): number => {
    const v = p[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : def;
  };
  const params: HammerParams = {
    lowerRad: num('lowerRad', HAMMER_DEFAULT_PARAMS.lowerRad),
    upperRad: num('upperRad', HAMMER_DEFAULT_PARAMS.upperRad),
    windupSpeedRadPerStep: num('windupSpeedRadPerStep', HAMMER_DEFAULT_PARAMS.windupSpeedRadPerStep),
    swingSpeedRadPerStep: num('swingSpeedRadPerStep', HAMMER_DEFAULT_PARAMS.swingSpeedRadPerStep),
    recoverSpeedRadPerStep: num('recoverSpeedRadPerStep', HAMMER_DEFAULT_PARAMS.recoverSpeedRadPerStep),
    windupPauseSteps: num('windupPauseSteps', HAMMER_DEFAULT_PARAMS.windupPauseSteps),
    maxTorqueNm: num('maxTorqueNm', HAMMER_DEFAULT_PARAMS.maxTorqueNm),
  };
  if (!(params.lowerRad < params.upperRad)) {
    throw new Error(`HammerBehavior: 需要 lowerRad < upperRad，收到 ${params.lowerRad} / ${params.upperRad}`);
  }
  return params;
}

export class HammerBehavior {
  private readonly params: HammerParams;
  private _phase: HammerPhase = 'windup';
  private pauseRemaining = 0;

  constructor(part: PlanckPartRuntime) {
    this.params = readHammerParams(part);
  }

  /** 当前相位（只读，供测试/调试） */
  get phase(): HammerPhase {
    return this._phase;
  }

  /**
   * 固定步推进一次（在 Orchestrator 的 onBeforeStep 内调用）。
   * 返回进入下一步之前的当前相位。
   */
  stepFixed(
    world: PlanckWorld,
    _vehicle: PlanckVehicle,
    part: PlanckPartRuntime,
  ): HammerPhase {
    const {
      lowerRad,
      upperRad,
      windupSpeedRadPerStep,
      swingSpeedRadPerStep,
      recoverSpeedRadPerStep,
      windupPauseSteps,
      maxTorqueNm,
    } = this.params;
    const angle = world.getRevoluteAngle(part.joint);
    const motor = (
      enabled: boolean,
      speedRadPerStep: number,
    ): void => {
      world.setRevoluteMotor(part.joint, {
        enabled,
        speedRadPerStep,
        maxTorqueNm,
      });
    };

    switch (this._phase) {
      case 'windup':
        // 向后限位运动（蓄力）；到位 → 停顿
        motor(true, -windupSpeedRadPerStep);
        if (angle <= lowerRad + ANGLE_EPS) {
          this._phase = 'windup-pause';
          this.pauseRemaining = windupPauseSteps;
          motor(false, 0);
        }
        break;
      case 'windup-pause':
        // 明显停顿（motor 关，limit 保持在后限位）
        motor(false, 0);
        this.pauseRemaining--;
        if (this.pauseRemaining <= 0) {
          this._phase = 'swing';
        }
        break;
      case 'swing':
        // 反向高速挥向前限位
        motor(true, swingSpeedRadPerStep);
        if (angle >= upperRad - ANGLE_EPS) {
          this._phase = 'recover';
        }
        break;
      case 'recover':
        // 较慢回到后限位；到位 → 回到 windup（下一帧立即判定到位 → 停顿）
        motor(true, -recoverSpeedRadPerStep);
        if (angle <= lowerRad + ANGLE_EPS) {
          this._phase = 'windup';
        }
        break;
    }
    return this._phase;
  }
}
