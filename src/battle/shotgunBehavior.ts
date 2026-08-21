/**
 * Shotgun Behavior（Q13-B）：近距离扇形爆发 Weapon，与普通炮（单发稳定弹道）形成
 * 完全不同的远程选择。
 *
 * 语义（与项目基线一致）：
 * - 每次开火同时生成 5 发真实 projectile，固定扇形方向 -12°/-6°/0°/+6°/+12°
 *   （相对炮口基准方向，由 part 当前世界姿态 + vehicle.facing 推出；风扇角度固定，
 *   首版必须可复现，不做随机散布 / 不自动瞄准 / 不做扇形 raycast）；
 * - 5 发全部复用现有真实 Projectile / CCD / Owner Filter 链（spawnWeaponProjectile，
 *   与 Cannon 同一条引擎链路，不创建第二套 Projectile 系统）；每发独立 carry OwnerTag
 *   （kind='projectile' + partId 'part:<hardpoint>'）→ 都走 ContactRouter 正式
 *   projectileDamage 结算（同一 projectile 仍只走正式伤害链）；
 * - 射程自然通过较低 muzzleSpeed 形成（不做距离判定后消失伤害）：近距离 5 发聚拢
 *   → 多弹命中；远处自然散开 → 部分 / 全部 Miss（扇形角 + 重力同时作用）；
 * - 发射瞬间使用「一次」明显炮口爆闪 + 真实后坐：5 发齐射只发一次 weaponFire 事件
 *   （驱动一次 muzzle flash），recoil 只 apply 一次（沿基准炮口反方向直接作用于本车
 *   chassis 真实炮口世界点，产生力矩 → 整车明显后顿；禁止 setLinearVelocity / 固定
 *   knockback）。
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

/** Shotgun behaviorParams 提取结果（数值来自 Content，本模块只读） */
export interface ShotgunParams {
  cooldownMs: number;
  muzzleSpeed: number;
  projectileDamage: number;
  projectileRadius: number;
  projectileMass: number;
  recoilImpulse: number;
  /** 固定扇形角度（度，相对炮口基准方向）；首版固定 5 发 -12/-6/0/+6/+12，可复现 */
  fanAnglesDeg: number[];
}

/** 本地向量旋转（px；与 planckVehicleAssembly.rotateLocal 同语义） */
function rotateLocal(p: { x: number; y: number }, angle: number): { x: number; y: number } {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos };
}

/** 校验 + 提取 behaviorParams（缺参数/非有限数 → 明确报错；不做静默默认值、不改参数） */
function readShotgunParams(part: PlanckPartRuntime): ShotgunParams {
  const bp = part.def.behaviorParams ?? {};
  const num = (v: unknown, name: string): number => {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new Error(`ShotgunBehavior: behaviorParams.${name} 必须是有限数值`);
    }
    return v;
  };
  const fanRaw = (bp.fanAnglesDeg ?? []) as unknown;
  if (
    !Array.isArray(fanRaw) ||
    fanRaw.length === 0 ||
    !fanRaw.every((x) => typeof x === 'number' && Number.isFinite(x))
  ) {
    throw new Error('ShotgunBehavior: behaviorParams.fanAnglesDeg 必须是非空有限数字数组');
  }
  return {
    cooldownMs: num(bp.cooldownMs, 'cooldownMs'),
    muzzleSpeed: num(bp.muzzleSpeed, 'muzzleSpeed'),
    projectileDamage: num(bp.projectileDamage, 'projectileDamage'),
    projectileRadius: num(bp.projectileRadius, 'projectileRadius'),
    projectileMass: num(bp.projectileMass, 'projectileMass'),
    recoilImpulse: num(bp.recoilImpulse, 'recoilImpulse'),
    fanAnglesDeg: fanRaw as number[],
  };
}

/**
 * Shotgun Behavior（每 shotgun part 一个实例，独立冷却）。
 * stepFixed 在 Orchestrator 的 onBeforeStep 每固定物理步调用一次。
 */
export class ShotgunBehavior {
  private readonly params: ShotgunParams;
  /** 剩余冷却固定步数：0 = 就绪 */
  private cooldownStepsRemaining = 0;
  /** 本实例创建且仍存活的 projectile 实例（命中/越界后移除） */
  private readonly projectiles = new Set<BodyHandle>();
  /**
   * W1-EV-1：真正创建 projectile 后的开火回调（timestamp 由 Orchestrator 补）。
   * 每齐射只调用一次（一次明显炮口爆闪驱动）。
   */
  private readonly onFire?: (ev: Omit<WeaponFireEvent, 'timestamp'>) => void;

