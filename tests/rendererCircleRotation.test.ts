/**
 * Queue Q05-V1｜Circle Rotation 可感知 targeted test
 *
 * 覆盖 Q05-V1 验收：
 * 1. 圆形 Functional Part 的径向方向线完全使用 RenderCircle.angle（真实物理角度）；
 * 2. angle=0 与 angle=π/2 绘制方向明显不同（随真实旋转变化）；
 * 3. 普通 circle 几何（fill/stroke 的 center / radius）不随 angle 改变；
 * 4. 不新增 gameplay 状态（Renderer 只读 snapshot）。
 *
 * 使用最小 canvas/context stub（node 环境无 DOM；按项目惯例仅对 DOM stub 做窄类型断言）。
 */
import { describe, it, expect } from 'vitest';
import { Renderer } from '../src/render/renderer';
import type { BattleOrchestratorApi, BattleRenderSnapshot } from '../src/battle/battleContract';

/** 记录所有 ctx 调用的最小 stub */
class CtxStub {
  calls: string[] = [];
  arcs: Array<{ x: number; y: number; r: number }> = [];
  lines: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
  fillStyle = '';
  strokeStyle = '';
  lineWidth = 1;
  globalAlpha = 1;
  font = '';
  textAlign = '';
  private pen: { x: number; y: number } = { x: 0, y: 0 };

  private record(name: string): void {
    this.calls.push(name);
  }
  setTransform(): void { this.record('setTransform'); }
  clearRect(): void { this.record('clearRect'); }
  fillRect(): void { this.record('fillRect'); }
  beginPath(): void { this.record('beginPath'); }
  moveTo(x: number, y: number): void {
    this.record('moveTo');
    this.pen = { x, y };
  }
  lineTo(x: number, y: number): void {
    this.record('lineTo');
    this.lines.push({ x0: this.pen.x, y0: this.pen.y, x1: x, y1: y });
  }
  closePath(): void { this.record('closePath'); }
  fill(): void { this.record('fill'); }
  stroke(): void { this.record('stroke'); }
  arc(x: number, y: number, r: number): void {
    this.record('arc');
    this.arcs.push({ x, y, r });
  }
  fillText(): void { this.record('fillText'); }
}

function makeCanvas(ctx: CtxStub) {
  return {
    width: 0,
    height: 0,
    clientWidth: 1000,
    clientHeight: 500,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement;
}

function makeCircleSnap(angleA: number, angleB: number): BattleRenderSnapshot {
  return {
    arena: { width: 1600, groundY: 700, normalWalls: [], closingWalls: [] },
    vehicleA: {
      team: 'A',
      body: { kind: 'circle', circle: { center: { x: 400, y: 600 }, radius: 20, angle: angleA } },
      wheels: [],
      parts: [],
    },
    vehicleB: {
      team: 'B',
      body: { kind: 'circle', circle: { center: { x: 1200, y: 600 }, radius: 20, angle: angleB } },
      wheels: [],
      parts: [],
    },
  };
}

function makeFakeOrch(snapshot: BattleRenderSnapshot): BattleOrchestratorApi {
  return {
    config: {},
    result: null,
    phase: 'Active',
    timeMs: 0,
    step: () => {},
    onCombatEvent: () => () => {},
    dispose: () => {},
    getRenderSnapshot: () => snapshot,
  };
}

/** 渲染 circle snapshot 并返回两辆车各自的径向线（屏幕坐标向量） */
function renderCircles(angleA: number, angleB: number): {
  lineA: { x0: number; y0: number; x1: number; y1: number };
  lineB: { x0: number; y0: number; x1: number; y1: number };
  arcs: CtxStub['arcs'];
} {
  (globalThis as { window?: { devicePixelRatio: number } }).window = { devicePixelRatio: 1 };
  const ctx = new CtxStub();
  const renderer = new Renderer(makeCanvas(ctx));
  const orch = makeFakeOrch(makeCircleSnap(angleA, angleB));
  renderer.resize(1600, 1000);
  renderer.render(orch);
  // 每辆车绘制：circle 弧 → 径向线（moveTo+lineTo）。
  // lines[0] = render() 的 ground 地面线；lines[1]/[2] = A/B 两辆车 body circle 的径向线。
  const lines = ctx.lines;
  return { lineA: lines[1]!, lineB: lines[2]!, arcs: ctx.arcs };
}

describe('Q05-V1 Circle Rotation 可感知', () => {
  it('angle=0 与 angle=π/2 径向方向线明显不同（随真实角度旋转）', () => {
    // A：angle=0（方向 +X）；B：angle=π/2（方向 +Y）
    const { lineA, lineB } = renderCircles(0, Math.PI / 2);
    const dirA = { x: lineA.x1 - lineA.x0, y: lineA.y1 - lineA.y0 };
    const dirB = { x: lineB.x1 - lineB.x0, y: lineB.y1 - lineB.y0 };
    // angle=0 → 水平向右（dy ≈ 0）
    expect(Math.abs(dirA.y)).toBeLessThan(0.001);
    expect(dirA.x).toBeGreaterThan(0);
    // angle=π/2 → 竖直（dx ≈ 0，dy > 0 屏幕 y 向下）
    expect(Math.abs(dirB.x)).toBeLessThan(0.001);
    expect(Math.abs(dirB.y)).toBeGreaterThan(0);
    // 两方向明显不同（垂直）
    const dot =
      (dirA.x * dirB.x + dirA.y * dirB.y) /
      (Math.hypot(dirA.x, dirA.y) * Math.hypot(dirB.x, dirB.y) || 1);
    expect(Math.abs(dot)).toBeLessThan(0.1);
  });

  it('径向线长度 = radius × 0.8（真实几何比例）', () => {
    const { lineA } = renderCircles(0, 0);
    // 镜头：resize(1600,1000) → scale = min(1000/1600, 500/1000)*1.8 = 0.9
    const dirLen = Math.hypot(lineA.x1 - lineA.x0, lineA.y1 - lineA.y0);
    expect(dirLen).toBeCloseTo(20 * 0.8 * 0.9, 6);
  });

  it('普通 circle 几何（center/radius）不随 angle 改变', () => {
    const r0 = renderCircles(0, 0);
    const r90 = renderCircles(0, Math.PI / 2);
    // 两次渲染 circle 弧的 center/radius 完全一致（与 angle 无关）
    expect(r90.arcs.length).toBe(2);
    for (let i = 0; i < r0.arcs.length; i++) {
      expect(r90.arcs[i]!.x).toBe(r0.arcs[i]!.x);
      expect(r90.arcs[i]!.y).toBe(r0.arcs[i]!.y);
      expect(r90.arcs[i]!.r).toBe(r0.arcs[i]!.r);
    }
  });
});
