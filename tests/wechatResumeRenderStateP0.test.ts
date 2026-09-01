/**
 * F-WX-RESUME-RENDER-STATE-P0｜6 类确定性生命周期测试（复现 + 验收）。
 *
 * 复现链（Must#1）：Battle Closing → Result → Home → wx.onHide → wx.onShow → Garage
 * 逐节点实证 Renderer/UI 最终合成状态，定位首次出现旧 Battle 状态的位置。
 *
 * 用真实 PlayerGameRuntime + WechatBattleHost + Renderer + CanvasPlayerUIHost，
 * 配合 wechatCanvasFrameHost 的 FakeCanvas（颜色记录 drawOps，fastRaster 只记 bbox + fillStyle），
 * 不拉入 Web DOM / 微信运行时。surface.now 受控（fakeNow）以驱动 FX TTL / 阶段。
 *
 * 关于 onHide/onShow：Queue 明示「模拟 onHide/onShow 无法沙箱完整执行」。wechat/game.ts 的
 * onShow 直接调用 runtime.reframePlayerCamera()（按当前页重取景），本测试以该机制作为 onShow 代理，
 * 并在报告中明示真机 onShow 接线（game.ts:324-328）限制。SingleLoop 幂等（类别4）直接单测。
 */
import { describe, it, expect, vi } from 'vitest';
import { bindPlatformCore } from '../src/platform/context';
import { FakeCanvas } from './wechatCanvasFrameHost';
import { Renderer } from '../src/render/renderer';
import { VisualRegistry } from '../src/render/visualRegistry';
import { SfxAudioService } from '../src/presentation/audioService';
import { createPlayerPresentation } from '../src/presentation/playerPresentation';
import { CanvasPlayerUIHost } from '../src/ui/canvasPlayerUIHost';
import { PlayerGameRuntime } from '../src/game/playerGameRuntime';
import { WechatBattleHost } from '../src/game/wechatBattleHost';
import { SingleLoop } from '../src/platform/wechat/singleLoop';
import { getInventory } from '../src/core/partInventory';

const LOGICAL_W = 844;
const LOGICAL_H = 390;
const DPR = 2;

let fakeNow = 0;

function makeSurface() {
  return {
    width: LOGICAL_W,
    height: LOGICAL_H,
    devicePixelRatio: DPR,
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
      safeInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
      applyTo: (_c: unknown) => {},
      clientToLogical: (cx: number, cy: number) => ({ x: cx, y: cy }),
    }),
  };
  bindPlatformCore(core as unknown as Parameters<typeof bindPlatformCore>[0]);
  return { store, visibilityCbs };
}

function snapshotColors(screen: FakeCanvas, ui: FakeCanvas) {
  const sc = screen.ctx.drawOps.filter((o) => o.type !== 'clear' && o.type !== 'image');
  const uc = ui.ctx.drawOps.filter((o) => o.type !== 'clear' && o.type !== 'image');
  return {
    screen: sc.map((o) => o.fillStyle ?? o.text ?? '').filter(Boolean),
    ui: uc.map((o) => o.fillStyle ?? o.text ?? '').filter(Boolean),
  };
}

/** 检测 Renderer 屏幕层是否含有 Battle Closing 墙色（红墙带 / 灰红墙体）。 */
function hasClosingWallColor(colors: string[]): boolean {
  return colors.some((c) => c === '#7a2f2f' || c === '#c0403a' || c === '#ff8a70');
}

/** 首页车辆居偏（union bbox 中心 vs home framing 中心）。 */
function measureHomeOffsetAndScale(screen: FakeCanvas, ui: FakeCanvas, uiHost: CanvasPlayerUIHost) {
  void ui;
  const ops = screen.ctx.drawOps.filter((o) => o.type === 'path' && o.fillStyle === '#4aa3ff');
  let cx = -1;
  if (ops.length) {
    const minX = Math.min(...ops.map((o) => o.devX));
    const maxX = Math.max(...ops.map((o) => o.devX + o.devW));
    cx = (minX + maxX) / 2;
  }
  const fr = (uiHost as any).getPreviewFramingRect?.() as { x: number; y: number; w: number; h: number } | null;
  const center = fr ? (fr.x + fr.w / 2) : LOGICAL_W / 2;
  const off = cx >= 0 ? Math.abs(cx / DPR - center) / LOGICAL_W : 999;
  return { off };
}

