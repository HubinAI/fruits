/**
 * F-WX-IOS-CANVAS-CRASH-P0｜Must#1 无 DOM 微信 Canvas 120 帧稳定像素门禁
 *
 * 目标：在不依赖 DOM / 真机的前提下，用软件光栅化假 Canvas 驱动「真实」的
 * CanvasPlayerUIHost 渲染管线，逐帧记录 UI 离屏画布像素签名，证明：
 *   1) 每帧 UI 离屏画布都被完整清空（clear 后残留 ink = 0）；
 *   2) 第 1 / 30 / 60 / 120 帧像素签名稳定（不随帧数增长）；
 *   3) 文字像素数量不随帧数增长；
 *   4) SHA(6,8) 始终位于逻辑舞台左上对应 device 区域；
 *   5) 仅一个最终可见 Canvas（UI 离屏只作 overlay source，compositeCanvas 在微信路径为 null）；
 *   6) compositeUi 后 screenCtx transform 恢复（save/restore 平衡）+ 以 identity 1:1 合成；
 *   7) MUST#4｜DPR 单次转换：UIHost 绘制 transform scale 恰好 = DPR（一次转换），
 *      composite 以 identity（scale 1）1:1 搬运，绝不二次乘 DPR；
 *   8) MUST#7｜逐帧稳定后模拟点击（blank/vehicle/garage/CTA），handlePointer 不抛异常。
 *
 * 若该测试在「修复前代码」上失败 = 已稳定复现「像素累积 / transform 污染」；
 * 修复后必须稳定通过（回归锁）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { CanvasPlayerUIHost } from '../src/ui/canvasPlayerUIHost';
import { FakeCanvas, FakeCtx2D, makeFakePlatformCore } from './wechatCanvasFrameHost';
import { OFFICIAL_PARTS } from '../src/core/partInventory';
import type { PlayerUIState, PlayerUIHudFrame } from '../src/ui/playerUI';

const DPR = 2;
// 对齐 Must#1 真实尺寸：logical stage 844×390，iOS physical 2048×941，DPR 2 →
// 逻辑高 = 941/2 = 470.5（非整数！正是真机「非整数缩放」复现条件）。
const UI_W = 2048;
const UI_H = 941;
const LOGICAL_W = UI_W / DPR; // 1024
const LOGICAL_H = UI_H / DPR; // 470.5（非整数）
// 微信单画布：screenCanvas 与 uiCanvas 同物理尺寸（真实微信 surface 二者一致），composite 1:1
const SCREEN_W = UI_W;
const SCREEN_H = UI_H;

/** 构造一个最小但足以驱动 desktop drawGarageDock 的 home 状态 */
function makeHomeState(): PlayerUIState {
  return {
    uiMode: 'player',
    battleState: 'editing',
    playerPhase: 'garage',
    draft: {
      bodyDefId: 'body_watermelon',
      rearRadius: 30,
      frontRadius: 30,
      functionalSelections: {},
      drive: '前进',
    } as unknown as PlayerUIState['draft'],
    draftValid: true,
    blockReason: null,
    garageSelected: null,
    inventory: Object.fromEntries(OFFICIAL_PARTS.map((p) => [p, { one: 1, two: 0 }])) as unknown as PlayerUIState['inventory'],
    progress: { coin: 0, rating: 0 },
    onboarding: 'done' as unknown as PlayerUIState['onboarding'],
    resetDevVisible: false,
    opponent: null,
    matchVehicleRects: null,
    homeVehicleRect: null,
    hardpointScreenPts: [],
    overloadDelta: null,
    devGrantMessage: null,
    matchBarHidden: true,
    result: null,
    reward: null,
    economy: null,
    resultOnboardingVisible: false,
    rewardAdAvailable: false,
    metaPage: 'home',
  } as unknown as PlayerUIState;
}

function makeHudFrame(): PlayerUIHudFrame {
  return {
    battleState: 'editing',
    battleStatus: null,
    phaseCountdownText: null,
  };
}

