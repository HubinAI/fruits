/**
 * PRODUCT-LOOP-R1-A-HOME-GARAGE-INVENTORY｜正式玩家「局外装备状态」的**唯一数据源**（纯逻辑）。
 * PRODUCT-LOOP-R2-A｜`WeaponEntry` 从「是否拥有」升级为 **星级 + 数量**（Queue 必改 1 /
 * 「Garage 最小显示」）：`star` + `count` + `threshold` + `stackText`。
 * PRODUCT-LOOP-R2-B-FUSION-STAR｜星级从「恒 ★1」变为**数据驱动**：列表逐 `(defId, star)`
 * 列出 ★1..★5 的 stack（`stackText` 改为 Queue 必改 3 的进度写法 `4/5`、`5/5`），
 * 并新增 `fusable` / `maxStar` 两个只读字段供 Garage 的「可合成」徽标与按钮使用；
 * `equipWeapon` 增加**星级形参**并同步落盘 `functionalStars`。
 * ⚠️ 本模块仍然**只读不写库存**：合成动作（消耗 5 → 产出 1）在 `playerGrowth.fuseStack()`
 *    （产品侧成长的唯一写入口），本模块只负责把它算出来的事实摆出来。
 * ⚠️ 本模块**不再**被 `playerGrowth.ts` 反向依赖的代价：阈值从 core 的 `canFuse().need` 现读
 *    （见 `stackThreshold`），而不是从 `playerGrowth` import —— 那样会成模块环。
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
 *
 *     ⚠️ PRODUCT-LOOP-R1-C 的唯一例外：**没有存档时的 fallback**不再原封照抄
 *       `makeStarterDraft`，而是把它返回的 draft 的 `front` 槽清空（见
 *       `DEFAULT_CLEARED_SLOT` 的实测证据）。**读存档那一条路径一字未改** ——
 *       有存档的玩家，首页与正式玩法读到的仍是同一条记录；只有「全新账号」的
 *       默认车不同，且差别只在 `front` 一槽。
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
// PRODUCT-LOOP-R3-MOVEMENT-GARAGE-EQUIP｜Movement 维度的**两个只读真源**。
//
// ⚠️ 本模块**不自己展开** `BuildDraft.rearWheelDefId` / `frontWheelDefId` 的语义，
//    也不自己维护一张「有哪些轮组」的表 —— 那两件事分别由上一轮固化的
//    `movementInventory`（canonical 集合 + owned/implicit 判据）与
//    `runMovementCanonical`（局外存档 → Snapshot → Runtime 的三段映射）回答。
//    本模块到这里只是**多了一个写入口**，读数口径一个字都没变。
// ⚠️ 依赖方向是 `playerLoadout → movementInventory → runMovementCanonical`，
//    三者都不反向 import 本模块之外的新东西 ⇒ 不成环（见 PL-26 白名单）。
import { MOVEMENT_STAR, movementOwnership, type MovementEntry } from './movementInventory';
import {
  canonicalMovements,
  movementHardpointIds,
  movementMapping,
  type CanonicalMovement,
} from './runMovementCanonical';
import {
  INVENTORY_MAX_STAR,
  canFuse,
  ensureInventory,
  getCount,
  type PartInventory,
} from '../core/partInventory';
// PRODUCT-LOOP-R2-B｜单件能量的**星级倍率**真源（core 战斗侧同一函数）：
// 卡片上要显示「装上它要花多少能量」，★2 的 33 必须与 Build 总能量用的 33 同源，
// 否则卡片写 30、能量条按 33 算 ⇒ 玩家看到的数与实际不符。
//
// PRODUCT-LOOP-R2-C｜同一纪律再加一条：**武器主伤害**也必须同源。
// `weaponMainDamage(def)` 是「一件武器一次命中扣多少血」的唯一读取口径
// （弹丸类读 `projectileDamage`、直击类读 `baseDamage` —— 与 ContactRouter 的两个分支一一对应），
// `starTierDamage` 是星级伤害曲线的唯一实现。卡片上给玩家看的「攻击 80 → 100」
// 与战斗里真实扣血的 100 必须是同一次计算 ⇒ 本模块**不允许**自己写 `×1.25` 这类常数。
import { starTierDamage, starTierEnergy, weaponMainDamage } from '../core/buildSnapshot';
import type { BodyDef, FunctionalPartDef } from '../core/types';

/** 正式玩家车身（与 `playerGameRuntime` 的 starter 同一取值）。 */
export const PLAYER_BODY_DEF_ID = 'watermelonBody';

/**
 * 产品侧**默认**成长星级 = ★1（= 库存数据模型的第一档）。
 *
 * `PartInventory` 的星级档位是 `one` / `two` / `three` / `four` / `five` = ★1..★5
 * （`partInventory.starKey` 是唯一映射），★1 就是这个数据模型的第一档，这里的 `1`
 * 与 `getCount(inv, id, 1)` 里已有的 `1` 是**同一件事**，不是本模块新造的常量。
 *
 * ⚠️ PRODUCT-LOOP-R2-B｜星级**不再是常量**。R2-A 时产品侧只有 ★1（「不做升星效果」），
 *    现在星级是真实的成长维度（`playerGrowth.fuseStack` 产出 ★2..★5）⇒ 本常量降级为
 *    「调用方没指定星级时的默认值」（`equipWeapon` 第 4 形参的默认值），
 *    **不再是** `weaponEntries` 的展示口径 —— 列表改为逐 `(defId, star)` 列出。
 *
 * ⚠️ 为什么这里仍然没有一个 `import { GROWTH_STAR } from './playerGrowth'`：
 *    `playerGrowth.ts` 已经 `import` 本模块（`isWeaponDefId` / `WEAPON_SLOT` / `equipWeapon`），
 *    反向 import 会形成模块环 —— 环在 ESM 下虽然常常能跑通，但 `const` 在环上的
 *    求值顺序会让「谁先被加载」决定成不成立，属**结构性隐患**而不是风格问题。
 *    因此星级的**上限**真源取 core 的 `INVENTORY_MAX_STAR`（见 `weaponEntries`）；
 *    `playerGrowth.GROWTH_MAX_STAR` 与它**同值**，由 `tests/productFusionR2B.test.ts` 断言钉死。
 */
