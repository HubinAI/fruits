/**
 * F-WX-SAFE-AREA-P0｜统一微信横屏顶部三区契约 targeted test。
 *
 * 追踪结论（Must#1）：坐标链 = wx.getWindowInfo().safeArea + getMenuButtonBoundingClientRect()
 * → WechatViewport.safeInsets()（logical px）→ 各页面布局源（computeHomeLayout /
 * computeMobileGarageLayout / drawMatchingContinuum / drawHud 已消费 insets）。
 * 首次问题位置：drawBuildBadge 旧锚点 (insL+6, insT+6) 与 Home 头像行（profileRect=insL/insT，
 * 高 42）重叠 → RC badge 压头像。修复：badge 改锚统一顶部三区契约（顶部信息行之下 4px）。
 *
 * 验收（Must#2-7）：统一三区几何；badge 不覆盖头像/货币/返回/HP/Matching·Locked；
 * 中央状态真居中（左右 insets 不对称不偏移）；120 帧无跳位；方向变化/resize 重算。
 */
import { describe, it, expect, vi } from 'vitest';
import { computeTopSafeAreas } from '../src/ui/topSafeLayout';
import { resolveLayoutProfile } from '../src/ui/layoutProfile';
import { computeHomeLayout } from '../src/ui/homeLayout';
import { computeMobileGarageLayout } from '../src/ui/mobileGarageLayout';
import { bindPlatformCore } from '../src/platform/context';
import { FakeCanvas } from './wechatCanvasFrameHost';
import { Renderer } from '../src/render/renderer';
import { VisualRegistry } from '../src/render/visualRegistry';
import { SfxAudioService } from '../src/presentation/audioService';
import { createPlayerPresentation } from '../src/presentation/playerPresentation';
import { CanvasPlayerUIHost } from '../src/ui/canvasPlayerUIHost';
import { PlayerGameRuntime } from '../src/game/playerGameRuntime';
import { WechatBattleHost } from '../src/game/wechatBattleHost';

const BADGE_TEXT = '#9b7556b';
const BADGE_BG = 'rgba(0,0,0,0.55)';

let fakeNow = 0;
let fakeInsets = { top: 0, bottom: 0, left: 0, right: 0 };

function makeSurface(logicalW: number, logicalH: number, dpr: number) {
  return {
    width: logicalW,
    height: logicalH,
    devicePixelRatio: dpr,
    now: () => fakeNow,
  };
}

function bindFakeCore(surface: ReturnType<typeof makeSurface>) {
  const store = new Map<string, unknown>();
  const visibilityCbs: Array<(hidden: boolean) => void> = [];
  const core = {
    storage: {
      getItem: (k: string): string | null => (store.has(k) ? (store.get(k) as string) : null),
      setItem: (k: string, v: string): void => void store.set(k, v),
      removeItem: (k: string): void => void store.delete(k),
    },
    capturedPointerHandlers: [] as Array<(x: number, y: number) => void>,
    input: {
      bindPointer: (_t: unknown, handler: (x: number, y: number) => void) => {
        core.capturedPointerHandlers.push(handler);
        return () => {};
      },
    },
    lifecycle: {
      requestAnimationFrame: (_cb: (t: number) => void): number => 1,
      cancelAnimationFrame: (_h: number): void => {},
      now: (): number => fakeNow,
      onVisibilityChange: (cb: (hidden: boolean) => void): void => {
        visibilityCbs.push(cb);
      },
      onHide: (_fn: () => void): void => {},
      onShow: (_fn: () => void): void => {},
    },
    createViewport: (_canvas: unknown) => ({
      surface: () => surface,
      safeInsets: () => ({ ...fakeInsets }),
      applyTo: (_c: unknown) => {},
      clientToLogical: (cx: number, cy: number) => ({ x: cx, y: cy }),
    }),
  };
  bindPlatformCore(core as unknown as Parameters<typeof bindPlatformCore>[0]);
  return { store, visibilityCbs };
}

function buildHarness(logicalW = 844, logicalH = 390, dpr = 2) {
  fakeNow = 0;
  fakeInsets = { top: 0, bottom: 0, left: 0, right: 0 };
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0.42);
  const surface = makeSurface(logicalW, logicalH, dpr);
  const { store, visibilityCbs } = bindFakeCore(surface);
  const backingW = logicalW * dpr;
  const backingH = logicalH * dpr;
  const screen = new FakeCanvas({ width: backingW, height: backingH, logicalW, logicalH });
  const ui = new FakeCanvas({ width: backingW, height: backingH, logicalW, logicalH });
  screen.ctx.fastRaster = true;
  ui.ctx.fastRaster = true;
  const renderer = new Renderer(screen as unknown as HTMLCanvasElement, new VisualRegistry(), surface);
  const sfx = new SfxAudioService();
  const presentation = createPlayerPresentation(renderer, sfx);
  const battleHost = new WechatBattleHost(renderer, presentation);
  const uiHost = new CanvasPlayerUIHost(ui as unknown as HTMLCanvasElement);
  uiHost.mountCanvas();
  const runtime = new PlayerGameRuntime({ host: uiHost, battle: battleHost, sfx });
  runtime.init();
  uiHost.setBuildBadge(BADGE_TEXT); // RC 注入（game.ts:380 语义）
  const driveFrame = (dt = 16.7) => {
    fakeNow += dt;
    screen.ctx.clearDrawOps();
    ui.ctx.clearDrawOps();
    runtime.tick(fakeNow);
  };
  return { surface, store, visibilityCbs, screen, ui, renderer, sfx, battleHost, uiHost, runtime, driveFrame };
}