  constructor(
    part: PlanckPartRuntime,
    onFire?: (ev: Omit<WeaponFireEvent, 'timestamp'>) => void,
  ) {
    this.params = readShotgunParams(part);
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

  /** 本齐射的弹数（= 固定扇形角度数，首版 = 5） */
  get pelletCount(): number {
    return this.params.fanAnglesDeg.length;
  }

  /**
   * 消费 ContactRouter 的 projectile 接触事实（命中/撞墙 → 真实销毁；伤害已由 Router 结算）。
   * 与 Cannon 同语义：只处理本实例创建的、仍存活的 projectile。
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
      throw new Error('ShotgunBehavior: 不是本实例追踪的 projectile，拒绝销毁');
    }
    world.destroyBody(handle);
    this.projectiles.delete(handle);
  }

  /**
   * 每个固定物理步调用一次（Orchestrator onBeforeStep 内）。
   * - 冷却中：递减剩余步数，不发射；
   * - 就绪（初始或冷却结束）：发射齐射 + 一次 recoil + 一次 weaponFire，重置冷却。
   */
  stepFixed(
    world: PlanckWorld,
    vehicle: PlanckVehicle,
    part: PlanckPartRuntime,
  ): void {
    if (this.cooldownStepsRemaining > 0) {
      this.cooldownStepsRemaining--;
      if (this.cooldownStepsRemaining > 0) return;
    }
    // 冷却结束（或初始就绪）→ 发射齐射
    this.fire(world, vehicle, part);
    this.cooldownStepsRemaining = Math.max(
      1,
      Math.ceil(this.params.cooldownMs / FIXED_DT_MS - 1e-9),
    );
  }

  private fire(
    world: PlanckWorld,
    vehicle: PlanckVehicle,
    part: PlanckPartRuntime,
  ): void {
    const p = this.params;
    const partAngle = world.getAngle(part.body);

    // 基准炮口方向：part 本地发射轴（= facing）随 part 当前世界姿态旋转
    // （固定方向，不自动瞄准 / 不跟踪目标）
    const baseDir = rotateLocal({ x: vehicle.facing, y: 0 }, partAngle);

    // 一次齐射：固定扇形 5 发，全部复用现有真实 Projectile 链路
    let muzzlePoint: { x: number; y: number } | null = null;
    for (const deg of p.fanAnglesDeg) {
      const a = (deg * Math.PI) / 180;
      // 基准方向旋转 fan 角（可复现：固定角度，无随机）
      const dir = {
        x: baseDir.x * Math.cos(a) - baseDir.y * Math.sin(a),
        y: baseDir.x * Math.sin(a) + baseDir.y * Math.cos(a),
      };
      const { proj, muzzlePoint: mp } = spawnWeaponProjectile(world, vehicle, part, {
        dir,
        muzzleSpeed: p.muzzleSpeed,
        projectileRadius: p.projectileRadius,
        projectileMass: p.projectileMass,
      });
      this.projectiles.add(proj);
      if (!muzzlePoint) muzzlePoint = mp; // 5 发同炮口（仅位置相同，方向不同）
    }
    if (!muzzlePoint) return; // 不应发生（fanAnglesDeg 非空已校验）

    // 一次明显炮口爆闪 + 真实后坐（5 发齐射只触发一次；recoil 不按发数累加）
    this.onFire?.({
      type: 'weaponFire',
      team: vehicle.team,
      partId: `part:${part.id}`,
      behavior: 'shotgun',
      worldPosition: { x: muzzlePoint.x, y: muzzlePoint.y },
      worldDirection: { x: baseDir.x, y: baseDir.y },
    });

    // Recoil：方向严格相反，作用于本车 chassis（vehicle.body）真实炮口世界点
    // （Q02-F1 applyLinearImpulse，产生力矩 → 开火瞬间整车明显后顿）；
    // 禁止 setLinearVelocity / 固定 knockback。Q13-B-R1：直接作用于 chassis（非 weld 子体），
    // 第一版允许明显过强，必须看到整车顿一下。
    world.applyLinearImpulse(
      vehicle.body,
      { x: -baseDir.x * p.recoilImpulse, y: -baseDir.y * p.recoilImpulse },
      muzzlePoint,
    );
  }
}
