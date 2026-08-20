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
/** W2-UX-R2：装配 Preview 近距构图（明显放大，优先看清 Body 与 Functional 部件） */
const PREVIEW_MARGIN_WORLD = 18;
const PREVIEW_ZOOM = 1.9;
/** 构图安全区：左右 UI 阴影区不计入可用画布（CSS px，每侧内缩量） */
const SAFE_INSET_X = 56;
const SAFE_INSET_Y = 28;

/**
 * 取景模式：
 * - vehicles：含 A+B 完整入画（编辑 Preview 构图）；
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

/** 炮口闪光（W2-FX-1）：开火点短暂亮圆 */
interface MuzzleFlash {
  x: number;
  y: number;
  bornAt: number;
  ttl: number;
}

/** 死亡 FX（W2-FX-1）：按 team 记录，绘制时取当前 Snapshot 车辆位置（与 hitFlashes 同模式） */
interface DeathFx {
  team: string;
  bornAt: number;
  ttl: number;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private transform: ScreenTransform = { scale: 1, offsetX: 0, offsetY: 0 };
  private fx: FloatingText[] = [];
  /** 命中闪白：保存 target team + 时间，绘制时取当前 Snapshot 对应车辆形状（不再保存 Matter Body） */
  private hitFlashes: Array<{ team: string; bornAt: number; ttl: number }> = [];
  private sparks: Spark[] = [];
  private muzzleFlashes: MuzzleFlash[] = [];
  private deathFxs: DeathFx[] = [];

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
   * W2-FX-1：表现入口统一由 BattlePresentationController 调用，本模块只负责「画」。
   * 以下方法均为纯表现（不决定 Gameplay / 不触发伤害）。
   */

  /** 伤害数字（统一入口：所有伤害数字都经此加入同一数字池，复用现有绘制） */
  spawnDamageNumber(x: number, y: number, text: string, color: string): void {
    this.fx.push({ x, y, text, color, bornAt: performance.now(), ttl: 900 });
  }

  /** 命中闪白：目标车辆形状短暂闪白（绘制时取当前 Snapshot） */
  spawnHitFlash(team: string): void {
    this.hitFlashes.push({ team, bornAt: performance.now(), ttl: 120 });
  }

  /** 命中火花：接触点短暂小圆（W2-FX-2 按 damageSource 区分颜色，缺省黄） */
  spawnSpark(x: number, y: number, color = '#ffd35a'): void {
    this.sparks.push({ x, y, color, bornAt: performance.now(), ttl: 220 });
  }

  /** 炮口闪光：开火点短暂亮圆（真实 muzzle worldPosition） */
  spawnMuzzleFlash(x: number, y: number): void {
    this.muzzleFlashes.push({ x, y, bornAt: performance.now(), ttl: 90 });
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
      // W2-FX-2：已死亡（淡出中/已消失）车辆不叠加闪白
      if (vehicleDeathAlpha(this.deathFxs, h.team, now) === null) continue;
      const age = (now - h.bornAt) / h.ttl;
      ctx.globalAlpha = (1 - age) * 0.7;
      ctx.fillStyle = '#ffffff';
      const v = h.team === snap.vehicleA.team ? snap.vehicleA : snap.vehicleB;
      this.drawShape(v.body, '#ffffff');
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

    // W2-FX-1：炮口闪光（开火点短暂亮圆）
    this.muzzleFlashes = this.muzzleFlashes.filter((m) => now - m.bornAt < m.ttl);
    for (const m of this.muzzleFlashes) {
      const age = (now - m.bornAt) / m.ttl;
      ctx.globalAlpha = 1 - age;
      ctx.fillStyle = '#ffe9a8';
      ctx.beginPath();
      ctx.arc(this.sx(m.x), this.sy(m.y), this.ss(6 + age * 10), 0, Math.PI * 2);
      ctx.fill();
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
      } else {
        this.drawShape(p.shape, p.category === 'weapon' ? '#d8d2c0' : '#9aa4b5');
      }
      // Q04-R1B：真实 Joint 连接件（Push Rod 伸缩轴）——画在移动 collider 后方，
      // 连接车身锚点 from → 部件原点 to；仅消费 snapshot 真实世界坐标，无假动画。
      if (p.connector) this.drawConnector(p.connector, '#9aa4b5');
    }
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
   */
  private drawProjectiles(projectiles: readonly RenderProjectile[]): void {
    const ctx = this.ctx;
    for (const p of projectiles) {
      ctx.fillStyle = p.team === 'A' ? PROJECTILE_COLOR_A : PROJECTILE_COLOR_B;
      ctx.beginPath();
      ctx.arc(this.sx(p.center.x), this.sy(p.center.y), this.ss(p.radius), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#0d0f14';
      ctx.lineWidth = 1.5;
      ctx.stroke();
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
   * - fit 'preview'（W2-UX-R2）：装配 Preview 近距放大——A+B 进画面但边距更小、
   *   zoom 更大，优先看清 Body 与 Functional 部件；只用于 Editing，不影响正式 Battle。
   *
   * 内容退化时回退到现有 transform（resize 设置的 arena 框）。
   */
  reframe(
    snap: BattleRenderSnapshot,
    fit: CameraFit = 'vehicles',
    opts: { forwardExtent?: number; recoilExtent?: number } = {},
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
    const includeVehicle = (v: RenderVehicle): void => {
      includeShape(v.body);
      for (const w of v.wheels) {
        acc(w.center.x - w.radius, w.center.y - w.radius);
        acc(w.center.x + w.radius, w.center.y + w.radius);
      }
      for (const p of v.parts) includeShape(p.shape);
    };
    // ground anchor：保证地面线在 y 范围内
    acc(snap.arena.groundY, snap.arena.groundY);
    if (fit === 'battle') {
      // W1-P0-CLOSE-FIX：正式战斗固定战场——覆盖 Arena 有效战斗区域
      // （x ∈ [0, width]；y 顶 = Closing 墙顶，底 = 地面），车辆被 Closing 推向
      // 边缘/中央的全过程始终入画；墙体外很远的无效空间不纳入。
      acc(0, snap.arena.groundY);
      acc(snap.arena.width, snap.arena.groundY);
      for (const cw of snap.arena.closingWalls) includeShape(cw);
    } else if (fit === 'primary-fire') {
      includeVehicle(snap.vehicleA);
      // 身后明确 recoil 空间 + 前方固定射击空间（A 朝 +X 发射方向）
      minX -= recoilExtent;
      maxX += forwardExtent;
    } else if (fit === 'preview') {
      // W2-UX-R2：装配 Preview 近距放大（A+B；小边距 + 大 zoom 由下方分支处理）
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
    let scale =
      Math.min(safeW / bw, safeH / bh) * (isPreview ? PREVIEW_ZOOM : CONTENT_ZOOM);
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
