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
 *
 * ── PRODUCT-LOOP-R2-B-FUSION-STAR 追加：泛化合成（★1..★5）───────────────────
 * R2-A 的成长维度只有**数量**（「不做升星效果」）；R2-B 把**星级**接上：
 *   5 × (同一 `partId` + 同一 `star`) → 1 × (同一 `partId` + `star + 1`)，上限 ★5。
 *
 * ⚠️ 这一层为什么不复用 core 的 `fuseSameStar` / `fuseCategoryMaterials`：
 *    两条规则在「已装备副本」上取值**相反**，且上限不同：
 *      - core（旧横屏）：已装备副本**受保护**（`available = owned - equipped`），装着的件不可作材料，
 *        上限冻结在 2★；
 *      - 本 Queue（必改 2）：装备中的部件**允许参与**，且合成把它合空时**自动升星装备**，
 *        上限 ★5。
 *    ⇒ 复用就等于同时改掉旧横屏的行为（§1b「无静默扩范围」）⇒ 产品侧独立一条规则。
 */
import { loadPlayerBuild } from '../core/buildPersistence';
import {
  INVENTORY_MAX_STAR,
  addPart,
  consume,
  defaultInventory,
  getCount,
  loadInventoryRaw,
  saveInventory,
  type PartInventory,
} from '../core/partInventory';
import { EMPTY_SLOT, type BuildDraft } from '../lab/buildEditorModel';
import { equipWeapon, isWeaponDefId, playerInventory, WEAPON_SLOT } from './playerLoadout';
/**
 * PRODUCT-LOOP-R2-RECOVERY-ONBOARDING-CLARITY（必改 1）｜**一次性 R2 onboarding 迁移**。
 *
 * 历史 Profile 不是 fresh ⇒ 种子不发 ⇒ 真人 Garage 永远停在 `cannon ★1 ×1`，
 * 「4/5 → 打一局 → 5/5 → 合成」这条验证链在真人机器上**不可达**。
 * 本模块把「补到 4 / 只补一次 / 已成长不动」这三条收在一个地方（`r2Onboarding.ts`），
 * `openGrowthSession` 只负责**按正确顺序**调它：
 *     判定 → （补件）→ 落盘库存 → **最后**打标记。
 * ⚠️ 顺序写反的后果是静默的：标记先落盘而库存落盘失败（配额 / 隐私模式）⇒
 *    「标记说做过了、库存却没补上」⇒ 玩家永远拿不到那 3 件。
 */
import {
  markR2Onboarding,
  planR2Onboarding,
  raiseR2OnboardingCannon,
  type R2OnboardingPlan,
} from './r2Onboarding';
/**
 * PRODUCT-LOOP-R2-VALIDATION-STATE-RESEED-R1｜**版本化一次性 reseed**。
 *
 * 上一轮 R2 验证**已经消费掉起点**（合成了 `cannon ★2` 并且装备着它，新领的 ★1 只剩 1 件）
 * ⇒ 「4/5 → 领奖 → 5/5 → 合成 → ★2」这条链再也走不了。`r2Onboarding` 救不了它：
 * 它判据 ② 恰恰是「存在 ★≥2 的 Weapon 就一个字节都不动」（那是它当初的保护逻辑）。
 * 因此另起一份**新 key / 新版本**的一次性迁移（`./r2Reseed`），把它拉回 pre-fusion 起点。
 * ⚠️ 与 onboarding 的分工写在 `./r2Reseed` 的模块头：那边**只增不减**，这边**必须删除** ★≥2。
 */
import {
  applyR2Reseed,
  markR2Reseed,
  planR2Reseed,
  type R2ReseedOutcome,
} from './r2Reseed';
/**
 * PRODUCT-LOOP-R3-MOVEMENT-PERSISTENT-INVENTORY｜**永久成长里的 Movement 维度**。
 *
 * `playerGrowth` 从 R2-A 起只管 Weapon（种子 / 合成 / 装备兜底），Movement 的**拥有状态**
 * 此前在产品侧**没有任何一层**在读、也没有任何不变式在守
 * ⇒ 「车上装着一件并不拥有的轮组」这种状态可以静默存在。
 * 本模块把 Movement 的 owned / equipped 读数与「装着就必须拥有」这条保证收在一处
 * （`./movementInventory`），本模块只负责**按正确顺序**调它：
 *     判定 → （补件）→ 与其它改动共用**同一次** `saveInventory`。
 * ⚠️ 它**只增不减**、且**不碰 draft** ⇒ 战斗行为一个字节都不变。
 */
