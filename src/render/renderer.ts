/**
 * Renderer：只消费引擎中立 Render Snapshot（BattleRenderSnapshot）。
 * 表现 Sprite / FX / Hit 反馈 / Damage 数字。
 * 禁止 Renderer 决定 Gameplay；不依赖任何具体物理引擎（Matter / Planck / adapter）。
 */
import type {
  BattleOrchestratorApi,
  BattleRenderSnapshot,
  RenderVehicle,
  RenderShape,
  RenderCircle,
  RenderProjectile,
  RenderFlame,
  RenderSpark,
  RenderConnector,
  RenderVisual,
} from '../battle/battleContract';
import type { DamageEvent } from '../battle/combatEvents';
import { VisualRegistry } from './visualRegistry';
import { vehicleDeathAlpha, damageFeedbackColors } from '../presentation/battlePhaseFx';
import { DamageNumberAggregator } from '../presentation/damageNumberAggregator';
import { buildFireJet } from '../presentation/fireJetBuilder';
import { isCompactLandscape } from './viewportProfile';
import { V } from '../ui/visualTokens';
import type { CanvasSurface } from './canvasSurface';

/** Projectile 颜色（Q02-C3B）：A/B 可明显区分（与车身蓝/橙区分，更亮） */
export const PROJECTILE_COLOR_A = '#7de8ff';
export const PROJECTILE_COLOR_B = '#ffd05a';

/**
 * Q14-A-R2-FINAL：机枪弹迹世界长度（world px）。
 * muzzleSpeed=12 × roundInterval 6 步 ≈ 72px 间隔；取 22px → 相邻弹迹保留约 50px 明显黑间隔，
 * 不再首尾相接成连续白线（像 Laser）。固定单一值，不做参数扫描。真实 Collider 半径未变。
 */
export const MACHINE_GUN_TRACER_WORLD_LENGTH = 22;

interface ScreenTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/**
 * 镜头缩放（Camera / View framing，与 Physics 尺度分离）。
 * 放大画面让车辆 / 碰撞 / 姿态成为主体；不改变物理世界与 Gravity 等 Foundation 尺度。
 */
const VIEW_ZOOM = 1.8;

// 内容自适应取景（Q02-CAM-R1/R2）：仅在 Scenario load / Reset / viewport resize 时按
// 车辆（不含 projectile）包围盒取景一次并固定；运行期间镜头完全稳定，不呼吸缩放。
// R2：构图以「中央实际战斗可视区域」为准——左右 Lab UI 面板不计入可用画布，
// 世界内容完整放入安全区并保留固定世界边距，A 不会被左侧 UI 遮挡。
const CONTENT_MARGIN_WORLD = 64;
const CONTENT_ZOOM = 1.05;
const MIN_CONTENT_SCALE = 0.4;
const MAX_CONTENT_SCALE = 5;
/**
 * Q06-UX-R2-FIX：装配 Preview 构图（明显放大，优先看清 Body 与 Functional 部件）。
 * 放大完全来自「近距 spawn（physicsLab loadCustomPreview 专属 spawnA/spawnB）收窄
 * A+B bounds + 更小的世界边距」——不再 fit 后乘额外 zoom（旧 ×1.9 会把内容推出
 * safe viewport 造成左右裁切）。scale 恒不超过完整内容 fit 上限，A/B 完整入画是硬约束。
 */
const PREVIEW_MARGIN_WORLD = 18;
/**
 * F-BATTLE-CAMERA-R2：战斗相机——envelope 主体构图常量。
 * 战斗构图以 A+B 真实可见 envelope（body+wheel+parts+visual）为基准，不再按整个
 * Arena / 收束墙全量 fit（旧 Closing 全景把车辆缩成小模型；旧 corridor 预算高度
 * 在横向主导时产生车辆贴底 + 顶部大片无意义空白）。
 */
// F-BATTLE-STAGE-COMPOSITION-P0：battleStageRect（显式舞台，非单一比例）——
// 顶部避开 HUD（stageTop = HUD 下缘）、底部保留有限地面带（groundY ∈ 视口高 68%~72%，
// 地面下 28%~32% 场景带）。groundScreenY 由 Active 首帧按「车辆完整位于 HUD 下」计算并
// 记录到 battleCam，Warning/Closing/End 复用同一地面线（位移 0），杜绝压底 + 顶部死区。
const BATTLE_STAGE_GROUND_MIN = 0.68; // groundY 下限（视口高比例；避开 HUD 上方死区）
const BATTLE_STAGE_GROUND_MAX = 0.72; // groundY 上限（视口高比例；不重新贴底）
const BATTLE_STAGE_VEHICLE_CLEAR = 12; // 车辆 envelope 顶与 HUD 下缘净空（逻辑 px）
const BATTLE_ENV_PAD_X = 48; // A+B envelope 并集横向 padding（世界 px；有限活动空间，不过度拉远）
const BATTLE_CLOSE_SCALE_DELTA = 0.1; // F-BATTLE-STAGE-COMPOSITION-P0：阶段切换尺度变化 ≤10%
// （原 0.15 → 0.10；Must：Active/Warning/Closing/End 切换无骤缩）
const BATTLE_SEPARATE_SCALE_MIN = 0.88; // 分离拉远下限（相对 Active 基准；车辆仍可识别）
/** 构图安全区：左右 UI 阴影区不计入可用画布（CSS px，每侧内缩量） */
const SAFE_INSET_X = 56;
const SAFE_INSET_Y = 28;

/**
 * 取景模式：
 * - vehicles：含 A+B 完整入画（机制场景默认构图）；
 * - primary-fire：A 偏左中部 + 身后 recoil 空间 + 前方固定射击空间（Cannon-Recoil / Cannon-Angle 共用）；
 * - battle：正式战斗固定战场——覆盖 Arena 有效战斗区域（x: 0..width；y: Closing 墙顶..地面+margin），
 *   保证车辆被 Closing 推向边缘/中央的全过程始终可见（W1-P0-CLOSE-FIX；Start/Reset 构图一次，
 *   运行期间绝不 follow、不动态 zoom、不随 projectile 扩镜头）。
 */
export type CameraFit = 'vehicles' | 'primary-fire' | 'battle' | 'preview' | 'previewSolo' | 'previewFixed';

/**
 * F-WX-UI-1：取景子区域（viewport logical 坐标）。
 * reframe 的 opts.framingRect 存在时，固定预览框（previewSolo/previewFixed）fit 到该
 * 子区域内的安全区（rect 已含布局留白），用于 Mobile Garage 把车辆 fit 到「左侧展示区」。
 * 无 framingRect → 全屏安全区逻辑不变（Desktop 零影响）。
 */
export interface FramingRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * F-HOME-DEMO-POLISH-R1：取景模式。
   * - 'home'（首页全宽取景区）：车辆宽目标 = 安全宽 38%~52%（clamp）+ 底部锚定贴地
   *   （groundY 落到取景区底缘上方 12px，消除悬浮）；极端构筑由 envelope 口径保证完整入画。
   * - 'garage'（配置页左侧竖条，缺省语义）：保持垂直居中 fit（既有行为）。
   */
  mode?: 'home' | 'garage';
}

/**
 * Q15-UI-R2：玩家 Shell 固定预览取景（不呼吸缩放，不随 B 车身 bounds 重新 zoom）。
 * - previewSolo：Garage 只渲染「我的车」——固定世界框，使单车约占安全可视宽 ~40%，
 *   不因 2560/1920 宽屏把车无限放大、也不留大片黑区；
 * - previewFixed：Matching / MatchPreview 同一固定框——A 左 B 右对称、同尺度，
 *   候选换车时镜头完全不动（杜绝「巨大 A + 迷你 B」）。
 * 框基于 loadCustomPreview 专属近距 spawn（A x=620 / B x=980，y=640）外扩固定余量。
 */
const SOLO_MIN_X = 400;
const SOLO_MAX_X = 840;
const SOLO_MIN_Y = 400;
const SOLO_MAX_Y = 730;
// F-WX-RCA-3A：Mobile Garage previewSolo 以 coreBounds（Body+Wheels）为主尺度，
// padding 按 core 尺寸比例（非固定 world margin）——不同 Body 的 core（最窄/最宽/最高/
// 最低）均完整入画且屏占比稳定（padding 比例固定 → coreW/(coreW+2×padX) 与屏宽无关）。
// 横向 0.38×core 宽（watermelon core 170 → padX 65，覆盖普通武器外伸 envelope 243<300；
// 极长武器尖端允许越界，优先保证车身主体可读）；纵向 0.31×core 高（core 高 77 → padY 24，
// 保持横向主导）；MIN 下限保证极窄/极矮 core 也有余量。
const SOLO_PAD_X_RATIO = 0.38;
const SOLO_PAD_Y_RATIO = 0.31;
const MIN_SOLO_PAD_X = 40;
const MIN_SOLO_PAD_Y = 20;
// F-HOME-VISUAL-R2：首页车辆主视觉——普通初始车辆可见宽目标 = 安全宽 38%~47%
// （clamp fitLimit；高度主导时 fitLimit 优先保证完整入画）；垂直居中构图（视觉中心 Must#1，
// 贴地由前景展示平台表达；不再底部锚定贴地留白）。上限 47% 使实际屏幕占比 ≤ 48%（Must#2）。
const HOME_VEHICLE_WIDTH_MIN_PCT = 0.40;
const HOME_VEHICLE_WIDTH_MAX_PCT = 0.47;
// F-BATTLE-CAMERA-R2：battle 相机不再用 Mobile/Desktop 固定 corridor（旧 F-WX-8-C
// MOBILE_ACTIVE_* / Q08-A-FIX CORRIDOR_* 已删除）——统一按 A+B 真实 envelope 构图，
// 见 reframe battle 分支与 applyBattleFollow。
// F-MATCH-FRAME-R2：previewFixed 固定框必须容纳「全部候选 Body 的真实 envelope」（含武器外伸），
// 否则候选车辆被右边界裁切 / 左车被左边界裁切。实测所有候选 Body 组合 envelope 并集为
// minX≈305 / maxX≈1295 / minY≈560 / maxY≈699；框放宽到 [290,1310]×[535,712] 含余量，
// 且为固定框（候选切换 / Locked 替换均不呼吸、不裁切、不跳位）。A 固定 620、B 固定 980 →
// 框内分数 ≈ 0.33 / 0.66，左右槽位对称、中留 VS 间隙。
const MATCH_MIN_X = 290;
const MATCH_MAX_X = 1310;
const MATCH_MIN_Y = 535;
const MATCH_MAX_Y = 712;
// F-PREBATTLE-VISUAL-R1：战前（Matching/Locked）地面线锚定在视口高 PREBATTLE_GROUND_FRAC——
// 地面以下带 ≈ (1-frac) ≈ 28%（Must#8：24%~30%，杜绝「车辆悬上、近半屏纯色地面空区」）。
// 与 battle 同锚定语义（groundScreenY 恒定），但战前要求更薄地面带。
const PREBATTLE_GROUND_FRAC = 0.72;

interface FloatingText {
  x: number;
  y: number;
  text: string;
  color: string;
  bornAt: number;
  ttl: number;
  /** F-BATTLE-PRESENTATION-R2：重要伤害放大字号（px，逻辑）；缺省走常规字号 */
  size?: number;
  /** F-BATTLE-PRESENTATION-R2：重要伤害（单次大额）→ 绘制高亮光环、提高层级 */
  important?: boolean;
  /**
   * F-BATTLE-HIT-READABILITY-R1：伤害数字所属 target（车辆 side；同车渲染层硬限制 ≤2 组，
   * Must#2「以最终绘制数量为准」）。非伤害数字（spawnDamageNumber 直加）缺省 undefined。
   */
  target?: string;
  /** F-BATTLE-HIT-READABILITY-R1：同车纵向槽位（0/1；Must#4 稳定错层 12~16px） */
  slot?: number;
}

/**
 * F-PRESENT-1：高频伤害数字聚合窗口（ms）。
 * 同一来源（target+source+partId|behavior|damageSource）在窗口内的连续真实伤害
 * 合并为一个浮动数字；窗口以该组首次命中时间为起点，不无限延长。
 * 200~220ms 区间：喷火器(~33ms 间隔)每组含数次、机枪(100ms 间隔)每组含 2~3 发、
 * 持续攻击同时可见数字控制在 ~3~4 组，彻底消除数字云。
 */
const DAMAGE_AGGREGATE_WINDOW_MS = 210;
/** 伤害数字浮动停留时长（ms）；与旧版一致，不改动 */
const DAMAGE_NUMBER_TTL_MS = 900;
/** F-BATTLE-PRESENTATION-R2：重要伤害数字放大字号（逻辑 px；常规为 ss(22) 系） */
const DAMAGE_NUMBER_IMPORTANT_SIZE = 32;

/**
 * F-BATTLE-VISUAL-CLEANUP-R3｜Must#4：伤害数字「双方接触点屏幕空间避让」。
 *
 * 根因：A 打 B 与 B 打 A 的接触点在同一处时，两组数字都以同一 contactPoint 世界坐标
 * 生成（damageNumberAggregator 原样透传 ev.contactPoint），slot 只在**同车**两组之间
 * 做纵向错层 → 跨方两组数字在屏幕上完全重合，读不出「谁在打谁扣了多少」。
 *
 * 避让规则（纯表现，不改 contactPoint / 不改 damage 总量 / 不改 Gameplay）：
 * 受伤方的数字朝「受伤方所在一侧」推开——我方(target = vehicleA.team)数字偏我方，
 * 对手数字偏对手；方向来自两车真实包围盒中心 x 之差（不写死左右）。
 *
 * 量值：世界 px 基准经镜头 ss() 后再 clamp 到屏幕域下/上限：
 * - 下限 14（屏幕 px）：420×210 最小档 scale 很小，若纯按世界量会缩到 ~3px 不可分辨；
 *   两侧各偏 14 → 跨方数字最小水平间距 28px（> 常规字号一半，肉眼可区分）；
 * - 上限 34（屏幕 px）：高缩放下不把数字甩离接触点（仍能归因到命中位置）。
 */
const DAMAGE_LATERAL_WORLD = 26;
const DAMAGE_LATERAL_MIN_SCREEN = 14;
const DAMAGE_LATERAL_MAX_SCREEN = 34;

/**
 * F-BATTLE-VISUAL-CLEANUP-R3｜Must#3：正式部件「表现轮廓」基色与混合比。
 *
 * Must#1 调查结论（先确认再改）：真机 Battle「部件周围明显矩形外框」的来源**不是**
 * 碰撞调试绘制（render() 的 debugDraw 只由 DEV physicsLab 传入，wechatBattleHost /
 * playerGameRuntime 正式路径从不传）、**不是**挂点提示或 Garage 吸附反馈
 * （drawVehicleHardpoints / drawGarageDragGhost 只在 garage MetaPage 绘制）、
 * **不是** E2E 诊断轮廓——而是**正式部件视觉**：drawShape 对每个 collider polygon
 * 画近黑 `#0d0f14` + 恒定 1.5px 硬描边。compound 车身逐 polygon 描边 → 内部接缝
 * 全部显形 = 工程线框感；且线宽恒定不随镜头收敛，420×210 小档时线宽占部件比例极大。
 *
 * Must#3 要求「重做表现轮廓而不是删除真实部件」：几何 / collider / 部件集合一字不改，
 * 只把描边表现换成同色系派生的柔和轮廓（见 partOutlineColor / applyPartOutline）。
 */
const PART_OUTLINE_BASE = '#1b2130';
const PART_OUTLINE_MIX = 0.5;
/** 表现轮廓线宽（屏幕 px）：随镜头尺度收敛，小分辨率不再是粗黑框 */
const PART_OUTLINE_WORLD_WIDTH = 0.9;
const PART_OUTLINE_MIN_WIDTH = 0.6;
const PART_OUTLINE_MAX_WIDTH = 1.2;

