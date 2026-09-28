/**
 * PRP-F2-FIRST-REAL-UPGRADE-LOOP｜PRP-BUILD-01-TWO-STEP-CANNON-BUILD
 * Run-local 强化 overlay（唯一的 Modifier 接缝）。
 *
 * ## 为什么是这个接缝（PRP-F2 必改 1 的「先查」结论，本 Queue 未变）
 *
 * 正式 Runtime 里**已经有**一条干净的「运行期 override」通路，只是此前只有 Movement 用到了：
 *
 *   `BuildSnapshot` ─ resolveSnapshot(snapshot, registry) ─▶ `ResolvedSnapshot`
 *        └─ functionals[i].defId → registry.functionals.get(defId)
 *                                    └─▶ resolved def（含 behaviorParams）
 *                                          └─▶ `PlanckPartRuntime.def`
 *                                                └─▶ `CannonBehavior` 构造时只读提取
 *
 * 关键事实（file:line 证据）：
 *   - `src/core/buildSnapshot.ts:97`  `resolveSnapshot(snapshot, registry)` —— def 全部经 registry 展开；
 *   - `src/core/buildSnapshot.ts:119` Movement 已有 `applyMovementOverrides(baseDef, install.overrides)`
 *     （`src/core/types.ts:150` `overrides?: Partial<WheelDef>`）→ **override 是正式既有范式**；
 *   - `src/core/types.ts:186` `ContentRegistry = { bodies: Map, movements: Map, functionals: Map }`
 *     —— 三个**可变 Map**；
 *   - `src/core/content.ts:1012` `createRegistry()` **已导出** 且每次返回全新实例；
 *   - `src/battle/cannonBehavior.ts:107` `readCannonParams(part)` 只读 `part.def.behaviorParams`
 *     —— **不读 Content 单例、不读全局状态**；
 *   - `src/battle/behaviorRuntime.ts:72` `new CannonBehavior(ctx.part, ...)` —— part 来自 orchestrator
 *     内部按 resolved def 装配，PRP 无法在 weapon 内部插入逻辑（也不需要）。
 *
 * ⇒ **Run-local overlay registry**：本局用 `createRegistry()` 造一份**独立副本**，在其中新增一个
 *   带强化数值的**本局专用部件 id**，然后把本局 BuildSnapshot 里武器的 `defId` 重映射过去。
 *   正式 `content.ts` 的 Cannon 定义、`registry` 单例、`cannonBehavior` / `ContactRouter` /
 *   `PlanckBattleOrchestrator` **全部零修改**；强化只存在于这一份内存副本里，
 *   页面刷新 / 新开 Run 立刻消失（不落盘、不进 Garage、不改星级）。
 *
 * ## 第一层（PRP-F2 / PRP-F2-R1 / PRP-F2-R2，已真人验收通过并冻结）
 *
 *   | 选项 | 自然因果 | overlay 改了什么 |
 *   |---|---|---|
 *   | A 重型弹头 heavyShell | 炮弹更重 → 推得更狠、自己也退得更狠 | `projectileRadius 10→16` / `projectileMass 1→4` / `recoilImpulse 30→90` |
 *   | B 双联炮 twinCannon | 一次攻击极短间隔连续两发 | `burstRounds 1→2` + `burstIntervalMs 0→100` |
 *   | C 快速装填 fastReload | 开炮节奏变快（1.54× 基础） | `cooldownMs 1000→650` |
 *
 * ⚠️ 这三个数值**本 Queue 一个都不许动**（Queue 冻结项）。
 *
 * ## 第二层（PRP-BUILD-01：条件池 —— 第一层选择决定第二层出现什么）
 *
 * 验证的核心假设：**第一次强化会改变第二次强化的价值与期待**，从而形成 Build，
 * 而不是连续拿两个互不相关的 Buff。第一版不做随机权重，直接固定条件池：
 *
 *   | 第一层 | 强联动 synergy | 安全通用项 safe | 轻度转向项 pivot |
 *   |---|---|---|---|
 *   | 重型弹头 | **动能爆发** kineticBurst | 紧急维修 emergencyRepair | 快速装填 fastReload |
 *   | 双联炮   | **三连装填** tripleLoad   | 紧急维修 emergencyRepair | 重型弹头 heavyShell |
 *   | 快速装填 | （**无专属联动**，见下） | 紧急维修 emergencyRepair | 重型弹头 heavyShell + 双联炮 twinCannon |
 *
 * ⚠️ **PRP-BUILD-01-CLOSEOUT-AND-FREEZE**：快速装填的专属第二层尝试过三条
 * （`反冲蓄能` recoilCharge → `强力后坐` strongRecoil → `压制射击` suppressionShot），
 * **三条全部真人未通过**，已**正式废弃并整条删除**，不再为该第一层开发专属二层。
 * 它的第二层改为**通用转向池**：三个**已存在**的方向（重型弹头 / 双联炮 / 紧急维修），
 * 语义 = 「保留高频特征，同时向重炮 / 多发转型，或者选生存」。
 * ⇒ **本阶段不验证这些混合组合的平衡**，也不新增第四个第一层强化。
 *
 * ## 横向改装（PRP-RUN-02-R2：让 DAY 4 的取舍成为真实取舍）
 *
 *   「继续改装」分支在 DAY 4 立刻多拿一次**横向改装**：候选 = 现有第一层之外的**另外两个**
 *   一层强化（二选一），**不新增 Buff、不提供 `emergencyRepair`**。
 *   ⇒ 它不引入任何新内容，只是让玩家**多拿一项已经存在的一层强化**——因此
 *     「维修 = 生存优势 / 继续改装 = 构筑数量优势」这个取舍不需要新数值、不需要新强化。
 *   ⚠️ 与第二层的区别：横向池**不看**第一层选了什么（恒为「另外两项一层」），
 *      第二层池**由最初主路线决定**（`RUN_LAYER2_POOLS`）。两者都不重复给出已拥有的项。
 *
 * 两种强联动的因果与实现：
 *
 *   - **动能爆发**：炮弹越重 / 撞击越强 → 命中追加越明显的冲击。追加冲量
 *     `= KINETIC_BURST_GAIN × 当前 projectile 质量 × 命中相对速度`——
 *     强度**读自当前 Projectile 的真实质量与真实冲击结果**，没有「重型弹头专属伤害」这种写死值。
 *     实现走正式事件总线（`damage` 事件）+ `world.applyLinearImpulse` 公开接口，零改正式模块。
 *     ⚠️ PRP-BUILD-01-R1：增益一次性放大（方向验证），且冲量作用点 = **真实命中点**
 *     （`damage.contactPoint`）→ 除平动外真实产生绕质心的扭矩（仰俯 / 旋转）。
 *   - **三连装填**：继续复用 PRP-F2-R1 给正式 Cannon 补的**可选 burst 能力**，`burstRounds 2→3`；
 *     `burstIntervalMs` 保持 100ms（第一版不重新调间隔）。三发都是真实 projectile。
 *
 * ⚠️ 安全性（Queue 必改 4 的「接缝若不存在就停止」判定）：接缝**存在且干净** ——
 *     `PlanckBattleOrchestrator.onCombatEvent`（`planckBattleOrchestrator.ts:413`）是公开订阅口，
 *     `WeaponFireEvent`（`combatEvents.ts:41`，含 `team`/`worldDirection`）与
 *     `DamageEvent`（`combatEvents.ts:36`，含 `source`/`target`/`damageSource`/`behavior`/
 *     `relativeVelocity`）都是正式既有事件；`world.applyLinearImpulse` 亦是公开 API。
 *     因此**不需要**给正式 Movement / recoil 加任何 hook，也没有 PRP 特例进正式模块。
 *
 * ## PRODUCT-LOOP-R7-WEAPON-BASIC-BUILD-CONTENT｜**通用基础成长**（非 cannon 基准武器）
 *
 * 背景（Q1 Capability Matrix 的实测结论）：R6 / R6-BATCH 之后，产品 Run 的 base weapon =
 * 玩家实际装备的那件（放行 7 件），但**局内成长内容仍然全是 Cannon 专属** ——
 * `RUN_MODIFIER_OVERLAY` 的字段名（`projectileRadius` / `burstRounds` / `cooldownMs` …）与
 * `behavior`（`'cannon'`）都只对 Cannon 成立，`weaponOverlayMods()` 在 base ≠ cannon 时
 * **整表不适用**。⇒ 装备 `hammer` 的玩家选完三选一，武器**一个数字都没变**
 * （唯一真实收益是 `emergencyRepair` 的回耐久）。
 *
 * 本 Queue 按 Q1 的真实读数补**最小骨架**：两条只改**该武器自己的** `behaviorParams` 数值、
 * **绝不动 `behavior`** 的通用成长：
 *
 *   | id | 词条 | 自然因果 | 写哪个字段 |
 *   |---|---|---|---|
 *   | `damageUp` | 伤害提升 | 命中更疼 | 该武器**自己的**顶层伤害键（键名含 `damage`） |
 *   | `rateUp`   | 攻击加快 | 两次攻击之间的间隔变短 | 该武器**自己的**节奏键（见下） |
 *
 * ── 字段是**派生**的，不是第二张武器数值表（Q1 明文：矩阵必须从 canonical / behavior 派生）
 *
 *   - **伤害键** = `behaviorParams` 里「顶层 + 数值 + 键名含 `damage`」的**唯一**键
 *     （与 `src/core/buildSnapshot.ts` 的 `isDamageKey` 同一规则）。实测 7 件**各恰一个**：
 *     5 件 `projectileDamage`（`cannon` / `flamethrower` / `laser` / `machineGun` / `shotgun`）
 *     + `hammer` / `rammer` 的 `baseDamage` ⇒ **7/7 真实共通**。
 *   - **节奏键**（按 Q1 真源，逐件取自**它自己**的 canonical，不强行统一成一个字段名）：
 *       ① canonical 真有 `cooldownMs` ⇒ 用它（5 件：`cannon` / `flamethrower` / `laser` /
 *          `machineGun` / `shotgun`）；
 *       ② 否则用该 behavior **自己的**「前摇 / 间隔步数」键 —— `rammer.restSteps`
 *          （canonical 里就是 24）；
 *       ③ `hammer` 的 `windupPauseSteps` **只在行为代码默认里**（canonical 的 `behaviorParams`
 *          只有 `baseDamage`）⇒ 用 `HAMMER_WINDUP_PAUSE_BASE`，而它的值由 targeted 测试与
 *          `HAMMER_DEFAULT_PARAMS.windupPauseSteps` **钉成同源**（第二处真源由机器守住）。
 *     ⇒ 6/6 非 Cannon 武器都有**自己的**节奏键；`hammer` 走的不是「forced 统一」，而是它自己的键。
 *
 * ── Cannon 为什么一个字节都不动（Queue 明文：Cannon 保持原逻辑）
 *
 *   `weaponOverlayMods(build, 'cannon')` **显式排除**通用成长 id ⇒ Cannon 继续只用它那 5 项
 *   冻结内容（`heavyShell` / `twinCannon` / `fastReload` / `kineticBurst` / `tripleLoad`），
 *   池子仍是 `RUN_LAYER1_POOL` / `RUN_LAYER2_POOLS`；通用成长只对 **base ≠ cannon** 生效。
 *   ⇒ 「新的共通成长与 Cannon 现有 Build 冲突时，Cannon 保持原逻辑」在**结构上**成立。
 *
 * ── 不新增的东西（Queue 禁止项逐条）
 *
 *   没有元素 / Combo / 暴击 / 穿透 / 分裂 / 弹射 / 额外 projectile；没有新 projectile；
 *   没有特殊资格 / 隐藏状态 / 复杂触发条件 —— 两个成长各自只写**一个数值字段**，
 *   且写的都是**该武器自己已经在读的**字段（行为侧的 `num(key, default)` 逐键读取）。
 *
 * ⚠️ 重映射仍然只经「本局 registry 的独立副本」这一条既有接缝（见上）：
 *    正式 `content.ts` 的 7 件武器定义**逐字节不变**（targeted 测试逐字段对拍）。
 */