import {
  ensureMovementOwnership,
  movementOwnership,
  type MovementOwnershipReading,
} from './movementInventory';
/**
 * PRODUCT-LOOP-R3-MOVEMENT-CHOICE-SEED｜**一次性 Movement 可选方案种子**。
 *
 * Movement 的 Foundation 已经技术贯通，但真人账号三档需要库存的轮组**一件都没有**
 * ⇒ 只能「感知存在」，无法「比较 → 选择 → 改配置」。本模块一次性把三档各补到 ≥1 件
 * （判据 / 只增不减的纪律 / 硬边界全在 `./r3MovementChoiceSeed`），
 * 本函数只负责**按正确顺序**调它：改内存 → 落盘 → **最后**打标记。
 * ⚠️ 它**不碰** draft ⇒ 战斗行为一个字节都不变。
 */
import {
  applyR3MovementChoiceSeed,
  markR3MovementSeed,
  type R3MovementSeedOutcome,
} from './r3MovementChoiceSeed';
/**
 * PRODUCT-LOOP-R4-BODY-CANONICAL-AND-GARAGE-MVP｜**一次性 Body 可选方案种子**。
 *
 * Body 的 Foundation 已经技术贯通，但真人账号 4 台新增正式车身**全部未拥有**
 * ⇒ 只能「感知存在」，无法「比较 → 选择 → 改配置」。本模块一次性把 4 台新增正式车身
 * 全部永久解锁（判据 / 只增不减的纪律 / 硬边界全在 `./r4BodyChoiceSeed`），
 * 本函数只负责**按正确顺序**调它：改拥有状态 → 落盘 → **最后**打标记。
 * ⚠️ 它**不碰** draft ⇒ 战斗行为一个字节都不变（不覆盖 Weapon / rear·front Movement）。
 */
import {
  applyR4BodyChoiceSeed,
  markR4BodySeed,
  type R4BodySeedOutcome,
} from './r4BodyChoiceSeed';
/**
 * PRODUCT-LOOP-R5-BASIC-CONTENT-POOL-R1｜**一次性「正式内容池」种子**。
 *
 * 前三轮各补一条维度（R3 = Movement 三档、R4 = Body 的两台 MVP），但正式内容库里
 * **已经存在、Runtime 已经真实跑得通**的内容仍有一大批未拥有：新增 4 台车身只发了 2 台、
 * 11 件正式 Functional 只有 starter 的 4 件。⇒ 开发阶段转入「先铺基础内容」，
 * 本模块一次性把「已经存在的正式内容」整理成可验证内容池
 * （判据 / 只增不减的纪律 / 硬边界 / 各件 Runtime 取证全在 `./r5ContentPoolSeed`）。
 * 本函数只负责**按正确顺序**调它：改内存 → 落盘 → **最后**打标记。
 * ⚠️ 它**不碰** draft ⇒ 战斗行为一个字节都不变（不覆盖 Weapon / rear·front Movement）；
 *    它也**不**放宽 `runCompatibility.FULL_RUN_SUPPORTED_WEAPON_IDS`
 *    ⇒ 「完整 Run 只支持 cannon」这条产品裁决原样不变。
 */
