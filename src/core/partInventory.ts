/**
 * Q21→Q22｜V0.4→V0.5 部件库存（Functional Part 拥有状态 + 数量 + 星级 + 合成）。
 *
 * V0.4（Q21）：owned-id 集合（string[]）——拥有/未拥有。
 * V0.5（Q22）：升级为「数量化库存」：
 *   - 每件正式 Functional 记录 { one: 1★副本数, two: 2★副本数 }（V0.5 仅 1/2 星）；
 *   - 旧 Q21 v1 存档（owned-id 数组）迁移为每个 id 的 1★=1；
 *   - 当前 Build 已装备部件迁移后仍合法（functionalSelections 仍是 defId，默认 1★）；
 *   - 战斗奖励允许重复（每场随机 1★，可累积）；
 *   - 5×1★ → 1×随机 2★ 最小合成（已装备保留 1 个 1★ 不被消耗）。
 *
 * V0.6（PRODUCT-LOOP-R2-B-FUSION-STAR）：**星级从 2 档泛化为 5 档**。
 *   - `PartStack` 增加 `three` / `four` / `five`（可选，旧档缺省 = 0）⇒ 同一个
 *     `(defId, star)` 的副本数在 ★1..★5 上**各占一档**，`starKey` 是唯一映射；
 *   - 旧存档（只有 `one`/`two`）读入后逐字节等价、零迁移成本；
 *   - `INVENTORY_MAX_STAR = 5`（数据模型上限）与 `MAX_STAR = 2`（**旧横屏融合规则**
 *     的策略上限，冻结）是两件事，见各自注释；
 *   - ⚠️ 本文件的**融合规则本身未变**：竖屏产品侧的「5 合 1」是 `product/playerGrowth.ts`
 *     的 `fuseStack`（规则不同：装备中部件允许参与 + 自动升星装备）。
 *
 * 设计约束（来自 Queue 冻结项）：
 * - 不引入实例 UID（库存只按 (defId, star) 计副本数，不记录每件实例）；
 * - 不新增 dependency；
 * - 不为了测试增加 production hook（本模块是正常 production 代码，可被测试直接 import）；
 * - 不做金币 / 碎片 / 保底 / 稀有度 / 强化按钮 / 品质 / 宝箱 / 段位 / 战令；
 * - Reward Pool / 合成产物池 = 当前正式 PART_OPTIONS（排除 EMPTY / HOLD / prototype）。
 */
import { PART_OPTIONS } from './partOptions';
import { EMPTY_SLOT } from '../lab/buildEditorModel';
import { platform } from '../platform';
import { grantBody, isBodyOwned, loadOwnedBodies, NEW_OFFICIAL_BODIES } from './bodyOwnership';
import type { BuildDraft } from '../lab/buildEditorModel';
import { readJsonWithVersion, migrateLegacy, stampVersion } from './saveVersion';

/** 新账号初始基础部件 */
export const STARTER_PARTS: readonly string[] = ['cannon', 'hammer', 'pushRod', 'spear'];

/** 当前正式 Functional 集合（PART_OPTIONS 已排除 EMPTY / HOLD / prototype） */
export const OFFICIAL_PARTS: string[] = PART_OPTIONS.filter((o) => o.v !== EMPTY_SLOT).map(
  (o) => o.v,
);

/**
 * F-CONTENT-PLAYER-MOVEMENT-PACK-R1｜正式轮组集合（默认未获得）。
 * wheelStd 恒默认拥有（不进库存，见 canEquipMovement），故库存只记录
 * small/large/heavy 三个新轮组。复用 PartInventory 计数（one=拥有数，two 恒 0），
 * 禁止另建独立 movementOwnership storage（Queue 冻结项）。
 */
export const OFFICIAL_MOVEMENTS: readonly string[] = ['smallWheel', 'largeWheel', 'heavyWheel'];

