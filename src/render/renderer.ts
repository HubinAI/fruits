/**
 * Renderer：只消费引擎中立 Render Snapshot（BattleRenderSnapshot）。
 * 表现 Sprite / FX / Hit 反馈 / Damage 数字。
 * 禁止 Renderer 决定 Gameplay；不依赖任何具体物理引擎（Matter / Planck / adapter）。
 */
import type { CombatEvent } from '../battle/combatEvents';
import type {
  BattleOrchestratorApi,
  BattleRenderSnapshot,
  RenderVehicle,
  RenderShape,
  RenderCircle,
  RenderProjectile,
} from '../battle/battleContract';

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
/** 构图安全区：左右 UI 阴影区不计入可用画布（CSS px，每侧内缩量） */
const SAFE_INSET_X = 56;
const SAFE_INSET_Y = 28;

/** 取景模式：vehicles=含 A+B 完整入画；primary-fire=A 偏左中部 + 身后 recoil 空间 + 前方固定射击空间（Cannon-Recoil / Cannon-Angle 共用） */
export type CameraFit = 'vehicles' | 'primary-fire';

interface FloatingText {
  x: number;
  y: number;
  text: string;
  color: string;
  bornAt: number;
  ttl: number;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private transform: ScreenTransform = { scale: 1, offsetX: 0, offsetY: 0 };
  private fx: FloatingText[] = [];
  /** 命中闪白：保存 target team + 时间，绘制时取当前 Snapshot 对应车辆形状（不再保存 Matter Body） */
  private hitFlashes: Array<{ team: string; bornAt: number; ttl: number }> = [];

  constructor(private canvas: HTMLCanvasElement) {
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

  /** 订阅 Combat Event → 生成 FX（仅保存 team，绘制时取当前 Snapshot） */
  bind(orchestrator: BattleOrchestratorApi): void {
    orchestrator.onCombatEvent((ev: CombatEvent) => {
      if (ev.damage > 0) {
        this.fx.push({
          x: ev.contactPoint.x,
          y: ev.contactPoint.y,
          text: `-${Math.round(ev.damage)}`,
          color: ev.damageSource === 'weapon' ? '#ff5a4e' : '#ffb84e',
          bornAt: performance.now(),
          ttl: 900,
        });
      }
      // 命中闪白：保存 target team，绘制时取当前 Snapshot 对应车辆形状
      this.hitFlashes.push({ team: ev.target, bornAt: performance.now(), ttl: 120 });
    });
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

    // Closing walls（Hazard）
    for (const cw of arena.closingWalls) {
      this.drawShape(cw, '#7a2f2f');
    }

    // Vehicles
    this.drawVehicle(snap.vehicleA, '#4aa3ff');
    this.drawVehicle(snap.vehicleB, '#ff7a4a');

    // Projectiles（Q02-C3B）：只消费 Snapshot；车辆之后、FX 之前，避免被车体完全遮住。
    // projectiles 缺省 undefined → 空绘制，Matter 画面不变。
    this.drawProjectiles(snap.projectiles ?? []);

    // Debug overlay
    if (debugDraw) debugDraw(ctx, t);

    // FX
    const now = performance.now();
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
      const age = (now - h.bornAt) / h.ttl;
      ctx.globalAlpha = (1 - age) * 0.7;
      ctx.fillStyle = '#ffffff';
      const v = h.team === snap.vehicleA.team ? snap.vehicleA : snap.vehicleB;
      this.drawShape(v.body, '#ffffff');
      ctx.globalAlpha = 1;
    }
  }

  private drawVehicle(v: RenderVehicle, color: string): void {
    // 车身
    this.drawShape(v.body, color);
    // 车轮
    for (const w of v.wheels) {
      this.drawWheel(w, '#888c96');
    }
    // 功能部件
    for (const p of v.parts) {
      this.drawShape(p.shape, p.category === 'weapon' ? '#d8d2c0' : '#9aa4b5');
    }
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
   *   （默认 520 世界 px）固定射击空间——Cannon-Recoil / Cannon-Angle 共用此套。
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
    if (fit === 'primary-fire') {
      includeVehicle(snap.vehicleA);
      // 身后明确 recoil 空间 + 前方固定射击空间（A 朝 +X 发射方向）
      minX -= recoilExtent;
      maxX += forwardExtent;
    } else {
      includeVehicle(snap.vehicleA);
      includeVehicle(snap.vehicleB);
    }
    // Projectile 永不参与 camera bounds
    if (!isFinite(minX) || !isFinite(minY) || maxX - minX < 1 || maxY - minY < 1) return;
    const m = CONTENT_MARGIN_WORLD;
    minX -= m; maxX += m; minY -= m; maxY += m;
    // 地面表面留出可见区域
    if (maxY < snap.arena.groundY + 40) maxY = snap.arena.groundY + 40;
    const bw = maxX - minX, bh = maxY - minY;
    const cw = this.canvas.clientWidth, ch = this.canvas.clientHeight;
    if (cw < 2 || ch < 2) return;
    // R2：可用画布 = 中央实际战斗可视区域（扣除左右 UI 阴影区）
    const safeW = Math.max(2, cw - SAFE_INSET_X * 2);
    const safeH = Math.max(2, ch - SAFE_INSET_Y * 2);
    let scale = Math.min(safeW / bw, safeH / bh) * CONTENT_ZOOM;
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
}