import {
  applyR5ContentPoolSeed,
  markR5ContentPoolSeed,
  type R5ContentPoolOutcome,
} from './r5ContentPoolSeed';

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
  /**
   * 本次挂载结束时**归一化过的** Build（`strongfruit.playerBuild.v1` 里那一份的投影）。
   *
   * ⚠️ 为什么必须由会话回传（而不是让调用方继续用自己手里那份）：本会话里有一类改动会
   *    写 Build —— 一次性 reseed 会把主武器槽换成 `cannon ★1`。若页面仍用挂载前的
   *    `draft`，就会出现「屏幕显示 ★2、磁盘其实是 ★1」这种**两处读数分叉**
   *    （R1-B 起产品侧反复吃亏的那一类缺陷）。⇒ 调用方必须 `draft = growth.draft`。
   * ⚠️ 没有任何改动时它与入参是**同一个对象**（逐字节相同，不是副本）。
   */
  readonly draft: BuildDraft;
  /** 本次挂载是否应用了新账号种子（仅 fresh profile 会为 true）。 */
  readonly seeded: boolean;
  /** 本次挂载为「Equipped 指向有效 stack」补了几件（`null` = 没动）。 */
  readonly repairedEquipped: string | null;
  /** 读的时候是不是一个全新账号（此刻磁盘上既没有 Build 也没有库存）。 */
  readonly freshProfile: boolean;
  /**
   * PRODUCT-LOOP-R2-RECOVERY-ONBOARDING-CLARITY（必改 1）｜本次挂载的
   * **一次性 onboarding 迁移**读数（判定结果原样报出，页面与探针不各自再判一次）。
   *
   * ⚠️ `applied === true` ⇒ 这一次真的把历史 Profile 补到了「还差 1 件」的起点；
   *    `already-marked` ⇒ 曾经执行过（reload 走到这里时就是它）。
   */
  readonly onboarding: R2OnboardingPlan;
  /**
   * PRODUCT-LOOP-R2-VALIDATION-STATE-RESEED-R1｜本次挂载的**版本化一次性 reseed** 读数。
   *
   * ⚠️ `applied === true` ⇒ 这一个账号的「上一轮验证起点」刚被恢复成
   *    `cannon ★1 = 4/5` + 装备 ★1（`reseed.cleared` 是清掉的 ★≥2 件数）；
   *    `already-marked` ⇒ 首入判定早就做出过（reload 后就是它）。
   * ⚠️ `decided === true` ⇒ **本次是新版本首入**，标记已落盘（**含**那四个「一个字节都不动」
   *    的出口 —— 判定只做一次是这个迁移的正确性要求，不是优化）。
   * ⚠️ 只有 `equip-failed` 是 `decided === false`（可重试，下次挂载重新判）。
   */
  readonly reseed: R2ReseedOutcome;
  /**
   * PRODUCT-LOOP-R3-MOVEMENT-PERSISTENT-INVENTORY｜本次挂载的 **Movement 拥有读数**
   * （owned / equipped / persisted 三侧的唯一口径，见 `./movementInventory`）。
   *
   * ⚠️ 它是**补件之后**的读数（`ensureMovementOwnership` 已经跑完）⇒
   *    `legal === false` 在新代码里**不可达**，除非连补件都失败。
   */
  readonly movements: MovementOwnershipReading;
  /**
   * 本次挂载为「装着却不拥有」的 Movement 补了几件（空数组 = 一个字节都没动）。
   *
   * ⚠️ 新账号 / 正常账号恒为空数组（缺省轮恒默认拥有 ⇒ 无需补）；
   *    非空只可能出现在「存档里装着某件需要库存的轮组、但库存里没有它」的形态
   *    （旧档 / 手工档 / 跨版本残留），与 `repairedEquipped` 是同一类修复。
   */
  readonly movementGrants: readonly string[];
  /**
   * PRODUCT-LOOP-R3-MOVEMENT-CHOICE-SEED｜本次挂载的**一次性 Movement 种子**读数。
   *
   * ⚠️ `applied === true` ⇒ 这一次真的把三档需要库存的 Movement 补到了至少 1 件
   * （`movementSeed.entries` 是逐件的 `countBefore → countAfter`）；
   * `already-marked` ⇒ 首入判定早就做出过（reload 后就是它）；
   * `already-owned` ⇒ 三档本来就有（**一个字节都没动**，但仍然落了标记）。
   * ⚠️ `decided === true` ⇒ **本次是新版本首入**，标记已落盘（**含** `already-owned`
   * 那一个「一个字节不动」的出口 —— 判定只做一次是正确性要求，不是优化）。
   */
  readonly movementSeed: R3MovementSeedOutcome;
  /**
   * PRODUCT-LOOP-R4-BODY-CANONICAL-AND-GARAGE-MVP｜本次挂载的**一次性 Body 种子**读数。
   *
   * ⚠️ `applied === true` ⇒ 这一次真的把 **MVP 最小验证集合**（2 台新增正式车身）
   *    永久解锁了（`bodySeed.entries` 是逐台的 `ownedBefore → ownedAfter`）；
   * `already-marked` ⇒ 首入判定早就做出过（reload 后就是它）；
   * `already-owned` ⇒ MVP 车身本来就已拥有（**一个字节都没动**，但仍然落了标记）。
   * ⚠️ `decided === true` ⇒ **本次是新版本首入**，标记已落盘（**含** `already-owned`
   *    那一个「一个字节不动」的出口 —— 判定只做一次是正确性要求，不是优化）。
   */
  readonly bodySeed: R4BodySeedOutcome;
  /**
   * PRODUCT-LOOP-R5-BASIC-CONTENT-POOL-R1｜本次挂载的**一次性「正式内容池」种子**读数。
   *
   * ⚠️ `applied === true` ⇒ 这一次真的把**正式内容池**里缺的那些补齐了
   *    （全部 `NEW_OFFICIAL_BODIES` 车身 + 全部 `OFFICIAL_PARTS` 功能件各 ★1 ×1；
   *     `contentPoolSeed.bodies` / `.parts` 是逐件的 `before → after` 读数）；
   * `already-marked`   ⇒ 首入判定早就做出过（reload 后就是它）；
   * `already-complete` ⇒ 内容池本来就齐（**一个字节都没动**，但仍然落了标记）。
   * ⚠️ `decided === true` ⇒ **本次是新版本首入**，标记已落盘（**含**
   *    `already-complete` 那一个「一个字节不动」的出口 —— 判定只做一次是正确性要求）。
   * ⚠️ `inventoryChanged` 与 `applied` 刻意分开：只有它才决定要不要 `saveInventory`
   *    （车身那一半经 `grantBody` 自己落盘）。
   */
  readonly contentPoolSeed: R5ContentPoolOutcome;
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
 *
 * ── PRODUCT-LOOP-R2-RECOVERY-ONBOARDING-CLARITY（必改 1）追加 ─────────────────
 * 上面那条「种子只发给新账号」正是真人反馈 ② 的根因：真人用的是**历史 Profile**
 * ⇒ 永远停在 `cannon ★1 ×1` ⇒ 验证起点不存在。因此本函数在种子之后、落盘之前
 * 再走一次**一次性 onboarding 迁移**（`planR2Onboarding` → `raiseR2OnboardingCannon`）。
 *
 * ⚠️ **落盘顺序是硬要求**（三段各自都可能改盘）：
 *     ① 先算 `plan`（纯读）；
 *     ② 按 plan 改内存库存（+ 已有的种子 / Equipped 兜底）；
 *     ③ `saveInventory` 落盘库存；
 *     ④ **最后**才 `markR2Onboarding()` 落版本标记。
 *   ④ 排在 ③ 之后，是为了让「配额写失败」只退化成「下次重试」，
 *   而不是「标记说做过了、库存却没补上」这种永久卡死。
 *
 * ── PRODUCT-LOOP-R2-VALIDATION-STATE-RESEED-R1 追加 ──────────────────────────
 * 上一轮真人验证**已经把起点消费掉**（合成了 `cannon ★2` 且装上了它），旧 onboarding 的
 * 判据 ② 又禁止它再动这份存档 ⇒ 验证链再次不可达。本函数在 onboarding 之后、Equipped 兜底
 * **之前**再走一次**版本化一次性 reseed**（`planR2Reseed` → `applyR2Reseed`）：
 *   - 它自己按严格顺序落盘（补 ★1 → 装备 ★1 → 清 ★≥2 → 一次 `saveInventory`），
 *     见 `./r2Reseed` 的落盘顺序说明；
 *   - 它把**换过装的** Build 回传（`reseed.draft`）⇒ 下面所有步骤与调用方都用这一份，
 *     否则会出现「屏幕显示 ★2、磁盘是 ★1」的分叉；
 *   - 装备被拒时它**零副作用**（内存改动被回滚）⇒ 判据下次挂载仍成立，可重试。
 *
 * ── PRODUCT-LOOP-R3-MOVEMENT-PERSISTENT-INVENTORY 追加 ──────────────────────
 * Movement 的拥有状态此前在产品侧没有任何一层在读 —— 本函数在 Equipped 兜底之**后**、
 * 落盘之**前**再走一次 `ensureMovementOwnership`（判据 / 只增不减的纪律全在
 * `./movementInventory`）：**车上装着的 Movement 必须合法拥有**。
 * 新账号的形态（缺省轮恒默认拥有）走的是**空操作**那一条 ⇒ 一个字节都不写；
 * 非空只可能出现在「装着某件需要库存的轮组、库存里却没有它」的旧档 / 手工档上。
 * ⚠️ 它**不碰** `draft` ⇒ Run Snapshot / Runtime 数值与调用前逐字节相同（不改变战斗行为）。
 *
 * ── PRODUCT-LOOP-R3-MOVEMENT-CHOICE-SEED 追加 ───────────────────────────────
 * Movement 的 Foundation 技术贯通之后，真人账号仍然只有缺省标准轮可用
 * ⇒ 这条维度只能「感知存在」，无法「比较 → 选择 → 改配置」。
 * 本函数在 Movement ownership 兜底之**后**、落盘之**前**再走一次
 * `applyR3MovementChoiceSeed`（判据 / 只增不减的纪律全在 `./r3MovementChoiceSeed`）：
 * 一次性把三档需要库存的 Movement 各补到 **至少 1 件**，让「选择」这一步在真人机器上
 * 可达。**只碰 Movement 库存、绝不碰 Build**。
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
  // 必改 1：历史 Profile 的一次性 onboarding（判据 / 补件量全在 `r2Onboarding.ts`）
  const onboarding = planR2Onboarding(inv);
  if (onboarding.applied) {
    raiseR2OnboardingCannon(inv, onboarding);
    changed = true;
  }
  /*
    PRODUCT-LOOP-R2-VALIDATION-STATE-RESEED-R1｜版本化一次性 reseed（判据 / 顺序全在
    `r2Reseed.ts`）。⚠️ 位置是刻意的：排在 onboarding **之后**（起点先由 onboarding / 种子
    安排妥当，再看它是不是已经被消费掉），排在 Equipped 兜底**之前**（兜底要按 reseed 之后的
    装备读数判断，否则它会去补一个刚刚被清掉的 ★2）。
  */
  const reseedPlan = planR2Reseed(inv, draft);
  const reseed = applyR2Reseed(inv, draft, reseedPlan);
  if (reseed.applied) changed = true;
  /** reseed 可能换过装 ⇒ 后续一切（含调用方）都用这一份 Build。 */
  const nextDraft: BuildDraft = reseed.draft;
  const repairedEquipped = repairEquippedStack(inv, nextDraft);
  changed = changed || repairedEquipped !== null;
  /*
    PRODUCT-LOOP-R3-MOVEMENT-PERSISTENT-INVENTORY｜Movement 的同一个不变式：
    「车上装着的 Movement 必须合法拥有」（Queue 必改 2 / 必改 3）。
    ⚠️ 位置是刻意的：排在 reseed **之后**（reseed 会改写 Build，必须按最终那份 draft 判），
       与 `repairEquippedStack` **并列**（两者都只改内存库存，共用下面那一次落盘）。
       它**不碰** draft ⇒ 战斗行为与调用前逐字节相同。
    ⚠️ 与 weapon 的那次修复同一条纪律：**只增不减**，且对「本来就合法」的账号是空操作
       —— 新账号的形态（缺省轮恒默认拥有）走的就是空操作那一条。
  */
  const movementGrants = ensureMovementOwnership(inv, nextDraft);
  changed = changed || movementGrants.length > 0;
  /*
    PRODUCT-LOOP-R3-MOVEMENT-CHOICE-SEED｜一次性 Movement 可选方案种子。
    判据 / 补件量 / 只增不减的纪律全在 `./r3MovementChoiceSeed`。

    ⚠️ 位置是刻意的：排在 `ensureMovementOwnership` **之后**（先保证「装着的必须拥有」
       这条不变式成立，再看「有没有可比较的选择」），排在下面那唯一一次 `saveInventory`
       **之前** ⇒ 它只改内存，落盘与「标记晚于落盘」的顺序与其它三段完全一致。
    ⚠️ 它**不碰** `nextDraft` ⇒ Run Snapshot / Runtime 数值与调用前逐字节相同
       （「不自动替玩家装备新轮子」「不重置当前 rear / front」是结构性成立的）。
  */
  const movementSeed = applyR3MovementChoiceSeed(inv);
  if (movementSeed.applied) changed = true;
  /*
    PRODUCT-LOOP-R4-BODY-CANONICAL-AND-GARAGE-MVP｜一次性 Body 可选方案种子。
    判据 / 只增不减的纪律全在 `./r4BodyChoiceSeed`。

    ⚠️ 位置是刻意的：排在 `applyR3MovementChoiceSeed` **之后**（Movement 种子只改库存，
        Body 种子只改独立拥有状态，两者互不干扰），且 Body 种子**不碰** `nextDraft`
       ⇒ Run Snapshot / Runtime 数值与调用前逐字节相同（不覆盖 Weapon / rear·front Movement）。
    ⚠️ 标记同样是 `decided`（**首入决策已做出**），**不是** `applied`：
         `already-owned` 那条「一个字节都不动」的出口也必须落标记 —— 否则玩家自己之后在
         debug 里取消某台车身的拥有时，下一次挂载判据会重新成立、把玩家自己取消的拥有再发一遍。
  */
  const bodySeed = applyR4BodyChoiceSeed();
  if (bodySeed.decided) markR4BodySeed();
  /*
    PRODUCT-LOOP-R5-BASIC-CONTENT-POOL-R1｜一次性「正式内容池」种子。
    判据 / 只增不减的纪律 / 各件 Runtime 取证全在 `./r5ContentPoolSeed`。

    ⚠️ 位置是刻意的：排在 `applyR4BodyChoiceSeed` **之后**（Body 种子只发 MVP 那 2 台，
        这里把剩余的新车身一并补齐 —— 两个集合不同、各写各的标记，互不覆盖），
        排在下面那唯一一次 `saveInventory` **之前** ⇒ 它的功能件那一半只改内存，
        与其它几段共用同一次落盘。

    ⚠️ **它与前三段的一个结构性差异**：它有**两个**写面 ——
        车身那一半经 `grantBody` **自己落盘**（core 的 `ownedBodies.v1`），
        功能件那一半只改内存 `inv`、要靠下面那次 `saveInventory`。
        因此这里必须用 `inventoryChanged`（**不是** `applied`）去置 `changed`：
        「车身补了但库存没变」的挂载若也置 `changed`，就会产生一次无谓的落盘写。

    ⚠️ 标记同样是 `decided`（**首入决策已做出**），**不是** `applied`：
        `already-complete` 那条「一个字节都不动」的出口也必须落标记 —— 否则玩家自己之后
        把某件武器合成掉 / 在 debug 里取消某台车身时，下一次挂载判据会重新成立、
        把玩家自己消耗掉的东西再发一遍。
    ⚠️ 它**不碰** `nextDraft` ⇒ Run Snapshot / Runtime 数值与调用前逐字节相同
        （不覆盖 Weapon / rear·front Movement）；它也**不**放宽
        `runCompatibility.FULL_RUN_SUPPORTED_WEAPON_IDS` ⇒ 「完整 Run 只支持 cannon」
        这条产品裁决原样不变（新发的武器只是「已拥有、可装备、可进单场 Battle」）。
  */
  const contentPoolSeed = applyR5ContentPoolSeed(inv);
  if (contentPoolSeed.inventoryChanged) changed = true;
  /** 补件之后才取读数 ⇒ 报出的 owned / legal 就是**本次挂载结束**时的真实形态。 */
  const movements = movementOwnership(inv, nextDraft);

  if (changed) saveInventory(inv);
  // ④ 标记**必须**晚于库存落盘（见上方顺序说明）
  if (onboarding.needsMark) markR2Onboarding();
  /*
    ⑤ reseed 的标记：判据是 `decided`（**首入决策已做出**），**不是** `applied`（动作已执行）。
    那四个「一个字节都不动」的出口（not-prototype / no-claim / not-consumed / start-intact）
    同样要落标记 —— 否则存在一条**真实丢档路径**：新账号首入时还没领过奖（`no-claim`），
    之后自己打一局、领奖、合成 ★2，再次挂载时五条判据全部成立 ⇒ 玩家**自己刚合出来的** ★2
    会被当成「上一轮的产物」清掉。（本轮由 `e2e:product-reward` 在门禁里抓出来。）
    唯一**不**落标记的是 `equip-failed`：那是可重试的瞬时失败。
    顺序同样排在它自己的落盘（`applyR2Reseed` 内部那一次）之后。
  */
  if (reseed.decided) markR2Reseed();
  /*
    ⑥ Movement 种子的标记：判据同样是 `decided`（**首入决策已做出**），**不是** `applied`。
    `already-owned` 那一个「一个字节都不动」的出口也必须落标记 —— 否则玩家自己之后把
    某一件轮组用掉时，下一次挂载判据会重新成立、把玩家自己消耗掉的东西再发一遍。
    本模块没有 `equip-failed` 那一类可重试的瞬时失败（它不写 Build），故 `decided === false`
    只在 `already-marked` 时出现。顺序同样排在它自己的落盘之后（共用上面那一次 `saveInventory`）。
  */
  if (movementSeed.decided) markR3MovementSeed();
  /*
    ⑦ 内容池种子的标记：判据同样是 `decided`（**首入决策已做出**），**不是** `applied`。
    `already-complete` 那一个「一个字节都不动」的出口也必须落标记 —— 否则玩家自己之后
    把某件武器合成掉、或在 debug 里取消某台车身的拥有时，下一次挂载判据会重新成立、
    把玩家自己消耗掉的东西再发一遍。
    本模块没有 `equip-failed` 那一类可重试的瞬时失败（它不写 Build），故 `decided === false`
    只在 `already-marked` 时出现。
    ⚠️ 顺序**必须**排在 `saveInventory` 之后：本种子的**功能件那一半**只改内存，
        靠上面那次落盘，标记先落会让「配额写失败」退化成「标记说发过了、件却没补上」
        ⇒ 玩家永远拿不到那几件。（车身那一半经 `grantBody` 自己落盘，不受这一步影响。）
  */
  if (contentPoolSeed.decided) markR5ContentPoolSeed();
  return {
    inv,
    draft: nextDraft,
    seeded,
    repairedEquipped,
    freshProfile,
    onboarding,
    reseed,
    movements,
    movementGrants,
    movementSeed,
    bodySeed,
    contentPoolSeed,
  };
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

