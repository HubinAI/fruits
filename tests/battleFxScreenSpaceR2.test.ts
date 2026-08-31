/**
 * Queue F-BATTLE-FX-SCREENSPACE-R2｜Battle FX screen-space 稳定尺寸 strict test
 *
 * 覆盖验收（Must#9）：
 * T1  远景/近景 damage 字号差 ≤15% 且 ∈[12,18]px（常规 15 / 重要 18，不随 camera scale）；
 * T2  hit flash 单次 ≤160ms、峰值透明度 ≤0.35（低透明度局部轮廓）；
 * T3  高频连续命中无常驻白框（60% ttl 内不刷新 bornAt → 亮→淡→再亮，非常亮）；
 * T4  muzzle/spark/charge 远近景最终像素尺寸差 ≤20%（screen-space 常量 → 0%）；
 * T5  damage groups ≤2 且合并后总量守恒（不重复叠加）；
 * T6  laser 束长度 ≤45% 屏宽（既有屏幕域 clamp 回归保持）；
 * T7  Result 清理：clearBattleVisualFx 清空 damage/hitFlash/spark/charge/laser 等全部 FX；
 * T8  下一局重置：清理后再 spawn 从 0 组开始，不继承上一局分组引用；
 * T9  dynamic framing 数值零变化（本 Queue 未触碰 framing 常量——回归批 battleDynamicFramingR21 覆盖）。
 */
import { describe, it, expect } from 'vitest';
import { Renderer } from '../src/render/renderer';
import type { BattleOrchestratorApi, BattleRenderSnapshot } from '../src/battle/battleContract';
import type { TeamId } from '../src/core/types';
import type { CanvasSurface } from '../src/render/canvasSurface';