export const WEAPON_GROWTH_STAR = 1;

/**
 * 满 stack 阈值（Garage 显示 `4/5`、`5/5` 的分母）。
 *
 * ⚠️ **不写死 5**：取自 core 自己的合成规则 `canFuse().need` —— 那才是这个数字的
 *    **唯一真源**（`partInventory.ts` 里 `need: 5` 出现在 4 处）。产品侧再写一个 5
 *    就是第二份真源，产品合成与 core 规则两处必然漂移。
 *
 * ⚠️ 第 4 个形参传 `null` 是**刻意**的：`canFuse` 的 `build` 只影响 `available` / `ok`
 *    （扣除当前已装备的那几件），我们要读的只有 `need` —— 阈值与「这件装没装在车上」无关。
 *    `equippedSlots(null)` 首行 `if (!build) return []` ⇒ 传 null 安全，不抛。
 * ⚠️ PRODUCT-LOOP-R2-B｜★3..★5 会走 `canFuse` 的 `maxStar` 分支（`star >= MAX_STAR`），
 *    该分支返回的 `need` **仍然是 5** ⇒ 阈值对所有星级同源（横屏规则的 2★ 上限
 *    只影响「能不能合」，不影响「几件合一」）。
 */
export function stackThreshold(inv: PartInventory, defId: string, star: number): number {
  return Math.max(1, canFuse(inv, defId, star, null).need);
}

/**
 * PRODUCT-LOOP-R2-C（Queue 必改 4）｜武器主属性那一行字的前缀。
 *
 * 单独提出来是为了**可断言**：E2E 用真实 DOM 断言卡片上写着
 * `攻击 80 → 100`，而不是断言页面 HTML 里恰好出现过这几个字
 * （后者在别处也会命中，证明不了「这张卡上有这一行」）。
 */
export const DAMAGE_LABEL = '攻击';

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

/**
 * 一件可装备武器在库存里的当前读数（PRODUCT-LOOP-R2-A：**星级 + 数量**）。
 *
 * Queue 必改 1 要求的 `partId / star / count` 三元组在本结构里完整可表达
 * （`defId` = partId + `star` + `count`），且**同一 `(defId, star)` 只会出现一条**
 * —— `weaponEntries` 是遍历**定义 × 星级**取 `getCount`，天然按 stack 归并，
 * 结构上不可能出现 5 张一模一样的库存卡。
 *
 * PRODUCT-LOOP-R2-B｜`star` 从「恒 1」变为**数据驱动**（★1..★5 逐个产出），
 * 并增加合成相关的两个只读字段（`fusable` / `maxStar`）。
 */
export interface WeaponEntry {
  readonly defId: string;
  readonly name: string;
  /** 单件**基准**能量（`FunctionalPartDef.energy`，恒为 1★ 值） */
  readonly energy: number;
  /**
   * 单件**实际**能量占用 = `starTierEnergy(energy, star)`（★1 恒等）。
   * ⚠️ 卡片上显示的是它，而不是 `energy`：★2 的炮真实占 33，
   *    与 Build 总能量（`computeEnergy`）用的是同一个倍率函数。
   */
  readonly energyInUse: number;
  /** 拥有的副本数（= 该 `(defId, star)` stack 的计数） */
  readonly count: number;
  /** 成长星级（★1..★5；PRODUCT-LOOP-R2-B 起由数据驱动，不再恒为 1） */
  readonly star: number;
  /** 满 stack 阈值（来自 core 合成规则，见 `stackThreshold`） */
  readonly threshold: number;
  /**
   * stack 展示文案 = **Queue 必改 3 的「数量 / 5」写法**：`4/5`；已满为 `5/5`。
   *
   * ⚠️ 已满时收敛成 `5/5` 而不是 `6/5`（R2-A 的 Queue 原文：「达到5件时可以只显示
   *    `5/5`」）。真实计数在探针的 `count` 字段里，展示不做暗示。
   * ⚠️ R2-A 的 `×4` 写法在 R2-B 被替换为进度写法（Queue 必改 3 明写「数量 / 5」）
   *    —— 这是**契约变更**，不是格式口味；`_e2e_product_*.cjs` 的断言同步更新。
   */
  readonly stackText: string;
  /** 是否已达满 stack */
  readonly reachesThreshold: boolean;
  /**
   * 现在能不能对这张卡发起一次合成（`count >= threshold` 且 `star < INVENTORY_MAX_STAR`）。
   * ⚠️ 与 `playerGrowth.canFuseStack()` **同判据**（Garage 的「可合成」徽标与合成按钮
   *    都由它驱动）；合成动作本身仍走 `playerGrowth.fuseStack()` —— 本模块只读不写。
   */
  readonly fusable: boolean;
  /** 已达**星级上限**（★5，不可再合） */
  readonly maxStar: boolean;
  /**
   * PRODUCT-LOOP-R2-C（Queue 必改 4）｜**该星级的武器主伤害** —— 一次命中扣对手多少血。
   *
   * = `starTierDamage(weaponMainDamage(def), star)`，与战斗侧真实结算用的是
   * 同一个 `behaviorParams` 字段与同一条星级曲线（★1 = 正式定义原值）。
   */
  readonly damage: number;
  /**
   * 升一星之后的伤害（`star + 1`）；已是 ★5 ⇒ `null`（没有「下一星」）。
   *
   * ⚠️ 无论当前是否凑满 5 件都会给出：Queue 必改 4 要的是「玩家在按下合成**前**就知道
   *    升星会得到什么」，而不是「凑满 5 件才告诉他」。
   */
  readonly damageNext: number | null;
  /** 卡片上的那一行字：`攻击 80 → 100`（★5 ⇒ `攻击 160`，不再画箭头）。 */
  readonly damageText: string;
}

