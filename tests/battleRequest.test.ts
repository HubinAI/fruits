/**
 * Queue W1-ASYNC-1｜Async Battle Contract + Deterministic Seed targeted test
 *
 * 覆盖 W1-ASYNC-1 验收：
 * 1. BattleRequest 合同字段齐全（battleId/buildA/buildB/config/randomSeed/rulesVersion/contentVersion）；
 * 2. 同 request 重建两次 → 输入一致（确定性：同初始车辆状态）；
 * 3. deterministicTieBreak：同 seed 永远同结果；存在两个 seed 分别产生 A / B；
 *    mulberry32 同 seed 同序列、输出在 [0,1)；
 * 4. battleResultWithMeta：metadata 完整携带（battleId/rulesVersion/contentVersion/durationMs），
 *    胜负规则不变（winner/hp/phase 原样）；
 * 5. 旧入口兼容：PhysicsLab.loadCustom（Matter 默认）/ loadCustomPreview / resolveBattleResult
 *    旧路径不受影响（无 metadata 也能正常产生结果）。
 */
import { describe, it, expect } from 'vitest';
import { createRegistry } from '../src/core/content';
import {
  deterministicTieBreak,
  mulberry32,
  resolveBattleResult,
  type BattleRequest,
} from '../src/battle/battleContract';
import {
  createPlanckBattle,
  battleResultWithMeta,
} from '../src/battle/battleRequestAdapter';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import { PhysicsLab } from '../src/lab/physicsLab';
import { BattleOrchestrator } from '../src/battle/battleOrchestrator';
import type { BuildSnapshot } from '../src/core/types';
import type { Renderer } from '../src/render/renderer';

const registry = createRegistry();
const rendererStub = { bind: () => {} } as unknown as Renderer;

function wheels() {
  return [
    { hardpointId: 'rear', defId: 'wheelStd' },
    { hardpointId: 'front', defId: 'wheelStd' },
  ];
}

function build(id: string, part: string): BuildSnapshot {
  return {
    id,
    bodyDefId: 'boxBody',
    quality: 1,
    movements: wheels(),
    functionals: part ? [{ hardpointId: 'front', defId: part }] : [],
  };
}

function makeRequest(seed: number, battleId = 'b-1'): BattleRequest {
  return {
    battleId,
    buildA: build('customA', 'cannon'),
    buildB: build('customB', 'cannon'),
    config: {
      autoDrive: true,
      engine: 'planck',
      spawnA: { x: 400, y: 640, facing: 1 },
      spawnB: { x: 1400, y: 640, facing: -1 },
    },
    randomSeed: seed,
    rulesVersion: 'v1.0.0',
    contentVersion: 'c1',
  };
}

