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
import { describe, it, expect, afterEach } from 'vitest';
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

// 测试隔离：本文件多处改写全局 window.devicePixelRatio（含 Q08 设 2），
// 若无还原会泄漏到后续独立 phoneLogical 路径测试（读 window.devicePixelRatio）→ 全量 suite 红。
// 每个用例后复位为安全默认，避免污染进程级全局。
afterEach(() => {
  (globalThis as { window?: { devicePixelRatio: number } }).window = { devicePixelRatio: 1 };
});

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

function makeCanvas(ctx: CtxStub, w = 1000, h = 500) {
  return {
    width: 0,
    height: 0,
    clientWidth: w,
    clientHeight: h,
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
 *  含双轮 + 多 functional parts（pushRod/cannon/hammer）+ 左右两堵 Closing wall。
 *  Q08-A-FIX：带真实 Visual（bodyVisual/wheelVisuals/part.visual）——banana bodyVisual
 *  200 宽（半宽 100）明确大于其 collider（两段合并半宽 95），用于抓「Collider 在框内
 *  但 Sprite 出框」的旧 bug。 */
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
      bodyVisual: {
        visualId: 'body_watermelon',
        position: { x: 385, y: 675 },
        rotation: 0,
        size: { width: 180, height: 60 },
        layer: 1,
      },
      wheels: [
        { center: { x: 327, y: 680 }, radius: 20, angle: 0 },
        { center: { x: 443, y: 680 }, radius: 20, angle: 0 },
      ],
      wheelVisuals: [
        { visualId: 'wheel', position: { x: 327, y: 680 }, rotation: 0, size: { width: 40, height: 40 }, layer: 2 },
        { visualId: 'wheel', position: { x: 443, y: 680 }, rotation: 0, size: { width: 40, height: 40 }, layer: 2 },
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
      // Q08-A-FIX：banana bodyVisual 200 宽（半宽 100）> collider 半宽 95 ——
      // 只含 Collider 的旧 framing 会漏掉 sprite 边缘。
      bodyVisual: {
        visualId: 'body_banana',
        position: { x: 1160, y: 678 },
        rotation: 0,
        size: { width: 200, height: 56 },
        layer: 1,
      },
      wheels: [
        { center: { x: 1098, y: 680 }, radius: 20, angle: 0 },
        { center: { x: 1222, y: 680 }, radius: 20, angle: 0 },
      ],
      wheelVisuals: [
        { visualId: 'wheel', position: { x: 1098, y: 680 }, rotation: 0, size: { width: 40, height: 40 }, layer: 2 },
        { visualId: 'wheel', position: { x: 1222, y: 680 }, rotation: 0, size: { width: 40, height: 40 }, layer: 2 },
      ],
      parts: [
        {
          shape: { kind: 'polygons', polygons: [{ points: [{ x: 1090, y: 660 }, { x: 1170, y: 660 }, { x: 1170, y: 690 }, { x: 1090, y: 690 }] }] },
          category: 'weapon',
          visual: {
            visualId: 'part_pushRod',
            position: { x: 1130, y: 675 },
            rotation: 0,
            size: { width: 98, height: 18 },
            layer: 10,
          },
        },
      ],
    },
  };
}

