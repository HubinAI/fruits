/**
 * PRP-F0-RUN-PAGE-SHELL｜PRP-R3-CAPYBARA-UI-HIERARCHY-REBUILD
 * Run Page 中部侧视舞台的**待机近景**组装（纯函数 + 只读数据，无 DOM / 无 Canvas）。
 *
 * ⚠️ PRP-F1-PORTRAIT-PLANCK-BATTLE-INTEGRATION：本文件现在的职责**只剩 IDLE 待机近景**——
 *   - IDLE（还没遭遇）：PRP 自有的近景舞台（真实 sprite 的两车摆位 → 本次只剩玩家一辆），
 *     保留 PRP-R3 已经通过的构图（车辆明显、视觉重心偏下、压在山脊上）；
 *   - EVENT / BATTLE / RESULT：舞台带改由**真实 Planck 战斗世界**占据
 *     （`runBattleView` 用正式 Renderer 渲染 + PRP 固定远摄相机贴图），
 *     本文件的摆位逻辑在这些 phase **完全不参与绘制**，因此不可能与真实战斗争位。
 *   这也是「遭遇即拉远」的镜头语言：近景待机 → 真实战场（相机 cut，不是逐帧追踪）。
 *
 * 三条来源纪律（不变）：
 *   1) 车辆外形**全部**来自正式定义：车身 / 轮组 / 部件的 `visual`（visualId + size +
 *      anchor + mirrorWithFacing），世界变换走正式纯函数 `visualWorldTransform`
 *      （与正式战斗 `planckBattleOrchestrator.buildVehicleSnapshot` **同一函数**）；
 *   2) 装载 / 遭遇是**固定**的一套演示数据（`RUN_DEMO_*`），指向 F1 共享测试数据，
 *      不新增数值、不随机、不接 Debug 选择项；
 *   3) 未提供 `visual` 的件（无 sprite 的部件）**整件不画**（见 `boxesOf`），
 *      绝不用纯色矩形冒充车辆外观。
 *
 * ⚠️ 车辆是正式 sprite（或真实几何降级），车身 / 部件从不进入面积账本（sprite 像素非纯色）。
 */

import { registry } from '../../core/content';
import { resolveSnapshot } from '../../core/buildSnapshot';
import { visualWorldTransform } from '../../battle/battleContract';
import { bodyOffsetBoxes } from './scene';
import { buildSpawnPlan, type SpawnPlan, type SpawnedEntity } from './entities';
import { findEncounter, findLoadout } from './testData';
import {
  placeSideViewVisuals,
  runActionBarRect,
  runBuffIconChip,
  runBuffIconRects,
  runChoiceBarRect,
  runChoiceCardRects,
  runDayNodes,
  runSideViewScale,
  runStageBaselineY,
  runStageGroundRect,
  runStageGroundY,
  runStageRoadRect,
  runVisualBounds,
  type RunLayeredRect,
  type RunPlacedGroup,
  type RunPlacedVisual,
  type RunRect,
  type RunVisualBox,
} from './runPageLayout';
import {
  runActionEnabled,
  runChoicePool,
  type RunPageContext,
  type RunPageState,
} from './runPageState';

/** 本 Queue 的固定演示装载（Debug 选择项不参与 Run Page）。 */
export const RUN_DEMO_LOADOUT_ID = 'WatermelonHeavyCannon';
export const RUN_DEMO_ENCOUNTER_ID = 'Chaser';

/** 玩家朝右、敌人朝左（侧视对峙的唯一朝向组合）。 */
export const RUN_PLAYER_FACING = 1 as const;
export const RUN_ENEMY_FACING = -1 as const;

let cachedPlan: SpawnPlan | null = null;

/** F1 共享测试数据的固定演示组合（构建一次并缓存；纯数据，无副作用）。 */
export function runDemoPlan(): SpawnPlan {
  if (!cachedPlan) cachedPlan = buildSpawnPlan(RUN_DEMO_LOADOUT_ID, RUN_DEMO_ENCOUNTER_ID);
  return cachedPlan;
}

/** Run Page 的状态机上下文（展示名与耐久上限都来自共享数据，不手写）。 */
export function runPageContext(plan: SpawnPlan = runDemoPlan()): RunPageContext {
  const loadout = findLoadout(RUN_DEMO_LOADOUT_ID);
  const encounter = findEncounter(RUN_DEMO_ENCOUNTER_ID);
  const enemy = plan.enemies[0];
  return {
    vehicleLabel: loadout ? loadout.label : plan.player.bodyName,
    encounterLabel: encounter ? encounter.label : enemy.bodyName,
    playerHpMax: plan.player.hp,
    enemyHpMax: enemy.hp,
  };
}

/* ------------------------------------------------- 正式视觉 → 可视件 */

interface EntityVisuals {
  readonly boxes: readonly RunVisualBox[];
  readonly mirrors: readonly boolean[];
  /** 全部可视件都有正式 sprite（= 真实车辆视觉），否则为 false（如实上报）。 */
  readonly allSprites: boolean;
}

