/**
 * Queue Q04-R1B｜Push Rod 真实连接可视化 targeted test
 *
 * 覆盖 Q04-R1B 验收（Renderer 层，snapshot 手工构造）：
 * 1. translation=0（from≈to）时不绘制连接轴 → 与无 connector 基线一致（无异常长连接）；
 * 2. translation>0 时绘制 from→to 窄轴，长度 = |to−from|（伸出越长轴越长，视觉连续）；
 * 3. facing=-1 镜像：to 在 from 左侧 → 轴方向 dx<0，长度不变；
 * 4. 其他 Functional Part（无 connector）不产生任何额外绘制（Renderer 行为不变）。
 */
import { describe, it, expect } from 'vitest';
import { Renderer } from '../src/render/renderer';
import type { BattleOrchestratorApi, BattleRenderSnapshot } from '../src/battle/battleContract';

/** 记录所有 ctx 调用的最小 stub（同 rendererCircleRotation.test.ts 模式） */
class CtxStub {
  calls: string[] = [];
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
  arc(): void { this.record('arc'); }
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

/** 空多边形 shape：不产生任何线条（用于隔离 connector 的绘制） */
const EMPTY_SHAPE: { kind: 'polygons'; polygons: { points: Array<{ x: number; y: number }> }[] } = {
  kind: 'polygons',
  polygons: [],
};

function makeSnap(
  connector: { from: { x: number; y: number }; to: { x: number; y: number }; width: number } | undefined,
): BattleRenderSnapshot {
  return {
    arena: { width: 1600, groundY: 700, normalWalls: [], closingWalls: [] },
    vehicleA: {
      team: 'A',
      body: EMPTY_SHAPE,
      wheels: [],
      parts: [
        {
          shape: EMPTY_SHAPE,
          category: 'gadget',
          ...(connector ? { connector } : {}),
        },
      ],
    },
    vehicleB: {
      team: 'B',
      body: EMPTY_SHAPE,
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
    getBattleStatusSnapshot: () => ({
      sideA: { team: 'A', hp: 1000, maxHp: 1000 },
      sideB: { team: 'B', hp: 1000, maxHp: 1000 },
      phase: 'Active',
    }),
  };
}

/** 渲染并返回所有 lineTo 线段（屏幕坐标） */
function renderConnector(
  connector: { from: { x: number; y: number }; to: { x: number; y: number }; width: number } | undefined,
): Array<{ x0: number; y0: number; x1: number; y1: number }> {
  (globalThis as { window?: { devicePixelRatio: number } }).window = { devicePixelRatio: 1 };
  const ctx = new CtxStub();
  const renderer = new Renderer(makeCanvas(ctx));
  renderer.resize(1600, 1000); // scale = min(1000/1600, 500/1000) * 1.8 = 0.9
  renderer.render(makeFakeOrch(makeSnap(connector)));
  return ctx.lines;
}

/** 提取水平线段（|dy| < 0.01），返回其有符号 dx */
function horizontalSegments(
  lines: Array<{ x0: number; y0: number; x1: number; y1: number }>,
): Array<{ dx: number; dy: number }> {
  return lines
    .map((l) => ({ dx: l.x1 - l.x0, dy: l.y1 - l.y0 }))
    .filter((s) => Math.abs(s.dy) < 0.01);
}

describe('Q04-R1B Push Rod 真实连接可视化', () => {
  it('无 connector 的部件（基线）不产生连接轴：仅地面 1 条线段', () => {
    const lines = renderConnector(undefined);
    expect(lines.length).toBe(1); // render() 的 ground 线
  });

  it('translation=0（from≈to）不绘制连接轴：与基线线段数一致（无异常长连接）', () => {
    const lines = renderConnector({ from: { x: 500, y: 600 }, to: { x: 500, y: 600 }, width: 6 });
    expect(lines.length).toBe(1);
  });

  it('translation>0：绘制 from→to 水平窄轴，长度 = |to−from| × scale', () => {
    // to.x − from.x = 60 → 屏幕长度 60 × 0.9 = 54
    // （水平段 = ground 线 dx=1440 + 连接轴长边 dx=54，断言存在 54 段）
    const lines = renderConnector({ from: { x: 500, y: 600 }, to: { x: 560, y: 600 }, width: 6 });
    const horiz = horizontalSegments(lines);
    expect(horiz.some((s) => Math.abs(s.dx - 60 * 0.9) < 0.001)).toBe(true);
    // 轴宽 6 → 垂直边存在（|dx|≈0、|dy|=6×0.9；stub 的 lineTo 不自更新 pen，取绝对值）
    const verts = lines.filter((l) => Math.abs(l.x1 - l.x0) < 0.01);
    expect(
      verts.some((v) => Math.abs(Math.abs(v.y1 - v.y0) - 6 * 0.9) < 0.001),
    ).toBe(true);
  });

  it('伸出越长连接轴自然越长：to 距离 from 120px → 屏幕 108px', () => {
    const lines = renderConnector({ from: { x: 500, y: 600 }, to: { x: 620, y: 600 }, width: 6 });
    const horiz = horizontalSegments(lines);
    expect(horiz.some((s) => Math.abs(s.dx - 120 * 0.9) < 0.001)).toBe(true);
  });

  it('facing=-1 镜像：to 在 from 左侧，轴方向 dx<0，长度不变', () => {
    const lines = renderConnector({ from: { x: 500, y: 600 }, to: { x: 440, y: 600 }, width: 6 });
    const horiz = horizontalSegments(lines);
    expect(horiz.some((s) => Math.abs(s.dx + 60 * 0.9) < 0.001)).toBe(true);
  });
});