/**
 * 库存：每件正式部件按**星级**记录副本数（`(defId, star) → 副本数`）。
 *
 * PRODUCT-LOOP-R2-B-FUSION-STAR｜从「只有 `one`(★1) / `two`(★2)」扩为 **★1..★5 五档**：
 *   - `one` / `two` 仍是同一件事的前两档（★1 / ★2），读写路径与扩展前逐字节一致；
 *   - `three` / `four` / `five` **可选**：旧存档 / 旧测试字面量（只有 `one`/`two`）
 *     缺省一律读作 0 ⇒ 旧档零迁移成本、零行为变化。
 *
 * ⚠️ 为什么必须扩（不扩就是**静默腐烂**，而不是报错）：
 *    扩展前的映射是 `star >= 2 ? two : one` ⇒ **★3 与 ★2 落进同一个桶**：
 *    5×★2 合成出 ★3 会把 ★2 的计数一起抬上去，而 `getCount(inv, id, 3)` 读回来的
 *    正是 ★2 的数量 —— 玩家看到「★2 ×2、没有 ★3」，数据已经错了却没有任何一处抛错。
 *    又因为 `normalizeInventory()` 只搬运**已知字段**、其余一律丢弃 ⇒ 产品侧也**不可能**
 *    绕过本模块在同一个 storage key 里另存高星档。⇒ 高星必须在数据模型里有一等表示。
 *
 * 轮组沿用同一结构（`one` = 拥有数，其余恒 0）。
 */
export interface PartStack {
  one: number;
  two: number;
  /** ★3 副本数（旧档 / 未使用缺省 = 0） */
  three?: number;
  /** ★4 副本数（旧档 / 未使用缺省 = 0） */
  four?: number;
  /** ★5 副本数（旧档 / 未使用缺省 = 0） */
  five?: number;
}

export type PartInventory = { [defId: string]: PartStack };

/**
 * 库存数据模型能表达的**星级档数**上限 = ★5。
 *
 * ⚠️ 与下面的 `MAX_STAR` 是**两件事**，不要互换、不要合并：
 *   - `INVENTORY_MAX_STAR`（= 5）= **存储 / 读数结构**的上限（本文件的数据模型）；
 *   - `MAX_STAR`（= 2）= **旧横屏 Garage 融合规则**的策略上限（Q22 起冻结在 2★，
 *     本分支不动它的规则 / UI / 测试）。
 * 竖屏产品侧的成长星级上限 = `product/playerGrowth.ts` 的 `GROWTH_MAX_STAR`（= 本常量）。
 */
export const INVENTORY_MAX_STAR = 5;

/** 星级 → `PartStack` 字段名的**唯一映射**（★1..★5）。所有星级读写都必须经过它。 */
const STAR_KEYS = ['one', 'two', 'three', 'four', 'five'] as const;

type StarKey = (typeof STAR_KEYS)[number];

/** 星级 → 字段名；越界 / 非数一律**夹**到 `1..INVENTORY_MAX_STAR`（不抛、不返回 undefined）。 */
function starKey(star: number): StarKey {
  const s = Math.min(INVENTORY_MAX_STAR, Math.max(1, Math.floor(Number(star) || 1)));
  return STAR_KEYS[s - 1];
}

/** 读一档计数（字段缺省 / 脏数据 → 0，永不返回 NaN）。 */
function readStarBucket(e: PartStack, key: StarKey): number {
  return Math.max(0, Math.floor(Number(e[key]) || 0));
}

/** 全零的单个 stack（五档齐备；`emptyInventory` / `addPart` 共用，保证形状同源）。 */
function emptyStack(): PartStack {
  return { one: 0, two: 0, three: 0, four: 0, five: 0 };
}

const STORAGE_KEY_V1 = 'strongfruit.ownedParts.v1';
const STORAGE_KEY_V2 = 'strongfruit.ownedParts.v2';

export function isOfficialPart(id: string): boolean {
  return OFFICIAL_PARTS.includes(id);
}

/** 全零库存（仅含正式部件键 + 正式轮组键） */
function emptyInventory(): PartInventory {
  const inv: PartInventory = {};
  for (const p of OFFICIAL_PARTS) inv[p] = emptyStack();
  for (const m of OFFICIAL_MOVEMENTS) inv[m] = emptyStack();
  return inv;
}

/** 新账号默认库存：starter 各 1 个 1★ */
export function defaultInventory(): PartInventory {
  const inv = emptyInventory();
  for (const p of STARTER_PARTS) inv[p].one = 1;
  return inv;
}

