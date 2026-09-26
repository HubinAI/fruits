/**
 * PRODUCT-LOOP-P0-RUN-BUILD-LOADOUT-COMPATIBILITY｜「这份局外装备能不能跑完整 Run」的
 * **局内资格**判断（纯逻辑、零 DOM、零存档、零 UI）。
 *
 * ── 这个模块解决什么问题（真人 P0 的根因）──────────────────────────────────
 * 局外 Weapon 已支持 `cannon` / `spear` / `hammer`，但**已真人验证的 Run Build 内容**
 * 全部围绕 cannon 派生（`heavyShell` / `twinCannon` / `fastReload` / `kineticBurst` /
 * `tripleLoad` —— 见 `runModifiers.ts` 的 `RUN_BASE_WEAPON_DEF_ID` 与 overlay 数值表）。
 * 于是出现这条真实复现：
 *
 *     equipped = 非 cannon → 前几日正常 → DAY3 选 heavyShell → `beginBattle`
 *     → `applyRunModifiersToSnapshot()` 找不到 cannon → throw → Run 卡死
 *
 * r1-C 只验证了「非 cannon 的第一场 Battle」，**没覆盖**「非 cannon → 第一次强化 →
 * 下一场 Battle」—— 强化注入发生在**第二次战斗创建**时，所以第一场看不出来。
 *
 * ── PRODUCT-LOOP-R6-RUN-WEAPON-SOURCE-OF-TRUTH（本模块的判据已改）────────────
 * 上面那条 throw 的**根因已从底层修掉**：Run 不再把基准武器硬绑 cannon ——
 * `runModifiers.resolveRunBaseWeaponDefId()` = 「玩家实际装备里装配顺序第一件正式武器」，
 * Run 以**该武器自己的 canonical Def** 作为运行 base（装备 hammer ⇒ base 就是 hammer）。
 * ⇒ 本模块的判据随之从「装载里有没有 **cannon**」改成「装载里**解析得出一件正式武器**」：
 *   - 装备 hammer / laser / saw … 的合法装载现在**放行**（它们各自用自己的 canonical Def 跑）；
 *   - 「车上没有武器」仍然拒绝（`no-base-weapon`）。
 *   ⇒ **拒绝的理由不再是「不是 Cannon」**，而是「车上没有任何正式武器」。
 * ⚠️ 「哪件武器能进完整 Run」这一层产品裁决在 `src/product/runCompatibility.ts`
 *    的显式能力登记表里，不在本模块 —— 本模块只回答「这份装载有没有可运行的武器」。
 *
 * ── 本模块的定位：**资格判断**，不是异常处理 ──────────────────────────────
 * 按 Queue 必改 5，`applyRunModifiersToSnapshot()` 的 `throw` **是刻意保留的强 invariant**
 * （UI / Choice 层把不兼容 Modifier 送进 Runtime 本身就是程序错误），**不许**改成
 * silently skip / `return unchanged` / try-catch 吞。
 * ⇒ 真正的修复在**两层资格**上：
 *   ① 产品侧「开始冒险」守门（`src/product/runCompatibility.ts`，面向玩家）；
 *   ② **本模块**：Run 创建前的资格（面向「旧URL / 旧Profile / stale href / 测试入口」）。
 * ⚠️ PRODUCT-LOOP-R6：这两层的**判据不再逐字相同**，如实说明各是什么：
 *   - 本模块（②）问「**这份装载解析得出可运行的武器吗**」—— base 武器存在（`no-base-weapon`）
 *     且它的 `behavior` 有真实工厂（`no-weapon-runtime`）。这是**运行时**的事实。
 *   - 产品侧（①）在这之上再叠一层**产品裁决**：那件武器在不在**显式能力登记表**里
 *     （登记门槛 5 条，含「不需要新增玩法规则」这种产品判断）。
 *   - 关系：① ⇒ ②（登记表里的 8 件都过得了本模块），但 **② ⇏ ①**
 *     （本模块放行、产品侧仍可因未登记而拒绝 —— 例如将来某件武器 Runtime 齐了但玩法未裁决）。
 *     这不是「第二套兼容口径」：两层问的是不同的问题，且本模块**没有**任何武器白名单。
 *
 * ── 为什么判据不是「某个固定槽位是不是某件特定武器」──
 * `runPlayerLoadout.ts` 头部已经立过这条纪律：**「哪一件是主武器」由真实装配结果回答**
 * （`category === 'weapon'`），而不是靠固定槽位推断 —— 固定槽位一换车 / 一换槽就失效。
 * 因此本模块把 draft 解析成**正式 BuildSnapshot**，再问
 * 「这份装载里装配顺序第一件正式武器是哪件」（`resolveRunBaseWeaponDefId`）——
 * 与运行时 `createRunRegistry` 取 base 用的是**同一个函数** ⇒ 不可能与注入侧漂移。
 *
 * ⚠️ 白名单：本模块的 import 面共四个，全部已在 `tests/portraitBattleLab.test.ts` 的
 *    `ALLOWED_RELATIVE_IMPORTS` 内：
 *      `../../core/content`（只读内容库）、`../buildEditorModel`（Lab 既有纯模型）、
 *      `../../battle/behaviorRegistry`（**R6 新增**：问「这件武器的 behavior 有没有工厂」——
 *      用的是正式注册表本身，不是另抄一张武器名单）、`./runModifiers`（同目录，守卫显式放行 `./`）。
 */

