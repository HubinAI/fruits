/**
 * PRODUCT-LOOP-R13-ENCOUNTER-ORDER-MATRIX-R1｜**Encounter 顺序全排列**取证矩阵
 * （**纯测量工具，不是回归守卫**）。
 *
 * ── 本轮只回答一个问题 ───────────────────────────────────────────────────────
 *   「`RangedTurret` **固定作为第三场终局**」这件事，
 *   是否本身把近战配置（hammer / rammer）的**局部弱点**放大成了**整局通关硬门槛**？
 *
 *   连续三轮已证伪三条参数路线（hammer 加 reach / rammer 缩短 restSteps / RangedTurret 开火停后撤），
 *   因此本轮**停止调参数**，只做**顺序因果**取证：
 *
 *     P = ProtoRusher · C = Chaser · R = RangedTurret
 *     6 个顺序：P→C→R（正式）/ P→R→C / C→P→R / C→R→P / R→P→C / R→C→P
 *
 * ── ⚠️ 零 Product Runtime 改动（本文件唯一的「接线」是测试侧 encounterId 注入）──────
 *   正式脚本 `runScript.ts` 的**结构一字未改**：仍然是
 *     EVENT(d1-start) → BATTLE → CHOICE(layer1) → BATTLE → CHOICE(layer2) → FINAL
 *   即「遭遇1 → Choice1 → 遭遇2 → Choice2 → 遭遇3」——**Build 获得时机完全不变**。
 *
 *   本文件复用的驱动方式：
 *     · 状态机 / CHOICE 池 / 跨段 HP 全部走**正式导出函数**（`createRunPageState` /
 *       `pressRunAction` / `runChoicePool` / `chooseRunBuff` / `finishRunBattle`）；
 *     · 唯一替换：跑第 n 场战斗时，把 `RunBattleRuntime` 的 `encounterId` 由「脚本节点自带的
 *       那个」换成**本排列第 n 位**的那个 id。
 *     ⇒ 正式 `runScript.ts` **不在本文件的作用域内**（既不改也不 mock），
 *       `d2-battle1/d3-battle2/d4-final` 三个节点的 `encounterId` 保持 ProtoRusher/Chaser/RangedTurret。
 *
 *   ⚠️ 为什么合法：`finishRunBattle` 判定「终局 ⇒ RUN COMPLETE」读的是**节点 kind === 'FINAL'**，
 *      与 `encounterId` 无关（`runPageState.ts:763`）⇒ 换遭遇身份不会改变「第几场是终局」的语义。
 *      因此「只换 Encounter 顺序，不改 Build 获得时机」在结构上成立。
 *
 * ── 判据（Queue 原文）────────────────────────────────────────────────────────
 *   判据 1：hammer/rammer 在 R 放到 E1/E2 后出现 COMPLETE，而 R 在 E3 时恒 0
 *           ⇒ 「固定终局顺序放大克制关系」得到支持（**但仍不得改正式关卡**）。
 *   判据 2：6 顺序全部 0 COMPLETE 且失败模式基本一致 ⇒ 主因仍是 weapon/enemy matchup。
 *   判据 3：若换顺序后结果变化，必须区分「R 更早 ⇒ 玩家 HP 更高」/「R 更早 ⇒ Build 更少」/
 *           「前序敌人改变了车体与 HP」/「终局 matchup 本身完全相同」——
 *           本文件用 **§E matchup 一致性**（同 chassis + 同 encounter + 同 entryHP + 同 Build
 *           ⇒ 同结果）把「终局 matchup 完全相同」这一条**机器钉死**，不给「换顺序后赢了」
 *           这种无因果的结论留空间。
 *
 * ── 第二阶段｜控制组（`ALL_WEAPONS` 里的 machineGun / laser）──────────────────
 *   hammer / rammer 的**终局计数**对顺序不敏感（6 顺序全 0 COMPLETE），但**失败剖面**敏感
 *   （「进终局人数」92 / 0 / 67 / 0 / 0 / 0）⇒ 按 Queue「顺序敏感」口径触发控制组。
 *   这两件武器是唯一在正式顺序下**本来就有 COMPLETE**（R10 台账 machineGun=4 / laser=1）的对照，
 *   因此也是唯一能让「R 固定终局是否是**结构性代价**」被真正测到的样本。
 *   ⚠️ 四把武器共用**同一套 harness / 同一批 chassis / 同一口径**，只有武器 id 不同。
 *
 * ── 口径与禁止（与 R10 权威矩阵完全同源）──────────────────────────────────────
 *   · Draft = **正式 Product 可达**：`defaultPlayerDraft()` 为基底（top 已被产品自身清空）+
 *     body + `frontMass` 唯一主武器 + 前/后轮（4 档 + `none`）；`top`/`front`/`rear` 功能槽恒 EMPTY。
 *   · 禁止：hidden top weapon / Debug Buff / 不可达挂点 / 测试专属属性 / 任何参数修改。
 *   · Build = 两个 CHOICE 节点上的**全部合法组合**（严格分层全枚举，无代表路线淘汰）。
 *   · Star = ★1（`playerBaseline: true`，零 Build 起手）。
 *   · 战斗判据 = 真实运行时（引擎接触 / 真实 damage 事件），不是几何估算。
 *
 * ⚠️ 本文件不修改任何 `src/**`；纯测量。全在 Node 单线程跑（`--pool=vmForks --maxWorkers=1`），
 *   故单测超时给足（见各 `it` 第三参）。
 */

