/**
 * PRODUCT-LOOP-R7-WEAPON-BASIC-BUILD-CONTENT｜targeted strict test。
 *
 * ── 本 Queue 做的事 ────────────────────────────────────────────────────────
 * Q1 Capability Matrix 的结论：7 件 Full Run Weapon 里**真的共通的成长维度只有一个 —— 伤害**
 * （顶层含 `damage` 的键：4 件 `projectileDamage` + `flamethrower.projectileDamage`
 * + `hammer` / `rammer` 的 `baseDamage`），而「攻击节奏键」**不是一个字段**
 * （5 件 `cooldownMs` / `rammer.restSteps` / `hammer.windupPauseSteps`，最后这个只在行为默认里）。
 * 在此之前局内成长内容**全是 Cannon 专属**：非 Cannon 局选完三选一，武器**一个数字都没变**。
 *
 * 本 Queue 按上面这份真源补**最小骨架**（两条只改该武器自己数值、绝不动 `behavior` 的成长）：
 *   `damageUp` 伤害提升 / `rateUp` 攻击加快。
 *
 * ── 覆盖（每条都读**真源**，不读第二张数值表）──────────────────────────────
 *   - 派生面 7/7            → GR-01（伤害键）/ GR-02（节奏键）/ GR-02b（hammer 基准与行为同源）
 *   - 合成语义              → GR-03（伤害↑ / 节奏↓ / **behavior 一个都不许变**）
 *   - Cannon 冻结           → GR-04（通用成长对它零适用；既有内容与三池逐字节不变）
 *   - canonical 未被改写    → GR-05（正式单例逐字段对拍）
 *   - 真实 Runtime 数值变化 → GR-06（7 件逐件跑真战斗，逐发伤害 = 合成后的 def）
 *   - 真实 Runtime 节奏变化 → GR-06b（机枪：下一轮 burst 真的更早出现）
 *   - 状态机接线            → GR-07（ctx 携带真实基准武器 / 池内容 / **永不为空**）
 *   - 选择落地              → GR-07b（`runOverlayCards` 与池同源；选中写进 buffs）
 *   - 端到端因果            → GR-08（同一局内：选 `damageUp` 后**下一段**逐发伤害真的变大）
 *
 * ⚠️ 全部数值断言都从**正式 registry / 正式常量 / 真实战斗事件**现读；
 *    唯一的字面量是「哪个字段被改了」的关系式（×1.25 / ×0.75），不是数值表。
 */
import { describe, expect, it } from 'vitest';

import { HAMMER_DEFAULT_PARAMS } from '../src/battle/hammerBehavior';
import { registry } from '../src/core/content';
import type { FunctionalPartDef } from '../src/core/types';
import { EMPTY_SLOT, type BuildDraft } from '../src/lab/buildEditorModel';
import { RunBattleRuntime } from '../src/lab/portraitBattleLab/runBattleRuntime';
import {
  GENERIC_GROWTH_CADENCE_MULT,
  GENERIC_GROWTH_DAMAGE_MULT,
  HAMMER_WINDUP_PAUSE_BASE,
  PRODUCT_RUN_CANNON_BASE_DAMAGE,
  RUN_BASE_WEAPON_DEF_ID,
  RUN_BUILD_MODIFIERS,
  RUN_GENERIC_CHOICE_POOL,
  RUN_MODIFIER_OVERLAY,
  RUN_MODIFIERS,
  composeRunWeaponDef,
  createRunRegistry,
  damageParamKeyOf,
  isGenericGrowth,
  runPlayerWeaponDefId,
  weaponCadenceGrowth,
  weaponDamageParamKey,
  weaponOverlayMods,
  type RunBuildId,
} from '../src/lab/portraitBattleLab/runModifiers';
import {
  RUN_CHOICE_OPTIONS,
  chooseRunBuff,
  createRunPageState,
  finishRunBattle,
  pressRunAction,
  resolveDurability,
  runBuildIds,
  runCarriedPlayerHp,
  runChoicePool,
  runChoicePoolFamily,
  runCurrentNode,
  runOverlayCards,
  type RunPageContext,
  type RunPageState,
} from '../src/lab/portraitBattleLab/runPageState';
import { runPageContext } from '../src/lab/portraitBattleLab/runPageScene';
import { runScriptBattleNodes } from '../src/lab/portraitBattleLab/runScript';
import { FULL_RUN_SUPPORTED_WEAPON_IDS } from '../src/product/runCompatibility';
import { WEAPON_SLOT, defaultPlayerDraft } from '../src/product/playerLoadout';

