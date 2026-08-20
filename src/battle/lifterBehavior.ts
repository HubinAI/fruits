/**
 * Q12-B：举升臂（Gadget）——front Revolute 主动上翻状态机。
 *
 * - 复用 Hammer 的 Revolute / motor / limit 能力（world.setRevoluteLimit /
 *   setRevoluteMotor / getRevoluteAngle）；运动完全来自 motor + limit，
 *   物理弧边界由 Planck limit 原生保证，不 setAngle / teleport；
 * - 状态机：rest（低位待机）→ lift（主动向上翻）→ hold（翻到位停顿）→
 *   lower（回落）→ rest，周期循环——第一版动作故意明显（~70° 弧、清楚起手、
 *   完整机械运动）；
 * - 举升力 = motor 扭矩经 Revolute 传给臂体 → 臂与对手真实碰撞顶起；
 *   反作用经 Revolute 传给 chassis（牛顿第三定律，无额外代码）；
 * - category gadget + 无 baseDamage → 不走 ContactRouter weapon 路径，
 *   Direct Weapon Damage = 0。
 */

/** 举升臂相位（与 Hammer 同为 Revolute motor+limit 状态机，但语义是待机→翻→回落） */
export type LifterPhase = 'rest' | 'lift' | 'hold' | 'lower';

export interface LifterParams {
  /** 上翻角速度（rad/step）：明显、可见的起手 */
  liftSpeedRadPerStep: number;
  /** 回落角速度（rad/step）：完整机械运动 */
  lowerSpeedRadPerStep: number;
  /** 上翻限位（rad，目标 60°~80° 即 1.05~1.40） */
  upperRad: number;
  /** 低位限位（rad，待机 ≈ 0 = 水平前置） */
  lowerRad: number;
  /** 翻到位停顿步数（hold） */
  holdSteps: number;
  /** 低位待机步数（rest） */
  restSteps: number;
  /** Revolute motor 最大扭矩（Planck N·m）：足够顶起对手并让反作用可见 */
  maxTorqueNm: number;
}

import type { PlanckPartRuntime } from './planckVehicleAssembly';
import type { PlanckVehicle } from './planckVehicleAssembly';
import type { PlanckWorld } from '../physics/planckWorld';

/** 到位判定容差（rad）：motor 撞 limit 有 ~0.03 rad 求解余量 */
const ANGLE_EPS = 0.03;

/** 数值参数解析（非法/缺失 → 抛错，与既有 Behavior 一致） */
function num(v: unknown, key: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`LifterBehavior: ${key} 必须为有限 number（收到 ${String(v)}）`);
  }
  return v;
}

export class LifterBehavior {
  private _phase: LifterPhase = 'rest';
  private phaseSteps = 0;
  private readonly params: LifterParams;

  constructor(part: PlanckPartRuntime) {
    const bp = (part.def.behaviorParams ?? {}) as Record<string, unknown>;
    this.params = {
      liftSpeedRadPerStep: num(bp.liftSpeedRadPerStep, 'liftSpeedRadPerStep'),
      lowerSpeedRadPerStep: num(bp.lowerSpeedRadPerStep, 'lowerSpeedRadPerStep'),
      upperRad: num(bp.upperRad, 'upperRad'),
      lowerRad: num(bp.lowerRad, 'lowerRad'),
      holdSteps: Math.max(0, Math.round(num(bp.holdSteps, 'holdSteps'))),
      restSteps: Math.max(0, Math.round(num(bp.restSteps, 'restSteps'))),
      maxTorqueNm: num(bp.maxTorqueNm, 'maxTorqueNm'),
    };
  }

  get phase(): LifterPhase {
    return this._phase;
  }

  /**
   * 每个固定物理步调用一次（Orchestrator onBeforeStep 内）。
   * - 首次运行时把 lower/upper 设为真实 Revolute Joint limit；
   * - 状态机驱动 motor：rest 停低位 → lift 向上翻 → hold 停顿 → lower 回落。
   */
  stepFixed(
    world: PlanckWorld,
    _vehicle: PlanckVehicle,
    part: PlanckPartRuntime,
  ): LifterPhase {
    if (this.phaseSteps === 0) {
      world.setRevoluteLimit(part.joint, {
        enabled: true,
        lowerRad: this.params.lowerRad,
        upperRad: this.params.upperRad,
      });
    }
    const { lowerRad, upperRad, liftSpeedRadPerStep, lowerSpeedRadPerStep, maxTorqueNm } =
      this.params;
    const angle = world.getRevoluteAngle(part.joint);
    const motor = (enabled: boolean, speedRadPerStep: number): void => {
      world.setRevoluteMotor(part.joint, { enabled, speedRadPerStep, maxTorqueNm });
    };

    this.phaseSteps++;
    switch (this._phase) {
      case 'rest':
        // 低位待机（motor off，臂水平前置）
        motor(false, 0);
        if (this.phaseSteps >= this.params.restSteps) {
          this._phase = 'lift';
          this.phaseSteps = 0;
        }
        break;
      case 'lift':
        // 主动向上翻（明显速度 → upper 限位）
        motor(true, liftSpeedRadPerStep);
        if (angle >= upperRad - ANGLE_EPS) {
          this._phase = 'hold';
          this.phaseSteps = 0;
        }
        break;
      case 'hold':
        // 翻到位停顿（motor off，limit 保持）
        motor(false, 0);
        if (this.phaseSteps >= this.params.holdSteps) {
          this._phase = 'lower';
          this.phaseSteps = 0;
        }
        break;
      case 'lower':
        // 回落（较慢回低位；到位 → 回 rest 待机）
        motor(true, -lowerSpeedRadPerStep);
        if (angle <= lowerRad + ANGLE_EPS) {
          this._phase = 'rest';
          this.phaseSteps = 0;
        }
        break;
    }
    return this._phase;
  }
}
