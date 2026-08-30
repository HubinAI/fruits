/**
 * F-WX-SAFE-AREA-R1｜真实微信原生胶囊数据形态 targeted test（Must#9）。
 *
 * 不复用「直接传入理想 safeInsets」的形态——本测试模拟真实 `wx.getWindowInfo()` +
 * `wx.getMenuButtonBoundingClientRect()` 运行数据，走真实 WechatViewport.safeInsets()
 * （readWechatWindowInfo → 坐标域归一 → 胶囊折叠），再断言真实消费者：
 * - 首页 4 宝箱右缘 ≤ menuButton.left − 6；
 * - Battle 右 HUD 右缘 ≤ menuButton.left − 6；
 * - 1280×592 与 844×390；刘海在左/右；menu rect 缺失/异常 fallback。
 *
 * 冻结：不修改车辆构图 / Garage 装配带 / Battle 表现 / Physics / 输入。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { WechatViewport } from '../src/platform/wechat/viewport';
import { bindPlatformCore } from '../src/platform/context';
import { createWechatCore } from '../src/platform/wechat/index';
import { FakeCanvas } from './wechatCanvasFrameHost';
import { Renderer } from '../src/render/renderer';
import { VisualRegistry } from '../src/render/visualRegistry';
import { SfxAudioService } from '../src/presentation/audioService';
import { createPlayerPresentation } from '../src/presentation/playerPresentation';
import { CanvasPlayerUIHost } from '../src/ui/canvasPlayerUIHost';
import { PlayerGameRuntime } from '../src/game/playerGameRuntime';
import { WechatBattleHost } from '../src/game/wechatBattleHost';
import { computeHomeLayout } from '../src/ui/homeLayout';
import { resolveLayoutProfile } from '../src/ui/layoutProfile';
import { computeMobileGarageLayout } from '../src/ui/mobileGarageLayout';

let fakeNow = 0;

interface WxEnv {
  windowW: number;
  windowH: number;
  dpr: number;
  safeArea: { left: number; top: number; right: number; bottom: number };
  /** null = API 缺失（getMenuButtonBoundingClientRect 抛异常） */
  menuButton: (() => { left: number; top: number; right: number; bottom: number; width: number; height: number }) | null;
}

/** 安装真实形态的 wx 全局（getWindowInfo + getMenuButtonBoundingClientRect）。 */
function installWx(env: WxEnv): void {
  const wx = {
    getWindowInfo: () => ({
      windowWidth: env.windowW,
      windowHeight: env.windowH,
      screenWidth: Math.round(env.windowW * env.dpr),
      screenHeight: Math.round(env.windowH * env.dpr),
      pixelRatio: env.dpr,
      safeArea: {
        left: env.safeArea.left,
        top: env.safeArea.top,
        right: env.safeArea.right,
        bottom: env.safeArea.bottom,
        width: Math.max(0, env.safeArea.right - env.safeArea.left),
        height: Math.max(0, env.safeArea.bottom - env.safeArea.top),
      },
    }),
    getMenuButtonBoundingClientRect: env.menuButton
      ? () => env.menuButton!()
      : () => {
          throw new Error('getMenuButtonBoundingClientRect unavailable');
        },
  };
  (globalThis as unknown as { wx: unknown }).wx = wx;
}

afterEach(() => {
  delete (globalThis as unknown as { wx?: unknown }).wx;
  (globalThis as unknown as { window?: { devicePixelRatio: number } }).window = { devicePixelRatio: 1 };
});

function fakeCanvasLike(w: number, h: number): { width: number; height: number } {
  return { width: w, height: h };
}

/** iPhone 14 Pro 横屏 844×390 DPR3 刘海在左（safeArea.left=47）+ 右上原生胶囊。 */
const IPHONE_LEFT_NOTCH: WxEnv = {
  windowW: 844,
  windowH: 390,
  dpr: 3,
  safeArea: { left: 47, top: 44, right: 797, bottom: 346 },
  menuButton: () => ({ left: 700, top: 44, right: 787, bottom: 76, width: 87, height: 32 }),
};

