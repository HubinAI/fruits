/**
 * F-WX-5｜PlayerGameRuntime 定向测试（headless）。
 *
 * 用 FakeBattleHost（脚本化战斗） + FakeUIHost（捕获渲染）驱动真实 PlayerGameRuntime，
 * 验证：
 * 1. init：玩家状态从微信 storage 装载、持久化落 fake wx（验收 2/3）；
 * 2. 装配经 actions 持久化到微信 storage；重进恢复（验收 3 刷新/重进）；
 * 3. 完整闭环：Garage→Matching→MatchPreview→Battle→Result→Reward→Garage→再战
 *    （验收 2 玩家闭环；Reward/Economy 落微信 storage）；
 * 4. 合成（Merge）：5×1★ 熔炼经微信 storage 生效（Equip/Merge 环节）。
 *
 * 本文件绑定 WechatCore（fake wx storage），证明持久化落到微信而非 Web/localStorage；
 * afterEach 还原 Web 绑定（与 platformBinding 同一模式）。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { bindPlatformCore } from '../src/platform/context';
import { createWebCore } from '../src/platform/web';
import { createWechatCore } from '../src/platform/wechat';
import { PlayerGameRuntime } from '../src/game/playerGameRuntime';
import type { PlayerBattleHost } from '../src/game/playerGameRuntime';
import { loadInventoryRaw, getInventory } from '../src/core/partInventory';
import { loadProgressRaw } from '../src/core/playerProgress';
import type {
  PlayerUIState,
  PlayerUIActions,
  PlayerUIHost,
  PlayerUIHudFrame,
} from '../src/ui/playerUI';
import type { BattleOrchestratorApi, BattleConfig } from '../src/battle/battleContract';

const BUILD_KEY = 'strongfruit.playerBuild.v1';
const INV_KEY_V2 = 'strongfruit.ownedParts.v2';
const PROG_KEY = 'strongfruit.playerProgress.v1';

const BATTLE_STEPS = 60; // 假战斗 60 步后出结果

/** 假战斗：仅提供 runtime 读取的最小字段（result/phase/timeMs/config + no-op 方法） */
function makeOrch(steps: number): BattleOrchestratorApi {
  const done = steps >= BATTLE_STEPS;
  return {
    result: done ? { winner: 'A', hpA: 100, hpB: 0, phase: 'End', endReason: 'hp' } : null,
    phase: done ? 'End' : 'Active',
    timeMs: steps * 16.7,
    config: { autoDrive: true, arena: { phases: { warningMs: 3000 } } } as BattleConfig,
    getRenderSnapshot: () => ({}) as unknown as never,
    getBattleStatusSnapshot: () => null as never,
    step: () => {},
    onCombatEvent: () => () => {},
    dispose: () => {},
  } as unknown as BattleOrchestratorApi;
}

class FakeBattleHost implements PlayerBattleHost {
  previewMode = false;
  orchestrator: BattleOrchestratorApi | null = null;
  private steps = 0;
  loadCustomPreview(): void {
    this.previewMode = true;
    this.steps = 0;
    this.orchestrator = null;
  }
  loadCustom(): void {
    this.previewMode = false;
    this.steps = 0;
    this.orchestrator = makeOrch(0);
  }
  step(): void {
    if (this.previewMode || !this.orchestrator) return;
    this.steps++;
    this.orchestrator = makeOrch(this.steps);
  }
  render(): void {}
  setPreviewVehicleFx(): void {}
  arenaDims(): { w: number; h: number } {
    return { w: 1600, h: 900 };
  }
  reframe(): void {}
  resize(): void {}
}

class FakeHost implements PlayerUIHost {
  actions: PlayerUIActions | null = null;
  lastState: PlayerUIState | null = null;
  states: PlayerUIState[] = [];
  frames: PlayerUIHudFrame[] = [];
  setActions(a: PlayerUIActions): void {
    this.actions = a;
  }
  mount(): void {}
  render(s: PlayerUIState): void {
    this.states.push(s);
    this.lastState = s;
  }
  renderBattleFrame(f: PlayerUIHudFrame): void {
    this.frames.push(f);
  }
}

function fakeWxStore(): Map<string, unknown> {
  const store = new Map<string, unknown>();
  (globalThis as any).wx = {
    getSystemInfoSync: () => ({ pixelRatio: 2 }),
    getStorageSync: (k: string) => (store.has(k) ? store.get(k) : null),
    setStorageSync: (k: string, v: unknown) => void store.set(k, v),
    removeStorageSync: (k: string) => void store.delete(k),
  };
  return store;
}

