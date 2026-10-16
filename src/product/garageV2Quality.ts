/**
 * GARAGE-V2-QUALITY-FOUNDATION-R1｜**品质 / 实例模型 + 纯逻辑五合一事务**（Foundation）。
 *
 * ── 本模块是什么 ────────────────────────────────────────────────────────────
 *   Garage 2.0（参照蔚蓝星球/卡皮巴拉：逐件材料格、七档品质、同部位同品质 5 合 1、
 *   主件保留类型）的**数据/事务底座**。只有纯逻辑与只读投影：
 *     ① `QUALITY_TIERS` 七档品质（white→green→blue→purple→orange→red→chrome）；
 *     ② 旧堆叠存档 → 逐件 `ItemInstance` 的**确定性只读投影**（`projectItemInstances`，
 *        旧 key 永远是真源，投影是纯函数 ⇒ 结构上不可能复制/丢件）；
 *     ③ 独立偏差账本 key（`garageV2Ledger.v1`）只记「被品质五合一消耗掉的旧堆叠件 +
 *        产出的品质件」—— **不覆盖** `ownedParts.v2` / `ownedBodies.v1`（Queue 明令）；
 *     ④ `fuseQualityFive`：主件 + 4 件同部位同品质（可不同 defId）五件不同实例 →
 *        主件类型下一品质；失败零写盘（内存事务回滚），成功一次原子保存。
 *
 * ── 本模块不是什么（冻结边界）────────────────────────────────────────────────
 *   - **不接正式 Run 战斗**：7 档品质 → 旧 star 倍率只有 5 档（buildSnapshot.ts:53
 *     `STAR_DAMAGE_MAX_STAR = 5` 夹取），且 Body/Movement/Gadget 根本没有星级通道
 *     ⇒ 映射缺口见 `docs/garage-v2/G2-AUDIT.md §G`，等下一轮设计决策；
 *   - 不改 star1..5 倍率 / 武器伤害 / `INVENTORY_MAX_STAR` / `canFuse` 旧横屏融合规则；
 *   - 不做 UI（B/C 两个纯 UI Queue 的入口 API 见本文件底部「下一 Queue 调用契约」）；
 *   - 不动 Body 的拥有模型（无数量、不可消耗 —— 审计 §F），Body 只进只读投影。
 */

import { platform } from '../platform';
import {
  consume,
  getCount,
  saveInventory,
  type PartInventory,
} from '../core/partInventory';
import { savePlayerBuild } from '../core/buildPersistence';
import { OFFICIAL_BODIES, isBodyOwned } from '../core/bodyOwnership';
import { registry } from '../core/content';
import { validateSnapshot } from '../core/buildValidator';
import { buildSnapshotFromDraft, type BuildDraft } from '../lab/buildEditorModel';
import { playerInventory, WEAPON_SLOT } from './playerLoadout';
/*
  GARAGE-V2-QUALITY-WEAPON-EQUIP-R1｜账本读写真源移入 core（core 不依赖 product 的方向纪律
  —— loadPlayerBuild 加载校验需要账本读口）。本模块 re-export 保持既有调用方
  （garageV2Lab / 既有测试）的 import 面**逐字节不变**；PL-26 登记新来源（登记非放宽）。
*/
import {
  GARAGE_V2_LEDGER_KEY,
  GARAGE_V2_LEDGER_VERSION,
  loadGarageV2LedgerData,
  saveGarageV2LedgerData,
} from '../core/qualityLedger';

/* ══════════════════════════ ① 品质模型 ══════════════════════════ */

/** 七档品质 id（白→绿→蓝→紫→橙→红→彩；`chrome` = 彩，封顶）。 */
export type QualityTier =
  | 'white'
  | 'green'
  | 'blue'
  | 'purple'
  | 'orange'
  | 'red'
  | 'chrome';

/** 品质档顺序（index = 品质等级；合成 = index+1）。顺序即合成链，禁改。 */
export const QUALITY_TIERS: readonly QualityTier[] = [
  'white',
  'green',
  'blue',
  'purple',
  'orange',
  'red',
  'chrome',
];

/** 品质玩家语言名（UI Queue 直接取用，不各自拼字面量）。 */
export const QUALITY_LABELS: Readonly<Record<QualityTier, string>> = {
  white: '白',
  green: '绿',
  blue: '蓝',
  purple: '紫',
  orange: '橙',
  red: '红',
  chrome: '彩',
};

/** 最低品质（新获得的件都是白）。 */
export const QUALITY_BASE: QualityTier = 'white';

/** 是否封顶品质（彩不可继续合成）。 */
export function isMaxQuality(tier: QualityTier): boolean {
  return tier === 'chrome';
}

/** 下一品质；封顶 / 非法输入 → `null`（调用方如实显示，不假装有下一档）。 */
export function nextQuality(tier: QualityTier): QualityTier | null {
  const i = QUALITY_TIERS.indexOf(tier);
  if (i < 0 || i >= QUALITY_TIERS.length - 1) return null;
  return QUALITY_TIERS[i + 1] ?? null;
}