/* ============================================================================
 * PRODUCT-LOOP-R2-B-FUSION-STAR｜泛化合成（★1..★5）+「装备不得指向空 stack」
 * ----------------------------------------------------------------------------
 * 唯一合成规则（Queue 原文）：
 *     5 × (同一 partId + 同一 star)  →  1 × (同一 partId + star + 1)
 * 不同 Weapon 不能混合、不同星级不能混合、★5 为上限不可继续合成。
 * ========================================================================== */

/**
 * 产品侧成长的**星级上限** = ★5（Queue：「5★为当前最高星级，不可继续合成」）。
 *
 * ⚠️ **不写死 5**：直接取 core 的 `INVENTORY_MAX_STAR`（库存数据模型的档数上限）
 *    ⇒ 两处**同值**且**不可能漂移**（没有第二份真源，也不需要相等断言去兜）。
 * ⚠️ 与 core 的 `MAX_STAR = 2` **不是**同一件事：那是**旧横屏融合规则**的策略上限（冻结）。
 */
export const GROWTH_MAX_STAR = INVENTORY_MAX_STAR;

/** 合成预检读数（Garage 的「可合成」徽标与合成按钮都读它，不各自判一次）。 */
export interface FusionGate {
  /** 现在能不能合（`count >= need` 且 `star < 上限`） */
  readonly ok: boolean;
  /** 该 `(partId, star)` 当前的副本数 */
  readonly count: number;
  /** 一次合成消耗几件（= `FUSE_STACK`，真源是 core 的 `need`） */
  readonly need: number;
  /** 已达星级上限（★5），不可再合 */
  readonly maxStar: boolean;
  /** 是不是一件正式 Weapon（非 Weapon 不参与产品成长合成） */
  readonly isWeapon: boolean;
}