/**
 * 只保留正式部件 + 正式轮组、补齐缺失键、夹紧负数（防御脏数据）。
 * PRODUCT-LOOP-R2-B｜逐档搬运 **★1..★5**：旧档只有 `one`/`two` ⇒ 后三档落 0（零迁移成本）。
 */
function normalizeInventory(data: Record<string, unknown>): PartInventory {
  const inv = emptyInventory();
  const allKeys = [...OFFICIAL_PARTS, ...OFFICIAL_MOVEMENTS];
  for (const p of allKeys) {
    const e = data[p];
    if (e && typeof e === 'object') {
      const o = e as Record<string, unknown>;
      const dst = inv[p];
      for (const k of STAR_KEYS) dst[k] = Math.max(0, Math.floor(Number(o[k]) || 0));
    }
  }
  return inv;
}

/** 读 v2 库存（含 v1→v2 迁移）；无存档 / 解析失败 / 非对象 → null */
export function loadInventoryRaw(): PartInventory | null {
  try {
    const raw2 = platform.storage.getItem(STORAGE_KEY_V2);
    if (raw2) {
      const parsed = readJsonWithVersion(raw2);
      if (!parsed) return null; // v2 存在但损坏：仅该 key 失效，其它 key 不受影响
      const migrated = migrateLegacy('inventory', parsed.obj, parsed.version);
      if (!migrated || typeof migrated !== 'object' || Array.isArray(migrated)) return null;
      return normalizeInventory(migrated as Record<string, unknown>);
    }
    // 迁移：旧 v1 owned-id 数组 → 每个 id 的 1★ = 1（统一迁移入口处理数组→映射）
    const raw1 = platform.storage.getItem(STORAGE_KEY_V1);
    if (raw1) {
      const arr = JSON.parse(raw1);
      if (Array.isArray(arr)) {
        const migrated = migrateLegacy('inventory', arr, 0);
        const inv = normalizeInventory(migrated as Record<string, unknown>);
        saveInventory(inv);
        return inv;
      }
    }
  } catch {
    return null;
  }
  return null;
}

/** 写入库存（附带 saveVersion 信封；隐私模式 / 配额失败静默忽略） */
export function saveInventory(inv: PartInventory): void {
  try {
    platform.storage.setItem(STORAGE_KEY_V2, JSON.stringify(stampVersion(inv)));
  } catch {
    // 写入失败静默忽略
  }
}

/** 当前库存（无存档时回退到默认 starter 副本，不落盘） */
export function getInventory(): PartInventory {
  return loadInventoryRaw() ?? defaultInventory();
}

/**
 * 取某部件某星级的副本数。
 *
 * PRODUCT-LOOP-R2-B｜星级泛化：★1..★5 **各占一档**（经 `starKey` 的**唯一映射**）。
 * ⚠️ 扩展前 `star >= 2` 恒读 `two`（★3 会读成 ★2）；现在每档独立。
 *    `star` 越界 / 非数被**夹**到 1..`INVENTORY_MAX_STAR` ⇒ `star ∈ {1,2}` 的读数
 *    与扩展前**逐字节一致**（横屏调用点零影响）。
 */
export function getCount(inv: PartInventory, defId: string, star: number): number {
  const e = inv[defId];
  if (!e) return 0;
  return readStarBucket(e, starKey(star));
}

/** 永久入库：增加副本（非正式部件/轮组忽略） */
export function addPart(inv: PartInventory, defId: string, star: number, n = 1): void {
  if (!isOfficialPart(defId) && !OFFICIAL_MOVEMENTS.includes(defId)) return;
  if (!inv[defId]) inv[defId] = emptyStack();
  const key = starKey(star);
  inv[defId][key] = readStarBucket(inv[defId], key) + n;
}

/** 从库存消耗副本（不校验；调用方先确保充足） */
export function consume(inv: PartInventory, defId: string, star: number, n: number): void {
  const e = inv[defId];
  if (!e) return;
  const key = starKey(star);
  e[key] = Math.max(0, readStarBucket(e, key) - n);
}

/** 某部件某星级是否已拥有（EMPTY_SLOT 视为永远可装备） */
export function isOwned(defId: string, star = 1): boolean {
  if (defId === EMPTY_SLOT) return true;
  return getCount(getInventory(), defId, star) > 0;
}

