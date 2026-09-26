/**
 * PRODUCT-LOOP-R5-BASIC-CONTENT-POOL-R1｜**一次性「正式内容池」种子**。
 *
 * ── 为什么需要它（与 R3 / R4 种子同构的动机）────────────────────────────────
 * 前三轮的种子各补**一条维度**：R3 补 Movement 三档、R4 补 Body 的两台 MVP。
 * 但真人打开 Garage 时，**正式内容库里已经存在、且 Runtime 已经真实跑得通**的
 * 内容仍有一大批「未拥有」：
 *   - 新增 4 台正式车身里，只有 durian / mango 被 R4 发过；
 *   - 11 件正式 Functional 里，只有 starter 的 4 件（cannon / hammer / pushRod / spear）
 *     是新账号就有。
 * ⇒ 这一维度只能被**感知**（「啊，内容库里还有这些东西」），无法被**验证**
 *   （「装上它打一局看看」一步都做不了）。
 * 本 Queue 的开发阶段目标 = **先铺基础内容、减少真人录屏** ⇒ 需要一份把
 * 「仓库里已经存在的正式内容」整理成**当前原型可验证内容池**的一次性投放。
 *
 * ⚠️ **本模块不设计任何新内容**（Queue 目标段逐字）：它只把**已经存在**的
 *    `OFFICIAL_BODIES` / `OFFICIAL_PARTS` 的成员**补到拥有**，一个新 id 都不造、
 *    一个数值都不改、一条战斗规则都不动。
 *
 * ── 它发什么（两个集合，全部现读自 core 真源）──────────────────────────────
 *   ① **Body**：`NEW_OFFICIAL_BODIES`（= 4 台需要解锁的新正式车身）**全部**。
 *      旧 4 台（`DEFAULT_OWNED_BODIES`）恒默认拥有、不进本模块。
 *      ⇒ 全部 8 台正式车身对验证账号可用（Queue 第二部分）。
 *   ② **Functional**：`OFFICIAL_PARTS`（= `PART_OPTIONS` 去 EMPTY）**全部**，
 *      每件保底 `R5_POOL_MIN_COUNT` = **1 件 ★1**（Queue 第四部分）。
 *      ⇒ 验证账号拥有全部 11 件正式功能件。
 *
 * ── 为什么 Functional 集合取 `OFFICIAL_PARTS` 而不是「只取 Weapon」──────────
 * Queue 第四部分标题是「Weapon 验证库存」，且要求「Runtime 已存在、只是 Product Run
 * 尚未开放」的 Weapon 至少 ★1 ×1。本模块取**更宽**的 `OFFICIAL_PARTS`，理由有三：
 *   ① 那是**唯一真源**。`OFFICIAL_PARTS` 就是 core 的「正式 Functional 全集」，
 *      也正是战斗奖励池（`buildRewardCandidates`）与 debug「全部件×1」用的同一份。
 *      按 `category === 'weapon'` 再筛一层 = 在产品侧写下**第二张表**，
 *      将来内容库加一件就要在第二处同步 —— 正是本项目反复吃过的漂移来源。
 *   ② Queue 对本部分的原文是「**至少**拥有 ★1 ×1」⇒ 超集满足要求。
 *   ③ 本 Queue 的目标段写的是「把仓库中已经存在的**正式内容**整理成可验证内容池」，
 *      不是「只整理武器」。既有的正式 Gadget（`pushRod` 已随 starter 拥有、
 *      `thruster` 未拥有）与 Weapon 共用同一个 `OFFICIAL_PARTS` 真源与**同一条**
 *      `behaviorRegistry` 注册表 ⇒ 分开发放只会人为制造两个近乎相同的集合。
 * ⚠️ 如实披露：因此实际新发的 7 件里有 **6 件 Weapon**（laser / rammer / saw /
 *    shotgun / machineGun / flamethrower）+ **1 件 Gadget**（thruster）。
 *    若要严格只发 Weapon，把 `R5_POOL_PART_IDS` 换成按 `registry.functionals`
 *    的 `category === 'weapon'` 过滤即可 —— 但那就是上面说的第二张表。
 *
 * ── 各件的真实 Runtime 状态（沿代码查，不是凭文档猜）────────────────────────
 * 真源 = `src/core/content.ts` 的 `behavior` 字段 + `src/battle/behaviorRegistry.ts`
 * 的 `FACTORIES` 注册表 + `src/battle/contactRouter.ts` 的两个伤害分支：
 *   - 弹丸类命中 → `behaviorParams.projectileDamage`（`contactRouter.ts:996`）；
 *   - 车身直击类 → `behaviorParams.baseDamage`（`contactRouter.ts:688`）。
 *   两条分支都只按**约定字段名**读 `part.def.behaviorParams`，**没有任何一处**
 *   对 `cannon` 做特判 ⇒ 所有已注册 behavior 的武器伤害链是**共用**的。
 *
 *   | defId        | name   | cat    | behavior     | behavior 已注册 | 伤害来源         |
 *   |--------------|--------|--------|--------------|-----------------|------------------|
 *   | cannon       | 炮     | weapon | cannon       | ✓               | projectileDamage |
 *   | hammer       | 锤     | weapon | hammer       | ✓               | baseDamage 90    |
 *   | spear        | 刺     | weapon | ram          | ✗（无 runtime） | baseDamage 60    |
 *   | laser        | 镭射   | weapon | laser        | ✓               | projectileDamage |
 *   | rammer       | 冲锤   | weapon | rammer       | ✓               | baseDamage 70    |
 *   | saw          | 圆锯   | weapon | saw          | ✓               | contactTick      |
 *   | shotgun      | 霰弹炮 | weapon | shotgun      | ✓               | projectileDamage |
 *   | machineGun   | 机枪   | weapon | machineGun   | ✓               | projectileDamage |
 *   | flamethrower | 喷火器 | weapon | flamethrower | ✓               | projectileDamage |
 *   | pushRod      | 推杆   | gadget | pushRod      | ✓               | 无（Gadget 天然绕过） |
 *   | thruster     | 推进器 | gadget | thruster     | ✓               | 无（Gadget 天然绕过） |
 *
 * ⚠️ `spear` 的 behavior `'ram'` **未注册**（`behaviorRegistry` 的 `FACTORIES` 里没有
 *    这一项）⇒ 它是「固定接触武器」，靠 collider 走 `baseDamage` 直击，**没有**
 *    behavior runtime。它已在 starter 里拥有（无需本种子补），本模块原样不动。
 *    `ramHead` / `lifter` / `testMass` / `wedgeShovel` **不在** `OFFICIAL_PARTS`
 *    （prototype/hold 与 Lab 件）⇒ 结构性发不出去，且 `addPart` 本身也会拒绝它们。
 *
 * ── 为什么这些件「能装能打、但不能进完整 Run」────────────────────────────────
 * **不是**本模块或它们自身的问题，而是 `product/runCompatibility.ts` 的
 * `FULL_RUN_SUPPORTED_WEAPON_IDS = ['cannon']` 这一条**产品裁决**：
 * 完整 Run 的强化注入（`runModifiers.applyRunModifiersToSnapshot`）以
 * `RUN_BASE_WEAPON_DEF_ID = 'cannon'` 为基准武器，装载里没有它时**按设计抛错**。
 * 在 Spear / Hammer 有正式 Run Build 内容之前，它们不得进入完整 Run。
 * ⇒ 本模块**只补库存**，**不**去放宽那条裁决（Queue 禁止项：不修改正式 Reward /
 *    不设计 Economy），因此**不会**改 `FULL_RUN_SUPPORTED_WEAPON_IDS`，
 *    也**不会**给任何一件新武器造 Run Buff。「用于后续 Queue 接入」由后续 Queue 做。
 *
 * ⚠️ **这不是正式 Reward / Economy / Unlock 设计**（Queue 明写「这不是正式 Economy /
 *    Reward」）。它是为了当前验证阶段而存在的**一次性**投放：判据一旦落盘就永久跳过，
 *    不参与任何发奖流程，真源始终是拥有状态 / 库存计数本身。
 *
 * ── 复用既有 migration / onboarding 架构 ────────────────────────────────────
 * 与 `./r2Onboarding` / `./r2Reseed` / `./r3MovementChoiceSeed` / `./r4BodyChoiceSeed`
 * **逐条同构**：产品侧自持 key + 版本号、「判定（纯读）→ 变更 → 落盘 → **最后**落标记」
 * 的严格顺序、标记的语义是「**决策**已做出」而不是「动作已执行」。
 *
 * ⚠️ **不复用**前四份标记：本标记表达的是第五件**独立的事实**
 *    （「这个账号的**正式内容池**已经安排过了」）—— Movement 种子管轮组计数、
 *    Body 种子管车身拥有标记、本模块**两个都管**（车身拥有 + 功能件计数）。
 *    混用一个 key 会让各自的不变量都无法单独审计 ⇒ 新 key
 *    `strongfruit.r5ContentPoolSeed.v1`。
 * ⚠️ **不动 `core/saveVersion.ts` 的全局版本号**：那是 `build` / `inventory` / `progress`
 *    与旧横屏游戏共用的存档格式版本，为一次产品验证投放抬高它会波及全部存档种类。
 *    信封 `__v` 仍复用既有 `stampVersion`（不新造第二套版本机制）。
 *    代价（如实披露，与前四份同型）：本 key **不在** `RESET_KEYS` 里 ⇒ DEV Reset
 *    不会清它（Reset 后本种子不会重跑）。因为它的语义是「这个账号的内容池起点已经
 *    安排过了」，Reset 不该把它当成「没安排过」—— 行为是刻意的、不是遗漏。
 *
 * ── 判据（下面两条**同时**成立才发放）──────────────────────────────────────
 *   ① **首入判定尚未做出过**（磁盘上没有本模块的版本标记）；
 *   ② 两个集合里存在**至少一项**「当前未拥有」（车身未拥有 / 功能件 ★1 计数 < 1）。
 * 成立 ⇒ 把两个集合里**缺的那些**补齐（只补缺的；已拥有的**原样不动**）。
 *
 * ⚠️ **判定只能做一次**（`decided`）—— 落标记的判据是 `decided`（**决策**已做出），
 *    **不是** `applied`（动作已执行）。理由与前两份种子同源：判据 ② 读的是**会被玩家
 *    自己改变的状态**（玩家可以自己经 debug 取消车身拥有、也可以把某件武器合成掉）。
 *    若走「一个都不动出口不落标记」的写法，会出现这条**真实的重跑路径**：
 *      首入时内容池已满（`already-complete`，不落标记）→ 玩家随后自己消耗掉某件
 *      → **下一次**挂载判据 ② 又成立 ⇒ 玩家自己用掉的东西被重新发一遍。
 *    ⇒ 首入判定一旦做出就永久落定，此后任何挂载只看标记、不再重判。
 *
 * ⚠️ 本模块**没有** `equip-failed` 那一类「可重试的瞬时失败」：它的写动作只有
 *    `grantBody`（纯标记累加，幂等）与内存里的 `addPart`，既不写 Build、
 *    也不过 `validateSnapshot` ⇒ 不存在「动作被正式校验拒绝」的形态。
 *
 * ── 硬边界（Queue 必改 / 禁止清单）───────────────────────────────────────────
 *   - **只增不减**：写动作只有 `grantBody`（内部追加未拥有项）与 `addPart`
 *     （只做 `max(0, 保底 − 现有)` 的补齐）。没有 `revoke`、不删除任何 key、
 *     不归零、**绝不覆盖或清空任何现有条目**。已经满内容的账号走 `already-complete`
 *     出口 ⇒ **一个字节都不写**。
 *   - **不发 ★2+**（Queue 第四部分）：唯一写动作是 `addPart(inv, id, R5_POOL_STAR = 1, …)`
 *     ⇒ ★2..★5 五档里只有 ★1 会被碰，高星档结构上不可能被本模块抬高。
 *   - **不改任何数值**：本模块不读也不写任何 Body / Movement / Weapon 的数值字段
 *     （hp / baseMass / energyCapacity / damage / energy / 合成规则），一个都没有。
 *   - **不碰 BuildDraft**：本模块**一个字节都不写** Build ⇒ 「不自动替玩家换车身 /
 *     不重置当前 weapon / rear / front」是**结构性成立**的，不靠人工核对
 *     ⇒ Run Snapshot / Runtime 数值与调用前逐字节相同（不改变战斗行为）。
 *   - **不新建第二套记录**：车身拥有仍写在 core 那**唯一一份**
 *     `strongfruit.ownedBodies.v1`（经 `grantBody` / `isBodyOwned`）；
 *     功能件计数仍写在**唯一一份** `strongfruit.ownedParts.v2`（经 `addPart` / `getCount`）。
 *   - **不新增内容**：本模块的两个集合**全部现读自** core 真源，不写第二张 id 表、
 *     不造新 id ⇒ 内容库加一件，这里自动跟上。
 *   - **不加入 COMPLETE Reward Pool / 不新增 Shop·Economy / 不新增 Reset 按钮**：
 *     本模块既不读也不写奖励池与任何经济相关 key，也不改 `FULL_RUN_SUPPORTED_WEAPON_IDS`。
 */