import { createRegistry } from '../../core/content';
import type { BuildSnapshot, ContentRegistry, FunctionalPartDef } from '../../core/types';

/* ------------------------------------------------------------- 标识 */

/** 第一层（Queue 已冻结的三项）。 */
export type Layer1ModifierId = 'heavyShell' | 'twinCannon' | 'fastReload';

/**
 * 第二层（条件池里的项）。
 * `emergencyRepair` 是三个池共用的**安全通用项**（不改武器行为，只在选择时修耐久）。
 * `heavyShell` / `twinCannon` / `fastReload` 也会作为**转向项**出现在别的第一层的池里。
 */
export type Layer2ModifierId = 'kineticBurst' | 'tripleLoad' | 'emergencyRepair';

export type RunModifierId = Layer1ModifierId | Layer2ModifierId;

/**
 * **通用基础成长**的 id（PRODUCT-LOOP-R7-WEAPON-BASIC-BUILD-CONTENT）。
 *
 * ⚠️ 刻意**不并进** `RunModifierId`：Cannon 的 `RUN_MODIFIER_OVERLAY` / `RUN_ALL_MODIFIER_IDS` /
 *    `RUN_MODIFIERS` / `RUN_LAYER2_POOLS` 都是**冻结内容**，把它们做成「多两个键」会改动
 *    Cannon 侧的既有 id 闭集（会污染既有断言与池结构）。两者只共用**同一个** overlay 合成接缝
 *    （`weaponOverlayMods` + `composeRunWeaponDef`），互不进入对方的池子。
 */
export type GenericGrowthId = 'damageUp' | 'rateUp';

/**
 * **本局 Build 的合法 id 全集** —— Cannon 的既有 6 项 + 通用基础成长 2 项。
 *
 * 状态机 / UI / 注入链一律按这个并集工作；「某一项对**这一局**适不适用」由
 * `weaponOverlayMods(build, baseWeaponDefId)` 回答（唯一判据，不另立规则）。
 */
export type RunBuildId = RunModifierId | GenericGrowthId;

/** 每个强化在池子里扮演的角色（用于测试断言「三选一 = 联动 + 通用 + 转向」）。 */
export type RunModifierRole = 'base' | 'synergy' | 'safe' | 'pivot';

/**
 * **R2 武器强化体系**的归属武器 = 正式 Cannon。
 *
 * ⚠️ PRODUCT-LOOP-R6-RUN-WEAPON-SOURCE-OF-TRUTH：这个常量**不再是**「本局 Run 的基准武器」。
 *    本局 Run 的基准武器由 `resolveRunBaseWeaponDefId()` 从**玩家实际装备**解析（必改 1），
 *    可以是任何正式武器。本常量现在只回答一个问题：
 *    **下面这张 overlay 数值表属于谁** —— 答案是 Cannon：`heavyShell` / `twinCannon` /
 *    `fastReload` / `tripleLoad` 的 `behavior` 全是 `'cannon'`，改的字段名
 *    （`projectileRadius` / `projectileMass` / `recoilImpulse` / `burstRounds` /
 *    `burstIntervalMs` / `cooldownMs`）也全是 Cannon 自己的 `behaviorParams` 键。
 *    ⇒ 装备不是 Cannon 时这些项**一项都不适用**（见 `weaponOverlayMods`），
 *      而**不是**把它们套到别的武器上 —— 那正是 Queue 明令禁止的
 *      「把 Cannon 的 damage base / behavior / projectile / reload / recoil 套给其它武器」。
 *    ⇒ 同理，`PRODUCT_RUN_CANNON_BASE_DAMAGE`（玩家侧 120）也只作用于它（见 `composePlayerRunWeaponDef`）。
 */
export const RUN_BASE_WEAPON_DEF_ID = 'cannon';

