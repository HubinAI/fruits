/**
 * PRODUCT-LOOP-R6-RUN-WEAPON-SOURCE-OF-TRUTH｜「这份局外装备能不能跑完整 Run」的
 * **产品层唯一判断**（纯逻辑、零 DOM、零存档写入）。
 *
 * ── 这个模块解决的原始问题（历史，勿删：它是本模块存在的原因）───────────────
 * 改前 Run 底层把**运行武器硬绑 cannon**（`runModifiers.RUN_BASE_WEAPON_DEF_ID`）：
 *
 *     equipped = 非 cannon → Run 前几日正常 → DAY3 选择/进入 heavyShell → beginBattle
 *     → `applyRunModifiersToSnapshot()` 找不到 cannon → throw → Run 卡死
 *
 * ── PRODUCT-LOOP-R6 之后的现状（本模块判据的依据已经变了）────────────────────
 * 那个「硬绑」已从**底层**修掉（Queue：公共 Foundation 问题，禁止逐武器打补丁）：
 *
 *     Run base weapon = **玩家实际装备里装配顺序第一件正式武器**
 *     （`runModifiers.resolveRunBaseWeaponDefId()`；Run 以它自己的 canonical Def 作为运行 base）
 *
 * ⇒ 本模块回答的问题随之变成两段，而不是原来那一段：
 *
 *   ① 「车上有没有一件正式武器？」—— 没有 ⇒ 不能开始（`'no-weapon'`）；
 *   ② 「**这第一件武器**有没有完成完整 Run 的能力？」—— 没有 ⇒ 不能开始
 *      （`'unsupported-weapon'`）。
 *
 * ⚠️ 为什么判据是「**第一件**武器」（= 与局内 base 的同一件），而不是改前的
 *    「车上**存在**受支持武器」：base 现在由装配顺序决定，若只要求「车上存在 cannon」，
 *    就会出现「首页按 top 槽的 cannon 放行、局内却按 frontMass 的未支持武器跑」这种
 *    **两层不一致** —— 那正是本模块从第一天起就要根除的东西。
 *    ⇒ 产品侧与局内解析**同一件事**（装配顺序第一件 `category === 'weapon'` 的件）。
 *    ⚠️ 两侧**各自声明**（`core` / `lab` 不许被 `src/product/` 依赖，`src/product/` 也
 *      不许 import 那个实验原型目录 —— `R22b` 含 import 路径与注释）⇒ 一致性由
 *      `tests/productRunWeaponSourceOfTruthR6.test.ts` **机器钉死**（同一 draft 两侧解析必须同值）。
 *
 * ── 显式能力登记（必改 3：不许无脑 `= 所有 OFFICIAL_PARTS`）─────────────────
 * `FULL_RUN_SUPPORTED_WEAPON_IDS` 是**显式字面量**，登记门槛 5 条、缺一不可：
 *
 *   ① 正式可拥有 Weapon —— 在 `OFFICIAL_PARTS` 里且 `registry` 的 `category === 'weapon'`
 *   ② Snapshot 能解析 —— 该 defId 在正式 `registry.functionals` 里
 *   ③ 对应 behavior Runtime 真存在 —— `getBehaviorFactory(def.behavior)` 非 `undefined`
 *   ④ Collision / Damage / Result 链成立 —— 该武器**在产品主武器槽**（`WEAPON_SLOT` =
 *      `frontMass`）上真的能造成伤害，且能跑完一场真实战斗
 *   ⑤ 不需要新增玩法规则 —— 它用**自己的 canonical Def** 就能跑，不依赖为该武器新写的
 *      强化 / Buff / 专属机制，也**不需要改它的几何 / 挂点**才能打得到人
 *
 * ⚠️ ①②③ 由 `tests/productRunWeaponSourceOfTruthR6.test.ts` 逐条机器钉死；④ 由
 *    `tests/productRunWeaponRuntimeBatchR7.test.ts`（R6-BATCH 同轮新增）沿真实链**逐件实测伤害**
 *    钉死 —— 口径是 `RunBattleRuntime.playerWeaponHitSummary()` 按 partId 归组的**真实**
 *    `damage` 事件（不是读参数表、不是「跑得起来不崩」）；⑤ 是人工裁决，逐条写在下面备注里。
 *
 * ⚠️ **PRODUCT-LOOP-R6-RUNTIME-COMPLETE-WEAPON-BATCH（下称 R6-BATCH）对 ④ 的实测补强**：
 *    改前 ④ 只用「跑得起来、不崩」的 smoke 判定 ⇒ 一件**完全打不到对手**的武器也会通过。
 *    R6-BATCH 逐件沿真实链（canonical Def → behavior → factory → entity → attack →
 *    collision / projectile → damage → result）复核并**实测伤害**，据此把 `saw` 移出登记表
 *    （见下面「明确被拒」第 3 条）。判据现在要求的是「**产品槽位上真的打得出伤害**」，
 *    而不是「registry 里有一件定义」。
 *
 * ⚠️ 本文件**刻意不 import** `battle/behaviorRegistry`（那会把整个战斗运行时拖进产品首屏
 *    bundle）—— ③ 的校验放在测试里，产品侧只持**裁决结果**。
 *
 * ⚠️ 本模块**不做**字符串判断（Queue 必改 1 明令「不要在 UI 里靠字符串判断」）：
 *    输入是真实 `BuildDraft`，判断走正式内容库的 `category === 'weapon'` 分类字段。
 *
 * ⚠️ 已知留白（**如实披露，不在本 Queue 范围内**）：R2 的 Run 强化数值表
 *    （`heavyShell` / `twinCannon` / `fastReload` / `tripleLoad`）与玩家侧基线 120
 *    都是 **Cannon 专属**（字段名与 behavior 都是 Cannon 的）。装备非 Cannon 时这些项
 *    **不适用**（`runModifiers.weaponOverlayMods` 返回空），该武器用它自己的 canonical Def 打。
 *    ⇒ 「非 Cannon 的强化内容」是一条独立的 Run 内容设计 Queue，本 Queue 不设计、不新增。
 *
 * ⚠️ 承接上一条的**实测后果（R6-BATCH 记录，非本 Queue 修复项）**：因为整条 Run 的
 *    成长内容都是 Cannon 专属，非 Cannon 装备在本局**拿不到任何伤害成长**
 *    （三个第一层项与横向改装对它全是空操作，唯一真实收益是 `emergencyRepair` 的两次回耐久）。
 *
 *    实测口径（★1 / 零 Build / `playerBaseline: true` / **归因夹具** = 车上只留这一件武器，
 *    `top` 槽的锤也清掉 —— 否则测的是「那一套装配」而不是「这件武器」）：
 *
 *      | 武器            | 下界（跨场不修）      | 真实路线（DAY4 维修 + DAY5 紧急维修） |
 *      |---|---|---|
 *      | `cannon`        | ✅ COMPLETE（234.8） | ✅ COMPLETE（377.0） |
 *      | `flamethrower`  | ✅ COMPLETE（222.2） | ✅ COMPLETE（437.2） |
 *      | `machineGun`    | ✅ COMPLETE（580.9） | ✅ COMPLETE（657.1） |
 *      | `shotgun`       | ❌ 第 4 场阵亡       | ✅ COMPLETE（16.8，余量极薄） |
 *      | `hammer`        | ❌ 第 3 场阵亡       | ❌ 第 4 场阵亡 |
 *      | `rammer`        | ❌ 第 2 场阵亡       | ❌ 第 2 场阵亡 |
 *      | `laser`         | ❌ 第 1 场阵亡       | ❌ 第 1 场阵亡 |
 *
 *    ⚠️ 两笔维修都发生在 **DAY4 / DAY5**（都在第 3 场之前）；维修量 = 正式
 *       `EMERGENCY_REPAIR_FRACTION` × 上限、按缺口截断（与 `runPageState` 同一公式）。
 *    ⚠️ 归因夹具与**产品默认车**回答的是两个不同问题，不要混：产品默认车在 `top` 槽还挂着
 *       一把锤，实测 cannon 那台车的下界是**第 4 场阵亡**（含两次维修才 COMPLETE，36.3）
 *       ⇒ 「那台车的装配还有一条平衡留白」也是事实，但它的对象是**那台车**，不是「cannon 链」。
 *    ⚠️ 机器钉死：`R7-04b`（下界）/ `R7-04c`（真实路线）/ `R7-10`（cannon 全链不退化）。
 *
 *    这是**平衡 / 内容完成度**事实，不是 Runtime 缺口：这些武器都满足登记 5 条门槛
 *    （打得出真实伤害、用它自己的 canonical Def、不需要新规则）⇒ 本 Queue 按 Queue
 *    明文把它们**一并登记**（Queue：「Runtime 已完整、不需要新增规则」的武器一次性登记），
 *    「非 Cannon 的局内强化 / 平衡」留给独立内容 Queue。**不要把这条误读成放行标准放宽**
 *    —— `saw` 正是被 ④ / ⑤ 挡下的那一件（Runtime 齐、产品槽上打不到人）。
 */

