/**
 * F-WX-4/F-WX-6｜CanvasPlayerUIHost：玩家 UI 的 Canvas 实现（同一 State/Action，不复制 Gameplay）。
 *
 * F-WX-6 手机横屏适配：
 * - 布局 Profile：Desktop（h≥600 大横屏）保持 1280×720 逻辑整体 fit（既有行为零回归）；
 *   Compact Mobile（800~950×360~450）进入独立「逻辑 px」布局（scale=1），
 *   Garage 重排（单行状态/两行 chip/横向滚动选项条/合成紧凑/CTA 常驻）、Result 自适应、
 *   触控命中高度 ≥40 CSS px（目标 44~48），Safe Area 避开刘海/圆角/系统边缘。
 * - State / Action / Gameplay 完全复用（不复制、不决定规则）；布局结构允许 Mobile 不同。
 *
 * 覆盖正常玩家所需：Garage（Body/Wheel/Drive/功能件/库存锁定/合成/金币段位/寻找对手）、
 * Matching VS、MatchInfo、Battle HUD（HP/阶段/Warning 倒计时）、Result（Reward/Economy/
 * Onboard/下一场/调整配置/看广告）、READY 过渡。
 *
 * 禁止：美术重做 / 动效 polish / Gameplay 规则修改。布局为功能性布局（同色板、纯矩形+文字）。
 */
import { platform } from '../platform';
import type { SafeInsets } from '../platform/types';
import { registry } from '../core/content';
import {
  buildSnapshotFromDraft,
  editableSlots,
  slotLabel,
  EMPTY_SLOT,
  resolveDriveMode,
  type BuildDraft,
} from '../lab/buildEditorModel';
import { computeEnergy } from '../core/buildValidator';
import { starTierEnergy } from '../core/buildSnapshot';
import { getCount, canEquipPart, equippedDefIds, OFFICIAL_PARTS } from '../core/partInventory';
import { tierOf, TIER_LABEL, canAffordMerge, MERGE_COST_COIN } from '../core/playerProgress';
import { REWARD_AD_COIN_BONUS } from '../core/ads';
import { BODY_OPTIONS, WHEEL_OPTIONS, encodePartVal } from './playerUI';
import { resolveLayoutProfile, TARGET_TOUCH_H, type LayoutProfile } from './layoutProfile';
import type {
  PlayerUIHost,
  PlayerUIState,
  PlayerUIHudFrame,
  PlayerUIActions,
} from './playerUI';

/** 逻辑布局基准（Desktop 等比缩放适配实际画布；中心留白） */
const BASE_W = 1280;
const BASE_H = 720;

/** 与 WebDOM 同源的色板（纯功能性绘制，无渐变/动效） */
const C = {
  bg: '#171c26',
  panel: '#242b38',
  panelHover: '#2e3747',
  border: '#38414f',
  borderActive: '#4a7fe0',
  blue: '#3b6fd4',
  blueBright: '#5a8df0',
  blueDeep: '#2a3a5c',
  gold: '#ffd35a',
  text: '#e8e8f0',
  textDim: '#9aa4b5',
  textDark: '#7c8799',
  red: '#ff6b5e',
  green: '#59c97a',
  orange: '#ff9d5a',
  dockBg: 'rgba(15,19,27,0.93)',
  overlayBg: 'rgba(4,6,10,0.78)',
  readyBg: 'rgba(6,8,12,0.35)',
  cardBg: '#1c2330',
  title: '#cdd6e6',
  onboardBg: '#15233a',
  onboardBorder: '#2f5fa0',
  onboardText: '#bcd4ff',
  driveBlue: '#cfe0ff',
  lockText: '#c98b5e',
  white: '#ffffff',
};

interface HitArea {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface GarageOpt {
  v: string;
  t: string;
  meta: string;
  locked?: boolean;
}

const ZERO_INSETS: SafeInsets = { left: 0, right: 0, top: 0, bottom: 0 };

export class CanvasPlayerUIHost implements PlayerUIHost {
  private actions: PlayerUIActions | null = null;
  private parent!: HTMLElement;
  private viewport: ReturnType<typeof platform.createViewport> | null = null;
  private ctx!: CanvasRenderingContext2D;
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;
  private scale = 1;
  private ox = 0;
  private oy = 0;
  private profile: LayoutProfile = { mode: 'desktop', baseW: BASE_W, baseH: BASE_H };
  private insets: SafeInsets = { ...ZERO_INSETS };
  private hitAreas: HitArea[] = [];
  private lastState: PlayerUIState | null = null;
  private lastFrame: PlayerUIHudFrame | null = null;
  private dirty = true;
  /** F-WX-6：功能件选项横向滚动偏移（仅 Mobile options strip） */
  private optScroll = 0;
  private optScrollFor: string | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {}

  setActions(actions: PlayerUIActions): void {
    this.actions = actions;
  }

  mount(parent: HTMLElement): void {
    this.parent = parent;
    // 覆盖主画布容器，位于战斗 canvas 之上；指针交给 hit-test
    const st = this.canvas.style;
    st.position = 'absolute';
    st.top = '0';
    st.left = '0';
    st.right = '0';
    st.bottom = '0';
    st.width = '100%';
    st.height = '100%';
    st.zIndex = '6';
    st.pointerEvents = 'auto';
    parent.appendChild(this.canvas);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D not supported');
    this.ctx = ctx;
    this.viewport = platform.createViewport(this.canvas);
    // 输入唯一入口：Platform Input Adapter（F-WX-4）
    platform.input.bindPointer(this.canvas, (x, y) => this.handlePointer(x, y));
  }