/**
 * PRODUCT-LOOP-R2-RECOVERY-ONBOARDING-CLARITY｜**产品 Run 玩家侧基线伤害**。
 *
 * ── 为什么需要它，而不是改正式 Cannon 的伤害 ──────────────────────────────
 * 真人在当前 R2 原型里要连续多局才能偶尔赢一次 ⇒ 成长闭环（4/5 → 跑一局 → 5/5 → 合 ★2）
 * 实际上走不完。要调的因此是**「产品 Run 里玩家那门炮」的基线**，不是全局 Cannon。
 * 正式 `content.ts` 的 Cannon 被三处共享：旧横屏正式玩法、`Validation` 场景、
 * 以及**敌方 `RangedTurret` 自己装的 cannon** —— 直接改它会顺带把敌人一起 buff，
 * 并让 RDC（真实追上 RangedTurret）/ 三段序列等结构守卫失效。
 * 因此本值**只在玩家侧**生效。
 *
 * ── 作用链（顺序即语义，勿调换）──────────────────────────────────────────
 *   正式 Cannon Def（`projectileDamage` = 80，冻结不动）
 *     → 本基线 overlay（120）  ← 只重映射**玩家装载**里那一件基准武器
 *       → 永久 Star multiplier（`1 + 0.25 × (star − 1)`）⇒ ★1 = 120 / ★2 = **150**
 *         → Run-local Modifier overlay（`composeRunWeaponDef`）
 *           → Battle Runtime
 *
 * ⇒ 玩家侧 ★1 = 120、★2 = 150；**敌方 cannon 与正式 cannon 一律仍是 80**。
 *
 * ⚠️ 只改 `projectileDamage` 一项 —— 冷却 / 弹速 / 半径 / 质量 / 后坐全部沿用正式值，
 *    因此「Cannon 的手感与节奏」零变化。
 * ⚠️ 这是**基线**，不是 Modifier：它不进 `RUN_MODIFIER_OVERLAY`、不参与
 *    `applyRunModifiersToSnapshot()` 那条「找不到基准武器即 throw」的强 invariant。
 * ⚠️ 只对**玩家侧装载**生效：本局 registry 的正式 `cannon` 键**逐字段不变**，
 *    敌方快照也从不重映射 ⇒ 「Enemy Cannon 完全不变」是结构性的，不是靠自觉。
 */
export const PRODUCT_RUN_CANNON_BASE_DAMAGE = 120;

/** 玩家侧基线在 overlay 部件 id 里的标记段（不是任何 ModifierId ⇒ 永不撞车）。 */
const RUN_PLAYER_BASE_TOKEN = '@base';

export interface RunModifierDef {
  readonly id: RunModifierId;
  readonly label: string;
  /** 一句结果（玩家可读，不是数值表）。 */
  readonly note: string;
  /** 选择后写入冒险日志的自然语言（必改 3）。 */
  readonly logText: string;
  readonly role: RunModifierRole;
}

/** 第一层三选一（固定、不随机、无稀有度、无升级树）—— 也是 `RUN_CHOICE_OPTIONS` 的唯一来源。 */
export const RUN_MODIFIERS: readonly RunModifierDef[] = [
  {
    id: 'heavyShell',
    label: '重型弹头',
    note: '炮弹更重，撞击和后坐都更明显',
    logText: '你为大炮装上了重型弹头。',
    role: 'base',
  },
  {
    id: 'twinCannon',
    label: '双联炮',
    note: '一次开火连续打出两发炮弹',
    logText: '你为大炮加装了一门副炮。',
    role: 'base',
  },
  {
    id: 'fastReload',
    label: '快速装填',
    note: '开炮节奏明显变快',
    logText: '你改进了大炮的装填机构。',
    role: 'base',
  },
];

/** 第二层（条件池）三项。 */
export const RUN_BUILD_MODIFIERS: readonly RunModifierDef[] = [
  {
    id: 'kineticBurst',
    label: '动能爆发',
    note: '重弹命中会把对手整个撞开',
    logText: '你给炮弹装上了动能引信。',
    role: 'synergy',
  },
  {
    id: 'tripleLoad',
    label: '三连装填',
    note: '一次开火连续打出三发炮弹',
    logText: '你把副炮接进了主装填链。',
    role: 'synergy',
  },
  {
    id: 'emergencyRepair',
    label: '紧急维修',
    note: '立刻修回一部分车体耐久',
    logText: '你让随车工程师紧急修补了车体。',
    role: 'safe',
  },
];

const ALL_MODIFIERS: readonly RunModifierDef[] = [...RUN_MODIFIERS, ...RUN_BUILD_MODIFIERS];

export function runModifierById(id: string): RunModifierDef | undefined {
  return ALL_MODIFIERS.find((m) => m.id === id);
}

/** 全部强化 id（测试用）。 */
export const RUN_ALL_MODIFIER_IDS: readonly RunModifierId[] = ALL_MODIFIERS.map((m) => m.id);

/* --------------------------------------------------------- 条件池 */

/** 第一层池 = 固定三项。 */
export const RUN_LAYER1_POOL: readonly Layer1ModifierId[] = ['heavyShell', 'twinCannon', 'fastReload'];

/**
 * 第二层条件池：**由第一层选择决定**（必改 1）。
 *
 * 每池固定三项。重炮 / 多发两池 = 「强联动 / 安全通用 / 轻度转向」（必改 5 的取舍结构）；
 * ⚠️ 快速装填池已按 `PRP-BUILD-01-CLOSEOUT-AND-FREEZE` 改为**通用转向池**
 * （无专属联动，三个**已存在**的方向 = 重炮 / 多发 / 生存）。
 * 三个池长度一律为 3 —— **不新增第四个第一层强化，也不加长任何池**。
 * 这是第一版的条件池，不做正式随机权重、不做稀有度。
 */
export const RUN_LAYER2_POOLS: Readonly<Record<Layer1ModifierId, readonly RunModifierId[]>> = {
  heavyShell: ['kineticBurst', 'emergencyRepair', 'fastReload'],
  twinCannon: ['tripleLoad', 'emergencyRepair', 'heavyShell'],
  fastReload: ['heavyShell', 'twinCannon', 'emergencyRepair'],
};

/** 第二层的选项定义（按池顺序，供 UI / 状态机使用）。 */
export function runLayer2PoolDefs(layer1: string): readonly RunModifierDef[] {
  const pool = RUN_LAYER2_POOLS[layer1 as Layer1ModifierId];
  if (!pool) return [];
  return pool.map((id) => runModifierById(id)!);
}

/* --------------------------------------------------- 横向改装池（R2） */

/** 某一项是不是**第一层**强化（`heavyShell` / `twinCannon` / `fastReload`）。 */
export function isLayer1Modifier(id: string): id is Layer1ModifierId {
  return (RUN_LAYER1_POOL as readonly string[]).includes(id);
}

/** 第一层的选项定义（按固定顺序）—— 与 `RUN_MODIFIERS` 同源，只是换了个形状。 */
export function runLayer1PoolDefs(): readonly RunModifierDef[] {
  return RUN_LAYER1_POOL.map((id) => runModifierById(id)!);
}

/**
 * **横向改装池**（PRP-RUN-02-R2）：「继续改装」分支在 DAY 4 立刻多拿的那一次。
 *
 * 规则（Queue 必改 1，逐字落地）：
 *   - **只复用现有第一层内容** → 候选恒为 `RUN_LAYER1_POOL` 的子集，**不新增 Buff**；
 *   - 排除**当前已拥有**的一层强化 ⇒ 恰好剩下**另外两个**（二选一）；
 *   - **不提供** `emergencyRepair`（它属于第二层，不在这个池里）。
 *
 * `owned` 传当前本局 Build 的全部 id（不只一层）——这样即使将来 Build 里出现别的项，
 * 「已拥有的不重复出现」这条规则也不会被绕过。
 */
export function runLateralPoolDefs(owned: readonly RunBuildId[]): readonly RunModifierDef[] {
  return runLayer1PoolDefs().filter((m) => !owned.includes(m.id));
}

/* ------------------------------------------------------- overlay 数值表 */

/**
 * 单个强化的 overlay：只声明**被强化语义覆盖的那几个字段**，其余字段一律沿用正式 Cannon。
 *
 * `behavior` 字段保留（当前全部仍是正式 `cannon`）—— 留作将来「换武器基座」的扩展点。
 * 「一次攻击打几发」由 Cannon 自己的可选 `burstRounds` 表达，不需要为了多弹丸去换 behavior。
 */
export interface RunModifierOverlay {
  readonly behavior: string;
  readonly behaviorParams: Readonly<Record<string, number | number[]>>;
  /** 人类可读的因果说明（进交接文档与测试断言，不参与运行时）。 */
  readonly cause: string;
  /**
   * 是否**改武器数值**。
   * `false` = 这项强化不改武器（只通过 Run 能力作用于战斗）→ 不参与本局武器 def 的组合。
   */
  readonly affectsWeapon: boolean;
}

