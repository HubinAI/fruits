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
 *   2) **对手**遭遇是**固定**的一套演示数据（`RUN_DEMO_*`），指向 F1 共享测试数据，
 *      不新增数值、不随机、不接 Debug 选择项；
 *      ⚠️ PRODUCT-LOOP-R1-C 起，**玩家**那一侧不再固定：局内 Run 的玩家装载来自
 *      产品侧交进来的「当前 Player Profile Equipped」（`RunPlayerLoadout`，见
 *      `runPlayerLoadout.ts`）。缺省（研发入口 / 不带参数）仍是上面那套演示装载，
 *      因此既有入口的行为与像素**逐项不变**。玩家装载只替换 `BuildDraft` 这一个输入，
 *      装配 / 数值解析 / 校验全部仍走同一条正式链路（`resolveEntity`）；
 *   3) 未提供 `visual` 的件（无 sprite 的部件）**整件不画**（见 `boxesOf`），
 *      绝不用纯色矩形冒充车辆外观。
 *
 * ⚠️ 车辆是正式 sprite（或真实几何降级），车身 / 部件从不进入面积账本（sprite 像素非纯色）。
 */

import { registry } from '../../core/content';
import { resolveSnapshot } from '../../core/buildSnapshot';
import { visualWorldTransform } from '../../battle/battleContract';
import { bodyOffsetBoxes } from './scene';
import {
  buildSpawnPlan,
  buildSpawnPlanFromDraft,
  entityBaseKey,
  type SpawnPlan,
  type SpawnedEntity,
} from './entities';
import { findEncounter, findLoadout } from './testData';
// PRODUCT-LOOP-P0｜Run 创建资格：不兼容装载 ⇒ **拒绝创建**（理由结构化上报，不 throw）
import { runLoadoutCompatOfDraft, type RunLoadoutCompatReason } from './runLoadoutCompat';
import {
  hasRunLoadoutParam,
  parseRunPlayerLoadout,
  type RunPlayerLoadout,
} from './runPlayerLoadout';

/**
 * 本局玩家装载类型从本模块**再导出**（`runPage.ts` 等页面侧统一只从 `runPageScene`
 * 取场景口径，避免出现第二个「场景数据入口」）。
 */
export type { RunPlayerLoadout };
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
  runOverlayCards,
  runOverlayOpen,
  type RunEncounterInfo,
  type RunPageContext,
  type RunPageState,
} from './runPageState';
import { runScriptBattleNodes } from './runScript';

/** 本 Queue 的固定演示装载（Debug 选择项不参与 Run Page）。 */
export const RUN_DEMO_LOADOUT_ID = 'WatermelonHeavyCannon';
/**
 * 演示遭遇的**默认值**（IDLE 待机近景的构图参照 + `RunBattleRuntime` 省略 `encounterId` 时的兜底）。
 *
 * ⚠️ PRP-RUN-R1：从 `Chaser`（OPP-16，追猎者）换成 **`ProtoRusher`**（正式模板 `R1-RUSH-02`
 *   的单车版，菠萝冲刺车）。原因：Run Page 的单局连打多场真实战斗、耐久**单一贯穿**
 *   （`HP <= 0` 即本局失败）。实测 `Chaser` 第一场就吃掉玩家 ~75% 耐久 → 第二场必败；
 *   `ProtoRusher` 在池内组合下可存活，同时保留真实物理接敌（会真实冲刺撞击）。
 *
 * ⚠️ PRP-RUN-02：本常量**不再**等于「本局唯一对手」——四场阶梯的对手来自 Run Script
 *   各节点的 `encounterId`（见 `runScript.ts`）。它现在只是「默认遭遇」。
 *   没有新增敌人 / 没有改正式敌人定义 / 没有改任何数值 —— 只是换用既有的正式对手模板。
 */
export const RUN_DEMO_ENCOUNTER_ID = 'ProtoRusher';

/** 玩家朝右、敌人朝左（侧视对峙的唯一朝向组合）。 */
export const RUN_PLAYER_FACING = 1 as const;
export const RUN_ENEMY_FACING = -1 as const;

/* --------------------------------------------- 本局玩家装载（PRODUCT-LOOP-R1-C） */

