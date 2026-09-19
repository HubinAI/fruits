/**
 * PRP-F0-RUN-PAGE-SHELL｜PRP-R3-CAPYBARA-UI-HIERARCHY-REBUILD
 * ｜PRP-F1-PORTRAIT-PLANCK-BATTLE-INTEGRATION
 * Run Page 控制器（本原型**唯一**的 DOM / Canvas / 输入层）。
 *
 * 页面契约（与产品基线一一对应）：
 *   - 单一 Run Page：全部内容画在**一张 canvas** 上（顶部薄层 / 中部舞台 / 下部冒险记录 /
 *     最底动作），五个状态只是同一页面的不同绘制结果，**任何时刻都不发生页面跳转**；
 *   - 竖屏逻辑基准 390×844，屏幕映射复用正式共享契约 `PlayerViewportTransform(390, 844)`
 *     （contain 缩放居中），不引入第二套坐标系统、不做动态 reframe；
 *   - 命中区与绘制矩形**同源**：两者都取自 `runPageLayout`；
 *   - 最底只有**一个**主动作按钮；BATTLE 期间进入「战斗中」且不可误触推进；
 *   - CHOICE 期间原页面**位置不变**、整体变暗（画布内遮罩），中央出现三选一浮层。
 *
 * PRP-R3 信息层级重构（已通过）：顶部减法 / 叙事日志 / 玩家化三选一（本文件是落点）。
 *
 * ⚠️ PRP-F1-PORTRAIT-PLANCK-BATTLE-INTEGRATION（本 Queue 的落点）：
 *   中部舞台带从「PRP 自己的假战斗舞台」换成**真实 Planck 侧视战斗世界**：
 *
 *     IDLE                      → PRP 近景待机舞台（R3 已通过的构图：真实 sprite + 真实地线）
 *     EVENT / BATTLE / RESULT   → 真实战斗世界（`RunBattleView`：正式 Renderer 渲染，
 *                                 PRP 固定远摄相机 + 舞台带贴图 = Camera / Clip 适配）
 *
 *   - 世界尺度 / 出生点 / 移动 / 武器 / 弹丸 / 后坐 / 碰撞 / 阶段 / 结果**全部是正式的**
 *     （`RunBattleRuntime` → 正式 `PlanckBattleOrchestrator`，构造时零 config 覆盖）；
 *   - PRP 在战斗里的新增语义仅剩：生命周期接线、固定 camera transform、clip、HP 展示、
 *     result → Run Page state（= Queue 必改 4 给本适配划定的理想职责）；
 *   - BATTLE 的推进是**真实物理时间**（`runtime.step(realDt)`），不再是定时脚本。
 *
 * Debug 与玩家界面分离：
 *   本页面**只有** #run-root / .run-stage / #run-canvas 三层壳，不含任何
 *   Arena / Loadout / Encounter / Start / Reset / Gate 之类的开发控制。
 *
 * 删除本文件即移除 Run Page 核心；本目录可整块删除（清单见 constants.ts 头部）。
 */

import { PlayerViewportTransform } from '../../platform/playerViewport';
import { PORTRAIT_LOGICAL_H, PORTRAIT_LOGICAL_W } from './constants';
import {
  RUN_ACTION_BAND,
  RUN_BANDS,
  RUN_LOG,
  RUN_LOG_BAND,
  RUN_LOG_LABEL_POS,
  RUN_PAGE_H,
  RUN_PAGE_W,
  RUN_STAGE_BAND,
  RUN_STAGE_HAZE_H,
  RUN_TOP_BAND,
  emptyRunLayerAreas,
  runActionBarRect,
  runActionButtonRect,
  runBuffIconChip,
  runBuffIconRects,
  runChoiceBarRect,
  runChoiceCardRects,
  runChoiceIconRect,
  runChoiceMaskRect,
  runChoiceTextX,
  runChoiceTitlePos,
  runDayNodes,
  runLogLineRects,
  runPaintedAreas,
  runRewardCardRect,
  runRewardIconRect,
  runRewardTextPos,
  runStageHills,
  type RunLayerId,
  type RunLayeredRect,
  type RunPlacedVisual,
  type RunRect,
} from './runPageLayout';
import {
  chooseRunBuff,
  createRunPageState,
  durabilityPercent,
  finishRunBattle,
  formatRunLog,
  pressRunAction,
  resolveDurability,
  runActionEnabled,
  runActionLabel,
  runBuildIds,
  runCarriedPlayerHp,
  runChoiceOpen,
  runChoicePool,
  runChoicePoolKind,
  runChoicePoolLayer,
  runComplete,
  runCurrentNode,
  runDurabilityOpen,
  runDurabilityTitle,
  runFailed,
  runNodeKind,
  runOverlayCards,
  runOverlayOpen,
  runStartsNewRun,
  syncRunBattle,
  visibleRunLog,
  type RunLogEntry,
  type RunOverlayOption,
  type RunPageState,
  type RunPhase,
} from './runPageState';
import { RUN_TOTAL_BATTLES, type RunChoicePoolKind, type RunDurabilityChoiceId } from './runScript';
/**
 * PRP-M2-NEXT-RUN-SEED-VALIDATION：**验证专属**流程数据与构造器。
 *
 * ⚠️ 只有宿主提供了 `RunPageOptions.seedOptions` 时这条链才被走到；
 *    `new RunPage(root)` 的默认完整 Run 流程**不引用**其中任何一项的运行期值。
 */
import {
  NEXT_RUN_SEED_LEAD,
  NEXT_RUN_SEED_TITLE,
  createSeededNewRun,
  nextRunFinalAction,
  priorRunSummary,
  type NextRunFinalAction,
  type PriorRunSummary,
  type RunSeedOption,
} from './nextRunValidation';
import {
  buildRunStageView,
  runPageContext,
  runPageLayerShapes,
  runDemoEnemy,
  type RunStageEntityView,
  type RunStageView,
} from './runPageScene';
/**
 * PRODUCT-LOOP-R1-B｜RUN COMPLETE 的**产品奖励出口**（纯逻辑 / 纯几何）。
 *
 * ⚠️ 只在宿主提供 `RunPageOptions.productReward` 时才产生任何出口
 *    ⇒ 无参数打开 `run-page.html` 的既有路径（含像素账本）**逐像素不变**。
 */
import {
  RUN_REWARD_CLAIM_LABEL,
  RUN_REWARD_NOTE,
  RUN_REWARD_TITLE,
  fitRewardIcon,
  runProductClaimNow,
  runRewardCard,
  type RunProductClaim,
  type RunProductReward,
  type RunRewardCard,
} from './runProductReward';
import {
  RUN_BATTLE_VIEW_H,
  RUN_BATTLE_VIEW_W,
  RunBattleRuntime,
  battleBandX,
  battleBandY,
  battleGroundBandY,
  battleVisibleWorld,
  type RunBattleBox,
} from './runBattleRuntime';
import { RunBattleView } from './runBattleView';
import { RUN_IMPACT_RING_MS, runImpactCoreShape, runImpactRingShapes } from './runImpactVfx';
import { RunVisualStore, type RunAssetStats } from './runVehicleAssets';

const FONT_STACK = 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';

/**
 * Run Page 调色板。
 *
 * ⚠️ 纪律：**入账色（LEDGER_COLORS）之间、以及它们与任何非入账色之间必须 RGB 精确互斥**。
 * 浏览器端用「精确相等」统计面积，因此任何同色歧义都会立刻污染断言。
 * 车辆 sprite 的真实像素色（西瓜 63,138,60 / 香蕉 246,200,60 / 钢件 138,147,160 等）
 * 也已与下列全部颜色避让。
 */
const COLORS = {
  pageBg: '#0b0e14',
  topBandBg: '#151c28',
  stageSky: '#141c2a',
  stageHaze: '#1d2839',
  /** 地平线暖端（天空渐变的最下端）；只到地平线为止，不渗进路面。 */
  horizonGlow: '#2a3a52',
  hillFar: '#233149',
  hillNear: '#32455f',
  logBandBg: '#0d121a',
  actionBandBg: '#141a26',
  divider: '#25314a',
  /* ---- 入账（纯色平铺矩形，无人覆盖） ---- */
  ground: '#8f7a52',
  road: '#332e42',
  nodeDone: '#d2922a',
  nodeTodo: '#46536b',
  buffChip: '#e6edf8',
  cardBar: '#5f86c4',
  actionBtn: '#33507a',
  actionBtnOff: '#2a3341',
  /* ---- 不入账 ---- */
  actionFill: '#28405f',
  actionFillOff: '#232b38',
  actionEdge: '#4f7099',
  cardBg: '#1b2432',
  cardEdge: '#3d4c66',
  wheelTire: '#1c1f26',
  wheelRim: '#9aa2b2',
  textTitle: '#e9eef7',
  textBody: '#c7d0df',
  textDim: '#8a94a6',
  textFaint: '#5d6675',
  dayAccent: '#e8b23c',
  iconShell: '#b8562e',
  iconTwin: '#c07a2a',
  iconReload: '#3f8f5a',
  /* ---- PRP-BUILD-01 第二层（条件池）图标底色 ---- */
  iconKinetic: '#8e44c0',
  iconTriple: '#2f8fc4',
  iconRepair: '#4fc4a8',
  /* ---- PRP-BUILD-01-R1：动能爆发命中冲击环（不入账 — 有透明度、非平涂矩形） ---- */
  /**
   * 冲击环描边色。刻意选**亮紫**：与 `kineticBurst` 图标色同色族，玩家能把
   * 「这个环」与强化选项「动能爆发」对上（可感知性的关键一步）。
   * ⚠️ 必须与全部入账色 / 七个图标色 RGB 精确互斥（有源码守卫断言）——
   *    但环只在**舞台带内**绘制，且分带线在其之后绘制 → 不可能污染任何入账面积。
   */
  impactRing: '#d9a8ff',
  /** 命中点核心亮点（更短的定位点）。 */
  impactCore: '#f6ecff',
} as const;

/**
 * 入账色的唯一注册表（供源码守卫交叉核对「不存在第二个同色源」）。
 *
 * ⚠️ 键集必须与 `RunPageLayout.RunLayerId` 一致（**无禁用态强调条**：见该类型的注释）。
 * ⚠️ `buffIcon` 一栏只登记「名义色」——顶部图标底色按选项区分（三个选项三色，
 *    浏览器端逐色断言；见 tests/_e2e_run_page.cjs 的 PALETTE.buffIcon*）。
 * ⚠️ `actionBtnOff` 仍在绘制中使用（按钮禁用态），但**不入账本**，故不在此表。
 */
export const RUN_LEDGER_COLORS: Readonly<Record<string, string>> = {
  ground: COLORS.ground,
  road: COLORS.road,
  nodeDone: COLORS.nodeDone,
  nodeTodo: COLORS.nodeTodo,
  buffIcon: COLORS.iconReload,
  buffChip: COLORS.buffChip,
  cardBar: COLORS.cardBar,
  actionBar: COLORS.actionBtn,
};

/** CHOICE 遮罩：整页重压暗（画布内合成 → 可被真实 getImageData 验证「变暗」）。 */
const CHOICE_MASK_COLOR = 'rgba(6,9,14,0.86)';

/**
 * 每个浮层选项的图标绘制色（矢量字形，非纯色块；不入面积账本）。
 *
 * ⚠️ PRP-BUILD-01：新增第二层四项。这七色**两两 RGB 精确互斥**，且与
 *    `RUN_LEDGER_COLORS` 全部入账色互斥 —— 浏览器端在图标盒内按**精确相等**统计
 *    该选项的专属图标色，并要求「它选项的图标色命中为 0」，任何同色歧义都会立刻污染断言。
 *
 * ⚠️ PRP-RUN-02：再新增耐久事件的两项（`repair` / `upgrade`）→ 共 **8 色**，
 *    同样满足两两互斥 + 与入账色互斥。浏览器端维护同一张互斥表。
 */
const CHOICE_ICON_COLOR: Readonly<Record<string, string>> = {
  heavyShell: '#ffb066',
  twinCannon: '#ffd166',
  fastReload: '#7fd6a0',
  kineticBurst: '#c98cf0',
  tripleLoad: '#79c0ea',
  emergencyRepair: '#5fd0c0',
  repair: '#e07a9a',
  upgrade: '#a8b45c',
};

/** 顶部已获得图标的底色（按选项区分；芯片色统一 → `buffChip` 层可冻结）。 */
const BUFF_ICON_COLOR: Readonly<Record<string, string>> = {
  heavyShell: COLORS.iconShell,
  twinCannon: COLORS.iconTwin,
  fastReload: COLORS.iconReload,
  kineticBurst: COLORS.iconKinetic,
  tripleLoad: COLORS.iconTriple,
  emergencyRepair: COLORS.iconRepair,
};

export interface RunPageScreenProbe {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly dpr: number;
}

/** 一个实体在舞台上的真实视觉件（供诊断 / 浏览器断言使用）。 */
export interface RunProbeVisual {
  readonly kind: string;
  readonly visualId: string | null;
  readonly defId: string | null;
  readonly rect: RunRect;
}

export interface RunProbeEntity {
  readonly visuals: readonly RunProbeVisual[];
  readonly bounds: RunRect;
  /**
   * 该实体是否**每个**可视件都已真实绘制且不是纯色占位
   * （有正式 sprite，或按真实半径绘制的轮组）。false = 出现了纯色矩形代表车辆。
   */
  readonly allSprites: boolean;
}

