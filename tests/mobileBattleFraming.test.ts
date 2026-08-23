/**
 * F-WX-6｜Battle 横屏构图验收（E 项，只验证 Camera framing，不改 Physics 世界尺度）。
 *
 * 覆盖 844×390 / 932×430 / 960×540（19.5:9~16:9 横屏）+ 1280×720（16:9 Desktop）：
 * 1. 双方车辆在 Active/Warning/Closing 构图下完整可见（完整入画硬约束）；
 * 2. HUD 不挡主体：车辆顶缘 ≥ 移动端 HUD 安全区（56 逻辑 px）/ 桌面 SAFE_INSET_Y；
 * 3. 无垂直裁切（车辆顶/底均在 viewport 内）→ 超宽屏只有两侧场景留白，非黑边裁切；
 * 4. Garage previewSolo 在移动端 Dock 上方的可视带内完整可见。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import { Renderer } from '../src/render/renderer';
import { VisualRegistry } from '../src/render/visualRegistry';
import { registry } from '../src/core/content';
import { makeStarterDraft, buildSnapshotFromDraft } from '../src/lab/buildEditorModel';
import type { CanvasSurface } from '../src/render/canvasSurface';
import type { RenderVehicle } from '../src/battle/battleContract';
import { bindPlatformCore } from '../src/platform/context';
import { createWebCore } from '../src/platform/web';

const VIEWPORTS: Array<{ w: number; h: number; desktop: boolean }> = [
  { w: 844, h: 390, desktop: false },
  { w: 932, h: 430, desktop: false },
  { w: 960, h: 540, desktop: false },
  { w: 1280, h: 720, desktop: true },
];

function makeStubCtx(): CanvasRenderingContext2D {
  const handler = { get: () => () => ({ width: 0 }), set: () => true };
  return new Proxy({} as CanvasRenderingContext2D, handler);
}

/** 车辆世界 AABB → 屏幕 AABB（用 renderer.transform 的相机变换，同 reframe 语义） */
function vehicleScreenBounds(
  v: RenderVehicle,
  cam: { scale: number; offsetX: number; offsetY: number },
): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const acc = (x: number, y: number): void => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  const shape = (s: RenderVehicle['body']): void => {
    if (s.kind === 'polygons') {
      for (const poly of s.polygons) for (const p of poly.points) acc(p.x, p.y);
    } else {
      acc(s.circle.center.x - s.circle.radius, s.circle.center.y - s.circle.radius);
      acc(s.circle.center.x + s.circle.radius, s.circle.center.y + s.circle.radius);
    }
  };
  shape(v.body);
  for (const w of v.wheels) {
    acc(w.center.x - w.radius, w.center.y - w.radius);
    acc(w.center.x + w.radius, w.center.y + w.radius);
  }
  for (const p of v.parts) shape(p.shape);
  const sx = (x: number): number => x * cam.scale + cam.offsetX;
  const sy = (y: number): number => y * cam.scale + cam.offsetY;
  return { minX: sx(minX), minY: sy(minY), maxX: sx(maxX), maxY: sy(maxY) };
}

describe('F-WX-6 Battle 横屏构图（E 项）', () => {
  afterEach(() => {
    bindPlatformCore(createWebCore());
  });

  for (const vp of VIEWPORTS) {
    it(`${vp.w}×${vp.h}：双方车辆完整可见 + HUD 不挡主体 + 无垂直裁切（battle Active/Warning/Closing）`, () => {
      const canvas = { getContext: () => makeStubCtx(), clientWidth: vp.w, clientHeight: vp.h, width: vp.w, height: vp.h } as unknown as HTMLCanvasElement;
      const surface: CanvasSurface = { width: vp.w, height: vp.h, devicePixelRatio: 1, now: () => 0 };
      const o = new PlanckBattleOrchestrator(
        buildSnapshotFromDraft(makeStarterDraft('watermelonBody', registry), registry, 'a'),
        buildSnapshotFromDraft(makeStarterDraft('bananaBody', registry), registry, 'b'),
        registry,
        { autoDrive: true },
      );
      const r = new Renderer(canvas, new VisualRegistry(), surface);
      const snap0 = o.getRenderSnapshot();
      r.resize(snap0.arena.width, o.arena.config.height);

      // HUD 安全区：移动端顶部 56 逻辑 px；桌面 SAFE_INSET_Y=28
      const hudTop = vp.desktop ? 28 : 56;
      for (const phase of ['Active', 'Warning', 'Closing']) {
        // reframe 的 battle 构图只依赖显式 phase（corridor/arena bounds），与战斗推进无关
        const snap = o.getRenderSnapshot();
        r.reframe(snap, 'battle', { phase });
        const cam = r.transform;
        for (const v of [snap.vehicleA, snap.vehicleB]) {
          const b = vehicleScreenBounds(v, cam);
          // 完整可见（含 margin 语义的入画硬约束）
          expect(b.minX, `${phase} A/B 左缘入画`).toBeGreaterThanOrEqual(-1);
          expect(b.maxX, `${phase} A/B 右缘入画`).toBeLessThanOrEqual(vp.w + 1);
          expect(b.minY, `${phase} A/B 顶缘入画`).toBeGreaterThanOrEqual(-1);
          expect(b.maxY, `${phase} A/B 底缘入画`).toBeLessThanOrEqual(vp.h + 1);
          // HUD 不挡主体：车辆顶缘在 HUD 安全区之下
          expect(b.minY, `${phase} 车辆顶缘低于 HUD 区（${hudTop}）`).toBeGreaterThanOrEqual(hudTop - 1);
        }
      }
    });
  }

  it('Garage previewSolo：移动端车辆在 Dock 上方可视带完整可见（不裁切）', () => {
    const vp = { w: 932, h: 430 };
    const canvas = { getContext: () => makeStubCtx(), clientWidth: vp.w, clientHeight: vp.h, width: vp.w, height: vp.h } as unknown as HTMLCanvasElement;
    const surface: CanvasSurface = { width: vp.w, height: vp.h, devicePixelRatio: 1, now: () => 0 };
    const o = new PlanckBattleOrchestrator(
      buildSnapshotFromDraft(makeStarterDraft('watermelonBody', registry), registry, 'a'),
      buildSnapshotFromDraft(makeStarterDraft('watermelonBody', registry), registry, 'b'),
      registry,
      { autoDrive: false, engine: 'planck', spawnA: { x: 620, y: 640, facing: 1 }, spawnB: { x: 980, y: 640, facing: -1 } },
      true, // soloA
    );
    const r = new Renderer(canvas, new VisualRegistry(), surface);
    const snap = o.getRenderSnapshot();
    r.resize(snap.arena.width, o.arena.config.height);
    r.reframe(snap, 'previewSolo');
    const b = vehicleScreenBounds(snap.vehicleA, r.transform);
    // 移动端 previewSolo：顶部 52 + 底部 Dock 220 → 车辆在中间可视带内完整可见
    expect(b.minX).toBeGreaterThanOrEqual(-1);
    expect(b.maxX).toBeLessThanOrEqual(vp.w + 1);
    expect(b.minY).toBeGreaterThanOrEqual(52 - 1);
    expect(b.maxY).toBeLessThanOrEqual(vp.h - 220 + 1);
  });
});
