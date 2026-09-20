/**
 * PRODUCT-LOOP-R2-RECOVERY-ONBOARDING-CLARITY｜必改 1｜**R2 Onboarding Migration**。
 *
 * ── 为什么需要它（真人的第三条反馈）────────────────────────────────────────────
 * 真人 Garage 实际读数 = `cannon ★1 ×1 / hammer ★1 ×1 / spear ★1 ×1`，
 * **没有**出现设计目标里的 `cannon ★1 4/5`。原因不是种子坏了，而是**种子的发放面**：
 * R2-A 的 `FRESH_STACK_SEED` 只发给**全新账号**（磁盘上既没有 Build 也没有库存），
 * 而真人用的是**历史 Profile** —— 它的库存 key 早就存在 ⇒ `isFreshProfile()` 恒为 false
 * ⇒ 种子结构上不会触发。于是「还差 1 件就能升星」这个**验证起点**在真人机器上不存在，
 * 整个人工验证链（4/5 → 打一局 → 5/5 → 合成 ★2）**不可达**。
 *
 * ── 本模块的形状（Queue 必改 1 逐条落地）──────────────────────────────────────
 * 一次性迁移，判据 = **下面三条同时成立**才补件：
 *   ① 尚未执行过本次 R2 onboarding（磁盘上没有本模块的版本标记）；
 *   ② 当前**没有任何 ★2 及以上的成长**（见 `hasAnyWeaponGrowth` 的口径说明）；
 *   ③ `cannon ★1` 的副本数 **< 4**。
 * 成立 ⇒ 把 `cannon ★1` 补到 **至少 4**（`1/2/3 → 4`；`4+ → 不变`）。
 *
 * ⚠️ 「只执行一次」靠**落盘的版本标记**，不是靠内存：
 *    `strongfruit.r2Onboarding.v1`（带既有 `saveVersion` 的 `__v` 信封）。
 *    没有这个标记的话，`reload` 会再补 3 个 —— 那正是 Queue 明令禁止的形态。
 * ⚠️ **不动 `core/saveVersion.ts`**：那是**全局**存档版本号（`build` / `inventory` / `progress`
 *    与旧横屏游戏共用），为一次产品 onboarding 抬高它会波及全部存档种类；
 *    这里沿用 `playerProfile.ts` 的 `profileClaims.v1` 先例 —— **产品侧自己一个 key**。
 *    代价（如实披露，与 `profileClaims.v1` 同型）：它**不在** `RESET_KEYS` 里 ⇒
 *    DEV Reset 不会清它（Reset 后本迁移不会重跑）。因为它的语义是「这个账号的验证起点
 *    已经安排过了」，Reset 不该把它当成「没安排过」，故行为是刻意的、不是遗漏。
 *
 * ⚠️ 这是 **Prototype onboarding**，不是正式经济投放：它只保证「现有测试账号处于还差 1 件
 *    的起点」，不含任何概率 / 稀有度 / 赠送规则，也**不会**被将来的正式发奖复用。
 *
 * ⚠️ 判据 ② 为什么按「**Weapon** 且 ★≥2」而不是「库存里任何 ★≥2」：
 *    - Queue 原文第一条写的就是「star > 1 的 **Weapon**」；
 *    - 产品侧唯一的合成动作 `playerGrowth.fuseStack()` 只作用于正式 Weapon
 *      （`canFuseStack` 的 `isWeaponDefId` 闸门）⇒「产品里发生过 Fusion 的成长状态」
 *      与「存在 ★≥2 的 Weapon」在当前产品里是**同一件事**；
 *    - 旧横屏的 `fuseSameStar` / `fuseCategoryMaterials` 能合**非武器**（轮子 / 辅助），
 *      那种 ★2 **不**代表玩家已经体验过产品侧成长链 ⇒ 刻意不拿它去阻断 onboarding。
 *    口径取自 `weaponEntries()`（产品侧唯一武器读数），不自己展开库存形状、不用字符串比较。
 *
 * ⚠️ **只增不减**（与 `playerGrowth.ts` 同一纪律）：唯一写操作是 `addPart`（计数变大），
 *    绝不删除、绝不归零、绝不覆盖任何其它条目；已成长的账号**一个字节都不改库存**。
 */

