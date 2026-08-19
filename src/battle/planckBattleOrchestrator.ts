/**
 * Planck Battle Orchestrator：Battle 生命周期编排（Minimal Drive Loop, Queue F-02M-B17A-A1）。
 *
 * 与 Matter BattleOrchestrator（src/battle/battleOrchestrator.ts）保持同构：
 * - 构造输入与公开核心状态一致；
 * - 复用 PlanckWorld / resolveSnapshot / PlanckArenaRuntime / createPlanckVehicle /
 *   settlePlanckVehicleToRestPose / DamageResolver / ContactRouter / resolveBattleResult；
 * - 只注册一次 setBatchedContactListener（禁止同时注册 setContactListener，
 *   避免即时/批次双投递造成重复伤害）；
 * - step() 在 onBeforeStep 内驱动（A worldDirection=+1、B=-1），
 *   按实际固定步数推进 time 与 arena，并用 resolveBattleResult 更新 result；
 * - grounded 完全交给 ContactRouter.handlePlanckContact 维护，本模块不新增检测或猜测。
 *
 * 不控制：开炮 / 挥锤 / Gadget 动作 / 车辆职业 AI / Weapon / Projectile / UI。
 * 同一套 Runtime 被正式 Battle 与 Physics Lab 共同调用（禁止第二套实现）。
 */
import type { BuildSnapshot, ContentRegistry, ColliderDef } from '../core/types';
import { resolveSnapshot } from '../core/buildSnapshot';
import { PlanckWorld } from '../physics/planckWorld';
import { PHYSICS_HZ } from '../physics/units';
import {
  createPlanckVehicle,
  settlePlanckVehicleToRestPose,
  type PlanckPartRuntime,
  type PlanckVehicle,
} from './planckVehicleAssembly';
import { drivePlanckVehicle } from './planckMovement';
import { CannonBehavior } from './cannonBehavior';
import { HammerBehavior } from './hammerBehavior';
import { PushRodBehavior } from './pushRodBehavior';
import { ContactRouter, DEFAULT_IMPACT_CONFIG } from './contactRouter';
import { DamageResolver } from './damageResolver';
import { CombatEventBus, type CombatEvent } from './combatEvents';
import { PlanckArenaRuntime } from './planckArenaRuntime';
import {
  resolveBattleResult,
  type BattleConfig,
  type BattleResult,
  type BattleRenderSnapshot,
  type RenderVehicle,
  type RenderShape,
  type RenderCircle,
  type RenderFunctionalPart,
  type RenderArena,
  type RenderVec2,
  type RenderProjectile,
} from './battleContract';

/** 引擎中立 Battle 合同（B14B：自 battleContract.ts 重新导出，保持既有导入路径兼容） */
export type { BattleConfig, BattleResult } from './battleContract';

/** 固定物理步长（ms）：与 Matter FIXED_DT / PlanckWorld.FIXED_STEP_MS 数值一致 */
const FIXED_DT_MS = 1000 / PHYSICS_HZ;

/**
 * autoDrive 目标线速度（px/step）：复用 Matter movement.TARGET_SPEED（1.5 px/step ≈ 90 px/s）
 * 的既有 autoDrive 语义；不新增物理阈值或参数。drivePlanckVehicle 取其目标速度，
 * 由车轮真实 grip 提供牵引（不施加 force/impulse）。
 */
const AUTO_DRIVE_TARGET_SPEED_PX_PER_STEP = 1.5;

/**
 * 引擎中立 Render Snapshot 几何辅助（Queue F-02M-B17B-A2）：
 * 仅用 PlanckWorld 公开读取接口（getPosition / getAngle）+ resolved/def/config
 * 实算真实世界几何，不读取任何 native fixture、不引入 native escape hatch、
 * 不修改任何物理状态。
 */

/** 本地向量旋转（px；与 planckVehicleAssembly.rotateLocal 同语义） */
function rotateLocal(p: { x: number; y: number }, angle: number): { x: number; y: number } {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos };
}

