/**
 * CONTENT-BATCH-CREATION-PIPELINE-R1｜**确定性 Run 测试底座（Foundation）**。
 *
 * ── 这一层解决什么 ───────────────────────────────────────────────────────────
 *
 *   M0（技术闭环）与 M1（产品浏览器 E2E）已完成，但每新增一组敌人 / 装配，仍要手写
 *   `walkRun`、合法 Build / 取胜样例与清场验证；内容扩容后守卫与测试易陈旧。本文件把
 *   「配置 → 合法装配 → 指定既有敌阵路线 → 真实完整三战两次强化 → 读数/结果 → 隔离下一组」
 *   **抽成最小共享底座**，后续加内容只需补「声明式案例」，不再复制运行器。
 *
 * ── 严守的边界（不改任何正式 Runtime / 经济 / 数值）─────────────────────────
 *
 *   本文件**只组合**既有正式 API，不重定义任何 gameplay 语义：
 *     - `runPageContext`（Run 上下文构造，含路线透传）
 *     - `createRunPageState` / `pressRunAction` / `finishRunBattle` / `chooseRunBuff`（纯状态机）
 *     - `RunBattleRuntime`（确定性单场战斗，构造时显式传 `encounterId`/`playerDraft`，无 RNG）
 *     - `canStartFullRun` / `validateSnapshot`（统一合法性检查）
 *   正式产品 Run 的随机选敌（`playerGameRuntime.pickOpponentForTier` + `Math.random`）**不在本底座**——
 *   这是「同一装配 ≠ 恒定胜负」的根因（产品事实，**不是**回归），本底座专做确定性内容验收。
 *
 * ── 红灯纪律（必改 4）────────────────────────────────────────────────────────
 *
 *   确定性底座里，**以下一律红灯（抛错 → 测试失败）**，绝不静默算通过：
 *     - 非法装备：未过 Run 创建资格层（`canStartFullRun=false`）或装配校验失败；
 *     - 错误路线：收到非 `default/heavy/rush` 的路线（既有纯函数只认这三条）；
 *     - 跳过 / 卡死阶段：循环在 40 步守卫内未到达任何终态（COMPLETE/FAILED）；
 *     - 清场残留：上一场战斗运行时未 `dispose` 即开下一场，或新运行时携带上一场接触事实。
 *   浏览器 E2E 的 RNG `BLOCKED` 是**另一套**统计口径，不在本确定性底座内混算。
 */

import { registry } from '../../src/core/content';
import { validateSnapshot } from '../../src/core/buildValidator';
import { buildSnapshotFromDraft, EMPTY_SLOT, type BuildDraft } from '../../src/lab/buildEditorModel';
import { RunBattleRuntime } from '../../src/lab/portraitBattleLab/runBattleRuntime';
import {
  chooseRunBuff,
  createRunPageState,
  finishRunBattle,
  pressRunAction,
  runBuildIds,
  runCarriedPlayerHp,
  runChoicePool,
  runChoicePoolKind,
  runChoicePoolLayer,
  runComplete,
  runCurrentNode,
  runFailed,
  type RunPageState,
} from '../../src/lab/portraitBattleLab/runPageState';
import { runPageContext, type RunPlayerLoadout } from '../../src/lab/portraitBattleLab/runPageScene';
import { RUN_TOTAL_BATTLES, type RunRouteId } from '../../src/lab/portraitBattleLab/runScript';
import type { RunBuildId } from '../../src/lab/portraitBattleLab/runModifiers';
import { canStartFullRun } from '../../src/product/runCompatibility';
import { WEAPON_SLOT, defaultPlayerDraft } from '../../src/product/playerLoadout';

/* ----------------------------------------------------------------- 取证常量 */

const FRAME_MS = 1000 / 60;
const MAX_FRAMES = 4000;
const PRODUCT_TAG = 'profile-equipped';

export type ContentRoute = RunRouteId | 'default';

/* --------------------------------------------------------- 声明式案例输入 */

/**
 * **轻量声明式案例输入**（必改 2）：合法车身 / 武器 / 前后轮 / 可选 Gadget / 已有路线 /
 * 强化选择。统一合法性检查、清场与配置间状态隔离都挂在 `runContentBatchCase` 上。
 *
 * ⚠️ 数据全部来自当前 content registry / 真实装备 —— 本底座**不制造新敌人、不改任何数值**。
 */
