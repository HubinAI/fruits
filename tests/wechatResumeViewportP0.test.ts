/**
 * F-WX-IOS-RESUME-VIEWPORT-P0｜iOS 切后台返回视口恢复——syncWechatViewport 唯一入口验收。
 *
 * 修改前红测（已在修复前执行，3/3 稳定复现，本文件已转绿）：
 * - R1：show 首次竖屏 transient（window 390×844）→ 旧接线不同步 backing → window 域 ≠ surface 域；
 * - R2：backing 内容被系统清空（尺寸不变）→ 稳态 Home 页 UI 顶栏/底栏不恢复（dirty=false 不重绘）；
 * - R3：screen backing 被系统重置为逻辑尺寸 → surface/Renderer 塌缩到 1/dpr（844→422）。
 *
 * 修复后：所有 onShow/onWindowResize/transient 重试统一走 createViewportSync 的唯一入口
 * syncWechatViewport(reason)（Queue 三节 1~11 步原子序列）。本文件覆盖 Queue 七节 T1~T16。
 *
 * 坐标域标注（playbook 4.2）：window 逻辑 px / canvas backing px / surface logical px。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { bindPlatformCore } from '../src/platform/context';
import { platform } from '../src/platform';
import { WechatViewport } from '../src/platform/wechat/viewport';
import { readWechatWindowInfo } from '../src/platform/wechat/windowInfo';
import { createViewportSync } from '../src/platform/wechat/viewportSync';
import { FakeCanvas } from './wechatCanvasFrameHost';
import { Renderer } from '../src/render/renderer';
import { VisualRegistry } from '../src/render/visualRegistry';
import { SfxAudioService } from '../src/presentation/audioService';
import { createPlayerPresentation } from '../src/presentation/playerPresentation';
import { CanvasPlayerUIHost } from '../src/ui/canvasPlayerUIHost';
import { PlayerGameRuntime } from '../src/game/playerGameRuntime';
import { WechatBattleHost } from '../src/game/wechatBattleHost';
import { SingleLoop } from '../src/platform/wechat/singleLoop';
import { getProgress } from '../src/core/playerProgress';

/** 逻辑舞台 / window 逻辑（固定横屏） */
const LW = 844;
const LH = 390;
/** window→backing 倍率 */
const DPR = 2;

interface Harness {
  windowState: { w: number; h: number; dpr: number; safeArea: Record<string, number> | null };
  screen: FakeCanvas;
  ui: FakeCanvas;
  renderer: Renderer;
  battleHost: WechatBattleHost;
  uiHost: CanvasPlayerUIHost;
  runtime: PlayerGameRuntime;
  loop: SingleLoop;
  sfx: SfxAudioService;
  viewportSync: ReturnType<typeof createViewportSync>;
  visibilityCbs: Array<(hidden: boolean) => void>;
  drive: (dt?: number) => void;
  surfaceLogical: () => { w: number; h: number };
  fakeNow: () => number;
}