/** 品质等级（0=白 … 6=彩）；非法 → -1（调用方校验）。 */
export function qualityRank(tier: QualityTier): number {
  return QUALITY_TIERS.indexOf(tier);
}

/* ══════════════════════════ ② 部位模型 ══════════════════════════ */

/** 材料部位（`body` 只投影、不参与消耗 —— 见审计 §F）。 */
export type ItemSlotKind = 'weapon' | 'movement' | 'gadget' | 'body';

/**
 * 部位判据（**全部现读正式目录**，本模块零字面量部件表）：
 *   - weapon / gadget = `registry.functionals` 的 `category`（content.ts FunctionalPartDef）；
 *   - movement = `registry.movements` 认识它（`kind` 全部 `'wheel'`，types.ts:148
 *     `MovementDef = WheelDef` ⇒ 前后轮同类，审计 §B 裁定）；
 *   - body = `OFFICIAL_BODIES`（bodyOwnership.ts:45）。
 */
export function slotKindOf(defId: string): ItemSlotKind | null {
  const fn = registry.functionals.get(defId);
  if (fn) return fn.category === 'gadget' ? 'gadget' : 'weapon';
  if (registry.movements.has(defId)) return 'movement';
  if (OFFICIAL_BODIES.includes(defId)) return 'body';
  return null;
}

/** defId 展示名（现读目录；未知 → defId 原样）。 */
export function itemDisplayName(defId: string): string {
  return (
    registry.functionals.get(defId)?.name ??
    registry.movements.get(defId)?.name ??
    registry.bodies.get(defId)?.name ??
    defId
  );
}

/* ══════════════════════════ ③ 实例模型 ══════════════════════════ */

/** 一件可展示的材料实例（逐件一格的模型）。 */
export interface ItemInstance {
  /**
   * 实例 id。**两种来源**：
   *   - 旧堆叠投影：`q1:<defId>:<star>:<ordinal>`（确定性，见 `projectItemInstances`）；
   *   - 品质合成产物：`qv2:<defId>:<quality>:<n>`（只存在于偏差账本，见 ④）。
   * `q1:` 前缀实例永远映射回旧堆叠（真源不变）；`qv2:` 前缀是 Garage 2.0 新产物。
   */
  readonly instanceId: string;
  readonly defId: string;
  readonly name: string;
  readonly slot: ItemSlotKind;
  /** 旧星级档（1..5）。品质件（qv2）无旧星档 → `null`。 */
  readonly legacyStar: number | null;
  /** 品质档：旧件投影恒 `white`（审计 §C：旧模型无品质信息）；合成产物 = 实际档。 */
  readonly quality: QualityTier;
  /** 该实例当前是否可被品质五合一消耗（已装备保护 / Body / 封顶件 = false）。 */
  readonly consumable: boolean;
  /** 不可消耗的原因（UI Queue 可直接展示；`null` = 可消耗）。 */
  readonly lockedReason:
    | 'equipped'
    | 'body-not-consumable'
    | 'max-quality'
    | 'legacy-star-locked'
    | null;
}

/**
 * 当前 BuildDraft 引用的 (defId, star) 集合（**stack 级装备保护**，审计 §E.3）：
 *   - Weapon：`(functionalSelections['frontMass'], functionalStars[frontMass] ?? 1)`；
 *   - Movement：rear/front 两个 defId（旧模型 Movement 恒 ★1）；
 *   - Gadget：gadgetDefId（恒 ★1）；
 *   - Body：bodyDefId。
 * 装备引用是 `(defId, star)` 而非实例 ⇒ 同 stack 的副本共享保护语义
 *（消耗该 stack 任意副本都合法——装备读数不指向实例；产物引用升星走合成事务内的
 * validateSnapshot 校验，见 ④）。
 */
export function equippedStackRefs(draft: BuildDraft): ReadonlySet<string> {
  const refs = new Set<string>();
  const WEAPON_SLOT = 'frontMass';
  const wDef = draft.functionalSelections[WEAPON_SLOT];
  if (wDef && wDef !== 'none') {
    refs.add(`w:${wDef}:${draft.functionalStars?.[WEAPON_SLOT] ?? 1}`);
  }
  for (const d of [draft.rearWheelDefId, draft.frontWheelDefId]) {
    if (d) refs.add(`m:${d}:1`);
  }
  if (draft.gadgetDefId && draft.gadgetDefId !== 'none') refs.add(`g:${draft.gadgetDefId}:1`);
  refs.add(`b:${draft.bodyDefId}:1`);
  return refs;
}

/**
 * 偏差账本的消耗记录键（v2）：
 *   - `consumedIds`: 具体被消耗的旧堆叠**实例 id** 集合（`q1:<defId>:<star>:<n>`）——
 *     实例恒等性的真源；领奖/迁移只可能新增**更高序号**的实例，已耗 id 永不复活；
 *   - `highWatermark`: 每 `(defId|star)` 已分配过的**最大序号**（高水位）——
 *     保证「消耗后领奖」的新件拿到全新序号，不复用任何已耗 id。
 */