function setup(store?: Map<string, unknown>): {
  runtime: PlayerGameRuntime;
  host: FakeHost;
  battle: FakeBattleHost;
  store: Map<string, unknown>;
} {
  const s = store ?? fakeWxStore();
  bindPlatformCore(createWechatCore(2));
  const host = new FakeHost();
  const battle = new FakeBattleHost();
  const runtime = new PlayerGameRuntime({ host, battle, sfx: { resume() {} } });
  runtime.init();
  return { runtime, host, battle, store: s };
}

/** 手动推进 runtime.tick（dt=16.7 固定步长） */
function tickMany(runtime: PlayerGameRuntime, n: number): void {
  let now = 0;
  for (let i = 0; i < n; i++) {
    now += 16.7;
    runtime.tick(now);
  }
}

describe('F-WX-5 PlayerGameRuntime（headless 玩家闭环）', () => {
  afterEach(() => {
    vi.useRealTimers();
    bindPlatformCore(createWebCore());
    delete (globalThis as any).wx;
  });

  it('init：新账号 → Garage；玩家状态/持久化落微信 storage（验收 2/3）', () => {
    const { runtime, host, store } = setup();
    expect(runtime.uiMode).toBe('build');
    expect(runtime.battleState).toBe('editing');
    expect(runtime.playerPhase).toBe('garage');
    expect(runtime.draftA.bodyDefId).toBe('watermelonBody'); // 空存档 → starter 合法 Build
    expect(host.lastState?.playerPhase).toBe('garage');
    expect(host.lastState?.onboarding).toBe('pending'); // 全新账号首轮引导
    expect(store.has(BUILD_KEY)).toBe(true); // refreshFromEdit → savePlayerBuild
    expect(store.has(INV_KEY_V2)).toBe(true); // ensureInventory 种子落盘
  });

  it('F-WX-8-A｜fresh boot 不自动 Battle：无玩家输入，多 tick 后仍 Garage/editing/preview', () => {
    const { runtime, host, battle } = setup();
    // init 后：装配预览模式（preview），非正式战斗；FakeBattleHost.loadCustomPreview 置
    // orchestrator=null（preview 不推进），证明「启动即创建正式 Battle」被拒绝。
    expect(battle.previewMode).toBe(true);
    expect(battle.orchestrator).toBeNull();
    // 模拟多帧（120 tick ≈ 2s），期间无任何玩家输入
    tickMany(runtime, 120);
    expect(runtime.battleState).toBe('editing');
    expect(runtime.playerPhase).toBe('garage');
    expect(host.lastState?.battleState).toBe('editing');
    expect(host.lastState?.playerPhase).toBe('garage');
    expect(host.lastState?.result).toBeNull();
    expect(host.frames.some((f) => f.battleState === 'fighting')).toBe(false); // HUD 从未进 fighting
    expect(battle.previewMode).toBe(true); // 仍是 preview，未 loadCustom（无自动开战）
    expect(battle.orchestrator).toBeNull();
  });

  it('F-WX-8-A｜点击「寻找对手」才离开 Garage：Matching → Battle → Result（不自动开战）', () => {
    vi.useFakeTimers();
    const { runtime, host, battle } = setup();
    expect(runtime.playerPhase).toBe('garage');
    // 无输入时推进也不离开 garage（匹配/开战靠 setTimeout，fake timers 下不会被 tick 触发）
    tickMany(runtime, 60);
    expect(runtime.playerPhase).toBe('garage');
    expect(battle.previewMode).toBe(true); // 仍是装配预览
    // 玩家点击「寻找对手」→ Matching（注册匹配节奏 setTimeout）
    runtime.actions.onFindOpponent();
    expect(runtime.playerPhase).toBe('matching');
    vi.advanceTimersByTime(1420); // F-MATCH-DEMO-R1：匹配节奏 1100+320 → MatchPreview（1.42s ∈ [1.2,1.8]）
    expect(runtime.playerPhase).toBe('matchPreview');
    expect(battle.previewMode).toBe(true); // previewFixed 阶段仍是 preview
    vi.advanceTimersByTime(700); // F-MATCH-FRAME-R2：MatchPreview 停留 ~700ms → READY 过渡
    vi.advanceTimersByTime(600); // READY 600ms → 正式开战（桌面语义；mobile 由 isMobileView 压缩为 0）
    expect(runtime.battleState).toBe('fighting');
    expect(battle.previewMode).toBe(false); // 正式战斗已 loadCustom（非 preview）
    expect(battle.orchestrator).not.toBeNull();
    // Battle 推进到结束 → Result
    tickMany(runtime, 90);
    expect(runtime.battleState).toBe('ended');
    expect(host.lastState?.result).not.toBeNull();
    vi.useRealTimers();
  });

  it('装配经 actions 持久化到微信 storage；重进恢复（验收 3 刷新/重进）', () => {
    const { runtime, store } = setup();
    runtime.actions.onToggleGarageSlot('body');
    runtime.actions.onPickGarageOption('bananaBody');
    expect(runtime.draftA.bodyDefId).toBe('bananaBody');
    const raw = store.get(BUILD_KEY) as string;
    expect(raw).toContain('bananaBody'); // 存档已写入微信 storage

    // 重进（同 wx storage，新 runtime 实例）
    const host2 = new FakeHost();
    const battle2 = new FakeBattleHost();
    const runtime2 = new PlayerGameRuntime({ host: host2, battle: battle2 });
    runtime2.init();
    expect(runtime2.draftA.bodyDefId).toBe('bananaBody'); // 从微信 storage 恢复
  });

  it('完整闭环：Garage→Matching→MatchPreview→Battle→Result→Reward→Garage→再战（验收主循环）', () => {
    vi.useFakeTimers();
    const { runtime, host } = setup();

    // —— Garage → Matching ——
    runtime.actions.onFindOpponent();
    expect(runtime.playerPhase).toBe('matching');
    expect(host.lastState?.playerPhase).toBe('matching');

    // —— 候选切换 ~1.42s → MatchPreview ——
    vi.advanceTimersByTime(1420);
    expect(runtime.playerPhase).toBe('matchPreview');
    expect(host.lastState?.opponent).not.toBeNull();
    expect(host.lastState?.matchBarHidden).toBe(true); // 复核条永不闪现

    // —— 700ms → READY ——（F-MATCH-FRAME-R2：MatchPreview 停留 ~700ms）
    vi.advanceTimersByTime(700);
    expect(host.lastState?.readyOverlayVisible).toBe(true);

    // —— 600ms → 开战 ——
    vi.advanceTimersByTime(600);
    expect(runtime.battleState).toBe('fighting');

    // —— 战斗推进到结束（假战斗 60 步）——
    tickMany(runtime, BATTLE_STEPS + 5);
    expect(runtime.battleState).toBe('ended');
    const ended = host.lastState!;
    expect(ended.result?.winner).toBe('A');
    expect(ended.reward).not.toBeNull(); // 奖励已结算
    expect(ended.economy).not.toBeNull(); // 金币/段位已结算
    expect(ended.resultOnboardingVisible).toBe(true); // 首轮引导提示
    // Reward/Economy 落微信 storage（自动入库）
    expect(loadInventoryRaw()).not.toBeNull();
    expect(loadProgressRaw()?.coin).toBeGreaterThan(0);

    // —— Result「调整配置」→ Garage；首轮引导 done ——
    runtime.actions.onResultAdjust();
    expect(runtime.playerPhase).toBe('garage');
    expect(runtime.battleState).toBe('editing');
    expect(host.lastState?.onboarding).toBe('done');

    // —— 再战：下一场 → Matching → Battle → Ended（闭环可循环）——
    runtime.actions.onFindOpponent();
    expect(runtime.playerPhase).toBe('matching');
    vi.advanceTimersByTime(1420 + 700 + 600); // F-MATCH-DEMO-R1：匹配 1.42s + Locked 700ms + READY 600ms(桌面)
    expect(runtime.battleState).toBe('fighting');
    tickMany(runtime, BATTLE_STEPS + 5);
    expect(runtime.battleState).toBe('ended');
  });

  it('合成（Fuse）：5×1★ 同 defId 熔炼经微信 storage 生效（Equip/Fuse 环节）', () => {
    const store = fakeWxStore();
    store.set(INV_KEY_V2, JSON.stringify({ __v: 1, spear: { one: 6, two: 0 } }));
    store.set(PROG_KEY, JSON.stringify({ __v: 1, coin: 500, rating: 0 }));
    const ctx = setup(store);
    const runtime = ctx.runtime;

    const before = getInventory();
    const beforeTwo = Object.values(before).reduce((s, e) => s + e.two, 0);
    runtime.actions.onFuse('spear', 1);
    const after = getInventory();
    const afterTwo = Object.values(after).reduce((s, e) => s + e.two, 0);
    expect(afterTwo).toBeGreaterThan(beforeTwo); // 合成出 2★
    expect(loadProgressRaw()?.coin).toBe(500); // 合成无金币成本（不改 coin）
  });

  it('合成（Fuse）资源不足：安全 no-op 不卡死、不改库存', () => {
    const { runtime } = setup(); // 全新账号：1★ 各 1，不足以合成
    const before = getInventory();
    runtime.actions.onFuse('spear', 1); // 不应抛错 / 不应改动
    expect(getInventory()).toEqual(before);
  });
});
