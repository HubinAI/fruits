/**
 * PBL-A1-PORTRAIT-TOPDOWN-ARENA｜Arena A 最小 Runtime：纵向俯视物理竞技场。
 *
 * 空间模型（本 Queue 的全部差异都收敛在本文件内）：
 *   - 固定竖屏摄像机（逻辑 390×844，复用 Lab 既有 PlayerViewportTransform）；
 *   - 我方下中出生、敌方上排出生：**纵向承担接敌距离，横向承担有限机动**；
 *   - 四边静态实体边界（低反弹），全自动即时物理战斗；
 *   - 无重力 / 无刺墙 / 无缩圈 / 无边界伤害 / 无出界死亡。
 *
 * 复用的**共享 Battle Foundation**（PBL-F2 起具备真实 1vN 能力，本文件不复制第二套物理语义）：
 *   - `PlanckWorld`（零重力俯视世界）；
 *   - `createPlanckVehicle` + `resolveVehicleCollisionFilter('instance-exclusive')`
 *     → 同队不同车辆实例真实碰撞（敌↔敌），同车内部仍不碰撞；
 *   - `ContactRouter` 实例级路由（`OwnerTag.vehicleId` → 精确车辆实例）；
 *   - `DamageResolver` / `CombatEventBus`；
 *   - `BehaviorRegistry` 的全部正式武器 / 辅助行为（cannon / hammer / saw / machineGun / thruster …）。
 *
 * 明确**不**复用 / 不引入：
 *   - `PlanckBattleOrchestrator`（正式 1v1 编排，硬编码重力与两车装配）；
 *   - `PlanckArenaRuntime`（含刺墙 / 缩圈 / hazard，与 Arena A 规则冲突）。
 *
 * Lab-local Topdown Movement Adapter（必改 2）：
 *   - **不伪造**正式 wheel-ground `grounded`（`drivePlanckVehicle` 在本文件完全不被调用）；
 *   - 轮组 def 仍只作**资产来源**：`driveTorque / mass / radius / maxRPM / grip` 决定
 *     「加速能力、巡航速度上限、转向力臂」，全部经真实 registry 解析，无手写数值；
 *   - 平移 = 沿 chassis 真实前向的真实 `applyLinearImpulse`（作用于真实 COM，质量/惯量参与）；
 *   - 转向 = 在真实质心前后等距两点施加**等大反向冲量对（力偶）**：净力为 0 → 不改线速度，
 *     只产生真实角冲量；惯量与力臂（真实轮距）决定转向响应；
 *   - Movement 同时影响位置与朝向；武器发射方向 = chassis 真实前向（正式 CannonBehavior
 *     语义），因此「移动 → 朝向 → 命中」闭环成立，不存在无视车身朝向的 360° 自动炮塔。
 *
 * 本文件不修改任何正式 HP / 伤害 / CD / 射程 / 弹丸 / 质量数值。
 */
import { registry } from '../../core/content';
import { resolveSnapshot } from '../../core/buildSnapshot';
import { PHYSICS_HZ, rpmToRadPerStep } from '../../physics/units';
import { PlanckWorld, type BodyHandle } from '../../physics/planckWorld';
import {
  PlanckCategory,
  createPlanckVehicle,
  rotatePlanckVehicle,
  type PlanckVehicle,
} from '../../battle/planckVehicleAssembly';
import { ContactRouter, DEFAULT_IMPACT_CONFIG } from '../../battle/contactRouter';
import { DamageResolver } from '../../battle/damageResolver';
import { CombatEventBus, type BattleEvent } from '../../battle/combatEvents';
import type { PartBehaviorRuntime } from '../../battle/behaviorRuntime';
import { getBehaviorFactory } from '../../battle/behaviorRegistry';
import type { ColliderDef } from '../../core/types';
import { PORTRAIT_LOGICAL_H, PORTRAIT_LOGICAL_W } from './constants';
import { HUD_BAND_H, type Rect } from './layout';
import type { SpawnPlan, SpawnedEntity } from './entities';

/** 固定物理步长（ms）：与 PlanckWorld 一致。 */
const FIXED_DT_MS = 1000 / PHYSICS_HZ;

/* ---------------------------------------------------------------- 空间 */

export interface ArenaABounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** 墙体厚度（逻辑 px）。 */
export const ARENA_A_WALL_THICKNESS = 12;

/** 舞台底沿预留（逻辑 px）：底部留出空档，不与舞台边缘贴合。 */
export const ARENA_A_BOTTOM_INSET = 32;

/**
 * 顶边界与 HUD 带（`HUD_BAND_H` = 132）之间必须留出的净空（逻辑 px）。
 * 取 8px：既保证「HUD 带内零几何」是**有余量**的硬约束（不是贴着 132 的刀锋值），
 * 也让顶墙的整条矩形落在任何「HUD 带排除区」之外（Lab 自身与 E2E 像素统计一致）。
 */
export const ARENA_A_HUD_CLEARANCE = 8;

/**
 * 可活动区（四边墙体的**内表面**）。位于 HUD 带之下、舞台底边之上，
 * 全部取整数 → 与像素级渲染/断言可直接对齐。
 *
 * ⚠️ 左右内表面必须**让出墙厚**（`minX = 墙厚` / `maxX = 舞台宽 - 墙厚`）：
 * 墙体实体是贴着内表面向外堆的，若内表面取 10 而墙厚 12，左墙会落到 x∈[-2,10]、
 * 右墙落到 x∈[380,392] —— 即墙体有 2px 伸出逻辑舞台之外，被 Canvas 裁掉，
 * 于是「渲染出来的像素」与「几何账本 / 物理墙」不再一致（像素级 E2E 会假通过/假失败）。
 * 现在四面墙**全部完整落在舞台内**：左 [0,12]、右 [378,390]、上 [140,152]、下 [812,824]。
 */
export const ARENA_A_BOUNDS: ArenaABounds = {
  minX: ARENA_A_WALL_THICKNESS, // 12
  minY: HUD_BAND_H + ARENA_A_HUD_CLEARANCE + ARENA_A_WALL_THICKNESS, // 152（顶墙 = [140,152]）
  maxX: PORTRAIT_LOGICAL_W - ARENA_A_WALL_THICKNESS, // 378
  maxY: PORTRAIT_LOGICAL_H - ARENA_A_BOTTOM_INSET, // 812（底墙 [812,824] 完整落在舞台内）
};

/** 墙体低反弹：restitution 取小值 → 撞墙只轻微回弹，不弹飞。 */
export const ARENA_A_WALL_RESTITUTION = 0.05;