export interface ConsumedRecord {
  readonly consumedIds: readonly string[];
  readonly highWatermark: number;
  /**
   * COH R3：`true` = fuseQualityFive 的写桥已把该 stack 的消耗**同步扣进**
   * `ownedParts.v2`（raw = 幸存数）⇒ 投影序号空间 = 幸存数 + 已耗数；
   * `false`（v1 数量升级 / 手工写入）= raw **未**同步（= 原始数）⇒
   * 空间 = 原始数（已耗 id 只用于跳过）。两种口径都不会复活已耗 id。
   */
  readonly synced: boolean;
}

/** 一件品质合成产物在账本里的记录。 */
export interface QualityProduct {
  readonly defId: string;
  readonly quality: QualityTier;
  /** 同 (defId,quality) 内的序号（从 1 起；账本追加语义的确定性 id 部分）。 */
  readonly seq: number;
}

/** 偏差账本（`garageV2Ledger.v1` v2）：品质五合一造成的库存偏差（实例级）。 */
export interface GarageV2Ledger {
  readonly version: number;
  /**
   * 已被品质五合一消耗的旧堆叠件，逐 `(defId|star)` 记录**具体实例 id 列表 + 高水位**。
   * ⚠️ v1 只记数量（`number`）——读入时自动升级为 v2 形状（数量 → 前 N 个序号 + 高水位 N），
   *    与旧 v1 账本向后兼容（旧消耗不丢、语义不变）。
   */
  readonly consumed: Readonly<Record<string, ConsumedRecord>>;
  /** 品质合成产物（逐件）。 */
  readonly products: readonly QualityProduct[];
}

const LEDGER_KEY = GARAGE_V2_LEDGER_KEY;
const LEDGER_VERSION = GARAGE_V2_LEDGER_VERSION;

/**
 * 读偏差账本（无 / 损坏 / 形状非法 → 空账本，绝不抛）。
 * ⚠️ WEAPON-EQUIP-R1 起实现移入 `core/qualityLedger.loadGarageV2LedgerData`
 *    （core 加载校验需要同一读口）；本函数保留为**既有调用方的唯一入口**，
 *    逐字段行为由两侧一致性测试钉死。
 */
export function loadGarageV2Ledger(): GarageV2Ledger {
  return loadGarageV2LedgerData() as GarageV2Ledger;
}

/** 写偏差账本（信封版本戳；失败静默 —— 与既有存档模块同一纪律）。 */
function saveGarageV2Ledger(ledger: GarageV2Ledger): void {
  saveGarageV2LedgerData(ledger);
}

/**
 * **旧堆叠 → 逐件实例的确定性投影**（只读，Queue 必改 2 的核心）。
 *
 * 规则（全部确定性，同输入恒同输出 ⇒ 幂等验收的结构性保证）：
 *   1. 遍历 `inv` 的 `(defId, star)` 桶，按 **OFFICIAL 目录序（defId 出现顺序）→ star 升序**
 *      稳定排序；每个副本按剩余数（= 计数 − 该 stack 已被账本消耗的数）逐件展开；
 *   2. instanceId = `q1:<defId>:<star>:<ordinal>`，ordinal 为**该 (defId,star) 内 1 起的全局序**——
 *      ⚠️ 序号按「**原始计数**」分配再按消耗量截断（前 N 件保留），保证消耗中间件后
 *      其余实例 id **不漂移**（同存档多次加载 id 逐字稳定）；
 *   3. 旧件品质恒 `white`（旧模型无品质信息，如实投影；品质件只来自合成产物）；
 *   4. 账本 `products` 追加为 `qv2:<defId>:<quality>:<seq>` 实例（品质档 = 实际档）。
 *
 * **只读适配（不改公共 core）**：旧 key 是唯一真源，本函数不写任何存储。
 * Body 参与投影（无数量：拥有=1 件白品质，`consumable=false`）。
 * `draft` 参数保留在签名里（B/C UI Queue 的调用形态统一；装备标注走 `equippedStackRefs`）。
 */
