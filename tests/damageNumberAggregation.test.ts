/**
 * Queue F-PRESENT-1｜高频 Damage Number 聚合 targeted test
 *
 * 覆盖验收：
 * 1. 聚合器分组键 = target + source + (partId ?? behavior ?? damageSource)；
 * 2. 喷火器连续命中（窗口内）→ 合并为 1 组，累计 -8 → -16 → -24 → -32；
 * 3. 窗口以「该组首次命中时间」为起点，不无限延长（命中间隔超窗口 → 开新组）；
 * 4. 真实 damage 总量守恒（各组合计 = 全部真实 damage 之和）；
 * 5. 不同来源（不同 partId / behavior）→ 各自独立分组；
 * 6. Cannon 单发（独立组）→ 立即 isNewGroup=true，零延迟；
 * 7. Renderer：喷火器 4 连击 → 仅 1 个浮动数字（不再数字云），文本 -32，位置跟随最新 contactPoint；
 * 8. Renderer：机枪 7 发 burst（100ms 间隔）→ 仅形成少数（3 组）数字，不 7 个叠云；
 * 9. Renderer：Cannon 单发 → 立即 1 个数字；damage<=0 不显示「-0」。
 *
 * 设计边界（与禁改项一致）：
 * - 不改 Damage Resolver / HP / Weapon 参数 / hit flash / collision；
 * - 不新增 CombatEvent 字段；
 * - 聚合只重组「显示」，onDamageNumber 仍每个真实 damage event 各调用一次。
 */
import { describe, it, expect } from 'vitest';
import { DamageNumberAggregator } from '../src/presentation/damageNumberAggregator';
import { Renderer } from '../src/render/renderer';
import type { DamageEvent } from '../src/battle/combatEvents';

/* ---------------- 聚合器（纯逻辑，时间由 nowMs 注入） ---------------- */

function makeDamage(over: Partial<DamageEvent> = {}): DamageEvent {
  return {
    type: 'damage',
    source: 'A',
    target: 'B',
    damageSource: 'weapon',
    partId: 'flame-1',
    behavior: 'flamethrower',
    contactPoint: { x: 500, y: 600 },
    contactNormal: { x: 1, y: 0 },
    relativeVelocity: 3,
    damage: 8,
    hpBefore: 900,
    hpAfter: 892,
    timestamp: 1000,
    ...over,
  };
}

