/**
 * F-MATCH-DEMO-R1｜重构手机匹配锁定连续过场 —— 时序验收锁定。
 *
 * 用户问题：匹配阶段被空白 / 残留编辑器 / 重复状态稀释，仍像 Renderer 调试预览。
 * 调研结论：连续画面（drawMatchingContinuum：A 左 B 右同基线 / 中央 VS / 单一状态文字 /
 * 候选真实 envelope 扫描框 / 锁定换对手名称）与「mobile 无 READY / 无 matchBar / 无顶部
 * 重复标题」门控均已就绪；本队列真实缺口是**战前时序**：
 *   1) 搜索总时长 ~1.0s（验收 4 需 1.2~1.8s）；
 *   2) Locked 稳定 700ms + READY 600ms 空等 = 1300ms（验收 6 需 600~800ms 后直接进入战斗）。
 *
 * 本文件锁定：
 * A. 源码守卫：搜索节奏（steps 3 次切换 = 4 候选显示 ∈ [3,5]；锁定 1100+320=1420ms ∈ [1.2,1.8]s）；
 *    mobile readyHoldMs = 0（无 600ms READY 空等）、桌面保留 600ms；
 *    goToMatchPreview 700ms 契约不变（q15FlowAutoBattle 同源，不重复断言）。
 * B. 集成（fake timers）：mobile（isMobileView=true）matching → 1420ms → matchPreview →
 *    700ms 锁定稳定 → 立即（0ms）进入 Battle；桌面（无 isMobileView）保留 700+600 语义。
 * C. 无 READY / 开战 / 顶部重复标题 / 确认按钮：prebattleP0 已逐帧锁定，此处补一条源码
 *    门控守卫（readyOverlay 与 matchBar 均 !isMobile）防回归。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bindPlatformCore } from '../src/platform/context';
import { createWebCore } from '../src/platform/web';
import { createWechatCore } from '../src/platform/wechat';
import { PlayerGameRuntime } from '../src/game/playerGameRuntime';
import type { PlayerBattleHost } from '../src/game/playerGameRuntime';
import type { BattleOrchestratorApi, BattleConfig } from '../src/battle/battleContract';
import type { PlayerUIState, PlayerUIActions, PlayerUIHost } from '../src/ui/playerUI';

const RUNTIME = readFileSync(
  fileURLToPath(new URL('../src/game/playerGameRuntime.ts', import.meta.url)),
  'utf8',
);
const HOST_SRC = readFileSync(
  fileURLToPath(new URL('../src/ui/canvasPlayerUIHost.ts', import.meta.url)),
  'utf8',
);

// ==================== 集成 harness（与 playerGameRuntime.test.ts 同模式） ====================

const BATTLE_STEPS = 60;

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
  setActions(a: PlayerUIActions): void {
    this.actions = a;
  }
  mount(): void {}
  render(s: PlayerUIState): void {
    this.states.push(s);
    this.lastState = s;
  }
  renderBattleFrame(): void {}
}

/** mobile Canvas host 语义：isMobileView() → true */
class MobileFakeHost extends FakeHost {
  isMobileView(): boolean {
    return true;
  }
}

function setup(host: PlayerUIHost): {
  runtime: PlayerGameRuntime;
  host: FakeHost;
  battle: FakeBattleHost;
} {
  const store = new Map<string, unknown>();
  (globalThis as any).wx = {
    getSystemInfoSync: () => ({ pixelRatio: 2 }),
    getStorageSync: (k: string) => (store.has(k) ? store.get(k) : null),
    setStorageSync: (k: string, v: unknown) => void store.set(k, v),
    removeStorageSync: (k: string) => void store.delete(k),
  };
  bindPlatformCore(createWechatCore(2));
  const battle = new FakeBattleHost();
  const runtime = new PlayerGameRuntime({ host, battle, sfx: { resume() {} } });
  runtime.init();
  return { runtime, host: host as FakeHost, battle };
}