import { registry } from '../../core/content';
import { buildSnapshotFromDraft, type BuildDraft } from '../buildEditorModel';
import { getBehaviorFactory } from '../../battle/behaviorRegistry';
import { resolveRunBaseWeaponDefId } from './runModifiers';

/**
 * 不兼容的原因。`'ok'` = 可以创建完整 Run。
 *
 *   - `'no-base-weapon'`    —— 车上**没有任何正式武器**；
 *   - `'no-weapon-runtime'` —— 有武器，但那件武器的 **behavior Runtime 不存在**
 *     （例：`spear` 的 `behavior === 'ram'` 未在 `behaviorRegistry.FACTORIES` 注册）
 *     ⇒ 战斗里它只有 collider、没有行动能力 ⇒ **明确拒绝**（必改 D）。
 */
export type RunLoadoutCompatReason = 'ok' | 'no-base-weapon' | 'no-weapon-runtime';

/** Run 创建资格的结果（结构化，供宿主 / 探针 / 测试三方同源读取）。 */
export interface RunLoadoutCompat {
  readonly ok: boolean;
  readonly reason: RunLoadoutCompatReason;
  /**
   * 本局 Run 解析出的**基准武器** defId（= 玩家实际装备里装配顺序第一件正式武器）。
   *
   * ⚠️ PRODUCT-LOOP-R6-RUN-WEAPON-SOURCE-OF-TRUTH：改前这里报的是**写死的**
   *    `RUN_BASE_WEAPON_DEF_ID`（cannon）。现在它随装备变化：装备 hammer 就是 `'hammer'`。
   *    `null` = 车上没有武器（此时 `ok === false`）。
   */
  readonly baseWeaponDefId: string | null;
  /** 这份装载里实际存在的武器 defId（诊断用；顺序 = 装配顺序）。 */
  readonly weaponDefIds: readonly string[];
}

/**
 * 这份 draft 能不能创建一个**完整 Run**。
 *
 * 纯函数、不抛错（判据本身不会失败）—— 因为它的调用点在 Run 创建**之前**，
 * 那里要做的是「拒绝创建」，而不是「抛出异常让上层崩」。
 */
export function runLoadoutCompatOfDraft(draft: BuildDraft): RunLoadoutCompat {
  const snapshot = buildSnapshotFromDraft(draft, registry, 'run-loadout-compat');
  const weaponDefIds = snapshot.functionals
    .filter((install) => registry.functionals.get(install.defId)?.category === 'weapon')
    .map((install) => install.defId);
  // PRODUCT-LOOP-R6：基准武器 = 玩家实际装备里**装配顺序第一件正式武器**（唯一规则）。
  // 装备什么武器，Run 就以该武器自己的 canonical Def 作为运行 base —— 不再要求车上有 cannon。
  const baseWeaponDefId = resolveRunBaseWeaponDefId(snapshot, registry);
  // ⚠️ 必改 D：**Runtime 不完整的武器仍然必须被明确阻止**。
  //    「有武器」只是必要条件 —— 那件武器的 `behavior` 还必须真的在
  //    `behaviorRegistry.FACTORIES` 里有工厂（例：`spear.behavior === 'ram'` 没有注册，
  //    战斗里它只有 collider、没有行动能力）。这是**同一份真源**（正式注册表），
  //    不是另写一张武器名单。
  const baseDef = baseWeaponDefId ? registry.functionals.get(baseWeaponDefId) : undefined;
  const runtimeOk = baseDef ? getBehaviorFactory(baseDef.behavior) !== undefined : false;
  const ok = baseWeaponDefId !== null && runtimeOk;
  return {
    ok,
    reason: ok ? 'ok' : baseWeaponDefId === null ? 'no-base-weapon' : 'no-weapon-runtime',
    baseWeaponDefId,
    weaponDefIds,
  };
}
