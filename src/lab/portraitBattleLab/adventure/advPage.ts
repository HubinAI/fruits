/**
 * FRUITS-ADVENTURE-FULL-PLAYABLE-R3｜随机冒险宿主页面（DOM/Canvas 输入层，唯一）。
 *
 * 复用正式链路（不重写第二套战斗）：
 *   - 战斗世界 = `RunBattleRuntime`（正式 Planck 物理）+ `RunBattleView`（正式 Renderer + 远摄相机）；
 *   - 状态 = `advState.ts`（本原型自有纯状态机）；
 *   - 竖屏逻辑舞台 = 390×844，复用 `PlayerViewportTransform` contain 变换（与正式契约同源）。
 *
 * ⚠️ 与冻结的 `runPage.ts` 完全独立：本文件不 import `runPage.ts`，不修改任何既有 Run 文件；
 *   页面布局为原型自绘（不追求正式 ledger 调色板），但**真实物理战斗、真实耐久继承、
 *   真实 Run Build 注入**均与正式口径一致。
 *
 * 生命周期接线（与 runPage 同纪律）：
 *   - 进入 BATTLE → `beginBattle()`（新建 RunBattleRuntime，注入本局 carriedHp + buffs）；
 *   - 每帧 `runtime.step(dt)` → `syncAdventureBattle` → 官方 result 出现 → `finishAdventureBattle`；
 *   - 终态那一刻 `battleView.stopBattleAudio()`（与 dispose 解耦，幂等）；
 *   - `dispose()` 释放监听 + 战斗运行时 + 战斗音频。
 *
 * R3 新增：
 *   - 正式车库装配优先读取（由 advMain 经 `resolveRunPlayerLoadout` / 同域存档读入，传入 loadout）；
 *   - 隔离测试档案（advArchive）：终态结算写入，不影响正式存档键；
 *   - 统一竖屏冒险视觉：天数 / 阶段 / 主题事件插图 / 选择 / 开奖 / 战斗 / 阶段提示 / 最终结算。
 */
import { PlayerViewportTransform } from '../../../platform/playerViewport';
import { PORTRAIT_LOGICAL_H, PORTRAIT_LOGICAL_W } from '../constants';
import { RunBattleRuntime } from '../runBattleRuntime';
import { RunBattleView } from '../runBattleView';
import { type RunPlayerLoadout } from '../runPageScene';
import { runBuildOptionById, type RunBuildId } from '../runModifiers';
import {
  generateAdventureScript,
  randomSeedLabel,
  type AdventureEffect,
  type AdventureEventKind,
  type AdventureScript,
} from './advScript';
import {
  advActionEnabled,
  advActionLabel,
  advAutoAdvance,
  advCarriedPlayerHp,
  advChoiceOpen,
  advContextFromLoadout,
  advCurrentNode,
  advEventChoiceOpen,
  advNarrativeLines,
  advNarrativeTitle,
  advNeedsPlayer,
  advOverlayCards,
  advOverlayOpen,
  advTopDurability,
  chooseAdventureOption,
  createAdventureState,
  finishAdventureBattle,
  pressAdventureAction,
  syncAdventureBattle,
  type AdventureContext,
  type AdventureState,
} from './advState';
import { readArchive, recordRun, type AdvArchive, type AdvRunSummary } from './advArchive';
import {
  AdvUiStore,
  advBuildIconId,
  advEventIconId,
  advOutcomeIconId,
  type AdvUiId,
} from './advUiAssets';
import {
  UX_ACTION,
  UX_ACTION_BTN,
  UX_NARRATIVE,
  UX_NARRATIVE_CARD,
  UX_NARRATIVE_MAX_LINES,
  UX_STAGE,
  UX_TERMINAL_CTA,
  UX_TOP,
  drawContain,
  drawNineSlice,
  uxHit,
  uxOptionRects,
} from './advLayout';

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** 叙事区正文行的种类（只影响前置符号，不改文本）。 */
type AdventureLogEntryKindLike = 'day' | 'travel' | 'event' | 'result' | 'choice' | 'durability';

const FONT_STACK = 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';

const COLORS = {
  pageBg: '#0b0e14',
  topBandBg: '#151c28',
  stageSkyTop: '#16243a',
  stageSkyBottom: '#0e1626',
  ground: '#3a3142',
  road: '#2a2733',
  logBandBg: '#0d121a',
  actionBandBg: '#141a26',
  divider: '#25314a',
  textTitle: '#e9eef7',
  textBody: '#c7d0df',
  textDim: '#8a94a6',
  cardBg: '#1b2432',
  cardEdge: '#3d4c66',
  actionBtn: '#33507a',
  actionBtnOff: '#2a3341',
  hpBarBg: '#2a3140',
  hpBarFill: '#4fae62',
  hpLow: '#e05a4e',
  mask: 'rgba(6,9,14,0.86)',
  eventAccent: '#e8b23c',
} as const;

/**
 * 五种事件的独立主题（R3 视觉识别）：不同色 + 不同图标 ⇒ 手机尺寸下一眼可区分。
 * 仅演示用占位视觉（过程式 Canvas 绘制，零第三方素材），结构集中于此，便于后续替换确认素材。
 */
const EVENT_THEME: Record<AdventureEventKind, { accent: string; tag: string }> = {
  crate: { accent: '#e8b23c', tag: '神秘货箱' },
  wreck: { accent: '#e0654e', tag: '废车搜刮' },
  rest: { accent: '#5bbf8a', tag: '临时修整' },
  convoy: { accent: '#5aa9e0', tag: '流浪商队' },
  altar: { accent: '#b07ce0', tag: '荒野祭坛' },
};

/**
 * FRUITS-ADVENTURE-UX-CONTINUITY-R1｜一屏式骨架（**取代** R4 的四层「按阶段切换」版面）。
 *
 * 为什么必须重构结构（不是调视觉）：R4 的版面会**按阶段改变舞台带尺寸**
 * （战斗 390×648 → RESULT 390×468 + 下方结果带），事件/开奖/阶段提示则整页换成王座厅。
 * 玩家体验到的就是「不停打开不同界面、按同一个按钮」。R1 改成**高度恒定**的四段：
 *
 *   ① TOP        0..92    常驻进度 + 实时耐久 + 阶段（任何阶段都不消失）
 *   ② STAGE     92..470   同一冒险舞台：战斗 / 事件 / 胜利 / 败退都在这里，**高度永不改变**
 *   ③ NARRATIVE 470..744  固定叙事区：事件、奖励、战报依时间依次写入；决策时就地变成选项卡
 *   ④ ACTION   744..844   底部唯一主操作：只在「真的需要玩家推进」时有按钮
 *
 * ⚠️ 舞台高度恒定是**结构性正确性**，不是审美：F1 的等比合成与 F6 的时间平滑都以舞台带为参
 *    考点，旧实现 RESULT 时把带高从 648 改成 468，等于让同一场战斗在切换瞬间换了取景基准。
 */
const TOP_BAND: Rect = UX_TOP;
const STAGE_BAND: Rect = UX_STAGE;
const NARRATIVE_BAND: Rect = UX_NARRATIVE;
const ACTION_BAND: Rect = UX_ACTION;

/**
 * D2 诊断（隔离实验，**不进入正式主线**）：仅当冒险页 URL **显式**带 `?d2zoom=` 时，
 * 战斗主体合成才走固定倍数子矩形（`RunBattleView.blitSubject`）。`?d2zoom=1` ⇒ 倍数 1
 * ⇒ 退化为全安全区 `blit`（= 原取景基线，供 D2 对照）。**无此参数** ⇒ F4 自适应默认。
 */
const D2_ZOOM_PARAM = (() => {
  try {
    return typeof location !== 'undefined' ? new URLSearchParams(location.search).get('d2zoom') : null;
  } catch {
    return null;
  }
})();
/** URL 显式带了 `?d2zoom=`（含 =1）⇒ 固定倍数模式（z=1 即原取景基线）。 */
const D2_FIXED = D2_ZOOM_PARAM != null && Number.isFinite(Number(D2_ZOOM_PARAM));
const D2_EXPERIMENT_ZOOM = (() => {
  const v = Number(D2_ZOOM_PARAM);
  return Number.isFinite(v) && v > 1 && v <= 2.5 ? v : 1;
})();

/**
 * FRUITS-ADVENTURE-CAMERA-F4｜冒险专用自适应镜头的解析参数（仅冒险原型，纯合成裁切）。
 *
 * - `ADV_CAMERA_MAX_ZOOM`：采纳的放大上限（默认 1.6，D2 已证近战可读性明显提升）；
 *   可用 `?f4max=` 临时改为 1.3 等做对照，超出 [1.05, 2.0] 钳制。
 * - `?f4off=1`：关闭自适应镜头，恢复原取景（= 无 F4 的 `blit` 行为），用于对照基线。
 * - `?d2zoom=`：D2 遗留固定倍数旋钮（底部加权），仅作「固定 1.6 vs 自适应」对照用。
 * 三者均仅在冒险页 URL 生效；正式玩法 / 首页 / 车库不受影响。
 */
const ADV_CAMERA_MAX_ZOOM = 1.6;
const ADV_CAMERA_OFF = (() => {
  try {
    const raw = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('f4off') : null;
    return raw === '1' || raw === 'true';
  } catch {
    return false;
  }
})();
const ADV_CAMERA_MAX = (() => {
  try {
    const raw = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('f4max') : null;
    const v = Number(raw);
    if (!Number.isFinite(v) || v <= 0) return ADV_CAMERA_MAX_ZOOM;
    return Math.max(1.05, Math.min(2.0, v));
  } catch {
    return ADV_CAMERA_MAX_ZOOM;
  }
})();

// F3：强化获得的即时反馈显示时长（ms）。只影响显示，不影响状态机时序（tapChoice 的 130ms 按压反馈不变）。
const ADV_BUILD_TOAST_MS = 2400;
/** F3：即时反馈的淡出时长（ms）。 */
const ADV_TOAST_FADE_MS = 420;

/**
 * FRUITS-ADVENTURE-UX-CONTINUITY-R1｜纯信息阶段在叙事区的**停留时长**（ms）。
 *
 * 不是「过场动画」，而是让玩家真的读到刚写进叙事区的那句话再进入下一步：
 *   · `EVENT → BATTLE`（敌情 → 开打）：短，1000ms（敌情只有 1–2 行，读完即开打）；
 *   · `RESULT → 下一节点`（战报）：1200ms（需要读到胜负与剩余耐久）；
 *   · `EVENT_DONE → 下一节点`（事件结果卡）：1200ms（需要读到拿到了什么/损失了什么）。
 * 三者都**不需要点击**；期间底部主操作位不显示可点按钮（避免「假按钮」）。
 */
const ADV_AUTO_EVENT_MS = 1000;
const ADV_AUTO_RESULT_MS = 1200;
const ADV_AUTO_DONE_MS = 1200;

/** F3：强化获得的即时反馈数据（纯显示，瞬态；不参与任何状态/战斗决策）。 */
interface AdvBuildToast {
  readonly id: RunBuildId;
  readonly label: string;
  /** 该强化的核心收益（`runModifiers` 的 note，不改写）。 */
  readonly gain: string;
  /** 额外一行（紧急维修的真实修理量；无则为空）。 */
  readonly extra: string;
  readonly bornAt: number;
}
const ACTION_BTN: Rect = UX_ACTION_BTN;

/** R1：叙事带底部「本局历程条」的高度（唯一真源：定位与绘制共用同一个数）。 */
const UX_JOURNEY_H = 52;
/** 结算页唯一主操作＝大号 CTA；**完整包含** ACTION_BTN 命中区，保证既醒目又可点。 */
const TERMINAL_CTA: Rect = UX_TERMINAL_CTA;

function hit(r: Rect, p: { x: number; y: number }): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

