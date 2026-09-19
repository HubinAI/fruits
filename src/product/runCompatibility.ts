/**
 * PRODUCT-LOOP-P0-RUN-BUILD-LOADOUT-COMPATIBILITY｜「这份局外装备能不能跑完整 Run」的
 * **产品层唯一判断**（纯逻辑、零 DOM、零存档写入）。
 *
 * ── 真人 P0（本模块存在的原因）────────────────────────────────────────────
 * 正式产品允许玩家装备非 Cannon Weapon（局外已支持 `cannon` / `spear` / `hammer`），
 * 但**已真人验证的 Run Build 内容全部围绕 cannon 派生** —— `heavyShell` / `twinCannon` /
 * `fastReload` / `kineticBurst` / `tripleLoad`（见 `runModifiers.ts` 的
 * `RUN_BASE_WEAPON_DEF_ID` 与 overlay 数值表）。于是这条链真实复现：
 *
 *     equipped = 非 cannon → Run 前几日正常 → DAY3 选择/进入 heavyShell → beginBattle
 *     → `applyRunModifiersToSnapshot()` 找不到 cannon
 *     → throw：RunModifier: 本局装载里没有 "cannon"，无法注入强化 [heavyShell] → Run 卡死
 *
 * 根因不是异常处理，而是**没有「开始完整 Run 的资格」这一层**：
 * R1-C 只验证了「非 cannon 的第一场 Battle」，**没覆盖**「非 cannon → 第一次强化 →
 * 下一场 Battle」—— 强化注入发生在**第二次**战斗创建时，所以第一场看不出来。
 *
 * ── 产品裁决（Queue 明文，逐字落地）──────────────────────────────────────
 * PRODUCT-LOOP-R2 当前只验证 **Cannon 永久成长闭环**。在 Spear / Hammer 有正式
 * Run Build 内容之前：**它们不得进入完整 Run**。
 * ⚠️ 因此本模块**不为** Spear / Hammer 临时设计任何 Buff —— 那是 Queue 明令冻结的。
 *    这里只回答「能不能开始」，不新增一点战斗内容。
 *
 * ── 判据口径（与局内资格**同一条**，不出现第二套「什么算兼容」）─────────────
 * 判据 = **「当前已装备的 weapons 里是否存在受支持的武器」**，而不是
 * 「主武器槽是不是 cannon」。理由：
 *   - 局内真正决定「强化能不能注入」的是 `applyRunModifiersToSnapshot()` 的
 *     「装载里有没有基准武器」——那是**存在性**判断，不是槽位判断；
 *   - 局内资格（`runLoadoutCompat.ts`，同一实验原型目录内的纯逻辑模块）用的正是存在性判断；
 *   - 产品侧若改成「主武器槽是不是 cannon」，两层判据就会在
 *     「主武器是别的、但车上另有一件 cannon」时**分叉**（首页放行 / 局内拒绝，
 *     或反过来）—— 那正是本 Queue 要根除的「两层不一致」。
 *   ⇒ 两边都走**正式 `buildSnapshotFromDraft`**，都问「有没有受支持的武器」。
 *
 * ⚠️ 支持清单 `FULL_RUN_SUPPORTED_WEAPON_IDS` 与局内真源 `RUN_BASE_WEAPON_DEF_ID`
 *    **同值但各自声明**：`core` / `lab` 的模块不能反向依赖 `src/product/`（依赖单向），
 *    而产品侧也不许 import 那个实验原型目录下的任何模块（`R22b`：`src/` 里不得出现
 *    该目录名，**含 import 路径与注释**）。
 *    ⇒ 二者一致性由 `tests/productRunBuildLoadoutCompat.test.ts` **机器钉死**
 *      （与 `STAR_DAMAGE_MAX_STAR` / `INVENTORY_MAX_STAR` 的既有做法同型）。
 *
 * ⚠️ 本模块**不做**字符串判断（Queue 必改 1 明令「不要在 UI 里靠字符串判断」）：
 *    输入是真实 `BuildDraft`，判断走正式内容库的 `category === 'weapon'` 分类字段。
 */

import { registry } from '../core/content';
import { buildSnapshotFromDraft, type BuildDraft } from '../lab/buildEditorModel';
import type { FunctionalPartDef } from '../core/types';

/**
 * 支持「完整 Run」的武器 defId（第一版 = 正式基准武器 `cannon`）。
 *
 * ⚠️ 加任何一件进来之前必须满足：它已有**正式 Run Build 内容**
 *    （即 `runModifiers.ts` 的 overlay 数值表能作用于它）。否则就是本 Queue 明令冻结的
 *    「新 Spear Buff / 新 Hammer Buff」。
 */
export const FULL_RUN_SUPPORTED_WEAPON_IDS: readonly string[] = ['cannon'];

/** 不支持完整 Run 时的**最小**反馈（Queue 必改 2 逐字给出）。 */
export const FULL_RUN_UNSUPPORTED_LEAD = '当前原型仅支持加农炮进行完整冒险';
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
 *   - `'unsupported-weapon'` —— 有武器，但没有一件在支持清单里。
 */
export type FullRunCompatReason = 'ok' | 'no-weapon' | 'unsupported-weapon';

/** 完整 Run 资格读数（页面 / 探针 / 测试三方同源，页面禁止自行推导）。 */
export interface FullRunCompat {
  readonly ok: boolean;
  readonly reason: FullRunCompatReason;
  /** 当前**已装备**的武器 defId（顺序 = 装配顺序；空 = 没有武器）。 */
  readonly equippedWeaponIds: readonly string[];
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
  const equippedWeaponIds = snapshot.functionals
    .filter((install) => registry.functionals.get(install.defId)?.category === 'weapon')
    .map((install) => install.defId);
  const ok = equippedWeaponIds.some((defId) => supportsFullRun(defId));
  const reason: FullRunCompatReason = ok
    ? 'ok'
    : equippedWeaponIds.length === 0
      ? 'no-weapon'
      : 'unsupported-weapon';
  return {
    ok,
    reason,
    equippedWeaponIds,
    supportedWeaponIds: FULL_RUN_SUPPORTED_WEAPON_IDS,
    supportedWeaponNames: FULL_RUN_SUPPORTED_WEAPON_IDS.map(
      (defId) => (registry.functionals.get(defId) as FunctionalPartDef | undefined)?.name ?? defId,
    ),
    notice: ok ? null : FULL_RUN_UNSUPPORTED_LEAD,
    hint: ok ? null : FULL_RUN_UNSUPPORTED_HINT,
  };
}

/** 便捷布尔入口（Queue 必改 1 要求的那个单一判断）。 */
export function canStartFullRun(draft: BuildDraft): boolean {
  return fullRunCompat(draft).ok;
}