import { describe, expect, it } from 'vitest';

import { registry } from '../src/core/content';
import { EMPTY_SLOT, buildSnapshotFromDraft, type BuildDraft } from '../src/lab/buildEditorModel';
import { RunBattleRuntime } from '../src/lab/portraitBattleLab/runBattleRuntime';
import {
  chooseRunBuff,
  createRunPageState,
  finishRunBattle,
  pressRunAction,
  runCarriedPlayerHp,
  runChoicePool,
  type RunPageContext,
  type RunPageState,
} from '../src/lab/portraitBattleLab/runPageState';
import { runPageContext } from '../src/lab/portraitBattleLab/runPageScene';
import type { RunBuildId } from '../src/lab/portraitBattleLab/runModifiers';
import { OFFICIAL_BODIES } from '../src/core/bodyOwnership';
import { canStartFullRun } from '../src/product/runCompatibility';
import { WEAPON_SLOT, defaultPlayerDraft } from '../src/product/playerLoadout';

/* ================================================================== 参数 */

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

/** 三个正式 Encounter（id 与 `testData.LAB_ENCOUNTERS` / 正式脚本引用一致）。 */
type EncId = 'ProtoRusher' | 'Chaser' | 'RangedTurret';
const ENCOUNTERS: readonly EncId[] = ['ProtoRusher', 'Chaser', 'RangedTurret'];
const SHORT: Readonly<Record<EncId, string>> = { ProtoRusher: 'P', Chaser: 'C', RangedTurret: 'R' };

/** 6 个全排列（显式列出，顺序即报告顺序；首项 = 当前正式顺序）。 */
const ORDERS: readonly (readonly [EncId, EncId, EncId])[] = [
  ['ProtoRusher', 'Chaser', 'RangedTurret'], // P→C→R  ← 当前正式顺序
  ['ProtoRusher', 'RangedTurret', 'Chaser'], // P→R→C
  ['Chaser', 'ProtoRusher', 'RangedTurret'], // C→P→R
  ['Chaser', 'RangedTurret', 'ProtoRusher'], // C→R→P
  ['RangedTurret', 'ProtoRusher', 'Chaser'], // R→P→C
  ['RangedTurret', 'Chaser', 'ProtoRusher'], // R→C→P
];

const orderLabel = (o: readonly EncId[]): string => o.map((e) => SHORT[e]).join('→');

const round1 = (x: number): number => Math.round(x * 10) / 10;

/* ------------------------------------------------ 正式 Product 可达 Draft */

/**
 * 真实 Garage 可达装配：车身 B + 主武器 W（frontMass）+ 前轮 F + 后轮 R。
 *
 * ⚠️ 与 `productRunFullReachableSpaceR10.test.ts` 的 `productDraft()` **逐字节同源**：
 *   基底 = 真实产品默认车 `defaultPlayerDraft()`（其 `top` 已由产品自身清空），
 *   本函数**不**手动写 `top`；`front`/`rear` 功能槽固定 EMPTY（产品只暴露 frontMass 主武器槽）。
 */
function productDraft(bodyDefId: string, weapon: string, frontWheel: string, rearWheel: string): BuildDraft {
  const base = defaultPlayerDraft();
  const selections: Record<string, string> = {
    ...base.functionalSelections,
    [WEAPON_SLOT]: weapon,
    front: EMPTY_SLOT,
    rear: EMPTY_SLOT,
  };
  const next: BuildDraft = { ...base, bodyDefId, functionalSelections: selections };
  if (frontWheel === 'none') {
    delete next.frontWheelDefId;
    next.frontRadius = 20;
  } else {
    next.frontWheelDefId = frontWheel;
    next.frontRadius = WHEEL_RADIUS[frontWheel] ?? 20;
  }
  if (rearWheel === 'none') {
    delete next.rearWheelDefId;
    next.rearRadius = 20;
  } else {
    next.rearWheelDefId = rearWheel;
    next.rearRadius = WHEEL_RADIUS[rearWheel] ?? 20;
  }
  return next;
}

/* ------------------------------------------------------------ 单场战斗取证 */