/** Garage 装备守卫：空槽恒可装备；其余必须已拥有对应星级 */
export function canEquipPart(defId: string, star = 1): boolean {
  return defId === EMPTY_SLOT || isOwned(defId, star);
}

/**
 * F-CONTENT-PLAYER-MOVEMENT-PACK-R1｜轮组装备守卫。
 * - wheelStd 恒默认拥有（零回归，旧档/对手池兼容）；
 * - small/large/heavy 需库存 one≥1（debug「全部件×1」授予，复用 PartInventory，
 *   禁止独立 movementOwnership storage）。
 */
export function canEquipMovement(defId: string): boolean {
  if (defId === 'wheelStd') return true;
  if (!OFFICIAL_MOVEMENTS.includes(defId)) return false;
  return getCount(getInventory(), defId, 1) > 0;
}

/** F-CONTENT-PLAYER-MOVEMENT-PACK-R1：一次性解锁全部新轮组（debug「全部件×1」）。幂等。 */
export function grantAllNewMovements(inv?: PartInventory): number {
  const store = inv ?? getInventory();
  let added = 0;
  for (const m of OFFICIAL_MOVEMENTS) {
    if (getCount(store, m, 1) < 1) {
      addPart(store, m, 1, 1);
      added += 1;
    }
  }
  saveInventory(store);
  return added;
}

/** 当前 Build 已装备的正式 defId 集合（用于合成「已装备保留」规则） */
export function equippedDefIds(build: BuildDraft | null): string[] {
  const ids = new Set<string>();
  const sel = build?.functionalSelections;
  if (sel) {
    for (const v of Object.values(sel)) {
      if (v && v !== EMPTY_SLOT && isOfficialPart(v)) ids.add(v);
    }
  }
  return [...ids];
}

/**
 * 种子库存：starter 必含（各 1★）+ 当前 Build 已装备的正式部件（兼容旧存档迁移，至少 1★）。
 * 返回稳定库存对象，不影响 localStorage。
 */
export function seedInventoryFromStarterAndBuild(build: BuildDraft | null): PartInventory {
  const inv = defaultInventory();
  for (const defId of equippedDefIds(build)) {
    if (inv[defId]) inv[defId].one = Math.max(inv[defId].one, 1);
  }
  return inv;
}

/**
 * 是否含任意拥有副本（用于「存档是否已初始化」判据）。
 *
 * ⚠️ 必须**同时**扫 `OFFICIAL_PARTS` 与 `OFFICIAL_MOVEMENTS`。
 *    只扫功能件（旧写法）会导致：一个「功能件全为 0、但拥有轮组」的存档被判为
 *    「未初始化」⇒ `ensureInventory` 走种子分支并**落盘覆写**，把玩家的轮组静默清空
 *    （实测可复现：`smallWheel.one` 授予后经一次 `ensureInventory` 归零）。
 *    `normalizeInventory`（:141）与 `emptyInventory`（:123）本就把两类键
 *    视为同一个库存的两半，这里的判据必须与之对齐。
 */
function hasAnyOwned(inv: PartInventory): boolean {
  const anyOwned = (p: string): boolean => inv[p].one > 0 || inv[p].two > 0;
  return OFFICIAL_PARTS.some(anyOwned) || OFFICIAL_MOVEMENTS.some(anyOwned);
}

/**
 * 确保库存已初始化：有存档 → 直接返回；无存档 → 种子（starter + 当前 Build 装备）并落盘。
 * 调用方传入当前玩家 Build 以支持首次迁移。
 */
export function ensureInventory(build: BuildDraft | null): PartInventory {
  const saved = loadInventoryRaw();
  if (saved && hasAnyOwned(saved)) return saved;
  const seeded = seedInventoryFromStarterAndBuild(build);
  saveInventory(seeded);
  return seeded;
}

/**
 * F-CONTENT-REWARD-ACQUISITION-R1｜奖励候选类型。
 * functional = 既有战斗/辅助部件；movement = 3 新轮组；body = 4 新车身。
 */
export type RewardKind = 'functional' | 'movement' | 'body';

