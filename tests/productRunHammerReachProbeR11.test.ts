/**
 * PRODUCT-LOOP-R11-HAMMER-REACH-R1｜Hammer「有效触达距离（reach）」取证。
 *
 * ── 第一步｜真实 Reach 真源（REACH-00 固化）────────────────────────────────
 *   沿 `hammerBehavior → swing → weapon geometry/collider → hit registration` 追完后：
 *   **锤的唯一 reach 真源 = `content.ts` 里 hammer 的 `collider`**
 *   （`box 60×14 offset{x:40,y:0}` ⇒ 局部 x∈[10,70]，锤头尖端距 pivot **70px**）。
 *
 *   - `HammerBehavior` 参数只有 lower/upperRad + 三个速度 + 停顿 + 扭矩 —— **无 reach 键**；
 *   - `behaviorParams` 只有 `baseDamage` —— **无 reach 键**；
 *   - `collider` 是**每件自己的攻击几何**（`planckVehicleAssembly` 把 `f.def.collider` 直接交给
 *     `createDynamicCompound`），**不是**通用碰撞 Foundation（`contactRouter.ts` 只做
 *     「真实接触 → 结算」，没有任何延展/reach 机制）。
 *   ⇒ 存在可独立调整的 reach 字段且无需改通用碰撞 Foundation ⇒ **不触发 STOP 分支**，按 Queue 探针。
 *
 * ── 本轮的**结论（负结果，有据）**──────────────────────────────────────────
 *
 *   1. **加大 reach 不能产生 RangedTurret 上的真实锤击命中**（引擎接触事件流口径，单场隔离）：
 *      | 尖端 reach | collider（尾端锚定 / 保质心） | 锤头真实接触 | 最大 rel | 命中 |
 *      |---|---|---|---|---|
 *      | 70（基线） | box 60×14 off{40}（锚定） | **0** | – | **0** |
 *      | 130 | box 120×14 off{70}（锚定） | **0** | – | **0** |
 *      | 196 | box 312×14 off{40}（保质心） | **0** | – | **0** |
 *      | 250（3.6×） | box 420×14 off{40}（保质心） | 1 | 0.4 | **0** |
 *      | 300（4.3×） | box 520×14 off{40}（保质心） | 1 | 0.3 | **0** |
 *      ⇒ 首次接触要等到 **3.6× reach**；而那次接触的 `rel` = 0.3~0.4 **低于**
 *        `WEAPON_CONTACT_THRESHOLD = 0.5` ⇒ 命中策略**正确拒绝**（不存在「碰到就无条件伤害」）。
 *
 *   2. **而能「擦到」的 reach 早已破坏验收 1（E1/E2 不退化）**：
 *      reach=130 尚能赢 E1/E2（E2 受伤 548 vs 基线 277，已明显恶化）；reach=170 起 E2 直接输；
 *      reach=250 起 **E1 就输**。⇒ 「够不到 → 能接触」的跨越点（≈250+）与「E1/E2 不退化」的
 *      可行区间（≤ ~130）**没有交集** —— 本 Queue 的验收 1 与验收 2/3 **互斥**。
 *
 *   3. **物理上限**：锤是 Revolute 摆锤，`maxTorqueNm` 固定 400。尾端锚定加长时质心 r=(T+10)/2 px
 *      ⇒ 重力矩 ≈ 3.92·r N·m ⇒ r ≤ 102px（T ≤ 194）才挥得动。可达 `content.cannon` 等权威
 *      证据链 `hammerBehavior.ts` 头部注释（40kg@0.4m ≈ 160 N·m）。
 *
 *   ⇒ **reach 不是 RangedTurret 上的约束**。与 `productHammerHitRegistrationP0.test.ts` 的权威
 *     取证一致（「几何其实够，差的是**时序**」：θ≈0 时锤头确实够得到，但接触窗口内 θ 全在抬起半周）。
 *     ⚠️ 因此本轮**不改任何参数**（加大 reach 既不能达成验收 2/3，又会破坏验收 1/6）。
 *
 * ── 测量纪律 ───────────────────────────────────────────────────────────
 *   全部读数来自真实 `RunBattleRuntime`；「锤头是否真实接触」判据 = **引擎自身 contact 事件流**
 *   （与 PH-01 同口径），观测挂钩只包在实例上、`finally` 无条件还原、不碰 `src/`。
 *   候选值探针在内存里临时改写共享 def 的 collider（`finally` 还原），**不改 `content.ts`**。
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
import { HAMMER_DEFAULT_PARAMS } from '../src/battle/hammerBehavior';
import { WEAPON_CONTACT_THRESHOLD } from '../src/battle/contactRouter';

const FRAME_MS = 1000 / 60;
const MAX_FRAMES = 4000;
const PRODUCT_TAG = 'profile-equipped';

/** 锤 motor 扭矩（N·m）——与 `HAMMER_DEFAULT_PARAMS.maxTorqueNm` 同源。 */
const HAMMER_MAX_TORQUE_NM = HAMMER_DEFAULT_PARAMS.maxTorqueNm;