const visualCache = new Map<string, EntityVisuals>();

function boxesOf(e: SpawnedEntity): EntityVisuals {
  const key = `${e.entityId}:${e.bodyDefId}`;
  const hit = visualCache.get(key);
  if (hit) return hit;

  const facing: 1 | -1 = e.team === 'player' ? RUN_PLAYER_FACING : RUN_ENEMY_FACING;
  const r = resolveSnapshot(e.snapshot, registry);
  const boxes: RunVisualBox[] = [];
  const mirrors: boolean[] = [];
  let allSprites = true;

  const push = (b: RunVisualBox, mirror: boolean): void => {
    boxes.push(b);
    mirrors.push(mirror);
    // 轮组不需要 sprite（正式 Renderer 同样程序化画轮，按真实半径圆绘制）；
    // 其余可视件必须带正式 visualId，否则就是「纯色矩形代表车辆」——本 Queue 明令禁止。
    if (b.kind !== 'wheel' && !b.visualId) allSprites = false;
  };

  // 1) 车身：正式 BodyDef.visual → 正式 visualWorldTransform（facing 镜像已烘焙）
  const bv = r.body.visual;
  if (bv) {
    const v = visualWorldTransform(bv, facing, { x: 0, y: 0 }, 0);
    push(
      { cx: v.position.x, cy: v.position.y, w: v.size.width, h: v.size.height, kind: 'body', visualId: v.visualId },
      v.mirror === true,
    );
  } else {
    // 降级：按真实 collider 外接框（镜像 x），不白屏
    const bb = bodyOffsetBoxes(e.bodyDefId);
    const minX = Math.min(...bb.map((b) => b.dx));
    const maxX = Math.max(...bb.map((b) => b.dx + b.w));
    const minY = Math.min(...bb.map((b) => b.dy));
    const maxY = Math.max(...bb.map((b) => b.dy + b.h));
    push(
      { cx: (facing * (minX + maxX)) / 2, cy: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY, kind: 'body' },
      false,
    );
  }

  // 2) 轮组：以真实半径 + 真实挂点绘制（圆形，面积非整数 → 不入账本）
  for (const m of r.movements) {
    const hp = r.body.movementHardpoints.find((h) => h.id === m.install.hardpointId);
    if (!hp) continue;
    const v = m.def.visual
      ? visualWorldTransform(m.def.visual, facing, { x: facing * hp.localPosition.x, y: hp.localPosition.y }, 0)
      : null;
    if (v) {
      push(
        { cx: v.position.x, cy: v.position.y, w: v.size.width, h: v.size.height, kind: 'wheel', visualId: v.visualId },
        v.mirror === true,
      );
    } else {
      const d = m.def.radius * 2;
      push({ cx: facing * hp.localPosition.x, cy: hp.localPosition.y, w: d, h: d, kind: 'wheel', defId: m.def.id }, false);
    }
  }

  // 3) 功能部件：正式 FunctionalPartDef.visual → 正式 visualWorldTransform。
  //    ⚠️ 没有正式 `visual` 的辅助件（例如推进器）**整件跳过**：宁可少画一个部件，
  //    也绝不用纯色矩形在玩家页面上冒充车辆外观（Queue 必改 2）。
  for (const f of r.functionals) {
    const hp = r.body.functionalHardpoints.find((h) => h.id === f.install.hardpointId);
    if (!hp) continue;
    if (!f.def.visual) continue;
    const v = visualWorldTransform(f.def.visual, facing, { x: facing * hp.localPosition.x, y: hp.localPosition.y }, 0);
    push(
      { cx: v.position.x, cy: v.position.y, w: v.size.width, h: v.size.height, kind: 'part', visualId: v.visualId },
      v.mirror === true,
    );
  }

  const out: EntityVisuals = { boxes, mirrors, allSprites: allSprites && boxes.length > 0 };
  visualCache.set(key, out);
  return out;
}

/**
 * 实体的可视件里**是否存在任何纯色矩形降级件**。
 *
 * ⚠️ PRP-R3 必改 2 的机器判据：轮组按**真实半径圆**绘制（正式 Renderer 也是程序化画轮，
 * 不算占位）；除此之外的件必须带正式 `visualId`（= 真实 sprite），
 * 否则就是「用纯色矩形代表车辆」。本函数为 true 时该实体**不得**出现在玩家页面上。
 */
export function hasPlaceholderVisual(e: SpawnedEntity): boolean {
  return boxesOf(e).boxes.some((b) => b.kind !== 'wheel' && !b.visualId);
}

/** 实体的真实视觉外接框宽度（未缩放）→ 供 `runSideViewScale` 使用。 */
export function entityVisualWidth(e: SpawnedEntity): number {
  return runVisualBounds(boxesOf(e).boxes).w;
}

/* ------------------------------------------------------- 待机近景舞台 */

export interface RunStageEntityView {
  readonly visuals: readonly RunPlacedVisual[];
  readonly bounds: RunRect;
}