/** 不改武器数值的项统一用这个空 overlay（`behavior` 仅作占位，永不参与组合）。 */
const NO_WEAPON_OVERLAY = 'cannon';

/**
 * 冻结的 overlay 数值表。
 *
 * ⚠️ 第一层三项**逐字段冻结**（Queue 冻结项）；第二层只新增 `tripleLoad` 一个武器项。
 * ⚠️ 这里**没有** `muzzleSpeed` / 部件 `mass` / `energy` —— 强化不改变弹道速度，
 *    也不改变车辆装配（总质量 / 能量 / 挂点全部不动）→ 「Base vehicle 冻结」。
 */
export const RUN_MODIFIER_OVERLAY: Readonly<Record<RunModifierId, RunModifierOverlay>> = {
  heavyShell: {
    behavior: 'cannon',
    // 更重的弹头：真实半径（视觉尺寸与碰撞半径同源）+ 真实质量（命中冲量）+ 真实后坐。
    // damage 刻意不动：Queue 要求「不以单纯 Damage +X 作为主要表现」。
    //
    // ⚠️ 这三个数不是随手写的：本场演示遭遇的战**胜负余量极窄**（基础仅多剩 269.78/1100），
    // 实测扫描见 `交接文档_2026-09-12_PRP-F2.md` —— 单独任一项都不翻盘，
    // 但 `r18+m4+rc90` / `r14+m3+rc60` 会把胜负翻成败。这里取「三项都明显且不翻盘」的那组。
    behaviorParams: { projectileRadius: 16, projectileMass: 4, recoilImpulse: 90 },
    cause: '炮弹更重 → 命中推动更明显，同时自身后坐更明显',
    affectsWeapon: true,
  },
  twinCannon: {
    // PRP-F2-R1：正式 Cannon 的**真实连发**（不再借用 shotgun 齐射）。
    // 只声明这两个参数 —— 伤害 / 射速 / 弹速 / 半径 / 质量 / 后坐**全部沿用正式 Cannon**，
    // 因此每发都是完整炮弹；两发弹道同向，靠 100ms 时间差产生「连续两发」的可感知性。
    behavior: 'cannon',
    behaviorParams: { burstRounds: 2, burstIntervalMs: 100 },
    cause: '一次攻击连续打出两发真实炮弹（同向、极短间隔）',
    affectsWeapon: true,
  },
  fastReload: {
    // 只改本局当前 Cannon 的攻击间隔；其它一律不动。
    //
    // PRP-F2-R2 参数回收：`400 → 650`。第一版 400ms（≈2.5× 基础）真人可感知，
    // 但把「远程开火 → 后坐 → 敌方接近 → 碰撞」整段正式物理节奏压缩掉了，
    // 有形成稳定最优解的风险。650ms ≈ **1.54× 基础**，保留可感知的节奏差，
    // 同时让每轮炮击之间重新留出物理运动时间。**只回收这一个数，不做多档扫描。**
    behavior: 'cannon',
    behaviorParams: { cooldownMs: 650 },
    cause: '开炮节奏明显变快',
    affectsWeapon: true,
  },
  tripleLoad: {
    // 必改 3：继续复用现有 Cannon burst Foundation，burstRounds 2 → 3。
    // `burstIntervalMs` 与双联炮**完全相同**（100ms）——「保持当前可读节奏，第一版不重新调间隔」。
    behavior: 'cannon',
    behaviorParams: { burstRounds: 3, burstIntervalMs: 100 },
    cause: '在双联的基础上再连一发：一次攻击连续三发真实炮弹（同间隔）',
    affectsWeapon: true,
  },
  kineticBurst: {
    behavior: NO_WEAPON_OVERLAY,
    behaviorParams: {},
    cause:
      '命中追加冲量 = GAIN × 当前 projectile 质量 × 命中相对速度（不写死专属伤害）；作用点 = 真实命中点',
    affectsWeapon: false,
  },
  emergencyRepair: {
    behavior: NO_WEAPON_OVERLAY,
    behaviorParams: {},
    cause: '选择时立刻修回一部分车体耐久（不改武器 / 不改战斗世界）',
    affectsWeapon: false,
  },
};

/* --------------------------------------------------------- Run 能力参数 */

/**
 * **动能爆发**的能量增益：`追加冲量 = KINETIC_BURST_GAIN × projectileMass × relativeVelocity`。
 *
 * ⚠️ 这里只放一个标量增益，**没有任何「重型弹头专属」的写死强度** ——
 *    实际强度里 `projectileMass` 读自本局真实 resolved 武器 def（基础 1 / 重型弹头 4），
 *    `relativeVelocity` 读自正式 `damage` 事件（真实冲击结果）。重弹天然打出更狠的一击。
 *
 * ── PRP-BUILD-01-R1：为什么把增益一次性放大（倍数级）─────────────────────────────
 *
 * 真人验收结论：`重型弹头 → 动能爆发` 的技术联动**存在**，但正常速度下与「只有重型弹头」
 * 的最终战斗区别不够明显 —— 玩家只能感知到「大炮弹更重」，无法自然判断「这一炮命中后
 * 又产生了一次额外动能冲击」。即第二层 Build 卡在 `存在 → 可感知` 这一关。
 *
 * 首版的 `12` 是「参数上明显、可感知上不足」：实测该值下追加冲量 ≈ 313（世界单位·速度），
 * 敌车在命中帧的速度跃变 ≈ 3.76（约环境的 8 倍），但**屏幕（舞台带）位移只有 4 逻辑 px**
 * —— 因为冲量作用在质心、没有扭矩，且被车轮/地面的接触与电机约束在十几步内吃掉，
 * 而相机又跟随双方中点继续把这点位移「追平」。
 *
 * 因此本轮按 Queue 必改 2 做**一次性倍数级放大**（不做 10% 微调）：`12 → 28`（≈2.33×）。
 * 同时把作用点从质心改为**真实命中点**（`damage` 事件的 `contactPoint`），
 * 这既更接近「冲击发生在接触点」的真实物理（弹丸本身也是经正式接触在接触点施力），
 * 也让「仰俯 / 旋转」这一相机无法追平的通道真正出现（见 `runBuildAbilities.ts`）。
 *
 * ### 28 是怎么定出来的（本机实测扫描，同条件 A/B；不是拍的）
 *
 * 固定 Player / Enemy / spawn / HP / world / **正式相机链**，只变这一个增益。
 * 「每炮中位屏幕位移」= 该次命中后 30 帧内敌车中心在**舞台带（390 逻辑 px）**内的最大位移的中位数；
 * 「位移/旋转达标」= 同窗口内有位移（≥5px）/ 绕质心转角 ≥8° 的炮数。
 * 「第三场残血」= `heavyShell+kineticBurst` 路线跑完三场连锁后第三场的真实剩余耐久（上限 1100）
 * —— 它衡量的是**这次改动会不会伤到 Run**（PRP-RUN-R1 的「三场都活着且有余量」）。
 *
 *   | GAIN | 每炮中位屏幕位移 | 位移 / 旋转达标炮数 | 单帧最大转角 | 敌车右缘峰值 | 第三场残血 |
 *   |---|---|---|---|---|---|
 *   | 12（原值） | 1.2 px | 2/12 · **0/12** | 1.8° | 390.3 | 537 |
 *   | 20 | 14.8 px | 5/9 · 5/9 | 16.6° | 390.1 | **51** |
 *   | 24 | — | — | — | — | **197** |
 *   | **28** | **15.6 px** | **11/11 · 7/11** | 8.9° | **390.3** | **430** |
 *   | 32 | 15.5 px | 7/9 · 6/9 | 14.9° | 390.2 | **115** |
 *   | 36 | 39.9 px | 7/8 · 6/6 | 12.4° | 389.9 | **86** |
 *   | 48 | 54.6 px | 7/8 · 8/8 | **116.4°（单帧瞬转）** | 402.2（越界 12px） | — |
 *
 * 取 **28**，四条理由：
 *   1. **可感知**：屏幕位移 1.2 → 15.6 px（≈13×，单炮最高 62 px）；更关键的是「绕质心旋转」
 *      从 **0/12 次** 变成 **7/11 次**（最高 55.6°）—— 旋转是相机**无法追平**的通道，
 *      也是 Queue 必改 2 列出的三个可接受结果（位移 / 仰俯旋转 / 弹开）里最稳的一个。
 *   2. **不伤 Run**：32 / 36 会把第三场残血砸到 115 / 86（≈8%），真人看到的将是「选了联动
 *      反而差点被打死」；28 保留 430（39%）→ PRP-RUN-R1「三场都活着且有余量」仍然成立。
 *   3. **不越界**：`Active`（相机逐帧跟随、玩家真正交战的阶段）两车四边全程在舞台带内
 *      （B 右缘峰值 **363.2**）；全阶段峰值 **390.3** 是「敌车被轰到**世界右墙**」在
 *      `Warning`（相机按设计冻结）下的映射，越界仅 **0.3 逻辑 px（亚像素）**；
 *      而 40 / 48 会冲到 417 / 402（**真越界 12~27px**）。
 *   4. **不引入退化观感**：单帧最大转角 8.9°（连续倾倒），而 48 会出现 116°/帧的**瞬转**
 *      —— 那看起来是「车瞬移 / 弹飞」，不是「被轰开」。
 *
 * ⚠️ 「增益更大反而残血更少」（20 → 51、28 → 430、32 → 115）是这套物理的**混沌放大**：
 *    命中时机相位一变，整场走势就变。因此这里**不改判据、不调其它数值**去强行挤出更好的平衡
 *    —— 只把方向验证需要的位移 / 旋转做出来。
 * ⚠️ 平衡不是本 Queue 的目标（必改 2 原文「不要求现在平衡」）：28 让「重炮 + 动能爆发」这一组
 *    在低压验证对手上的第三场从 537 收到 430，属于**已记录的、留给后续平衡 Queue 的事项**。
 * ⚠️ 冻结项（重型弹头数值 / 基础伤害 / CD / 相机 / Movement / 敌人参数 / 双联炮 / 快速装填 /
 *    PRP UI）一个都没动。
 */
