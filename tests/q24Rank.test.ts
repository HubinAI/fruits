/**
 * Q24｜V0.6 段位进度 MVP（rating）验收。
 * 覆盖：段位边界正确 / 胜负正确改变 rating / 跨段位正确更新 / 持久化保持 / 结算产出 rating 变化。
 * 注：Result/Garage 的「段位+rating」展示由 DOM 渲染，已接 tierOf + BattleProgressSettler，
 *     无新增确认页 / 额外点击（nextMatch 复用 startMatching 一键匹配）。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyBattleResult,
  tierOf,
  TIER_LABEL,
  BattleProgressSettler,
  saveProgress,
  getProgress,
  RATING_WIN,
  defaultProgress,
} from '../src/core/playerProgress';

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v));
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  clear(): void {
    this.m.clear();
  }
  key(i: number): string | null {
    return [...this.m.keys()][i] ?? null;
  }
  get length(): number {
    return this.m.size;
  }
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();
});

describe('Q24 A｜段位边界', () => {
  it('A1. 0–99 青铜', () => {
    expect(tierOf(0)).toBe('bronze');
    expect(tierOf(99)).toBe('bronze');
  });
  it('A2. 100–199 白银', () => {
    expect(tierOf(100)).toBe('silver');
    expect(tierOf(199)).toBe('silver');
  });
  it('A3. 200–299 黄金', () => {
    expect(tierOf(200)).toBe('gold');
    expect(tierOf(299)).toBe('gold');
  });
  it('A4. 300+ 钻石', () => {
    expect(tierOf(300)).toBe('diamond');
    expect(tierOf(500)).toBe('diamond');
  });
  it('A5. 标签映射完整', () => {
    expect(TIER_LABEL.bronze).toBe('青铜');
    expect(TIER_LABEL.silver).toBe('白银');
    expect(TIER_LABEL.gold).toBe('黄金');
    expect(TIER_LABEL.diamond).toBe('钻石');
  });
});

describe('Q24 B｜胜负改变 rating + 跨段位', () => {
  it('B1. 胜 +20 / 负 -10', () => {
    expect(applyBattleResult(defaultProgress(), true).rating).toBe(RATING_WIN);
    expect(applyBattleResult({ coin: 0, rating: 50 }, false).rating).toBe(40); // 50 - 10
  });
  it('B2. 99 → 胜 → 119：跨入白银', () => {
    const a = applyBattleResult({ coin: 0, rating: 99 }, true);
    expect(a.rating).toBe(119);
    expect(tierOf(a.rating)).toBe('silver');
  });
  it('B3. 199 → 胜 → 219：跨入黄金', () => {
    const a = applyBattleResult({ coin: 0, rating: 199 }, true);
    expect(a.rating).toBe(219);
    expect(tierOf(a.rating)).toBe('gold');
  });
  it('B4. 299 → 胜 → 319：跨入钻石', () => {
    const a = applyBattleResult({ coin: 0, rating: 299 }, true);
    expect(a.rating).toBe(319);
    expect(tierOf(a.rating)).toBe('diamond');
  });
  it('B5. 105 → 负 → 95：跌回青铜（不细分小段）', () => {
    const a = applyBattleResult({ coin: 0, rating: 105 }, false);
    expect(a.rating).toBe(95);
    expect(tierOf(a.rating)).toBe('bronze');
  });
  it('B6. rating 最低 0（0 → 负 → 0）', () => {
    const a = applyBattleResult({ coin: 0, rating: 0 }, false);
    expect(a.rating).toBe(0);
    expect(tierOf(a.rating)).toBe('bronze');
  });
});

describe('Q24 C｜结算器产出 rating 变化', () => {
  it('C1. settle 返回 ratingDelta 与最终 rating', () => {
    const s = new BattleProgressSettler();
    const r = s.settle({ b: 1 }, true);
    expect(r).not.toBeNull();
    expect(r!.ratingDelta).toBe(RATING_WIN);
    expect(r!.progress.rating).toBe(20);
    expect(tierOf(r!.progress.rating)).toBe('bronze');
  });
  it('C2. 跨段位后 tier 正确反映在新 rating 上', () => {
    const s = new BattleProgressSettler();
    // 从 95 起，连胜 3 次：95 → 115 → 135 → 155（青铜 → 白银）
    saveProgress({ coin: 0, rating: 95 });
    s.settle({ b: 1 }, true); // 115
    s.settle({ b: 2 }, true); // 135
    const r = s.settle({ b: 3 }, true); // 155
    expect(r!.progress.rating).toBe(155);
    expect(tierOf(r!.progress.rating)).toBe('silver');
  });
});

describe('Q24 D｜持久化保持', () => {
  it('D1. rating 刷新后保持', () => {
    saveProgress({ coin: 0, rating: 250 });
    const p = getProgress();
    expect(p.rating).toBe(250);
    expect(tierOf(p.rating)).toBe('gold');
  });
});
