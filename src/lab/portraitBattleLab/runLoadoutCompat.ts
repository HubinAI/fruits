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
 * ── 本模块的定位：**资格判断**，不是异常处理 ──────────────────────────────
 * 按 Queue 必改 5，`applyRunModifiersToSnapshot()` 的 `throw` **是刻意保留的强 invariant**
 * （UI / Choice 层把不兼容 Modifier 送进 Runtime 本身就是程序错误），**不许**改成
 * silently skip / `return unchanged` / try-catch 吞。
 * ⇒ 真正的修复在**两层资格**上：
 *   ① 产品侧「开始冒险」守门（`src/product/runCompatibility.ts`，面向玩家）；
 *   ② **本模块**：Run 创建前的资格（面向「旧URL / 旧Profile / stale href / 测试入口」）。
 * 两层都用**同一个实际判据**「装载里有没有基准武器」（`snapshotHasRunBaseWeapon`，
 * 与 throw 同源）⇒ 不存在第二套「什么算兼容」的定义，两边不可能漂移。
 *
 * ── 为什么判据不是「某个固定槽位是不是 cannon」──────────────────────────────
 * `runPlayerLoadout.ts` 头部已经立过这条纪律：**「哪一件是主武器」由真实装配结果回答**
 * （`category === 'weapon'`），而不是靠固定槽位推断 —— 固定槽位一换车 / 一换槽就失效。
 * 因此本模块把 draft 解析成**正式 BuildSnapshot**，再问
 * 「这份装载里有没有 `RUN_BASE_WEAPON_DEF_ID` 的件」，与运行时注入用的是同一条判据。
 *
 * ⚠️ 白名单：本模块只 import `../../core/content`（只读内容库）与
 *    `../buildEditorModel`（Lab 既有纯模型），两者都已在 `tests/portraitBattleLab.test.ts`
 *    的 `ALLOWED_RELATIVE_IMPORTS` 内；`./runModifiers` 是同目录（守卫显式放行 `./`）。
 */

import { registry } from '../../core/content';
import { buildSnapshotFromDraft, type BuildDraft } from '../buildEditorModel';
import { RUN_BASE_WEAPON_DEF_ID, snapshotHasRunBaseWeapon } from './runModifiers';

/** 不兼容的原因。`'ok'` = 可以创建完整 Run。 */
export type RunLoadoutCompatReason = 'ok' | 'no-base-weapon';

/** Run 创建资格的结果（结构化，供宿主 / 探针 / 测试三方同源读取）。 */
export interface RunLoadoutCompat {
  readonly ok: boolean;
  readonly reason: RunLoadoutCompatReason;
  /**
   * 本局强化注入所要求的**基准武器** defId（= `RUN_BASE_WEAPON_DEF_ID`）。
   *
   * ⚠️ 从 `runModifiers.ts` 现读而不是在本模块另写一个 `'cannon'`：
   *    强化内容的真源在那边，这里复制一份就是第二份真源。
   */
  readonly baseWeaponDefId: string;
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
  const ok = snapshotHasRunBaseWeapon(snapshot);
  return {
    ok,
    reason: ok ? 'ok' : 'no-base-weapon',
    baseWeaponDefId: RUN_BASE_WEAPON_DEF_ID,
    weaponDefIds,
  };
}
