/**
 * PRODUCT-LOOP-R9-THREE-STAGE-BUILD-PACING｜**三段节奏 + 两次 Build 真的作用到后面战斗**的机器取证。
 *
 * ── 本 Queue 要回答的两个问题 ────────────────────────────────────────────────
 *
 *   ① **节奏**：单局是不是「遭遇 1 → Build Choice → 遭遇 2 → Build Choice → 遭遇 3 → COMPLETE / FAILED」，
 *      两段之间**只有**一次 Build Choice（必改 1）；
 *   ② **作用**：这两次 Build 是不是**真的**留在后续战斗里起作用（必改 2），
 *      而且**存在**一条正式可选 Build + 当前正式 Weapon 能走完三段（必改 4）。
 *
 * ── 与相邻文件的分工 ────────────────────────────────────────────────────────
 *
 *   | 文件 | 回答什么 |
 *   |---|---|
 *   | `portraitRunPage.test.ts` | 页面 / 状态机 / 面积账本 / 两层 Build 闭环 + Cannon 冻结台账（**结构**） |
 *   | `productRunEncounterSequenceQ3.test.ts` | 三段**对手序列**本身（顺序 / 清场 / 不串场 / 任意段死亡 / 单件矩阵） |
 *   | `productRunBuildEncounterImpactR8.test.ts` | 「加一个 Build 之后结果有没有变」的**单场隔离**矩阵 |
 *   | **本文件** | **三段节奏的邻近性 + Build 逐段累积 + 正式成功路径 + 不退化 / 仍可失败** |
 *
 * ── 取证协议（与 R8 / Q3 逐字同口径）────────────────────────────────────────
 *
 *   | 维度 | 取值 |
 *   |---|---|
 *   | 状态机 | 真实 `runPageState`（`createRunPageState` → `pressRunAction` / `finishRunBattle` / `chooseRunBuff`） |
 *   | 战斗 | 真实 `RunBattleRuntime`（真物理、真时间步） |
 *   | 本局 Build | `runBuildIds(state)`（= 宿主 `runPage.beginBattle()` 传的**同一份**） |
 *   | 跨段耐久 | `runCarriedPlayerHp(state)`（与宿主同一口径） |
 *   | 玩家基线 | `playerBaseline: true`（与宿主同口径） |
 *   | 时间步 | `1000/60` ms（= `FIXED_STEP_MS`） |
 *   | 终止上限 | `MAX_FRAMES = 4000`（只防死循环，不参与断言） |
 *
 * ── 不修改任何数值（本 Queue 的第一条红线）──────────────────────────────────
 *
 *   本文件**不**自动调参 / **不**新增 Build 内容 / **不**改 Enemy / **不**改 Weapon 基础数值 /
 *   **不**把失败改成通过 / **不**硬塞指定选项。表里的数是「这一次真实物理跑出来的」。
 *
 * ── 本文件的三个结论（逐条有机器取证）──────────────────────────────────────
 *
 *   1. **邻近性成立**（`R9-01`）：脚本节点序列 = `EVENT · BATTLE · CHOICE · BATTLE · CHOICE · FINAL`，
 *      相邻两段之间**恰好一个**节点，那个节点就是 Build Choice —— 没有任何中间节拍。
 *   2. **Build 逐段累积且真的进武器**（`R9-02` / `R9-04`）：三场的 `build` 依次是
 *      `[] → [第 1 次] → [第 1 次, 第 2 次]`；逐发伤害从 20（canonical）变成 25（`round(20 × 1.25)`）；
 *      同一装配的 E2 / E3 在**单场隔离**下结果随累积 Build 单调变化
 *      （E3：零 Build `LOSS`（敌剩 119.7）→ 一层 `WIN`（我剩 160）→ 两层 `WIN`（我剩 360））。
 *   3. **存在正式成功路径**（`R9-03`）：`machineGun` 为主武器（`WEAPON_SLOT` 里那一件，
 *      装配顺序第一件 ⇒ 本局基准武器）+ 共 3 件 `machineGun` 的正式装配，
 *      Build 走官方通用池 `damageUp` / `rateUp` ⇒ 三段全胜 `COMPLETE`（两条相反顺序都成立）。
 *      ⚠️ 这**不是**「把 machineGun 设成默认答案」——`R9-03` 同时跑了三条不同的选项路径，
 *         并且 `R9-05` 取证「不在池里的项点了也不生效」（不存在硬塞 / 自动选择）。
 *
 * ── ⚠️ 如实披露：产品今天「一键可达」的装配仍走不完三段（本 Queue 未改，禁改）────────
 *
 *   局外 Garage 目前**只打通一个功能槽**（`playerLoadout.WEAPON_SLOT` = `frontMass`，
 *   见 `slotReadings()` 的 `editable`），其余功能槽保持初始值（`front` 空 / `top` = `hammer`）。
 *   `R9-06` 把这一形态 × 7 件正式武器逐件跑了一遍：**无一 COMPLETE**。
 *   ⇒ 这是**既有的内容 / 平衡缺口**（与 `productRunEncounterSequenceQ3.test.ts` 的 Q3-07、
 *     `portraitRunPage.test.ts` 的 RP-RUN-02-04 同一件事），**不是** R9 引入的；
 *     而 R9 的禁止清单明令「不调 Enemy / 不调 Weapon 数值」⇒ 本文件只**如实记录**，不去掩盖。
 *   ⚠️ 因此 `R9-03` 的成功路径用的是**多槽正式装配**（3 件 `machineGun`，能量 30×3 + 标准轮组 20
 *     = **110 = 车身容量**，`validateSnapshot` 合法、`canStartFullRun` 为真），
 *     而不是单槽形态 —— 单槽形态的边界在上表里逐件写明。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { registry } from '../src/core/content';
import { EMPTY_SLOT, type BuildDraft } from '../src/lab/buildEditorModel';
import { RunBattleRuntime } from '../src/lab/portraitBattleLab/runBattleRuntime';
import { runLoadoutCompatOfDraft } from '../src/lab/portraitBattleLab/runLoadoutCompat';
import {
  RUN_BASE_WEAPON_DEF_ID,
  RUN_GENERIC_CHOICE_POOL,
  RUN_GENERIC_GROWTH_IDS,
  RUN_LAYER1_POOL,
  RUN_LAYER2_POOLS,
  weaponCadenceGrowth,
  weaponDamageParamKey,
  weaponOverlayMods,
  type RunBuildId,
} from '../src/lab/portraitBattleLab/runModifiers';
import {
  chooseRunBuff,
  createRunPageState,
  finishRunBattle,
  pressRunAction,
  runBuildIds,
  runCarriedPlayerHp,
  runChoicePool,
  runChoicePoolFamily,
  runChoicePoolKind,
  runChoicePoolLayer,
  runComplete,
  runCurrentNode,
  runFailed,
  type RunPageState,
  type RunPhase,
} from '../src/lab/portraitBattleLab/runPageState';
import { runPageContext } from '../src/lab/portraitBattleLab/runPageScene';
import {
  RUN_SCRIPT,
  RUN_TOTAL_BATTLES,
  RUN_TOTAL_CHOICES,
  RUN_TOTAL_DAYS,
  runScriptBattleNodes,
  runScriptKindSequence,
  runScriptNode,
} from '../src/lab/portraitBattleLab/runScript';
import { defaultPlayerDraft, WEAPON_SLOT } from '../src/product/playerLoadout';
import {
  FULL_RUN_SUPPORTED_WEAPON_IDS,
  canStartFullRun,
  supportsFullRun,
} from '../src/product/runCompatibility';

/* --------------------------------------------------------------- 取证常量 */

