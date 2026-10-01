/**
 * PRODUCT-LOOP-R10-STRATEGY-SPACE-CAUSAL-AUDIT-R1｜**策略空间因果审计**（测量工具，非回归守卫）。
 *
 * 与 `productRunFullReachableSpaceR10.test.ts`（唯一权威矩阵）配套：矩阵回答「哪些配车/路径能赢」，
 * 本文件回答「**为什么**这些配车能赢 / 那些配车赢不了」——**只取证与因果归因，不调任何参数**。
 *
 * ── 必做 3｜Movement 因果（只换一个轮子，其余完全相同）─────────────────────────
 *   固定 Body + Weapon + Rear + Build，只替换 Front：smallWheel → wheelStd → largeWheel → heavyWheel → none；
 *   再固定 Front，只替换 Rear。逐场记录：轮半径/轮中心高度、车身姿态（y / pitch）、
 *   `frontMass` 挂点世界坐标、各段首次有效命中时刻、RangedTurret 最小 gap、玩家受损。
 *
 * ── 必做 4｜Body 因果（只换车身）────────────────────────────────────────────
 *   固定 Weapon + Front + Rear + Build，只替换 Body。记录 hp / baseMass / 前挂点几何 / 姿态 / 首次命中 / 每段剩余 HP。
 *
 * ── 必做 5｜三件 0-COMPLETE 武器分开归因 ────────────────────────────────────
 *   hammer / laser / rammer 各自深探：接触是否发生、有效命中次数与节奏、伤害输出/承受、
 *   Movement/Body 能否改变攻击窗口。
 *
 * ⚠️ 一切读数来自真实 `RunBattleRuntime`（正式 Planck 编排器 + 正式相机无关的战斗栈），
 *    逐帧采样公开只读 API（`snapshot()` / `gapWorld()` / `hp()` / `playerWeaponHitSummary()` /
 *    `enemyDriveState()` / `contactResidue()`），**不读编排器私有字段、不写 src**。
 */

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

const FRAME_MS = 1000 / 60;
const MAX_FRAMES = 4000;
const PRODUCT_TAG = 'profile-equipped';
/** 采样「稳定姿态」的帧号（≈1s，车已在轮上坐稳）。 */
const SETTLE_FRAME = 60;

/** 前/后轮全部正式允许状态（与权威矩阵同口径）。 */
const WHEELS: readonly string[] = ['wheelStd', 'smallWheel', 'largeWheel', 'heavyWheel', 'none'];
const WHEEL_RADIUS: Readonly<Record<string, number>> = (() => {
  const m: Record<string, number> = { none: 20 };
  for (const def of registry.movements.values()) m[def.id] = def.radius ?? 20;
  return m;
})();

/** 与权威矩阵逐字同源的真实产品可达 Draft 构造（基底 = 真实产品默认车；top EMPTY 来自产品）。 */
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

interface StageProbe {
  encounter: string;
  winner: 'A' | 'B' | null;
  playerHpStart: number;
  playerHpEnd: number;
  damageTaken: number;
  enemyHpStart: number;
  enemyHpEnd: number;
  hits: number;
  dealt: number;
  firstHitMs: number | null;
  hitTimes: number[];
  minGapWorld: number;
  minGapCore: number | null;
  contact: boolean;
  impact: boolean;
  contactDamage: boolean;
  /** 车体稳定（第 SETTLE_FRAME 帧）y（世界）/ pitch。 */
  chassisY: number;
  chassisPitch: number;
  /** 前/后轮中心 y（世界，稳定帧）。 */
  wheelFrontY: number;
  wheelRearY: number;
  /** `frontMass` 挂点世界坐标（稳定帧）。 */
  frontMassX: number;
  frontMassY: number;
}

interface PathResult {
  phase: string;
  stages: StageProbe[];
  finalHp: number;
}

const round1 = (x: number): number => Math.round(x * 10) / 10;

