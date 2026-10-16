/**
 * GARAGE-V2-LEDGER-COHERENCE-R1｜**RED 复现**（全部在旧 HEAD `ef8a586` 失败，
 * 修实后转 GREEN —— 不删不改判据，是本轮的验收主体）。
 *
 * 三类一致性问题（Queue 问题陈述逐条）：
 *   R1 同 defId 多副本：消费**非尾号**实例 id ⇒ 实际消失的必须是**该 id**（不是尾号）；
 *   R2 新领奖：已耗 id 不复活/不复用；奖励新件只能以**新 id**（高水位之后）出现；
 *   R3 双账本：合成成功后 **旧系统读数**（playerInventory/equip 语义）必须同步扣除——
 *      已耗材料不能在旧 Garage/合成里再次使用；`equippedUpgraded` 必须伴随真实落盘
 *      （playerBuild.v1 的 functionalStars 变化），不是只改新页面数字；
 *   R4 旧星级投影：旧 ★2..★5 不得无声降成与初始白相同的进度（品质≠star，必须显式锁定规则）。
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
  addPart,
  defaultInventory,
  loadInventoryRaw,
  saveInventory,
  getCount,
  type PartInventory,
} from '../src/core/partInventory';
import { loadEquippedDraft } from '../src/product/playerLoadout';
import { savePlayerBuild } from '../src/core/buildPersistence';
import { defaultPlayerDraft } from '../src/product/playerLoadout';
import type { BuildDraft } from '../src/lab/buildEditorModel';
import {
  projectItemInstances,
  fuseQualityFive,
  resetGarageV2LedgerForTest,
  effectiveInventory,
  equipQualityProduct,
  type ItemInstance,
} from '../src/product/garageV2Quality';

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null { return this.m.has(k) ? (this.m.get(k) as string) : null; }
  setItem(k: string, v: string): void { this.m.set(k, String(v)); }
  removeItem(k: string): void { this.m.delete(k); }
  key(i: number): string | null { return [...this.m.keys()][i] ?? null; }
  get length(): number { return this.m.size; }
  raw(k: string): string | null { return this.m.get(k) ?? null; }
}

let store: MemStorage;
const BUILD_KEY = 'strongfruit.playerBuild.v1';

beforeEach(() => {
  store = new MemStorage();
  (globalThis as unknown as { localStorage: MemStorage }).localStorage = store;
  resetGarageV2LedgerForTest();
});

/** 确定起点：cannon★1×5、machineGun★1×5；cannon★1 装备中。 */
function setupWorld(): { inv: PartInventory; draft: BuildDraft } {
  const inv = defaultInventory();
  addPart(inv, 'cannon', 1, 4); // starter 已有 1 ⇒ 5
  addPart(inv, 'machineGun', 1, 5);
  saveInventory(inv);
  const draft = defaultPlayerDraft();
  savePlayerBuild(draft);
  return { inv: loadInventoryRaw() as PartInventory, draft };
}

function idsOf(instances: readonly ItemInstance[], defId: string): string[] {
  return instances
    .filter((i) => i.defId === defId && i.instanceId.startsWith('q1:'))
    .map((i) => i.instanceId)
    .sort();
}

/* ══════════ R1：非尾号消费必须消失该 id ══════════ */
describe('COH-RED｜R1 实例恒等性：非尾号消费', () => {
  it('R1a 消费 q1:cannon:1:2（非尾号）后：该 id 消失、其余 4 个 id（含尾号 5）保留', () => {
    const { draft } = setupWorld();
    const before = projectItemInstances(loadInventoryRaw() as PartInventory, draft);
    const ids = idsOf(before, 'cannon');
    expect(ids).toEqual([
      'q1:cannon:1:1', 'q1:cannon:1:2', 'q1:cannon:1:3', 'q1:cannon:1:4', 'q1:cannon:1:5',
    ]);
    // 主件 = ids[1]（非尾号），材料 = machineGun 4 件（同部位同品质、不同 defId）
    const mg = idsOf(before, 'machineGun');
    const res = fuseQualityFive({
      mainInstanceId: ids[1],
      materialInstanceIds: mg.slice(0, 4),
      draft,
    });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    if (!res.ok) return;
    // 消耗清单必须逐字等于玩家选的 5 个 id
    expect([...res.consumedInstanceIds].sort()).toEqual([ids[1], ...mg.slice(0, 4)].sort());

    const rawAfter = loadInventoryRaw() as PartInventory;
    console.log('DEBUG raw cannon:', getCount(rawAfter, 'cannon', 1), 'mg:', getCount(rawAfter, 'machineGun', 1));
    const after = projectItemInstances(rawAfter, draft);
    const afterIds = idsOf(after, 'cannon');
    console.log('DEBUG afterIds:', JSON.stringify(afterIds));
    // RED（旧实现）：消失的是尾号 ids[4]，而玩家选的 ids[1] 还在 —— 实例身份漂移
    expect(afterIds).not.toContain('q1:cannon:1:2'); // 玩家选的那件必须消失
    expect(afterIds).toContain('q1:cannon:1:5');     // 尾号必须保留
    expect(afterIds).toHaveLength(4);
  });
});