/** Arena A 无重力（俯视）。 */
export const ARENA_A_GRAVITY = { x: 0, y: 0 } as const;

/** 四边墙体矩形（渲染与物理共用的唯一几何来源）。 */
export function arenaAWallRects(): Rect[] {
  const b = ARENA_A_BOUNDS;
  const t = ARENA_A_WALL_THICKNESS;
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  return [
    { x: b.minX - t, y: b.minY - t, w: t, h: h + t * 2 },
    { x: b.maxX, y: b.minY - t, w: t, h: h + t * 2 },
    { x: b.minX - t, y: b.minY - t, w: w + t * 2, h: t },
    { x: b.minX - t, y: b.maxY, w: w + t * 2, h: t },
  ];
}

export interface ArenaASpawn {
  readonly x: number;
  readonly y: number;
  /** 初始朝向（世界角 rad）：forward = rotateLocal({facing,0}, angle)。 */
  readonly headingRad: number;
}

/** 出生点距边界的净空（逻辑 px）：保证整车真实 collider 外接框不与墙体初始重叠。 */
export const ARENA_A_SPAWN_GAP = 6;

/** 我方出生点：下中，朝上（-Y）→ 与敌方纵向拉开接敌距离。 */
export function arenaAPlayerSpawn(): ArenaASpawn {
  const b = ARENA_A_BOUNDS;
  return { x: (b.minX + b.maxX) / 2, y: b.maxY - ARENA_A_SPAWN_GAP, headingRad: -Math.PI / 2 };
}

/** 敌方出生点：上排，朝下（+Y）；count=3 时横向铺开（横向承担有限机动）。 */
export function arenaAEnemySpawns(count: number): ArenaASpawn[] {
  const b = ARENA_A_BOUNDS;
  const y = b.minY + ARENA_A_SPAWN_GAP;
  const cx = (b.minX + b.maxX) / 2;
  if (count <= 1) return [{ x: cx, y, headingRad: Math.PI / 2 }];
  const spread = 115;
  return Array.from({ length: count }, (_, i) => ({
    x: cx + (i - (count - 1) / 2) * spread,
    y,
    headingRad: Math.PI / 2,
  }));
}

/* ------------------------------------------------- Lab-local 俯视驱动 */

/**
 * 俯视驱动标定（Lab-local Adapter 常量，**不是平衡数值**）：
 * 只把「真实轮组扭矩 / 整车质量 / 轮组转速」映射为俯视加速度与转向响应，
 * 不改变任何 HP / 伤害 / CD / 射程 / 弹丸 / 质量。
 */
export const TOPDOWN_DRIVE = {
  /** 加速度标定：accel(px/step²) = accelScale × ΣdriveTorque / totalMass */
  accelScale: 5,
  /** 巡航速度上限 = 轮组最高线速度（maxRPM×radius）× cruiseFraction */
  cruiseFraction: 0.5,
  /** 目标角速度上限（rad/step） */
  maxTurnRateRadPerStep: 0.045,
  /** 角速度目标增益：targetω = clamp(error × gain, ±max) */
  turnRateGain: 0.25,
  /** 单步角速度增量上限（rad/step）：力偶冲量按它折算 */
  maxAngularAccelPerStep: 0.003,
  /** 朝向死区（rad）：误差小于它即认为已对准 */
  headingDeadbandRad: 0.05,
} as const;

/**
 * Lab-local 脱困规则（**纯油门决策，不新增任何物理语义**）：
 *
 * 背景（PBL-A1 实测）：俯视场里车头/前伸武器一旦顶住边界墙或更重的敌车，若决策层
 * 仍持续全油门，车辆会永久锁死。实测：香蕉冲锋锤首次撞击后被弹入角落，自身 `shapes`
 * 同时贴住右墙 x=380 与上墙 y=148，此后 7s 内净位移 ≈ 0（仅剩贴墙振荡），决策层却仍是
 * 全油门 → 直到被击杀都无法再次机动。这属于「移动 / 朝向必须真实生效」的自身正确性问题，
 * 与 HP / 伤害 / 质量 / 惯量等任何数值无关。
 *
 * 规则（只用车辆**自身实测位移**判断，不读墙、不加力、不改质量 / 惯量）：
 *   每 `windowSteps` 步统计一次「净位移 / 步数」= 平均推进速度；
 *   若平均推进速度 < cruise × minSpeedRatio → 判为受阻，反向推进 `reverseSteps` 步
 *   （期间持续转向目标），然后回到正常决策。
 * 用**净位移**而非瞬时速度，因此「贴住墙来回振荡」不会被误判为在前进。
 * 反向推进走的是同一个 `driveTopdownVehicle` 执行器（同样的真实线性冲量），
 * 仍是「真实推进」，只是推进方向由决策层选择。
 */
export const TOPDOWN_ANTI_WEDGE = {
  /** 窗口步数：每该步数统计一次平均推进速度（20 步 ≈ 0.33s） */
  windowSteps: 20,
  /** 受阻阈值：平均推进速度 < 巡航速度 × 该比例即视为受阻 */
  minSpeedRatio: 0.25,
  /** 脱困反向推进步数（30 步 = 0.5s） */
  reverseSteps: 30,
} as const;

/** 俯视移动能力（全部由真实轮组 def 推导，无手写数值）。 */
export interface TopdownCapability {
  /** Σ 轮组 driveTorque */
  readonly sumDriveTorque: number;
  /** 轮组最高线速度（px/step）= min(rpmToRadPerStep(maxRPM) × radius) */
  readonly maxSpeedPxPerStep: number;
  /** 真实轮距半宽（px）= max|hardpoint.localPosition.x|（力偶力臂） */
  readonly halfWheelbasePx: number;
}

export function topdownCapabilityOf(vehicle: PlanckVehicle): TopdownCapability {
  let sumDriveTorque = 0;
  let maxSpeedPxPerStep = Infinity;
  let halfWheelbasePx = 0;
  for (const w of vehicle.wheels) {
    sumDriveTorque += w.def.driveTorque;
    maxSpeedPxPerStep = Math.min(maxSpeedPxPerStep, rpmToRadPerStep(w.def.maxRPM) * w.def.radius);
    halfWheelbasePx = Math.max(halfWheelbasePx, Math.abs(w.hardpoint.localPosition.x));
  }
  if (vehicle.wheels.length === 0) {
    // 无轮组（不应发生）：不虚构能力，直接给 0 → 该实体在 Arena A 无法自行移动。
    return { sumDriveTorque: 0, maxSpeedPxPerStep: 0, halfWheelbasePx: 0 };
  }
  return { sumDriveTorque, maxSpeedPxPerStep, halfWheelbasePx };
}

