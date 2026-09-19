/**
 * PRODUCT-LOOP-R1-A-HOME-GARAGE-INVENTORY｜正式玩家「局外装备状态」的**唯一数据源**（纯逻辑）。
 *
 * 本模块只做一件事：把「玩家当前装备了什么主武器」接到**已经存在的正式存档链路**上，
 * 不新建存档、不新建库存、不新增任何武器定义。
 *
 * 正式链路（全部复用，零新增）：
 *   - **当前 Build** = `core/buildPersistence.ts` 的 `loadPlayerBuild()` / `savePlayerBuild()`
 *     （localStorage `strongfruit.playerBuild.v1`，带 saveVersion 信封）。
 *     与正式玩法运行时 `game/playerGameRuntime.ts` 的 `init()` 读的是**同一处**：
 *       `this.draftA = loadPlayerBuild() ?? makeStarterDraft('watermelonBody', registry)`
 *     ⇒ 首页 / 调整战车看到的 Build 就是正式玩法下一局要用的那一份（验收 6：唯一数据源）。
 *   - **库存** = `core/partInventory.ts` 的 `ensureInventory(draft)`（`strongfruit.ownedParts.v2`）。
 *     该函数**幂等**：已有可用库存直接返回，不重复生成（验收 5）。
 *   - **武器定义** = `core/content.ts` 的 `registry.functionals`，按正式分类字段
 *     `category === 'weapon'` 筛选（必改 2：不新增任何武器定义）。
 *
 * 硬边界（写进代码，避免以后被误当成正式系统）：
 *   - 本 Queue **只打通 1 个 Weapon 槽位**（`WEAPON_SLOT`）。Body / Movement / 其它 Gadget
 *     只做**只读展示**；不为「完整四槽」扩大范围（必改 1）。
 *   - ⚠️ **Run 强化不是局外部件**：`heavyShell` / `twinCannon` / `fastReload` 是
 *     `runModifiers.ts` 的第一层强化，在 `registry.functionals` 里**查无此件**
 *     ⇒ `isWeaponDefId` 对它们恒为 false，结构上不可能被本模块装备。
 *     Run Buff 与局外永久部件保持概念分离（必改 2）。
 *   - 写入前必须过正式 `validateSnapshot`：`savePlayerBuild` 本身不校验，而
 *     `loadPlayerBuild` 一旦校验失败就返回 null（= 玩家 Build 被静默打回 starter）。
 *     因此非法组合**拒绝落盘**，不制造「存档悄悄丢失」的隐患。
 */

import { registry } from '../core/content';
import { computeEnergy, validateSnapshot } from '../core/buildValidator';
import { loadPlayerBuild, savePlayerBuild } from '../core/buildPersistence';
import {
  EMPTY_SLOT,
  SLOT_LABELS,
  buildSnapshotFromDraft,
  makeStarterDraft,
  type BuildDraft,
} from '../lab/buildEditorModel';
import { ensureInventory, getCount, type PartInventory } from '../core/partInventory';
import type { BodyDef, FunctionalPartDef } from '../core/types';

/** 正式玩家车身（与 `playerGameRuntime` 的 starter 同一取值）。 */
export const PLAYER_BODY_DEF_ID = 'watermelonBody';

/**
 * MVP **唯一**打通的 Weapon 槽位 = 车身「前上挂点」（`frontMass`）。
 *
 * 为什么是它（不是 `front`、不是 `top`）：
 *   - 正式 starter（`makeStarterDraft`）在该槽装的就是 **炮**（`cannon`，`category='weapon'`）
 *     ⇒ 首屏零额外假设就有一个**真实主武器**，首页不会出现「当前武器 = 辅助」的语义错位；
 *   - 车身的 `front` 槽在 starter 里装的是 **推杆**（`pushRod`，`category='gadget'`）——
 *     那是辅助位，不是武器位；
 *   - 车身的 `top` 槽（锤）本轮保持**只读展示**，避免为了「多武器槽」扩大范围。
 */
export const WEAPON_SLOT = 'frontMass';

/** MVP 要求的「至少 N 个可切换武器」——正式 starter 已天然满足（见 `weaponEntries`）。 */
export const MVP_MIN_WEAPONS = 2;

