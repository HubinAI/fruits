/**
 * PRODUCT-LOOP-R3-MOVEMENT-PERSISTENT-INVENTORY｜**永久成长里的 Movement 维度**
 * （owned / equipped / persisted 的唯一读数 + 唯一不变式保证）。
 *
 * ── 这个模块回答什么（每条只回答一次）────────────────────────────────────────
 *   ① 「这个账号**拥有**哪些 Movement」→ `movementEntries()` / `movementOwnership()`；
 *   ② 「车上**真的装着**哪几条、装在哪两个挂点」→ 同上（`equipped` / `hardpoints`）；
 *   ③ 「**新账号**的默认 Movement 拥有状态合法吗」→ `movementOwnership().legal`；
 *   ④ 「装着却不拥有的 Movement 怎么处置」→ `ensureMovementOwnership()`（**只增不减**）。
 *
 * ── 唯一的真源（本模块**不复制**任何一条数据）──────────────────────────────
 *   - Movement 内容 / 缺省轮 / 挂点   → `./runMovementCanonical`（上一轮固化的 canonical 事实清单）；
 *   - 「哪些 Movement 需要库存才拥有」→ 同上（`needsInventory`，真源 = core `OFFICIAL_MOVEMENTS`）；
 *   - 拥有数量                        → core `partInventory.getCount()`（**同一个**
 *     `strongfruit.ownedParts.v2`，与 Weapon 共用一份库存）；
 *   - 入库动作                        → core `partInventory.addPart()`（**没有**第二个库存写入口）。
 *
 * ── 为什么「拥有」不能直接复用 core 的 `canEquipMovement()` ──────────────────
 * ⚠️ `canEquipMovement(defId)` 读的是**磁盘**（它内部调 `getInventory()`），而本模块
 *    必须按**传进来的那一份** `inv` 回答 —— 否则会出现「屏幕上的读数取自内存、判据取自磁盘」
 *    这种两源分叉（R1-B 起产品侧反复吃亏的那一类缺陷）。
 *    因此本模块按 `needsInventory` 自己算 `owned`，并用 `tests/productMovementOwnership.test.ts`
 *    的 `MO-08` 把两边**逐条相等**钉死（磁盘口径 = 内存口径，真源仍旧只有一处）。
 *
 * ── 硬边界 ─────────────────────────────────────────────────────────────────
 *   - **不新建存档 key**：拥有状态与 Weapon 共用 `strongfruit.ownedParts.v2`
 *     （与 `playerGrowth` / `playerLoadout` 同一条纪律）⇒ 不制造第二套库存，
 *     也不产生第二套 Movement 拥有记录；
 *   - **不新增 Movement 类型 / 不新增数值 / 不给奖励池加东西**：本模块只描述并对齐
 *     「已经正式存在」的那几件 Movement（`REWARD_CHOICE_IDS` / `OFFICIAL_MOVEMENTS` 一字未动）；
 *   - **不改战斗**：本模块**一个字节都不写** `BuildDraft` ⇒ Run Snapshot / Runtime 数值
 *     与调用前完全相同（「不改变其战斗行为」是结构性成立的，不靠人工核对）；
 *   - **只增不减**：唯一的写动作是 `addPart(..., +1)` —— 没有 `consume`、不删除、不归零、
 *     不覆盖其它条目，与 `playerGrowth.repairEquippedStack` 是同一条纪律。
 */

import { addPart, getCount, type PartInventory } from '../core/partInventory';
import type { BuildDraft, DriveMode } from '../lab/buildEditorModel';
import { canonicalMovements, defaultMovementDefId, movementMapping } from './runMovementCanonical';

/**
 * Movement 在库存里占用的**星级档**（恒 ★1）。
 *
 * ⚠️ 这不是本模块新造的维度：core 的 `equippedSlots()` 对轮组用的也是 `star: 1`
 *    （轮组不走★1..★5 的成长链 —— 本轮**不做** Movement 的 Fusion / Star）。
 */
export const MOVEMENT_STAR = 1;

/** 一件正式 Movement 在**永久存档**里的拥有 / 装备读数（纯读数，无副作用）。 */
export interface MovementEntry {
  readonly defId: string;
  readonly name: string;
  readonly kind: string;
  /**
   * 是否**需要库存拥有**才能装备（真源 = core `OFFICIAL_MOVEMENTS`，经 `./runMovementCanonical`）。
   * `false` ⇒ 这件是**不进库存、恒默认拥有**的缺省轮。
   */
  readonly needsInventory: boolean;
  /** 库存里该 Movement 的**持久化**副本数（缺省轮恒 0：它根本不进库存）。 */
  readonly count: number;
  /** **权限口径**的「拥有」：缺省轮恒 `true`，其余需 `count > 0`（= `canEquipMovement` 的判据）。 */
  readonly owned: boolean;
  /** `true` = 不需要库存行即为拥有（= 缺省轮）。与 `owned && count === 0` 同义。 */
  readonly implicit: boolean;
  /** 车上**正装着**这件（`BuildDraft` 的 rear / front 生效项里有它）。 */
  readonly equipped: boolean;
  /** 装着它的挂点 id（空数组 = 没装）。同一件装在两处会得到两个挂点。 */
  readonly hardpoints: readonly string[];
}