/** 一个 Functional 挂点的展示读数（只读；除 `WEAPON_SLOT` 外本轮不可改）。 */
export interface SlotReading {
  readonly hardpointId: string;
  readonly label: string;
  readonly defId: string;
  readonly name: string;
  /** 该槽在 `BuildDraft.functionalStars` 上的星级（缺省 = ★1） */
  readonly star: number;
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
  /**
   * 当前装备的主武器**星级**（`functionalStars` 缺省 = ★1）。
   * ⚠️「装备」= `(equippedWeaponId, equippedWeaponStar)` **这一对**：同一个 defId 的
   *    ★1 与 ★2 是两个 stack，只报 defId 无法表达玩家装的是哪一档。
   */
  readonly equippedWeaponStar: number;
  readonly equippedWeaponName: string;
  readonly weapons: readonly WeaponEntry[];
  readonly slots: readonly SlotReading[];
}

/* ══════════════════ PRODUCT-LOOP-R3-MOVEMENT-GARAGE-EQUIP｜Movement 维度 ══════════════════
 *
 * ── 这个维度为什么能直接接进来（不是「顺手加的一层」）────────────────────────
 * 已确认的两个事实（`PRODUCT-LOOP-R3-MOVEMENT-CANONICAL-INVENTORY` 的产物）：
 *   ① rear / front **本来就是两个独立正式字段**（`BuildDraft.rearWheelDefId` /
 *      `frontWheelDefId`），`undefined` = 缺省标准轮、`'none'` = 明确卸下；
 *   ② 该字段**已经被真实链路消费**：`buildSnapshotFromDraft`（→ `movements[]`）→
 *      `resolveSnapshot`（含 `overrides.radius`）→ `planckVehicleAssembly` 真建轮体
 *      （radius / mass / grip 进物理），并经 `arenaA.topdownCapabilityOf` 折算
 *      `driveTorque` / `maxRPM`。
 * ⇒ 因此本 Queue **不创造新的 Movement 槽模型**，只是给这两个既有字段补一个
 *   「玩家能按」的写入口（此前它们只能被 Lab / 旧横屏游戏写入，产品 Garage 写不到）。
 *
 * ── 读数口径（与上一轮逐字一致，本模块不复制任何一条判据）────────────────────
 *   - 「拥有」= `movementInventory.movementEntries()` 的 `owned` —— 真源是
 *     `runMovementCanonical.needsInventory`（→ core `OFFICIAL_MOVEMENTS`）+ 库存计数；
 *     缺省轮不进库存、恒 `implicit: true` ⇒ 恒可装备。
 *   - 「装着什么」= `runMovementCanonical.movementMapping()`（走正式 Snapshot + `resolveSnapshot`）
 *     ⇒ 与 Run 侧看到的**必然**是同一份。
 *   - 库存里的星级档取 `movementInventory.MOVEMENT_STAR`（恒 ★1；本轮不做 Movement
 *     的 Fusion / Star）。
 */

/** 一个 Movement 挂点在 Garage 里的展示读数（只读；页面禁止自行推导）。 */
export interface MovementSlotReading {
  readonly hardpointId: string;
  /**
   * 局外**原样存着**的那个值（`runMovementCanonical.MovementSlotMapping.storedDefId`）：
   *   - `null`   = 存档里没有这个键（= 缺省标准轮，不是「空」）；
   *   - `'none'` = 明确卸下（`EMPTY_SLOT`）；
   *   - 其它     = 正式 Movement defId。
   */
  readonly storedDefId: string | null;
  /** 当前**生效**的 defId（= 正式 Snapshot 里该槽真正装载的那件）；未装 ⇒ `null`。 */
  readonly effectiveDefId: string | null;
  /** 生效件的展示名（未装 ⇒ `'空'`）。 */
  readonly name: string;
  /** 该槽是否**明确卸下**（`storedDefId === 'none'`）。与「缺省」刻意分开。 */
  readonly unmounted: boolean;
}

/** 一件 Movement 在 Garage 卡片上的读数（= 可否装备的**唯一判据**来源）。 */
export interface MovementCardReading extends MovementEntry {
  /** 当前这件正装在哪几个挂点上（`[]` = 没装）。 */
  readonly hardpoints: readonly string[];
}

/**
 * Garage / 探针共同读取的 **Movement 维度全量读数**（单一来源，页面不自行推导）。
 *
 * ⚠️ `available` 是「**只允许装备真实拥有（含隐式拥有）的 canonical Movement**」这条
 *    Queue 硬约束的**可断言形式**：它的成员由 `owned === true` 过滤而来，
 *    而 `owned` 的真源在 `movementInventory` —— 页面只会画 `available` 里的卡，
 *    结构上不存在「把没拥有的轮组装上车」的按钮。
 */
export interface MovementReading {
  readonly bodyDefId: string;
  /** Garage 两个（或更多）Movement 挂点的读数，顺序 = 正式 `BodyDef.movementHardpoints`。 */
  readonly slots: readonly MovementSlotReading[];
  /** **全部** canonical Movement 的 owned / equipped 读数（含未拥有的，供如实展示）。 */
  readonly cards: readonly MovementCardReading[];
  /** **可装备**的 defId 集合（= `cards.filter(c => c.owned)`），顺序 = canonical 顺序。 */
  readonly available: readonly string[];
  /** 已拥有的 defId（含恒默认拥有的缺省轮）。 */
  readonly ownedDefIds: readonly string[];
  /** 车上正装着的 defId（去重，顺序 = canonical 顺序）。 */
  readonly equippedDefIds: readonly string[];
  /**
   * **不变式**：每一条装着的 Movement 都合法拥有。
   * ⚠️ 与 `movementInventory.movementOwnership().legal` 同源（同一个真源，不是第二份判据）。
   */
  readonly legal: boolean;
  /** 正式缺省 Movement defId（现读自正式 Snapshot 构造器，不是本模块写的字面量）。 */
  readonly defaultDefId: string;
}