/** 匹配流程推进：寻找对手 → advance(1420) 到 matchPreview → advance(700) 锁定稳定窗口 */
function driveToLocked(runtime: PlayerGameRuntime, after: number): void {
  runtime.actions.onFindOpponent();
  vi.advanceTimersByTime(1420);
  expect(runtime.playerPhase).toBe('matchPreview');
  vi.advanceTimersByTime(after);
}

describe('F-MATCH-DEMO-R1｜手机匹配锁定连续过场', () => {
  afterEach(() => {
    vi.useRealTimers();
    bindPlatformCore(createWebCore());
    delete (globalThis as any).wx;
  });

  describe('A｜源码守卫：战前时序', () => {
    it('搜索总时长 1.42s ∈ [1.2s, 1.8s]；候选切换 3 次（显示 4 个 ∈ [3,5]）（验收 4）', () => {
      expect(RUNTIME).toMatch(/},\s*1100 \+ 320\);/);
      // steps 数组恰好 3 个切换点（0/340/720/1100 → 4 个候选显示、3 次变化）
      expect(RUNTIME).toMatch(/at: 340, idx: seq\[1\] \}/);
      expect(RUNTIME).toMatch(/at: 720, idx: seq\[2\] \}/);
      expect(RUNTIME).toMatch(/at: 1100, idx: seq\[3\] \}/); // 末位 = 实际锁定对手
    });

    it('mobile readyHoldMs=0（Locked 稳定 ~700ms 后直接开战，无 600ms READY 空等）；桌面保留 600ms（验收 6/7）', () => {
      expect(RUNTIME).toMatch(/isMobileView\?\.\(\) \? 0 : 600/);
      expect(RUNTIME).toMatch(/const readyHoldMs = this\.deps\.host\.isMobileView\?\.\(\) \? 0 : 600;/);
    });

    it('goToMatchPreview 锁定稳定 700ms ∈ [600,800]ms 契约不变（q15FlowAutoBattle 同源）', () => {
      expect(RUNTIME).toMatch(/startBattleWithReady\(\);\s*\},\s*700\);/);
    });

    it('Host 门控：READY 覆盖层 / matchBar 复核条均 !isMobile（mobile 正式流程零残留，验收 7）', () => {
      expect(HOST_SRC).toMatch(/if \(state\.readyOverlayVisible && !this\.isMobile\) this\.drawReadyOverlay\(\);/);
      expect(HOST_SRC).toMatch(/if \(!this\.isMobile && !state\.matchBarHidden\) this\.drawMatchBar\(\);/);
      // 顶部重复状态条（drawPlayerTop）仅 Desktop/Test
      expect(HOST_SRC).toMatch(/if \(!this\.isMobile\) this\.drawPlayerTop\('对手已锁定'\);/);
    });
  });

  describe('B｜集成：mobile 与 desktop 战前过渡时序', () => {
    it('mobile：匹配 1.42s → Locked 稳定 700ms → 立即（0ms）进入 Battle，无 600ms READY 空等', () => {
      vi.useFakeTimers();
      const { runtime, battle } = setup(new MobileFakeHost());
      driveToLocked(runtime, 700);
      // 700ms 锁定窗口结束：startBattleWithReady 已触发（readyHoldMs=0）→ 注册 setTimeout(0)
      expect(runtime.battleState).toBe('editing');
      expect(runtime.playerPhase).toBe('matchPreview'); // 画面仍为「对手已锁定」
      vi.advanceTimersByTime(1); // 0ms 定时器 → 直接开战
      expect(runtime.battleState).toBe('fighting');
      expect(battle.previewMode).toBe(false);
    });

    it('desktop：匹配 1.42s → Locked 700ms → READY 600ms → Battle（旧语义保留，未被 mobile 分支污染）', () => {
      vi.useFakeTimers();
      const { runtime, battle } = setup(new FakeHost());
      driveToLocked(runtime, 700);
      expect(runtime.battleState).toBe('editing'); // 700ms 后进入 READY 过渡（仍未开战）
      vi.advanceTimersByTime(600); // READY 600ms → 正式开战
      expect(runtime.battleState).toBe('fighting');
      expect(battle.previewMode).toBe(false);
    });
  });
});
