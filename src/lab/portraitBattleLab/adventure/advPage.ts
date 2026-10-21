/**
 * FRUITS-RANDOM-ADVENTURE-R1｜随机冒险宿主页面（DOM/Canvas 输入层，唯一）。
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
 */
import { PlayerViewportTransform } from '../../../platform/playerViewport';
import { PORTRAIT_LOGICAL_H, PORTRAIT_LOGICAL_W } from '../constants';
import { RunBattleRuntime } from '../runBattleRuntime';
import { RunBattleView } from '../runBattleView';
import { demoRunPlayerLoadout, type RunPlayerLoadout } from '../runPageScene';
import { runBuildOptionById } from '../runModifiers';
import {
  generateAdventureScript,
  randomSeedLabel,
  type AdventureScript,
} from './advScript';
import {
  advActionEnabled,
  advActionLabel,
  advCarriedPlayerHp,
  advContextFromLoadout,
  advCurrentNode,
  advFormatLog,
  advOverlayCards,
  advOverlayOpen,
  advOverlayTitle,
  advVisibleLog,
  chooseAdventureOption,
  createAdventureState,
  finishAdventureBattle,
  pressAdventureAction,
  syncAdventureBattle,
  type AdventureContext,
  type AdventureState,
} from './advState';

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

const STAGE_BAND: Rect = { x: 0, y: 96, w: PORTRAIT_LOGICAL_W, h: 470 };
const LOG_BAND: Rect = { x: 0, y: 566, w: PORTRAIT_LOGICAL_W, h: 178 };
const ACTION_BAND: Rect = { x: 0, y: 744, w: PORTRAIT_LOGICAL_W, h: 100 };
const ACTION_BTN: Rect = { x: 40, y: 756, w: 310, h: 68 };

function hit(r: Rect, p: { x: number; y: number }): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

function layoutCards(count: number): Rect[] {
  const w = 330;
  const h = count <= 2 ? 124 : 100;
  const gap = 18;
  const totalH = count * h + (count - 1) * gap;
  const startY = Math.round(STAGE_BAND.y + STAGE_BAND.h / 2 - totalH / 2);
  const x = Math.round((PORTRAIT_LOGICAL_W - w) / 2);
  const rects: Rect[] = [];
  for (let i = 0; i < count; i++) rects.push({ x, y: startY + i * (h + gap), w, h });
  return rects;
}

export interface AdvPageOptions {
  readonly seed?: string;
  readonly onExit?: () => void;
}

export class AdvPage {
  private readonly root: HTMLElement;
  private readonly stageWrap: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly battleView = new RunBattleView();
  private readonly vp = new PlayerViewportTransform(PORTRAIT_LOGICAL_W, PORTRAIT_LOGICAL_H);

  private readonly loadout: RunPlayerLoadout;
  private readonly ctx2: AdventureContext;
  private readonly script: AdventureScript;
  private state: AdventureState;

  private rafHandle = 0;
  private lastFrameMs = 0;
  private battle: RunBattleRuntime | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private readonly onWindowResize = (): void => this.render();

  constructor(root: HTMLElement, opts: AdvPageOptions = {}) {
    this.root = root;
    this.loadout = demoRunPlayerLoadout();
    this.ctx2 = advContextFromLoadout(this.loadout);
    this.script = generateAdventureScript(opts.seed ?? randomSeedLabel());
    this.state = createAdventureState(this.ctx2, this.script);

    this.stageWrap = document.createElement('div');
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'adv-canvas';
    this.ctx = this.canvas.getContext('2d');

    this.buildDom();
    this.observeResize();
    this.battleView.onAssetsReady(() => this.render());
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
    this.battleView.dispose();
    window.removeEventListener('resize', this.onWindowResize);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
  }

  /* ----------------------------------------------------------- 输入 */

  private readonly onPointerDown = (ev: PointerEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    const p = this.vp.clientToLogical(ev.clientX, ev.clientY, rect);

    if (advOverlayOpen(this.state)) {
      const cards = advOverlayCards(this.state, this.script, this.ctx2);
      const rects = layoutCards(cards.length);
      for (let i = 0; i < rects.length; i++) {
        if (hit(rects[i], p)) {
          this.apply(chooseAdventureOption(this.state, cards[i].id, this.ctx2, this.script));
          return;
        }
      }
      return; // 遮罩其它区域：不关窗、不推进
    }

    if (advActionEnabled(this.state) && hit(ACTION_BTN, p)) {
      this.apply(pressAdventureAction(this.state, this.ctx2, this.script));
    }
  };