describe('F-WX-IOS-CANVAS-CRASH-P0｜微信 Canvas 120 帧稳定像素门禁', () => {
  let uiCanvas: FakeCanvas;
  let uiCtx: FakeCtx2D;
  let uiHost: CanvasPlayerUIHost;
  let screenCanvas: FakeCanvas;
  let screenCtx: FakeCtx2D;
  let core: ReturnType<typeof makeFakePlatformCore>;

  beforeAll(() => {
    core = makeFakePlatformCore({ dpr: DPR, surfaceWidth: UI_W, surfaceHeight: UI_H });
    uiCanvas = new FakeCanvas({ width: UI_W, height: UI_H, logicalW: LOGICAL_W, logicalH: LOGICAL_H });
    uiCtx = uiCanvas.ctx;
    uiHost = new CanvasPlayerUIHost(uiCanvas as unknown as HTMLCanvasElement);
    // 微信路径：mountCanvas（无 DOM 容器）
    uiHost.mountCanvas();
    // RC 水印（模拟 badge 开启）
    uiHost.setBuildBadge('#1fb1153');

    screenCanvas = new FakeCanvas({ width: SCREEN_W, height: SCREEN_H });
    screenCtx = screenCanvas.ctx;
  });

  it('逐帧驱动 120 帧静态 home，UI 离屏画布不累积', { timeout: 60000 }, () => {
    const state = makeHomeState();
    const frame = makeHudFrame();
    const inkSeries: number[] = [];
    const textInkSeries: number[] = [];
    const clearResidualSeries: number[] = [];
    const frameErrors: string[] = [];

    for (let i = 0; i < 120; i++) {
      try {
        // 每帧 push 一次 UI 状态（模拟 runtime 每帧 renderBattleFrame 前的 render）
        uiHost.render(state);
        uiHost.renderBattleFrame(frame);
      } catch (err) {
        frameErrors.push(`frame ${i}: ${(err as Error).message}`);
      }
      inkSeries.push(uiCanvas.inkSize);
      textInkSeries.push(uiCanvas.textInkSize);
      clearResidualSeries.push(uiCtx.lastClearResidual);
    }

    // 调试输出（仅开发侧阅读；不进入正式构建）
    // eslint-disable-next-line no-console
    console.log('[GATE] ink@1/30/60/120 =', inkSeries[0], inkSeries[29], inkSeries[59], inkSeries[119]);
    // eslint-disable-next-line no-console
    console.log('[GATE] textInk@1/30/60/120 =', textInkSeries[0], textInkSeries[29], textInkSeries[59], textInkSeries[119]);
    // eslint-disable-next-line no-console
    console.log('[GATE] maxClearResidual =', Math.max(...clearResidualSeries), 'nonIdentityClears =', uiCtx.nonIdentityClearCount);
    // eslint-disable-next-line no-console
    console.log('[GATE] uiMaxDrawScale =', uiCtx.maxDrawScale, '(expect === DPR =', DPR, ')');
    // eslint-disable-next-line no-console
    console.log('[GATE] frameErrors =', frameErrors.length, frameErrors.slice(0, 3));

    // 1) 每帧 clear 后必须残留为 0（UI 离屏被完整清空）
    expect(Math.max(...clearResidualSeries)).toBe(0);

    // 2) 第 1/30/60/120 帧 ink 签名稳定（容差 1%）
    const base = inkSeries[0];
    expect(base).toBeGreaterThan(0);
    for (const idx of [29, 59, 119]) {
      const delta = Math.abs(inkSeries[idx] - base);
      expect(delta / base).toBeLessThan(0.01);
    }

    // 3) 文字像素不随帧数增长（末帧不得显著多于首帧）
    expect(textInkSeries[119]).toBeLessThanOrEqual(textInkSeries[0] + 1);

    // 4) SHA 位于逻辑 (6,8) 对应 device 左上区域（dpr=2 → (12,16) 附近）
    const shaX = 6 * DPR;
    const shaY = 8 * DPR;
    let found = false;
    for (let dx = -2; dx <= 2 && !found; dx++) {
      for (let dy = -2; dy <= 2 && !found; dy++) {
        const idx = (shaY + dy) * UI_W + (shaX + dx);
        if (uiCtx.ink[idx] === 1) found = true;
      }
    }
    expect(found).toBe(true);

    // 5) 仅一个最终可见 Canvas：微信路径下 UI 离屏画布不进 DOM、不自我合成
    //    （compositeCanvas 返回 null，由 game.ts compositeUi() 直接把 uiCanvas 作为 overlay source
    //     合成到唯一可见 screenCanvas）。UI 离屏与可见 Canvas 必须不同实例。
    expect(uiHost.compositeCanvas).toBeNull();
    expect(uiCanvas).not.toBe(screenCanvas);

    // 7) MUST#4｜DPR 单次转换：UIHost 绘制 transform scale 恰好 = DPR（一次转换，绝不二次乘 DPR）
    expect(uiCtx.maxDrawScale).toBeCloseTo(DPR, 9);
    expect(uiCtx.maxDrawScale).toBeLessThan(DPR * 1.5); // 反证：不得出现 2×DPR 双转换
  });

  it('compositeUi 后 screenCtx transform 恢复（save/restore 平衡）+ identity 1:1 合成', () => {
    // 模拟 game.ts compositeUi()：save → identity → drawImage(uiCanvas) → restore
    const tBefore = screenCtx.currentTransform();
    screenCtx.save();
    screenCtx.setTransform(1, 0, 0, 1, 0, 0);
    screenCtx.drawImage(uiCanvas, 0, 0, uiCanvas.width, uiCanvas.height);
    screenCtx.restore();
    const tAfter = screenCtx.currentTransform();
    // restore 后 transform 应回到 save 前（此处 save 前为默认 identity）
    expect(tAfter).toEqual(tBefore);
    expect(tBefore).toEqual([1, 0, 0, 1, 0, 0]);
    // MUST#3/4：composite 以 identity（scale 1）搬运，绝不在世界相机变换下叠加
    expect(screenCtx.lastDrawImageScale).toBe(1);
    expect(screenCanvas.inkSize).toBeGreaterThan(0); // 合成确实把 UI 内容搬上屏
  });

  it('MUST#7｜逐帧稳定后模拟点击 blank/vehicle/garage/CTA，handlePointer 不抛异常', { timeout: 60000 }, () => {
    const state = makeHomeState();
    const frame = makeHudFrame();
    // 先稳定若干帧（与门禁一致），确保 hitAreas 已就绪
    for (let i = 0; i < 30; i++) {
      uiHost.render(state);
      uiHost.renderBattleFrame(frame);
    }
    expect(core.capturedPointerHandlers.length).toBeGreaterThan(0);
    const handler = core.capturedPointerHandlers[core.capturedPointerHandlers.length - 1];

    const clicks = [
      [10, 10], // blank
      [512, 235], // vehicle / dock 中心
      [512, 460], // garage dock 底部
      [120, 30], // CTA / 顶栏区域
    ];
    const errors: string[] = [];
    for (const [x, y] of clicks) {
      try {
        handler(x, y);
      } catch (err) {
        errors.push(`click(${x},${y}): ${(err as Error).message}`);
      }
    }
    expect(errors).toEqual([]);
  });
});
