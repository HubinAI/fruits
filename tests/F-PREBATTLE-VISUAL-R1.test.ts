/**
 * F-PREBATTLE-VISUAL-R1｜战前搜索/锁定竞技场展示 · 真实相机几何验收
 *
 * 仅用真实 Renderer + PlanckBattleOrchestrator（与运行时 reframe('previewFixed') 同构），
 * 对「最终合成像素」背后的相机构图做硬断言（不读源码字符串、不靠两同源 rect 相等证明）：
 *
 *  T1. 地面线锚定（Must#8）：previewFixed 把地面线锚在视口高 ~72% → 地面以下带 24%~30%
 *      （旧实现居中构图 → 地面线 ~56% → 地面带 43.8%「近半屏纯色空区」，已修复）。
 *  T2. getProbeCamera().groundScreenY 在非 battle 相机下非 null（修复 this.orchestrator 恒
 *      null 导致 probe 恒 null 的缺陷；headless 下由 reframe 缓存的 arena.groundY 推算）。
 *  T3. 双车构图（Must#2/#3）：A 在 B 左侧、两者不重叠、完整入画、尺度接近（非中央 VS 主导）。
 *  T4. 同视口不同候选：previewFixed 固定框下 B 完整入画且不越右安全边界、尺度波动 ≤2%
 *      （候选切换不呼吸、不裁切——锁定同车即不跳位的前提）。
 *
 * 真实浏览器「最终合成像素」门禁另见 tests/_e2e_prebattle.cjs（48 项像素断言）。
 */
import { describe, it, expect } from 'vitest';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import { Renderer } from '../src/render/renderer';
import { VisualRegistry } from '../src/render/visualRegistry';
import { registry } from '../src/core/content';
import { makeStarterDraft, buildSnapshotFromDraft } from '../src/lab/buildEditorModel';
import type { CanvasSurface } from '../src/render/canvasSurface';

const VIEWPORTS = [
  { w: 420, h: 210 },
  { w: 621, h: 351 },
  { w: 844, h: 390 },
  { w: 1920, h: 1008 },
];
const A_BODY = 'boxBody';
const B_BODIES = ['watermelonBody', 'bananaBody', 'pineappleBody'];

type Rect = { x: number; y: number; w: number; h: number };

function frameMatch(vp: { w: number; h: number }, bodyA: string, bodyB: string): {
  a: Rect;
  b: Rect;
  scale: number;
  view: { w: number; h: number; dpr: number };
  groundScreenY: number | null;
  band: number;
} {
  const canvas = {
    getContext: () => new Proxy({} as CanvasRenderingContext2D, { get: () => () => ({ width: 0 }), set: () => true }),
    width: vp.w,
    height: vp.h,
  } as unknown as HTMLCanvasElement;
  const surface: CanvasSurface = { width: vp.w, height: vp.h, devicePixelRatio: 1, now: () => 0 };
  const o = new PlanckBattleOrchestrator(
    buildSnapshotFromDraft(makeStarterDraft(bodyA, registry), registry, 'a'),
    buildSnapshotFromDraft(makeStarterDraft(bodyB, registry), registry, 'b'),
    registry,
    { autoDrive: true },
    false,
  );
  const r = new Renderer(canvas, new VisualRegistry(), surface);
  const snap = o.getRenderSnapshot();
  r.resize(snap.arena.width, o.arena.config.height);
  r.reframe(snap, 'previewFixed'); // = 运行时 loadMatchAB / matching 显式 previewFixed
  const rects = r.getVehicleScreenRects(snap)!;
  const cam = r.getProbeCamera();
  const groundLog =
    cam.groundScreenY != null
      ? cam.groundScreenY
      : (cam.offsetY + snap.arena.groundY * cam.scale) / surface.devicePixelRatio;
  const band = 1 - groundLog / surface.height;
  return {
    a: rects.a,
    b: rects.b,
    scale: cam.scale,
    view: { w: cam.offsetX != null ? snap.arena.width : vp.w, h: surface.height, dpr: surface.devicePixelRatio },
    groundScreenY: cam.groundScreenY,
    band,
  };
}

