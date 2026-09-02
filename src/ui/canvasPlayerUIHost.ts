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
import type { PointerMeta, SafeInsets } from '../platform/types';
import type { FramingRect } from '../render/renderer';
import {
  computeMobileGarageLayout,
  computeGarageTopBarLayout,
  type Rect,
  type MobileGarageLayout,
  type GarageTopBarTexts,
} from './mobileGarageLayout';
import { registry } from '../core/content';
import { DEV_TOOLS_VISIBLE } from '../core/env';
import {
  buildSnapshotFromDraft,
  editableSlots,
  slotLabel,
  migrateDraftBody,
  EMPTY_SLOT,
  resolveDriveMode,
  type BuildDraft,
  type DriveMode,
} from '../lab/buildEditorModel';
import { computeEnergy } from '../core/buildValidator';
import { starTierEnergy } from '../core/buildSnapshot';
import { getCount, canEquipPart, canEquipMovement, getInventory, OFFICIAL_PARTS, OFFICIAL_MOVEMENTS, canFuse, equippedSlots } from '../core/partInventory';
import { canEquipBody, OFFICIAL_BODIES } from '../core/bodyOwnership';
import { hasAllOfficialDebugContent } from '../core/debugGrants';
import { tierOf, TIER_LABEL } from '../core/playerProgress';
import { REWARD_AD_COIN_BONUS } from '../core/ads';
import { BODY_OPTIONS, MOVEMENT_OPTIONS, encodePartVal, decodePartVal } from './playerUI';
import { resolveLayoutProfile, type LayoutProfile } from './layoutProfile';
// F-PLAYER-CANVAS-COMPOSE-P0：手机逻辑画布尺寸单一来源（PlayerViewportTransform）；
// 本地别名保持既有调用点不变（PHONE_LOGICAL_W/H 即 PLAYER_LOGICAL_W/H）。
import {
  PLAYER_LOGICAL_W as PHONE_LOGICAL_W,
  PLAYER_LOGICAL_H as PHONE_LOGICAL_H,
  type PlayerViewportTransform,
} from '../platform/playerViewport';
import { computeHomeLayout } from './homeLayout';
import { computeTopSafeAreas } from './topSafeLayout';
import { V } from './visualTokens';
import type {
  PlayerUIHost,
  PlayerUIState,
  PlayerUIHudFrame,
  PlayerUIActions,
} from './playerUI';

/** 逻辑布局基准（Desktop 等比缩放适配实际画布；中心留白） */
const BASE_W = 1280;
const BASE_H = 720;
/**
 * F-MOBILE-VISUAL-BASE-R1｜统一手机玩家视觉体系（语义视觉源，单一事实来源）。
 * 与 WebDOM 同源的色板（纯功能性绘制，无渐变/动效）——取值全部映射到 V（visualTokens.ts），
 * 禁止只在 C 内改名字而画面不变。以下 key 保持历史名以兼容 153 处调用站点；语义见 V。
 */