/** 尾端锚定加长：尖端 reach T ⇒ collider `width = T-10`、`offset.x = (T+10)/2`（尾端恒在局部 x=10）。 */
function tailAnchored(T: number): { width: number; offsetX: number } {
  return { width: T - 10, offsetX: (T + 10) / 2 };
}
/** 保质心加长：`offset.x` 恒 40（质心/重力矩不变），只把盒子前后一起拉长到尖端 = T。 */
function comPreserving(T: number): { width: number; offsetX: number } {
  // 尖端 = offset.x + width/2 = 40 + width/2 = T ⇒ width = 2(T-40)。
  return { width: 2 * (T - 40), offsetX: 40 };
}

const WHEEL_RADIUS: Readonly<Record<string, number>> = (() => {
  const m: Record<string, number> = { none: 20 };
  for (const def of registry.movements.values()) m[def.id] = def.radius ?? 20;
  return m;
})();

/** 真实产品可达 Draft（基底 = 真实产品默认车；top EMPTY 来自产品自身逻辑）。 */
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

/** 玩家车上只装 `frontMass:hammer`（与 PH-01 同口径）。 */
function onlyHammerDraft(): BuildDraft {
  return {
    ...defaultPlayerDraft(),
    functionalSelections: { front: EMPTY_SLOT, frontMass: 'hammer', top: EMPTY_SLOT, rear: EMPTY_SLOT },
  };
}

const round1 = (x: number): number => Math.round(x * 10) / 10;

interface IsolatedResult {
  headContacts: readonly { defenderPartId: string; rel: number }[];
  hits: number;
  dealt: number;
  winner: string | null;
  hpA: number;
  hpB: number;
  minGapWorld: number;
  minGapCore: number | null;
}

/**
 * 单场隔离：player 只装 hammer，encounter 指定；判据 = 引擎接触事件流里的**锤头**接触。
 * 观测挂钩只包实例、`finally` 还原。
 */
function isolatedBattle(encounterId: string): IsolatedResult {
  const rt = new RunBattleRuntime({
    build: [],
    carriedHp: null,
    encounterId,
    playerDraft: onlyHammerDraft(),
    playerLoadoutTag: PRODUCT_TAG,
    playerBaseline: true,
  });
  const headContacts: { defenderPartId: string; rel: number }[] = [];
  const router = rt.orchestrator.router;
  const orig = router.handlePlanckContact;
  try {
    router.handlePlanckContact = function (world, ev, arenaPhase) {
      const ta = world.getOwnerTag(ev.bodyA);
      const tb = world.getOwnerTag(ev.bodyB);
      if (ta && tb && ta.kind === 'vehicle' && tb.kind === 'vehicle' && ta.team !== tb.team && ev.phase === 'begin') {
        const playerIsA = ta.team === 'A';
        const p = playerIsA ? ta : tb;
        const e = playerIsA ? tb : ta;
        if ((p.partId ?? '') === 'part:frontMass') {
          headContacts.push({ defenderPartId: e.partId ?? 'body', rel: ev.relativeVelocity });
        }
      }
      return orig.call(router, world, ev, arenaPhase);
    };
    let steps = 0;
    let minGapWorld = Infinity;
    let minGapCore: number | null = null;
    while (rt.result === null && steps < MAX_FRAMES) {
      rt.step(FRAME_MS);
      steps += 1;
      const g = rt.gapWorld();
      if (g < minGapWorld) minGapWorld = g;
      const eds = rt.enemyDriveState();
      if (eds) minGapCore = minGapCore === null ? eds.gap : Math.min(minGapCore, eds.gap);
    }
    let hits = 0;
    let dealt = 0;
    for (const k of Object.keys(rt.playerWeaponHitSummary())) {
      hits += rt.playerWeaponHitSummary()[k].count;
      dealt += rt.playerWeaponHitSummary()[k].damages.reduce((a, b) => a + b, 0);
    }
    const hp = rt.hp();
    return {
      headContacts,
      hits,
      dealt,
      winner: rt.result?.winner ?? null,
      hpA: round1(hp.a),
      hpB: round1(hp.b),
      minGapWorld: round1(minGapWorld === Infinity ? 0 : minGapWorld),
      minGapCore: minGapCore === null ? null : round1(minGapCore),
    };
  } finally {
    router.handlePlanckContact = orig;
    rt.dispose();
  }
}

