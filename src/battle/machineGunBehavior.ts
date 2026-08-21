/**
 * MachineGun Behavior（Q14-A）：连发机枪 Weapon。
 *
 * 体验目标（不看伤害数字也能直接看懂）：枪口连续喷火 → 一串高速弹迹射出 →
 * 不是炮（单发稳定弹道）、不是霰弹（一次扇形爆发），而是持续压制。
 *
 * 语义（与项目基线一致）：
 * - 固定 burst 节奏（首版可复现、无随机）：
 *   - 一次 burst 7 发（6~8 区间），发间隔 100ms（≈6 固定步），
 *     burst 总持续 600ms（(7-1)×100ms，落 0.6~0.8s 区间）；
 *   - burst 后冷却 1100ms（落 1.0~1.3s 区间），循环；
 * - 每发都是真实 projectile：复用 spawnWeaponProjectile（与 Cannon / Shotgun / Laser
 *   同一条 Projectile / CCD / Owner Filter / ContactRouter 链，不创建第二套系统）；
 * - 全部沿真实炮口方向（part 当前世界姿态 × vehicle.facing），首版禁止随机散布 /
 *   不自动瞄准 / 不做 hitscan / 不 raycast；gravityScale=0 → 弹迹水平直线，
 *   正常速度下 7 发高速短弹迹连成一条「连续压制弹线」；
 * - 每发独立触发 weaponFire（小型枪口闪光）+ 真实 recoil 直接作用于本车 chassis
 *   （vehicle.body）真实炮口世界点：单发小（6）、连续 burst 后整车轻微累计后顿；
 * - 每发真实碰到才伤害（ContactRouter projectileDamage，来源 weapon part 反查）、
 *   Miss 就是 Miss；命中/撞墙由 consumeProjectileFacts 真实销毁。
 */
import type { BodyHandle, PlanckWorld } from '../physics/planckWorld';
import { PHYSICS_HZ } from '../physics/units';
import {
  type PlanckPartRuntime,
  type PlanckVehicle,
} from './planckVehicleAssembly';
import type { ProjectileContactFact } from './contactRouter';
import type { WeaponFireEvent } from './combatEvents';
import { spawnWeaponProjectile } from './weaponProjectile';

/** 固定物理步长（ms）：与 PlanckWorld.FIXED_STEP_MS 数值一致 */
const FIXED_DT_MS = 1000 / PHYSICS_HZ;

/** MachineGun behaviorParams 提取结果（数值来自 Content，本模块只读） */
export interface MachineGunParams {
  /** 一次 burst 的发数（首版 7，区间 6~8） */
  burstRounds: number;
  /** 发间隔（ms；首版 100，区间 90~120） */
  roundIntervalMs: number;
  /** burst 后冷却（ms；首版 1100，区间 1000~1300） */
  cooldownMs: number;
  muzzleSpeed: number;
  projectileDamage: number;
  projectileRadius: number;
  projectileMass: number;
  /** 单发后坐冲量（小；连续 burst 累计成轻微后顿） */
  recoilImpulse: number;
}

/** 本地向量旋转（px；与 planckVehicleAssembly.rotateLocal 同语义） */
function rotateLocal(p: { x: number; y: number }, angle: number): { x: number; y: number } {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos };
}

/** 校验 + 提取 behaviorParams（缺参数/非有限数 → 明确报错；不做静默默认值、不改参数） */
function readMachineGunParams(part: PlanckPartRuntime): MachineGunParams {
  const bp = part.def.behaviorParams ?? {};
  const num = (v: unknown, name: string): number => {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new Error(`MachineGunBehavior: behaviorParams.${name} 必须是有限数值`);
    }
    return v;
  };
  return {
    burstRounds: num(bp.burstRounds, 'burstRounds'),
    roundIntervalMs: num(bp.roundIntervalMs, 'roundIntervalMs'),
    cooldownMs: num(bp.cooldownMs, 'cooldownMs'),
    muzzleSpeed: num(bp.muzzleSpeed, 'muzzleSpeed'),
    projectileDamage: num(bp.projectileDamage, 'projectileDamage'),
    projectileRadius: num(bp.projectileRadius, 'projectileRadius'),
    projectileMass: num(bp.projectileMass, 'projectileMass'),
    recoilImpulse: num(bp.recoilImpulse, 'recoilImpulse'),
  };
}

/**
 * MachineGun Behavior（每 machineGun part 一个实例，独立冷却与 burst 计数）。
 * stepFixed 在 Orchestrator 的 onBeforeStep 每个固定物理步调用一次。
 *
 * 状态机（固定步，60Hz）：
 * - cooldown 中：递减剩余步数，不发；
 * - 发间隔中：递减剩余步数，不发；
 * - 就绪：发 1 发真实 projectile（+ 小型闪光 + 单发 recoil）；
 *   发满 burstRounds → 进入 cooldown；否则进入下一发间隔。
 */
export class MachineGunBehavior {
  private readonly params: MachineGunParams;
  /** 剩余冷却固定步数：0 = 不在冷却 */
  private cooldownStepsRemaining = 0;
  /** 当前 burst 已发弹数（跨 burst 复用，发满归零） */
  private roundsFired = 0;
  /** 剩余发间隔固定步数：0 = 可发下一发 */
  private roundGapStepsRemaining = 0;
  /** 本实例创建且仍存活的 projectile 实例（命中/越界后移除） */
  private readonly projectiles = new Set<BodyHandle>();
  /**
   * 真正创建 projectile 后的开火回调（timestamp 由 Orchestrator 补）。
   * 每发一次 → 每发独立小型枪口闪光。
   */
  private readonly onFire?: (ev: Omit<WeaponFireEvent, 'timestamp'>) => void;

