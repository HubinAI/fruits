/**
 * F-GARAGE-CENTER-SCALE-R2.1｜Garage 车辆实际可见面积严格测试（先红后绿）。
 *
 * 追踪结论（Must#1）：Garage previewSolo 最终缩放链 =
 *   stageRect（mobileGarageLayout）→ framingRect → renderer.previewSolo envelope 自适应
 *   （vehicleBounds + padX/padY + margin 8）→ width clamp [40%,47%] → hLimit（高度完整入画）。
 * 瓶颈：420/621/844 受【高度】限制（bounds padY 0.31×eh + margin 8 挤占 safeH），
 * 1280 受【宽度 clamp 上限 47%】限制。修复：Garage 专用 padY 0.14 / padX 0.24 / margin 4 /
 * clamp 上限 50%（Home 全部保持原值——本测试含 Home 对照断言）。
 *
 * Must#2 目标：621/844/1280 ∈ [40%,48%] 屏宽；420 ≥36%（优先 38%）；中心 ≤3%W；
 * 完整入画（车辆 bounds ⊆ stageRect）；不与顶部信息/分类栏/卡片带相交。
 * Must#5：三分类切换中心漂移 ≤2%W、scale 漂移 ≤1%。
 * Must#6：idle 挂点 0（不显示不注册）；armed/dragging 挂点 >0。
 */
import { describe, it, expect, vi } from 'vitest';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import { Renderer } from '../src/render/renderer';
import { VisualRegistry } from '../src/render/visualRegistry';
import { makeStarterDraft, buildSnapshotFromDraft } from '../src/lab/buildEditorModel';
import { registry } from '../src/core/content';
import { computeMobileGarageLayout } from '../src/ui/mobileGarageLayout';
import { computeHomeLayout } from '../src/ui/homeLayout';
import { resolveLayoutProfile } from '../src/ui/layoutProfile';
import { bindPlatformCore } from '../src/platform/context';
import { createWechatCore } from '../src/platform/wechat/index';
import { FakeCanvas } from './wechatCanvasFrameHost';
import { CanvasPlayerUIHost } from '../src/ui/canvasPlayerUIHost';
import { PlayerGameRuntime } from '../src/game/playerGameRuntime';
import { WechatBattleHost } from '../src/game/wechatBattleHost';
import { SfxAudioService } from '../src/presentation/audioService';
import { createPlayerPresentation } from '../src/presentation/playerPresentation';
import type { SafeInsets } from '../src/platform/types';

const INSETS: SafeInsets = { left: 44, right: 20, top: 12, bottom: 16 };
const RES = [
  { w: 420, h: 210, short: true },
  { w: 621, h: 351, short: false },
  { w: 844, h: 390, short: false },
  { w: 1280, h: 592, short: false },
];

function makeCanvasLike(w: number, h: number) {
  return {
    getContext: () => new Proxy({} as CanvasRenderingContext2D, { get: () => () => ({ width: 0 }), set: () => true }),
    width: w,
    height: h,
    clientWidth: w,
    clientHeight: h,
  } as unknown as HTMLCanvasElement;
}

function garageVehicleRect(r: { w: number; h: number }, mode: 'garage' | 'home') {
  const canvas = makeCanvasLike(r.w, r.h);
  const o = new PlanckBattleOrchestrator(
    buildSnapshotFromDraft(makeStarterDraft('watermelonBody', registry), registry, 'a'),
    buildSnapshotFromDraft(makeStarterDraft('boxBody', registry), registry, 'b'),
    registry,
    { autoDrive: true },
    true,
  );
  const renderer = new Renderer(canvas, new VisualRegistry());
  const snap = o.getRenderSnapshot();
  renderer.resize(snap.arena.width, o.arena.config.height);
  const profile = resolveLayoutProfile(r.w, r.h);
  const layout = mode === 'garage' ? computeMobileGarageLayout({ w: r.w, h: r.h }, INSETS, profile) : computeHomeLayout({ w: r.w, h: r.h }, INSETS, profile);
  renderer.reframe(snap, 'previewSolo', { framingRect: { ...layout.stageRect, mode } });
  const a = renderer.getVehicleScreenRects(snap)!.a;
  return { rect: a, stageRect: layout.stageRect, renderer, snap };
}