function buildHarness() {
  fakeNow = 0;
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0.42); // 固定对手，确定性
  const surface = makeSurface();
  const { store, visibilityCbs } = bindFakeCore(surface);
  const screen = new FakeCanvas({ width: LOGICAL_W * DPR, height: LOGICAL_H * DPR, logicalW: LOGICAL_W, logicalH: LOGICAL_H });
  const ui = new FakeCanvas({ width: LOGICAL_W * DPR, height: LOGICAL_H * DPR, logicalW: LOGICAL_W, logicalH: LOGICAL_H });
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
  const driveFrame = (dt = 16.7) => {
    fakeNow += dt;
    screen.ctx.clearDrawOps();
    ui.ctx.clearDrawOps();
    runtime.tick(fakeNow);
  };
  return { surface, store, visibilityCbs, screen, ui, renderer, sfx, battleHost, uiHost, runtime, driveFrame };
}

/** 进入战斗并推进到指定 phase（或 ended），返回是否到达 targetPhase。 */
function driveBattleTo(runtime: PlayerGameRuntime, driveFrame: (dt?: number) => void, battleHost: WechatBattleHost, targetPhase: string, maxTicks = 1500) {
  runtime.actions.onFindOpponent();
  expect(runtime.playerPhase).toBe('matching');
  vi.advanceTimersByTime(1420 + 700 + 600);
  expect(runtime.battleState).toBe('fighting');
  let reached = false;
  let ticks = 0;
  while (ticks < maxTicks) {
    driveFrame();
    ticks++;
    const phase = (battleHost.orchestrator as unknown as { phase: string })?.phase ?? '';
    if (phase === targetPhase) {
      reached = true;
      break;
    }
    if (runtime.battleState === 'ended') break;
  }
  return reached;
}

// maxTicks 为防御性 guard（防死循环），非性能断言。R1 对手池 36→49 后固定抽取
// 0.42 命中需要 ~968 帧 KO 的 heavyBox/tallBody 战斗（旧池最短 789 帧），900 帧预算不足，
// 放大到 1200 帧（覆盖最坏 968 + 24% 余量）——合法战斗必须放行，预算只是防挂死。
function driveBattleToEnd(runtime: PlayerGameRuntime, driveFrame: (dt?: number) => void, maxTicks = 1200) {
  let guard = 0;
  while (runtime.battleState !== 'ended' && guard < maxTicks) {
    driveFrame();
    guard++;
  }
  expect(runtime.battleState).toBe('ended');
}