describe('Q08-A Battle Camera 正常观看构图', () => {
  function makeRenderer(): Renderer {
    const ctx = new CtxStub();
    // F-WX-8-C：Q08-A 是 Desktop corridor 语义守卫——显式 1280×720（h≥600 非 compact），
    // 避免 1000×500 被 isCompactLandscape 误归为手机横屏而走 Mobile corridor。
    const renderer = new Renderer(makeCanvas(ctx, 1280, 720));
    (globalThis as { window?: { devicePixelRatio: number } }).window = { devicePixelRatio: 1 };
    renderer.resize(1600, 1000);
    return renderer;
  }
  const SAFE_X = 56, SAFE_Y = 28, CW = 1280, CH = 720;

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

  it('1. Active/Closing：A/B body + wheel + functional parts 完整入画，Closing 尺度相对 Active ≤15%（不骤缩）', () => {
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
    // F-BATTLE-CAMERA-R2：Closing 不因两侧墙骤缩——尺度相对 Active ≤15%
    renderer.reframe(snap, 'battle', { phase: 'Closing' });
    const closingScale = renderer.transformScale;
    expect(Math.abs(closingScale - activeScale) / activeScale, 'Closing 相对 Active 尺度变化 ≤15%').toBeLessThanOrEqual(0.15);
    // 屏幕尺寸对比（同一 A body 屏幕高度变化 ≤20%）
    const aHClosing = screenHeight(renderer, { minX: 300, minY: 650, maxX: 470, maxY: 700 });
    renderer.reframe(snap, 'battle', { phase: 'Active' });
    const aHActive = screenHeight(renderer, { minX: 300, minY: 650, maxX: 470, maxY: 700 });
    expect(Math.abs(aHClosing - aHActive) / aHActive, 'Closing 车辆屏幕高度相对 Active ≤20%').toBeLessThanOrEqual(0.2);
  });

  it('2. Warning/Closing：尺度相对 Active 均 ≤15%（同 envelope 构图，无全景骤缩）且 A/B 完整入画', () => {
    const renderer = makeRenderer();
    const snap = makeBattleSnapshot();
    renderer.reframe(snap, 'battle', { phase: 'Active' });
    const activeScale = renderer.transformScale;
    renderer.reframe(snap, 'battle', { phase: 'Warning' });
    const warningScale = renderer.transformScale;
    renderer.reframe(snap, 'battle', { phase: 'Closing' });
    const closingScale = renderer.transformScale;
    expect(Math.abs(warningScale - activeScale) / activeScale, 'Warning 相对 Active ≤15%').toBeLessThanOrEqual(0.15);
    expect(Math.abs(closingScale - activeScale) / activeScale, 'Closing 相对 Active ≤15%').toBeLessThanOrEqual(0.15);
    renderer.reframe(snap, 'battle', { phase: 'Warning' });
    inSafe(renderer, { minX: 300, minY: 650, maxX: 470, maxY: 700 }, 'A body');
    inSafe(renderer, { minX: 1100, minY: 656, maxX: 1220, maxY: 700 }, 'B body');
  });

  it('3. Closing：收束墙从画面边缘进入、不遮挡车辆——A/B 完整入画且墙在车辆外侧', () => {
    const renderer = makeRenderer();
    const snap = makeBattleSnapshot();
    renderer.reframe(snap, 'battle', { phase: 'Closing' });
    inSafe(renderer, { minX: 300, minY: 650, maxX: 470, maxY: 700 }, 'A body');
    inSafe(renderer, { minX: 1100, minY: 656, maxX: 1220, maxY: 700 }, 'B body');
    // F-BATTLE-CAMERA-R2：墙不进入画面中央（车辆主体区）——从画面边缘进入
    const wallL = renderer.worldRectToScreen(250, 500, 290, 700);
    const wallR = renderer.worldRectToScreen(1310, 500, 1350, 700);
    const a = renderer.worldRectToScreen(300, 650, 470, 700);
    const b = renderer.worldRectToScreen(1100, 656, 1220, 700);
    expect(wallL.maxX, '左墙在 A 车辆左侧（不遮挡车辆）').toBeLessThanOrEqual(a.minX + 1);
    expect(wallR.minX, '右墙在 B 车辆右侧（不遮挡车辆）').toBeGreaterThanOrEqual(b.maxX - 1);
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

/* ---------- Q08-A-FIX：Battle Camera 出框根因修复（Visual 完整入画 + 固定 corridor） ---------- */

/** 视觉 AABB（position 为中心 + size + rotation；mirror 不影响）——与 renderer includeVisual 同语义 */
function visualAABB(v: { position: { x: number; y: number }; rotation: number; size: { width: number; height: number } }): {
  minX: number; minY: number; maxX: number; maxY: number;
} {
  const hw = v.size.width / 2, hh = v.size.height / 2;
  const cos = Math.cos(v.rotation), sin = Math.sin(v.rotation);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of [
    { x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh },
  ]) {
    const rx = c.x * cos - c.y * sin + v.position.x;
    const ry = c.x * sin + c.y * cos + v.position.y;
    if (rx < minX) minX = rx;
    if (rx > maxX) maxX = rx;
    if (ry < minY) minY = ry;
    if (ry > maxY) maxY = ry;
  }
  return { minX, minY, maxX, maxY };
}

describe('Q08-A-FIX Battle Camera 出框根因', () => {
  function makeRenderer(): Renderer {
    const ctx = new CtxStub();
    // F-WX-8-C：同 Q08-A——Desktop corridor 语义守卫，显式 1280×720（非 compact）
    const renderer = new Renderer(makeCanvas(ctx, 1280, 720));
    (globalThis as { window?: { devicePixelRatio: number } }).window = { devicePixelRatio: 1 };
    renderer.resize(1600, 1000);
    return renderer;
  }
  const SAFE_X = 56, SAFE_Y = 28, CW = 1280, CH = 720;

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

  function expectVehicleVisualsInView(renderer: Renderer, v: BattleRenderSnapshot['vehicleA'], label: string): void {
    if (v.bodyVisual) inSafe(renderer, visualAABB(v.bodyVisual), `${label} bodyVisual`);
    for (let i = 0; i < (v.wheelVisuals?.length ?? 0); i++) {
      const wv = v.wheelVisuals![i];
      if (wv) inSafe(renderer, visualAABB(wv), `${label} wheelVisual${i}`);
    }
    for (let i = 0; i < v.parts.length; i++) {
      const pv = v.parts[i].visual;
      if (pv) inSafe(renderer, visualAABB(pv), `${label} partVisual${i}`);
    }
  }

  it('1. Active：默认 watermelon/banana 双方全部 Visual 完整入画（corridor，非瞬时 fit）', () => {
    const renderer = makeRenderer();
    const snap = makeBattleSnapshot();
    renderer.reframe(snap, 'battle', { phase: 'Active' });
    expectVehicleVisualsInView(renderer, snap.vehicleA, 'A');
    expectVehicleVisualsInView(renderer, snap.vehicleB, 'B');
  });

  it('2. Active corridor：A/B 分别向左右额外偏移后 Visual 仍完整（碰撞/后坐/Push 位移容忍）', () => {
    const renderer = makeRenderer();
    const snap = makeBattleSnapshot();
    // 真实可发生位移：A 左移 150（中心 250）、B 右移 150（中心 1350）
    snap.vehicleA.bodyVisual = { ...snap.vehicleA.bodyVisual!, position: { x: 250, y: 675 } };
    snap.vehicleB.bodyVisual = { ...snap.vehicleB.bodyVisual!, position: { x: 1350, y: 678 } };
    snap.vehicleB.parts[0].visual = { ...snap.vehicleB.parts[0].visual!, position: { x: 1320, y: 675 } };
    renderer.reframe(snap, 'battle', { phase: 'Active' });
    // corridor 固定 [130,1540]（Q08-CAM-D1：右界锚定 arena 右缘 1600−60）：
    // A visual 左缘 250−90=160 ≥ 130；B visual 右缘 1350+100=1450 ≤ 1540
    inSafe(renderer, visualAABB(snap.vehicleA.bodyVisual!), 'A bodyVisual');
    inSafe(renderer, visualAABB(snap.vehicleB.bodyVisual!), 'B bodyVisual');
    inSafe(renderer, visualAABB(snap.vehicleB.parts[0].visual!), 'B partVisual');
  });

  it('2b. Q08-CAM-D1：A 顶推 B 交战团右移到实测可达位置（B visual 右缘 1534，Runtime 实测）Active 下仍完整', () => {
    const renderer = makeRenderer();
    const snap = makeBattleSnapshot();
    // 变体诊断实测：Active 阶段 B 被 A 顶推，B visual 右缘可达 1534.7（> 旧 corridor 1470 → 出框）
    snap.vehicleA.bodyVisual = { ...snap.vehicleA.bodyVisual!, position: { x: 1120, y: 675 } };
    snap.vehicleB.bodyVisual = { ...snap.vehicleB.bodyVisual!, position: { x: 1434, y: 678 } }; // 右缘 1534
    snap.vehicleB.parts[0].visual = { ...snap.vehicleB.parts[0].visual!, position: { x: 1400, y: 675 } };
    renderer.reframe(snap, 'battle', { phase: 'Active' });
    // 修复后 corridor 右界 1540（+margin 64 吸收）→ 完整入画
    inSafe(renderer, visualAABB(snap.vehicleB.bodyVisual!), 'B bodyVisual(实测右移位置)');
    inSafe(renderer, visualAABB(snap.vehicleA.bodyVisual!), 'A bodyVisual');
    // F-BATTLE-CAMERA-R2：Closing 不骤缩——相对 Active ≤15%
    renderer.reframe(snap, 'battle', { phase: 'Closing' });
    const closingScale = renderer.transformScale;
    renderer.reframe(snap, 'battle', { phase: 'Active' });
    expect(Math.abs(closingScale - renderer.transformScale) / renderer.transformScale, 'Closing 相对 Active ≤15%').toBeLessThanOrEqual(0.15);
  });

  it('3. Warning/Closing：尺度相对 Active 均 ≤15%（同 envelope 构图），两车 Visual 完整可见', () => {
    const renderer = makeRenderer();
    const snap = makeBattleSnapshot();
    renderer.reframe(snap, 'battle', { phase: 'Warning' });
    expectVehicleVisualsInView(renderer, snap.vehicleA, 'A');
    expectVehicleVisualsInView(renderer, snap.vehicleB, 'B');
    renderer.reframe(snap, 'battle', { phase: 'Active' });
    const activeScale = renderer.transformScale;
    renderer.reframe(snap, 'battle', { phase: 'Warning' });
    const warningScale = renderer.transformScale;
    renderer.reframe(snap, 'battle', { phase: 'Closing' });
    const closingScale = renderer.transformScale;
    expect(Math.abs(warningScale - activeScale) / activeScale, 'Warning 相对 Active ≤15%').toBeLessThanOrEqual(0.15);
    expect(Math.abs(closingScale - activeScale) / activeScale, 'Closing 相对 Active ≤15%').toBeLessThanOrEqual(0.15);
  });

  it('4. Closing：两车 Visual 完整入画；收束墙从画面边缘进入、不遮挡车辆', () => {
    const renderer = makeRenderer();
    const snap = makeBattleSnapshot();
    renderer.reframe(snap, 'battle', { phase: 'Closing' });
    expectVehicleVisualsInView(renderer, snap.vehicleA, 'A');
    expectVehicleVisualsInView(renderer, snap.vehicleB, 'B');
    // F-BATTLE-CAMERA-R2：墙不进入画面中央（车辆主体区）——从画面边缘进入
    const wallL = renderer.worldRectToScreen(250, 500, 290, 700);
    const wallR = renderer.worldRectToScreen(1310, 500, 1350, 700);
    const a = renderer.worldRectToScreen(300, 650, 470, 700);
    const b = renderer.worldRectToScreen(1100, 656, 1220, 700);
    expect(wallL.maxX, '左墙在 A 车辆左侧（不遮挡车辆）').toBeLessThanOrEqual(a.minX + 1);
    expect(wallR.minX, '右墙在 B 车辆右侧（不遮挡车辆）').toBeGreaterThanOrEqual(b.maxX - 1);
  });

  it('5. banana visual 明确大于 collider：只含 Collider 的旧 framing 会让 Sprite 出框（本实现必须抓住）', () => {
    const renderer = makeRenderer();
    const snap = makeBattleSnapshot();
    // 构造 visual 240 宽（半宽 120）> collider 半宽 95：旧实现（不含 visual）下
    // B collider 完整入画但 Sprite 右缘出框（sx≈983 > 944）；新实现 bounds 含 visual → 完整。
    snap.vehicleB.bodyVisual = {
      ...snap.vehicleB.bodyVisual!,
      size: { width: 240, height: 60 },
      position: { x: 1160, y: 678 },
    };
    renderer.reframe(snap, 'preview');
    // 断言真实 Visual 完整（preview fit 也用 fitLimit，完整入画是硬约束）
    inSafe(renderer, visualAABB(snap.vehicleB.bodyVisual!), 'B bodyVisual(sprite>collider)');
    // 对照：collider 一定完整（Visual 包含后其内缩范围自然完整）
    inSafe(renderer, { minX: 1100, minY: 656, maxX: 1220, maxY: 700 }, 'B collider');
  });

  it('6. Projectile 位置变化不影响 camera（不同位置两次构图结果一致）', () => {
    const renderer = makeRenderer();
    const snap = makeBattleSnapshot();
    const projFar: BattleRenderSnapshot = { ...snap, projectiles: [{ team: 'A', center: { x: 2000, y: 50 }, radius: 30 }] };
    const projNear: BattleRenderSnapshot = { ...snap, projectiles: [{ team: 'B', center: { x: 800, y: 660 }, radius: 10 }] };
    renderer.reframe(projFar, 'battle', { phase: 'Active' });
    const scale1 = renderer.transformScale;
    const a1 = renderer.worldRectToScreen(300, 650, 470, 700);
    const b1 = renderer.worldRectToScreen(1100, 656, 1220, 700);
    renderer.reframe(projNear, 'battle', { phase: 'Active' });
    expect(renderer.transformScale).toBe(scale1);
    const a2 = renderer.worldRectToScreen(300, 650, 470, 700);
    const b2 = renderer.worldRectToScreen(1100, 656, 1220, 700);
    expect(a2.minX).toBe(a1.minX);
    expect(a2.maxX).toBe(a1.maxX);
    expect(b2.minY).toBe(b1.minY);
    expect(b2.maxY).toBe(b1.maxY);
  });
});

/* ---------- Q08-C：Combat Feedback 去遮挡（白描边而非白块填充 + 同 team 去重） ---------- */
describe('Q08-C 受击反馈去遮挡', () => {
  it('连续同 team 命中不叠加整块白 fill，受击反馈走白描边轮廓（保留可感知不遮身份）', () => {
    const ctx = new CtxStub();
    const renderer = new Renderer(makeCanvas(ctx));
    (globalThis as { window?: { devicePixelRatio: number } }).window = { devicePixelRatio: 1 };
    renderer.resize(1600, 1000);
    const orch = makeFakeOrch('Active');
    // 1 次命中 → render
    renderer.spawnHitFlash('A');
    renderer.render(orch);
    const fillAfter1 = ctx.calls.filter((c) => c === 'fill').length;
    // 同一 team 再连击 2 次（去重刷新，不 push 叠加）→ 清空计数后 render
    ctx.calls.length = 0;
    renderer.spawnHitFlash('A');
    renderer.spawnHitFlash('A');
    renderer.render(orch);
    const fillAfter3 = ctx.calls.filter((c) => c === 'fill').length;
    // Q08-C 核心：连续命中不叠加——两次 render 的 fill 计数一致（旧实现整块白 fill
    // 会 3→5 递增）；且 fillStyle 未被覆盖成 #ffffff 白块色。
    expect(fillAfter3).toBe(fillAfter1);
    expect(ctx.fillStyle).not.toBe('#ffffff');
    // 受击反馈仍可感知：白描边轮廓（stroke 调用存在，来自 hitFlash strokeShape）
    expect(ctx.calls.filter((c) => c === 'stroke').length).toBeGreaterThan(0);
  });
});

/* ---------- Q08-CAM-A1：Canvas backing 尺寸与 client size × DPR 同步契约 ---------- */
describe('Q08-CAM-A1 Canvas backing 同步', () => {
  it('renderer.resize 以 clientWidth/Height × DPR 重设 canvas backing（布局切换后调用即一致）', () => {
    const canvas = makeCanvas(new CtxStub()); // clientWidth 1000 / clientHeight 500
    const renderer = new Renderer(canvas);
    (globalThis as { window?: { devicePixelRatio: number } }).window = { devicePixelRatio: 2 };
    renderer.resize(1600, 1000);
    // 根因契约：backing 必须 = clientSize × DPR；若布局切换（面板显隐）后不调
    // resize/doResize，backing 停留在旧 clientSize → 与 CSS 尺寸不匹配 → 构图裁切。
    expect(canvas.width).toBe(1000 * 2);
    expect(canvas.height).toBe(500 * 2);
  });
});