function buildHarness(): Harness {
  const windowState = { w: LW, h: LH, dpr: DPR, safeArea: null as Record<string, number> | null };
  const screen = new FakeCanvas({ width: LW * DPR, height: LH * DPR, logicalW: LW, logicalH: LH });
  const ui = new FakeCanvas({ width: LW * DPR, height: LH * DPR, logicalW: LW, logicalH: LH });
  screen.ctx.fastRaster = true;
  ui.ctx.fastRaster = true;
  const info = () => ({
    windowWidth: windowState.w,
    windowHeight: windowState.h,
    screenWidth: Math.round(windowState.w * windowState.dpr),
    screenHeight: Math.round(windowState.h * windowState.dpr),
    pixelRatio: windowState.dpr,
    safeArea: windowState.safeArea ?? { left: 0, top: 0, right: windowState.w, bottom: windowState.h, width: windowState.w, height: windowState.h },
  });
  const fakeWx = {
    getWindowInfo: () => info(),
    getSystemInfoSync: () => info(),
    getMenuButtonBoundingClientRect: () => null,
  };
  (globalThis as any).wx = fakeWx;
  // Q25 匹配随机性：mock Math.random → 对手抽取 / 匹配序列完全确定（同 Build 同条件结果
  // 稳定），T9/T10 驱动到战斗结束的断言不受随机对手时长影响（全套运行时不会因抽到难缠
  // 对手而 900 帧内无法结束）。与项目「禁随机命中/伤害/散布」原则一致——随机只在匹配层。
  if (!vi.isMockFunction(Math.random)) {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  }
  const visibilityCbs: Array<(hidden: boolean) => void> = [];
  let fakeNow = 0;
  const rafCbs: Array<(t: number) => void> = [];
  const core = {
    storage: { getItem: (): string | null => null, setItem: (): void => {}, removeItem: (): void => {} },
    input: { bindPointer: (): (() => void) => () => {} },
    lifecycle: {
      requestAnimationFrame: (cb: (t: number) => void): number => {
        rafCbs.push(cb);
        return rafCbs.length;
      },
      cancelAnimationFrame: (_h: number): void => {},
      now: (): number => fakeNow,
      onVisibilityChange: (cb: (hidden: boolean) => void): void => {
        visibilityCbs.push(cb);
      },
    },
    createViewport: (c: unknown) => new WechatViewport(c as { width: number; height: number }, DPR),
  };
  bindPlatformCore(core as never);

  const surface = platform.createViewport(screen).surface();
  const renderer = new Renderer(screen as unknown as HTMLCanvasElement, new VisualRegistry(), surface);
  const sfx = new SfxAudioService();
  const presentation = createPlayerPresentation(renderer, sfx);
  const battleHost = new WechatBattleHost(renderer, presentation);
  const uiHost = new CanvasPlayerUIHost(ui as unknown as HTMLCanvasElement);
  uiHost.mountCanvas();
  const runtime = new PlayerGameRuntime({ host: uiHost, battle: battleHost, sfx });
  runtime.init();
  const loop = new SingleLoop(
    (cb) => core.lifecycle.requestAnimationFrame(cb),
    (h) => core.lifecycle.cancelAnimationFrame(h),
  );
  // —— 修复：唯一视口同步入口（与 wechat/game.ts 同构接线） ——
  const viewportSync = createViewportSync({
    screenCanvas: screen,
    uiCanvas: ui,
    uiHost,
    runtime,
    loop,
    readWindowInfo: readWechatWindowInfo,
    scheduleRetry: (fn, ms) => setTimeout(fn, ms),
  });
  const drive = (dt = 16.7): void => {
    fakeNow += dt;
    screen.ctx.clearDrawOps();
    ui.ctx.clearDrawOps();
    runtime.tick(fakeNow);
  };
  return {
    windowState,
    screen,
    ui,
    renderer,
    battleHost,
    uiHost,
    runtime,
    loop,
    sfx,
    viewportSync,
    visibilityCbs,
    drive,
    surfaceLogical: () => ({ w: screen.width / DPR, h: screen.height / DPR }),
    fakeNow: () => fakeNow,
  };
}

/** hide 语义（game.ts onVisibilityChange hidden=true 分支）：停循环 + 清交互 */
function hide(h: Harness): void {
  h.loop.stop();
  for (const cb of h.visibilityCbs) cb(true);
}

/** 进入战斗（matching→preview→fighting） */
function enterBattle(h: Harness): void {
  h.runtime.actions.onFindOpponent();
  expect(h.runtime.playerPhase).toBe('matching');
  vi.advanceTimersByTime(1420 + 700 + 600);
  expect(h.runtime.battleState).toBe('fighting');
}

/** 从战斗推进到 ended（确定性对手下战斗时长可复现；上限 1800 帧 ≈ 30s 战斗时间） */
function driveBattleToEnd(h: Harness, maxTicks = 1800): void {
  let guard = 0;
  while (h.runtime.battleState !== 'ended' && guard < maxTicks) {
    h.drive();
    guard++;
  }
  expect(h.runtime.battleState).toBe('ended');
}

