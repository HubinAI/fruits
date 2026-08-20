/**
 * Queue Q06-B1｜Result → 修改 → 再战 Loop 纯逻辑 targeted test
 *
 * 覆盖 Q06-B1 验收中可在 node 层验证的部分（DOM 粘合由 main.ts 承担）：
 * 1. 战斗运行时改 Draft 不影响当前战斗（Draft 与 current battle Build 分离）；
 * 2. B 的 Draft 不因 A 修改而自动变化（保持同一对手，便于对比两次 A Build）；
 * 3. 结束后修改一个部件 → 再战，新 Build 真进入 Runtime（functionals 反映新选择）；
 * 4. 未修改配置仍可原配置再战（同 Build 重建，位置/状态重置）；
 * 5. result 数据源：resolveBattleResult 三态（A胜/B胜/平局 + hp）供 UI 展示。
 */
import { describe, it, expect } from 'vitest';
import { createRegistry } from '../src/core/content';
import {
  buildSnapshotFromDraft,
  EMPTY_SLOT,
  type BuildDraft,
} from '../src/lab/buildEditorModel';
import { resolveBattleResult, deterministicTieBreak } from '../src/battle/battleContract';
import { PhysicsLab } from '../src/lab/physicsLab';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import type { Renderer } from '../src/render/renderer';

const registry = createRegistry();
const rendererStub = { bind: () => {} } as unknown as Renderer;

function draft(
  bodyDefId: string,
  selections: Record<string, string>,
): BuildDraft {
  return { bodyDefId, rearRadius: 20, frontRadius: 20, functionalSelections: selections };
}

function snap(d: BuildDraft, id: string) {
  return buildSnapshotFromDraft(d, registry, id);
}

/** 读 orchestrator A 车部件 behavior 集合（验证进入 Runtime 的 Build） */
function behaviorsOfA(o: PlanckBattleOrchestrator): string[] {
  return o.vehicleA.parts.map((p) => p.def.behavior).sort();
}

describe('Q06-B1 Build Loop', () => {
  it('1. 战斗运行时改 Draft 不影响当前战斗（Draft 与 current battle Build 分离）', () => {
    const lab = new PhysicsLab(rendererStub);
    const draftA = draft('boxBody', { front: 'cannon', frontMass: EMPTY_SLOT, top: EMPTY_SLOT, rear: EMPTY_SLOT });
    const draftB = draft('heavyBox', { front: 'cannon' });
    lab.loadCustom(snap(draftA, 'customA'), snap(draftB, 'customB'), {
      autoDrive: true,
      engine: 'planck',
    });
    const o1 = lab.orchestrator as PlanckBattleOrchestrator;
    const before = behaviorsOfA(o1);
    expect(before).toEqual(['cannon']);

    // 战斗运行中修改 Draft（玩家改下一局配置）
    draftA.bodyDefId = 'wedgeBody';
    draftA.functionalSelections = { front: 'hammer', top: 'pushRod', rear: EMPTY_SLOT };

    // 当前战斗不受影响：同一 orchestrator 实例、同一 Build（仍 boxBody+cannon）
    expect(lab.orchestrator).toBe(o1);
    expect(o1.vehicleA.id).toBe('customA');
    expect(behaviorsOfA(o1)).toEqual(['cannon']);
    expect(o1.vehicleA.resolved.body.id).toBe('boxBody');
  });

  it('2. B 的 Draft 不因 A 修改而自动变化（保持同一对手）', () => {
    const draftA = draft('boxBody', { front: 'cannon' });
    const draftB = draft('heavyBox', { front: 'cannon', frontMass: 'hammer' });
    const bBefore = JSON.stringify(draftB);
    draftA.bodyDefId = 'tallBody';
    draftA.functionalSelections = { front: 'pushRod', top: EMPTY_SLOT, rear: EMPTY_SLOT };
    expect(JSON.stringify(draftB)).toBe(bBefore); // B draft 完全不变
  });

  it('3. 结束后修改一个部件 → 再战，新 Build 真进入 Runtime', () => {
    const lab = new PhysicsLab(rendererStub);
    const draftA = draft('boxBody', { front: 'cannon' });
    const draftB = draft('heavyBox', { front: 'cannon' });
    const sa = snap(draftA, 'customA');
    const sb = snap(draftB, 'customB');
    lab.loadCustom(sa, sb, { autoDrive: true, engine: 'planck' });
    const o1 = lab.orchestrator as PlanckBattleOrchestrator;
    expect(behaviorsOfA(o1)).toEqual(['cannon']);

    // 修改一个部件（cannon → hammer on front）
    draftA.functionalSelections = { front: 'hammer', frontMass: EMPTY_SLOT, top: EMPTY_SLOT, rear: EMPTY_SLOT };
    const sa2 = snap(draftA, 'customA');
    lab.loadCustom(sa2, sb, { autoDrive: true, engine: 'planck' }); // 应用配置再战
    const o2 = lab.orchestrator as PlanckBattleOrchestrator;
    expect(o2).not.toBe(o1); // 新战斗
    expect(o2.vehicleA.id).toBe('customA');
    expect(behaviorsOfA(o2)).toEqual(['hammer']); // 新 Build 真进入 Runtime
  });

  it('4. 未修改配置仍可原配置再战（同 Build 重建，位置重置）', () => {
    const lab = new PhysicsLab(rendererStub);
    const draftA = draft('boxBody', { front: 'cannon' });
    const draftB = draft('heavyBox', { front: 'cannon' });
    const sa = snap(draftA, 'customA');
    const sb = snap(draftB, 'customB');
    lab.loadCustom(sa, sb, { autoDrive: true, engine: 'planck' });
    const o1 = lab.orchestrator as PlanckBattleOrchestrator;
    const x1 = o1.world.getPosition(o1.vehicleA.body).x;

    // 跑几帧让位置变化，再按同一配置再战
    for (let i = 0; i < 20; i++) lab.step(16.6667);
    lab.loadCustom(sa, sb, { autoDrive: true, engine: 'planck' });
    const o2 = lab.orchestrator as PlanckBattleOrchestrator;
    expect(o2).not.toBe(o1);
    expect(o2.vehicleA.id).toBe('customA');
    expect(behaviorsOfA(o2)).toEqual(behaviorsOfA(o1)); // 原配置
    expect(o2.world.getPosition(o2.vehicleA.body).x).toBeCloseTo(x1, 3); // 位置重置到 spawn
  });

  it('5. result 数据源：A胜/B胜 + seed 兜底无平局 + hp（W1-END-1）供 UI 展示', () => {
    // UI 展示 = result.winner → A胜/B胜 + hpA/hpB + endReason（BattleResult 规则：无平局）
    const bWins = resolveBattleResult('End', 0, 500, 0);
    expect(bWins).toEqual({ winner: 'B', hpA: 0, hpB: 500, phase: 'End', endReason: 'arenaEnd' });
    const aWins = resolveBattleResult('End', 700, 0, 0);
    expect(aWins).toEqual({ winner: 'A', hpA: 700, hpB: 0, phase: 'End', endReason: 'arenaEnd' });
    // 双死（非 End 同帧）：deterministic seed 兜底，必为 A 或 B，绝无平局
    const bothDead = resolveBattleResult('Active', 0, 0, 7)!;
    expect(bothDead.winner).toBe(deterministicTieBreak(7));
    expect(['A', 'B']).toContain(bothDead.winner);
    expect(bothDead.endReason).toBe('hp');
    const ongoing = resolveBattleResult('Active', 1000, 1000, 0);
    expect(ongoing).toBeNull(); // 战斗进行中 → 无结果（UI 显示「战斗中…」）
  });
});