/**
 * 一次性读出 Movement 维度的全部读数（Garage 卡片与探针都只取这一份）。
 *
 * ⚠️ 本函数**零副作用**：它不写 draft、不写库存、不落盘。
 *    写只发生在 `equipMovement()`（唯一写入口，见下）。
 */
export function movementReading(draft: BuildDraft, inv: PartInventory): MovementReading {
  const ownership = movementOwnership(inv, draft);
  const mapping = movementMapping(draft);
  // 挂点顺序**现读自正式 BodyDef**（不是本模块写死 'rear' / 'front' 两个字面量）：
  // 车身加一个 Movement 硬点时，这里自动多一条读数。
  const hardpoints = movementHardpointIds(draft.bodyDefId);
  const byHardpoint = new Map(mapping.slots.map((s) => [s.hardpointId, s]));
  const nameOf = new Map(canonicalMovements().map((m) => [m.defId, m.name]));
  const cards: MovementCardReading[] = ownership.entries.map((e) => ({
    ...e,
    hardpoints: [...e.hardpoints],
  }));
  return {
    bodyDefId: ownership.bodyDefId,
    slots: hardpoints.map((hardpointId) => {
      const slot = byHardpoint.get(hardpointId);
      const storedDefId = slot ? slot.storedDefId : null;
      const effectiveDefId = slot ? slot.effectiveDefId : null;
      return {
        hardpointId,
        storedDefId,
        effectiveDefId,
        name: effectiveDefId ? nameOf.get(effectiveDefId) ?? effectiveDefId : '空',
        // ⚠️「明确卸下」只能由 `'none'` 表达；`null`（存档里没有这个键）是**缺省轮**在装。
        //    两者在物理上**不同**（缺省轮有 wheelStd 的半径 / 质量 / 抓地），
        //    所以这里绝不把 `null` 也算成卸下（那会让页面把「标准轮在跑」说成「没轮」）。
        unmounted: storedDefId === EMPTY_SLOT,
      };
    }),
    cards,
    available: cards.filter((c) => c.owned).map((c) => c.defId),
    ownedDefIds: [...ownership.ownedDefIds],
    equippedDefIds: [...ownership.equippedDefIds],
    legal: ownership.legal,
    defaultDefId: ownership.defaultDefId,
  };
}

/**
 * PRODUCT-LOOP-R1-C｜**默认车必须留空的前置槽**（= 车身「前端挂点」`front`）。
 *
 * 为什么产品侧的默认车要把这一槽留空 —— 这是**实测结论**，不是口味：
 *
 *   - 正式 starter（`makeStarterDraft`）在 `front` 装的是**推杆**（`pushRod`，
 *     Prismatic 往复 gadget），而产品唯一打通的主武器槽是 `frontMass`（「前上挂点」，x=45）；
 *   - 车身硬点几何上：`front`(x=78) 的占位覆盖 x∈[78,158]，而 `frontMass` 上任何主武器的
 *     collider 都伸到 x≈85 ⇒ **两者重叠 7px**；更关键的是推杆每次伸出都以反作用力把
 *     **自家车**向后推（`pushRodBehavior` 的 Q04-R1A 实测反推 ≈241px/周期）；
 *   - 后果：`front` 挂着推杆时，车在整场战斗里被持续推离射程，**第一场就输**。
 *     实测矩阵（竖屏 lab 构建产物里的真实 `run-page.html` + 同一驱动策略，每条至少 1 次）：
 *       推杆@front + 炮@frontMass + 锤@top  → FAILED（战斗 1，2/2）
 *       front 留空（其余不变）              → COMPLETE（4/4 场，4/4）
 *       主武器挪到 front（front 不留推杆）  → COMPLETE（3/3）
 *   - ⚠️ 玩家**无法自己修**：R1 只打通 1 个可写槽位（`WEAPON_SLOT`），Garage 换不掉
 *     `front` 上的推杆 ⇒ 不处理这一条，新账号的「开始冒险 → 完整一局 → COMPLETE」
 *     主循环**结构上不可达**（这正是本 Queue 必须补的**阻断主循环**问题）。
 *
 * ⚠️ 边界（本改动只动产品侧的**默认车**，不越线）：
 *   - `makeStarterDraft`（正式 gameplay 的 starter）与 `src/{game,battle,…}` **一字未改**；
 *   - 推杆仍在正式库存里（`STARTER_PARTS` 不变，`ensureInventory` 与 draft 槽位无关）
 *     ⇒ 只是**不装在这一台默认车上**，不删内容、不造数值；
 *   - 更深的修法（`front`/`frontMass` 挂点几何重叠、推杆反推）属**独立 Queue**，
 *     本 Queue 只做「让主循环能走通」的最小产品侧处置。
 */
export const DEFAULT_CLEARED_SLOT = 'front';

/**
 * 本模块的**唯一落盘点**（`tests/productLoopHomeGarage.test.ts` 的 `PL-03` 钉死：
 * `savePlayerBuild(` 在本文件只允许出现一次 —— 该点位的存在意义就是「本模块只有一个写入口」）。
 *
 * 目前有两条语义都经过它，二者都必须过正式 `validateSnapshot` 之后才调用：
 *   ① **玩家动作** —— `equipWeapon()`（换装并落盘）；
 *   ② **加载期一次性归一化** —— `loadEquippedDraft()` 里的旧 starter 迁移
 *      （PRODUCT-LOOP-P0，见 `migrateLegacyStarterProfile`）。
 */
function persistPlayerBuild(draft: BuildDraft): void {
  savePlayerBuild(draft);
}

/** 空存档首次启动的合法 starter Build。 */
export function defaultPlayerDraft(): BuildDraft {
  const starter = makeStarterDraft(PLAYER_BODY_DEF_ID, registry);
  // 见上方 DEFAULT_CLEARED_SLOT：把前置槽留给主武器，默认车不挂推杆。
  return {
    ...starter,
    functionalSelections: {
      ...starter.functionalSelections,
      [DEFAULT_CLEARED_SLOT]: EMPTY_SLOT,
    },
  };
}