/** 战斗奖励产出（typed：functional/movement/body；star 恒 1★，body 无星级概念为占位） */
export interface RewardOutcome {
  kind: RewardKind;
  defId: string;
  /** V0.5：奖励永远是 1★（可重复获得） */
  star: 1;
}

/**
 * 纯计算：从正式 PART_OPTIONS 随机挑 1 个部件作为 1★ 奖励（可重复，不限是否已拥有）。
 * rng 可注入以便测试确定性；默认 Math.random。
 * F-CONTENT-REWARD-ACQUISITION-R1：返回 kind='functional'（与 typed 池同构；既有语义不变）。
 */
export function computeReward(rng: () => number = Math.random): RewardOutcome {
  const idx = Math.min(OFFICIAL_PARTS.length - 1, Math.floor(rng() * OFFICIAL_PARTS.length));
  return { kind: 'functional', defId: OFFICIAL_PARTS[idx], star: 1 };
}

/**
 * F-CONTENT-REWARD-ACQUISITION-R1｜typed 奖励候选池（平铺选择语义，无权重/无保底/无新随机源）：
 * - functional：OFFICIAL_PARTS 恒在池（重复获得正常累计，既有行为不变）；
 * - movement：OFFICIAL_MOVEMENTS 恒在池（每场 x1，复用 PartInventory one 计数）；
 * - body：NEW_OFFICIAL_BODIES 中「尚未拥有」者——获得后经 grantBody 解锁即移出，
 *   四个车身全部拥有后自动从池移除（已拥有车身不再作为空奖励出现）；
 * - 过滤后为空（防御分支：实际恒非空）→ 安全 fallback 纯 functional，不报错、不发空奖励。
 */
export function buildRewardCandidates(): Array<{ kind: RewardKind; defId: string }> {
  const cands: Array<{ kind: RewardKind; defId: string }> = [];
  for (const p of OFFICIAL_PARTS) cands.push({ kind: 'functional', defId: p });
  for (const m of OFFICIAL_MOVEMENTS) cands.push({ kind: 'movement', defId: m });
  const owned = new Set(loadOwnedBodies());
  for (const b of NEW_OFFICIAL_BODIES) {
    if (!owned.has(b)) cands.push({ kind: 'body', defId: b });
  }
  if (cands.length === 0) {
    for (const p of OFFICIAL_PARTS) cands.push({ kind: 'functional', defId: p });
  }
  return cands;
}

/**
 * F-CONTENT-REWARD-ACQUISITION-R1｜typed 奖励选择：与 computeReward 同构的平铺随机
 * （沿用候选池平铺语义，不新建未经验证的复杂权重系统）。rng 可注入以便测试确定性。
 * 纯选择不修改库存/拥有状态——由调用方（BattleRewardSettler.settle）按 kind 入账。
 */
export function computeTypedReward(rng: () => number = Math.random): RewardOutcome {
  const pool = buildRewardCandidates();
  const idx = Math.min(pool.length - 1, Math.floor(rng() * pool.length));
  const pick = pool[idx];
  return { kind: pick.kind, defId: pick.defId, star: 1 };
}

/** 结算结果（供 Result 卡展示：functional/movement 显示当前拥有 ×N；body 显示「已解锁」） */
export interface SettleResult {
  kind: RewardKind;
  defId: string;
  star: number;
  /** functional/movement：入账后库存数；body：1（拥有即解锁，无数量概念） */
  countAfter: number;
}

/**
 * 每场 Battle 的奖励结算器（运行时单例）。
 * 以 result 引用为幂等键：同一场 Battle 只结算一次（Result 轮询不会重复发奖）。
 * 结算时自动把 1★ 奖励部件写入库存（进入 Result 即已入库，无领取按钮）。
 */
export class BattleRewardSettler {
  private settledRef: unknown = null;
  private last: SettleResult | null = null;

