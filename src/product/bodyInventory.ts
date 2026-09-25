/**
 * PRODUCT-LOOP-R4-BODY-CANONICAL-AND-GARAGE-MVP｜**永久成长里的 Body 维度**
 * （owned / equipped / persisted 的唯一读数 + 唯一不变式保证）。
 *
 * ── 这个模块回答什么（每条只回答一次）────────────────────────────────────────
 *   ① 「这个账号**拥有**哪些正式车身」→ `bodyEntries()` / `bodyOwnership()`；
 *   ② 「车上**真的装着**哪一台」→ 同上（`equipped`）；
 *   ③ 「**新账号**的默认车身拥有状态合法吗」→ `bodyOwnership().legal`；
 *   ④ 「装着却不拥有的车身怎么处置」→ 本 Queue 不做自动补发（车身无库存计数，
 *       拥有状态由 `bodyOwnership.ts` 独立持久化；详见 `equipBody` 的校验）。
 *
 * ── 唯一的真源（本模块**不复制**任何一条数据）──────────────────────────────
 *   - Body 内容（hp / baseMass / energyCapacity / 挂点） → `core/content.ts` 的
 *     `registry.bodies`（**原样透出**，不写第二套数字）；
 *   - 「哪些是正式玩家车身」→ `core/bodyOwnership.ts` 的 `OFFICIAL_BODIES`；
 *   - 「一件车身是否已拥有」→ 同上 `canEquipBody` / `isBodyOwned`（真源 = 独立持久化 key
 *     `strongfruit.ownedBodies.v1`，与 Weapon / Movement 库存是**不同的** key，互不干扰）。
 *
 * ── 为什么 Body 不需要「库存计数」这一层 ─────────────────────────────────────
 * Body 的拥有是**二态**（拥有 / 未拥有），不像 Weapon / Movement 有「副本数」维度。
 * 因此本模块**不引入** `count` 字段：拥有状态由 `canEquipBody(defId)` 一个布尔回答，
 * 与 `core/bodyOwnership.ts` 同一判据、同一份持久化（不是第二份）。
 *
 * ── 硬边界 ─────────────────────────────────────────────────────────────────
 *   - **不新建存档 key**：拥有状态沿用 `core/bodyOwnership.ts` 的
 *     `strongfruit.ownedBodies.v1`（与 Weapon / Movement 库存分离）；
 *   - **不新增 Body 类型 / 不新增数值 / 不给奖励池加东西**：本模块只描述并对齐
 *     「已经正式存在」的那几台 `OFFICIAL_BODIES`（`registry.bodies` 一字未动）；
 *   - **不改战斗**：本模块**一个字节都不写** `BuildDraft` ⇒ Run Snapshot / Runtime 数值
 *     与调用前完全相同（「不改变其战斗行为」是结构性成立的，不靠人工核对）；
 *   - **只增不减**：唯一的写动作在 `r4BodyChoiceSeed`（一次性 seed，经 `grantBody`），
 *     本模块纯只读。
 */

import { DEFAULT_OWNED_BODIES, OFFICIAL_BODIES, canEquipBody } from '../core/bodyOwnership';
import { registry } from '../core/content';
import type { BuildDraft } from '../lab/buildEditorModel';

/** 一台正式车身在**永久存档**里的拥有 / 装备读数（纯读数，无副作用）。 */
export interface BodyEntry {
  readonly defId: string;
  readonly name: string;
  /**
   * PRODUCT-LOOP-R4-BODY-CARD-READABILITY｜**卡片刻度**（耐久 / 质量 / 能量容量）。
   *
   * ⚠️ 这三个数**不是**本模块新造的维度，也不是第二套 UI 常量：它们与 `name`
   *    一样是从 `registry.bodies`（真源）原样透出来的。卡片刻的与 Run 侧真正进物理的
   *    是**同一次读取**的结果。
   * ⚠️ 刻意**只透这三个**：它们是 `BodyDef` 上真实存在、玩家能据此比较的字段。
   *    派生的「防御 +20% / 续航 +30%」这类推导值一律不做（那是 UI 自己发明事实）。
   */
  readonly hp: number;
  readonly baseMass: number;
  readonly energyCapacity: number;
  /** **权限口径**的「拥有」= `canEquipBody(defId)`（旧 4 恒 true，新 4 查存档）。 */
  readonly owned: boolean;
  /** `true` = 不需要解锁即为拥有（= 旧 4 默认车身）。与 `owned && implicit` 同义。 */
  readonly implicit: boolean;
  /** 车上**正装着**这台（`BuildDraft.bodyDefId === defId`）。 */
  readonly equipped: boolean;
}