/**
 * 真实 Planck 战斗世界的诊断口径（EVENT 起非空）——全部读自正式运行时，零插值、零预测。
 */
export interface RunProbeBattleWorld {
  readonly phase: string;
  readonly timeMs: number;
  /**
   * PRP-F2：本场战斗生效的**第一层**强化（null = 基础状态）。
   * 完整两层 Build 读 `build`（两者同源；此处保留单强化口径供逐项独立验证断言）。
   */
  readonly modifier: string | null;
  /** PRP-BUILD-01：本场战斗真实拿到的完整 Build（按选择顺序；空数组 = 基础状态）。 */
  readonly build: readonly string[];
  /**
   * PRP-BUILD-01：Run 能力的**真实运行状态**（事件驱动；全部是真实发生过的计数与量值）。
   *   - `kineticHits` / `lastKineticImpulse`：动能爆发真的触发了几次、最近一次多大；
   *   - `projectileMass`：读自本局真实 resolved 武器 def 的「当前炮弹质量」。
   *
   * ⚠️ PRP-BUILD-01-CLOSEOUT-AND-FREEZE：这里曾有 `suppressionShot` / `suppressionHits` /
   *    `lastSuppressionImpulse` 三个字段（快速装填专属二层）。该路线**真人三轮未通过**，
   *    已正式废弃并整条删除 —— 探针只保留**仍然生效**的能力字段。
   */
  readonly abilities: {
    readonly kineticBurst: boolean;
    readonly kineticHits: number;
    readonly lastKineticImpulse: number;
    readonly projectileMass: number;
    /**
     * PRP-BUILD-01-R1：最近一次动能爆发的**真实命中点**（世界坐标）与冲量大小；
     * `null` = 本场还没触发过。与冲量的真实作用点**同源**（都是 `damage.contactPoint`）。
     */
    readonly lastKineticHit: { readonly x: number; readonly y: number; readonly magnitude: number } | null;
  };
  /**
   * PRP-BUILD-01-R1：本帧的**命中冲击环**状态（把「额外冲击发生在这一刻」标出来的反馈）。
   * `null` = 当前没有标记（没触发过 / 已过期 / 战场已冻结）。
   */
  readonly kineticImpact: {
    /** 距离该次真实命中的毫秒数（用战斗自己的时钟，不引入第二个时间源）。 */
    readonly ageMs: number;
    /** 真实命中点（世界坐标）。 */
    readonly worldX: number;
    readonly worldY: number;
    /** 真实命中点 → 舞台带逻辑坐标（**绘制坐标与 probe 坐标同源**）。 */
    readonly bandX: number;
    readonly bandY: number;
    /** 本帧实际画出的环数 / 是否画核心亮点（0/false = 已过期）。 */
    readonly rings: number;
    readonly core: boolean;
    readonly maxRadius: number;
    readonly maxAlpha: number;
  } | null;
  /** 本场开局的真实玩家 HP（= 注入跨战斗耐久后的实际值）。 */
  readonly initialPlayerHp: number;
  /** 本场玩家 HP 上限（**不因跨战斗耐久改变** → 耐久条如实显示「打剩多少」）。 */
  readonly playerHpMax: number;
  /** 已推进的**正式物理步数**。 */
  readonly steps: number;
  /** 当前存活弹丸数（真实 projectile 渲染快照 → 可证「炮弹真的在飞」）。 */
  readonly projectiles: number;
  /**
   * 其中属于**玩家（A 方）**的存活弹丸数。
   * ⚠️ 与 `projectiles` 分开：对手武器也会贡献弹丸（喷火器的火焰颗粒等），
   * 「按弹丸增量反推开火节奏」这类测量必须只看玩家这一侧。
   */
  readonly playerProjectiles: number;
  /** 两车真实可见外廓的世界间距（>0 = 完全分离）。 */
  readonly gapWorld: number;
  /** 同上，换算到舞台带逻辑坐标（= gapWorld × 相机缩放）。 */
  readonly gapView: number;
  readonly world: {
    /** 正式 `DEFAULT_ARENA_CONFIG.width` = 1600（**不是**舞台带宽 390）。 */
    readonly width: number;
    readonly height: number;
    readonly groundY: number;
    /** 构造后实测的出生中心 x（正式 spawnA / spawnB）。 */
    readonly spawnAx: number;
    readonly spawnBx: number;
    /** 出生中心距（世界 px）。 */
    readonly spawnSeparation: number;
    /** 开战瞬间实测的两车外廓间距 —— 证明「开局有明确距离」。 */
    readonly initialGap: number;
  };
  readonly camera: {
    /** **正式动态取景**的实时 scale（由真实世界间距驱动，不是固定常数）。 */
    readonly scale: number;
    readonly offsetX: number;
    readonly offsetY: number;
    /** 地面线在**离屏画布**内的 y。 */
    readonly groundScreenY: number;
    /** 地面线在**舞台带**内的 y（= groundScreenY − cropY）。 */
    readonly groundBandY: number;
    /** 离屏视口（= 舞台带 + 正式 inset，502×358）。 */
    readonly viewW: number;
    readonly viewH: number;
    /** 可见区（= 正式安全区 = 舞台带 390×302）。 */
    readonly bandW: number;
    readonly bandH: number;
    /** viewport adapter 的裁剪原点（= 正式 inset）。 */
    readonly cropX: number;
    readonly cropY: number;
    /** 舞台带内**实际可见**的世界水平范围（PRP-R5 的「不是完整世界远摄」判据）。 */
    readonly visibleWorldMinX: number;
    readonly visibleWorldMaxX: number;
    readonly visibleWorldWidth: number;
    /** 可见世界宽 ≥ 世界宽（false = 相机确实在裁世界，即动态取景在起作用）。 */
    readonly showsWholeWorld: boolean;
  };
  readonly player: RunProbeEntity;
  readonly enemy: RunProbeEntity;
}

/** 只读诊断快照（Run Page 专属；仅存在于本原型页面，不进入任何正式构建）。 */
export interface RunPageProbe {
  readonly logicalW: number;
  readonly logicalH: number;
  readonly phase: RunPhase;
  readonly phaseTrail: readonly RunPhase[];
  readonly transitions: number;
  readonly actionCount: number;
  /**
   * PRP-RUN-02：**当前已呈现的 Run Script 节点**（本局唯一的进度锚点）。
   * `nodeId` + `nodeKind` 一起回答了「现在轮到什么」——页面里没有任何 `if (day === X)`，
   * 因此这两个字段就是「脚本驱动」这件事在浏览器端的可观测形式。
   */
  readonly nodeId: string;
  /** 当前节点的类型（`EVENT` / `BATTLE` / `CHOICE` / `DURABILITY` / `FINAL`）。 */
  readonly nodeKind: string;
  /** 当前节点的 Encounter id（非 BATTLE / FINAL 节点为 null）。 */
  readonly encounterId: string | null;
  /** 本局真实战斗场数上限（来自 Run Script；本阶段固定 4）。 */
  readonly battleTotal: number;
  readonly day: number;
  readonly dayTotal: number;
  /**
   * 本局已生效的**第一层**强化（= Build 的第一项；null = 尚未选择）。
   * 完整 Build 读 `build`。两者都只是**本局临时状态**，新开 Run 即回空。
   */
  readonly modifier: string | null;
  /** PRP-BUILD-01：本局完整 Build（按选择顺序，最多两项）。 */
  readonly build: readonly string[];
  /** 本局 Build 的中文标签（与 `build` 同序）。 */
  readonly buildLabels: readonly string[];
  /**
   * PRP-BUILD-01：本局已累计的紧急维修补偿（耐久点数；0 = 没拿过维修）。
   * ⚠️ 不写进 `battle.playerHp`（那是上一场的真实结果，不该被改写）。
   */
  readonly repairBonus: number;
  /**
   * PRP-BUILD-01：本局已打完的真实战斗场数（0..4）。
   * `4` = 四场全部打完。⚠️ 这只是**诊断值**：进度与终局判定由 `nodeId` / `phase` 决定。
   */
  readonly battlesCompleted: number;
  /** PRP-RUN-02：本局是否已 `COMPLETE`（终局战斗打完且仍然存活 → RUN COMPLETE 终态）。 */
  readonly complete: boolean;
  /** PRP-RUN-02：本局是否已 `FAILED`（某一场真实 Player HP 归零 → 失败终态）。 */
  readonly failed: boolean;

  /* ---------------- PRP-M2-NEXT-RUN-SEED-VALIDATION（验证专属；默认流程恒为「未启用」） */

  /**
   * 是否处于「下一局起始改装」验证流程（= 宿主提供了 `RunPageOptions.seedOptions`）。
   * ⚠️ 默认完整 Run 流程（`new RunPage(root)`）恒为 `false`。
   */
  readonly nextRunValidation: boolean;
  /**
   * 种子选择浮层是否打开。几何**复用 CHOICE 卡片**（`runChoiceCardRects`），
   * 因此它与三选一强化在结构上不可能出现两套尺寸。
   */
  readonly seedSelectOpen: boolean;
  /** 种子选择浮层上**真正画出来**的三张卡片（与绘制、命中区同源）。 */
  readonly seedOptions: readonly {
    id: string;
    title: string;
    note: string;
    rect: RunRect;
    iconRect: RunRect;
  }[];
  /** 已经选定的种子 id（`null` = 还没选）。 */
  readonly seedChosen: string | null;
  /** 上一局（RUN COMPLETE）摘要 —— 「这是下一局，不是上一局继续」的证据。 */
  readonly priorRun: PriorRunSummary | null;
  /**
   * 新 Run 第一场真实战斗已结束且验证**停止**（= `NEXT RUN VALIDATION COMPLETE`）。
   * 为 `true` 时唯一主动作不可用（不再推进第二场），文案变为验证终点标记。
   */
  readonly validationComplete: boolean;
  /**
   * PRP-RUN-R1 必改 3：按下主动作会不会**开一个全新 Run**
   * （`true` = 失败终态 / 三场打完的终局；`false` = 继续当前 Run → CHOICE）。
   * 这是「继续当前 Run」与「重新开始新 Run」在浏览器端的**唯一可观测判据**。
   */
  readonly startsNewRun: boolean;
  readonly buffs: readonly string[];
  readonly buffLabels: readonly string[];
  /** 顶部实际绘制的强化图标数量（0 = 顶部第二行完全没有内容，可反证「没有空槽」）。 */
  readonly buffIconCount: number;
  readonly logCount: number;
  readonly log: readonly { seq: number; kind: string; text: string }[];
  readonly actionLabel: string;
  readonly actionEnabled: boolean;
  readonly actionRect: RunRect;
  /**
   * PRP-M2-R1｜主动作**当前指向的出口地址**（`null` = 不是终点态，或终点态但宿主没给出口）。
   * ⚠️ 与 `actionLabel` 同源（都来自 `finalActionNow()`）⇒ 「按钮文案」与「点了去哪」
   *    在探针里也是**一个对象**，不存在两套口径。
   */
  readonly exitHref: string | null;
  /**
   * PRODUCT-LOOP-R1-B｜本帧**真正画出来的**「本局获得」卡片（`null` = 本帧没有这张卡）。
   *
   * ⚠️ 与绘制同源：`rewardCardNow()` 同时决定「画不画」与「探针报什么」，
   *    因此不存在「探针说有奖励、屏幕上却没有」的分叉。
   * ⚠️ **FAILED 恒为 `null`**：失败终态结构上没有奖励出口（`runProductClaimNow` 先查 `runComplete`），
   *    这是 Queue 必改 4「第一版失败不发永久部件奖励」的机器可读证据。
   * ⚠️ 无产品上下文（不传 `productReward`）时同样恒为 `null` ⇒ 既有入口零变化。
   */
  readonly rewardCard: {
    defId: string;
    name: string;
    energy: number;
    label: string;
    href: string;
    /** 是否用了该部件的正式 sprite（`false` = 如实回退到真实 Collider 外接框）。 */
    hasSprite: boolean;
  } | null;
  /** 卡片矩形（与绘制同源；`null` 同上）。 */
  readonly rewardCardRect: RunRect | null;
  /** **强化**三选一浮层是否可见（严格 = `phase === 'CHOICE'`）。 */
  readonly choiceOpen: boolean;
  /**
   * 当前选择池的**内容层**（1 = 一层内容（含横向改装）/ 2 = 第二层条件池 / 0 = 当前不在 CHOICE）。
   * ⚠️ PRP-RUN-02-R2：不再按「第几次选择」数数，而是读**当前脚本节点声明的池种类**
   *    （`runChoicePoolLayer`）——「第几次选」与「哪一层内容」是两件独立的事。
   */
  readonly choicePoolLayer: number;
  /**
   * 当前脚本节点声明的池**种类**（`layer1` / `lateral` / `layer2`；不在 CHOICE 时为 `null`）。
   * 逐字暴露数据层的值 → E2E 可以直接断言「这里是横向改装，不是第二层」。
   */
  readonly choicePoolKind: RunChoicePoolKind | null;
  /** 强化候选池的卡片（结构规则口径；DURABILITY 时为空 —— 那两项见 `overlayOptions`）。 */
  readonly choiceOptions: readonly { id: string; label: string; note: string; rect: RunRect; iconRect: RunRect }[];
  /** PRP-RUN-02：耐久取舍浮层是否可见（严格 = `phase === 'DURABILITY'`）。 */
  readonly durabilityOpen: boolean;
  /** PRP-RUN-02：耐久事件已裁决的分支（`null` = 还没做过这个决定）。 */
  readonly durabilityChosen: RunDurabilityChoiceId | null;
  /** PRP-RUN-02：当前是否有**任何**浮层（CHOICE / DURABILITY）打开。 */
  readonly overlayOpen: boolean;
  /** PRP-RUN-02：浮层标题（无浮层为 `null`）—— 强化 = 固定文案，耐久 = 脚本数据。 */
  readonly overlayTitle: string | null;
  /**
   * PRP-RUN-02：**本帧真正画出来的浮层卡片**（与绘制 / 命中区同源）。
   * CHOICE → 强化候选池；DURABILITY → 维修 / 继续改装两项。
   */
  readonly overlayOptions: readonly (RunOverlayOption & { rect: RunRect; iconRect: RunRect })[];
  readonly bands: {
    top: RunRect;
    stage: RunRect;
    log: RunRect;
    action: RunRect;
  };
  readonly battle: {
    steps: number;
    playerHp: number;
    playerHpMax: number;
    enemyHp: number;
    enemyHpMax: number;
    done: boolean;
    /** 官方 `resolveBattleResult` 的胜负方（'A' = 玩家；未结束为 null）。 */
    winner: string | null;
    /** 官方结束原因（未结束为 null）。 */
    endReason: string | null;
    durabilityPercent: number;
  } | null;
  /**
   * 中部舞台。
   *
   * `mode` 是唯一的绘制来源判据：
   *   - `'idle'`：PRP 待机近景（`ground` / `road` / 单辆玩家车真实存在）；
   *   - `'battle'`：真实 Planck 战斗世界（离屏位图贴满整个舞台带 →
   *     `ground` / `road` 这两层**不存在**，其数值仅供布局参照）。
   * `player` / `enemy` / `playerLeftOfEnemy` / `minGapPx` 两种模式下都有效。
   *
   * ⚠️ **坐标系不对称（实测口径，勿混用）**：
   *   - `mode === 'idle'`：`ground` / `road` / `player.bounds` 是**页面绝对逻辑坐标**
   *     （`runStageGroundY()` 自带 `RUN_STAGE_BAND.y` 偏移，绘制时直接 `fillRect` 不再加带偏移）；
   *   - `mode === 'battle'`：`player` / `enemy` 的 `bounds` 是**舞台带内相对坐标**
   *     （经 `battleBandY(xf, …)` = 正式相机 `offsetY` + 世界 y×scale − `cropY` 得到 0..带高，
   *      合成时由 9 参 `drawImage` 落到带内）。
   *   即：拿 `bounds` 去采样画布像素时，battle 模式必须再加 `bands.stage.y`，idle 模式**不能**加。
   */
  readonly stage: {
    mode: 'idle' | 'battle';
    /** 当前生效的显示缩放（idle = 近景缩放；battle = **正式动态取景**的实时 scale）。 */
    scale: number;
    groundY: number;
    ground: RunRect;
    road: RunRect;
    player: RunProbeEntity;
    enemy: RunProbeEntity | null;
    /** 玩家是否在敌人**左侧**（无敌人时为 null）—— 验收「玩家左 / 敌人右」。 */
    playerLeftOfEnemy: boolean | null;
    /** 两侧最小水平间距（>0 = 完全分离，无重叠）。 */
    minGapPx: number | null;
  };
  /** 真实战斗世界（`mode === 'battle'` 时非空）。 */
  readonly battleWorld: RunProbeBattleWorld | null;
  /** 真实车辆 sprite 的加载状态（未就绪时降级为纯色几何，绝不伪装成已用真实视觉）。 */
  readonly assets: RunAssetStats;
  /** 战斗世界自己的 sprite 加载状态（与上一条**分开报告**，不混为一谈）。 */
  readonly battleAssets: { registered: number; ready: number; failed: readonly string[] };
  readonly layers: Record<RunLayerId, number>;
  readonly screen: RunPageScreenProbe;
  /** 玩家页面上的开发控制数量（恒为 0；Debug 控制只存在于独立入口）。 */
  readonly debugControls: number;
  /** DOM 里的可点击元素总数（Run Page 全部点击都发生在画布上）。 */
  readonly domButtons: number;
}