/**
 * 合成预检（**纯读**，一个字节都不写）。
 *
 * ⚠️ 与 core `canFuse()` 的**唯一差别**：这里**不扣除已装备副本**（必改 2「装备中的部件
 *    允许参与」）⇒ 同一份库存，`canFuse` 可能说不行而这里说行 —— 这是**刻意的语义分歧**，
 *    不是 bug（`tests/productFusionR2B.test.ts` 有一条断言把两者摆在一起钉死这个差异）。
 * ⚠️ `star` 是必传参数（不给默认值）：合成是写操作，星级必须是调用方明确给的事实。
 */
export function canFuseStack(inv: PartInventory, partId: string, star: number): FusionGate {
  if (!isWeaponDefId(partId)) {
    return { ok: false, count: 0, need: FUSE_STACK, maxStar: false, isWeapon: false };
  }
  const s = Math.floor(Number(star) || 0);
  const count = getCount(inv, partId, s);
  const maxStar = s >= GROWTH_MAX_STAR;
  return { ok: count >= FUSE_STACK && !maxStar, count, need: FUSE_STACK, maxStar, isWeapon: true };
}

/** 合成被拒的原因（页面如实展示，不静默失败、不假装成功）。 */
export type FusionRefusal = 'not-weapon' | 'bad-star' | 'not-enough' | 'max-star' | 'equip-failed';