/**
 * PRODUCT-LOOP-P0-LEGACY-PROFILE-MIGRATION-AND-RUN-REACHABILITY｜旧 starter profile 的**一次性迁移**。
 *
 * ## 为什么需要它
 * 旧 starter（Q26 `makeStarterDraft`，Lab 侧至今原样保留）在车身「前置挂点」（`front`）装的是
 * **推杆**（`pushRod`），而 R1-C 实测：`front` 挂着推杆时它每个周期都把**自家车**向后推
 * （≈241px / 周期）⇒ 车被持续推离射程 ⇒ **完整 Run 的第一场（DAY2）稳定失败**
 * ⇒ 产品主循环对这类旧存档**结构上不可达**。
 * 产品侧的新账号默认车（`defaultPlayerDraft`）从 R1-C 起已把这一槽留空，但**已经落盘的旧存档**
 * 不会自动变 —— 本函数补上这一步。
 *
 * ## 迁移形状（Queue 必改 1）
 * ```
 *   旧：front = 旧 starter 的前置件（pushRod）   frontMass = 旧 starter 的主武器（cannon）
 *   新：front = EMPTY_SLOT                      frontMass **不动**
 * ```
 * **其它数据一字不动**：inventory / 星级 / 数量 / 已装备武器 / 领奖 / 进度**全部保留** ——
 * 本函数只改这一份 BuildDraft 的**一个槽**，而库存（`strongfruit.ownedParts.v2`）与进度
 * （`strongfruit.playerProgress.v1`）是**独立的** localStorage key，本模块根本不碰。
 * 明确**禁止** reset 整个 Profile。
 *
 * ## ⚠️ 判别式为什么要收紧（这是本迁移唯一的风险点）
 * 「`front` 是不是推杆」**本身不足以判定**这是旧 starter：旧横屏正式游戏的**正常玩家车库**
 * 开放了**全部** functional 硬点（`ui/webDomPlayerUIHost.ts:429` 用的就是
 * `editableSlots(body)` = 全部硬点；`main.ts` 的装配页同），而推杆在候选池里
 * （`core/partOptions.ts`）⇒ 玩家可以**主动**把推杆装在 `front`，并落进**同一个**存档 key
 * （`playerGameRuntime` 的 `savePlayerBuild`）。**所以不能「见到推杆就删」。**
 *
 * 判定要求两个条件**同时**成立：
 *   ① **结构与旧 starter 一致**：`front` / `frontMass` 两槽等于 `makeStarterDraft` 的取值。
 *      签名**直接取自那个真源函数**，不在本模块抄一份常量表 —— 否则就是第二份真源。
 *   ② **该槽没有玩家侧写入留下的星级印记**（`functionalStars[front]` 不存在）。
 *      这是可靠信号：**所有**面向玩家的槽位写入路径都会**同时**盖星级印记
 *      （`main.ts`、`playerGameRuntime.applyBuildEdit`、`canvasUIHost` 的装备分支），
 *      而 `makeStarterDraft` **完全不写** `functionalStars`。
 *      ⚠️ 已知边界（已上报，不是静默假设）：Q22（引入星级概念）**之前**的存档无法被这一条区分。
 * 任一条件不成立 ⇒ **原样返回、一个字节都不改**（宁可不迁移，也不粗暴删玩家的推杆）。
 *
 * ## 为什么「读入口」会落盘
 * 迁移必须**落盘**才能算完成：Home 与 Run 读的都是**已存储**的那份 profile，
 * 只做读时投影会让「旧存档永远停在旧形态」。而落盘天然**只可能发生一次** ——
 * 迁移后 `front` 已是空槽，签名不再成立（见下方 `loadEquippedDraft`）。
 */
export interface LegacyProfileMigration {
  readonly migrated: boolean;
  readonly reason: 'legacy-starter' | 'not-legacy-shape' | 'player-chosen' | 'invalid' | 'no-profile';
  /** 迁移后的 Draft（未迁移时 = 入参本身，逐字节相同） */
  readonly draft: BuildDraft;
  /** 迁移后的槽位选择（未迁移时 = 入参那份）；便于调用方直接比对，不必自己展开 */
  readonly selections: Readonly<Record<string, string>>;
}

/** 纯判定 + 纯变换：**不落盘**（落盘只发生在 `loadEquippedDraft` 的唯一一处）。 */
export function migrateLegacyStarterProfile(draft: BuildDraft): LegacyProfileMigration {
  const sel: Record<string, string> = draft.functionalSelections ?? {};
  const keep = (reason: LegacyProfileMigration['reason']): LegacyProfileMigration => ({
    migrated: false,
    reason,
    draft,
    selections: sel,
  });
  // 该车身必须真有这一槽，否则谈不上迁移（防 Body 变更后对不存在的槽做文章）
  const body: BodyDef | undefined = registry.bodies.get(draft.bodyDefId);
  if (!body || !body.functionalHardpoints.some((h) => h.id === DEFAULT_CLEARED_SLOT)) {
    return keep('not-legacy-shape');
  }
  // ① 结构签名取自旧 starter 真源（不是本模块自建的常量表）
  const legacy = makeStarterDraft(draft.bodyDefId, registry).functionalSelections;
  if (sel[DEFAULT_CLEARED_SLOT] !== legacy[DEFAULT_CLEARED_SLOT]) return keep('not-legacy-shape');
  if (sel[WEAPON_SLOT] !== legacy[WEAPON_SLOT]) return keep('not-legacy-shape');
  // ② 玩家侧从未写过这一槽（写了必留星级印记）
  if (draft.functionalStars?.[DEFAULT_CLEARED_SLOT] !== undefined) return keep('player-chosen');
  const selections: Record<string, string> = { ...sel, [DEFAULT_CLEARED_SLOT]: EMPTY_SLOT };
  const next: BuildDraft = { ...draft, functionalSelections: selections };
  // 写入前必须过正式 validateSnapshot（与 `equipWeapon` 同一纪律）：不合法就不动它
  if (!validateSnapshot(buildSnapshotFromDraft(next, registry), registry).valid) return keep('invalid');
  return { migrated: true, reason: 'legacy-starter', draft: next, selections };
}