/** 跑一场独立战斗并逐帧采样（单条 Build 路径下的一场）。 */
function probeBattle(
  state: RunPageState,
  draft: BuildDraft,
  carriedHp: number | null,
): { after: RunPageState; probe: StageProbe; playerHp: number } {
  const node = runCurrentNode(state);
  const build = [...runBuildIds(state)];
  const rt = new RunBattleRuntime({
    build,
    carriedHp,
    encounterId: node.encounterId,
    playerDraft: draft,
    playerLoadoutTag: PRODUCT_TAG,
    playerBaseline: true,
  });
  try {
    const snapStart = rt.snapshot();
    const v0 = snapStart.vehicleA;
    const ws0 = [...v0.wheels].sort((a, b) => a.center.x - b.center.x);
    const hpStart = rt.hp();
    let chassisY = v0.bodyVisual?.position.y ?? 0;
    let chassisPitch = v0.bodyVisual?.rotation ?? 0;
    let wheelFrontY = ws0.length ? ws0[ws0.length - 1].center.y : 0;
    let wheelRearY = ws0.length ? ws0[0].center.y : 0;
    let frontMassX = 0;
    let frontMassY = 0;
    let minGapWorld = Infinity;
    let minGapCore: number | null = null;
    let hitTimes: number[] = [];
    let prevHits = 0;
    let steps = 0;
    while (rt.result === null && steps < MAX_FRAMES) {
      rt.step(FRAME_MS);
      steps += 1;
      const g = rt.gapWorld();
      if (g < minGapWorld) minGapWorld = g;
      const eds = rt.enemyDriveState();
      if (eds) minGapCore = minGapCore === null ? eds.gap : Math.min(minGapCore, eds.gap);
      // 命中节奏：逐帧看累计命中有没有涨（涨了就记一次时刻）
      let tot = 0;
      const summary = rt.playerWeaponHitSummary();
      for (const k of Object.keys(summary)) tot += summary[k].count;
      if (tot > prevHits) {
        hitTimes.push(Math.round(rt.timeMs));
        prevHits = tot;
      }
      if (steps === SETTLE_FRAME) {
        const v = rt.snapshot().vehicleA;
        chassisY = v.bodyVisual?.position.y ?? 0;
        chassisPitch = v.bodyVisual?.rotation ?? 0;
        const ws = [...v.wheels].sort((a, b) => a.center.x - b.center.x);
        wheelFrontY = ws.length ? ws[ws.length - 1].center.y : 0;
        wheelRearY = ws.length ? ws[0].center.y : 0;
        const hp = (v.hardpoints ?? []).find((h) => h.id === WEAPON_SLOT);
        frontMassX = hp?.world.x ?? 0;
        frontMassY = hp?.world.y ?? 0;
      }
    }
    const hpEnd = rt.hp();
    let hits = 0;
    let dealt = 0;
    let firstMs: number | null = null;
    for (const k of Object.keys(rt.playerWeaponHitSummary())) {
      const r = rt.playerWeaponHitSummary()[k];
      hits += r.count;
      dealt += r.damages.reduce((a, b) => a + b, 0);
      if (firstMs === null || r.firstAtMs < firstMs) firstMs = r.firstAtMs;
    }
    const cr = rt.contactResidue();
    const probe: StageProbe = {
      encounter: node.encounterId ?? '?',
      winner: rt.result?.winner ?? null,
      playerHpStart: hpStart.a,
      playerHpEnd: hpEnd.a,
      damageTaken: round1(hpStart.a - hpEnd.a),
      enemyHpStart: hpStart.b,
      enemyHpEnd: hpEnd.b,
      hits,
      dealt,
      firstHitMs: firstMs,
      hitTimes,
      minGapWorld: round1(minGapWorld === Infinity ? 0 : minGapWorld),
      minGapCore: minGapCore === null ? null : round1(minGapCore),
      contact: cr.contact,
      impact: cr.impact,
      contactDamage: cr.damage,
      chassisY: round1(chassisY),
      chassisPitch: Math.round(chassisPitch * 1000) / 1000,
      wheelFrontY: round1(wheelFrontY),
      wheelRearY: round1(wheelRearY),
      frontMassX: round1(frontMassX),
      frontMassY: round1(frontMassY),
    };
    const after = finishRunBattle(state, {
      winner: rt.result?.winner ?? null,
      endReason: rt.result?.endReason ?? null,
      playerHp: hpEnd.a,
      enemyHp: hpEnd.b,
      steps: rt.stepCount,
    });
    return { after, probe, playerHp: hpEnd.a };
  } finally {
    rt.dispose();
  }
}

/** 跑一条**固定 Build 序列**的完整 Run（三段），逐段采样。 */
function runPath(draft: BuildDraft, buildList: readonly string[], key: string): PathResult {
  const ctx: RunPageContext = runPageContext({ source: 'profile', label: key, draft, tag: PRODUCT_TAG, key });
  let s: RunPageState = createRunPageState(ctx);
  let carry: number | null = null;
  const stages: StageProbe[] = [];
  let choiceIdx = 0;
  for (let guard = 0; guard < 40; guard++) {
    if (s.phase === 'COMPLETE' || s.phase === 'FAILED') break;
    if (s.phase === 'BATTLE') {
      const r = probeBattle(s, draft, carry);
      stages.push(r.probe);
      carry = r.playerHp;
      s = r.after;
      continue;
    }
    if (s.phase === 'CHOICE') {
      const pool: string[] = runChoicePool(s).map((o) => o.id);
      const want = buildList[choiceIdx] ?? pool[0] ?? '';
      const use = pool.includes(want) ? want : pool[0] ?? '';
      const ns = chooseRunBuff(s, use, ctx);
      choiceIdx += 1;
      if (ns === s) break;
      s = ns;
      continue;
    }
    if (s.phase === 'EVENT') carry = runCarriedPlayerHp(s);
    const ns = pressRunAction(s, ctx);
    if (ns === s) break;
    s = ns;
  }
  return { phase: s.phase, stages, finalHp: stages.length ? stages[stages.length - 1].playerHpEnd : 0 };
}