/** 俯视驱动指令（引擎中立语义）。 */
export interface TopdownDriveCommand {
  /** -1 后退 / 0 不推进（滑行）/ 1 前进，沿 chassis 真实前向 */
  readonly throttle: -1 | 0 | 1;
  /** 期望朝向（世界角 rad）；null = 不施加转向 */
  readonly desiredHeadingRad: number | null;
}

/** 归一化到 (-π, π]。 */
export function wrapPi(a: number): number {
  let x = a;
  while (x <= -Math.PI) x += Math.PI * 2;
  while (x > Math.PI) x -= Math.PI * 2;
  return x;
}

/** 车辆真实前向（世界角 rad）：forward = rotateLocal({facing,0}, chassisAngle)。 */
export function headingOf(world: PlanckWorld, vehicle: PlanckVehicle): number {
  return world.getAngle(vehicle.body) + (vehicle.facing === 1 ? 0 : Math.PI);
}

/**
 * Lab-local Topdown Movement Adapter：一个固定物理步内施加一次。
 *
 * - 平移：沿真实前向对 chassis 施加真实 `applyLinearImpulse`（作用点 = chassis 真实 COM，
 *   `J = totalMass × Δv`，Δv 由「真实扭矩 / 真实质量」推导的加速度裁剪 → 质量与轮组差异真实生效）；
 * - 转向：在 COM 前后 ±halfWheelbase 两点施加**等大反向冲量对**（净力 0）→ 纯角冲量，
 *   惯量真实参与；角速度目标由真实转向需求决定并被 `maxTurnRateRadPerStep` 限制；
 * - 不调用 `drivePlanckVehicle`（不使用官方 wheel-ground `grounded` 语义）；
 *   不 setVelocity / 不 setPosition / 不 teleport / 不对对手施力。
 */
export function driveTopdownVehicle(
  world: PlanckWorld,
  vehicle: PlanckVehicle,
  command: TopdownDriveCommand,
): void {
  const cap = topdownCapabilityOf(vehicle);
  const header = headingOf(world, vehicle);
  const fx = Math.cos(header);
  const fy = Math.sin(header);
  // 屏幕坐标 Y 向下：right = rotate(fwd, +90°) = (-fy, fx)
  const rx = -fy;
  const ry = fx;

  // ---- 转向（力偶） ----
  if (command.desiredHeadingRad !== null && cap.halfWheelbasePx > 0) {
    const error = wrapPi(command.desiredHeadingRad - header);
    if (Math.abs(error) > TOPDOWN_DRIVE.headingDeadbandRad) {
      const currentOmega = world.getAngularVelocity(vehicle.body);
      const targetOmega = Math.max(
        -TOPDOWN_DRIVE.maxTurnRateRadPerStep,
        Math.min(TOPDOWN_DRIVE.maxTurnRateRadPerStep, error * TOPDOWN_DRIVE.turnRateGain),
      );
      // 已按正确方向到达目标角速度 → 不再加速（等效「电机到速即停」，不是写状态）
      const need = targetOmega - currentOmega;
      if (Math.abs(need) > 1e-6) {
        const deltaOmega = Math.max(
          -TOPDOWN_DRIVE.maxAngularAccelPerStep,
          Math.min(TOPDOWN_DRIVE.maxAngularAccelPerStep, need),
        );
        const impulse = vehicle.totalMass * deltaOmega * cap.halfWheelbasePx;
        const com = world.getCenterOfMass(vehicle.body);
        const front = { x: com.x + fx * cap.halfWheelbasePx, y: com.y + fy * cap.halfWheelbasePx };
        const back = { x: com.x - fx * cap.halfWheelbasePx, y: com.y - fy * cap.halfWheelbasePx };
        world.applyLinearImpulse(vehicle.body, { x: rx * impulse, y: ry * impulse }, front);
        world.applyLinearImpulse(vehicle.body, { x: -rx * impulse, y: -ry * impulse }, back);
      }
    }
  }

  // ---- 平移（真实线性冲量，作用点 = chassis 真实 COM） ----
  if (command.throttle !== 0 && cap.sumDriveTorque > 0) {
    const accelPerStep = (TOPDOWN_DRIVE.accelScale * cap.sumDriveTorque) / vehicle.totalMass;
    const maxSpeed = cap.maxSpeedPxPerStep * TOPDOWN_DRIVE.cruiseFraction;
    const v = world.getLinearVelocity(vehicle.body);
    const vAlong = v.x * fx + v.y * fy;
    const target = command.throttle > 0 ? maxSpeed : -maxSpeed;
    const delta = Math.max(-accelPerStep, Math.min(accelPerStep, target - vAlong));
    const impulse = vehicle.totalMass * delta;
    world.applyLinearImpulse(vehicle.body, { x: fx * impulse, y: fy * impulse });
  }
}

/* --------------------------------------------------------- 交战 AI（Lab） */

/** 实体角色（由正式武器数据推导，不手写）：有弹丸武器 = ranged，否则 = melee。 */
export type ArenaARole = 'ranged' | 'melee';

export function roleOf(entity: SpawnedEntity): ArenaARole {
  return entity.functionals.some((f) => f.profile.projectileDamage !== null) ? 'ranged' : 'melee';
}

/**
 * 交战 AI 参数（Lab-local 决策常量，**不是平衡数值**）：
 * 只决定「往哪开、朝向谁」，不改变任何武器 / 车体数值。
 */
export const ARENA_A_AI = {
  /** ranged：偏好交战距离（逻辑 px）——履带车「稳定、较慢、偏控距」的意图侧 */
  rangedPreferred: 250,
  /** ranged：偏好距离的死区半宽 */
  rangedDeadband: 60,
} as const;

export interface ArenaADecision {
  readonly throttle: -1 | 0 | 1;
  readonly desiredHeadingRad: number | null;
}

export interface ArenaAAgent {
  readonly entity: SpawnedEntity;
  readonly vehicle: PlanckVehicle;
  readonly role: ArenaARole;
  /** drive === 'stationary' → 不平移（只转向），如正式对手模板 OPP-03（停驻炮台） */
  readonly mobile: boolean;
}

/** 决策上下文（位置 / 距离由运行时实时提供，避免使用装配期的静态缓存）。 */
export interface ArenaADecideContext {
  readonly selfX: number;
  readonly selfY: number;
  readonly targetX: number;
  readonly targetY: number;
  readonly distance: number;
  /** 已连续受阻步数（运行时按自身实测速度统计；0 = 未被阻碍）。 */
  readonly blockedSteps: number;
}