/* ══════════ R2：新领奖不复活/不复用已耗 id ══════════ */
describe('COH-RED｜R2 新领奖高水位', () => {
  it('R2a 消费 2 件后再领 2 件：新件必须是新 id（:6、:7），已耗 id（:1、:2）不复活', () => {
    const { draft } = setupWorld();
    const before = projectItemInstances(loadInventoryRaw() as PartInventory, draft);
    const ids = idsOf(before, 'machineGun');
    // 账本记 machineGun|1 已消耗 2 件（:1、:2）
    const res = fuseQualityFive({
      mainInstanceId: idsOf(before, 'cannon')[0],
      materialInstanceIds: [ids[0], ids[1], ids[2], ids[3]],
      draft,
    });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    if (!res.ok) return;

    // 新领奖：machineGun +2（走正式 addPart → ownedParts.v2）
    const inv = loadInventoryRaw() as PartInventory;
    addPart(inv, 'machineGun', 1, 2);
    saveInventory(inv);

    const after = projectItemInstances(loadInventoryRaw() as PartInventory, draft);
    const afterIds = idsOf(after, 'machineGun');
    // machineGun 消耗 4 ⇒ 原 5 件剩 1（:5）；再领 2 ⇒ 必须是 :6、:7（高水位），总 3 件
    expect(afterIds).toEqual(['q1:machineGun:1:5', 'q1:machineGun:1:6', 'q1:machineGun:1:7']);
    // 已耗 id 不得复活
    expect(afterIds).not.toContain('q1:machineGun:1:1');
    expect(afterIds).not.toContain('q1:machineGun:1:2');
  });

  it('R2b 已耗实例再次提交合成 → unknown-instance（不可复用）', () => {
    const { draft } = setupWorld();
    const before = projectItemInstances(loadInventoryRaw() as PartInventory, draft);
    const cannonIds = idsOf(before, 'cannon');
    const mg = idsOf(before, 'machineGun');
    const res = fuseQualityFive({
      mainInstanceId: cannonIds[0],
      materialInstanceIds: mg.slice(0, 4),
      draft,
    });
    expect(res.ok).toBe(true);
    // 用已消耗的 machineGun id 再次提交（旧账本只记数量 ⇒ 旧实现会“看起来还有”）
    const again = fuseQualityFive({
      mainInstanceId: cannonIds[1],
      materialInstanceIds: [mg[0], mg[1], mg[2], mg[3]],
      draft,
    });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toBe('unknown-instance');
  });
});

