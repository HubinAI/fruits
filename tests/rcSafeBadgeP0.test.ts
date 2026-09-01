/**
 * F-WX-RC-SAFE-BADGE-P0｜RC 版号安全区 + 合成层级 targeted test。
 *
 * 复现链（Must#1）：RC 构建变量（WECHAT_BADGE=1）→ vite define（__WX_BUILD_BADGE__）
 * → 微信入口读取（game.ts:379-380 setBuildBadge）→ 绘制函数（CanvasPlayerUIHost.drawBuildBadge）
 * → Canvas 坐标域（logical px；mobile scale=1，ctx transform=DPR）→ Renderer/UI composite
 * （loop.onFrame → runtime.tick → uiHost.renderBattleFrame → compositeUi 最后一层）→ 最终提交帧。
 *
 * 首次不可见的位置（报告）：旧实现 canvasPlayerUIHost.ts:1597 `this.text(buildBadge, insL+6,
 * insT+6, 9, 'rgba(255,255,255,0.5)', 'left', 400)` 的参数组合：
 * ① 字号 9（fontScale 0.8 → 实际 8 logical px）< 11；② 半透明白无深色底 → 浅背景不可见；
 * ③ 位置依赖 insets，insets=0 时 (6,6) 落横屏刘海/圆角安全区外被裁切；④ 仅在 draw() 内绘制，
 * 稳态页依赖离屏残留，onWindowResize 清空 backing 后消失（不满足每帧最后绘制）。
 *
 * 验收（Must#6）：本测试用真实 PlayerGameRuntime + CanvasPlayerUIHost + FakeCanvas（几何
 * drawOps + 真实 ink 像素），覆盖 1280×592（safeArea.left=47）/ 844×390 DPR3 /
 * 2796×1290 backing DPR3 / 左右横屏 / Home·Garage·Matching·Battle·Result / 120 帧持续 /
 * 包围盒完整位于 safeArea / UI 合成后高对比像素。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { bindPlatformCore } from '../src/platform/context';
import { FakeCanvas } from './wechatCanvasFrameHost';
import { Renderer } from '../src/render/renderer';
import { VisualRegistry } from '../src/render/visualRegistry';
import { SfxAudioService } from '../src/presentation/audioService';
import { createPlayerPresentation } from '../src/presentation/playerPresentation';
import { CanvasPlayerUIHost } from '../src/ui/canvasPlayerUIHost';
import { PlayerGameRuntime } from '../src/game/playerGameRuntime';
import { WechatBattleHost } from '../src/game/wechatBattleHost';

const BADGE_TEXT = '#8a7d334';
const BADGE_BG = 'rgba(0,0,0,0.55)';
const BADGE_FG = '#ffffff';
const BADGE_SIZE = 11; // logical px（Must#4 ≥11）

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

function buildHarness(logicalW = 844, logicalH = 390, dpr = 2, injectBadge = true) {
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
  // RC 注入（wechat/game.ts:380 语义：仅 __WX_BUILD_BADGE__ 构建调用）
  if (injectBadge) uiHost.setBuildBadge(BADGE_TEXT);
  const driveFrame = (dt = 16.7) => {
    fakeNow += dt;
    screen.ctx.clearDrawOps();
    ui.ctx.clearDrawOps();
    runtime.tick(fakeNow);
  };
  return { surface, store, visibilityCbs, screen, ui, renderer, sfx, battleHost, uiHost, runtime, driveFrame };
}

/** 当前 drawOps 中的 badge 文本 op（每帧恰好一个：fillText '#8a7d334'，白字）。 */
function badgeTextOps(ui: FakeCanvas) {
  return ui.ctx.drawOps.filter((o) => o.type === 'text' && o.text === BADGE_TEXT && o.fillStyle === BADGE_FG);
}

/** 当前 drawOps 中 badge 深色底 rect op（fillStyle 精确匹配深色底，尺寸小、位于安全区左上角）。 */
function badgeBgOps(ui: FakeCanvas) {
  return ui.ctx.drawOps.filter((o) => o.type === 'rect' && o.fillStyle === BADGE_BG);
}

