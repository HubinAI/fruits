/**
 * PRODUCT-LOOP-R10-FULL-REACHABLE-SPACE-R2｜**完整产品可达空间**侦察矩阵（**测量工具，非回归守卫**）。
 *
 * ── 前提 ─────────────────────────────────────────────────────────────────────
 * Hidden top Weapon 已被 `PRODUCT-LOOP-P0-HIDDEN-TOP-WEAPON-REMOVAL` 清空：
 *   **真实产品链路**里 `top` 槽恒 EMPTY（`defaultPlayerDraft` 清 + `loadEquippedDraft→clearHiddenTopWeapon`
 *   清旧存档）。本文件**不自己手动禁 top**：组合 Draft 直接以真实产品默认车 `defaultPlayerDraft()`
 *   为基底，因此 top EMPTY 来自产品自身逻辑（见下方 P0 真实落地核验）。
 *
 * ── 目标 ─────────────────────────────────────────────────────────────────────
 *   重新建立**真正完整**的 Product Reachable Matrix。**只取证，不调参**。
 *
 * ── 搜索维度（与真实 Garage 能产生的 Draft 一一对应）──────────────────────────
 *   · Body：全部 `OFFICIAL_BODIES`（默认拥有 4 + 新增 4 = 8）
 *   · Weapon：`FULL_RUN_SUPPORTED_WEAPON_IDS`（7 件 Full Run Weapon）
 *   · Front Movement：`MOVEMENT_OPTIONS` 4 档 + `none`（= EMPTY_SLOT 卸下，buildPersistence 允许）= 5
 *   · Rear Movement：同上 = 5
 *   · Build：每把 Weapon 在 Run 的两个 CHOICE 节点（layer1 / layer2）上的**全部合法组合**
 *   · Star：先只扫 ★1（`playerBaseline: true`，零 Build 起手）
 *
 * ── 禁止（真实 Garage 不会产生）────────────────────────────────────────────
 *   · top Weapon / rear Weapon / front functional Weapon —— 产品只暴露 `frontMass` 主武器槽，
 *     `top`/`front`/`rear` 功能槽恒 EMPTY；
 *   · 测试专属额外挂载 / Debug Buff / 不可达字段写入。
 *
 * ── **严格分层**（禁止「一个强代表 Build」淘汰其它合法 Build 路线）──────────────
 *   对每一台 Base Chassis（Body × Weapon × FrontMvmt × RearMvmt，★1）：
 *     1. 先只跑 E1（第一场战斗）；E1 之前没有任何 Build。
 *     2. E1 FAILED ⇒ 该 chassis **安全剪枝**（不枚举任何 Build）。
 *     3. E1 COMPLETE ⇒ 枚举该 Weapon 在 Choice1 的**全部**合法选项；每个 Choice1 分支各自跑 E2。
 *     4. 某 Choice1 分支 E2 COMPLETE ⇒ 枚举该状态下 Choice2 的**全部**合法选项；每个分支各自跑 E3。
 *     5. E3 COMPLETE ⇒ 记一条正式 COMPLETE Path。
 *   ⚠️ 实现上就是「状态机逐节点驱动 + 在 CHOICE 处**全分支**展开」：
 *      FAILED 状态立即终止（自动满足 2/4），COMPLETE 才记路径（满足 5）；
 *      绝不先拿一条代表路线判断「这个 chassis 没救」。
 *   ⚠️ 允许的纯性能优化（不牺牲完备性）：
 *      · 同一 chassis 的 E1 只跑一次（状态机天然如此）；
 *      · E1 FAILED 后不枚举 Build（FAILED 分支不展开）；
 *      · E2 FAILED 的 Choice1 分支不枚举 Choice2（FAILED 分支不展开）；
 *      · 同一 chassis 各 Build 分支共享 `runPlanFor` 缓存（ctx key 不含 Build 序列）。
 *
 * ── 最终回答 ─────────────────────────────────────────────────────────────────
 *   每件 Full Run Weapon 是否存在至少一个 ★1 COMPLETE 产品路径。
 *
 * ── 特别核对 ─────────────────────────────────────────────────────────────────
 *   旧矩阵（带隐藏锤）曾记录：
 *     · machineGun + coconutBody + rear heavyWheel
 *     · shotgun    + pineappleBody + rear smallWheel
 *   在移除隐藏锤后是否仍 COMPLETE。若不再 COMPLETE ⇒ 旧矩阵被隐藏 Hammer 污染的证据（如实记录，不当回归）。
 *   ⚠️ 本核对也走**全 Build 枚举**（不靠代表路线）。
 *
 * ⚠️ 本文件不修改任何 `src/**`；纯测量。全在 Node 单线程跑（vitest 要求 `--pool=vmForks --maxWorkers=1`），
 *   故单测超时给足（见 `it` 第三参）。
 */