/**
 * 读取玩家当前 Build。**唯一读入口**：先读正式存档，无存档才回退 starter。
 * ⚠️ 回退值**不落盘** —— 保持 `core/onboarding.ts` 的「全新账号」判定（`loadPlayerBuild() === null`）语义不变。
 * ⚠️ PRODUCT-LOOP-P0 起：**有存档**时本函数会顺带完成一次旧 starter → 当前 starter 的迁移
 *    （`migrateLegacyStarterProfile`），命中时**落盘一次**。这是「归一化」而不是「玩家动作」，
 *    且**结构上一次为限**：迁移后 `front` 已是空槽 ⇒ 签名不再成立 ⇒ 下次读不再写。
 */
export function loadEquippedDraft(): BuildDraft {
  const stored = loadPlayerBuild();
  if (!stored) return defaultPlayerDraft();
  const migrated = migrateLegacyStarterProfile(stored);
  if (migrated.migrated) persistPlayerBuild(migrated.draft);
  return migrated.draft;
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
 * 把读数**夹**进合法星级区间（★1..★`INVENTORY_MAX_STAR`）。
 * ⚠️ 只用于**展示 / 读数**路径（列表遍历、槽位读数）。装备**写**路径刻意不夹：
 *    越界星级直接拒绝（`equipWeapon` 的 `bad-star`），不制造「点 ★9 装上了 ★5」的静默替换。
 */
function starInRange(star: number): number {
  return Math.min(INVENTORY_MAX_STAR, Math.max(1, Math.floor(Number(star) || 1)));
}

/**
 * 可装备武器列表 = 正式武器定义 × **★1..★5**，逐 `(defId, star)` 列出 `count > 0` 的 stack。
 * 无新增库存、无新增定义：拿到的就是玩家真实拥有的东西。
 *
 * ⚠️ 遍历的是**定义 × 星级**而不是库存条目 ⇒ 同一个 `(defId, star)` 只会产生**一条**读数
 *    （「同一 stack 归并」在结构上成立，而不是靠去重）。不同星级是**不同的卡**
 *    （★2 的炮与 ★1 的炮是两个 stack），这正是 Queue「不同星级不能混合」在展示层的体现。
 * ⚠️ 只列 `count > 0` 的 stack：没有的东西不摆出来（数量为 0 的档位不占位）。
 * ⚠️ 星级上限取 core 的 `INVENTORY_MAX_STAR`（**不是** `playerGrowth.GROWTH_MAX_STAR`，
 *    那是模块环）：两者同值，由 `tests/productFusionR2B.test.ts` 断言钉死。
 */
export function weaponEntries(inv: PartInventory): readonly WeaponEntry[] {
  const out: WeaponEntry[] = [];
  for (const def of weaponDefs()) {
    const baseDamage = weaponMainDamage(def);
    /**
     * ⚠️ 只有「主伤害写在 behaviorParams 顶层数值里」的武器，星级才**能**给出一个读数。
     *
     * 正式武器里只有 `saw` 不满足：它的伤害写在**嵌套**的 `behaviorParams.hitPolicy.damage`
     * 里（走 contactTick 命中策略），星级倍率层只遍历顶层数值 ⇒ 对它是无定义的。
     * 这种情况下**不给数字**（`攻击 0 → 0` 是句假话），卡片不画这一行。
     *
     * ⚠️ 后果面为零：`saw` 不在 `STARTER_PARTS`、也不在奖励候选池（`REWARD_CHOICE_IDS`）
     * ⇒ 玩家的库存里永远不会出现它 ⇒ 这一分支在**当前产品里结构上不可达**，
     * 但它被 `tests/productStarPowerR2C.test.ts` 的 SP-03b 直接覆盖（不是凭空的防御代码）。
     */
    const readable = baseDamage > 0;
    for (let star = 1; star <= INVENTORY_MAX_STAR; star++) {
      const count = getCount(inv, def.id, star);
      if (count <= 0) continue;
      const threshold = stackThreshold(inv, def.id, star);
      const maxStar = star >= INVENTORY_MAX_STAR;
      const damage = readable ? starTierDamage(baseDamage, star) : 0;
      const damageNext = readable && !maxStar ? starTierDamage(baseDamage, star + 1) : null;
      out.push({
        defId: def.id,
        name: def.name,
        energy: def.energy,
        energyInUse: starTierEnergy(def.energy, star),
        count,
        star,
        threshold,
        // Queue 必改 3「数量 / 5」：已满收敛为 `5/5`（真实计数在探针 count 里）
        stackText: count >= threshold ? `${threshold}/${threshold}` : `${count}/${threshold}`,
        reachesThreshold: count >= threshold,
        fusable: count >= threshold && !maxStar,
        maxStar,
        damage,
        damageNext,
        // Queue 必改 4：`攻击 80 → 100`（★5 没有下一星 ⇒ 只写当前值）
        damageText: !readable
          ? ''
          : damageNext === null
            ? `${DAMAGE_LABEL} ${damage}`
            : `${DAMAGE_LABEL} ${damage} → ${damageNext}`,
      });
    }
  }
  return out;
}

/** 当前 Weapon 槽位里的 defId（空槽 → `EMPTY_SLOT`）。 */
export function equippedWeaponId(draft: BuildDraft): string {
  const v = draft.functionalSelections[WEAPON_SLOT];
  return v && v !== EMPTY_SLOT ? v : EMPTY_SLOT;
}

/**
 * 当前 Weapon 槽位的**星级**（`BuildDraft.functionalStars` 缺省 = ★1）。
 *
 * ⚠️ 与 `getCount(inv, defId, star)` 同一口径 ⇒ 「装备指向的是哪个 stack」两侧一致
 *    —— 这正是 Queue 必改 2「Equipped 不得指向不存在物品」的判据基石。
 */
export function equippedWeaponStar(draft: BuildDraft): number {
  return starInRange(draft.functionalStars?.[WEAPON_SLOT] ?? WEAPON_GROWTH_STAR);
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
      star: starInRange(draft.functionalStars?.[hp.id] ?? WEAPON_GROWTH_STAR),
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
    equippedWeaponStar: equippedWeaponStar(draft),
    equippedWeaponName: eqDef ? eqDef.name : '空',
    weapons: weaponEntries(inv),
    slots: slotReadings(draft),
  };
}