/** 决策函数签名（可注入；默认 = decideArenaAAction）。 */
export type ArenaADecide = (
  self: ArenaAAgent,
  target: ArenaAAgent,
  ctx: ArenaADecideContext,
) => ArenaADecision;

/**
 * 默认决策：
 * - melee（锤 / 锯）：全速接敌并保持朝向目标 → 冲撞与真实接触；
 * - ranged（炮 / 机枪）：维持偏好距离带（远则进、近则退、带内滑行），朝向始终指向目标；
 * - stationary：只转向，不平移。
 * 武器的**开火方向 = chassis 真实前向**（正式行为语义），故「朝向」决定命中，不存在自动瞄准塔。
 */
export function decideArenaAAction(
  self: ArenaAAgent,
  _target: ArenaAAgent,
  ctx: ArenaADecideContext,
): ArenaADecision {
  const desired = Math.atan2(ctx.targetY - ctx.selfY, ctx.targetX - ctx.selfX);
  if (!self.mobile) return { throttle: 0, desiredHeadingRad: desired };
  if (self.role === 'melee') return { throttle: 1, desiredHeadingRad: desired };
  if (ctx.distance > ARENA_A_AI.rangedPreferred + ARENA_A_AI.rangedDeadband) {
    return { throttle: 1, desiredHeadingRad: desired };
  }
  if (ctx.distance < ARENA_A_AI.rangedPreferred - ARENA_A_AI.rangedDeadband) {
    return { throttle: -1, desiredHeadingRad: desired };
  }
  return { throttle: 0, desiredHeadingRad: desired };
}

/* ------------------------------------------------------------- 运行时 */

/** 场上一个运行期实体（真实 Planck 车辆 + 正式行为）。 */
export type ArenaAEntityRuntime = ArenaAAgent;

export interface ArenaAEntityView {
  readonly entityId: string;
  /**
   * PBL-M3-LIGHT-SWARM-EXPERIENCE-VALIDATION-R1：真实车辆实例身份 = `OwnerTag.vehicleId`。
   * 多实体场景下每个实体各不相同（单敌场景也已如此），是本 Queue「三者各自有独立
   * vehicleId」验收的**可观测通道**（以前只在物理内部存在，探针读不到）。
   */
  readonly vehicleId: string;
  readonly team: string;
  readonly role: ArenaARole;
  readonly bodyDefId: string;
  readonly bodyName: string;
  readonly hp: number;
  readonly maxHp: number;
  readonly x: number;
  readonly y: number;
  readonly headingRad: number;
  readonly speedPxPerStep: number;
  /** 当前是否处于脱困反向推进（Lab-local 脱困规则；诊断用）。 */
  readonly reversing: boolean;
  /** 连续受阻步数（0 = 未受阻）。 */
  readonly blockedSteps: number;
  /**
   * **完整**真实 collider 世界几何（车身 + 轮组 + 全部功能件；含真实姿态）。
   * 渲染只取多边形的 `.rect`（圆盘不参与像素面积账本，与 PBL-F1 约定一致），
   * 而「真实相交 / 不重叠穿透」判定使用全部 shape（含轮组圆盘）→ 判定覆盖无缺口。
   */
  readonly shapes: readonly ArenaAColliderShape[];
  /** 整车（含轮 / 部件）真实碰撞外接框——用于边界包含判定。 */
  readonly boundsRect: Rect;
}

export interface ArenaAProjectileView {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly team: string;
  /** 真实飞行速度（px/step，读自引擎；数据缺失时为 null）。 */
  readonly velocity: { x: number; y: number } | null;
  /** 真实开火方向（spread 之前；仅部分武器透出，缺失时为 null）。 */
  readonly fireDir: { x: number; y: number } | null;
}

export interface ArenaADamageView {
  readonly source: string;
  readonly target: string;
  readonly damageSource: string;
  readonly partId: string | null;
  readonly damage: number;
}

export interface ArenaAView {
  readonly gravity: { x: number; y: number };
  readonly bounds: ArenaABounds;
  readonly walls: readonly Rect[];
  readonly steps: number;
  readonly timeMs: number;
  readonly shotsFired: number;
  readonly hits: number;
  readonly lastDamage: ArenaADamageView | null;
  readonly entities: readonly ArenaAEntityView[];
  readonly projectiles: readonly ArenaAProjectileView[];
  /** 任一对实体中心距（用于「接敌过程」诊断）。 */
  readonly minPairDistancePx: number;
  /**
   * 任一对实体之间最深的**真实碰撞几何**重叠深度（px）。
   * ≤ 0 → 全场无任何真实重叠（不是 AABB 近似：斜置车辆按真实旋转多边形判定）。
   */
  readonly worstEntityOverlapDepthPx: number;
}

export interface ArenaARuntimeOptions {
  /** 决策函数注入（默认 = decideArenaAAction）；测试可用它隔离「移动」与「武器」两条链路。 */
  readonly decide?: ArenaADecide;
  /**
   * 是否启用 Lab-local 脱困规则（默认 true）。置 false 用于「纯物理」标定/回归断言
   * （决策指令 1:1 落到执行器，不做任何受阻修正）。
   */
  readonly antiWedge?: boolean;
}

/** 整车（chassis + 轮 + 部件）当前世界外接框。 */
function mergedBounds(
  world: PlanckWorld,
  vehicle: PlanckVehicle,
): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const merge = (bb: { minX: number; minY: number; maxX: number; maxY: number }): void => {
    minX = Math.min(minX, bb.minX);
    minY = Math.min(minY, bb.minY);
    maxX = Math.max(maxX, bb.maxX);
    maxY = Math.max(maxY, bb.maxY);
  };
  merge(world.getCollisionBounds(vehicle.body));
  for (const w of vehicle.wheels) merge(world.getCollisionBounds(w.body));
  for (const p of vehicle.parts) merge(world.getCollisionBounds(p.body));
  return { minX, minY, maxX, maxY };
}

/** 整车刚性平移（不改变姿态 / 速度 / 关节约束）。 */
function translateVehicle(
  world: PlanckWorld,
  vehicle: PlanckVehicle,
  dx: number,
  dy: number,
): void {
  const shift = (b: BodyHandle): void => {
    const p = world.getPosition(b);
    world.setPosition(b, p.x + dx, p.y + dy);
  };
  shift(vehicle.body);
  for (const w of vehicle.wheels) shift(w.body);
  for (const p of vehicle.parts) shift(p.body);
  vehicle.com = { x: vehicle.com.x + dx, y: vehicle.com.y + dy };
}

