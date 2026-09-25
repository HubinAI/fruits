/**
 * PRODUCT-LOOP-R4-BODY-CANONICAL-AND-GARAGE-MVP｜**一次性 Body 可选方案种子**。
 *
 * ── 为什么需要它（与 R3 Movement 种子同构的动机）────────────────────────────
 * R4 的 Body Foundation 在技术层面已经**完全贯通**：canonical 内容 / 永久拥有 /
 * Garage 展示 / persisted BuildDraft / Run Snapshot / Runtime 消费，链路逐段可证。
 * 但当真人打开 Garage 时看到的是：
 *     **旧 4 台恒默认拥有 + 新 4 台（榴莲/梨子/芒果/橙子）全部「未拥有」**
 * ⇒ 这条维度只能被**感知**（「啊，有个车身系统」），却无法被**使用**
 * （「比较 → 选择 → 改配置」三步一步都做不了）。
 * 问题不是系统失效，而是**没有第二个可选方案**。
 *
 * ── 本模块的形状（与 R3 Movement 种子逐条同构）──────────────────────────────
 * 一次性、版本化、**只碰 Body 拥有状态**的种子：首次满足条件时把 **MVP 最小验证集合**
 * （`MVP_BODY_CHOICE_IDS`，2 台新增正式车身）各**永久解锁**
 * （经 `grantBody`，幂等落盘到 `strongfruit.ownedBodies.v1`）。
 * **不是**把全部 4 台新增车身一次性发完（见 `MVP_BODY_CHOICE_IDS` 的选择依据）。
 *
 * ⚠️ **这不是正式 Reward / Economy / Unlock 设计**（Queue 明写）。它是为了当前
 *    MVP / R4 真人验证而存在的**一次性**投放：判据一旦落盘就永久跳过，
 *    不参与任何发奖流程，也**不会**被将来的正式经济复用（真源始终是拥有状态本身）。
 *
 * ── 复用既有 migration / onboarding 架构 ────────────────────────────────────
 * 与 `./r2Onboarding` / `./r2Reseed` / `./r3MovementChoiceSeed` **逐条同构**：
 *    产品侧自持 key + 版本号、

 *    「判定（纯读）→ 变更（仅内存/仅本 key）→ 落盘 → **最后**落标记」的严格顺序、
 *    标记的语义是「**决策**已做出」而不是「动作已执行」。
 *
 * ⚠️ **不复用** `strongfruit.r3MovementChoiceSeed.v1` / `strongfruit.r2Onboarding.v1`
 *    / `strongfruit.r2Reseed.v1`：这是第四件**独立的事实**
 *    （「这个账号的 Body 选择起点已经安排过了」），语义与前三者都不同
 *    （Movement 种子管的是「轮组库存计数」、本模块管的是「车身拥有标记」）。
 *    混用一个 key 会让各自的不变量都无法单独审计 ⇒ 新 key `strongfruit.r4BodyChoiceSeed.v1`。
 * ⚠️ **不动 `core/saveVersion.ts` 的全局版本号**：那是 `build` / `inventory` / `progress`
 *    与旧横屏游戏共用的存档格式版本，为一次产品验证投放抬高它会波及全部存档种类。
 *    信封 `__v` 仍复用既有 `stampVersion`（不新造第二套版本机制）。
 *    代价（如实披露，与 `r2Onboarding` / `profileClaims.v1` 同型）：本 key **不在**
 *    `RESET_KEYS` 里 ⇒ DEV Reset 不会清它（Reset 后本种子不会重跑）。因为它的语义是
 *    「这个账号的 Body 选择起点已经安排过了」，Reset 不该把它当成「没安排过」——
 *    行为是刻意的、不是遗漏。
 *
 * ── 判据（下面两条**同时**成立才补件）────────────────────────────────────────
 *   ① **首入判定尚未做出过**（磁盘上没有本模块的版本标记）；
 *   ② 存在**至少一台**「需要解锁、但当前未拥有」的 MVP 车身。
 * 成立 ⇒ 把 MVP 集合里的车身**全部**永久解锁（只补「未拥有」的那些；已拥有的**原样不动**）。
 *
 * ⚠️ **判定只能做一次**（`decided`）—— 落标记的判据是 `decided`（**决策**已做出），
 *    **不是** `applied`（动作已执行）。理由与 `r3MovementChoiceSeed` 同源：
 *    判据 ② 读的是**会被玩家自己改变的拥有状态**（玩家可以自己经 debug 解锁车身）。
 *    若走「一个都不动出口不落标记」的写法，会出现这条**真实的重跑路径**：
 *      首入时 MVP 车身都已拥有（`already-owned`，不落标记）→ 玩家随后把某台车身在 debug 里
 *      取消拥有 → **下一次**挂载判据 ② 又成立 ⇒ 玩家自己取消的拥有被重新发一遍。
 *    ⇒ 首入判定一旦做出就永久落定，此后任何挂载只看标记、不再重判。
 *
 * ⚠️ 本模块**没有** `equip-failed` 那一类「可重试的瞬时失败」：它的唯一写动作是
 *    `grantBody`（纯标记累加，幂等），既不写 Build、也不过 `validateSnapshot`
 *    ⇒ 不存在「动作被正式校验拒绝」的形态。
 *
 * ── 硬边界（Queue 必改 / 禁止清单）───────────────────────────────────────────
 *   - **只增不减**：唯一的写动作是 `grantBody`（内部追加未拥有项），
 *     没有 `revoke`、不删除任何 key、不归零、**绝不覆盖或清空任何现有条目**。
 *     一个全新账号 / 已经全拥有的账号走 `already-owned` 出口 ⇒ **一个字节都不写**。
 *   - **只影响 Body 拥有状态**：唯一的写目标来自 `MVP_BODY_CHOICE_IDS`
 *     （→ `grantBody`），Weapon / Movement / Gadget 的计数一个字节都不动。
 *   - **不碰 BuildDraft**：本模块**一个字节都不写** Build ⇒ 「不自动替玩家换车身」
 *     与「不重置当前 weapon / rear / front Movement」是**结构性成立**的，不靠人工核对
 *     ⇒ Run Snapshot / Runtime 数值与调用前逐字节相同（不改变战斗行为）。
 *   - **不新建第二套拥有记录**：拥有状态仍写在 core 那**唯一一份**
 *     `strongfruit.ownedBodies.v1`（经 `grantBody` / `isBodyOwned`），与 Weapon / Movement 库存分离。
 *   - **不添加新 Body 类型 / 不改任何 Body 数值**：本模块的 id 全部是
 *     `MVP_BODY_CHOICE_IDS` 的成员（而它**只从** `NEW_OFFICIAL_BODIES` 取），
 *     **不写第二张表**、不造新 id ⇒ 内容库加一台，MVP 集合**不**自动跟上（MVP 是刻意收窄的验证面）。
 *   - **不加入 COMPLETE Reward Pool / 不新增 Shop·Economy / 不新增 Reset 按钮**：
 *     本模块既不读也不写奖励池与任何经济相关 key。
 */

