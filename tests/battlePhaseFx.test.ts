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
});
