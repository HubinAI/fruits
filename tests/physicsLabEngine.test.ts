/**
 * F-02M-B17B-T · 正式双引擎入口集成测试（PhysicsLab Engine Selector）。
 *
 * 只通过 PhysicsLab 公开 API 验证：
 * 1. engine 缺省 → BattleOrchestrator（Matter）；
 * 2. engine: 'matter' → BattleOrchestrator（Matter）；
 * 3. engine: 'planck' → PlanckBattleOrchestrator；
 * 4. loadCustom() 未传 engine → 仍走 Matter；
 * 5. Matter / Planck 各执行一次完整 lifecycle smoke（load / bind / step / render / clear），
 *    全程不抛错；Matter 路径真实经过 drawDebug（全量 Debug flags），Planck 路径只走正式 Renderer。
 *
 * 使用真实 Renderer + 最小 DOM canvas/context stub（node 环境无 DOM）。
 * 唯一允许的窄类型断言仅用于 DOM canvas/context stub；Orchestrator / Runtime 类型零 cast / any。
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { PhysicsLab } from '../src/lab/physicsLab';
import { Renderer } from '../src/render/renderer';
import { BattleOrchestrator } from '../src/battle/battleOrchestrator';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import type { ScenarioDef } from '../src/lab/scenarios';
import type { DebugFlags } from '../src/render/debugOverlay';
import type { BuildSnapshot } from '../src/core/types';

// ---- 最小 DOM stub（node 环境无 DOM；仅此处允许窄类型断言） ----

class FakeCtx {
  fillStyle = '';
  strokeStyle = '';
  lineWidth = 1;
  font = '';
  textAlign = 'left';
  globalAlpha = 1;
  setTransform(): void {}
  clearRect(): void {}
  fillRect(): void {}
  beginPath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  stroke(): void {}
  arc(): void {}
  fill(): void {}
  closePath(): void {}
  fillText(): void {}
}

class FakeCanvas {
  width = 1280;
  height = 720;
  clientWidth = 1280;
  clientHeight = 720;
  private ctx = new FakeCtx();
  getContext(): FakeCtx {
    return this.ctx;
  }
}

const ALL_DEBUG_FLAGS: DebugFlags = {
  collider: true,
  com: true,
  movementHardpoint: true,
  functionalHardpoint: true,
  groundedWheel: true,
  linearVelocity: true,
  angularVelocity: true,
  contactPoint: true,
  contactNormal: true,
  impulse: true,
  totalMass: true,
  inertia: true,
  lastImpact: true,
  lastDamage: true,
};

// ---- 测试用 build / scenario ----

function makeBuild(id: string): BuildSnapshot {
  return {
    id,
    bodyDefId: 'boxBody',
    quality: 1,
    movements: [
      { hardpointId: 'rear', defId: 'wheelStd' },
      { hardpointId: 'front', defId: 'wheelStd' },
    ],
    functionals: [{ hardpointId: 'front', defId: 'ramHead' }],
  };
}

function makeScenario(engine?: 'matter' | 'planck'): ScenarioDef {
  return {
    id: 'T',
    name: 'engine-selector',
    description: 'PhysicsLab engine selector integration test',
    buildA: makeBuild('A'),
    buildB: makeBuild('B'),
    config: { autoDrive: true, engine },
  };
}

function makeLab(): PhysicsLab {
  const canvas = new FakeCanvas() as unknown as HTMLCanvasElement; // 仅 DOM stub 的窄类型断言
  const renderer = new Renderer(canvas);
  return new PhysicsLab(renderer);
}

beforeAll(() => {
  // node 环境无 window；Renderer.render 读取 window.devicePixelRatio（|| 1 兜底）。
  // performance.now() 为 Node 全局，无需 stub。
  vi.stubGlobal('window', { devicePixelRatio: 1 });
});

describe('F-02M-B17B-T · PhysicsLab 双引擎入口 selector + lifecycle', () => {
  it('1. engine 缺省 → BattleOrchestrator（Matter）', () => {
    const lab = makeLab();
    lab.loadScenario(makeScenario()); // 不传 engine
    expect(lab.orchestrator).not.toBeNull();
    expect(lab.orchestrator instanceof BattleOrchestrator).toBe(true);
    expect(lab.orchestrator instanceof PlanckBattleOrchestrator).toBe(false);
    lab.clear();
    expect(lab.orchestrator).toBeNull();
  });

  it("2. engine: 'matter' → BattleOrchestrator（Matter）", () => {
    const lab = makeLab();
    lab.loadScenario(makeScenario('matter'));
    expect(lab.orchestrator).not.toBeNull();
    expect(lab.orchestrator instanceof BattleOrchestrator).toBe(true);
    expect(lab.orchestrator instanceof PlanckBattleOrchestrator).toBe(false);
    lab.clear();
    expect(lab.orchestrator).toBeNull();
  });

  it("3. engine: 'planck' → PlanckBattleOrchestrator", () => {
    const lab = makeLab();
    lab.loadScenario(makeScenario('planck'));
    expect(lab.orchestrator).not.toBeNull();
    // 仅此处进入 Planck；且 render() 的 instanceof 分支将走 else（不调 drawDebug）。
    expect(lab.orchestrator instanceof PlanckBattleOrchestrator).toBe(true);
    expect(lab.orchestrator instanceof BattleOrchestrator).toBe(false);
    lab.clear();
    expect(lab.orchestrator).toBeNull();
  });

  it('4. loadCustom() 未传 engine → 仍走 Matter', () => {
    const lab = makeLab();
    lab.loadCustom(makeBuild('A'), makeBuild('B')); // 仅 { autoDrive: true }，无 engine
    expect(lab.orchestrator).not.toBeNull();
    expect(lab.orchestrator instanceof BattleOrchestrator).toBe(true);
    expect(lab.orchestrator instanceof PlanckBattleOrchestrator).toBe(false);
    lab.clear();
    expect(lab.orchestrator).toBeNull();
  });

  it('5. Matter lifecycle smoke：load/bind/step/render/clear 不抛错（含全量 Debug overlay）', () => {
    const lab = makeLab();
    lab.loadScenario(makeScenario('matter'));
    expect(lab.orchestrator instanceof BattleOrchestrator).toBe(true);

    // 全量 Debug flags，真实驱动 drawDebug 走遍所有分支
    lab.debugFlags = { ...ALL_DEBUG_FLAGS };

    // bind（在 loadScenario→createBattle 内已完成）+ step + render（含 drawDebug）+ clear
    expect(() => {
      for (let i = 0; i < 200; i++) lab.step(1000 / 60);
      lab.render(); // Matter 分支：drawDebug(ctx, t, orch, debugFlags)
    }).not.toThrow();

    expect(() => lab.clear()).not.toThrow();
    expect(lab.orchestrator).toBeNull();
  });

  it('6. Planck lifecycle smoke：load/bind/step/render/clear 不抛错（正式 Renderer，不调 drawDebug）', () => {
    const lab = makeLab();
    lab.loadScenario(makeScenario('planck'));
    expect(lab.orchestrator instanceof PlanckBattleOrchestrator).toBe(true);
    expect(lab.orchestrator instanceof BattleOrchestrator).toBe(false);

    // 即便开全量 Debug flags，Planck 分支也不应调用 Matter-only drawDebug
    // （instanceof BattleOrchestrator 为 false → else 分支只走正式 renderer.render）。
    lab.debugFlags = { ...ALL_DEBUG_FLAGS };

    expect(() => {
      for (let i = 0; i < 200; i++) lab.step(1000 / 60);
      lab.render(); // Planck 分支：仅 renderer.render(orch)，不传 drawDebug
    }).not.toThrow();

    expect(() => lab.clear()).not.toThrow();
    expect(lab.orchestrator).toBeNull();
  });
});
