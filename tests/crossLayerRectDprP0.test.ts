import { describe, it, expect, afterEach, vi } from 'vitest';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import { Renderer } from '../src/render/renderer';
import { VisualRegistry } from '../src/render/visualRegistry';
import { registry } from '../src/core/content';
import { makeStarterDraft, buildSnapshotFromDraft } from '../src/lab/buildEditorModel';
import { computeHomeLayout } from '../src/ui/homeLayout';
import { resolveLayoutProfile } from '../src/ui/layoutProfile';
import type { CanvasSurface } from '../src/render/canvasSurface';
import type { FramingRect } from '../src/render/renderer';

/**
 * F-CROSSLAYER-RECT-DPR-P0｜跨层矩形逻辑坐标契约（targeted）
 *
 * 用户环境（Windows 150% 缩放 → DPR=1.5，Web Pages 无 surface 注入）实测：
 *  - 首页绿车 1.5× 放大越出右侧屏幕（framingRect 被 ×viewDpr 后域分裂）；
 *  - Matching 右车 client x≈1220（sx 逻辑 524 × contain 2.275），扫描框 x≈815（524÷1.5=349
 *    × contain 2.275≈794）——getVehicleScreenRects 无条件 ÷viewDpr。
 *
 * 契约：跨层矩形统一 844×390 logical；DPR 仅在最终 backing 绘制阶段使用。
 * viewWidth 域：无 surface（Web）= clientWidth（logical）；注入 surface（微信/单测）= backing。
 * DPR 转换只做「域对齐」（surface 注入时 ÷dpr/×dpr 必需），Web 不做任何转换。
 */
const A_BODY = 'boxBody';
const B_BODY = 'watermelonBody';
const HOME_FRAMING: FramingRect = { x: 0, y: 52, w: 844, h: 278, mode: 'home' };

type Rect = { x: number; y: number; w: number; h: number };
const cx = (r: Rect): number => r.x + r.w / 2;

function makeCanvas(w: number, h: number) {
  return {
    getContext: () => new Proxy({} as CanvasRenderingContext2D, { get: () => () => ({ width: 0 }), set: () => true }),
    width: w,
    height: h,
    clientWidth: w,
    clientHeight: h,
  } as unknown as HTMLCanvasElement;
}

function makeOrch() {
  return new PlanckBattleOrchestrator(
    buildSnapshotFromDraft(makeStarterDraft(A_BODY, registry), registry, 'a'),
    buildSnapshotFromDraft(makeStarterDraft(B_BODY, registry), registry, 'b'),
    registry,
    { autoDrive: true },
    false,
  );
}

