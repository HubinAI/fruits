/**
 * Q25｜V0.6 对手难度梯度验收。
 * 覆盖：36 套唯一 Tier / 每层足够变化 / 段位抽取分布符合配置 / 不连续重复同 Build / 全部 Validator 合法。
 */
import { describe, it, expect } from 'vitest';
import {
  OPPONENT_POOL,
  OPPONENT_TIERS,
  TIER_INDICES,
  pickOpponentForTier,
  type OpponentTier,
} from '../src/player/opponentPool';
import { buildSnapshotFromDraft, type BuildDraft } from '../src/lab/buildEditorModel';
import { validateSnapshot } from '../src/core/buildValidator';
import { registry } from '../src/core/content';
import type { Tier } from '../src/core/playerProgress';

/** 确定性 RNG（mulberry32），保证分布测试可复现 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TIERS: OpponentTier[] = ['easy', 'normal', 'hard'];

describe('Q25 A｜36 套全部属于唯一 Tier', () => {
  it('A1. 长度 = 36，每套唯一切仅属于一个 Tier', () => {
    expect(OPPONENT_TIERS.length).toBe(OPPONENT_POOL.length);
    for (const t of OPPONENT_TIERS) expect(TIERS).toContain(t);
  });
  it('A2. 三层索引互不重叠且并集 = 全部 36', () => {
    const all = [...TIER_INDICES.easy, ...TIER_INDICES.normal, ...TIER_INDICES.hard];
    expect(all.length).toBe(36);
    expect(new Set(all).size).toBe(36); // 无重叠
  });
});

describe('Q25 B｜每层都有足够 Build 变化', () => {
  it('B1. 每层 >= 6 套', () => {
    for (const t of TIERS) expect(TIER_INDICES[t].length).toBeGreaterThanOrEqual(6);
  });
  it('B2. 每层跨越 >= 2 种 Body（避免单一车型聚集）', () => {
    for (const t of TIERS) {
      const bodies = new Set(TIER_INDICES[t].map((i) => OPPONENT_POOL[i].bodyDefId));
      expect(bodies.size).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('Q25 C｜段位抽取分布符合配置', () => {
  const N = 4000;
  function sample(playerTier: Tier, seed: number): Record<OpponentTier, number> {
    const rng = mulberry32(seed);
    const counts: Record<OpponentTier, number> = { easy: 0, normal: 0, hard: 0 };
    let last = -1;
    for (let i = 0; i < N; i++) {
      const idx = pickOpponentForTier(playerTier, last, rng);
      counts[OPPONENT_TIERS[idx]]++;
      last = idx;
    }
    return counts;
  }
  function ratio(c: Record<OpponentTier, number>, t: OpponentTier): number {
    return c[t] / N;
  }
  it('C1. 青铜：Easy≈0.7 / Normal≈0.3 / 无 Hard', () => {
    const c = sample('bronze', 1);
    expect(ratio(c, 'easy')).toBeGreaterThan(0.63);
    expect(ratio(c, 'easy')).toBeLessThan(0.77);
    expect(ratio(c, 'normal')).toBeGreaterThan(0.23);
    expect(ratio(c, 'normal')).toBeLessThan(0.37);
    expect(c.hard).toBe(0);
  });
  it('C2. 白银：Easy≈0.3 / Normal≈0.6 / Hard≈0.1', () => {
    const c = sample('silver', 2);
    expect(ratio(c, 'easy')).toBeGreaterThan(0.24);
    expect(ratio(c, 'normal')).toBeGreaterThan(0.54);
    expect(ratio(c, 'hard')).toBeGreaterThan(0.05);
    expect(ratio(c, 'hard')).toBeLessThan(0.16);
  });
  it('C3. 黄金：Normal≈0.5 / Hard≈0.5 / 无 Easy', () => {
    const c = sample('gold', 3);
    expect(ratio(c, 'normal')).toBeGreaterThan(0.44);
    expect(ratio(c, 'normal')).toBeLessThan(0.56);
    expect(ratio(c, 'hard')).toBeGreaterThan(0.44);
    expect(ratio(c, 'hard')).toBeLessThan(0.56);
    expect(c.easy).toBe(0);
  });
  it('C4. 钻石：Normal≈0.2 / Hard≈0.8 / 无 Easy', () => {
    const c = sample('diamond', 4);
    expect(ratio(c, 'normal')).toBeGreaterThan(0.15);
    expect(ratio(c, 'normal')).toBeLessThan(0.26);
    expect(ratio(c, 'hard')).toBeGreaterThan(0.74);
    expect(c.easy).toBe(0);
  });
});

describe('Q25 D｜不连续重复同一 Build', () => {
  it('D1. 连续抽取中相邻两场 final 索引不同', () => {
    const rng = mulberry32(7);
    for (const tier of ['bronze', 'silver', 'gold', 'diamond'] as Tier[]) {
      let last = -1;
      for (let i = 0; i < 200; i++) {
        const idx = pickOpponentForTier(tier, last, rng);
        expect(idx).not.toBe(last); // 不连续重复
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(OPPONENT_POOL.length);
        last = idx;
      }
    }
  });
});

describe('Q25 E｜所有 Build 继续 Validator 合法', () => {
  it('E1. 36 套均可构建为合法 Snapshot（无 HOLD / 超载 / 非法槽）', () => {
    for (const d of OPPONENT_POOL) {
      const snap = buildSnapshotFromDraft(d as BuildDraft, registry, 'opp');
      const res = validateSnapshot(snap, registry);
      expect(res.valid, `build ${d.bodyDefId} invalid: ${res.errors.join('; ')}`).toBe(true);
    }
  });
});