/** 一次**成功**合成的完整读数（库存 / Build / 装备三侧的事实都在这一个结果里）。 */
export interface FusionOutcome {
  readonly ok: true;
  readonly partId: string;
  /** 被消耗的星级 */
  readonly fromStar: number;
  /** 产出的星级（= `fromStar + 1`） */
  readonly toStar: number;
  /** 消耗掉的件数（恒 = `FUSE_STACK`） */
  readonly consumed: number;
  /** 消耗**前** `fromStar` 这一档的计数 */
  readonly countBefore: number;
  /** 消耗**后** `fromStar` 这一档的计数（0 = 这一档被合空） */
  readonly countAfter: number;
  /** 产出的 `toStar` 那一档合成后的计数 */
  readonly productCount: number;
  /**
   * 合成前 / 后，**这个 `partId`** 在装备槽（`WEAPON_SLOT`）上的星级。
   * `null` = 这件没装在车上（那就不存在「装备指向」问题，装备一个字节都没动）。
   */
  readonly equippedBefore: number | null;
  readonly equippedAfter: number | null;
  /** 是否因为「装备的那一档被合空」而**自动升星**了装备（必改 2） */
  readonly equippedUpgraded: boolean;
  /** 落盘后的库存（与入参是**同一个对象**，调用方直接替换手里那份即可） */
  readonly inventory: PartInventory;
  /** 落盘后的 Build（未自动升星时与入参 `draft` 是**同一个对象**） */
  readonly draft: BuildDraft;
}

