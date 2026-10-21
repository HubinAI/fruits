/**
 * FRUITS-RANDOM-ADVENTURE-R1｜可复现种子 RNG（mulberry32）。
 *
 * 设计要点（验收 ①：同种子完全可复现）：
 *   - 同一 numeric seed ⇒ 同一事件序列、同一事件结果、同一事件顺序；
 *   - 与平台 / 时间 / Math.random 完全无关 ⇒ 任何人、任何机器、任何时刻用同一 seed 复现；
 *   - 字符串 seed 经 FNV-1a 哈希成 32bit 初值，方便用人类可读的 seed 文本。
 *
 * ⚠️ 本文件是**新增隔离模块**，不 import、不修改任何既有的 Run 冻结文件
 *   （runScript.ts / runPageState.ts 字节一致，现有 E2E 零回归）。
 */
export function hashStringSeed(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 把任意字符串/数字输入归一为 32bit 数值种子。 */
export function toSeed(input: string | number): number {
  if (typeof input === 'number' && Number.isFinite(input)) return input >>> 0;
  return hashStringSeed(String(input));
}

export class AdvRng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** 下一个浮点 [0,1)。 */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** 整数 [0, maxExclusive)。 */
  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  /** 从数组中等概率取一个元素。 */
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }

  /** 以概率 p 返回 true（p∈[0,1]）。 */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** 返回 [0,1) 上的浮点，用于按阈值分桶。 */
  unit(): number {
    return this.next();
  }
}