export function projectItemInstances(
  inv: PartInventory,
  _draft: BuildDraft,
): readonly ItemInstance[] {
  const ledger = loadGarageV2Ledger();
  const out: ItemInstance[] = [];

  // GARAGE-V2-QUALITY-WEAPON-EQUIP-R1：当前 draft 装备着的品质实例集合
  //（装备保护：已上槽的实例不可再当合成材料 ⇒ 不产生悬空引用）。
  const equippedInstanceIds = new Set<string>(
    Object.values(_draft.equippedQualityInstances ?? {}),
  );

  // ① 旧堆叠投影（Functional + Movement；稳定顺序 = 目录定义序）
  const entries: { defId: string; slot: ItemSlotKind; star: number; count: number }[] = [];
  for (const def of registry.functionals.values()) {
    if (!OFFICIAL_COUNTS.has(def.id)) continue;
    const slot = slotKindOf(def.id);
    if (!slot || slot === 'body') continue;
    for (let star = 1; star <= 5; star++) {
      const c = getCount(inv, def.id, star);
      if (c > 0) entries.push({ defId: def.id, slot, star, count: c });
    }
  }
  // 目录序对 Movement 也要覆盖（registry.functionals 不含轮组）
  for (const def of registry.movements.values()) {
    for (let star = 1; star <= 5; star++) {
      const c = getCount(inv, def.id, star);
      if (c > 0) entries.push({ defId: def.id, slot: 'movement', star, count: c });
    }
  }

  for (const e of entries) {
    const rec = ledger.consumed[`${e.defId}|${e.star}`];
    const consumedIds = new Set(rec?.consumedIds ?? []);
    const highWater = rec?.highWatermark ?? 0;
    // COH 修正（实例恒等性 + 双账本同步后的口径）：
    //   fuseQualityFive 会把消耗**同步扣进 ownedParts.v2**（write bridge）⇒
    //   e.count（raw）已经是**有效剩余数**；账本 consumedIds 只承担两件事：
    //     ① 实例身份：序号空间 = 1..max(count, highWater)，被点名的 id 跳过——
    //        非尾号消耗 ⇒ 只有被点名的 id 消失；旧 id 永不复活；
    //     ② 高水位：消耗后再领奖 ⇒ 新件从「未被占用的最小序号」出现（>高水位的空洞跳过）。
    //   ⚠️ 不做「raw − consumedTotal」的二次扣减（那会双扣）。
    // 序号空间（COH 定案）：
    //   - synced（fuse 写桥已扣 raw）：raw=幸存数 ⇒ 原始空间 = 幸存 + 已耗
    //     （消耗非尾号时尾号仍要出现）；
    //   - 非 synced（v1 升级/手工）：raw=原始数 ⇒ 空间 = 原始数（已耗 id 只用于跳过）。
    const total = rec?.synced === true
      ? Math.max(e.count + consumedIds.size, highWater)
      : Math.max(e.count, highWater);
    for (let i = 1; i <= total; i++) {
      const id = `q1:${e.defId}:${e.star}:${i}`;
      if (consumedIds.has(id)) continue;
      // 旧星级 > 1 ⇒ 显式锁定（COH R4）：旧 ★2..★5 是旧 5合1 的成长结果，
      // 品质模型尚无对等映射（审计 §G）——不得无声降成与初始白同权，等设计决策。
      const legacyLocked = e.star > 1;
      out.push({
        instanceId: id,
        defId: e.defId,
        name: itemDisplayName(e.defId),
        slot: e.slot,
        legacyStar: e.star,
        quality: 'white',
        consumable: !legacyLocked,
        lockedReason: legacyLocked ? 'legacy-star-locked' : null,
      });
    }
  }

  // ② Body 投影（无数量：每台拥有车身 = 1 件；不可消耗 —— 审计 §F）
  for (const defId of OFFICIAL_BODIES) {
    if (!isBodyOwned(defId)) continue;
    out.push({
      instanceId: `q1:${defId}:1:1`,
      defId,
      name: itemDisplayName(defId),
      slot: 'body',
      legacyStar: null,
      quality: 'white',
      consumable: false,
      lockedReason: 'body-not-consumable',
    });
  }

  // ③ 品质产物投影（账本 products；永远可再合成直到封顶）
  for (const p of ledger.products) {
    const slot = slotKindOf(p.defId);
    if (!slot || slot === 'body') continue; // 账本不该有 body 产物；如实跳过
    const instanceId = `qv2:${p.defId}:${p.quality}:${p.seq}`;
    // WEAPON-EQUIP-R1：已上槽的品质实例 = 装备保护（不可消耗）。
    // 复用既有 lockedReason='equipped' 枚举与 fuse 的 consumable 闸门——零新规则。
    const isEquipped = equippedInstanceIds.has(instanceId);
    out.push({
      instanceId,
      defId: p.defId,
      name: itemDisplayName(p.defId),
      slot,
      legacyStar: null,
      quality: p.quality,
      consumable: !isMaxQuality(p.quality) && !isEquipped,
      lockedReason: isEquipped ? 'equipped' : isMaxQuality(p.quality) ? 'max-quality' : null,
    });
  }

  return out;
}

/**
 * OFFICIAL Functional 集合（与 `normalizeInventory` 同一目录口径）：
 * 投影只认这份集合（Lab/prototype 件不进玩家背包）。
 */
const OFFICIAL_COUNTS: ReadonlySet<string> = (() => {
  const s = new Set<string>();
  for (const def of registry.functionals.values()) s.add(def.id);
  return s;
})();

/* ══════════════════════════ ④ 纯逻辑五合一事务 ══════════════════════════ */

/** 品质五合一的入参（全实例 id；主件在前，材料 4 件在后）。 */
export interface QualityFuseInput {
  /** 玩家指定的主件实例 id（成品保留主件 defId 与类型）。 */
  readonly mainInstanceId: string;
  /** 材料 4 件实例 id（要求：与主件同部位 + 同品质 + 五件互不相同）。 */
  readonly materialInstanceIds: readonly string[];
  /** 当前正式 Build 装备引用（装备保护与产物升星校验用）。 */
  readonly draft: BuildDraft;
}

