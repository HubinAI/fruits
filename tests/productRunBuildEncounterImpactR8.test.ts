/**
 * PRODUCT-LOOP-R8-BUILD-ENCOUNTER-IMPACT-MATRIX｜**Build 是否让结果发生有意义改变** 的确定性取证矩阵。
 *
 * ── 本 Queue 相对 R7 的唯一增量：在 R7 的「零 Build 单场隔离」之上加一维 ──────────
 *
 * `PRODUCT-LOOP-R7-WEAPON-ENCOUNTER-MATRIX`（`productRunWeaponEncounterMatrixR7.test.ts`）回答的是
 * 「**零 Build** 单件打这个 Encounter 能不能处理」。它把 Build 维度**有意锁成 `[]`**，
 * 因此结构上回答不了本 Queue 的问题：
 *
 *   「同一件武器、同一个对手，**加上一个真实 Build 之后**，结果有没有发生有意义改变？」
 *
 * 本文件把 `build` 从 `[]` 放开成三种**当前正式内容**的取值，其余一切（世界 / 出生 / 耐久 /
 * 时间步 / 归因夹具 / 观测字段）与 R7 **逐字同口径** ⇒ 两表可以逐格对照。
 *
 * ── 不修改任何数值（本 Queue 的第一条红线）──────────────────────────────────
 *
 *   本文件**不**自动调参 / **不**新增 Build 内容 / **不**改 Enemy / **不**把失败改成通过 /
 *   **不**为了全绿更换 Encounter / **不**做强弱评分。单元格里的数是「这一次真实物理跑出来的」。
 *
 * ── 对照口径：A / B / C 三档，且「合法支持」由**官方内容路径**回答 ──────────────
 *
 *   | 档 | build | 适用条件 |
 *   |---|---|---|
 *   | A | `[]`（Zero Build） | **恒适用**（基线） |
 *   | B | `['damageUp']` | **当且仅当该武器**合法支持 `damageUp` |
 *   | C | `['rateUp']` | **当且仅当该武器**合法支持 `rateUp` |
 *
 * ⚠️ 「合法支持」不是本文件的判断，而是**读官方真源**得到的事实（见 `offeredBy` / `effectsOf`）：
 *
 *   - **提供面**（这一局该武器**到底会不会被给出**这一项）：`runChoicePoolFamily(state)` 回答池族。
 *     `'cannon'` ⇒ 走 Cannon 三池（`heavyShell` / `twinCannon` / `fastReload` / `tripleLoad`），
 *     **通用成长一项都不提供**；`'generic'` ⇒ 走通用池（`damageUp` / `rateUp` / `emergencyRepair`）。
 *   - **效果面**（这一项落到这件武器上**会不会真的改数字**）：`weaponDamageParamKey(def)` /
 *     `weaponCadenceGrowth(def)` 回答。
 *
 *   ⇒ 实测（`BI-01` 钉）：**7 件里只有 6 件合法支持 B / C**，唯一例外是 `cannon`。
 *     ⚠️ `cannon` **同时满足效果面**（它既有 `projectileDamage` 又有 `cooldownMs`）却
 *     **不满足提供面** —— 官方**从不对 cannon 局提供** `damageUp` / `rateUp`
 *     （`weaponOverlayMods(..., 'cannon')` 显式 `!isGenericGrowth` 过滤，`runModifiers.ts:782`）。
 *     ⇒ 本文件**不**给 cannon 硬塞这两项（那才会变成「构造测试专用 Buff」）。
 *
 * ── 附加行（**不属于**上面的 A/B/C 矩阵，单独标注）───────────────────────────
 *
 * `cannon` 的 B / C 官方不提供 ⇒ 主矩阵里它只有 A。为了让它那一列也有真实答案，
 * 附加两行**它自己合法的第一层官方项**（既有内容，零新增 / 零调参）：
 *
 *   - `heavyShell`（重弹头）＝ 弹丸半径 16 / 质量 4 / 后坐 90，**不改伤害键**
 *   - `fastReload`（快速装填）＝ `cooldownMs 1000 → 650`，节奏向
 *
 * ⚠️ 二者**不是** `damageUp` / `rateUp` 的等价物（Cannon 官方内容里**根本没有**抬伤害键的项，
 *    见 `BI-07` 的逐项 overlay 表）—— 它们只是「cannon 自己能选到的项」，标签逐行写清。
 *
 * ── 必要回归（Queue：ProtoRusher / Chaser 只做必要回归，不铺量）────────────────
 *
 * 近身两段的 **Zero Build** 与 R7 冻结台账**逐字段相等** ⇒ 证明放开 `build` 参数
 * 没有悄悄改动既有格子（`BI-04`）。**不**在近身两段铺 B / C。
 *
 * ── 取证协议（与 R7 逐字同口径）────────────────────────────────────────────
 *
 *   | 维度 | 取值 |
 *   |---|---|
 *   | 玩家装配 | `onlyDraft(weapon)`：清空 4 个功能槽，只在 `WEAPON_SLOT`(`frontMass`) 留这一件（归因夹具） |
 *   | 玩家基线 | `playerBaseline: true`（与 `runPage.beginBattle()` 同口径） |
 *   | 本局 Build | A `[]` / B `['damageUp']` / C `['rateUp']`（正式 `RunBuildId`，无测试专用项） |
 *   | 起始耐久 | `carriedHp: null`（满耐久；隔离跨段累积） |
 *   | 世界 | 构造**不传 config** ⇒ 正式 `DEFAULT_ARENA_CONFIG`（1600×900 / groundY 700 / 出生距 800） |
 *   | 时间步 | `1000/60` ms（= `FIXED_STEP_MS`） |
 *   | 固定窗口 | 前 600 步 = 10 s = `DEFAULT_ARENA_CONFIG.phases.activeMs`（锚在既有常量上） |
 *   | 终止上限 | `MAX_FRAMES = 4000` |
 *
 * ⚠️ `Cell.minGap` 是 **L2 外显度量**（`vehicleWorldBox` 含贴图外框），**不是接触判据**
 *    —— 该告示与更正完整记录在 R7 文件头 + `productHammerHitRegistrationP0.test.ts`。
 *
 * ⚠️ 复现性：与 R7 同一套确定性物理 + 无随机源 ⇒ 同参数重跑逐字段一致（`BI-02` / `BI-09`）。
 *
 * ── 实测结论（本 Queue 的答案）──────────────────────────────────────────────
 *
 * `RangedTurret` 列 = **19 格主矩阵 + 2 格 cannon 附加行**，全部进入正式终态（无拖延）。
 * 逐件「Build 有没有让结果发生有意义改变」（判据见 `classify`，台账见 `BI-05` / `BI-06`）：
 *
 *   | 分类 | 武器 | 实测 |
 *   |---|---|---|
 *   | **FLIP**（结果翻转） | `machineGun` | Zero `LOSS`（敌剩 **159.8**）→ `damageUp` **`WIN`**（我剩 80）/ `rateUp` **`WIN`**（我剩 40） |
 *   | **CONTACT**（从打不到到打得到） | `rammer` | Zero / `damageUp` **0 命中** → `rateUp` **2 命中 / 140 伤害** |
 *   | **OUTPUT**（输出显著变大，结果不变） | `flamethrower` · `laser` · `shotgun` | 伤害 528→660 / 640→800 / 600→760（+25% / +25% / +27%），**仍 LOSS** |
 *   | **NONE**（Build 对结果与输出都零影响） | `hammer` | Zero / `damageUp` **逐字段完全相同**（0 命中、敌剩 1099.9） |
 *   | **N/A**（官方不提供 B / C） | `cannon` | 池族 = `'cannon'` ⇒ 通用成长不提供；附加行 `heavyShell` / `fastReload` 把它从 1 命中抬到 2，**仍 LOSS** |
 *
 * ⇒ 直接回答 Queue 的两个举例：
 *   - `machineGun`：**确实**是「Zero Build FAILED（敌剩 159.8）→ Damage Build COMPLETE」——
 *     这正是本矩阵要抓的**有效设计证据**。
 *   - `hammer`：Zero / Damage / Rate **三档全 0 命中**，而**数值确实被改了**（`BI-07` 逐项证明
 *     `baseDamage 90→113`、`windupPauseSteps 20→15` 都真实生效）⇒ 问题**不在数值**，
 *     而在**接触 / 攻击结构**。
 *
 * ⚠️ 新增发现（R7 表结构上看不到的）：`rammer` 在 R7 里是「真·够不着」（`minGap = +7`、
 *    全程零接触）；加 `rateUp`（`restSteps 24→18`）后它**打到了 2 次**（`minGap = −2.2`）。
 *    ⇒ 「够不着」对 `rammer` 而言是 **Build 条件性**的，不是纯几何不变量。
 *    ⚠️ `minGap` 仍只作外显观测值，不当接触判据使用（见上）。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEFAULT_ARENA_CONFIG } from '../src/battle/arenaConfig';
import { registry } from '../src/core/content';
import type { FunctionalPartDef } from '../src/core/types';
import { EMPTY_SLOT, type BuildDraft } from '../src/lab/buildEditorModel';
import { RunBattleRuntime } from '../src/lab/portraitBattleLab/runBattleRuntime';
import {
  RUN_BASE_WEAPON_DEF_ID,
  RUN_GENERIC_CHOICE_POOL,
  createRunRegistry,
  runGenericChoiceDefs,
  weaponCadenceGrowth,
  weaponDamageParamKey,
  weaponOverlayMods,
  type RunBuildId,
} from '../src/lab/portraitBattleLab/runModifiers';
import { createRunPageState, runChoicePoolFamily } from '../src/lab/portraitBattleLab/runPageState';
import { runPageContext } from '../src/lab/portraitBattleLab/runPageScene';
import { FULL_RUN_SUPPORTED_WEAPON_IDS } from '../src/product/runCompatibility';
import { WEAPON_SLOT, defaultPlayerDraft } from '../src/product/playerLoadout';

/* ------------------------------------------------------------- 取证常量 */

