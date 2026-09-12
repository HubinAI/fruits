/**
 * PRP-F1-PORTRAIT-PLANCK-BATTLE-INTEGRATION｜Run Page 的真实战斗运行时适配 + 固定远摄相机。
 *
 * 本文件的**唯一职责**：把**旧正式左右侧视 Planck 战斗**接到 Run Page 中部舞台上，
 * 而**不重新定义任何 gameplay 语义**。因此：
 *
 *   1) 战斗世界 = 正式 `PlanckBattleOrchestrator`（与正式 Battle 同一套类，不是第二套实现）；
 *   2) 构造时**不传任何 config**（空对象）→ 世界尺度 / 出生点 / 地面 / 移动 / 武器 /
 *      弹丸 / 后坐 / 碰撞 / 阶段全部取正式默认值：
 *        - `DEFAULT_ARENA_CONFIG`：width **1600** / height 900 / groundY **700** /
 *          wallThickness 60 / phases Active 10s · Warning 3s · Closing 5s / closingSpeed 3；
 *        - `spawnA {x:400, y:640, facing:1}` / `spawnB {x:1200, y:640, facing:-1}`
 *          → 出生中心距 **800 世界 px**；
 *        - `autoDrive` 默认开（A 朝 +X、B 朝 −X），Cannon 行为按正式 cooldownMs 自动开火；
 *        - gravity `{x:0, y:10}`（真实贴地，禁止 0 重力假悬浮）。
 *      PRP **不**覆盖以上任何一项；「PRP 只能做 camera transform」（Queue 必改 1）。
 *
 *   3) 相机 = **固定远摄**：`scale = 舞台带宽 / arena 宽`，地面线锚定在舞台带的
 *      `RUN_BATTLE_GROUND_FRAC`，偏移与**实时位置无关** → 结构上不可能「追踪 / 动态 zoom」。
 *      取景覆盖**完整旧 Battle 世界**（0..1600 全宽，含两侧墙与收束刺墙）：
 *      实测收束阶段玩家车会被推到 x≈86（远小于开局外廓左缘 310），
 *      因此任何「只框开局交战段」的固定取景都会在收束阶段把车裁出画面。
 *
 * ⚠️ 本文件**不写任何战斗数值**：HP / 伤害 / CD / 射速 / 质量 / 后坐全部由正式链路解析。
 * ⚠️ 「PRP 侧被改过的 gameplay」在本适配里**不存在** —— 因为 PRP 此前根本没有战斗
 *    （旧 `RUN_BATTLE_SCRIPT` 只是 90 步线性 HP 插值 + `sin` 位移动画，已删除）。
 */

import { registry } from '../../core/content';
import { DEFAULT_ARENA_CONFIG } from '../../battle/arenaConfig';
import type { BattleRenderSnapshot, BattleResult } from '../../battle/battleContract';
import { PlanckBattleOrchestrator } from '../../battle/planckBattleOrchestrator';
import { buildSpawnPlan, type SpawnPlan } from './entities';
import { RUN_STAGE_BAND } from './runPageLayout';
import { RUN_DEMO_ENCOUNTER_ID, RUN_DEMO_LOADOUT_ID } from './runPageScene';

/** 本局演示组合（与 F1 共享测试数据同源；不改 Debug 选择项）。 */
export const RUN_BATTLE_LOADOUT_ID = RUN_DEMO_LOADOUT_ID;
export const RUN_BATTLE_ENCOUNTER_ID = RUN_DEMO_ENCOUNTER_ID;

/**
 * 地面线在舞台带内的高度占比。
 * 取正式 battle 相机的同一语义（`BATTLE_STAGE_GROUND_MAX = 0.72`：地面下留 ~28% 场景带，
 * 地面线不贴底、上方空间全部留给弹道与击飞）。
 */
export const RUN_BATTLE_GROUND_FRAC = 0.72;

/** 固定相机（纯几何，只由「舞台带 + 正式 arena 尺寸」决定）。 */
export interface RunBattleCamera {
  /** 世界 px → 视图逻辑 px 的统一缩放（= viewW / arena.width）。 */
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly viewW: number;
  readonly viewH: number;
  /** 正式 arena 世界宽（1600）——**不是**舞台带宽（390）。 */
  readonly worldW: number;
  readonly worldH: number;
  readonly groundY: number;
  /** 地面线在视图内的 y（逻辑 px）。 */
  readonly groundScreenY: number;
}

