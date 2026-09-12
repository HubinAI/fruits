/**
 * PRP-F0-RUN-PAGE-SHELL｜PRP-R3-CAPYBARA-UI-HIERARCHY-REBUILD
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
 * PRP-R3 信息层级重构（本文件是落点）：
 *   1) 顶部减法：只留「DAY 进度一行 + 实际已获得的强化图标一行」，
 *      **删除**「核心构建 X/5」与 5 个固定空槽（结构性：`runBuffIconRects(0)` 为空数组）；
 *   2) 战斗主体：车辆改用**正式 sprite**（`runVehicleAssets`）+ 正式 `visualWorldTransform`；
 *      舞台重新构图（天空 / 远山 / 路面），车辆明显放大且视觉重心偏下；
 *   3) 冒险记录：自然语言叙事、15px 可读字号、底部对齐、最近事件突出 / 旧事件弱化；
 *   4) CHOICE：卡片 = 矢量图标 + 名称 + 一句结果，整页重压暗 → 浮层成为唯一焦点。
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
  RUN_BATTLE_SCRIPT,
  RUN_CHOICE_OPTIONS,
  advanceRunBattle,
  chooseRunBuff,
  createRunPageState,
  durabilityPercent,
  formatRunLog,
  pressRunAction,
  runActionEnabled,
  runActionLabel,
  runChoiceOpen,
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
  iconHeavy: '#b8562e',
  iconExplosive: '#c07a2a',
  iconRepair: '#3f8f5a',
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
  buffIcon: COLORS.iconRepair,
  buffChip: COLORS.buffChip,
  cardBar: COLORS.cardBar,
  actionBar: COLORS.actionBtn,
};

/** CHOICE 遮罩：整页重压暗（画布内合成 → 可被真实 getImageData 验证「变暗」）。 */
const CHOICE_MASK_COLOR = 'rgba(6,9,14,0.86)';

/** 每个强化选项的图标绘制色（矢量字形，非纯色块；不入面积账本）。 */
const CHOICE_ICON_COLOR: Readonly<Record<string, string>> = {
  heavyWarhead: '#ffb066',
  explosiveShell: '#ffd166',
  emergencyRepair: '#7fd6a0',
};