import { addPart, getCount, type PartInventory } from '../core/partInventory';
import { readJsonWithVersion, stampVersion } from '../core/saveVersion';
import { platform } from '../platform';
import { weaponEntries } from './playerLoadout';

/**
 * 本迁移的持久化 key（产品侧自己的 key，与 `profileClaims.v1` 同型）。
 *
 * ⚠️ 不带 `__v` 后缀之外的版本机制：内容的版本由记录里的 `version` 字段表达，
 *    信封 `__v` 复用既有 `core/saveVersion.stampVersion`（不新造第二套版本机制）。
 */
export const R2_ONBOARDING_KEY = 'strongfruit.r2Onboarding.v1';

/**
 * 本迁移的版本号（= 「这次 onboarding」的身份）。
 *
 * ⚠️ 它**不是** `core/saveVersion.CURRENT_SAVE_VERSION`：那个是全局存档格式版本，
 *    与「产品做过哪一次 onboarding」是两个正交的概念，混用会让全局版本号被产品活动绑架。
 * 将来若要再发一次不同起点的一次性 onboarding（例如正式数值投放），把这里 +1 即可 ——
 * 判据是 `record.version >= R2_ONBOARDING_VERSION`，旧标记自动失效并重跑一次。
 */
export const R2_ONBOARDING_VERSION = 1;

/** 本次 onboarding 的补件目标（Queue：「cannon ★1 count → 至少补到 4」）。 */
export const R2_ONBOARDING_CANNON_ID = 'cannon';
export const R2_ONBOARDING_CANNON_STAR = 1;
export const R2_ONBOARDING_TARGET_COUNT = 4;

/** 落盘的记录（最小：只有一个版本号，不含时间戳 / 次数 / 玩家标识）。 */
export interface R2OnboardingRecord {
  readonly version: number;
}

/** 迁移结果（探针 / 测试 / 页面文案都读它，不各自猜一次）。 */
export interface R2OnboardingPlan {
  /** 本次挂载是否需要**真的补件**（`false` ⇒ 库存一个字节都不动）。 */
  readonly applied: boolean;
  /** 本次挂载是否需要**落一次版本标记**（已标记过 ⇒ `false`，不再写盘）。 */
  readonly needsMark: boolean;
  /**
   * 为什么是这个结果：
   *   - `'raised'`         —— 三条判据全部成立，补了件；
   *   - `'already-enough'` —— 没有成长，但 `cannon ★1` 已经 ≥ 4（只打标记）；
   *   - `'already-grown'`  —— 已经有过 ★≥2 的 Weapon 成长（只打标记，**库存不改**）；
   *   - `'already-marked'` —— 本迁移此前已执行过（什么都不做）。
   */
  readonly reason: 'raised' | 'already-enough' | 'already-grown' | 'already-marked';
  /** 实际补了几件（`applied === false` ⇒ 恒 0）。 */
  readonly raised: number;
  readonly cannonBefore: number;
  readonly cannonAfter: number;
}

/** 读迁移标记（无标记 / 解析失败 / 形状非法 → `null`，绝不抛）。 */
export function readR2Onboarding(): R2OnboardingRecord | null {
  let raw: string | null = null;
  try {
    raw = platform.storage.getItem(R2_ONBOARDING_KEY);
  } catch {
    return null;
  }
  const parsed = readJsonWithVersion(raw);
  if (!parsed) return null;
  const obj = parsed.obj as Record<string, unknown> | null;
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const version = obj['version'];
  if (typeof version !== 'number' || !Number.isFinite(version)) return null;
  return { version: Math.floor(version) };
}

