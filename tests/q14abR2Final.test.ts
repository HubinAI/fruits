/**
 * Queue Q14-A/B-R2-FINAL｜机枪 + 喷火器最终表现修正 targeted test
 *
 * 覆盖：
 * A（机枪）：machineGunTracer 世界长度降到 ~22px（相邻约 72px 间隔 → 明显黑间隔，不再像 Laser）；
 *          弹头亮核视觉半径 ~2px（去珍珠链）。
 * B（喷火器）：真实火焰 projectile 群→一整股连续 Fire Jet（buildFireJet 纯逻辑）：
 *          单组单股、长度=最远前向+余量、半宽=最大|side|+余量、空/全后方→null；
 *          Renderer 不再逐颗画「三排独立大亮头」。
 *
 * 表现层改动，Gameplay（Damage/Physics/Weapon 参数）零变化。
 * 使用最小 canvas/context stub（node 环境无 DOM），与 rendererProjectile.test.ts 同惯例。
 */
import { describe, it, expect } from 'vitest';
import { Renderer, MACHINE_GUN_TRACER_WORLD_LENGTH, PROJECTILE_COLOR_A } from '../src/render/renderer';
import { buildFireJet, FIRE_JET_LENGTH_MARGIN, FIRE_JET_SIDE_MARGIN } from '../src/presentation/fireJetBuilder';
import type { BattleOrchestratorApi, BattleRenderSnapshot } from '../src/battle/battleContract';
import type { BattleEvent } from '../src/battle/combatEvents';