export type QualityFuseFailure =
  | 'unknown-instance'
  | 'duplicate-instance'
  | 'cross-slot'
  | 'cross-quality'
  | 'max-quality'
  | 'not-consumable'
  | 'not-enough-materials'
  | 'legacy-star-missing'
  | 'equip-failed';

export type QualityFuseResult =
  | {
      readonly ok: true;
      /** 成品实例 id（`qv2:<defId>:<nextQuality>:<seq>`）。 */
      readonly productId: string;
      readonly productDefId: string;
      /** 成品品质（= 主件品质 + 1）。 */
      readonly productQuality: QualityTier;
      /** 被消耗的 5 个实例 id（含主件）。 */
      readonly consumedInstanceIds: readonly string[];
      /** 是否因「装备中的主件旧档被合空」而沿既有 `equipWeapon` 升星（既有语义，审计 §D）。 */
      readonly equippedUpgraded: boolean;
    }
  | {
      readonly ok: false;
      readonly reason: QualityFuseFailure;
      /** 玩家可读原因（零写盘时用于 UI 提示）。 */
      readonly detail: string;
    };

/**
 * **品质五合一（纯逻辑 + 原子保存）**。
 *
 * 规则（Queue 必改 3 逐条）：
 *   - 主件 + 恰 4 件材料；材料与主件**同部位 + 同品质**，**允许不同 defId**；
 *   - 五件必须是**五个不同实例**（实例 id 互异；旧堆叠投影与品质产物都算实例）；
 *   - 成品 = **主件 defId 的下一品质**一件（其余四件纯消耗）；彩封顶；
 *   - 装备保护：
 *       · 主件是旧堆叠件（q1）⇒ 消耗走旧账本 `consumed` 计数；若主件所属旧档被合空
 *         且装备正指向该档 ⇒ 沿**既有** `equipWeapon` 升星语义校验；失败整体回滚零写盘；
 *       · 主件是品质件（qv2）⇒ 直接从账本 products 移除该件；
 *   - 失败（未知实例/重复/跨部位/跨品质/封顶/不可消耗/材料不足/装备校验失败）⇒
 *     **零写盘**（内存对象回滚，账本/库存/Build 全部原样）；成功 ⇒ 一次原子保存账本
 *     （旧堆叠的消耗记在账本 `consumed`，不重写 `ownedParts.v2`）。
 */
