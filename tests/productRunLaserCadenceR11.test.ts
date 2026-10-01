/**
 * PRODUCT-LOOP-R11-LASER-CADENCE-R1｜Laser「两次攻击之间的节奏」取证与落地。
 *
 * ── 第一步｜节奏真源（LC-00 固化）──────────────────────────────────────────────
 *   laser 的**蓄能前摇**与**攻击间隔**是两个独立字段，都在 canonical
 *   `content.ts` 的 `laser.behaviorParams`：
 *     · `chargeMs = 1500`  → `LaserBehavior` 里 `chargeStepsTotal`（前摇，**身份**，不动）
 *     · `cooldownMs = 1800 → 600`（本轮落地）→ `fire()` 之后设置 `cooldownStepsRemaining`（**攻击间隔**）
 *   `laserBehavior.ts` 里 `cooldownMs` 的**唯一**用途 = `Math.ceil(cooldownMs / FIXED_DT_MS)`
 *   写入冷却步数；它**不参与**伤害 / 速度 / 几何 / 命中判定。
 *   ⇒ 只改 `cooldownMs` **结构上不可能**改到 damage / charge / range。
 *
 * ── 本 Queue 的因果链（先测量，再落值）─────────────────────────────────────────
 *   「E1 只有 5 发 / 800 伤害」的直接原因是 **攻击周期 = chargeMs + cooldownMs = 3300ms**：
 *   首发的 1500ms 前摇是身份（保留），但之后每一发都要再等 3300ms ⇒ 一场 ~1016 步
 *   （17s）的战斗里**只装得下 5 发**（步号 90/289/488/687/886）。缩短 `cooldownMs`
 *   只压缩「两发之间的间隔」。
 *
 * ── 落地值（LC-02 严格全枚举探针，body×front×rear = 8×5×5 = 200）──────────────
 *
 *   | cooldownMs | 两发间隔 | ★1 可达 COMPLETE 路径 | 赢 E1 chassis | 赢 E1&E2 |
 *   |---|---|---|---|---|
 *   | **1800（改前基线）** | 199 步 | **0** | 27/200 | 0/200 |
 *   | 1200（缩短一级） | 163 步 | 0 | 57/200 | 6/200 |
 *   | 900 | 145 步 | 0 | 160/200 | 27/200 |
 *   | **600（落地）** | **127 步** | **2 条 / 1 个 chassis** | 199/200 | 131/200 |
 *
 *   ⇒ 跨过门槛的正是 **600**：`watermelonBody + heavyWheel(前) + heavyWheel(后)` 在
 *      `[damageUp→emergencyRepair]` 与 `[emergencyRepair→damageUp]` 两条 Build 顺序下都 COMPLETE。
 *   ⇒ `chargeMs` **未动**（1500ms），每个周期里前摇仍占 5/6 ⇒ 「明显蓄能后发射」的身份保留。
 *   ⇒ laser 落地后仍是**最慢的**一件（周期 2100ms > flamethrower 1600 > shotgun 1300 >
 *      machineGun 1100 > cannon 1000）。
 *
 * ── 测量纪律 ───────────────────────────────────────────────────────────────
 *   全部读数来自真实 `RunBattleRuntime`；候选值探针在内存里临时改写共享 def 的
 *   `behaviorParams.cooldownMs`（`finally` 无条件还原），**不改 `content.ts`**。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { registry } from '../src/core/content';
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
import { OFFICIAL_BODIES } from '../src/core/bodyOwnership';
import { FULL_RUN_SUPPORTED_WEAPON_IDS, canStartFullRun } from '../src/product/runCompatibility';
import { WEAPON_SLOT, defaultPlayerDraft } from '../src/product/playerLoadout';
import type { RunBuildId } from '../src/lab/portraitBattleLab/runModifiers';

const FRAME_MS = 1000 / 60;
const MAX_FRAMES = 4000;
const PRODUCT_TAG = 'profile-equipped';

/** 改前基线（`PRODUCT-LOOP-R11-LASER-CADENCE-R1` 之前 laser 的 `cooldownMs`）。 */
const BASELINE_COOLDOWN_MS = 1800;
/** 本轮探针扫过的档位（`current → 明显缩短一级 → 两级`，外加落地值）。 */
const PROBE_COOLDOWNS: readonly number[] = [1800, 1200, 900];