/** 缺省玩家装载 = Lab 目录内那套固定演示装载（`RUN_DEMO_LOADOUT_ID`）。 */
export function demoRunPlayerLoadout(): RunPlayerLoadout {
  const loadout = findLoadout(RUN_DEMO_LOADOUT_ID);
  if (!loadout) throw new Error(`[PRP-F0] 未知测试装载 "${RUN_DEMO_LOADOUT_ID}"`);
  return {
    source: 'demo',
    label: loadout.label,
    draft: loadout.draft,
    tag: loadout.id,
    key: `demo:${loadout.id}`,
  };
}

/**
 * 本局玩家装载的解析结果。
 *
 * `fallback` 是**必须可观测**的诊断值：
 *   - `'none'`     —— 用的就是产品侧交进来的装备（正式闭环的正常形态）；
 *   - `'no-param'` —— 链接里本来就没带装备（研发入口 `/run-page.html` 的原行为）；
 *   - `'invalid'`  —— **带了但坏了**（参数被改坏 / 存档组合非法）。
 *     ⚠️ 这一项一旦为 `'invalid'`，局内跑的就不是玩家身上那件 ⇒ 属真实异常，
 *        必须能被探针与测试看见，绝不静默降级（Queue 必改 2 的反面就是「首页显示 A、战斗跑 B」）。
 *   - `'unsupported-loadout'` —— 装载**本身合法**，但**不满足完整 Run 的基础要求**
 *     （PRODUCT-LOOP-P0：局外 Weapon 已支持 cannon / spear / hammer，而已验证的 Run Build
 *      内容全部围绕 cannon 派生 ⇒ 非 cannon 装上后走到第一次强化注入时会 throw）。
 *     ⚠️ 与 `'invalid'` 的区别：`'invalid'` 是「这份装备数据坏了」，本项是「装备数据是好的，
 *        但当前原型的完整 Run 不支持它」—— 后者是**产品限制**，不是数据错误。
 *
 * ── `blocked`：Run 创建资格（Queue 必改 4 的第二层防线）────────────────────
 * 真人 P0 复现链是「equipped = 非 cannon → 前几日正常 → DAY3 选 heavyShell → `beginBattle`
 * → `applyRunModifiersToSnapshot()` 找不到 cannon → throw → Run 卡死」。
 * 强化注入发生在**第二次战斗创建**时，所以第一场看不出来（R1-C 只验证了第一场）。
 *
 * ⇒ 绕过产品首页（旧 URL / 旧 Profile / stale href / 测试入口）进来时，
 *   **必须在 Run 创建前**就明确失败 —— 也就是本标志：
 *     - `blocked === true` ⇒ 宿主**不得创建 Run**，改为呈现结构化拒绝结果；
 *     - 于是「DAY3 才 throw」那条路径在真实流程里**不可达**；
 *     - 而 `applyRunModifiersToSnapshot()` 的强 invariant（找不到基准武器即 throw）
 *       **一字未改** —— 它一旦可达就仍然响亮地报错（必改 5）。
 */
export interface RunLoadoutResolution {
  readonly loadout: RunPlayerLoadout;
  readonly fallback: 'none' | 'no-param' | 'invalid' | 'unsupported-loadout';
  /** 该链接**不得创建 Run**（宿主必须拒绝并呈现结构化结果，不许照常开战）。 */
  readonly blocked: boolean;
  /** 被拒绝的原因（`blocked === false` ⇒ `null`）。 */
  readonly blockedReason: RunLoadoutCompatReason | null;
}

/**
 * 从 `location.search` 形态的字符串解析本局玩家装载（**唯一入口**）。
 *
 * 非法 / 缺失一律回退到演示装载，并把原因写进 `fallback`（见上）；
 * **合法但不支持完整 Run** ⇒ `blocked: true`（由宿主拒绝创建 Run，不走到战斗）。
 *
 * ⚠️ `blocked === true` 时的 `loadout` 取演示装载只是**类型上的占位**：
 *    宿主在 `blocked` 时不会创建 `RunPage` ⇒ 这份占位值**绝不参与任何战斗**。
 *    刻意**不**返回「玩家那份不兼容装载」—— 否则调用方一旦忽略 `blocked`，
 *    就会退化成「照常开战然后在 DAY3 崩」，正是本 Queue 要根除的形态。
 */