  /** 结算当前 Battle；同场重复调用返回已缓存结果（不发重复奖励） */
  settle(resultRef: unknown, rng: () => number = Math.random): SettleResult | null {
    if (this.settledRef === resultRef) return this.last; // 同场已结算
    this.settledRef = resultRef;
    const r = computeTypedReward(rng);
    // F-CONTENT-REWARD-ACQUISITION-R1：按类型入账——
    // body → bodyOwnership 解锁（拥有即解锁，无数量概念；已拥有车身因候选池移除不会再被选中）；
    // movement/functional → PartInventory 1★ x1（重复获得正常累计，行为不变）。
    let countAfter = 0;
    if (r.kind === 'body') {
      grantBody(r.defId);
      countAfter = isBodyOwned(r.defId) ? 1 : 0;
    } else {
      const inv = getInventory();
      addPart(inv, r.defId, r.star, 1);
      saveInventory(inv);
      countAfter = getCount(inv, r.defId, r.star);
    }
    const res: SettleResult = {
      kind: r.kind,
      defId: r.defId,
      star: r.star,
      countAfter,
    };
    this.last = res;
    return res;
  }

  /** 开始新一场 Battle 前重置幂等键 */
  reset(): void {
    this.settledRef = null;
    this.last = null;
  }
}

/**
 * F-GARAGE-INVENTORY-FUSION-P0｜**旧横屏 Garage 融合规则**的星级上限（冻结 = 2★）。
 *
 * ⚠️ 这**不是**库存数据模型的星级上限 —— 那是 `INVENTORY_MAX_STAR = 5`（本文件上方）。
 *    两者刻意分开、**不要合并**：
 *      - **数据模型**（★1..★5 五档 + `starKey` 映射）在 PRODUCT-LOOP-R2-B 被泛化；
 *      - 但本文件下面这条**横屏融合规则**（`fuseSameStar` / `fuseCategoryMaterials`）与
 *        `canvasPlayerUIHost` 的星级 chip 行，自 Q22 起被钉在 2★：本分支**不改它的
 *        规则 / UI / 测试**（`garageFusionUX_R2` 与 `garageFusionStarSelectionR3`
 *        都把 `MAX_STAR === 2` 当域不变量断言）。
 *    竖屏产品侧的星级上限见 `product/playerGrowth.ts` 的 `GROWTH_MAX_STAR`（= 5）。
 */
export const MAX_STAR = 2;

/** 可合成类别：正式 Functional + 正式 Movement；Body 不参与合成（§2/§4）。 */
export function isFusable(defId: string): boolean {
  return isOfficialPart(defId) || OFFICIAL_MOVEMENTS.includes(defId);
}

/** 当前 Build 已装备的 (defId, star) 槽位（Functional + Movement；wheelStd 不计库存，跳过）。 */
export function equippedSlots(build: BuildDraft | null): Array<{ defId: string; star: number }> {
  const out: Array<{ defId: string; star: number }> = [];
  if (!build) return out;
  const sel = build.functionalSelections;
  if (sel) {
    for (const [hp, v] of Object.entries(sel)) {
      if (v && v !== EMPTY_SLOT && (isOfficialPart(v) || OFFICIAL_MOVEMENTS.includes(v))) {
        out.push({ defId: v, star: build.functionalStars?.[hp] ?? 1 });
      }
    }
  }
  for (const w of [build.rearWheelDefId, build.frontWheelDefId]) {
    if (w && w !== EMPTY_SLOT && w !== 'wheelStd' && OFFICIAL_MOVEMENTS.includes(w)) {
      out.push({ defId: w, star: 1 });
    }
  }
  return out;
}

/** 某 (defId, star) 在当前 Build 中的已装备数量（融合保护口径）。 */
export function equippedCount(defId: string, star: number, build: BuildDraft | null): number {
  let n = 0;
  for (const s of equippedSlots(build)) if (s.defId === defId && s.star === star) n++;
  return n;
}

/** 合成结果 */
export interface FuseResult {
  ok: true;
  /** 产物 defId（= 输入 defId，同 defId 下一星级） */
  product: string;
  /** 产物星级 = star + 1 */
  star: number;
  inventory: PartInventory;
}

/**
 * F-GARAGE-FUSION-UX-R2｜LEGACY（仅供旧存档兼容测试与直接调用；正式玩家合成已改走
 * fuseCategoryMaterials 的分类混合随机规则）。行为保留不变：
 * 5 个「同 defId、同星级」的未装备副本 → 1 个相同 defId 的下一星级部件。
 * - Body 不可合成（isFusable 排除）；star >= MAX_STAR（满星）不可合成；
 * - 已装备副本必须保护：available = owned(star) - equipped(star)，available < 5 不可合成（返回 null）；
 * - 不允许跨 defId / 跨分类 / 降星 / 负库存；
 * - 原子：消耗 5×star、产出 1×(star+1)、一次 saveInventory；
 * - 不修改装备中的 Build、不覆盖已有高星、不引入第二套库存/星级系统。
 * 调用前建议用 canFuse 预检以驱动 UI 禁用态。
 */