import { registry } from '../core/content';
import { buildSnapshotFromDraft, type BuildDraft } from '../lab/buildEditorModel';
import type { FunctionalPartDef } from '../core/types';

/**
 * 支持「完整 Run」的武器 defId（**显式能力登记**，不是「全部正式部件」）。
 *
 * 逐条登记理由（都满足 5 条门槛；① ② ③ 由测试机器钉死，④ 由**实测伤害**钉死）：
 *
 *   | defId | behavior | ③ runtime | ④ 真实伤害路径（产品槽实测 / 第 1 场） | ⑤ 无需新玩法规则 |
 *   |---|---|---|---|---|
 *   | `cannon`        | cannon        | ✅ | projectileDamage 80（**正式键**；玩家侧基线独立为 120 — **实测 1080 / 9 命中**） | ✅ 现有 R2 强化体系的原生武器 |
 *   | `flamethrower`  | flamethrower  | ✅ | projectileDamage 8（短命火流） — **实测 1000 / 125 命中** | ✅ 用自身 canonical Def |
 *   | `hammer`        | hammer        | ✅ | baseDamage 90（Revolute 真实物理弧） — **实测 1080 / 12 命中** | ✅ 用自身 canonical Def |
 *   | `laser`         | laser         | ✅ | projectileDamage 160 — **实测 800 / 5 命中** | ✅ 用自身 canonical Def |
 *   | `machineGun`    | machineGun    | ✅ | projectileDamage 20（burst 7 发） — **实测 1000 / 50 命中** | ✅ 用自身 canonical Def |
 *   | `rammer`        | rammer        | ✅ | baseDamage 70（Prismatic 伸出撞击） — **实测 910 / 13 命中** | ✅ 用自身 canonical Def |
 *   | `shotgun`       | shotgun       | ✅ | projectileDamage 30（5 发固定扇形） — **实测 1140 / 38 命中** | ✅ 用自身 canonical Def |
 *
 * ⚠️ 「实测」口径 = `RunBattleRuntime.playerWeaponHitSummary()` 里来源部件 = 该武器 defId 的
 *    真实 `damage` 事件之和（`DamageResolver` 真的从对方 HP 减掉的那个数），不是读 UI、
 *    不是读参数表。夹具 = 产品默认车 + 主武器槽换成该武器、车上**只留它一件**
 *    （避免 `top` 槽的 hammer 混入归因）、`playerBaseline: true`（产品真实路径）。
 *
 * **明确被拒的武器**：
 *   - `spear` 刺 —— ③ 不满足：它的 `behavior` 是 `'ram'`，而 `behaviorRegistry.FACTORIES`
 *     **没有注册 `'ram'`**（`planckBattleOrchestrator` 遇 `!factory` 会跳过该 part 的运行时，
 *     只有 collider 与 contact 伤害链路存在）⇒ **Runtime 不完整，不登记**。
 *     ⚠️ R6-BATCH 已在**真实代码**里逐处穷尽核对过「是否有一份写了但没接上的正式 ram
 *     behavior」：`src/battle/` 下**没有** `ramBehavior.ts`，`behavior: 'ram'` 只出现在
 *     `content.ts` 的两处 def 与 `combatEvents.ts` 的一句注释里
 *     ⇒ Queue 的例外条件（「除非真实代码中找到已经存在但此前漏接的正式 ram behavior」）
 *     **不成立** ⇒ 保持 BLOCK，本 Queue **不补** behavior。
 *     ⚠️ 如实记录：`spear` **确实**能通过 `contactOnce` 路径打出伤害（实测 600~1020）
 *     —— 但这正是 Queue 点名不许据以判完整的情形（「碰撞已经能造成伤害」≠ Runtime 完整）。
 *   - `ramHead` 冲撞头 —— ① 不满足：它是 `prototype/hold`，**不在 `OFFICIAL_PARTS`**
 *     （玩家永远拿不到），连登记资格都没有。
 *   - `saw` 圆锯 —— **④ / ⑤ 不满足**（R6-BATCH 实测发现，R6 误登记后纠正）：
 *     它的 behavior Runtime 与 `contactTick` 伤害链**都存在**（挂在 `front` 槽实测
 *     25 命中 × 8 = 200 真实伤害），但挂在**产品主武器槽** `frontMass` 上时**打不到人** ——
 *     原因完全在几何：圆锯 collider = 半径 28 的圆、圆心 = part 原点 = `frontMass` 挂点
 *     （`watermelonBody.functionalHardpoints.frontMass = {x: 45}`）⇒ 圆锯前沿本地 x = 73，
 *     而车身 collider 前沿 x = 85（`width: 170`）⇒ **正面接敌永远由车身先接触**，
 *     圆锯被包在车身里，`contactTick` 结构上无从登记。
 *     实测：4 场 Run 的第 1 场 **0 命中 / 0 伤害**；穷尽全部 7 套 Lab Encounter，
 *     只有 2 套偶发 1~2 次接触（合计 8~16 点伤害，对 1000+ HP 的对手不构成伤害能力）。
 *     ⚠️ 既有 saw 测试**全部**把它挂在 `front`（本地 x = 78 ⇒ 前沿 x = 106 > 85，能打出车身）
 *     ⇒ 这个缺口此前从未被测到 —— 「挂点换了，武器的有效接触面就失效」是设计缺口，
 *     让它生效必须改**挂点或几何** = 新增规则（⑤ 不成立）⇒ **保持 BLOCK，记录缺口**，
 *     本 Queue 不改它的 collider / 数值 / 挂点。
 *   - `pushRod` / `lifter` / `thruster` —— ① 不满足（`category === 'gadget'`，不是武器）。
 */
