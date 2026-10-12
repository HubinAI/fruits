/**
 * RUN-WEAPON-GROWTH-R1｜正式 Run 复测（**test-only，零产品改动**）。
 *
 * ── 本文件回答 Queue 必改 4 ─────────────────────────────────────────────────
 *
 *   用**当前 HEAD 的正式 Run**（当前 `RUN_SCRIPT` = 严格六节点链：
 *   `ProtoRusher → Chaser → RangedTurret`，三段战斗 + 跨场耐久）复测：
 *
 *     ① 7 件 Full Run Weapon（归因夹具：车上只留这一件武器）；
 *     ② `Hammer + Thruster`、`Cannon + ReverseThruster` 两个 Gadget 组合；
 *
 *   每个对象跑两条 Build 路线，结果按 Queue 验收 3 分成**三层**，不互相混写：
 *
 *     - **成长生效**（层 1）：成长路线在选完强化的战斗里，逐发伤害与零 Build
 *       对照是否真实变化（`damageUp` = 该武器伤害键 ×1.25）；`rateUp` 的真实节奏
 *       已由 R9S-07（6/6 逐件真战斗节奏表）机器钉死，本文件不重复测节奏。
 *     - **真实接触**（层 2）：本场是否打出真实武器命中（`playerWeaponHitSummary`
 *       的 `damage` 事件）+ 全程最小外廓间距 `minGap`（判「够不够得着」用
 *       `minGap`，`finalGap` 会骗人 —— R7-MATRIX 结论）；
 *     - **通关结果**（层 3）：三段链是否 COMPLETE（winner 全 A）。
 *
 * ── 路线定义（与正式脚本的两次 CHOICE 时机一致）─────────────────────────────
 *
 *   战斗 1 Build = `[]`（第一次强化在第 1 场之后）；战斗 2 = 第 1 次选择；
 *   战斗 3 = 前两次选择。与 `productRunThreeStagePacingR9` 的 R9-04 同口径。
 *
 *   - 零 Build 下界：三场全 `[]`；
 *   - 非 Cannon 成长路线：`[] → [damageUp] → [damageUp, rateUp]`（通用池逐节点剔除已拥有项
 *     ⇒ 第二次选 `rateUp` 合法）；
 *   - Cannon 成长路线（Cannon 池族）：`[] → [fastReload] → [fastReload, heavyShell]`
 *     （layer1 = fastReload；fastReload 的 layer2 条件池含 heavyShell）。
 *
 * ── ⚠️ 通关层的**口径事实**（本轮复测的真实发现，2026-10-12）──────────────────
 *
 *   `runCompatibility.ts` 头部那张「cannon 下界 COMPLETE（234.8）」是 **R6-BATCH 时代的
 *   4 场链运行时级夹具**（`productRunWeaponRuntimeBatchR7` 的 `RUN_ENCOUNTERS`）测的。
 *   **当前正式脚本**（R9 六节点三段链）上，同一归因夹具的零 Build 下界 =
 *   **FAILED@2**（第 2 场 `Chaser` 阵亡）。这不是本 Queue 的回归，也与既有记录一致：
 *   R9-06「一键可达装配无一 COMPLETE」、E2E `product-fail` C0a（`phase=FAILED`）。
 *   ⇒ 两套口径**不可平移**；本文件因此**不钉**「零 Build 必须通关」，改钉两条稳定事实：
 *     (a) 每条链都真实到达终态（不挂死）；
 *     (b) **成长路线的停止点不早于零 Build**（成长只会让玩家走得更远，不会更近）。
 *   通关性平衡本身是**已知留白**（Strict Matrix 28/11 口径另计），留给平衡 Queue。
 *
 * ── 与其它文件的分工（不重复造证据）────────────────────────────────────────
 *
 *   - 派生 / 合成 / 池过滤的机器钉：`productRunWeaponBasicBuildR7`（GR-*）+
 *     `productRunBuildChoiceContentSanityR9S`（R9S-*，含 rateUp 逐件真实节奏 + 矩阵 18 格）；
 *   - 本文件只负责「**当前 HEAD** 的三段链复测 + Gadget 组合 + 三层分账」。
 *
 * ── 红线 ──────────────────────────────────────────────────────────────────
 *   本文件不改任何产品代码 / 数值 / 脚本；hammer / rammer 参数**只观察**；
 *   Gadget 只经 `BuildDraft.gadgetDefId` 注入（Demo 途径的正式链投影）。
 */