/** 放行的 7 件（**真源现读**，不抄一份）。 */
const ALL = FULL_RUN_SUPPORTED_WEAPON_IDS;
const NON_CANNON = ALL.filter((id) => id !== RUN_BASE_WEAPON_DEF_ID);
/** 第一段遭遇（7 件都能真实接敌的那一场；与 Q3 三段序列的第 1 段同一个对手）。 */
const SEG1 = 'ProtoRusher';
const FRAME_MS = 1000 / 60;

function defOf(id: string): FunctionalPartDef {
  const def = registry.functionals.get(id);
  if (!def) throw new Error(`正式 registry 缺少武器 "${id}"`);
  return def;
}

/** 归因夹具：车上**只留这一件**武器（伤害只能来自它）。 */
function onlyDraft(weaponDefId: string, slot: string = WEAPON_SLOT): BuildDraft {
  const base = defaultPlayerDraft();
  return {
    ...base,
    functionalSelections: {
      front: EMPTY_SLOT,
      frontMass: EMPTY_SLOT,
      top: EMPTY_SLOT,
      rear: EMPTY_SLOT,
      [slot]: weaponDefId,
    },
  };
}

/** 该武器在**产品真实路径**下的基准伤害（Cannon 走玩家基线 120，其余 = 它自己的 canonical）。 */
function baseDamageOf(id: string): number {
  const raw = defOf(id).behaviorParams?.[weaponDamageParamKey(defOf(id))!];
  const n = typeof raw === 'number' ? raw : NaN;
  return id === RUN_BASE_WEAPON_DEF_ID ? PRODUCT_RUN_CANNON_BASE_DAMAGE : n;
}

function ctxFor(weaponDefId: string, key: string): RunPageContext {
  return runPageContext({
    source: 'profile',
    label: '测试车',
    draft: onlyDraft(weaponDefId),
    tag: 'profile-equipped',
    key: `q2|${key}`,
  });
}

/* ------------------------------------------------------ 真实战斗取证 */

interface FightFact {
  readonly perHit: readonly number[];
  readonly weapon: { readonly defId: string; readonly behavior: string; readonly damage: number } | null;
  /** 第 8 发弹丸出现的真实步号（= 下一轮 burst 的第一发）；不观战 ⇒ `null`。 */
  readonly nextBurstStep: number | null;
}

/**
 * 跑一场真实战斗（到终态或步数上限）。
 *
 * `watchBursts` 为真时额外记录「每一发弹丸是在第几步被创建的」——
 * `rateUp` 的节奏效果因此是**弹丸真的更早出现**，而不是读配置。
 */
function fight(weaponDefId: string, build: readonly RunBuildId[], watchBursts = false): FightFact {
  const rt = new RunBattleRuntime({
    build,
    carriedHp: null,
    encounterId: SEG1,
    playerDraft: onlyDraft(weaponDefId),
    playerLoadoutTag: 'profile-equipped',
    // 与 `runPage.beginBattle()` **同口径**（那边恒传 true）。
    playerBaseline: true,
  });
  try {
    const births: number[] = [];
    let prev = rt.projectileCount();
    let steps = 0;
    while (rt.result === null && steps < 4000) {
      rt.step(FRAME_MS);
      steps += 1;
      if (watchBursts) {
        const now = rt.projectileCount();
        for (let k = prev; k < now; k++) births.push(steps);
        prev = now;
      }
    }
    const perHit: number[] = [];
    for (const read of Object.values(rt.playerWeaponHitSummary())) perHit.push(...read.damages);
    const w = rt.playerWeapons().find((it) => it.hardpointId === WEAPON_SLOT);
    return {
      perHit,
      weapon: w ? { defId: w.defId, behavior: w.behavior, damage: w.damage } : null,
      nextBurstStep: watchBursts && births.length >= 8 ? births[7]! : null,
    };
  } finally {
    rt.dispose();
  }
}