  constructor(
    part: PlanckPartRuntime,
    onFire?: (ev: Omit<WeaponFireEvent, 'timestamp'>) => void,
  ) {
    this.params = readMachineGunParams(part);
    this.onFire = onFire;
  }

  /** 剩余冷却固定步数（只读，供测试/调试） */
  get cooldownRemaining(): number {
    return this.cooldownStepsRemaining;
  }

  /** 当前 burst 已发弹数（只读，供测试/调试） */
  get roundsFiredSoFar(): number {
    return this.roundsFired;
  }

  /** 剩余发间隔固定步数（只读，供测试/调试） */
  get roundGapRemaining(): number {
    return this.roundGapStepsRemaining;
  }

  /** 一次 burst 的发数（= 配置值；供测试/调试） */
  get burstRounds(): number {
    return this.params.burstRounds;
  }

  /** 仍存活的 projectile 实例（快照数组；供 Orchestrator 越界检查 / 测试） */
  get aliveProjectiles(): readonly BodyHandle[] {
    return [...this.projectiles];
  }

  /**
   * 消费 ContactRouter 的 projectile 接触事实（命中/撞墙 → 真实销毁；伤害已由 Router 结算）。
   * 与 Cannon / Shotgun 同语义：只处理本实例创建的、仍存活的 projectile。
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

  /** 销毁由本实例创建且仍存活的 projectile（越界销毁用），并从追踪集合移除 */
  destroyProjectile(world: PlanckWorld, handle: BodyHandle): void {
    if (!this.projectiles.has(handle)) {
      throw new Error('MachineGunBehavior: 不是本实例追踪的 projectile，拒绝销毁');
    }
    world.destroyBody(handle);
    this.projectiles.delete(handle);
  }

  /**
   * 每个固定物理步调用一次（Orchestrator onBeforeStep 内）。
   * - 冷却中：递减剩余步数，不发射；
   * - 发间隔中：递减剩余步数，不发射；
   * - 就绪：发 1 发 → 发满进入冷却，否则进入发间隔。
   */
  stepFixed(world: PlanckWorld, vehicle: PlanckVehicle, part: PlanckPartRuntime): void {
    if (this.cooldownStepsRemaining > 0) {
      this.cooldownStepsRemaining--;
      if (this.cooldownStepsRemaining > 0) return;
    }
    if (this.roundGapStepsRemaining > 0) {
      this.roundGapStepsRemaining--;
      if (this.roundGapStepsRemaining > 0) return;
    }
    // 就绪 → 发 1 发真实 projectile
    this.fire(world, vehicle, part);
    this.roundsFired++;
    if (this.roundsFired >= this.params.burstRounds) {
      // burst 完成 → 冷却
      this.roundsFired = 0;
      this.cooldownStepsRemaining = Math.max(
        1,
        Math.ceil(this.params.cooldownMs / FIXED_DT_MS - 1e-9),
      );
    } else {
      // 下一发间隔
      this.roundGapStepsRemaining = Math.max(
        1,
        Math.ceil(this.params.roundIntervalMs / FIXED_DT_MS - 1e-9),
      );
    }
  }

  private fire(
    world: PlanckWorld,
    vehicle: PlanckVehicle,
    part: PlanckPartRuntime,
  ): void {
    const p = this.params;
    const partAngle = world.getAngle(part.body);

    // 真实炮口方向：part 本地发射轴（= facing）随 part 当前世界姿态旋转
    // （固定方向，每发重算 → 后坐导致的姿态变化自然影响后续弹道；不自动瞄准）
    const baseDir = rotateLocal({ x: vehicle.facing, y: 0 }, partAngle);

    // 每发一个真实 projectile：复用正式 Projectile / CCD / Owner Filter 链。
    // gravityScale=0 → 水平直线高速弹迹（连续压制弹线）；不创建第二套 Projectile 系统。
    const { proj, muzzlePoint } = spawnWeaponProjectile(world, vehicle, part, {
      dir: baseDir,
      muzzleSpeed: p.muzzleSpeed,
      projectileRadius: p.projectileRadius,
      projectileMass: p.projectileMass,
      gravityScale: 0,
    });
    this.projectiles.add(proj);

    // 每发独立小型枪口闪光（VFX/SFX 消费；纯表现，不参与伤害）
    this.onFire?.({
      type: 'weaponFire',
      team: vehicle.team,
      partId: `part:${part.id}`,
      behavior: 'machineGun',
      worldPosition: { x: muzzlePoint.x, y: muzzlePoint.y },
      worldDirection: { x: baseDir.x, y: baseDir.y },
    });

    // 每发真实 recoil：方向严格相反，直接作用于本车 chassis（vehicle.body）真实炮口
    // 世界点（applyLinearImpulse，产生轻微力矩）；单发小、连续 burst 后整车轻微累计
    // 后顿。禁止 setLinearVelocity / 固定 knockback / 屏幕震动表现后坐。
    world.applyLinearImpulse(
      vehicle.body,
      { x: -baseDir.x * p.recoilImpulse, y: -baseDir.y * p.recoilImpulse },
      muzzlePoint,
    );
  }
}