/**
 * PRP-M2-NEXT-RUN-SEED-VALIDATION｜Run Page 的**可选**构造项。
 *
 * ⚠️ 全部可省略 —— `new RunPage(root)` 的行为与 PRP-RUN-02 **逐字节相同**
 *    （默认完整 Run 流程：DAY 1 开场 → 四场战斗 → RUN COMPLETE / RUN FAILED）。
 *    只有独立验证入口 `/next-run.html` 会带上这些选项（`npm run dev:next-run`）。
 *
 * ⚠️ 本 Queue **不修改** RUN-02 的默认完整 Run 结构：默认路径上没有新增 phase、
 *    没有新增节点、没有新增强化、没有任何一处分支被改动。
 */
export interface RunPageOptions {
  /**
   * 验证起点：**上一局已 RUN COMPLETE 的真实状态**（`buildPriorCompletedRun` 产出）。
   * 提供后页面从「上一局终局画面」开始；省略 → 从脚本第一个节点（DAY 1）开始。
   */
  readonly priorRun?: RunPageState | null;
  /**
   * 种子三选一（**非空 = 开启验证流程**）。
   * RUN COMPLETE 时唯一主动作不再开默认新局，而是打开这个浮层。
   */
  readonly seedOptions?: readonly RunSeedOption[] | null;
  /**
   * 新 Run 的**第一场**真实战斗结束后停止验证
   * （唯一主动作变成 `NEXT_RUN_VALIDATION_LABEL` 的出口动作，见 `exitHref`）。
   */
  readonly stopAfterFirstBattle?: boolean;
  /**
   * PRP-M2-R1｜验证终点态的**唯一出口**地址（「返回验证中心」按钮要去的页面）。
   *
   * ⚠️ 这里只是**数据**：`href` 会随出口请求原样回传给宿主，供宿主（`nextRunMain.ts`）
   *    执行整页导航。`RunPage` 自己**绝不**写 `location` / `history` ——
   *    `tests/portraitRunPage.test.ts` 的 `RP-25` 机器禁止这件事，因为本文件与
   *    **正式玩家页面**（`run-page.html`）共用，玩家页面必须结构上无法跳转。
   * ⚠️ 未提供（或没给 `onExit`）⇒ 终点态**不画按钮**（而不是画一个点了没反应的按钮）。
   */
  readonly exitHref?: string | null;
  /**
   * PRP-M2-R1｜出口被点击时的处理 —— **由宿主实现**（本 Queue 里 = 整页导航回 Validation Hub）。
   *
   * ⚠️ `RunPage` 只在「终点态 + 有 `exitHref` + 有 `onExit`」三者齐备时调用它，
   *    并且**在调用之前**已经 dispose 掉战斗运行时（计时器 / 物理世界 / 弹丸 / 接触 / 事件订阅）。
   */
  readonly onExit?: ((exit: NextRunFinalAction) => void) | null;
  /**
   * PRODUCT-LOOP-R1-B｜**产品奖励上下文**（省略 / `null` = 不进产品奖励模式）。
   *
   * 提供后：`RUN COMPLETE` 终点态**多一张「本局获得」卡片**，并且主动作文案变为
   * 「领取并返回」、点击行为变为「把出口请求交给宿主」。`FAILED` **不受影响**（无奖励、无出口）。
   *
   * ⚠️ 与 `exitHref` 一样只是**数据**：`RunPage` 不写 `location` / `history`，
   *    整页导航由宿主的 `onProductClaim` 执行（`RP-25` / `RP-27`）。
   * ⚠️ 这条链**不依赖** Next Run Validation（Queue 冻结项：正式产品闭环不依赖研发工具）。
   */
  readonly productReward?: RunProductReward | null;
  /**
   * PRODUCT-LOOP-R1-B｜「领取并返回」被点击时的处理 —— **由宿主实现**（整页导航回正式首页）。
   *
   * ⚠️ 与 `onExit` 同一纪律：`RunPage` 只在「COMPLETE + 有产品上下文 + 有本回调」三者齐备时调用它，
   *    且**在调用之前**已经 `dispose()`（战斗循环 / 物理世界 / 弹丸 / 接触记录 / 事件订阅）。
   * ⚠️ 未提供 ⇒ 终点态**不画奖励卡、不画出口按钮**（而不是画一个点了没反应的按钮）。
   */
  readonly onProductClaim?: ((claim: RunProductClaim) => void) | null;
}

export class RunPage {
  private readonly root: HTMLElement;
  private readonly stageWrap: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  /** IDLE 待机近景的 sprite 表（PRP-local，只服务待机构图）。 */
  private readonly assets = new RunVisualStore();
  /** 真实战斗世界视图宿主（正式 Renderer + 固定远摄相机 + 舞台带贴图）。 */
  private readonly battleView = new RunBattleView();

  /** 固定摄像机：竖屏 390×844 逻辑舞台（复用共享 contain 变换契约）。 */
  private readonly vp = new PlayerViewportTransform(PORTRAIT_LOGICAL_W, PORTRAIT_LOGICAL_H);
  /**
   * 当前 Run 状态。默认 = 全新一局的 DAY 1（`createRunPageState`）；
   * PRP-M2 验证入口可注入「上一局终局」（`opts.priorRun`）。
   */
  private state: RunPageState;
  /** PRP-M2：验证构造项（默认 `{}` → 完整 Run 流程，零行为差异）。 */
  private readonly opts: RunPageOptions;
  /** PRP-M2：种子选择浮层的选项（非 `null` = 浮层打开，盖过当前 state 的浮层）。 */
  private seedSelect: readonly RunSeedOption[] | null = null;
  /** PRP-M2：已经选定的种子 id（`null` = 还没选）。 */
  private seedChosen: string | null = null;
  /** PRP-M2：第一场结束即停止推进（`NEXT RUN VALIDATION COMPLETE`）。 */
  private validationDone = false;
  private rafHandle = 0;
  private lastFrameMs = 0;
  /** 当前遭遇的真实战斗运行时（EVENT 建立 → 回到 IDLE 时释放）。 */
  private battle: RunBattleRuntime | null = null;
  /** 开战瞬间实测的两车外廓间距（证据：开局有明确距离），不是写死数字。 */
  private battleInitialGap = 0;
  /**
   * PRP-BUILD-01-R1：最近一次「动能爆发真实命中」的标记（真实命中点 + 触发时的战斗时刻）。
   * `null` = 当前没有可画的反馈（没触发过 / 已过期 / 战场已冻结）。
   */
  private impactMark: { x: number; y: number; atMs: number } | null = null;
  /** 上一次看到的动能命中计数（计数增加 = 刚刚发生了一次真实 trigger）。 */
  private lastKineticHits = 0;
  private resizeObserver: ResizeObserver | null = null;
  private readonly onWindowResize = (): void => this.render();

  constructor(root: HTMLElement, opts: RunPageOptions = {}) {
    this.opts = opts;
    this.root = root;
    // PRP-M2：验证入口注入「上一局终局」；默认入口 = 全新一局的 DAY 1（行为不变）。
    this.state = opts.priorRun ?? createRunPageState(runPageContext());
    this.stageWrap = document.createElement('div');
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'run-canvas';
    this.ctx = this.canvas.getContext('2d');

    this.buildDom();
    this.observeResize();
    // 真实车辆视觉：正式 sprite 异步加载（完成即重绘；缺失则如实降级）
    this.assets.loadAll(() => this.render());
    this.battleView.onAssetsReady(() => this.render());
    this.render();
  }

  /* ---------------------------------------------------------------- DOM */

  /**
   * 玩家页面 DOM：只有外壳 + 画布，**零开发控制**。
   * 这里刻意不创建任何 <button>：Run Page 的所有点击都命中画布内的布局矩形
   * （命中区与绘制矩形同源），从而结构上不可能出现「页面跳转」或「第二个动作按钮」。
   */
  private buildDom(): void {
    this.root.replaceChildren();
    this.root.classList.add('run-root');
    this.stageWrap.className = 'run-stage';
    this.stageWrap.appendChild(this.canvas);
    this.root.appendChild(this.stageWrap);
  }

