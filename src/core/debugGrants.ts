/**
 * F-DEBUG-GRANT-ALL-PARTS-P0｜一键「全部件 ×1」调试入口（纯库存操作，无 UI / 无 Gameplay）。
 *
 * 为装备 / 合成 / 战斗测试提供确定性库存：每次调用为**全部真实可获得功能件各 +1 件**。
 *
 * 设计约束（Must#3/4/9 / Forbidden）：
 * - 只遍历 `OFFICIAL_PARTS`（= PART_OPTIONS 去 EMPTY，Q12-A/B 的 ramHead/lifter 等
 *   prototype/hold 已不在玩家部件集；测试 fixture / 内部虚拟部件一律不在此列）→
 *   天然满足「排除空 / 排除占位 / 同一 part ID 只加一次」；
 * - 库存模型（PartInventory）只对 Functional 部件有数量概念；车身（BODY_OPTIONS）与
 *   轮径（12/20/26）是 BuildDraft 直接选择、**无拥有性计数**，不存在「各+1」的载体。
 *   （见 playerUI.ts BODY_OPTIONS / WHEEL_OPTIONS 注释）——故实际入库 = 全部可入库
 *   功能件（武器 + 辅助 + 其他正式功能件），与 Must#4「同一 part ID 只增加一次」一致；
 * - 每次点击每种部件只 +1（不重置为 1，连续点击累计；Must#5/9 幂等）；
 * - 复用现有 `saveInventory` 持久化（Must#6：不建 debug 专用库存副本，刷新后保留）；
 * - 不修改装备 / 能量 / 金币 / 段位 / 星级 / 解锁 / Physics（本模块只触碰库存计数）。
 */
import { EMPTY_SLOT } from '../lab/buildEditorModel';
import {
  OFFICIAL_PARTS,
  addPart,
  getInventory,
  isOfficialPart,
  saveInventory,
  type PartInventory,
} from './partInventory';

/** 去重后的真实可获得功能件 id 列表（同一 id 只出现一次；Must#4/9） */
export function grantablePartIds(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const defId of OFFICIAL_PARTS) {
    if (defId === EMPTY_SLOT) continue; // 排除「空」
    if (!isOfficialPart(defId)) continue; // 排除非正式（fixture / 占位 / 内部虚拟）
    if (seen.has(defId)) continue; // 同一 part ID 只增加一次
    seen.add(defId);
    out.push(defId);
  }
  return out;
}

/**
 * 一键全部件 ×1：为当前存档每种真实可获得功能件各 +1 并持久化。
 * @returns 实际去重后增加的种类数 N（反馈文案「已获得全部件×1（N种）」用；Must#8）
 */
export function grantAllPartsOnce(inv?: PartInventory): number {
  const target = grantablePartIds();
  const store = inv ?? getInventory();
  for (const defId of target) {
    // 已有副本 → 在原数量上 +1（不重置；Must#5）；star=1 星（不升星；Forbidden）
    addPart(store, defId, 1, 1);
  }
  saveInventory(store);
  return target.length;
}