describe('F-WX-RESUME-RENDER-STATE-P0｜6 类确定性生命周期', () => {
  // ============ C1：主复现链（Must#1/#2/#3/#4/#6）============
  it('C1. Closing→Result→Home→hide→show→Garage 无旧 Battle 状态（墙/泄漏/transform 居中）', () => {
    const { screen, ui, renderer, uiHost, runtime, battleHost, visibilityCbs, driveFrame } = buildHarness();

    // 全新 boot 首页基线（判定「战斗→首页」是否泄漏旧 battle transform）
    driveFrame();
    const freshHome = measureHomeOffsetAndScale(screen, ui, uiHost);
    const freshHomeScale = (renderer as any).transform.scale as number;

    const reachedClosing = driveBattleTo(runtime, driveFrame, battleHost, 'Closing');
    // 战斗中帧应含 Closing 墙色（健全性：确认本测试能观测到墙）
    expect(hasClosingWallColor(snapshotColors(screen, ui).screen)).toBe(true);

    driveBattleToEnd(runtime, driveFrame);

    // 节点 A：Result
    const rBattleBackdropA = (renderer as any).battleBackdrop as boolean;
    expect(rBattleBackdropA).toBe(true); // 战斗语境 backdrop 仍开

    // Result → Garage 中央装配舞台（F-LOSS-ADJUST-REMATCH-LOOP-P0｜Must#4：战败「调整配置」
    // 直接进入装配台，metaPage 由 host render 状态转换切入 garage——不再停在首页态）
    runtime.actions.onResultAdjust();
    expect(runtime.playerPhase).toBe('garage');
    expect(runtime.battleState).toBe('editing');
    driveFrame();

    // 节点 B：Garage 装配台（新语义；旧语义为 Home 首页态）
    const homeSnap = snapshotColors(screen, ui);
    const rBattleBackdropB = (renderer as any).battleBackdrop as boolean;
    const rGarageBackdropB = (renderer as any).garageBackdrop as boolean;

    // hide → show（Garage 态；渲染状态不得泄漏）
    for (const cb of visibilityCbs) cb(true);
    driveFrame();
    for (const cb of visibilityCbs) cb(false);
    driveFrame();

    // 节点 C：onShow 后仍 Garage 装配台（无旧 Battle 状态）
    const showSnap = snapshotColors(screen, ui);

    // Garage → Home（真实 host dispatch 路径；F-LOSS-ADJUST-REMATCH-LOOP-P0 后回首页需显式 nav）
    (uiHost as any).dispatch('nav:home');
    driveFrame();
    const rTransformB = (renderer as any).transform as { scale: number; offsetX: number; offsetY: number };
    const rHomeBackdropB = (renderer as any).homeBackdrop as boolean;
    const homeOffsetPct = measureHomeOffsetAndScale(screen, ui, uiHost).off;
    const homeSnap2 = snapshotColors(screen, ui);

    // Home → Garage（真实 host dispatch 路径）
    (uiHost as any).dispatch('home-garage');
    driveFrame();

    // 节点 D：Garage
    const garageSnap = snapshotColors(screen, ui);
    const rBattleBackdropD = (renderer as any).battleBackdrop as boolean;
    const rGarageBackdropD = (renderer as any).garageBackdrop as boolean;

    // ---- 验收 ----
    expect(hasClosingWallColor(homeSnap.screen)).toBe(false); // Result→Garage 无红墙
    expect(hasClosingWallColor(showSnap.screen)).toBe(false); // onShow 后无红墙
    expect(hasClosingWallColor(garageSnap.screen)).toBe(false); // Garage 无红墙（Fix A+B）
    expect(hasClosingWallColor(homeSnap2.screen)).toBe(false); // 回首页无红墙
    // 首页居偏 vs 全新 boot 基线（差值 ≤2% → 非泄漏；7% 为 home 相机稳态取景，frozen 首页不动）
    expect(Math.abs(homeOffsetPct - freshHome.off)).toBeLessThanOrEqual(0.02);
    // 首页相机确已应用（re-reframe 生效）：scale 与 boot 首页一致且非 battle 相机
    expect(rTransformB.scale).toBeCloseTo(freshHomeScale, 1);
    expect(rTransformB.scale).toBeGreaterThan(1.0);
    // backdrop 原子翻转
    expect(rBattleBackdropB).toBe(false);
    expect(rBattleBackdropD).toBe(false);
    expect(rHomeBackdropB).toBe(true); // 显式 nav:home 后回首页
    expect(rGarageBackdropB).toBe(true); // F-LOSS-ADJUST-REMATCH-LOOP-P0：Result→装配台即 garageBackdrop
    expect(rGarageBackdropD).toBe(true); // Fix A：garageBackdrop 已接通
    // 战斗表现 FX 已清理（Must#4）
    expect((renderer as any).fx.length).toBe(0);
    expect((renderer as any).hitFlashes.length).toBe(0);
    expect((renderer as any).deathFxs.length).toBe(0);
    // eslint-disable-next-line no-console
    console.log('[TRACE C1] reachedClosing=', reachedClosing, 'freshHome.off=', freshHome.off.toFixed(3));
  });

  // ============ C2：离开战斗后战斗表现 FX 原子清理（Must#4）============
  it('C2. Battle→Result→Home：伤害数字/hit flash/死亡环等战斗 FX 已原子清理', () => {
    const { renderer, runtime, battleHost, driveFrame } = buildHarness();
    driveBattleTo(runtime, driveFrame, battleHost, 'Active');
    // 战斗过程中人为注入 FX（确定性，证明清理路径真的清了它们）
    (renderer as any).fx.push({ x: 600, y: 300, text: '-10', color: '#fff', bornAt: fakeNow, ttl: 800, size: 20 });
    (renderer as any).hitFlashes.push({ team: 'A', bornAt: fakeNow, ttl: 120 });
    (renderer as any).deathFxs.push({ team: 'A', bornAt: fakeNow, ttl: 500 });
    expect((renderer as any).fx.length).toBeGreaterThan(0);

    driveBattleToEnd(runtime, driveFrame);
    runtime.actions.onResultAdjust(); // → adjustConfig → clearBattleFx
    driveFrame();

    // 离开战斗后 FX 数组必须为空（原子清理，不残留到 Home/Garage）
    expect((renderer as any).fx.length).toBe(0);
    expect((renderer as any).hitFlashes.length).toBe(0);
    expect((renderer as any).deathFxs.length).toBe(0);
    expect((renderer as any).sparks.length).toBe(0);
    expect((renderer as any).muzzleFlashes.length).toBe(0);
    expect((renderer as any).charges.length).toBe(0);
    expect((renderer as any).laserBeams.length).toBe(0);
    expect((renderer as any).shotgunFans.length).toBe(0);
    expect((renderer as any).muzzleTongues.length).toBe(0);
  });

  // ============ C3：Matching（prebattle）页面无 battle 墙/HUD；onShow 后 prebattle 构图保持 =====
  it('C3. Matching(prebattle) 页面无 Battle 墙/HUD；onShow 后 prebattle 构图保持', () => {
    const { screen, ui, renderer, runtime, visibilityCbs, driveFrame } = buildHarness();
    runtime.actions.onFindOpponent();
    vi.advanceTimersByTime(1420 + 700);
    expect(['matching', 'matchPreview']).toContain(runtime.playerPhase); // 搜索→锁定（prebattle 覆盖两者）
    driveFrame();

    const matchingSnap = snapshotColors(screen, ui);
    const rPrebattleB = (renderer as any).prebattleBackdrop as boolean;
    const rBattleB = (renderer as any).battleBackdrop as boolean;
    expect(rPrebattleB).toBe(true); // prebattle 背景开
    expect(rBattleB).toBe(false);
    expect(hasClosingWallColor(matchingSnap.screen)).toBe(false); // 匹配页无 battle 红墙

    // hide → show（onShow 按当前页 re-reframe；此处当前页=matching→prebattle 构图保持）
    for (const cb of visibilityCbs) cb(true);
    driveFrame();
    for (const cb of visibilityCbs) cb(false);
    driveFrame();
    const rPrebattleAfter = (renderer as any).prebattleBackdrop as boolean;
    expect(rPrebattleAfter).toBe(true); // onShow 后仍为 prebattle 构图（未跳变到 battle/home）
    expect(hasClosingWallColor(snapshotColors(screen, ui).screen)).toBe(false);
  });

  // ============ C4：连续 onShow×3 → SingleLoop 唯一（pendingFrames≤1），无双循环 =====
  it('C4. 连续 onShow×3 → SingleLoop 仍唯一（pendingFrames≤1，幂等）', () => {
    // raf 仅登记不立即执行 step（避免递归续帧干扰计数）；caf 空操作
    const loop = new SingleLoop((_cb) => 1, (_h) => {});
    loop.start();
    // 连续 3 次 request（等价 3 次 onShow 触发 loop.request）
    loop.request();
    loop.request();
    loop.request();
    expect(loop.pendingFrames).toBe(1); // 待执行帧至多 1，无双循环/重复帧
    loop.stop();
    expect(loop.pendingFrames).toBe(0);
  });

  // ============ C5：battle→home→garage 后 Build/装备/库存/能量/存档不变（Must#5）============
  it('C5. Battle→Result→Home→Garage：BuildDraft（装备 Build）不变、库存未被清空', () => {
    const { screen, ui, renderer, uiHost, runtime, battleHost, driveFrame } = buildHarness();
    // 已装备 Build（draftA）是唯一「玩家装配」真相源；战斗奖励只入库存、不改动 draftA
    const beforeDraft = JSON.stringify((runtime as any).draftA);
    const beforeInvLen = Object.keys(getInventory()).length;

    driveBattleTo(runtime, driveFrame, battleHost, 'Active');
    driveBattleToEnd(runtime, driveFrame);
    runtime.actions.onResultAdjust();
    (uiHost as any).dispatch('home-garage');
    driveFrame();

    const afterDraft = JSON.stringify((runtime as any).draftA);
    const afterInvLen = Object.keys(getInventory()).length;
    expect(afterDraft).toBe(beforeDraft); // 装备 Build 不变（未重置/未丢失）
    expect(afterInvLen).toBeGreaterThanOrEqual(beforeInvLen); // 库存未被清空/丢失（奖励合法增加）
    void screen; void ui; void renderer;
  });

  // ============ C6：onShow 按当前页 re-reframe（hide 时 battle 相机 → show 后 home 构图）=====
  it('C6. onShow 代理：hide 时 stale battle 相机 → show 后按当前页(home) 重取景', () => {
    const { screen, ui, renderer, uiHost, runtime, battleHost, driveFrame } = buildHarness();
    driveBattleTo(runtime, driveFrame, battleHost, 'Active');
    driveBattleToEnd(runtime, driveFrame);
    runtime.actions.onResultAdjust(); // → home（transform=home）
    driveFrame();
    const homeScale = (renderer as any).transform.scale as number;
    expect(homeScale).toBeGreaterThan(1.0); // 已是 home 相机

    // 模拟 hide 期间残留 stale battle 相机（scale≈0.84）
    (renderer as any).transform = { scale: 0.84, offsetX: 232, offsetY: -323 };

    // onShow 代理：game.ts onShow 直接调用 runtime.reframePlayerCamera()（按当前页重取景）
    runtime.reframePlayerCamera();
    driveFrame();

    const afterScale = (renderer as any).transform.scale as number;
    expect(afterScale).toBeCloseTo(homeScale, 1); // 已重取景为 home（非 stale battle 0.84）
    expect(afterScale).toBeGreaterThan(1.0);
    expect(hasClosingWallColor(snapshotColors(screen, ui).screen)).toBe(false);
    void uiHost;
  });
});