import { NEW_OFFICIAL_BODIES, grantBody, isBodyOwned } from '../core/bodyOwnership';
import { OFFICIAL_PARTS, addPart, getCount, type PartInventory } from '../core/partInventory';
import { readJsonWithVersion, stampVersion } from '../core/saveVersion';
import { platform } from '../platform';

/**
 * **本轮投入验证的全部正式车身** = `NEW_OFFICIAL_BODIES`（4 台需要解锁的新正式车身）。
 *
 * ⚠️ 直接取真源本身，**不写第二张表**、**不 filter 出子集**：
 *    R4 的 `MVP_BODY_CHOICE_IDS` 是**刻意收窄**的验证面（只发 2 台）；
 *    R5 的开发阶段目标是「铺基础内容」⇒ 收窄的前提消失，集合回到全集。
 *    `NEW_OFFICIAL_BODIES` 一变，这里**自动跟上**（这正是要的效果）。
 * ⚠️ 旧 4 台（`DEFAULT_OWNED_BODIES`）**不在**本集合里，也**不需要**：
 *    它们恒默认拥有（`isBodyOwned` 对它们恒 true），本模块结构上碰不到它们
 *    ⇒ 「旧车身不落拥有集合」这条既有语义不被破坏。
 */
export const R5_POOL_BODY_IDS: readonly string[] = NEW_OFFICIAL_BODIES;

