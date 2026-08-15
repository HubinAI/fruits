/**
 * Debug Overlay：Lab 调试显示 + 时间控制 + Debug Override。
 *
 * Debug / Slow Motion 只用于找原因；最终体验验收必须回到 1x + Debug 关闭。
 * Override 与正式 Content Config 隔离，禁止进入正式游戏数据。
 */
import type { BattleOrchestrator } from '../battle/battleOrchestrator';
import type { Vehicle } from '../battle/vehicleAssembly';
import { getPosition, getVelocity, getAngularVelocity } from '../physics/adapter';

/** Debug 显示开关 */
export interface DebugFlags {
  collider: boolean;
  com: boolean;
  movementHardpoint: boolean;
  functionalHardpoint: boolean;
  groundedWheel: boolean;
  linearVelocity: boolean;
  angularVelocity: boolean;
  contactPoint: boolean;
  contactNormal: boolean;
  impulse: boolean;
  totalMass: boolean;
  inertia: boolean;
  lastImpact: boolean;
  lastDamage: boolean;
}

export const DEFAULT_DEBUG_FLAGS: DebugFlags = {
  collider: false,
  com: true,
  movementHardpoint: true,
  functionalHardpoint: true,
  groundedWheel: true,
  linearVelocity: false,
  angularVelocity: false,
  contactPoint: false,
  contactNormal: false,
  impulse: false,
  totalMass: true,
  inertia: true,
  lastImpact: true,
  lastDamage: true,
};

/** Debug Override：研发临时夸张差异验证方向，与正式 Config 隔离 */
export interface DebugOverrides {
  massScale?: number;
  driveTorqueScale?: number;
  impactThreshold?: number;
  gripScale?: number;
}

export const DEFAULT_OVERRIDES: DebugOverrides = {
  massScale: 1,
  driveTorqueScale: 1,
  gripScale: 1,
};

/** 时间缩放档位 */
export const TIME_SCALES = [1, 0.5, 0.25] as const;

interface ScreenTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

function sx(x: number, t: ScreenTransform): number {
  return x * t.scale + t.offsetX;
}
function sy(y: number, t: ScreenTransform): number {
  return y * t.scale + t.offsetY;
}

function worldPoint(
  body: { position: { x: number; y: number }; angle: number },
  local: { x: number; y: number },
): { x: number; y: number } {
  const cos = Math.cos(body.angle);
  const sin = Math.sin(body.angle);
  return {
    x: body.position.x + local.x * cos - local.y * sin,
    y: body.position.y + local.x * sin + local.y * cos,
  };
}

