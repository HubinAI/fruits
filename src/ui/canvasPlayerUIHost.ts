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
import { computeMobileGarageLayout, type Rect, type MobileGarageLayout } from './mobileGarageLayout';
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
import { resolveLayoutProfile, type LayoutProfile } from './layoutProfile';
import { computeHomeLayout } from './homeLayout';
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

/** F-META-1：Main Shell 局外页面（UI-only，不进 Gameplay 状态机） */
type MetaPage = 'home' | 'garage' | 'backpack' | 'more';

/**
 * F-META-6：设置偏好持久化 key（platform.storage，值 '1'/'0'）。
 * 仅保存 UI preference——当前 Runtime 无音效/震动设置接口，不得借此扩大战斗架构。
 */
const PREF_SOUND_KEY = 'pref.sound';
const PREF_VIBRATION_KEY = 'pref.vibration';

/** F-META-6：More 页未来功能入口（只做入口，不做业务；前三者统一弹「功能开发中」） */
const MORE_ENTRIES: Array<{ id: string; label: string; sub: string }> = [
  { id: 'more:task', label: '任务', sub: '敬请期待' },
  { id: 'more:shop', label: '商店', sub: '敬请期待' },
  { id: 'more:pass', label: '战令', sub: '敬请期待' },
  { id: 'more:settings', label: '设置', sub: '音效/震动' },
];

/**
 * F-HOME-3：首页车辆气泡 tips（20 条内置，写死）。
 * 作用：指引操作 / 介绍玩法 / 轻度趣味；每条一句话、简洁可读；
 * 点击首页车辆随机显示 1 条（轻量气泡，非 Modal，点别处关闭）。
 */
export const HOME_TIPS: string[] = [
  '点击「车库」可以重新组装你的战车',
  '不同武器的攻击方式完全不同',
  '轮子的高低会影响整车姿态',
  '驱动方式会影响接敌节奏',
  '近战车更依赖贴脸输出',
  '远程车更需要争取输出时间',
  '合理搭配武器和车身很重要',
  '车身越稳，越不容易被掀翻',
  '有些战斗输在结构，不一定输在数值',
  '试着换个轮子，也许效果完全不同',
  '调整配置后再打一局，可能就赢了',
  '宝箱能带来新的成长资源',
  '战令里会有赛季奖励',
  '排行榜会记录你的当前段位表现',
  '每辆车都有自己的战斗风格',
  '战斗开始后，观察对手的接敌方式',
  '车库是你变强的核心入口',
  '先保证能打，再考虑打得漂亮',
  '一套顺手的配置比盲目堆属性更重要',
  '你现在看到的是当前出战车辆',
];

/**
 * F-HOME-4：首页宝箱栏 4 槽基础状态占位（可领取 / 计时中 / 空槽）。
 * 只做状态表现（视觉 + 可交互入口），不做完整奖励逻辑——点击弹占位页。
 */
export const HOME_CHEST_STATES: Array<'claimable' | 'timing' | 'empty'> = [
  'claimable',
  'timing',
  'timing',
  'empty',
];

/**
 * F-META-UX2：合成前后库存快照 diff → 新 2★ 部件（2★ 数量恰好 +1 的 defId）。
 * 仅用于「合成成功」结果 Modal 文案；不参与任何规则（规则仍在 mergeWithCost / runtime）。
 */
function diffMergeGain(
  before: Record<string, { one: number; two: number }>,
  after: Record<string, { one: number; two: number }>,
): { defId: string; two: number } | null {
  for (const p of OFFICIAL_PARTS) {
    const b = Math.max(0, before[p]?.two ?? 0);
    const a = Math.max(0, after[p]?.two ?? 0);
    if (a > b) return { defId: p, two: a };
  }
  return null;
}

/**
 * F-META-4：通用 Modal Frame 规格（轻量 UI Foundation，不接具体业务逻辑）。
 * - 居中卡片：标题区 + 内容行 + 主按钮 + 可选次按钮 + 全屏遮罩（拦截底层点击）。
 * - 关闭后重绘恢复当前页面；按钮回调由调用方提供（最小 API，无全局 Modal Manager）。
 */
/** 奖励行色调（F-META-UX4：金币/段位独立行的 value 着色） */
type ModalTone = 'gold' | 'blue' | 'red' | 'green';

