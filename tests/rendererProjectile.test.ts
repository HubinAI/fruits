/**
 * Queue Q02-C3B｜Renderer Projectile targeted test
 *
 * 覆盖 Q02-C3B 验收：
 * 1. 有 projectile 时按真实世界坐标与半径产生对应圆形绘制（镜头变换后）;
 * 2. A/B projectile 可明显区分（不同颜色）;
 * 3. 绘制顺序：车辆之后、FX 之前；
 * 4. undefined / 空数组时不绘制 projectile，原 Renderer 行为不变。
 *
 * 使用最小 canvas/context stub（node 环境无 DOM；按项目惯例仅对 DOM stub 做窄类型断言）。
 */
import { describe, it, expect } from 'vitest';
import { Renderer, PROJECTILE_COLOR_A, PROJECTILE_COLOR_B } from '../src/render/renderer';
import type {
  BattleOrchestratorApi,
  BattleRenderSnapshot,
} from '../src/battle/battleContract';
import type { BattleEvent } from '../src/battle/combatEvents';

/** 记录所有 ctx 调用的最小 stub */
class CtxStub {
  calls: string[] = [];
  arcs: Array<{ x: number; y: number; r: number; fillStyle: string; index: number }> = [];
  fillStyle = '';
  strokeStyle = '';
  lineWidth = 1;
  globalAlpha = 1;
  font = '';
  textAlign = '';

