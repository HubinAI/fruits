/**
 * Thruster Behavior（Q13-C / Q13-C-R1 / Q13-C-R2）：推进器 Gadget——玩家直接看到
 * 「车尾点火 → 大喷焰 → 整车突然窜出去」。
 * 它改变的是距离和碰撞时机，不直接造成 Weapon Damage。
 *
 * 语义（与项目基线一致，Q13-C-R2 修正推进方向 = 车辆真实前向）：
 * - 固定周期（Q13-C-R1 缩短为更强爆发）：短前摇 windupMs（约 0.2~0.3s）→ 爆发推进
 *   thrustMs（约 0.3s）→ 冷却 cooldownMs（约 1.5s），循环；
 * - 推进方向固定为车辆真实前向（Q13-C-R2：删除「安装位置决定前进方向」规则）：
 *   车头方向 = 推进方向；chassisForward = rotateLocal({ x: vehicle.facing, y: 0 }, chassisAngle)；
 *   thrustDir = chassisForward；exhaustDir = -thrustDir（喷焰与推进方向严格相反）。
 *   安装位置（part 世界坐标）只决定冲量施加点（真实力矩 / 姿态反作用），不反转推进方向；
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
  /** 爆发推进（ms）：每固定步沿「车辆真实前向 chassisForward」施加一次冲量（Q13-C-R2：约 0.3s 强爆发） */
  thrustMs: number;
  /** 冷却（ms）：不施力、不偷偷加速 */
  cooldownMs: number;
  /** 每固定步沿 chassis 真实前向施加的冲量（游戏单位：mass × px/step） */
  thrustImpulse: number;
  /** 喷焰颜色（暖橙喷火） */
  flameColor: string;
  /** 喷焰长度（px，短） */
  flameLength: number;
  /** 喷焰根部半宽（px） */
  flameWidth: number;
  /**
   * GADGET-THRUSTER-PROTOTYPE-R1：distance-triggered 模式参数。
   * `null` = 不启用（保持既有固定周期循环，逐字节不变）。
   */
  trigger: ThrusterTriggerParams | null;
}

/** 本地向量旋转（px；与 planckVehicleAssembly.rotateLocal 同语义） */
function rotateLocal(p: { x: number; y: number }, angle: number): { x: number; y: number } {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos };
}

/** GADGET-THRUSTER-PROTOTYPE-R1：整车真实碰撞 AABB（chassis + 全部轮组 + 全部部件） */
function vehicleBounds(
  world: PlanckWorld,
  v: PlanckVehicle,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let ok = false;
  const acc = (b: unknown): void => {
    try {
      const bb = world.getCollisionBounds(b as never);
      minX = Math.min(minX, bb.minX);
      minY = Math.min(minY, bb.minY);
      maxX = Math.max(maxX, bb.maxX);
      maxY = Math.max(maxY, bb.maxY);
      ok = true;
    } catch {
      // 拿不到就跳过，绝不伪造
    }
  };
  acc(v.body);
  for (const w of v.wheels) acc(w.body);
  for (const p of v.parts) acc(p.body);
  return ok ? { minX, minY, maxX, maxY } : null;
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
  const triggerRaw = (bp as Record<string, unknown>).distanceTrigger;
  let trigger: ThrusterTriggerParams | null = null;
  // ⚠️ 只有显式 `enabled: true` 才启用 distance-triggered 模式；
  // 缺省 / false 保持既有固定周期循环（Q13-C 旧路径逐字节不变）。
  if (triggerRaw && typeof triggerRaw === 'object' && (triggerRaw as Record<string, unknown>).enabled === true) {
    const t = triggerRaw as Record<string, unknown>;
    const numT = (v: unknown, name: string): number => {
      if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
        throw new Error(`ThrusterBehavior: distanceTrigger.${name} 必须是正有限数值`);
      }
      return v;
    };
    const rawThreshold =
      typeof t.thresholdPx === 'number' && Number.isFinite(t.thresholdPx) && t.thresholdPx > 0
        ? t.thresholdPx
        : numT(t.farThreshold, 'farThreshold');
    const mode = t.mode === 'near' ? 'near' : 'far';
    trigger = {
      mode,
      thresholdPx: rawThreshold,
      // 缺省方向由 mode 决定：far → 前冲(+)；near → 后撤(−)
      thrustSign: t.thrustSign === -1 ? -1 : t.thrustSign === 1 ? 1 : mode === 'near' ? -1 : 1,
      forwardMarginPx: numT(t.forwardMarginPx, 'forwardMarginPx'),
      cooldownMs: numT(t.cooldownMs, 'cooldownMs'),
      burstMs: numT(t.burstMs, 'burstMs'),
    };
  }
  return {
    windupMs: num(bp.windupMs, 'windupMs'),
    thrustMs: num(bp.thrustMs, 'thrustMs'),
    cooldownMs: num(bp.cooldownMs, 'cooldownMs'),
    thrustImpulse: num(bp.thrustImpulse, 'thrustImpulse'),
    flameColor: str(bp.flameColor, 'flameColor'),
    flameLength: num(bp.flameLength, 'flameLength'),
    flameWidth: num(bp.flameWidth, 'flameWidth'),
    trigger,
  };
}