  private observeResize(): void {
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.render());
      this.resizeObserver.observe(this.stageWrap);
    }
    window.addEventListener('resize', this.onWindowResize);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
  }

  /** 释放监听（整块删除 / 热更新友好）。 */
  dispose(): void {
    this.stopLoop();
    this.endBattle();
    this.battleView.dispose();
    window.removeEventListener('resize', this.onWindowResize);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
  }

  /* ------------------------------------------------------------- 输入 */

  /**
   * 唯一输入入口：client(viewport CSS px) → 逻辑舞台坐标 → 命中布局矩形。
   * BATTLE 时主动作不可用；浮层（CHOICE / DURABILITY）时只有卡片可点（点遮罩其它位置无副作用）。
   */
  private readonly onPointerDown = (ev: PointerEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    const p = this.vp.clientToLogical(ev.clientX, ev.clientY, rect);

    // PRP-M2：种子选择浮层 —— 与 CHOICE 共用同一套卡片几何（`runChoiceCardRects`），
    // 点遮罩其它区域不关窗、不推进（必须显式选一个）。它优先于当前 Run 的浮层。
    if (this.seedSelect) {
      const seeds = this.seedSelect;
      const seedRects = runChoiceCardRects(seeds.length);
      for (let i = 0; i < seedRects.length; i++) {
        if (hit(seedRects[i], p)) {
          this.chooseSeed(seeds[i].id);
          return;
        }
      }
      return;
    }

    if (runOverlayOpen(this.state)) {
      // ⚠️ PRP-BUILD-01 / RUN-02：卡片的**唯一来源 = 当前浮层上真正画出来的卡片**
      // （CHOICE = 当前候选池；DURABILITY = 耐久事件两项），与绘制、命中区、账本四处同源
      // → 不可能出现「画的是池 A、点的是池 B」。卡片几何两者共用（`runChoiceCardRects`）。
      // ⚠️ PRP-M2：此处改经 `overlayCardsNow()`（种子浮层已在上面的分支被拦掉，
      //    因此走到的这一支与 `runOverlayCards(this.state)` 完全等价）——
      //    `runOverlayCards(` 于是全文件只剩**一个**调用点，源码守卫可机器钉死「单一来源」。
      const cards = this.overlayCardsNow();
      const rects = runChoiceCardRects(cards.length);
      for (let i = 0; i < rects.length; i++) {
        if (hit(rects[i], p)) {
          this.chooseOverlayCard(cards[i].id);
          return;
        }
      }
      return; // 遮罩其它区域：不关窗、不推进（必须显式选一个）
    }

    /*
      PRP-M2-R1｜第一场结束后的验证终点态。
      ⚠️ 这里的 `return` **必须保留**：`RESULT` 在状态机里是 `runActionEnabled === true` 的，
         放过去就会走 `pressRunAction` 推进到第二场 —— 那正是「结构上跑不到第二场」要防的事。
      ⚠️ 但终点态必须接受**自己的唯一出口**（旧实现直接 return ⇒ 点击被吞掉，真人录屏 P0）。
         出口的文案与行为来自**同一个对象**（`finalActionNow()`），结构上不可能分叉。
    */
    if (this.validationDone) {
      const exit = this.finalActionNow();
      if (exit && hit(runActionButtonRect(), p)) this.requestExit(exit);
      return;
    }

    /*
      PRODUCT-LOOP-R1-B｜RUN COMPLETE 的**产品奖励出口**。
      ⚠️ 必须放在 `runActionEnabled(this.state)` **之前**：`COMPLETE` 在状态机里是 `true`
         （默认唯一动作 = 开一个全新 Run），放过去就会变成「点「领取并返回」= 重开新局」
         —— 那正是本 Queue 要避免的「奖励没进库存就悄悄开始下一局」。
      ⚠️ 同样必须 `return`：终点态只接受**自己的唯一出口**，不接受任何推进。
    */
    const claim = this.productClaimNow();
    if (claim) {
      if (hit(runActionButtonRect(), p)) this.requestProductClaim(claim);
      return;
    }

    if (!runActionEnabled(this.state)) return;
    if (hit(runActionButtonRect(), p)) {
      // PRP-M2：验证流程里 RUN COMPLETE 的唯一主动作改写为「打开种子选择」，
      // **不**开默认新局（默认路径没有 `seedOptions` → 这里恒不成立）。
      if (this.opts.seedOptions && runComplete(this.state)) {
        this.openSeedSelect();
        return;
      }
      this.apply(pressRunAction(this.state, runPageContext()));
    }
  };

  /**
   * 浮层卡片被点中 → 落到**当前浮层类型**对应的动作（唯一分派点）。
   *   - CHOICE（强化）→ `chooseRunBuff`（准入仍由状态机校验）；
   *   - DURABILITY（维修 / 继续改装）→ `resolveDurability`。
   */
  private chooseOverlayCard(id: string): void {
    const ctx = runPageContext();
    if (runDurabilityOpen(this.state)) {
      this.apply(resolveDurability(this.state, id as RunDurabilityChoiceId, ctx));
      return;
    }
    this.apply(chooseRunBuff(this.state, id, ctx));
  }

  /* ------------------------------------ PRP-M2 下一局种子验证（可选流程） */

  /**
   * 打开种子选择浮层（验证流程里 RUN COMPLETE 的唯一主动作）。
   *
   * ⚠️ 只改「屏幕上现在有什么」，**不动 Run 状态机** —— 上一局的 `COMPLETE` 状态原样保留，
   *    因此底下的日志 / DAY / 耐久都还是上一局的真实终局（玩家看得见「这是上一局」）。
   */
  private openSeedSelect(): void {
    const seeds = this.opts.seedOptions;
    if (!seeds || seeds.length === 0) return;
    this.seedSelect = seeds;
    this.render();
  }

  /**
   * 选定一个种子 → **开启全新 Run**（必改 2 / 必改 3）。
   *
   *   - 新状态来自 `createSeededNewRun`（满耐久 / DAY 1 / 日志重置 / Build 只剩这一个 seed）
   *     → 与上一局**没有任何共享对象**；
   *   - 上一局的战斗运行时在切换前**彻底释放**（`endBattle` → 世界 / 弹丸 / 事件订阅不跨局残留）；
   *   - 未知种子 → 不进入新局，也**不**回退到「无 seed 新局」（绝不静默降级）。
   */
  private chooseSeed(id: string): void {
    const next = createSeededNewRun(runPageContext(), id);
    if (!next) return;
    this.endBattle();
    this.stopLoop();
    this.seedChosen = id;
    this.seedSelect = null;
    this.validationDone = false;
    this.state = next;
    this.render();
  }

  /** 本帧是否有浮层要画（种子选择优先于当前 Run 的 CHOICE / DURABILITY）。 */
  private overlayOpenNow(): boolean {
    return this.seedSelect !== null || runOverlayOpen(this.state);
  }

  /**
   * 本帧**真正画出来**的浮层卡片（与绘制、命中区、账本同源）。
   *
   * 统一形状 `{ id, label, note }`：
   *   - 种子浮层 → `label` 用种子的 `title`（「重炮开局」= 说的是**下一局的开局**），
   *     卡片图标仍按 `id` 取既有第一层强化的矢量图标（不新增图标）；
   *   - 其余 → 既有 `runOverlayCards`（CHOICE 候选池 / 耐久事件两项）。
   */
  private overlayCardsNow(): readonly RunOverlayOption[] {
    const seeds = this.seedSelect;
    if (seeds) return seeds.map((s) => ({ id: s.id, label: s.title, note: s.note }));
    return runOverlayCards(this.state);
  }

  /** 本帧的浮层标题（种子选择 → 验证文案；否则走既有口径）。 */
  private overlayTitleNow(): string {
    if (this.seedSelect) return NEXT_RUN_SEED_TITLE;
    return runDurabilityOpen(this.state) ? runDurabilityTitle() : '选择一项改装';
  }

  /**
   * PRP-M2-R1｜验证终点态的主动作（`返回验证中心`）—— **唯一真源**。
   *
   * 按钮文案与点击后的行为都从这里取 ⇒ 「有按钮但无 action」在结构上不可能出现。
   *   - 非终点态 → `null`（走 Run 正式流程的 `pressRunAction`）；
   *   - 宿主没给 `exitHref` **或**没给 `onExit` → `null` ⇒ **不画按钮**。
   */
  private finalActionNow(): NextRunFinalAction | null {
    if (!this.opts.onExit) return null;
    return nextRunFinalAction(this.validationDone, this.opts.exitHref);
  }

  /**
   * PRODUCT-LOOP-R1-B｜终点态的**产品奖励出口**（`COMPLETE` + 产品上下文 + 宿主回调三者齐备才有值）。
   *
   * **唯一真源**：按钮文案 / 点击行为 / 探针三处都从这一个方法取
   * ⇒ 「画了奖励但领不到」「有按钮但无 action」在结构上都不可能。
   * ⚠️ `FAILED` 恒为 `null`（`runProductClaimNow` 先查 `runComplete`）—— 必改 4 的结构保证。
   */
  private productClaimNow(): RunProductClaim | null {
    if (!this.opts.onProductClaim) return null;
    return runProductClaimNow(this.state, this.opts.productReward);
  }

  /**
   * 本帧要画的「本局获得」卡片（`null` = 不画）。
   * ⚠️ 与 `productClaimNow()` **同源**：有出口才有卡片，没有出口就没有卡片。
   * ⚠️ 卡片内容里的名称 / 能量 / 外接框全部来自正式内容库（`runRewardCard`），
   *    未知 id 一律 `null`（不画假奖励）。
   */
  private rewardCardNow(): RunRewardCard | null {
    if (!this.productClaimNow()) return null;
    return runRewardCard(this.opts.productReward?.defId);
  }

  /**
   * 主动作是否可用。
   * ⚠️ 默认路径（`validationDone` 恒为 `false`）与 `runActionEnabled(state)` 完全等价。
   * ⚠️ 终点态：有出口 ⇒ 可用（这是本状态下**唯一**可点的东西）；无出口 ⇒ 不可用（且不画）。
   */
  private actionEnabledNow(): boolean {
    if (this.productClaimNow()) return true;
    if (this.validationDone) return this.finalActionNow() !== null;
    return runActionEnabled(this.state);
  }

  /**
   * 主动作文案。
   * ⚠️ 默认路径与 `runActionLabel(state)` 完全等价；终点态 = 出口动作的文案（不是状态描述）。
   * ⚠️ 产品奖励出口优先于验证出口（两者结构上互斥：验证宿主不给 `productReward`，
   *    产品宿主不给 `exitHref`/`onExit`；万一同时给出，产品闭环优先）。
   */
  private actionLabelNow(): string {
    if (this.productClaimNow()) return RUN_REWARD_CLAIM_LABEL;
    const exit = this.finalActionNow();
    return exit ? exit.label : runActionLabel(this.state);
  }

  /**
   * PRP-M2-R1｜终点态的**唯一出口**：清理本页全部运行期状态，然后把出口请求交给**宿主**。
   *
   * 清理面（必改 2）：
   *   - `dispose()` = 停战斗循环（计时器）+ 释放真实战斗运行时（物理世界 / 弹丸 / 接触记录 /
   *     事件订阅）+ 释放视图宿主 + 摘掉 resize / pointer 监听 + 断开 ResizeObserver；
   *   - 验证临时状态：种子浮层引用一并清空（不在本页留下悬挂引用）。
   *
   * ⚠️ **导航不在这里做**：本文件与正式玩家页面共用，`RP-25` 机器禁止 `RunPage` 写
   *    `location` / `history`（玩家页面必须结构上无法跳转）。整页导航属于**宿主**的职责
   *    （`nextRunMain.ts` 的 `onExit`），沿用 Validation Hub 既有口径 —— 不引入路由层。
   * ⚠️ 顺序：**先清理、再交给宿主** —— 导航是异步的，不能依赖它来释放运行时。
   * ⚠️ 刻意**不**复位 `validationDone`：它是「不得推进到第二场」的守卫，
   *    万一导航被浏览器拦下，页面仍停在安全的终点态（而不是退化成可推进的 RESULT）。
   */
  private requestExit(action: NextRunFinalAction): void {
    this.dispose();
    this.seedSelect = null;
    if (this.opts.onExit) this.opts.onExit(action);
  }

  /**
   * PRODUCT-LOOP-R1-B｜「领取并返回」：清理本页运行期状态，然后把**奖励领取请求**交给宿主。
   *
   * ⚠️ 与 `requestExit` 同一纪律 —— **先清理、再交给宿主**；导航是异步的，不能依赖它释放运行时。
   * ⚠️ **本页不写库存、不写存档**（Lab 白名单里没有 `core/buildPersistence` / `core/partInventory`），
   *    也不做整页导航（`RP-25`）。「入库」与「回首页」由产品侧完成：
   *    宿主把请求变成一次带 `run`/`reward` 参数的整页导航 → 产品首页的 Profile Repository
   *    执行**幂等**入库。因此「奖励写入」在单机产品里只有**一个**写入点。
   * ⚠️ 幂等键 = `runToken`（产品侧生成）：重复点击 / 重复结算由产品侧仓库拦截，本页不做乐观发奖。
   */
  private requestProductClaim(claim: RunProductClaim): void {
    this.dispose();
    this.seedSelect = null;
    if (this.opts.onProductClaim) this.opts.onProductClaim(claim);
  }

  /* ------------------------------------------------------- 状态与推进 */

  private apply(next: RunPageState): void {
    if (next === this.state) return; // no-op（BATTLE / CHOICE 误触保护）
    this.state = next;

    // 遭遇即建立真实战斗世界（EVENT 时两车已按正式 spawn 摆在战场两端 → 玩家先看到距离）
    if ((next.phase === 'EVENT' || next.phase === 'BATTLE') && !this.battle) this.beginBattle();
    // 回到 IDLE = 这一局遭遇结束（释放运行时；RESULT / CHOICE 期间战场保持冻结可见）
    if (next.phase === 'IDLE' && this.battle) this.endBattle();

    if (next.phase === 'BATTLE') {
      this.startLoop();
    } else {
      this.stopLoop();
    }
    this.render();
  }

  /**
   * 建立真实战斗运行时（正式 `PlanckBattleOrchestrator`，零 config 覆盖）。
   *
   * PRP-BUILD-01：每次遭遇都**全新创建**，并把本局的 Run-local 状态注入进去：
   *   - `build`      = 本局 Build（第一层 + 第二层，按选择顺序；overlay registry + 武器 defId 重映射，
   *                    能力类（动能爆发）由运行时订阅正式战斗事件驱动）；
   *   - `carriedHp`  = 上一场真实剩余耐久（+ 维修补偿；下一场从这里继续，不自动满血）。
   * 旧运行时在此前已被 `endBattle()` 释放 → 弹丸 / 接触 / 事件订阅不跨场残留。
   *
   * ⚠️ PRP-RUN-02：本场对手 = **当前脚本节点的 `encounterId`**（四场压力阶梯的唯一来源）。
   *    页面里没有 `if (day === X)`：换对手只是「当前节点是谁」这**一个**事实的推论。
   */
  private beginBattle(): void {
    this.endBattle();
    const rt = new RunBattleRuntime({
      build: runBuildIds(this.state),
      carriedHp: runCarriedPlayerHp(this.state),
      encounterId: runCurrentNode(this.state).encounterId,
    });
    this.battle = rt;
    // 实测开局外廓间距（不是写死数字）——「开局有明确距离」的证据
    this.battleInitialGap = rt.gapWorld();
    // PRP-BUILD-01-R1：新一场 → 清掉上一场的命中反馈标记（不跨场残留）
    this.impactMark = null;
    this.lastKineticHits = 0;
  }

  /** 释放战斗运行时（战斗世界中双方位置/HP 随之不再保留 → 下一次遭遇从正式 spawn 重来）。 */
  private endBattle(): void {
    if (!this.battle) return;
    this.battle.dispose();
    this.battle = null;
    this.battleInitialGap = 0;
    this.impactMark = null;
    this.lastKineticHits = 0;
  }

  /**
   * PRP-BUILD-01-R1：把「Run 能力真的触发了一次动能爆发」翻译成一个**带真实位置与时刻**的标记。
   *
   * 判据 = `abilities.kineticHits` **计数增加**（只由真实的 `damage` 事件 + 真实 trigger 递增）→
   * 结构上不可能出现「物理没发生但先画了环」。位置取其 `lastKineticHit`（= 真实 `contactPoint`），
   * 触发时刻取**战斗自己的时钟** `rt.timeMs`（与之后读 age 同源，不引入第二套时间）。
   *
   * ⚠️ 战场冻结（`result !== null`）时不保留任何活动特效 → 不破坏「RESULT = 战场冻结」。
   * ⚠️ **过期即清空**：标记只表示「此刻有活动反馈」，寿命一到就回到 `null`
   *   （probe 的 `kineticImpact === null` 语义 = 没触发过 / 已过期 / 战场已冻结；
   *    否则会留下一个 `ageMs` 无上限增长的僵尸标记，让「环是短的」这件事只能靠读半径间接证明）。
   *   寿命边界上环的 alpha 正好为 0 → 清空是视觉无缝的（不会「环突然消失」）。
   */
  private syncKineticImpact(rt: RunBattleRuntime): void {
    if (rt.result !== null) {
      this.impactMark = null;
      return;
    }
    const ab = rt.abilitySnapshot();
    if (ab.kineticHits !== this.lastKineticHits) {
      this.lastKineticHits = ab.kineticHits;
      const hit = ab.lastKineticHit;
      if (hit) {
        this.impactMark = { x: hit.x, y: hit.y, atMs: rt.timeMs };
        return;
      }
    }
    if (this.impactMark !== null && rt.timeMs - this.impactMark.atMs > RUN_IMPACT_RING_MS) {
      this.impactMark = null;
    }
  }

  /**
   * 战斗循环：**真实物理时间**推进正式 Orchestrator。
   *
   * 每帧：`runtime.step(dt)` → 同步真实 HP / 真实步数（不写日志）→
   * 官方出结果的那一刻一次性 `finishRunBattle` → RESULT。
   * 这里**没有任何战斗剧本**：步数、伤害、结束时间全部由物理与正式规则决定。
   */
  private startLoop(): void {
    if (this.rafHandle !== 0) return;
    this.lastFrameMs = performance.now();
    const tick = (now: number): void => {
      const dt = Math.min(64, now - this.lastFrameMs);
      this.lastFrameMs = now;
      const rt = this.battle;
      if (this.state.phase !== 'BATTLE' || !rt) {
        this.rafHandle = 0;
        return;
      }

      rt.step(dt);
      // PRP-BUILD-01-R1：真实战斗事件 → 命中冲击环标记（必须在读 hp / result 之前，
      // 使「命中帧」与「画出环的第一帧」是同一帧，age 从 0 开始）
      this.syncKineticImpact(rt);
      const hp = rt.hp();
      this.state = syncRunBattle(this.state, {
        playerHp: hp.a,
        enemyHp: hp.b,
        steps: rt.stepCount,
      });

      const result = rt.result;
      if (result) {
        this.state = finishRunBattle(this.state, {
          winner: result.winner ?? null,
          endReason: result.endReason ?? null,
          playerHp: hp.a,
          enemyHp: hp.b,
          steps: rt.stepCount,
        });
        // PRP-M2：验证流程在第一场真实战斗结束后**停止**。
        // 判据取状态机回报的**真实完成场数**（不是「点了第几下」）→
        // 结构上不可能出现「第一场还没打完就宣布验证完成」。
        if (this.opts.stopAfterFirstBattle && this.state.battlesCompleted >= 1) {
          this.validationDone = true;
        }
        this.rafHandle = 0; // 战斗结束 → 自动停止循环（RESULT 是一个静止画面）
        this.render();
        return;
      }

      this.render();
      this.rafHandle = requestAnimationFrame(tick);
    };
    this.rafHandle = requestAnimationFrame(tick);
  }

  private stopLoop(): void {
    if (this.rafHandle !== 0) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = 0;
    }
  }

  /* ------------------------------------------------------------- 渲染 */

  private render(): void {
    // 固定摄像机：容器 / DPR 变化只重算 contain；逻辑舞台恒为 390×844，永不 reframe。
    const wrapW = this.stageWrap.clientWidth || PORTRAIT_LOGICAL_W;
    const wrapH = this.stageWrap.clientHeight || PORTRAIT_LOGICAL_H;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    this.vp.update(wrapW, wrapH, dpr);
    this.vp.applyTo(this.canvas); // 会重置 canvas 尺寸 → 上下文变换必须在其后设置

    const ctx = this.ctx;
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // 之后全部按逻辑 px 绘制
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      this.draw(ctx);
    }
  }

  /** IDLE 待机近景（**只服务 IDLE**：战斗阶段由真实战斗世界接管舞台带）。 */
  private stageView(): RunStageView {
    return buildRunStageView();
  }

  /**
   * 本帧的「纯色几何层」。构造逻辑在 `runPageScene.runPageLayerShapes`（纯函数 →
   * node 侧可直接断言同一份账本，浏览器端再用真实 getImageData 交叉核对）。
   */
  private layeredShapes(): RunLayeredRect[] {
    // PRP-M2：种子选择 = 整页遮罩 + 三张卡片 —— 与被遮罩的底层几何**互斥**
    // （与 CHOICE 完全同源：只登记 `cardBar`）。若沿用 `runPageLayerShapes(state)`，
    // 会登记一批实际上被遮罩盖掉的层，账本立刻与实际渲染不符。
    const seeds = this.seedSelect;
    if (seeds) {
      return runChoiceCardRects(seeds.length).map((card) => ({
        layer: 'cardBar' as const,
        rect: runChoiceBarRect(card),
      }));
    }
    const shapes = runPageLayerShapes(this.state, this.stageView());
    // PRP-M2：验证停止态下唯一主动作不可用 → 底部强调条不入账（与实际绘制一致）。
    // ⚠️ 默认路径 `actionEnabledNow() === runActionEnabled(state)` → 与既有账本逐项相同。
    // ⚠️ PRP-M2-R1：验证终点态下 `actionEnabledNow()` 为 `true`（有出口）⇒ `actionBar` 正常入账；
    //    万一宿主没给出口（不画按钮），这里也同步不入账 —— 绘制与账本同源。
    return this.actionEnabledNow() ? shapes : shapes.filter((s) => s.layer !== 'actionBar');
  }

  private draw(ctx: CanvasRenderingContext2D): void {
    const s = this.state;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';

    // 1) 底色 + 四条横带（无缝无叠：y 由 runPageLayout 递推得到）
    ctx.fillStyle = COLORS.pageBg;
    ctx.fillRect(0, 0, RUN_PAGE_W, RUN_PAGE_H);
    ctx.fillStyle = COLORS.topBandBg;
    ctx.fillRect(RUN_TOP_BAND.x, RUN_TOP_BAND.y, RUN_TOP_BAND.w, RUN_TOP_BAND.h);
    ctx.fillStyle = COLORS.logBandBg;
    ctx.fillRect(RUN_LOG_BAND.x, RUN_LOG_BAND.y, RUN_LOG_BAND.w, RUN_LOG_BAND.h);
    ctx.fillStyle = COLORS.actionBandBg;
    ctx.fillRect(RUN_ACTION_BAND.x, RUN_ACTION_BAND.y, RUN_ACTION_BAND.w, RUN_ACTION_BAND.h);

    // 2) 中部舞台：两种模式二选一，**绝不同时出现**
    //    - IDLE：PRP 待机近景（天空 / 远山 / 路面 / 地线 / 玩家车）
    //    - EVENT / BATTLE / RESULT / CHOICE：真实 Planck 战斗世界
    //      （离屏画布 = 舞台带尺寸 → clip 由「画布即带」结构性保证，只有一次 1:1 贴图）
    const view = this.stageView();
    if (s.phase === 'IDLE' || !this.battle) {
      // 兜底：战斗运行时缺失（结构上不可达，除非宿主未按契约建立）→ 如实画待机近景
      this.drawBackdrop(ctx, view);
      this.drawEntity(ctx, view.player);
    } else {
      this.battleView.render(this.battle);
      this.battleView.blit(ctx);
      // PRP-BUILD-01-R1：动能爆发的真实命中反馈。
      // ⚠️ 必须画在**分带线之前**：环只落在舞台带内，分带线随后覆盖带内首行 →
      //    分带线像素保持精确（入账面积不受任何影响）。
      this.drawKineticImpact(ctx);
    }

    // 分带线（1px）。⚠️ 画在下一条带的**首行**（`band.y`）而不是上一条带的末行（`band.y - 1`）：
    // 后者会吃掉路面最底一行，使「路面 = 纯色矩形」的精确面积断言与实际渲染差一整行。
    // 画在带内首行 → 只覆盖不承载入账色的分带底色，四条带的纯色几何面积与模型完全一致。
    ctx.fillStyle = COLORS.divider;
    for (const band of RUN_BANDS.slice(1)) ctx.fillRect(band.x, band.y, band.w, 1);

    // 3) 顶部薄层（必改 1：只有 DAY 一行 + 已获得图标一行，没有空槽、没有计数）
    this.drawTopBand(ctx, s);

    // 4) 下部冒险记录（必改 3：自然语言叙事、底部对齐、最近突出）
    this.drawLog(ctx, s);

    // 5) 最底：唯一主动作按钮（填充承载文案 → 不入账；底部强调条入账）
    this.drawActionButton(ctx);

    // 5b) PRODUCT-LOOP-R1-B：RUN COMPLETE 的「本局获得」卡片
    //     ⚠️ 只在**产品奖励出口真的存在**时绘制（`rewardCardNow()` 与出口同源）
    //        ⇒ 既有入口（不带产品上下文）一个像素都不变。
    //     ⚠️ 位置在**舞台带内、底部对齐**：不与日志带叙事 / 动作带按钮争位。
    //     ⚠️ 复用**已有**的非入账配色（cardBg / cardEdge / dayAccent / text*），
    //        不引入任何新色 ⇒ 与像素账本调色板天然互斥。
    this.drawRewardCard(ctx);

    // 6) 浮层（必改 4：整页重压暗 + 「图标 / 名称 / 一句结果」卡片）
    //    - CHOICE     = 三选一强化（第一层固定 / 第二层条件池）
    //    - DURABILITY = 耐久取舍（维修 vs 继续改装）
    //    - PRP-M2     = 种子选择（「下一局起始改装」三选一；同为卡片几何）
    if (this.overlayOpenNow()) this.drawOverlay(ctx);
  }

  /* ------------------------------------------ PRP-BUILD-01-R1 命中冲击环 */

  /**
   * 动能爆发的**极简命中反馈**：一个很短的冲击环 + 一个更短的核心亮点，
   * 画在**这一次真实命中的真实位置**上。
   *
   * 它**不是**用特效替代物理（真实位移 / 旋转由 `RunBuildAbilities` 的真实冲量产生），
   * 只负责告诉玩家「额外冲击就是在这一刻、这一点发生的」—— 这是「存在 → 可感知」这一步
   * 唯一缺的东西：物理量已经真实改变，但观众无从把改变归因到哪一炮。
   *
   * 纪律（Queue 必改 3）：
   *   - 短：`RUN_IMPACT_RING_MS`（0.28s）后 `runImpactRingShapes` 返回空 → 自然消失，无残留；
   *   - 只在真实 trigger 时出现：由 `kineticHits` 计数增加驱动（见 `syncKineticImpact`）；
   *   - 位置来自真实 hit position：`battleBandX/Y(xf, mark.x/y)`，与冲量作用点同源；
   *   - 不做大爆炸：只有细描边圆环 + 极小亮点，**无填充色块、无粒子、无屏震**；
   *   - 不遮挡车辆：环从命中点向外扩张且**内部不填充**，描边随寿命变细、透明度递减；
   *   - 只在舞台带内绘制（clip）→ 不渗进顶部 / 日志 / 动作带。
   */
  private drawKineticImpact(ctx: CanvasRenderingContext2D): void {
    const rt = this.battle;
    const mark = this.impactMark;
    if (!rt || !mark || rt.result !== null) return;
    const ageMs = rt.timeMs - mark.atMs;
    const rings = runImpactRingShapes(ageMs);
    const core = runImpactCoreShape(ageMs);
    if (rings.length === 0 && !core) return;

    const xf = this.battleView.viewTransform();
    const band = RUN_STAGE_BAND;
    const cx = band.x + battleBandX(xf, mark.x);
    const cy = band.y + battleBandY(xf, mark.y);

    ctx.save();
    ctx.beginPath();
    ctx.rect(band.x, band.y, band.w, band.h);
    ctx.clip();
    ctx.lineCap = 'round';
    for (const ring of rings) {
      if (ring.alpha <= 0 || ring.lineWidth <= 0 || ring.radius <= 0) continue;
      ctx.globalAlpha = ring.alpha;
      ctx.strokeStyle = COLORS.impactRing;
      ctx.lineWidth = ring.lineWidth;
      ctx.beginPath();
      ctx.arc(cx, cy, ring.radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (core && core.alpha > 0 && core.radius > 0) {
      ctx.globalAlpha = core.alpha;
      ctx.fillStyle = COLORS.impactCore;
      ctx.beginPath();
      ctx.arc(cx, cy, core.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /* --------------------------------------------------- 舞台：背景与车辆 */

  /**
   * 天空（垂直渐变） → 远山 → 近山 → 路面 → 地线（确定性，无随机）。
   *
   * ⚠️ PRP-R3 必改 2：舞台带高 302px，如果天空是一整块平涂色，上半带就是「大片无意义空黑」。
   * 这里用**色调渐变**（夜空 → 地平线暖雾）把这块空间铺成有方向的纵深，
   * 而不是往背景里堆形状 —— 背景元素一多就会与战车争夺注意力（战车必须是第一眼主体）。
   * 渐变的暖端只到地平线为止，不会渗进路面（路面 / 地线仍是可精确冻结的纯色矩形）。
   */
  private drawBackdrop(ctx: CanvasRenderingContext2D, view: RunStageView): void {
    const band = RUN_STAGE_BAND;
    const horizon = view.groundY;
    const sky = ctx.createLinearGradient(0, band.y, 0, horizon);
    sky.addColorStop(0, COLORS.stageSky);
    sky.addColorStop(Math.max(0, 1 - RUN_STAGE_HAZE_H / (horizon - band.y)), COLORS.stageHaze);
    sky.addColorStop(1, COLORS.horizonGlow);
    ctx.fillStyle = sky;
    ctx.fillRect(band.x, band.y, band.w, band.h);

    const hills = runStageHills();
    ctx.fillStyle = COLORS.hillFar;
    for (const h of hills.far) this.trapezoid(ctx, h.x, horizon - 6, h.w, h.h, 0.5);
    ctx.fillStyle = COLORS.hillNear;
    for (const h of hills.near) this.trapezoid(ctx, h.x, horizon - 6, h.w, h.h, 0.62);

    ctx.fillStyle = COLORS.road;
    ctx.fillRect(view.road.x, view.road.y, view.road.w, view.road.h);
    ctx.fillStyle = COLORS.ground;
    ctx.fillRect(view.ground.x, view.ground.y, view.ground.w, view.ground.h);
  }

  /** 以 baseY 为底、w 宽 h 高、上边收窄 ratio 的梯形（山脊剪影）。 */
  private trapezoid(
    ctx: CanvasRenderingContext2D,
    x: number,
    baseY: number,
    w: number,
    h: number,
    ratio: number,
  ): void {
    const inset = (w * ratio) / 2;
    ctx.beginPath();
    ctx.moveTo(x, baseY);
    ctx.lineTo(x + inset, baseY - h);
    ctx.lineTo(x + w - inset, baseY - h);
    ctx.lineTo(x + w, baseY);
    ctx.closePath();
    ctx.fill();
  }

  /**
   * 一个实体的全部可视件。
   *
   * ⚠️ PRP-R3 必改 2：**不存在任何「纯色矩形代表车辆」的降级绘制**。
   *   - 轮组（无 sprite）→ 按**真实半径**画圆（正式 Renderer 同样是程序化画轮）；
   *   - 其余可视件 → 必须是正式 sprite；资源尚未加载完成时**整件不画**
   *     （加载完成会触发重绘），绝不画灰块冒充车辆。
   *   - 无正式 `visual` 的辅助部件在 scene 层已被整件剔除（不会走到这里）。
   */
  private drawEntity(ctx: CanvasRenderingContext2D, e: RunStageEntityView): void {
    for (const v of e.visuals) {
      if (v.kind === 'wheel' && !v.visualId) {
        this.drawWheel(ctx, v.rect);
        continue;
      }
      const img = v.visualId ? this.assets.get(v.visualId) : undefined;
      if (img) this.drawSprite(ctx, img, v);
    }
  }

  /**
   * sprite 绘制：transform 与正式 `Renderer.drawVisual` 完全一致 ——
   * translate(中心) · scale(-1,1)[mirror] · rotate(rotation=0)，以中心为原点绘制。
   */
  private drawSprite(
    ctx: CanvasRenderingContext2D,
    img: CanvasImageSource,
    v: RunPlacedVisual,
  ): void {
    const r = v.rect;
    ctx.save();
    ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
    if (v.mirror) ctx.scale(-1, 1);
    ctx.drawImage(img, -r.w / 2, -r.h / 2, r.w, r.h);
    ctx.restore();
  }

  /** 轮组：真实半径 → 深色胎体 + 金属轮圈 + 辐条（无 sprite 时的真实几何降级）。 */
  private drawWheel(ctx: CanvasRenderingContext2D, r: RunRect): void {
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const radius = Math.max(2, r.w / 2);
    ctx.fillStyle = COLORS.wheelTire;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COLORS.wheelRim;
    ctx.lineWidth = Math.max(1, radius * 0.16);
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.74, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.24, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - radius * 0.74, cy);
    ctx.lineTo(cx + radius * 0.74, cy);
    ctx.stroke();
  }

  /* --------------------------------------------------------- 顶部薄层 */

  private drawTopBand(ctx: CanvasRenderingContext2D, s: RunPageState): void {
    ctx.fillStyle = COLORS.textTitle;
    ctx.font = `bold 20px ${FONT_STACK}`;
    ctx.fillText(`DAY ${s.day} / ${s.dayTotal}`, 16, 34);

    runDayNodes(s.dayTotal).forEach((r, i) => {
      ctx.fillStyle = i < s.day ? COLORS.nodeDone : COLORS.nodeTodo;
      ctx.fillRect(r.x, r.y, r.w, r.h);
    });

    // 只画**实际已获得**的强化图标：没有强化时这一行完全不存在（不是五个空框）
    const icons = runBuffIconRects(s.buffs.length);
    icons.forEach((icon, i) => {
      const buff = s.buffs[i];
      ctx.fillStyle = BUFF_ICON_COLOR[buff.id] ?? COLORS.iconReload;
      ctx.fillRect(icon.x, icon.y, icon.w, icon.h);
      const chip = runBuffIconChip(icon);
      ctx.fillStyle = COLORS.buffChip;
      ctx.fillRect(chip.x, chip.y, chip.w, chip.h);
    });
  }

  /* --------------------------------------------------------- 冒险记录 */

  private drawLog(ctx: CanvasRenderingContext2D, s: RunPageState): void {
    ctx.fillStyle = COLORS.textDim;
    ctx.font = `12px ${FONT_STACK}`;
    ctx.fillText('冒险记录', RUN_LOG_LABEL_POS.x, RUN_LOG_LABEL_POS.y);

    const lines = visibleRunLog(s, RUN_LOG.maxLines);
    const rects = runLogLineRects(lines.length);
    lines.forEach((e, i) => {
      const r = rects[i];
      if (!r) return;
      const age = lines.length - 1 - i; // 0 = 最新
      this.drawLogLine(ctx, e, r, age);
    });
  }

  /** 单条叙事行：DAY 行加粗高亮；最近 `emphasis` 行清晰；更早的行弱化。 */
  private drawLogLine(
    ctx: CanvasRenderingContext2D,
    e: RunLogEntry,
    r: RunRect,
    age: number,
  ): void {
    const recent = age < RUN_LOG.emphasis;
    if (e.kind === 'day') {
      ctx.fillStyle = COLORS.dayAccent;
      ctx.font = `bold 15px ${FONT_STACK}`;
    } else if (e.kind === 'durability') {
      ctx.fillStyle = recent ? COLORS.textBody : COLORS.textFaint;
      ctx.font = `bold 15px ${FONT_STACK}`;
    } else {
      ctx.fillStyle = recent ? COLORS.textBody : COLORS.textFaint;
      ctx.font = `15px ${FONT_STACK}`;
    }
    ctx.fillText(this.ellipsize(ctx, formatRunLog(e), r.w), r.x, r.y + 19);
  }

  /* ------------------------------------------------------- 主动作按钮 */
  private drawActionButton(ctx: CanvasRenderingContext2D): void {
    // ⚠️ PRP-M2-R1（防无效按钮再次出现）：终点态**没有出口就一个按钮都不画**。
    //    否则就会出现「可见但点了没反应」的按钮 —— 那正是本 Queue 要根除的形态。
    if (this.validationDone && this.finalActionNow() === null) return;
    const btn = runActionButtonRect();
    // ⚠️ PRP-M2：这里读的是**本帧实际口径**（默认路径与 `runActionEnabled(s)` /
    //    `runActionLabel(s)` 完全等价）—— 验证终点态下按钮**可用**，文案 = 「返回验证中心」。
    const enabled = this.actionEnabledNow();
    ctx.fillStyle = enabled ? COLORS.actionFill : COLORS.actionFillOff;
    ctx.fillRect(btn.x, btn.y, btn.w, btn.h);
    ctx.strokeStyle = enabled ? COLORS.actionEdge : COLORS.divider;
    ctx.lineWidth = 2;
    ctx.strokeRect(btn.x + 1, btn.y + 1, btn.w - 2, btn.h - 2);
    const bar = runActionBarRect();
    ctx.fillStyle = enabled ? COLORS.actionBtn : COLORS.actionBtnOff;
    ctx.fillRect(bar.x, bar.y, bar.w, bar.h);
    ctx.fillStyle = enabled ? COLORS.textTitle : COLORS.textDim;
    ctx.font = `bold 18px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.fillText(this.actionLabelNow(), btn.x + btn.w / 2, btn.y + 32);
    ctx.textAlign = 'left';
  }

  /* --------------------------------------------- RUN COMPLETE：本局获得卡片 */

  /**
   * PRODUCT-LOOP-R1-B｜「本局获得」卡片（Queue 必改 3：RUN COMPLETE 从测试结算变成**产品结算**）。
   *
   * 这一张卡承担四件事，全部只陈述**真的发生了**的东西：
   *   - 标题「本局获得」；
   *   - 部件**名称**（来自正式内容库 `registry.functionals`，不是页面上另写一份字面量）；
   *   - 「**最低必要视觉**」= 该部件真实 Collider 的外接框（`rewardColliderGeom`）；
   *     该部件没有正式 sprite 时**明确标注**（`hasSprite === false`）—— 不假装用了真实美术；
   *   - 一行说明「领取后进入你的车库」—— 是**承诺**（点击才发生），不是已完成的状态描述。
   *
   * ⚠️ 卡片不做任何动画 / 稀有度 / 宝箱 / 多奖励（Queue 明令「不做」清单）。
   * ⚠️ 数值只展示正式定义里的**能量**（`def.energy`），本 Queue 不新增任何数值系统。
   * ⚠️ 绘制 / 探针同源：探针里的 `rewardCardRect` 直接来自 `runRewardCardRect()`。
   */
  private drawRewardCard(ctx: CanvasRenderingContext2D): void {
    const card = this.rewardCardNow();
    if (!card) return;

    const r = runRewardCardRect();
    ctx.fillStyle = COLORS.cardBg;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = COLORS.cardEdge;
    ctx.lineWidth = 2;
    ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);

    // ① 左侧：真实 Collider 外接框（无 sprite 时如实标注，不画 sprite 冒充）
    const box = runRewardIconRect();
    ctx.fillStyle = COLORS.pageBg;
    ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.strokeStyle = COLORS.cardEdge;
    ctx.lineWidth = 1;
    ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);
    const fit = fitRewardIcon(card, box.w - 16, box.h - 16);
    const shapeX = box.x + Math.round((box.w - fit.w) / 2);
    const shapeY = box.y + Math.round((box.h - fit.h) / 2);
    ctx.fillStyle = COLORS.wheelRim;
    if (card.round) {
      ctx.beginPath();
      ctx.ellipse(shapeX + fit.w / 2, shapeY + fit.h / 2, fit.w / 2, fit.h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(shapeX, shapeY, fit.w, fit.h);
    }

    // ② 右侧：标题 / 名称 / 一行说明
    const text = runRewardTextPos();
    ctx.fillStyle = COLORS.dayAccent;
    ctx.font = `13px ${FONT_STACK}`;
    ctx.fillText(RUN_REWARD_TITLE, text.x, text.y);

    ctx.fillStyle = COLORS.textTitle;
    ctx.font = `bold 21px ${FONT_STACK}`;
    ctx.fillText(card.name, text.x, text.y + 30);

    ctx.fillStyle = COLORS.textDim;
    ctx.font = `12px ${FONT_STACK}`;
    const note = card.hasSprite
      ? `能量 ${card.energy} · ${RUN_REWARD_NOTE}`
      : `能量 ${card.energy} · ${RUN_REWARD_NOTE} · 暂无美术（按碰撞体显示）`;
    ctx.fillText(this.ellipsize(ctx, note, r.x + r.w - text.x - 12), text.x, text.y + 52);

    // ③ 图标框右下角：部件 id（最小必要的技术标识，便于与工厂/测试对上）
    ctx.fillStyle = COLORS.textFaint;
    ctx.font = `10px ${FONT_STACK}`;
    ctx.fillText(card.defId, box.x + 4, box.y + box.h - 5);
  }

  /* ------------------------------------------------------------ 浮层 */

  /**
   * 浮层（CHOICE 强化 / DURABILITY 耐久事件）——**两者共用同一套卡片几何与绘制**，
   * 因此「第二次选择不是同一套通用三选一」是靠**内容**（池 / 标题 / 选项数）区分的，
   * 而不是靠第二套几何。⚠️ 零布局改动（`cardBar` 层被两者复用）。
   */
  private drawOverlay(ctx: CanvasRenderingContext2D): void {
    const mask = runChoiceMaskRect();
    ctx.fillStyle = CHOICE_MASK_COLOR;
    ctx.fillRect(mask.x, mask.y, mask.w, mask.h);

    // ⚠️ 卡片 / 标题 / 图标全部取自**本帧真正画出来的卡片**（`overlayCardsNow`：
    //    种子选择优先，其次 state 的 CHOICE / DURABILITY）—— 因此种子浮层与三选一强化
    //    在几何上是同一套（不可能出现两套尺寸 / 两套命中区）。
    const cards = this.overlayCardsNow();
    const rects = runChoiceCardRects(cards.length);
    const title = runChoiceTitlePos(cards.length);
    ctx.fillStyle = COLORS.textTitle;
    ctx.font = `bold 17px ${FONT_STACK}`;
    ctx.fillText(this.overlayTitleNow(), title.x, title.y);
    // PRP-M2：种子浮层额外一行引导语，说清这是**下一局**（不是继续上一局）。
    // ⚠️ 画在标题上方 26px —— 不落在任何入账面 / 卡片上，账本口径不变。
    if (this.seedSelect) {
      ctx.fillStyle = COLORS.textDim;
      ctx.font = `13px ${FONT_STACK}`;
      ctx.fillText(NEXT_RUN_SEED_LEAD, title.x, title.y - 26);
    }

    rects.forEach((card, i) => {
      const opt = cards[i];
      ctx.fillStyle = COLORS.cardBg;
      ctx.fillRect(card.x, card.y, card.w, card.h);
      ctx.strokeStyle = COLORS.cardEdge;
      ctx.lineWidth = 2;
      ctx.strokeRect(card.x + 1, card.y + 1, card.w - 2, card.h - 2);
      // 顶部强调条（纯色、无文字、不被描边 / 图标覆盖 → 入面积账本）
      const bar = runChoiceBarRect(card);
      ctx.fillStyle = COLORS.cardBar;
      ctx.fillRect(bar.x, bar.y, bar.w, bar.h);

      this.drawChoiceIcon(ctx, opt.id, runChoiceIconRect(card));

      const tx = runChoiceTextX(card);
      ctx.fillStyle = COLORS.textTitle;
      ctx.font = `bold 17px ${FONT_STACK}`;
      ctx.fillText(opt.label, tx, card.y + 44);
      ctx.fillStyle = COLORS.textBody;
      ctx.font = `13px ${FONT_STACK}`;
      ctx.fillText(this.ellipsize(ctx, opt.note, card.x + card.w - tx - 16), tx, card.y + 72);
    });
  }

  /** 浮层标题的唯一口径见 `overlayTitleNow()`（默认路径 = 强化固定文案 / 耐久事件脚本标题）。 */

  /**
   * 每个选项一个可辨识的矢量图标（不入面积账本，只按「盒内专属色面积」判定）。
   *
   *   heavyShell      = 粗弹体 + 尖头
   *   twinCannon      = 两根并排炮管 + 两发弹头
   *   fastReload      = 环形循环箭头
   *   kineticBurst    = 弹体 + 命中点向外扩散的三道冲击波
   *   tripleLoad      = 三根并排炮管（比双联多一根）+ 底横条
   *   emergencyRepair = 修理十字
   *   repair          = 扳手（耐久事件：维修）
   *   upgrade         = 齿轮（耐久事件：继续改装）
   */
  private drawChoiceIcon(ctx: CanvasRenderingContext2D, id: string, r: RunRect): void {
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const s = r.w;
    ctx.fillStyle = CHOICE_ICON_COLOR[id] ?? COLORS.textBody;
    if (id === 'heavyShell') {
      // 重型弹头：矩形弹体 + 尖头（比基础弹更粗壮）
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.42, cy - s * 0.16);
      ctx.lineTo(cx + s * 0.12, cy - s * 0.16);
      ctx.lineTo(cx + s * 0.42, cy);
      ctx.lineTo(cx + s * 0.12, cy + s * 0.16);
      ctx.lineTo(cx - s * 0.42, cy + s * 0.16);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(cx - s * 0.48, cy - s * 0.06, s * 0.08, s * 0.12);
    } else if (id === 'twinCannon') {
      // 双联炮：两根并排炮管 + 两发弹头（一眼看出「一次打两发」）
      const bw = s * 0.2;
      const bh = s * 0.46;
      for (const dx of [-s * 0.22, s * 0.02]) {
        ctx.fillRect(cx + dx, cy - bh / 2, bw, bh);
        ctx.beginPath();
        ctx.moveTo(cx + dx, cy - bh / 2);
        ctx.lineTo(cx + dx + bw / 2, cy - bh / 2 - s * 0.16);
        ctx.lineTo(cx + dx + bw, cy - bh / 2);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillRect(cx - s * 0.28, cy + bh / 2, s * 0.56, s * 0.1);
    } else if (id === 'kineticBurst') {
      // 动能爆发：弹体 + 命中点向外扩散的三道冲击波
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.48, cy - s * 0.11);
      ctx.lineTo(cx - s * 0.08, cy - s * 0.11);
      ctx.lineTo(cx - s * 0.02, cy);
      ctx.lineTo(cx - s * 0.08, cy + s * 0.11);
      ctx.lineTo(cx - s * 0.48, cy + s * 0.11);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = Math.max(2, s * 0.075);
      ctx.strokeStyle = ctx.fillStyle;
      for (const rr of [0.2, 0.32, 0.44]) {
        ctx.beginPath();
        ctx.arc(cx - s * 0.04, cy, s * rr, -Math.PI * 0.42, Math.PI * 0.42);
        ctx.stroke();
      }
    } else if (id === 'tripleLoad') {
      // 三连装填：三根并排炮管（比双联多一根）+ 底横条
      const bw = s * 0.16;
      const bh = s * 0.44;
      for (const dx of [-s * 0.26, -s * 0.08, s * 0.1]) {
        ctx.fillRect(cx + dx, cy - bh / 2, bw, bh);
        ctx.beginPath();
        ctx.moveTo(cx + dx, cy - bh / 2);
        ctx.lineTo(cx + dx + bw / 2, cy - bh / 2 - s * 0.14);
        ctx.lineTo(cx + dx + bw, cy - bh / 2);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillRect(cx - s * 0.3, cy + bh / 2, s * 0.6, s * 0.1);
    } else if (id === 'emergencyRepair') {
      // 紧急维修：修理十字
      ctx.fillRect(cx - s * 0.12, cy - s * 0.44, s * 0.24, s * 0.88);
      ctx.fillRect(cx - s * 0.44, cy - s * 0.12, s * 0.88, s * 0.24);
    } else if (id === 'repair') {
      // 维修（耐久事件）：扳手 —— 斜杆 + 两端开口头（与「紧急维修十字」形状明显不同）
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-Math.PI / 4);
      ctx.fillRect(-s * 0.08, -s * 0.34, s * 0.16, s * 0.62);
      ctx.beginPath();
      ctx.arc(0, -s * 0.34, s * 0.17, Math.PI * 0.85, Math.PI * 2.15);
      ctx.lineTo(0, -s * 0.34);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(-s * 0.2, s * 0.24, s * 0.4, s * 0.12);
      ctx.restore();
    } else if (id === 'upgrade') {
      // 继续改装（耐久事件）：齿轮 —— 中心环 + 八颗齿（与全部强化图标形状互异）
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = Math.max(3, s * 0.1);
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.3, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        ctx.save();
        ctx.translate(cx + Math.cos(a) * s * 0.38, cy + Math.sin(a) * s * 0.38);
        ctx.rotate(a);
        ctx.fillRect(-s * 0.07, -s * 0.07, s * 0.14, s * 0.14);
        ctx.restore();
      }
    } else {
      // 快速装填：环形循环箭头（装填节奏变快）
      ctx.lineWidth = Math.max(2, s * 0.11);
      ctx.strokeStyle = ctx.fillStyle;
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.34, Math.PI * 0.35, Math.PI * 1.75);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx + s * 0.08, cy - s * 0.42);
      ctx.lineTo(cx + s * 0.42, cy - s * 0.2);
      ctx.lineTo(cx + s * 0.06, cy - s * 0.02);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(cx - s * 0.1, cy - s * 0.1, s * 0.2, s * 0.36);
    }
  }

  /** 文本裁切：超宽用省略号（避免越界压到其它元素）。 */
  private ellipsize(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
    if (ctx.measureText(text).width <= maxW) return text;
    let s = text;
    while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
    return `${s}…`;
  }

  /* ------------------------------------------------------------- 诊断 */

  probe(): RunPageProbe {
    const rect = this.canvas.getBoundingClientRect();
    const s = this.state;
    const view = this.stageView();
    const shapes = this.layeredShapes();
    const layers = shapes.length === 0 ? emptyRunLayerAreas() : runPaintedAreas(shapes);

    const entityProbe = (e: RunStageEntityView): RunProbeEntity => ({
      visuals: e.visuals.map((v) => ({
        kind: v.kind,
        visualId: v.visualId ?? null,
        defId: v.defId ?? null,
        rect: copyRect(v.rect),
      })),
      bounds: copyRect(e.bounds),
      // 每个可视件都**真的被画出来**且不是纯色占位：有 sprite，或是按真实半径画的轮组。
      allSprites:
        e.visuals.length > 0 &&
        e.visuals.every((v) =>
          v.kind === 'wheel' && !v.visualId ? true : !!v.visualId && this.assets.has(v.visualId),
        ),
    });

    const rt = this.battle;
    const battleAssets = this.battleView.assetStats();

    if (!rt) {
      // IDLE：PRP 待机近景（只有玩家一辆车）
      return {
        ...this.baseProbe(s, rect, layers),
        stage: {
          mode: 'idle',
          scale: view.scale,
          groundY: view.groundY,
          ground: copyRect(view.ground),
          road: copyRect(view.road),
          player: entityProbe(view.player),
          enemy: null,
          playerLeftOfEnemy: null,
          minGapPx: null,
        },
        battleWorld: null,
        battleAssets,
      };
    }

    // EVENT / BATTLE / RESULT / CHOICE：真实 Planck 战斗世界
    const xf = this.battleView.viewTransform();
    const vis = battleVisibleWorld(xf);
    const aBox = rt.vehicleBox('A');
    const bBox = rt.vehicleBox('B');
    const gapWorld = bBox.minX - aBox.maxX;
    const toView = (b: RunBattleBox): RunRect => ({
      x: battleBandX(xf, b.minX),
      y: battleBandY(xf, b.minY),
      w: (b.maxX - b.minX) * xf.scale,
      h: (b.maxY - b.minY) * xf.scale,
    });
    // 真实战斗世界里「是否有降级占位」的判据 = 正式 sprite 是否全部就绪
    // （正式 Renderer 不会用纯色矩形冒充车辆：它只画 sprite 与真实几何）。
    const battleEntity = (b: RunBattleBox): RunProbeEntity => ({
      visuals: [],
      bounds: toView(b),
      allSprites: this.battleView.assetsAllReady,
    });
    const aView = toView(aBox);
    const bView = toView(bBox);

    return {
      ...this.baseProbe(s, rect, layers),
      stage: {
        mode: 'battle',
        scale: xf.scale,
        groundY: battleGroundBandY(xf, rt.groundY),
        ground: copyRect(view.ground),
        road: copyRect(view.road),
        player: battleEntity(aBox),
        enemy: battleEntity(bBox),
        playerLeftOfEnemy: aView.x + aView.w <= bView.x,
        minGapPx: bView.x - (aView.x + aView.w),
      },
      battleWorld: {
        phase: rt.phase,
        timeMs: rt.timeMs,
        modifier: rt.modifier,
        /** PRP-BUILD-01：本场真实拿到的完整 Build（两层）。 */
        build: rt.build,
        /** PRP-BUILD-01：Run 能力真实运行状态。 */
        abilities: (() => {
          const a = rt.abilitySnapshot();
          return {
            kineticBurst: a.kineticBurst,
            kineticHits: a.kineticHits,
            lastKineticImpulse: a.lastKineticImpulse,
            projectileMass: a.projectileMass,
            lastKineticHit: a.lastKineticHit ? { ...a.lastKineticHit } : null,
          };
        })(),
        kineticImpact: (() => {
          const mark = this.impactMark;
          if (!mark) return null;
          const ageMs = rt.timeMs - mark.atMs;
          const rings = runImpactRingShapes(ageMs);
          const core = runImpactCoreShape(ageMs);
          return {
            ageMs,
            worldX: mark.x,
            worldY: mark.y,
            bandX: battleBandX(xf, mark.x),
            bandY: battleBandY(xf, mark.y),
            rings: rings.length,
            core: core !== null,
            maxRadius: rings.length === 0 ? 0 : Math.max(...rings.map((r) => r.radius)),
            maxAlpha: rings.length === 0 ? 0 : Math.max(...rings.map((r) => r.alpha)),
          };
        })(),
        initialPlayerHp: rt.initialPlayerHp,
        playerHpMax: rt.playerMaxHp,
        steps: rt.stepCount,
        projectiles: rt.projectileCount(),
        /**
         * ⚠️ 只看**玩家这一侧**的存活弹丸（`projectileCount()` 会被对手自己的武器污染：
         * 例如 `PineappleFireBrute` 喷火器的火焰颗粒）→ 供「按弹丸数增量反推开火节奏」的
         * 测量使用，避免把对手的火焰颗粒误计成玩家的开火。
         */
        playerProjectiles: rt.playerProjectileCount(),
        gapWorld,
        gapView: gapWorld * xf.scale,
        world: {
          width: rt.arenaWidth,
          height: rt.arenaHeight,
          groundY: rt.groundY,
          spawnAx: rt.spawnAx,
          spawnBx: rt.spawnBx,
          spawnSeparation: rt.spawnSeparation,
          initialGap: this.battleInitialGap,
        },
        camera: {
          scale: xf.scale,
          offsetX: xf.offsetX,
          offsetY: xf.offsetY,
          groundScreenY: xf.offsetY + rt.groundY * xf.scale,
          groundBandY: battleGroundBandY(xf, rt.groundY),
          viewW: RUN_BATTLE_VIEW_W,
          viewH: RUN_BATTLE_VIEW_H,
          bandW: RUN_STAGE_BAND.w,
          bandH: RUN_STAGE_BAND.h,
          cropX: xf.cropX,
          cropY: xf.cropY,
          visibleWorldMinX: vis.minX,
          visibleWorldMaxX: vis.maxX,
          visibleWorldWidth: vis.width,
          showsWholeWorld: vis.width >= rt.arenaWidth,
        },
        player: battleEntity(aBox),
        enemy: battleEntity(bBox),
      },
      battleAssets,
    };
  }

  /** 与 phase 无关的那部分诊断快照（顶部 / 日志 / 动作 / CHOICE / 分带 / 屏幕 / 账本）。 */
  private baseProbe(
    s: RunPageState,
    rect: DOMRect,
    layers: Record<RunLayerId, number>,
  ): Omit<RunPageProbe, 'stage' | 'battleWorld' | 'battleAssets'> {
    const ctxForNode = runCurrentNode(s);
    /*
      PRODUCT-LOOP-R1-B：本帧真正画出来的奖励卡 + 它的出口（与绘制同源：都走
      `rewardCardNow()` / `productClaimNow()`）。放在这里是因为 `baseProbe` 就是
      「与 phase 无关的那部分诊断快照」的唯一装配点。
    */
    const rewardCard = this.rewardCardNow();
    const rewardClaim = this.productClaimNow();
    return {
      logicalW: PORTRAIT_LOGICAL_W,
      logicalH: PORTRAIT_LOGICAL_H,
      phase: s.phase,
      phaseTrail: s.phaseTrail,
      transitions: s.transitions,
      actionCount: s.actionCount,
      /** PRP-RUN-02：进度锚点 = 当前脚本节点（不是「第几场 / 第几选」）。 */
      nodeId: s.nodeId,
      nodeKind: runNodeKind(s),
      encounterId: ctxForNode.encounterId ?? null,
      battleTotal: RUN_TOTAL_BATTLES,
      day: s.day,
      dayTotal: s.dayTotal,
      /** PRP-F2：本局第一层强化（本局临时，刷新即回 null）。完整 Build 见下两行。 */
      modifier: runBuildIds(s)[0] ?? null,
      /** PRP-BUILD-01：本局完整 Build（按选择顺序）。 */
      build: runBuildIds(s),
      buildLabels: s.buffs.map((b) => b.label),
      /** PRP-BUILD-01：紧急维修 + 耐久事件「维修」累计的耐久补偿（0 = 没修过）。 */
      repairBonus: s.repairBonus,
      /** PRP-BUILD-01：已打完的真实战斗场数（诊断值；进度由 nodeId / phase 决定）。 */
      battlesCompleted: s.battlesCompleted,
      /** PRP-RUN-02：两个终态（失败 / 完成）的可观测判据。 */
      complete: runComplete(s),
      failed: runFailed(s),
      /** PRP-RUN-R1：「这一下会开新 Run」还是「继续当前 Run」。 */
      startsNewRun: runStartsNewRun(s),

      /* ---------------- PRP-M2-NEXT-RUN-SEED-VALIDATION ----------------
       * ⚠️ 默认完整 Run 流程（`new RunPage(root)`）恒为：
       *    nextRunValidation=false / seedSelectOpen=false / seedOptions=[] /
       *    seedChosen=null / priorRun=null / validationComplete=false
       *    → 既有断言一条都不会变。 */

      nextRunValidation: this.opts.seedOptions != null,
      seedSelectOpen: this.seedSelect !== null,
      /** 种子卡片几何与绘制、命中区同源（`runChoiceCardRects` / `runChoiceIconRect`）。 */
      seedOptions: (() => {
        const seeds = this.seedSelect;
        if (!seeds) return [];
        const rects = runChoiceCardRects(seeds.length);
        return seeds.map((seed, i) => ({
          id: seed.id,
          title: seed.title,
          note: seed.note,
          rect: rects[i],
          iconRect: runChoiceIconRect(rects[i]),
        }));
      })(),
      seedChosen: this.seedChosen,
      /** 上一局摘要（注入的 `priorRun`）—— 与当前 `state` 是**两个独立对象**。 */
      priorRun: this.opts.priorRun ? priorRunSummary(this.opts.priorRun) : null,
      /** 验证终点：新 Run 第一场已结束且已停止推进。 */
      validationComplete: this.validationDone,
      /** ⚠️ buffs 与 build 同源（`buffs` 是本局 Build 的唯一状态，probe 只是换了个形状暴露）。 */
      buffs: s.buffs.map((b) => b.id),
      buffLabels: s.buffs.map((b) => b.label),
      buffIconCount: runBuffIconRects(s.buffs.length).length,
      logCount: s.log.length,
      log: s.log.map((e) => ({ seq: e.seq, kind: e.kind, text: e.text })),
      // ⚠️ PRP-M2：读**当前实际口径**（默认路径与 `runActionLabel(s)` / `runActionEnabled(s)`
      //    完全等价）—— 否则验证停止态下 probe 会报出一个屏幕上并不存在的「可用继续按钮」。
      actionLabel: this.actionLabelNow(),
      actionEnabled: this.actionEnabledNow(),
      actionRect: runActionButtonRect(),
      /**
       * ⚠️ PRP-M2-R1：与 `actionLabel` 同源 —— 终点态下「点了去哪」也是本帧的真实口径。
       * PRODUCT-LOOP-R1-B 起同源口径扩到产品奖励出口（产品出口优先于验证出口；
       * 两者结构上互斥 —— 验证宿主不给 `productReward`，产品宿主不给 `exitHref`）。
       */
      exitHref: rewardClaim?.href ?? this.finalActionNow()?.href ?? null,
      /**
       * PRODUCT-LOOP-R1-B｜本帧真正画出来的「本局获得」卡片（`null` = 本帧没有这张卡）。
       * ⚠️ 与绘制同源（同一个 `rewardCardNow()`）；**FAILED 恒为 `null`**
       *    （失败终态结构上没有奖励，Queue 必改 4）；不带产品上下文时同样恒为 `null`。
       */
      rewardCard: rewardCard
        ? {
            defId: rewardCard.defId,
            name: rewardCard.name,
            energy: rewardCard.energy,
            label: RUN_REWARD_CLAIM_LABEL,
            href: rewardClaim?.href ?? '',
            hasSprite: rewardCard.hasSprite,
          }
        : null,
      /** 卡片矩形（与绘制同源；`null` 同上）。 */
      rewardCardRect: rewardCard ? runRewardCardRect() : null,
      choiceOpen: runChoiceOpen(s),
      /**
       * ⚠️ PRP-BUILD-01 / R2：候选**来自当前脚本节点声明的池**（第一层三选一 / 横向改装二选一 /
       * 第二层条件池），与绘制、命中区、账本四处同源；
       * `choicePoolKind` = 数据层原值，`choicePoolLayer` = 该池内容属于哪一层
       * （1 = 一层内容（含横向）/ 2 = 第二层 / 0 = 当前不在 CHOICE）。
       */
      choicePoolLayer: runChoicePoolLayer(s),
      choicePoolKind: runChoicePoolKind(s),
      choiceOptions: runChoicePool(s).map((o, i) => ({
        id: o.id,
        label: o.label,
        note: o.note,
        rect: runChoiceCardRects(runChoicePool(s).length)[i],
        /**
         * PRP-F2：图标盒（**与绘制同源** = `runChoiceIconRect`），供 E2E 在盒内**按面积**
         * 统计「该选项专属图标色」的像素数。
         * ⚠️ 为什么不再用「图标中心单点采样」：双联炮图标是**两根并排炮管**，
         * 46×46 盒的几何中心恰好落在两管之间的空隙里 → 单点采样会假红。
         * 面积统计比单点更强（证明图标真的成片画出来），且对每个图标形状都成立。
         */
        iconRect: runChoiceIconRect(runChoiceCardRects(runChoicePool(s).length)[i]),
      })),
      /** PRP-RUN-02：耐久事件浮层的可观测状态。 */
      durabilityOpen: runDurabilityOpen(s),
      durabilityChosen: s.durability,
      /**
       * ⚠️ PRP-M2：改读**本帧实际口径**（`overlayOpenNow` / `overlayCardsNow`）——
       *    种子浮层打开时 state 仍是上一局的 `COMPLETE`（没有浮层），
       *    若沿用 `runOverlayOpen(s)` 会报「屏幕上没有浮层」而实际整页都是浮层。
       *    默认路径（`seedSelect === null`）与既有三个字段逐值相同。
       */
      overlayOpen: this.overlayOpenNow(),
      overlayTitle: this.overlayOpenNow() ? this.overlayTitleNow() : null,
      overlayOptions: (() => {
        const cards = this.overlayCardsNow();
        const rects = runChoiceCardRects(cards.length);
        return cards.map((o, i) => ({
          id: o.id,
          label: o.label,
          note: o.note,
          rect: rects[i],
          iconRect: runChoiceIconRect(rects[i]),
        }));
      })(),
      bands: {
        top: RUN_TOP_BAND,
        stage: RUN_STAGE_BAND,
        log: RUN_LOG_BAND,
        action: RUN_ACTION_BAND,
      },
      battle: s.battle
        ? {
            steps: s.battle.steps,
            playerHp: s.battle.playerHp,
            playerHpMax: s.battle.playerHpMax,
            enemyHp: s.battle.enemyHp,
            enemyHpMax: s.battle.enemyHpMax,
            done: s.battle.done,
            winner: s.battle.winner,
            endReason: s.battle.endReason,
            durabilityPercent: durabilityPercent(s.battle),
          }
        : null,
      assets: this.assets.stats(),
      layers,
      screen: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        scale: this.vp.scale,
        dpr: this.vp.dpr,
      },
      debugControls: this.root.querySelectorAll('button, [data-dev-control], [data-dev]').length,
      domButtons: this.root.querySelectorAll('button').length,
    };
  }
}

function copyRect(r: RunRect): RunRect {
  return { x: r.x, y: r.y, w: r.w, h: r.h };
}

function hit(r: RunRect, p: { x: number; y: number }): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

/** 供测试 / 诊断引用「演示敌人」而无需再走 scene（避免重复口径）。 */
export { runDemoEnemy };