/** #rrggbb → rgba(...)（R3：图标底板用主题色半透明填充）。 */
function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return `rgba(124,141,176,${alpha})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export interface AdvPageOptions {
  readonly seed?: string;
  /** 本局装载（由 advMain 经 resolveRunPlayerLoadout / 同域存档读入；可来自正式车库或演示）。 */
  readonly loadout: RunPlayerLoadout;
  /** 装备来源诊断（UI / 探针如实展示，绝不假装）。 */
  readonly loadoutSource: string;
  readonly onExit?: () => void;
}

export class AdvPage {
  private readonly root: HTMLElement;
  private readonly stageWrap: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  /**
   * FRUITS-ADVENTURE-BATTLE-VIEW-F1：战斗视图按**本页真实舞台带**（R1 起为 390×378）建视口。
   * 视口因此是 502×434 —— 正式相机在「同一宽、按舞台高」的安全区里取景，
   * 合成时 X/Y 用同一个 scale（1:1 贴满舞台带），车辆/车轮不会被纵向拉伸。
   *
   * ⚠️ R1：舞台高从 648 改为**恒定 378**（一屏式结构里舞台只占中上段，下部给叙事区）。
   *    这对 F1/F6 是**安全的**：等比约束（scaleX === scaleY）与 F6 的平滑都只依赖
   *    「舞台带尺寸恒定」这一前提，而 R1 保证它在**所有阶段**都是 378（旧实现在 RESULT
   *    时会改成 468，那才是真正的隐患）。F1/F6 的 E2E 已同步按新舞台带复验。
   */
  private readonly battleView = new RunBattleView(document, {
    safeArea: { w: STAGE_BAND.w, h: STAGE_BAND.h },
  });  private readonly vp = new PlayerViewportTransform(PORTRAIT_LOGICAL_W, PORTRAIT_LOGICAL_H);
  /** R1：真实 UI 素材加载器（Capybara Go! 拆包，第三方素材本地 gitignore，失败降级过程式）。 */
  private readonly ui = new AdvUiStore();

  private readonly loadout: RunPlayerLoadout;
  private readonly loadoutSource: string;
  private readonly ctx2: AdventureContext;
  /** 当前局脚本。终局「再来一局」会生成**新随机种子**的脚本（R4 必改①；?seed= 指定时仍可重放原局）。 */
  private script: AdventureScript;
  private state: AdventureState;

  /** 隔离测试档案（终态结算写入；不影响正式存档）。 */
  private archive: AdvArchive;
  private archived = false;

  private rafHandle = 0;
  private lastFrameMs = 0;
  /** F6：上一次绘制的时刻（只用于合成镜头平滑的 dt；与 `lastFrameMs`（物理 dt）互不干扰）。 */
  private lastDrawMs = 0;
  /** F6：本帧绘制间隔（ms，钳在 [0,50]），传给 `RunBattleView.updateAdventureCamera`。 */
  private frameDtMs = 0;
  /** R1：选择卡片按下高亮索引（延迟 apply 期间显示反馈，防重入）。 */
  private pressCard = -1;
  private pressTimer: number | null = null;
  private battle: RunBattleRuntime | null = null;
  /**
   * F3：强化获得的即时反馈（瞬态，`ADV_BUILD_TOAST_MS` 后自动消失）。
   * 数据来自「选择前后」的真实状态差，不新增任何持久状态。
   */
  private buildToast: AdvBuildToast | null = null;
  /** F3：即时反馈的到点消失定时器（纯显示；与 pressTimer 同一族）。 */
  private toastTimer: number | null = null;
  /**
   * F3：本场战斗观测到的**玩家弹丸峰值数 / 峰值半径**（开新战时清零）。
   * 这是「双联炮 / 三连装填 / 重型弹头在正常速度下真的看得见」的量化证据：
   * 一次攻击打几发、弹丸多大，全部读自正式 `BattleRenderSnapshot.projectiles`。
   */
  private maxPlayerProjectiles = 0;
  private maxPlayerRadius = 0;
  /**
   * F3：**上一场**战斗的弹丸峰值存档（战斗实例在终态被 dispose，事后对账用）。
   * 开新战时清空；纯只读遥测，不参与任何玩法/渲染决策。
   */
  private lastBattleShells: { readonly maxPlayerSeen: number; readonly maxPlayerRadiusSeen: number } | null = null;
  /**
   * FRUITS-ADVENTURE-UX-CONTINUITY-R1｜纯信息阶段的自动承接计时器。
   *
   * 只在这三个「无决策」阶段挂一个一次性 setTimeout（见 `scheduleAutoAdvance`）：
   * EVENT / RESULT / EVENT_DONE。到点后走 `advAutoAdvance`（= R1 之前「按继续」的同一段推进代码）。
   * `autoToken` 用于作废过期回调：`startNewRun` / 手动推进 / dispose 都会自增它，
   * 保证「旧局的计时器」绝不可能推进新局（复玩安全）。
   */
  private autoTimer: number | null = null;
  private autoToken = 0;
  /** 本阶段何时开始（用于叙事区「已停留多久」的进度提示；纯显示）。 */
  private phaseEnteredAt = 0;
  /** R1：本阶段已自动承接的次数（诊断用；不参与决策）。 */
  private autoAdvances = 0;
  private resizeObserver: ResizeObserver | null = null;
  private readonly onWindowResize = (): void => this.render();

  constructor(root: HTMLElement, opts: AdvPageOptions) {
    this.root = root;
    this.loadout = opts.loadout;
    this.loadoutSource = opts.loadoutSource;
    this.ctx2 = advContextFromLoadout(this.loadout);
    // R4 必改①：默认进入即新随机种子；?seed= 指定时用指定种子（可复现重放 = 测试入口）。
    this.script = generateAdventureScript(opts.seed ?? randomSeedLabel());
    this.state = createAdventureState(this.ctx2, this.script);
    this.archive = readArchive();

    this.stageWrap = document.createElement('div');
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'adv-canvas';
    this.ctx = this.canvas.getContext('2d');

    this.buildDom();
    this.observeResize();
    this.battleView.onAssetsReady(() => this.render());
    this.ui.load(() => {
      // R2：场景底图就绪 ⇒ 立刻注入战斗视图（战斗与非战斗从此共用同一张图）。
      this.syncSceneBackdrop();
      this.render();
    });
    this.render();
  }

  /**
   * FRUITS-ADVENTURE-UX-COHERENCE-R2｜把 P0 场景底图同步给战斗视图。
   *
   * 这是「统一真实舞台」的**唯一接线点**：
   *   · 战斗：`battleView.render()` 里由 Renderer 用同一张图铺天空区（取代程序化蓝色竞技场）；
   *   · 非战斗：本页 `drawStage()` 调 Renderer 的同一个 `drawAdventureSceneBackdrop()`。
   * 两边是同一份排版换算，所以「同一坐标冒充同一场景」这件事从结构上就不可能发生。
   *
   * 素材缺失（公网 clone / 未复制 public/adventure-ui）⇒ 不注入，Renderer 回落到程序化背景，
   * 非战斗侧也走同一回落分支（不会出现「一边有图一边没图」）。
   */
  private syncSceneBackdrop(): void {
    const img = this.ui.get('battle_bg');
    if (img) this.battleView.setSceneBackdrop(img, img.width, img.height);
    else this.battleView.setSceneBackdrop(null);
  }

  private buildDom(): void {
    this.root.replaceChildren();
    this.root.classList.add('adv-root');
    this.stageWrap.className = 'adv-stage';
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

  dispose(): void {
    this.stopLoop();
    this.endBattle();
    this.buildToast = null;
    if (this.toastTimer !== null) {
      clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
    if (this.pressTimer !== null) {
      clearTimeout(this.pressTimer);
      this.pressTimer = null;
    }
    // R1：作废自动承接（dispose 之后旧局的计时器不得再碰任何状态）。
    this.cancelAutoAdvance();
    this.battleView.dispose();
    window.removeEventListener('resize', this.onWindowResize);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
  }

  /**
   * R4 必改①：开始**新一局**（默认新随机种子；传入 seedLabel 则按该种子重放——仅测试入口用）。
   * 隔离测试档案跨局保留（进度累积），只重置当局状态与档案写入标记。
   */
  startNewRun(seedLabel?: string): void {
    this.stopLoop();
    this.endBattle();
    this.buildToast = null;
    if (this.toastTimer !== null) {
      clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
    // R1：旧局的自动承接计时器必须先作废，否则它可能在**新局**的阶段上触发一次推进。
    this.cancelAutoAdvance();
    this.autoAdvances = 0;
    this.script = generateAdventureScript(seedLabel ?? randomSeedLabel());
    this.state = createAdventureState(this.ctx2, this.script);
    this.archived = false;
    this.phaseEnteredAt = performance.now();
    this.scheduleAutoAdvance();
    this.render();
  }

  /* ----------------------------------------------------------- 输入 */

  private readonly onPointerDown = (ev: PointerEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    const p = this.vp.clientToLogical(ev.clientX, ev.clientY, rect);

    // R4 必改①：终局主动作 = 新一局（新随机种子）。原种子重放仅保留在测试入口（URL ?seed=）。
    if (
      (this.state.phase === 'COMPLETE' || this.state.phase === 'FAILED') &&
      advActionEnabled(this.state) &&
      hit(ACTION_BTN, p)
    ) {
      this.startNewRun();
      return;
    }

    // R1：决策点（事件二选一 / 强化三选一）的卡片在**叙事区**内就地点选；
    // 点击叙事区以外的任何位置（含上方舞台）都不推进 —— 不存在「整页遮罩」这件事。
    if (advOverlayOpen(this.state)) {
      const cards = advOverlayCards(this.state, this.script, this.ctx2);
      const rects = uxOptionRects(cards.length);
      for (let i = 0; i < rects.length; i++) {
        if (uxHit(rects[i], p)) {
          this.tapChoice(cards[i].id);
          return;
        }
      }
      return; // 决策未做：不推进、不关窗
    }

    // R1：纯信息阶段（EVENT / RESULT / EVENT_DONE / BATTLE）**没有**可点主操作 ——
    // 这些阶段由 `scheduleAutoAdvance` 自动承接，界面上也不画按钮（避免「假 CTA」）。
    if (advNeedsPlayer(this.state) && advActionEnabled(this.state) && hit(ACTION_BTN, p)) {
      // 手动推进前先作废自动承接（避免玩家点击与计时器双重推进）。
      this.cancelAutoAdvance();
      this.apply(pressAdventureAction(this.state, this.ctx2, this.script));
    }
  };

  /**
   * R1：选择卡片点击 → 立即渲染按下高亮（反馈），延迟 ~130ms 再落定选择。
   *   - 防重入：pending 期间忽略后续点击（E2E 轮询重击不重复触发，不破坏状态机）；
   *   - 延迟仅用于可见反馈，选择因果不变（仍经 chooseAdventureOption 真实结算）。
   *
   * F3：延迟期间同时记录**选择前**的 Build / 耐久 —— 结算后据此给出「拿到了什么」的
   * 即时反馈（`announceBuildGain`）。记录本身不改任何状态。
   */
  private tapChoice(optionId: string): void {
    if (this.pressTimer !== null) return;
    const cards = advOverlayCards(this.state, this.script, this.ctx2);
    this.pressCard = cards.findIndex((c) => c.id === optionId);
    const before = { buffs: [...this.state.buffs], hp: advCarriedPlayerHp(this.state, this.ctx2) };
    this.render();
    this.pressTimer = window.setTimeout(() => {
      this.pressTimer = null;
      this.pressCard = -1;
      this.apply(chooseAdventureOption(this.state, optionId, this.ctx2, this.script));
      this.announceBuildGain(before);
    }, 130);
  }

  /**
   * F3：强化获得的**即时反馈**（纯显示，瞬态 ~2.4s）。
   *
   * 全部读自已经 `chooseAdventureOption` 真实结算后的状态差：
   *   - `buffs` 增量 ⇒ 拿到的强化（图标 / 名称 / 核心收益，逐字来自 `runModifiers`）；
   *   - `carriedHp` 增量 ⇒ 紧急维修的真实修理量（0.25 × 上限，按缺口截断）。
   * 不写任何状态、不改任何数值 —— 玩家看到的就是状态机刚刚结算的东西。
   */
  private announceBuildGain(before: { readonly buffs: readonly RunBuildId[]; readonly hp: number }): void {
    const gained = this.state.buffs.filter((b) => !before.buffs.includes(b));
    if (gained.length === 0) return; // 本次没拿到强化（纯 heal / damage / none）⇒ 不弹
    const id = gained[gained.length - 1];
    const def = runBuildOptionById(id);
    const hpAfter = advCarriedPlayerHp(this.state, this.ctx2);
    const heal = hpAfter - before.hp;
    const extra =
      heal > 0 ? `耐久 +${Math.round(heal)}（当前 ${Math.round(hpAfter)}/${this.ctx2.playerHpMax}）` : '';
    this.buildToast = {
      id,
      label: def?.label ?? id,
      gain: def?.note ?? '',
      extra,
      bornAt: performance.now(),
    };
    // ⚠️ `apply()` 的 render 已经跑完（本方法在它之后调用）⇒ 非战斗阶段没有 rAF 循环
    //    （BATTLE 才有），不主动重绘一次的话反馈卡不会出现在屏幕上。这里补一次绘制，
    //    并挂一个到点自动消失的定时器（与 pressTimer 同一族，纯显示）。
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastTimer = null;
      this.buildToast = null;
      this.render();
    }, ADV_BUILD_TOAST_MS);
    this.render();
  }

  private apply(next: AdventureState): void {
    if (next === this.state) return;

    // 终态 → 新一局（UI 路径经 startNewRun 直接重置；此处保留终态→IDLE 的档案标记重置作防御）。
    if ((this.state.phase === 'COMPLETE' || this.state.phase === 'FAILED') && next.phase === 'IDLE') {
      this.archived = false;
    }

    const wasTerminal = this.state.phase === 'COMPLETE' || this.state.phase === 'FAILED';
    const phaseChanged = next.phase !== this.state.phase;
    this.state = next;
    if (phaseChanged) this.phaseEnteredAt = performance.now();

    if (next.phase === 'BATTLE' && !this.battle) this.beginBattle();
    if (next.phase !== 'BATTLE' && next.phase !== 'RESULT' && this.battle) this.endBattle();

    if (next.phase === 'BATTLE') this.startLoop();
    else this.stopLoop();

    // 首次进入终态 → 写入隔离测试档案（真实结算数据）。
    if (!wasTerminal && (next.phase === 'COMPLETE' || next.phase === 'FAILED') && !this.archived) {
      this.recordTerminal(next);
    }

    if (next.phase === 'COMPLETE' || next.phase === 'FAILED') this.battleView.stopBattleAudio();
    // R1：纯信息阶段挂一次性自动承接（决策阶段自动清空计时器，绝不跨过玩家决定）。
    this.scheduleAutoAdvance();
    this.render();
  }

  /* ------------------------------------------- R1：纯信息阶段自动承接 */

  /**
   * FRUITS-ADVENTURE-UX-CONTINUITY-R1｜按当前阶段安排（或取消）自动承接。
   *
   * 纪律：
   *   - 只有「无决策」阶段（EVENT / RESULT / EVENT_DONE）会挂计时器；其余阶段一律不挂；
   *   - 每次都先作废旧计时器（`autoToken`）⇒ 快速连点、复玩、手动推进都不会残留旧回调；
   *   - 回调里再次校验 `advNeedsPlayer`：若期间玩家已推进到决策阶段，**不推进**（双保险）。
   */
  private scheduleAutoAdvance(): void {
    this.cancelAutoAdvance();
    const delay = this.autoAdvanceDelayMs();
    if (delay <= 0) return;
    const token = this.autoToken;
    this.autoTimer = window.setTimeout(() => {
      this.autoTimer = null;
      if (token !== this.autoToken) return; // 已被作废（复玩 / 手动推进 / dispose）
      if (advNeedsPlayer(this.state)) return; // 当前已在等玩家 ⇒ 绝不越过决策点
      const next = advAutoAdvance(this.state, this.ctx2, this.script);
      if (next === this.state) return; // 无事可做（防死循环）
      this.autoAdvances += 1;
      this.apply(next);
    }, delay);
  }

  /** 当前阶段的自动停留时长（0 = 不自动承接）。 */
  private autoAdvanceDelayMs(): number {
    switch (this.state.phase) {
      case 'EVENT':
        return ADV_AUTO_EVENT_MS;
      case 'RESULT':
        return ADV_AUTO_RESULT_MS;
      case 'EVENT_DONE':
        return ADV_AUTO_DONE_MS;
      default:
        return 0;
    }
  }

  private cancelAutoAdvance(): void {
    this.autoToken += 1;
    if (this.autoTimer !== null) {
      clearTimeout(this.autoTimer);
      this.autoTimer = null;
    }
  }

  private recordTerminal(s: AdventureState): void {
    const hp = advCarriedPlayerHp(s, this.ctx2);
    const summary: AdvRunSummary = {
      seedLabel: this.script.seedLabel,
      won: s.phase === 'COMPLETE',
      dayReached: s.day,
      dayTotal: s.dayTotal,
      battlesCompleted: s.battlesCompleted,
      battlesWon: s.battlesWon,
      finalHpPct: this.ctx2.playerHpMax > 0 ? Math.round((hp / this.ctx2.playerHpMax) * 100) : 0,
      buffs: [...s.buffs],
      finalHp: hp,
      playerHpMax: this.ctx2.playerHpMax,
      loadoutSource: this.loadoutSource,
      ts: Date.now(),
    };
    this.archive = recordRun(summary);
    this.archived = true;
  }

  /* ----------------------------------------------------------- 战斗 */

  private beginBattle(): void {
    this.endBattle();
    const node = advCurrentNode(this.state, this.script);
    const encounterId = node.kind === 'BATTLE' || node.kind === 'FINAL' ? node.encounterId : '';
    const rt = new RunBattleRuntime({
      build: this.state.buffs,
      carriedHp: advCarriedPlayerHp(this.state, this.ctx2),
      encounterId,
      playerDraft: this.loadout.draft,
      playerLoadoutTag: this.loadout.tag,
      playerBaseline: true,
    });
    this.battle = rt;
    // F3：弹丸峰值统计按「场」清零（每场的兑现证据互不混淆）。
    this.maxPlayerProjectiles = 0;
    this.maxPlayerRadius = 0;
    this.lastBattleShells = null;
  }

  private endBattle(): void {
    if (!this.battle) return;
    this.battle.dispose();
    this.battle = null;
  }

  /**
   * FRUITS-ADVENTURE-BATTLE-HP-F2｜顶部耐久条的**实时读数**（只读，仅供显示）。
   *
   * 直接取 `RunBattleRuntime.hp()`（= 正式物理车辆 `vehicleA.hp`），逐帧随真实伤害下降；
   * 无战斗实例时返回 `null` ⇒ `advTopDurability` 回落到已结算的 `carriedHp`。
   * ⚠️ 不改写任何状态、不参与伤害/维修/耐久继承/结算（真源仍是运行时与状态机）。
   */
  private liveBattleHp(): { readonly hp: number } | null {
    const rt = this.battle;
    if (!rt) return null;
    return { hp: rt.hp().a };
  }

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
      // F3：观测本场「玩家弹丸」峰值数 / 峰值半径 —— 双联炮 / 三连装填 / 重型弹头
      // 在正常速度下是否真的看得见，全部由这条只读统计作答（不改战斗、不改渲染）。
      const mine = (rt.snapshot().projectiles ?? []).filter((p) => p.team === 'A');
      if (mine.length > this.maxPlayerProjectiles) this.maxPlayerProjectiles = mine.length;
      for (const p of mine) if (p.radius > this.maxPlayerRadius) this.maxPlayerRadius = p.radius;
      const hp = rt.hp();
      this.state = syncAdventureBattle(this.state, { playerHp: hp.a, enemyHp: hp.b, steps: rt.stepCount });
      const result = rt.result;
      if (result) {
        // F3：本场弹丸峰值先存档，再走终态结算（战斗实例随后会被 dispose）。
        this.lastBattleShells = {
          maxPlayerSeen: this.maxPlayerProjectiles,
          maxPlayerRadiusSeen: this.maxPlayerRadius,
        };
        // 经 apply() 收口：确保终态（COMPLETE/FAILED）触发 recordTerminal（写入隔离测试档案），
        // 并正确 dispose 战斗、停循环、重绘（直接赋值会绕过档案写入，见 archive 隔离验收）。
        this.battleView.stopBattleAudio();
        this.apply(
          finishAdventureBattle(this.state, {
            winner: result.winner ?? null,
            endReason: result.endReason ?? null,
            playerHp: hp.a,
            enemyHp: hp.b,
            steps: rt.stepCount,
          }, this.script),
        );
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

  /* ----------------------------------------------------------- 渲染 */

  private render(): void {
    // F3：即时反馈到点自动消失（纯显示；render 每帧都会走到这里，无需额外计时器）。
    if (this.buildToast && performance.now() - this.buildToast.bornAt > ADV_BUILD_TOAST_MS) {
      this.buildToast = null;
    }
    // F6：本帧真实间隔（同时钟、只用于**合成镜头**的时间平滑；战斗物理 dt 仍走 startLoop，不受影响）。
    const nowPerf = performance.now();
    this.frameDtMs = this.lastDrawMs > 0 ? Math.min(50, Math.max(0, nowPerf - this.lastDrawMs)) : 0;
    this.lastDrawMs = nowPerf;
    const wrapW = this.stageWrap.clientWidth || PORTRAIT_LOGICAL_W;
    const wrapH = this.stageWrap.clientHeight || PORTRAIT_LOGICAL_H;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    this.vp.update(wrapW, wrapH, dpr);
    this.vp.applyTo(this.canvas);
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    this.draw(ctx);
  }

  /**
   * FRUITS-ADVENTURE-UX-CONTINUITY-R1｜一屏式绘制（**取代** R4 的「按阶段换版面」）。
   *
   * 四段恒定绘制，任何阶段都画同一套骨架 —— 这是「战斗/事件/奖励共享同一主场景、
   * 不再频繁整页跳转」的落实点：
   *   ① drawTop         顶部：DAY 进度 + 实时耐久（战斗中读真实运行时）
   *   ② drawStage       同一冒险舞台：战斗实时 / 战报定格帧 / 事件与敌情都把车留在场上
   *   ③ drawNarrative   固定叙事区：事件标题、效果、战报、开奖结果依次写入同一张卡
   *   ④ drawAction      底部唯一主操作：纯信息阶段**不画按钮**（只在下方渲染静态说明）
   *
   * 终局（COMPLETE / FAILED）也只换叙事区的内容（成绩卡），舞台与进度照旧常驻 ——
   * 不再整页换成「王座厅结算页」。
   */
  private draw(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = COLORS.pageBg;
    ctx.fillRect(0, 0, PORTRAIT_LOGICAL_W, PORTRAIT_LOGICAL_H);

    this.drawTop(ctx); // ①
    this.drawStage(ctx); // ②
    this.drawNarrative(ctx); // ③
    this.drawAction(ctx); // ④

    // F3：强化即时反馈（最顶层；瞬态自动消失，不挡输入）
    if (this.buildToast) this.drawBuildToast(ctx);
  }

  /* ----------------------------------------------------------- 素材工具 */

  /**
   * R1：把真实素材绘制到指定矩形。fit 默认 stretch（直接拉伸）；
   *   - cover：等比缩放铺满并居中裁剪（用于背景 / 卡片底，避免变形）；
   *   - contain：等比缩放完整放入并居中（用于宝箱 / 星级等图标）。
   * 资源未加载（缺失/克隆无素材）时返回 false，调用方据此降级为过程式绘制。
   */
  private blitImage(
    ctx: CanvasRenderingContext2D,
    id: AdvUiId,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    fit: 'stretch' | 'cover' | 'contain' = 'stretch',
  ): boolean {
    const img = this.ui.get(id);
    if (!img) return false;
    const sw = img.width;
    const sh = img.height;
    let sx = 0;
    let sy = 0;
    let sWidth = sw;
    let sHeight = sh;
    if (fit === 'cover') {
      const scale = Math.max(dw / sw, dh / sh);
      const cw = dw / scale;
      const ch = dh / scale;
      sx = (sw - cw) / 2;
      sy = (sh - ch) / 2;
      sWidth = cw;
      sHeight = ch;
    } else if (fit === 'contain') {
      const scale = Math.min(dw / sw, dh / sh);
      const cw = sw * scale;
      const ch = sh * scale;
      dx += (dw - cw) / 2;
      dy += (dh - ch) / 2;
      dw = cw;
      dh = ch;
    }
    ctx.drawImage(img, sx, sy, sWidth, sHeight, dx, dy, dw, dh);
    return true;
  }

  /** 圆角矩形路径（不 fill/stroke，由调用方决定）。 */
  private roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  private drawTop(ctx: CanvasRenderingContext2D): void {
    // R1：顶部**常驻**进度与耐久（任何阶段都不消失 —— 一屏式的"常驻状态层"）。
    ctx.fillStyle = COLORS.topBandBg;
    ctx.fillRect(0, 0, PORTRAIT_LOGICAL_W, TOP_BAND.h);
    ctx.fillStyle = COLORS.divider;
    ctx.fillRect(0, TOP_BAND.h - 1, PORTRAIT_LOGICAL_W, 1);

    // 进度（顶部单行）：DAY n/N + 阶段；右侧带一个线段式进度条（一眼看出走了多远）
    ctx.fillStyle = COLORS.textTitle;
    ctx.font = `600 17px ${FONT_STACK}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const stage = this.currentStage();
    const stageLabel = stage > 0 ? ` · 第${stage}阶段` : '';
    ctx.fillText(`冒险 · DAY ${this.state.day}/${this.state.dayTotal}${stageLabel}`, 16, 24);

    // 全程进度细条（DAY 进度，纯展示；不新增任何玩法状态）
    const progW = 132;
    const progX = PORTRAIT_LOGICAL_W - 16 - progW;
    const progY = 20;
    const prog = Math.max(0, Math.min(1, this.state.day / Math.max(1, this.state.dayTotal)));
    this.roundRectPath(ctx, progX, progY, progW, 7, 4);
    ctx.fillStyle = 'rgba(124,141,176,0.22)';
    ctx.fill();
    this.roundRectPath(ctx, progX, progY, Math.max(4, progW * prog), 7, 4);
    ctx.fillStyle = '#c8a04a';
    ctx.fill();

    // 装备来源药丸（右侧第二行，如实披露：演示/车库，绝不假装已读取）
    const demo = !this.loadoutSource.includes('正式车库');
    const srcLabel = demo ? '演示装备' : '车库装备';
    ctx.font = `500 10px ${FONT_STACK}`;
    const sw = ctx.measureText(srcLabel).width + 14;
    const sx = PORTRAIT_LOGICAL_W - 16 - sw;
    const sy = 34;
    const sh = 18;
    this.roundRectPath(ctx, sx, sy, sw, sh, 9);
    ctx.fillStyle = demo ? 'rgba(224,155,107,0.16)' : 'rgba(127,214,160,0.16)';
    ctx.fill();
    ctx.strokeStyle = demo ? 'rgba(224,155,107,0.55)' : 'rgba(127,214,160,0.55)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = demo ? '#e0b07f' : '#9fe0b8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(srcLabel, sx + sw / 2, sy + sh / 2);

    // 耐久条（第二行：标签左 / 进度中 / 百分比右）
    const hpBar: Rect = { x: 46, y: 56, w: 246, h: 16 };
    // FRUITS-ADVENTURE-BATTLE-HP-F2：战斗中读真实战斗运行时的当前 HP
    // （`RunBattleRuntime.hp().a`），其余阶段读已结算的 carriedHp。
    // 只换数据来源 —— 不新增任何 HP 状态，分母恒为 ctx.playerHpMax（切场不回跳）。
    const dur = advTopDurability(this.state, this.ctx2, this.liveBattleHp());
    const pct = dur.pct;
    this.blitImage(ctx, 'hp_bar_bg', hpBar.x - 2, hpBar.y - 2, hpBar.w + 4, hpBar.h + 4, 'cover');
    this.roundRectPath(ctx, hpBar.x, hpBar.y, hpBar.w, hpBar.h, 8);
    ctx.fillStyle = COLORS.hpBarBg;
    ctx.fill();
    ctx.save();
    this.roundRectPath(ctx, hpBar.x, hpBar.y, hpBar.w, hpBar.h, 8);
    ctx.clip();
    const fillW = Math.round((hpBar.w * pct) / 100);
    ctx.fillStyle = pct <= 25 ? COLORS.hpLow : COLORS.hpBarFill;
    ctx.fillRect(hpBar.x, hpBar.y, fillW, hpBar.h);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(hpBar.x, hpBar.y, fillW, hpBar.h * 0.4);
    ctx.restore();
    this.roundRectPath(ctx, hpBar.x, hpBar.y, hpBar.w, hpBar.h, 8);
    ctx.strokeStyle = '#0c1018';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = COLORS.textDim;
    ctx.font = `500 12px ${FONT_STACK}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('耐久', 14, hpBar.y + hpBar.h / 2);
    ctx.fillStyle = pct <= 25 ? COLORS.hpLow : COLORS.textBody;
    ctx.font = `600 12px ${FONT_STACK}`;
    ctx.textAlign = 'right';
    ctx.fillText(`${pct}%`, PORTRAIT_LOGICAL_W - 16, hpBar.y + hpBar.h / 2);
  }

  private currentStage(): number {
    let s = 0;
    for (const b of this.script.bannerPlan) if (b.day <= this.state.day) s = Math.max(s, b.stage);
    return s;
  }

  /**
   * ② 同一冒险舞台（高度恒定 390×378，任何阶段都不改变尺寸）。
   *
   * 三种内容，**同一个场景**：
   *   - 有战斗实例（BATTLE 实时 / RESULT 定格帧）：贴正式战斗画面（F1 等比 + F4/F6 自适应取景）；
   *   - 无战斗实例（开局的旅途、事件、阶段推进）：用同一张冒险场景底图做浅色压暗，
   *     并把「当前对手 / 目的地」写在舞台上，让玩家的车始终留在同一片荒原里；
   *   - 绝不换成王座厅 / 宝箱 / VS 竞技场等**另一个场景**（R1 取消事件与战斗之间的独立页面）。
   *
   * ⚠️ F1/F6 契约不变：`fill === 'cover'` 时沿用最后一次战斗取景（`blitAdventureHold`），
   *    只裁纵向、不缩放 ⇒ 战报与战斗的车辆像素尺寸一致。
   */
  private drawStage(ctx: CanvasRenderingContext2D, fill: 'exact' | 'cover' = 'exact'): void {
    const b = STAGE_BAND;
    if (this.battle) {
      // 真实战斗（BATTLE 实时 / RESULT 冻结帧）一律贴正式战斗画面。
      this.battleView.render(this.battle);
      if (fill === 'cover') {
        this.battleView.blitAdventureHold(ctx, b, 0.5);
      } else if (D2_FIXED) {
        this.battleView.blitSubject(ctx, b, D2_EXPERIMENT_ZOOM);
      } else if (ADV_CAMERA_OFF) {
        this.battleView.blit(ctx, b);
      } else {
        this.battleView.updateAdventureCamera(this.battle, ADV_CAMERA_MAX, this.frameDtMs);
        this.battleView.blitAdventureCamera(ctx, b);
      }
      this.drawBuildStrip(ctx);
      return;
    }

    // ── 非战斗：**同一场景**（同背景 + 同地面 + 同一辆车） ──
    if (!this.drawAdventureBackdrop(ctx, b)) {
      // 未注入场景图（素材缺失）：与战斗侧**同时**回落到同一深色渐变，不出现「一半有图一半没图」。
      const g = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
      g.addColorStop(0, '#2a2f3a');
      g.addColorStop(0.62, '#3a3428');
      g.addColorStop(1, '#241d15');
      ctx.fillStyle = g;
      ctx.fillRect(b.x, b.y, b.w, b.h);
    }
    const node = advCurrentNode(this.state, this.script);
    const pcx = b.x + b.w / 2;

    // 地面层（必改 1）：与战斗**同一段代码**（Renderer 的 platformOnly 分支）。
    // 少了这一层，两边的地平线以下就会不一样 —— 实测会让战斗帧 y≥363 是平地面、
    // 事件帧同区域仍是背景，玩家看到的就是「换了个地方」。
    const horizonY = b.y + b.h * 0.62;
    this.battleView.drawSceneGround(ctx, b.x, b.y, b.w, b.h, horizonY);

    // ── 待机战车（必改 1 / 验收 3）：非战斗阶段也要有清晰的车 ──
    // 用**正式车辆美术**（同一批 PNG，与战斗同一套），不是占位方块。
    // 位置：车轮压在地平线上，车头朝右（与战斗同朝向）。
    this.drawIdleVehicle(ctx, pcx, horizonY);

    // 舞台文字：贴上下边缘，绝不与车重叠；只保留**一句**（细节交给叙事区，避免两处重复）
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const title = (() => {
      if (node.kind === 'BATTLE' || node.kind === 'FINAL') return `前方：${this.battleEnemyLabel(node.encounterId)}`;
      if (node.kind === 'EVENT') return node.title;
      if (node.kind === 'BUILD') return '停下来整理装备';
      if (node.kind === 'BANNER') return '进入新的阶段';
      return '荒原路远';
    })();
    // 标题压在上缘 scrim 里（对比度足够，且不压车）
    const titleY = b.y + 26;
    ctx.font = `700 18px ${FONT_STACK}`;
    const tw = Math.min(b.w - 32, ctx.measureText(title).width + 28);
    this.roundRectPath(ctx, pcx - tw / 2, titleY - 15, tw, 30, 15);
    ctx.fillStyle = 'rgba(12,16,24,0.62)';
    ctx.fill();
    ctx.fillStyle = COLORS.textTitle;
    ctx.fillText(this.fitText(ctx, title, tw - 24), pcx, titleY);
  }

  /**
   * FRUITS-ADVENTURE-UX-COHERENCE-R2｜非战斗阶段的舞台底 —— **与战斗同一套代码、同一张素材**。
   *
   * R1 的失败点在这里：战斗画程序化蓝色竞技场，非战斗则在本页自绘「棕色渐变山脉」，
   * 于是同一趟冒险里存在**两套空间**（真人预验收第一条失败原因）。R1 只是把两者色温调近，
   * 属于「靠同一坐标冒充同一场景」——本轮明令禁止。
   *
   * 现在的机制：本方法不再自绘任何背景，而是调用 `battleView.drawSceneBackdrop()` →
   * Renderer 的 `drawAdventureSceneBackdrop()`，即战斗天空区用的**同一个函数、同一张 P0 底图**。
   * 所以「战斗 ↔ 事件 ↔ 强化 ↔ 战报」之间切换时，背景像素来自同一张图的同一次换算。
   *
   * 未注入底图时返回 false，调用方走与战斗一致的回落（深色渐变），保证两边同时降级。
   */
  private drawAdventureBackdrop(ctx: CanvasRenderingContext2D, b: Rect): boolean {
    return this.battleView.drawSceneBackdrop(ctx, b.x, b.y, b.w, b.h);
  }

  /**
   * FRUITS-ADVENTURE-UX-COHERENCE-R2｜非战斗阶段的**待机战车**（用正式车辆 PNG 拼出）。
   *
   * 组成与战斗一致：车体（body_watermelon）+ 主炮（part_cannon），朝向同为向右。
   * 位置参数 `groundY` 是地平线（车轮落在它上面）；本方法只画，不改任何状态。
   *
   * 为什么不用 Renderer：非战斗时没有 `RunBattleRuntime`，正式渲染器无从取景
   * （它按 orchestrator 快照画车）。这里直接取**同一批**已加载 PNG，
   * 因此「战斗中的车」与「事件中的车」是同一份美术资源，不是两套画法。
   */
  private drawIdleVehicle(ctx: CanvasRenderingContext2D, cx: number, groundY: number): void {
    const body = this.battleView.vehicleImage('body_watermelon');
    const cannon = this.battleView.vehicleImage('part_cannon');
    if (!body || body.width <= 0) return; // 素材缺失：不画占位，交由上方背景承担

    // 车体：目标宽 150px（与战斗远景中的观感接近），按原比例
    const bodyW = 150;
    const bodyH = (body.height / body.width) * bodyW;
    const bodyX = cx - bodyW / 2;
    const bodyY = groundY - bodyH;

    // 车底接地阴影（让车「站」在地上，而不是浮着）
    const shadow = ctx.createRadialGradient(cx, groundY + 2, 4, cx, groundY + 2, bodyW * 0.55);
    shadow.addColorStop(0, 'rgba(0,0,0,0.42)');
    shadow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = shadow;
    ctx.save();
    ctx.translate(cx, groundY + 2);
    ctx.scale(1, 0.22);
    ctx.beginPath();
    ctx.arc(0, 0, bodyW * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 车体
    ctx.drawImage(body as unknown as CanvasImageSource, bodyX, bodyY, bodyW, bodyH);

    // 主炮：贴在车体右上（炮口朝右），长度按车体宽度的 62%
    if (cannon && cannon.width > 0) {
      const gunW = bodyW * 0.62;
      const gunH = (cannon.height / cannon.width) * gunW;
      const gunX = bodyX + bodyW * 0.34;
      const gunY = bodyY - gunH * 0.52;
      ctx.drawImage(cannon as unknown as CanvasImageSource, gunX, gunY, gunW, gunH);
    }
  }


  private battleEnemyLabel(id: string): string {
    const map: Record<string, string> = {
      ProtoRusher: '原型冲撞者',
      Chaser: '追击者',
      RangedTurret: '远程炮塔车',
      ExtendedStandoffRod: '控距推杆车',
      ExtendedBurnSaw: '喷火锯车',
      ExtendedHeavyContact: '重锤装甲车',
    };
    return map[id] ?? '对手';
  }

  /* --------------------------------------------------- ③ 固定叙事区 */

  /**
   * ③ 固定叙事区（**一屏式结构的核心**）。
   *
   * 同一块区域承接全部「非决策信息」：旅途、敌情、战报、事件结果、开奖、阶段推进、终局成绩。
   * 场景（上方舞台）**始终不跳走**，信息只是在这里「依次写入」—— 这正是 Queue 要的
   * 「战斗、事件、奖励共享同一主场景，不再频繁整页跳转」。
   *
   * 底板用 P0 真实素材 `battle_event_text_bg`（浅色米白文本卡）做九宫格缩放，
   * 因此文字对比度天然足够（不必再用程序化黑底冒充）。
   * 决策阶段（EVENT_CHOICE / CHOICE）就地换成可点选项卡（见 `drawNarrativeChoices`）。
   */
  private drawNarrative(ctx: CanvasRenderingContext2D): void {
    // R1：叙事带**恒定满高**（这部分刻意不做自适应）。
    //
    // 为什么最终没有把富余高度还给舞台：F1（等比合成）与 F6（逐帧平滑）的读数口径都以
    // 「舞台带尺寸恒定」为前提；若让舞台随阶段变高，战斗首帧/换阶段的合成基准就会变，
    // 等于把刚刚在 F6 修好的「切场不跳」重新打开。舞台必须恒定，这是硬约束。
    //
    // 因此留白用**内容**填满，而不是靠拉伸底板：
    //   · 卡片高度随文字行数自适应（短文案不再撑满 246px 留大片纯色）；
    //   · 富余高度交给「战场底部装饰 + 底部状态行靠下对齐」——
    //     即卡片只占它需要的高度，其余部分保持叙事带底色，并在带内绘制分隔与留白节奏。
    const band = NARRATIVE_BAND;
    ctx.fillStyle = '#141a24';
    ctx.fillRect(band.x, band.y, band.w, band.h);
    const fade = ctx.createLinearGradient(0, band.y - 16, 0, band.y + 6);
    fade.addColorStop(0, 'rgba(20,26,36,0)');
    fade.addColorStop(1, 'rgba(20,26,36,1)');
    ctx.fillStyle = fade;
    ctx.fillRect(band.x, band.y - 16, band.w, 22);

    const card = advOverlayOpen(this.state)
      ? UX_NARRATIVE_CARD
      : { ...UX_NARRATIVE_CARD, h: this.narrativeCardHeight(ctx) };

    // 卡片底板：真实 P0 浅色文本卡（九宫格，角落 1:1，不拉伸）
    const drewCard = this.drawNineSliceId(ctx, 'text_card_bg', card.x, card.y, card.w, card.h);
    if (!drewCard) {
      // 素材缺失（公网 clone / 未复制 public/adventure-ui）：降级为浅色圆角底，
      // 保持「浅色卡片 + 深色文字」的可读性契约，**不回退成黑底**。
      ctx.fillStyle = '#f3ecd8';
      this.roundRectPath(ctx, card.x, card.y, card.w, card.h, 14);
      ctx.fill();
    }

    if (advOverlayOpen(this.state)) {
      this.drawNarrativeChoices(ctx, card);
      return;
    }

    this.drawNarrativeInfo(ctx, card);
    // 卡片之下的富余高度：画「本局历程条」（真实状态，不是装饰性填充）。
    // 它同时承担两个产品目的：
    //   ① 消除「卡片下面一大块空」的留白观感（实测卡片收紧后会留下约 140px 空带）；
    //   ② 让玩家在**任何阶段**都能一眼看到「我走到哪了 / 赢了几场 / 现在带着哪些改装」，
    //      这是一屏式连续性的一部分（不必回翻日志）。
    // 位置：贴叙事带底部内侧（而不是紧跟卡片）——这样无论卡片多高，它都稳定在同一处，
    // 玩家不会觉得元素在跳。
    const stripH = UX_JOURNEY_H;
    const stripY = NARRATIVE_BAND.y + NARRATIVE_BAND.h - stripH - 8;
    if (card.y + card.h + 8 <= stripY) this.drawJourneyStrip(ctx, stripY);
  }

  /**
   * 本局历程条（只读状态，不新增任何玩法数据）。
   *
   * 三块信息，全部来自既有 state：
   *   DAY n/N 进度点阵 —— 已过天数实心，未过空心（一眼看出走了多远）；
   *   战绩 `胜 x / 战 y` —— battlesWon / battlesCompleted；
   *   改装图标串 —— 本局已获得的 buffs（与战斗中左上角改装条同源图标）。
   */
  private drawJourneyStrip(ctx: CanvasRenderingContext2D, y: number): void {
    const x = UX_NARRATIVE_CARD.x;
    const w = UX_NARRATIVE_CARD.w;
    const h = UX_JOURNEY_H;
    if (y + h > NARRATIVE_BAND.y + NARRATIVE_BAND.h + 1) return;

    ctx.save();
    // 底板：比叙事带略亮一档（同色系），让这块「有内容」而不是「空色带」
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, 'rgba(58,68,86,0.55)');
    g.addColorStop(1, 'rgba(38,46,60,0.55)');
    this.roundRectPath(ctx, x, y, w, h, 12);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(200,160,74,0.34)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.textBaseline = 'middle';
    // ① 标签
    ctx.textAlign = 'left';
    ctx.fillStyle = '#d8b45e';
    ctx.font = `700 12px ${FONT_STACK}`;
    ctx.fillText('历程', x + 14, y + 16);

    // ② DAY 进度点阵（已过 = 金色实心，未过 = 暗金空心）
    const total = Math.max(1, this.state.dayTotal);
    const dotX0 = x + 50;
    const dotGap = Math.min(9.4, (w - 210) / total);
    const dotR = Math.min(3.4, dotGap * 0.4);
    for (let i = 1; i <= total; i++) {
      const cx = dotX0 + (i - 1) * dotGap;
      ctx.beginPath();
      ctx.arc(cx, y + 16, dotR, 0, Math.PI * 2);
      const passed = i <= this.state.day;
      ctx.fillStyle = passed ? '#e0b45e' : 'rgba(200,160,74,0.20)';
      ctx.fill();
    }

    // ③ 战绩（与点阵同一行，右侧）
    const statX = dotX0 + total * dotGap + 12;
    ctx.fillStyle = '#cfd9e8';
    ctx.font = `700 12px ${FONT_STACK}`;
    ctx.fillText(`胜 ${this.state.battlesWon}/${this.state.battlesCompleted}`, statX, y + 16);

    // ④ 第二行：改装图标串（有图标就画图标，没有就写「尚无改装」）
    const buffs = this.state.buffs;
    const icon = 20;
    const gap = 6;
    const rowY = y + h - 15;
    if (buffs.length === 0) {
      ctx.fillStyle = 'rgba(207,217,232,0.5)';
      ctx.font = `500 11px ${FONT_STACK}`;
      ctx.fillText('尚无改装', x + 14, rowY);
    } else {
      ctx.fillStyle = 'rgba(207,217,232,0.72)';
      ctx.font = `500 11px ${FONT_STACK}`;
      ctx.fillText('改装', x + 14, rowY);
      const n = Math.min(buffs.length, 9);
      for (let i = 0; i < n; i++) {
        const ix = x + 48 + i * (icon + gap);
        this.blitImage(ctx, advBuildIconId(buffs[i]), ix, rowY - icon / 2, icon, icon, 'contain');
      }
      if (buffs.length > n) {
        ctx.fillStyle = 'rgba(207,217,232,0.6)';
        ctx.font = `500 10px ${FONT_STACK}`;
        ctx.fillText(`+${buffs.length - n}`, x + 48 + n * (icon + gap) + 2, rowY);
      }
    }

    // ⑤ 右侧：当前耐久百分比（与顶栏同一真源，这里只是就近复述）
    const dur = advTopDurability(this.state, this.ctx2, this.liveBattleHp());
    ctx.textAlign = 'right';
    ctx.fillStyle = dur.pct <= 25 ? '#e07a6a' : '#9fe0b8';
    ctx.font = `700 14px ${FONT_STACK}`;
    ctx.fillText(`${dur.pct}%`, x + w - 14, rowY);
    ctx.fillStyle = 'rgba(207,217,232,0.55)';
    ctx.font = `500 10px ${FONT_STACK}`;
    ctx.fillText('耐久', x + w - 14 - ctx.measureText(`${dur.pct}%`).width - 46, rowY);
    ctx.restore();
  }

  /**
   * 信息态叙事卡：标题行（图标 + 标题 + 阶段徽标）→ 正文行 → 底部状态行。
   *
   * 正文来自 `advNarrativeLines`（纯函数，只取「刚刚发生这一件事」的行），
   * 因此卡片永远不会被前几天的旧文字占满，也不会漏掉本次结果。
   */
  /**
   * 信息态叙事卡的自适应高度（纯测量，不改状态）。
   *
   * 公式：卡头 50（标题+徽标+分隔线）+ 正文行数×22 + 底部状态行 34 + 上下留白 12。
   * 下限 132（保证短文案时卡片不显局促），上限 = 叙事带可用高度。
   *
   * 为什么必须自适应：决策状态的卡片要塞 2–4 张选项卡 ⇒ 必须用满高；
   * 而信息状态通常只有 2–4 行字，用满高会在卡内下方留出大片纯色 ——
   * Queue 验收 3 明确要求「无严重留白」，这里用测量结果说话，而不是目测调数值。
   */
  private narrativeCardHeight(ctx: CanvasRenderingContext2D): number {
    const card = UX_NARRATIVE_CARD;
    const padX = 18;
    const innerW = card.w - padX * 2;
    const lines = advNarrativeLines(this.state, UX_NARRATIVE_MAX_LINES);
    // 用与绘制完全相同的字号/行高做测量（14px / 行高 22）
    ctx.font = `400 14px ${FONT_STACK}`;
    let rows = 0;
    for (const entry of lines) rows += this.measureRows(ctx, `· ${entry.text}`, innerW);
    const body = Math.max(1, Math.min(rows, UX_NARRATIVE_MAX_LINES + 2)) * 22;
    // 卡头 46（标题+徽标+分隔线，见 drawNarrativeInfo 的 titleY/lineY）+ 正文 + 底行 26
    const h = 46 + body + 26;
    const bandH = NARRATIVE_BAND.h - (card.y - NARRATIVE_BAND.y) - 8;
    return Math.max(120, Math.min(bandH, h));
  }

  /** 按宽度测量一段文字会占几行（与 `wrapLeft` 的折行规则一致）。 */
  private measureRows(ctx: CanvasRenderingContext2D, text: string, maxW: number): number {
    const chars = [...text];
    let line = '';
    let rows = 1;
    for (const ch of chars) {
      const test = line + ch;
      if (ctx.measureText(test).width > maxW && line.length > 0) {
        rows += 1;
        line = ch;
      } else {
        line = test;
      }
    }
    return rows;
  }

  private drawNarrativeInfo(ctx: CanvasRenderingContext2D, card: Rect): void {
    const node = (() => {
      try {
        return advCurrentNode(this.state, this.script);
      } catch {
        return null;
      }
    })();
    const title = advNarrativeTitle(this.state, this.script);
    const isWin = this.state.battle?.winner === 'A';
    const isLoss = this.state.phase === 'FAILED' || (this.state.phase === 'RESULT' && !isWin);
    const accent = this.state.phase === 'COMPLETE'
      ? '#2f7d4f'
      : isLoss
        ? '#b03a2e'
        : this.state.phase === 'RESULT' && isWin
          ? '#2f7d4f'
          : '#8a5a1e';

    const padX = 18;
    const innerW = card.w - padX * 2;
    const titleY = card.y + 30;

    // 图标（真实语义素材；缺失时用过程式图形，绝不空一块）
    const iconId = this.narrativeIconId();
    const iconSize = 28;
    if (this.ui.ready(iconId)) {
      drawContain(ctx, this.ui.get(iconId)!, card.x + padX, titleY - iconSize / 2, iconSize, iconSize);
    } else if (node && node.kind === 'EVENT') {
      this.drawEventIcon(ctx, node.eventKind, card.x + padX + iconSize / 2, titleY, 22, accent);
    }
    // 标题（深色，保证在浅色卡上最高对比）
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#2a2118';
    ctx.font = `700 19px ${FONT_STACK}`;
    ctx.fillText(this.fitText(ctx, title, innerW - iconSize - 12), card.x + padX + iconSize + 10, titleY);

    // 阶段徽标（右上）：战斗中 / 结算中 / 待决定 —— 让玩家一眼知道「现在要不要动手」
    const tag = this.narrativeTag();
    if (tag) {
      ctx.font = `600 11px ${FONT_STACK}`;
      const tw = ctx.measureText(tag.text).width + 14;
      const tx = card.x + card.w - padX - tw;
      this.roundRectPath(ctx, tx, titleY - 10, tw, 20, 10);
      ctx.fillStyle = tag.tone === 'wait' ? 'rgba(176,58,46,0.14)' : 'rgba(42,33,24,0.10)';
      ctx.fill();
      ctx.fillStyle = tag.tone === 'wait' ? '#b03a2e' : '#6b5a45';
      ctx.textAlign = 'center';
      ctx.fillText(tag.text, tx + tw / 2, titleY);
    }

    // 分隔线（真实素材 event_line，单轴拉伸不失真；缺失则画 1px 线）
    const lineY = card.y + 50;
    if (!this.blitImage(ctx, 'event_line', card.x + padX, lineY, innerW, 4, 'stretch')) {
      ctx.fillStyle = 'rgba(42,33,24,0.16)';
      ctx.fillRect(card.x + padX, lineY, innerW, 1);
    }

    // 正文（最多 UX_NARRATIVE_MAX_LINES 行，字号 14，行高 22）
    const lines = advNarrativeLines(this.state, UX_NARRATIVE_MAX_LINES);
    let ty = card.y + 74;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#3a2f24';
    ctx.font = `400 14px ${FONT_STACK}`;
    for (const entry of lines) {
      const rows = this.wrapLeft(ctx, entry.text, card.x + padX, ty, innerW, 22, entry.kind);
      ty += rows * 22;
      if (ty > card.y + card.h - 56) break;
    }

    // 底部状态行：谁在等我 / 正在自动进行（不出现「按继续」这类空指令）
    const footY = card.y + card.h - 22;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const foot = this.narrativeFooter();
    ctx.fillStyle = foot.tone === 'wait' ? '#8a2f24' : '#6b5a45';
    ctx.font = `600 12px ${FONT_STACK}`;
    ctx.fillText(this.fitText(ctx, foot.text, innerW - 88), card.x + padX, footY);
    // 自动承接的倒计时细条（右侧）：让「正在自己往下走」这件事可见，而不是干等
    const wait = this.autoRemainingFraction();
    if (wait > 0) {
      const barW = 74;
      const barX = card.x + card.w - padX - barW;
      this.roundRectPath(ctx, barX, footY - 3, barW, 6, 3);
      ctx.fillStyle = 'rgba(42,33,24,0.16)';
      ctx.fill();
      this.roundRectPath(ctx, barX, footY - 3, Math.max(2, barW * wait), 6, 3);
      ctx.fillStyle = '#8a5a1e';
      ctx.fill();
    }
  }

  /** 叙事卡图标（按阶段 / 节点给出真实素材 id）。 */
  private narrativeIconId(): AdvUiId {
    const node = (() => {
      try {
        return advCurrentNode(this.state, this.script);
      } catch {
        return null;
      }
    })();
    switch (this.state.phase) {
      case 'BATTLE':
        return 'icon_up';
      case 'RESULT':
        return this.state.battle?.winner === 'A' ? 'icon_none' : 'icon_damage';
      case 'COMPLETE':
        return 'star';
      case 'FAILED':
        return 'icon_damage';
      case 'EVENT_DONE':
        return 'icon_heal';
      default:
        break;
    }
    if (!node) return 'icon_none';
    if (node.kind === 'EVENT') return advEventIconId(node.eventKind);
    if (node.kind === 'BUILD') return 'icon_up';
    if (node.kind === 'BATTLE' || node.kind === 'FINAL') return 'icon_trade';
    return 'icon_none';
  }

  /** 叙事卡右上徽标（当前状态类型）。 */
  private narrativeTag(): { text: string; tone: 'wait' | 'info' } | null {
    switch (this.state.phase) {
      case 'BATTLE':
        return { text: '交战中', tone: 'info' };
      case 'EVENT':
        return { text: '即将开战', tone: 'info' };
      case 'RESULT':
        return { text: '战报', tone: 'info' };
      case 'EVENT_DONE':
        return { text: '结果', tone: 'info' };
      case 'EVENT_CHOICE':
      case 'CHOICE':
        return { text: '需要你决定', tone: 'wait' };
      case 'COMPLETE':
        return { text: '通关', tone: 'info' };
      case 'FAILED':
        return { text: '失败', tone: 'info' };
      default:
        return { text: '等待出发', tone: 'wait' };
    }
  }

  /**
   * 叙事卡底部状态行（**决定是否需要玩家动手**的唯一展示口径）。
   * 决不用「按继续」这种无信息指令：需要动手就说清楚要做什么，自动推进就说明会自动进行。
   */
  private narrativeFooter(): { text: string; tone: 'wait' | 'info' } {
    const node = (() => {
      try {
        return advCurrentNode(this.state, this.script);
      } catch {
        return null;
      }
    })();
    switch (this.state.phase) {
      case 'BATTLE':
        return { text: '战斗进行中，结束后自动结算', tone: 'info' };
      case 'EVENT':
        return { text: '马上开打', tone: 'info' };
      case 'RESULT':
        return { text: '战报已记录，接着往下走', tone: 'info' };
      case 'EVENT_DONE':
        return { text: '结果已结算，接着往下走', tone: 'info' };
      case 'EVENT_CHOICE':
        return { text: '选一个做法（下方卡片）', tone: 'wait' };
      case 'CHOICE':
        return { text: '选一项改装（下方卡片）', tone: 'wait' };
      case 'COMPLETE':
        return { text: '这趟路走完了，可以再来一局', tone: 'wait' };
      case 'FAILED':
        return { text: '车被打坏了，可以再试一次', tone: 'wait' };
      default:
        if (!node) return { text: '准备好就出发', tone: 'wait' };
        if (node.kind === 'BATTLE' || node.kind === 'FINAL') return { text: '前方有敌人，出发迎战', tone: 'wait' };
        if (node.kind === 'EVENT') return { text: '路边有情况，上前看看', tone: 'wait' };
        if (node.kind === 'BUILD') return { text: '停下来改装一下', tone: 'wait' };
        if (node.kind === 'BANNER') return { text: '继续赶路', tone: 'wait' };
        return { text: '出发', tone: 'wait' };
    }
  }

  /** 自动承接的剩余比例（1 → 0）；非自动阶段返回 0。 */
  private autoRemainingFraction(): number {
    const delay = this.autoAdvanceDelayMs();
    if (delay <= 0 || this.autoTimer === null) return 0;
    const elapsed = performance.now() - this.phaseEnteredAt;
    return Math.max(0, Math.min(1, 1 - elapsed / delay));
  }

  /**
   * 决策态叙事卡：**就地**把卡片内容换成可点选项卡（不弹全屏遮罩，不遮住上方战场）。
   * 事件二选一 → 两张卡；改装三选一 → 三张卡。位置由 `uxOptionRects` 统一给出（E2E 同源）。
   */
  private drawNarrativeChoices(ctx: CanvasRenderingContext2D, card: Rect): void {
    const node = advCurrentNode(this.state, this.script);
    const cards = advOverlayCards(this.state, this.script, this.ctx2);
    const rects = uxOptionRects(cards.length);
    const isEvent = node.kind === 'EVENT';
    const accent = isEvent ? EVENT_THEME[node.eventKind].accent : COLORS.eventAccent;

    // 卡头：这句话就是本次的决策问题
    const headY = card.y - 6;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#e8b23c';
    ctx.font = `700 13px ${FONT_STACK}`;
    const question = isEvent ? node.title : '选择一项改装（下一场战斗生效）';
    ctx.fillText(this.fitText(ctx, question, card.w - 24), card.x + 2, headY - 10);

    const fullHp = advCarriedPlayerHp(this.state, this.ctx2) >= this.ctx2.playerHpMax;
    for (let i = 0; i < rects.length; i++) {
      const eff = isEvent && node.kind === 'EVENT' ? node.outcomes[cards[i].id] : undefined;
      this.drawChoiceCard(ctx, rects[i], i, {
        icon: isEvent ? advOutcomeIconId(eff?.kind ?? 'none') : advBuildIconId(cards[i].id),
        accent,
        label: cards[i].label,
        gain: isEvent ? this.effectGain(eff) : cards[i].note,
        cost: isEvent ? this.effectCost(eff) : '—',
        caveat: isEvent ? this.effectCaveat(eff, fullHp) : undefined,
      });
    }
  }

  /**
   * 九宫格绘制（按素材 id）；素材缺失返回 false（调用方降级）。
   * 边距来自 `AdvUiStore.insets`（量取值），绝不在此处「目测」。
   */
  private drawNineSliceId(ctx: CanvasRenderingContext2D, id: AdvUiId, x: number, y: number, w: number, h: number): boolean {
    const img = this.ui.get(id);
    const ins = this.ui.insets(id);
    if (!img || !ins) return false;
    return drawNineSlice(ctx, img, x, y, w, h, ins);
  }

  /**
   * 左对齐自动换行（叙事区正文用；返回实际行数）。
   * `kind` 只影响首行前缀符号（耐久变化用 ▲▼，战斗结果用 ✓✕），不改文本内容。
   */
  private wrapLeft(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxW: number,
    lineH: number,
    kind?: AdventureLogEntryKindLike,
  ): number {
    const prefix = kind === 'durability' ? '· ' : kind === 'result' ? '· ' : '';
    const full = prefix + text;
    const chars = [...full];
    let line = '';
    let ly = y;
    let rows = 1;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const ch of chars) {
      const test = line + ch;
      if (ctx.measureText(test).width > maxW && line.length > 0) {
        ctx.fillText(line, x, ly);
        line = ch;
        ly += lineH;
        rows += 1;
      } else {
        line = test;
      }
    }
    if (line.length > 0) ctx.fillText(line, x, ly);
    return rows;
  }


  /**
   * F3：强化获得的**即时反馈卡**（最顶层，瞬态 ~2.4s）。
   *
   * 版面刻意最小化：图标 + 「改装完成 · 强化名」+ 一行核心收益（紧急维修换成真实修理量）。
   * 没有第二段说明文字 —— 效果由下一场战斗画面自己兑现（必改 2）。
   *
   * R1 位置：舞台带底部（`STAGE_BAND.y + STAGE_BAND.h - 52`），横幅式浮在战场下沿。
   * 这个位置对三种内容都不相压：
   *   - 战斗画面：车辆与弹丸集中在中部，下沿是地面/路面色带；
   *   - 非战斗舞台：舞台正文写在中线（b.y + h/2），与其相隔 ≥ 130px；
   *   - 叙事区：在舞台带之外，完全不重叠。
   */
  private drawBuildToast(ctx: CanvasRenderingContext2D): void {
    const t = this.buildToast;
    if (!t) return;
    const age = performance.now() - t.bornAt;
    const alpha = age > ADV_BUILD_TOAST_MS - ADV_TOAST_FADE_MS
      ? Math.max(0, (ADV_BUILD_TOAST_MS - age) / ADV_TOAST_FADE_MS)
      : 1;
    if (alpha <= 0) return;

    const w = 296;
    const h = 40;
    const x = Math.round((PORTRAIT_LOGICAL_W - w) / 2);
    const y = STAGE_BAND.y + STAGE_BAND.h - 52;
    ctx.save();
    ctx.globalAlpha = alpha;
    // 底（与事件选择卡同一族视觉：暗底 + 主题色描边）
    ctx.fillStyle = 'rgba(10,14,22,0.94)';
    this.roundRectPath(ctx, x, y, w, h, 10);
    ctx.fill();
    ctx.strokeStyle = COLORS.eventAccent;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // 左侧：强化专属图标（已筛选的冒险 UI 素材；缺失则整块留白，不画占位）
    const icon = 24;
    this.blitImage(ctx, advBuildIconId(t.id), x + 10, y + (h - icon) / 2, icon, icon, 'contain');
    // 右侧：两行短文本（总宽 244）
    const tx = x + 42;
    const tw = w - 52;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    // 第一行：「改装完成」标签 + 强化名
    ctx.font = `600 10px ${FONT_STACK}`;
    const tagW = Math.min(ctx.measureText('改装完成').width, 44);
    ctx.fillStyle = COLORS.eventAccent;
    ctx.fillText('改装完成', tx, y + 14);
    ctx.font = `700 14px ${FONT_STACK}`;
    ctx.fillStyle = COLORS.textTitle;
    ctx.fillText(this.fitText(ctx, t.label, tw - tagW - 6), tx + tagW + 6, y + 14);
    // 第二行：一行核心收益（紧急维修 = 真实修理量，绿色强调）
    ctx.fillStyle = t.extra ? '#7fd6a0' : COLORS.textDim;
    ctx.font = `500 11px ${FONT_STACK}`;
    ctx.fillText(this.fitText(ctx, t.extra || t.gain, tw), tx, y + 28);
    ctx.restore();
  }

  /**
   * F3：战斗中的「本局改装」图标条（兑现锚点）。
   *
   * 只给图标，不给数值、不给机制说明 —— 玩家自己把「我选的双联炮」与画面里
   * 「一次两发炮弹」对应起来（必改 2：用已有炮弹数量 / 弹丸表现 / 耐久恢复兑现）。
   * 位置在舞台带左上（天空区），不遮车辆、不遮弹丸。
   */
  private drawBuildStrip(ctx: CanvasRenderingContext2D): void {
    const buffs = this.state.buffs;
    if (buffs.length === 0) return;
    const icon = 18;
    const gap = 5;
    const labelW = 30;
    const padX = 10;
    const w = labelW + buffs.length * (icon + gap) + padX;
    const h = 30;
    const x = 12;
    const y = STAGE_BAND.y + 12;
    ctx.save();
    ctx.fillStyle = 'rgba(10,14,22,0.62)';
    this.roundRectPath(ctx, x, y, w, h, 15);
    ctx.fill();
    ctx.strokeStyle = 'rgba(124,141,176,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = COLORS.textDim;
    ctx.font = `600 11px ${FONT_STACK}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('改装', x + 10, y + h / 2);
    for (let i = 0; i < buffs.length; i++) {
      this.blitImage(ctx, advBuildIconId(buffs[i]), x + labelW + i * (icon + gap), y + (h - icon) / 2, icon, icon, 'contain');
    }
    ctx.restore();
  }

  /**
   * ④ 底部唯一主操作位（一屏式结构的「单点行动」）。
   *
   * R1 的核心纪律（Queue 必改 2）：
   *   - **只在真的需要玩家推进时**画按钮：IDLE（出发/上前/改装）、COMPLETE / FAILED（复玩）；
   *   - 纯信息阶段（BATTLE / EVENT / RESULT / EVENT_DONE）**不画按钮**，改为一行状态文案，
   *     绝不铺一个「战斗中」的假可点按钮；
   *   - 决策阶段（EVENT_CHOICE / CHOICE）按钮区让位给叙事区卡片（这里显示「在上方选一个」）。
   *
   * 按钮本体用 P0 真实素材 `btn_green`（九宫格，圆角不被压扁）；素材缺失时降级为
   * 同色系圆角矩形（保持「绿色行动按钮」这一视觉语义，不回退成灰底）。
   */
  private drawAction(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = COLORS.actionBandBg;
    ctx.fillRect(ACTION_BAND.x, ACTION_BAND.y, ACTION_BAND.w, ACTION_BAND.h);
    // 顶部分隔线（与叙事区划分）
    ctx.fillStyle = 'rgba(124,141,176,0.18)';
    ctx.fillRect(ACTION_BAND.x, ACTION_BAND.y, ACTION_BAND.w, 1);

    const overlay = advOverlayOpen(this.state);
    const actionable = advNeedsPlayer(this.state) && advActionEnabled(this.state);
    const r = this.state.phase === 'COMPLETE' || this.state.phase === 'FAILED' ? TERMINAL_CTA : ACTION_BTN;

    if (!actionable && !overlay) {
      // 纯信息阶段：一行状态，不画按钮（杜绝「假 CTA」）。
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = COLORS.textDim;
      ctx.font = `500 13px ${FONT_STACK}`;
      const msg = this.state.phase === 'BATTLE'
        ? '战斗进行中 · 结束后自动结算'
        : this.state.phase === 'EVENT'
          ? '敌情已到 · 马上开打'
          : '结果已记录 · 自动继续';
      ctx.fillText(msg, ACTION_BAND.x + ACTION_BAND.w / 2, ACTION_BAND.y + ACTION_BAND.h / 2);
      return;
    }
    if (overlay) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#e8b23c';
      ctx.font = `600 13px ${FONT_STACK}`;
      ctx.fillText('在上面的卡片里选一个', ACTION_BAND.x + ACTION_BAND.w / 2, ACTION_BAND.y + ACTION_BAND.h / 2);
      return;
    }

    // 真实九宫格按钮（绿色＝可行动；终局用同一素材的更大尺寸）
    const drew = this.drawNineSliceId(ctx, 'btn_green', r.x, r.y, r.w, r.h);
    if (!drew) {
      const g = ctx.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
      g.addColorStop(0, '#63c812');
      g.addColorStop(1, '#4a9a0c');
      this.roundRectPath(ctx, r.x, r.y, r.w, r.h, 16);
      ctx.fillStyle = g;
      ctx.fill();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${this.state.phase === 'COMPLETE' || this.state.phase === 'FAILED' ? 22 : 19}px ${FONT_STACK}`;
    const mainY = r.y + r.h * (this.state.phase === 'COMPLETE' || this.state.phase === 'FAILED' ? 0.42 : 0.5);
    ctx.shadowColor = 'rgba(20,40,0,0.55)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 1;
    ctx.fillText(advActionLabel(this.state), r.x + r.w / 2, mainY);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    if (this.state.phase === 'COMPLETE' || this.state.phase === 'FAILED') {
      ctx.fillStyle = 'rgba(255,255,255,0.82)';
      ctx.font = `500 12px ${FONT_STACK}`;
      ctx.fillText('开始新一局（新随机种子）', r.x + r.w / 2, r.y + r.h * 0.72);
    }
  }

  /**
   * 单张选项卡（FRUITS-ADVENTURE-UX-COHERENCE-R2 重排版式）。
   *
   * 真人预验收的失败点是「文字截断 / 卡片挤压 / 信息重叠」。旧版把「名称 + 收益 + 代价」
   * 全塞在**同一行**里，逼得字号只有 13/12px、收益与代价还要左右抢宽度 ——
   * 于是即使没触发省略号，观感也是挤压的。光靠 `fitText` 截断掩盖不了这件事。
   *
   * 新版改为**三行结构化**（每行各司其职，互不抢宽度）：
   *
   *   ┌──────────────────────────────────────────────┐
   *   │ [图标]  名称                          （19px）│
   *   │         收益  恢复耐久                  （14px）│
   *   │         代价  ——                        （14px）│
   *   └──────────────────────────────────────────────┘
   *
   * 关键约束（由 `_e2e_text_fit_r2.cjs` 真实 measureText 守着）：
   *   · 名称独占一行，可用宽度 = 卡片宽 − 图标列 − 内边距（@390 约 276px）；
   *   · 收益/代价各占一行，标签与内容左对齐，**不再左右分栏抢宽**；
   *   · 信息行字号 14px、名称 19px —— 信息不靠缩字号塞进去；
   *   · 仍超宽才省略，且 E2E 断言「0 截断」。
   */
  private drawChoiceCard(
    ctx: CanvasRenderingContext2D,
    r: Rect,
    index: number,
    text: {
      icon: AdvUiId;
      accent: string;
      label: string;
      gain: string;
      cost: string;
      caveat?: string;
    },
  ): void {
    const pressed = this.pressCard === index;

    // 卡片底：浅色真实底板（九宫格；缺失则浅色圆角降级），深色文字保证对比度
    if (!this.drawNineSliceId(ctx, 'text_card_bg', r.x, r.y, r.w, r.h)) {
      ctx.fillStyle = '#f3ecd8';
      this.roundRectPath(ctx, r.x, r.y, r.w, r.h, 12);
      ctx.fill();
    }
    if (pressed) {
      ctx.save();
      this.roundRectPath(ctx, r.x + 2, r.y + 2, r.w - 4, r.h - 4, 10);
      ctx.clip();
      ctx.fillStyle = withAlpha(text.accent, 0.22);
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.restore();
    }
    this.roundRectPath(ctx, r.x + 1.5, r.y + 1.5, r.w - 3, r.h - 3, 11);
    ctx.lineWidth = pressed ? 3 : 1.5;
    ctx.strokeStyle = pressed ? '#7a4a12' : withAlpha(text.accent, 0.55);
    ctx.stroke();

    // ---- 左侧图标（固定 40px 列，不随文字长度变化 ⇒ 多张卡纵向对齐） ----
    const iconSize = 40;
    const padX = 14;
    const iconX = r.x + padX;
    const iconY = r.y + (r.h - iconSize) / 2;
    this.roundRectPath(ctx, iconX, iconY, iconSize, iconSize, 10);
    ctx.fillStyle = withAlpha(text.accent, 0.14);
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = withAlpha(text.accent, 0.5);
    ctx.stroke();
    if (this.ui.ready(text.icon)) {
      drawContain(ctx, this.ui.get(text.icon)!, iconX + 5, iconY + 5, iconSize - 10, iconSize - 10);
    } else {
      ctx.fillStyle = withAlpha(text.accent, 0.45);
      ctx.beginPath();
      ctx.arc(iconX + iconSize / 2, iconY + iconSize / 2, iconSize * 0.18, 0, Math.PI * 2);
      ctx.fill();
    }

    // ---- 文本列：名称 / 收益 / 代价，三行左对齐 ----
    const tx = iconX + iconSize + 12;
    const rightLimit = r.x + r.w - padX;
    const textW = rightLimit - tx;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    const hasCaveat = !!text.caveat;
    // 纵向节奏：有 caveat 时三行整体上移，把 caveat 挂在代价行右侧（不新增行、不重叠）
    const nameY = r.y + (hasCaveat ? 26 : r.h * 0.3);
    const gainY = r.y + (hasCaveat ? 50 : r.h * 0.56);
    const costY = r.y + (hasCaveat ? 72 : r.h * 0.82);

    // 名称（最大字号，独占一行）
    ctx.fillStyle = '#2a2118';
    ctx.font = `700 19px ${FONT_STACK}`;
    ctx.fillText(this.fitText(ctx, text.label, textW), tx, nameY);

    // 收益行：固定 34px 标签列 + 内容
    const labelCol = 34;
    ctx.font = `700 12px ${FONT_STACK}`;
    ctx.fillStyle = '#8a7a62';
    ctx.fillText('收益', tx, gainY);
    ctx.font = `600 14px ${FONT_STACK}`;
    ctx.fillStyle = '#1f6b40';
    ctx.fillText(this.fitText(ctx, text.gain, textW - labelCol), tx + labelCol, gainY);

    // 代价行：同样固定标签列，与收益行左对齐（不再左右分栏抢宽）
    ctx.font = `700 12px ${FONT_STACK}`;
    ctx.fillStyle = '#8a7a62';
    ctx.fillText('代价', tx, costY);
    ctx.font = `600 14px ${FONT_STACK}`;
    ctx.fillStyle = text.cost === '—' ? '#8a7a62' : '#a8501f';
    const shownCost = this.fitText(ctx, text.cost, textW - labelCol);
    ctx.fillText(shownCost, tx + labelCol, costY);

    // caveat（满耐久等特例）：挂在代价行右侧；若空间不够则**不画**（绝不压字）
    if (hasCaveat) {
      ctx.font = `500 11px ${FONT_STACK}`;
      const cw = ctx.measureText(text.caveat!).width;
      const cx = tx + labelCol + ctx.measureText(shownCost).width + 10;
      if (cx + cw <= rightLimit) {
        ctx.fillStyle = '#a8501f';
        ctx.fillText(text.caveat!, cx, costY);
      }
    }
  }
  /** 按可用宽度裁剪文本（超宽加省略号）——R3：杜绝任何文字溢出。 */
  private fitText(ctx: CanvasRenderingContext2D, s: string, maxWidth: number): string {
    if (maxWidth <= 0) return '';
    if (ctx.measureText(s).width <= maxWidth) return s;
    let out = s;
    while (out.length > 1 && ctx.measureText(out + '…').width > maxWidth) out = out.slice(0, -1);
    return out + '…';
  }

  /**
   * 满耐久时的**唯一**必要状态提示（R3：替代原先重复选项描述的 note 行）。
   * 选项自身的说明文字（note）已被删除——收益/代价已由图标与两行摘要表达。
   */
  private effectCaveat(eff: AdventureEffect | undefined, fullHp: boolean): string {
    if (!eff) return '';
    if (fullHp && (eff.kind === 'heal' || eff.kind === 'trade')) return '耐久已满，收益有限';
    return '';
  }

  /** 事件效果 → 收益摘要（R3：只给短句核心收益，状态提示移入 caveat）。 */
  private effectGain(eff: AdventureEffect | undefined): string {
    if (!eff) return '推进剧情';
    switch (eff.kind) {
      case 'heal':
        return '恢复耐久';
      case 'damage':
        return '—';
      case 'buff':
        return '获得临时强化';
      case 'trade':
        return '获得临时强化';
      case 'none':
        return '推进剧情';
      default:
        return '推进剧情';
    }
  }

  /** 事件效果 → 代价摘要。 */
  private effectCost(eff: AdventureEffect | undefined): string {
    if (!eff) return '—';
    switch (eff.kind) {
      case 'heal':
        return '—';
      case 'damage':
        return '损失耐久';
      case 'buff':
        return '—';
      case 'trade':
        return '消耗耐久';
      case 'none':
        return '—';
      default:
        return '—';
    }
  }

  /** 过程式事件图标（5 种形状，零第三方素材）。 */
  private drawEventIcon(ctx: CanvasRenderingContext2D, kind: AdventureEventKind, cx: number, cy: number, s: number, color: string): void {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    if (kind === 'crate') {
      const w = s * 0.9, h = s * 0.66, x = cx - w / 2, y = cy - h / 2;
      ctx.strokeRect(x, y, w, h);
      ctx.beginPath();
      ctx.moveTo(x, y + h * 0.36); ctx.lineTo(x + w, y + h * 0.36);
      ctx.moveTo(x + w * 0.32, y); ctx.lineTo(x + w * 0.32, y + h);
      ctx.moveTo(x + w * 0.68, y); ctx.lineTo(x + w * 0.68, y + h);
      ctx.stroke();
      ctx.fillRect(cx - 4, y + h * 0.36 - 4, 8, 8);
    } else if (kind === 'wreck') {
      const w = s * 1.05, h = s * 0.5, x = cx - w / 2, y = cy - h / 2 + 4;
      ctx.beginPath();
      ctx.moveTo(x, y + h * 0.6);
      ctx.lineTo(x + w * 0.12, y + h * 0.12);
      ctx.lineTo(x + w * 0.4, y);
      ctx.lineTo(x + w * 0.72, y);
      ctx.lineTo(x + w * 0.9, y + h * 0.2);
      ctx.lineTo(x + w, y + h * 0.6);
      ctx.lineTo(x + w, y + h * 0.92);
      ctx.lineTo(x, y + h * 0.92);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath(); ctx.arc(x + w * 0.26, y + h * 0.92, h * 0.24, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x + w * 0.74, y + h * 0.92, h * 0.24, 0, Math.PI * 2); ctx.fill();
    } else if (kind === 'rest') {
      const w = s * 1.0, h = s * 0.82, x = cx - w / 2, y = cy - h / 2 + 6;
      ctx.beginPath();
      ctx.moveTo(cx, y);
      ctx.lineTo(x, y + h);
      ctx.lineTo(x + w, y + h);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx, y + h * 0.34);
      ctx.lineTo(cx - w * 0.2, y + h);
      ctx.lineTo(cx + w * 0.2, y + h);
      ctx.closePath();
      ctx.stroke();
    } else if (kind === 'convoy') {
      // 商队：两辆小车 + 火堆
      const w = s * 0.8, h = s * 0.4, x = cx - w / 2, y = cy - h / 2 + 6;
      ctx.strokeRect(x, y, w, h);
      ctx.beginPath(); ctx.arc(x + w * 0.22, y + h, h * 0.28, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(x + w * 0.78, y + h, h * 0.28, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx, y - h * 0.9); ctx.lineTo(cx - 5, y - h * 0.2); ctx.lineTo(cx + 5, y - h * 0.2);
      ctx.closePath(); ctx.fill();
    } else {
      // altar：祭坛 + 发光核芯
      const w = s * 0.9, h = s * 0.6, x = cx - w / 2, y = cy - h / 2 + 6;
      ctx.beginPath();
      ctx.moveTo(x, y + h); ctx.lineTo(x + w * 0.18, y); ctx.lineTo(x + w * 0.82, y);
      ctx.lineTo(x + w, y + h); ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx, y - h * 0.7); ctx.lineTo(cx + h * 0.34, y); ctx.lineTo(cx, y + h * 0.34);
      ctx.lineTo(cx - h * 0.34, y); ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /* ----------------------------------------------------------- 探针 */

  /** 只读诊断（E2E / 调试；不参与任何玩法规则）。 */
  probe(): unknown {
    return {
      phase: this.state.phase,
      day: this.state.day,
      dayTotal: this.state.dayTotal,
      buffs: [...this.state.buffs],
      carriedHp: advCarriedPlayerHp(this.state, this.ctx2),
      playerHpMax: this.ctx2.playerHpMax,
      /**
       * F2：顶栏耐久条的**实际显示值**（`advTopDurability` 的返回值）。
       * `source` 说明本帧读的是实时战斗 HP 还是已结算 carriedHp。
       */
      topHp: advTopDurability(this.state, this.ctx2, this.liveBattleHp()),
      /** F2：正式战斗运行时的真实 HP（`RunBattleRuntime.hp()`；无战斗实例时 null）。 */
      battleHp: this.battle ? this.battle.hp() : null,
      /**
       * F3：强化获得的**即时反馈**（瞬态；当前没有则 null）。
       * `remainingMs` 供 E2E 判断「还在显示中」，不是新的隐藏状态。
       */
      buildToast: this.buildToast
        ? {
            id: this.buildToast.id,
            label: this.buildToast.label,
            gain: this.buildToast.gain,
            extra: this.buildToast.extra,
            remainingMs: Math.max(0, ADV_BUILD_TOAST_MS - (performance.now() - this.buildToast.bornAt)),
          }
        : null,
      /**
       * F3：本场战斗观测到的**玩家弹丸峰值**（只读统计，兑现证据）。
       * `maxPlayerSeen` = 一次攻击里同时活着的玩家炮弹数峰值（双联 2 / 三连 3）；
       * `maxPlayerRadiusSeen` = 玩家炮弹半径峰值（基础 10 / 重型弹头 16）。
       */
      battleProjectiles: this.battle
        ? {
            maxPlayerSeen: this.maxPlayerProjectiles,
            maxPlayerRadiusSeen: this.maxPlayerRadius,
            playerNow: this.battle.playerProjectileCount(),
          }
        : null,
      /** F3：**上一场**战斗的弹丸峰值（终态后战斗实例已 dispose，用它做事后对账）。 */
      lastBattleShells: this.lastBattleShells,
      battlesCompleted: this.state.battlesCompleted,
      battlesWon: this.state.battlesWon,
      seed: this.script.seed,
      seedLabel: this.script.seedLabel,
      eventPlan: this.script.eventPlan,
      bannerPlan: this.script.bannerPlan,
      battlePlan: this.script.battlePlan,
      loadoutSource: this.loadoutSource,
      vehicleLabel: this.ctx2.vehicleLabel,
      overlayOpen: advOverlayOpen(this.state),
      /**
       * R1｜连续性诊断（只读）：此刻是否需要玩家动手、本阶段是否会自动承接、
       * 自动承接剩余比例，以及本局已自动承接次数。
       * E2E 用它区分「主操作」与「自动推进」：`needsPlayer=false` 时不得存在可点主按钮。
       */
      continuity: {
        /**
         * R2｜「统一真实舞台」是否真的生效（只读）：
         *   sceneBackdrop = 战斗视图是否已注入 P0 场景底图（false ⇒ 仍在用程序化竞技场）
         *   sceneReady    = battle_bg 素材是否已加载
         */
        sceneBackdrop: this.battleView.hasSceneBackdrop(),
        sceneReady: this.ui.ready('battle_bg'),
        needsPlayer: advNeedsPlayer(this.state),
        autoPhase: this.autoAdvanceDelayMs() > 0,
        autoRemaining: this.autoRemainingFraction(),
        autoAdvances: this.autoAdvances,
        phaseElapsedMs: Math.round(performance.now() - this.phaseEnteredAt),
        stageBand: { x: STAGE_BAND.x, y: STAGE_BAND.y, w: STAGE_BAND.w, h: STAGE_BAND.h },
        narrativeBand: { x: NARRATIVE_BAND.x, y: NARRATIVE_BAND.y, w: NARRATIVE_BAND.w, h: NARRATIVE_BAND.h },
        actionBand: { x: ACTION_BAND.x, y: ACTION_BAND.y, w: ACTION_BAND.w, h: ACTION_BAND.h },
        /** 本帧主操作按钮是否**真的可点**（纯信息阶段恒为 false）。 */
        actionClickable: advNeedsPlayer(this.state) && advActionEnabled(this.state),
        /** 本帧主操作按钮的绘制矩形（不可点时仍给出矩形，供测试断言「没画」）。 */
        actionRect: this.state.phase === 'COMPLETE' || this.state.phase === 'FAILED' ? TERMINAL_CTA : ACTION_BTN,
        /** 选项卡片矩形（决策阶段与 `uxOptionRects` 同源）。 */
        optionRects: uxOptionRects(advOverlayCards(this.state, this.script, this.ctx2).length),
        narrativeLines: advNarrativeLines(this.state, UX_NARRATIVE_MAX_LINES).map((e) => e.text),
      },
      /** F1：战斗画面比例读数（只读；无战斗实例时为 null）。 */
      battleFrame: this.battleFrameProbe(),
      /** R1：真实 UI 素材加载状态（验收 3「素材正常加载、无缺失」的直接读数）。 */
      ui: this.ui.stats(),
      archive: { best: this.archive.best, totals: this.archive.totals, runs: this.archive.runs.length },
    };
  }

  /**
   * FRUITS-ADVENTURE-BATTLE-VIEW-F1｜战斗画面的**比例读数**（只读探针，不参与任何玩法/渲染决策）。
   *
   * 直接读真实链路的三段数字：
   *   `safe`   = `RunBattleView` 的安全区（= 竖屏冒险舞台带 390×648）；
   *   `scaleX/scaleY` = 合成本次真实使用的两轴缩放系数（**必须相等**，否则就是单轴拉伸）；
   *   `vehicleA` = 玩家车外廓「世界尺寸 → 屏幕像素尺寸」的宽高比对照（**必须相等**）；
   *     `worldAspect` 与 `pxAspect` 相等 ⇒ 车辆/轮胎/角色比例未被破坏。
   */
  battleFrameProbe(): {
    readonly phase: string;
    readonly band: { readonly w: number; readonly h: number };
    readonly safe: { readonly w: number; readonly h: number };
    readonly viewport: { readonly w: number; readonly h: number };
    readonly scaleX: number;
    readonly scaleY: number;
    readonly uniform: boolean;
    readonly cameraScale: number;
    /** 本次战斗合成实际使用的放大倍数（F6：距离约束目标经时间平滑后的**本帧实际值**；RESULT = 沿用的末帧值）。 */
    readonly compositeZoom: number;
    /** F6：距离约束**目标**倍数（未平滑）。`compositeZoom ≈ targetZoom` 说明镜头已跟上；偏差 = 平滑滞后。 */
    readonly targetZoom: number;
    /** F4：当前镜头模式（fixed=D2 固定 / off=原取景 / adaptive=F4 采纳）。 */
    readonly cameraMode: 'fixed' | 'off' | 'adaptive';
    readonly vehicleA: {
      readonly worldW: number;
      readonly worldH: number;
      readonly worldAspect: number;
      readonly pxW: number;
      readonly pxH: number;
      readonly pxAspect: number;
    } | null;
    readonly vehicleB: {
      readonly worldW: number;
      readonly worldH: number;
      readonly worldAspect: number;
      readonly pxW: number;
      readonly pxH: number;
      readonly pxAspect: number;
    } | null;
    /** F4：关键主体（双车并集 + padding）在安全区的矩形（安全区坐标）。 */
    readonly subjectSafe: { readonly x: number; readonly y: number; readonly w: number; readonly h: number } | null;
    /** F4：玩家车「未外扩」安全区矩形（验收②「关键主体不被裁切」的精确判定用）。 */
    readonly vehicleASafe: { readonly x: number; readonly y: number; readonly w: number; readonly h: number } | null;
    /** F4：敌车「未外扩」安全区矩形。 */
    readonly vehicleBSafe: { readonly x: number; readonly y: number; readonly w: number; readonly h: number } | null;
    /** F4：实际裁切矩形（安全区坐标）；恒包含双车（验收②）。 */
    readonly cropSafe: { readonly x: number; readonly y: number; readonly w: number; readonly h: number } | null;
    /** F4：双车世界中心间距（用于验证「距离约束」生效）。 */
    readonly gapWorld: number | null;
  } | null {
    const rt = this.battle;
    if (!rt) return null;
    // R1：舞台高度恒定 ⇒ 战斗与 RESULT 用**同一个** band（不再 RESULT 时换成更矮的带）。
    const band = STAGE_BAND;
    const isBattle = this.state.phase !== 'RESULT';
    const comp = this.battleView.compositeProbe(band, isBattle ? 'contain' : 'cover');
    const cam = this.battleView.viewTransform();
    // F4/F6 镜头模式解析（战斗态取景可被裁切；RESULT 沿用最后一次战斗取景，不再缩回原比例）。
    const mode: 'fixed' | 'off' | 'adaptive' =
      D2_FIXED ? 'fixed' : ADV_CAMERA_OFF ? 'off' : 'adaptive';
    // F6：读数一律取**本帧真正用于合成的那份解算结果**（不再是「重新算一遍目标」），
    //     这样 E2E 看到的 zoom / 裁切与画面上贴的像素严格自洽。
    const camFrame = mode === 'adaptive'
      ? isBattle
        ? this.battleView.adventureCameraFrame()
        : this.battleView.adventureCameraHold()
      : null;
    const compositeZoom = isBattle
      ? mode === 'fixed'
        ? D2_EXPERIMENT_ZOOM
        : mode === 'off'
          ? 1
          : camFrame
            ? camFrame.zoom
            : 1
      : mode === 'adaptive' && camFrame
        ? camFrame.zoom
        : 1;
    const targetZoom = isBattle && mode === 'adaptive'
      ? this.battleView.advCompositeZoom(rt, ADV_CAMERA_MAX)
      : compositeZoom;
    const safe = comp.safe;
    // 关键主体（双车并集 + padding）在所有战斗模式下一律取真实几何，
    // 这样 cropSafe 才能如实反映「该模式下真实裁切是否裁掉主体」（fixed 模式在远距分离时会暴露）。
    let subjectSafe: { x: number; y: number; w: number; h: number } | null = null;
    let cropSafe: { x: number; y: number; w: number; h: number } | null = null;
    if (isBattle) {
      const realSubj = this.battleView.subjectSafeRect(rt);
      subjectSafe = realSubj ? { x: realSubj.x, y: realSubj.y, w: realSubj.w, h: realSubj.h } : null;
      if (mode === 'adaptive' && camFrame) {
        cropSafe = { x: camFrame.cropSafe.x, y: camFrame.cropSafe.y, w: camFrame.cropSafe.w, h: camFrame.cropSafe.h };
      } else if (mode === 'fixed') {
        const z = D2_EXPERIMENT_ZOOM;
        const sw = safe.w / z, sh = safe.h / z;
        cropSafe = { x: (safe.w - sw) / 2, y: safe.h - sh, w: sw, h: sh };
      } else {
        cropSafe = { x: 0, y: 0, w: safe.w, h: safe.h };
      }
    }
    const mkVehicle = (team: 'A' | 'B') => {
      const b = rt.vehicleBox(team);
      const wW = b.maxX - b.minX, wH = b.maxY - b.minY;
      if (wW <= 0 || wH <= 0) return null;
      const pW = wW * cam.scale * comp.scaleX * compositeZoom;
      const pH = wH * cam.scale * comp.scaleY * compositeZoom;
      return { worldW: wW, worldH: wH, worldAspect: wW / wH, pxW: pW, pxH: pH, pxAspect: pW / pH };
    };
    // F4：双车「未外扩」安全区矩形 + 双车世界中心间距（所有战斗模式都算，供验收②精确判定）。
    const toSafeBox = (b: { minX: number; minY: number; maxX: number; maxY: number }) => {
      const x1 = b.minX * cam.scale + cam.offsetX - cam.cropX;
      const y1 = b.minY * cam.scale + cam.offsetY - cam.cropY;
      const x2 = b.maxX * cam.scale + cam.offsetX - cam.cropX;
      const y2 = b.maxY * cam.scale + cam.offsetY - cam.cropY;
      return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
    };
    const aBox = rt.vehicleBox('A');
    const bBox = rt.vehicleBox('B');
    const vehicleASafe = isBattle ? toSafeBox(aBox) : null;
    const vehicleBSafe = isBattle ? toSafeBox(bBox) : null;
    const gapWorld = isBattle
      ? Math.hypot((bBox.minX + bBox.maxX) / 2 - (aBox.minX + aBox.maxX) / 2, (bBox.minY + bBox.maxY) / 2 - (aBox.minY + aBox.maxY) / 2)
      : null;
    return {
      phase: this.state.phase,
      band: comp.band,
      safe: comp.safe,
      viewport: this.battleView.viewportSize(),
      scaleX: comp.scaleX,
      scaleY: comp.scaleY,
      uniform: Math.abs(comp.scaleX - comp.scaleY) <= 1e-6,
      cameraScale: cam.scale,
      compositeZoom,
      targetZoom,
      cameraMode: mode,
      vehicleA: mkVehicle('A'),
      vehicleB: mkVehicle('B'),
      vehicleASafe,
      vehicleBSafe,
      subjectSafe,
      cropSafe,
      gapWorld,
    };
  }

  /**
   * 调试自动步进（仅供 E2E / 真机计时用；不参与任何玩法规则）：
   *   - 浮层打开 → 选第一张卡（等价真实点击首张卡）；
   *   - 纯信息阶段（EVENT / RESULT / EVENT_DONE）→ 立即执行一次自动承接
   *     （等价「等它自己走完」；真实 UI 靠定时器，这里只是不等待）；
   *   - 主动作可用 → 按一次主动作（等价真实点击主按钮）；
   *   - BATTLE → 不操作（真实物理战斗由 requestAnimationFrame 自动推进）。
   * 返回当前 phase，便于调用方记录耗时。
   */
  debugStep(): string {
    // R4：终态调试步进 = 新一局（新随机种子），与 UI 按钮同语义。
    if (this.state.phase === 'COMPLETE' || this.state.phase === 'FAILED') {
      this.startNewRun();
      return this.state.phase;
    }
    if (advOverlayOpen(this.state)) {
      const cards = advOverlayCards(this.state, this.script, this.ctx2);
      if (cards.length > 0) {
        this.apply(chooseAdventureOption(this.state, cards[0].id, this.ctx2, this.script));
        return this.state.phase;
      }
    }
    if (!advNeedsPlayer(this.state)) {
      // R1：纯信息阶段没有主操作可点 —— 直接跳到「它自己会走到的位置」。
      const next = advAutoAdvance(this.state, this.ctx2, this.script);
      if (next !== this.state) this.apply(next);
      return this.state.phase;
    }
    if (advActionEnabled(this.state)) {
      this.cancelAutoAdvance();
      this.apply(pressAdventureAction(this.state, this.ctx2, this.script));
    }
    return this.state.phase;
  }

  /** 选第 i 张浮层卡（等价真实点击该卡）；无浮层时退化为主动作。仅供 E2E / 智能驱动用。 */
  debugStepOption(i: number): string {
    // R4：终态调试步进 = 新一局（新随机种子），与 UI 按钮同语义。
    if (this.state.phase === 'COMPLETE' || this.state.phase === 'FAILED') {
      this.startNewRun();
      return this.state.phase;
    }
    if (advOverlayOpen(this.state)) {
      const cards = advOverlayCards(this.state, this.script, this.ctx2);
      if (i >= 0 && i < cards.length) {
        this.apply(chooseAdventureOption(this.state, cards[i].id, this.ctx2, this.script));
        return this.state.phase;
      }
    }
    if (!advNeedsPlayer(this.state)) {
      const next = advAutoAdvance(this.state, this.ctx2, this.script);
      if (next !== this.state) this.apply(next);
      return this.state.phase;
    }
    if (advActionEnabled(this.state)) {
      this.cancelAutoAdvance();
      this.apply(pressAdventureAction(this.state, this.ctx2, this.script));
    }
    return this.state.phase;
  }

  /**
   * 只读诊断：当前浮层各选项的因果种类（event/buff/build/none），供智能驱动择优。
   *  buff/trade 额外暴露 candidates（领取时按序取第一个未拥有项）：
   *  驱动可据此识别「领不到新强化」的 trade（避免无谓损耗）与可用候选。
   */
  diagnose(): unknown {
    const node = advCurrentNode(this.state, this.script);
    // R2：把**绘制时真正使用的文本**一并报出（label / 收益 / 代价）。
    // 这样「文字是否被截断」可以被真实测量（页面内 measureText + 同一字体栈），
    // 而不是靠几何推断 —— 验收 2 明确要求「不能只依靠几何审计判定通过」。
    const fullHp = advCarriedPlayerHp(this.state, this.ctx2) >= this.ctx2.playerHpMax;
    if (advEventChoiceOpen(this.state) && node.kind === 'EVENT') {
      return {
        kind: 'event',
        title: node.title,
        options: node.options.map((o) => {
          const eff = node.outcomes[o.id];
          const candidates = eff && (eff.kind === 'buff' || eff.kind === 'trade') ? [...eff.candidates] : null;
          const fresh = candidates ? candidates.filter((id) => !this.state.buffs.includes(id)) : null;
          return {
            id: o.id,
            effect: eff?.kind ?? 'none',
            candidates,
            freshCount: fresh ? fresh.length : null,
            /** 卡面标签（= advOverlayCards 的 label，绘制直接用这个） */
            label: o.label,
            /** 卡面「收益」行（绘制直接调 effectGain） */
            gain: this.effectGain(eff),
            /** 卡面「代价」行 */
            cost: this.effectCost(eff),
            /** 满耐久等特例提示 */
            caveat: this.effectCaveat(eff, fullHp),
          };
        }),
      };
    }
    if (advChoiceOpen(this.state) && node.kind === 'BUILD') {
      return {
        kind: 'build',
        title: '选择一项改装',
        options: advOverlayCards(this.state, this.script, this.ctx2).map((c) => ({
          id: c.id,
          effect: 'build',
          label: c.label,
          gain: c.note,
          cost: '—',
        })),
      };
    }
    return { kind: 'none', options: [] };
  }
}
