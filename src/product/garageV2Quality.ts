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
  getCount,
  type PartInventory,
} from '../core/partInventory';
import { OFFICIAL_BODIES, isBodyOwned } from '../core/bodyOwnership';
import { registry } from '../core/content';
import { readJsonWithVersion, stampVersion } from '../core/saveVersion';
import { validateSnapshot } from '../core/buildValidator';
import { buildSnapshotFromDraft, type BuildDraft } from '../lab/buildEditorModel';
import { playerInventory } from './playerLoadout';

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

/** 一件品质合成产物在账本里的记录。 */
export interface QualityProduct {
  readonly defId: string;
  readonly quality: QualityTier;
  /** 同 (defId,quality) 内的序号（从 1 起；账本追加语义的确定性 id 部分）。 */
  readonly seq: number;
}

/** 偏差账本（`garageV2Ledger.v1`）：品质五合一造成的库存偏差。 */
export interface GarageV2Ledger {
  readonly version: number;
  /** 已被品质五合一消耗的旧堆叠件（`<defId>|<star>` → 已消耗件数）。 */
  readonly consumed: Readonly<Record<string, number>>;
  /** 品质合成产物（逐件）。 */
  readonly products: readonly QualityProduct[];
}

const LEDGER_KEY = 'strongfruit.garageV2Ledger.v1';
const LEDGER_VERSION = 1;

/** 读偏差账本（无 / 损坏 / 形状非法 → 空账本，绝不抛）。 */
export function loadGarageV2Ledger(): GarageV2Ledger {
  try {
    const parsed = readJsonWithVersion(platform.storage.getItem(LEDGER_KEY));
    if (!parsed) return { version: LEDGER_VERSION, consumed: {}, products: [] as QualityProduct[] };
    const obj = parsed.obj as Record<string, unknown> | null;
    if (!obj || typeof obj !== 'object') return { version: LEDGER_VERSION, consumed: {}, products: [] as QualityProduct[] };
    const consumedRaw = obj['consumed'];
    const productsRaw = obj['products'];
    const consumed: Record<string, number> = {};
    if (consumedRaw && typeof consumedRaw === 'object' && !Array.isArray(consumedRaw)) {
      for (const [k, v] of Object.entries(consumedRaw as Record<string, unknown>)) {
        const n = Math.max(0, Math.floor(Number(v) || 0));
        if (n > 0) consumed[k] = n;
      }
    }
    const products: QualityProduct[] = Array.isArray(productsRaw)
      ? (productsRaw as unknown[])
          .map((p): QualityProduct | null => {
            const o = p as Record<string, unknown> | null;
            const defId = typeof o?.['defId'] === 'string' ? (o['defId'] as string) : null;
            const quality = typeof o?.['quality'] === 'string' ? (o['quality'] as QualityTier) : null;
            const seq = Math.floor(Number(o?.['seq']) || 0);
            if (!defId || quality === null || qualityRank(quality) < 0 || seq < 1) return null;
            return { defId, quality, seq };
          })
          .filter((p): p is QualityProduct => p !== null)
      : [];
    return { version: LEDGER_VERSION, consumed, products };
  } catch {
    return { version: LEDGER_VERSION, consumed: {}, products: [] as QualityProduct[] };
  }
}

/** 写偏差账本（信封版本戳；失败静默 —— 与既有存档模块同一纪律）。 */
function saveGarageV2Ledger(ledger: GarageV2Ledger): void {
  try {
    platform.storage.setItem(LEDGER_KEY, JSON.stringify(stampVersion(ledger)));
  } catch {
    // 隐私模式 / 配额失败静默（同 saveInventory 纪律）
  }
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
    const consumedHere = ledger.consumed[`${e.defId}|${e.star}`] ?? 0;
    const remaining = Math.max(0, e.count - consumedHere);
    for (let i = 1; i <= remaining; i++) {
      out.push({
        instanceId: `q1:${e.defId}:${e.star}:${i}`,
        defId: e.defId,
        name: itemDisplayName(e.defId),
        slot: e.slot,
        legacyStar: e.star,
        quality: 'white',
        // 装备保护是 stack 级（审计 §E.3）：装备引用是 (defId,star) 不是实例 ⇒
        // 该 stack 的副本可被消耗；实例是否属于「装备中的 stack」由 UI Queue 用
        // equippedStackRefs() 自行标注（本 Foundation 不在实例上存冗余字段）。
        consumable: true,
        lockedReason: null,
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
    out.push({
      instanceId: `qv2:${p.defId}:${p.quality}:${p.seq}`,
      defId: p.defId,
      name: itemDisplayName(p.defId),
      slot,
      legacyStar: null,
      quality: p.quality,
      consumable: !isMaxQuality(p.quality),
      lockedReason: isMaxQuality(p.quality) ? 'max-quality' : null,
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
  const nextConsumed: Record<string, number> = { ...ledger.consumed };
  let nextProducts = [...ledger.products];
  const consumedIds: string[] = [];

  // 主件旧档引用（装备升星判定用）
  const mainWasLegacy = main.instanceId.startsWith('q1:');
  const mainLegacyStar = main.legacyStar;

  for (const inst of all) {
    consumedIds.push(inst.instanceId);
    if (inst.instanceId.startsWith('q1:')) {
      // 旧堆叠件：账本 consumed 计数 +1（旧 key 不重写）
      const key = `${inst.defId}|${inst.legacyStar ?? 1}`;
      nextConsumed[key] = (nextConsumed[key] ?? 0) + 1;
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
  let equippedUpgraded = false;
  if (mainWasLegacy && mainLegacyStar !== null) {
    const invNow = ensureInventoryOf(input.draft);
    const key = `${main.defId}|${mainLegacyStar}`;
    const consumedTotal = nextConsumed[key] ?? 0;
    const stackNow = getCount(invNow, main.defId, mainLegacyStar);
    // 该旧档在「旧堆叠 − 账本已消耗」意义下被合空，且装备正指向该档
    const equippedRefs = equippedStackRefs(input.draft);
    const slotPrefix = main.slot === 'movement' ? 'm' : main.slot === 'gadget' ? 'g' : 'w';
    const equippedRef = `${slotPrefix}:${main.defId}:${mainLegacyStar}`;
    if (consumedTotal >= stackNow && equippedRefs.has(equippedRef)) {
      if (main.slot === 'weapon') {
        // 沿既有 equipWeapon 升星语义（审计 §D fuseStack 同款）：校验失败 ⇒ 回滚零写盘
        const nextStar = mainLegacyStar + 1;
        if (nextStar > 5) {
          return fail('equip-failed', `装备升星越界（★${nextStar} > ★5）：旧装备链路不支持，需设计决策`);
        }
        // 校验「升星后的 Build 仍是合法快照」——复用正式 validate 链（不写盘）
        const probe: BuildDraft = {
          ...input.draft,
          functionalStars: { ...(input.draft.functionalStars ?? {}), frontMass: nextStar },
        };
        const result = validateSnapshot(buildSnapshotFromDraft(probe, registry), registry);
        if (!result.valid) {
          return fail('equip-failed', `合成会留下非法装配：${result.errors.join(' / ')}`);
        }
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

  // —— 全部校验通过：一次原子保存（只写账本 key；旧 key 永不重写）——
  saveGarageV2Ledger({ version: LEDGER_VERSION, consumed: nextConsumed, products: nextProducts });

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
