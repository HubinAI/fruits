/**
 * PRP-F0-RUN-PAGE-SHELL｜Portrait Run Prototype —— Run Page 控制器
 *（本原型**唯一**的 DOM / Canvas / 输入层）。
 *
 * 页面契约（与产品基线一一对应）：
 *   - 单一 Run Page：全部内容画在**一张 canvas** 上（顶部薄层 / 中部舞台 / 下部日志 / 最底动作），
 *     五个状态只是同一页面的不同绘制结果，**任何时刻都不发生页面跳转**；
 *   - 竖屏逻辑基准 390×844，屏幕映射复用正式共享契约 `PlayerViewportTransform(390, 844)`
 *     （contain 缩放居中），不引入第二套坐标系统、不做动态 reframe；
 *   - 命中区与绘制矩形**同源**：两者都取自 `runPageLayout`（不存在「画的是一处、点的是另一处」）；
 *   - 最底只有**一个**主动作按钮；BATTLE 期间按钮进入「战斗中」且不可误触推进；
 *   - CHOICE 期间原页面**位置不变**、整体变暗（画布内遮罩），中央出现三选一浮层。
 *
 * Debug 与玩家界面分离（Queue 必改 4）：
 *   本页面**只有** #run-root / .run-stage / #run-canvas 三层壳，不含任何
 *   Arena / Loadout / Encounter / Start / Reset / Gate 之类的开发控制；
 *   开发控制全部留在独立入口 `portrait-lab.html`（Debug control area），
 *   不占玩家主页面布局空间，也不会在默认打开 Run Page 时出现。
 *
 * 删除本文件即移除 Run Page 核心；本目录可整块删除（清单见 constants.ts 头部）。
 */

import { PlayerViewportTransform } from '../../platform/playerViewport';
import { PORTRAIT_LOGICAL_H, PORTRAIT_LOGICAL_W } from './constants';
import {
  RUN_ACTION_BAND,
  RUN_BANDS,
  RUN_BUILD_ICON_SLOTS,
  RUN_LOG,
  RUN_LOG_LABEL_POS,
  RUN_LOG_BAND,
  RUN_PAGE_H,
  RUN_PAGE_W,
  RUN_STAGE_BAND,
  RUN_TOP_BAND,
  emptyRunLayerAreas,
  runActionBarRect,
  runActionButtonRect,
  runBuildIconChip,
  runBuildIconSlots,
  runChoiceBarRect,
  runChoiceCardRects,
  runChoiceChipRect,
  runChoiceMaskRect,
  runChoiceTitlePos,
  runDayNodes,
  runLogLineRects,
  runPaintedAreas,
  type RunLayerId,
  type RunLayeredRect,
  type RunRect,
} from './runPageLayout';
import {
  RUN_BATTLE_SCRIPT,
  RUN_CHOICE_OPTIONS,
  advanceRunBattle,
  chooseRunBuff,
  createRunPageState,
  formatRunLog,
  pressRunAction,
  runActionEnabled,
  runActionLabel,
  runChoiceOpen,
  visibleRunLog,
  type RunPageState,
  type RunPhase,
} from './runPageState';
import {
  buildRunStageView,
  runPageContext,
  runPageLayerShapes,
  type RunStageView,
} from './runPageScene';

const FONT_STACK = 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';

/**
 * Run Page 调色板。
 * ⚠️ 每一个「几何色」都与其它色在 RGB 上互斥：浏览器真机验证用**精确相等**匹配统计面积，
 * 因此任何像素级歧义都会立刻暴露（文字抗锯齿也不会落进这些色里 —— 文字色是中性灰蓝）。
 */
