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
import { runBuildOptionById } from '../runModifiers';
import {
  generateAdventureScript,
  randomSeedLabel,
  type AdventureEffect,
  type AdventureEventKind,
  type AdventureEventNode,
  type AdventureScript,
} from './advScript';
import {
  advActionEnabled,
  advActionLabel,
  advCarriedPlayerHp,
  advChoiceOpen,
  advContextFromLoadout,
  advCurrentNode,
  advEventChoiceOpen,
  advOverlayCards,
  advOverlayOpen,
  chooseAdventureOption,
  createAdventureState,
  finishAdventureBattle,
  pressAdventureAction,
  syncAdventureBattle,
  type AdventureContext,
  type AdventureState,
} from './advState';
import { readArchive, recordRun, nextRunGoal, type AdvArchive, type AdvRunSummary } from './advArchive';
import { AdvUiStore, type AdvUiId } from './advUiAssets';

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

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

// R2：舞台下探吃掉原「常驻日志带」，放大真实战斗主体，去除长日志拥挤。
const STAGE_BAND: Rect = { x: 0, y: 96, w: PORTRAIT_LOGICAL_W, h: 648 };
const ACTION_BAND: Rect = { x: 0, y: 744, w: PORTRAIT_LOGICAL_W, h: 100 };
const ACTION_BTN: Rect = { x: 40, y: 756, w: 310, h: 68 };

function hit(r: Rect, p: { x: number; y: number }): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

