/**
 * PRODUCT-LOOP-R3-MOVEMENT-CHOICE-SEED｜**一次性 Movement 可选方案种子**。
 *
 * ── 为什么需要它（真人的第五条反馈）────────────────────────────────────────────
 * R3 的 Movement Foundation 在技术层面已经**完全贯通**：canonical 内容 / 永久库存 /
 * Garage 展示 / rear·front 独立装备 / persisted BuildDraft / Run encoded Snapshot /
 * Runtime 消费，六段链路逐段有测试钉着。但当真人打开 Garage 时看到的是：
 *     **标准轮（缺省，恒默认）+ smallWheel / largeWheel / heavyWheel 全部「未拥有」**
 * ⇒ 这条维度只能被**感知**（「啊，有个轮子系统」），却无法被**使用**
 * （「比较 → 选择 → 改配置」三步一步都做不了）。
 * 问题不是系统失效，而是**没有第二个可选方案**。
 *
 * ── 本模块的形状（Queue 必改 1~4 逐条落地）──────────────────────────────────
 * 一次性、版本化、**只碰 Movement 库存**的种子：首次满足条件时把三档需要库存的
 * Movement 各补到 **至少 1 件**（`smallWheel ×1` / `largeWheel ×1` / `heavyWheel ×1`）。
 *
 * ⚠️ **这不是正式 Reward / Economy / Unlock 设计**（Queue 明写）。它是为了当前
 *    MVP / R3 真人验证而存在的**一次性**投放：判据一旦落盘就永久跳过，
 *    不参与任何发奖流程，也**不会**被将来的正式经济复用（真源始终是库存计数本身）。
 *
 * ── 复用既有 migration / onboarding 架构（必改 1）────────────────────────────
 * 与 `./r2Onboarding` / `./r2Reseed` **逐条同构**：产品侧自持 key + 版本号、
 * 「判定（纯读）→ 变更（仅内存）→ 落盘 → **最后**落标记」的严格顺序、
 * 标记的语义是「**决策**已做出」而不是「动作已执行」。
 *
 * ⚠️ **不复用** `strongfruit.r2Onboarding.v1` / `strongfruit.r2Reseed.v1`：
 *    「这次的种子该不该发」与那两件事（补 cannon 到 4 / 清 cannon ★≥2）是**三个独立的
 *    事实**，语义也不同（那两个一个只增不减、一个必须删除；本模块只增不减但**有目标件数**）。
 *    混用一个 key 会让各自的不变量都无法单独审计 ⇒ 新 key `strongfruit.r3MovementChoiceSeed.v1`。
 * ⚠️ **不动 `core/saveVersion.ts` 的全局版本号**：那是 `build` / `inventory` / `progress`
 *    与旧横屏游戏共用的存档格式版本，为一次产品验证投放抬高它会波及全部存档种类。
 *    信封 `__v` 仍复用既有 `stampVersion`（不新造第二套版本机制）。
 *    代价（如实披露，与 `r2Onboarding` / `profileClaims.v1` 同型）：本 key **不在**
 *    `RESET_KEYS` 里 ⇒ DEV Reset 不会清它（Reset 后本种子不会重跑）。因为它的语义是
 *    「这个账号的选择起点已经安排过了」，Reset 不该把它当成「没安排过」——
 *    行为是刻意的、不是遗漏。
 *
 * ── 判据（下面两条**同时**成立才补件）────────────────────────────────────────
 *   ① **首入判定尚未做出过**（磁盘上没有本模块的版本标记）；
 *   ② 存在**至少一件**「需要库存、但当前计数为 0」的正式 Movement。
 * 成立 ⇒ 把这**三档**各补到 `≥ 1`（只补「计数为 0」的那些；已有的**原样不动**）。
 *
 * ⚠️ **判定只能做一次**（`decided`）—— 落标记的判据是 `decided`（**决策**已做出），
 *    **不是** `applied`（动作已执行）。理由与 `r2Reseed` 那条同源但更温和：
 *    判据 ② 读的是**会被玩家自己改变的库存**（玩家可以自己合出 / 消耗轮组）。
 *    若走「四个不动出口不落标记」的写法，会出现下面这条**真实的重跑路径**：
 *      首入时三档都已拥有（`already-owned`，不落标记）→ 玩家随后把 heavyWheel 当材料
 *      用掉 → **下一次**挂载判据 ② 又成立 ⇒ 玩家自己消耗掉的东西被重新发一遍。
 *    ⇒ 首入判定一旦做出就永久落定，此后任何挂载只看标记、不再重判。
 *
 * ⚠️ 本模块**没有** `equip-failed` 那一类「可重试的瞬时失败」：它的唯一写动作是
 *    `addPart`（纯内存计数累加），既不写 Build、也不过 `validateSnapshot`
 *    ⇒ 不存在「动作被正式校验拒绝」的形态。（对比 `r2Reseed`：它要换装，
 *    所以必须有那一条 —— 本模块**刻意不装备**，见下。）
 *
 * ── 硬边界（Queue 必改 3 / 必改 4 + 禁止清单）───────────────────────────────
 *   - **只增不减**：唯一的写动作是 `addPart(..., +1)` —— 没有 `consume`、
 *     不删除任何 key、不归零、**绝不覆盖或清空任何现有条目**（必改 3）。
 *     一个全新账号 / 已经全拥有的账号走 `already-owned` 出口 ⇒ **一个字节都不写**。
 *   - **只影响 Movement inventory**（必改 4）：唯一的写目标 id 来自
 *     `OFFICIAL_MOVEMENTS`，Weapon / Body / Gadget 的计数一个字节都不动。
 *   - **不碰 BuildDraft**：本模块**一个字节都不写** Build ⇒ 「不自动替玩家装备新轮子」
 *     与「不重置当前 rear / front」是**结构性成立**的，不靠人工核对
 *     ⇒ Run Snapshot / Runtime 数值与调用前逐字节相同（不改变战斗行为）。
 *   - **不新建第二套库存**：拥有状态仍写在 core 那**唯一一份**
 *     `strongfruit.ownedParts.v2`（经 `addPart` / `getCount`），与 Weapon 共用。
 *   - **不添加新 Movement 类型 / 不改任何 Movement 数值**：本模块的 id 全部现读自
 *     `OFFICIAL_MOVEMENTS`（core 的真源），**不写第二张表**、不写字面量 id
 *     ⇒ 内容库加一件，这里自动跟上；`smallWheel` 之类**不**在本模块里出现为常量。
 *   - **不加入 COMPLETE Reward Pool / 不新增 Shop·Economy / 不新增 Reset 按钮**：
 *     本模块既不读也不写奖励池与任何经济相关 key。
 *   - **缺省轮保持原有 implicit / default 语义**（必改 2）：它**不进库存**
 *     （`needsInventory === false`），因此本模块**结构上不可能**给它补件 ——
 *     遍历的 `OFFICIAL_MOVEMENTS` 里本来就没有它。
 */

