/**
 * PRP-F0-RUN-PAGE-SHELL｜PRP-R3-CAPYBARA-UI-HIERARCHY-REBUILD
 * ｜PRP-F1-PORTRAIT-PLANCK-BATTLE-INTEGRATION
 * ｜PRP-RUN-R1-DEATH-AND-DURABILITY-CONTINUITY
 * ｜PRP-RUN-02-FULL-RUN-VERTICAL-SLICE
 * Portrait Run Prototype —— Run Page targeted 测试（纯 node，无 DOM）。
 *
 * ## PRP-RUN-02：本文件的流程口径 = **固定 Run Script 的节点序列**
 *
 * 状态机不再自己数「第几场 / 第几选」，而是读 `runScript.ts` 的节点序列：
 *
 *     d1-start(EVENT) → d2-battle1(BATTLE) → d2-choice1(CHOICE) → d3-battle2(BATTLE)
 *       → d4-durability(DURABILITY) ─┬─ repair  → d5-tend(EVENT · DAY5 焊车) ────┐
 *                                    └─ upgrade → d4-lateral(CHOICE · DAY4 横向) ┴→ d5-choice2(CHOICE · DAY5)
 *                                      → d6-battle3(BATTLE) → d7-final(FINAL) → COMPLETE / FAILED
 *
 * ⚠️ PRP-RUN-02-R1（真人验收修正）：`d4-durability` 与 `d5-choice2` 是**两个独立节点** ——
 *    维修的机会成本只是「DAY 4 这一次额外改装」，**不是**「整局第二层 Build」。
 *    两条分支都会到达 DAY 5 的第二次条件三选一（见 RP-RUN-02-R1-01 / RP-22b / RP-07）。
 *
 * ⚠️ PRP-RUN-02-R2（真人验收修正）：修正前两条分支的差别**只剩耐久** ⇒ 维修**严格支配**
 *    继续改装。现在「继续改装」多经过 `d4-lateral`（**横向改装**：另外两项未拥有一层，二选一）
 *    ⇒ 两条分支各拿一种优势：**维修 = 生存优势 / 继续改装 = 构筑数量优势（多一项改装）**。
 *    候选池的**种类**由 CHOICE 节点声明（`node.choicePool`），测试也按种类定位
 *    （`runChoicePoolKind`）而不是按「第几选」数数（见 RP-RUN-02-R2-01 / RP-F2-11b）。
 *
 * 因此本文件**不再**用「第 N 场 / 第 N 选」定位状态，而是用 `walk.at(nodeId, phase)`
 * 按**脚本节点 id** 定位 —— 与产品代码同一套判据（页面里没有 `if (day === X)`，
 * 测试里也不应该有）。
 *
 * 覆盖九层：
 *   A) 页面层级：竖屏 390×844 四条横带无缝无叠；PRP-R3 比例（顶 80 / 台 302 / 志 378 / 作 84）；
 *   B) 八状态机 + 脚本驱动流程（同一页面内，零跳转）；
 *   C) 中部舞台：IDLE 待机近景 vs 真实 Planck 战斗世界；
 *   D) 面积账本：**逐脚本节点**整页像素面积精确冻结（浏览器端再用真实 getImageData 交叉核对）；
 *   E) 源码守卫：Debug 与玩家界面分离、只经 runBattleRuntime 接正式战斗、不存在任何页面跳转；
 *   F) 信息层级：顶部无空槽 / IDLE 主体是真实车辆 sprite / 日志是玩家叙事 / 浮层独占焦点；
 *   G) 两层 Cannon Build 闭环（四场真实战斗 + 两次强化 + 一次耐久取舍）；
 *   H) **Run Script 数据源 + 耐久事件**（本 Queue 的核心新增面）；
 *   I) 死亡即终局：单一耐久贯穿 Run、失败后只能重开。
 *
 * 面积 / 耐久期望值都是**冻结字面量**（不是就地重算）：任何影响流程或布局的改动都必须
 * 显式更新这里，从而让「像素 / 流程悄悄变了」这件事无法发生。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { PORTRAIT_LOGICAL_H, PORTRAIT_LOGICAL_W } from '../src/lab/portraitBattleLab/constants';
import { buildSpawnPlan } from '../src/lab/portraitBattleLab/entities';
import { registry } from '../src/core/content';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import { OPPONENT_TEMPLATES } from '../src/player/opponentPool';
import { LAB_ENCOUNTERS, LAB_LOADOUTS } from '../src/lab/portraitBattleLab/testData';
import {
  RUN_ACTION_BAND,
  RUN_BANDS,
  RUN_BUFF_ICON_MAX,
  RUN_CHOICE,
  RUN_LOG,
  RUN_LOG_BAND,
  RUN_LOG_LABEL_POS,
  RUN_PAGE_H,
  RUN_PAGE_W,
  RUN_SIDE_VIEW,
  RUN_STAGE_BAND,
  RUN_STAGE_HAZE_H,
  RUN_TOP_BAND,
  runActionBarRect,
  runActionButtonRect,
  runBuffIconRects,
  runChoiceBarRect,
  runChoiceCardRects,
  runChoiceIconRect,
  runChoiceMaskRect,
  runChoiceTextX,
  runChoiceTitlePos,
  runDayNodes,
  runLogBottomY,
  runLogLineRects,
  runLogTopY,
  runPaintedAreas,
  runStageHills,
  runRectsOverlap,
  runSideViewScale,
  runStageBaselineY,
  runStageGroundRect,
  runStageGroundY,
  runStageRoadRect,
  type RunLayeredRect,
  type RunRect,
} from '../src/lab/portraitBattleLab/runPageLayout';
import {
  RUN_BATTLES_TOTAL,
  RUN_CHOICE_OPTIONS,
  RUN_COMPLETE_LABEL,
  RUN_DAYS_TOTAL,
  RUN_MAX_CHOICES,
  RUN_PHASES,
  RUN_RESTART_LABEL,
  chooseRunBuff,
  createRunPageState,
  durabilityPercent,
  finishRunBattle,
  formatRunLog,
  pressRunAction,
  resolveDurability,
  runActionEnabled,
  runActionLabel,
  runBuildIds,
  runCarriedPlayerHp,
  runChoiceOpen,
  runChoicePool,
  runChoicePoolKind,
  runChoicePoolLayer,
  runComplete,
  runCurrentNode,
  runDurabilityOpen,
  runDurabilityOptions,
  runDurabilityTitle,
  runFailed,
  runMainRouteId,
  runNodeKind,
  runOverlayCards,
  runOverlayOpen,
  runStartsNewRun,
  syncRunBattle,
  visibleRunLog,
  type RunPageContext,
  type RunPageState,
  type RunPhase,
} from '../src/lab/portraitBattleLab/runPageState';
import {
  RUN_DURABILITY_EVENT,
  RUN_FIRST_DAY,
  RUN_SCRIPT,
  RUN_SCRIPT_FIRST_ID,
  RUN_SCRIPT_BATTLE_NODE_IDS,
  requireRunScriptNode,
  runDurabilityBranchNodeId,
  runScriptBattleNodes,
  runScriptKindSequence,
  runScriptNode,
  type RunDurabilityChoiceId,
} from '../src/lab/portraitBattleLab/runScript';
import {
  EMERGENCY_REPAIR_FRACTION,
  RUN_LAYER1_POOL,
  RUN_LAYER2_POOLS,
  runLayer1PoolDefs,
  runLateralPoolDefs,
  runModifierById,
} from '../src/lab/portraitBattleLab/runModifiers';
import {
  buildRunStageView,
  entityVisualWidth,
  hasPlaceholderVisual,
  runDemoPlan,
  runPageContext,
  runPageLayerShapes,
} from '../src/lab/portraitBattleLab/runPageScene';
import {
  RUN_BATTLE_VIEW_H,
  RUN_BATTLE_VIEW_INSET,
  RUN_BATTLE_VIEW_W,
  RunBattleRuntime,
} from '../src/lab/portraitBattleLab/runBattleRuntime';
import { RUN_VISUAL_ASSETS } from '../src/lab/portraitBattleLab/runVehicleAssets';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const LAB_DIR = join(REPO_ROOT, 'src', 'lab', 'portraitBattleLab');
const RUN_PAGE_FILES = [
  'runPageLayout.ts',
  'runPageState.ts',
  'runPageScene.ts',
  'runScript.ts',
  'runPage.ts',
  'runMain.ts',
  'runVehicleAssets.ts',
  'runBattleRuntime.ts',
  'runBattleView.ts',
];

function read(f: string): string {
  return readFileSync(join(LAB_DIR, f), 'utf8');
}

/** 剥注释后再做源码匹配（守卫必须扛得住「注释里写了禁用词」的自指陷阱）。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function inside(r: RunRect, band: RunRect): boolean {
  return r.x >= band.x && r.y >= band.y && r.x + r.w <= band.x + band.w && r.y + r.h <= band.y + band.h;
}

/** 逐帧账本（渲染与测试共用的同一入口）。 */
function ledger(s: RunPageState): Record<string, number> {
  return runPaintedAreas(runPageLayerShapes(s, buildRunStageView()));
}

function layersOf(s: RunPageState): readonly RunLayeredRect[] {
  return runPageLayerShapes(s, buildRunStageView());
}

const CTX: RunPageContext = runPageContext();

/**
 * 脚本节点 id 的**命名常量**（测试里不允许出现 `if (day === X)` 那样的位置猜测）。
 * 与 `runScript.ts` 的 `RUN_SCRIPT` 一一对应；对不上会在 H 段被显式断言。
 */
const NODE = {
  start: 'd1-start',
  battle1: 'd2-battle1',
  choice1: 'd2-choice1',
  battle2: 'd3-battle2',
  durability: 'd4-durability',
  /** ⚠️ PRP-RUN-02-R2：**继续改装**分支的横向改装二选一（仅该分支经过）。 */
  lateral: 'd4-lateral',
  tend: 'd5-tend',
  choice2: 'd5-choice2',
  battle3: 'd6-battle3',
  final: 'd7-final',
} as const;

/** 四场真实战斗的 Encounter（= 台阶 ①~④；全部只是既有正式对手模板的引用）。 */
const LADDER = {
  [NODE.battle1]: 'PineappleFireBrute',
  [NODE.battle2]: 'PineappleSawRusher',
  [NODE.battle3]: 'ProtoRusher',
  [NODE.final]: 'BananaRodLaser',
} as const;

/* ---------------------------------------- 真实战斗驱动器（与宿主同一条链） */

const FRAME_MS = 1000 / 60;
/** 上限远大于实测结束时间（≈16s ≈ 960 帧）：只用于防止死循环，不参与断言。 */
const MAX_FRAMES = 4000;

/** 推进 `frames` 帧真实物理，并同步 HP / 步数（**日志零追加**，与宿主一致）。 */
function driveFrames(s: RunPageState, rt: RunBattleRuntime, frames: number): RunPageState {
  let cur = s;
  for (let i = 0; i < frames && cur.phase === 'BATTLE'; i++) {
    rt.step(FRAME_MS);
    const hp = rt.hp();
    cur = syncRunBattle(cur, { playerHp: hp.a, enemyHp: hp.b, steps: rt.stepCount });
    const r = rt.result;
    if (r) {
      cur = finishRunBattle(cur, {
        winner: r.winner ?? null,
        endReason: r.endReason ?? null,
        playerHp: hp.a,
        enemyHp: hp.b,
        steps: rt.stepCount,
      });
    }
  }
  return cur;
}

/** 推进到官方出结果（或触顶）。 */
function driveToEnd(s: RunPageState, rt: RunBattleRuntime): RunPageState {
  return driveFrames(s, rt, MAX_FRAMES);
}

/** 本场武器件的真实 `behaviorParams`（证明 Build 真的注入到运行时零件上）。 */
function weaponParamsOf(rt: RunBattleRuntime): Record<string, unknown> {
  const part = rt.orchestrator.vehicleA.parts.find((p) => p.def.category === 'weapon');
  return { ...((part?.def.behaviorParams ?? {}) as Record<string, unknown>) };
}

/** 单步上限（远大于脚本节点数；只防死循环）。 */
const WALK_GUARD = 40;

/* ------------------------------------------------------- 单局脚本驱动器 */

interface WalkOpts {
  /** 耐久事件的分支（必选；两分支都是真实产品路径）。 */
  readonly durability: RunDurabilityChoiceId;
  /** 第一次强化（第一层三选一）。 */
  readonly layer1: string;
  /**
   * **横向改装**（`d4-lateral`，只在「继续改装」分支出现）。
   * 不传 → 取当前横向池的**第一项**（= 另外两项未拥有一层强化里的第一个）。
   * ⚠️ 维修分支不经过这个节点，传了也不会被用到。
   */
  readonly lateral?: string;
  /** 第二次强化（第二层条件池）—— **两条分支都会**到达 `d5-choice2`（PRP-RUN-02-R1）。 */
  readonly layer2: string;
  /**
   * 提供则用**合成战果**（不跑物理，毫秒级）——只服务状态机 / 账本结构断言；
   * 不提供则跑**真实物理**（慢，按 (分支, 一层, 二层) 缓存）。
   */
  readonly syntheticHp?: readonly number[];
}

interface RunWalk {
  /** 按 `${nodeId}:${phase}` 取「该节点第一次处于该 phase」的状态（不存在 → 抛错）。 */
  at(nodeId: string, phase: RunPhase): RunPageState;
  has(nodeId: string, phase: RunPhase): boolean;
  /** 真实物理模式下的武器参数（按战斗顺序）；合成模式为空。 */
  readonly weaponParams: readonly Record<string, unknown>[];
  /** 真实物理模式下的能力结束态（按战斗顺序）；合成模式为空。 */
  readonly abilityEnd: readonly { kineticBurst: boolean; kineticHits: number }[];
  /** 每场战斗**开局**耐久（= 状态机注入的值；合成模式同样有效）。 */
  readonly openingHp: readonly number[];
  /** 每场战斗生效的 Build（按战斗顺序）。 */
  readonly builds: readonly (readonly string[])[];
  /** 走过的节点 id（按首次到达顺序）。 */
  readonly nodeSeq: readonly string[];
  /** 在 `d4-lateral` 实际选中的横向改装 id（没经过该节点 → `null`）。 */
  readonly lateralPick: string | null;
  /** 全部中间状态（含同一节点不同 phase）。 */
  readonly trail: readonly RunPageState[];
  readonly finalRuntime: RunBattleRuntime | null;
}

function walkRun(o: WalkOpts): RunWalk {
  const states = new Map<string, RunPageState>();
  const trail: RunPageState[] = [];
  const nodeSeq: string[] = [];
  const openingHp: number[] = [];
  const builds: string[][] = [];
  const weaponParams: Record<string, unknown>[] = [];
  const abilityEnd: { kineticBurst: boolean; kineticHits: number }[] = [];
  let lateralPick: string | null = null;

  const record = (s: RunPageState): void => {
    trail.push(s);
    if (nodeSeq[nodeSeq.length - 1] !== s.nodeId) nodeSeq.push(s.nodeId);
    const k = `${s.nodeId}:${s.phase}`;
    if (!states.has(k)) states.set(k, s);
  };

  let s = createRunPageState(CTX);
  record(s);
  /** ⚠️ carry 只在「上一场已结束、本场未建立」的窗口可读（见 `runCarriedPlayerHp` 文档）。 */
  let carry: number | null = null;
  let hpIdx = 0;
  let prevRt: RunBattleRuntime | null = null;
  let finalRuntime: RunBattleRuntime | null = null;

  for (let guard = 0; guard < WALK_GUARD; guard++) {
    if (s.phase === 'COMPLETE' || s.phase === 'FAILED') break;

    if (s.phase === 'BATTLE') {
      const node = runCurrentNode(s);
      openingHp.push(s.battle!.playerHp);
      builds.push([...runBuildIds(s)]);
      if (o.syntheticHp) {
        const hp = o.syntheticHp[Math.min(hpIdx, o.syntheticHp.length - 1)];
        hpIdx += 1;
        s = finishRunBattle(s, { winner: 'A', endReason: 'hp', playerHp: hp, enemyHp: 0, steps: 300 });
        record(s);
        continue;
      }
      const rt = new RunBattleRuntime({
        build: runBuildIds(s),
        carriedHp: carry,
        encounterId: node.encounterId,
      });
      prevRt?.dispose();
      prevRt = rt;
      finalRuntime = rt;
      weaponParams.push(weaponParamsOf(rt));
      s = driveToEnd(s, rt);
      const ab = rt.abilitySnapshot();
      abilityEnd.push({ kineticBurst: ab.kineticBurst, kineticHits: ab.kineticHits });
      record(s);
      continue;
    }

    if (s.phase === 'CHOICE') {
      /*
        ⚠️ PRP-RUN-02-R2：按**当前节点声明的池种类**选，不再按「第几选」数数 ——
        因为「继续改装」分支现在有三个 CHOICE 节点（第一层 → 横向 → 第二层），
        而维修分支只有两个。`runChoicePoolKind` 是数据层的原值。
      */
      const kind = runChoicePoolKind(s);
      const pick =
        kind === 'layer1'
          ? o.layer1
          : kind === 'lateral'
            ? (o.lateral ?? runChoicePool(s)[0]?.id ?? '')
            : kind === 'layer2'
              ? o.layer2
              : '';
      if (kind === 'lateral') lateralPick = pick;
      s = chooseRunBuff(s, pick, CTX);
      record(s);
      continue;
    }

    if (s.phase === 'DURABILITY') {
      s = resolveDurability(s, o.durability, CTX);
      record(s);
      continue;
    }

    if (s.phase === 'EVENT') carry = runCarriedPlayerHp(s);
    s = pressRunAction(s, CTX);
    record(s);
  }

  return {
    at(nodeId, phase) {
      const hit = states.get(`${nodeId}:${phase}`);
      if (!hit) throw new Error(`[test] 本局没有走到 ${nodeId}:${phase}（节点序列：${nodeSeq.join(' → ')}）`);
      return hit;
    },
    has: (nodeId, phase) => states.has(`${nodeId}:${phase}`),
    weaponParams,
    abilityEnd,
    openingHp,
    builds,
    nodeSeq,
    lateralPick,
    trail,
    finalRuntime,
  };
}

/**
 * 合成驾驶：真实物理非常慢（四场 ≈ 3.5s / 路线），结构断言只需要「流程怎么走」，
 * 因此用**合成战果**（`finishRunBattle` 直接喂数值）走完同一套真实脚本。
 *
 * 默认耐久序列 [900, 800, 850, 700]：全部远高于 0 → 全胜到 COMPLETE。
 */
function syntheticWalk(
  durability: RunDurabilityChoiceId = 'upgrade',
  layer1 = 'heavyShell',
  layer2 = 'kineticBurst',
  hp: readonly number[] = [900, 800, 850, 700],
  lateral?: string,
): RunWalk {
  return walkRun({ durability, layer1, lateral, layer2, syntheticHp: hp });
}

const realCache = new Map<string, RunWalk>();

function realWalk(
  durability: RunDurabilityChoiceId,
  layer1: string,
  layer2: string,
  lateral?: string,
): RunWalk {
  const key = `${durability}|${layer1}|${lateral ?? '-'}|${layer2}`;
  const hit = realCache.get(key);
  if (hit) return hit;
  const w = walkRun({ durability, layer1, lateral, layer2 });
  realCache.set(key, w);
  return w;
}

/** ⚠️ 真实路线只跑一次并缓存 → 运行时统一在文件结束时释放（不在单个用例里 dispose）。 */
afterAll(() => {
  for (const w of realCache.values()) w.finalRuntime?.dispose();
  realCache.clear();
});

/* ---------------------------------------- 快捷定位（读起来就是产品叙事） */

/** 开场（脚本第一个节点：DAY 1 的行进节拍）。 */
function fresh(): RunPageState {
  return createRunPageState(CTX);
}

