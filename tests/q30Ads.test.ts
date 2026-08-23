/**
 * Q30｜V0.8 IAA 广告 MVP —— 逻辑层测试（不依赖 DOM）。
 * 覆盖 5 条验收：
 * 1. Rewarded 成功 / 失败路径正确；
 * 2. 不重复发奖励；
 * 3. Interstitial 频控正确；
 * 4. 无广告环境仍可完整游戏；
 * 5. 广告失败 / 异常不阻塞主流程。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setAdsMode,
  setMockAdResult,
  setPlatformAdsAdapter,
  isRewardedAdAvailable,
  isInterstitialAdAvailable,
  RewardedAdClaimer,
  tryInterstitialSafe,
  REWARD_AD_COIN_BONUS,
  type AdsAdapter,
} from '../src/core/ads';
import {
  onBattleEnded,
  isInterstitialEligible,
  markInterstitialShown,
  resetAdFrequency,
  MIN_BATTLE_GAP,
} from '../src/core/adFrequency';

const THROWING_ADAPTER: AdsAdapter = {
  async showRewarded() {
    return { status: 'completed' };
  },
  async showInterstitial() {
    throw new Error('platform down');
  },
};

beforeEach(() => {
  // 默认 DEV + mock 成功，保证各测试起点一致
  setAdsMode('dev');
  setMockAdResult({ status: 'completed' });
  setPlatformAdsAdapter(null);
  resetAdFrequency();
});

afterEach(() => {
  setAdsMode(null);
  setPlatformAdsAdapter(null);
  resetAdFrequency();
});

describe('验收1：Rewarded 成功 / 失败路径', () => {
  it('completed → 发奖（granted=true，金币 +REWARD_AD_COIN_BONUS）', async () => {
    setMockAdResult({ status: 'completed' });
    const c = new RewardedAdClaimer();
    const out = await c.claim();
    expect(out.granted).toBe(true);
    expect(out.coinAfter).toBe(REWARD_AD_COIN_BONUS);
  });

  it('failed / dismissed / no_fill → 不发奖（granted=false，无 coinAfter）', async () => {
    for (const status of ['failed', 'dismissed', 'no_fill'] as const) {
      setMockAdResult({ status });
      const c = new RewardedAdClaimer();
      const out = await c.claim();
      expect(out.granted).toBe(false);
      expect(out.coinAfter).toBeUndefined();
    }
  });
});

describe('验收2：不重复发奖励', () => {
  it('同场第二次 claim 被拒；reset 后可再领', async () => {
    setMockAdResult({ status: 'completed' });
    const c = new RewardedAdClaimer();
    const first = await c.claim();
    expect(first.granted).toBe(true);
    const second = await c.claim(); // 已发过
    expect(second.granted).toBe(false);
    c.reset(); // 下一场
    const third = await c.claim();
    expect(third.granted).toBe(true);
  });

  it('失败不发奖也不锁定，允许重试直到成功', async () => {
    const c = new RewardedAdClaimer();
    setMockAdResult({ status: 'failed' });
    expect((await c.claim()).granted).toBe(false);
    setMockAdResult({ status: 'no_fill' });
    expect((await c.claim()).granted).toBe(false);
    setMockAdResult({ status: 'completed' });
    expect((await c.claim()).granted).toBe(true);
  });
});

describe('验收3：Interstitial 频控', () => {
  it('达到最小间隔（MIN_BATTLE_GAP 局）才合格；展示后重置', () => {
    expect(isInterstitialEligible()).toBe(false);
    for (let i = 0; i < MIN_BATTLE_GAP - 1; i++) {
      onBattleEnded();
      expect(isInterstitialEligible()).toBe(false);
    }
    onBattleEnded(); // 第 MIN_BATTLE_GAP 局
    expect(isInterstitialEligible()).toBe(true);
    markInterstitialShown({ status: 'completed' });
    expect(isInterstitialEligible()).toBe(false);
  });

  it('no_fill 不重置计数（平台无广告，下次合格再试）；completed/failed 重置避免连续', () => {
    for (let i = 0; i < MIN_BATTLE_GAP; i++) onBattleEnded();
    expect(isInterstitialEligible()).toBe(true);
    markInterstitialShown({ status: 'no_fill' });
    expect(isInterstitialEligible()).toBe(true); // 未重置
    markInterstitialShown({ status: 'failed' });
    expect(isInterstitialEligible()).toBe(false); // 重置，避免连续插屏
  });
});

describe('验收4：无广告环境仍可完整游戏', () => {
  it('PROD 无平台 adapter → 两类广告均不可用（UI 隐藏，不阻塞）', () => {
    setAdsMode('prod');
    setPlatformAdsAdapter(null);
    expect(isRewardedAdAvailable()).toBe(false);
    expect(isInterstitialAdAvailable()).toBe(false);
  });

  it('PROD 注入平台 adapter → 广告可用', () => {
    setAdsMode('prod');
    setPlatformAdsAdapter(THROWING_ADAPTER);
    expect(isRewardedAdAvailable()).toBe(true);
    expect(isInterstitialAdAvailable()).toBe(true);
  });

  it('DEV 环境（mock）广告恒可用', () => {
    setAdsMode('dev');
    expect(isRewardedAdAvailable()).toBe(true);
    expect(isInterstitialAdAvailable()).toBe(true);
  });
});

describe('验收5：广告失败 / 异常不阻塞主流程', () => {
  it('无填充：proceed 仍被调用一次', async () => {
    setMockAdResult({ status: 'no_fill' });
    for (let i = 0; i < MIN_BATTLE_GAP; i++) onBattleEnded();
    let proceeded = 0;
    await tryInterstitialSafe(() => {
      proceeded++;
    });
    expect(proceeded).toBe(1);
  });

  it('不合格（频控未到）也直接 proceed，不展示广告', async () => {
    resetAdFrequency(); // 0 局
    let proceeded = 0;
    await tryInterstitialSafe(() => {
      proceeded++;
    });
    expect(proceeded).toBe(1);
  });

  it('广告抛异常：catch 后仍 proceed（不卡死）', async () => {
    setAdsMode('prod');
    setPlatformAdsAdapter(THROWING_ADAPTER);
    for (let i = 0; i < MIN_BATTLE_GAP; i++) onBattleEnded();
    let proceeded = 0;
    await tryInterstitialSafe(() => {
      proceeded++;
    });
    expect(proceeded).toBe(1); // 异常未阻断主流程
  });

  it('成功后 proceed 且频控重置（不连续插屏）', async () => {
    setMockAdResult({ status: 'completed' });
    for (let i = 0; i < MIN_BATTLE_GAP; i++) onBattleEnded();
    let proceeded = 0;
    await tryInterstitialSafe(() => {
      proceeded++;
    });
    expect(proceeded).toBe(1);
    expect(isInterstitialEligible()).toBe(false); // 已重置
  });
});
