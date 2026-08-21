/**
 * Part Behavior Runtime（W1-BH-1）：统一 Weapon/Gadget Behavior 最小生命周期。
 *
 * 目的：新增 Weapon/Gadget 时只注册 factory（behaviorRegistry.ts），
 * 不再修改 PlanckBattleOrchestrator 的生命周期（构造 / before-step / after-step / render）。
 *
 * 生命周期：
 * - beforePhysicsStep(world, timeMs)：每个固定物理步之前驱动行为状态机（onBeforeStep 内）；
 * - afterPhysicsStep(world, projectileFacts)：物理步后消费 projectile facts（可选）；
 * - destroyOutOfBoundsProjectiles(world, isOutOfBounds)：物理步后销毁越界 projectile（可选）；
 * - getRenderProjectiles(world)：渲染快照的 projectile 贡献（可选）。
 *
 * 三个既有 Behavior（Cannon / Hammer / Push Rod）内部玩法、参数、timing 完全不变，
 * 只做统一 wrapper 适配。
 */
import type { BodyHandle, PlanckWorld } from '../physics/planckWorld';
import type { PlanckPartRuntime, PlanckVehicle } from './planckVehicleAssembly';
import type { ProjectileContactFact } from './contactRouter';
import type { BattleEvent } from './combatEvents';
import type { RenderProjectile, RenderFlame } from './battleContract';
import { CannonBehavior } from './cannonBehavior';
import { HammerBehavior } from './hammerBehavior';
import { PushRodBehavior } from './pushRodBehavior';
import { LaserBehavior } from './laserBehavior';
import { LifterBehavior } from './lifterBehavior';
import { RammerBehavior } from './rammerBehavior';
import { SawBehavior } from './sawBehavior';
import { ShotgunBehavior } from './shotgunBehavior';
import { ThrusterBehavior } from './thrusterBehavior';
import { MachineGunBehavior } from './machineGunBehavior';
import { FlamethrowerBehavior } from './flamethrowerBehavior';

/** Behavior factory 输入（由 Orchestrator 在构造时提供） */
export interface BehaviorContext {
  vehicle: PlanckVehicle;
  part: PlanckPartRuntime;
  /** 发射 Battle Event（timestamp 已由 runtime 补全） */
  emit: (ev: BattleEvent) => void;
}

/** 统一最小生命周期（新增 Behavior 只需实现此接口） */
export interface PartBehaviorRuntime {
  readonly vehicle: PlanckVehicle;
  readonly part: PlanckPartRuntime;
  /** 物理步前（onBeforeStep 内）：驱动行为状态机 */
  beforePhysicsStep(world: PlanckWorld, timeMs: number): void;
  /** 物理步后：消费 projectile facts / 生命周期（无则省略） */
  afterPhysicsStep?(world: PlanckWorld, projectileFacts: readonly ProjectileContactFact[]): void;
  /** 物理步后：销毁越界 projectile（无则省略） */
  destroyOutOfBoundsProjectiles?(
    world: PlanckWorld,
    isOutOfBounds: (pos: { x: number; y: number }) => boolean,
  ): void;
  /** 渲染贡献：存活 projectile 快照（无则省略） */
  getRenderProjectiles?(world: PlanckWorld): RenderProjectile[];
  /** 渲染贡献：存活喷焰快照（仅推进期；无则省略） */
  getRenderFlames?(world: PlanckWorld): RenderFlame[];
}

/* ---------- Cannon（Q02-C1A）：发射 + 冷却 + projectile 生命周期 + 渲染 ---------- */

class CannonRuntime implements PartBehaviorRuntime {
  readonly vehicle: PlanckVehicle;
  readonly part: PlanckPartRuntime;
  private readonly behavior: CannonBehavior;
  /** 当前固定步的战斗时间（fire 事件 timestamp 用；与旧 orchestrator.this.time 语义一致） */
  private timeMs = 0;

  constructor(ctx: BehaviorContext) {
    this.vehicle = ctx.vehicle;
    this.part = ctx.part;
    this.behavior = new CannonBehavior(ctx.part, (e) => {
      ctx.emit({ ...e, timestamp: this.timeMs });
    });
  }

