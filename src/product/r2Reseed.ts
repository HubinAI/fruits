/**
 * PRODUCT-LOOP-R2-VALIDATION-STATE-RESEED-R1｜**R2 验证起点的版本化一次性 reseed**。
 *
 * ── 为什么需要它（真人的第四条反馈）────────────────────────────────────────────
 * R2-RECOVERY 的一次性 onboarding（`./r2Onboarding`）把历史 Profile 补到了「还差 1 件」
 * 的起点，真人**已经用它完整验过一轮**：`4/5 → 领一件 → 5/5 → 5合1 → ★2 → 装备 ★2`。
 * 于是这份存档落在一个**再也没法复验**的形态：
 *   - `cannon ★2` 已存在（并且装备着）—— 那是**上一轮验证的产物**；
 *   - 新领到的 `cannon ★1` 只有 **1/5**；
 *   - 旧 onboarding 标记已消费 ⇒ 不会再补；
 *   - 而旧 onboarding 的判据 ② 是「存在 ★≥2 的 Weapon 就一个字节都不动」
 *     ⇒ 它**结构上不可能**把这份存档拉回起点（这正是它当初的保护逻辑）。
 * 结果：`4/5 → 领奖 → 5/5 → Fusion → ★2 → 下一局更强` 这条链在真人机器上**再次不可达**，
 * 而「让玩家自己清 localStorage」是 Queue 明令禁止的形态。
 *
 * ── 本模块的形状（与 `r2Onboarding` 同一套路，但**另一份 key / 另一个版本**）──────
 * 一次性、版本化、**只碰 cannon**，判据（下面五条**同时**成立才执行）：
 *   ① 本次 reseed 尚未执行过（磁盘上没有**本模块**的标记）；
 *   ② 旧 R2 onboarding 已执行过（= 这个账号打开过产品首页）；
 *   ③ **有过一次真实领奖记录**（`strongfruit.profileClaims.v1` 非空）；
 *   ④ `cannon` 存在 ★≥2 的副本（= 真的合成过）；
 *   ⑤ `cannon ★1` 的副本数 **< 4**（= 起点真的被消耗掉了）。
 * 成立 ⇒ 把账号恢复成**真实的 pre-fusion 状态**：
 *   - `cannon ★1` 补到 **4**；
 *   - 主武器槽装备 `cannon ★1`（写 `BuildDraft`，经正式 `equipWeapon`）；
 *   - 清掉 `cannon` 的 **★2..★5**（上一轮验证的产物）；
 *   - 其它任何东西**一个字节都不动**（Hammer / Spear / Body / Movement / Gadget / 进度 / 别的 Weapon 的 ★≥2 全部保留）。
 *
 * ⚠️ **判定的时机 = 「新版本首入」，而且只判一次**（`decided`）：
 *    落标记的判据是 `outcome.decided`（**决策已做出**），**不是** `applied`（动作已执行）。
 *    四个「一个字节都不动」的出口（`not-prototype` / `no-claim` / `not-consumed` / `start-intact`）
 *    同样要落标记 —— 否则存在一条**真实的丢档路径**（本轮由 `e2e:product-reward` 抓出来）：
 *      新账号首入（还没领过奖 ⇒ `no-claim`）→ 自己打一局 → 领奖 → 合成 `★2` → 回到首页
 *      ⇒ 这一次挂载五条判据**全部成立** ⇒ 把玩家**自己刚合出来的** `★2` 当成「上一轮的产物」清掉。
 *    根因 = 把「连续判定」当成了「首入判定」：判据读的是**当下库存**，而库存会被玩家自己改变。
 *    ⇒ 判定必须在**第一次挂载**就落定，此后任何挂载只看标记、不再重判。
 * ⚠️ **唯一例外 = 装备被拒**（`equip-failed`）**不落标记**（`decided = false`）：那是**可重试**的
 *    瞬时失败，落标记会把账号永久钉死在「起点已消费」的形态上（Queue 验收 ① 就永远达不成）。
 *    代价（如实披露）：只有这一种失败会每次挂载重判一次；判据全是**纯读**（五次 `getCount`
 *    ＋三个标记读数），没有任何写入，也不产生无谓的持久化。
 *
 * ⚠️ **为什么是新 key 而不是把 `R2_ONBOARDING_VERSION` +1**（Queue 必改 1 的落地方式）：
 *   两件事的**写语义相反**，混在一个模块里会让各自的不变量都无法审计：
 *     - `r2Onboarding` = **只增不减**（它把「一个字节都不改」写进了注释、并被 `PG-*` 用例钉住）；
 *     - 本模块 = **必须删除** cannon 的 ★≥2（这正是 Queue 的目标）。
 *   而且旧标记的语义（「这个账号的验证起点已经安排过了」）**仍然为真** —— 我们只是新增了
 *   另一个事实（「这个账号已经做过新一轮 reseed」）。⇒ 新 key `strongfruit.r2Reseed.v1`。
 *
 * ── 判据 ②③ 是本迁移的**判别式**（收紧过一轮，理由与 `migrateLegacyStarterProfile` 那条同源）──
 * 库存 key `strongfruit.ownedParts.v2` 是旧横屏游戏与竖屏产品**共用**的（见
 * `core/partInventory` 的模块头），而旧横屏的 `fuseSameStar` 同样能把 5×`cannon ★1`
 * 合成 1×`cannon ★2`。若只看 ④⑤，一个**只在旧横屏游戏里**合成过的账号也会被清掉 ★2。
 * 因此要求「这个账号走过**产品**验证链」，两条独立证据同时要求：
 *   - ② 旧 R2 onboarding 标记 —— 只要 `openGrowthSession` 跑过一次就会落它；
 *   - ③ 领奖账本非空 —— `saveClaimLedger` 在整个 `src/` 里**只有一处**调用点
 *     （`playerProfile.claimRunReward` 的成功分支）⇒「账本非空」= 至少真的领过一次奖，
 *     而那正是「4/5 → 5/5」那一步的**结构性前提**（4 件 + 1 件领奖 = 5 件才能合成 ★2）。
 * ⚠️ **② 单独用不够**：一个「只在旧横屏合成过 ★2」的老玩家**第一次**打开产品首页时，② 不成立
 *    （`markR2Onboarding()` 要等到本次挂载末尾才落盘）—— 但**第二次**挂载时标记已经在盘上，
 *    ② 就成立了 ⇒ 只靠 ② 会在第二次挂载把他命中。③ 才是那个真正独立、且**只可能由产品链路
 *    产生**的证据（一次奖都没领过 ⇒ 不可能合出 ★2），因此两条都要。
 * ⚠️ 已知边界（如实披露，不是静默假设）：一个「在旧横屏合成过 ★2、**又**打开过产品首页、
 *    **又**在原型里领过至少一次奖」的账号会同时满足五条判据 ⇒ 它的 `cannon ★2` 也会被清掉。
 *    该类账号已经是 Queue 描述的原型验证账号，故接受；更细的区分在当前存档里**没有信号**。
 *
 * ⚠️ **不动 `core/**`**：清星用 core 既有的 `consume`（它自己夹到 0），补件用 `addPart`，
 *    读数用 `getCount`（`starKey` 是 ★1..★5 的**唯一映射**）—— 本模块不自己展开库存形状，
 *    也不新增第二个写入口。装备走 `playerLoadout.equipWeapon`（唯一写入口，过 `validateSnapshot`）。
 */

