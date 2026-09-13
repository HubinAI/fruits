/**
 * Cannon Behavior（Queue Q02-C1A）：固定冷却真实发射 Projectile + 真实 Recoil。
 *
 * 语义（与项目基线一致）：
 * - 初始就绪：首个固定步可发射；按 behaviorParams.cooldownMs 换算固定步计时（FIXED_DT）；
 * - 炮口方向 = cannon part 当前世界姿态 + vehicle.facing（facing 为镜像而非旋转，
 *   轮子始终朝下；A=facing+1 朝 +X、B=facing-1 朝 -X）；
 * - projectile 从真实炮口外缘生成：dynamic circle，真实 mass/radius，bullet=true（原生 CCD）；
 * - OwnerTag：kind='projectile' + shooter team + cannon partId（'part:<hardpoint>'，
 *   供 ContactRouter 反查来源 weapon part 结算 projectileDamage）；
 * - 初速度 = 当前射手（part body 线速度） + 炮口方向 × muzzleSpeed；
 * - 碰撞过滤：不碰同队（同负 group + mask 不含己方类别），可碰敌车 / arena / ground / hazard；
 * - Recoil：Q02-F1 applyLinearImpulse 于真实炮口世界点，方向严格相反，
 *   由 Weld 自然传给整车；禁止 setLinearVelocity / 固定 knockback 模拟。
 *
 * 本队列不处理命中 / 撞墙 / 越界销毁（留待后续队列）。
 *
 * ---------------------------------------------------------------------------
 * PRP-F2-R1｜最小可复用 Burst 能力（可选参数，**默认值 = 旧行为**）
 *
 * 背景：PRP 的「双联炮」需要「一次攻击 → 极短时间连续打出两发真实炮弹」。
 * 此前 PRP 侧只能借用 `shotgun` 的 `fanAnglesDeg` 做**同时**齐射，两发弹丸轨迹重叠、
 * 真人无法感知「连续两发」。本 Queue 授权给 Cannon 补一个**最小**的可选连发能力。
 *
 * 语义（对既有调用方零影响）：
 *   - `burstRounds`      一次攻击的弹数，默认 **1**（= 既有「冷却 → 单发 → 重置冷却」）；
 *   - `burstIntervalMs`  连发的发间隔（ms），默认 **0**；仅 `burstRounds > 1` 时有意义；
 *   - 两个参数都是**可选**：正式 `content.ts` 的 Cannon 定义不写它们 → 走默认值，
 *     逐帧行为与加此能力之前**完全一致**（正式武器平衡零变化）。
 *   - 连发中每一发都走**同一条** `fire()`：真实 projectile / 真实碰撞 / 真实伤害 /
 *     真实 recoil / 真实生命周期（不创建第二套系统、不做视觉假弹）。
 *   - 冷却语义不变：**最后一发**打完后才开始 `cooldownMs` 计时。
 */
import type {
  BodyHandle,
  PlanckCollisionFilter,
  PlanckWorld,
} from '../physics/planckWorld';
import { PHYSICS_HZ } from '../physics/units';
import {
  PlanckCategory,
  type PlanckPartRuntime,
  type PlanckVehicle,
} from './planckVehicleAssembly';
import type { ProjectileContactFact } from './contactRouter';
import type { WeaponFireEvent } from './combatEvents';

/** 固定物理步长（ms）：与 PlanckWorld.FIXED_STEP_MS 数值一致 */
const FIXED_DT_MS = 1000 / PHYSICS_HZ;

/** Cannon behaviorParams 提取结果（类型化；数值来自 Content，本模块只读） */
export interface CannonParams {
  cooldownMs: number;
  muzzleSpeed: number;
  projectileDamage: number;
  projectileRadius: number;
  projectileMass: number;
  recoilImpulse: number;
  /**
   * PRP-F2-R1 可选：一次攻击的弹数（默认 1 = 既有单发行为）。
   * 正式 content.ts 不写此字段 → 默认值，行为与旧版一致。
   */
  burstRounds: number;
  /**
   * PRP-F2-R1 可选：连发的发间隔（ms，默认 0）。
   * 仅 `burstRounds > 1` 时有意义；正式 content.ts 不写此字段。
   */
  burstIntervalMs: number;
}