/** 「局外 Profile → 本局装载」的 Body 拥有 / 装备全量读数。 */
export interface BodyOwnershipReading {
  readonly bodyDefId: string;
  readonly entries: readonly BodyEntry[];
  /** 已拥有的 defId（含恒默认拥有的旧 4）。 */
  readonly ownedDefIds: readonly string[];
  /** 车上正装着的 defId（去重；正常只有 1 台）。 */
  readonly equippedDefIds: readonly string[];
  /**
   * **不变式**：车上装着的车身都合法拥有。
   *
   * ⚠️ 这条就是 Queue 必改 5「禁止 silent fallback」的**可断言形式**：
   *    `legal === false` 意味着车上有一台「装着却不拥有」的车身。
   */
  readonly legal: boolean;
}

/**
 * 全部正式玩家车身的拥有 / 装备读数（顺序 = `OFFICIAL_BODIES` 顺序，稳定）。
 *
 * ⚠️ 遍历的是 **OFFICIAL_BODIES** 而不是 `registry.bodies` 的全集 ⇒
 *    Lab / 对手池用的非官方车身（`wedgeBody` / `boxBody` / `tallBody` / `heavyBox`）
 *    **不会**被当成「玩家可装备车身」混入 Garage（那会破坏「只装备正式车身」的契约）。
 *    同时 `OFFICIAL_BODIES` 本就是 `registry.bodies` 的子集
 *    ⇒ 不会出现「OFFICIAL 里有一台、registry 里却没有」的悬空引用。
 */
export function bodyEntries(draft: BuildDraft): readonly BodyEntry[] {
  return OFFICIAL_BODIES.map((defId) => {
    const def = registry.bodies.get(defId);
    // OFFICIAL_BODIES 恒为 registry.bodies 的子集；若内容库删了一台已知正式车身，
    // 这里**如实**跳过而不是崩溃（与 `canonicalBodies` 同一纪律）。
    if (!def) return null;
    const implicit = DEFAULT_OWNED_BODIES.includes(defId);
    const equipped = draft.bodyDefId === defId;
    return {
      defId: def.id,
      name: def.name,
      hp: def.hp,
      baseMass: def.baseMass,
      energyCapacity: def.energyCapacity,
      owned: canEquipBody(defId),
      implicit,
      equipped,
    } satisfies BodyEntry;
  }).filter((e): e is BodyEntry => e !== null);
}

/** 一次性读出页面 / 测试需要的全部 Body 拥有读数（页面禁止自行推导）。 */
export function bodyOwnership(draft: BuildDraft): BodyOwnershipReading {
  const entries = bodyEntries(draft);
  return {
    bodyDefId: draft.bodyDefId,
    entries,
    ownedDefIds: entries.filter((e) => e.owned).map((e) => e.defId),
    equippedDefIds: entries.filter((e) => e.equipped).map((e) => e.defId),
    legal: entries.every((e) => !e.equipped || e.owned),
  };
}

/**
 * 测试 / 探针用：这台 defId 当前是否已拥有（真源 = `isBodyOwned`，与 Garage 卡片同一口径）。
 * ⚠️ 与 `canEquipBody` 的区别：`isBodyOwned` 不要求 defId 在 OFFICIAL_BODIES 内
 * （非官方车身恒为 false），本函数只用于「已知正式车身」的读数，故直接用 `canEquipBody`。
 */
export function isBodyEntryOwned(defId: string): boolean {
  return canEquipBody(defId) && OFFICIAL_BODIES.includes(defId);
}