export interface FusionFailure {
  readonly ok: false;
  readonly reason: FusionRefusal;
  readonly detail: string;
}

export type FusionResult = FusionOutcome | FusionFailure;

/**
 * **唯一合成动作**（Queue 必改 1「Generic Fusion」）。
 *
 * 输入只有 `partId` + `star` —— 不对任何具体武器写特例（`cannon` 走的是与其它武器**完全
 * 相同**的代码路径，源码里没有任何 `if (partId === 'cannon')`）。
 *
 * 执行顺序（**每一次调用只执行一次 5 合 1**，必改 5：不做连锁消耗）：
 *   ① 预检（`canFuseStack`）：不是 Weapon / 星级非法 / 数量不够 / 已到 ★5 → 直接拒绝，零副作用；
 *   ② 消耗 5 × `(partId, star)` → 产出 1 × `(partId, star + 1)`；
 *   ③ 必改 2：若装备着的正是这个 `(partId, star)` 且它**已被合空**（`countAfter === 0`），
 *      则把装备升到 `star + 1`（经 `playerLoadout.equipWeapon` → `validateSnapshot` +
 *      `savePlayerBuild`）⇒ 玩家不需要「卸下 → 合成 → 再装备」；
 *   ④ 若 ③ 的升星会让 Build **非法**（例如能量超限），把 ② 的库存改动**整体回滚**并返回
 *      `equip-failed`。宁可这一次不合成，也**绝不**留下一个指向空 stack 的装备
 *      —— 「Equipped 不得指向不存在物品」是硬要求，静默留一个悬空装备是更坏的结果。
 *
 * ⚠️ ③ 只在「装备那一档被合空」时才动装备：若消耗后那一档仍有剩件（例如 6 件里合掉 5 件），
 *    装备仍然指向一个**有效** stack ⇒ **不动它**（玩家想在车库换成 ★2 那张卡，自己点即可）。
 * ⚠️ 本函数**只处理 `WEAPON_SLOT`**（产品侧唯一打通的槽位，即「Equipped」的语义）。
 *    其它挂点（`top`/`front`/…）在 R1-A 就只做**只读展示**、产品从不向其写入；若把它们的
 *    星级也一并改写，会顺带改变那些槽位在战斗里的能量 / 伤害（Q22 星级倍率）——
 *    那是禁止清单里的「Weapon Damage / Battle」改动，故**刻意不做**（见交接文档「未做项」）。
 */