/** 一次发射的结果（供测试/后续队列消费；未发射时 projectile/spawn 为 null） */
export interface CannonFireResult {
  fired: boolean;
  projectile: BodyHandle | null;
  muzzlePoint: { x: number; y: number } | null;
  muzzleDir: { x: number; y: number } | null;
  /** projectile 实际创建参数（radius/mass/bullet/velocity，velocity=初速度） */
  spawn: {
    radius: number;
    mass: number;
    bullet: boolean;
    velocity: { x: number; y: number };
  } | null;
}

/** 本地向量旋转（px；与 planckVehicleAssembly.rotateLocal 同语义） */
function rotateLocal(p: { x: number; y: number }, angle: number): { x: number; y: number } {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos };
}

/** 「本固定步未发射」的统一返回（每次新建，避免调用方误改共享对象）。 */
function noFire(): CannonFireResult {
  return { fired: false, projectile: null, muzzlePoint: null, muzzleDir: null, spawn: null };
}

/**
 * 校验 + 提取 behaviorParams。
 *
 * - **6 个基准参数**（cooldown/muzzleSpeed/damage/radius/mass/recoil）：缺参数或非有限数 →
 *   明确报错（不做静默默认值、不改参数）——与加 burst 之前完全一致；
 * - **2 个 burst 参数**（PRP-F2-R1）：`burstRounds` / `burstIntervalMs` 是**可选**的，
 *   缺失/非法 → 取默认值（`1` / `0`）。**必须可选**：正式 `content.ts` 的 Cannon 定义不写它们，
 *   若强制要求就会逼着改正式配置 = 违反「不改变现有正式武器平衡」。
 */
function readCannonParams(part: PlanckPartRuntime): CannonParams {
  const bp = part.def.behaviorParams ?? {};
  const num = (v: unknown, name: string): number => {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new Error(`CannonBehavior: behaviorParams.${name} 必须是有限数值`);
    }
    return v;
  };
  /** 可选数值：缺失 / 非有限数 → 默认值（不抛错）。 */
  const optNum = (v: unknown, dflt: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : dflt;
  return {
    cooldownMs: num(bp.cooldownMs, 'cooldownMs'),
    muzzleSpeed: num(bp.muzzleSpeed, 'muzzleSpeed'),
    projectileDamage: num(bp.projectileDamage, 'projectileDamage'),
    projectileRadius: num(bp.projectileRadius, 'projectileRadius'),
    projectileMass: num(bp.projectileMass, 'projectileMass'),
    recoilImpulse: num(bp.recoilImpulse, 'recoilImpulse'),
    // 至少 1 发（0 / 负数 / 小数都被规范化）；缺省 1 = 既有单发行为。
    burstRounds: Math.max(1, Math.floor(optNum(bp.burstRounds, 1))),
    // 间隔非负；缺省 0（只有 burstRounds > 1 时才会被用到）。
    burstIntervalMs: Math.max(0, optNum(bp.burstIntervalMs, 0)),
  };
}

/**
 * Cannon Behavior（每 cannon part 一个实例，独立冷却）。
 * stepFixed 在 Orchestrator 的 onBeforeStep 插入口每个固定物理步调用一次。
 */
export class CannonBehavior {
  private readonly params: CannonParams;
  /** 剩余冷却固定步数：0 = 就绪 */
  private cooldownStepsRemaining = 0;
  /**
   * PRP-F2-R1：本次攻击（burst）已发弹数（跨攻击复用，打满归零）。
   * 默认 `burstRounds = 1` 时：每发即打满 → 该字段恒为 0，状态与加 burst 之前完全一致。
   */
  private roundsFired = 0;
  /** PRP-F2-R1：剩余连发间隔固定步数：0 = 无待发连发。 */
  private burstGapStepsRemaining = 0;
  /** 本实例创建且仍存活的 projectile 实例（Q02-C1B：命中/越界后移除） */
  private readonly projectiles = new Set<BodyHandle>();
  /**
   * W1-EV-1：真正创建 projectile 后的开火回调（timestamp 由 Orchestrator 补，
   * 因为本模块无战斗时间概念）。Hammer/Push 不设置此回调（不凑假 fire）。
   */
  private readonly onFire?: (ev: Omit<WeaponFireEvent, 'timestamp'>) => void;

  constructor(
    part: PlanckPartRuntime,
    onFire?: (ev: Omit<WeaponFireEvent, 'timestamp'>) => void,
  ) {
    this.params = readCannonParams(part);
    this.onFire = onFire;
  }

  /** 剩余冷却固定步数（只读，供测试/调试） */
  get cooldownRemaining(): number {
    return this.cooldownStepsRemaining;
  }