/** 推进相位（固定周期循环） */
export type ThrusterPhase = 'windup' | 'thrust' | 'cooldown';
/** GADGET-THRUSTER-PROTOTYPE-R1：distance-triggered 模式下的空闲相位 */
export type ThrusterIdlePhase = 'idle';

/** 单个固定步的相位步数（向上取整，与 Shotgun/Cannon 同约定） */
function stepsFor(ms: number): number {
  return Math.max(1, Math.ceil(ms / FIXED_DT_MS - 1e-9));
}

/**
 * GADGET-THRUSTER-PROTOTYPE-R1｜**距离触发的短时前冲**参数（可选）。
 *
 * 与既有固定周期模式**互斥**：给出本组参数时启用「敌人在前方且距离超过
 * farThreshold 且冷却结束 → 触发一次前冲」；未给出时保持既有固定周期循环
 * （逐字节不变）。
 *
 * ⚠️ 本组参数是 **Prototype 数值**（明显放大以验证方向），不是正式平衡值。
 */
export interface ThrusterTriggerParams {
  /**
   * GADGET-REVERSE-THRUSTER-PROTOTYPE-R1｜触发方向：
   * - `'far'`（缺省）= 敌人**过远**时触发 **前冲**（Thruster 语义）；
   * - `'near'` = 敌人**过近**时触发 **后撤**（Reverse Thruster 语义）。
   */
  mode?: 'far' | 'near';
  /** 触发距离阈值（px）：`far` 模式为「远于此」；`near` 模式为「近于此」 */
  thresholdPx?: number;
  /** @deprecated 旧字段名（等价 thresholdPx）；保留兼容，新内容用 thresholdPx */
  farThreshold?: number;
  /** 触发时的冲量方向：缺省 = 跟随 mode（far→+前向，near→−前向） */
  thrustSign?: 1 | -1;
  /**
   * 「敌人在前方」判定容差：对方车辆包围盒中心须位于自车前向半球内。
   * 用包围盒中心 X 相对自车中心 X 的符号 + 朝向判定，不依赖任何吸附/锁定。
   */
  forwardMarginPx: number;
  /** 触发后的冷却（ms）：冷却结束前不再触发 */
  cooldownMs: number;
  /** 单次推进持续时间（ms） */
  burstMs: number;
}

/**
 * GADGET-THRUSTER-PROTOTYPE-R1｜**挂点命名空间**判定。
 *
 * ⚠️ distance-triggered 模式**只在 Gadget 专属挂点上生效**：
 *   - Gadget 维度的挂点 id 由 `BodyDef.gadgetHardpoints` 提供（当前 = `'gadget'`）；
 *   - 旧的 `functionalHardpoints`（`front`/`frontMass`/`top`/`rear`）挂载的 thruster
 *     **保持 Q13-C 固定周期循环逐字节不变**（Lab Q13-C 场景 / 既有 buildUx 契约依赖它）。
 * 这样「新 Gadget 维度」与「旧功能槽历史行为」互不干扰。
 */
const GADGET_HARDPOINT_IDS: ReadonlySet<string> = new Set(['gadget', 'gadgetRear']);