describe('F-PRESENT-1 DamageNumberAggregator', () => {
  it('1. 分组键 = target + source + (partId ?? behavior ?? damageSource)', () => {
    expect(DamageNumberAggregator.groupKey(makeDamage({ partId: 'p1', behavior: 'x' }))).toBe('B|A|p1');
    expect(
      DamageNumberAggregator.groupKey(makeDamage({ partId: undefined, behavior: 'x' })),
    ).toBe('B|A|x');
    expect(
      DamageNumberAggregator.groupKey(makeDamage({ partId: undefined, behavior: undefined, damageSource: 'hazard' })),
    ).toBe('B|A|hazard');
  });

  it('2. 喷火器连续命中（窗口内）→ 合并为 1 组，累计 -8→-16→-24→-32', () => {
    const agg = new DamageNumberAggregator(210);
    const times = [1000, 1033, 1066, 1099];
    const views = times.map((t) => agg.feed(makeDamage({ timestamp: t }), t));
    expect(views.map((v) => v.isNewGroup)).toEqual([true, false, false, false]);
    expect(views.map((v) => v.accumulatedDamage)).toEqual([8, 16, 24, 32]);
  });

  it('3. 窗口以首次命中为起点，不无限延长：间隔超窗口 → 开新组', () => {
    const agg = new DamageNumberAggregator(210);
    const v0 = agg.feed(makeDamage({ timestamp: 1000 }), 1000); // 组 A 起点
    const v1 = agg.feed(makeDamage({ timestamp: 1200 }), 1200); // 1200-1000=200 < 210 → 合并
    const v2 = agg.feed(makeDamage({ timestamp: 1400 }), 1400); // 1400-1000=400 > 210 → 新组 B
    expect(v0.isNewGroup).toBe(true);
    expect(v1.isNewGroup).toBe(false);
    expect(v2.isNewGroup).toBe(true);
    expect(v2.windowStart).toBe(1400); // 新组起点为本次命中，而非被 v1 延长
  });

  it('4. 真实 damage 总量守恒（Renderer）：分两组显示，合计 == 真实总量', () => {
    const r = makeRenderer();
    const orig = (globalThis.performance as { now: () => number }).now;
    let fakeNow = 1000;
    (globalThis.performance as { now: () => number }).now = () => fakeNow;
    try {
      const base = { partId: 'flame-1', behavior: 'flamethrower', damageSource: 'weapon' as const, damage: 8 };
      // 组 A：1000,1033（间隔<窗口）→ 合并为 -16
      r.spawnDamageNumberFromEvent(makeDamage({ ...base, timestamp: 1000 }));
      fakeNow = 1033;
      r.spawnDamageNumberFromEvent(makeDamage({ ...base, timestamp: 1033 }));
      // 间隔超窗口 → 组 B：1400,1433 → 合并为 -16
      fakeNow = 1400;
      r.spawnDamageNumberFromEvent(makeDamage({ ...base, timestamp: 1400 }));
      fakeNow = 1433;
      r.spawnDamageNumberFromEvent(makeDamage({ ...base, timestamp: 1433 }));
      const nums = r.activeDamageNumbers;
      expect(nums.length).toBe(2); // 两组，各自一个数字
      const total = nums.reduce((a, n) => a + Number(n.text.replace('-', '')), 0);
      expect(total).toBe(32); // == 8*4 真实总量（守恒）
    } finally {
      (globalThis.performance as { now: () => number }).now = orig;
    }
  });

  it('5. 不同来源 → 独立分组', () => {
    const agg = new DamageNumberAggregator(210);
    const a = agg.feed(makeDamage({ partId: 'flame-1', behavior: 'flamethrower', timestamp: 1000 }), 1000);
    const b = agg.feed(makeDamage({ partId: 'mg-1', behavior: 'machineGun', timestamp: 1010 }), 1010);
    expect(a.isNewGroup).toBe(true);
    expect(b.isNewGroup).toBe(true); // 不同 partId → 不同组
    expect(a.groupKey).not.toBe(b.groupKey);
  });

  it('6. Cannon 单发（独立组）→ 立即 isNewGroup=true，零延迟', () => {
    const agg = new DamageNumberAggregator(210);
    const v = agg.feed(
      makeDamage({ partId: 'cannon-1', behavior: 'cannon', damage: 80, timestamp: 5000 }),
      5000,
    );
    expect(v.isNewGroup).toBe(true);
    expect(v.accumulatedDamage).toBe(80);
  });
});

/* ---------------- Renderer 接入（Canvas stub，必要时 stub performance.now） ---------------- */

class CtxStub {
  calls: string[] = [];
  fillStyle = '';
  font = '';
  textAlign = '';
  record(_n: string): void {
    this.calls.push(_n);
  }
  setTransform(): void { this.record('setTransform'); }
  clearRect(): void { this.record('clearRect'); }
  fillRect(): void { this.record('fillRect'); }
  beginPath(): void { this.record('beginPath'); }
  moveTo(): void { this.record('moveTo'); }
  lineTo(): void { this.record('lineTo'); }
  closePath(): void { this.record('closePath'); }
  fill(): void { this.record('fill'); }
  stroke(): void { this.record('stroke'); }
  arc(): void { this.record('arc'); }
  fillText(): void { this.record('fillText'); }
}

