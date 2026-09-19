/**
 * PRODUCT-LOOP-R2-A-REWARD-STACK-INVENTORY｜永久成长的**产品侧模型**（纯逻辑 + 唯一成长写入口）。
 *
 * 本模块回答 R2「永久成长」的四个问题，全部只在这里回答一次：
 *   ① 「一件部件现在有几件、到第几星」→ `CountedStack` / `growthStack()`；
 *   ② 「再拿一件会变成几 / 离满 stack 还差多少」→ `stackProgress()`（`4 → 5` / `5/5`）；
 *   ③ 「新账号的成长起点是什么」→ `FRESH_STACK_SEED` + `applyFreshSeed()`（Queue 必改 3）；
 *   ④ 「老存档怎么在不丢数据的前提下进入成长模型」→ `repairEquippedStack()`（Queue 必改 2）。
 *
 * ── 为什么这一层存在（而不是直接改 `core/partInventory.ts`）────────────────────
 * 实测结论：**库存的数据模型已经是 stack 模型**。`PartInventory` 的形状是
 *   `{ [defId]: { one: number; two: number } }`
 * 即 `(partId, star) → 副本数`（`star 1 = one`，`star ≥ 2 = two`），`addPart` 也已经是
 * 「同一个 `(defId, star)` 累加到同一个计数」⇒ Queue 必改 1 要求的
 * `partId + star + count` 与「同一 stack 归并、不生成 5 张一样的卡」**在数据层已经成立**。
 *
 * 因此本 Queue **不动 `src/core/**`**（全链冻结项），把 R2-A 真正缺的两件事补在**产品侧**：
 *   - **新账号的成长起点**（core 的 `defaultInventory()` 是给旧横屏游戏用的 starter 各 1，
 *     不能为了竖屏产品的 onboarding 去改它 —— 那会让旧游戏也变成「炮 ×4」）；
 *   - **Equipped 一定指向一个有效 stack**（core 的 `ensureInventory()` 只在「整份库存不可用」
 *     时才种子化；如果存档里**有**库存、但恰好缺了当前装备那件，装备就会指到一个
 *     计数为 0 的 stack。Queue 验收 8 要的正是这一条的兜底）。
 *
 * ── 与核心存档的边界（写进代码，避免以后被误用）─────────────────────────────
 *   - **只增不减**：本模块的每个写操作都只可能让某个 `(defId, star)` 的计数**变大**，
 *     绝不删除、绝不归零、绝不覆盖其它条目（Queue 必改 2「不得清空玩家当前 Profile」）；
 *   - **不新建存档 key**：全部读写仍走 core 的 `strongfruit.ownedParts.v2`（`saveInventory`）
 *     ⇒ 旧横屏游戏与竖屏产品**共用同一份库存**，本模块不会制造第二套库存；
 *   - **不引入新 dependency、不新增数值系统**：`FUSE_STACK = 5` 是**读数阈值**
 *     （与 core 合成规则的 `need = 5` 同值），本 Queue **不做合成动作**（Queue 明令）；
 *   - **不做金币 / 品质 / 随机 / 升星效果 / 碎片 / 保底**（Queue 禁止清单）。
 *
 * ⚠️ 本模块**不是 UI**：不碰 DOM、不碰 `location`。持久化只经 core 的
 *    `loadInventoryRaw()` / `saveInventory()`（因此也不直接出现 `platform.storage`，
 *    与 `tests/productLoopRunReward.test.ts` 的 `PR-20` 守卫口径一致）。
 */
import { loadPlayerBuild } from '../core/buildPersistence';
import {
  addPart,
  defaultInventory,
  getCount,
  loadInventoryRaw,
  saveInventory,
  type PartInventory,
} from '../core/partInventory';
import { EMPTY_SLOT, type BuildDraft } from '../lab/buildEditorModel';
import { isWeaponDefId, playerInventory, WEAPON_SLOT } from './playerLoadout';

