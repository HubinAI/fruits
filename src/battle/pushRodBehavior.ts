/**
 * Push Rod Behavior（Q04-C1）：最小自动伸缩循环 Extend → Hold → Retract。
 *
 * - 运动完全来自 Prismatic motor + limit（getPrismaticTranslation 读行程 /
 *   setPrismaticLimit 固定真实伸缩边界 / setPrismaticMotor 驱动），
 *   禁止 setPosition / teleport / 给目标 setVelocity / fixed knockback / 直接扣血；
 * - 首次运行时把 lower=0 / upper=extendPx 写入真实 Prismatic limit（物理边界，
 *   motor 撞 limit 被原生挡下）；
 * - 固定行程（extendPx）/ 固定周期 / 不读敌方位置：同一套 maxForce/speed 用于所有
 *   目标（禁止按质量动态补偿）——轻车被推得远、重车被推得近（真实碰撞反应）；
 * - Direct Damage = 0：Gadget 天然绕过 ContactRouter weapon 路径；通用 Impact
 *   可自然存在，不做特判关闭。
 */
import type { PlanckWorld } from '../physics/planckWorld';
import type { PlanckPartRuntime, PlanckVehicle } from './planckVehicleAssembly';

export type PushRodPhase = 'extend' | 'hold' | 'retract';

/**
 * 首版默认参数（明显夸张验证方向；同一套 maxForce/speed 用于轻重目标）。
 * 可从 behaviorParams 按同名 key 覆盖（缺省用此默认）。
 */
export const PUSH_ROD_DEFAULT_PARAMS = {
  /** 伸出行程（px，Prismatic upper limit） */
  extendPx: 90,
  /** 最远端停顿步数（明显 Hold） */
  holdSteps: 20,
  /** 伸缩速度（px/step） */
  speedPxPerStep: 2,
  /** 推杆最大力（Planck N，原值） */
  maxForceN: 500,
} as const;

interface PushRodParams {
  extendPx: number;
  holdSteps: number;
  speedPxPerStep: number;
  maxForceN: number;
}

/** 到位判定容差（px）：motor 撞 limit 的求解余量 */
const TRANSLATION_EPS = 0.6;

function readPushRodParams(part: PlanckPartRuntime): PushRodParams {
  const p = (part.def.behaviorParams ?? {}) as Record<string, unknown>;
  const num = (key: string, def: number): number => {
    const v = p[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : def;
  };
  const params: PushRodParams = {
    extendPx: num('extendPx', PUSH_ROD_DEFAULT_PARAMS.extendPx),
    holdSteps: num('holdSteps', PUSH_ROD_DEFAULT_PARAMS.holdSteps),
    speedPxPerStep: num('speedPxPerStep', PUSH_ROD_DEFAULT_PARAMS.speedPxPerStep),
    maxForceN: num('maxForceN', PUSH_ROD_DEFAULT_PARAMS.maxForceN),
  };
  if (!(params.extendPx > 0)) {
    throw new Error(`PushRodBehavior: 需要 extendPx > 0，收到 ${params.extendPx}`);
  }
  return params;
}

export class PushRodBehavior {
  private readonly params: PushRodParams;
  private _phase: PushRodPhase = 'extend';
  private holdRemaining = 0;
  /** Q04-C1：Prismatic limit 是否已应用到 joint（首次 stepFixed 时接入真实伸缩边界） */
  private limitApplied = false;

  constructor(part: PlanckPartRuntime) {
    this.params = readPushRodParams(part);
  }

  /** 当前相位（只读，供测试/调试） */
  get phase(): PushRodPhase {
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
  ): PushRodPhase {
    // Q04-C1：首次运行时把 lower=0 / upper=extendPx 写入真实 Prismatic limit——
    // 伸缩边界由 Planck limit 原生保证，motor 撞限位被硬约束挡下。
    if (!this.limitApplied) {
      world.setPrismaticLimit(part.joint, {
        enabled: true,
        lowerPx: 0,
        upperPx: this.params.extendPx,
      });
      this.limitApplied = true;
    }
    const t = world.getPrismaticTranslation(part.joint);
    const motor = (enabled: boolean, speedPxPerStep: number): void => {
      world.setPrismaticMotor(part.joint, {
        enabled,
        speedPxPerStep,
        maxForceN: this.params.maxForceN,
      });
    };

    switch (this._phase) {
      case 'extend':
        // 正向伸出至 upper（沿 axis = facing 前方）
        motor(true, this.params.speedPxPerStep);
        if (t >= this.params.extendPx - TRANSLATION_EPS) {
          this._phase = 'hold';
          this.holdRemaining = this.params.holdSteps;
          motor(false, 0);
        }
        break;
      case 'hold':
        // 最远端停顿（motor 关，limit 保持在上限）
        motor(false, 0);
        this.holdRemaining--;
        if (this.holdRemaining <= 0) {
          this._phase = 'retract';
        }
        break;
      case 'retract':
        // 反向回到 lower（0）
        motor(true, -this.params.speedPxPerStep);
        if (t <= TRANSLATION_EPS) {
          this._phase = 'extend';
        }
        break;
    }
    return this._phase;
  }
}