interface BattleRecord {
  /** 0/1/2 = 第 1/2/3 场（= 排列里的位置）。 */
  stage: number;
  encounterId: EncId;
  /** 玩家**进入**本场时的 HP（= 上一场真实剩余，首场 = 本局满血）。 */
  entryHp: number;
  /** 玩家**结束**本场时的 HP（真实值，未取整参与后续 carry）。 */
  exitHp: number;
  enemyHp: number;
  enemyHpMax: number;
  /** 玩家 frontMass 武器真实命中次数（`playerWeaponHitSummary()` 按 partId 归组的**真实** damage 事件）。 */
  hits: number;
  /** 玩家武器造成**总伤害**（同上，真实 damage 之和）。 */
  dealt: number;
  /** 首次有效命中时刻（ms）；无命中 = null。 */
  firstHitMs: number | null;
  /** core 口径最小间距（仅声明 `enemyDrive` 的对手 = `RangedTurret` 有值；其余 null）。 */
  minGapCore: number | null;
  winner: string | null;
  endReason: string | null;
  steps: number;
  /** 本场生效的 Build 指纹（§E matchup 一致性 key 的一部分）。 */
  builds: string;
}

interface RawBattle {
  outcome: { winner: string | null; endReason: string | null; playerHp: number; enemyHp: number; steps: number };
  record: BattleRecord;
}

/**
 * 跑**一场**正式战斗，encounter 由调用方显式指定（这就是本 Queue 的全部「接线」）。
 *
 * 取证源全部是运行时**真实**读数：
 *   · 命中 / 伤害 = `playerWeaponHitSummary()`（按 partId 归组的真实 damage 事件）；
 *   · 首次命中时刻 = `onCombatEvent`（`source==='A' && damageSource==='weapon'`）；
 *   · minGap(core) = `enemyDriveState()` 的决策读到的 core 间距（只有 keep-distance 对手有）。
 */
function runBattleRaw(
  draft: BuildDraft,
  carriedHp: number | null,
  builds: readonly RunBuildId[],
  encounterId: EncId,
  stage: number,
): RawBattle {
  const rt = new RunBattleRuntime({
    build: builds,
    carriedHp,
    encounterId,
    playerDraft: draft,
    playerLoadoutTag: PRODUCT_TAG,
    playerBaseline: true,
  });
  let frames = 0;
  let firstHitMs: number | null = null;
  let minGapCore = Infinity;
  const entryHp = carriedHp ?? rt.initialPlayerHp;
  const unsub = rt.orchestrator.onCombatEvent((ev) => {
    if (ev.type !== 'damage') return;
    if (ev.source !== 'A' || ev.damageSource !== 'weapon') return;
    if (firstHitMs === null) firstHitMs = frames * FRAME_MS;
  });
  try {
    while (rt.result === null && frames < MAX_FRAMES) {
      rt.step(FRAME_MS);
      frames += 1;
      const st = rt.enemyDriveState();
      if (st && st.gap < minGapCore) minGapCore = st.gap;
    }
    const hp = rt.hp();
    let hits = 0;
    let dealt = 0;
    const summary = rt.playerWeaponHitSummary();
    for (const k of Object.keys(summary)) {
      hits += summary[k].count;
      dealt += summary[k].damages.reduce((a, b) => a + b, 0);
    }
    const outcome = {
      winner: rt.result?.winner ?? null,
      endReason: rt.result?.endReason ?? null,
      playerHp: hp.a,
      enemyHp: hp.b,
      steps: rt.stepCount,
    };
    const record: BattleRecord = {
      stage,
      encounterId,
      entryHp: round1(entryHp),
      exitHp: round1(hp.a),
      enemyHp: round1(hp.b),
      enemyHpMax: round1(hp.bMax),
      hits,
      dealt: round1(dealt),
      firstHitMs: firstHitMs === null ? null : round1(firstHitMs),
      minGapCore: minGapCore === Infinity ? null : round1(minGapCore),
      winner: outcome.winner,
      endReason: outcome.endReason,
      steps: outcome.steps,
      builds: builds.join('+'),
    };
    return { outcome, record };
  } finally {
    unsub();
    rt.dispose();
  }
}

/* --------------------------------------------------------------- 状态机驱动 */

interface LeafOutcome {
  builds: RunBuildId[];
  phase: string;
  stages: number;
  finalHpA: number;
  records: BattleRecord[];
}

/**
 * 模拟一局 Run（★1，零额外起始 Build），遭遇顺序 = `order`。
 *
 * ⚠️ 与 R10 权威矩阵的 `simulate()` **同一套严格分层**：CHOICE 处**全分支**展开，
 *   FAILED 分支不展开，COMPLETE 才记路径。唯一差别 = BATTLE 分支的 encounterId 取自 `order[stages]`。
 *
 * ⚠️ E1 缓存：第 1 场（carry=null 且 builds=[]）只取决于 (chassis, encounterId) —— 与它排在第几位无关
 *   ⇒ 6 个顺序里同一个 (chassis, encounter) 的 E1 只跑一次（3 次而非 6 次），**不改变任何结果**。
 */