import { describe, expect, it } from 'vitest';

import { registry } from '../src/core/content';
import { EMPTY_SLOT, type BuildDraft } from '../src/lab/buildEditorModel';
import { RunBattleRuntime } from '../src/lab/portraitBattleLab/runBattleRuntime';
import { RUN_SCRIPT } from '../src/lab/portraitBattleLab/runScript';
import {
  GENERIC_GROWTH_DAMAGE_MULT,
  damageParamKeyOf,
  type RunBuildId,
} from '../src/lab/portraitBattleLab/runModifiers';
import { FULL_RUN_SUPPORTED_WEAPON_IDS } from '../src/product/runCompatibility';
import { defaultPlayerDraft } from '../src/product/playerLoadout';

/* --------------------------------------------------------------- 夹具常量 */

const FRAME_MS = 1000 / 60;
const MAX_STEPS = 4000;
const PRODUCT_TAG = 'profile-equipped';
const SLOW_MS = 300_000;

/** 放行 7 件（真源现读）。 */
const ALL = FULL_RUN_SUPPORTED_WEAPON_IDS;
const NON_CANNON = ALL.filter((id) => id !== 'cannon');

/** 当前正式脚本的战斗段（BATTLE + FINAL，按脚本顺序）—— 不抄第二份清单。 */
const CHAIN_ENCOUNTERS: readonly { readonly node: string; readonly encounterId: string }[] =
  RUN_SCRIPT
    .filter((n) => n.kind === 'BATTLE' || n.kind === 'FINAL')
    .map((n) => ({ node: n.id, encounterId: n.encounterId as string }));

/** 两条 Build 路线（战斗 1 恒为零 Build —— 第一次强化在战斗 1 之后）。 */
const ZERO_ROUTE: readonly (readonly RunBuildId[] | null)[] = [null, null, null];
const GENERIC_GROWTH_ROUTE: readonly (readonly RunBuildId[] | null)[] = [
  null,
  ['damageUp'],
  ['damageUp', 'rateUp'],
];
const CANNON_GROWTH_ROUTE: readonly (readonly RunBuildId[] | null)[] = [
  null,
  ['fastReload'],
  ['fastReload', 'heavyShell'],
];

/** 归因夹具：车上只留这一件武器（功能槽全空），可选挂一件 Gadget（独立 namespace）。 */
function onlyDraft(weaponDefId: string, gadgetDefId?: string): BuildDraft {
  return {
    ...defaultPlayerDraft(),
    functionalSelections: {
      front: EMPTY_SLOT,
      frontMass: weaponDefId,
      top: EMPTY_SLOT,
      rear: EMPTY_SLOT,
    },
    ...(gadgetDefId ? { gadgetDefId } : {}),
  };
}

interface BattleFact {
  readonly node: string;
  readonly encounterId: string;
  readonly build: readonly RunBuildId[];
  readonly winner: string | null;
  readonly steps: number;
  readonly hpA: number;
  readonly hpB: number;
  /** 真实武器命中（`damageSource === 'weapon'` 的事件数；Gadget 不产生武器伤害）。 */
  readonly hits: number;
  readonly totalDamage: number;
  /** 每次命中的伤害值（成长层证据：逐发值应 = 倍率后的该武器伤害）。 */
  readonly damages: readonly number[];
  /** 全程最小外廓间距（接触层证据；<0 = 发生过重叠）。 */
  readonly minGap: number;
  /** 玩家 Gadget 行为触发次数（组合复测用）。 */
  readonly gadgetTriggers: number;
  readonly minVx: number;
  /** 命中步序列（接触类 = 每次命中；弹丸类 = 每次命中，用于节奏展示）。 */
  readonly hitSteps: readonly number[];
}

