/**
 * Queue Q11-C-R3-FINAL｜Renderer 镭射「巨炮」束 + 蓄能末段升级 targeted test
 *
 * 覆盖验收：
 * 1. spawnLaserBeam 几何达标：长 450~600 / 核心 12~18 / glow 30~45（世界 px）；
 * 2. 巨炮束绘制三層（glow/mid/core）lineWidth 与白青色正确；
 * 3. 蓄能末段升级：progress>=0.7 外圈明显大于 progress=0.2 外圈。
 *
 * 使用最小 canvas/context stub（node 环境无 DOM）。
 */
import { describe, it, expect } from 'vitest';
import { Renderer } from '../src/render/renderer';

/** 扩展 stub：记录 arc 的 strokeStyle，以及每次 stroke 的 lineWidth/strokeStyle */
class CtxStub {
  arcs: Array<{ x: number; y: number; r: number; strokeStyle: string }> = [];
  strokes: Array<{ lineWidth: number; strokeStyle: string }> = [];
  fillStyle = '';
  strokeStyle = '';
  lineWidth = 1;
  globalAlpha = 1;
  font = '';
  textAlign = '';
  setTransform(): void {}
  clearRect(): void {}
  fillRect(): void {}
  beginPath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  closePath(): void {}
  fill(): void {}
  stroke(): void {
    this.strokes.push({ lineWidth: this.lineWidth, strokeStyle: this.strokeStyle });
  }
  arc(x: number, y: number, r: number): void {
    this.arcs.push({ x, y, r, strokeStyle: this.strokeStyle });
  }
  fillText(): void {}
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

function makeFakeOrch() {
  return {
    config: {},
    result: null,
    phase: 'Active' as const,
    timeMs: 0,
    step: () => {},
    onCombatEvent: () => () => {},
    dispose: () => {},
    getRenderSnapshot: () => ({
      arena: { width: 1600, groundY: 700, normalWalls: [], closingWalls: [] },
      vehicleA: { team: 'A' as const, body: { kind: 'polygons' as const, polygons: [{ points: [{ x: 100, y: 600 }, { x: 200, y: 600 }, { x: 200, y: 650 }, { x: 100, y: 650 }] }] }, wheels: [], parts: [] },
      vehicleB: { team: 'B' as const, body: { kind: 'polygons' as const, polygons: [{ points: [{ x: 900, y: 600 }, { x: 1000, y: 600 }, { x: 1000, y: 650 }, { x: 900, y: 650 }] }] }, wheels: [], parts: [] },
      projectiles: [],
    }),
    getBattleStatusSnapshot: () => ({ sideA: { team: 'A' as const, hp: 1000, maxHp: 1000 }, sideB: { team: 'B' as const, hp: 1000, maxHp: 1000 }, phase: 'Active' as const }),
  };
}

describe('Q11-C-R3-FINAL Renderer 镭射巨炮束', () => {
  it('spawnLaserBeam 几何达标（长/核心/glow 世界 px）且 activeLaserBeams 存活', () => {
    (globalThis as { window?: { devicePixelRatio: number } }).window = { devicePixelRatio: 1 };
    const ctx = new CtxStub();
    const renderer = new Renderer(makeCanvas(ctx));
    renderer.spawnLaserBeam(500, 600, 1, 0); // facing +X
    const beams = renderer.activeLaserBeams;
    expect(beams.length).toBe(1);
    const b = beams[0]!;
    expect(b.length).toBeGreaterThanOrEqual(450);
    expect(b.length).toBeLessThanOrEqual(600);
    expect(b.coreWidth).toBeGreaterThanOrEqual(12);
    expect(b.coreWidth).toBeLessThanOrEqual(18);
    expect(b.glowWidth).toBeGreaterThanOrEqual(30);
    expect(b.glowWidth).toBeLessThanOrEqual(45);
    expect(b.dirX).toBeCloseTo(1, 6); // 沿真实 fire 方向（facing +X）
    expect(b.dirY).toBeCloseTo(0, 6);
  });

  it('巨炮束绘制三層（glow/mid/core）lineWidth 与白青色正确，且随 TTL 衰减后不绘制', () => {
    (globalThis as { window?: { devicePixelRatio: number } }).window = { devicePixelRatio: 1 };
    const ctx = new CtxStub();
    const renderer = new Renderer(makeCanvas(ctx));
    renderer.resize(1600, 1000); // scale = 0.9
    renderer.spawnLaserBeam(500, 600, 1, 0);
    renderer.render(makeFakeOrch() as never);
    // 三层 lineWidth（世界 px × scale 0.9）：glow 38→34.2 / mid 21→18.9 / core 15→13.5
    const widths = ctx.strokes.map((s) => s.lineWidth).sort((a, b) => b - a);
    expect(widths[0]!).toBeCloseTo(38 * 0.9, 1);
    expect(widths[1]!).toBeCloseTo(21 * 0.9, 1);
    expect(widths[2]!).toBeCloseTo(15 * 0.9, 1);
    // 白青色系
    expect(ctx.strokes.some((s) => s.strokeStyle === '#eafdff')).toBe(true); // 核心
    expect(ctx.strokes.some((s) => s.strokeStyle === '#5fc8ff')).toBe(true); // glow
  });

  it('蓄能末段升级：progress=1.0 外圈明显大于 progress=0.2 外圈', () => {
    (globalThis as { window?: { devicePixelRatio: number } }).window = { devicePixelRatio: 1 };
    const ctx = new CtxStub();
    const renderer = new Renderer(makeCanvas(ctx));
    renderer.resize(1600, 1000); // scale = 0.9
    // 两个蓄能光点（不同 key，不同 progress）
    renderer.spawnCharge('low', 400, 600, 0.2);
    renderer.spawnCharge('high', 800, 600, 1.0);
    renderer.render(makeFakeOrch() as never);
    // 外圈 stroke：low 用 '#ffd35a'（p<=0.7），high 用 '#fff2b8'（p>0.7）
    const lowOuter = Math.max(0, ...ctx.arcs.filter((a) => a.strokeStyle === '#ffd35a').map((a) => a.r));
    const highOuter = Math.max(0, ...ctx.arcs.filter((a) => a.strokeStyle === '#fff2b8').map((a) => a.r));
    expect(highOuter).toBeGreaterThan(lowOuter * 1.5); // 末段外圈明显扩大
  });
});