/**
 * 固定远摄相机。
 *
 * ⚠️ 这是「Camera 拉远，而不是压缩 Gameplay」的落点：世界宽仍是 1600，
 * 变的是显示层缩放（390/1600 = 0.24375）。四个带 / 世界尺度 / 出生距离一个都没动。
 */
export function runBattleCamera(
  viewW: number = RUN_STAGE_BAND.w,
  viewH: number = RUN_STAGE_BAND.h,
): RunBattleCamera {
  const worldW = DEFAULT_ARENA_CONFIG.width;
  const scale = viewW / worldW;
  const groundScreenY = viewH * RUN_BATTLE_GROUND_FRAC;
  return {
    scale,
    offsetX: 0,
    offsetY: groundScreenY - DEFAULT_ARENA_CONFIG.groundY * scale,
    viewW,
    viewH,
    worldW,
    worldH: DEFAULT_ARENA_CONFIG.height,
    groundY: DEFAULT_ARENA_CONFIG.groundY,
    groundScreenY,
  };
}

/** 世界坐标 → 战斗视图逻辑坐标（与相机同源；渲染与 probe 共用，不出现第二套换算）。 */
export function battleViewX(cam: RunBattleCamera, worldX: number): number {
  return cam.offsetX + worldX * cam.scale;
}
export function battleViewY(cam: RunBattleCamera, worldY: number): number {
  return cam.offsetY + worldY * cam.scale;
}

/** 世界空间外接框。 */
export interface RunBattleBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/* --------------------------------------------- 快照 → 世界外接框（纯读取） */

function accBox(
  box: { minX: number; minY: number; maxX: number; maxY: number },
  x: number,
  y: number,
): void {
  if (x < box.minX) box.minX = x;
  if (x > box.maxX) box.maxX = x;
  if (y < box.minY) box.minY = y;
  if (y > box.maxY) box.maxY = y;
}

function accShape(box: { minX: number; minY: number; maxX: number; maxY: number }, shape: unknown): void {
  const s = shape as
    | { kind: 'polygons'; polygons: readonly { points: readonly { x: number; y: number }[] }[] }
    | { kind: 'circle'; circle: { center: { x: number; y: number }; radius: number } };
  if (s.kind === 'polygons') {
    for (const poly of s.polygons) for (const p of poly.points) accBox(box, p.x, p.y);
  } else {
    accBox(box, s.circle.center.x - s.circle.radius, s.circle.center.y - s.circle.radius);
    accBox(box, s.circle.center.x + s.circle.radius, s.circle.center.y + s.circle.radius);
  }
}

function accVisual(box: { minX: number; minY: number; maxX: number; maxY: number }, v: unknown): void {
  const x = v as {
    position: { x: number; y: number };
    rotation: number;
    size: { width: number; height: number };
  };
  const hw = x.size.width / 2;
  const hh = x.size.height / 2;
  const cos = Math.cos(x.rotation);
  const sin = Math.sin(x.rotation);
  for (const c of [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ]) {
    accBox(box, c.x * cos - c.y * sin + x.position.x, c.x * sin + c.y * cos + x.position.y);
  }
}

/**
 * 一辆车的**真实可见外接框**（body + wheel + part + visual）。
 *
 * ⚠️ 口径与正式 battle 相机 `reframe` 的 `includeVehicle` 完全一致 ——
 * 「完整入画」的标准是玩家真正看到的 Visual 完整入画，不是仅 Collider。
 */
export function vehicleWorldBox(snap: BattleRenderSnapshot, team: 'A' | 'B'): RunBattleBox {
  const v = team === 'A' ? snap.vehicleA : snap.vehicleB;
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  accShape(box, v.body);
  if (v.bodyVisual) accVisual(box, v.bodyVisual);
  for (const w of v.wheels) {
    accBox(box, w.center.x - w.radius, w.center.y - w.radius);
    accBox(box, w.center.x + w.radius, w.center.y + w.radius);
  }
  for (const wv of v.wheelVisuals ?? []) if (wv) accVisual(box, wv);
  for (const p of v.parts) {
    accShape(box, p.shape);
    if (p.visual) accVisual(box, p.visual);
  }
  return box;
}