/**
 * 本版成长只使用 **★1**。
 *
 * Queue 必改 4 的每张奖励卡都标 `★1`，且「不做升星效果」⇒ R2-A 的成长维度只有数量。
 * 保留 `star` 这个**参数**（而不是写死）是因为库存本来就是按 `(defId, star)` 计数的，
 * 把星写进签名才能让「Equipped 指向同一 `partId + star`」这条要求可被表达与断言。
 */
export const GROWTH_STAR = 1;

/**
 * 满 stack 阈值 = **5**。
 *
 * 取值来源 = core 既有合成规则的消耗量（`partInventory.ts` 的 `need: 5`），
 * 不是本 Queue 新造的数字。R2-A **只显示** `5/5`（Queue：「达到5件时可以只显示 `5/5`；
 * 合成动作属 Queue B」）—— 本模块没有任何 fuse / 消耗 / 升级调用。
 *
 * ⚠️ 「这是 core 的真值」不是靠注释保证的：`tests/playerGrowthR2A.test.ts` 用
 *    `playerLoadout.stackThreshold()`（它直接读 core 的 `canFuse().need`）与本常量做
 *    **相等断言** ⇒ core 若改消耗量，这里立刻红灯，不会静默漂移。
 */
export const FUSE_STACK = 5;

/** 一个成长 stack 的读数（`partId + star + count` 三元组，Queue 必改 1 的最小结构）。 */
export interface CountedStack {
  readonly partId: string;
  readonly star: number;
  readonly count: number;
}

/** 「再拿一件」的数量预览（`4 → 5`）与 stack 进度（`4/5`、满则 `5/5`）。 */
export interface StackProgress {
  readonly countBefore: number;
  readonly countAfter: number;
  readonly threshold: number;
  /** 领取后会达到 / 超过阈值（Queue：玩家能体验第一次合成）。 */
  readonly reachesThreshold: boolean;
  /** 已经满 stack（Garage 只显示 `5/5` 的那种状态）。 */
  readonly full: boolean;
  /** `'4 → 5'`（数量预览）。 */
  readonly previewText: string;
  /** `'4/5'`；满 stack 时是 `'5/5'`（Queue 要求的写法）。 */
  readonly stackText: string;
}

/**
 * 数量预览 + stack 进度（纯函数，负数/非数按 0 处理）。
 *
 * ⚠️ `stackText` 在**满**的时候刻意收敛成 `5/5` 而不是 `6/5`：
 *    Queue 说「达到5件时可以只显示 `5/5`」，因此计数超过阈值时显示的是阈值本身。
 */
export function stackProgress(countBefore: number, threshold: number = FUSE_STACK): StackProgress {
  const before = Math.max(0, Math.floor(Number.isFinite(countBefore) ? countBefore : 0));
  const limit = Math.max(1, Math.floor(Number.isFinite(threshold) ? threshold : FUSE_STACK));
  const after = before + 1;
  const full = before >= limit;
  return {
    countBefore: before,
    countAfter: after,
    threshold: limit,
    reachesThreshold: after >= limit,
    full,
    previewText: `${before} → ${after}`,
    stackText: full ? `${limit}/${limit}` : `${before}/${limit}`,
  };
}

/** 库存里某 `(defId, star)` 的 stack 读数（未知部件 → count 0，不编造）。 */
export function growthStack(inv: PartInventory, partId: string, star: number = GROWTH_STAR): CountedStack {
  return { partId, star, count: getCount(inv, partId, star) };
}

/**
 * 新账号（fresh profile）的**成长种子**（Queue 必改 3）。
 *
 * 逐条对应 Queue 的原文：
 *   - 默认 equipped = `cannon ★1`（这已由 `defaultPlayerDraft()` 的 `frontMass='cannon'` 满足，
 *     本模块不需要也不应该再写一次装备）；
 *   - 库存 `cannon ★1 ×4` ⇒ 表里的 `cannon/1/4`；
 *   - 「当前产品主循环需要的最少其它 Weapon」= 3选1 的另外两个候选 `spear` / `hammer` 各 ×1
 *     （它们是候选池成员，玩家选了要有 stack 可加；`hammer` 同时是默认车 `top` 槽的在装件）。
 *
 * ⚠️ 种子**不是**替换整份库存，而是**在 core starter 基础上抬高指定 stack**（见 `applyFreshSeed`）：
 *    `defaultInventory()` 里的 `pushRod`（辅助）等条目必须原样保留 ——
 *    库存 key `strongfruit.ownedParts.v2` 是**旧横屏游戏与竖屏产品共用**的，
 *    若种子把它覆盖掉，旧游戏里玩家的推杆会凭空消失。
 */
