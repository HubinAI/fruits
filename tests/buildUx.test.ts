/**
 * Queue Q06-UX-R1｜Build 测试交互重构 targeted test（node 层可测部分）
 *
 * 覆盖 Q06-UX-R1 验收（DOM 粘合由 main.ts 承担）：
 * 1. loadCustomPreview → Planck + previewMode（autoDrive:false，不推进战斗）；
 * 2. preview step 不推进（位置不变）；loadCustom 正常推进（对照）；
 * 3. 默认 Draft（A boxBody+cannon / B heavyBox+cannon）→ valid（首屏 Start 可点前提）；
 * 4. 删掉最后 Weapon → invalid + 阻断原因「A：至少需要 1 件 Weapon」；
 * 5. 槽位自然名称（前端/前部/顶部/后端，内部 id 保留）；
 * 6. 修改部件（cannon→hammer）后 preview 立即重建（中央 A 外形变化）；
 * 7. 非法 Build 也创建 preview（裸车显示，仅禁止开始战斗）。
 */
import { describe, it, expect } from 'vitest';
import { PhysicsLab } from '../src/lab/physicsLab';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import { createRegistry } from '../src/core/content';
import {
  buildSnapshotFromDraft,
  slotLabel,
  SLOT_LABELS,
  EMPTY_SLOT,
  type BuildDraft,
} from '../src/lab/buildEditorModel';
import { validateSnapshot } from '../src/core/buildValidator';
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

function behaviorsOfA(o: PlanckBattleOrchestrator): string[] {
  return o.vehicleA.parts.map((p) => p.def.behavior).sort();
}