/**
 * 出生定位（**数据驱动**，不手写几何）：
 * 1) 先按出生朝向旋转整车；
 * 2) 用整车**真实 collider 外接框**（含轮 / 部件伸出部分）算出横向居中的平移量；
 * 3) 纵向把外接框贴到边界内侧（我方贴下沿 / 敌方贴上沿）——保证初始不与墙体重叠，
 *    因此不存在「出生瞬间被解算器弹开」的伪造初速度。
 */
function placeVehicle(
  world: PlanckWorld,
  vehicle: PlanckVehicle,
  spawn: ArenaASpawn,
  edge: 'bottom' | 'top',
): void {
  rotatePlanckVehicle(world, vehicle, spawn.headingRad);
  const bb = mergedBounds(world, vehicle);
  const dx = spawn.x - (bb.minX + bb.maxX) / 2;
  const dy =
    edge === 'bottom'
      ? ARENA_A_BOUNDS.maxY - ARENA_A_SPAWN_GAP - bb.maxY
      : ARENA_A_BOUNDS.minY + ARENA_A_SPAWN_GAP - bb.minY;
  translateVehicle(world, vehicle, dx, dy);
}

function mirrorCollider(c: ColliderDef): ColliderDef {
  const m: ColliderDef = { ...c, offset: { x: -c.offset.x, y: c.offset.y } };
  if (c.angle !== undefined) m.angle = -c.angle;
  if (c.shape === 'polygon' && c.vertices) {
    m.vertices = [...c.vertices].reverse().map((v) => ({ x: -v.x, y: v.y }));
  }
  return m;
}

/** 圆盘形 collider 的真实世界几何（轮组：WheelDef 只有 radius，形状恒为圆）。 */
function circleShape(
  owner: 'body' | 'wheel' | 'part',
  partId: string | null,
  pos: { x: number; y: number },
  radius: number,
): ArenaAColliderShape {
  return {
    owner,
    partId,
    shape: 'circle',
    points: [],
    cx: pos.x,
    cy: pos.y,
    radius,
    rect: {
      x: Math.round(pos.x - radius),
      y: Math.round(pos.y - radius),
      w: Math.round(radius * 2),
      h: Math.round(radius * 2),
    },
  };
}

/**
 * 单个 collider 在当前刚体姿态下的**真实世界几何**。
 *
 * 这是本文件里唯一的 collider → 世界几何换算点：渲染（`rect`）、像素面积账本、
 * 以及测试中的「真实相交 / 不重叠穿透」判定（`points` / 圆盘）全部取自它，
 * 不存在第二套近似口径。box 展开为 4 顶点凸多边形（含真实旋转），circle 保留为圆盘；
 * `rect` 是其世界外接矩形（整数取整 → 像素面积可精确断言）。
 */
export interface ArenaAColliderShape {
  readonly owner: 'body' | 'wheel' | 'part';
  readonly partId: string | null;
  readonly shape: 'polygon' | 'circle';
  /** 世界顶点（凸多边形；circle 时为空数组）。 */
  readonly points: readonly { readonly x: number; readonly y: number }[];
  /** 几何中心（circle 圆心；polygon 为换算出的局部原点位置）。 */
  readonly cx: number;
  readonly cy: number;
  /** 圆盘半径（polygon 时为 0）。 */
  readonly radius: number;
  /** 世界外接矩形（渲染 / 像素面积账本用）。 */
  readonly rect: Rect;
}

function colliderWorldShape(
  c: ColliderDef,
  facing: 1 | -1,
  pos: { x: number; y: number },
  angle: number,
  owner: 'body' | 'wheel' | 'part',
  partId: string | null,
): ArenaAColliderShape | null {
  const eff = facing === -1 ? mirrorCollider(c) : c;
  const ca = angle + (eff.angle ?? 0);
  const cos = Math.cos(ca);
  const sin = Math.sin(ca);
  const off = eff.offset ?? { x: 0, y: 0 };
  const cx = pos.x + (off.x * cos - off.y * sin);
  const cy = pos.y + (off.x * sin + off.y * cos);
  let local: Array<{ x: number; y: number }>;
  if (eff.shape === 'box') {
    const w = eff.width ?? 0;
    const h = eff.height ?? 0;
    if (!(w > 0 && h > 0)) return null;
    local = [
      { x: -w / 2, y: -h / 2 },
      { x: w / 2, y: -h / 2 },
      { x: w / 2, y: h / 2 },
      { x: -w / 2, y: h / 2 },
    ];
  } else if (eff.shape === 'circle') {
    const r = eff.radius ?? 0;
    if (!(r > 0)) return null;
    return {
      owner,
      partId,
      shape: 'circle',
      points: [],
      cx,
      cy,
      radius: r,
      rect: { x: Math.round(cx - r), y: Math.round(cy - r), w: Math.round(r * 2), h: Math.round(r * 2) },
    };
  } else {
    const pts = eff.vertices ?? [];
    if (pts.length === 0) return null;
    local = pts.map((p) => ({ x: p.x, y: p.y }));
  }
  const points = local.map((p) => ({
    x: cx + (p.x * cos - p.y * sin),
    y: cy + (p.x * sin + p.y * cos),
  }));
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return {
    owner,
    partId,
    shape: 'polygon',
    points,
    cx,
    cy,
    radius: 0,
    rect: {
      x: Math.round(minX),
      y: Math.round(minY),
      w: Math.round(maxX - minX),
      h: Math.round(maxY - minY),
    },
  };
}

/* ------------------------------------------ 真实相交判定（唯一口径） */

interface Axis {
  readonly x: number;
  readonly y: number;
}

function projectPolygon(pts: readonly { readonly x: number; readonly y: number }[], axis: Axis): {
  min: number;
  max: number;
} {
  let min = Infinity;
  let max = -Infinity;
  for (const p of pts) {
    const d = p.x * axis.x + p.y * axis.y;
    min = Math.min(min, d);
    max = Math.max(max, d);
  }
  return { min, max };
}

/** 凸多边形（含 box 展开）分离轴：各条边的外法线（已归一化）。 */
function polygonAxes(pts: readonly { readonly x: number; readonly y: number }[]): Axis[] {
  const axes: Axis[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = Math.hypot(ex, ey);
    if (len <= 1e-9) continue;
    axes.push({ x: -ey / len, y: ex / len });
  }
  return axes;
}