import { NEW_OFFICIAL_BODIES, grantBody, isBodyOwned } from '../core/bodyOwnership';
import { readJsonWithVersion, stampVersion } from '../core/saveVersion';
import { platform } from '../platform';

/**
 * PRODUCT-LOOP-R4-BODY-CANONICAL-AND-GARAGE-MVP｜**本轮 MVP 的最小 Body 验证集合**。
 *
 * ── 为什么不是全部 `NEW_OFFICIAL_BODIES` ────────────────────────────────────
 * R4 的目标**不是铺 Body 内容量**，而是验证「Body 能否成为第三个有效配置维度」
 * （与 Weapon / Movement 并列）。因此本轮只解锁**足以让玩家「比较 → 选择 → 换配置」**
 * 的最小集合，而不是一次性把 4 台新增车身全部发给玩家。
 *
 * ── 选择依据（**只依据现有真实 Def 数值，不造策划标签**）───────────────────
 * 默认车身 `watermelonBody`（西瓜）真实数值：baseMass 120 · hp 1100 · energyCapacity 110
 * （`playerLoadout.PLAYER_BODY_DEF_ID`，属 `DEFAULT_OWNED_BODIES`，恒默认拥有，无需 seed）。
 * 在 `NEW_OFFICIAL_BODIES`（需要解锁的新 4 台）里，与默认车身**三维度真实差异最大**的两台：
 *
 *   | defId        | baseMass | hp   | energyCapacity | 与默认的差异            |
 *   |--------------|----------|------|----------------|-------------------------|
 *   | durianBody   | 135      | 1100 | 105            | 质量更高（135 vs 120）   |
 *   | pearBody     | 55       | 1000 | 95             | 质量更低（55）           |
 *   | mangoBody    | 48       | 950  | 95             | 质量最低（48）+ hp 950    |
 *   | orangeBody   | 80       | 1000 | 100            | 居中（80）               |
 *
 *   ⇒ 选 `durianBody`（重、高耐久）+ `mangoBody`（轻、低耐久）：
 *     与默认西瓜形成「重 / 中 / 轻」三种真实质量档，hp / energyCapacity 也逐档不同，
 *     足以验证「换 Body 会真实改变 hp / baseMass / energyCapacity / 挂点」这一事实，
 *     而无需把 4 台全发出去。
 *
 * ⚠️ 这些 id **仍取自 core 真源** `NEW_OFFICIAL_BODIES` 的成员（不是第二张表、
 *    不是新造 id）；本常量只是「这一轮 seed 发哪几台」的**选择**（`filter` 自真源，
 *    因此**不写字面量 id**，`durianBody` / `mangoBody` 只在注释里作为选择依据出现），
 *    内容库加一台不会自动进 MVP（MVP 是刻意收窄的验证面，不是全量目录）。
 * ⚠️ 不得修改任何 Body 数值、不得给它们起「坦克型 / 轻量型」等策划标签
 *    （上表只是**真实数值的罗列**，不是标签）。
 */