  beforePhysicsStep(world: PlanckWorld, timeMs: number): void {
    this.timeMs = timeMs;
    this.behavior.stepFixed(world, this.vehicle, this.part);
  }

  afterPhysicsStep(
    world: PlanckWorld,
    projectileFacts: readonly ProjectileContactFact[],
  ): void {
    this.behavior.consumeProjectileFacts(world, projectileFacts);
  }

  destroyOutOfBoundsProjectiles(
    world: PlanckWorld,
    isOutOfBounds: (pos: { x: number; y: number }) => boolean,
  ): void {
    for (const p of this.behavior.aliveProjectiles) {
      if (isOutOfBounds(world.getPosition(p))) {
        this.behavior.destroyProjectile(world, p);
      }
    }
  }

  getRenderProjectiles(world: PlanckWorld): RenderProjectile[] {
    const out: RenderProjectile[] = [];
    for (const p of this.behavior.aliveProjectiles) {
      const tag = world.getOwnerTag(p);
      if (!tag || !tag.team) continue; // 已销毁 / 无归属：不进入快照
      const bounds = world.getBounds(p);
      out.push({
        center: world.getPosition(p),
        radius: (bounds.maxX - bounds.minX) / 2,
        team: tag.team,
      });
    }
    return out;
  }
}

/* ---------- Hammer（Q03-C1）：摆锤状态机（无 projectile） ---------- */

class HammerRuntime implements PartBehaviorRuntime {
  readonly vehicle: PlanckVehicle;
  readonly part: PlanckPartRuntime;
  private readonly behavior: HammerBehavior;

  constructor(ctx: BehaviorContext) {
    this.vehicle = ctx.vehicle;
    this.part = ctx.part;
    this.behavior = new HammerBehavior(ctx.part);
  }

  beforePhysicsStep(world: PlanckWorld, _timeMs: number): void {
    this.behavior.stepFixed(world, this.vehicle, this.part);
  }
}

/* ---------- Push Rod（Q04-C1）：伸缩状态机（无 projectile） ---------- */

class PushRodRuntime implements PartBehaviorRuntime {
  readonly vehicle: PlanckVehicle;
  readonly part: PlanckPartRuntime;
  private readonly behavior: PushRodBehavior;

  constructor(ctx: BehaviorContext) {
    this.vehicle = ctx.vehicle;
    this.part = ctx.part;
    this.behavior = new PushRodBehavior(ctx.part);
  }

  beforePhysicsStep(world: PlanckWorld, _timeMs: number): void {
    this.behavior.stepFixed(world, this.vehicle, this.part);
  }
}

/* ---------- Laser（Q11-C）：蓄能镭射（长前摇 → 高威胁射击 → 强后坐；真实 Projectile 链路） ---------- */

class LaserRuntime implements PartBehaviorRuntime {
  readonly vehicle: PlanckVehicle;
  readonly part: PlanckPartRuntime;
  private readonly behavior: LaserBehavior;
  private timeMs = 0;

  constructor(ctx: BehaviorContext) {
    this.vehicle = ctx.vehicle;
    this.part = ctx.part;
    this.behavior = new LaserBehavior(
      ctx.part,
      (e) => ctx.emit({ ...e, timestamp: this.timeMs }),
      (e) => ctx.emit({ ...e, timestamp: this.timeMs }),
    );
  }

  beforePhysicsStep(world: PlanckWorld, timeMs: number): void {
    this.timeMs = timeMs;
    this.behavior.stepFixed(world, this.vehicle, this.part);
  }

  afterPhysicsStep(
    world: PlanckWorld,
    projectileFacts: readonly ProjectileContactFact[],
  ): void {
    this.behavior.consumeProjectileFacts(world, projectileFacts);
  }

  destroyOutOfBoundsProjectiles(
    world: PlanckWorld,
    isOutOfBounds: (pos: { x: number; y: number }) => boolean,
  ): void {
    for (const p of this.behavior.aliveProjectiles) {
      if (isOutOfBounds(world.getPosition(p))) {
        this.behavior.destroyProjectile(world, p);
      }
    }
  }