interface StageProbe {
  encounter: string;
  winner: 'A' | 'B' | null;
  hits: number;
}
interface PathResult {
  phase: string;
  stages: StageProbe[];
}

/** 跑一条真实三段 Run（固定 Build 序列），只记 phase/每段胜负与命中（用于 E1/E2 是否退化）。 */
function runPath(draft: BuildDraft, buildList: readonly string[], key: string): PathResult {
  const ctx: RunPageContext = runPageContext({ source: 'profile', label: key, draft, tag: PRODUCT_TAG, key });
  let s: RunPageState = createRunPageState(ctx);
  let carry: number | null = null;
  const stages: StageProbe[] = [];
  let choiceIdx = 0;
  for (let guard = 0; guard < 40; guard++) {
    if (s.phase === 'COMPLETE' || s.phase === 'FAILED') break;
    if (s.phase === 'BATTLE') {
      const node = runCurrentNode(s);
      const rt = new RunBattleRuntime({
        build: [...runBuildIds(s)],
        carriedHp: carry,
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
        let hits = 0;
        for (const k of Object.keys(rt.playerWeaponHitSummary())) hits += rt.playerWeaponHitSummary()[k].count;
        const hp = rt.hp();
        carry = hp.a;
        stages.push({ encounter: node.encounterId ?? '?', winner: rt.result?.winner ?? null, hits });
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
  return { phase: s.phase, stages };
}

/** 在内存里临时改写共享 hammer def 的 collider（finally 必还原；不改 src）。 */
function withReach<T>(v: { width: number; offsetX: number }, fn: () => T): T {
  const def = registry.functionals.get('hammer');
  if (!def) throw new Error('hammer 必须在正式内容库');
  const col = def.collider as { width?: number; offset: { x: number; y: number } };
  const w0 = col.width ?? 60;
  const o0 = col.offset.x;
  col.width = v.width;
  col.offset.x = v.offsetX;
  try {
    return fn();
  } finally {
    col.width = w0;
    col.offset.x = o0;
  }
}

describe('PRODUCT-LOOP-R11-HAMMER-REACH-R1｜Hammer reach 取证（结论：reach 不是约束）', () => {
  it('REACH-00｜reach 真源 = hammer collider（无独立 reach 键；非通用碰撞 Foundation）', () => {
    const hammer = registry.functionals.get('hammer');
    expect(hammer, 'hammer 必须在正式内容库').toBeTruthy();
    const col = hammer!.collider;
    expect(col.shape).toBe('box');
    const width = col.width ?? 0;
    expect(width, 'hammer 必须是 box 且带 width').toBeGreaterThan(0);
    const tip = col.offset.x + width / 2;
    const tail = col.offset.x - width / 2;
    expect(col.offset.x, 'offset.x > 0（锤头在 pivot 前方）').toBeGreaterThan(0);
    expect(tip, '尖端必须越过 pivot').toBeGreaterThan(0);
    expect(tail, '尾端紧接 pivot（锚在局部 x=10）').toBeCloseTo(10, 5);

    // ② 行为参数里没有 reach 键。
    const params = (hammer!.behaviorParams ?? {}) as Record<string, unknown>;
    expect(Object.keys(params).sort()).toEqual(['baseDamage']);
    expect(params.reach).toBeUndefined();
    expect(params.reachPx).toBeUndefined();
    expect(params.hammerReach).toBeUndefined();

    // ③ HammerBehavior 默认参数里没有 reach 键（只有相位/速度/停顿/扭矩）。
    expect(Object.keys(HAMMER_DEFAULT_PARAMS).sort()).toEqual(
      [
        'lowerRad',
        'maxTorqueNm',
        'recoverSpeedRadPerStep',
        'swingSpeedRadPerStep',
        'upperRad',
        'windupPauseSteps',
        'windupSpeedRadPerStep',
      ].sort(),
    );
    expect((HAMMER_DEFAULT_PARAMS as Record<string, unknown>).reach).toBeUndefined();

    // ④ 物理上限（纯算术，不跑模拟）：摆锤质心 r px ⇒ 重力矩 ≈ 3.92·r N·m，必须 ≤ motor 400。
    const rOf = (T: number): number => (T + 10) / 2;
    const gravityTorque = (T: number): number => Math.round(3.92 * rOf(T));
    expect(gravityTorque(tip)).toBeLessThan(HAMMER_MAX_TORQUE_NM); // 基线 70 ⇒ 157 < 400 ✓
    expect(gravityTorque(194)).toBeLessThanOrEqual(HAMMER_MAX_TORQUE_NM); // 尾端锚定的扭矩上限附近
    expect(gravityTorque(250)).toBeGreaterThan(HAMMER_MAX_TORQUE_NM); // 能「擦到」的量级已超 motor

    // eslint-disable-next-line no-console
    console.log(
      `\n[REACH-00] hammer collider = box ${width}×14 offset(${col.offset.x},0) ⇒ 局部 x∈[${tail},${tip}]，` +
        `尖端 reach=${tip}px · 重力矩≈3.92×${rOf(tip)}=${gravityTorque(tip)} N·m vs motor ${HAMMER_MAX_TORQUE_NM}\n`,
    );
  });

  it('REACH-01｜基线：hammer@frontMass vs RangedTurret 单场隔离 —— 锤头 0 真实接触 / 0 命中', () => {
    const r = isolatedBattle('RangedTurret');
    // 与 PH-01 同口径：锤头（part:frontMass）全程零接触 ⇒ 0 命中是「没碰到」，不是「没登记」。
    expect(r.headContacts, '基线锤头零接触').toEqual([]);
    expect(r.hits, '基线命中 0').toBe(0);
    expect(r.hpB, '对手基本满血（没被武器打到）').toBeGreaterThan(1099);
  });

  it('REACH-02｜reach 探针：加大 reach **不能**产生 RangedTurret 上的真实锤击命中', () => {
    const candidates: readonly { tag: string; v: { width: number; offsetX: number }; tip: number }[] = [
      { tag: 'reach=70 (基线,尾端锚定)', v: tailAnchored(70), tip: 70 },
      { tag: 'reach=130 (尾端锚定)', v: tailAnchored(130), tip: 130 },
      { tag: 'reach=196 (保质心)', v: comPreserving(196), tip: 196 },
      { tag: 'reach=250 (保质心)', v: comPreserving(250), tip: 250 },
      { tag: 'reach=300 (保质心,4.3×)', v: comPreserving(300), tip: 300 },
    ];
    const lines: string[] = [];
    const results = candidates.map((c) => {
      const r = withReach(c.v, () => isolatedBattle('RangedTurret'));
      const maxRel = r.headContacts.reduce((m, k) => Math.max(m, k.rel), 0);
      lines.push(
        `   · ${c.tag}（box ${c.v.width}×14 off{${c.v.offsetX}}）: 结局=${r.winner ?? '?'} ` +
          `锤头接触 ${r.headContacts.length} 次（最大 rel=${round1(maxRel)}） · 命中 ${r.hits}发/${r.dealt}伤 ` +
          `· minGap世界 ${r.minGapWorld} core ${r.minGapCore ?? '-'}`,
      );
      return { tip: c.tip, r, maxRel };
    });
    // eslint-disable-next-line no-console
    console.log('\n[REACH-02｜单场隔离 RangedTurret × hammer，判据=引擎接触事件流]\n' + lines.join('\n') + '\n');

    // ① **任何**探针 reach 下都没有产生真实武器命中（0 伤害）。
    for (const x of results) {
      expect(x.r.hits, `reach=${x.tip} 不应产生锤击命中`).toBe(0);
    }
    // ② 只有在远超物理上限的 4.3× reach 下才出现 1 次擦碰，且相对速度**未达**命中阈值
    //    ⇒ 命中策略正确拒绝（不存在「碰到就无条件伤害」）。
    const huge = results[results.length - 1]!;
    expect(huge.r.headContacts.length, '4.3× reach 下至多 1 次擦碰').toBeLessThanOrEqual(1);
    if (huge.r.headContacts.length > 0) {
      expect(huge.maxRel, '擦碰未达 WEAPON_CONTACT_THRESHOLD ⇒ 按设计不结算伤害').toBeLessThan(
        WEAPON_CONTACT_THRESHOLD,
      );
    }
  }, 300_000);

  it('REACH-03｜加大 reach 会破坏 E1/E2（与验收 1 冲突 ⇒ 两窗口无交集）', () => {
    const BL = ['emergencyRepair', 'damageUp'] as const;
    const draft = productDraft('mangoBody', 'hammer', 'smallWheel', 'smallWheel');
    const lines: string[] = [];

    const baseline = runPath(draft, BL, 'r11|baseline');
    lines.push(
      `   · reach=70 (基线): 结局=${baseline.phase} 段=${baseline.stages.map((s) => `${s.encounter}:${s.winner}/${s.hits}发`).join(' → ')}`,
    );
    const broken = withReach(tailAnchored(170), () => runPath(draft, BL, 'r11|reach170'));
    lines.push(
      `   · reach=170 (尾端锚定): 结局=${broken.phase} 段=${broken.stages.map((s) => `${s.encounter}:${s.winner}/${s.hits}发`).join(' → ')}`,
    );
    const broken250 = withReach(comPreserving(250), () => runPath(draft, BL, 'r11|reach250'));
    lines.push(
      `   · reach=250 (保质心): 结局=${broken250.phase} 段=${broken250.stages.map((s) => `${s.encounter}:${s.winner}/${s.hits}发`).join(' → ')}`,
    );
    // eslint-disable-next-line no-console
    console.log('\n[REACH-03｜加大 reach 对 E1/E2 的影响]\n' + lines.join('\n') + '\n');

    // 基线：E1/E2 都赢（不退化口径的参考点）。
    expect(baseline.stages.length, '基线至少打到第 2 段').toBeGreaterThanOrEqual(2);
    expect(baseline.stages[0]!.winner, '基线 E1 应赢').toBe('A');
    expect(baseline.stages[1]!.winner, '基线 E2 应赢').toBe('A');

    // 加大 reach 后 **打不到 E3**（E2 已输）⇒ 「能擦到」(≈250+) 与「E1/E2 不退化」无交集。
    const brokenOk = broken.stages.length >= 2 && broken.stages[0]!.winner === 'A' && broken.stages[1]!.winner === 'A';
    expect(brokenOk, 'reach=170 已破坏 E1/E2（与验收 1 冲突）').toBe(false);
    const broken250Ok =
      broken250.stages.length >= 2 && broken250.stages[0]!.winner === 'A' && broken250.stages[1]!.winner === 'A';
    expect(broken250Ok, 'reach=250 已破坏 E1/E2（与验收 1 冲突）').toBe(false);
  }, 300_000);

  it('REACH-04｜可达性守卫：本轮用到的 hammer/轮组/车身 id 全在正式集合内', () => {
    expect(FULL_RUN_SUPPORTED_WEAPON_IDS).toContain('hammer');
    for (const w of ['smallWheel', 'largeWheel', 'heavyWheel']) {
      expect([...registry.movements.keys()]).toContain(w);
    }
    for (const b of ['mangoBody', 'coconutBody', 'watermelonBody']) {
      expect(OFFICIAL_BODIES).toContain(b);
    }
    expect(canStartFullRun(productDraft('mangoBody', 'hammer', 'smallWheel', 'smallWheel'))).toBe(true);
  });
});