describe('Q06-UX-R1 Build 交互', () => {
  it('1. loadCustomPreview → Planck + previewMode（autoDrive:false，不推进战斗）', () => {
    const lab = new PhysicsLab(rendererStub);
    const a = snap(draft('boxBody', { front: 'cannon' }), 'customA');
    const b = snap(draft('heavyBox', { front: 'cannon' }), 'customB');
    lab.loadCustomPreview(a, b);
    expect(lab.orchestrator instanceof PlanckBattleOrchestrator).toBe(true);
    expect(lab.previewMode).toBe(true);
    expect(lab.orchestrator!.config.autoDrive).toBe(false);
    // 预览对象可渲染（getRenderSnapshot 可用，不抛错）
    expect(() => lab.orchestrator!.getRenderSnapshot()).not.toThrow();
  });

  it('2. preview step 不推进（位置不变）；loadCustom 正常推进（对照）', () => {
    // Preview：跑 60 步，车辆位置不变（autoDrive:false + step 跳过）
    const pLab = new PhysicsLab(rendererStub);
    pLab.loadCustomPreview(
      snap(draft('boxBody', { front: 'cannon' }), 'A'),
      snap(draft('heavyBox', { front: 'cannon' }), 'B'),
    );
    const po = pLab.orchestrator as PlanckBattleOrchestrator;
    const px0 = po.world.getPosition(po.vehicleA.body).x;
    for (let i = 0; i < 60; i++) pLab.step(16.6667);
    expect(po.world.getPosition(po.vehicleA.body).x).toBeCloseTo(px0, 6);

    // Battle：loadCustom（autoDrive:true）step 会推进（A 向 B 移动）
    const bLab = new PhysicsLab(rendererStub);
    bLab.loadCustom(
      snap(draft('boxBody', { front: 'cannon' }), 'A'),
      snap(draft('heavyBox', { front: 'cannon' }), 'B'),
      { autoDrive: true, engine: 'planck' },
    );
    const bo = bLab.orchestrator as PlanckBattleOrchestrator;
    const bx0 = bo.world.getPosition(bo.vehicleA.body).x;
    for (let i = 0; i < 60; i++) bLab.step(16.6667);
    expect(bo.world.getPosition(bo.vehicleA.body).x).not.toBeCloseTo(bx0, 3);
  });

  it('3. 默认 Draft（A boxBody+cannon / B heavyBox+cannon）→ 均 valid（首屏 Start 可点）', () => {
    const a = snap(draft('boxBody', { front: 'cannon' }), 'customA');
    const b = snap(draft('heavyBox', { front: 'cannon' }), 'customB');
    expect(validateSnapshot(a, registry).valid).toBe(true);
    expect(validateSnapshot(b, registry).valid).toBe(true);
  });

  it('4. 删掉最后 Weapon → invalid + 阻断原因「A：至少需要 1 件 Weapon」', () => {
    const a = snap(
      draft('boxBody', { front: EMPTY_SLOT, frontMass: EMPTY_SLOT, top: EMPTY_SLOT, rear: EMPTY_SLOT }),
      'customA',
    );
    const r = validateSnapshot(a, registry);
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain('Weapon'); // UI 在 Start 旁直接显示「A：至少需要 1 件 Weapon」
  });

  it('5. 槽位自然名称：前端挂点/前上挂点/顶部挂点/后部挂点（内部 id 保留）', () => {
    // W2-UX-R2：主标签用「挂点」位置语义（front/frontMass 不再作主视觉文字）
    expect(SLOT_LABELS).toEqual({
      front: '前端挂点',
      frontMass: '前上挂点',
      top: '顶部挂点',
      rear: '后部挂点',
    });
    expect(slotLabel('front')).toBe('前端挂点');
    expect(slotLabel('frontMass')).toBe('前上挂点');
    expect(slotLabel('top')).toBe('顶部挂点');
    expect(slotLabel('rear')).toBe('后部挂点');
    expect(slotLabel('unknown')).toBe('unknown'); // 未知回退原 id
  });

  it('6. 修改部件（cannon→hammer）后 preview 立即重建（中央 A 外形变化，不启动战斗）', () => {
    const lab = new PhysicsLab(rendererStub);
    const dA = draft('boxBody', { front: 'cannon' });
    const dB = draft('heavyBox', { front: 'cannon' });
    lab.loadCustomPreview(snap(dA, 'customA'), snap(dB, 'customB'));
    const o1 = lab.orchestrator as PlanckBattleOrchestrator;
    expect(behaviorsOfA(o1)).toEqual(['cannon']);

    // 编辑：front cannon → hammer（无需任何 Apply）
    dA.functionalSelections = { front: 'hammer', frontMass: EMPTY_SLOT, top: EMPTY_SLOT, rear: EMPTY_SLOT };
    lab.loadCustomPreview(snap(dA, 'customA'), snap(dB, 'customB'));
    const o2 = lab.orchestrator as PlanckBattleOrchestrator;
    expect(o2).not.toBe(o1);
    expect(behaviorsOfA(o2)).toEqual(['hammer']); // 中央 A 立即变成 Hammer 外形
    expect(lab.previewMode).toBe(true); // 仍为预览，未启动战斗
  });

  it('7. 非法 Build（无 Weapon）也创建 preview（裸车显示；仅禁止开始战斗）', () => {
    const lab = new PhysicsLab(rendererStub);
    const invalidA = snap(
      draft('boxBody', { front: EMPTY_SLOT, frontMass: EMPTY_SLOT, top: EMPTY_SLOT, rear: EMPTY_SLOT }),
      'customA',
    );
    expect(validateSnapshot(invalidA, registry).valid).toBe(false);
    // 仍可显示裸车 Preview（校验由 UI/Validator 负责，仅阻止开始战斗）
    expect(() =>
      lab.loadCustomPreview(
        invalidA,
        snap(draft('heavyBox', { front: 'cannon' }), 'customB'),
      ),
    ).not.toThrow();
    const o = lab.orchestrator as PlanckBattleOrchestrator;
    expect(o instanceof PlanckBattleOrchestrator).toBe(true);
    expect(o.vehicleA.parts).toHaveLength(0); // 裸车（无功能部件）
    expect(o.vehicleA.wheels).toHaveLength(2);
  });
});
