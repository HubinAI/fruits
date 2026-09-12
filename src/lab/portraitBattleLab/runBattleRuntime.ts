/**
 * PRP-R5-RESTORE-LEGACY-BATTLE-CAMERA｜Run Page 的真实战斗运行时适配 + **正式 Battle Camera** 接入。
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
 *      PRP **不**覆盖以上任何一项（Queue 必改 1/3）。
 *
 *   3) 相机 = **正式 `Renderer` 的 battle 相机链**：`reframe(snap,'battle',{phase})`
 *      → `battleCam` → 逐帧 `applyBattleFollow`。PRP **不写第二套镜头**：
 *        - scale 由正式三段动态取景公式给出（远端 0.87 / 接近 0.75 / 碰撞 0.60 × 安全宽，
 *          由**真实世界间距比例** `gapWorld/coreUnionW` 驱动），不是固定常数；
 *        - 位置由正式 `applyBattleFollow` 追踪双方中点 + 分离有限拉远（≤ baseScale）；
 *        - ❌ 无 PRP 专属镜头规则：不按炮弹 zoom / 不按碰撞 zoom / 无震屏 / 无 kill zoom /
 *          无 cinematic。
 *      ⚠️ **为什么逐帧 `reframe`**：正式 `Renderer` 的 battle 分支自述「Active 每帧按 A∪B
 *        真实 bounds 计算目标 scale」，正式相机测试（`tests/battleDynamicFramingR21.test.ts`）
 *        的调用口径同样是每帧；正式运行时只在阶段切换构图（接线缺环），使三段动态取景在横屏里
 *        长期休眠。PRP 舞台带只有 390 逻辑宽，必须让正式动态取景真正生效，物理反馈
 *        （弹丸飞行 / 后坐 / 接敌 / 碰撞）才重新进入可感知尺度。
 *
 *   4) **viewport adapter**（唯一为 band 做的适配，相机算法一行不改）：正式相机在
 *      「安全区」内构图（非 compact battle = insetX **56** / insetTop **28** / insetBottom **28**）。
 *      PRP 舞台带没有 HUD、整条带都是对焦区 → 离屏视口取「带 + inset」（502×358），
 *      使**正式安全区恰好等于舞台带**，合成时只裁安全区那一块贴到带上（见 `RUN_BATTLE_VIEW_*`）。
 *
 * ⚠️ 本文件**不写任何战斗数值**：HP / 伤害 / CD / 射速 / 质量 / 后坐全部由正式链路解析。
 * ⚠️ 「PRP 侧被改过的 gameplay」在本适配里**不存在** —— 因为 PRP 此前根本没有战斗
 *    （旧 `RUN_BATTLE_SCRIPT` 只是 90 步线性 HP 插值 + `sin` 位移动画，已删除）。
 */

import { registry } from '../../core/content';
import type { BattleRenderSnapshot, BattleResult } from '../../battle/battleContract';
import { PlanckBattleOrchestrator } from '../../battle/planckBattleOrchestrator';
import { buildSpawnPlan, type SpawnPlan } from './entities';
import { RUN_STAGE_BAND } from './runPageLayout';
import { RUN_DEMO_ENCOUNTER_ID, RUN_DEMO_LOADOUT_ID } from './runPageScene';

/** 本局演示组合（与 F1 共享测试数据同源；不改 Debug 选择项）。 */
export const RUN_BATTLE_LOADOUT_ID = RUN_DEMO_LOADOUT_ID;
export const RUN_BATTLE_ENCOUNTER_ID = RUN_DEMO_ENCOUNTER_ID;

/* ------------------------------------------------- viewport adapter 几何 */

/**
 * 正式 battle 相机在非 compact 视口使用的 inset（logical px）——与 `src/render/renderer.ts`
 * 的 `SAFE_INSET_X = 56` / `SAFE_INSET_Y = 28` 同值。
 *
 * ⚠️ 这是**只读的几何契约**，不是可调参数：改这里就必须同步核对 renderer 的 inset 常量
 * （`tests/portraitRunBattle.test.ts` 有机器判据把「安全区 == 舞台带」钉住）。
 */
export const RUN_BATTLE_VIEW_INSET = { x: 56, y: 28 } as const;

/**
 * 离屏战斗视口尺寸 = 舞台带 + 正式 inset × 2。
 *
 * `isCompactLandscape(502, 358)` = false（aspect 1.402 < 1.5）→ 正式相机走
 * 「非 compact」分支 → `insetX 56 / insetTop 28 / insetBottom 28` →
 * **安全区 = (56,28,390,302) == 舞台带**。
 */
export const RUN_BATTLE_VIEW_W = RUN_STAGE_BAND.w + RUN_BATTLE_VIEW_INSET.x * 2;
export const RUN_BATTLE_VIEW_H = RUN_STAGE_BAND.h + RUN_BATTLE_VIEW_INSET.y * 2;

/**
 * 相机实时状态（每帧由正式 `reframe` + `applyBattleFollow` 写入）。
 * 全部为**离屏画布坐标**；换算到舞台带需减去 `cropX/cropY`。
 */
export interface RunBattleXform {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  /** 离屏画布 → 舞台带的裁剪原点（= 正式 inset）。 */
  readonly cropX: number;
  readonly cropY: number;
}

/** 世界坐标 → 舞台带逻辑坐标（渲染与 probe 同源，不出现第二套换算）。 */
export function battleBandX(x: RunBattleXform, worldX: number): number {
  return x.offsetX + worldX * x.scale - x.cropX;
}
export function battleBandY(x: RunBattleXform, worldY: number): number {
  return x.offsetY + worldY * x.scale - x.cropY;
}

/** 地面线在舞台带内的 y（逻辑 px）。 */
export function battleGroundBandY(x: RunBattleXform, groundY: number): number {
  return battleBandY(x, groundY);
}

/**
 * 是否在本帧调用正式 `reframe` —— 正式口径（**不自创规则**）：
 *
 *   - `Active`：**每帧**（正式 `Renderer` battle 分支自述「Active 每帧」，正式相机测试
 *     `battleDynamicFramingR21.test.ts` 同源调用）→ 三段动态取景真正生效；
 *   - 其它阶段（Warning / Closing / End）：**只在阶段切换那一帧**（正式运行时
 *     `pollArenaPhase` 的语义）→ 之后交给逐帧 `applyBattleFollow` 平滑收敛。
 *
 * ⚠️ 为什么非 Active 不能每帧 reframe：非 Active 分支只做「相对基准 ±10% 钳制」，
 *    每帧重复施加会与逐帧 `applyBattleFollow` 互相拉扯（0.4%/帧 抖动）——
 *    既不是正式行为，也会破坏「RESULT 战场冻结」这一既有不变量。
 */
export function shouldReframeBattleCamera(phase: string, lastPhase: string | null): boolean {
  return phase !== lastPhase || phase === 'Active';
}

/**
 * 舞台带内**实际可见**的世界水平范围。
 *
 * ⚠️ 这是「相机不再是完整世界远摄」的直接证据：PRP-R5 之前固定 `scale = 390/1600`
 * → 可见宽恒为 1600（整世界）；现在由正式动态取景决定，开局约 **1178**（≈ 世界的 74%），
 * 碰撞期进一步收窄到 ≈ 500。
 */
export function battleVisibleWorld(
  x: RunBattleXform,
  bandW: number = RUN_STAGE_BAND.w,
): { minX: number; maxX: number; width: number } {
  const minX = (x.cropX - x.offsetX) / x.scale;
  const maxX = (x.cropX + bandW - x.offsetX) / x.scale;
  return { minX, maxX, width: maxX - minX };
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
