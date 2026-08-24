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

/** 车辆世界 AABB → 屏幕 AABB（用 renderer.transform 的相机变换，同 reframe 语义）。
 *  F-WX-RCA-2A：includeParts=false → coreBounds（Body+Wheels，Garage 主尺度验收口径）；
 *  includeParts=true → envelopeBounds（+Functional Parts，完整外廓/完整入画校验）。 */
function vehicleScreenBounds(
  v: RenderVehicle,
  cam: { scale: number; offsetX: number; offsetY: number },
  includeParts = true,
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
  if (includeParts) {
    for (const p of v.parts) shape(p.shape);
  }
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
          // F-WX-RCA-3B：Approach（开局 Active 宽视野）只验双方完整可见，不要求车辆大
          // （占比由 Engage 阶段负责；envelope 不再作为车体尺寸验收口径）
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
    it(`F-WX-RCA-2A｜Garage previewSolo ${soloVp.w}×${soloVp.h}：coreBounds（Body+Wheels）主尺度 28~34% + 完整入画 + 展示区居中`, () => {
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
      // framingRect = 左侧展示区（与 CanvasHost.getPreviewFramingRect 同几何：
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
      // coreBounds（Body+Wheels）= Garage 主尺度验收口径；envelope 仅作完整入画校验
      const core = vehicleScreenBounds(snap.vehicleA, r.transform, false);
      const env = vehicleScreenBounds(snap.vehicleA, r.transform, true);
      // 完整入画（core + envelope 均在屏内；普通武器由横向 margin 65 覆盖）
      for (const b of [core, env]) {
        expect(b.minX).toBeGreaterThanOrEqual(-1);
        expect(b.maxX).toBeLessThanOrEqual(vp.w + 1);
        expect(b.minY).toBeGreaterThanOrEqual(-1);
        expect(b.maxY).toBeLessThanOrEqual(vp.h + 1);
      }
      // 车辆核心中心位于左侧展示区（x∈[showX,showX+showW] y∈[bodyTop,bodyBot]）
      const centerX = (core.minX + core.maxX) / 2;
      const centerY = (core.minY + core.maxY) / 2;
      expect(centerX, `${vp.w}×${vp.h} 车辆核心中心 x 在展示区`).toBeGreaterThanOrEqual(framingRect.x - 2);
      expect(centerX, `${vp.w}×${vp.h} 车辆核心中心 x 在展示区内`).toBeLessThanOrEqual(framingRect.x + framingRect.w + 2);
      expect(centerY, `${vp.w}×${vp.h} 车辆核心中心 y 在展示区`).toBeGreaterThanOrEqual(framingRect.y - 2);
      expect(centerY, `${vp.w}×${vp.h} 车辆核心中心 y 在展示区内`).toBeLessThanOrEqual(framingRect.y + framingRect.h + 2);
      // 垂直居中（中心 ≈ 展示区垂直中点，容差 8px）
      const rectCenterY = framingRect.y + framingRect.h / 2;
      expect(
        Math.abs(centerY - rectCenterY),
        `${vp.w}×${vp.h} 核心中心 y ${centerY.toFixed(1)} 应接近展示区中点 ${rectCenterY.toFixed(1)}（|Δ|≤8）`,
      ).toBeLessThanOrEqual(8);
      // F-WX-RCA-2A：coreBounds 占屏 28~34%（真实微信 RCA 旧值 14% → 修复后目标 28~34%）
      const coreRatio = (core.maxX - core.minX) / vp.w;
      expect(coreRatio, `${vp.w}×${vp.h} core 占比 ${(coreRatio * 100).toFixed(1)}% 应 ∈ [28%,34%]`).toBeGreaterThanOrEqual(0.28);
      expect(coreRatio, `${vp.w}×${vp.h} core 占比 ${(coreRatio * 100).toFixed(1)}% 应 ≤ 34%`).toBeLessThanOrEqual(0.34);
      // envelope 仍大于 core（双口径并存；envelope 不再作为车辆尺寸验收）
      const envRatio = (env.maxX - env.minX) / vp.w;
      expect(envRatio, 'envelope 占比 > core 占比').toBeGreaterThan(coreRatio);
    });
  }

  for (const vp of VIEWPORTS.filter((v) => !v.desktop)) {
    it(`F-WX-RCA-3B｜Battle Engage ${vp.w}×${vp.h}：近距离触发构图——A/B core 完整入画 + core 明显大于 Approach + 一次构图`, () => {
      const canvas = { getContext: () => makeStubCtx(), clientWidth: vp.w, clientHeight: vp.h, width: vp.w, height: vp.h } as unknown as HTMLCanvasElement;
      const surface: CanvasSurface = { width: vp.w, height: vp.h, devicePixelRatio: 1, now: () => 0 };
      // 近距离 spawn（Engage 触发距离内：A core 右缘 558 / B core 左缘 ~600，gap≈42 ≤ ENGAGE_DIST=40 附近）
      const o = new PlanckBattleOrchestrator(
        buildSnapshotFromDraft(makeStarterDraft('watermelonBody', registry), registry, 'a'),
        buildSnapshotFromDraft(makeStarterDraft('bananaBody', registry), registry, 'b'),
        registry,
        { autoDrive: false, engine: 'planck', spawnA: { x: 620, y: 640, facing: 1 }, spawnB: { x: 700, y: 640, facing: -1 } },
      );
      const r = new Renderer(canvas, new VisualRegistry(), surface);
      const snap = o.getRenderSnapshot();
      r.resize(snap.arena.width, o.arena.config.height);
      // Approach（开局宽视野）
      r.reframe(snap, 'battle', { phase: 'Active' });
      const ap = r.scaleDiagnosticsBoth(snap);
      // Engage（距离阈值触发瞬间，A+B coreBounds + margin）
      r.reframe(snap, 'battle', { phase: 'Active', engage: true });
      const en = r.scaleDiagnosticsBoth(snap);
      // 1) Engage 双方 core 完整入画
      for (const d of [en.A.core, en.B.core]) {
        expect(d.screen.minX).toBeGreaterThanOrEqual(-1);
        expect(d.screen.maxX).toBeLessThanOrEqual(vp.w + 1);
        expect(d.screen.minY).toBeGreaterThanOrEqual(-1);
        expect(d.screen.maxY).toBeLessThanOrEqual(vp.h + 1);
      }
      // 2) Engage 时 A core 明显大于 Approach（core 口径，不碰 envelope）
      expect(en.A.core.screenWidthPct, 'Engage A core 应明显大于 Approach A core').toBeGreaterThan(ap.A.core.screenWidthPct);
      expect(en.A.core.screenWidthPct).toBeGreaterThanOrEqual(25);
      expect(en.B.core.screenWidthPct).toBeGreaterThan(ap.B.core.screenWidthPct);
      // 3) 一次构图：再次 engage reframe → 同 transform（无呼吸缩放）
      r.reframe(snap, 'battle', { phase: 'Active', engage: true });
      expect(r.transform.scale).toBeCloseTo(en.scale, 5);
    });
  }
});