  /**
   * F-WX-5｜平台中立挂载（微信：无 DOM 容器）。
   * 不操作 style/appendChild；canvas 物理像素 → 逻辑尺寸 = canvas / surface.dpr；
   * 输入经 Platform Input Adapter（微信 = wx.onTouchStart）。
   */
  mountCanvas(): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D not supported');
    this.ctx = ctx;
    this.viewport = platform.createViewport(this.canvas);
    const s = this.viewport.surface();
    const dpr = s.devicePixelRatio || 1;
    this.cssW = Math.max(1, this.canvas.width / dpr);
    this.cssH = Math.max(1, this.canvas.height / dpr);
    this.dpr = dpr;
    platform.input.bindPointer(this.canvas, (x, y) => this.handlePointer(x, y));
  }

  render(state: PlayerUIState): void {
    this.lastState = state;
    this.dirty = true;
    // F-WX-6：切换选中槽时重置选项条横向滚动
    if (state.garageSelected !== this.optScrollFor) {
      this.optScrollFor = state.garageSelected;
      this.optScroll = 0;
    }
    this.draw();
  }

  renderBattleFrame(frame: PlayerUIHudFrame): void {
    this.lastFrame = frame;
    const state = this.lastState;
    const inBattle = !!state && (state.battleState === 'fighting' || state.battleState === 'ended');
    if (inBattle || this.dirty) {
      this.dirty = false;
      this.draw();
    }
    // 编辑态且无状态变化：画布已是当前 Garage/Matching/MatchPreview 画面，不重绘
  }

  /** 测试钩子：当前命中区域（布局坐标：Desktop=1280×720 逻辑；Mobile=逻辑 px/CSS px） */
  getHitAreasForTest(): ReadonlyArray<HitArea> {
    return this.hitAreas;
  }

  // ---------- 输入 → Action ----------
  private handlePointer(x: number, y: number): void {
    const lx = (x - this.ox) / this.scale;
    const ly = (y - this.oy) / this.scale;
    for (let i = this.hitAreas.length - 1; i >= 0; i--) {
      const a = this.hitAreas[i];
      if (lx >= a.x && lx <= a.x + a.w && ly >= a.y && ly <= a.y + a.h) {
        this.dispatch(a.id);
        return;
      }
    }
  }

  private dispatch(id: string): void {
    // F-WX-6：Mobile 功能件选项条横向滚动（内部状态，不派发 PlayerUIActions）
    if (id === 'opt-scroll-left' || id === 'opt-scroll-right') {
      this.optScroll += id === 'opt-scroll-left' ? -140 : 140;
      if (this.optScroll < 0) this.optScroll = 0;
      this.draw();
      return;
    }
    if (id.startsWith('chip:')) {
      this.actions?.onToggleGarageSlot(id.slice(5));
      return;
    }
    if (id.startsWith('opt:')) {
      this.actions?.onPickGarageOption(id.slice(4));
      return;
    }
    switch (id) {
      case 'cta-find':
        this.actions?.onFindOpponent();
        break;
      case 'merge':
        this.actions?.onMerge();
        break;
      case 'result-adjust':
        this.actions?.onResultAdjust();
        break;
      case 'result-next':
        this.actions?.onResultNext();
        break;
      case 'reward-ad':
        this.actions?.onClaimRewardAd();
        break;
      case 'match-adjust':
        this.actions?.onMatchAdjust();
        break;
      case 'match-start':
        this.actions?.onStartBattle();
        break;
      default:
        break;
    }
  }

  // ---------- 绘制 ----------
  private draw(): void {
    this.ensureSize();
    this.hitAreas = [];
    this.clear();
    const state = this.lastState;
    if (!state) return;
    if (state.uiMode === 'scenario') {
      // DEV Lab 继续 DOM；Canvas 不绘制且不挡指针（微信玩家版无 scenario，永不进入）
      const st = this.canvas.style;
      if (st) {
        st.pointerEvents = 'none';
        st.visibility = 'hidden';
      }
      return;
    }
    const st = this.canvas.style;
    if (st) {
      st.pointerEvents = 'auto';
      st.visibility = 'visible';
    }

    if (state.battleState === 'fighting' || state.battleState === 'ended') {
      if (this.lastFrame) this.drawHud(this.lastFrame);
      if (state.result) this.drawResult(state);
    } else {
      // 装配编辑态：玩家 Shell
      if (state.playerPhase === 'garage') {
        this.drawPlayerTop('我的战车');
        this.drawGarageDock(state);
      } else if (state.playerPhase === 'matching') {
        this.drawPlayerTop('正在寻找对手…');
        this.drawMatchingVs();
      } else if (state.playerPhase === 'matchPreview') {
        this.drawPlayerTop('对手已找到');
        this.drawMatchInfo(state.opponent);
        if (!state.matchBarHidden) this.drawMatchBar();
      }
    }
    if (state.readyOverlayVisible) this.drawReadyOverlay();
  }

