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
 * Q08-A-FIX / Q08-CAM-D1：正式 Battle 固定战斗走廊（corridor）——不绑定开局瞬间车辆位置。
 * 横向左界基于正式 spawn（arena.width×0.25）外扩「位移预算 160 + 最大视觉半宽 110」；
 * 横向右界直接锚定 arena 右缘（width − 墙厚）——真实物理中 A（质量 120+）持续驱动
 * +X 顶推 B（质量 45）会使 A/B 交战团整体右移（录像与 Runtime 实测一致），
 * 最终可达 arena 右墙内侧；对称 spawn 预算无法覆盖该真实可达范围（旧 1470 < 实测 1534
 * 出框，Q08-CAM-D1 诊断 firstOOB t=11767ms Active B visual 右缘 1534.7）。
 * 纵向只覆盖车辆活动高度（地面以上 190）+ 地面——不含 Closing 墙顶，
 * 上方无巨大无效空间，车辆保持足够大。Warning 左侧再外扩 WARNING_SPREAD=100
 * 逐步准备 Closing；Closing/End 用完整收束安全构图。
 */
const CORRIDOR_SPAWN_A_RATIO = 0.25;
const CORRIDOR_MOVE_BUDGET = 160; // 每侧可承受的碰撞/后坐位移预算
const CORRIDOR_VISUAL_HALF = 110; // 最大真实视觉半宽（banana body visual 100 + 余量）
const CORRIDOR_ACTIVE_EXTENT = CORRIDOR_MOVE_BUDGET + CORRIDOR_VISUAL_HALF; // 270
const CORRIDOR_WARNING_SPREAD = 100; // Warning 相对 Active 的额外外扩（逐步准备 Closing）
const CORRIDOR_HEIGHT = 190; // 纵向：车辆活动高度（地面以上预算，不含 Closing 墙顶）
const CORRIDOR_EDGE_PAD = 60; // Q08-CAM-D1：corridor 右界锚定 arena 右缘（对齐墙厚 60）
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
// F-WX-8-C：Mobile 战斗 Active corridor——覆盖真实交战区（开局 A(400)/B(1200) 完整
// 可见，A 顶推 B 到右墙的主要过程在屏内）；宽 980 = 开局精确边界（A 左缘 315 / B 右缘 1295，
// 实测 vehicleA watermelon [315,558]、vehicleB banana [1038,1295]）；配合 compact battle
// margin 8 + insetX 0 → 单车占屏 ~24.4%（F-WX-9C 目标 24~30%，旧 300-1340+margin64+inset56 仅 ~18%）。
// Warning/Closing 回退完整 arena（场地规则优先）。
const MOBILE_ACTIVE_MIN_X = 315;
const MOBILE_ACTIVE_MAX_X = 1295;
const MATCH_MIN_X = 440;
const MATCH_MAX_X = 1150;
const MATCH_MIN_Y = 400;
const MATCH_MAX_Y = 730;

