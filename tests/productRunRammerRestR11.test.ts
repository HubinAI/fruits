/**
 * PRODUCT-LOOP-R11-RAMMER-REST-R1｜Rammer「攻击后的恢复节奏」取证与落地。
 *
 * ── 第一步｜节奏真源 ──────────────────────────────────────────────────────────
 *   rammer 是**接触类**武器（`behavior: 'rammer'`），它不是靠 `cooldownMs` 排攻击，
 *   而是靠**状态机周期**：`rest（回收位前摇停顿）→ strike（快速伸出）→ hold（到位短停）
 *   → retract（回收）→ rest`。周期长度 = `restSteps + strikeSteps + holdSteps + retractSteps`。
 *   canonical（`content.ts` 的 `rammer.behaviorParams`）里**只有一个**「等待」参数是
 *   `restSteps = 24`；`strikeSpeedPxPerStep = 20`（8 步走完 160px）、`holdSteps = 8`、
 *   `retractSpeedPxPerStep = 3`（≈54 步回收）都**不是**「恢复节奏」。
 *   ⇒ 本 Queue 允许且**只**允许改 `restSteps`。
 *
 * ── 结构真源（为什么「只改 restSteps」不可能碰到伤害 / 几何 / 命中）────────────
 *   `src/battle/rammerBehavior.ts` 里 `restSteps` 的**唯一**用途 =
 *   `case 'rest': if (this.phaseSteps >= this.params.restSteps)` —— 只决定「前摇等几步」。
 *   伤害来自 ContactRouter 读 canonical `baseDamage`（70），命中判定来自真实 Prismatic
 *   伸出后的锤头碰撞，两者都在本文件里**零引用** `restSteps`。
 *
 * ── 与 `rateUp` 的既有耦合（必须知道）────────────────────────────────────────
 *   `runModifiers.ts` 的 `CONTACT_CADENCE_KEYS.rammer = 'restSteps'` ⇒ 通用成长 `rateUp`
 *   在 rammer 上的落点就是 `Math.max(1, round(restSteps × 0.75))`。
 *   ⇒ 改 canonical `restSteps` 会**连带**改变 `rateUp` 的派生值（这是同一件事的两个读数，
 *      不是两个变量）；探针必须把它一并观测，避免「落地值把 rateUp 变成空操作」。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { registry } from '../src/core/content';
import { OFFICIAL_BODIES } from '../src/core/bodyOwnership';
import { EMPTY_SLOT, type BuildDraft } from '../src/lab/buildEditorModel';
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
import { FULL_RUN_SUPPORTED_WEAPON_IDS, canStartFullRun } from '../src/product/runCompatibility';
import { WEAPON_SLOT, defaultPlayerDraft } from '../src/product/playerLoadout';
import {
  GENERIC_GROWTH_CADENCE_MULT,
  genericGrowthParamsOf,
  type RunBuildId,
} from '../src/lab/portraitBattleLab/runModifiers';

const FRAME_MS = 1000 / 60;
const MAX_FRAMES = 4000;
const PRODUCT_TAG = 'profile-equipped';

/** 改前基线（`PRODUCT-LOOP-R11-RAMMER-REST-R1` 之前 rammer 的 `restSteps`）。 */
const BASELINE_REST_STEPS = 24;
/** 本轮探针扫过的档位（`current → 中等缩短 → 明显缩短 → 极短`）。 */
const PROBE_REST_STEPS: readonly number[] = [24, 16, 12, 8, 4];

const WHEELS: readonly string[] = ['wheelStd', 'smallWheel', 'largeWheel', 'heavyWheel', 'none'];
const WHEEL_RADIUS: Readonly<Record<string, number>> = (() => {
  const m: Record<string, number> = { none: 20 };
  for (const def of registry.movements.values()) m[def.id] = def.radius ?? 20;
  return m;
})();

/** R7 矩阵同款**归因夹具**：清空四个功能槽，只在主武器槽留这一件。 */
function onlyDraft(weaponDefId: string, slot: string = WEAPON_SLOT): BuildDraft {
  return {
    ...defaultPlayerDraft(),
    functionalSelections: {
      front: EMPTY_SLOT,
      frontMass: EMPTY_SLOT,
      top: EMPTY_SLOT,
      rear: EMPTY_SLOT,
      [slot]: weaponDefId,
    },
  };
}

/** 真实产品可达 Draft：车身 + 主武器（frontMass）+ 前/后轮；top 恒 EMPTY。 */
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

/** 在内存里临时改写共享 rammer def 的 `restSteps`（finally 必还原；不改 src）。 */
function withRammerRest<T>(restSteps: number, fn: () => T): T {
  const def = registry.functionals.get('rammer');
  if (!def) throw new Error('rammer 必须在正式内容库');
  const bp = def.behaviorParams as Record<string, unknown>;
  const prev = bp.restSteps;
  bp.restSteps = restSteps;
  try {
    return fn();
  } finally {
    bp.restSteps = prev;
  }
}

const round1 = (x: number): number => Math.round(x * 10) / 10;

/**
 * 冲锤**状态机周期**（步）：`rest + strike + hold + retract`。
 * 除 `restSteps` 外的三个都由 canonical 现读（它们本轮不许改）⇒ 本函数把
 * 「只动 restSteps 能压缩多少周期」变成一个可核对的数字。
 */
function cycleStepsOf(restSteps: number): number {
  const bp = registry.functionals.get('rammer')!.behaviorParams as Record<string, number>;
  return (
    restSteps +
    Math.ceil(bp.extendPx! / bp.strikeSpeedPxPerStep!) +
    bp.holdSteps! +
    Math.ceil(bp.extendPx! / bp.retractSpeedPxPerStep!)
  );
}

interface RestFacts {
  /** 每次真实命中（damage 事件，damageSource='weapon'，target='B'）的步号。 */
  hitSteps: number[];
  /** 每次命中的伤害（用于证明「单发伤害不变，变的是节奏」）。 */
  hitDamages: number[];
  hits: number;
  damage: number;
  /** 玩家承受的总伤害（= hpAMax − hpA）。 */
  taken: number;
  hpAMax: number;
  hpA: number;
  hpB: number;
  hpBMax: number;
  /**
   * ⚠️ **未取整**的耐久 —— 跨段 `carriedHp` 必须用这两个（R9F / R10 口径）。
   * 用取整值当 carry 会让下一段开局耐久差 0.1，进而让读数与 R9F 冻结值差一个尾数
   * （本文件实测踩过：`RangedTurret:A/458.2` vs 冻结值 `458.3`）。
   */
  hpARaw: number;
  hpBRaw: number;
  winner: 'A' | 'B' | null;
  endReason: string | null;
  steps: number;
  /** 逐武器实际命中（`武器 → {count, unit[]}`）—— 用于与 R9F 的 `FROZEN_DAMAGE` 对拍。 */
  perWeapon: Record<string, { count: number; unit: number[] }>;
}