export function resolveRunPlayerLoadout(search: string): RunLoadoutResolution {
  const parsed = parseRunPlayerLoadout(search);
  if (!parsed) {
    return {
      loadout: demoRunPlayerLoadout(),
      fallback: hasRunLoadoutParam(search) ? 'invalid' : 'no-param',
      blocked: false,
      blockedReason: null,
    };
  }
  /**
   * 产品侧交进来的装备已经过正式 `validateSnapshot`（数据合法）⇒ 这里只回答
   * 「当前原型的完整 Run 支不支持它」，判据与运行时强化注入**同源**
   * （`snapshotHasRunBaseWeapon`，见 `runLoadoutCompat.ts`）。
   */
  const compat = runLoadoutCompatOfDraft(parsed.draft);
  if (!compat.ok) {
    return {
      loadout: demoRunPlayerLoadout(),
      fallback: 'unsupported-loadout',
      blocked: true,
      blockedReason: compat.reason,
    };
  }
  return { loadout: parsed, fallback: 'none', blocked: false, blockedReason: null };
}

/**
 * 按 Encounter id 缓存 spawn plan（纯数据，无副作用）。
 *
 * ⚠️ PRP-RUN-02：Run Script 里每个 BATTLE / FINAL 节点各自有一套对手 ⇒ 需要**多个** plan；
 *    与 IDLE 待机近景共用一个缓存（同一份正式链路解析结果，不出现第二套口径）。
 * ⚠️ PRODUCT-LOOP-R1-C：缓存键加入**玩家装载身份**（`loadout.key`）——
 *    玩家局外换了武器之后，同一个 Encounter 必须是**另一份**计划（否则第二局会沿用第一局的装配）。
 */
const planCache = new Map<string, SpawnPlan>();

export function runPlanFor(
  encounterId: string,
  loadout: RunPlayerLoadout = demoRunPlayerLoadout(),
): SpawnPlan {
  const cacheKey = `${loadout.key}|${encounterId}`;
  let p = planCache.get(cacheKey);
  if (!p) {
    p =
      loadout.source === 'demo'
        ? buildSpawnPlan(loadout.tag, encounterId)
        : buildSpawnPlanFromDraft(loadout.draft, loadout.tag, encounterId);
    planCache.set(cacheKey, p);
  }
  return p;
}

/** F1 共享测试数据的默认演示组合（IDLE 待机近景的构图参照）。 */
export function runDemoPlan(): SpawnPlan {
  return runPlanFor(RUN_DEMO_ENCOUNTER_ID);
}

/**
 * Run Page 的状态机上下文（展示名与耐久上限都来自共享数据，不手写）。
 *
 * ⚠️ PRP-RUN-02：`encounters` 按 **Run Script 的 BATTLE / FINAL 节点 id** 提供 ——
 *    状态机只按节点 id 取敌情，因此页面 / 状态机里**不需要**任何 `if (day === X)` 分支。
 *    敌情（展示名 + 真实 HP 上限）全部来自**同一个** `buildSpawnPlan` 正式链路。
 * ⚠️ PRODUCT-LOOP-R1-C：玩家展示名与耐久上限改为读**本局装载**（局外装备）⇒
 *    「首页显示的车」与「战斗里跑的车」在结构上是同一份 draft 的两个投影。
 */
