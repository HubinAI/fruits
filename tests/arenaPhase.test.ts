/**
 * Queue F-02M-B11A｜引擎中立 Arena 阶段时钟测试
 *
 * 覆盖：阶段边界（>= 判定）、完整顺序、单次不跨多阶段、End 稳定、
 * setPhase 清零。
 */
import { describe, it, expect } from 'vitest';
import { ArenaPhaseClock } from '../src/battle/arenaPhase';

describe('F-02M-B11A · ArenaPhaseClock 引擎中立阶段时钟', () => {
  it('初始为 Active、elapsed=0、默认时长 10s/3s/5s', () => {
    const clock = new ArenaPhaseClock();
    expect(clock.phase).toBe('Active');
    expect(clock.elapsedMs).toBe(0);
    expect(clock.durations).toEqual({ activeMs: 10_000, warningMs: 3_000, closingMs: 5_000 });
  });

  it('阶段边界：>= 判定（恰好到达即转换，差 1ms 不转换）', () => {
    const clock = new ArenaPhaseClock();
    // 差 1ms 未到
    const r0 = clock.update(9_999);
    expect(r0).toEqual({ previous: 'Active', current: 'Active', changed: false });
    expect(clock.elapsedMs).toBe(9_999);
    // 恰好到达边界 → 转换，elapsed 清零（不继承溢出）
    const r1 = clock.update(1);
    expect(r1).toEqual({ previous: 'Active', current: 'Warning', changed: true });
    expect(clock.elapsedMs).toBe(0);
  });

  it('完整顺序：Active → Warning → Closing → End', () => {
    const clock = new ArenaPhaseClock();
    clock.update(10_000); // → Warning
    expect(clock.phase).toBe('Warning');
    clock.update(3_000); // → Closing
    expect(clock.phase).toBe('Closing');
    clock.update(5_000); // → End
    expect(clock.phase).toBe('End');
    expect(clock.elapsedMs).toBe(0); // 转换后清零
  });

  it('单次 update 最多跨越一个阶段（超大 dt 不跳阶段）', () => {
    const clock = new ArenaPhaseClock();
    // 100000ms 远超 Active+Warning 总和，但一次只到 Warning
    const r = clock.update(100_000);
    expect(r).toEqual({ previous: 'Active', current: 'Warning', changed: true });
    expect(clock.phase).toBe('Warning');
    // 下一次超大 dt 也只到 Closing
    clock.update(100_000);
    expect(clock.phase).toBe('Closing');
    // 再一次到 End
    clock.update(100_000);
    expect(clock.phase).toBe('End');
  });

  it('End 后保持不变（update 不再推进）', () => {
    const clock = new ArenaPhaseClock();
    clock.update(10_000);
    clock.update(3_000);
    clock.update(5_000);
    expect(clock.phase).toBe('End');
    // End 后 update 不改变阶段、elapsed 不再增长
    const r = clock.update(1000);
    expect(r).toEqual({ previous: 'End', current: 'End', changed: false });
    expect(clock.phase).toBe('End');
    expect(clock.elapsedMs).toBe(0);
  });

  it('setPhase：只设置阶段并清零 elapsed，无物理副作用', () => {
    const clock = new ArenaPhaseClock();
    clock.update(500); // Active 推进中
    expect(clock.elapsedMs).toBe(500);
    clock.setPhase('Closing');
    expect(clock.phase).toBe('Closing');
    expect(clock.elapsedMs).toBe(0);
    // 从 Closing 继续推进：3000ms 内不转换
    clock.update(4_999);
    expect(clock.phase).toBe('Closing');
    clock.update(1); // ≥ closingMs → End
    expect(clock.phase).toBe('End');
    // 回到 Active 也可（Lab 调试语义）
    clock.setPhase('Active');
    expect(clock.phase).toBe('Active');
    expect(clock.elapsedMs).toBe(0);
  });
});
