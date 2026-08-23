/**
 * Q30｜V0.8 IAA 广告 MVP（Platform Ads Adapter）。
 *
 * 设计约束（来自 Queue 冻结项 / 禁止项）：
 * - 业务层（main.ts / Gameplay）只依赖本模块的 `showRewardedAd` / `showInterstitialAd` /
 *   `RewardedAdClaimer` / `tryInterstitialSafe`，**绝不**直接调用任何平台 SDK（wx.* / 浏览器 SDK）；
 * - Web DEV：MockAdsAdapter，返回可配置结果（成功 / 失败 / 无填充均安全返回）；
 * - PROD：若有平台 adapter（`setPlatformAdsAdapter` 注入，Q29 平台层）则转发，
 *   否则 NoopAdsAdapter（视为无填充 → 主流程照常继续，绝不卡死）；
 * - 强制广告才能继续 / 战斗中插屏 / 连续插屏 / 广告失败卡死 / 复杂商业化框架 / 改 Gameplay 数值：
 *   全部在本模块与调用方共同规避；
 * - 不引入任何第三方 dependency。
 */

/** 广告结果状态（平台侧统一语义，业务层只消费这四种） */
export type AdStatus = 'completed' | 'failed' | 'no_fill' | 'dismissed';

export interface AdResult {
  /** completed = 完整观看成功（Rewarded 才可发奖）；其余均不发奖 */
  status: AdStatus;
}

/** 平台广告适配接口：所有平台（微信 / 浏览器占位 / 测试 mock）实现同一契约 */
export interface AdsAdapter {
  /** Rewarded：完整观看后平台侧成功回调 */
  showRewarded(): Promise<AdResult>;
  /** Interstitial：完整 Battle 后的安全节点 */
  showInterstitial(): Promise<AdResult>;
}

/** DEV 本地 mock：默认成功，可配置为任意结果（用于测试 / 本地观察） */
class MockAdsAdapter implements AdsAdapter {
  constructor(private next: AdResult = { status: 'completed' }) {}
  async showRewarded(): Promise<AdResult> {
    return this.next;
  }
  async showInterstitial(): Promise<AdResult> {
    return this.next;
  }
}

/** PROD 无平台 adapter：安全 no-op（视为无填充 → 主流程照常继续，不卡死） */
class NoopAdsAdapter implements AdsAdapter {
  async showRewarded(): Promise<AdResult> {
    return { status: 'no_fill' };
  }
  async showInterstitial(): Promise<AdResult> {
    return { status: 'no_fill' };
  }
}

let platformAdapter: AdsAdapter | null = null;
/** PROD 平台注入点（Q29 平台层）：微信等目标平台在此挂入真实 adapter */
export function setPlatformAdsAdapter(a: AdsAdapter | null): void {
  platformAdapter = a;
}

let forcedMode: 'dev' | 'prod' | null = null;
/** 测试可强制模式，避免依赖 import.meta.env */
export function setAdsMode(m: 'dev' | 'prod' | null): void {
  forcedMode = m;
}
export function isAdsDev(): boolean {
  if (forcedMode) return forcedMode === 'dev';
  try {
    // Vite 注入：import.meta.env.DEV 在非生产构建为 true。
    return (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true;
  } catch {
    return false;
  }
}

/** DEV mock 下一条返回结果（测试可调） */
let mockResult: AdResult = { status: 'completed' };
export function setMockAdResult(r: AdResult): void {
  mockResult = r;
}

function activeAdapter(): AdsAdapter {
  if (!isAdsDev() && platformAdapter) return platformAdapter; // PROD + 平台 adapter
  if (isAdsDev()) return new MockAdsAdapter(mockResult); // DEV mock
  return new NoopAdsAdapter(); // PROD 无 adapter → 安全 no-op
}

/** 是否有 Rewarded 广告可用：DEV（mock）恒可用；PROD 仅在有平台 adapter 时可用（无广告环境不显示按钮） */
export function isRewardedAdAvailable(): boolean {
  return isAdsDev() ? true : platformAdapter != null;
}

/** 是否有 Interstitial 广告可用（同 Rewarded 口径） */
export function isInterstitialAdAvailable(): boolean {
  return isAdsDev() ? true : platformAdapter != null;
}

/** Rewarded：完整观看后平台侧结果 */
export function showRewardedAd(): Promise<AdResult> {
  return activeAdapter().showRewarded();
}

/** Interstitial：完整 Battle 后的安全节点 */
export function showInterstitialAd(): Promise<AdResult> {
  return activeAdapter().showInterstitial();
}

/** IAA 激励金币（唯一新增金币来源，独立于 Battle / 合成；非 Gameplay 数值） */
export const REWARD_AD_COIN_BONUS = 50;

import { addCoins } from './playerProgress';
import { track } from './analytics';

/**
 * Rewarded 发奖器：以「本场 result 引用」为幂等键（调用方在每场 Result 显示时 reset），
 * 保证同一场只发一次额外奖励——满足「不重复发奖励」。
 * 仅 `completed` 发奖；failed / dismissed / no_fill 均不发，且允许玩家重试（不锁定）。
 */
export class RewardedAdClaimer {
  private claimed = false;

  /** 每场新的 Result 显示前调用，重置发奖锁 */
  reset(): void {
    this.claimed = false;
  }

  /**
   * 尝试领取额外奖励。
   * @returns granted=true 且仅当「未发过 + 广告 completed」；coinAfter 为发奖后最新金币。
   */
  async claim(): Promise<{ granted: boolean; coinAfter?: number }> {
    if (this.claimed) return { granted: false }; // 已发过 → 直接拒绝，绝不再发
    let res: AdResult;
    try {
      res = await showRewardedAd();
    } catch {
      return { granted: false }; // 任何异常都不发奖、不卡死
    }
    if (res.status !== 'completed') return { granted: false }; // 关闭 / 失败 / 无填充：不发
    this.claimed = true;
    const after = addCoins(REWARD_AD_COIN_BONUS);
    track('reward_gain', { source: 'ad', coin: REWARD_AD_COIN_BONUS });
    return { granted: true, coinAfter: after.coin };
  }
}

/**
 * 「下一场」安全节点的插屏编排：可用且合格才展示；任何结果（含异常）都**不阻塞** proceed。
 * 满足：不卡住 Result / Garage / 下一场；广告失败立即继续原流程；连续插屏由频控层规避。
 */
export async function tryInterstitialSafe(proceed: () => void): Promise<void> {
  if (!isInterstitialAdAvailable() || !isInterstitialEligible()) {
    proceed();
    return;
  }
  try {
    const res = await showInterstitialAd();
    markInterstitialShown(res);
  } catch {
    // 异常不阻塞主流程
  }
  proceed();
}

// —— 频控依赖（避免循环 import，放在文件末尾引用） ——
import {
  isInterstitialEligible,
  markInterstitialShown,
} from './adFrequency';