export const KINETIC_BURST_GAIN = 28;

/** **紧急维修**：选择时修回的耐久比例（相对上限；不超过上限）。 */
export const EMERGENCY_REPAIR_FRACTION = 0.25;

/* --------------------------------------------- 通用基础成长（非 cannon 基准武器） */

/**
 * 一条通用基础成长的定义。**只描述语义**，不含任何数值 —— 数值在运行时从
 * **该武器自己的 canonical Def** 派生（见 `genericGrowthParamsOf`）。
 */
export interface RunGrowthDef {
  readonly id: GenericGrowthId;
  readonly label: string;
  readonly note: string;
  /** 选择后写入冒险日志的自然语言。 */
  readonly logText: string;
  /** 与 Cannon 的第一层强化同角色：只改武器数值的一级基础成长。 */
  readonly role: 'base';
  /** 它写的**字段角色**（damage / cadence）—— 供测试与文档引用，不参与运行时。 */
  readonly paramRole: 'damage' | 'cadence';
}

/** 通用基础成长两项（Queue 明文：词条名称保持直白，不做包装型复杂命名）。 */
export const RUN_GENERIC_GROWTH: readonly RunGrowthDef[] = [
  {
    id: 'damageUp',
    label: '伤害提升',
    note: '每次命中打得更重',
    logText: '你把武器的打击部件换成了更狠的一档。',
    role: 'base',
    paramRole: 'damage',
  },
  {
    id: 'rateUp',
    label: '攻击加快',
    note: '两次攻击之间的间隔变短',
    logText: '你缩短了武器的攻击间隔。',
    role: 'base',
    paramRole: 'cadence',
  },
];

export const RUN_GENERIC_GROWTH_IDS: readonly GenericGrowthId[] = RUN_GENERIC_GROWTH.map((g) => g.id);

export function isGenericGrowth(id: string): id is GenericGrowthId {
  return (RUN_GENERIC_GROWTH_IDS as readonly string[]).includes(id);
}

export function genericGrowthById(id: string): RunGrowthDef | undefined {
  return RUN_GENERIC_GROWTH.find((g) => g.id === id);
}

/**
 * **伤害提升**的倍率：`伤害键 × 1.25`（与星级同一条曲线形状 `1 + 0.25 × (n − 1)` 的 n=2 档，
 * 但这里是 **Run-local 一次性**，不是永久星级 —— 两者互不写入对方）。
 */
export const GENERIC_GROWTH_DAMAGE_MULT = 1.25;

/**
 * **攻击加快**的倍率：`节奏键 × 0.75`（间隔缩短 ⇒ 单位时间攻击次数 ≈ ×1.33）。
 * 与 `heavyShell` 的 `fastReload`（`cooldownMs 1000 → 650`，≈0.65×）同一量级、
 * **略保守** —— 它是给 6 件武器共用的骨架值，不做逐武器调参。
 */
export const GENERIC_GROWTH_CADENCE_MULT = 0.75;

/**
 * `hammer` 的节奏键 `windupPauseSteps` 的**基准值**（= 行为代码默认）。
 *
 * ⚠️ 为什么不能在 canonical 里读：正式 `content.ts` 的 hammer **只声明了 `baseDamage`**，
 *    它的挥击节奏参数（`windupPauseSteps` / `swingSpeedRadPerStep` …）**只存在于
 *    `src/battle/hammerBehavior.ts` 的 `HAMMER_DEFAULT_PARAMS`**（Q1 矩阵已记录这一事实）。
 *    `readHammerParams` 是 `num(key, DEFAULT)` 逐键读取 ⇒ 本局 overlay **写进去就生效**；
 *    这里只需要「从哪个基准值往下缩」。
 * ⚠️ 该值与 `HAMMER_DEFAULT_PARAMS.windupPauseSteps` **同源**这件事由 targeted 测试
 *    （`productRunWeaponBasicBuildR7` 的 G-02b）**读行为真源逐值钉死** —— 不改 `src/battle/`。
 */
export const HAMMER_WINDUP_PAUSE_BASE = 20;