const FRAME_MS = 1000 / 60;
const MAX_FRAMES = 4000;
const WINDOW_FRAMES = Math.round(DEFAULT_ARENA_CONFIG.phases.activeMs / FRAME_MS);

/** 7 件 Full Run Weapon（**真源现读**）。 */
const WEAPONS: readonly string[] = FULL_RUN_SUPPORTED_WEAPON_IDS;

/** Queue 的重点 Encounter（本矩阵的主列）。 */
const FOCUS = 'RangedTurret';
/** 只做**必要回归**的近身两段。 */
const NEAR = ['ProtoRusher', 'Chaser'] as const;

const PRODUCT_TAG = 'profile-equipped';

/* ------------------------------------------------------------- Build 三档 */

type BuildLabel = 'zero' | 'damageUp' | 'rateUp';

/** A / B / C 三档 = **当前正式内容**（`RunBuildId`），无测试专用项。 */
const BUILD_OF: Readonly<Record<BuildLabel, readonly RunBuildId[]>> = {
  zero: [],
  damageUp: ['damageUp'],
  rateUp: ['rateUp'],
};

/** 主矩阵里要跑的档（`cannon` 只跑 A —— 见文件头「合法支持」）。 */
const MAIN_LABELS: readonly BuildLabel[] = ['zero', 'damageUp', 'rateUp'];

/** Cannon 的**附加对照行**（它自己合法的第一层官方项，**不是** B / C）。 */
const CANNON_AUX: readonly { readonly id: RunBuildId; readonly label: string }[] = [
  { id: 'heavyShell', label: 'cannon+heavyShell' },
  { id: 'fastReload', label: 'cannon+fastReload' },
];

/* ------------------------------------------------------- 合法支持（读真源） */

function defOf(id: string): FunctionalPartDef {
  const def = registry.functionals.get(id);
  if (!def) throw new Error(`正式 registry 缺少武器 "${id}"`);
  return def;
}