export interface ContentBatchCaseSpec {
  /** 案例标签（用于日志 / 汇总行 / loadout key 隔离）。 */
  readonly label: string;
  /** 车身 defId（缺省 = 产品默认车车身）。 */
  readonly bodyDefId?: string;
  /** Functional 槽位覆盖（key = 硬点 id，如 `front`/`frontMass`/`top`/`rear`；value = defId 或 `EMPTY_SLOT`）。 */
  readonly functional?: Readonly<Record<string, string>>;
  /** 前轮 defId（缺省 = 产品默认车车轮）。 */
  readonly frontWheelDefId?: string;
  /** 后轮 defId（缺省 = 产品默认车车轮）。 */
  readonly rearWheelDefId?: string;
  /** 可选 Gadget（缺省 = 无）。 */
  readonly gadgetDefId?: string;
  /** 已有敌人路线（缺省 = 正式默认三段链）。 */
  readonly route?: RunRouteId;
  /** 两次 Build 选择（依次在第 1 / 第 2 个 CHOICE 节点上点的项，必须来自当时候选池）。 */
  readonly picks: readonly [string, string];
}

/** 直接指定合法 `BuildDraft` 的案例（复用现有测试夹具时走这条）。 */
export interface ContentBatchCaseDraft {
  readonly label: string;
  readonly draft: BuildDraft;
  readonly route?: RunRouteId;
  readonly picks: readonly [string, string];
}

export type ContentBatchCase = ContentBatchCaseSpec | ContentBatchCaseDraft;

/** 判别案例形态（声明式 spec vs 直接 draft）。 */
function isSpec(c: ContentBatchCase): c is ContentBatchCaseSpec {
  return (c as ContentBatchCaseSpec).functional !== undefined ||
    (c as ContentBatchCaseSpec).bodyDefId !== undefined ||
    (c as ContentBatchCaseSpec).frontWheelDefId !== undefined ||
    (c as ContentBatchCaseSpec).gadgetDefId !== undefined;
}

/**
 * 把**声明式 spec** 编译成正式 `BuildDraft`（基底 = 真实产品默认车，零新数值）。
 *
 * ⚠️ 与 `productDraft` / R9 `draftOf` 同源：先 `defaultPlayerDraft()`，再覆盖车身 /
 *   functional 槽位 / 前后轮 / Gadget —— 不引入任何 `defaultPlayerDraft` 之外的来源。
 */
export function buildDraftFromContentSpec(spec: ContentBatchCaseSpec): BuildDraft {
  const base = defaultPlayerDraft();
  const next: BuildDraft = { ...base, bodyDefId: spec.bodyDefId ?? base.bodyDefId };
  if (spec.functional) {
    for (const [k, v] of Object.entries(spec.functional)) {
      next.functionalSelections[k] = v;
    }
  }
  if (spec.frontWheelDefId) {
    next.frontWheelDefId = spec.frontWheelDefId;
    next.frontRadius = registry.movements.get(spec.frontWheelDefId)?.radius ?? base.frontRadius;
  }
  if (spec.rearWheelDefId) {
    next.rearWheelDefId = spec.rearWheelDefId;
    next.rearRadius = registry.movements.get(spec.rearWheelDefId)?.radius ?? base.rearRadius;
  }
  if (spec.gadgetDefId) next.gadgetDefId = spec.gadgetDefId;
  return next;
}

/** 案例 → 最终 `BuildDraft`（spec 编译、draft 直出）。 */
export function resolveCaseDraft(c: ContentBatchCase): BuildDraft {
  return isSpec(c) ? buildDraftFromContentSpec(c) : c.draft;
}

/* --------------------------------------------------------------- 红灯错误 */

export type BatchRunErrorKind = 'illegal' | 'route' | 'stuck' | 'residue';

/** 确定性底座的红灯错误（测试侧 `expect(() => ...).toThrow()` 捕获）。 */
export class BatchRunError extends Error {
  readonly kind: BatchRunErrorKind;
  constructor(kind: BatchRunErrorKind, message: string) {
    super(message);
    this.kind = kind;
    this.name = 'BatchRunError';
  }
}

/* --------------------------------------------------------------- 读数类型 */

