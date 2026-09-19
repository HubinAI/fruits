/**
 * PRODUCT-LOOP-R1-B｜**Player Profile 的官方持久化入口（Repository）**。
 *
 * 本模块是产品侧**唯一**读写持久化状态的地方。UI（`homePage.ts` / `home.html`）**不得**
 * 直接碰 `localStorage` / `platform.storage` —— 这条由 `tests/productLoopRunReward.test.ts`
 * 的 `PR-20` 源码守卫机器钉死（Queue 必改 1：「必须封装在 Profile Repository 内，
 * 禁止 UI 直接读写 localStorage」）。
 *
 * ── 复用了什么（必改 1「优先复用当前已有存档/Profile 基础」）────────────────────
 *   - **equipped（当前装备）** = `strongfruit.playerBuild.v1`
 *     （`core/buildPersistence.ts`，A 段已打通，本 Queue **零改动**）；
 *   - **owned（拥有部件 + 副本数）** = `strongfruit.ownedParts.v2`
 *     （`core/partInventory.ts` 的 `ensureInventory` / `addPart` / `saveInventory`）；
 *   - **schema version** = 既有 `core/saveVersion.ts` 的 `__v` 信封
 *     （不新造第二套版本机制）。
 *
 * ── 新增了什么（**只有一件事**）────────────────────────────────────────────
 *   - **reward claim 状态** = `strongfruit.profileClaims.v1`（`{ grantedRunIds: [...] } + __v`）。
 *     Queue 必改 4 要求「一个明确 reward claim 状态」，而既有存档里**没有**这个概念
 *     （既有 `BattleRewardSettler` 的幂等键是**内存里的对象引用**，跨页面刷新不成立）。
 *     它是**最小**的：只存已领取的本局 token，不存金币 / Fusion / 星级 / 排位 / Season / Run 中间状态。
 *
 * ⚠️ 不修改 `src/core/**`（全链冻结项）：因此新 key **不在** `RESET_KEYS` 里 ——
 *    `resetPlayerSave()` 不会清它。代价：Reset 后旧的领奖 token 仍算「已领」；
 *    因为 token 每次由首页新生成（含时间戳），这不会挡住任何**新的一局**领奖（已在交接文档如实上报）。
 *
 * ⚠️ 概率 / 随机 / 稀有度 / 宝箱 / 多奖励一律不做（Queue 明令）：奖励 id 由调用方给定，
 *    本模块只做**校验 + 幂等入库**。
 */
import { validateSnapshot } from '../core/buildValidator';
import { registry } from '../core/content';
import { addPart, getCount, isOfficialPart, saveInventory } from '../core/partInventory';
import { STAMP_KEY, readJsonWithVersion, stampVersion } from '../core/saveVersion';
import { buildSnapshotFromDraft } from '../lab/buildEditorModel';
import { platform } from '../platform';
import { WEAPON_SLOT, isWeaponDefId, loadEquippedDraft, playerInventory } from './playerLoadout';
import type { PendingClaim } from './runReward';

/** 领奖账本 key（本 Queue 唯一新增的持久化记录）。 */
export const PROFILE_CLAIMS_KEY = 'strongfruit.profileClaims.v1';

/** 账本形状（落盘时附带 `saveVersion` 的 `__v` 信封）。 */
export interface ClaimLedger {
  /** 已经领取过奖励的本局 token（幂等键）。 */
  readonly grantedRunIds: readonly string[];
}

/** 空账本（无存档 / 解析失败 / 形状非法 → 全部回退到它，绝不清空别的 key）。 */
export function emptyClaimLedger(): ClaimLedger {
  return { grantedRunIds: [] };
}

/**
 * 读取领奖账本。**任何异常都回退到空账本**（隐私模式 / 配额 / 脏数据都不影响游戏）。
 * ⚠️ 逐字段校验：`grantedRunIds` 里的元素必须是字符串，非字符串项静默丢弃。
 */
export function readClaimLedger(): ClaimLedger {
  let raw: string | null = null;
  try {
    raw = platform.storage.getItem(PROFILE_CLAIMS_KEY);
  } catch {
    return emptyClaimLedger();
  }
  const parsed = readJsonWithVersion(raw);
  if (!parsed) return emptyClaimLedger();
  const obj = parsed.obj as Record<string, unknown> | null;
  if (!obj || typeof obj !== 'object') return emptyClaimLedger();
  const list = obj.grantedRunIds;
  if (!Array.isArray(list)) return emptyClaimLedger();
  return { grantedRunIds: list.filter((v): v is string => typeof v === 'string' && v !== '') };
}

/** 写领奖账本（写入失败静默忽略，与既有存档模块同一纪律）。 */
export function saveClaimLedger(ledger: ClaimLedger): void {
  try {
    platform.storage.setItem(PROFILE_CLAIMS_KEY, JSON.stringify(stampVersion(ledger)));
  } catch {
    // 写入失败静默忽略（隐私模式 / 配额），不影响当前会话
  }
}

