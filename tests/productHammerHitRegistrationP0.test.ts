/**
 * Queue ID｜PRODUCT-LOOP-P0-HAMMER-RANGED-TURRET-HIT-REGISTRATION
 *
 * ── 本 Queue 的原始命题（R7 7×3 Encounter Matrix 的 ② 组）──────────────────────
 *
 *   「`hammer` vs `RangedTurret`：两者**已经发生深度空间重叠**、有真实 `impact` / `contact`
 *     证据，但 Hammer 武器命中登记 = **0**。这与 RangedTurret 控距本身无关，因为已经实际接触。」
 *
 * ── 本文件的结论：上述「已经接触」是 **L2 度量假象**，命中链**无缺陷** ─────────────
 *
 *   沿 Queue 指定的六层逐层取证（全部真实 Runtime，`--pool=vmForks --maxWorkers=1`）：
 *
 *   | 层 | 实测 | 结论 |
 *   |---|---|---|
 *   | 输入/状态 | `onlyDraft('hammer', frontMass)` / `playerBaseline:true` / `encounterId:'RangedTurret'` | 与矩阵格同口径 |
 *   | `hammerBehavior` | 关节角全程实测 **[−0.94, +1.08]**，覆盖固定弧 [−0.9, +1.2]；windup→pause→swing→recover 正常循环 | 状态机**没有**「不挥击」 |
 *   | Collider | 锤头 = `box 60×14 offset{x:40}`（覆盖 pivot 前 10..70px） | 形状按定义装出 |
 *   | `contactRouter` | 全程车辆↔车辆接触**只有 1 条**：`s718 body ↔ part:front rel=1.33`（= **玩家车体 × 敌方外伸炮管**）；**锤头（`part:frontMass`）零接触** | 命中链**没被触发**，不是被拒绝 |
 *   | hit policy | 锤头 ↔ 敌各 collider 的最近 SAT 间距 **9.6px**（全程 > 0） | `baseDamage=90` / `WEAPON_CONTACT_THRESHOLD=0.5` 两道闸门**从未被触及** |
 *   | damage | 命中 `{}`、伤害 `0` | 与「从未接触」完全一致 |
 *
 *   ⇒ **0 命中的原因 = 锤头没碰到**，不是「碰到了却没登记」。
 *
 *   **「深度重叠」是怎么来的**（这是本轮真正找到的缺陷 —— **测试判据错**，不是战斗错）：
 *   `MX-08` 用 `RunBattleRuntime.gapWorld()` 当「是否接触」的判据，而它是
 *   `b.minX − a.maxX`，作用在 `vehicleWorldBox()` 上 —— 那个盒子**含 `visual` 贴图外框**
 *   （`runBattleRuntime.ts:282-297` 明确 `accShape` + `accVisual`）。**贴图外框的 X 投影
 *   重叠 ≠ 物理接触**：`minGap = −23` 读出来的是「两张贴图叠了 23px」，不是「两个 collider 重叠」。
 *   ⇒ 本文件把 ② 组的判据从 `gapWorld`（L2 外显）换成**引擎自身的 contact 事件流**（权威）。
 *
 * ── 关键补充证据：几何其实是够的，差的是**时序** ─────────────────────────────
 *
 *   终局逐帧几何（`PH-01` 的取证附录，实测）：s719–s721 玩家车体中心 x = **1310**、
 *   锤 pivot x = **1354**；θ=0 时锤头最远伸到 **x=1424**，而敌方炮管盒在 **x 1395..1435**、
 *   敌车身盒在 **x 1428..1598** ⇒ **θ≈0 时锤头确实能够到**。
 *   但 s690–s721 全程 θ 只在 **[−0.93, −0.25]**（windup / pause / recover 的**抬起半周**），
 *   下一次 swing 要等到 s728 之后，而玩家耐久已在 **s721** 归零 —— **差约 7 步（≈0.12 s）**。
 *   ⇒ 这是「固定弧 / 固定周期 / 不追踪敌人」的**设计语义**（`hammerBehavior.ts:8`：
 *     「敌人在弧内可命中、弧外真实打空」），不是缺陷。
 *   ⇒ 也正因如此，**不允许**通过加范围 / 加伤害 / 调 AI 去「修」它（Queue 明文禁止）。
 *
 * ── 验收③ 的取证方式（**受控初始几何**，与 `Hammer-Hit` 场景同范式）─────────────
 *
 *   真实出生几何下玩家**只有 4 步**（s718–s721）落在接触距离内，且这 4 步全在「抬起半周」；
 *   要让「真实接触 × 有效攻击窗口」真的发生，必须把**接触窗口**提前 —— 本文件用
 *   `world.setPosition` 把**玩家整台车**（chassis + 全部 part + 全部 wheel，同一 delta ⇒
 *   关节相对几何不变）前移 `CONTROLLED_A_SHIFT_PX = 500`，其余一切（世界 / AI / 装配 /
 *   Encounter / 全部数值）**逐字节不变**。
 *
 *   ⚠️ 这**不是**产品改动，也**不是**「为了让测试绿改敌人」：
 *      - Enemy collider / HP / AI / Encounter Sequence **一行未改**；
 *      - 它只是把「同一场战斗的初始相对位置」设成受控值，正是 `Hammer-Hit` 场景
 *        （`src/lab/scenarios.ts:531-547`「spawnB 600 → B 左缘与 A 车身右缘相切」）既有的做法。
 *      - 受控几何下**零出生接触**（`PH-03` 显式断言），因此命中不是出生假象。
 *
 * ── 观测方式说明（为什么这里可以打桩）───────────────────────────────────────
 *
 *   「哪一对 body 真实接触过」在正式端口上是**不可见**的：`contactResidue()` 只给最后一条
 *   （`lastContact / lastImpact / lastDamage`），`onCombatEvent` 只有伤害事件。
 *   本文件因此在**实例**上包装 `orchestrator.router.handlePlanckContact`（只在 `try/finally`
 *   内生效、退出立即还原、**不碰 `src/`、不污染其它测试**），把它当作**只读观测挂钩**：
 *   它不改变任何事件、不改伤害、不改物理，只是把 `{step, 双方 partId, relativeVelocity}`
 *   抄一份出来。判据仍然 100% 来自引擎自身的接触流。
 */