interface FloatingText {
  x: number;
  y: number;
  text: string;
  color: string;
  bornAt: number;
  ttl: number;
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
const LASER_BEAM_LENGTH = 520;
const LASER_BEAM_CORE = 15;
const LASER_BEAM_GLOW = 38;
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
   * W2-FX-1：表现入口统一由 BattlePresentationController 调用，本模块只负责「画」。
   * 以下方法均为纯表现（不决定 Gameplay / 不触发伤害）。
   */

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
    const color = damageFeedbackColors(ev.damageSource).number;
    const now = this.now();
    const view = this.damageAggregator.feed(ev, now);
    if (view.isNewGroup) {
      // 新组：立即新建浮动数字（不延迟 → 单发武器即时显示）
      const fx: FloatingText = {
        x: view.x,
        y: view.y,
        text: `-${view.accumulatedDamage}`,
        color,
        bornAt: now,
        ttl: DAMAGE_NUMBER_TTL_MS,
      };
      this.fx.push(fx);
      this.damageGroupFx.set(view.groupKey, fx);
      return;
    }
    // 合并进当前组：累计真实伤害 + 跟随最新 contactPoint（原地更新，不新建）
    const fx = this.damageGroupFx.get(view.groupKey);
    if (fx) {
      fx.text = `-${view.accumulatedDamage}`;
      fx.x = view.x;
      fx.y = view.y;
    } else {
      // 防御：聚合器判定为合并但本地无浮动数字引用（理论上不会）→ 退回新建
      const fxNew: FloatingText = {
        x: view.x,
        y: view.y,
        text: `-${view.accumulatedDamage}`,
        color,
        bornAt: now,
        ttl: DAMAGE_NUMBER_TTL_MS,
      };
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
    ctx.clearRect(0, 0, this.viewWidth, this.viewHeight);

    // 背景
    ctx.fillStyle = '#14181f';
    ctx.fillRect(0, 0, this.viewWidth, this.viewHeight);

    const snap = orchestrator.getRenderSnapshot();
    const arena = snap.arena;
    const t = this.transform;
    // W2-FX-2：表现时间基准（阶段闪烁 / 死亡淡出 / FX 共用）
    const now = this.now();

    // Ground
    ctx.fillStyle = '#2a2f38';
    ctx.fillRect(
      t.offsetX,
      this.sy(arena.groundY),
      this.ss(arena.width),
      this.canvas.height - this.sy(arena.groundY),
    );
    ctx.strokeStyle = '#4a5260';
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
        // 预高亮：橙红描边 + 闪烁（不画刺，刺墙尚未「进入」）
        const blink = 0.45 + 0.35 * Math.sin(now * 0.012);
        ctx.globalAlpha = blink;
        this.strokeShape(cw, '#e8a33c');
        ctx.globalAlpha = 1;
      } else if (arenaPhase === 'Closing') {
        // 正式进入：亮红填充 + 朝 arena 内部的锯齿尖刺 + 脉动描边
        const pulse = 0.85 + 0.15 * Math.sin(now * 0.01);
        this.drawShape(cw, '#c0403a');
        this.drawSpikes(cw, '#c0403a', now);
        ctx.globalAlpha = pulse;
        this.strokeShape(cw, '#ff8a70');
        ctx.globalAlpha = 1;
      }
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
    for (const f of this.fx) {
      const age = (now - f.bornAt) / f.ttl;
      ctx.globalAlpha = 1 - age;
      ctx.fillStyle = f.color;
      ctx.font = `bold ${Math.max(14, this.ss(22))}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(f.text, this.sx(f.x), this.sy(f.y) - age * this.ss(40));
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

    // W2-FX-1/2：命中火花（接触点短暂小圆；hazard 用红色刺伤色）
    this.sparks = this.sparks.filter((s) => now - s.bornAt < s.ttl);
    for (const s of this.sparks) {
      const age = (now - s.bornAt) / s.ttl;
      ctx.globalAlpha = 1 - age;
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(this.sx(s.x), this.sy(s.y), this.ss(3 + age * 2), 0, Math.PI * 2);
      ctx.fill();
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
      ctx.fillStyle = p > 0.85 ? '#fff2b8' : p > 0.5 ? '#ffd35a' : '#6fa8ff';
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
    // 盘体描边
    ctx.strokeStyle = '#0d0f14';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, rInner, 0, Math.PI * 2);
    ctx.stroke();
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
    ctx.strokeStyle = '#0d0f14';
    ctx.lineWidth = 1.5;
    ctx.stroke();
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
        const cx = this.sx(p.center.x);
        const cy = this.sy(p.center.y);
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
      ctx.fillStyle = p.team === 'A' ? PROJECTILE_COLOR_A : PROJECTILE_COLOR_B;
      ctx.beginPath();
      ctx.arc(this.sx(p.center.x), this.sy(p.center.y), this.ss(p.radius), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#0d0f14';
      ctx.lineWidth = 1.5;
      ctx.stroke();
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
      const sx1 = this.sx(b.x + b.dirX * b.length);
      const sy1 = this.sy(b.y + b.dirY * b.length);
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
    const isCompact = isCompactLandscape(this.viewWidth / this.viewDpr, this.viewHeight / this.viewDpr);
    if (fit === 'previewSolo') {
      if (isCompact) {
        // F-UX-3A：envelopeBounds（Body+Wheels+Functional Parts）自适应 padding——
        // 完整车辆外廓必须不进入右侧 panelRect（scale 适配 envelope 即整辆车落在
        // vehicleRect 内）；core（车身主体）自然更小（层级：完整 > 主体）。
        const env = this.vehicleBounds(snap.vehicleA, true);
        const ew = Math.max(1, env.maxX - env.minX);
        const eh = Math.max(1, env.maxY - env.minY);
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
    // ground anchor：保证地面线在 y 范围内
    acc(snap.arena.groundY, snap.arena.groundY);
    if (fit === 'battle') {
      // Q08-A-FIX：正式战斗按 phase 构图——Active/Warning 固定战斗走廊（corridor，
      // 不绑定开局瞬间车辆位置）；Closing/End 完整收束安全构图。
      // 仅 Battle start / phase 切换 / resize 时调用一次，运行期间不重算（无呼吸/无跟随）。
      // F-WX-8-C：compact 手机横屏用 Mobile corridor——Active 战斗主体优先（收窄到
      // 真实交战区 [300,1340]，开局 A(400)/B(1200) 完整可见，车辆占屏 ~21% vs 旧 ~17%）；
      // Warning 场地规则优先（完整 arena + closing 墙，刺墙提示可见）；Desktop 语义不变。
      if (phase === 'Active' || phase === '') {
        if (isCompact) {
          const cL = MOBILE_ACTIVE_MIN_X;
          const cR = MOBILE_ACTIVE_MAX_X;
          acc(cL, snap.arena.groundY - CORRIDOR_HEIGHT);
          acc(cL, snap.arena.groundY);
          acc(cR, snap.arena.groundY - CORRIDOR_HEIGHT);
          acc(cR, snap.arena.groundY);
        } else {
          // Active：固定 corridor = 左界 spawn 预算（width×0.25 − ACTIVE_EXTENT）、
          // 右界锚定 arena 右缘（width − CORRIDOR_EDGE_PAD）——A 顶推 B 的交战团
          // 最终可达 arena 右墙内侧（Q08-CAM-D1 实测 B visual 右缘 1534），
          // 对称 spawn 预算无法覆盖；纵向仅车辆活动高度 + 地面。
          const cL = snap.arena.width * CORRIDOR_SPAWN_A_RATIO - CORRIDOR_ACTIVE_EXTENT;
          const cR = snap.arena.width - CORRIDOR_EDGE_PAD;
          acc(cL, snap.arena.groundY - CORRIDOR_HEIGHT);
          acc(cL, snap.arena.groundY);
          acc(cR, snap.arena.groundY - CORRIDOR_HEIGHT);
          acc(cR, snap.arena.groundY);
        }
      } else if (phase === 'Warning') {
        if (isCompact) {
          // Mobile Warning：场地规则优先——完整 arena + closing 墙，刺墙收束提示可见
          acc(0, snap.arena.groundY);
          acc(snap.arena.width, snap.arena.groundY);
          for (const cw of snap.arena.closingWalls) includeShape(cw);
        } else {
          // Warning：左界再外扩（逐步准备 Closing）；右界已锚定 arena 边界。
          const cL =
            snap.arena.width * CORRIDOR_SPAWN_A_RATIO -
            CORRIDOR_ACTIVE_EXTENT -
            CORRIDOR_WARNING_SPREAD;
          const cR = snap.arena.width - CORRIDOR_EDGE_PAD;
          acc(cL, snap.arena.groundY - CORRIDOR_HEIGHT);
          acc(cL, snap.arena.groundY);
          acc(cR, snap.arena.groundY - CORRIDOR_HEIGHT);
          acc(cR, snap.arena.groundY);
        }
      } else {
        // Closing / End：完整战场安全构图——覆盖 Arena 有效战斗区域（x ∈ [0, width]；
        // y 顶 = Closing 墙顶，底 = 地面），车辆被 Closing 推向边缘/中央的全过程始终
        // 入画；墙体外很远的无效空间不纳入（W1-P0-CLOSE-FIX 原语义）。End 保持此构图，
        // 不二次 zoom。
        acc(0, snap.arena.groundY);
        acc(snap.arena.width, snap.arena.groundY);
        for (const cw of snap.arena.closingWalls) includeShape(cw);
      }
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
    // F-UX-3B：compact Mobile battle Active 薄地面构图——Ground 只改视觉厚度
    // （Physics ground 不动）：内容底部锚定（车辆站在地面上）、insetBottom 缩小、
    // groundY 下方多留 48 world（配合 scale → 地面占屏 ~12~16%）；仅 Active 固定构图。
    const compactBattleActive = fit === 'battle' && isCompact && (phase === 'Active' || phase === '');
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
    // 注意：view-space 为物理 px（surface 或 canvas 像素），inset 值 ×viewDpr 换算回逻辑 px。
    const insetX = isCompact ? (fit === 'battle' ? 0 : isFixed ? 8 : SAFE_INSET_X) : SAFE_INSET_X;
    const insetTop = isFixed
      ? isCompact
        ? Math.round(52 * this.viewDpr)
        : 70
      : isCompact
        ? Math.round(56 * this.viewDpr)
        : SAFE_INSET_Y;
    const insetBottom = isFixed
      ? isCompact
        ? Math.round(110 * this.viewDpr) // F-WX-8-B：新三层 Dock 两行 ~100px
        : 160
      : isCompact
        ? compactBattleActive
          ? Math.round(12 * this.viewDpr) // F-UX-3B：薄地面构图（地面占屏 12~16%）
          : Math.round(40 * this.viewDpr)
        : SAFE_INSET_Y;
    // F-WX-UI-1：framingRect（viewport logical 子区域）存在时，固定预览框 fit 到该区域
    // 内的安全区（rect 已含布局留白，内部仅留小边距）——Mobile Garage 车辆 fit 到左侧
    // 展示区；无 framingRect → 全屏安全区逻辑（Desktop 零影响）。
    const framing = opts.framingRect;
    let baseX: number;
    let baseY: number;
    let safeW: number;
    let safeH: number;
    if (framing && isFixed) {
      const pad = 6 * this.viewDpr;
      const fx = framing.x * this.viewDpr;
      const fy = framing.y * this.viewDpr;
      const fw = framing.w * this.viewDpr;
      const fh = framing.h * this.viewDpr;
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
    if (scale < MIN_CONTENT_SCALE) scale = MIN_CONTENT_SCALE;
    if (scale > MAX_CONTENT_SCALE) scale = MAX_CONTENT_SCALE;
    // 内容定位：默认居中于安全区中心（offset 含安全区内缩量；玩家 Shell 预览用 top 内缩）。
    // F-UX-3B：compact battle Active 底部锚定——车辆站在地面上（Ground 只改视觉厚度，
    // 不居中留上下空隙；顶部的空间全部还给战斗主体）。
    const offsetX = baseX + (safeW - bw * scale) / 2 - minX * scale;
    const offsetY = compactBattleActive
      ? baseY + (safeH - bh * scale) - minY * scale
      : baseY + (safeH - bh * scale) / 2 - minY * scale;
    this.transform = { scale, offsetX, offsetY };
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
   * 引擎中立形状绘制：discriminated union（polygons / circle），不依赖 Matter Body。
   * circle 真实绘制圆弧（不近似为多边形）；polygons 逐多边形描边（沿用 Matter 视觉语义）。
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
      ctx.strokeStyle = '#0d0f14';
      ctx.lineWidth = 1.5;
      ctx.stroke();
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
      ctx.strokeStyle = '#0d0f14';
      ctx.lineWidth = 1.5;
      ctx.stroke();
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