export function fuseStack(
  inv: PartInventory,
  partId: string,
  star: number,
  draft: BuildDraft,
): FusionResult {
  const s = Math.floor(Number(star) || 0);
  const gate = canFuseStack(inv, partId, star);
  if (!gate.isWeapon) {
    return { ok: false, reason: 'not-weapon', detail: `"${partId}" 不是正式武器，不参与成长合成` };
  }
  if (s < 1) {
    return {
      ok: false,
      reason: 'bad-star',
      detail: `非法星级 ${String(star)}（合法区间 ★1..★${GROWTH_MAX_STAR}）`,
    };
  }
  if (gate.maxStar) {
    return {
      ok: false,
      reason: 'max-star',
      detail: `★${s} 已是星级上限（★${GROWTH_MAX_STAR}），不可继续合成`,
    };
  }
  if (gate.count < FUSE_STACK) {
    return {
      ok: false,
      reason: 'not-enough',
      detail: `还差 ${FUSE_STACK - gate.count} 件（当前 ${gate.count}/${FUSE_STACK}）`,
    };
  }

  // 装备读数（在改动之前取，供 ③ 判断与结果对账）
  const key = equippedStackKey(draft);
  const equippedBefore = key && key.partId === partId ? key.star : null;

  // ② 材料 → 产物（一次调用只做一次，不连锁）
  consume(inv, partId, s, FUSE_STACK);
  addPart(inv, partId, s + 1, 1);

  // ③ 装备那一档被合空 ⇒ 装备必须跟着升到 star+1（必改 2）
  let nextDraft = draft;
  let equippedUpgraded = false;
  if (equippedBefore === s && getCount(inv, partId, s) === 0) {
    const out = equipWeapon(partId, draft, inv, s + 1);
    if (!out.ok || !out.draft) {
      // ④ 回滚（原子）：绝不留悬空装备，也绝不留半成品库存
      addPart(inv, partId, s, FUSE_STACK);
      consume(inv, partId, s + 1, 1);
      return {
        ok: false,
        reason: 'equip-failed',
        detail: `合成后无法把装备升到 ★${s + 1}（${String(out.reason)}）：${out.detail ?? ''}`,
      };
    }
    nextDraft = out.draft;
    equippedUpgraded = true;
  }

  saveInventory(inv);
  return {
    ok: true,
    partId,
    fromStar: s,
    toStar: s + 1,
    consumed: FUSE_STACK,
    countBefore: gate.count,
    countAfter: getCount(inv, partId, s),
    productCount: getCount(inv, partId, s + 1),
    equippedBefore,
    equippedAfter: equippedUpgraded ? s + 1 : equippedBefore,
    equippedUpgraded,
    inventory: inv,
    draft: nextDraft,
  };
}
