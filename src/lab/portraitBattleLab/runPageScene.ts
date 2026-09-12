/**
 * PRP-F0-RUN-PAGE-SHELL｜Run Page 中部侧视舞台的场景组装（纯函数 + 只读数据）。
 *
 * 两条来源纪律（与 F1 一致）：
 *   1) 车辆外形**全部**来自正式 registry 的真实 collider 几何
 *      （`bodyOffsetBoxes` / `partOffsetBoxes`），本文件不写任何尺寸数字；
 *   2) 装载 / 遭遇是**固定**的一套演示数据（`RUN_DEMO_*`），指向 F1 共享测试数据，
 *      不新增数值、不随机、不接 Debug 选择项。
 *
 * 本 Queue 的舞台只做「最小侧视展示」：
 *   - 玩家固定视觉起点在左、敌人固定视觉起点在右（由 placeSideViewEntity 保证）；
 *   - 不绘制轮组（圆形 collider 的像素面积非整数，会破坏像素级精确断言 —— 与 F1 占位舞台同约定）；
 *   - 不接真实物理 / AI / 伤害：BATTLE 的两车相向位移是**纯演出**（正弦收敛再回位）。
 */

import { bodyOffsetBoxes, partOffsetBoxes } from './scene';
import { buildSpawnPlan, type SpawnPlan, type SpawnedEntity } from './entities';
import { findEncounter, findLoadout } from './testData';
import {
  RUN_BUILD_ICON_SLOTS,
  RUN_SIDE_VIEW_CLOSING_PX,
  placeSideViewEntity,
  runActionBarRect,
  runBoxBounds,
  runBuildIconChip,
  runBuildIconSlots,
  runChoiceBarRect,
  runChoiceCardRects,
  runChoiceChipRect,
  runDayNodes,
  runSideViewScale,
  runStageGroundY,
  translateRunBounds,
  translateRunRects,
  type RunLayeredRect,
  type RunRect,
} from './runPageLayout';
import {
  RUN_CHOICE_OPTIONS,
  runActionEnabled,
  runBattleProgress,
  type RunBattleState,
  type RunPageContext,
  type RunPageState,
  type RunPhase,
} from './runPageState';

/** 本 Queue 的固定演示装载（Debug 选择项不参与 Run Page）。 */
export const RUN_DEMO_LOADOUT_ID = 'WatermelonHeavyCannon';
export const RUN_DEMO_ENCOUNTER_ID = 'Chaser';

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
    enemyBodyDefId: enemy.bodyDefId,
    playerHpMax: plan.player.hp,
    enemyHpMax: enemy.hp,
  };
}

/** 侧视舞台上的一个实体（车身矩形 / 部件矩形 / 精确并集）。 */
export interface RunPlacedEntityView {
  readonly body: readonly RunRect[];
  readonly part: readonly RunRect[];
  readonly bounds: RunRect;
}

export interface RunStageView {
  /** 显示缩放（只服务「两车同框」，与状态无关 → 敌人出现时玩家车体不会突然缩放）。 */
  readonly scale: number;
  readonly groundY: number;
  readonly ground: RunRect;
  readonly player: RunPlacedEntityView;
  /** EVENT / BATTLE 才有敌人；IDLE = 还没遭遇，RESULT / CHOICE = 已消失。 */
  readonly enemy: RunPlacedEntityView | null;
  /** 敌方是否处于「结束 / 消失」状态（RESULT 与 CHOICE）。 */
  readonly enemyGone: boolean;
  readonly battle: boolean;
}

/** 战斗演出位移：正弦收敛——开局与结束时为 0，中段最大（纯表现，不改任何数值）。 */
export function battleClosingOffset(battle: RunBattleState | null): number {
  if (!battle || battle.totalSteps <= 0) return 0;
  const p = runBattleProgress(battle);
  return Math.round(Math.sin(Math.PI * p) * RUN_SIDE_VIEW_CLOSING_PX);
}

function entityBoxes(e: SpawnedEntity): { body: ReturnType<typeof bodyOffsetBoxes>; parts: ReturnType<typeof partOffsetBoxes> } {
  return { body: bodyOffsetBoxes(e.bodyDefId), parts: partOffsetBoxes(e) };
}

/** 把实体摆到侧视舞台（车身与部件共用同一次变换 → 相对关系不会漂移）。 */
export function placeEntitySide(
  e: SpawnedEntity,
  side: 'left' | 'right',
  scale: number,
  groundY: number,
): RunPlacedEntityView {
  const { body, parts } = entityBoxes(e);
  const placed = placeSideViewEntity([...body, ...parts], side, scale, groundY);
  return {
    body: placed.rects.slice(0, body.length),
    part: placed.rects.slice(body.length),
    bounds: placed.bounds,
  };
}

function shift(v: RunPlacedEntityView, dx: number): RunPlacedEntityView {
  if (dx === 0) return v;
  return {
    body: translateRunRects(v.body, dx),
    part: translateRunRects(v.part, dx),
    bounds: translateRunBounds(v.bounds, dx),
  };
}