function simulateOrder(
  draft: BuildDraft,
  ctx: RunPageContext,
  order: readonly EncId[],
  chassisKey: string,
  e1Cache: Map<string, RawBattle>,
): LeafOutcome[] {
  if (!canStartFullRun(draft)) return [{ builds: [], phase: 'INVALID', stages: 0, finalHpA: 0, records: [] }];
  const out: LeafOutcome[] = [];
  const walk = (s: RunPageState, carry: number | null, builds: RunBuildId[], stages: number, recs: BattleRecord[]): void => {
    if (s.phase === 'COMPLETE' || s.phase === 'FAILED') {
      out.push({ builds, phase: s.phase, stages, finalHpA: round1(carry ?? 0), records: recs });
      return;
    }
    if (s.phase === 'BATTLE') {
      const encId = order[stages];
      const cacheKey = `${chassisKey}|${encId}`;
      const isE1 = carry === null && builds.length === 0;
      let raw = isE1 ? e1Cache.get(cacheKey) : undefined;
      if (!raw) {
        raw = runBattleRaw(draft, carry, builds, encId, stages);
        if (isE1) e1Cache.set(cacheKey, raw);
      }
      const after = finishRunBattle(s, {
        winner: raw.outcome.winner,
        endReason: raw.outcome.endReason,
        playerHp: raw.outcome.playerHp,
        enemyHp: raw.outcome.enemyHp,
        steps: raw.outcome.steps,
      });
      walk(after, raw.outcome.playerHp, builds, stages + 1, [...recs, raw.record]);
      return;
    }
    if (s.phase === 'CHOICE') {
      const pool = runChoicePool(s).map((o) => o.id);
      for (const opt of pool) {
        const ns = chooseRunBuff(s, opt, ctx);
        if (ns === s) continue;
        walk(ns, carry, [...builds, opt], stages, recs);
      }
      return;
    }
    if (s.phase === 'EVENT') {
      /* ⚠️ 跨段耐久必须走**正式函数** `runCarriedPlayerHp(s)`：
       *   = `min(maxHp, 上一场真实剩余 HP + 本局 repairBonus)`。
       *   `repairBonus` 是 `emergencyRepair` 这条 Build 的效果 —— 若只传「原始剩余 HP」，
       *   会**静默丢掉维修补偿**，系统性低估存活（首轮实测：machineGun 4 → 2、laser 1 → 0）。
       *   与 `productRunFullReachableSpaceR10.test.ts` 的 `simulate()` 逐字节同源。 */
      const c = runCarriedPlayerHp(s);
      const ns = pressRunAction(s, ctx);
      if (ns === s) {
        out.push({ builds, phase: 'STUCK', stages, finalHpA: round1(c ?? 0), records: recs });
        return;
      }
      walk(ns, c, builds, stages, recs);
      return;
    }
    const ns = pressRunAction(s, ctx);
    if (ns === s) {
      out.push({ builds, phase: s.phase, stages, finalHpA: round1(carry ?? 0), records: recs });
      return;
    }
    walk(ns, carry, builds, stages, recs);
  };
  walk(createRunPageState(ctx), null, [], 0, []);
  return out;
}

/* ------------------------------------------------------------------ 聚合 */

interface OrderResult {
  order: readonly EncId[];
  label: string;
  completePaths: number;
  uniqueChassis: number;
  /** chassis 最深到达段分布（0 COMPLETE 时的失败模式）。 */
  failE1: number;
  failE2: number;
  failE3: number;
  /** 代表路线（最深 stage → 最高 HP）的逐场记录。 */
  rep: { body: string; front: string; rear: string; builds: string[]; stages: number; finalHpA: number; records: BattleRecord[] } | null;
  /** 全部「打到过 RangedTurret」的叶子中，那一场的记录（每叶子最多 1 条）。 */
  ranged: BattleRecord[];
  /** 该顺序下每条叶子的 encounter 序列（用于证明排列真的生效）。 */
  sequences: string[];
  leafTotal: number;
}

interface WeaponMatrix {
  weapon: string;
  orders: OrderResult[];
  totalChassis: number;
  /** §E matchup 一致性违规（应为空）。 */
  inconsistencies: string[];
}

