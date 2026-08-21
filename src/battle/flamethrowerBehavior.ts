/**
 * Flamethrower Behavior（Q14-B）：喷火器 Weapon。
 *
 * 体验目标：喷口点燃 → 一股短距离火流持续喷向前方 → 贴近敌人才有效。
 * 身份是「持续近战火流」，不是另一把机枪。
 *
 * 语义（与项目基线一致）：
 * - 伤害载体复用真实 Projectile 链：连续生成小型**短命** projectile（gravityScale=0，
 *   水平直飞），生命周期由本 behavior 自己管理（记录出生步，超时真实 destroyBody）；
 *   不做 cone raycast / 不做隐藏距离判定扣血；
 * - 射程第一版 ≈1.1 个西瓜车身长（≈192px）：正常可读速度（muzzleSpeed 10）+ 很短
 *   生命周期（flameLifetimeMs 320 → 20 固定步）自然限定，不是低速慢飘；
 * - 喷射节奏：持续喷射 sprayMs（1000ms ≈ 60 步）→ 短冷却 cooldownMs（600ms）→ 再喷；
 *   喷口（每颗粒 weaponFire 小型闪光）、火流（火焰弹迹）、真实 projectile 同步；
 * - 确定性轻微上下分叉：spreadAnglesDeg [-6/0/+6]° 循环（可复现，禁止随机）；
 * - 视觉：Flame projectile 沿真实 velocity 画「黄白火芯 + 橙红短尾」，多颗粒连续叠成
 *   一股火流（renderer visual:'flame'，不画成小圆弹）；
 * - 每颗粒真实碰到才伤害（ContactRouter projectileDamage），超时即消散——距离不足时
 *   火流自然消失，不能隔远继续伤害；停火后粒子全部销毁，画面无残留火焰。
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

/** Flamethrower behaviorParams 提取结果（数值来自 Content，本模块只读） */
export interface FlamethrowerParams {
  /** 持续喷射时长（ms；首版 1000，区间 800~1200） */
  sprayMs: number;
  /** 喷射间短冷却（ms；首版 600，短于喷射） */
  cooldownMs: number;
  /** 颗粒生成间隔（ms；首版 33 → 每 2 固定步一颗，形成连续火流） */
  projectileIntervalMs: number;
  /** 单颗火焰寿命（ms；首版 320 → ≈20 步，射程 ≈ muzzleSpeed×寿命 ≈192px） */
  flameLifetimeMs: number;
  muzzleSpeed: number;
  projectileDamage: number;
  projectileRadius: number;
  projectileMass: number;
  /** 固定确定性分叉角度（度，相对炮口方向；-6/0/+6 循环，禁止随机） */
  spreadAnglesDeg: number[];
}

/** 本地向量旋转（px；与 planckVehicleAssembly.rotateLocal 同语义） */
function rotateLocal(p: { x: number; y: number }, angle: number): { x: number; y: number } {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos };
}

/** 校验 + 提取 behaviorParams（缺参数/非有限数 → 明确报错；不做静默默认值、不改参数） */
function readFlamethrowerParams(part: PlanckPartRuntime): FlamethrowerParams {
  const bp = part.def.behaviorParams ?? {};
  const num = (v: unknown, name: string): number => {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new Error(`FlamethrowerBehavior: behaviorParams.${name} 必须是有限数值`);
    }
    return v;
  };
  const spreadRaw = (bp.spreadAnglesDeg ?? []) as unknown;
  if (
    !Array.isArray(spreadRaw) ||
    spreadRaw.length === 0 ||
    !spreadRaw.every((x) => typeof x === 'number' && Number.isFinite(x))
  ) {
    throw new Error('FlamethrowerBehavior: behaviorParams.spreadAnglesDeg 必须是非空有限数字数组');
  }
  return {
    sprayMs: num(bp.sprayMs, 'sprayMs'),
    cooldownMs: num(bp.cooldownMs, 'cooldownMs'),
    projectileIntervalMs: num(bp.projectileIntervalMs, 'projectileIntervalMs'),
    flameLifetimeMs: num(bp.flameLifetimeMs, 'flameLifetimeMs'),
    muzzleSpeed: num(bp.muzzleSpeed, 'muzzleSpeed'),
    projectileDamage: num(bp.projectileDamage, 'projectileDamage'),
    projectileRadius: num(bp.projectileRadius, 'projectileRadius'),
    projectileMass: num(bp.projectileMass, 'projectileMass'),
    spreadAnglesDeg: spreadRaw as number[],
  };
}