/** 顶部已获得图标的底色（按选项区分；芯片色统一 → `buffChip` 层可冻结）。 */
const BUFF_ICON_COLOR: Readonly<Record<string, string>> = {
  heavyWarhead: COLORS.iconHeavy,
  explosiveShell: COLORS.iconExplosive,
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
  readonly choiceOptions: readonly { id: string; label: string; note: string; rect: RunRect }[];
  readonly bands: {
    top: RunRect;
    stage: RunRect;
    log: RunRect;
    action: RunRect;
  };
  readonly battle: {
    steps: number;
    totalSteps: number;
    playerHp: number;
    playerHpMax: number;
    enemyHp: number;
    enemyHpMax: number;
    done: boolean;
    durabilityPercent: number;
  } | null;
  readonly stage: {
    scale: number;
    groundY: number;
    ground: RunRect;
    road: RunRect;
    player: RunProbeEntity;
    enemy: RunProbeEntity | null;
    enemyGone: boolean;
    /** 玩家是否在敌人**左侧**（无敌人时为 null）—— 验收「玩家左 / 敌人右」。 */
    playerLeftOfEnemy: boolean | null;
    /** 两侧最小水平间距（>0 = 完全分离，无重叠）。 */
    minGapPx: number | null;
  };
  /** 真实车辆 sprite 的加载状态（未就绪时降级为纯色几何，绝不伪装成已用真实视觉）。 */
  readonly assets: RunAssetStats;
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
  private readonly assets = new RunVisualStore();

  /** 固定摄像机：竖屏 390×844 逻辑舞台（复用共享 contain 变换契约）。 */
  private readonly vp = new PlayerViewportTransform(PORTRAIT_LOGICAL_W, PORTRAIT_LOGICAL_H);
  private state: RunPageState = createRunPageState(runPageContext());
  private rafHandle = 0;
  private lastFrameMs = 0;
  /** BATTLE 脚本的时间累加器（真实时间 → 固定步数，确定性推进）。 */
  private battleAccMs = 0;
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
    if (next.phase === 'BATTLE') {
      this.battleAccMs = 0;
      this.startLoop();
    } else {
      this.stopLoop();
    }
    this.render();
  }

  private startLoop(): void {
    if (this.rafHandle !== 0) return;
    this.lastFrameMs = performance.now();
    const tick = (now: number): void => {
      const dt = Math.min(64, now - this.lastFrameMs);
      this.lastFrameMs = now;
      if (this.state.phase !== 'BATTLE') {
        this.rafHandle = 0;
        return;
      }
      const perStepMs = RUN_BATTLE_SCRIPT.durationMs / RUN_BATTLE_SCRIPT.totalSteps;
      this.battleAccMs += dt;
      const steps = Math.floor(this.battleAccMs / perStepMs);
      if (steps > 0) {
        this.battleAccMs -= steps * perStepMs;
        this.apply(advanceRunBattle(this.state, steps));
        if (this.state.phase !== 'BATTLE') {
          this.rafHandle = 0;
          return;
        }
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

  private stageView(): RunStageView {
    return buildRunStageView(this.state.phase, this.state.battle);
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

    // 2) 中部舞台：天空 / 远山 / 路面 / 地线 / 两车（真实 sprite）
    const view = this.stageView();
    this.drawBackdrop(ctx, view);
    this.drawEntity(ctx, view.player);
    if (view.enemy) this.drawEntity(ctx, view.enemy);

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
      ctx.fillStyle = BUFF_ICON_COLOR[buff.id] ?? COLORS.iconRepair;
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

  /** 每个选项一个可辨识的矢量图标（弹头 / 爆裂 / 维修十字），不承载文字。 */
  private drawChoiceIcon(ctx: CanvasRenderingContext2D, id: string, r: RunRect): void {
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const s = r.w;
    ctx.fillStyle = CHOICE_ICON_COLOR[id] ?? COLORS.textBody;
    if (id === 'heavyWarhead') {
      // 弹头：矩形弹体 + 尖头
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.42, cy - s * 0.16);
      ctx.lineTo(cx + s * 0.12, cy - s * 0.16);
      ctx.lineTo(cx + s * 0.42, cy);
      ctx.lineTo(cx + s * 0.12, cy + s * 0.16);
      ctx.lineTo(cx - s * 0.42, cy + s * 0.16);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(cx - s * 0.48, cy - s * 0.06, s * 0.08, s * 0.12);
    } else if (id === 'explosiveShell') {
      // 爆裂：八芒星
      const spikes = 8;
      ctx.beginPath();
      for (let k = 0; k < spikes * 2; k++) {
        const ang = (k / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
        const rad = k % 2 === 0 ? s * 0.46 : s * 0.2;
        const px = cx + Math.cos(ang) * rad;
        const py = cy + Math.sin(ang) * rad;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    } else {
      // 维修：粗十字
      const arm = s * 0.16;
      const len = s * 0.44;
      ctx.fillRect(cx - arm, cy - len, arm * 2, len * 2);
      ctx.fillRect(cx - len, cy - arm, len * 2, arm * 2);
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
    const playerLeftOfEnemy = view.enemy
      ? view.player.bounds.x + view.player.bounds.w <= view.enemy.bounds.x
      : null;
    const minGapPx = view.enemy ? view.enemy.bounds.x - (view.player.bounds.x + view.player.bounds.w) : null;

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

    return {
      logicalW: PORTRAIT_LOGICAL_W,
      logicalH: PORTRAIT_LOGICAL_H,
      phase: s.phase,
      phaseTrail: s.phaseTrail,
      transitions: s.transitions,
      actionCount: s.actionCount,
      day: s.day,
      dayTotal: s.dayTotal,
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
            totalSteps: s.battle.totalSteps,
            playerHp: s.battle.playerHp,
            playerHpMax: s.battle.playerHpMax,
            enemyHp: s.battle.enemyHp,
            enemyHpMax: s.battle.enemyHpMax,
            done: s.battle.done,
            durabilityPercent: durabilityPercent(s.battle),
          }
        : null,
      stage: {
        scale: view.scale,
        groundY: view.groundY,
        ground: copyRect(view.ground),
        road: copyRect(view.road),
        player: entityProbe(view.player),
        enemy: view.enemy ? entityProbe(view.enemy) : null,
        enemyGone: view.enemyGone,
        playerLeftOfEnemy,
        minGapPx,
      },
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
