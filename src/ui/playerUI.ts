/**
 * F-WX-3｜Player UI Host 边界（平台中立）。
 *
 * 正常玩家 UI（Garage / Matching / Battle HUD / Result / Reward / Inventory picker /
 * Merge / Onboarding / Stats）从 main.ts 抽出为「明确 UI State + Action + Host」：
 * - PlayerUIState：玩家 UI 当前应展示的全部数据快照（纯数据，无 DOM）；
 * - PlayerUIActions：玩家输入产生的抽象命令（无 DOM 依赖）；
 * - PlayerUIHost：绑定 State → 渲染、Action → 回调的平台中立接口。
 *
 * Web 首阶段由 WebDomPlayerUIHost 实现（复用原 DOM 结构/样式，视觉不变）；
 * DEV Scenario / Physics Lab / Runtime Debug Tools 不进入本边界（main.ts 保留 Web-only）。
 */
import type { BuildDraft } from '../lab/buildEditorModel';
import { EMPTY_SLOT } from '../lab/buildEditorModel';
import type { PartInventory } from '../core/partInventory';
import type { ProgressState } from '../core/playerProgress';
import type { OnboardingStage } from '../core/onboarding';
import type { UiMode, BattleState, PlayerPhase } from './playerShell';
import type { FramingRect } from '../render/renderer';

export type { UiMode, BattleState, PlayerPhase } from './playerShell';

// —— 玩家可见选项常量（原 main.ts，抽到平台中立边界；DEV 面板与玩家 Dock 共用） ——
/** Q10-A：正常装配（玩家）只展示当前正式内容（西瓜/香蕉/菠萝/椰子）。 */
export const BODY_OPTIONS: Array<{ v: string; t: string }> = [
  { v: 'watermelonBody', t: '西瓜车身（宽厚低矮）' },
  { v: 'bananaBody', t: '香蕉车身（长条弧形）' },
  { v: 'pineappleBody', t: '菠萝车身（高窄·顶挂点高）' },
  { v: 'coconutBody', t: '椰子车身（短沉·更抗推）' },
];

/** Q10-B：玩家侧轮径命名（小/标准/大；三张等权卡片同一行展示）。 */
export const WHEEL_OPTIONS: Array<{ v: string; t: string }> = [
  { v: '12', t: '12 小' },
  { v: '20', t: '20 标准' },
  { v: '26', t: '26 大' },
];

/** Q22：Functional 槽选项的 (defId, star) 编码 / 解码（value 形如 `cannon@2`）。 */
export function encodePartVal(defId: string, star: number): string {
  return defId === EMPTY_SLOT ? EMPTY_SLOT : `${defId}@${star}`;
}
export function decodePartVal(v: string): { defId: string; star: number } {
  if (v === EMPTY_SLOT) return { defId: EMPTY_SLOT, star: 1 };
  const i = v.lastIndexOf('@');
  const defId = i >= 0 ? v.slice(0, i) : v;
  const star = i >= 0 ? Number(v.slice(i + 1)) || 1 : 1;
  return { defId, star };
}

/** 每帧数据：Battle HUD（HP 条 + 阶段文案 + Warning 倒计时）。 */
export interface PlayerUIHudFrame {
  battleState: BattleState;
  battleStatus: {
    phase: string;
    sideA: { hp: number; maxHp: number };
    sideB: { hp: number; maxHp: number };
  } | null;
  /** Warning 倒计时文案；null = 隐藏 */
  phaseCountdownText: string | null;
  /**
   * F-BATTLE-READABILITY-R1：左右阵营卡名称（我方/对手车辆名，如「西瓜」/「香蕉」）。
   * HUD 不再只显示 A/B；缺省时 HUD 回落到阵营色条。
   */
  names?: { a: string; b: string };
}

