/**
 * Q23｜V0.5 基础经济 MVP（金币）验收。
 * 覆盖：胜负金币正确 / 同场只结算一次 / 合成正确扣费 / 金币不足不可合成 / 刷新保持 / Q22 成长不退化。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyBattleResult,
  BattleProgressSettler,
  getProgress,
  saveProgress,
  canAffordMerge,
  mergeWithCost,
  MERGE_COST_COIN,
  COIN_WIN,
  COIN_LOSE,
  RATING_WIN,
  RATING_MIN,
  defaultProgress,
} from '../src/core/playerProgress';
import {
  defaultInventory,
  addPart,
  OFFICIAL_PARTS,
  getCount,
} from '../src/core/partInventory';

/** 内存版 localStorage（node 环境无原生） */
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

describe('Q23 A｜胜负金币与段位增量（纯函数）', () => {
  it('A1. 胜利 +100 金币 / +20 段位', () => {
    const after = applyBattleResult(defaultProgress(), true);
    expect(after.coin).toBe(COIN_WIN);
    expect(after.rating).toBe(RATING_WIN);
  });
  it('A2. 失败 +60 金币 / -10 段位（且最低不低于 0）', () => {
    const from0 = applyBattleResult(defaultProgress(), false);
    expect(from0.coin).toBe(COIN_LOSE);
    expect(from0.rating).toBe(0); // 0 - 10 被夹到 0
    const from50 = applyBattleResult({ coin: 0, rating: 50 }, false);
    expect(from50.rating).toBe(40); // 50 - 10
  });
  it('A3. 段位最低不低于 0（rating=5 失败 → 0，不出现负数）', () => {
    const after = applyBattleResult({ coin: 0, rating: 5 }, false);
    expect(after.rating).toBe(RATING_MIN);
    expect(after.coin).toBe(COIN_LOSE);
  });
  it('A4. 累积：胜→胜 → coin 200 / rating 40', () => {
    const a = applyBattleResult(defaultProgress(), true);
    const b = applyBattleResult(a, true);
    expect(b.coin).toBe(200);
    expect(b.rating).toBe(40);
  });
});

describe('Q23 B｜进度结算器只结算一次（幂等）', () => {
  it('B1. 同 result 引用重复结算：coin 只 +100 一次', () => {
    const s = new BattleProgressSettler();
    const ref = { tag: 'battle-1' };
    const r1 = s.settle(ref, true);
    const r2 = s.settle(ref, true);
    expect(r1).not.toBeNull();
    expect(r1!.coinDelta).toBe(COIN_WIN);
    expect(r1!.progress.coin).toBe(100);
    // 第二次同场：返回缓存，coin 仍为 100（未叠加为 200）
    expect(r2).toBe(r1);
    expect(getProgress().coin).toBe(100);
  });
  it('B2. 不同 result 引用：各自结算并叠加', () => {
    const s = new BattleProgressSettler();
    s.settle({ a: 1 }, true); // +100
    s.settle({ b: 2 }, false); // +60
    expect(getProgress().coin).toBe(160);
  });
  it('B3. reset 仅清幂等键、不回滚进度：新一场在已持久化进度上继续累加', () => {
    const s = new BattleProgressSettler();
    s.settle({ a: 1 }, true); // +100 → 持久化 100
    expect(getProgress().coin).toBe(100);
    s.reset();
    const r = s.settle({ c: 3 }, true); // 读持久化 100，+100 → 200
    expect(r!.progress.coin).toBe(200);
  });
});

describe('Q23 C｜5合1 金币消耗', () => {
  it('C1. canAffordMerge：>=500 可 / <500 不可', () => {
    expect(canAffordMerge(MERGE_COST_COIN)).toBe(true);
    expect(canAffordMerge(MERGE_COST_COIN - 1)).toBe(false);
    expect(canAffordMerge(0)).toBe(false);
  });
  it('C2. 金币不足：不合成、不扣费、不消耗部件', () => {
    const inv = defaultInventory();
    addPart(inv, 'cannon', 1, 4); // 足够副本
    const before = getCount(inv, 'cannon', 1);
    const res = mergeWithCost(inv, [], MERGE_COST_COIN - 1);
    expect(res.ok).toBe(false);
    expect(res.coin).toBe(MERGE_COST_COIN - 1); // 未扣费
    expect(getCount(inv, 'cannon', 1)).toBe(before); // 未消耗
  });
  it('C3. 副本不足（金币充足）：不合成、不扣费', () => {
    const inv = defaultInventory();
    for (const p of OFFICIAL_PARTS) inv[p].one = 0; // 清零
    addPart(inv, 'laser', 1, 4); // 仅 4 个 < 5
    const res = mergeWithCost(inv, [], MERGE_COST_COIN);
    expect(res.ok).toBe(false);
    expect(res.coin).toBe(MERGE_COST_COIN); // 未扣费
  });
  it('C4. 副本充足 + 金币充足：合成成功、扣 500、消耗 5 个 1★', () => {
    const inv = defaultInventory();
    addPart(inv, 'cannon', 1, 4); // cannon 1+4=5
    const res = mergeWithCost(inv, [], MERGE_COST_COIN);
    expect(res.ok).toBe(true);
    expect(res.coin).toBe(0); // 500 - 500
    // 5 个 1★ 被消耗（cannon 1 起 +4 = 5，全扣）
    expect(getCount(inv, 'cannon', 1)).toBe(0);
    // 产出 1 个 2★
    const twoTotal = OFFICIAL_PARTS.reduce((s, p) => s + inv[p].two, 0);
    expect(twoTotal).toBe(1);
  });
});

describe('Q23 D｜持久化：刷新保持', () => {
  it('D1. save → get 往返一致（金币 / 段位）', () => {
    saveProgress({ coin: 1234, rating: 256 });
    const p = getProgress();
    expect(p.coin).toBe(1234);
    expect(p.rating).toBe(256);
  });
  it('D2. 无存档回退默认（0/0）', () => {
    const p = getProgress();
    expect(p.coin).toBe(0);
    expect(p.rating).toBe(0);
  });
});

describe('Q23 E｜Q22 成长流程不退化', () => {
  it('E1. 合成产物仍为正式 2★ 部件（无 HOLD / EMPTY / prototype）', () => {
    const inv = defaultInventory();
    addPart(inv, 'cannon', 1, 4);
    const res = mergeWithCost(inv, [], MERGE_COST_COIN);
    expect(res.ok).toBe(true);
    const product = OFFICIAL_PARTS.find((p) => inv[p].two > 0)!;
    expect(product).toBeTruthy();
    expect(OFFICIAL_PARTS).toContain(product);
  });
});
