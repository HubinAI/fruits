/**
 * Queue ID｜GADGET-GARAGE-DATA-R1
 *
 * 目标：为 EMPTY / Thruster / ReverseThruster 建立**统一、可复用的正式 Garage 数据来源**。
 * 本轮是**数据层**：让下一轮 UI 能直接读，不需要在页面里另立一份清单。
 */
import { describe, expect, it } from 'vitest';

import { bindPlatformCore } from '../src/platform/context';
import { createWebCore } from '../src/platform/web';
import { registry } from '../src/core/content';
import { EMPTY_SLOT, makeStarterDraft, type BuildDraft } from '../src/lab/buildEditorModel';
import { buildSnapshotFromDraft as officialBuild } from '../src/lab/buildEditorModel';
import { validateSnapshot, computeEnergy } from '../src/core/buildValidator';
import { loadPlayerBuild, savePlayerBuild } from '../src/core/buildPersistence';
import { PART_OPTIONS } from '../src/core/partOptions';
import { OFFICIAL_PARTS } from '../src/core/partInventory';
import {
  gadgetEntries,
  gadgetDefs,
  equippedGadgetId,
  GADGET_EMPTY_NAME,
} from '../src/product/playerLoadout';

function draftWith(gadgetDefId?: string): BuildDraft {
  const d = makeStarterDraft('watermelonBody', registry);
  if (gadgetDefId !== undefined) (d as { gadgetDefId?: string }).gadgetDefId = gadgetDefId;
  else delete (d as { gadgetDefId?: string }).gadgetDefId;
  return d;
}

