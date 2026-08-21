/**
 * Thruster Behavior（Q13-C / Q13-C-R1）：推进器 Gadget——玩家直接看到
 * 「车尾点火 → 大喷焰 → 整车突然窜出去」。
 * 它改变的是距离和碰撞时机，不直接造成 Weapon Damage。
 *
 * 语义（与项目基线一致，Q13-C-R1 修正推力方向推导）：
 * - 固定周期（Q13-C-R1 缩短为更强爆发）：短前摇 windupMs（约 0.2~0.3s）→ 爆发推进
 *   thrustMs（约 0.3s）→ 冷却 cooldownMs（约 1.5s），循环；
 * - 推力方向从真实安装位置推导（不再无条件用 vehicle.facing）：
 *   exhaustDir = chassis 中心 → thruster 安装点（part 世界坐标）的 outward 方向；
 *   thrustDir = -exhaustDir。装在后部 → 向后喷火、车向前冲；装在前部 → 向前喷火、车向后推；
 *   位置本身决定物理结果，不增加专属槽 / 隐藏资格；
 * - 冲量只施加到自己 chassis（vehicle.body），作用点 = 真实安装点世界位置（产生自然姿态
 *   反作用）；用 applyLinearImpulse（每固定步一个冲量 = 连续推力），禁止 setVelocity /
 *   teleport / 给对手施加力；
 * - 推进期间 Renderer 在真实安装位置（part.body 世界坐标 = 挂点）画明显大喷焰，停止推进后
 *   立即消失（getFlame 在非 thrust 相位返回 null → 渲染层不画）；
 * - 不造成 Direct Weapon Damage（Gadget，category='gadget'，无 baseDamage）；
 * - 不改正常轮子 Movement 参数（autoDrive / grip 完全不变）；不复制第二套物理系统。
 */
import type { PlanckWorld } from '../physics/planckWorld';
import { PHYSICS_HZ } from '../physics/units';
import type { PlanckPartRuntime, PlanckVehicle } from './planckVehicleAssembly';
import type { RenderFlame } from './battleContract';

/** 固定物理步长（ms）：与 PlanckWorld.FIXED_STEP_MS 数值一致 */
const FIXED_DT_MS = 1000 / PHYSICS_HZ;

/** Thruster behaviorParams 提取结果（数值来自 Content，本模块只读） */
export interface ThrusterParams {
  /** 前摇（ms）：预警但不施力（Q13-C-R1：缩短到约 0.2~0.3s） */
  windupMs: number;
  /** 爆发推进（ms）：每固定步沿「安装位置推导的推力方向」施加一次冲量（Q13-C-R1：约 0.3s 强爆发） */
  thrustMs: number;
  /** 冷却（ms）：不施力、不偷偷加速 */
  cooldownMs: number;
  /** 每固定步沿 chassis facing 施加的冲量（游戏单位：mass × px/step） */
  thrustImpulse: number;
  /** 喷焰颜色（暖橙喷火） */
  flameColor: string;
  /** 喷焰长度（px，短） */
  flameLength: number;
  /** 喷焰根部半宽（px） */
  flameWidth: number;
}

/** 本地向量旋转（px；与 planckVehicleAssembly.rotateLocal 同语义） */
function rotateLocal(p: { x: number; y: number }, angle: number): { x: number; y: number } {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos };
}

/** 校验 + 提取 behaviorParams（缺参数/非有限数 → 明确报错；不做静默默认值、不改参数） */
function readThrusterParams(part: PlanckPartRuntime): ThrusterParams {
  const bp = part.def.behaviorParams ?? {};
  const num = (v: unknown, name: string): number => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
      throw new Error(`ThrusterBehavior: behaviorParams.${name} 必须是正有限数值`);
    }
    return v;
  };
  const str = (v: unknown, name: string): string => {
    if (typeof v !== 'string' || v.length === 0) {
      throw new Error(`ThrusterBehavior: behaviorParams.${name} 必须是非空字符串`);
    }
    return v;
  };
  return {
    windupMs: num(bp.windupMs, 'windupMs'),
    thrustMs: num(bp.thrustMs, 'thrustMs'),
    cooldownMs: num(bp.cooldownMs, 'cooldownMs'),
    thrustImpulse: num(bp.thrustImpulse, 'thrustImpulse'),
    flameColor: str(bp.flameColor, 'flameColor'),
    flameLength: num(bp.flameLength, 'flameLength'),
    flameWidth: num(bp.flameWidth, 'flameWidth'),
  };
}

/** 推进相位（固定周期循环） */
export type ThrusterPhase = 'windup' | 'thrust' | 'cooldown';

/** 单个固定步的相位步数（向上取整，与 Shotgun/Cannon 同约定） */
function stepsFor(ms: number): number {
  return Math.max(1, Math.ceil(ms / FIXED_DT_MS - 1e-9));
}

/**
 * Thruster Behavior（每 thruster part 一个实例，独立周期）。
 * stepFixed 在 Orchestrator 的 onBeforeStep 每固定物理步调用一次。
 */
export class ThrusterBehavior {
  private readonly params: ThrusterParams;
  /** 当前相位 */
  private phase: ThrusterPhase = 'windup';
  /** 当前相位剩余固定步数：0 = 相位结束、下一步切换（构造时按 windupMs 初始化） */
  private phaseStepsRemaining = 0;