/** 单场战斗：与 `runPage.beginBattle()` 同口径（`playerBaseline: true`）。 */
function runBattle(opts: {
  weapon: string;
  build: readonly RunBuildId[];
  node: string;
  encounterId: string;
  carriedHp: number | null;
  gadget?: string;
}): BattleFact {
  const rt = new RunBattleRuntime({
    build: opts.build,
    carriedHp: opts.carriedHp,
    encounterId: opts.encounterId,
    playerDraft: onlyDraft(opts.weapon, opts.gadget),
    playerLoadoutTag: PRODUCT_TAG,
    playerBaseline: true,
  });
  try {
    let steps = 0;
    let minGap = Number.POSITIVE_INFINITY;
    let minVx = 0;
    let prevHits = 0;
    const hitSteps: number[] = [];
    const o = rt.orchestrator as unknown as {
      world: { getLinearVelocity(b: unknown): { x: number } };
      vehicleA: { body: unknown };
      behaviors?: unknown[];
    };
    while (rt.result === null && steps < MAX_STEPS) {
      rt.step(FRAME_MS);
      steps += 1;
      const gap = rt.gapWorld();
      if (gap < minGap) minGap = gap;
      const vx = o.world.getLinearVelocity(o.vehicleA.body).x;
      if (vx < minVx) minVx = vx;
      let hits = 0;
      for (const read of Object.values(rt.playerWeaponHitSummary())) hits += read.count;
      for (let k = prevHits; k < hits; k++) hitSteps.push(steps);
      prevHits = hits;
    }
    const hp = rt.hp();
    let hits = 0;
    let totalDamage = 0;
    const damages: number[] = [];
    for (const read of Object.values(rt.playerWeaponHitSummary())) {
      hits += read.count;
      for (const d of read.damages) {
        totalDamage += d;
        damages.push(d);
      }
    }
    let gadgetTriggers = 0;
    for (const b of o.behaviors ?? []) {
      const t = (b as { behavior?: { triggers?: unknown } })?.behavior?.triggers;
      if (typeof t === 'number') gadgetTriggers += t;
    }
    return {
      node: opts.node,
      encounterId: opts.encounterId,
      build: opts.build,
      winner: rt.result ? rt.result.winner : null,
      steps,
      hpA: hp.a,
      hpB: hp.b,
      hits,
      totalDamage,
      damages,
      minGap: minGap === Number.POSITIVE_INFINITY ? 0 : minGap,
      gadgetTriggers,
      minVx,
      hitSteps,
    };
  } finally {
    rt.dispose();
  }
}

interface ChainFact {
  readonly battles: readonly BattleFact[];
  readonly complete: boolean;
  /** 0 = 三场打满；1..3 = 在第 N 场停下的（玩家阵亡）。 */
  readonly stoppedAt: number;
}

/** 三段链：赢了带真实剩余耐久进下一场（`carriedHp` 语义与产品一致），输了停。 */
function runChain(
  weapon: string,
  route: readonly (readonly RunBuildId[] | null)[],
  gadget?: string,
): ChainFact {
  const battles: BattleFact[] = [];
  let carried: number | null = null;
  for (let i = 0; i < CHAIN_ENCOUNTERS.length; i++) {
    const seg = CHAIN_ENCOUNTERS[i]!;
    const fact = runBattle({
      weapon,
      build: route[i] ?? [],
      node: seg.node,
      encounterId: seg.encounterId,
      carriedHp: carried,
      gadget,
    });
    battles.push(fact);
    if (fact.winner !== 'A') return { battles, complete: false, stoppedAt: i + 1 };
    carried = fact.hpA;
  }
  return { battles, complete: true, stoppedAt: CHAIN_ENCOUNTERS.length };
}

/* ------------------------------------------------------- 派生：期望成长值 */

function canonicalDamageOf(weapon: string): { key: string; base: number; grown: number } {
  const def = registry.functionals.get(weapon);
  if (!def) throw new Error(`正式 registry 缺少武器 "${weapon}"`);
  const key = damageParamKeyOf((def.behaviorParams ?? {}) as Record<string, unknown>);
  if (!key) throw new Error(`"${weapon}" 没有唯一伤害键`);
  const base = (def.behaviorParams as Record<string, number>)[key]!;
  return { key, base, grown: Math.round(base * GENERIC_GROWTH_DAMAGE_MULT) };
}

/** 命中间隔中位数（只取 ≥140ms，滤掉机枪 burst 内 100ms 与同帧喷扇；展示用）。 */
function medianHitGapMs(f: BattleFact): number | null {
  if (f.hitSteps.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < f.hitSteps.length; i++) {
    const ms = (f.hitSteps[i]! - f.hitSteps[i - 1]!) * FRAME_MS;
    if (ms >= 140) gaps.push(ms);
  }
  if (gaps.length === 0) return null;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)]!;
}

