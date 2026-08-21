/**
 * Q12-B-CLOSE（prototype/hold）：本 Behavior 已退出正式 Build（见 Q12-B-CLOSE）。
 *   仅保留源码与 registry 注册，供 Q12-B Scenario / 测试 / 后续复用 Revolute Gadget
 *   能力。禁止再调长度/角度/Torque/速度掩盖体验问题。
 *
 * Q12-B：举升臂（Gadget）——front Revolute 主动上翻状态机。
 *
 * 坐标语义（关键）：本游戏世界为 Y-down（世界 y 越小越靠屏幕上方，
 * content.ts 注释「y≈662 在 680 上方 ~18px」即此）。Planck Revolute 的 joint
 * angle 在 Y-down 下「角度增大 = 顺时针 = 臂尖向屏幕下方（世界 y 增大）扫」。
 *
 * 因此举升方向必须随 facing 翻转，保证两个朝向都满足：
 *   lift 时臂尖 worldY 明显减小（向屏幕上方扬起）。
 * 推导：臂尖本地水平方向 = facing·(+x)（facing=-1 时 collider 镜像，臂尖在 -x）。
 *   tip.worldY − pivot.worldY = (facing·100)·sin(partAngle)。
 *   要让 tip 上移（worldY 减小），需令 partAngle 的符号使该项为负：
 *     facing=+1 → 需 partAngle 为负 → joint angle 朝 −upperRad；
 *     facing=-1 → 需 partAngle 为正 → joint angle 朝 +upperRad。
 *   即 liftSign = −facing，liftTarget = liftSign·upperRad。
 *
 * - 复用 Hammer 的 Revolute / motor / limit 能力（world.setRevoluteLimit /
 *   setRevoluteMotor / getRevoluteAngle）；运动完全来自 motor + limit，
 *   物理弧边界由 Planck limit 原生保证，不 setAngle / teleport；
 * - 状态机：rest（低位近水平待机）→ lift（主动向上翻）→ hold（翻到位停顿）→
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
  /** 上翻角速度（rad/step）：明显、可见的起手（完整上翻 ~0.4~0.6s） */
  liftSpeedRadPerStep: number;
  /** 回落角速度（rad/step）：完整机械运动（回落稍慢） */
  lowerSpeedRadPerStep: number;
  /** 上翻幅度（rad，目标 60°~80° 即 1.05~1.40）；实际翻动符号由 facing 决定 */
  upperRad: number;
  /** 低位（待机）角度（rad）：≈0 = 水平前置；上翻幅度 = upperRad − lowerRad */
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
   * - 首次运行时把 limit 设为 [min(rest,target), max(rest,target)]，
   *   使臂体只能从水平低位翻向「上方」（target），绝不会朝地面（另一侧）扫；
   * - 状态机驱动 motor：rest 停低位 → lift 向上翻 → hold 停顿 → lower 回落；
   * - lift/lower 的 motor 速度符号由 liftSign = −facing 决定，保证两朝向都上扬。
   */
  stepFixed(
    world: PlanckWorld,
    vehicle: PlanckVehicle,
    part: PlanckPartRuntime,
  ): LifterPhase {
    // 举升方向随 facing 翻转：facing=+1 → 朝 −upperRad；facing=-1 → 朝 +upperRad。
    // 目的：两个朝向都让臂尖 worldY 减小（向屏幕上方扬起，而非扫向地面）。
    const liftSign = -vehicle.facing;
    const restAngle = this.params.lowerRad; // 0 = 水平低位
    const liftTarget = restAngle + liftSign * (this.params.upperRad - this.params.lowerRad);
    if (this.phaseSteps === 0) {
      world.setRevoluteLimit(part.joint, {
        enabled: true,
        lowerRad: Math.min(restAngle, liftTarget),
        upperRad: Math.max(restAngle, liftTarget),
      });
    }
    const { liftSpeedRadPerStep, lowerSpeedRadPerStep, maxTorqueNm } = this.params;
    const angle = world.getRevoluteAngle(part.joint);
    const motor = (enabled: boolean, speedRadPerStep: number): void => {
      world.setRevoluteMotor(part.joint, { enabled, speedRadPerStep, maxTorqueNm });
    };

    this.phaseSteps++;
    switch (this._phase) {
      case 'rest':
        // 低位近水平待机（motor off，limit 保持在 restAngle）
        motor(false, 0);
        if (this.phaseSteps >= this.params.restSteps) {
          this._phase = 'lift';
          this.phaseSteps = 0;
        }
        break;
      case 'lift':
        // 主动向上翻（motor 朝 liftTarget，符号随 facing）：臂尖 worldY 减小
        motor(true, liftSign * liftSpeedRadPerStep);
        if (Math.abs(angle - liftTarget) <= ANGLE_EPS) {
          this._phase = 'hold';
          this.phaseSteps = 0;
        }
        break;
      case 'hold':
        // 翻到位停顿（motor off，limit 保持在 liftTarget）
        motor(false, 0);
        if (this.phaseSteps >= this.params.holdSteps) {
          this._phase = 'lower';
          this.phaseSteps = 0;
        }
        break;
      case 'lower':
        // 回落（motor 朝 restAngle，符号随 facing）；到位 → 回 rest 待机
        motor(true, -liftSign * lowerSpeedRadPerStep);
        if (Math.abs(angle - restAngle) <= ANGLE_EPS) {
          this._phase = 'rest';
          this.phaseSteps = 0;
        }
        break;
    }
    return this._phase;
  }
}
