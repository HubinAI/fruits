/**
 * Laser Behavior（Q11-C）：蓄能镭射——长前摇 → 高威胁射击 → 强后坐。
 *
 * 语义：
 * - 冷却结束后进入蓄能（chargeMs，默认 1500ms）：每固定步发 weaponCharge 事件
 *   （progress 0→1），蓄能方向固定 = part 当前世界姿态 + vehicle.facing
 *   （不跟踪目标 / 不自动瞄准）；蓄能结束真正发射。
 * - 发射完全复用 Cannon 的真实 Projectile / CCD 链路（dynamic circle +
 *   bullet=true 原生 CCD + OwnerTag + ContactRouter 结算 projectileDamage），
 *   不创建第二套 Projectile 系统、不命中修正、不直接 HP damage；
 * - 初版差异故意做大：muzzleSpeed / projectileDamage / recoilImpulse 均为
 *   Cannon 约 2×（后续真人验收再回收）；
 * - Recoil：applyLinearImpulse 于真实炮口世界点，方向严格相反。
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
import type { WeaponChargeEvent, WeaponFireEvent } from './combatEvents';

/** 固定物理步长（ms）：与 PlanckWorld.FIXED_STEP_MS 数值一致 */
const FIXED_DT_MS = 1000 / PHYSICS_HZ;

/** Laser behaviorParams 提取结果（数值来自 Content，本模块只读） */
export interface LaserParams {
  chargeMs: number;
  muzzleSpeed: number;
  projectileDamage: number;
  projectileRadius: number;
  projectileMass: number;
  recoilImpulse: number;
  cooldownMs: number;
}

/** 本地向量旋转（与 planckVehicleAssembly.rotateLocal 同语义） */
function rotateLocal(p: { x: number; y: number }, angle: number): { x: number; y: number } {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos };
}

/** 校验 + 提取 behaviorParams（缺参数 → 明确报错，不静默默认） */
function readLaserParams(part: PlanckPartRuntime): LaserParams {
  const bp = part.def.behaviorParams ?? {};
  const num = (v: unknown, name: string): number => {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new Error(`LaserBehavior: behaviorParams.${name} 必须是有限数值`);
    }
    return v;
  };
  return {
    chargeMs: num(bp.chargeMs, 'chargeMs'),
    muzzleSpeed: num(bp.muzzleSpeed, 'muzzleSpeed'),
    projectileDamage: num(bp.projectileDamage, 'projectileDamage'),
    projectileRadius: num(bp.projectileRadius, 'projectileRadius'),
    projectileMass: num(bp.projectileMass, 'projectileMass'),
    recoilImpulse: num(bp.recoilImpulse, 'recoilImpulse'),
    cooldownMs: num(bp.cooldownMs, 'cooldownMs'),
  };
}

/**
 * Laser Behavior（每 laser part 一个实例，独立状态机）。
 * 状态：idle（冷却）→ charging（蓄能，发 weaponCharge）→ 发射 → idle。
 * stepFixed 在 Orchestrator onBeforeStep 每固定物理步调用一次。
 */
export class LaserBehavior {
  private readonly params: LaserParams;
  private cooldownStepsRemaining = 0;
  /** 蓄能剩余固定步数：>0 = charging */
  private chargeStepsRemaining = 0;
  /** 蓄能总固定步数（progress 计算用） */
  private chargeStepsTotal = 1;
  /** 蓄能光点起始位置（part 当前位置；每步刷新） */
  private chargePos: { x: number; y: number } = { x: 0, y: 0 };
  private readonly projectiles = new Set<BodyHandle>();
  private readonly onCharge?: (ev: Omit<WeaponChargeEvent, 'timestamp'>) => void;
  private readonly onFire?: (ev: Omit<WeaponFireEvent, 'timestamp'>) => void;

  constructor(
    part: PlanckPartRuntime,
    onCharge?: (ev: Omit<WeaponChargeEvent, 'timestamp'>) => void,
    onFire?: (ev: Omit<WeaponFireEvent, 'timestamp'>) => void,
  ) {
    this.params = readLaserParams(part);
    this.onCharge = onCharge;
    this.onFire = onFire;
  }

  get cooldownRemaining(): number {
    return this.cooldownStepsRemaining;
  }

  /** 蓄能剩余固定步数（0 = 未蓄能；供测试/调试） */
  get chargeRemaining(): number {
    return this.chargeStepsRemaining;
  }

  /** 当前蓄能进度 0~1（未蓄能 = 0；供测试/调试；递减前语义，末步 ≈1） */
  get chargeProgress(): number {
    if (this.chargeStepsRemaining <= 0) return 0;
    return 1 - this.chargeStepsRemaining / this.chargeStepsTotal;
  }

  get aliveProjectiles(): readonly BodyHandle[] {
    return [...this.projectiles];
  }

  /** 消费 ContactRouter 的 projectile 接触事实（命中/撞墙 → 真实销毁；伤害已由 Router 结算） */
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