interface BasePlacements {
  readonly scale: number;
  readonly groundY: number;
  readonly player: RunPlacedEntityView;
  readonly enemy: RunPlacedEntityView;
}

let cachedBase: BasePlacements | null = null;

/** 基础摆位（只依赖固定演示数据 → 只算一次）。 */
function basePlacements(): BasePlacements {
  if (cachedBase) return cachedBase;
  const plan = runDemoPlan();
  const enemyEntity = plan.enemies[0];
  const pBoxes = [...bodyOffsetBoxes(plan.player.bodyDefId), ...partOffsetBoxes(plan.player)];
  const eBoxes = [...bodyOffsetBoxes(enemyEntity.bodyDefId), ...partOffsetBoxes(enemyEntity)];
  const scale = runSideViewScale(runBoxBounds(pBoxes).w, runBoxBounds(eBoxes).w);
  const groundY = runStageGroundY();
  cachedBase = {
    scale,
    groundY,
    player: placeEntitySide(plan.player, 'left', scale, groundY),
    enemy: placeEntitySide(enemyEntity, 'right', scale, groundY),
  };
  return cachedBase;
}

/** 地线矩形（横向内缩 8px，避免与舞台边框视觉粘连）。 */
function groundRect(groundY: number): RunRect {
  return { x: 8, y: groundY, w: 390 - 16, h: 4 };
}

/** 按当前 phase 组装中部舞台（唯一入口；渲染与测试共用）。 */
export function buildRunStageView(phase: RunPhase, battle: RunBattleState | null): RunStageView {
  const base = basePlacements();
  const off = phase === 'BATTLE' ? battleClosingOffset(battle) : 0;
  const showEnemy = phase === 'EVENT' || phase === 'BATTLE';
  return {
    scale: base.scale,
    groundY: base.groundY,
    ground: groundRect(base.groundY),
    player: shift(base.player, off),
    enemy: showEnemy ? shift(base.enemy, -off) : null,
    enemyGone: phase === 'RESULT' || phase === 'CHOICE',
    battle: phase === 'BATTLE',
  };
}

/** 侧视舞台的分层矩形（绘制顺序：地线 → 玩家车身/部件 → 敌人车身/部件）。 */
export function runStageLayers(view: RunStageView): RunLayeredRect[] {
  const out: RunLayeredRect[] = [{ layer: 'ground', rect: view.ground }];
  for (const r of view.player.body) out.push({ layer: 'playerBody', rect: r });
  for (const r of view.player.part) out.push({ layer: 'playerPart', rect: r });
  if (view.enemy) {
    for (const r of view.enemy.body) out.push({ layer: 'enemyBody', rect: r });
    for (const r of view.enemy.part) out.push({ layer: 'enemyPart', rect: r });
  }
  return out;
}

/**
 * 一整帧的「纯色几何层」（绘制与面积账本共用的唯一来源）。
 *
 * 语义 = **画面上确实带着调色板精确色的像素**：
 *   - CHOICE 打开时整页被遮罩合成成新颜色 → 底层几何不再带精确色，
 *     于是本帧只登记浮层自身（卡片底 / 卡片色块）；
 *   - 文本不属于任何层（中性灰蓝 + 抗锯齿 → 永不落入几何色）。
 *
 * 该函数是纯函数（只吃 state + view），因此 node 侧可以直接断言整页像素账本，
 * 浏览器端再用真实 getImageData 交叉核对。
 */
export function runPageLayerShapes(state: RunPageState, view: RunStageView): RunLayeredRect[] {
  if (state.phase === 'CHOICE') {
    const out: RunLayeredRect[] = [];
    for (const card of runChoiceCardRects(RUN_CHOICE_OPTIONS.length)) {
      out.push({ layer: 'cardBar', rect: runChoiceBarRect(card) });
      out.push({ layer: 'cardChip', rect: runChoiceChipRect(card) });
    }
    return out;
  }

  const out: RunLayeredRect[] = runStageLayers(view);

  // 顶部进度节点：已完成 = day 个
  runDayNodes(state.dayTotal).forEach((r, i) => {
    out.push({ layer: i < state.day ? 'nodeDone' : 'nodeTodo', rect: r });
  });

  // 顶部核心 Build 图标：固定槽位，未获得的也占位（画面上不会「跳动」）
  runBuildIconSlots(RUN_BUILD_ICON_SLOTS).forEach((slot, i) => {
    const owned = i < state.buffs.length;
    out.push({ layer: owned ? 'iconOwned' : 'iconSlot', rect: slot });
    if (owned) out.push({ layer: 'iconChip', rect: runBuildIconChip(slot) });
  });

  // 最底唯一主动作：入账的是按钮的纯色强调条（按钮填充承载文字，不入账）
  out.push({
    layer: runActionEnabled(state) ? 'actionBar' : 'actionBarOff',
    rect: runActionBarRect(),
  });
  return out;
}