const FRAME_MS = 1000 / 60;
const MAX_FRAMES = 4000;
const PRODUCT_TAG = 'profile-equipped';
/** 物理用例的显式超时（vitest 默认 5s 对 14 条真实走查不够）。 */
const SLOW_MS = 300_000;

/** 六节点链的 id（断言里只引这一份，避免散落字面量）。 */
const NODE = {
  start: 'd1-start',
  battle1: 'd2-battle1',
  choice1: 'd2-choice1',
  battle2: 'd3-battle2',
  choice2: 'd3-choice2',
  final: 'd4-final',
} as const;

/** 三段问题序列的对手（顺序 = 脚本顺序）。 */
const SEQ = ['ProtoRusher', 'Chaser', 'RangedTurret'] as const;

/** R9 已从产品节奏退役的四个节点（**机制保留**，见 `runScript.ts` 文件头）。 */
const RETIRED_NODES = ['d4-durability', 'd4-lateral', 'd5-tend', 'd6-travel'] as const;

const LAB_DIR = join(__dirname, '..', 'src', 'lab', 'portraitBattleLab');

function readLab(file: string): string {
  return readFileSync(join(LAB_DIR, file), 'utf8');
}

/** 剥注释后再做源码匹配（守卫必须扛得住「注释里写了同一个词」的自指陷阱）。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/* ------------------------------------------------------------------ 夹具 */

/**
 * 以**产品新账号默认车**为底盘、四个功能槽全部显式给出（缺省 = 空）。
 * ⚠️ 底盘（`watermelonBody` + 标准轮组）与 `portraitRunPage.test.ts` / Q3 的走查夹具一致。
 */
function draftOf(sel: Record<string, string>): BuildDraft {
  return {
    ...defaultPlayerDraft(),
    functionalSelections: {
      front: EMPTY_SLOT,
      frontMass: EMPTY_SLOT,
      top: EMPTY_SLOT,
      rear: EMPTY_SLOT,
      ...sel,
    },
  };
}

/**
 * **`machineGun` 主武器装配**（`R9-03` / `R9-04` 的成功路径夹具）。
 *
 *   `frontMass`（= `WEAPON_SLOT`，装配顺序第一件武器 ⇒ 本局基准武器）放 `machineGun`，
 *   另外两个功能槽也放 `machineGun`。
 *   能量 = `machineGun` 30×3 + 标准轮组 20 = **110 = 车身容量**（恰好合上限）。
 */
function mgPrimary(): BuildDraft {
  return draftOf({ frontMass: 'machineGun', top: 'machineGun', rear: 'machineGun' });
}

/**
 * **产品今天「一键可达」的装配形态**：只有 `frontMass` 可编辑，其余功能槽保持初始值
 * （`slotReadings()` 的 `editable` 只对 `WEAPON_SLOT` 为真 ⇒ 这就是玩家现在能装出来的形状）。
 */
function reachableWith(weaponDefId: string): BuildDraft {
  return draftOf({ frontMass: weaponDefId, top: 'hammer' });
}

/** **单件归因夹具**：只留 `frontMass` 那一件（其余功能槽全空）。 */
function weaponOnly(weaponDefId: string): BuildDraft {
  return draftOf({ frontMass: weaponDefId });
}

/** 与 `portraitRunPage.test.ts` 的 `WALK_DRAFT` **同形**（cannon 在 `front` 槽）。 */
function cannonWalkDraft(): BuildDraft {
  return draftOf({ front: 'cannon', top: 'machineGun', rear: 'machineGun' });
}

/** 每件武器走**自己那一套官方池**（cannon ⇒ Cannon 三池；其余 ⇒ 通用成长池）。 */
function picksFor(weaponDefId: string, layer1: string, layer2: string): readonly [string, string] {
  return weaponDefId === RUN_BASE_WEAPON_DEF_ID ? [layer1, layer2] : ['damageUp', 'rateUp'];
}

/* -------------------------------------------------------- 走查（真实物理） */

interface SegFact {
  readonly nodeId: string;
  readonly encounterId: string;
  /** 本段开局时本局**累积**的 Build（宿主 `beginBattle` 传的就是这一份）。 */
  readonly build: readonly RunBuildId[];
  readonly hpA0: number;
  readonly hpA: number;
  readonly hpB: number;
  readonly hpBMax: number;
  readonly steps: number;
  readonly winner: 'A' | 'B' | null;
  readonly hits: number;
  readonly damage: number;
  /** 逐发真实伤害的去重升序（同一件武器 ⇒ 只可能有一个值）。 */
  readonly perHit: readonly number[];
}

interface PickFact {
  readonly nodeId: string;
  readonly kind: string | null;
  readonly layer: number;
  /** 该节点**当下真实画出来的**候选池（页面画什么就选什么）。 */
  readonly pool: readonly string[];
  readonly pick: string;
  /** `pick` 是否真的在池里（不在 ⇒ `chooseRunBuff` 是 no-op）。 */
  readonly accepted: boolean;
}