describe('F-CROSSLAYER-RECT-DPR-P0', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('T1. A链 Web 域（无 surface, DPR1.5）：previewSolo+home framing → transform 为 logical 域，车辆完整在 844×390 内', () => {
    // 模拟 Web 玩家模式：无 surface 注入 → viewWidth=clientWidth=844（logical）；DPR=1.5 经 window
    vi.stubGlobal('window', { devicePixelRatio: 1.5 });
    const canvas = makeCanvas(844, 390);
    const o = makeOrch();
    const r = new Renderer(canvas, new VisualRegistry()); // 不传 surface（Web 路径）
    const snap = o.getRenderSnapshot();
    r.resize(snap.arena.width, o.arena.config.height);
    r.reframe(snap, 'previewSolo', { framingRect: HOME_FRAMING });
    const diag = r.scaleDiagnostics(snap);
    // 修复前：scale=2.4138（framing×1.5 的 backing 域）→ 绘制再 ×1.5 双倍越界。
    // 修复后：scale=logical 域（≈832/bw，soloEnv 世界宽 ≈517 → ≈1.61）。
    expect(diag.scale, 'scale 应为 logical 域（<2，修复前 2.4138）').toBeLessThan(2);
    expect(diag.scale, 'scale 与 844 域 safeW 自洽（≈1.6 量级）').toBeGreaterThan(1);
    const v = r.getVehicleScreenRects(snap)!.a;
    expect(v.x, 'A 左缘 ≥0').toBeGreaterThanOrEqual(-1);
    expect(v.y, 'A 上缘 ≥0').toBeGreaterThanOrEqual(-1);
    expect(v.x + v.w, 'A 右缘 ≤844（修复前越界 ~926）').toBeLessThanOrEqual(845);
    expect(v.y + v.h, 'A 下缘 ≤390').toBeLessThanOrEqual(391);
    expect(v.w, '车辆可见宽占比 38%~48% 区间（Must#4）').toBeGreaterThan(844 * 0.38);
    expect(v.w, '车辆可见宽 ≤48% 安全舞台（Must#4）').toBeLessThanOrEqual(844 * 0.5);
  });

  it('T2. B链 Web 域（无 surface, DPR1.5）：getVehicleScreenRects 返回 logical（不 ÷dpr），右车中心在右半屏', () => {
    vi.stubGlobal('window', { devicePixelRatio: 1.5 });
    const canvas = makeCanvas(844, 390);
    const o = makeOrch();
    const r = new Renderer(canvas, new VisualRegistry());
    const snap = o.getRenderSnapshot();
    r.resize(snap.arena.width, o.arena.config.height);
    r.reframe(snap, 'previewFixed');
    const m = r.getVehicleScreenRects(snap)!;
    // 修复前：右车 sx 逻辑 524 ÷1.5 = 349（扫描框偏左）；修复后=524（对应 client ≈1220）
    expect(cx(m.b), 'B 中心在屏幕中线右侧（>422）').toBeGreaterThan(844 / 2);
    expect(cx(m.b), 'B 中心应 ≈524（修复前 349）').toBeGreaterThan(420);
    expect(cx(m.a), 'A 中心在左半屏').toBeLessThan(844 / 2);
    expect(m.b.x, 'B 左缘在 A 右缘右侧').toBeGreaterThan(m.a.x + m.a.w);
    expect(m.b.x + m.b.w, 'B 完整在逻辑舞台内').toBeLessThanOrEqual(845);
  });

  it('T3. B链 surface 注入（DPR1.5）回归：仍输出 logical（与 Web 域一致）', () => {
    const canvas = makeCanvas(844 * 1.5, 390 * 1.5);
    const surface: CanvasSurface = { width: 844 * 1.5, height: 390 * 1.5, devicePixelRatio: 1.5, now: () => 0 };
    const o = makeOrch();
    const r = new Renderer(canvas, new VisualRegistry(), surface);
    const snap = o.getRenderSnapshot();
    r.resize(snap.arena.width, o.arena.config.height);
    r.reframe(snap, 'previewFixed');
    const m = r.getVehicleScreenRects(snap)!;
    // surface 注入（backing viewWidth）时 ÷dpr 是域对齐 → 输出 logical
    expect(cx(m.b), 'B 中心 >422').toBeGreaterThan(844 / 2);
    expect(m.b.x + m.b.w, 'B 完整在 844 逻辑域内').toBeLessThanOrEqual(845);
    expect(cx(m.a), 'A 在左半屏').toBeLessThan(844 / 2);
  });

  it('T4. Must#9：DPR 1 与 DPR 1.5 逻辑构图一致（仅像素密度不同）', () => {
    const make = (dpr: number) => {
      const canvas = makeCanvas(844 * dpr, 390 * dpr);
      const surface: CanvasSurface = { width: 844 * dpr, height: 390 * dpr, devicePixelRatio: dpr, now: () => 0 };
      const o = makeOrch();
      const r = new Renderer(canvas, new VisualRegistry(), surface);
      const snap = o.getRenderSnapshot();
      r.resize(snap.arena.width, o.arena.config.height);
      r.reframe(snap, 'previewFixed');
      return r.getVehicleScreenRects(snap)!;
    };
    const m1 = make(1);
    const m15 = make(1.5);
    expect(Math.abs(cx(m1.a) - cx(m15.a)), 'A 中心逻辑一致').toBeLessThan(1);
    expect(Math.abs(cx(m1.b) - cx(m15.b)), 'B 中心逻辑一致').toBeLessThan(1);
    expect(Math.abs(m1.a.w - m15.a.w), 'A 尺度逻辑一致').toBeLessThan(1);
    expect(Math.abs(m1.b.w - m15.b.w), 'B 尺度逻辑一致').toBeLessThan(1);
  });

  it('T5. getPreviewFramingRect 契约：home vehicleFramingRect 为 844×390 逻辑域（不依赖 DPR）', () => {
    const layout = computeHomeLayout(
      { w: 844, h: 390 },
      { left: 0, right: 0, top: 0, bottom: 0 },
      resolveLayoutProfile(844, 390),
    );
    const f = layout.vehicleFramingRect;
    expect(f.x, 'framing 在逻辑舞台内').toBeGreaterThanOrEqual(0);
    expect(f.y, 'framing 顶 ≥0').toBeGreaterThanOrEqual(0);
    expect(f.x + f.w, 'framing 右缘 ≤844').toBeLessThanOrEqual(844.01);
    expect(f.y + f.h, 'framing 下缘 ≤390').toBeLessThanOrEqual(390.01);
    expect(f.w, 'framing 宽为正').toBeGreaterThan(100);
  });
});
