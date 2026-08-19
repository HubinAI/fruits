/**
 * Renderer：只消费引擎中立 Render Snapshot（BattleRenderSnapshot）。
 * 表现 Sprite / FX / Hit 反馈 / Damage 数字。
 * 禁止 Renderer 决定 Gameplay；不依赖任何具体物理引擎（Matter / Planck / adapter）。
 */
import type { CombatEvent } from '../battle/combatEvents';
import type {
  BattleOrchestratorApi,
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