/** 单场隔离（满耐久 / 指定 Build）：只记真实命中节奏与双方耐久。 */
function rammerBattleFacts(
  draft: BuildDraft,
  build: readonly RunBuildId[],
  encounterId: string,
  carriedHp: number | null = null,
): RestFacts {
  const rt = new RunBattleRuntime({
    build: [...build],
    carriedHp,
    encounterId,
    playerDraft: draft,
    playerLoadoutTag: PRODUCT_TAG,
    playerBaseline: true,
  });
  const hitSteps: number[] = [];
  const hitDamages: number[] = [];
  /** ⚠️ `damage` 事件的 `timestamp` 字段恒 0（实测）⇒ 命中时刻用外层步计数现读。 */
  let currentStep = 0;
  const off = rt.orchestrator.onCombatEvent((ev) => {
    if (ev.type === 'damage' && ev.damageSource === 'weapon' && ev.target === 'B') {
      hitSteps.push(currentStep);
      hitDamages.push(ev.damage);
    }
  });
  try {
    let steps = 0;
    while (rt.result === null && steps < MAX_FRAMES) {
      rt.step(FRAME_MS);
      steps += 1;
      currentStep = steps;
    }
    const hp = rt.hp();
    const damage = hitDamages.reduce((a, b) => a + b, 0);
    const perWeapon: Record<string, { count: number; unit: number[] }> = {};
    for (const [w, read] of Object.entries(rt.playerWeaponHitSummary())) {
      perWeapon[w] = { count: read.count, unit: [...new Set(read.damages)].sort((a, b) => a - b) };
    }
    return {
      hitSteps,
      hitDamages,
      hits: hitSteps.length,
      damage,
      perWeapon,
      taken: round1(hp.aMax - hp.a),
      hpAMax: round1(hp.aMax),
      hpA: round1(hp.a),
      hpB: round1(hp.b),
      hpBMax: round1(hp.bMax),
      hpARaw: hp.a,
      hpBRaw: hp.b,
      winner: rt.result?.winner ?? null,
      endReason: rt.result?.endReason ?? null,
      steps,
    };
  } finally {
    off();
    rt.dispose();
  }
}

/* ------------------------------------------------- 严格分层走查（模块级复用） */

interface LeafOutcome {
  readonly builds: string[];
  readonly phase: string;
  readonly stages: number;
  readonly finalHpA: number;
}

/** 第 3 段（`d4-final` = `RangedTurret`）的归因累加器（可选；调用方提供时才写入）。 */
interface FinalStageStats {
  fights: number;
  zeroHit: number;
  enemyHpMin: number | null;
}

/**
 * **严格分层全枚举**（与 `productRunFullReachableSpaceR10` 同一口径，**不用代表路线剪枝**）：
 *   E1 输 ⇒ 该 chassis 安全剪枝（不枚举 Build）；E1 赢 ⇒ 枚举 Choice1 **全部**合法项，各跑 E2；
 *   E2 赢 ⇒ 枚举 Choice2 **全部**合法项，各跑 E3；E3 赢 ⇒ 记一条 COMPLETE 路径。
 * 状态机天然实现分层（FAILED 分支不展开）。
 *
 * ⚠️ 本函数对**任意** Draft 成立（单武器 `/` 多武器都可）—— `RR-02` 扫单武器全枚举，
 *    `RR-02c` 用它跑 `walk` 形态（`front: rammer + top/rear: machineGun`）。
 */
function simulateStrict(
  draft: BuildDraft,
  ctx: RunPageContext,
  stats?: FinalStageStats,
): LeafOutcome[] {
  if (!canStartFullRun(draft)) return [{ builds: [], phase: 'INVALID', stages: 0, finalHpA: 0 }];
  const out: LeafOutcome[] = [];
  const walk = (s: RunPageState, carry: number | null, builds: string[], stages: number): void => {
    if (s.phase === 'COMPLETE' || s.phase === 'FAILED') {
      out.push({ builds, phase: s.phase, stages, finalHpA: round1(carry ?? 0) });
      return;
    }
    if (s.phase === 'BATTLE') {
      const node = runCurrentNode(s);
      const f = rammerBattleFacts(draft, runBuildIds(s), node.encounterId ?? '', carry);
      if (stats && stages === 2) {
        // 第 3 段（`d4-final`）：本 Queue 的关键归因 —— 「够不够得着」必须看真实命中数。
        stats.fights += 1;
        if (f.hits === 0) stats.zeroHit += 1;
        if (stats.enemyHpMin === null || f.hpB < stats.enemyHpMin) stats.enemyHpMin = f.hpB;
      }
      walk(
        finishRunBattle(s, {
          winner: f.winner,
          endReason: f.endReason,
          playerHp: f.hpARaw,
          enemyHp: f.hpBRaw,
          steps: f.steps,
        }),
        f.hpARaw,
        builds,
        stages + 1,
      );
      return;
    }
    if (s.phase === 'CHOICE') {
      for (const opt of runChoicePool(s).map((o) => o.id)) {
        const ns = chooseRunBuff(s, opt, ctx);
        if (ns === s) continue; // 该项不可选 ⇒ 跳过，不卡死
        walk(ns, carry, [...builds, opt], stages);
      }
      return;
    }
    if (s.phase === 'EVENT') {
      const c = runCarriedPlayerHp(s);
      const ns = pressRunAction(s, ctx);
      if (ns === s) {
        out.push({ builds, phase: 'STUCK', stages, finalHpA: round1(c ?? 0) });
        return;
      }
      walk(ns, c, builds, stages);
      return;
    }
    const ns = pressRunAction(s, ctx);
    if (ns === s) {
      out.push({ builds, phase: s.phase, stages, finalHpA: round1(carry ?? 0) });
      return;
    }
    walk(ns, carry, builds, stages);
  };
  walk(createRunPageState(ctx), null, [], 0);
  return out;
}

/** 跑一条 Draft 的严格分层走查（`RR-02c` 用；不做归因统计）。 */
function strictRunOf(draft: BuildDraft, key: string): LeafOutcome[] {
  const ctx = runPageContext({ source: 'profile', label: key, draft, tag: PRODUCT_TAG, key });
  return simulateStrict(draft, ctx);
}

/**
 * `walk` 形态（= `portraitRunPage` 的真实走查形态，与 `productRunFullRunPathMatrixR9F`
 * 的 `walk` 逐字段同源）：武器挂在 `front`，上下位各一件 `machineGun`。
 */
function walkDraft(weapon: string): BuildDraft {
  return {
    ...defaultPlayerDraft(),
    functionalSelections: {
      front: weapon,
      frontMass: EMPTY_SLOT,
      top: 'machineGun',
      rear: 'machineGun',
    },
  };
}

/** 单段读数（`RR-02c` 用于把 R9F 的 `D1` / `D2` 代表路线逐段复现）。 */
interface StageReading {
  readonly encounterId: string;
  readonly winner: 'A' | 'B' | null;
  readonly hpA: number;
  readonly hpB: number;
  readonly steps: number;
  /** R9F `stageDamage` 同款串，供 `FROZEN_DAMAGE` 对拍。 */
  readonly damage: string;
}

/** R9F `stageDamage` 同款：`武器:逐发×次数`（零命中 ⇒ `-`）。 */
function damageStrOf(f: RestFacts): string {
  const parts = Object.entries(f.perWeapon).map(([w, r]) => `${w}:${r.unit.join('/')}x${r.count}`);
  return parts.length > 0 ? parts.join(' ') : '-';
}