export function fuseSameStar(
  inv: PartInventory,
  defId: string,
  star: number,
  build: BuildDraft | null,
): FuseResult | null {
  if (!isFusable(defId)) return null;
  if (star < 1 || star >= MAX_STAR) return null;
  const owned = getCount(inv, defId, star);
  const eq = equippedCount(defId, star, build);
  const available = owned - eq;
  if (available < 5) return null;
  consume(inv, defId, star, 5);
  addPart(inv, defId, star + 1, 1);
  saveInventory(inv);
  return { ok: true, product: defId, star: star + 1, inventory: inv };
}

/** UI 预检：是否能对 (defId, star) 发起合成（用于按钮 disabled / 「还差 N 个」）。 */
export function canFuse(
  inv: PartInventory,
  defId: string,
  star: number,
  build: BuildDraft | null,
): { ok: boolean; available: number; need: number; maxStar: boolean } {
  if (!isFusable(defId)) return { ok: false, available: 0, need: 5, maxStar: false };
  if (star >= MAX_STAR) return { ok: false, available: getCount(inv, defId, star), need: 5, maxStar: true };
  const owned = getCount(inv, defId, star);
  const eq = equippedCount(defId, star, build);
  const available = owned - eq;
  return { ok: available >= 5, available, need: 5, maxStar: false };
}

// ============================================================================
// F-GARAGE-FUSION-UX-R2｜正式合成规则（恢复项目原设计：同分类混合材料随机合成）
// ----------------------------------------------------------------------------
// 规则（替代上述 fuseSameStar 的「同 defId」实现作为正式玩家入口）：
// - 5 个「同分类、同星级、未装备」的部件 → 随机获得 1 个「同分类」下一星级部件；
// - 战斗部件只能与战斗部件合成；移动部件只能与移动部件合成；Body 不参与合成；
// - 材料允许不同 defId 混合（同分类内）；已装备副本不可作为材料；
// - 不允许跨分类 / 跨星级；MAX_STAR 后不可作为产出升级；
// - 产出只来自对应正式 Registry（OFFICIAL_PARTS / OFFICIAL_MOVEMENTS），
//   天然排除 EMPTY / prototype / hold / 测试 defId；
// - 随机可注入（rng 参数，测试传固定值）；合成原子：全部校验通过后一次 saveInventory，
//   失败不消耗任何材料。
// ============================================================================

/** 合成分类（战斗 = OFFICIAL_PARTS；移动 = OFFICIAL_MOVEMENTS；Body 返回 null 不参与） */
export type FusionCategory = 'combat' | 'movement';

/** 某 defId 的合成分类（Body / 非官方 → null） */
export function fusionCategoryOf(defId: string): FusionCategory | null {
  if (isOfficialPart(defId)) return 'combat';
  if (OFFICIAL_MOVEMENTS.includes(defId)) return 'movement';
  return null;
}

/** 分类中文标签（UI「随机获得战斗2★」/「随机获得移动2★」用） */
export function fusionCategoryLabel(cat: FusionCategory): string {
  return cat === 'combat' ? '战斗' : '移动';
}

/** 分类产出/材料候选池（正式 Registry；恒定、确定顺序） */
export function fusionCategoryPartIds(cat: FusionCategory): readonly string[] {
  return cat === 'combat' ? OFFICIAL_PARTS : OFFICIAL_MOVEMENTS;
}

/** 可作材料的 defId（未装备、指定星级、数量 > 0；按 defId 字典序稳定）。 */
export function fusionEligibleDefIds(
  inv: PartInventory,
  cat: FusionCategory,
  build: BuildDraft | null,
  star = 1,
): string[] {
  const out: string[] = [];
  for (const defId of fusionCategoryPartIds(cat)) {
    const avail = getCount(inv, defId, star) - equippedCount(defId, star, build);
    if (avail > 0) out.push(defId);
  }
  return out;
}

