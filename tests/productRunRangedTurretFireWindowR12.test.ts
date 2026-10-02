/**
 * PRODUCT-LOOP-R12-RANGED-TURRET-FIRE-WINDOW｜「开火窗口停火后撤」单规则取证。
 *
 * ── 第一步｜调查结论（本文件 FW-01 把它钉成断言）────────────────────────────
 *
 *   1. **RangedTurret 的 movement 与 attack 之间完全独立**：
 *      `PlanckBattleOrchestrator.step()` 里，距离决策先读 `enemyDriveContext()`
 *      （**只有** `{ gap, targetSide }` 两个量），再调 `decideEnemyDrive`，然后才轮到
 *      `for (const b of this.behaviors) b.beforePhysicsStep(...)` 驱动武器。
 *      ⇒ 决策侧**零战斗状态**：它不知道炮/机枪是否在开火、也不知道冷却剩多少。
 *   2. **射击时确实仍全速执行 keep-distance**：`near` 档（`gap < 240`）会以
 *      `retreatSpeed = 2.6 px/step` 反向拉开，与武器相位无关。
 *   3. **它没有 windup**：`CannonBehavior` 的状态机**只有** `cooldownStepsRemaining`
 *      （冷却归零当步立即发射，正式炮不写 `burstRounds` ⇒ 缺省 1 ⇒ 开火是**单步瞬时事件**）；
 *      `MachineGunBehavior` 同样只有「冷却 / 发间隔」两个计数。
 *      ⇒ **唯一存在的多步「开火执行期」= 机枪的一次 burst**（7 发 × 100ms ⇒ 覆盖 36/102 步 ≈ 35%）。
 *      ⇒ 按 Queue「优先用**已有**状态、禁止先造复杂状态机」⇒ 窗口 = 武器自己的 `isFiringPhase()`。
 *
 * ── 本轮实现的**唯一**一条规则 ──────────────────────────────────────────────
 *
 *   `near` 档**且**对手处于开火执行期 ⇒ **停止后撤**（`enabled:false`，沿用既有 motor-off
 *   语义，不刹停 / 不反向 / 不加冲量）；攻击结束 ⇒ 立即恢复 keep-distance。
 *   `band` 仍如实报空间档 `'near'` ⇒ 回读侧判据 = `band === 'near' && enabled === false`。
 *   hold / far 两档**逐字节不变**；缺省参数调用**逐字节不变**；只有声明了 `enemyDrive`
 *   的 Encounter 才会查询窗口 ⇒ ProtoRusher / Chaser 与既有全部调用点零影响。
 *
 * ── 实测（FW-02 的四格表，**全表实测、非预测**）────────────────────────────
 *
 *   判据 = **引擎自身的车辆↔车辆接触事件流**（不是 `gapWorld()`：后者含贴图外框，
 *   `productHammerHitRegistrationP0.test.ts` 已证伪「外框重叠 = 接触」）。
 *   夹具 = 单件归因（车上只有这一件）+ `playerBaseline` + 满耐久开局 vs `RangedTurret`。
 *
 *   | 武器 | 结局 | 玩家武器命中 | 引擎接触 | minGap(core) | 规则生效步数（后撤步数） |
 *   |---|---|---|---|---|---|
 *   | hammer | B | **0 发** | **0** | 115.4 | 108（168） |
 *   | rammer | B | **1 发 / 70 伤**（改前 **0 / 0**） | **1**（改前 **0**）<br>`A:part:frontMass × B:part:front rel=16.9` | 152.3 | 72（107） |
 *   | machineGun | B | 43 发 / 860 伤 | 0 | 64.4 | 113（194） |
 *   | cannon | B | 2 发 / 240 伤 | 0 | 68.1 | 113（200） |
 *
 *   ⇒ **rammer 出现了改前不可能发生的真实命中窗口**（0 → 1 次真实接触 + 1 次真实武器命中，
 *      且接触点正是**它自己的武器挂点** `A:part:frontMass`，不是车身蹭到）。
 *   ⇒ ⚠️ **hammer 仍 0 命中**（连车体接触都是 0）——
 *      攻击窗口成立（108 步），但**锤头仍然没有在 swing 相位内接触到敌车**
 *      （`productHammerHitRegistrationP0.test.ts` 的时序结论在本规则下依旧成立）。
 *   ⇒ 按 Queue 明文：「如果仍然完全 0 hit：STOP，不继续调第二个参数。」
 *      ⇒ 本轮**只落这一条规则**，不再调 reach / restSteps / 伤害 / 免疫 等第二个旋钮。
 *
 * ⚠️ 本规则是**对手行为**改动 ⇒ 所有跑第 3 段（RangedTurret）的冻结台账都已同步重测：
 *    `productRunWeaponEncounterMatrixR7.test.ts`（MX-06/07/08/10）·
 *    `productRunBuildEncounterImpactR8.test.ts`（BI-05~BI-09）·
 *    `productRunThreeStagePacingR9.test.ts`（R9-04 / R9-06 / R9-07）·
 *    `productRunFullRunPathMatrixR9F.test.ts`（R9F-06 / R9F-08）·
 *    `productRunFullReachableSpaceR10.test.ts`（权威可达空间，三世界现算 + 0hit→hit 专项）·
 *    `portraitRunPage.test.ts`（RP-F2-01 / RP-F2-12 / RP-F2-12b / RP-RUN-02-04）·
 *    `productHammerHitRegistrationP0.test.ts`（PH-01 / PH-04 / PH-05）·
 *    `pblRangedDistanceControl.test.ts`（RDC-14 / RDC-15）。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { registry } from '../src/core/content';
import { decideEnemyDrive, ENEMY_KEEP_DISTANCE_BANDS } from '../src/battle/enemyDrive';
import { EMPTY_SLOT, type BuildDraft } from '../src/lab/buildEditorModel';
import { RunBattleRuntime } from '../src/lab/portraitBattleLab/runBattleRuntime';
import { defaultPlayerDraft, WEAPON_SLOT } from '../src/product/playerLoadout';
import { OFFICIAL_BODIES } from '../src/core/bodyOwnership';
import { FULL_RUN_SUPPORTED_WEAPON_IDS, canStartFullRun } from '../src/product/runCompatibility';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf8');

const FRAME_MS = 1000 / 60;
const MAX_FRAMES = 4000;
const PRODUCT_TAG = 'profile-equipped';
const APPROACH_SPEED = 1.5;

/* ------------------------------------------------------------------ 工具 */