/** 装备失败原因（页面如实展示，不静默成功）。 */
export type EquipFailure = 'not-weapon' | 'not-owned' | 'invalid-build' | 'unknown-slot' | 'bad-star';

export interface EquipOutcome {
  readonly ok: boolean;
  readonly reason?: EquipFailure;
  readonly detail?: string;
  /** 成功时为落盘后的新 Build；失败时**不返回**（调用方不得用它覆盖当前态）。 */
  readonly draft?: BuildDraft;
}

/**
 * **唯一写入口**：把一件已拥有的正式武器（**指定星级**）装进 `WEAPON_SLOT` 并落盘。
 *
 * 校验顺序（任一不通过即拒绝，**零副作用**）：
 *   1. `not-weapon`     —— 不是正式武器（含 Run 强化名 heavyShell / twinCannon / fastReload）；
 *   2. `bad-star`       —— 星级不是 ★1..★`INVENTORY_MAX_STAR` 的整数
 *                          （**不夹**：拒绝比「点 ★9 装上了 ★5」的静默替换诚实）；
 *   3. `unknown-slot`   —— 车身没有该挂点（防 Body 变更后写入非法槽）；
 *   4. `not-owned`      —— 库存里该 **(defId, star)** 副本为 0；
 *   5. `invalid-build`  —— 组合过不了正式 `validateSnapshot`（如超能量 / 无武器）。
 * 通过后 `savePlayerBuild` 落盘 —— 与正式玩法读的是同一个 key，无需任何同步步骤。
 *
 * PRODUCT-LOOP-R2-B｜新增第 4 形参 `star`（缺省 ★1 ⇒ 既有调用点行为不变）：
 *   - 库存判据从「★1 有货」改为「**该星级**有货」⇒ ★2 的炮与 ★1 的炮是两个 stack，
 *     装备指向的必须是玩家点的那一个；
 *   - 落盘时同步写 `BuildDraft.functionalStars[WEAPON_SLOT]`（★1 时**删掉该键**，
 *     与 `buildEditorModel` 的既有约定一致：「缺省 = 全 ★1」，保持旧 Build 形状最简）。
 *     ⇒ 这是 Queue 必改 2 的另一半：「装备指向的 stack」在**库存**与**Build**两侧同源。
 */
export function equipWeapon(
  defId: string,
  draft: BuildDraft = loadEquippedDraft(),
  inv: PartInventory = playerInventory(draft),
  star: number = WEAPON_GROWTH_STAR,
): EquipOutcome {
  if (!isWeaponDefId(defId)) {
    return { ok: false, reason: 'not-weapon', detail: `"${defId}" 不是正式武器（Run 强化不可作为永久装备）` };
  }
  if (!Number.isFinite(star) || !Number.isInteger(star) || star < 1 || star > INVENTORY_MAX_STAR) {
    return {
      ok: false,
      reason: 'bad-star',
      detail: `非法星级 ${String(star)}（合法区间 ★1..★${INVENTORY_MAX_STAR}）`,
    };
  }
  const body = registry.bodies.get(draft.bodyDefId);
  const hasSlot = !!body && body.functionalHardpoints.some((h) => h.id === WEAPON_SLOT);
  if (!hasSlot) {
    return { ok: false, reason: 'unknown-slot', detail: `车身 "${draft.bodyDefId}" 没有挂点 "${WEAPON_SLOT}"` };
  }
  if (getCount(inv, defId, star) <= 0) {
    return { ok: false, reason: 'not-owned', detail: `库存里没有 "${defId}" 的 ${star}★ 副本` };
  }
  const stars: Record<string, number> = { ...(draft.functionalStars ?? {}) };
  if (star > 1) stars[WEAPON_SLOT] = star;
  else delete stars[WEAPON_SLOT];
  const next: BuildDraft = {
    ...draft,
    functionalSelections: { ...draft.functionalSelections, [WEAPON_SLOT]: defId },
  };
  if (Object.keys(stars).length > 0) next.functionalStars = stars;
  else delete next.functionalStars;
  const result = validateSnapshot(buildSnapshotFromDraft(next, registry), registry);
  if (!result.valid) {
    return { ok: false, reason: 'invalid-build', detail: result.errors.join(' / ') };
  }
  persistPlayerBuild(next);
  return { ok: true, draft: next };
}

/* ══════════════════ PRODUCT-LOOP-R3-MOVEMENT-GARAGE-EQUIP｜Movement 唯一写入口 ══════════════════ */

/** Movement 装备失败原因（与 Weapon 侧刻意**分开**两个联合类型，避免互相污染取值域）。 */
export type MovementEquipFailure =
  /** 车身没有这个 Movement 挂点（防 Body 变更后写入非法槽） */
  | 'unknown-slot'
  /** 不是正式 Movement（`registry.movements` 不认识它） */
  | 'not-movement'
  /** 这件需要库存拥有，而玩家没有 */
  | 'not-owned'
  /** 组合过不了正式 `validateSnapshot`（例如装上后能量超载） */
  | 'invalid-build';

export interface MovementEquipOutcome {
  readonly ok: boolean;
  readonly reason?: MovementEquipFailure;
  readonly detail?: string;
  /** 成功时为落盘后的新 Build；失败时**不返回**（调用方不得用它覆盖当前态）。 */
  readonly draft?: BuildDraft;
}

/** 该挂点在 `BuildDraft` 上对应哪个**正式字段**（`runMovementCanonical` 里读的那两个键）。 */
const MOVEMENT_DRAFT_KEY: Readonly<Record<string, 'rearWheelDefId' | 'frontWheelDefId'>> = {
  rear: 'rearWheelDefId',
  front: 'frontWheelDefId',
};