/** 本迁移是否已经执行过（幂等判据）。 */
export function isR2OnboardingDone(): boolean {
  const rec = readR2Onboarding();
  return rec !== null && rec.version >= R2_ONBOARDING_VERSION;
}

/**
 * 写迁移标记（写入失败静默忽略 —— 与既有存档模块同一纪律：隐私模式 / 配额不影响本局游戏）。
 *
 * ⚠️ 调用方必须在**库存已经落盘之后**再调它（见 `openGrowthSession` 的注释）：
 *    顺序写反（先打标记后落盘）会让「配额写失败」这一种情况变成
 *    「标记说做过了、库存却没补上」—— 玩家从此永远拿不到那 3 件。
 */
export function markR2Onboarding(): void {
  try {
    platform.storage.setItem(
      R2_ONBOARDING_KEY,
      JSON.stringify(stampVersion({ version: R2_ONBOARDING_VERSION })),
    );
  } catch {
    // 写入失败静默忽略：下次挂载会重试（标记没落盘 ⇒ 判据仍成立）
  }
}

/**
 * 「当前是否已经有过 ★≥2 的 Weapon 成长」—— 判据 ② 的实现（口径见模块头注释）。
 *
 * ⚠️ 取自 `weaponEntries()`（产品侧唯一武器读数）而不是自己遍历库存形状：
 *    星级档位 / 上限的真源在 core，产品侧再展开一遍就是第二份知识。
 */
export function hasAnyWeaponGrowth(inv: PartInventory): boolean {
  return weaponEntries(inv).some((w) => w.star >= 2);
}

/**
 * **纯判定**（一个字节都不写）：算出这次挂载该不该补件、该不该打标记。
 *
 * ⚠️ 与执行分开是刻意的：调用方要把「库存落盘」排在「打标记」**之前**
 *    （见 `markR2Onboarding` 的顺序说明），若把落盘与打标记都塞进一个函数里，
 *    那个顺序在结构上就无法表达。
 */
export function planR2Onboarding(inv: PartInventory): R2OnboardingPlan {
  const before = getCount(inv, R2_ONBOARDING_CANNON_ID, R2_ONBOARDING_CANNON_STAR);
  const done = (reason: R2OnboardingPlan['reason'], raised: number): R2OnboardingPlan => ({
    applied: false,
    needsMark: false,
    reason,
    raised: 0,
    cannonBefore: before,
    cannonAfter: before + raised,
  });

  // ① 已经执行过 ⇒ 永久跳过（reload 不会再补）
  if (isR2OnboardingDone()) return done('already-marked', 0);

  // ② 已经有过星级成长 ⇒ **完全不改库存**，只打标记
  if (hasAnyWeaponGrowth(inv)) return { ...done('already-grown', 0), needsMark: true };

  // ③ 已经够了 ⇒ 只打标记
  if (before >= R2_ONBOARDING_TARGET_COUNT) return { ...done('already-enough', 0), needsMark: true };

  // 三条判据全部成立 ⇒ 补到至少 4
  const raised = R2_ONBOARDING_TARGET_COUNT - before;
  return {
    applied: true,
    needsMark: true,
    reason: 'raised',
    raised,
    cannonBefore: before,
    cannonAfter: before + raised,
  };
}

/**
 * 执行判定结果里的**库存部分**（只 `addPart`，不落盘、不打标记 —— 那两件事由调用方按序做）。
 *
 * ⚠️ `plan.raised <= 0` 时是纯空操作，不会触碰库存。
 * ⚠️ 不校验 `partId` 是否是一件正式 Weapon：`R2_ONBOARDING_CANNON_ID` 是本 Queue 的
 *    产品决策常量（同 `FRESH_STACK_SEED` 的做法），不是从外部输入来的值。
 */
export function raiseR2OnboardingCannon(inv: PartInventory, plan: R2OnboardingPlan): void {
  if (plan.raised <= 0) return;
  addPart(inv, R2_ONBOARDING_CANNON_ID, R2_ONBOARDING_CANNON_STAR, plan.raised);
}