/** 源码字符串守卫：匹配前剥注释（项目既有纪律）。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const round1 = (x: number): number => Math.round(x * 10) / 10;

/** 单件归因夹具：玩家车上**只有这一件**武器（与 R7 / R8 / R9-06 / R11 同口径）。 */
function onlyWeaponDraft(weapon: string): BuildDraft {
  return {
    ...defaultPlayerDraft(),
    functionalSelections: { front: EMPTY_SLOT, frontMass: weapon, top: EMPTY_SLOT, rear: EMPTY_SLOT },
  };
}

/** 既有 `WALK` 产品形态（`portraitRunPage` / R9F 同源）：基准武器 + 上/下位机枪。 */
function walkDraft(weapon: string): BuildDraft {
  return {
    ...defaultPlayerDraft(),
    functionalSelections: { front: weapon, frontMass: EMPTY_SLOT, top: 'machineGun', rear: 'machineGun' },
  };
}

/* ------------------------------------------------------- 单场隔离取证 */

interface FireWindowRow {
  weapon: string;
  winner: string | null;
  steps: number;
  playerHp: number;
  enemyHp: number;
  hits: number;
  dealt: number;
  firstHitMs: number | null;
  contactEvents: number;
  firstContactMs: number | null;
  contactPairs: readonly string[];
  minGapCore: number;
  nearRetreatSteps: number;
  nearFireHoldSteps: number;
}

/**
 * 单场隔离：指定武器 vs RangedTurret。
 *
 * 「接触」判据 = **引擎接触事件流**（`router.handlePlanckContact` 只读观测挂钩，
 * `finally` 无条件还原、不碰 `src/`、不污染其它测试）；与 PH-01 / REACH-01 同口径。
 */