/** 一件可装备武器在库存里的当前读数。 */
export interface WeaponEntry {
  readonly defId: string;
  readonly name: string;
  /** 单件能量占用（1★ 基准，`FunctionalPartDef.energy`） */
  readonly energy: number;
  /** 拥有的 1★ 副本数（本 Queue 只打通 1★ 档；星级 UI 属 Queue 禁止清单） */
  readonly count: number;
}

/** 一个 Functional 挂点的展示读数（只读；除 `WEAPON_SLOT` 外本轮不可改）。 */
export interface SlotReading {
  readonly hardpointId: string;
  readonly label: string;
  readonly defId: string;
  readonly name: string;
  /** 'weapon' | 'gadget' | null（空槽） */
  readonly category: string | null;
  readonly occupied: boolean;
  /** 是否为本 Queue 唯一可写的 Weapon 槽位 */
  readonly editable: boolean;
}

/** 首页 / 调整战车共同读取的完整局外读数（单一来源，页面不自行推导）。 */
export interface LoadoutReading {
  readonly bodyDefId: string;
  readonly bodyName: string;
  readonly hp: number;
  readonly energy: number;
  readonly energyCapacity: number;
  readonly weaponSlot: string;
  readonly weaponSlotLabel: string;
  /** 当前装备的主武器 defId；空槽为 `EMPTY_SLOT` */
  readonly equippedWeaponId: string;
  readonly equippedWeaponName: string;
  readonly weapons: readonly WeaponEntry[];
  readonly slots: readonly SlotReading[];
}

/** 空存档首次启动的合法 starter Build（与正式运行时同一条 fallback）。 */
export function defaultPlayerDraft(): BuildDraft {
  return makeStarterDraft(PLAYER_BODY_DEF_ID, registry);
}

/**
 * 读取玩家当前 Build。**唯一读入口**：先读正式存档，无存档才回退 starter。
 * ⚠️ 回退值**不落盘** —— 保持 `core/onboarding.ts` 的「全新账号」判定（`loadPlayerBuild() === null`）语义不变。
 */
export function loadEquippedDraft(): BuildDraft {
  return loadPlayerBuild() ?? defaultPlayerDraft();
}

/**
 * 库存**唯一入口**：复用正式 `ensureInventory`（幂等，已有可用库存不重复生成/不覆盖）。
 */
export function playerInventory(draft: BuildDraft): PartInventory {
  return ensureInventory(draft);
}

/** 正式分类查询：该 defId 是否是一件**正式武器**（`category === 'weapon'`）。 */
export function isWeaponDefId(defId: string): boolean {
  return registry.functionals.get(defId)?.category === 'weapon';
}