/**
 * Thruster Behavior（每 thruster part 一个实例，独立周期）。
 * stepFixed 在 Orchestrator 的 onBeforeStep 每固定物理步调用一次。
 */
export class ThrusterBehavior {
  private readonly params: ThrusterParams;
  /** 当前相位（distance-triggered 模式下 idle 时 = 'cooldown'，对外仍报可渲染相位） */
  private phase: ThrusterPhase = 'windup';
  /** 当前相位剩余固定步数：0 = 相位结束、下一步切换（构造时按 windupMs 初始化） */
  private phaseStepsRemaining = 0;
  /**
   * GADGET-THRUSTER-PROTOTYPE-R1：distance-triggered 模式下的「真实状态」。
   * - 'idle'：等待触发（不施力）；触发成功 → 'thrust'；
   * - 'thrust' / 'cooldown'：与相位同名，驱动实际施力与冷却计时。
   */
  private triggeredState: 'idle' | 'thrust' | 'cooldown' = 'idle';
  /** 对方车辆（只读；未提供 ⇒ 距离触发不可用） */
  private readonly hostile: PlanckVehicle | undefined;
  /** 诊断：累计触发次数 */
  private triggerCount = 0;
  /** 本实例的挂点 id（判定 Gadget 命名空间用） */
  private readonly partId: string;

  constructor(part: PlanckPartRuntime, hostile?: PlanckVehicle) {
    this.params = readThrusterParams(part);
    this.hostile = hostile;
    this.partId = part.id;
    this.phaseStepsRemaining = stepsFor(this.params.windupMs);
  }

  /**
   * 本实例是否走 distance-triggered 路径。
   * 需**同时**满足：① content 显式 `distanceTrigger.enabled === true`；
   * ② 本实例挂在 **Gadget 专属挂点**上（旧功能槽挂载保持固定周期）。
   */
  private get useDistanceTrigger(): boolean {
    return this.params.trigger !== null && GADGET_HARDPOINT_IDS.has(this.partId);
  }

  /** 当前相位（只读，供测试/调试） */
  get phaseName(): ThrusterPhase {
    return this.phase;
  }

  /** GADGET-THRUSTER-PROTOTYPE-R1：本实例累计推进触发次数（诊断用） */
  get triggers(): number {
    return this.triggerCount;
  }

  /** distance-triggered 模式是否启用 */
  get isDistanceTriggered(): boolean {
    return this.params.trigger !== null;
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
    // GADGET-THRUSTER-PROTOTYPE-R1：distance-triggered 模式（仅 Gadget 挂点，与固定周期互斥）
    if (this.useDistanceTrigger) {
      this.stepTriggered(world, vehicle, part);
      return;
    }
    if (this.phaseStepsRemaining > 0) {
      if (this.phase === 'thrust') this.applyThrust(world, vehicle, part);
      this.phaseStepsRemaining--;
      if (this.phaseStepsRemaining > 0) return;
    }
    this.advancePhase(world, vehicle, part);
  }