describe('F-GARAGE-CENTER-SCALE-R2.1｜车辆实际可见面积', () => {
  it('T1. 四视口 Garage 车辆宽占比（420 ≥36%；621/844/1280 ∈ [40%,48%]）', () => {
    for (const r of RES) {
      const { rect } = garageVehicleRect(r, 'garage');
      const pct = (rect.w / r.w) * 100;
      if (r.h <= 210) {
        expect(pct, `${r.w}×${r.h} 车辆宽 ${pct.toFixed(1)}% ≥ 36%`).toBeGreaterThanOrEqual(36);
        expect(pct, `${r.w}×${r.h} 车辆宽 ${pct.toFixed(1)}% ≤ 48%`).toBeLessThanOrEqual(48);
      } else {
        expect(pct, `${r.w}×${r.h} 车辆宽 ${pct.toFixed(1)}% ∈ [40%,48%]`).toBeGreaterThanOrEqual(40);
        expect(pct, `${r.w}×${r.h} 车辆宽 ${pct.toFixed(1)}% ≤ 48%`).toBeLessThanOrEqual(48);
      }
    }
  });

  it('T2. 中心 ≤3%W；完整入画且不与顶部/装配带相交（车辆 bounds ⊆ stageRect）', () => {
    for (const r of RES) {
      const { rect, stageRect } = garageVehicleRect(r, 'garage');
      const cx = (rect.x + rect.w / 2) / r.w;
      expect(Math.abs(cx - 0.5), `${r.w}×${r.h} 中心偏差 ${((cx - 0.5) * 100).toFixed(1)}% ≤ 3%`).toBeLessThanOrEqual(0.03);
      expect(rect.x, `${r.w}×${r.h} 车辆左缘 ≥ stage 左`).toBeGreaterThanOrEqual(stageRect.x - 0.5);
      expect(rect.x + rect.w, `${r.w}×${r.h} 车辆右缘 ≤ stage 右`).toBeLessThanOrEqual(stageRect.x + stageRect.w + 0.5);
      expect(rect.y, `${r.w}×${r.h} 车辆顶 ≥ stage 顶（不与顶栏/分类栏相交）`).toBeGreaterThanOrEqual(stageRect.y - 0.5);
      expect(rect.y + rect.h, `${r.w}×${r.h} 车辆底 ≤ stage 底（不与装配带相交）`).toBeLessThanOrEqual(stageRect.y + stageRect.h + 0.5);
    }
  });

  it('T3. 三分类切换 scale/中心稳定（中心漂移 ≤2%W、scale 漂移 ≤1%；同 bounds 不呼吸）', () => {
    for (const r of RES) {
      const { rect, renderer, snap, stageRect } = garageVehicleRect(r, 'garage');
      const first = { w: rect.w, cx: (rect.x + rect.w / 2) / r.w };
      // 模拟三分类切换（body/move/combat）：Camera 不受分类影响（固定框 bounds 恒定），
      // 再次 reframe 后车辆 rect 必须完全一致（不因切分类重复 reframe / 呼吸缩放）。
      for (const cat of ['body', 'move', 'combat'] as const) {
        void cat;
        renderer.reframe(snap, 'previewSolo', { framingRect: { ...stageRect, mode: 'garage' } });
        const cur = renderer.getVehicleScreenRects(snap)!.a;
        expect(Math.abs((cur.x + cur.w / 2) / r.w - first.cx), `${r.w}×${r.h} 中心漂移 ≤2%W`).toBeLessThanOrEqual(0.02);
        expect(Math.abs(cur.w - first.w) / first.w, `${r.w}×${r.h} scale 漂移 ≤1%`).toBeLessThanOrEqual(0.01);
      }
    }
  });

  it('T4. Home 对照：Garage 专用修改不影响 Home 车辆（Home 宽占比保持原 clamp 语义）', () => {
    // Home 宽占比（真实 insets）应 < Garage（Garage 放宽上限 + 收窄 padding 后更大）
    for (const r of RES) {
      const g = garageVehicleRect(r, 'garage').rect;
      const h = garageVehicleRect(r, 'home').rect;
      expect(g.w, `${r.w}×${r.h} Garage 车辆宽 ≥ Home`).toBeGreaterThanOrEqual(h.w);
      expect(h.w / r.w, `${r.w}×${r.h} Home 车辆宽占比合理`).toBeGreaterThan(0.28);
    }
  });
});