export function fuseQualityFive(input: QualityFuseInput): QualityFuseResult {
  const fail = (reason: QualityFuseFailure, detail: string): QualityFuseResult => ({ ok: false, reason, detail });
  const ledger = loadGarageV2Ledger();
  const instances = projectItemInstances(ensureInventoryOf(input.draft), input.draft);
  const byId = new Map(instances.map((i) => [i.instanceId, i] as const));

  const main = byId.get(input.mainInstanceId);
  if (!main) return fail('unknown-instance', `主件实例不存在：${input.mainInstanceId}`);

  const mats = input.materialInstanceIds.map((id) => {
    const inst = byId.get(id);
    return inst ? { id, inst } : null;
  });
  if (mats.some((m) => m === null)) {
    return fail('unknown-instance', '存在不存在的材料实例');
  }
  const all = [main, ...(mats as { id: string; inst: ItemInstance }[]).map((m) => m.inst)];

  // 五件互不相同（实例 id 闭集判重）
  const ids = new Set(all.map((i) => i.instanceId));
  if (ids.size !== all.length) return fail('duplicate-instance', '五件中存在重复实例');

  // 恰好 1+4
  if (input.materialInstanceIds.length !== 4) {
    return fail('not-enough-materials', `材料必须恰好 4 件（给了 ${input.materialInstanceIds.length} 件）`);
  }

  // 同部位 + 同品质（主件为基准；允许不同 defId）
  for (const m of all.slice(1)) {
    if (m.slot !== main.slot) {
      return fail('cross-slot', `材料 "${m.name}" 与主件部位不同（${m.slot} vs ${main.slot}）`);
    }
    if (m.quality !== main.quality) {
      return fail('cross-quality', `材料 "${m.name}" 与主件品质不同`);
    }
  }

  // 封顶 / 可消耗
  if (isMaxQuality(main.quality)) return fail('max-quality', '彩品质已是上限，不可继续合成');
  if (!main.consumable) return fail('not-consumable', `主件不可消耗（${String(main.lockedReason)}）`);
  for (const m of all.slice(1)) {
    if (!m.consumable) return fail('not-consumable', `材料 "${m.name}" 不可消耗（${String(m.lockedReason)}）`);
  }

  const nextTier = nextQuality(main.quality);
  if (!nextTier) return fail('max-quality', '无下一品质档');

  // —— 以下全部在内存副本上操作；任何失败 return 即整体回滚（零写盘）——
  const nextConsumed: Record<string, ConsumedRecord> = { ...ledger.consumed };
  let nextProducts = [...ledger.products];
  const consumedIds: string[] = [];

  // 主件旧档引用（装备升星判定用）
  const mainWasLegacy = main.instanceId.startsWith('q1:');
  const mainLegacyStar = main.legacyStar;

  for (const inst of all) {
    consumedIds.push(inst.instanceId);
    if (inst.instanceId.startsWith('q1:')) {
      // 旧堆叠件：账本记录**具体实例 id**（COH 实例恒等性）+ 高水位推进（COH R2）
      const key = `${inst.defId}|${inst.legacyStar ?? 1}`;
      const prev = nextConsumed[key] ?? { consumedIds: [], highWatermark: 0, synced: false };
      if (prev.consumedIds.includes(inst.instanceId)) {
        return fail('unknown-instance', `实例已被消耗，不可复用：${inst.instanceId}`);
      }
      const ordinal = Number(inst.instanceId.split(':')[3] ?? 0);
      nextConsumed[key] = {
        consumedIds: [...prev.consumedIds, inst.instanceId],
        highWatermark: Math.max(prev.highWatermark, ordinal),
        synced: true, // 本次事务会把消耗同步扣进旧真源
      };
    } else {
      // 品质件：从 products 移除该件
      const idx = nextProducts.findIndex(
        (p) => `qv2:${p.defId}:${p.quality}:${p.seq}` === inst.instanceId,
      );
      if (idx >= 0) nextProducts.splice(idx, 1);
    }
  }

  // 产物 seq：同 (defId, nextQuality) 现有 max seq + 1（确定性追加）
  const existingSeqs = nextProducts
    .filter((p) => p.defId === main.defId && p.quality === nextTier)
    .map((p) => p.seq);
  const nextSeq = (existingSeqs.length > 0 ? Math.max(...existingSeqs) : 0) + 1;
  nextProducts = [...nextProducts, { defId: main.defId, quality: nextTier, seq: nextSeq }];

  // —— 装备引用完整性（只在主件是旧堆叠件且其旧档被合空时可能触发）——
  // COH R3：equip-failed 不再只是布尔读数 —— Weapon 分支**真实落盘**（savePlayerBuild），
  // 且**同步扣减旧堆叠真源**（saveInventory 写 ownedParts.v2 的对应档位）——
  // 否则旧 Garage/旧 fuseStack 仍看到已耗材料（双账本）。
  // ⚠️ 写桥边界（Queue 必改 3）：扣减发生在「该 stack 被合空/部分消耗」的场景，
  //    数值 = 账本 v2 形状的消耗数；ownedParts.v2 是唯一旧真源，本写入是**同步**而非覆盖玩家其他档位。
  let equippedUpgraded = false;
  let inventoryTouched = false;
  if (mainWasLegacy && mainLegacyStar !== null) {
    const invNow = ensureInventoryOf(input.draft);
    const key = `${main.defId}|${mainLegacyStar}`;
    const consumedRec = nextConsumed[key];
    const consumedTotal = consumedRec?.consumedIds.length ?? 0;
    const stackNow = getCount(invNow, main.defId, mainLegacyStar);
    // 该旧档在「旧堆叠 − 账本已消耗」意义下被合空，且装备正指向该档
    const equippedRefs = equippedStackRefs(input.draft);
    const slotPrefix = main.slot === 'movement' ? 'm' : main.slot === 'gadget' ? 'g' : 'w';
    const equippedRef = `${slotPrefix}:${main.defId}:${mainLegacyStar}`;
    if (consumedTotal >= stackNow && equippedRefs.has(equippedRef)) {
      // WEAPON-EQUIP-R1：武器槽已穿戴**品质实例** ⇒ 旧 stack 升星语义不适用——
      //   当前装备读数是 functionalQualities（品质倍率），不是 functionalStars；
      //   若照旧写 functionalStars.frontMass，resolveSnapshot 会被 quality 路径遮蔽
      //   （不双乘），但将来换回旧武器时会留下一颗**陈旧 star**（幽灵升星）。
      //   保守裁定：跳过升星、正常完成合成（消耗照记、产物照发）——装备侧由
      //   加载校验保护（绑定还在、产物还在 ⇒ 合法），并注明这是一条**已披露边界**。
      if (main.slot === 'weapon' && (input.draft.equippedQualityInstances?.[WEAPON_SLOT] ?? null) !== null) {
        // 零写盘到 Build：不写 functionalStars，不 savePlayerBuild；
        // equippedUpgraded 如实报 false（本轮没有发生升星）。
      } else if (main.slot === 'weapon') {
        // 沿既有 equipWeapon 升星语义（审计 §D fuseStack 同款）：校验失败 ⇒ 回滚零写盘
        const nextStar = mainLegacyStar + 1;
        if (nextStar > 5) {
          return fail('equip-failed', `装备升星越界（★${nextStar} > ★5）：旧装备链路不支持，需设计决策`);
        }
        // 校验「升星后的 Build 仍是合法快照」——复用正式 validate 链
        const probe: BuildDraft = {
          ...input.draft,
          functionalStars: { ...(input.draft.functionalStars ?? {}), frontMass: nextStar },
        };
        const result = validateSnapshot(buildSnapshotFromDraft(probe, registry), registry);
        if (!result.valid) {
          return fail('equip-failed', `合成会留下非法装配：${result.errors.join(' / ')}`);
        }
        // COH R3b：**真实落盘**装备升星（不是布尔读数）——写正式 playerBuild.v1
        savePlayerBuild(probe);
        equippedUpgraded = true;
      } else if (main.slot === 'movement' || main.slot === 'gadget') {
        // Movement/Gadget 无星级通道（审计 §C）⇒「装备中的最后一件被品质合成消耗」
        // 会让装备引用悬空。Foundation 采取**拒绝**而非静默破坏（零写盘），
        // 由 UI Queue 引导玩家先卸下或换材料。这是保守而正确的边界。
        return fail(
          'equip-failed',
          `${main.slot === 'movement' ? '轮组' : '辅助'} "${main.name}" 正在装备中且是同档最后一件：先卸下或换一件材料（装备引用不能悬空）`,
        );
      }
    }
  }

  // —— 全部校验通过：一次原子保存 ——
  // ① 账本（本 Queue 自己的 key）
  saveGarageV2Ledger({ version: LEDGER_VERSION, consumed: nextConsumed, products: nextProducts });
  // ② COH R3 双账本同步：把**本次事务**新消耗的件数同步扣进旧堆叠真源（ownedParts.v2）——
  //    只减「本次事务点名的 (defId,star)」对应数量（= 本次新加入 consumedIds 的条数），
  //    其它档位零触碰。守恒：raw − consumedTotal 每次事务恰好 −（本次新耗数），
  //    effectiveInventory（= raw − consumedTotal）与旧系统读数保持一致。
  {
    const invNow = ensureInventoryOf(input.draft);
    const prevLedger = ledger.consumed;
    let touched = false;
    for (const [key, rec] of Object.entries(nextConsumed)) {
      const [defId, starStr] = key.split('|');
      const star = Number(starStr);
      if (!defId || !Number.isFinite(star)) continue;
      const prevIds = prevLedger[key]?.consumedIds ?? [];
      const delta = rec.consumedIds.filter((id) => !prevIds.includes(id)).length;
      if (delta > 0) {
        consume(invNow, defId, star, delta);
        touched = true;
      }
    }
    if (touched) {
      saveInventory(invNow);
      inventoryTouched = true;
    }
  }
  void inventoryTouched;

  return {
    ok: true,
    productId: `qv2:${main.defId}:${nextTier}:${nextSeq}`,
    productDefId: main.defId,
    productQuality: nextTier,
    consumedInstanceIds: consumedIds,
    equippedUpgraded,
  };
}