import { OFFICIAL_MOVEMENTS, addPart, getCount, type PartInventory } from '../core/partInventory';
import { readJsonWithVersion, stampVersion } from '../core/saveVersion';
import { platform } from '../platform';
import { MOVEMENT_STAR } from './movementInventory';

/**
 * 本种子的持久化 key（产品侧自己的 key，与 `profileClaims.v1` / `r2Onboarding.v1` /
 * `r2Reseed.v1` 同型）。
 *
 * ⚠️ **不复用**那两份既有标记：见模块头「三个独立的事实」那段。它们各自表达
 *    「这个账号的 R2 起点已经安排过了」/「这个账号已经做过新一轮 reseed」，
 *    而本标记表达的是第三件事：「这个账号的 Movement **选择起点**已经安排过了」。
 */
export const R3_MOVEMENT_SEED_KEY = 'strongfruit.r3MovementChoiceSeed.v1';

/**
 * 本种子的版本号（= 「这一次投放」的身份）。
 *
 * ⚠️ **不是** `core/saveVersion.CURRENT_SAVE_VERSION`（那是全局存档格式版本，见模块头）。
 *    将来若要再发一次不同起点的一次性 Movement 投放，把这里 +1 即可 ——
 *    判据是 `record.version >= R3_MOVEMENT_SEED_VERSION`，旧标记自动失效并重跑一次。
 */