/**
 * 两个 collider **真实几何**之间的带符号分离量（逻辑 px），符号约定**只有一个**：
 *   > 0 → 互不相交，值为两者之间（SAT 意义下）的净间距；
 *   = 0 → 相切；
 *   < 0 → 相交，|值| 为最小平移距离（重叠深度）。
 *
 * 推导：对每个候选轴求两区间重叠量 overlap，则
 *   - 若所有 axis 上 overlap > 0 → 相交，MTV 深度 = min(overlap)；
 *   - 否则存在分离轴，真实距离 = -max(overlap)（最接近 0 的那条轴）。
 * 两者合起来恰好等于 `min(overlap)`（相交时为正、分离时为负），故本函数返回 `-min(overlap)`。
 *
 * box 用真实旋转后的 4 顶点、circle 用真实圆心/半径 → 与 Planck 中的实际形状一致；
 * 不使用任何 AABB 近似（AABB 在斜置时会把「角相接」误判为重叠）。
 */
export function shapesSeparationPx(a: ArenaAColliderShape, b: ArenaAColliderShape): number {
  if (a.shape === 'circle' && b.shape === 'circle') {
    return Math.hypot(b.cx - a.cx, b.cy - a.cy) - (a.radius + b.radius);
  }
  if (a.shape === 'circle' || b.shape === 'circle') {
    const circle = a.shape === 'circle' ? a : b;
    const poly = a.shape === 'circle' ? b : a;
    let raw = Infinity;
    const consider = (ax: Axis): void => {
      const p = projectPolygon(poly.points, ax);
      const c = circle.cx * ax.x + circle.cy * ax.y;
      // 区间重叠量（标准口径：min(右端) − max(左端)；含「圆完全落在多边形内」的退化情形）
      raw = Math.min(raw, Math.min(c + circle.radius, p.max) - Math.max(c - circle.radius, p.min));
    };
    // 多边形各边法线
    for (const ax of polygonAxes(poly.points)) consider(ax);
    // 圆心 → 多边形最近顶点（圆与「角」的分离轴）
    let nearest = poly.points[0]!;
    let nearestD = Infinity;
    for (const p of poly.points) {
      const d = Math.hypot(p.x - circle.cx, p.y - circle.cy);
      if (d < nearestD) {
        nearestD = d;
        nearest = p;
      }
    }
    if (nearestD > 1e-9) {
      consider({ x: (circle.cx - nearest.x) / nearestD, y: (circle.cy - nearest.y) / nearestD });
    }
    return -raw;
  }
  let raw = Infinity;
  for (const ax of [...polygonAxes(a.points), ...polygonAxes(b.points)]) {
    const pa = projectPolygon(a.points, ax);
    const pb = projectPolygon(b.points, ax);
    raw = Math.min(raw, Math.min(pa.max, pb.max) - Math.max(pa.min, pb.min));
  }
  return -raw;
}

/** 两个 collider 真实几何是否相交（含相切）。 */
export function shapesIntersect(a: ArenaAColliderShape, b: ArenaAColliderShape): boolean {
  return shapesSeparationPx(a, b) <= 0;
}

/**
 * 两个实体之间「最深的真实碰撞几何重叠深度」（px）：
 * ≤ 0 表示全场无任何真实重叠（值越负 = 两者越远）；> 0 表示存在真实重叠。
 * 只统计整车真实 collider（车身 + 轮 + 部件）；同实体内部天然相接，不在调用语义内。
 */
export function entityPairOverlapDepthPx(
  a: { readonly shapes: readonly ArenaAColliderShape[] },
  b: { readonly shapes: readonly ArenaAColliderShape[] },
): number {
  let closest = Infinity;
  for (const sa of a.shapes) {
    for (const sb of b.shapes) closest = Math.min(closest, shapesSeparationPx(sa, sb));
  }
  return Number.isFinite(closest) ? Math.min(0, closest) : 0;
}

/**
 * Arena A 最小 Runtime：真实 1vN 俯视物理竞技场。
 *
 * 生命周期：`new`（装配 world/边界/车辆/行为/router）→ `stepFixed` / `advance`
 * → `dispose`（丢弃 world 引用；无 DOM / 无渲染依赖，可纯 Node 测试）。
 */
export class ArenaARuntime {
  readonly world: PlanckWorld;
  readonly bounds: ArenaABounds = ARENA_A_BOUNDS;
  readonly gravity = { x: ARENA_A_GRAVITY.x, y: ARENA_A_GRAVITY.y };
  readonly agents: readonly ArenaAEntityRuntime[];
  readonly router: ContactRouter;
  readonly damageResolver: DamageResolver;
  readonly bus = new CombatEventBus();
  /** 四边静态边界 body（左 / 右 / 上 / 下，顺序与 arenaAWallRects 一致）。 */
  readonly walls: readonly BodyHandle[];
  private readonly behaviors: PartBehaviorRuntime[] = [];
  private readonly decide: ArenaADecide;
  private readonly antiWedge: boolean;
  /** 每实体的脱困状态（受阻步数 / 剩余反向步数 / 反向方向 / 位移窗口）。 */
  private readonly driveGuard: {
    blocked: number;
    reverseLeft: number;
    reversed: -1 | 1;
    windowSteps: number;
    windowX: number;
    windowY: number;
  }[];
  private stepIndex = 0;
  private timeMs = 0;
  private shots = 0;
  private hits = 0;
  private damage: ArenaADamageView | null = null;

