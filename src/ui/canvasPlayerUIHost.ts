/**
 * F-WX-4｜CanvasPlayerUIHost：玩家 UI 的 Canvas 实现（同一 State/Action，不复制 Gameplay）。
 *
 * 完全复用 F-WX-3 的 PlayerUIState / PlayerUIActions / PlayerUIHost 边界：
 * - 只做：绘制 / 布局 / hit-test / 输入转 Action；
 * - 绝不决定：Reward / Inventory / Battle / Rating / Merge 规则（那些在 main.ts 的
 *   PlayerUIActions 实现里）；
 * - 输入唯一入口 = Platform Input Adapter（platform.input.bindPointer）。
 *
 * 覆盖正常玩家所需：Garage（Body/Wheel/Drive/功能件/库存锁定/合成/金币段位/寻找对手）、
 * Matching VS、MatchInfo、Battle HUD（HP/阶段/Warning 倒计时）、Result（Reward/Economy/
 * Onboard/下一场/调整配置/看广告）、READY 过渡。Web 用 ?canvasui=1 独立切换测试；
 * 微信入口后续可直接复用（传入 wx canvas + wx.onTouchStart 坐标）。
 *
 * 禁止：美术重做 / 动效 polish / Gameplay 规则修改。布局为功能性布局（同色板、纯矩形+文字）。
 */
import { platform } from '../platform';
import { registry } from '../core/content';
import {
  buildSnapshotFromDraft,
  editableSlots,
  slotLabel,
  EMPTY_SLOT,
  resolveDriveMode,
} from '../lab/buildEditorModel';
import { computeEnergy } from '../core/buildValidator';
import { starTierEnergy } from '../core/buildSnapshot';
import { getCount, canEquipPart, equippedDefIds, OFFICIAL_PARTS } from '../core/partInventory';
import { tierOf, TIER_LABEL, canAffordMerge, MERGE_COST_COIN } from '../core/playerProgress';
import { REWARD_AD_COIN_BONUS } from '../core/ads';
import { BODY_OPTIONS, WHEEL_OPTIONS, encodePartVal } from './playerUI';
import type {
  PlayerUIHost,
  PlayerUIState,
  PlayerUIHudFrame,
  PlayerUIActions,
} from './playerUI';

/** 逻辑布局基准（等比缩放适配实际画布；中心留白） */
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