export function drawDebug(
  ctx: CanvasRenderingContext2D,
  t: ScreenTransform,
  orchestrator: BattleOrchestrator,
  flags: DebugFlags,
): void {
  const drawVehicle = (v: Vehicle, color: string) => {
    // COM
    if (flags.com) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(sx(v.com.x, t), sy(v.com.y, t), 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sx(v.com.x - 10, t), sy(v.com.y, t));
      ctx.lineTo(sx(v.com.x + 10, t), sy(v.com.y, t));
      ctx.moveTo(sx(v.com.x, t), sy(v.com.y - 10, t));
      ctx.lineTo(sx(v.com.x, t), sy(v.com.y + 10, t));
      ctx.stroke();
    }

    // Movement Hardpoint
    if (flags.movementHardpoint) {
      for (const hp of v.resolved.body.movementHardpoints) {
        const p = worldPoint(v.body, hp.localPosition);
        ctx.fillStyle = '#ffd35a';
        ctx.fillRect(sx(p.x, t) - 3, sy(p.y, t) - 3, 6, 6);
      }
    }

    // Functional Hardpoint
    if (flags.functionalHardpoint) {
      for (const hp of v.resolved.body.functionalHardpoints) {
        const p = worldPoint(v.body, hp.localPosition);
        ctx.fillStyle = '#7ad4ff';
        ctx.fillRect(sx(p.x, t) - 3, sy(p.y, t) - 3, 6, 6);
      }
    }

    // Grounded Wheel
    if (flags.groundedWheel) {
      for (const w of v.wheels) {
        const p = getPosition(w.body);
        ctx.fillStyle = w.grounded ? '#3dff7a' : '#ff5a4e';
        ctx.beginPath();
        ctx.arc(sx(p.x, t), sy(p.y + w.def.radius, t), 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Linear Velocity（从 COM 出发的箭头）
    if (flags.linearVelocity) {
      const vel = getVelocity(v.body);
      const p = v.com;
      ctx.strokeStyle = '#7ae0ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx(p.x, t), sy(p.y, t));
      ctx.lineTo(sx(p.x + vel.x * 3, t), sy(p.y + vel.y * 3, t));
      ctx.stroke();
    }

    // Angular Velocity（数值 + 弧线）
    if (flags.angularVelocity) {
      const av = getAngularVelocity(v.body);
      const p = v.com;
      ctx.fillStyle = '#ffb84e';
      ctx.font = '12px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`ω=${av.toFixed(2)}`, sx(p.x + 14, t), sy(p.y - 14, t));
      ctx.strokeStyle = '#ffb84e';
      ctx.beginPath();
      ctx.arc(sx(p.x, t), sy(p.y, t), 16, 0, Math.PI * 2);
      ctx.stroke();
    }
  };

  drawVehicle(orchestrator.vehicleA, '#4aa3ff');
  drawVehicle(orchestrator.vehicleB, '#ff7a4a');

  // Collider 描边
  if (flags.collider) {
    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = 1;
    for (const v of [orchestrator.vehicleA, orchestrator.vehicleB]) {
      for (const b of [v.body, ...v.wheels.map((w) => w.body), ...v.parts.map((p) => p.body)]) {
        const parts = b.parts.length > 0 ? b.parts : [b];
        for (const part of parts) {
          if (part.vertices.length === 0) continue;
          ctx.beginPath();
          ctx.moveTo(sx(part.vertices[0].x, t), sy(part.vertices[0].y, t));
          for (let i = 1; i < part.vertices.length; i++) {
            ctx.lineTo(sx(part.vertices[i].x, t), sy(part.vertices[i].y, t));
          }
          ctx.closePath();
          ctx.stroke();
        }
      }
    }
  }

  const dbg = orchestrator.router.debug;

  // Contact Point / Normal
  if (flags.contactPoint && dbg.lastContact) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(sx(dbg.lastContact.point.x, t), sy(dbg.lastContact.point.y, t), 4, 0, Math.PI * 2);
    ctx.fill();
  }
  if (flags.contactNormal && dbg.lastContact) {
    const p = dbg.lastContact.point;
    const n = dbg.lastContact.normal;
    ctx.strokeStyle = '#ffd35a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx(p.x, t), sy(p.y, t));
    ctx.lineTo(sx(p.x + n.x * 30, t), sy(p.y + n.y * 30, t));
    ctx.stroke();
  }

  // 左上角信息面板
  const panel = (title: string, lines: string[], y: number): number => {
    ctx.fillStyle = 'rgba(10,12,16,0.82)';
    ctx.fillRect(8, y, 260, 20 + lines.length * 16);
    ctx.fillStyle = '#ffd35a';
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(title, 16, y + 18);
    ctx.fillStyle = '#c8d0e0';
    ctx.font = '12px monospace';
    lines.forEach((ln, i) => ctx.fillText(ln, 16, y + 36 + i * 16));
    return y + 20 + lines.length * 16 + 8;
  };

  let py = 8;
  for (const v of [orchestrator.vehicleA, orchestrator.vehicleB]) {
    const lines: string[] = [];
    if (flags.totalMass) lines.push(`mass=${v.totalMass.toFixed(1)}`);
    if (flags.inertia) lines.push(`inertia=${v.inertia.toFixed(1)}`);
    lines.push(`COM=(${v.com.x.toFixed(0)},${v.com.y.toFixed(0)})`);
    lines.push(`HP=${Math.round(v.hp)}/${v.maxHp}`);
    py = panel(`${v.team === 'A' ? 'A' : 'B'} · ${v.resolved.body.name}`, lines, py);
  }

  if (flags.lastImpact && dbg.lastImpact) {
    py = panel('Last Impact', [
      `dmg=${dbg.lastImpact.damage.toFixed(1)}`,
      `relV=${dbg.lastImpact.relativeVelocity.toFixed(1)}`,
    ], py);
  }
  if (flags.lastDamage && dbg.lastDamage) {
    py = panel('Last Damage', [
      `dmg=${dbg.lastDamage.damage.toFixed(1)} → ${dbg.lastDamage.target}`,
    ], py);
  }

  panel(`Phase: ${orchestrator.phase}`, [], py);
}