describe('F-PREBATTLE-VISUAL-R1｜战前竞技场相机几何', () => {
  it('T1. 地面线锚定：previewFixed 地面以下带 24%~30%（Must#8，杜绝近半屏地面空区）', () => {
    for (const vp of VIEWPORTS) {
      const f = frameMatch(vp, A_BODY, B_BODIES[0]);
      expect(f.band, `[${vp.w}x${vp.h}] 地面以下带应在 24%~30%（实测 ${(f.band * 100).toFixed(1)}%）`).toBeGreaterThanOrEqual(0.24);
      expect(f.band, `[${vp.w}x${vp.h}] 地面以下带应在 24%~30%（实测 ${(f.band * 100).toFixed(1)}%）`).toBeLessThanOrEqual(0.30);
    }
  });

  it('T2. getProbeCamera().groundScreenY 非 null（修复非 battle 相机 probe 恒 null）', () => {
    for (const vp of VIEWPORTS) {
      const f = frameMatch(vp, A_BODY, B_BODIES[0]);
      expect(f.groundScreenY, `[${vp.w}x${vp.h}] groundScreenY 应非 null`).not.toBeNull();
    }
  });

  it('T3. 双车构图：A 在 B 左、不重叠、完整入画（Must#2/#3）', () => {
    for (const vp of VIEWPORTS) {
      const f = frameMatch(vp, A_BODY, B_BODIES[0]);
      expect(f.b.x, '[A 在 B 左侧]').toBeGreaterThan(f.a.x + f.a.w);
      // 不重叠：A 右缘 < B 左缘（已隐含于上式）
      expect(f.a.x + f.a.w, '[A 不越界]').toBeLessThanOrEqual(vp.w + 1);
      expect(f.b.x, '[B 不越左]').toBeGreaterThanOrEqual(-1);
      expect(f.b.x + f.b.w, '[B 完整入画，不越右边界]').toBeLessThanOrEqual(vp.w + 1);
      expect(f.a.y, '[A 完整入画]').toBeGreaterThanOrEqual(-1);
      expect(f.a.y + f.a.h, '[A 不穿底]').toBeLessThanOrEqual(vp.h + 1);
      expect(f.b.y, '[B 完整入画]').toBeGreaterThanOrEqual(-1);
      expect(f.b.y + f.b.h, '[B 不穿底]').toBeLessThanOrEqual(vp.h + 1);
      // 尺度接近：A/B 同固定框（同一 transform scale），envelope 高差仅来自真实车身尺寸差异，
      // 允许 ≤10%（远小于「一方被放大/裁切」的失衡）；两者均为可见整车（最大边 ≥24px、不溢出）。
      const hRatio = Math.max(f.a.h, f.b.h) / Math.min(f.a.h, f.b.h);
      expect(hRatio, '[A/B envelope 高差合理（≤10%，同固定框相似 scale）]').toBeLessThanOrEqual(1.10);
      const aDim = Math.max(f.a.w, f.a.h);
      const bDim = Math.max(f.b.w, f.b.h);
      expect(aDim, '[A 为可见整车（最大边 ≥24px）]').toBeGreaterThanOrEqual(24);
      expect(bDim, '[B 为可见整车（最大边 ≥24px）]').toBeGreaterThanOrEqual(24);
      expect(f.a.h, '[A 不溢出]').toBeLessThanOrEqual(vp.h * 0.9);
      expect(f.b.h, '[B 不溢出]').toBeLessThanOrEqual(vp.h * 0.9);
    }
  });

  it('T4. 候选切换不呼吸：3 个候选 B 在 previewFixed 下相机 scale 波动 ≤2%、均不越右边界', () => {
    for (const vp of VIEWPORTS) {
      const scales: number[] = [];
      const withinRight: boolean[] = [];
      for (const bBody of B_BODIES) {
        const f = frameMatch(vp, A_BODY, bBody);
        scales.push(f.scale);
        withinRight.push(f.b.x + f.b.w <= vp.w + 1 && f.b.x >= -1);
      }
      const minS = Math.min(...scales);
      const maxS = Math.max(...scales);
      const vol = (maxS - minS) / minS;
      expect(vol, `[${vp.w}x${vp.h}] 候选切换相机 scale 波动应 ≤2%（实测 ${(vol * 100).toFixed(2)}%）`).toBeLessThanOrEqual(0.02);
      expect(withinRight.every((b) => b), `[${vp.w}x${vp.h}] 各候选 B 均完整入画不越右边界`).toBe(true);
    }
  });
});