export const FULL_RUN_SUPPORTED_WEAPON_IDS: readonly string[] = [
  'cannon',
  'flamethrower',
  'hammer',
  'laser',
  'machineGun',
  'rammer',
  'shotgun',
];

/** 车上**没有武器**时的主轴提示（`'no-weapon'`）。 */
export const FULL_RUN_NO_WEAPON_LEAD = '车上还没有武器，无法开始完整冒险';
/** 有武器、但这件武器**不在能力登记表**里时的主轴提示。 */
export const FULL_RUN_UNSUPPORTED_LEAD = '当前原型尚不支持这件武器进行完整冒险';
/** 两种情况共用的下一步提示（文案里的「调整战车」与 `homePage.HOME_GARAGE_LABEL` 呼应）。 */
export const FULL_RUN_UNSUPPORTED_HINT = '请先调整战车';

/**
 * ⚠️ 刻意**不**在这里再声明一个「调整战车」按钮文案：那个入口的产品文案真源是
 *    `homePage.HOME_GARAGE_LABEL`（首页与车库共用同一个入口）。
 *    两个同值常量并存 = 第二份真源，改一处忘一处就会漂移
 *    （`FULL_RUN_UNSUPPORTED_HINT` 里的「调整战车」只是文案呼应，不参与渲染）。
 */

