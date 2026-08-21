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
  RenderConnector,
  RenderVisual,
} from '../battle/battleContract';
import { VisualRegistry } from './visualRegistry';
import { vehicleDeathAlpha } from '../presentation/battlePhaseFx';

/** Projectile 颜色（Q02-C3B）：A/B 可明显区分（与车身蓝/橙区分，更亮） */
export const PROJECTILE_COLOR_A = '#7de8ff';
export const PROJECTILE_COLOR_B = '#ffd05a';

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
export type CameraFit = 'vehicles' | 'primary-fire' | 'battle' | 'preview';

interface FloatingText {
  x: number;
  y: number;
  text: string;
  color: string;
  bornAt: number;
  ttl: number;
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
const LASER_BEAM_LENGTH = 520;
const LASER_BEAM_CORE = 15;
const LASER_BEAM_GLOW = 38;
const LASER_BEAM_TTL = 130; // ms：30fps 下 ≈ 3.9 帧，可读 3~4 帧

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private transform: ScreenTransform = { scale: 1, offsetX: 0, offsetY: 0 };
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

  constructor(
    private canvas: HTMLCanvasElement,
    /** W2-VIS-1：Sprite Visual Registry（缺省空注册表 → 全 Collider 灰盒 fallback，行为与旧版一致） */
    private readonly visualRegistry: VisualRegistry = new VisualRegistry(),
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D not supported');
    this.ctx = ctx;
  }

  resize(arenaW: number, arenaH: number): void {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = this.canvas.clientWidth * dpr;
    this.canvas.height = this.canvas.clientHeight * dpr;
    const scale =
      Math.min(
        this.canvas.width / arenaW,
        this.canvas.height / arenaH,
      ) * VIEW_ZOOM;
    this.transform = {
      scale,
      offsetX: (this.canvas.width - arenaW * scale) / 2,
      offsetY: (this.canvas.height - arenaH * scale) / 2,
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
   * W2-FX-1：表现入口统一由 BattlePresentationController 调用，本模块只负责「画」。
   * 以下方法均为纯表现（不决定 Gameplay / 不触发伤害）。
   */

  /** 伤害数字（统一入口：所有伤害数字都经此加入同一数字池，复用现有绘制） */
  spawnDamageNumber(x: number, y: number, text: string, color: string): void {
    this.fx.push({ x, y, text, color, bornAt: performance.now(), ttl: 900 });
  }

  /** 命中闪白：目标车辆形状短暂描边反馈（绘制时取当前 Snapshot）
   *  Q08-C：同一 team 同时最多一个表现状态——新命中刷新（重置 bornAt），
   *  不 push 多层叠加（纯表现层，不影响真实命中次数/伤害）。 */
  spawnHitFlash(team: string): void {
    const now = performance.now();
    const existing = this.hitFlashes.find((h) => h.team === team);
    if (existing) {
      existing.bornAt = now;
    } else {
      this.hitFlashes.push({ team, bornAt: now, ttl: 120 });
    }
  }

  /** 命中火花：接触点短暂小圆（W2-FX-2 按 damageSource 区分颜色，缺省黄） */
  spawnSpark(x: number, y: number, color = '#ffd35a'): void {
    this.sparks.push({ x, y, color, bornAt: performance.now(), ttl: 220 });
  }

  /** 炮口闪光：开火点短暂亮圆（真实 muzzle worldPosition）。
   *  color/radius 可选——Cannon 用默认橙黄小闪；laser 用白青大闪（Q11-C-R3-FINAL）。 */
  spawnMuzzleFlash(x: number, y: number, color = '#ffe9a8', radius = 6): void {
    this.muzzleFlashes.push({ x, y, bornAt: performance.now(), ttl: 90, color, radius });
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
      bornAt: performance.now(),
      ttl: LASER_BEAM_TTL,
    });
  }

  /** Q11-C-R3-FINAL：当前存活的镭射巨炮束（供测试断言几何 / 存活）；过期自动过滤。 */
  get activeLaserBeams(): readonly LaserBeam[] {
    const now = performance.now();
    return this.laserBeams.filter((b) => now - b.bornAt < b.ttl);
  }

  /** Q11-C：蓄能光点——laser 蓄能期间每固定步 upsert（同 partId 更新 progress）。
   *  纯表现（肉眼可见「大招要来了」）；不参与伤害/命中判定。 */
  spawnCharge(key: string, x: number, y: number, progress: number): void {
    const existing = this.charges.find((c) => c.key === key);
    if (existing) {
      existing.x = x;
      existing.y = y;
      existing.progress = progress;
      existing.lastAt = performance.now();
    } else {
      this.charges.push({ key, x, y, progress, lastAt: performance.now() });
    }
  }

  /** Q11-C：蓄能结束（发射）→ 清除该部件光点 */
  clearCharge(key: string): void {
    this.charges = this.charges.filter((c) => c.key !== key);
  }

  /** 死亡 FX：目标车辆位置短暂扩散环（绘制时取当前 Snapshot） */
  spawnDeathFx(team: string): void {
    this.deathFxs.push({ team, bornAt: performance.now(), ttl: 500 });
  }

  render(
    orchestrator: BattleOrchestratorApi,
    debugDraw?: (ctx: CanvasRenderingContext2D, t: ScreenTransform) => void,
  ): void {
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);