  /** 一次攻击的弹数（= 配置值；默认 1；只读，供测试/调试） */
  get burstRounds(): number {
    return this.params.burstRounds;
  }

  /** 连发的发间隔 ms（= 配置值；默认 0；只读，供测试/调试） */
  get burstIntervalMs(): number {
    return this.params.burstIntervalMs;
  }

  /** 当前攻击已发弹数（只读，供测试/调试） */
  get roundsFiredSoFar(): number {
    return this.roundsFired;
  }

  /** 剩余连发间隔固定步数（只读，供测试/调试） */
  get burstGapRemaining(): number {
    return this.burstGapStepsRemaining;
  }

  /** 仍存活的 projectile 实例（快照数组；供 Orchestrator 越界检查 / 测试） */
  get aliveProjectiles(): readonly BodyHandle[] {
    return [...this.projectiles];
  }

  /**
   * 消费 ContactRouter 的 projectile 接触事实（Q02-C1B，Orchestrator 每帧 drain 一次后调用）：
   * - 只处理本实例创建的、仍存活的 projectile；
   * - 任一真实 begin fact（hostile vehicle / arena / ground / hazard）→ destroyBody（真实销毁）；
   * - 同一 projectile 同一批次多个 fact 只销毁一次（fact 循环内引用去重）；
   * - 销毁后从本实例追踪集合移除；
   * - 不在本方法内结算伤害（伤害已由 ContactRouter 统一完成）。
   */
  consumeProjectileFacts(world: PlanckWorld, facts: readonly ProjectileContactFact[]): void {
    const destroyed = new Set<BodyHandle>();
    for (const fact of facts) {
      for (const own of this.projectiles) {
        if (own === fact.projectileBody && !destroyed.has(own)) {
          world.destroyBody(own);
          destroyed.add(own);
          this.projectiles.delete(own);
          break;
        }
      }
    }
  }

  /**
   * 销毁由本实例创建且仍存活的 projectile（Q02-C1B，越界销毁用），并从追踪集合移除。
   * 非本实例的 handle → 明确报错（防误用）。
   */
  destroyProjectile(world: PlanckWorld, handle: BodyHandle): void {
    if (!this.projectiles.has(handle)) {
      throw new Error('CannonBehavior: 不是本实例追踪的 projectile，拒绝销毁');
    }
    world.destroyBody(handle);
    this.projectiles.delete(handle);
  }

  /**
   * 每个固定物理步调用一次（Orchestrator onBeforeStep 内）。
   * - 连发间隔中：递减剩余步数，不发射；
   * - 冷却中：递减剩余步数，不发射；
   * - 就绪（初始 / 冷却结束 / 连发到点）：发射 projectile + recoil 并推进攻击状态机。
   *
   * 默认 `burstRounds = 1` 时与既有行为**逐帧一致**：`burstGap` 恒为 0 → 只走「冷却 → 单发」。
   */
  stepFixed(
    world: PlanckWorld,
    vehicle: PlanckVehicle,
    part: PlanckPartRuntime,
  ): CannonFireResult {
    // PRP-F2-R1：连发序列优先。「冷却只在最后一发之后开始计时」——
    // 因此连发期间**不并行递减冷却**，保证「一次攻击 = 一个整体」。
    if (this.burstGapStepsRemaining > 0) {
      this.burstGapStepsRemaining--;
      if (this.burstGapStepsRemaining > 0) return noFire();
      return this.emitRound(world, vehicle, part);
    }
    if (this.cooldownStepsRemaining > 0) {
      this.cooldownStepsRemaining--;
      if (this.cooldownStepsRemaining > 0) {
        return noFire();
      }
    }
    // 冷却结束（或初始就绪）→ 发起一次攻击的第 1 发
    return this.emitRound(world, vehicle, part);
  }

  /**
   * 打出「当前这次攻击的一发」，并推进攻击状态机：
   * - 打满 `burstRounds` → 进入 `cooldownMs` 冷却（并清零计数）；
   * - 未打满 → 进入 `burstIntervalMs` 连发间隔。
   *
   * 每发都调用同一个 `fire()` → 真实 projectile / 碰撞 / 伤害 / recoil / 生命周期。
   */
  private emitRound(
    world: PlanckWorld,
    vehicle: PlanckVehicle,
    part: PlanckPartRuntime,
  ): CannonFireResult {
    const result = this.fire(world, vehicle, part);
    this.roundsFired++;
    if (this.roundsFired >= this.params.burstRounds) {
      this.roundsFired = 0;
      // 冷却固定步数 = ceil(cooldownMs / FIXED_DT_MS)（-1e-9 消除浮点边界误差）
      this.cooldownStepsRemaining = Math.max(
        1,
        Math.ceil(this.params.cooldownMs / FIXED_DT_MS - 1e-9),
      );
    } else {
      // 连发间隔（至少 1 步，避免同一步内连打两发）
      this.burstGapStepsRemaining = Math.max(
        1,
        Math.ceil(this.params.burstIntervalMs / FIXED_DT_MS - 1e-9),
      );
    }
    return result;
  }