/**
 * **Movement 的唯一写入口**：把 `hardpointId` 这个挂点上的轮组写成 `defId` 并落盘。
 *
 * ── 写的是哪两个字段（Queue 必改 1 / 必改 4）────────────────────────────────
 * rear / front **本来就是两个独立正式字段** ⇒ 本函数**按挂点分别写**：
 *   `rear`  → `BuildDraft.rearWheelDefId`
 *   `front` → `BuildDraft.frontWheelDefId`
 * 不引入统一的 Movement 槽模型、不新增抽象层、不做「一套轮组同时管两处」的合成写法
 * —— 那是本 Queue 明令禁止的「自行创造新的 Movement 槽位模型」。
 *
 * ── 三个取值的语义（三态，不是两态）─────────────────────────────────────────
 *   `defId === EMPTY_SLOT`（`'none'`）→ 写 **`'none'`**：**明确卸下**该槽
 *       （`buildSnapshotFromDraft` 会把该槽从 `movements[]` 里过滤掉 ⇒ 该槽没有轮）。
 *   `defId === 缺省轮`（`movementReading().defaultDefId`，当前 = `wheelStd`）→ **删除该键**：
 *       回到「存档里没有这个键」的形态，= 缺省轮 + 保留 `rearRadius` / `frontRadius` 数值
 *       （旧存档兼容口径；写 `'wheelStd'` 字面量也等价，但会让旧 Build 形状变复杂）。
 *   其它正式 defId → 写该 defId，并**同步把该槽的 radius 数值置为该轮组的默认半径**
 *       （与 `buildEditorModel` 的既有约定一致：选中轮组卡时 `rearRadius/frontRadius`
 *        置为该轮组默认 radius，下游数值链路零改动）。
 *       ⚠️ `radius` 也会被 Snapshot 作为 `overrides.radius` 带下去（`resolveSnapshot`
 *          合并语义），所以它**必须**一起改；只改 defId 会让新轮组带着旧半径跑。
 *
 * ── 校验顺序（任一不通过即拒绝，**零副作用**）──────────────────────────────
 *   1. `unknown-slot`  —— 车身没有该 Movement 挂点，或该挂点在 `BuildDraft` 上没有对应字段；
 *   2. `not-movement`  —— 既不是正式 Movement，也不是 `EMPTY_SLOT`（明确卸下是合法输入）；
 *   3. `not-owned`     —— 这件需要库存拥有、而 `inv` 里计数为 0（缺省轮恒豁免）；
 *   4. `invalid-build` —— 组合过不了正式 `validateSnapshot`（与 Weapon 侧同一判据、同一函数）。
 * 通过后 `persistPlayerBuild` 落盘 —— 与正式玩法读的是同一个 key（`strongfruit.playerBuild.v1`），
 * 也**就是**「开始冒险」地址里 `equipped=` 参数携带的那一份 ⇒ Run Snapshot / Runtime
 * 读到的 rear / front 与 Garage 屏幕上显示的**不可能**分叉。
 *
 * ── 明确不做（Queue 禁止清单）──────────────────────────────────────────────
 *   - 不消耗库存：轮组装上**不扣**副本（与 `equipWeapon` 同一条纪律 —— 装备是引用，
 *     不是消耗）；也因此不需要任何「卸下时退回」的逻辑。
 *   - 不新增 Movement 类型 / 不新增数值：本函数只写「玩家选了哪一件」，
 *     `radius` / `mass` / `grip` / `energy` / `maxRPM` 全部取自正式 def，一个都没改。
 *   - 不做解锁 / 购买 / 经济：`not-owned` 只如实拒绝，不提供任何获取途径。
 */
export function equipMovement(
  hardpointId: string,
  defId: string,
  draft: BuildDraft = loadEquippedDraft(),
  inv: PartInventory = playerInventory(draft),
): MovementEquipOutcome {
  const key = MOVEMENT_DRAFT_KEY[hardpointId];
  if (!key || !movementHardpointIds(draft.bodyDefId).includes(hardpointId)) {
    return {
      ok: false,
      reason: 'unknown-slot',
      detail: `车身 "${draft.bodyDefId}" 没有 Movement 挂点 "${hardpointId}"`,
    };
  }
  const unmount = defId === EMPTY_SLOT;
  const canonical: CanonicalMovement | undefined = canonicalMovements().find((m) => m.defId === defId);
  if (!unmount && !canonical) {
    return { ok: false, reason: 'not-movement', detail: `"${defId}" 不是正式 Movement` };
  }
  if (canonical && canonical.needsInventory) {
    // ⚠️ 判据与 `movementInventory` 的 `owned` **同源**（`needsInventory` + 计数），
    //    但这里刻意**不看 implicit**：走到这一支就说明这件需要库存，直接查计数。
    if (getCount(inv, defId, MOVEMENT_STAR) <= 0) {
      return {
        ok: false,
        reason: 'not-owned',
        detail: `库存里没有 "${defId}"（该 Movement 需要先拥有）`,
      };
    }
  }

  const next: BuildDraft = { ...draft };
  if (unmount) {
    next[key] = EMPTY_SLOT;
  } else if (canonical && canonical.defId === movementReading(draft, inv).defaultDefId) {
    // 缺省轮 ⇒ 回到「存档里没有这个键」的形态（保留 radius 数值）
    delete next[key];
  } else {
    next[key] = defId;
    // 半径随轮组一起写（口径同 `buildEditorModel`：选中轮组卡即写入该轮组默认半径）
    if (canonical) {
      if (key === 'rearWheelDefId') next.rearRadius = canonical.radius;
      else next.frontRadius = canonical.radius;
    }
  }

  const result = validateSnapshot(buildSnapshotFromDraft(next, registry), registry);
  if (!result.valid) {
    return { ok: false, reason: 'invalid-build', detail: result.errors.join(' / ') };
  }
  persistPlayerBuild(next);
  return { ok: true, draft: next };
}