/** 分类总可用材料数（可合成判定/「可合成 1 次 / 还差 N 件」文案用） */
export function fusionCategoryAvailable(
  inv: PartInventory,
  cat: FusionCategory,
  build: BuildDraft | null,
  star = 1,
): number {
  let total = 0;
  for (const defId of fusionEligibleDefIds(inv, cat, build, star)) {
    total += getCount(inv, defId, star) - equippedCount(defId, star, build);
  }
  return total;
}

/** 合成预检（UI 状态文案用） */
export function canFuseCategory(
  inv: PartInventory,
  cat: FusionCategory,
  build: BuildDraft | null,
  star = 1,
): { ok: boolean; available: number; need: number } {
  const available = fusionCategoryAvailable(inv, cat, build, star);
  return { ok: available >= 5, available, need: 5 };
}

/**
 * 自动放入选择（确定性、可复现）：
 * 优先级 1. 未装备（候选池已排除装备）→ 2. 当前星级 → 3. 可用副本数多的 defId
 * → 4. defId 稳定字典序。返回恰好 count 个（不足则返回全部可用数）。
 */
export function autoPickFusionMaterials(
  inv: PartInventory,
  cat: FusionCategory,
  build: BuildDraft | null,
  star = 1,
  count = 5,
): string[] {
  const per: Array<{ defId: string; avail: number }> = [];
  for (const defId of fusionEligibleDefIds(inv, cat, build, star)) {
    const avail = getCount(inv, defId, star) - equippedCount(defId, star, build);
    if (avail > 0) per.push({ defId, avail });
  }
  // 数量多优先；同数量按 defId 字典序（稳定）
  per.sort((a, b) => (b.avail - a.avail) || (a.defId < b.defId ? -1 : a.defId > b.defId ? 1 : 0));
  const out: string[] = [];
  for (const p of per) {
    const take = Math.min(p.avail, count - out.length);
    for (let i = 0; i < take; i++) out.push(p.defId);
    if (out.length >= count) break;
  }
  return out;
}

/** 分类合成结果 */
export interface CategoryFuseOutcome {
  ok: true;
  /** 产出 defId（分类 Registry 内随机） */
  product: string;
  /** 产出星级 = star + 1 */
  star: number;
  inventory: PartInventory;
}

/**
 * F-GARAGE-FUSION-UX-R2｜正式分类合成（原子）：
 * - materials：恰好 5 个同分类 defId（允许重复 defId，但每 defId 用量 ≤ 其可用数）；
 * - 全部校验通过才变更：按 materials 逐 defId 消耗 1 份 → 随机产出 1 件 star+1 → 一次 saveInventory；
 * - 任一校验失败（数量≠5 / 跨分类 / 满星 / 材料不可用 / 装备保护）→ null 且零变更；
 * - rng 可注入（默认 Math.random）；产出池 = 该分类正式 Registry（恒非空、确定顺序）。
 */
export function fuseCategoryMaterials(
  inv: PartInventory,
  materials: readonly string[],
  cat: FusionCategory,
  build: BuildDraft | null,
  star = 1,
  rng: () => number = Math.random,
): CategoryFuseOutcome | null {
  if (star < 1 || star >= MAX_STAR) return null;
  if (!materials || materials.length !== 5) return null;
  const need: Record<string, number> = {};
  for (const defId of materials) {
    if (fusionCategoryOf(defId) !== cat) return null; // 跨分类拒绝
    need[defId] = (need[defId] ?? 0) + 1;
  }
  for (const defId of Object.keys(need)) {
    const avail = getCount(inv, defId, star) - equippedCount(defId, star, build);
    if (avail < need[defId]) return null; // 已装备保护 / 数量不足
  }
  const pool = fusionCategoryPartIds(cat);
  const idx = Math.min(pool.length - 1, Math.max(0, Math.floor(rng() * pool.length)));
  const product = pool[idx];
  for (const defId of Object.keys(need)) consume(inv, defId, star, need[defId]);
  addPart(inv, product, star + 1, 1);
  saveInventory(inv); // 原子：成功才持久化一次
  return { ok: true, product, star: star + 1, inventory: inv };
}