import { describe, expect, it } from 'vitest';

import { WEAPON_CONTACT_THRESHOLD } from '../src/battle/contactRouter';
import type { BattleResult } from '../src/battle/battleContract';
import type { PlanckVehicle } from '../src/battle/planckVehicleAssembly';
import { EMPTY_SLOT, type BuildDraft } from '../src/lab/buildEditorModel';
import { RunBattleRuntime } from '../src/lab/portraitBattleLab/runBattleRuntime';
import type { PlanckWorld } from '../src/physics/planckWorld';
import { WEAPON_SLOT, defaultPlayerDraft } from '../src/product/playerLoadout';

/* ------------------------------------------------------------- 取证常量 */

const FRAME_MS = 1000 / 60;
/** 安全上限（本组实测最长 1010 步；竞技场结构上约 1080 步必进 `End`）。 */
const MAX_FRAMES = 1400;
/**
 * **受控初始几何**：把玩家整台车前移 500px（实测出生 x 400 → 900，与敌车 1200 间隔 300）。
 * 目的 = 让「接触窗口」提前到玩家耐久耗尽之前（见文件头「时序」一节）。
 */
const CONTROLLED_A_SHIFT_PX = 500;
/** 出生接触判据：命中若落在前 N 步内，就必须被当成出生假象单独审视。 */
const SPAWN_GUARD_FRAMES = 30;

/* --------------------------------------------------------------- 观测 */

interface VehicleContact {
  readonly step: number;
  /** A 侧（玩家）部件 id；底盘 = `body`。 */
  readonly attackerPartId: string;
  /** B 侧（敌人）部件 id；底盘 = `body`。 */
  readonly defenderPartId: string;
  readonly relativeVelocity: number;
}

interface BattleObservation {
  readonly contacts: readonly VehicleContact[];
  readonly hitSteps: readonly number[];
  readonly hits: Readonly<
    Record<string, { readonly count: number; readonly firstAtMs: number; readonly damages: readonly number[] }>
  >;
  readonly steps: number;
  readonly result: BattleResult | null;
  readonly hpA: number;
  readonly hpB: number;
  readonly hpBMax: number;
  /** 本场玩家实际装出来的武器（`挂点:defId:behavior:damage`）。 */
  readonly weapons: readonly string[];
  /** 锤头（`category === 'weapon'` 的那一件）在接触事件里的 `partId`（带 `part:` 前缀）。 */
  readonly weaponPartId: string;
}