import { INVENTORY_MAX_STAR, addPart, consume, getCount, saveInventory, type PartInventory } from '../core/partInventory';
import { readJsonWithVersion, stampVersion } from '../core/saveVersion';
import { platform } from '../platform';
import type { BuildDraft } from '../lab/buildEditorModel';
import { equipWeapon } from './playerLoadout';
import { readClaimLedger } from './playerProfile';
import { isR2OnboardingDone } from './r2Onboarding';

/**
 * 本迁移的持久化 key（产品侧自己的 key，与 `profileClaims.v1` / `r2Onboarding.v1` 同型）。
 *
 * ⚠️ **不复用** `strongfruit.r2Onboarding.v1`：那个标记**已经被上一轮消费掉了**
 *    （Queue 必改 1 明令），复用它等于「用一个已经说过的谎去证明另一件事」。
 */
export const R2_RESEED_KEY = 'strongfruit.r2Reseed.v1';

/**
 * 本迁移的版本号（= 「这一次 reseed」的身份）。
 *
 * ⚠️ **不是** `core/saveVersion.CURRENT_SAVE_VERSION`（那是全局存档格式版本）。将来若要
 *    再发一次不同起点的一次性 reseed，把这里 +1 即可 —— 判据是
 *    `record.version >= R2_RESEED_VERSION`，旧标记自动失效并重跑一次。
 */
