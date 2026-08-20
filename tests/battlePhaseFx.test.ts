/**
 * Queue W2-FX-2｜阶段级战斗表现 targeted test
 *
 * 覆盖验收：
 * 1. 阶段剩余时间纯函数（Warning 倒计时数据源；End=0、clamp）；
 * 2. Warning 数字倒计时 3 → 2 → 1（Closing 开始后消失 → ''）；
 * 3. Death 表现层定格调度（80~120ms 窗口：frozen → 到点 shouldResume → clear）；
 * 4. 伤害反馈配色（hazard 刺伤专属红，与 weapon/impact 区分）；
 * 5. 死亡车辆表现状态（淡出 alpha → 消失跳过绘制；未死亡不受影响）；
 * 6. Renderer 阶段视觉 smoke：Warning 刺墙预高亮描边；Closing 锯齿尖刺；
 *    Active 无高亮（回归不变）；spawnDeathFx 后 render 正常。
 */
import { describe, it, expect } from 'vitest';
import { Renderer } from '../src/render/renderer';
import type {
  BattleOrchestratorApi,
  BattleRenderSnapshot,
} from '../src/battle/battleContract';
import {
  DeathPauseScheduler,
  damageFeedbackColors,
  phaseRemainingMs,
  vehicleDeathAlpha,
  warningCountdown,
} from '../src/presentation/battlePhaseFx';