function scanWeapon(weapon: string, bodies: readonly string[]): WeaponMatrix {
  const fronts = [...WHEELS];
  const rears = [...WHEELS];

  // ── 基础 chassis（真实 Garage 可达 Draft + ctx）────────────────────────
  const chassis: { key: string; body: string; front: string; rear: string; draft: BuildDraft; ctx: RunPageContext }[] = [];
  for (const body of bodies) {
    for (const front of fronts) {
      for (const rear of rears) {
        const draft = productDraft(body, weapon, front, rear);
        const key = `fs|${body}|${weapon}|${front}|${rear}`;
        const ctx = runPageContext({ source: 'profile', label: key, draft, tag: PRODUCT_TAG, key });
        chassis.push({ key, body, front, rear, draft, ctx });
      }
    }
  }

  const e1Cache = new Map<string, RawBattle>();
  const results: OrderResult[] = [];
  /**
   * §E matchup 一致性表：key = `chassis|encounter|entryHp|builds`
   *   ⇒ value = 本场真实结果签名。
   * 同一把 key 若在不同 Encounter 顺序里给出不同签名 ⇒ 「终局 matchup 本身完全相同」不成立
   *   （说明差异来自别的东西，或测量不自洽）⇒ 记进 `inconsistencies`，测试红。
   * ⚠️ 这条不变量正是 Queue 判据 3-D 的机器转写。
   */
  const matchup = new Map<string, string>();
  const inconsistencies: string[] = [];

  for (const order of ORDERS) {
    const label = orderLabel(order);
    const completePaths: CompletePath[] = [];
    const withComplete = new Set<string>();
    let failE1 = 0;
    let failE2 = 0;
    let failE3 = 0;
    let bestDeep: { c: (typeof chassis)[number]; leaf: LeafOutcome } | null = null;
    const ranged: BattleRecord[] = [];
    const sequences: string[] = [];
    let leafTotal = 0;

    for (const c of chassis) {
      const leaves = simulateOrder(c.draft, c.ctx, order, c.key, e1Cache);
      leafTotal += leaves.length;
      let maxStage = 0;
      let hasComplete = false;
      for (const lf of leaves) {
        sequences.push(lf.records.map((r) => SHORT[r.encounterId]).join(''));
        if (lf.phase === 'COMPLETE') {
          hasComplete = true;
          completePaths.push({ body: c.body, front: c.front, rear: c.rear, builds: lf.builds, finalHpA: lf.finalHpA });
          withComplete.add(c.key);
        }
        if (lf.stages > maxStage) maxStage = lf.stages;
        for (const r of lf.records) {
          // 打到过 RangedTurret ⇒ 收集那一场（用于 §D 位置对照）
          if (r.encounterId === 'RangedTurret') ranged.push(r);
          // §E matchup 一致性（与「排在第几场」无关）
          const mk = `${c.key}|${r.encounterId}|${r.entryHp}|${r.builds}`;
          const sig = `winner=${r.winner};exit=${r.exitHp};enemy=${r.enemyHp};hits=${r.hits};dealt=${r.dealt};steps=${r.steps}`;
          const prev = matchup.get(mk);
          if (prev === undefined) matchup.set(mk, sig);
          else if (prev !== sig && inconsistencies.length < 12) {
            inconsistencies.push(`${mk} ⇒ 第一次 ${prev} / 本次（${label}） ${sig}`);
          }
        }
        // 代表路线：最深 stage → 最高 HP
        if (!bestDeep || lf.stages > bestDeep.leaf.stages || (lf.stages === bestDeep.leaf.stages && lf.finalHpA > bestDeep.leaf.finalHpA)) {
          bestDeep = { c, leaf: lf };
        }
      }
      if (maxStage <= 1) failE1 += 1;
      else if (maxStage === 2) failE2 += 1;
      else if (!hasComplete) failE3 += 1;
    }

    results.push({
      order,
      label,
      completePaths: completePaths.length,
      uniqueChassis: withComplete.size,
      failE1,
      failE2,
      failE3,
      rep: bestDeep
        ? {
            body: bestDeep.c.body,
            front: bestDeep.c.front,
            rear: bestDeep.c.rear,
            builds: bestDeep.leaf.builds,
            stages: bestDeep.leaf.stages,
            finalHpA: bestDeep.leaf.finalHpA,
            records: bestDeep.leaf.records,
          }
        : null,
      ranged,
      sequences,
      leafTotal,
    });
  }

  return {
    weapon,
    orders: results,
    totalChassis: chassis.length,
    inconsistencies,
  };
}

interface CompletePath {
  body: string;
  front: string;
  rear: string;
  builds: string[];
  finalHpA: number;
}

/* ================================================================== 测试 */

/** 模块级结果槽（`it` 按声明顺序执行，最后一次 `it` 汇总 A–F）。 */
const R13: Record<string, WeaponMatrix | null> = { hammer: null, rammer: null, machineGun: null, laser: null };

const ORDER_TIMEOUT = 7_200_000;

