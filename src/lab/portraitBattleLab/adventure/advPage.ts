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
  advFormatLog,
  advOverlayCards,
  advOverlayOpen,
  advVisibleLog,
  chooseAdventureOption,
  createAdventureState,
  finishAdventureBattle,
  pressAdventureAction,
  syncAdventureBattle,
  type AdventureContext,
  type AdventureState,
} from './advState';
import { readArchive, recordRun, nextRunGoal, type AdvArchive, type AdvRunSummary } from './advArchive';

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

const STAGE_BAND: Rect = { x: 0, y: 96, w: PORTRAIT_LOGICAL_W, h: 470 };
const LOG_BAND: Rect = { x: 0, y: 566, w: PORTRAIT_LOGICAL_W, h: 178 };
const ACTION_BAND: Rect = { x: 0, y: 744, w: PORTRAIT_LOGICAL_W, h: 100 };
const ACTION_BTN: Rect = { x: 40, y: 756, w: 310, h: 68 };

function hit(r: Rect, p: { x: number; y: number }): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

function layoutOptionCards(count: number): Rect[] {
  const w = 330;
  const h = count <= 2 ? 116 : 96;
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

  private readonly loadout: RunPlayerLoadout;
  private readonly loadoutSource: string;
  private readonly ctx2: AdventureContext;
  private readonly script: AdventureScript;
  private state: AdventureState;

  /** 隔离测试档案（终态结算写入；不影响正式存档）。 */
  private archive: AdvArchive;
  private archived = false;

  private rafHandle = 0;
  private lastFrameMs = 0;
  private battle: RunBattleRuntime | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private readonly onWindowResize = (): void => this.render();

  constructor(root: HTMLElement, opts: AdvPageOptions) {
    this.root = root;
    this.loadout = opts.loadout;
    this.loadoutSource = opts.loadoutSource;
    this.ctx2 = advContextFromLoadout(this.loadout);
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
      const rects = layoutOptionCards(cards.length);
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

    // 终态 → 同种子重开（再来一局）：重置档案写入标记，使新一局终态可再次结算。
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
    const summary: AdvRunSummary = {
      seedLabel: this.script.seedLabel,
      won: s.phase === 'COMPLETE',
      dayReached: s.day,
      dayTotal: s.dayTotal,
      battlesCompleted: s.battlesCompleted,
      buffs: [...s.buffs],
      finalHp: advCarriedPlayerHp(s, this.ctx2),
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
    const stage = this.currentStage();
    const stageLabel = stage > 0 ? ` · 第${stage}阶段` : '';
    ctx.fillText(`随机冒险 · DAY ${this.state.day}/${this.state.dayTotal}${stageLabel}`, 16, 30);

    // 装备来源（如实展示：正式车库 / URL / 演示）
    ctx.fillStyle = COLORS.textDim;
    ctx.font = `400 10px ${FONT_STACK}`;
    ctx.fillText(`战车：${this.ctx2.vehicleLabel}（${this.loadoutSource}）`, 16, 46);

    // 耐久条
    const hpBar: Rect = { x: 16, y: 56, w: 280, h: 14 };
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
    ctx.fillText(`耐久 ${pct}%`, PORTRAIT_LOGICAL_W - 16, 63);

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

  private currentStage(): number {
    let s = 0;
    for (const b of this.script.bannerPlan) if (b.day <= this.state.day) s = Math.max(s, b.stage);
    return s;
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

    // 非战斗：居中叙事
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
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
    const node = advCurrentNode(this.state, this.script);
    if (node.kind === 'EVENT') this.drawEventChoiceOverlay(ctx, node);
    else this.drawBuildChoiceOverlay(ctx);
  }

  /** 事件选择浮层（R3：5 种主题色 + 图标 + 标题 + 描述 + 选项，一眼可区分）。 */
  private drawEventChoiceOverlay(ctx: CanvasRenderingContext2D, node: AdventureEventNode): void {
    const theme = EVENT_THEME[node.eventKind];
    const b = STAGE_BAND;
    ctx.fillStyle = '#0e131c';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = theme.accent;
    ctx.fillRect(b.x, b.y, b.w, 6);

    this.drawEventIcon(ctx, node.eventKind, b.x + 46, b.y + 62, 46, theme.accent);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = theme.accent;
    ctx.font = `600 13px ${FONT_STACK}`;
    ctx.fillText(theme.tag, b.x + 86, b.y + 48);
    ctx.fillStyle = COLORS.textTitle;
    ctx.font = `600 19px ${FONT_STACK}`;
    ctx.fillText(node.title, b.x + 86, b.y + 78);

    ctx.fillStyle = COLORS.textBody;
    ctx.font = `400 13px ${FONT_STACK}`;
    let dy = b.y + 116;
    for (const line of node.beat) {
      ctx.fillText(line, b.x + 20, dy);
      dy += 20;
    }

    const cards = advOverlayCards(this.state, this.script, this.ctx2);
    const rects = layoutOptionCards(cards.length);
    const fullHp = advCarriedPlayerHp(this.state, this.ctx2) >= this.ctx2.playerHpMax;
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      ctx.fillStyle = COLORS.cardBg;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = COLORS.textTitle;
      ctx.font = `600 16px ${FONT_STACK}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(cards[i].label, r.x + 16, r.y + 34);
      ctx.fillStyle = COLORS.textDim;
      ctx.font = `400 12px ${FONT_STACK}`;
      // 满耐久时，提示「维修类」选项收益有限（避免无效奖励观感，规则可见）。
      const note = this.optionNoteWithState(node, cards[i].id, fullHp);
      ctx.fillText(note, r.x + 16, r.y + 64);
    }
  }

  private optionNoteWithState(node: AdventureEventNode, optionId: string, fullHp: boolean): string {
    const base = node.options.find((o) => o.id === optionId)?.note ?? '';
    const eff = node.outcomes[optionId];
    if (fullHp && eff && (eff.kind === 'heal' || eff.kind === 'trade')) return `${base}（耐久已满，收益有限）`;
    return base;
  }

  /** 建造选择浮层（中性主题，强化在下一场战斗真实生效）。 */
  private drawBuildChoiceOverlay(ctx: CanvasRenderingContext2D): void {
    const b = STAGE_BAND;
    ctx.fillStyle = '#0e131c';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = COLORS.eventAccent;
    ctx.fillRect(b.x, b.y, b.w, 6);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.textTitle;
    ctx.font = `600 19px ${FONT_STACK}`;
    ctx.fillText('选择一项改装', b.x + 20, b.y + 44);
    ctx.fillStyle = COLORS.textDim;
    ctx.font = `400 13px ${FONT_STACK}`;
    ctx.fillText('强化会在下一场战斗真实生效', b.x + 20, b.y + 74);

    const cards = advOverlayCards(this.state, this.script, this.ctx2);
    const rects = layoutOptionCards(cards.length);
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      ctx.fillStyle = COLORS.cardBg;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = COLORS.cardEdge;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = COLORS.textTitle;
      ctx.font = `600 15px ${FONT_STACK}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(cards[i].label, r.x + 16, r.y + 32);
      ctx.fillStyle = COLORS.textDim;
      ctx.font = `400 11px ${FONT_STACK}`;
      this.wrapText(ctx, cards[i].note, r.x + 16, r.y + 56, r.w - 32, 15);
    }
  }

  private drawEventDone(ctx: CanvasRenderingContext2D): void {
    const b = STAGE_BAND;
    const node = advCurrentNode(this.state, this.script);
    const kind = node.kind === 'EVENT' ? node.eventKind : 'crate';
    const theme = EVENT_THEME[kind];
    ctx.fillStyle = 'rgba(6,9,14,0.76)';
    ctx.fillRect(0, b.y, b.w, b.h);
    ctx.fillStyle = theme.accent;
    ctx.fillRect(b.x, b.y, b.w, 6);

    this.drawEventIcon(ctx, kind, b.x + b.w / 2, b.y + 96, 54, theme.accent);

    ctx.fillStyle = theme.accent;
    ctx.font = `600 14px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('开 奖', b.x + b.w / 2, b.y + 158);

    ctx.fillStyle = COLORS.textTitle;
    ctx.font = `600 17px ${FONT_STACK}`;
    const text = this.state.eventResult ?? '';
    this.wrapText(ctx, text, b.x + b.w / 2, b.y + 200, b.w - 56, 25);

    ctx.fillStyle = '#7fd6a0';
    ctx.font = `500 13px ${FONT_STACK}`;
    ctx.fillText('▶ 按「继续」进入下一天', b.x + b.w / 2, b.y + b.h - 38);
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
    ctx.fillStyle = 'rgba(6,9,14,0.92)';
    ctx.fillRect(0, 0, PORTRAIT_LOGICAL_W, PORTRAIT_LOGICAL_H);
    ctx.fillStyle = won ? '#7fd6a0' : COLORS.hpLow;
    ctx.font = `700 26px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(won ? '冒险完成' : '冒险失败', PORTRAIT_LOGICAL_W / 2, 150);

    const hp = advCarriedPlayerHp(this.state, this.ctx2);
    const pct = Math.max(0, Math.min(100, Math.round((hp / this.ctx2.playerHpMax) * 100)));
    const lines = [
      `撑到第 ${this.state.day} / ${this.state.dayTotal} 天`,
      `击破 ${this.state.battlesCompleted} 场 · 强化 ${this.state.buffs.length} 项`,
      `终点耐久 ${pct}%`,
    ];
    ctx.fillStyle = COLORS.textBody;
    ctx.font = `400 14px ${FONT_STACK}`;
    let y = 200;
    for (const t of lines) {
      ctx.fillText(t, PORTRAIT_LOGICAL_W / 2, y);
      y += 26;
    }

    // 最终 Build
    ctx.fillStyle = COLORS.textDim;
    ctx.font = `500 12px ${FONT_STACK}`;
    ctx.fillText('本局 Build', PORTRAIT_LOGICAL_W / 2, y + 6);
    y += 30;
    const chips = this.state.buffs.map((b) => runBuildOptionById(b)?.label ?? b);
    ctx.font = `500 12px ${FONT_STACK}`;
    if (chips.length === 0) {
      ctx.fillStyle = COLORS.textDim;
      ctx.fillText('（无）', PORTRAIT_LOGICAL_W / 2, y);
      y += 22;
    } else {
      let bx = PORTRAIT_LOGICAL_W / 2 - Math.min(chips.length, 3) * 60;
      for (let i = 0; i < chips.length; i++) {
        const label = chips[i];
        const tw = ctx.measureText(label).width + 14;
        ctx.fillStyle = '#e6edf8';
        ctx.fillRect(bx, y, tw, 18);
        ctx.fillStyle = '#1b2432';
        ctx.fillText(label, bx + 7, y + 9);
        bx += tw + 8;
        if (i % 3 === 2) {
          bx = PORTRAIT_LOGICAL_W / 2 - 60;
          y += 24;
        }
      }
      y += 28;
    }

    // 隔离测试档案（真实数据，不影响正式存档）
    ctx.fillStyle = '#9fb3d6';
    ctx.font = `500 13px ${FONT_STACK}`;
    const best = this.archive.best;
    const bestLine = best
      ? `最佳：${best.battlesCompleted} 胜${best.won ? '（曾通关）' : ''} · 累计 ${this.archive.totals.runs} 局 / ${this.archive.totals.wins} 胜`
      : '测试档案：本局为首胜记录';
    ctx.fillText(bestLine, PORTRAIT_LOGICAL_W / 2, y + 6);
    y += 28;
    ctx.fillStyle = COLORS.textDim;
    ctx.font = `400 12px ${FONT_STACK}`;
    this.wrapText(ctx, nextRunGoal(this.archive), PORTRAIT_LOGICAL_W / 2, y, PORTRAIT_LOGICAL_W - 60, 18);

    ctx.fillStyle = '#7fd6a0';
    ctx.font = `500 13px ${FONT_STACK}`;
    ctx.fillText('▶ 按「再来一局」以同种子重开', PORTRAIT_LOGICAL_W / 2, PORTRAIT_LOGICAL_H - 130);
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

  /** 只读诊断：当前浮层各选项的因果种类（event/buff/build/none），供智能驱动择优。
   *  buff/trade 额外暴露 buildId：驱动可识别「强化已拥有」的 trade（付耐久却无收益），避免无谓损耗。 */
  diagnose(): unknown {
    const node = advCurrentNode(this.state, this.script);
    if (advEventChoiceOpen(this.state) && node.kind === 'EVENT') {
      return {
        kind: 'event',
        options: node.options.map((o) => {
          const eff = node.outcomes[o.id];
          return {
            id: o.id,
            effect: eff?.kind ?? 'none',
            buildId: eff && (eff.kind === 'buff' || eff.kind === 'trade') ? eff.buildId : null,
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