/** 玩家 UI 当前应展示的全部数据快照（纯数据；由 main.ts 组装）。 */
export interface PlayerUIState {
  uiMode: UiMode;
  battleState: BattleState;
  playerPhase: PlayerPhase;
  // —— Garage（装配 Dock）——
  draft: BuildDraft | null;
  draftValid: boolean;
  blockReason: string | null;
  garageSelected: string | null;
  inventory: PartInventory;
  progress: ProgressState;
  onboarding: OnboardingStage;
  resetDevVisible: boolean;
  // —— Matching / MatchPreview ——
  opponent: { bodyName: string; parts: string[]; drive: '前进' | '停驻' } | null;
  /**
   * F-MATCH-FRAME-R2：Matching / MatchPreview 阶段 A/B 双车的真实屏幕 envelope（逻辑 px），
   * 由 Runtime 经 battle.getMatchVehicleRects() 计算并推入。UI 据此绘制扫描框 / 对手名称，
   * 保证与 renderer 实际落点一致（无此数据时 UI 回落到比例锚点，真实流程恒有此数据）。
   */
  matchVehicleRects?: { a: { x: number; y: number; w: number; h: number }; b: { x: number; y: number; w: number; h: number } } | null;
  /**
   * F-HOME-STAGE-R2：首页「我的车」可见 envelope 屏幕矩形（逻辑 px）。
   * 由 Runtime 经 battle.getHomeVehicleRect() 计算并推入。UI 据此注册车辆点击区
   * （点击跟随真实 envelope，而非整块 vehicleFramingRect）。无此数据时 UI 回落到
   * vehicleFramingRect，真实流程恒有此数据。
   */
  homeVehicleRect?: { x: number; y: number; w: number; h: number } | null;
  /** MatchPreview 复核条（Q15-FLOW-R1-ATOMIC：正常流程立即隐藏，永不闪现） */
  matchBarHidden: boolean;
  // —— Result ——
  result: { winner: 'A' | 'B'; hpA: number; hpB: number } | null;
  reward: { name: string; starStr: string; cat: string; countAfter: number } | null;
  economy: {
    coinDelta: number;
    ratingDelta: number;
    tierLabel: string;
    rating: number;
    coin: number;
  } | null;
  resultOnboardingVisible: boolean;
  rewardAdAvailable: boolean;
  rewardAdClaimed: boolean;
  // —— READY 过渡 ——
  readyOverlayVisible: boolean;
}

/** 玩家输入产生的抽象命令（由 main.ts 实现 → Gameplay command）。 */
export interface PlayerUIActions {
  /** Garage Dock 第一层 chip 选中切换（再点收起） */
  onToggleGarageSlot(key: string): void;
  /** F-GARAGE-COMBAT-TAB-R1：战斗页跨组选中（只选不收起——用于武器/辅助挂点点击切换过滤，不误收起） */
  selectGarageSlot?(key: string): void;
  /** Garage Dock 第二层选项选择（车身/轮/驱动/功能件） */
  onPickGarageOption(value: string): void;
  /** Garage「寻找对手」 */
  onFindOpponent(): void;
  /** MatchPreview 复核条「调整配置」（正常流程不可达，保留能力） */
  onMatchAdjust(): void;
  /** MatchPreview 复核条「开始战斗」（正常流程不可达，保留能力） */
  onStartBattle(): void;
  /** Result「调整配置」（完成首轮闭环） */
  onResultAdjust(): void;
  /** Result「下一场」 */
  onResultNext(): void;
  /** Result「看广告领金币」 */
  onClaimRewardAd(): void;
  /** Garage 合成（5×1★ → 随机 2★） */
  onMerge(): void;
  /** DEV：重置进度（?resetdev=1 可见；二次确认后调用） */
  onResetProgress(): void;
  /** 首页程序化背景下沉为 renderer underlay 开关（仅首页开启；车库/匹配/战斗关闭） */
  setHomeBackdrop?(on: boolean): void;
  /** F-PREBATTLE-VISUAL-R1：战前（Matching/MatchPreview）程序化背景下沉为 renderer underlay 开关（仅战前开启） */
  setPrebattleBackdrop?(on: boolean): void;
  /** F-BATTLE-PRESENTATION-R2：战斗（fighting/ended）程序化竞技场背景下沉为 renderer underlay 开关（仅战斗开启） */
  setBattleBackdrop?(on: boolean): void;
}

/** 平台中立 Host 接口：绑定 State → 渲染、Action → 回调。 */
export interface PlayerUIHost {
  /** 创建并挂载玩家 UI DOM（Web 挂到 canvasWrap；其它平台可挂到各自容器） */
  mount(parent: HTMLElement): void;
  setActions(actions: PlayerUIActions): void;
  /** 离散状态变化 → 全量渲染（Shell 可见性 / Garage Dock / MatchInfo / Result / Reward / READY） */
  render(state: PlayerUIState): void;
  /** 每帧：Battle HUD（HP + 阶段 + Warning 倒计时） */
  renderBattleFrame(frame: PlayerUIHudFrame): void;
  /**
   * F-WX-UI-1：装配预览取景子区域（viewport logical 坐标；Mobile Garage = 左侧展示区）。
   * Runtime 构图（reframePlayerCamera）经它取 framingRect；无实现/非适用阶段 → null。
   */
  getPreviewFramingRect?(): FramingRect | null;
  /**
   * F-MATCH-DEMO-R1：compact mobile 手机流程标志（Canvas host 实现返回 true）。
   * Runtime 用它压缩战前过渡——mobile 无 READY 覆盖层（Host 侧 !isMobile 门控），
   * Locked 稳定 ~700ms 后直接开战，不追加 600ms READY 空等；桌面（未实现 → undefined）
   * 保持 READY 600ms 过渡语义不变。
   */
  isMobileView?(): boolean;
  /**
   * F-PLAYER-CANVAS-COMPOSE-P0：容器/DPR 变化后把共享 PlayerViewportTransform 同步到
   * 本画布（玩家模式 resize 入口；无共享变换的实现可为空操作——可选方法）。
   */
  syncViewport?(): void;
}