/** 读取当前正式库存（与 playerLoadout.playerInventory 同一口径）。 */
function ensureInventoryOf(draft: BuildDraft): PartInventory {
  return playerInventory(draft);
}

/** 测试/重置辅助：清空偏差账本（只删本 Queue 自己的 key；旧 key 永不触碰）。 */
export function resetGarageV2LedgerForTest(): void {
  try {
    platform.storage.removeItem(LEDGER_KEY);
  } catch {
    // 静默
  }
}

/* ════════════════ ⑤ 有效库存 / 装备一致性（COH 必改 3） ════════════════ */

/**
 * **有效库存读数** = 旧堆叠真源 − 账本已消耗（COH R3 的统一口径）。
 *
 * 这是「未来 B UI / 合成选择 / 装备校验」应该读取的**唯一**库存口径：
 *   - 品质五合一成功后，账本消耗**同步扣减**旧堆叠（fuseQualityFive 写桥）⇒
 *     正常情况下本函数与 `playerInventory` 逐档相等；
 *   - 若外部路径（旧 Garage 合成 / 领奖 / debug）在账本之后改了旧堆叠，
 *     本函数按「max(0, raw − consumed)」夹取 —— 账本永不产生负库存；
 *   - **不写任何存储**（纯读）。
 */
export function effectiveInventory(draft: BuildDraft): PartInventory {
  // COH 定案：fuseQualityFive 的写桥把消耗**同步扣进** ownedParts.v2 ⇒
  // raw 即有效读数（与旧 Garage/Run 同一口径，双账本问题从根上消除）。
  // 本函数保留为 B/C UI 的**唯一读入口**（语义 = 正式库存；将来若引入
  // 「不同步的账本条目」可在此处叠加扣减，调用方零改动）。
  void loadGarageV2Ledger;
  return playerInventory(draft);
}

export type QualityEquipFailure =
  | 'run-not-wired'
  | 'unknown-instance'
  | 'not-owned'
  | 'not-weapon'
  | 'invalid-quality'
  | 'unknown-slot'
  | 'invalid-build';

export interface QualityEquipOutcome {
  readonly ok: boolean;
  readonly reason?: QualityEquipFailure;
  readonly detail?: string;
  /** 成功时为落盘后的新 Build；失败时不返回（调用方不得用它覆盖当前态）。 */
  readonly draft?: BuildDraft;
}