/** `#rrggbb` → 分量；非法输入回退中性灰（不抛错，缺色不白屏） */
function parseHexColor(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return { r: 128, g: 128, b: 128 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** 线性混色（t=0 → a，t=1 → b），供表现轮廓由填充色派生 */
export function mixHexColor(a: string, b: string, t: number): string {
  const ca = parseHexColor(a);
  const cb = parseHexColor(b);
  const k = Math.max(0, Math.min(1, t));
  const ch = (x: number, y: number): string =>
    Math.round(x + (y - x) * k)
      .toString(16)
      .padStart(2, '0');
  return `#${ch(ca.r, cb.r)}${ch(ca.g, cb.g)}${ch(ca.b, cb.b)}`;
}

/**
 * F-BATTLE-VISUAL-CLEANUP-R3｜Must#3：表现轮廓色 = 填充色朝 PART_OUTLINE_BASE 加深。
 * 与旧近黑 `#0d0f14` 的差别：轮廓与填充同色系 → 对比度大幅下降，读作「部件自身边缘暗部」
 * 而不是「叠在部件上的调试线框」；仍保留边界可读（相邻部件 / 车辆与背景可分）。
 */
export function partOutlineColor(fill: string): string {
  return mixHexColor(fill, PART_OUTLINE_BASE, PART_OUTLINE_MIX);
}

/** 命中火花（W2-FX-1/2）：接触点短暂小圆（W2-FX-2 支持按伤害来源着色） */
interface Spark {
  x: number;
  y: number;
  bornAt: number;
  ttl: number;
  color: string;
}

/** 炮口闪光（W2-FX-1）：开火点短暂亮圆；color/radius 可选（laser 用白青大闪） */
interface MuzzleFlash {
  x: number;
  y: number;
  bornAt: number;
  ttl: number;
  color: string;
  radius: number;
}

/** 死亡 FX（W2-FX-1）：按 team 记录，绘制时取当前 Snapshot 车辆位置（与 hitFlashes 同模式） */
interface DeathFx {
  team: string;
  bornAt: number;
  ttl: number;
}

/** Q11-C-R3-FINAL：镭射「巨炮」能量束 VFX——发射后沿真实 fire 方向固定驻留、
 *  不跟随高速弹（弹速太快会瞬间出屏只留一闪）。纯表现，不参与碰撞/伤害。 */
interface LaserBeam {
  x: number; // 炮口世界位置
  y: number;
  dirX: number; // 真实飞行方向（单位向量）
  dirY: number;
  length: number; // 世界 px（约 2.5~3+ 车身长度）
  coreWidth: number; // 高亮核心宽（世界 px）
  glowWidth: number; // 外层 glow 总宽（世界 px）
  bornAt: number;
  ttl: number; // ms（≈100~150ms 残留后快速衰减）
}
/** 镭射巨炮束尺度（世界 px）：长 450~600 / 核心 12~18 / glow 30~45 */
// F-BATTLE-HIT-READABILITY-R1：镭射巨炮束收敛——520→240 世界 px（844 逻辑宽 ~28%，
// 不再「贯穿半屏的持续色带」，Must#7）；glow 38→22（≤ 弹体宽 40×60% = 24，Must#7
// 「最大宽度不超过弹体主要宽度的 60%」）；core/TTL 保持（发射线清楚，Must#8 三阶段可区分）。
const LASER_BEAM_LENGTH = 240;
const LASER_BEAM_CORE = 15;
const LASER_BEAM_GLOW = 22;
const LASER_BEAM_TTL = 130; // ms：30fps 下 ≈ 3.9 帧，可读 3~4 帧

/** Q13-B-R1：霰弹炮口「扇形」爆闪 VFX——有方向的短促扇形爆闪（非普通圆形 flash）。
 *  纯表现，不参与碰撞/伤害。 */
interface ShotgunFan {
  x: number; // 炮口世界位置
  y: number;
  dirX: number; // 真实 fire 基准方向（单位向量）
  dirY: number;
  bornAt: number;
  ttl: number; // ms
}
const SHOTGUN_FAN_TTL = 100; // ms：30fps 下 ≈ 3 帧，可读 2~3 帧

/** Q14-A-R1：机枪方向性枪口火舌——短促窄火舌沿真实 fire 方向展开（非难以看到的小圆点）。
 *  纯表现，不参与碰撞/伤害；不建通用 VFX Foundation。 */
interface MuzzleTongue {
  x: number; // 枪口世界位置
  y: number;
  dirX: number; // 真实 fire 方向（单位向量）
  dirY: number;
  bornAt: number;
  ttl: number; // ms
}
const MUZZLE_TONGUE_TTL = 60; // ms：50~70 区间（短促，连发时呈连续快闪火舌）

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  /** F-WX-6：相机变换公开（测试可验证取景；debugOverlay 已消费同值） */
  transform: ScreenTransform = { scale: 1, offsetX: 0, offsetY: 0 };
  /**
   * Q15-UI-R2：玩家 Shell 预览候选车轻量表现——仅 Matching 候选换车时对 B 施加
   * alpha/scale（A 不动）。纯渲染层，不影响 Physics / 不新增第二个 Renderer。
   */
  private previewFxB: { alpha: number; scale: number } | null = null;
  /** Q15-UI-R2：仅 B（Matching 候选车）轻量 alpha/scale 表现；传 null 恢复正常绘制 */
  setPreviewVehicleFx(fx: { alpha: number; scale: number } | null): void {
    this.previewFxB = fx;
  }
  private shapeCentroid(shape: RenderShape): { x: number; y: number } {
    if (shape.kind === 'circle') return { x: shape.circle.center.x, y: shape.circle.center.y };
    let sx = 0, sy = 0, n = 0;
    if (shape.kind === 'polygons') {
      for (const poly of shape.polygons) for (const p of poly.points) { sx += p.x; sy += p.y; n++; }
    }
    return n ? { x: sx / n, y: sy / n } : { x: 0, y: 0 };
  }
  private fx: FloatingText[] = [];
  /** 命中闪白：保存 target team + 时间，绘制时取当前 Snapshot 对应车辆形状（不再保存 Matter Body） */
  private hitFlashes: Array<{ team: string; bornAt: number; ttl: number }> = [];
  private sparks: Spark[] = [];
  private muzzleFlashes: MuzzleFlash[] = [];
  /** Q11-C：蓄能光点（laser charge 表现；key=partId，upsert 更新 progress） */
  private charges: Array<{ key: string; x: number; y: number; progress: number; lastAt: number }> = [];
  private deathFxs: DeathFx[] = [];
  /** Q11-C-R3-FINAL：镭射巨炮束 VFX 数组（发射后驻留 ~130ms 衰减，纯表现） */
  private laserBeams: LaserBeam[] = [];
  /** Q13-B-R1：霰弹炮口扇形爆闪 VFX 数组（发射后驻留 ~100ms 衰减，纯表现） */
  private shotgunFans: ShotgunFan[] = [];
  /** Q14-A-R1：机枪方向性枪口火舌 VFX 数组（发射后驻留 ~60ms 衰减，纯表现） */
  private muzzleTongues: MuzzleTongue[] = [];
  /** F-WX-RCA-2B：Battle Active [WX-RCA] 一次性输出标志（每场运行时首次 Active reframe 只记一次） */
  private battleRcaLogged = false;

  /** F-PRESENT-1：高频伤害数字聚合器（纯 Presentation；决定「合并 / 新建数字」） */
  private damageAggregator = new DamageNumberAggregator(DAMAGE_AGGREGATE_WINDOW_MS);
  /** F-PRESENT-1：分组键 → 当前组浮动数字引用（组内命中原地更新 text/position，不新建） */
  private damageGroupFx = new Map<string, FloatingText>();
  /** F-HOME-P0-LAYER：首页程序化背景下沉开关（背景层<车辆层<UI层）；仅首页开启 */
  private homeBackdrop = false;
  /** F-GARAGE-CENTER-STAGE-P0：Garage 装配页背景（深蓝车库展示台；与 homeBackdrop 互斥） */
  private garageBackdrop = false;
  /** F-PREBATTLE-VISUAL-R1：战前（Matching/MatchPreview）程序化背景下沉开关——水果竞技场
   *  简化版（背景层<车辆层<UI层）；仅战前开启；与 homeBackdrop 互斥（Battle 两者皆关）。 */
  private prebattleBackdrop = false;
  /** F-BATTLE-PRESENTATION-R2：正式战斗（fighting/ended）竞技场背景开关（背景层<车辆层<UI层）；
   *  与 homeBackdrop / prebattleBackdrop 互斥；优先级 battle > prebattle > home。 */
  private battleBackdrop = false;
  /** F-PREBATTLE-VISUAL-R1：每帧绘制的真实地面线（逻辑 px），供 E2E probe.groundScreenY
   *  在 battle 相机未激活（预览/战前）时可靠取数——根治渲染层取 this.orchestrator 为 null
   *  导致 groundScreenY 恒 null 的缺陷。与 battleCam.groundScreenY 二选一。 */
  private lastGroundScreenYLogical: number | null = null;
  /** F-PREBATTLE-VISUAL-R1：最近一次 reframe 的 arena.groundY（世界坐标）。
   * 供 getProbeCamera 在「非 battle 相机且无绘制上下文（headless 单测）」时推算地面线——
   * 比只依赖 lastGroundScreenYLogical（需 draw）更鲁棒，且不触碰 this.orchestrator（恒 null）。 */
  private previewGroundY: number | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    /** W2-VIS-1：Sprite Visual Registry（缺省空注册表 → 全 Collider 灰盒 fallback，行为与旧版一致） */
    private readonly visualRegistry: VisualRegistry = new VisualRegistry(),
    /** F-WX-1：可选注入的平台视口/时间源；未注入时退回浏览器全局（Web 行为不变） */
    private readonly surface?: CanvasSurface,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D not supported');
    this.ctx = ctx;
  }

  /**
   * F-WX-1：视口/时间源 guarded 读取——注入 surface 优先，否则退回浏览器全局。
   * 使 Renderer 在微信小游戏（无 window / 无 clientWidth / performance 形态不同）
   * 也能运行，且不改变 Web 既有行为（现有渲染测试零回归）。
   */
  private get viewWidth(): number {
    return this.surface ? this.surface.width : this.canvas.clientWidth;
  }
  private get viewHeight(): number {
    return this.surface ? this.surface.height : this.canvas.clientHeight;
  }
  private get viewDpr(): number {
    if (this.surface) return this.surface.devicePixelRatio;
    const w = typeof window !== 'undefined' ? window : undefined;
    return w?.devicePixelRatio ?? 1;
  }
  private now(): number {
    if (this.surface?.now) return this.surface.now();
    if (typeof performance !== 'undefined') return performance.now();
    return Date.now();
  }

  /**
   * F-WX-VIEWPORT-SURFACE-P0｜Must#3：view 域 → 逻辑域换算除数。
   * 契约：view 域即【逻辑绘制域】——Web（无 surface）view = canvas.clientWidth（CSS 逻辑）；
   * 注入 surface 后 surface.width 恒为逻辑窗口尺寸（canvas.backing ÷ dpr，见 WechatViewport）。
   * 故本除数为 1（无换算）；DPR 只在最终 backing 绘制阶段经 setTransform(dpr) 一次应用。
   * 全仓 `surface ? viewDpr : 1` / `÷viewDpr` 的域对齐统一收敛到本 getter（恒 1），
   * 杜绝「fit 按 backing、绘制再 ×dpr」的双重缩放（微信真机全局放大+裁切根因）。
   */
  private get viewToLogical(): number {
    return 1;
  }

  resize(arenaW: number, arenaH: number): void {
    const dpr = this.viewDpr;
    // F-WX-1：注入 surface（微信等无 clientWidth/可写 canvas.width）时，不写回
    // canvas 像素尺寸，直接按 surface 提供的视口计算取景；Web 仍按原逻辑设置 backing store。
    if (!this.surface) {
      this.canvas.width = this.canvas.clientWidth * dpr;
      this.canvas.height = this.canvas.clientHeight * dpr;
    }
    const vw = this.surface ? this.surface.width : this.canvas.width;
    const vh = this.surface ? this.surface.height : this.canvas.height;
    const scale = Math.min(vw / arenaW, vh / arenaH) * VIEW_ZOOM;
    this.transform = {
      scale,
      offsetX: (vw - arenaW * scale) / 2,
      offsetY: (vh - arenaH * scale) / 2,
    };
  }

  /**
   * F-PLAYER-SINGLE-CANVAS-RECOVERY-P0｜把离屏 UI 画布合成到最终屏幕画布。
   *
   * 玩家模式：UI 在 844×390 逻辑离屏绘制，Renderer 场景也在同一 844×390 逻辑舞台绘制，
   * 二者 1:1 映射到本画布 backing（= logical×DPR）。本方法在每帧 renderer.render 之后调用，
   * 将离屏 UI 以 9 参数 drawImage 精确覆盖到本画布——保证 UI 与场景共用同一像素舞台，
   * 从根上消除「双画布坐标错位」整类问题（唯一可见 Canvas 参与最终展示与输入）。
   * 非玩家 / DEV 模式不调用本方法（compositeCanvas 为 null）。
   */
  /**
   * F-WX-IOS-CANVAS-CRASH-P0｜Must#2：可见 Canvas 清屏——显式 identity 变换 + 完整 backing 尺寸。
   * 独立于后续世界绘制所用的 dpr 变换，杜绝「在已有 scale/translate 变换下用 backing 宽高 clearRect」
   * 导致的清屏区域错位 / 残留。调用后 transform 恢复到 clearScreen 之前的状态（save/restore 平衡）。
   */
  private clearScreen(): void {
    const ctx = this.ctx;
    // F-WX-IOS-CANVAS-CRASH-P0｜Must#2：清屏必须显式 identity + 完整 backing 尺寸，
    // 不依赖上一步的 dpr 变换（避免非整数 DPR 下清屏区域错位 / 残留）。
    // 不用 ctx.save/restore：部分测试用 mock 2D ctx 未实现 save/restore；render() 调用前
    // 已 setTransform(dpr,…)，此处清屏后直接将变换恢复为同一 dpr 变换即可（save/restore 的平衡等价物）。
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.viewDpr, 0, 0, this.viewDpr, 0, 0);
  }

  compositeOverlay(src: HTMLCanvasElement): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    // F-WX-IOS-CANVAS-CRASH-P0｜Must#3：明确 source backing rect 与 destination backing rect，
    // drawImage 仅执行一次；不依赖上一步世界相机变换。UI 离屏只作 overlay source。
    ctx.drawImage(
      src as unknown as CanvasImageSource,
      0,
      0,
      src.width,
      src.height,
      0,
      0,
      this.canvas.width,
      this.canvas.height,
    );
    ctx.restore();
  }

  /**
   * F-BATTLE-CAMERA-R2：战斗跟随相机状态（fit==='battle' 构图时激活，其余 fit 置 null）。
   * reframe 记录基准（Active/Warning）；render() 每帧按 A/B 实时 envelope 做
   * 「中点追踪 + 分离有限拉远」（纯 Presentation，不触碰 Physics/结果）。
   */
  private battleCam: {
    baseScale: number; // Active/Warning 构图基准 scale（Closing 相对此钳制 ±10%）
    baseEnvW: number; // A+B envelope 并集宽（含 padding）——分离拉远基准
    minScale: number; // 分离拉远下限（baseScale × BATTLE_SEPARATE_SCALE_MIN）
    // F-BATTLE-STAGE-COMPOSITION-P0：战斗舞台地面线（视口逻辑 px，Active 首帧计算、
    // 后续阶段复用 → 地面线位移 0；取代旧 groundRatio 78~84% 安全区比例）
    groundScreenY: number;
    arenaW: number; // arena 宽（视野 clamp，不露出 arena 外）
    safeBaseX: number; // 安全区左缘（物理 px）
    safeW: number; // 安全区宽（物理 px）
    baseY: number; // 安全区顶（物理 px）
    safeH: number; // 安全区高（物理 px）
  } | null = null;

  private sx(x: number): number {
    return x * this.transform.scale + this.transform.offsetX;
  }
  private sy(y: number): number {
    return y * this.transform.scale + this.transform.offsetY;
  }
  private ss(v: number): number {
    return v * this.transform.scale;
  }

  /** 当前镜头缩放（只读；测试 / 调试断言构图差异用） */
  get transformScale(): number {
    return this.transform.scale;
  }

  /**
   * Q06-UX-R2-FIX：世界坐标轴对齐矩形 → 屏幕坐标轴对齐矩形（只读）。
   * 供测试断言「最终 screen bounds 完整入画」（不依赖 scale 数字猜测）；
   * 不参与绘制、不改变任何 framing 语义。
   */
  worldRectToScreen(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
  ): { minX: number; minY: number; maxX: number; maxY: number } {
    return {
      minX: this.sx(minX),
      minY: this.sy(minY),
      maxX: this.sx(maxX),
      maxY: this.sy(maxY),
    };
  }

  /**
   * F-WX-RCA-1：车辆世界 AABB（只读诊断辅助，不参与绘制、不改变 framing 语义）。
   * includeParts=false → coreBounds（Body + Wheels，玩家感知的车身主体）；
   * includeParts=true  → envelopeBounds（Body + Wheels + Functional Parts，完整战斗外廓）。
   * 口径与 framing 测试 vehicleScreenBounds 一致。
   */
  private vehicleBounds(v: RenderVehicle, includeParts: boolean): { minX: number; minY: number; maxX: number; maxY: number } {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const acc = (x: number, y: number): void => {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    };
    const shape = (s: RenderShape): void => {
      if (s.kind === 'polygons') {
        for (const poly of s.polygons) for (const p of poly.points) acc(p.x, p.y);
      } else {
        acc(s.circle.center.x - s.circle.radius, s.circle.center.y - s.circle.radius);
        acc(s.circle.center.x + s.circle.radius, s.circle.center.y + s.circle.radius);
      }
    };
    shape(v.body);
    for (const w of v.wheels) {
      acc(w.center.x - w.radius, w.center.y - w.radius);
      acc(w.center.x + w.radius, w.center.y + w.radius);
    }
    if (includeParts) {
      for (const p of v.parts) shape(p.shape);
    }
    return { minX, minY, maxX, maxY };
  }

  /** 单辆车双口径屏幕诊断（只读；core=Body+Wheels / envelope=+Parts） */
  private vehicleDiag(v: RenderVehicle, includeParts: boolean): {
    world: { minX: number; minY: number; maxX: number; maxY: number };
    screen: { minX: number; minY: number; maxX: number; maxY: number };
    screenWidthPct: number;
  } {
    const w = this.vehicleBounds(v, includeParts);
    const s = this.worldRectToScreen(w.minX, w.minY, w.maxX, w.maxY);
    return {
      world: w,
      screen: s,
      screenWidthPct: Math.round(((s.maxX - s.minX) / this.viewWidth) * 1000) / 10,
    };
  }

  /**
   * F-WX-RCA-1：当前 transform 下车辆双口径屏幕诊断（只读，vehicleA）。
   * core = Body + Wheels；envelope = + Functional Parts。供 DEV/RCA 日志与测试断言，
   * 不参与绘制、不改变任何 framing 语义。
   */
  scaleDiagnostics(snap: BattleRenderSnapshot): {
    scale: number;
    offsetX: number;
    offsetY: number;
    view: { w: number; h: number; dpr: number };
    core: { world: { minX: number; minY: number; maxX: number; maxY: number }; screen: { minX: number; minY: number; maxX: number; maxY: number }; screenWidthPct: number };
    envelope: { world: { minX: number; minY: number; maxX: number; maxY: number }; screen: { minX: number; minY: number; maxX: number; maxY: number }; screenWidthPct: number };
  } {
    const t = this.transform;
    return {
      scale: t.scale,
      offsetX: t.offsetX,
      offsetY: t.offsetY,
      view: { w: this.viewWidth, h: this.viewHeight, dpr: this.viewDpr },
      core: this.vehicleDiag(snap.vehicleA, false),
      envelope: this.vehicleDiag(snap.vehicleA, true),
    };
  }

  /**
   * F-WX-RCA-2B：当前 transform 下 A/B 双车双口径屏幕诊断（只读）。
   * 供 [WX-RCA] battle 段确认双方 core/envelope 真实占比；不参与绘制、不改变 framing 语义。
   */
  scaleDiagnosticsBoth(snap: BattleRenderSnapshot): {
    scale: number;
    offsetX: number;
    offsetY: number;
    view: { w: number; h: number; dpr: number };
    A: {
      core: { world: { minX: number; minY: number; maxX: number; maxY: number }; screen: { minX: number; minY: number; maxX: number; maxY: number }; screenWidthPct: number };
      envelope: { world: { minX: number; minY: number; maxX: number; maxY: number }; screen: { minX: number; minY: number; maxX: number; maxY: number }; screenWidthPct: number };
    };
    B: {
      core: { world: { minX: number; minY: number; maxX: number; maxY: number }; screen: { minX: number; minY: number; maxX: number; maxY: number }; screenWidthPct: number };
      envelope: { world: { minX: number; minY: number; maxX: number; maxY: number }; screen: { minX: number; minY: number; maxX: number; maxY: number }; screenWidthPct: number };
    };
  } {
    const t = this.transform;
    return {
      scale: t.scale,
      offsetX: t.offsetX,
      offsetY: t.offsetY,
      view: { w: this.viewWidth, h: this.viewHeight, dpr: this.viewDpr },
      A: { core: this.vehicleDiag(snap.vehicleA, false), envelope: this.vehicleDiag(snap.vehicleA, true) },
      B: { core: this.vehicleDiag(snap.vehicleB, false), envelope: this.vehicleDiag(snap.vehicleB, true) },
    };
  }

  /**
   * F-GARAGE-LIVE-ASSEMBLY-P0：当前 transform 下指定侧车辆的【真实装配挂点】屏幕坐标
   * （只读，logical px，与 getVehicleScreenRects 同域规则：Web 无 surface=logical 直接输出；
   * 注入 surface 时 ÷viewDpr 域对齐）。坐标来自引擎 snapshot 的挂点世界坐标（body 位姿 +
   * hardpoint.localPosition），禁止 UI 按图片尺寸重估。供 Garage 在战车上显示挂点
   * （可用/选中/已占用）并作为点击区域（视觉与点击同源）。
   */
  getVehicleHardpointScreenPts(
    snap: BattleRenderSnapshot,
    side: 'a' | 'b',
  ): Array<{ id: string; kind: 'movement' | 'functional'; x: number; y: number; occupied: boolean }> {
    const v = side === 'a' ? snap.vehicleA : snap.vehicleB;
    const hps = v?.hardpoints;
    if (!hps || hps.length === 0) return [];
    const vk = this.viewToLogical;
    return hps.map((hp) => ({
      id: hp.id,
      kind: hp.kind,
      x: this.sx(hp.world.x) / vk,
      y: this.sy(hp.world.y) / vk,
      occupied: hp.occupied,
    }));
  }

  /**
   * F-MATCH-FRAME-R2：当前 transform 下 A/B 双车「可见 envelope」的屏幕矩形（只读，逻辑 px）。
   * 供 UI 层（Matching / MatchPreview）直接读取真实车辆屏幕位置来绘制扫描框 / 对手名称 /
   * 检测文字与车辆 envelope 相交——根治「UI 锚点猜测与 renderer 实际落点脱节」的构图错位。
   * F-CROSSLAYER-RECT-DPR-P0：screen 坐标来自 sx()/sy()（x×transform.scale+offset，域与
   * viewWidth 相同：无 surface 注入（Web）= logical；注入 surface（微信/单测）= backing）。
   * 旧实现无条件 ÷viewDpr → Web 下把逻辑坐标缩小 1/dpr（DPR1.5 时右车逻辑 524→349，
   * 扫描框/名牌偏左 ≈×1/1.5，与用户 1220→815 实测精确吻合）。现仅在 viewWidth=backing
   * （surface 注入）时做域对齐 ÷dpr；Web（logical）直接返回。DPR 仅在最终 backing 绘制阶段使用。
   */
  getVehicleScreenRects(
    snap: BattleRenderSnapshot,
  ): { a: { x: number; y: number; w: number; h: number }; b: { x: number; y: number; w: number; h: number } } | null {
    if (!snap.vehicleA || !snap.vehicleB) return null;
    const d = this.scaleDiagnosticsBoth(snap);
    const vk = this.viewToLogical;
    const toRect = (e: { screen: { minX: number; minY: number; maxX: number; maxY: number } }): {
      x: number;
      y: number;
      w: number;
      h: number;
    } => {
      const x = e.screen.minX / vk;
      const y = e.screen.minY / vk;
      const w = (e.screen.maxX - e.screen.minX) / vk;
      const h = (e.screen.maxY - e.screen.minY) / vk;
      return { x, y, w, h };
    };
    return { a: toRect(d.A.envelope), b: toRect(d.B.envelope) };
  }

  /**
   * W2-FX-1：表现入口统一由 BattlePresentationController 调用，本模块只负责「画」。
   * 以下方法均为纯表现（不决定 Gameplay / 不触发伤害）。
   */

  /**
   * F-DEMO-VISUAL-GATE-R4：E2E 只读几何诊断（不参与任何 Gameplay 规则；仅在 E2E 构建
   * 的探针快照中被读取，正式构建无调用方 → 零开销）。返回相机 transform + 战斗舞台
   * 地面线（逻辑 px）；非 battle 相机 → groundScreenY null。
   */
  getProbeCamera(): { scale: number; offsetX: number; offsetY: number; groundScreenY: number | null } {
    // groundScreenY：battle 相机（groundScreenY 恒定）；preview（Matching/MatchPreview）用
    // 当前 transform + arena.groundY 计算真实地面线（逻辑 px），使 E2E 能验证地面带占比。
    let groundScreenY: number | null = this.battleCam ? this.battleCam.groundScreenY / this.viewToLogical : null;
    // 非 battle 相机（预览 / 战前）：优先用每帧绘制时捕获的真实地面线（逻辑 px）；
    // 否则用最近一次 reframe 的 arena.groundY + 当前 transform 推算（headless 单测 / 未 draw 也可靠）；
    // 不再依赖 this.orchestrator（渲染层仅持有局部 orchestrator 引用，this.orchestrator 恒 null）。
    if (groundScreenY == null) {
      if (this.lastGroundScreenYLogical != null) groundScreenY = this.lastGroundScreenYLogical;
      else if (this.previewGroundY != null) {
        groundScreenY = (this.transform.offsetY + this.previewGroundY * this.transform.scale) / this.viewToLogical;
      }
    }
    return {
      scale: this.transform.scale,
      offsetX: this.transform.offsetX,
      offsetY: this.transform.offsetY,
      groundScreenY,
    };
  }

  /** F-DEMO-VISUAL-GATE-R4：E2E 只读几何诊断——收束墙（hazard）屏幕矩形（逻辑 px）。 */
  getProbeHazardRects(
    snap: BattleRenderSnapshot,
  ): Array<{ x: number; y: number; w: number; h: number }> {
    const out: Array<{ x: number; y: number; w: number; h: number }> = [];
    for (const cw of snap.arena.closingWalls) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      const acc = (x: number, y: number): void => {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      };
      if (cw.kind === 'polygons') {
        for (const poly of cw.polygons) for (const p of poly.points) acc(p.x, p.y);
      } else {
        acc(cw.circle.center.x - cw.circle.radius, cw.circle.center.y - cw.circle.radius);
        acc(cw.circle.center.x + cw.circle.radius, cw.circle.center.y + cw.circle.radius);
      }
      if (!Number.isFinite(minX)) continue;
      out.push({
        x: this.sx(minX) / this.viewToLogical,
        y: this.sy(minY) / this.viewToLogical,
        w: (this.sx(maxX) - this.sx(minX)) / this.viewToLogical,
        h: (this.sy(maxY) - this.sy(minY)) / this.viewToLogical,
      });
    }
    return out;
  }

  /** 伤害数字（基础原语：直接加入一个浮动数字，不参与聚合；供测试与直接调用） */
  spawnDamageNumber(x: number, y: number, text: string, color: string): void {
    this.fx.push({ x, y, text, color, bornAt: this.now(), ttl: DAMAGE_NUMBER_TTL_MS });
  }

  /**
   * F-PRESENT-1：高频伤害数字聚合入口（仅表现层）。
   *
   * 由 BattlePresentationController.onDamageNumber 调用（每个真实 damage event 各一次，
   * 调用次数与 Gameplay 完全无关）。内部按 (target,source,partId|behavior|damageSource)
   * 在固定窗口内合并为单个浮动数字：
   * - 同组命中 → 累计真实伤害 + 跟随最新 contactPoint（原地更新，不新建浮动数字）；
   * - 首击 / 窗口到期 → 立即新建浮动数字（单发 Cannon/Hammer/Laser 零延迟、不吞数字）；
   * - Gameplay / Damage Resolver / HP 完全不变；聚合仅重组「显示」，真实 damage 总量守恒。
   *
   * Q08-C：damage<=0 仍不显示无意义「-0」（Renderer 复用同一数字池）。
   */
  spawnDamageNumberFromEvent(ev: DamageEvent): void {
    const dmg = Math.round(ev.damage);
    if (dmg <= 0) return;
    const now = this.now();
    const view = this.damageAggregator.feed(ev, now);
    // F-BATTLE-PRESENTATION-R2：重要伤害（单次大额）→ 放大 + 高亮金白，从高频小伤害中脱颖而出
    const important = view.important;
    const color = important ? '#fff0b0' : damageFeedbackColors(ev.damageSource).number;
    // F-BATTLE-HIT-READABILITY-R1：同车存活伤害数字（最终绘制数量为准，Must#2）
    const sameTargetAlive = (): FloatingText[] =>
      this.fx.filter((f) => f.target === ev.target && now - f.bornAt < f.ttl).sort((a, b) => a.bornAt - b.bornAt);
    const mk = (slot: number): FloatingText => ({
      x: view.x,
      y: view.y,
      text: `-${view.accumulatedDamage}`,
      color,
      bornAt: now,
      ttl: DAMAGE_NUMBER_TTL_MS,
      size: important ? DAMAGE_NUMBER_IMPORTANT_SIZE : undefined,
      important,
      target: ev.target,
      slot,
    });
    // 复用/刷新一组：更新内容 + 跟随最新 contactPoint + **刷新剩余显示时间**（Must#3）。
    // reuseAccum=true（渲染层复用最旧组）：旧值 + 新组累计（显示只增不减，总量守恒）；
    // 否则（窗口内合并）：显示当前组累计（不重复叠加）。
    const refresh = (fx: FloatingText, reuseAccum = false): void => {
      if (reuseAccum) {
        const prev = Number(fx.text.replace('-', '')) || 0;
        fx.text = `-${prev + view.accumulatedDamage}`;
      } else {
        fx.text = `-${view.accumulatedDamage}`;
      }
      fx.x = view.x;
      fx.y = view.y;
      fx.color = color;
      fx.important = important;
      if (important) fx.size = DAMAGE_NUMBER_IMPORTANT_SIZE;
      fx.bornAt = now;
    };
    if (view.isNewGroup) {
      // 新组：渲染层硬限制同车存活伤害数字 ≤2 组（聚合窗口 210ms ≪ 数字 TTL 900ms，
      // 若只靠聚合器内部限制，最终绘制会叠到 900/210 ≈ 4 组——Must#2 要求以最终绘制数量为准）。
      const alive = sameTargetAlive();
      if (alive.length >= 2) {
        // 已满 2 组：复用同车最旧一组（累加显示，不新建第 3 个数字；重要伤害同样 ≤2 组）
        const oldest = alive[0];
        refresh(oldest, true);
        this.damageGroupFx.set(view.groupKey, oldest);
        return;
      }
      // 0 或 1 组：新建数字，slot 占位（0/1 → 绘制层稳定错层 14px，Must#4）
      const fx = mk(alive.length);
      this.fx.push(fx);
      this.damageGroupFx.set(view.groupKey, fx);
      return;
    }
    // 合并进当前组：累计真实伤害 + 跟随最新 contactPoint（原地更新，不新建数字）
    const fx = this.damageGroupFx.get(view.groupKey);
    if (fx) {
      refresh(fx);
    } else {
      // 防御：聚合器判定为合并但本地无浮动数字引用（理论上不会）→ 退回新建
      const fxNew = mk(sameTargetAlive().length);
      this.fx.push(fxNew);
      this.damageGroupFx.set(view.groupKey, fxNew);
    }
  }

  /** F-PRESENT-1：当前存活的聚合伤害数字（供测试断言合并 / 组数与累计；过期自动过滤） */
  get activeDamageNumbers(): readonly FloatingText[] {
    const now = this.now();
    return this.fx.filter((f) => now - f.bornAt < f.ttl);
  }

  /** 命中闪白：目标车辆形状短暂描边反馈（绘制时取当前 Snapshot）
   *  Q08-C：同一 team 同时最多一个表现状态——新命中刷新（重置 bornAt），
   *  不 push 多层叠加（纯表现层，不影响真实命中次数/伤害）。 */
  spawnHitFlash(team: string): void {
    const now = this.now();
    const existing = this.hitFlashes.find((h) => h.team === team);
    if (existing) {
      existing.bornAt = now;
    } else {
      this.hitFlashes.push({ team, bornAt: now, ttl: 120 });
    }
  }

  /** 命中火花：接触点短暂小圆（W2-FX-2 按 damageSource 区分颜色，缺省黄） */
  spawnSpark(x: number, y: number, color = '#ffd35a'): void {
    this.sparks.push({ x, y, color, bornAt: this.now(), ttl: 220 });
  }

  /** 炮口闪光：开火点短暂亮圆（真实 muzzle worldPosition）。
   *  color/radius 可选——Cannon 用默认橙黄小闪；laser 用白青大闪（Q11-C-R3-FINAL）。 */
  spawnMuzzleFlash(x: number, y: number, color = '#ffe9a8', radius = 6): void {
    this.muzzleFlashes.push({ x, y, bornAt: this.now(), ttl: 90, color, radius });
  }

  /** Q11-C-R3-FINAL：镭射巨炮束——发射瞬间沿真实 fire 方向固定驻留（不跟弹）。
   *  纯表现：真实 Collider / 伤害范围绝不扩大；不参与碰撞/伤害。 */
  spawnLaserBeam(x: number, y: number, dirX: number, dirY: number): void {
    const len = Math.max(1e-6, Math.hypot(dirX, dirY));
    this.laserBeams.push({
      x,
      y,
      dirX: dirX / len,
      dirY: dirY / len,
      length: LASER_BEAM_LENGTH,
      coreWidth: LASER_BEAM_CORE,
      glowWidth: LASER_BEAM_GLOW,
      bornAt: this.now(),
      ttl: LASER_BEAM_TTL,
    });
  }

  /** Q11-C-R3-FINAL：当前存活的镭射巨炮束（供测试断言几何 / 存活）；过期自动过滤。 */
  get activeLaserBeams(): readonly LaserBeam[] {
    const now = this.now();
    return this.laserBeams.filter((b) => now - b.bornAt < b.ttl);
  }

  /** Q13-B-R1：霰弹炮口扇形爆闪——发射瞬间沿真实 fire 方向画一束短促扇形亮闪
   *  （非普通圆形 flash），让单次齐射一眼是「霰弹喷射」。纯表现：真实 Collider /
   *  伤害范围绝不扩大；不参与碰撞/伤害。 */
  spawnShotgunFan(x: number, y: number, dirX: number, dirY: number): void {
    const len = Math.max(1e-6, Math.hypot(dirX, dirY));
    this.shotgunFans.push({
      x,
      y,
      dirX: dirX / len,
      dirY: dirY / len,
      bornAt: this.now(),
      ttl: SHOTGUN_FAN_TTL,
    });
  }

  /** Q13-B-R1：当前存活的霰弹炮口扇形爆闪（供测试断言几何 / 存活）；过期自动过滤。 */
  get activeShotgunFans(): readonly ShotgunFan[] {
    const now = this.now();
    return this.shotgunFans.filter((f) => now - f.bornAt < f.ttl);
  }

  /** Q14-A-R1：机枪方向性枪口火舌——沿真实 fire 方向短促窄火舌（长 15~25px、TTL 50~70ms）。
   *  纯表现：真实 Collider / 伤害范围绝不扩大；不参与碰撞/伤害；不建通用 VFX Foundation。 */
  spawnMuzzleTongue(x: number, y: number, dirX: number, dirY: number): void {
    const len = Math.max(1e-6, Math.hypot(dirX, dirY));
    this.muzzleTongues.push({
      x,
      y,
      dirX: dirX / len,
      dirY: dirY / len,
      bornAt: this.now(),
      ttl: MUZZLE_TONGUE_TTL,
    });
  }

  /** Q14-A-R1：当前存活的机枪枪口火舌（供测试断言几何 / 存活）；过期自动过滤。 */
  get activeMuzzleTongues(): readonly MuzzleTongue[] {
    const now = this.now();
    return this.muzzleTongues.filter((t) => now - t.bornAt < t.ttl);
  }

  /** Q11-C：蓄能光点——laser 蓄能期间每固定步 upsert（同 partId 更新 progress）。
   *  纯表现（肉眼可见「大招要来了」）；不参与伤害/命中判定。 */
  spawnCharge(key: string, x: number, y: number, progress: number): void {
    const existing = this.charges.find((c) => c.key === key);
    if (existing) {
      existing.x = x;
      existing.y = y;
      existing.progress = progress;
      existing.lastAt = this.now();
    } else {
      this.charges.push({ key, x, y, progress, lastAt: this.now() });
    }
  }

  /** Q11-C：蓄能结束（发射）→ 清除该部件光点 */
  clearCharge(key: string): void {
    this.charges = this.charges.filter((c) => c.key !== key);
  }

  /** 死亡 FX：目标车辆位置短暂扩散环（绘制时取当前 Snapshot） */
  spawnDeathFx(team: string): void {
    this.deathFxs.push({ team, bornAt: this.now(), ttl: 500 });
  }

  render(
    orchestrator: BattleOrchestratorApi,
    debugDraw?: (ctx: CanvasRenderingContext2D, t: ScreenTransform) => void,
  ): void {
    const ctx = this.ctx;
    const dpr = this.viewDpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // F-WX-IOS-CANVAS-CRASH-P0｜Must#2：可见 Canvas 清屏必须显式 identity + 完整 backing 尺寸，
    // 不依赖上一步的 dpr 变换（避免非整数 DPR 下清屏区域错位 / 残留）。
    this.clearScreen();

    // 背景
    if (this.homeBackdrop) {
      // F-HOME-P0-LAYER：首页程序化背景作为 underlay（背景层<车辆层<UI层）；
      // 单一入口 drawHomeBackdrop —— 正式背景美术资源后续从此注入。
      this.drawHomeBackdrop(ctx, this.viewWidth, this.viewHeight);
    } else if (this.garageBackdrop) {
      // F-GARAGE-CENTER-STAGE-P0：Garage 装配页轻量装配环境——深蓝车库 + 明确展示地面 +
      // 少量灯光（Must#14）。不新增面板/装饰人物；地面线由下方统一 Ground 语义绘制。
      this.drawGarageBackdrop(ctx, this.viewWidth, this.viewHeight);
    } else if (this.prebattleBackdrop) {
      // F-PREBATTLE-VISUAL-R1：战前程序化背景（水果竞技场简化版 underlay；
      // 单一入口 drawPrebattleSky —— 天空渐变 + 简化对称看台 + 灯点，无 battle 墙）。
      this.drawPrebattleSky(ctx, this.viewWidth, this.viewHeight);
    } else if (this.battleBackdrop) {
      // F-BATTLE-PRESENTATION-R2：正式战斗竞技场（天空+地面平台）由下方 drawBattleArena 绘制；
      // 此处不填充纯黑，避免「纯黑上半屏」（Must#2）。
    } else {
      ctx.fillStyle = '#14181f';
      ctx.fillRect(0, 0, this.viewWidth, this.viewHeight);
    }

    const snap = orchestrator.getRenderSnapshot();
    const arena = snap.arena;
    // F-BATTLE-CAMERA-R2：战斗跟随相机——每帧按 A/B 真实 envelope 追踪双方中点 +
    // 分离有限拉远（纯 Presentation；无 battleCam 时（预览/非战斗）零开销直接返回）。
    this.applyBattleFollow(snap);
    const t = this.transform;
    // W2-FX-2：表现时间基准（阶段闪烁 / 死亡淡出 / FX 共用）
    const now = this.now();

    if (this.battleBackdrop) {
      // F-BATTLE-PRESENTATION-R2：正式竞技场（天空渐变 + 远景看台 + 中景灯光 + 近景实体战斗平台）
      // 替换旧「纯黑上半屏 + 纯蓝下半屏 + 细线」。drawBattleArena 填充 [0,gy] 天空 + [gy,h] 平台。
      const gy = this.sy(arena.groundY);
      this.drawBattleArena(ctx, this.viewWidth, this.viewHeight, gy, t);
      this.lastGroundScreenYLogical = gy / this.viewToLogical;
      // 地平线高光（车底水平线，强调地面边缘；车辆「站」在平台面上）
      ctx.strokeStyle = V.arenaGroundEdge;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(t.offsetX, gy);
      ctx.lineTo(this.ss(arena.width) + t.offsetX, gy);
      ctx.stroke();
      // Walls（normal）
      for (const wall of arena.normalWalls) {
        this.drawShape(wall, '#3a4150');
      }
      // Closing walls（Hazard；W2-FX-2 阶段视觉：Warning 预高亮闪烁、Closing 正式刺墙锯齿）
      const arenaPhase = orchestrator.phase;
      for (const cw of arena.closingWalls) {
        this.drawShape(cw, '#7a2f2f');
        if (arenaPhase === 'Warning') {
          const blink = 0.45 + 0.35 * Math.sin(now * 0.012);
          ctx.globalAlpha = 0.18 + 0.14 * blink;
          this.drawShape(cw, '#c0403a');
          ctx.globalAlpha = blink;
          this.strokeShape(cw, '#e8a33c');
          ctx.globalAlpha = 1;
        } else if (arenaPhase === 'Closing') {
          // 正式进入——墙体填充降为半透明：Closing 墙体仅半透明填充（globalAlpha 0.26），尖刺/轮廓在 alpha 外清晰绘制
          const pulse = 0.7 + 0.2 * Math.sin(now * 0.01);
          ctx.globalAlpha = 0.26;
          this.drawShape(cw, '#c0403a');
          ctx.globalAlpha = 1;
          this.drawSpikes(cw, '#c0403a', now);
          ctx.globalAlpha = pulse;
          this.strokeShape(cw, '#ff8a70');
          ctx.globalAlpha = 1;
        }
      }
    } else if (!this.homeBackdrop && !this.prebattleBackdrop) {
      // Ground（统一竞技场地面语义；legacy fallback，battle 已由 battleBackdrop 覆盖）
      ctx.fillStyle = V.arenaGround;
      ctx.fillRect(
        t.offsetX,
        this.sy(arena.groundY),
        this.ss(arena.width),
        this.canvas.height - this.sy(arena.groundY),
      );
      this.lastGroundScreenYLogical = this.sy(arena.groundY) / this.viewToLogical;
      ctx.strokeStyle = V.arenaGroundEdge;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(t.offsetX, this.sy(arena.groundY));
      ctx.lineTo(this.ss(arena.width) + t.offsetX, this.sy(arena.groundY));
      ctx.stroke();

      // Walls（normal）
      for (const wall of arena.normalWalls) {
        this.drawShape(wall, '#3a4150');
      }

      // Closing walls（Hazard；W2-FX-2 阶段视觉：Warning 预高亮闪烁、Closing 正式刺墙锯齿）
      const arenaPhase = orchestrator.phase;
      for (const cw of arena.closingWalls) {
        this.drawShape(cw, '#7a2f2f');
        if (arenaPhase === 'Warning') {
          const blink = 0.45 + 0.35 * Math.sin(now * 0.012);
          ctx.globalAlpha = 0.18 + 0.14 * blink;
          this.drawShape(cw, '#c0403a');
          ctx.globalAlpha = blink;
          this.strokeShape(cw, '#e8a33c');
          ctx.globalAlpha = 1;
        } else if (arenaPhase === 'Closing') {
          // 正式进入——墙体填充降为半透明：Closing 墙体仅半透明填充（globalAlpha 0.26），尖刺/轮廓在 alpha 外清晰绘制
          const pulse = 0.7 + 0.2 * Math.sin(now * 0.01);
          ctx.globalAlpha = 0.26;
          this.drawShape(cw, '#c0403a');
          ctx.globalAlpha = 1;
          this.drawSpikes(cw, '#c0403a', now);
          ctx.globalAlpha = pulse;
          this.strokeShape(cw, '#ff8a70');
          ctx.globalAlpha = 1;
        }
      }
    } else if (this.prebattleBackdrop) {
      // F-PREBATTLE-VISUAL-R1：战前地面带（与双方车辆同一 groundY；不画 battle 墙）。
      // 中性板岩色（非纯蓝），顶部暖白地平线高光，底部暗收束 —— 地面以下约占 24~30%。
      const gy = this.sy(arena.groundY);
      const grad = ctx.createLinearGradient(0, gy, 0, this.viewHeight);
      grad.addColorStop(0, '#2b3242');
      grad.addColorStop(1, '#171c28');
      ctx.fillStyle = grad;
      ctx.fillRect(0, gy, this.viewWidth, this.viewHeight - gy);
      this.lastGroundScreenYLogical = gy / this.viewToLogical;
      // 地平线高光（车底水平线，弱暖白）
      ctx.fillStyle = 'rgba(190,210,245,0.30)';
      ctx.fillRect(0, gy - 1, this.viewWidth, 2);
    }

    // Q13-C-R3：喷焰主体（glow + 主焰 + 火芯）在车辆之前绘制，车身自然遮住与车体重叠
    // 部分 → 火从车尾后方出来，不覆盖整辆西瓜。flames 缺省 undefined → 空绘制。
    this.drawFlamePlumes(snap.flames ?? []);

    // Vehicles（W2-FX-2 死亡表现：淡出 alpha → 消失后跳过绘制；未死亡正常绘制）
    // 手动管理 globalAlpha（不复用 ctx.save/restore，保持与既有 canvas stub 兼容）
    const aAlpha = vehicleDeathAlpha(this.deathFxs, snap.vehicleA.team, now);
    if (aAlpha !== null) {
      ctx.globalAlpha = aAlpha;
      this.drawVehicle(snap.vehicleA, '#4aa3ff');
      ctx.globalAlpha = 1;
    }
    // Q15-UX-R1：solo-A 预览（Garage「我的车」）只绘制 A；占位 B 不绘制
    if (!snap.soloA) {
      const bAlpha = vehicleDeathAlpha(this.deathFxs, snap.vehicleB.team, now);
      if (bAlpha !== null) {
        const fx = this.previewFxB;
        if (fx) {
          // Q15-UI-R2：候选换车轻量表现——B 以自身 COM 为中心做 alpha(0.35→1)+scale(0.96→1)
          const c = this.shapeCentroid(snap.vehicleB.body);
          const cx = this.sx(c.x), cy = this.sy(c.y);
          ctx.save();
          ctx.translate(cx, cy);
          ctx.scale(fx.scale, fx.scale);
          ctx.translate(-cx, -cy);
          ctx.globalAlpha = bAlpha * fx.alpha;
          this.drawVehicle(snap.vehicleB, '#ff7a4a');
          ctx.restore();
          ctx.globalAlpha = 1;
        } else {
          ctx.globalAlpha = bAlpha;
          this.drawVehicle(snap.vehicleB, '#ff7a4a');
          ctx.globalAlpha = 1;
        }
      }
    }

    // Projectiles（Q02-C3B）：只消费 Snapshot；车辆之后、FX 之前，避免被车体完全遮住。
    // projectiles 缺省 undefined → 空绘制，Matter 画面不变。
    this.drawProjectiles(snap.projectiles ?? []);

    // Q13-C-R3：喷口亮核（前景，车辆之后绘制）：喷口小亮核/小橙光始终可见，强调喷口连接关系。
    this.drawFlameNozzles(snap.flames ?? []);

    // Q13-A-R1：圆锯切割火花（仅 saw 有效 contactTick 接触期间存在，离开接触即空 →
    // 立即消失）；真实接触点 + 接触法线，纯表现。sparks 缺省 undefined → 空绘制。
    this.drawSparks(snap.sparks ?? []);

    // Q11-C-R3-FINAL：镭射巨炮束 VFX（发射后沿 fire 方向驻留 ~130ms 衰减；纯表现）
    this.drawLaserBeams();

    // Q13-B-R1：霰弹炮口扇形爆闪 VFX（发射后沿 fire 方向驻留 ~100ms 衰减；纯表现）
    this.drawShotgunFans();

    // Q14-A-R1：机枪方向性枪口火舌 VFX（发射后沿 fire 方向驻留 ~60ms 衰减；纯表现）
    this.drawMuzzleTongues();

    // Debug overlay
    if (debugDraw) debugDraw(ctx, t);

    // FX（now 已在 render 顶部声明）
    this.fx = this.fx.filter((f) => now - f.bornAt < f.ttl);
    // F-BATTLE-HUD-HAZARD-R1：伤害数字同侧短时聚合/错开——按世界 x 相近分桶，
    // 桶内各组纵向错开（14px·scale 一档），避免数字堆叠遮挡车辆/墙体/HUD。
    // F-BATTLE-HIT-READABILITY-R1：同车伤害数字改按 **slot 槽位**稳定错层（Must#4：
    // 两组数字最小间距 12~16px、不互相覆盖）；非伤害数字仍走 x 桶兜底。
    // F-BATTLE-VISUAL-CLEANUP-R3｜Must#4：双方接触点屏幕空间避让（受伤方数字偏向受伤方一侧；
    // 同车 ≤2 组 + slot 纵向错层保持不变，本偏移只解决「跨方两组落在同一接触点」的完全重合）。
    const lateralByTeam = this.damageLateralOffsets(snap);
    const fxSorted = [...this.fx].sort((a, b) => a.x - b.x);
    const laneByBucket = new Map<number, number>();
    for (const f of fxSorted) {
      const age = (now - f.bornAt) / f.ttl;
      let lane = 0;
      if (f.target !== undefined && f.slot !== undefined) {
        lane = f.slot; // 同车槽位（0/1）→ 稳定纵向错层
      } else {
        const bucket = Math.round(f.x / 90);
        lane = laneByBucket.get(bucket) ?? 0;
        laneByBucket.set(bucket, lane + 1);
      }
      // F-BATTLE-VISUAL-CLEANUP-R3｜Must#4：受伤方一侧横向偏让（非伤害数字 target=undefined
      // → 偏移 0，走原有 x 桶兜底逻辑，行为不变）。
      const lateral = f.target !== undefined ? (lateralByTeam?.get(f.target) ?? 0) : 0;
      const tx = this.sx(f.x) + lateral;
      // F-BATTLE-HIT-READABILITY-R1：稳定纵向错层（Must#4 12~16px）——
      // 上浮封顶（age≤0.25 → 最多 10px）防止旧数字因上浮量追上并抵消 slot 错层
      //（否则持续命中时两组数字会因 age 差恰好重叠到同一 y）。
      // lane 0/1 → 16px 槽位差；上浮后两组最小间距 ≥ 16-10 = 6px（可分辨）。
      const rise = Math.min(age, 0.25) * this.ss(40);
      const ty = Math.max(this.ss(44), this.sy(f.y) + lane * this.ss(16) - rise);
      const fs = f.size ?? Math.max(14, this.ss(22));
      ctx.textAlign = 'center';
      // F-BATTLE-PRESENTATION-R2：重要伤害（单次大额）→ 金白高亮光环（描边）提高层级，
      // 从高频小伤害数字云中脱颖而出（Must#8 重要伤害提高层级）。
      if (f.important) {
        ctx.globalAlpha = (1 - age) * 0.9;
        ctx.lineWidth = Math.max(2, this.ss(2.5));
        ctx.strokeStyle = '#fff3c0';
        ctx.strokeText(f.text, tx, ty);
      }
      ctx.globalAlpha = 1 - age;
      ctx.fillStyle = f.color;
      ctx.font = `bold ${fs}px sans-serif`;
      ctx.fillText(f.text, tx, ty);
      ctx.globalAlpha = 1;
    }
    this.hitFlashes = this.hitFlashes.filter((h) => now - h.bornAt < h.ttl);
    for (const h of this.hitFlashes) {
      // W2-FX-2：已死亡（淡出中/已消失）车辆不叠加受击反馈
      if (vehicleDeathAlpha(this.deathFxs, h.team, now) === null) continue;
      // Q15-UX-R1：solo-A 预览无对手受击反馈
      if (snap.soloA && h.team !== snap.vehicleA.team) continue;
      const age = (now - h.bornAt) / h.ttl;
      const v = h.team === snap.vehicleA.team ? snap.vehicleA : snap.vehicleB;
      // Q08-C：不再整块白色填充（大面积白块会遮掉 sprite 视觉身份）——
      // 改短暂白描边轮廓（body + parts），保留受击可感知且不遮挡
      // 「谁在打谁、车辆是什么」；spark/damage number 仍照常表现。
      ctx.globalAlpha = (1 - age) * 0.85;
      this.strokeShape(v.body, '#ffffff');
      for (const p of v.parts) this.strokeShape(p.shape, '#ffffff');
      ctx.globalAlpha = 1;
    }

    // W2-FX-1/2：命中火花（接触点短暂小圆；hazard 用红色刺伤色）。
    // F-BATTLE-READABILITY-R1：短促爆点——中心亮核 + 十字短射线（区别于调试纯色小圆）
    this.sparks = this.sparks.filter((s) => now - s.bornAt < s.ttl);
    for (const s of this.sparks) {
      const age = (now - s.bornAt) / s.ttl;
      const x = this.sx(s.x);
      const y = this.sy(s.y);
      const r = Math.max(1, this.ss(3 + age * 2));
      ctx.globalAlpha = 1 - age;
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      // 十字短射线（爆点感；长度随 age 收缩，短促不遮车）
      const L = r * 2.4;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = Math.max(1.5, this.ss(1.2));
      ctx.beginPath();
      ctx.moveTo(x - L, y);
      ctx.lineTo(x + L, y);
      ctx.moveTo(x, y - L);
      ctx.lineTo(x, y + L);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // W2-FX-1：炮口闪光（开火点短暂亮圆；laser 用白青大闪）
    this.muzzleFlashes = this.muzzleFlashes.filter((m) => now - m.bornAt < m.ttl);
    for (const m of this.muzzleFlashes) {
      const age = (now - m.bornAt) / m.ttl;
      ctx.globalAlpha = 1 - age;
      ctx.fillStyle = m.color;
      ctx.beginPath();
      ctx.arc(this.sx(m.x), this.sy(m.y), this.ss(m.radius + age * m.radius * 1.6), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Q11-C-R3-FINAL：蓄能光点（laser charge）——0~70% 聚能；70~100% 外圈明显
    // 扩大 + 脉冲频率加速 + 亮度提升（肉眼可见「大招即将爆发」）。
    this.charges = this.charges.filter((c) => now - c.lastAt < 500);
    for (const c of this.charges) {
      const p = Math.max(0, Math.min(1, c.progress));
      const alpha = 0.35 + p * 0.6;
      const r = this.ss(7 + p * 14);
      ctx.globalAlpha = alpha;
      // F-BATTLE-READABILITY-R1：蓄能光点统一暖色（金黄→亮白）——不再用青色圆点
      // （调试感）；激光的身份由「飞行青色能量束」承担（见 drawProjectiles）。
      ctx.fillStyle = p > 0.85 ? '#fff2b8' : '#ffd35a';
      ctx.beginPath();
      ctx.arc(this.sx(c.x), this.sy(c.y), r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      // 末段升级：stage ∈ [0,1]（p>0.7 才启动）；外圈额外扩大 + 脉冲加速
      const stage = p > 0.7 ? (p - 0.7) / 0.3 : 0;
      const pulse = stage > 0 ? 1 + 0.28 * Math.sin(now / (42 - stage * 30)) : 1; // 越近 fire 脉冲越快
      const outerExtra = 5 + stage * 22; // 外圈随末段明显扩大
      ctx.globalAlpha = (alpha * 0.4) * (0.7 + stage * 0.5); // 亮度随末段提升
      ctx.strokeStyle = p > 0.7 ? '#fff2b8' : '#ffd35a';
      ctx.lineWidth = this.ss(2 + stage * 2.5);
      ctx.beginPath();
      ctx.arc(this.sx(c.x), this.sy(c.y), (r + this.ss(outerExtra)) * pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // W2-FX-1：死亡 FX（目标车辆位置扩散环）
    this.deathFxs = this.deathFxs.filter((d) => now - d.bornAt < d.ttl);
    for (const d of this.deathFxs) {
      // Q15-UX-R1：solo-A 预览无对手死亡 FX
      if (snap.soloA && d.team !== snap.vehicleA.team) continue;
      const age = (now - d.bornAt) / d.ttl;
      ctx.globalAlpha = (1 - age) * 0.9;
      ctx.strokeStyle = '#ff6b5e';
      ctx.lineWidth = this.ss(4);
      const v = d.team === snap.vehicleA.team ? snap.vehicleA : snap.vehicleB;
      const center = this.vehicleCenter(v);
      ctx.beginPath();
      ctx.arc(center.x, center.y, this.ss(10 + age * 42), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  /** F-HOME-P0-LAYER：首页程序化背景下沉开关（背景层<车辆层<UI层）；仅首页开启 */
  setHomeBackdrop(on: boolean): void {
    this.homeBackdrop = on;
  }
  /** F-GARAGE-CENTER-STAGE-P0：Garage 装配页背景开关（深蓝车库展示台；与 homeBackdrop 互斥） */
  setGarageBackdrop(on: boolean): void {
    this.garageBackdrop = on;
  }
  /** F-PREBATTLE-VISUAL-R1：战前背景开关（水果竞技场简化版；与 homeBackdrop 互斥） */
  setPrebattleBackdrop(on: boolean): void {
    this.prebattleBackdrop = on;
  }

  /**
   * F-BATTLE-PRESENTATION-R2：战斗（fighting/ended）程序化竞技场背景下沉为 renderer underlay 开关。
   * 与 homeBackdrop / prebattleBackdrop 互斥；优先级 battle > prebattle > home。
   * 仅战斗阶段开启；Matching / MatchPreview / Garage / Home 不受影响（不修改这些页面逻辑）。
   */
  setBattleBackdrop(on: boolean): void {
    this.battleBackdrop = on;
  }

  /**
   * F-HOME-P0-LAYER：首页程序化背景（临时 underlay fallback）——渐变天空 + 光晕 + 远山 + 地面光带。
   * 单一入口：正式背景美术资源（图片）后续从此函数注入，不另开第二入口。
   * 在 renderer 底层绘制（车辆之下），与 UI 顶层控件（车辆之上）构成正确图层顺序。
   */
  private drawHomeBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    // F-HOME-VISUAL-R2：正式首页「水果竞技场」三层背景（程序化，无美术资源依赖）——
    // 远景：深蓝竞技场天空 + 对称看台轮廓（多层阶梯向中心收拢 + 看台灯点）；
    // 中景：两侧聚光灯锥（顶部射向舞台中心，半透明渐变）+ 环境灯柱；
    // 前景：中央车辆展示平台（台面 + 前缘高光 + 台体暗面）。
    // 取代旧「4 纯色带 + 两个巨型圆形光晕 + 远山剪影」（Must#4：禁大面积纯黑/纯蓝 + 巨圆主背景）。
    // 首带保留字面 #0a0d13（homeLayout 测试契约 / V.arenaBgTop 取值一致）：先铺基座，
    // 再叠天空渐变（视觉以渐变为主）。
    ctx.fillStyle = '#0a0d13';
    ctx.fillRect(0, 0, w, h);
    const sky = ctx.createLinearGradient(0, 0, 0, h * 0.78);
    sky.addColorStop(0, '#0a0d13');
    sky.addColorStop(0.45, '#0f1830');
    sky.addColorStop(0.78, '#131f3c');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    ctx.save();

    // ---- 远景：对称看台轮廓（多层阶梯，向中心收拢；中间留舞台开口；非纯色块/非巨圆） ----
    const tiers = 6;
    for (let i = 0; i < tiers; i++) {
      const ty = h * (0.34 + i * 0.055);
      const half = Math.max(w * 0.06, w * (0.48 - 0.062 * i)); // 每层向中心收拢（中间留舞台开口）
      ctx.fillStyle = `rgba(42,64,102,${(0.3 + i * 0.045).toFixed(3)})`;
      ctx.fillRect(w / 2 - half, ty, half * 2, Math.max(2, h * 0.02));
      // 看台灯点（沿每层阶梯的小亮点：竞技场氛围，非主视觉）
      ctx.fillStyle = 'rgba(150,195,255,0.4)';
      const lamps = Math.max(5, Math.floor((half * 2) / (w * 0.09)));
      for (let k = 0; k < lamps; k++) {
        const lx = w / 2 - half + 10 + k * ((half * 2 - 20) / Math.max(1, lamps - 1));
        ctx.fillRect(lx, ty - 1, 2, 2);
      }
    }
    // 穹顶微光（弱于聚光；小半径渐变，不构成「巨圆主背景」）
    const dome = ctx.createRadialGradient(w / 2, h * 0.1, w * 0.08, w / 2, h * 0.1, w * 0.42);
    dome.addColorStop(0, 'rgba(110,160,240,0.10)');
    dome.addColorStop(1, 'rgba(110,160,240,0)');
    ctx.fillStyle = dome;
    ctx.fillRect(0, 0, w, h * 0.5);

    // ---- 中景：两侧聚光灯锥（顶部射向舞台中心；半透明渐变，不遮车辆主体） ----
    for (const side of [-1, 1] as const) {
      const sx = w / 2 + side * w * 0.2;
      const cone = ctx.createLinearGradient(0, 0, 0, h);
      cone.addColorStop(0, 'rgba(150,190,255,0.16)');
      cone.addColorStop(0.55, 'rgba(150,190,255,0.045)');
      cone.addColorStop(1, 'rgba(150,190,255,0)');
      ctx.fillStyle = cone;
      ctx.beginPath();
      ctx.moveTo(sx, -4);
      ctx.lineTo(sx - side * w * 0.11, h * 0.9);
      ctx.lineTo(sx + side * w * 0.11, h * 0.9);
      ctx.closePath();
      ctx.fill();
      // 灯头（聚光光源点）
      ctx.fillStyle = 'rgba(190,220,255,0.5)';
      ctx.fillRect(sx - 3, 0, 6, 4);
    }
    // 中景：两侧环境灯柱（细柱 + 顶部灯头，低对比）
    for (const side of [-1, 1] as const) {
      const px = w / 2 + side * w * 0.47;
      ctx.fillStyle = 'rgba(30,46,74,0.7)';
      ctx.fillRect(px - 1.5, h * 0.3, 3, h * 0.5);
      ctx.fillStyle = 'rgba(150,190,255,0.28)';
      ctx.fillRect(px - 3, h * 0.3 - 3, 6, 3);
    }

    // ---- 前景：中央车辆展示平台（台面 + 前缘高光 + 台体暗面；车辆「站」在台面上） ----
    const py = h * 0.8;
    const pw = w * 0.84;
    ctx.fillStyle = 'rgba(15,23,40,0.94)';
    ctx.fillRect(w / 2 - pw / 2, py, pw, h - py);
    // 台面前缘高光（车底水平线）
    ctx.fillStyle = 'rgba(120,170,255,0.32)';
    ctx.fillRect(w / 2 - pw / 2, py, pw, 2);
    // 台面中央柔光（车后光带，弱）
    const stageGlow = ctx.createLinearGradient(0, py - 40, 0, py);
    stageGlow.addColorStop(0, 'rgba(120,170,255,0.10)');
    stageGlow.addColorStop(1, 'rgba(120,170,255,0)');
    ctx.fillStyle = stageGlow;
    ctx.fillRect(w * 0.2, py - 40, w * 0.6, 40);
    // 台体底部暗带（收束）
    ctx.fillStyle = 'rgba(6,10,18,0.6)';
    ctx.fillRect(w / 2 - pw / 2, h - 6, pw, 6);

    ctx.restore();
  }

  /**
   * F-GARAGE-CENTER-STAGE-P0：Garage 装配页轻量装配环境（Must#14）——深蓝车库/展示台背景：
   * 深蓝渐变天空 + 顶部一排灯光（少量、弱）+ 展示台氛围微光；不新增面板、装饰人物与无关信息。
   * 地面带（arenaGround）由 draw() 的统一 Ground 语义绘制（对齐车辆 groundY），此处不重复画。
   */
  private drawGarageBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.fillStyle = '#0a0e16';
    ctx.fillRect(0, 0, w, h);
    const sky = ctx.createLinearGradient(0, 0, 0, h * 0.82);
    sky.addColorStop(0, '#0b1020');
    sky.addColorStop(0.5, '#0e1a33');
    sky.addColorStop(0.82, '#12203c');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    // 顶部少量灯光（小亮点，非大光柱；装配环境氛围）
    ctx.fillStyle = 'rgba(150,190,255,0.5)';
    const lampN = Math.max(4, Math.floor(w / 110));
    for (let k = 0; k < lampN; k++) {
      const lx = w / 2 - ((lampN - 1) * w * 0.1) / 2 + k * w * 0.1;
      ctx.fillRect(lx, 8, 2, 2);
    }
    // 展示台后部氛围微光（车辆背后，弱；不构成巨圆主背景）
    const glow = ctx.createRadialGradient(w / 2, h * 0.55, w * 0.05, w / 2, h * 0.55, w * 0.45);
    glow.addColorStop(0, 'rgba(110,160,240,0.08)');
    glow.addColorStop(1, 'rgba(110,160,240,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h * 0.8);
  }

  /**
   * F-PREBATTLE-VISUAL-R1：战前「水果竞技场」简化天空（程序化 underlay，单一入口）。
   * 沿用首页视觉语言（对称看台 + 灯点 + 穹顶微光），但降低复杂度：看台层数更少、
   * 不画聚光锥（避免与中央 VS / 扫描动效争夺注意力）；保证双方车辆是主体。
   * 天空为渐变而非纯色，消除「大面积纯黑」的调试预览感。地面带由 draw() 的
   * prebattle 分支单独绘制（对齐车辆 groundY）。
   */
  private drawPrebattleSky(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    // 基座 + 天空渐变（视觉以渐变为主，非纯色块）
    ctx.fillStyle = '#0a0d13';
    ctx.fillRect(0, 0, w, h);
    const sky = ctx.createLinearGradient(0, 0, 0, h * 0.82);
    sky.addColorStop(0, '#0a0d13');
    sky.addColorStop(0.5, '#0f1830');
    sky.addColorStop(0.82, '#16243c');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    // 简化对称看台（4 层，向中心收拢；中间留舞台开口；非纯色块）
    const tiers = 4;
    for (let i = 0; i < tiers; i++) {
      const ty = h * (0.30 + i * 0.05);
      const half = Math.max(w * 0.06, w * (0.47 - 0.085 * i));
      ctx.fillStyle = `rgba(42,64,102,${(0.26 + i * 0.04).toFixed(3)})`;
      ctx.fillRect(w / 2 - half, ty, half * 2, Math.max(2, h * 0.018));
      ctx.fillStyle = 'rgba(150,195,255,0.34)';
      const lamps = Math.max(5, Math.floor((half * 2) / (w * 0.11)));
      for (let k = 0; k < lamps; k++) {
        const lx = w / 2 - half + 10 + k * ((half * 2 - 20) / Math.max(1, lamps - 1));
        ctx.fillRect(lx, ty - 1, 2, 2);
      }
    }
    // 穹顶微光（弱，不构成巨圆主背景）
    const dome = ctx.createRadialGradient(w / 2, h * 0.08, w * 0.06, w / 2, h * 0.08, w * 0.4);
    dome.addColorStop(0, 'rgba(110,160,240,0.09)');
    dome.addColorStop(1, 'rgba(110,160,240,0)');
    ctx.fillStyle = dome;
    ctx.fillRect(0, 0, w, h * 0.5);
    ctx.restore();
  }

  /**
   * F-BATTLE-PRESENTATION-R2：正式战斗竞技场背景（程序化 underlay，单一入口）。
   * 远景：深蓝竞技场天空渐变 + 对称多层看台（向中心收拢）+ 看台灯点 + 穹顶微光；
   * 中景：顶部两侧聚光灯锥（射向场地中心）+ 两侧边缘光柱（结构感）；
   * 近景：实体战斗平台（台面 arenaGround + 顶部边缘高光 + 台后柔光 halo + 底部暗收束）。
   * 取代旧「纯黑上半屏 + 纯蓝下半屏 + 细线」（Must#2：屏幕主体不得由纯黑+纯蓝构成）。
   * 车辆是主体：天空/看台占上部，平台占下部，中央留给双方车辆；不画遮挡车辆的大墙。
   */
  private drawBattleArena(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    groundY: number,
    _t: ScreenTransform,
  ): void {
    const gy = groundY;

    // ---- 远景底色：天空渐变（非纯色块），从顶过渡到底地平线辉光 ----
    ctx.fillStyle = V.arenaBgTop;
    ctx.fillRect(0, 0, w, gy);
    const sky = ctx.createLinearGradient(0, 0, 0, gy);
    sky.addColorStop(0, V.arenaBgTop);
    sky.addColorStop(0.4, V.arenaBgMid);
    sky.addColorStop(0.7, V.arenaBgLow);
    sky.addColorStop(1, V.arenaBgHorizon);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, gy);
    ctx.save();

    // 穹顶微光（弱，不构成巨圆主背景）
    const dome = ctx.createRadialGradient(w / 2, gy * 0.05, w * 0.06, w / 2, gy * 0.05, w * 0.5);
    dome.addColorStop(0, 'rgba(120,165,240,0.10)');
    dome.addColorStop(1, 'rgba(120,165,240,0)');
    ctx.fillStyle = dome;
    ctx.fillRect(0, 0, w, gy * 0.6);

    // 远景：对称看台轮廓（多层阶梯，向中心收拢；中间留舞台开口；非纯色块）
    const tiers = 7;
    for (let i = 0; i < tiers; i++) {
      const ty = gy * (0.18 + i * 0.075);
      const half = Math.max(w * 0.05, w * (0.49 - 0.072 * i));
      ctx.fillStyle = `rgba(40,64,108,${(0.24 + i * 0.04).toFixed(3)})`;
      ctx.fillRect(w / 2 - half, ty, half * 2, Math.max(2, gy * 0.02));
      // 看台灯点（竞技场氛围，非主视觉）
      ctx.fillStyle = 'rgba(150,195,255,0.42)';
      const lamps = Math.max(6, Math.floor((half * 2) / (w * 0.085)));
      for (let k = 0; k < lamps; k++) {
        const lx = w / 2 - half + 10 + k * ((half * 2 - 20) / Math.max(1, lamps - 1));
        ctx.fillRect(lx, ty - 1, 2, 2);
      }
    }

    // 中景：两侧聚光灯锥（顶部射向场地中心；半透明渐变，不遮车辆主体）
    for (const side of [-1, 1] as const) {
      const sx = w / 2 + side * w * 0.22;
      const cone = ctx.createLinearGradient(0, 0, 0, gy);
      cone.addColorStop(0, 'rgba(150,190,255,0.15)');
      cone.addColorStop(0.6, 'rgba(150,190,255,0.04)');
      cone.addColorStop(1, 'rgba(150,190,255,0)');
      ctx.fillStyle = cone;
      ctx.beginPath();
      ctx.moveTo(sx, -4);
      ctx.lineTo(sx - side * w * 0.12, gy);
      ctx.lineTo(sx + side * w * 0.12, gy);
      ctx.closePath();
      ctx.fill();
      // 灯头（聚光光源点）
      ctx.fillStyle = 'rgba(190,220,255,0.5)';
      ctx.fillRect(sx - 3, 0, 6, 4);
    }
    // 中景：两侧边缘光柱（细柱 + 顶部灯头，结构感，低对比）
    for (const side of [-1, 1] as const) {
      const px = w / 2 + side * w * 0.49;
      ctx.fillStyle = 'rgba(28,44,72,0.7)';
      ctx.fillRect(px - 1.5, gy * 0.28, 3, gy * 0.55);
      ctx.fillStyle = 'rgba(150,190,255,0.26)';
      ctx.fillRect(px - 3, gy * 0.28 - 3, 6, 3);
    }
    ctx.restore();

    // ---- 近景：实体战斗平台（台面 + 顶部边缘高光 + 台后柔光 + 底部暗收束） ----
    // 台后柔光 halo（车后光带，让车辆从背景中浮出；弱，不抢主体）
    const backGlow = ctx.createLinearGradient(0, gy - 46, 0, gy + 6);
    backGlow.addColorStop(0, 'rgba(120,170,255,0)');
    backGlow.addColorStop(0.7, 'rgba(120,170,255,0.12)');
    backGlow.addColorStop(1, 'rgba(120,170,255,0)');
    ctx.fillStyle = backGlow;
    ctx.fillRect(w * 0.12, gy - 46, w * 0.76, 52);

    // 台面（arenaGround，带轻微纵向渐变：地平线附近更亮 → 底部更暗）
    const plat = ctx.createLinearGradient(0, gy, 0, h);
    plat.addColorStop(0, V.arenaGround);
    plat.addColorStop(0.5, '#1f2c40');
    plat.addColorStop(1, '#141d2c');
    ctx.fillStyle = plat;
    ctx.fillRect(0, gy, w, h - gy);

    // 台面前缘柔光带（车底水平线下方补一条过渡光，弱）
    const edgeGlow = ctx.createLinearGradient(0, gy, 0, gy + 8);
    edgeGlow.addColorStop(0, 'rgba(120,170,255,0.20)');
    edgeGlow.addColorStop(1, 'rgba(120,170,255,0)');
    ctx.fillStyle = edgeGlow;
    ctx.fillRect(0, gy, w, 8);

    // 台体底部暗带（收束）
    ctx.fillStyle = 'rgba(6,10,18,0.55)';
    ctx.fillRect(0, h - 6, w, 6);

    // 近景：两侧台肩结构（强化「实体平台」边界，极窄不遮挡车辆主体）
    const shoulder = Math.min(6, w * 0.02);
    ctx.fillStyle = 'rgba(20,30,48,0.9)';
    ctx.fillRect(0, gy, shoulder, h - gy);
    ctx.fillRect(w - shoulder, gy, shoulder, h - gy);
  }

  /** 车辆世界包围盒中心（供死亡 FX 定位；snapshot 为引擎中立形状） */
  private vehicleCenter(v: RenderVehicle): { x: number; y: number } {
    if (v.body.kind === 'circle') {
      return { x: this.sx(v.body.circle.center.x), y: this.sy(v.body.circle.center.y) };
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of v.body.polygons) {
      for (const pt of p.points) {
        minX = Math.min(minX, pt.x);
        minY = Math.min(minY, pt.y);
        maxX = Math.max(maxX, pt.x);
        maxY = Math.max(maxY, pt.y);
      }
    }
    if (!Number.isFinite(minX)) return { x: 0, y: 0 };
    return {
      x: this.sx((minX + maxX) / 2),
      y: this.sy((minY + maxY) / 2),
    };
  }

  /**
   * F-BATTLE-VISUAL-CLEANUP-R3｜Must#4：伤害数字「双方接触点屏幕空间避让」偏移表。
   *
   * 返回 team → 屏幕横向偏移（px）：受伤方（DamageEvent.target）的数字朝**受伤方所在一侧**
   * 推开，我方数字偏我方、对手数字偏对手。方向来自两车真实包围盒中心 x 之差（不写死左右，
   * 双方换边后自动跟随）；两车中心 x 完全重合时按「A 偏左 / B 偏右」稳定兜底（不抖动）。
   *
   * 纯表现：不改 contactPoint、不改 accumulatedDamage、不改同车 ≤2 组与 slot 纵向错层，
   * 因此显示总伤害守恒（只挪像素位置，不动文本）。
   * 单车（solo 预览 / 缺 vehicleB）无「双方同点」问题 → 返回 null（零偏移、零开销）。
   */
  private damageLateralOffsets(snap: BattleRenderSnapshot): Map<string, number> | null {
    const a = snap.vehicleA;
    const b = snap.vehicleB;
    if (!a || !b || snap.soloA) return null;
    // 屏幕域 px（vehicleCenter 已应用 sx；scale>0 故与世界域同号）
    const ca = this.vehicleCenter(a).x;
    const cb = this.vehicleCenter(b).x;
    const mag = Math.max(
      DAMAGE_LATERAL_MIN_SCREEN,
      Math.min(DAMAGE_LATERAL_MAX_SCREEN, this.ss(DAMAGE_LATERAL_WORLD)),
    );
    const dirA = ca > cb ? 1 : -1; // A 在右 → A 的数字右偏；否则左偏
    return new Map<string, number>([
      [a.team, dirA * mag],
      [b.team, -dirA * mag],
    ]);
  }

  private drawVehicle(v: RenderVehicle, color: string): void {
    // 车身（W2-VIS-1）：有 visual 且资源就绪 → sprite（跟随 chassis 世界 transform）；
    // 否则 Collider graybox fallback（缺资源不白屏/不报错）。
    if (v.bodyVisual && this.drawVisual(v.bodyVisual)) {
      // sprite 已绘制
    } else {
      this.drawShape(v.body, color);
    }
    // 车轮：wheelVisuals 与 wheels 一一对应（movement 层）
    const wheelVisuals = v.wheelVisuals ?? [];
    for (let i = 0; i < v.wheels.length; i++) {
      const w = v.wheels[i]!;
      const wv = wheelVisuals[i];
      if (wv && this.drawVisual(wv)) {
        // sprite（跟随 wheel 真实 center/angle）
      } else {
        this.drawWheel(w, '#888c96');
      }
    }
    // 功能部件：组内按 visual.layer 升序（稳定排序，同 layer 保持 snapshot 顺序）；
    // 有 visual 且资源就绪 → sprite（如 Hammer 跟随真实 Revolute part transform），
    // 否则 Collider graybox。
    const parts = [...v.parts].sort(
      (a, b) => (a.visual?.layer ?? 0) - (b.visual?.layer ?? 0),
    );
    for (const p of parts) {
      if (p.visual && this.drawVisual(p.visual)) {
        // sprite
      } else if (p.shape.kind === 'circle' && p.behavior === 'saw') {
        // Q13-A：圆锯专属视觉——锯齿随真实 part angle 旋转（一眼可见高速旋转），
        // 不依赖 sprite；无 visual 时优先于通用灰盒。
        this.drawSaw(p.shape.circle, p.category === 'weapon' ? '#d8d2c0' : '#9aa4b5');
      } else {
        this.drawShape(p.shape, p.category === 'weapon' ? '#d8d2c0' : '#9aa4b5');
      }
      // Q04-R1B：真实 Joint 连接件（Push Rod 伸缩轴）——画在移动 collider 后方，
      // 连接车身锚点 from → 部件原点 to；仅消费 snapshot 真实世界坐标，无假动画。
      if (p.connector) this.drawConnector(p.connector, '#9aa4b5');
    }
  }

  /**
   * Q13-A：圆锯视觉——真实圆形锯片（锯齿 + 圆盘 + 中心轮毂 + 径向标记线），
   * 完全跟随 snapshot 的真实物理角度（RenderCircle.angle = 真实 part angle）旋转；
   * 不新增 gameplay 状态、不伪造旋转。一圈 16 齿，齿尖半径略大于盘体，
   * 半径标记线让高速旋转在正常速度下明显可辨。
   */
  private drawSaw(circle: RenderCircle, color: string): void {
    const ctx = this.ctx;
    const cx = this.sx(circle.center.x);
    const cy = this.sy(circle.center.y);
    const r = this.ss(circle.radius);
    const a = circle.angle;
    const teeth = 16;
    const rInner = r * 0.86;
    const rOuter = r * 1.12;
    // 锯齿（三角齿，随 a 旋转）
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.92;
    ctx.beginPath();
    for (let i = 0; i < teeth; i++) {
      const t0 = a + (i / teeth) * Math.PI * 2;
      const t1 = a + ((i + 0.5) / teeth) * Math.PI * 2;
      const t2 = a + ((i + 1) / teeth) * Math.PI * 2;
      if (i === 0) {
        ctx.moveTo(cx + Math.cos(t0) * rInner, cy + Math.sin(t0) * rInner);
      } else {
        ctx.lineTo(cx + Math.cos(t0) * rInner, cy + Math.sin(t0) * rInner);
      }
      ctx.lineTo(cx + Math.cos(t1) * rOuter, cy + Math.sin(t1) * rOuter);
      ctx.lineTo(cx + Math.cos(t2) * rInner, cy + Math.sin(t2) * rInner);
    }
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    // 盘体描边（F-BATTLE-VISUAL-CLEANUP-R3｜Must#3：表现轮廓，非近黑硬线框）
    this.applyPartOutline(color);
    ctx.beginPath();
    ctx.arc(cx, cy, rInner, 0, Math.PI * 2);
    ctx.stroke();
    this.resetPartOutline();
    // Q13-A-R1：3 个非对称辐条/开槽（120° 间隔深色窄楔形，随真实 a 旋转；与高对比
    // 标记组合打破纯对称，使旋转肉眼可辨）
    ctx.fillStyle = 'rgba(18,20,26,0.55)';
    for (let k = 0; k < 3; k++) {
      const sa = a + (k * 2 * Math.PI) / 3;
      const inner = r * 0.24;
      const outer = r * 0.82;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(sa) * inner, cy + Math.sin(sa) * inner);
      ctx.lineTo(cx + Math.cos(sa - 0.2) * outer, cy + Math.sin(sa - 0.2) * outer);
      ctx.lineTo(cx + Math.cos(sa + 0.2) * outer, cy + Math.sin(sa + 0.2) * outer);
      ctx.closePath();
      ctx.fill();
    }
    // 中心轮毂
    ctx.fillStyle = '#3a4150';
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
    this.applyPartOutline('#3a4150');
    ctx.stroke();
    this.resetPartOutline();
    // Q13-A-R1：1 个高对比旋转标记（醒目红橙粗线，从圆心到齿尖，随真实 a 旋转；
    // 单条 1-fold 标记打破 3 辐条/16 齿的对称，旋转方向一眼可辨）
    ctx.strokeStyle = '#ff5a3c';
    ctx.lineWidth = Math.max(2, r * 0.1);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * rOuter, cy + Math.sin(a) * rOuter);
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  /**
   * W2-VIS-1：Sprite 绘制（引擎中立 RenderVisual → 图片）。
   * - 以 position 为中心（anchor 已烘焙进 position）；size 为世界 px（镜头缩放）；
   * - 变换 = translate(position) · scale(-1,1)[mirror] · rotate(rotation)——
   *   先旋转再水平镜像，facing=-1 的镜像图随世界姿态正确旋转；
   * - 资源缺失/未加载 → 返回 false（调用方回退 Collider graybox）。
   */
  private drawVisual(v: RenderVisual): boolean {
    const img = this.visualRegistry.getImage(v.visualId);
    if (!img || img.width <= 0 || img.height <= 0) return false;
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(this.sx(v.position.x), this.sy(v.position.y));
    if (v.mirror) ctx.scale(-1, 1); // facing=-1 水平镜像（图片本身左右翻转）
    ctx.rotate(v.rotation);
    const w = this.ss(v.size.width);
    const h = this.ss(v.size.height);
    // VisualImageLike 是最小结构接口；运行时为可绘制源（HTMLImageElement 等）→ 窄断言
    ctx.drawImage(img as unknown as CanvasImageSource, -w / 2, -h / 2, w, h);
    ctx.restore();
    return true;
  }

  /**
   * 真实 Joint 连接轴绘制（Q04-R1B）：from→to 的窄矩形（width 为垂直宽度）。
   * - from/to 完全来自 Snapshot 真实世界坐标；长度 = |to − from|（Push Rod 越伸出
   *   越长，Retract 自然缩短）；from≈to 时长度为 0，跳过（无异常长连接）；
   * - 复用 drawShape 的多边形渲染（fill+stroke），风格与部件一致，无拖尾/发光。
   */
  private drawConnector(c: RenderConnector, color: string): void {
    const dx = c.to.x - c.from.x;
    const dy = c.to.y - c.from.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.01) return; // from≈to（translation≈0）：不画退化轴
    const ux = dx / len;
    const uy = dy / len;
    const vx = -uy;
    const vy = ux;
    const hw = c.width / 2;
    const points = [
      { x: c.from.x + vx * hw, y: c.from.y + vy * hw },
      { x: c.from.x - vx * hw, y: c.from.y - vy * hw },
      { x: c.to.x - vx * hw, y: c.to.y - vy * hw },
      { x: c.to.x + vx * hw, y: c.to.y + vy * hw },
    ];
    this.drawShape({ kind: 'polygons', polygons: [{ points }] }, color);
  }

  /**
   * Projectile 绘制（Q02-C3B）：按真实 center/radius 画 circle，A/B 用可区分颜色。
   * 只消费 BattleRenderSnapshot.projectiles（引擎中立），不读任何引擎/BodyHandle。
   * Q11-C-R2：镭射弹改画沿真实飞行方向的长条高速能量束（视觉放大，碰撞半径不变）。
   */
  private drawProjectiles(projectiles: readonly RenderProjectile[]): void {
    const ctx = this.ctx;
    // Q14-B-R2-FINAL：火焰颗粒先收集，循环后统一构建一整股连续 Fire Jet（不逐颗画大叶）
    const flames: RenderProjectile[] = [];
    for (const p of projectiles) {
      if (p.visual === 'laser') {
        // Q11-C-R3-FINAL：镭射弹（真实伤害载体）只画一个小亮头 + 微 glow，
        // 「巨大激光炮」的视觉由发射后驻留的 laserBeam VFX 承担（不跟随高速弹、
        // 不假长束）。真实 Collider 半径 p.radius 未扩大；hit/miss/CCD 不变。
        // F-BATTLE-READABILITY-R1：加沿真实飞行方向的短青色能量拖尾——不再是孤立
        // 青色圆点（与碰撞爆点 / 普通炮弹明显区分，一眼可辨「这是激光在飞」）。
        const cx = this.sx(p.center.x);
        const cy = this.sy(p.center.y);
        const v = p.velocity ?? { x: 1, y: 0 };
        const vl = Math.max(1e-6, Math.hypot(v.x, v.y));
        const ux = v.x / vl;
        const uy = v.y / vl;
        const TRAIL = this.ss(26);
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = '#7fd8ff';
        ctx.lineWidth = Math.max(2, this.ss(p.radius));
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx - ux * TRAIL, cy - uy * TRAIL);
        ctx.lineTo(cx, cy);
        ctx.stroke();
        ctx.lineCap = 'butt';
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#7fd8ff';
        ctx.beginPath();
        ctx.arc(cx, cy, this.ss(p.radius + 6), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#eafdff';
        ctx.beginPath();
        ctx.arc(cx, cy, this.ss(p.radius), 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      if (p.visual === 'tracer') {
        // Q13-B-R1：霰弹炮弹（真实伤害载体）画成沿真实飞行方向的短高速弹迹（拖尾在
        // 弹头后方，不扩大真实命中范围）；正常速度下一齐射 5 条轨迹清楚扇形分开。
        const cx = this.sx(p.center.x);
        const cy = this.sy(p.center.y);
        const v = p.velocity ?? { x: 1, y: 0 };
        const len = Math.max(1e-6, Math.hypot(v.x, v.y));
        const ux = v.x / len;
        const uy = v.y / len;
        const TRACER = this.ss(42); // 沿真实飞行方向的短高速弹迹（世界 px，35~50）
        const tx = cx - ux * TRACER;
        const ty = cy - uy * TRACER;
        const col = p.team === 'A' ? PROJECTILE_COLOR_A : PROJECTILE_COLOR_B;
        // 弹迹（亮条，尾→头）
        ctx.globalAlpha = 0.85;
        ctx.strokeStyle = col;
        ctx.lineWidth = Math.max(2, this.ss(p.radius * 1.4));
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(cx, cy);
        ctx.stroke();
        ctx.lineCap = 'butt';
        // 弹头（真实 Collider 半径，不扩大命中范围）
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#fff6d8';
        ctx.beginPath();
        ctx.arc(cx, cy, this.ss(p.radius), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(cx, cy, this.ss(p.radius * 0.6), 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      if (p.visual === 'machineGunTracer') {
        // Q14-A-R2-FINAL：机枪弹——细、亮、暖白高速短弹迹（独立于霰弹 tracer 的身份）。
        // 长度降到 ~22px（相邻约 72px 间隔 → 保留明显黑间隔，不再首尾接成连续光束）。
        // 弹头亮核视觉半径 ~2px（去掉原「按完整 Collider 半径画白球」的珍珠链感）；
        // 真实 Collider 半径未变。
        const cx = this.sx(p.center.x);
        const cy = this.sy(p.center.y);
        const v = p.velocity ?? { x: 1, y: 0 };
        const len = Math.max(1e-6, Math.hypot(v.x, v.y));
        const ux = v.x / len;
        const uy = v.y / len;
        const CHAIN = this.ss(MACHINE_GUN_TRACER_WORLD_LENGTH);
        const tx = cx - ux * CHAIN;
        const ty = cy - uy * CHAIN;
        const col = p.team === 'A' ? PROJECTILE_COLOR_A : PROJECTILE_COLOR_B;
        // 淡 team 色外沿（很淡，弹链身份提示）
        ctx.globalAlpha = 0.18;
        ctx.strokeStyle = col;
        ctx.lineWidth = Math.max(2.5, this.ss(4));
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(cx, cy);
        ctx.stroke();
        // 细亮暖白主体（核心 2~3px）
        ctx.globalAlpha = 0.95;
        ctx.strokeStyle = '#fff2c8';
        ctx.lineWidth = Math.max(1.5, this.ss(2.5));
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(cx, cy);
        ctx.stroke();
        ctx.lineCap = 'butt';
        // 弹头亮核（视觉半径 ~2px；真实 Collider 半径未变、不扩大命中范围）
        ctx.fillStyle = '#fff6d8';
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(1.5, this.ss(2)), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        continue;
      }
      if (p.visual === 'flame') {
        // Q14-B-R2-FINAL：喷火器火焰颗粒不再单独绘制大叶 / 大亮圆头（否则真人录像会数出
        // 「三排橙色飞镖」）。改为收集后统一由「同武器存活火焰 projectile 群」构建一整股
        // 连续 Fire Jet（见下方 drawFlameJet）。真实 projectile 的位置/生命周期/碰撞/伤害不变。
        flames.push(p);
        continue;
      }
      const pColor = p.team === 'A' ? PROJECTILE_COLOR_A : PROJECTILE_COLOR_B;
      ctx.fillStyle = pColor;
      ctx.beginPath();
      ctx.arc(this.sx(p.center.x), this.sy(p.center.y), this.ss(p.radius), 0, Math.PI * 2);
      ctx.fill();
      // F-BATTLE-VISUAL-CLEANUP-R3｜Must#3：弹体沿用同一表现轮廓语言（不再近黑硬圈，
      // 否则 2~3px 弹体在真机上读作「调试小圆点」）。真实 Collider 半径不变。
      this.applyPartOutline(pColor);
      ctx.stroke();
      this.resetPartOutline();
    }
    // Q14-B-R2-FINAL：统一绘制火焰 Fire Jet（按 muzzle 分组，每个武器一股连续火流）
    if (flames.length > 0) {
      const groups = new Map<string, RenderProjectile[]>();
      for (const f of flames) {
        const m = f.muzzle;
        if (!m) continue; // 缺 muzzle 的火焰颗粒：无根部，跳过（生产环境必有 muzzle）
        const key = `${m.x.toFixed(1)}|${m.y.toFixed(1)}`;
        const arr = groups.get(key);
        if (arr) arr.push(f);
        else groups.set(key, [f]);
      }
      for (const group of groups.values()) {
        this.drawFlameJet(group);
      }
    }
  }

  /**
   * Q14-B-R2-FINAL：喷火器 Fire Jet（一整股连续火流，纯表现）。
   *
   * 由「同武器存活火焰 projectile 群」决定外形：根部 = 真实 muzzle、主轴 = 武器真实前向，
   * 长度 = 群中最远前向距离 + 小余量、半宽 = 群中最大 |side| + 火焰余量。
   * 三层连续火焰叶（外层暗红/橙红低 alpha、中层高亮橙黄、根部短黄白热芯），
   * nozzle 窄 → mid 稍宽 → tip 收尖；复用 drawFlameShape 几何。
   * 启停完全由真实 alive projectile 决定（颗粒全灭 → buildFireJet 返回 null → 不绘制）。
   */
  private drawFlameJet(group: readonly RenderProjectile[]): void {
    const jet = buildFireJet(
      group.map((f) => ({
        center: f.center,
        muzzle: f.muzzle!,
        fireDir: f.fireDir!,
      })),
    );
    if (!jet) return;
    const rootX = this.sx(jet.muzzleX);
    const rootY = this.sy(jet.muzzleY);
    const dx = jet.dirX;
    const dy = jet.dirY;
    const px = jet.perpX;
    const py = jet.perpY;
    const len = this.ss(jet.length);
    const halfW = this.ss(jet.halfWidth);
    // 外层：暗红 / 橙红低 alpha 火焰体（整股最宽轮廓）
    this.drawFlameShape({
      rootX, rootY, dx, dy, px, py,
      len, rootHW: halfW * 0.7, midHW: halfW, color: '#c21f0a', alpha: 0.35,
    });
    // 中层：高亮橙黄主体（略短、略窄，形成火流核心）
    this.drawFlameShape({
      rootX, rootY, dx, dy, px, py,
      len: len * 0.96, rootHW: halfW * 0.45, midHW: halfW * 0.72, color: '#ff7a1a', alpha: 0.82,
    });
    // 根部短黄白热芯（喷口附近高温区；仅根部 ~35% 长度）
    this.drawFlameShape({
      rootX, rootY, dx, dy, px, py,
      len: len * 0.35, rootHW: halfW * 0.22, midHW: halfW * 0.34, color: '#fff0b0', alpha: 0.9,
    });
  }

  /**
   * Q13-C-R3 喷焰表现重做：3 层 plume（外层 glow / 主橙焰 / 白黄火芯）+ 喷口小亮核，
   * 在车辆之前绘制（车身自然遮住与车体重叠部分 → 火从车尾后方出来），不覆盖整辆西瓜。
   * 纯表现：根部 = 真实安装位置（part 挂点世界坐标），沿 exhaust 方向；不参与碰撞/伤害/物理。
   */
  private drawFlameShape(opts: {
    rootX: number; rootY: number; dx: number; dy: number; px: number; py: number;
    len: number; rootHW: number; midHW: number; color: string; alpha: number;
  }): void {
    const { rootX, rootY, dx, dy, px, py, len, rootHW, midHW, color, alpha } = opts;
    const ctx = this.ctx;
    const midLen = len * 0.5;
    const tipX = rootX + dx * len, tipY = rootY + dy * len;
    const midX = rootX + dx * midLen, midY = rootY + dy * midLen;
    // nozzle 窄 → mid 宽 → tip=0 的平滑火焰叶（非大三角/菱形）
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(rootX + px * rootHW, rootY + py * rootHW);
    ctx.quadraticCurveTo(midX + px * midHW, midY + py * midHW, tipX, tipY);
    ctx.quadraticCurveTo(midX - px * midHW, midY - py * midHW, rootX - px * rootHW, rootY - py * rootHW);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  /** 喷焰主体（glow + 主焰 + 火芯）：车辆之前绘制；windup 无长焰、cooldown 快速收掉 */
  private drawFlamePlumes(flames: readonly RenderFlame[]): void {
    const now = this.now();
    for (const f of flames) {
      if (f.phase === 'windup') continue; // 前摇只画喷口小橙光（前景），不长焰
      const len = Math.hypot(f.dirX, f.dirY) || 1;
      const dx = f.dirX / len, dy = f.dirY / len;
      const px = -dy, py = dx; // 垂直（喷焰横向）
      const rootX = this.sx(f.x), rootY = this.sy(f.y);
      // Q13-C-R3：flameWidth 理解为「总宽」→ 半宽 = width / 2；外层最大约 width×1.3/2
      const halfW = this.ss(f.width) / 2;
      // 点火节奏（最小状态机，无粒子系统）
      let lenFactor = 1, midFactor = 1;
      const t = f.tMs ?? 0;
      if (f.phase === 'cooldown') {
        const shrink = Math.max(0, 1 - t / 70); // 爆发后约 70ms 收掉
        lenFactor = shrink; midFactor = shrink;
      } else {
        const RAMP = 80; // 爆发前约 80ms 冲开
        if (t < RAMP) {
          const k = t / RAMP;
          const e = 1 - (1 - k) * (1 - k); // ease-out
          lenFactor = 0.6 + 0.5 * e; // 60% → 110% 冲开
          midFactor = 0.85 + 0.15 * e;
        } else {
          lenFactor = 1.0 + 0.06 * Math.sin(now * 0.05); // 稳定 ±6% 抖动
          midFactor = 1.0 + 0.05 * Math.sin(now * 0.043 + 1.7); // 中段 ±5% 抖动
        }
      }
      const baseLen = this.ss(f.length) * lenFactor;
      const glowMidHW = halfW * 1.3 * midFactor; // 外层最大约 width×1.3/2
      const mainMidHW = halfW * 1.15 * midFactor;
      // C 外层红橙 glow（略长、略宽、低 alpha）
      this.drawFlameShape({
        rootX, rootY, dx, dy, px, py, len: baseLen * 1.05,
        rootHW: halfW * 0.35, midHW: glowMidHW, color: '#ff5a1e',
        alpha: f.phase === 'cooldown' ? 0.22 : 0.28,
      });
      // B 主橙焰（flameColor；nozzle 窄 → mid 宽 → tip=0）
      this.drawFlameShape({
        rootX, rootY, dx, dy, px, py, len: baseLen,
        rootHW: halfW * 0.4, midHW: mainMidHW, color: f.color,
        alpha: f.phase === 'cooldown' ? 0.5 : 0.85,
      });
      // A 白黄色火芯（约 36% 长、窄、高亮；非大白圆；与 B 不同步抖动）
      const coreJ = 1 + 0.10 * Math.sin(now * 0.061 + 0.9);
      this.drawFlameShape({
        rootX, rootY, dx, dy, px, py, len: baseLen * 0.36 * coreJ,
        rootHW: halfW * 0.3, midHW: mainMidHW * 0.4, color: '#fff0b0',
        alpha: f.phase === 'cooldown' ? 0.7 : 0.95,
      });
    }
  }

  /** 喷口亮核（前景，车辆之后绘制）：windup 小橙光聚能 / thrust·cooldown 小白黄火芯 */
  private drawFlameNozzles(flames: readonly RenderFlame[]): void {
    const now = this.now();
    const ctx = this.ctx;
    for (const f of flames) {
      const rootX = this.sx(f.x), rootY = this.sy(f.y);
      if (f.phase === 'windup') {
        // 喷口小橙光：约 0→6px 轻微脉冲，无长焰
        const pulse = 0.5 + 0.5 * Math.sin(now * 0.02);
        const r = this.ss(1.5) * (1 + pulse);
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = f.color;
        ctx.beginPath();
        ctx.arc(rootX, rootY, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      } else {
        // 喷口小亮核：约 5~8px 小白黄（cooldown 随收缩淡出）
        const shrink = f.phase === 'cooldown' ? Math.max(0, 1 - (f.tMs ?? 0) / 70) : 1;
        ctx.globalAlpha = 0.95 * shrink;
        ctx.fillStyle = '#fff3d0';
        ctx.beginPath();
        ctx.arc(rootX, rootY, this.ss(3.5) * shrink, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }

  /**
   * Q13-A-R1：切割火花（圆锯有效 contactTick 接触点）。每个真实接触点画一束短亮弧
   * + 中心亮核 + 几根固定方向火花射线（确定性偏移，禁用随机）；离开接触即不再被
   * 调用（snap.sparks 为空）→ 立即消失。纯表现：不参与碰撞/伤害。
   */
  private drawSparks(sparks: readonly RenderSpark[]): void {
    if (sparks.length === 0) return;
    const ctx = this.ctx;
    for (const s of sparks) {
      const x = this.sx(s.x);
      const y = this.sy(s.y);
      const ang = Math.atan2(s.ny, s.nx); // 接触法线方向（短亮弧沿切向铺开）
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      // 中心亮核（白橙）
      ctx.fillStyle = 'rgba(255,242,180,0.95)';
      ctx.beginPath();
      ctx.arc(0, 0, this.ss(4), 0, Math.PI * 2);
      ctx.fill();
      // 短亮弧（切向，亮橙）
      ctx.strokeStyle = 'rgba(255,200,90,0.9)';
      ctx.lineWidth = Math.max(1.5, this.ss(2));
      ctx.beginPath();
      ctx.arc(0, 0, this.ss(8), -0.9, 0.9);
      ctx.stroke();
      // 几根火花射线（确定性角度偏移，禁用随机；亮橙黄）
      ctx.strokeStyle = 'rgba(255,170,60,0.85)';
      ctx.lineWidth = Math.max(1, this.ss(1.5));
      for (let k = -2; k <= 2; k++) {
        const sa = k * 0.35;
        const len = this.ss(13);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(sa) * len, Math.sin(sa) * len);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  /**
   * Q11-C-R3-FINAL：镭射巨炮束 VFX——发射后沿真实 fire 方向固定驻留 ~130ms
   * 再快速衰减（让 30fps 正常录像能看清「巨炮释放」）。纯表现：不参与碰撞/
   * 伤害；真实 Collider / 命中范围绝不扩大。
   */
  private drawLaserBeams(): void {
    const ctx = this.ctx;
    const now = this.now();
    this.laserBeams = this.laserBeams.filter((b) => now - b.bornAt < b.ttl);
    for (const b of this.laserBeams) {
      const age = (now - b.bornAt) / b.ttl; // 0→1
      const decay = 1 - age * age; // 前段饱满、末段快速衰减
      // 束起点略退后（从炮口内一点射出），终点沿方向延伸 length
      const sx0 = this.sx(b.x - b.dirX * 18);
      const sy0 = this.sy(b.y - b.dirY * 18);
      let sx1 = this.sx(b.x + b.dirX * b.length);
      let sy1 = this.sy(b.y + b.dirY * b.length);
      // F-BATTLE-HIT-READABILITY-R1：按**屏幕可见长度**收敛——世界长度在相机 zoom 下仍会被
      // 放大（battle Active scale≈3 → 240 世界 px ≈ 720 屏 px 贯穿半屏），故 clamp 屏幕
      // 长度 ≤ 45% 屏宽（Must#7 不形成贯穿半屏的持续色带；发射线保持清楚，Must#8）。
      const maxScreenLen = this.viewWidth * 0.45;
      const bdx = sx1 - sx0;
      const bdy = sy1 - sy0;
      const blen = Math.hypot(bdx, bdy);
      if (blen > maxScreenLen) {
        const k = maxScreenLen / blen;
        sx1 = sx0 + bdx * k;
        sy1 = sy0 + bdy * k;
      }
      ctx.lineCap = 'round';
      // glow（最外层，半透明，衰减）
      ctx.globalAlpha = 0.32 * decay;
      ctx.strokeStyle = '#5fc8ff';
      ctx.lineWidth = this.ss(b.glowWidth);
      ctx.beginPath();
      ctx.moveTo(sx0, sy0);
      ctx.lineTo(sx1, sy1);
      ctx.stroke();
      // 中亮层
      ctx.globalAlpha = 0.7 * decay;
      ctx.strokeStyle = '#a9eeff';
      ctx.lineWidth = this.ss(b.coreWidth * 1.4);
      ctx.beginPath();
      ctx.moveTo(sx0, sy0);
      ctx.lineTo(sx1, sy1);
      ctx.stroke();
      // 高亮核心
      ctx.globalAlpha = decay;
      ctx.strokeStyle = '#eafdff';
      ctx.lineWidth = this.ss(b.coreWidth);
      ctx.beginPath();
      ctx.moveTo(sx0, sy0);
      ctx.lineTo(sx1, sy1);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineCap = 'butt';
    }
  }

  /**
   * Q13-B-R1：霰弹炮口「扇形」爆闪 VFX——发射瞬间沿真实 fire 方向画一束短促扇形亮闪
   * （非普通圆形 flash），让单次齐射一眼是「霰弹喷射」而非单发炮。纯表现：不参与
   * 碰撞/伤害；真实 Collider / 命中范围绝不扩大。
   */
  private drawShotgunFans(): void {
    const ctx = this.ctx;
    const now = this.now();
    this.shotgunFans = this.shotgunFans.filter((f) => now - f.bornAt < f.ttl);
    for (const f of this.shotgunFans) {
      const age = (now - f.bornAt) / f.ttl; // 0→1
      const decay = 1 - age * age;
      const base = Math.atan2(f.dirY, f.dirX);
      const spread = (14 * Math.PI) / 180; // 扇形半角 ±14°
      const R = this.ss(34); // 爆闪半径（世界 px）
      const cx = this.sx(f.x);
      const cy = this.sy(f.y);
      // 扇形填充（暖橙）
      ctx.globalAlpha = 0.5 * decay;
      ctx.fillStyle = '#ffcf6a';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, base - spread, base + spread);
      ctx.closePath();
      ctx.fill();
      // 沿扇形方向几根亮射线（确定性，禁用随机；与 5 发弹道 -12/-6/0/+6/+12 呼应）
      ctx.globalAlpha = 0.95 * decay;
      ctx.strokeStyle = '#fff0c0';
      ctx.lineWidth = Math.max(1.5, this.ss(2));
      for (const d of [-12, -6, 0, 6, 12]) {
        const a = base + (d * Math.PI) / 180;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * R * 1.1, cy + Math.sin(a) * R * 1.1);
        ctx.stroke();
      }
      // 炮口亮核
      ctx.globalAlpha = decay;
      ctx.fillStyle = '#fff6d8';
      ctx.beginPath();
      ctx.arc(cx, cy, this.ss(6), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  /** Q14-A-R1：机枪方向性枪口火舌绘制——沿真实 fire 方向的短促窄火舌（15~25px，
   *  TTL ~60ms），连发时呈枪口连续快速闪动；纯表现，不参与碰撞/伤害。 */
  private drawMuzzleTongues(): void {
    const ctx = this.ctx;
    const now = this.now();
    this.muzzleTongues = this.muzzleTongues.filter((t) => now - t.bornAt < t.ttl);
    for (const t of this.muzzleTongues) {
      const age = (now - t.bornAt) / t.ttl; // 0→1
      const decay = 1 - age;
      const cx = this.sx(t.x);
      const cy = this.sy(t.y);
      const L = this.ss(20); // 火舌长 15~25px
      const tx = cx + t.dirX * L;
      const ty = cy + t.dirY * L;
      // 外沿暖橙（窄火舌轮廓）
      ctx.globalAlpha = 0.55 * decay;
      ctx.strokeStyle = '#ff9a3c';
      ctx.lineWidth = Math.max(2, this.ss(6));
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      // 内芯暖白（细亮）
      ctx.globalAlpha = 0.95 * decay;
      ctx.strokeStyle = '#fff2c8';
      ctx.lineWidth = Math.max(1.2, this.ss(2.5));
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.lineCap = 'butt';
      // 喷口亮核
      ctx.globalAlpha = decay;
      ctx.fillStyle = '#fff6d8';
      ctx.beginPath();
      ctx.arc(cx, cy, this.ss(2.5), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  private drawWheel(circle: RenderCircle, color: string): void {
    const ctx = this.ctx;
    const r = circle.radius;
    const pos = circle.center;
    ctx.fillStyle = '#22262e';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(this.sx(pos.x), this.sy(pos.y), this.ss(r), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // 轮辐（显示旋转）
    const a = circle.angle;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(this.sx(pos.x), this.sy(pos.y));
    ctx.lineTo(this.sx(pos.x + Math.cos(a) * r), this.sy(pos.y + Math.sin(a) * r));
    ctx.stroke();
  }

  /**
   * 取景（Q02-CAM-R1/R2）：仅在 Scenario load / Reset / viewport resize 时调用一次，
   * 按车辆（不含 projectile）的世界包围盒计算 scale 与偏移，覆盖 this.transform。
   * 运行期间 render() 不再重算——开炮/后坐/弹体飞远都不会改变镜头（无呼吸缩放、无跟随）。
   *
   * R2 安全区：构图以「中央实际战斗可视区域」为准（canvas 左右各内缩 SAFE_INSET_X、
   * 上下内缩 SAFE_INSET_Y），左右 Lab UI 面板不计入可用画布；世界内容完整放入
   * 安全区并保留固定世界边距，主体不会被左侧 UI 遮挡。
   *
   * - fit 'vehicles'：A+B 完整进中央可视区域（默认）；
   * - fit 'primary-fire'：只取 A（远处 B 不缩小画面）；A 初始位于可视区域偏左中部，
   *   身后保留 recoilExtent（默认 180 世界 px）反冲空间，前方保留 forwardExtent
   *   （默认 520 世界 px）固定射击空间——Cannon-Recoil / Cannon-Angle 共用此套；
   * - fit 'preview'（W2-UX-R2 / Q06-UX-R2-FIX）：装配 Preview 近距构图——A+B 完整入画，
   *   边距更小、且 Preview 使用专属近距 spawn（见 physicsLab.loadCustomPreview），
   *   内容 bounds 自然收窄 → 车辆明显比 vehicles 构图更大；不做 fit 后强放大
   *   （旧 PREVIEW_ZOOM×1.9 会把 A/B 推出 safe viewport）；只用于 Editing，不影响正式 Battle。
   * - fit 'battle'（Q08-A / Q08-A-FIX / Q08-CAM-D1）：正式战斗按 phase 构图——
   *   Active：固定战斗走廊（corridor）——左界 = 正式 spawn（width×0.25）− 位移预算，
   *   右界 = arena 右缘 − 墙厚（A 顶推 B 的交战团最终可达 arena 右墙内侧），
   *   纵向只含车辆活动高度 + 地面；不绑定开局瞬时位置，真实可达范围内
   *    Visual 完整入画且车辆足够大；Warning：左界外扩 WARNING_SPREAD 逐步准备
   *   Closing；Closing / End：完整战场安全构图（0..width + Closing wall 全程入画，
   *   W1-P0-CLOSE-FIX 原语义）。battle 一律取 fitLimit（不 ×CONTENT_ZOOM），
   *   完整入画是硬约束；仅 Battle start / phase 切换 / resize 时构图一次，
   *   运行期间绝不 follow、不动态 zoom、不随 projectile 扩镜头。
   *
   * 内容退化时回退到现有 transform（resize 设置的 arena 框）。
   */
  reframe(
    snap: BattleRenderSnapshot,
    fit: CameraFit = 'vehicles',
    opts: { forwardExtent?: number; recoilExtent?: number; phase?: string; framingRect?: FramingRect } = {},
  ): void {
    const forwardExtent = opts.forwardExtent ?? 520;
    const recoilExtent = opts.recoilExtent ?? 180;
    // F-UX-3B：构图 phase（battle 专用；非 battle 一律 '' → Active 语义）
    const phase = opts.phase ?? '';
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const acc = (x: number, y: number): void => {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    };
    const includeShape = (shape: RenderShape): void => {
      if (shape.kind === 'polygons') {
        for (const poly of shape.polygons) for (const p of poly.points) acc(p.x, p.y);
      } else {
        const c = shape.circle;
        acc(c.center.x - c.radius, c.center.y - c.radius);
        acc(c.center.x + c.radius, c.center.y + c.radius);
      }
    };
    // Q08-A-FIX：真实 Visual AABB（position 为中心 + size + rotation；mirror 不改变
    // AABB 尺寸语义）。「完整入画」的标准 = 玩家真正看到的 Visual 完整入画，
    // 不是仅 Collider 完整（banana sprite 明显大于 collider 的旧 bug 靠此根治）。
    const includeVisual = (v: RenderVisual): void => {
      const hw = v.size.width / 2;
      const hh = v.size.height / 2;
      const cos = Math.cos(v.rotation);
      const sin = Math.sin(v.rotation);
      for (const c of [
        { x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh },
      ]) {
        acc(c.x * cos - c.y * sin + v.position.x, c.x * sin + c.y * cos + v.position.y);
      }
    };
    const includeVehicle = (v: RenderVehicle): void => {
      includeShape(v.body);
      if (v.bodyVisual) includeVisual(v.bodyVisual);
      for (const w of v.wheels) {
        acc(w.center.x - w.radius, w.center.y - w.radius);
        acc(w.center.x + w.radius, w.center.y + w.radius);
      }
      if (v.wheelVisuals) {
        for (const wv of v.wheelVisuals) {
          if (wv) includeVisual(wv);
        }
      }
      for (const p of v.parts) {
        includeShape(p.shape);
        if (p.visual) includeVisual(p.visual);
      }
    };
    // Q15-UI-R2：固定预览框（previewSolo / previewFixed）——bounds 直接定死，
    // 不按车辆包围盒取景（候选换车 / 不同车身均不呼吸缩放）。
    // F-WX-8-B：compact 手机横屏用「Mobile 固定框」——previewSolo 纵向收窄到车辆+
    // 地面附近（旧框 y∈[400,730] 高 330 被纵向 fit 压扁，车辆只剩 ~19% 宽），
    // 横向保持 440（所有 body 覆盖）；previewFixed（Matching）语义不变。
    // F-HOME-STAGE-R2：previewSolo 一旦传入 framingRect（首页/车库取景区），无论 compact
    // 与否都走「envelope 自适应」分支——把真实整车 envelope 居中 fit 到该子区域（含桌面
    // Web 首页/车库）；否则桌面无 framing 时仍用旧固定 SOLO 框（历史语义，向后兼容）。
    const isCompact = isCompactLandscape(this.viewWidth / this.viewToLogical, this.viewHeight / this.viewToLogical);
    // F-HOME-DEMO-POLISH-R1：home 取景记录车辆 envelope 宽（供宽度目标区间 clamp）
    let soloEnvW = 0;
    if (fit === 'previewSolo') {
      if (isCompact || opts.framingRect) {
        // F-UX-3A：envelopeBounds（Body+Wheels+Functional Parts）自适应 padding——
        // 完整车辆外廓必须不进入右侧 panelRect（scale 适配 envelope 即整辆车落在
        // vehicleRect 内）；core（车身主体）自然更小（层级：完整 > 主体）。
        const env = this.vehicleBounds(snap.vehicleA, true);
        const ew = Math.max(1, env.maxX - env.minX);
        const eh = Math.max(1, env.maxY - env.minY);
        soloEnvW = ew;
        const padX = Math.max(MIN_SOLO_PAD_X, ew * SOLO_PAD_X_RATIO);
        const padY = Math.max(MIN_SOLO_PAD_Y, eh * SOLO_PAD_Y_RATIO);
        minX = env.minX - padX;
        maxX = env.maxX + padX;
        minY = env.minY - padY;
        maxY = env.maxY + padY;
      } else {
        minX = SOLO_MIN_X; maxX = SOLO_MAX_X; minY = SOLO_MIN_Y; maxY = SOLO_MAX_Y;
      }
    } else if (fit === 'previewFixed') {
      minX = MATCH_MIN_X; maxX = MATCH_MAX_X; minY = MATCH_MIN_Y; maxY = MATCH_MAX_Y;
    }
    // ground anchor：保证地面线在 y 范围内（仅锚定 Y；不把 groundY 误作 X 污染水平 bounds，
    // 否则 preview 车辆的包围盒中心被右移、最终屏幕水平偏心——F-HOME-IA-R1 修复）。
    minY = Math.min(minY, snap.arena.groundY);
    maxY = Math.max(maxY, snap.arena.groundY);
    if (fit === 'battle') {
      // F-BATTLE-CAMERA-R2：战斗相机基于 A+B 真实可见 envelope 构图——不再按整个
      // Arena / 收束墙全量 fit（旧 Closing 全景把车辆缩成小模型；旧 corridor 预算高度
      // 在横向主导时产生车辆贴底 + 顶部大片无意义空白）。所有 phase（Active/Warning/
      // Closing/End）同构图语义：
      // - bounds = A+B 完整车辆（body+wheel+parts+visual）并集 + 横向固定 padding；
      // - 纵向 = 车辆 envelope 顶 .. groundY + 地面余量；地面线锚定安全画面 78~84%；
      // - Closing/End 不把两侧收束墙纳入 bounds——墙从当前画面边缘进入，车辆仍为主体；
      // - Closing scale 相对正常战斗（battleCam.baseScale）变化 ≤15%（防骤缩）；
      // - 极端构筑（长武器/无轮站桩/高车身/翻转姿态）由 envelope 口径天然覆盖。
      includeVehicle(snap.vehicleA);
      if (!snap.soloA) includeVehicle(snap.vehicleB);
      minX -= BATTLE_ENV_PAD_X;
      maxX += BATTLE_ENV_PAD_X;
    } else if (fit === 'primary-fire') {
      includeVehicle(snap.vehicleA);
      // 身后明确 recoil 空间 + 前方固定射击空间（A 朝 +X 发射方向）
      minX -= recoilExtent;
      maxX += forwardExtent;
    } else if (fit === 'preview') {
      // Q06-UX-R2-FIX：装配 Preview = A+B 完整入画（近距 spawn 收窄 bounds 已含在
      // snapshot 里）；放大只靠下方小边距分支，绝不 fit 后 ×1.9。
      includeVehicle(snap.vehicleA);
      // Q15-UX-R1：solo-A 预览（Garage）只框 A，不为占位 B 留空位
      if (!snap.soloA) includeVehicle(snap.vehicleB);
    } else {
      // Q15-UI-R2：预览默认（vehicles 兜底）含 A+B；previewSolo / previewFixed 的
      // bounds 已在上文固定，不在此按车辆重算（杜绝候选换车时的呼吸缩放）。
      if (fit === 'vehicles') {
        includeVehicle(snap.vehicleA);
        if (!snap.soloA) includeVehicle(snap.vehicleB);
      }
    }
    // Projectile 永不参与 camera bounds
    if (!isFinite(minX) || !isFinite(minY) || maxX - minX < 1 || maxY - minY < 1) return;
    const isPreview = fit === 'preview';
    const isFixed = fit === 'previewSolo' || fit === 'previewFixed';
    // F-BATTLE-CAMERA-R2：compact battle（手机横屏）统一薄地面构图——所有 phase
    // （Active/Warning/Closing/End）同 inset（顶部 HUD 56 / 底部 12），地面线在全屏
    // 78~84% 恒定（旧 phase 切换 insetBottom 40→12 会改变 safeH，使地面线位置漂移）。
    const compactBattleActive = fit === 'battle' && isCompact;
    // F-WX-8-B：compact 固定框（Mobile previewSolo/previewFixed）用极小 margin——
    // 固定框 bounds 自带覆盖余量（如 solo 框 440 宽 vs 车辆 180 宽），再叠加 48 的
    // CONTENT_MARGIN_WORLD 会把纵向 bh 撑大、压扁手机横屏下的车辆（实测 24%）。
    const m = (isFixed || fit === 'battle') && isCompact ? 8 : isPreview ? PREVIEW_MARGIN_WORLD : CONTENT_MARGIN_WORLD;
    minX -= m; maxX += m; minY -= m; maxY += m;
    // 地面表面留出可见区域。F-WX-RCA-3A：previewSolo compact（coreBounds 自适应 padding）
    // 自带完整车辆余量，跳过此钳制——否则 bounds 底部被推到 groundY+40（740）使 bounds 中心
    // 偏离 core 中心，破坏多 body 下的垂直居中（实测 9px 偏移）。
    // F-UX-3B：compact battle Active 用 48（配合底部锚定 → 地面占屏 12~16%）；
    // 其余构图保持 groundY+40 语义。
    const groundBelow = compactBattleActive ? 48 : 40;
    if (!(fit === 'previewSolo' && isCompact) && maxY < snap.arena.groundY + groundBelow) {
      maxY = snap.arena.groundY + groundBelow;
    }
    const bw = maxX - minX, bh = maxY - minY;
    const cw = this.viewWidth, ch = this.viewHeight;
    if (cw < 2 || ch < 2) return;
    // R2：可用画布 = 中央实际战斗可视区域（扣除左右 UI 阴影区）；
    // Q15-UI-R2：玩家 Shell 预览（previewSolo / previewFixed）额外内缩 top/bottom，
    // 给顶部状态栏与底部装配 Dock 留位，车辆居中于中间可视带、不被遮挡。
    // F-WX-6/8-B：紧凑横屏（手机）——顶部给状态条/HUD（~52 逻辑 px）、底部给
    // Mobile-first Garage 两层操作区（~110 逻辑 px）；previewSolo 左右阴影区收窄到 8
    // （Mobile Garage 全宽布局，safe area 由 Host insL/insR 处理）→ 车辆占可用宽 30~45%。
    // F-UX-3B：compact battle Active 底部只留 12（薄地面构图，上方空间全部还给战斗）。
    // Desktop（h≥600）语义完全不变。
    // F-CROSSLAYER-RECT-DPR-P0：view-space 域 = viewWidth 域（注入 surface=backing=logical×dpr；
    // Web 无 surface=logical）。inset 常量语义为【logical px】，统一经 vk 换算到 view 域：
    //   vk = surface ? dpr : 1（Web 下 vk=1 → 保持历史 logical 语义零回归；surface 下 ×dpr
    //   与 backing viewWidth 对齐 → ÷dpr 后逻辑构图与 DPR 无关，满足 Must#9）。
    // 旧实现 compact 分支 ×viewDpr 但 desktop/isFixed 分支与 insetX 用裸 logical → 域混，
    // surface 注入 DPR1 vs 1.5 逻辑 safeW 差 (16/dpr) px、A 中心差 ~1.85px。
    const vk = this.viewToLogical;
    const insetX = isCompact
      ? fit === 'battle'
        ? 0
        : isFixed
          ? 8 * vk
          : SAFE_INSET_X * vk
      : SAFE_INSET_X * vk;
    const insetTop = isFixed
      ? isCompact
        ? Math.round(52 * vk)
        : 70 * vk
      : isCompact
        ? Math.round(56 * vk)
        : SAFE_INSET_Y * vk;
    const insetBottom = isFixed
      ? isCompact
        ? Math.round(110 * vk) // F-WX-8-B：新三层 Dock 两行 ~100px
        : 160 * vk
      : isCompact
        ? compactBattleActive
          ? Math.round(12 * vk) // F-UX-3B：薄地面构图（地面占屏 12~16%）
          : Math.round(40 * vk)
        : SAFE_INSET_Y * vk;
    // F-WX-UI-1：framingRect（viewport logical 子区域）存在时，固定预览框 fit 到该区域
    // 内的安全区（rect 已含布局留白，内部仅留小边距）——Mobile Garage 车辆 fit 到左侧
    // 展示区；无 framingRect → 全屏安全区逻辑（Desktop 零影响）。
    const framing = opts.framingRect;
    let baseX: number;
    let baseY: number;
    let safeW: number;
    let safeH: number;
    if (framing && isFixed) {
      // F-CROSSLAYER-RECT-DPR-P0：framingRect 是【viewport logical】子区域（844×390 空间，
      // 来自 UI getPreviewFramingRect / homeLayout / garageLayout）。view 坐标域由 viewWidth
      // 决定：无 surface 注入（Web 玩家模式）时 viewWidth=canvas.clientWidth=logical，此时
      // 【不得】×viewDpr（旧实现×viewDpr 使 safeW 变 backing 域而绘制假设 logical →
      // scale 域分裂 → DPR>1 车辆放大 1.5× 越界，用户 150% 缩放实测首页绿车越出右侧屏幕、
      // Garage 车进右侧面板）；注入 surface（微信/单测）时 viewWidth=backing，×viewDpr 是
      // 必需域对齐。统一规则：转换只做域对齐，不做多余 DPR 转换。
      const vk = this.viewToLogical;
      const pad = 6 * vk;
      const fx = framing.x * vk;
      const fy = framing.y * vk;
      const fw = framing.w * vk;
      const fh = framing.h * vk;
      baseX = fx + pad;
      baseY = fy + pad;
      safeW = Math.max(2, fw - pad * 2);
      safeH = Math.max(2, fh - pad * 2);
    } else {
      baseX = insetX;
      baseY = insetTop;
      safeW = Math.max(2, cw - insetX * 2);
      safeH = Math.max(2, ch - insetTop - insetBottom);
    }
    // Q06-UX-R2-FIX / Q08-A-FIX：声明「完整入画」的 fit（preview / battle）直接取
    // fitLimit——任何 >1 的乘数（旧 ×1.9、×1.05）都会使含 margin 的内容超出
    // safeW×safeH 被左右裁切，破坏完整入画硬约束。preview 的明显放大来自近距 spawn
    // 收窄 bounds + 更小 margin；battle 的车辆变大来自更合理的 corridor bounds；
    // vehicles / primary-fire / scenario 保持历史 ×CONTENT_ZOOM 语义。
    const fitLimit = Math.min(safeW / bw, safeH / bh);
    const enforceFitLimit = isPreview || fit === 'battle' || isFixed;
    let scale = enforceFitLimit ? fitLimit : fitLimit * CONTENT_ZOOM;
    // F-HOME-IA-R1：固定预览框（previewSolo/previewFixed）传入 framingRect 时，取景必须
    // 真正 fit 到该子区域——不再用 MIN_CONTENT_SCALE 兜底放大（否则矮屏小取景区里完整车辆
    // 会被强行放大溢出取景区）。
    // F-MATCH-FRAME-R2：previewFixed（Matching/Locked 全屏固定框，无 framingRect）也必须
    // 精确 fit 到安全区——若仍用 MIN_CONTENT_SCALE 兜底（0.4），窄屏（safeW<414）会把车辆
    // 放大溢出裁切（真机暴露「候选车辆被右边界裁切」）。故 previewFixed 与「带 framingRect
    // 的固定预览」同样跳过下限，保证完整入画、无裁切；左右车辆尺度接近、无呼吸。
    // 其余固定/非固定 fit 仍保留下限，避免车辆在全屏框里过小。
    const applyMinScale = !(framing && isFixed) && fit !== 'previewFixed';
    if (scale < MIN_CONTENT_SCALE && applyMinScale) scale = MIN_CONTENT_SCALE;
    if (scale > MAX_CONTENT_SCALE) scale = MAX_CONTENT_SCALE;
    // F-HOME-DEMO-POLISH-R1：首页取景——普通初始车辆可见宽目标 = 安全宽 38%~52%
    // （clamp fitLimit；高度主导时 fitLimit 较小则保持 → 极端构筑/矮屏优先完整入画）。
    // 高度完整入画上限优先：底部锚定把全部纵向余量集中到顶部，若 clamp 下限（≥38% 宽）
    // 超过高度上限会把车辆顶出取景区（360×180 + 高窄车实测顶缘越界）——先 clamp 再
    // min(高度上限)，保证「极端优先完整入画」硬约束。
    // F-GARAGE-CENTER-STAGE-P0 / F-GARAGE-VISUAL-DENSITY-R2：garage 模式（中央舞台取景）同款
    // 宽度 clamp（Must#2：车辆最终可见宽约占屏幕 40%~48%）——clamp 区间与 home 相同（40%~47%）。
    if (fit === 'previewSolo' && (framing?.mode === 'home' || framing?.mode === 'garage') && soloEnvW > 0) {
      const minS = (HOME_VEHICLE_WIDTH_MIN_PCT * safeW) / soloEnvW;
      const maxS = (HOME_VEHICLE_WIDTH_MAX_PCT * safeW) / soloEnvW;
      const hLimit = safeH / bh; // 高度完整入画上限（bh>0 已由上方 bounds 守卫保证）
      scale = Math.min(hLimit, Math.min(maxS, Math.max(minS, scale)));
    }
    // F-BATTLE-CAMERA-R2：battle 相机基准记录 / 非 Active 阶段尺度钳制。
    // Active（正常战斗）构图时记录基准（供运行期跟随 + 后续阶段相对钳制）；
    // Warning/Closing/End 用同一 envelope 构图但把 scale 钳制在基准 ±15%——
    // 接近碰撞时 envelope 收窄也不放大（保持稳定尺度）、分离时有限拉远、
    // 收束墙不参与 bounds（不会因墙全量 fit 骤缩），车辆始终是视觉主体。
    if (fit === 'battle') {
      if (phase === 'Active' || phase === '') {
        // F-BATTLE-STAGE-COMPOSITION-P0：Active 首帧计算战斗舞台地面线并记录——
        // Warning/Closing/End 复用同一 groundScreenY（地面线位移 0，阶段连续）。
        const stageTop = baseY; // HUD 下缘（compact=56 / desktop=insetTop，物理 px）
        const logicalH = this.viewHeight / this.viewToLogical; // 视口逻辑高
        // 车辆完整位于 HUD 下方所需的最小 groundY（vehicleClear 净空）；再 clamp 到视口 68~72%
        const vehBottomNeed = stageTop / this.viewToLogical + (bh * scale) / this.viewToLogical + BATTLE_STAGE_VEHICLE_CLEAR;
        let groundScreenYLog = Math.max(logicalH * BATTLE_STAGE_GROUND_MIN, vehBottomNeed);
        groundScreenYLog = Math.min(groundScreenYLog, logicalH * BATTLE_STAGE_GROUND_MAX);
        this.battleCam = {
          baseScale: scale,
          baseEnvW: Math.max(1, bw),
          minScale: scale * BATTLE_SEPARATE_SCALE_MIN,
          groundScreenY: groundScreenYLog * this.viewToLogical, // 与 offsetY 同空间（surface=逻辑；Web=历史 ×dpr）
          arenaW: snap.arena.width,
          safeBaseX: baseX,
          safeW,
          baseY,
          safeH,
        };
      } else if (this.battleCam) {
        const lo = this.battleCam.baseScale * (1 - BATTLE_CLOSE_SCALE_DELTA);
        const hi = this.battleCam.baseScale * (1 + BATTLE_CLOSE_SCALE_DELTA);
        scale = Math.min(hi, Math.max(lo, scale));
      }
    } else {
      this.battleCam = null;
    }
    // 内容定位：默认居中于安全区中心（offset 含安全区内缩量；玩家 Shell 预览用 top 内缩）。
    // F-BATTLE-STAGE-COMPOSITION-P0：battle 统一「战斗舞台地面线锚定」——groundY 映射到
    // Active 首帧计算的 groundScreenY（视口高 68~72%，顶部避开 HUD、底部保留有限地面带），
    // 后续阶段复用同一地面线（位移 0）。车辆站上地面线、主体居中，杜绝「压底 + 顶部死区」。
    const offsetX = baseX + (safeW - bw * scale) / 2 - minX * scale;
    let offsetY: number;
    if (fit === 'battle') {
      offsetY =
        (this.battleCam?.groundScreenY ?? baseY + safeH * BATTLE_STAGE_GROUND_MIN * 0.8) -
        snap.arena.groundY * scale;
    } else if (fit === 'previewFixed') {
      // F-PREBATTLE-VISUAL-R1：战前地面线锚定视口 ~72%——地面以下带 ≈28%（24%~30%），
      // 杜绝「车辆悬上、近半屏纯色地面空区」（Must#8）。与 battle 同锚定语义（groundScreenY
      // 恒定 → Matching→Locked 地面线位移 0，不切换背景/不跳位）。
      // 安全钳制：车辆 box 顶不低于安全区顶、底不超出视口（极端矮屏下退化为贴顶安全构图）。
      let gY = (this.viewHeight / this.viewDpr) * PREBATTLE_GROUND_FRAC * this.viewDpr;
      const boxTop = gY - (snap.arena.groundY - minY) * scale;
      const boxBot = gY + (maxY - snap.arena.groundY) * scale;
      if (boxTop < baseY) gY += baseY - boxTop;
      if (boxBot > this.viewHeight) gY -= boxBot - this.viewHeight;
      offsetY = gY - snap.arena.groundY * scale;
    } else if (framing?.mode === 'home') {
      // F-HOME-VISUAL-R2：车辆 envelope 垂直居中于取景区（视觉中心构图 Must#1——
      // 不得贴底偏下；「贴地展示」由前景展示平台（drawHomeBackdrop 前景层）表达）。
      offsetY = baseY + (safeH - bh * scale) / 2 - minY * scale;
    } else if (compactBattleActive) {
      offsetY = baseY + (safeH - bh * scale) - minY * scale;
    } else {
      offsetY = baseY + (safeH - bh * scale) / 2 - minY * scale;
    }
    this.transform = { scale, offsetX, offsetY };
    this.previewGroundY = snap.arena.groundY;
    // F-WX-9A：DEV-only 取景尺度日志（__WX_DEBUG__=true，WECHAT_DEBUG_INPUT=1 构建注入；
    // PROD __WX_DEBUG__=false → 编译期常量折叠，零日志）。只读诊断，不改变任何 framing 语义。
    if (typeof __WX_DEBUG__ !== 'undefined' && __WX_DEBUG__) {
      // F-WX-RCA-1：双口径——core = Body+Wheels（玩家主体）；envelope = +Parts（完整战斗外廓）
      const d = this.scaleDiagnostics(snap);
      // eslint-disable-next-line no-console
      console.log(
        '[WX-REF]',
        JSON.stringify({
          fit,
          framingRect: opts.framingRect ?? null,
          view: d.view,
          transform: { scale, offsetX, offsetY },
          vehicleA: { core: d.core, envelope: d.envelope },
        }),
      );
    }
    // F-WX-RCA-1/2B：RCA 专用构建（WECHAT_RCA=1 注入 __WX_RCA__=true）——真实微信尺度数据。
    // Garage 段（previewSolo/previewFixed）随 reframe 输出（低频预览）；Battle 段仅 Active
    // 首帧一次（battleRcaLogged，防刷屏），输出 A/B 双车 core/envelope 四值。
    // 普通 build:wechat PROD __WX_RCA__=false → 零日志。只读诊断，不改变 framing 语义。
    if (typeof __WX_RCA__ !== 'undefined' && __WX_RCA__) {
      if (fit === 'battle' && (opts.phase ?? '') === 'Active' && !this.battleRcaLogged) {
        this.battleRcaLogged = true;
        const d = this.scaleDiagnosticsBoth(snap);
        // eslint-disable-next-line no-console
        console.log(
          '[WX-RCA]',
          JSON.stringify({
            step: 'battle',
            phase: opts.phase,
            view: d.view,
            transform: { scale, offsetX, offsetY },
            A: d.A,
            B: d.B,
          }),
        );
      } else if (isFixed) {
        const d = this.scaleDiagnostics(snap);
        // eslint-disable-next-line no-console
        console.log(
          '[WX-RCA]',
          JSON.stringify({
            step: 'garage',
            framingRect: opts.framingRect ?? null,
            view: d.view,
            transform: { scale, offsetX, offsetY },
            core: d.core,
            envelope: d.envelope,
          }),
        );
      }
    }
  }

  /**
   * F-BATTLE-CAMERA-R2：战斗运行期跟随（fit==='battle' 构图后每帧调用，纯 Presentation；
   * 不修改 Physics 世界与结果）。
   * - 尺度：双方 envelope 并集宽 > 构图基准 → 有限拉远（≤12%）；≤ 基准 → 保持稳定尺度
   *   （接近碰撞不放大，无呼吸）；
   * - 位置：x 追踪双方中点（视野 clamp 不露出 arena 外）；y 固定地面线锚定（78~84%）；
   * - 平滑：offsetX 每帧 20% 收敛、scale 每帧 ≤0.4% → 无骤缩 / 跳位 / 相机呼吸。
   * - Closing 阶段：基准钳制仍生效（scale 相对正常战斗 ≤15%），墙由 Physics 推进自然
   *   从当前画面边缘进入——车辆始终是视觉主体。
   */
  private applyBattleFollow(snap: BattleRenderSnapshot): void {
    const cam = this.battleCam;
    if (!cam) return;
    // A+B 当前真实 envelope（body+wheel+parts+visual，与构图同口径）
    let minX = Infinity;
    let maxX = -Infinity;
    const acc = (x: number): void => {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    };
    const accShape = (s: RenderShape): void => {
      if (s.kind === 'polygons') {
        for (const poly of s.polygons) for (const p of poly.points) acc(p.x);
      } else {
        acc(s.circle.center.x - s.circle.radius);
        acc(s.circle.center.x + s.circle.radius);
      }
    };
    const accVisual = (v: { position: { x: number; y: number }; rotation: number; size: { width: number; height: number } }): void => {
      const hw = v.size.width / 2;
      const hh = v.size.height / 2;
      const cos = Math.cos(v.rotation);
      const sin = Math.sin(v.rotation);
      for (const c of [
        { x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh },
      ]) {
        acc(c.x * cos - c.y * sin + v.position.x);
      }
    };
    const inc = (v: RenderVehicle): void => {
      accShape(v.body);
      if (v.bodyVisual) accVisual(v.bodyVisual);
      for (const w of v.wheels) {
        acc(w.center.x - w.radius);
        acc(w.center.x + w.radius);
      }
      if (v.wheelVisuals) {
        for (const wv of v.wheelVisuals) {
          if (wv) accVisual(wv);
        }
      }
      for (const p of v.parts) {
        accShape(p.shape);
        if (p.visual) accVisual(p.visual);
      }
    };
    inc(snap.vehicleA);
    if (!snap.soloA) inc(snap.vehicleB);
    const envW = Math.max(1, maxX - minX);
    // 分离（envW > 基准）→ 有限拉远；接近（envW ≤ 基准）→ 保持稳定（不放大）
    const targetScale = Math.max(cam.minScale, Math.min(cam.baseScale, (cam.baseScale * cam.baseEnvW) / envW));
    const t = this.transform;
    const midX = (minX + maxX) / 2;
    const targetOffX = cam.safeBaseX + cam.safeW / 2 - midX * targetScale;
    // clamp：视野不露出 arena 外（world 0..arenaW 保持入画）
    const minOff = cam.safeBaseX + cam.safeW - cam.arenaW * targetScale;
    const maxOff = cam.safeBaseX;
    const clampedOffX =
      minOff > maxOff
        ? cam.safeBaseX + (cam.safeW - cam.arenaW * targetScale) / 2 // 视野比 arena 宽：居中
        : Math.min(maxOff, Math.max(minOff, targetOffX));
    // 平滑（防呼吸/骤缩/跳位）
    const offX = t.offsetX + (clampedOffX - t.offsetX) * 0.2;
    const stepLimit = t.scale * 0.004;
    const scaleStep = Math.max(-stepLimit, Math.min(stepLimit, targetScale - t.scale));
    const scale = t.scale + scaleStep;
    // F-BATTLE-STAGE-COMPOSITION-P0：地面线恒定锚定（Active 首帧计算的 groundScreenY；
    // scale 分离变化时 offsetY 同步补偿 → 地面线位移 0，车辆始终站在同一舞台地面线）
    const offsetY = cam.groundScreenY - snap.arena.groundY * scale;
    this.transform = { scale, offsetX: offX, offsetY };
  }

  /**
   * F-BATTLE-VISUAL-CLEANUP-R3｜Must#3：套用「表现轮廓」样式（替代旧近黑硬描边）。
   *
   * - 颜色：由填充色派生（partOutlineColor），同色系加深，不再是 `#0d0f14` 近黑；
   * - 线宽：ss(0.9) 后 clamp 到 [0.6, 1.2] —— 随镜头尺度收敛，420×210 小档不再粗黑框；
   * - lineJoin='round'：去掉「工程直角盒」的轮廓语气（几何本身不变，只改描边表现）。
   *
   * 调用方负责在描边结束后调用 resetPartOutline() 还原 lineJoin，避免影响 HUD / 阶段 FX
   * 等后续描边（Renderer 各处本就逐次设置 strokeStyle/lineWidth，唯 lineJoin 需显式还原）。
   */
  private applyPartOutline(fill: string): void {
    const ctx = this.ctx;
    ctx.strokeStyle = partOutlineColor(fill);
    ctx.lineWidth = Math.max(
      PART_OUTLINE_MIN_WIDTH,
      Math.min(PART_OUTLINE_MAX_WIDTH, this.ss(PART_OUTLINE_WORLD_WIDTH)),
    );
    ctx.lineJoin = 'round';
  }

  /** F-BATTLE-VISUAL-CLEANUP-R3：还原 lineJoin（表现轮廓是局部样式，不污染后续描边） */
  private resetPartOutline(): void {
    this.ctx.lineJoin = 'miter';
  }

  /**
   * 引擎中立形状绘制：discriminated union（polygons / circle），不依赖 Matter Body。
   * circle 真实绘制圆弧（不近似为多边形）；polygons 逐多边形描边（沿用 Matter 视觉语义）。
   *
   * F-BATTLE-VISUAL-CLEANUP-R3｜Must#3：描边改走 applyPartOutline（表现轮廓），
   * 真实几何 / 顶点 / collider 完全不变——只是不再画近黑硬线框。
   */
  private drawShape(shape: RenderShape, color: string): void {
    const ctx = this.ctx;
    if (shape.kind === 'circle') {
      const c = shape.circle;
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(this.sx(c.center.x), this.sy(c.center.y), this.ss(c.radius), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      this.applyPartOutline(color);
      ctx.stroke();
      this.resetPartOutline();
      // Q05-V1：圆形 Functional Part（如 Lift Roller）旋转可感知——
      // 沿真实 RenderCircle.angle 画一条径向方向线（radius × 0.8）：
      // 完全使用 snapshot 的真实物理角度，不新增 gameplay 状态、不伪造旋转。
      const dir = c.radius * 0.8;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(this.sx(c.center.x), this.sy(c.center.y));
      ctx.lineTo(
        this.sx(c.center.x + Math.cos(c.angle) * dir),
        this.sy(c.center.y + Math.sin(c.angle) * dir),
      );
      ctx.stroke();
      return;
    }
    for (const poly of shape.polygons) {
      const verts = poly.points;
      if (verts.length === 0) continue;
      ctx.beginPath();
      ctx.moveTo(this.sx(verts[0].x), this.sy(verts[0].y));
      for (let i = 1; i < verts.length; i++) {
        ctx.lineTo(this.sx(verts[i].x), this.sy(verts[i].y));
      }
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.9;
      ctx.fill();
      ctx.globalAlpha = 1;
      this.applyPartOutline(color);
      ctx.stroke();
      this.resetPartOutline();
    }
  }

  /** W2-FX-2：只描边不填充（刺墙高亮 / 脉动描边；仅 polygons） */
  private strokeShape(shape: RenderShape, color: string): void {
    const ctx = this.ctx;
    if (shape.kind !== 'polygons') return;
    ctx.strokeStyle = color;
    ctx.lineWidth = this.ss(3);
    for (const poly of shape.polygons) {
      const verts = poly.points;
      if (verts.length === 0) continue;
      ctx.beginPath();
      ctx.moveTo(this.sx(verts[0].x), this.sy(verts[0].y));
      for (let i = 1; i < verts.length; i++) {
        ctx.lineTo(this.sx(verts[i].x), this.sy(verts[i].y));
      }
      ctx.closePath();
      ctx.stroke();
    }
  }

  /**
   * W2-FX-2：Closing 正式刺墙视觉——沿墙面朝 arena 内部画锯齿尖刺。
   * 方向由墙面与 arena 中心相对位置决定（左墙向右刺、右墙向左刺）；
   * 完全基于 snapshot 真实墙几何（AABB），不新增 gameplay 状态。
   */
  private drawSpikes(shape: RenderShape, color: string, _now: number): void {
    const ctx = this.ctx;
    if (shape.kind !== 'polygons') return;
    const points = shape.polygons[0]?.points;
    if (!points || points.length === 0) return;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    if (!Number.isFinite(minX)) return;
    // 刺墙朝向 arena 内部：墙中心相对屏幕中心（本 wall 所在 arena 中心 800）
    const dir = (minX + maxX) / 2 < 800 ? 1 : -1;
    const baseX = dir > 0 ? maxX : minX; // 墙面（arena 内侧边缘）
    const spikeLen = 16; // 尖刺伸出长度（世界 px）
    const spacing = 26; // 尖刺纵向间距
    const tipX = baseX + dir * spikeLen;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.85;
    for (let y = minY + 10; y < maxY - 8; y += spacing) {
      ctx.beginPath();
      ctx.moveTo(this.sx(baseX), this.sy(y));
      ctx.lineTo(this.sx(tipX), this.sy(y + spacing / 2));
      ctx.lineTo(this.sx(baseX), this.sy(y + spacing));
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