export const R2_RESEED_VERSION = 1;

/** 本轮 reseed 的目标形态（Queue 明写：`Cannon ★1 = 4/5` 且**装备 ★1**）。 */
export const R2_RESEED_CANNON_ID = 'cannon';
export const R2_RESEED_CANNON_STAR = 1;
export const R2_RESEED_TARGET_COUNT = 4;

/** 落盘的记录（最小：只有一个版本号，不含时间戳 / 次数 / 玩家标识）。 */
export interface R2ReseedRecord {
  readonly version: number;
}

/**
 * 判定结果（或执行结果）—— 探针 / 测试 / 页面文案都读它，不各自再判一次。
 *
 * `reason` 的取值覆盖**所有**互斥出口（`applied === true` 有且只有 `'reseeded'`）：
 *   - `'reseeded'`     —— 五条判据成立且装备真的换上了 ⇒ 起点已恢复；
 *   - `'already-marked'` —— 本迁移的**首入判定**此前已经做出过（reload 后的形态，`decided = false`）；
 *   - `'not-prototype'`  —— 旧 R2 onboarding 从未执行过（没打开过产品首页，**不动**）；
 *   - `'no-claim'`       —— 领奖账本为空（没走过产品验证链，**不动**）；
 *   - `'not-consumed'`   —— 没有 `cannon ★≥2`（上一轮没合成过，**不动**）；
 *   - `'start-intact'`   —— `cannon ★1` 已经 ≥ 4（起点没被消耗，**不动**）；
 *   - `'equip-failed'`   —— 装备 `cannon ★1` 被正式校验拒绝 ⇒ **零副作用**（下次挂载会重试）。
 */
export type R2ReseedReason =
  | 'reseeded'
  | 'already-marked'
  | 'not-prototype'
  | 'no-claim'
  | 'not-consumed'
  | 'start-intact'
  | 'equip-failed';

/** **纯判定**的读数（一个字节都不写；大小写与执行结果一致，便于直接对账）。 */
export interface R2ReseedPlan {
  /** 五条判据是否全部成立（= 值得执行）。 */
  readonly applied: boolean;
  readonly reason: R2ReseedReason;
  /**
   * 本次挂载是否做出了「**新版本首入**」判定 ⇒ 调用方据此落**本迁移的标记**（只此一次）。
   *
   * ⚠️ 语义是「**决策**已做出」，**不是**「动作已执行」：
   *    - `already-marked` ⇒ `false`（这次不是首入，标记本来就在，不必再写）；
   *    - 四个「不动」的出口（`not-prototype` / `no-claim` / `not-consumed` / `start-intact`）⇒ `true`
   *      —— **必须落标记**，否则「首入时还没领过奖、后来自己合成 ★2」的账号会在下一次挂载
   *      被误判成「上一轮验证消费掉了起点」，把玩家自己刚合出来的 ★2 清掉（真实丢档路径）；
   *    - `applied === true` ⇒ `true`；
   *    - `equip-failed` ⇒ `false`（**可重试**的瞬时失败，不许落标记把账号永久钉死）。
   */
  readonly decided: boolean;
  /** 判定时 `cannon ★1` 的副本数 */
  readonly cannonBefore: number;
  /** 判定时 `cannon` 的 ★≥2 副本总数（值 = 「上一轮合成了几件」） */
  readonly grownBefore: number;
  /** 将被清掉的星级（**只含** ★2..★5 中计数 > 0 的档；★1 永远不在里面） */
  readonly clearedStars: readonly number[];
}