  destroyProjectile(world: PlanckWorld, handle: BodyHandle): void {
    if (!this.projectiles.has(handle)) {
      throw new Error('LaserBehavior: 不是本实例追踪的 projectile，拒绝销毁');
    }
    world.destroyBody(handle);
    this.projectiles.delete(handle);
  }

  /** 每固定物理步调用一次：冷却递减 → 蓄能推进（发 charge 事件）→ 蓄能结束发射 */
  stepFixed(world: PlanckWorld, vehicle: PlanckVehicle, part: PlanckPartRuntime): void {
    // 蓄能中：推进蓄能（位置跟随 part 真实当前位置，方向固定不跟踪目标）
    if (this.chargeStepsRemaining > 0) {
      // 先取当前 progress（递减前：最后一步 = 1-1/total ≈ 0.99，不是 0）
      const progress = this.chargeStepsRemaining / this.chargeStepsTotal;
      this.chargeStepsRemaining--;
      const pos = world.getPosition(part.body);
      this.chargePos = { x: pos.x, y: pos.y };
      // 蓄能可见：每步发 progress 事件（纯表现；不参与伤害/命中）
      this.onCharge?.({
        type: 'weaponCharge',
        team: vehicle.team,
        partId: `part:${part.id}`,
        behavior: 'laser',
        worldPosition: { x: this.chargePos.x, y: this.chargePos.y },
        progress: 1 - progress,
      });
      if (this.chargeStepsRemaining <= 0) {
        // 蓄能完成 → 真正发射（真实 Projectile / CCD 链路）
        this.fire(world, vehicle, part);
        // 进入冷却
        this.cooldownStepsRemaining = Math.max(
          1,
          Math.ceil(this.params.cooldownMs / FIXED_DT_MS - 1e-9),
        );
      }
      return;
    }
    // 冷却中：递减，不发射
    if (this.cooldownStepsRemaining > 0) {
      this.cooldownStepsRemaining--;
      return;
    }
    // 就绪 → 开始蓄能（chargeMs）
    this.chargeStepsTotal = Math.max(1, Math.ceil(this.params.chargeMs / FIXED_DT_MS - 1e-9));
    this.chargeStepsRemaining = this.chargeStepsTotal;
    const pos = world.getPosition(part.body);
    this.chargePos = { x: pos.x, y: pos.y };
    this.onCharge?.({
      type: 'weaponCharge',
      team: vehicle.team,
      partId: `part:${part.id}`,
      behavior: 'laser',
      worldPosition: { x: this.chargePos.x, y: this.chargePos.y },
      progress: 0,
    });
  }

  private fire(
    world: PlanckWorld,
    vehicle: PlanckVehicle,
    part: PlanckPartRuntime,
  ): void {
    const p = this.params;
    const partPos = world.getPosition(part.body);
    const partAngle = world.getAngle(part.body);

    // 发射方向 = part 当前世界姿态 + facing（固定方向，不自动瞄准）
    const muzzleDir = rotateLocal({ x: vehicle.facing, y: 0 }, partAngle);

    // 炮口外缘：collider 沿发射轴方向的最远点（与 Cannon 同语义）
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

    const shooterVel = world.getLinearVelocity(part.body);
    const velocity = {
      x: shooterVel.x + muzzleDir.x * p.muzzleSpeed,
      y: shooterVel.y + muzzleDir.y * p.muzzleSpeed,
    };

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

    // 复用真实 Projectile / CCD 链路（dynamic circle + bullet=true 原生 CCD）
    // Q11-C-F2：gravityScale 0 → 能量弹无重力，水平炮口下直线飞行（无可见抛物线）。
    // 不特殊修改世界重力 / 不每帧强制修改 y；Cannon 与现有物理体保持原样。
    const proj = world.createDynamicCircle(
      muzzlePoint.x,
      muzzlePoint.y,
      p.projectileRadius,
      p.projectileMass,
      { bullet: true, collisionFilter: filter, gravityScale: 0 },
    );
    world.setOwnerTag(proj, {
      kind: 'projectile',
      vehicleId: vehicle.id,
      partId: `part:${part.id}`,
      team: vehicle.team,
    });
    world.setLinearVelocity(proj, velocity.x, velocity.y);
    this.projectiles.add(proj);

    this.onFire?.({
      type: 'weaponFire',
      team: vehicle.team,
      partId: `part:${part.id}`,
      behavior: 'laser',
      worldPosition: { x: muzzlePoint.x, y: muzzlePoint.y },
      worldDirection: { x: muzzleDir.x, y: muzzleDir.y },
    });

    // Q11-C-R2：强后坐直接作用于整车 chassis（vehicle.body，非 weld 子体）——
    // 方向与 muzzleDir 严格相反，作用点为真实 muzzlePoint（产生力矩）。
    // 正常速度必须看到整车瞬间后顿（不靠屏幕震动伪装）。
    world.applyLinearImpulse(
      vehicle.body,
      { x: -muzzleDir.x * p.recoilImpulse, y: -muzzleDir.y * p.recoilImpulse },
      muzzlePoint,
    );
  }
}