export const R3_MOVEMENT_SEED_VERSION = 1;

/**
 * 每件需要库存的 Movement 的**保底件数** = **1**。
 *
 * ⚠️ 它不是一个可以「配」的参数，而是 Queue 原文「至少拥有 1 件」的最小落地：
 *    目的是让三档都**可比较、可选择**，而不是把玩家养到「不缺件」。
 *    已拥有的档**只增不减**（`have >= 1` ⇒ 完全不动），因此它**不可能**降低任何计数。
 */
export const R3_MOVEMENT_SEED_MIN_COUNT = 1;

/** 落盘的记录（最小：只有一个版本号，不含时间戳 / 次数 / 玩家标识）。 */
export interface R3MovementSeedRecord {
  readonly version: number;
}

/**
 * 判定（或执行）结果 —— 探针 / 测试 / 页面文案都读它，不各自再判一次。
 *
 * `reason` 覆盖**所有**互斥出口（`applied === true` 有且只有 `'seeded'`）：
 *   - `'seeded'`          —— 判据成立且真的补了件；
 *   - `'already-marked'`  —— 首入判定此前已经做出过（reload 后的形态，`decided = false`）；
 *   - `'already-owned'`   —— 三档**都已经至少 1 件**（`applied = false`，但 `decided = true`）。
 */
export type R3MovementSeedReason = 'seeded' | 'already-marked' | 'already-owned';

/** 一件 Movement 的补件读数（对账 / 探针 / 测试共用，不各自展开库存形状）。 */
export interface R3MovementSeedEntry {
  readonly defId: string;
  readonly countBefore: number;
  readonly countAfter: number;
  /** 本次为它补了几件（`0` = 本来就有 ⇒ 一个字节都没动）。 */
  readonly raised: number;
}

/** 判定 + 执行合一的读数。 */
export interface R3MovementSeedOutcome {
  /** 本次**真的**补了件（⇒ 调用方据此把 `changed` 置真、触发落盘）。 */
  readonly applied: boolean;
  readonly reason: R3MovementSeedReason;
  /**
   * 本次挂载是否做出了「**首入**判定」⇒ 调用方据此落**本种子的标记**（只此一次）。
   *
   * ⚠️ 语义是「**决策**已做出」，**不是**「动作已执行」：
   *    - `already-marked` ⇒ `false`（这次不是首入，标记本来就在，不必再写）；
   *    - `already-owned` ⇒ `true` —— **必须落标记**，否则玩家自己之后消耗掉某一件时，
   *      下一次挂载判据 ② 会重新成立、把玩家自己消耗掉的东西再发一遍（真实丢档路径的反向）；
   *    - `seeded` ⇒ `true`（`applied === true`）。
   */
  readonly decided: boolean;
  /** 逐件读数（顺序 = `OFFICIAL_MOVEMENTS` 的顺序，稳定）。 */
  readonly entries: readonly R3MovementSeedEntry[];
  /** 本次补了几件（`entries` 的 `raised` 求和，便于直接断言）。 */
  readonly raised: number;
}