/** 从开场连续按 n 次主动作（只用于边界 / 误触断言）。 */
function pressTimes(s: RunPageState, n: number): RunPageState {
  let cur = s;
  for (let i = 0; i < n; i++) cur = pressRunAction(cur, CTX);
  return cur;
}

/** 合成一份「刚打完一场」的状态（不跑物理）。 */
function settle(s: RunPageState, playerHp: number, enemyHp = 0, winner: 'A' | 'B' = 'A'): RunPageState {
  return finishRunBattle(s, { winner, endReason: 'hp', playerHp, enemyHp, steps: 300 });
}

/** 已经推进到第一个战斗节点的 BATTLE（= 三次主动作）。 */
function atBattle1(): RunPageState {
  return pressTimes(fresh(), 3);
}

/** 从开场推进到指定战斗节点的 BATTLE，并建立与宿主同口径的真实运行时。 */
function startRealBattle(nodeId: string): { rt: RunBattleRuntime; bt: RunPageState } {
  let s = fresh();
  for (let i = 0; i < WALK_GUARD && (s.nodeId !== nodeId || s.phase !== 'BATTLE'); i++) {
    s = pressRunAction(s, CTX);
  }
  expect(s.nodeId).toBe(nodeId);
  expect(s.phase).toBe('BATTLE');
  const rt = new RunBattleRuntime({
    build: runBuildIds(s),
    carriedHp: s.battle!.playerHp,
    encounterId: runCurrentNode(s).encounterId,
  });
  return { rt, bt: s };
}

/* ======================================================= A. 页面层级 */

describe('PRP-F0｜A 页面层级：竖屏 390×844 四条横带', () => {
  it('RP-01 逻辑基准 390×844；四带自上而下无缝无叠、合计正好铺满', () => {
    expect(RUN_PAGE_W).toBe(PORTRAIT_LOGICAL_W);
    expect(RUN_PAGE_H).toBe(PORTRAIT_LOGICAL_H);
    expect(RUN_PAGE_W).toBe(390);
    expect(RUN_PAGE_H).toBe(844);
    expect(RUN_PAGE_W).toBeLessThan(RUN_PAGE_H); // 竖屏

    expect(RUN_BANDS.length).toBe(4);
    let cursor = 0;
    for (const band of RUN_BANDS) {
      expect(band.x).toBe(0);
      expect(band.w).toBe(RUN_PAGE_W);
      expect(band.y).toBe(cursor); // 上一条的底边 = 下一条的顶边（无缝隙）
      cursor += band.h;
    }
    expect(cursor).toBe(RUN_PAGE_H); // 合计正好铺满（无溢出）
    for (let i = 0; i < RUN_BANDS.length; i++) {
      for (let j = i + 1; j < RUN_BANDS.length; j++) {
        expect(runRectsOverlap(RUN_BANDS[i], RUN_BANDS[j])).toBe(false);
      }
    }
    // 顶部必须是「薄层」：不超过总高的 12%
    expect(RUN_TOP_BAND.h).toBeLessThanOrEqual(Math.round(RUN_PAGE_H * 0.12));
  });

  it('RP-01b PRP-R3 必改 1/2/3：四带比例同时落在「绝对像素」与「百分比」两个区间', () => {
    const pct = (h: number): number => (h / RUN_PAGE_H) * 100;
    const px = RUN_BANDS.map((b) => b.h);
    const ratio = RUN_BANDS.map((b) => pct(b.h));
    const [topPx, stagePx, logPx, actionPx] = px;
    const [topPct, stagePct, logPct, actionPct] = ratio;

    // 百分比区间（Queue：顶 8~10 / 台 33~36 / 志 40~45 / 作 8~10）
    expect(topPct).toBeGreaterThanOrEqual(8);
    expect(topPct).toBeLessThanOrEqual(10);
    expect(stagePct).toBeGreaterThanOrEqual(33);
    expect(stagePct).toBeLessThanOrEqual(36);
    expect(logPct).toBeGreaterThanOrEqual(40);
    expect(logPct).toBeLessThanOrEqual(45);
    expect(actionPct).toBeGreaterThanOrEqual(8);
    expect(actionPct).toBeLessThanOrEqual(10);

    // 绝对像素区间（Queue：顶 70~80 / 台 280~310 / 志 约370 / 作 80~90）
    expect(topPx).toBeGreaterThanOrEqual(70);
    expect(topPx).toBeLessThanOrEqual(80);
    expect(stagePx).toBeGreaterThanOrEqual(280);
    expect(stagePx).toBeLessThanOrEqual(310);
    expect(logPx).toBeGreaterThanOrEqual(365);
    expect(logPx).toBeLessThanOrEqual(385);
    expect(actionPx).toBeGreaterThanOrEqual(80);
    expect(actionPx).toBeLessThanOrEqual(90);

    // 冻结字面量（现值）
    expect(px).toEqual([80, 302, 378, 84]);
    expect(RUN_STAGE_BAND.h).toBe(RUN_PAGE_H - topPx - logPx - actionPx);

    // 顶部薄层必须装得下「DAY 行 + 已获得图标行」（图标底边不得越入舞台带）
    for (const icon of runBuffIconRects(RUN_BUFF_ICON_MAX)) expect(inside(icon, RUN_TOP_BAND)).toBe(true);
    for (const n of runDayNodes(RUN_DAYS_TOTAL)) expect(inside(n, RUN_TOP_BAND)).toBe(true);
  });

  it('RP-02 顶部薄层：DAY 进度一行 + 已获得强化一行（右对齐节点 / 左对齐图标，互不重叠）', () => {
    const nodes = runDayNodes(RUN_DAYS_TOTAL);
    expect(nodes.length).toBe(7);
    for (const n of nodes) expect(inside(n, RUN_TOP_BAND)).toBe(true);
    for (let i = 1; i < nodes.length; i++) expect(nodes[i].x).toBeGreaterThan(nodes[i - 1].x + nodes[i - 1].w);
    // 右对齐
    expect(nodes[nodes.length - 1].x + nodes[nodes.length - 1].w).toBe(RUN_PAGE_W - 16);

    const icons = runBuffIconRects(RUN_BUFF_ICON_MAX);
    expect(icons.length).toBe(RUN_BUFF_ICON_MAX);
    for (const s of icons) expect(inside(s, RUN_TOP_BAND)).toBe(true);
    for (let i = 1; i < icons.length; i++) expect(icons[i].x).toBeGreaterThan(icons[i - 1].x + icons[i - 1].w);
    expect(icons[0].x).toBe(16); // 左对齐
    // 两行分明：进度节点行与图标行不重叠（薄层里两行互不干扰）
    for (const n of nodes) for (const s of icons) expect(runRectsOverlap(n, s)).toBe(false);
    // 图标行本身不承载文字 → 整块是纯色（可精确入账）
    expect(icons.length * icons[0].w * icons[0].h).toBe(5 * 30 * 30);
  });

  it('RP-03 IDLE 待机近景：地线 / 路面落在舞台带内、车贴基线、近景只有玩家一辆', () => {
    const view = buildRunStageView();
    expect(view.groundY).toBe(runStageGroundY());
    expect(view.baselineY).toBe(runStageBaselineY());
    expect(view.baselineY).toBe(view.groundY - RUN_SIDE_VIEW.baselineLiftPx);
    expect(view.groundY).toBeGreaterThan(RUN_STAGE_BAND.y);
    expect(view.groundY).toBeLessThan(RUN_STAGE_BAND.y + RUN_STAGE_BAND.h);
    // 必改 2：地面不压在战斗区最底边（底下要留出路面）
    expect(RUN_STAGE_BAND.y + RUN_STAGE_BAND.h - view.groundY).toBeGreaterThanOrEqual(40);
    expect(view.ground).toEqual(runStageGroundRect());
    expect(view.road).toEqual(runStageRoadRect());
    expect(inside(view.ground, RUN_STAGE_BAND)).toBe(true);
    expect(inside(view.road, RUN_STAGE_BAND)).toBe(true);

    // 玩家：左边缘 = 舞台左边距
    expect(view.player.bounds.x).toBe(RUN_STAGE_BAND.x + RUN_SIDE_VIEW.marginPx);
    // 贴地（底边 = 基线，压在基线上方 2px，不污染路面纯色）
    expect(view.player.bounds.y).toBe(view.baselineY - view.player.bounds.h);
    expect(runRectsOverlap(view.player.bounds, view.ground)).toBe(false);
    expect(runRectsOverlap(view.player.bounds, view.road)).toBe(false);
    // 全部可视件落在舞台带内（不得越出玩家可见区）
    for (const v of view.player.visuals) expect(inside(v.rect, RUN_STAGE_BAND)).toBe(true);
  });

  it('RP-04 下部冒险记录：标题与全部行都在日志带内，且不越过最底动作区', () => {
    // 标签（区块名）在第一条可见行上方
    expect(RUN_LOG_LABEL_POS.y).toBeLessThan(runLogTopY(RUN_LOG.maxLines));
    expect(inside({ x: RUN_LOG_LABEL_POS.x, y: RUN_LOG_LABEL_POS.y - 12, w: 60, h: 14 }, RUN_LOG_BAND)).toBe(true);

    const lines = runLogLineRects(RUN_LOG.maxLines);
    expect(lines.length).toBe(RUN_LOG.maxLines);
    expect(lines.length).toBe(12);
    for (const r of lines) expect(inside(r, RUN_LOG_BAND)).toBe(true);
    expect(runLogBottomY(RUN_LOG.maxLines)).toBeLessThan(RUN_ACTION_BAND.y);
    // 行间不重叠，且自上而下顺序排列
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i].y).toBe(lines[i - 1].y + RUN_LOG.lineH);
      expect(runRectsOverlap(lines[i], lines[i - 1])).toBe(false);
    }
    // 真实手机尺寸可直接阅读：行高 ≥ 26px（实绘字号 15px）
    expect(RUN_LOG.lineH).toBeGreaterThanOrEqual(26);
    expect(stripComments(read('runPage.ts')).includes('15px')).toBe(true);
  });

  it('RP-05 最底：唯一一个主动作按钮，落在动作带内', () => {
    const btn = runActionButtonRect();
    expect(inside(btn, RUN_ACTION_BAND)).toBe(true);
    expect(btn.w).toBeGreaterThan(200); // 触控友好
    expect(btn.x).toBe(RUN_PAGE_W - (btn.x + btn.w)); // 水平居中
    // 主动作不与日志区 / 舞台重叠
    expect(runRectsOverlap(btn, RUN_LOG_BAND)).toBe(false);
    expect(runRectsOverlap(btn, RUN_STAGE_BAND)).toBe(false);
    // 强调条（入账的纯色块）落在按钮内
    expect(inside(runActionBarRect(), btn)).toBe(true);
  });
});

/* ======================================== B. 八状态机 + 脚本驱动流程 */