const COLORS = {
  pageBg: '#0b0e14',
  topBandBg: '#151c28',
  stageBg: '#0f141d',
  logBandBg: '#0d121a',
  actionBandBg: '#141a26',
  divider: '#25314a',
  ground: '#5a6f8a',
  playerBody: '#4a7fe0',
  playerPart: '#a06bff',
  enemyBody: '#ff6b5e',
  enemyPart: '#ff9b3d',
  nodeDone: '#d2922a',
  nodeTodo: '#3a465e',
  iconSlot: '#242e3e',
  iconOwned: '#2fbf6b',
  iconChip: '#d8f2a0',
  /** 主动作按钮填充 / 描边（**不入面积账本**：承载文案、被描边覆盖）。 */
  actionFill: '#28405f',
  actionFillOff: '#232b38',
  actionEdge: '#4f7099',
  /** 主动作按钮的纯色强调条（入账；可用态 / 禁用态各一色）。 */
  actionBtn: '#33507a',
  actionBtnOff: '#2a3341',
  /** CHOICE 卡片填充 / 描边（填充不入账），强调条与左侧色块入账。 */
  cardBg: '#1b2432',
  cardEdge: '#3d4c66',
  cardBar: '#5f86c4',
  cardChip: '#f0c14b',
  textTitle: '#e9eef7',
  textBody: '#c2cbdb',
  textDim: '#7d8798',
  warn: '#ff8a5e',
} as const;

/** CHOICE 遮罩：整页变暗（画布内合成 → 可被真实 getImageData 验证「变暗」）。 */
const CHOICE_MASK_COLOR = 'rgba(6,9,14,0.72)';

export interface RunPageScreenProbe {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly dpr: number;
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
  readonly logCount: number;
  readonly log: readonly { seq: number; kind: string; text: string }[];
  readonly actionLabel: string;
  readonly actionEnabled: boolean;
  readonly actionRect: RunRect;
  readonly choiceOpen: boolean;
  readonly choiceOptions: readonly { id: string; label: string; rect: RunRect }[];
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
  } | null;
  readonly stage: {
    scale: number;
    groundY: number;
    ground: RunRect;
    player: { body: RunRect[]; part: RunRect[]; bounds: RunRect };
    enemy: { body: RunRect[]; part: RunRect[]; bounds: RunRect } | null;
    enemyGone: boolean;
    /** 玩家是否在敌人**左侧**（无敌人时为 null）—— 验收「玩家左 / 敌人右」。 */
    playerLeftOfEnemy: boolean | null;
    /** 两侧最小水平间距（>0 = 完全分离，无重叠）。 */
    minGapPx: number | null;
  };
  readonly layers: Record<RunLayerId, number>;
  readonly screen: RunPageScreenProbe;
  /** 必改 4：玩家页面上的开发控制数量（恒为 0；Debug 控制只存在于独立入口）。 */
  readonly debugControls: number;
  /** DOM 里的可点击元素总数（Run Page 全部点击都发生在画布上）。 */
  readonly domButtons: number;
}

