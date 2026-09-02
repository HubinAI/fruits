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
 *   轮径（12/20/26）是 BuildDraft 直接选择、**无数量计数**——但 F-CONTENT-PLAYER-BODY-PACK-R1
 *   起正式车身拥有「拥有即解锁」集合（bodyOwnership.ts），新 4 个车身默认未拥有，
 *   本调试入口同时解锁它们（旧 4 个恒默认拥有）；
 *   （见 playerUI.ts BODY_OPTIONS / WHEEL_OPTIONS 注释）——故实际入库 = 全部可入库
 *   功能件（武器 + 辅助 + 其他正式功能件），与 Must#4「同一 part ID 只增加一次」一致；
 * - 每次点击每种部件只 +1（不重置为 1，连续点击累计；Must#5/9 幂等）；
 * - 复用现有 `saveInventory` 持久化（Must#6：不建 debug 专用库存副本，刷新后保留）；
 * - 不修改装备 / 能量 / 金币 / 段位 / 星级 / 解锁 / Physics（本模块只触碰库存计数）。
 */
import { EMPTY_SLOT } from '../lab/buildEditorModel';
import {
  OFFICIAL_PARTS,
  OFFICIAL_MOVEMENTS,
  addPart,
  getCount,
  getInventory,
  isOfficialPart,
  saveInventory,
  grantAllNewMovements,
  type PartInventory,
} from './partInventory';
import { grantAllNewBodies, OFFICIAL_BODIES, isBodyOwned } from './bodyOwnership';

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
 * 一键全部件 ×1：为当前存档每种真实可获得功能件各 +1 并持久化；
 * F-CONTENT-PLAYER-BODY-PACK-R1：同时解锁全部新增正式车身（榴莲/梨子/芒果/橙子，
 * 车身拥有为「拥有即解锁」集合，无数量概念，见 bodyOwnership.ts）；
 * F-CONTENT-PLAYER-MOVEMENT-PACK-R1：同时解锁全部新正式轮组（small/large/heavy，
 * 复用 PartInventory one 计数，见 grantAllNewMovements）。
 * @returns 实际去重后增加的功能件种类数 N（反馈文案「已获得全部件×1（N种）」用；Must#8）
 */
export function grantAllPartsOnce(inv?: PartInventory): number {
  const target = grantablePartIds();
  const store = inv ?? getInventory();
  for (const defId of target) {
    // F-DEBUG-GRANT-COVERAGE-P0｜×1 语义：缺失（count<1）才补到 1；已拥有（≥1）不再增加
    // （四.1 / T6「第一次点击把所有缺失项补到 1」、T7「第二次点击所有数量不变」）。
    // 不重置、不累加、不升星（Forbidden）。
    if (getCount(store, defId, 1) < 1) addPart(store, defId, 1, 1);
  }
  saveInventory(store);
  // F-CONTENT-PLAYER-BODY-PACK-R1：车身部分（拥有即解锁，非计数；幂等）
  grantAllNewBodies();
  // F-CONTENT-PLAYER-MOVEMENT-PACK-R1：轮组部分（复用同一库存；幂等）
  grantAllNewMovements(store);
  return target.length;
}

/**
 * F-DEBUG-GRANT-COVERAGE-P0｜「已领取」真实判定：所有正式内容均已拥有 / 数量 ≥1。
 * - 车身：OFFICIAL_BODIES 全部 isBodyOwned（旧 4 恒默认拥有；新 4 需解锁）；
 * - 轮组：OFFICIAL_MOVEMENTS 全部 one ≥1；
 * - 功能件：OFFICIAL_PARTS 全部 one ≥1。
 * 单一来源 = 正式 Registry（OFFICIAL_BODIES / OFFICIAL_MOVEMENTS / OFFICIAL_PARTS），
 * 后续新增正式部件自动纳入；boxBody / tallBody / heavyBox / 对手池专用 / 内部占位均不在其中 → 不判定。
 * 从真实库存 / 拥有存档计算，重启后重算仍正确（不依赖 UI 内存标记；五节）。
 */
export function hasAllOfficialDebugContent(inv?: PartInventory): boolean {
  const store = inv ?? getInventory();
  for (const b of OFFICIAL_BODIES) {
    if (!isBodyOwned(b)) return false;
  }
  for (const m of OFFICIAL_MOVEMENTS) {
    if (getCount(store, m, 1) < 1) return false;
  }
  for (const p of OFFICIAL_PARTS) {
    if (getCount(store, p, 1) < 1) return false;
  }
  return true;
}