describe('F-WX-SAFE-AREA-R1｜WechatViewport.safeInsets 真实胶囊', () => {
  it('1. 844×390 刘海在左：rightReserved = ww-(mb.left-6)，与 safeArea 右侧保留取较大值', () => {
    installWx(IPHONE_LEFT_NOTCH);
    const vp = new WechatViewport(fakeCanvasLike(844 * 3, 390 * 3), 3);
    const ins = vp.safeInsets();
    const rightReserved = 844 - (700 - 6); // 150
    const safeRight = 844 - 797; // 47
    expect(ins.right).toBe(Math.max(rightReserved, safeRight));
    expect(ins.right).toBe(150);
    expect(ins.left).toBe(47);
  });

  it('2. 刘海在右（safeArea 右侧保留大）：right = max(safeArea, 胶囊)', () => {
    installWx({ ...IPHONE_LEFT_NOTCH, safeArea: { left: 0, top: 44, right: 797 - 47, bottom: 346 } });
    const vp = new WechatViewport(fakeCanvasLike(844 * 3, 390 * 3), 3);
    const ins = vp.safeInsets();
    const safeRight = 844 - (797 - 47); // 94
    const capsule = 844 - (700 - 6); // 150
    expect(ins.right).toBe(Math.max(safeRight, capsule)); // 150
  });

  it('3. menu rect 返回物理 px（left > ww）→ ÷dpr 归一 logical，禁止混用 backing（Must#3）', () => {
    installWx({ ...IPHONE_LEFT_NOTCH, menuButton: () => ({ left: 2100, top: 132, right: 2361, bottom: 228, width: 261, height: 96 }) });
    const vp = new WechatViewport(fakeCanvasLike(844 * 3, 390 * 3), 3);
    const ins = vp.safeInsets();
    // 物理 left=2100 ÷ dpr3 = 700 逻辑 → rightReserved = 844-(700-6) = 150
    expect(ins.right).toBe(150);
  });

  it('4. menuButton 缺失（API 异常）：安全 fallback，不得回退为 0（Must#4）', () => {
    installWx({ ...IPHONE_LEFT_NOTCH, menuButton: null });
    const vp = new WechatViewport(fakeCanvasLike(844 * 3, 390 * 3), 3);
    const ins = vp.safeInsets();
    // iOS 横屏 safeArea.right≈0 → 右侧保留必须来自 fallback（≥96，且 ≥ww*12%）
    expect(ins.right).toBeGreaterThanOrEqual(96);
    expect(ins.right).toBeGreaterThanOrEqual(844 * 0.12);
    expect(ins.right).not.toBe(0);
  });

  it('5. 1280×592（测试台宽屏）同样按真实胶囊计算', () => {
    installWx({
      windowW: 1280,
      windowH: 592,
      dpr: 1,
      safeArea: { left: 47, top: 44, right: 1233, bottom: 548 },
      menuButton: () => ({ left: 1136, top: 44, right: 1223, bottom: 76, width: 87, height: 32 }),
    });
    const vp = new WechatViewport(fakeCanvasLike(1280, 592), 1);
    const ins = vp.safeInsets();
    expect(ins.right).toBe(1280 - (1136 - 6)); // 150
  });

  it('6. 932×430 DPR3（2796×1290 backing）：坐标域一致', () => {
    installWx({
      windowW: 932,
      windowH: 430,
      dpr: 3,
      safeArea: { left: 59, top: 47, right: 873, bottom: 383 },
      menuButton: () => ({ left: 788, top: 47, right: 875, bottom: 79, width: 87, height: 32 }),
    });
    const vp = new WechatViewport(fakeCanvasLike(932 * 3, 430 * 3), 3);
    const ins = vp.safeInsets();
    expect(ins.right).toBe(932 - (788 - 6)); // 150
  });
});