  getRenderProjectiles(world: PlanckWorld): RenderProjectile[] {
    const out: RenderProjectile[] = [];
    for (const p of this.behavior.aliveProjectiles) {
      const tag = world.getOwnerTag(p);
      if (!tag || !tag.team) continue;
      const bounds = world.getBounds(p);
      const v = world.getLinearVelocity(p);
      out.push({
        center: world.getPosition(p),
        radius: (bounds.maxX - bounds.minX) / 2,
        team: tag.team,
        // Q11-C-R1/R2：镭射弹视觉标记 + 真实飞行方向（渲染能量束，不参与碰撞/伤害链）
        visual: 'laser',
        velocity: { x: v.x, y: v.y },
      });
    }
    return out;
  }
}

/** 已迁移的三类正式 Behavior factory（新增 Behavior 在 behaviorRegistry.ts 注册） */
export function createCannonRuntime(ctx: BehaviorContext): PartBehaviorRuntime {
  return new CannonRuntime(ctx);
}
export function createHammerRuntime(ctx: BehaviorContext): PartBehaviorRuntime {
  return new HammerRuntime(ctx);
}
export function createPushRodRuntime(ctx: BehaviorContext): PartBehaviorRuntime {
  return new PushRodRuntime(ctx);
}
export function createLaserRuntime(ctx: BehaviorContext): PartBehaviorRuntime {
  return new LaserRuntime(ctx);
}

/* ---------- Lifter（Q12-B-CLOSE prototype/hold）：举升臂 Revolute 状态机（无 projectile / 无 Direct Damage）；保留供复用，不在玩家装配页 ---------- */

class LifterRuntime implements PartBehaviorRuntime {
  readonly vehicle: PlanckVehicle;
  readonly part: PlanckPartRuntime;
  private readonly behavior: LifterBehavior;

  constructor(ctx: BehaviorContext) {
    this.vehicle = ctx.vehicle;
    this.part = ctx.part;
    this.behavior = new LifterBehavior(ctx.part);
  }

  beforePhysicsStep(world: PlanckWorld, _timeMs: number): void {
    this.behavior.stepFixed(world, this.vehicle, this.part);
  }
}

export function createLifterRuntime(ctx: BehaviorContext): PartBehaviorRuntime {
  return new LifterRuntime(ctx);
}

/* ---------- Rammer（Q12-C）：冲锤 Prismatic 撞击状态机（真实 Contact Weapon） ---------- */

class RammerRuntime implements PartBehaviorRuntime {
  readonly vehicle: PlanckVehicle;
  readonly part: PlanckPartRuntime;
  private readonly behavior: RammerBehavior;

  constructor(ctx: BehaviorContext) {
    this.vehicle = ctx.vehicle;
    this.part = ctx.part;
    this.behavior = new RammerBehavior(ctx.part);
  }

  beforePhysicsStep(world: PlanckWorld, _timeMs: number): void {
    this.behavior.stepFixed(world, this.vehicle, this.part);
  }
}

export function createRammerRuntime(ctx: BehaviorContext): PartBehaviorRuntime {
  return new RammerRuntime(ctx);
}

/* ---------- Saw（Q13-A）：圆锯持续单方向高速旋转（真实 Revolute motor，无 limit / 无状态机） ---------- */

class SawRuntime implements PartBehaviorRuntime {
  readonly vehicle: PlanckVehicle;
  readonly part: PlanckPartRuntime;
  private readonly behavior: SawBehavior;

  constructor(ctx: BehaviorContext) {
    this.vehicle = ctx.vehicle;
    this.part = ctx.part;
    this.behavior = new SawBehavior(ctx.part);
  }

  beforePhysicsStep(world: PlanckWorld, _timeMs: number): void {
    this.behavior.stepFixed(world, this.vehicle, this.part);
  }
}

export function createSawRuntime(ctx: BehaviorContext): PartBehaviorRuntime {
  return new SawRuntime(ctx);
}

/* ---------- Shotgun（Q13-B）：霰弹炮齐射（5 发固定扇形真实 projectile / 一次爆闪 + 后坐） ---------- */

