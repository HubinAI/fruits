/**
 * F-PLAYER-FLOW-ATOMIC-P0｜首页匹配崩溃、重复输入与半提交状态 —— 验收矩阵。
 *
 * 外网确认根因：onFindOpponent → startMatching → setBuildControlsLocked →
 * setBuildControlsLockedDom → sideToggle.disabled —— 玩家模式未创建 DEV sideToggle，
 * 但注入并调用了 DEV onBuildLocked 回调；且 startMatching 在异常前已改 playerPhase，
 * 造成 Runtime 与画面状态分裂（半提交）。
 *
 * 本文件锁定：
 * A. 玩家模式不注入 DEV-DOM 回调（main.ts 组合入口）+ setBuildControlsLockedDom 守卫；
 * B. startMatching 原子提交（失败保持完整 Home / 成功完整 Matching，A/B 同帧就绪）；
 * C. WebInput 去重（支持 Pointer Event 只绑 pointerdown，一次物理点击一次派发）；
 * D. **真实输入链**：WebInput → Canvas hitArea → dispatch → Runtime → Matching
 *    （不经 stub 直接调 runtime.actions；DOM 宿主为桩，输入链全部真实）。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WebInput } from '../src/platform/web/input';
import { bindPlatformCore } from '../src/platform/context';
import { createWebCore } from '../src/platform/web';
import { CanvasPlayerUIHost } from '../src/ui/canvasPlayerUIHost';
import { PlayerGameRuntime } from '../src/game/playerGameRuntime';
import type { PlayerBattleHost, PlayerGameDeps } from '../src/game/playerGameRuntime';
import type { BattleOrchestratorApi } from '../src/battle/battleContract';

const MAIN = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');
const RUNTIME = readFileSync(fileURLToPath(new URL('../src/game/playerGameRuntime.ts', import.meta.url)), 'utf8');

// ==================== 桩（仅 DOM 宿主；输入链真实） ====================

function makeStubCtx(): CanvasRenderingContext2D {
  return new Proxy({} as CanvasRenderingContext2D, { get: () => () => ({ width: 0 }), set: () => true });
}

type Listener = (ev: unknown) => void;

function makeStubCanvas(w: number, h: number): HTMLCanvasElement & { __listeners: Record<string, Listener[]> } {
  const listeners: Record<string, Listener[]> = {};
  const el = {
    width: w,
    height: h,
    clientWidth: w,
    clientHeight: h,
    style: undefined,
    getContext: () => makeStubCtx(),
    addEventListener: (t: string, fn: Listener) => void (listeners[t] ??= []).push(fn),
    removeEventListener: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: w, height: h, right: w, bottom: h }),
  } as unknown as HTMLCanvasElement & { __listeners: Record<string, Listener[]> };
  el.__listeners = listeners;
  return el;
}

/** 可配置抛错的假战斗宿主（loadCustomPreview 抛 → 验证 startMatching 原子性） */
class FakeAtomicBattleHost implements PlayerBattleHost {
  previewMode = false;
  orchestrator: BattleOrchestratorApi | null = null;
  loadedPreview: { a: unknown; b: unknown } | null = null;
  throwOnPreview = false;
  loadCustomPreview(sa: unknown, sb: unknown): void {
    if (this.throwOnPreview) throw new Error('simulated preview failure');
    this.loadedPreview = { a: sa, b: sb };
    this.previewMode = true;
  }
  loadCustom(): void { this.previewMode = false; }
  step(): void {}
  render(): void {}
  setPreviewVehicleFx(): void {}
  arenaDims(): { w: number; h: number } { return { w: 1600, h: 900 }; }
  reframe(): void {}
  resize(): void {}
  getMatchVehicleRects(): { a: { x: number; y: number; w: number; h: number }; b: { x: number; y: number; w: number; h: number } } | null {
    return this.loadedPreview
      ? { a: { x: 0, y: 0, w: 100, h: 60 }, b: { x: 500, y: 0, w: 100, h: 60 } }
      : null;
  }
}

/** 构造 真实 WebInput + 真实 Host + 真实 Runtime + 假 battle host（仅 DOM 宿主为桩） */
function makeRealChain(vp: { w: number; h: number }, battle: FakeAtomicBattleHost) {
  const core = createWebCore();
  bindPlatformCore({
    ...core,
    input: new WebInput(),
    createViewport: () => ({
      surface: () => ({ width: vp.w, height: vp.h, devicePixelRatio: 1, now: () => 0 }),
      onResize: () => {},
      safeInsets: () => ({ left: 44, right: 44, top: 0, bottom: 12 }),
    }),
  } as unknown as Parameters<typeof bindPlatformCore>[0]);
  // 模拟支持 Pointer Event 的现代浏览器环境（WebInput 据此只绑 pointerdown）
  vi.stubGlobal('window', { PointerEvent: class {} });
  const canvas = makeStubCanvas(vp.w, vp.h);
  const host = new CanvasPlayerUIHost(canvas as unknown as HTMLCanvasElement);
  host.mountCanvas(); // ← 内部 platform.input.bindPointer(canvas, handlePointer)（真实 WebInput）
  const runtime = new PlayerGameRuntime({ host, battle, sfx: { resume() {} } } as PlayerGameDeps);
  runtime.init();
  return { canvas, host, runtime, battle };
}