export class RunPage {
  private readonly root: HTMLElement;
  private readonly stageWrap: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;

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
      this.draw(ctx);
    }
  }

  private stageView(): RunStageView {
    return buildRunStageView(this.state.phase, this.state.battle);
  }

  /**
   * 本帧的「纯色几何层」。构造逻辑在 `runPageScene.runPageLayerShapes`（纯函数 →
   * node 侧可直接断言同一份账本，浏览器端再用真实 getImageData 交叉核对），
   * 本方法只负责把当前 state 与 stage view 喂进去。
   */
  private layeredShapes(): RunLayeredRect[] {
    return runPageLayerShapes(this.state, this.stageView());
  }

  private draw(ctx: CanvasRenderingContext2D): void {
    const s = this.state;

    // 1) 底色 + 四条横带（无缝无叠：y 由 runPageLayout 递推得到）
    ctx.fillStyle = COLORS.pageBg;
    ctx.fillRect(0, 0, RUN_PAGE_W, RUN_PAGE_H);
    ctx.fillStyle = COLORS.topBandBg;
    ctx.fillRect(RUN_TOP_BAND.x, RUN_TOP_BAND.y, RUN_TOP_BAND.w, RUN_TOP_BAND.h);
    ctx.fillStyle = COLORS.stageBg;
    ctx.fillRect(RUN_STAGE_BAND.x, RUN_STAGE_BAND.y, RUN_STAGE_BAND.w, RUN_STAGE_BAND.h);
    ctx.fillStyle = COLORS.logBandBg;
    ctx.fillRect(RUN_LOG_BAND.x, RUN_LOG_BAND.y, RUN_LOG_BAND.w, RUN_LOG_BAND.h);
    ctx.fillStyle = COLORS.actionBandBg;
    ctx.fillRect(RUN_ACTION_BAND.x, RUN_ACTION_BAND.y, RUN_ACTION_BAND.w, RUN_ACTION_BAND.h);

    // 分带线（1px，画在带边界上，不与任何几何矩形重叠）
    ctx.fillStyle = COLORS.divider;
    for (const band of RUN_BANDS.slice(1)) ctx.fillRect(band.x, band.y - 1, band.w, 1);

    // 2) 中部舞台：地线 + 两车（全部来自正式 collider 几何）
    const view = this.stageView();
    ctx.fillStyle = COLORS.ground;
    ctx.fillRect(view.ground.x, view.ground.y, view.ground.w, view.ground.h);
    this.drawEntity(ctx, view, 'player');
    if (view.enemy) this.drawEntity(ctx, view, 'enemy');

    // 3) 舞台文字（无几何矩形 → 不参与面积账本）
    ctx.textBaseline = 'alphabetic';
    if (view.battle) {
      ctx.fillStyle = COLORS.textTitle;
      ctx.font = `bold 15px ${FONT_STACK}`;
      ctx.textAlign = 'center';
      ctx.fillText('交战中', RUN_PAGE_W / 2, RUN_STAGE_BAND.y + 28);
      ctx.textAlign = 'left';
    } else if (view.enemyGone) {
      ctx.fillStyle = COLORS.textDim;
      ctx.font = `13px ${FONT_STACK}`;
      ctx.textAlign = 'center';
      ctx.fillText('敌方已被击破', RUN_PAGE_W / 2, view.groundY - 12);
      ctx.textAlign = 'left';
    } else if (s.phase === 'IDLE') {
      ctx.fillStyle = COLORS.textDim;
      ctx.font = `13px ${FONT_STACK}`;
      ctx.fillText('待机 · 等待前进指令', 16, RUN_STAGE_BAND.y + 26);
    }

    // 4) 顶部薄层：本局进度 + 当前核心 Build
    ctx.fillStyle = COLORS.textTitle;
    ctx.font = `bold 18px ${FONT_STACK}`;
    ctx.fillText(`DAY ${s.day} / ${s.dayTotal}`, 16, 30);
    const nodes = runDayNodes(s.dayTotal);
    nodes.forEach((r, i) => {
      ctx.fillStyle = i < s.day ? COLORS.nodeDone : COLORS.nodeTodo;
      ctx.fillRect(r.x, r.y, r.w, r.h);
    });
    const slots = runBuildIconSlots(RUN_BUILD_ICON_SLOTS);
    slots.forEach((slot, i) => {
      const owned = i < s.buffs.length;
      ctx.fillStyle = owned ? COLORS.iconOwned : COLORS.iconSlot;
      ctx.fillRect(slot.x, slot.y, slot.w, slot.h);
      if (owned) {
        const chip = runBuildIconChip(slot);
        ctx.fillStyle = COLORS.iconChip;
        ctx.fillRect(chip.x, chip.y, chip.w, chip.h);
      }
    });
    ctx.fillStyle = COLORS.textDim;
    ctx.font = `12px ${FONT_STACK}`;
    ctx.fillText(`核心构建 ${s.buffs.length} / ${RUN_BUILD_ICON_SLOTS}`, 200, 72);

    // 5) 下部日志（底部对齐：新行从下方顶入；只追加不清空）
    ctx.fillStyle = COLORS.textDim;
    ctx.font = `12px ${FONT_STACK}`;
    ctx.fillText('冒险日志', RUN_LOG_LABEL_POS.x, RUN_LOG_LABEL_POS.y);
    const lines = visibleRunLog(s, RUN_LOG.maxLines);
    const lineRects = runLogLineRects(RUN_LOG.maxLines);
    // 固定槽位自底部对齐 → 行位置不随内容条数抖动
    const offset = lineRects.length - lines.length;
    lines.forEach((e, i) => {
      const r = lineRects[i + offset];
      if (!r) return;
      ctx.fillStyle = COLORS.textBody;
      ctx.font = `${13}px ${FONT_STACK}`;
      ctx.fillText(this.ellipsize(ctx, formatRunLog(e), r.w), r.x, r.y + 15);
    });

  // 6) 最底：唯一主动作按钮（填充承载文案 → 不入面积账本；底部强调条入账）
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
  ctx.font = `bold 17px ${FONT_STACK}`;
  ctx.textAlign = 'center';
  ctx.fillText(runActionLabel(s), btn.x + btn.w / 2, btn.y + btn.h / 2 + 6);
  ctx.textAlign = 'left';

    // 7) CHOICE 浮层：整页变暗（位置不变）+ 中央三选一
    if (runChoiceOpen(s)) {
      const mask = runChoiceMaskRect();
      ctx.fillStyle = CHOICE_MASK_COLOR;
      ctx.fillRect(mask.x, mask.y, mask.w, mask.h);

      const cards = runChoiceCardRects(RUN_CHOICE_OPTIONS.length);
      const title = runChoiceTitlePos(RUN_CHOICE_OPTIONS.length);
      ctx.fillStyle = COLORS.textTitle;
      ctx.font = `bold 16px ${FONT_STACK}`;
      ctx.fillText('获得改装机会 · 三选一', title.x, title.y);

      cards.forEach((card, i) => {
        const opt = RUN_CHOICE_OPTIONS[i];
        ctx.fillStyle = COLORS.cardBg;
        ctx.fillRect(card.x, card.y, card.w, card.h);
        ctx.strokeStyle = COLORS.cardEdge;
        ctx.lineWidth = 2;
        ctx.strokeRect(card.x + 1, card.y + 1, card.w - 2, card.h - 2);
        // 顶部强调条（纯色、无文字、不被描边覆盖 → 入面积账本）
        const bar = runChoiceBarRect(card);
        ctx.fillStyle = COLORS.cardBar;
        ctx.fillRect(bar.x, bar.y, bar.w, bar.h);
        const chip = runChoiceChipRect(card);
        ctx.fillStyle = COLORS.cardChip;
        ctx.fillRect(chip.x, chip.y, chip.w, chip.h);
        ctx.fillStyle = COLORS.textTitle;
        ctx.font = `bold 16px ${FONT_STACK}`;
        ctx.fillText(opt.label, chip.x + chip.w + 12, card.y + 32);
        ctx.fillStyle = COLORS.textDim;
        ctx.font = `12px ${FONT_STACK}`;
        ctx.fillText(opt.note, chip.x + chip.w + 12, card.y + 54);
      });
    }
  }

  private drawEntity(ctx: CanvasRenderingContext2D, view: RunStageView, which: 'player' | 'enemy'): void {
    const e = which === 'player' ? view.player : view.enemy;
    if (!e) return;
    const bodyColor = which === 'player' ? COLORS.playerBody : COLORS.enemyBody;
    const partColor = which === 'player' ? COLORS.playerPart : COLORS.enemyPart;
    ctx.fillStyle = bodyColor;
    for (const r of e.body) ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = partColor;
    for (const r of e.part) ctx.fillRect(r.x, r.y, r.w, r.h);
  }

  /** 文本裁切：超宽用省略号（避免日志越界压到动作按钮）。 */
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
      logCount: s.log.length,
      log: s.log.map((e) => ({ seq: e.seq, kind: e.kind, text: e.text })),
      actionLabel: runActionLabel(s),
      actionEnabled: runActionEnabled(s),
      actionRect: runActionButtonRect(),
      choiceOpen: runChoiceOpen(s),
      choiceOptions: RUN_CHOICE_OPTIONS.map((o, i) => ({
        id: o.id,
        label: o.label,
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
          }
        : null,
      stage: {
        scale: view.scale,
        groundY: view.groundY,
        ground: view.ground,
        player: {
          body: view.player.body.map(copyRect),
          part: view.player.part.map(copyRect),
          bounds: copyRect(view.player.bounds),
        },
        enemy: view.enemy
          ? {
              body: view.enemy.body.map(copyRect),
              part: view.enemy.part.map(copyRect),
              bounds: copyRect(view.enemy.bounds),
            }
          : null,
        enemyGone: view.enemyGone,
        playerLeftOfEnemy,
        minGapPx,
      },
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