  constructor(plan: SpawnPlan, options?: ArenaARuntimeOptions) {
    this.decide = options?.decide ?? decideArenaAAction;
    this.antiWedge = options?.antiWedge !== false;
    this.world = new PlanckWorld({ x: ARENA_A_GRAVITY.x, y: ARENA_A_GRAVITY.y });
    this.walls = this.buildWalls();

    // Damage / Death 事件由 DamageResolver 直接走事件总线；行为事件由 emit 走总线。
    // 统一在总线上订阅（唯一统计口径，不重复计数）。
    this.bus.subscribe((ev) => {
      if (ev.type === 'weaponFire') this.shots += 1;
      else if (ev.type === 'damage') {
        this.hits += 1;
        this.damage = {
          source: String(ev.source),
          target: String(ev.target),
          damageSource: String(ev.damageSource),
          partId: ev.partId ?? null,
          damage: ev.damage,
        };
      }
    });

    // 装配真实车辆：同队不同实例真实碰撞（PBL-F2 instance-exclusive），实例序号全局唯一。
    const spawns: ArenaASpawn[] = [arenaAPlayerSpawn(), ...arenaAEnemySpawns(plan.enemies.length)];
    const sources: SpawnedEntity[] = [plan.player, ...plan.enemies];
    const agents: ArenaAEntityRuntime[] = [];
    sources.forEach((entity, i) => {
      const resolved = resolveSnapshot(entity.snapshot, registry);
      const team = entity.team === 'player' ? 'A' : 'B';
      const vehicle = createPlanckVehicle(
        this.world,
        resolved,
        team,
        { x: 0, y: 0 },
        1,
        { policy: 'instance-exclusive', instanceIndex: i },
      );
      placeVehicle(this.world, vehicle, spawns[i]!, i === 0 ? 'bottom' : 'top');
      agents.push({
        entity,
        vehicle,
        role: roleOf(entity),
        mobile: entity.drive !== 'stationary',
      });
    });
    this.agents = agents;
    this.driveGuard = agents.map((a) => {
      const p = this.world.getPosition(a.vehicle.body);
      return {
        blocked: 0,
        reverseLeft: 0,
        reversed: -1 as -1 | 1,
        windowSteps: 0,
        windowX: p.x,
        windowY: p.y,
      };
    });

    // 正式 Behavior：每个 part 由 BehaviorRegistry 创建（不新增第二套 step / render 生命周期）
    for (const agent of this.agents) {
      for (const part of agent.vehicle.parts) {
        const factory = getBehaviorFactory(part.def.behavior);
        if (!factory) continue;
        this.behaviors.push(
          factory({
            vehicle: agent.vehicle,
            part,
            emit: (ev: BattleEvent) => this.bus.emit(ev),
          }),
        );
      }
    }

    this.damageResolver = new DamageResolver(this.bus);
    this.router = new ContactRouter(
      this.agents.map((a) => a.vehicle),
      this.damageResolver,
      DEFAULT_IMPACT_CONFIG,
      // Arena A 无刺墙 / 无缩圈 → hazard 参数恒为 0（不产生任何边界伤害）
      { tickMs: 0, damagePerTick: 0 },
    );
    // 只注册批次监听；无 OwnerTag（边界墙）的接触由 ContactRouter 安全忽略 → 无边界伤害
    this.world.setBatchedContactListener((ev) => this.router.handlePlanckContact(this.world, ev, 'Active'));
  }

  private buildWalls(): BodyHandle[] {
    const b = ARENA_A_BOUNDS;
    const t = ARENA_A_WALL_THICKNESS;
    const filter = {
      categoryBits: PlanckCategory.ARENA,
      maskBits: PlanckCategory.VEHICLE_A | PlanckCategory.VEHICLE_B | PlanckCategory.PROJECTILE,
    };
    const opts = { restitution: ARENA_A_WALL_RESTITUTION, collisionFilter: filter };
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    return [
      this.world.createStaticBox(b.minX - t / 2, cy, t, h + t * 2, opts),
      this.world.createStaticBox(b.maxX + t / 2, cy, t, h + t * 2, opts),
      this.world.createStaticBox(cx, b.minY - t / 2, w + t * 2, t, opts),
      this.world.createStaticBox(cx, b.maxY + t / 2, w + t * 2, t, opts),
    ];
  }

  /** 每固定步前：移动（俯视适配器）→ 正式行为（武器 / 辅助） */
  private beforeStep(): void {
    this.stepIndex += 1;
    this.timeMs = this.stepIndex * FIXED_DT_MS;

    this.agents.forEach((agent, i) => {
      const pos = this.world.getPosition(agent.vehicle.body);
      const target = this.nearestTargetOf(agent);
      if (!target) return;
      const targetPos = this.world.getPosition(target.vehicle.body);
      const distance = Math.hypot(targetPos.x - pos.x, targetPos.y - pos.y);
      const decision = this.decide(agent, target, {
        selfX: pos.x,
        selfY: pos.y,
        targetX: targetPos.x,
        targetY: targetPos.y,
        distance,
        blockedSteps: this.driveGuard[i]!.blocked,
      });
      let throttle: -1 | 0 | 1 = agent.mobile ? decision.throttle : 0;
      if (this.antiWedge && agent.mobile) {
        throttle = this.applyDriveGuard(agent, i, throttle);
      }
      driveTopdownVehicle(this.world, agent.vehicle, {
        throttle,
        desiredHeadingRad: decision.desiredHeadingRad,
      });
    });

    for (const b of this.behaviors) b.beforePhysicsStep(this.world, this.timeMs);
  }

  /**
   * Lab-local 脱困（见 TOPDOWN_ANTI_WEDGE）：只用车辆自身实测速度判定「受阻」，
   * 受阻则反向推进若干步以脱离墙角 / 脱离顶着敌车贴合的状态。纯油门决策，
   * 不加力、不瞬移、不改数值；反向推进仍走同一个 `driveTopdownVehicle`。
   */
  private applyDriveGuard(agent: ArenaAEntityRuntime, index: number, throttle: -1 | 0 | 1): -1 | 0 | 1 {
    const st = this.driveGuard[index]!;
    if (throttle === 0) {
      st.blocked = 0;
      st.windowSteps = 0;
      return throttle;
    }
    if (st.reverseLeft > 0) {
      st.reverseLeft -= 1;
      st.blocked += 1;
      return st.reversed;
    }

    const pos = this.world.getPosition(agent.vehicle.body);
    st.windowSteps += 1;
    st.blocked += 1;
    if (st.windowSteps >= TOPDOWN_ANTI_WEDGE.windowSteps) {
      const cap = topdownCapabilityOf(agent.vehicle);
      const cruise = cap.maxSpeedPxPerStep * TOPDOWN_DRIVE.cruiseFraction;
      const avgSpeed = Math.hypot(pos.x - st.windowX, pos.y - st.windowY) / st.windowSteps;
      st.windowSteps = 0;
      st.windowX = pos.x;
      st.windowY = pos.y;
      if (avgSpeed < TOPDOWN_ANTI_WEDGE.minSpeedRatio * cruise) {
        st.reverseLeft = TOPDOWN_ANTI_WEDGE.reverseSteps;
        st.reversed = throttle > 0 ? -1 : 1;
        return st.reversed;
      }
      st.blocked = 0;
    }
    return throttle;
  }

  /** 每固定步后：projectile 生命周期（与正式 Orchestrator 同一顺序） */
  private afterStep(): void {
    const facts = this.router.drainProjectileContactFacts();
    if (facts.length > 0) {
      for (const b of this.behaviors) b.afterPhysicsStep?.(this.world, facts);
    }
    for (const b of this.behaviors) {
      b.destroyOutOfBoundsProjectiles?.(this.world, (pos) => this.isOutOfBounds(pos));
    }
    this.router.advanceContactTicks(this.timeMs, 'Active');
  }