/**
 * **本轮投入验证的全部正式 Functional** = `OFFICIAL_PARTS`（`PART_OPTIONS` 去 EMPTY）。
 *
 * ⚠️ 与 Body 那条同一条纪律：直接取真源本身，不筛 weapon、不写第二张表。
 *    为什么取全集而不是「只取 Weapon」见模块头「为什么 Functional 集合取
 *    `OFFICIAL_PARTS`」那段（含 1 件 Gadget 的如实披露）。
 */
export const R5_POOL_PART_IDS: readonly string[] = OFFICIAL_PARTS;

/**
 * 每件需要库存的 Functional 的**保底件数** = **1**。
 *
 * ⚠️ 它不是一个可以「配」的参数，而是 Queue 第四部分原文「**至少拥有 ★1 ×1**」
 *    的最小落地：目的是让每件都**可装备、可进 Snapshot、可进 Battle**，
 *    而不是把验证账号养到「不缺件」。
 *    已拥有的件**只增不减**（`have >= 1` ⇒ 完全不动），因此它**不可能**降低任何计数。
 */
export const R5_POOL_MIN_COUNT = 1;

/**
 * 发放星级 = **★1**（Queue 第四部分明文「不要发 ★2+」「不要设计新成长规则」）。
 *
 * 这个 `1` 与 `PartInventory` 的数据模型第一档（`starKey(1) === 'one'`、
 * `getCount(inv, id, 1)`）是**同一件事**，不是新造的星级规则
 * （与 `movementInventory.MOVEMENT_STAR` / `playerLoadout.WEAPON_GROWTH_STAR`
 *  同型：它们是产品侧的**选择**常量，不是第二份规则真源）。
 */
