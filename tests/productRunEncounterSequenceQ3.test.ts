/**
 * PRODUCT-LOOP-R6-BASIC-ENCOUNTER-SEQUENCE｜三段问题序列验收
 *
 * ## 本文件验的是什么
 *
 * 产品 Run 的战斗脚本从**四场压力阶梯**收成**三段问题序列**（全部复用既有正式对手模板，
 * 零数值改动）：
 *
 *   | 段 | 节点 | Encounter | 模板 | 展示名 | 这一段要建立的**战斗问题** |
 *   |---|---|---|---|---|---|
 *   | ① | `d2-battle1` | `ProtoRusher`  | `R1-RUSH-02` | 菠萝冲刺车 | 基础近身碰撞压力 |
 *   | ② | `d3-battle2` | `Chaser`       | `OPP-16`     | 追猎者     | 追击 / 接触节奏 |
 *   | ③ | `d4-final`   | `RangedTurret` | `OPP-03`     | 远程炮台   | 第一次要求玩家处理**远程控距** |
 *
 * ## 与 `portraitRunPage.test.ts` 的分工
 *
 *   - `portraitRunPage.test.ts` = 页面 / 状态机 / 面积账本 / 两层 Build 闭环（**结构**）。
 *   - 本文件 = **三段序列本身**：顺序、清场、不串场、任意段死亡、第三段完成、
 *     以及「全部已登记武器都能跑这条序列」（**序列语义 + 武器覆盖**）。
 *
 * ## 一个必须说清楚的事实（不是本文件放宽判据）
 *
 * 第 3 段 `RangedTurret` 是全项目**唯一**声明 `enemyDrive: 'keep-distance'` 的对手
 * （见 `testData.ts` 对应条目），它主动维持作战距离 ⇒ **靠物理接触造成伤害这条路被否掉**。
 * 后果（本文件 Q3-07 逐件钉死、并记入未决台账）：
 *
 *   - **产品默认车**（`frontMass: cannon` + `top: hammer`）与 **Lab 演示装载**（只有一门炮）
 *     都**打不过第 3 段**；
 *   - 能打通它的真实装配需要**弹丸武器**（实测：`front: cannon + top/rear: machineGun`、
 *     `machineGun ×2/×3`、`machineGun + cannon` 均可通关）。
 *
 * 这属于**平衡 / 内容完成度**，不是 Runtime 缺口 —— 三段的 Runtime 链路
 * （canonical Def → behavior → factory → entity → attack → projectile → damage → result）
 * 对每一段都是完整的。因此本文件的「都能跑」口径**按结构定**：
 * ① 资格层不挡；② 每件都能进入第 1 段、建成真实实体、**打出真实伤害**；③ 序列按战果推进。
 * 「哪件能整轮通关」以**冻结实测矩阵**如实记录（Q3-07），不靠「没断言到」蒙过去。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { registry } from '../src/core/content';
import { EMPTY_SLOT, type BuildDraft } from '../src/lab/buildEditorModel';
import { RunBattleRuntime } from '../src/lab/portraitBattleLab/runBattleRuntime';
import {
  createRunPageState,
  finishRunBattle,
  chooseRunBuff,
  pressRunAction,
  resolveDurability,
  runBuildIds,
  runCarriedPlayerHp,
  runChoicePool,
  runChoicePoolKind,
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
  runScriptBattleNodes,
  type RunDurabilityChoiceId,
} from '../src/lab/portraitBattleLab/runScript';
import { LAB_ENCOUNTERS } from '../src/lab/portraitBattleLab/testData';
import { OPPONENT_TEMPLATES } from '../src/player/opponentPool';
import { defaultPlayerDraft, WEAPON_SLOT } from '../src/product/playerLoadout';
import {
  FULL_RUN_SUPPORTED_WEAPON_IDS,
  canStartFullRun,
  supportsFullRun,
} from '../src/product/runCompatibility';

const LAB_DIR = join(__dirname, '..', 'src', 'lab', 'portraitBattleLab');

function read(f: string): string {
  return readFileSync(join(LAB_DIR, f), 'utf8');
}

/** 剥注释后再做源码匹配（守卫必须扛得住「注释里写了禁用词」的自指陷阱）。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const CTX = runPageContext();

const FRAME_MS = 1000 / 60;
const MAX_FRAMES = 4000;

/** 三段问题序列的对手（顺序 = 问题出现的顺序）。 */
const SEQ = ['ProtoRusher', 'Chaser', 'RangedTurret'] as const;