export function runPageContext(loadout: RunPlayerLoadout = demoRunPlayerLoadout()): RunPageContext {
  const player = runPlanFor(RUN_DEMO_ENCOUNTER_ID, loadout).player;
  const encounters: Record<string, RunEncounterInfo> = {};
  for (const node of runScriptBattleNodes()) {
    const id = node.encounterId;
    if (!id) continue;
    const plan = runPlanFor(id, loadout);
    const enemy = plan.enemies[0];
    const encounter = findEncounter(id);
    encounters[node.id] = {
      label: encounter ? encounter.label : enemy.bodyName,
      hpMax: enemy.hp,
    };
  }
  return {
    vehicleLabel: loadout.label,
    playerHpMax: player.hp,
    encounters,
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
  /*
    ⚠️ 缓存键 = **实体内容指纹**（`entityBaseKey`），不是 `entityId` / `snapshot.id`：
    PRODUCT-LOOP-R1-C 之后，同一个 `entityId`（'player'）与同一个装载标签可以对应**不同装备**
    （玩家在车库换了武器 → 同一具车身、不同的 Functional 件，装载标签仍是 `profile-equipped`）。
    按 `entityId:snapshot.id` 缓存时实测确实踩到：换上**无 sprite**的激光后，
    待机近景仍画出上一局的 `part_cannon` —— 那正是「首页显示 A、画面里是 B」的可见形态。
    内容指纹覆盖功能件的 defId / 质量 / 能量 / 武器数值 ⇒ 换装备必然换键。
  */
  const key = `${e.entityId}:${entityBaseKey(e)}`;
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

const baseCache = new Map<string, BasePlacements>();

/** 基础摆位（只依赖本局装载 → 按装载身份缓存，换装备自动重算）。 */
function basePlacements(loadout: RunPlayerLoadout): BasePlacements {
  const hit = baseCache.get(loadout.key);
  if (hit) return hit;
  const plan = runPlanFor(RUN_DEMO_ENCOUNTER_ID, loadout);
  const enemyEntity = plan.enemies[0];
  const scale = runSideViewScale(entityVisualWidth(plan.player), entityVisualWidth(enemyEntity));
  const baselineY = runStageBaselineY();
  const p = boxesOf(plan.player);
  const out: BasePlacements = {
    scale,
    baselineY,
    player: placeSideViewVisuals(p.boxes, 'left', scale, baselineY, p.mirrors),
  };
  baseCache.set(loadout.key, out);
  return out;
}

function toEntityView(g: RunPlacedGroup): RunStageEntityView {
  return { visuals: g.visuals, bounds: g.bounds };
}

/**
 * 待机近景舞台（唯一入口；渲染与测试共用）。
 *
 * ⚠️ PRP-F1：**只用于 IDLE**。EVENT / BATTLE / RESULT 的舞台带是真实战斗世界
 * （见 `runBattleView`），本函数在这些 phase 不参与绘制。
 * ⚠️ PRODUCT-LOOP-R1-C：玩家那辆车来自**本局装载**（省略 = 演示装载，既有行为逐像素不变）。
 */
export function buildRunStageView(
  loadout: RunPlayerLoadout = demoRunPlayerLoadout(),
): RunStageView {
  const base = basePlacements(loadout);
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
export function runDemoEnemy(loadout: RunPlayerLoadout = demoRunPlayerLoadout()): SpawnedEntity {
  return runPlanFor(RUN_DEMO_ENCOUNTER_ID, loadout).enemies[0];
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
 *   - 浮层（CHOICE / DURABILITY）打开时整页被遮罩合成为新颜色 → 底层几何不再带精确色，
 *     本帧只登记浮层自身；
 *   - **EVENT / BATTLE / RESULT**：舞台带被真实战斗世界（离屏位图）占据 →
 *     地线 / 路面**不存在**，本帧不登记这两层；
 *   - 车辆是 sprite，本身不是纯色 → 从不入账；
 *   - 文本不属于任何层（中性灰蓝 + 抗锯齿 → 永不落入几何色）。
 */
export function runPageLayerShapes(state: RunPageState, view: RunStageView): RunLayeredRect[] {
  const out: RunLayeredRect[] = [];
  const overlay = runOverlayOpen(state);

  // 底部常驻层（浮层遮罩下会被合成掉 → 不登记）
  if (!overlay) {
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

  // 浮层（CHOICE 强化 / DURABILITY 耐久事件）：卡片顶部强调条（不含文字、不被描边 / 图标覆盖）
  // ⚠️ PRP-BUILD-01：卡片数量取自**当前候选池**（第一层 / 第二层条件池），不是写死的第一层三项。
  // ⚠️ PRP-RUN-02：DURABILITY 复用同一套卡片几何（`cardBar` 层）⇒ **零布局改动**。
  if (overlay) {
    for (const card of runChoiceCardRects(runOverlayCards(state).length)) {
      out.push({ layer: 'cardBar', rect: runChoiceBarRect(card) });
    }
  }

  return out;
}