    // 背景
    ctx.fillStyle = '#14181f';
    ctx.fillRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);

    const snap = orchestrator.getRenderSnapshot();
    const arena = snap.arena;
    const t = this.transform;
    // W2-FX-2：表现时间基准（阶段闪烁 / 死亡淡出 / FX 共用）
    const now = performance.now();

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

    // Vehicles（W2-FX-2 死亡表现：淡出 alpha → 消失后跳过绘制；未死亡正常绘制）
    // 手动管理 globalAlpha（不复用 ctx.save/restore，保持与既有 canvas stub 兼容）
    const aAlpha = vehicleDeathAlpha(this.deathFxs, snap.vehicleA.team, now);
    const bAlpha = vehicleDeathAlpha(this.deathFxs, snap.vehicleB.team, now);
    if (aAlpha !== null) {
      ctx.globalAlpha = aAlpha;
      this.drawVehicle(snap.vehicleA, '#4aa3ff');
      ctx.globalAlpha = 1;
    }
    if (bAlpha !== null) {
      ctx.globalAlpha = bAlpha;
      this.drawVehicle(snap.vehicleB, '#ff7a4a');
      ctx.globalAlpha = 1;
    }

    // Projectiles（Q02-C3B）：只消费 Snapshot；车辆之后、FX 之前，避免被车体完全遮住。
    // projectiles 缺省 undefined → 空绘制，Matter 画面不变。
    this.drawProjectiles(snap.projectiles ?? []);

    // Q11-C-R3-FINAL：镭射巨炮束 VFX（发射后沿 fire 方向驻留 ~130ms 衰减；纯表现）
    this.drawLaserBeams();

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
    // 中心轮毂
    ctx.fillStyle = '#3a4150';
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0d0f14';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // 径向标记线（清楚显示旋转方向/速度）
    ctx.strokeStyle = '#0d0f14';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * r * 0.8, cy + Math.sin(a) * r * 0.8);
    ctx.stroke();
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
      ctx.fillStyle = p.team === 'A' ? PROJECTILE_COLOR_A : PROJECTILE_COLOR_B;
      ctx.beginPath();
      ctx.arc(this.sx(p.center.x), this.sy(p.center.y), this.ss(p.radius), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#0d0f14';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  /**
   * Q11-C-R3-FINAL：镭射巨炮束 VFX——发射后沿真实 fire 方向固定驻留 ~130ms
   * 再快速衰减（让 30fps 正常录像能看清「巨炮释放」）。纯表现：不参与碰撞/
   * 伤害；真实 Collider / 命中范围绝不扩大。
   */
  private drawLaserBeams(): void {
    const ctx = this.ctx;
    const now = performance.now();
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
    opts: { forwardExtent?: number; recoilExtent?: number; phase?: string } = {},
  ): void {
    const forwardExtent = opts.forwardExtent ?? 520;
    const recoilExtent = opts.recoilExtent ?? 180;
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
    // ground anchor：保证地面线在 y 范围内
    acc(snap.arena.groundY, snap.arena.groundY);
    if (fit === 'battle') {
      // Q08-A-FIX：正式战斗按 phase 构图——Active/Warning 固定战斗走廊（corridor，
      // 不绑定开局瞬间车辆位置）；Closing/End 完整收束安全构图。
      // 仅 Battle start / phase 切换 / resize 时调用一次，运行期间不重算（无呼吸/无跟随）。
      const phase = opts.phase ?? '';
      if (phase === 'Active' || phase === '') {
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
      } else if (phase === 'Warning') {
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
      includeVehicle(snap.vehicleB);
    } else {
      includeVehicle(snap.vehicleA);
      includeVehicle(snap.vehicleB);
    }
    // Projectile 永不参与 camera bounds
    if (!isFinite(minX) || !isFinite(minY) || maxX - minX < 1 || maxY - minY < 1) return;
    const isPreview = fit === 'preview';
    const m = isPreview ? PREVIEW_MARGIN_WORLD : CONTENT_MARGIN_WORLD;
    minX -= m; maxX += m; minY -= m; maxY += m;
    // 地面表面留出可见区域
    if (maxY < snap.arena.groundY + 40) maxY = snap.arena.groundY + 40;
    const bw = maxX - minX, bh = maxY - minY;
    const cw = this.canvas.clientWidth, ch = this.canvas.clientHeight;
    if (cw < 2 || ch < 2) return;
    // R2：可用画布 = 中央实际战斗可视区域（扣除左右 UI 阴影区）
    const safeW = Math.max(2, cw - SAFE_INSET_X * 2);
    const safeH = Math.max(2, ch - SAFE_INSET_Y * 2);
    // Q06-UX-R2-FIX / Q08-A-FIX：声明「完整入画」的 fit（preview / battle）直接取
    // fitLimit——任何 >1 的乘数（旧 ×1.9、×1.05）都会使含 margin 的内容超出
    // safeW×safeH 被左右裁切，破坏完整入画硬约束。preview 的明显放大来自近距 spawn
    // 收窄 bounds + 更小 margin；battle 的车辆变大来自更合理的 corridor bounds；
    // vehicles / primary-fire / scenario 保持历史 ×CONTENT_ZOOM 语义。
    const fitLimit = Math.min(safeW / bw, safeH / bh);
    const enforceFitLimit = isPreview || fit === 'battle';
    let scale = enforceFitLimit ? fitLimit : fitLimit * CONTENT_ZOOM;
    if (scale < MIN_CONTENT_SCALE) scale = MIN_CONTENT_SCALE;
    if (scale > MAX_CONTENT_SCALE) scale = MAX_CONTENT_SCALE;
    // 内容居中于安全区中心（offset 含安全区内缩量）
    const offsetX = SAFE_INSET_X + (safeW - bw * scale) / 2 - minX * scale;
    const offsetY = SAFE_INSET_Y + (safeH - bh * scale) / 2 - minY * scale;
    this.transform = { scale, offsetX, offsetY };
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