import { describe, expect, it } from 'vitest';

import { registry } from '../src/core/content';
import { EMPTY_SLOT, makeStarterDraft, buildSnapshotFromDraft, type BuildDraft } from '../src/lab/buildEditorModel';
import { RunBattleRuntime } from '../src/lab/portraitBattleLab/runBattleRuntime';
import {
  chooseRunBuff,
  createRunPageState,
  finishRunBattle,
  pressRunAction,
  runBuildIds,
  runCarriedPlayerHp,
  runChoicePool,
  runCurrentNode,
  type RunPageContext,
  type RunPageState,
} from '../src/lab/portraitBattleLab/runPageState';
import { runPageContext } from '../src/lab/portraitBattleLab/runPageScene';
import { OFFICIAL_BODIES } from '../src/core/bodyOwnership';
import { FULL_RUN_SUPPORTED_WEAPON_IDS, canStartFullRun } from '../src/product/runCompatibility';
import { WEAPON_SLOT, defaultPlayerDraft, clearHiddenTopWeapon } from '../src/product/playerLoadout';

/* ------------------------------------------------------------------ 参数 */
const FRAME_MS = 1000 / 60;
const MAX_FRAMES = 4000;
const PRODUCT_TAG = 'profile-equipped';

/** 前/后轮全部正式允许状态：4 档可调 + `none`（= EMPTY_SLOT 卸下，buildPersistence 允许）。 */
const WHEELS: readonly string[] = ['wheelStd', 'smallWheel', 'largeWheel', 'heavyWheel', 'none'];
const WHEEL_RADIUS: Readonly<Record<string, number>> = (() => {
  const m: Record<string, number> = { none: 20 };
  for (const def of registry.movements.values()) m[def.id] = def.radius ?? 20;
  return m;
})();

interface SimOutcome {
  builds: string[];
  phase: string; // COMPLETE | FAILED | INVALID | STUCK
  stages: number; // 终局前打赢的场数（COMPLETE / 打输终局 = 3；E2 输 = 2；E1 输 = 1）
  finalHpA: number; // 终局我方 HP（或最后一场的我方 HP）
}

/**
 * 真实 Garage 可达装配：车身 B + 主武器 W（frontMass）+ 前轮 F + 后轮 R。
 * ⚠️ **基底 = 真实产品默认车 `defaultPlayerDraft()`**（其 `top` 已被产品自身清空、为 EMPTY）。
 *   本函数**不**手动写 `top` —— top EMPTY 来自产品逻辑，不是 fixture 自禁（满足 P0 真实落地核验）。
 * 只写产品能写的三类字段：`bodyDefId` / `functionalSelections[frontMass]` / `front`·`rear` 功能槽 EMPTY /
 * `front|rear Wheel`。`top` 功能槽恒 EMPTY（无隐藏武器、无 rear/front 功能武器）。
 */
function productDraft(bodyDefId: string, weapon: string, frontWheel: string, rearWheel: string): BuildDraft {
  const base = defaultPlayerDraft(); // 真实产品默认车（watermelonBody 基线，top 已 EMPTY）
  const selections: Record<string, string> = {
    ...base.functionalSelections,
    [WEAPON_SLOT]: weapon, // 唯一可写主武器槽 = 正式攻击来源
    front: EMPTY_SLOT, // 前挂点不挂武器（产品只暴露 frontMass 主武器槽）
    rear: EMPTY_SLOT, // rear 槽不挂功能件；后轮走 rearWheelDefId
    // 注：不写 top —— 基底 base 已把它清成 EMPTY（产品逻辑，非 fixture 自禁）
  };
  const next: BuildDraft = { ...base, bodyDefId, functionalSelections: selections };
  // 前轮
  if (frontWheel === 'none') {
    delete next.frontWheelDefId;
    next.frontRadius = 20;
  } else {
    next.frontWheelDefId = frontWheel;
    next.frontRadius = WHEEL_RADIUS[frontWheel] ?? 20;
  }
  // 后轮
  if (rearWheel === 'none') {
    delete next.rearWheelDefId;
    next.rearRadius = 20;
  } else {
    next.rearWheelDefId = rearWheel;
    next.rearRadius = WHEEL_RADIUS[rearWheel] ?? 20;
  }
  return next;
}