/* ══════════ R3：双账本 —— 旧系统读数同步 + 装备真实落盘 ══════════ */
describe('COH-RED｜R3 有效库存与装备一致性', () => {
  it('R3a 合成成功后「有效库存」= 旧库存 − 账本消耗：已耗材料在有效读数里为 0', () => {
    const { draft } = setupWorld();
    const before = projectItemInstances(loadInventoryRaw() as PartInventory, draft);
    const res = fuseQualityFive({
      mainInstanceId: idsOf(before, 'cannon')[0],
      materialInstanceIds: idsOf(before, 'machineGun').slice(0, 4),
      draft,
    });
    expect(res.ok).toBe(true);
    // 有效读数（COH 新 API）：machineGun 有效数量 = 5 − 4 = 1；cannon = 5 − 1 = 4
    const eff = effectiveInventory(draft);
    expect(getCount(eff, 'machineGun', 1)).toBe(1);
    expect(getCount(eff, 'cannon', 1)).toBe(4);
  });

  it('R3b 装备中的武器档被合空：equippedUpgraded=true 且 playerBuild.v1 真实落盘 ★2', () => {
    const { draft } = setupWorld();
    // starter 装备 cannon★1；cannon★1×5 全消耗 ⇒ 装备必须真实升到 ★2 并落盘
    const before = projectItemInstances(loadInventoryRaw() as PartInventory, draft);
    const cannonIds = idsOf(before, 'cannon');
    const res = fuseQualityFive({
      mainInstanceId: cannonIds[0],
      materialInstanceIds: cannonIds.slice(1, 5),
      draft,
    });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    if (!res.ok) return;
    expect(res.equippedUpgraded).toBe(true);
    // RED（旧实现）：布尔为真但 playerBuild.v1 里 functionalStars.frontMass 仍是 1（未落盘）
    const persisted = JSON.parse(store.raw(BUILD_KEY) || '{}');
    expect(persisted.functionalStars?.frontMass).toBe(2);
    // 且重新加载的 draft 也读到 ★2（loadEquippedDraft 与磁盘一致）
    expect(loadEquippedDraft().functionalStars?.frontMass).toBe(2);
  });

  it('R3c 合成后旧合成系统不可再次使用已耗材料：旧 fuseStack 预检在有效读数上失败', () => {
    const { draft } = setupWorld();
    const before = projectItemInstances(loadInventoryRaw() as PartInventory, draft);
    const res = fuseQualityFive({
      mainInstanceId: idsOf(before, 'cannon')[0],
      materialInstanceIds: idsOf(before, 'machineGun').slice(0, 4),
      draft,
    });
    expect(res.ok).toBe(true);
    // 旧 fuseStack（canFuseStack 同判据）若读旧堆叠会看到 machineGun ★1×5 ⇒ 可伪合成；
    // 有效读数口径下 machineGun 只剩 1 ⇒ 不能合成（数量验证；正式接入阻断由 R3d 覆盖）
    expect(getCount(effectiveInventory(draft), 'machineGun', 1)).toBe(1);
  });

  it('R3d 品质产物未接正式装备：equipQualityProduct 显式拒绝（不假成功）', () => {
    const { draft } = setupWorld();
    const before = projectItemInstances(loadInventoryRaw() as PartInventory, draft);
    const res = fuseQualityFive({
      mainInstanceId: idsOf(before, 'cannon')[0],
      materialInstanceIds: idsOf(before, 'machineGun').slice(0, 4),
      draft,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // COH 新 API：尝试把品质产物装备到正式 Build ⇒ 必须 ok:false + 'run-not-wired'
    const eq = equipQualityProduct(res.productId, draft);
    expect(eq.ok).toBe(false);
    if (!eq.ok) expect(eq.reason).toBe('run-not-wired');
    // 且正式存档未被改动
    const persisted = JSON.parse(store.raw(BUILD_KEY) || '{}');
    expect(persisted.functionalSelections?.frontMass).toBe('cannon');
  });
});

/* ══════════ R4：旧星级不得无声降为初始白 ══════════ */
describe('COH-RED｜R4 旧星级投影锁定', () => {
  it('R4a 旧 ★2/★3 实例投影：quality=white 但必须带「不可再合成」锁定（等设计决策），不得与初始白同权', () => {
    const { draft } = setupWorld();
    const inv = loadInventoryRaw() as PartInventory;
    addPart(inv, 'cannon', 2, 1); // ★2 ×1（来自旧 5合1 的产物）
    addPart(inv, 'hammer', 3, 1); // ★3 ×1
    saveInventory(inv);
    const instances = projectItemInstances(loadInventoryRaw() as PartInventory, draft);
    const s2 = instances.find((i) => i.defId === 'cannon' && i.legacyStar === 2);
    const s3 = instances.find((i) => i.defId === 'hammer' && i.legacyStar === 3);
    expect(s2).toBeDefined();
    expect(s3).toBeDefined();
    // RED（旧实现）：legacyStar>1 的实例 quality='white' 且 consumable=true —— 与初始白完全同权，
    // 用它当主件合成会无声吞掉玩家旧进度（green 产物 1 件 ≠ 旧 ★2 的成长价值）
    expect(s2?.consumable).toBe(false);
    expect(s2?.lockedReason).toBe('legacy-star-locked');
    expect(s3?.consumable).toBe(false);
    expect(s3?.lockedReason).toBe('legacy-star-locked');
  });
});