afterEach(() => {
  delete (globalThis as any).wx;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('F-WX-IOS-RESUME-VIEWPORT-P0｜syncWechatViewport 唯一入口验收（T1-T16）', () => {
  it('T1. landscape→portrait transient→landscape 最终尺寸正确（竖屏值不污染，横屏恢复后提交）', () => {
    vi.useFakeTimers();
    const h = buildHarness();
    expect(h.surfaceLogical()).toEqual({ w: LW, h: LH }); // boot 稳定横屏

    hide(h);
    h.windowState.w = LH;
    h.windowState.h = LW; // iOS 后台返回竖屏 transient

    const r1 = h.viewportSync.syncWechatViewport('show');
    expect(r1.committed).toBe(false); // 竖屏不提交
    expect(r1.transientPending).toBe(1);

    // 横屏恢复（系统回横屏）
    h.windowState.w = LW;
    h.windowState.h = LH;
    vi.advanceTimersByTime(100); // 触发 show-retry 重试
    h.drive();

    expect(h.screen.width).toBe(LW * DPR); // backing 恢复 1688
    expect(h.surfaceLogical()).toEqual({ w: LW, h: LH }); // surface logical = window logical
  }, 20000);

  it('T2. portrait 临时值不会提交错误 backing（竖屏 390×844 不污染 1688×780）', () => {
    vi.useFakeTimers();
    const h = buildHarness();
    hide(h);
    h.windowState.w = LH;
    h.windowState.h = LW;

    const r = h.viewportSync.syncWechatViewport('show');
    expect(r.committed).toBe(false);

    // 竖屏值绝不被写入 backing（不允许用临时 portrait 尺寸重设游戏 Canvas）
    expect(h.screen.width).toBe(LW * DPR);
    expect(h.screen.height).toBe(LH * DPR);
    expect(h.ui.width).toBe(LW * DPR);
    expect(h.ui.height).toBe(LH * DPR);
    expect(h.surfaceLogical()).toEqual({ w: LW, h: LH });
  }, 20000);

  it('T3. onWindowResize / onShow 两种顺序结果一致（resize 先 vs show 先）', () => {
    vi.useFakeTimers();
    // 顺序 1：show 先（读竖屏不提交）→ resize 后（横屏提交）
    const a = buildHarness();
    hide(a);
    a.windowState.w = LH;
    a.windowState.h = LW;
    a.viewportSync.syncWechatViewport('show'); // 不提交
    a.windowState.w = LW;
    a.windowState.h = LH;
    a.viewportSync.syncWechatViewport('resize'); // 提交
    expect(a.surfaceLogical()).toEqual({ w: LW, h: LH });

    // 顺序 2：resize 先（竖屏不提交）→ show 后（横屏提交）
    const b = buildHarness();
    hide(b);
    b.windowState.w = LH;
    b.windowState.h = LW;
    b.viewportSync.syncWechatViewport('resize'); // 不提交
    b.windowState.w = LW;
    b.windowState.h = LH;
    b.viewportSync.syncWechatViewport('show'); // 提交
    expect(b.surfaceLogical()).toEqual({ w: LW, h: LH });

    // 两顺序最终 backing / surface 完全一致
    expect(a.screen.width).toBe(b.screen.width);
    expect(a.ui.width).toBe(b.ui.width);
    expect(a.surfaceLogical()).toEqual(b.surfaceLogical());
  }, 20000);

  it('T4. 同逻辑尺寸但 Canvas 内容被清空 → sync 强制完整重绘（顶栏/底栏恢复）', () => {
    vi.useFakeTimers();
    const h = buildHarness();
    for (let i = 0; i < 3; i++) h.drive(); // Home 稳态
    expect(h.ui.ctx.inkCount).toBeGreaterThan(0);

    hide(h);
    h.ui.ctx.resetInk(); // 系统清空 uiCanvas 位图内容（尺寸不变）
    h.screen.ctx.resetInk();
    expect(h.ui.ctx.inkCount).toBe(0);

    h.viewportSync.syncWechatViewport('show');
    h.drive(); // 下一帧完整重绘

    expect(h.ui.ctx.inkCount, 'backing 清空后 UI 顶栏/底栏必须重绘恢复（不依赖旧像素残留）').toBeGreaterThan(0);
    expect(h.screen.ctx.inkCount, 'screen 场景层重绘恢复').toBeGreaterThan(0);
  }, 20000);

  it('T5. screenCanvas / uiCanvas / surface logical 三域一致（backing 同源 + logical=window）', () => {
    vi.useFakeTimers();
    const h = buildHarness();
    hide(h);
    const r = h.viewportSync.syncWechatViewport('show');
    expect(r.committed).toBe(true);
    expect(r.backing).toEqual({ w: LW * DPR, h: LH * DPR });
    // 两 Canvas backing 完全一致
    expect(h.screen.width).toBe(h.ui.width);
    expect(h.screen.height).toBe(h.ui.height);
    // surface logical = backing ÷ dpr = window logical
    expect(h.surfaceLogical()).toEqual({ w: h.windowState.w, h: h.windowState.h });
  }, 20000);

  it('T6. current Garage 页面恢复，不经过 Home（playerPhase 保持 garage + Garage UI 重绘）', () => {
    vi.useFakeTimers();
    const h = buildHarness();
    (h.uiHost as any).dispatch('home-garage'); // Home → Garage
    h.drive();
    expect(h.runtime.playerPhase).toBe('garage');

    hide(h);
    h.ui.ctx.resetInk();
    h.viewportSync.syncWechatViewport('show');
    h.drive();

    expect(h.runtime.playerPhase, 'Garage 恢复后不得回到 Home').toBe('garage');
    expect(h.ui.ctx.inkCount, 'Garage 装配台 UI 重绘恢复').toBeGreaterThan(0);
  }, 20000);

  it('T7. Matching 页面恢复（playerPhase 保持 matching + UI 重绘）', () => {
    vi.useFakeTimers();
    const h = buildHarness();
    h.runtime.actions.onFindOpponent();
    vi.advanceTimersByTime(1420 + 700);
    expect(['matching', 'matchPreview']).toContain(h.runtime.playerPhase);

    hide(h);
    h.ui.ctx.resetInk();
    h.screen.ctx.resetInk();
    h.viewportSync.syncWechatViewport('show');
    h.drive();

    expect(['matching', 'matchPreview']).toContain(h.runtime.playerPhase); // 页面保持
    expect(h.ui.ctx.inkCount, 'Matching UI 重绘恢复').toBeGreaterThan(0);
    expect(h.screen.ctx.inkCount, 'Matching 场景层重绘恢复').toBeGreaterThan(0);
  }, 20000);

  it('T8. Battle 同 session 恢复（orchestrator 同一引用 + battleState 保持 fighting）', () => {
    vi.useFakeTimers();
    const h = buildHarness();
    enterBattle(h);
    const orchBefore = h.battleHost.orchestrator;
    expect(orchBefore).toBeTruthy();

    hide(h);
    h.ui.ctx.resetInk();
    h.screen.ctx.resetInk();
    h.viewportSync.syncWechatViewport('show');
    h.drive();

    expect(h.battleHost.orchestrator, 'Battle session 不得重建（同一 orchestrator）').toBe(orchBefore);
    expect(h.runtime.battleState).toBe('fighting'); // 战斗按既有语义继续
    expect(h.screen.ctx.inkCount, 'Battle 场景层重绘恢复').toBeGreaterThan(0);
    expect(h.ui.ctx.inkCount, 'Battle HUD 重绘恢复').toBeGreaterThan(0);
  }, 30000);

  it('T9. Result 奖励不重复（sync 恢复不触发重复结算）', () => {
    vi.useFakeTimers();
    const h = buildHarness();
    enterBattle(h);
    driveBattleToEnd(h);
    expect(h.runtime.battleState).toBe('ended');
    const coinAfter = getProgress().coin;

    hide(h);
    h.ui.ctx.resetInk();
    h.viewportSync.syncWechatViewport('show');
    h.drive();
    h.drive();

    expect(getProgress().coin, '奖励不得重复发放').toBe(coinAfter);
    expect(h.runtime.battleState, 'Result 页保持 ended').toBe('ended');
  }, 40000);

  it('T10. result-adjust 上下文保持（sync 不丢失 garageFromResult 瞬时上下文）', () => {
    vi.useFakeTimers();
    const h = buildHarness();
    enterBattle(h);
    driveBattleToEnd(h);
    h.runtime.actions.onResultAdjust(); // 战败调整 → garage + garageFromResult=true
    h.drive();
    expect((h.uiHost as any).garageFromResult).toBe(true);
    expect(h.runtime.playerPhase).toBe('garage');

    hide(h);
    h.ui.ctx.resetInk();
    h.viewportSync.syncWechatViewport('show');
    h.drive();

    expect((h.uiHost as any).garageFromResult, 'result-adjust 瞬时上下文保持').toBe(true);
    expect(h.runtime.playerPhase).toBe('garage');
  }, 40000);

  it('T11. SingleLoop 至多一个 pending frame（连续 sync 不重复启动 rAF）', () => {
    vi.useFakeTimers();
    const h = buildHarness();
    hide(h);
    h.viewportSync.syncWechatViewport('show');
    h.viewportSync.syncWechatViewport('show'); // 连续 onShow
    h.viewportSync.syncWechatViewport('resize'); // + resize
    expect(h.loop.pendingFrames).toBeLessThanOrEqual(1); // 至多一个待执行帧
  }, 20000);

  it('T12. 音频不重复调度（sync 不新增音源/不新增 pending 计时器）', () => {
    vi.useFakeTimers();
    const h = buildHarness();
    const before = h.sfx.getAudioProbe();
    hide(h);
    h.viewportSync.syncWechatViewport('show');
    h.viewportSync.syncWechatViewport('show');
    const after = h.sfx.getAudioProbe();
    expect(after.activeBgmSources).toBe(before.activeBgmSources); // 不新增循环音源
    expect(after.pendingAudioTimers).toBe(before.pendingAudioTimers); // 不新增音频计时器
  }, 20000);

  it('T13. 连续两次后台恢复无累计缩放（相机 scale 稳定）', () => {
    vi.useFakeTimers();
    const h = buildHarness();
    h.viewportSync.syncWechatViewport('show');
    h.drive();
    const scale1 = (h.renderer as any).transform.scale as number;

    hide(h);
    h.ui.ctx.resetInk();
    h.viewportSync.syncWechatViewport('show');
    h.drive();
    const scale2 = (h.renderer as any).transform.scale as number;

    hide(h);
    h.ui.ctx.resetInk();
    h.viewportSync.syncWechatViewport('show');
    h.drive();
    const scale3 = (h.renderer as any).transform.scale as number;

    expect(scale2).toBeCloseTo(scale1, 4);
    expect(scale3).toBeCloseTo(scale1, 4); // 无累计缩放
  }, 20000);

  it('T14. 刘海左/右 safe area 重算（safeInsets 在 sync 后按新窗口更新）', () => {
    vi.useFakeTimers();
    const h = buildHarness();
    // 横屏刘海在左（iPhone 横屏 safeArea.left=44 logical）
    (globalThis as any).wx.getWindowInfo = () => ({
      windowWidth: LW,
      windowHeight: LH,
      screenWidth: LW * DPR,
      screenHeight: LH * DPR,
      pixelRatio: DPR,
      safeArea: { left: 44, top: 0, right: LW, bottom: LH, width: LW - 44, height: LH },
    });
    h.viewportSync.syncWechatViewport('show');
    h.drive(); // ensureSize 重读 safeInsets
    const insetsAfter = (h.uiHost as any).insets as { left: number; right: number; top: number; bottom: number };
    expect(insetsAfter.left, '刘海左侧内缩应生效').toBeGreaterThanOrEqual(44);
  }, 20000);

  it('T15. 120 帧无尺寸/相机漂移（sync 后 surface 与 camera scale 稳定）', () => {
    vi.useFakeTimers();
    const h = buildHarness();
    hide(h);
    h.viewportSync.syncWechatViewport('show');
    h.drive();
    const s0 = h.surfaceLogical();
    const t0 = (h.renderer as any).transform.scale as number;
    for (let i = 0; i < 120; i++) h.drive();
    expect(h.surfaceLogical()).toEqual(s0); // 尺寸无漂移
    expect((h.renderer as any).transform.scale as number).toBeCloseTo(t0, 4); // 相机无漂移
  }, 30000);

  it('T16. ctx transform 恢复为正确 DPR 单次变换（logical→backing 仅一次缩放）', () => {
    vi.useFakeTimers();
    const h = buildHarness();
    hide(h);
    h.viewportSync.syncWechatViewport('show');
    const st = h.screen.ctx.currentTransform();
    const ut = h.ui.ctx.currentTransform();
    expect(st[0]).toBe(DPR);
    expect(st[3]).toBe(DPR);
    expect(ut[0]).toBe(DPR);
    expect(ut[3]).toBe(DPR);
    // 一帧绘制后仍为 DPR 单次变换（不被 world camera / UI scale 二次污染）
    h.drive();
    const st2 = h.screen.ctx.currentTransform();
    expect(st2[0]).toBe(DPR);
    expect(st2[3]).toBe(DPR);
  }, 20000);

  // —— F-WX-RESUME-RENDER-STATE-P0｜recovery guarantee / failure tolerance（T-VP-1/2/3）——
  // 修复前红（syncWechatViewport 序列 resetBacking→doResize→forceRedraw→loop.start 无 try/finally：
  // doResize 抛错则 forceRedraw/loop.start 跳过 → loop 停摆 + 画面冻结/跨页泄漏）；修复后绿。

  it('T-VP-1. resume 恢复保证：hide→show 后 loop 重启 + dirty 置位 + 当前页重绘', () => {
    vi.useFakeTimers();
    const h = buildHarness();
    for (let i = 0; i < 2; i++) h.drive(); // Home 稳态
    expect(h.loop.isRunning).toBe(true);

    hide(h);
    expect(h.loop.isRunning, 'hide 必须停循环').toBe(false);

    h.viewportSync.syncWechatViewport('show');
    expect(h.loop.isRunning, 'show 后循环必须重启（否则画面冻结/跨页泄漏）').toBe(true);
    expect((h.uiHost as any).dirty, 'show 后必须强制整页重绘（dirty=true）').toBe(true);

    h.ui.ctx.resetInk();
    h.drive(); // 等价 loop 重启后排的下一帧
    expect(h.ui.ctx.inkCount, 'resume 后 Home UI 必须重绘').toBeGreaterThan(0);
  }, 20000);

  it('T-VP-2. resume 失败容错（leak 防护）：doResize 抛错仍恢复 loop + dirty', () => {
    vi.useFakeTimers();
    const h = buildHarness();
    for (let i = 0; i < 2; i++) h.drive();
    hide(h);
    expect(h.loop.isRunning).toBe(false);

    const spy = vi.spyOn(h.runtime, 'doResize').mockImplementation(() => {
      throw new Error('simulated runtime.doResize failure');
    });

    // 修复前：doResize 抛错跳过 forceRedraw/loop.start → 调用抛错 / loop 不重启（红）。
    // 修复后：try/finally 保证恢复动作执行 → 调用不抛错 + loop 重启 + dirty 置位（绿）。
    expect(() => h.viewportSync.syncWechatViewport('show'), 'doResize 失败不得让 sync 抛错中断恢复').not.toThrow();
    expect(h.loop.isRunning, 'doResize 抛错后 loop 仍必须重启（防冻结/跨页泄漏）').toBe(true);
    expect((h.uiHost as any).dirty, 'doResize 抛错后 dirty 仍必须置位').toBe(true);
    spy.mockRestore();
  }, 20000);

  it('T-VP-3. resume 后输入链存活：doResize 抛错后 hitAreas 仍按当前页重建', () => {
    vi.useFakeTimers();
    const h = buildHarness();
    (h.uiHost as any).dispatch('home-garage'); // 进入 Garage
    h.drive();
    expect(h.runtime.playerPhase).toBe('garage');
    hide(h);
    expect(h.loop.isRunning).toBe(false);

    const spy = vi.spyOn(h.runtime, 'doResize').mockImplementation(() => {
      throw new Error('simulated runtime.doResize failure');
    });

    expect(() => h.viewportSync.syncWechatViewport('show')).not.toThrow();
    expect(h.loop.isRunning, 'loop 重启后下一帧会重建 hitAreas').toBe(true);

    h.ui.ctx.resetInk();
    h.drive(); // 等价 loop 排的下一帧：draw() 以当前 metaPage 重建 hitAreas
    const hitAreas = (h.uiHost as any).hitAreas as Array<{ id: string }>;
    expect(hitAreas.length, 'resume 后 hitAreas 必须按当前页重建（输入链存活）').toBeGreaterThan(0);
    expect(hitAreas.some((a) => a.id === 'nav:backpack'), 'Garage 页 hitArea 含顶栏按钮').toBe(true);
    spy.mockRestore();
  }, 20000);
});