/**
 * Flamethrower Behavior（每 flamethrower part 一个实例）。
 * stepFixed 在 Orchestrator 的 onBeforeStep 每个固定物理步调用一次。
 *
 * 状态机（固定步，60Hz）：
 * - 冷却中：递减剩余步数，不发颗粒（已有粒子继续按生命周期超时销毁）；
 * - 冷却结束（或初始就绪）：开喷 spraySteps（≈60 步）；
 * - 喷射中：每 intervalSteps（2 步）生成一颗真实火焰 projectile（-6/0/+6° 循环），
 *   喷完进入短冷却；
 * - 所有颗粒记录出生步，每步检查 age ≥ lifetimeSteps → 真实 destroyBody。
 */
export class FlamethrowerBehavior {
  private readonly params: FlamethrowerParams;
  /** 剩余冷却固定步数：0 = 可开喷 */
  private cooldownStepsRemaining = 0;
  /** 剩余喷射固定步数：>0 = 喷射中 */
  private sprayStepsRemaining = 0;
  /** 距下一颗粒的剩余步数（0 = 本步生成） */
  private nextParticleStepsRemaining = 0;
  /** 分叉角度循环索引（确定性） */
  private particleIndex = 0;
  /** 本实例累计固定步（颗粒出生时间戳） */
  private elapsedSteps = 0;
  /** 火焰颗粒寿命（固定步数） */
  private readonly lifetimeSteps: number;
  /** 火焰颗粒间隔（固定步数） */
  private readonly intervalSteps: number;
  /** 本实例创建且仍存活的火焰颗粒：handle -> 出生步 */
  private readonly particles = new Map<BodyHandle, number>();
  /**
   * 真正创建火焰颗粒后的开火回调（timestamp 由 Orchestrator 补）。
   * 每颗粒一次 → 喷口持续小型闪光（喷口/火流/真实 projectile 同步）。
   */
  private readonly onFire?: (ev: Omit<WeaponFireEvent, 'timestamp'>) => void;

  constructor(
    part: PlanckPartRuntime,
    onFire?: (ev: Omit<WeaponFireEvent, 'timestamp'>) => void,
  ) {
    this.params = readFlamethrowerParams(part);
    this.onFire = onFire;
    this.lifetimeSteps = Math.max(
      1,
      Math.ceil(this.params.flameLifetimeMs / FIXED_DT_MS - 1e-9),
    );
    this.intervalSteps = Math.max(
      1,
      Math.ceil(this.params.projectileIntervalMs / FIXED_DT_MS - 1e-9),
    );
  }

  /** 剩余冷却固定步数（只读，供测试/调试） */
  get cooldownRemaining(): number {
    return this.cooldownStepsRemaining;
  }

  /** 剩余喷射固定步数（只读；>0 = 喷射中） */
  get sprayRemaining(): number {
    return this.sprayStepsRemaining;
  }

  /** 仍存活的火焰颗粒（快照数组；供 Orchestrator 越界检查 / 测试） */
  get aliveProjectiles(): readonly BodyHandle[] {
    return [...this.particles.keys()];
  }

  /** 火焰颗粒寿命（固定步数；供测试/调试） */
  get flameLifetimeSteps(): number {
    return this.lifetimeSteps;
  }

  /**
   * 消费 ContactRouter 的 projectile 接触事实（命中/撞墙 → 真实销毁；伤害已由 Router 结算）。
   * 只处理本实例创建的、仍存活的火焰颗粒。
   */
  consumeProjectileFacts(world: PlanckWorld, facts: readonly ProjectileContactFact[]): void {
    const destroyed = new Set<BodyHandle>();
    for (const fact of facts) {
      const body = fact.projectileBody as BodyHandle;
      if (this.particles.has(body) && !destroyed.has(body)) {
        world.destroyBody(body);
        destroyed.add(body);
        this.particles.delete(body);
      }
    }
  }