/** 归因夹具：车上**只留这一件**武器（与 R7 同款；`slot` 声明为 `string` 以避开 TS1117）。 */
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

function stateFor(weaponDefId: string) {
  return createRunPageState(
    runPageContext({
      source: 'profile',
      label: `矩阵/${weaponDefId}`,
      draft: onlyDraft(weaponDefId),
      tag: PRODUCT_TAG,
      key: `r8|${weaponDefId}`,
    }),
  );
}

/**
 * **提供面**：这一局该武器**到底会不会被给出**这一项。
 *
 * 判据 = 官方池族（`runChoicePoolFamily`）+ 官方通用池内容（`runGenericChoiceDefs`）——
 * 与 `runChoicePool()` 在 CHOICE 节点上取用的**同一条**逻辑，这里只是不驱动状态机。
 */
function offeredBy(weaponDefId: string, id: RunBuildId): boolean {
  if (runChoicePoolFamily(stateFor(weaponDefId)) !== 'generic') return false;
  return runGenericChoiceDefs([]).some((d) => d.id === id);
}

/** **效果面**：这一项落到该武器上**会不会真的改数字**。 */
function effectsOf(weaponDefId: string): { readonly damageUp: boolean; readonly rateUp: boolean } {
  const def = defOf(weaponDefId);
  return {
    damageUp: weaponDamageParamKey(def) !== null,
    rateUp: weaponCadenceGrowth(def) !== null,
  };
}

/** 「**合法支持**」= 提供面 ∧ 效果面（`zero` 恒真）。 */
function legallySupports(weaponDefId: string, label: BuildLabel): boolean {
  if (label === 'zero') return true;
  return offeredBy(weaponDefId, label) && effectsOf(weaponDefId)[label];
}

/* ----------------------------------------------------------- 单格取证 */

interface PartTally {
  readonly count: number;
  readonly damage: number;
}

interface Cell {
  readonly weapon: string;
  readonly encounter: string;
  readonly buildLabel: string;
  readonly build: readonly RunBuildId[];
  readonly steps: number;
  readonly terminal: boolean;
  readonly winner: 'A' | 'B' | null;
  readonly endReason: string | null;
  readonly hpA0: number;
  readonly hpA: number;
  readonly hpAMax: number;
  readonly hpB0: number;
  readonly hpB: number;
  readonly hpBMax: number;
  readonly hits: number;
  readonly damage: number;
  /** 逐发真实扣血（归因夹具 ⇒ 只可能来自那一件）。 */
  readonly perHit: readonly number[];
  readonly perPart: Readonly<Record<string, PartTally>>;
  readonly firstHitMs: number | null;
  readonly firstHitStep: number | null;
  readonly windowDamage: number;
  readonly windowHits: number;
  readonly windowSurvived: boolean;
  readonly slots: readonly string[];
  /** L2 外显度量（**不是**接触判据；见文件头告示）。 */
  readonly minGap: number;
  readonly gapAtWindow: number | null;
  readonly finalGap: number;
  readonly sawProjectile: boolean;
  readonly arenaW: number;
  readonly arenaH: number;
  readonly groundY: number;
}

function totalsOf(rt: RunBattleRuntime): {
  hits: number;
  damage: number;
  firstMs: number | null;
  perHit: number[];
  perPart: Record<string, PartTally>;
} {
  let hits = 0;
  let damage = 0;
  let firstMs: number | null = null;
  const perHit: number[] = [];
  const perPart: Record<string, PartTally> = {};
  for (const [partId, read] of Object.entries(rt.playerWeaponHitSummary())) {
    const dmg = read.damages.reduce((a, b) => a + b, 0);
    hits += read.count;
    damage += dmg;
    perHit.push(...read.damages);
    perPart[partId] = { count: read.count, damage: dmg };
    if (firstMs === null || read.firstAtMs < firstMs) firstMs = read.firstAtMs;
  }
  return { hits, damage, firstMs, perHit, perPart };
}

/** 跑**一场**独立战斗（满耐久）。`build` 是本文件的唯一新增维度。 */
function fight(
  weapon: string,
  buildLabel: string,
  build: readonly RunBuildId[],
  encounterId: string,
): Cell {
  const rt = new RunBattleRuntime({
    build,
    carriedHp: null,
    encounterId,
    playerDraft: onlyDraft(weapon),
    playerLoadoutTag: PRODUCT_TAG,
    playerBaseline: true,
  });
  try {
    const start = rt.hp();
    let steps = 0;
    let firstHitStep: number | null = null;
    let windowDamage = -1;
    let windowHits = -1;
    let windowSurvived = false;
    let sawProjectile = false;
    let minGap = Infinity;
    let gapAtWindow: number | null = null;

    while (rt.result === null && steps < MAX_FRAMES) {
      rt.step(FRAME_MS);
      steps += 1;
      const gap = rt.gapWorld();
      if (gap < minGap) minGap = gap;
      if (!sawProjectile && rt.playerProjectileCount() > 0) sawProjectile = true;
      if (firstHitStep === null && totalsOf(rt).hits > 0) firstHitStep = steps;
      if (steps === WINDOW_FRAMES) {
        const t = totalsOf(rt);
        windowDamage = t.damage;
        windowHits = t.hits;
        windowSurvived = true;
        gapAtWindow = gap;
      }
    }

    const t = totalsOf(rt);
    if (!windowSurvived) {
      windowDamage = t.damage;
      windowHits = t.hits;
    }
    const hp = rt.hp();
    return {
      weapon,
      encounter: encounterId,
      buildLabel,
      build,
      steps,
      terminal: rt.result !== null,
      winner: rt.result?.winner ?? null,
      endReason: rt.result?.endReason ?? null,
      hpA0: start.a,
      hpA: hp.a,
      hpAMax: hp.aMax,
      hpB0: start.b,
      hpB: hp.b,
      hpBMax: hp.bMax,
      hits: t.hits,
      damage: t.damage,
      perHit: t.perHit,
      perPart: t.perPart,
      firstHitMs: t.firstMs,
      firstHitStep,
      windowDamage,
      windowHits,
      windowSurvived,
      slots: rt.playerWeapons().map((w) => `${w.hardpointId}:${w.defId}`),
      minGap,
      gapAtWindow,
      finalGap: rt.gapWorld(),
      sawProjectile,
      arenaW: rt.arenaWidth,
      arenaH: rt.arenaHeight,
      groundY: rt.groundY,
    };
  } finally {
    rt.dispose();
  }
}