interface ModalSpec {
  title: string;
  body: string[];
  /** F-META-UX4：结构化奖励行（金币/段位等；label 左 + value 右，层级清晰，不再拼长句） */
  rewardRows?: Array<{ label: string; value: string; tone?: ModalTone }>;
  /** F-META-UX4：独立奖励卡（获得部件：名称 + 星级 + 当前数量） */
  partCard?: { name: string; starStr: string; count: number };
  /** F-UX-3C：奖励区内部的小型次级入口（如广告领币）——不再做第三个底部按钮 */
  adRow?: { label: string; disabled?: boolean; onPress?: () => void };
  primary: string;
  secondary?: string;
  /** F-META-UX2：主按钮禁用（不注册命中；如合成条件不满足时显示原因但不可执行） */
  primaryDisabled?: boolean;
  /** F-UX-2D：大尺寸档（Result 结算层）——占 viewport 70~80% 宽 / 60~75% 高（short 用满 safe） */
  large?: boolean;
  onPrimary?: () => void;
  onSecondary?: () => void;
}

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
  private profile: LayoutProfile = {
    mode: 'desktop',
    baseW: BASE_W,
    baseH: BASE_H,
    fontScale: 1,
    minTouchH: 48,
    targetTouchH: 52,
  };
  private insets: SafeInsets = { ...ZERO_INSETS };
  private hitAreas: HitArea[] = [];
  private lastState: PlayerUIState | null = null;
  private lastFrame: PlayerUIHudFrame | null = null;
  private dirty = true;
  /** F-WX-6：功能件选项横向滚动偏移（仅 Mobile options strip） */
  private optScroll = 0;
  private optScrollFor: string | null = null;
  /** F-WX-UI-1：装配面板视图（home 2×2 分类 / wheelPick 轮子二级 / weaponPick 武器位 / options 选项） */
  private panelView: 'home' | 'wheelPick' | 'weaponPick' | 'options' = 'home';
  /** F-META-1：Main Shell 当前 MetaPage（UI-only，由 Host 局部管理，不进 Gameplay 状态机）；F-HOME-1：默认 Home（正式首页） */
  private metaPage: MetaPage = 'home';
  /** F-META-6：More 页子视图（功能卡主页 / 设置子页；UI-only，不进 Gameplay） */
  private moreView: 'home' | 'settings' = 'home';
  /** F-META-6：音效开关（UI preference；Runtime 无音效设置接口 → 仅持久化，不接音频） */
  private soundOn = true;
  /** F-META-6：震动开关（预留；UI preference 持久化，不接平台震动 API） */
  private vibrationOn = true;
  /** F-META-3：Backpack 分类过滤（全部/武器/功能件；UI-only，不做复杂筛选） */
  private backpackFilter: 'all' | 'weapon' | 'gadget' = 'all';
  /** F-UX-2C：Backpack 2×2 卡片分页（每页 4 张；[上一页]/[下一页]；合成后仍停当前页） */
  private backpackPage = 0;
  /** F-HOME-3：首页车辆气泡 tips（点击车辆随机显示 1 条；null = 隐藏；轻量，非 Modal） */
  private vehicleTip: string | null = null;
  /** F-META-4：当前激活的 Modal（null = 无）；覆盖绘制 + 拦截底层点击，关闭恢复当前页 */
  private modal: ModalSpec | null = null;
  /** F-META-5：Result Modal 已弹出标志（防每帧重复弹出；result 清空时复位） */
  private resultModalShown = false;
  /** F-META-5：Result Modal 展示时的 rewardAdClaimed（广告领币后需刷新弹窗文案） */
  private resultAdClaimedShown = false;
  /** F-WX-UI-1：选项网格面板内垂直滚动（面板不溢出屏幕） */
  private panelScroll = 0;
  /**
   * F-META-UX2：合成前库存快照（确认合成时捕获）——onMerge 后 render 时 diff 出
   * 新 2★ 部件用于「合成成功」结果 Modal。仅 UI 呈现，不改任何合成规则。
   */
  private mergeSnapshot: Record<string, { one: number; two: number }> | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    // F-META-6：读取偏好（platform.storage 无存储环境静默降级为默认开；值 '0' = 关）
    this.soundOn = platform.storage.getItem(PREF_SOUND_KEY) !== '0';
    this.vibrationOn = platform.storage.getItem(PREF_VIBRATION_KEY) !== '0';
  }

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
    // F-WX-UI-1：装配面板视图同步——已选中槽位 → options；选完收起 → home
    if (state.garageSelected) {
      this.panelView = 'options';
    } else if (this.panelView === 'options') {
      this.panelView = 'home';
      this.panelScroll = 0;
    }
    // F-META-1：离开局外（进 Matching/Battle/Result）时复位 MetaPage——回 Garage 后默认回车库页
    if (state.playerPhase !== 'garage') this.metaPage = 'home'; // F-HOME-1：离开局外回 Home（正式首页）
    // F-HOME-3：离开局外同时复位车辆气泡 tips（回 Home 默认不显示）
    if (state.playerPhase !== 'garage') this.vehicleTip = null;
    // F-META-3：离开局外同时复位 Backpack 分类（回 Garage 默认全部）
    if (state.playerPhase !== 'garage') this.backpackFilter = 'all';
    // F-UX-2C：离开局外同时复位 Backpack 分页（回 Garage 默认第一页）
    if (state.playerPhase !== 'garage') this.backpackPage = 0;
    // F-META-6：离开局外同时复位 More 子视图（回 Garage 默认功能卡主页）
    if (state.playerPhase !== 'garage') this.moreView = 'home';
    // F-META-UX2：合成确认后（mergeSnapshot 非空）→ diff 出新 2★ → 弹「合成成功」结果 Modal
    // （合成失败则库存无变化 → 不弹；结果 Modal 关闭后仍停留 Backpack）
    if (this.mergeSnapshot && state.playerPhase === 'garage') {
      const snap = this.mergeSnapshot;
      this.mergeSnapshot = null;
      const gain = diffMergeGain(snap, state.inventory);
      if (gain) {
        const def = registry.functionals.get(gain.defId);
        this.showModal({
          title: '合成成功',
          body: [`获得 ${def?.name ?? gain.defId} ★★`, `库存 ${gain.two} · 金币 ${state.progress.coin}`],
          primary: '知道了',
        });
      }
    }
    // F-META-5：Result 状态 → 一次性弹出正式结算 Modal（奖励信息单弹窗集中；
    // 广告领币后 rewardAdClaimed 变化 → 刷新弹窗文案；result 清空 → 复位）
    if (state.result) {
      const claimed = !!state.rewardAdClaimed;
      if (!this.resultModalShown || this.resultAdClaimedShown !== claimed) {
        this.resultModalShown = true;
        this.resultAdClaimedShown = claimed;
        this.showResultModal(state);
      }
    } else {
      this.resultModalShown = false;
      this.resultAdClaimedShown = false;
    }
    this.draw();
  }

  renderBattleFrame(frame: PlayerUIHudFrame): void {
    this.lastFrame = frame;
    const state = this.lastState;
    const inBattle = !!state && (state.battleState === 'fighting' || state.battleState === 'ended');
    // F-HOME-2：Matching / MatchPreview 每帧强制重绘——匹配扫描动效（扫描线/脉冲）由
    // runtime.tick 每帧驱动（候选快切之间无状态事件，不重绘则动画冻结在「扫描对手中…」静态文字）
    const inMatching = !!state && (state.playerPhase === 'matching' || state.playerPhase === 'matchPreview');
    if (inBattle || inMatching || this.dirty) {
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
  /**
   * F-WX-P0-INPUT：Viewport Logical → Layout 的**唯一**转换点。
   * 输入 = viewport logical coordinates（PlatformInput 契约，x∈[0,cssW] y∈[0,cssH]）；
   * 输出 = 布局坐标（hitAreas 注册空间）。禁止各按钮自行修坐标。
   */
  private screenToLayoutPoint(x: number, y: number): { x: number; y: number } {
    return { x: (x - this.ox) / this.scale, y: (y - this.oy) / this.scale };
  }

  private handlePointer(x: number, y: number): void {
    const p = this.screenToLayoutPoint(x, y);
    const lx = p.x;
    const ly = p.y;
    for (let i = this.hitAreas.length - 1; i >= 0; i--) {
      const a = this.hitAreas[i];
      if (lx >= a.x && lx <= a.x + a.w && ly >= a.y && ly <= a.y + a.h) {
        if (typeof __WX_DEBUG__ !== 'undefined' && __WX_DEBUG__) {
          // eslint-disable-next-line no-console
          console.log('[WX-INPUT] ui', JSON.stringify({ cssW: this.cssW, cssH: this.cssH, profile: this.profile.mode, scale: this.scale, ox: this.ox, oy: this.oy, insets: this.insets }));
          // eslint-disable-next-line no-console
          console.log('[WX-INPUT] layout', JSON.stringify({ logicalX: +x.toFixed(2), logicalY: +y.toFixed(2), layoutX: +lx.toFixed(2), layoutY: +ly.toFixed(2) }));
          // eslint-disable-next-line no-console
          console.log('[WX-INPUT] hit', `HIT:${a.id}`, JSON.stringify({ x: a.x, y: a.y, w: a.w, h: a.h }));
        }
        this.dispatch(a.id);
        return;
      }
    }
    if (typeof __WX_DEBUG__ !== 'undefined' && __WX_DEBUG__) {
      // eslint-disable-next-line no-console
      console.log('[WX-INPUT] ui', JSON.stringify({ cssW: this.cssW, cssH: this.cssH, profile: this.profile.mode, scale: this.scale, ox: this.ox, oy: this.oy, insets: this.insets }));
      // eslint-disable-next-line no-console
      console.log('[WX-INPUT] layout', JSON.stringify({ logicalX: +x.toFixed(2), logicalY: +y.toFixed(2), layoutX: +lx.toFixed(2), layoutY: +ly.toFixed(2) }));
      // eslint-disable-next-line no-console
      console.log('[WX-INPUT] hit', 'MISS');
    }
  }

  private dispatch(id: string): void {
    // F-HOME-3：点击车辆之外任意按钮 → 关闭车辆气泡 tips（轻量：点别处即关闭）
    if (id !== 'home-vehicle') this.vehicleTip = null;
    // F-WX-6：Mobile 功能件选项条横向滚动（内部状态，不派发 PlayerUIActions）
    if (id === 'opt-scroll-left' || id === 'opt-scroll-right') {
      this.optScroll += id === 'opt-scroll-left' ? -140 : 140;
      if (this.optScroll < 0) this.optScroll = 0;
      this.draw();
      return;
    }
    if (id.startsWith('nav:')) {
      // F-META-1：Main Shell 导航切换（UI-only，不派发 Gameplay action；离开当前页复位面板态）
      // F-HOME-1：'nav:garage'（Backpack/More 的「返回车库」）→ 回 Home（正式首页）；'nav:home'（配置页返回）
      const page = id.slice(4) as MetaPage;
      this.metaPage = page === 'garage' ? 'home' : page;
      this.panelView = 'home';
      this.panelScroll = 0;
      this.moreView = 'home'; // F-META-6：离开 More 复位子视图（下次进入默认功能卡主页）
      this.draw();
      return;
    }
    if (id.startsWith('home-')) {
      // F-HOME-1：正式首页入口——车库进配置页；排行榜/战令/宝箱槽为占位（「功能开发中」，无假数据页）
      // F-HOME-3：点击车辆 → 随机显示 1 条气泡 tips（每次点击重新随机；轻量，非 Modal）
      if (id === 'home-garage') {
        this.metaPage = 'garage';
        this.draw();
        return;
      }
      if (id === 'home-vehicle') {
        this.vehicleTip = HOME_TIPS[Math.floor(Math.random() * HOME_TIPS.length)];
        this.draw();
        return;
      }
      // F-HOME-4：正式占位页（large Modal，结构先行）——个人信息/排行榜/战令/宝箱
      if (id === 'home-profile') {
        const tier = tierOf(this.lastState?.progress?.rating ?? 0);
        this.showModal({
          title: '个人信息',
          body: [
            `当前段位：${TIER_LABEL[tier]} ${this.lastState?.progress?.rating ?? 0}`,
            `金币：${this.lastState?.progress?.coin ?? 0}`,
            '更多信息敬请期待',
          ],
          large: true,
          primary: '知道了',
        });
        return;
      }
      if (id === 'home-rank') {
        const tier = tierOf(this.lastState?.progress?.rating ?? 0);
        this.showModal({
          title: '排行榜',
          body: [`当前段位：${TIER_LABEL[tier]} ${this.lastState?.progress?.rating ?? 0}`, '赛季排行榜敬请期待'],
          large: true,
          primary: '知道了',
        });
        return;
      }
      if (id === 'home-pass') {
        this.showModal({
          title: '战令',
          body: ['第 1 赛季 · 奖励敬请期待', '完成战斗可获得战令经验'],
          large: true,
          primary: '知道了',
        });
        return;
      }
      if (id.startsWith('home-chest-')) {
        this.showModal({
          title: '宝箱',
          body: ['宝箱功能开发中', '当前展示：可领取 / 计时中 / 空槽'],
          large: true,
          primary: '知道了',
        });
        return;
      }
      return;
    }
    if (id.startsWith('more:')) {
      // F-META-6：More 未来功能入口——任务/商店/战令统一弹「功能开发中」；设置进设置子页
      if (id === 'more:settings') {
        this.moreView = 'settings';
        this.draw();
      } else {
        const label = MORE_ENTRIES.find((e) => e.id === id)?.label ?? '';
        this.showModal({
          title: '功能开发中',
          body: [`「${label}」功能正在建设中`, '敬请期待后续版本'],
          primary: '知道了',
        });
      }
      return;
    }
    if (id === 'settings-back') {
      // F-META-6：设置子页返回（UI-only）
      this.moreView = 'home';
      this.draw();
      return;
    }
    if (id === 'settings-sound') {
      // F-META-6：音效开关（仅保存 UI preference，不接 Runtime 音频——当前无音效设置接口）
      this.soundOn = !this.soundOn;
      platform.storage.setItem(PREF_SOUND_KEY, this.soundOn ? '1' : '0');
      this.draw();
      return;
    }
    if (id === 'settings-vibration') {
      // F-META-6：震动开关（预留；仅保存 UI preference）
      this.vibrationOn = !this.vibrationOn;
      platform.storage.setItem(PREF_VIBRATION_KEY, this.vibrationOn ? '1' : '0');
      this.draw();
      return;
    }
    if (id.startsWith('bfilter:')) {
      // F-META-3：Backpack 分类过滤（全部/武器/功能件；复位列表分页到第一页）
      this.backpackFilter = id.slice(8) as 'all' | 'weapon' | 'gadget';
      this.backpackPage = 0;
      this.draw();
      return;
    }
    if (id === 'backpack-page-prev' || id === 'backpack-page-next') {
      // F-UX-2C：Backpack 分页（[上一页]/[下一页]；上限在 draw 内按 pageCount 钳制）
      this.backpackPage += id === 'backpack-page-prev' ? -1 : 1;
      if (this.backpackPage < 0) this.backpackPage = 0;
      this.draw();
      return;
    }
    if (id.startsWith('entry:')) {
      // F-WX-UI-1：车身/驱动一级入口 → 直接展开对应槽
      this.actions?.onToggleGarageSlot(id.slice(6));
      return;
    }
    if (id === 'entry-wheels') {
      // 轮子一级入口 → 面板内「前轮/后轮」二级选择（内部态，不派发 action）
      this.panelView = 'wheelPick';
      this.panelScroll = 0;
      this.draw();
      return;
    }
    if (id === 'entry-weapons') {
      // 武器一级入口 → 面板内武器位列表（内部态）
      this.panelView = 'weaponPick';
      this.panelScroll = 0;
      this.draw();
      return;
    }
    if (id.startsWith('wheel-side:')) {
      // 轮子二级：选前轮/后轮 → 展开该槽选项（'wheel-side:' 11 字符，用 endsWith 判定）
      this.actions?.onToggleGarageSlot(id.endsWith('front') ? 'frontWheel' : 'rearWheel');
      return;
    }
    if (id.startsWith('weapon-slot:')) {
      // 武器二级：选武器位 → 展开该位选项（'weapon-slot:' 12 字符）
      this.actions?.onToggleGarageSlot(id.slice(12));
      return;
    }
    if (id === 'panel-back') {
      // 面板返回：轮子/武器二级 → home；选项 → 收起选中槽（toggle 语义）
      if (this.panelView === 'wheelPick' || this.panelView === 'weaponPick') {
        this.panelView = 'home';
        this.panelScroll = 0;
        this.draw();
      } else {
        this.actions?.onToggleGarageSlot(this.lastState?.garageSelected ?? '');
      }
      return;
    }
    if (id === 'panel-scroll-up' || id === 'panel-scroll-down') {
      const step = Math.round(this.targetTouchH * 1.6);
      this.panelScroll += id === 'panel-scroll-up' ? -step : step;
      if (this.panelScroll < 0) this.panelScroll = 0;
      this.draw();
      return;
    }
    if (id === 'opt-close') {
      // F-WX-8-B：选项条收起（toggle 语义关闭当前选中槽）
      this.actions?.onToggleGarageSlot(this.lastState?.garageSelected ?? '');
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
      case 'modal-primary': {
        // F-META-4：主按钮——先取回调再关闭（关闭后重绘恢复当前页）
        const cb = this.modal?.onPrimary;
        this.closeModal();
        cb?.();
        break;
      }
      case 'modal-secondary': {
        const cb = this.modal?.onSecondary;
        this.closeModal();
        cb?.();
        break;
      }
      case 'modal-ad':
        // F-UX-3C：广告小型次级入口（奖励区内部）——不关闭 Modal，回调触发后由新 state 更新内容
        this.modal?.adRow?.onPress?.();
        break;
      case 'modal-veil':
        // 遮罩命中：拦截底层点击（无操作）
        break;
      case 'cta-find':
        this.actions?.onFindOpponent();
        break;
      case 'merge':
        // F-META-UX2：Mobile 合成用 Modal 展示规则（5×1★+金币+随机2★），确认才 onMerge；
        // Desktop 保持直接合成
        if (this.isMobile) {
          this.showMergeModal();
        } else {
          this.actions?.onMerge();
        }
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
    // F-HOME-P0-LAYER：首页背景下沉为 renderer underlay（背景层<车辆层<UI层）。
    // 仅「出局外 + metaPage=home」开启；车库/匹配/战斗各自保持背景（不覆盖车辆）。
    const homeScreen = state.uiMode !== 'scenario' && state.playerPhase === 'garage' && this.metaPage === 'home';
    this.actions?.setHomeBackdrop?.(homeScreen);
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
      // F-WX-8-C：Result 出现后 HUD 自动降级隐藏（结算 Modal 覆盖层独占画面）
      if (state.result) {
        // F-META-5：Mobile Result 走通用 Modal（render 触发 showResultModal）；Desktop 保留旧结算
        if (!this.isMobile) this.drawResult(state);
      } else {
        if (this.lastFrame) this.drawHud(this.lastFrame);
      }
    } else {
      // 装配编辑态：玩家 Shell
      if (state.playerPhase === 'garage') {
        // F-WX-UI-1：Mobile 中央三段式（顶栏信息收进 drawMobileGarageDock）；Desktop 用旧 Dock
        this.drawGarageDock(state);
      } else if (state.playerPhase === 'matching') {
        // F-META-UX3：Matching 连续画面（搜索中）
        // F-PREBATTLE-P0：Mobile 正式流程只保留连续页（drawMatchingContinuum 内含单一状态文字）；
        // 旧顶部状态条（drawPlayerTop）仅 Desktop/Test 保留，Mobile 不绘制（避免与连续页中央状态重复）。
        if (!this.isMobile) this.drawPlayerTop('正在寻找对手…');
        this.drawMatchingContinuum(state);
      } else if (state.playerPhase === 'matchPreview') {
        // F-META-UX3：同一画面（已锁定）——只变对手内容与状态，不改变布局锚点
        if (!this.isMobile) this.drawPlayerTop('对手已锁定');
        this.drawMatchingContinuum(state);
        // matchBar（调整配置/开始战斗 复核条）仅 Desktop/Test 显示；Mobile 正式流程不显示
        // （不新增确认按钮；Locked 后短暂停留由 runtime 直接自动 Battle）。
        if (!this.isMobile && !state.matchBarHidden) this.drawMatchBar();
      }
    }
    // F-PREBATTLE-P0：READY 过渡层（READY / 开战！）仅 Desktop/Test 显示；
    // Mobile 正式流程锁定后短暂停留直接自动 Battle，不叠加 READY/开战 覆盖层。
    if (state.readyOverlayVisible && !this.isMobile) this.drawReadyOverlay();
    // F-META-4：Modal 覆盖层（最后绘制 → 最上层；遮罩拦截底层点击）
    if (this.modal) this.drawModal(this.modal);
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
    // F-WX-MOBILE-RCA-1：mobile-short（logicalH<260）→ 更薄 TopBar/更紧凑触控/字体 ×0.8
    this.profile = resolveLayoutProfile(this.cssW, this.cssH);
    if (this.isMobile) {
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
    return this.profile.mode === 'desktop' ? false : true;
  }
  /** F-WX-MOBILE-RCA-1：short 档（logicalH<260）——更紧凑触控/字号/布局 */
  private get isShort(): boolean {
    return this.profile.mode === 'mobile-short';
  }
  /** 主触控目标最小高度（short 36 / normal 48；由 availableH 反推不足时以布局为准） */
  private get minTouchH(): number {
    return this.profile.minTouchH;
  }
  /** 主触控目标高度（short 40 / normal 52） */
  private get targetTouchH(): number {
    return this.profile.targetTouchH;
  }
  /** 字体 scale（short 0.8 / 其余 1.0）——统一经 text() 应用，禁止页面自行除 0.8 */
  private get fontScale(): number {
    return this.profile.fontScale;
  }
  /** F-HOME-2：表现层时钟（匹配扫描动效用；微信/Web 均可用，测试 stub 环境回落 Date.now） */
  private get nowMs(): number {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
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
    // F-WX-MOBILE-RCA-1：字体统一经 fontScale（mobile-short ×0.8）缩放，禁止页面自行除 0.8
    const fs = Math.max(8, size * this.fontScale * this.scale);
    ctx.fillStyle = color;
    ctx.font = `${weight} ${fs}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
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
    // F-WX-UI-1：Mobile 字号层级（主按钮 17 / 卡名 17 / 辅助 14）；Desktop 保持旧值（15/12）
    const labelFs = this.isMobile ? 17 : 15;
    const subFs = this.isMobile ? 14 : 12;
    if (opts.sub) {
      this.text(opts.sub, x + w / 2, y + h * 0.3, subFs, opts.disabled ? C.textDark : C.textDim, 'center');
      this.text(label, x + w / 2, y + h * 0.66, labelFs, labelColor, 'center', 600);
    } else {
      this.text(label, x + w / 2, y + h / 2, labelFs, labelColor, 'center', 600);
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
  /**
   * F-WX-UI-1：Mobile-first Garage——中央三段式（信息架构重做，非 PC 压缩）。
   * - 顶栏（≤42 逻辑 px，只信息）：金币 · 段位 · 能量；
   * - 左展示区（~55-57% 屏宽）：战车大预览（renderer previewSolo + framingRect fit 到本区）；
   * - 右装配面板（~40%）：2×2 主分类（车身/轮子/驱动/武器）→ 二级（轮子前/后、武器位）→
   *   部件选项卡（面板内滚动），面板不溢出屏幕；
   * - 面板下主 CTA「寻找对手」：唯一最大（220-300×56），距 safe bottom ≥16，不贴底。
   * 合成降级为面板内次级入口；首轮引导为 CTA 上方局部气泡。State/Action/Gameplay 复用。
   */
  /**
   * F-META-UX1：局外唯一框架（playerPhase=garage 时）——Garage 是唯一 Home：
   * 顶部轻量状态栏（金币/段位/能量，无大标题）+ 中央内容区（garage 装配面板 / backpack /
   * more）。无整行全局 Tab；背包/更多是装配区内次级入口，Backpack/More 顶部「← 返回车库」。
   * 进入 Matching/Battle/Result 后本 Shell 不绘制（draw() 分支保证）；回 Garage 默认回车库页。
   */
  private drawMobileGarageDock(state: PlayerUIState): void {
    const draft = state.draft;
    if (!draft) return;
    // F-HOME-1：正式首页（metaPage='home'）不画旧 topBar/配置布局——独立 Home 布局 + 背景
    if (this.metaPage === 'home') {
      this.drawHomePage(state);
      return;
    }
    // F-WX-UI-F1：唯一布局源——绘制 / HitArea / Preview Camera 全部读取同一份结果，
    // 禁止在此手算 topBar/vehicle/panel/cta 区域（几何规则见 computeMobileGarageLayout）
    // F-WX-MOBILE-RCA-1：布局只基于 logical viewport + profile（DPR 不参与）
    const layout = computeMobileGarageLayout(
      { w: this.W, h: this.H },
      { left: this.insL, right: this.insR, top: this.insT, bottom: this.insB },
      this.profile,
    );

    // 顶部轻量状态栏（金币/段位/能量；只信息，不放主要操作；F-META-UX1：无页面大标题）
    this.drawMobileTopBar(state, draft, layout.topBarRect);

    // 中央功能内容区（按 MetaPage 分派）
    if (this.metaPage === 'backpack') {
      this.drawBackpackPage(state, layout);
    } else if (this.metaPage === 'more') {
      this.drawMorePage(layout);
    } else {
      this.drawGarageMetaPage(state, draft, layout);
    }
  }

  /**
   * F-HOME-1：正式小游戏首页——只保留核心模块：
   * ① 顶部：个人信息（左）+ 宝箱栏 4 槽（右）；② 中上：当前组装车辆展示（renderer previewSolo）；
   * ③ 中部：寻找对手主按钮（全页最强视觉）；④ 底部：车库 / 排行榜 / 战令 三个辅助入口。
   * 背景 = renderer.drawHomeBackdrop（程序化 underlay，单一入口；正式背景资源后续注入，
   * 由 draw() 经 setHomeBackdrop 在「出局外 + metaPage=home」时开启，绘制于车辆之下）。
   * 背包/合成/更多/复杂配置不堆在首页。布局唯一源 = computeHomeLayout（Home 模式下
   * getPreviewFramingRect 同源）。
   */
  private drawHomePage(state: PlayerUIState): void {
    const draft = state.draft;
    if (!draft) return;
    const L = computeHomeLayout(
      { w: this.W, h: this.H },
      { left: this.insL, right: this.insR, top: this.insT, bottom: this.insB },
      this.profile,
    );
    // ① 顶部：个人信息（左：头像 + 段位 + 金币，可点 → 个人详情占位页）+ 宝箱栏（右，4 槽状态占位）
    const p = state.progress;
    const tier = tierOf(p.rating);
    const tb = L.topBarRect;
    // 头像（圆形）+ 段位徽章（F-HOME-4：正式个人信息入口，点击开详情占位页）
    const avR = this.isShort ? 11 : 15;
    const avCX = tb.x + avR + 3;
    const avCY = tb.y + tb.h / 2;
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.arc(this.ox + avCX * this.scale, this.oy + avCY * this.scale, avR * this.scale, 0, Math.PI * 2);
    ctx.fillStyle = C.blue;
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.font = `${Math.round((this.isShort ? 11 : 14) * this.fontScale * this.scale)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('我', this.ox + avCX * this.scale, this.oy + avCY * this.scale);
    ctx.restore();
    this.text(`${TIER_LABEL[tier]} ${p.rating}`, avCX + avR + 8, tb.y + tb.h / 2, this.isShort ? 13 : 15, C.gold, 'left', 700);
    this.text(`金币 ${p.coin}`, avCX + avR + 8 + (this.isShort ? 96 : 132), tb.y + tb.h / 2, this.isShort ? 11 : 14, C.textDim);
    // 个人信息点击区（头像 + 段位 + 金币整段）
    const profileW = avCX + avR + 8 + (this.isShort ? 96 : 132) + 70 - tb.x;
    this.hit('home-profile', tb.x, tb.y, profileW, tb.h);
    // 宝箱栏（皇室战争式槽位感：槽盖 + 状态表现——可领取 / 计时中 / 空槽）
    for (let i = 0; i < 4; i++) {
      const s = L.chestSlot(i);
      const st = HOME_CHEST_STATES[i];
      const bg = st === 'empty' ? 'rgba(20,26,38,0.55)' : st === 'claimable' ? 'rgba(96,74,24,0.4)' : 'rgba(30,40,58,0.6)';
      const border = st === 'claimable' ? C.gold : C.border;
      this.rect(s.x, s.y, s.w, s.h, bg, border, st === 'claimable' ? 1.5 : 1);
      // 槽盖（顶部小横条，宝箱槽位感）
      this.rect(s.x - 2, s.y - 3, s.w + 4, 4, 'rgba(210,220,240,0.4)');
      if (st === 'claimable') {
        this.text('可领', s.x + s.w / 2, s.y + s.h / 2 + 2, this.isShort ? 9 : 11, C.gold, 'center', 700);
      } else if (st === 'timing') {
        // 计时进度条 + 状态字
        this.rect(s.x + 3, s.y + s.h - 5, s.w - 6, 3, '#2a3345');
        this.rect(s.x + 3, s.y + s.h - 5, (s.w - 6) * 0.5, 3, C.driveBlue);
        this.text('计时', s.x + s.w / 2, s.y + s.h / 2 + 2, this.isShort ? 9 : 11, C.textDim, 'center');
      } else {
        this.text('空', s.x + s.w / 2, s.y + s.h / 2 + 2, this.isShort ? 9 : 11, C.textDark, 'center');
      }
      this.hit(`home-chest-${i}`, s.x, s.y, s.w, s.h);
    }
    // ② 中上：车辆展示台（车辆由 renderer previewSolo 画在 vehicleRect 内；台座给「展示」感）
    // F-HOME-3：车辆区可点（点击 → 随机气泡 tips）
    const v = L.vehicleRect;
    this.rect(v.x, v.y, v.w, v.h, 'rgba(10,14,22,0.35)', C.border, 1);
    this.hit('home-vehicle', v.x, v.y, v.w, v.h);
    // F-HOME-3：气泡 tips（轻量，非 Modal——只画一个小气泡 + 指向箭头，不拦截其它按钮）
    if (this.vehicleTip) {
      const tipW = Math.min(v.w - 16, 300);
      const tipH = this.isShort ? 32 : 40;
      const tipX = v.x + (v.w - tipW) / 2;
      const tipY = v.y + 6;
      this.rect(tipX, tipY, tipW, tipH, 'rgba(14,20,32,0.94)', C.gold, 1);
      this.text(this.vehicleTip, tipX + 10, tipY + tipH / 2, this.isShort ? 12 : 14, C.text, 'left');
      // 指向车辆的小箭头（气泡底部三角）
      const ctx = this.ctx;
      ctx.save();
      ctx.fillStyle = C.gold;
      ctx.beginPath();
      ctx.moveTo(this.ox + (tipX + tipW / 2 - 6) * this.scale, this.oy + (tipY + tipH) * this.scale);
      ctx.lineTo(this.ox + (tipX + tipW / 2 + 6) * this.scale, this.oy + (tipY + tipH) * this.scale);
      ctx.lineTo(this.ox + (tipX + tipW / 2) * this.scale, this.oy + (tipY + tipH + 6) * this.scale);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    // ③ 中部：寻找对手主按钮（全宽 primary，全页最强视觉焦点）
    this.button(L.ctaRect.x, L.ctaRect.y, L.ctaRect.w, L.ctaRect.h, 'cta-find', state.draftValid ? '寻找对手' : '配置不合法', {
      primary: true,
      disabled: !state.draftValid,
    });
    // ④ 底部：三个辅助入口（车库 / 排行榜 / 战令）——明显弱于主 CTA；F-HOME-4：图标 + 文字（正式入口感）
    const assists: Array<{ id: string; label: string; icon: string }> = [
      { id: 'home-garage', label: '车库', icon: '装' },
      { id: 'home-rank', label: '排行榜', icon: '榜' },
      { id: 'home-pass', label: '战令', icon: '令' },
    ];
    const gap = this.isShort ? 6 : 10;
    const aw = (L.assistRect.w - gap * (assists.length - 1)) / assists.length;
    for (let i = 0; i < assists.length; i++) {
      const a = assists[i];
      const ix = L.assistRect.x + i * (aw + gap);
      // 图标方块（左侧）
      const iw = this.isShort ? 20 : 26;
      const iy = L.assistRect.y + (L.assistRect.h - iw) / 2;
      this.rect(ix + 8, iy, iw, iw, C.panel, C.border, 1);
      this.text(a.icon, ix + 8 + iw / 2, iy + iw / 2, this.isShort ? 11 : 14, C.textDim, 'center', 700);
      this.button(ix, L.assistRect.y, aw, L.assistRect.h, a.id, a.label, {});
    }
  }

  /** F-META-1：garage MetaPage——车辆展示（renderer 画）+ 右侧装配面板 + 主 CTA */
  private drawGarageMetaPage(state: PlayerUIState, draft: BuildDraft, layout: MobileGarageLayout): void {
    const { panelRect, ctaRect } = layout;

    // 主 CTA（唯一最大）+ 首轮引导气泡 + 非法原因
    this.button(ctaRect.x, ctaRect.y, ctaRect.w, ctaRect.h, 'cta-find', state.draftValid ? '寻找对手' : '配置不合法', {
      primary: true,
      disabled: !state.draftValid,
    });
    if (!state.draftValid && state.blockReason) {
      this.text(state.blockReason, ctaRect.x, ctaRect.y - 8, 14, C.red, 'right', 600);
    } else if (state.onboarding === 'pending') {
      // 首轮引导：CTA 上方局部气泡（不横贯屏幕）
      const bw = Math.min(240, ctaRect.w - 20);
      this.rect(ctaRect.x + ctaRect.w - bw - 10, ctaRect.y - 30, bw, 22, C.onboardBg, C.onboardBorder, 1);
      this.text('准备好了，去找个对手', ctaRect.x + ctaRect.w - 16, ctaRect.y - 17, 14, C.onboardText, 'right');
    }

    // 装配面板（右侧中央；绘制与 HitArea 均基于 panelRect；F-META-2：Garage 无合成，
    // 只处理配置——选中槽选项 / 轮子二级 / 武器二级 / 2×2 主分类）
    this.rect(panelRect.x, panelRect.y, panelRect.w, panelRect.h, C.dockBg, C.border, 1);
    // F-UX-3A：背包/更多已移到顶栏最右小按钮（drawMobileTopBar），配置区独占整个面板；
    // 内容区由 availableH 反推（F-WX-MOBILE-RCA-1：short 更紧凑）
    const padY = this.isShort ? 6 : 10;
    const py = panelRect.y + padY;
    const pH = Math.max(1, panelRect.h - 2 * padY);
    if (state.garageSelected) {
      this.drawGaragePanelOptions(state, draft, panelRect.x, panelRect.w, py, pH);
    } else if (this.panelView === 'wheelPick') {
      this.drawGaragePanelWheelPick(draft, panelRect.x, panelRect.w, py, pH);
    } else if (this.panelView === 'weaponPick') {
      this.drawGaragePanelWeaponPick(draft, panelRect.x, panelRect.w, py, pH);
    } else {
      this.drawGaragePanelHome(panelRect.x, panelRect.w, py, pH);
    }
  }

  /**
   * F-META-1/2/3 + F-META-UX1 + F-UX-2C：backpack MetaPage——「已获得部件」唯一管理页：
   * 分类（全部/武器/功能件）+ 库存 **2×2 部件卡分页**（每页 4 张：名称/星级×数量/装备态，
   * 未拥有不占列表；[上一页] 1/N [下一页] 分页，无 ▲▼ 滚动）+ 合成（5合1 完整迁入；
   * 确认才 onMerge，规则复用 mergeWithCost，不重写）。
   * F-META-UX1：顶部唯一「← 返回车库」；F-UX-2C：合成后仍停留 Backpack 当前页。
   */
  private drawBackpackPage(state: PlayerUIState, layout: MobileGarageLayout): void {
    const draft = state.draft;
    const c = layout.contentRect;
    this.rect(c.x, c.y, c.w, c.h, C.dockBg, C.border, 1);
    // F-META-UX1：顶部「← 返回车库」（唯一返回入口，禁止恢复全局 Tab）
    this.button(c.x + 12, c.y + 6, 96, this.minTouchH, 'nav:garage', '‹ 返回车库', {});
    this.text('背包', c.x + 120, c.y + 30, 20, C.text, 'left', 700);
    // 分类 tabs：全部 / 武器 / 功能件（简单分类，不做复杂筛选系统；位于返回行下方）
    // F-WX-MOBILE-RCA-1：short 档更紧凑（tabH 30 / 偏移随返回按钮高 / gaps 4）
    const tabH = this.isShort ? 30 : 44;
    const tabGap = 8;
    const tabTop = c.y + 6 + this.minTouchH + (this.isShort ? 4 : 8);
    const tabs: Array<{ id: string; label: string; v: 'all' | 'weapon' | 'gadget' }> = [
      { id: 'bfilter:all', label: '全部', v: 'all' },
      { id: 'bfilter:weapon', label: '武器', v: 'weapon' },
      { id: 'bfilter:gadget', label: '功能件', v: 'gadget' },
    ];
    const tabW = (c.w - 24 - tabGap * (tabs.length - 1)) / tabs.length;
    let tx = c.x + 12;
    for (const t of tabs) {
      this.button(tx, tabTop, tabW, tabH, t.id, t.label, { active: this.backpackFilter === t.v });
      tx += tabW + tabGap;
    }
    // 库存（已拥有 = one/two > 0 或 已装备；未拥有不占列表）
    const inv = state.inventory;
    const equipped = new Set(equippedDefIds(draft));
    const items: Array<{ defId: string; name: string; star: string; equipped: boolean }> = [];
    for (const pp of OFFICIAL_PARTS) {
      const one = Math.max(0, inv[pp].one);
      const two = Math.max(0, inv[pp].two);
      const eq = equipped.has(pp);
      if (one === 0 && two === 0 && !eq) continue; // 未拥有不占主列表
      const def = registry.functionals.get(pp);
      const cat = def?.category;
      if (this.backpackFilter === 'weapon' && cat !== 'weapon') continue;
      if (this.backpackFilter === 'gadget' && cat !== 'gadget') continue;
      const star = [one > 0 ? `★×${one}` : '', two > 0 ? `★★×${two}` : ''].filter(Boolean).join(' ');
      items.push({ defId: pp, name: def?.name ?? pp, star, equipped: eq });
    }
    // 底部行：合成按钮（左）+ 分页控件（右，多于 4 项时）
    const mergeH = this.isShort ? 32 : Math.max(this.minTouchH, 48);
    const mergeY = c.y + c.h - mergeH - (this.isShort ? 4 : 8);
    this.button(c.x + 12, mergeY, Math.min(140, c.w * 0.4), mergeH, 'merge', '合成', { sub: '更多' });
    // F-UX-2C：2×2 部件卡分页（每页 4 张；[上一页] 1/N [下一页]，无 ▲▼ 滚动）
    const PAGE_SIZE = 4;
    const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    if (this.backpackPage >= pageCount) this.backpackPage = pageCount - 1;
    if (this.backpackPage < 0) this.backpackPage = 0;
    const listTop = tabTop + tabH + (this.isShort ? 4 : 6);
    const listBot = mergeY - (this.isShort ? 4 : 6);
    const viewH = Math.max(8, listBot - listTop);
    const gap = 8;
    const cardW = Math.floor((c.w - 24 - gap) / 2);
    const cardH = Math.max(8, Math.floor((viewH - gap) / 2));
    const pageItems = items.slice(this.backpackPage * PAGE_SIZE, this.backpackPage * PAGE_SIZE + PAGE_SIZE);
    for (let i = 0; i < pageItems.length; i++) {
      const it = pageItems[i];
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = c.x + 12 + col * (cardW + gap);
      const y = listTop + row * (cardH + gap);
      this.rect(x, y, cardW, cardH, it.equipped ? C.blueDeep : C.panel, C.border, 1);
      this.text(it.name, x + 10, y + cardH * 0.32, this.isShort ? 13 : 15, C.text, 'left', 600);
      this.text(it.star, x + cardW - 10, y + cardH * 0.32, this.isShort ? 12 : 13, C.gold, 'right');
      if (it.equipped) {
        this.text('已装备', x + cardW - 10, y + cardH * 0.78, this.isShort ? 11 : 12, C.blue, 'right', 700);
      }
      // 只读命中区（供测试断言列表项；dispatch 对 bpack-item: 无操作）
      this.hit(`bpack-item:${it.defId}`, x, y, cardW, cardH);
    }
    if (items.length === 0) this.text('该分类暂无部件', c.x + 12, listTop + 30, 14, C.textDim);
    // 分页条（右对齐；与合成按钮同一底部行，不额外占高）
    if (pageCount > 1) {
      const pgH = Math.min(mergeH, 28);
      const pgY = mergeY + (mergeH - pgH) / 2;
      const nextX = c.x + c.w - 12 - 56;
      const prevX = nextX - 56 - 8 - 44; // 页码文字区 ~44
      this.button(prevX, pgY, 56, pgH, 'backpack-page-prev', '上一页', {});
      this.text(`${this.backpackPage + 1} / ${pageCount}`, prevX + 56 + 4, pgY + pgH / 2, 13, C.textDim, 'left');
      this.button(nextX, pgY, 56, pgH, 'backpack-page-next', '下一页', {});
    }
  }

  /**
   * F-META-6 + F-META-UX1：more MetaPage——未来功能入口预留（只做入口，不做业务）：
   * - 主页：2×2 功能卡（任务/商店/战令/设置；前三者统一弹「功能开发中」Modal）+ 顶部
   *   「← 返回车库」（无全局 Tab）；
   * - 设置子页：音效/震动开关（仅保存 UI preference，不扩大战斗架构）。
   * 所有预留入口集中在 More，不散落到 Garage/Backpack。
   */
  private drawMorePage(layout: MobileGarageLayout): void {
    const c = layout.contentRect;
    this.rect(c.x, c.y, c.w, c.h, C.dockBg, C.border, 1);
    if (this.moreView === 'settings') {
      this.drawMoreSettings(c);
      return;
    }
    // F-META-UX1：顶部「← 返回车库」（唯一返回入口，禁止恢复全局 Tab）
    this.button(c.x + 12, c.y + 6, 96, this.minTouchH, 'nav:garage', '‹ 返回车库', {});
    this.text('更多', c.x + 120, c.y + 30, 20, C.text, 'left', 700);
    this.drawMoreEntries(c);
  }

  /** F-META-6：More 主页——2×2 功能卡（填充内容区；只注册入口命中；
   *  F-WX-MOBILE-RCA-1：short 档 cardH 由 availableH 反推，normal ≥48） */
  private drawMoreEntries(c: Rect): void {
    const pad = 12;
    const gap = 10;
    const areaTop = c.y + 6 + this.minTouchH + (this.isShort ? 6 : 8); // 顶部「← 返回车库」行下方
    const areaH = Math.max(0, c.y + c.h - areaTop - pad);
    const cardW = Math.floor((c.w - pad * 2 - gap) / 2);
    const cardH = this.isShort
      ? Math.max(8, Math.floor((areaH - gap) / 2))
      : Math.max(this.minTouchH, Math.floor((areaH - gap) / 2));
    for (let i = 0; i < MORE_ENTRIES.length; i++) {
      const e = MORE_ENTRIES[i];
      const col = i % 2;
      const row = Math.floor(i / 2);
      this.button(c.x + pad + col * (cardW + gap), areaTop + row * (cardH + gap), cardW, cardH, e.id, e.label, {
        sub: e.sub,
      });
    }
  }

  /** F-META-6：More 设置子页——返回 + 音效/震动开关行（整行可点 ≥48；右侧开关指示） */
  private drawMoreSettings(c: Rect): void {
    // 返回按钮（左上；标题「设置」同行右侧）
    this.button(c.x + 12, c.y + 6, 96, this.minTouchH, 'settings-back', '‹ 返回', {});
    this.text('设置', c.x + 120, c.y + 30, 20, C.text, 'left', 700);
    const rows: Array<{ id: string; label: string; sub: string; on: boolean }> = [
      { id: 'settings-sound', label: '音效', sub: '战斗与界面音效', on: this.soundOn },
      { id: 'settings-vibration', label: '震动', sub: '战斗震动（预留）', on: this.vibrationOn },
    ];
    const rowX = c.x + 12;
    const rowW = c.w - 24;
    const rowH = this.targetTouchH;
    const rowGap = 10;
    let y = c.y + 6 + this.minTouchH + 12;
    for (const r of rows) {
      this.rect(rowX, y, rowW, rowH, C.panel, C.border, 1);
      this.text(r.label, rowX + 12, y + rowH / 2 - 8, 17, C.text, 'left', 600);
      this.text(r.sub, rowX + 12, y + rowH / 2 + 12, 14, C.textDim, 'left');
      // 右侧开关指示（命中整行：触控 ≥52；active = 开）
      const swW = 56;
      const swH = 30;
      const swX = rowX + rowW - swW - 12;
      const swY = y + (rowH - swH) / 2;
      this.rect(swX, swY, swW, swH, r.on ? C.blue : C.border, C.blueBright, 1);
      this.text(r.on ? '开' : '关', swX + swW / 2, swY + swH / 2, 14, r.on ? C.white : C.textDim, 'center', 600);
      this.hit(r.id, rowX, y, rowW, rowH);
      y += rowH + rowGap;
    }
  }

  /**
   * 顶栏：金币 · 段位 · 能量（单行 ≤42 高，只信息；F-META-UX1：无页面大标题；
   * 区域来自唯一布局源 topBarRect）。
   * F-UX-3A：Garage 页顶栏最右两个很小的次级入口 [背包][更多]（不占配置区行、
   * 明显弱于配置与 CTA）；Backpack/More 页顶栏不显示（它们有「← 返回车库」）。
   */
  private drawMobileTopBar(state: PlayerUIState, draft: BuildDraft, topBarRect: Rect): void {
    const p = state.progress;
    const tier = tierOf(p.rating);
    const body = registry.bodies.get(draft.bodyDefId);
    const x0 = topBarRect.x;
    const w = topBarRect.w;
    const uT = topBarRect.y;
    const topH = topBarRect.h;
    this.rect(x0 - 4, uT, w + 8, topH, 'rgba(8,10,14,0.72)', C.border, 1);
    // F-HOME-1：配置页（garage）顶部最左「‹ 首页」返回小按钮；金币/段位右移让位
    const homeW = this.metaPage === 'garage' ? (this.isShort ? 44 : 56) : 0;
    const homeGap = this.metaPage === 'garage' ? 8 : 0;
    if (homeW > 0) {
      this.button(x0, uT + (topH - (this.isShort ? 18 : 22)) / 2, homeW, this.isShort ? 18 : 22, 'nav:home', '‹ 首页', {});
    }
    const infoX = x0 + homeW + homeGap;
    // 金币（最左）→ 段位（中）→ 能量（右偏）→ [背包][更多] 小按钮（最右，仅 Garage 页）
    this.text(`金币 ${p.coin}`, infoX, uT + topH / 2 + 5, 14, C.gold, 'left', 700);
    this.text(`段位 ${TIER_LABEL[tier]} ${p.rating}`, infoX + 134, uT + topH / 2 + 5, 14, C.textDim);
    let eBarW = Math.min(120, w * 0.2);
    let eBarX = x0 + w - eBarW;
    if (this.metaPage === 'garage') {
      // F-UX-3A：很小的次级入口（高 ≤24，宽 ~44~56；右对齐顶栏最右）
      const tinyW = this.isShort ? 44 : 56;
      const tinyH = this.isShort ? 18 : 22;
      const tinyGap = 4;
      const moreX = x0 + w - tinyW;
      const bpX = moreX - tinyW - tinyGap;
      this.button(bpX, uT + (topH - tinyH) / 2, tinyW, tinyH, 'nav:backpack', '背包', {});
      this.button(moreX, uT + (topH - tinyH) / 2, tinyW, tinyH, 'nav:more', '更多', {});
      // 能量条让位（压缩到小按钮左侧）
      eBarW = Math.max(48, Math.min(90, w * 0.14));
      eBarX = bpX - 10 - eBarW;
    }
    const snapshot = buildSnapshotFromDraft(draft, registry, 'customA');
    const energyRes = computeEnergy(snapshot, registry);
    const used = energyRes.error ? Number.NaN : energyRes.energy;
    const capacity = body?.energyCapacity ?? 0;
    const overload = Number.isFinite(used) && used > capacity;
    this.text('能量', eBarX - 38, uT + topH / 2 + 5, 14, C.textDim);
    const pct = Number.isFinite(used) ? Math.min(100, (used / Math.max(capacity, 1)) * 100) : 0;
    this.rect(eBarX, uT + topH / 2 - 4, eBarW, 10, '#232b38', C.border, 1);
    if (pct > 0) this.rect(eBarX, uT + topH / 2 - 4, eBarW * (pct / 100), 10, overload ? C.red : C.blue);
    this.text(
      Number.isFinite(used) ? `${Math.round(used)}/${capacity}` : '?/?',
      eBarX + eBarW + 6,
      uT + topH / 2 + 5,
      14,
      overload ? C.red : C.text,
      'left',
    );
  }

  /** 面板首页：2×2 主分类（车身/轮子/驱动/武器）——F-UX-3A：首屏卡片只显示名称（无副文字，详情点进去再看） */
  private drawGaragePanelHome(px: number, pw: number, py: number, ph: number): void {
    const cells: Array<{ id: string; label: string }> = [
      { id: 'entry:body', label: '车身' },
      { id: 'entry-wheels', label: '轮子' },
      { id: 'entry:drive', label: '驱动' },
      { id: 'entry-weapons', label: '武器' },
    ];
    const gap = 8;
    const cellW = (pw - gap) / 2;
    // F-WX-UI-2A/F-META-1：2×2 大卡片尽量取满 targetTouchH；矮面板时动态收缩。
    // F-WX-MOBILE-RCA-1：short 档由 availableH 纯反推（不机械坚持 36，防溢出）；normal 保持 ≥48。
    const cellH = this.isShort
      ? Math.max(8, Math.floor((ph - gap) / 2))
      : Math.max(this.minTouchH, Math.min(this.targetTouchH, Math.floor((ph - gap) / 2)));
    for (let i = 0; i < 4; i++) {
      const col = i % 2;
      const row = Math.floor(i / 2);
      this.button(px + col * (cellW + gap), py + row * (cellH + gap), cellW, cellH, cells[i].id, cells[i].label, {});
    }
  }

  /** 面板返回条（轮子/武器/选项二级顶部） */
  private drawPanelBackRow(px: number, py: number): number {
    this.button(px, py, 96, this.targetTouchH, 'panel-back', '‹ 返回', {});
    return py + this.targetTouchH + 8;
  }

  /** 轮子二级：前轮 / 后轮（一级「轮子」后才出现） */
  private drawGaragePanelWheelPick(
    draft: BuildDraft,
    px: number,
    pw: number,
    py: number,
    ph: number,
  ): void {
    const y = this.drawPanelBackRow(px, py);
    const defs = this.garageChipDefs(draft);
    const front = defs.find((d) => d.key === 'frontWheel');
    const rear = defs.find((d) => d.key === 'rearWheel');
    const gap = 8;
    const h = this.targetTouchH;
    if (y + h > py + ph) return;
    this.button(px, y, pw, h, 'wheel-side:front', '前轮', { sub: front?.value ?? '?' });
    if (y + h * 2 + gap > py + ph) return;
    this.button(px, y + h + gap, pw, h, 'wheel-side:rear', '后轮', { sub: rear?.value ?? '?' });
  }

  /** 武器二级：武器位列表（点武器位 → 该位部件卡） */
  private drawGaragePanelWeaponPick(
    draft: BuildDraft,
    px: number,
    pw: number,
    py: number,
    ph: number,
  ): void {
    const y = this.drawPanelBackRow(px, py);
    const funcSlots = this.garageChipDefs(draft).filter(
      (d) => d.key !== 'body' && d.key !== 'rearWheel' && d.key !== 'frontWheel' && d.key !== 'drive',
    );
    const gap = 8;
    const h = this.targetTouchH;
    let yy = y;
    for (const s of funcSlots) {
      if (yy + h > py + ph) break; // 面板内不溢出
      this.button(px, yy, pw, h, `weapon-slot:${s.key}`, s.label, { sub: s.value });
      yy += h + gap;
    }
  }

  /** 选项（已选槽位）：选项卡 2 列网格 + 面板内垂直滚动；选中自动收起由 runtime 保证 */
  private drawGaragePanelOptions(
    state: PlayerUIState,
    draft: BuildDraft,
    px: number,
    pw: number,
    py: number,
    ph: number,
  ): void {
    const slot = state.garageSelected;
    if (!slot) return;
    const y = this.drawPanelBackRow(px, py);
    const opts = this.garageOptions(state, slot);
    const curVal = this.garageCurrentValue(draft, slot);
    const gap = 8;
    const cardH = this.targetTouchH;
    const colW = (pw - gap) / 2;
    const rows = Math.ceil(opts.length / 2);
    const contentH = rows * (cardH + gap) - gap;
    const viewH = Math.max(80, py + ph - y - 8);
    const maxScroll = Math.max(0, contentH - viewH);
    if (this.panelScroll > maxScroll) this.panelScroll = maxScroll;
    if (maxScroll > 0) {
      this.button(px, py + ph - this.targetTouchH, 60, this.targetTouchH, 'panel-scroll-up', '▲');
      this.button(px + 68, py + ph - this.targetTouchH, 60, this.targetTouchH, 'panel-scroll-down', '▼');
    }
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.ox + px * this.scale, this.oy + y * this.scale, pw * this.scale, viewH * this.scale);
    ctx.clip();
    let yy = y - this.panelScroll;
    for (let i = 0; i < opts.length; i++) {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const c = opts[i];
      const ox = px + col * (colW + gap);
      const oy = yy + row * (cardH + gap);
      const fully = oy >= y - 0.5 && oy + cardH <= y + viewH + 0.5;
      if (fully) {
        // 完全可见：绘制 + 注册命中（视觉 rect == hit rect）
        this.button(ox, oy, colW, cardH, `opt:${c.v}`, c.t, {
          sub: c.meta || undefined,
          active: c.v === curVal,
          locked: c.locked,
          disabled: !!c.locked,
        });
      } else if (oy < y + viewH && oy + cardH > y) {
        // 部分可见：只画不注册命中（半显边缘 = 可继续滚动提示；不产生超屏 hitArea）
        const fill = c.locked ? '#262e3d' : c.v === curVal ? C.blueDeep : C.panel;
        this.rect(ox, oy, colW, cardH, fill, c.locked ? C.lockText : C.border, 1);
        this.text(c.t, ox + colW / 2, oy + cardH / 2, 15, c.locked ? C.textDark : C.text, 'center', 600);
      }
    }
    ctx.restore();
  }

  /**
   * F-META-UX2：合成说明 Modal（Backpack 底部「合成」入口触发；不切换全屏页面）。
   * 展示 5×1★ + 金币成本 + 随机 2★ 规则；条件不满足时 primary 显示原因并禁用（不注册命中）。
   * 确认 → 捕获库存快照 → 派发 onMerge（规则仍在 runtime；成功后 render 弹「合成成功」结果 Modal）。
   */
  private showMergeModal(): void {
    const st = this.lastState;
    if (!st || !st.draft) return;
    const p = st.progress;
    const inv = st.inventory;
    const reserved = new Set(equippedDefIds(st.draft));
    let available = 0;
    for (const pp of OFFICIAL_PARTS) available += Math.max(0, inv[pp].one - (reserved.has(pp) ? 1 : 0));
    const canMerge = available >= 5;
    const canAfford = canAffordMerge(p.coin);
    const ok = canMerge && canAfford;
    this.showModal({
      title: '合成',
      body: ['5 × 1★ → 1 × 随机 2★', `当前可用 1★：${available} / 需要 5`, `消耗 ${MERGE_COST_COIN} 金币 · 剩余 ${p.coin}`],
      primary: ok ? '合成' : !canMerge ? '副本不足' : '金币不足',
      primaryDisabled: !ok,
      secondary: '取消',
      onPrimary: () => {
        // 捕获合成前库存快照（用于成功 Modal diff）；onMerge 后 render 消费
        const cur = this.lastState;
        if (cur) {
          const snap: Record<string, { one: number; two: number }> = {};
          for (const pp of OFFICIAL_PARTS) snap[pp] = { one: cur.inventory[pp]?.one ?? 0, two: cur.inventory[pp]?.two ?? 0 };
          this.mergeSnapshot = snap;
        }
        this.actions?.onMerge();
      },
    });
  }

  /**
   * F-WX-UI-1：装配预览取景子区域（viewport logical）——Mobile Garage 时 = 左侧展示区。
   * Runtime reframePlayerCamera 经 battle.reframe(fit, framingRect) 使 previewSolo fit 到本区。
   */
  getPreviewFramingRect(): { x: number; y: number; w: number; h: number } | null {
    if (!this.isMobile) return null;
    const state = this.lastState;
    if (!state || state.playerPhase !== 'garage' || state.battleState !== 'editing') return null;
    // F-HOME-1：正式首页车辆展示区 = Home 布局 vehicleRect（与绘制/HitArea 同一份结果）
    if (this.metaPage === 'home') {
      return computeHomeLayout(
        { w: this.W, h: this.H },
        { left: this.insL, right: this.insR, top: this.insT, bottom: this.insB },
        this.profile,
      ).vehicleRect;
    }
    // F-WX-UI-F1：车辆取景区 = 唯一布局源 vehicleRect（与绘制/HitArea 完全同一份结果）
    return computeMobileGarageLayout(
      { w: this.W, h: this.H },
      { left: this.insL, right: this.insR, top: this.insT, bottom: this.insB },
      this.profile,
    ).vehicleRect;
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

  // ==================== Matching / MatchPreview（连续画面） ====================

  /**
   * F-META-UX3：matching / matchPreview 共用同一连续画面（布局锚点恒定，禁止整屏硬切）：
   * - 左 30%：我的车（renderer previewFixed 画 A 左 B 右，进入 Matching 后始终可见）；
   * - 中：VS + 状态文字（搜索中「正在寻找对手…」/ 已锁定「对手已锁定」）；
   * - 右 70%：对手区域——搜索中为扫描占位（非文字+VS 空屏）；已锁定在同一 opX 锚点
   *   直接替换为真实对手信息（bodyName + 驱动 pill）。
   * 只改变对手内容与状态文字，不改变整体布局锚点；正常流程无「开始战斗」按钮
   * （matchBar 能力保留，matchBarHidden=false 时仍可测）。
   */
  private drawMatchingContinuum(state: PlayerUIState): void {
    const locked = state.playerPhase === 'matchPreview';
    const op = state.opponent;
    // 统一布局锚点（matching / matchPreview 同值，禁止分阶段偏移）
    const centerY = this.H / 2 - 20;
    const myX = this.W * 0.3;
    const opX = this.W * 0.7;
    const ctx = this.ctx;
    // 中央 VS（半透明大字）+ 状态文字（两阶段同锚点，仅文案/颜色变化）
    ctx.save();
    ctx.globalAlpha = 0.22;
    this.text('VS', this.W / 2, this.H / 2 - 4, this.isMobile ? 40 : 54, C.text, 'center', 900);
    ctx.restore();
    this.text(
      locked ? '对手已锁定' : '正在寻找对手…',
      this.W / 2,
      this.H / 2 + (this.isMobile ? 42 : 50),
      this.isMobile ? 16 : 18,
      locked ? C.gold : C.textDim,
      'center',
      700,
    );
    // 左：我的车标注（renderer 已画 A；始终可见）
    this.text('我方车', myX, centerY, this.isMobile ? 16 : 18, C.textDim, 'center', 700);
    // 右：对手区域（同一 opX 锚点；搜索中占位 / 锁定替换真实信息）
    this.text('对手', opX, centerY - (this.isMobile ? 34 : 42), this.isMobile ? 16 : 18, C.textDim, 'center', 700);
    if (locked && op) {
      this.text(op.bodyName, opX, centerY + 4, this.isMobile ? 18 : 20, C.orange, 'center', 700);
      const pillText = `驱动 · ${op.drive}`;
      const pillW = this.isMobile ? 110 : 130;
      const py = centerY + (this.isMobile ? 42 : 48);
      this.rect(opX - pillW / 2, py, pillW, 26, 'rgba(59,111,212,0.16)', C.blue, 1);
      this.text(pillText, opX, py + 13, this.isMobile ? 16 : 14, C.driveBlue, 'center', 600);
    } else {
      // 搜索中：右侧扫描占位 + F-HOME-2 匹配动效——占位框脉冲呼吸 + 扫描线上下扫
      // （nowMs 驱动，renderBattleFrame 每帧重绘；候选 B 由 renderer 绘制快切）
      const sw = this.isMobile ? 132 : 160;
      const sh = 30;
      const t = this.nowMs;
      const pulse = 0.8 + 0.2 * Math.sin(t * 0.012);
      const rectFill = `rgba(59,111,212,${(0.10 * pulse).toFixed(3)})`;
      this.rect(opX - sw / 2, centerY - sh / 2, sw, sh, rectFill, C.border, 1);
      // 扫描线：在占位框内上下移动的亮带（周期 ~1.2s）
      const scanY = centerY - sh / 2 + 4 + ((t % 1200) / 1200) * (sh - 8);
      const grad = this.ctx;
      grad.fillStyle = 'rgba(120,170,255,0.5)';
      grad.fillRect(
        this.ox + (opX - sw / 2 + 6) * this.scale,
        this.oy + scanY * this.scale,
        (sw - 12) * this.scale,
        2 * this.scale,
      );
      this.text('扫描对手中…', opX, centerY + 1, this.isMobile ? 16 : 14, C.textDim, 'center', 600);
    }
  }

  private drawMatchBar(): void {
    const bw = this.isMobile ? Math.min(180, this.W * 0.32) : 200;
    const bh = this.isMobile ? this.targetTouchH : 48;
    const y = this.H - (this.isMobile ? this.insB + 12 : 64) - bh;
    this.button(this.W / 2 - bw - 8, y, bw, bh, 'match-adjust', '调整配置');
    this.button(this.W / 2 + 8, y, bw, bh, 'match-start', '开始战斗', { primary: true });
  }

  // ==================== Battle HUD ====================

  private drawHud(frame: PlayerUIHudFrame): void {
    const s = frame.battleStatus;
    if ((frame.battleState !== 'fighting' && frame.battleState !== 'ended') || !s) return;
    if (this.isMobile) {
      // F-WX-6：Mobile HUD 顶条（避开顶部 safe inset；HP 条等宽压缩）
      // F-UX-3B：mobile-short 只保留左右 HP 条（删 A/B 字母、HP 数字、「战斗中」常驻文字）；
      // 只有 Warning / Closing 才在中央显示阶段提示/倒计时（drawHudShort）。
      const top = this.insT + 4;
      const h = this.isShort ? 8 : 10;
      const barBase = this.insL + 8;
      const barW = Math.max(64, (this.W - this.insL - this.insR - 64) * 0.32);
      const pctA = Math.max(0, Math.min(1, s.sideA.hp / Math.max(s.sideA.maxHp, 1))) * 100;
      const pctB = Math.max(0, Math.min(1, s.sideB.hp / Math.max(s.sideB.maxHp, 1))) * 100;
      if (this.isShort) {
        this.drawHudShort(frame, top, h, barBase, barW, pctA, pctB);
        return;
      }
      this.text('A', barBase, top + 12, 14, C.blue, 'left', 700);
      const barAX = barBase + 16;
      this.rect(barAX, top, barW, h, '#232b38', C.border, 1);
      if (pctA > 0) this.rect(barAX, top, barW * (pctA / 100), h, C.blue);
      this.text(`${Math.round(s.sideA.hp)}`, barAX + barW + 6, top + 12, 14, C.text);

      const barBRight = this.W - this.insR - 8;
      this.text('B', barBRight, top + 12, 14, '#e08a2e', 'right', 700);
      const barBX = barBRight - 16 - barW;
      this.rect(barBX, top, barW, h, '#232b38', C.border, 1);
      if (pctB > 0) this.rect(barBX, top, barW * (pctB / 100), h, '#e08a2e');
      this.text(`${Math.round(s.sideB.hp)}`, barBX - 6, top + 12, 14, C.text, 'right');

      this.text(s.phase === 'End' ? '战斗结束' : '战斗中', this.W / 2, top + 12, 14, C.gold, 'center');
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

  /**
   * F-UX-3B：mobile-short Battle HUD——只保留左右两条 HP 条（无 A/B 字母、无 HP 数字、
   * 无「战斗中」常驻文字）；仅 Warning / Closing 才在中央显示阶段提示 + 倒计时
   * （倒计时文案由 runtime pollArenaPhase 提供：Warning=3/2/1，Closing=刺墙剩余秒数）。
   * 顶部让出的空间全部还给战斗画面（配合 renderer 薄地面构图）。
   */
  private drawHudShort(
    frame: PlayerUIHudFrame,
    top: number,
    h: number,
    barBase: number,
    barW: number,
    pctA: number,
    pctB: number,
  ): void {
    const s = frame.battleStatus!;
    // 左右 HP 条（纯条，无文字）
    this.rect(barBase, top, barW, h, '#232b38', C.border, 1);
    if (pctA > 0) this.rect(barBase, top, barW * (pctA / 100), h, C.blue);
    const barBRight = this.W - this.insR - 8;
    const barBX = barBRight - barW;
    this.rect(barBX, top, barW, h, '#232b38', C.border, 1);
    if (pctB > 0) this.rect(barBX, top, barW * (pctB / 100), h, '#e08a2e');
    // 中央阶段提示：仅 Warning / Closing（不遮挡车辆/武器/FX——车辆位于下部战斗带）
    if (s.phase === 'Warning' || s.phase === 'Closing') {
      const label = s.phase === 'Warning' ? '警告' : '刺墙逼近';
      const cd = frame.phaseCountdownText != null ? frame.phaseCountdownText : '';
      this.text(cd !== '' ? `${label} ${cd}` : label, this.W / 2, top + 44, 24, C.red, 'center', 800);
    }
  }

  // ==================== Result ====================

  private drawResult(state: PlayerUIState): void {
    // F-META-5：仅 Desktop 使用（Mobile Result 走通用 Modal showResultModal）
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

  /**
   * F-META-4：打开通用 Modal（居中卡片 + 全屏遮罩；覆盖当前 UI 并拦截底层点击）。
   * 最小 API：调用方提供标题/内容/按钮文案与回调；不接具体业务逻辑、无动画、无美术依赖。
   */
  /**
   * F-META-5 + F-META-UX4 + F-UX-3C：正式结算 Modal——固定三层（不拼长句）：
   * ① 顶部：胜利/失败（title）；② 中部：金币奖励 + 段位变化（rewardRows 分块），
   *    获得部件时独立奖励卡（partCard：名称+星级+当前数量；无「获得」标题行）；
   *    广告领币是奖励区内部的小型入口（adRow，明显弱于下一场），不做第三个底部按钮；
   * ③ 底部：仅两个流程决策 [调整配置][下一场]（下一场主按钮）。
   * 不增加「领取奖励」步骤——奖励自动结算。
   */
  private showResultModal(state: PlayerUIState): void {
    const r = state.result!;
    const isWin = r.winner === 'A';
    const rows: NonNullable<ModalSpec['rewardRows']> = [];
    if (state.economy) {
      const cs = state.economy.coinDelta >= 0 ? '+' : '';
      const rs = state.economy.ratingDelta >= 0 ? '+' : '';
      rows.push({ label: '金币', value: `${cs}${state.economy.coinDelta}`, tone: 'gold' });
      rows.push({
        label: '段位',
        value: `${rs}${state.economy.ratingDelta} · ${state.economy.tierLabel} ${state.economy.rating}`,
        tone: state.economy.ratingDelta >= 0 ? 'blue' : 'red',
      });
    }
    const body: string[] = [];
    if (state.resultOnboardingVisible) body.push('获得新部件，可以回车库调整');
    this.showModal({
      title: isWin ? '胜利' : '失败',
      body,
      rewardRows: rows.length ? rows : undefined,
      partCard: state.reward
        ? { name: state.reward.name, starStr: state.reward.starStr, count: state.reward.countAfter }
        : undefined,
      // F-UX-2D：Result 是最终决策层——大尺寸档（明显放大）
      large: true,
      primary: '下一场',
      secondary: '调整配置',
      // F-UX-3C：广告入口在奖励区内部（「额外 +50金币 · 看广告」），明显弱于底部两决策
      adRow: state.rewardAdAvailable
        ? {
            label: state.rewardAdClaimed ? `已领 +${REWARD_AD_COIN_BONUS}金币` : `额外 +${REWARD_AD_COIN_BONUS}金币 · 看广告`,
            disabled: state.rewardAdClaimed,
            onPress: () => this.actions?.onClaimRewardAd(),
          }
        : undefined,
      onPrimary: () => this.actions?.onResultNext(),
      onSecondary: () => this.actions?.onResultAdjust(),
    });
  }

  showModal(spec: ModalSpec): void {
    this.modal = spec;
    this.draw();
  }

  /** F-META-4：关闭 Modal——重绘后恢复当前页面（lastState 与 Host 内部态均保留） */
  closeModal(): void {
    this.modal = null;
    this.draw();
  }

  /**
   * F-META-4：Modal 覆盖层绘制——全屏遮罩（拦截底层）+ 居中卡片（标题/内容/按钮）。
   * F-META-UX4：内容支持三层结构——body 文字行 + rewardRows 奖励行（label 左/value 右着色）
   * + partCard 独立部件卡。
   * F-WX-MOBILE-RCA-1：卡片必须完整落在 safe area——short 极限屏下行高自适应压缩、
   * cy 取「居中」与「safe 内」的交集（宁可顶到 safeTop 也不溢出）。
   * F-UX-2D：`large`（Result）明显放大——normal 约占 viewport 70~80% 宽 / 60~75% 高；
   * short 尽可能用 safe viewport 但保留边距。内容锚点恒定（胜/负→奖励→部件→按钮），
   * 多余高度作为留白，按钮行贴卡片底部——形成明确的最终决策层。
   * F-UX-3C：底部只保留两个流程决策按钮（[调整配置][下一场]）；广告改奖励区内部的
   * 小型入口（adRow）；short 档 large 高度 0.86（420×210 内容不足时留出明确留白）。
   */
  private drawModal(spec: ModalSpec): void {
    const W = this.W;
    const H = this.H;
    // 全屏遮罩（先注册 → 逆序命中时被卡片按钮覆盖；底层按钮被拦截不可点）
    this.rect(0, 0, W, H, C.overlayBg);
    this.hit('modal-veil', 0, 0, W, H);
    // 居中卡片（尺寸自适应：标题 + 内容 + 按钮；short 档整体紧凑，保证 safe 内完整）
    // F-UX-2D：large（Result）放大到 viewport 比例；普通 Modal（合成/占位等）保持小尺寸
    const large = !!spec.large;
    const cardW = large
      ? Math.min(W - this.insL - this.insR - (this.isShort ? 24 : 32), W * (this.isShort ? 0.9 : 0.78))
      : Math.min(420, W - this.insL - this.insR - 40);
    const rewardRowH = this.isShort ? 14 : 26;
    const titleH = this.isShort ? 24 : 40;
    const btnH = this.isShort ? Math.min(this.targetTouchH, 36) : this.targetTouchH;
    const pad = this.isShort ? 10 : 16;
    // F-UX-3C：广告小型入口高（short 16 / normal 22）+ 前后间隙（明显弱于底部按钮）
    const adH = spec.adRow ? (this.isShort ? 16 : 22) + (this.isShort ? 6 : 14) : 0;
    const partH = spec.partCard ? (this.isShort ? 32 : 58) : 0;
    const hasContentBefore =
      spec.body.length > 0 || (spec.rewardRows?.length ?? 0) > 0 || !!spec.adRow;
    const partGap = spec.partCard && hasContentBefore ? (this.isShort ? 4 : 8) : 0;
    // 固定部分高（不含 body 行）——body 行高在剩余空间内自适应（short 极限屏不溢出）
    const fixedH = pad + titleH + (spec.rewardRows?.length ?? 0) * rewardRowH + adH + partH + partGap + (this.isShort ? 4 : 10) + btnH + pad;
    const availBodyH = H - this.insT - this.insB - fixedH;
    const rowH = spec.body.length > 0 ? Math.max(12, Math.min(22, availBodyH / spec.body.length)) : 22;
    const contentH = fixedH + spec.body.length * rowH;
    // large：最小高 = viewport 60~75%（normal）/ ~86%（short：内容不足时明确留白）；内容不足时留白
    const cardH = large ? Math.max(contentH, Math.floor(H * (this.isShort ? 0.86 : 0.62))) : contentH;
    const cx = Math.max(this.insL, Math.min((W - cardW) / 2, W - this.insR - cardW));
    const cy = Math.max(this.insT, Math.min((H - cardH) / 2, H - this.insB - cardH));
    this.rect(cx, cy, cardW, cardH, C.dockBg, C.border, 1);
    // ① 顶部：标题（胜利/失败）
    this.text(spec.title, cx + cardW / 2, cy + pad + titleH / 2, large ? (this.isShort ? 20 : 28) : 20, C.text, 'center', 700);
    let yy = cy + pad + titleH + 4;
    // ② 中部：body 文字行（onboarding 引导等）
    for (const line of spec.body) {
      this.text(line, cx + cardW / 2, yy + rowH / 2, 14, C.textDim, 'center');
      yy += rowH;
    }
    // ② 中部：奖励行（金币/段位；label 左 + value 右，独立行不拼长句）
    if (spec.rewardRows) {
      const toneColor: Record<ModalTone, string> = {
        gold: C.gold,
        blue: C.driveBlue,
        red: C.red,
        green: C.green,
      };
      for (const rr of spec.rewardRows) {
        this.text(rr.label, cx + pad, yy + rewardRowH / 2, 14, C.textDim, 'left');
        this.text(rr.value, cx + cardW - pad, yy + rewardRowH / 2, 15, rr.tone ? toneColor[rr.tone] : C.text, 'right', 700);
        yy += rewardRowH;
      }
    }
    // ② 中部：广告小型次级入口（F-UX-3C：奖励区内部，明显弱于底部流程按钮；点击不关闭）
    if (spec.adRow) {
      yy += this.isShort ? 2 : 6;
      const ah = this.isShort ? 16 : 22;
      const aw = Math.min(cardW - 2 * pad - 20, 230);
      this.button(cx + pad, yy, aw, ah, 'modal-ad', spec.adRow.label, {
        disabled: spec.adRow.disabled,
      });
      yy += ah + (this.isShort ? 4 : 8);
    }
    // ② 中部：独立奖励卡（获得部件：名称 + 星级 + 当前数量；F-UX-3C 删「获得」标题行）
    if (spec.partCard) {
      yy += partGap;
      const ph = partH - 8;
      const pw = cardW - 2 * pad;
      this.rect(cx + pad, yy, pw, ph, C.cardBg, C.border, 1);
      if (this.isShort) {
        // short 紧凑两行：名称 + 库存（上）· 星级（下）
        this.text(spec.partCard.name, cx + pad + 12, yy + 8, 12, C.text, 'left', 700);
        this.text(`库存 ${spec.partCard.count}`, cx + cardW - pad - 12, yy + 8, 11, C.textDim, 'right');
        this.text(spec.partCard.starStr, cx + pad + 12, yy + 18, 11, C.gold, 'left', 700);
      } else {
        this.text(spec.partCard.name, cx + pad + 12, yy + 18, 16, C.text, 'left', 700);
        this.text(`库存 ${spec.partCard.count}`, cx + cardW - pad - 12, yy + 18, 14, C.textDim, 'right');
        this.text(spec.partCard.starStr, cx + pad + 12, yy + 36, 15, C.gold, 'left', 700);
      }
      yy += ph + 8;
    }
    // ③ 底部：按钮行（次按钮左 / 主按钮右）——F-UX-3C：仅两个流程决策（删 tertiary 三列）
    // F-META-UX2：primaryDisabled → 主按钮禁用（不注册命中，显示原因文案）
    // F-UX-2D：large 时按钮行贴卡片底部（内容顶部排、多余高度留白 → 明确的最终决策层）
    const by = large ? cy + cardH - pad - btnH : yy + 2;
    const gap = 10;
    if (spec.secondary) {
      const bw = (cardW - 2 * pad - gap) / 2;
      this.button(cx + pad, by, bw, btnH, 'modal-secondary', spec.secondary, {});
      this.button(cx + pad + bw + gap, by, bw, btnH, 'modal-primary', spec.primary, {
        primary: !spec.primaryDisabled,
        disabled: spec.primaryDisabled,
      });
    } else {
      this.button(cx + pad, by, cardW - 2 * pad, btnH, 'modal-primary', spec.primary, {
        primary: !spec.primaryDisabled,
        disabled: spec.primaryDisabled,
      });
    }
  }

  private drawReadyOverlay(): void {
    this.rect(0, 0, this.W, this.H, C.readyBg);
    this.text('READY', this.W / 2, this.H / 2 - 40, this.isMobile ? 13 : 15, C.textDim, 'center');
    this.text('开战！', this.W / 2, this.H / 2 + 14, this.isMobile ? 36 : 46, C.gold, 'center', 800);
  }
}
