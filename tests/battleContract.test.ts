/**
 * Queue F-02M-B14A｜引擎中立 Battle 合同与结果解析测试
 *
 * 覆盖：
 * 1. Active/Warning/Closing 健康状态均不结束（null）；
 * 2. phase End 下 A 胜、B 胜、平局；
 * 3. 战斗中 A 死亡、B 死亡、双方同时死亡；
 * 4. 数值与当前 Matter detectEnd() 完全一致（hpA/hpB/winner/phase 逐字段断言）。
 */
import { describe, it, expect } from 'vitest';
import { resolveBattleResult } from '../src/battle/battleContract';

describe('F-02M-B14A · 1. 非 End 健康状态不结束', () => {
  it('Active/Warning/Closing 且双方 HP>0 → null', () => {
    expect(resolveBattleResult('Active', 1000, 1000)).toBeNull();
    expect(resolveBattleResult('Warning', 500, 800)).toBeNull();
    expect(resolveBattleResult('Closing', 1, 1)).toBeNull();
    // 边界：HP 恰为 1（存活）也不结束
    expect(resolveBattleResult('Closing', 1, 999)).toBeNull();
  });
});

describe('F-02M-B14A · 2. End 阶段按剩余 HP 判定', () => {
  it('A 胜：End 下 hpA > hpB，HP 原值保留', () => {
    const r = resolveBattleResult('End', 500, 300)!;
    expect(r).not.toBeNull();
    expect(r.winner).toBe('A');
    expect(r.hpA).toBe(500);
    expect(r.hpB).toBe(300);
    expect(r.phase).toBe('End');
  });

  it('B 胜：End 下 hpB > hpA，HP 原值保留', () => {
    const r = resolveBattleResult('End', 100, 200)!;
    expect(r.winner).toBe('B');
    expect(r.hpA).toBe(100);
    expect(r.hpB).toBe(200);
    expect(r.phase).toBe('End');
  });

  it('平局：End 下 hpA === hpB', () => {
    const r = resolveBattleResult('End', 400, 400)!;
    expect(r.winner).toBe('draw');
    expect(r.hpA).toBe(400);
    expect(r.hpB).toBe(400);
    expect(r.phase).toBe('End');
  });
});

describe('F-02M-B14A · 3. 战斗中死亡判定', () => {
  it('A 死亡 → B 胜（hpA 归 0、hpB 原值、phase End）', () => {
    const r = resolveBattleResult('Active', 0, 800)!;
    expect(r.winner).toBe('B');
    expect(r.hpA).toBe(0);
    expect(r.hpB).toBe(800);
    expect(r.phase).toBe('End');
    // 负数 HP（过量伤害）同样按死亡处理
    const rn = resolveBattleResult('Closing', -5, 800)!;
    expect(rn.winner).toBe('B');
    expect(rn.hpA).toBe(0);
    expect(rn.hpB).toBe(800);
  });

  it('B 死亡 → A 胜（hpA 原值、hpB 归 0、phase End）', () => {
    const r = resolveBattleResult('Warning', 900, 0)!;
    expect(r.winner).toBe('A');
    expect(r.hpA).toBe(900);
    expect(r.hpB).toBe(0);
    expect(r.phase).toBe('End');
  });

  it('双方同时死亡 → draw（HP 均 0、phase End）', () => {
    const r = resolveBattleResult('Active', 0, 0)!;
    expect(r.winner).toBe('draw');
    expect(r.hpA).toBe(0);
    expect(r.hpB).toBe(0);
    expect(r.phase).toBe('End');
    // 双方均负数同样平局
    const rn = resolveBattleResult('Closing', -10, -10)!;
    expect(rn.winner).toBe('draw');
    expect(rn.hpA).toBe(0);
    expect(rn.hpB).toBe(0);
  });
});