  /** 销毁由本实例创建且仍存活的火焰颗粒（越界销毁用），并从追踪集合移除 */
  destroyProjectile(world: PlanckWorld, handle: BodyHandle): void {
    if (!this.particles.has(handle)) {
      throw new Error('FlamethrowerBehavior: 不是本实例追踪的火焰颗粒，拒绝销毁');
    }
    world.destroyBody(handle);
    this.particles.delete(handle);
  }

  /**
   * 每个固定物理步调用一次（Orchestrator onBeforeStep 内）。
   * - 冷却中：递减剩余步数；冷却结束（或初始）→ 开喷；
   * - 喷射中：每 intervalSteps 生成一颗火焰颗粒；喷完 → 短冷却；
   * - 每步清理超龄颗粒（生命周期自管理，超时真实 destroy）。
   */
  stepFixed(world: PlanckWorld, vehicle: PlanckVehicle, part: PlanckPartRuntime): void {
    this.elapsedSteps++;
    if (this.cooldownStepsRemaining > 0) {
      this.cooldownStepsRemaining--;
      if (this.cooldownStepsRemaining > 0) {
        this.expireParticles(world);
        return;
      }
    }
    // 开喷（初始就绪或冷却刚结束）
    if (this.sprayStepsRemaining <= 0) {
      this.sprayStepsRemaining = Math.max(
        1,
        Math.ceil(this.params.sprayMs / FIXED_DT_MS - 1e-9),
      );
      this.nextParticleStepsRemaining = 0;
      this.particleIndex = 0;
    }
    // 喷射中：按间隔生成火焰颗粒
    this.sprayStepsRemaining--;
    if (this.nextParticleStepsRemaining > 0) {
      this.nextParticleStepsRemaining--;
    } else {
      this.spawnParticle(world, vehicle, part);
      this.nextParticleStepsRemaining = this.intervalSteps - 1;
    }
    if (this.sprayStepsRemaining <= 0) {
      this.cooldownStepsRemaining = Math.max(
        1,
        Math.ceil(this.params.cooldownMs / FIXED_DT_MS - 1e-9),
      );
    }
    this.expireParticles(world);
  }

  private spawnParticle(
    world: PlanckWorld,
    vehicle: PlanckVehicle,
    part: PlanckPartRuntime,
  ): void {
    const p = this.params;
    const partAngle = world.getAngle(part.body);

    // 真实炮口方向（part 世界姿态 × facing），再叠确定性分叉角（-6/0/+6 循环）
    const baseDir = rotateLocal({ x: vehicle.facing, y: 0 }, partAngle);
    const deg = p.spreadAnglesDeg[this.particleIndex % p.spreadAnglesDeg.length]!;
    this.particleIndex++;
    const a = (deg * Math.PI) / 180;
    const dir = {
      x: baseDir.x * Math.cos(a) - baseDir.y * Math.sin(a),
      y: baseDir.x * Math.sin(a) + baseDir.y * Math.cos(a),
    };

    // 每颗真实火焰 projectile：复用正式 Projectile / CCD / Owner Filter 链。
    // gravityScale=0 → 水平直飞；短命由本 behavior 超时 destroy 控制（短射程来源）。
    const { proj, muzzlePoint } = spawnWeaponProjectile(world, vehicle, part, {
      dir,
      muzzleSpeed: p.muzzleSpeed,
      projectileRadius: p.projectileRadius,
      projectileMass: p.projectileMass,
      gravityScale: 0,
    });
    this.particles.set(proj, this.elapsedSteps);

    // 每颗粒独立喷口小型闪光（VFX 消费；喷口/火流/真实 projectile 同步；纯表现）
    this.onFire?.({
      type: 'weaponFire',
      team: vehicle.team,
      partId: `part:${part.id}`,
      behavior: 'flamethrower',
      worldPosition: { x: muzzlePoint.x, y: muzzlePoint.y },
      worldDirection: { x: dir.x, y: dir.y },
    });
  }

  /** 超龄火焰颗粒真实销毁（生命周期自管理；停火后全部清空 → 画面无残留火焰） */
  private expireParticles(world: PlanckWorld): void {
    for (const [handle, bornStep] of this.particles) {
      if (this.elapsedSteps - bornStep >= this.lifetimeSteps) {
        world.destroyBody(handle);
        this.particles.delete(handle);
      }
    }
  }
}