/** 玩家的产品侧装备标签（`runPage.beginBattle` 走的就是这一条）。 */
const PRODUCT_TAG = 'profile-equipped';

/* ---------------------------------------------------------------- 夹具 */

/**
 * **归因夹具**：清空四个功能槽，只在**产品主武器槽**（`WEAPON_SLOT` = `frontMass`）留这一件。
 * 用途 = 「这一件武器自己能做到什么」的干净归因（不掺其它武器）。
 * ⚠️ 不能写成「`frontMass: EMPTY_SLOT` + `[WEAPON_SLOT]: id`」同一个字面量 ——
 *    两者是**同一个键**（`WEAPON_SLOT` 就是 `'frontMass'`）⇒ TS1117 重复键。
 */
function onlyDraft(weaponDefId: string): BuildDraft {
  const draft: BuildDraft = {
    ...defaultPlayerDraft(),
    functionalSelections: {
      front: EMPTY_SLOT,
      frontMass: EMPTY_SLOT,
      top: EMPTY_SLOT,
      rear: EMPTY_SLOT,
    },
  };
  (draft.functionalSelections as Record<string, string>)[WEAPON_SLOT] = weaponDefId;
  return draft;
}

/**
 * **能通关三段的真实装配**（证据见文件头）：
 * 三个槽都放**弹丸武器** ⇒ 在 `RangedTurret` 的控距下仍然有命中通道。
 */
function winnableDraft(): BuildDraft {
  return {
    ...defaultPlayerDraft(),
    functionalSelections: {
      front: 'cannon',
      frontMass: EMPTY_SLOT,
      top: 'machineGun',
      rear: 'machineGun',
    },
  };
}

/* ------------------------------------------------------------ 走查驱动器 */

interface SegFact {
  readonly nodeId: string;
  readonly encounterId: string;
  readonly winner: 'A' | 'B' | null;
  /** 本段**开局**敌人耐久（必须 = 上限 ⇒ 上一段的残敌没有跟过来）。 */
  readonly hpB0: number;
  readonly hpBMax: number;
  /** 本段结束时的我方 / 敌方耐久。 */
  readonly hpA: number;
  readonly hpB: number;
  /** 本段我方武器造成的**真实伤害**（按 partId 归组求和）。 */
  readonly damage: number;
  readonly steps: number;
}

interface ChainFact {
  readonly segments: readonly SegFact[];
  readonly phase: RunPhase;
  /** 终态快照（用于走**正式** `runComplete` / `runFailed` 谓词）。 */
  readonly finalState: RunPageState;
  readonly finalHp: number;
  readonly finalDay: number;
  readonly battlesCompleted: number;
  readonly nodeSeq: readonly string[];
  readonly logTail: readonly string[];
}

const cache = new Map<string, ChainFact>();

function draftKey(d: BuildDraft): string {
  const f = d.functionalSelections;
  return [f.front, f.frontMass, f.top, f.rear].join('|');
}

/**
 * 走完整局真实脚本（真实物理 + 真实状态机，与 `runPage.beginBattle` 同口径）。
 * ⚠️ 与 `portraitRunPage.test.ts` 的 `walkRun` 同源；本文件独立一份是为了让
 *    「三段序列」这条验收**不依赖另一个测试文件的夹具寿命**。
 */