/** facing=-1 镜像 collider（与 planckVehicleAssembly.mirrorCollider 同逻辑；快照只读，不改物理状态） */
function mirrorCollider(c: ColliderDef): ColliderDef {
  const m: ColliderDef = { ...c, offset: { x: -c.offset.x, y: c.offset.y } };
  if (c.angle !== undefined) m.angle = -c.angle;
  if (c.shape === 'polygon' && c.vertices) {
    m.vertices = [...c.vertices].reverse().map((v) => ({ x: -v.x, y: v.y }));
  }
  return m;
}

/** ColliderDef → 世界坐标多边形顶点（box/polygon 直接转；circle 生成 28 边形兜底，
 *  当前内容 chassis/part 均为 box/polygon，无近似损失） */
function worldPointsOfCollider(
  c: ColliderDef,
  facing: 1 | -1,
  bodyPos: { x: number; y: number },
  bodyAngle: number,
): RenderVec2[] {
  const eff = facing === -1 ? mirrorCollider(c) : c;
  const ca = bodyAngle + (eff.angle ?? 0);
  const off = eff.offset ?? { x: 0, y: 0 };
  const offW = rotateLocal(off, bodyAngle);
  const cx = bodyPos.x + offW.x;
  const cy = bodyPos.y + offW.y;
  let local: { x: number; y: number }[];
  if (eff.shape === 'box') {
    const w = eff.width ?? 0;
    const h = eff.height ?? 0;
    local = [
      { x: -w / 2, y: -h / 2 },
      { x: w / 2, y: -h / 2 },
      { x: w / 2, y: h / 2 },
      { x: -w / 2, y: h / 2 },
    ];
  } else if (eff.shape === 'polygon') {
    local = eff.vertices ?? [];
  } else {
    // circle：28 边形近似（仅兜底；当前内容 chassis/part 均为 box/polygon）
    const r = eff.radius ?? 0;
    const n = 28;
    local = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      local.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
    }
  }
  return local.map((v) => {
    const r = rotateLocal(v, ca);
    return { x: cx + r.x, y: cy + r.y };
  });
}

/** ColliderDef → 引擎中立 RenderShape（circle 保留为真实圆；box/polygon 为多边形） */
function worldShapeOfCollider(
  c: ColliderDef,
  facing: 1 | -1,
  bodyPos: { x: number; y: number },
  bodyAngle: number,
): RenderShape {
  const eff = facing === -1 ? mirrorCollider(c) : c;
  const ca = bodyAngle + (eff.angle ?? 0);
  const off = eff.offset ?? { x: 0, y: 0 };
  const offW = rotateLocal(off, bodyAngle);
  const cx = bodyPos.x + offW.x;
  const cy = bodyPos.y + offW.y;
  if (eff.shape === 'circle') {
    return { kind: 'circle', circle: { center: { x: cx, y: cy }, radius: eff.radius ?? 0, angle: ca } };
  }
  let local: { x: number; y: number }[];
  if (eff.shape === 'box') {
    const w = eff.width ?? 0;
    const h = eff.height ?? 0;
    local = [
      { x: -w / 2, y: -h / 2 },
      { x: w / 2, y: -h / 2 },
      { x: w / 2, y: h / 2 },
      { x: -w / 2, y: h / 2 },
    ];
  } else {
    local = eff.vertices ?? [];
  }
  const points = local.map((v) => {
    const r = rotateLocal(v, ca);
    return { x: cx + r.x, y: cy + r.y };
  });
  return { kind: 'polygons', polygons: [{ points }] };
}

/** 轴对齐/旋转矩形 → 世界坐标 4 角点（静态/运动学墙体 angle=0 时为精确几何，非 AABB 近似） */
function boxWorldPoints(
  center: { x: number; y: number },
  angle: number,
  hw: number,
  hh: number,
): RenderVec2[] {
  const corners = [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ];
  return corners.map((v) => {
    const r = rotateLocal(v, angle);
    return { x: center.x + r.x, y: center.y + r.y };
  });
}