export interface BatchSegResult {
  readonly nodeId: string;
  readonly encounterId: string;
  /** 本段开局时本局累积 Build（宿主 `beginBattle` 传的同一份）。 */
  readonly build: readonly string[];
  readonly hpA0: number;
  readonly hpA: number;
  readonly hpB: number;
  readonly hpBMax: number;
  readonly steps: number;
  readonly winner: 'A' | 'B' | null;
  readonly hits: number;
  readonly damage: number;
  /** 逐发真实伤害去重升序（同一件武器 ⇒ 只可能一个值）。 */
  readonly perHit: readonly number[];
}

export interface BatchPickResult {
  readonly nodeId: string;
  readonly kind: string | null;
  readonly layer: number;
  /** 该节点当下真实画出来的候选池。 */
  readonly pool: readonly string[];
  readonly pick: string;
  /** `pick` 是否真的在池里（不在 ⇒ 是 no-op，Run 不会静默推进）。 */
  readonly accepted: boolean;
}

export interface BatchRunResult {
  readonly label: string;
  readonly route: ContentRoute;
  readonly phase: string;
  readonly complete: boolean;
  readonly failed: boolean;
  readonly nodeSeq: readonly string[];
  /** 三场战斗各自开局时的累积 Build。 */
  readonly buildSeq: readonly (readonly string[])[];
  readonly picks: readonly BatchPickResult[];
  readonly segs: readonly BatchSegResult[];
  readonly battlesCompleted: number;
  readonly logTail: readonly string[];
}

export interface SingleBattleFact {
  readonly winner: 'A' | 'B' | null;
  readonly endReason: string | null;
  readonly hpA0: number;
  readonly hpA: number;
  readonly hpAMax: number;
  readonly hpB: number;
  readonly hpBMax: number;
  readonly steps: number;
  readonly hits: number;
  readonly damage: number;
  readonly perHit: readonly number[];
}

/* --------------------------------------------------------- 单场战斗驱动 */

/**
 * **确定性单场战斗**（与 `RunBattleRuntime` 同口径：真物理、真时间步、无 RNG）。
 *
 * 这是「完整 Run 内重复战斗驱动」的唯一真源 —— `runContentBatchCase` 与旧测试
 * 的 `runOneBattle` 都复用它，消除重复。返回逐发伤害/命中/胜者，**不伪造结果**；
 * 新建运行时若已携带上一场接触事实（清场残留），抛 `residue` 红灯。
 */
export function runSingleBattle(
  draft: BuildDraft,
  build: readonly RunBuildId[],
  encounterId: string,
  carriedHp: number | null,
): SingleBattleFact {
  const rt = new RunBattleRuntime({
    build,
    carriedHp,
    encounterId,
    playerDraft: draft,
    playerLoadoutTag: PRODUCT_TAG,
    playerBaseline: true,
  });
  try {
    const res = rt.contactResidue();
    if (res.contact || res.impact || res.damage) {
      throw new BatchRunError(
        'residue',
        `清场残留：新战斗运行时携带上一场接触事实（contact=${res.contact} impact=${res.impact} damage=${res.damage}）`,
      );
    }
    const atStart = rt.hp();
    let steps = 0;
    while (rt.result === null && steps < MAX_FRAMES) {
      rt.step(FRAME_MS);
      steps += 1;
    }
    const hp = rt.hp();
    let hits = 0;
    let damage = 0;
    const perHit: number[] = [];
    for (const read of Object.values(rt.playerWeaponHitSummary())) {
      hits += read.count;
      damage += read.damages.reduce((a, b) => a + b, 0);
      perHit.push(...read.damages);
    }
    return {
      winner: rt.result?.winner ?? null,
      endReason: rt.result?.endReason ?? null,
      hpA0: atStart.a,
      hpA: hp.a,
      hpAMax: atStart.aMax,
      hpB: hp.b,
      hpBMax: atStart.bMax,
      steps,
      hits,
      damage,
      perHit: [...new Set(perHit)].sort((a, b) => a - b),
    };
  } finally {
    rt.dispose();
  }
}

/* --------------------------------------------------------- 完整 Run 驱动 */