export const FRESH_STACK_SEED: readonly CountedStack[] = [
  { partId: 'cannon', star: GROWTH_STAR, count: 4 },
  { partId: 'spear', star: GROWTH_STAR, count: 1 },
  { partId: 'hammer', star: GROWTH_STAR, count: 1 },
];

/**
 * 把种子**抬高**进一份库存（只 `max`，绝不降低、绝不新建 key 之外的条目）。
 *
 * 返回是否真的改动了任何条目（调用方据此决定要不要落盘 —— 幂等，第二次挂载是空操作）。
 */
export function applyFreshSeed(
  inv: PartInventory,
  seed: readonly CountedStack[] = FRESH_STACK_SEED,
): boolean {
  let changed = false;
  for (const s of seed) {
    if (!isWeaponDefId(s.partId)) continue; // 只给正式 Weapon 发种子（不猜、不越界）
    const want = Math.max(0, Math.floor(s.count));
    const have = getCount(inv, s.partId, s.star);
    if (want > have) {
      addPart(inv, s.partId, s.star, want - have);
      changed = true;
    }
  }
  return changed;
}

/**
 * 当前装备在主武器槽上的 `(partId, star)` —— 即「Equipped 指向的那个 stack」。
 *
 * `star` 取自 `BuildDraft.functionalStars`（缺省 = ★1），与库存 `getCount` 同一口径；
 * 槽位为空 / 不是正式武器 → `null`（没有 stack 需要保证）。
 */
export function equippedStackKey(
  draft: BuildDraft,
): { readonly partId: string; readonly star: number } | null {
  const partId = draft.functionalSelections[WEAPON_SLOT];
  if (!partId || partId === EMPTY_SLOT) return null;
  if (!isWeaponDefId(partId)) return null;
  const starRaw = draft.functionalStars?.[WEAPON_SLOT];
  const star = typeof starRaw === 'number' && starRaw >= 2 ? starRaw : GROWTH_STAR;
  return { partId, star };
}

/**
 * Queue 必改 2 / 验收 8｜**保证 Equipped 指向一个有效库存实例**。
 *
 * 这是 R2-A 相对 core `ensureInventory()` 的**唯一真实缺口**：
 *   `ensureInventory()` 的判据是「整份库存是否可用」（`hasAnyOwned`）。只要存档里
 *   **有任何一件**部件，它就原样返回；于是「存档有库存、但缺当前装备那件」这个形态
 *   （旧版 owned-id 数组存档 / 手工改过的档 / 跨版本残留）会让首页显示一件
 *   库存里查无此件的武器 —— 装备指向一个 count = 0 的 stack。
 *
 * 处置（**只增不减**）：该 stack 计数为 0 ⇒ 补 1 件；已有 ⇒ 一个字节都不动。
 * 返回被修复的部件 id（`null` = 无需修复）。
 */
export function repairEquippedStack(inv: PartInventory, draft: BuildDraft): string | null {
  const key = equippedStackKey(draft);
  if (!key) return null;
  if (getCount(inv, key.partId, key.star) > 0) return null;
  addPart(inv, key.partId, key.star, 1);
  return key.partId;
}

/** 本次挂载的成长会话读数（供探针 / 测试观察「这一趟到底改了什么」）。 */
export interface GrowthSession {
  readonly inv: PartInventory;
  /** 本次挂载是否应用了新账号种子（仅 fresh profile 会为 true）。 */
  readonly seeded: boolean;
  /** 本次挂载为「Equipped 指向有效 stack」补了几件（`null` = 没动）。 */
  readonly repairedEquipped: string | null;
  /** 读的时候是不是一个全新账号（此刻磁盘上既没有 Build 也没有库存）。 */
  readonly freshProfile: boolean;
}