/** 待机近景舞台（**只服务 IDLE**：还没遭遇，画面上只有玩家一辆车）。 */
export interface RunStageView {
  /** 显示缩放（只服务 IDLE 近景构图；与状态无关）。 */
  readonly scale: number;
  readonly groundY: number;
  readonly baselineY: number;
  readonly ground: RunRect;
  readonly road: RunRect;
  readonly player: RunStageEntityView;
}

interface BasePlacements {
  readonly scale: number;
  readonly baselineY: number;
  readonly player: RunPlacedGroup;
}

let cachedBase: BasePlacements | null = null;

/** 基础摆位（只依赖固定演示数据 → 只算一次）。 */
function basePlacements(): BasePlacements {
  if (cachedBase) return cachedBase;
  const plan = runDemoPlan();
  const enemyEntity = plan.enemies[0];
  const scale = runSideViewScale(entityVisualWidth(plan.player), entityVisualWidth(enemyEntity));
  const baselineY = runStageBaselineY();
  const p = boxesOf(plan.player);
  cachedBase = {
    scale,
    baselineY,
    player: placeSideViewVisuals(p.boxes, 'left', scale, baselineY, p.mirrors),
  };
  return cachedBase;
}

function toEntityView(g: RunPlacedGroup): RunStageEntityView {
  return { visuals: g.visuals, bounds: g.bounds };
}

/**
 * 待机近景舞台（唯一入口；渲染与测试共用）。
 *
 * ⚠️ PRP-F1：**只用于 IDLE**。EVENT / BATTLE / RESULT 的舞台带是真实战斗世界
 * （见 `runBattleView`），本函数在这些 phase 不参与绘制。
 */
export function buildRunStageView(): RunStageView {
  const base = basePlacements();
  return {
    scale: base.scale,
    groundY: runStageGroundY(),
    baselineY: base.baselineY,
    ground: runStageGroundRect(),
    road: runStageRoadRect(),
    player: toEntityView(base.player),
  };
}

/** 演示用的敌人实体（probe / 测试需要知道「遭遇的是谁」）。 */
export function runDemoEnemy(): SpawnedEntity {
  return runDemoPlan().enemies[0];
}

/**
 * 待机舞台里的「平涂面」入账层（地线 + 路面）。
 * ⚠️ PRP-R3：车辆改用正式 sprite → **不再有** playerBody / enemyBody 等纯色层。
 */
export function runStageLayers(view: RunStageView): RunLayeredRect[] {
  return [
    { layer: 'ground', rect: view.ground },
    { layer: 'road', rect: view.road },
  ];
}

/**
 * 一整帧的「纯色几何层」（绘制与面积账本共用的唯一来源）。
 *
 * 语义 = **画面上确实带着调色板精确色的像素**：
 *   - CHOICE 打开时整页被遮罩合成为新颜色 → 底层几何不再带精确色，本帧只登记浮层自身；
 *   - **EVENT / BATTLE / RESULT**：舞台带被真实战斗世界（离屏位图）占据 →
 *     地线 / 路面**不存在**，本帧不登记这两层；
 *   - 车辆是 sprite，本身不是纯色 → 从不入账；
 *   - 文本不属于任何层（中性灰蓝 + 抗锯齿 → 永不落入几何色）。
 */
export function runPageLayerShapes(state: RunPageState, view: RunStageView): RunLayeredRect[] {
  const out: RunLayeredRect[] = [];

  // 底部常驻层（CHOICE 遮罩下会被合成掉 → 不登记）
  if (state.phase !== 'CHOICE') {
    // 待机近景的地线 / 路面只在 IDLE 真实可见（其余 phase 被真实战场覆盖）
    if (state.phase === 'IDLE') out.push(...runStageLayers(view));

    // 顶部进度节点：已完成 = day 个
    runDayNodes(state.dayTotal).forEach((r, i) => {
      out.push({ layer: i < state.day ? 'nodeDone' : 'nodeTodo', rect: r });
    });

    // 顶部强化图标：**只登记实际已获得的数量**（0 个 = 完全没有这一行）
    runBuffIconRects(state.buffs.length).forEach((icon) => {
      out.push({ layer: 'buffIcon', rect: icon });
      out.push({ layer: 'buffChip', rect: runBuffIconChip(icon) });
    });

    // 最底唯一主动作：入账的是按钮底部的纯色强调条（**只在可用态登记**）
    if (runActionEnabled(state)) out.push({ layer: 'actionBar', rect: runActionBarRect() });
  }

  // CHOICE 浮层：卡片顶部强调条（不含文字、不被描边 / 图标覆盖）
  // ⚠️ PRP-BUILD-01：卡片数量取自**当前候选池**（第一层 / 第二层条件池），不是写死的第一层三项。
  if (state.phase === 'CHOICE') {
    for (const card of runChoiceCardRects(runChoicePool(state).length)) {
      out.push({ layer: 'cardBar', rect: runChoiceBarRect(card) });
    }
  }

  return out;
}