function fireWindowBattle(weapon: string, encounterId = 'RangedTurret'): FireWindowRow {
  const rt = new RunBattleRuntime({
    build: [],
    carriedHp: null,
    encounterId,
    playerDraft: onlyWeaponDraft(weapon),
    playerLoadoutTag: PRODUCT_TAG,
    playerBaseline: true,
  });
  const router = rt.orchestrator.router;
  const orig = router.handlePlanckContact;
  const contactPairs = new Set<string>();
  let contactEvents = 0;
  let firstContactMs: number | null = null;
  let firstHitMs: number | null = null;
  let frames = 0;
  let minGapCore = Infinity;
  let nearRetreatSteps = 0;
  let nearFireHoldSteps = 0;

  const unsub = rt.orchestrator.onCombatEvent((ev) => {
    if (ev.type !== 'damage') return;
    if (ev.source !== 'A' || ev.damageSource !== 'weapon') return;
    if (firstHitMs === null) firstHitMs = frames * FRAME_MS;
  });

  try {
    router.handlePlanckContact = function (world, ev, arenaPhase) {
      const ta = world.getOwnerTag(ev.bodyA);
      const tb = world.getOwnerTag(ev.bodyB);
      if (
        ev.phase === 'begin' &&
        ta &&
        tb &&
        ta.kind === 'vehicle' &&
        tb.kind === 'vehicle' &&
        ta.team !== tb.team
      ) {
        contactEvents += 1;
        if (firstContactMs === null) firstContactMs = frames * FRAME_MS;
        const pa = ta.team === 'A' ? `A:${ta.partId ?? 'body'}` : `B:${ta.partId ?? 'body'}`;
        const pb = tb.team === 'A' ? `A:${tb.partId ?? 'body'}` : `B:${tb.partId ?? 'body'}`;
        contactPairs.add(
          `${[pa, pb].sort().join(' × ')} rel=${round1(ev.relativeVelocity)}`,
        );
      }
      return orig.call(router, world, ev, arenaPhase);
    };

    while (rt.result === null && frames < MAX_FRAMES) {
      rt.step(FRAME_MS);
      frames += 1;
      const st = rt.enemyDriveState();
      if (st) {
        if (st.gap < minGapCore) minGapCore = st.gap;
        if (st.band === 'near') {
          if (st.enabled) nearRetreatSteps += 1;
          else nearFireHoldSteps += 1;
        }
      }
    }

    let hits = 0;
    let dealt = 0;
    const summary = rt.playerWeaponHitSummary();
    for (const k of Object.keys(summary)) {
      hits += summary[k].count;
      dealt += summary[k].damages.reduce((a, b) => a + b, 0);
    }
    const hp = rt.hp();
    return {
      weapon,
      winner: rt.result?.winner ?? null,
      steps: rt.stepCount,
      playerHp: round1(hp.a),
      enemyHp: round1(hp.b),
      hits,
      dealt: round1(dealt),
      firstHitMs: firstHitMs === null ? null : round1(firstHitMs),
      contactEvents,
      firstContactMs: firstContactMs === null ? null : round1(firstContactMs),
      contactPairs: [...contactPairs],
      minGapCore: round1(minGapCore),
      nearRetreatSteps,
      nearFireHoldSteps,
    };
  } finally {
    router.handlePlanckContact = orig;
    unsub();
    rt.dispose();
  }
}

/* ------------------------------------------------------------- FW-00 */

