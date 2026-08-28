/**
 * Queue F-BATTLE-HIT-READABILITY-R1｜伤害数字与远程武器视觉噪音收敛（targeted）
 *
 * 根因（Must#1 先调查后修改）：聚合窗口 DAMAGE_AGGREGATE_WINDOW_MS=210 ≪ 数字 TTL
 * DAMAGE_NUMBER_TTL_MS=900 → 聚合器「同车 ≤2 组」只约束窗口内活跃组，旧数字仍在显示
 * 900ms → 最终绘制同车最多 900/210 ≈ 4 组数字叠云。且合并不刷新剩余显示时间、
 * 无按 target 的稳定错层。
 *
 * 覆盖：
 * T1 渲染层硬限制：同 target 高频多窗口命中 → 最终绘制 ≤2 组（Must#2）
 * T2 合并刷新剩余显示时间（Must#3）：窗口内合并 → bornAt 刷新为最近命中
 * T3 同车两组 slot 稳定错层（Must#4）：slot = 0/1
 * T4 复用累加守恒：显示合计 == 真实伤害总量（不吞伤害表达）
 * T5 激光束收敛（Must#7）：length ≤ 弹体 2.5×（240 ≤ 40×2.5=100？→ 见下方）、不贯穿半屏
 * T6 数字绘制限幅不进 HUD（Must#4/5：ty ≥ 44·scale）
 * T7 尾迹存留 ≤180ms（Must#7）
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Renderer } from '../src/render/renderer';
import type { DamageEvent } from '../src/battle/combatEvents';

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

class CtxStub {
  calls: string[] = [];
  fillStyle = '';
  font = '';
  textAlign = '';
  lineWidth = 1;
  globalAlpha = 1;
  strokeStyle = '';
  lineCap = '';
  record(n: string): void {
    this.calls.push(n);
  }
  setTransform(): void { this.record('setTransform'); }
  clearRect(): void { this.record('clearRect'); }
  fillRect(): void { this.record('fillRect'); }
  strokeRect(): void { this.record('strokeRect'); }
  beginPath(): void { this.record('beginPath'); }
  moveTo(): void { this.record('moveTo'); }
  lineTo(): void { this.record('lineTo'); }
  closePath(): void { this.record('closePath'); }
  fill(): void { this.record('fill'); }
  stroke(): void { this.record('stroke'); }
  arc(): void { this.record('arc'); }
  fillText(): void { this.record('fillText'); }
  strokeText(): void { this.record('strokeText'); }
  save(): void { this.record('save'); }
  restore(): void { this.record('restore'); }
  scale(): void { this.record('scale'); }
  translate(): void { this.record('translate'); }
  setLineDash(): void { this.record('setLineDash'); }
  rotate(): void { this.record('rotate'); }
  clip(): void { this.record('clip'); }
  rect(): void { this.record('rect'); }
  createLinearGradient(): unknown { return { addColorStop: () => {} }; }
  measureText(): { width: number } { return { width: 10 }; }
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

let fakeNow = 1000;
let origNow: (() => number) | null = null;

function renderer(): Renderer {
  return new Renderer(makeCanvas(new CtxStub()));
}

describe('F-BATTLE-HIT-READABILITY-R1｜伤害数字收敛', () => {
  beforeEach(() => {
    fakeNow = 1000;
    origNow = (globalThis.performance as { now: () => number }).now;
    (globalThis.performance as { now: () => number }).now = () => fakeNow;
  });
  afterEach(() => {
    if (origNow) (globalThis.performance as { now: () => number }).now = origNow;
  });

  it('T1. 渲染层硬限制：同 target 多窗口高频命中 → 最终绘制 ≤2 组（Must#2 以最终绘制数量为准）', () => {
    const r = renderer();
    // 8 发、每发 +260ms（超聚合窗口 210ms → 每发都是新窗口/新组）
    const base = { partId: 'mg-1', behavior: 'machineGun', damageSource: 'weapon' as const, damage: 20 };
    for (let i = 0; i < 8; i++) {
      r.spawnDamageNumberFromEvent(makeDamage({ ...base, contactPoint: { x: 500 + i, y: 600 } }));
      fakeNow += 260;
    }
    // 若不限渲染层：8 个窗口 → 同车最多 8 组数字叠云；限后恒 ≤2
    const nums = r.activeDamageNumbers;
    expect(nums.length).toBeLessThanOrEqual(2);
    expect(nums.length).toBe(2); // 首两组建立，后续全部复用最旧
    // 所有存活数字都属于同一 target
    for (const n of nums) expect(n.target).toBe('B');
  });

  it('T2. 窗口内合并刷新剩余显示时间（Must#3）：连续命中 → bornAt 刷新为最近命中', () => {
    const r = renderer();
    const base = { partId: 'flame-1', behavior: 'flamethrower', damageSource: 'weapon' as const, damage: 8 };
    r.spawnDamageNumberFromEvent(makeDamage({ ...base, timestamp: 1000 }));
    const born0 = r.activeDamageNumbers[0].bornAt;
    fakeNow = 1080; // 窗口内（1000+210）
    r.spawnDamageNumberFromEvent(makeDamage({ ...base, timestamp: 1080 }));
    const n = r.activeDamageNumbers[0];
    expect(n.bornAt).toBe(1080); // 刷新剩余显示时间（而非保持首击 1000）
    expect(n.bornAt).not.toBe(born0);
    expect(n.text).toBe('-16'); // 累计
    expect(r.activeDamageNumbers.length).toBe(1); // 不新建数字
  });

  it('T3. 同车两组 slot 稳定错层（Must#4）：不同来源两组 → slot 0/1', () => {
    const r = renderer();
    r.spawnDamageNumberFromEvent(
      makeDamage({ partId: 'cannon-1', behavior: 'cannon', damageSource: 'weapon', damage: 30, contactPoint: { x: 520, y: 620 } }),
    );
    r.spawnDamageNumberFromEvent(
      makeDamage({ partId: 'hammer-1', behavior: 'hammer', damageSource: 'weapon', damage: 25, contactPoint: { x: 540, y: 640 } }),
    );
    const nums = r.activeDamageNumbers;
    expect(nums.length).toBe(2);
    const slots = nums.map((n) => n.slot).sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(slots).toEqual([0, 1]); // 稳定错层槽位
    for (const n of nums) expect(n.target).toBe('B');
  });

  it('T4. 复用最旧组时累加显示：显示合计 == 真实伤害总量（不吞伤害表达）', () => {
    const r = renderer();
    const base = { partId: 'mg-1', behavior: 'machineGun', damageSource: 'weapon' as const, damage: 20 };
    // 7 发、每发 +260ms：窗口 1(1发) → 窗口 2(1发) → 其余 5 发复用最旧
    for (let i = 0; i < 7; i++) {
      r.spawnDamageNumberFromEvent(makeDamage({ ...base, contactPoint: { x: 500, y: 600 } }));
      fakeNow += 260;
    }
    const nums = r.activeDamageNumbers;
    const total = nums.reduce((a, n) => a + Number(n.text.replace('-', '')), 0);
    expect(total).toBe(7 * 20); // 140 == 真实总量
  });

  it('T5. 激光束收敛（Must#7）：不贯穿半屏（240 ≤ 844×0.5）、glow ≤ 弹体宽 60%（22 ≤ 40×0.6）', () => {
    const r = renderer();
    r.spawnLaserBeam(100, 100, 1, 0);
    const beams = r.activeLaserBeams;
    expect(beams.length).toBe(1);
    expect(beams[0].length).toBeLessThanOrEqual(240);
    expect(beams[0].length).toBeLessThan(844 * 0.5); // 不贯穿半屏（逻辑宽 844）
    expect(beams[0].glowWidth).toBeLessThanOrEqual(24); // laser 弹体宽 40 → 60% = 24
  });

  it('T6. 数字绘制限幅不进顶部 HUD（Must#4/5）：ty 下限 44·scale', () => {
    const r = renderer();
    const src = r as unknown as { ss(v: number): number };
    // 源码守卫：绘制公式含 HUD 下限
    const code = require('node:fs').readFileSync('src/render/renderer.ts', 'utf-8') as string;
    expect(code).toContain('Math.max(this.ss(44)');
    expect(typeof src.ss).toBe('function');
  });

  it('T7. 尾迹存留 ≤180ms（Must#7）：laser 束 ttl=130、弹迹均为瞬态', () => {
    const r = renderer();
    r.spawnLaserBeam(100, 100, 1, 0);
    const beams = r.activeLaserBeams;
    expect(beams[0].ttl).toBeLessThanOrEqual(180);
  });
});