  private apply(next: AdventureState): void {
    if (next === this.state) return;
    this.state = next;

    if (next.phase === 'BATTLE' && !this.battle) this.beginBattle();
    if (next.phase !== 'BATTLE' && next.phase !== 'RESULT' && this.battle) this.endBattle();

    if (next.phase === 'BATTLE') this.startLoop();
    else this.stopLoop();

    if (next.phase === 'COMPLETE' || next.phase === 'FAILED') this.battleView.stopBattleAudio();
    this.render();
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
        this.state = finishAdventureBattle(this.state, {
          winner: result.winner ?? null,
          endReason: result.endReason ?? null,
          playerHp: hp.a,
          enemyHp: hp.b,
          steps: rt.stepCount,
        }, this.script);
        this.battleView.stopBattleAudio();
        this.rafHandle = 0;
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
    this.drawLog(ctx);
    this.drawAction(ctx);
    if (advOverlayOpen(this.state)) this.drawOverlay(ctx);
    if (this.state.phase === 'EVENT_DONE') this.drawEventDone(ctx);
    if (this.state.phase === 'COMPLETE' || this.state.phase === 'FAILED') this.drawTerminal(ctx);
  }

  private drawTop(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = COLORS.topBandBg;
    ctx.fillRect(0, 0, PORTRAIT_LOGICAL_W, STAGE_BAND.y);
    ctx.fillStyle = COLORS.divider;
    ctx.fillRect(0, STAGE_BAND.y - 1, PORTRAIT_LOGICAL_W, 1);

    ctx.fillStyle = COLORS.textTitle;
    ctx.font = `600 18px ${FONT_STACK}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`随机冒险 · DAY ${this.state.day}/${this.state.dayTotal}`, 16, 30);

    // 耐久条
    const hpBar: Rect = { x: 16, y: 50, w: 280, h: 16 };
    const maxHp = this.ctx2.playerHpMax;
    const hp = advCarriedPlayerHp(this.state, this.ctx2);
    const pct = Math.max(0, Math.min(100, Math.round((hp / maxHp) * 100)));
    ctx.fillStyle = COLORS.hpBarBg;
    ctx.fillRect(hpBar.x, hpBar.y, hpBar.w, hpBar.h);
    ctx.fillStyle = pct <= 25 ? COLORS.hpLow : COLORS.hpBarFill;
    ctx.fillRect(hpBar.x, hpBar.y, Math.round((hpBar.w * pct) / 100), hpBar.h);
    ctx.fillStyle = COLORS.textBody;
    ctx.font = `500 11px ${FONT_STACK}`;
    ctx.textAlign = 'right';
    ctx.fillText(`耐久 ${pct}%`, PORTRAIT_LOGICAL_W - 16, 58);

    // buff 芯片
    let bx = 16;
    const by = 76;
    for (const b of this.state.buffs) {
      const label = runBuildOptionById(b)?.label ?? b;
      ctx.font = `500 11px ${FONT_STACK}`;
      const tw = ctx.measureText(label).width + 14;
      ctx.fillStyle = '#e6edf8';
      ctx.fillRect(bx, by, tw, 16);
      ctx.fillStyle = '#1b2432';
      ctx.textAlign = 'left';
      ctx.fillText(label, bx + 7, by + 8);
      bx += tw + 6;
      if (bx > PORTRAIT_LOGICAL_W - 40) break;
    }
  }

  private drawStage(ctx: CanvasRenderingContext2D): void {
    const b = STAGE_BAND;
    // 天空渐变
    const g = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
    g.addColorStop(0, COLORS.stageSkyTop);
    g.addColorStop(1, COLORS.stageSkyBottom);
    ctx.fillStyle = g;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    // 地面
    const groundY = b.y + b.h - 70;
    ctx.fillStyle = COLORS.ground;
    ctx.fillRect(b.x, groundY, b.w, b.h - (groundY - b.y));
    ctx.fillStyle = COLORS.road;
    ctx.fillRect(b.x, groundY + 30, b.w, 14);

    if (this.battle) {
      // 真实战斗（BATTLE 实时 / RESULT 冻结帧）一律贴正式战斗画面
      this.battleView.render(this.battle);
      this.battleView.blit(ctx, b);
      return;
    }

    // 非战斗：居中叙事
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const node = advCurrentNode(this.state, this.script);
    if (this.state.phase === 'EVENT' && (node.kind === 'BATTLE' || node.kind === 'FINAL')) {
      ctx.fillStyle = COLORS.eventAccent;
      ctx.font = `600 20px ${FONT_STACK}`;
      ctx.fillText(`前方：${this.battleEnemyLabel(node.encounterId)}`, b.x + b.w / 2, b.y + b.h / 2 - 10);
      ctx.fillStyle = COLORS.textDim;
      ctx.font = `400 13px ${FONT_STACK}`;
      ctx.fillText('按「遭遇敌人」开打', b.x + b.w / 2, b.y + b.h / 2 + 20);
    } else {
      ctx.fillStyle = COLORS.textBody;
      ctx.font = `500 15px ${FONT_STACK}`;
      ctx.fillText('继续前进…', b.x + b.w / 2, b.y + b.h / 2);
    }
  }

  private battleEnemyLabel(id: string): string {
    const map: Record<string, string> = { ProtoRusher: '原型冲撞者', Chaser: '追击者', RangedTurret: '远程炮塔车' };
    return map[id] ?? '对手';
  }

  private drawLog(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = COLORS.logBandBg;
    ctx.fillRect(LOG_BAND.x, LOG_BAND.y, LOG_BAND.w, LOG_BAND.h);
    ctx.fillStyle = COLORS.divider;
    ctx.fillRect(0, LOG_BAND.y, PORTRAIT_LOGICAL_W, 1);
    const lines = advVisibleLog(this.state, 8);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    let y = LOG_BAND.y + 22;
    for (const e of lines) {
      ctx.fillStyle =
        e.kind === 'day' ? COLORS.eventAccent : e.kind === 'durability' ? '#7fd6a0' : COLORS.textDim;
      ctx.font = `400 12px ${FONT_STACK}`;
      const text = advFormatLog(e);
      ctx.fillText(text.length > 46 ? text.slice(0, 45) + '…' : text, 16, y);
      y += 19;
      if (y > LOG_BAND.y + LOG_BAND.h - 14) break;
    }
  }

  private drawAction(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = COLORS.actionBandBg;
    ctx.fillRect(ACTION_BAND.x, ACTION_BAND.y, ACTION_BAND.w, ACTION_BAND.h);
    const enabled = advActionEnabled(this.state) && !advOverlayOpen(this.state);
    ctx.fillStyle = enabled ? COLORS.actionBtn : COLORS.actionBtnOff;
    ctx.fillRect(ACTION_BTN.x, ACTION_BTN.y, ACTION_BTN.w, ACTION_BTN.h);
    ctx.fillStyle = enabled ? COLORS.textTitle : COLORS.textDim;
    ctx.font = `600 17px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(advActionLabel(this.state), ACTION_BTN.x + ACTION_BTN.w / 2, ACTION_BTN.y + ACTION_BTN.h / 2);
  }