/** 「局外 Profile → 本局装载」的 Movement 拥有 / 装备全量读数。 */
export interface MovementOwnershipReading {
  readonly bodyDefId: string;
  /** 经**正式归一**后的驱动模式（`undefined` / 非法 ⇒ 缺省）。 */
  readonly drive: DriveMode;
  /** 正式缺省 Movement defId（现读自正式 Snapshot 构造器，不是本模块写的字面量）。 */
  readonly defaultDefId: string;
  readonly entries: readonly MovementEntry[];
  /** 已拥有的 defId（含恒默认拥有的缺省轮） */
  readonly ownedDefIds: readonly string[];
  /** 车上正装着的 defId（去重，顺序 = canonical 顺序） */
  readonly equippedDefIds: readonly string[];
  /**
   * **不变式**：每一条装着的 Movement 都合法拥有。
   *
   * ⚠️ 这条就是 Queue 必改 2/3 要的那个「合法的默认 Movement 拥有状态」的**可断言形式**：
   *    `legal === false` 意味着车上有一件「装着却不拥有」的 Movement —— `ensureMovementOwnership()`
   *    存在的唯一理由就是把它变回 `true`。
   */
  readonly legal: boolean;
}

/**
 * 「这个 defId 装在哪个挂点」的反查表（只列**真的装上了**的：生效 defId 非空）。
 *
 * ⚠️ 数据来自正式 `movementMapping(draft)`（= 正式 Snapshot + 正式 `resolveSnapshot`）
 *    ⇒ 「车上装着什么」与 Run 侧看到的**必然**是同一份，本模块不自己解释 `BuildDraft`。
 */
function equippedIndex(draft: BuildDraft): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const slot of movementMapping(draft).slots) {
    if (slot.effectiveDefId === null) continue; // 该挂点没有装载 Movement（含明确卸下的 `'none'`）
    const list = map.get(slot.effectiveDefId);
    if (list) list.push(slot.hardpointId);
    else map.set(slot.effectiveDefId, [slot.hardpointId]);
  }
  return map;
}

/**
 * 全部正式 Movement 的拥有 / 装备读数（顺序 = canonical 顺序，稳定）。
 *
 * ⚠️ 遍历的是 **canonical Movement 集合**（`registry.movements`）而不是库存条目 ⇒
 *    「缺省轮不在库存里」也不会漏报（它照样是一条读数，只是 `count = 0` / `implicit = true`）。
 *    这也正是「拥有状态」必须由这一层回答、而不能只看库存形状的原因。
 */
export function movementEntries(inv: PartInventory, draft: BuildDraft): readonly MovementEntry[] {
  const equipped = equippedIndex(draft);
  return canonicalMovements().map((m) => {
    const implicit = !m.needsInventory;
    const count = getCount(inv, m.defId, MOVEMENT_STAR);
    const hardpoints = equipped.get(m.defId);
    return {
      defId: m.defId,
      name: m.name,
      kind: m.kind,
      needsInventory: m.needsInventory,
      count: implicit ? 0 : count,
      owned: implicit || count > 0,
      implicit,
      equipped: hardpoints !== undefined,
      hardpoints: hardpoints ?? [],
    };
  });
}

/** 一次性读出页面 / 测试需要的全部 Movement 拥有读数（页面禁止自行推导）。 */
export function movementOwnership(inv: PartInventory, draft: BuildDraft): MovementOwnershipReading {
  const mapping = movementMapping(draft);
  const entries = movementEntries(inv, draft);
  return {
    bodyDefId: mapping.bodyDefId,
    drive: mapping.drive,
    defaultDefId: defaultMovementDefId(),
    entries,
    ownedDefIds: entries.filter((e) => e.owned).map((e) => e.defId),
    equippedDefIds: entries.filter((e) => e.equipped).map((e) => e.defId),
    legal: entries.every((e) => !e.equipped || e.owned),
  };
}

/**
 * **唯一保证**：车上装着的 Movement 必须合法拥有（Queue 必改 2 / 必改 3 的落地动作）。
 *
 * 处置（**只增不减**，与 `playerGrowth.repairEquippedStack` 逐条同构）：
 *   - 该 Movement 需要库存、且 `count === 0`，而车上**正装着它** ⇒ 补 **1** 件并返回它的 id；
 *   - 已经拥有（含恒默认拥有的缺省轮）⇒ **一个字节都不动**；
 *   - 只装着「不需要库存」的缺省轮 ⇒ 本次是**空操作**（新账号的形态就是这一种）。
 *
 * ⚠️ 只经 core 的 `addPart()`（**没有**第二个库存写入口），且只改**内存**里的 `inv` ——
 *    落盘仍由调用方那**唯一一次** `saveInventory()` 负责（见 `openGrowthSession` 的顺序说明）。
 * ⚠️ 本函数**不碰** `draft`：Run Snapshot / Runtime 数值与调用前逐字节相同 ⇒ 不改变战斗行为。
 */
export function ensureMovementOwnership(inv: PartInventory, draft: BuildDraft): readonly string[] {
  const granted: string[] = [];
  // 先取快照再逐个补：`movementEntries` 每次都会重算，边读边写会读到半成品形态。
  for (const entry of movementEntries(inv, draft)) {
    if (!entry.equipped || entry.owned) continue;
    addPart(inv, entry.defId, MOVEMENT_STAR, 1);
    granted.push(entry.defId);
  }
  return granted;
}