export const R5_POOL_STAR = 1;

/**
 * 本种子的持久化 key（产品侧自己的 key，与 `profileClaims.v1` / `r2Onboarding.v1` /
 * `r2Reseed.v1` / `r3MovementChoiceSeed.v1` / `r4BodyChoiceSeed.v1` 同型）。
 *
 * ⚠️ **不复用**前四份既有标记：见模块头「五件独立的事实」那段。
 */
export const R5_CONTENT_POOL_KEY = 'strongfruit.r5ContentPoolSeed.v1';

/**
 * 本种子的版本号（= 「这一次投放」的身份）。
 *
 * ⚠️ **不是** `core/saveVersion.CURRENT_SAVE_VERSION`（那是全局存档格式版本，见模块头）。
 *    将来若要再发一次不同范围的一次性内容池投放，把这里 +1 即可 ——
 *    判据是 `record.version >= R5_CONTENT_POOL_VERSION`，旧标记自动失效并重跑一次。
 */
export const R5_CONTENT_POOL_VERSION = 1;

/** 落盘的记录（最小：只有一个版本号，不含时间戳 / 次数 / 玩家标识）。 */
export interface R5ContentPoolRecord {
  readonly version: number;
}

/**
 * 判定（或执行）结果 —— 探针 / 测试 / 页面文案都读它，不各自再判一次。
 *
 * `reason` 覆盖**所有**互斥出口（`applied === true` 有且只有 `'seeded'`）：
 *   - `'seeded'`            —— 判据成立且真的补了内容；
 *   - `'already-marked'`    —— 首入判定此前已经做出过（reload 后的形态，`decided = false`）；
 *   - `'already-complete'`  —— 两个集合**都已经拥有**（`applied = false`，但 `decided = true`）。
 */