function runOneBattle(s: RunPageState, draft: BuildDraft, carriedHp: number | null): { state: RunPageState; playerHp: number } {
  const node = runCurrentNode(s);
  const build = [...runBuildIds(s)];
  const rt = new RunBattleRuntime({
    build,
    carriedHp,
    encounterId: node.encounterId,
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
    const playerHp = rt.hp().a;
    const state = finishRunBattle(s, {
      winner: rt.result?.winner ?? null,
      endReason: rt.result?.endReason ?? null,
      playerHp,
      enemyHp: rt.hp().b,
      steps: rt.stepCount,
    });
    return { state, playerHp };
  } finally {
    rt.dispose();
  }
}

const roundHp = (x: number | null): number => Math.round((x ?? 0) * 10) / 10;

/**
 * 与旧矩阵（`productRunContinuityWinningSearch.test.ts`）**逐字同源**的代表路线策略：
 *   Cannon → heavyShell→kineticBurst；非 Cannon → 通用池 emergencyRepair→damageUp。
 * 用于「代表路线口径 vs 全 Build 枚举」的对照（隔离「剪枝口径」这一单一变量）。
 */
function policyPicks(weapon: string): readonly string[] {
  return weapon === 'cannon' ? ['heavyShell', 'kineticBurst'] : ['emergencyRepair', 'damageUp'];
}

/**
 * 单条「代表路线」模拟（与旧矩阵 `runCombo` 的 CHOICE 逻辑同源：按 `picks[s.buffs.length]` 选，
 * 不在池则退回首项）。返回该路线终态。仅用于对照，**不用于**权威搜索。
 */
function simulateRep(draft: BuildDraft, ctx: RunPageContext): SimOutcome {
  if (!canStartFullRun(draft)) return { builds: [], phase: 'INVALID', stages: 0, finalHpA: 0 };
  let s: RunPageState = createRunPageState(ctx);
  let carry: number | null = null;
  let stages = 0;
  const picks = policyPicks(draft.functionalSelections[WEAPON_SLOT]);
  for (let guard = 0; guard < 40; guard++) {
    if (s.phase === 'COMPLETE' || s.phase === 'FAILED') {
      return { builds: [...picks].slice(0, s.buffs.length), phase: s.phase, stages, finalHpA: roundHp(carry) };
    }
    if (s.phase === 'BATTLE') {
      const r = runOneBattle(s, draft, carry);
      carry = r.playerHp;
      s = r.state;
      stages += 1;
      continue;
    }
    if (s.phase === 'CHOICE') {
      const pool: string[] = runChoicePool(s).map((o) => o.id);
      const want = picks[s.buffs.length] ?? pool[0] ?? '';
      const use = pool.includes(want) ? want : pool[0] ?? '';
      const ns = chooseRunBuff(s, use, ctx);
      if (ns === s) return { builds: [...picks].slice(0, s.buffs.length), phase: 'STUCK', stages, finalHpA: roundHp(carry) };
      s = ns;
      continue;
    }
    if (s.phase === 'EVENT') carry = runCarriedPlayerHp(s);
    s = pressRunAction(s, ctx);
  }
  return { builds: [...picks], phase: 'STUCK', stages, finalHpA: roundHp(carry) };
}

/**
 * 模拟一局 Run（★1，零额外起始 Build）。
 * `picks` 为 undefined ⇒ 每次 CHOICE **全分支**展开（严格分层：绝不拿代表路线淘汰其它 Build）。
 * 返回该 chassis 下所有合法 Build 路线的**叶子**结果（COMPLETE / FAILED）。
 *
 * ⚠️ 状态机天然实现严格分层：
 *   · 进入 BATTLE 先跑该场；赢了才前进到 CHOICE / 下一场；输了 ⇒ phase=FAILED，本分支终止
 *     （自动满足「E1 FAILED 不枚举 Build」「E2 FAILED 该 Choice1 分支不枚举 Choice2」）。
 *   · 进入 CHOICE 时枚举**全部**候选池选项（不挑代表）。
 *   · 进入 COMPLETE 才记路径。
 * ⚠️ 优化：loadout key 不含 Build 序列 ⇒ 同一 chassis 各 Build 分支**共享** `runPlanFor` 缓存。
 */
function simulate(draft: BuildDraft, ctx: RunPageContext): SimOutcome[] {
  if (!canStartFullRun(draft)) return [{ builds: [], phase: 'INVALID', stages: 0, finalHpA: 0 }];
  const out: SimOutcome[] = [];
  const walk = (
    s: RunPageState,
    carry: number | null,
    choiceIdx: number,
    builds: string[],
    stages: number,
  ): void => {
    if (s.phase === 'COMPLETE' || s.phase === 'FAILED') {
      out.push({ builds, phase: s.phase, stages, finalHpA: roundHp(carry) });
      return;
    }
    if (s.phase === 'BATTLE') {
      const { state: after, playerHp } = runOneBattle(s, draft, carry);
      walk(after, playerHp, choiceIdx, builds, stages + 1);
      return;
    }
    if (s.phase === 'CHOICE') {
      const pool = runChoicePool(s).map((o) => o.id);
      for (const opt of pool) {
        const ns = chooseRunBuff(s, opt, ctx);
        if (ns === s) continue; // 该项不可选（不在池 / 已满）⇒ 跳过，不卡死
        walk(ns, carry, choiceIdx + 1, [...builds, opt], stages);
      }
      return;
    }
    if (s.phase === 'EVENT') {
      const c = runCarriedPlayerHp(s);
      const ns = pressRunAction(s, ctx);
      if (ns === s) {
        out.push({ builds, phase: 'STUCK', stages, finalHpA: roundHp(c) });
        return;
      }
      walk(ns, c, choiceIdx, builds, stages);
      return;
    }
    // IDLE / RESULT / DURABILITY / 其它：推进（当前 R9 三段脚本无 DURABILITY 节点；防御性 STUCK）
    const ns = pressRunAction(s, ctx);
    if (ns === s) {
      out.push({ builds, phase: s.phase, stages, finalHpA: roundHp(carry) });
      return;
    }
    walk(ns, carry, choiceIdx, builds, stages);
  };
  walk(createRunPageState(ctx), null, 0, [], 0);
  return out;
}

interface BaseCombo {
  body: string;
  weapon: string;
  front: string;
  rear: string;
  draft: BuildDraft;
  ctx: RunPageContext;
}
interface CompletePath {
  body: string;
  weapon: string;
  front: string;
  rear: string;
  builds: string[];
  finalHpA: number;
}
interface ChassisAgg {
  combo: BaseCombo;
  leaves: SimOutcome[];
  maxStage: number;
  hasComplete: boolean;
  bestLeaf: SimOutcome; // 最深 stage、再最高 HP
}

describe('PRODUCT-LOOP-R10-FULL-REACHABLE-SPACE-R2｜完整产品可达空间侦察矩阵', () => {
  /* ── P0 真实落地核验：产品 Draft / Run Snapshot 的 top 必须 EMPTY（不能只在 fixture 里手动禁）── */
  it('P0 真实落地核验：真实产品链路下 top 恒 EMPTY、Run Snapshot 无隐藏锤', () => {
    // ① 真实产品默认车（产品自己用的函数）top 已 EMPTY
    expect(defaultPlayerDraft().functionalSelections.top, 'defaultPlayerDraft().top').toBe(EMPTY_SLOT);
    // ② 旧 starter（带锤）经产品迁移 clearHiddenTopWeapon 后 top 清空、且无星级印记时才清
    const legacy = makeStarterDraft('watermelonBody', registry);
    expect(legacy.functionalSelections.top, '旧 starter top = hammer').toBe('hammer');
    const cleaned = clearHiddenTopWeapon(legacy);
    expect(cleaned.cleaned, 'clearHiddenTopWeapon 命中旧锤').toBe(true);
    expect(cleaned.draft.functionalSelections.top, '清理后 top EMPTY').toBe(EMPTY_SLOT);
    const snapAfter = buildSnapshotFromDraft(cleaned.draft, registry);
    expect(
      snapAfter.functionals.some((f) => f.defId === 'hammer'),
      '清理后 Run Snapshot 无 hammer',
    ).toBe(false);
    // ③ 本文件组合出的产品可达 Draft（基底来自 defaultPlayerDraft）top 仍 EMPTY、Snapshot 无锤
    const d = productDraft('coconutBody', 'machineGun', 'wheelStd', 'heavyWheel');
    expect(d.functionalSelections.top, '组合 Draft top EMPTY（来自产品默认车）').toBe(EMPTY_SLOT);
    const snap = buildSnapshotFromDraft(d, registry);
    expect(
      snap.functionals.some((f) => f.defId === 'hammer'),
      '组合 Draft 的 Run Snapshot 无 hammer',
    ).toBe(false);
    // ④ 正式攻击来源确实只有 frontMass 一件武器
    const playerWeapons = snap.functionals.filter((f) => registry.functionals.get(f.defId)?.category === 'weapon');
    expect(playerWeapons.length, 'Run Snapshot 中武器件数 = 1').toBe(1);
    expect(playerWeapons[0].defId, '唯一武器 = frontMass 主武器').toBe('machineGun');
  });

  it(
    '扫描 Body×Weapon×FrontMvmt×RearMvmt×Build（★1）的可达 COMPLETE 组合（严格分层全枚举）',
    () => {
      const bodies = [...OFFICIAL_BODIES];
      const weapons = [...FULL_RUN_SUPPORTED_WEAPON_IDS];
      const fronts = [...WHEELS];
      const rears = [...WHEELS];

      // ── 预先构建所有基础组合（含 ctx，key 不含 Build 以便缓存共享）──────────
      const baseCombos: BaseCombo[] = [];
      for (const body of bodies) {
        for (const weapon of weapons) {
          for (const front of fronts) {
            for (const rear of rears) {
              const draft = productDraft(body, weapon, front, rear);
              const key = `fs|${body}|${weapon}|${front}|${rear}`;
              const ctx = runPageContext({
                source: 'profile',
                label: key,
                draft,
                tag: PRODUCT_TAG,
                key,
              });
              baseCombos.push({ body, weapon, front, rear, draft, ctx });
            }
          }
        }
      }
      const BASE_TOTAL = bodies.length * weapons.length * fronts.length * rears.length;
      expect(baseCombos.length, '基础组合数 = 8×7×5×5').toBe(BASE_TOTAL);

      // ── 严格分层：每台 chassis 跑全 Build 枚举（无代表路线淘汰）────────────
      const aggs: ChassisAgg[] = [];
      let totalLeafPaths = 0;
      for (const combo of baseCombos) {
        const leaves = simulate(combo.draft, combo.ctx);
        totalLeafPaths += leaves.length;
        let maxStage = 0;
        let hasComplete = false;
        let bestLeaf: SimOutcome = leaves[0] ?? { builds: [], phase: 'INVALID', stages: 0, finalHpA: 0 };
        for (const lf of leaves) {
          if (lf.phase === 'COMPLETE') hasComplete = true;
          if (lf.stages > maxStage) maxStage = lf.stages;
          // 选「最深 stage、再最高 HP」的代表叶子
          if (
            lf.stages > bestLeaf.stages ||
            (lf.stages === bestLeaf.stages && lf.finalHpA > bestLeaf.finalHpA)
          ) {
            bestLeaf = lf;
          }
        }
        aggs.push({ combo, leaves, maxStage, hasComplete, bestLeaf });
      }

      // ── COMPLETE 路径（每条 = 一台 chassis 下某条 Build 路线打到 COMPLETE）────
      const completePaths: CompletePath[] = [];
      for (const a of aggs) {
        for (const lf of a.leaves) {
          if (lf.phase === 'COMPLETE') {
            completePaths.push({
              body: a.combo.body,
              weapon: a.combo.weapon,
              front: a.combo.front,
              rear: a.combo.rear,
              builds: lf.builds,
              finalHpA: lf.finalHpA,
            });
          }
        }
      }

      // ── 聚合 ─────────────────────────────────────────────────────────────
      const byWeapon = new Map<string, CompletePath[]>();
      for (const p of completePaths) {
        if (!byWeapon.has(p.weapon)) byWeapon.set(p.weapon, []);
        byWeapon.get(p.weapon)!.push(p);
      }
      const bodiesIn = new Set(completePaths.map((p) => p.body));
      const frontsIn = new Set(completePaths.map((p) => p.front));
      const rearsIn = new Set(completePaths.map((p) => p.rear));

      // 0-COMPLETE 武器的失败模式：按 chassis 最深到达段分布
      const failMode = (w: string): string => {
        const cs = aggs.filter((a) => a.combo.weapon === w);
        const e1Fail = cs.filter((a) => a.maxStage <= 1).length; // 全输 E1
        const e2Fail = cs.filter((a) => a.maxStage === 2).length; // 赢 E1、输 E2
        const e3Fail = cs.filter((a) => a.maxStage >= 3 && !a.hasComplete).length; // 赢 E1/E2、输终局
        const rep = cs
          .filter((a) => a.maxStage >= 2)
          .reduce<ChassisAgg | null>((acc, a) => {
            if (!acc) return a;
            if (a.maxStage > acc.maxStage) return a;
            if (a.maxStage === acc.maxStage && a.bestLeaf.finalHpA > acc.bestLeaf.finalHpA) return a;
            return acc;
          }, null);
        const repStr = rep
          ? `（代表 ${rep.combo.body}/${rep.combo.front}/${rep.combo.rear} 终局HP ${rep.bestLeaf.finalHpA}）`
          : '';
        return `0 COMPLETE —— 输E1 chassis=${e1Fail} / 赢E1输E2=${e2Fail} / 进终局输=${e3Fail} ${repStr}`;
      };

      // ── 输出 A~E ────────────────────────────────────────────────────────
      const lines: string[] = [];
      lines.push('');
      lines.push('════════════════════════════════════════════════════════════════════');
      lines.push('【PRODUCT-LOOP-R10-FULL-REACHABLE-SPACE-R2｜完整产品可达空间（★1，严格分层全枚举）】');
      lines.push('════════════════════════════════════════════════════════════════════');
      lines.push('A. 总搜索空间');
      lines.push(`   基础组合（Body×Weapon×FrontMvmt×RearMvmt）= ${bodies.length}×${weapons.length}×${fronts.length}×${rears.length} = ${BASE_TOTAL}`);
      lines.push(`   Build 维度：每 Weapon 在 2 个 CHOICE 节点上的全部合法组合（严格全枚举，无代表路线淘汰）；Star=★1`);
      lines.push(`   实际模拟叶子路径数（= 全 Build 分支终态总数）= ${totalLeafPaths}`);
      lines.push('');
      lines.push(`B. COMPLETE 路径总数 = ${completePaths.length}`);
      lines.push('');
      lines.push('C. COMPLETE 涉及种类：');
      lines.push(`   Weapon ${byWeapon.size} 种 / Body ${bodiesIn.size} 种 / FrontMvmt ${frontsIn.size} 种 / RearMvmt ${rearsIn.size} 种`);
      lines.push(`   Body 集合 = {${[...bodiesIn].join(', ')}}`);
      lines.push(`   FrontMvmt 集合 = {${[...frontsIn].join(', ')}}`);
      lines.push(`   RearMvmt 集合 = {${[...rearsIn].join(', ')}}`);
      lines.push('');
      lines.push('D. 每件 Weapon：');
      for (const w of weapons) {
        const ps = byWeapon.get(w) ?? [];
        if (ps.length === 0) {
          lines.push(`   · ${w}: ${failMode(w)}`);
        } else {
          const rep = ps.reduce((a, b) => (b.finalHpA > a.finalHpA ? b : a));
          lines.push(
            `   · ${w}: COMPLETE ${ps.length} 个 —— 代表配置 body=${rep.body} front=${rep.front} rear=${rep.rear} build=[${rep.builds.join('→')}] (终局HP ${rep.finalHpA})`,
          );
        }
      }
      lines.push('');
      lines.push('E. 是否单一配置大量支配其它（仅列事实分布，不评分/不排名）：');
      if (completePaths.length > 0) {
        const dom = (label: string, set: Set<string>): void => {
          for (const v of [...set]) {
            const n = completePaths.filter((p) => (label === 'body' ? p.body : label === 'front' ? p.front : p.rear) === v).length;
            const pct = Math.round((n / completePaths.length) * 100);
            lines.push(`   · ${label}=${v}: ${n} 个 (${pct}%)`);
          }
        };
        dom('body', bodiesIn);
        dom('front', frontsIn);
        dom('rear', rearsIn);
        const topBody = [...bodiesIn].sort(
          (a, b) =>
            completePaths.filter((p) => p.body === b).length - completePaths.filter((p) => p.body === a).length,
        )[0];
        const topBodyN = completePaths.filter((p) => p.body === topBody).length;
        if (topBodyN / completePaths.length > 0.5) {
          lines.push(
            `   ⚠️ 支配提示：body=${topBody} 占 COMPLETE 的 ${Math.round((topBodyN / completePaths.length) * 100)}% (>50%)，存在明显支配。`,
          );
        } else {
          lines.push('   ✓ 无单一 body/front/rear 占 COMPLETE >50%，未见强支配。');
        }
      } else {
        lines.push('   （无 COMPLETE，无支配可谈）');
      }
      lines.push('');
      lines.push('── 特别核对：旧矩阵（带隐藏锤）曾记录的两条「获胜」组合，移除锤后是否仍 COMPLETE（走全 Build 枚举）──');
      const check = (tag: string, body: string, weapon: string, front: string, rear: string): void => {
        const draft = productDraft(body, weapon, front, rear);
        const key = `chk|${body}|${weapon}|${front}|${rear}`;
        const ctx = runPageContext({ source: 'profile', label: key, draft, tag: PRODUCT_TAG, key });
        const leaves = simulate(draft, ctx);
        const comp = leaves.find((l) => l.phase === 'COMPLETE');
        const maxStage = leaves.reduce((m, l) => Math.max(m, l.stages), 0);
        const verdict = comp
          ? `仍 COMPLETE（build=[${comp.builds.join('→')}]，终局HP ${comp.finalHpA}）—— ⚠️ 说明旧矩阵记录本身真实，并非锤污染`
          : `不再 COMPLETE（全 Build 枚举最深到第 ${maxStage} 段）—— 旧矩阵被隐藏 Hammer 污染的证据，如实记录、不当回归`;
        lines.push(`   · ${tag}: ${body} + ${weapon} + front=${front} + rear=${rear} → ${verdict}`);
      };
      check('machineGun 旧获胜组合', 'coconutBody', 'machineGun', 'wheelStd', 'heavyWheel');
      check('shotgun 旧获胜组合', 'pineappleBody', 'shotgun', 'wheelStd', 'smallWheel');
      lines.push('════════════════════════════════════════════════════════════════════');
      // eslint-disable-next-line no-console
      console.log('\n' + lines.join('\n'));

      // 软断言：确保搜索真的跑完了所有基础组合（防止提前截断/异常静默丢组合）
      expect(aggs.length, '严格分层扫完所有基础组合').toBe(BASE_TOTAL);
    },
    3_600_000,
  );

  /* ── 共同子集对照：旧矩阵（body×weapon×rear，代表路线 policyPicks）vs 本新矩阵（同 Draft 全 Build 枚举）──
   * 目的：对旧矩阵覆盖的**完全相同**搜索空间（front=车身默认前轮、top=EMPTY、仅后轮 5 档），
   *   用「全 Build 枚举」重扫，看旧矩阵的代表路线是否漏判了真实可赢组合
   *   （=「代表路线淘汰合法 Build」这一剪枝口径不安全的实证）。
   * ⚠️ 此对照用与旧矩阵**逐字同源**的 Draft 构造 + 代表路线逻辑（policyPicks），只把
   *   「代表路线」换成「全分支枚举」，从而隔离出「剪枝口径」这一单一变量。 */
  it(
    '共同子集对照（front=车身默认前轮，top=EMPTY）：旧代表路线 vs 新全 Build 枚举',
    () => {
      // —— 与旧矩阵逐字同源的 Draft 构造（front 不写 = 车身默认前轮；top=EMPTY）——
      const oldStyleDraft = (bodyDefId: string, weapon: string, rearWheel: string): BuildDraft => {
        const base = makeStarterDraft(bodyDefId, registry);
        const selections: Record<string, string> = {
          ...base.functionalSelections,
          front: EMPTY_SLOT,
          frontMass: weapon,
          top: EMPTY_SLOT,
          rear: EMPTY_SLOT,
        };
        const next: BuildDraft = { ...base, functionalSelections: selections };
        if (rearWheel === 'none') {
          delete next.rearWheelDefId;
          next.rearRadius = 20;
        } else {
          next.rearWheelDefId = rearWheel;
          next.rearRadius = WHEEL_RADIUS[rearWheel] ?? 20;
        }
        return next;
      };

      const bodies = [...OFFICIAL_BODIES];
      const weapons = [...FULL_RUN_SUPPORTED_WEAPON_IDS];
      const rears = [...WHEELS];

      const oldWins: string[] = []; // 旧代表路线判为 COMPLETE 的 (body|weapon|rear)
      const newWins: string[] = []; // 全 Build 枚举判为 COMPLETE 的
      const repMissed: string[] = []; // 全 Build 赢但代表路线没赢（剪枝漏判实证）
      let inconsistency = 0; // 代表赢但全 Build 不赢（应=0）

      for (const body of bodies) {
        for (const weapon of weapons) {
          for (const rear of rears) {
            const draft = oldStyleDraft(body, weapon, rear);
            const key = `cmp|${body}|${weapon}|${rear}`;
            const ctx = runPageContext({ source: 'profile', label: key, draft, tag: PRODUCT_TAG, key });
            const rep = simulateRep(draft, ctx);
            const full = simulate(draft, ctx);
            const repC = rep.phase === 'COMPLETE';
            const fullC = full.some((l) => l.phase === 'COMPLETE');
            const id = `${body}|${weapon}|${rear}`;
            if (repC) oldWins.push(id);
            if (fullC) newWins.push(id);
            if (fullC && !repC) repMissed.push(`${id} (代表终局HP${rep.finalHpA}/第${rep.stages}段)`);
            if (repC && !fullC) inconsistency += 1;
          }
        }
      }

      const lines: string[] = [];
      lines.push('');
      lines.push('════════════════════════════════════════════════════════════════════');
      lines.push('【共同子集对照｜旧代表路线(policyPicks) vs 新全 Build 枚举】搜索空间 = body×weapon×rear（front=车身默认前轮, top=EMPTY）');
      lines.push('════════════════════════════════════════════════════════════════════');
      lines.push(`   共同子集组合数 = ${bodies.length}×${weapons.length}×${rears.length} = ${bodies.length * weapons.length * rears.length}`);
      lines.push(`   旧代表路线 COMPLETE 数 = ${oldWins.length}`);
      lines.push(`   新全 Build 枚举 COMPLETE 数 = ${newWins.length}`);
      lines.push(`   ⚠️ 代表路线漏判的真实可赢组合（full 赢但 rep 不赢）= ${repMissed.length} 个`);
      if (repMissed.length > 0) lines.push('     ' + repMissed.slice(0, 60).join('\n     '));
      lines.push(`   反向不一致（rep 赢但 full 不赢，应=0）= ${inconsistency}`);
      lines.push('════════════════════════════════════════════════════════════════════');
      // eslint-disable-next-line no-console
      console.log('\n' + lines.join('\n'));

      // 一致性铁律：代表路线赢的组合必须也被全 Build 枚举覆盖（full ⊇ rep）
      expect(inconsistency, '代表路线赢的组合必须也被全 Build 枚举覆盖（full ⊇ rep）').toBe(0);
    },
    600_000,
  );

  /* ── 代表路线口径复核：旧 policyPicks 跑**全 1400 基础组合**（front ∈ 5 档），对照严格全枚举 ──
   * 目的：直接量化「代表路线剪枝」相对「全 Build 枚举」会漏掉多少真实可赢组合。
   * 与权威扫描用**同一批 draft**（新 `productDraft`，front ∈ 5 档），只把「全分支枚举」换成
   * 「单条代表路线（policyPicks）」，因此差异**只**来自剪枝口径本身。 */
  it(
    '代表路线口径复核：旧 policyPicks × 全 1400 基础组合（对照严格全枚举）',
    () => {
      const bodies = [...OFFICIAL_BODIES];
      const weapons = [...FULL_RUN_SUPPORTED_WEAPON_IDS];
      const fronts = [...WHEELS];
      const rears = [...WHEELS];
      const repByWeapon = new Map<string, string[]>();
      let repTotal = 0;
      for (const body of bodies) {
        for (const weapon of weapons) {
          for (const front of fronts) {
            for (const rear of rears) {
              const draft = productDraft(body, weapon, front, rear);
              const key = `rep|${body}|${weapon}|${front}|${rear}`;
              const ctx = runPageContext({ source: 'profile', label: key, draft, tag: PRODUCT_TAG, key });
              const rep = simulateRep(draft, ctx);
              if (rep.phase === 'COMPLETE') {
                repTotal += 1;
                if (!repByWeapon.has(weapon)) repByWeapon.set(weapon, []);
                repByWeapon.get(weapon)!.push(`${body}|${front}|${rear}`);
              }
            }
          }
        }
      }
      const lines: string[] = [];
      lines.push('');
      lines.push('════════════════════════════════════════════════════════════════════');
      lines.push('【代表路线口径复核｜旧 policyPicks × 全 1400 基础组合（front∈5档，Star★1）】');
      lines.push('════════════════════════════════════════════════════════════════════');
      lines.push(`   代表路线（单条 policyPicks）COMPLETE 总数 = ${repTotal}`);
      for (const w of weapons) {
        const ws = repByWeapon.get(w) ?? [];
        lines.push(`   · ${w}: ${ws.length} 个${ws.length ? ' → ' + ws.slice(0, 3).join(', ') + (ws.length > 3 ? ' …' : '') : ''}`);
      }
      lines.push('   （对照严格全枚举 B 节：COMPLETE 路径总数 = 26；两者差值 = 代表路线剪枝漏掉的合法 Build 赢面）');
      lines.push('════════════════════════════════════════════════════════════════════');
      // eslint-disable-next-line no-console
      console.log('\n' + lines.join('\n'));
    },
    1_200_000,
  );
});