/** badge 深色底 bbox（logical px = dev/dpr）。 */
function badgeBgLogical(ui: FakeCanvas, dpr: number) {
  const op = ui.ctx.drawOps.find((o) => o.type === 'rect' && o.fillStyle === BADGE_BG);
  if (!op) return null;
  return {
    x: op.devX / dpr,
    y: op.devY / dpr,
    w: op.devW / dpr,
    h: op.devH / dpr,
  };
}

function overlaps(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

describe('F-WX-SAFE-AREA-P0｜统一顶部三区（纯函数）', () => {
  const insets = { top: 44, bottom: 21, left: 47, right: 59 };

  it('1. 844×390：三区互不重叠，右侧右缘 = W-insR，中央 x = W/2 真居中', () => {
    const a = computeTopSafeAreas({ w: 844, h: 390 }, insets, resolveLayoutProfile(844, 390));
    expect(a.topRowH).toBe(42);
    expect(a.left.x).toBe(47);
    expect(a.left.y).toBe(44);
    expect(a.right.x + a.right.w).toBe(844 - 59); // 右侧信息区右缘 = W-insR（含胶囊+6）
    expect(a.center.x).toBe(422); // W/2 真居中
    // 三区互不重叠（left 右缘 < center x < right 左缘）
    expect(a.left.x + a.left.w).toBeLessThan(a.center.x);
    expect(a.center.x).toBeLessThan(a.right.x);
    expect(a.badge).toEqual({ x: 47 + 6, y: 44 + 42 + 4 }); // 顶部信息行之下 4px
  });

  it('2. 左右横屏 insets 互换：中央仍 W/2，left/right 镜像', () => {
    const aL = computeTopSafeAreas({ w: 844, h: 390 }, { top: 44, bottom: 0, left: 47, right: 0 }, resolveLayoutProfile(844, 390));
    const aR = computeTopSafeAreas({ w: 844, h: 390 }, { top: 44, bottom: 0, left: 0, right: 47 }, resolveLayoutProfile(844, 390));
    expect(aL.center.x).toBe(422);
    expect(aR.center.x).toBe(422); // 方向变化中央不偏移
    expect(aL.badge.x).toBe(47 + 6);
    expect(aR.badge.x).toBe(0 + 6);
    expect(aL.right.x + aL.right.w).toBe(844);
    expect(aR.right.x + aR.right.w).toBe(844 - 47); // 右横屏：右缘让出胶囊
  });

  it('3. short profile（logicalH<260）：topRowH=32，badge 锚跟随', () => {
    const a = computeTopSafeAreas({ w: 844, h: 240 }, { top: 30, bottom: 0, left: 20, right: 20 }, resolveLayoutProfile(844, 240));
    expect(a.topRowH).toBe(32);
    expect(a.badge).toEqual({ x: 20 + 6, y: 30 + 32 + 4 });
  });

  it('4. 1280×592：topRowH=42，右侧右缘 = W-insR', () => {
    const a = computeTopSafeAreas({ w: 1280, h: 592 }, { top: 44, bottom: 0, left: 47, right: 0 }, resolveLayoutProfile(1280, 592));
    expect(a.topRowH).toBe(42);
    expect(a.center.x).toBe(640);
    expect(a.right.x + a.right.w).toBe(1280);
  });

  it('5. 932×430（2796×1290 backing DPR3）：三区与 badge 全部位于安全区内', () => {
    const ins = { top: 47, bottom: 21, left: 59, right: 59 };
    const a = computeTopSafeAreas({ w: 932, h: 430 }, ins, resolveLayoutProfile(932, 430));
    expect(a.left.x).toBeGreaterThanOrEqual(ins.left);
    expect(a.left.y).toBeGreaterThanOrEqual(ins.top);
    expect(a.right.x + a.right.w).toBeLessThanOrEqual(932 - ins.right);
    expect(a.badge.x).toBeGreaterThanOrEqual(ins.left);
    expect(a.badge.y).toBeGreaterThanOrEqual(ins.top + a.topRowH);
  });
});

describe('F-WX-SAFE-AREA-P0｜badge 不覆盖顶部信息（集成）', () => {
  it('6. Home：badge 不与头像行重叠（badge 顶缘 ≥ insT+42）', () => {
    const { ui, driveFrame } = buildHarness();
    fakeInsets = { top: 44, bottom: 0, left: 47, right: 0 };
    driveFrame();
    const b = badgeBgLogical(ui, 2);
    expect(b).not.toBeNull();
    expect(b!.y).toBeGreaterThanOrEqual(44 + 42); // 头像行（profileRect 高 42）之下
    // 头像行实际绘制区域（computeHomeLayout profileRect 同源）
    const layout = computeHomeLayout({ w: 844, h: 390 }, fakeInsets, resolveLayoutProfile(844, 390));
    expect(overlaps(b!, layout.profileRect)).toBe(false);
  });

  it('7. Garage：badge 不与顶栏重叠（顶栏高 ≤42，badge 在其下方）', () => {
    const { ui, uiHost, driveFrame } = buildHarness();
    fakeInsets = { top: 30, bottom: 0, left: 20, right: 20 };
    // 进入 Garage 装配页（metaPage=garage；真实 host dispatch 路径）
    (uiHost as unknown as { dispatch(id: string): void }).dispatch('home-garage');
    driveFrame();
    const b = badgeBgLogical(ui, 2);
    expect(b).not.toBeNull();
    expect(b!.y).toBeGreaterThanOrEqual(30 + 42);
    // Garage 顶栏实际绘制区域（computeMobileGarageLayout topBarRect 同源）
    const layout = computeMobileGarageLayout({ w: 844, h: 390 }, fakeInsets, resolveLayoutProfile(844, 390));
    expect(overlaps(b!, layout.topBarRect)).toBe(false);
  });

  it('8. Battle：badge 不与顶部 HP 条区域重叠', () => {
    const { ui, runtime, driveFrame } = buildHarness();
    fakeInsets = { top: 40, bottom: 10, left: 30, right: 30 };
    // 进战斗
    runtime.actions.onFindOpponent();
    vi.advanceTimersByTime(1420 + 700 + 600);
    expect(runtime.battleState).toBe('fighting');
    driveFrame();
    const b = badgeBgLogical(ui, 2);
    expect(b).not.toBeNull();
    // HP 条顶部行：top = insT+4，条区 ≤ insT+4+31；badge 顶缘 ≥ insT+42 → 不重叠
    expect(b!.y).toBeGreaterThanOrEqual(40 + 42);
    const hpTop = 40 + 4;
    const hpRow = { x: 30, y: hpTop, w: 800, h: 40 };
    expect(overlaps(b!, hpRow)).toBe(false);
  });

  it('9. Matching：badge 不与顶部中央状态文字重叠', () => {
    const { ui, runtime, driveFrame } = buildHarness();
    fakeInsets = { top: 40, bottom: 0, left: 20, right: 20 };
    runtime.actions.onFindOpponent();
    vi.advanceTimersByTime(1420);
    driveFrame();
    const b = badgeBgLogical(ui, 2);
    expect(b).not.toBeNull();
    expect(b!.y).toBeGreaterThanOrEqual(40 + 42); // 状态文字中心 insT+22（≤42 行）之下
  });

  it('10. 120 帧无跳位：badge 位置恒定', () => {
    const { ui, driveFrame } = buildHarness();
    fakeInsets = { top: 44, bottom: 0, left: 47, right: 0 };
    driveFrame();
    const first = badgeBgLogical(ui, 2)!;
    for (let i = 0; i < 120; i++) {
      driveFrame();
      const cur = badgeBgLogical(ui, 2)!;
      expect(cur.x).toBe(first.x);
      expect(cur.y).toBe(first.y);
      expect(cur.w).toBe(first.w);
    }
  });

  it('11. 横屏方向变化（insets 重算）：badge 位置跟随 insT/insL，不缓存旧方向', () => {
    const { ui, driveFrame } = buildHarness();
    fakeInsets = { top: 44, bottom: 0, left: 47, right: 0 }; // 左横屏
    driveFrame();
    const leftBadge = badgeBgLogical(ui, 2)!;
    fakeInsets = { top: 30, bottom: 0, left: 20, right: 47 }; // 右横屏（insT/insL 变化）
    driveFrame();
    const rightBadge = badgeBgLogical(ui, 2)!;
    expect(rightBadge.y).toBe(30 + 42 + 4); // 已按新 insT 重算
    expect(rightBadge.x).toBe(20 + 6); // 已按新 insL 重算
    expect(rightBadge.x).not.toBe(leftBadge.x);
    expect(rightBadge.y).not.toBe(leftBadge.y);
  });
});