  private ensureSize(): void {
    let w: number;
    let h: number;
    let dpr: number;
    if (this.parent) {
      // Web：随容器尺寸 + window.devicePixelRatio（CSS px 布局空间）
      w = Math.max(1, this.parent.clientWidth || BASE_W);
      h = Math.max(1, this.parent.clientHeight || BASE_H);
      dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    } else {
      // F-WX-5/6：平台中立挂载（微信）：canvas 物理像素 → 逻辑 px 布局空间（除以 surface dpr）
      const s = this.viewport?.surface();
      dpr = s?.devicePixelRatio || 1;
      w = Math.max(1, this.canvas.width / dpr);
      h = Math.max(1, this.canvas.height / dpr);
    }
    if (w !== this.cssW || h !== this.cssH || dpr !== this.dpr) {
      this.cssW = w;
      this.cssH = h;
      this.dpr = dpr;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    // F-WX-6：布局 Profile——Desktop 保持 1280×720 整体 fit；Compact Mobile 逻辑 px scale=1
    this.profile = resolveLayoutProfile(this.cssW, this.cssH);
    if (this.profile.mode === 'mobile') {
      this.scale = 1;
      this.ox = 0;
      this.oy = 0;
      this.insets = this.viewport?.safeInsets() ?? { ...ZERO_INSETS };
    } else {
      this.scale = Math.min(this.cssW / BASE_W, this.cssH / BASE_H);
      this.ox = (this.cssW - BASE_W * this.scale) / 2;
      this.oy = (this.cssH - BASE_H * this.scale) / 2;
      this.insets = { ...ZERO_INSETS };
    }
    this.ctx.setTransform(dpr * this.scale, 0, 0, dpr * this.scale, dpr * this.ox, dpr * this.oy);
  }

  private clear(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.restore();
  }

  // ---------- 布局坐标辅助（Desktop=1280×720 逻辑；Mobile=视口逻辑 px） ----------
  private get isMobile(): boolean {
    return this.profile.mode === 'mobile';
  }
  private get W(): number {
    return this.isMobile ? this.cssW : BASE_W;
  }
  private get H(): number {
    return this.isMobile ? this.cssH : BASE_H;
  }
  private get insL(): number {
    return this.isMobile ? this.insets.left : 0;
  }
  private get insR(): number {
    return this.isMobile ? this.insets.right : 0;
  }
  private get insT(): number {
    return this.isMobile ? this.insets.top : 0;
  }
  private get insB(): number {
    return this.isMobile ? this.insets.bottom : 0;
  }

  // ---------- 基础绘制原语（布局坐标） ----------
  private rect(x: number, y: number, w: number, h: number, fill?: string, stroke?: string, lw = 1): void {
    const ctx = this.ctx;
    const X = this.ox + x * this.scale;
    const Y = this.oy + y * this.scale;
    const W = w * this.scale;
    const H = h * this.scale;
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fillRect(X, Y, W, H);
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lw;
      ctx.strokeRect(X, Y, W, H);
    }
  }