/** 读种子标记（无标记 / 解析失败 / 形状非法 → `null`，绝不抛）。 */
export function readR3MovementSeed(): R3MovementSeedRecord | null {
  let raw: string | null = null;
  try {
    raw = platform.storage.getItem(R3_MOVEMENT_SEED_KEY);
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
export function isR3MovementSeedDone(): boolean {
  const rec = readR3MovementSeed();
  return rec !== null && rec.version >= R3_MOVEMENT_SEED_VERSION;
}

/**
 * 写种子标记（写入失败静默忽略 —— 与既有存档模块同一纪律：隐私模式 / 配额不影响本局游戏）。
 *
 * ⚠️ 调用方必须在**库存已经落盘之后**再调它（见 `openGrowthSession` 的顺序说明）：
 *    顺序写反（先打标记后落盘）会让「配额写失败」这一种情况变成
 *    「标记说发过了、库存却一件没补」—— 玩家从此永远拿不到那三件。
 */
export function markR3MovementSeed(): void {
  try {
    platform.storage.setItem(
      R3_MOVEMENT_SEED_KEY,
      JSON.stringify(stampVersion({ version: R3_MOVEMENT_SEED_VERSION })),
    );
  } catch {
    // 写入失败静默忽略：下次挂载会重试（标记没落盘 ⇒ 判据仍成立）
  }
}

/**
 * **纯判定 + 执行**（合一是刻意的，理由见下）：算出这次挂载该不该补件、补哪几件，
 * 并把**内存里**的库存改到位（不落盘、不打标记 —— 那两件事由调用方按序做）。
 *
 * ⚠️ 为什么不拆成 `plan` / `apply` 两个函数（与 `r2Onboarding` / `r2Reseed` 的做法不同）：
 *    那两个模块要拆，是因为**执行**里有「可能被正式校验拒绝」的动作（`equipWeapon`），
 *    需要把「判定」与「可失败的动作」分开，让调用方能按 `plan` 决定要不要走到那一步。
 *    本模块**没有可失败的动作** —— 唯一写动作是纯内存的 `addPart`（不落盘、不校验）
 *    ⇒ 拆开的两个函数之间只会多出一份「同一件事的两种表达」，反而给未来留下
 *    「plan 说 A、apply 做 B」的分叉空间。落盘 / 打标记的顺序仍然由调用方掌握，
 *    这正是那条顺序要求真正依赖的东西。
 *
 * ⚠️ 返回的 `entries` 是**补件之后**的真实读数（`countAfter` 现读自 `inv`），
 *    因此调用方可以直接拿它当「本次挂载结束时的形态」用，不必再读一次盘。
 *
 * ⚠️ `plan.raised === 0` 时本函数对库存是**纯空操作**（`already-marked` / `already-owned`
 *    两个出口都不会触碰任何一个计数）。
 */
export function applyR3MovementChoiceSeed(inv: PartInventory): R3MovementSeedOutcome {
  /** 快照一次读数 —— 边读边写会读到半成品形态（`getCount` 每次都重算）。 */
  const before = OFFICIAL_MOVEMENTS.map((defId) => ({
    defId,
    count: getCount(inv, defId, MOVEMENT_STAR),
  }));

  const readOut = (
    reason: R3MovementSeedReason,
    decided: boolean,
    raised: readonly R3MovementSeedEntry[],
  ): R3MovementSeedOutcome => ({
    applied: false,
    reason,
    decided,
    entries: raised,
    raised: 0,
  });

  // ① 首入判定此前已经做出过 ⇒ 永久跳过（reload 不会再补，也不再重判）
  if (isR3MovementSeedDone()) {
    return readOut(
      'already-marked',
      false,
      before.map((b) => ({ defId: b.defId, countBefore: b.count, countAfter: b.count, raised: 0 })),
    );
  }

  // ② 三档都已经至少 1 件 ⇒ 无事可做；**仍然要落标记**（见 `decided` 的说明）
  const allOwned = before.every((b) => b.count >= R3_MOVEMENT_SEED_MIN_COUNT);
  if (allOwned) {
    return readOut(
      'already-owned',
      true,
      before.map((b) => ({ defId: b.defId, countBefore: b.count, countAfter: b.count, raised: 0 })),
    );
  }

  // ③ 补「计数 < 保底件数」的那些（已有的档一个字节都不动）
  const entries: R3MovementSeedEntry[] = [];
  for (const b of before) {
    const raise = Math.max(0, R3_MOVEMENT_SEED_MIN_COUNT - b.count);
    if (raise > 0) addPart(inv, b.defId, MOVEMENT_STAR, raise);
    entries.push({
      defId: b.defId,
      countBefore: b.count,
      countAfter: getCount(inv, b.defId, MOVEMENT_STAR),
      raised: raise,
    });
  }
  return {
    applied: true,
    reason: 'seeded',
    decided: true,
    entries,
    raised: entries.reduce((sum, e) => sum + e.raised, 0),
  };
}