/**
 * 不可开始的原因。
 *   - `'ok'`                 —— 可以开始完整 Run；
 *   - `'no-weapon'`          —— 车上**没有任何武器**（空槽 / 只有辅助件）；
 *   - `'unsupported-weapon'` —— 有武器，但**基准武器**（装配顺序第一件）不在能力登记表里。
 */
export type FullRunCompatReason = 'ok' | 'no-weapon' | 'unsupported-weapon';

/** 完整 Run 资格读数（页面 / 探针 / 测试三方同源，页面禁止自行推导）。 */
export interface FullRunCompat {
  readonly ok: boolean;
  readonly reason: FullRunCompatReason;
  /** 当前**已装备**的武器 defId（顺序 = 装配顺序；空 = 没有武器）。 */
  readonly equippedWeaponIds: readonly string[];
  /**
   * 本局 Run 会使用的**基准武器** defId = 装配顺序第一件武器（`null` = 没有武器）。
   * = 局内 `resolveRunBaseWeaponDefId()` 的同一件事（两侧各自声明，测试钉死同值）。
   */
  readonly baseWeaponDefId: string | null;
  /** 支持清单（原样报出，供探针 / E2E 断言，不在页面上写死）。 */
  readonly supportedWeaponIds: readonly string[];
  /** 支持清单的**展示名**（从正式内容库现读，不是页面里的第二份字面量）。 */
  readonly supportedWeaponNames: readonly string[];
  /** 不可执行时的主提示（`ok` ⇒ `null`）。 */
  readonly notice: string | null;
  /** 不可执行时的下一步提示（`ok` ⇒ `null`）。 */
  readonly hint: string | null;
}