describe('PRP-RUN-02｜B 八状态机与固定 Run Script 流程（同一页面内）', () => {
  it('RP-06 初始 = 脚本第一个节点（DAY 1 的行进节拍），日志已是玩家叙事', () => {
    const s = fresh();
    expect(s.phase).toBe('IDLE');
    expect(RUN_PHASES).toContain(s.phase);
    expect(s.nodeId).toBe(RUN_SCRIPT_FIRST_ID);
    expect(s.nodeId).toBe(NODE.start);
    expect(runNodeKind(s)).toBe('EVENT');
    expect(s.day).toBe(RUN_FIRST_DAY);
    expect(s.day).toBe(1);
    expect(s.dayTotal).toBe(RUN_DAYS_TOTAL);
    expect(s.dayTotal).toBe(7);

    // 日志 = DAY 行 + 该节点的 beat 叙事（占位符已用正式展示名替换）
    const first = requireRunScriptNode(NODE.start);
    expect(s.log.length).toBe(1 + first.beat.length);
    expect(s.log[0].kind).toBe('day');
    expect(s.log[0].text).toBe('DAY 1');
    expect(s.log[1].kind).toBe('travel');
    expect(s.log[1].text).toContain(CTX.vehicleLabel);
    expect(s.log.some((e) => e.text.includes('{'))).toBe(false); // 占位符已全部替换
    expect(runActionLabel(s)).toBe('继续');
    expect(runActionEnabled(s)).toBe(true);
    expect(s.buffs.length).toBe(0);
    expect(s.battle).toBeNull();
    // fresh 契约（构造不走 goPhase）
    expect(s.phaseTrail).toEqual(['IDLE']);
    expect(s.transitions).toBe(0);
    expect(s.revision).toBe(0);
    expect(s.actionCount).toBe(0);
  });

  it('RP-07 必改 1：状态机按脚本推进 —— 两条分支都到达 DAY 5 第二次三选一', () => {
    // ⚠️ PRP-RUN-02-R1（真人验收修正）：维修分支**不再**跳过 `d5-choice2`。
    // ⚠️ PRP-RUN-02-R2：两条分支现在是**各自的中间节点 + 同一个汇合点** ——
    //    repair  = 全部节点 **去掉 `d4-lateral`**（维修分支没有这一次横向改装）
    //    upgrade = 全部节点 **去掉 `d5-tend`**（改装那天不修车）
    const repair = syntheticWalk('repair');
    expect(repair.nodeSeq).toEqual(RUN_SCRIPT.map((n) => n.id).filter((id) => id !== NODE.lateral));
    expect(repair.has(NODE.tend, 'IDLE')).toBe(true);
    expect(repair.has(NODE.lateral, 'CHOICE')).toBe(false);
    expect(repair.has(NODE.choice2, 'CHOICE')).toBe(true);
    expect(repair.at(NODE.final, 'COMPLETE').phase).toBe('COMPLETE');
    // 每个节点都**只被走到一次**（不会因为汇合而重复呈现）
    expect(new Set(repair.nodeSeq).size).toBe(repair.nodeSeq.length);

    //    upgrade = 只少 `d5-tend`（那一天用来改装，不修车）—— 第二层三选一同样到达
    const upgrade = syntheticWalk('upgrade');
    expect(upgrade.nodeSeq).toEqual(RUN_SCRIPT.map((n) => n.id).filter((id) => id !== NODE.tend));
    expect(upgrade.has(NODE.lateral, 'CHOICE')).toBe(true);
    expect(upgrade.has(NODE.tend, 'IDLE')).toBe(false);
    expect(upgrade.has(NODE.choice2, 'CHOICE')).toBe(true);
    expect(upgrade.at(NODE.final, 'COMPLETE').phase).toBe('COMPLETE');
    expect(new Set(upgrade.nodeSeq).size).toBe(upgrade.nodeSeq.length);
    // 脚本里 BATTLE + FINAL 恰好四场
    expect(runScriptBattleNodes().map((n) => n.id)).toEqual([NODE.battle1, NODE.battle2, NODE.battle3, NODE.final]);
    expect(RUN_SCRIPT_BATTLE_NODE_IDS.length).toBe(RUN_BATTLES_TOTAL);
    expect(RUN_BATTLES_TOTAL).toBe(4);
    expect(runScriptKindSequence()).toEqual([
      'EVENT',
      'BATTLE',
      'CHOICE',
      'BATTLE',
      'DURABILITY',
      'CHOICE',
      'EVENT',
      'CHOICE',
      'BATTLE',
      'FINAL',
    ]);
  });

  it('RP-08 战斗节点是**两段式**：IDLE →(按一次) EVENT 敌情 →(再按) BATTLE', () => {
    const s1 = pressRunAction(fresh(), CTX); // DAY 1 节拍 → DAY 2 战斗节点
    expect(s1.phase).toBe('IDLE');
    expect(s1.nodeId).toBe(NODE.battle1);
    expect(s1.day).toBe(2);
    expect(runActionLabel(s1)).toBe('继续');

    const ev = pressRunAction(s1, CTX);
    expect(ev.phase).toBe('EVENT');
    expect(ev.nodeId).toBe(NODE.battle1);
    // 敌情叙事 = 该节点的 `encounter` 行，占位符换成正式展示名
    const node = requireRunScriptNode(NODE.battle1);
    expect(ev.log.length).toBe(s1.log.length + node.encounter!.length);
    expect(ev.log[ev.log.length - 1].kind).toBe('event');
    expect(ev.log[ev.log.length - 1].text).toContain(CTX.encounters[NODE.battle1].label);
    expect(ev.log.some((e) => e.text.includes('{'))).toBe(false);
    expect(runActionLabel(ev)).toBe('遭遇敌人');
    expect(runActionEnabled(ev)).toBe(true);
    // 原日志只追加、不重排
    expect(ev.log.slice(0, s1.log.length)).toEqual(s1.log);

    const bt = pressRunAction(ev, CTX);
    expect(bt.phase).toBe('BATTLE');
    expect(runActionLabel(bt)).toBe('战斗中');
    expect(runActionEnabled(bt)).toBe(false); // 禁触
  });

  it('RP-09 BATTLE：不可误触推进；入场不写日志；耐久上限来自共享数据；第一场满耐久', () => {
    const w = syntheticWalk();
    const bt = w.at(NODE.battle1, 'BATTLE');
    expect(pressRunAction(bt, CTX)).toBe(bt); // 同引用 = 真 no-op
    expect(bt.battle).not.toBeNull();
    expect(bt.battle!.playerHpMax).toBe(1100);
    expect(bt.battle!.playerHp).toBe(1100); // 第一场：carry = null → 满耐久开幕
    expect(runCarriedPlayerHp(fresh())).toBeNull();
    // 敌情来自**该节点的 Encounter**（HP 上限是真实解析值，不是手写）
    expect(bt.battle!.enemyHpMax).toBe(CTX.encounters[NODE.battle1].hpMax);
    expect(bt.battle!.enemyHp).toBe(bt.battle!.enemyHpMax);
    expect(bt.battle!.steps).toBe(0);
    expect(bt.battle!.done).toBe(false);
    expect(bt.battle!.winner).toBeNull();
    // BATTLE 是自动推进 → 入场那一下也不写日志
    const ev = w.at(NODE.battle1, 'EVENT');
    expect(bt.log).toEqual(ev.log);
    expect('totalSteps' in bt.battle!).toBe(false); // 无脚本参数残留
  });

  it('RP-10 BATTLE 期间不刷逐帧伤害日志；开局 41 帧内**零伤害**（先有距离、后有交火）', () => {
    const { rt, bt } = startRealBattle(NODE.battle1);
    let cur = bt;
    for (const chunk of [1, 1, 1, 5, 13, 20]) {
      const next = driveFrames(cur, rt, chunk);
      expect(next.phase).toBe('BATTLE'); // 还没打完
      expect(next.log).toEqual(bt.log); // 日志零变化
      cur = next;
    }
    expect(cur.battle!.steps).toBe(41);
    // ⚠️ 实测：`PineappleFireBrute` 的**首次命中在 185 帧（≈3.1s）** —— 41 帧时双方仍满血
    //    （「先有距离、后有交火」；这也是本节点作为**低压台阶**的可感知依据）。
    expect(cur.battle!.enemyHp).toBe(bt.battle!.enemyHp);
    expect(cur.battle!.playerHp).toBe(bt.battle!.playerHp);
    // 继续推进到首次交火之后（41 + 220 = 261 帧 > 185）→ 敌方耐久真实下降，日志依旧一字未动
    const late = driveFrames(cur, rt, 220);
    expect(late.battle!.steps).toBe(261);
    expect(late.battle!.enemyHp).toBeLessThan(bt.battle!.enemyHp);
    expect(late.log).toEqual(bt.log);
    rt.dispose();
  });

  it('RP-11 RESULT：一次性追加 3 行玩家叙事（胜负 + 耐久百分比 + **该节点自己的** after）', () => {
    const w = syntheticWalk();
    const res = w.at(NODE.battle1, 'RESULT');
    const ev = w.at(NODE.battle1, 'EVENT');
    expect(res.log.length).toBe(ev.log.length + 3);
    const added = res.log.slice(-3);
    expect(added[0].kind).toBe('result');
    expect(added[0].text).toBe('战斗胜利。');
    expect(added[1].kind).toBe('durability');
    expect(added[1].text).toBe(`战车耐久剩余 ${durabilityPercent(res.battle!)}%。`);
    expect(added[2].kind).toBe('result');
    // ⚠️ 第三行来自**脚本节点的 `after`** —— 页面里没有 `if (day === X)`
    expect(added[2].text).toBe(requireRunScriptNode(NODE.battle1).after![0]);
    expect(res.battle!.done).toBe(true);
    expect(runActionLabel(res)).toBe('继续');
    expect(runActionEnabled(res)).toBe(true);
    // 每个战斗节点的 after 各不相同（「接下来是什么」不是同一句话）
    const afters = runScriptBattleNodes()
      .filter((n) => n.after)
      .map((n) => n.after![0]);
    expect(new Set(afters).size).toBe(afters.length);
  });

  it('RP-12 CHOICE：浮层打开、日志一字不动、战斗结论整体保留、遮罩恰覆盖整页', () => {
    const res = syntheticWalk().at(NODE.battle1, 'RESULT');
    const ch = pressRunAction(res, CTX);
    expect(ch.phase).toBe('CHOICE');
    expect(ch.nodeId).toBe(NODE.choice1);
    expect(runChoiceOpen(ch)).toBe(true);
    expect(runOverlayOpen(ch)).toBe(true);
    expect(ch.log).toEqual(res.log); // 既不加也不减（CHOICE 节点的 beat 是空数组）
    expect(ch.buffs).toEqual(res.buffs);
    expect(ch.battle).toEqual(res.battle); // 浮层下面是同一个战场
    expect(runOverlayCards(ch).map((o) => o.id)).toEqual(RUN_CHOICE_OPTIONS.map((o) => o.id));
    expect(runChoiceMaskRect()).toEqual({ x: 0, y: 0, w: RUN_PAGE_W, h: RUN_PAGE_H });
  });

  it('RP-13 选择后**按脚本推进到下一个节点**：顶部新增图标 + 历史完整 + DAY 前进', () => {
    const s1 = syntheticWalk().at(NODE.choice1, 'CHOICE');
    const after = chooseRunBuff(s1, RUN_CHOICE_OPTIONS[0].id, CTX);
    expect(after.phase).toBe('IDLE');
    expect(after.nodeId).toBe(NODE.battle2); // 脚本 `next`
    expect(after.day).toBe(3); // d3-battle2 的 day
    expect(after.buffs.length).toBe(s1.buffs.length + 1);
    expect(after.buffs[0].id).toBe(RUN_CHOICE_OPTIONS[0].id);
    expect(after.buffs[0].label).toBe('重型弹头');
    // 追加：① 强化记录（自然语言）② 新 DAY 行 ③ 新节点的 beat
    const nextBeat = requireRunScriptNode(NODE.battle2).beat.length;
    expect(after.log.length).toBe(s1.log.length + 2 + nextBeat);
    expect(after.log[s1.log.length].kind).toBe('choice');
    expect(after.log[s1.log.length].text).toBe('你为大炮装上了重型弹头。');
    expect(after.log[s1.log.length + 1].text).toBe('DAY 3');
    // 历史完整：CHOICE 之前的全部行原样保留
    expect(after.log.slice(0, s1.log.length)).toEqual(s1.log);
    for (let i = 1; i < after.log.length; i++) expect(after.log[i].seq).toBe(after.log[i - 1].seq + 1);
    // 本局 Build 被记录；第一层不是维修项 → 无耐久补偿
    expect(runBuildIds(after)).toEqual([RUN_CHOICE_OPTIONS[0].id]);
    expect(after.repairBonus).toBe(0);
  });

  it('RP-13b 未选择之前本局没有任何强化（本局临时状态，新建 Run 回到空 Build）', () => {
    const w = syntheticWalk();
    expect(runBuildIds(fresh())).toEqual([]);
    expect(runBuildIds(w.at(NODE.start, 'IDLE'))).toEqual([]);
    expect(runBuildIds(w.at(NODE.choice1, 'CHOICE'))).toEqual([]);
  });

  it('RP-14 误触保护：BATTLE / CHOICE / DURABILITY 按主动作 no-op；未知强化 id no-op', () => {
    const w = syntheticWalk();
    const bt = w.at(NODE.battle1, 'BATTLE');
    const res = w.at(NODE.battle1, 'RESULT');
    const ch = w.at(NODE.choice1, 'CHOICE');
    const dur = w.at(NODE.durability, 'DURABILITY');
    expect(pressRunAction(bt, CTX)).toBe(bt);
    expect(pressRunAction(ch, CTX)).toBe(ch);
    expect(pressRunAction(dur, CTX)).toBe(dur); // 耐久事件必须点卡片
    expect(chooseRunBuff(ch, 'not-a-buff', CTX)).toBe(ch);
    expect(chooseRunBuff(res, RUN_CHOICE_OPTIONS[0].id, CTX)).toBe(res); // 非 CHOICE 不生效
    // 非 BATTLE 状态不接受帧同步 / 结束回报（真 no-op，同引用）
    expect(syncRunBattle(res, { playerHp: 1, enemyHp: 1, steps: 1 })).toBe(res);
    expect(finishRunBattle(res, { winner: 'A', endReason: 'hp', playerHp: 1, enemyHp: 0, steps: 1 })).toBe(res);
    // CHOICE 浮层上做耐久裁决也不生效（`resolveDurability` 只认 DURABILITY）
    expect(resolveDurability(ch, 'repair', CTX)).toBe(ch);
  });

  it('RP-15 第一层三选项固定且正是 Queue 点名的 Cannon 三选一（本局临时，不随机）', () => {
    expect(RUN_CHOICE_OPTIONS.length).toBe(3);
    expect(RUN_CHOICE_OPTIONS.map((o) => o.label)).toEqual(['重型弹头', '双联炮', '快速装填']);
    expect(RUN_CHOICE_OPTIONS.map((o) => o.note)).toEqual([
      '炮弹更重，撞击和后坐都更明显',
      '一次开火连续打出两发炮弹',
      '开炮节奏明显变快',
    ]);
    expect(RUN_CHOICE_OPTIONS.map((o) => o.id)).toEqual(['heavyShell', 'twinCannon', 'fastReload']);
    expect(new Set(RUN_CHOICE_OPTIONS.map((o) => o.id)).size).toBe(3);
    for (const o of RUN_CHOICE_OPTIONS) {
      expect(o.note.length).toBeGreaterThan(0);
      expect(o.note.includes('[')).toBe(false);
      expect(o.note.length).toBeLessThanOrEqual(16); // 一句结果，不是说明段
    }
    // 两个不同选项给出可区分的日志结果（选择真的生效）
    const at = (): RunPageState => syntheticWalk().at(NODE.choice1, 'CHOICE');
    const a = chooseRunBuff(at(), RUN_CHOICE_OPTIONS[1].id, CTX);
    const b = chooseRunBuff(at(), RUN_CHOICE_OPTIONS[2].id, CTX);
    expect(a.buffs[0].id).toBe('twinCannon');
    expect(b.buffs[0].id).toBe('fastReload');
    // 强化记录行位于「下一个节点的 DAY 行」之前
    const beat = requireRunScriptNode(NODE.battle2).beat.length;
    expect(a.log[a.log.length - 2 - beat].text).toBe('你为大炮加装了一门副炮。');
    expect(b.log[b.log.length - 2 - beat].text).toBe('你改进了大炮的装填机构。');
  });

  it('RP-16 真实战斗的帧同步是纯函数：同样的步数序列 → 同样的 HP / 结局', () => {
    const { rt, bt } = startRealBattle(NODE.battle1);
    const oneShot = driveToEnd(bt, rt);
    expect(oneShot.phase).toBe('RESULT');
    const replay = finishRunBattle(
      syncRunBattle(bt, {
        playerHp: oneShot.battle!.playerHp,
        enemyHp: oneShot.battle!.enemyHp,
        steps: oneShot.battle!.steps,
      }),
      {
        winner: oneShot.battle!.winner,
        endReason: oneShot.battle!.endReason,
        playerHp: oneShot.battle!.playerHp,
        enemyHp: oneShot.battle!.enemyHp,
        steps: oneShot.battle!.steps,
      },
    );
    expect(replay.battle).toEqual(oneShot.battle);
    expect(replay.log).toEqual(oneShot.log);
    expect(replay.phase).toBe(oneShot.phase);
    rt.dispose();
  });

  it('RP-17 状态机上下文按**节点 id** 提供敌情（展示名 / 耐久上限都来自共享数据）', () => {
    const plan = runDemoPlan();
    expect(CTX.playerHpMax).toBe(plan.player.hp);
    expect(CTX.playerHpMax).toBe(1100);
    expect(CTX.vehicleLabel).toBe('西瓜重炮');
    // 每个 BATTLE / FINAL 节点都有敌情，且 hpMax 就是该 Encounter 的真实解析值
    for (const node of runScriptBattleNodes()) {
      const info = CTX.encounters[node.id];
      expect(info, `${node.id} 必须有敌情`).toBeDefined();
      expect(info.hpMax).toBeGreaterThan(0);
      expect(info.label.length).toBeGreaterThan(0);
      const enc = LAB_ENCOUNTERS.find((e) => e.id === node.encounterId)!;
      expect(info.label).toBe(enc.label);
    }
    // 旧口径（单一 `encounterLabel` / `enemyHpMax`）已随四场阶梯一起移除
    expect('encounterLabel' in CTX).toBe(false);
    expect('enemyHpMax' in CTX).toBe(false);
    // 日志文本不再被二次格式化
    expect(formatRunLog({ seq: 1, kind: 'durability', text: '战车耐久剩余 78%。' })).toBe('战车耐久剩余 78%。');
  });
});

/* =================================  C. 中部舞台：待机近景 vs 真实战斗世界 */

describe('PRP-F1｜C 中部舞台：IDLE 近景 + 真实战斗世界（正式世界尺度）', () => {
  it('RP-18 必改 1：战斗世界用正式 arena 尺度，不是「按舞台带宽生成的假 arena」', () => {
    const { rt } = startRealBattle(NODE.battle1);
    expect(rt.arenaWidth).toBe(1600); // 正式 DEFAULT_ARENA_CONFIG.width
    expect(rt.arenaWidth).not.toBe(RUN_STAGE_BAND.w); // 且**不等于**舞台带宽 390
    expect(rt.arenaHeight).toBe(900);
    expect(rt.groundY).toBe(700);
    expect(Math.round(rt.spawnAx)).toBe(400);
    expect(Math.round(rt.spawnBx)).toBe(1200);
    expect(rt.spawnSeparation).toBeCloseTo(800, 0);
    rt.dispose();
  });

  it('RP-19 必改 2：开局有明确距离（实测两车外廓间距 > 400 世界 px）', () => {
    const { rt } = startRealBattle(NODE.battle1);
    const gap = rt.gapWorld();
    expect(gap).toBeGreaterThan(400);
    // ⚠️ 冻结实测值（车身 + 轮 + 部件 + visual）。节点 ① 的对手 = `PineappleFireBrute`
    //    （喷火器 + 锤的冲刺车，车身比 `ProtoRusher` 更小）⇒ 外廓间距比旧记录大。
    expect(Math.round(gap)).toBe(606);
    expect(gap / rt.arenaWidth).toBeGreaterThan(0.25);
    rt.dispose();
  });

  it('RP-20 PRP-R5 必改 1/2：相机 = **正式 battle 相机链**，PRP 只做 viewport adapter', () => {
    const runtime = stripComments(read('runBattleRuntime.ts'));
    const view = stripComments(read('runBattleView.ts'));
    expect(runtime.includes('runBattleCamera')).toBe(false);
    expect(runtime.includes('RUN_BATTLE_GROUND_FRAC')).toBe(false);
    expect(/viewW\s*\/\s*world/.test(runtime)).toBe(false);

    expect(view.includes('this.renderer.transform =')).toBe(false);
    expect(view.includes('applyBattleFollow')).toBe(false);
    expect(view.includes('reframe(')).toBe(true);
    expect(/'battle'/.test(view)).toBe(true);
    expect(view.includes('const phase = runtime.phase;')).toBe(true);
    expect(/\{ phase \}/.test(view)).toBe(true);
    expect(view.includes('shouldReframeBattleCamera(phase, this.lastPhase)')).toBe(true);
    expect(view.indexOf('reframe(')).toBeLessThan(view.indexOf('renderer.render('));

    expect(RUN_BATTLE_VIEW_INSET).toEqual({ x: 56, y: 28 });
    expect(RUN_BATTLE_VIEW_W).toBe(RUN_STAGE_BAND.w + 112);
    expect(RUN_BATTLE_VIEW_H).toBe(RUN_STAGE_BAND.h + 56);
    expect(view.includes('RUN_BATTLE_VIEW_W')).toBe(true);
    expect(view.includes('RUN_BATTLE_VIEW_H')).toBe(true);
    expect(view.includes('RUN_BATTLE_VIEW_INSET.x * this.dpr')).toBe(true);
    expect(view.includes('RUN_BATTLE_VIEW_INSET.y * this.dpr')).toBe(true);
  });

  it('RP-21 IDLE 近景缩放公式对**全部** Lab 组合都成立（战斗相机不参与 IDLE 构图）', () => {
    const avail = RUN_PAGE_W - 2 * RUN_SIDE_VIEW.marginPx - RUN_SIDE_VIEW.gapPx;
    let checked = 0;
    for (const l of LAB_LOADOUTS) {
      for (const e of LAB_ENCOUNTERS) {
        const plan = buildSpawnPlan(l.id, e.id);
        const pw = entityVisualWidth(plan.player);
        for (const enemy of plan.enemies) {
          const ew = entityVisualWidth(enemy);
          const scale = runSideViewScale(pw, ew);
          expect(scale).toBeGreaterThan(0);
          expect(scale).toBeLessThanOrEqual(RUN_SIDE_VIEW.maxScale);
          expect((pw + ew) * scale).toBeLessThanOrEqual(avail + 1e-6);
          checked += 1;
        }
      }
    }
    // 2 Loadout × (1+1+3+1 既有 + 3 新增单敌) = 18 个敌人实例
    expect(checked).toBe(18);
  });
});

/* ============================================ D. 面积账本（像素精确） */

/** 一个常驻帧的账面（day + 已获得图标数）—— 避免重复写同样的字面量。 */
function ledgerState(o: { day: number; icons: number }): Record<string, number> {
  return {
    ground: 780,
    road: 19500,
    nodeDone: o.day * 128,
    nodeTodo: (7 - o.day) * 128,
    buffIcon: 756 * o.icons,
    buffChip: 144 * o.icons,
    cardBar: 0,
    actionBar: 990,
  };
}

/** 已进入真实战斗世界（EVENT 起）的常驻帧账面。 */
function ledgerBattle(o: { day: number; icons: number; action: boolean }): Record<string, number> {
  return { ...ledgerState(o), ground: 0, road: 0, actionBar: o.action ? 990 : 0 };
}

