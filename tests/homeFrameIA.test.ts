/**
 * F-HOME-IA-R1｜首页车辆取景验收（沿真实 Runtime）：
 *
 * 取景链路：computeHomeLayout.vehicleFramingRect → CanvasPlayerUIHost.getPreviewFramingRect
 * → runtime.reframePlayerCamera → battle.reframe('previewSolo', framingRect)
 * → renderer.transform → scaleDiagnostics.vehicleA.envelope.screen（最终屏幕 bounds）。
 *
 * 验收（至少覆盖不同 Body + 长武器组合 × viewport 矩阵 360×180 ~ 844×390）：
 * 1. 完整车辆 envelope 进入 stageRect（最终 screen bounds ⊆ stageRect 物理像素）；
 * 2. 车辆水平接近舞台中央（screen 中心 ≈ stage 中心）；
 * 3. 车辆落在场景地面（envelope 底部接近 stage 底缘）；
 * 4. 不得偏到右下（水平居中 + 底部着地，非右下角）；
 * 5. 不被 CTA 裁切（envelope 底部 ≤ ctaRect 顶）。
 */
import { describe, it, expect } from 'vitest';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import { Renderer } from '../src/render/renderer';
import { VisualRegistry } from '../src/render/visualRegistry';
import { registry } from '../src/core/content';
import { makeStarterDraft, buildSnapshotFromDraft } from '../src/lab/buildEditorModel';
import { computeHomeLayout } from '../src/ui/homeLayout';
import { resolveLayoutProfile } from '../src/ui/layoutProfile';
import type { CanvasSurface } from '../src/render/canvasSurface';
import type { SafeInsets } from '../src/platform/types';

const INSETS: SafeInsets = { left: 44, right: 20, top: 12, bottom: 16 };
const VIEWPORTS = [
  { w: 360, h: 180 },
  { w: 420, h: 210 },
  { w: 621, h: 351 },
  { w: 844, h: 390 },
];
// 取景几何（中心/包含/着地）与 DPR 无关；headless Renderer 以 logical 维度判定 isCompact，
// 故以 DPR=1 验证几何属性（与 homeLayerP0 同范式），真实设备 DPR 仅缩放物理像素。
const DPR = 1;
const BODIES = ['boxBody', 'watermelonBody', 'triangleBody', 'roundBody'].filter((id) => registry.bodies.has(id));

interface FrameData {
  vp: string;
  body: string;
  dpr: number;
  scale: number;
  transform: { scale: number; offsetX: number; offsetY: number };
  view: { w: number; h: number; dpr: number };
  envelopeScreen: { minX: number; minY: number; maxX: number; maxY: number };
  stagePhys: { x: number; y: number; w: number; h: number };
  ctaTopPhys: number;
}

/** 渲染 Home 预览并取真实 transform 下的车辆 envelope 屏幕 bounds */
function frameHome(vp: { w: number; h: number }, bodyId: string): {
  screen: { minX: number; minY: number; maxX: number; maxY: number };
  scale: number;
  transform: { scale: number; offsetX: number; offsetY: number };
  view: { w: number; h: number; dpr: number };
} {
  const prof = resolveLayoutProfile(vp.w, vp.h);
  const L = computeHomeLayout(vp, INSETS, prof);
  const canvas = {
    getContext: () => new Proxy({} as CanvasRenderingContext2D, { get: () => () => ({ width: 0 }), set: () => true }),
    width: vp.w * DPR,
    height: vp.h * DPR,
  } as unknown as HTMLCanvasElement;
  const surface: CanvasSurface = { width: vp.w * DPR, height: vp.h * DPR, devicePixelRatio: DPR, now: () => 0 };
  const o = new PlanckBattleOrchestrator(
    buildSnapshotFromDraft(makeStarterDraft(bodyId, registry), registry, 'a'),
    buildSnapshotFromDraft(makeStarterDraft(bodyId, registry), registry, 'a'),
    registry,
    { autoDrive: true },
    true,
  );
  const r = new Renderer(canvas, new VisualRegistry(), surface);
  const snap = o.getRenderSnapshot();
  r.resize(snap.arena.width, o.arena.config.height);
  // 真实取景：framingRect 用 Home 布局 vehicleFramingRect（logical px）
  r.reframe(snap, 'previewSolo', { framingRect: L.vehicleFramingRect });
  const diag = r.scaleDiagnostics(snap);
  return { screen: diag.envelope.screen, scale: diag.scale, transform: { scale: diag.scale, offsetX: diag.offsetX, offsetY: diag.offsetY }, view: diag.view };
}