describe('R12｜FW-00 契约：开火窗口是**可选第 4 参数**，缺省与改前逐字节相同', () => {
  const bands = { near: 240, far: 480, retreatSpeed: 2.6 };

  it('缺省（firingWindow=false）⇒ 三段决策与加此参数之前**逐项相同**', () => {
    // near：照常反向拉开
    expect(decideEnemyDrive({ gap: 100, targetSide: 1 }, bands, APPROACH_SPEED)).toEqual({
      band: 'near',
      enabled: true,
      worldDirection: -1,
      targetSpeedPxPerStep: bands.retreatSpeed,
    });
    // hold：不给油
    expect(decideEnemyDrive({ gap: 300, targetSide: -1 }, bands, APPROACH_SPEED)).toEqual({
      band: 'hold',
      enabled: false,
      worldDirection: -1,
      targetSpeedPxPerStep: APPROACH_SPEED,
    });
    // far：朝对手接近
    expect(decideEnemyDrive({ gap: 600, targetSide: -1 }, bands, APPROACH_SPEED)).toEqual({
      band: 'far',
      enabled: true,
      worldDirection: -1,
      targetSpeedPxPerStep: APPROACH_SPEED,
    });
  });

  it('窗口内 + near ⇒ **停止后撤**（只关 motor；band 仍是空间事实 near）', () => {
    for (const targetSide of [1, -1] as const) {
      const d = decideEnemyDrive({ gap: 100, targetSide }, bands, APPROACH_SPEED, true);
      expect(d.band, '档位是空间事实，不因动作被改写').toBe('near');
      expect(d.enabled, '停止后撤 = 本步不给油（同一套 motor-off 语义）').toBe(false);
      expect(d.worldDirection, '方向仍是本档声明方向（不反向、不追踪）').toBe(
        targetSide === 1 ? -1 : 1,
      );
      expect(d.targetSpeedPxPerStep, '不引入任何新速度值').toBe(bands.retreatSpeed);
    }
  });

  it('窗口**不能**改变 hold / far（逐字段相同），也不能把接近改成别的', () => {
    // ⚠️ 取样点必须**全部 ≥ near**（240）：窗口只在 `gap < near` 生效，
    //    若把 239.999 放进这一组，它本来就会因为窗口而从「后撤」变「不给油」。
    for (const gap of [240, 300, 480, 480.001, 900, 2000]) {
      for (const targetSide of [1, -1] as const) {
        expect(
          decideEnemyDrive({ gap, targetSide }, bands, APPROACH_SPEED, true),
          `gap=${gap}`,
        ).toEqual(decideEnemyDrive({ gap, targetSide }, bands, APPROACH_SPEED));
      }
    }
    // 边界：窗口只在 gap < near 生效
    expect(decideEnemyDrive({ gap: 240, targetSide: 1 }, bands, APPROACH_SPEED, true).enabled).toBe(
      false,
    ); // hold 本来就不给油
    expect(
      decideEnemyDrive({ gap: 600, targetSide: 1 }, bands, APPROACH_SPEED, true).enabled,
      '远档照常接近',
    ).toBe(true);
    // 反向：`gap < near` 时窗口**确实**改了东西（否则上一条只是「都没变」）
    expect(
      decideEnemyDrive({ gap: bands.near - 0.001, targetSide: 1 }, bands, APPROACH_SPEED, true).enabled,
      '窗口内 + near ⇒ 不给油',
    ).toBe(false);
    expect(
      decideEnemyDrive({ gap: bands.near - 0.001, targetSide: 1 }, bands, APPROACH_SPEED).enabled,
      '窗口外 + near ⇒ 照常后撤',
    ).toBe(true);
  });

  it('决策对象**仍然只有四个键**（窗口不是隐藏通道）', () => {
    for (const firingWindow of [false, true]) {
      for (const gap of [100, 300, 600]) {
        const d = decideEnemyDrive({ gap, targetSide: 1 }, bands, APPROACH_SPEED, firingWindow);
        expect(Object.keys(d).sort(), `gap=${gap} win=${firingWindow}`).toEqual([
          'band',
          'enabled',
          'targetSpeedPxPerStep',
          'worldDirection',
        ]);
      }
    }
  });

  it('窗口只作用于**对手侧**：玩家侧驱动（A 恒朝 +x）没有任何开关', () => {
    const orch = stripComments(
      read('src/battle/planckBattleOrchestrator.ts'),
    ); // 窗口查询发生在 bands 门控之后、且**只**位于 `if (bands)` 分支里
    const bandsIdx = orch.indexOf('const bands = this.config.enemyDrive;');
    const callIdx = orch.indexOf('this.enemyWeaponsFiring()');
    expect(bandsIdx, '必须仍按 config.enemyDrive 门控').toBeGreaterThan(-1);
    expect(callIdx, '窗口查询必须存在').toBeGreaterThan(-1);
    expect(callIdx, '窗口查询必须在 bands 门控之后').toBeGreaterThan(bandsIdx);
    // A 侧驱动仍是恒定向 +1 / 恒定速度（本规则一个字节都没碰）
    expect(orch.includes("requestedA: { enabled: true, worldDirection: 1")).toBe(false);
    expect(orch.includes('worldDirection: 1,')).toBe(true);
  });
});