const WHEELS: readonly string[] = ['wheelStd', 'smallWheel', 'largeWheel', 'heavyWheel', 'none'];
const WHEEL_RADIUS: Readonly<Record<string, number>> = (() => {
  const m: Record<string, number> = { none: 20 };
  for (const def of registry.movements.values()) m[def.id] = def.radius ?? 20;
  return m;
})();

/** 真实产品可达 Draft：车身 + 主武器（frontMass）+ 前/后轮；top 恒 EMPTY（来自产品默认车）。 */
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

/** 在内存里临时改写共享 laser def 的 `cooldownMs`（finally 必还原；不改 src）。 */
function withLaserCooldown<T>(cooldownMs: number, fn: () => T): T {
  const def = registry.functionals.get('laser');
  if (!def) throw new Error('laser 必须在正式内容库');
  const bp = def.behaviorParams as Record<string, unknown>;
  const prev = bp.cooldownMs;
  bp.cooldownMs = cooldownMs;
  try {
    return fn();
  } finally {
    bp.cooldownMs = prev;
  }
}

const round1 = (x: number): number => Math.round(x * 10) / 10;

interface ShotFacts {
  /** 每次 weaponFire（laser）的事件时刻（ms），按发生顺序。 */
  fireMs: number[];
  /** 每次 fire 时的物理步号（= fireMs / FRAME_MS 四舍五入）。 */
  fireSteps: number[];
  /** 真实命中（damage 事件，damageSource='weapon'，target='B'）次数与累计伤害。 */
  hits: number;
  damage: number;
  /** 逐发命中伤害（用于证明「单发伤害不变、变的是发数」）。 */
  hitDamages: number[];
  firstHitStep: number | null;
  winner: 'A' | 'B' | null;
  endReason: string | null;
  steps: number;
  hpA: number;
  hpB: number;
}

/** 单场隔离（满耐久 / 指定 Build）：只记「激光真实发射次数」与「真实命中伤害」。 */
function laserBattleFacts(
  draft: BuildDraft,
  build: readonly RunBuildId[],
  encounterId: string,
  carriedHp: number | null = null,
): ShotFacts {
  const rt = new RunBattleRuntime({
    build: [...build],
    carriedHp,
    encounterId,
    playerDraft: draft,
    playerLoadoutTag: PRODUCT_TAG,
    playerBaseline: true,
  });
  const fireMs: number[] = [];
  const fireSteps: number[] = [];
  const hitDamages: number[] = [];
  let hits = 0;
  let damage = 0;
  let firstHitStep: number | null = null;
  const off = rt.orchestrator.onCombatEvent((ev) => {
    if (ev.type === 'weaponFire' && ev.behavior === 'laser') {
      fireMs.push(ev.timestamp);
      fireSteps.push(Math.round(ev.timestamp / FRAME_MS));
    }
    if (ev.type === 'damage' && ev.damageSource === 'weapon' && ev.target === 'B') {
      hits += 1;
      damage += ev.damage;
      hitDamages.push(ev.damage);
      if (firstHitStep === null) firstHitStep = Math.round(ev.timestamp / FRAME_MS);
    }
  });
  try {
    let steps = 0;
    while (rt.result === null && steps < MAX_FRAMES) {
      rt.step(FRAME_MS);
      steps += 1;
    }
    const hp = rt.hp();
    return {
      fireMs,
      fireSteps,
      hits,
      damage,
      hitDamages,
      firstHitStep,
      winner: rt.result?.winner ?? null,
      endReason: rt.result?.endReason ?? null,
      steps,
      hpA: round1(hp.a),
      hpB: round1(hp.b),
    };
  } finally {
    off();
    rt.dispose();
  }
}

interface LeafOutcome {
  builds: string[];
  phase: string;
  stages: number;
  finalHpA: number;
}