export type R5ContentPoolReason = 'seeded' | 'already-marked' | 'already-complete';

/** 一台车身的补发读数（对账 / 探针 / 测试共用，不各自展开拥有状态形状）。 */
export interface R5BodyEntry {
  readonly defId: string;
  /** 本次挂载前是否已拥有 */
  readonly ownedBefore: boolean;
  /** 本次挂载后是否已拥有（grant 幂等 ⇒ 已拥有的不变、未拥有的变 true） */
  readonly ownedAfter: boolean;
  /** 本次为它新解锁了几台（`0` = 本来就有 ⇒ 一个字节都没动）。 */
  readonly raised: number;
}

/** 一件 Functional 的补件读数（对账 / 探针 / 测试共用）。 */
export interface R5PartEntry {
  readonly defId: string;
  /** ★1 档在本次挂载前有几件 */
  readonly countBefore: number;
  /** ★1 档在本次挂载后有几件 */
  readonly countAfter: number;
  /** 本次为它补了几件（`0` = 本来就有 ⇒ 一个字节都没动）。 */
  readonly raised: number;
}

/** 判定 + 执行合一的读数。 */
export interface R5ContentPoolOutcome {
  /** 本次**真的**补了内容（车身或功能件任一被抬高）⇒ 调用方据此报「本轮发放了」。 */
  readonly applied: boolean;
  readonly reason: R5ContentPoolReason;
  /**
   * 本次**库存**（`strongfruit.ownedParts.v2`）是否被改过 ⇒ 调用方据此决定要不要
   * `saveInventory`。
   *
   * ⚠️ 与 `applied` **不是同一件事**，刻意分开：车身那一半经 `grantBody` **自己落盘**
   *    （core 自己的 key），只有功能件这一半需要调用方落盘。混成一个字段会让
   *    「车身补了、库存没变」的挂载多出一次无谓的 `saveInventory`。
   */
  readonly inventoryChanged: boolean;
  /**
   * 本次挂载是否做出了「**首入**判定」⇒ 调用方据此落**本种子的标记**（只此一次）。
   *
   * ⚠️ 语义是「**决策**已做出」，**不是**「动作已执行」：
   *    - `already-marked`   ⇒ `false`（这次不是首入，标记本来就在，不必再写）；
   *    - `already-complete` ⇒ `true` —— **必须落标记**，否则玩家自己之后消耗掉某一件时，
   *      下一次挂载判据 ② 会重新成立、把玩家自己用掉的东西再发一遍；
   *    - `seeded`           ⇒ `true`（`applied === true`）。
   */
  readonly decided: boolean;
  /** 逐件车身读数（顺序 = `R5_POOL_BODY_IDS` 的顺序，稳定）。 */
  readonly bodies: readonly R5BodyEntry[];
  /** 逐件功能件读数（顺序 = `R5_POOL_PART_IDS` 的顺序，稳定）。 */
  readonly parts: readonly R5PartEntry[];
  /** 本次新解锁了几台车身（`bodies` 的 `raised` 求和）。 */
  readonly raisedBodies: number;
  /** 本次补了几件功能件（`parts` 的 `raised` 求和）。 */
  readonly raisedParts: number;
}