/** 按 `partId` 归组后的锤头（攻击方）接触。 */
function hammerContacts(obs: BattleObservation): readonly VehicleContact[] {
  return obs.contacts.filter((c) => c.attackerPartId === obs.weaponPartId);
}

function hitsOf(obs: BattleObservation): number {
  return Object.values(obs.hits).reduce((a, r) => a + r.count, 0);
}

/**
 * 把**整台车**平移 `dx`（chassis + 全部 part + 全部 wheel 同一 delta ⇒ 关节相对几何不变）。
 * 只在构造后、第一次 `step()` 之前调用。
 */
function shiftVehicle(world: PlanckWorld, v: PlanckVehicle, dx: number): void {
  const move = (body: PlanckVehicle['body']): void => {
    const p = world.getPosition(body);
    world.setPosition(body, p.x + dx, p.y);
  };
  move(v.body);
  for (const part of v.parts) move(part.body);
  for (const wheel of v.wheels) move(wheel.body);
}

function onlyDraft(weaponDefId: string, slot: string): BuildDraft {
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

/**
 * 跑一场真实的 Run 战斗，同时把**引擎自身的**车辆↔车辆接触流抄一份出来。
 *
 * ⚠️ 观测挂钩只包在**实例**上，且 `finally` 无条件还原；不碰 `src/`，不影响任何其它测试。
 */
function runBattle(opts: {
  readonly weaponDefId: string;
  readonly encounterId: string;
  /** 受控初始几何：玩家整车前移像素（0 = 真实出生几何）。 */
  readonly playerShiftPx?: number;
}): BattleObservation {
  const rt = new RunBattleRuntime({
    build: [],
    carriedHp: null,
    encounterId: opts.encounterId,
    playerDraft: onlyDraft(opts.weaponDefId, WEAPON_SLOT),
    playerLoadoutTag: 'profile-equipped',
    playerBaseline: true,
  });

  const contacts: VehicleContact[] = [];
  const hitSteps: number[] = [];
  const router = rt.orchestrator.router;
  const orig = router.handlePlanckContact;
  let step = 0;
  // —— 只读观测挂钩：抄一份接触事实，不改事件 / 不改伤害 / 不改物理 ——
  router.handlePlanckContact = function (world, ev, arenaPhase) {
    const tagA = world.getOwnerTag(ev.bodyA);
    const tagB = world.getOwnerTag(ev.bodyB);
    if (
      tagA &&
      tagB &&
      tagA.kind === 'vehicle' &&
      tagB.kind === 'vehicle' &&
      tagA.team !== tagB.team &&
      ev.phase === 'begin'
    ) {
      // 规范化到「A 侧 = 玩家」：正式世界恒为 player=A / enemy=B。
      const playerIsA = tagA.team === 'A';
      const p = playerIsA ? tagA : tagB;
      const e = playerIsA ? tagB : tagA;
      contacts.push({
        step,
        attackerPartId: p.partId ?? 'body',
        defenderPartId: e.partId ?? 'body',
        relativeVelocity: ev.relativeVelocity,
      });
    }
    return orig.call(router, world, ev, arenaPhase);
  };

  try {
    if (opts.playerShiftPx) shiftVehicle(rt.orchestrator.world, rt.orchestrator.vehicleA, opts.playerShiftPx);

    let prevHits = 0;
    while (rt.result === null && step < MAX_FRAMES) {
      step += 1;
      rt.step(FRAME_MS);
      let n = 0;
      for (const read of Object.values(rt.playerWeaponHitSummary())) n += read.count;
      if (n > prevHits) {
        hitSteps.push(step);
        prevHits = n;
      }
    }

    const weapon = rt.playerWeapons().find((w) => w.behavior === opts.weaponDefId) ?? rt.playerWeapons()[0];
    return {
      contacts,
      hitSteps,
      hits: rt.playerWeaponHitSummary(),
      steps: step,
      result: rt.result,
      hpA: rt.orchestrator.vehicleA.hp,
      hpB: rt.orchestrator.vehicleB.hp,
      hpBMax: rt.orchestrator.vehicleB.maxHp,
      weapons: rt.playerWeapons().map((w) => `${w.hardpointId}:${w.defId}:${w.behavior}:dmg=${w.damage}`),
      weaponPartId: `part:${weapon.hardpointId}`,
    };
  } finally {
    router.handlePlanckContact = orig;
    rt.dispose();
  }
}

/* ==================================================================== */


describe('PRODUCT-LOOP-P0 Hammer 命中登记（Bug Queue：根因 + 不退化 + 无回归）', () => {
  /**
   * 【验收① 根因】真实矩阵格：hammer@frontMass vs RangedTurret。
   *
   * 判据 = **引擎 contact 事件流**（不是 `gapWorld`）。断言到「哪一对 part 接触」这一层，
   * 因为「车体撞上了」与「锤子命中没登记」是完全不同的两件事 —— 本 Queue 的命题正是把
   * 前者当成了后者。
   */
  it('PH-01 根因：hammer vs RangedTurret 全程**锤头零接触** ⇒ 0 命中是「没碰到」而非「没登记」', () => {
    const obs = runBattle({ weaponDefId: 'hammer', encounterId: 'RangedTurret' });

    // ① 本场玩家车上只有 hammer 这一件（归因夹具成立）。
    expect(obs.weapons, '本场只有 frontMass:hammer').toEqual(['frontMass:hammer:hammer:dmg=90']);
    expect(obs.weaponPartId).toBe('part:frontMass');

    // ② 真实接触**只有 1 条**，且它是**玩家车体 × 敌方外伸炮管**（不是锤头）。
    expect(obs.contacts, '真实车辆↔车辆接触只有 1 条').toHaveLength(1);
    expect(obs.contacts[0]!.attackerPartId, '接触方是玩家**车体**（不是锤头）').toBe('body');
    expect(obs.contacts[0]!.defenderPartId, '被撞的是敌方**炮管**（front 挂点的 cannon）').toBe('part:front');
    expect(obs.contacts[0]!.relativeVelocity, '该次接触有真实相对速度（所以它是真 impact）').toBeGreaterThan(1);

    // ③ **锤头（part:frontMass）全程零接触** —— 这才是 0 命中的原因。
    expect(hammerContacts(obs).map((c) => `s${c.step}|${c.defenderPartId}`), '锤头零接触').toEqual([]);

    // ④ 与「从未接触」完全一致：0 命中、0 伤害、对手基本满血。
    expect(hitsOf(obs), '命中 = 0').toBe(0);
    expect(obs.hits, '没有任何来源部件').toEqual({});
    expect(obs.hpB, '对手基本满血（只被车体撞、没被武器打）').toBeGreaterThan(obs.hpBMax - 1);

    // ⑤ 本场确实是正式终态（不是被 1400 步上限截断，也不是 arenaEnd 拖延）。
    expect(obs.result, '进入正式终态').not.toBeNull();
    expect(obs.result!.endReason).toBe('hp');
    expect(obs.result!.winner, '单件 hammer 真实落败（如实记录）').toBe('B');
    expect(obs.steps).toBeLessThan(MAX_FRAMES);
  });

  /**
   * 【验收② 既有命中不退化】hammer vs 普通敌人（真实出生几何，无任何受控改动）。
   *
   * 这两格同时是**验收④**的第一半：把「真实锤头接触」与「登记伤害」逐条对上。
   */
  for (const encounter of ['Chaser', 'ProtoRusher'] as const) {
    it(`PH-02 不退化：hammer vs ${encounter} 真实接触即按正式规则登记 90`, () => {
      const obs = runBattle({ weaponDefId: 'hammer', encounterId: encounter });
      const hm = hammerContacts(obs);
      const hits = hitsOf(obs);

      // ① 确有大量真实锤头接触（既有能力没有消失）。
      expect(hm.length, `${encounter}：锤头真实接触数`).toBeGreaterThanOrEqual(8);

      // ② 只装 hammer ⇒ 全部命中只能来自它，且伤害恒 = 正式 baseDamage 90。
      expect(Object.keys(obs.hits), '唯一来源部件 = hammer').toEqual(['hammer']);
      for (const d of obs.hits.hammer!.damages) expect(d, 'hammer baseDamage').toBe(90);

      // ③ **一一对应**：每一次 Hammer 伤害都对应一次真实锤头接触，且 rel ≥ 阈值；
      //    每一次 rel < 阈值的锤头接触都**不**产生伤害（= 验收④「不允许无条件伤害」）。
      const aboveThreshold = hm.filter((c) => c.relativeVelocity >= WEAPON_CONTACT_THRESHOLD);
      const belowThreshold = hm.filter((c) => c.relativeVelocity < WEAPON_CONTACT_THRESHOLD);
      expect(hits, '命中数 = 达到阈值的真实接触数').toBe(aboveThreshold.length);

      const contactSteps = new Set(aboveThreshold.map((c) => c.step));
      for (const s of obs.hitSteps) expect(contactSteps.has(s), `s${s} 的伤害必须由同一步的真实接触支撑`).toBe(true);

      const belowSteps = new Set(belowThreshold.map((c) => c.step));
      for (const s of obs.hitSteps) expect(belowSteps.has(s), `s${s}：低速接触不得产生伤害`).toBe(false);
      expect(belowThreshold.length, `${encounter}：确实存在低速擦碰样本（否则这条断言没有力度）`).toBeGreaterThan(0);

      // ④ 非出生伤害：首次命中远离出生步（固定弧 windup+pause 之后才可能 swing）。
      expect(obs.hitSteps[0]!, '首次命中不是出生接触').toBeGreaterThan(SPAWN_GUARD_FRAMES);
    });
  }

  /**
   * 【验收③】在**受控初始几何**下，hammer 与**真实 RangedTurret 敌车**发生真实接触，
   * 且落在**攻击有效窗口**内 ⇒ 按正式 Hammer 规则登记命中。
   *
   * ⚠️ 受控的只有「玩家初始位置」；Enemy collider / AI / HP / Encounter / 全部数值未动。
   */
  it('PH-03 验收③：受控几何下 hammer 与真实 RangedTurret 接触 ⇒ 按正式规则登记 90', () => {
    const obs = runBattle({ weaponDefId: 'hammer', encounterId: 'RangedTurret', playerShiftPx: CONTROLLED_A_SHIFT_PX });
    const hm = hammerContacts(obs);
    const hits = hitsOf(obs);

    // ① 受控几何下**没有出生接触**，且首次命中远离出生步 ⇒ 命中不是出生假象。
    expect(obs.contacts.filter((c) => c.step <= 1), '受控几何必须零出生接触').toEqual([]);
    expect(obs.hitSteps[0]!, '首次命中必须远离出生步（真实 swing 窗口内）').toBeGreaterThan(SPAWN_GUARD_FRAMES);

    // ② 锤头与**真实 RangedTurret 敌车**发生了真实接触（至少一次够阈值）。
    const above = hm.filter((c) => c.relativeVelocity >= WEAPON_CONTACT_THRESHOLD);
    expect(above.length, '锤头对真实敌车达成阈值的真实接触').toBeGreaterThanOrEqual(1);
    for (const c of above) {
      expect(['part:front', 'part:frontMass', 'body', 'wheel:front', 'wheel:rear'], '接触对象是敌车真实部件').toContain(
        c.defenderPartId,
      );
    }

    // ③ 按**正式 Hammer 规则**登记：baseDamage = 90，且命中次数 = 达阈值接触次数（一一对应）。
    expect(hits, '命中数 = 达阈值的真实锤头接触数').toBe(above.length);
    expect(hits, '确有命中登记').toBeGreaterThanOrEqual(1);
    for (const d of obs.hits.hammer!.damages) expect(d, '正式 hammer baseDamage').toBe(90);

    // ④ 每一次命中都落在**同一步的真实接触**上（不是凭空结算）。
    const aboveSteps = new Set(above.map((c) => c.step));
    for (const s of obs.hitSteps) expect(aboveSteps.has(s), `s${s} 的命中必须由同步的真实接触支撑`).toBe(true);

    // ⑤ 本场仍是**真实 RangedTurret**（同一 Encounter，未替换）：对手 HP 上限 = 正式 1100。
    expect(obs.hpBMax, '对手耐久上限 = 正式 RangedTurret（西瓜 1100）').toBe(1100);
    expect(obs.hpB, '对手被打掉了真实耐久').toBeLessThan(obs.hpBMax);
  });

  /**
   * 【验收④ 不允许「只要碰到就无条件造成 Hammer 伤害」】反向断言。
   *
   * 上一条已证明「有接触就登记」；这一条证明**反过来不成立** —— 非武器部件的接触、
   * 以及 rel < 阈值的接触，都**不**产生 Hammer 伤害。
   */
  it('PH-04 验收④：非锤头接触 / 低速接触**均不产生** Hammer 伤害（不是「碰到就扣血」）', () => {
    // (a) 真实矩阵格：车体 × 敌炮管接触真实存在，但**零** Hammer 伤害。
    const plain = runBattle({ weaponDefId: 'hammer', encounterId: 'RangedTurret' });
    expect(plain.contacts.filter((c) => c.attackerPartId === 'body').length, '车体确有真实接触').toBeGreaterThan(0);
    expect(hitsOf(plain), '车体接触 ⇒ 0 Hammer 伤害').toBe(0);

    // (b) 受控几何格：车体 × 敌炮管同样真实接触，HitSummary 里**只有** hammer、且次数由锤头接触决定。
    const ctrl = runBattle({ weaponDefId: 'hammer', encounterId: 'RangedTurret', playerShiftPx: CONTROLLED_A_SHIFT_PX });
    const bodyContacts = ctrl.contacts.filter((c) => c.attackerPartId === 'body');
    const hammerAbove = hammerContacts(ctrl).filter((c) => c.relativeVelocity >= WEAPON_CONTACT_THRESHOLD);
    expect(bodyContacts.length, '受控格：车体也有真实接触').toBeGreaterThan(0);
    expect(hitsOf(ctrl), '命中数只由**锤头**达阈值接触决定，与车体接触无关').toBe(hammerAbove.length);
    expect(Object.keys(ctrl.hits), '唯一来源部件仍是 hammer（车体不产生武器伤害）').toEqual(['hammer']);

    // (c) 低速擦碰样本：Chaser 有 rel=0.135 的锤头接触，它**没有**换来任何伤害。
    const chaser = runBattle({ weaponDefId: 'hammer', encounterId: 'Chaser' });
    const low = hammerContacts(chaser).filter((c) => c.relativeVelocity < WEAPON_CONTACT_THRESHOLD);
    expect(low.length, 'Chaser：存在低速锤头接触样本').toBeGreaterThan(0);
    for (const c of low) expect(chaser.hitSteps, `s${c.step}（rel=${c.relativeVelocity.toFixed(3)}）不得登记伤害`).not.toContain(c.step);
    expect(hitsOf(chaser), '命中数 = 达阈值接触数（低速那几次被正确拒掉）').toBe(
      hammerContacts(chaser).filter((c) => c.relativeVelocity >= WEAPON_CONTACT_THRESHOLD).length,
    );
  });

  /**
   * 【验收⑤ 其它行为无回归】`cannon` 走的是弹丸路径（不经 `handleWeaponContact` 的近战直击），
   * 本 Queue 未触碰它 —— 用同一 Encounter 的既有读数钉住。
   */
  it('PH-05 验收⑤：cannon vs RangedTurret 无回归（弹丸路径仍为 1 命中 × 120）', () => {
    const obs = runBattle({ weaponDefId: 'cannon', encounterId: 'RangedTurret' });
    expect(obs.weapons).toEqual(['frontMass:cannon:cannon:dmg=120']);
    expect(obs.hpBMax).toBe(1100);

    // 口径与 R7 矩阵 `MX-08` ⑥ 完全一致：窗口外 1 次真实命中，伤害 = 玩家基线 120。
    expect(hitsOf(obs), 'cannon 仍打出 1 次真实命中').toBe(1);
    expect(obs.hits.cannon!.damages, '伤害 = 玩家侧基线 120').toEqual([120]);
    expect(obs.hitSteps, '首发步号与矩阵一致').toEqual([606]);
    expect(obs.hpB, '对手被真实扣掉 120').toBe(1100 - 120);

    // cannon 的近战碰撞不产生命中（弹丸才是伤害来源）—— 与 hammer 的机制对照。
    expect(obs.contacts, 'cannon 格：无近距离车辆接触命中登记').toEqual([]);
  });
});
