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
import { PhysWorld, FIXED_DT } from '../physics/adapter';
import { createVehicle, updateVehiclePhysics, settleVehicleToRestPose, type Vehicle } from './vehicleAssembly';
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
  /**
   * 出生后是否把整车下沉到「最低点接触地面」（无下落弹跳）。
   * 消除「从空中落下→弹跳→混沌分叉」的 Reset 非确定性。空中出生场景（D-air）设 false。
   */
  settleToGround?: boolean;
  /** 车辆初始位置与朝向（facing：1 朝右 / -1 朝左，镜像而非旋转） */
  spawnA?: { x: number; y: number; facing?: 1 | -1 };
  spawnB?: { x: number; y: number; facing?: 1 | -1 };
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

    // 先建 Arena（需要 groundY 做落地沉降）
    this.arena = new ArenaRuntime(this.world, config.arena);

    const spawnA = config.spawnA ?? { x: 400, y: 640, facing: 1 };
    const spawnB = config.spawnB ?? { x: 1200, y: 640, facing: -1 };

    this.vehicleA = createVehicle(this.world, resolvedA, 'A', { x: spawnA.x, y: spawnA.y }, spawnA.facing ?? 1);
    this.vehicleB = createVehicle(this.world, resolvedB, 'B', { x: spawnB.x, y: spawnB.y }, spawnB.facing ?? -1);

    // 落地沉降：默认按轮径差摆正静止姿态再贴地，消除初始下落导致的 Reset 非确定性。
    if (config.settleToGround !== false) {
      settleVehicleToRestPose(this.vehicleA, this.arena.config.groundY);
      settleVehicleToRestPose(this.vehicleB, this.arena.config.groundY);
    }

    this.damageResolver = new DamageResolver(this.bus);
    this.router = new ContactRouter(
      [this.vehicleA, this.vehicleB],
      this.damageResolver,
      { ...DEFAULT_IMPACT_CONFIG, ...config.impact },
    );

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

  /**
   * 推进一帧：固定物理步进 + 驱动 + 阶段 + 死亡检测。
   *
   * 关键（Canonical Foundation）：
   * - Drive 及未来 Behavior 必须在每个 FIXED_DT 的 Engine.update 之前执行（通过 onBeforeStep），
   *   使驱动力在每个物理步内被引擎消费，保证 30FPS / 60FPS / 轻微卡帧下结果帧率无关。
   * - 战斗时间按「实际执行的 Fixed Steps」推进（steps * FIXED_DT），不按渲染帧 realDtMs 直接累计，
   *   避免渲染帧抖动导致战斗计时漂移。
   */
  step(realDtMs: number, timeScale = 1): void {
    if (this._result) return;

    const steps = this.world.step(realDtMs, timeScale, () => {
      // 车辆驱动（自动战斗：A 朝 +X、B 朝 -X，即各自 facing 方向）
      if (this.config.autoDrive !== false) {
        driveVehicle(this.vehicleA, FIXED_DT, this.vehicleA.facing);
        driveVehicle(this.vehicleB, FIXED_DT, this.vehicleB.facing);
      }
      // 未来 Behavior（Weapon / Gadget 状态机）在此插入：每个物理步之前执行。
    });

    this.time += steps * FIXED_DT;

    // 每帧聚合一次物理量（COM / Mass / Inertia），供 Renderer 与 Lab 消费
    updateVehiclePhysics(this.vehicleA);
    updateVehiclePhysics(this.vehicleB);

    this.arena.update(steps * FIXED_DT);

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