/** 读种子标记（无标记 / 解析失败 / 形状非法 → `null`，绝不抛）。 */
export function readR5ContentPoolSeed(): R5ContentPoolRecord | null {
  let raw: string | null = null;
  try {
    raw = platform.storage.getItem(R5_CONTENT_POOL_KEY);
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

/** 本种子是否已经执行过（幂等判据）。 */
export function isR5ContentPoolDone(): boolean {
  const rec = readR5ContentPoolSeed();
  return rec !== null && rec.version >= R5_CONTENT_POOL_VERSION;
}

/**
 * 写种子标记（写入失败静默忽略 —— 与既有存档模块同一纪律：隐私模式 / 配额不影响本局游戏）。
 *
 * ⚠️ 调用方必须在**库存已经落盘之后**再调它（见 `openGrowthSession` 的顺序说明）：
 *    顺序写反（先打标记后落盘）会让「配额写失败」这一种情况变成
 *    「标记说发过了、功能件却一件没补」—— 玩家从此永远拿不到那些件。
 *    ⚠️ 车身那一半经 `grantBody` **自己落盘**，不依赖这一步；受影响的是功能件那一半。
 */
export function markR5ContentPoolSeed(): void {
  try {
    platform.storage.setItem(
      R5_CONTENT_POOL_KEY,
      JSON.stringify(stampVersion({ version: R5_CONTENT_POOL_VERSION })),
    );
  } catch {
    // 写入失败静默忽略：下次挂载会重试（标记没落盘 ⇒ 判据仍成立）
  }
}

/**
 * **纯判定 + 执行**（合一是刻意的，理由见下）：算出这次挂载该不该补内容、补哪些，
 * 并把改动做到位（车身走 `grantBody` 立即落盘；功能件只改**内存**里的 `inv`，
 * 不落盘、不打标记 —— 那两件事由调用方按序做）。
 *
 * ⚠️ 为什么不拆成 `plan` / `apply` 两个函数（与 `r2Onboarding` / `r2Reseed` 的做法不同）：
 *    那两个模块要拆，是因为**执行**里有「可能被正式校验拒绝」的动作（`equipWeapon`），
 *    需要把「判定」与「可失败的动作」分开，让调用方能按 `plan` 决定要不要走到那一步。
 *    本模块**没有可失败的动作** —— 写动作只有幂等的 `grantBody` 与纯内存的 `addPart`
 *    ⇒ 拆开的两个函数之间只会多出一份「同一件事的两种表达」。
 *    落盘 / 打标记的顺序仍然由调用方掌握，这正是那条顺序要求真正依赖的东西。
 *
 * ⚠️ 返回的 `bodies` / `parts` 是**补发之后**的真实读数（`ownedAfter` 现读自
 *    `isBodyOwned`、`countAfter` 现读自 `getCount`），因此调用方可以直接拿它当
 *    「本次挂载结束时的形态」用，不必再读一次盘。
 *
 * ⚠️ `already-marked` / `already-complete` 两个出口对拥有状态与库存是**纯空操作**
 *    （不触碰任何一台车身、不触碰任何一档计数）。
 */
export function applyR5ContentPoolSeed(inv: PartInventory): R5ContentPoolOutcome {
  /** 快照一次读数 —— 边读边写会读到半成品形态（`getCount` 每次都重算）。 */
  const bodyBefore = R5_POOL_BODY_IDS.map((defId) => ({ defId, owned: isBodyOwned(defId) }));
  const partBefore = R5_POOL_PART_IDS.map((defId) => ({
    defId,
    count: getCount(inv, defId, R5_POOL_STAR),
  }));

  const readOut = (
    reason: R5ContentPoolReason,
    decided: boolean,
  ): R5ContentPoolOutcome => ({
    applied: false,
    reason,
    inventoryChanged: false,
    decided,
    bodies: bodyBefore.map((b) => ({
      defId: b.defId,
      ownedBefore: b.owned,
      ownedAfter: b.owned,
      raised: 0,
    })),
    parts: partBefore.map((p) => ({
      defId: p.defId,
      countBefore: p.count,
      countAfter: p.count,
      raised: 0,
    })),
    raisedBodies: 0,
    raisedParts: 0,
  });

  // ① 首入判定此前已经做出过 ⇒ 永久跳过（reload 不会再补，也不再重判）
  if (isR5ContentPoolDone()) {
    return readOut('already-marked', false);
  }

  // ② 两个集合都已经拥有 ⇒ 无事可做；**仍然要落标记**（见 `decided` 的说明）
  const bodyDone = bodyBefore.every((b) => b.owned);
  const partDone = partBefore.every((p) => p.count >= R5_POOL_MIN_COUNT);
  if (bodyDone && partDone) {
    return readOut('already-complete', true);
  }

  // ③ 车身：把「未拥有」的永久解锁（幂等：已拥有的原样不动；grantBody 自己落盘）
  for (const defId of R5_POOL_BODY_IDS) {
    grantBody(defId);
  }
  const bodies: R5BodyEntry[] = R5_POOL_BODY_IDS.map((defId) => {
    const ownedNow = isBodyOwned(defId);
    const beforeOwned = bodyBefore.find((b) => b.defId === defId)?.owned ?? false;
    return {
      defId,
      ownedBefore: beforeOwned,
      ownedAfter: ownedNow,
      raised: ownedNow && !beforeOwned ? 1 : 0,
    };
  });

  // ④ 功能件：把「★1 计数 < 保底件数」的补齐（已有的档一个字节都不动；只改内存）
  const parts: R5PartEntry[] = [];
  for (const p of partBefore) {
    const raise = Math.max(0, R5_POOL_MIN_COUNT - p.count);
    if (raise > 0) addPart(inv, p.defId, R5_POOL_STAR, raise);
    parts.push({
      defId: p.defId,
      countBefore: p.count,
      countAfter: getCount(inv, p.defId, R5_POOL_STAR),
      raised: raise,
    });
  }

  const raisedBodies = bodies.reduce((sum, e) => sum + e.raised, 0);
  const raisedParts = parts.reduce((sum, e) => sum + e.raised, 0);
  return {
    applied: raisedBodies > 0 || raisedParts > 0,
    reason: 'seeded',
    inventoryChanged: raisedParts > 0,
    decided: true,
    bodies,
    parts,
    raisedBodies,
    raisedParts,
  };
}
