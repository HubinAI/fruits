/**
 * Queue F-02M-B14A + W1-END-1｜引擎中立 Battle 合同与结果解析测试
 *
 * 覆盖（W1-END-1：正式战斗无平局）：
 * 1. Active/Warning/Closing 健康状态均不结束（null）；
 * 2. phase End 下 HP 高者胜（endReason='arenaEnd'）；End 同 HP → seed tie-break（无平局）；
 * 3. 战斗中单方死亡（endReason='hp'）；双方同时死亡 → seed tie-break（无平局）；
 * 4. 普通 HP 胜负不受 seed 影响；同 seed 重跑一致；不同 seed 可产生 A/B；
 * 5. hpA/hpB/winner/phase/endReason 逐字段断言（数值与 Matter detectEnd() 一致）。
 */
import { describe, it, expect } from 'vitest';
import { resolveBattleResult, deterministicTieBreak } from '../src/battle/battleContract';

describe('F-02M-B14A · 1. 非 End 健康状态不结束', () => {
  it('Active/Warning/Closing 且双方 HP>0 → null', () => {
    expect(resolveBattleResult('Active', 1000, 1000, 0)).toBeNull();
    expect(resolveBattleResult('Warning', 500, 800, 0)).toBeNull();
    expect(resolveBattleResult('Closing', 1, 1, 0)).toBeNull();
    // 边界：HP 恰为 1（存活）也不结束
    expect(resolveBattleResult('Closing', 1, 999, 0)).toBeNull();
  });
});

describe('F-02M-B14A · 2. End 阶段按剩余 HP 判定（无平局）', () => {
  it('A 胜：End 下 hpA > hpB，HP 原值保留，endReason=arenaEnd', () => {
    const r = resolveBattleResult('End', 500, 300, 0)!;
    expect(r).not.toBeNull();
    expect(r.winner).toBe('A');
    expect(r.hpA).toBe(500);
    expect(r.hpB).toBe(300);
    expect(r.phase).toBe('End');
    expect(r.endReason).toBe('arenaEnd');
  });

  it('B 胜：End 下 hpB > hpA，HP 原值保留，endReason=arenaEnd', () => {
    const r = resolveBattleResult('End', 100, 200, 0)!;
    expect(r.winner).toBe('B');
    expect(r.hpA).toBe(100);
    expect(r.hpB).toBe(200);
    expect(r.phase).toBe('End');
    expect(r.endReason).toBe('arenaEnd');
  });

  it('W1-END-1 无平局：End 下 hpA === hpB → deterministicTieBreak(seed)，HP 原值保留', () => {
    const seed = 12345;
    const expected = deterministicTieBreak(seed);
    const r = resolveBattleResult('End', 400, 400, seed)!;
    expect(r.winner).toBe(expected); // 'A' 或 'B'，绝无 'draw'
    expect(['A', 'B']).toContain(r.winner);
    expect(r.hpA).toBe(400);
    expect(r.hpB).toBe(400);
    expect(r.phase).toBe('End');
    expect(r.endReason).toBe('arenaEnd');
  });
});

describe('F-02M-B14A · 3. 战斗中死亡判定（无平局）', () => {
  it('A 死亡 → B 胜（hpA 归 0、hpB 原值、phase End、endReason=hp）', () => {
    const r = resolveBattleResult('Active', 0, 800, 0)!;
    expect(r.winner).toBe('B');
    expect(r.hpA).toBe(0);
    expect(r.hpB).toBe(800);
    expect(r.phase).toBe('End');
    expect(r.endReason).toBe('hp');
    // 负数 HP（过量伤害）同样按死亡处理
    const rn = resolveBattleResult('Closing', -5, 800, 0)!;
    expect(rn.winner).toBe('B');
    expect(rn.hpA).toBe(0);
    expect(rn.hpB).toBe(800);
    expect(rn.endReason).toBe('hp');
  });

  it('B 死亡 → A 胜（hpA 原值、hpB 归 0、phase End、endReason=hp）', () => {
    const r = resolveBattleResult('Warning', 900, 0, 0)!;
    expect(r.winner).toBe('A');
    expect(r.hpA).toBe(900);
    expect(r.hpB).toBe(0);
    expect(r.phase).toBe('End');
    expect(r.endReason).toBe('hp');
  });

  it('W1-END-1 无平局：双方同时死亡 → deterministicTieBreak(seed)（HP 均 0、phase End、endReason=hp）', () => {
    const seed = 987;
    const expected = deterministicTieBreak(seed);
    const r = resolveBattleResult('Active', 0, 0, seed)!;
    expect(r.winner).toBe(expected);
    expect(['A', 'B']).toContain(r.winner);
    expect(r.hpA).toBe(0);
    expect(r.hpB).toBe(0);
    expect(r.phase).toBe('End');
    expect(r.endReason).toBe('hp');
    // 双方均负数同样无平局
    const rn = resolveBattleResult('Closing', -10, -10, seed)!;
    expect(rn.winner).toBe(expected);
    expect(rn.hpA).toBe(0);
    expect(rn.hpB).toBe(0);
    expect(rn.endReason).toBe('hp');
  });
});

describe('W1-END-1 · 4. seed 语义（确定性 + 可产生 A/B + 普通胜负不受影响）', () => {
  it('同 seed 重跑赢家一致（双死 / End 同 HP）', () => {
    const seed = 42;
    const d1 = resolveBattleResult('Active', 0, 0, seed)!;
    const d2 = resolveBattleResult('Active', 0, 0, seed)!;
    expect(d1.winner).toBe(d2.winner);
    const e1 = resolveBattleResult('End', 500, 500, seed)!;
    const e2 = resolveBattleResult('End', 500, 500, seed)!;
    expect(e1.winner).toBe(e2.winner);
  });

  it('不同 seed 能产生 A/B 两种赢家', () => {
    const winners = new Set<string>();
    for (let s = 0; s < 256; s++) {
      winners.add(resolveBattleResult('Active', 0, 0, s)!.winner);
      if (winners.size === 2) break;
    }
    expect(winners.has('A')).toBe(true);
    expect(winners.has('B')).toBe(true);
  });

  it('普通 HP 胜负不受 seed 影响（不同 seed 同结果）', () => {
    expect(resolveBattleResult('End', 500, 300, 0)!.winner).toBe('A');
    expect(resolveBattleResult('End', 500, 300, 99999)!.winner).toBe('A');
    expect(resolveBattleResult('End', 100, 900, 0)!.winner).toBe('B');
    expect(resolveBattleResult('End', 100, 900, 99999)!.winner).toBe('B');
    expect(resolveBattleResult('Active', 0, 800, 0)!.winner).toBe('B');
    expect(resolveBattleResult('Active', 0, 800, 99999)!.winner).toBe('B');
    expect(resolveBattleResult('Warning', 700, 0, 0)!.winner).toBe('A');
    expect(resolveBattleResult('Warning', 700, 0, 99999)!.winner).toBe('A');
  });
});
