/**
 * Q28｜V0.7 基础事件埋点接口 — targeted tests。
 * 覆盖验收 5 条：
 *  1. 一次完整主循环可产生正确事件序列（source-level 守卫 + 模块级序列模拟）
 *  2. Result 相关事件不重复（battleEndGuard 去重）
 *  3. 核心 payload 字段存在（battle_end / build_change / reward_gain / rank_change）
 *  4. DEV/PROD sink 行为安全（DEV 记录+console；PROD no-op；adapter 可接管）
 *  5. 原玩法不受影响（本文件不触碰玩法；运行时不触发 DOM，仅验证接口契约）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  track,
  battleEndGuard,
  memorySink,
  setAnalyticsMode,
  setPlatformAdapter,
  isAnalyticsDev,
  type AnalyticsSink,
} from '../src/core/analytics';

const MAIN = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');

beforeEach(() => {
  setAnalyticsMode('dev'); // 默认 DEV：记录 + console
  memorySink.clear();
  battleEndGuard.clear();
  setPlatformAdapter(null);
});

afterEach(() => {
  setPlatformAdapter(null);
  setAnalyticsMode(null);
  memorySink.clear();
  battleEndGuard.clear();
});

describe('A. DEV/PROD sink 行为安全（验收 4）', () => {
  it('A1. DEV 模式：track 落入 memorySink 且字段正确', () => {
    track('garage_enter');
    expect(memorySink.events).toHaveLength(1);
    expect(memorySink.events[0].event).toBe('garage_enter');
    expect(typeof memorySink.events[0].t).toBe('number');
  });

  it('A2. DEV 模式：同时走 console sink（用 spy 验证不抛错且被调用）', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    track('find_opponent', { x: 1 });
    expect(spy).toHaveBeenCalled();
    expect(String(spy.mock.calls[0][0])).toContain('find_opponent');
    spy.mockRestore();
  });

  it('A3. PROD 模式：track 为 no-op（不记录、不抛错）', () => {
    setAnalyticsMode('prod');
    expect(isAnalyticsDev()).toBe(false);
    expect(() => track('battle_start', { opponentTier: 'easy' })).not.toThrow();
    expect(memorySink.events).toHaveLength(0);
  });

  it('A4. PROD + platform adapter：转发到 adapter，不清空存档', () => {
    const adapter: AnalyticsSink = { emit: vi.fn() };
    setAnalyticsMode('prod');
    setPlatformAdapter(adapter);
    track('merge_success', {});
    expect(adapter.emit).toHaveBeenCalledTimes(1);
    expect(memorySink.events).toHaveLength(0); // PROD 默认内存 sink 不收
  });
});

describe('B. payload 最小化与清洗（验收 3 / 禁止项）', () => {
  it('B1. 函数型字段被剔除（防内部引用泄露），其余保留', () => {
    track('build_change', {
      slot: 'front',
      oldPart: 'pushRod',
      newPart: 'cannon',
      drive: 'forward',
      body: 'watermelon',
      // 模拟意外传入函数（不应出现）
      cb: () => 1,
    });
    const p = memorySink.events[0].payload;
    expect(p.cb).toBeUndefined();
    expect(p.slot).toBe('front');
    expect(p.body).toBe('watermelon');
  });

  it('B2. 不含任何隐私/完整存档字段（仅平铺标量与小对象）', () => {
    track('reward_gain', { coinDelta: 100, ratingDelta: 20, part: 'laser', star: 1 });
    const p = memorySink.events[0].payload;
    expect(Object.keys(p)).toEqual(['coinDelta', 'ratingDelta', 'part', 'star']);
  });
});

describe('C. battle_end / reward_gain 去重器（验收 2）', () => {
  it('C1. 同一 result 引用只放行一次', () => {
    const r = { winner: 'A' as const, hpA: 1, hpB: 0 };
    expect(battleEndGuard.firstTime(r)).toBe(true);
    expect(battleEndGuard.firstTime(r)).toBe(false);
    expect(battleEndGuard.firstTime(r)).toBe(false);
  });

  it('C2. 不同 result 引用各自放行', () => {
    const r1 = { winner: 'A' as const, hpA: 1, hpB: 0 };
    const r2 = { winner: 'B' as const, hpA: 0, hpB: 1 };
    expect(battleEndGuard.firstTime(r1)).toBe(true);
    expect(battleEndGuard.firstTime(r2)).toBe(true);
    expect(battleEndGuard.firstTime(r1)).toBe(false);
  });

  it('C3. clear() 重置去重状态（每场开战前调用）', () => {
    const r = { winner: 'A' as const, hpA: 1, hpB: 0 };
    expect(battleEndGuard.firstTime(r)).toBe(true);
    battleEndGuard.clear();
    expect(battleEndGuard.firstTime(r)).toBe(true); // 重置后可再次放行（新一场）
  });
});

describe('D. 核心 payload 字段存在（验收 3）', () => {
  it('D1. battle_end 至少含 result/duration/playerRating/opponentTier', () => {
    track('battle_end', {
      result: 'win',
      duration: 12.3,
      playerRating: 0,
      opponentTier: 'easy',
    });
    const p = memorySink.events[0].payload;
    expect(p.result).toBe('win');
    expect(p.duration).toBe(12.3);
    expect(p.playerRating).toBe(0);
    expect(p.opponentTier).toBe('easy');
  });

  it('D2. build_change 至少含 slot/oldPart/newPart/drive/body', () => {
    track('build_change', {
      slot: 'top',
      oldPart: 'EMPTY',
      newPart: 'hammer',
      drive: 'forward',
      body: 'watermelon',
    });
    const p = memorySink.events[0].payload;
    expect(p.slot).toBe('top');
    expect(p.oldPart).toBe('EMPTY');
    expect(p.newPart).toBe('hammer');
    expect(p.drive).toBe('forward');
    expect(p.body).toBe('watermelon');
  });

  it('D3. reward_gain 含 coinDelta/ratingDelta/part', () => {
    track('reward_gain', { coinDelta: 100, ratingDelta: 20, part: 'laser', star: 1 });
    const p = memorySink.events[0].payload;
    expect(p.coinDelta).toBe(100);
    expect(p.ratingDelta).toBe(20);
    expect(p.part).toBe('laser');
  });

  it('D4. rank_change 含 from/to/delta/tier', () => {
    track('rank_change', { from: 0, to: 20, delta: 20, tier: '青铜' });
    const p = memorySink.events[0].payload;
    expect(p.from).toBe(0);
    expect(p.to).toBe(20);
    expect(p.delta).toBe(20);
    expect(p.tier).toBe('青铜');
  });
});

describe('E. Result 轮询去重（验收 2：模拟每帧 poll）', () => {
  it('E1. 同一 result 被 showResultModal 多次调用 → battle_end/reward_gain 仅触发一次', () => {
    // 模拟 main.ts：每帧 pollBattleResult 都调 showResultModal(r)，用 battleEndGuard 守护
    const r = { winner: 'A' as const, hpA: 50, hpB: 0 };
    const fire = () => {
      if (battleEndGuard.firstTime(r)) {
        track('battle_end', { result: 'win', duration: 10, playerRating: 20, opponentTier: 'easy' });
        track('reward_gain', { coinDelta: 100, ratingDelta: 20, part: 'laser', star: 1 });
      }
    };
    for (let i = 0; i < 6; i++) fire(); // 模拟 6 帧轮询
    const battleEnds = memorySink.events.filter((e) => e.event === 'battle_end');
    const rewardGains = memorySink.events.filter((e) => e.event === 'reward_gain');
    expect(battleEnds).toHaveLength(1);
    expect(rewardGains).toHaveLength(1);
  });

  it('E2. 新一场（clear 后）新 result → 再次各触发一次', () => {
    const r1 = { winner: 'A' as const, hpA: 50, hpB: 0 };
    if (battleEndGuard.firstTime(r1)) {
      track('battle_end', { result: 'win', duration: 10, playerRating: 20, opponentTier: 'easy' });
    }
    battleEndGuard.clear(); // 下一架开战前
    const r2 = { winner: 'B' as const, hpA: 0, hpB: 30 };
    if (battleEndGuard.firstTime(r2)) {
      track('battle_end', { result: 'lose', duration: 8, playerRating: 20, opponentTier: 'normal' });
    }
    const battleEnds = memorySink.events.filter((e) => e.event === 'battle_end');
    expect(battleEnds).toHaveLength(2);
    expect(battleEnds[0].payload.result).toBe('win');
    expect(battleEnds[1].payload.result).toBe('lose');
  });
});

describe('F. 完整主循环事件序列（验收 1：source-level 守卫全部 11 个埋点点位）', () => {
  const REQUIRED_EVENTS: Array<[string, string]> = [
    ['game_start', "启动"],
    ['garage_enter', "进入 Garage（setMode / adjustConfig 两处）"],
    ['build_change', "Build 变更"],
    ['find_opponent', "寻找对手"],
    ['battle_start', "开战"],
    ['battle_end', "战斗结束"],
    ['reward_gain', "获得奖励"],
    ['part_equip', "装备部件"],
    ['merge_attempt', "发起合成"],
    ['merge_success', "合成成功"],
    ['rank_change', "段位变化"],
  ];

  for (const [ev, label] of REQUIRED_EVENTS) {
    it(`F. ${ev} — 点位存在（${label}）`, () => {
      expect(MAIN).toContain(`track('${ev}'`);
    });
  }

  it('F. garage_enter 在闭环与进入两处均触发', () => {
    const count = (MAIN.match(/track\('garage_enter'\)/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it('F. battle_end/reward_gain 经 battleEndGuard 去重（与开战 clear 配合）', () => {
    expect(MAIN).toContain('battleEndGuard.firstTime(r)');
    expect(MAIN).toContain('battleEndGuard.clear()');
  });

  it('F. build_change 经 emitBuildChange 统一出口，且带 slot/oldPart/newPart/drive/body', () => {
    expect(MAIN).toContain("track('build_change', { slot, oldPart, newPart, drive, body })");
  });

  it('F. battle_end payload 含 result/duration/playerRating/opponentTier', () => {
    expect(MAIN).toContain("result: isWin ? 'win' : 'lose'");
    expect(MAIN).toContain('playerRating');
    expect(MAIN).toContain('opponentTier: OPPONENT_TIERS[matchedIndex]');
  });

  it('F. 业务层不依赖具体平台 SDK（仅 import 本模块 track/battleEndGuard）', () => {
    // 不应出现第三方 analytics SDK 的 import（仅匹配 from '...' import 说明符）
    const thirdParty = /from\s+['"](amplitude|mixpanel|segment|posthog|google-analytics|@amplitude|@segment|@posthog)['"]/i;
    expect(MAIN).not.toMatch(thirdParty);
    expect(MAIN).toContain("import { track, battleEndGuard } from './core/analytics'");
  });
});