describe('W1-ASYNC-1 Async Battle Contract', () => {
  it('1. BattleRequest 合同字段齐全', () => {
    const req = makeRequest(42);
    expect(req.battleId).toBe('b-1');
    expect(req.buildA.id).toBe('customA');
    expect(req.buildB.id).toBe('customB');
    expect(req.config.engine).toBe('planck');
    expect(req.randomSeed).toBe(42);
    expect(req.rulesVersion).toBe('v1.0.0');
    expect(req.contentVersion).toBe('c1');
  });

  it('2. 同 request 重建两次 → 输入一致（确定性初始状态）', () => {
    const req = makeRequest(1234);
    const o1 = createPlanckBattle(req, registry);
    const o2 = createPlanckBattle(req, registry);
    expect(o1).not.toBe(o2); // 独立实例
    // 同 Build 输入
    expect(o1.vehicleA.id).toBe(o2.vehicleA.id);
    expect(o1.vehicleB.id).toBe(o2.vehicleB.id);
    // 同 spawn → settle 后初始位置一致（确定性）
    const p1 = o1.world.getPosition(o1.vehicleA.body);
    const p2 = o2.world.getPosition(o2.vehicleA.body);
    expect(p1.x).toBeCloseTo(p2.x, 6);
    expect(p1.y).toBeCloseTo(p2.y, 6);
    const q1 = o1.world.getPosition(o1.vehicleB.body);
    const q2 = o2.world.getPosition(o2.vehicleB.body);
    expect(q1.x).toBeCloseTo(q2.x, 6);
    expect(q1.y).toBeCloseTo(q2.y, 6);
  });

  it('3a. deterministicTieBreak：同 seed 永远同结果', () => {
    for (const seed of [0, 1, 7, 42, 999999, 4294967295]) {
      const a = deterministicTieBreak(seed);
      const b = deterministicTieBreak(seed);
      expect(a).toBe(b);
      expect(a === 'A' || a === 'B').toBe(true);
    }
  });

  it('3b. 两个 seed 证明 A / B 两种结果都可产生；mulberry32 确定性序列', () => {
    let seedA = -1;
    let seedB = -1;
    for (let s = 0; s < 64; s++) {
      const r = deterministicTieBreak(s);
      if (r === 'A' && seedA < 0) seedA = s;
      if (r === 'B' && seedB < 0) seedB = s;
      if (seedA >= 0 && seedB >= 0) break;
    }
    expect(seedA).toBeGreaterThanOrEqual(0);
    expect(seedB).toBeGreaterThanOrEqual(0);
    expect(deterministicTieBreak(seedA)).toBe('A');
    expect(deterministicTieBreak(seedB)).toBe('B');

    // mulberry32：同 seed 同序列、值域 [0,1)
    const g1 = mulberry32(7);
    const g2 = mulberry32(7);
    const seq1: number[] = [];
    for (let i = 0; i < 5; i++) {
      const v = g1();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      seq1.push(v);
    }
    for (let i = 0; i < 5; i++) {
      expect(g2()).toBe(seq1[i]); // 同 seed 序列一致
    }
  });

  it('4. battleResultWithMeta：metadata 完整携带，胜负规则不变', () => {
    const req = makeRequest(42, 'battle-xyz');
    const o = createPlanckBattle(req, registry);
    expect(o.result).toBeNull();
    expect(battleResultWithMeta(o, req)).toBeNull(); // 未结束 → null

    // 结束（B.hp=0 → A 胜；胜负规则不变）
    o.vehicleB.hp = 0;
    o.step(1000 / 60);
    const r = battleResultWithMeta(o, req);
    expect(r).not.toBeNull();
    expect(r!.winner).toBe('A');
    expect(r!.phase).toBe('End');
    expect(r!.hpB).toBe(0);
    expect(r!.battleId).toBe('battle-xyz');
    expect(r!.rulesVersion).toBe('v1.0.0');
    expect(r!.contentVersion).toBe('c1');
    expect(r!.durationMs).toBeGreaterThanOrEqual(0);
    expect(o.timeMs).toBe(r!.durationMs);
  });

  it('5. 旧入口兼容：loadCustom（Matter）/ loadCustomPreview / resolveBattleResult 旧路径不受影响', () => {
    // PhysicsLab.loadCustom 缺省 → Matter（Q06-F1 语义保留）
    const lab = new PhysicsLab(rendererStub);
    lab.loadCustom(build('A', 'cannon'), build('B', 'cannon'));
    expect(lab.orchestrator instanceof BattleOrchestrator).toBe(true);

    // loadCustomPreview → Planck previewMode
    lab.loadCustomPreview(build('A', 'cannon'), build('B', 'cannon'));
    expect(lab.orchestrator instanceof PlanckBattleOrchestrator).toBe(true);
    expect(lab.previewMode).toBe(true);

    // resolveBattleResult 旧路径：无 metadata 字段也能正常产生结果（向后兼容）
    const old = resolveBattleResult('End', 100, 0);
    expect(old).toEqual({ winner: 'A', hpA: 100, hpB: 0, phase: 'End' });
  });
});