  /** 确定性固定步推进（测试 / 逻辑用）。 */
  stepFixed(steps: number): void {
    if (!Number.isInteger(steps) || steps < 1) {
      throw new Error(`ArenaARuntime: steps 必须是 >=1 的整数（收到 ${steps}）`);
    }
    for (let i = 0; i < steps; i++) {
      this.beforeStep();
      this.world.stepFixed(1);
      this.afterStep();
    }
  }

  /** 按真实帧时长推进（Lab 渲染循环用）；返回实际物理步数。 */
  advance(realDtMs: number): number {
    const n = this.world.step(realDtMs, 1, () => this.beforeStep());
    if (n > 0) this.afterStep();
    return n;
  }

  private isOutOfBounds(pos: { x: number; y: number }): boolean {
    const b = ARENA_A_BOUNDS;
    const m = 240;
    return pos.x < b.minX - m || pos.x > b.maxX + m || pos.y < b.minY - m || pos.y > b.maxY + m;
  }

  private nearestTargetOf(self: ArenaAEntityRuntime): ArenaAEntityRuntime | null {
    let best: ArenaAEntityRuntime | null = null;
    let bestD = Infinity;
    const selfPos = this.world.getPosition(self.vehicle.body);
    for (const other of this.agents) {
      if (other === self) continue;
      if (other.vehicle.team === self.vehicle.team) continue;
      if (other.vehicle.hp <= 0) continue;
      const pos = this.world.getPosition(other.vehicle.body);
      const d = Math.hypot(pos.x - selfPos.x, pos.y - selfPos.y);
      if (d < bestD) {
        bestD = d;
        best = other;
      }
    }
    return best;
  }

  /** 只读快照（渲染 / 诊断 / 测试）。 */
  view(): ArenaAView {
    const entities: ArenaAEntityView[] = this.agents.map((a, ai) => {
      const pos = this.world.getPosition(a.vehicle.body);
      const v = this.world.getLinearVelocity(a.vehicle.body);
      const bodyAngle = this.world.getAngle(a.vehicle.body);
      const shapes: ArenaAColliderShape[] = [];
      for (const c of a.vehicle.resolved.body.colliders) {
        const s = colliderWorldShape(c, a.vehicle.facing, pos, bodyAngle, 'body', null);
        if (s) shapes.push(s);
      }
      for (const w of a.vehicle.wheels) {
        shapes.push(circleShape('wheel', null, this.world.getPosition(w.body), w.def.radius));
      }
      for (const p of a.vehicle.parts) {
        const s = colliderWorldShape(
          p.def.collider,
          a.vehicle.facing,
          this.world.getPosition(p.body),
          this.world.getAngle(p.body),
          'part',
          p.def.id,
        );
        if (s) shapes.push(s);
      }
      const bb = mergedBounds(this.world, a.vehicle);
      return {
        entityId: a.entity.entityId,
        /**
         * PBL-M3-LIGHT-SWARM-EXPERIENCE-VALIDATION-R1：真实车辆实例身份
         * = `OwnerTag.vehicleId`（`planckVehicleAssembly.ts:319` 取 `resolved.snapshot.id`
         * ⇒ 就是 `entities.ts` 给每个实体生成的 snapshot id）。
         * 三敌各自独立 ⇒ 同队多车可被 `ContactRouter` 精确区分（本 Queue 验收 2 的直接证据）。
         */
        vehicleId: a.entity.snapshot.id,
        team: a.vehicle.team,
        role: a.role,
        bodyDefId: a.entity.bodyDefId,
        bodyName: a.entity.bodyName,
        hp: a.vehicle.hp,
        maxHp: a.vehicle.maxHp,
        x: pos.x,
        y: pos.y,
        headingRad: headingOf(this.world, a.vehicle),
        speedPxPerStep: Math.hypot(v.x, v.y),
        reversing: this.driveGuard[ai]!.reverseLeft > 0,
        blockedSteps: this.driveGuard[ai]!.blocked,
        shapes,
        boundsRect: {
          x: Math.round(bb.minX),
          y: Math.round(bb.minY),
          w: Math.round(bb.maxX - bb.minX),
          h: Math.round(bb.maxY - bb.minY),
        },
      };
    });

    const projectiles: ArenaAProjectileView[] = [];
    for (const b of this.behaviors) {
      for (const p of b.getRenderProjectiles?.(this.world) ?? []) {
        projectiles.push({
          x: p.center.x,
          y: p.center.y,
          radius: p.radius,
          team: String(p.team),
          velocity: p.velocity ? { x: p.velocity.x, y: p.velocity.y } : null,
          fireDir: p.fireDir ? { x: p.fireDir.x, y: p.fireDir.y } : null,
        });
      }
    }

    let minPair = Infinity;
    let worstOverlap = 0;
    for (let i = 0; i < entities.length; i++) {
      for (let j = i + 1; j < entities.length; j++) {
        minPair = Math.min(minPair, Math.hypot(entities[i]!.x - entities[j]!.x, entities[i]!.y - entities[j]!.y));
        worstOverlap = Math.min(worstOverlap, entityPairOverlapDepthPx(entities[i]!, entities[j]!));
      }
    }

    return {
      gravity: this.gravity,
      bounds: this.bounds,
      walls: arenaAWallRects(),
      steps: this.stepIndex,
      timeMs: this.timeMs,
      shotsFired: this.shots,
      hits: this.hits,
      lastDamage: this.damage,
      entities,
      projectiles,
      minPairDistancePx: Number.isFinite(minPair) ? minPair : 0,
      worstEntityOverlapDepthPx: worstOverlap,
    };
  }

  /** 某实体的当前 HP（按 entityId；未知 id 抛错，不静默返回 0）。 */
  hpOf(entityId: string): number {
    const a = this.agents.find((x) => x.entity.entityId === entityId);
    if (!a) throw new Error(`ArenaARuntime: 未知实体 "${entityId}"`);
    return a.vehicle.hp;
  }

  /** 某实体的当前世界坐标（按 entityId）。 */
  positionOf(entityId: string): { x: number; y: number } {
    const a = this.agents.find((x) => x.entity.entityId === entityId);
    if (!a) throw new Error(`ArenaARuntime: 未知实体 "${entityId}"`);
    return this.world.getPosition(a.vehicle.body);
  }

  /** 任一对敌对实体之间的距离（评估接敌过程用）。 */
  distanceBetween(idA: string, idB: string): number {
    const a = this.positionOf(idA);
    const b = this.positionOf(idB);
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  /** 释放（丢弃 world / 车辆 / 行为引用；无平台资源）。 */
  dispose(): void {
    this.world.setBatchedContactListener(null);
    this.behaviors.length = 0;
  }
}
