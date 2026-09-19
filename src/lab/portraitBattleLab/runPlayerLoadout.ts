/**
 * PRODUCT-LOOP-R1-C-END-TO-END-PLAYER-LOOP｜「本局用哪份装备」的**唯一交接口径**（纯逻辑、零 DOM、零存档）。
 *
 * ── 这个模块解决什么问题 ────────────────────────────────────────────────────
 * Queue 必改 2：点「开始冒险」创建新 Run 时，**必须**读取当前 Player Profile 的
 * Equipped Loadout，战斗玩家车辆从这份 Loadout 构建；禁止「首页显示 A，战斗实际跑 B」。
 *
 * 但结构上有一条硬边界：本目录（Lab）的源码白名单是**闭集**，
 * 不含 `core/buildPersistence` / `core/partInventory` ⇒ **Lab 侧读不到正式存档**，
 * 也写不了。因此装备只能由**产品侧交进来**；本模块负责「怎么收」这一半。
 *
 * ── 双向契约（与 `src/product/runReward.ts` 的 `encodeRunLoadout` 成对）──────
 *   产品侧：`encodeRunLoadout(draft)` = 把当前存档里那份 `BuildDraft` 原样 `JSON.stringify`
 *   局内侧：本模块 = 严格校验 → 过正式 `validateSnapshot` → 原样交给正式链路
 *
 * ⚠️ 两半**只共享一个词汇** —— `BuildDraft` 自己（`src/lab/buildEditorModel.ts` 的既有类型，
 *    产品侧 `playerLoadout.ts` 本来就在读写它）。因此**不存在**「Lab 需要理解哪个槽是武器槽」
 *    这种第二份语义：本模块不做任何「这件是什么 / 该放哪」的判断，只做类型与合法性校验。
 *    ⇒ 「产品侧与 Lab 侧各自理解成不同的东西」在结构上不可能发生
 *      （交叉核对见 `tests/productLoopEndToEndPlayerLoop.test.ts`）。
 *
 * ── 非法输入一律**拒绝**（不回退成「半份装备」）────────────────────────────
 * 解析失败 / 过不了正式校验 ⇒ 返回 `null`，由调用方（`runPageScene.resolveRunPlayerLoadout`）
 * 明确区分为 `no-param`（研发入口，本来就没带参数）与 `invalid`（**带了但坏了**，
 * 属真实异常，必须可观测 —— 探针里如实上报，绝不悄悄降级）。
 */

import { registry } from '../../core/content';
import { validateSnapshot } from '../../core/buildValidator';
import { buildSnapshotFromDraft, type BuildDraft } from '../buildEditorModel';

/**
 * URL 参数名（与 `src/product/runReward.ts` 的 `LOADOUT_PARAM` 必须同值）。
 *
 * ⚠️ 这是**唯一**允许在本目录出现的「产品地址相关」字面量 —— 它只是一个**键名**，
 *    不是任何产品地址（`RP-25b` 禁止的是 `.html` / `http(s)://` 这类地址字面量）。
 */
export const RUN_LOADOUT_PARAM = 'equipped';

/** 装备来源（诊断用；`profile` = 来自产品侧交进来的正式存档装备）。 */
export type RunLoadoutSource = 'profile' | 'demo';

/**
 * 本局玩家装备（**一份真实 `BuildDraft`**，不是 Lab 自造的近似）。
 *
 * ⚠️ 刻意**不**暴露 `weaponDefId`：「哪一个是本场打的武器」这个问题由
 *    **真实运行中的战斗世界**回答（`RunBattleRuntime.playerWeaponDefIds()` 读正式
 *    装配结果里 `category === 'weapon'` 的件），而不是靠「某个固定槽位」推断 ——
 *    固定槽位推断一换车 / 一换槽就失效（这正是既有守卫纪律禁止的那类断言）。
 */
export interface RunPlayerLoadout {
  readonly source: RunLoadoutSource;
  /** 展示名（日志里的 `{vehicle}`）。 */
  readonly label: string;
  /** 正式 Build（原样；数值由正式 registry 解析）。 */
  readonly draft: BuildDraft;
  /**
   * 装载标签（`SpawnPlan.loadoutId` 的取值 = **证据链标签**）：
   * demo → 既有 `LabLoadoutId`；profile → `'profile-equipped'`。
   */
  readonly tag: string;
  /** 稳定身份（计划 / 摆位缓存键）。同 key ⇒ 同装备 ⇒ 可复用同一份解析结果。 */
  readonly key: string;
}

function readNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * 严格解析一份**外部交进来的** BuildDraft（`JSON.parse` 之后的原始值）。
 *
 * 只接受 `BuildDraft` 的已知字段；任何未知形状 / 类型不符 ⇒ `null`（整份拒绝，
 * 不做「尽力而为的部分解析」）。**不在这里**做内容合法性判断（那是 `validateSnapshot`）。
 */
export function parseExternalDraft(raw: unknown): BuildDraft | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;

  const bodyDefId = o['bodyDefId'];
  if (typeof bodyDefId !== 'string' || bodyDefId === '') return null;

  const rearRadius = readNumber(o['rearRadius']);
  const frontRadius = readNumber(o['frontRadius']);
  if (rearRadius === null || frontRadius === null || rearRadius <= 0 || frontRadius <= 0) return null;

  const fsRaw = o['functionalSelections'];
  if (typeof fsRaw !== 'object' || fsRaw === null || Array.isArray(fsRaw)) return null;
  const functionalSelections: Record<string, string> = {};
  for (const [k, v] of Object.entries(fsRaw as Record<string, unknown>)) {
    if (typeof v !== 'string') return null;
    functionalSelections[k] = v;
  }

  const draft: BuildDraft = { bodyDefId, rearRadius, frontRadius, functionalSelections };

  const rearWheelDefId = o['rearWheelDefId'];
  if (typeof rearWheelDefId === 'string' && rearWheelDefId !== '') draft.rearWheelDefId = rearWheelDefId;
  const frontWheelDefId = o['frontWheelDefId'];
  if (typeof frontWheelDefId === 'string' && frontWheelDefId !== '') draft.frontWheelDefId = frontWheelDefId;

  const drive = o['drive'];
  if (drive === 'forward' || drive === 'stationary') draft.drive = drive;

  const starsRaw = o['functionalStars'];
  if (starsRaw !== undefined) {
    if (typeof starsRaw !== 'object' || starsRaw === null || Array.isArray(starsRaw)) return null;
    const stars: Record<string, number> = {};
    for (const [k, v] of Object.entries(starsRaw as Record<string, unknown>)) {
      const n = readNumber(v);
      if (n === null) return null;
      stars[k] = n;
    }
    draft.functionalStars = stars;
  }

  return draft;
}

/** 该 search 串里**是否带了**装备参数（用来区分「没带」与「带了但坏了」）。 */
export function hasRunLoadoutParam(search: string): boolean {
  if (typeof search !== 'string' || search === '') return false;
  try {
    const raw = new URLSearchParams(search).get(RUN_LOADOUT_PARAM);
    return raw !== null && raw !== '';
  } catch {
    return false;
  }
}

/**
 * 解析产品侧交进来的装备：**格式 + 正式合法性**双关，任一不过 ⇒ `null`。
 *
 * 正式合法性 = `buildSnapshotFromDraft` → `validateSnapshot`（与正式玩法同一对函数）
 * ⇒ 局内拿到的装备与产品侧「装上去时」的判据完全同源，不存在第二套标准。
 */
export function parseRunPlayerLoadout(search: string): RunPlayerLoadout | null {
  if (typeof search !== 'string' || search === '') return null;
  let raw: string | null;
  try {
    raw = new URLSearchParams(search).get(RUN_LOADOUT_PARAM);
  } catch {
    return null;
  }
  if (raw === null || raw === '') return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const draft = parseExternalDraft(parsed);
  if (!draft) return null;

  const snapshot = buildSnapshotFromDraft(draft, registry, 'run-profile-loadout');
  if (!validateSnapshot(snapshot, registry).valid) return null;

  return {
    source: 'profile',
    label: registry.bodies.get(draft.bodyDefId)?.name ?? draft.bodyDefId,
    draft,
    tag: 'profile-equipped',
    key: `profile:${raw}`,
  };
}