describe('F-WX-RC-SAFE-BADGE-P0｜RC 版号安全区与合成层级', () => {
  // F-CONTENT-PLAYER-MOVEMENT-PACK-R1（回归门禁修复）：buildHarness 每次调用
  // vi.useFakeTimers() + vi.spyOn(Math,'random') 但从不恢复——泄漏到后续测试文件
  // （vmForks 串行同进程），使 audioLifecycleP0/platformCore 的真实 setTimeout 永不
  // 触发导致超时。每测试后恢复（不改变本文件断言语义）。
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  // ============ 1. 位置/字号/颜色/层级（Must#2/#4）============
  it('1. Home 帧：badge 深色底 + 白字 11px + DPR 单次变换（source-over 合成层级）', () => {
    const { ui, driveFrame } = buildHarness();
    driveFrame();
    const texts = badgeTextOps(ui);
    const bgs = badgeBgOps(ui);
    expect(texts.length).toBe(1); // 每帧恰好一个 badge 文本
    expect(bgs.length).toBe(1); // 恰好一个深色底
    expect(texts[0].fontSize).toBe(BADGE_SIZE); // ≥11 logical px
    // 合成层级：badge 是 UI 层最后绘制的元素（其后无任何绘制 op）
    const badgeOps = [...bgs, ...texts];
    const lastOp = ui.ctx.drawOps[ui.ctx.drawOps.length - 1];
    expect(badgeOps.some((o) => o === lastOp)).toBe(true);
    // DPR 单次应用（844×390 DPR2：绘制 max|scale| 应恰为 2，一次 logical→backing）
    expect((ui.ctx as unknown as { maxDrawScale: number }).maxDrawScale).toBeCloseTo(2, 6);
  });

  // ============ 2. 1280×592，safeArea.left=47（Must#6 首项）============
  it('2. 1280×592 safeArea.left=47：badge 位于安全区内（x≥(47+6)logical，包围盒不超 safeArea）', () => {
    const { ui, driveFrame } = buildHarness(1280, 592, 1);
    fakeInsets = { top: 44, bottom: 0, left: 47, right: 0 };
    driveFrame();
    const texts = badgeTextOps(ui);
    const bgs = badgeBgOps(ui);
    expect(texts.length).toBe(1);
    expect(bgs.length).toBe(1);
    const r = bgs[0];
    // backing = logical（DPR1）：badge 底完整位于 safeArea [left, top, 1280-right, 592-bottom]
    expect(r.devX).toBeGreaterThanOrEqual((47 + 6) * 1);
    expect(r.devY).toBeGreaterThanOrEqual((44 + 6) * 1);
    expect(r.devX + r.devW).toBeLessThanOrEqual(1280 - 0);
    expect(r.devY + r.devH).toBeLessThanOrEqual(592 - 0);
    // 文本完整在底内
    const t = texts[0];
    expect(t.devX).toBeGreaterThanOrEqual(r.devX);
    expect(t.devY).toBeGreaterThanOrEqual(r.devY);
    expect(t.devX + t.devW).toBeLessThanOrEqual(r.devX + r.devW);
    expect(t.devY + t.devH).toBeLessThanOrEqual(r.devY + r.devH);
  });

  // ============ 3. 844×390，DPR3（Must#6）============
  it('3. 844×390 DPR3：backing 2532×1170，字号 11 logical（backing 33），包围盒在安全区内', () => {
    const { ui, driveFrame } = buildHarness(844, 390, 3);
    fakeInsets = { top: 47, bottom: 21, left: 59, right: 59 };
    driveFrame();
    const texts = badgeTextOps(ui);
    const bgs = badgeBgOps(ui);
    expect(texts.length).toBe(1);
    expect(texts[0].fontSize).toBe(11);
    // backing 高 = 字号 × DPR
    expect(texts[0].devH).toBeCloseTo(11 * 3, 1);
    const r = bgs[0];
    expect(r.devX).toBeGreaterThanOrEqual((59 + 6) * 3);
    expect(r.devY).toBeGreaterThanOrEqual((47 + 6) * 3);
    expect(r.devX + r.devW).toBeLessThanOrEqual((844 - 59) * 3);
    expect(r.devY + r.devH).toBeLessThanOrEqual((390 - 21) * 3);
  });

  // ============ 4. 2796×1290 backing，DPR3（Must#6）============
  it('4. 2796×1290 backing DPR3（logical 932×430）：badge 在安全区内，字号 11', () => {
    const { ui, driveFrame } = buildHarness(932, 430, 3);
    fakeInsets = { top: 47, bottom: 21, left: 59, right: 59 };
    driveFrame();
    const texts = badgeTextOps(ui);
    const bgs = badgeBgOps(ui);
    expect(texts.length).toBe(1);
    expect(texts[0].fontSize).toBe(11);
    const r = bgs[0];
    expect(r.devX).toBeGreaterThanOrEqual((59 + 6) * 3);
    expect(r.devY).toBeGreaterThanOrEqual((47 + 6) * 3);
    expect(r.devX + r.devW).toBeLessThanOrEqual((932 - 59) * 3);
    expect(r.devY + r.devH).toBeLessThanOrEqual((430 - 21) * 3);
  });

  // ============ 5. 左右横屏方向（Must#6）============
  it('5. 左右横屏：insets left vs right 互换 → badge 位置随安全区重算', () => {
    const { ui, driveFrame } = buildHarness(844, 390, 2);
    // 左横屏（刘海在左）
    fakeInsets = { top: 44, bottom: 0, left: 47, right: 0 };
    driveFrame();
    const leftX = badgeBgOps(ui)[0].devX;
    // 右横屏（刘海在右 → 安全区右缘内缩 47）
    fakeInsets = { top: 44, bottom: 0, left: 0, right: 47 };
    driveFrame();
    const rightBg = badgeBgOps(ui)[0];
    // 右横屏：badge 仍锚左上角（ins.left=0 → x=6），但右缘不得超安全区
    expect(rightBg.devX).toBeGreaterThanOrEqual(6 * 2);
    expect(rightBg.devX + rightBg.devW).toBeLessThanOrEqual((844 - 47) * 2);
    // 两种方向下 badge 都完整在各自 safeArea 内
    expect(leftX).toBeGreaterThanOrEqual((47 + 6) * 2);
  });

  // ============ 6. 页面覆盖 Home/Garage/Matching/Battle/Result（Must#6）============
  it('6. Home/Garage/Matching/Battle/Result 每页 badge 均存在且唯一', () => {
    const { ui, runtime, battleHost, driveFrame } = buildHarness();
    // Home（boot 后）
    driveFrame();
    expect(badgeTextOps(ui).length).toBe(1);
    // Matching（连续页）
    runtime.actions.onFindOpponent();
    expect(runtime.playerPhase).toBe('matching');
    vi.advanceTimersByTime(1420);
    driveFrame();
    expect(badgeTextOps(ui).length).toBe(1); // Matching 仍画 badge
    // Battle（fighting）
    vi.advanceTimersByTime(700 + 600);
    expect(runtime.battleState).toBe('fighting');
    driveFrame();
    expect(badgeTextOps(ui).length).toBe(1); // Battle 仍画 badge
    // Result（ended）。guard 为防御性预算（防死循环）：R1 对手池扩容后固定抽取
    // 0.42 命中最长 ~968 帧 KO 的战斗，900 帧不足，放大到 1200（+24% 余量）。
    let guard = 0;
    while (runtime.battleState !== 'ended' && guard < 1200) {
      driveFrame();
      guard++;
    }
    expect(runtime.battleState).toBe('ended');
    driveFrame();
    expect(badgeTextOps(ui).length).toBe(1); // Result 仍画 badge
    // 回 Garage（装配页）
    runtime.actions.onResultAdjust();
    expect(runtime.playerPhase).toBe('garage');
    driveFrame();
    expect(badgeTextOps(ui).length).toBe(1); // Garage 仍画 badge
    void battleHost;
  });

  // ============ 7. 120 帧持续存在（Must#6）============
  it('7. 稳态 120 帧：badge 每帧都绘制（不依赖 dirty / 离屏残留）', () => {
    const { ui, driveFrame } = buildHarness();
    driveFrame(); // boot 帧
    let textCount = 0;
    let bgCount = 0;
    for (let i = 0; i < 120; i++) {
      driveFrame();
      textCount += badgeTextOps(ui).length;
      bgCount += badgeBgOps(ui).length;
    }
    expect(textCount).toBe(120);
    expect(bgCount).toBe(120);
  });

  // ============ 8. UI 合成后仍可检测到高对比像素（Must#6 末项；真实 ink 像素）============
  it('8. UI 合成后：badge 深色底 + 白字区域有真实 ink 像素（高对比可检测）', () => {
    const { ui, driveFrame } = buildHarness(844, 390, 2);
    ui.ctx.fastRaster = false; // 逐像素 ink 记录（真实像素语义）
    driveFrame();
    const texts = badgeTextOps(ui);
    const bgs = badgeBgOps(ui);
    expect(texts.length).toBe(1);
    expect(bgs.length).toBe(1);
    const r = bgs[0];
    const t = texts[0];
    // 深色底中心像素有 ink（非透明、已绘制到 UI 离屏）
    const bgCx = Math.floor((r.devX + r.devW / 2));
    const bgCy = Math.floor((r.devY + r.devH / 2));
    expect(ui.ctx.inkAt(bgCx, bgCy)).toBe(true);
    // 文字区域中心有 ink（fillText 已写像素；白字绘制在深色底之上 → 高对比可检测）
    const tx = Math.floor((t.devX + t.devW / 2));
    const ty = Math.floor((t.devY + t.devH / 2));
    expect(ui.ctx.inkAt(tx, ty)).toBe(true);
  });

  // ============ 9. 普通构建不显示（Must#5）============
  it('9. 普通 build:wechat（未注入 badge）：最终帧无 badge 文本/底', () => {
    // 普通包语义：不调用 setBuildBadge → buildBadge 为空 → drawBuildBadge 恒跳过
    const { ui, driveFrame } = buildHarness(844, 390, 2, false);
    driveFrame(); // boot 帧（未 setBuildBadge）
    expect(badgeTextOps(ui).length).toBe(0);
    expect(badgeBgOps(ui).length).toBe(0);
  });
});