/** 非零有限数（读 canonical 参数用）。 */
function numOf(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * 该武器**自己的**伤害键：`behaviorParams` 里「顶层 + 数值 + 键名含 `damage`」的**唯一**键。
 *
 * ⚠️ 与 `src/core/buildSnapshot.ts` 的 `isDamageKey` 同一规则（顶层键名含 `damage`）。
 * ⚠️ **恰一个**才返回；0 个或多个 ⇒ `null`（不猜）。
 *    实测 7 件各恰一个（`projectileDamage` ×3 + `projectileDamage`(fire/laser/mg/sg) /
 *    `baseDamage` ×2）；嵌套的 `saw.hitPolicy.damage` 不是顶层键 ⇒ 不参与（`saw` 本就被 BLOCK）。
 */
export function damageParamKeyOf(params: Readonly<Record<string, unknown>>): string | null {
  const hits = Object.keys(params).filter((k) => /damage/i.test(k) && numOf(params[k]) !== null);
  return hits.length === 1 ? hits[0]! : null;
}

export function weaponDamageParamKey(def: FunctionalPartDef): string | null {
  return damageParamKeyOf((def.behaviorParams ?? {}) as Record<string, unknown>);
}

/**
 * 该武器**自己的**节奏键与**基准值**（Q1 真源；见本文件头「节奏键」三条）。
 *
 * 判据顺序就是语义顺序：
 *   ① canonical 有 `cooldownMs` ⇒ `{cooldownMs}`（两次攻击之间的真实冷却）；
 *   ② 否则取该 behavior **自己的**接触 / 前摇间隔键（`restSteps`）；
 *   ③ 该键**只在行为默认里**（`hammer.windupPauseSteps`）⇒ 用文档化基准
 *      `HAMMER_WINDUP_PAUSE_BASE`。
 * 都取不到 ⇒ `null`（**不强行统一**，该项对这件武器就不提供）。
 */
const CONTACT_CADENCE_KEYS: Readonly<Record<string, string>> = {
  hammer: 'windupPauseSteps',
  rammer: 'restSteps',
};

export function cadenceGrowthOf(
  behavior: string,
  params: Readonly<Record<string, unknown>>,
): { readonly key: string; readonly base: number } | null {
  const cooldown = numOf(params['cooldownMs']);
  if (cooldown !== null) return { key: 'cooldownMs', base: cooldown };
  const key = CONTACT_CADENCE_KEYS[behavior];
  if (!key) return null;
  const inContent = numOf(params[key]);
  if (inContent !== null) return { key, base: inContent };
  if (key === 'windupPauseSteps') return { key, base: HAMMER_WINDUP_PAUSE_BASE };
  return null;
}

export function weaponCadenceGrowth(
  def: FunctionalPartDef,
): { readonly key: string; readonly base: number } | null {
  return cadenceGrowthOf(def.behavior, (def.behaviorParams ?? {}) as Record<string, unknown>);
}

/**
 * 把一批通用成长**依次**作用到当前参数上，返回**要合并进 `behaviorParams` 的字段**。
 *
 * ⚠️ 顺序敏感：每一步都从**上一步的结果**读当前值 ⇒ 同一项出现两次会**复合**
 *    （`×1.25 → ×1.5625`），而不是每次都从 canonical 重算。本批的池子不开重复项，
 *    但这条语义让「读当前值」成为结构性事实，而不是靠池子自觉。
 * ⚠️ 只读/只写**该武器自己已经在读的键** ⇒ 不新增任何字段语义、不改 behavior。
 */
export function genericGrowthParamsOf(
  behavior: string,
  params: Readonly<Record<string, unknown>>,
  ids: readonly GenericGrowthId[],
): Record<string, number> {
  let current: Record<string, unknown> = { ...params };
  const out: Record<string, number> = {};
  for (const id of ids) {
    if (id === 'damageUp') {
      const key = damageParamKeyOf(current);
      const base = key ? numOf(current[key]) : null;
      if (!key || base === null) continue;
      const next = Math.round(base * GENERIC_GROWTH_DAMAGE_MULT);
      out[key] = next;
      current = { ...current, [key]: next };
      continue;
    }
    const cadence = cadenceGrowthOf(behavior, current);
    if (!cadence) continue;
    const next = Math.max(1, Math.round(cadence.base * GENERIC_GROWTH_CADENCE_MULT));
    out[cadence.key] = next;
    current = { ...current, [cadence.key]: next };
  }
  return out;
}

/**
 * 非 cannon 局的**通用候选池**（3 项，与 Cannon 第一层池同形状）。
 *
 * ⚠️ 第 3 项 `emergencyRepair` 是**复用**既有内容（`affectsWeapon: false`，对任何武器都成立）
 *    —— 它把池子撑到 3 张，让「继续改装」分支走到第三次选择时**永不为空**
 *    （非 Cannon 路径没有第二层专属内容，这是骨架期的结构性保底，不是新增品项）。
 * ⚠️ 「某件武器适不适用某一项」不由本函数回答：`rateUp` 对取不到节奏键的武器是**空操作**
 *    （`weaponOverlayMods` + `genericGrowthParamsOf` 都不写任何字段），本批实测 6/6 都有键。
 */
export const RUN_GENERIC_CHOICE_POOL: readonly RunBuildId[] = ['damageUp', 'rateUp', 'emergencyRepair'];

/** 通用候选池的选项定义（剔除本局**已拥有**的项 —— 与 Cannon 三池同一去重纪律）。 */
export function runGenericChoiceDefs(
  owned: readonly RunBuildId[],
): readonly { id: RunBuildId; label: string; note: string }[] {
  const out: { id: RunBuildId; label: string; note: string }[] = [];
  for (const id of RUN_GENERIC_CHOICE_POOL) {
    if (owned.includes(id)) continue;
    const growth = isGenericGrowth(id) ? genericGrowthById(id) : undefined;
    const mod = growth ? undefined : runModifierById(id);
    const def = growth ?? mod;
    if (!def) continue;
    out.push({ id: def.id as RunBuildId, label: def.label, note: def.note });
  }
  return out;
}

/** 本局 Build 的某一项（Cannon 强化 **或** 通用成长；`chooseRunBuff` 的统一解析入口）。 */
export interface RunBuildOption {
  readonly id: RunBuildId;
  readonly label: string;
  readonly note: string;
  /** 选择后写入冒险日志的自然语言。 */
  readonly logText: string;
}

export function runBuildOptionById(id: string): RunBuildOption | undefined {
  const growth = genericGrowthById(id);
  if (growth) {
    return { id: growth.id, label: growth.label, note: growth.note, logText: growth.logText };
  }
  const mod = runModifierById(id);
  return mod ? { id: mod.id, label: mod.label, note: mod.note, logText: mod.logText } : undefined;
}

/** 本局 Build 是否包含某一项（运行时按能力分派）。 */
export function buildHas(build: readonly RunBuildId[], id: RunBuildId): boolean {
  return build.includes(id);
}

/* --------------------------------------------------- 本局 registry / 快照 */

/** 把「单个 id / id 数组 / null」统一成数组（兼容旧调用点）。 */
export function normalizeBuild(
  build: RunBuildId | readonly RunBuildId[] | null | undefined,
): readonly RunBuildId[] {
  if (build == null) return [];
  return typeof build === 'string' ? [build] : [...build];
}

/**
 * PRODUCT-LOOP-R6-RUN-WEAPON-SOURCE-OF-TRUTH｜**本局 Run 的基准武器**（唯一规则，必改 1）。
 *
 * 规则只有一句话：
 *
 *     玩家装备什么正式武器，Product Run 就以**该武器自己的 canonical Def** 作为运行 base。
 *
 * 判据 = 玩家装载 `BuildSnapshot` 里**按装配顺序第一件** `category === 'weapon'` 的件
 * （`snapshot.functionals` 的顺序就是挂点装配顺序 —— 与 `runCompatibility` /
 * `playerLoadout.weaponEntries` 读的是同一份序列，不再有第二套「哪件是主武器」的定义）。
 *
 * ⚠️ **刻意不返回「默认 / 兜底武器」**：车上没有武器 ⇒ `null`。
 *    「没有武器」是资格层要**拒绝创建 Run** 的情形（`runLoadoutCompat` / `runCompatibility`），
 *    不是底层可以静默替换成某件武器（必改 E：禁止 silent fallback）。
 *
 * ⚠️ 为什么需要 `reg`：`snapshot.functionals` 只有 `defId`，「哪件是武器」由**正式内容库的
 *    `category` 分类字段**回答（与 `product/playerLoadout.isWeaponDefId` 同源）。
 *    默认参数取一份正式 `createRegistry()` 副本；调用点已有 registry 时应显式传入。
 */
export function resolveRunBaseWeaponDefId(
  snapshot: BuildSnapshot,
  reg: ContentRegistry = createRegistry(),
): string | null {
  for (const install of snapshot.functionals) {
    if (reg.functionals.get(install.defId)?.category === 'weapon') return install.defId;
  }
  return null;
}

/**
 * Build 里**真正改武器数值**、且**对本局基准武器适用**的那些项（按选择顺序 → 后选的覆盖先选的）。
 *
 * ⚠️ PRODUCT-LOOP-R6（必改 2）：Cannon 的 overlay 数值表全是 Cannon 自己的 `behavior`
 *    与字段名，因此**只有基准武器就是 Cannon 时它们才适用**。基准武器是别的武器时
 *    **不套** Cannon 的 behavior / projectile / reload / recoil（必改 E：不适用 ≠ 回退成 Cannon）。
 *
 * ⚠️ PRODUCT-LOOP-R7-WEAPON-BASIC-BUILD-CONTENT：本函数现在是**两条互斥支路**：
 *
 *   - `baseWeaponDefId === 'cannon'` ⇒ **Cannon 冻结内容**（`heavyShell` / `twinCannon` /
 *     `fastReload` / `tripleLoad`），**显式排除**通用成长 ⇒ Cannon 一个字节都不动；
 *   - 否则（非 Cannon 基准武器 / `null`）⇒ **只放行通用成长**（`damageUp` / `rateUp`），
 *     Cannon 的那 5 项一律不适用。
 *
 *   `null`（车上没有武器）也走第二支 —— 它本来就不该存在（资格层会拒绝创建 Run），
 *   走到这里也只是拿到「对该武器自己的字段生效」的项，不会有任何 Cannon 特例泄漏。
 *
 * ⚠️ 默认参数 `RUN_BASE_WEAPON_DEF_ID` ⇒ 只传 `build` 的旧调用点**逐字节不变**。
 */
export function weaponOverlayMods(
  build: readonly RunBuildId[],
  baseWeaponDefId: string | null = RUN_BASE_WEAPON_DEF_ID,
): readonly RunBuildId[] {
  if (!baseWeaponDefId) return [];
  if (baseWeaponDefId === RUN_BASE_WEAPON_DEF_ID) {
    return build.filter(
      (m) => !isGenericGrowth(m) && RUN_MODIFIER_OVERLAY[m]?.affectsWeapon === true,
    );
  }
  return build.filter((m) => isGenericGrowth(m));
}

/** 本局专用部件 id（带前缀 → 不会撞上任何正式 defId）。单项时与旧口径 `run.mod.<id>` 一致。 */
export function runOverlayDefId(mod: RunBuildId): string {
  return `run.mod.${mod}`;
}

/**
 * 本局 Build 对应的 overlay 部件 id（**确定性**：由改武器的项按顺序拼接）。
 * 没有任何改武器的项 → `null`（本局武器就是它自己的正式 Def，无需重映射）。
 */
export function runBuildDefId(
  build: readonly RunBuildId[],
  baseWeaponDefId: string | null = RUN_BASE_WEAPON_DEF_ID,
): string | null {
  const mods = weaponOverlayMods(build, baseWeaponDefId);
  return mods.length === 0 ? null : `run.mod.${mods.join('+')}`;
}

/**
 * 本局**玩家侧**武器部件 id（= 玩家基线 + 改武器的项，确定性拼接）。
 *
 * - `playerBaseline = false` ⇒ 与旧口径 `runBuildDefId()` **逐字相同**
 *   （未选「改武器」项时仍是 `null` ⇒ 本局武器就是它自己的正式 Def，零重映射）。
 * - `playerBaseline = true` ⇒ 基准武器是 Cannon 时**恒有 id**（哪怕一个 Modifier 都没选）：
 *   因为「玩家侧 120」必须由一件**独立部件**承载 —— 正式 `cannon` 键在任何情况下都得保持 80。
 *
 * ⚠️ PRODUCT-LOOP-R6（必改 2）：`playerBaseline` 是 **Cannon 专属基线**（`PRODUCT_RUN_CANNON_BASE_DAMAGE`
 *    写的是 Cannon 的 `projectileDamage`）。基准武器不是 Cannon 时它**不适用** ——
 *    既不加 `@base` 段，也不把 120 写进别的武器（否则就是把 Cannon 的 damage base 套给其它武器）。
 *    ⇒ 此时本函数退化成 `runBuildDefId()`，而非 Cannon 武器的武器项本来也不适用 ⇒ 返回 `null`。
 *
 * ⇒ 各条路径的 id 互不冲突（基线那段用 `@base` 标记，它不是任何 `RunModifierId`）。
 */
export function runPlayerWeaponDefId(
  build: readonly RunBuildId[],
  playerBaseline: boolean,
  baseWeaponDefId: string | null = RUN_BASE_WEAPON_DEF_ID,
): string | null {
  if (!(playerBaseline && baseWeaponDefId === RUN_BASE_WEAPON_DEF_ID)) {
    return runBuildDefId(build, baseWeaponDefId);
  }
  const mods = weaponOverlayMods(build, baseWeaponDefId);
  return `run.mod.${[RUN_PLAYER_BASE_TOKEN, ...mods].join('+')}`;
}

/**
 * 以本局**基准武器自己的 canonical Def** 为基准派生本局变体：把改武器的项按顺序
 * **浅合并** `behaviorParams`（未声明字段一律保留正式值 → 例如三连装填只是把
 * `burstRounds` 从 2 抬到 3，伤害 / 半径 / 质量 / 弹速 / 冷却全部沿用）。
 *
 * ⚠️ PRODUCT-LOOP-R7：`weaponOverlayMods` 现在会返回两类项，合成方式**刻意不同**：
 *
 *   - **Cannon 冻结项**（`heavyShell` … `tripleLoad`）⇒ 沿用旧逻辑：`behavior` 与
 *     `behaviorParams` 都取 overlay 表（表里 `behavior` 恒为 `'cannon'` = base 自己的
 *     ⇒ 对 Cannon 而言与改前**逐字段相同**）；
 *   - **通用成长**（`damageUp` / `rateUp`）⇒ **只合并数值**，`behavior` 保持 `base.behavior`
 *     —— 这是「hammer 选了成长仍然是 hammer」这条验收的**结构性**保证：本支路里根本没有
 *     任何代码可以改写 `behavior`。
 */
export function composeRunWeaponDef(
  base: FunctionalPartDef,
  build: readonly RunBuildId[],
  baseWeaponDefId: string | null = RUN_BASE_WEAPON_DEF_ID,
): FunctionalPartDef {
  let behavior = base.behavior;
  let params: Record<string, unknown> = { ...(base.behaviorParams ?? {}) };
  for (const m of weaponOverlayMods(build, baseWeaponDefId)) {
    if (isGenericGrowth(m)) {
      params = { ...params, ...genericGrowthParamsOf(behavior, params, [m]) };
      continue;
    }
    const o = RUN_MODIFIER_OVERLAY[m];
    behavior = o.behavior;
    params = { ...params, ...o.behaviorParams };
  }
  return { ...base, behavior, behaviorParams: params };
}

/**
 * 玩家侧本局武器 = 正式 Cannon → **玩家基线**（可选）→ Run-local Modifier（浅合并）。
 *
 * 顺序与 `PRODUCT_RUN_CANNON_BASE_DAMAGE` 的文档一致：基线先写进 `behaviorParams`，
 * Modifier 再覆盖自己声明的那几项 ⇒ 「基线只抬伤害」「Modifier 只改自己那几项」
 * 两者不会互相吞掉，也不会让 Modifier 的既有语义发生漂移。
 *
 * `playerBaseline = false` ⇒ 与改前**逐字段相同**（正式 Cannon + Modifier 浅合并）。
 */
export function composePlayerRunWeaponDef(
  base: FunctionalPartDef,
  build: readonly RunBuildId[],
  playerBaseline: boolean,
  baseWeaponDefId: string | null = RUN_BASE_WEAPON_DEF_ID,
): FunctionalPartDef {
  // ⚠️ PRODUCT-LOOP-R6（必改 2）：基线 = `PRODUCT_RUN_CANNON_BASE_DAMAGE`（Cannon 的
  //    `projectileDamage`）⇒ **只对 Cannon 生效**。基准武器是别的武器时不得写它。
  const baselineApplies = playerBaseline && baseWeaponDefId === RUN_BASE_WEAPON_DEF_ID;
  const baselined: FunctionalPartDef = baselineApplies
    ? {
        ...base,
        behaviorParams: {
          ...(base.behaviorParams ?? {}),
          projectileDamage: PRODUCT_RUN_CANNON_BASE_DAMAGE,
        },
      }
    : base;
  return composeRunWeaponDef(baselined, build, baseWeaponDefId);
}

/**
 * 造一份**本局专用 registry**（正式 `createRegistry()` 的独立副本）。
 *
 * - 没有改武器的项、且未开玩家基线（未选 / 只选了能力类）→ 直接返回正式副本，
 *   行为与基础状态完全一致；
 * - 有改武器的项 或 开了玩家基线 → 额外注册一个本局合成的 overlay 部件，
 *   **正式 `cannon` 键仍在副本里保持原值**（因此可以逐字段对拍「正式定义未被改写」，
 *   也正因如此**敌方 `RangedTurret` 的 cannon 不受玩家基线影响**）。
 *
 * ⚠️ `playerBaseline` 只影响**多注册出来的那一件 overlay 部件**；正式键集合与其它部件
 *    一字不动。默认 `false` ⇒ 既有 Lab / Validation / RDC 调用点逐字段不变。
 *
 * ⚠️ PRODUCT-LOOP-R6-RUN-WEAPON-SOURCE-OF-TRUTH：新增 `baseWeaponDefId`（默认 = 旧口径 `'cannon'`）。
 *
 * - 默认值 ⇒ **改前逐字节相同**（既有 Lab / Validation / RDC / 全部旧测试调用点）；
 * - 传入**玩家实际装备**的武器（`resolveRunBaseWeaponDefId`）⇒ overlay 以**该武器自己的
 *   canonical Def** 为 base 派生：装备 hammer ⇒ base 就是正式 hammer，不再「先拿 cannon 再套壳」；
 * - 装备不是 Cannon 时：Cannon 的武器项 overlay 一项都不适用、玩家基线不适用；
 *   ⚠️ **但通用成长（`damageUp` / `rateUp`）适用**（PRODUCT-LOOP-R7）⇒ 选了它就会注册一件
 *   以**该武器自己**为 base 派生、`behavior` 不变的本局部件；
 *   一个通用成长都没选 ⇒ `runPlayerWeaponDefId` 返回 `null` ⇒ **直接返回正式副本**
 *   （玩家用它自己的 canonical Def 打）；
 * - `baseWeaponDefId = null`（车上没有武器）⇒ 同上去掉基线，返回正式副本；
 *   资格层在此之前就会拒绝创建 Run（不在这里静默替换成某件武器）。
 */
export function createRunRegistry(
  build: RunBuildId | readonly RunBuildId[] | null | undefined,
  playerBaseline = false,
  baseWeaponDefId: string | null = RUN_BASE_WEAPON_DEF_ID,
): ContentRegistry {
  const mods = normalizeBuild(build);
  const reg = createRegistry();
  const defId = runPlayerWeaponDefId(mods, playerBaseline, baseWeaponDefId);
  if (!defId) return reg;
  const base = baseWeaponDefId ? reg.functionals.get(baseWeaponDefId) : undefined;
  if (!base) {
    throw new Error(`RunModifier: 正式 registry 缺少基准武器 "${baseWeaponDefId ?? 'null'}"`);
  }
  reg.functionals.set(
    defId,
    composePlayerRunWeaponDef(base, mods, playerBaseline, baseWeaponDefId),
  );
  return reg;
}

/**
 * PRODUCT-LOOP-P0-RUN-BUILD-LOADOUT-COMPATIBILITY｜**本局装载里有没有可运行的基准武器**。
 *
 * = 「装载里是否存在一件正式武器」（= `resolveRunBaseWeaponDefId()` 非 `null`）。
 * 这是 `applyRunModifiersToSnapshot` 那个 `throw` 的**同一判据**，刻意抽成单一函数：
 *
 *   - 注入路径（运行时）：不满足 ⇒ 继续**显式抛错**（invariant 一字不动，见下方）；
 *   - 创建路径（Run 创建前的资格检查）：**同一个函数**回答「这局能不能跑」，
 *     从而**没有第二套「什么算兼容」的定义** —— 两边不可能漂移。
 *
 * ⚠️ PRODUCT-LOOP-R6-RUN-WEAPON-SOURCE-OF-TRUTH｜**语义已参数化，不是「有没有 cannon」**：
 *    改前它写死 `install.defId === RUN_BASE_WEAPON_DEF_ID`（cannon），于是「装备不是 Cannon
 *    的合法装载」被判成「没有基准武器」并在 DAY3 注入时 throw（`runCompatibility` 头部记录的
 *    那条真人复现）。现在判据 = 「这份装载里解析得出一件正式武器」——装备 hammer 就是 hammer，
 *    装备 laser 就是 laser，**不再要求车上有 cannon**。
 *
 * ⚠️ 刻意**不**按「某个固定槽位是不是武器」判断：装载里哪一件是武器由
 *    **真实装配结果**回答（`category === 'weapon'`），固定槽位推断一换车 / 一换槽就失效
 *    —— 口径与 `runPlayerLoadout.ts` 头部「刻意不暴露 weaponDefId」那条纪律一致。
 */
export function snapshotHasRunBaseWeapon(
  snapshot: BuildSnapshot,
  reg: ContentRegistry = createRegistry(),
): boolean {
  return resolveRunBaseWeaponDefId(snapshot, reg) !== null;
}

/**
 * 把本局 BuildSnapshot 里**基准武器**的 `defId` 重映射到本局 overlay 部件。
 *
 * 只动 `defId` 一个字段 → 挂点 / 星级 / 装配 / 其它部件全部原样；
 * 没有任何改武器的项 → 原样返回（本局武器就是正式 Cannon）；
 * 有改武器的项却找不到基准武器时**显式抛错**（不静默跳过，否则「选了强化但没生效」会变成静默失败）。
 *
 * ⚠️ PRODUCT-LOOP-P0｜这个 `throw` **是刻意保留的强 invariant**，不是待修的异常处理问题：
 *    UI / Choice 层把不兼容的 Modifier 送进 Runtime **本身就是程序错误**。
 *    ⇒ **禁止**把它改成 silently skip / `return snapshot` / try-catch 吞掉。
 *    真正的修复发生在**两层资格**上：产品侧「开始冒险」守门（`src/product/runCompatibility.ts`）
 *    + Lab 侧「Run 创建资格」（`runLoadoutCompat.ts` / `runPageScene.resolveRunPlayerLoadout`）
 *    —— 于是这个分支在真实流程里**不可达**，而它一旦可达就仍然响亮地报错。
 *
 * ⚠️ 判据本体已抽到 `snapshotHasRunBaseWeapon()`（与创建期资格检查同源），
 *    本函数只负责「按判据决定注入还是抛错」。
 *
 * ⚠️ PRODUCT-LOOP-R2-RECOVERY-ONBOARDING-CLARITY：新增 `playerBaseline`（默认 `false`）。
 *    `false` ⇒ 本函数逐字节等同于改前；`true` ⇒ 额外把基准武器指向「玩家基线 overlay」
 *    （承载玩家侧 120）。**强 invariant 一字未动**：只要真的有 Modifier 要注入却找不到
 *    基准武器，照样 throw —— 新增的只是「纯基线、又没装 Cannon ⇒ 原样返回」这一条
 *    **非错误**分支（那局用的不是 Cannon，本基线不适用，无副作用）。
 *
 * ⚠️ PRODUCT-LOOP-R6-RUN-WEAPON-SOURCE-OF-TRUTH：新增 `baseWeaponDefId`（默认 = 旧口径 `'cannon'`）。
 *    「基准武器」从**写死的 cannon** 变成**调用方传入的、玩家实际装备的那件**
 *    （`resolveRunBaseWeaponDefId`，见 `RunBattleRuntime`）。
 *    重映射的对象随之变成**那件武器自己**：装备 hammer ⇒ 重映射的是 hammer 的件，
 *    `defId` 指向以**正式 hammer** 为 base 派生的本局部件 —— 不再有「先拿 cannon 再套壳」。
 *    ⇒ 必改 C：装备非 Cannon 的**合法装载**（车上有武器）不再因为「Snapshot 没有 cannon」throw；
 *      必改 E：base 只会是装配里真实存在的武器，**任何路径都不会静默换成 cannon**。
 *    强 invariant 保留在它真正该在的地方：**有适用项要注入、却找不到 base 件**才 throw。
 *
 * ⚠️ PRODUCT-LOOP-R7：非 Cannon 局现在**也可能**真的有适用项（通用成长）⇒ 本函数会正常
 *    重映射那件武器自己的 `defId`。`throw` 判据一字未改（仍按 `weaponOverlayMods(...).length`），
 *    因此「选了通用成长但车上那件武器不见了」照样响亮报错，不静默跳过。
 */
export function applyRunModifiersToSnapshot(
  snapshot: BuildSnapshot,
  build: RunBuildId | readonly RunBuildId[] | null | undefined,
  playerBaseline = false,
  baseWeaponDefId: string | null = RUN_BASE_WEAPON_DEF_ID,
): BuildSnapshot {
  const mods = normalizeBuild(build);
  const overlayId = runPlayerWeaponDefId(mods, playerBaseline, baseWeaponDefId);
  if (!overlayId) return snapshot;
  const hasBase = baseWeaponDefId
    ? snapshot.functionals.some((install) => install.defId === baseWeaponDefId)
    : false;
  if (!hasBase) {
    // 纯基线 / 无适用武器项 ⇒ 本局没有要注入的东西，原样返回（不是异常）。
    if (weaponOverlayMods(mods, baseWeaponDefId).length === 0) return snapshot;
    throw new Error(
      `RunModifier: 本局装载里没有 "${baseWeaponDefId ?? 'null'}"，无法注入强化 [${mods.join(', ')}]`,
    );
  }
  const functionals = snapshot.functionals.map((install) =>
    install.defId === baseWeaponDefId ? { ...install, defId: overlayId } : install,
  );
  return { ...snapshot, functionals };
}