/** 执行读数（`equippedOk === true` 才可能 `applied === true`）。 */
export interface R2ReseedOutcome extends R2ReseedPlan {
  /** 本次**真的**把账号恢复到了起点（⇒ 调用方据此落标记）。 */
  readonly applied: boolean;
  /** 实际补了几件 `cannon ★1`（失败 / 不执行 ⇒ 0） */
  readonly raised: number;
  /** 实际清掉了几件 `cannon ★≥2`（失败 / 不执行 ⇒ 0） */
  readonly cleared: number;
  readonly cannonAfter: number;
  /** 装备动作的真实结果（不执行时为 `null`）。 */
  readonly equipped: { readonly ok: boolean; readonly reason: string | null } | null;
  /** 执行后的 Build（未执行 / 失败时 = 入参那份，**同一对象**）。 */
  readonly draft: BuildDraft;
}

/** 读迁移标记（无标记 / 解析失败 / 形状非法 → `null`，绝不抛）。 */
export function readR2Reseed(): R2ReseedRecord | null {
  let raw: string | null = null;
  try {
    raw = platform.storage.getItem(R2_RESEED_KEY);
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
export function isR2ReseedDone(): boolean {
  const rec = readR2Reseed();
  return rec !== null && rec.version >= R2_RESEED_VERSION;
}

/**
 * 写迁移标记（写入失败静默忽略 —— 与既有存档模块同一纪律：隐私模式 / 配额不影响本局游戏）。
 *
 * ⚠️ 调用方必须在**库存与 Build 都已经落盘之后**再调它：顺序写反（先打标记后落盘）会把
 *    「配额写失败」退化成「标记说恢复了、其实一件没补」—— 玩家从此永远回不到起点。
 *    （`decided === true` 但 `applied === false` 的那四种出口**没有**任何落盘，此顺序自动满足。）
 */
export function markR2Reseed(): void {
  try {
    platform.storage.setItem(
      R2_RESEED_KEY,
      JSON.stringify(stampVersion({ version: R2_RESEED_VERSION })),
    );
  } catch {
    // 写入失败静默忽略：下次挂载会重试（标记没落盘 ⇒ 判据仍成立）
  }
}

/** `cannon` 上 ★2..★5 里**计数 > 0** 的档（读数走 core 的 `getCount`，不展开库存形状）。 */
export function grownCannonStars(inv: PartInventory): readonly number[] {
  const out: number[] = [];
  for (let star = 2; star <= INVENTORY_MAX_STAR; star += 1) {
    if (getCount(inv, R2_RESEED_CANNON_ID, star) > 0) out.push(star);
  }
  return out;
}

/** `cannon` 上 ★≥2 的副本总数（内部求和，不导出中间态）。 */
export function grownCannonCount(inv: PartInventory): number {
  let total = 0;
  for (const star of grownCannonStars(inv)) {
    total += getCount(inv, R2_RESEED_CANNON_ID, star);
  }
  return total;
}

/**
 * 判据 ③「这个账号**真的走过产品验证链**」—— 领奖账本非空。
 *
 * ⚠️ 用 `readClaimLedger()`（`playerProfile` 的正式读入口）而不是自己读 key：
 *    「账本怎么解析 / 脏数据怎么办」的口径只有一处，本模块不复制一份。
 * ⚠️ 不抛、不写：它只是一个**只读**事实（隐私模式 / 无存储 ⇒ 空账本 ⇒ 判据不成立 ⇒ 不动任何东西）。
 */
export function hasPrototypeClaim(): boolean {
  return readClaimLedger().grantedRunIds.length > 0;
}

/**
 * **纯判定**（一个字节都不写）：算出这次挂载该不该 reseed、该清哪几档、以及**要不要落标记**。
 *
 * ⚠️ 与执行分开是刻意的（与 `planR2Onboarding` 同一理由）：调用方要把「落盘」排在
 *    「打标记」**之前**，若把两者塞进一个函数里，那个顺序在结构上就无法表达。
 * ⚠️ **判定只能做一次**：除 `already-marked` 外每个出口都带 `decided = true`，
 *    调用方据此落标记 ⇒ 下一次挂载直接走 `already-marked`、不再重判。
 *    这不是优化，是**正确性要求**（判据读的是会被玩家自己改变的库存，见模块头）。
 */
export function planR2Reseed(inv: PartInventory, _draft: BuildDraft): R2ReseedPlan {
  const before = getCount(inv, R2_RESEED_CANNON_ID, R2_RESEED_CANNON_STAR);
  const grown = grownCannonCount(inv);
  const stars = grownCannonStars(inv);
  /**
   * ⚠️ `decided` 缺省 `true`：下面**除** `already-marked` 之外的每一个出口都是
   *    「新版本首入的判定结论」，调用方都要落标记 —— 含那四个「不动」的出口。
   *    漏掉它们的后果是**真实丢档**（见模块头那段：玩家自己合出来的 ★2 会被清掉）。
   */
  const keep = (reason: R2ReseedReason, decided = true): R2ReseedPlan => ({
    applied: false,
    reason,
    decided,
    cannonBefore: before,
    grownBefore: grown,
    clearedStars: stars,
  });

  // ① 首入判定此前已经做出过 ⇒ 永久跳过（reload 不会再动库存，也不再重判）
  if (isR2ReseedDone()) return keep('already-marked', false);

  // ② 没打开过产品首页（旧 R2 onboarding 从未跑过）⇒ 一个字节都不动
  if (!isR2OnboardingDone()) return keep('not-prototype');

  // ③ 没走过产品验证链（一次奖都没领过）⇒ 一个字节都不动
  if (!hasPrototypeClaim()) return keep('no-claim');

  // ④ 没有 ★≥2 ⇒ 上一轮没有合成过，起点谈不上「被消耗」
  if (grown <= 0) return keep('not-consumed');

  // ⑤ ★1 已经有 4 件及以上 ⇒ 起点完好（不为了「凑成 4」而**降低**玩家的数量）
  if (before >= R2_RESEED_TARGET_COUNT) return keep('start-intact');

  // 五条判据全部成立 ⇒ 这个账号确实消费掉了起点，值得恢复
  return {
    applied: true,
    reason: 'reseeded',
    decided: true,
    cannonBefore: before,
    grownBefore: grown,
    clearedStars: stars,
  };
}

/**
 * 执行判定结果（Queue 必改 1 / 必改 2 / 必改 3 的落地）。
 *
 * ── 落盘顺序（**每一步在磁盘上都是合法状态**，这是本函数唯一需要小心的地方）────
 *   ① `addPart` 把 `cannon ★1` 补齐到 4（**仅内存**）；
 *   ② `equipWeapon('cannon', draft, inv, 1)` —— 唯一写 Build 的入口，过正式 `validateSnapshot`；
 *      ⚠️ 它只读**传进去的**那份 `inv`（不读盘）⇒ ① 的补件必须先于它发生；
 *      ⚠️ 此刻磁盘上「Build 指向 cannon ★1」而 ★1 的数量可能仍是旧值 —— 但判据 ④ 保证
 *         `before < 4`，且**失败即整体回滚**（见下）；真正悬空只可能出现在
 *         「★1 磁盘计数为 0 且 setItem 抛错」这一瞬时窗口，而它**下一次挂载会被
 *         `playerGrowth.repairEquippedStack` 自动兜底**（R2-A 既有的那条安全网）；
 *   ③ 清 `cannon` 的 ★2..★5（`consume` 自己夹到 0，**仅内存**）；
 *   ④ `saveInventory(inv)` —— 唯一写库存的一次（★1 = 4 且 ★≥2 = 0 一起落盘 ⇒ **原子**）。
 *
 * ── 为什么装备失败就**零副作用**（而不是「先把 ★1 补到 4 再说」）──────────────
 *    Queue 的目标是一个**确定的形态**：`★1 = 4/5` **且** 装备 ★1。若装备被拒（例如玩家
 *    当前装的是别的武器、换上炮会超能量），只补数量会让账号停在一个**谁也说不清**的中间态，
 *    而且判据 ④ 会立刻翻成 false ⇒ 永远不再重试。因此这里选择**整体不做**：
 *      - 唯一的内存改动（① 的补件）在失败分支被 `consume` **原样回滚**；
 *      - ② 在失败时**没有**任何落盘（`equipWeapon` 的校验全部在 `persistPlayerBuild` 之前）；
 *    ⇒ 调用方手里的 `inv` / `draft` 与调用前**逐字节相同**，判据下次挂载仍然成立（可重试）。
 *    这与 `playerGrowth.fuseStack` 的 `equip-failed` 回滚是同一条纪律，不是新发明的规则。
 *
 * ⚠️ **只碰 `cannon`**：唯一的 `addPart` / `consume` 目标 id 是 `R2_RESEED_CANNON_ID`，
 *    唯一的装备写入目标槽是 `playerLoadout.equipWeapon` 内部的 `WEAPON_SLOT`。
 *    其它 Weapon / Body / Movement / Gadget / 进度**一个字节都不动**（Queue 必改 2）。
 * ⚠️ **不新增 Reset 语义**：本函数不删任何 key、不清任何 Profile，只在判定成立时做上面四步。
 */
export function applyR2Reseed(
  inv: PartInventory,
  draft: BuildDraft,
  plan: R2ReseedPlan,
): R2ReseedOutcome {
  const skip = (reason: R2ReseedReason): R2ReseedOutcome => ({
    applied: false,
    reason,
    decided: plan.decided,
    cannonBefore: plan.cannonBefore,
    grownBefore: plan.grownBefore,
    clearedStars: plan.clearedStars,
    raised: 0,
    cleared: 0,
    cannonAfter: getCount(inv, R2_RESEED_CANNON_ID, R2_RESEED_CANNON_STAR),
    equipped: null,
    draft,
  });

  if (!plan.applied) {
    // 「不值得执行」的判定原样透传（`applied === false` 的原因由 `plan.reason` 表达）
    return skip(plan.reason);
  }

  // ① 补齐 ★1（仅内存）
  const raised = Math.max(0, R2_RESEED_TARGET_COUNT - plan.cannonBefore);
  addPart(inv, R2_RESEED_CANNON_ID, R2_RESEED_CANNON_STAR, raised);

  // ② 装备 ★1（唯一写 Build 的入口；失败 ⇒ 回滚 ① 并整体放弃）
  const equip = equipWeapon(R2_RESEED_CANNON_ID, draft, inv, R2_RESEED_CANNON_STAR);
  if (!equip.ok || !equip.draft) {
    consume(inv, R2_RESEED_CANNON_ID, R2_RESEED_CANNON_STAR, raised);
    return {
      applied: false,
      reason: 'equip-failed',
      decided: false,
      cannonBefore: plan.cannonBefore,
      grownBefore: plan.grownBefore,
      clearedStars: plan.clearedStars,
      raised: 0,
      cleared: 0,
      cannonAfter: getCount(inv, R2_RESEED_CANNON_ID, R2_RESEED_CANNON_STAR),
      equipped: { ok: false, reason: equip.reason ?? 'unknown' },
      draft,
    };
  }

  // ③ 清掉上一轮验证的产物（★2..★5，仅内存）
  let cleared = 0;
  for (const star of plan.clearedStars) {
    const n = getCount(inv, R2_RESEED_CANNON_ID, star);
    if (n <= 0) continue;
    consume(inv, R2_RESEED_CANNON_ID, star, n);
    cleared += n;
  }

  // ④ 一次落盘：★1 = 4 与「无 ★≥2」同时生效（原子）
  saveInventory(inv);

  return {
    applied: true,
    reason: 'reseeded',
    decided: true,
    cannonBefore: plan.cannonBefore,
    grownBefore: plan.grownBefore,
    clearedStars: plan.clearedStars,
    raised,
    cleared,
    cannonAfter: getCount(inv, R2_RESEED_CANNON_ID, R2_RESEED_CANNON_STAR),
    equipped: { ok: true, reason: null },
    draft: equip.draft,
  };
}
