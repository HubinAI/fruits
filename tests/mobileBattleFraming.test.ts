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
          // F-WX-9C：Mobile Active 战斗主体优先——单车视觉宽度 24~30%（corridor 收窄到
          // 开局精确边界 + compact battle margin 8/insetX 0，实测三屏统一 24.4%）
          if (phase === 'Active' && !vp.desktop) {
            const ratio = (b.maxX - b.minX) / vp.w;
            expect(ratio, `${vp.w}×${vp.h} Active 车辆占比 ${(ratio * 100).toFixed(1)}% ∈ [24%,30%]`).toBeGreaterThanOrEqual(0.24);
            expect(ratio, `${vp.w}×${vp.h} Active 车辆占比 ${(ratio * 100).toFixed(1)}% ≤ 30%`).toBeLessThanOrEqual(0.3);
          }
        }
        // F-WX-8-C：Mobile Warning 场地规则优先——完整 arena 左右墙（x=0 / x=width）在屏内（刺墙提示可见）
        if (phase === 'Warning' && !vp.desktop) {
          const l = 0 * cam.scale + cam.offsetX;
          const rw = snap.arena.width * cam.scale + cam.offsetX;
          expect(l, `Warning 左墙入屏`).toBeGreaterThanOrEqual(-10);
          expect(rw, `Warning 右墙入屏`).toBeLessThanOrEqual(vp.w + 10);
        }
        // F-WX-8-C：Desktop Active 保持既有构图（旧 corridor 占比 ~15%，不得因 Mobile 改动漂移）
        if (phase === 'Active' && vp.desktop) {
          const bb = vehicleScreenBounds(snap.vehicleA, cam);
          const ratio = (bb.maxX - bb.minX) / vp.w;
          expect(ratio, `Desktop Active 车辆占比 ${(ratio * 100).toFixed(1)}% 应保持旧值（≤18%）`).toBeLessThanOrEqual(0.18);
        }
      }
    });
  }

  for (const soloVp of VIEWPORTS.filter((v) => !v.desktop)) {
    it(`F-WX-UI-1｜Garage previewSolo ${soloVp.w}×${soloVp.h}：车辆 fit 到左侧展示区（framingRect）+ 占屏 28~38% + 中心在展示区`, () => {
      const vp = { w: soloVp.w, h: soloVp.h };
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
      // F-WX-UI-1：framingRect = 左侧展示区（与 CanvasHost.getPreviewFramingRect 同几何：
      // 展示区 ~57% 屏宽，顶部 34+14，底部 CTA 56+16）
      const topH = 34;
      const ctaH = 56;
      const ctaY = vp.h - 16 - ctaH;
      const panelX = 10 + Math.round(vp.w * 0.57) + 12;
      const showX = 10;
      const showW = Math.max(200, panelX - 12 - showX);
      const bodyTop = topH + 14;
      const bodyBot = ctaY - 14;
      const framingRect = { x: showX, y: bodyTop, w: showW, h: Math.max(120, bodyBot - bodyTop) };
      r.reframe(snap, 'previewSolo', { framingRect });
      const b = vehicleScreenBounds(snap.vehicleA, r.transform);
      // 完整可见
      expect(b.minX).toBeGreaterThanOrEqual(-1);
      expect(b.maxX).toBeLessThanOrEqual(vp.w + 1);
      expect(b.minY).toBeGreaterThanOrEqual(-1);
      expect(b.maxY).toBeLessThanOrEqual(vp.h + 1);
      // 车辆中心位于左侧展示区（x∈[showX,showX+showW] y∈[bodyTop,bodyBot]）
      const centerX = (b.minX + b.maxX) / 2;
      const centerY = (b.minY + b.maxY) / 2;
      expect(centerX, `${vp.w}×${vp.h} 车辆中心 x 在展示区`).toBeGreaterThanOrEqual(framingRect.x - 2);
      expect(centerX, `${vp.w}×${vp.h} 车辆中心 x 在展示区内`).toBeLessThanOrEqual(framingRect.x + framingRect.w + 2);
      expect(centerY, `${vp.w}×${vp.h} 车辆中心 y 在展示区`).toBeGreaterThanOrEqual(framingRect.y - 2);
      expect(centerY, `${vp.w}×${vp.h} 车辆中心 y 在展示区内`).toBeLessThanOrEqual(framingRect.y + framingRect.h + 2);
      // F-WX-9B：车辆垂直居中（中心 ≈ 展示区垂直中点，容差 8px，不贴底/贴顶）
      const rectCenterY = framingRect.y + framingRect.h / 2;
      expect(
        Math.abs(centerY - rectCenterY),
        `${vp.w}×${vp.h} 车辆中心 y ${centerY.toFixed(1)} 应接近展示区中点 ${rectCenterY.toFixed(1)}（|Δ|≤8）`,
      ).toBeLessThanOrEqual(8);
      // F-WX-9B：车辆视觉宽度占屏 32~38%（收敛下限：真实车辆屏宽目标 32%+）
      const ratio = (b.maxX - b.minX) / vp.w;
      expect(ratio, `${vp.w}×${vp.h} 车辆占比 ${(ratio * 100).toFixed(1)}% 应 ∈ [32%,38%]`).toBeGreaterThanOrEqual(0.32);
      expect(ratio, `${vp.w}×${vp.h} 车辆占比 ${(ratio * 100).toFixed(1)}% 应 ≤ 38%`).toBeLessThanOrEqual(0.38);
    });
  }
});
