/**
 * Q12-C：冲锤（Weapon）——Prismatic 伸缩撞击状态机。
 *
 * - 复用 Push Rod 的 Prismatic motor + limit 能力（setPrismaticLimit /
 *   setPrismaticMotor / getPrismaticTranslation）；运动完全来自 motor + limit，
 *   禁止 setPosition / teleport / 固定击退 / 直接扣血；
 * - 与推杆规则不同：推杆 = Gadget 辅助位移（无 Direct Damage）；冲锤 =
 *   Weapon（baseDamage）——只有锤头真实 Contact 时走 ContactRouter weapon
 *   直击（真实碰撞才伤害，不允许 HP bypass）；
 * - 状态机：rest（回收位前摇停顿）→ strike（快速伸出至 upper）→ hold（短
 *   停顿）→ retract（回收）→ rest——前摇 → 快速伸出 → 接触伤害 → 回收清楚；
 * - 初版速度/行程明显高于推杆（speed 8 vs 2 px/step、行程 160 vs 90 px）；
 *   无自动距离判断 / 无自动瞄准（固定行程、固定周期）。
 */

import type { PlanckWorld } from '../physics/planckWorld';
import type { PlanckPartRuntime, PlanckVehicle } from './planckVehicleAssembly';

export type RammerPhase = 'rest' | 'strike' | 'hold' | 'retract';

export interface RammerParams {
  /** 伸出行程（px，Prismatic upper limit） */
  extendPx: number;
  /** 快速伸出速度（px/step） */
  strikeSpeedPxPerStep: number;
  /** 回收速度（px/step） */
  retractSpeedPxPerStep: number;
  /** 前摇：回收位停顿步数 */
  restSteps: number;
  /** 伸出到位短停顿步数 */
  holdSteps: number;
  /** Prismatic motor 最大力（N） */
  maxForceN: number;
}

/** 到位判定容差（px）：motor 撞 limit 的求解余量 */
const TRANSLATION_EPS = 0.6;

function readRammerParams(part: PlanckPartRuntime): RammerParams {
  const p = (part.def.behaviorParams ?? {}) as Record<string, unknown>;
  const num = (key: string, def: number): number => {
    const v = p[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : def;
  };
  const params: RammerParams = {
    extendPx: num('extendPx', 160),
    strikeSpeedPxPerStep: num('strikeSpeedPxPerStep', 8),
    retractSpeedPxPerStep: num('retractSpeedPxPerStep', 3),
    restSteps: Math.max(0, Math.round(num('restSteps', 40))),
    holdSteps: Math.max(0, Math.round(num('holdSteps', 8))),
    maxForceN: num('maxForceN', 200),
  };
  if (!(params.extendPx > 0)) {
    throw new Error(`RammerBehavior: 需要 extendPx > 0，收到 ${params.extendPx}`);
  }
  if (!(params.strikeSpeedPxPerStep > 0)) {
    throw new Error(`RammerBehavior: 需要 strikeSpeedPxPerStep > 0，收到 ${params.strikeSpeedPxPerStep}`);
  }
  return params;
}

export class RammerBehavior {
  private readonly params: RammerParams;
  private _phase: RammerPhase = 'rest';
  private phaseSteps = 0;
  /** Prismatic limit 是否已应用到 joint（首次 stepFixed 时接入真实伸缩边界） */
  private limitApplied = false;

  constructor(part: PlanckPartRuntime) {
    this.params = readRammerParams(part);
  }

  /** 当前相位（只读，供测试/调试） */
  get phase(): RammerPhase {
    return this._phase;
  }

  /**
   * 固定步推进一次（Orchestrator onBeforeStep 内）。
   * rest（前摇）→ strike（快速伸出）→ hold（短停）→ retract（回收）循环。
   */
  stepFixed(
    world: PlanckWorld,
    _vehicle: PlanckVehicle,
    part: PlanckPartRuntime,
  ): RammerPhase {
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

    this.phaseSteps++;
    switch (this._phase) {
      case 'rest':
        // 前摇：回收位停顿（motor off，锤头收在 pivot 附近）
        motor(false, 0);
        if (this.phaseSteps >= this.params.restSteps) {
          this._phase = 'strike';
          this.phaseSteps = 0;
        }
        break;
      case 'strike':
        // 快速伸出至 upper（明显速度快于推杆）
        motor(true, this.params.strikeSpeedPxPerStep);
        if (t >= this.params.extendPx - TRANSLATION_EPS) {
          this._phase = 'hold';
          this.phaseSteps = 0;
        }
        break;
      case 'hold':
        // 伸出到位短停顿（motor off）
        motor(false, 0);
        if (this.phaseSteps >= this.params.holdSteps) {
          this._phase = 'retract';
          this.phaseSteps = 0;
        }
        break;
      case 'retract':
        // 回收回 lower（0）
        motor(true, -this.params.retractSpeedPxPerStep);
        if (t <= TRANSLATION_EPS) {
          this._phase = 'rest';
          this.phaseSteps = 0;
        }
        break;
    }
    return this._phase;
  }
}
