/**
 * Queue ID｜GADGET-VALIDATION-LAB-R1 —— **真实 Portrait Battle Lab** 入口验证
 *
 * ⚠️ 重要修正：上一轮把预设加进了 `src/lab/scenarios.ts`，但那份表只被
 *    `src/main.ts` 消费（= `index.html` / `npm run dev:legacy`），
 *    **不是** `portrait-lab.html`。真实 Portrait Battle Lab 的入口是
 *    `src/lab/portraitBattleLab/main.ts` → `PortraitBattleLab`（lab.ts），
 *    它用 **Loadout 按钮 + Encounter 按钮**，**没有场景下拉框**。
 *
 * 本文件锁定正确入口：四套 GVL Loadout 出现在 `LAB_LOADOUTS` 里，
 * 并按「主武器 → 配套 Encounter」配对，供真人在 portrait-lab.html 验收。
 */
import { describe, expect, it } from 'vitest';

import { registry } from '../src/core/content';
import { validateSnapshot } from '../src/core/buildValidator';
import { resolveSnapshot } from '../src/core/buildSnapshot';
import { buildSnapshotFromDraft } from '../src/lab/buildEditorModel';
import { createPlanckVehicle } from '../src/battle/planckVehicleAssembly';
import { PlanckWorld } from '../src/physics/planckWorld';
import { LAB_LOADOUTS, LAB_ENCOUNTERS } from '../src/lab/portraitBattleLab/testData';

/** 四套 GVL 验收 Loadout：id → 期望的主武器 / Gadget / 配套 Encounter。 */
const GVL: ReadonlyArray<{
  id: string; label: string; weapon: string; gadget: string; encounter: string;
}> = [
  { id: 'GvlHammerThruster', label: '锤 + 推进器', weapon: 'hammer', gadget: 'thruster', encounter: 'RangedTurret' },
  { id: 'GvlHammerReverse', label: '锤 + 反推器', weapon: 'hammer', gadget: 'reverseThruster', encounter: 'RangedTurret' },
  { id: 'GvlCannonThruster', label: '炮 + 推进器', weapon: 'cannon', gadget: 'thruster', encounter: 'Chaser' },
  { id: 'GvlCannonReverse', label: '炮 + 反推器', weapon: 'cannon', gadget: 'reverseThruster', encounter: 'Chaser' },
];

describe('GADGET-VALIDATION-LAB-R1（真实 Portrait Battle Lab 入口）', () => {
  it('LV-01 四套 GVL Loadout 出现在 LAB_LOADOUTS（真实 Lab 的 Loadout 按钮来源）', () => {
    const gvlInLab = LAB_LOADOUTS.filter((l) => GVL.some((g) => g.id === l.id));
    expect(gvlInLab.length, '四套 GVL 必须在 LAB_LOADOUTS 里').toBe(4);
    for (const g of GVL) {
      const l = LAB_LOADOUTS.find((x) => x.id === g.id)!;
      expect(l, `${g.id} 必须在 LAB_LOADOUTS 里`).toBeDefined();
      expect(l.label, `${g.id} 真人可见标签`).toBe(g.label);
    }
  });

  it('LV-02 预设配置与定义完全一致（统一车身/轮组 + 指定武器 + 指定 Gadget）', () => {
    for (const g of GVL) {
      const l = LAB_LOADOUTS.find((x) => x.id === g.id)!;
      expect(l.draft.bodyDefId, `${g.id} 统一 watermelonBody`).toBe('watermelonBody');
      expect(l.draft.rearWheelDefId, `${g.id} 后轮 = 标准轮`).toBe('wheelStd');
      expect(l.draft.frontWheelDefId, `${g.id} 前轮 = 标准轮`).toBe('wheelStd');
      expect(l.draft.functionalSelections.frontMass, `${g.id} 主武器槽`).toBe(g.weapon);
      // 旧 front/top/rear 功能槽仍被产品规则清空（未重开）
      expect(l.draft.functionalSelections.front, `${g.id} front 仍 EMPTY`).toBe('none');
      expect(l.draft.functionalSelections.top, `${g.id} top 仍 EMPTY`).toBe('none');
      expect(l.draft.functionalSelections.rear, `${g.id} rear 仍 EMPTY`).toBe('none');
      // Gadget 走独立字段
      expect(l.draft.gadgetDefId, `${g.id} 独立 Gadget 位`).toBe(g.gadget);
      // 配套 Encounter 存在
      expect(LAB_ENCOUNTERS.some((e) => e.id === g.encounter), `${g.encounter} 必须存在`).toBe(true);
    }
  });

  it('LV-03 Gadget 走正式 Slot → validator → resolveSnapshot 链', () => {
    for (const g of GVL) {
      const l = LAB_LOADOUTS.find((x) => x.id === g.id)!;
      const snap = buildSnapshotFromDraft(l.draft, registry, g.id);
      const v = validateSnapshot(snap, registry);
      expect(v.valid, `${g.id} 正式校验：${JSON.stringify(v.errors)}`).toBe(true);
      const r = resolveSnapshot(snap, registry);
      expect(r.gadget, `${g.id} 必须解析出 Gadget`).not.toBeNull();
      expect(r.gadget!.def.id).toBe(g.gadget);
      expect(r.gadget!.def.category, `${g.id} 走 Gadget 类别`).toBe('gadget');
    }
  });

  it('LV-04 Gadget 被真实装配成物理 part（createPlanckVehicle，非绕过行为）', () => {
    for (const g of GVL) {
      const l = LAB_LOADOUTS.find((x) => x.id === g.id)!;
      const resolved = resolveSnapshot(buildSnapshotFromDraft(l.draft, registry, g.id), registry);
      const world = new PlanckWorld({ x: 0, y: 10 });
      const v = createPlanckVehicle(world, resolved, 'A', { x: 200, y: 600 });
      const part = v.parts.find((p) => p.def.id === g.gadget);
      expect(part, `${g.id} 必须被真实装配成 part`).toBeTruthy();
      expect(part!.def.behavior, `${g.id} 复用 thruster behavior`).toBe('thruster');
      expect(part!.id, `${g.id} 挂在 Gadget 专属挂点上`).toBe('gadget');
    }
  });

  it('LV-05 既有两套 Lab Loadout 完全不受影响（无 Gadget）', () => {
    for (const id of ['WatermelonHeavyCannon', 'BananaChargeHammer']) {
      const l = LAB_LOADOUTS.find((x) => x.id === id)!;
      expect(l.draft.gadgetDefId, `${id} 不得带 Gadget`).toBeUndefined();
      const snap = buildSnapshotFromDraft(l.draft, registry, id);
      expect(resolveSnapshot(snap, registry).gadget, `${id} 解析后无 Gadget`).toBeNull();
    }
  });

  it('LV-06 关键前提：RangedTurret 声明 keep-distance（否则「过远才触发」无意义）', () => {
    const rt = LAB_ENCOUNTERS.find((e) => e.id === 'RangedTurret')!;
    expect(rt.enemyDrive, 'RangedTurret 必须 keep-distance').toBe('keep-distance');
    // Chaser 是主动贴脸 ⇒ 推进器（过远触发）预期基本不启动，反推器（过近触发）才启动
    expect(LAB_ENCOUNTERS.some((e) => e.id === 'Chaser')).toBe(true);
  });
});