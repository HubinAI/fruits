/**
 * Q30｜V0.8 IAA 广告 MVP（Interstitial 频控持久化）。
 *
 * 最小频控：完整 Battle 结束后才允许 Interstitial，且「每 3~4 局最多 1 次」。
 * - 以「已结束 Battle 数」为计数；达到最小间隔（3 局）才合格；
 * - 广告尝试后：completed / failed / dismissed 重置计数（避免连续插屏）；no_fill（平台无广告）不重置，下次合格再试；
 * - 持久化于 localStorage（saveVersion 信封同模式），刷新后频控继续生效；
 * - 不引入任何第三方 dependency；无 localStorage（隐私模式 / node 测试）安全降级为内存态。
 */
import { readJsonWithVersion, stampVersion } from './saveVersion';

const FREQ_KEY = 'strongfruit.ads.freq.v1';

/**
 * 最小间隔局数。合格条件：battlesSinceLast >= MIN_BATTLE_GAP。
 * 「每 3~4 局最多 1 次」的上界约束——取保守下界 3，保证任意 3 局窗口内至多 1 次。
 */
export const MIN_BATTLE_GAP = 3;

export interface AdFreqState {
  /** 距上次 Interstitial 已结束的 Battle 数 */
  battlesSinceLast: number;
}

function loadState(): AdFreqState {
  if (typeof localStorage === 'undefined') return { battlesSinceLast: 0 };
  try {
    const raw = localStorage.getItem(FREQ_KEY);
    if (!raw) return { battlesSinceLast: 0 };
    const parsed = readJsonWithVersion(raw);
    if (!parsed) return { battlesSinceLast: 0 };
    const o = parsed.obj as Record<string, unknown>;
    const n = Math.max(0, Math.floor(Number(o.battlesSinceLast) || 0));
    return { battlesSinceLast: n };
  } catch {
    return { battlesSinceLast: 0 };
  }
}

function saveState(s: AdFreqState): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(FREQ_KEY, JSON.stringify(stampVersion(s)));
  } catch {
    // 写入失败静默忽略
  }
}

/** 运行时单例（首次加载自存档；之后仅在内存态维护，落盘由 saveState 负责） */
let state: AdFreqState = loadState();

/** 每场 Battle 结束后调用一次（在 battle_end 去重块内），计数 +1 并落盘 */
export function onBattleEnded(): void {
  state = { battlesSinceLast: state.battlesSinceLast + 1 };
  saveState(state);
}

/** 当前是否达到插屏合格间隔（不校验广告可用性，可用性由 ads.ts 负责） */
export function isInterstitialEligible(): boolean {
  return state.battlesSinceLast >= MIN_BATTLE_GAP;
}

/**
 * 广告尝试后调用：no_fill（平台无广告）不重置计数，下次合格再试；
 * 其余（completed / failed / dismissed）重置，避免连续插屏。
 */
export function markInterstitialShown(res: { status: string }): void {
  if (res.status === 'no_fill') return;
  state = { battlesSinceLast: 0 };
  saveState(state);
}

/** 重置频控（DEV / 测试 / Reset Progress 时调用） */
export function resetAdFrequency(): void {
  state = { battlesSinceLast: 0 };
  saveState(state);
}

// —— 测试辅助（仅内存态，便于单测不依赖 localStorage） ——
export function _setStateForTest(s: AdFreqState): void {
  state = { ...s };
  saveState(state);
}
export function _getStateForTest(): AdFreqState {
  return { ...state };
}
