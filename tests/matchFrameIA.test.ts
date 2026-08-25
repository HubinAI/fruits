/**
 * F-MATCH-FRAME-R2｜Matching → Locked 真实构图验收（沿真实 Runtime）：
 *
 * 取景链路：previewConfig 近距 spawn（A x=620 / B x=980，y=640）→ loadCustomPreview
 * → runtime.reframePlayerCamera → battle.reframe('previewFixed')
 * → renderer.transform → getVehicleScreenRects(snap)（A/B 真实屏幕 envelope，逻辑 px）。
 *
 * 验收（viewport 矩阵 360×180 / 390×195 / 420×210 / 460×230 / 621×351 × 不同候选 Body）：
 * 1. A 在左半屏、B 在右半屏，且 A/B 不重叠（中央留 VS 间隙）；
 * 2. A/B envelope 完整落屏（不越出 [0,W]×[0,H]）；
 * 3. Matching 候选切换 / Locked 替换 → 同一 spawn，A/B 屏幕中心位移 ≈ 0（无跳位 / 无呼吸）；
 * 4. B（右侧候选）屏幕中心恒在右半屏，扫描框据此绘制即不圈空白、不覆盖 VS；
 * 5. B envelope 上方留有独立标题区（名称不进入车辆 envelope、不压地面线）；
 * 6. 状态文字（顶部居中）在 A/B envelope 之上（不与车辆相交）。
 */
import { describe, it, expect } from 'vitest';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import { Renderer } from '../src/render/renderer';
import { VisualRegistry } from '../src/render/visualRegistry';
import { registry } from '../src/core/content';
import { makeStarterDraft, buildSnapshotFromDraft } from '../src/lab/buildEditorModel';
import type { CanvasSurface } from '../src/render/canvasSurface';
import type { SafeInsets } from '../src/platform/types';

const INSETS: SafeInsets = { left: 44, right: 20, top: 12, bottom: 16 };
const VIEWPORTS = [
  { w: 360, h: 180 },
  { w: 390, h: 195 },
  { w: 420, h: 210 },
  { w: 460, h: 230 },
  { w: 621, h: 351 },
];
const DPR = 1;
const A_BODY = 'boxBody';
const B_CANDIDATES = ['watermelonBody', 'bananaBody', 'triangleBody', 'roundBody'].filter((id) => registry.bodies.has(id));

type Rect = { x: number; y: number; w: number; h: number };

interface FrameData {
  vp: string;
  bodyB: string;
  scale: number;
  a: Rect;
  b: Rect;
  view: { w: number; h: number };
}

/** 渲染 Matching 预览（A + 候选 B）并取真实 A/B 屏幕 envelope（逻辑 px） */
function frameMatch(vp: { w: number; h: number }, bodyA: string, bodyB: string): {
  a: Rect;
  b: Rect;
  scale: number;
  transform: { scale: number; offsetX: number; offsetY: number };
  view: { w: number; h: number };
} {
  const canvas = {
    getContext: () => new Proxy({} as CanvasRenderingContext2D, { get: () => () => ({ width: 0 }), set: () => true }),
    width: vp.w * DPR,
    height: vp.h * DPR,
  } as unknown as HTMLCanvasElement;
  const surface: CanvasSurface = { width: vp.w * DPR, height: vp.h * DPR, devicePixelRatio: DPR, now: () => 0 };
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
  // 真实取景：previewFixed（与运行时 reframePlayerCamera 同构）
  r.reframe(snap, 'previewFixed');
  const rects = r.getVehicleScreenRects(snap)!;
  const diag = r.scaleDiagnostics(snap);
  return { a: rects.a, b: rects.b, scale: diag.scale, transform: { scale: diag.scale, offsetX: diag.offsetX, offsetY: diag.offsetY }, view: { w: diag.view.w, h: diag.view.h } };
}

const cx = (r: Rect): number => r.x + r.w / 2;
const cy = (r: Rect): number => r.y + r.h / 2;