/** 本局 token 是否已领过（幂等判据）。 */
export function isRunClaimed(runToken: string): boolean {
  if (typeof runToken !== 'string' || runToken === '') return false;
  return readClaimLedger().grantedRunIds.includes(runToken);
}

/** 领奖失败原因（任一原因 = **零副作用**：库存 / 存档 / 账本都不动）。 */
export type ClaimFailure =
  | 'no-run-token'
  | 'already-claimed'
  | 'not-official'
  | 'not-weapon'
  | 'not-equippable';

/** 成功入库的结果（供页面展示「本局获得」）。 */
export interface RewardGrant {
  readonly runToken: string;
  readonly defId: string;
  readonly name: string;
  /** 入库后的副本数（第二局拿到同一件 = 2；第一局 = 1）。 */
  readonly countAfter: number;
}

export interface ClaimOutcome {
  readonly ok: boolean;
  readonly reason: ClaimFailure | null;
  readonly grant: RewardGrant | null;
}

/**
 * 「当前车辆能不能合法装上这件部件」——用**正式校验器**判定（不写死白名单）。
 * 判据 = 把该部件放到 `WEAPON_SLOT`（A 段打通的唯一武器槽）后过 `validateSnapshot`。
 * ⚠️ 不变量：`loadEquippedDraft()` 返回的一定是合法 Build ⇒ 换件后若不合法，
 *    说明是**这件部件**装不上（超载 / 槽位不允许），而不是原 Build 坏了。
 */
export function equippableOnCurrentVehicle(defId: string): boolean {
  const draft = loadEquippedDraft();
  const next = {
    ...draft,
    functionalSelections: { ...draft.functionalSelections, [WEAPON_SLOT]: defId },
  };
  const snap = buildSnapshotFromDraft(next, registry, 'profileReward');
  return validateSnapshot(snap, registry).valid;
}

/**
 * **领取本局奖励**（Queue 的中心动作）—— 幂等、可重入、失败零副作用。
 *
 * 校验顺序（任一失败 ⇒ 直接返回，**不写任何东西**）：
 *   ① token 非空；
 *   ② **本局 token 未领过**（重复点击 / 重复结算 / 刷新领奖 URL 全部落在这里）；
 *   ③ 是**正式部件**（`PART_OPTIONS` 内）；
 *   ④ 是**正式 Weapon**（`category === 'weapon'`，Run Buff 结构上不满足 —— 必改 2）；
 *   ⑤ **当前车辆能合法装备**（正式 `validateSnapshot`）。
 *
 * 成功路径只有三处写入，顺序固定：库存 +1 → 落盘库存 → 记 token（幂等键最后写）。
 * ⚠️ 入账用既有 `addPart` / `saveInventory`（**不新建第二套库存**，必改 5）；
 *    重复获得同一件会累计副本数（与既有奖励系统语义一致，不是「失败」）。
 */
export function claimRunReward(input: PendingClaim | null | undefined): ClaimOutcome {
  const fail = (reason: ClaimFailure): ClaimOutcome => ({ ok: false, reason, grant: null });

  const runToken = input?.runToken ?? '';
  const defId = input?.rewardDefId ?? '';
  if (typeof runToken !== 'string' || runToken === '') return fail('no-run-token');

  // ② 幂等：同一局只发一次（放在最前 —— 重复领取是最常见的调用形态）
  if (isRunClaimed(runToken)) return fail('already-claimed');

  // ③④ 只复用正式部件里的正式 Weapon
  if (!isOfficialPart(defId)) return fail('not-official');
  if (!isWeaponDefId(defId)) return fail('not-weapon');

  // ⑤ 「拿到就能装上」必须在结构上成立，否则奖励就是一件废品
  if (!equippableOnCurrentVehicle(defId)) return fail('not-equippable');

  const def = registry.functionals.get(defId);
  if (!def) return fail('not-weapon');

  // 唯一写入面：库存 +1 → 落盘 → 记 token
  const inv = playerInventory(loadEquippedDraft());
  addPart(inv, defId, 1, 1);
  saveInventory(inv);
  const ledger = readClaimLedger();
  saveClaimLedger({ grantedRunIds: [...ledger.grantedRunIds, runToken] });

  return {
    ok: true,
    reason: null,
    grant: { runToken, defId, name: def.name, countAfter: getCount(inv, defId, 1) },
  };
}

/**
 * 本 Queue 新增的持久化 key 清单（供测试与 dev 工具核对「一共写了哪些 key」）。
 * ⚠️ 只读常量：不存在「第二个写入点」。
 */
export const PROFILE_NEW_KEYS: readonly string[] = [PROFILE_CLAIMS_KEY];

/** 账本里已领取的局数（只读统计，供探针 / E2E 读数）。 */
export function claimedRunCount(): number {
  return readClaimLedger().grantedRunIds.length;
}

/** 落盘时不泄漏版本信封（测试用于断言账本形状）。 */
export function ledgerWithoutStamp(ledger: ClaimLedger): Record<string, unknown> {
  const out = { ...(ledger as unknown as Record<string, unknown>) };
  delete out[STAMP_KEY];
  return out;
}
