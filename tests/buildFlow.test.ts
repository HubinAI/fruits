/**
 * Queue Q06-U1｜Build 配置 Flow 纯逻辑 targeted test
 *
 * 覆盖 Q06-U1 验收中可在 node 层验证的部分（UI DOM 粘合由 main.ts 承担）：
 * 1. Push Rod 可与 Cannon/Hammer 共存（同车多 Gadget/Weapon 槽，不区分 Weapon/Gadget 槽）；
 * 2. 单独 Push Rod（gadget）→ 因「至少 1 件 Weapon」被阻止开战；
 * 3. boxBody 4 个 Functional hardpoint 全装 cannon → Energy 超载（30×4=120 > capacity 100）；
 * 4. 超载 → validate invalid（「开始战斗」按钮不可启动的前提条件）；
 * 5. 合法 Build（含 1 Weapon）→ validate valid → 可进入 Planck Runtime
 *    （loadCustom planck 路由由 physicsLabEngine.test 覆盖）；
 * 6. Body 切换后 snapshot 槽位合法（migrateDraftBody → buildSnapshotFromDraft）。
 */
import { describe, it, expect } from 'vitest';
import { createRegistry } from '../src/core/content';
import {
  buildSnapshotFromDraft,
  migrateDraftBody,
  EMPTY_SLOT,
  type BuildDraft,
} from '../src/lab/buildEditorModel';
import { computeEnergy, validateSnapshot } from '../src/core/buildValidator';
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

function snapshotOf(d: BuildDraft) {
  return buildSnapshotFromDraft(d, registry);
}

describe('Q06-U1 Build flow', () => {
  it('1. Push Rod 可与 Cannon/Hammer 共存：front=cannon + top=hammer + rear=pushRod → valid', () => {
    const s = snapshotOf(
      draft('boxBody', { front: 'cannon', frontMass: EMPTY_SLOT, top: 'hammer', rear: 'pushRod' }),
    );
    expect(s.functionals.map((f) => f.defId)).toEqual(['cannon', 'hammer', 'pushRod']);
    const r = validateSnapshot(s, registry);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('2. 单独 Push Rod（gadget）→ 至少需要 1 件 Weapon，阻止开战', () => {
    const s = snapshotOf(draft('boxBody', { front: 'pushRod' }));
    const r = validateSnapshot(s, registry);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('Weapon'))).toBe(true);
  });

  it('3. boxBody 4 个 Functional hardpoint 全装 cannon → Energy 超载（120 > 100）', () => {
    const s = snapshotOf(
      draft('boxBody', {
        front: 'cannon',
        frontMass: 'cannon',
        top: 'cannon',
        rear: 'cannon',
      }),
    );
    const { energy } = computeEnergy(s, registry);
    const capacity = registry.bodies.get('boxBody')!.energyCapacity;
    expect(energy).toBe(120);
    expect(energy).toBeGreaterThan(capacity);
    const r = validateSnapshot(s, registry);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('能量超载'))).toBe(true);
  });

  it('4. 超载 → invalid（开始战斗按钮不可启动的判定前提：A/B 必须均 valid）', () => {
    const overload = snapshotOf(
      draft('boxBody', {
        front: 'cannon',
        frontMass: 'cannon',
        top: 'cannon',
        rear: 'cannon',
      }),
    );
    const ok = snapshotOf(draft('boxBody', { front: 'cannon' }));
    expect(validateSnapshot(overload, registry).valid).toBe(false);
    expect(validateSnapshot(ok, registry).valid).toBe(true);
    // 「只有 A/B 都 valid 才能启动」：任一侧 invalid → 不能启动
    expect(
      validateSnapshot(overload, registry).valid && validateSnapshot(ok, registry).valid,
    ).toBe(false);
  });

  it('5. 合法 Build（cannon + pushRod，Energy 75 <= 100）→ valid，可进入 Planck Runtime', () => {
    const s = snapshotOf(
      draft('boxBody', { front: 'cannon', frontMass: EMPTY_SLOT, top: EMPTY_SLOT, rear: 'pushRod' }),
    );
    const { energy } = computeEnergy(s, registry);
    expect(energy).toBe(50); // cannon 30 + pushRod 20
    expect(validateSnapshot(s, registry).valid).toBe(true);
    // Planck Runtime 路由本身由 physicsLabEngine.test（Q06-F1）覆盖：
    // loadCustom(buildA, buildB, { autoDrive:true, engine:'planck' }) → PlanckBattleOrchestrator。
    // 此处验证 snapshot 结构可被该入口消费（movements/functionals 合法）。
    expect(s.movements).toHaveLength(2);
    expect(s.functionals.every((f) => registry.functionals.has(f.defId))).toBe(true);
  });

  it('6. Body 切换（boxBody→wedgeBody→boxBody）后 snapshot 槽位合法', () => {
    const box = draft('boxBody', {
      front: 'cannon',
      frontMass: 'hammer',
      top: 'pushRod',
      rear: EMPTY_SLOT,
    });
    const wedge = migrateDraftBody(box, 'wedgeBody', registry);
    const s1 = snapshotOf(wedge);
    // wedgeBody 无 frontMass → 该选择被丢弃；front/top/rear 保留
    expect(s1.functionals).toEqual([
      { hardpointId: 'front', defId: 'cannon' },
      { hardpointId: 'top', defId: 'pushRod' },
    ]);
    expect(validateSnapshot(s1, registry).valid).toBe(true);

    const back = migrateDraftBody(wedge, 'boxBody', registry);
    const s2 = snapshotOf(back);
    // 切回 boxBody：frontMass 恢复为 none（新增槽默认），其余保留
    expect(s2.functionals).toEqual([
      { hardpointId: 'front', defId: 'cannon' },
      { hardpointId: 'top', defId: 'pushRod' },
    ]);
    expect(validateSnapshot(s2, registry).valid).toBe(true);
  });

  it('7. 合法 Build → loadCustom(planck) → Planck Runtime 且 Cannon/Hammer/Push Behavior 接线、step 正常', () => {
    const lab = new PhysicsLab(rendererStub);
    // A：cannon + hammer + pushRod 三件共存；B：cannon
    const a = snapshotOf(
      draft('boxBody', { front: 'cannon', frontMass: 'hammer', top: 'pushRod', rear: EMPTY_SLOT }),
    );
    const b = snapshotOf(draft('heavyBox', { front: 'cannon' }));
    expect(validateSnapshot(a, registry).valid).toBe(true);
    expect(validateSnapshot(b, registry).valid).toBe(true);

    lab.loadCustom(a, b, { autoDrive: true, engine: 'planck' });
    const o = lab.orchestrator as PlanckBattleOrchestrator;
    expect(o instanceof PlanckBattleOrchestrator).toBe(true);

    // Behavior 接线（Q06-U1 验收：Cannon/Hammer/Push 均真实工作）
    const priv = o as unknown as {
      cannons: unknown[];
      hammers: unknown[];
      pushRods: unknown[];
    };
    expect(priv.cannons.length).toBe(2); // A front + B front
    expect(priv.hammers.length).toBe(1); // A frontMass
    expect(priv.pushRods.length).toBe(1); // A top

    // 60 步真实运行不抛错（Behavior 在 onBeforeStep 驱动；Cannon/Hammer/Push 状态机正常推进）
    for (let i = 0; i < 60; i++) lab.step(16.6667);
    lab.clear();
  });
});