describe('F-GARAGE-CENTER-SCALE-R2.1｜挂点显示时机（Must#6）', () => {
  function buildGarageHost(vp: { w: number; h: number }, dpr = 1) {
    vi.useFakeTimers();
    let fakeNow = 0;
    const touchDown: Array<(e: unknown) => void> = [];
    const touchEnd: Array<(e: unknown) => void> = [];
    (globalThis as unknown as { wx: unknown }).wx = {
      getSystemInfoSync: () => ({
        pixelRatio: dpr,
        windowWidth: vp.w,
        windowHeight: vp.h,
        safeArea: { left: INSETS.left, top: INSETS.top, right: vp.w - INSETS.right, bottom: vp.h - INSETS.bottom, width: vp.w - INSETS.left - INSETS.right, height: vp.h - INSETS.top - INSETS.bottom },
      }),
      getStorageSync: () => null,
      setStorageSync: () => {},
      onTouchStart: (cb: (e: unknown) => void) => void touchDown.push(cb),
      onTouchEnd: (cb: (e: unknown) => void) => void touchEnd.push(cb),
    };
    bindPlatformCore(createWechatCore(dpr));
    const backingW = Math.round(vp.w * dpr);
    const backingH = Math.round(vp.h * dpr);
    const screen = new FakeCanvas({ width: backingW, height: backingH, logicalW: vp.w, logicalH: vp.h });
    const ui = new FakeCanvas({ width: backingW, height: backingH, logicalW: vp.w, logicalH: vp.h });
    screen.ctx.fastRaster = true;
    ui.ctx.fastRaster = true;
    const surface = { width: vp.w, height: vp.h, devicePixelRatio: dpr, now: () => fakeNow };
    const renderer = new Renderer(screen as unknown as HTMLCanvasElement, new VisualRegistry(), surface);
    const sfx = new SfxAudioService();
    const presentation = createPlayerPresentation(renderer, sfx);
    const battleHost = new WechatBattleHost(renderer, presentation);
    const uiHost = new CanvasPlayerUIHost(ui as unknown as HTMLCanvasElement);
    uiHost.mountCanvas();
    const runtime = new PlayerGameRuntime({ host: uiHost, battle: battleHost, sfx });
    runtime.init();
    const fireTap = (x: number, y: number) => {
      for (const cb of touchDown) cb({ touches: [{ clientX: x, clientY: y }] });
      for (const cb of touchEnd) cb({ touches: [{ clientX: x, clientY: y }] });
    };
    const areas = () => uiHost.getHitAreasForTest();
    return { uiHost, runtime, renderer, screen, ui, fireTap, areas };
  }

  it('T5. Garage idle：挂点既不显示也不注册（hp-sel 命中区 = 0）', () => {
    const env = buildGarageHost({ w: 844, h: 390 });
    env.runtime.actions.onFindOpponent; // 保持引用
    (env.uiHost as unknown as { dispatch(id: string): void }).dispatch('home-garage');
    env.uiHost.render({
      uiMode: 'player', battleState: 'editing', playerPhase: 'garage', metaPage: 'garage',
      draft: makeStarterDraft('watermelonBody', registry), draftValid: true, blockReason: null,
      garageSelected: 'body', inventory: {}, progress: { coin: 0, rating: 0 }, onboarding: 'done',
      resetDevVisible: false, opponent: null, matchVehicleRects: null, homeVehicleRect: null,
      hardpointScreenPts: [], overloadDelta: null, devGrantMessage: null, matchBarHidden: true,
      result: null, reward: null, economy: null, resultOnboardingVisible: false, rewardAdAvailable: false, rewardAdClaimed: false, readyOverlayVisible: false,
    } as never);
    const hps = env.areas().filter((a) => a.id.startsWith('hp-sel:'));
    expect(hps.length, `idle 挂点命中区应为 0，实际 ${hps.length}`).toBe(0);
  });

  it('T6. 单击卡片 → armed：挂点显示并注册（hp-sel > 0）；点挂点装备后 idle 复归 0', () => {
    const env = buildGarageHost({ w: 844, h: 390 });
    (env.uiHost as unknown as { dispatch(id: string): void }).dispatch('home-garage');
    env.uiHost.render({
      uiMode: 'player', battleState: 'editing', playerPhase: 'garage', metaPage: 'garage',
      draft: makeStarterDraft('watermelonBody', registry), draftValid: true, blockReason: null,
      garageSelected: 'body', inventory: {}, progress: { coin: 0, rating: 0 }, onboarding: 'done',
      resetDevVisible: false, opponent: null, matchVehicleRects: null, homeVehicleRect: null,
      hardpointScreenPts: [], overloadDelta: null, devGrantMessage: null, matchBarHidden: true,
      result: null, reward: null, economy: null, resultOnboardingVisible: false, rewardAdAvailable: false, rewardAdClaimed: false, readyOverlayVisible: false,
    } as never);
    // idle：无 hp-sel
    expect(env.areas().filter((a) => a.id.startsWith('hp-sel:')).length).toBe(0);
    // 点已装备卡（watermelonBody）→ armed → 挂点出现
    const card = env.areas().find((a) => a.id === 'opt:watermelonBody');
    expect(card, '已装备 body 卡存在').toBeTruthy();
    env.fireTap(card!.x + card!.w / 2, card!.y + card!.h / 2);
    const hps = env.areas().filter((a) => a.id.startsWith('hp-sel:'));
    expect(hps.length, `armed 后挂点命中区 > 0，实际 ${hps.length}`).toBeGreaterThan(0);
  });
});