export class PlanckBattleOrchestrator {
  readonly world: PlanckWorld;
  readonly arena: PlanckArenaRuntime;
  readonly vehicleA: PlanckVehicle;
  readonly vehicleB: PlanckVehicle;
  readonly router: ContactRouter;
  readonly damageResolver: DamageResolver;
  readonly bus = new CombatEventBus();
  readonly config: BattleConfig;

  /** Cannon Behavior 实例（每 cannon part 一个，Q02-C1A；不新增生命周期） */
  private readonly cannons: Array<{
    vehicle: PlanckVehicle;
    part: PlanckPartRuntime;
    behavior: CannonBehavior;
  }> = [];

  /** Hammer Behavior 实例（每 hammer part 一个，Q03-C1；同一 onBeforeStep 插入口） */
  private readonly hammers: Array<{
    vehicle: PlanckVehicle;
    part: PlanckPartRuntime;
    behavior: HammerBehavior;
  }> = [];

  /** Push Rod Behavior 实例（每 pushRod part 一个，Q04-C1；同一 onBeforeStep 插入口） */
  private readonly pushRods: Array<{
    vehicle: PlanckVehicle;
    part: PlanckPartRuntime;
    behavior: PushRodBehavior;
  }> = [];

  private _result: BattleResult | null = null;
  private time = 0;