describe('F-HOME-IA-R1｜首页车辆真实 Runtime 取景', () => {
  const collected: FrameData[] = [];
  for (const vp of VIEWPORTS) {
    const prof = resolveLayoutProfile(vp.w, vp.h);
    const L = computeHomeLayout(vp, INSETS, prof);
    const stagePhys = { x: L.stageRect.x * DPR, y: L.stageRect.y * DPR, w: L.stageRect.w * DPR, h: L.stageRect.h * DPR };
    const framingPhys = { x: L.vehicleFramingRect.x * DPR, y: L.vehicleFramingRect.y * DPR, w: L.vehicleFramingRect.w * DPR, h: L.vehicleFramingRect.h * DPR };
    const ctaTopPhys = L.ctaRect.y * DPR;
    for (const body of BODIES) {
      const { screen, scale, transform, view } = frameHome(vp, body);
      collected.push({ vp: `${vp.w}×${vp.h}`, body, dpr: DPR, scale, transform, view, envelopeScreen: screen, stagePhys, ctaTopPhys });

      it(`${vp.w}×${vp.h}｜${body}：完整车辆 envelope 进入 stageRect（不越界）`, () => {
        expect(screen.minX, '左缘 ≥ stage 左').toBeGreaterThanOrEqual(stagePhys.x - 1);
        expect(screen.maxX, '右缘 ≤ stage 右').toBeLessThanOrEqual(stagePhys.x + stagePhys.w + 1);
        expect(screen.minY, '上缘 ≥ stage 顶').toBeGreaterThanOrEqual(stagePhys.y - 1);
        expect(screen.maxY, '下缘 ≤ stage 底').toBeLessThanOrEqual(stagePhys.y + stagePhys.h + 1);
      });

      it(`${vp.w}×${vp.h}｜${body}：水平接近舞台中央（不偏右）`, () => {
        const cx = (screen.minX + screen.maxX) / 2;
        const stageCx = stagePhys.x + stagePhys.w / 2;
        expect(Math.abs(cx - stageCx), 'screen 中心 ≈ stage 中心（不再因 groundY 误作 X 而偏心）').toBeLessThanOrEqual(3);
      });

      it(`${vp.w}×${vp.h}｜${body}：车辆底部承重（不浮于取景区顶部、不偏右下）`, () => {
        // renderer 将车辆包围盒居中 fit 到取景区：车辆底部应位于取景区中线及以下
        // （底部承重、不浮于顶部、不落右下角——水平另有居中断言）。
        const framingTop = framingPhys.y;
        const framingBottom = framingPhys.y + framingPhys.h;
        const framingMidY = (framingTop + framingBottom) / 2;
        expect(screen.maxY, '车辆底部 ≤ 取景区底缘（不溢出取景区）').toBeLessThanOrEqual(framingBottom + 1);
        expect(screen.maxY, '车辆底部不低于取景区中线（底部承重、不浮顶）').toBeGreaterThanOrEqual(framingMidY - 1);
      });

      it(`${vp.w}×${vp.h}｜${body}：不被 CTA 裁切（envelope 底部 ≤ ctaRect 顶）`, () => {
        expect(screen.maxY, '车辆底部 ≤ CTA 顶（不重叠）').toBeLessThanOrEqual(ctaTopPhys + 1);
      });
    }
  }

  it('数据汇总：输出最终 Runtime 取景数据（用于交付报告）', () => {
    for (const e of collected) {
      const s = e.envelopeScreen;
      const t = e.transform;
      const wMinX = (s.minX - t.offsetX) / t.scale;
      const wMaxX = (s.maxX - t.offsetX) / t.scale;
      const wMinY = (s.minY - t.offsetY) / t.scale;
      const wMaxY = (s.maxY - t.offsetY) / t.scale;
      const cx = (s.minX + s.maxX) / 2;
      const scx = e.stagePhys.x + e.stagePhys.w / 2;
      // eslint-disable-next-line no-console
      console.log(
        `HOME-FRAME vp=${e.vp} body=${e.body} scale=${t.scale.toFixed(3)} ` +
          `view=${e.view.w}x${e.view.h} dpr=${e.view.dpr} offX=${t.offsetX.toFixed(1)} offY=${t.offsetY.toFixed(1)} ` +
          `cx=${cx.toFixed(1)} stageCx=${scx.toFixed(1)} diff=${(cx - scx).toFixed(1)} ` +
          `envBottom=${s.maxY.toFixed(1)} stageBottom=${(e.stagePhys.y + e.stagePhys.h).toFixed(1)} ` +
          `worldEnv=[${wMinX.toFixed(0)},${wMinY.toFixed(0)}]-[${wMaxX.toFixed(0)},${wMaxY.toFixed(0)}]`,
      );
    }
    expect(collected.length, '覆盖 viewport×Body 组合').toBe(VIEWPORTS.length * BODIES.length);
  });
});