  /**
   * GADGET-THRUSTER-PROTOTYPE-R1｜distance-triggered 状态机。
   *
   * 触发条件（**只看真实物理距离**，不看武器类型 / 不做追踪）：
   *   ① 对方在自车**前向半球**内（`enemyIsAhead`）；
   *   ② 双方**真实碰撞 AABB 间距** > `farThreshold`（过远）；
   *   ③ 冷却已结束。
   * ⇒ 进入 'thrust'，每固定步沿车辆真实前向施加一次冲量（复用既有 applyThrust，
   *   **不瞬移 / 不吸附 / 不锁敌 / 不改对方速度**）。
   */
  private stepTriggered(
    world: PlanckWorld,
    vehicle: PlanckVehicle,
    part: PlanckPartRuntime,
  ): void {
    const t = this.params.trigger!;

    if (this.triggeredState === 'thrust') {
      this.applyThrust(world, vehicle, part);
      this.phase = 'thrust';
      this.phaseStepsRemaining--;
      if (this.phaseStepsRemaining <= 0) {
        this.triggeredState = 'cooldown';
        this.phase = 'cooldown';
        this.phaseStepsRemaining = stepsFor(t.cooldownMs);
      }
      return;
    }

    if (this.triggeredState === 'cooldown') {
      this.phase = 'cooldown';
      this.phaseStepsRemaining--;
      if (this.phaseStepsRemaining <= 0) {
        this.triggeredState = 'idle';
        this.phaseStepsRemaining = 0;
      }
      return;
    }

    // idle：等待触发（不施力）
    this.phase = 'cooldown'; // 对渲染层表现为「无喷焰」，不伪造推进
    this.phaseStepsRemaining = 0;
    const gap = this.realGapPx(world, vehicle);
    // GADGET-REVERSE-THRUSTER-PROTOTYPE-R1：mode 决定触发方向
    //   far  → 敌人过远 → 前冲（拉近）
    //   near → 敌人过近 → 后撤（拉开重新建立射击空间）
    const threshold = t.thresholdPx!;
    const inTriggerBand = gap !== null && (t.mode === 'near' ? gap < threshold : gap > threshold);
    if (inTriggerBand && this.enemyIsAhead(world, vehicle, t.forwardMarginPx)) {
      this.triggeredState = 'thrust';
      this.phase = 'thrust';
      this.triggerCount += 1;
      this.phaseStepsRemaining = stepsFor(t.burstMs);
      this.applyThrust(world, vehicle, part); // 触发当步即推
    }
  }

  /** 双方**真实碰撞 AABB** 间距（px；重叠 = 0）；无对方 ⇒ null（不触发）。 */
  private realGapPx(world: PlanckWorld, vehicle: PlanckVehicle): number | null {
    if (!this.hostile) return null;
    const a = vehicleBounds(world, vehicle);
    const b = vehicleBounds(world, this.hostile);
    if (!a || !b) return null;
    const dx = Math.max(0, Math.max(a.minX - b.maxX, b.minX - a.maxX));
    const dy = Math.max(0, Math.max(a.minY - b.maxY, b.minY - a.maxY));
    return Math.hypot(dx, dy);
  }

