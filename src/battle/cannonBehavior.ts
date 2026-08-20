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

/** 校验 + 提取 behaviorParams（缺参数/非有限数 → 明确报错；不做静默默认值、不改参数） */
function readCannonParams(part: PlanckPartRuntime): CannonParams {
  const bp = part.def.behaviorParams ?? {};
  const num = (v: unknown, name: string): number => {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new Error(`CannonBehavior: behaviorParams.${name} 必须是有限数值`);
    }
    return v;
  };
  return {
    cooldownMs: num(bp.cooldownMs, 'cooldownMs'),
    muzzleSpeed: num(bp.muzzleSpeed, 'muzzleSpeed'),
    projectileDamage: num(bp.projectileDamage, 'projectileDamage'),
    projectileRadius: num(bp.projectileRadius, 'projectileRadius'),
    projectileMass: num(bp.projectileMass, 'projectileMass'),
    recoilImpulse: num(bp.recoilImpulse, 'recoilImpulse'),
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
   * - 冷却中：递减剩余步数，不发射；
   * - 就绪（初始或冷却结束）：发射 projectile + recoil，重置冷却。
   */
  stepFixed(
    world: PlanckWorld,
    vehicle: PlanckVehicle,
    part: PlanckPartRuntime,
  ): CannonFireResult {
    if (this.cooldownStepsRemaining > 0) {
      this.cooldownStepsRemaining--;
      if (this.cooldownStepsRemaining > 0) {
        return { fired: false, projectile: null, muzzlePoint: null, muzzleDir: null, spawn: null };
      }
    }
    // 冷却结束（或初始就绪）→ 发射
    const result = this.fire(world, vehicle, part);
    // 冷却固定步数 = ceil(cooldownMs / FIXED_DT_MS)（-1e-9 消除浮点边界误差）
    this.cooldownStepsRemaining = Math.max(
      1,
      Math.ceil(this.params.cooldownMs / FIXED_DT_MS - 1e-9),
    );
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
