import { describe, it, expect, afterEach } from 'vitest';
import { PlayerViewportTransform, PLAYER_LOGICAL_W, PLAYER_LOGICAL_H } from '../src/platform/playerViewport';
import { CanvasPlayerUIHost } from '../src/ui/canvasPlayerUIHost';
import { createWebCore } from '../src/platform/web';
import { bindPlatformCore } from '../src/platform/context';
import { Renderer } from '../src/render/renderer';
import { VisualRegistry } from '../src/render/visualRegistry';
import { registry } from '../src/core/content';
import { makeStarterDraft, buildSnapshotFromDraft } from '../src/lab/buildEditorModel';
import { getInventory } from '../src/core/partInventory';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import type { PlayerUIState } from '../src/ui/playerUI';
import type { CanvasSurface } from '../src/render/canvasSurface';
import type { SafeInsets } from '../src/platform/types';

const ZERO_INSETS: SafeInsets = { left: 0, right: 0, top: 0, bottom: 0 };

function makeCtx() {
  return new Proxy(
    {} as CanvasRenderingContext2D,
    { get: () => () => ({ width: 0 }), set: () => true },
  );
}

function makeCanvas(w: number, h: number) {
  const style: Record<string, string> = {};
  const canvas = {
    getContext: () => makeCtx(),
    width: w,
    height: h,
    clientWidth: w,
    clientHeight: h,
    style,
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as HTMLCanvasElement;
  return { canvas, style };
}

function bindViewportMock(vp: { w: number; h: number; dpr: number }) {
  const core = createWebCore();
  bindPlatformCore({
    ...core,
    createViewport: () => ({
      surface: () => ({ width: vp.w, height: vp.h, devicePixelRatio: vp.dpr, now: () => 0 }),
      onResize: () => {},
      safeInsets: () => ZERO_INSETS,
    }),
  } as unknown as Parameters<typeof bindPlatformCore>[0]);
}

function makeMountParent(w: number, h: number) {
  return { clientWidth: w, clientHeight: h, appendChild: () => {} } as unknown as HTMLElement;
}

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

function makeRenderer(w: number, h: number, dpr = 1): Renderer {
  const canvas = {
    getContext: () => makeCtx(),
    clientWidth: w,
    clientHeight: h,
    width: w,
    height: h,
  } as unknown as HTMLCanvasElement;
  const surface: CanvasSurface = { width: w, height: h, devicePixelRatio: dpr, now: () => 0 };
  return new Renderer(canvas, new VisualRegistry(), surface);
}

describe('F-PLAYER-CANVAS-COMPOSE-P0｜统一玩家双画布坐标与最终合成', () => {
  afterEach(() => {
    bindPlatformCore(createWebCore());
  });

  it('T1. PlayerViewportTransform：contain scale/offset、cssRect、logical↔surface 唯一转换', () => {
    const vp = new PlayerViewportTransform();
    expect(vp.logicalW, '逻辑宽 844').toBe(PLAYER_LOGICAL_W);
    expect(vp.logicalH, '逻辑高 390').toBe(PLAYER_LOGICAL_H);
    // 容器 1920×1008 → contain scale = min(1920/844, 1008/390)
    vp.update(1920, 1008, 1);
    const s = Math.min(1920 / 844, 1008 / 390);
    expect(vp.scale, 'contain scale').toBeCloseTo(s, 6);
    expect(vp.offsetX, '水平居中偏移').toBeCloseTo((1920 - 844 * s) / 2, 6);
    expect(vp.offsetY, '垂直居中偏移').toBeCloseTo((1008 - 390 * s) / 2, 6);
    const rect = vp.cssRect();
    expect(rect.w, 'CSS contain 宽 = logical×scale').toBeCloseTo(844 * s, 6);
    expect(rect.h, 'CSS contain 高 = logical×scale').toBeCloseTo(390 * s, 6);
    // logical ↔ surface 唯一转换（×DPR / ÷DPR）
    vp.update(844, 390, 2);
    expect(vp.logicalToSurface(100, 50)).toEqual({ x: 200, y: 100 });
    expect(vp.surfaceToLogical(200, 100)).toEqual({ x: 100, y: 50 });
    // logical → CSS（含 contain 缩放与居中；844×390 容器 scale=1）
    expect(vp.logicalToCss(422, 195)).toEqual({ x: 422, y: 195 });
  });

  it('T2. applyTo：Renderer Canvas 与 UI Canvas 应用同一变换 → backing/CSS 完全一致', () => {
    const vp = new PlayerViewportTransform();
    vp.update(1920, 1008, 2);
    const a = makeCanvas(0, 0);
    const b = makeCanvas(0, 0);
    vp.applyTo(a.canvas);
    vp.applyTo(b.canvas);
    // backing store 一致（logical × DPR）
    expect(a.canvas.width, 'A backing 宽').toBe(844 * 2);
    expect(a.canvas.height, 'A backing 高').toBe(390 * 2);
    expect(b.canvas.width, 'B backing 宽与 A 一致').toBe(a.canvas.width);
    expect(b.canvas.height, 'B backing 高与 A 一致').toBe(a.canvas.height);
    // CSS 一致（width/height/left/top/transform）
    const keys = ['position', 'width', 'height', 'left', 'top', 'right', 'bottom', 'transformOrigin', 'transform'] as const;
    for (const k of keys) {
      expect(a.style[k], `A.style.${k}`).toBe(b.style[k]);
    }
    expect(a.style.transform, 'contain 缩放 transform').toBe(`scale(${vp.scale})`);
    expect(a.style.left, '居中 left').toBe(`${Math.round(vp.offsetX)}px`);
    expect(a.style.top, '居中 top').toBe(`${Math.round(vp.offsetY)}px`);
  });

  it('T3. 共享 transform 下 host 双画布规则一致：backing = logical×DPR、CSS contain = 共享 scale/offset', () => {
    bindViewportMock({ w: 844, h: 390, dpr: 1 });
    const vp = new PlayerViewportTransform();
    vp.update(1920, 1008, 2);
    const { canvas, style } = makeCanvas(0, 0);
    const parent = makeMountParent(1920, 1008);
    const host = new CanvasPlayerUIHost(canvas, { phoneLogical: true, viewportTransform: vp });
    host.mount(parent);
    host.render(garageState());
    // backing = logical × DPR（与 Renderer Canvas 同一规则）
    expect(canvas.width, 'host backing 宽').toBe(844 * 2);
    expect(canvas.height, 'host backing 高').toBe(390 * 2);
    // CSS contain = 共享 transform（不再独立 applyPhoneScale 算一套）
    expect(style.transform, 'host CSS transform = 共享 scale').toBe(`scale(${vp.scale})`);
    expect(style.left, 'host CSS left = 共享 offset').toBe(`${Math.round(vp.offsetX)}px`);
    expect(style.top, 'host CSS top = 共享 offset').toBe(`${Math.round(vp.offsetY)}px`);
    expect(style.width, 'host CSS 宽 = logical px').toBe(`${PLAYER_LOGICAL_W}px`);
    expect(style.height, 'host CSS 高 = logical px').toBe(`${PLAYER_LOGICAL_H}px`);
  });

  it('T4. 无共享 transform：phoneLogical 独立 contain 行为保持（既有路径不回归）', () => {
    bindViewportMock({ w: 844, h: 390, dpr: 1 });
    const { canvas, style } = makeCanvas(0, 0);
    const parent = makeMountParent(1920, 1008);
    const host = new CanvasPlayerUIHost(canvas, { phoneLogical: true });
    host.mount(parent);
    host.render(garageState());
    const s = Math.min(1920 / 844, 1008 / 390);
    expect(canvas.width, '独立路径 backing = 844×1').toBe(844);
    expect(style.transform, '独立路径 contain 计算保持').toBe(`scale(${s})`);
    expect(style.left, '独立路径居中 left').toBe(`${Math.round((1920 - 844 * s) / 2)}px`);
  });

  it('T5. 跨层矩形单次转换：Renderer 视口 = logical（844×390）→ getVehicleScreenRects 输出逻辑 rect（÷DPR），与 UI 同源', () => {
    // Renderer 视口 = logical 尺寸（玩家模式统一后 view = 844×390）
    const r = makeRenderer(844, 390, 2);
    const o = new PlanckBattleOrchestrator(
      buildSnapshotFromDraft(makeStarterDraft('boxBody', registry), registry, 'a'),
      buildSnapshotFromDraft(makeStarterDraft('boxBody', registry), registry, 'b'),
      registry,
      { autoDrive: true },
    );
    const snap = o.getRenderSnapshot();
    r.resize(snap.arena.width, o.arena.config.height);
    r.reframe(snap, 'previewFixed');
    const rects = r.getVehicleScreenRects(snap);
    expect(rects, 'previewFixed 双车 rect 存在').not.toBeNull();
    if (!rects) return;
    // 逻辑空间断言（screen / viewDpr = 逻辑 px，与 UI Canvas 844×390 同一坐标）
    expect(rects.b.x + rects.b.w, 'B 右缘在逻辑视口内').toBeLessThanOrEqual(844);
    expect(rects.a.x + rects.a.w, 'A 左缘在逻辑视口内').toBeLessThanOrEqual(422);
    expect(rects.b.x, 'B 在 A 右侧（previewFixed A 左 B 右）').toBeGreaterThan(rects.a.x + rects.a.w);
    // 跨层只转换一次：rect 已是逻辑坐标（≠ backing 像素坐标 844×2=1688）
    expect(rects.b.x + rects.b.w, 'rect 不落在 backing 像素空间（未二次乘 DPR）').toBeLessThan(1688);
  });

  it('T6. 源码守卫：host 走共享 viewportTransform.applyTo（禁独立第二套放大）；main.ts 单实例共享', () => {
    const HOST = (CanvasPlayerUIHost as unknown as { toString: () => string }).toString();
    // host：共享 transform 时直接 viewportTransform.applyTo（Must#4：不再让 UI Canvas 单独放大）
    expect(HOST, '共享 transform 应用').toContain('this.viewportTransform.applyTo(this.canvas)');
    expect(HOST, '共享 transform 时不再走独立 contain').toContain('if (this.viewportTransform)');
    // main.ts：玩家模式创建共享实例 + 应用到两画布（Renderer canvas + host）
    const MAIN = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'main.ts'), 'utf-8');
    expect(MAIN, 'main.ts 创建共享 PlayerViewportTransform').toContain('const playerViewport = playerMode ? new PlayerViewportTransform() : null;');
    expect(MAIN, 'Renderer canvas 应用同一变换').toContain('playerViewport.applyTo(canvas)');
    expect(MAIN, 'host 注入同一变换').toContain('viewportTransform: playerViewport ?? undefined');
    // Renderer 不再用另一套实际页面尺寸：playerMode 时 Renderer canvas CSS = logical px（clientWidth = 844）
    expect(MAIN, 'resize 同步两画布').toContain('host.syncViewport?.()');
  });
});