function layoutOptionCards(count: number): Rect[] {
  const w = 330;
  // R2：放宽卡片高度，给「标题 + 核心收益 + 代价」更大字号与间距；与 tests/_e2e_adventure.cjs 同源必一致
  const h = count <= 2 ? 124 : 104;
  const gap = 16;
  // 头部之下（STAGE_BAND 顶部留作事件主题区），卡片集中在下半区
  const areaTop = STAGE_BAND.y + 250;
  const areaBottom = STAGE_BAND.y + STAGE_BAND.h - 14;
  const totalH = count * h + (count - 1) * gap;
  const startY = Math.round(areaTop + (areaBottom - areaTop - totalH) / 2);
  const x = Math.round((PORTRAIT_LOGICAL_W - w) / 2);
  const rects: Rect[] = [];
  for (let i = 0; i < count; i++) rects.push({ x, y: startY + i * (h + gap), w, h });
  return rects;
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
  private readonly battleView = new RunBattleView();
  private readonly vp = new PlayerViewportTransform(PORTRAIT_LOGICAL_W, PORTRAIT_LOGICAL_H);
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
  /** R1：选择卡片按下高亮索引（延迟 apply 期间显示反馈，防重入）。 */
  private pressCard = -1;
  private pressTimer: number | null = null;
  private battle: RunBattleRuntime | null = null;
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
    this.ui.load(() => this.render());
    this.render();
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
    if (this.pressTimer !== null) {
      clearTimeout(this.pressTimer);
      this.pressTimer = null;
    }
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
    this.script = generateAdventureScript(seedLabel ?? randomSeedLabel());
    this.state = createAdventureState(this.ctx2, this.script);
    this.archived = false;
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

    if (advOverlayOpen(this.state)) {
      const cards = advOverlayCards(this.state, this.script, this.ctx2);
      const rects = layoutOptionCards(cards.length);
      for (let i = 0; i < rects.length; i++) {
        if (hit(rects[i], p)) {
          this.tapChoice(cards[i].id);
          return;
        }
      }
      return; // 遮罩其它区域：不关窗、不推进
    }

    if (advActionEnabled(this.state) && hit(ACTION_BTN, p)) {
      this.apply(pressAdventureAction(this.state, this.ctx2, this.script));
    }
  };

  /**
   * R1：选择卡片点击 → 立即渲染按下高亮（反馈），延迟 ~130ms 再落定选择。
   *   - 防重入：pending 期间忽略后续点击（E2E 轮询重击不重复触发，不破坏状态机）；
   *   - 延迟仅用于可见反馈，选择因果不变（仍经 chooseAdventureOption 真实结算）。
   */
  private tapChoice(optionId: string): void {
    if (this.pressTimer !== null) return;
    const cards = advOverlayCards(this.state, this.script, this.ctx2);
    this.pressCard = cards.findIndex((c) => c.id === optionId);
    this.render();
    this.pressTimer = window.setTimeout(() => {
      this.pressTimer = null;
      this.pressCard = -1;
      this.apply(chooseAdventureOption(this.state, optionId, this.ctx2, this.script));
    }, 130);
  }

  private apply(next: AdventureState): void {
    if (next === this.state) return;

    // 终态 → 新一局（UI 路径经 startNewRun 直接重置；此处保留终态→IDLE 的档案标记重置作防御）。
    if ((this.state.phase === 'COMPLETE' || this.state.phase === 'FAILED') && next.phase === 'IDLE') {
      this.archived = false;
    }

    const wasTerminal = this.state.phase === 'COMPLETE' || this.state.phase === 'FAILED';
    this.state = next;

    if (next.phase === 'BATTLE' && !this.battle) this.beginBattle();
    if (next.phase !== 'BATTLE' && next.phase !== 'RESULT' && this.battle) this.endBattle();

    if (next.phase === 'BATTLE') this.startLoop();
    else this.stopLoop();

    // 首次进入终态 → 写入隔离测试档案（真实结算数据）。
    if (!wasTerminal && (next.phase === 'COMPLETE' || next.phase === 'FAILED') && !this.archived) {
      this.recordTerminal(next);
    }

    if (next.phase === 'COMPLETE' || next.phase === 'FAILED') this.battleView.stopBattleAudio();
    this.render();
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
  }

  private endBattle(): void {
    if (!this.battle) return;
    this.battle.dispose();
    this.battle = null;
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
      const hp = rt.hp();
      this.state = syncAdventureBattle(this.state, { playerHp: hp.a, enemyHp: hp.b, steps: rt.stepCount });
      const result = rt.result;
      if (result) {
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

  private draw(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = COLORS.pageBg;
    ctx.fillRect(0, 0, PORTRAIT_LOGICAL_W, PORTRAIT_LOGICAL_H);
    this.drawTop(ctx);
    this.drawStage(ctx);
    const terminal = this.state.phase === 'COMPLETE' || this.state.phase === 'FAILED';
    if (terminal) {
      // R2：结算先铺满屏，再把行动带/按钮重绘到最上层，保证「再来一局」按钮可见可点
      this.drawTerminal(ctx);
      this.drawAction(ctx);
      return;
    }
    this.drawAction(ctx);
    if (advOverlayOpen(this.state)) this.drawOverlay(ctx);
    if (this.state.phase === 'EVENT_DONE') this.drawEventDone(ctx);
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
    // R2：顶部仅保留「冒险进度」+「当前耐久」，去除常驻长文本与混乱芯片。
    ctx.fillStyle = COLORS.topBandBg;
    ctx.fillRect(0, 0, PORTRAIT_LOGICAL_W, STAGE_BAND.y);
    ctx.fillStyle = COLORS.divider;
    ctx.fillRect(0, STAGE_BAND.y - 1, PORTRAIT_LOGICAL_W, 1);

    // 进度（顶部单行）
    ctx.fillStyle = COLORS.textTitle;
    ctx.font = `600 18px ${FONT_STACK}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const stage = this.currentStage();
    const stageLabel = stage > 0 ? ` · 第${stage}阶段` : '';
    ctx.fillText(`随机冒险 · DAY ${this.state.day}/${this.state.dayTotal}${stageLabel}`, 16, 28);

    // 装备来源药丸（右上，如实披露：演示/车库，绝不假装已读取）
    const demo = !this.loadoutSource.includes('正式车库');
    const srcLabel = demo ? '演示装备' : '车库装备';
    ctx.font = `500 11px ${FONT_STACK}`;
    const sw = ctx.measureText(srcLabel).width + 18;
    const sx = PORTRAIT_LOGICAL_W - 14 - sw;
    const sy = 14;
    const sh = 22;
    this.roundRectPath(ctx, sx, sy, sw, sh, 11);
    ctx.fillStyle = demo ? 'rgba(224,155,107,0.18)' : 'rgba(127,214,160,0.18)';
    ctx.fill();
    ctx.strokeStyle = demo ? 'rgba(224,155,107,0.6)' : 'rgba(127,214,160,0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = demo ? '#e0b07f' : '#9fe0b8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(srcLabel, sx + sw / 2, sy + sh / 2);

    // 耐久条（第二行：标签左 / 进度中 / 百分比右）
    const hpBar: Rect = { x: 46, y: 52, w: 248, h: 16 };
    const maxHp = this.ctx2.playerHpMax;
    const hp = advCarriedPlayerHp(this.state, this.ctx2);
    const pct = Math.max(0, Math.min(100, Math.round((hp / maxHp) * 100)));
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

  private drawStage(ctx: CanvasRenderingContext2D): void {
    const b = STAGE_BAND;
    // R1：真实竖屏战斗背景（缺失则降级为渐变）
    if (!this.blitImage(ctx, 'battle_bg', b.x, b.y, b.w, b.h, 'cover')) {
      const g = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
      g.addColorStop(0, COLORS.stageSkyTop);
      g.addColorStop(1, COLORS.stageSkyBottom);
      ctx.fillStyle = g;
      ctx.fillRect(b.x, b.y, b.w, b.h);
    }
    // R2：加强压暗 + 上下渐变 scrim，减弱大型 VS 背景的视觉干扰（战斗主体在 scrim 之上绘制，不被压暗）
    ctx.fillStyle = 'rgba(8,12,20,0.58)';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    const topScrim = ctx.createLinearGradient(0, b.y, 0, b.y + 96);
    topScrim.addColorStop(0, 'rgba(6,9,14,0.64)');
    topScrim.addColorStop(1, 'rgba(6,9,14,0)');
    ctx.fillStyle = topScrim;
    ctx.fillRect(b.x, b.y, b.w, 96);
    const botScrim = ctx.createLinearGradient(0, b.y + b.h, 0, b.y + b.h - 96);
    botScrim.addColorStop(0, 'rgba(6,9,14,0.64)');
    botScrim.addColorStop(1, 'rgba(6,9,14,0)');
    ctx.fillStyle = botScrim;
    ctx.fillRect(b.x, b.y + b.h - 96, b.w, 96);
    // 地面
    const groundY = b.y + b.h - 70;
    ctx.fillStyle = COLORS.ground;
    ctx.fillRect(b.x, groundY, b.w, b.h - (groundY - b.y));
    ctx.fillStyle = COLORS.road;
    ctx.fillRect(b.x, groundY + 30, b.w, 14);

    const node = advCurrentNode(this.state, this.script);
    if (node.kind === 'BANNER') {
      this.drawBanner(ctx, node.beat);
      return;
    }

    if (this.battle) {
      // 真实战斗（BATTLE 实时 / RESULT 冻结帧）一律贴正式战斗画面
      this.battleView.render(this.battle);
      this.battleView.blit(ctx, b);
      return;
    }

    // 非战斗：居中叙事卡片（R2：用聚焦面板压住 VS 中区，弱化背景干扰，突出文字）
    const pcx = b.x + b.w / 2;
    const panelW = PORTRAIT_LOGICAL_W - 64;
    const panelH = 132;
    const panelY = b.y + b.h / 2 - panelH / 2;
    ctx.fillStyle = 'rgba(8,12,20,0.66)';
    this.roundRectPath(ctx, pcx - panelW / 2, panelY, panelW, panelH, 16);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(124,141,176,0.45)';
    this.roundRectPath(ctx, pcx - panelW / 2, panelY, panelW, panelH, 16);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (this.state.phase === 'EVENT' && (node.kind === 'BATTLE' || node.kind === 'FINAL')) {
      ctx.fillStyle = COLORS.eventAccent;
      ctx.font = `700 20px ${FONT_STACK}`;
      ctx.fillText(`前方：${this.battleEnemyLabel(node.encounterId)}`, pcx, panelY + panelH / 2 - 14);
      ctx.fillStyle = COLORS.textDim;
      ctx.font = `400 13px ${FONT_STACK}`;
      ctx.fillText('按「遭遇敌人」开打', pcx, panelY + panelH / 2 + 18);
    } else {
      ctx.fillStyle = COLORS.textBody;
      ctx.font = `600 17px ${FONT_STACK}`;
      ctx.fillText('继续前进…', pcx, panelY + panelH / 2);
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

  private drawBanner(ctx: CanvasRenderingContext2D, beat: readonly string[]): void {
    const b = STAGE_BAND;
    ctx.fillStyle = 'rgba(8,12,20,0.9)';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = '#7c8db0';
    ctx.lineWidth = 2;
    ctx.strokeRect(b.x + 20, b.y + 90, b.w - 40, b.h - 180);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#9fb3d6';
    ctx.font = `600 22px ${FONT_STACK}`;
    ctx.fillText('— 阶段提示 —', b.x + b.w / 2, b.y + 140);
    ctx.fillStyle = COLORS.textBody;
    ctx.font = `400 14px ${FONT_STACK}`;
    let y = b.y + 200;
    for (const line of beat) {
      this.wrapText(ctx, line, b.x + b.w / 2, y, b.w - 80, 22);
      y += 44;
    }
    ctx.fillStyle = '#7fd6a0';
    ctx.font = `500 13px ${FONT_STACK}`;
    ctx.fillText('▶ 按「继续」进入下一段路', b.x + b.w / 2, b.y + b.h - 60);
  }

  private drawAction(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = COLORS.actionBandBg;
    ctx.fillRect(ACTION_BAND.x, ACTION_BAND.y, ACTION_BAND.w, ACTION_BAND.h);
    const enabled = advActionEnabled(this.state) && !advOverlayOpen(this.state);
    const r = ACTION_BTN;
    const g = ctx.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
    if (enabled) {
      g.addColorStop(0, '#3f6ea3');
      g.addColorStop(1, '#2c4d78');
    } else {
      g.addColorStop(0, '#222a36');
      g.addColorStop(1, '#1a212c');
    }
    this.roundRectPath(ctx, r.x, r.y, r.w, r.h, 12);
    ctx.fillStyle = enabled ? g : COLORS.actionBtnOff;
    ctx.fill();
    if (enabled) {
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      this.roundRectPath(ctx, r.x + 2, r.y + 2, r.w - 4, r.h * 0.42, 10);
      ctx.fill();
    }
    this.roundRectPath(ctx, r.x, r.y, r.w, r.h, 12);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = enabled ? 'rgba(255,255,255,0.28)' : '#2a3341';
    ctx.stroke();
    ctx.fillStyle = enabled ? COLORS.textTitle : COLORS.textDim;
    ctx.font = `600 17px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(advActionLabel(this.state), r.x + r.w / 2, r.y + r.h / 2);
  }

  private drawOverlay(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = COLORS.mask;
    ctx.fillRect(0, 0, PORTRAIT_LOGICAL_W, PORTRAIT_LOGICAL_H);
    const node = advCurrentNode(this.state, this.script);
    if (node.kind === 'EVENT') this.drawEventChoiceOverlay(ctx, node);
    else this.drawBuildChoiceOverlay(ctx);
  }

  /** 事件选择浮层（R1：真实卡片底 + 主题色 + 图标 + 收益/代价分行，一眼可区分）。 */
  private drawEventChoiceOverlay(ctx: CanvasRenderingContext2D, node: AdventureEventNode): void {
    const theme = EVENT_THEME[node.eventKind];
    const b = STAGE_BAND;
    // 背景 + 压暗
    if (!this.blitImage(ctx, 'battle_bg', b.x, b.y, b.w, b.h, 'cover')) {
      ctx.fillStyle = '#0e131c';
      ctx.fillRect(b.x, b.y, b.w, b.h);
    }
    ctx.fillStyle = 'rgba(6,9,14,0.80)';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = theme.accent;
    ctx.fillRect(b.x, b.y, b.w, 6);

    // 事件图标徽章（圆形）
    const badgeCx = b.x + 44;
    const badgeCy = b.y + 60;
    const badgeR = 26;
    ctx.save();
    ctx.beginPath();
    ctx.arc(badgeCx, badgeCy, badgeR, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(10,14,22,0.85)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = theme.accent;
    ctx.stroke();
    ctx.restore();
    this.drawEventIcon(ctx, node.eventKind, badgeCx, badgeCy, 30, theme.accent);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = theme.accent;
    ctx.font = `600 13px ${FONT_STACK}`;
    ctx.fillText(theme.tag, b.x + 82, b.y + 44);
    ctx.fillStyle = COLORS.textTitle;
    ctx.font = `700 20px ${FONT_STACK}`;
    ctx.fillText(node.title, b.x + 82, b.y + 74);

    // 解释文字（R2：减少，最多 2 行，dim 小字；核心信息交由下方选择卡承载）
    ctx.fillStyle = COLORS.textBody;
    ctx.font = `400 12px ${FONT_STACK}`;
    let dy = b.y + 110;
    const maxBeat = 2;
    for (let i = 0; i < node.beat.length && i < maxBeat; i++) {
      ctx.fillText(node.beat[i], b.x + 20, dy);
      dy += 19;
    }

    // 选项卡片
    const cards = advOverlayCards(this.state, this.script, this.ctx2);
    const rects = layoutOptionCards(cards.length);
    const fullHp = advCarriedPlayerHp(this.state, this.ctx2) >= this.ctx2.playerHpMax;
    for (let i = 0; i < rects.length; i++) {
      const eff = node.outcomes[cards[i].id];
      const gain = this.effectGain(eff, fullHp);
      const cost = this.effectCost(eff);
      this.drawChoiceCard(ctx, rects[i], i, {
        accent: theme.accent,
        label: cards[i].label,
        gain,
        cost,
        sub: this.optionNoteWithState(node, cards[i].id, fullHp),
      });
    }
  }

  private optionNoteWithState(node: AdventureEventNode, optionId: string, fullHp: boolean): string {
    const base = node.options.find((o) => o.id === optionId)?.note ?? '';
    const eff = node.outcomes[optionId];
    if (fullHp && eff && (eff.kind === 'heal' || eff.kind === 'trade')) return `${base}（耐久已满，收益有限）`;
    return base;
  }

  /** 建造选择浮层（R1：真实卡片底，强化在下一场战斗真实生效）。 */
  private drawBuildChoiceOverlay(ctx: CanvasRenderingContext2D): void {
    const b = STAGE_BAND;
    if (!this.blitImage(ctx, 'battle_bg', b.x, b.y, b.w, b.h, 'cover')) {
      ctx.fillStyle = '#0e131c';
      ctx.fillRect(b.x, b.y, b.w, b.h);
    }
    ctx.fillStyle = 'rgba(6,9,14,0.80)';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = COLORS.eventAccent;
    ctx.fillRect(b.x, b.y, b.w, 6);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.textTitle;
    ctx.font = `700 20px ${FONT_STACK}`;
    ctx.fillText('选择一项改装', b.x + 20, b.y + 44);
    ctx.fillStyle = COLORS.textDim;
    ctx.font = `400 13px ${FONT_STACK}`;
    ctx.fillText('强化会在下一场战斗真实生效', b.x + 20, b.y + 74);

    const cards = advOverlayCards(this.state, this.script, this.ctx2);
    const rects = layoutOptionCards(cards.length);
    for (let i = 0; i < rects.length; i++) {
      this.drawChoiceCard(ctx, rects[i], i, {
        accent: COLORS.eventAccent,
        label: cards[i].label,
        gain: '获得临时强化',
        cost: '—',
        sub: cards[i].note,
      });
    }
  }

  /** 单张选择卡（R2：放大标题/核心收益，明确区分收益与代价，按下复用真实 tab_selected 选中态）。 */
  private drawChoiceCard(
    ctx: CanvasRenderingContext2D,
    r: Rect,
    index: number,
    text: { accent: string; label: string; gain: string; cost: string; sub?: string },
  ): void {
    const pressed = this.pressCard === index;
    // 卡片底（真实素材 cover；缺失则过程式底色）
    if (this.blitImage(ctx, 'card_bg', r.x, r.y, r.w, r.h, 'cover')) {
      ctx.fillStyle = 'rgba(8,12,20,0.42)';
      this.roundRectPath(ctx, r.x, r.y, r.w, r.h, 10);
      ctx.fill();
    } else {
      ctx.fillStyle = COLORS.cardBg;
      this.roundRectPath(ctx, r.x, r.y, r.w, r.h, 10);
      ctx.fill();
    }
    // 选中态：复用已筛选的真实 tab_selected 资产（按下时整卡高亮叠加，圆角裁剪）
    if (pressed) {
      if (this.ui.ready('tab_selected')) {
        ctx.save();
        this.roundRectPath(ctx, r.x, r.y, r.w, r.h, 10);
        ctx.clip();
        this.blitImage(ctx, 'tab_selected', r.x, r.y, r.w, r.h, 'stretch');
        ctx.restore();
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        this.roundRectPath(ctx, r.x, r.y, r.w, r.h, 10);
        ctx.fill();
      }
    }
    // 边框
    this.roundRectPath(ctx, r.x, r.y, r.w, r.h, 10);
    ctx.lineWidth = pressed ? 3 : 1.5;
    ctx.strokeStyle = pressed ? '#ffffff' : text.accent;
    ctx.stroke();
    // 左侧主题色条
    ctx.fillStyle = text.accent;
    this.roundRectPath(ctx, r.x, r.y, 5, r.h, 2);
    ctx.fill();

    const tall = r.h > 110;
    const labelY = r.y + (tall ? 30 : 26);
    const gainY = r.y + (tall ? 64 : 54);
    const costY = r.y + (tall ? 88 : 76);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    // 标题（放大）
    ctx.fillStyle = COLORS.textTitle;
    ctx.font = `700 18px ${FONT_STACK}`;
    ctx.fillText(text.label, r.x + 18, labelY);
    // 收益（前缀标签 + 核心收益加粗绿）
    ctx.font = `500 11px ${FONT_STACK}`;
    ctx.fillStyle = COLORS.textDim;
    ctx.fillText('收益', r.x + 18, gainY);
    ctx.font = `600 15px ${FONT_STACK}`;
    ctx.fillStyle = '#7fd6a0';
    ctx.fillText(text.gain, r.x + 52, gainY);
    // 代价（前缀标签 + 值；有代价橙，无代价灰）
    ctx.font = `500 11px ${FONT_STACK}`;
    ctx.fillStyle = COLORS.textDim;
    ctx.fillText('代价', r.x + 18, costY);
    ctx.font = `600 13px ${FONT_STACK}`;
    ctx.fillStyle = text.cost === '—' ? COLORS.textDim : '#e09b6b';
    ctx.fillText(text.cost, r.x + 52, costY);
    // 补充说明（仅高卡显示，dim，长文本省略）—— R2：减少解释文字
    if (tall && text.sub) {
      ctx.fillStyle = COLORS.textDim;
      ctx.font = `400 11px ${FONT_STACK}`;
      const sub = text.sub.length > 26 ? text.sub.slice(0, 25) + '…' : text.sub;
      ctx.fillText(sub, r.x + 18, costY + 20);
    }
  }

  /** 事件效果 → 收益摘要（满耐久时如实提示收益有限）。 */
  private effectGain(eff: AdventureEffect | undefined, fullHp: boolean): string {
    if (!eff) return '推进剧情';
    switch (eff.kind) {
      case 'heal':
        return fullHp ? '恢复耐久（已满，有限）' : '恢复耐久';
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

  private drawEventDone(ctx: CanvasRenderingContext2D): void {
    const b = STAGE_BAND;
    const node = advCurrentNode(this.state, this.script);
    const kind = node.kind === 'EVENT' ? node.eventKind : 'crate';
    const theme = EVENT_THEME[kind];
    if (!this.blitImage(ctx, 'battle_bg', b.x, b.y, b.w, b.h, 'cover')) {
      ctx.fillStyle = 'rgba(6,9,14,0.76)';
      ctx.fillRect(0, b.y, b.w, b.h);
    }
    // R2：加强压暗，避免 VS 背景干扰开奖阅读
    ctx.fillStyle = 'rgba(6,9,14,0.86)';
    ctx.fillRect(0, b.y, b.w, b.h);
    ctx.fillStyle = theme.accent;
    ctx.fillRect(b.x, b.y, b.w, 6);

    // 真实宝箱（开奖）
    this.blitImage(ctx, 'chest_open', b.x + b.w / 2 - 56, b.y + 78, 112, 96, 'contain');

    ctx.fillStyle = theme.accent;
    ctx.font = `600 14px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('开 奖', b.x + b.w / 2, b.y + 196);

    // 结果文本聚焦面板
    ctx.fillStyle = 'rgba(8,12,20,0.55)';
    this.roundRectPath(ctx, 28, b.y + 210, PORTRAIT_LOGICAL_W - 56, 84, 12);
    ctx.fill();
    ctx.fillStyle = COLORS.textTitle;
    ctx.font = `600 15px ${FONT_STACK}`;
    // 去掉句末标点，避免换行时留下孤立的「。」
    const text = (this.state.eventResult ?? '').replace(/[。.]+$/, '');
    this.wrapText(ctx, text, b.x + b.w / 2, b.y + 236, b.w - 30, 23);

    // 底部提示（加渐变底保证可读）
    const botG = ctx.createLinearGradient(0, b.y + b.h, 0, b.y + b.h - 96);
    botG.addColorStop(0, 'rgba(6,9,14,0.72)');
    botG.addColorStop(1, 'rgba(6,9,14,0)');
    ctx.fillStyle = botG;
    ctx.fillRect(b.x, b.y + b.h - 96, b.w, 96);
    ctx.fillStyle = '#7fd6a0';
    ctx.font = `600 14px ${FONT_STACK}`;
    ctx.fillText('▶ 按「继续」进入下一天', b.x + b.w / 2, b.y + b.h - 42);
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

  private wrapText(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, maxW: number, lineH: number): void {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const chars = [...text];
    let line = '';
    let ly = y;
    for (const ch of chars) {
      const test = line + ch;
      if (ctx.measureText(test).width > maxW && line.length > 0) {
        ctx.fillText(line, cx, ly);
        line = ch;
        ly += lineH;
      } else {
        line = test;
      }
    }
    if (line.length > 0) ctx.fillText(line, cx, ly);
  }

  private drawTerminal(ctx: CanvasRenderingContext2D): void {
    const won = this.state.phase === 'COMPLETE';
    const cx = PORTRAIT_LOGICAL_W / 2;
    // 背景（强压暗，避免 VS 背景干扰结算阅读）
    if (!this.blitImage(ctx, 'battle_bg', 0, 0, PORTRAIT_LOGICAL_W, PORTRAIT_LOGICAL_H, 'cover')) {
      ctx.fillStyle = 'rgba(6,9,14,0.92)';
      ctx.fillRect(0, 0, PORTRAIT_LOGICAL_W, PORTRAIT_LOGICAL_H);
    }
    ctx.fillStyle = 'rgba(6,9,14,0.90)';
    ctx.fillRect(0, 0, PORTRAIT_LOGICAL_W, PORTRAIT_LOGICAL_H);

    // 横幅（真实素材）：R2 把胜负标题绘制到横幅之上，修复「空白横幅」
    const bannerY = 100;
    const bannerH = 84;
    const bannerW = 320;
    this.blitImage(ctx, won ? 'banner_win' : 'banner_lost', cx - bannerW / 2, bannerY, bannerW, bannerH, 'stretch');
    // 横幅中央加半透明暗底，保证标题可读
    ctx.fillStyle = 'rgba(10,14,22,0.46)';
    this.roundRectPath(ctx, cx - bannerW / 2 + 10, bannerY + 18, bannerW - 20, bannerH - 36, 10);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 26px ${FONT_STACK}`;
    ctx.fillText(won ? '冒险完成' : '冒险失败', cx, bannerY + bannerH / 2);

    // 星级（按胜负 + 终点耐久）
    const hp = advCarriedPlayerHp(this.state, this.ctx2);
    const pct = Math.max(0, Math.min(100, Math.round((hp / this.ctx2.playerHpMax) * 100)));
    const stars = won ? (pct >= 66 ? 3 : pct >= 33 ? 2 : 1) : 1;
    const starSize = 38;
    const starGap = 16;
    const starTotal = 3 * starSize + 2 * starGap;
    const starX0 = cx - starTotal / 2;
    const starY = 222;
    for (let i = 0; i < 3; i++) {
      const scx = starX0 + i * (starSize + starGap) + starSize / 2;
      const lit = i < stars;
      if (this.ui.ready('star')) {
        ctx.save();
        ctx.globalAlpha = lit ? 1 : 0.28;
        this.blitImage(ctx, 'star', scx - starSize / 2, starY - starSize / 2, starSize, starSize, 'contain');
        ctx.restore();
      } else {
        ctx.fillStyle = lit ? '#e8b23c' : 'rgba(232,178,60,0.28)';
        ctx.font = `${starSize}px ${FONT_STACK}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('★', scx, starY);
      }
    }

    // 核心成果：计分板（完成 / 获胜分列，呼应 R4 口径）
    const boardY = 272;
    const boardH = 66;
    const boardW = 160;
    this.drawScoreBoard(ctx, 'score_blue', 24, boardY, boardW, boardH, '完成场次', this.state.battlesCompleted);
    this.drawScoreBoard(ctx, 'score_red', 206, boardY, boardW, boardH, '获胜场次', this.state.battlesWon);

    // 关键数据（撑到天数 + 终点耐久）
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.textBody;
    ctx.font = `400 14px ${FONT_STACK}`;
    ctx.fillText(`撑到第 ${this.state.day} / ${this.state.dayTotal} 天 · 强化 ${this.state.buffs.length} 项`, cx, 366);
    ctx.fillStyle = pct <= 25 ? COLORS.hpLow : '#7fd6a0';
    ctx.font = `600 16px ${FONT_STACK}`;
    ctx.fillText(`终点耐久 ${pct}%`, cx, 392);

    // 次要统计（弱化）：本局 Build 小字
    ctx.fillStyle = COLORS.textDim;
    ctx.font = `500 12px ${FONT_STACK}`;
    ctx.fillText('本局 Build', cx, 420);
    ctx.font = `500 12px ${FONT_STACK}`;
    const chips = this.state.buffs.map((b) => runBuildOptionById(b)?.label ?? b);
    if (chips.length === 0) {
      ctx.fillStyle = COLORS.textDim;
      ctx.fillText('（无）', cx, 440);
    } else {
      // R2：次要统计单行收纳，溢出以「+N」表示，避免与下方最佳记录行重叠
      const shown = chips.slice(0, 3);
      const extra = chips.length - shown.length;
      const measure = (s: string): number => {
        ctx.font = `500 12px ${FONT_STACK}`;
        return ctx.measureText(s).width + 12;
      };
      const widths = shown.map(measure);
      const extraLabel = extra > 0 ? `+${extra}` : '';
      const extraW = extra > 0 ? measure(extraLabel) : 0;
      const totalW = widths.reduce((a, b) => a + b, 0) + extraW + (shown.length - 1 + (extra > 0 ? 1 : 0)) * 6;
      let bx = cx - totalW / 2;
      const cy = 436;
      for (let i = 0; i < shown.length; i++) {
        ctx.fillStyle = 'rgba(230,237,248,0.14)';
        ctx.fillRect(bx, cy, widths[i], 16);
        ctx.fillStyle = COLORS.textDim;
        ctx.font = `500 12px ${FONT_STACK}`;
        ctx.textAlign = 'left';
        ctx.fillText(shown[i], bx + 6, cy + 8);
        bx += widths[i] + 6;
      }
      if (extra > 0) {
        ctx.fillStyle = 'rgba(230,237,248,0.10)';
        ctx.fillRect(bx, cy, extraW, 16);
        ctx.fillStyle = COLORS.textDim;
        ctx.font = `500 12px ${FONT_STACK}`;
        ctx.textAlign = 'left';
        ctx.fillText(extraLabel, bx + 6, cy + 8);
      }
      ctx.textAlign = 'center';
    }

    // 次要统计（弱化）：最佳记录行（rank_self 缩小变暗）
    const best = this.archive.best;
    const bestLine1 = best
      ? `最佳：获胜 ${best.battlesWon} 场${best.won ? '（曾通关）' : ''} · 终点耐久 ${best.finalHpPct}%`
      : '测试档案：本局为首胜记录';
    const bestLine2 = `累计 ${this.archive.totals.runs} 局 / ${this.archive.totals.wins} 胜`;
    ctx.save();
    ctx.globalAlpha = 0.45;
    this.blitImage(ctx, 'rank_self', cx - 150, 458, 300, 60, 'stretch');
    ctx.restore();
    ctx.fillStyle = '#9fb0c8';
    ctx.font = `500 11px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(bestLine1, cx, 480);
    ctx.fillText(bestLine2, cx, 496);

    // 下一局目标（弱化小字）
    ctx.fillStyle = COLORS.textDim;
    ctx.font = `400 12px ${FONT_STACK}`;
    this.wrapText(ctx, nextRunGoal(this.archive), cx, 548, PORTRAIT_LOGICAL_W - 70, 16);

    // 下一步操作（突出）：再来一局（文案与实际按钮标签同源，避免冲突）
    ctx.fillStyle = '#7fd6a0';
    ctx.font = `600 14px ${FONT_STACK}`;
    ctx.fillText(`▶ 按「${advActionLabel(this.state)}」开始新一局（新随机种子）`, cx, 694);
  }

  /** 计分板（真实素材底 + 文本覆盖）。 */
  private drawScoreBoard(
    ctx: CanvasRenderingContext2D,
    id: AdvUiId,
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    value: number,
  ): void {
    this.blitImage(ctx, id, x, y, w, h, 'stretch');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = `600 12px ${FONT_STACK}`;
    ctx.fillText(label, x + w / 2, y + h * 0.34);
    ctx.font = `700 26px ${FONT_STACK}`;
    ctx.fillText(String(value), x + w / 2, y + h * 0.7);
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
      archive: { best: this.archive.best, totals: this.archive.totals, runs: this.archive.runs.length },
    };
  }

  /**
   * 调试自动步进（仅供 E2E / 真机计时用；不参与任何玩法规则）：
   *   - 浮层打开 → 选第一张卡（等价真实点击首张卡）；
   *   - 主动作可用 → 按一次主动作（等价真实点击主按钮）；
   *   - BATTLE / 战报冻结期 → 不操作（真实物理战斗由 requestAnimationFrame 自动推进）。
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
    if (advActionEnabled(this.state)) {
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
    if (advActionEnabled(this.state)) {
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
    if (advEventChoiceOpen(this.state) && node.kind === 'EVENT') {
      return {
        kind: 'event',
        options: node.options.map((o) => {
          const eff = node.outcomes[o.id];
          const candidates = eff && (eff.kind === 'buff' || eff.kind === 'trade') ? [...eff.candidates] : null;
          const fresh = candidates ? candidates.filter((id) => !this.state.buffs.includes(id)) : null;
          return {
            id: o.id,
            effect: eff?.kind ?? 'none',
            candidates,
            freshCount: fresh ? fresh.length : null,
          };
        }),
      };
    }
    if (advChoiceOpen(this.state) && node.kind === 'BUILD') {
      return {
        kind: 'build',
        options: advOverlayCards(this.state, this.script, this.ctx2).map((c) => ({ id: c.id, effect: 'build' })),
      };
    }
    return { kind: 'none', options: [] };
  }
}