const C = {
  /** 场景背景（保留旧 layering 测试标记色 #0a0d13：首页背景下沉第一带） */
  bg: V.arenaBgTop,
  panel: V.panel,
  panelHover: V.panelEmph,
  border: V.border,
  borderActive: V.ownBlueBright,
  blue: V.ownBlue,
  blueBright: V.ownBlueBright,
  blueDeep: '#1c2c47',
  /** 主操作为金黄（替代旧浅金 #ffd35a，权重更明确） */
  gold: V.primary,
  text: V.textPrimary,
  textDim: V.textSecondary,
  textDark: V.textFaint,
  /** 失败/危险红 */
  red: V.lose,
  /** 胜利绿 */
  green: V.win,
  /** 敌方橙（高饱和，替代旧 #ff9d5a） */
  orange: V.enemyOrange,
  /** 面板实底（偏蓝深色，替代旧 rgba(15,19,27,0.93) 中性黑） */
  dockBg: 'rgba(18,26,40,0.94)',
  overlayBg: 'rgba(4,7,12,0.80)',
  readyBg: 'rgba(6,9,14,0.38)',
  /** 卡片底（偏蓝深，替代旧 #1c2330） */
  cardBg: '#162032',
  title: V.textPrimary,
  onboardBg: '#16233c',
  onboardBorder: '#2f5fa0',
  onboardText: '#bcd4ff',
  /** 我方能量蓝（明亮，替代旧 #cfe0ff） */
  driveBlue: '#7fb2ff',
  /** 锁定文字（橙调，替代旧 #c98b5e 棕） */
  lockText: '#ff9d5a',
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

/**
 * F-GARAGE-DRAG-ASSEMBLY-P0｜Garage 局部拖动状态机（Must#3）。
 *
 * 状态【只】存在于 Garage 交互层（本 Host 私有字段），不进入 Gameplay Runtime、不进
 * PlayerUIState、不参与 Battle 输入：非 garage 阶段 / 非装配带起点恒为 null。
 */
type GarageDragPhase =
  | 'idle'
  | 'stripScrolling'
  | 'partPressed'
  | 'draggingPart'
  | 'hoveringValidMount'
  | 'hoveringInvalidMount'
  | 'cancelled'
  | 'completed';

/** 真实挂点（与 PlayerUIState.hardpointScreenPts 元素同构；来源 = Renderer 实测坐标） */
type GarageHardPt = {
  id: string;
  kind: 'movement' | 'functional';
  x: number;
  y: number;
  occupied: boolean;
};

/** 拖动中的一次手势快照（logical px；client→logical 只在上游转换一次） */
interface GarageDragSnapshot {
  phase: GarageDragPhase;
  /** 按下起点（logical px） */
  startX: number;
  startY: number;
  /** 当前指针（logical px） */
  x: number;
  y: number;
  /** 被拖 / 被选中的部件（来自当前卡片带；ghost 唯一数据来源） */
  card: GarageOpt | null;
  /** 该卡片所属槽位快照（garageSelected；装备时据此切槽） */
  slot: string | null;
  /** 卡片原始绘制矩形（拖动中降低亮度，ghost 从原卡飞出） */
  cardRect: { x: number; y: number; w: number; h: number } | null;
  /** 最近兼容挂点 id（null = 未命中任何兼容挂点） */
  hoverHp: string | null;
  /** 悬停目标预计超载 → 红环（Must#5/11） */
  overload: boolean;
  /** 本次手势是否已提交装备（Forbidden：一次 pointerup 不得触发两次装备回调） */
  submitted: boolean;
  /** Must#15 点击备用路径：卡片已选中、兼容挂点点亮，等待玩家点挂点（不自动装默认挂点） */
  armed: boolean;
  /** 无效 / 锁定原因（装配带内文字提示；不新增 Modal） */
  notice: string | null;
  /**
   * F-GARAGE-DRAG-CONTINUITY-R1（Must#11）：本次手势的 pointerId。
   * 用于「不继承上一手势的 pointerId」——手势结束时与 ghost/hover/cancel 一并清空。
   * 测试桩/无 pointerId 环境为 null。
   */
  pointerId: number | null;
  /** pointerType（'mouse' | 'touch' | 'pen'）——触屏 ghost 上移避让手指（Must#6） */
  pointerType: string | null;
}

const ZERO_INSETS: SafeInsets = { left: 0, right: 0, top: 0, bottom: 0 };

/**
 * F-GARAGE-DRAG-CONTINUITY-R1（Must#6）：触屏 ghost 抬升量（logical px）。
 * 区间要求 16~24，取中值 20；目的 = 避免手指遮挡 ghost，不改变落点判定。
 */
const GHOST_TOUCH_LIFT = 20;

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
 * F-META-4：通用 Modal Frame 规格（轻量 UI Foundation，不接具体业务逻辑）。
 * - 居中卡片：标题区 + 内容行 + 主按钮 + 可选次按钮 + 全屏遮罩（拦截底层点击）。
 * - 关闭后重绘恢复当前页面；按钮回调由调用方提供（最小 API，无全局 Modal Manager）。
 */
/** 奖励行色调（F-META-UX4：金币/段位独立行的 value 着色） */
type ModalTone = 'gold' | 'blue' | 'red' | 'green';

interface ModalSpec {
  title: string;
  /** F-RESULT-UX-R1：标题语义色调（结算页 胜利=green / 失败=red，第一眼知道输赢） */
  titleTone?: 'green' | 'red';
  body: string[];
  /**
   * F-META-UX4：结构化奖励行（金币/段位等；label + value 同块紧凑显示，不再两端分离）。
   * F-RESULT-DEMO-R2：sub 为辅助小字（如段位名 + 当前值），与 value 同块、紧邻不分离。
   */
  rewardRows?: Array<{ label: string; value: string; sub?: string; tone?: ModalTone }>;
  /** F-META-UX4：独立奖励卡（获得部件：名称 + 星级 + 当前数量；unlocked 车身奖励显示「已解锁」） */
  partCard?: { name: string; starStr: string; count: number; unlocked?: boolean };
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
  /** F-LOBBY-GARAGE-DEMO-R1：装配面板视图（home 4 主分类 / movePick 移动二级 / weaponPick 武器位 / gadgetPick 辅助位 / options 选项） */
  private panelView: 'home' | 'movePick' | 'weaponPick' | 'gadgetPick' | 'options' = 'home';
  /** F-GARAGE-COMBAT-TAB-R1：装配台常驻分类（车身/移动/战斗；武器+辅助合并为「战斗」突出入口）。 */
  private garageCategory: 'body' | 'move' | 'combat' = 'body';
  /**
   * F-GARAGE-CENTER-STAGE-P0：底部部件带横向滚动偏移（0..maxScroll；左右箭头/横滑驱动）。
   * 由绘制时按内容宽与可视宽计算 maxScroll 并钳制。
   */
  private garageStripScroll = 0;
  /**
   * F-DEBUG-GRANT-COVERAGE-P0｜「测试：全部件×1」一键领用态。
   * 普通微信包/Web prod 永不显示（门控见 drawDevGrantEntry）；RC 体验包（__WX_DEBUG_GRANT__）
   * 或 E2E 包（__E2E_INTERNAL_HANDLE__）点击 → runtime 授予 → 按钮「已领取」/inert 由
   * drawDevGrantEntry 每次从真实库存重算（hasAllOfficialDebugContent），不在此存 UI 内存标记。
   */
  // 注：claimed 状态已改为运行时从真实库存计算，此处不再保留 devGrantClaimed 内存字段。
  /** F-GARAGE-CENTER-STAGE-P0：当前帧部件卡带可视行 rect（logical px；供手势横滑判定起点是否在带内） */
  private stripCardRow: { x: number; y: number; w: number; h: number } | null = null;
  /** F-GARAGE-CENTER-STAGE-P0：指针手势状态（down/move/up；滑动 >8 logical px 取消该次点击） */
  private gesture: { px: number; py: number; dx: number; dy: number; cancelled: boolean } | null = null;
  /** F-PREBATTLE-VISUAL-R1：Locked 揭晓高亮环计时（克制；~500ms 淡出；不移动车辆） */
  private prebattleLockSeen = false;
  private prebattleLockAt = 0;
  /** F-GARAGE-LIVE-ASSEMBLY-P0：装备成功吸附反馈（挂点金圈 150~220ms；Runtime flashEquip 触发） */
  private equipFlash: { hp: string; until: number } | null = null;
  /**
   * F-WX-EXPERIENCE-RC-P0：体验版 SHA 水印文本。仅 RC 体验构建经 game.ts 注入
   * （`__WX_BADGE__` 为真时）；正式构建不调用 → 恒为空 → 不绘制。用于「录屏时可确认版本」，
   * 且正式发布前可关闭（不注入即可）。
   */
  private buildBadge = '';
  /** F-META-1：Main Shell 当前 MetaPage（UI-only，由 Host 局部管理，不进 Gameplay 状态机）；F-HOME-1：默认 Home（正式首页） */
  private metaPage: MetaPage = 'home';
  /** F-GARAGE-ADJUST-REMATCH-P0：瞬时 Garage 入口上下文（UI-only，不持久化）——
   *  true = 从战败 Result「调整配置」进入装配台（显示「完成并再战」）；
   *  false = 正常 Home→Garage（不显示）。返回 Home / 进入 Matching / 新 Battle / 重启 均清除。 */
  private garageFromResult = false;
  /** F-META-6：More 页子视图（功能卡主页 / 设置子页；UI-only，不进 Gameplay） */
  private moreView: 'home' | 'settings' = 'home';
  /** F-META-6：音效开关（UI preference；Runtime 无音效设置接口 → 仅持久化，不接音频） */
  private soundOn = true;
  /** F-META-6：震动开关（预留；UI preference 持久化，不接平台震动 API） */
  private vibrationOn = true;
  /** F-GARAGE-INVENTORY-FUSION-P0：Backpack 分类（战斗/移动/车身；UI-only）。默认「战斗」。 */
  private backpackFilter: 'combat' | 'movement' | 'body' = 'combat';
  /** F-GARAGE-INVENTORY-FUSION-P0：当前选中的可合成 defId（点击卡片选中；null = 未选）。 */
  private backpackSelected: string | null = null;
  /** F-GARAGE-INVENTORY-FUSION-P0：合成成功轻反馈（无重型动画；下次交互/离开清除）。 */
  private fuseToast: string | null = null;
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
  /**
   * F-GARAGE-DRAG-ASSEMBLY-P0：Garage 拖动状态机（Must#3）。
   * null = idle。仅装配带卡片按下时创建；离开 garage / 手势结束 / 系统取消即复位。
   */
  private garageDrag: GarageDragSnapshot | null = null;
  /** F-GARAGE-DRAG-ASSEMBLY-P0：装配带内临时提示（超载差值 / 未获得原因；Must#11/13） */
  private garageDragNotice: string | null = null;
  /** F-GARAGE-DRAG-ASSEMBLY-P0：教学提示（Must#17）——首次成功拖装后本次会话隐藏 */
  /** F-GARAGE-DRAG-ASSEMBLY-P0：当前帧中央舞台 rect（车身卡拖放目标；布局源，非像素估算） */
  private garageStageRect: { x: number; y: number; w: number; h: number } | null = null;
  /** F-GARAGE-DRAG-ASSEMBLY-P0：window 级拖动安全网只安装一次 */
  private dragSafetyInstalled = false;

  /** F-DEMO-PLAYER-RUNTIME-P0：玩家演示「手机逻辑画布」选项——桌面打开时固定手机逻辑尺寸
   *  （约 844×390），CSS contain 等比放大居中（不切回 Desktop 布局）；逻辑布局 = 手机 profile，
   *  点击坐标经 PlatformInput 归一化反算（见 platform/web/input.ts）。 */
  private phoneLogical = false;
  /** F-PLAYER-CANVAS-COMPOSE-P0：共享 PlayerViewportTransform（playerMode 由 main.ts 注入；
   *  无共享实例时保持既有独立 applyPhoneScale 行为——测试/非玩家路径不变）。 */
  private viewportTransform: PlayerViewportTransform | null = null;
  private canvas: HTMLCanvasElement;
  // F-PLAYER-SINGLE-CANVAS-RECOVERY-P0：玩家模式「唯一可见屏幕画布」引用（Renderer canvas）。
  // this.canvas 在屏幕合成模式下改为离屏绘制目标（不进入 DOM），最终由 Renderer 每帧合成到屏幕。
  private screenCanvas: HTMLCanvasElement | null = null;
  // 屏幕合成模式下是否跳过合成（如 scenario 隐藏 UI）；玩家模式永不使用 scenario，恒 false。
  private hideScreen = false;

  constructor(
    canvas: HTMLCanvasElement,
    opts?: { phoneLogical?: boolean; viewportTransform?: PlayerViewportTransform },
  ) {
    this.canvas = canvas;
    this.phoneLogical = !!opts?.phoneLogical;
    // F-PLAYER-CANVAS-COMPOSE-P0：共享 PlayerViewportTransform（玩家模式下与 Renderer
    // Canvas 共用同一变换 → 两画布 CSS rect/contain/backing/DPR 完全一致）。
    this.viewportTransform = opts?.viewportTransform ?? null;
    // F-META-6：读取偏好（platform.storage 无存储环境静默降级为默认开；值 '0' = 关）
    this.soundOn = platform.storage.getItem(PREF_SOUND_KEY) !== '0';
    this.vibrationOn = platform.storage.getItem(PREF_VIBRATION_KEY) !== '0';
  }

  setActions(actions: PlayerUIActions): void {
    this.actions = actions;
  }

  /** F-GARAGE-LIVE-ASSEMBLY-P0：装备成功吸附反馈（挂点金圈 150~220ms） */
  flashEquip(hp: string): void {
    this.equipFlash = { hp, until: this.nowMs + 200 };
    this.draw();
  }

  /**
   * F-WX-RUNTIME-LIFECYCLE-P0（Must#3/4）：宿主在 **切后台 / 输入丢失** 时调用——
   * 清理交互层瞬时状态（按下 / armed / 拖动 ghost / 未闭合手势），保证下一次拖动从 idle
   * 正常开始（Must#11：不继承上一手势的 pointerId、ghost、hover 或 cancel 状态）。
   *
   * 为何必须提供平台无关入口：`installDragSafetyNet()` 依赖 `window`（pointerup/blur/
   * visibilitychange），**微信小游戏无 window → 安全网恒不生效**；微信侧只能由宿主在
   * onHide 显式调用本方法。Web 侧调用同样安全（幂等，无状态则 no-op）。
   *
   * 只清理**交互瞬时状态**，不修改 BuildDraft / 存档 / 装备 / 能量。
   */
  cancelInteraction(): void {
    this.gesture =  null;
    if (this.garageDrag) {
      this.resetGarageDrag('cancelled');
      this.garageDragNotice = null;
    }
    this.draw();
  }

  /**
   * F-WX-IOS-RESUME-VIEWPORT-P0：iOS 切后台返回 / canvas backing 被系统清空或重置后，
   * 强制整页重绘（仅置 dirty 标志，下一帧 renderBattleFrame / render 走完整 ensureSize +
   * clear + 重绘）。
   *
   * 为什么需要：稳态页（Home / Garage 编辑态）在「无状态事件」时 dirty=false → UI Host
   * 不重绘——若 backing 位图已被系统清空（iOS 后台回收）而尺寸未变，顶栏/底栏会持续缺失
   * 直到下一次状态变化（用户回 Home）。syncWechatViewport 在 onShow/resize 恢复后调用本
   * 方法强制重建画面，不依赖旧 Canvas 像素残留。
   *
   * 零副作用：不触碰任何 UI 状态 / Gameplay / Build / 存档；幂等（重复调用无害）。
   */
  forceRedraw(): void {
    this.dirty = true;
  }

  /**
   * F-WX-EXPERIENCE-RC-P0：设置体验版 SHA 水印（game.ts 在 `__WX_BADGE__` 为真时调用）。
   * 传入形如 `#575f1d0` 的短 SHA；传空字符串即关闭（正式发布前可一键关闭）。
   */
  setBuildBadge(text: string): void {
    this.buildBadge = text;
    this.draw();
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
    // F-WX-IOS-CANVAS-CRASH-P0｜Must#6：host 探针（window.__h）仅存在于专用构建。
    // F-WX-E2E-HANDLE-ISOLATION-P0：__h 只归 __E2E_INTERNAL_HANDLE__（E2E 构建专属宏）——
    // 微信诊断构建（WECHAT_DEBUG_INPUT=1 也设 __WX_DEBUG__=true）不得暴露任何内部句柄。
    if (typeof __E2E_INTERNAL_HANDLE__ !== 'undefined' && __E2E_INTERNAL_HANDLE__) {
      (globalThis as { __h?: CanvasPlayerUIHost }).__h = this;
    }
    // 输入唯一入口：Platform Input Adapter（F-WX-4）
    // F-GARAGE-CENTER-STAGE-P0：优先手势（down/move/up + 8px 取消）；平台不支持时回退 tap
    this.bindInput(this.canvas, platform.input.bindPointer.bind(platform.input), (x, y) => this.handlePointer(x, y));
  }

  /**
   * F-PLAYER-SINGLE-CANVAS-RECOVERY-P0｜屏幕合成挂载（玩家模式唯一入口）
   *
   * 与 `mount(parent)` 的区别：
   * - 本方法不把 this.canvas 追加到 DOM——UI 改为离屏绘制目标，不参与 CSS contain / 页面定位 / 点击；
   * - 输入只绑定到唯一可见屏幕 Canvas（screen = Renderer canvas）；WebInput 以该画布 CSS(=逻辑 844×390)
   *   与可视 rect(contain) 自动归一化 → 逻辑坐标一次到位（client→contain→logical 只转换一次）；
   * - 每帧由 Renderer 把离屏 UI（compositeCanvas）合成到 screen 的最终 backing（1:1 映射到 844×390 逻辑舞台）。
   *
   * 非玩家 / DEV 桌面模式仍走 `mount(parent)`（保留既有双画布独立路径，不在本 Queue 改造范围）。
   */
  mountScreen(screen: HTMLCanvasElement, parent: HTMLElement): void {
    this.parent = parent;
    this.screenCanvas = screen;
    // this.canvas 成为离屏绘制目标（不进入 DOM）
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D not supported');
    this.ctx = ctx;
    this.viewport = platform.createViewport(this.canvas);
    // F-WX-RC-BUNDLE-CLEAN-P0｜Must#2：`__h` 内部句柄只归 E2E-only 宏 __E2E_INTERNAL_HANDLE__，
    // 与 __WX_DEBUG_GRANT__（「全部件×1」）、__WX_DEBUG__（微信诊断日志）完全解耦——
    // RC/普通微信/微信诊断构建编译期折叠为零，bundle 中绝不出现 globalThis.__h。
    if (typeof __E2E_INTERNAL_HANDLE__ !== 'undefined' && __E2E_INTERNAL_HANDLE__) {
      (globalThis as { __h?: CanvasPlayerUIHost }).__h = this;
    }
    // 唯一输入入口：绑定到唯一可见屏幕 Canvas（Renderer canvas）
    // F-PLAYER-INPUT-SCALE-P0：传 PlayerViewportTransform.clientToLogical 作统一转换——
    // client → 可见 rect → 844×390 logical 只发生一次（不再依赖 WebInput 的 CSS 归一化巧合，
    // 也杜绝「把 canvas CSS 局部坐标直接当 logical」的整类错位）。
    // F-GARAGE-CENTER-STAGE-P0：优先手势（滑动 8px 取消点击）；不支持时回退 tap。
    const toLogical = this.viewportTransform
      ? (cx: number, cy: number, rect: { left: number; top: number; width: number; height: number }) =>
          this.viewportTransform!.clientToLogical(cx, cy, rect)
      : undefined;
    this.bindInput(screen, platform.input.bindPointer.bind(platform.input), (x, y) => this.handlePointer(x, y), toLogical);
  }

  /** 屏幕合成模式下返回离屏 UI 画布供 Renderer 合成；非屏幕模式（DEV/WebDom）或隐藏时返回 null。 */
  get compositeCanvas(): HTMLCanvasElement | null {
    if (!this.screenCanvas) return null;
    if (this.hideScreen) return null;
    return this.canvas;
  }

  /**
   * F-PLAYER-SINGLE-CANVAS-RECOVERY-P0｜只读诊断：暴露当前 Garage 页签分类。
   * 仅用于 E2E 像素门禁的【验证】读数（不用于生成点击位置），编译期在非 __WX_DEBUG__ 构建中无引用。
   */
  getGarageCategory(): 'body' | 'move' | 'combat' {
    return this.garageCategory;
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
    this.bindInput(this.canvas, platform.input.bindPointer.bind(platform.input), (x, y) => this.handlePointer(x, y));
  }

  /**
   * F-GARAGE-CENTER-STAGE-P0：输入绑定统一入口——优先 bindGesture（down/move/up + 滑动取消），
   * 平台/测试桩无 bindGesture 时回退 bindPointer（纯 tap，语义与旧行为完全一致）。
   */
  private bindInput(
    target: EventTarget,
    bindTap: (target: EventTarget, handler: (x: number, y: number) => void, toLogical?: (cx: number, cy: number, rect: { left: number; top: number; width: number; height: number }) => { x: number; y: number }) => void,
    tapHandler: (x: number, y: number) => void,
    toLogical?: (cx: number, cy: number, rect: { left: number; top: number; width: number; height: number }) => { x: number; y: number },
  ): void {
    const g = platform.input.bindGesture;
    if (g) {
      // F-GARAGE-CENTER-STAGE-P0：用 .call 绑定 this（input adapter 在调用时不传 this 上下文，
      // 否则 WechatInput.this.wx getter 抛 TypeError）
      g.call(platform.input, target, {
        onDown: (x, y, meta) => this.gestureDown(x, y, meta),
        onMove: (x, y) => this.gestureMove(x, y),
        onUp: (x, y, cancelled) => this.gestureUp(x, y, cancelled, tapHandler),
        // F-GARAGE-DRAG-CONTINUITY-R1（Must#1）：仅「装配带卡片起点」才 pointer capture——
        // 不全局捕获，普通点击/挂点点击/其他页面输入语义完全不变。
        captureOnDown: (x, y) => !!this.garageCardAt(x, y),
        // Must#2：仅在活跃 Garage 拖动期间阻止页面默认滚动（微信 touchmove）
        preventDefaultOnMove: () => this.isGarageDragActive(),
      }, toLogical);
    } else {
      bindTap(target, tapHandler, toLogical);
    }
    // F-GARAGE-DRAG-ASSEMBLY-P0：所有挂载路径统一安装拖动安全网（Must#10）
    this.installDragSafetyNet();
  }

  render(state: PlayerUIState): void {
    // F-LOSS-ADJUST-REMATCH-LOOP-P0（Must#4）：Result「调整配置」→ 直接进入 Garage 中央装配舞台。
    // 从 ended（结算卡）离开 → playerPhase=garage 时，metaPage 若仍为 home（进战斗前首页态）
    // 会停在首页而非装配台（Garage dock/挂点不可见）——此处按 state 转换切入装配页。
    const prevState = this.lastState;
    if (prevState && prevState.battleState === 'ended' && state.battleState === 'editing' && state.playerPhase === 'garage') {
      this.metaPage = 'garage';
      this.panelView = 'home';
      // F-GARAGE-ADJUST-REMATCH-P0（Must#2）：本次装配台会话来自战败 Result「调整配置」——
      // 瞬时上下文置位（「完成并再战」按钮随之显示）；normal（Home→Garage）路径不置位。
      this.garageFromResult = true;
    }
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
    }
    // F-GARAGE-DRAG-ASSEMBLY-P0（Must#10 / Acceptance J）：离开 Garage 立即清理拖动状态——
    // 返回首页 / 进战斗 / 结果页后无残留 ghost 与 armed 卡片。
    if (state.playerPhase !== 'garage' && this.garageDrag) {
      this.resetGarageDrag('idle');
      this.garageDragNotice = null;
    }
    // F-META-1：离开局外（进 Matching/Battle/Result）时复位 MetaPage——回 Garage 后默认回车库页
    if (state.playerPhase !== 'garage') this.metaPage = 'home'; // F-HOME-1：离开局外回 Home（正式首页）
    // F-GARAGE-ADJUST-REMATCH-P0（Must#2）：进入 Matching / 新 Battle → 瞬时上下文清除
    //（「完成并再战」不再显示；重启应用自然不恢复——上下文从不落盘）。
    if (state.playerPhase !== 'garage') this.garageFromResult = false;
    // F-HOME-3：离开局外同时复位车辆气泡 tips（回 Home 默认不显示）
    if (state.playerPhase !== 'garage') this.vehicleTip = null;
    // F-GARAGE-INVENTORY-FUSION-P0：离开局外同时复位 Backpack 状态（回 Garage 默认战斗/未选/无反馈）
    if (state.playerPhase !== 'garage') {
      this.backpackFilter = 'combat';
      this.backpackSelected = null;
      this.fuseToast = null;
    }
    // F-UX-2C：离开局外同时复位 Backpack 分页（回 Garage 默认第一页）
    if (state.playerPhase !== 'garage') this.backpackPage = 0;
    // F-META-6：离开局外同时复位 More 子视图（回 Garage 默认功能卡主页）
    if (state.playerPhase !== 'garage') this.moreView = 'home';
    // F-GARAGE-INVENTORY-FUSION-P0：合成反馈改为背包页内轻量 fuseToast（见 drawBackpackPage），
    // 不再弹「合成成功」结果 Modal；此处不再消费 mergeSnapshot（已移除）。
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
    // F-WX-RC-SAFE-BADGE-P0（Must#2）：RC 版号每帧在所有世界场景与 UI 合成之后最后绘制——
    // 不依赖 dirty / 离屏残留（wx.onWindowResize 清空 backing 后下一帧即恢复；稳态页 120 帧持续存在）。
    this.drawBuildBadge();
  }

  /**
   * F-WX-RC-SAFE-BADGE-P0｜RC 版号水印（每帧最后绘制；iOS 横屏安全区 + 高对比 + 不挡点击）。
   *
   * - 触发：renderBattleFrame 每帧无条件调用（Must#2「不得只在启动第一帧绘制」）。
   * - 位置：F-WX-SAFE-AREA-P0 统一顶部三区契约的 badge 锚点（左上角、顶部信息行之下 4px）——
   *   完整包围盒钳制在安全区内（Must#3）；不覆盖头像/货币/返回/HP/Matching·Locked 状态
   *   （Must#5）。insets 每帧实时读 viewport.safeInsets()（logical px；wx safeArea + 胶囊
   *   折叠契约）→ 横屏方向改变 / 窗口 resize 后首帧即按新安全区重算（Must#7）。
   * - 样式：半透明深色底 + 纯白粗体、字号 11 logical px（Must#4；绕开 fontScale 0.8 的
   *   mobile-short 收缩——诊断水印不随 UI 风格缩放；绘制经 DPR 变换放大到 backing）。
   * - 层级：save → 显式 source-over + DPR 单次 logical→backing 变换 → 绘制 → restore（Must#2）。
   * - 不注册 hitArea → 不影响点击（Must#4）；buildBadge 为空（普通 build:wechat）→ 恒跳过。
   */
  private drawBuildBadge(): void {
    const text = this.buildBadge;
    if (!text) return;
    const ctx = this.ctx;
    const dpr = Math.max(1, this.dpr);
    const ins = this.viewport?.safeInsets() ?? this.insets;
    const W = this.cssW > 0 ? this.cssW : (this.canvas.width > 0 ? this.canvas.width / dpr : BASE_W);
    const H = this.cssH > 0 ? this.cssH : (this.canvas.height > 0 ? this.canvas.height / dpr : BASE_H);
    const pad = 4; // logical px 内边距
    const size = 11; // logical px 字号（≥11）
    const w = Math.ceil(text.length * Math.ceil(size * 0.62)) + pad * 2;
    const h = size + pad * 2;
    // 锚点：统一顶部三区契约的 badge 低干扰位（避开左侧信息区/头像/货币/返回/HP/状态）。
    // 越界时右/下对齐钳回安全区（完整包围盒不超 safeArea）。
    const areas = computeTopSafeAreas({ w: W, h: H }, ins, this.profile);
    let bx = areas.badge.x;
    let by = areas.badge.y;
    if (bx + w > W - ins.right) bx = Math.max(ins.left, W - ins.right - w);
    if (by + h > H - ins.bottom) by = Math.max(ins.top, H - ins.bottom - h);
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // logical → backing 单次（DPR 只应用一次）
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(bx, by, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${size}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + pad, by + h / 2);
    ctx.restore();
  }

  /** 测试钩子：当前命中区域（布局坐标：Desktop=1280×720 逻辑；Mobile=逻辑 px/CSS px） */
  getHitAreasForTest(): ReadonlyArray<HitArea> {
    return this.hitAreas;
  }

  /** F-PLAYER-UI-HITMAP-P0：E2E 真实像素门禁用——暴露当前 host 实际使用的变换（绘制与命中同源）。
   *  供 e2e 把命中区中心换算到「真实绘制的可见页面坐标」：drawnCss = (ox + scale·(x+w/2), oy + scale·(y+h/2))。 */
  getTransformInfo(): { scale: number; ox: number; oy: number; cssW: number; cssH: number; dpr: number } {
    return { scale: this.scale, ox: this.ox, oy: this.oy, cssW: this.cssW, cssH: this.cssH, dpr: this.dpr };
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

  /**
   * F-GARAGE-CENTER-STAGE-P0：手势状态机（bindGesture 驱动）——
   * 指针按下后累计位移；任一点相对起点位移 > 8 logical px → cancelled（up 时不再 dispatch）。
   * 横向滑动（起点在部件卡带内）驱动卡带滚动；其余方向仅取消点击（不误触挂点/分类/顶栏）。
   */
  private gestureDown(x: number, y: number, meta?: PointerMeta): void {
    this.gesture = { px: x, py: y, dx: 0, dy: 0, cancelled: false };
    // F-GARAGE-DRAG-ASSEMBLY-P0：装配带卡片按下 → partPressed（记录卡片，等方向锁判定 Must#16）
    const card = this.garageCardAt(x, y);
    if (card) {
      this.garageDrag = {
        phase: 'partPressed',
        startX: x,
        startY: y,
        x,
        y,
        card: card.card,
        slot: card.slot,
        cardRect: card.rect,
        hoverHp: null,
        overload: false,
        submitted: false,
        armed: false,
        notice: null,
        // Must#11：pointerId/pointerType 随手势建立，手势结束时一并清空（不继承到下一次）
        pointerId: meta?.pointerId ?? null,
        pointerType: meta?.pointerType ?? null,
      };
      this.garageDragNotice = null;
      // Must#5：按下即重绘 → 卡片「抬起/压暗」反馈（无需等 80ms 定时器，下一帧即见）
      this.draw();
      return;
    }
    // 非卡片按下 → 清理上一轮 armed（Must#15：点击空白处取消）。
    // 例外：点挂点（hp-sel:）是 armed 的**第二步**，不能在此清理（否则点挂点永远无效）。
    if (this.garageDrag?.armed && !(this.hitIdAt(x, y) ?? '').startsWith('hp-sel:')) {
      this.resetGarageDrag('idle');
      this.draw();
    }
  }

  /** 命中测试：布局坐标下最上层 hitArea 的 id（无命中 → null）。 */
  private hitIdAt(x: number, y: number): string | null {
    const p = this.screenToLayoutPoint(x, y);
    for (let i = this.hitAreas.length - 1; i >= 0; i--) {
      const a = this.hitAreas[i];
      if (p.x >= a.x && p.x <= a.x + a.w && p.y >= a.y && p.y <= a.y + a.h) return a.id;
    }
    return null;
  }

  private gestureMove(x: number, y: number): void {
    const g = this.gesture;
    if (!g) return;
    const mx = x - g.px;
    const my = y - g.py;
    g.px = x;
    g.py = y;
    g.dx += mx;
    g.dy += my;
    const d = this.garageDrag;

    // —— Garage 拖动方向锁（Must#16 + F-GARAGE-DRAG-CONTINUITY-R1 Must#3/4）——
    // 判定全部基于【从起点累计位移 g.dx/g.dy】（Must#3），绝不使用相邻两帧位移。
    if (d && d.phase === 'partPressed') {
      const adx = Math.abs(g.dx);
      const up = -g.dy; // 向上累计位移（正 = 向车辆/上方离开卡带）
      // Must#4：向上离开卡带累计 ~5~7px 即进入拖动（取 6）
      const DRAG_START = 6;
      // 明显横滑才进入滚动（横向显著主导；避免斜向拖被误判为浏览）
      const SCROLL_LOCK = 10;
      // Must#4：兼容真实手势的斜向抖动——不要求 ady > adx，只要求向上分量为主导之一
      // （实测旧式 `ady > adx` 会让「卡(66,345)→挂点(280,181)」这类最自然斜拖
      //   被判成横滑 → ghost 一帧不出现，必须重复拖动）。
      const wantDrag = up >= DRAG_START && up >= adx * 0.6;
      const wantScroll = adx >= SCROLL_LOCK && adx > up * 1.6;
      if (wantDrag && !d.card?.locked) {
        d.phase = 'draggingPart';
        g.cancelled = true; // 进入拖动 → 本次手势不再派发 tap
        this.garageDragNotice = null;
        // Must#6：进入 draggingPart 的**同一帧**立即重绘 → ghost 从第一帧就出现
        // （旧实现缺此 draw()，ghost 要等下一次 move 才出现 → 观感「迟出现/突然出现」）
        this.draw();
      } else if (wantScroll) {
        d.phase = 'stripScrolling';
        g.cancelled = true; // 一旦横滑，本次手势不得装备
        this.draw();
      }
    }
    if (d && d.phase === 'stripScrolling') {
      // Must#16：横滑中卡带继续滚动，本次手势不装备
      if (this.isStripGestureTarget()) this.scrollStripBy(-mx);
      return;
    }
    if (
      d &&
      (d.phase === 'draggingPart' || d.phase === 'hoveringValidMount' || d.phase === 'hoveringInvalidMount')
    ) {
      d.x = x;
      d.y = y;
      const val = d.card?.v ?? EMPTY_SLOT;
      const m = this.garageNearestMount(x, y);
      if (m) {
        d.hoverHp = m.hp.id;
        d.overload = this.garagePredictOverload(m.slot, val);
        d.phase = d.overload ? 'hoveringInvalidMount' : 'hoveringValidMount';
      } else if (this.garageCategory === 'body' && this.garageBodyDropHit(x, y)) {
        // Must#12：车身卡拖到车辆主体区域
        d.hoverHp = null;
        d.overload = this.garagePredictOverload('body', val);
        d.phase = d.overload ? 'hoveringInvalidMount' : 'hoveringValidMount';
      } else {
        d.hoverHp = null;
        d.overload = false;
        d.phase = 'draggingPart';
      }
      this.draw();
      return;
    }
    // —— 非卡片起点的既有行为：滑动 >8px 取消点击；装配带内横滑滚动 ——
    if (g.cancelled) return;
    if (Math.hypot(g.dx, g.dy) > 8) {
      g.cancelled = true;
      const row = this.stripCardRow;
      if (row && this.isStripGestureTarget()) {
        this.scrollStripBy(-mx);
      }
    }
  }

  private gestureUp(
    x: number,
    y: number,
    cancelled: boolean,
    tapHandler: (x: number, y: number) => void,
  ): void {
    const g = this.gesture;
    const d = this.garageDrag;
    this.gesture = null;
    // —— Garage 拖动收尾（一次手势最多提交一次装备）——
    if (d) {
      const dragging =
        d.phase === 'draggingPart' || d.phase === 'hoveringValidMount' || d.phase === 'hoveringInvalidMount';
      if (cancelled) {
        this.resetGarageDrag('cancelled'); // Must#10：系统取消 → 只清理，配置不变
        this.draw();
        return;
      }
      if (dragging) {
        this.commitGarageDrag(x, y);
        this.draw();
        return;
      }
      if (d.phase === 'partPressed' && !d.armed) {
        this.armGarageCard(x, y, tapHandler); // 位移 <8px → 点击备用路径（Must#15）
        return;
      }
      if (d.armed) {
        // F-GARAGE-DRAG-ASSEMBLY-P0：armed 状态下本次 up 走正常派发——点挂点由
        // dispatch('hp-sel:') → commitArmedToHardpoint 完成装备（Must#15 第二步）。
        // armed 的取消只发生在「按下非卡片区域」（gestureDown）与「切换分类」（dispatch）。
        tapHandler(x, y);
        return;
      }
      this.resetGarageDrag('cancelled');
      this.draw();
      return;
    }
    if (cancelled || (g && g.cancelled)) return; // 滑动/系统取消 → 不派发
    tapHandler(x, y);
  }

  /** 手势横滑滚动目标判定：仅 Garage 装配页（metaPage=garage + playerPhase=garage） */
  private isStripGestureTarget(): boolean {
    return this.metaPage === 'garage' && this.lastState?.playerPhase === 'garage';
  }

  /** 部件带横向滚动（钳制到 [0, maxScroll]）；maxScroll 由当前帧卡片带宽度计算 */
  private scrollStripBy(dx: number): void {
    const row = this.stripCardRow;
    if (!row) return;
    const maxScroll = Math.max(0, this.stripContentW - row.w);
    this.garageStripScroll = Math.max(0, Math.min(maxScroll, this.garageStripScroll + dx));
    this.draw();
  }

  /** 当前分类部件带内容总宽（绘制时计算并缓存；供滚动钳制与箭头步长使用） */
  private stripContentW = 0;

  // ==========================================================================
  // F-GARAGE-DRAG-ASSEMBLY-P0｜底部部件 → 真实挂点 拖放装配
  // 全部坐标均为 logical px（client→logical 由 PlatformInput 上游转换一次，Must#2）。
  // 状态只存在于本交互层；非 garage 阶段 / 非装配带起点不进入任何分支。
  // ==========================================================================

  /** 拖动状态机复位（清 ghost / 高亮 / 提交标志）。不修改任何 BuildDraft。 */
  private resetGarageDrag(phase: GarageDragPhase): void {
    this.garageDrag = phase === 'idle' ? null : { ...(this.garageDrag ?? this.emptyDrag()), phase };
    if (phase === 'idle' || phase === 'completed' || phase === 'cancelled') this.garageDrag = null;
  }

  /**
   * F-GARAGE-DRAG-CONTINUITY-R1：是否处于【活跃拖动】（draggingPart / hovering*）。
   * 用途：①微信 touchmove 的 preventDefault 谓词（Must#2：仅拖动期间阻止页面滚动，
   * 不全局拦截）；②门禁断言「capture 在结束后归零」的运行时依据。
   * partPressed（尚未判定方向）与 stripScrolling 不算活跃拖动。
   */
  private isGarageDragActive(): boolean {
    const p = this.garageDrag?.phase;
    return p === 'draggingPart' || p === 'hoveringValidMount' || p === 'hoveringInvalidMount';
  }

  private emptyDrag(): GarageDragSnapshot {
    return {
      phase: 'idle',
      startX: 0,
      startY: 0,
      x: 0,
      y: 0,
      card: null,
      slot: null,
      cardRect: null,
      hoverHp: null,
      overload: false,
      submitted: false,
      armed: false,
      notice: null,
      pointerId: null,
      pointerType: null,
    };
  }

  /**
   * 装配带卡片布局（绘制与命中的**唯一**来源，避免两套坐标）。
   * 与 drawGarageStripCards 同源：cardW / gap / 起始 x / 滚动偏移全部一致。
   */
  private garageStripCardLayout(
    state: PlayerUIState,
    draft: BuildDraft,
    row: { x: number; y: number; w: number; h: number },
  ): { opts: GarageOpt[]; curVal: string; cardW: number; gap: number; startX: number } | null {
    const slot = state.garageSelected;
    const allSlots = this.garageSlotsFor(draft);
    if (!slot || !allSlots.some((s) => s.key === slot)) return null;
    const opts = this.garageOptionsFiltered(state, slot);
    const gap = this.isShort ? 6 : 8;
    const cardW = this.isShort ? 100 : 132;
    return { opts, curVal: this.garageCurrentValue(draft, slot), cardW, gap, startX: row.x - this.garageStripScroll };
  }

  /**
   * F-CONTENT-PACK-REAL-UI-R1｜部件带滚动钳制（单一真源）。
   * 将 garageStripScroll 限制在 [0, maxScroll]，其中 maxScroll = 内容总宽 − 行宽，
   * 内容总宽由当前分类 opts 推导（与 garageStripCardLayout 同源）。必须在「计算卡片布局 /
   * 注册 hitArea / 手势命中」之前调用——箭头步进若先以未钳制值改 scroll、再在绘制时钳制，
   * 会导致同一帧 hitArea 落在过滚位置（点卡装错卡）。
   * 调用点：strip-scroll 箭头步进后、drawGarageStripCards 布局前、手势横滑 scrollStripBy。
   */
  private clampGarageStripScroll(
    state: PlayerUIState,
    draft: BuildDraft,
    row: { x: number; y: number; w: number; h: number },
  ): void {
    const lay = this.garageStripCardLayout(state, draft, row);
    if (!lay) return;
    const { opts, cardW, gap } = lay;
    const contentW = opts.length > 0 ? opts.length * cardW + (opts.length - 1) * gap : row.w;
    const maxScroll = Math.max(0, contentW - row.w);
    if (this.garageStripScroll > maxScroll) this.garageStripScroll = maxScroll;
    if (this.garageStripScroll < 0) this.garageStripScroll = 0;
  }

  /** 命中装配带内的一张部件卡（完全可见的卡才注册命中，与 drawGarageStripCards 一致）。 */
  private garageCardAt(
    x: number,
    y: number,
  ): { card: GarageOpt; slot: string; rect: { x: number; y: number; w: number; h: number } } | null {
    const state = this.lastState;
    const row = this.stripCardRow;
    if (!state || !state.draft || !row) return null;
    if (!this.isStripGestureTarget()) return null;
    if (y < row.y || y > row.y + row.h) return null;
    const lay = this.garageStripCardLayout(state, state.draft, row);
    if (!lay) return null;
    let cx = lay.startX;
    for (const c of lay.opts) {
      const fully = cx >= row.x - 0.5 && cx + lay.cardW <= row.x + row.w + 0.5;
      if (fully && x >= cx && x <= cx + lay.cardW) {
        return { card: c, slot: state.garageSelected as string, rect: { x: cx, y: row.y, w: lay.cardW, h: row.h } };
      }
      cx += lay.cardW + lay.gap;
    }
    return null;
  }

  /**
   * 当前拖动部件的**兼容挂点**集合（Must#5/13/14）——
   * 坐标直接取 Renderer 真实 hardpointScreenPts（Must#6：不按图片重估、不加 DPR 补偿、不用固定坐标）。
   */
  private garageDragTargets(): Array<{ hp: GarageHardPt; slot: string }> {
    const d = this.garageDrag;
    const state = this.lastState;
    if (!d || !d.card || !state) return [];
    const pts = state.hardpointScreenPts ?? [];
    const out: Array<{ hp: GarageHardPt; slot: string }> = [];
    if (this.garageCategory === 'move') {
      // 移动：轮径卡 → 真实 movement 挂点（rear→后轮 / front→前轮）；
      // 驱动卡（前进/停驻）语义作用于「轮子的驱动」→ 任一 movement 挂点均为合法落点。
      const isDrive = d.card.v === 'forward' || d.card.v === 'stationary';
      for (const p of pts) {
        if (p.kind !== 'movement') continue;
        const slot = isDrive ? 'drive' : p.id === 'rear' ? 'rearWheel' : p.id === 'front' ? 'frontWheel' : null;
        if (slot) out.push({ hp: p, slot });
      }
      return out;
    }
    if (this.garageCategory === 'combat') {
      // 战斗：functional 挂点（Weapon / Gadget 共享孔位——见 core/types.ts FunctionalHardpointDef 注释；
      // 数据层无挂点类别约束，故武器/辅助均落到 functional 挂点，判定不引入新规则）。
      for (const p of pts) if (p.kind === 'functional') out.push({ hp: p, slot: p.id });
      return out;
    }
    return out; // 车身：无挂点歧义（走车辆主体区域，见 garageBodyDropHit）
  }

  /**
   * 挂点圆环视觉半径与释放判定半径——**同一常量派生**（Must#7）。
   * 视觉上进入圆环必然判定成功（release ≥ ring）。
   */
  private garageMountRadius(): { ring: number; release: number } {
    const tiny = this.isShort || (this.cssW > 0 && this.cssW <= 430);
    return tiny ? { ring: 8, release: 22 } : { ring: 11, release: 28 };
  }

  /** 最近的**兼容**挂点（Must#6：重叠时取距离最近，不取数组第一个）。超出释放半径 → null。 */
  private garageNearestMount(x: number, y: number): { hp: GarageHardPt; slot: string } | null {
    const targets = this.garageDragTargets();
    if (targets.length === 0) return null;
    const { release } = this.garageMountRadius();
    let best: { hp: GarageHardPt; slot: string } | null = null;
    let bestD = Infinity;
    for (const t of targets) {
      const dist = Math.hypot(x - t.hp.x, y - t.hp.y);
      if (dist < bestD) {
        bestD = dist;
        best = t;
      }
    }
    return best && bestD <= release ? best : null;
  }

  /** 车身卡落点：中央舞台（车辆主体区域；布局源 stageRect，非像素估算、非固定坐标）。 */
  private garageBodyDropHit(x: number, y: number): boolean {
    const s = this.garageStageRect;
    if (!s) return false;
    return x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h;
  }

  /**
   * 能量预检（Must#11：不先装备再回滚）——在**克隆 Draft** 上估算能量，
   * 全程不修改真实 loadout（Forbidden：悬停阶段不改真实 BuildDraft）。
   */
  private garagePredictOverload(slot: string, value: string): boolean {
    return this.garagePredictEnergy(slot, value).overload;
  }

  private garagePredictEnergy(slot: string, value: string): { used: number; capacity: number; overload: boolean } {
    const state = this.lastState;
    const draft = state?.draft;
    if (!draft || !slot) return { used: 0, capacity: 0, overload: false };
    const body = registry.bodies.get(draft.bodyDefId);
    const capacity = body?.energyCapacity ?? 0;
    const next: BuildDraft = {
      ...draft,
      functionalSelections: { ...draft.functionalSelections },
      functionalStars: { ...(draft.functionalStars ?? {}) },
    };
    if (slot === 'body') {
      const migrated = migrateDraftBody(draft, value, registry);
      next.bodyDefId = migrated.bodyDefId;
      next.functionalSelections = migrated.functionalSelections;
    } else if (slot === 'rearWheel') {
      next.rearRadius = Number(value);
    } else if (slot === 'frontWheel') {
      next.frontRadius = Number(value);
    } else if (slot === 'drive') {
      next.drive = value as DriveMode;
    } else if (value === EMPTY_SLOT) {
      next.functionalSelections[slot] = EMPTY_SLOT;
    } else {
      const { defId, star } = decodePartVal(value);
      next.functionalSelections[slot] = defId;
      next.functionalStars = next.functionalStars ?? {};
      next.functionalStars[slot] = star;
    }
    const res = computeEnergy(buildSnapshotFromDraft(next, registry, 'customA'), registry);
    const used = res.error || !Number.isFinite(res.energy) ? Number.NaN : res.energy;
    return { used, capacity, overload: Number.isFinite(used) && used > capacity };
  }

  /** 超载差值文案（装配带内显示；Must#11「底部装配带显示超载差值」） */
  private garageOverloadText(slot: string, value: string): string {
    const { used, capacity } = this.garagePredictEnergy(slot, value);
    if (!Number.isFinite(used)) return '能量超载';
    return `超载 +${Math.round(used - capacity)}`;
  }

  /** 装备提交单点：切槽 → 走现有 onPickGarageOption 链路一次 → 吸附反馈。 */
  private equipGaragePart(slot: string, value: string, hpId: string | null): void {
    if (this.lastState?.garageSelected !== slot) this.actions?.selectGarageSlot?.(slot);
    this.actions?.onPickGarageOption?.(value);
    if (hpId) this.flashEquip(hpId);
  }

  /** 拖动释放（Must#8/9/10/11）：仅有效挂点提交一次；无效释放只清理状态。 */
  private commitGarageDrag(x: number, y: number): void {
    const d = this.garageDrag;
    if (!d || !d.card) {
      this.resetGarageDrag('idle');
      return;
    }
    if (d.submitted) {
      this.resetGarageDrag('idle');
      return;
    }
    const m = this.garageNearestMount(x, y);
    let slot: string | null = m ? m.slot : null;
    let hpId: string | null = m ? m.hp.id : null;
    if (!slot && this.garageCategory === 'body' && this.garageBodyDropHit(x, y)) {
      slot = 'body';
      hpId = null;
    }
    if (!slot) {
      // Must#10：松开在车辆空白 / 不兼容位置 → ghost 返回，配置不变
      this.resetGarageDrag('cancelled');
      return;
    }
    if (this.garagePredictOverload(slot, d.card.v)) {
      // Must#11：预计超载 → 不装备、不回滚（从未装备过），装配带显示差值
      this.garageDragNotice = this.garageOverloadText(slot, d.card.v);
      this.resetGarageDrag('cancelled');
      return;
    }
    d.submitted = true;
    this.garageDragNotice = null;
    this.equipGaragePart(slot, d.card.v, hpId);
    this.resetGarageDrag('completed');
  }

  /**
   * 点击备用路径（Must#15）：卡片按下后位移 <8px 松开 →
   *  - 未获得：显示锁定原因，不进入 armed；
   *  - 目标唯一且无歧义（或车身）→ 单击直接装备；
   *  - 否则 armed：兼容挂点亮起，等玩家点挂点（不自动装到默认挂点）。
   */
  private armGarageCard(x: number, y: number, tapHandler: (x: number, y: number) => void): void {
    const d = this.garageDrag;
    if (!d || !d.card) {
      this.resetGarageDrag('idle');
      tapHandler(x, y);
      return;
    }
    if (d.card.locked) {
      this.garageDragNotice = '未获得该部件';
      this.resetGarageDrag('idle');
      this.draw();
      return;
    }
    const targets = this.garageDragTargets();
    if (this.garageCategory === 'body') {
      if (this.garagePredictOverload('body', d.card.v)) {
        this.garageDragNotice = this.garageOverloadText('body', d.card.v);
        this.resetGarageDrag('idle');
        this.draw();
        return;
      }
      d.submitted = true;
      this.equipGaragePart('body', d.card.v, null);
      this.resetGarageDrag('completed');
      this.draw();
      return;
    }
    if (targets.length === 1) {
      const t = targets[0];
      if (this.garagePredictOverload(t.slot, d.card.v)) {
        this.garageDragNotice = this.garageOverloadText(t.slot, d.card.v);
        this.resetGarageDrag('idle');
        this.draw();
        return;
      }
      d.submitted = true;
      this.equipGaragePart(t.slot, d.card.v, t.hp.id);
      this.resetGarageDrag('completed');
      this.draw();
      return;
    }
    // 多挂点 → armed（兼容挂点点亮，等待玩家点选；不自动装备）
    this.garageDragNotice = null;
    this.garageDrag = { ...d, phase: 'partPressed', armed: true, notice: null };
    this.draw();
  }

  /** armed 状态下点击某个挂点 → 装备到该挂点（点击备用路径第二步）。 */
  private commitArmedToHardpoint(hpId: string): boolean {
    const d = this.garageDrag;
    if (!d || !d.armed || !d.card) return false;
    const t = this.garageDragTargets().find((it) => it.hp.id === hpId);
    if (!t) return false;
    if (this.garagePredictOverload(t.slot, d.card.v)) {
      this.garageDragNotice = this.garageOverloadText(t.slot, d.card.v);
      this.resetGarageDrag('idle');
      this.draw();
      return true;
    }
    d.submitted = true;
    this.equipGaragePart(t.slot, d.card.v, t.hp.id);
    this.resetGarageDrag('completed');
    this.draw();
    return true;
  }

  /**
   * Must#10：系统取消 / 拖出 Canvas / 页面失焦 → 清理 ghost 与拖动状态，配置不变。
   *
   * 清理**除 armed 之外**的全部拖动状态：
   * - draggingPart / hovering*：拖出 Canvas、pointercancel、页面失焦 → ghost 必须消失（Must#10）；
   * - stripScrolling / partPressed：指针在画布外松开时 canvas 收不到 pointerup，只有本兜底
   *   能复位（否则状态残留会吞掉后续手势）；
   * - armed（点击备用路径，Must#15）例外：它由手势自身管理（点空白 / 切分类才取消）。
   *   若在此一并清理，canvas 的 pointerup 冒泡到 window 会立即清掉刚建立的 armed
   *   → 点击备用路径永远不可用。
   */
  private cancelGarageDrag(): void {
    const d = this.garageDrag;
    if (!d) return;
    if (d.armed) return;
    this.resetGarageDrag('cancelled');
    this.draw();
  }

  /**
   * F-GARAGE-DRAG-ASSEMBLY-P0（Must#10）：拖出 Canvas / 页面失焦 的兜底清理。
   * bindGesture 的 pointerup 绑定在 canvas 上——指针移出画布松开时收不到 up，
   * 故在此补 window 级监听。**只**清理 Garage 局部拖动状态（非 Garage 阶段恒 no-op），
   * 不修改 bindGesture 契约、不触碰任何全局 Battle 输入。
   */
  private installDragSafetyNet(): void {
    if (this.dragSafetyInstalled) return;
    this.dragSafetyInstalled = true;
    // Must#8（切后台清理）：平台生命周期（Web + 微信统一）进入后台（hidden）→ 清理全部手势状态。
    // 微信无 window → 旧的 window 级安全网恒不生效；此处用平台生命周期覆盖两端，
    // 与 cancelInteraction 注释「微信侧只能由宿主在 onHide 显式调用」一致。
    try {
      if (platform && platform.lifecycle && typeof platform.lifecycle.onVisibilityChange === 'function') {
        platform.lifecycle.onVisibilityChange((hidden: boolean) => {
          if (hidden) this.cancelInteraction();
        });
      }
    } catch {
      /* 生命周期缺失环境静默降级 */
    }
    // Web 兜底：window 级 pointerup/cancel/blur/visibilitychange（指针在画布外松开等）
    if (typeof window === 'undefined') return;
    const w = window as unknown as { addEventListener?: (type: string, fn: () => void) => void };
    if (typeof w.addEventListener !== 'function') return;
    const clear = (): void => this.cancelGarageDrag();
    w.addEventListener('pointerup', clear);
    w.addEventListener('pointercancel', clear);
    w.addEventListener('blur', clear);
    w.addEventListener('visibilitychange', clear);
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
    if (id === 'dev-grant-all') {
      // F-DEBUG-GRANT-COVERAGE-P0：先授予（Runtime 入库 + 持久化），按钮「已领取」状态
      // 由 drawDevGrantEntry 每次从真实库存重算（hasAllOfficialDebugContent），不依赖 UI 内存标记。
      this.actions?.onGrantAllParts?.();
      return;
    }
    if (id.startsWith('nav:')) {
      // F-META-1：Main Shell 导航切换（UI-only，不派发 Gameplay action；离开当前页复位面板态）
      // F-GARAGE-INVENTORY-FUSION-P0：背包导航——进入/返回均保留 Result-adjust 上下文
      //（garageFromResult 不清零），满足「返回保持原上下文、不经过 Home、不重建 runtime/session」。
      const page = id.slice(4) as MetaPage;
      if (page === 'backpack') {
        this.metaPage = 'backpack';
        this.backpackSelected = null;
        this.fuseToast = null;
        this.panelView = 'home';
        this.moreView = 'home';
        this.actions?.reframeCamera?.();
        this.draw();
        return;
      }
      if (page === 'garage') {
        // 「‹ 返回车库」→ 回装配页（非首页），保留 Result-adjust 上下文（完成并再战仍可见）
        this.metaPage = 'garage';
        this.backpackSelected = null;
        this.fuseToast = null;
        this.panelView = 'home';
        this.moreView = 'home';
        this.actions?.reframeCamera?.();
        this.draw();
        return;
      }
      // 其余（home/more）：回首页/更多，清除 Result-adjust 上下文
      this.metaPage = page === 'home' ? 'home' : page;
      this.panelView = 'home';
      // F-GARAGE-ADJUST-REMATCH-P0（Must#4）：返回 Home → 瞬时 result-adjust 上下文清除——
      // 玩家保留返回能力（不被强制再战）；再进 Garage 走 normal 路径不显示「完成并再战」。
      this.garageFromResult = false;
      this.garageStripScroll = 0;
      this.moreView = 'home'; // F-META-6：离开 More 复位子视图（下次进入默认功能卡主页）
      this.actions?.reframeCamera?.();
      this.draw();
      return;
    }
    if (id.startsWith('home-') && id !== 'home-find-opponent') {
      // F-HOME-1：正式首页入口——车库进配置页；排行榜/战令/宝箱槽为占位（「功能开发中」，无假数据页）
      // F-NAV-ACTION-OWNERSHIP-P0：home-find-opponent 不在此处理——落到下方 switch case
      // （含「仅正式首页」页面上下文守卫），避免被 home- 通用块吞掉而无法开战。
      // F-HOME-3：点击车辆 → 随机显示 1 条气泡 tips（每次点击重新随机；轻量，非 Modal）
      if (id === 'home-garage') {
        this.metaPage = 'garage';
        // F-GARAGE-CENTER-STAGE-P0：进入装配页（中央舞台全宽取景）→ 重 fit
        this.actions?.reframeCamera?.();
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
      // F-GARAGE-INVENTORY-FUSION-P0：Backpack 分类（战斗/移动/车身；复位分页与选中）
      this.backpackFilter = id.slice(8) as 'combat' | 'movement' | 'body';
      this.backpackPage = 0;
      this.backpackSelected = null;
      this.fuseToast = null;
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
    if (id.startsWith('backpack-select:')) {
      // F-GARAGE-INVENTORY-FUSION-P0：点卡选中（不用拖动）；焦点留原卡，清除上一次合成反馈
      this.backpackSelected = id.slice('backpack-select:'.length);
      this.fuseToast = null;
      this.draw();
      return;
    }
    if (id.startsWith('entry:')) {
      // F-WX-UI-1：车身/驱动一级入口 → 直接展开对应槽
      this.actions?.onToggleGarageSlot(id.slice(6));
      return;
    }
    if (id.startsWith('garage-cat:')) {
      // F-GARAGE-CENTER-STAGE-P0：底部装配带第一行分类 tab（车身/移动/战斗；武器+辅助合并）。
      // 切换分类 → 自动选中该分类第一个挂点（ensureGarageSlotSelection 兜底）；复位部件带滚动。
      const cat = id.slice(11) as 'body' | 'move' | 'combat';
      this.garageCategory = cat;
      this.garageStripScroll = 0;
      const draft = this.lastState?.draft;
      const slots = draft ? this.garageSlotsFor(draft) : [];
      const sel = this.lastState?.garageSelected;
      if (slots.length > 0 && sel !== slots[0].key) {
        this.actions?.onToggleGarageSlot(slots[0].key);
      }
      this.draw();
      return;
    }
    if (id.startsWith('hp-sel:')) {
      // F-GARAGE-LIVE-ASSEMBLY-P0：战车挂点点击（视觉与点击同源）——切换当前挂点。
      // F-GARAGE-CENTER-STAGE-P0：文字挂点页签已删除，挂点选择只通过战车真实挂点完成。
      const hp = id.slice(7);
      // F-GARAGE-DRAG-ASSEMBLY-P0：点击备用路径第二步——armed 卡片点挂点 → 直接装备到该挂点
      if (this.commitArmedToHardpoint(hp)) return;
      this.actions?.selectGarageSlot?.(hp);
      return;
    }
    if (id.startsWith('garage-cat:')) {
      // F-GARAGE-DRAG-ASSEMBLY-P0：切换分类取消 armed（Must#15）——分类目标挂点集合已变，
      // 保留 armed 会导致装到新分类的旧挂点。
      if (this.garageDrag) {
        this.resetGarageDrag('idle');
        this.garageDragNotice = null;
      }
    }
    if (id === 'strip-scroll-left' || id === 'strip-scroll-right') {
      // F-GARAGE-CENTER-STAGE-P0：部件带左右翻页箭头（鼠标辅助；横滑同样驱动）
      const step = Math.max(96, Math.round((this.stripCardRow?.w ?? 240) * 0.8));
      this.garageStripScroll += id === 'strip-scroll-left' ? -step : step;
      // F-CONTENT-PACK-REAL-UI-R1：步进后立即钳制到 [0, maxScroll]，避免未钳制 scroll
      // 进入后续布局/hitArea（绘制时的钳制若晚于布局会导致 hitArea 跳位）。
      if (this.lastState && this.lastState.draft && this.stripCardRow) {
        this.clampGarageStripScroll(this.lastState, this.lastState.draft, this.stripCardRow);
      } else if (this.garageStripScroll < 0) {
        this.garageStripScroll = 0;
      }
      this.draw();
      return;
    }
    if (id.startsWith('unmount:')) {
      // F-CONTENT-PACK-REAL-UI-R1｜Fix 4：移动端轻量卸轮入口（不新弹窗、hitArea 与视觉同源）。
      // 先选中目标轮槽再派发 EMPTY_SLOT——runtime 守卫已放行 EMPTY_SLOT 卸轮（Fix 4a）。
      const slot = id.slice(7) === 'rear' ? 'rearWheel' : 'frontWheel';
      this.actions?.selectGarageSlot?.(slot);
      this.actions?.onPickGarageOption?.(EMPTY_SLOT);
      return;
    }
    if (id === 'panel-back') {
      // F-GARAGE-BUILD-BOARD-P0：装配台无面板内返回（唯一返回 = 左上「‹ 首页」nav:home）。
      // 兼容旧命中（不应出现）：按收起选中槽处理。
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
      case 'home-find-opponent':
      case 'cta-find':
        // F-NAV-ACTION-OWNERSHIP-P0：「寻找对手」只能由正式首页拥有（metaPage=home +
        // playerPhase=garage）。旧 'cta-find' id 仅作兼容，但必须通过页面上下文守卫——
        // Garage/Backpack/More/Matching/Battle/Result 即使收到旧 id 或残留坐标也绝不进入匹配。
        if (this.metaPage === 'home' && this.lastState?.playerPhase === 'garage') {
          this.actions?.onFindOpponent();
        }
        break;
      case 'backpack-fuse': {
        // F-GARAGE-INVENTORY-FUSION-P0：对当前选中卡的 1★ 发起合成（onFuse 内部再校验+保护已装备）。
        // 连续快速点击只执行一次：第一次成功后可用数下降，第二次 canFuse 返回 false → runtime 空操作。
        const defId = this.backpackSelected;
        if (defId) {
          const st = this.lastState;
          const pre = st ? canFuse(st.inventory, defId, 1, st.draft) : { ok: false, available: 0, need: 5, maxStar: false };
          this.actions?.onFuse(defId, 1);
          this.fuseToast = pre.ok ? `合成成功 · 获得 ${this.partDisplayName(defId)} ★★` : null;
        }
        this.draw();
        break;
      }
      case 'result-adjust':
        this.actions?.onResultAdjust();
        break;
      case 'result-next':
        this.actions?.onResultNext();
        break;
      case 'garage-retry':
        // F-GARAGE-ADJUST-REMATCH-P0：装配台「完成并再战」→ 直接进入 Matching（不经过 Home）
        this.actions?.onGarageRetry?.();
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
    this.hideScreen = false;
    this.clear();
    const state = this.lastState;
    if (!state) return;
    // F-HOME-P0-LAYER：首页背景下沉为 renderer underlay（背景层<车辆层<UI层）。
    // 仅「出局外 + metaPage=home」开启；车库/匹配/战斗各自保持背景（不覆盖车辆）。
    const homeScreen = state.uiMode !== 'scenario' && state.playerPhase === 'garage' && this.metaPage === 'home';
    this.actions?.setHomeBackdrop?.(homeScreen);
    // F-GARAGE-CENTER-STAGE-P0：Garage 装配页背景（深蓝车库展示台 + 地面 + 少量灯光）；
    // 与 homeBackdrop 互斥（home 只在 metaPage=home 时开，garage 只在 metaPage=garage 时开）。
    const garageScreen = state.uiMode !== 'scenario' && state.playerPhase === 'garage' && this.metaPage === 'garage';
    this.actions?.setGarageBackdrop?.(garageScreen);
    // F-PREBATTLE-VISUAL-R1：战前（Matching/MatchPreview）启用水果竞技场简化背景；
    // 与 homeBackdrop 互斥（Battle 两者皆关，走 battle 地面）。
    const prebattle = state.playerPhase === 'matching' || state.playerPhase === 'matchPreview';
    this.actions?.setPrebattleBackdrop?.(prebattle);
    // F-BATTLE-PRESENTATION-R2：战斗（fighting/ended）启用正式竞技场背景；与 home/prebattle 互斥。
    // 注意：battleState 进入 fighting 后 playerPhase 仍保持 matchPreview，故不能复用 prebattle 开关。
    const battle = state.battleState === 'fighting' || state.battleState === 'ended';
    this.actions?.setBattleBackdrop?.(battle);
    if (state.uiMode === 'scenario') {
      // DEV Lab 继续 DOM；Canvas 不绘制且不挡指针（微信玩家版无 scenario，永不进入）
      const st = this.canvas.style;
      if (st) {
        st.pointerEvents = 'none';
        st.visibility = 'hidden';
      }
      // 屏幕合成模式：标记跳过合成（离屏 UI 不绘制到屏幕）；玩家模式无 scenario，恒不触发。
      this.hideScreen = true;
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

    // F-WX-RC-SAFE-BADGE-P0：RC 版号水印不再在此绘制——统一由 renderBattleFrame 每帧末尾
    // 无条件调用 drawBuildBadge()（Must#2 每帧最后绘制；稳态页不依赖本 draw 触发）。
  }

  private ensureSize(): void {
    let w: number;
    let h: number;
    let dpr: number;
    if (this.parent) {
      // Web：随容器尺寸 + window.devicePixelRatio（CSS px 布局空间）
      if (this.phoneLogical && this.viewportTransform) {
        // F-PLAYER-CANVAS-COMPOSE-P0：共享 PlayerViewportTransform——尺寸/DPR 单一来源
        // （与 Renderer Canvas 完全一致：logical 844×390 × DPR）。
        w = this.viewportTransform.logicalW;
        h = this.viewportTransform.logicalH;
        dpr = this.viewportTransform.dpr;
      } else if (this.phoneLogical) {
        // F-DEMO-PLAYER-RUNTIME-P0：玩家演示固定手机逻辑画布（844×390），
        // canvas CSS 尺寸 = 逻辑尺寸；视觉放大走 CSS transform（contain 居中，见 applyPhoneScale）。
        w = PHONE_LOGICAL_W;
        h = PHONE_LOGICAL_H;
        dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
      } else {
        w = Math.max(1, this.parent.clientWidth || BASE_W);
        h = Math.max(1, this.parent.clientHeight || BASE_H);
        dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
      }
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
    // F-DEMO-PLAYER-RUNTIME-P0：phoneLogical 固定手机逻辑画布 → 走 Compact Mobile profile（不切 Desktop）
    this.profile = resolveLayoutProfile(
      this.phoneLogical ? PHONE_LOGICAL_W : this.cssW,
      this.phoneLogical ? PHONE_LOGICAL_H : this.cssH,
    );
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
    // F-PLAYER-UI-HITMAP-P0：ctx 变换只负责 DPR（CSS px → device px）。
    // 布局 → CSS 的 scale/ox/oy 已由 rect/text/panel/button 原语手动烤入坐标
    // （this.ox + x*this.scale），此处若再乘 this.scale 会与 screenToLayoutPoint
    // 的反推不一致 → 宽屏（scale≠1）可见像素≠命中区。故 transform 仅 DPR。
    // F-PLAYER-SINGLE-CANVAS-RECOVERY-P0：applyPhoneScale → viewportTransform.applyTo 会重设
    // canvas.width，从而把 ctx transform 重置为 identity；必须在其【之后】回写 DPR 变换，
    // 否则 DPR>1 时 UI 以 identity 绘制 → 仅占 backing 左 1/DPR（金 CTA 中心漂到 50/DPR，整类错位）。
    if (this.phoneLogical && this.parent) this.applyPhoneScale();
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** F-DEMO-PLAYER-RUNTIME-P0：桌面视口（远大于 844×390）下，把手机逻辑画布等比 contain 放大居中，
   *  逻辑布局空间仍为 844×390（isMobile=mobile-normal），点击坐标经 getBoundingClientRect 归一化反算。
   *  F-PLAYER-CANVAS-COMPOSE-P0：共享 PlayerViewportTransform 时（玩家模式）直接复用同一变换
   *  （与 Renderer Canvas 同一 contain scale/offset/backing/DPR）——禁止本端独立算一份放大。 */
  private applyPhoneScale(): void {
    if (this.viewportTransform) {
      this.viewportTransform.applyTo(this.canvas);
      return;
    }
    const pw = this.parent!.clientWidth || PHONE_LOGICAL_W;
    const ph = this.parent!.clientHeight || PHONE_LOGICAL_H;
    const s = Math.min(pw / PHONE_LOGICAL_W, ph / PHONE_LOGICAL_H);
    const st = this.canvas.style;
    st.position = 'absolute';
    st.width = `${PHONE_LOGICAL_W}px`;
    st.height = `${PHONE_LOGICAL_H}px`;
    st.left = `${Math.round((pw - PHONE_LOGICAL_W * s) / 2)}px`;
    st.top = `${Math.round((ph - PHONE_LOGICAL_H * s) / 2)}px`;
    st.transformOrigin = 'top left';
    st.transform = `scale(${s})`;
  }

  /** F-PLAYER-CANVAS-COMPOSE-P0：容器/DPR 变化后把共享变换同步到本画布
   *  （玩家模式 resize 入口；无共享变换时为空操作——独立路径在 ensureSize 内处理）。 */
  syncViewport(): void {
    if (!this.viewportTransform || !this.parent) return;
    this.applyPhoneScale();
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

  /** F-MOBILE-VISUAL-BASE-R1：统一圆角矩形（替代逐处 strokeRect 直角硬边框；分组靠色块/间距/明暗，而非重框） */
  private panel(x: number, y: number, w: number, h: number, fill?: string, stroke?: string, radius: number = V.radiusL): void {
    const ctx = this.ctx;
    const X = this.ox + x * this.scale;
    const Y = this.oy + y * this.scale;
    const W = w * this.scale;
    const H = h * this.scale;
    const r = Math.min(radius * this.scale, W / 2, H / 2);
    ctx.beginPath();
    ctx.moveTo(X + r, Y);
    ctx.arcTo(X + W, Y, X + W, Y + H, r);
    ctx.arcTo(X + W, Y + H, X, Y + H, r);
    ctx.arcTo(X, Y + H, X, Y, r);
    ctx.arcTo(X, Y, X + W, Y, r);
    ctx.closePath();
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = V.strokeW;
      ctx.stroke();
    }
  }

  /** F-MOBILE-VISUAL-BASE-R1：绘制按钮并注册命中区（disabled 时仅绘制，不注册 hit）。
   * 主按钮 = 金黄实底（最深操作权重，白底文字）；次/普通 = 轻量半透明蓝填充、无重框；
   * 选中 = 蓝实底（高对比，区别于普通次级）；锁定 = 橙描边提示。 */
  private button(
    x: number,
    y: number,
    w: number,
    h: number,
    id: string,
    label: string,
    opts: {
      sub?: string;
      active?: boolean;
      locked?: boolean;
      disabled?: boolean;
      /**
       * F-GARAGE-DRAG-CONTINUITY-R1：已装备（中性灰蓝底 + 「已装备」文字）。
       * 与 `active`（亮蓝选中）互斥——已装备**不**用亮蓝，避免与可选卡片混淆。
       */
      equipped?: boolean;
      /** armed（已拿起、尚未装备）：暖金底 + 金描边，与已装备灰态一眼可区分 */
      armed?: boolean;
      primary?: boolean;
      /** F-GARAGE-COMBAT-TAB-R1：战斗主分类强调（更宽/更亮；选中=金橙高亮，未选中仍可识别为主入口且不似已选中） */
      combat?: boolean;
      /** F-GARAGE-BUILD-BOARD-P0：左侧小图标（分类 tab 图形识别；Must#2） */
      icon?: 'body' | 'wheel' | 'weapon' | 'gadget' | 'combat';
    } = {},
  ): void {
    const isCombat = !!opts.combat;
    const fill = opts.disabled
      ? '#22303f'
      : isCombat && opts.active
        ? 'rgba(222,164,52,0.96)' // 选中：金橙实底（主高亮）
        : isCombat
          ? 'rgba(58,44,18,0.62)' // 未选中：暗金底（仍识别为主入口，不似已选中）
          : opts.primary
            ? V.primary
            // F-GARAGE-DRAG-CONTINUITY-R1：已装备 = 中性灰蓝（不用亮蓝）；armed = 暖金
            : opts.armed
              ? V.armedFill
              : opts.equipped
                ? V.equippedFill
                : opts.active
                  ? C.blue
                  : V.secondary;
    const stroke = opts.disabled
      ? C.border
      : isCombat && opts.active
        ? C.gold
        : isCombat
          ? 'rgba(222,164,52,0.72)' // 暗金描边（未选中主入口识别）
          : opts.primary
            ? V.primaryBright
            : opts.armed
              ? V.armedStroke
              : opts.equipped
                ? V.equippedStroke
                : opts.active
                  ? C.blueBright
                  : opts.locked
                    ? V.enemyOrange
                    : V.borderSoft;
    const labelColor = opts.disabled
      ? C.textDark
      : isCombat
        ? (opts.active ? '#1c1405' : '#f4d99c') // 选中深字 / 未选中暖金字（区别于选中）
        : opts.primary
          ? V.primaryText
          : C.text;
    this.panel(x, y, w, h, fill, stroke, V.radiusM);
    // F-WX-UI-1：Mobile 字号层级（主按钮 17 / 卡名 17 / 辅助 14）；Desktop 保持旧值（15/12）
    const labelFs = this.isMobile ? 17 : 15;
    const subFs = this.isMobile ? 14 : 12;
    if (opts.icon) {
      // F-GARAGE-BUILD-BOARD-P0：分类 tab 小图标 + 文字（紧凑；图形识别当前分类）
      this.drawTabIcon(opts.icon, x + (this.isShort ? 12 : 15), y + h / 2, this.isShort ? 6 : 7, !!opts.disabled);
      this.text(label, x + (this.isShort ? 20 : 26), y + h / 2, this.isShort ? 12 : 14, labelColor, 'left', 700);
    } else if (opts.sub) {
      this.text(opts.sub, x + w / 2, y + h * 0.3, subFs, opts.disabled ? C.textDark : C.textDim, 'center');
      this.text(label, x + w / 2, y + h * 0.66, labelFs, labelColor, 'center', 700);
    } else {
      this.text(label, x + w / 2, y + h / 2, labelFs, labelColor, 'center', 700);
    }
    if (!opts.disabled) this.hit(id, x, y, w, h);
  }

  /** F-GARAGE-BUILD-BOARD-P0：分类 tab 小图标（车身/轮/炮/方块）。 */
  private drawTabIcon(kind: 'body' | 'wheel' | 'weapon' | 'gadget' | 'combat', cx: number, cy: number, s: number, disabled: boolean): void {
    const ctx = this.ctx;
    const col = disabled ? C.textDark : V.textPrimary;
    ctx.save();
    ctx.fillStyle = col;
    if (kind === 'body') {
      ctx.fillRect(cx - s * 0.9, cy - s * 0.3, s * 1.8, s * 0.55);
      for (const wx of [cx - s * 0.5, cx + s * 0.5]) {
        ctx.beginPath();
        ctx.arc(wx, cy + s * 0.42, s * 0.2, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (kind === 'wheel') {
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = V.panelSolid;
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.3, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === 'weapon') {
      ctx.fillRect(cx - s * 0.9, cy - s * 0.3, s * 1.5, s * 0.6);
      ctx.beginPath();
      ctx.arc(cx + s * 0.75, cy, s * 0.3, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === 'combat') {
      // F-GARAGE-COMBAT-TAB-R1：战斗图标（闪电——清晰攻击语义）
      ctx.beginPath();
      ctx.moveTo(cx + s * 0.15, cy - s);
      ctx.lineTo(cx - s * 0.5, cy + s * 0.15);
      ctx.lineTo(cx - s * 0.02, cy + s * 0.15);
      ctx.lineTo(cx - s * 0.15, cy + s);
      ctx.lineTo(cx + s * 0.55, cy - s * 0.2);
      ctx.lineTo(cx + s * 0.05, cy - s * 0.2);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillRect(cx - s * 0.55, cy - s * 0.55, s * 1.1, s * 1.1);
    }
    ctx.restore();
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
      this.panel(x, y, w, 40, V.panelSolid);
      this.text(title, x + w / 2, y + 20, 16, V.textPrimary, 'center', 700);
      return;
    }
    this.panel(0, 0, BASE_W, 56, V.panelSolid);
    this.text(title, BASE_W / 2, 28, 18, V.textPrimary, 'center', 700);
  }

  // ==================== Garage ====================

  private drawGarageDock(state: PlayerUIState): void {
    if (this.isMobile) {
      this.drawMobileGarageDock(state);
      return;
    }
    // F-GARAGE-INVENTORY-FUSION-P0：Desktop/Test 模式同样渲染背包/更多二级页（复用 Mobile 布局渲染），
    // 保证背包合成入口在桌面预览与单测中可达（与 mobile 同源单一实现）。
    if (this.metaPage === 'backpack' || this.metaPage === 'more') {
      this.drawMobileGarageDock(state);
      return;
    }
    const draft = state.draft;
    if (!draft) return;
    const dockY = 410;
    this.panel(0, dockY, BASE_W, BASE_H - dockY, C.dockBg, undefined, 0);

    // 顶部状态条（金币 + 段位）
    const p = state.progress;
    const tier = tierOf(p.rating);
    this.text(`金币`, 24, dockY + 26, 13, C.textDim);
    this.text(`${p.coin}`, 24 + 34, dockY + 26, 15, C.gold, 'left', 700);
    this.text(` · ${TIER_LABEL[tier]}`, 24 + 34 + 74, dockY + 26, 13, C.textDim);
    this.text(`${p.rating}`, 24 + 34 + 74 + 92, dockY + 26, 15, C.gold, 'left', 700);

    // F-GARAGE-INVENTORY-FUSION-P0：Garage 顶栏「背包」入口（不进首页；hitArea 与可见按钮同源）
    this.button(BASE_W - 120, dockY + 12, 96, 30, 'nav:backpack', '背包', {});

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

    // F-GARAGE-INVENTORY-FUSION-P0：合成已迁入背包二级页（Garage 顶栏「背包」入口进入），
    // 此处不再承载合成面板（避免与背包页重复/第二套合成入口）。
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
   * F-HOME-IA-R1｜正式小游戏首页（场景式信息架构重做）：
   * ① 顶部：个人信息（左上：头像 + 段位，不含金币，可点 → 占位页）+ 宝箱栏 4 槽（右上）；
   * ② 中央：stageRect 场景（renderer 画背景 underlay + 车辆 previewSolo；不画全宽车辆框/边框）；
   *    车辆可点（点击 → 随机气泡 tips，气泡在车辆上方、不遮挡宝箱/个人信息）；
   * ③ 下方中央：寻找对手主按钮（中等宽悬浮，不再横贯整屏）；
   * ④ 底部：车库（左下）/ 排行榜·战令（右下）——紧凑次级入口（轻量 chip，弱对比；F-HOME-STAGE-R3
   *    已降级，不再用实底重框，消除「后台操作台」厚重感）；寻找对手 cta-find 为唯一主按钮（实底蓝）。
   * 背景 = renderer.drawHomeBackdrop（程序化 underlay，单一入口；绘制于车辆之下）。
   * 背包/合成/更多/复杂配置不堆在首页。布局唯一源 = computeHomeLayout（Home 模式
   * getPreviewFramingRect 同源：vehicleFramingRect 为 stage 上部、CTA 之上）。
   */
  private drawHomePage(state: PlayerUIState): void {
    const draft = state.draft;
    if (!draft) return;
    const L = computeHomeLayout(
      { w: this.W, h: this.H },
      { left: this.insL, right: this.insR, top: this.insT, bottom: this.insB },
      this.profile,
    );

    // ① 顶部：个人信息（左上：头像 + 段位；删除首页金币）+ 宝箱栏（右上）
    const p = state.progress;
    const tier = tierOf(p.rating);
    const pr = L.profileRect;
    const avR = this.isShort ? 11 : 15;
    const avCX = pr.x + avR + 3;
    const avCY = pr.y + pr.h / 2;
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
    this.text(`${TIER_LABEL[tier]} ${p.rating}`, avCX + avR + 8, pr.y + pr.h / 2, this.isShort ? 13 : 15, C.gold, 'left', 700);
    this.hit('home-profile', pr.x, pr.y, pr.w, pr.h);

    // 宝箱栏（4 槽，右上；F-HOME-VISUAL-R2 四态视觉：可领金光 / 计时进度+时标 / 空槽弱化——
    // 不再只是四个相同线框（Must#7）；状态集合不变（claimable/timing/empty，零运营功能）。
    for (let i = 0; i < 4; i++) {
      const s = L.chestSlot(i);
      const st = HOME_CHEST_STATES[i];
      if (st === 'claimable') {
        // 可领取：金色底光 + 加粗描边 + 槽盖亮边 + 右上光点 + 「可领」金字
        this.rect(s.x - 1, s.y - 1, s.w + 2, s.h + 2, 'rgba(160,120,30,0.28)', undefined);
        this.rect(s.x, s.y, s.w, s.h, 'rgba(96,74,24,0.42)', C.gold, 1.5);
        this.rect(s.x - 2, s.y - 3, s.w + 4, 4, 'rgba(255,214,130,0.75)');
        this.rect(s.x + s.w - 4, s.y - 2, 3, 3, C.gold);
        this.text('可领', s.x + s.w / 2, s.y + s.h / 2 + 2, this.isShort ? 9 : 11, C.gold, 'center', 700);
      } else if (st === 'timing') {
        // 计时：进度条 + 时钟小标 + 「计时」——进度随时间推进（视觉与可领/空明显区分）
        this.rect(s.x, s.y, s.w, s.h, 'rgba(30,40,58,0.6)', C.border, 1);
        this.rect(s.x - 2, s.y - 3, s.w + 4, 4, 'rgba(120,150,190,0.5)');
        this.rect(s.x + 3, s.y + s.h - 5, s.w - 6, 3, '#2a3345');
        this.rect(s.x + 3, s.y + s.h - 5, (s.w - 6) * 0.5, 3, C.driveBlue);
        const tctx = this.ctx;
        tctx.save();
        tctx.fillStyle = C.driveBlue;
        tctx.beginPath();
        tctx.arc(
          this.ox + (s.x + s.w / 2 - 4) * this.scale,
          this.oy + (s.y + s.h / 2 - 4) * this.scale,
          (this.isShort ? 4 : 5) * this.scale,
          0,
          Math.PI * 2,
        );
        tctx.moveTo(this.ox + (s.x + s.w / 2 - 4) * this.scale, this.oy + (s.y + s.h / 2 - 4) * this.scale);
        tctx.lineTo(this.ox + (s.x + s.w / 2 - 2) * this.scale, this.oy + (s.y + s.h / 2 - 7) * this.scale);
        tctx.strokeStyle = C.driveBlue;
        tctx.lineWidth = 1.5;
        tctx.stroke();
        tctx.fill();
        tctx.restore();
        this.text('计时', s.x + s.w / 2 + 6, s.y + s.h / 2 + 2, this.isShort ? 9 : 11, C.textDim, 'center');
      } else {
        // 空槽：暗底 + 细边 + 中心弱化十字（区别于「线框可领」）
        this.rect(s.x, s.y, s.w, s.h, 'rgba(16,22,34,0.5)', 'rgba(51,69,95,0.6)', 1);
        const ccx = s.x + s.w / 2;
        const ccy = s.y + s.h / 2;
        this.rect(ccx - 2, ccy - 2, 4, 4, 'rgba(90,110,140,0.5)');
        this.text('空', s.x + s.w / 2, s.y + s.h / 2 + 2, this.isShort ? 9 : 11, C.textDark, 'center');
      }
      this.hit(`home-chest-${i}`, s.x, s.y, s.w, s.h);
    }

    // ② 中央舞台：背景（renderer underlay）+ 车辆（renderer previewSolo 已 fit 到
    //    vehicleFramingRect）。不画全宽车辆框/边框——只保留车辆点击区（透明）。
    // F-HOME-3：车辆可点（点击 → 随机气泡 tips）。
    // F-HOME-STAGE-R2：点击区跟随真实 envelope（state.homeVehicleRect），而非整块
    // vehicleFramingRect——点击精准落在车上；无数据（测试/非 home）回落到 framingRect。
    const v = L.vehicleFramingRect;
    const hv = state.homeVehicleRect;
    if (hv) {
      this.hit('home-vehicle', hv.x, hv.y, hv.w, hv.h);
    } else {
      this.hit('home-vehicle', v.x, v.y, v.w, v.h);
    }
    if (this.vehicleTip) {
      const tipW = Math.min(v.w - 16, 300);
      const tipH = this.isShort ? 32 : 40;
      // F-HOME-DEMO-POLISH-R1：气泡跟随车辆真实 envelope（homeVehicleRect）顶部上方——
      // 车辆居中贴地后，气泡紧贴车身、不覆盖顶部信息层（clamp 到取景区顶缘）、
      // 也不压底部主按钮（气泡在车辆上方）。
      const envR = hv ?? v;
      const tipX = Math.max(v.x, Math.min(v.x + v.w - tipW, envR.x + (envR.w - tipW) / 2));
      const tipY = Math.max(v.y, envR.y - tipH - 8);
      this.rect(tipX, tipY, tipW, tipH, 'rgba(14,20,32,0.94)', C.gold, 1);
      this.text(this.vehicleTip, tipX + 10, tipY + tipH / 2, this.isShort ? 12 : 14, C.text, 'left');
      const tctx = this.ctx;
      tctx.save();
      tctx.fillStyle = C.gold;
      tctx.beginPath();
      tctx.moveTo(this.ox + (tipX + tipW / 2 - 6) * this.scale, this.oy + (tipY + tipH) * this.scale);
      tctx.lineTo(this.ox + (tipX + tipW / 2 + 6) * this.scale, this.oy + (tipY + tipH) * this.scale);
      tctx.lineTo(this.ox + (tipX + tipW / 2) * this.scale, this.oy + (tipY + tipH + 6) * this.scale);
      tctx.closePath();
      tctx.fill();
      tctx.restore();
    }

    // ③ 下方中央：寻找对手主按钮（中等宽悬浮，不横贯整屏）
    // F-NAV-ACTION-OWNERSHIP-P0：唯一正式首页入口 id = home-find-opponent
    // （页面语义明确；不再与 Garage/Backpack 复用 cta-find）
    this.button(L.ctaRect.x, L.ctaRect.y, L.ctaRect.w, L.ctaRect.h, 'home-find-opponent', state.draftValid ? '寻找对手' : '配置不合法', {
      primary: true,
      disabled: !state.draftValid,
    });

    // ④ 底部主条：车库（左下）| 寻找对手 CTA（中央金黄主按钮，主轴居中）| 排行榜·战令（右下）
    // F-HOME-VISUAL-R2：轻量矢量图标入口（车 / 柱 / 旗），取代「装/榜/令」单字圆片（Must#6）。
    this.drawHomeBottomEntry(L.garageRect, 'home-garage', 'garage', '车库');
    this.drawHomeBottomEntry(L.rankRect, 'home-rank', 'rank', '排行榜');
    this.drawHomeBottomEntry(L.passRect, 'home-pass', 'pass', '战令');
  }

  /** F-HOME-STAGE-R3 / F-HOME-DEMO-POLISH-R1：首页底部紧凑次级入口（轻量 chip + 短标签）。
   *  F-HOME-VISUAL-R2：图标从单字（装/榜/令）改为轻量矢量图形（车/柱/旗）——不再单字圆片；
   *  命中区与视觉入口同源（hit 注册完整 r rect，一次点击一次动作）。 */
  private drawHomeBottomEntry(
    r: Rect,
    id: string,
    iconKind: 'garage' | 'rank' | 'pass',
    label: string,
  ): void {
    const iw = this.isShort ? 18 : 24;
    const iy = r.y + (r.h - iw) / 2;
    // 图标 chip（极淡，无外框——不构成连续底带）
    this.panel(r.x + 2, iy, iw, iw, 'rgba(120,150,190,0.14)', undefined, V.radiusM);
    this.drawHomeEntryIcon(iconKind, r.x + 2 + iw / 2, iy + iw / 2, this.isShort ? 9 : 12);
    this.text(label, r.x + 2 + iw + 5, r.y + r.h / 2, this.isShort ? 12 : 14, V.secondaryText, 'left', 600);
    this.hit(id, r.x, r.y, r.w, r.h);
  }

  /** F-HOME-VISUAL-R2：轻量矢量入口图标（车库=小车、排行榜=柱状图、战令=旗帜）。 */
  private drawHomeEntryIcon(kind: 'garage' | 'rank' | 'pass', cx: number, cy: number, s: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = V.textPrimary;
    if (kind === 'garage') {
      // 小车：车身 + 两轮
      ctx.fillRect(cx - s * 0.8, cy - s * 0.25, s * 1.6, s * 0.6);
      for (const wx of [cx - s * 0.5, cx + s * 0.5]) {
        ctx.beginPath();
        ctx.arc(wx, cy + s * 0.45, s * 0.26, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (kind === 'rank') {
      // 排行榜：3 根柱（中高边低）
      const bw = s * 0.26;
      ctx.fillRect(cx - s * 0.75, cy + s * 0.4 - s * 0.5, bw, s * 0.5);
      ctx.fillRect(cx - bw / 2, cy + s * 0.4 - s * 0.85, bw, s * 0.85);
      ctx.fillRect(cx + s * 0.5, cy + s * 0.4 - s * 0.65, bw, s * 0.65);
    } else {
      // 战令：旗杆 + 三角旗
      ctx.fillRect(cx - s * 0.12, cy - s * 0.8, s * 0.18, s * 1.5);
      ctx.beginPath();
      ctx.moveTo(cx + s * 0.06, cy - s * 0.6);
      ctx.lineTo(cx + s * 0.78, cy - s * 0.3);
      ctx.lineTo(cx + s * 0.06, cy);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /** F-META-1：garage MetaPage——车辆展示（renderer 画）+ 右侧装配面板。
   *  F-NAV-ACTION-OWNERSHIP-P0：Garage 只调整车辆配置并返回首页——不再绘制
   *  「寻找对手」主 CTA（ctaRect 空间留白，不替换成新大按钮/无关入口；
   *  配置面板独占内容区）。返回能力由顶部「‹ 首页」nav 提供（drawMobileTopBar）。 */
  private drawGarageMetaPage(state: PlayerUIState, draft: BuildDraft, layout: MobileGarageLayout): void {
    const { stageRect, stripRect } = layout;
    // F-GARAGE-DRAG-ASSEMBLY-P0：缓存中央舞台（车身卡拖放目标；布局源，非像素估算）
    this.garageStageRect = { ...stageRect };
    // F-GARAGE-LIVE-ASSEMBLY-P0：默认选择（Must#5）——当前分类有挂点但未选中/选中失效 → 自动选
    this.ensureGarageSlotSelection(state, draft);
    // F-GARAGE-LIVE-ASSEMBLY-P0：真实挂点 overlay（移动/战斗分类在中央战车上显示可用/选中/占用挂点）
    this.drawVehicleHardpoints(state);

    // F-GARAGE-CENTER-STAGE-P0：中央装配舞台——右侧面板已删除，车辆由 renderer previewSolo
    // fit 到 stageRect（全宽、居中、贴地）；非法原因与能量变化均嵌入底部装配带，不占舞台。
    // 唯一返回 = 左上「‹ 首页」（drawMobileTopBar nav:home）。
    void stageRect;
    this.drawGarageStrip(state, draft, stripRect);
    // F-CONTENT-PACK-REAL-UI-R1｜Fix 4：移动端轻量卸轮入口（仅移动分类 + 该轮已装备时显示）
    this.drawGarageUnmountEntry(draft);
    // F-GARAGE-DRAG-ASSEMBLY-P0：拖动 ghost 与吸附反馈绘制在最上层（不影响车辆取景/尺度，Must#18）
    this.drawGarageDragGhost(state);
    // F-DEBUG-GRANT-ALL-PARTS-P0：DEV 一键全部件按钮（仅 DEV 构建 + ?resetdev=1；条件绘制零布局占用）
    this.drawDevGrantEntry(state);
  }

  /**
   * F-CONTENT-PACK-REAL-UI-R1｜「测试：全部件×1」一键领用按钮（替换原 F-DEBUG-GRANT-ALL-PARTS-P0
   * 的 DEV/?resetdev=1 门控）。
   * - 显示条件 = RC 体验包（__WX_DEBUG_GRANT__ 宏，微信开发者工具预览可达，无需 Web URL 参数）
   *   || E2E 包（__E2E_INTERNAL_HANDLE__ 宏）|| Web DEV（DEV_TOOLS_VISIBLE && ?resetdev=1）；
   * - 普通微信正式包（__WX_DEBUG_GRANT__=false）与正式 Web prod 恒零按钮零命中区；
   * - 微信预览环境无 ?resetdev=1 概念 → 必须靠 RC 宏而非 resetDevVisible（F-WX-IOS-CANVAS-CRASH-P0
   *   Must#6 已把 isResetDevVisible 接到 __WX_DEBUG_GRANT__，但按钮门控此前仍卡在 DEV/e2e 子句，
   *   导致 RC 包也不可见——本 Queue 修正为直接读 RC 宏）；
   * - 位置 = Garage 舞台右上角小按钮（仅条件绘制，隐藏时不占布局）；
   * - 反馈 = runtime 返回的「已获得全部件×1（N种）」；点击 → runtime 授予（入库+持久化）；
   *   F-DEBUG-GRANT-COVERAGE-P0：按钮「已领取」/inert 状态（dev-grant-done id）由真实库存完整性
   *   每次重算（hasAllOfficialDebugContent），全部正式内容拥有后显示「已领取」，否则仍「测试：全部件×1」可点。
   */
  /**
   * F-CONTENT-PACK-REAL-UI-R1｜Fix 4：移动端轻量卸轮入口。
   * - 仅「移动」分类、且该轮当前已装备时显示（卸下后轮 / 卸下前轮）；
   * - 位置 = 中央舞台左上角竖排两个小按钮（避让右上角 grant 按钮与顶部 nav:home 顶栏）；
   * - 点击 → dispatch('unmount:rear'/'unmount:front') → 选中轮槽 + onPickGarageOption(EMPTY_SLOT)；
   * - 不新弹窗、hitArea 与视觉同源（this.button 注册，绘制即命中区）。
   */
  private drawGarageUnmountEntry(draft: BuildDraft): void {
    if (this.garageCategory !== 'move') return;
    const stage = this.garageStageRect;
    if (!stage) return;
    const rearEquipped = (draft.rearWheelDefId ?? 'wheelStd') !== EMPTY_SLOT;
    const frontEquipped = (draft.frontWheelDefId ?? 'wheelStd') !== EMPTY_SLOT;
    if (!rearEquipped && !frontEquipped) return;
    const bw = this.isShort ? 76 : 84;
    const bh = this.isShort ? 20 : 22;
    const x = stage.x + 6;
    let y = stage.y + 6;
    if (rearEquipped) {
      this.button(x, y, bw, bh, 'unmount:rear', '卸下后轮', {});
      y += bh + 6;
    }
    if (frontEquipped) {
      this.button(x, y, bw, bh, 'unmount:front', '卸下前轮', {});
    }
  }

  private drawDevGrantEntry(state: PlayerUIState): void {
    // F-WX-E2E-HANDLE-ISOLATION-P0：E2E 构建显示归 E2E-only 宏。
    const e2eProbe = typeof __E2E_INTERNAL_HANDLE__ !== 'undefined' && __E2E_INTERNAL_HANDLE__;
    // F-CONTENT-PACK-REAL-UI-R1：RC 体验包（微信预览可达）直接读宏，不再依赖 Web ?resetdev=1。
    const rcGrant = typeof __WX_DEBUG_GRANT__ !== 'undefined' && __WX_DEBUG_GRANT__;
    const devReset = DEV_TOOLS_VISIBLE && state.resetDevVisible;
    if (!(rcGrant || e2eProbe || devReset)) return;
    const stage = this.garageStageRect;
    if (!stage) return;
    const btnW = this.isShort ? 96 : 112;
    const btnH = this.isShort ? 20 : 24;
    // F-WX-SAFE-AREA-P0：入口落在车库舞台右上角，须避让顶部右侧胶囊——
    // 钳制右缘 ≤ W − insR（唯一契约胶囊右侧内缩）− 4，确保与胶囊 ≥6px 间距（Must#7 不留 occlusion）。
    const maxRight = this.W - (this.insR > 0 ? this.insR : 8) - 4;
    let x = stage.x + stage.w - btnW - 6;
    if (x + btnW > maxRight) x = maxRight - btnW;
    const y = stage.y + 6;
    // F-DEBUG-GRANT-COVERAGE-P0｜五节：按钮「已领取」状态必须由真实库存完整性计算
    // （hasAllOfficialDebugContent），每次绘制/重启重算，不依赖 UI 内存标记。
    const claimed = hasAllOfficialDebugContent(getInventory());
    const id = claimed ? 'dev-grant-done' : 'dev-grant-all';
    const label = claimed ? '已领取' : '测试：全部件×1';
    this.button(x, y, btnW, btnH, id, label, {});
    if (!claimed && state.devGrantMessage) {
      this.text(state.devGrantMessage, x + btnW / 2, y + btnH + 8, this.isShort ? 8 : 9, V.primary, 'center', 600);
    }
  }

  /**
   * F-GARAGE-DRAG-ASSEMBLY-P0：拖动 ghost（Must#4/8）——半透明部件跟随指针；
   * 命中兼容挂点时**吸附到挂点中心**并轻微缩放/金色呼吸（Must#8：不提前修改真实 BuildDraft）。
   * ghost 只用于拖动反馈，**不作为最终装备显示**（最终装备由 Renderer 在真实挂点绘制）。
   */
  private drawGarageDragGhost(state: PlayerUIState): void {
    const d = this.garageDrag;
    if (!d || !d.card) return;
    const dragging =
      d.phase === 'draggingPart' || d.phase === 'hoveringValidMount' || d.phase === 'hoveringInvalidMount';
    if (!dragging) return;
    const ctx = this.ctx;
    let gx = d.x;
    let gy = d.y;
    let snapped = !!d.hoverHp;
    // F-GARAGE-DRAG-CONTINUITY-R1（Must#6）：触屏 ghost 上移 20 logical px（16~24 区间中值）
    // 避让手指遮挡；鼠标/笔不做偏移（与指针距离 = 0 ≤ 4px）。**仅影响绘制**，
    // 落点判定仍用真实指针 d.x/d.y —— 吸附后统一移到挂点中心（不偏移）。
    if (!snapped && d.pointerType === 'touch') {
      gy -= GHOST_TOUCH_LIFT;
    }
    if (snapped) {
      const hp = (state.hardpointScreenPts ?? []).find((p) => p.id === d.hoverHp);
      if (hp) {
        gx = hp.x;
        gy = hp.y;
      }
    } else if (this.garageCategory === 'body' && this.garageBodyDropHit(d.x, d.y) && this.garageStageRect) {
      // 车身：无挂点歧义 → 吸附到车辆主体区域中心（Must#12）
      const s = this.garageStageRect;
      gx = s.x + s.w / 2;
      gy = s.y + s.h / 2;
      snapped = true;
    }
    const breathe = snapped ? 1 + 0.08 * Math.abs(Math.sin((this.nowMs / 200) * Math.PI)) : 1;
    const s = (this.isShort ? 9 : 13) * breathe;
    const bw = s * 2.6;
    ctx.save();
    ctx.globalAlpha = 0.72;
    ctx.fillStyle = d.overload ? 'rgba(70,26,30,0.72)' : 'rgba(20,32,52,0.78)';
    ctx.strokeStyle = d.overload ? V.lose : snapped ? V.primary : 'rgba(150,205,255,0.8)';
    ctx.lineWidth = snapped ? 2 : 1.4;
    ctx.fillRect(gx - bw / 2, gy - bw / 2, bw, bw);
    ctx.strokeRect(gx - bw / 2, gy - bw / 2, bw, bw);
    ctx.globalAlpha = 0.92;
    // 复用卡片 mini preview / 结构简图（drawPartIcon）——不引入新美术资产
    this.drawPartIcon(d.card.v, gx, gy, s * 0.8, !!d.card.locked);
    ctx.restore();
  }

  // F-GARAGE-VISUAL-DENSITY-R2（Must#3）：drawGarageDragHint「拖到车辆挂点安装」教学横幅已删除
  // （一次性、与未选挂点提示/卡片状态徽标语义重复）——装配带只保留组装必要信息。

  /**
   * F-GARAGE-CENTER-STAGE-P0：底部横向装配带（Must#5）——
   * 第一行：车身/移动/战斗 三个紧凑分类 tab（全宽）；
   * 第二行：当前分类/挂点的部件横向卡片带（clip + 横向滚动 + 8px 横滑取消点击）；
   * 状态行（超载差值/未获得原因）在卡带上方按需显示（半透明横幅，不占卡带高）。
   * 能量 used/cap 已常驻顶栏（drawMobileTopBar garage 模式）。
   * F-GARAGE-VISUAL-DENSITY-R2（Must#3）：删除「拖到车辆挂点安装」教学横幅（一次性、与
   * 未选挂点提示/卡片状态徽标语义重复）——装配带只保留组装必要信息。
   */
  private drawGarageStrip(state: PlayerUIState, draft: BuildDraft, stripRect: Rect): void {
    const pad = this.isShort ? 4 : 6;
    const tabH = this.isShort ? 22 : 30;
    const tabY = stripRect.y + pad;
    const gap = this.isShort ? 3 : 5;
    // 第一行：分类 tab
    this.drawGarageCategoryTabs(stripRect.x, stripRect.w, tabY, tabH);
    // 状态行（超载差值 / blockReason / overloadDelta；无状态不占位）
    const statusH = this.garageStripStatus(state, draft, stripRect, tabY + tabH + gap);
    // 第二行：部件卡带
    const cardTop = tabY + tabH + gap + statusH;
    const cardBot = stripRect.y + stripRect.h - pad;
    const cardH = Math.max(24, cardBot - cardTop);
    // F-GARAGE-VISUAL-DENSITY-R2（Must#8/#9）：卡片行两侧预留箭头槽（gutter），左右翻页箭头
    // 落在槽位内、不覆盖卡片内容与命中区；部分露出的边缘卡只作滚动暗示（命中区仍只注册完全可见卡）。
    const gutter = this.isShort ? 16 : 20;
    const row: Rect = { x: stripRect.x + gutter, y: cardTop, w: Math.max(40, stripRect.w - gutter * 2), h: cardH };
    this.stripCardRow = row;
    this.drawGarageStripCards(state, draft, row, stripRect, gutter);
  }

  /**
   * F-GARAGE-CENTER-STAGE-P0：装配带状态行（Must#13）——超载/未获得/不兼容原因显示在
   * 装配带内（卡带上方半透明横幅），不使用中央 Modal 或右侧说明面板。返回占用高度。
   */
  private garageStripStatus(state: PlayerUIState, draft: BuildDraft, stripRect: Rect, y: number): number {
    const snapshot = buildSnapshotFromDraft(draft, registry, 'customA');
    const energyRes = computeEnergy(snapshot, registry);
    const body = registry.bodies.get(draft.bodyDefId);
    const capacity = body?.energyCapacity ?? 0;
    const used = energyRes.error ? Number.NaN : energyRes.energy;
    const overload = Number.isFinite(used) && used > capacity;
    let msg: string | null = null;
    if (this.garageDragNotice) {
      // F-GARAGE-DRAG-ASSEMBLY-P0：拖动层提示（超载差值 / 未获得原因）优先显示在装配带内
      msg = this.garageDragNotice;
    } else if (state.blockReason) {
      msg = state.blockReason;
    } else if (overload) {
      msg = energyRes.error ? String(energyRes.error) : '能量超载';
    } else if (state.overloadDelta != null && state.overloadDelta > 0) {
      msg = `超载 +${Math.round(state.overloadDelta)}`;
    }
    if (!msg) return 0;
    const h = this.isShort ? 12 : 14;
    this.panel(stripRect.x, y, stripRect.w, h, 'rgba(40,18,22,0.85)', undefined, 0);
    this.text(msg, stripRect.x + stripRect.w / 2, y + h / 2, this.isShort ? 9 : 11, V.lose, 'center', 600);
    return h + (this.isShort ? 2 : 3);
  }

  /**
   * F-GARAGE-CENTER-STAGE-P0：部件横向卡片带（Must#9/10/11）——
   * 单行横排；内容超宽时横向滚动（左右小箭头 + 横滑）；横滑 >8px 取消该次点击（不误装备）；
   * 卡片只含 mini preview / 名称 / 星级 / 能量 / 武器·辅助小标 / 已装备·未获得状态。
   */
  private drawGarageStripCards(state: PlayerUIState, draft: BuildDraft, row: Rect, stripRect: Rect, gutter: number): void {
    const slot = state.garageSelected;
    const allSlots = this.garageSlotsFor(draft);
    const hasSlot = !!slot && allSlots.some((s) => s.key === slot);
    if (!hasSlot) {
      // 未选挂点（或分类与所选槽不匹配）：引导提示（不撑满空卡）
      this.text(
        this.garageCategory === 'body' ? '选择车身部件' : '点击战车上的挂点选择装配位',
        row.x + row.w / 2,
        row.y + row.h / 2,
        this.isShort ? 11 : 13,
        V.textSecondary,
        'center',
      );
      this.stripContentW = row.w;
      return;
    }
    // F-GARAGE-DRAG-ASSEMBLY-P0：布局改为与命中判定同源（garageStripCardLayout 唯一来源）
    // F-CONTENT-PACK-REAL-UI-R1：布局前先钳制 scroll（单一 clampedScroll 同时用于布局/
    // clip/hitArea/手势命中），消除「箭头先以未钳制值改 scroll、绘制时再钳制」导致的
    // 同一帧 hitArea 跳位（点卡装错卡）。
    this.clampGarageStripScroll(state, draft, row);
    const lay = this.garageStripCardLayout(state, draft, row)!;
    const { opts, curVal, cardW, gap } = lay;
    const cardH = row.h;
    const contentW = opts.length > 0 ? opts.length * cardW + (opts.length - 1) * gap : row.w;
    this.stripContentW = contentW;
    // F-CONTENT-PACK-REAL-UI-R1：Fix 2 配套——maxScroll 单一真源（与 clampGarageStripScroll 同源），
    // 用于横滚箭头可见性判定（内容未超宽则不显示箭头）。
    const maxScroll = Math.max(0, contentW - row.w);
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.ox + row.x * this.scale, this.oy + row.y * this.scale, row.w * this.scale, row.h * this.scale);
    ctx.clip();
    let x = lay.startX;
    const drag = this.garageDrag;
    // F-CONTENT-PLAYER-BODY-PACK-R1：可见性收紧——只绘制「不越出装配带可视区（stripRect
    // 左右缘）」的卡。旧判定（与 row 有交集）会绘制右缘超出屏幕的「部分可见」卡：真实
    // canvas 靠 clip 裁切（无可见问题），但像素几何验收记录的是未裁切坐标 → 误报超界。
    // 收紧后：左缘 ≥ strip 左缘、右缘 ≤ strip 右缘才绘制——不超屏，同时保留完全可见卡与
    // 边缘滚动暗示的视觉连续（被 clip 裁掉的部分本就不可见）。hitArea 仍只注册完全可见卡
    // （fully，不变）。
    const stripLeft = stripRect.x;
    const stripRight = stripRect.x + stripRect.w;
    for (const c of opts) {
      // 部分可见卡只绘制（视觉连续）、不注册 hitArea——hitArea 不受 clip 影响，
      // 越出可视区的命中会造成「可见区外可点 / 溢出 safe」（Must#10 点击区与视觉一致）。
      const fully = x >= row.x - 0.5 && x + cardW <= row.x + row.w + 0.5;
      const visible =
        x + cardW > row.x && x < row.x + row.w &&
        x >= stripLeft - 0.5 && x + cardW <= stripRight + 0.5;
      if (visible) {
        // Must#4：拖动中的卡片保留原位置但降低亮度（ghost 从原卡飞出）
        const isSrc = !!drag && !!drag.card && drag.card.v === c.v && drag.slot === slot;
        const dimmed = isSrc && drag!.phase !== 'partPressed';
        // Must#5：按下（尚未判定方向）→ 轻量「抬起/压暗」反馈，让玩家知道已抓住部件
        const pressed = isSrc && drag!.phase === 'partPressed';
        this.drawPartCard(x, row.y, cardW, cardH, c, c.v === curVal, fully, dimmed, pressed);
      }
      x += cardW + gap;
    }
    ctx.restore();
    // 两侧小型翻页箭头（内容超宽时；落在卡片行两侧 gutter 槽位内，不覆盖卡片内容/命中区）
    if (maxScroll > 1) {
      const aw = Math.max(12, gutter - 4);
      const ah = Math.min(this.isShort ? 22 : 26, row.h);
      const ay = row.y + (row.h - ah) / 2;
      this.button(stripRect.x + 2, ay, aw, ah, 'strip-scroll-left', '‹', {});
      this.button(stripRect.x + stripRect.w - aw - 2, ay, aw, ah, 'strip-scroll-right', '›', {});
    }
  }

  /**
   * F-GARAGE-LIVE-ASSEMBLY-P0：默认选择（Must#5）——当前分类有挂点但未选中/选中失效时，
   * 自动选中「当前已有装备的第一个挂点」（无装备则第一个可用挂点）。惰性：仅当选中无效时
   * 触发一次 actions（设置后 next render 即满足，不递归）。
   */
  private ensureGarageSlotSelection(state: PlayerUIState, draft: BuildDraft): void {
    if (state.playerPhase !== 'garage') return;
    const slots = this.garageSlotsFor(draft);
    if (slots.length === 0) return;
    const cur = state.garageSelected;
    if (cur && slots.some((s) => s.key === cur)) return;
    const equipped = slots.find((s) => this.garageCurrentValue(draft, s.key) !== EMPTY_SLOT);
    const sel = (equipped ?? slots[0]).key;
    if (sel !== cur) this.actions?.onToggleGarageSlot?.(sel);
  }

  /**
   * F-GARAGE-LIVE-ASSEMBLY-P0：真实装配挂点 overlay（Must#3）——在战车上显示当前分类的挂点：
   *  - 可用挂点：白/蓝轮廓圆；
   *  - 当前选中：金色高亮圆；
   *  - 已占用：实心小点（当前部件占位）；
   *  - 装备成功 flash（150~220ms）：金圈呼吸脉冲；
   * 坐标来自 Renderer 真实挂点（snapshot hardpoints 世界坐标 → logical px，与绘制同源），
   * 禁止 UI 按图片尺寸重估；点击区与视觉同源（hp-sel:<id>）。
   */
  private drawVehicleHardpoints(state: PlayerUIState): void {
    const pts = state.hardpointScreenPts ?? [];
    if (pts.length === 0) return;
    const cat = this.garageCategory;
    // 分类过滤：移动 → movement 挂点；战斗 → functional（武器/辅助）；车身 → 不显示
    const shown = pts.filter((p) => (cat === 'move' ? p.kind === 'movement' : p.kind === 'functional'));
    if (shown.length === 0) return;
    const t = this.nowMs;
    const flash = this.equipFlash && t < this.equipFlash.until ? this.equipFlash : null;
    const ctx = this.ctx;
    const { ring } = this.garageMountRadius();
    // F-GARAGE-DRAG-ASSEMBLY-P0（Must#7）：拖动态圆环半径与释放判定半径同源（garageMountRadius 派生，
    // release ≥ ring → 视觉进入圆环必然判定成功）。非拖动态保持既有 R=7 视觉不变。
    const drag = this.garageDrag;
    const dragActive =
      !!drag &&
      !!drag.card &&
      (drag.armed ||
        drag.phase === 'draggingPart' ||
        drag.phase === 'hoveringValidMount' ||
        drag.phase === 'hoveringInvalidMount');
    const compat = dragActive ? new Map(this.garageDragTargets().map((it) => [it.hp.id, it.slot])) : null;
    const R = compat ? ring : 7; // 视觉圆半径（logical px）
    const HIT = 30; // 触控命中区（≥24px 手指可操作）
    const hoverId = dragActive ? (drag as GarageDragSnapshot).hoverHp : null;
    ctx.save();
    for (const p of shown) {
      const flashing = flash != null && flash.hp === p.id;
      const cx = p.x;
      const cy = p.y;
      if (compat) {
        // —— Must#4：拖动态只突出「最近的一个有效挂点」——
        // 不兼容：极淡小点，绝不显示红圈（避免反馈过杂）。
        if (!compat.has(p.id)) {
          ctx.fillStyle = 'rgba(120,130,150,0.20)';
          ctx.beginPath();
          ctx.arc(cx, cy, Math.max(2, R * 0.26), 0, Math.PI * 2);
          ctx.fill();
          continue;
        }
        const isHover = hoverId === p.id;
        const isOverload = isHover && !!(drag as GarageDragSnapshot).overload;
        if (isHover) {
          // 最近有效挂点：金色吸附（唯一突出目标；超载转克制红环，不放大红域）
          const breathe = 1 + 0.12 * Math.abs(Math.sin((t / 220) * Math.PI));
          const pr = (R + 4) * breathe;
          ctx.strokeStyle = isOverload ? V.lose : V.primary;
          ctx.lineWidth = isOverload ? 2.6 : 2.6;
          ctx.beginPath();
          ctx.arc(cx, cy, pr, 0, Math.PI * 2);
          ctx.stroke();
          // 占用：仅目标挂点显示「将被替换」虚线外环（克制，不喧宾夺主）
          if (p.occupied && !isOverload) {
            ctx.strokeStyle = 'rgba(255,255,255,0.6)';
            ctx.lineWidth = 1.3;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.arc(cx, cy, pr + 4, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
          }
          if (!isOverload) {
            ctx.strokeStyle = 'rgba(255,209,102,0.4)';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.arc(cx, cy, pr + 5, 0, Math.PI * 2);
            ctx.stroke();
          }
        } else {
          // 其他有效挂点：弱提示（淡环，不与目标抢视觉；Must#4「其他有效=弱提示」）
          ctx.strokeStyle = 'rgba(150,205,255,0.35)';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(cx, cy, R * 0.8, 0, Math.PI * 2);
          ctx.stroke();
        }
        continue;
      }
      // —— F-GARAGE-VISUAL-DENSITY-R2（Must#5）：挂点只在「拖动 / armed / 成功吸附反馈」期间显示；
      //   Garage idle（未拖动、未 armed、无 flash）不常驻任何挂点圆——车辆是唯一视觉中心。
      //   成功吸附 flash 期间仅反馈目标挂点（金色呼吸，保留原视觉）。 ——
      if (flashing) {
        const pr = R + 2 + 3 * Math.abs(Math.sin((t / 25) * Math.PI));
        ctx.strokeStyle = V.primary;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(cx, cy, pr, 0, Math.PI * 2);
        ctx.stroke();
      }
      // idle（无 flash）：不绘制（不画 selected/occupied/可用轮廓圆）
    }
    ctx.restore();
    // 点击区与视觉同源（F-GARAGE-VISUAL-DENSITY-R2 / CENTER-SCALE-R2.1：挂点只在
    // 「拖动 / armed / 吸附反馈」期间显示与可点；Garage idle 不注册挂点命中——看不见不可点）。
    if (compat != null || flash != null) {
      for (const p of shown) {
        this.button(p.x - HIT / 2, p.y - HIT / 2, HIT, HIT, `hp-sel:${p.id}`, '', {});
      }
    }
  }

  /** F-GARAGE-COMBAT-TAB-R1：右顶常驻分类 tab（车身/移动/战斗；战斗最宽+金橙强调，突出战斗配置主入口）。 */
  private drawGarageCategoryTabs(px: number, pw: number, y: number, h: number): void {
    const tabs: Array<{ cat: 'body' | 'move' | 'combat'; label: string; icon: 'body' | 'wheel' | 'combat' }> = [
      { cat: 'body', label: '车身', icon: 'body' },
      { cat: 'move', label: '移动', icon: 'wheel' },
      { cat: 'combat', label: '战斗', icon: 'combat' },
    ];
    const gap = 6;
    // 战斗 tab 更宽（宽度高于另外两个）以突出主入口；两侧车身/移动均分剩余宽度
    const combatW = Math.round(pw * 0.42);
    const sideW = (pw - combatW - gap * 2) / 2;
    const rects = [
      { x: px, y, w: sideW, t: tabs[0] },
      { x: px + sideW + gap, y, w: sideW, t: tabs[1] },
      { x: px + 2 * (sideW + gap), y, w: combatW, t: tabs[2] },
    ];
    for (const r of rects) {
      this.button(r.x, r.y, r.w, h, `garage-cat:${r.t.cat}`, r.t.label, {
        active: this.garageCategory === r.t.cat,
        icon: r.t.icon,
        combat: r.t.cat === 'combat',
      });
    }
  }

  /** F-GARAGE-BUILD-BOARD-P0：分类下的挂点/槽位 chip 行（车身=车身；移动=后轮/前轮/驱动；
   *  武器/辅助=该车身全部硬点）。 */
  private garageSlotsFor(draft: BuildDraft): Array<{ key: string; label: string }> {
    if (this.garageCategory === 'body') return [{ key: 'body', label: '车身' }];
    if (this.garageCategory === 'move') {
      return [
        { key: 'rearWheel', label: '后轮' },
        { key: 'frontWheel', label: '前轮' },
        { key: 'drive', label: '驱动' },
      ];
    }
    const body = registry.bodies.get(draft.bodyDefId);
    const hps = body ? editableSlots(body) : [];
    return hps.length > 0 ? hps.map((hp) => ({ key: hp, label: slotLabel(hp) })) : [];
  }

  /**
   * F-GARAGE-CENTER-STAGE-P0：单张部件卡（Must#9）——mini preview + 名称 + 星级 + 能量 +
   * 武器/辅助小标 + 已装备/未获得状态。禁大段属性说明/全宽文字按钮/表格布局。
   * 点击 → onPickGarageOption（装备 → 中央战车实时更新；实测 ≤150ms）。
   */
  private drawPartCard(
    x: number,
    y: number,
    w: number,
    h: number,
    c: GarageOpt,
    equipped: boolean,
    registerHit = true,
    dimmed = false,
    pressed = false,
  ): void {
    // F-GARAGE-DRAG-CONTINUITY-R1（Must：已装备卡片状态 #1/#3/#5）：
    // 已装备 = 中性灰蓝底（**不用亮蓝 active 填充**，旧实现与「选中/armed」混淆）；
    // armed（已拿起待装）= 金色描边；两者互斥，且都不使用亮蓝实底。
    const isArmed = !!(this.garageDrag?.armed && this.garageDrag.card?.v === c.v);
    if (registerHit) {
      this.button(x, y, w, h, `opt:${c.v}`, '', {
        equipped: equipped,
        locked: c.locked,
        disabled: !!c.locked,
        armed: isArmed,
      });
    } else {
      // 部分可见：只画不注册（hitArea 不受 clip 限制；越界命中破坏「点击区与视觉一致」）
      this.rect(
        x,
        y,
        w,
        h,
        c.locked ? '#1b2130' : equipped ? V.equippedFill : V.availableFill,
        c.locked ? V.enemyOrange : isArmed ? C.gold : equipped ? V.border : V.equippedStroke,
        isArmed ? 2 : 1,
      );
    }
    const short = h < 40;
    // 左侧 mini preview（部件简图；武器=炮管 / 辅助=方块 / 车身=小车 / 轮=圆）
    const iconS = Math.max(7, Math.min(short ? 10 : 13, Math.round(h * 0.24)));
    const iconCX = x + (short ? 10 : 16) + iconS;
    const iconCY = y + h / 2;
    this.drawPartIcon(c.v, iconCX, iconCY, iconS, !!c.locked);
    // 名称（卡内单/双行；超长截断）
    const name = (c.t.replace(/\s*★+$/, '') || '空').slice(0, short ? 7 : 9);
    const tx = x + (short ? 24 : 34);
    const fs1 = short ? 9 : 11;
    const fs2 = short ? 7 : 9;
    const fs3 = short ? 7 : 9;
    this.text(name, tx, y + (short ? 10 : 13), fs1, c.locked ? C.textDark : V.textPrimary, 'left', 600);
    const stars = c.t.match(/★+/)?.[0] ?? '';
    if (stars && !short) this.text(stars, tx, y + 25, fs2, C.gold, 'left');
    // 能量/库存 meta（左下；短卡与名称同行下方）
    const meta = c.meta ?? '';
    const metaY = short ? y + h - 7 : y + (h >= 56 ? 40 : 36);
    this.text(meta, tx, metaY, fs3, c.locked ? C.textDark : C.textDim, 'left', 600);
    // 武器/辅助小型类型标识（右上角；Must#1/12）
    if (this.garageCategory === 'combat' && c.v !== EMPTY_SLOT) {
      const def = registry.functionals.get(decodePartVal(c.v).defId);
      if (def) {
        const tag = def.category === 'weapon' ? '武' : '辅';
        const tagCol = def.category === 'weapon' ? 'rgba(222,164,52,0.9)' : 'rgba(120,175,255,0.9)';
        const ts = short ? 11 : 14;
        const tsz = short ? 7 : 9;
        this.panel(x + w - ts - 4, y + 3, ts, ts, tagCol, undefined, 3);
        this.text(tag, x + w - ts / 2 - 4, y + 3 + ts / 2, tsz, '#fff', 'center', 700);
      }
    }
    // 状态徽标（右下：已装备/未获得；Must#9）。
    // F-GARAGE-DRAG-CONTINUITY-R1：已装备改为「深灰蓝底 + 亮字 + 浅描边」——在中性灰蓝
    // 卡片上仍清晰可辨，**文字不可省略**（Must：可加小标识，但文字不能省）。
    const badge = c.locked ? '未获得' : equipped ? '已装备' : '';
    if (badge) {
      const bw = short ? 28 : 36;
      const bh = short ? 12 : 15;
      const bx = x + w - bw - (short ? 3 : 4);
      const by = y + h - bh - (short ? 2 : 3);
      this.panel(
        bx,
        by,
        bw,
        bh,
        equipped ? 'rgba(52,64,82,0.98)' : 'rgba(30,36,46,0.92)',
        equipped ? 'rgba(150,168,192,0.9)' : 'rgba(110,120,138,0.75)',
        3,
      );
      this.text(badge, bx + bw / 2, by + bh / 2, short ? 7 : 9, equipped ? '#eef3fb' : '#8d99ab', 'center', 700);
    }
    // F-GARAGE-DRAG-CONTINUITY-R1（Must#1 已装备）：左侧中性灰蓝标识条。
    // 背景色差（已装备 #2a3444 vs 普通 secondary 合成）偏弱，仅靠底色「肉眼可区分」不足；
    // 加一条不改变布局的竖条（卡片内装饰，非新 UI 结构），与右下「已装备」文字双通道标识。
    if (equipped && !c.locked) {
      this.rect(x + 2, y + 3, 3, h - 6, V.equippedMark);
    }
    // F-GARAGE-DRAG-ASSEMBLY-P0（Must#4）：拖动中的原卡保留位置但降低亮度——
    // ghost 已从该卡飞出，原卡作为「已拿起」的视觉锚点（不改变卡片布局/尺寸）。
    if (dimmed) this.rect(x, y, w, h, 'rgba(8,12,20,0.55)');
    // F-GARAGE-DRAG-CONTINUITY-R1（Must#5）：按下后 80ms 内的轻量反馈——
    // 轻微压暗 + 金色描边 = 「已经抓住这个部件」。与拖动中的强压暗（dimmed）分级，
    // 与 armed 的暖金底区分（pressed 只是描边，不改底色）。
    if (pressed) {
      this.rect(x, y, w, h, 'rgba(10,16,26,0.30)');
      this.rect(x, y, w, h, undefined, 'rgba(255,190,80,0.9)', 2);
    }
  }

  /** F-GARAGE-BUILD-BOARD-P0：部件 mini 简图（按类别：车身=小车 / 轮=圆 / 武器=炮管 / 辅助=方块）。 */
  private drawPartIcon(v: string, cx: number, cy: number, s: number, locked: boolean): void {
    const ctx = this.ctx;
    const col = locked ? 'rgba(140,150,170,0.55)' : V.textPrimary;
    ctx.save();
    ctx.fillStyle = col;
    if (v === EMPTY_SLOT) {
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(cx - s, cy - s, s * 2, s * 2);
      ctx.fillRect(cx - s * 0.25, cy - s * 0.25, s * 0.5, s * 0.5);
      ctx.restore();
      return;
    }
    const { defId } = decodePartVal(v);
    const def = registry.functionals.get(defId);
    const cat = def?.category;
    if (cat === 'weapon') {
      ctx.fillRect(cx - s, cy - s * 0.32, s * 1.7, s * 0.64);
      ctx.beginPath();
      ctx.arc(cx + s * 0.85, cy, s * 0.32, 0, Math.PI * 2);
      ctx.fill();
    } else if (cat === 'gadget') {
      ctx.fillRect(cx - s * 0.55, cy - s * 0.55, s * 1.1, s * 1.1);
    } else if (registry.bodies.get(defId)) {
      // F-CONTENT-PLAYER-BODY-PACK-R1：正式车身卡片 mini 简图按车身区分——
      // 新 4 个车身画各自轮廓（榴莲尖刺 / 梨子上窄下宽 / 芒果低矮长形 / 橙子圆+叶），
      // 旧 4 个保持既有「小车」简图（零回归）。
      if (defId === 'durianBody') {
        // 榴莲：椭圆体 + 顶部/底部短刺
        ctx.beginPath();
        ctx.ellipse(cx, cy, s * 0.95, s * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.2;
        for (const [ax, ay] of [[-0.7, -0.5], [-0.2, -0.62], [0.35, -0.55], [0.7, -0.3], [-0.75, 0.3], [0.75, 0.25]] as const) {
          ctx.beginPath();
          ctx.moveTo(cx + ax * s, cy + ay * s);
          ctx.lineTo(cx + ax * s * 1.18, cy + ay * s * 1.25);
          ctx.stroke();
        }
      } else if (defId === 'pearBody') {
        // 梨子：上窄下宽（上椭圆 + 下宽圆）
        ctx.beginPath();
        ctx.ellipse(cx, cy + s * 0.45, s * 0.85, s * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(cx, cy - s * 0.28, s * 0.5, s * 0.4, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (defId === 'mangoBody') {
        // 芒果：低矮修长扁椭圆 + 短柄
        ctx.beginPath();
        ctx.ellipse(cx, cy, s * 1.15, s * 0.34, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(cx + s * 0.9, cy - s * 0.18);
        ctx.lineTo(cx + s * 1.12, cy - s * 0.34);
        ctx.stroke();
      } else if (defId === 'orangeBody') {
        // 橙子：圆 + 顶部叶片
        ctx.beginPath();
        ctx.arc(cx, cy, s * 0.72, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(cx + s * 0.12, cy - s * 0.66, s * 0.34, s * 0.16, 0.5, 0, Math.PI * 2);
        ctx.fill();
      } else if (defId === 'pineappleBody') {
        // 菠萝：高窄椭圆 + 顶部冠叶（mini 简图）
        ctx.beginPath();
        ctx.ellipse(cx, cy + s * 0.12, s * 0.6, s * 0.82, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.1;
        for (const ang of [-0.5, 0, 0.5]) {
          ctx.beginPath();
          ctx.moveTo(cx, cy - s * 0.6);
          ctx.lineTo(cx + Math.sin(ang) * s * 0.4, cy - s * 0.95);
          ctx.stroke();
        }
      } else if (defId === 'coconutBody') {
        // 椰子：短圆棕体 + 顶部三芽点（mini 简图）
        ctx.beginPath();
        ctx.arc(cx, cy, s * 0.72, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(90,58,32,0.9)';
        for (const [dx, dy] of [[-0.18, -0.6], [0.18, -0.6], [0, -0.42]] as const) {
          ctx.beginPath();
          ctx.arc(cx + dx * s, cy + dy * s, s * 0.12, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        ctx.fillRect(cx - s * 0.9, cy - s * 0.3, s * 1.8, s * 0.55);
        for (const wx of [cx - s * 0.55, cx + s * 0.55]) {
          ctx.beginPath();
          ctx.arc(wx, cy + s * 0.42, s * 0.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else {
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.75, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * F-GARAGE-CENTER-STAGE-P0：部件带选项（Must#1/12）——战斗分类武器/辅助**混排**展示
   * （不再按 cgroup 分段过滤），由卡片上的小型类型标识区分；其余分类按槽位返回。
   */
  private garageOptionsFiltered(state: PlayerUIState, slot: string): GarageOpt[] {
    return this.garageOptions(state, slot);
  }

  /**
   * F-GARAGE-CENTER-STAGE-P0：能量条已常驻顶栏（garage 模式：首页 + 能量 used/cap）。
   * 超载差值/未获得/不兼容原因由 garageStripStatus 显示在装配带内（Must#13）。
   */

  /**
   * F-GARAGE-INVENTORY-FUSION-P0｜背包二级页（garage-inventory）：
   * - 顶部「‹ 返回车库」（nav:garage，保留 Result-adjust 上下文）+ 标题「背包」；
   * - 分类 tabs：战斗 / 移动 / 车身（车身仅展示拥有状态，不参与合成）；
   * - 卡片（含未获得）：名称、当前星级、总数量、已装备数量、可用于合成数量、未获得状态、
   *   已装备标识（同一卡不同时「未获得」与「已装备」）；
   * - 选中卡片 → 底部合成面板（当前★1 / 消耗 5 / 产出 ★2 / 可用数量 / 暖金「合成」）；
   *   available < 5 → disabled「还差 N 个」；MAX_STAR 满星禁；连续点击只执行一次（onFuse 内部再校验）；
   * - 合成成功轻反馈（fuseToast，无重型动画），焦点留原卡。
   */
  private drawBackpackPage(state: PlayerUIState, layout: MobileGarageLayout): void {
    const draft = state.draft;
    const c = layout.contentRect;
    this.panel(c.x, c.y, c.w, c.h, V.panelSolid);
    // 顶部「‹ 返回车库」（唯一返回入口，保留 Result-adjust 上下文）
    this.button(c.x + 12, c.y + 6, 96, this.minTouchH, 'nav:garage', '‹ 返回车库', {});
    this.text('背包', c.x + 120, c.y + 30, 20, C.text, 'left', 700);
    // 合成成功轻反馈（无重型动画）
    if (this.fuseToast) {
      this.text(this.fuseToast, c.x + c.w / 2, c.y + 30, 14, C.gold, 'center', 700);
    }
    // 分类 tabs：战斗 / 移动 / 车身
    const tabH = this.isShort ? 30 : 44;
    const tabGap = 8;
    const tabTop = c.y + 6 + this.minTouchH + (this.isShort ? 4 : 8);
    const tabs: Array<{ id: string; label: string; v: 'combat' | 'movement' | 'body' }> = [
      { id: 'bfilter:combat', label: '战斗', v: 'combat' },
      { id: 'bfilter:movement', label: '移动', v: 'movement' },
      { id: 'bfilter:body', label: '车身', v: 'body' },
    ];
    const tabW = (c.w - 24 - tabGap * (tabs.length - 1)) / tabs.length;
    let tx = c.x + 12;
    for (const t of tabs) {
      this.button(tx, tabTop, tabW, tabH, t.id, t.label, {
        active: this.backpackFilter === t.v,
        combat: t.v === 'combat',
        icon: t.v === 'combat' ? 'combat' : t.v === 'movement' ? 'wheel' : 'body',
      });
      tx += tabW + tabGap;
    }
    // 该分类下全部官方 defId（含未获得）
    const inv = state.inventory;
    const equipped = equippedSlots(draft);
    let defIds: string[] = [];
    if (this.backpackFilter === 'combat') defIds = [...OFFICIAL_PARTS];
    else if (this.backpackFilter === 'movement') defIds = [...OFFICIAL_MOVEMENTS];
    else defIds = [...OFFICIAL_BODIES];
    const isBody = this.backpackFilter === 'body';
    const items: Array<{
      defId: string;
      name: string;
      starText: string;
      total: number;
      equippedCountN: number;
      available: number;
      owned: boolean;
      isEquipped: boolean;
    }> = [];
    for (const defId of defIds) {
      const one = Math.max(0, inv[defId]?.one ?? 0);
      const two = Math.max(0, inv[defId]?.two ?? 0);
      const owned = one > 0 || two > 0;
      // 已装备数量（按 (defId, star) 汇总；车身看 bodyDefId）
      let eqN = 0;
      if (isBody) {
        eqN = draft && draft.bodyDefId === defId ? 1 : 0;
      } else {
        for (const s of equipped) if (s.defId === defId) eqN += 1;
      }
      // 可用于合成数量 = 1★未装备数（仅 1★ 可合 1★→2★；已装备 1★ 受保护）
      let available = 0;
      if (!isBody) {
        let eqOne = 0;
        for (const s of equipped) if (s.defId === defId && s.star === 1) eqOne += 1;
        available = Math.max(0, one - eqOne);
      }
      const starText = [one > 0 ? `★×${one}` : '', two > 0 ? `★★×${two}` : ''].filter(Boolean).join('  ');
      items.push({
        defId,
        name: this.partDisplayName(defId),
        starText: starText || '—',
        total: one + two,
        equippedCountN: eqN,
        available,
        owned,
        isEquipped: eqN > 0,
      });
    }
    // 列表区 + 底部合成面板
    const listTop = tabTop + tabH + (this.isShort ? 4 : 6);
    const panelH = this.isShort ? 92 : 112;
    const listBot = c.y + c.h - panelH - (this.isShort ? 8 : 12);
    const viewH = Math.max(8, listBot - listTop);
    const gap = 8;
    const COLS = 2;
    const ROWS = 3;
    const PAGE_SIZE = COLS * ROWS;
    const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    if (this.backpackPage >= pageCount) this.backpackPage = pageCount - 1;
    if (this.backpackPage < 0) this.backpackPage = 0;
    const cardW = Math.floor((c.w - 24 - gap) / COLS);
    const cardH = Math.max(8, Math.floor((viewH - gap * (ROWS - 1)) / ROWS));
    const pageItems = items.slice(this.backpackPage * PAGE_SIZE, this.backpackPage * PAGE_SIZE + PAGE_SIZE);
    for (let i = 0; i < pageItems.length; i++) {
      const it = pageItems[i];
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const x = c.x + 12 + col * (cardW + gap);
      const y = listTop + row * (cardH + gap);
      const selected = this.backpackSelected === it.defId;
      // 卡片按钮（active=选中亮蓝；equipped=已装备灰蓝；互斥，已装备不亮蓝）
      this.button(x, y, cardW, cardH, `backpack-select:${it.defId}`, '', {
        active: selected,
        equipped: !selected && it.isEquipped,
      });
      // 叠加自定义文本（图标占位 + 名称 + 星级 + 数量信息 + 已装备标识）
      this.text(it.name, x + 10, y + cardH * 0.28, this.isShort ? 13 : 15, C.text, 'left', 600);
      this.text(it.starText, x + 10, y + cardH * 0.54, this.isShort ? 12 : 13, C.gold, 'left');
      const info = !it.owned ? '未获得' : `总 ${it.total} · 装备 ${it.equippedCountN} · 可合 ${it.available}`;
      this.text(info, x + 10, y + cardH * 0.8, this.isShort ? 10 : 11, it.owned ? C.textDim : C.red, 'left');
      if (it.isEquipped) {
        this.text('已装备', x + cardW - 10, y + cardH * 0.8, this.isShort ? 11 : 12, C.blue, 'right', 700);
      }
    }
    if (items.length === 0) this.text('该分类暂无部件', c.x + 12, listTop + 30, 14, C.textDim);
    // 分页条（多页时）
    if (pageCount > 1) {
      const pgH = 28;
      const pgY = listBot + (panelH - pgH) / 2;
      const nextX = c.x + c.w - 12 - 56;
      const prevX = nextX - 56 - 8 - 44;
      this.button(prevX, pgY, 56, pgH, 'backpack-page-prev', '上一页', {});
      this.text(`${this.backpackPage + 1} / ${pageCount}`, prevX + 56 + 4, pgY + pgH / 2, 13, C.textDim, 'left');
      this.button(nextX, pgY, 56, pgH, 'backpack-page-next', '下一页', {});
    }
    // 底部合成面板（选中卡片驱动）
    this.drawBackpackFusePanel(state, c.x, c.y + c.h - panelH, c.w, panelH);
  }

  /** F-GARAGE-INVENTORY-FUSION-P0：背包合成面板（当前★1 / 消耗5 / 产出★2 / 可用 / 暖金「合成」）。 */
  private drawBackpackFusePanel(state: PlayerUIState, x: number, y: number, w: number, h: number): void {
    this.panel(x + 8, y + 4, w - 16, h - 8, C.dockBg, C.border, V.radiusM);
    const defId = this.backpackSelected;
    if (!defId) {
      this.text('选择一张部件卡片以查看合成', x + w / 2, y + h / 2, 14, C.textDim, 'center');
      return;
    }
    // 车身不参与合成（§4；仅展示拥有状态）
    if (OFFICIAL_BODIES.includes(defId)) {
      this.text('车身不参与合成', x + w / 2, y + h / 2, 14, C.textDim, 'center');
      return;
    }
    const inv = state.inventory;
    const draft = state.draft ?? null;
    const fuse = canFuse(inv, defId, 1, draft);
    const name = this.partDisplayName(defId);
    // 左：规则与可用数量
    this.text(`${name}  ·  当前 ★1`, x + 20, y + h * 0.32, 14, C.text, 'left', 700);
    this.text('消耗 5 × 1★  →  产出 ★2', x + 20, y + h * 0.56, 13, C.textDim, 'left');
    const availColor = fuse.available >= 5 ? C.gold : C.textDim;
    this.text(`可用数量：${fuse.available} / 需要 5`, x + 20, y + h * 0.8, 13, availColor, 'left');
    // 右：暖金「合成」按钮（<5 disabled「还差 N 个」；满星「已满星」）
    let btnLabel = '合成';
    if (!fuse.ok && fuse.maxStar) btnLabel = '已满星';
    else if (!fuse.ok) btnLabel = `还差 ${fuse.need - fuse.available} 个`;
    this.button(x + w - 156, y + h / 2 - 22, 136, 44, 'backpack-fuse', btnLabel, {
      primary: fuse.ok,
      disabled: !fuse.ok,
    });
  }

  /** F-GARAGE-INVENTORY-FUSION-P0：统一部件显示名（Functional / Movement / Body）。 */
  private partDisplayName(defId: string): string {
    return (
      registry.functionals.get(defId)?.name ??
      registry.movements.get(defId)?.name ??
      registry.bodies.get(defId)?.name ??
      MOVEMENT_OPTIONS.find((o) => o.v === defId)?.t ??
      BODY_OPTIONS.find((o) => o.v === defId)?.t ??
      defId
    );
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
    this.panel(c.x, c.y, c.w, c.h, V.panelSolid);
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
   * 顶栏：返回首页 · 金币 · 段位 · 能量（标签+条+数值）· 背包 · 更多——每组独立 rect
   * 契约（F-GARAGE-MOBILE-SHELL-R1 Must#1），几何全部来自 computeGarageTopBarLayout
   * （唯一布局源）；能量数值绘制在组内右对齐，永不向右溢出进入背包按钮。
   * F-META-UX1：无页面大标题；F-UX-3A：Garage 页顶栏最右两个很小的次级入口 [背包][更多]
   * （明显弱于配置区）；Backpack/More 页顶栏仅 金币/段位/能量（shell 模式）。
   * F-HOME-1：配置页（garage）顶部最左「‹ 首页」返回小按钮。
   */
  private drawMobileTopBar(state: PlayerUIState, draft: BuildDraft, topBarRect: Rect): void {
    const p = state.progress;
    const tier = tierOf(p.rating);
    const body = registry.bodies.get(draft.bodyDefId);
    const x0 = topBarRect.x;
    const uT = topBarRect.y;
    const topH = topBarRect.h;
    this.panel(x0 - 4, uT, topBarRect.w + 8, topH, V.panelSolid, V.borderSoft, V.radiusM);
    const snapshot = buildSnapshotFromDraft(draft, registry, 'customA');
    const energyRes = computeEnergy(snapshot, registry);
    const used = energyRes.error ? Number.NaN : energyRes.energy;
    const capacity = body?.energyCapacity ?? 0;
    const overload = Number.isFinite(used) && used > capacity;
    const mode = this.metaPage === 'garage' ? 'garage' : 'shell';
    const texts: GarageTopBarTexts = {
      back: '‹ 首页',
      coin: `金币 ${p.coin}`,
      rating: `段位 ${TIER_LABEL[tier]} ${p.rating}`,
      ratingShort: `${TIER_LABEL[tier]} ${p.rating}`,
      ratingTier: TIER_LABEL[tier],
      energyLabel: '能量',
      energyValue: Number.isFinite(used) ? `${Math.round(used)}/${capacity}` : '?/?',
      backpack: '背包',
      more: '更多',
    };
    const tb = computeGarageTopBarLayout(topBarRect, this.profile, { mode }, texts);
    const midY = uT + topH / 2 + 5;
    if (tb.back) this.button(tb.back.x, tb.back.y, tb.back.w, tb.back.h, 'nav:home', texts.back, {});
    if (tb.coin) this.text(texts.coin, tb.coin.x, midY, 14, V.primary, 'left', 700);
    if (tb.rating) {
      this.text(tb.ratingRender, tb.rating.x, midY, 14, V.textSecondary, 'left');
    }
    this.text(texts.energyLabel, tb.energyLabel.x, midY, 14, V.textSecondary);
    const pct = Number.isFinite(used) ? Math.min(100, (used / Math.max(capacity, 1)) * 100) : 0;
    this.panel(tb.energyBar.x, tb.energyBar.y, tb.energyBar.w, tb.energyBar.h, '#1c2434', V.borderSoft, 5);
    if (pct > 0) {
      this.rect(tb.energyBar.x, tb.energyBar.y, tb.energyBar.w * (pct / 100), tb.energyBar.h, overload ? V.lose : V.ownBlue);
    }
    this.text(texts.energyValue, tb.energyValue.x + tb.energyValue.w, midY, 14, overload ? V.lose : V.textPrimary, 'right');
    if (tb.backpack) this.button(tb.backpack.x, tb.backpack.y, tb.backpack.w, tb.backpack.h, 'nav:backpack', texts.backpack, {});
    if (tb.more) this.button(tb.more.x, tb.more.y, tb.more.w, tb.more.h, 'nav:more', texts.more, {});
    // F-GARAGE-ADJUST-REMATCH-P0（Must#3）：战败 Result→装配台时的「完成并再战」暖金主操作。
    // 位置 = 顶栏中部（左「‹ 首页」右侧 ↔ 右能量组左侧），不遮挡中央车辆/真实挂点/底部装配带；
    // 极简结构零新增层级；hitArea 由 button() 每次绘制注册 → 与视觉同源。
    // 无效配置（超载/缺失）→ 文案「配置不合法」+ disabled（复用既有 dock 错误/能量提示，Must#6）。
    if (mode === 'garage' && this.garageFromResult && tb.back) {
      const g = this.isShort ? 6 : 8;
      // F-GARAGE-INVENTORY-FUSION-P0：紧跟「背包」入口右侧起排，避免与背包按钮重叠
      const anchorR = tb.backpack ? tb.backpack.x + tb.backpack.w : tb.back.x + tb.back.w;
      const btnL = anchorR + g;
      const btnR = tb.energyLabel.x - g;
      const btnW = Math.max(this.isShort ? 80 : 104, Math.min(btnR - btnL, this.isShort ? 132 : 172));
      const btnH = tb.back.h;
      const btnY = tb.back.y;
      const valid = state.draftValid && !overload;
      this.button(btnL, btnY, btnW, btnH, 'garage-retry', valid ? '完成并再战' : '配置不合法', {
        primary: valid,
        disabled: !valid,
      });
    }
  }

  /** 面板首页：2×2 主分类（车身/移动/武器/辅助）+ 底部「当前车辆」摘要条。
   *  F-LOBBY-GARAGE-DEMO-R1：按玩家认知分组，轮径+驱动归入「移动」；功能件按类别拆
   *  「武器」/「辅助」二级。
   *  F-GARAGE-MOBILE-SHELL-R1：2×2 卡片撑满面板可用高（正常档上限放宽，消除下半部
   *  大块空白）；面板底部摘要条展示当前车辆名+驱动（复用原 CTA 空间，第一眼知道
   *  正在配置哪辆车）。 */
  /**
   * F-MATCH-DEMO-R1：compact mobile 手机流程标志——Runtime 用它压缩战前过渡
   * （mobile 无 READY 覆盖层，Locked 稳定 ~700ms 后直接开战；桌面保持 READY 语义）。
   */
  isMobileView(): boolean {
    return this.isMobile;
  }

  /**
   * F-WX-UI-1：装配预览取景子区域（viewport logical）——Mobile Garage 时 = 左侧展示区。
   * Runtime reframePlayerCamera 经 battle.reframe(fit, framingRect) 使 previewSolo fit 到本区。
   */
  getPreviewFramingRect(): FramingRect | null {
    if (!this.isMobile) return null;
    const state = this.lastState;
    if (!state || state.playerPhase !== 'garage' || state.battleState !== 'editing') return null;
    // F-HOME-IA-R1：正式首页车辆取景区 = Home 布局 vehicleFramingRect（stage 上部、CTA 之上；
    // 与绘制/HitArea 同一份结果；完整车辆 envelope 进入 stageRect 且不被 CTA 裁切）
    // F-HOME-DEMO-POLISH-R1：home 取景 mode——renderer 按「宽 38%~52% + 底部锚定贴地」构图
    if (this.metaPage === 'home') {
      const rect = computeHomeLayout(
        { w: this.W, h: this.H },
        { left: this.insL, right: this.insR, top: this.insT, bottom: this.insB },
        this.profile,
      ).vehicleFramingRect;
      return { ...rect, mode: 'home' };
    }
    // F-WX-UI-F1：车辆取景区 = 唯一布局源 vehicleRect（与绘制/HitArea 完全同一份结果）
    return {
      ...computeMobileGarageLayout(
        { w: this.W, h: this.H },
        { left: this.insL, right: this.insR, top: this.insT, bottom: this.insB },
        this.profile,
      ).vehicleRect,
      mode: 'garage',
    };
  }




  /** 槽位 chip 定义（Desktop/Mobile 共用） */
  private garageChipDefs(draft: BuildDraft): Array<{ key: string; label: string; value: string }> {
    const body = registry.bodies.get(draft.bodyDefId);
    const wheelLabel = (defId: string | undefined, radius: number): string => {
      if (defId) return MOVEMENT_OPTIONS.find((o) => o.v === defId)?.t ?? registry.movements.get(defId)?.name ?? defId;
      return MOVEMENT_OPTIONS.find((o) => o.v === 'wheelStd')?.t ?? String(radius);
    };
    const defs: Array<{ key: string; label: string; value: string }> = [
      { key: 'body', label: '车身', value: body?.name ?? draft.bodyDefId },
      {
        key: 'rearWheel',
        label: '后轮',
        value: wheelLabel(draft.rearWheelDefId, draft.rearRadius),
      },
      {
        key: 'frontWheel',
        label: '前轮',
        value: wheelLabel(draft.frontWheelDefId, draft.frontRadius),
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
      // F-CONTENT-PLAYER-BODY-PACK-R1：正式车身目录 4→8；新 4 个默认未拥有 →
      // 卡片显示「未获得」+ 锁定（仍可见、不隐藏；与功能件未拥有星级同规范）
      for (const o of BODY_OPTIONS) {
        const owned = canEquipBody(o.v);
        opts.push({ v: o.v, t: o.t, meta: owned ? '' : '未获得', locked: !owned });
      }
    } else if (slot === 'rearWheel' || slot === 'frontWheel') {
      // F-CONTENT-PLAYER-MOVEMENT-PACK-R1：正式轮组目录 + 未获得锁定（wheelStd 恒可装备）
      for (const o of MOVEMENT_OPTIONS) {
        const owned = canEquipMovement(o.v);
        const def = registry.movements.get(o.v);
        opts.push({
          v: o.v,
          t: o.t,
          meta: owned ? `${def?.energy ?? 0} 能量` : '未获得',
          locked: !owned,
        });
      }
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
    if (slot === 'rearWheel') return draft.rearWheelDefId ?? String(draft.rearRadius);
    if (slot === 'frontWheel') return draft.frontWheelDefId ?? String(draft.frontRadius);
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
   * F-MATCH-UX-R1：matching / matchPreview 共用同一连续画面（布局锚点恒定，禁止整屏硬切）：
   * - 左：我的车（renderer previewFixed 画 A 左 B 右，进入 Matching 后始终可见）；不画文字大标签（避免覆盖车辆）。
   * - 中：VS（半透明大字）+ 单一状态文字（搜索「正在寻找对手…」/ 锁定「对手已锁定」）；
   *   全屏只保留这一套状态表达，不另加「扫描对手中」等重复文字。
   * - 右：对手区域。搜索中为扫描占位（仅四角括号 + 顶部扫描线，纯边框不覆盖车辆、严格在 VS 右侧）；
   *   已锁定在同一 opX 锚点替换为真实对手（仅对手名称，不画驱动 pill、不画左右大标签）。
   * 只改变对手内容与状态文字，不改变整体布局锚点；正常流程无「开始战斗」按钮。
   */
  /**
   * F-MATCH-FRAME-R2：matching / matchPreview 共用同一连续画面，UI 直接读取 Runtime 推入的
   * 真实 A/B 屏幕 envelope（state.matchVehicleRects，逻辑 px）来绘制——根治「UI 锚点猜测与
   * renderer 实际落点脱节」的构图错位（扫描框圈空白 / 车辆右裁 / Locked 跳位）。
   * - 左：我的车（aRect，renderer previewFixed 画 A 左）——不画文字大标签（避免覆盖车辆）。
   * - 中：VS（半透明大字，恒定屏幕中心）+ 单一状态文字（顶部居中横幅）。
   * - 右：对手区域（bRect）。搜索中四角括号 + 顶部扫描线严格围绕 bRect（= 真实候选车辆）；
   *   锁定在同一 bRect 替换为真实对手名称（置于 bRect 上方独立标题区，不进入车辆 envelope）。
   * Matching → Locked 只替换内容与状态，aRect/bRect 中心不变（无跳位 / 无呼吸）。
   */
  private drawMatchingContinuum(state: PlayerUIState): void {
    const locked = state.playerPhase === 'matchPreview';
    const op = state.opponent;
    const ctx = this.ctx;
    // 真实 A/B 屏幕 envelope（逻辑 px）；无数据（测试 / 非预览态）回落到比例锚点（真实流程恒有）。
    const rv = state.matchVehicleRects;
    let bRect: { x: number; y: number; w: number; h: number };
    if (rv) {
      bRect = rv.b;
    } else {
      const centerY = this.H / 2 - 20;
      const vw = Math.min(this.W * 0.26, 180);
      const vh = Math.min(this.H * 0.5, 220);
      bRect = { x: this.W * 0.7 - vw / 2, y: centerY - vh / 2, w: vw, h: vh };
    }
    const bCx = bRect.x + bRect.w / 2;

    // 中央 VS（辅助信息：小字、恒定屏幕中心、低透明；不成为屏幕最大元素）
    ctx.save();
    ctx.globalAlpha = 0.5;
    this.text('VS', this.W / 2, this.H / 2, this.isMobile ? 18 : 20, V.textSecondary, 'center', 800);
    ctx.restore();

    // 顶部中央单一状态文字（全屏唯一状态表达；不覆盖车辆）
    this.text(
      locked ? '对手已锁定' : '正在寻找对手…',
      this.W / 2,
      this.insT + (this.isMobile ? 22 : 28),
      this.isMobile ? 15 : 17,
      locked ? V.primary : V.textSecondary,
      'center',
      700,
    );

    // F-PREBATTLE-VISUAL-R1：Locked 揭晓高亮环计时（克制；不移动车辆 / 不切换背景）
    if (locked && !this.prebattleLockSeen) this.prebattleLockAt = this.nowMs;
    this.prebattleLockSeen = locked;
    const reveal = locked ? Math.max(0, 1 - (this.nowMs - this.prebattleLockAt) / 500) : 0;

    if (locked && op) {
      // 锁定：独立名牌区（右车上方），不与车辆 / 武器 / 轮组 / 地面相交
      const plateH = this.isMobile ? 22 : 26;
      const gap = 8; // 名牌与车辆 envelope 顶部的可见间距（6~12px）
      const plateY = Math.max(this.insT + 4, bRect.y - plateH - gap);
      const nameFs = Math.max(8, (this.isMobile ? 15 : 17) * this.fontScale * this.scale);
      ctx.font = `700 ${nameFs}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
      const nameW = Math.max(120, ctx.measureText(op.bodyName).width + 36);
      const plateW = Math.min(this.W * 0.6, nameW);
      // F-WX-SAFE-AREA-P0：名牌中心在 0.7W，长名字时右缘会顶到顶部右侧胶囊——
      // 整体左移，使名牌右缘 ≤ W − insR（唯一契约的胶囊右侧内缩）− 4，确保与胶囊 ≥6px 间距。
      const maxRight = this.W - (this.insR > 0 ? this.insR : 8) - 4;
      let plateX = bCx - plateW / 2;
      const plateRight = plateX + plateW;
      if (plateRight > maxRight) plateX -= plateRight - maxRight;
      this.panel(plateX, plateY, plateW, plateH, 'rgba(20,28,44,0.82)', 'rgba(255,138,61,0.55)', 6);
      this.text(op.bodyName, plateX + plateW / 2, plateY + plateH / 2 + 1, this.isMobile ? 15 : 17, V.enemyOrange, 'center', 700);
      // 揭晓反馈（克制）：右车高亮环，锁定后 ~500ms 淡出（不进入中央 VS、不位移车辆）
      if (reveal > 0) {
        ctx.save();
        ctx.globalAlpha = 0.5 * reveal;
        ctx.strokeStyle = V.enemyOrange;
        ctx.lineWidth = 2;
        const pr = 6 + (1 - reveal) * 10;
        this.panel(bRect.x - pr, bRect.y - pr, bRect.w + pr * 2, bRect.h + pr * 2, undefined, V.enemyOrange, 8);
        ctx.restore();
      }
    } else {
      // 搜索中：扫描框严格围绕真实候选车辆 bRect（不圈空白、不覆盖车辆、不进入中央 VS）。
      // bRect 来自 renderer 真实 envelope（matchVehicleRects.b），框四边与车辆可见 envelope 间距 6~12px。
      const t = this.nowMs;
      const pulse = 0.5 + 0.5 * Math.sin(t * 0.012);
      const pad = this.isMobile ? 8 : 10; // 6~12px
      const fx = bRect.x - pad, fy = bRect.y - pad;
      const fw = bRect.w + pad * 2, fh = bRect.h + pad * 2;
      const corner = Math.min(fw, fh) * 0.2;
      const bc = `rgba(120,175,255,${(0.55 + 0.3 * pulse).toFixed(3)})`;
      const arms: Array<[number, number]> = [
        [fx, fy], [fx + fw - corner, fy], [fx, fy + fh - corner], [fx + fw - corner, fy + fh - corner],
      ];
      for (const [cx, cy] of arms) {
        this.rect(cx, cy, corner, 3, bc);
        this.rect(cx, cy, 3, corner, bc);
      }
      // 细边框（弱，强调「框住车辆」而非空区）
      ctx.save();
      ctx.globalAlpha = 0.22 + 0.14 * pulse;
      ctx.strokeStyle = 'rgba(120,175,255,0.9)';
      ctx.lineWidth = 1;
      this.panel(fx, fy, fw, fh, undefined, 'rgba(120,175,255,0.9)', 6);
      ctx.restore();
      // 扫描线（框内上下扫动，克制；在车辆之上不覆盖主体）
      const sweepY = fy + 6 + ((t % 1400) / 1400) * (fh * 0.5);
      this.rect(fx + 10, sweepY, fw - 20, 2, 'rgba(160,205,255,0.85)');
      // 中央准星（强调「作用于右车」）
      const retR = 7;
      const rcY = bRect.y + bRect.h / 2;
      ctx.save();
      ctx.globalAlpha = 0.5 + 0.3 * pulse;
      ctx.strokeStyle = 'rgba(160,205,255,0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(bCx, rcY, retR, 0, Math.PI * 2);
      ctx.moveTo(bCx - retR - 4, rcY);
      ctx.lineTo(bCx - retR + 2, rcY);
      ctx.moveTo(bCx + retR - 2, rcY);
      ctx.lineTo(bCx + retR + 4, rcY);
      ctx.stroke();
      ctx.restore();
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
      // F-BATTLE-READABILITY-R1：左右阵营卡——左蓝（我方名+HP条+数字辅助）/
      // 右橙（对手名+HP条+数字辅助）；不再只显示 A/B 字母（数字降为辅助信息）。
      const aName = frame.names?.a ?? '我方';
      const bName = frame.names?.b ?? '对手';
      // 左阵营（我方 / 蓝）
      this.text(aName, barBase, top + 11, 13, V.ownBlue, 'left', 700);
      const barAX = barBase;
      const barY = top + 17;
      this.rect(barAX, barY, barW, h, '#232b38', V.border, 1);
      if (pctA > 0) this.rect(barAX, barY, barW * (pctA / 100), h, V.ownBlue);
      this.text(`${Math.round(s.sideA.hp)}`, barAX + barW + 6, barY + h / 2, 12, V.textPrimary);
      // 右阵营（对手 / 橙）
      const barBRight = this.W - this.insR - 8;
      this.text(bName, barBRight, top + 11, 13, V.enemyOrange, 'right', 700);
      const barBX = barBRight - barW;
      this.rect(barBX, barY, barW, h, '#232b38', V.border, 1);
      if (pctB > 0) this.rect(barBX, barY, barW * (pctB / 100), h, V.enemyOrange);
      this.text(`${Math.round(s.sideB.hp)}`, barBX - 6, barY + h / 2, 12, V.textPrimary, 'right');

      // F-BATTLE-HUD-HAZARD-R1：阶段提示统一语义——Active 无需持续占据中央「战斗中」；
      // Warning/Closing 才在中央显示「收束警告 N / 刺墙逼近 N」完整信息组（文案来自
      // runtime phaseCountdownText，与 short HUD 同源；文字变化解释 Warning→Closing 重置）。
      if (s.phase === 'Warning' || s.phase === 'Closing') {
        if (frame.phaseCountdownText != null) {
          this.text(frame.phaseCountdownText, this.W / 2, top + 46, 26, V.lose, 'center', 800);
        }
      } else if (s.phase === 'End') {
        this.text('战斗结束', this.W / 2, top + 11, 14, V.primary, 'center');
      }
      // F-BATTLE-READABILITY-R1：Warning/Closing 左右边缘危险脉冲（收束压力来自两侧；
      // 细条贴边，不遮挡车辆/战场核心）
      if (s.phase === 'Warning' || s.phase === 'Closing') {
        this.drawDangerEdgePulse(s.phase === 'Closing');
      }
      return;
    }
    // A 左上（桌面 HUD 起点：下方为阵营卡，与 mobile 分支以本注释为界）
    // F-BATTLE-PRESENTATION-R2：Desktop HUD 统一为阵营卡（与 mobile 同源同语义，消除调试 A/B 字母 +
    // 全宽调试条 + 常驻「战斗中」）。左右阵营卡：车辆名 + HP 条 + 当前/最大 HP + 蓝/橙阵营色；
    // 仅在 Warning / Closing 中央显示阶段提示/倒计时；End 显示「战斗结束」。不遮挡车辆/战场核心。
    const aName = frame.names?.a ?? '我方';
    const bName = frame.names?.b ?? '对手';
    const pctA = Math.max(0, Math.min(1, s.sideA.hp / Math.max(s.sideA.maxHp, 1))) * 100;
    const pctB = Math.max(0, Math.min(1, s.sideB.hp / Math.max(s.sideB.maxHp, 1))) * 100;
    const barBase = this.insL + 12;
    const barW = Math.max(96, (this.W - this.insL - this.insR - 120) * 0.3);
    const top = this.insT + 8;
    const h = 12;
    const barY = top + 17;
    // 左阵营（我方 / 蓝）
    this.text(aName, barBase, top + 11, 14, V.ownBlue, 'left', 700);
    this.rect(barBase, barY, barW, h, '#232b38', V.border, 1);
    if (pctA > 0) this.rect(barBase, barY, barW * (pctA / 100), h, V.ownBlue);
    this.text(`${Math.round(s.sideA.hp)} / ${Math.round(s.sideA.maxHp)}`, barBase + barW + 8, barY + h / 2, 12, V.textPrimary);
    // 右阵营（对手 / 橙）
    const barBRight = this.W - this.insR - 12;
    this.text(bName, barBRight, top + 11, 14, V.enemyOrange, 'right', 700);
    const barBX = barBRight - barW;
    this.rect(barBX, barY, barW, h, '#232b38', V.border, 1);
    if (pctB > 0) this.rect(barBX, barY, barW * (pctB / 100), h, V.enemyOrange);
    this.text(`${Math.round(s.sideB.hp)} / ${Math.round(s.sideB.maxHp)}`, barBX - 8, barY + h / 2, 12, V.textPrimary, 'right');
    // 阶段文案：仅 Warning/Closing 中央显示；End 显示「战斗结束」；Active 不占中央（Must#6）
    if (s.phase === 'Warning' || s.phase === 'Closing') {
      if (frame.phaseCountdownText != null) {
        this.text(frame.phaseCountdownText, this.W / 2, top + 11, 26, V.lose, 'center', 800);
      }
    } else if (s.phase === 'End') {
      this.text('战斗结束', this.W / 2, top + 11, 14, V.primary, 'center');
    }
    // Warning/Closing 左右边缘危险脉冲（收束压力来自两侧；细条贴边，不遮挡车辆/战场核心）
    if (s.phase === 'Warning' || s.phase === 'Closing') {
      this.drawDangerEdgePulse(s.phase === 'Closing');
    }
  }

  /**
   * F-BATTLE-READABILITY-R1：Warning/Closing 左右边缘危险脉冲——半透明红竖条 + 脉动
   * （Closing 更亮更强），提示「收束压力来自两侧」；细条贴边，不遮挡车辆/战场核心。
   * F-BATTLE-HUD-HAZARD-R1：降低叠加饱和度——墙体已降为半透明填充，边缘脉冲同步克制
   * （Closing 0.55→0.40、Warning 0.28→0.22），车辆/轮廓/尖刺成为最强视觉元素而非红幕。
   */
  private drawDangerEdgePulse(closing: boolean): void {
    const pulse = 0.5 + 0.5 * Math.sin(this.nowMs * 0.012);
    const alpha = closing ? 0.4 + 0.16 * pulse : 0.22 + 0.18 * pulse;
    const w = Math.max(5, Math.round(this.W * 0.012));
    const topY = this.insT;
    const h = this.H - this.insT - this.insB;
    const ctx = this.ctx;
    ctx.globalAlpha = alpha;
    this.rect(this.insL, topY, w, h, '#ff3b3b');
    this.rect(this.W - this.insR - w, topY, w, h, '#ff3b3b');
    ctx.globalAlpha = 1;
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
    this.rect(barBase, top, barW, h, '#232b38', V.border, 1);
    if (pctA > 0) this.rect(barBase, top, barW * (pctA / 100), h, V.ownBlue);
    const barBRight = this.W - this.insR - 8;
    const barBX = barBRight - barW;
    this.rect(barBX, top, barW, h, '#232b38', V.border, 1);
    if (pctB > 0) this.rect(barBX, top, barW * (pctB / 100), h, V.enemyOrange);
    // 中央阶段提示：仅 Warning / Closing（不遮挡车辆/武器/FX——车辆位于下部战斗带）
    // F-BATTLE-HUD-HAZARD-R1：直接用 runtime 完整文案（「收束警告 N / 刺墙逼近 N」），
    // 与 mobile-normal 同源同一语义；不再本端拼接 label（孤立数字已消除）。
    if (s.phase === 'Warning' || s.phase === 'Closing') {
      if (frame.phaseCountdownText != null) {
        this.text(frame.phaseCountdownText, this.W / 2, top + 44, 24, V.lose, 'center', 800);
      }
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
    this.panel(cardX, cardY, cardW, cardH, V.panelSolid, V.border, V.radiusL);
    const r = state.result!;
    const isWin = r.winner === 'A';
    this.text(isWin ? '【胜利】' : '【失败】', BASE_W / 2, cardY + 44, 44, isWin ? V.win : V.lose, 'center', 800);
    this.text(`我方剩余 HP：${Math.round(r.hpA)}`, BASE_W / 2, cardY + 84, 14, V.textSecondary, 'center');
    this.text(`对手剩余 HP：${Math.round(r.hpB)}`, BASE_W / 2, cardY + 106, 14, V.textSecondary, 'center');

    let y = cardY + 132;
    if (state.reward) {
      this.panel(cardX + 20, y, cardW - 40, 58, V.panelEmph, V.border, V.radiusM);
      this.text('获得部件', BASE_W / 2, y + 16, 12, V.textSecondary, 'center');
      this.text(`${state.reward.name} ${state.reward.starStr}`, BASE_W / 2, y + 38, 22, V.primary, 'center', 700);
      // F-CONTENT-REWARD-ACQUISITION-R1：车身奖励追加「已解锁」（无 x1 概念）
      this.text(
        state.reward.kind === 'body' ? `${state.reward.cat} · 已解锁` : state.reward.cat,
        BASE_W / 2,
        y + 52,
        12,
        V.textFaint,
        'center',
      );
      y += 66;
    }
    if (state.economy) {
      const coinSign = state.economy.coinDelta >= 0 ? '+' : '';
      const ratingSign = state.economy.ratingDelta >= 0 ? '+' : '';
      this.panel(cardX + 20, y, cardW - 40, 52, V.panelEmph, V.border, V.radiusM);
      this.text(`本局金币 ${coinSign}${state.economy.coinDelta} · 段位 ${ratingSign}${state.economy.ratingDelta}（${state.economy.tierLabel} ${state.economy.rating}）`, BASE_W / 2, y + 18, 14, V.primary, 'center', 700);
      this.text(`当前金币 ${state.economy.coin}`, BASE_W / 2, y + 38, 12, V.textSecondary, 'center');
      y += 60;
    }
    if (state.resultOnboardingVisible) {
      this.text('获得新部件，可以回车库调整', BASE_W / 2, y + 12, 13, C.onboardText, 'center'); // C.onboardText 仍为 onboard 引导语义
      y += 28;
    }
    // 按钮行（F-LOSS-ADJUST-REMATCH-LOOP-P0｜Must#3：主/次按钮按胜负切换——
    // 战败主=「调整配置」暖金（先修车再打）、胜利主=「下一场」；另一为次按钮；
    // 位置不变（调整配置左 / 下一场右），hitArea 由 button() 每次绘制注册 → 与视觉同源）。
    const btnY = cardY + cardH - 56;
    let bx = cardX + 20;
    this.button(bx, btnY, 120, 40, 'result-adjust', '调整配置', { primary: !isWin });
    bx += 130;
    this.button(bx, btnY, 120, 40, 'result-next', '下一场', { primary: isWin });
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
      // F-RESULT-DEMO-R2：零增量不显示孤立「+0」/空字段（金币/段位 delta=0 → 隐藏该块）
      if (state.economy.coinDelta !== 0) {
        const cs = state.economy.coinDelta > 0 ? '+' : '';
        rows.push({ label: '金币', value: `${cs}${state.economy.coinDelta}`, tone: 'gold' });
      }
      if (state.economy.ratingDelta !== 0) {
        const rs = state.economy.ratingDelta > 0 ? '+' : '';
        rows.push({
          label: '段位',
          value: `${rs}${state.economy.ratingDelta}`,
          sub: `${state.economy.tierLabel} ${state.economy.rating}`,
          tone: state.economy.ratingDelta >= 0 ? 'blue' : 'red',
        });
      }
    }
    const body: string[] = [];
    if (state.resultOnboardingVisible) body.push('获得新部件，可以回车库调整');
    this.showModal({
      title: isWin ? '胜利' : '失败',
      titleTone: isWin ? 'green' : 'red',
      body,
      rewardRows: rows.length ? rows : undefined,
      partCard: state.reward
        ? {
            name: state.reward.name,
            starStr: state.reward.starStr,
            count: state.reward.countAfter,
            // F-CONTENT-REWARD-ACQUISITION-R1：车身奖励显示「已解锁」（无意义 x1 不展示）
            unlocked: state.reward.kind === 'body',
          }
        : undefined,
      // F-UX-2D：Result 是最终决策层——大尺寸档（明显放大）
      // F-LOSS-ADJUST-REMATCH-LOOP-P0｜Must#3：战败主=调整配置（先修车再打）、胜利主=下一场
      large: true,
      primary: isWin ? '下一场' : '调整配置',
      secondary: isWin ? '调整配置' : '下一场',
      // F-UX-3C：广告入口在奖励区内部（「额外 +50金币 · 看广告」），明显弱于底部两决策
      adRow: state.rewardAdAvailable
        ? {
            label: state.rewardAdClaimed ? `已领 +${REWARD_AD_COIN_BONUS}金币` : `额外 +${REWARD_AD_COIN_BONUS}金币 · 看广告`,
            disabled: state.rewardAdClaimed,
            onPress: () => this.actions?.onClaimRewardAd(),
          }
        : undefined,
      onPrimary: () => (isWin ? this.actions?.onResultNext() : this.actions?.onResultAdjust()),
      onSecondary: () => (isWin ? this.actions?.onResultAdjust() : this.actions?.onResultNext()),
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
    const rewardRowH = this.isShort ? 26 : 38; // F-RESULT-DEMO-R2：紧凑结果块高（金币/段位并排，值紧跟标签）
    const titleH = this.isShort ? 20 : 40;
    const btnH = this.isShort ? Math.min(this.targetTouchH, 36) : this.targetTouchH;
    const pad = this.isShort ? 6 : 16;
    // F-UX-3C：广告小型入口高（short 16 / normal 22）+ 前后间隙（明显弱于底部按钮）
    const adH = spec.adRow ? (this.isShort ? 16 : 22) + (this.isShort ? 4 : 14) : 0;
    const partH = spec.partCard ? (this.isShort ? 26 : 58) : 0;
    const hasContentBefore =
      spec.body.length > 0 || (spec.rewardRows?.length ?? 0) > 0 || !!spec.adRow;
    const partGap = spec.partCard && hasContentBefore ? (this.isShort ? 4 : 8) : 0;
    // 固定部分高（不含 body 行）——rewardRows 为并排紧凑块（一行）
    const fixedH = pad + titleH + ((spec.rewardRows?.length ?? 0) > 0 ? rewardRowH : 0) + adH + partH + partGap + (this.isShort ? 4 : 10) + btnH + pad;
    const availBodyH = H - this.insT - this.insB - fixedH;
    const rowH = spec.body.length > 0 ? Math.max(12, Math.min(22, availBodyH / spec.body.length)) : 22;
    const contentH = fixedH + spec.body.length * rowH;
    // F-RESULT-DEMO-R2：删除 R1 强制大留白（0.62H/0.86H）——卡片内容自适应（紧凑），
    // 仅保留小保底（0.45H/0.55H）避免过小；硬上限 = safe 区高（maxCardH），极限短屏不溢出。
    const maxCardH = H - this.insT - this.insB;
    const minLargeH = Math.floor(H * (this.isShort ? 0.55 : 0.45));
    const cardH = large ? Math.min(maxCardH, Math.max(contentH, minLargeH)) : contentH;
    const cx = Math.max(this.insL, Math.min((W - cardW) / 2, W - this.insR - cardW));
    const cy = Math.max(this.insT, Math.min((H - cardH) / 2, H - this.insB - cardH));
    this.panel(cx, cy, cardW, cardH, C.dockBg, V.border, V.radiusL);
    // ① 顶部：标题（胜利/失败）——F-RESULT-UX-R1：语义色调，第一眼知道输赢
    const titleColor = spec.titleTone === 'green' ? V.win : spec.titleTone === 'red' ? V.lose : V.textPrimary;
    this.text(spec.title, cx + cardW / 2, cy + pad + titleH / 2, large ? (this.isShort ? 20 : 28) : 20, titleColor, 'center', 800);
    let yy = cy + pad + titleH + 4;
    // ② 中部：body 文字行（onboarding 引导等）
    for (const line of spec.body) {
      this.text(line, cx + cardW / 2, yy + rowH / 2, 14, V.textSecondary, 'center');
      yy += rowH;
    }
    // ② 中部：奖励块（金币/段位；F-RESULT-DEMO-R2：紧凑结果块——label 与 value 同块
    // 紧邻（不再两端分离 / 无整行表格线），sub（段位名+当前值）为块内辅助小字）
    if (spec.rewardRows) {
      const toneColor: Record<ModalTone, string> = {
        gold: V.primary,
        blue: V.ownBlue,
        red: V.lose,
        green: V.win,
      };
      const n = spec.rewardRows.length;
      const gapX = this.isShort ? 8 : 16;
      const blockW = (cardW - 2 * pad - gapX * (n - 1)) / n;
      for (let i = 0; i < n; i++) {
        const rr = spec.rewardRows[i]!;
        const bx = cx + pad + i * (blockW + gapX);
        const ls = this.isShort ? 10 : 13;
        const vs = this.isShort ? 15 : 22;
        // label 宽估算（stub ctx 无 measureText）：字号 × 字符数 × 0.9
        const lw = rr.label.length * ls * 0.9;
        this.text(rr.label, bx, yy + (this.isShort ? 8 : 12), ls, V.textSecondary, 'left');
        this.text(rr.value, bx + lw + (this.isShort ? 4 : 6), yy + (this.isShort ? 8 : 12), vs, rr.tone ? toneColor[rr.tone] : V.textPrimary, 'left', 800);
        if (rr.sub) {
          this.text(rr.sub, bx, yy + (this.isShort ? 20 : 30), this.isShort ? 9 : 12, V.textFaint, 'left');
        }
      }
      yy += rewardRowH;
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
      // F-RESULT-UX-R1：去掉整框表格线——改用极淡顶部分隔线（不画满框 / 不画整行边框），
      // 卡片靠留白与淡分隔线分组，不再像后台数据表。
      this.rect(cx + pad, yy, pw, 1, undefined, V.borderSoft, 1);
      if (this.isShort) {
        // short 紧凑两行：名称 + 库存（上）· 星级（下）
        this.text(spec.partCard.name, cx + pad + 12, yy + 8, 12, V.textPrimary, 'left', 700);
        this.text(
          spec.partCard.unlocked ? '已解锁' : `库存 ${spec.partCard.count}`,
          cx + cardW - pad - 12,
          yy + 8,
          11,
          V.textSecondary,
          'right',
        );
        this.text(spec.partCard.starStr, cx + pad + 12, yy + 18, 11, V.primary, 'left', 700);
      } else {
        this.text(spec.partCard.name, cx + pad + 12, yy + 18, 16, V.textPrimary, 'left', 700);
        this.text(
          spec.partCard.unlocked ? '已解锁' : `库存 ${spec.partCard.count}`,
          cx + cardW - pad - 12,
          yy + 18,
          14,
          V.textSecondary,
          'right',
        );
        this.text(spec.partCard.starStr, cx + pad + 12, yy + 36, 15, V.primary, 'left', 700);
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
    this.text('READY', this.W / 2, this.H / 2 - 40, this.isMobile ? 13 : 15, V.textSecondary, 'center');
    this.text('开战！', this.W / 2, this.H / 2 + 14, this.isMobile ? 36 : 46, V.primary, 'center', 800);
  }
}