function makeCanvas(ctx: CtxStub): HTMLCanvasElement {
  return {
    width: 0,
    height: 0,
    clientWidth: 1000,
    clientHeight: 500,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement;
}

function makeRenderer(): Renderer {
  return new Renderer(makeCanvas(new CtxStub()));
}

describe('F-PRESENT-1 Renderer 伤害数字聚合', () => {
  it('7. 喷火器 4 连击 → 仅 1 个浮动数字（消除数字云），文本 -32，位置跟随最新 contactPoint', () => {
    const r = makeRenderer();
    const base = { partId: 'flame-1', behavior: 'flamethrower', damageSource: 'weapon' as const };
    r.spawnDamageNumberFromEvent(makeDamage({ ...base, contactPoint: { x: 500, y: 600 }, damage: 8 }));
    r.spawnDamageNumberFromEvent(makeDamage({ ...base, contactPoint: { x: 502, y: 601 }, damage: 8 }));
    r.spawnDamageNumberFromEvent(makeDamage({ ...base, contactPoint: { x: 504, y: 602 }, damage: 8 }));
    r.spawnDamageNumberFromEvent(makeDamage({ ...base, contactPoint: { x: 506, y: 603 }, damage: 8 }));
    const nums = r.activeDamageNumbers;
    expect(nums.length).toBe(1); // 不再 4 个叠在一起
    expect(nums[0].text).toBe('-32');
    expect(nums[0].x).toBe(506); // 跟随最新 contactPoint
    expect(nums[0].y).toBe(603);
  });

  it('8. 机枪 7 发 burst（100ms 间隔）→ 渲染层硬限制 2 组（Must#2 以最终绘制数量为准），复用累加总量守恒', () => {
    const r = makeRenderer();
    // 用可控 performance.now：每发 +100ms（burst 总跨度 600ms）
    const orig = (globalThis.performance as { now: () => number }).now;
    let fakeNow = 2000;
    (globalThis.performance as { now: () => number }).now = () => fakeNow;
    try {
      const base = { partId: 'mg-1', behavior: 'machineGun', damageSource: 'weapon' as const, damage: 20 };
      for (let i = 0; i < 7; i++) {
        r.spawnDamageNumberFromEvent(makeDamage({ ...base, contactPoint: { x: 500 + i, y: 600 } }));
        fakeNow += 100;
      }
      const nums = r.activeDamageNumbers;
      // F-BATTLE-HIT-READABILITY-R1：聚合窗口(210ms) ≪ 数字 TTL(900ms) → 若不限渲染层，
      // 同车可见 900/210≈4 组；渲染层硬限制 ≤2 组（Must#2）。
      expect(nums.length).toBe(2);
      // 复用最旧组时累加显示：组 A 被第 3 窗口复用 → -60 + -20 = -80；组 B = -60
      const totals = nums.map((n) => Number(n.text.replace('-', ''))).sort((a, b) => a - b);
      expect(totals).toEqual([60, 80]);
      // 显示合计 == 真实总量 7×20=140（复用累加守恒）
      expect(totals[0] + totals[1]).toBe(140);
    } finally {
      (globalThis.performance as { now: () => number }).now = orig;
    }
  });

  it('9. Cannon 单发立即显示 1 个数字；damage<=0 不显示「-0」', () => {
    const r = makeRenderer();
    // Cannon 单发
    r.spawnDamageNumberFromEvent(
      makeDamage({ partId: 'cannon-1', behavior: 'cannon', damage: 80, contactPoint: { x: 510, y: 610 } }),
    );
    let nums = r.activeDamageNumbers;
    expect(nums.length).toBe(1);
    expect(nums[0].text).toBe('-80');

    // damage<=0：不应新增数字（Q08-C）
    r.spawnDamageNumberFromEvent(
      makeDamage({ partId: 'cannon-1', behavior: 'cannon', damage: 0, contactPoint: { x: 510, y: 610 } }),
    );
    nums = r.activeDamageNumbers;
    expect(nums.length).toBe(1); // 仍是上面那个，未新增「-0」
  });
});