export const MVP_BODY_CHOICE_IDS: readonly string[] = NEW_OFFICIAL_BODIES.filter((id) =>
  id === 'durianBody' || id === 'mangoBody',
);

/**
 * 本种子的持久化 key（产品侧自己的 key，与 `profileClaims.v1` / `r2Onboarding.v1` /
 * `r2Reseed.v1` / `r3MovementChoiceSeed.v1` 同型）。
 *
 * ⚠️ **不复用**那几份既有标记：见模块头「四件独立的事实」那段。它们各自表达
 *    「R2 起点 / R2 reseed / Movement 选择起点 / Body 选择起点已经安排过了」，
 *    而本标记表达的是第四件事：「这个账号的 Body **选择起点**已经安排过了」。
 */
export const R4_BODY_SEED_KEY = 'strongfruit.r4BodyChoiceSeed.v1';

/**
 * 本种子的版本号（= 「这一次投放」的身份）。
 *
 * ⚠️ **不是** `core/saveVersion.CURRENT_SAVE_VERSION`（那是全局存档格式版本，见模块头）。
 *    将来若要再发一次不同起点的一次性 Body 投放，把这里 +1 即可 ——
 *    判据是 `record.version >= R4_BODY_SEED_VERSION`，旧标记自动失效并重跑一次。
 */
export const R4_BODY_SEED_VERSION = 1;

/** 落盘的记录（最小：只有一个版本号，不含时间戳 / 次数 / 玩家标识）。 */
export interface R4BodySeedRecord {
  readonly version: number;
}

/**
 * 判定（或执行）结果 —— 探针 / 测试 / 页面文案都读它，不各自再判一次。
 *
 * `reason` 覆盖**所有**互斥出口（`applied === true` 有且只有 `'seeded'`）：
 *   - `'seeded'`          —— 判据成立且真的补了拥有；
 *   - `'already-marked'`  —— 首入判定此前已经做出过（reload 后的形态，`decided = false`）；
 *   - `'already-owned'`   —— MVP 集合里的车身**都已经拥有**（`applied = false`，但 `decided = true`）。
 */
export type R4BodySeedReason = 'seeded' | 'already-marked' | 'already-owned';

/** 一台车身的补发读数（对账 / 探针 / 测试共用，不各自展开拥有状态形状）。 */
export interface R4BodySeedEntry {
  readonly defId: string;
  /** 本次挂载前是否已拥有 */
  readonly ownedBefore: boolean;
  /** 本次挂载后是否已拥有（grant 幂等 ⇒ 已拥有的不变、未拥有的变 true） */
  readonly ownedAfter: boolean;
  /** 本次为它新解锁了几台（`0` = 本来就有 ⇒ 一个字节都没动）。 */
  readonly raised: number;
}

/** 判定 + 执行合一的读数。 */
export interface R4BodySeedOutcome {
  /** 本次**真的**补了拥有（⇒ 调用方据此把 `changed` 置真、触发落盘）。 */
  readonly applied: boolean;
  readonly reason: R4BodySeedReason;
  /**
   * 本次挂载是否做出了「**首入**判定」⇒ 调用方据此落**本种子的标记**（只此一次）。
   *
   * ⚠️ 语义是「**决策**已做出」，**不是**「动作已执行」：
   *    - `already-marked` ⇒ `false`（这次不是首入，标记本来就在，不必再写）；
   *    - `already-owned` ⇒ `true` —— **必须落标记**，否则玩家自己之后取消拥有某一台时，
   *      下一次挂载判据 ② 会重新成立、把玩家自己取消的拥有再发一遍；
   *    - `seeded` ⇒ `true`（`applied === true`）。
   */
  readonly decided: boolean;
  /** 逐件读数（顺序 = `MVP_BODY_CHOICE_IDS` 的顺序，稳定）。 */
  readonly entries: readonly R4BodySeedEntry[];
  /** 本次新解锁了几台（`entries` 的 `raised` 求和，便于直接断言）。 */
  readonly raised: number;
}

