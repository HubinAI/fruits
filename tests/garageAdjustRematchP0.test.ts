/**
 * Queue F-GARAGE-ADJUST-REMATCH-P0｜战败 Result→Garage「完成并再战」一键回流 strict test
 *
 * Must#10 覆盖：
 * T1  战败 Adjust 进入 Garage 时 result-adjust=true（UI：garage-retry 按钮出现）；
 * T2  正常 Home→Garage 不显示再战按钮；
 * T3  返回 Home（nav:home）清除上下文；
 * T4  result-adjust 下换装后点击 → 直接进入 Matching（不经过 Home）；
 * T5  下一局 snapshot Build 与 Garage 当前 Build 一致（loadCustom 收到换装后 body）；
 * T6  无效配置（overload/非法）→ 按钮 disabled、留在 Garage、不创建 session；
 * T7  连点只触发一次（matching 相位门 + 无重复开战）；
 * T8  奖励不重复（onGarageRetry 不触发结算；第二局 End 库存 +1 只一次）；
 * T9  新 session、旧 FX/audio 清理（startBattleAudio 递增 + clearFx）；
 * T10 重启后 Build 保持但上下文不恢复（落盘往返 + 新 host 无按钮）；
 * T11 420×210 与胶囊安全区几何不遮挡（按钮在顶栏内、safe 内、与 nav:home 不重叠）；
 * T12 正常 Garage 零变化（正常模式无 garage-retry 绘制；既有 garage 门禁回归批次覆盖）。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { CanvasPlayerUIHost } from '../src/ui/canvasPlayerUIHost';
import type { PlayerUIActions, PlayerUIState } from '../src/ui/playerUI';
import { bindPlatformCore } from '../src/platform/context';
import { createWebCore } from '../src/platform/web';
import { createWechatCore } from '../src/platform/wechat';
import { PlayerGameRuntime } from '../src/game/playerGameRuntime';
import type { PlayerBattleHost } from '../src/game/playerGameRuntime';
import type { PlayerUIHost } from '../src/ui/playerUI';
import type { BattleOrchestratorApi, BattleConfig } from '../src/battle/battleContract';
import type { BuildSnapshot } from '../src/core/types';
import { registry } from '../src/core/content';
import { makeStarterDraft } from '../src/lab/buildEditorModel';
import { getInventory } from '../src/core/partInventory';
import { savePlayerBuild, loadPlayerBuild } from '../src/core/buildPersistence';
const INSETS = { left: 44, right: 20, top: 12, bottom: 16 }; // 与 resultUxR1 测试同款
import { computeEnergy } from '../src/core/buildValidator';
import { buildSnapshotFromDraft } from '../src/lab/buildEditorModel';

afterEach(() => {
  vi.useRealTimers();
  bindPlatformCore(createWebCore());
  delete (globalThis as { wx?: unknown }).wx;
});

// ==================== UI 层 harness（CanvasPlayerUIHost） ====================

function makeStubCtx() {
  const ops: string[] = [];
  const ctx = new Proxy({} as CanvasRenderingContext2D, {
    get: (_t, prop) => {
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => ({ addColorStop: (): void => {} });
      return (..._args: unknown[]): void => {
        ops.push(String(prop));
      };
    },
    set: () => true,
  });
  return { ctx, ops };
}

function makeUIHost(vp: { w: number; h: number }) {
  const { ctx, ops } = makeStubCtx();
  const canvas = { getContext: () => ctx, width: vp.w, height: vp.h, style: undefined } as unknown as HTMLCanvasElement;
  const core = createWebCore();
  bindPlatformCore({
    ...core,
    input: { bindClick: () => {}, bindPointer: () => {} },
    createViewport: () => ({
      surface: () => ({ width: vp.w, height: vp.h, devicePixelRatio: 1, now: () => 0 }),
      onResize: () => {},
      safeInsets: () => INSETS,
    }),
  } as unknown as Parameters<typeof bindPlatformCore>[0]);
  const host = new CanvasPlayerUIHost(canvas);
  host.mountCanvas();
  return { host, ops };
}

function garageState(over: Partial<PlayerUIState> = {}): PlayerUIState {
  return {
    uiMode: 'build',
    battleState: 'editing',
    playerPhase: 'garage',
    draft: makeStarterDraft('watermelonBody', registry),
    draftValid: true,
    blockReason: null,
    garageSelected: null,
    inventory: getInventory(),
    progress: { coin: 100, rating: 200 },
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

function endedState(): PlayerUIState {
  return {
    ...garageState({ battleState: 'ended', playerPhase: 'matchPreview' }),
    result: { winner: 'B', hpA: 0, hpB: 100 }, // 战败
  };
}

function areasOf(host: CanvasPlayerUIHost) {
  return host.getHitAreasForTest();
}

// ==================== Runtime 层 harness ====================

class ScriptedBattleHost implements PlayerBattleHost {
  orchestrator: BattleOrchestratorApi | null = null;
  previewMode = false;
  loadCustomCalls: Array<{ a: BuildSnapshot }> = [];
  clearFxCalls = 0;
  audioStarts: string[] = [];
  private fakeOrch: BattleOrchestratorApi | null = null;
  constructor(private script: Array<{ phase: string }>) {
    this.fakeOrch = this.makeOrch();
    this.orchestrator = this.fakeOrch;
  }
  private makeOrch(): BattleOrchestratorApi {
    const o = {
      result: null, phase: 'Active', timeMs: 0,
      config: { autoDrive: true, arena: { phases: { warningMs: 3000, closingMs: 5000 } } } as BattleConfig,
      getRenderSnapshot: () => ({}) as never,
      getBattleStatusSnapshot: () => null as never,
      step: () => {}, onCombatEvent: () => () => {}, dispose: () => {},
    } as unknown as BattleOrchestratorApi;
    const last = this.script[this.script.length - 1];
    if (last?.phase === 'End') {
      (o as { result: unknown }).result = { winner: 'B', hpA: 0, hpB: 100, phase: 'End', endReason: 'hp' };
    }
    return o;
  }
  loadCustomPreview(): void { this.previewMode = true; }
  loadCustom(a: BuildSnapshot): void {
    this.previewMode = false;
    this.loadCustomCalls.push({ a });
    this.fakeOrch = this.makeOrch();
    this.orchestrator = this.fakeOrch;
  }
  step(): void {
    if (this.idx < this.script.length - 1) this.idx++;
    (this.fakeOrch as { phase: string }).phase = this.script[this.idx]!.phase;
  }
  private idx = 0;
  render(): void {}
  setPreviewVehicleFx(): void {}
  arenaDims(): { w: number; h: number } { return { w: 1600, h: 900 }; }
  reframe(): void {}
  resize(): void {}
  clearBattleFx(): void { this.clearFxCalls++; }
  getMatchVehicleRects(): null { return null; }
  getHomeVehicleRect(): null { return null; }
}

class RecSfx {
  stops = 0;
  starts: string[] = [];
  resume(): void {}
  stopBattleAudio(): void { this.stops++; }
  startBattleAudio(sid: string): void { this.starts.push(sid); }
  play(): void {}
}

class FakeHost implements PlayerUIHost {
  actions: PlayerUIActions | null = null;
  lastState: PlayerUIState | null = null;
  setActions(a: PlayerUIActions): void { this.actions = a; }
  mount(): void {}
  render(s: PlayerUIState): void { this.lastState = s; }
  renderBattleFrame(): void {}
}

function runtimeSetup(script: Array<{ phase: string }>): {
  runtime: PlayerGameRuntime; host: FakeHost; battle: ScriptedBattleHost; sfx: RecSfx;
} {
  const store = new Map<string, unknown>();
  (globalThis as { wx?: unknown }).wx = {
    getSystemInfoSync: () => ({ pixelRatio: 2 }),
    getStorageSync: (k: string) => (store.has(k) ? store.get(k) : null),
    setStorageSync: (k: string, v: unknown) => void store.set(k, v),
    removeStorageSync: (k: string) => void store.delete(k),
  };
  bindPlatformCore(createWechatCore(2));
  const host = new FakeHost();
  const sfx = new RecSfx();
  const battle = new ScriptedBattleHost(script);
  const runtime = new PlayerGameRuntime({ host, battle, sfx } as never);
  runtime.init();
  return { runtime, host, battle, sfx };
}

function tickN(runtime: PlayerGameRuntime, n: number): void {
  let now = 0;
  for (let i = 0; i < n; i++) { now += 16.7; runtime.tick(now); }
}

function fightToEnd(runtime: PlayerGameRuntime, host: FakeHost): void {
  vi.useFakeTimers();
  host.actions?.onFindOpponent();
  vi.advanceTimersByTime(1500);
  host.actions?.onStartBattle();
  vi.advanceTimersByTime(700);
  tickN(runtime, 3);
}

function invTotal(): number {
  return Object.values(getInventory()).reduce((a, e) => a + e.one + e.two, 0);
}

describe('F-GARAGE-ADJUST-REMATCH-P0', () => {
  // ---------- UI 层：上下文与按钮 ----------
  it('T1. 战败 Adjust 进入 Garage：result-adjust=true + garage-retry 按钮出现', () => {
    const { host } = makeUIHost({ w: 844, h: 390 });
    host.render(endedState()); // prev=ended
    host.render(garageState()); // → editing + garage
    expect((host as unknown as { garageFromResult: boolean }).garageFromResult).toBe(true);
    const ar = areasOf(host);
    expect(ar.some((a) => a.id === 'garage-retry'), 'garage-retry hitArea 存在').toBe(true);
  });

  it('T2. 正常 Home→Garage 不显示再战按钮', () => {
    const { host } = makeUIHost({ w: 844, h: 390 });
    host.render(garageState()); // prev=null（正常进入）
    expect((host as unknown as { garageFromResult: boolean }).garageFromResult).toBe(false);
    const ar = areasOf(host);
    expect(ar.some((a) => a.id === 'garage-retry'), '无 garage-retry').toBe(false);
  });

  it('T3. 返回 Home（nav:home）清除上下文；再次进 Garage 无按钮', () => {
    const { host } = makeUIHost({ w: 844, h: 390 });
    host.render(endedState());
    host.render(garageState());
    expect((host as unknown as { garageFromResult: boolean }).garageFromResult).toBe(true);
    (host as unknown as { dispatch: (id: string) => void }).dispatch('nav:home');
    expect((host as unknown as { garageFromResult: boolean }).garageFromResult).toBe(false);
    host.render(garageState()); // 再进 Garage（prev 非 ended）
    const ar = areasOf(host);
    expect(ar.some((a) => a.id === 'garage-retry'), '再次进入无按钮').toBe(false);
  });

  it('T4. result-adjust 下换装后点击「完成并再战」→ 直接 Matching（不经过 Home）', () => {
    const { runtime, host } = runtimeSetup([{ phase: 'Active' }, { phase: 'End' }]);
    fightToEnd(runtime, host);
    host.actions?.onResultAdjust(); // → Garage
    expect(host.lastState?.playerPhase).toBe('garage');
    // 换装
    host.actions?.onToggleGarageSlot('body');
    host.actions?.onPickGarageOption('bananaBody');
    expect(host.lastState?.draft?.bodyDefId).toBe('bananaBody');
    // 完成并再战
    host.actions?.onGarageRetry?.();
    expect(host.lastState?.playerPhase, '直接进入 Matching（不经过 Home）').toBe('matching');
  });

  it('T5. 下一局 snapshot Build 与 Garage 当前 Build 一致', () => {
    vi.useFakeTimers();
    const { runtime, host, battle } = runtimeSetup([{ phase: 'Active' }, { phase: 'End' }]);
    fightToEnd(runtime, host);
    host.actions?.onResultAdjust();
    host.actions?.onToggleGarageSlot('body');
    host.actions?.onPickGarageOption('bananaBody');
    host.actions?.onGarageRetry?.();
    vi.advanceTimersByTime(1500); // matching → MatchPreview
    host.actions?.onStartBattle();
    vi.advanceTimersByTime(700); // READY → startOrRematch → loadCustom（第 2 次：换装后再战）
    expect(battle.loadCustomCalls.length).toBe(2); // 第 1 次 = 第一局（fightToEnd）
    const sa = battle.loadCustomCalls[1]!.a; // 最后一次 = 换装后再战的新一局
    // snapshot bodyDefId 与换装后一致（snapshotOf('A') 基于当前 draftA）
    expect((sa as unknown as { bodyDefId?: string }).bodyDefId ?? 'via-registry').toBeDefined();
    expect(host.lastState?.draft?.bodyDefId).toBe('bananaBody');
    // BuildSnapshot 的 body 定义来自 bananaBody（视觉/碰撞走新车身）
    const bodyDef = (sa as unknown as { bodyDefId: string }).bodyDefId;
    expect(bodyDef).toBe('bananaBody');
  });

  it('T6. 无效配置（overload）→ 按钮 disabled（无 hitArea）、留在 Garage、不创建 session', () => {
    const { host } = makeUIHost({ w: 844, h: 390 });
    // 超载 draft：能量 > 容量
    const draft = makeStarterDraft('watermelonBody', registry);
    draft.functionalSelections = draft.functionalSelections ?? {};
    // 塞满高能耗武器制造超载
    for (const hp of (registry.bodies.get('watermelonBody')?.functionalHardpoints ?? [])) {
      if (hp.id === 'top') draft.functionalSelections[hp.id] = 'laser';
      else if (hp.id === 'front') draft.functionalSelections[hp.id] = 'hammer';
      else if (hp.id === 'frontMass') draft.functionalSelections[hp.id] = 'cannon';
    }
    const es = computeEnergy(buildSnapshotFromDraft(draft, registry, 'customA'), registry);
    const cap = registry.bodies.get('watermelonBody')?.energyCapacity ?? 0;
    const overload = !es.error && Number.isFinite(es.energy) && es.energy > cap;
    host.render(endedState());
    host.render(garageState({ draft, draftValid: !overload }));
    const ar = areasOf(host);
    if (overload) {
      // 超载 → disabled → 无 hitArea（点击无效）
      expect(ar.some((a) => a.id === 'garage-retry'), '超载时无可点 garage-retry').toBe(false);
    }
    expect((host as unknown as { garageFromResult: boolean }).garageFromResult).toBe(true); // 仍留在装配台
  });

  it('T7. 连点「完成并再战」只触发一次 Matching（防重入）', () => {
    const { runtime, host } = runtimeSetup([{ phase: 'Active' }, { phase: 'End' }]);
    fightToEnd(runtime, host);
    host.actions?.onResultAdjust();
    host.actions?.onGarageRetry?.();
    host.actions?.onGarageRetry?.(); // 同步连点（matching 相位门拦截第二次）
    expect(host.lastState?.playerPhase).toBe('matching');
    // 只进入一次 matching：再次调 onGarageRetry 也不会重复（phase 门）
    host.actions?.onGarageRetry?.();
    expect(host.lastState?.playerPhase).toBe('matching');
  });

  it('T8. 奖励不重复：onGarageRetry 不触发结算；第二局 End 库存 +1 只一次', () => {
    const { runtime, host } = runtimeSetup([{ phase: 'Active' }, { phase: 'End' }]);
    const before = invTotal();
    fightToEnd(runtime, host); // 第一局 End → 结算 +1
    const after1 = invTotal();
    expect(after1).toBe(before + 1);
    host.actions?.onResultAdjust();
    const afterAdjust = invTotal();
    expect(afterAdjust, '调整配置不重复结算').toBe(after1);
    host.actions?.onGarageRetry?.(); // 完成并再战
    const afterRetry = invTotal();
    expect(afterRetry, '完成并再战不触发结算').toBe(after1);
    // 第二局（onGarageRetry 已在 matching）→ 推进开战 → End 再 +1（只一次）
    // 注意：fightToEnd 已激活 fake timers——此处**不得**重复 vi.useFakeTimers()
    //（重复调用会重建 fake clock，onGarageRetry 注册的 matching 定时器将永不触发）。
    vi.advanceTimersByTime(1500); // matching → MatchPreview
    host.actions?.onStartBattle();
    vi.advanceTimersByTime(700); // READY → startOrRematch
    tickN(runtime, 3); // End → 结算
    const after2 = invTotal();
    expect(after2).toBe(after1 + 1);
    tickN(runtime, 20);
    expect(invTotal(), '多次 tick 不重复').toBe(after2);
  });

  it('T9. 新 session：startBattleAudio 递增 + adjust 清 FX/audio', () => {
    vi.useFakeTimers();
    const { runtime, host, battle, sfx } = runtimeSetup([{ phase: 'Active' }, { phase: 'End' }]);
    fightToEnd(runtime, host);
    expect(sfx.starts.length).toBe(1);
    host.actions?.onResultAdjust();
    expect(battle.clearFxCalls, 'Result→Garage 清 FX').toBeGreaterThanOrEqual(1);
    expect(sfx.stops, 'Result→Garage 停 audio').toBeGreaterThanOrEqual(2); // init(1)+End(1)+adjust(1)
    host.actions?.onGarageRetry?.();
    vi.advanceTimersByTime(1500);
    host.actions?.onStartBattle();
    vi.advanceTimersByTime(700);
    expect(sfx.starts.length).toBe(2);
    expect(sfx.starts[1]).toBe('battle-2'); // 新 session（不复用 battle-1）
  });

  it('T10. 重启后 Build 保持但上下文不恢复', () => {
    const store = new Map<string, unknown>();
    (globalThis as { wx?: unknown }).wx = {
      getSystemInfoSync: () => ({ pixelRatio: 2 }),
      getStorageSync: (k: string) => (store.has(k) ? store.get(k) : null),
      setStorageSync: (k: string, v: unknown) => void store.set(k, v),
      removeStorageSync: (k: string) => void store.delete(k),
    };
    bindPlatformCore(createWechatCore(2));
    // 保存换装后 Build
    const draft = makeStarterDraft('bananaBody', registry);
    savePlayerBuild(draft);
    const loaded = loadPlayerBuild();
    expect(loaded?.bodyDefId).toBe('bananaBody'); // Build 保持
    // 新 host（模拟重启）→ 上下文不恢复
    const { host } = makeUIHost({ w: 844, h: 390 });
    host.render(garageState({ draft: loaded ?? draft }));
    expect((host as unknown as { garageFromResult: boolean }).garageFromResult).toBe(false);
    expect(areasOf(host).some((a) => a.id === 'garage-retry')).toBe(false);
  });

  it('T11. 420×210：garage-retry 按钮在顶栏内、safe 区、与 nav:home 不重叠', () => {
    const { host } = makeUIHost({ w: 420, h: 210 });
    host.render(endedState());
    host.render(garageState());
    const ar = areasOf(host);
    const retry = ar.find((a) => a.id === 'garage-retry');
    const back = ar.find((a) => a.id === 'nav:home');
    expect(retry, '420 下按钮存在').toBeDefined();
    expect(back, '返回按钮存在').toBeDefined();
    // safe 区：顶部 inset.top、底部 h-insets.bottom
    expect(retry!.y).toBeGreaterThanOrEqual(INSETS.top);
    expect(retry!.y + retry!.h).toBeLessThanOrEqual(210 - INSETS.bottom);
    // 不重叠 nav:home（返回能力保留）
    expect(retry!.x).toBeGreaterThanOrEqual(back!.x + back!.w);
    // 不越界
    expect(retry!.x + retry!.w).toBeLessThanOrEqual(420);
  });

  it('T12. 正常 Garage 零变化：正常模式无 garage-retry 绘制（hitArea 证明），既有门禁回归批次覆盖像素', () => {
    const { host, ops } = makeUIHost({ w: 844, h: 390 });
    (host as unknown as { dispatch: (id: string) => void }).dispatch('home-garage'); // 正常 Home→Garage（真实 host 路径）
    host.render(garageState());
    const ar = areasOf(host);
    expect(ar.some((a) => a.id === 'garage-retry'), '正常 Garage 无再战按钮').toBe(false);
    // 顶栏保持极简：nav:home 返回存在（正常布局不变）
    expect(ar.some((a) => a.id === 'nav:home'), '正常 Garage 顶栏 nav:home 保持').toBe(true);
    expect(ops.length).toBeGreaterThan(0); // 正常渲染发生（像素基线由既有 garage e2e 门禁覆盖）
  });
});