function stageLine(tag: string, p: StageProbe): string {
  const en = p.enemyHpStart - p.enemyHpEnd;
  return (
    `      ${tag} ${p.encounter}: win=${p.winner ?? '?'} 我方HP ${round1(p.playerHpStart)}→${round1(p.playerHpEnd)}(损${p.damageTaken}) ` +
    `敌方HP ${round1(p.enemyHpStart)}→${round1(p.enemyHpEnd)}(承${round1(en)}) · 我命中${p.hits}发/${p.dealt}伤 首发${p.firstHitMs ?? '-'}ms ` +
    `· minGap世界${p.minGapWorld}${p.minGapCore === null ? '' : ` core${p.minGapCore}`} · 接触${p.contact ? 'Y' : 'N'}`
  );
}

describe('PRODUCT-LOOP-R10-STRATEGY-SPACE-CAUSAL-AUDIT-R1｜策略空间因果审计（只取证）', () => {
  it('MV｜Movement 因果：只换前轮 / 只换后轮（counterfactual，其余完全相同）', () => {
    const lines: string[] = [];
    lines.push('');
    lines.push('════════════════════════════════════════════════════════════════════');
    lines.push('【MV｜Movement 因果对照】固定 body=mangoBody + weapon=machineGun + build=[emergencyRepair→damageUp]，只换一个轮子');
    lines.push('════════════════════════════════════════════════════════════════════');
    lines.push('轮组静态（content）：' +
      WHEELS.map((w) =>
        w === 'none'
          ? `none{r=20(卸下)}`
          : `${w}{r=${WHEEL_RADIUS[w]},m=${registry.movements.get(w)?.mass ?? '?'},torque=${registry.movements.get(w)?.driveTorque ?? '?'},rpm=${registry.movements.get(w)?.maxRPM ?? '?'}}`,
      ).join(' · '));

    const BL = ['emergencyRepair', 'damageUp'] as const;

    lines.push('');
    lines.push('A. 只换 Front（rear 固定 smallWheel）：');
    for (const f of WHEELS) {
      const r = runPath(productDraft('mangoBody', 'machineGun', f, 'smallWheel'), BL, `mv-F|${f}`);
      const s1 = r.stages[0];
      lines.push(
        `   · front=${f}: 结局=${r.phase} 段数=${r.stages.length} 终HP=${round1(r.finalHp)}` +
          (s1 ? ` | 姿态(稳) y=${s1.chassisY} pitch=${s1.chassisPitch} 轮y(前${s1.wheelFrontY}/后${s1.wheelRearY}) frontMass=(${s1.frontMassX},${s1.frontMassY})` : ''),
      );
      for (let i = 0; i < r.stages.length; i++) lines.push(stageLine(`[${i + 1}]`, r.stages[i]));
    }

    lines.push('');
    lines.push('B. 只换 Rear（front 固定 smallWheel）：');
    for (const rw of WHEELS) {
      const r = runPath(productDraft('mangoBody', 'machineGun', 'smallWheel', rw), BL, `mv-R|${rw}`);
      const s1 = r.stages[0];
      lines.push(
        `   · rear=${rw}: 结局=${r.phase} 段数=${r.stages.length} 终HP=${round1(r.finalHp)}` +
          (s1 ? ` | 姿态(稳) y=${s1.chassisY} pitch=${s1.chassisPitch} 轮y(前${s1.wheelFrontY}/后${s1.wheelRearY}) frontMass=(${s1.frontMassX},${s1.frontMassY})` : ''),
      );
      for (let i = 0; i < r.stages.length; i++) lines.push(stageLine(`[${i + 1}]`, r.stages[i]));
    }
    lines.push('════════════════════════════════════════════════════════════════════');
    // eslint-disable-next-line no-console
    console.log('\n' + lines.join('\n'));
  }, 600_000);

  it('BD｜Body 因果：只换车身（其余完全相同）', () => {
    const lines: string[] = [];
    lines.push('');
    lines.push('════════════════════════════════════════════════════════════════════');
    lines.push('【BD｜Body 因果对照】固定 weapon=machineGun + front=smallWheel + rear=smallWheel + build=[emergencyRepair→damageUp]，只换车身');
    lines.push('════════════════════════════════════════════════════════════════════');
    const BL = ['emergencyRepair', 'damageUp'] as const;
    for (const b of OFFICIAL_BODIES) {
      const def = registry.bodies.get(b);
      const fm = def?.functionalHardpoints.find((h) => h.id === WEAPON_SLOT);
      const r = runPath(productDraft(b, 'machineGun', 'smallWheel', 'smallWheel'), BL, `bd|${b}`);
      const s1 = r.stages[0];
      lines.push(
        `   · ${b}: 结局=${r.phase} 段数=${r.stages.length} 终HP=${round1(r.finalHp)} | 静态 hp=${def?.hp} mass=${def?.baseMass} frontMass局部=(${fm?.localPosition.x},${fm?.localPosition.y})` +
          (s1 ? ` | 姿态(稳) y=${s1.chassisY} pitch=${s1.chassisPitch} frontMass世界=(${s1.frontMassX},${s1.frontMassY})` : ''),
      );
      for (let i = 0; i < r.stages.length; i++) lines.push(stageLine(`[${i + 1}]`, r.stages[i]));
    }
    lines.push('════════════════════════════════════════════════════════════════════');
    // eslint-disable-next-line no-console
    console.log('\n' + lines.join('\n'));
  }, 600_000);

  it('W0｜三件 0-COMPLETE 武器分开归因（hammer / laser / rammer）', () => {
    const lines: string[] = [];
    lines.push('');
    lines.push('════════════════════════════════════════════════════════════════════');
    lines.push('【W0｜hammer / laser / rammer 归因】基线 body=mangoBody front=smallWheel rear=smallWheel build=[emergencyRepair→damageUp]');
    lines.push(
      '⚠️ PRODUCT-LOOP-R11-LASER-CADENCE-R1 之后的更新：laser 的 `cooldownMs` 1800 → 600' +
        '（只动攻击间隔）⇒ 本次审计当时「laser = 0-COMPLETE / 根因 timing」的结论**已被修掉**，' +
        'laser 不再是 0-COMPLETE 武器（见 `productRunLaserCadenceR11`）。下面的读数按**当前**参数现算。',
    );
    lines.push('════════════════════════════════════════════════════════════════════');
    const BL = ['emergencyRepair', 'damageUp'] as const;
    const weapons = ['hammer', 'laser', 'rammer'] as const;
    // 变体：换 movement / body，看攻击窗口是否改变
    const variants: readonly { tag: string; body: string; front: string; rear: string }[] = [
      { tag: '基线(mango/small/small)', body: 'mangoBody', front: 'smallWheel', rear: 'smallWheel' },
      { tag: '前轮换wheelStd', body: 'mangoBody', front: 'wheelStd', rear: 'smallWheel' },
      { tag: '后轮换heavyWheel', body: 'mangoBody', front: 'smallWheel', rear: 'heavyWheel' },
      { tag: '车身换coconutBody', body: 'coconutBody', front: 'smallWheel', rear: 'smallWheel' },
      { tag: '车身换pineappleBody', body: 'pineappleBody', front: 'smallWheel', rear: 'smallWheel' },
    ];
    for (const w of weapons) {
      const ps = registry.functionals.get(w);
      const params = (ps?.behaviorParams ?? {}) as Record<string, number>;
      lines.push('');
      lines.push(`── ${w}（behavior=${ps?.behavior ?? '?'}，数值=${JSON.stringify(params)}）──`);
      for (const v of variants) {
        const r = runPath(productDraft(v.body, w, v.front, v.rear), BL, `w0|${w}|${v.tag}`);
        lines.push(`   · [${v.tag}] 结局=${r.phase} 段数=${r.stages.length} 终HP=${round1(r.finalHp)}`);
        for (let i = 0; i < r.stages.length; i++) {
          const p = r.stages[i];
          lines.push(
            stageLine(`[${i + 1}]`, p) +
              ` · 命中节奏=${p.hitTimes.length ? p.hitTimes.join(',') : '无'}`,
          );
        }
      }
    }
    lines.push('════════════════════════════════════════════════════════════════════');
    // eslint-disable-next-line no-console
    console.log('\n' + lines.join('\n'));
  }, 900_000);

  it('SC｜可达性守卫：本轮审计用到的武器/轮组 id 全在正式集合内', () => {
    for (const w of ['hammer', 'laser', 'rammer']) expect(FULL_RUN_SUPPORTED_WEAPON_IDS).toContain(w);
    for (const w of WHEELS) {
      if (w !== 'none') expect([...registry.movements.keys()]).toContain(w);
    }
    // 基线 Draft 必须能开 Run（否则上面的对照无意义）
    expect(canStartFullRun(productDraft('mangoBody', 'machineGun', 'smallWheel', 'smallWheel'))).toBe(true);
  });
});
