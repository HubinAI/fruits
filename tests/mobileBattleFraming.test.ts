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
import { computeMobileGarageLayout } from '../src/ui/mobileGarageLayout';
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
          // F-BATTLE-CAMERA-R2：battle 按 A+B 真实 envelope 构图——单车视觉宽 ~22%
          // （实测 844/932/960 三屏统一 22.1%）
          if (phase === 'Active' && !vp.desktop) {
            const ratio = (b.maxX - b.minX) / vp.w;
            expect(ratio, `${vp.w}×${vp.h} Active 车辆占比 ${(ratio * 100).toFixed(1)}% ∈ [20%,28%]`).toBeGreaterThanOrEqual(0.2);
            expect(ratio, `${vp.w}×${vp.h} Active 车辆占比 ${(ratio * 100).toFixed(1)}% ≤ 28%`).toBeLessThanOrEqual(0.28);
          }
        }
        // F-BATTLE-CAMERA-R2：Warning/Closing 收束墙从画面边缘进入——墙不进入画面中央
        // 1/3（车辆主体区；墙初始在 arena 两侧，envelope 构图下自然位于屏外或边缘）
        if ((phase === 'Warning' || phase === 'Closing') && !vp.desktop) {
          const l = 0 * cam.scale + cam.offsetX;
          const rw = snap.arena.width * cam.scale + cam.offsetX;
          expect(l, `${phase} 左墙不在画面中央（≤35% 或屏外）`).toBeLessThanOrEqual(vp.w * 0.35);
          expect(rw, `${phase} 右墙不在画面中央（≥65% 或屏外）`).toBeGreaterThanOrEqual(vp.w * 0.65);
        }
        // F-BATTLE-CAMERA-R2：Desktop Active 同 envelope 构图（单车占比 ~18%，旧 corridor ≤18%）
        if (phase === 'Active' && vp.desktop) {
          const bb = vehicleScreenBounds(snap.vehicleA, cam);
          const ratio = (bb.maxX - bb.minX) / vp.w;
          expect(ratio, `Desktop Active 车辆占比 ${(ratio * 100).toFixed(1)}% ∈ [16%,24%]`).toBeGreaterThanOrEqual(0.16);
          expect(ratio, `Desktop Active 车辆占比 ${(ratio * 100).toFixed(1)}% ≤ 24%`).toBeLessThanOrEqual(0.24);
        }
      }
    });
  }

  for (const soloVp of VIEWPORTS.filter((v) => !v.desktop)) {
    it(`F-UX-3A｜Garage previewSolo ${soloVp.w}×${soloVp.h}：envelope 主尺度（完整车辆不进入 panelRect）+ 完整入画 + 展示区居中`, () => {
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
      // framingRect = 唯一布局源 vehicleRect（F-WX-UI-F1：与 CanvasHost.getPreviewFramingRect 同源，
      // insets=0 夹具；不再手算重复几何）
      const framingRect = computeMobileGarageLayout({ w: vp.w, h: vp.h }, { left: 0, right: 0, top: 0, bottom: 0 }).vehicleRect;
      r.reframe(snap, 'previewSolo', { framingRect });
      // F-UX-3A：envelopeBounds（Body+Wheels+Functional Parts）= Garage 主尺度验收口径
      const core = vehicleScreenBounds(snap.vehicleA, r.transform, false);
      const env = vehicleScreenBounds(snap.vehicleA, r.transform, true);
      // 完整入画（core + envelope 均在屏内）
      for (const b of [core, env]) {
        expect(b.minX).toBeGreaterThanOrEqual(-1);
        expect(b.maxX).toBeLessThanOrEqual(vp.w + 1);
        expect(b.minY).toBeGreaterThanOrEqual(-1);
        expect(b.maxY).toBeLessThanOrEqual(vp.h + 1);
      }
      // F-UX-3A：完整车辆 envelope 不进入右侧 panelRect——左缘 ≥ vehicleRect 左缘、
      // 右缘 ≤ vehicleRect 右缘（整辆车完整落在左侧展示区内）
      expect(env.minX, `${vp.w}×${vp.h} envelope 左缘 ≥ vehicleRect 左缘`).toBeGreaterThanOrEqual(framingRect.x - 1);
      expect(env.maxX, `${vp.w}×${vp.h} envelope 右缘 ≤ vehicleRect 右缘（不进入 panelRect）`).toBeLessThanOrEqual(framingRect.x + framingRect.w + 1);
      // envelope 中心位于展示区内 + 垂直居中（容差 8px）
      const centerX = (env.minX + env.maxX) / 2;
      const centerY = (env.minY + env.maxY) / 2;
      expect(centerX, `${vp.w}×${vp.h} envelope 中心 x 在展示区`).toBeGreaterThanOrEqual(framingRect.x - 2);
      expect(centerX, `${vp.w}×${vp.h} envelope 中心 x 在展示区内`).toBeLessThanOrEqual(framingRect.x + framingRect.w + 2);
      expect(centerY, `${vp.w}×${vp.h} envelope 中心 y 在展示区`).toBeGreaterThanOrEqual(framingRect.y - 2);
      expect(centerY, `${vp.w}×${vp.h} envelope 中心 y 在展示区内`).toBeLessThanOrEqual(framingRect.y + framingRect.h + 2);
      const rectCenterY = framingRect.y + framingRect.h / 2;
      expect(
        Math.abs(centerY - rectCenterY),
        `${vp.w}×${vp.h} envelope 中心 y ${centerY.toFixed(1)} 应接近展示区中点 ${rectCenterY.toFixed(1)}（|Δ|≤8）`,
      ).toBeLessThanOrEqual(8);
      // F-GARAGE-CENTER-STAGE-P0：envelope（完整车辆）主尺度——中央舞台全宽取景，vehicle 宽约占屏 38~48%（Must#2）
      const envRatio = (env.maxX - env.minX) / vp.w;
      expect(envRatio, `${vp.w}×${vp.h} envelope 占比 ${(envRatio * 100).toFixed(1)}% 应 ∈ [35%,55%]`).toBeGreaterThanOrEqual(0.35);
      expect(envRatio, `${vp.w}×${vp.h} envelope 占比 ${(envRatio * 100).toFixed(1)}% 应 ≤ 55%`).toBeLessThanOrEqual(0.55);
      // core 仍存在且 < envelope（双口径并存）
      const coreRatio = (core.maxX - core.minX) / vp.w;
      expect(coreRatio, 'core 占屏 > 0').toBeGreaterThan(0);
      expect(coreRatio, 'core < envelope（双口径并存）').toBeLessThan(envRatio);
    });
  }

  it('F-WX-RCA-3A｜多 Body core 完整入画（覆盖最窄/最宽/最高/最低 core）+ 真实微信 621×351 DPR1.5', () => {
    const vps: Array<{ w: number; h: number; dpr: number }> = [
      { w: 844, h: 390, dpr: 1 },
      { w: 621, h: 351, dpr: 1.5 }, // 真实微信 logical viewport，DPR=1.5
    ];
    for (const vp of vps) {
      const { w, h, dpr } = vp;
      for (const bodyId of registry.bodies.keys()) {
        const canvas = {
          getContext: () => makeStubCtx(),
          clientWidth: w,
          clientHeight: h,
          width: Math.round(w * dpr),
          height: Math.round(h * dpr),
        } as unknown as HTMLCanvasElement;
        const surface: CanvasSurface = {
          width: Math.round(w * dpr),
          height: Math.round(h * dpr),
          devicePixelRatio: dpr,
          now: () => 0,
        };
        const o = new PlanckBattleOrchestrator(
          buildSnapshotFromDraft(makeStarterDraft(bodyId as never, registry), registry, 'a'),
          buildSnapshotFromDraft(makeStarterDraft(bodyId as never, registry), registry, 'b'),
          registry,
          { autoDrive: false, engine: 'planck', spawnA: { x: 620, y: 640, facing: 1 }, spawnB: { x: 980, y: 640, facing: -1 } },
          true, // soloA
        );
        const r = new Renderer(canvas, new VisualRegistry(), surface);
        const snap = o.getRenderSnapshot();
        r.resize(snap.arena.width, o.arena.config.height);
        // F-WX-UI-F1：唯一布局源 vehicleRect（多 Body 用例；insets=0）
        const framingRect = computeMobileGarageLayout({ w, h }, { left: 0, right: 0, top: 0, bottom: 0 }).vehicleRect;
        r.reframe(snap, 'previewSolo', { framingRect });
        const d = r.scaleDiagnostics(snap);
        // core 完整入画（screen 为物理 px → /dpr 换算逻辑 px 判定）
        const s = d.core.screen;
        const L = s.minX / dpr;
        const R = s.maxX / dpr;
        const T = s.minY / dpr;
        const B = s.maxY / dpr;
        expect(L, `${bodyId} @${w}x${h} core 左缘入画`).toBeGreaterThanOrEqual(-1);
        expect(R, `${bodyId} @${w}x${h} core 右缘入画`).toBeLessThanOrEqual(w + 1);
        expect(T, `${bodyId} @${w}x${h} core 顶缘入画`).toBeGreaterThanOrEqual(-1);
        expect(B, `${bodyId} @${w}x${h} core 底缘入画`).toBeLessThanOrEqual(h + 1);
        // 任何 body 都有可见主体（core 屏宽 > 0）
        expect(d.core.screenWidthPct, `${bodyId} @${w}x${h} core 占屏 > 0`).toBeGreaterThan(0);
      }
    }
  });
});