/** 该 defId 是否受支持（唯一判据，供测试与页面共用）。 */
export function supportsFullRun(defId: string): boolean {
  return FULL_RUN_SUPPORTED_WEAPON_IDS.includes(defId);
}

/**
 * 读出「这份装备能不能开始完整 Run」。
 *
 * 纯函数；不写任何存档、不抛错 —— 它的调用点在**按下开始之前**，
 * 那里要做的是「不放行」，而不是「抛异常」。
 */
export function fullRunCompat(draft: BuildDraft): FullRunCompat {
  const snapshot = buildSnapshotFromDraft(draft, registry, 'run-compat');
  // ⚠️ 顺序 = 装配顺序（`snapshot.functionals` 的顺序），第一件就是本局 Run 的基准武器。
  const equippedWeaponIds = snapshot.functionals
    .filter((install) => registry.functionals.get(install.defId)?.category === 'weapon')
    .map((install) => install.defId);
  const baseWeaponDefId = equippedWeaponIds.length > 0 ? equippedWeaponIds[0] : null;
  const ok = baseWeaponDefId !== null && supportsFullRun(baseWeaponDefId);
  const reason: FullRunCompatReason = ok
    ? 'ok'
    : baseWeaponDefId === null
      ? 'no-weapon'
      : 'unsupported-weapon';
  return {
    ok,
    reason,
    equippedWeaponIds,
    baseWeaponDefId,
    supportedWeaponIds: FULL_RUN_SUPPORTED_WEAPON_IDS,
    supportedWeaponNames: FULL_RUN_SUPPORTED_WEAPON_IDS.map(
      (defId) => (registry.functionals.get(defId) as FunctionalPartDef | undefined)?.name ?? defId,
    ),
    notice: ok ? null : reason === 'no-weapon' ? FULL_RUN_NO_WEAPON_LEAD : FULL_RUN_UNSUPPORTED_LEAD,
    hint: ok ? null : FULL_RUN_UNSUPPORTED_HINT,
  };
}

/** 便捷布尔入口（Queue 必改 1 要求的那个单一判断）。 */
export function canStartFullRun(draft: BuildDraft): boolean {
  return fullRunCompat(draft).ok;
}