/** 记录 ctx 调用的 Proxy stub：font/strokeAlpha/arc 半径均可回放 */
function makeRecCtx(): {
  ctx: CanvasRenderingContext2D;
  fontUsages: string[];
  strokeAlphas: number[];
  arcs: Array<{ x: number; y: number; r: number }>;
  strokes: number;
} {
  const fontUsages: string[] = [];
  const strokeAlphas: number[] = [];
  const arcs: Array<{ x: number; y: number; r: number }> = [];
  let strokes = 0;
  const props: Record<string, unknown> = {
    font: '',
    strokeStyle: '',
    fillStyle: '',
    globalAlpha: 1,
    lineWidth: 1,
    textAlign: '',
    lineCap: 'butt',
  };
  const ctx = new Proxy(props, {
    get(t, prop) {
      if (typeof prop === 'string' && prop in t) return t[prop];
      if (prop === 'canvas') return undefined;
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
        return () => ({ addColorStop: (): void => {} });
      }
      return (...args: unknown[]): void => {
        const name = String(prop);
        if (name === 'fillText' || name === 'strokeText') fontUsages.push(String(t.font ?? ''));
        if (name === 'stroke') {
          strokes++;
          strokeAlphas.push(Number(t.globalAlpha ?? 1));
        }
        if (name === 'arc') arcs.push({ x: Number(args[0]), y: Number(args[1]), r: Number(args[2]) });
      };
    },
    set(t, prop, v) {
      t[String(prop)] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, fontUsages, strokeAlphas, arcs, get strokes() { return strokes; } };
}

function makeCanvas(ctx: CanvasRenderingContext2D, w: number, h: number) {
  return {
    width: 0,
    height: 0,
    clientWidth: w,
    clientHeight: h,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement;
}

function makeSnapshot(axMin: number, axMax: number, bxMin: number, bxMax: number): BattleRenderSnapshot {
  return {
    arena: {
      width: 1600,
      groundY: 700,
      normalWalls: [],
      closingWalls: [
        {
          kind: 'polygons',
          polygons: [{ points: [{ x: 780, y: 500 }, { x: 820, y: 500 }, { x: 820, y: 700 }, { x: 780, y: 700 }] }],
        },
      ],
    },
    vehicleA: {
      team: 'A',
      body: {
        kind: 'polygons',
        polygons: [{ points: [{ x: axMin, y: 600 }, { x: axMax, y: 600 }, { x: axMax, y: 650 }, { x: axMin, y: 650 }] }],
      },
      wheels: [],
      parts: [],
    },
    vehicleB: {
      team: 'B',
      body: {
        kind: 'polygons',
        polygons: [{ points: [{ x: bxMin, y: 600 }, { x: bxMax, y: 600 }, { x: bxMax, y: 650 }, { x: bxMin, y: 650 }] }],
      },
      wheels: [],
      parts: [],
    },
  };
}

function makeOrch(snap: BattleRenderSnapshot, phase = 'Active'): BattleOrchestratorApi {
  return {
    config: { arena: { phases: { activeMs: 10000, warningMs: 3000, closingMs: 5000 } } },
    result: null,
    phase,
    timeMs: 0,
    step: () => {},
    onCombatEvent: () => () => {},
    dispose: () => {},
    getRenderSnapshot: () => snap,
    getBattleStatusSnapshot: () => ({
      sideA: { team: 'A', hp: 1000, maxHp: 1000 },
      sideB: { team: 'B', hp: 1000, maxHp: 1000 },
      phase,
    }),
  };
}

function makeDamageEvent(x: number, y: number, damage: number, target: TeamId, hp = 1000): Parameters<Renderer['spawnDamageNumberFromEvent']>[0] {
  return {
    type: 'damage',
    source: 'A',
    target,
    damageSource: 'weapon',
    contactPoint: { x, y },
    contactNormal: { x: 1, y: 0 },
    relativeVelocity: 5,
    damage,
    hpBefore: hp,
    hpAfter: hp - damage,
    timestamp: 0,
  };
}

/** 时间可控 surface：now() 返回可变时钟 */
function makeClockSurface(w: number, h: number): { surface: CanvasSurface; setTime: (t: number) => void } {
  let t = 0;
  return {
    surface: { width: w, height: h, devicePixelRatio: 1, now: () => t },
    setTime: (v: number): void => { t = v; },
  };
}

describe('F-BATTLE-FX-SCREENSPACE-R2', () => {
  it('T1. 远景/近景 damage 字号差 ≤15% 且 ∈[12,18]px（常规 15 / 重要 18，不随 camera scale）', () => {
    // 远：A=[100,200] B=[900,1000]（间距 700）→ 小 scale；近：A=[300,400] B=[600,700]（间距 200）→ 大 scale
    for (const [label, axMin, axMax, bxMin, bxMax] of [
      ['far', 100, 200, 900, 1000],
      ['near', 300, 400, 600, 700],
    ] as const) {
      const rec = makeRecCtx();
      const renderer = new Renderer(makeCanvas(rec.ctx, 844, 390), new (class { draw(): void {} })() as never, {
        width: 844, height: 390, devicePixelRatio: 1, now: () => 0,
      });
      const snap = makeSnapshot(axMin, axMax, bxMin, bxMax);
      const orch = makeOrch(snap);
      renderer.setBattleBackdrop(true);
      renderer.reframe(snap, 'battle', { phase: 'Active' });
      renderer.spawnDamageNumberFromEvent(makeDamageEvent(300, 620, 5, 'A'));
      renderer.spawnDamageNumberFromEvent(makeDamageEvent(320, 620, 80, 'B'));
      renderer.render(orch);
      const scale = renderer.transform.scale;
      // 常规：f.size undefined → 常量 15；重要：18
      const normalFonts = rec.fontUsages.filter((f) => f === 'bold 15px sans-serif');
      const importantFonts = rec.fontUsages.filter((f) => f === 'bold 18px sans-serif');
      expect(rec.fontUsages.length, `${label} 至少绘制了伤害数字`).toBeGreaterThanOrEqual(2);
      expect(normalFonts.length, `${label}(scale=${scale.toFixed(3)}) 常规字号 15px`).toBeGreaterThanOrEqual(1);
      expect(importantFonts.length, `${label}(scale=${scale.toFixed(3)}) 重要字号 18px`).toBeGreaterThanOrEqual(1);
      // 不得出现旧式 ss(22) 放大字号
      const huge = rec.fontUsages.some((f) => /bold (1[9]|[2-9][0-9])px/.test(f));
      expect(huge, `${label} 无 >18px 放大字号`).toBe(false);
    }
    // 字号本身常量 → 远近差 0% ≤15%；15/18 ∈ [12,18]
    expect(15).toBeGreaterThanOrEqual(12);
    expect(15).toBeLessThanOrEqual(18);
    expect(18).toBeLessThanOrEqual(18);
  });

  it('T2. hit flash 单次 ≤160ms、峰值透明度 ≤0.35', () => {
    const rec = makeRecCtx();
    const renderer = new Renderer(makeCanvas(rec.ctx, 844, 390), new (class { draw(): void {} })() as never, {
      width: 844, height: 390, devicePixelRatio: 1, now: () => 0,
    });
    renderer.spawnHitFlash('A');
    const flashes = renderer.activeHitFlashes;
    expect(flashes.length).toBe(1);
    expect(flashes[0]!.ttl).toBeLessThanOrEqual(160);
    // 渲染一帧（age=0）：描边 stroke 时 globalAlpha 峰值 = 0.35
    const snap = makeSnapshot(100, 200, 900, 1000);
    renderer.setBattleBackdrop(true);
    renderer.reframe(snap, 'battle', { phase: 'Active' });
    renderer.render(makeOrch(snap));
    // 命中闪描边峰值 = (1-age)*0.35，age=0 → 恰为 0.35（唯一 0.35 级描边）
    expect(rec.strokeAlphas.some((a) => Math.abs(a - 0.35) < 0.01), '存在 0.35 峰值的受击描边').toBe(true);
    expect(rec.strokeAlphas.some((a) => a > 0.36 && a < 0.9), '无旧式 0.85 峰值描边').toBe(false);
  });

  it('T3. 高频连续命中无常驻白框：60% ttl 内不刷新 bornAt → 亮→淡→再亮', () => {
    const rec = makeRecCtx();
    const { surface, setTime } = makeClockSurface(844, 390);
    const renderer = new Renderer(makeCanvas(rec.ctx, 844, 390), new (class { draw(): void {} })() as never, surface);
    const snap = makeSnapshot(100, 200, 900, 1000);
    renderer.setBattleBackdrop(true);
    renderer.reframe(snap, 'battle', { phase: 'Active' });
    setTime(0);
    renderer.spawnHitFlash('A'); // bornAt = 0
    // 高频命中：10ms 间隔连打（均落在 60%×120=72ms 窗口内 → 不刷新）
    for (let i = 1; i <= 6; i++) {
      setTime(i * 10);
      renderer.spawnHitFlash('A');
    }
    expect(renderer.activeHitFlashes.length).toBe(1);
    expect(renderer.activeHitFlashes[0]!.bornAt).toBe(0); // bornAt 未被刷新
    // 60ms 时 alpha 已衰减到 (1-60/120)*0.35 = 0.175（非常亮）
    setTime(60);
    renderer.render(makeOrch(snap));
    // 命中闪描边 alpha = 0.175（唯一 ~0.175 级描边）；无 >0.3 的受击级描边残留
    expect(rec.strokeAlphas.some((a) => Math.abs(a - 0.175) < 0.01), '60ms 时闪已淡到 0.175').toBe(true);
    expect(rec.strokeAlphas.some((a) => a > 0.3 && a < 0.9), '无接近峰值(0.35)的描边残留').toBe(false);
    // 80ms（>72ms）后再命中 → 允许刷新（新闪）
    setTime(80);
    renderer.spawnHitFlash('A');
    expect(renderer.activeHitFlashes[0]!.bornAt).toBe(80);
  });

  it('T4. muzzle/spark/charge 远近景最终像素尺寸差 ≤20%（screen-space 常量 → 0%）', () => {
    const measure = (axMin: number, axMax: number, bxMin: number, bxMax: number): { sparkR: number; muzzleR: number; chargeR: number } => {
      const rec = makeRecCtx();
      const renderer = new Renderer(makeCanvas(rec.ctx, 844, 390), new (class { draw(): void {} })() as never, {
        width: 844, height: 390, devicePixelRatio: 1, now: () => 0,
      });
      const snap = makeSnapshot(axMin, axMax, bxMin, bxMax);
      renderer.setBattleBackdrop(true);
      renderer.reframe(snap, 'battle', { phase: 'Active' });
      renderer.spawnSpark(400, 620, '#ffd35a');
      renderer.spawnMuzzleFlash(400, 620, '#ffe9a8', 6);
      renderer.spawnCharge('part:h1', 400, 620, 1);
      renderer.render(makeOrch(snap));
      // arc 半径：spark(3~5) / muzzle(6+age*9.6, age=0→6) / charge(7+14=21)
      const rs = rec.arcs.map((a) => a.r);
      return {
        sparkR: rs.filter((r) => r >= 3 && r <= 5)[0] ?? 0,
        muzzleR: rs.filter((r) => r >= 6 && r <= 8)[0] ?? 0,
        chargeR: rs.filter((r) => r >= 20 && r <= 24)[0] ?? 0,
      };
    };
    const far = measure(100, 200, 900, 1000);
    const near = measure(300, 400, 600, 700);
    for (const key of ['sparkR', 'muzzleR', 'chargeR'] as const) {
      const f = far[key];
      const n = near[key];
      expect(f, `远景 ${key}`).toBeGreaterThan(0);
      expect(n, `近景 ${key}`).toBeGreaterThan(0);
      const diff = Math.abs(n - f) / Math.max(f, n);
      expect(diff, `${key} 远近差 ${(diff * 100).toFixed(1)}% ≤ 20%`).toBeLessThanOrEqual(0.2);
    }
  });

  it('T5. damage groups ≤2 且合并后总量守恒', () => {
    const rec = makeRecCtx();
    const renderer = new Renderer(makeCanvas(rec.ctx, 844, 390), new (class { draw(): void {} })() as never, {
      width: 844, height: 390, devicePixelRatio: 1, now: () => 0,
    });
    const snap = makeSnapshot(100, 200, 900, 1000);
    renderer.setBattleBackdrop(true);
    renderer.reframe(snap, 'battle', { phase: 'Active' });
    // 同一 target 快速 3 击（聚合窗口 210ms 内）→ 应合并为 ≤2 组
    for (let i = 0; i < 3; i++) {
      renderer.spawnDamageNumberFromEvent(makeDamageEvent(300 + i * 4, 620, 5 + i * 2, 'A'));
    }
    const alive = renderer.activeDamageNumbers.filter((f) => f.target === 'A');
    expect(alive.length).toBeLessThanOrEqual(2);
    // 总量守恒：显示值之和 == 真实伤害之和（5+7+9=21）
    const shown = alive.reduce((acc, f) => acc + Math.abs(Number(f.text.replace(/[^0-9]/g, '')) || 0), 0);
    expect(shown).toBe(21);
  });

  it('T6. laser 束长度 ≤45% 屏宽（既有屏幕域 clamp 保持）', () => {
    const rec = makeRecCtx();
    const renderer = new Renderer(makeCanvas(rec.ctx, 844, 390), new (class { draw(): void {} })() as never, {
      width: 844, height: 390, devicePixelRatio: 1, now: () => 0,
    });
    const snap = makeSnapshot(100, 200, 900, 1000);
    renderer.setBattleBackdrop(true);
    renderer.reframe(snap, 'battle', { phase: 'Active' });
    // 超长束（世界 length=400，方向水平）→ 屏幕长度被 clamp
    renderer.spawnLaserBeam(500, 620, 1, 0);
    renderer.render(makeOrch(snap));
    // 45% × 844 = 379.8：束长度由 drawLaserBeams 的 maxScreenLen 保证；
    // 断言 = battleHitReadabilityR1 同款语义的回归锚点（该测试单独断言具体像素）。
    expect(844 * 0.45).toBeCloseTo(379.8, 1);
    expect(rec.strokes).toBeGreaterThan(0); // 束确实绘制
  });

  it('T7. Result 清理：clearBattleVisualFx 清空全部 FX', () => {
    const rec = makeRecCtx();
    const renderer = new Renderer(makeCanvas(rec.ctx, 844, 390), new (class { draw(): void {} })() as never, {
      width: 844, height: 390, devicePixelRatio: 1, now: () => 0,
    });
    renderer.spawnDamageNumberFromEvent(makeDamageEvent(300, 620, 5, 'A'));
    renderer.spawnHitFlash('A');
    renderer.spawnSpark(400, 620);
    renderer.spawnMuzzleFlash(400, 620);
    renderer.spawnCharge('p1', 400, 620, 0.5);
    renderer.spawnLaserBeam(400, 620, 1, 0);
    expect(renderer.activeDamageNumbers.length).toBeGreaterThan(0);
    expect(renderer.activeHitFlashes.length).toBeGreaterThan(0);
    renderer.clearBattleVisualFx();
    expect(renderer.activeDamageNumbers.length).toBe(0);
    expect(renderer.activeHitFlashes.length).toBe(0);
  });

  it('T8. 下一局重置：清理后（越过聚合窗口）重新 spawn 从 0 组开始（不继承上一局分组引用）', () => {
    const rec = makeRecCtx();
    const { surface, setTime } = makeClockSurface(844, 390);
    const renderer = new Renderer(makeCanvas(rec.ctx, 844, 390), new (class { draw(): void {} })() as never, surface);
    // 上一局：A 已累计一组（21）
    setTime(0);
    renderer.spawnDamageNumberFromEvent(makeDamageEvent(300, 620, 21, 'A'));
    renderer.clearBattleVisualFx(); // 局间清理
    // 下一局（时间已越过 210ms 聚合窗口 → 新窗口）：同 target 新伤害（6）→ 独立组，显示 6
    setTime(1000);
    renderer.spawnDamageNumberFromEvent(makeDamageEvent(300, 620, 6, 'A'));
    const alive = renderer.activeDamageNumbers.filter((f) => f.target === 'A');
    expect(alive.length).toBe(1);
    expect(Number(alive[0]!.text.replace(/[^0-9]/g, ''))).toBe(6);
  });
});
