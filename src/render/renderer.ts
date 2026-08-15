/**
 * Renderer：只消费 Runtime 结果（Physics Transform / Part State / Combat Event）。
 * 表现 Sprite / FX / Hit 反馈 / Damage 数字。
 * 禁止 Renderer 决定 Gameplay。
 */
import type { Body } from 'matter-js';
import type { BattleOrchestrator } from '../battle/battleOrchestrator';
import type { Vehicle } from '../battle/vehicleAssembly';
import type { CombatEvent } from '../battle/combatEvents';
import { getPosition, getAngle } from '../physics/adapter';

interface ScreenTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

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
  private hitFlashes: Array<{ body: Body; bornAt: number; ttl: number }> = [];

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
      );
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

  /** 订阅 Combat Event → 生成 FX */
  bind(orchestrator: BattleOrchestrator): void {
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
      // 命中闪白：找到 target 车辆 body
      const targetBody =
        orchestrator.vehicleA.team === ev.target
          ? orchestrator.vehicleA.body
          : orchestrator.vehicleB.body;
      this.hitFlashes.push({ body: targetBody, bornAt: performance.now(), ttl: 120 });
    });
  }

  render(orchestrator: BattleOrchestrator, debugDraw?: (ctx: CanvasRenderingContext2D, t: ScreenTransform) => void): void {
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);

    // 背景
    ctx.fillStyle = '#14181f';
    ctx.fillRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);

    const arena = orchestrator.arena;
    const t = this.transform;

    // Ground
    ctx.fillStyle = '#2a2f38';
    ctx.fillRect(
      t.offsetX,
      this.sy(arena.config.groundY),
      this.ss(arena.config.width),
      this.canvas.height - this.sy(arena.config.groundY),
    );
    ctx.strokeStyle = '#4a5260';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(t.offsetX, this.sy(arena.config.groundY));
    ctx.lineTo(this.ss(arena.config.width) + t.offsetX, this.sy(arena.config.groundY));
    ctx.stroke();

    // Walls
    for (const wall of [arena.leftWall, arena.rightWall]) {
      this.drawBody(wall, '#3a4150');
    }

    // Closing walls（Hazard）
    for (const cw of arena.closingWalls) {
      this.drawBody(cw.body, '#7a2f2f');
    }

    // Vehicles
    this.drawVehicle(orchestrator.vehicleA, '#4aa3ff');
    this.drawVehicle(orchestrator.vehicleB, '#ff7a4a');

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
      this.drawBody(h.body, '#ffffff');
      ctx.globalAlpha = 1;
    }
  }

  private drawVehicle(v: Vehicle, color: string): void {
    // 车身
    this.drawBody(v.body, color);
    // 车轮
    for (const w of v.wheels) {
      this.drawWheel(w.body, v.body ? '#888c96' : '#888c96');
    }
    // 功能部件
    for (const p of v.parts) {
      this.drawBody(p.body, p.def.category === 'weapon' ? '#d8d2c0' : '#9aa4b5');
    }
  }

  private drawWheel(body: Body, color: string): void {
    const ctx = this.ctx;
    const r = body.circleRadius ?? 10;
    const pos = getPosition(body);
    ctx.fillStyle = '#22262e';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(this.sx(pos.x), this.sy(pos.y), this.ss(r), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // 轮辐（显示旋转）
    const a = getAngle(body);
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(this.sx(pos.x), this.sy(pos.y));
    ctx.lineTo(this.sx(pos.x + Math.cos(a) * r), this.sy(pos.y + Math.sin(a) * r));
    ctx.stroke();
  }

  private drawBody(body: Body, color: string): void {
    const ctx = this.ctx;
    const parts = body.parts.length > 0 ? body.parts : [body];
    for (const part of parts) {
      const verts = part.vertices;
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