describe('PRP-RUN-02｜D 面积账本：逐脚本节点的整页像素面积精确冻结', () => {
  /**
   * 入账的只有「**不承载文字、不被描边、不被 sprite / 图标覆盖**的纯色平铺矩形」：
   * 地线 / 路面 / 进度节点 / 主动作强调条 / 卡片强调条 / 已获得强化图标（底 + 高光块）。
   *
   * ⚠️ `ground` / `road` 只是 **IDLE 待机近景** 的两层。EVENT 起舞台带被真实 Planck
   *    战斗世界（离屏位图）整块覆盖 → 这两层不再带精确色 → 账面归 0。
   * ⚠️ 浮层（CHOICE / DURABILITY）遮罩把整页合成成新颜色 → 底层几何全部退出精确色，
   *    本帧只登记浮层自己的卡片强调条（两者**复用同一套几何** → 零布局改动）。
   */
  const overlayLedger = (cards: number): Record<string, number> => ({
    ground: 0,
    road: 0,
    nodeDone: 0,
    nodeTodo: 0,
    buffIcon: 0,
    buffChip: 0,
    cardBar: cards * 1240,
    actionBar: 0,
  });

  it('RP-22 改装分支：沿十个脚本节点的面积 = 冻结字面量', () => {
    const w = syntheticWalk('upgrade', 'heavyShell', 'kineticBurst');
    const at = (n: string, p: RunPhase): Record<string, number> => ledger(w.at(n, p));

    // ---- d1-start：DAY 1 节拍（待机近景 + 1 个进度节点）
    expect(at(NODE.start, 'IDLE')).toEqual(ledgerState({ day: 1, icons: 0 }));
    // ---- d2-battle1：IDLE → EVENT → BATTLE → RESULT
    expect(at(NODE.battle1, 'IDLE')).toEqual(ledgerState({ day: 2, icons: 0 }));
    expect(at(NODE.battle1, 'EVENT')).toEqual(ledgerBattle({ day: 2, icons: 0, action: true }));
    expect(at(NODE.battle1, 'BATTLE')).toEqual(ledgerBattle({ day: 2, icons: 0, action: false }));
    expect(at(NODE.battle1, 'RESULT')).toEqual(ledgerBattle({ day: 2, icons: 0, action: true }));
    // ---- d2-choice1：三张卡片（仍在 DAY 2）
    expect(at(NODE.choice1, 'CHOICE')).toEqual(overlayLedger(3));
    // ---- d3-battle2：拿到第一层强化（DAY 3 + 1 个图标）
    expect(at(NODE.battle2, 'IDLE')).toEqual(ledgerState({ day: 3, icons: 1 }));
    expect(at(NODE.battle2, 'RESULT')).toEqual(ledgerBattle({ day: 3, icons: 1, action: true }));
    // ---- d4-durability：**两张卡片**的耐久取舍浮层（DAY 4）
    expect(at(NODE.durability, 'DURABILITY')).toEqual(overlayLedger(2));
    // ---- d4-lateral：横向改装**二选一**（仍在 DAY 4；浮层帧不登记图标）
    expect(at(NODE.lateral, 'CHOICE')).toEqual(overlayLedger(2));
    // ---- d5-choice2：第二次条件三选一（DAY 5；横向已经拿到 → 浮层后是 2 个图标）
    expect(at(NODE.choice2, 'CHOICE')).toEqual(overlayLedger(3));
    // ---- d6-battle3：拿到第二层（DAY 6 + **3 个图标** = 一层 + 横向 + 二层）
    expect(at(NODE.battle3, 'IDLE')).toEqual(ledgerState({ day: 6, icons: 3 }));
    expect(at(NODE.battle3, 'BATTLE')).toEqual(ledgerBattle({ day: 6, icons: 3, action: false }));
    expect(at(NODE.battle3, 'RESULT')).toEqual(ledgerBattle({ day: 6, icons: 3, action: true }));
    // ---- d7-final + COMPLETE：DAY 7 全亮，三项改装都在；终态主动作可点
    expect(at(NODE.final, 'IDLE')).toEqual(ledgerState({ day: 7, icons: 3 }));
    expect(at(NODE.final, 'BATTLE')).toEqual(ledgerBattle({ day: 7, icons: 3, action: false }));
    expect(at(NODE.final, 'COMPLETE')).toEqual(ledgerBattle({ day: 7, icons: 3, action: true }));

    // 跨 day 的不变量：节点总量恒 896（只是「已完成 / 未完成」前移）
    for (const day of [1, 2, 3, 6, 7]) {
      expect(ledgerState({ day, icons: 0 }).nodeDone + ledgerState({ day, icons: 0 }).nodeTodo).toBe(896);
    }
    // 图标总量口径：每个 30×30（底色 756 + 高光块 144）；0 个 → 面积 0（不是空槽）
    expect(ledger(fresh()).buffIcon).toBe(0);
    expect(ledger(fresh()).buffChip).toBe(0);
    for (const n of [0, 1, 2, 3]) expect(ledgerState({ day: 1, icons: n }).buffIcon + 144 * n).toBe(900 * n);
  });

  it('RP-22b 维修分支：DAY 5 先走 EVENT 当日叙事，**再**进入第二次条件三选一（PRP-RUN-02-R1）', () => {
    const up = syntheticWalk('upgrade');
    const rep = syntheticWalk('repair');
    // 维修分支：`d5-tend` 是 EVENT 节点（无浮层）→ 此刻 DAY 5 只有 1 个图标
    expect(ledger(rep.at(NODE.tend, 'IDLE'))).toEqual(ledgerState({ day: 5, icons: 1 }));
    // ⚠️ PRP-RUN-02-R1：维修**不吞掉**第二层 —— 当日叙事之后仍然打开 `d5-choice2` 的三张卡片
    expect(rep.has(NODE.choice2, 'CHOICE')).toBe(true);
    expect(ledger(rep.at(NODE.choice2, 'CHOICE'))).toEqual(overlayLedger(3));
    // 选完第二层 → DAY 6 起 2 个图标
    expect(ledger(rep.at(NODE.battle3, 'IDLE'))).toEqual(ledgerState({ day: 6, icons: 2 }));
    expect(ledger(rep.at(NODE.final, 'COMPLETE'))).toEqual(ledgerBattle({ day: 7, icons: 2, action: true }));
    // 汇合**之前**（d2 / d3 / d4）两分支账面逐字段相同（分支还没发生）
    for (const [n, p] of [
      [NODE.battle1, 'RESULT'],
      [NODE.choice1, 'CHOICE'],
      [NODE.battle2, 'IDLE'],
      [NODE.durability, 'DURABILITY'],
    ] as const) {
      expect(ledger(rep.at(n, p)), `${n}:${p}`).toEqual(ledger(up.at(n, p)));
    }
    // `d5-choice2` 是**两条分支共用的同一个节点**；浮层帧不登记图标 → 账面逐字段相同
    expect(ledger(rep.at(NODE.choice2, 'CHOICE'))).toEqual(ledger(up.at(NODE.choice2, 'CHOICE')));
    /*
      ⚠️ PRP-RUN-02-R2：汇合**之后**两分支的**节点进程**仍然相同，但**账面不再相同** ——
      继续改装分支多一项横向改装 ⇒ 顶部多一个 30×30 图标（底色 756 + 高光块 144）。
      「维修 = 生存优势 / 继续改装 = 构筑数量优势」这句话，在像素账本上的**精确差额**就是这 900。
      ⚠️ R1 时代这里断言的是「汇合后逐字段相同」（那时两条分支确实一样）—— 该断言已随 R2 失效，
         换成下面这条**更强**的（同时钉住节点进程相同 + 差额恰好一个图标）。
    */
    expect(ledger(up.at(NODE.battle3, 'IDLE'))).toEqual(ledgerState({ day: 6, icons: 3 }));
    expect(ledger(up.at(NODE.final, 'COMPLETE'))).toEqual(ledgerBattle({ day: 7, icons: 3, action: true }));
    for (const [n, p] of [
      [NODE.battle3, 'IDLE'],
      [NODE.battle3, 'RESULT'],
      [NODE.final, 'IDLE'],
      [NODE.final, 'COMPLETE'],
    ] as const) {
      const r = ledger(rep.at(n, p));
      const u = ledger(up.at(n, p));
      // 除了顶部图标两层之外，其余每一项都必须逐字段相同（进程一致）
      expect({ ...u, buffIcon: 0, buffChip: 0 }, `${n}:${p}（汇合后·除了图标）`).toEqual({
        ...r,
        buffIcon: 0,
        buffChip: 0,
      });
      // 差额恰好 = 一个图标（30×30 底色 756 + 高光块 144）
      expect(u.buffIcon - r.buffIcon, `${n}:${p}（图标底色差）`).toBe(756);
      expect(u.buffChip - r.buffChip, `${n}:${p}（图标高光差）`).toBe(144);
    }
  });

  it('RP-23 浮层几何：3 张强化卡 / 2 张耐久卡互不重叠、纵向居中、只有卡片层入账', () => {
    for (const count of [3, 2]) {
      const cards = runChoiceCardRects(count);
      expect(cards.length).toBe(count);
      for (const c of cards) {
        expect(c.w).toBe(RUN_CHOICE.cardW);
        expect(c.h).toBe(RUN_CHOICE.cardH);
        expect(inside(c, { x: 0, y: 0, w: RUN_PAGE_W, h: RUN_PAGE_H })).toBe(true);
      }
      for (let i = 0; i < cards.length; i++) {
        for (let j = i + 1; j < cards.length; j++) expect(runRectsOverlap(cards[i], cards[j])).toBe(false);
      }
      // 纵向居中
      const top = cards[0].y;
      const bottom = cards[cards.length - 1].y + cards[cards.length - 1].h;
      expect(top).toBe(RUN_PAGE_H - bottom);
      // 强调条避开 2px 描边、不承载文字 → 面积可精确冻结
      const bar0 = runChoiceBarRect(cards[0]);
      expect(bar0.y).toBeGreaterThanOrEqual(cards[0].y + 2);
      expect(bar0.h * bar0.w).toBe(310 * 4);
      expect(runChoiceTitlePos(count).y).toBeLessThan(cards[0].y);
    }
    // 遮罩覆盖整个逻辑舞台（原页面整体变暗，位置不变）
    expect(runChoiceMaskRect()).toEqual({ x: 0, y: 0, w: RUN_PAGE_W, h: RUN_PAGE_H });

    // 账面：强化浮层只有 cardBar ×3；耐久浮层只有 cardBar ×2
    const w = syntheticWalk();
    const chShapes = layersOf(w.at(NODE.choice1, 'CHOICE'));
    expect(chShapes.every((sh) => sh.layer === 'cardBar')).toBe(true);
    expect(chShapes.length).toBe(3);
    const durShapes = layersOf(w.at(NODE.durability, 'DURABILITY'));
    expect(durShapes.every((sh) => sh.layer === 'cardBar')).toBe(true);
    expect(durShapes.length).toBe(2);
    // 两者共用**同一套**卡片几何（零布局改动）
    expect(durShapes.map((sh) => sh.rect)).toEqual(runChoiceCardRects(2).map(runChoiceBarRect));
  });
});

/* ============================================ E. 源码守卫 */

describe('PRP-F1｜E 源码守卫：Debug 分离 / 只经 runtime 接正式战斗 / 零跳转', () => {
  it('RP-24 Run Page 不得引用 Arena A/B、Gate、PBL Lab 控制器或俯视驱动', () => {
    const bannedTokens = [
      'arenaA',
      'arenaScene',
      'ArenaARuntime',
      'PlanckArenaRuntime',
      'drivePlanckVehicle',
      "from './gate'",
      'auditSharedCombatData',
      "from './lab'",
      'PortraitBattleLab',
      'pbl-',
      'PBL_',
    ];
    for (const f of RUN_PAGE_FILES) {
      const code = stripComments(read(f));
      for (const t of bannedTokens) {
        expect(code.includes(t), `${f} 不得出现 "${t}"`).toBe(false);
      }
    }
  });

  it('RP-24b 正式 Planck 侧视战斗**只能**从 runBattleRuntime.ts 进入，且构造时零 config 覆盖', () => {
    for (const f of RUN_PAGE_FILES.filter((x) => x !== 'runBattleRuntime.ts')) {
      expect(stripComments(read(f)).includes('planckBattleOrchestrator'), `${f} 必须经 runBattleRuntime`).toBe(false);
    }
    const rt = stripComments(read('runBattleRuntime.ts'));
    expect(rt.includes("from '../../battle/planckBattleOrchestrator'")).toBe(true);
    const call = rt.match(/new PlanckBattleOrchestrator\(([\s\S]*?)\);/);
    expect(call, 'runBattleRuntime 必须构造正式 PlanckBattleOrchestrator').not.toBeNull();
    const args = call![1].split(',').map((x) => x.trim()).filter(Boolean);
    expect(args.length).toBe(5); // A 快照 / B 快照 / registry / config / soloA
    const cfg = args[3].replace(/\s+/g, ' ');
    // PBL-FOUNDATION-RANGED-DISTANCE-CONTROL-R1：config 实参只允许两种合法形态 ——
    // 字面 `{}`，或**按 Encounter 声明**透出的正式 Movement Foundation 距离档（唯一例外）。
    // ⚠️ 收紧而非放宽：白名单只有这一条，且额外钉死「无数字」「不按 encounterId 判断」。
    expect([
      '{}',
      "this.plan.enemyDrive === 'keep-distance' ? { enemyDrive: ENEMY_KEEP_DISTANCE_BANDS } : {}",
    ]).toContain(cfg);
    expect(/[0-9]/.test(cfg), 'config 实参不得出现任何数字（数值只能来自正式模块）').toBe(false);
    expect(cfg.includes('encounterId')).toBe(false);
    for (const t of ['autoDrive:', 'sideDrive:', 'arenaConfig:', 'closingSpeed:', 'phases:']) {
      expect(cfg.includes(t), `config 不得覆盖 "${t}"`).toBe(false);
    }
    expect(rt.includes('this.orchestrator.arena.config.width')).toBe(true);
    expect(rt.includes('this.orchestrator.arena.config.groundY')).toBe(true);
    expect(/=\s*1600\b/.test(rt)).toBe(false);
    expect(/=\s*900\b/.test(rt)).toBe(false);
    expect(rt.includes('w.getPosition(this.orchestrator.vehicleA.body).x')).toBe(true);
    expect(/spawnAx = .*getPosition/.test(rt)).toBe(true);
    const view = stripComments(read('runBattleView.ts'));
    expect(view.includes('reframe(')).toBe(true);
    expect(view.includes('battleCam')).toBe(false);
    expect(view.includes('this.renderer.transform =')).toBe(false);
    // 战斗剧本 / 演出位移彻底不存在
    const state = stripComments(read('runPageState.ts'));
    for (const t of ['RUN_BATTLE_SCRIPT', 'advanceRunBattle', 'Math.sin']) {
      expect(state.includes(t), `runPageState 不得残留 "${t}"`).toBe(false);
    }
    const scene = stripComments(read('runPageScene.ts'));
    for (const t of ['RUN_SIDE_VIEW_CLOSING_PX', 'translateRunGroup', 'battleClosingOffset']) {
      expect(scene.includes(t), `runPageScene 不得残留 "${t}"`).toBe(false);
    }
    const layout = stripComments(read('runPageLayout.ts'));
    for (const t of ['RUN_SIDE_VIEW_CLOSING_PX', 'translateRunGroup']) {
      expect(layout.includes(t), `runPageLayout 不得残留 "${t}"`).toBe(false);
    }
  });

  it('RP-25 Run Page 不创建任何 DOM 按钮、不写 location / history（结构上无法跳转）', () => {
    for (const f of RUN_PAGE_FILES) {
      const code = stripComments(read(f));
      for (const t of [
        "createElement('button')",
        'createElement("button")',
        'location.href',
        'location.assign',
        'location.replace',
        'history.pushState',
        'history.replaceState',
        'window.open',
      ]) {
        expect(code.includes(t), `${f} 不得出现 "${t}"`).toBe(false);
      }
    }
    const page = stripComments(read('runPage.ts'));
    expect(page.includes('run-root')).toBe(true);
    expect(page.includes('run-canvas')).toBe(true);
    expect(page.includes('run-stage')).toBe(true);
  });

  it('RP-26 run-page.html 只挂 runMain.ts，且不含任何 PBL 开发控制标记', () => {
    const html = readFileSync(join(REPO_ROOT, 'run-page.html'), 'utf8');
    expect(html.includes('src/lab/portraitBattleLab/runMain.ts')).toBe(true);
    expect(html.includes('pbl-root')).toBe(false);
    expect(html.includes('pbl-bar')).toBe(false);
    expect(html.includes('pbl-btn')).toBe(false);
    expect(html.includes('pbl-gate')).toBe(false);
    expect(html.includes('pbl-canvas')).toBe(false);
    const main = read('runMain.ts');
    expect(main.includes("from './runPage'")).toBe(true);
    expect(main.includes('#run-root')).toBe(true);
  });

  it('RP-27 四个正式构建配置与正式入口 0 引用 Run Page（原型不得写入正式产物）', () => {
    for (const t of [
      'index.html',
      'vite.config.ts',
      'vite.pages.config.ts',
      'vite.e2e.config.ts',
      'vite.wechat.config.ts',
    ]) {
      const src = readFileSync(join(REPO_ROOT, t), 'utf8');
      expect(src.includes('run-page'), `${t} 不得引用 run-page`).toBe(false);
      expect(src.includes('runMain'), `${t} 不得引用 runMain`).toBe(false);
    }
    const labCfg = readFileSync(join(REPO_ROOT, 'vite.portrait-lab.config.ts'), 'utf8');
    expect(labCfg.includes("'run-page': 'run-page.html'")).toBe(true);
    expect(labCfg.includes("'portrait-lab': 'portrait-lab.html'")).toBe(true);
  });

  it('RP-28 玩家页面运行时不得出现开发控制（源码层已禁，另加运行时计数入口）', () => {
    const page = stripComments(read('runPage.ts'));
    expect(page.includes("createElement('div')")).toBe(true);
    expect(page.includes("createElement('canvas')")).toBe(true);
    expect(page.includes("createElement('button')")).toBe(false);
    expect(page.includes('button, [data-dev-control], [data-dev]')).toBe(true);
    expect(page.includes("querySelectorAll('button')")).toBe(true);
    expect(page.includes('debugControls')).toBe(true);
    expect(page.includes('domButtons')).toBe(true);
  });
});

/* ====================================== F. 信息层级（PRP-R3 + PRP-F1） */

describe('PRP-R3｜F 信息层级：少状态 / 大战斗主体 / 可读叙事 / 浮层独占焦点', () => {
  it('RP-29 必改 1：顶部彻底减法 —— 无空槽、无「核心构建 X/5」、无预留格子', () => {
    expect(runBuffIconRects(0)).toEqual([]);
    expect(layersOf(fresh()).filter((l) => l.layer === 'buffIcon')).toEqual([]);
    expect(layersOf(fresh()).filter((l) => l.layer === 'buffChip')).toEqual([]);
    for (const n of [1, 2, 3, 5]) expect(runBuffIconRects(n).length).toBe(n);
    expect(RUN_BUFF_ICON_MAX).toBeLessThanOrEqual(5);
    expect(runBuffIconRects(9).length).toBe(RUN_BUFF_ICON_MAX);
    // 图标个数与已获得强化严格一致（1 个强化 → 1 个图标）
    const after1 = syntheticWalk().at(NODE.battle2, 'IDLE');
    expect(layersOf(after1).filter((l) => l.layer === 'buffIcon').length).toBe(1);

    for (const f of RUN_PAGE_FILES) {
      const code = stripComments(read(f));
      for (const t of ['核心构建', 'CORE BUILD', '空槽', '预留', 'placeholderSlot', 'buildSlot']) {
        expect(code.includes(t), `${f} 玩家界面不得出现 "${t}"`).toBe(false);
      }
    }
  });

  it('RP-30 必改 3：日志是玩家叙事 —— 全流程无方括号前缀 / 无 Runtime 状态 / 无逐帧伤害', () => {
    for (const dur of ['repair', 'upgrade'] as const) {
      const allKinds = new Set<string>();
      for (const s of syntheticWalk(dur).trail) {
        for (const e of s.log) {
          allKinds.add(e.kind);
          expect(e.text.includes('['), `日志不得含方括号前缀：${e.text}`).toBe(false);
          expect(e.text.includes(']')).toBe(false);
          expect(e.text.includes('{')).toBe(false);
          expect(/^\[?(系统|事件|战斗|结果|耐久|强化)\]/.test(e.text), `日志不得以 Debug 标签开头：${e.text}`).toBe(
            false,
          );
          expect(e.text.trim().length).toBeGreaterThan(0);
          expect(e.text.length).toBeLessThanOrEqual(40); // 一句叙事，不是状态 dump
        }
      }
      // 使用的语义角色恰好是玩家叙事集（不含 system / battle 这类控制台角色）
      expect([...allKinds].sort()).toEqual(['choice', 'day', 'durability', 'event', 'result', 'travel']);
    }
    // 逐帧伤害绝不进日志
    const { rt, bt } = startRealBattle(NODE.battle1);
    const after = driveFrames(bt, rt, 89);
    expect(after.phase).toBe('BATTLE');
    expect(after.log).toEqual(bt.log);
    rt.dispose();
    // 最近事件才突出
    const finale = syntheticWalk().at(NODE.final, 'COMPLETE');
    expect(visibleRunLog(finale, 3).length).toBeLessThanOrEqual(3);
    expect(visibleRunLog(finale, 3)).toEqual(finale.log.slice(-3));
    expect(RUN_LOG.emphasis).toBeGreaterThanOrEqual(3);
    expect(RUN_LOG.emphasis).toBeLessThanOrEqual(5);
  });

  it('RP-31 必改 2：IDLE 战斗主体是**真实车辆视觉**（正式 sprite + 正式 anchor/镜像）', () => {
    const plan = runDemoPlan();
    expect(hasPlaceholderVisual(plan.player)).toBe(false);
    expect(hasPlaceholderVisual(plan.enemies[0])).toBe(false);

    const view = buildRunStageView();
    for (const v of view.player.visuals) {
      if (v.kind === 'wheel') continue;
      expect(v.visualId, `${v.kind} 必须有正式 visualId`).toBeTruthy();
    }
    const ids = new Set(view.player.visuals.map((v) => v.visualId).filter(Boolean));
    expect(ids.has('body_watermelon')).toBe(true);
    expect(ids.has('part_cannon')).toBe(true);
    for (const v of view.player.visuals) expect(v.mirror).toBe(false);

    const pw = view.player.bounds.w;
    expect(pw).toBeGreaterThan(RUN_STAGE_BAND.w * 0.4);
    expect(view.player.bounds.h).toBeGreaterThan(RUN_STAGE_BAND.h / 6);

    expect(Object.keys(RUN_VISUAL_ASSETS).sort()).toEqual([
      'body_banana',
      'body_watermelon',
      'part_cannon',
      'part_hammer',
      'part_pushRod',
    ]);
    const assets = stripComments(read('runVehicleAssets.ts'));
    expect(assets.includes('../../../assets/visuals/')).toBe(true);
    expect(assets.includes('body_watermelon.png')).toBe(true);
    for (const t of ['fillRect', 'arc(', 'drawImage(img, 0, 0']) {
      expect(assets.includes(t), `资源层不得自绘几何："${t}"`).toBe(false);
    }

    const page = stripComments(read('runPage.ts'));
    expect(page.includes('partFallback')).toBe(false);
    const battleView = stripComments(read('runBattleView.ts'));
    expect(battleView.includes("from '../../render/renderer'")).toBe(true);
    expect(battleView.includes("from '../../render/visualRegistry'")).toBe(true);
    expect(battleView.includes('new Renderer(')).toBe(true);
    expect(battleView.includes('setBattleBackdrop(true)')).toBe(true);
    expect(battleView.includes("from '../../presentation/playerPresentation'")).toBe(true);
  });

  it('RP-32 必改 2：IDLE 中部舞台有真实景物，不存在大片空场（山脊 / 雾带填满地平线以上）', () => {
    const hills = runStageHills();
    const view = buildRunStageView();
    const hillBaseY = view.groundY - 6;
    const bandMid = RUN_STAGE_BAND.y + RUN_STAGE_BAND.h / 2;

    const tallest = Math.max(...hills.far.map((h) => h.h));
    expect(hillBaseY - tallest).toBeLessThan(bandMid);
    const far = [...hills.far].sort((a, b) => a.x - b.x);
    let cursor = RUN_STAGE_BAND.x;
    for (const h of far) {
      expect(h.x).toBeLessThanOrEqual(cursor);
      cursor = Math.max(cursor, h.x + h.w);
    }
    expect(cursor).toBeGreaterThanOrEqual(RUN_STAGE_BAND.x + RUN_STAGE_BAND.w);
    expect(RUN_STAGE_HAZE_H).toBeGreaterThanOrEqual(80);
    expect(view.groundY - RUN_STAGE_HAZE_H).toBeGreaterThan(RUN_STAGE_BAND.y);
    expect(view.player.bounds.y + view.player.bounds.h).toBe(view.baselineY);
    expect(view.player.bounds.y + view.player.bounds.h / 2).toBeGreaterThan(bandMid);
  });

  it('RP-33 浮层（强化 / 耐久）= 图标 + 名称 + 一句结果，且成为唯一视觉焦点', () => {
    const cards = runChoiceCardRects(RUN_CHOICE_OPTIONS.length);
    expect(RUN_CHOICE.cardW).toBeGreaterThanOrEqual(RUN_PAGE_W * 0.8);
    for (const c of cards) {
      const icon = runChoiceIconRect(c);
      expect(inside(icon, c)).toBe(true);
      expect(icon.w).toBe(RUN_CHOICE.iconSize);
      expect(icon.w).toBe(icon.h);
      expect(runChoiceTextX(c)).toBeGreaterThan(icon.x + icon.w);
      expect(runChoiceTextX(c)).toBeLessThan(c.x + c.w);
      expect(runRectsOverlap(runChoiceBarRect(c), icon)).toBe(false);
    }
    expect(runChoiceTitlePos(3).y).toBeLessThan(cards[0].y);
    const mask = runChoiceMaskRect();
    expect(mask.w * mask.h).toBe(RUN_PAGE_W * RUN_PAGE_H);
    expect(stripComments(read('runPage.ts')).includes('rgba(')).toBe(true);
    for (const o of RUN_CHOICE_OPTIONS) {
      expect(/^[\u4e00-\u9fa5]{2,6}$/.test(o.label), `名称应为短中文：${o.label}`).toBe(true);
      expect(/[\d]/.test(o.note), `一句结果不应是数值表：${o.note}`).toBe(false);
    }
    // 耐久事件的两项同样满足「短中文名 + 非数值 note」
    for (const o of runDurabilityOptions()) {
      expect(/^[\u4e00-\u9fa5]{2,6}$/.test(o.label), `名称应为短中文：${o.label}`).toBe(true);
      expect(/[\d]/.test(o.note), `一句结果不应是数值表：${o.note}`).toBe(false);
    }
    // 浮层出现时只有浮层入账（底层几何整体退出精确色 → 焦点唯一）
    expect(layersOf(syntheticWalk().at(NODE.choice1, 'CHOICE')).map((l) => l.layer)).toEqual([
      'cardBar',
      'cardBar',
      'cardBar',
    ]);
    expect(layersOf(syntheticWalk().at(NODE.durability, 'DURABILITY')).map((l) => l.layer)).toEqual([
      'cardBar',
      'cardBar',
    ]);
  });
});

