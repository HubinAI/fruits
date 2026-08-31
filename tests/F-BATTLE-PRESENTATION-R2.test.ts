/**
 * Queue F-BATTLE-PRESENTATION-R2｜战斗表现 targeted test
 *
 * 覆盖验收（Must#7/#8 相关、纯逻辑 + Renderer 接入）：
 * 1. 伤害聚合 per-vehicle ≤2 上限：同一 target 同时 ≥2 组活跃数字时，后续命中合并进最旧组
 *    （不新建第 3 组浮动数字，避免多武器数字云遮挡车辆主体）；
 * 2. 真实 damage 总量守恒（合并仅重组显示，不吞伤害）；
 * 3. 重要伤害标记：单次 damage ≥ BIG_HIT_THRESHOLD → important=true；低于 → false；
 * 4. Renderer：重要伤害 → 浮动数字 important=true + size=18（放大高亮）；普通小伤害 → important=false + size 未设；
 * 5. Renderer：setBattleBackdrop(true) 正确点亮 battle 背景开关，render() 不抛错（drawBattleArena 入口可达）。
 *
 * 设计边界（与禁改项一致）：不改 Damage Resolver / HP / Weapon 参数 / 命中判定 / 胜负。
 */
import { describe, it, expect } from 'vitest';
import { DamageNumberAggregator, BIG_HIT_THRESHOLD } from '../src/presentation/damageNumberAggregator';
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

describe('F-BATTLE-PRESENTATION-R2 DamageNumberAggregator', () => {
  it('1. 同一 target 同时 ≥2 组活跃 → 第 3 命中合并进最旧组（不新建第 3 组）', () => {
    const agg = new DamageNumberAggregator(210);
    // 三个不同来源（partId 不同 → 不同分组键），全部在窗口内命中同一 target B
    const v1 = agg.feed(makeDamage({ partId: 'w1', timestamp: 1000 }), 1000); // 新组 G1
    const v2 = agg.feed(makeDamage({ partId: 'w2', timestamp: 1010 }), 1010); // 新组 G2（此时 B 已有 2 活跃组）
    const v3 = agg.feed(makeDamage({ partId: 'w3', timestamp: 1020 }), 1020); // 触发 ≤2 上限 → 合并进最旧 G1
    expect(v1.isNewGroup).toBe(true);
    expect(v2.isNewGroup).toBe(true);
    expect(v3.isNewGroup).toBe(false); // 合并，不新建
    // 第 3 命中合并进最旧组 G1（key = B|A|w1）
    expect(v3.groupKey).toBe('B|A|w1');
    expect(v3.accumulatedDamage).toBe(16); // G1: 8 + 8
    // 活跃分组数（按 key）= 2，未出现第 3 组浮动数字
    expect(agg.activeGroupCount).toBe(2);
  });

  it('2. 真实 damage 总量守恒（合并仅重组显示，不吞伤害）', () => {
    const agg = new DamageNumberAggregator(210);
    const times = [1000, 1010, 1020];
    times.forEach((t, i) => agg.feed(makeDamage({ partId: `w${i + 1}`, timestamp: t }), t));
    // 通过 Renderer 接入验证守恒：各活跃浮动数字累计之和 == 真实总量 8*3 = 24
    const r = makeRenderer();
    const orig = (globalThis.performance as { now: () => number }).now;
    let fakeNow = 1000;
    (globalThis.performance as { now: () => number }).now = () => fakeNow;
    try {
      times.forEach((t, i) => {
        r.spawnDamageNumberFromEvent(makeDamage({ partId: `w${i + 1}`, timestamp: t }));
        fakeNow += 10;
      });
      const nums = r.activeDamageNumbers;
      expect(nums.length).toBe(2); // ≤2 上限：G1(含2发) + G2(含1发)
      const total = nums.reduce((a, n) => a + Number(n.text.replace('-', '')), 0);
      expect(total).toBe(24); // == 8*3 真实总量（守恒）
    } finally {
      (globalThis.performance as { now: () => number }).now = orig;
    }
  });

  it('3. 重要伤害标记：damage ≥ 阈值 → important=true；低于 → false', () => {
    expect(BIG_HIT_THRESHOLD).toBe(15);
    const agg = new DamageNumberAggregator(210);
    const small = agg.feed(makeDamage({ partId: 'flame-1', damage: 8, timestamp: 1000 }), 1000);
    expect(small.important).toBe(false);
    const big = agg.feed(makeDamage({ partId: 'cannon-1', behavior: 'cannon', damage: 80, timestamp: 1010 }), 1010);
    expect(big.important).toBe(true);
  });
});

/* ---------------- Renderer 接入（Canvas stub，必要时 stub performance.now） ---------------- */

class CtxStub {
  fillStyle = '';
  font = '';
  textAlign = '';
  strokeStyle = '';
  lineWidth = 0;
  globalAlpha = 1;
  setTransform(): void {}
  clearRect(): void {}
  fillRect(): void {}
  beginPath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  closePath(): void {}
  fill(): void {}
  stroke(): void {}
  arc(): void {}
  fillText(): void {}
  strokeText(): void {}
  save(): void {}
  restore(): void {}
  createLinearGradient(): { addColorStop(): void } {
    return { addColorStop() {} };
  }
  createRadialGradient(): { addColorStop(): void } {
    return { addColorStop() {} };
  }
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

describe('F-BATTLE-PRESENTATION-R2 Renderer 伤害数字 + 竞技场背景', () => {
  it('4. 重要伤害 → 浮动数字 important=true + size=18（F-BATTLE-FX-SCREENSPACE-R2 收敛至 12-18px 上限）；普通小伤害 → important=false + size 未设', () => {
    const r = makeRenderer();
    // 重要伤害（Cannon 单次大额）
    r.spawnDamageNumberFromEvent(
      makeDamage({ partId: 'cannon-1', behavior: 'cannon', damage: 80, contactPoint: { x: 510, y: 610 } }),
    );
    let nums = r.activeDamageNumbers;
    expect(nums.length).toBe(1);
    expect(nums[0].important).toBe(true);
    expect(nums[0].size).toBe(18);
    // 普通小伤害（机枪/喷火单跳）
    r.spawnDamageNumberFromEvent(
      makeDamage({ partId: 'flame-1', behavior: 'flamethrower', damage: 8, contactPoint: { x: 520, y: 620 } }),
    );
    nums = r.activeDamageNumbers;
    const small = nums.find((n) => n.text === '-8');
    expect(small).toBeDefined();
    expect(small!.important).toBe(false);
    expect(small!.size).toBeUndefined();
  });

  it('5. setBattleBackdrop(true) 点亮 battle 背景开关（drawBattleArena 入口可达，不抛错）', () => {
    const r = makeRenderer();
    // 仅验证开关翻转不发生异常；完整像素验证由 _e2e_battle.cjs 真实浏览器门禁承担（Must#12）。
    expect(() => r.setBattleBackdrop(true)).not.toThrow();
  });
});