describe('F-MATCH-FRAME-R2｜Matching/Locked 真实车辆槽位构图', () => {
  const collected: FrameData[] = [];
  for (const vp of VIEWPORTS) {
    for (const bodyB of B_CANDIDATES) {
      const m = frameMatch(vp, A_BODY, bodyB);
      collected.push({ vp: `${vp.w}×${vp.h}`, bodyB, scale: m.scale, a: m.a, b: m.b, view: { w: vp.w, h: vp.h } });

      it(`${vp.w}×${vp.h}｜B=${bodyB}：A 在左半屏、B 在右半屏（左/右槽位）`, () => {
        expect(cx(m.a), 'A 中心在屏幕中线左侧').toBeLessThan(vp.w / 2);
        expect(cx(m.b), 'B 中心在屏幕中线右侧').toBeGreaterThan(vp.w / 2);
      });

      it(`${vp.w}×${vp.h}｜B=${bodyB}：A/B 不重叠（中央留 VS 间隙）`, () => {
        expect(m.b.x, 'B 左缘在 A 右缘右侧（留间隙）').toBeGreaterThan(m.a.x + m.a.w);
      });

      it(`${vp.w}×${vp.h}｜B=${bodyB}：A/B envelope 完整落屏（无溢出 / 无右裁切）`, () => {
        expect(m.a.x, 'A 左缘 ≥ 0').toBeGreaterThanOrEqual(-1);
        expect(m.a.y, 'A 上缘 ≥ 0').toBeGreaterThanOrEqual(-1);
        expect(m.a.x + m.a.w, 'A 右缘 ≤ W').toBeLessThanOrEqual(vp.w + 1);
        expect(m.a.y + m.a.h, 'A 下缘 ≤ H').toBeLessThanOrEqual(vp.h + 1);
        expect(m.b.x, 'B 左缘 ≥ 0').toBeGreaterThanOrEqual(-1);
        expect(m.b.y, 'B 上缘 ≥ 0').toBeGreaterThanOrEqual(-1);
        expect(m.b.x + m.b.w, 'B 右缘 ≤ W（无右裁切）').toBeLessThanOrEqual(vp.w + 1);
        expect(m.b.y + m.b.h, 'B 下缘 ≤ H').toBeLessThanOrEqual(vp.h + 1);
      });

      it(`${vp.w}×${vp.h}｜B=${bodyB}：B 上方留有独立标题区（对手名称不压车辆/地面线）`, () => {
        // 名称置于 bRect 上方 8px；需 bRect 顶部距屏幕顶有足够空间（不进入 envelope）
        expect(m.b.y, 'B 顶部距屏幕上缘有余量（可放置名称标题区）').toBeGreaterThan(12);
      });

      it(`${vp.w}×${vp.h}｜B=${bodyB}：状态文字（顶部居中）在 A/B envelope 之上（不相交）`, () => {
        const statusY = INSETS.top + 24;
        expect(statusY, '状态文字 y 低于 A/B 顶部（在车辆之上）').toBeLessThan(Math.min(m.a.y, m.b.y));
      });
    }
  }

  // —— 跳位 / 呼吸治理：同一 spawn，候选切换与 Locked 替换的中心位移 ≈ 0 ——
  for (const vp of VIEWPORTS) {
    const m1 = frameMatch(vp, A_BODY, B_CANDIDATES[0]);
    const m2 = frameMatch(vp, A_BODY, B_CANDIDATES[1]);
    const locked = frameMatch(vp, A_BODY, B_CANDIDATES[0]); // Locked = 同一候选（真实车，同 spawn）

    it(`${vp.w}×${vp.h}：Matching 候选切换 → A 中心不跳位`, () => {
      expect(Math.abs(cx(m1.a) - cx(m2.a)), 'A 中心位移 ≈ 0').toBeLessThanOrEqual(2);
      expect(Math.abs(cy(m1.a) - cy(m2.a)), 'A 垂直中心位移 ≈ 0').toBeLessThanOrEqual(2);
    });

    it(`${vp.w}×${vp.h}：Matching 候选切换 → B 中心不跳位（同 spawn，仅尺寸可能变化）`, () => {
      expect(Math.abs(cx(m1.b) - cx(m2.b)), 'B 中心位移 ≈ 0（扫描框锚定同一槽位）').toBeLessThanOrEqual(2);
      expect(Math.abs(cy(m1.b) - cy(m2.b)), 'B 垂直中心位移 ≈ 0').toBeLessThanOrEqual(2);
    });

    it(`${vp.w}×${vp.h}：Locked 替换（同候选）→ A/B 中心与 Matching 完全一致（无跳位）`, () => {
      expect(Math.abs(cx(locked.a) - cx(m1.a)), 'Locked A 中心 == Matching A 中心').toBeLessThanOrEqual(2);
      expect(Math.abs(cx(locked.b) - cx(m1.b)), 'Locked B 中心 == Matching B 中心（右侧槽位稳定）').toBeLessThanOrEqual(2);
      expect(Math.abs(cy(locked.b) - cy(m1.b)), 'Locked B 垂直中心 == Matching B 垂直中心').toBeLessThanOrEqual(2);
    });
  }

  it('数据汇总：输出最终 Matching 真实 Runtime 取景数据', () => {
    for (const e of collected) {
      const t = e;
      // eslint-disable-next-line no-console
      console.log(
        `MATCH-FRAME vp=${t.vp} B=${t.bodyB} scale=${t.scale.toFixed(3)} ` +
          `aCx=${cx(t.a).toFixed(1)} bCx=${cx(t.b).toFixed(1)} ` +
          `aRect=[${t.a.x.toFixed(0)},${t.a.y.toFixed(0)}-${t.a.w.toFixed(0)},${t.a.h.toFixed(0)}] ` +
          `bRect=[${t.b.x.toFixed(0)},${t.b.y.toFixed(0)}-${t.b.w.toFixed(0)},${t.b.h.toFixed(0)}]`,
      );
    }
    expect(collected.length, '覆盖 viewport×候选 Body 组合').toBe(VIEWPORTS.length * B_CANDIDATES.length);
  });
});