  private record(name: string): void {
    this.calls.push(name);
  }
  setTransform(): void { this.record('setTransform'); }
  clearRect(): void { this.record('clearRect'); }
  fillRect(): void { this.record('fillRect'); }
  beginPath(): void { this.record('beginPath'); }
  moveTo(): void { this.record('moveTo'); }
  lineTo(): void { this.record('lineTo'); }
  closePath(): void { this.record('closePath'); }
  fill(): void { this.record('fill'); }
  stroke(): void { this.record('stroke'); }
  arc(x: number, y: number, r: number): void {
    this.record('arc');
    this.arcs.push({ x, y, r, fillStyle: this.fillStyle, index: this.calls.length });
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

function makeSnapshot(projectiles: BattleRenderSnapshot['projectiles']): BattleRenderSnapshot {
  return {
    arena: { width: 1600, groundY: 700, normalWalls: [], closingWalls: [] },
    vehicleA: {
      team: 'A',
      body: {
        kind: 'polygons',
        polygons: [
          { points: [{ x: 100, y: 600 }, { x: 200, y: 600 }, { x: 200, y: 650 }, { x: 100, y: 650 }] },
        ],
      },
      wheels: [],
      parts: [],
    },
    vehicleB: {
      team: 'B',
      body: {
        kind: 'polygons',
        polygons: [
          { points: [{ x: 900, y: 600 }, { x: 1000, y: 600 }, { x: 1000, y: 650 }, { x: 900, y: 650 }] },
        ],
      },
      wheels: [],
      parts: [],
    },
    projectiles,
  };
}

function makeFakeOrch(snapshot: BattleRenderSnapshot): BattleOrchestratorApi & { emit: (e: BattleEvent) => void } {
  let cb: ((e: BattleEvent) => void) | null = null;
  return {
    config: {},
    result: null,
    phase: 'Active',
    timeMs: 0,
    step: () => {},
    onCombatEvent: (fn) => {
      cb = fn;
      return () => {
        cb = null;
      };
    },
    dispose: () => {},
    getRenderSnapshot: () => snapshot,
    getBattleStatusSnapshot: () => ({
      sideA: { team: 'A', hp: 1000, maxHp: 1000 },
      sideB: { team: 'B', hp: 1000, maxHp: 1000 },
      phase: 'Active',
    }),
    emit: (e: BattleEvent) => {
      cb?.(e);
    },
  };
}

describe('Q02-C3B Renderer Projectile', () => {
  it('有 projectile：按真实世界坐标与半径绘制圆形，A/B 可区分，顺序在车辆后、FX 前', () => {
    (globalThis as { window?: { devicePixelRatio: number } }).window = { devicePixelRatio: 1 };
    const ctx = new CtxStub();
    const renderer = new Renderer(makeCanvas(ctx));
    const orch = makeFakeOrch(
      makeSnapshot([
        { center: { x: 500, y: 600 }, radius: 6, team: 'A' },
        { center: { x: 700, y: 600 }, radius: 6, team: 'B' },
      ]),
    );
    // 产生一个 FX（伤害数字）以验证「FX 之前」的绘制顺序。
    // W2-FX-1：事件→表现由 BattlePresentationController 统一分发，Renderer 只画；
    // 这里直接调用表现入口（等价于 controller.onDamageNumber → spawnDamageNumber）。
    renderer.spawnDamageNumber(500, 600, '-80', '#ff5a4e');

    renderer.resize(1600, 1000);
    renderer.render(orch);

    // 镜头变换：scale = min(1000/1600, 500/1000) * 1.8 = 0.5 * 1.8 = 0.9
    // offsetX = (1000 - 1600*0.9)/2 = -220；offsetY = (500 - 1000*0.9)/2 = -200
    const arcA = ctx.arcs.find((a) => a.fillStyle === PROJECTILE_COLOR_A);
    const arcB = ctx.arcs.find((a) => a.fillStyle === PROJECTILE_COLOR_B);
    expect(arcA).toBeDefined();
    expect(arcB).toBeDefined();
    // 真实世界坐标 × 镜头（位置保持准确）；半径 = screen-space 常量（F-BATTLE-FX-SCREENSPACE-R2，
    // 不乘 scale —— 旧 ×scale 语义在 scale 0.9 下为 5.4px）
    expect(arcA!.x).toBeCloseTo(500 * 0.9 - 220, 6);
    expect(arcA!.y).toBeCloseTo(600 * 0.9 - 200, 6);
    expect(arcA!.r).toBeCloseTo(6, 6);
    expect(arcB!.x).toBeCloseTo(700 * 0.9 - 220, 6);
    expect(arcB!.y).toBeCloseTo(600 * 0.9 - 200, 6);
    expect(arcB!.r).toBeCloseTo(6, 6);
    // A/B 颜色可明显区分
    expect(PROJECTILE_COLOR_A).not.toBe(PROJECTILE_COLOR_B);
    // 顺序：车辆多边形 fill < projectile arc < FX fillText
    const vehicleFillIdx = ctx.calls.indexOf('fill');
    const projArcIdx = arcA!.index;
    const fxTextIdx = ctx.calls.indexOf('fillText');
    expect(projArcIdx).toBeGreaterThan(vehicleFillIdx);
    expect(fxTextIdx).toBeGreaterThan(projArcIdx);
  });

  it('projectiles 缺省 undefined：不绘制 projectile，原画面不变', () => {
    const ctx = new CtxStub();
    const renderer = new Renderer(makeCanvas(ctx));
    const orch = makeFakeOrch(makeSnapshot(undefined));
    renderer.resize(1600, 1000);
    renderer.render(orch);
    // 无 projectile 颜色弧（vehicle 无 wheel → 除 projectile 外不应有任何 arc）
    expect(ctx.arcs.filter((a) => a.fillStyle === PROJECTILE_COLOR_A).length).toBe(0);
    expect(ctx.arcs.filter((a) => a.fillStyle === PROJECTILE_COLOR_B).length).toBe(0);
    expect(ctx.arcs.length).toBe(0);
    // 原画面不变：车辆多边形仍被填充绘制
    expect(ctx.calls.filter((c) => c === 'fill').length).toBeGreaterThanOrEqual(2);
  });

  it('projectiles 为空数组：同样不绘制 projectile', () => {
    const ctx = new CtxStub();
    const renderer = new Renderer(makeCanvas(ctx));
    const orch = makeFakeOrch(makeSnapshot([]));
    renderer.resize(1600, 1000);
    renderer.render(orch);
    expect(ctx.arcs.length).toBe(0);
  });
});