  private drawOverlay(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = COLORS.mask;
    ctx.fillRect(0, 0, PORTRAIT_LOGICAL_W, PORTRAIT_LOGICAL_H);
    const title = advOverlayTitle(this.state, this.script);
    ctx.fillStyle = COLORS.textTitle;
    ctx.font = `600 19px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(title, PORTRAIT_LOGICAL_W / 2, STAGE_BAND.y + 40);

    const cards = advOverlayCards(this.state, this.script, this.ctx2);
    const rects = layoutCards(cards.length);
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      ctx.fillStyle = COLORS.cardBg;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = COLORS.cardEdge;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = COLORS.textTitle;
      ctx.font = `600 16px ${FONT_STACK}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(cards[i].label, r.x + 16, r.y + 34);
      ctx.fillStyle = COLORS.textDim;
      ctx.font = `400 12px ${FONT_STACK}`;
      ctx.fillText(cards[i].note, r.x + 16, r.y + 64);
    }
  }

  private drawEventDone(ctx: CanvasRenderingContext2D): void {
    const r = STAGE_BAND;
    ctx.fillStyle = 'rgba(6,9,14,0.72)';
    ctx.fillRect(0, r.y, r.w, r.h);
    ctx.fillStyle = COLORS.textTitle;
    ctx.font = `600 18px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('事件结果', r.x + r.w / 2, r.y + r.h / 2 - 16);
    ctx.fillStyle = '#7fd6a0';
    ctx.font = `500 15px ${FONT_STACK}`;
    const text = this.state.eventResult ?? '';
    ctx.fillText(text.length > 40 ? text.slice(0, 39) + '…' : text, r.x + r.w / 2, r.y + r.h / 2 + 14);
  }

  private drawTerminal(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = 'rgba(6,9,14,0.9)';
    ctx.fillRect(0, 0, PORTRAIT_LOGICAL_W, PORTRAIT_LOGICAL_H);
    ctx.fillStyle = this.state.phase === 'COMPLETE' ? '#7fd6a0' : COLORS.hpLow;
    ctx.font = `700 26px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.state.phase === 'COMPLETE' ? '冒险完成' : '冒险失败', PORTRAIT_LOGICAL_W / 2, 300);
    ctx.fillStyle = COLORS.textBody;
    ctx.font = `400 14px ${FONT_STACK}`;
    const sum = `战斗 ${this.state.battlesCompleted} 场 · 强化 ${this.state.buffs.length} 项 · 种子 ${this.script.seedLabel}`;
    ctx.fillText(sum, PORTRAIT_LOGICAL_W / 2, 340);
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
      seed: this.script.seed,
      seedLabel: this.script.seedLabel,
      eventPlan: this.script.eventPlan,
      overlayOpen: advOverlayOpen(this.state),
    };
  }

  /**
   * 调试自动步进（仅供 E2E / 真机计时用；不参与任何玩法规则）：
   *   - 浮层打开 → 选第一张卡；
   * - 主动作可用 → 按一次主动作；
   * - BATTLE / 战报冻结期 → 不操作（真实物理战斗由 requestAnimationFrame 自动推进）。
   * 返回当前 phase，便于调用方记录耗时。
   */
  debugStep(): string {
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
}