/** 记录 ctx 调用的最小 stub（补齐 W2-FX-2 render 需要的 save/restore） */
class CtxStub {
  calls: string[] = [];
  fillStyle = '';
  strokeStyle = '';
  lineWidth = 1;
  globalAlpha = 1;
  font = '';
  textAlign = '';
  private record(name: string): void {
    this.calls.push(name);
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
  save(): void { this.record('save'); }
  restore(): void { this.record('restore'); }
}

function makeCanvas(ctx: CtxStub) {
  return {
    width: 0,
    height: 0,
    clientWidth: 1000,
    clientHeight: 500,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement;
}

/** 竖直刺墙（世界坐标：x=800 附近一堵墙） */
const wallPoly = [
  { x: 780, y: 500 },
  { x: 820, y: 500 },
  { x: 820, y: 700 },
  { x: 780, y: 700 },
];

function makeSnapshot(): BattleRenderSnapshot {
  return {
    arena: {
      width: 1600,
      groundY: 700,
      normalWalls: [],
      closingWalls: [{ kind: 'polygons', polygons: [{ points: wallPoly }] }],
    },
    vehicleA: {
      team: 'A',
      body: {
        kind: 'polygons',
        polygons: [
          { points: [{ x: 100, y: 600 }, { x: 200, y: 600 }, { x: 200, y: 650 }, { x: 100, y: 650 }] },
        ],
      },
      wheels: [],
      parts: [],
    },
    vehicleB: {
      team: 'B',
      body: {
        kind: 'polygons',
        polygons: [
          { points: [{ x: 900, y: 600 }, { x: 1000, y: 600 }, { x: 1000, y: 650 }, { x: 900, y: 650 }] },
        ],
      },
      wheels: [],
      parts: [],
    },
  };
}

function makeFakeOrch(phase: string): BattleOrchestratorApi {
  const snap = makeSnapshot();
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

describe('W2-FX-2 阶段级表现（纯逻辑）', () => {
  it('1. phaseRemainingMs：End=0；其余 clamp ≥0', () => {
    expect(phaseRemainingMs('Warning', 3000, 500)).toBe(2500);
    expect(phaseRemainingMs('Warning', 3000, 3200)).toBe(0); // 超时 clamp
    expect(phaseRemainingMs('End', 3000, 100)).toBe(0);
    expect(phaseRemainingMs('Active', 10000, 10000)).toBe(0);
  });

  it('2. warningCountdown：3 → 2 → 1；≤0 → 空（Closing 开始后倒计时消失）', () => {
    expect(warningCountdown(3000)).toBe('3');
    expect(warningCountdown(2500)).toBe('3');
    expect(warningCountdown(2000)).toBe('2');
    expect(warningCountdown(1500)).toBe('2');
    expect(warningCountdown(1000)).toBe('1');
    expect(warningCountdown(100)).toBe('1');
    expect(warningCountdown(0)).toBe('');
    expect(warningCountdown(-10)).toBe('');
  });

  it('3. DeathPauseScheduler：触发 → frozen；到点 → shouldResume；clear 结束', () => {
    let t = 0;
    const sched = new DeathPauseScheduler(() => t);
    expect(sched.active).toBe(false);
    sched.trigger(100); // t=0 触发（建议窗口 80~120）
    expect(sched.active).toBe(true);
    expect(sched.frozen()).toBe(true);
    expect(sched.shouldResume()).toBe(false);
    t = 50;
    expect(sched.frozen()).toBe(true);
    t = 100;
    expect(sched.frozen()).toBe(false);
    expect(sched.shouldResume()).toBe(true);
    sched.clear();
    expect(sched.active).toBe(false);
    // 多次触发以最后一次为准
    sched.trigger(100);
    t = 80;
    sched.trigger(100); // 覆盖 → 恢复点推后到 t=180
    expect(sched.frozen()).toBe(true);
    t = 150;
    expect(sched.frozen()).toBe(true);
    t = 181;
    expect(sched.shouldResume()).toBe(true);
  });

  it('4. damageFeedbackColors：hazard 刺伤专属红，与 weapon/impact 区分', () => {
    const hazard = damageFeedbackColors('hazard');
    const weapon = damageFeedbackColors('weapon');
    const impact = damageFeedbackColors('impact');
    expect(hazard.number).toBe('#ff3b3b');
    expect(hazard.spark).toBe('#ff5a4e');
    expect(hazard.number).not.toBe(weapon.number);
    expect(hazard.spark).not.toBe(impact.spark);
    expect(weapon.number).not.toBe(impact.number);
  });

  it('5. vehicleDeathAlpha：未死亡 → 1（正常绘制）；淡出中 alpha 递减；超 ttl → 消失；多死亡取最新', () => {
    const deaths = [{ team: 'B', bornAt: 1000, ttl: 600 }];
    expect(vehicleDeathAlpha(deaths, 'A', 1100)).toBe(1); // 未死亡：正常绘制
    expect(vehicleDeathAlpha([], 'A', 1100)).toBe(1); // 无任何死亡记录
    expect(vehicleDeathAlpha(deaths, 'B', 1000)).toBe(1); // 刚死亡（alpha=1）
    expect(vehicleDeathAlpha(deaths, 'B', 1300)).toBeCloseTo(0.5, 6); // 淡出中
    expect(vehicleDeathAlpha(deaths, 'B', 1600)).toBeNull(); // 超 ttl 消失（跳过绘制）
    const multi = [
      { team: 'B', bornAt: 500, ttl: 600 },
      { team: 'B', bornAt: 1000, ttl: 600 },
    ];
    expect(vehicleDeathAlpha(multi, 'B', 1300)).toBeCloseTo(0.5, 6); // 取最新 bornAt
  });
});

describe('W2-FX-2 阶段视觉（Renderer smoke）', () => {
  function renderWith(phase: string): CtxStub {
    const ctx = new CtxStub();
    const renderer = new Renderer(makeCanvas(ctx));
    (globalThis as { window?: { devicePixelRatio: number } }).window = { devicePixelRatio: 1 };
    renderer.resize(1600, 1000);
    renderer.render(makeFakeOrch(phase));
    return ctx;
  }

  it('6a. Active：刺墙无高亮（stroke 只来自 drawShape 内部 #0d0f14 描边）', () => {
    const ctx = renderWith('Active');
    expect(ctx.strokeStyle).toBe('#0d0f14'); // 未被 strokeShape 覆盖
    // 无锯齿（Closing 才有额外 moveTo/lineTo/fill）
  });

  it('6b. Warning：刺墙预高亮描边（strokeShape 多一次描边 stroke）', () => {
    const activeStrokes = renderWith('Active').calls.filter((c) => c === 'stroke').length;
    const warningStrokes = renderWith('Warning').calls.filter((c) => c === 'stroke').length;
    expect(warningStrokes).toBeGreaterThan(activeStrokes); // 预高亮额外描边
  });

  it('6c. Closing：正式刺墙（锯齿尖刺 fill 次数显著多于 Active）', () => {
    const activeFills = renderWith('Active').calls.filter((c) => c === 'fill').length;
    const closingFills = renderWith('Closing').calls.filter((c) => c === 'fill').length;
    expect(closingFills).toBeGreaterThan(activeFills); // drawSpikes 每刺一个 fill
  });

  it('6d. spawnDeathFx 后 render 正常（死亡车辆淡出绘制，不抛错）', () => {
    const ctx = new CtxStub();
    const renderer = new Renderer(makeCanvas(ctx));
    (globalThis as { window?: { devicePixelRatio: number } }).window = { devicePixelRatio: 1 };
    renderer.resize(1600, 1000);
    renderer.spawnDeathFx('B');
    expect(() => renderer.render(makeFakeOrch('Active'))).not.toThrow();
    // B 车辆仍在淡出窗口 → 正常绘制（vehicleDeathAlpha 非 null）
    expect(ctx.calls.includes('fill')).toBe(true);
  });

  it('6e. Q06-UX-R2-FIX：preview fit 完整入画（screen bounds 落在 safe viewport，不再 ×1.9 裁切）', () => {
    const ctx = new CtxStub();
    const renderer = new Renderer(makeCanvas(ctx));
    (globalThis as { window?: { devicePixelRatio: number } }).window = { devicePixelRatio: 1 };
    renderer.resize(1600, 1000);
    const orch = makeFakeOrch('Active');
    const snap = orch.getRenderSnapshot();
    renderer.reframe(snap, 'vehicles');
    const vehiclesScale = renderer.transformScale;
    renderer.reframe(snap, 'preview');
    const previewScale = renderer.transformScale;
    // 主要验收：A/B body 完整落在 safe viewport（左右各 56、上下各 28 内缩，与 renderer 一致）
    const cw = 1000, ch = 500;
    const a = renderer.worldRectToScreen(100, 600, 200, 650);
    const b = renderer.worldRectToScreen(900, 600, 1000, 650);
    for (const [label, r] of [['A', a], ['B', b]] as const) {
      expect(r.minX, `${label} 左缘入画`).toBeGreaterThanOrEqual(56 - 1e-6);
      expect(r.minY, `${label} 上缘入画`).toBeGreaterThanOrEqual(28 - 1e-6);
      expect(r.maxX, `${label} 右缘入画`).toBeLessThanOrEqual(cw - 56 + 1e-6);
      expect(r.maxY, `${label} 下缘入画`).toBeLessThanOrEqual(ch - 28 + 1e-6);
    }
    // 次要参考：小边距（18 < 64）下 preview 略大于 vehicles（不再作为主要验收，
    // 完整入画优先；preview 的明显放大由近距 spawn + 小边距共同提供）
    expect(previewScale).toBeGreaterThan(vehiclesScale);
  });
});

/* ---------- Q08-A：Battle Camera 正常观看构图（可视结果验证，非 scale 数字） ---------- */

/** 正式战斗 snapshot：A（watermelon-like，中心 385）/ B（banana-like，中心 1160），groundY 700，
 *  含双轮 + 多 functional parts（pushRod/cannon/hammer）+ 左右两堵 Closing wall。 */
function makeBattleSnapshot(): BattleRenderSnapshot {
  const wallL = [
    { x: 250, y: 500 }, { x: 290, y: 500 }, { x: 290, y: 700 }, { x: 250, y: 700 },
  ];
  const wallR = [
    { x: 1310, y: 500 }, { x: 1350, y: 500 }, { x: 1350, y: 700 }, { x: 1310, y: 700 },
  ];
  return {
    arena: {
      width: 1600,
      groundY: 700,
      normalWalls: [],
      closingWalls: [
        { kind: 'polygons', polygons: [{ points: wallL }] },
        { kind: 'polygons', polygons: [{ points: wallR }] },
      ],
    },
    vehicleA: {
      team: 'A',
      body: {
        kind: 'polygons',
        polygons: [{ points: [{ x: 300, y: 650 }, { x: 470, y: 650 }, { x: 470, y: 700 }, { x: 300, y: 700 }] }],
      },
      wheels: [
        { center: { x: 327, y: 680 }, radius: 20, angle: 0 },
        { center: { x: 443, y: 680 }, radius: 20, angle: 0 },
      ],
      parts: [
        { shape: { kind: 'polygons', polygons: [{ points: [{ x: 430, y: 660 }, { x: 510, y: 660 }, { x: 510, y: 690 }, { x: 430, y: 690 }] }] }, category: 'weapon' },
        { shape: { kind: 'polygons', polygons: [{ points: [{ x: 395, y: 660 }, { x: 435, y: 660 }, { x: 435, y: 680 }, { x: 395, y: 680 }] }] }, category: 'weapon' },
        { shape: { kind: 'polygons', polygons: [{ points: [{ x: 350, y: 630 }, { x: 420, y: 630 }, { x: 420, y: 644 }, { x: 350, y: 644 }] }] }, category: 'weapon' },
      ],
    },
    vehicleB: {
      team: 'B',
      body: {
        kind: 'polygons',
        polygons: [{ points: [{ x: 1100, y: 656 }, { x: 1220, y: 656 }, { x: 1220, y: 700 }, { x: 1100, y: 700 }] }],
      },
      wheels: [
        { center: { x: 1098, y: 680 }, radius: 20, angle: 0 },
        { center: { x: 1222, y: 680 }, radius: 20, angle: 0 },
      ],
      parts: [
        { shape: { kind: 'polygons', polygons: [{ points: [{ x: 1090, y: 660 }, { x: 1170, y: 660 }, { x: 1170, y: 690 }, { x: 1090, y: 690 }] }] }, category: 'weapon' },
      ],
    },
  };
}

describe('Q08-A Battle Camera 正常观看构图', () => {
  function makeRenderer(): Renderer {
    const ctx = new CtxStub();
    const renderer = new Renderer(makeCanvas(ctx));
    (globalThis as { window?: { devicePixelRatio: number } }).window = { devicePixelRatio: 1 };
    renderer.resize(1600, 1000);
    return renderer;
  }
  const SAFE_X = 56, SAFE_Y = 28, CW = 1000, CH = 500;

  function inSafe(
    renderer: Renderer,
    w: { minX: number; minY: number; maxX: number; maxY: number },
    label: string,
  ): void {
    const s = renderer.worldRectToScreen(w.minX, w.minY, w.maxX, w.maxY);
    expect(s.minX, `${label} 左缘入画`).toBeGreaterThanOrEqual(SAFE_X - 1e-6);
    expect(s.minY, `${label} 上缘入画`).toBeGreaterThanOrEqual(SAFE_Y - 1e-6);
    expect(s.maxX, `${label} 右缘入画`).toBeLessThanOrEqual(CW - SAFE_X + 1e-6);
    expect(s.maxY, `${label} 下缘入画`).toBeLessThanOrEqual(CH - SAFE_Y + 1e-6);
  }

  function screenHeight(renderer: Renderer, w: { minX: number; minY: number; maxX: number; maxY: number }): number {
    const s = renderer.worldRectToScreen(w.minX, w.minY, w.maxX, w.maxY);
    return s.maxY - s.minY;
  }

  it('1. Active：A/B body + wheel + functional parts 完整入画，车辆明显大于 full-arena（Closing）构图', () => {
    const renderer = makeRenderer();
    const snap = makeBattleSnapshot();
    renderer.reframe(snap, 'battle', { phase: 'Active' });
    const activeScale = renderer.transformScale;
    // A：body + 双轮 + 三件 functional parts 全部完整入画
    inSafe(renderer, { minX: 300, minY: 650, maxX: 470, maxY: 700 }, 'A body');
    inSafe(renderer, { minX: 307, minY: 660, maxX: 347, maxY: 700 }, 'A wheel rear');
    inSafe(renderer, { minX: 423, minY: 660, maxX: 463, maxY: 700 }, 'A wheel front');
    inSafe(renderer, { minX: 430, minY: 660, maxX: 510, maxY: 690 }, 'A part pushRod');
    inSafe(renderer, { minX: 395, minY: 660, maxX: 435, maxY: 680 }, 'A part cannon');
    inSafe(renderer, { minX: 350, minY: 630, maxX: 420, maxY: 644 }, 'A part hammer');
    // B：body + 双轮 + part
    inSafe(renderer, { minX: 1100, minY: 656, maxX: 1220, maxY: 700 }, 'B body');
    inSafe(renderer, { minX: 1078, minY: 660, maxX: 1118, maxY: 700 }, 'B wheel rear');
    inSafe(renderer, { minX: 1202, minY: 660, maxX: 1242, maxY: 700 }, 'B wheel front');
    inSafe(renderer, { minX: 1090, minY: 660, maxX: 1170, maxY: 690 }, 'B part');
    // 车辆明显大于 full-arena（Closing 全景）构图
    renderer.reframe(snap, 'battle', { phase: 'Closing' });
    const closingScale = renderer.transformScale;
    expect(activeScale).toBeGreaterThan(closingScale);
    // 屏幕尺寸对比（Active 下同一 A body 屏幕更高 → 上方无效空间显著减少）
    const aHClosing = screenHeight(renderer, { minX: 300, minY: 650, maxX: 470, maxY: 700 });
    renderer.reframe(snap, 'battle', { phase: 'Active' });
    const aHActive = screenHeight(renderer, { minX: 300, minY: 650, maxX: 470, maxY: 700 });
    expect(aHActive).toBeGreaterThan(aHClosing);
  });

  it('2. Warning：适度拉远（介于 Active 与全景之间）且 A/B 仍完整入画', () => {
    const renderer = makeRenderer();
    const snap = makeBattleSnapshot();
    renderer.reframe(snap, 'battle', { phase: 'Active' });
    const activeScale = renderer.transformScale;
    renderer.reframe(snap, 'battle', { phase: 'Warning' });
    const warningScale = renderer.transformScale;
    renderer.reframe(snap, 'battle', { phase: 'Closing' });
    const closingScale = renderer.transformScale;
    expect(warningScale).toBeLessThan(activeScale); // 开始拉远
    expect(warningScale).toBeGreaterThan(closingScale); // 但未到全景那么远
    renderer.reframe(snap, 'battle', { phase: 'Warning' });
    inSafe(renderer, { minX: 300, minY: 650, maxX: 470, maxY: 700 }, 'A body');
    inSafe(renderer, { minX: 1100, minY: 656, maxX: 1220, maxY: 700 }, 'B body');
  });

  it('3. Closing：两侧有效 Closing wall + A/B 完整入画（收束全程安全）', () => {
    const renderer = makeRenderer();
    const snap = makeBattleSnapshot();
    renderer.reframe(snap, 'battle', { phase: 'Closing' });
    inSafe(renderer, { minX: 250, minY: 500, maxX: 290, maxY: 700 }, 'Closing wall L');
    inSafe(renderer, { minX: 1310, minY: 500, maxX: 1350, maxY: 700 }, 'Closing wall R');
    inSafe(renderer, { minX: 300, minY: 650, maxX: 470, maxY: 700 }, 'A body');
    inSafe(renderer, { minX: 1100, minY: 656, maxX: 1220, maxY: 700 }, 'B body');
  });

  it('4. Projectile 不参与 camera bounds（含/不含 projectile 构图结果完全一致）', () => {
    const renderer = makeRenderer();
    const snap = makeBattleSnapshot();
    const withProj: BattleRenderSnapshot = {
      ...snap,
      projectiles: [{ team: 'A', center: { x: 900, y: 600 }, radius: 10 }],
    };
    renderer.reframe(snap, 'battle', { phase: 'Active' });
    const scale1 = renderer.transformScale;
    const r1 = renderer.worldRectToScreen(300, 650, 470, 700);
    renderer.reframe(withProj, 'battle', { phase: 'Active' });
    expect(renderer.transformScale).toBe(scale1);
    const r2 = renderer.worldRectToScreen(300, 650, 470, 700);
    expect(r2.minX).toBe(r1.minX);
    expect(r2.minY).toBe(r1.minY);
    expect(r2.maxX).toBe(r1.maxX);
    expect(r2.maxY).toBe(r1.maxY);
  });
});