  constructor(
    buildA: BuildSnapshot,
    buildB: BuildSnapshot,
    registry: ContentRegistry,
    config: BattleConfig = {},
  ) {
    this.config = config;
    // Canonical Planck 重力（m/s²）：与既有 Planck 测试/运行时一致（y=10），
    // 保证车辆真实贴地、轮子接地驱动（禁止 0 重力假悬浮）。
    this.world = new PlanckWorld({ x: 0, y: 10 });

    const resolvedA = resolveSnapshot(buildA, registry);
    const resolvedB = resolveSnapshot(buildB, registry);

    // 先建 Arena（需要 groundBody 做落地沉降）
    this.arena = new PlanckArenaRuntime(this.world, config.arena);

    const spawnA = config.spawnA ?? { x: 400, y: 640, facing: 1 };
    const spawnB = config.spawnB ?? { x: 1200, y: 640, facing: -1 };

    this.vehicleA = createPlanckVehicle(
      this.world,
      resolvedA,
      'A',
      { x: spawnA.x, y: spawnA.y },
      spawnA.facing ?? 1,
    );
    this.vehicleB = createPlanckVehicle(
      this.world,
      resolvedB,
      'B',
      { x: spawnB.x, y: spawnB.y },
      spawnB.facing ?? -1,
    );

    // 落地沉降：默认按轮径差摆正静止姿态再贴地，消除初始下落导致的 Reset 非确定性。
    if (config.settleToGround !== false) {
      settlePlanckVehicleToRestPose(this.world, this.vehicleA, this.arena.ground);
      settlePlanckVehicleToRestPose(this.world, this.vehicleB, this.arena.ground);
    }

    // Cannon Behavior（Q02-C1A）：为每辆车上每个 cannon part 建独立冷却实例
    for (const vehicle of [this.vehicleA, this.vehicleB]) {
      for (const part of vehicle.parts) {
        if (part.def.behavior === 'cannon') {
          this.cannons.push({ vehicle, part, behavior: new CannonBehavior(part) });
        }
      }
    }

    // Hammer Behavior（Q03-C1）：为每辆车上每个 hammer part 建独立摆锤状态机
    for (const vehicle of [this.vehicleA, this.vehicleB]) {
      for (const part of vehicle.parts) {
        if (part.def.behavior === 'hammer') {
          this.hammers.push({ vehicle, part, behavior: new HammerBehavior(part) });
        }
      }
    }

    // Push Rod Behavior（Q04-C1）：为每辆车上每个 pushRod part 建独立伸缩状态机
    for (const vehicle of [this.vehicleA, this.vehicleB]) {
      for (const part of vehicle.parts) {
        if (part.def.behavior === 'pushRod') {
          this.pushRods.push({ vehicle, part, behavior: new PushRodBehavior(part) });
        }
      }
    }

    this.damageResolver = new DamageResolver(this.bus);
    this.router = new ContactRouter(
      [this.vehicleA, this.vehicleB],
      this.damageResolver,
      { ...DEFAULT_IMPACT_CONFIG, ...config.impact },
    );

    // 只注册一次批次监听（禁止同时注册即时监听，避免即时/批次双投递造成重复伤害）。
    this.world.setBatchedContactListener((ev) =>
      this.router.handlePlanckContact(this.world, ev),
    );
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
   * - Drive 必须在每个 FIXED_DT 的 world.step 之前执行（通过 onBeforeStep），
   *   使驱动力在每个物理步内被引擎消费，保证帧率无关。
   * - 战斗时间按「实际执行的 Fixed Steps」推进（steps * FIXED_DT_MS），
   *   不按渲染帧 realDtMs 直接累计。
   * - A 朝 +X、B 朝 -X（各自 worldDirection），由 autoDrive 语义门控。
   */
  step(realDtMs: number, timeScale = 1): void {
    if (this._result) return;

    const steps = this.world.step(realDtMs, timeScale, () => {
      // 车辆驱动（自动战斗：A 朝 +X、B 朝 -X）
      if (this.config.autoDrive !== false) {
        drivePlanckVehicle(this.world, this.vehicleA, {
          enabled: true,
          worldDirection: 1,
          targetSpeedPxPerStep: AUTO_DRIVE_TARGET_SPEED_PX_PER_STEP,
        });
        drivePlanckVehicle(this.world, this.vehicleB, {
          enabled: true,
          worldDirection: -1,
          targetSpeedPxPerStep: AUTO_DRIVE_TARGET_SPEED_PX_PER_STEP,
        });
      }
      // 正式 Behavior 插入口（Q02-C1A / Q03-C1 / Q04-C1）：Cannon 固定冷却真实发射 + recoil；
      // Hammer 摆锤循环；Push Rod 伸缩循环（均 motor + limit）。不新增第二套 step/render
      // 生命周期——只在此 onBeforeStep 内调用。
      for (const c of this.cannons) {
        c.behavior.stepFixed(this.world, c.vehicle, c.part);
      }
      for (const h of this.hammers) {
        h.behavior.stepFixed(this.world, h.vehicle, h.part);
      }
      for (const p of this.pushRods) {
        p.behavior.stepFixed(this.world, p.vehicle, p.part);
      }
    });

    // Q02-C1B：Projectile Lifecycle——每个物理步结束后（world.step 已返回，World 未锁定）：
    // 1) 只 drain 一次 ContactRouter 的 projectile facts，交给各 CannonBehavior 消费
    //    （hostile vehicle / arena / ground / hazard 的真实 begin → 安全销毁，伤害只发生一次）；
    const facts = this.router.drainProjectileContactFacts();
    if (facts.length > 0) {
      for (const c of this.cannons) {
        c.behavior.consumeProjectileFacts(this.world, facts);
      }
    }
    // 2) 存活 projectile 越界检查（arena.isOutOfProjectileBounds）：越界 → 销毁；
    //    未接触且未越界 → 保持存活继续真实飞行。
    for (const c of this.cannons) {
      for (const p of c.behavior.aliveProjectiles) {
        if (this.arena.isOutOfProjectileBounds(this.world.getPosition(p))) {
          c.behavior.destroyProjectile(this.world, p);
        }
      }
    }

    this.time += steps * FIXED_DT_MS;

    this.arena.update(steps * FIXED_DT_MS);

    this.detectEnd();
  }

  /** HP 死亡检测 → Result（B14B：委托引擎中立 resolveBattleResult，判定语义不变） */
  private detectEnd(): void {
    this._result = resolveBattleResult(this.arena.phase, this.vehicleA.hp, this.vehicleB.hp);
  }

  /** 订阅 Combat Event（Renderer 消费） */
  onCombatEvent(fn: (ev: CombatEvent) => void): () => void {
    return this.bus.subscribe(fn);
  }

  /**
   * 引擎中立 Render Snapshot（Queue F-02M-B17B-A2）：
   * 用 PlanckWorld 公开读取接口（getPosition / getAngle）+ resolved/def/config
   * 实算真实世界几何，供正式 Renderer 消费，不依赖 Matter Body/Vehicle/adapter。
   * 纯读取：不 step、不改 Body、不动 HP/phase/contact/arena，无物理或 Gameplay 副作用。
   */
  getRenderSnapshot(): BattleRenderSnapshot {
    return {
      arena: this.buildArenaSnapshot(),
      vehicleA: this.buildVehicleSnapshot(this.vehicleA),
      vehicleB: this.buildVehicleSnapshot(this.vehicleB),
      projectiles: this.buildProjectilesSnapshot(),
    };
  }

  /**
   * 存活 projectile 渲染快照（Q02-C3A）：
   * - 聚合所有 CannonBehavior 的 aliveProjectiles（已销毁的不在其中，自动不进入快照）；
   * - center 取真实 body 世界位置；
   * - radius 取真实碰撞几何（circle 的几何 AABB 半宽 = 半径，getBounds 对 circle 不扣 skin）；
   * - team 取 projectile OwnerTag；无归属（不应发生）则跳过；
   * - 仅输出世界坐标 circle + team，不出现任何引擎类型。
   */
  private buildProjectilesSnapshot(): RenderProjectile[] {
    const out: RenderProjectile[] = [];
    for (const c of this.cannons) {
      for (const p of c.behavior.aliveProjectiles) {
        const tag = this.world.getOwnerTag(p);
        if (!tag || !tag.team) continue; // 已销毁 / 无归属：不进入快照
        const bounds = this.world.getBounds(p);
        out.push({
          center: this.world.getPosition(p),
          radius: (bounds.maxX - bounds.minX) / 2,
          team: tag.team,
        });
      }
    }
    return out;
  }

  private buildVehicleSnapshot(vehicle: PlanckVehicle): RenderVehicle {
    const bPos = this.world.getPosition(vehicle.body);
    const bAng = this.world.getAngle(vehicle.body);
    const body: RenderShape = {
      kind: 'polygons',
      polygons: vehicle.resolved.body.colliders.map((c) => ({
        points: worldPointsOfCollider(c, vehicle.facing, bPos, bAng),
      })),
    };
    const wheels: RenderCircle[] = vehicle.wheels.map((w) => ({
      center: this.world.getPosition(w.body),
      radius: w.def.radius,
      angle: this.world.getAngle(w.body),
    }));
    const parts: RenderFunctionalPart[] = vehicle.parts.map((p) => ({
      shape: worldShapeOfCollider(
        p.def.collider,
        vehicle.facing,
        this.world.getPosition(p.body),
        this.world.getAngle(p.body),
      ),
      category: p.def.category,
    }));
    return { team: vehicle.team, body, wheels, parts };
  }

  private buildArenaSnapshot(): RenderArena {
    const cfg = this.arena.config;
    const normalWalls: RenderShape[] = [this.arena.leftWall, this.arena.rightWall].map((w) => ({
      kind: 'polygons',
      polygons: [
        {
          points: boxWorldPoints(
            this.world.getPosition(w),
            this.world.getAngle(w),
            cfg.wallThickness / 2,
            cfg.height / 2,
          ),
        },
      ],
    }));
    const closingWalls: RenderShape[] = this.arena.closingWalls.map((cw) => ({
      kind: 'polygons',
      polygons: [
        {
          points: boxWorldPoints(
            this.world.getPosition(cw.body),
            this.world.getAngle(cw.body),
            cfg.wallThickness / 2,
            cfg.height / 4,
          ),
        },
      ],
    }));
    return { width: cfg.width, groundY: cfg.groundY, normalWalls, closingWalls };
  }

  /** 销毁（释放物理世界，供 Lab Reset / Clear 重建） */
  dispose(): void {
    // PlanckWorld 无显式销毁；丢弃引用即可（GC 回收 world 与 body）
  }
}