  private fire(
    world: PlanckWorld,
    vehicle: PlanckVehicle,
    part: PlanckPartRuntime,
  ): CannonFireResult {
    const p = this.params;
    const partPos = world.getPosition(part.body);
    const partAngle = world.getAngle(part.body);

    // 炮口方向：part 本地发射轴（= facing）随 part 世界姿态旋转
    const muzzleDir = rotateLocal({ x: vehicle.facing, y: 0 }, partAngle);

    // 炮口外缘（part 本地坐标）：collider 沿发射轴方向的最远点。
    // 用原始 def（facing 已由装配镜像）——A: +（ox + w/2），B: -（ox + w/2）
    const c = part.def.collider;
    const halfW = (c.width ?? 0) / 2;
    const muzzleLocal = {
      x: vehicle.facing * ((c.offset?.x ?? 0) + halfW),
      y: c.offset?.y ?? 0,
    };
    const muzzlePoint = {
      x: partPos.x + rotateLocal(muzzleLocal, partAngle).x,
      y: partPos.y + rotateLocal(muzzleLocal, partAngle).y,
    };

    // 初速度 = 当前射手（part body）线速度 + 炮口方向 × muzzleSpeed
    const shooterVel = world.getLinearVelocity(part.body);
    const velocity = {
      x: shooterVel.x + muzzleDir.x * p.muzzleSpeed,
      y: shooterVel.y + muzzleDir.y * p.muzzleSpeed,
    };

    // 碰撞过滤：不碰同队（同负 group + mask 不含己方类别），可碰敌车 / arena / ground / hazard
    const enemyCat =
      vehicle.team === 'A' ? PlanckCategory.VEHICLE_B : PlanckCategory.VEHICLE_A;
    const filter: PlanckCollisionFilter = {
      categoryBits: PlanckCategory.PROJECTILE,
      maskBits:
        PlanckCategory.GROUND |
        PlanckCategory.ARENA |
        PlanckCategory.HAZARD |
        enemyCat,
      groupIndex: vehicle.team === 'A' ? -1 : -2,
    };

    // Projectile：真实 dynamic circle，真实 mass/radius，bullet=true（原生 CCD）
    const proj = world.createDynamicCircle(
      muzzlePoint.x,
      muzzlePoint.y,
      p.projectileRadius,
      p.projectileMass,
      { bullet: true, collisionFilter: filter },
    );
    world.setOwnerTag(proj, {
      kind: 'projectile',
      vehicleId: vehicle.id,
      partId: `part:${part.id}`,
      team: vehicle.team,
    });
    world.setLinearVelocity(proj, velocity.x, velocity.y);
    // 本实例追踪（Q02-C1B：后续命中/越界销毁、销毁后移除）
    this.projectiles.add(proj);

    // W1-EV-1：真正创建 projectile 成功 → 开火事件（VFX/SFX 消费；Hammer/Push 不触发）
    this.onFire?.({
      type: 'weaponFire',
      team: vehicle.team,
      partId: `part:${part.id}`,
      behavior: 'cannon',
      worldPosition: { x: muzzlePoint.x, y: muzzlePoint.y },
      worldDirection: { x: muzzleDir.x, y: muzzleDir.y },
    });

    // Recoil：方向严格相反，作用于真实炮口世界点（Q02-F1 applyLinearImpulse），
    // 由 Weld 自然传给整车；禁止 setLinearVelocity / 固定 knockback。
    world.applyLinearImpulse(
      part.body,
      { x: -muzzleDir.x * p.recoilImpulse, y: -muzzleDir.y * p.recoilImpulse },
      muzzlePoint,
    );

    return {
      fired: true,
      projectile: proj,
      muzzlePoint,
      muzzleDir,
      spawn: {
        radius: p.projectileRadius,
        mass: p.projectileMass,
        bullet: true,
        velocity,
      },
    };
  }
}