/* ------------------------------------------------------------ 运行时 */

export interface RunBattleHp {
  readonly a: number;
  readonly aMax: number;
  readonly b: number;
  readonly bMax: number;
}

/**
 * Run Page 战斗运行时：正式 `PlanckBattleOrchestrator` 的**薄适配**（无反推、无插值）。
 *
 * 生命周期接入 = 本类的全部新增语义；除此之外的一切（世界 / 出生 / 驱动 / 武器 /
 * 弹丸 / 后坐 / 碰撞 / 伤害 / 阶段 / 结果）都是正式的。
 */
export class RunBattleRuntime {
  readonly plan: SpawnPlan;
  readonly orchestrator: PlanckBattleOrchestrator;
  /** 真实出生中心 x（构造后实测，不是写死数字）。 */
  readonly spawnAx: number;
  readonly spawnBx: number;
  /** 累计推进的正式物理步数（由 `timeMs / FIXED_DT` 派生，供证据链）。 */
  private steps = 0;

  constructor(soloA = false) {
    this.plan = buildSpawnPlan(RUN_BATTLE_LOADOUT_ID, RUN_BATTLE_ENCOUNTER_ID);
    // ⚠️ 空 config：世界尺度 / 出生点 / 阶段全部取正式默认值（PRP 零覆盖）。
    this.orchestrator = new PlanckBattleOrchestrator(
      this.plan.player.snapshot,
      this.plan.enemies[0].snapshot,
      registry,
      {},
      soloA,
    );
    const w = this.orchestrator.world;
    this.spawnAx = w.getPosition(this.orchestrator.vehicleA.body).x;
    this.spawnBx = w.getPosition(this.orchestrator.vehicleB.body).x;
  }

  /** 出生中心距（世界 px）——必须等于正式 800。 */
  get spawnSeparation(): number {
    return Math.abs(this.spawnBx - this.spawnAx);
  }

  get arenaWidth(): number {
    return this.orchestrator.arena.config.width;
  }

  get arenaHeight(): number {
    return this.orchestrator.arena.config.height;
  }

  get groundY(): number {
    return this.orchestrator.arena.config.groundY;
  }

  get result(): BattleResult | null {
    return this.orchestrator.result;
  }

  get phase(): string {
    return this.orchestrator.phase;
  }

  get timeMs(): number {
    return this.orchestrator.timeMs;
  }

  get stepCount(): number {
    return this.steps;
  }

  /** 推进一帧（真实时间 → 内部固定步；与正式 Battle 同一条 `world.step` 语义）。 */
  step(realDtMs: number): void {
    if (realDtMs <= 0) return;
    const before = this.orchestrator.timeMs;
    this.orchestrator.step(realDtMs, 1);
    if (this.orchestrator.timeMs > before) {
      this.steps += 1;
    }
  }

  snapshot(): BattleRenderSnapshot {
    return this.orchestrator.getRenderSnapshot();
  }

  /** 车辆中心世界坐标。 */
  vehicleX(team: 'A' | 'B'): number {
    const v = team === 'A' ? this.orchestrator.vehicleA : this.orchestrator.vehicleB;
    return this.orchestrator.world.getPosition(v.body).x;
  }

  /** 车辆真实可见外接框（世界 px）。 */
  vehicleBox(team: 'A' | 'B'): RunBattleBox {
    return vehicleWorldBox(this.snapshot(), team);
  }

  /** 两车外廓世界间距（>0 = 完全分离）。 */
  gapWorld(): number {
    const a = this.vehicleBox('A');
    const b = this.vehicleBox('B');
    return b.minX - a.maxX;
  }

  hp(): RunBattleHp {
    const o = this.orchestrator;
    return { a: o.vehicleA.hp, aMax: o.vehicleA.maxHp, b: o.vehicleB.hp, bMax: o.vehicleB.maxHp };
  }

  /** 当前存活弹丸（真实 projectile 渲染快照，非预测）。 */
  projectileCount(): number {
    return this.snapshot().projectiles?.length ?? 0;
  }

  dispose(): void {
    this.orchestrator.dispose();
  }
}