class ShotgunRuntime implements PartBehaviorRuntime {
  readonly vehicle: PlanckVehicle;
  readonly part: PlanckPartRuntime;
  private readonly behavior: ShotgunBehavior;

  constructor(ctx: BehaviorContext) {
    this.vehicle = ctx.vehicle;
    this.part = ctx.part;
    this.behavior = new ShotgunBehavior(ctx.part, (e) => {
      ctx.emit({ ...e, timestamp: this.timeMs });
    });
  }

  private timeMs = 0;

  beforePhysicsStep(world: PlanckWorld, timeMs: number): void {
    this.timeMs = timeMs;
    this.behavior.stepFixed(world, this.vehicle, this.part);
  }

  afterPhysicsStep(
    world: PlanckWorld,
    projectileFacts: readonly ProjectileContactFact[],
  ): void {
    this.behavior.consumeProjectileFacts(world, projectileFacts);
  }

  destroyOutOfBoundsProjectiles(
    world: PlanckWorld,
    isOutOfBounds: (pos: { x: number; y: number }) => boolean,
  ): void {
    for (const p of this.behavior.aliveProjectiles) {
      if (isOutOfBounds(world.getPosition(p))) {
        this.behavior.destroyProjectile(world, p);
      }
    }
  }

  getRenderProjectiles(world: PlanckWorld): RenderProjectile[] {
    const out: RenderProjectile[] = [];
    for (const p of this.behavior.aliveProjectiles) {
      const tag = world.getOwnerTag(p);
      if (!tag || !tag.team) continue; // 已销毁 / 无归属：不进入快照
      const bounds = world.getBounds(p);
      const v = world.getLinearVelocity(p);
      out.push({
        center: world.getPosition(p),
        radius: (bounds.maxX - bounds.minX) / 2,
        team: tag.team,
        // Q13-B-R1：霰弹炮弹视觉标记 + 真实飞行方向（沿真实 velocity 画短高速弹迹，
        // 不参与碰撞/伤害链，不扩大真实命中范围）。
        visual: 'tracer',
        velocity: { x: v.x, y: v.y },
      });
    }
    return out;
  }
}

export function createShotgunRuntime(ctx: BehaviorContext): PartBehaviorRuntime {
  return new ShotgunRuntime(ctx);
}

/* ---------- Thruster（Q13-C）：推进器 Gadget（固定周期 windup→thrust→cooldown；沿 chassis facing 施力 + 真实喷焰） ---------- */

class ThrusterRuntime implements PartBehaviorRuntime {
  readonly vehicle: PlanckVehicle;
  readonly part: PlanckPartRuntime;
  private readonly behavior: ThrusterBehavior;

  constructor(ctx: BehaviorContext) {
    this.vehicle = ctx.vehicle;
    this.part = ctx.part;
    this.behavior = new ThrusterBehavior(ctx.part);
  }

  beforePhysicsStep(world: PlanckWorld, _timeMs: number): void {
    this.behavior.stepFixed(world, this.vehicle, this.part);
  }

  getRenderFlames(world: PlanckWorld): RenderFlame[] {
    const f = this.behavior.getFlame(world, this.vehicle, this.part);
    return f ? [f] : [];
  }
}

export function createThrusterRuntime(ctx: BehaviorContext): PartBehaviorRuntime {
  return new ThrusterRuntime(ctx);
}

/* ---------- MachineGun（Q14-A）：连发机枪（固定 burst 节奏，每发真实 projectile + 小闪光 + 单发后坐） ---------- */

class MachineGunRuntime implements PartBehaviorRuntime {
  readonly vehicle: PlanckVehicle;
  readonly part: PlanckPartRuntime;
  private readonly behavior: MachineGunBehavior;
  private timeMs = 0;

  constructor(ctx: BehaviorContext) {
    this.vehicle = ctx.vehicle;
    this.part = ctx.part;
    this.behavior = new MachineGunBehavior(ctx.part, (e) => {
      ctx.emit({ ...e, timestamp: this.timeMs });
    });
  }

