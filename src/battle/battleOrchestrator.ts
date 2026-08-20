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
import type { BuildSnapshot, ContentRegistry } from '../core/types';
import { resolveSnapshot } from '../core/buildSnapshot';
import { PhysWorld, FIXED_DT, getPosition, getAngle } from '../physics/adapter';
import { createVehicle, updateVehiclePhysics, settleVehicleToRestPose, type Vehicle } from './vehicleAssembly';
import { driveVehicle } from './movement';
import { ContactRouter, DEFAULT_IMPACT_CONFIG } from './contactRouter';
import { DamageResolver } from './damageResolver';
import { CombatEventBus, type BattleEvent } from './combatEvents';
import { ArenaRuntime } from './arenaRuntime';
import {
  resolveBattleResult,
  type BattleConfig,
  type BattleResult,
  type BattleRenderSnapshot,
  type BattleStatusSnapshot,
  type RenderPolygon,
  type RenderCircle,
  type RenderVehicle,
} from './battleContract';
import type { Body } from 'matter-js';

/** 引擎中立 Battle 合同（B14B：自 battleContract.ts 重新导出，保持既有导入路径兼容） */
export type { BattleConfig, BattleResult } from './battleContract';

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

  /** 双方实时战斗状态（Q06-HUD-F1）：hp/maxHp 直读真实 vehicle；phase 复用正式 phase */
  getBattleStatusSnapshot(): BattleStatusSnapshot {
    return {
      sideA: { team: 'A', hp: this.vehicleA.hp, maxHp: this.vehicleA.maxHp },
      sideB: { team: 'B', hp: this.vehicleB.hp, maxHp: this.vehicleB.maxHp },
      phase: this.phase,
    };
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

  /** HP 死亡检测 → Result（B14B：委托引擎中立 resolveBattleResult，判定语义不变） */
  private detectEnd(): void {
    this._result = resolveBattleResult(this.arena.phase, this.vehicleA.hp, this.vehicleB.hp);
  }

  /** 订阅 Battle Event（Renderer / VFX / SFX 消费；按 type 判别） */
  onCombatEvent(fn: (ev: BattleEvent) => void): () => void {
    return this.bus.subscribe(fn);
  }

  /**
   * 引擎中立 Render Snapshot（B17B-A1）。
   * 纯读取：不 step、不改 Body、不动 HP/phase/contact/arena，无物理或 Gameplay 副作用。
   * 几何来源与当前 Renderer（renderer.ts）实际读取一一对应：
   * - chassis / functional parts / 墙体：body.parts[].vertices（真实世界多边形，非 AABB）；
   * - wheels：getPosition(body) / body.circleRadius / getAngle(body)。
   */
  getRenderSnapshot(): BattleRenderSnapshot {
    const toPolygons = (body: Body): RenderPolygon[] => {
      const parts = body.parts.length > 0 ? body.parts : [body];
      return parts.map((part) => ({
        points: part.vertices.map((v) => ({ x: v.x, y: v.y })),
      }));
    };
    const toCircle = (body: Body): RenderCircle => {
      const c = getPosition(body);
      return { center: { x: c.x, y: c.y }, radius: body.circleRadius ?? 10, angle: getAngle(body) };
    };
    const toVehicle = (v: Vehicle): RenderVehicle => ({
      team: v.team,
      body: { kind: 'polygons', polygons: toPolygons(v.body) },
      wheels: v.wheels.map((w) => toCircle(w.body)),
      parts: v.parts.map((p) => ({
        shape: { kind: 'polygons', polygons: toPolygons(p.body) },
        category: p.def.category,
      })),
    });
    return {
      arena: {
        width: this.arena.config.width,
        groundY: this.arena.config.groundY,
        normalWalls: [
          { kind: 'polygons', polygons: toPolygons(this.arena.leftWall) },
          { kind: 'polygons', polygons: toPolygons(this.arena.rightWall) },
        ],
        closingWalls: this.arena.closingWalls.map((cw) => ({
          kind: 'polygons',
          polygons: toPolygons(cw.body),
        })),
      },
      vehicleA: toVehicle(this.vehicleA),
      vehicleB: toVehicle(this.vehicleB),
    };
  }

  /** 销毁（释放物理世界，供 Lab Reset / Clear 重建） */
  dispose(): void {
    // Matter 无显式销毁；丢弃引用即可（GC 回收 engine 与 body）
  }
}