function runChain(
  draft: BuildDraft,
  durability: RunDurabilityChoiceId = 'upgrade',
  layer1 = 'heavyShell',
  layer2 = 'kineticBurst',
): ChainFact {
  const key = `${draftKey(draft)}#${durability}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const segments: SegFact[] = [];
  const nodeSeq: string[] = [];
  let s: RunPageState = createRunPageState(CTX);
  let carry: number | null = null;

  for (let guard = 0; guard < 40; guard++) {
    if (s.phase === 'COMPLETE' || s.phase === 'FAILED') break;
    if (nodeSeq[nodeSeq.length - 1] !== s.nodeId) nodeSeq.push(s.nodeId);

    if (s.phase === 'BATTLE') {
      const node = runCurrentNode(s);
      const rt = new RunBattleRuntime({
        build: runBuildIds(s),
        carriedHp: carry,
        encounterId: node.encounterId,
        playerDraft: draft,
        playerLoadoutTag: PRODUCT_TAG,
        // 与 `runPage.beginBattle()` **同口径**（那边恒传 true）。
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
        const damage = Object.values(rt.playerWeaponHitSummary()).reduce(
          (n, v) => n + v.damages.reduce((a, b) => a + b, 0),
          0,
        );
        segments.push({
          nodeId: node.id,
          encounterId: node.encounterId!,
          winner: rt.result?.winner ?? null,
          hpB0: atStart.b,
          hpBMax: atStart.bMax,
          hpA: hp.a,
          hpB: hp.b,
          damage,
          steps,
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
      const kind = runChoicePoolKind(s);
      const pick =
        kind === 'layer1'
          ? layer1
          : kind === 'layer2'
            ? layer2
            : (runChoicePool(s)[0]?.id ?? '');
      s = chooseRunBuff(s, pick, CTX);
      continue;
    }

    if (s.phase === 'DURABILITY') {
      s = resolveDurability(s, durability, CTX);
      continue;
    }

    if (s.phase === 'EVENT') carry = runCarriedPlayerHp(s);
    s = pressRunAction(s, CTX);
  }

  const fact: ChainFact = {
    segments,
    phase: s.phase,
    finalState: s,
    finalHp: s.battle?.playerHp ?? 0,
    finalDay: s.day,
    battlesCompleted: s.battlesCompleted,
    nodeSeq,
    logTail: s.log.slice(-2).map((e) => e.text),
  };
  cache.set(key, fact);
  return fact;
}

/** 段落里最后一个已发生的段落。 */
function lastSeg(ch: ChainFact): SegFact {
  return ch.segments[ch.segments.length - 1];
}

/* ------------------------------------------------------------------ 用例 */

describe('PRODUCT-LOOP-R6｜三段问题序列', () => {
  it('Q3-01 脚本 = 三段固定顺序，全部是既有正式对手模板的引用（零数值改动）', () => {
    const nodes = runScriptBattleNodes();
    // ① 三段、固定顺序、固定节点 id / kind / day
    //    ⚠️ PRODUCT-LOOP-R9-THREE-STAGE-BUILD-PACING：脚本收成三段线性链 ⇒
    //       第 3 段 = 终局节点现在叫 `d4-final`（DAY 4）。
    expect(nodes.map((n) => n.id)).toEqual(['d2-battle1', 'd3-battle2', 'd4-final']);
    expect(nodes.map((n) => n.encounterId)).toEqual([...SEQ]);
    expect(nodes.map((n) => n.kind)).toEqual(['BATTLE', 'BATTLE', 'FINAL']);
    expect(nodes.map((n) => n.day)).toEqual([2, 3, 4]);
    expect(RUN_TOTAL_BATTLES, '单局真实战斗场数 = 3').toBe(3);
    // ② 第一段与终局之间**只有一个** BATTLE（改前的 `d6-battle3` 已删除）
    expect(nodes.filter((n) => n.kind === 'BATTLE').length).toBe(2);
    expect(nodes.filter((n) => n.kind === 'FINAL').length).toBe(1);
    // ③ 引用的都是**既有** Lab Encounter，且 draft 逐字段等于正式对手池
    for (const n of nodes) {
      const enc = LAB_ENCOUNTERS.find((e) => e.id === n.encounterId);
      expect(enc, `Lab 必须已有 ${n.encounterId}（不新增敌人）`).toBeDefined();
      const official = OPPONENT_TEMPLATES.find((t) => t.id === enc!.templateId);
      expect(official, `正式对手池必须有 ${enc!.templateId}`).toBeDefined();
      expect(enc!.count, `${n.id} 必须是单敌`).toBe(1);
      expect(enc!.draft, `${n.id} 不得修改正式敌人定义`).toEqual(official!.draft);
    }
    // ④ 三段互不相同（不是同一台车打三遍）
    const ids = nodes.map((n) => n.encounterId);
    expect(new Set(ids).size).toBe(ids.length);
    // ⑤ 旧四场阶梯的对手**零残留**（改的是序列，不是敌人池）
    const src = read('runScript.ts');
    for (const gone of ['PineappleFireBrute', 'PineappleSawRusher', 'BananaRodLaser']) {
      expect(src.includes(gone), `旧阶梯对手 ${gone} 必须已从脚本移除`).toBe(false);
    }
    // ⑥ 脚本导出的场地／节点总数与 `RUN_SCRIPT` 自洽
    expect(RUN_TOTAL_BATTLES).toBe(RUN_SCRIPT.filter((n) => n.kind === 'BATTLE' || n.kind === 'FINAL').length);
  });

  it('Q3-02 清场：进入下一段之前，上一段的实体真的被释放（不跨段残留）', () => {
    // ① 源码层：`beginBattle()` 第一件事是 `endBattle()`，而 `endBattle()` 释放运行时
    const page = stripComments(read('runPage.ts'));
    expect(/private beginBattle\(\): void \{\s*this\.endBattle\(\)/.test(page)).toBe(true);
    expect(/private endBattle\(\): void \{[\s\S]{0,600}?dispose\(\)/.test(page), 'endBattle 必须 dispose 运行时').toBe(true);
    // ② 运行时层：每段都是**全新**运行时 + 敌人**满血开局**
    //    ⇒ 上一段的弹丸 / 接触 / 残留耐久都不可能跟过来。
    const ch = runChain(winnableDraft());
    expect(ch.segments.length).toBe(3);
    for (const seg of ch.segments) {
      expect(seg.hpB0, `${seg.nodeId}：本段开局敌人必须满血（= 上一段残敌没跟过来）`).toBe(seg.hpBMax);
    }
    // ③ 每段都是独立运行时实例（对象身份不同）——由 `segments` 各自真实跑完佐证：
    //    每段都有自己的步数与伤害统计，不存在「复用上一段统计」的可能。
    expect(new Set(ch.segments.map((s) => s.steps)).size).toBeGreaterThan(1);
  });

  it('Q3-03 Enemy 不串场：三段各打各的（敌 HP 上限互不相同 + 与该节点声明的敌情一致）', () => {
    const ch = runChain(winnableDraft());
    // ① 每段的对手 = 该节点声明的 Encounter
    expect(ch.segments.map((s) => s.encounterId)).toEqual([...SEQ]);
    expect(ch.segments.map((s) => s.nodeId)).toEqual(['d2-battle1', 'd3-battle2', 'd4-final']);
    // ② 三段的敌 HP 上限互不相同（换人 = 换敌人的硬证据）
    const maxes = ch.segments.map((s) => s.hpBMax);
    expect(maxes).toEqual([1000, 900, 1100]);
    expect(new Set(maxes).size).toBe(3);
    // ③ 页面的敌情读的就是同一份数据（`CTX.encounters[nodeId]`）
    for (const seg of ch.segments) {
      expect(CTX.encounters[seg.nodeId], `${seg.nodeId} 必须有敌情`).toBeDefined();
      expect(CTX.encounters[seg.nodeId].hpMax, `${seg.nodeId}: 敌情 HP 与本段真实上限一致`).toBe(seg.hpBMax);
    }
    // ④ 敌情展示名也各不相同（不是同一个 label 换数值）
    const labels = ch.segments.map((s) => CTX.encounters[s.nodeId].label);
    expect(new Set(labels).size).toBe(3);
  });

  it('Q3-04 任意一段阵亡 ⇒ 走**正式 FAILED 流程**（三段各用一条真实物理路线钉死）', () => {
    /*
      三条**真实**路线，分别在 ① / ② / ③ 段阵亡（单件归因夹具，实测见 Q3-07）：
        - `rammer` 单件       → ① `ProtoRusher` 就顶不住；
        - `hammer` 单件       → 撑过 ①，死在 ② `Chaser`；
        - `flamethrower` 单件 → 撑过 ①②，死在 ③ `RangedTurret`。
      三条都不是「构造出来的假死」，而是真实物理结果 ⇒ 「任意段死亡」被真实覆盖。

      ⚠️ **PRODUCT-LOOP-R11-LASER-CADENCE-R1 的路线替换（不是删断言）**：本用例原先用 `laser`
         钉「① 段阵亡」。R11 把 laser 的 `cooldownMs` 1800 → 600（只动攻击间隔）之后，
         laser 单件**不再**死在第 ① 段（实测推进到 ③ `RangedTurret`，见 Q3-07 / RP9-05）⇒
         它已**不再是一条「① 段阵亡」的真实路线**。
         替换为**同一口径下真实死在第 ① 段的 `rammer`**（三件覆盖的三段位置一字不变：
         ① `rammer` / ② `hammer` / ③ `flamethrower`）—— **断言形状与覆盖强度均未放宽**。
         laser 的新事实由 Q3-06 / Q3-07 单独如实记录。
    */
    const cases: readonly [string, string][] = [
      ['rammer', 'ProtoRusher'],
      ['hammer', 'Chaser'],
      ['flamethrower', 'RangedTurret'],
    ];
    for (const [weapon, deadAt] of cases) {
      const ch = runChain(onlyDraft(weapon));
      // ① 终态 = 正式 FAILED（不是崩溃、不是卡死、不是 COMPLETE）
      expect(ch.phase, `${weapon} 必须走 FAILED`).toBe('FAILED');
      expect(runFailed(ch.finalState), `${weapon}: 正式 FAILED 谓词`).toBe(true);
      expect(runComplete(ch.finalState), `${weapon}: 不是 COMPLETE`).toBe(false);
      // ② 死在**预期的那一段**，且该段之前各段都真的打完了
      expect(lastSeg(ch).encounterId, `${weapon} 死在哪一段`).toBe(deadAt);
      expect(lastSeg(ch).winner, `${weapon}: 该段败北`).toBe('B');
      expect(lastSeg(ch).hpA, `${weapon}: 该段我方耐久归零`).toBe(0);
      expect(ch.segments.length, `${weapon}: 阵亡段是按顺序推进到的`).toBe(SEQ.indexOf(deadAt as (typeof SEQ)[number]) + 1);
      // ③ 正式 FAILED 文案（与 `finishRunBattle` 的失败分支逐字一致）
      expect(ch.logTail[0]).toBe(`战车耐久耗尽，DAY ${ch.finalDay} 的冒险到此结束。`);
      expect(ch.logTail[1]).toBe('战车耐久剩余 0%。');
      // ④ 阵亡段**之后**不再有段落（不跳段、不续命）
      expect(ch.segments.filter((s) => SEQ.indexOf(s.encounterId as (typeof SEQ)[number]) > SEQ.indexOf(deadAt as (typeof SEQ)[number])).length).toBe(0);
    }
  });

  it('Q3-05 第三段完成 ⇒ 走**正式 COMPLETE 流程**（真实物理，三段全胜）', () => {
    const ch = runChain(winnableDraft());
    expect(ch.segments.map((s) => s.encounterId)).toEqual([...SEQ]);
    expect(ch.segments.map((s) => s.winner)).toEqual(['A', 'A', 'A']);
    expect(ch.phase).toBe('COMPLETE');
    expect(runComplete(ch.finalState), '正式 COMPLETE 谓词').toBe(true);
    expect(runFailed(ch.finalState), '不是 FAILED').toBe(false);
    expect(ch.finalHp).toBeGreaterThan(0);
    expect(ch.battlesCompleted, '三段都计入战果').toBe(RUN_TOTAL_BATTLES);
    expect(ch.logTail.join(' / ')).toContain('这次冒险到此结束。');
    // 走完三段才进终态：`d4-final` 是序列里的**最后**一个节点
    expect(ch.nodeSeq[ch.nodeSeq.length - 1]).toBe('d4-final');
  });

  it('Q3-06 当前**全部** Full Run Weapon 都能跑该序列（资格层 + 进入并造成真实伤害）', () => {
    // ① 登记集合 = 7 件，且逐件都是玩家可拥有的正式武器
    expect(FULL_RUN_SUPPORTED_WEAPON_IDS.length).toBe(7);
    for (const weapon of FULL_RUN_SUPPORTED_WEAPON_IDS) {
      const def = registry.functionals.get(weapon);
      expect(def, `${weapon} 必须在正式 registry 里`).toBeDefined();
      expect(def!.category, `${weapon} 必须是武器`).toBe('weapon');
      // ② 资格层三项全过（不挡）
      expect(supportsFullRun(weapon), `${weapon}: supportsFullRun`).toBe(true);
      expect(canStartFullRun(onlyDraft(weapon)), `${weapon}: canStartFullRun（装载只放它）`).toBe(true);
    }
    // ③ Runtime 层：每件都能**进入第 1 段**并打出**真实伤害**（> 0 = 真的在打，不是摆件）
    const damage: Record<string, number> = {};
    for (const weapon of FULL_RUN_SUPPORTED_WEAPON_IDS) {
      const ch = runChain(onlyDraft(weapon));
      expect(ch.segments.length, `${weapon}: 至少跑完第 1 段`).toBeGreaterThanOrEqual(1);
      const first = ch.segments[0];
      expect(first.encounterId, `${weapon}: 第 1 段 = 序列第 1 段`).toBe(SEQ[0]);
      expect(first.damage, `${weapon} 必须在第 1 段打出真实伤害`).toBeGreaterThan(0);
      damage[weapon] = first.damage;
    }
    // 冻结实测伤害（第 1 段，单件归因夹具）—— 任何武器改动都必须回到这里重测
    expect(damage).toEqual({
      cannon: 1080,
      flamethrower: 1000,
      hammer: 1080,
      // R11：cooldownMs 1800 → 600 ⇒ 第 1 段（`ProtoRusher`）发射 5 → 7 发（800 → 1120）。
      laser: 1120,
      machineGun: 1000,
      rammer: 770,
      shotgun: 1140,
    });
  });

  it('Q3-07 单件归因夹具下的三段实测矩阵（冻结事实：内容 / 平衡完成度，不是 Runtime 缺口）', () => {
    /*
      ⚠️ 这张表**如实记录**「只带这一件武器时，三段序列把它带到哪」。
      它**不是**放行标准（放行由 `runCompatibility` 的 5 条门槛决定，见 Q3-06），
      也**不是** Runtime 缺口（每件的 Runtime 链路都完整、第 1 段都能打出真实伤害）。
      它的用途：让「非 Cannon 拿不到局内伤害成长 + 第 3 段控距」这两个**内容层**事实
      变成机器可见、不可悄悄变化的东西。
      ⚠️ 口径 = **带本局 Build 的真实走查**（PRODUCT-LOOP-R9：脚本是严格三段链，
      第 2 段带 `heavyShell`、第 3 段带 `heavyShell + kineticBurst`）。这些强化
      **只作用于基准武器（`cannon`）**，对其它 6 件是空操作 ⇒ 只有 `cannon` 那一行会被它们改善
      （裸装实测死在 ②，带上两层强化后撑到 ③）。
      ⚠️ 对比：**产品默认车**（`frontMass: cannon` + `top: hammer`）也跑不完三段
      （实测死在 ③）—— 这同样是内容层事实，见 `portraitRunPage.test.ts` RP-RUN-02-04。
    */
    const matrix: Record<string, string> = {};
    for (const weapon of FULL_RUN_SUPPORTED_WEAPON_IDS) {
      const ch = runChain(onlyDraft(weapon));
      matrix[weapon] = ch.phase === 'COMPLETE' ? 'COMPLETE' : `FAILED@${lastSeg(ch).encounterId}`;
    }
    expect(matrix).toEqual({
      cannon: 'FAILED@RangedTurret',
      flamethrower: 'FAILED@RangedTurret',
      hammer: 'FAILED@Chaser',
      // R11：laser 从「① 段就阵亡」推进到「打进终局才阵亡」（仍未通关 ⇒ 缺口语义不变）
      laser: 'FAILED@RangedTurret',
      machineGun: 'FAILED@RangedTurret',
      rammer: 'FAILED@ProtoRusher',
      shotgun: 'FAILED@Chaser',
    });
    // 反面：**没有任何一件单件武器**能靠一件通关（这解释了为什么必须带第二件武器）
    expect(Object.values(matrix).every((v) => v !== 'COMPLETE')).toBe(true);
    // ⚠️ **产品默认车**（`frontMass: cannon` + `top: hammer`）同样跑不完三段 —— 死在 ③。
    //    这**不是**本 Queue 引入的（R5 / Q2 已实测记录），序列变更后依然如此。
    const def = runChain(defaultPlayerDraft());
    expect(def.phase, '产品默认车打不过第 3 段（既有平衡事实）').toBe('FAILED');
    expect(lastSeg(def).encounterId).toBe('RangedTurret');
    // 而带满弹丸武器的真实装配可以（见文件头与 Q3-05）
    expect(runChain(winnableDraft()).phase).toBe('COMPLETE');
  });

  it('Q3-08 序列不引入「连续战斗 / 连续菜单」：战斗与选择仍然交替', () => {
    const kinds = RUN_SCRIPT.map((n) => n.kind);
    // PRODUCT-LOOP-R9-THREE-STAGE-BUILD-PACING：**严格三段节奏**
    //   EVENT → BATTLE(遭遇1) → CHOICE → BATTLE(遭遇2) → CHOICE → FINAL(遭遇3)
    //   ⇒ 两段之间**恰好一个** CHOICE，脚本是一条线性链。
    expect(kinds).toEqual(['EVENT', 'BATTLE', 'CHOICE', 'BATTLE', 'CHOICE', 'FINAL']);
    // 没有任何两个相邻的 BATTLE / FINAL（不存在「连打两场没有间歇」）
    for (let i = 1; i < kinds.length; i++) {
      const bothBattle = (k: string) => k === 'BATTLE' || k === 'FINAL';
      expect(bothBattle(kinds[i]) && bothBattle(kinds[i - 1]), `节点 ${i - 1}/${i} 不得连续战斗`).toBe(false);
    }
    // 走查里也能看到：每两段之间**只有一个节点**（那就是 Build Choice），没有别的节拍
    const ch = runChain(winnableDraft());
    expect(ch.nodeSeq).toEqual([
      'd1-start',
      'd2-battle1',
      'd2-choice1',
      'd3-battle2',
      'd3-choice2',
      'd4-final',
    ]);
    // 三段战斗只发生在三个 BATTLE/FINAL 节点上（没有额外的战斗节点）
    expect(ch.segments.map((s) => s.nodeId)).toEqual(['d2-battle1', 'd3-battle2', 'd4-final']);
  });
});