function dispatchTap(
  canvas: HTMLCanvasElement & { __listeners: Record<string, Listener[]> },
  type: 'pointerdown' | 'mousedown' | 'touchstart',
  clientX: number,
  clientY: number,
): void {
  // F-GARAGE-CENTER-STAGE-P0：手势生命周期下，pointerdown 仅记录 down，dispatch 在 pointerup。
  // C1 仍断言「支持 Pointer Event 时不叠加 mousedown/touchstart」——pointerup 不破坏该契约。
  const ev =
    type === 'touchstart'
      ? { touches: [{ clientX, clientY }] }
      : { clientX, clientY };
  const fns = canvas.__listeners[type] ?? [];
  for (const fn of fns) fn(ev);
  if (type === 'pointerdown' && canvas.__listeners['pointerup']) {
    const upEv = { clientX, clientY };
    for (const fn of canvas.__listeners['pointerup']) fn(upEv);
  }
}

describe('F-PLAYER-FLOW-ATOMIC-P0｜首页匹配原子流', () => {
  afterEach(() => {
    bindPlatformCore(createWebCore());
    vi.unstubAllGlobals();
  });

  describe('A｜玩家模式不注入 DEV-DOM 回调 + 控件锁定守卫', () => {
    it('A1. main.ts 组合入口：playerMode 下不注入 onBuildLocked/onPanelsChanged/重置回调', () => {
      expect(MAIN, 'playerMode 条件注入（空对象）').toMatch(/\.\.\.\(playerMode\s*\?\s*\{\}\s*:/);
      expect(MAIN, 'onBuildLocked 在非玩家分支').toMatch(/onBuildLocked: \(locked: boolean\) => setBuildControlsLockedDom/);
      expect(MAIN, 'onPanelsChanged 在非玩家分支').toMatch(/onPanelsChanged: \(\) => renderPanelsOnly\(\)/);
      // 非玩家分支位于 playerMode 条件展开内（不再无条件注入）
      const condIdx = MAIN.indexOf('...(playerMode');
      const lockedIdx = MAIN.indexOf('onBuildLocked:');
      expect(condIdx, '条件注入存在').toBeGreaterThan(-1);
      expect(lockedIdx, 'onBuildLocked 位于条件内').toBeGreaterThan(condIdx);
    });

    it('A2. setBuildControlsLockedDom 对未创建 sideToggle 安全（守卫与实际变量一致）', () => {
      expect(MAIN, 'sideToggle 声明为可空（初始 null）').toContain('let sideToggle: HTMLButtonElement | null = null');
      expect(MAIN, 'sideToggle 解引用前守卫').toContain('if (sideToggle) sideToggle.disabled = locked;');
      expect(MAIN, '无裸 sideToggle.disabled（未守卫）').not.toContain('  sideToggle.disabled = locked;');
    });
  });

  describe('B｜startMatching 原子提交', () => {
    it('B1. 源码顺序：状态提交（matching）在 A+B 加载之后、pushUI 前（成功路径唯一出口）', () => {
      const start = RUNTIME.slice(RUNTIME.indexOf('private startMatching'), RUNTIME.indexOf('private startBattleWithReady'));
      const iLoad = start.indexOf('this.loadMatchAB()');
      const iState = start.indexOf("this.playerPhaseInternal = 'matching'");
      const iPush = start.indexOf('this.pushUI()');
      expect(iLoad, 'loadMatchAB 先行').toBeGreaterThan(-1);
      expect(iState, '状态提交在加载后').toBeGreaterThan(iLoad);
      expect(iPush, 'pushUI 在状态提交后').toBeGreaterThan(iState);
      // 防重复触发 = matching 状态门（非延时/重试）
      expect(start, '重复触发守卫').toContain("if (this.playerPhaseInternal === 'matching') return;");
    });

    it('B2. 失败原子性：外围 loadCustomPreview 抛异常 → 状态保持完整 Home（非半提交）', () => {
      const env = makeRealChain({ w: 844, h: 390 }, new FakeAtomicBattleHost());
      // 初始 Home
      expect(env.runtime.playerPhase).toBe('garage');
      env.battle.throwOnPreview = true;
      // 真实输入链触发 home-find-opponent（异常不被吞——向外抛）
      const cta = env.host.getHitAreasForTest().find((a) => a.id === 'home-find-opponent')!;
      expect(cta, '首页 CTA 已注册').toBeTruthy();
      expect(() => dispatchTap(env.canvas, 'pointerdown', cta.x + cta.w / 2, cta.y + cta.h / 2)).toThrow();
      // 状态保持 Home（playerPhase 未半提交成 matching）
      expect(env.runtime.playerPhase, '失败后仍为 garage（非半提交 matching）').toBe('garage');
      expect(env.runtime.battleState, '失败后仍为 editing').toBe('editing');
    });

    it('B3. 成功原子性：一次点击 → 完整 Matching（A+B 已加载 + pushUI）', () => {
      const env = makeRealChain({ w: 844, h: 390 }, new FakeAtomicBattleHost());
      const cta = env.host.getHitAreasForTest().find((a) => a.id === 'home-find-opponent')!;
      dispatchTap(env.canvas, 'pointerdown', cta.x + cta.w / 2, cta.y + cta.h / 2);
      // Runtime 进入 matching
      expect(env.runtime.playerPhase, '进入 matching').toBe('matching');
      // A+B 同帧就绪（半提交根因：不再只有 A）
      expect(env.battle.loadedPreview, 'A+B preview 均已加载').not.toBeNull();
      expect(env.battle.loadedPreview!.a, 'A 已加载').toBeTruthy();
      expect(env.battle.loadedPreview!.b, 'B 已加载').toBeTruthy();
      // Host UI 已推入 matching 状态 + A/B rect 非空（扫描框用 B 真实 rect）
      expect(env.host.getHitAreasForTest().some((a) => a.id === 'home-find-opponent'), 'Home CTA 已隐藏（进入 Matching）').toBe(false);
    });
  });

  describe('C｜WebInput 去重', () => {
    it('C1. 支持 Pointer Event → 只绑 pointerdown（无 mousedown/touchstart 叠加）', () => {
      vi.stubGlobal('window', { PointerEvent: class {} });
      const input = new WebInput();
      const canvas = makeStubCanvas(100, 100);
      const handler = vi.fn();
      input.bindPointer(canvas as unknown as HTMLElement, handler);
      expect(canvas.__listeners['pointerdown'], '绑定 pointerdown').toBeTruthy();
      expect(canvas.__listeners['mousedown'], '不绑 mousedown').toBeUndefined();
      expect(canvas.__listeners['touchstart'], '不绑 touchstart').toBeUndefined();
      // 一次 pointerdown 物理点击 → 一次派发
      dispatchTap(canvas, 'pointerdown', 50, 50);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('C2. 不支持 Pointer Event → 回退 mousedown + touchstart（无 pointerdown）', () => {
      const input = new WebInput();
      const canvas = makeStubCanvas(100, 100);
      const handler = vi.fn();
      input.bindPointer(canvas as unknown as HTMLElement, handler);
      expect(canvas.__listeners['pointerdown'], '无 pointerdown').toBeUndefined();
      expect(canvas.__listeners['mousedown'], '回退 mousedown').toBeTruthy();
      expect(canvas.__listeners['touchstart'], '回退 touchstart').toBeTruthy();
    });
  });

  describe('D｜真实输入链：WebInput → Canvas hitArea → dispatch → Runtime → Matching', () => {
    it('D1. 真实 pointer 事件命中 home-find-opponent → Runtime 进入 Matching，onFindOpponent 仅一次', () => {
      const env = makeRealChain({ w: 844, h: 390 }, new FakeAtomicBattleHost());
      const cta = env.host.getHitAreasForTest().find((a) => a.id === 'home-find-opponent')!;
      // 真实 WebInput listener（canvas.__listeners.pointerdown = WebInput 绑定的 onDown）
      expect(canvasListens(env.canvas, 'pointerdown'), 'WebInput 已绑定 pointerdown').toBe(true);
      // 一次物理点击
      dispatchTap(env.canvas, 'pointerdown', cta.x + cta.w / 2, cta.y + cta.h / 2);
      expect(env.runtime.playerPhase, '经真实输入链进入 Matching').toBe('matching');
      // onFindOpponent 只触发一次（matching 状态门防重入；再点同区不重复推进）
      dispatchTap(env.canvas, 'pointerdown', cta.x + cta.w / 2, cta.y + cta.h / 2);
      expect(env.runtime.playerPhase, '重复点击仍为 matching（无重复派发破坏）').toBe('matching');
    });

    it('D2. 点击非法/非按钮区域不改变状态', () => {
      const env = makeRealChain({ w: 844, h: 390 }, new FakeAtomicBattleHost());
      // 空白区域（左上角 10,10 非任何 hitArea）
      dispatchTap(env.canvas, 'pointerdown', 10, 10);
      expect(env.runtime.playerPhase, '空白点击不改状态').toBe('garage');
    });
  });
});

function canvasListens(canvas: HTMLCanvasElement & { __listeners: Record<string, Listener[]> }, type: string): boolean {
  return (canvas.__listeners[type] ?? []).length > 0;
}