  beforePhysicsStep(world: PlanckWorld, timeMs: number): void {
    this.timeMs = timeMs;
    this.behavior.stepFixed(world, this.vehicle, this.part);
  }

  afterPhysicsStep(
    world: PlanckWorld,
    projectileFacts: readonly ProjectileContactFact[],
  ): void {
    this.behavior.consumeProjectileFacts(world, projectileFacts);
  }

  destroyOutOfBoundsProjectiles(
    world: PlanckWorld,
    isOutOfBounds: (pos: { x: number; y: number }) => boolean,
  ): void {
    for (const p of this.behavior.aliveProjectiles) {
      if (isOutOfBounds(world.getPosition(p))) {
        this.behavior.destroyProjectile(world, p);
      }
    }
  }

  getRenderProjectiles(world: PlanckWorld): RenderProjectile[] {
    const out: RenderProjectile[] = [];
    for (const p of this.behavior.aliveProjectiles) {
      const tag = world.getOwnerTag(p);
      if (!tag || !tag.team) continue; // 已销毁 / 无归属：不进入快照
      const bounds = world.getBounds(p);
      const v = world.getLinearVelocity(p);
      out.push({
        center: world.getPosition(p),
        radius: (bounds.maxX - bounds.minX) / 2,
        team: tag.team,
        // Q14-A：机枪弹画成沿真实飞行方向的高速短弹迹（复用 tracer 渲染，
        // 与霰弹同一视觉标记；不扩大真实命中范围）。
        visual: 'tracer',
        velocity: { x: v.x, y: v.y },
      });
    }
    return out;
  }
}

export function createMachineGunRuntime(ctx: BehaviorContext): PartBehaviorRuntime {
  return new MachineGunRuntime(ctx);
}

/* ---------- Flamethrower（Q14-B）：喷火器（持续短命火焰 projectile 流，生命周期自管理） ---------- */

class FlamethrowerRuntime implements PartBehaviorRuntime {
  readonly vehicle: PlanckVehicle;
  readonly part: PlanckPartRuntime;
  private readonly behavior: FlamethrowerBehavior;
  private timeMs = 0;

  constructor(ctx: BehaviorContext) {
    this.vehicle = ctx.vehicle;
    this.part = ctx.part;
    this.behavior = new FlamethrowerBehavior(ctx.part, (e) => {
      ctx.emit({ ...e, timestamp: this.timeMs });
    });
  }

  beforePhysicsStep(world: PlanckWorld, timeMs: number): void {
    this.timeMs = timeMs;
    this.behavior.stepFixed(world, this.vehicle, this.part);
  }

  afterPhysicsStep(
    world: PlanckWorld,
    projectileFacts: readonly ProjectileContactFact[],
  ): void {
    this.behavior.consumeProjectileFacts(world, projectileFacts);
  }

  destroyOutOfBoundsProjectiles(
    world: PlanckWorld,
    isOutOfBounds: (pos: { x: number; y: number }) => boolean,
  ): void {
    for (const p of this.behavior.aliveProjectiles) {
      if (isOutOfBounds(world.getPosition(p))) {
        this.behavior.destroyProjectile(world, p);
      }
    }
  }

  getRenderProjectiles(world: PlanckWorld): RenderProjectile[] {
    const out: RenderProjectile[] = [];
    for (const p of this.behavior.aliveProjectiles) {
      const tag = world.getOwnerTag(p);
      if (!tag || !tag.team) continue; // 已销毁 / 无归属：不进入快照
      const bounds = world.getBounds(p);
      const v = world.getLinearVelocity(p);
      out.push({
        center: world.getPosition(p),
        radius: (bounds.maxX - bounds.minX) / 2,
        team: tag.team,
        // Q14-B：火焰颗粒画成「黄白火芯 + 橙红短尾」火流（复用 flame 渲染，
        // 不画小圆弹；不扩大真实命中范围）。
        visual: 'flame',
        velocity: { x: v.x, y: v.y },
      });
    }
    return out;
  }
}

export function createFlamethrowerRuntime(ctx: BehaviorContext): PartBehaviorRuntime {
  return new FlamethrowerRuntime(ctx);
}

export type { BodyHandle };
