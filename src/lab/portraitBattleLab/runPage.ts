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
  runStageHills,
  type RunLayerId,
  type RunLayeredRect,
  type RunPlacedVisual,
  type RunRect,
} from './runPageLayout';
import {
  RUN_CHOICE_OPTIONS,
  chooseRunBuff,
  createRunPageState,
  durabilityPercent,
  finishRunBattle,
  formatRunLog,
  pressRunAction,
  runActionEnabled,
  runActionLabel,
  runCarriedPlayerHp,
  runChoiceOpen,
  runVerificationComplete,
  syncRunBattle,
  visibleRunLog,
  type RunLogEntry,
  type RunPageState,
  type RunPhase,
} from './runPageState';
import {
  buildRunStageView,
  runPageContext,
  runPageLayerShapes,
  runDemoEnemy,
  type RunStageEntityView,
  type RunStageView,
} from './runPageScene';
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

/** 每个强化选项的图标绘制色（矢量字形，非纯色块；不入面积账本）。 */
const CHOICE_ICON_COLOR: Readonly<Record<string, string>> = {
  heavyShell: '#ffb066',
  twinCannon: '#ffd166',
  fastReload: '#7fd6a0',
};

/** 顶部已获得图标的底色（按选项区分；芯片色统一 → `buffChip` 层可冻结）。 */
const BUFF_ICON_COLOR: Readonly<Record<string, string>> = {
  heavyShell: COLORS.iconShell,
  twinCannon: COLORS.iconTwin,
  fastReload: COLORS.iconReload,
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
   * PRP-F2：本场战斗生效的 Run 强化（null = 基础状态）。
   * 与 `RunPageProbe.modifier` 同源；此处读的是**运行时真实拿到的值**（证明注入真的落地）。
   */
  readonly modifier: string | null;
  /** 本场开局的真实玩家 HP（= 注入跨战斗耐久后的实际值）。 */
  readonly initialPlayerHp: number;
  /** 本场玩家 HP 上限（**不因跨战斗耐久改变** → 耐久条如实显示「打剩多少」）。 */
  readonly playerHpMax: number;
  /** 已推进的**正式物理步数**。 */
  readonly steps: number;
  /** 当前存活弹丸数（真实 projectile 渲染快照 → 可证「炮弹真的在飞」）。 */
  readonly projectiles: number;
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
  readonly day: number;
  readonly dayTotal: number;
  /** PRP-F2：本局已生效的 Run 强化（本局临时状态，新开 Run 即回 null）。 */
  readonly modifier: string | null;
  /**
   * PRP-F2-R1：本局已打完的真实战斗场数（0/1/2）。
   * `2` = 验证结束 → 主动作变成「重新开始验证」，且不可能再进 CHOICE。
   */
  readonly battlesCompleted: number;
  /** PRP-F2-R1：本次验证是否已结束（= `battlesCompleted >= 2`）。 */
  readonly verificationComplete: boolean;
  readonly buffs: readonly string[];
  readonly buffLabels: readonly string[];
  /** 顶部实际绘制的强化图标数量（0 = 顶部第二行完全没有内容，可反证「没有空槽」）。 */
  readonly buffIconCount: number;
  readonly logCount: number;
  readonly log: readonly { seq: number; kind: string; text: string }[];
  readonly actionLabel: string;
  readonly actionEnabled: boolean;
  readonly actionRect: RunRect;
  readonly choiceOpen: boolean;
  readonly choiceOptions: readonly { id: string; label: string; note: string; rect: RunRect; iconRect: RunRect }[];
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
  private state: RunPageState = createRunPageState(runPageContext());
  private rafHandle = 0;
  private lastFrameMs = 0;
  /** 当前遭遇的真实战斗运行时（EVENT 建立 → 回到 IDLE 时释放）。 */
  private battle: RunBattleRuntime | null = null;
  /** 开战瞬间实测的两车外廓间距（证据：开局有明确距离），不是写死数字。 */
  private battleInitialGap = 0;
  private resizeObserver: ResizeObserver | null = null;
  private readonly onWindowResize = (): void => this.render();

  constructor(root: HTMLElement) {
    this.root = root;
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
   * BATTLE 时主动作不可用；CHOICE 时只有卡片可点（点遮罩其它位置无副作用）。
   */
  private readonly onPointerDown = (ev: PointerEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    const p = this.vp.clientToLogical(ev.clientX, ev.clientY, rect);
    if (runChoiceOpen(this.state)) {
      const cards = runChoiceCardRects(RUN_CHOICE_OPTIONS.length);
      for (let i = 0; i < cards.length; i++) {
        if (hit(cards[i], p)) {
          this.apply(chooseRunBuff(this.state, RUN_CHOICE_OPTIONS[i].id));
          return;
        }
      }
      return; // 遮罩其它区域：不关窗、不推进（必须显式选一个）
    }
    if (!runActionEnabled(this.state)) return;
    if (hit(runActionButtonRect(), p)) {
      this.apply(pressRunAction(this.state, runPageContext()));
    }
  };

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
   * PRP-F2：每次遭遇都**全新创建**，并把本局的两项 Run-local 状态注入进去：
   *   - `modifier`   = 本局已选的 Cannon 强化（overlay registry + 武器 defId 重映射）；
   *   - `carriedHp`  = 上一场真实剩余耐久（第二场从这里继续，不自动满血）。
   * 旧运行时在此前已被 `endBattle()` 释放 → 弹丸 / 接触 / 世界不跨场残留。
   */
  private beginBattle(): void {
    this.endBattle();
    const rt = new RunBattleRuntime({
      modifier: this.state.modifier,
      carriedHp: runCarriedPlayerHp(this.state),
    });
    this.battle = rt;
    // 实测开局外廓间距（不是写死数字）——「开局有明确距离」的证据
    this.battleInitialGap = rt.gapWorld();
  }

  /** 释放战斗运行时（战斗世界中双方位置/HP 随之不再保留 → 下一次遭遇从正式 spawn 重来）。 */
  private endBattle(): void {
    if (!this.battle) return;
    this.battle.dispose();
    this.battle = null;
    this.battleInitialGap = 0;
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
    return runPageLayerShapes(this.state, this.stageView());
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
    this.drawActionButton(ctx, s);

    // 6) CHOICE 浮层（必改 4：整页重压暗 + 三张「图标 / 名称 / 一句结果」卡片）
    if (runChoiceOpen(s)) this.drawChoice(ctx);
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

  private drawActionButton(ctx: CanvasRenderingContext2D, s: RunPageState): void {
    const btn = runActionButtonRect();
    const enabled = runActionEnabled(s);
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
    ctx.fillText(runActionLabel(s), btn.x + btn.w / 2, btn.y + 32);
    ctx.textAlign = 'left';
  }

  /* ------------------------------------------------------ CHOICE 浮层 */

  private drawChoice(ctx: CanvasRenderingContext2D): void {
    const mask = runChoiceMaskRect();
    ctx.fillStyle = CHOICE_MASK_COLOR;
    ctx.fillRect(mask.x, mask.y, mask.w, mask.h);

    const cards = runChoiceCardRects(RUN_CHOICE_OPTIONS.length);
    const title = runChoiceTitlePos(RUN_CHOICE_OPTIONS.length);
    ctx.fillStyle = COLORS.textTitle;
    ctx.font = `bold 17px ${FONT_STACK}`;
    ctx.fillText('选择一项改装', title.x, title.y);

    cards.forEach((card, i) => {
      const opt = RUN_CHOICE_OPTIONS[i];
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

  /** 每个选项一个可辨识的矢量图标（重型弹头 = 弹体 / 双联炮 = 两根炮管 / 快速装填 = 循环箭头），不承载文字。 */
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
        initialPlayerHp: rt.initialPlayerHp,
        playerHpMax: rt.playerMaxHp,
        steps: rt.stepCount,
        projectiles: rt.projectileCount(),
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
    return {
      logicalW: PORTRAIT_LOGICAL_W,
      logicalH: PORTRAIT_LOGICAL_H,
      phase: s.phase,
      phaseTrail: s.phaseTrail,
      transitions: s.transitions,
      actionCount: s.actionCount,
      day: s.day,
      dayTotal: s.dayTotal,
      /** PRP-F2：本局已生效的 Run 强化（本局临时，刷新即回 null）。 */
      modifier: s.modifier,
      /** PRP-F2-R1：单变量验证进度（0/1/2 场已打完）。 */
      battlesCompleted: s.battlesCompleted,
      verificationComplete: runVerificationComplete(s),
      buffs: s.buffs.map((b) => b.id),
      buffLabels: s.buffs.map((b) => b.label),
      buffIconCount: runBuffIconRects(s.buffs.length).length,
      logCount: s.log.length,
      log: s.log.map((e) => ({ seq: e.seq, kind: e.kind, text: e.text })),
      actionLabel: runActionLabel(s),
      actionEnabled: runActionEnabled(s),
      actionRect: runActionButtonRect(),
      choiceOpen: runChoiceOpen(s),
      choiceOptions: RUN_CHOICE_OPTIONS.map((o, i) => ({
        id: o.id,
        label: o.label,
        note: o.note,
        rect: runChoiceCardRects(RUN_CHOICE_OPTIONS.length)[i],
        /**
         * PRP-F2：图标盒（**与绘制同源** = `runChoiceIconRect`），供 E2E 在盒内**按面积**
         * 统计「该选项专属图标色」的像素数。
         * ⚠️ 为什么不再用「图标中心单点采样」：双联炮图标是**两根并排炮管**，
         * 46×46 盒的几何中心恰好落在两管之间的空隙里 → 单点采样会假红。
         * 面积统计比单点更强（证明图标真的成片画出来），且对每个图标形状都成立。
         */
        iconRect: runChoiceIconRect(runChoiceCardRects(RUN_CHOICE_OPTIONS.length)[i]),
      })),
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