/**
 * 跑一条**代表路线**（`picks` = 每次 `CHOICE` 想要的 Build id；缺项 / 不可选时退化为池内首项）。
 * ⚠️ **只用于复现 R9F 的既有读数**（`D1` / `D2`），**不用于任何枚举** —— 枚举一律走
 *   `simulateStrict`（代表路线剪枝会漏掉真实可达路线，那是 R10 已经定过的纪律）。
 */
function routeStageReadings(
  draft: BuildDraft,
  ctx: RunPageContext,
  picks: readonly string[],
): { phase: string; chosen: string[]; stages: StageReading[] } {
  let s = createRunPageState(ctx);
  const chosen: string[] = [];
  const stages: StageReading[] = [];
  let carry: number | null = null;
  for (let guard = 0; guard < 64; guard += 1) {
    if (s.phase === 'COMPLETE' || s.phase === 'FAILED') return { phase: s.phase, chosen, stages };
    if (s.phase === 'BATTLE') {
      const node = runCurrentNode(s);
      const f = rammerBattleFacts(draft, runBuildIds(s), node.encounterId ?? '', carry);
      stages.push({
        encounterId: node.encounterId ?? '',
        winner: f.winner,
        hpA: f.hpARaw,
        hpB: f.hpBRaw,
        steps: f.steps,
        damage: damageStrOf(f),
      });
      s = finishRunBattle(s, {
        winner: f.winner,
        endReason: f.endReason,
        playerHp: f.hpARaw,
        enemyHp: f.hpBRaw,
        steps: f.steps,
      });
      carry = f.hpARaw;
      continue;
    }
    if (s.phase === 'CHOICE') {
      const pool = runChoicePool(s).map((o) => o.id);
      const want = picks[chosen.length];
      const opt: RunBuildId =
        want !== undefined && (pool as readonly string[]).includes(want) ? (want as RunBuildId) : pool[0]!;
      const ns = chooseRunBuff(s, opt, ctx);
      if (ns === s) return { phase: 'STUCK', chosen, stages };
      chosen.push(opt);
      s = ns;
      continue;
    }
    const nextCarry: number | null = s.phase === 'EVENT' ? runCarriedPlayerHp(s) : carry;
    const ns = pressRunAction(s, ctx);
    if (ns === s) return { phase: s.phase, chosen, stages };
    carry = nextCarry;
    s = ns;
  }
  return { phase: 'GUARD', chosen, stages };
}

/** 把一段读数格式化成 R9F 冻结值的同款串：`<encounter>:<A|B>/<hpA>/<hpB>/<steps>`。 */
function stageStr(r: StageReading): string {
  return `${r.encounterId}:${r.winner ?? '?'}/${round1(r.hpA)}/${round1(r.hpB)}/${r.steps}`;
}