  constructor(part: PlanckPartRuntime) {
    this.params = readThrusterParams(part);
    this.phaseStepsRemaining = stepsFor(this.params.windupMs);
  }

  /** 当前相位（只读，供测试/调试） */
  get phaseName(): ThrusterPhase {
    return this.phase;
  }

  /** 是否处于爆发推进相位（喷焰据此显示/隐藏） */
  get isThrusting(): boolean {
    return this.phase === 'thrust';
  }

  /** 当前相位剩余固定步数（只读，供测试/调试） */
  get phaseRemaining(): number {
    return this.phaseStepsRemaining;
  }

  /**
   * 每个固定物理步调用一次（Orchestrator onBeforeStep 内）。
   * - 当前相位有剩余步：windup/cooldown 不施力；thrust 每步施一次冲量；
   * - 相位步数耗尽 → 切换到下一相位（windup→thrust 切换当步即开始施力；
   *   thrust→cooldown / cooldown→windup 切换当步不施力）。
   */
  stepFixed(world: PlanckWorld, vehicle: PlanckVehicle, part: PlanckPartRuntime): void {
    if (this.phaseStepsRemaining > 0) {
      if (this.phase === 'thrust') this.applyThrust(world, vehicle, part);
      this.phaseStepsRemaining--;
      if (this.phaseStepsRemaining > 0) return;
    }
    this.advancePhase(world, vehicle, part);
  }

  /** 相位推进（严格三态循环 windup→thrust→cooldown→windup） */
  private advancePhase(world: PlanckWorld, vehicle: PlanckVehicle, part: PlanckPartRuntime): void {
    if (this.phase === 'windup') {
      this.phase = 'thrust';
      this.phaseStepsRemaining = stepsFor(this.params.thrustMs);
      this.applyThrust(world, vehicle, part); // 进入 thrust 当步即推（「突然加速」的起点）
    } else if (this.phase === 'thrust') {
      this.phase = 'cooldown';
      this.phaseStepsRemaining = stepsFor(this.params.cooldownMs); // 冷却阶段不施力
    } else {
      this.phase = 'windup';
      this.phaseStepsRemaining = stepsFor(this.params.windupMs);
    }
  }

  /**
   * 从真实安装位置推导推力方向（Q13-C-R1）：
   * - exhaustDir = chassis 中心 → thruster 安装点（part 世界坐标）的 outward 方向；
   * - thrustDir = -exhaustDir。装在后部 → 向后喷火、车向前冲；装在前部 → 向前喷火、车向后推。
   * 不再无条件使用 vehicle.facing，位置本身决定物理结果（不增加专属槽 / 隐藏资格）。
   * 冲量只施加到自己 chassis（vehicle.body），作用点 = 真实安装点世界位置（产生自然姿态
   * 反作用）；W1-BH：applyLinearImpulse，不 setVelocity / 不 teleport / 不对手施加力。
   */
  private computeDirs(
    world: PlanckWorld,
    vehicle: PlanckVehicle,
    part: PlanckPartRuntime,
  ): { exhaust: { x: number; y: number }; thrust: { x: number; y: number } } {
    const c = world.getPosition(vehicle.body);
    const m = world.getPosition(part.body);
    let ex = m.x - c.x;
    let ey = m.y - c.y;
    const len = Math.hypot(ex, ey);
    if (len < 1e-6) {
      // 退路：安装点≈中心（不应发生），用 chassis facing 前向量作 exhaust
      const a = world.getAngle(vehicle.body);
      const f = rotateLocal({ x: vehicle.facing, y: 0 }, a);
      return { exhaust: { x: f.x, y: f.y }, thrust: { x: -f.x, y: -f.y } };
    }
    ex /= len;
    ey /= len;
    return { exhaust: { x: ex, y: ey }, thrust: { x: -ex, y: -ey } };
  }

  private applyThrust(
    world: PlanckWorld,
    vehicle: PlanckVehicle,
    part: PlanckPartRuntime,
  ): void {
    const { thrust } = this.computeDirs(world, vehicle, part);
    const mount = world.getPosition(part.body);
    world.applyLinearImpulse(
      vehicle.body,
      { x: thrust.x * this.params.thrustImpulse, y: thrust.y * this.params.thrustImpulse },
      mount,
    );
  }

  /**
   * 渲染喷焰：仅 thrust 相位返回描述（真实 part 世界坐标 = 安装位置，喷焰沿 outward 方向
   * 喷出）；非 thrust 相位返回 null → 渲染层立即不画（停推即消失）。
   */
  getFlame(
    world: PlanckWorld,
    vehicle: PlanckVehicle,
    part: PlanckPartRuntime,
  ): RenderFlame | null {
    if (this.phase !== 'thrust') return null;
    const partPos = world.getPosition(part.body);
    const { exhaust } = this.computeDirs(world, vehicle, part);
    return {
      // 喷焰根部 = 真实安装位置（part 挂点世界坐标）；喷焰沿 outward（exhaust）方向喷出 →
      // 装在后部朝车尾外喷、装在前部朝车头外喷，绝不会穿过车身。
      x: partPos.x,
      y: partPos.y,
      dirX: exhaust.x,
      dirY: exhaust.y,
      length: this.params.flameLength,
      width: this.params.flameWidth,
      color: this.params.flameColor,
      team: vehicle.team,
    };
  }
}
