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
 *   ④ Collision / Damage / Result 链成立 —— 该武器有真实伤害路径，且能跑完一场真实战斗
 *   ⑤ 不需要新增玩法规则 —— 它用**自己的 canonical Def** 就能跑，不依赖为该武器新写的
 *      强化 / Buff / 专属机制
 *
 * ⚠️ ①②③ 由 `tests/productRunWeaponSourceOfTruthR6.test.ts` 逐条机器钉死；④ 由同一测试里的
 *    **真实物理 smoke**（每件登记武器真的打一场）钉死；⑤ 是人工裁决，逐条写在下面的备注里。
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
 */

import { registry } from '../core/content';
import { buildSnapshotFromDraft, type BuildDraft } from '../lab/buildEditorModel';
import type { FunctionalPartDef } from '../core/types';

/**
 * 支持「完整 Run」的武器 defId（**显式能力登记**，不是「全部正式部件」）。
 *
 * 逐条登记理由（都满足 5 条门槛；① ② ③ 由测试机器钉死，④ 由真实物理 smoke 钉死）：
 *
 *   | defId | behavior | ③ runtime | ④ 真实伤害路径 | ⑤ 无需新玩法规则 |
 *   |---|---|---|---|---|
 *   | `cannon`        | cannon        | ✅ | projectileDamage 80            | ✅ 现有 R2 强化体系的原生武器 |
 *   | `flamethrower`  | flamethrower  | ✅ | projectileDamage 8（短命火流）  | ✅ 用自身 canonical Def |
 *   | `hammer`        | hammer        | ✅ | baseDamage 90（Revolute 真实物理弧） | ✅ 用自身 canonical Def |
 *   | `laser`         | laser         | ✅ | projectileDamage 160           | ✅ 用自身 canonical Def |
 *   | `machineGun`    | machineGun    | ✅ | projectileDamage 20（burst 7 发） | ✅ 用自身 canonical Def |
 *   | `rammer`        | rammer        | ✅ | baseDamage 70（Prismatic 伸出撞击） | ✅ 用自身 canonical Def |
 *   | `saw`           | saw           | ✅ | hitPolicy.damage 8（contactTick 持续切割） | ✅ 用自身 canonical Def |
 *   | `shotgun`       | shotgun       | ✅ | projectileDamage 30（5 发固定扇形） | ✅ 用自身 canonical Def |
 *
 * **明确被拒的武器**：
 *   - `spear` 刺 —— ③ 不满足：它的 `behavior` 是 `'ram'`，而 `behaviorRegistry.FACTORIES`
 *     **没有注册 `'ram'`**（`planckBattleOrchestrator` 遇 `!factory` 会跳过该 part 的运行时，
 *     只有 collider 与 contact 伤害链路存在）⇒ **Runtime 不完整，不登记**。
 *     ⚠️ 本 Queue **禁止**为它补 behavior（「不补 Spear ram」是 Queue 明文禁止项）。
 *   - `ramHead` 冲撞头 —— ① 不满足：它是 `prototype/hold`，**不在 `OFFICIAL_PARTS`**
 *     （玩家永远拿不到），连登记资格都没有。
 *   - `pushRod` / `lifter` / `thruster` —— ① 不满足（`category === 'gadget'`，不是武器）。
 */
export const FULL_RUN_SUPPORTED_WEAPON_IDS: readonly string[] = [
  'cannon',
  'flamethrower',
  'hammer',
  'laser',
  'machineGun',
  'rammer',
  'saw',
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