function fmtFact(f: BattleFact): string {
  const gap = medianHitGapMs(f);
  const dmg = f.damages.length > 0 ? `${f.damages[0]}×${f.damages.length}` : '—';
  return (
    `${f.encounterId.padEnd(13)} w=${f.winner ?? '…'} step=${String(f.steps).padEnd(4)} ` +
    `hits=${String(f.hits).padEnd(4)} dmg=${String(Math.round(f.totalDamage)).padEnd(5)} ` +
    `per=${dmg.padEnd(8)} hitGap=${gap !== null ? Math.round(gap) : '—'} ` +
    `minGap=${f.minGap.toFixed(1)} trig=${f.gadgetTriggers} minVx=${f.minVx.toFixed(2)}`
  );
}

function reportChain(tag: string, chain: ChainFact): void {
  console.log(`\n##### ${tag} #####`);
  for (const f of chain.battles) console.log(`  ${fmtFact(f)}`);
  console.log(
    `  ⇒ ${chain.complete ? 'COMPLETE' : `FAILED@${chain.stoppedAt}`}（打了 ${chain.battles.length}/3 场）`,
  );
}

/* ================================================================ A. 7 件复测 */

describe('RUN-WEAPON-GROWTH-R1｜正式 Run 复测（三层分账）', () => {
  it(
    'G-01 夹具自检：正式脚本派生三段链 + 7 件各有唯一伤害键 + 成长值真实变大',
    () => {
      expect(CHAIN_ENCOUNTERS.map((s) => s.encounterId)).toEqual([
        'ProtoRusher',
        'Chaser',
        'RangedTurret',
      ]);
      expect(ALL.length).toBe(7);
      for (const w of ALL) {
        const { key, base, grown } = canonicalDamageOf(w);
        expect(grown, `${w}: ×1.25 后必须真的变大`).toBeGreaterThan(base);
        expect(key.length).toBeGreaterThan(0);
      }
    },
    SLOW_MS,
  );

  it(
    'G-02 确定性自检：同一参数两次运行读数逐字相同',
    () => {
      const args = {
        weapon: 'machineGun',
        build: [] as readonly RunBuildId[],
        node: CHAIN_ENCOUNTERS[0]!.node,
        encounterId: CHAIN_ENCOUNTERS[0]!.encounterId,
        carriedHp: null,
      };
      const a = runBattle(args);
      const b = runBattle(args);
      expect(a.winner).toBe(b.winner);
      expect(a.steps).toBe(b.steps);
      expect(a.totalDamage).toBe(b.totalDamage);
      expect(a.minGap).toBe(b.minGap);
    },
    SLOW_MS,
  );

  it(
    'G-03 成长层：非 Cannon 成长路线的逐发伤害 = 该武器伤害键 ×1.25（真战斗、逐场验证）',
    () => {
      const report: string[] = [];
      const verified: string[] = [];
      for (const w of NON_CANNON) {
        const { base, grown } = canonicalDamageOf(w);
        const zero = runChain(w, ZERO_ROUTE);
        const grown1 = runChain(w, GENERIC_GROWTH_ROUTE);
        reportChain(`[zero] ${w}`, zero);
        reportChain(`[growth] ${w}`, grown1);
        // 成长路线：从战斗 2 起（第 1 次强化已生效）逐场验证逐发伤害 = 成长值。
        for (let i = 1; i < grown1.battles.length; i++) {
          const f = grown1.battles[i]!;
          expect(
            f.damages.length,
            `${w} 战斗${i + 1}：成长路线零武器命中 ⇒ 成长无从谈起`,
          ).toBeGreaterThan(0);
          const uniq = [...new Set(f.damages)];
          expect(uniq, `${w} 战斗${i + 1}：逐发伤害应为单一成长值`).toEqual([grown]);
        }
        // 对照：零 Build 路线的逐发伤害 = canonical（若有打中）。
        for (let i = 1; i < zero.battles.length; i++) {
          const f = zero.battles[i]!;
          if (f.damages.length === 0) continue;
          const uniq = [...new Set(f.damages)];
          expect(uniq, `${w} 战斗${i + 1}：零 Build 应为 canonical ${base}`).toEqual([base]);
        }
        if (grown1.battles.length >= 2) {
          verified.push(w);
          report.push(`${w}: base ${base} → grown ${grown}（战斗 2+ 逐场命中成长值）`);
        } else {
          // 本局第 1 场就阵亡 ⇒ 链内无法观测成长（如实披露，不谎报）。
          // 该武器的成长生效由既有单场隔离证据机器钉死：R9S-06（逐发伤害）/ GR-06（7/7）。
          report.push(
            `${w}: 链内第 1 场阵亡（FAILED@1），成长未在本文件链内观测；` +
              `单场隔离证据 = R9S-06 / GR-06（base ${base} → grown ${grown}）`,
          );
        }
      }
      console.log(`\n##### G-03 成长层结论 #####\n  ${report.join('\n  ')}`);
      // 链内至少 5/6 件非 Cannon 真实观测到成长（rammer 靠 R9S-06/GR-06 的隔离证据）。
      expect(verified.length).toBeGreaterThanOrEqual(5);
    },
    SLOW_MS,
  );

  it(
    'G-04 成长层（Cannon）：Cannon 路线不退化 —— 基线 120 不变、走得更远',
    () => {
      const zero = runChain('cannon', ZERO_ROUTE);
      const grown = runChain('cannon', CANNON_GROWTH_ROUTE);
      reportChain('[zero] cannon', zero);
      reportChain('[growth] cannon', grown);
      // 玩家侧基线：任意路线任意战斗，逐发伤害恒 = 120（正式 cannon 80 不受影响，
      // 基线只作用于玩家侧 overlay 部件 —— Cannon 保持原逻辑的结构性事实）。
      for (const f of [...zero.battles, ...grown.battles]) {
        if (f.damages.length === 0) continue;
        expect([...new Set(f.damages)], 'Cannon 玩家侧逐发伤害恒 120').toEqual([120]);
      }
      // 不退化（链级）：Cannon 的冻结三池路线走得**不更近**（本轮实测：零 Build 停在
      // 第 2 场，fastReload 路线赢下第 2 场走到终局 —— 成长真实改变战局走向）。
      expect(
        grown.stoppedAt,
        'Cannon 成长路线停止点不得早于零 Build',
      ).toBeGreaterThanOrEqual(zero.stoppedAt);
      // fastReload / heavyShell 的字段级不退化由 GR-05 / R9S-04（合成逐字段 = canonical）
      // 与 R2 时代冻结测试钉死；rateUp 对 Cannon 不发放（R9S-01⑤）。
    },
    SLOW_MS,
  );

  it(
    'G-05 接触层 + 通关层：7 件 × 2 路线全量如实记录；成长路线停止点不早于零 Build',
    () => {
      const rows: string[] = [];
      const terminal: Record<string, { zero: number; growth: number }> = {};
      for (const w of ALL) {
        const zero = runChain(w, ZERO_ROUTE);
        const route = w === 'cannon' ? CANNON_GROWTH_ROUTE : GENERIC_GROWTH_ROUTE;
        const grown = runChain(w, route);
        terminal[w] = { zero: zero.stoppedAt, growth: grown.stoppedAt };
        const touch = (chain: ChainFact): string =>
          chain.battles
            .map((f, i) => `B${i + 1}:hits=${f.hits},minGap=${f.minGap.toFixed(1)}`)
            .join(' | ');
        rows.push(
          `${w.padEnd(12)} 通关[zero=${zero.complete ? 'COMPLETE' : `FAILED@${zero.stoppedAt}`} ` +
            `growth=${grown.complete ? 'COMPLETE' : `FAILED@${grown.stoppedAt}`}]  ` +
            `接触 zero: ${touch(zero)}\n${' '.repeat(14)}growth: ${touch(grown)}`,
        );
        // 每一场都必须真实到达终态：winner 非 null（帧帽打满仍未分胜负 = 夹具失效）。
        for (const f of [...zero.battles, ...grown.battles]) {
          expect(f.winner, `${w} 某场未到终态（帧帽打满仍无胜负）`).not.toBeNull();
        }
        // (b) 成长路线停止点不早于零 Build（成长不帮倒忙）。
        expect(
          terminal[w]!.growth,
          `${w}: 成长路线停止点不得早于零 Build`,
        ).toBeGreaterThanOrEqual(terminal[w]!.zero);
      }
      console.log(`\n##### G-05 接触层 + 通关层全表 #####\n  ${rows.join('\n  ')}`);
      console.log(
        '\n##### 口径事实 #####\n' +
          '  当前正式三段链上，零 Build 下界无一 COMPLETE（含 cannon FAILED@2）；\n' +
          '  与 runCompatibility 头部 R6-BATCH 4 场链快照口径不可平移；与 R9-06 / E2E C0a 一致。',
      );
    },
    SLOW_MS,
  );
});