/**
 * **确定性完整 Run 驱动**（必改 1 / 必改 2 / 必改 4 的核心）。
 *
 * 真实流程驱动三战两强化，允许显式指定原有对手路线与强化选择；逐场返回 winner / HP /
 * 命中伤害 / 最终 phase，**不伪造判胜或结果**。
 *
 * 红灯（抛错 → 测试失败）：
 *   - 非法装备（`canStartFullRun=false` 或装配校验失败）；
 *   - 错误路线（非 `default/heavy/rush`）；
 *   - 跳过 / 卡死阶段（40 步守卫内未到达任何终态）；
 *   - 清场残留（上一场未 `dispose` 即开下一场，或新运行时携带接触事实）。
 *
 * ⚠️ 合法但失败（FAILED）是**真实终态**，不是红灯 —— 底座只红线「没跑到任何终态」。
 */
export function runContentBatchCase(input: ContentBatchCase): BatchRunResult {
  const draft = resolveCaseDraft(input);
  const route = 'route' in input ? input.route : undefined;
  const picks = input.picks;

  // ① 合法性红灯：Run 创建资格层拒绝 ⇒ 非法装备
  if (!canStartFullRun(draft)) {
    throw new BatchRunError(
      'illegal',
      `非法装备：${input.label} 未通过 Run 创建资格层（canStartFullRun=false）`,
    );
  }
  // ① 合法性红灯：装配校验失败（车身/轮组/武器/能量不合法）
  const validation = validateSnapshot(buildSnapshotFromDraft(draft, registry), registry);
  if (!validation.valid) {
    throw new BatchRunError(
      'illegal',
      `非法装备：${input.label} 装配校验失败 —— ${validation.errors.join('；')}`,
    );
  }
  // ② 路线红灯：只允许既有的 default / heavy / rush
  if (route !== undefined && route !== 'heavy' && route !== 'rush') {
    throw new BatchRunError(
      'route',
      `错误路线：${input.label} 收到未知路线 "${route}"（仅允许 default/heavy/rush）`,
    );
  }

  const loadout: RunPlayerLoadout = {
    source: 'profile',
    label: input.label,
    draft,
    tag: PRODUCT_TAG,
    key: `content-batch:${input.label}`,
  };
  const ctx = runPageContext(loadout, route);

  const nodeSeq: string[] = [];
  const buildSeq: string[][] = [];
  const pickFacts: BatchPickResult[] = [];
  const segs: BatchSegResult[] = [];
  let s: RunPageState = createRunPageState(ctx);
  let carry: number | null = null;
  /** 清场残留守卫：同一时刻只允许一个战斗运行时存活。 */
  let active: RunBattleRuntime | null = null;

  for (let guard = 0; guard < 40; guard++) {
    if (s.phase === 'COMPLETE' || s.phase === 'FAILED') break;
    const before = s;
    if (nodeSeq[nodeSeq.length - 1] !== s.nodeId) nodeSeq.push(s.nodeId);

    if (s.phase === 'BATTLE') {
      if (active) {
        throw new BatchRunError('residue', '清场残留：上一场战斗运行时未释放即开始下一场');
      }
      const node = runCurrentNode(s);
      const build = [...runBuildIds(s)];
      buildSeq.push(build);
      const rt = new RunBattleRuntime({
        build,
        carriedHp: carry,
        encounterId: node.encounterId,
        playerDraft: draft,
        playerLoadoutTag: PRODUCT_TAG,
        playerBaseline: true,
      });
      active = rt;
      try {
        const res = rt.contactResidue();
        if (res.contact || res.impact || res.damage) {
          throw new BatchRunError(
            'residue',
            `清场残留：新战斗运行时携带上一场接触事实（contact=${res.contact} impact=${res.impact} damage=${res.damage}）`,
          );
        }
        const atStart = rt.hp();
        let steps = 0;
        while (rt.result === null && steps < MAX_FRAMES) {
          rt.step(FRAME_MS);
          steps += 1;
        }
        const hp = rt.hp();
        let hits = 0;
        let damage = 0;
        const perHit: number[] = [];
        for (const read of Object.values(rt.playerWeaponHitSummary())) {
          hits += read.count;
          damage += read.damages.reduce((a, b) => a + b, 0);
          perHit.push(...read.damages);
        }
        segs.push({
          nodeId: node.id,
          encounterId: node.encounterId!,
          build,
          hpA0: atStart.a,
          hpA: hp.a,
          hpB: hp.b,
          hpBMax: atStart.bMax,
          steps,
          winner: rt.result?.winner ?? null,
          hits,
          damage,
          perHit: [...new Set(perHit)].sort((a, b) => a - b),
        });
        s = finishRunBattle(s, {
          winner: rt.result?.winner ?? null,
          endReason: rt.result?.endReason ?? null,
          playerHp: hp.a,
          enemyHp: hp.b,
          steps: rt.stepCount,
        });
      } finally {
        rt.dispose();
        active = null;
      }
      continue;
    }

    if (s.phase === 'CHOICE') {
      const pool = runChoicePool(s).map((o) => o.id);
      const pick = picks[s.buffs.length] ?? '';
      pickFacts.push({
        nodeId: s.nodeId,
        kind: runChoicePoolKind(s),
        layer: runChoicePoolLayer(s),
        pool,
        pick,
        accepted: (pool as readonly string[]).includes(pick),
      });
      s = chooseRunBuff(s, pick, ctx);
      if (s === before) break;
      continue;
    }

    if (s.phase === 'EVENT') carry = runCarriedPlayerHp(s);
    s = pressRunAction(s, ctx);
    if (s === before) break;
  }

  // ③ 跳过 / 卡死阶段红灯：没到达任何终态
  if (s.phase !== 'COMPLETE' && s.phase !== 'FAILED') {
    throw new BatchRunError(
      'stuck',
      `未按预期到达终态（跳过/卡死阶段）：${input.label} 停在 ${s.phase}，已跑 ${segs.length} 场`,
    );
  }

  return {
    label: input.label,
    route: route ?? 'default',
    phase: s.phase,
    complete: runComplete(s),
    failed: runFailed(s),
    nodeSeq,
    buildSeq,
    picks: pickFacts,
    segs,
    battlesCompleted: s.battlesCompleted,
    logTail: s.log.slice(-2).map((e) => e.text),
  };
}