  /**
   * 对方是否在自车**前向半球**内（只读几何；不做瞄准、不锁定）。
   * 判据 = 自车中心 → 对方中心 的位移在「车辆真实前向」上的投影 > 0。
   */
  private enemyIsAhead(
    world: PlanckWorld,
    vehicle: PlanckVehicle,
    marginPx: number,
  ): boolean {
    if (!this.hostile) return false;
    const self = world.getPosition(vehicle.body);
    const other = world.getPosition(this.hostile.body);
    const a = world.getAngle(vehicle.body);
    const fwd = rotateLocal({ x: vehicle.facing, y: 0 }, a);
    const proj = (other.x - self.x) * fwd.x + (other.y - self.y) * fwd.y;
    return proj > marginPx;
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
   * 推进方向固定为车辆真实前向（Q13-C-R2：删除「安装位置决定前进方向」规则）：
   * - chassisForward = rotateLocal({ x: vehicle.facing, y: 0 }, chassisAngle)；
   * - thrustDir = chassisForward；exhaustDir = -thrustDir（喷焰与推进方向严格相反）。
   * 安装位置（part 世界坐标）只决定冲量施加点（真实力矩 / 姿态反作用），不反转推进方向；
   * W1-BH：applyLinearImpulse 只施加到自己 chassis（vehicle.body），不 setVelocity /
   * 不 teleport / 不对手施加力。
   */
  private computeDirs(
    world: PlanckWorld,
    vehicle: PlanckVehicle,
  ): { exhaust: { x: number; y: number }; thrust: { x: number; y: number } } {
    const a = world.getAngle(vehicle.body);
    const f = rotateLocal({ x: vehicle.facing, y: 0 }, a);
    return { thrust: { x: f.x, y: f.y }, exhaust: { x: -f.x, y: -f.y } };
  }

  private applyThrust(
    world: PlanckWorld,
    vehicle: PlanckVehicle,
    part: PlanckPartRuntime,
  ): void {
    const { thrust } = this.computeDirs(world, vehicle);
    // GADGET-REVERSE-THRUSTER-PROTOTYPE-R1：sign = −1 时沿**车尾方向**施力（真实后撤）。
    // 只作用于自己 chassis，不碰对方（不推敌人、不改对方速度）。
    const sign = this.params.trigger?.thrustSign ?? 1;
    const mount = world.getPosition(part.body); // 冲量作用点=真实安装点（自然姿态/力矩反作用）
    world.applyLinearImpulse(
      vehicle.body,
      { x: thrust.x * sign * this.params.thrustImpulse, y: thrust.y * sign * this.params.thrustImpulse },
      mount,
    );
  }

  /**
   * 渲染喷焰数据（Q13-C-R3 表现重做：仅补充 phase / tMs，物理方向 / 冲量 / 节奏完全不变）：
   * - windup：返回喷口小橙光 flame（phase='windup'，渲染层只画喷口小亮、不长焰）；
   * - thrust：返回完整喷焰 flame（phase='thrust'，根部 = 真实安装位置 part 世界坐标，
   *   方向 = exhaustDir = -chassisForward，与推进方向严格相反）；
   * - cooldown：爆发后约 70ms 内仍返回收缩 flame（phase='cooldown'，渲染层快速收掉），
   *   之后返回 null（停推即消失，不偷偷加推力表现）。
   */
  getFlame(
    world: PlanckWorld,
    vehicle: PlanckVehicle,
    part: PlanckPartRuntime,
  ): RenderFlame | null {
    // cooldown：仅爆发后约 70ms 返回收缩 flame（纯表现），之后 null
    if (this.phase === 'cooldown') {
      const elapsedSteps = stepsFor(this.params.cooldownMs) - this.phaseStepsRemaining;
      if (elapsedSteps * FIXED_DT_MS >= 70) return null;
    }
    const partPos = world.getPosition(part.body);
    const { exhaust } = this.computeDirs(world, vehicle);
    const phaseTotalMs =
      this.phase === 'windup'
        ? this.params.windupMs
        : this.phase === 'thrust'
          ? this.params.thrustMs
          : 70; // cooldown 收缩用固定窗口
    const elapsedSteps = stepsFor(phaseTotalMs) - this.phaseStepsRemaining;
    const tMs = Math.max(0, elapsedSteps * FIXED_DT_MS);

    // GADGET-REVERSE-VISUAL-DIRECTION-R1｜**喷焰方向与位置必须与真实 thrustSign 一致**。
    //
    // ⚠️ 此前根方向被写死为 `exhaust = -chassisForward`，因此 Reverse Thruster 真实后撤时
    //    喷焰仍朝车尾 ⇒ 画面看起来像「普通向前推进器」，与车辆运动方向反直觉。
    //
    // 视觉因果（喷焰 = 被推出的气体，方向与推进方向**相反**）：
    //   thrustSign = +1（前冲）：喷焰在**车尾**、朝车尾 ⇒ `exhaust`（维持原样，零变化）
    //   thrustSign = -1（后撤）：喷焰在**车头**、朝车头 ⇒ `-exhaust`
    //   ⇒ 两种模式都满足「喷焰朝车外、车辆被推向反方向」。
    const sign = this.params.trigger?.thrustSign ?? 1;
    const rearward = sign < 0;
    // 后撤：根部移到车头前方（沿 forward 的对称镜像位置），方向取 -exhaust。
    const bodyPos = world.getPosition(vehicle.body);
    const mountFromBody = { x: partPos.x - bodyPos.x, y: partPos.y - bodyPos.y };
    const rootX = rearward ? bodyPos.x - mountFromBody.x : partPos.x;
    const rootY = rearward ? bodyPos.y - mountFromBody.y : partPos.y;
    return {
      // 喷焰根部 =真实安装点（sign=+1）；sign=-1 时为其**车头镜像点**（喷焰在车头外侧，绝不穿车）。
      x: rootX,
      y: rootY,
      // 方向与推进方向严格相反（sign=+1 → exhaust；sign=-1 → -exhaust = forward）。
      dirX: rearward ? -exhaust.x : exhaust.x,
      dirY: rearward ? -exhaust.y : exhaust.y,
      length: this.params.flameLength,
      width: this.params.flameWidth,
      color: this.params.flameColor,
      team: vehicle.team,
      phase: this.phase, // 'windup' | 'thrust' | 'cooldown'
      tMs,
    };
  }
}