/* ------------------------------------------------------------- FW-01 */

describe('R12｜FW-01 窗口真源 = 武器自己的开火执行期（不新造状态机、不新增数值）', () => {
  it('唯一的多步「开火执行期」= 机枪 burst；正式炮结构上没有', () => {
    const cannon = registry.functionals.get('cannon');
    expect(cannon, 'cannon 必须在正式内容库').toBeTruthy();
    const cbp = (cannon!.behaviorParams ?? {}) as Record<string, unknown>;
    expect(cbp.burstRounds, '正式炮不写 burstRounds ⇒ 缺省 1 ⇒ 开火是单步瞬时事件').toBeUndefined();

    const mg = registry.functionals.get('machineGun');
    expect(mg, 'machineGun 必须在正式内容库').toBeTruthy();
    const mbp = (mg!.behaviorParams ?? {}) as {
      burstRounds: number;
      roundIntervalMs: number;
      cooldownMs: number;
    };
    expect(mbp.burstRounds, '机枪 = 7 发').toBe(7);
    expect(mbp.roundIntervalMs, '100ms 发间隔').toBe(100);
    expect(mbp.cooldownMs, '1100ms 冷却').toBe(1100);
    // 周期（固定步）= burst 跨度 + 一发间隔 + 冷却步数；窗口 = burst 覆盖的步数
    const gapSteps = Math.ceil(mbp.roundIntervalMs / FRAME_MS);
    const burstSpan = (mbp.burstRounds - 1) * gapSteps;
    const cooldownSteps = Math.ceil(mbp.cooldownMs / FRAME_MS);
    const cycle = burstSpan + 1 + cooldownSteps;
    expect(burstSpan, 'burst 跨度 = 36 步').toBe(36);
    expect(burstSpan / cycle, '窗口占空比 ≈ 35%（肉眼可读的「停下来打一串」）').toBeCloseTo(
      0.353,
      2,
    );
  });

  it('窗口是**可选只读查询**，且只由 cannon / machineGun 两件实现（其它武器恒为无窗口）', () => {
    const raw = read('src/battle/behaviorRuntime.ts');
    const src = stripComments(raw);
    expect(src.includes('isFiringPhase?(): boolean;'), '接口上是**可选**方法').toBe(true);
    const impls = src.match(/isFiringPhase\(\): boolean \{/g) ?? [];
    expect(impls.length, '只有 cannon / machineGun 两件提供开火执行期').toBe(2);
    // 纯读计数器：不推进、不发射、不改物理（接口契约里写明「不是第二套生命周期」）
    // ⚠️ 这句在**注释**里 ⇒ 必须在**未剥注释**的原文上查（`stripComments` 会连它一起删掉）。
    expect(raw.includes('不推进状态、不发射、不改任何物理'), '接口契约必须写明「只读」').toBe(true);
  });

  it('真实战斗中「开火窗口停撤」确实生效过（不是死配置）', () => {
    const rows = ['hammer', 'rammer', 'machineGun', 'cannon'].map((w) => fireWindowBattle(w));
    for (const r of rows) {
      expect(r.nearFireHoldSteps, `${r.weapon}: 整局必须出现过「因开火而停止后撤」`).toBeGreaterThan(
        0,
      );
      expect(
        r.nearRetreatSteps,
        `${r.weapon}: 窗口之外必须仍然真的后撤（不是把 keep-distance 整体关掉）`,
      ).toBeGreaterThan(0);
    }
  }, 300_000);
});

/* ------------------------------------------------------------- FW-02 */

describe('R12｜FW-02 A/B/C/D 四武器对**同一个 RangedTurret**的实测对照', () => {
  it('四格表：结局 / minGap / 首次有效命中 / 命中次数 / 玩家 HP / Enemy HP', () => {
    const order = ['hammer', 'rammer', 'machineGun', 'cannon'] as const;
    const rows = order.map((w) => fireWindowBattle(w));
    const lines = rows.map(
      (r) =>
        `   · ${r.weapon.padEnd(10)} 结局=${r.winner ?? '?'} 步=${r.steps} ` +
        `玩家HP=${r.playerHp} 敌HP=${r.enemyHp} · 命中 ${r.hits}发/${r.dealt}伤（首次 ${r.firstHitMs ?? '-'}ms）· ` +
        `引擎接触 ${r.contactEvents} 次（首次 ${r.firstContactMs ?? '-'}ms）· ` +
        `minGap(core)=${r.minGapCore} · 规则生效 ${r.nearFireHoldSteps} 步（后撤 ${r.nearRetreatSteps} 步）\n` +
        `       接触对 = ${r.contactPairs.length === 0 ? '（无）' : r.contactPairs.join(' | ')}`,
    );
    // eslint-disable-next-line no-console
    console.log('\n[FW-02｜单件归因夹具 × RangedTurret，判据=引擎接触事件流]\n' + lines.join('\n') + '\n');

    const byWeapon = new Map(rows.map((r) => [r.weapon, r]));
    const hammer = byWeapon.get('hammer')!;
    const rammer = byWeapon.get('rammer')!;
    const machineGun = byWeapon.get('machineGun')!;
    const cannon = byWeapon.get('cannon')!;

    // 四局都必须真实跑完（不是被跳过 / 不是无平局兜底之外的异常）
    for (const r of rows) expect(r.winner, `${r.weapon} 必须真实分出胜负`).toMatch(/^[AB]$/);

    // ── 最低要求：接触型武器必须出现「改前无法发生的真实接近/命中窗口」──
    // rammer：改前 0 次真实接触 / 0 发命中 ⇒ 现在必须≥1（本轮**新出现**的真实命中）
    expect(rammer.contactEvents, 'rammer 必须出现真实接触（改前为 0）').toBeGreaterThanOrEqual(1);
    expect(rammer.hits, 'rammer 必须出现真实武器命中（改前为 0）').toBeGreaterThanOrEqual(1);
    expect(rammer.dealt, '命中必须真的结算了伤害（不是 0 伤害的假命中）').toBeGreaterThan(0);
    expect(
      rammer.contactPairs.some((p) => p.includes('A:part:frontMass')),
      'rammer 的接触必须来自**它自己的武器挂点**（不是车身蹭到）',
    ).toBe(true);

    // ⚠️ 如实记录：hammer 在**本夹具**下仍然 0 命中 ⇒ 按 Queue 明文 STOP（不调第二个参数）。
    //    窗口机制确实生效过（FW-01 已证 ≥1 步），但锤头仍未在 swing 相位内接触敌车。
    expect(hammer.hits, 'hammer 仍 0 命中（如实记录，触发 Queue 的 STOP 分支）').toBe(0);
    expect(hammer.nearFireHoldSteps, '但攻击窗口本身成立（否则 STOP 理由不同）').toBeGreaterThan(0);

    // ── 不得为「让近战赢」而削弱对手：远程两件不许退化到 0 命中 ──
    expect(machineGun.hits, 'machineGun 仍应稳定命中（不许被本规则削弱）').toBeGreaterThan(20);
    expect(cannon.hits, 'cannon 仍应命中（不许被本规则削弱）').toBeGreaterThanOrEqual(1);

    // ── 对手数值一个字节没动：HP 上限必须仍是正式值 ──
    for (const r of rows) expect(r.enemyHp).toBeLessThanOrEqual(1100);
  }, 600_000);

  it('规则不制造「接近即弹开 / 瞬移」：对手单帧位移仍有界，且接触只在武器挂点发生', () => {
    const rt = new RunBattleRuntime({
      build: [],
      carriedHp: null,
      encounterId: 'RangedTurret',
      playerDraft: onlyWeaponDraft('rammer'),
      playerLoadoutTag: PRODUCT_TAG,
      playerBaseline: true,
    });
    try {
      let frames = 0;
      let maxDx = 0;
      let prevBx = rt.vehicleX('B');
      while (rt.result === null && frames < MAX_FRAMES) {
        rt.step(FRAME_MS);
        frames += 1;
        const bx = rt.vehicleX('B');
        maxDx = Math.max(maxDx, Math.abs(bx - prevBx));
        prevBx = bx;
      }
      // 一帧最多两个固定步、后撤目标 2.6 px/step ⇒ 上界 8px 极宽松
      expect(maxDx, '对手单帧最大位移必须仍有界（无瞬移 / 无强制位置修正）').toBeLessThan(8);
      expect(maxDx, '但它真的动过（不是站桩）').toBeGreaterThan(0.5);
    } finally {
      rt.dispose();
    }
  }, 300_000);
});

/* ------------------------------------------------------------- FW-03 */

describe('R12｜FW-03 作用域守卫：未声明 enemyDrive 的 Encounter 零影响', () => {
  it('ProtoRusher / Chaser 全程**没有**距离档决策 ⇒ 本规则结构上不可能作用到它们', () => {
    for (const id of ['ProtoRusher', 'Chaser'] as const) {
      const rt = new RunBattleRuntime({ build: [], carriedHp: null, encounterId: id, playerDraft: onlyWeaponDraft('cannon'), playerLoadoutTag: PRODUCT_TAG, playerBaseline: true });
      try {
        let frames = 0;
        while (rt.result === null && frames < 2000) {
          rt.step(FRAME_MS);
          frames += 1;
          expect(rt.enemyDriveState(), `${id} 第 ${frames} 帧不得产生距离档决策`).toBeNull();
        }
      } finally {
        rt.dispose();
      }
    }
  }, 300_000);

  it('批次内仍**只有** RangedTurret 声明 keep-distance（新增规则没有扩散）', () => {
    const src = stripComments(
      read('src/lab/portraitBattleLab/testData.ts'),
    );
    expect((src.match(/enemyDrive: 'keep-distance'/g) ?? []).length, '仍然只有一处声明').toBe(1);
    // 既有门控串逐字节未变（portraitBattleLab / portraitRunPage 的源码守卫同源）
    // ⚠️ 源码里这个三元是**跨三行**写的 ⇒ 必须先归一空白再匹配（否则守卫会假红）。
    const runtimeSrc = stripComments(read('src/lab/portraitBattleLab/runBattleRuntime.ts')).replace(
      /\s+/g,
      ' ',
    );
    expect(runtimeSrc).toContain(
      "this.plan.enemyDrive === 'keep-distance' ? { enemyDrive: ENEMY_KEEP_DISTANCE_BANDS } : {}",
    );
  });

  it('档位数值仍未复制：Lab 侧依然只引用 ENEMY_KEEP_DISTANCE_BANDS', () => {
    const rt = stripComments(
      read('src/lab/portraitBattleLab/runBattleRuntime.ts'),
    );
    expect(rt.includes('ENEMY_KEEP_DISTANCE_BANDS')).toBe(true);
    for (const n of ['240', '480', '2.6']) {
      expect(rt.includes(n), `Lab 侧不得写档位数值 ${n}`).toBe(false);
    }
    expect(ENEMY_KEEP_DISTANCE_BANDS.near).toBe(240);
    expect(ENEMY_KEEP_DISTANCE_BANDS.far).toBe(480);
  });
});

/* ------------------------------------------------------------- FW-04 */

describe('R12｜FW-04 可达性守卫（本轮用到的 id 全在正式集合内）', () => {
  it('四件武器 + 夹具车身/轮组都可达；基准武器槽 = frontMass', () => {
    for (const w of ['hammer', 'rammer', 'machineGun', 'cannon']) {
      expect(FULL_RUN_SUPPORTED_WEAPON_IDS, `${w} 必须在放行集合内`).toContain(w);
    }
    expect(WEAPON_SLOT, '基准武器槽仍是 frontMass').toBe('frontMass');
    expect(OFFICIAL_BODIES).toContain('watermelonBody');
    expect(canStartFullRun(onlyWeaponDraft('hammer'))).toBe(true);
    expect(canStartFullRun(walkDraft('rammer'))).toBe(true);
  });

  it('WALK 产品形态（基准武器 + 上/下位机枪）在本规则下仍可开局（形态没被改坏）', () => {
    const d = walkDraft('hammer');
    expect(d.functionalSelections.front).toBe('hammer');
    expect(d.functionalSelections.top).toBe('machineGun');
    expect(d.functionalSelections.rear).toBe('machineGun');
    expect(canStartFullRun(d)).toBe(true);
  });
});