/* ------------------------------------------------------------------ 缓存 */

const CACHE = new Map<string, Cell>();

function cached(key: string, make: () => Cell): Cell {
  let hit = CACHE.get(key);
  if (!hit) {
    hit = make();
    CACHE.set(key, hit);
  }
  return hit;
}

/** 主矩阵格：`cannon` 只跑 `zero`；其余 6 件跑满 A / B / C。 */
function mainCell(weapon: string, label: BuildLabel): Cell {
  return cached(`${weapon}|${label}|${FOCUS}`, () => fight(weapon, label, BUILD_OF[label], FOCUS));
}

/** 主矩阵里**实际存在**的格（按 Queue 的「合法支持」口径过滤）。 */
function matrixCells(): readonly Cell[] {
  const out: Cell[] = [];
  for (const w of WEAPONS) {
    for (const l of MAIN_LABELS) {
      if (!legallySupports(w, l)) continue;
      out.push(mainCell(w, l));
    }
  }
  return out;
}

/** 必要的近身回归格（**只跑 Zero Build**）。 */
function nearCell(weapon: string, encounter: string): Cell {
  return cached(`${weapon}|zero|${encounter}`, () => fight(weapon, 'zero', [], encounter));
}

function nearCells(): readonly Cell[] {
  const out: Cell[] = [];
  for (const w of WEAPONS) for (const e of NEAR) out.push(nearCell(w, e));
  return out;
}

/** Cannon 附加对照格（它自己的第一层官方项）。 */
function cannonAuxCell(id: RunBuildId, label: string): Cell {
  return cached(`${RUN_BASE_WEAPON_DEF_ID}|${label}|${FOCUS}`, () =>
    fight(RUN_BASE_WEAPON_DEF_ID, label, [id], FOCUS),
  );
}

function cannonAuxCells(): readonly Cell[] {
  return CANNON_AUX.map((a) => cannonAuxCell(a.id, a.label));
}

/* ------------------------------------------------------------ 台账 / 判定 */

function r1(x: number): number {
  return Math.round(x * 10) / 10;
}

/** 冻结台账的一行：`[terminal, winner, endReason, hits, damage, firstHitStep(-1=无), windowDamage, hpA, hpB]`。 */
type CellRow = readonly [
  'T' | 'S',
  'A' | 'B' | '-',
  string,
  number,
  number,
  number,
  number,
  number,
  number,
];

function rowOf(c: Cell): CellRow {
  return [
    c.terminal ? 'T' : 'S',
    c.winner ?? '-',
    c.endReason ?? '-',
    c.hits,
    c.damage,
    c.firstHitStep ?? -1,
    c.windowDamage,
    r1(c.hpA),
    r1(c.hpB),
  ];
}

/** 结果标签（与 R7 同口径 + 双亡如实披露）。 */
function outcomeCell(c: Cell): string {
  if (!c.terminal) return 'STALL';
  const zero = c.hits === 0;
  const mutual = c.hpA <= 0 && c.hpB <= 0;
  if (c.winner === 'A') return zero ? 'WIN·0hit' : mutual ? 'WIN·双亡' : 'WIN';
  return zero ? 'LOSS·0hit' : 'LOSS';
}

/**
 * 逐件「Build 有没有让结果发生有意义改变」的分类（本 Queue 的**唯一判据**，四档 + N/A）。
 *
 *   - `FLIP`    ：胜者翻转（唯一真正「结果改变」的形态）
 *   - `CONTACT` ：零 Build 一发打不中，加 Build 后**能打到**（打法层面的改变）
 *   - `OUTPUT`  ：有命中且伤害显著变大（≥ +10%），但结果不变
 *   - `NONE`    ：结果与输出都没有可察觉变化
 *   - `N/A`     ：官方不提供 B / C（无对照可做）
 *
 * ⚠️ 这是**取证口径**，不是游戏规则；阈值 +10% 只用来把「噪声级抖动」与「真实输出提升」分开。
 */
type ImpactClass = 'N/A' | 'FLIP' | 'CONTACT' | 'OUTPUT' | 'NONE';

const IMPACT_RANK: Readonly<Record<ImpactClass, number>> = {
  'N/A': 0,
  NONE: 1,
  OUTPUT: 2,
  CONTACT: 3,
  FLIP: 4,
};

function classify(weapon: string): ImpactClass {
  const labels = MAIN_LABELS.filter((l) => l !== 'zero' && legallySupports(weapon, l));
  if (labels.length === 0) return 'N/A';
  const base = mainCell(weapon, 'zero');
  let best: ImpactClass = 'NONE';
  for (const l of labels) {
    const c = mainCell(weapon, l);
    let cls: ImpactClass;
    if (c.winner !== base.winner) cls = 'FLIP';
    else if (base.hits === 0 && c.hits > 0) cls = 'CONTACT';
    else if (c.hits > 0 && c.damage >= base.damage * 1.1) cls = 'OUTPUT';
    else cls = 'NONE';
    if (IMPACT_RANK[cls] > IMPACT_RANK[best]) best = cls;
  }
  return best;
}

const uniq = (xs: readonly number[]): number[] => [...new Set(xs)].sort((a, b) => a - b);

/* ---------------------------------------------------------------- 用例 */

