/**
 * F-WX-9A / F-WX-RCA-1｜DEV 取景尺度日志运行时验证（双口径：core / envelope）。
 *
 * 目标：
 * 1. [WX-REF]（__WX_DEBUG__）输出 vehicleA.core.screenWidthPct（Body+Wheels）
 *    与 vehicleA.envelope.screenWidthPct（+Functional Parts），两个指标并存；
 * 2. core < envelope（coreBounds 明确排除 Functional Parts 的直接证据）；
 * 3. Garage previewSolo（framingRect）envelope ∈ [32%,38%]（9B 阈值）；
 *    Battle Active envelope ∈ [24%,30%]（9C 阈值）——阈值不因 RCA 调整；
 * 4. DPR=2 与 DPR=1 逻辑占比一致（尺度链自洽）；
 * 5. [WX-RCA]（__WX_RCA__，build:wechat:rca）在 garage/battle reframe 输出双口径；
 * 6. __WX_DEBUG__=false / __WX_RCA__=false/undefined → 零日志（PROD）。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import { Renderer } from '../src/render/renderer';
import { VisualRegistry } from '../src/render/visualRegistry';
import { registry } from '../src/core/content';
import { makeStarterDraft, buildSnapshotFromDraft } from '../src/lab/buildEditorModel';
import { computeMobileGarageLayout } from '../src/ui/mobileGarageLayout';
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

/** 与 CanvasHost.getPreviewFramingRect 同几何的 Garage 左侧展示区（F-WX-RCA-3A：
 *  底部独立使用 safe bottom，不再由右侧 CTA 决定） */
/** F-WX-UI-F1：车辆取景区直接来自唯一布局源（insets=0 测试夹具）；不再手算重复几何 */
function garageFramingRect(vp: { w: number; h: number }): { x: number; y: number; w: number; h: number } {
  return computeMobileGarageLayout(vp, { left: 0, right: 0, top: 0, bottom: 0 }).vehicleRect;
}

/** 抓取最后一个指定前缀日志的 JSON 主体（同一帧可能有 garage+battle 两条 [WX-RCA]） */
function lastLog(spy: ReturnType<typeof vi.spyOn>, tag: string): Record<string, unknown> | null {
  for (let i = spy.mock.calls.length - 1; i >= 0; i--) {
    const c = spy.mock.calls[i] as unknown[];
    if (c[0] === tag) return JSON.parse(String(c[1])) as Record<string, unknown>;
  }
  return null;
}

