/**
 * Battle Orchestrator：Battle 生命周期编排。
 *
 * 只负责（15.1）：
 * - 初始化左右 Build；
 * - Battle 生命周期（Countdown / Active / Warning / Closing / End）；
 * - HP 死亡检测；
 * - Result。
 *
 * 不控制：开炮 / 挥锤 / Gadget 动作 / 车辆职业 AI。
 *
 * 同一套 Runtime 被正式 Battle 与 Physics Lab 共同调用（禁止第二套实现）。
 */
import type { BuildSnapshot, ContentRegistry, TeamId } from '../core/types';
import { resolveSnapshot } from '../core/buildSnapshot';
import { PhysWorld } from '../physics/adapter';
import { createVehicle, updateVehiclePhysics, type Vehicle } from './vehicleAssembly';
import { driveVehicle } from './movement';
import { ContactRouter, DEFAULT_IMPACT_CONFIG, type ImpactConfig } from './contactRouter';
import { DamageResolver } from './damageResolver';
import { CombatEventBus, type CombatEvent } from './combatEvents';
import { ArenaRuntime, type ArenaConfig } from './arenaRuntime';

export interface BattleConfig {
  impact?: Partial<ImpactConfig>;
  arena?: Partial<ArenaConfig>;
  /** 双方是否自动朝对方驱动（正式战斗为 true，部分 Lab 场景为 false） */
  autoDrive?: boolean;
  /** 车辆初始位置与朝向（未提供时用对称默认） */
  spawnA?: { x: number; y: number; angle?: number };
  spawnB?: { x: number; y: number; angle?: number };
}

export interface BattleResult {
  winner: TeamId | 'draw' | null;
  hpA: number;
  hpB: number;
  phase: string;
}

export class BattleOrchestrator {
  readonly world: PhysWorld;
  readonly arena: ArenaRuntime;
  readonly vehicleA: Vehicle;
  readonly vehicleB: Vehicle;
  readonly router: ContactRouter;
  readonly damageResolver: DamageResolver;
  readonly bus = new CombatEventBus();
  readonly config: BattleConfig;

  private _result: BattleResult | null = null;
  private time = 0;

  constructor(
    buildA: BuildSnapshot,
    buildB: BuildSnapshot,
    registry: ContentRegistry,
    config: BattleConfig = {},
  ) {
    this.config = config;
    this.world = new PhysWorld({ x: 0, y: 1 });

    const resolvedA = resolveSnapshot(buildA, registry);
    const resolvedB = resolveSnapshot(buildB, registry);

    const spawnA = config.spawnA ?? { x: 400, y: 640, angle: 0 };
    const spawnB = config.spawnB ?? { x: 1200, y: 640, angle: Math.PI };

    this.vehicleA = createVehicle(this.world, resolvedA, 'A', spawnA, spawnA.angle ?? 0);
    this.vehicleB = createVehicle(this.world, resolvedB, 'B', spawnB, spawnB.angle ?? Math.PI);

    this.damageResolver = new DamageResolver(this.bus);
    this.router = new ContactRouter(
      [this.vehicleA, this.vehicleB],
      this.damageResolver,
      { ...DEFAULT_IMPACT_CONFIG, ...config.impact },
    );

    this.arena = new ArenaRuntime(this.world, config.arena);

    this.world.setCollisionHandlers({
      onStart: (ev) => this.router.handleContact(ev),
      onActive: (ev) => this.router.handleContact(ev),
      onEnd: (ev) => this.router.handleContact(ev),
    });
  }

  get result(): BattleResult | null {
    return this._result;
  }

  get phase(): string {
    return this._result?.phase ?? this.arena.phase;
  }

  get timeMs(): number {
    return this.time;
  }

  /** 推进一帧：固定物理步进 + 驱动 + 阶段 + 死亡检测 */
  step(realDtMs: number, timeScale = 1): void {
    if (this._result) return;

    const steps = this.world.step(realDtMs, timeScale);
    this.time += realDtMs * timeScale;

    // 车辆驱动（自动战斗：A 向右、B 向左）
    if (this.config.autoDrive !== false) {
      driveVehicle(this.vehicleA, 1000 / 60, 1);
      driveVehicle(this.vehicleB, 1000 / 60, -1);
    }

    // 每物理步聚合物理量
    for (let i = 0; i < steps; i++) {
      updateVehiclePhysics(this.vehicleA);
      updateVehiclePhysics(this.vehicleB);
    }
    updateVehiclePhysics(this.vehicleA);
    updateVehiclePhysics(this.vehicleB);

    this.arena.update(realDtMs * timeScale);

    this.detectEnd();
  }

  /** HP 死亡检测 → Result */
  private detectEnd(): void {
    const aDead = this.vehicleA.hp <= 0;
    const bDead = this.vehicleB.hp <= 0;

    if (this.arena.phase === 'End') {
      this._result = {
        winner: this.vehicleA.hp > this.vehicleB.hp ? 'A' : this.vehicleB.hp > this.vehicleA.hp ? 'B' : 'draw',
        hpA: this.vehicleA.hp,
        hpB: this.vehicleB.hp,
        phase: 'End',
      };
      return;
    }

    if (aDead && bDead) {
      this._result = { winner: 'draw', hpA: 0, hpB: 0, phase: 'End' };
    } else if (aDead) {
      this._result = { winner: 'B', hpA: 0, hpB: this.vehicleB.hp, phase: 'End' };
    } else if (bDead) {
      this._result = { winner: 'A', hpA: this.vehicleA.hp, hpB: 0, phase: 'End' };
    }
  }

  /** 订阅 Combat Event（Renderer 消费） */
  onCombatEvent(fn: (ev: CombatEvent) => void): () => void {
    return this.bus.subscribe(fn);
  }

  /** 销毁（释放物理世界，供 Lab Reset / Clear 重建） */
  dispose(): void {
    // Matter 无显式销毁；丢弃引用即可（GC 回收 engine 与 body）
  }
}