describe('PRODUCT-LOOP-R8｜Build × Encounter 影响矩阵（Build 是否让结果有意义地改变）', () => {
  /* ================================================================ BI-00 */
  it('BI-00 取证常量：窗口锚在既有 Active 阶段常量上；Build 三档全部是正式内容', () => {
    expect(WINDOW_FRAMES).toBe(600);
    expect(DEFAULT_ARENA_CONFIG.phases.activeMs).toBe(10_000);
    expect(WEAPONS.length).toBe(7);
    expect(new Set(WEAPONS).size).toBe(7);
    // B / C 用的就是官方通用池里的两项（不是自造 id）
    expect(RUN_GENERIC_CHOICE_POOL).toContain('damageUp');
    expect(RUN_GENERIC_CHOICE_POOL).toContain('rateUp');
    expect(BUILD_OF.damageUp).toEqual(['damageUp']);
    expect(BUILD_OF.rateUp).toEqual(['rateUp']);
    expect(BUILD_OF.zero).toEqual([]);
  });

  /* ================================================================ BI-01 */
  it('BI-01「合法支持」逐件读真源：7 件里**只有 6 件**合法支持 B / C（唯一例外 = cannon）', () => {
    const table: Record<string, readonly [boolean, boolean, boolean]> = {};
    for (const w of WEAPONS) {
      table[w] = [
        legallySupports(w, 'zero'),
        legallySupports(w, 'damageUp'),
        legallySupports(w, 'rateUp'),
      ];
    }
    expect(table).toEqual({
      // [A 恒适用, B damageUp 合法, C rateUp 合法]
      cannon: [true, false, false],
      flamethrower: [true, true, true],
      hammer: [true, true, true],
      laser: [true, true, true],
      machineGun: [true, true, true],
      rammer: [true, true, true],
      shotgun: [true, true, true],
    });

    // ① cannon 的例外来自**提供面**（官方池族），不是效果面 —— 它两个键其实都有
    expect(runChoicePoolFamily(stateFor(RUN_BASE_WEAPON_DEF_ID)), 'cannon 局的池族').toBe('cannon');
    expect(effectsOf(RUN_BASE_WEAPON_DEF_ID), 'cannon 两个键都有（但不能靠它绕过提供面）').toEqual({
      damageUp: true,
      rateUp: true,
    });
    // 官方 overlay 支路对 cannon **显式排除**通用成长 ⇒ 选它等于白选
    expect(weaponOverlayMods(['damageUp', 'rateUp'], RUN_BASE_WEAPON_DEF_ID)).toEqual([]);

    // ② 其余 6 件的池族都是 generic，两项都在通用池里 ⇒ 提供面成立
    for (const w of WEAPONS) {
      if (w === RUN_BASE_WEAPON_DEF_ID) continue;
      expect(runChoicePoolFamily(stateFor(w)), `${w} 的池族`).toBe('generic');
      expect(offeredBy(w, 'damageUp'), `${w} 必须被官方提供 damageUp`).toBe(true);
      expect(offeredBy(w, 'rateUp'), `${w} 必须被官方提供 rateUp`).toBe(true);
      expect(effectsOf(w), `${w} 两项都该有效果`).toEqual({ damageUp: true, rateUp: true });
    }

    // ③ 因此主矩阵的形状 = 7 × A + 6 × B + 6 × C = 19 格
    expect(matrixCells().length).toBe(19);
  });

  /* ================================================================ BI-02 */
  it('BI-02 单场隔离 + 复现性：满耐久 / 正式默认世界 / 无「无限拖延」；重跑同参数逐字段一致', () => {
    for (const c of [...matrixCells(), ...nearCells(), ...cannonAuxCells()]) {
      const tag = `${c.weapon}+${c.buildLabel} vs ${c.encounter}`;
      expect(c.hpA0, `${tag}：玩家满耐久开局`).toBe(c.hpAMax);
      expect(c.hpB0, `${tag}：对手满血开局`).toBe(c.hpBMax);
      expect(c.arenaW, `${tag}: arena width`).toBe(DEFAULT_ARENA_CONFIG.width);
      expect(c.arenaH, `${tag}: arena height`).toBe(DEFAULT_ARENA_CONFIG.height);
      expect(c.groundY, `${tag}: groundY`).toBe(DEFAULT_ARENA_CONFIG.groundY);
      expect(c.terminal, `${tag}：必须进正式终态`).toBe(true);
      expect(c.winner, `${tag}：终态必须有胜者`).toMatch(/^[AB]$/);
      expect(c.endReason, `${tag}：结束原因`).toMatch(/^(hp|arenaEnd)$/);
      expect(c.steps, `${tag}：必须有真实战斗步数`).toBeGreaterThan(1);
    }
    // 复现性抽查：同一格重新构造一次，逐字段一致（含浮点耐久与逐发伤害）
    const a = mainCell('machineGun', 'damageUp');
    const b = fight('machineGun', 'damageUp', BUILD_OF.damageUp, FOCUS);
    expect({ ...b, build: [...b.build] }).toEqual({ ...a, build: [...a.build] });
  });

  /* ================================================================ BI-03 */
  it('BI-03 Build 真的注入到武器上：B 档逐发伤害 = round(canonical × 1.25)；C 档只改节奏', () => {
    for (const w of WEAPONS) {
      if (w === RUN_BASE_WEAPON_DEF_ID) continue;
      const zero = mainCell(w, 'zero');
      const dmg = mainCell(w, 'damageUp');

      // ① 归因夹具：车上只有这一件，命中只可能来自它
      expect(zero.slots, `${w}：车上只能有这一件`).toEqual([`${WEAPON_SLOT}:${w}`]);
      expect(dmg.slots, `${w}：车上只能有这一件`).toEqual([`${WEAPON_SLOT}:${w}`]);
      for (const parts of [Object.keys(zero.perPart), Object.keys(dmg.perPart)]) {
        expect(parts.length, `${w}：命中来源部件数`).toBeLessThanOrEqual(1);
        if (parts.length === 1) expect(parts[0]).toBe(w);
      }

      // ② B 档确实改了伤害键（有命中时可观测；0 命中则如实跳过）
      const key = weaponDamageParamKey(defOf(w))!;
      const canonical = defOf(w).behaviorParams![key] as number;
      if (zero.hits > 0) {
        expect(uniq(zero.perHit), `${w} 零 Build 逐发伤害 = canonical`).toEqual([canonical]);
      }
      if (dmg.hits > 0) {
        expect(uniq(dmg.perHit), `${w} 带 damageUp 逐发伤害`).toEqual([
          Math.round(canonical * 1.25),
        ]);
      }
    }
    // C 档：节奏变了、逐发伤害**一个数字都不变**（只改间隔）
    const mgZero = mainCell('machineGun', 'zero');
    const mgRate = mainCell('machineGun', 'rateUp');
    expect(mgZero.hits, '夹具失效：机枪零 Build 无命中').toBeGreaterThan(0);
    expect(mgRate.hits, '夹具失效：机枪带 rateUp 无命中').toBeGreaterThan(0);
    expect(uniq(mgRate.perHit), 'rateUp 不得改伤害').toEqual(uniq(mgZero.perHit));
  });

  /* ================================================================ BI-04 */
  it('BI-04 必要回归：近身两段（ProtoRusher / Chaser）Zero Build 与 R7 冻结台账**逐字段相等**', () => {
    const observed: Record<string, CellRow> = {};
    for (const w of WEAPONS) for (const e of NEAR) observed[`${w}|${e}`] = rowOf(nearCell(w, e));
    expect(observed).toEqual({
      // R7 `MX-06` 的对应两列（本轮未改任何战斗参数 ⇒ 必须一字不差）
      'cannon|ProtoRusher': ['T', 'A', 'hp', 9, 1080, 129, 960, 859.2, 0],
      'cannon|Chaser': ['T', 'A', 'hp', 8, 960, 132, 960, 189.9, 0],
      'flamethrower|ProtoRusher': ['T', 'A', 'hp', 125, 1000, 110, 1000, 919.6, 0],
      'flamethrower|Chaser': ['T', 'A', 'hp', 113, 904, 114, 904, 552.4, 0],
      'hammer|ProtoRusher': ['T', 'A', 'hp', 12, 1080, 152, 450, 414.2, 0],
      'hammer|Chaser': ['T', 'A', 'hp', 10, 900, 187, 720, 5.5, 0],
      'laser|ProtoRusher': ['T', 'B', 'hp', 5, 800, 94, 480, 0, 199.3],
      'laser|Chaser': ['T', 'B', 'hp', 4, 640, 94, 480, 0, 247.7],
      'machineGun|ProtoRusher': ['T', 'A', 'hp', 50, 1000, 42, 840, 979.5, 0],
      'machineGun|Chaser': ['T', 'A', 'hp', 45, 900, 43, 840, 278.3, 0],
      'rammer|ProtoRusher': ['T', 'B', 'hp', 11, 770, 139, 420, 0, 170.6],
      'rammer|Chaser': ['T', 'A', 'hp', 13, 910, 140, 560, 0, 0],
      'shotgun|ProtoRusher': ['T', 'A', 'hp', 38, 1140, 95, 990, 499.3, 0],
      'shotgun|Chaser': ['T', 'A', 'hp', 31, 930, 96, 930, 280.7, 0],
    });
  });

  /* ================================================================ BI-05 */
  it('BI-05 冻结台账：`RangedTurret` 主矩阵 19 格的真实读数（改任何战斗数值都会在这里炸出来）', () => {
    const observed: Record<string, CellRow> = {};
    for (const c of matrixCells()) observed[`${c.weapon}|${c.buildLabel}`] = rowOf(c);
    expect(observed).toEqual({
      // [terminal, winner, endReason, hits, damage, firstHitStep(-1=无), windowDamage, hpA, hpB]
      'cannon|zero': ['T', 'B', 'hp', 1, 120, 606, 0, 0, 980],

      'flamethrower|zero': ['T', 'B', 'hp', 66, 528, 171, 456, 0, 572],
      'flamethrower|damageUp': ['T', 'B', 'hp', 66, 660, 171, 570, 0, 440],
      'flamethrower|rateUp': ['T', 'B', 'hp', 67, 536, 190, 488, 0, 564],

      'hammer|zero': ['T', 'B', 'hp', 0, 0, -1, 0, 0, 1099.9],
      'hammer|damageUp': ['T', 'B', 'hp', 0, 0, -1, 0, 0, 1099.9],
      'hammer|rateUp': ['T', 'B', 'hp', 0, 0, -1, 0, 0, 1100],

      'laser|zero': ['T', 'B', 'hp', 4, 640, 97, 480, 0, 460],
      'laser|damageUp': ['T', 'B', 'hp', 4, 800, 97, 600, 0, 300],
      'laser|rateUp': ['T', 'B', 'hp', 4, 640, 97, 480, 0, 460],

      'machineGun|zero': ['T', 'B', 'hp', 47, 940, 48, 840, 0, 159.8],
      'machineGun|damageUp': ['T', 'A', 'hp', 44, 1100, 48, 1050, 80, 0],
      'machineGun|rateUp': ['T', 'A', 'hp', 55, 1100, 48, 980, 40, 0],

      'rammer|zero': ['T', 'B', 'hp', 0, 0, -1, 0, 0, 1100],
      'rammer|damageUp': ['T', 'B', 'hp', 0, 0, -1, 0, 0, 1100],
      'rammer|rateUp': ['T', 'B', 'hp', 2, 140, 230, 70, 0, 955.7],

      'shotgun|zero': ['T', 'B', 'hp', 20, 600, 175, 330, 0, 500],
      'shotgun|damageUp': ['T', 'B', 'hp', 20, 760, 175, 418, 0, 340],
      'shotgun|rateUp': ['T', 'B', 'hp', 22, 660, 147, 360, 0, 440],
    });

    // 矩阵形状 + 无一格拖延
    expect(Object.keys(observed).length).toBe(19);
    for (const row of Object.values(observed)) {
      expect(row[0], '不允许 STALL').toBe('T');
      expect(row[2], '全部靠真实伤害判死').toBe('hp');
    }
  });

  /* ================================================================ BI-06 */
  it('BI-06 本 Queue 的答案：结果形状矩阵 + 逐件影响分类（FLIP / CONTACT / OUTPUT / NONE / N-A）', () => {
    // ① 形状矩阵（Queue 要求的输出形状）
    const shape: Record<string, readonly string[]> = {};
    for (const w of WEAPONS) {
      shape[w] = MAIN_LABELS.map((l) =>
        legallySupports(w, l) ? outcomeCell(mainCell(w, l)) : 'N/A',
      );
    }
    expect(shape).toEqual({
      // [A Zero | B damageUp | C rateUp]
      cannon: ['LOSS', 'N/A', 'N/A'],
      flamethrower: ['LOSS', 'LOSS', 'LOSS'],
      hammer: ['LOSS·0hit', 'LOSS·0hit', 'LOSS·0hit'],
      laser: ['LOSS', 'LOSS', 'LOSS'],
      machineGun: ['LOSS', 'WIN', 'WIN'],
      rammer: ['LOSS·0hit', 'LOSS·0hit', 'LOSS'],
      shotgun: ['LOSS', 'LOSS', 'LOSS'],
    });

    // ② 逐件影响分类
    const impact: Record<string, ImpactClass> = {};
    for (const w of WEAPONS) impact[w] = classify(w);
    expect(impact).toEqual({
      cannon: 'N/A',
      flamethrower: 'OUTPUT',
      hammer: 'NONE',
      laser: 'OUTPUT',
      machineGun: 'FLIP',
      rammer: 'CONTACT',
      shotgun: 'OUTPUT',
    });

    // ③ **结果翻转的恰好 1 件** —— 这是本 Queue 最硬的一条结论
    const flipped = WEAPONS.filter((w) =>
      MAIN_LABELS.some((l) => l !== 'zero' && legallySupports(w, l) && mainCell(w, l).winner === 'A'),
    );
    expect(flipped, '结果被 Build 翻转的武器').toEqual(['machineGun']);

    // ④ Queue 举例 1：`machineGun` — Zero Build 敌剩 159.8 ⇒ Build 后 COMPLETE（两条路都成立）
    const mgZero = mainCell('machineGun', 'zero');
    expect(mgZero.winner).toBe('B');
    expect(r1(mgZero.hpB)).toBe(159.8);
    for (const l of ['damageUp', 'rateUp'] as const) {
      const c = mainCell('machineGun', l);
      expect(c.winner, `machineGun + ${l} 必须翻成 WIN`).toBe('A');
      expect(c.hpB, `machineGun + ${l} 必须把对手打完`).toBe(0);
      expect(c.hpA, `machineGun + ${l} 必须自己活下来（不是双亡）`).toBeGreaterThan(0);
      expect(c.damage, `machineGun + ${l} 总伤害须达对手上限`).toBeGreaterThanOrEqual(mgZero.hpBMax);
    }

    // ⑤ 其余 5 件「加 Build 也翻不过来」—— 如实记录差距（不做评级）
    for (const w of ['flamethrower', 'laser', 'shotgun'] as const) {
      const base = mainCell(w, 'zero');
      const best = mainCell(w, 'damageUp');
      expect(best.winner).toBe('B');
      expect(best.damage, `${w}：damageUp 必须真的提高总伤害`).toBeGreaterThan(base.damage);
      expect(best.hpB, `${w}：对手仍未被清空`).toBeGreaterThan(0);
    }
  });

  /* ================================================================ BI-07 */
  it('BI-07 因果链：数值**确实被改了**（可证）与「结果是否改变」是两件独立的事', () => {
    // ① hammer：B / C 两档的 overlay 数值都真实生效（逐项断言），但战场结果一字不变
    const hDmg = createRunRegistry(['damageUp'], true, 'hammer').functionals.get('run.mod.damageUp')!;
    const hRate = createRunRegistry(['rateUp'], true, 'hammer').functionals.get('run.mod.rateUp')!;
    expect(hDmg.behaviorParams!.baseDamage, 'damageUp 改了锤的伤害键').toBe(Math.round(90 * 1.25));
    expect(hRate.behaviorParams!.windupPauseSteps, 'rateUp 改了锤的前摇键').toBe(Math.round(20 * 0.75));
    expect(hRate.behaviorParams!.baseDamage, 'rateUp 不得改伤害').toBe(90);
    // behavior 任何情况下都不许被改写
    expect(hDmg.behavior).toBe(defOf('hammer').behavior);
    expect(hRate.behavior).toBe(defOf('hammer').behavior);
    // ⚠️ 数值确实变了两个键，但 `hammer` 三档**逐字段相同**（rateUp 只改轨迹，命中仍 0）
    expect(rowOf(mainCell('hammer', 'damageUp')), 'hammer：damageUp 对结果零影响').toEqual(
      rowOf(mainCell('hammer', 'zero')),
    );
    for (const l of MAIN_LABELS) {
      expect(mainCell('hammer', l).hits, `hammer + ${l}：仍一发都打不中`).toBe(0);
    }

    // ② rammer：damageUp 同样逐字段相同；rateUp 改了 `restSteps` 且**第一次打到了**
    const rRate = createRunRegistry(['rateUp'], true, 'rammer').functionals.get('run.mod.rateUp')!;
    expect(rRate.behaviorParams!.restSteps, 'rateUp 改了冲锤的接触节奏键').toBe(Math.round(24 * 0.75));
    expect(rowOf(mainCell('rammer', 'damageUp')), 'rammer：damageUp 对结果零影响').toEqual(
      rowOf(mainCell('rammer', 'zero')),
    );
    expect(mainCell('rammer', 'zero').hits).toBe(0);
    expect(mainCell('rammer', 'rateUp').hits, 'rammer：rateUp 让它第一次打中').toBeGreaterThan(0);

    // ③ 每个「合法支持」的档都**确实**改了它自己那个键（逐件对拍 canonical ⇒ 不是空操作）
    for (const w of WEAPONS) {
      if (w === RUN_BASE_WEAPON_DEF_ID) continue;
      const dKey = weaponDamageParamKey(defOf(w))!;
      const cKey = weaponCadenceGrowth(defOf(w))!.key;
      const canonical = defOf(w).behaviorParams!;
      const dmg = createRunRegistry(['damageUp'], true, w).functionals.get('run.mod.damageUp')!;
      const rate = createRunRegistry(['rateUp'], true, w).functionals.get('run.mod.rateUp')!;
      expect(dmg.behaviorParams![dKey], `${w}: damageUp 未生效`).toBe(
        Math.round((canonical[dKey] as number) * 1.25),
      );
      expect(dmg.behaviorParams![cKey] ?? canonical[cKey], `${w}: damageUp 不得碰节奏键`).toBe(
        canonical[cKey],
      );
      const rateBase = (canonical[cKey] ?? 20) as number;
      expect(rate.behaviorParams![cKey], `${w}: rateUp 未生效`).toBe(
        Math.max(1, Math.round(rateBase * 0.75)),
      );
      expect(rate.behaviorParams![dKey], `${w}: rateUp 不得碰伤害键`).toBe(canonical[dKey]);
    }
  });

  /* ================================================================ BI-08 */
  it('BI-08 附加行（**不属于**主矩阵）：cannon 用它**自己**的第一层官方项对照', () => {
    const observed: Record<string, CellRow> = {};
    for (const c of cannonAuxCells()) observed[`${c.weapon}|${c.buildLabel}`] = rowOf(c);
    expect(observed).toEqual({
      'cannon|cannon+heavyShell': ['T', 'B', 'hp', 2, 240, 611, 0, 0, 860],
      'cannon|cannon+fastReload': ['T', 'B', 'hp', 2, 240, 594, 120, 0, 860],
    });

    // ① 这两项都是**既有官方内容**，且**确实改了各自声明的键**
    const heavy = createRunRegistry(['heavyShell'], true, RUN_BASE_WEAPON_DEF_ID)
      .functionals.get('run.mod.@base+heavyShell')!;
    const fast = createRunRegistry(['fastReload'], true, RUN_BASE_WEAPON_DEF_ID)
      .functionals.get('run.mod.@base+fastReload')!;
    expect(heavy.behaviorParams!.projectileRadius, '重弹头改的是半径/质量/后坐').toBe(16);
    expect(heavy.behaviorParams!.projectileDamage, '重弹头**不改**伤害键').toBe(120);
    expect(fast.behaviorParams!.cooldownMs, '快速装填把 1000 压到 650').toBe(650);
    expect(fast.behaviorParams!.projectileDamage, '快速装填**不改**伤害键').toBe(120);

    // ② 效果：两者都让 cannon 从 1 次命中抬到 2 次 —— 但仍 LOSS（如实记录）
    const base = mainCell('cannon', 'zero');
    expect(base.hits).toBe(1);
    for (const c of cannonAuxCells()) {
      expect(c.hits, `${c.buildLabel}：命中数翻倍`).toBe(2);
      expect(c.damage).toBe(240);
      expect(c.winner, `${c.buildLabel}：仍不足以翻盘`).toBe('B');
    }
    // ③ `fastReload` 的节奏效果表现为**更早首发**（594 < 606），方向与 `rateUp` 一致
    expect(cannonAuxCell('fastReload', 'cannon+fastReload').firstHitStep!).toBeLessThan(
      base.firstHitStep!,
    );
  });

  /* ================================================================ BI-09 */
  it('BI-09 `rammer` 新发现复查：加 `rateUp` 后它**真的打到了**（确定性 + 因果一致）', () => {
    const zero = mainCell('rammer', 'zero');
    const fast = mainCell('rammer', 'rateUp');
    // ① 确定性：同一格重新跑一次逐字段一致（排除偶发）
    const again = fight('rammer', 'rateUp', BUILD_OF.rateUp, FOCUS);
    expect({ ...again, build: [...again.build] }).toEqual({ ...fast, build: [...fast.build] });
    // ② 因果一致：节奏键确实被改了（BI-07 已钉 24→18），本处只钉「结果随之一变」
    expect(zero.hits).toBe(0);
    expect(fast.hits).toBe(2);
    expect(fast.damage).toBe(140);
    expect(fast.firstHitStep, 'rateUp 下首次命中发生在战斗中段').toBe(230);
    // ③ 外显度量的同向变化（⚠️ 只作观测值，不作接触判据 —— 见文件头告示）
    expect(zero.minGap, 'rammer 零 Build：外显外框全程未贴到').toBeGreaterThan(0);
    expect(fast.minGap, 'rammer + rateUp：外显外框曾重叠').toBeLessThan(0);
    // ④ 但它仍然落败 ⇒ 「够不着」被解除，不等于「打得过」
    expect(fast.winner).toBe('B');
    expect(fast.hpB, '对手仍剩大部分血').toBeGreaterThan(900);
  });

  /* ================================================================ BI-99 */
  it('BI-99 本文件是**纯取证**：import 闭集，且不含任何写数值语句', () => {
    const src = readFileSync(join(__dirname, 'productRunBuildEncounterImpactR8.test.ts'), 'utf8');
    const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const paths = [...noComments.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    expect([...paths].sort()).toEqual(
      [
        'node:fs',
        'node:path',
        'vitest',
        '../src/battle/arenaConfig',
        '../src/core/content',
        '../src/core/types',
        '../src/lab/buildEditorModel',
        '../src/lab/portraitBattleLab/runBattleRuntime',
        '../src/lab/portraitBattleLab/runModifiers',
        '../src/lab/portraitBattleLab/runPageState',
        '../src/lab/portraitBattleLab/runPageScene',
        '../src/product/runCompatibility',
        '../src/product/playerLoadout',
      ].sort(),
    );
    for (const forbidden of ['planckBattleOrchestrator', 'enemyDrive', 'planckWorld']) {
      expect(paths.some((p) => p.includes(forbidden)), `不得 import ${forbidden}`).toBe(false);
    }
    const WRITE_TOKENS = ['.' + 'hp = ', '.' + 'maxHp = ', 'apply' + 'LinearImpulse'];
    for (const token of WRITE_TOKENS) {
      expect(noComments.includes(token), `取证文件不得出现 ${token}`).toBe(false);
    }
  });
});