/* ------------------------------------------------------- 机器可读汇总 */

export interface BatchSummaryRow {
  readonly label: string;
  readonly route: ContentRoute;
  readonly phase: string;
  readonly battles: number;
  /** 三段对手（按实际序列）。 */
  readonly encounters: readonly string[];
  /** 三段胜者。 */
  readonly winners: readonly string[];
  /** 三段我方终局耐久。 */
  readonly hpA: readonly number[];
  /** 三段对手终局耐久。 */
  readonly hpB: readonly number[];
  /** 三段真实步数。 */
  readonly steps: readonly number[];
}

/** 把一批结果压成机器可读汇总行（确定性内容验收的落盘口径）。 */
export function batchSummaryRows(results: readonly BatchRunResult[]): BatchSummaryRow[] {
  return results.map((r) => ({
    label: r.label,
    route: r.route,
    phase: r.phase,
    battles: r.battlesCompleted,
    encounters: r.segs.map((s) => s.encounterId),
    winners: r.segs.map((s) => s.winner ?? '-'),
    hpA: r.segs.map((s) => Math.round(s.hpA)),
    hpB: r.segs.map((s) => Math.round(s.hpB)),
    steps: r.segs.map((s) => s.steps),
  }));
}

/** 打印机器可读汇总表（console）。 */
export function printBatchSummary(results: readonly BatchRunResult[]): string {
  const rows = batchSummaryRows(results);
  const header =
    '  case'.padEnd(22) +
    'route'.padEnd(8) +
    'phase'.padEnd(9) +
    'B'.padStart(2) +
    '  encounters / winners / hpA / hpB / steps';
  const body = rows
    .map((r) =>
      `  ${r.label.padEnd(22)}${String(r.route).padEnd(8)}${r.phase.padEnd(9)}` +
        `${String(r.battles).padStart(2)}  ` +
        r.encounters.map((e, i) => `${e}:${r.winners[i]}(${r.hpA[i]}/${r.hpB[i]},${r.steps[i]})`).join(' '),
    )
    .join('\n  ');
  const out = `\n##### CONTENT-BATCH-FOUNDATION 确定性汇总（${rows.length} 例）#####\n${header}\n  ${body}`;
  // eslint-disable-next-line no-console
  console.log(out);
  return out;
}

/* ----------------------------------------------------- 复用便利：默认槽位 */

/** 暴露产品默认武器槽位（声明式 spec 装配 cannon / machineGun 时的键）。 */
export const DEFAULT_WEAPON_SLOT = WEAPON_SLOT;
export { EMPTY_SLOT };
export { RUN_TOTAL_BATTLES };