/**
 * 一把武器跑完 6 顺序矩阵的**共用断言**（四把武器共用，零重复）。
 *
 * `canonicalChassis` = 正式顺序 `P→C→R` 下该武器在 **R10 权威矩阵**里的唯一 COMPLETE chassis 数
 * （来源 `tests/productRunFullReachableSpaceR10.test.ts` 的 `R11_CURRENT_WEAPON_CHASSIS`，
 * = 当前 HEAD 权威读数）。这是**跨工具交叉核对**（本文件与 R10 是两套独立代码、同一口径）：
 * 若两套口径不一致，本断言立刻红 —— 不硬编码数字迎合，而是用既有权威标定新工具。
 */
function runWeaponMatrixIt(weapon: string, canonicalChassis: number): WeaponMatrix {
  const m = scanWeapon(weapon, OFFICIAL_BODIES);
  R13[weapon] = m;

  // ⚠️ 先打印再断言：即便交叉核对失败，矩阵也必须已经在日志里可读（不让人盲调）。
  console.log(printWeaponMatrix(m).join('\n'));

  // 结构不变量：每个顺序的每条叶子，遭遇序列必须**恰好等于**该顺序的前缀
  //   （这就是「排列真的生效、且没有串场」的机器证明）
  for (const o of m.orders) {
    const expected = o.order.map((e) => SHORT[e]).join('');
    for (const seq of o.sequences) {
      expect(expected.slice(0, seq.length), `${o.label} 叶子遭遇序列 ${seq} 必须等于该顺序前缀`).toBe(seq);
    }
  }
  expect(m.orders.length, '顺序数 = 6').toBe(6);
  expect(m.totalChassis, 'chassis 数 = 8×5×5').toBe(OFFICIAL_BODIES.length * 25);
  // §E matchup 一致性：同一 (chassis, encounter, entryHp, Build) 的结果处处一致
  expect(m.inconsistencies, '§E matchup 一致性违规（应为空）').toEqual([]);
  expect(m.orders[0].label, '首项 = 正式顺序 P→C→R').toBe('P→C→R');
  expect(
    m.orders[0].uniqueChassis,
    `交叉核对：正式顺序下 ${weapon} 的唯一 COMPLETE chassis 必须等于 R10 权威台账 ${canonicalChassis}`,
  ).toBe(canonicalChassis);
  return m;
}

/** 汇总用的四把武器（2 个重点 + 2 个控制组）。 */
const ALL_WEAPONS: readonly string[] = ['hammer', 'rammer', 'machineGun', 'laser'];

function printWeaponMatrix(m: WeaponMatrix): string[] {
  const lines: string[] = [];
  lines.push('');
  lines.push('════════════════════════════════════════════════════════════════════');
  lines.push(`【R13｜${m.weapon} × 6 Encounter 顺序】chassis = ${m.totalChassis}（8 Body × 1 Weapon × 5 Front × 5 Rear，★1 全 Build 枚举）`);
  lines.push('════════════════════════════════════════════════════════════════════');
  lines.push('  顺序       COMPLETE路径  唯一chassis  输E1/赢E1输E2/进终局输   叶子数');
  for (const o of m.orders) {
    lines.push(
      `  ${o.label.padEnd(9)} ${String(o.completePaths).padStart(6)}      ${String(o.uniqueChassis).padStart(6)}      ` +
        `${String(o.failE1).padStart(3)}/${String(o.failE2).padStart(3)}/${String(o.failE3).padStart(3)}` +
        `            ${String(o.leafTotal).padStart(6)}`,
    );
  }
  lines.push('');
  for (const o of m.orders) {
    if (!o.rep) continue;
    lines.push(`  ── 代表路线 [${o.label}] ${o.rep.body}/${o.rep.front}/${o.rep.rear} build=[${o.rep.builds.join('→') || '（无）'}] 最深段=${o.rep.stages} 终局HP=${o.rep.finalHpA}`);
    if (o.rep.records.length === 0) {
      lines.push('      （第 1 场即失败 / 未进入战斗）');
    }
    for (const r of o.rep.records) {
      lines.push(
        `     场${r.stage + 1} ${r.encounterId.padEnd(12)} 进${String(r.entryHp).padStart(7)} → 出${String(r.exitHp).padStart(7)}` +
          ` · 敌${r.enemyHp}/${r.enemyHpMax}` +
          ` · 命中 ${r.hits}发/${r.dealt}伤（首次 ${r.firstHitMs ?? '-'}ms）` +
          ` · minGap=${r.minGapCore ?? '-'}` +
          ` · winner=${r.winner ?? '-'} endReason=${r.endReason ?? '-'} 步=${r.steps}`,
      );
    }
  }
  return lines;
}