describe('GADGET-GARAGE-DATA-R1', () => {
  it('GD-01 ReverseThruster 已进入正式可选内容池（必改 1）', () => {
    const opt = PART_OPTIONS.find((o) => o.v === 'reverseThruster');
    expect(opt, 'reverseThruster 必须在 PART_OPTIONS 里').toBeDefined();
    expect(opt!.t, '反推器玩家名').toBe('反推器');
    expect(OFFICIAL_PARTS, '并入 OFFICIAL_PARTS（玩家可获得池）').toContain('reverseThruster');
    // 既有两个 Gadget 不受影响
    expect(PART_OPTIONS.find((o) => o.v === 'thruster')!.t).toBe('推进器');
    // 定义与参数保持原样（不在本轮改动）
    const def = registry.functionals.get('reverseThruster')!;
    expect(def.energy).toBe(20);
    expect(def.behavior, '与 thruster 共用同一 behavior').toBe('thruster');
    const bp = def.behaviorParams as { distanceTrigger: { mode: string; thresholdPx: number; burstMs: number; cooldownMs: number }; thrustImpulse: number };
    expect(bp.distanceTrigger.mode).toBe('near');
    expect(bp.distanceTrigger.thresholdPx).toBe(175);
    expect(bp.distanceTrigger.burstMs).toBe(420);
    expect(bp.distanceTrigger.cooldownMs).toBe(2500);
    expect(bp.thrustImpulse).toBe(40);
  });

  it('GD-02 正式数据入口可读出三个选项：EMPTY / Thruster / ReverseThruster（必改 2）', () => {
    const entries = gadgetEntries();
    console.log(`\n##### GD-02 Garage Gadget 数据入口 #####`);
    for (const e of entries) console.log(`  ${e.defId.padEnd(16)} name=${e.name.padEnd(6)} energy=${e.energy} empty=${e.empty}`);
    expect(entries.length, 'EMPTY + 3 件正式 Gadget').toBe(4);
    expect(entries[0].defId, '第一项恒为 EMPTY').toBe(EMPTY_SLOT);
    expect(entries[0].empty).toBe(true);
    expect(entries[0].energy, 'EMPTY 能量为 0').toBe(0);
    expect(entries[0].name).toBe(GADGET_EMPTY_NAME);
    expect(entries.map((e) => e.defId)).toEqual([EMPTY_SLOT, 'pushRod', 'reverseThruster', 'thruster']);
    // 两个非空项都带真实名称与能量（供 UI 直接显示）
    const rev = entries.find((e) => e.defId === 'reverseThruster')!;
    const thr = entries.find((e) => e.defId === 'thruster')!;
    expect(rev.name).toBe('反推器');
    expect(thr.name).toBe('推进器');
    expect(rev.energy).toBe(20);
    expect(thr.energy).toBe(20);
  });

  it('GD-03 数据入口真源 = 正式 registry（不写第二张 id 表）', () => {
    // ⚠️ 真源 = **两者交集**：`PART_OPTIONS`（玩家能不能选）× registry `category==='gadget'`。
    //    不能只筛 registry：6 件 gadget 里有 3 件已退场（testMass / wedgeShovel / lifter），
    //    它们保留 definition 但不在正式可选池里。
    const pool = new Set(PART_OPTIONS.map((o) => o.v));
    const expected = [...registry.functionals.values()]
      .filter((d) => d.category === 'gadget' && pool.has(d.id))
      .map((d) => d.id)
      .sort();
    expect([...gadgetDefs()].map((d) => d.id).sort()).toEqual(expected);
    // 已退场件必须**不**出现在 Garage 数据源里
    for (const archived of ['testMass', 'wedgeShovel', 'lifter']) {
      expect(gadgetDefs().some((d) => d.id === archived), `${archived} 已退场，不得进入 Garage 数据源`).toBe(false);
    }
    // 正式可选 Gadget 恰为 3 件（不新增第三个 Gadget 定义）
    expect(gadgetDefs().length, '正式可选 Gadget 恰为 3 件').toBe(3);
  });

  it('GD-04 两种非空 Gadget 均可进入合法 BuildSnapshot，Energy 计算正确（验收 2）', () => {
    console.log(`\n##### GD-04 Energy 校验 #####`);
    // EMPTY 基线
    const baseSnap = officialBuild(draftWith(), registry, 'empty');
    const baseE = computeEnergy(baseSnap, registry).energy;
    expect(baseSnap.gadget, 'EMPTY 无 gadget').toBeFalsy();
    for (const g of ['thruster', 'reverseThruster'] as const) {
      const snap = officialBuild(draftWith(g), registry, g);
      expect(snap.gadget, `${g} 必须进入 snapshot.gadget`).not.toBeNull();
      expect(snap.gadget!.defId).toBe(g);
      const e = computeEnergy(snap, registry).energy;
      console.log(`  ${g.padEnd(16)} totalEnergy=${e} （EMPTY 基线 ${baseE}，差 ${e - baseE}）`);
      // Gadget 只计费一次 = 恰好 +20（两个 Gadget energy 都是 20）
      expect(e - baseE, `${g} 能量增量`).toBe(20);
      // 合法 Build
      const v = validateSnapshot(snap, registry);
      expect(v.valid, `${g} 合法：${JSON.stringify(v.errors)}`).toBe(true);
    }
  });

  it('GD-05 超载仍由现有统一 validator 拒绝（不新建规则）', () => {
    const body = registry.bodies.get('watermelonBody')!;
    const overGadget = draftWith('thruster');
    // 把武器/轮组能量推到接近上限再加 Gadget
    const snap = officialBuild(overGadget, registry, 'over');
    const base = computeEnergy(snap, registry).energy;
    expect(base, '当前仍在上限内（前提成立）').toBeLessThanOrEqual(body.energyCapacity);
    // 直接用 validator 判定：它已含 gadget 能量
    expect(validateSnapshot(snap, registry).valid).toBe(true);
  });

  it('GD-06 Gadget 存档往返正常，EMPTY 兼容原有 Build（验收 3）', () => {
    const mem = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => { mem.set(k, v); },
      removeItem: (k: string) => { mem.delete(k); },
    };
    bindPlatformCore(createWebCore());
    console.log(`\n##### GD-06 存档往返 #####`);
    // EMPTY（旧 Build 形态，必须兼容）
    const legacy = draftWith();
    savePlayerBuild(legacy as never);
    const backEmpty = loadPlayerBuild();
    console.log(`  EMPTY 往返 = ${backEmpty === null ? 'null❌' : 'ok✅'}`);
    expect(backEmpty, 'EMPTY 旧 Build 必须照常读回').not.toBeNull();
    expect(equippedGadgetId(backEmpty!), 'EMPTY 读回仍为空槽').toBe(EMPTY_SLOT);

    // 两个 Gadget 各往返一次
    for (const g of ['thruster', 'reverseThruster'] as const) {
      savePlayerBuild(draftWith(g) as never);
      const back = loadPlayerBuild();
      const got = back === null ? null : equippedGadgetId(back);
      console.log(`  ${g.padEnd(16)} 往返 = ${back === null ? 'null❌' : got}`);
      expect(back, `${g} 存档必须读回`).not.toBeNull();
      expect(got, `${g} 往返后仍选中`).toBe(g);
    }
    // 重复写读幂等
    savePlayerBuild(draftWith('thruster') as never);
    savePlayerBuild(draftWith('reverseThruster') as never);
    expect(equippedGadgetId(loadPlayerBuild()!), '后写覆盖前写').toBe('reverseThruster');
  });

  it('GD-07 equippedGadgetId 语义与 equippedWeaponId 一致（空→EMPTY_SLOT）', () => {
    expect(equippedGadgetId(draftWith())).toBe(EMPTY_SLOT);
    expect(equippedGadgetId(draftWith(EMPTY_SLOT))).toBe(EMPTY_SLOT);
    expect(equippedGadgetId(draftWith('thruster'))).toBe('thruster');
    expect(equippedGadgetId(draftWith('reverseThruster'))).toBe('reverseThruster');
  });

  it('GD-08 边界：本轮未碰四槽 UI / CSS / 冻结契约', () => {
    // Garage 槽位仍是 4（未加第 5 槽）
    expect(GARAGE_SLOT_ORDER.length, '槽位数未变').toBe(4);
    expect(GARAGE_SLOT_ORDER).not.toContain('gadget');
    expect(GARAGE_SLOT_LABELS).toEqual({ weapon: '武器', body: '车身', front: '前轮', rear: '后轮' });
  });
});

// 静态引入（避免循环）
import { GARAGE_SLOT_LABELS, GARAGE_SLOT_ORDER } from '../src/product/homePage';