/**
 * **严格分层全枚举**（与 `productRunFullReachableSpaceR10` 同一口径，不用代表路线剪枝）：
 *   E1 输 ⇒ 该 chassis 安全剪枝（不枚举 Build）；E1 赢 ⇒ 枚举 Choice1 **全部**合法项，各跑 E2；
 *   E2 赢 ⇒ 枚举 Choice2 **全部**合法项，各跑 E3；E3 赢 ⇒ 记一条 COMPLETE 路径。
 * 状态机天然实现分层（FAILED 分支不展开）。
 */
function simulateStrict(draft: BuildDraft, ctx: RunPageContext): LeafOutcome[] {
  if (!canStartFullRun(draft)) return [{ builds: [], phase: 'INVALID', stages: 0, finalHpA: 0 }];
  const out: LeafOutcome[] = [];
  const walk = (s: RunPageState, carry: number | null, builds: string[], stages: number): void => {
    if (s.phase === 'COMPLETE' || s.phase === 'FAILED') {
      out.push({ builds, phase: s.phase, stages, finalHpA: round1(carry ?? 0) });
      return;
    }
    if (s.phase === 'BATTLE') {
      const node = runCurrentNode(s);
      const f = laserBattleFacts(draft, runBuildIds(s), node.encounterId ?? '', carry);
      walk(
        finishRunBattle(s, {
          winner: f.winner,
          endReason: f.endReason,
          playerHp: f.hpA,
          enemyHp: f.hpB,
          steps: f.steps,
        }),
        f.hpA,
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

interface ChassisScan {
  body: string;
  front: string;
  rear: string;
  leaves: LeafOutcome[];
}

/** 扫全部产品可达 laser chassis（body × front × rear），每个跑严格全枚举。 */
function scanLaserChassis(): ChassisScan[] {
  const rows: ChassisScan[] = [];
  for (const body of OFFICIAL_BODIES) {
    for (const front of WHEELS) {
      for (const rear of WHEELS) {
        const draft = productDraft(body, 'laser', front, rear);
        const key = `lc|${body}|laser|${front}|${rear}`;
        const ctx = runPageContext({ source: 'profile', label: key, draft, tag: PRODUCT_TAG, key });
        rows.push({ body, front, rear, leaves: simulateStrict(draft, ctx) });
      }
    }
  }
  return rows;
}

describe('PRODUCT-LOOP-R11-LASER-CADENCE-R1｜Laser 节奏（只调 cooldownMs）', () => {
  /* ============================================================ LC-00 */
  it('LC-00｜节奏真源：charge/cooldown 是两个独立字段；cooldownMs 只换算冷却步数，不碰伤害/速度', () => {
    const laser = registry.functionals.get('laser');
    expect(laser, 'laser 必须在正式内容库').toBeTruthy();
    const bp = laser!.behaviorParams as Record<string, unknown>;
    const keys = Object.keys(bp).sort();
    expect(keys).toEqual(
      [
        'chargeMs',
        'cooldownMs',
        'muzzleSpeed',
        'projectileDamage',
        'projectileMass',
        'projectileRadius',
        'recoilImpulse',
      ].sort(),
    );
    expect(bp.chargeMs, '前摇 = 身份，本轮不动（1800 → 600 的改动**只**动 cooldownMs）').toBe(1500);
    expect(bp.cooldownMs, '落地值：攻击间隔（改前基线 1800，见 LC-01 用探针复现）').toBe(600);
    expect(bp.projectileDamage, '伤害不动').toBe(160);
    expect(bp.cooldownMs, '必须真的与改前基线不同（否则本轮没落地）').not.toBe(1800);
    expect(bp.cooldownMs, '必须仍有明显冷却（不是归零）').toBeGreaterThan(0);
    expect(bp.muzzleSpeed, '速度不动').toBe(56);
    expect(laser!.collider, '几何不动').toEqual({
      shape: 'box',
      width: 40,
      height: 20,
      offset: { x: 20, y: 0 },
    });

    // 结构真源（源码守卫，匹配前剥注释）：behavior 里 `cooldownMs` **唯一**用途 = 换算冷却步数；
    //   `fire()` 发射路径（伤害 / 炮口 / 速度 / 几何）里 **零** `cooldownMs` 引用
    //   ⇒ 改它**结构上不可能**碰到伤害 / 前摇 / 射程。
    const src = readFileSync(join(__dirname, '..', 'src', 'battle', 'laserBehavior.ts'), 'utf8');
    const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    expect(
      noComments.match(/Math\.ceil\(this\.params\.cooldownMs \/ FIXED_DT_MS/g)?.length,
      'cooldownMs 只在一处换算冷却步数',
    ).toBe(1);
    const fireBody = noComments.slice(noComments.indexOf('private fire('));
    expect(fireBody.length, '必须能定位到 fire() 发射路径').toBeGreaterThan(100);
    expect(fireBody.includes('cooldownMs'), 'fire() 发射路径不得引用 cooldownMs').toBe(false);
    expect(fireBody.includes('chargeMs'), 'fire() 发射路径不得引用 chargeMs（前摇与发射解耦）').toBe(false);
    // 前摇真源：chargeMs 只用于 chargeStepsTotal
    expect(
      noComments.match(/Math\.ceil\(this\.params\.chargeMs \/ FIXED_DT_MS/g)?.length,
      'chargeMs 只在一处换算蓄能步数',
    ).toBe(1);
  });

  /* ============================================================ LC-01 */
  it('LC-01｜改前基线（1800，探针复现）：首发仍有明确蓄能前摇；E1 攻击次数被总周期压到很少', () => {
    const draft = productDraft('watermelonBody', 'laser', 'wheelStd', 'wheelStd');
    // ⚠️ 用**探针**复现改前的 1800：落地后 canonical 已是 600，基线必须显式指定才能复现。
    const e1 = withLaserCooldown(1800, () => laserBattleFacts(draft, [], 'ProtoRusher'));
    const lines: string[] = [];
    lines.push('');
    lines.push('【LC-01｜改前基线 laser（探针 cooldownMs=1800, chargeMs=1500）】');
    lines.push(`   首发步号=${e1.fireSteps[0]}（≈${e1.fireMs[0]}ms，明显蓄能前摇）`);
    lines.push(`   全部发射步号 = [${e1.fireSteps.join(', ')}]（共 ${e1.fireSteps.length} 发）`);
    const gaps = e1.fireSteps.slice(1).map((s, i) => +(s - e1.fireSteps[i]!).toFixed(1));
    lines.push(`   两发间隔（步） = [${gaps.join(', ')}]（理论 = 1 + ceil(1500/16.667) + ceil(1800/16.667) = 199 步）`);
    lines.push(
      `   E1 结果 = ${e1.winner ?? '?'}/${e1.endReason ?? '?'}：命中 ${e1.hits} 发 / ${e1.damage} 伤 · ` +
        `总步数 ${e1.steps} · HP ${e1.hpA} vs ${e1.hpB}`,
    );
    // eslint-disable-next-line no-console
    console.log('\n' + lines.join('\n') + '\n');

    // 验收 1：首发仍有明确蓄能前摇（≈ chargeMs = 90 步）。
    expect(e1.fireSteps[0], '首发步号 ≈ chargeMs/16.667 = 90 步').toBeGreaterThanOrEqual(88);
    expect(e1.fireSteps[0], '首发步号 ≤ 92（确实是 1500ms 前摇）').toBeLessThanOrEqual(92);
    // 基线事实：两发间隔 = 1 + ceil(chargeMs/dt) + ceil(cooldownMs/dt)
    //   （1 = 「冷却归零 → 开始蓄能」那一个过渡步；数值**从 canonical 现读**，不写死）
    const laserBp = registry.functionals.get('laser')!.behaviorParams as Record<string, number>;
    const expectedGap =
      1 +
      Math.ceil(laserBp.chargeMs! / FRAME_MS - 1e-9) +
      Math.ceil(BASELINE_COOLDOWN_MS / FRAME_MS - 1e-9);
    expect(gaps.length, '基线至少打出 2 发（可测间隔）').toBeGreaterThanOrEqual(1);
    expect(gaps[0], `基线两发间隔 = 1 + 90 + 108 = ${expectedGap} 步`).toBe(expectedGap);
    // 基线结论：E1 打不出足够伤害（对手 HP 1000）
    expect(e1.damage, '基线 E1 累计伤害 < 对手满血').toBeLessThan(1000);
  }, 300_000);

  /* ============================================================ LC-01b */
  it('LC-01b｜单一变量验证：改 cooldownMs 只改「两发间隔」，首发前摇与单发伤害逐字节不变', () => {
    const draft = productDraft('watermelonBody', 'laser', 'wheelStd', 'wheelStd');
    const landed = (registry.functionals.get('laser')!.behaviorParams as Record<string, number>).cooldownMs!;
    const base = withLaserCooldown(BASELINE_COOLDOWN_MS, () => laserBattleFacts(draft, [], 'ProtoRusher'));
    const fast = withLaserCooldown(landed, () => laserBattleFacts(draft, [], 'ProtoRusher'));
    const lines: string[] = [];
    lines.push('');
    lines.push(`【LC-01b｜cooldownMs ${BASELINE_COOLDOWN_MS} → ${landed}：什么变了 / 什么没变】`);
    lines.push(`   首发步号      : 基线 ${base.fireSteps[0]} → 探针 ${fast.fireSteps[0]}`);
    lines.push(`   单发命中伤害  : 基线 [${[...new Set(base.hitDamages)].join(', ')}] → 探针 [${[...new Set(fast.hitDamages)].join(', ')}]`);
    lines.push(`   发射总数      : 基线 ${base.fireSteps.length} 发 → 探针 ${fast.fireSteps.length} 发`);
    lines.push(`   累计伤害      : 基线 ${base.damage} → 探针 ${fast.damage}`);
    lines.push(`   E1 结果       : 基线 ${base.winner}（HP ${base.hpA} vs ${base.hpB}）→ 探针 ${fast.winner}（HP ${fast.hpA} vs ${fast.hpB}）`);
    // eslint-disable-next-line no-console
    console.log('\n' + lines.join('\n') + '\n');

    // ① 前摇不变：首发步号逐字节相同（chargeMs 未动）。
    expect(fast.fireSteps[0], '首发步号不变（前摇是身份）').toBe(base.fireSteps[0]);
    // ② 单发伤害不变：每次命中的 damage 集合相同（伤害是另一件事）。
    expect([...new Set(fast.hitDamages)].sort(), '单发伤害集合不变').toEqual(
      [...new Set(base.hitDamages)].sort(),
    );
    // ③ 发射次数真的变多（节奏变量生效）。
    expect(fast.fireSteps.length, '缩短 cooldown ⇒ 发射次数增加').toBeGreaterThan(base.fireSteps.length);
    // ④ 两发间隔按新 cooldown 缩短（1 + 90 + ceil(600/16.667)=36 ⇒ 127 步）。
    const laserBp = registry.functionals.get('laser')!.behaviorParams as Record<string, number>;
    const probeGap =
      1 +
      Math.ceil(laserBp.chargeMs! / FRAME_MS - 1e-9) + // 90（前摇，未动）
      Math.ceil(landed / FRAME_MS - 1e-9); // 落地冷却换算出的步数
    const gap = fast.fireSteps[1]! - fast.fireSteps[0]!;
    expect(gap, `间隔 = 1 + 90 + ${Math.ceil(landed / FRAME_MS - 1e-9)} = ${probeGap} 步`).toBe(probeGap);
    expect(gap, '间隔明显小于基线的 199 步').toBeLessThan(base.fireSteps[1]! - base.fireSteps[0]!);
    // ⑤ 累计伤害随发数上升。
    expect(fast.damage, '累计伤害上升').toBeGreaterThan(base.damage);
  }, 300_000);

  /* ============================================================ LC-02 */
  it('LC-02｜cooldown 离散探针（严格分层全枚举）：缩短 cooldown ⇒ 发射更多 ⇒ 出现 ★1 可赢 chassis', () => {
    // 探针档位 + **落地值**（从 canonical 现读 ⇒ 未来再调参也会被本测试重新评估）。
    const landed = (registry.functionals.get('laser')!.behaviorParams as Record<string, number>).cooldownMs!;
    const CANDIDATES: readonly number[] = [...new Set([...PROBE_COOLDOWNS, landed])].sort((a, b) => b - a);
    expect(CANDIDATES[CANDIDATES.length - 1], '最后一档 = canonical 落地值').toBe(landed);
    const lines: string[] = [];
    interface Row {
      cd: number;
      complete: string[];
      e1Win: number;
      e2Win: number;
      bestHp: number;
      best: string;
      leaves: number;
    }
    const summary: Row[] = [];
    for (const cd of CANDIDATES) {
      const scans = withLaserCooldown(cd, () => scanLaserChassis());
      const complete: string[] = [];
      let e1Win = 0;
      let e2Win = 0;
      let leaves = 0;
      let bestHp = -1;
      let best = '';
      for (const sc of scans) {
        leaves += sc.leaves.length;
        const maxStage = sc.leaves.reduce((m, l) => Math.max(m, l.stages), 0);
        if (maxStage >= 2) e1Win += 1;
        if (maxStage >= 3) e2Win += 1;
        for (const l of sc.leaves) {
          if (l.phase === 'COMPLETE') complete.push(`${sc.body}/${sc.front}/${sc.rear}[${l.builds.join('→')}]`);
          if (l.stages > 0 && l.finalHpA > bestHp) {
            bestHp = l.finalHpA;
            best = `${sc.body}/${sc.front}/${sc.rear}`;
          }
        }
      }
      summary.push({ cd, complete, e1Win, e2Win, bestHp, best, leaves });
      lines.push(
        `   · cooldownMs=${cd}（两发间隔 ${1 + 90 + Math.ceil(cd / FRAME_MS - 1e-9)} 步）: ` +
          `COMPLETE 路径 ${complete.length} 条 / chassis ${new Set(complete.map((c) => c.split('[')[0])).size} 个 · ` +
          `赢E1 ${e1Win}/200 · 赢E1&E2 ${e2Win}/200 · 叶子 ${leaves} · 最佳终局HP ${bestHp}（${best}）`,
      );
      if (complete.length > 0) {
        lines.push(
          `       样例 = ${complete.slice(0, 8).join(' | ')}${complete.length > 8 ? ' …' : ''}`,
        );
      }
    }
    // eslint-disable-next-line no-console
    console.log(
      '\n【LC-02｜cooldownMs 离散探针（**严格分层全枚举**，非代表路线；body×front×rear = 8×5×5 = 200）】\n' +
        lines.join('\n') +
        '\n',
    );

    // ① 方向性：单一变量 = cooldownMs ⇒ 缩短后「赢 E1 的 chassis 数」单调不减。
    for (let i = 1; i < summary.length; i++) {
      expect(
        summary[i]!.e1Win,
        `cooldown ${CANDIDATES[i]} 赢E1 不该少于 ${CANDIDATES[i - 1]}（${summary[i]!.e1Win} vs ${summary[i - 1]!.e1Win}）`,
      ).toBeGreaterThanOrEqual(summary[i - 1]!.e1Win);
    }
    // ② 基线（1800）严格全枚举下激光 COMPLETE = 0（与 R10 权威矩阵同结论）。
    expect(summary[0]!.complete.length, '基线 laser COMPLETE 路径 = 0').toBe(0);
    // ③ 明显缩短后**必须**出现 ★1 产品可达 COMPLETE（本 Queue 的核心假设）。
    expect(
      summary[summary.length - 1]!.complete.length,
      '最短 cooldown 档必须出现 ≥1 条 ★1 产品可达 COMPLETE 路径',
    ).toBeGreaterThan(0);
  }, 1_800_000);

  /* ============================================================ LC-00b */
  it('LC-00b｜可达性守卫：本文件用到的 laser / 轮组 / 车身 id 全在正式集合内', () => {
    expect(FULL_RUN_SUPPORTED_WEAPON_IDS).toContain('laser');
    for (const w of ['smallWheel', 'largeWheel', 'heavyWheel']) {
      expect([...registry.movements.keys()]).toContain(w);
    }
    for (const b of ['mangoBody', 'coconutBody', 'watermelonBody']) {
      expect(OFFICIAL_BODIES).toContain(b);
    }
    expect(canStartFullRun(productDraft('watermelonBody', 'laser', 'wheelStd', 'wheelStd'))).toBe(true);
  });
});