export class CanvasPlayerUIHost implements PlayerUIHost {
  private actions: PlayerUIActions | null = null;
  private parent!: HTMLElement;
  private ctx!: CanvasRenderingContext2D;
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;
  private scale = 1;
  private ox = 0;
  private oy = 0;
  private hitAreas: HitArea[] = [];
  private lastState: PlayerUIState | null = null;
  private lastFrame: PlayerUIHudFrame | null = null;
  private dirty = true;

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
    // 输入唯一入口：Platform Input Adapter（F-WX-4）
    platform.input.bindPointer(this.canvas, (x, y) => this.handlePointer(x, y));
  }

  render(state: PlayerUIState): void {
    this.lastState = state;
    this.dirty = true;
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

  /** 测试钩子：当前命中区域（逻辑坐标，供 hit-test 断言） */
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
      // DEV Lab 继续 DOM；Canvas 不绘制且不挡指针
      this.canvas.style.pointerEvents = 'none';
      this.canvas.style.visibility = 'hidden';
      return;
    }
    this.canvas.style.pointerEvents = 'auto';
    this.canvas.style.visibility = 'visible';

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
    const w = Math.max(1, this.parent.clientWidth || BASE_W);
    const h = Math.max(1, this.parent.clientHeight || BASE_H);
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    if (w !== this.cssW || h !== this.cssH || dpr !== this.dpr) {
      this.cssW = w;
      this.cssH = h;
      this.dpr = dpr;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    this.scale = Math.min(w / BASE_W, h / BASE_H);
    this.ox = (w - BASE_W * this.scale) / 2;
    this.oy = (h - BASE_H * this.scale) / 2;
    this.ctx.setTransform(dpr * this.scale, 0, 0, dpr * this.scale, dpr * this.ox, dpr * this.oy);
  }

  private clear(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.restore();
  }

  // ---------- 基础绘制原语（逻辑坐标） ----------
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
    this.rect(0, 0, BASE_W, 56, 'rgba(8,10,14,0.82)');
    this.text(title, BASE_W / 2, 28, 18, C.title, 'center', 700);
  }

  private drawGarageDock(state: PlayerUIState): void {
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
    const body = registry.bodies.get(draft.bodyDefId);
    const chipDefs: Array<{ key: string; label: string; value: string }> = [
      { key: 'body', label: '车身', value: body?.name ?? draft.bodyDefId },
      { key: 'rearWheel', label: '后轮', value: WHEEL_OPTIONS.find((w) => String(draft.rearRadius) === w.v)?.t ?? String(draft.rearRadius) },
      { key: 'frontWheel', label: '前轮', value: WHEEL_OPTIONS.find((w) => String(draft.frontRadius) === w.v)?.t ?? String(draft.frontRadius) },
      { key: 'drive', label: '驱动', value: resolveDriveMode(draft.drive) === 'stationary' ? '停驻' : '前进' },
    ];
    if (body) {
      for (const hpId of editableSlots(body)) {
        const cur = draft.functionalSelections[hpId] ?? EMPTY_SLOT;
        const curStar = draft.functionalStars?.[hpId] ?? 1;
        chipDefs.push({
          key: hpId,
          label: slotLabel(hpId),
          value:
            cur === EMPTY_SLOT
              ? '空'
              : (registry.functionals.get(cur)?.name ?? cur) + (curStar >= 2 ? ' ★★' : ' ★'),
        });
      }
    }
    y = this.drawChips(y, chipDefs, state.garageSelected);

    // 第二层：当前选中槽的选项
    const garageSelected = state.garageSelected;
    if (garageSelected) {
      const selLabel =
        garageSelected === 'body' ? '车身'
          : garageSelected === 'rearWheel' ? '后轮'
            : garageSelected === 'frontWheel' ? '前轮'
              : garageSelected === 'drive' ? '驱动'
                : slotLabel(garageSelected);
      const opts: Array<{ v: string; t: string; meta: string; locked?: boolean }> = [];
      if (garageSelected === 'body') {
        for (const o of BODY_OPTIONS) opts.push({ v: o.v, t: o.t, meta: '' });
      } else if (garageSelected === 'rearWheel' || garageSelected === 'frontWheel') {
        for (const o of WHEEL_OPTIONS) opts.push({ v: o.v, t: o.t, meta: '' });
      } else if (garageSelected === 'drive') {
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
      const curVal =
        garageSelected === 'body' ? draft.bodyDefId
          : garageSelected === 'rearWheel' ? String(draft.rearRadius)
            : garageSelected === 'frontWheel' ? String(draft.frontRadius)
              : garageSelected === 'drive' ? resolveDriveMode(draft.drive)
                : encodePartVal(
                    draft.functionalSelections[garageSelected] ?? EMPTY_SLOT,
                    draft.functionalStars?.[garageSelected] ?? 1,
                  );
      this.text(`正在改「${selLabel}」`, 24, y + 12, 11, C.textDim);
      y += 22;
      let x = 24;
      for (const o of opts) {
        const w = 200;
        if (x + w > BASE_W - 24) { x = 24; y += 58; }
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
    for (const p of OFFICIAL_PARTS) available += Math.max(0, inv[p].one - (reserved.has(p) ? 1 : 0));
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

  private drawChips(
    y: number,
    defs: Array<{ key: string; label: string; value: string }>,
    selected: string | null,
  ): number {
    let x = 24;
    for (const def of defs) {
      const w = 168;
      if (x + w > BASE_W - 24) { x = 24; y += 58; }
      this.button(x, y, w, 50, `chip:${def.key}`, def.value, {
        sub: def.label,
        active: selected === def.key,
      });
      x += w + 10;
    }
    return y + 58;
  }

  private drawMatchingVs(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = 0.22;
    this.text('VS', BASE_W / 2, BASE_H / 2, 54, C.text, 'center', 900);
    ctx.restore();
  }

  private drawMatchInfo(opponent: { bodyName: string; parts: string[]; drive: '前进' | '停驻' } | null): void {
    const centerY = BASE_H / 2 - 20;
    this.text('我的战车', BASE_W * 0.3, centerY, 16, C.textDim, 'center');
    this.text('VS', BASE_W / 2, centerY, 56, C.gold, 'center', 900);
    this.text('对手', BASE_W * 0.7, centerY - 40, 16, C.textDim, 'center');
    if (opponent) {
      this.text(opponent.bodyName, BASE_W * 0.7, centerY + 6, 20, C.orange, 'center', 700);
      if (opponent.parts.length) {
        this.text(opponent.parts.join(' / '), BASE_W * 0.7, centerY + 32, 12, C.textDim, 'center');
      }
      // 驱动 pill（F-MOVE-1）
      const pillText = `驱动 · ${opponent.drive}`;
      const pillW = 130;
      this.rect(BASE_W * 0.7 - pillW / 2, centerY + 48, pillW, 26, 'rgba(59,111,212,0.16)', C.blue, 1);
      this.text(pillText, BASE_W * 0.7, centerY + 61, 13, C.driveBlue, 'center', 600);
    }
  }

  private drawMatchBar(): void {
    this.button(BASE_W / 2 - 240, BASE_H - 64, 200, 48, 'match-adjust', '调整配置');
    this.button(BASE_W / 2 + 40, BASE_H - 64, 200, 48, 'match-start', '开始战斗', { primary: true });
  }

  private drawHud(frame: PlayerUIHudFrame): void {
    const s = frame.battleStatus;
    if ((frame.battleState !== 'fighting' && frame.battleState !== 'ended') || !s) return;
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

  private drawResult(state: PlayerUIState): void {
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

  private drawReadyOverlay(): void {
    this.rect(0, 0, BASE_W, BASE_H, C.readyBg);
    this.text('READY', BASE_W / 2, BASE_H / 2 - 40, 15, C.textDim, 'center');
    this.text('开战！', BASE_W / 2, BASE_H / 2 + 14, 46, C.gold, 'center', 800);
  }
}
