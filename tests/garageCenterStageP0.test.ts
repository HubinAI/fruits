import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { CanvasPlayerUIHost } from '../src/ui/canvasPlayerUIHost';
import { computeMobileGarageLayout } from '../src/ui/mobileGarageLayout';
import { resolveLayoutProfile } from '../src/ui/layoutProfile';
import { bindPlatformCore } from '../src/platform/context';
import { createWebCore } from '../src/platform/web';
import { makeStarterDraft, buildSnapshotFromDraft } from '../src/lab/buildEditorModel';
import { getInventory } from '../src/core/partInventory';
import { registry } from '../src/core/content';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import { Renderer } from '../src/render/renderer';
import { VisualRegistry } from '../src/render/visualRegistry';
import type { PlayerUIState } from '../src/ui/playerUI';
import type { SafeInsets } from '../src/platform/types';

/**
 * F-GARAGE-CENTER-STAGE-P0｜中央战车舞台 + 底部横向装配带（targeted）
 * T1 手势状态机：滑动 >8 logical px 取消该次点击（Must#10 横滑浏览不误装备）。
 * T2 Renderer garage 取景宽度 clamp（40%~47%，Must#2 车辆宽约占屏幕 40~48%）。
 * T3 中央取景车辆最终像素居中：fit stageRect 后车辆中心 ≈ 舞台中心（±2%W）。
 * T4 装配带卡片横向排列：全部 opt: 命中区 y 位于 strip 内、横向一排（Must#9）。
 * T5 无文字挂点页签残留（源码守卫 + hitArea 守卫）。
 */
const INSETS: SafeInsets = { left: 44, right: 20, top: 12, bottom: 16 };

function garageState(over: Partial<PlayerUIState> = {}): PlayerUIState {
  return {
    uiMode: 'build',
    battleState: 'editing',
    playerPhase: 'garage',
    draft: makeStarterDraft('boxBody', registry),
    draftValid: true,
    blockReason: null,
    garageSelected: null,
    inventory: getInventory(),
    progress: { coin: 0, rating: 0 },
    onboarding: 'done',
    resetDevVisible: false,
    opponent: null,
    matchBarHidden: true,
    result: null,
    reward: null,
    economy: null,
    resultOnboardingVisible: false,
    rewardAdAvailable: false,
    rewardAdClaimed: false,
    readyOverlayVisible: false,
    ...over,
  };
}

function makeHost(vp: { w: number; h: number }, insets: SafeInsets): { host: CanvasPlayerUIHost; pointer: (x: number, y: number) => void; areas: () => ReadonlyArray<{ id: string; x: number; y: number; w: number; h: number }> } {
  let captured: ((x: number, y: number) => void) | null = null;
  const core = createWebCore();
  bindPlatformCore({
    ...core,
    input: {
      bindClick: () => {},
      bindPointer: (_t: EventTarget, h: (x: number, y: number) => void) => {
        captured = h;
      },
    },
    createViewport: () => ({
      surface: () => ({ width: vp.w, height: vp.h, devicePixelRatio: 1, now: () => 0 }),
      onResize: () => {},
      safeInsets: () => insets,
    }),
  } as unknown as Parameters<typeof bindPlatformCore>[0]);
  const canvas = {
    getContext: () => new Proxy({} as CanvasRenderingContext2D, { get: () => () => ({ width: 0 }), set: () => true }),
    width: vp.w,
    height: vp.h,
    style: undefined,
  } as unknown as HTMLCanvasElement;
  const host = new CanvasPlayerUIHost(canvas);
  host.mountCanvas();
  return {
    host,
    pointer: (x: number, y: number) => captured!(x, y),
    areas: () => host.getHitAreasForTest(),
  };
}