/**
 * 产品侧成长档案的**唯一入口**：判 fresh → 取库存 → （仅 fresh）抬高种子 → 修复 Equipped stack → 必要才落盘。
 *
 * ⚠️ **签名只有 `draft`**（不再收一份现成的 `inv`）—— 这是刻意的，不是简化：
 *    两件事有**严格先后**，而调用方很容易写反：
 *      ① `isFreshProfile()` 读的是磁盘（「既没有 Build 也没有库存记录」）；
 *      ② `playerInventory()` → core `ensureInventory()`，**首次调用就会把 starter 库存落盘**。
 *    若调用方先 `playerInventory()` 再把结果传进来，① 就永远为 false ⇒ 种子**静默失效**，
 *    而且现象是「新账号是 ×1 不是 ×4」——恰好与「一切正常」长得一样，极难发现。
 *    把顺序收进本函数内部 ⇒ 「先取库存再判 fresh」在结构上不可能发生。
 *
 * 调用顺序（本函数内部）：
 *   ① **先**判 fresh —— 这正是「新账号」的定义，且天然一次性
 *      （第一次挂载会落盘库存，之后同一条判据恒为 false）；
 *   ② 库存本体仍由 core 的 `ensureInventory()` 产出（`playerInventory()` 走它），
 *      本模块**不另建第二套库存**；只在它之上抬高 fresh 种子、修复 Equipped stack；
 *   ③ 只有真的改动了才落盘（幂等 ⇒ 重复挂载无副作用、不产生无谓写入）。
 *
 * ⚠️ 已有存档的玩家（旧 Profile）**不会**被抬到 `cannon ×4` —— 种子只发给新账号。
 *    他们唯一可能的改动是「Equipped stack 缺件」被补 1（且只在真的缺件时）。
 */
export function openGrowthSession(draft: BuildDraft): GrowthSession {
  const freshProfile = isFreshProfile();
  const inv = playerInventory(draft);
  let changed = false;
  let seeded = false;

  if (freshProfile) {
    seeded = applyFreshSeed(inv);
    changed = changed || seeded;
  }
  const repairedEquipped = repairEquippedStack(inv, draft);
  changed = changed || repairedEquipped !== null;

  if (changed) saveInventory(inv);
  return { inv, seeded, repairedEquipped, freshProfile };
}

/**
 * 把库存里的 stack 读数批量取出（保持传入顺序，不做字典序重排 ——
 * 奖励卡 / 车库卡片的顺序属于各自的展示策略）。
 */
export function growthStacks(
  inv: PartInventory,
  partIds: readonly string[],
  star: number = GROWTH_STAR,
): readonly CountedStack[] {
  return partIds.map((partId) => growthStack(inv, partId, star));
}

/**
 * 同一 `(partId, star)` 的副本数之和 —— Queue 必改 1「必须归并为同一个 stack」的**可断言形式**：
 * 任意两条读数只要 `(partId, star)` 相同，它们就取自同一个计数器，不存在第二张卡。
 */
export function mergedStackCount(
  inv: PartInventory,
  readings: readonly CountedStack[],
): number {
  const seen = new Map<string, number>();
  for (const r of readings) {
    seen.set(r.partId, getCount(inv, r.partId, r.star));
  }
  let total = 0;
  for (const v of seen.values()) total += v;
  return total;
}

/** fresh 判定（导出给测试与探针；只读，不落盘）。 */
export function isFreshProfile(): boolean {
  return loadPlayerBuild() === null && loadInventoryRaw() === null;
}

/** 新账号该有的那份库存（**不落盘**，供测试断言确切的初始读数）。 */
export function freshSeedInventory(): PartInventory {
  const inv = defaultInventory();
  applyFreshSeed(inv);
  return inv;
}