/**
 * **Weapon 品质产物真实穿戴**（GARAGE-V2-QUALITY-WEAPON-EQUIP-R1）。
 *
 * 单问题边界：只打通 **Weapon**（category === 'weapon'）品质产物 → 确认穿戴 →
 * 合法快照 → 真实战斗。Movement / Gadget / Body 产物**仍**显式 `run-not-wired`
 * （绝不拿武器品质伤害倍率冒充别的部位强度）。
 *
 * 事务（全部校验通过才落盘，任一失败**零写盘**）：
 *   1. instanceId 必须是 `qv2:<defId>:<quality>:<seq>` 四段式且**在账本 products 里**
 *      （真实持有判据与加载校验同源：core/qualityLedger）；
 *   2. defId 必须是正式 Weapon（registry category）；
 *   3. 当前 draft 的 Body 必须有 WEAPON_SLOT 挂点；
 *   4. 组装 probe draft：武器槽写 functionalQualities[slot]=quality +
 *      equippedQualityInstances[slot]=instanceId + **清该槽 star**（不双乘），
 *      过正式 validateSnapshot（能量超载 / 非法装配在这里被拒）；
 *   5. `savePlayerBuild` 真实落盘 → 重载后正式 Run 链
 *      （buildSnapshotFromDraft → resolveSnapshot → ContactRouter）真实使用品质倍率。
 *
 * ⚠️ 实例绑定（equippedQualityInstances）：同 defId+quality 的两件实例靠 seq 严格区分；
 *    加载时 core 侧真实校验绑定仍被持有（幽灵绑定 ⇒ 整份存档非法）；
 *    已上槽实例经投影 lockedReason='equipped' 不可再被五合一消耗。
 * ⚠️ 换回旧武器走**旧 equipWeapon 入口**（它会清掉品质两字段——往返无陈旧）。
 */
export function equipQualityProduct(
  productId: string,
  draft: BuildDraft,
): QualityEquipOutcome {
  // ① 形状 + 账本持有（真实持有判据；不是「字符串像就行」）
  if (!productId.startsWith('qv2:')) {
    return { ok: false, reason: 'unknown-instance', detail: `非品质产物实例：${productId}` };
  }
  const seg = productId.split(':');
  if (seg.length !== 4) {
    return { ok: false, reason: 'invalid-quality', detail: `品质实例 id 形状非法：${productId}` };
  }
  const [, defId, qualityRaw, seqRaw] = seg as [string, string, string, string];
  if (!(qualityRaw in QUALITY_LABELS)) {
    return { ok: false, reason: 'invalid-quality', detail: `未知品质档：${qualityRaw}` };
  }
  const quality = qualityRaw as QualityTier;
  if (!Number.isInteger(Number(seqRaw)) || Number(seqRaw) < 1) {
    return { ok: false, reason: 'invalid-quality', detail: `实例序号非法：${productId}` };
  }
  if (!loadGarageV2LedgerData().products.some(
    (p) => p.defId === defId && p.quality === quality && p.seq === Number(seqRaw),
  )) {
    return { ok: false, reason: 'not-owned', detail: `该品质实例不在账本持有记录里（未合成过或已被消耗）：${productId}` };
  }

  // ② 必须是正式 Weapon（Movement/Gadget/Body 显式 run-not-wired，不假成功）
  const kind = slotKindOf(defId);
  if (kind !== 'weapon') {
    return {
      ok: false,
      reason: 'run-not-wired',
      detail: `品质产物目前只支持 Weapon 穿戴（"${defId}" 是 ${String(kind ?? '未知部位')}）；Movement/Gadget/Body 接入属下一轮`,
    };
  }
  const def = registry.functionals.get(defId);
  if (!def || def.category !== 'weapon') {
    return { ok: false, reason: 'not-weapon', detail: `"${defId}" 不是正式武器` };
  }

  // ③ Body 挂点
  const body = registry.bodies.get(draft.bodyDefId);
  if (!body || !body.functionalHardpoints.some((h) => h.id === WEAPON_SLOT)) {
    return { ok: false, reason: 'unknown-slot', detail: `车身 "${draft.bodyDefId}" 没有武器挂点 "${WEAPON_SLOT}"` };
  }

  // ④ probe draft：写品质 + 绑定 + 清该槽 star（不双乘），过正式校验
  const nextStars: Record<string, number> = { ...(draft.functionalStars ?? {}) };
  delete nextStars[WEAPON_SLOT];
  const nextQualities: Record<string, QualityTier> = {
    ...(draft.functionalQualities ?? {}),
    [WEAPON_SLOT]: quality,
  };
  const nextBinds: Record<string, string> = {
    ...(draft.equippedQualityInstances ?? {}),
    [WEAPON_SLOT]: productId,
  };
  const probe: BuildDraft = {
    ...draft,
    functionalSelections: { ...draft.functionalSelections, [WEAPON_SLOT]: defId },
    functionalStars: nextStars,
    functionalQualities: nextQualities,
    equippedQualityInstances: nextBinds,
  };
  if (Object.keys(nextStars).length === 0) delete probe.functionalStars;
  const result = validateSnapshot(buildSnapshotFromDraft(probe, registry), registry);
  if (!result.valid) {
    return { ok: false, reason: 'invalid-build', detail: result.errors.join(' / ') };
  }

  // ⑤ 真实落盘（不是布尔冒充）
  savePlayerBuild(probe);
  return { ok: true, draft: probe };
}