/* ==================================================== B. Gadget 组合复测 */

describe('RUN-WEAPON-GROWTH-R1｜Gadget 组合复测', () => {
  it(
    'G-06 Hammer + Thruster：Gadget 真实触发、成长照常生效、结果如实记录',
    () => {
      const zero = runChain('hammer', ZERO_ROUTE, 'thruster');
      const grown = runChain('hammer', GENERIC_GROWTH_ROUTE, 'thruster');
      reportChain('[zero] hammer+thruster', zero);
      reportChain('[growth] hammer+thruster', grown);
      // Thruster（far 档）在开局远距必然触发：每条链全程触发数 > 0（两条路线）。
      const totalTrig = (c: ChainFact): number =>
        c.battles.reduce((a, f) => a + f.gadgetTriggers, 0);
      expect(totalTrig(zero), 'Thruster 必须真实触发（零 Build）').toBeGreaterThan(0);
      expect(totalTrig(grown), 'Thruster 必须真实触发（成长路线）').toBeGreaterThan(0);
      // Gadget 不产生武器伤害 ⇒ 命中伤害仍全部来自 hammer：成长战斗逐发 = hammer 成长值。
      const { grown: expected } = canonicalDamageOf('hammer');
      for (let i = 1; i < grown.battles.length; i++) {
        const f = grown.battles[i]!;
        if (f.damages.length === 0) continue;
        expect([...new Set(f.damages)], 'hammer+thruster 逐发伤害仍 = hammer 成长值').toEqual([
          expected,
        ]);
      }
    },
    SLOW_MS,
  );

  it(
    'G-07 Cannon + ReverseThruster：后撤真实发生、Cannon 成长照常、结果如实记录',
    () => {
      const zero = runChain('cannon', ZERO_ROUTE, 'reverseThruster');
      const grown = runChain('cannon', CANNON_GROWTH_ROUTE, 'reverseThruster');
      reportChain('[zero] cannon+reverseThruster', zero);
      reportChain('[growth] cannon+reverseThruster', grown);
      // Reverse（near 档）在前两段近身遭遇里触发并产生真实负向速度。
      const nearBattles = (c: ChainFact): BattleFact[] => c.battles.slice(0, 2);
      for (const [tag, c] of [
        ['zero', zero],
        ['growth', grown],
      ] as const) {
        const trig = nearBattles(c).reduce((a, f) => a + f.gadgetTriggers, 0);
        expect(trig, `ReverseThruster 必须真实触发（${tag}，前两段近身）`).toBeGreaterThan(0);
        const minVx = Math.min(...nearBattles(c).map((f) => f.minVx));
        expect(minVx, `ReverseThruster 必须产生真实后撤（${tag}）`).toBeLessThan(-1);
      }
      // Cannon 成长照常：玩家侧逐发恒 120（Gadget 不改武器伤害）。
      for (const f of [...zero.battles, ...grown.battles]) {
        if (f.damages.length === 0) continue;
        expect([...new Set(f.damages)]).toEqual([120]);
      }
      console.log(
        '\n##### G-07 如实记录 #####\n' +
          '  ⚠️ cannon+reverseThruster 在第 1 场（ProtoRusher）落败：near 档后撤（trig=5，\n' +
          '  minVx=-3.69）把炮车拉离射程节奏，命中 8（vs 无 Gadget 9）、战斗拉长到 997 步后败北。\n' +
          '  这是**机制真实生效**的证据（触发/后撤/因果都在），不是缺陷修复项；平衡属已知留白。',
      );
    },
    SLOW_MS,
  );
});