/* ================================ G. 两层 Build 闭环（四场真实战斗） */

describe('PRP-RUN-02｜G 两层 Cannon Build：基础 → 一层 → 强化 → 二层条件池 → 终局', () => {
  const ROUTES: readonly [string, string][] = [
    ['heavyShell', 'kineticBurst'],
    ['twinCannon', 'tripleLoad'],
    ['fastReload', 'twinCannon'],
  ];

  /**
   * **冻结实测值**（Node 端确定性真实物理）。
   * 维修分支（三路线全部完成本局），表内 = [战斗①结束, ②结束, ③结束, 终局结束]。
   *
   * ⚠️ 显式实测更新，不是就地重算：任何影响四场连锁的改动（对手 / 武器 / 物理）
   *    都必须回到这里重新测量并写死，从而让「四场能不能跑完」无法悄悄变化。
   * ⚠️ **PRP-RUN-02-R1 已重测**：修复前维修分支跳过第二层（两条老值是 834/618、935/618、
   *    879/590）；修复后维修分支**同样**拿到第二层 → ③④ 两场重建（见下）。
   * ⚠️ **PRP-RUN-02-R2 复测：逐值不变** —— 维修分支不经过 `d4-lateral`、恢复值也未被改动
   *    （Queue 必改 3：「维修量完全不动」）⇒ 这张表就是「维修路线保持现状」的机器证据。
   */
  const FROZEN_REPAIR: Record<string, readonly [number, number, number, number]> = {
    'heavyShell+kineticBurst': [919, 688, 678, 472],
    'twinCannon+tripleLoad': [919, 907, 891, 602],
    'fastReload+twinCannon': [919, 908, 1023, 778],
  };
  /**
   * 改装分支（不回耐久，**并且**多拿一项横向改装）。
   * 表内 = [①结束, ②结束, ③结束, 终局结束]。
   *
   * ⚠️ **PRP-RUN-02-R2 已重测**：改装分支现在多经过 `d4-lateral`（横向改装二选一）
   *    ⇒ ③④ 两场带着**三项**改装重打，三个值全变（旧值 403 / 699 / 831）。
   *    横向改装取「横向池第一项」= 另外两项未拥有一层里的第一个：
   *      重炮路线 → 双联炮 ｜ 双联路线 → 重型弹头 ｜ 快装路线 → 重型弹头。
   * ⚠️ 重炮路线在 R1 时代是「改装 → 归零 FAILED」；R2 补上双联炮之后**活到了终局**（167 = 15%）。
   *    这不是回归，而是本轮引入的新变量（多一项改装）的**真实物理后果**；
   *    「耐久取舍改变结局」的证据因此改由下面两条路线承担（见 RP-F2-11）。
   */
  const FROZEN_UPGRADE: Record<string, readonly [number, number, number, number]> = {
    'heavyShell+kineticBurst': [919, 688, 489, 167],
    'twinCannon+tripleLoad': [919, 907, 907, 0],
    'fastReload+twinCannon': [919, 908, 170, 0],
  };
  /**
   * ⚠️ **PRP-RUN-02-R2 的 E2E 主走查组合**（与 `tests/_e2e_run_page.cjs` 的 11c~11g 段同源）：
   * 一层**双联炮** → 横向**快速装填** → 二层**三连装填**，表内 = [①结束, ②结束, ③结束, 终局结束]。
   * 浏览器段用它做**精确终局**判据（`R58h`：357 = 32%），所以浏览器实测值必须与这张表逐值相等。
   * 与 `FROZEN_UPGRADE` 的差别只在横向那一项（那张表固定取「横向池第一项」= 重型弹头 ⇒ 终局归零）。
   * 附带钉住整局日志行数（`R58c` 的 `logCount`）：横向改装比维修分支多 2 行（节点 beat + 选项行）。
   */
  const FROZEN_UPGRADE_E2E = [919, 907, 839, 357] as const;
  const E2E_WALK_LOG_COUNT = 40;

  it('RP-F2-01 改装分支走完四场真实战斗 + 两次选择 + 一次横向改装 + 一次耐久取舍（全程同一页面）', () => {
    const w = realWalk('upgrade', 'heavyShell', 'kineticBurst', 'twinCannon');
    expect(w.nodeSeq).toEqual([
      NODE.start,
      NODE.battle1,
      NODE.choice1,
      NODE.battle2,
      NODE.durability,
      NODE.lateral,
      NODE.choice2,
      NODE.battle3,
      NODE.final,
    ]);
    expect(w.builds.length).toBe(4);
    expect(w.builds[0]).toEqual([]); // ① 基础
    expect(w.builds[1]).toEqual(['heavyShell']); // ② 一层
    expect(w.builds[2]).toEqual(['heavyShell', 'twinCannon', 'kineticBurst']); // ③ 一层 + 横向 + 二层
    expect(w.builds[3]).toEqual(['heavyShell', 'twinCannon', 'kineticBurst']); // ④ 不变
    // transitions 单调递增（同一页面内推进）
    for (let i = 1; i < w.trail.length; i++) {
      expect(w.trail[i].transitions).toBeGreaterThanOrEqual(w.trail[i - 1].transitions);
    }
    /*
      ⚠️ PRP-RUN-02-R2 重测：R1 时代这条路线在改装分支下终局归零 → FAILED；
      R2 让改装分支多拿一项横向改装（这里补上双联炮）⇒ 它以 167（15%）走到 RUN COMPLETE。
      这是「继续改装 = 构筑数量优势」在真实物理上的直接后果，不是判据放宽。
    */
    const finale = w.at(NODE.final, 'COMPLETE');
    expect(runComplete(finale)).toBe(true);
    expect(runFailed(finale)).toBe(false);
    expect(finale.battle!.playerHp).toBeGreaterThan(0);
    expect(Math.round(finale.battle!.playerHp)).toBe(FROZEN_UPGRADE['heavyShell+kineticBurst'][3]);
  });

  it('RP-F2-02 必改 3：单一耐久贯穿四场（每场开局 = 上一场结束 + 补偿，不自动满血）', () => {
    for (const dur of ['repair', 'upgrade'] as const) {
      for (const [l1, l2] of ROUTES) {
        const w = realWalk(dur, l1, l2);
        const key = `${dur} ${l1}+${l2}`;
        // ① 第一场永远是满耐久开幕（carry = null 是本局唯一合法的满耐久来源）
        expect(w.openingHp[0], key).toBe(1100);
        // ② 场次结束耐久都低于上限且大于 0
        const ends = [
          w.at(NODE.battle1, 'RESULT').battle!.playerHp,
          w.at(NODE.battle2, 'RESULT').battle!.playerHp,
          w.at(NODE.battle3, 'RESULT').battle!.playerHp,
        ];
        for (const hp of ends) {
          expect(hp, key).toBeLessThan(1100);
          expect(hp, key).toBeGreaterThan(0);
        }
        // ③ 每场开局 = 上一场结束 + **该场之前已经发生过的补偿** —— 逐字节相等，不是「取整后相等」：
        //    状态机全程保留真实小数耐久，任何中间取整都会让「同一份耐久」出现两条链。
        //    ⚠️ 索引口径：`openingHp` = [①,②,③,终局] 的**开局**；耐久事件夹在 ② 与 ③ 之间
        //    ⇒ ③ 的开局才是「补偿后」的第一个开局，终局的开局只含 ③ 的自然损耗。
        const want = Math.round(1100 * EMERGENCY_REPAIR_FRACTION);
        const bonus = dur === 'repair' ? Math.max(0, Math.min(want, 1100 - ends[1])) : 0;
        expect(w.openingHp[1], `${key}: ② 开局`).toBe(ends[0]);
        expect(w.openingHp[2], `${key}: ③ 开局`).toBe(Math.min(1100, ends[1] + bonus));
        // ④ 上一场的战斗记录**从未被改写**（补偿单独记账）
        expect(w.at(NODE.choice1, 'CHOICE').battle!.playerHp, `${key}: 战后记录`).toBe(ends[0]);
        expect(w.at(NODE.durability, 'DURABILITY').battle!.playerHp, `${key}: 战后记录`).toBe(ends[1]);
        expect(w.at(NODE.durability, 'DURABILITY').repairBonus, key).toBe(0);
        // ⑤ 终局开局 = ③结束 + （仅维修分支的）补偿，且**被耐久上限截断**
        expect(w.openingHp[3], `${key}: 终局开局`).toBe(Math.min(1100, ends[2] + bonus));
      }
    }
    // ⚠️ 本用例一次性跑 **6 条真实物理路线**（2 分支 × 3 路线 = 24 场真实战斗），
    //    远超 vitest 默认 5s（PRP-RUN-02-R1 之后维修分支多了第二层的两场 → 实测 7.2s）。
    //    这里给显式上限（与 tests/portraitBattleLabA1.test.ts 的重型用例同一口径）。
  }, 60000);

  it('RP-F2-03 必改 4：Build 只在本局 —— 新开 Run 立刻回到基础状态', () => {
    const w = realWalk('upgrade', 'fastReload', 'twinCannon');
    expect(runBuildIds(w.at(NODE.battle2, 'IDLE'))).toEqual(['fastReload']);
    const freshState = createRunPageState(CTX);
    expect(runBuildIds(freshState)).toEqual([]);
    expect(freshState.repairBonus).toBe(0);
    expect(freshState.day).toBe(RUN_FIRST_DAY);
    expect(freshState.battlesCompleted).toBe(0);
    expect(runComplete(freshState)).toBe(false);
    expect(runFailed(freshState)).toBe(false);
    // 新局用基础运行时 → 武器回到正式定义，能力全关
    const rt = new RunBattleRuntime({ encounterId: LADDER[NODE.battle1] });
    expect(rt.build).toEqual([]);
    expect(rt.modifier).toBeNull();
    const p = weaponParamsOf(rt);
    expect(p.cooldownMs).toBe(1000);
    expect(p.projectileRadius).toBe(10);
    expect(rt.abilitySnapshot().kineticBurst).toBe(false);
    rt.dispose();
  });

  it('RP-F2-04 必改 4：每次遭遇都**真的**把本局 Build + 跨战斗耐久 + 本场对手注入运行时', () => {
    const src = stripComments(read('runPage.ts'));
    expect(src.includes('runCarriedPlayerHp')).toBe(true);
    expect(src.includes('runBuildIds')).toBe(true);
    expect(/new RunBattleRuntime\(\{[\s\S]{0,240}build:\s*runBuildIds\(this\.state\)/.test(src)).toBe(true);
    expect(/new RunBattleRuntime\(\{[\s\S]{0,320}carriedHp:\s*runCarriedPlayerHp\(this\.state\)/.test(src)).toBe(true);
    // ⚠️ PRP-RUN-02：对手来自**当前脚本节点**（不是写死的演示遭遇）
    expect(
      /new RunBattleRuntime\(\{[\s\S]{0,400}encounterId:\s*runCurrentNode\(this\.state\)\.encounterId/.test(src),
    ).toBe(true);
    expect(src.includes('this.battle.dispose()')).toBe(true);

    // 运行时层面：第三场真的带两层（不是只写 state / 只画图标）
    const w = realWalk('upgrade', 'twinCannon', 'tripleLoad');
    const third = w.weaponParams[2];
    expect(third.burstRounds).toBe(3); // 二层：双联 → 三连（真实 burst，间隔不变）
    expect(third.burstIntervalMs).toBe(100);
    expect(third.fanAnglesDeg).toBeUndefined();
    // 第二场只带一层（双联：burst 2）
    expect(w.weaponParams[1].burstRounds).toBe(2);
    expect(w.weaponParams[1].projectileMass).toBe(1);
    // 第一场是基础状态
    expect(w.weaponParams[0].projectileRadius).toBe(10);
    expect(w.weaponParams[0].burstRounds).toBeUndefined();
    // ⚠️ 本路线的第二层是 `tripleLoad`（武器类）⇒ 四场**能力全关**。
    //    这一条是「注入」的负面证据：不能把「没生效」误读成「生效了」。
    expect(w.abilityEnd.map((a) => a.kineticBurst)).toEqual([false, false, false, false]);
    expect(w.abilityEnd.every((a) => a.kineticHits === 0)).toBe(true);
    // 换成**能力类**第二层 → 真的从第三场起生效（前两场还没拿到第二层）
    const k = realWalk('upgrade', 'heavyShell', 'kineticBurst');
    expect(k.abilityEnd.map((a) => a.kineticBurst)).toEqual([false, false, true, true]);
    expect(k.abilityEnd[2].kineticHits).toBeGreaterThan(0);
    expect(k.abilityEnd.reduce((n, a) => n + a.kineticHits, 0)).toBeGreaterThan(w.abilityEnd.reduce((n, a) => n + a.kineticHits, 0));
  });

  it('RP-F2-05 必改 4：重型弹头的三项冻结值只在本局 overlay 上生效（正式定义零修改）', () => {
    const w = realWalk('upgrade', 'heavyShell', 'kineticBurst');
    const p = w.weaponParams[1]; // 第二场（一层 = 重型弹头）
    expect(p.projectileRadius).toBe(16);
    expect(p.projectileMass).toBe(4);
    expect(p.recoilImpulse).toBe(90);
    expect(p.cooldownMs).toBe(1000);
    // 第三场（两层）保留一层的数值
    const p3 = w.weaponParams[2];
    expect(p3.projectileRadius).toBe(16);
    expect(p3.projectileMass).toBe(4);
    expect(p3.recoilImpulse).toBe(90);
    // 正式 content 里的 Cannon 基础定义**没有**被改动
    expect(runModifierById('heavyShell')).toBeDefined();
    const rt0 = new RunBattleRuntime({ encounterId: LADDER[NODE.battle1] });
    expect(weaponParamsOf(rt0).projectileRadius).toBe(10);
    expect(weaponParamsOf(rt0).projectileMass).toBe(1);
    rt0.dispose();
  });

  it('RP-F2-06 必改 5：三条路线都能真的跑完（维修分支 **同样两层** · PRP-RUN-02-R1）', () => {
    for (const [l1, l2] of ROUTES) {
      const w = realWalk('repair', l1, l2);
      const key = `${l1}+${l2}`;
      expect(w.builds[0], key).toEqual([]); // 第一场：基础
      expect(w.builds[1], key).toEqual([l1]); // 第二场：第一层
      // ⚠️ PRP-RUN-02-R1：维修分支**不吞掉**第二层 —— ③④ 两场都是完整两层
      expect(w.builds[2], `${key}: ③`).toEqual([l1, l2]);
      expect(w.builds[3], `${key}: 终局`).toEqual([l1, l2]);
      const finale = w.at(NODE.final, 'COMPLETE');
      expect(runComplete(finale), key).toBe(true);
      expect(finale.battle!.winner).toBe('A');
      expect(finale.battle!.steps).toBeGreaterThan(0);
      // 两层在状态里也成立（不只是「注入时不报错」）
      expect(runBuildIds(finale), key).toEqual([l1, l2]);
    }
  });

  it('RP-F2-07 必改 1：第二次候选池由第一层决定（不是同一套通用三选一）', () => {
    for (const l1 of ['heavyShell', 'twinCannon', 'fastReload'] as const) {
      /*
        ① **维修分支**（没有横向改装）→ 呈现的池**逐项等于**声明的条件池。
        这是「第二次池由第一层决定」最纯净的证据：池数据本身零改动（Queue 必改 2）。
      */
      const rep = syntheticWalk('repair', l1, RUN_LAYER2_POOLS[l1][0]).at(NODE.choice2, 'CHOICE');
      const pool = runChoicePool(rep).map((o) => o.id);
      expect(pool).toEqual([...RUN_LAYER2_POOLS[l1]]);
      expect(pool.length).toBe(3);
      expect(new Set(pool).size).toBe(3);
      expect(pool).not.toContain(l1);
      expect(pool).toContain('emergencyRepair');
      if (l1 === 'fastReload') {
        // ⚠️ CLOSEOUT-AND-FREEZE：快速装填的专属二层已整条废弃 → 通用转向池（无 synergy 槽位）
        expect(pool).toEqual(['heavyShell', 'twinCannon', 'emergencyRepair']);
        expect(pool.map((id) => runModifierById(id)!.role)).toEqual(['base', 'base', 'safe']);
      } else {
        expect(runModifierById(pool[0])!.role).toBe('synergy');
        expect(runModifierById(pool[1])!.role).toBe('safe');
        expect(RUN_LAYER1_POOL).toContain(pool[2]);
        expect(pool[2]).not.toBe(l1);
      }
      const l1Pool = RUN_CHOICE_OPTIONS.map((o) => o.id);
      expect(pool.some((id) => !l1Pool.includes(id))).toBe(true);

      /*
        ② **改装分支**（先拿了横向）→ 同一个条件池里**已拥有的项被剔除**（验收 4：无重复 Modifier）。
        ⚠️ 这不是「重写条件池」：声明池仍是 `RUN_LAYER2_POOLS[l1]`，只是呈现前去掉已有的那一项。
      */
      const lateral = RUN_LAYER1_POOL.filter((id) => id !== l1)[0];
      const upL2 = RUN_LAYER2_POOLS[l1].filter((id) => id !== lateral)[0];
      const up = syntheticWalk('upgrade', l1, upL2).at(NODE.choice2, 'CHOICE');
      expect(runBuildIds(up), `${l1}: 横向已拿到`).toEqual([l1, lateral]);
      const upPool = runChoicePool(up).map((o) => o.id);
      expect(upPool, `${l1}: 条件池 − 已拥有`).toEqual([...RUN_LAYER2_POOLS[l1]].filter((id) => id !== lateral));
      expect(upPool).not.toContain(lateral);
      expect(upPool, `${l1}: 去重后仍无重复`).toEqual([...new Set(upPool)]);
      // 「最多只少一项」：声明池是 3 项、横向只可能撞上其中一项
      expect(upPool.length).toBeGreaterThanOrEqual(RUN_LAYER2_POOLS[l1].length - 1);
    }
    expect(RUN_LAYER2_POOLS.heavyShell[0]).toBe('kineticBurst');
    expect(RUN_LAYER2_POOLS.twinCannon[0]).toBe('tripleLoad');
    expect(RUN_LAYER2_POOLS.fastReload).toEqual(['heavyShell', 'twinCannon', 'emergencyRepair']);
    for (const gone of ['suppressionShot', 'strongRecoil', 'recoilCharge']) {
      expect(runModifierById(gone), `${gone} 必须已被删除`).toBeUndefined();
    }
  });

  it('RP-F2-08 选择次数上限由脚本决定：横向只在改装分支出现，任何池都拒收池外 / 已有项', () => {
    const at1 = syntheticWalk('upgrade').at(NODE.choice1, 'CHOICE');
    const chosen1 = chooseRunBuff(at1, 'heavyShell', CTX);
    expect(runBuildIds(chosen1)).toEqual(['heavyShell']);
    expect(chooseRunBuff(chosen1, 'kineticBurst', CTX)).toBe(chosen1); // 非 CHOICE → no-op

    // ① 横向改装节点：只给「另外两项未拥有一层强化」，**不含** emergencyRepair
    const atL = syntheticWalk('upgrade', 'heavyShell', 'kineticBurst').at(NODE.lateral, 'CHOICE');
    expect(runChoicePool(atL).map((o) => o.id)).toEqual(['twinCannon', 'fastReload']);
    expect(chooseRunBuff(atL, 'heavyShell', CTX)).toBe(atL); // 已拥有 → 拒绝（就地防重复）
    expect(chooseRunBuff(atL, 'kineticBurst', CTX)).toBe(atL); // 二层内容 → 不在横向池
    expect(chooseRunBuff(atL, 'emergencyRepair', CTX)).toBe(atL); // 横向池**不提供**紧急维修
    const chosenL = chooseRunBuff(atL, 'twinCannon', CTX);
    expect(runBuildIds(chosenL)).toEqual(['heavyShell', 'twinCannon']);

    // ② 第二层：只能从条件池里选
    const at2 = syntheticWalk('upgrade', 'heavyShell', 'kineticBurst').at(NODE.choice2, 'CHOICE');
    expect(runChoicePool(at2).map((o) => o.id)).toEqual(['kineticBurst', 'emergencyRepair', 'fastReload']);
    expect(chooseRunBuff(at2, 'tripleLoad', CTX)).toBe(at2); // 池外 → 拒绝
    const chosen2 = chooseRunBuff(at2, 'kineticBurst', CTX);
    expect(runBuildIds(chosen2)).toEqual(['heavyShell', 'twinCannon', 'kineticBurst']);

    // ③ 已选满（= 脚本 CHOICE 节点数）→ 即使强行改回 CHOICE 也被拒（防第四项）
    const forced: RunPageState = { ...chosen2, phase: 'CHOICE' };
    expect(chooseRunBuff(forced, 'fastReload', CTX)).toBe(forced);
    expect(forced.buffs.length).toBe(RUN_MAX_CHOICES);

    // ④ 维修分支只经两个 CHOICE 节点 ⇒ 拿到的项数上限只有 2
    //    「维修 = 生存优势 / 继续改装 = 构筑数量优势」在结构上的机器口径就是这 2 vs 3。
    const rep = syntheticWalk('repair', 'heavyShell', 'kineticBurst');
    expect(rep.nodeSeq.filter((id) => id === NODE.lateral).length).toBe(0);
    expect(rep.at(NODE.choice2, 'CHOICE').buffs.length).toBe(1);
    expect(rep.at(NODE.final, 'COMPLETE').buffs.length).toBe(2);
    expect(RUN_MAX_CHOICES).toBe(3);
  });

  it('RP-F2-09 紧急维修：真实耐久补偿，且不改写上一场的战斗记录', () => {
    const at2 = syntheticWalk('upgrade', 'heavyShell', 'emergencyRepair', [900, 700, 0, 0]).at(NODE.choice2, 'CHOICE');
    const hpBefore = at2.battle!.playerHp;
    const maxHp = at2.battle!.playerHpMax;
    const healed = chooseRunBuff(at2, 'emergencyRepair', CTX);
    const expectHeal = Math.round(maxHp * EMERGENCY_REPAIR_FRACTION);
    expect(healed.battle!.playerHp).toBe(hpBefore); // 上一场真实结果原样保留
    expect(healed.repairBonus).toBe(expectHeal);
    expect(runCarriedPlayerHp(healed)).toBe(Math.min(maxHp, hpBefore + expectHeal));
    expect(runCarriedPlayerHp(healed)!).toBeGreaterThan(hpBefore);
    expect(runBuildIds(healed)).toEqual(['heavyShell', 'twinCannon', 'emergencyRepair']);
    // 真实注入：下一场的开局 HP 就是补偿后的数值（IDLE = d6-battle3）
    const rt = new RunBattleRuntime({
      build: runBuildIds(healed),
      carriedHp: runCarriedPlayerHp(healed),
      encounterId: LADDER[NODE.battle3],
    });
    expect(rt.initialPlayerHp).toBe(Math.min(maxHp, hpBefore + expectHeal));
    expect(rt.playerMaxHp).toBe(maxHp);
    rt.dispose();
  });

  it('RP-F2-10 必改 5：真实四场耐久链 = 冻结实测值（维修分支：三路线全部完成本局）', () => {
    for (const [l1, l2] of ROUTES) {
      const key = `${l1}+${l2}`;
      const w = realWalk('repair', l1, l2);
      const hp1 = w.at(NODE.battle1, 'RESULT').battle!.playerHp;
      const hp2 = w.at(NODE.battle2, 'RESULT').battle!.playerHp;
      const hp3 = w.at(NODE.battle3, 'RESULT').battle!.playerHp;
      const hp4 = w.at(NODE.final, 'COMPLETE').battle!.playerHp;
      expect(Math.round(hp1), `${key}: ①`).toBe(FROZEN_REPAIR[key][0]);
      expect(Math.round(hp2), `${key}: ②`).toBe(FROZEN_REPAIR[key][1]);
      expect(Math.round(hp3), `${key}: ③`).toBe(FROZEN_REPAIR[key][2]);
      expect(Math.round(hp4), `${key}: ④`).toBe(FROZEN_REPAIR[key][3]);
      // 维修分支：每场都活着；终局余量必须为正
      //（⚠️ PRP-RUN-02-R1：维修分支现在同样带两层 ⇒ ③④ 的耐久重建，重炮路线实测 472 = 43%，
      //   因此不再用 50% 硬线 —— 改用下面更强的结构性判据。）
      for (const hp of [hp1, hp2, hp3, hp4]) expect(hp, key).toBeGreaterThan(0);
      expect(hp4, `${key}: 终局余量`).toBeGreaterThan(0);
      // ⚠️ 结构性判据：同一路线的**维修分支终局耐久必须高于改装分支**
      //    —— 维修量本身没变（必改 3），这条判据钉住的是「那一次维修真的兑现成耐久」。
      //    ⚠️ PRP-RUN-02-R2 起两条分支的 Build **不再相同**（改装多一项横向），因此这条
      //    比较的是「生存优势 vs 构筑数量优势」的净结果，不再是干净的单一变量 A/B。
      const upg = realWalk('upgrade', l1, l2);
      const upgFinalState = upg.has(NODE.final, 'COMPLETE') ? upg.at(NODE.final, 'COMPLETE') : upg.at(NODE.final, 'FAILED');
      expect(hp4, `${key}: 维修分支终局 > 改装分支终局`).toBeGreaterThan(upgFinalState.battle?.playerHp ?? 0);
      // 四场都真的打完
      expect(w.at(NODE.final, 'COMPLETE').battle!.done).toBe(true);
      expect(w.at(NODE.final, 'COMPLETE').battlesCompleted).toBe(RUN_BATTLES_TOTAL);
      // 维修补偿只来自耐久事件那一次；且**按缺口截断** = min(275, 上限 − 当前)：
      // 「维修」在不同路线上的真实价值不同（这正是「当前耐久状态影响决策」的机制本身）。
      const want = Math.round(1100 * EMERGENCY_REPAIR_FRACTION);
      const applied = Math.max(0, Math.min(want, 1100 - hp2));
      expect(w.at(NODE.durability, 'DURABILITY').repairBonus, key).toBe(0);
      expect(w.at(NODE.tend, 'IDLE').repairBonus, `${key}: 实修`).toBe(applied);
      expect(applied, key).toBeLessThanOrEqual(want);
    }
  });

  it('RP-F2-11 必改 3：耐久取舍真的改变结局（双联路线：维修 → 完成；改装 → 失败）', () => {
    /*
      ⚠️ PRP-RUN-02-R2 换了对照路线：R1 时代用重炮路线演示「维修完成 / 改装失败」，
      但 R2 给改装分支补了一项横向改装之后，重炮路线在改装下也能活到终局（167 = 15%）
      ⇒ 这个对照改由**双联路线**承担（改装分支终局归零，维修分支剩 602 = 55%）。
      **判据强度不变**（仍然是「同一条路线、同一个耐久事件、结局相反」），只是换了一条路线。
    */
    const key = 'twinCannon+tripleLoad';
    const rep = realWalk('repair', 'twinCannon', 'tripleLoad');
    const upg = realWalk('upgrade', 'twinCannon', 'tripleLoad');

    // 两条分支在耐久事件之前**逐帧相同**（差异只来自那一个决定）
    for (const [n, p] of [
      [NODE.battle1, 'RESULT'],
      [NODE.battle1, 'BATTLE'],
      [NODE.choice1, 'CHOICE'],
      [NODE.battle2, 'RESULT'],
      [NODE.durability, 'DURABILITY'],
    ] as const) {
      expect(rep.at(n, p).battle, `${key}: ${n}:${p}`).toEqual(upg.at(n, p).battle);
      expect(rep.at(n, p).log, `${key}: ${n}:${p}`).toEqual(upg.at(n, p).log);
    }

    // 维修：终局活得下来（冻结值口径 = 真实小数四舍五入）
    expect(Math.round(rep.at(NODE.final, 'COMPLETE').battle!.playerHp)).toBe(FROZEN_REPAIR[key][3]);
    // 维修分支的 `d7-final` **开局**耐久 = ③结束 + 实修，且**不超过耐久上限**
    const hp3 = rep.at(NODE.battle3, 'RESULT').battle!.playerHp;
    const heal3 = rep.at(NODE.tend, 'IDLE').repairBonus;
    expect(Math.round(rep.openingHp[3])).toBe(Math.round(Math.min(1100, hp3 + heal3)));
    expect(rep.openingHp[3]).toBeLessThanOrEqual(1100);
    // ⚠️ **PRP-RUN-02-R1 的核心修正**：维修分支**同样**形成两层 Build（不吞掉第二层）
    expect(runBuildIds(rep.at(NODE.final, 'COMPLETE'))).toEqual(['twinCannon', 'tripleLoad']);
    expect(rep.has(NODE.choice2, 'CHOICE')).toBe(true);
    expect(rep.nodeSeq).toContain(NODE.tend); // 先经当日叙事节点
    // ⚠️ **PRP-RUN-02-R2**：维修分支**不经过**横向改装节点（这一天用来修车）
    expect(rep.has(NODE.lateral, 'CHOICE')).toBe(false);

    // 改装：**多拿**一项横向改装，但少了那 275 点耐久 → **终局归零 → RUN FAILED**
    const failed = upg.at(NODE.final, 'FAILED');
    expect(failed.battle!.playerHp).toBe(FROZEN_UPGRADE[key][3]);
    expect(failed.battle!.playerHp).toBe(0);
    expect(runFailed(failed)).toBe(true);
    // ⚠️ 两条分支的 Build **不再相同**：改装分支恰好多出那一项横向改装（这里 = 重型弹头）
    expect(runBuildIds(failed)).toEqual(['twinCannon', 'heavyShell', 'tripleLoad']);
    expect(runBuildIds(failed).length).toBe(runBuildIds(rep.at(NODE.final, 'COMPLETE')).length + 1);
    // 失败终态**不经过 RESULT**：phaseTrail 尾部是 BATTLE → FAILED
    expect(failed.phaseTrail.slice(-2)).toEqual(['BATTLE', 'FAILED']);
    // 失败只追加两行，且没有任何「继续 / 改装机会」引导
    const tail = failed.log.slice(-2).map((e) => e.text);
    expect(tail[0]).toBe(`战车耐久耗尽，DAY ${failed.day} 的冒险到此结束。`);
    expect(tail[1]).toBe('战车耐久剩余 0%。');
    for (const line of tail) {
      expect(line.includes('改装机会')).toBe(false);
      expect(line.includes('继续')).toBe(false);
    }
  });

  it('RP-F2-11b 必改 3 / R2 收口：两条分支各拿一种优势（维修 = 生存 · 继续改装 = 构筑数量）', () => {
    /*
      本 Queue 的全部意义：修正前两条分支的差别只剩耐久 ⇒ 维修**严格支配**继续改装。
      现在三条路线**全部**满足下面的两条结构性判据 ⇒ 取舍是真的：
        ① 继续改装分支恰好**多一项**横向改装，且 Build 里无重复项；
        ② 维修分支终局耐久**严格更高**（维修量本身没被为了平衡而降低 —— Queue 必改 3）。
    */
    for (const [l1, l2] of ROUTES) {
      const key = `${l1}+${l2}`;
      const lateral = RUN_LAYER1_POOL.filter((id) => id !== l1)[0];
      const rep = realWalk('repair', l1, l2);
      const upg = realWalk('upgrade', l1, l2);
      const upFinal = upg.has(NODE.final, 'COMPLETE') ? upg.at(NODE.final, 'COMPLETE') : upg.at(NODE.final, 'FAILED');

      // ① 构筑数量优势：多出来的恰好是那一项横向改装，且不重复
      expect(runBuildIds(rep.at(NODE.final, 'COMPLETE')), `${key}: 维修`).toEqual([l1, l2]);
      expect(runBuildIds(upFinal), `${key}: 改装`).toEqual([l1, lateral, l2]);
      expect(new Set(runBuildIds(upFinal)).size, `${key}: 无重复 Modifier`).toBe(runBuildIds(upFinal).length);
      // 横向那一项来自**既有第一层内容**（不新增 Buff、不是紧急维修）
      expect(RUN_LAYER1_POOL, `${key}: 横向只复用一层内容`).toContain(lateral);

      // ② 生存优势：维修分支终局耐久严格更高
      const repHp = rep.at(NODE.final, 'COMPLETE').battle!.playerHp;
      expect(repHp, `${key}: 维修更耐活`).toBeGreaterThan(upFinal.battle!.playerHp);
    }

    // 重炮路线是唯一「两条分支都活到终局」的路线 → 用它展示净结果
    const keyH = 'heavyShell+kineticBurst';
    const repH = realWalk('repair', 'heavyShell', 'kineticBurst').at(NODE.final, 'COMPLETE').battle!.playerHp;
    const upgH = realWalk('upgrade', 'heavyShell', 'kineticBurst').at(NODE.final, 'COMPLETE').battle!.playerHp;
    expect(Math.round(repH)).toBe(FROZEN_REPAIR[keyH][3]); // 472 = 43%
    expect(Math.round(upgH)).toBe(FROZEN_UPGRADE[keyH][3]); // 167 = 15%
    expect(repH).toBeGreaterThan(upgH);
  });

  it('RP-RUN-02-R1-01 必改 1/3：DAY 4 维修与 DAY 5 第二次三选一是**两个独立节点**（维修不吞第二层）', () => {
    // ① 数据层：两条分支**各自的中间节点** → **同一个** `d5-choice2`
    expect(runDurabilityBranchNodeId('repair')).toBe(NODE.tend);
    // ⚠️ PRP-RUN-02-R2：改装分支先经横向改装节点（`d4-lateral`），再汇入 `d5-choice2`
    expect(runDurabilityBranchNodeId('upgrade')).toBe(NODE.lateral);
    expect(requireRunScriptNode(NODE.tend).next).toBe(NODE.choice2);
    expect(requireRunScriptNode(NODE.lateral).next).toBe(NODE.choice2);
    expect(requireRunScriptNode(NODE.choice2).kind).toBe('CHOICE');
    expect(requireRunScriptNode(NODE.choice2).day).toBe(5);

    // ② 状态机层（合成走查）：两条分支都进入 `d5-choice2`，且**各只进入一次**
    for (const dur of ['repair', 'upgrade'] as const) {
      const w = syntheticWalk(dur, 'heavyShell', 'kineticBurst');
      expect(w.has(NODE.choice2, 'CHOICE'), dur).toBe(true);
      expect(w.nodeSeq.filter((id) => id === NODE.choice2).length, dur).toBe(1);
      expect(w.nodeSeq.filter((id) => id === NODE.durability).length, dur).toBe(1);
      // 两个中间节点**各自只出现在自己那条分支上**，且同样只一次
      expect(w.nodeSeq.filter((id) => id === NODE.tend).length, dur).toBe(dur === 'repair' ? 1 : 0);
      expect(w.nodeSeq.filter((id) => id === NODE.lateral).length, dur).toBe(dur === 'upgrade' ? 1 : 0);
      // 进入 `d5-choice2` 时已拿到的项数：维修 1 项，改装 2 项（第一层 + 横向）
      expect(w.at(NODE.choice1, 'CHOICE').buffs.length, dur).toBe(0);
      expect(w.at(NODE.choice2, 'CHOICE').buffs.length, dur).toBe(dur === 'repair' ? 1 : 2);
      // 两条分支**都**带着「至少两层」进入后半局（③④ 两场）
      expect(w.builds[2].length, `${dur}: ③ 至少两层`).toBeGreaterThanOrEqual(2);
      expect(w.builds[3], `${dur}: 终局`).toEqual(w.builds[2]);
      expect(w.builds[2].slice(0, 1), `${dur}: 第一层保留`).toEqual(['heavyShell']);
      expect(w.builds[2], `${dur}: 第二层真的拿到`).toContain('kineticBurst');
      if (dur === 'repair') {
        expect(w.builds[2], 'repair: 恰好两层').toEqual(['heavyShell', 'kineticBurst']);
      } else {
        // 改装分支多一项横向改装（横向池第一项 = 双联炮），且不重复
        expect(w.builds[2], 'upgrade: 一层 + 横向 + 二层').toEqual(['heavyShell', 'twinCannon', 'kineticBurst']);
        expect(new Set(w.builds[2]).size, 'upgrade: 无重复').toBe(w.builds[2].length);
      }
    }

    // ③ 真实物理层：Queue 必改 3 点名的固定复验路线 = heavyShell → 维修 → kineticBurst
    const w = realWalk('repair', 'heavyShell', 'kineticBurst');
    expect(runComplete(w.at(NODE.final, 'COMPLETE'))).toBe(true);
    expect(runBuildIds(w.at(NODE.final, 'COMPLETE'))).toEqual(['heavyShell', 'kineticBurst']);
    // 维修真的兑现：第三场开局耐久 > 第二场结束耐久（回血没有被清掉）
    expect(w.openingHp[2]).toBeGreaterThan(w.at(NODE.battle2, 'RESULT').battle!.playerHp);
    expect(w.at(NODE.final, 'COMPLETE').battle!.playerHp).toBeGreaterThan(0);
    // 第二层真的进了武器：重炮参数保持第一层冻结值（radius 16 / mass 4）
    expect(w.weaponParams[1].projectileRadius).toBe(16);
    expect(w.weaponParams[2].projectileRadius).toBe(16);
    expect(w.weaponParams[2].projectileMass).toBe(4);
  });

  it('RP-F2-12 改装分支的逐场冻结值（三层 Build：一层 + 横向 + 二层）', () => {
    for (const [l1, l2] of ROUTES) {
      const key = `${l1}+${l2}`;
      const lateral = RUN_LAYER1_POOL.filter((id) => id !== l1)[0];
      const w = realWalk('upgrade', l1, l2);
      expect(Math.round(w.at(NODE.battle1, 'RESULT').battle!.playerHp), `${key}: ①`).toBe(FROZEN_UPGRADE[key][0]);
      expect(Math.round(w.at(NODE.battle2, 'RESULT').battle!.playerHp), `${key}: ②`).toBe(FROZEN_UPGRADE[key][1]);
      expect(Math.round(w.at(NODE.battle3, 'RESULT').battle!.playerHp), `${key}: ③`).toBe(FROZEN_UPGRADE[key][2]);
      // ⚠️ PRP-RUN-02-R2：改装分支的终局 Build 是**三项**（一层 + 横向 + 二层），与冻结表同源
      expect(w.lateralPick, `${key}: 横向选择`).toBe(lateral);
      expect(w.builds[3], `${key}: 终局 Build`).toEqual([l1, lateral, l2]);
      expect(w.at(NODE.lateral, 'CHOICE').buffs.length, `${key}: 横向选择前`).toBe(1);
      expect(w.at(NODE.choice2, 'CHOICE').buffs.length, `${key}: 第二层选择前`).toBe(2);
    }
  });

  it('RP-F2-12b E2E 主走查组合的冻结值（一层双联炮 + 横向快速装填 + 二层三连装填）', () => {
    /*
      这一条存在的唯一理由：`tests/_e2e_run_page.cjs` 的整局走查断言**精确终局耐久**
      （`R58h` = 357 / 32%）与**整局日志行数**（`R58c` = 40），所以这两个数必须有 Node 端
      同口径实测来源，不能只在浏览器里「见过一次就写死」。
    */
    const w = realWalk('upgrade', 'twinCannon', 'tripleLoad', 'fastReload');
    expect(w.lateralPick).toBe('fastReload');
    expect(w.builds[3]).toEqual(['twinCannon', 'fastReload', 'tripleLoad']);
    expect(Math.round(w.at(NODE.battle1, 'RESULT').battle!.playerHp)).toBe(FROZEN_UPGRADE_E2E[0]);
    expect(Math.round(w.at(NODE.battle2, 'RESULT').battle!.playerHp)).toBe(FROZEN_UPGRADE_E2E[1]);
    expect(Math.round(w.at(NODE.battle3, 'RESULT').battle!.playerHp)).toBe(FROZEN_UPGRADE_E2E[2]);
    const fin = w.at(NODE.final, 'COMPLETE');
    expect(runComplete(fin)).toBe(true);
    expect(Math.round(fin.battle!.playerHp)).toBe(FROZEN_UPGRADE_E2E[3]);
    expect(fin.log.length, '整局日志行数（E2E R58c 同源）').toBe(E2E_WALK_LOG_COUNT);
    // 三次 CHOICE（第一层 / 横向 / 第二层）+ 一次耐久取舍 —— E2E R58g 的轨迹与此同源
    expect(fin.phaseTrail.filter((p) => p === 'CHOICE').length, '三次 CHOICE').toBe(3);
    expect(fin.phaseTrail.filter((p) => p === 'DURABILITY').length, '一次耐久取舍').toBe(1);
  });

  it('RP-F2-13 终局由**节点类型**决定（不是「第几场」）：页面与状态机都不含位置分支', () => {
    const src = stripComments(read('runPageState.ts'));
    expect(src.includes("runCurrentNode(s).kind === 'FINAL'")).toBe(true);
    for (const t of ['day === 7', 'day===7', 'battlesCompleted >=', 'RUN_MAX_BATTLES']) {
      expect(src.includes(t), `runPageState 不得再用位置判据 "${t}"`).toBe(false);
    }
    const page = stripComments(read('runPage.ts'));
    for (const t of ['day ===', 'day===', 'if (day']) {
      expect(page.includes(t), `runPage.ts 不得出现 "${t}"`).toBe(false);
    }
    for (const dur of ['repair', 'upgrade'] as const) {
      const w = syntheticWalk(dur);
      expect(w.builds.length).toBe(RUN_BATTLES_TOTAL);
      expect(w.at(NODE.final, 'COMPLETE').battlesCompleted).toBe(RUN_BATTLES_TOTAL);
    }
  });

  it('RP-F2-14 两个终态都只能「重新开始 / 完成本次冒险」→ 全新 Run（满耐久 / DAY 1 / Build 清零）', () => {
    // ① COMPLETE 终态
    const complete = syntheticWalk('repair').at(NODE.final, 'COMPLETE');
    expect(runComplete(complete)).toBe(true);
    expect(runStartsNewRun(complete)).toBe(true);
    expect(runActionLabel(complete)).toBe(RUN_COMPLETE_LABEL);
    expect(runActionEnabled(complete)).toBe(true);
    const tail4 = complete.log.slice(-4).map((e) => e.text);
    expect(tail4[0]).toBe('战斗胜利。');
    expect(tail4[3]).toBe('这次冒险到此结束。');
    expect(complete.log.some((e) => e.text === '你发现了一次改装机会……')).toBe(true); // 历史仍完整

    // ② FAILED 终态
    const failed = settle(atBattle1(), 0, 420, 'B');
    expect(runFailed(failed)).toBe(true);
    expect(runStartsNewRun(failed)).toBe(true);
    expect(runActionLabel(failed)).toBe(RUN_RESTART_LABEL);

    // ③ 两个终态的唯一下一步都是全新 Run
    for (const end of [complete, failed]) {
      const restart = pressRunAction(end, CTX);
      expect(restart).not.toBe(end);
      expect(restart.phase).toBe('IDLE');
      expect(restart.nodeId).toBe(RUN_SCRIPT_FIRST_ID);
      expect(restart.day).toBe(RUN_FIRST_DAY);
      expect(restart.dayTotal).toBe(RUN_DAYS_TOTAL);
      expect(runBuildIds(restart)).toEqual([]);
      expect(restart.repairBonus).toBe(0);
      expect(restart.battlesCompleted).toBe(0);
      expect(restart.battle).toBeNull();
      expect(restart.durability).toBeNull();
      expect(restart.phaseTrail).toEqual(['IDLE']);
      expect(restart.transitions).toBe(0);
      expect(restart.revision).toBe(0);
      expect(restart.actionCount).toBe(0);
      expect(runCarriedPlayerHp(restart)).toBeNull(); // 唯一合法的满耐久来源
      expect(runStartsNewRun(restart)).toBe(false);
      expect(runActionLabel(restart)).toBe('继续');
    }
  });
});

/* ============================ H. Run Script 数据源 + 耐久事件（本 Queue 核心） */

describe('PRP-RUN-02｜H 固定 Run Script 数据源与耐久取舍事件', () => {
  it('RP-RUN-02-01 必改 1：Run Script 是纯数据（无副作用 / 不 import 战斗 · DOM · Canvas）', () => {
    const src = stripComments(read('runScript.ts'));
    for (const t of ['import ', 'Math.random', 'Date.now', 'performance.now', 'registry', 'window', 'document']) {
      expect(src.includes(t), `runScript.ts 不得出现 "${t}"`).toBe(false);
    }
    // 每个节点都有 id / kind / day / beat / next；next 指向的节点真实存在（或 null）
    const ids = new Set(RUN_SCRIPT.map((n) => n.id));
    expect(ids.size).toBe(RUN_SCRIPT.length); // id 唯一
    for (const n of RUN_SCRIPT) {
      expect(n.id.length).toBeGreaterThan(0);
      expect(n.day).toBeGreaterThanOrEqual(1);
      expect(n.day).toBeLessThanOrEqual(RUN_DAYS_TOTAL);
      if (n.next !== null) expect(ids.has(n.next), `${n.id}.next=${n.next} 必须存在`).toBe(true);
      if (n.kind === 'BATTLE' || n.kind === 'FINAL') {
        expect(n.encounterId, `${n.id} 必须有 Encounter`).toBeTruthy();
        expect(n.encounter!.length).toBeGreaterThan(0);
        expect(LAB_ENCOUNTERS.find((e) => e.id === n.encounterId), `${n.encounterId} 必须存在`).toBeDefined();
      } else {
        expect(n.encounterId).toBeUndefined();
      }
    }
    /*
      唯一一条主线：全脚本**只有一个汇合点**，且它恰好有两个前驱。
      ⚠️ PRP-RUN-02-R1 时代这里断言的是「`next` 目标集合互不重复」—— 那条守卫在 R2 之后
      **不再成立也不该成立**（两条分支现在各自经自己的中间节点、都通过 `next` 汇入
      `d5-choice2`）。按项目原则这里**收紧**而不是放宽：直接分析**入度**，
      钉住「只有 `d5-choice2` 的入度 > 1，且它恰好有两个前驱（= 两条分支）」。
    */
    const preds = new Map<string, string[]>();
    for (const n of RUN_SCRIPT) {
      if (!n.next) continue;
      preds.set(n.next, [...(preds.get(n.next) ?? []), n.id]);
    }
    const merged = [...preds.entries()].filter(([, from]) => from.length > 1);
    expect(merged.map(([id]) => id), '全脚本唯一汇合点').toEqual([NODE.choice2]);
    expect(merged[0][1], '汇合点恰好两个前驱 = 两条分支的中间节点').toEqual([NODE.lateral, NODE.tend]);
    // 其余节点一律最多一个前驱（没有别的隐性重汇合）
    for (const [id, from] of preds) {
      if (id === NODE.choice2) continue;
      expect(from.length, `${id} 不应有多个前驱`).toBe(1);
    }
    // 全脚本唯一的分支节点只有耐久事件；它必须**两个分支都存在**且指向不同节点
    const branchNodes = RUN_SCRIPT.filter((n) => n.branch);
    expect(branchNodes.map((n) => n.id)).toEqual([NODE.durability]);
    expect(runDurabilityBranchNodeId('repair')).not.toBe(runDurabilityBranchNodeId('upgrade'));
    // 两条分支**各自经自己的中间节点**，再汇合到同一个 DAY 5 第二次三选一节点
    expect(runDurabilityBranchNodeId('repair')).toBe(NODE.tend);
    expect(runDurabilityBranchNodeId('upgrade')).toBe(NODE.lateral);
    expect(requireRunScriptNode(NODE.tend).next).toBe(NODE.choice2);
    expect(requireRunScriptNode(NODE.lateral).next).toBe(NODE.choice2);
    /*
      ⚠️ PRP-RUN-02-R2：池的**种类**由 CHOICE 节点自己声明（数据驱动，不是按「第几选」数数）
      —— 这样增删节点不会悄悄改变池的语义，状态机里也不会有 `if (day === X)`。
    */
    const choiceNodes = RUN_SCRIPT.filter((n) => n.kind === 'CHOICE');
    expect(choiceNodes.map((n) => [n.id, n.choicePool])).toEqual([
      [NODE.choice1, 'layer1'],
      [NODE.lateral, 'lateral'],
      [NODE.choice2, 'layer2'],
    ]);
    expect(choiceNodes.every((n) => n.choicePool != null), '每个 CHOICE 节点都必须声明池种类').toBe(true);
    // 查询函数：未知 id **不静默回退**
    expect(runScriptNode('nope')).toBeNull();
    expect(() => requireRunScriptNode('nope')).toThrow();
    expect(runScriptNode(NODE.final)!.kind).toBe('FINAL');
  });

  it('RP-RUN-02-02 必改 3：耐久事件是**真取舍**（维修不回改装 / 改装不回耐久）', () => {
    const opts = runDurabilityOptions();
    expect(opts.map((o) => o.id)).toEqual(['repair', 'upgrade']);
    expect(opts.map((o) => o.label)).toEqual(['维修', '继续改装']);
    expect(runDurabilityTitle()).toBe(RUN_DURABILITY_EVENT.title);
    expect(runDurabilityBranchNodeId('repair')).toBe(NODE.tend);
    expect(runDurabilityBranchNodeId('upgrade')).toBe(NODE.lateral);

    // 不增加货币 / 不增加新资源：整条事件只有这两个动作
    // ⚠️ 拉丁关键词**必须带词边界**：裸 `'xp'` 会被 `export` 命中（假红）；
    //    中文关键词可以裸匹配（不会被英文标识符命中）。
    const src = stripComments(read('runScript.ts'));
    for (const t of ['货币', '金币', '银两', '资源', '商店']) {
      expect(src.includes(t), `耐久事件不得引入资源："${t}"`).toBe(false);
    }
    expect(
      /\b(gold|coin|currency|money|score|xp|price|cost|shop|store|inventory|rewards?)\b/i.test(src),
      '耐久事件不得引入货币 / 新资源 / 永久奖励',
    ).toBe(false);

    // 耐久事件时：真实剩余 700（合成喂入）→ 两条分支给出**两个不同的下一场开局**（只差耐久）
    const atDur = syntheticWalk('repair', 'heavyShell', 'kineticBurst', [900, 700, 900, 900]).at(
      NODE.durability,
      'DURABILITY',
    );
    expect(runDurabilityOpen(atDur)).toBe(true);
    expect(runOverlayCards(atDur).map((o) => o.id)).toEqual(['repair', 'upgrade']);
    expect(atDur.log.some((e) => e.text === RUN_DURABILITY_EVENT.repairLog)).toBe(false); // 还没裁决
    expect(atDur.durability).toBeNull();

    // A｜维修：恢复一段明确耐久 → **不获得这一次额外改装**（当日用来修车）
    const want = Math.round(1100 * EMERGENCY_REPAIR_FRACTION);
    const healed = resolveDurability(atDur, 'repair', CTX);
    expect(healed.durability).toBe('repair');
    expect(healed.repairBonus).toBe(want);
    expect(runCarriedPlayerHp(healed)).toBe(700 + want);
    expect(healed.nodeId).toBe(NODE.tend); // 先进入当日叙事节点
    expect(healed.phase).toBe('IDLE');
    expect(healed.log.some((e) => e.text === RUN_DURABILITY_EVENT.repairLog)).toBe(true);
    expect(healed.log.some((e) => e.text.includes(`${want} 点耐久`))).toBe(true);
    expect(runBuildIds(healed)).toEqual(['heavyShell']); // 此刻还没选第二层（不是「永远没有」）

    // ⚠️ PRP-RUN-02-R1（本 Queue 的核心修正）：维修**不阻断**第二层 ——
    //    当日叙事之后按一次「继续」，DAY 5 的条件三选一照样打开
    const healedChoice2 = pressRunAction(healed, CTX);
    expect(healedChoice2.nodeId).toBe(NODE.choice2);
    expect(healedChoice2.phase).toBe('CHOICE');
    expect(healedChoice2.day).toBe(5);
    expect(runChoicePool(healedChoice2).map((o) => o.id)).toEqual(['kineticBurst', 'emergencyRepair', 'fastReload']);
    // 选完第二层 → 两层 Build 一起进入 DAY 6 的下一场（第一层**没有被清除**）
    const repBothLayers = chooseRunBuff(healedChoice2, 'kineticBurst', CTX);
    expect(runBuildIds(repBothLayers)).toEqual(['heavyShell', 'kineticBurst']);
    expect(repBothLayers.nodeId).toBe(NODE.battle3);
    expect(repBothLayers.phase).toBe('IDLE');
    expect(repBothLayers.day).toBe(6);
    expect(repBothLayers.durability).toBe('repair'); // 维修裁决没有被覆盖
    expect(repBothLayers.repairBonus).toBe(want); // 耐久补偿也没有被清掉

    // B｜继续改装：不回耐久 → **先**进入横向改装二选一（DAY 4），**再**进入第二层条件池
    const gamble = resolveDurability(atDur, 'upgrade', CTX);
    expect(gamble.durability).toBe('upgrade');
    expect(gamble.repairBonus).toBe(0);
    expect(runCarriedPlayerHp(gamble)).toBe(700); // 不回血
    expect(gamble.nodeId).toBe(NODE.lateral);
    expect(gamble.phase).toBe('CHOICE');
    expect(gamble.day).toBe(4);
    expect(gamble.log.some((e) => e.text === RUN_DURABILITY_EVENT.upgradeLog)).toBe(true);
    /*
      ⚠️ PRP-RUN-02-R2：横向池 = **另外两项未拥有一层强化**（二选一）——
      不提供 emergencyRepair、不重复展示已拥有的 heavyShell、不新增任何 Buff。
      这一项**不是**第二层内容（`choicePoolLayer === 1`）。
    */
    expect(runChoicePool(gamble).map((o) => o.id)).toEqual(['twinCannon', 'fastReload']);
    expect(runChoicePoolKind(gamble)).toBe('lateral');
    expect(runChoicePoolLayer(gamble)).toBe(1);
    expect(RUN_LAYER1_POOL).toContain('twinCannon');
    expect(RUN_LAYER1_POOL).toContain('fastReload');
    const lateralPicked = chooseRunBuff(gamble, 'twinCannon', CTX);
    expect(runBuildIds(lateralPicked)).toEqual(['heavyShell', 'twinCannon']);
    // 横向选完 → **仍然**进入同一个 DAY 5 第二次条件三选一（必改 2：条件池不受影响）
    expect(lateralPicked.nodeId).toBe(NODE.choice2);
    expect(lateralPicked.phase).toBe('CHOICE');
    expect(lateralPicked.day).toBe(5);
    expect(runChoicePoolKind(lateralPicked)).toBe('layer2');
    expect(runChoicePoolLayer(lateralPicked)).toBe(2);
    // 条件池仍由**最初主路线**（heavyShell）决定 —— 与维修分支拿到的是同一份
    expect(runMainRouteId(lateralPicked)).toBe('heavyShell');
    expect(runChoicePool(lateralPicked).map((o) => o.id)).toEqual(runChoicePool(healedChoice2).map((o) => o.id));
    const upBothLayers = chooseRunBuff(lateralPicked, 'kineticBurst', CTX);
    expect(runBuildIds(upBothLayers)).toEqual(['heavyShell', 'twinCannon', 'kineticBurst']);

    // 两条分支的差别现在有**两个**：耐久（维修多的那 275）与 构筑数量（改装多的那一项）
    expect(runCarriedPlayerHp(healed)!).toBe(runCarriedPlayerHp(gamble)! + want);
    expect(repBothLayers.day).toBe(upBothLayers.day); // 同一个 DAY 6
    expect(repBothLayers.nodeId).toBe(upBothLayers.nodeId); // 同一个下一场
    expect(runBuildIds(repBothLayers)).toEqual(['heavyShell', 'kineticBurst']);
    expect(runBuildIds(upBothLayers).length).toBe(runBuildIds(repBothLayers).length + 1);
    expect(new Set(runBuildIds(upBothLayers)).size).toBe(runBuildIds(upBothLayers).length); // 无重复
  });

  it('RP-RUN-02-R2-01 必改 1/2/4：横向改装 = 另外两项未拥有一层（二选一），复用既有 Choice Overlay', () => {
    // ① 必改 1｜数据层：横向池逐字规则 —— 排除已拥有的一层，永远只给「另外两个」
    for (const l1 of RUN_LAYER1_POOL) {
      const defs = runLateralPoolDefs([l1]);
      expect(defs.map((d) => d.id), l1).toEqual(RUN_LAYER1_POOL.filter((id) => id !== l1));
      expect(defs.length, `${l1}: 恰好二选一`).toBe(2);
      // 只复用既有第一层内容：不新增 Buff、**不提供** emergencyRepair
      expect(defs.map((d) => d.id), l1).not.toContain('emergencyRepair');
      expect(
        defs.every((d) => (RUN_LAYER1_POOL as readonly string[]).includes(d.id)),
        `${l1}: 横向只复用一层内容`,
      ).toBe(true);
      // 已拥有多项时同样不重复（池只会更小，不会出现重复项）
      const second = RUN_LAYER1_POOL.filter((id) => id !== l1)[0];
      expect(runLateralPoolDefs([l1, second]).length, l1).toBe(1);
      expect(runLateralPoolDefs([...RUN_LAYER1_POOL]).length, `${l1}: 三项都拥有 → 空池`).toBe(0);
    }
    // 第一层的选项定义与既有 `RUN_MODIFIERS` 同源（顺序不变）
    expect(runLayer1PoolDefs().map((d) => d.id)).toEqual([...RUN_LAYER1_POOL]);

    // ② 必改 2｜DAY 5 条件池的**声明**未被本轮改写（逐键逐值冻结）
    expect(RUN_LAYER2_POOLS).toEqual({
      heavyShell: ['kineticBurst', 'emergencyRepair', 'fastReload'],
      twinCannon: ['tripleLoad', 'emergencyRepair', 'heavyShell'],
      fastReload: ['heavyShell', 'twinCannon', 'emergencyRepair'],
    });

    /*
      ③ 必改 4｜既有的 Choice Overlay **本来就支持可变卡片数量** ——
      耐久浮层渲染 2 张、M2 种子浮层渲染 3 张、强化池渲染 3 张，全部走同一个 `runChoiceCardRects(count)`。
      ⇒ 横向改装**直接渲染 2 张**：没有塞假第三项、没有新建第二套 Choice UI、没有改布局。
    */
    const lateralCards = runOverlayCards(
      syntheticWalk('upgrade', 'heavyShell', 'kineticBurst').at(NODE.lateral, 'CHOICE'),
    );
    expect(lateralCards.map((o) => o.id)).toEqual(['twinCannon', 'fastReload']);
    expect(lateralCards.length).toBe(2);
    const rects2 = runChoiceCardRects(2);
    expect(rects2.length).toBe(2);
    expect(runRectsOverlap(rects2[0], rects2[1])).toBe(false);
    // 与耐久浮层（同样 2 张）**几何完全同源** → 证明复用而不是另起一套
    const durCards = runOverlayCards(syntheticWalk().at(NODE.durability, 'DURABILITY'));
    expect(durCards.length).toBe(2);
    expect(runChoiceCardRects(durCards.length)).toEqual(rects2);
    // 卡片的强调条 / 图标盒都与绘制同源（浮层的两个入账面照常存在）
    for (const card of rects2) {
      expect(runChoiceBarRect(card).h).toBeGreaterThan(0);
      expect(runChoiceIconRect(card).w).toBeGreaterThan(0);
    }

    // ④ 结构：横向节点**只在改装分支**出现；两条分支仍然都到达 DAY 5 第二次三选一
    expect(syntheticWalk('repair', 'heavyShell', 'kineticBurst').has(NODE.lateral, 'CHOICE')).toBe(false);
    const up = syntheticWalk('upgrade', 'heavyShell', 'kineticBurst');
    expect(up.has(NODE.lateral, 'CHOICE')).toBe(true);
    expect(up.has(NODE.choice2, 'CHOICE')).toBe(true);
    expect(up.lateralPick).toBe('twinCannon'); // 横向池第一项（默认走查口径）
  });

  it('RP-RUN-02-03 耐久事件的 no-op 与重复裁决保护', () => {
    const atDur = syntheticWalk().at(NODE.durability, 'DURABILITY');
    // 非耐久节点（没有 branch）→ no-op
    const fake: RunPageState = { ...atDur, nodeId: NODE.battle1 };
    expect(resolveDurability(fake, 'repair', CTX)).toBe(fake);
    // 裁决后再调一次 → 已经不是 DURABILITY phase → no-op（同引用）
    const done = resolveDurability(atDur, 'upgrade', CTX);
    expect(resolveDurability(done, 'repair', CTX)).toBe(done);
    expect(resolveDurability(done, 'upgrade', CTX)).toBe(done);
    expect(done.durability).toBe('upgrade'); // 第一个决定生效，不会被改写
  });

  it('RP-RUN-02-04 必改 2：四场压力阶梯 —— 全部是既有正式模板的引用（零数值改动）', () => {
    // ① 四个 Encounter 都在 Lab 数据里，且引用的正式模板真实存在、draft **逐字段等于**正式池
    for (const node of runScriptBattleNodes()) {
      const id = node.encounterId!;
      const enc = LAB_ENCOUNTERS.find((e) => e.id === id)!;
      const official = OPPONENT_TEMPLATES.find((t) => t.id === enc.templateId);
      expect(official, `正式对手池必须有 ${enc.templateId}`).toBeDefined();
      expect(enc.count, `${id} 必须是单敌（Run Page 战斗只容纳 1 敌）`).toBe(1);
      expect(enc.draft, `没有修改正式敌人定义`).toEqual(official!.draft);
    }
    // ② 四场互不相同（不是同一台车打四遍）
    const ids = runScriptBattleNodes().map((n) => n.encounterId);
    expect(new Set(ids).size).toBe(ids.length);

    // ③ 基础 Build 的真实掉血阶梯：**单调递增**（低压 → 中低压 → 中压 → 较高压）
    const loss: number[] = [];
    for (const node of runScriptBattleNodes()) {
      const rt = new RunBattleRuntime({ encounterId: node.encounterId });
      const maxHp = rt.playerMaxHp;
      let hp = maxHp;
      for (let i = 0; i < MAX_FRAMES; i++) {
        rt.step(FRAME_MS);
        hp = rt.hp().a;
        if (rt.result) break;
      }
      expect(rt.result, `${node.id} 必须分出胜负`).not.toBeNull();
      expect(rt.result!.winner, `${node.id} 基础 Build 必须打得过`).toBe('A');
      expect(hp, `${node.id} 必须掉血（真实接敌，不是沙包）`).toBeGreaterThan(0);
      loss.push(Math.round(maxHp - hp));
      rt.dispose();
    }
    // 冻结实测值（基础 Build 满耐久 1100 的四场掉血）
    expect(loss).toEqual([181, 221, 257, 482]);
    for (let i = 1; i < loss.length; i++) expect(loss[i], `第 ${i + 1} 场必须比第 ${i} 场更重`).toBeGreaterThan(loss[i - 1]);
    // 终局明显更重（≥ 前一场的 1.5 倍），但不是「基础 Build 必死」
    expect(loss[3]).toBeGreaterThan(loss[2] * 1.5);
    expect(loss[3]).toBeLessThan(1100 * 0.5);
  });

  it('RP-RUN-02-05 宿主接线：浮层卡片唯一来源 + 耐久事件走独立动作', () => {
    const src = stripComments(read('runPage.ts'));
    /**
     * 浮层卡片的**唯一来源**。
     *
     * ⚠️ PRP-M2 起这条守卫从「三处都直读 `runOverlayCards(s)`」**收紧**为
     * 「`runOverlayCards(` 全文件只有一个调用点 + 绘制 / 命中 / 探针都必须经过它」：
     * 种子浮层（「下一局起始改装」三选一）打开时 state 仍是上一局的 `COMPLETE`，
     * 若各处继续各自读 `runOverlayCards(state)` 就会**读到一个空浮层**而实际整页都是浮层。
     * 单一入口 `overlayCardsNow()` 让「画的是池 A、点的是池 B、探针报的是池 C」结构上不可能。
     */
    const overlaySourceCalls = [...src.matchAll(/runOverlayCards\(/g)].length;
    expect(overlaySourceCalls, '`runOverlayCards(` 只允许出现在唯一入口内部').toBe(1);
    const nowCalls = [...src.matchAll(/this\.overlayCardsNow\(\)/g)].length;
    // 三个调用点：onPointerDown（命中）/ drawOverlay（绘制）/ baseProbe（诊断）
    expect(nowCalls, '绘制 / 命中 / 探针都必须经 overlayCardsNow()').toBeGreaterThanOrEqual(3);
    expect(src.includes('private overlayCardsNow(')).toBe(true);
    // 浮层分派：耐久事件走 `resolveDurability`，强化走 `chooseRunBuff`（都传 ctx）
    expect(src.includes('resolveDurability(this.state, id as RunDurabilityChoiceId, ctx)')).toBe(true);
    expect(src.includes('chooseRunBuff(this.state, id, ctx)')).toBe(true);
    expect(src.includes('runDurabilityOpen(this.state)')).toBe(true);
    // 宿主不再直接判断 `runChoiceOpen` 才处理点击（否则耐久浮层点不动）
    expect(src.includes('if (runOverlayOpen(this.state))')).toBe(true);
    // 页面层没有散落的位置分支
    for (const t of ['RUN_INITIAL_DAY', 'RUN_MAX_BATTLES', 'runVerificationComplete']) {
      expect(src.includes(t), `runPage.ts 不得残留旧口径 "${t}"`).toBe(false);
    }
  });
});

/* ============ I. PRP-RUN-R1：「HP <= 0 = 本局立即失败」与耐久连续性 */

describe('PRP-RUN-R1｜I 死亡即终局：单一耐久贯穿 Run、失败后只能重开', () => {
  it('RP-R1-01 任意一场 Player HP = 0 → 立即 FAILED（不经过 RESULT、DAY 不推进）', () => {
    // 先在第一次选择里拿一层，确保失败时**本局 Build 非空**（Build 必须原样保留给人看）
    let s = settle(atBattle1(), 700);
    expect(s.phase).toBe('RESULT');
    s = pressRunAction(s, CTX); // CHOICE（d2-choice1，仍在 DAY 2）
    s = chooseRunBuff(s, 'heavyShell', CTX); // → IDLE（d3-battle2，DAY 3）
    expect(s.day).toBe(3);
    const dayBeforeDeath = s.day;

    s = pressTimes(s, 2); // EVENT → BATTLE②
    expect(s.phase).toBe('BATTLE');
    const logBeforeDeath = s.log;
    s = settle(s, 0, 420, 'B');

    // ① 直接进失败终态（**没有** RESULT 这一站）
    expect(s.phase).toBe('FAILED');
    expect(runFailed(s)).toBe(true);
    expect(s.phaseTrail[s.phaseTrail.length - 1]).toBe('FAILED');
    expect(s.phaseTrail.slice(-2)).toEqual(['BATTLE', 'FAILED']);
    // ② DAY 不推进（失败不发生 DAY 前进）
    expect(s.day).toBe(dayBeforeDeath);
    // ③ 最终 Build 原样保留（失败页要展示它）
    expect(runBuildIds(s)).toEqual(['heavyShell']);
    // ④ 战斗记录如实保留（真实 HP 0，没有被改写成满耐久）
    expect(s.battle!.playerHp).toBe(0);
    expect(s.battle!.done).toBe(true);
    expect(s.battle!.endReason).toBe('hp');
    // ⑤ 失败只追加**两行**，且这两行里没有任何「继续 / 改装机会」引导
    expect(s.log.length).toBe(logBeforeDeath.length + 2);
    const tail = s.log.slice(-2).map((e) => e.text);
    expect(tail[0]).toBe(`战车耐久耗尽，DAY ${dayBeforeDeath} 的冒险到此结束。`);
    expect(tail[1]).toBe('战车耐久剩余 0%。');
    for (const line of tail) {
      expect(line.includes('改装机会')).toBe(false);
      expect(line.includes('继续')).toBe(false);
    }
    // 第一次那行「改装机会」仍在历史里（日志只追加、不清空）
    expect(logBeforeDeath.some((e) => e.text === '你发现了一次改装机会……')).toBe(true);
    for (const e of s.log) expect(/^\[/.test(e.text)).toBe(false);
  });

  it('RP-R1-02 FAILED 下结构上进不了任何浮层：不接受选卡 / 不接受裁决 / 主动作=重新开始', () => {
    let s = settle(atBattle1(), 0, 900, 'B');
    expect(s.phase).toBe('FAILED');

    expect(runChoiceOpen(s)).toBe(false);
    expect(runDurabilityOpen(s)).toBe(false);
    expect(runOverlayOpen(s)).toBe(false);
    expect(runOverlayCards(s)).toEqual([]);
    expect(runActionEnabled(s)).toBe(true);
    expect(runActionLabel(s)).toBe(RUN_RESTART_LABEL);
    expect(runStartsNewRun(s)).toBe(true);
    // 直接调选择 / 裁决都不能改变任何东西
    expect(chooseRunBuff(s, 'kineticBurst', CTX)).toBe(s);
    expect(chooseRunBuff(s, 'heavyShell', CTX)).toBe(s);
    expect(resolveDurability(s, 'repair', CTX)).toBe(s);
    expect(runBuildIds(s)).toEqual([]);
    expect(s.day).toBe(2);
    expect(s.nodeId).toBe(NODE.battle1);
    expect(s.phase).toBe('FAILED');

    // ⚠️ 关键回归：`runCarriedPlayerHp` 不把死亡伪装成「满耐久开幕」
    expect(runCarriedPlayerHp(s)).toBe(0);
    expect(runCarriedPlayerHp(s)).not.toBeNull();
  });

  it('RP-R1-03 失败后「重新开始冒险」= 全新 Run（满耐久 / DAY 1 / Build 与补偿清空）', () => {
    let s = settle(atBattle1(), 600);
    s = pressRunAction(s, CTX);
    s = chooseRunBuff(s, 'twinCannon', CTX);
    s = pressTimes(s, 2);
    s = settle(s, 0, 300, 'B');
    expect(s.phase).toBe('FAILED');
    expect(runBuildIds(s)).toEqual(['twinCannon']);

    const restart = pressRunAction(s, CTX);
    expect(restart).not.toBe(s);
    expect(restart.phase).toBe('IDLE');
    expect(restart.day).toBe(RUN_FIRST_DAY);
    expect(restart.dayTotal).toBe(RUN_DAYS_TOTAL);
    expect(restart.buffs).toEqual([]);
    expect(runBuildIds(restart)).toEqual([]);
    expect(restart.repairBonus).toBe(0);
    expect(restart.battlesCompleted).toBe(0);
    expect(restart.battle).toBeNull();
    expect(runFailed(restart)).toBe(false);
    expect(runStartsNewRun(restart)).toBe(false);
    expect(runActionLabel(restart)).toBe('继续');
    expect(runCarriedPlayerHp(restart)).toBeNull();
    expect(restart.phaseTrail).toEqual(['IDLE']);
    expect(restart.log.length).toBe(1 + requireRunScriptNode(NODE.start).beat.length);

    // ⚠️ 两种「按主动作」必须可区分：终态的这几下**开新 Run**；
    //    RESULT（未打完）的那一下**继续当前 Run**。
    let mid = pressTimes(restart, 3); // → BATTLE①
    mid = settle(mid, 800);
    expect(mid.phase).toBe('RESULT');
    expect(runStartsNewRun(mid)).toBe(false);
    expect(runActionLabel(mid)).toBe('继续');
    const carried = pressRunAction(mid, CTX);
    expect(carried.phase).toBe('CHOICE'); // 继续**当前** Run
    expect(carried.day).toBe(mid.day);
    expect(runBuildIds(carried)).toEqual([]);
  });

  it('RP-R1-04 真实物理确实能打出 HP = 0（死亡不是假设输入；状态机对真实战果生效）', () => {
    // 夹具用**既有 Lab encounter** `RangedTurret`（OPP-03，停驻重炮）——它在同一玩家装载下
    // 第一场就打死玩家。这里只用它来**客观产生**一次真实死亡，不参与 PRP 的四场阶梯。
    const plan = buildSpawnPlan(LAB_LOADOUTS[0].id, 'RangedTurret');
    const rt = new PlanckBattleOrchestrator(plan.player.snapshot, plan.enemies[0].snapshot, registry, {}, false);
    let frames = 0;
    while (rt.result === null && frames < MAX_FRAMES) {
      rt.step(FRAME_MS, 1);
      frames += 1;
    }
    const result = rt.result;
    expect(result, '夹具必须真的分出胜负').not.toBeNull();
    expect(rt.vehicleA.hp).toBe(0);
    expect(result!.winner).toBe('B');
    expect(result!.endReason).toBe('hp');
    const enemyHp = rt.vehicleB.hp;
    rt.dispose();

    // 把**真实战果**喂给状态机 → 必须进 FAILED
    const s = settle(atBattle1(), 0, enemyHp, 'B');
    expect(s.phase).toBe('FAILED');
    expect(s.battle!.playerHp).toBe(0);
    expect(s.battlesCompleted).toBe(1); // 这一场确实打完了（战败也计入）
    expect(runCarriedPlayerHp(s)).toBe(0);
    expect(runStartsNewRun(s)).toBe(true);
  });

  it('RP-R1-05 未死的战败（phase 结束）不误判为失败：判据是真实 HP，不是 winner', () => {
    // 构造「玩家落败但仍有耐久」的官方结果形态（endReason = 'phase'，HP > 0）
    const s = finishRunBattle(atBattle1(), {
      winner: 'B',
      endReason: 'phase',
      playerHp: 350,
      enemyHp: 800,
      steps: 900,
    });
    expect(s.phase).toBe('RESULT'); // 不是 FAILED
    expect(runFailed(s)).toBe(false);
    expect(runStartsNewRun(s)).toBe(false);
    expect(runCarriedPlayerHp(s)).toBe(350); // 血还在 → 可继续，且带着这 350 继续
    const next = pressRunAction(s, CTX);
    expect(next.phase).toBe('CHOICE');
    expect(runCarriedPlayerHp(next)).toBe(350);
  });

  it('RP-R1-06 跨战斗耐久在「下一场建立之后」仍以战斗记录为权威（口径陷阱回归）', () => {
    // 「上一场已结束、本场未建立」窗口：carry = 上一场真实剩余
    const res = settle(atBattle1(), 640);
    expect(runCarriedPlayerHp(res)).toBe(640);
    const choice = pressRunAction(res, CTX); // RESULT → d2-choice1（浮层打开，耐久仍可读）
    expect(choice.phase).toBe('CHOICE');
    expect(runCarriedPlayerHp(choice)).toBe(640);
    // 裁决第一层强化 → 落到 d3-battle2 的 IDLE（**本场尚未建立** ⇒ 仍在可读窗口内）
    const at2 = chooseRunBuff(choice, 'heavyShell', CTX);
    expect(at2.nodeId).toBe(NODE.battle2);
    expect(at2.phase).toBe('IDLE');
    expect(runCarriedPlayerHp(at2)).toBe(640);
    // 战斗节点是**两段式**：IDLE →(按一次) EVENT（carry 仍可读）→(再按) BATTLE（carry 关闭）
    const ev2 = pressRunAction(at2, CTX);
    expect(ev2.phase).toBe('EVENT');
    expect(runCarriedPlayerHp(ev2)).toBe(640);
    const bt2 = pressRunAction(ev2, CTX);
    expect(bt2.phase).toBe('BATTLE');
    // ⚠️ 进入 BATTLE 后 `s.battle` 已被本场战斗替换 → carry 不再可读（返回 null）；
    //    本场开局耐久的**权威来源**是战斗记录 `playerHp`（状态机在 EVENT → BATTLE 时写入同一个数）。
    expect(runCarriedPlayerHp(bt2)).toBeNull();
    expect(bt2.battle!.playerHp).toBe(640);
    // 真实运行时按宿主同口径注入 → 开局耐久确实是 640（不是满耐久）
    const rt = new RunBattleRuntime({
      build: runBuildIds(bt2),
      carriedHp: bt2.battle!.playerHp,
      encounterId: runCurrentNode(bt2).encounterId,
    });
    expect(rt.initialPlayerHp).toBe(640);
    expect(rt.playerMaxHp).toBe(1100);
    rt.dispose();
  });
});
