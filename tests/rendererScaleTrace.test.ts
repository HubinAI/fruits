/**
 * F-WX-9A｜DEV-only 取景尺度日志 [WX-REF] 运行时验证。
 *
 * 目标：证明 Renderer reframe 的 DEV 日志能输出「真实车辆屏宽占比」，
 * 且：
 * 1. Garage previewSolo（含 framingRect）→ screenWidthPct ∈ [28%, 38%]；
 * 2. Battle Active → screenWidthPct ∈ [18%, 28%]；
 * 3. DPR=2（surface 物理像素 1688×780）与 DPR=1（844×390）逻辑空间一致
 *    → 两次 reframe 的占比差 < 2pp（尺度链自洽的直接证据；若差异大 = 尺度链错误）；
 * 4. __WX_DEBUG__=false/undefined → 零 [WX-REF] 输出（PROD 不输出日志）。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import { Renderer } from '../src/render/renderer';
import { VisualRegistry } from '../src/render/visualRegistry';
import { registry } from '../src/core/content';
import { makeStarterDraft, buildSnapshotFromDraft } from '../src/lab/buildEditorModel';
import type { CanvasSurface } from '../src/render/canvasSurface';

function makeStubCtx(): CanvasRenderingContext2D {
  const handler = { get: () => () => ({ width: 0 }), set: () => true };
  return new Proxy({} as CanvasRenderingContext2D, handler);
}

function makeEnv(vp: { w: number; h: number }, dpr: number) {
  const canvas = {
    getContext: () => makeStubCtx(),
    clientWidth: vp.w,
    clientHeight: vp.h,
    width: vp.w * dpr,
    height: vp.h * dpr,
  } as unknown as HTMLCanvasElement;
  const surface: CanvasSurface = { width: vp.w * dpr, height: vp.h * dpr, devicePixelRatio: dpr, now: () => 0 };
  const o = new PlanckBattleOrchestrator(
    buildSnapshotFromDraft(makeStarterDraft('watermelonBody', registry), registry, 'a'),
    buildSnapshotFromDraft(makeStarterDraft('bananaBody', registry), registry, 'b'),
    registry,
    { autoDrive: false, engine: 'planck', spawnA: { x: 620, y: 640, facing: 1 }, spawnB: { x: 980, y: 640, facing: -1 } },
    true, // soloA（Garage preview 语义）
  );
  const r = new Renderer(canvas, new VisualRegistry(), surface);
  return { r, o };
}

/** 抓取最后一次 [WX-REF] 日志的 JSON 主体 */
function lastWxRef(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> | null {
  const call = spy.mock.calls.find((c: unknown[]) => c[0] === '[WX-REF]');
  if (!call) return null;
  return JSON.parse(String(call[1])) as Record<string, unknown>;
}

describe('F-WX-9A｜[WX-REF] reframe 尺度日志（DEV-only）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('Garage previewSolo（framingRect 左侧展示区）：screenWidthPct ∈ [28%,38%]', () => {
    vi.stubGlobal('__WX_DEBUG__', true);
    const { r, o } = makeEnv({ w: 844, h: 390 }, 1);
    const snap = o.getRenderSnapshot();
    r.resize(snap.arena.width, o.arena.config.height);
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    // Mobile Garage 左侧展示区（与 CanvasHost getPreviewFramingRect 同语义）
    r.reframe(snap, 'previewSolo', { framingRect: { x: 10, y: 62, w: 450, h: 250 } });
    const log = lastWxRef(spy);
    expect(log, '应有 [WX-REF] 日志').not.toBeNull();
    const vehicle = log!.vehicleA as { screenWidthPct: number; world: unknown; screen: unknown };
    expect(vehicle.screenWidthPct).toBeGreaterThanOrEqual(28);
    expect(vehicle.screenWidthPct).toBeLessThanOrEqual(38);
    expect((log!.view as { dpr: number }).dpr).toBe(1);
  });

  it('Battle Active：screenWidthPct ∈ [24%,30%]（F-WX-9C corridor 收窄后三屏统一 24.4%）', () => {
    vi.stubGlobal('__WX_DEBUG__', true);
    const { r, o } = makeEnv({ w: 844, h: 390 }, 1);
    const snap = o.getRenderSnapshot();
    r.resize(snap.arena.width, o.arena.config.height);
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    r.reframe(snap, 'battle', { phase: 'Active' });
    const log = lastWxRef(spy);
    expect(log, '应有 [WX-REF] 日志').not.toBeNull();
    expect(log!.fit).toBe('battle');
    expect(log!.framingRect).toBeNull();
    const vehicle = log!.vehicleA as { screenWidthPct: number };
    expect(vehicle.screenWidthPct).toBeGreaterThanOrEqual(24);
    expect(vehicle.screenWidthPct).toBeLessThanOrEqual(30);
  });

  it('DPR=2（surface 1688×780 物理）与 DPR=1（844×390）逻辑占比一致（尺度链自洽）', () => {
    vi.stubGlobal('__WX_DEBUG__', true);
    const pcts: number[] = [];
    for (const dpr of [1, 2]) {
      const { r, o } = makeEnv({ w: 844, h: 390 }, dpr);
      const snap = o.getRenderSnapshot();
      r.resize(snap.arena.width, o.arena.config.height);
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      r.reframe(snap, 'previewSolo', { framingRect: { x: 10, y: 62, w: 450, h: 250 } });
      const log = lastWxRef(spy);
      expect(log).not.toBeNull();
      expect((log!.view as { dpr: number }).dpr).toBe(dpr);
      pcts.push((log!.vehicleA as { screenWidthPct: number }).screenWidthPct);
      vi.restoreAllMocks();
    }
    // dpr 只改物理像素，不改逻辑空间 → 占比差必须 < 2pp
    expect(Math.abs(pcts[0] - pcts[1]), `dpr=1 ${pcts[0]}% vs dpr=2 ${pcts[1]}%`).toBeLessThan(2);
  });

  it('__WX_DEBUG__=false / undefined：零 [WX-REF] 输出（PROD 不输出日志）', () => {
    for (const v of [false, undefined]) {
      if (v === undefined) vi.unstubAllGlobals();
      else vi.stubGlobal('__WX_DEBUG__', false);
      const { r, o } = makeEnv({ w: 844, h: 390 }, 1);
      const snap = o.getRenderSnapshot();
      r.resize(snap.arena.width, o.arena.config.height);
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      r.reframe(snap, 'previewSolo');
      expect(spy.mock.calls.some((c) => c[0] === '[WX-REF]'), `${String(v)} 不应输出 [WX-REF]`).toBe(false);
      vi.restoreAllMocks();
    }
  });
});