/** 读种子标记（无标记 / 解析失败 / 形状非法 → `null`，绝不抛）。 */
export function readR4BodySeed(): R4BodySeedRecord | null {
  let raw: string | null = null;
  try {
    raw = platform.storage.getItem(R4_BODY_SEED_KEY);
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
export function isR4BodySeedDone(): boolean {
  const rec = readR4BodySeed();
  return rec !== null && rec.version >= R4_BODY_SEED_VERSION;
}

/**
 * 写种子标记（写入失败静默忽略 —— 与既有存档模块同一纪律：隐私模式 / 配额不影响本局游戏）。
 *
 * ⚠️ 调用方必须在**拥有状态已经落盘之后**再调它（见 `openGrowthSession` 的顺序说明）：
 *    顺序写反（先打标记后落盘）会让「配额写失败」这一种情况变成
 *    「标记说发过了、拥有却没补上」—— 玩家从此永远拿不到那几台。
 */
export function markR4BodySeed(): void {
  try {
    platform.storage.setItem(
      R4_BODY_SEED_KEY,
      JSON.stringify(stampVersion({ version: R4_BODY_SEED_VERSION })),
    );
  } catch {
    // 写入失败静默忽略：下次挂载会重试（标记没落盘 ⇒ 判据仍成立）
  }
}

/**
 * **纯判定 + 执行**（合一是刻意的，理由见下）：算出这次挂载该不该补拥有、补哪几台，
 * 并把**持久化**改动（`grantBody`）做到位（不重复落标记 —— 那一步由调用方按序做）。
 *
 * ⚠️ 为什么不拆成 `plan` / `apply` 两个函数（与 `r2Onboarding` / `r2Reseed` 的做法不同）：
 *    那两个模块要拆，是因为**执行**里有「可能被正式校验拒绝」的动作（`equipWeapon`），
 *    需要把「判定」与「可失败的动作」分开，让调用方能按 `plan` 决定要不要走到那一步。
 *    本模块**没有可失败的动作** —— 唯一写动作是幂等的 `grantBody`（不落盘、不校验、
 *    内部只追加未拥有的项）⇒ 拆开的两个函数之间只会多出一份「同一件事的两种表达」。
 *    落盘 / 打标记的顺序仍然由调用方掌握，这正是那条顺序要求真正依赖的东西。
 *
 * ⚠️ 返回的 `entries` 是**补发之后**的真实读数（`ownedAfter` 现读自 `isBodyOwned`），
 *    因此调用方可以直接拿它当「本次挂载结束时的形态」用，不必再读一次盘。
 *
 * ⚠️ `plan.raised === 0` 时本函数对拥有状态是**纯空操作**（`already-marked` / `already-owned`
 *    两个出口都不会触碰任何一个拥有标记）。
 */
export function applyR4BodyChoiceSeed(): R4BodySeedOutcome {
  /** 快照一次读数 —— 边读边写会读到半成品形态。 */
  const before = MVP_BODY_CHOICE_IDS.map((defId) => ({ defId, owned: isBodyOwned(defId) }));

  const readOut = (
    reason: R4BodySeedReason,
    decided: boolean,
  ): R4BodySeedOutcome => ({
    applied: false,
    reason,
    decided,
    entries: before.map((b) => ({ defId: b.defId, ownedBefore: b.owned, ownedAfter: b.owned, raised: 0 })),
    raised: 0,
  });

  // ① 首入判定此前已经做出过 ⇒ 永久跳过（reload 不会再补，也不再重判）
  if (isR4BodySeedDone()) {
    return readOut('already-marked', false);
  }

  // ② MVP 集合里的车身都已经拥有 ⇒ 无事可做；**仍然要落标记**（见 `decided` 的说明）
  const allOwned = before.every((b) => b.owned);
  if (allOwned) {
    return readOut('already-owned', true);
  }

  // ③ 把「未拥有」的 MVP 车身永久解锁（幂等：已拥有的原样不动）
  for (const defId of MVP_BODY_CHOICE_IDS) {
    grantBody(defId);
  }
  const entries: R4BodySeedEntry[] = MVP_BODY_CHOICE_IDS.map((defId) => {
    const ownedNow = isBodyOwned(defId);
    const beforeOwned = before.find((b) => b.defId === defId)?.owned ?? false;
    return {
      defId,
      ownedBefore: beforeOwned,
      ownedAfter: ownedNow,
      raised: ownedNow && !beforeOwned ? 1 : 0,
    };
  });
  return {
    applied: entries.some((e) => e.raised > 0),
    reason: 'seeded',
    decided: true,
    entries,
    raised: entries.reduce((sum, e) => sum + e.raised, 0),
  };
}