interface WalkFact {
  readonly phase: RunPhase;
  readonly complete: boolean;
  readonly failed: boolean;
  readonly nodeSeq: readonly string[];
  /** 三场战斗各自开局时的累积 Build。 */
  readonly buildSeq: readonly (readonly RunBuildId[])[];
  readonly picks: readonly PickFact[];
  readonly segs: readonly SegFact[];
  readonly battlesCompleted: number;
  readonly logTail: readonly string[];
}

const CHAIN_CACHE = new Map<string, WalkFact>();

function draftKeyOf(draft: BuildDraft): string {
  const f = draft.functionalSelections;
  return [f.front, f.frontMass, f.top, f.rear].join('|');
}

/**
 * 走完**真实**单局（真实脚本 + 真实状态机 + 真实物理），与 `runPage.beginBattle()` 同口径。
 *
 * `picks` = 依次在第 1 / 第 2 个 CHOICE 节点上点的项（**必须来自当时的候选池**，
 * 否则 `chooseRunBuff` 是 no-op —— 本文件用这一点取证「不硬塞指定选项」）。
 */
function walkRun(draft: BuildDraft, picks: readonly string[]): WalkFact {
  const key = `${draftKeyOf(draft)}#${picks.join('+')}`;
  const hit = CHAIN_CACHE.get(key);
  if (hit) return hit;

  const ctx = runPageContext({
    source: 'profile',
    label: `R9/${key}`,
    draft,
    tag: PRODUCT_TAG,
    key,
  });

  const nodeSeq: string[] = [];
  const buildSeq: (readonly RunBuildId[])[] = [];
  const pickFacts: PickFact[] = [];
  const segs: SegFact[] = [];
  let s: RunPageState = createRunPageState(ctx);
  let carry: number | null = null;

  for (let guard = 0; guard < 40; guard++) {
    if (s.phase === 'COMPLETE' || s.phase === 'FAILED') break;
    const before = s;
    if (nodeSeq[nodeSeq.length - 1] !== s.nodeId) nodeSeq.push(s.nodeId);

    if (s.phase === 'BATTLE') {
      const node = runCurrentNode(s);
      const build = [...runBuildIds(s)];
      buildSeq.push(build);
      const rt = new RunBattleRuntime({
        build,
        carriedHp: carry,
        encounterId: node.encounterId,
        playerDraft: draft,
        playerLoadoutTag: PRODUCT_TAG,
        // 与宿主 `runPage.beginBattle()` 同口径（那边恒传 true）。
        playerBaseline: true,
      });
      try {
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

  const fact: WalkFact = {
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
  CHAIN_CACHE.set(key, fact);
  return fact;
}

function lastSeg(w: WalkFact): SegFact {
  return w.segs[w.segs.length - 1];
}

function segAt(w: WalkFact, nodeId: string): SegFact {
  const seg = w.segs.find((x) => x.nodeId === nodeId);
  if (!seg) throw new Error(`走查里没有 ${nodeId} 这一段的战斗记录`);
  return seg;
}

/* --------------------------------------------- 单场隔离（Build 的因果对照） */

interface SoloFact {
  readonly winner: 'A' | 'B' | null;
  readonly hpA: number;
  readonly hpB: number;
  readonly steps: number;
  readonly hits: number;
  readonly damage: number;
  readonly perHit: readonly number[];
}

const SOLO_CACHE = new Map<string, SoloFact>();

/** 满耐久打**一场**（隔离跨段累积），唯一变量 = `build`。 */
function solo(draft: BuildDraft, build: readonly RunBuildId[], encounterId: string): SoloFact {
  const key = `${draftKeyOf(draft)}|${build.join('+')}|${encounterId}`;
  const hit = SOLO_CACHE.get(key);
  if (hit) return hit;
  const rt = new RunBattleRuntime({
    build,
    carriedHp: null,
    encounterId,
    playerDraft: draft,
    playerLoadoutTag: PRODUCT_TAG,
    playerBaseline: true,
  });
  try {
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
    const fact: SoloFact = {
      winner: rt.result?.winner ?? null,
      hpA: hp.a,
      hpB: hp.b,
      steps,
      hits,
      damage,
      perHit: [...new Set(perHit)].sort((a, b) => a - b),
    };
    SOLO_CACHE.set(key, fact);
    return fact;
  } finally {
    rt.dispose();
  }
}

/* ------------------------------------------- 状态机读数（只为读池，不跑物理） */

const STATE_AT_CHOICE = new Map<string, RunPageState>();

/** 推进到**第 1 个** CHOICE 节点的状态（战斗按「胜」记账，不构造运行时）。 */
function stateAtChoice1(draft: BuildDraft): RunPageState {
  const key = draftKeyOf(draft);
  const hit = STATE_AT_CHOICE.get(key);
  if (hit) return hit;

  const ctx = runPageContext({
    source: 'profile',
    label: `R9/state/${key}`,
    draft,
    tag: PRODUCT_TAG,
    key,
  });
  let s: RunPageState = createRunPageState(ctx);
  for (let guard = 0; guard < 20; guard++) {
    if (s.phase === 'CHOICE' || s.phase === 'COMPLETE' || s.phase === 'FAILED') break;
    const before = s;
    if (s.phase === 'BATTLE') {
      s = finishRunBattle(s, {
        winner: 'A',
        endReason: 'hp',
        playerHp: 1000,
        enemyHp: 0,
        steps: 1,
      });
      continue;
    }
    s = pressRunAction(s, ctx);
    if (s === before) break;
  }
  STATE_AT_CHOICE.set(key, s);
  return s;
}

/* ------------------------------------------------------------------ 小工具 */

/** 一位小数（浮点耐久比较）。 */
function r1(x: number): number {
  return Math.round(x * 10) / 10;
}

/** 一段的冻结行：`[encounter, hpA, hpB, steps, hits, winner, build]`。 */
type SegRow = readonly [string, number, number, number, number, 'A' | 'B' | null, string];

function rowOf(seg: SegFact): SegRow {
  return [
    seg.encounterId,
    r1(seg.hpA),
    r1(seg.hpB),
    seg.steps,
    seg.hits,
    seg.winner,
    seg.build.join('+') || '-',
  ];
}

/* ==================================================================== 用例 */

describe('PRODUCT-LOOP-R9｜三段节奏 + 两次 Build 的真实作用（机器取证）', () => {
  /* ================================================================= R9-01 */
  it('R9-01 必改 1：严格三段节奏 —— 相邻两段之间**恰好一个**节点（那就是 Build Choice）', () => {
    // ① 脚本形状
    expect(runScriptKindSequence()).toEqual(['EVENT', 'BATTLE', 'CHOICE', 'BATTLE', 'CHOICE', 'FINAL']);
    expect(RUN_SCRIPT.map((n) => n.id)).toEqual([
      NODE.start,
      NODE.battle1,
      NODE.choice1,
      NODE.battle2,
      NODE.choice2,
      NODE.final,
    ]);
    expect(RUN_TOTAL_BATTLES, '真实战斗场数').toBe(3);
    expect(RUN_TOTAL_CHOICES, 'Build Choice 次数上限（线性链 ⇒ 任何一局恰好 2 次）').toBe(2);
    expect(RUN_TOTAL_DAYS, '单局总天数').toBe(4);

    // ② 三段分别是「遭遇 1 / 遭遇 2 / 遭遇 3」，对手与顺序都是既有条目
    const battles = runScriptBattleNodes();
    expect(battles.map((n) => n.id)).toEqual([NODE.battle1, NODE.battle2, NODE.final]);
    expect(battles.map((n) => n.encounterId)).toEqual([...SEQ]);
    expect(battles.map((n) => n.kind)).toEqual(['BATTLE', 'BATTLE', 'FINAL']);
    expect(new Set(battles.map((n) => n.encounterId)).size, '三段不是同一台车打三遍').toBe(3);

    // ③ 必改 1 的「完成后必进入 Build Choice」/「选后进入下一段」：逐节点断言 next
    expect(runScriptNode(NODE.battle1)!.next, '遭遇 1 打完 ⇒ 第 1 次 Build Choice').toBe(NODE.choice1);
    expect(runScriptNode(NODE.choice1)!.kind).toBe('CHOICE');
    expect(runScriptNode(NODE.choice1)!.next, '选完 ⇒ 遭遇 2').toBe(NODE.battle2);
    expect(runScriptNode(NODE.battle2)!.next, '遭遇 2 打完 ⇒ 第 2 次 Build Choice').toBe(NODE.choice2);
    expect(runScriptNode(NODE.choice2)!.kind).toBe('CHOICE');
    expect(runScriptNode(NODE.choice2)!.next, '选完 ⇒ 遭遇 3').toBe(NODE.final);
    expect(runScriptNode(NODE.final)!.next, '遭遇 3 是最后一个节点 ⇒ 打完即 COMPLETE / FAILED').toBe(null);

    // ④ 两次 Build Choice 的池种类：第 1 次一层、第 2 次二层（Cannon 局两层内容）
    expect(runScriptNode(NODE.choice1)!.choicePool).toBe('layer1');
    expect(runScriptNode(NODE.choice2)!.choicePool).toBe('layer2');

    // ⑤ 真实走查的节点序列 = 脚本序列（逐项相等，不是「包含」）
    const w = walkRun(mgPrimary(), ['damageUp', 'rateUp']);
    expect(w.nodeSeq).toEqual([...RUN_SCRIPT.map((n) => n.id)]);
    const idx = (id: string) => w.nodeSeq.indexOf(id);
    expect(idx(NODE.battle2) - idx(NODE.battle1), '遭遇 1 → 遭遇 2 之间恰好一个节点').toBe(2);
    expect(idx(NODE.final) - idx(NODE.battle2), '遭遇 2 → 遭遇 3 之间恰好一个节点').toBe(2);
    expect(w.nodeSeq[idx(NODE.battle1) + 1]).toBe(NODE.choice1);
    expect(w.nodeSeq[idx(NODE.battle2) + 1]).toBe(NODE.choice2);
    expect(w.segs.map((s) => s.nodeId), '走查里也只跑了三段').toEqual([
      NODE.battle1,
      NODE.battle2,
      NODE.final,
    ]);

    // ⑥ R9 退役的四个节点确实不在脚本里（机制保留、数据退役）
    for (const gone of RETIRED_NODES) {
      expect(runScriptNode(gone), `${gone} 必须已从脚本移除`).toBe(null);
    }
    expect(RUN_SCRIPT.some((n) => n.kind === 'DURABILITY'), '当前脚本不得有耐久事件节点').toBe(false);
    expect(RUN_SCRIPT.some((n) => n.branch !== undefined), '当前脚本不得有分支节点').toBe(false);
  }, SLOW_MS);

  /* ================================================================= R9-02 */
  it('R9-02 必改 2（第 1 句）：两次 Build 逐段累积，第 1 次留到 E2 + E3、第 2 次叠加到 E3', () => {
    const w = walkRun(mgPrimary(), ['damageUp', 'rateUp']);

    // ① 三场开局的累积 Build 恰好是 [] → [第 1 次] → [第 1 次, 第 2 次]
    expect(w.buildSeq.map((b) => [...b])).toEqual([[], ['damageUp'], ['damageUp', 'rateUp']]);
    expect(segAt(w, NODE.battle1).build.length, '遭遇 1 时还没有 Build').toBe(0);
    expect(segAt(w, NODE.battle2).build, '遭遇 2 带着第 1 次 Build').toEqual(['damageUp']);
    expect(segAt(w, NODE.final).build, '遭遇 3 带着两次 Build（第 2 次是叠加，不是替换）').toEqual([
      'damageUp',
      'rateUp',
    ]);

    // ② 结构保证（源码守卫，剥注释后匹配）：宿主每场**先释放旧运行时**，
    //    再把**累积** Build + 跨段耐久交给新运行时 ⇒ 结构上不可能「切段丢 Build」。
    const page = stripComments(readLab('runPage.ts'));
    expect(
      /private beginBattle\(\): void \{\s*this\.endBattle\(\)/.test(page),
      'beginBattle 必须先 endBattle 释放上一场',
    ).toBe(true);
    expect(/build: runBuildIds\(this\.state\)/.test(page), '每场战斗的 Build 来自本局累积').toBe(true);
    expect(/carriedHp: runCarriedPlayerHp\(this\.state\)/.test(page), '跨段耐久同源注入').toBe(true);
    expect(
      /private endBattle\(\): void \{[\s\S]{0,400}?dispose\(\)/.test(page),
      'endBattle 必须 dispose',
    ).toBe(true);
    // 反向：宿主里**不得**出现「每段重建一份初始 Build」这种写法
    expect(/build: \[\]/.test(page), '宿主不得把 Build 硬写成空数组').toBe(false);
    expect(/buff: \[\]|buffs: \[\]/.test(page), '宿主不得把本局 Build 重置').toBe(false);

    // ③ 「真的进到武器上」：逐发伤害 = canonical → round(canonical × 1.25)
    const def = registry.functionals.get('machineGun')!;
    const dmgKey = weaponDamageParamKey(def);
    const cadence = weaponCadenceGrowth(def);
    expect(dmgKey, 'machineGun 必须有一个伤害键（否则通用成长对它无效）').not.toBe(null);
    expect(cadence, 'machineGun 必须有一个节奏键').not.toBe(null);
    const canonical = def.behaviorParams![dmgKey!] as number;
    const boosted = Math.round(canonical * 1.25);
    expect({ dmgKey, canonical, cadenceKey: cadence!.key }).toEqual({
      dmgKey: 'projectileDamage',
      canonical: 20,
      cadenceKey: 'cooldownMs',
    });
    expect(segAt(w, NODE.battle1).perHit, '遭遇 1（零 Build）：逐发 = canonical').toEqual([canonical]);
    expect(segAt(w, NODE.battle2).perHit, '遭遇 2（带 damageUp）：逐发真的被抬了').toEqual([boosted]);
    expect(segAt(w, NODE.final).perHit, '遭遇 3（两次 Build 都在）：伤害键仍是强化后的值').toEqual([
      boosted,
    ]);

    // ④ 反向守卫：每一段都是「真实打到人的一局」（不存在空跑 / 摆件）
    for (const seg of w.segs) {
      expect(seg.hpA0, `${seg.nodeId}：玩家开局耐久 > 0`).toBeGreaterThan(0);
      expect(seg.hits, `${seg.nodeId}：真的打到了人`).toBeGreaterThan(0);
      expect(seg.damage, `${seg.nodeId}：真实伤害 > 0`).toBeGreaterThan(0);
    }
  }, SLOW_MS);

  /* ================================================================= R9-03 */
  it('R9-03 必改 4：machineGun 走官方通用池的**正常选择路径**，三段全胜 COMPLETE', () => {
    const draft = mgPrimary();

    // ① 这是**正式装配**：资格层放行，且装配顺序第一件 = WEAPON_SLOT 里那件 ⇒ 本局基准武器
    expect(WEAPON_SLOT).toBe('frontMass');
    expect(canStartFullRun(draft), '这份装配必须能开始完整 Run').toBe(true);
    const compat = runLoadoutCompatOfDraft(draft);
    expect(compat.ok).toBe(true);
    expect(compat.baseWeaponDefId, '本局基准武器 = machineGun（池族据此决定）').toBe('machineGun');

    // ② 主路径：damageUp → rateUp ⇒ 三段全胜
    const w = walkRun(draft, ['damageUp', 'rateUp']);
    expect(w.phase, '三段全胜 ⇒ 正式 COMPLETE').toBe('COMPLETE');
    expect(w.complete, '正式 COMPLETE 谓词').toBe(true);
    expect(w.failed, '不是 FAILED').toBe(false);
    expect(w.battlesCompleted, '三段都计入战果').toBe(RUN_TOTAL_BATTLES);
    expect(w.segs.map((s) => s.winner)).toEqual(['A', 'A', 'A']);
    expect(w.segs.map((s) => s.encounterId)).toEqual([...SEQ]);
    for (const seg of w.segs) {
      expect(seg.hpA, `${seg.nodeId}：我方必须活下来（不是双亡）`).toBeGreaterThan(0);
      expect(seg.hpB, `${seg.nodeId}：对手必须被真实打完`).toBe(0);
    }

    // ③ 冻结读数（改任何 Weapon / Enemy 数值都会在这里炸出来）
    expect(w.segs.map(rowOf)).toEqual([
      ['ProtoRusher', 1039.7, 0, 222, 50, 'A', '-'],
      ['Chaser', 1039.7, 0, 146, 36, 'A', 'damageUp'],
      ['RangedTurret', 759.7, 0, 193, 44, 'A', 'damageUp+rateUp'],
    ]);

    // ④ 第二条正常路径（**顺序反过来**也成立）⇒ 不是「只写死了一条路线」
    const w2 = walkRun(draft, ['rateUp', 'damageUp']);
    expect(w2.phase).toBe('COMPLETE');
    expect(w2.buildSeq.map((b) => [...b])).toEqual([[], ['rateUp'], ['rateUp', 'damageUp']]);
    expect(w2.segs.map(rowOf)).toEqual([
      ['ProtoRusher', 1039.7, 0, 222, 50, 'A', '-'],
      ['Chaser', 946.8, 0, 183, 45, 'A', 'rateUp'],
      ['RangedTurret', 666.8, 0, 193, 44, 'A', 'rateUp+damageUp'],
    ]);

    // ⑤ 第三条正常路径：第 2 次选官方池里的第三项同样成立
    const w3 = walkRun(draft, ['damageUp', 'emergencyRepair']);
    expect(w3.phase).toBe('COMPLETE');
    expect(w3.buildSeq[2]).toEqual(['damageUp', 'emergencyRepair']);
    expect(lastSeg(w3).hpA, '维修让第三段更宽裕').toBeGreaterThan(lastSeg(w).hpA);

    // ⑥ 禁止清单取证：没有任何一段出现「玩家没选过的项」（无隐藏 Buff / 不自动选择）
    for (const walk of [w, w2, w3]) {
      expect(walk.buildSeq[0], '第一场必须零 Build').toEqual([]);
      expect(
        [...walk.buildSeq[2]],
        '第三段的累积 Build 恰好 = 玩家点过的两项，顺序 = 点击顺序',
      ).toEqual(walk.picks.map((p) => p.pick));
      expect(walk.buildSeq[1], '第二段的累积 Build 恰好 = 第一次点的项').toEqual([
        walk.picks[0].pick,
      ]);
      for (const p of walk.picks) {
        expect(p.pool, `${p.nodeId}：候选池非空（不存在没得选）`).not.toHaveLength(0);
        expect(p.accepted, `${p.nodeId}：选项必须来自当时真实的候选池`).toBe(true);
      }
    }
  }, SLOW_MS);

  /* ================================================================= R9-04 */
  it('R9-04 必改 2（第 2 句）因果：同一装配下，第 1 次 Build 翻转 E3、第 2 次 Build 再叠加', () => {
    /* 隔离单场 ⇒ 唯一变量是累积 Build。
       ⚠️ 第 ① — ③ 刻意用**产品今天一键可达的装配形态**（`frontMass` + 固定 `top: hammer`），
          这样「Build 是唯一变量」这件事在玩家真能装出来的形状上也成立。 */
    const b = reachableWith('machineGun');
    const none = solo(b, [], 'RangedTurret');
    const one = solo(b, ['damageUp'], 'RangedTurret');
    const oneRate = solo(b, ['rateUp'], 'RangedTurret');
    const two = solo(b, ['damageUp', 'rateUp'], 'RangedTurret');

    // ① 无 Build 允许失败（验收 6 的因果对照）
    //    ⚠️ R12（开火窗口）后对手不再「一边后撤一边挨打」⇒ 零 Build 反而打得更少（残 160，此前 119.7）
    expect(none.winner, '零 Build：第三段打不过').toBe('B');
    expect(none.hpB, '零 Build：对手还剩一小截血').toBeGreaterThan(0);
    expect(r1(none.hpB)).toBe(160);
    expect(r1(none.hpA)).toBe(0);

    // ② 第 1 次 Build **翻转**第三段的结果（结果层的改变）
    expect(one.winner, 'damageUp：第三段翻成胜').toBe('A');
    expect(one.hpB).toBe(0);
    expect(r1(one.hpA)).toBe(80);
    expect(oneRate.winner, 'rateUp：同样翻成胜（两条路都成立）').toBe('A');
    expect(r1(oneRate.hpA)).toBe(40);

    // ③ 第 2 次 Build **叠加**并进一步作用到第三段（两者的唯一差别就是 rateUp）
    expect(two.winner).toBe('A');
    expect(r1(two.hpA)).toBe(280);
    expect(two.hpA, '第二次 Build 让第三段明显更宽裕').toBeGreaterThan(one.hpA);
    expect(two.steps, '节奏向的第二次 Build 让这一场更快收束').toBeLessThan(one.steps);

    // ④ 第 1 次 Build 也真的作用在**遭遇 2**（不只是「留到第三段」）
    const a = mgPrimary();
    const e2None = solo(a, [], 'Chaser');
    const e2One = solo(a, ['damageUp'], 'Chaser');
    expect(e2None.winner).toBe('A');
    expect(e2One.winner).toBe('A');
    expect(r1(e2None.hpA), '零 Build：遭遇 2 要吃一段伤害').toBe(917.1);
    expect(r1(e2One.hpA), '带 damageUp：遭遇 2 几乎不吃伤害').toBe(1100);
    expect(e2One.steps).toBeLessThan(e2None.steps);
    const def = registry.functionals.get('machineGun')!;
    const canonical = def.behaviorParams![weaponDamageParamKey(def)!] as number;
    expect(e2None.perHit, '零 Build 逐发 = canonical').toEqual([canonical]);
    expect(e2One.perHit, 'damageUp 确实进了武器').toEqual([Math.round(canonical * 1.25)]);

    // ⑤ 第三段在**主装配**上的同向变化（零 Build < 一层 < 两层）
    const tNone = solo(a, [], 'RangedTurret');
    const tOne = solo(a, ['damageUp'], 'RangedTurret');
    const tTwo = solo(a, ['damageUp', 'rateUp'], 'RangedTurret');
    // ⚠️ R12：**三档 hpA 逐字节未变**（720 / 800 / 820）—— 这台三机枪车在开火窗口下的
    //   终局余量与改前完全相同，只有第一场的**步数**变短（245 → 242）。
    expect([r1(tNone.hpA), r1(tOne.hpA), r1(tTwo.hpA)]).toEqual([720, 800, 820]);
    expect([tNone.steps, tOne.steps, tTwo.steps]).toEqual([242, 222, 193]);
    expect(tTwo.steps).toBeLessThan(tNone.steps);
  }, SLOW_MS);

  /* ================================================================= R9-05 */
  it('R9-05 必改 3：候选池逐字复用现有内容（零新增词条 / 不硬塞指定选项）', () => {
    // ① 通用池就是 Queue 点的那三项（现有内容），「通用成长」只有两项
    expect(RUN_GENERIC_CHOICE_POOL).toEqual(['damageUp', 'rateUp', 'emergencyRepair']);
    expect(RUN_GENERIC_GROWTH_IDS).toEqual(['damageUp', 'rateUp']);
    // Cannon 三池一字未动
    expect(RUN_LAYER1_POOL).toEqual(['heavyShell', 'twinCannon', 'fastReload']);
    expect(RUN_LAYER2_POOLS).toEqual({
      heavyShell: ['kineticBurst', 'emergencyRepair', 'fastReload'],
      twinCannon: ['tripleLoad', 'emergencyRepair', 'heavyShell'],
      fastReload: ['heavyShell', 'twinCannon', 'emergencyRepair'],
    });

    // ② 通用局（machineGun 基准武器）：两次都是**三选一 → 二选一**，池内容 ⊆ 现有三项
    const g = walkRun(mgPrimary(), ['damageUp', 'rateUp']);
    expect(runChoicePoolFamily(stateAtChoice1(mgPrimary())), '池族由基准武器决定').toBe('generic');
    expect(g.picks.map((p) => p.nodeId)).toEqual([NODE.choice1, NODE.choice2]);
    expect(g.picks.map((p) => p.kind)).toEqual(['layer1', 'layer2']);
    expect(g.picks.map((p) => p.layer)).toEqual([1, 2]);
    expect(g.picks[0].pool, '第 1 次：三选一').toEqual(['damageUp', 'rateUp', 'emergencyRepair']);
    expect(g.picks[1].pool, '第 2 次：剔除已拥有项后的二选一').toEqual(['rateUp', 'emergencyRepair']);
    for (const p of g.picks) {
      for (const id of p.pool) {
        expect(RUN_GENERIC_CHOICE_POOL, `${id} 必须来自现有通用池`).toContain(id);
      }
      expect(
        p.pool.some((id) => (RUN_LAYER1_POOL as readonly string[]).includes(id)),
        '通用局不得出现 Cannon 项',
      ).toBe(false);
    }

    // ③ Cannon 局：池是 Cannon 自己的两层内容，通用项一次都不出现（两支互斥）
    const c = walkRun(cannonWalkDraft(), ['heavyShell', 'kineticBurst']);
    expect(runChoicePoolFamily(stateAtChoice1(cannonWalkDraft()))).toBe('cannon');
    expect(c.picks[0].pool).toEqual(['heavyShell', 'twinCannon', 'fastReload']);
    expect(c.picks[1].pool).toEqual(['kineticBurst', 'emergencyRepair', 'fastReload']);
    for (const p of c.picks) {
      for (const id of RUN_GENERIC_GROWTH_IDS) {
        expect(p.pool, `${id} 属通用成长：Cannon 局不得提供`).not.toContain(id);
      }
    }

    // ④ 零新增：所有节点的池并集 ⊆（Cannon 既有 id ∪ 通用既有 id）
    const seen = new Set<string>();
    for (const w of [g, c, walkRun(mgPrimary(), ['rateUp', 'damageUp'])]) {
      for (const p of w.picks) for (const id of p.pool) seen.add(id);
    }
    expect([...seen].sort()).toEqual(
      ['damageUp', 'emergencyRepair', 'fastReload', 'heavyShell', 'kineticBurst', 'rateUp', 'twinCannon'].sort(),
    );

    // ⑤ 「不硬塞指定选项」的结构性证据：不在池里的项点了是 no-op，Run 不会静默推进
    const stuck = walkRun(mgPrimary(), ['heavyShell', 'kineticBurst']);
    expect(stuck.picks[0].accepted, '通用局里 Cannon 项不在池里').toBe(false);
    expect(stuck.phase, '点了不在池里的项 ⇒ Run 停在 CHOICE，不会偷偷推进').toBe('CHOICE');
    expect(stuck.segs.length, '只跑完第 1 段就停住了').toBe(1);
    expect(stuck.buildSeq.map((b) => [...b])).toEqual([[]]);
  }, SLOW_MS);

  /* ================================================================= R9-06 */
  it('R9-06 验收 6：无 Build / 不合适 Build 仍然允许失败（没有为了过第三段放宽任何数值）', () => {
    // ① 产品今天「一键可达」的装配形态（只有 WEAPON_SLOT 可编辑）× 7 件正式武器
    //    ⚠️ 逐件都失败 —— 这是既有的内容 / 平衡缺口，见文件头「如实披露」。
    const reachable: Record<string, string> = {};
    for (const weapon of FULL_RUN_SUPPORTED_WEAPON_IDS) {
      const [p1, p2] = picksFor(weapon, 'heavyShell', 'kineticBurst');
      expect(canStartFullRun(reachableWith(weapon)), `${weapon}：资格层放行`).toBe(true);
      const w = walkRun(reachableWith(weapon), [p1, p2]);
      reachable[weapon] = w.phase === 'COMPLETE' ? 'COMPLETE' : `FAILED@${lastSeg(w).encounterId}`;
    }
    // ⚠️ PRODUCT-LOOP-R11-LASER-CADENCE-R1：laser 的 `cooldownMs` 1800 → 600（只动攻击间隔）
    //    ⇒ laser 从「第 1 段 `ProtoRusher` 就阵亡」推进到「打进终局 `RangedTurret` 才阵亡」。
    //    ⚠️ 仍是 **FAILED**（不是 COMPLETE）⇒ 「单槽形态没有任何一件能通关」的事实未被掩盖。
    // ⚠️ R12（开火窗口）后**本表逐字未变** —— 三种形态的「死在哪一段」都没有被这条规则改变
    //    （它只改第 3 段的交换比，不改「能否通关」的判定；`walk` 形态的 `hammer/D1` 是**另一张表**
    //     才被翻转，见 `productRunFullRunPathMatrixR9F.test.ts` 的 `FROZEN_RESULT`）。
    expect(reachable).toEqual({
      cannon: 'FAILED@RangedTurret',
      flamethrower: 'FAILED@RangedTurret',
      hammer: 'FAILED@RangedTurret',
      laser: 'FAILED@RangedTurret',
      machineGun: 'FAILED@Chaser',
      rammer: 'FAILED@Chaser',
      shotgun: 'FAILED@RangedTurret',
    });
    expect(Object.values(reachable).includes('COMPLETE'), '单槽形态没有任何一件能通关').toBe(false);

    // ② 单件归因夹具（只留 WEAPON_SLOT 那一件）× 7 件 —— 同样无一通关
    //    （与 Q3-07 的「死在哪一段」逐项一致：两处独立测量）
    const only: Record<string, string> = {};
    for (const weapon of FULL_RUN_SUPPORTED_WEAPON_IDS) {
      const [p1, p2] = picksFor(weapon, 'heavyShell', 'kineticBurst');
      const w = walkRun(weaponOnly(weapon), [p1, p2]);
      only[weapon] = w.phase === 'COMPLETE' ? 'COMPLETE' : `FAILED@${lastSeg(w).encounterId}`;
    }
    expect(only).toEqual({
      cannon: 'FAILED@RangedTurret',
      flamethrower: 'FAILED@RangedTurret',
      hammer: 'FAILED@Chaser',
      laser: 'FAILED@RangedTurret', // R11：与 Q3-07 独立互证（两处口径都测到同一段）
      machineGun: 'FAILED@RangedTurret',
      rammer: 'FAILED@ProtoRusher',
      shotgun: 'FAILED@Chaser',
    });

    // ③ 「合法但不合适」的一种：machineGun 单件 + 合法通用 Build 仍是 FAILED
    //    （Build 确实生效了，但一件武器撑不过前两段的跨段耐久消耗）
    const mgSolo = walkRun(weaponOnly('machineGun'), ['damageUp', 'rateUp']);
    expect(mgSolo.phase).toBe('FAILED');
    expect(mgSolo.failed).toBe(true);
    expect(mgSolo.complete).toBe(false);
    expect(lastSeg(mgSolo).encounterId).toBe('RangedTurret');
    expect(lastSeg(mgSolo).hpA, '阵亡段我方耐久归零').toBe(0);
    expect(lastSeg(mgSolo).build, '失败时 Build 仍然在（不是被丢了）').toEqual(['damageUp', 'rateUp']);
    expect(lastSeg(mgSolo).perHit, '失败时强化仍然生效').toEqual([25]);
    expect(mgSolo.logTail[0]).toContain('战车耐久耗尽');
    expect(mgSolo.logTail[1]).toBe('战车耐久剩余 0%。');

    // ④ 未登记 / 无 Runtime 的两件：资格层直接拒绝（连开局都不允许）
    for (const blocked of ['spear', 'saw'] as const) {
      expect(supportsFullRun(blocked), `${blocked} 不在 Full Run 能力登记表里`).toBe(false);
      expect(canStartFullRun(reachableWith(blocked)), `${blocked}：产品侧必须拒绝创建 Run`).toBe(false);
      expect(canStartFullRun(weaponOnly(blocked)), `${blocked}：单件同样拒绝`).toBe(false);
    }
    expect(FULL_RUN_SUPPORTED_WEAPON_IDS.length, '放行集合仍是 7 件（本 Queue 未增未减）').toBe(7);
  }, SLOW_MS);

  /* ================================================================= R9-07 */
  it('R9-07 验收 7：Cannon 原有 Build 不退化（三池内容与三条路线逐项不变）', () => {
    const c = walkRun(cannonWalkDraft(), ['heavyShell', 'kineticBurst']);

    // ① 池族 = cannon，两个节点都是 Cannon 池，通用成长一次都不出现
    expect(c.picks.map((p) => p.pool)).toEqual([
      ['heavyShell', 'twinCannon', 'fastReload'],
      ['kineticBurst', 'emergencyRepair', 'fastReload'],
    ]);

    // ② 三条既有路线全部 COMPLETE，且三段我方耐久冻结
    //    ⚠️ 与 `portraitRunPage.test.ts` G 段 `FROZEN` 同源 —— 这里**独立再测一遍**，
    //       两次测量必须一致才算「不退化」（同参数确定性物理，无随机源）。
    const CANNON_FROZEN: Record<string, readonly [number, number, number]> = {
      // ⚠️ R12：第 1 / 2 段**逐字节未变**（那两段没有控距对手）；只有第 3 段变
      //   （`heavyShell+kineticBurst` 282.2 → **322.2**、`twinCannon+tripleLoad` 282.6 → **442.6**、
      //    `fastReload+twinCannon` 262.1 → **322.1**）—— 三条路线同向变宽裕（如实记录）。
      'heavyShell+kineticBurst': [915.2, 822.2, 322.2],
      'twinCannon+tripleLoad': [915.2, 822.6, 442.6],
      'fastReload+twinCannon': [915.2, 822.1, 322.1],
    };
    for (const [key, expected] of Object.entries(CANNON_FROZEN)) {
      const [p1, p2] = key.split('+');
      const w = walkRun(cannonWalkDraft(), [p1, p2]);
      expect(w.phase, `${key}：三段全胜`).toBe('COMPLETE');
      expect(w.segs.map((s) => s.winner)).toEqual(['A', 'A', 'A']);
      expect(w.buildSeq.map((b) => [...b])).toEqual([[], [p1], [p1, p2]]);
      expect(w.segs.map((s) => r1(s.hpA)), `${key}：逐段我方耐久`).toEqual([...expected]);
      expect(w.segs.map((s) => s.encounterId)).toEqual([...SEQ]);
    }

    // ③ 通用成长对 Cannon 是**结构性空操作**（不是「偷偷生效」）—— 两支互斥
    expect(weaponOverlayMods(['damageUp', 'rateUp'], RUN_BASE_WEAPON_DEF_ID)).toEqual([]);
    // Cannon 局里真正会改**武器数值**的是第一层三项 + `tripleLoad`；
    // `kineticBurst` / `emergencyRepair` 是**能力层**（`affectsWeapon: false`），不属于武器数值 overlay
    expect(
      weaponOverlayMods(['heavyShell', 'kineticBurst', 'emergencyRepair'], RUN_BASE_WEAPON_DEF_ID),
      '能力层项不进武器 overlay',
    ).toEqual(['heavyShell']);
    expect(
      weaponOverlayMods(['twinCannon', 'tripleLoad', 'fastReload'], RUN_BASE_WEAPON_DEF_ID),
      'Cannon 局的武器 overlay 项一个不少',
    ).toEqual(['twinCannon', 'tripleLoad', 'fastReload']);
    // 反向：通用成长只在**非 cannon 基准武器**上放行
    expect(weaponOverlayMods(['damageUp', 'rateUp'], 'machineGun')).toEqual(['damageUp', 'rateUp']);
    expect(weaponOverlayMods(['heavyShell', 'kineticBurst'], 'machineGun')).toEqual([]);

    // ④ Cannon 局第三段仍是被真实打完的（未改数值、未改 AI、未放水）
    const c2 = walkRun(cannonWalkDraft(), ['twinCannon', 'tripleLoad']);
    expect(r1(segAt(c2, NODE.final).hpA)).toBe(442.6);
    expect(segAt(c2, NODE.final).hpB).toBe(0);
  }, SLOW_MS);

  /* =============================================================== R9-98 */
  it('R9-98 本文件是**纯取证**：import 闭集，且不含任何写数值语句', () => {
    const src = readFileSync(join(__dirname, 'productRunThreeStagePacingR9.test.ts'), 'utf8');
    const noComments = stripComments(src);
    const paths = [...noComments.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    expect([...paths].sort()).toEqual(
      [
        'node:fs',
        'node:path',
        'vitest',
        '../src/core/content',
        '../src/lab/buildEditorModel',
        '../src/lab/portraitBattleLab/runBattleRuntime',
        '../src/lab/portraitBattleLab/runLoadoutCompat',
        '../src/lab/portraitBattleLab/runModifiers',
        '../src/lab/portraitBattleLab/runPageState',
        '../src/lab/portraitBattleLab/runPageScene',
        '../src/lab/portraitBattleLab/runScript',
        '../src/product/playerLoadout',
        '../src/product/runCompatibility',
      ].sort(),
    );
    for (const forbidden of ['planckBattleOrchestrator', 'enemyDrive', 'planckWorld']) {
      expect(paths.some((p) => p.includes(forbidden)), `不得 import ${forbidden}`).toBe(false);
    }
    for (const token of ['.' + 'hp = ', '.' + 'maxHp = ', 'apply' + 'LinearImpulse']) {
      expect(noComments.includes(token), `取证文件不得出现 ${token}`).toBe(false);
    }
  });
});