/** 全部正式武器定义（稳定字典序；来源 = 正式 registry，不是本模块自建清单）。 */
export function weaponDefs(): readonly FunctionalPartDef[] {
  return [...registry.functionals.values()]
    .filter((d) => d.category === 'weapon')
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * 可装备武器列表 = 正式武器定义 ∩ 库存 1★ 拥有。
 * 无新增库存、无新增定义：拿到的就是玩家真实拥有的东西。
 */
export function weaponEntries(inv: PartInventory): readonly WeaponEntry[] {
  const out: WeaponEntry[] = [];
  for (const def of weaponDefs()) {
    const count = getCount(inv, def.id, 1);
    if (count > 0) out.push({ defId: def.id, name: def.name, energy: def.energy, count });
  }
  return out;
}

/** 当前 Weapon 槽位里的 defId（空槽 → `EMPTY_SLOT`）。 */
export function equippedWeaponId(draft: BuildDraft): string {
  const v = draft.functionalSelections[WEAPON_SLOT];
  return v && v !== EMPTY_SLOT ? v : EMPTY_SLOT;
}

/** 车身 Functional 挂点的展示读数（顺序 = BodyDef 硬点顺序，空槽如实标「空」）。 */
export function slotReadings(draft: BuildDraft): readonly SlotReading[] {
  const body: BodyDef | undefined = registry.bodies.get(draft.bodyDefId);
  if (!body) return [];
  return body.functionalHardpoints.map((hp) => {
    const defId = draft.functionalSelections[hp.id] ?? EMPTY_SLOT;
    const occupied = defId !== EMPTY_SLOT;
    const def = occupied ? registry.functionals.get(defId) : undefined;
    return {
      hardpointId: hp.id,
      label: SLOT_LABELS[hp.id] ?? hp.id,
      defId,
      name: def ? def.name : '空',
      category: def ? def.category : null,
      occupied,
      editable: hp.id === WEAPON_SLOT,
    };
  });
}

/** 一次性读出页面需要的全部局外读数（页面禁止自行推导，必须走这里）。 */
export function loadoutReading(draft: BuildDraft, inv: PartInventory): LoadoutReading {
  const body: BodyDef | undefined = registry.bodies.get(draft.bodyDefId);
  const snap = buildSnapshotFromDraft(draft, registry);
  const energy = computeEnergy(snap, registry).energy;
  const eqId = equippedWeaponId(draft);
  const eqDef = eqId === EMPTY_SLOT ? undefined : registry.functionals.get(eqId);
  return {
    bodyDefId: draft.bodyDefId,
    bodyName: body ? body.name : draft.bodyDefId,
    hp: body ? body.hp : 0,
    energy,
    energyCapacity: body ? body.energyCapacity : 0,
    weaponSlot: WEAPON_SLOT,
    weaponSlotLabel: SLOT_LABELS[WEAPON_SLOT] ?? WEAPON_SLOT,
    equippedWeaponId: eqId,
    equippedWeaponName: eqDef ? eqDef.name : '空',
    weapons: weaponEntries(inv),
    slots: slotReadings(draft),
  };
}

/** 装备失败原因（页面如实展示，不静默成功）。 */
export type EquipFailure = 'not-weapon' | 'not-owned' | 'invalid-build' | 'unknown-slot';

export interface EquipOutcome {
  readonly ok: boolean;
  readonly reason?: EquipFailure;
  readonly detail?: string;
  /** 成功时为落盘后的新 Build；失败时**不返回**（调用方不得用它覆盖当前态）。 */
  readonly draft?: BuildDraft;
}

/**
 * **唯一写入口**：把一件已拥有的正式武器装进 `WEAPON_SLOT` 并落盘。
 *
 * 校验顺序（任一不通过即拒绝，**零副作用**）：
 *   1. `not-weapon`     —— 不是正式武器（含 Run 强化名 heavyShell / twinCannon / fastReload）；
 *   2. `unknown-slot`   —— 车身没有该挂点（防 Body 变更后写入非法槽）；
 *   3. `not-owned`      —— 库存 1★ 副本为 0；
 *   4. `invalid-build`  —— 组合过不了正式 `validateSnapshot`（如超能量 / 无武器）。
 * 通过后 `savePlayerBuild` 落盘 —— 与正式玩法读的是同一个 key，无需任何同步步骤。
 */
export function equipWeapon(
  defId: string,
  draft: BuildDraft = loadEquippedDraft(),
  inv: PartInventory = playerInventory(draft),
): EquipOutcome {
  if (!isWeaponDefId(defId)) {
    return { ok: false, reason: 'not-weapon', detail: `"${defId}" 不是正式武器（Run 强化不可作为永久装备）` };
  }
  const body = registry.bodies.get(draft.bodyDefId);
  const hasSlot = !!body && body.functionalHardpoints.some((h) => h.id === WEAPON_SLOT);
  if (!hasSlot) {
    return { ok: false, reason: 'unknown-slot', detail: `车身 "${draft.bodyDefId}" 没有挂点 "${WEAPON_SLOT}"` };
  }
  if (getCount(inv, defId, 1) <= 0) {
    return { ok: false, reason: 'not-owned', detail: `库存里没有 "${defId}" 的 1★ 副本` };
  }
  const next: BuildDraft = {
    ...draft,
    functionalSelections: { ...draft.functionalSelections, [WEAPON_SLOT]: defId },
  };
  const result = validateSnapshot(buildSnapshotFromDraft(next, registry), registry);
  if (!result.valid) {
    return { ok: false, reason: 'invalid-build', detail: result.errors.join(' / ') };
  }
  savePlayerBuild(next);
  return { ok: true, draft: next };
}