describe('F-GARAGE-CENTER-STAGE-P0｜中央战车舞台 + 底部横向装配带', () => {
  afterEach(() => {
    bindPlatformCore(createWebCore());
    vi.unstubAllGlobals();
  });

  it('T1. 手势状态机：滑动 >8 logical px 取消该次点击（Must#10 横滑浏览不误装备）；≤8px 正常点击', () => {
    const env = makeHost({ w: 844, h: 390 }, INSETS);
    const h = env.host as unknown as {
      gestureDown(x: number, y: number): void;
      gestureMove(x: number, y: number): void;
      gestureUp(x: number, y: number, cancelled: boolean, tap: (x: number, y: number) => void): void;
    };
    let taps = 0;
    const tap = () => {
      taps++;
    };
    // 静止点击（位移 0）→ 正常派发
    h.gestureDown(100, 200);
    h.gestureMove(101, 200);
    h.gestureUp(101, 200, false, tap);
    expect(taps, '≤8px 位移正常点击').toBe(1);
    // 横向滑动 20px → 取消该次点击（不派发）
    h.gestureDown(100, 200);
    h.gestureMove(108, 200); // 8px 边界
    h.gestureMove(120, 200); // 累计 >8 → cancelled
    h.gestureUp(120, 200, false, tap);
    expect(taps, '滑动 >8px 取消点击（不误装备）').toBe(1);
    // 系统取消（pointercancel）→ 不派发
    h.gestureDown(100, 200);
    h.gestureUp(100, 200, true, tap);
    expect(taps, '系统取消不派发').toBe(1);
  });

  it('T2. Renderer garage 取景宽度 clamp：previewSolo + framing.mode=garage 车辆宽 38%~47% 安全宽', () => {
    // 源码守卫：garage 模式进入宽度 clamp（与 home 同区间）
    const src = readFileSync('src/render/renderer.ts', 'utf-8');
    expect(src, 'garage 模式宽度 clamp').toContain("framing?.mode === 'home' || framing?.mode === 'garage'");
    // 数值验证：fit 到中央舞台（全宽）后 A 车可见宽占安全宽 ∈ [40%, 48%]
    const canvas = {
      getContext: () => new Proxy({} as CanvasRenderingContext2D, { get: () => () => ({ width: 0 }), set: () => true }),
      width: 844,
      height: 390,
      clientWidth: 844,
      clientHeight: 390,
    } as unknown as HTMLCanvasElement;
    const o = new PlanckBattleOrchestrator(
      buildSnapshotFromDraft(makeStarterDraft('boxBody', registry), registry, 'a'),
      buildSnapshotFromDraft(makeStarterDraft('watermelonBody', registry), registry, 'b'),
      registry,
      { autoDrive: true },
      true, // soloA（Garage）
    );
    const r = new Renderer(canvas, new VisualRegistry());
    const snap = o.getRenderSnapshot();
    r.resize(snap.arena.width, o.arena.config.height);
    // garage 模式 framing = 中央舞台（844×390，顶栏 34 + gap 8 + strip 125 → stage 42..265）
    const profile = resolveLayoutProfile(844, 390);
    const l = computeMobileGarageLayout({ w: 844, h: 390 }, { left: 0, right: 0, top: 0, bottom: 0 }, profile);
    r.reframe(snap, 'previewSolo', { framingRect: { ...l.stageRect, mode: 'garage' } });
    const rects = r.getVehicleScreenRects(snap);
    expect(rects, '车辆 rect 非空').toBeTruthy();
    const a = rects!.a;
    const wPct = a.w / 844;
    expect(wPct, `garage 车辆宽占比 ${(wPct * 100).toFixed(1)}% ∈ [40%,48%]`).toBeGreaterThanOrEqual(0.40);
    expect(wPct, `garage 车辆宽占比 ${(wPct * 100).toFixed(1)}% ≤ 48%`).toBeLessThanOrEqual(0.48);
    // 完整入画（不越出舞台）
    expect(a.x, '车辆左缘 ≥ 0').toBeGreaterThanOrEqual(-1);
    expect(a.x + a.w, '车辆右缘 ≤ 844').toBeLessThanOrEqual(845);
  });

  it('T3. 中央取景车辆最终像素居中：fit stageRect 后车辆中心 ≈ 舞台中心（±2%W，Must#2）', () => {
    const canvas = {
      getContext: () => new Proxy({} as CanvasRenderingContext2D, { get: () => () => ({ width: 0 }), set: () => true }),
      width: 844,
      height: 390,
      clientWidth: 844,
      clientHeight: 390,
    } as unknown as HTMLCanvasElement;
    const o = new PlanckBattleOrchestrator(
      buildSnapshotFromDraft(makeStarterDraft('boxBody', registry), registry, 'a'),
      buildSnapshotFromDraft(makeStarterDraft('watermelonBody', registry), registry, 'b'),
      registry,
      { autoDrive: true },
      true,
    );
    const r = new Renderer(canvas, new VisualRegistry());
    const snap = o.getRenderSnapshot();
    r.resize(snap.arena.width, o.arena.config.height);
    const profile = resolveLayoutProfile(844, 390);
    const l = computeMobileGarageLayout({ w: 844, h: 390 }, { left: 0, right: 0, top: 0, bottom: 0 }, profile);
    r.reframe(snap, 'previewSolo', { framingRect: { ...l.stageRect, mode: 'garage' } });
    const rects = r.getVehicleScreenRects(snap)!;
    const cx = rects.a.x + rects.a.w / 2;
    // 舞台水平中心 = 屏幕中心（stage 全宽 0..844）
    const dev = Math.abs(cx - 844 / 2) / 844;
    expect(dev, `车辆中心横轴偏差 ${(dev * 100).toFixed(2)}%W ≤ 2%`).toBeLessThanOrEqual(0.02);
  });

  it('T4. 装配带部件卡横向排列：全部 opt: 命中区 y 位于 strip 内（Must#5/9）', () => {
    const env = makeHost({ w: 844, h: 390 }, INSETS);
    env.host.render(garageState());
    const home = env.areas().find((a) => a.id === 'home-garage')!;
    env.pointer(home.x + home.w / 2, home.y + home.h / 2); // 进配置页（metaPage=garage）
    env.host.render(garageState({ garageSelected: 'body' }));
    const profile = resolveLayoutProfile(844, 390);
    const l = computeMobileGarageLayout({ w: 844, h: 390 }, INSETS, profile);
    const opts = env.areas().filter((a) => a.id.startsWith('opt:'));
    expect(opts.length, '部件卡存在').toBeGreaterThan(0);
    for (const o of opts) {
      expect(o.y, `${o.id} 位于装配带内`).toBeGreaterThanOrEqual(l.stripRect.y - 0.5);
      expect(o.y + o.h, `${o.id} 不超装配带`).toBeLessThanOrEqual(l.stripRect.y + l.stripRect.h + 0.5);
      expect(o.x, `${o.id} 不越左`).toBeGreaterThanOrEqual(l.stripRect.x - 0.5);
      expect(o.x + o.w, `${o.id} 不越右`).toBeLessThanOrEqual(l.stripRect.x + l.stripRect.w + 0.5);
    }
    // 横向一排：所有卡 y 相同（同一行）
    const y0 = opts[0]!.y;
    for (const o of opts) {
      expect(o.y, `${o.id} 与首卡同行（横向一排）`).toBeCloseTo(y0, 3);
    }
  });

  it('T5. 无文字挂点页签残留：hitArea 无 garage-slot:/garage-cslot:/garage-cgroup:（Must#7）', () => {
    const env = makeHost({ w: 844, h: 390 }, INSETS);
    env.host.render(garageState());
    // 进配置页
    const home = env.areas().find((a) => a.id === 'home-garage')!;
    env.pointer(home.x + home.w / 2, home.y + home.h / 2);
    const ids = env.areas().map((a) => a.id);
    for (const prefix of ['garage-slot:', 'garage-cslot:', 'garage-cgroup:']) {
      expect(ids.some((id) => id.startsWith(prefix)), `无 ${prefix} 命中区`).toBe(false);
    }
    // 源码守卫：文字挂点绘制/派发方法已移除
    const src = readFileSync('src/ui/canvasPlayerUIHost.ts', 'utf-8');
    expect(src, '无 drawGarageSlotChips 绘制').not.toContain('garage-cslot:');
    expect(src, '无武器/辅助分段绘制').not.toContain('garage-cgroup:');
  });
});