describe('F-WX-SAFE-AREA-R1｜真实消费者右缘（Must#5/#6/#7）', () => {
  function buildUiHarness(env: WxEnv, logicalW: number, logicalH: number, dpr: number) {
    fakeNow = 0;
    vi.useFakeTimers();
    installWx(env);
    (globalThis as unknown as { window?: { devicePixelRatio: number } }).window = { devicePixelRatio: dpr };
    const surface = {
      width: logicalW,
      height: logicalH,
      devicePixelRatio: dpr,
      now: () => fakeNow,
    };
    // 真实微信 core：createViewport → WechatViewport（safeInsets 从 wx 真实读取）
    bindPlatformCore(createWechatCore(dpr));
    const backingW = Math.round(logicalW * dpr);
    const backingH = Math.round(logicalH * dpr);
    const screen = new FakeCanvas({ width: backingW, height: backingH, logicalW, logicalH });
    const ui = new FakeCanvas({ width: backingW, height: backingH, logicalW, logicalH });
    screen.ctx.fastRaster = true;
    ui.ctx.fastRaster = true;
    const renderer = new Renderer(screen as unknown as HTMLCanvasElement, new VisualRegistry(), surface);
    const sfx = new SfxAudioService();
    const presentation = createPlayerPresentation(renderer, sfx);
    const battleHost = new WechatBattleHost(renderer, presentation);
    const uiHost = new CanvasPlayerUIHost(ui as unknown as HTMLCanvasElement);
    uiHost.mountCanvas(); // → platform.createViewport(uiCanvas) → WechatViewport（真实 safeInsets）
    const runtime = new PlayerGameRuntime({ host: uiHost, battle: battleHost, sfx });
    runtime.init();
    const driveFrame = (dt = 16.7) => {
      fakeNow += dt;
      screen.ctx.clearDrawOps();
      ui.ctx.clearDrawOps();
      runtime.tick(fakeNow);
    };
    return { surface, screen, ui, renderer, sfx, battleHost, uiHost, runtime, driveFrame };
  }

  it('7. Home：第 4 个宝箱右缘 ≤ mb.left−6（844×390 刘海在左，真实 wx）', () => {
    const { ui, driveFrame } = buildUiHarness(IPHONE_LEFT_NOTCH, 844, 390, 3);
    driveFrame();
    const vp = new WechatViewport(fakeCanvasLike(844 * 3, 390 * 3), 3);
    const ins = vp.safeInsets();
    const layout = computeHomeLayout({ w: 844, h: 390 }, ins, resolveLayoutProfile(844, 390));
    const chest3 = layout.chestSlot(3);
    const mbLeft = 700;
    expect(chest3.x + chest3.w).toBeLessThanOrEqual(mbLeft - 6);
    // UI 实际绘制全部 rect/text 不越过 mb.left−6 的 backing 坐标
    const limitX = (mbLeft - 6) * 3;
    for (const op of ui.ctx.drawOps) {
      if (op.type === 'rect' || op.type === 'text') {
        expect(op.devX + op.devW, `UI op 越界: ${op.text ?? op.fillStyle}`).toBeLessThanOrEqual(limitX + 2);
      }
    }
  });

  it('8. Battle：右 HUD（名称/HP）右缘 ≤ mb.left−6', () => {
    const { ui, runtime, driveFrame } = buildUiHarness(IPHONE_LEFT_NOTCH, 844, 390, 3);
    runtime.actions.onFindOpponent();
    expect(runtime.playerPhase).toBe('matching');
    vi.advanceTimersByTime(1420 + 700 + 600);
    expect(runtime.battleState).toBe('fighting');
    driveFrame();
    const mbLeft = 700;
    const limitX = (mbLeft - 6) * 3;
    let foundRightHud = false;
    for (const op of ui.ctx.drawOps) {
      if (op.type === 'text' && op.devX > 844 * 1.5) {
        // 右半区文本（对手名/HP 数字，右对齐）右缘不越过胶囊
        foundRightHud = true;
        expect(op.devX + op.devW, `右 HUD op 越界: ${op.text}`).toBeLessThanOrEqual(limitX + 2);
      }
    }
    expect(foundRightHud, '应存在右侧 HUD 文本').toBe(true);
  });

  it('9. menuButton 缺失 fallback 下：宝箱右缘仍 ≤ ww − fallback（不落入右侧未知区域）', () => {
    const env = { ...IPHONE_LEFT_NOTCH, menuButton: null } as WxEnv;
    const { ui, driveFrame } = buildUiHarness(env, 844, 390, 3);
    driveFrame();
    const vp = new WechatViewport(fakeCanvasLike(844 * 3, 390 * 3), 3);
    const ins = vp.safeInsets();
    const layout = computeHomeLayout({ w: 844, h: 390 }, ins, resolveLayoutProfile(844, 390));
    const chest3 = layout.chestSlot(3);
    expect(ins.right).toBeGreaterThanOrEqual(96);
    expect(chest3.x + chest3.w).toBeLessThanOrEqual(844 - ins.right);
    expect(chest3.x + chest3.w).toBeLessThan(844); // 不贴最右（未被覆盖语义）
    void ui;
  });

  it('10. 1280×592：Home 宝箱右缘 ≤ mb.left−6；Garage 顶栏右缘同理', () => {
    const env: WxEnv = {
      windowW: 1280,
      windowH: 592,
      dpr: 1,
      safeArea: { left: 47, top: 44, right: 1233, bottom: 548 },
      menuButton: () => ({ left: 1136, top: 44, right: 1223, bottom: 76, width: 87, height: 32 }),
    };
    const { uiHost, runtime, driveFrame } = buildUiHarness(env, 1280, 592, 1);
    driveFrame();
    const vp = new WechatViewport(fakeCanvasLike(1280, 592), 1);
    const ins = vp.safeInsets();
    const mbLeft = 1136;
    const homeLayout = computeHomeLayout({ w: 1280, h: 592 }, ins, resolveLayoutProfile(1280, 592));
    expect(homeLayout.chestSlot(3).x + homeLayout.chestSlot(3).w).toBeLessThanOrEqual(mbLeft - 6);
    (uiHost as unknown as { dispatch(id: string): void }).dispatch('home-garage');
    driveFrame();
    const gl = computeMobileGarageLayout({ w: 1280, h: 592 }, ins, resolveLayoutProfile(1280, 592));
    expect(gl.topBarRect.x + gl.topBarRect.w).toBeLessThanOrEqual(mbLeft - 6);
    void runtime;
  });
});