describe('F-WX-9A/RCA-1｜[WX-REF]/[WX-RCA] 尺度日志（DEV/RCA-only，双口径）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('Garage previewSolo：envelope（完整车辆）∈ [35%,55%]（F-GARAGE-CENTER-STAGE-P0 中央舞台全宽取景；Must#2 车辆宽 38~48%）+ core 存在且 < envelope', () => {
    vi.stubGlobal('__WX_DEBUG__', true);
    const { r, o } = makeEnv({ w: 844, h: 390 }, 1);
    const snap = o.getRenderSnapshot();
    r.resize(snap.arena.width, o.arena.config.height);
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    r.reframe(snap, 'previewSolo', { framingRect: garageFramingRect({ w: 844, h: 390 }) });
    const log = lastLog(spy, '[WX-REF]');
    expect(log, '应有 [WX-REF] 日志').not.toBeNull();
    const vehicle = log!.vehicleA as {
      core: { screenWidthPct: number };
      envelope: { screenWidthPct: number };
    };
    expect(vehicle.core.screenWidthPct, 'core 存在').toBeGreaterThanOrEqual(0);
    expect(vehicle.envelope.screenWidthPct, 'envelope 存在').toBeGreaterThanOrEqual(0);
    // F-GARAGE-CENTER-STAGE-P0：中央舞台全宽取景，envelope 占比 ~38~48%（Must#2）；core < envelope（双口径并存）
    expect(vehicle.envelope.screenWidthPct).toBeGreaterThanOrEqual(35);
    expect(vehicle.envelope.screenWidthPct).toBeLessThanOrEqual(55);
    expect(vehicle.core.screenWidthPct).toBeGreaterThanOrEqual(10);
    expect(vehicle.core.screenWidthPct, 'core（Body+Wheels）应小于 envelope（含 Parts）').toBeLessThan(vehicle.envelope.screenWidthPct);
    expect((log!.view as { dpr: number }).dpr).toBe(1);
  });

  it('Battle Active：envelope ∈ [20%,28%]（F-BATTLE-CAMERA-R2 envelope 构图）+ core 存在且 < envelope', () => {
    vi.stubGlobal('__WX_DEBUG__', true);
    const { r } = makeEnv({ w: 844, h: 390 }, 1);
    // F-BATTLE-CAMERA-R2：battle 用真实双方对局（makeEnv 是 soloA Garage 夹具，
    // battle 构图按 A+B 双方 envelope——soloA 场景只框 A 会放大失真）
    const o2 = new PlanckBattleOrchestrator(
      buildSnapshotFromDraft(makeStarterDraft('watermelonBody', registry), registry, 'a'),
      buildSnapshotFromDraft(makeStarterDraft('bananaBody', registry), registry, 'b'),
      registry,
      { autoDrive: true },
    );
    const snap = o2.getRenderSnapshot();
    r.resize(snap.arena.width, o2.arena.config.height);
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    r.reframe(snap, 'battle', { phase: 'Active' });
    const log = lastLog(spy, '[WX-REF]');
    expect(log, '应有 [WX-REF] 日志').not.toBeNull();
    expect(log!.fit).toBe('battle');
    expect(log!.framingRect).toBeNull();
    const vehicle = log!.vehicleA as { core: { screenWidthPct: number }; envelope: { screenWidthPct: number } };
    expect(vehicle.envelope.screenWidthPct).toBeGreaterThanOrEqual(20);
    expect(vehicle.envelope.screenWidthPct).toBeLessThanOrEqual(28);
    expect(vehicle.core.screenWidthPct).toBeLessThan(vehicle.envelope.screenWidthPct);
  });

  it('DPR=2（surface 1688×780 物理）与 DPR=1（844×390）逻辑占比一致（尺度链自洽，用 envelope 口径）', () => {
    vi.stubGlobal('__WX_DEBUG__', true);
    const pcts: number[] = [];
    for (const dpr of [1, 2]) {
      const { r, o } = makeEnv({ w: 844, h: 390 }, dpr);
      const snap = o.getRenderSnapshot();
      r.resize(snap.arena.width, o.arena.config.height);
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      r.reframe(snap, 'previewSolo', { framingRect: garageFramingRect({ w: 844, h: 390 }) });
      const log = lastLog(spy, '[WX-REF]');
      expect(log).not.toBeNull();
      expect((log!.view as { dpr: number }).dpr).toBe(dpr);
      pcts.push(((log!.vehicleA as { envelope: { screenWidthPct: number } }).envelope).screenWidthPct);
      vi.restoreAllMocks();
    }
    // dpr 只改物理像素，不改逻辑空间 → 占比差必须 < 2pp
    expect(Math.abs(pcts[0] - pcts[1]), `dpr=1 ${pcts[0]}% vs dpr=2 ${pcts[1]}%`).toBeLessThan(2);
  });

  it('[WX-RCA]（build:wechat:rca）：garage 与 battle reframe 输出 step + 双口径；false/undefined 零输出', () => {
    // garage 段
    vi.stubGlobal('__WX_RCA__', true);
    const { r, o } = makeEnv({ w: 844, h: 390 }, 1);
    const snap = o.getRenderSnapshot();
    r.resize(snap.arena.width, o.arena.config.height);
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    r.reframe(snap, 'previewSolo', { framingRect: garageFramingRect({ w: 844, h: 390 }) });
    const garage = lastLog(spy, '[WX-RCA]');
    expect(garage, '应有 [WX-RCA] garage 段').not.toBeNull();
    expect(garage!.step).toBe('garage');
    const gv = garage as { core: { screenWidthPct: number }; envelope: { screenWidthPct: number }; transform: { scale: number } };
    expect(gv.transform.scale).toBeGreaterThan(0);
    expect(gv.core.screenWidthPct).toBeGreaterThanOrEqual(0);
    expect(gv.envelope.screenWidthPct).toBeGreaterThan(0);
    expect(gv.core.screenWidthPct).toBeLessThan(gv.envelope.screenWidthPct);
    // battle 段：A/B 双车 core+envelope 四值（F-WX-RCA-2B）
    r.reframe(snap, 'battle', { phase: 'Active' });
    const battle = lastLog(spy, '[WX-RCA]');
    expect(battle, '应有 [WX-RCA] battle 段').not.toBeNull();
    expect(battle!.step).toBe('battle');
    expect(battle!.phase).toBe('Active');
    const bv = battle as {
      A: { core: { screenWidthPct: number }; envelope: { screenWidthPct: number } };
      B: { core: { screenWidthPct: number }; envelope: { screenWidthPct: number } };
    };
    expect(bv.A.core.screenWidthPct, 'A core 存在').toBeGreaterThanOrEqual(0);
    expect(bv.A.envelope.screenWidthPct, 'A envelope 存在').toBeGreaterThan(0);
    expect(bv.A.core.screenWidthPct).toBeLessThan(bv.A.envelope.screenWidthPct);
    expect(bv.B.core.screenWidthPct, 'B core 存在').toBeGreaterThanOrEqual(0);
    expect(bv.B.envelope.screenWidthPct, 'B envelope 存在').toBeGreaterThan(0);
    expect(bv.B.core.screenWidthPct).toBeLessThan(bv.B.envelope.screenWidthPct);
    // 一次性：再次 reframe Active → battle 段不重复（battleRcaLogged once，防刷屏）
    const battleCountBefore = spy.mock.calls.filter((c: unknown[]) => c[0] === '[WX-RCA]' && String(c[1]).includes('"step":"battle"')).length;
    r.reframe(snap, 'battle', { phase: 'Active' });
    const battleCountAfter = spy.mock.calls.filter((c: unknown[]) => c[0] === '[WX-RCA]' && String(c[1]).includes('"step":"battle"')).length;
    expect(battleCountAfter, 'Active 首帧只输出一次 battle 段').toBe(battleCountBefore);
    // false / undefined → 零 [WX-RCA]（先 restore 主 spy，避免重复 spyOn 返回同一 mock 混入历史调用）
    vi.restoreAllMocks();
    for (const v of [false, undefined]) {
      if (v === undefined) vi.unstubAllGlobals();
      else vi.stubGlobal('__WX_RCA__', false);
      const spy2 = vi.spyOn(console, 'log').mockImplementation(() => {});
      r.reframe(snap, 'previewSolo');
      r.reframe(snap, 'battle', { phase: 'Active' });
      expect(spy2.mock.calls.some((c) => c[0] === '[WX-RCA]'), `${String(v)} 不应输出 [WX-RCA]`).toBe(false);
      vi.restoreAllMocks();
    }
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