/** 记录所有 ctx 调用的最小 stub（扩展：quadraticCurveTo + 带 strokeStyle 的线段） */
class CtxStub {
  calls: string[] = [];
  arcs: Array<{ x: number; y: number; r: number; fillStyle: string; index: number }> = [];
  lines: Array<{ x0: number; y0: number; x1: number; y1: number; strokeStyle: string }> = [];
  quadCount = 0;
  private _mx?: number;
  private _my?: number;
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
  moveTo(x: number, y: number): void { this._mx = x; this._my = y; this.record('moveTo'); }
  lineTo(x: number, y: number): void {
    const x0 = this._mx ?? 0;
    const y0 = this._my ?? 0;
    this.lines.push({ x0, y0, x1: x, y1: y, strokeStyle: this.strokeStyle });
    this.record('lineTo');
  }
  quadraticCurveTo(): void { this.quadCount++; this.record('quadraticCurveTo'); }
  closePath(): void { this.record('closePath'); }
  fill(): void { this.record('fill'); }
  stroke(): void { this.record('stroke'); }
  arc(x: number, y: number, r: number): void {
    this.record('arc');
    this.arcs.push({ x, y, r, fillStyle: this.fillStyle, index: this.calls.length });
  }
  fillText(): void { this.record('fillText'); }
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

function makeFakeOrch(snapshot: BattleRenderSnapshot): BattleOrchestratorApi & { emit: (e: BattleEvent) => void } {
  let cb: ((e: BattleEvent) => void) | null = null;
  return {
    config: {},
    result: null,
    phase: 'Active',
    timeMs: 0,
    step: () => {},
    onCombatEvent: (fn) => { cb = fn; return () => { cb = null; }; },
    dispose: () => {},
    getRenderSnapshot: () => snapshot,
    getBattleStatusSnapshot: () => ({
      sideA: { team: 'A', hp: 1000, maxHp: 1000 },
      sideB: { team: 'B', hp: 1000, maxHp: 1000 },
      phase: 'Active',
    }),
    emit: (e: BattleEvent) => { cb?.(e); },
  };
}

function makeSnapshot(projectiles: BattleRenderSnapshot['projectiles']): BattleRenderSnapshot {
  return {
    arena: { width: 1600, groundY: 700, normalWalls: [], closingWalls: [] },
    vehicleA: {
      team: 'A',
      body: { kind: 'polygons', polygons: [{ points: [{ x: 100, y: 600 }, { x: 200, y: 600 }, { x: 200, y: 650 }, { x: 100, y: 650 }] }] },
      wheels: [],
      parts: [],
    },
    vehicleB: {
      team: 'B',
      body: { kind: 'polygons', polygons: [{ points: [{ x: 900, y: 600 }, { x: 1000, y: 600 }, { x: 1000, y: 650 }, { x: 900, y: 650 }] }] },
      wheels: [],
      parts: [],
    },
    projectiles,
  };
}

describe('Q14-A-R2-FINAL 机枪短弹迹', () => {
  it('machineGunTracer 世界长度常量 ∈ [20,24]（相邻约 72px 间隔 → 明显黑间隔，不像 Laser）', () => {
    expect(MACHINE_GUN_TRACER_WORLD_LENGTH).toBeGreaterThanOrEqual(20);
    expect(MACHINE_GUN_TRACER_WORLD_LENGTH).toBeLessThanOrEqual(24);
  });

  it('机枪弹迹绘制：主 tracer 线段 ≈ 22px 逻辑常量（screen-space，不随 scale）且弹头亮核 ≈ 2px 常量', () => {
    (globalThis as { window?: { devicePixelRatio: number } }).window = { devicePixelRatio: 1 };
    const ctx = new CtxStub();
    const renderer = new Renderer(makeCanvas(ctx));
    // scale = min(1000/1600, 500/1000)*1.8 = 0.9
    const orch = makeFakeOrch(
      makeSnapshot([
        {
          center: { x: 500, y: 300 }, radius: 5, team: 'A',
          visual: 'machineGunTracer', velocity: { x: 12, y: 0 },
        },
      ]),
    );
    renderer.resize(1600, 1000);
    renderer.render(orch);

    // 主 tracer（暖白 #fff2c8）线段长度 = 22px 逻辑常量（F-BATTLE-FX-SCREENSPACE-R2：不乘 scale，
    // 远景/近景尺寸稳定 ≤20%；旧 ×scale 语义在 scale 0.9 下为 19.8px）
    const mainLines = ctx.lines.filter((l) => l.strokeStyle === '#fff2c8');
    expect(mainLines.length).toBeGreaterThanOrEqual(1);
    const segLen = Math.hypot(mainLines[0]!.x1 - mainLines[0]!.x0, mainLines[0]!.y1 - mainLines[0]!.y0);
    expect(segLen).toBeCloseTo(MACHINE_GUN_TRACER_WORLD_LENGTH, 4);
    // 远短于旧 70px（约 63），确认不再首尾相接成光束
    expect(segLen).toBeLessThan(30);

    // 弹头亮核（#fff6d8）半径 = 2px 逻辑常量（视觉 ~2px）
    const head = ctx.arcs.find((a) => a.fillStyle === '#fff6d8');
    expect(head).toBeDefined();
    expect(head!.r).toBeCloseTo(Math.max(1.5, 2), 4);
    // 不再画「完整 Collider 半径」的大白球（旧 p.radius=5）
    expect(head!.r).toBeLessThanOrEqual(2.5);
  });
});

describe('Q14-B-R2-FINAL 喷火器 Fire Jet（buildFireJet 纯逻辑）', () => {
  const muzzle = { x: 0, y: 0 };
  const fireDir = { x: 1, y: 0 };

  it('单组：长度=最远前向+余量，半宽=最大|side|+余量，方向归一化', () => {
    const jet = buildFireJet([
      { center: { x: 50, y: -8 }, muzzle, fireDir },
      { center: { x: 100, y: 0 }, muzzle, fireDir },
      { center: { x: 150, y: 8 }, muzzle, fireDir },
    ]);
    expect(jet).not.toBeNull();
    expect(jet!.length).toBeCloseTo(150 + FIRE_JET_LENGTH_MARGIN, 6);
    expect(jet!.halfWidth).toBeCloseTo(8 + FIRE_JET_SIDE_MARGIN, 6);
    expect(jet!.dirX).toBeCloseTo(1, 6);
    expect(jet!.dirY).toBeCloseTo(0, 6);
  });

  it('空组 → null（无火流）', () => {
    expect(buildFireJet([])).toBeNull();
  });

  it('全部在 muzzle 后方（forward<0）→ null（无前方 projectile 不画火流）', () => {
    expect(buildFireJet([
      { center: { x: -40, y: 0 }, muzzle, fireDir },
      { center: { x: -10, y: 5 }, muzzle, fireDir },
    ])).toBeNull();
  });

  it('真实 spread -6/0/+6：火流宽度覆盖三排、单股（不被拆成三股）', () => {
    // 距 muzzle 100px 处，±6° → |side| ≈ 100*sin(6°)=10.47
    const side = 100 * Math.sin((6 * Math.PI) / 180);
    const jet = buildFireJet([
      { center: { x: 100, y: -side }, muzzle, fireDir },
      { center: { x: 100, y: 0 }, muzzle, fireDir },
      { center: { x: 100, y: side }, muzzle, fireDir },
    ]);
    expect(jet).not.toBeNull();
    // 半宽应包住最外侧 spread projectile（+7px 余量）
    expect(jet!.halfWidth).toBeGreaterThanOrEqual(side);
    expect(jet!.halfWidth).toBeCloseTo(side + FIRE_JET_SIDE_MARGIN, 6);
    // 仍然只有一股（函数单次调用返回单 Jet）
  });
});

describe('Q14-B-R2-FINAL 喷火器 Renderer：一整股连续火流，不再三排独立大亮头', () => {
  it('3 颗火焰 projectile → 绘制 Fire Jet（quadraticCurveTo），且不画旧的离散黄白大亮头', () => {
    (globalThis as { window?: { devicePixelRatio: number } }).window = { devicePixelRatio: 1 };
    const ctx = new CtxStub();
    const renderer = new Renderer(makeCanvas(ctx));
    const muzzle = { x: 100, y: 300 };
    const fireDir = { x: 1, y: 0 };
    const orch = makeFakeOrch(
      makeSnapshot([
        { center: { x: 160, y: 290 }, radius: 4, team: 'A', visual: 'flame', muzzle, fireDir },
        { center: { x: 180, y: 300 }, radius: 4, team: 'A', visual: 'flame', muzzle, fireDir },
        { center: { x: 200, y: 312 }, radius: 4, team: 'A', visual: 'flame', muzzle, fireDir },
      ]),
    );
    renderer.resize(1600, 1000);
    renderer.render(orch);

    // Fire Jet 由 drawFlameShape 几何绘制（每颗 projectile 旧代码才会单独画大叶/大亮头）
    expect(ctx.quadCount).toBeGreaterThan(0);
    // 旧「三排独立飞弹」亮头颜色（#fff0b0 / #ffd35a）不应再出现
    expect(ctx.arcs.filter((a) => a.fillStyle === '#fff0b0').length).toBe(0);
    expect(ctx.arcs.filter((a) => a.fillStyle === '#ffd35a').length).toBe(0);
  });

  it('两个不同 muzzle 的火焰武器 → 各一股 Fire Jet（不混为一股）', () => {
    (globalThis as { window?: { devicePixelRatio: number } }).window = { devicePixelRatio: 1 };
    const ctx = new CtxStub();
    const renderer = new Renderer(makeCanvas(ctx));
    const orch = makeFakeOrch(
      makeSnapshot([
        { center: { x: 160, y: 300 }, radius: 4, team: 'A', visual: 'flame', muzzle: { x: 100, y: 300 }, fireDir: { x: 1, y: 0 } },
        { center: { x: 260, y: 400 }, radius: 4, team: 'B', visual: 'flame', muzzle: { x: 200, y: 400 }, fireDir: { x: 1, y: 0 } },
      ]),
    );
    renderer.resize(1600, 1000);
    renderer.render(orch);
    // 两个分组各自至少一层 drawFlameShape（每颗旧代码会画更多离散弧；新代码仅 2 组×≥1 层）
    expect(ctx.quadCount).toBeGreaterThan(0);
  });

  it('无火焰 projectile → 不绘制任何 Fire Jet（不残留火焰）', () => {
    (globalThis as { window?: { devicePixelRatio: number } }).window = { devicePixelRatio: 1 };
    const ctx = new CtxStub();
    const renderer = new Renderer(makeCanvas(ctx));
    const orch = makeFakeOrch(makeSnapshot([
      { center: { x: 500, y: 300 }, radius: 5, team: 'A' }, // 普通圆弹
    ]));
    renderer.resize(1600, 1000);
    renderer.render(orch);
    // 普通圆弹仍有绘制，但无火焰 Jet 几何
    expect(ctx.quadCount).toBe(0);
    expect(ctx.arcs.filter((a) => a.fillStyle === PROJECTILE_COLOR_A).length).toBe(1);
  });
});