describe('PRODUCT-LOOP-R11-RAMMER-REST-R1｜Rammer 恢复节奏（只调 restSteps）', () => {
  /* ============================================================ RR-00 */
  it('RR-00｜节奏真源：restSteps 只决定「前摇等几步」，伤害/几何/命中判定与它无关', () => {
    const rammer = registry.functionals.get('rammer');
    expect(rammer, 'rammer 必须在正式内容库').toBeTruthy();
    const bp = rammer!.behaviorParams as Record<string, unknown>;
    expect(Object.keys(bp).sort()).toEqual(
      [
        'baseDamage',
        'extendPx',
        'holdSteps',
        'maxForceN',
        'restSteps',
        'retractSpeedPxPerStep',
        'strikeSpeedPxPerStep',
      ].sort(),
    );
    expect(bp.restSteps, '落地值：攻击后的恢复节奏（改前基线 24，见 RR-01 用探针复现）').toBe(12);
    expect(bp.restSteps, '必须真的与改前基线不同（否则本轮没落地）').not.toBe(BASELINE_REST_STEPS);
    expect(bp.restSteps, '必须仍有明显前摇（不是归零、也不是 1 步）').toBeGreaterThanOrEqual(4);
    expect(cycleStepsOf(bp.restSteps as number), '周期必须真的被压缩').toBeLessThan(
      cycleStepsOf(BASELINE_REST_STEPS),
    );

    // ⚠️ 与 `rateUp` 的既有耦合（`CONTACT_CADENCE_KEYS.rammer = 'restSteps'`）：
    //    落地值必须仍让 `rateUp` 派生**真的改变数字**，否则该成长在 rammer 上退化为空操作。
    const rateUpDelta = genericGrowthParamsOf('rammer', bp, ['rateUp']);
    expect(
      rateUpDelta.restSteps,
      'rateUp 在 rammer 上的落点仍是非空操作（否则 rammer 的候选池会少一项）',
    ).toBe(Math.max(1, Math.round((bp.restSteps as number) * GENERIC_GROWTH_CADENCE_MULT)));
    expect(rateUpDelta.restSteps).not.toBe(bp.restSteps);
    expect(bp.baseDamage, '伤害不动').toBe(70);
    expect(bp.extendPx, '行程不动').toBe(160);
    expect(bp.strikeSpeedPxPerStep, '伸出速度不动').toBe(20);
    expect(bp.retractSpeedPxPerStep, '回收速度不动').toBe(3);
    expect(bp.holdSteps, '到位停顿不动').toBe(8);
    expect(bp.maxForceN, 'motor 力不动').toBe(1200);
    expect(rammer!.collider, '几何不动').toEqual({
      shape: 'box',
      width: 30,
      height: 22,
      offset: { x: 15, y: 0 },
    });
    expect(rammer!.behavior).toBe('rammer');
    expect(rammer!.mass, '质量不动').toBe(25);
    expect(rammer!.energy, '能量不动').toBe(25);

    // 结构真源（源码守卫，匹配前剥注释）：`restSteps` 在行为实现里**唯一**用途 = rest 相位等待；
    //   伤害 / 几何 / motor 力 / 伸缩速度路径里**零**引用 ⇒ 改它结构上不可能碰到伤害。
    const src = readFileSync(join(__dirname, '..', 'src', 'battle', 'rammerBehavior.ts'), 'utf8');
    const noComments = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    expect(
      noComments.match(/this\.params\.restSteps/g)?.length,
      'restSteps 在行为实现里只应有一处消费',
    ).toBe(1);
    expect(
      noComments.includes('this.phaseSteps >= this.params.restSteps'),
      'restSteps 的唯一用途 = rest 相位等待步数',
    ).toBe(true);
    // 伤害 / 几何不来自 behavior 参数：baseDamage 由 ContactRouter 读 canonical
    expect(noComments.includes('baseDamage'), '冲锤行为实现不读 baseDamage（伤害走 ContactRouter）').toBe(false);
    expect(noComments.includes('extendPx') && noComments.includes('maxForceN'), '行程/motor 力仍是自己的参数').toBe(true);
  });

  /* ============================================================ RR-01 */
  it('RR-01｜改前基线（restSteps=24，探针复现）：接触正常但交换效率差，E1 打完已无余力', () => {
    const draft = onlyDraft('rammer');
    const e1 = withRammerRest(BASELINE_REST_STEPS, () => rammerBattleFacts(draft, [], 'ProtoRusher'));
    const e2 = withRammerRest(BASELINE_REST_STEPS, () => rammerBattleFacts(draft, [], 'Chaser'));
    const lines: string[] = [];
    lines.push('');
    lines.push('【RR-01｜改前基线 rammer（探针 restSteps=24）· 归因夹具 onlyDraft(rammer)】');
    for (const [tag, f] of [
      ['vs ProtoRusher', e1],
      ['vs Chaser', e2],
    ] as const) {
      lines.push(
        `   ${tag}: 命中 ${f.hits} 次 / ${f.damage} 伤 · 承伤 ${f.taken}（HP ${f.hpA}/${f.hpAMax} vs ${f.hpB}/${f.hpBMax}）· ` +
          `结局 ${f.winner ?? '?'}(${f.endReason ?? '?'}) · ${f.steps} 步`,
      );
      lines.push(`      命中步号 = [${f.hitSteps.join(', ')}]`);
    }
    // eslint-disable-next-line no-console
    console.log('\n' + lines.join('\n') + '\n');

    // 基线事实：这一族的问题**不是**够不着（接触正常、命中两位数），而是交换效率。
    expect(e1.hits, '基线：rammer 在 ProtoRusher 上是真实接触命中（两位数量级）').toBeGreaterThanOrEqual(8);
    expect(e1.damage, '基线：累计伤害高于单发 70（确实是多次命中）').toBeGreaterThan(70);
    expect(e1.taken, '基线：玩家承受了大量伤害（交换效率差的直接读数）').toBeGreaterThan(500);
  }, 300_000);

  /* ============================================================ RR-01b */
  it('RR-01b｜restSteps 离散探针（单场归因）：缩短恢复 ⇒ 命中更密、更快打完 ⇒ 剩余 HP 改善', () => {
    const draft = onlyDraft('rammer');
    interface Row {
      readonly rest: number;
      readonly proto: RestFacts;
      readonly chaser: RestFacts;
    }
    const rows: Row[] = [];
    for (const r of PROBE_REST_STEPS) {
      rows.push({
        rest: r,
        proto: withRammerRest(r, () => rammerBattleFacts(draft, [], 'ProtoRusher')),
        chaser: withRammerRest(r, () => rammerBattleFacts(draft, [], 'Chaser')),
      });
    }
    const lines: string[] = [];
    lines.push('');
    lines.push('【RR-01b｜restSteps 离散探针（归因夹具 onlyDraft(rammer)；满耐久 / 零 Build 单场隔离）】');
    for (const row of rows) {
      lines.push(
        `   · restSteps=${row.rest}（周期 ≈ ${cycleStepsOf(row.rest)} 步，其中 rest 占 ${row.rest}）:`,
      );
      lines.push(
        `       vs ProtoRusher：命中 ${row.proto.hits} 次 / ${row.proto.damage} 伤 · 承伤 ${row.proto.taken} · ` +
          `剩 HP ${row.proto.hpA} · ${row.proto.steps} 步 · ${row.proto.winner ?? '?'}`,
      );
      lines.push(
        `       vs Chaser    ：命中 ${row.chaser.hits} 次 / ${row.chaser.damage} 伤 · 承伤 ${row.chaser.taken} · ` +
          `剩 HP ${row.chaser.hpA} · ${row.chaser.steps} 步 · ${row.chaser.winner ?? '?'}`,
      );
      lines.push(`       ProtoRusher 命中步号 = [${row.proto.hitSteps.join(', ')}]`);
    }
    // eslint-disable-next-line no-console
    console.log('\n' + lines.join('\n') + '\n');

    // ① 改善方向：**至少有一档**的命中次数严格多于基线。
    //    ⚠️ 不做逐档单调断言 —— 冲锤是接触类武器，命中窗口取决于「伸出瞬间两车的相对位置」，
    //       `restSteps` 一改整个 strike 相位就平移 ⇒ 命中次数在整条轴上**非单调**（RR-02a 实证）。
    const baseHits = rows.find((r) => r.rest === BASELINE_REST_STEPS)!.proto.hits;
    expect(
      Math.max(...rows.map((r) => r.proto.hits)),
      '缩短恢复后必须至少有一档命中更密（方向性）',
    ).toBeGreaterThan(baseHits);
    // ② 单发伤害不变（伤害是另一件事）：所有档位的命中伤害集合逐字节相同。
    const dmgSets = rows.map((r) => [...new Set(r.proto.hitDamages)].sort().join(','));
    for (const s of dmgSets) expect(s, '单发伤害集合不随 restSteps 变').toBe(dmgSets[0]);
    // ③ 周期确实被压缩（结构上可核对）。
    expect(cycleStepsOf(rows[rows.length - 1]!.rest), '最短档的周期必须明显短于基线').toBeLessThan(
      cycleStepsOf(BASELINE_REST_STEPS),
    );
  }, 600_000);

  /* ============================================================ RR-02a */
  it('RR-02a｜E1 全枚举（body×front×rear = 200 chassis）：缩短 rest 后「赢 E1 的面」与「E1 剩余 HP」', () => {
    interface E1Row {
      readonly body: string;
      readonly front: string;
      readonly rear: string;
      readonly win: boolean;
      readonly hpA: number;
      readonly hits: number;
      readonly steps: number;
    }
    const scanE1 = (): E1Row[] => {
      const rows: E1Row[] = [];
      for (const body of OFFICIAL_BODIES) {
        for (const front of WHEELS) {
          for (const rear of WHEELS) {
            const f = rammerBattleFacts(productDraft(body, 'rammer', front, rear), [], 'ProtoRusher');
            rows.push({
              body,
              front,
              rear,
              win: f.winner === 'A',
              hpA: f.hpA,
              hits: f.hits,
              steps: f.steps,
            });
          }
        }
      }
      return rows;
    };
    const lines: string[] = [];
    lines.push('');
    lines.push('【RR-02a｜E1（ProtoRusher，满耐久 / 零 Build）全枚举 200 chassis】');
    interface Sum {
      readonly rest: number;
      readonly win: number;
      readonly bestHp: number;
      readonly bestAt: string;
      readonly sumHp: number;
      readonly wins: E1Row[];
    }
    const sums: Sum[] = [];
    const landed = (registry.functionals.get('rammer')!.behaviorParams as Record<string, number>).restSteps!;
    /** 档位 = 探针三档 ∪ 落地值（落地值从 canonical 现读 ⇒ 未来再调参也会被本测试重新评估）。 */
    const candidates = [...new Set([...PROBE_REST_STEPS, landed])].sort((a, b) => b - a);
    expect(candidates, '探针必须覆盖改前基线').toContain(BASELINE_REST_STEPS);
    for (const r of candidates) {
      const rows = withRammerRest(r, () => scanE1());
      const wins = rows.filter((x) => x.win);
      const best = wins.reduce<E1Row | null>((a, b) => (a === null || b.hpA > a.hpA ? b : a), null);
      sums.push({
        rest: r,
        win: wins.length,
        bestHp: best?.hpA ?? 0,
        bestAt: best ? `${best.body}/${best.front}/${best.rear}` : '—',
        sumHp: Math.round(wins.reduce((a, b) => a + b.hpA, 0)),
        wins,
      });
      lines.push(
        `   · restSteps=${r}（周期 ${cycleStepsOf(r)} 步）：赢 E1 **${wins.length}/200** · ` +
          `赢面剩余 HP 合计 ${sums[sums.length - 1]!.sumHp} · 最佳剩 HP ${best?.hpA ?? 0}（${best ? `${best.body}/${best.front}/${best.rear}` : '—'}）`,
      );
    }
    // 基线里「赢 E1 且留有余量」的 chassis（供后面解释落地值的选择）
    const baselineWins = sums.find((s) => s.rest === BASELINE_REST_STEPS)!.wins;
    lines.push(
      `   · 基线（24）赢 E1 的 chassis 例（最多 8 个）：${
        baselineWins.length
          ? baselineWins
              .slice(0, 8)
              .map((w) => `${w.body}/${w.front}/${w.rear}(剩${w.hpA})`)
              .join(' | ')
          : '无'
      }`,
    );
    // eslint-disable-next-line no-console
    console.log('\n' + lines.join('\n') + '\n');

    // 方向性：缩短 restSteps 后**必须**出现更多「赢 E1」的 chassis（本 Queue 的目标方向）。
    // ⚠️ **如实记录：赢面不是随 restSteps 单调的** —— 冲锤的命中窗口取决于「伸出瞬间两车的
    //    相对位置」，restSteps 一改，整个 strike 相位就整体平移 ⇒ 接触几何重排。实测：
    //    `24 → 16` 赢面扩大，但 `16 → 8` 反而回落（8 档伸出更早、相位错开得更彻底）。
    //    ⇒ 判据是「最好的一档**严格优于**基线」，而不是逐档单调。
    const baselineWin = sums.find((s) => s.rest === BASELINE_REST_STEPS)!.win;
    const bestWin = Math.max(...sums.map((s) => s.win));
    expect(
      bestWin,
      `缩短 restSteps 后「赢 E1」的 chassis 面必须扩大（基线 ${baselineWin} → 最好 ${bestWin}）`,
    ).toBeGreaterThan(baselineWin);

    // 验收 3（本 Queue 的核心目标）：落地值档的 **E1 后剩余 HP 必须明显改善**。
    const landedRow = sums.find((s) => s.rest === landed)!;
    const baseRow = sums.find((s) => s.rest === BASELINE_REST_STEPS)!;
    const avg = (s: Sum): number => s.sumHp / Math.max(1, s.win);
    expect(
      landedRow.win,
      `落地值 win E1 的面必须扩大（基线 ${baseRow.win} → ${landedRow.win}）`,
    ).toBeGreaterThan(baseRow.win);
    expect(
      avg(landedRow),
      `落地值「赢面平均剩余 HP」必须明显改善（基线 ${round1(avg(baseRow))} → ${round1(avg(landedRow))}）`,
    ).toBeGreaterThan(avg(baseRow) * 1.2);
    expect(
      landedRow.sumHp,
      `落地值「赢面剩余 HP 合计」必须明显改善（基线 ${baseRow.sumHp} → ${landedRow.sumHp}）`,
    ).toBeGreaterThan(baseRow.sumHp * 1.2);
  }, 900_000);

  /* ============================================================ RR-02b */
  it('RR-02b｜落地值档的 E1 输面清单（=「① 段阵亡」的真实载体，供 Q3-04 取用）', () => {
    const landed = (registry.functionals.get('rammer')!.behaviorParams as Record<string, number>).restSteps!;
    const winners: string[] = [];
    const losers: string[] = [];
    withRammerRest(landed, () => {
      for (const body of OFFICIAL_BODIES) {
        for (const front of WHEELS) {
          for (const rear of WHEELS) {
            const f = rammerBattleFacts(productDraft(body, 'rammer', front, rear), [], 'ProtoRusher');
            (f.winner === 'A' ? winners : losers).push(`${body}/${front}/${rear}`);
          }
        }
      }
    });
    const lines: string[] = [];
    lines.push('');
    lines.push(`【RR-02b｜落地值 restSteps=${landed} 的 E1（ProtoRusher，满耐久 / 零 Build）分布】`);
    lines.push(`   赢 E1 ${winners.length}/200 · **输 E1 ${losers.length}/200**`);
    lines.push(`   输面样例（前 12）：${losers.slice(0, 12).join(' | ') || '（无）'}`);
    // eslint-disable-next-line no-console
    console.log('\n' + lines.join('\n') + '\n');

    // 输面必须非空 —— 否则「① 段阵亡」在正式内容里就真的没有真实载体了
    //   （Q3-04 会用其中一条来覆盖「任意段阵亡」的 ① 段分支）。
    expect(losers.length, '必须仍存在真实死在第 ① 段的 chassis').toBeGreaterThan(0);
    expect(winners.length, '缩短 rest 后赢面必须仍是多数').toBeGreaterThan(losers.length);
  }, 600_000);

  /* ============================================================ RR-02 */
  it('RR-02｜严格分层全枚举：缩短 restSteps ⇒ 出现 ★1 产品可达 COMPLETE chassis', () => {
    /**
     * 第 3 段（`d4-final` = `RangedTurret`）的归因累加器：由模块级 `simulateStrict` 写入，
     * 每扫一个档位前重置一次（作用域必须提到 `simulateStrict` 调用之外）。
     */
    const finalStats: FinalStageStats = { fights: 0, zeroHit: 0, enemyHpMin: null };

    const landed = (registry.functionals.get('rammer')!.behaviorParams as Record<string, number>).restSteps!;
    /**
     * 全枚举档位 = 离散探针 ∪ 落地值（**明显离散**：current → 中等 → 明显 → 极短）。
     * ⚠️ 这里比「只跑基线 + 落地值」多扫了三档，目的不是选参，而是**排除「是不是没试够」**：
     *    验收 4（★1 COMPLETE）若在**整条 restSteps 轴上**都拿不到，那就不是参数问题。
     */
    const candidates = [...new Set([BASELINE_REST_STEPS, ...PROBE_REST_STEPS, 12, 4, landed])].sort(
      (a, b) => b - a,
    );
    interface Row {
      readonly rest: number;
      readonly complete: string[];
      readonly e1Win: number;
      readonly e2Win: number;
      readonly leaves: number;
      readonly bestHp: number;
      readonly best: string;
      /** 打到第 3 段（`d4-final` = `RangedTurret`）的场次数，以及其中「0 命中」的场次数。 */
      readonly finalFights: number;
      readonly finalZeroHit: number;
      /** 第 3 段里对手剩余 HP 的最小值（`null` = 没有任何路线打到第 3 段）。 */
      readonly finalEnemyHpMin: number | null;
    }
    const summary: Row[] = [];
    const lines: string[] = [];
    lines.push('');
    lines.push('【RR-02｜restSteps 严格分层全枚举（**非代表路线**；body×front×rear = 8×5×5 = 200）】');
    for (const rest of candidates) {
      const complete: string[] = [];
      let e1Win = 0;
      let e2Win = 0;
      let leaves = 0;
      let bestHp = -1;
      let best = '';
      finalStats.fights = 0;
      finalStats.zeroHit = 0;
      finalStats.enemyHpMin = null;
      withRammerRest(rest, () => {
        for (const body of OFFICIAL_BODIES) {
          for (const front of WHEELS) {
            for (const rear of WHEELS) {
              const draft = productDraft(body, 'rammer', front, rear);
              const key = `rr|${body}|rammer|${front}|${rear}`;
              const ctx = runPageContext({ source: 'profile', label: key, draft, tag: PRODUCT_TAG, key });
              const ls = simulateStrict(draft, ctx, finalStats);
              leaves += ls.length;
              const maxStage = ls.reduce((m, l) => Math.max(m, l.stages), 0);
              if (maxStage >= 2) e1Win += 1;
              if (maxStage >= 3) e2Win += 1;
              for (const l of ls) {
                if (l.phase === 'COMPLETE') complete.push(`${body}/${front}/${rear}[${l.builds.join('→')}]`);
                if (l.stages > 0 && l.finalHpA > bestHp) {
                  bestHp = l.finalHpA;
                  best = `${body}/${front}/${rear}`;
                }
              }
            }
          }
        }
      });
      summary.push({
        rest,
        complete,
        e1Win,
        e2Win,
        leaves,
        bestHp,
        best,
        finalFights: finalStats.fights,
        finalZeroHit: finalStats.zeroHit,
        finalEnemyHpMin: finalStats.enemyHpMin,
      });
      lines.push(
        `   · restSteps=${rest}（周期 ${cycleStepsOf(rest)} 步）: COMPLETE 路径 ${complete.length} 条 / ` +
          `chassis ${new Set(complete.map((c) => c.split('[')[0])).size} 个 · 赢E1 ${e1Win}/200 · 赢E1&E2 ${e2Win}/200 · ` +
          `叶子 ${leaves} · 最佳终局HP ${bestHp}（${best}）`,
      );
      lines.push(
        `       └ 第 3 段（d4-final = RangedTurret）共 ${finalStats.fights} 场：**0 命中 ${finalStats.zeroHit} 场** · ` +
          `对手剩余 HP 最少 ${finalStats.enemyHpMin === null ? '—' : round1(finalStats.enemyHpMin)}`,
      );
      if (complete.length > 0) {
        lines.push(`       样例 = ${complete.slice(0, 8).join(' | ')}${complete.length > 8 ? ' …' : ''}`);
      }
    }
    // eslint-disable-next-line no-console
    console.log('\n' + lines.join('\n') + '\n');

    const landedRow = summary.find((s) => s.rest === landed)!;
    const baseRow = summary.find((s) => s.rest === BASELINE_REST_STEPS)!;
    // 验收 3（方向性）：缩短后「赢 E1 的 chassis 面」必须**严格**扩大。
    expect(landedRow.e1Win, '落地值赢 E1 的面必须严格大于基线').toBeGreaterThan(baseRow.e1Win);
    // 验收 3（跨段读数）：还必须把「打进第 3 段的面」扩大（= 跨段交换效率真的改善）。
    expect(
      landedRow.e2Win,
      `落地值赢 E1&E2 的面必须严格大于基线（${baseRow.e2Win} → ${landedRow.e2Win}）`,
    ).toBeGreaterThan(baseRow.e2Win);

    /* ── 验收 4（★1 产品可达 COMPLETE）**未达成** —— 如实钉住，不掩盖 ──────────────
       ⚠️ 这**不是**「试得不够」：整条 `restSteps` 轴（24/16/12/8/4）在此夹具下 COMPLETE **恒为 0**。
       瓶颈不在节奏，而在**第 3 段的接触几何**：`d4-final` 的 `RangedTurret` 声明了控距
       （`enemyDrive: 'keep-distance'`），而冲锤是**接触类**武器 —— 贴不上去就没有任何命中通道。
       实测第 3 段「0 命中」占多数（31/36、24/28、49/70、38/38、58/58），对手剩余耐久几乎满额。
       这与 R7 `MX-06`（`rammer` vs `RangedTurret` 0 命中、`minGap = +7`）和 R8 `BI-06`
       （只有 `rateUp` 能让它「第一次打中」）是**同一件事的跨段形态**。
       ⇒ 属**几何 / 控距**问题，**不在「只调 restSteps」的可达范围内**。
       ⇒ 本测试把它变成机器可见的读数（与 `RP9-05` 钉「7 件全 FAILED」同一纪律）。
       若将来这条缺口被修掉，本断言会变红 —— 那是**正确的**信号（改这里 + 更新交接文档）。 */
    for (const s of summary) {
      expect(
        s.complete.length,
        `restSteps=${s.rest}：只调恢复节奏无法产出 ★1 COMPLETE（几何缺口，非节奏问题）`,
      ).toBe(0);
    }
    // 守卫 ①：rammer 确实**稳定打进第 3 段**（瓶颈在 E3，不是整体崩溃 / 不是卡死）。
    for (const s of summary) {
      expect(s.e2Win, `restSteps=${s.rest} 必须能打进第 3 段`).toBeGreaterThan(0);
    }
    // 守卫 ②：第 3 段确实「打不动」—— 0 命中占多数，且对手从未被清空。
    for (const s of summary) {
      expect(
        s.finalZeroHit * 2,
        `restSteps=${s.rest}：第 3 段「0 命中」必须是多数（${s.finalZeroHit}/${s.finalFights}）`,
      ).toBeGreaterThan(s.finalFights);
      expect(s.finalEnemyHpMin, `restSteps=${s.rest}：第 3 段对手从未被打空`).toBeGreaterThan(0);
    }
  }, 3_600_000);

  /* ============================================================ RR-02c */
  it('RR-02c｜双形态对照：`only` 的「缩短 rest ⇒ E1 更稳」能否外推到真实走查形态 `walk`？', () => {
    const landed = (registry.functionals.get('rammer')!.behaviorParams as Record<string, number>).restSteps!;
    const forms: readonly { readonly id: string; readonly draft: () => BuildDraft }[] = [
      { id: 'only(frontMass: rammer)', draft: () => onlyDraft('rammer') },
      { id: 'walk(front: rammer + top/rear: machineGun)', draft: () => walkDraft('rammer') },
    ];

    const lines: string[] = [];
    lines.push('');
    lines.push('【RR-02c｜第 1 段（ProtoRusher，满耐久 / 零 Build）单场归因：两种装配形态 × 五档 restSteps】');

    /* ── ① 单场归因表：E1 的「命中 / 承伤 / 剩余 HP」在两种形态下**方向是否一致** ── */
    const e1 = new Map<string, Map<number, RestFacts>>();
    for (const form of forms) {
      const m = new Map<number, RestFacts>();
      for (const rest of PROBE_REST_STEPS) {
        m.set(rest, withRammerRest(rest, () => rammerBattleFacts(form.draft(), [], 'ProtoRusher')));
      }
      e1.set(form.id, m);
      lines.push(`   · ${form.id}`);
      for (const rest of PROBE_REST_STEPS) {
        const f = m.get(rest)!;
        lines.push(
          `       restSteps=${String(rest).padStart(2)}（周期 ${String(cycleStepsOf(rest)).padStart(2)} 步）: ` +
            `${String(f.hits).padStart(2)} 命中 / ${String(f.damage).padStart(3)} 伤 / 承伤 ${String(f.taken).padStart(5)} / ` +
            `剩 HP ${String(f.hpA).padStart(5)} / ${f.winner === 'A' ? '胜' : '败'} · ${f.steps} 步`,
        );
      }
    }

    /* ── ② `walk` 形态的严格分层全枚举（基线 vs 落地值）──────────────────────── */
    interface WalkRow {
      readonly rest: number;
      readonly complete: string[];
      readonly leaves: number;
      readonly bestHp: number;
      readonly e2Win: boolean;
    }
    const walkRows: WalkRow[] = [];
    lines.push('');
    lines.push('【RR-02c｜`walk` 形态严格分层全枚举（**整条唯一 chassis**；全部合法 Choice 组合展开）】');
    for (const rest of PROBE_REST_STEPS) {
      let ls: LeafOutcome[] = [];
      withRammerRest(rest, () => {
        ls = strictRunOf(walkDraft('rammer'), `rr-walk|rammer|rest${rest}`);
      });
      const complete = ls.filter((l) => l.phase === 'COMPLETE');
      const maxStage = ls.reduce((m, l) => Math.max(m, l.stages), 0);
      let bestHp = -1;
      for (const l of ls) if (l.stages > 0 && l.finalHpA > bestHp) bestHp = l.finalHpA;
      const row: WalkRow = {
        rest,
        complete: complete.map((l) => `[${l.builds.join('→')}]`),
        leaves: ls.length,
        bestHp,
        e2Win: maxStage >= 3,
      };
      walkRows.push(row);
      lines.push(
        `   · restSteps=${rest}（周期 ${cycleStepsOf(rest)} 步）: **COMPLETE ${row.complete.length} 条** · ` +
          `叶子 ${row.leaves} · 打进第 3 段 ${row.e2Win ? '是' : '否'} · 最佳终局 HP ${bestHp}`,
      );
      if (row.complete.length > 0) {
        lines.push(`       样例 = ${row.complete.slice(0, 6).join(' | ')}${row.complete.length > 6 ? ' …' : ''}`);
      }
    }

    /* ── ③ 用 R9F 的 `D1` / `D2` 代表路线逐段复现（对照 R9F 冻结值）──────────── */
    interface RouteCase {
      readonly key: string;
      readonly form: string;
      readonly picks: readonly [string, string];
      readonly rest: number;
    }
    const routeCases: RouteCase[] = [];
    for (const rest of [BASELINE_REST_STEPS, landed]) {
      routeCases.push(
        { key: `walk/rammer/D1@${rest}`, form: 'walk', picks: ['damageUp', 'rateUp'], rest },
        { key: `walk/rammer/D2@${rest}`, form: 'walk', picks: ['rateUp', 'damageUp'], rest },
      );
    }
    // `only/rammer` 两条 = R9F 里「零 Build 第 1 段就阵亡」的既有载体（R11 后必须重测）。
    routeCases.push(
      { key: `only/rammer/D1@${landed}`, form: 'only', picks: ['damageUp', 'rateUp'], rest: landed },
      { key: `only/rammer/D2@${landed}`, form: 'only', picks: ['rateUp', 'damageUp'], rest: landed },
    );

    const routeRows = new Map<string, string>();
    const routeDamage = new Map<string, string>();
    lines.push('');
    lines.push('【RR-02c｜R9F 代表路线逐段读数（R9F 冻结值同款串；`D1` = damageUp→rateUp）】');
    for (const rc of routeCases) {
      const draft = rc.form === 'walk' ? walkDraft('rammer') : onlyDraft('rammer');
      let r: { phase: string; chosen: string[]; stages: StageReading[] } | null = null;
      withRammerRest(rc.rest, () => {
        const ctx = runPageContext({
          source: 'profile',
          label: `rr-route-${rc.key}`,
          draft,
          tag: PRODUCT_TAG,
          key: `rr-route|${rc.key}`,
        });
        r = routeStageReadings(draft, ctx, rc.picks);
      });
      const got = r!;
      const text = `${got.phase} | ${got.stages.map(stageStr).join(' | ')}`;
      const dmg = got.stages.map((x) => x.damage).join(' ; ');
      routeRows.set(rc.key, text);
      routeDamage.set(rc.key, dmg);
      lines.push(`   · ${rc.key} → ${text}`);
      lines.push(`       伤害 → ${dmg}`);
    }
    // eslint-disable-next-line no-console
    console.log('\n' + lines.join('\n') + '\n');

    /* ── 断言 ①：代表路线读数逐字节钉住（**R9F 冻结表必须同步改这 4 行**）───────
       基线（24）两行 = R9F 的既有冻结值 ⇒ 本文件走查工具与 R9F **逐字段同口径**
       （含「跨段 `carriedHp` 传**未取整**值」这条 —— 用取整值会让终局从 458.3 变 458.2）。
       落地值（12）四行 = R11 引入的**真实变化**。 */
    expect(
      routeRows.get('walk/rammer/D1@24'),
      'restSteps=24 的 walk/rammer/D1 必须等于 R9F 冻结值（改前基线）',
    ).toBe('COMPLETE | ProtoRusher:A/1011.5/0/346 | Chaser:A/1002.7/0/246 | RangedTurret:A/458.3/0/386');
    expect(
      routeRows.get('walk/rammer/D2@24'),
      'restSteps=24 的 walk/rammer/D2 必须等于 R9F 冻结值（改前基线）',
    ).toBe('COMPLETE | ProtoRusher:A/1011.5/0/346 | Chaser:A/645.7/0/222 | RangedTurret:A/101.2/0/386');
    // `only` 形态：24 时第 ① 段就阵亡（`ProtoRusher:B/0/170.6/1033`）；12 时**打进第 ② 段**才阵亡。
    expect(
      routeRows.get('only/rammer/D1@12'),
      'restSteps=12 的 only/rammer/D1：R11 的主要收益 —— 从「① 段阵亡」变成「打进 ② 段」',
    ).toBe('FAILED | ProtoRusher:A/538.4/0/1033 | Chaser:B/0/273.9/524');
    expect(
      routeRows.get('only/rammer/D2@12'),
      'restSteps=12 的 only/rammer/D2：同上',
    ).toBe('FAILED | ProtoRusher:A/538.4/0/1033 | Chaser:B/0/402/480');
    // `walk` 形态：R11 的**代价** —— 两条 `damageUp`/`rateUp` 组合由 COMPLETE 翻成 FAILED。
    expect(
      routeRows.get('walk/rammer/D1@12'),
      'restSteps=12 的 walk/rammer/D1 = R11 引入的代价（COMPLETE → FAILED）',
    ).toBe('FAILED | ProtoRusher:A/888.2/0/319 | Chaser:A/525.8/0/205 | RangedTurret:B/0/11.7/363');
    expect(
      routeRows.get('walk/rammer/D2@12'),
      'restSteps=12 的 walk/rammer/D2 = R11 引入的代价（COMPLETE → FAILED）',
    ).toBe('FAILED | ProtoRusher:A/888.2/0/319 | Chaser:A/346.4/0/200 | RangedTurret:B/0/411.7/229');

    /* 逐段「各武器实际伤害」也必须一并改（= R9F `FROZEN_DAMAGE` 的对应 4 行）。
       ⚠️ rammer 的**单发值不变**（仍是 canonical 70 / `damageUp` 后 88）—— 变的只是「打了几发」，
          这正是「只调恢复节奏」的证据。 */
    expect(routeDamage.get('only/rammer/D1@12'), 'only/rammer/D1 的逐段伤害').toBe('rammer:70x12 ; rammer:88x7');
    expect(routeDamage.get('only/rammer/D2@12'), 'only/rammer/D2 的逐段伤害').toBe('rammer:70x12 ; rammer:70x7');
    expect(
      routeDamage.get('walk/rammer/D1@12'),
      'walk/rammer/D1 的逐段伤害',
    ).toBe('machineGun:20x42 rammer:70x3 ; machineGun:20x28 rammer:88x4 ; machineGun:20x50 rammer:88x1');
    expect(
      routeDamage.get('walk/rammer/D2@12'),
      'walk/rammer/D2 的逐段伤害',
    ).toBe('machineGun:20x42 rammer:70x3 ; machineGun:20x28 rammer:70x5 ; machineGun:20x30 rammer:88x1');
    // 反向证据：`24` 档的 `walk` 伤害行必须仍是 R9F 的原冻结值（证明本工具的伤害口径没漂）。
    expect(
      routeDamage.get('walk/rammer/D1@24'),
      'restSteps=24 的 walk/rammer/D1 伤害行必须等于 R9F 原冻结值',
    ).toBe('machineGun:20x43 rammer:70x2 ; machineGun:20x36 rammer:88x2 ; machineGun:20x51 rammer:88x1');

    /* ── 断言 ②：**双形态方向相反** —— 这是本轮最重要的读数，必须钉住 ─────────
       `only`（单件归因夹具，R7/R8/R9-06 口径）：缩短 rest ⇒ 承伤大降、剩余 HP 大升。
       `walk`（真实走查形态，R9F 口径）：缩短 rest ⇒ 第 1 段反而掉血更多。
       ⚠️ 两条都**不是**误测：同一个被测对象，只换了装配形态。⇒ 「rammer 该落几」不能只看单形态。 */
    const only24 = e1.get('only(frontMass: rammer)')!.get(BASELINE_REST_STEPS)!;
    const only12 = e1.get('only(frontMass: rammer)')!.get(landed)!;
    const walk24 = e1.get('walk(front: rammer + top/rear: machineGun)')!.get(BASELINE_REST_STEPS)!;
    const walk12 = e1.get('walk(front: rammer + top/rear: machineGun)')!.get(landed)!;
    // only 形态：缩短后承伤必须明显下降（验收 3 的归因口径）。
    expect(only12.taken, `only 形态：缩短后承伤必须明显下降（${only24.taken} → ${only12.taken}）`).toBeLessThan(
      only24.taken * 0.8,
    );
    // walk 形态：缩短后**承伤反而上升** —— 如实钉住这个「方向相反」的事实。
    expect(
      walk12.taken,
      `walk 形态：缩短后承伤反而上升（${walk24.taken} → ${walk12.taken}），与 only 形态方向相反`,
    ).toBeGreaterThan(walk24.taken);

    /* ── 断言 ③：`walk` 形态的底座读数 —— 「验收 4」在**真实走查形态**下的真实答案 ─
       ⚠️ 与 `RR-02`（`productDraft` 族：body+wheels+`frontMass` 武器）的「COMPLETE 恒 0」**不矛盾**：
          那是**另一族** chassis（武器挂在 `frontMass`、车上无 second weapon）；
          `walk` 族（武器挂 `front` + 上下位各一件 machineGun）**能**拿到 COMPLETE
          —— 靠的是 machineGun 的持续输出把第 3 段的控距对手磨死。
       ⇒ 验收 4（至少 1 条 ★1 产品可达 COMPLETE）**成立**，且落地值仍留 4 条；
          但它相对基线**收窄 6 → 4**（D1/D2 两条 `damageUp`/`rateUp` 组合翻成 FAILED），
          这是 R11 的**真实代价**，必须机器可见、写进交接文档，不能只报「验收通过」。 */
    const walkBase = walkRows.find((r) => r.rest === BASELINE_REST_STEPS)!;
    const walkLanded = walkRows.find((r) => r.rest === landed)!;
    expect(walkBase.complete.length, 'restSteps=24 时 walk/rammer 必须能走到 COMPLETE（R9F 冻结值）').toBeGreaterThan(0);
    expect(
      walkLanded.complete.length,
      `restSteps=${landed} 时 walk/rammer 必须仍有 ★1 可达 COMPLETE（验收 4：实测 ${walkLanded.complete.length} 条）`,
    ).toBeGreaterThan(0);
    // 收窄是**已实测**的事实（6 → 4），钉住它，避免将来被静默扩大或静默消失。
    expect(
      walkLanded.complete.length,
      `落地值相对基线的 COMPLETE 收窄（${walkBase.complete.length} → ${walkLanded.complete.length}）`,
    ).toBeLessThan(walkBase.complete.length);
    // 翻面的是 `damageUp`/`rateUp` 这两条组合（= R9F 的 D1/D2），其余四条 `emergencyRepair` 相关组合仍在。
    expect(walkBase.complete).toContain('[damageUp→rateUp]');
    expect(walkBase.complete).toContain('[rateUp→damageUp]');
    expect(walkLanded.complete).not.toContain('[damageUp→rateUp]');
    expect(walkLanded.complete).not.toContain('[rateUp→damageUp]');
    expect(walkLanded.complete.length, '第 3 段仍可打（不是中期崩溃）').toBeGreaterThan(0);
    expect(walkLanded.e2Win, 'restSteps=12 时 walk/rammer 仍能打进第 3 段（不是中期崩溃）').toBe(true);

    /* ── 断言 ④：整条 `walk` 轴上的读数必须与 console 表一致（防「只测两个点」）── */
    for (const row of walkRows) {
      const f = e1.get('walk(front: rammer + top/rear: machineGun)')!.get(row.rest)!;
      // 第 1 段单场归因与整条走查的第 1 段必须同源（同一 Draft、同一零 Build）。
      expect(f.winner, `restSteps=${row.rest}：walk 形态第 1 段必须取胜（否则后面根本走不到）`).toBe('A');
    }
  }, 900_000);

  /* ============================================================ RR-00b */
  it('RR-00b｜可达性守卫：本文件用到的 rammer / 轮组 / 车身 id 全在正式集合内', () => {
    expect(FULL_RUN_SUPPORTED_WEAPON_IDS).toContain('rammer');
    for (const w of ['smallWheel', 'largeWheel', 'heavyWheel']) {
      expect([...registry.movements.keys()]).toContain(w);
    }
    for (const b of ['mangoBody', 'coconutBody', 'watermelonBody']) {
      expect(OFFICIAL_BODIES).toContain(b);
    }
    expect(canStartFullRun(onlyDraft('rammer'))).toBe(true);
    expect(canStartFullRun(productDraft('watermelonBody', 'rammer', 'wheelStd', 'wheelStd'))).toBe(true);
  });
});