interface WalkFact {
  readonly pools: readonly {
    readonly nodeId: string;
    readonly kind: string | null;
    readonly ids: readonly string[];
  }[];
  readonly damagePerSegment: readonly (readonly number[])[];
  readonly buffs: readonly string[];
  readonly finalPhase: string;
}

/**
 * 从 DAY 1 走到底，**真实战斗驱动**（与宿主同口径），记录每个 CHOICE 节点的候选池、
 * 每段真实逐发伤害、最终 Build。
 *
 * ⚠️ PRODUCT-LOOP-R9-THREE-STAGE-BUILD-PACING：脚本是严格三段链 ⇒ 只有 **2 个** CHOICE 节点
 *    （`d2-choice1` / `d3-choice2`），且没有分支 ⇒ `upgrade` 这个旧耐久选项已走不到
 *    （保留这一支只为「脚本恢复该节点时走查也不失配」）。
 */
function walk(weaponDefId: string, pick: (pool: readonly string[]) => string): WalkFact {
  const ctx = ctxFor(weaponDefId, `walk-${weaponDefId}`);
  let s: RunPageState = createRunPageState(ctx);
  let carry: number | null = null;
  const pools: WalkFact['pools'][number][] = [];
  const damagePerSegment: number[][] = [];

  for (let guard = 0; guard < 400; guard++) {
    // ⚠️ 终态必须**先**停：`pressRunAction` 在 COMPLETE / FAILED 时是「开新 Run」
    //    （`runStartsNewRun`）⇒ 少了这一行，走查会一局接一局地跑下去（实测 67 段）。
    if (s.phase === 'COMPLETE' || s.phase === 'FAILED') break;

    if (s.phase === 'CHOICE') {
      const ids = runChoicePool(s).map((o) => o.id as string);
      pools.push({ nodeId: s.nodeId, kind: runCurrentNode(s).choicePool ?? null, ids });
      s = chooseRunBuff(s, pick(ids), ctx);
      continue;
    }
    if (s.phase === 'DURABILITY') {
      s = resolveDurability(s, 'upgrade', ctx);
      continue;
    }
    if (s.phase === 'BATTLE') {
      const node = runCurrentNode(s);
      const rt = new RunBattleRuntime({
        build: runBuildIds(s),
        carriedHp: carry,
        encounterId: node.encounterId,
        playerDraft: onlyDraft(weaponDefId),
        playerLoadoutTag: 'profile-equipped',
        playerBaseline: true,
      });
      try {
        let steps = 0;
        while (rt.result === null && steps < 4000) {
          rt.step(FRAME_MS);
          steps += 1;
        }
        const perHit: number[] = [];
        for (const read of Object.values(rt.playerWeaponHitSummary())) perHit.push(...read.damages);
        damagePerSegment.push(perHit);
        const hp = rt.hp();
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
    if (s.phase === 'EVENT') carry = runCarriedPlayerHp(s);
    s = pressRunAction(s, ctx);
  }

  return {
    pools,
    damagePerSegment,
    buffs: runBuildIds(s).map((b) => b as string),
    finalPhase: s.phase,
  };
}

let cachedWalk: WalkFact | null = null;
/** 同一支走查只跑一次（GR-07 / GR-08 共用同一份真实证据）。 */
function machineGunWalk(): WalkFact {
  if (!cachedWalk) cachedWalk = walk('machineGun', (pool) => pool[0]!);
  return cachedWalk;
}

const uniq = (xs: readonly number[]): number[] => [...new Set(xs)].sort((a, b) => a - b);

describe('PRODUCT-LOOP-R7-WEAPON-BASIC-BUILD-CONTENT', () => {
  /* ============================================================ GR-01 */
  it('GR-01 伤害键：7/7 各**恰一个**顶层含 `damage` 的数值键（与 buildSnapshot 同一判据）', () => {
    const keys: Record<string, string | null> = {};
    for (const id of ALL) keys[id] = weaponDamageParamKey(defOf(id));
    expect(keys, '取不到唯一伤害键 ⇒ 通用成长对那件武器就不该被提供').toEqual({
      cannon: 'projectileDamage',
      flamethrower: 'projectileDamage',
      hammer: 'baseDamage',
      laser: 'projectileDamage',
      machineGun: 'projectileDamage',
      rammer: 'baseDamage',
      shotgun: 'projectileDamage',
    });
    // 判据本体：0 个 ⇒ null（不猜）；嵌套键不参与（`saw.hitPolicy.damage` 那种）
    expect(damageParamKeyOf({})).toBeNull();
    expect(damageParamKeyOf({ muzzleSpeed: 8 })).toBeNull();
    expect(damageParamKeyOf({ hitPolicy: { damage: 9 } })).toBeNull();
    expect(damageParamKeyOf({ aDamage: 1, bDamage: 2 }), '两个候选 ⇒ 不猜').toBeNull();
  });

  /* ============================================================ GR-02 */
  it('GR-02 节奏键：按 Q1 真源逐件取自**它自己**的 canonical（不强行统一成一个字段名）', () => {
    expect(weaponCadenceGrowth(defOf('cannon'))).toEqual({ key: 'cooldownMs', base: 1000 });
    expect(weaponCadenceGrowth(defOf('flamethrower'))).toEqual({ key: 'cooldownMs', base: 600 });
    // PRODUCT-LOOP-R11-LASER-CADENCE-R1：laser 的 cooldownMs 1800 → 600（只动攻击间隔，
    // 前摇 chargeMs 未动）。本键仍逐件取自**它自己**的 canonical，故这里跟着 canonical 走。
    expect(weaponCadenceGrowth(defOf('laser'))).toEqual({ key: 'cooldownMs', base: 600 });
    expect(weaponCadenceGrowth(defOf('machineGun'))).toEqual({ key: 'cooldownMs', base: 1100 });
    expect(weaponCadenceGrowth(defOf('shotgun'))).toEqual({ key: 'cooldownMs', base: 1300 });
    // 接触类：canonical 里真有该键（rammer）就直接读它
    // R11-RAMMER：`restSteps` 24 → 12（这里读的是 canonical ⇒ 必须同步）
    expect(weaponCadenceGrowth(defOf('rammer'))).toEqual({ key: 'restSteps', base: 12 });
    // hammer：该键只在行为代码默认里 ⇒ 用文档化基准（同源由 GR-02b 钉）
    expect(weaponCadenceGrowth(defOf('hammer'))).toEqual({
      key: 'windupPauseSteps',
      base: HAMMER_WINDUP_PAUSE_BASE,
    });
    // 6/6 非 Cannon 都取得到
    for (const id of NON_CANNON) expect(weaponCadenceGrowth(defOf(id)), id).not.toBeNull();
    // 取不到 ⇒ null（**不强行统一**：没有该字段的武器不该被塞一个）
    const noCadence = {
      ...defOf('cannon'),
      behavior: 'unknownBehavior',
      behaviorParams: { projectileDamage: 5 },
    };
    expect(weaponCadenceGrowth(noCadence as FunctionalPartDef)).toBeNull();
  });

  it('GR-02b hammer 基准与行为真源**同源**（读 `HAMMER_DEFAULT_PARAMS`，不是抄一个数）', () => {
    expect(HAMMER_WINDUP_PAUSE_BASE).toBe(HAMMER_DEFAULT_PARAMS.windupPauseSteps);
  });

  /* ============================================================ GR-03 */
  it('GR-03 合成语义：6 件非 Cannon 伤害真的变大、节奏真的变快，Cannon **零变化**（保持原逻辑）', () => {
    for (const id of ALL) {
      const base = defOf(id);
      const grown = composeRunWeaponDef(base, ['damageUp', 'rateUp'], id);
      expect(grown.behavior, `${id}：成长污染了 behavior`).toBe(base.behavior);

      const before = base.behaviorParams ?? {};
      const after = grown.behaviorParams!;

      // Cannon 冻结：通用成长对它**零适用** ⇒ 逐字段一个数字都不许动。
      if (id === RUN_BASE_WEAPON_DEF_ID) {
        expect(after, 'Cannon 被通用成长改写了').toEqual(before);
        continue;
      }

      const dKey = weaponDamageParamKey(base)!;
      const cKey = weaponCadenceGrowth(base)!;

      expect(after[dKey], `${id} 伤害`).toBe(
        Math.round((before[dKey] as number) * GENERIC_GROWTH_DAMAGE_MULT),
      );
      expect(after[dKey] as number, `${id} 伤害必须变大`).toBeGreaterThan(before[dKey] as number);

      const curCadence = typeof before[cKey.key] === 'number' ? (before[cKey.key] as number) : cKey.base;
      expect(after[cKey.key], `${id} 节奏`).toBe(
        Math.max(1, Math.round(curCadence * GENERIC_GROWTH_CADENCE_MULT)),
      );
      expect(after[cKey.key] as number, `${id} 节奏必须变快`).toBeLessThan(curCadence);

      // 除这两个键之外**逐字段不变**（没有夹带任何其它改动）
      for (const k of Object.keys(before)) {
        if (k === dKey || k === cKey.key) continue;
        expect(after[k], `${id}.${k} 不该被动`).toEqual(before[k]);
      }
      expect(Object.keys(after).length).toBe(
        Object.keys(before).length + (cKey.key in before ? 0 : 1),
      );
    }
  });

  /* ============================================================ GR-04 */
  it('GR-04 Cannon 冻结：通用成长对它**零适用**，既有 5 项与三池逐字节不变', () => {
    expect(weaponOverlayMods(['damageUp', 'rateUp'], RUN_BASE_WEAPON_DEF_ID)).toEqual([]);
    expect(weaponOverlayMods(['damageUp', 'rateUp'], null)).toEqual([]);
    // 非 Cannon 局：Cannon 的 5 项**完全不适用**（不套字段名、不套 behavior）
    expect(
      weaponOverlayMods(['heavyShell', 'twinCannon', 'fastReload', 'tripleLoad'], 'hammer'),
    ).toEqual([]);
    // 逐项 overlay 数值表（Cannon 侧冻结内容）
    expect(RUN_MODIFIER_OVERLAY.heavyShell.behaviorParams).toEqual({
      projectileRadius: 16,
      projectileMass: 4,
      recoilImpulse: 90,
    });
    expect(RUN_MODIFIER_OVERLAY.twinCannon.behaviorParams).toEqual({
      burstRounds: 2,
      burstIntervalMs: 100,
    });
    expect(RUN_MODIFIER_OVERLAY.fastReload.behaviorParams).toEqual({ cooldownMs: 650 });
    expect(RUN_MODIFIER_OVERLAY.tripleLoad.behaviorParams).toEqual({
      burstRounds: 3,
      burstIntervalMs: 100,
    });
    // 池与选项：Cannon 仍然是原来那三个 / 那两项
    expect(RUN_MODIFIERS.map((m) => m.id)).toEqual(['heavyShell', 'twinCannon', 'fastReload']);
    expect(RUN_BUILD_MODIFIERS.map((m) => m.id)).toEqual([
      'kineticBurst',
      'tripleLoad',
      'emergencyRepair',
    ]);
    expect(RUN_CHOICE_OPTIONS.map((o) => o.id)).toEqual(['heavyShell', 'twinCannon', 'fastReload']);
    // 通用成长**没有**混进 Cannon 的 id 闭集
    expect(RUN_MODIFIERS.some((m) => isGenericGrowth(m.id as string))).toBe(false);
    // 玩家基线（Cannon 的 120）**不写进**别的武器
    const oid = runPlayerWeaponDefId(['damageUp'], true, 'hammer');
    expect(oid).toBe('run.mod.damageUp');
    const overlaid = createRunRegistry(['damageUp'], true, 'hammer').functionals.get(oid!)!;
    expect(overlaid.behavior).toBe('hammer');
    expect(overlaid.behaviorParams!.baseDamage).toBe(Math.round(90 * GENERIC_GROWTH_DAMAGE_MULT));
    expect(overlaid.behaviorParams!.projectileDamage, '不得把 Cannon 的字段搬过来').toBeUndefined();
    expect(overlaid.behaviorParams!.projectileRadius).toBeUndefined();
    // Cannon 自己：开了基线、但选了通用成长 ⇒ 只有基线（120），没有成长
    const cannonId = runPlayerWeaponDefId(['damageUp'], true, RUN_BASE_WEAPON_DEF_ID);
    expect(cannonId).toBe('run.mod.@base');
    const cannonOverlaid = createRunRegistry(
      ['damageUp'],
      true,
      RUN_BASE_WEAPON_DEF_ID,
    ).functionals.get(cannonId!)!;
    expect(cannonOverlaid.behaviorParams!.projectileDamage).toBe(PRODUCT_RUN_CANNON_BASE_DAMAGE);
    expect(cannonOverlaid.behaviorParams!.cooldownMs, '通用成长不得对 Cannon 生效').toBe(1000);
  });

  /* ============================================================ GR-05 */
  it('GR-05 canonical global Def 未被改写（造完本局 registry 后逐字段对拍正式单例）', () => {
    const before = ALL.map((id) => JSON.stringify(defOf(id).behaviorParams ?? {}));
    createRunRegistry(['damageUp', 'rateUp'], true, 'hammer');
    createRunRegistry(['damageUp'], true, RUN_BASE_WEAPON_DEF_ID);
    createRunRegistry(['heavyShell', 'tripleLoad'], true, RUN_BASE_WEAPON_DEF_ID);
    ALL.forEach((id, i) => {
      expect(JSON.stringify(defOf(id).behaviorParams ?? {}), `${id} 的正式定义被改写了`).toBe(
        before[i],
      );
    });
    // 那件 overlay 部件是**副本里的新键**，不是对正式键的就地改写
    const reg = createRunRegistry(['damageUp'], false, 'machineGun');
    expect(reg.functionals.get('machineGun')!.behaviorParams!.projectileDamage).toBe(20);
    expect(registry.functionals.get('machineGun')!.behaviorParams!.projectileDamage).toBe(20);
  });

  /* ============================================================ GR-06 */
  it('GR-06 真实 Runtime：7 件逐件跑真战斗，逐发伤害 = 合成后的 def（Cannon 保持冻结）', () => {
    const report: string[] = [];
    for (const id of ALL) {
      const plain = fight(id, []);
      const grown = fight(id, ['damageUp']);
      const expected0 = baseDamageOf(id);

      expect(plain.perHit.length, `${id} 第一段一发都没打中（夹具失效）`).toBeGreaterThan(0);
      expect(grown.perHit.length, `${id} 带成长时一发都没打中（夹具失效）`).toBeGreaterThan(0);
      expect(uniq(plain.perHit), `${id} 零 Build 的逐发伤害`).toEqual([expected0]);
      // 攻击行为仍是**它自己**的（防「hammer 选成长变成 cannon」这类污染）
      expect(grown.weapon?.behavior, `${id} 的战斗行为变了`).toBe(defOf(id).behavior);

      if (id === RUN_BASE_WEAPON_DEF_ID) {
        // Cannon 冻结：通用成长对它零适用 ⇒ 逐发伤害一个数字都不变
        expect(uniq(grown.perHit), 'Cannon 必须完全不受通用成长影响').toEqual([expected0]);
        report.push(`${id}: ${expected0} → ${expected0} (冻结)`);
        continue;
      }
      const expected1 = Math.round(expected0 * GENERIC_GROWTH_DAMAGE_MULT);
      expect(uniq(grown.perHit), `${id} 带伤害提升的逐发伤害`).toEqual([expected1]);
      expect(grown.weapon?.damage).toBe(expected1);
      report.push(`${id}: ${expected0} → ${expected1} (${defOf(id).behavior})`);
    }
    expect(report).toHaveLength(ALL.length);
    expect(report.join(' | ')).toContain('hammer: 90 → 113');
  });

  it('GR-06b 真实 Runtime 节奏：机枪带 `rateUp` 时，下一轮 burst 真的更早出现', () => {
    const plain = fight('machineGun', [], true);
    const fast = fight('machineGun', ['rateUp'], true);
    expect(plain.nextBurstStep, '夹具失效：没观察到第二轮 burst').not.toBeNull();
    expect(fast.nextBurstStep, '夹具失效：没观察到第二轮 burst').not.toBeNull();
    expect(fast.nextBurstStep!, '攻击加快后第二轮 burst 必须更早').toBeLessThan(plain.nextBurstStep!);
    // 节奏变了，但**一发一发的伤害不变**（只改间隔，不改伤害）
    expect(uniq(fast.perHit)).toEqual(uniq(plain.perHit));
  });

  /* ============================================================ GR-07 */
  it('GR-07 状态机接线：ctx 携带真实基准武器，非 Cannon 局给通用池且**永不为空**', () => {
    const cannonCtx = ctxFor('cannon', 'cannon');
    expect(cannonCtx.baseWeaponDefId, 'Cannon 车必须解析出 cannon').toBe('cannon');
    expect(cannonCtx.vehicleLabel).toBe('测试车');
    // `encounters` 仍按脚本节点提供（既有契约不变）
    expect(Object.keys(cannonCtx.encounters).sort()).toEqual(
      runScriptBattleNodes()
        .map((n) => n.id)
        .sort(),
    );
    for (const id of NON_CANNON) {
      expect(ctxFor(id, id).baseWeaponDefId, id).toBe(id);
    }
    // Cannon 局：池族仍是 cannon（DAY1 不是 CHOICE ⇒ 池为空）
    const cannonState = createRunPageState(cannonCtx);
    expect(runChoicePoolFamily(cannonState)).toBe('cannon');
    expect(cannonState.baseWeaponDefId).toBe(RUN_BASE_WEAPON_DEF_ID);
    expect(runChoicePool(cannonState)).toEqual([]);

    // 非 Cannon 局：逐节点给通用池，且**任何节点都不为空**（玩家不可能卡住）
    const fact = machineGunWalk();
    expect(fact.pools[0]!.ids).toEqual([...RUN_GENERIC_CHOICE_POOL]);
    expect(fact.pools.map((p) => p.kind)).toEqual(['layer1', 'layer2']);
    for (const p of fact.pools) {
      expect(p.ids.length, `${p.nodeId} 的候选池为空 ⇒ 玩家会卡住`).toBeGreaterThan(0);
    }
    // PRODUCT-LOOP-R9：脚本收成严格三段链 ⇒ 本局**恰好 2 次** Build Choice。
    expect(fact.pools.length).toBe(2);
    expect(fact.buffs).toEqual(['damageUp', 'rateUp']);
    expect(new Set(fact.buffs).size, '不得重复领同一个').toBe(fact.buffs.length);
    expect(fact.pools[1]!.ids).not.toContain('damageUp');
  });

  it('GR-07b 非 Cannon 局的选择真的落地成 buff（`runOverlayCards` 与池同源）', () => {
    const ctx = ctxFor('machineGun', 'mg-cards');
    const atChoice: RunPageState = {
      ...createRunPageState(ctx),
      phase: 'CHOICE',
      nodeId: 'd2-choice1',
    };
    expect(runOverlayCards(atChoice).map((o) => o.id)).toEqual([...RUN_GENERIC_CHOICE_POOL]);
    const picked = chooseRunBuff(atChoice, 'rateUp', ctx);
    expect(runBuildIds(picked)).toEqual(['rateUp']);
    // 不在池里的 id 一律 no-op（Cannon 的项对非 Cannon 局不再是歧义入口）
    expect(chooseRunBuff(atChoice, 'heavyShell', ctx)).toBe(atChoice);
  });

  /* ============================================================ GR-08 */
  it('GR-08 端到端因果：同一局内选了伤害提升，**下一段**的逐发伤害真的变大', () => {
    const fact = machineGunWalk();
    expect(fact.damagePerSegment.length, '三段都要真的打起来').toBe(3);
    for (const seg of fact.damagePerSegment) {
      expect(seg.length, '该段一发都没打中 ⇒ 变化结论无效').toBeGreaterThan(0);
    }
    expect(uniq(fact.damagePerSegment[0]!), '第一段（零 Build）').toEqual([20]);
    expect(uniq(fact.damagePerSegment[1]!), '第二段（已选伤害提升）').toEqual([25]);
  });
});