  private text(
    s: string,
    x: number,
    y: number,
    size: number,
    color: string,
    align: CanvasTextAlign = 'left',
    weight = 400,
  ): void {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.font = `${weight} ${Math.max(8, size * this.scale)}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillText(s, this.ox + x * this.scale, this.oy + y * this.scale);
  }

  /** 绘制按钮并注册命中区（disabled 时仅绘制，不注册 hit） */
  private button(
    x: number,
    y: number,
    w: number,
    h: number,
    id: string,
    label: string,
    opts: { sub?: string; active?: boolean; locked?: boolean; disabled?: boolean; primary?: boolean } = {},
  ): void {
    const fill = opts.disabled
      ? '#262e3d'
      : opts.primary
        ? C.blue
        : opts.active
          ? C.blueDeep
          : C.panel;
    const stroke = opts.disabled
      ? C.border
      : opts.primary || opts.active
        ? C.blueBright
        : opts.locked
          ? C.lockText
          : C.border;
    const labelColor = opts.disabled ? C.textDark : C.text;
    this.rect(x, y, w, h, fill, stroke, opts.locked ? 1.5 : 1);
    if (opts.sub) {
      this.text(opts.sub, x + w / 2, y + h * 0.3, 12, opts.disabled ? C.textDark : C.textDim, 'center');
      this.text(label, x + w / 2, y + h * 0.66, 14, labelColor, 'center', 600);
    } else {
      this.text(label, x + w / 2, y + h / 2, 15, labelColor, 'center', 600);
    }
    if (!opts.disabled) this.hit(id, x, y, w, h);
  }

  private hit(id: string, x: number, y: number, w: number, h: number): void {
    this.hitAreas.push({ id, x, y, w, h });
  }

  // ---------- 分区绘制 ----------
  private drawPlayerTop(title: string): void {
    if (this.isMobile) {
      // F-WX-6：Mobile 顶部状态压缩为单行（避开顶部 safe inset）
      const x = this.insL;
      const y = this.insT;
      const w = this.W - this.insL - this.insR;
      this.rect(x, y, w, 40, 'rgba(8,10,14,0.82)');
      this.text(title, x + w / 2, y + 20, 16, C.title, 'center', 700);
      return;
    }
    this.rect(0, 0, BASE_W, 56, 'rgba(8,10,14,0.82)');
    this.text(title, BASE_W / 2, 28, 18, C.title, 'center', 700);
  }

  // ==================== Garage ====================

  private drawGarageDock(state: PlayerUIState): void {
    if (this.isMobile) {
      this.drawMobileGarageDock(state);
      return;
    }
    const draft = state.draft;
    if (!draft) return;
    const dockY = 410;
    this.rect(0, dockY, BASE_W, BASE_H - dockY, C.dockBg, C.border, 1);

    // 顶部状态条（金币 + 段位）
    const p = state.progress;
    const tier = tierOf(p.rating);
    this.text(`金币`, 24, dockY + 26, 13, C.textDim);
    this.text(`${p.coin}`, 24 + 34, dockY + 26, 15, C.gold, 'left', 700);
    this.text(` · ${TIER_LABEL[tier]}`, 24 + 34 + 74, dockY + 26, 13, C.textDim);
    this.text(`${p.rating}`, 24 + 34 + 74 + 92, dockY + 26, 15, C.gold, 'left', 700);

    // 首轮引导
    let y = dockY + 46;
    if (state.onboarding === 'pending') {
      this.rect(24, y, 800, 30, C.onboardBg, C.onboardBorder, 1);
      this.text('这是你的第一辆战车，点「寻找对手」开始第一场战斗', 36, y + 15, 13, C.onboardText);
      y += 38;
    }

    // 第一层：槽位 chip（车身/后轮/前轮/驱动/功能件）
    y = this.drawChips(y, this.garageChipDefs(draft), state.garageSelected);

    // 第二层：当前选中槽的选项
    const garageSelected = state.garageSelected;
    if (garageSelected) {
      const opts = this.garageOptions(state, garageSelected);
      const curVal = this.garageCurrentValue(draft, garageSelected);
      this.text(`正在改「${this.slotDisplayLabel(garageSelected)}」`, 24, y + 12, 11, C.textDim);
      y += 22;
      let x = 24;
      for (const o of opts) {
        const w = 200;
        if (x + w > BASE_W - 24) {
          x = 24;
          y += 58;
        }
        this.button(x, y, w, 50, `opt:${o.v}`, o.t, {
          sub: o.meta || undefined,
          active: o.v === curVal,
          locked: o.locked,
          disabled: !!o.locked,
        });
        x += w + 10;
      }
      y += 58;
    }

    // 底部行：能量 + 合成面板 + 寻找对手 CTA
    const body = registry.bodies.get(draft.bodyDefId);
    const snapshot = buildSnapshotFromDraft(draft, registry, 'customA');
    const energyRes = computeEnergy(snapshot, registry);
    const used = energyRes.error ? Number.NaN : energyRes.energy;
    const capacity = body?.energyCapacity ?? 0;
    const overload = Number.isFinite(used) && used > capacity;
    const bottomY = BASE_H - 46;
    this.text('能量', 24, bottomY - 8, 12, C.textDim);
    const barW = 220;
    const pct = Number.isFinite(used) ? Math.min(100, (used / Math.max(capacity, 1)) * 100) : 0;
    this.rect(74, bottomY - 14, barW, 10, '#232b38', C.border, 1);
    if (pct > 0) this.rect(74, bottomY - 14, barW * (pct / 100), 10, overload ? C.red : C.blue);
    this.text(
      Number.isFinite(used) ? `${used} / ${capacity}` : '? / ?',
      74 + barW + 10,
      bottomY - 9,
      12,
      overload ? C.red : C.text,
      'left',
      overload ? 700 : 400,
    );

    // 合成面板（Q22：Garage 内简易）
    const inv = state.inventory;
    const reserved = new Set(equippedDefIds(draft));
    let available = 0;
    for (const pp of OFFICIAL_PARTS) available += Math.max(0, inv[pp].one - (reserved.has(pp) ? 1 : 0));
    const canMergeParts = available >= 5;
    const canAfford = canAffordMerge(p.coin);
    this.text('合成 · 5 × 1★ → 1 × 随机 2★', 340, bottomY - 16, 13, C.text, 'left', 700);
    this.text(`可合成 1★ 副本：${available}（已装备各保留 1） · 消耗 ${MERGE_COST_COIN} 金币`, 340, bottomY + 2, 11, C.textDim);
    this.button(340, bottomY + 12, 120, 26, 'merge',
      !canMergeParts ? '副本不足' : !canAfford ? `金币不足（${p.coin}/${MERGE_COST_COIN}）` : '合成',
      { disabled: !(canMergeParts && canAfford) },
    );

    // CTA：寻找对手（主）
    if (!state.draftValid) {
      this.text(state.blockReason ?? '', BASE_W - 24 - 190, bottomY - 20, 12, C.red, 'right');
    }
    this.button(BASE_W - 24 - 190, bottomY - 12, 190, 44, 'cta-find', '寻找对手', {
      primary: true,
      disabled: !state.draftValid,
    });
  }

  /** F-WX-6：Mobile Garage——横向分区 + 紧凑两行 + 选项条，触控 ≥ TARGET_TOUCH_H */
  private drawMobileGarageDock(state: PlayerUIState): void {
    const draft = state.draft;
    if (!draft) return;
    const L = this.insL + 8;
    const R = this.W - this.insR - 8;
    const usableW = Math.max(120, R - L);
    const body = registry.bodies.get(draft.bodyDefId);
    const dockTop = this.insT + 46;
    const bottomH = TARGET_TOUCH_H;
    const bottomY = this.H - this.insB - 8 - bottomH;
    this.rect(L - 8, dockTop - 4, usableW + 16, bottomY + bottomH + 8 - dockTop, C.dockBg, C.border, 1);

    let y = dockTop + 6;

    // 1) 顶部状态压缩单行（金币 · 段位）
    const p = state.progress;
    const tier = tierOf(p.rating);
    this.text(`金币 ${p.coin}`, L, y + 13, 14, C.gold, 'left', 700);
    this.text(`段位 ${TIER_LABEL[tier]} ${p.rating}`, L + 116, y + 13, 13, C.textDim);
    y += 25;

    // 2) 首轮引导（单行，不挤占核心配车）
    if (state.onboarding === 'pending') {
      this.rect(L, y, usableW, 22, C.onboardBg, C.onboardBorder, 1);
      this.text('点「寻找对手」开始第一场战斗', L + 10, y + 11, 12, C.onboardText);
      y += 28;
    }

    // 3) 槽位 chip：两行（横向分区），每行高 TARGET_TOUCH_H
    const chipDefs = this.garageChipDefs(draft);
    const chipH = TARGET_TOUCH_H;
    const rowGap = 8;
    const perRow = 4;
    const chipGap = 8;
    const chipW = (usableW - (perRow - 1) * chipGap) / perRow;
    const chipsRows = Math.ceil(chipDefs.length / perRow);
    for (let i = 0; i < chipDefs.length; i++) {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      this.button(
        L + col * (chipW + chipGap),
        y + row * (chipH + rowGap),
        chipW,
        chipH,
        `chip:${chipDefs[i].key}`,
        chipDefs[i].value,
        { sub: chipDefs[i].label, active: state.garageSelected === chipDefs[i].key },
      );
    }
    y += chipsRows * (chipH + rowGap);

    // 4) 第二层选项条（横向滚动式；「寻找对手」恒可见不受影响）
    const garageSelected = state.garageSelected;
    if (garageSelected) {
      const opts = this.garageOptions(state, garageSelected);
      const curVal = this.garageCurrentValue(draft, garageSelected);
      const optH = TARGET_TOUCH_H;
      const optW = 170;
      this.text(`正在改「${this.slotDisplayLabel(garageSelected)}」`, L, y + 10, 11, C.textDim);
      y += 16;
      const arrowW = 44;
      const stripW = Math.max(80, usableW - arrowW * 2 - 16);
      const totalW = opts.length * (optW + 8) - 8;
      const maxScroll = Math.max(0, totalW - stripW);
      if (this.optScroll > maxScroll) this.optScroll = maxScroll;
      const canLeft = this.optScroll > 0;
      const canRight = this.optScroll < maxScroll;
      if (canLeft) this.button(L, y, arrowW, optH, 'opt-scroll-left', '‹');
      if (canRight) this.button(R - arrowW, y, arrowW, optH, 'opt-scroll-right', '›');
      const optLeft = canLeft ? L + arrowW + 8 : L;
      const optRight = canRight ? R - arrowW - 8 : R;
      // 选项绘制裁到条内（不覆盖箭头）；命中区只注册「完全可见」的选项——
      // 部分可见选项仅作可滚动提示（不拦截箭头点击、不超屏不可达）
      const stripW2 = Math.max(1, optRight - optLeft);
      const ctx = this.ctx;
      ctx.save();
      ctx.beginPath();
      ctx.rect(
        this.ox + optLeft * this.scale,
        this.oy + y * this.scale,
        stripW2 * this.scale,
        optH * this.scale,
      );
      ctx.clip();
      let x = optLeft - this.optScroll;
      for (const o of opts) {
        const x0 = x;
        const x1 = x0 + optW;
        const fully = x0 >= optLeft - 0.5 && x1 <= optRight + 0.5;
        if (fully) {
          this.button(x0, y, optW, optH, `opt:${o.v}`, o.t, {
            sub: o.meta || undefined,
            active: o.v === curVal,
            locked: o.locked,
            disabled: !!o.locked,
          });
        } else if (x1 > optLeft && x0 < optRight) {
          // 部分可见：只画不注册命中（半显边缘 = 可继续滚动）
          const fill = o.locked ? '#262e3d' : o.v === curVal ? C.blueDeep : C.panel;
          this.rect(x0, y, optW, optH, fill, o.locked ? C.lockText : C.border, 1);
          this.text(o.t, x0 + optW / 2, y + optH / 2, 15, o.locked ? C.textDark : C.text, 'center', 600);
        }
        x += optW + 8;
      }
      ctx.restore();
      y += optH + 6;
    }

    // 5) 底部行（常驻）：能量（压缩） + 合成（紧凑） + 寻找对手 CTA
    const snapshot = buildSnapshotFromDraft(draft, registry, 'customA');
    const energyRes = computeEnergy(snapshot, registry);
    const used = energyRes.error ? Number.NaN : energyRes.energy;
    const capacity = body?.energyCapacity ?? 0;
    const overload = Number.isFinite(used) && used > capacity;
    const midY = bottomY + bottomH / 2;
    this.text('能量', L, midY, 11, C.textDim);
    const eBarX = L + 30;
    const eBarW = Math.min(150, usableW * 0.28);
    const pct = Number.isFinite(used) ? Math.min(100, (used / Math.max(capacity, 1)) * 100) : 0;
    this.rect(eBarX, midY - 5, eBarW, 10, '#232b38', C.border, 1);
    if (pct > 0) this.rect(eBarX, midY - 5, eBarW * (pct / 100), 10, overload ? C.red : C.blue);

    const inv = state.inventory;
    const reserved = new Set(equippedDefIds(draft));
    let available = 0;
    for (const pp of OFFICIAL_PARTS) available += Math.max(0, inv[pp].one - (reserved.has(pp) ? 1 : 0));
    const canMergeParts = available >= 5;
    const canAfford = canAffordMerge(p.coin);
    const mergeX = Math.min(eBarX + eBarW + 12, L + usableW * 0.42);
    this.button(mergeX, bottomY, 108, bottomH, 'merge',
      !canMergeParts ? '合成×' : !canAfford ? `金币不足` : '合成',
      { disabled: !(canMergeParts && canAfford) },
    );
    if (canMergeParts && !canAfford) {
      this.text(`需 ${MERGE_COST_COIN} 金币`, mergeX + 108 + 6, midY, 10, C.textDim);
    }

    // CTA：寻找对手（右，常驻可见）
    const ctaW = Math.max(150, usableW * 0.24);
    this.button(R - ctaW, bottomY, ctaW, bottomH, 'cta-find', '寻找对手', {
      primary: true,
      disabled: !state.draftValid,
    });
    if (!state.draftValid && state.blockReason) {
      this.text(state.blockReason, R - ctaW, bottomY - 10, 11, C.red, 'right');
    }
  }

  /** 槽位 chip 定义（Desktop/Mobile 共用） */
  private garageChipDefs(draft: BuildDraft): Array<{ key: string; label: string; value: string }> {
    const body = registry.bodies.get(draft.bodyDefId);
    const defs: Array<{ key: string; label: string; value: string }> = [
      { key: 'body', label: '车身', value: body?.name ?? draft.bodyDefId },
      {
        key: 'rearWheel',
        label: '后轮',
        value: WHEEL_OPTIONS.find((w) => String(draft.rearRadius) === w.v)?.t ?? String(draft.rearRadius),
      },
      {
        key: 'frontWheel',
        label: '前轮',
        value: WHEEL_OPTIONS.find((w) => String(draft.frontRadius) === w.v)?.t ?? String(draft.frontRadius),
      },
      { key: 'drive', label: '驱动', value: resolveDriveMode(draft.drive) === 'stationary' ? '停驻' : '前进' },
    ];
    if (body) {
      for (const hpId of editableSlots(body)) {
        const cur = draft.functionalSelections[hpId] ?? EMPTY_SLOT;
        const curStar = draft.functionalStars?.[hpId] ?? 1;
        defs.push({
          key: hpId,
          label: slotLabel(hpId),
          value:
            cur === EMPTY_SLOT
              ? '空'
              : (registry.functionals.get(cur)?.name ?? cur) + (curStar >= 2 ? ' ★★' : ' ★'),
        });
      }
    }
    return defs;
  }

  /** 第二层选项（Desktop/Mobile 共用；含锁定态判定） */
  private garageOptions(state: PlayerUIState, slot: string): GarageOpt[] {
    const draft = state.draft;
    const opts: GarageOpt[] = [];
    if (!draft) return opts;
    if (slot === 'body') {
      for (const o of BODY_OPTIONS) opts.push({ v: o.v, t: o.t, meta: '' });
    } else if (slot === 'rearWheel' || slot === 'frontWheel') {
      for (const o of WHEEL_OPTIONS) opts.push({ v: o.v, t: o.t, meta: '' });
    } else if (slot === 'drive') {
      opts.push({ v: 'forward', t: '前进', meta: '轮子正常驱动' });
      opts.push({ v: 'stationary', t: '停驻', meta: '不主动移动·真实物理保留' });
    } else {
      opts.push({ v: EMPTY_SLOT, t: '空', meta: '空 · 0 能量' });
      const inv = state.inventory;
      for (const defId of OFFICIAL_PARTS) {
        const def = registry.functionals.get(defId);
        if (!def) continue;
        const cat = def.category === 'weapon' ? '武器' : def.category === 'gadget' ? '辅助' : def.category;
        for (const star of [1, 2]) {
          const count = getCount(inv, defId, star);
          const starStr = star >= 2 ? '★★' : '★';
          opts.push({
            v: encodePartVal(defId, star),
            t: `${def.name} ${starStr}`,
            meta: count > 0 ? `${cat} · ${starTierEnergy(def.energy, star)} 能量 · 拥有 ×${count}` : '未获得',
            locked: !canEquipPart(defId, star),
          });
        }
      }
    }
    return opts;
  }

  /** 当前槽位已选值（编码；Desktop/Mobile 共用） */
  private garageCurrentValue(draft: BuildDraft, slot: string): string {
    if (slot === 'body') return draft.bodyDefId;
    if (slot === 'rearWheel') return String(draft.rearRadius);
    if (slot === 'frontWheel') return String(draft.frontRadius);
    if (slot === 'drive') return resolveDriveMode(draft.drive);
    return encodePartVal(
      draft.functionalSelections[slot] ?? EMPTY_SLOT,
      draft.functionalStars?.[slot] ?? 1,
    );
  }

  /** 槽位展示名（Desktop/Mobile 共用） */
  private slotDisplayLabel(slot: string): string {
    if (slot === 'body') return '车身';
    if (slot === 'rearWheel') return '后轮';
    if (slot === 'frontWheel') return '前轮';
    if (slot === 'drive') return '驱动';
    return slotLabel(slot);
  }

  private drawChips(
    y: number,
    defs: Array<{ key: string; label: string; value: string }>,
    selected: string | null,
  ): number {
    let x = 24;
    for (const def of defs) {
      const w = 168;
      if (x + w > BASE_W - 24) {
        x = 24;
        y += 58;
      }
      this.button(x, y, w, 50, `chip:${def.key}`, def.value, {
        sub: def.label,
        active: selected === def.key,
      });
      x += w + 10;
    }
    return y + 58;
  }

  // ==================== Matching / MatchPreview ====================

  private drawMatchingVs(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = 0.22;
    this.text('VS', this.W / 2, this.H / 2, this.isMobile ? 40 : 54, C.text, 'center', 900);
    ctx.restore();
  }

  private drawMatchInfo(opponent: { bodyName: string; parts: string[]; drive: '前进' | '停驻' } | null): void {
    const centerY = this.H / 2 - 20;
    const myX = this.W * 0.3;
    const opX = this.W * 0.7;
    this.text('我的战车', myX, centerY, this.isMobile ? 13 : 16, C.textDim, 'center');
    this.text('VS', this.W / 2, centerY, this.isMobile ? 40 : 56, C.gold, 'center', 900);
    this.text('对手', opX, centerY - (this.isMobile ? 32 : 40), this.isMobile ? 13 : 16, C.textDim, 'center');
    if (opponent) {
      this.text(opponent.bodyName, opX, centerY + (this.isMobile ? 4 : 6), this.isMobile ? 16 : 20, C.orange, 'center', 700);
      if (opponent.parts.length) {
        this.text(opponent.parts.join(' / '), opX, centerY + (this.isMobile ? 26 : 32), this.isMobile ? 10 : 12, C.textDim, 'center');
      }
      const pillText = `驱动 · ${opponent.drive}`;
      const pillW = this.isMobile ? 110 : 130;
      const py = centerY + (this.isMobile ? 40 : 48);
      this.rect(opX - pillW / 2, py, pillW, 26, 'rgba(59,111,212,0.16)', C.blue, 1);
      this.text(pillText, opX, py + 13, this.isMobile ? 12 : 13, C.driveBlue, 'center', 600);
    }
  }

  private drawMatchBar(): void {
    const bw = this.isMobile ? Math.min(180, this.W * 0.32) : 200;
    const bh = this.isMobile ? TARGET_TOUCH_H : 48;
    const y = this.H - (this.isMobile ? this.insB + 12 : 64) - bh;
    this.button(this.W / 2 - bw - 8, y, bw, bh, 'match-adjust', '调整配置');
    this.button(this.W / 2 + 8, y, bw, bh, 'match-start', '开始战斗', { primary: true });
  }

  // ==================== Battle HUD ====================

  private drawHud(frame: PlayerUIHudFrame): void {
    const s = frame.battleStatus;
    if ((frame.battleState !== 'fighting' && frame.battleState !== 'ended') || !s) return;
    if (this.isMobile) {
      // F-WX-6：Mobile HUD 顶条（避开顶部 safe inset；HP 条等宽压缩；阶段居中）
      const top = this.insT + 4;
      const h = 10;
      const barBase = this.insL + 8;
      const barW = Math.max(64, (this.W - this.insL - this.insR - 64) * 0.32);
      this.text('A', barBase, top + 12, 13, C.blue, 'left', 700);
      const barAX = barBase + 16;
      const pctA = Math.max(0, Math.min(1, s.sideA.hp / Math.max(s.sideA.maxHp, 1))) * 100;
      this.rect(barAX, top, barW, h, '#232b38', C.border, 1);
      if (pctA > 0) this.rect(barAX, top, barW * (pctA / 100), h, C.blue);
      this.text(`${Math.round(s.sideA.hp)}`, barAX + barW + 6, top + 12, 12, C.text);

      const barBRight = this.W - this.insR - 8;
      this.text('B', barBRight, top + 12, 13, '#e08a2e', 'right', 700);
      const barBX = barBRight - 16 - barW;
      const pctB = Math.max(0, Math.min(1, s.sideB.hp / Math.max(s.sideB.maxHp, 1))) * 100;
      this.rect(barBX, top, barW, h, '#232b38', C.border, 1);
      if (pctB > 0) this.rect(barBX, top, barW * (pctB / 100), h, '#e08a2e');
      this.text(`${Math.round(s.sideB.hp)}`, barBX - 6, top + 12, 12, C.text, 'right');

      this.text(s.phase === 'End' ? '战斗结束' : '战斗中', this.W / 2, top + 12, 13, C.gold, 'center');
      if (frame.phaseCountdownText != null) {
        this.text(frame.phaseCountdownText, this.W / 2, top + 60, 34, C.red, 'center', 800);
      }
      return;
    }
    // A 左上
    this.text('A', 24, 26, 15, C.blue, 'left', 700);
    this.rect(44, 21, 170, 10, '#232b38', C.border, 1);
    const pctA = Math.max(0, Math.min(1, s.sideA.hp / Math.max(s.sideA.maxHp, 1))) * 100;
    if (pctA > 0) this.rect(44, 21, 170 * (pctA / 100), 10, C.blue);
    this.text(`${Math.round(s.sideA.hp)} / ${Math.round(s.sideA.maxHp)}`, 44 + 170 + 10, 26, 13, C.text);
    // B 右上
    this.text('B', BASE_W - 24, 26, 15, '#e08a2e', 'right', 700);
    this.rect(BASE_W - 24 - 170, 21, 170, 10, '#232b38', C.border, 1);
    const pctB = Math.max(0, Math.min(1, s.sideB.hp / Math.max(s.sideB.maxHp, 1))) * 100;
    if (pctB > 0) this.rect(BASE_W - 24 - 170, 21, 170 * (pctB / 100), 10, '#e08a2e');
    this.text(`${Math.round(s.sideB.hp)} / ${Math.round(s.sideB.maxHp)}`, BASE_W - 24 - 170 - 10, 26, 13, C.text, 'right');
    // 阶段文案
    this.text(s.phase === 'End' ? '战斗结束' : '战斗中', BASE_W / 2, 26, 14, C.gold, 'center');
    // Warning 倒计时
    if (frame.phaseCountdownText != null) {
      this.text(frame.phaseCountdownText, BASE_W / 2, 110, 44, C.red, 'center', 800);
    }
  }

  // ==================== Result ====================

  private drawResult(state: PlayerUIState): void {
    if (this.isMobile) {
      this.drawMobileResult(state);
      return;
    }
    this.rect(0, 0, BASE_W, BASE_H, C.overlayBg);
    const cardX = 430;
    const cardY = 150;
    const cardW = 420;
    const cardH = 430;
    this.rect(cardX, cardY, cardW, cardH, C.cardBg, C.border, 1);
    const r = state.result!;
    const isWin = r.winner === 'A';
    this.text(isWin ? '【胜利】' : '【失败】', BASE_W / 2, cardY + 44, 44, isWin ? C.green : C.red, 'center', 800);
    this.text(`我方剩余 HP：${Math.round(r.hpA)}`, BASE_W / 2, cardY + 84, 14, C.textDim, 'center');
    this.text(`对手剩余 HP：${Math.round(r.hpB)}`, BASE_W / 2, cardY + 106, 14, C.textDim, 'center');

    let y = cardY + 132;
    if (state.reward) {
      this.rect(cardX + 20, y, cardW - 40, 58, '#1c2230', C.border, 1);
      this.text('获得部件', BASE_W / 2, y + 16, 12, C.textDim, 'center');
      this.text(`${state.reward.name} ${state.reward.starStr}`, BASE_W / 2, y + 38, 22, C.gold, 'center', 700);
      this.text(state.reward.cat, BASE_W / 2, y + 52, 12, C.textDark, 'center');
      y += 66;
    }
    if (state.economy) {
      const coinSign = state.economy.coinDelta >= 0 ? '+' : '';
      const ratingSign = state.economy.ratingDelta >= 0 ? '+' : '';
      this.rect(cardX + 20, y, cardW - 40, 52, '#1c2230', C.border, 1);
      this.text(`本局金币 ${coinSign}${state.economy.coinDelta} · 段位 ${ratingSign}${state.economy.ratingDelta}（${state.economy.tierLabel} ${state.economy.rating}）`, BASE_W / 2, y + 18, 14, C.gold, 'center', 700);
      this.text(`当前金币 ${state.economy.coin}`, BASE_W / 2, y + 38, 12, C.textDim, 'center');
      y += 60;
    }
    if (state.resultOnboardingVisible) {
      this.text('获得新部件，可以回车库调整', BASE_W / 2, y + 12, 13, C.onboardText, 'center');
      y += 28;
    }
    // 按钮行
    const btnY = cardY + cardH - 56;
    let bx = cardX + 20;
    this.button(bx, btnY, 120, 40, 'result-adjust', '调整配置');
    bx += 130;
    this.button(bx, btnY, 120, 40, 'result-next', '下一场', { primary: true });
    if (state.rewardAdAvailable) {
      this.button(cardX + cardW - 20 - 170, btnY, 170, 40, 'reward-ad',
        state.rewardAdClaimed ? `已领 +${REWARD_AD_COIN_BONUS}` : `看广告领 ${REWARD_AD_COIN_BONUS} 金币`,
        { disabled: state.rewardAdClaimed });
    }
  }

  /** F-WX-6：Mobile Result——自适应高度卡片（按钮恒 ≥ TARGET_TOUCH_H、完整可点） */
  private drawMobileResult(state: PlayerUIState): void {
    this.rect(0, 0, this.W, this.H, C.overlayBg);
    const r = state.result!;
    const isWin = r.winner === 'A';
    const L = this.insL + 8;
    const R = this.W - this.insR - 8;
    const cardW = Math.min(460, R - L);
    const cardX = L + (R - L - cardW) / 2;
    let y = this.insT + 48 + 6;

    const titleH = 42;
    this.text(isWin ? '【胜利】' : '【失败】', this.W / 2, y + titleH / 2, 32, isWin ? C.green : C.red, 'center', 800);
    y += titleH;
    this.text(`我方 HP ${Math.round(r.hpA)} · 对手 HP ${Math.round(r.hpB)}`, this.W / 2, y + 12, 13, C.textDim, 'center');
    y += 24;

    if (state.reward) {
      this.rect(cardX, y, cardW, 44, '#1c2230', C.border, 1);
      this.text(`获得 ${state.reward.name} ${state.reward.starStr}`, this.W / 2, y + 22, 15, C.gold, 'center', 700);
      y += 52;
    }
    if (state.economy) {
      const coinSign = state.economy.coinDelta >= 0 ? '+' : '';
      const ratingSign = state.economy.ratingDelta >= 0 ? '+' : '';
      this.rect(cardX, y, cardW, 36, '#1c2230', C.border, 1);
      this.text(`金币 ${coinSign}${state.economy.coinDelta} · 段位 ${ratingSign}${state.economy.ratingDelta}（${state.economy.tierLabel} ${state.economy.rating}）`, this.W / 2, y + 18, 13, C.gold, 'center', 700);
      y += 44;
    }
    if (state.resultOnboardingVisible) {
      this.text('获得新部件，可以回车库调整', this.W / 2, y + 10, 12, C.onboardText, 'center');
      y += 22;
    }

    // 决策按钮行（恒 ≥ TARGET_TOUCH_H；广告可用时三列）
    const btnH = TARGET_TOUCH_H;
    const gap = 10;
    const by = y + 4;
    if (state.rewardAdAvailable) {
      const bw = (cardW - gap * 2) / 3;
      this.button(cardX, by, bw, btnH, 'result-adjust', '调整配置');
      this.button(cardX + bw + gap, by, bw, btnH, 'result-next', '下一场', { primary: true });
      this.button(
        cardX + 2 * (bw + gap),
        by,
        bw,
        btnH,
        'reward-ad',
        state.rewardAdClaimed ? `已领 +${REWARD_AD_COIN_BONUS}` : '看广告领币',
        { disabled: state.rewardAdClaimed },
      );
    } else {
      const bw = (cardW - gap) / 2;
      this.button(cardX, by, bw, btnH, 'result-adjust', '调整配置');
      this.button(cardX + bw + gap, by, bw, btnH, 'result-next', '下一场', { primary: true });
    }
  }

  private drawReadyOverlay(): void {
    this.rect(0, 0, this.W, this.H, C.readyBg);
    this.text('READY', this.W / 2, this.H / 2 - 40, this.isMobile ? 13 : 15, C.textDim, 'center');
    this.text('开战！', this.W / 2, this.H / 2 + 14, this.isMobile ? 36 : 46, C.gold, 'center', 800);
  }
}