describe('PRODUCT-LOOP-R13-ENCOUNTER-ORDER-MATRIX-R1｜Encounter 顺序全排列取证', () => {
  /* ── R13-00：产品可达性 + 排列自检（廉价前置，先红先停）────────────────── */
  it('R13-00 前置：6 顺序是 ENCOUNTERS 的全排列；组合 Draft 全部产品可达（top 恒 EMPTY、武器唯一）', () => {
    // ① 6 个顺序 = 全排列且互不相同
    const keys = ORDERS.map((o) => o.join('>'));
    expect(new Set(keys).size, '6 个顺序互不相同').toBe(6);
    for (const o of ORDERS) {
      expect(new Set(o).size, `${orderLabel(o)} 是三个不同 Encounter`).toBe(3);
      expect([...o].sort().join(','), `${orderLabel(o)} 恰好是 {P,C,R}`).toBe([...ENCOUNTERS].sort().join(','));
    }
    expect(ORDERS[0].join('>'), '首个顺序 = 当前正式顺序 P→C→R').toBe('ProtoRusher>Chaser>RangedTurret');

    // ② 组合 Draft 全部产品可达：top/front/rear 功能槽恒 EMPTY、Run Snapshot 武器数恒 = 1
    let checked = 0;
    for (const weapon of ALL_WEAPONS) {
      for (const body of OFFICIAL_BODIES) {
        for (const front of WHEELS) {
          for (const rear of WHEELS) {
            const d = productDraft(body, weapon, front, rear);
            expect(d.functionalSelections.top, `${body}/${weapon}/${front}/${rear} top EMPTY`).toBe(EMPTY_SLOT);
            expect(d.functionalSelections.front, 'front 槽 EMPTY').toBe(EMPTY_SLOT);
            expect(d.functionalSelections.rear, 'rear 槽 EMPTY').toBe(EMPTY_SLOT);
            expect(d.functionalSelections[WEAPON_SLOT], '主武器槽 = 本武器').toBe(weapon);
            const snap = buildSnapshotFromDraft(d, registry);
            const wpns = snap.functionals.filter((f) => registry.functionals.get(f.defId)?.category === 'weapon');
            expect(wpns.length, 'Run Snapshot 武器件数 = 1（无 hidden top weapon）').toBe(1);
            expect(wpns[0].defId, '唯一武器 = frontMass 主武器').toBe(weapon);
            checked += 1;
          }
        }
      }
    }
    expect(checked, '组合数 = 4 武器 × 8 Body × 5 Front × 5 Rear').toBe(ALL_WEAPONS.length * OFFICIAL_BODIES.length * 25);
  });

  it(
    'R13-A｜Hammer × 6 顺序矩阵（Body × Front × Rear，★1 全 Build 枚举）',
    () => {
      runWeaponMatrixIt('hammer', 0);
    },
    ORDER_TIMEOUT,
  );

  it(
    'R13-B｜Rammer × 6 顺序矩阵（Body × Front × Rear，★1 全 Build 枚举）',
    () => {
      runWeaponMatrixIt('rammer', 0);
    },
    ORDER_TIMEOUT,
  );

  /* ── 第二阶段｜控制组：machineGun / laser（能否赢下 RangedTurret 的武器）────
   * 目的（Queue 原文）：确认「顺序变化」不是简单让所有 Weapon 统一变容易 / 变难。
   * ⚠️ 触发说明：hammer / rammer 的**终局计数**对顺序不敏感（6 顺序全 0），
   *    但其**失败剖面**敏感（进终局人数 92/0/67/0/0/0）⇒ 按 Queue「顺序敏感」口径触发控制组；
   *    这两件武器在正式顺序下**本来就有 COMPLETE**（R10 台账 machineGun=2 / laser=1），
   *    是唯一能让「R 固定终局是否结构性代价」这件事被真正测到的对照组。 */
  it(
    'R13-C1｜控制组 machineGun × 6 顺序（同一 harness，摘要）',
    () => {
      runWeaponMatrixIt('machineGun', 4);
    },
    ORDER_TIMEOUT,
  );

  it(
    'R13-C2｜控制组 laser × 6 顺序（同一 harness，摘要）',
    () => {
      runWeaponMatrixIt('laser', 1);
    },
    ORDER_TIMEOUT,
  );
  it('R13-D/E/F｜RangedTurret 位置效应对照 + 跨武器顺序效应 + 最终判断', () => {
    const all = ALL_WEAPONS.map((w) => {
      const m = R13[w];
      expect(m, `${w} 矩阵已产出`).not.toBeNull();
      return m!;
    });

    const lines: string[] = [];
    lines.push('');
    lines.push('════════════════════════════════════════════════════════════════════');
    lines.push('【R13｜D：RangedTurret 位于第 1/2/3 场时的关键差异】');
    lines.push('════════════════════════════════════════════════════════════════════');
    const avg = (a: number[]): number => (a.length ? round1(a.reduce((x, y) => x + y, 0) / a.length) : 0);
    for (const m of all) {
      lines.push(`── ${m.weapon}`);
      for (let pos = 0; pos < 3; pos++) {
        const rs = m.orders.filter((o) => o.order.indexOf('RangedTurret') === pos).flatMap((o) => o.ranged);
        if (rs.length === 0) {
          lines.push(`   R 在第 ${pos + 1} 场：无叶子打到过该场`);
          continue;
        }
        const entryHp = rs.map((r) => r.entryHp);
        const minGap = rs.map((r) => r.minGapCore).filter((x): x is number => x !== null);
        const hits = rs.map((r) => r.hits);
        const wins = rs.filter((r) => r.winner === 'A').length;
        const buildCount = rs.map((r) => (r.builds === '' ? 0 : r.builds.split('+').length));
        lines.push(
          `   R 在第 ${pos + 1} 场（E${pos + 1}）：样本 ${rs.length} · 进入HP 均${avg(entryHp)}（min ${Math.min(...entryHp)} / max ${Math.max(...entryHp)}）` +
            ` · 携带 Build 均 ${avg(buildCount)} 件` +
            ` · 命中数 均${avg(hits)}（max ${Math.max(...hits)}）` +
            ` · minGap ${minGap.length ? `均${avg(minGap)} / 最小 ${Math.min(...minGap)}` : '—'}` +
            ` · 该场胜率 ${round1((wins / rs.length) * 100)}%`,
        );
      }
    }

    // ── 跨武器顺序效应总表 ────────────────────────────────────────────────
    lines.push('');
    lines.push('════════════════════════════════════════════════════════════════════');
    lines.push('【R13｜跨武器：各顺序 COMPLETE Path / 唯一 Chassis（C = 控制组）】');
    lines.push('════════════════════════════════════════════════════════════════════');
    lines.push(`   ${'武器'.padEnd(12)}${ORDERS.map((o) => orderLabel(o).padStart(11)).join('')}`);
    for (const m of all) {
      const tag = m.weapon === 'machineGun' || m.weapon === 'laser' ? ' (C)' : '';
      lines.push(
        `   ${(m.weapon + tag).padEnd(12)}` +
          m.orders.map((o) => `${o.completePaths}/${o.uniqueChassis}`.padStart(11)).join(''),
      );
    }

    // ── 最终判断（三选一，按 Queue 判据机械归因）──────────────────────────
    lines.push('');
    lines.push('════════════════════════════════════════════════════════════════════');
    lines.push('【R13｜E：最终判断（逐武器）】');
    lines.push('════════════════════════════════════════════════════════════════════');
    for (const m of all) {
      const canonical = m.orders[0].completePaths;
      const nonCanon = m.orders.filter((o) => o.label !== 'P→C→R').reduce((a, o) => a + o.completePaths, 0);
      const total = canonical + nonCanon;
      const rFirst = m.orders.filter((o) => o.order[0] === 'RangedTurret').reduce((a, o) => a + o.completePaths, 0);
      const rLast = m.orders.filter((o) => o.order[2] === 'RangedTurret').reduce((a, o) => a + o.completePaths, 0);
      const verdict =
        total === 0
          ? '判据2 成立：6 顺序全部 0 COMPLETE ⇒ 主因是 weapon/enemy matchup，不是 Encounter 顺序'
          : canonical === 0 && nonCanon > 0
            ? '判据1 成立：正式终局 0 COMPLETE，但 R 提前时出现 COMPLETE ⇒ 「固定终局顺序放大克制关系」得到支持'
            : rFirst > rLast
              ? '判据3-A/3-C：R 越早越容易赢（顺序真有影响），但正式顺序并非 0'
              : '判据3：顺序有影响但未呈现单一方向';
      lines.push(
        `   · ${m.weapon}：正式=${canonical} · 非正式=${nonCanon} · 总=${total} · R 在第1场时=${rFirst} · R 在第3场时=${rLast} ⇒ ${verdict}`,
      );
    }

    // ── 失败模式是否基本一致（判据 2 的机械化表述）────────────────────────
    lines.push('');
    lines.push('【失败模式（最深到达段分布 输E1/赢E1输E2/进终局输）跨顺序对照】');
    for (const m of all) {
      const sigs = m.orders.map((o) => `${o.failE1}/${o.failE2}/${o.failE3}`);
      lines.push(
        `   · ${m.weapon}：${m.orders.map((o, i) => `${o.label}=${sigs[i]}`).join(' · ')} ⇒ ${new Set(sigs).size === 1 ? '完全一致' : `${new Set(sigs).size} 种模式`}`,
      );
    }

    lines.push('');
    lines.push('【F：最小下一步建议（只给方向，不改产品）】');
    lines.push('   （由上方读数决定，见交付报告。）');
    console.log(lines.join('\n'));
  });
});
