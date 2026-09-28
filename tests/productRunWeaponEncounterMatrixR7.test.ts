/**
 * PRODUCT-LOOP-R7-WEAPON-ENCOUNTER-MATRIX｜**7 Full Run Weapon × 3 Encounter** 确定性取证矩阵。
 *
 * ── 本 Queue 只做一件事：把「谁对谁能打出什么结果」变成机器可复现的实测事实 ─────────
 *
 * 它**不修改任何战斗参数**（World / Enemy / AI / Weapon / Body / Physics / 数值全部冻结），
 * 也**不把结果写成新的游戏规则** —— 冻结的是**观测值**，不是判据：
 *
 *   - 本文件**不**做武器排名 / 强弱评级；
 *   - 本文件**不**自动调参、**不**为了让测试全绿降低敌人、**不**替换 `RangedTurret`、
 *     **不**改 E2E 配装绕过问题；
 *   - 单元格里的数是「这一次真实物理跑出来的」，不是评分。
 *
 * ── 为什么值得单独测：把「三段链」与「单场能力」拆开 ─────────────────────────
 *
 * `Q3-07`（`tests/productRunEncounterSequenceQ3.test.ts`）记录的是一整条**三段链**的终局
 * （`FAILED@Z`）。那里面混着**跨段耐久累积**：一件武器在第 1 段被打掉 60% 耐久后，
 * 第 3 段的表现已经不是「它面对 `RangedTurret` 的能力」，而是「它带着伤面对 `RangedTurret`」。
 *
 * 本文件每一格 = **一场独立战斗**（满耐久开局 / 零 Build / 只装这一件），
 * 于是可以回答 Q3 那张表**结构上回答不了**的问题：
 *   「这件武器**单独**面对这个 Encounter 时，到底能不能处理它？」
 * 这正是 Queue 对 `RangedTurret` 的追问：**是不是所有 Weapon 都失败，还是只有某些配置
 * 无法处理控距**。⇒ 「单场隔离」与「三段链」是两个不同的问题，本文件只回答前者。
 *
 * ── 取证协议（全部为**观测口径**，不是游戏规则）─────────────────────────────
 *
 *   | 维度 | 取值 | 理由 |
 *   |---|---|---|
 *   | 玩家装配 | `onlyDraft(weapon)`：清空 4 个功能槽，只在**产品主武器槽**（`WEAPON_SLOT` = `frontMass`）留这一件 | **归因夹具** —— 伤害只能来自它，排除第二件武器的混淆 |
 *   | 玩家基线 | `playerBaseline: true` | 与 `runPage.beginBattle()` **同口径**（产品真实路径） |
 *   | 本局 Build | `[]`（**零 Build**） | 本矩阵问的是「武器 × 对手」，不是「构筑 × 对手」（R7 通用成长由 GR 组单独钉） |
 *   | 起始耐久 | `carriedHp: null`（满耐久） | 隔离「跨段耐久累积」这一混杂因子 |
 *   | 世界 | 构造**不传 config** | 即正式 `DEFAULT_ARENA_CONFIG`（1600×900 / groundY 700 / 出生距 800） |
 *   | 时间步 | `1000/60` ms（= `FIXED_STEP_MS`） | 与 `productRunEncounterSequenceQ3` / `productRunWeaponRuntimeBatchR7` 同源 |
 *   | 固定窗口 | **前 600 步 = 10 s** = `DEFAULT_ARENA_CONFIG.phases.activeMs` | 窗口**锚在既有常量上**（不是自造数字）：竞技场 Active 阶段长度 |
 *   | 终止上限 | `MAX_FRAMES = 4000` | 安全上限；竞技场结构上 Active 10 s + Warning 3 s + Closing 5 s ⇒ 约 1080 步必进 `End` |
 *
 * ⚠️ **复现性已实测**：同参数连跑两次，21 格逐字段（含浮点耐久）**逐字节一致**。
 *
 * ── 七个问题 → 七个字段（每格都记）──────────────────────────────────────────
 *
 *   | Queue 的问题 | 本文件的字段 | 判据 |
 *   |---|---|---|
 *   | 是否能造成有效伤害 | `damage` / `hits` / `perPart` | `hits > 0 && damage > 0` |
 *   | 首次有效命中时间 | `firstHitStep` / `firstHitMs` | 步号（主）+ 事件自带 `atMs`（辅；`MX-05` 互校） |
 *   | 固定窗口内累计伤害 | `windowDamage` | 第 600 步（= Active 阶段末）时的累计玩家武器伤害 |
 *   | 玩家剩余耐久 | `hpA` | 终态读数 |
 *   | Encounter 最终结果 | `winner` / `endReason` | `'A'`/`'B'` + `'hp'`（打死了）/`'arenaEnd'`（进 End 比 HP） |
 *   | 是否出现 0 命中 | `hits === 0` | 逐格显式统计（`MX-08`） |
 *   | 是否出现稳定无解 / 无限拖延 | `terminal` | `false` = 4000 步内没进终态 |
 *
 * ⚠️ 「无限拖延」在本项目里**结构上不可能以「永不结束」的形式出现**：
 *    `BattleResult.winner` 恒为 `'A' | 'B'`（`battleContract.ts:96` 明确「不再有 draw/null」），
 *    竞技场进入 `End` 后**强制**比剩余 HP 判胜（`endReason='arenaEnd'`）。
 *    ⇒ 真正需要观测的「无解」形态是：**玩家一发都打不出（`hits === 0`）**。
 *
 * ── 实测结论（本 Queue 的答案；数字见 `MX-06` / `MX-07` / `MX-08`）────────────
 *
 * **21 格全部进入正式终态**（无拖延、无 `arenaEnd`）—— `endReason` 全部为 `'hp'`。
 *
 * `RangedTurret` 列 = **7/7 全部落败**。但「为什么输」分成**三组**（这是 Queue 要的设计方向输入）：
 *
 *   | 组 | 武器 | 实测事实 | 问题的性质 |
 *   |---|---|---|---|
 *   | ① 0 命中，且 L2 外显也未贴到 | `rammer` | `minGap = +7 > 0`，全程外显外框都没碰上 | **真·够不着**：控距（`near 240 / far 480`，后撤 2.6 px/step > 玩家推进 ~1.5）把它挡在接触之外 |
 *   | ② 0 命中，但 L2 外显曾重叠 | `hammer` | `minGap = −23`（**外显外框在 X 上叠了 23px**）、接触残留含 `impact`，武器命中仍 0 | ⚠️ **已定性（见下）**：锤头**从未与敌车发生物理接触**；`−23` 是 **L2 度量假象**，那条 `impact` 是**玩家车体 × 敌方外伸炮管** |
 *   | ③ 有伤害但打不过 | `cannon`(1 命中/120) · `flamethrower`(66/528) · `laser`(4/640) · `machineGun`(47/940) · `shotgun`(20/600) | 都打出真实伤害，都被反杀 | **交换比**：够得着，打不赢（最接近的 `machineGun` 让对手剩 159.8） |
 *
 * ⇒ 回答「是不是所有 Weapon 都失败」：**是** —— 零 Build 单件下 **7/7 落败**。
 *   回答「还是只有某些配置无法处理控距」：**接触族 2 件（`rammer` / `hammer`）**在这一列拿不到
 *   任何伤害；其余 **5 件能打到**（有真实伤害），只是打不过。
 *
 * ⚠️⚠️ **本文件曾把 ② 组读成「接触了却没登记命中」—— 那是错的。** 更正来自
 *   `PRODUCT-LOOP-P0-HAMMER-RANGED-TURRET-HIT-REGISTRATION`，口径如下：
 *
 *   `minGap` 由 `rt.gapWorld()` 给出 = `b.minX − a.maxX`，作用在 `vehicleWorldBox()` 上，
 *   而那个盒子**含 `visual` 贴图外框**（`runBattleRuntime.ts:282-297` 明确 `accShape` + `accVisual`）。
 *   ⇒ **贴图外框的 X 投影重叠 ≠ 物理接触。** 本文件因此**不再**用 `minGap` 作「是否接触」的判据，
 *     只把它当**外显度量的观测值**（负值 = 外框在 X 上重叠）。
 *
 *   真实接触判据 = **引擎自身的 contact 事件流**（权威）。同参数实测（`hammer@frontMass`）：
 *
 *   | vs `RangedTurret`（真实出生几何） | 读数 |
 *   |---|---|
 *   | 车辆↔车辆接触（`begin`） | **1 条**：`s718 A/body ↔ B/part:front rel=1.33`（**玩家车体 × 敌方炮管**） |
 *   | 锤头（`A/part:frontMass`）接触 | **0**（全程零接触；与敌各 collider 最近 SAT 间距 9.6px） |
 *   | 武器命中 | **0**（`baseDamage=90` / `WEAPON_CONTACT_THRESHOLD=0.5` 两道闸门从未被触及） |
 *
 *   ⇒ ② 组的性质 = **锤头没碰到**（与 ① 同类），**不是**「碰到了却没登记」。命中链无缺陷：
 *     hammer 对 `Chaser` / `ProtoRusher` 的 11 / 16 次锤头真实接触里，`rel ≥ 0.5` 的 **10 / 12** 次
 *     全部按正式规则登记 `90`，未登记的那几次全部 `rel < 0.5`（按设计正确）。
 *     ⇒ **这两件都不是命中登记缺陷，不得靠加范围 / 加伤害去「修」。**
 *     完整取证（含受控几何下的验收）→ `tests/productHammerHitRegistrationP0.test.ts`（PH-01…PH-05）。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEFAULT_ARENA_CONFIG } from '../src/battle/arenaConfig';
import { registry } from '../src/core/content';
import { EMPTY_SLOT, type BuildDraft } from '../src/lab/buildEditorModel';
import { RunBattleRuntime } from '../src/lab/portraitBattleLab/runBattleRuntime';
import { LAB_ENCOUNTERS } from '../src/lab/portraitBattleLab/testData';
import { OPPONENT_TEMPLATES } from '../src/player/opponentPool';
import { defaultPlayerDraft, WEAPON_SLOT } from '../src/product/playerLoadout';
import { FULL_RUN_SUPPORTED_WEAPON_IDS } from '../src/product/runCompatibility';

/* ------------------------------------------------------------- 取证常量 */

/** 与 `productRunEncounterSequenceQ3` / `productRunWeaponRuntimeBatchR7` 同源的时间步。 */
const FRAME_MS = 1000 / 60;
/** 安全上限（竞技场结构上约 1080 步必进 `End`）。 */
const MAX_FRAMES = 4000;
/** 固定窗口步数 = 竞技场 Active 阶段长度 / 帧长（**从既有常量派生**，不自造数字）。 */
const WINDOW_FRAMES = Math.round(DEFAULT_ARENA_CONFIG.phases.activeMs / FRAME_MS);

/** 7 件 Full Run Weapon（**从真源现读**，不写死，避免与登记表漂移）。 */
const WEAPONS: readonly string[] = FULL_RUN_SUPPORTED_WEAPON_IDS;
/** 三段问题序列的三个 Encounter（顺序 = `runScript.ts` 里的出现顺序）。 */
const ENCOUNTERS = ['ProtoRusher', 'Chaser', 'RangedTurret'] as const;

const PRODUCT_TAG = 'profile-equipped';

/* --------------------------------------------------------------- 夹具 */

/**
 * **归因夹具**：清空四个功能槽，只在**产品主武器槽**（`WEAPON_SLOT` = `frontMass`）留这一件。
 *
 * ⚠️ `slot` 声明为 `string` 是为了避开 TS1117：`WEAPON_SLOT` 的字面量值就是 `'frontMass'`，
 *    与上面那个显式键**同名**，写成字面量收窄会直接报重复键（既有测试同款规避）。
 */
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

/* ----------------------------------------------------------- 单格取证 */

interface PartTally {
  readonly count: number;
  readonly damage: number;
}

interface Cell {
  /** 本格标签（矩阵格 = 武器 id；附加行 = `'default-car'`）。 */
  readonly label: string;
  readonly encounter: string;
  /** 到达终态（或撞上限）时的固定步数。 */
  readonly steps: number;
  /** `true` = 进了正式终态；`false` = 4000 步内没结束（= 「无限拖延」的机器判据）。 */
  readonly terminal: boolean;
  readonly winner: 'A' | 'B' | null;
  readonly endReason: string | null;
  /** 开局 / 终态耐久。 */
  readonly hpA0: number;
  readonly hpA: number;
  readonly hpAMax: number;
  readonly hpB0: number;
  readonly hpB: number;
  readonly hpBMax: number;
  /** 玩家武器**真实**命中（`damage` 事件；归因夹具 ⇒ 只可能来自那一件）。 */
  readonly hits: number;
  readonly damage: number;
  /** 逐**来源部件**的命中 / 伤害（矩阵格里必须只有一个键）。 */
  readonly perPart: Readonly<Record<string, PartTally>>;
  readonly firstHitMs: number | null;
  readonly firstHitStep: number | null;
  /** **固定窗口**（前 600 步 = 10 s）内的累计伤害 / 命中。 */
  readonly windowDamage: number;
  readonly windowHits: number;
  /** 战斗是否活过了整个窗口（`false` ⇒ 窗口值 = 全场值，如实披露）。 */
  readonly windowSurvived: boolean;
  /** 本场玩家**实际装出来的武器**（`挂点:defId`，证明归因夹具成立）。 */
  readonly slots: readonly string[];
  /**
   * 全程两车 `vehicleWorldBox()` 的 X 投影间距**最小值**。
   *
   * ⚠️ 这是 **L2 外显度量**，**不是**接触判据：
   *    `vehicleWorldBox` **含 `visual` 贴图外框**（`runBattleRuntime.ts:282-297`），
   *    所以「负值」= **贴图外框在 X 上重叠**，与「两个 collider 是否接触」是两件事。
   *    要判「有没有真接触」必须读**引擎 contact 事件流** →
   *    `tests/productHammerHitRegistrationP0.test.ts`（PH-01 起）。
   */
  readonly minGap: number;
  /** 第 `WINDOW_FRAMES` 步时的间距（`null` = 没活到窗口）。 */
  readonly gapAtWindow: number | null;
  /** 终态时两车外廓间距。 */
  readonly finalGap: number;
  /** 是否观察到玩家侧存活弹丸（entity → attack 的机器证据）。 */
  readonly sawProjectile: boolean;
  /** 本场世界读数（必须是正式默认世界）。 */
  readonly arenaW: number;
  readonly arenaH: number;
  readonly groundY: number;
}

/** 读取「玩家全部武器真实命中」的聚合（归因夹具下 = 那一件的战绩）。 */
function totalsOf(rt: RunBattleRuntime): {
  hits: number;
  damage: number;
  firstMs: number | null;
  perPart: Record<string, PartTally>;
} {
  let hits = 0;
  let damage = 0;
  let firstMs: number | null = null;
  const perPart: Record<string, PartTally> = {};
  for (const [partId, read] of Object.entries(rt.playerWeaponHitSummary())) {
    const dmg = read.damages.reduce((a, b) => a + b, 0);
    hits += read.count;
    damage += dmg;
    perPart[partId] = { count: read.count, damage: dmg };
    if (firstMs === null || read.firstAtMs < firstMs) firstMs = read.firstAtMs;
  }
  return { hits, damage, firstMs, perPart };
}

/**
 * 跑**一场**独立战斗（满耐久 / 零 Build），逐帧推进到终态或上限。
 *
 * ⚠️ 窗口读数在**第 `WINDOW_FRAMES` 步**那一帧捕获：`playerWeaponHitSummary()` 只给
 *    「累计」与「首发时刻」，不保留逐发时间戳 ⇒ 要拿「窗口内累计」就必须在窗口边界取一次。
 */
function fight(draft: BuildDraft, encounterId: string, label: string): Cell {
  const rt = new RunBattleRuntime({
    build: [],
    carriedHp: null,
    encounterId,
    playerDraft: draft,
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
      // 首次有效命中的**步号**（出现即停止轮询，保持低开销）
      if (firstHitStep === null && totalsOf(rt).hits > 0) firstHitStep = steps;
      // 固定窗口边界（只取一次）
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
      // 战斗在窗口走完前就终结 ⇒ 窗口值 = 全场值（如实披露，不假装窗口内还有增量）
      windowDamage = t.damage;
      windowHits = t.hits;
    }
    const hp = rt.hp();
    return {
      label,
      encounter: encounterId,
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

/** 21 格 + 3 附加行都只跑一次（多个 `it` 复用同一份实测结果）。 */
const CACHE = new Map<string, Cell>();

function cell(weapon: string, encounter: string): Cell {
  const key = `${weapon}|${encounter}`;
  let hit = CACHE.get(key);
  if (!hit) {
    hit = fight(onlyDraft(weapon), encounter, weapon);
    CACHE.set(key, hit);
  }
  return hit;
}

/** **附加行**（不属于 7×3 矩阵）：产品**默认车**面对同一批 Encounter 的真实结果。 */
function auxCell(encounter: string): Cell {
  const key = `default-car|${encounter}`;
  let hit = CACHE.get(key);
  if (!hit) {
    hit = fight(defaultPlayerDraft(), encounter, 'default-car');
    CACHE.set(key, hit);
  }
  return hit;
}

function allCells(): readonly Cell[] {
  const out: Cell[] = [];
  for (const w of WEAPONS) for (const e of ENCOUNTERS) out.push(cell(w, e));
  return out;
}

/** 报告精度：耐久保留 1 位小数（1/1100 的分辨率足以暴露任何有意义的改动）。 */
function r1(x: number): number {
  return Math.round(x * 10) / 10;
}

/** 冻结矩阵的一行（观测值；`firstStep = -1` = 该场无命中 ⇒ 无首发步号）。 */
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

function ledger(): Record<string, CellRow> {
  const out: Record<string, CellRow> = {};
  for (const c of allCells()) {
    out[`${c.label}|${c.encounter}`] = [
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
  return out;
}

/** 人类的矩阵单元格（`Weapon | ProtoRusher | Chaser | RangedTurret` 用）。 */
function outcomeCell(c: Cell): string {
  if (!c.terminal) return 'STALL';
  const zero = c.hits === 0;
  const mutual = c.hpA <= 0 && c.hpB <= 0;
  if (c.winner === 'A') return zero ? 'WIN·0hit' : mutual ? 'WIN·双亡' : 'WIN';
  return zero ? 'LOSS·0hit' : 'LOSS';
}

/* ---------------------------------------------------------------- 用例 */

describe('PRODUCT-LOOP-R7｜Weapon × Encounter 确定性矩阵（7 × 3 单场隔离）', () => {
  it('MX-01 取证常量：窗口锚在既有 Active 阶段常量上；21 格全部跑进正式终态（无「无限拖延」）', () => {
    // ① 窗口来自既有常量（不是自造数字）
    expect(WINDOW_FRAMES).toBe(600);
    expect(DEFAULT_ARENA_CONFIG.phases.activeMs).toBe(10_000);
    // ② 矩阵形状 = 7 × 3，武器 / 对手都不重复
    expect(WEAPONS.length).toBe(7);
    expect(ENCOUNTERS.length).toBe(3);
    expect(new Set(WEAPONS).size).toBe(7);
    expect(new Set(ENCOUNTERS).size).toBe(3);
    // ③ 每格都在上限内进入**正式终态**
    for (const c of allCells()) {
      const tag = `${c.label} vs ${c.encounter}`;
      expect(c.terminal, `${tag}：${MAX_FRAMES} 步内未进终态（无限拖延）`).toBe(true);
      expect(c.winner, `${tag}：终态必须有胜者`).toMatch(/^[AB]$/);
      expect(c.endReason, `${tag}：结束原因`).toMatch(/^(hp|arenaEnd)$/);
    }
  });

  it('MX-02 单场隔离成立：满耐久开局 + 世界是**正式默认**（未改任何战斗参数）', () => {
    for (const c of [...allCells(), ...ENCOUNTERS.map(auxCell)]) {
      const tag = `${c.label} vs ${c.encounter}`;
      // ① 独立战斗：开局双方满血 / 满耐久（无跨场残留）
      expect(c.hpB0, `${tag}：对手必须满血开局`).toBe(c.hpBMax);
      expect(c.hpA0, `${tag}：玩家必须满耐久开局`).toBe(c.hpAMax);
      // ② 世界 = 正式默认（构造不传 config ⇒ 逐字段等于 DEFAULT_ARENA_CONFIG）
      expect(c.arenaW, `${tag}: arena width`).toBe(DEFAULT_ARENA_CONFIG.width);
      expect(c.arenaH, `${tag}: arena height`).toBe(DEFAULT_ARENA_CONFIG.height);
      expect(c.groundY, `${tag}: groundY`).toBe(DEFAULT_ARENA_CONFIG.groundY);
      // ③ 开局**必然**活过多步（没有「一开场就结束」的退化格）
      expect(c.steps, `${tag}：必须有真实战斗步数`).toBeGreaterThan(1);
    }
  });

  it('MX-03 归因夹具成立：矩阵每格车上**只有这一件**武器，且命中只来自它', () => {
    for (const w of WEAPONS) {
      for (const e of ENCOUNTERS) {
        const c = cell(w, e);
        expect(c.slots, `${w} vs ${e}：车上只能有这一件武器`).toEqual([`${WEAPON_SLOT}:${w}`]);
        // 命中归因：逐部件明细里**最多一个**键，且必须是它自己
        const parts = Object.keys(c.perPart);
        expect(parts.length, `${w} vs ${e}：命中来源部件数`).toBeLessThanOrEqual(1);
        if (parts.length === 1) expect(parts[0], `${w} vs ${e}：命中来源`).toBe(w);
      }
    }
    // 附加行 = 真实默认车（不是归因夹具）⇒ 它的槽位内容如实报告，不假设
    const def = auxCell('ProtoRusher');
    expect(def.slots.length, '产品默认车至少有一件武器').toBeGreaterThan(0);
    expect(def.slots, '产品默认车主武器槽 = cannon').toContain(`${WEAPON_SLOT}:cannon`);
  });

  it('MX-04 行为归属：每格武器跑的仍是**它自己的** behavior（不出现「hammer 变成 cannon」）', () => {
    for (const w of WEAPONS) {
      const canonical = registry.functionals.get(w)!;
      expect(canonical.behavior, `${w} 必须有 canonical behavior`).toBeTruthy();
      for (const e of ENCOUNTERS) {
        const c = cell(w, e);
        // 归因夹具下 defId 就是它自己（未被改写成本局 overlay 的别的 id）
        expect(c.slots, `${w} vs ${e}：defId 必须仍是它自己`).toEqual([`${WEAPON_SLOT}:${w}`]);
      }
    }
    // 7 件的 behavior 两两不同 ⇒ 矩阵不是「同一件武器打三遍」
    const behaviors = WEAPONS.map((w) => registry.functionals.get(w)!.behavior);
    expect(new Set(behaviors).size, '7 件的 behavior 必须两两不同').toBe(7);
  });

  it('MX-05 有效伤害 + 首发时间：近身两段 7/7 都命中；步号口径与事件 `atMs` 口径互相校验', () => {
    for (const w of WEAPONS) {
      for (const e of ['ProtoRusher', 'Chaser'] as const) {
        const c = cell(w, e);
        expect(c.hits, `${w} vs ${e}：必须有真实命中`).toBeGreaterThan(0);
        expect(c.damage, `${w} vs ${e}：必须有真实伤害`).toBeGreaterThan(0);
        expect(c.firstHitStep, `${w} vs ${e}：必须能测到首次命中步号`).not.toBeNull();
      }
    }
    // 两条独立口径读同一份物理事实 ⇒ 允许 1 步的步内采样边界差
    for (const c of allCells()) {
      const tag = `${c.label} vs ${c.encounter}`;
      if (c.firstHitStep === null) {
        expect(c.firstHitMs, `${tag}：0 命中时不得有首发时刻`).toBeNull();
        continue;
      }
      expect(c.firstHitMs, `${tag}：有命中必须有首发时刻`).not.toBeNull();
      const stepFromMs = Math.round(c.firstHitMs! / FRAME_MS);
      expect(
        Math.abs(stepFromMs - c.firstHitStep!),
        `${tag}：步号 ${c.firstHitStep} vs atMs→步 ${stepFromMs}`,
      ).toBeLessThanOrEqual(1);
    }
  });

  it('MX-06 冻结矩阵：21 格的真实结果（改任何战斗参数都会在这里炸出来）', () => {
    expect(ledger()).toEqual({
      // [terminal, winner, endReason, hits, damage, firstHitStep(-1=无), windowDamage, hpA, hpB]
      'cannon|ProtoRusher': ['T', 'A', 'hp', 9, 1080, 129, 960, 859.2, 0],
      'cannon|Chaser': ['T', 'A', 'hp', 8, 960, 132, 960, 189.9, 0],
      'cannon|RangedTurret': ['T', 'B', 'hp', 1, 120, 606, 0, 0, 980],

      'flamethrower|ProtoRusher': ['T', 'A', 'hp', 125, 1000, 110, 1000, 919.6, 0],
      'flamethrower|Chaser': ['T', 'A', 'hp', 113, 904, 114, 904, 552.4, 0],
      'flamethrower|RangedTurret': ['T', 'B', 'hp', 66, 528, 171, 456, 0, 572],

      'hammer|ProtoRusher': ['T', 'A', 'hp', 12, 1080, 152, 450, 414.2, 0],
      'hammer|Chaser': ['T', 'A', 'hp', 10, 900, 187, 720, 5.5, 0],
      'hammer|RangedTurret': ['T', 'B', 'hp', 0, 0, -1, 0, 0, 1099.9],

      'laser|ProtoRusher': ['T', 'B', 'hp', 5, 800, 94, 480, 0, 199.3],
      'laser|Chaser': ['T', 'B', 'hp', 4, 640, 94, 480, 0, 247.7],
      'laser|RangedTurret': ['T', 'B', 'hp', 4, 640, 97, 480, 0, 460],

      'machineGun|ProtoRusher': ['T', 'A', 'hp', 50, 1000, 42, 840, 979.5, 0],
      'machineGun|Chaser': ['T', 'A', 'hp', 45, 900, 43, 840, 278.3, 0],
      'machineGun|RangedTurret': ['T', 'B', 'hp', 47, 940, 48, 840, 0, 159.8],

      'rammer|ProtoRusher': ['T', 'B', 'hp', 11, 770, 139, 420, 0, 170.6],
      // 同归于尽（双方归零）⇒ 正式 tiebreak 判 A（如实记录，不是「赢」的通词）
      'rammer|Chaser': ['T', 'A', 'hp', 13, 910, 140, 560, 0, 0],
      'rammer|RangedTurret': ['T', 'B', 'hp', 0, 0, -1, 0, 0, 1100],

      'shotgun|ProtoRusher': ['T', 'A', 'hp', 38, 1140, 95, 990, 499.3, 0],
      'shotgun|Chaser': ['T', 'A', 'hp', 31, 930, 96, 930, 280.7, 0],
      'shotgun|RangedTurret': ['T', 'B', 'hp', 20, 600, 175, 330, 0, 500],
    });
  });

  it('MX-07 矩阵（Queue 要求的输出形状）：Weapon | ProtoRusher | Chaser | RangedTurret', () => {
    const matrix: Record<string, readonly string[]> = {};
    for (const w of WEAPONS) matrix[w] = ENCOUNTERS.map((e) => outcomeCell(cell(w, e)));
    expect(matrix).toEqual({
      cannon: ['WIN', 'WIN', 'LOSS'],
      flamethrower: ['WIN', 'WIN', 'LOSS'],
      hammer: ['WIN', 'WIN', 'LOSS·0hit'],
      laser: ['LOSS', 'LOSS', 'LOSS'],
      machineGun: ['WIN', 'WIN', 'LOSS'],
      rammer: ['LOSS', 'WIN·双亡', 'LOSS·0hit'],
      shotgun: ['WIN', 'WIN', 'LOSS'],
    });
    // ① 没有任何一格是「无限拖延」
    for (const w of WEAPONS) for (const text of matrix[w]) expect(text).not.toBe('STALL');
    // ② `RangedTurret` 列 = 全列落败（这是本 Queue 要回答的核心事实）
    for (const w of WEAPONS) expect(matrix[w][2], `${w} 在 RangedTurret 上必须落败`).toContain('LOSS');
  });

  it('MX-08 RangedTurret 专项：7/7 单件全败；「0 命中」只有 2 件，且二者**机制不同**', () => {
    const col = WEAPONS.map((w) => cell(w, 'RangedTurret'));

    // ① 全部落败（零 Build 单件下 7/7 都输）
    for (const c of col) {
      expect(c.winner, `${c.label} vs RangedTurret：单件下必须落败`).toBe('B');
      expect(c.endReason, `${c.label}：靠真实伤害判死，不是 arenaEnd`).toBe('hp');
      expect(c.hpA, `${c.label}：玩家耐久归零`).toBe(0);
    }

    // ② 0 命中 = 恰好 2 件（接触族），且都拿不到任何伤害、对手基本满血
    const zeroHit = col.filter((c) => c.hits === 0);
    expect(zeroHit.map((c) => c.label), '0 命中的那一族').toEqual(['hammer', 'rammer']);
    for (const c of zeroHit) {
      expect(c.damage, `${c.label}：0 命中 ⇒ 0 伤害`).toBe(0);
      expect(Object.keys(c.perPart), `${c.label}：0 命中 ⇒ 无来源部件`).toEqual([]);
      expect(c.hpB, `${c.label}：对手基本满血`).toBeGreaterThan(c.hpBMax - 1);
    }

    // ③ ⚠️ 两件在 **L2 外显度量**上确实不同 —— 但**都**不是「命中了却没登记」：
    //    `rammer`：`minGap = +7 > 0` ⇒ 外显外框全程没贴到（控距真把它挡在接触之外）；
    //    `hammer`：`minGap = −23 < 0` ⇒ **只是外显外框在 X 上叠了 23px**（`vehicleWorldBox`
    //              含 `visual` 贴图外框，见 `Cell.minGap` 文档）。真实读数是 **锤头零接触**，
    //              那唯一一条 `impact` 是 `A/body ↔ B/part:front`（玩家车体撞敌方炮管）。
    //    ⛔ 不许再把 `minGap < 0` 读成「深度接触」。定性取证 →
    //       `tests/productHammerHitRegistrationP0.test.ts` PH-01（判据 = 引擎 contact 事件流）。
    const rammer = cell('rammer', 'RangedTurret');
    const hammer = cell('hammer', 'RangedTurret');
    expect(rammer.minGap, 'rammer：L2 外显外框全程未贴到').toBeGreaterThan(0);
    expect(hammer.minGap, 'hammer：L2 外显外框曾重叠（≠ 物理接触，见 Cell.minGap）').toBeLessThan(0);

    // ④ 有伤害的 5 件（这一族的问题**不是**够不着，而是交换比）
    const landed = col.filter((c) => c.hits > 0);
    expect(landed.map((c) => c.label)).toEqual([
      'cannon',
      'flamethrower',
      'laser',
      'machineGun',
      'shotgun',
    ]);
    for (const c of landed) {
      expect(c.damage, `${c.label}：必须打出真实伤害`).toBeGreaterThan(0);
      expect(c.hpB, `${c.label}：对手被打掉一部分`).toBeLessThan(c.hpBMax);
    }

    // ⑤ 最接近的一件（对手剩余最少）—— 如实记录，不做评级
    const closest = landed.reduce((a, b) => (a.hpB <= b.hpB ? a : b));
    expect(closest.label, '对手剩余最少的单件').toBe('machineGun');
    expect(r1(closest.hpB), '最接近的一格：对手残血').toBe(159.8);

    // ⑥ `cannon` 唯一那次命中落在**固定窗口之外**（606 > 600）⇒ 窗口内累计 0 是如实的
    const cannon = cell('cannon', 'RangedTurret');
    expect(cannon.firstHitStep!).toBeGreaterThan(WINDOW_FRAMES);
    expect(cannon.windowDamage, '窗口内累计 = 0（首发在窗口外）').toBe(0);
    expect(cannon.damage, '窗口外仍有 1 次真实命中').toBe(120);

    // ⑦ 控距确实生效：Active 窗口结束时（第 600 步）7/7 都仍与玩家分离
    for (const c of col) expect(c.gapAtWindow, `${c.label}：Active 末必须有间距读数`).not.toBeNull();
    for (const c of col) expect(c.gapAtWindow!, `${c.label}：Active 末仍分离`).toBeGreaterThan(0);
  });

  it('MX-09 固定窗口：窗口语义自洽（未满窗口就终结 ⇒ 窗口值 = 全场值，明确披露）', () => {
    for (const c of allCells()) {
      const tag = `${c.label} vs ${c.encounter}`;
      if (c.windowSurvived) {
        expect(c.steps, `${tag}：活过窗口 ⇒ 总步数 ≥ 窗口`).toBeGreaterThanOrEqual(WINDOW_FRAMES);
        expect(c.windowDamage, `${tag}：窗口内累计不得超全场`).toBeLessThanOrEqual(c.damage);
        expect(c.gapAtWindow, `${tag}：活过窗口 ⇒ 必须有窗口边界间距读数`).not.toBeNull();
      } else {
        expect(c.steps, `${tag}：未满窗口就终结 ⇒ 总步数 < 窗口`).toBeLessThan(WINDOW_FRAMES);
        expect(c.windowDamage, `${tag}：未满窗口 ⇒ 窗口值必须等于全场值`).toBe(c.damage);
        expect(c.windowHits, `${tag}：未满窗口 ⇒ 窗口命中必须等于全场命中`).toBe(c.hits);
        expect(c.gapAtWindow, `${tag}：未满窗口 ⇒ 无窗口边界间距`).toBeNull();
      }
      expect(c.windowHits, `${tag}：窗口命中不可能超全场`).toBeLessThanOrEqual(c.hits);
    }
  });

  it('MX-10 附加行（**不属于**矩阵）：产品默认车面对同一批 Encounter 的真实结果', () => {
    const rows: Record<string, CellRow> = {};
    for (const e of ENCOUNTERS) {
      const c = auxCell(e);
      rows[e] = [
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
    expect(rows).toEqual({
      ProtoRusher: ['T', 'A', 'hp', 9, 1080, 131, 960, 679.1, 0],
      Chaser: ['T', 'A', 'hp', 9, 930, 134, 930, 735, 0],
      RangedTurret: ['T', 'B', 'hp', 2, 240, 609, 0, 0, 859.9],
    });
    // 逐**来源部件**明细（默认车有 `frontMass` 与 `top` 两件武器 ⇒ 来源必须如实分开报告）：
    // 实测 = **2 次命中全部来自 `cannon`**（2 × 120 玩家基线），`top` 槽那件**零贡献**。
    // ⚠️ 这与「只装 cannon」的 1 次命中不同 —— 差异来自车体（多挂一件 ⇒ 质量 / 几何不同
    //    ⇒ 轨迹不同），**不是** `top` 那件打中了。两者都不是本 Queue 的结论范围，只记录事实。
    expect(auxCell('RangedTurret').perPart).toEqual({ cannon: { count: 2, damage: 240 } });
  });

  it('MX-11 未改 canonical：7 件武器主伤害 + 3 个 Encounter 的对手定义逐字段冻结', () => {
    // ① 逐件 canonical「一次命中扣多少血」（写死 = 内容被改就报警）
    const damage: Record<string, number> = {};
    for (const w of WEAPONS) {
      const p = registry.functionals.get(w)!.behaviorParams ?? {};
      const key = Object.keys(p).find((k) => k.toLowerCase().includes('damage') && typeof p[k] === 'number')!;
      damage[w] = p[key] as number;
    }
    expect(damage).toEqual({
      cannon: 80,
      flamethrower: 8,
      hammer: 90,
      laser: 160,
      machineGun: 20,
      rammer: 70,
      shotgun: 30,
    });
    // ② 三段 Encounter 的对手定义 = 正式对手池里的模板（零新增敌人 / 零数值改动）
    for (const e of ENCOUNTERS) {
      const enc = LAB_ENCOUNTERS.find((x) => x.id === e);
      expect(enc, `Lab 必须已有 ${e}`).toBeDefined();
      const official = OPPONENT_TEMPLATES.find((t) => t.id === enc!.templateId);
      expect(official, `正式对手池必须有 ${enc!.templateId}`).toBeDefined();
      expect(enc!.count, `${e} 必须是单敌`).toBe(1);
      expect(enc!.draft, `${e} 不得修改正式敌人定义`).toEqual(official!.draft);
    }
    // ③ `RangedTurret` 仍是**唯一**声明控距的那一个（未被替换 / 未被削弱）
    expect(
      LAB_ENCOUNTERS.filter((x) => (x as { enemyDrive?: string }).enemyDrive === 'keep-distance').map((x) => x.id),
    ).toEqual(['RangedTurret']);
  });

  it('MX-12 本文件是**纯取证**：import 面是**闭集**，且不含任何写数值语句', () => {
    const src = readFileSync(join(__dirname, 'productRunWeaponEncounterMatrixR7.test.ts'), 'utf8');
    const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const paths = [...noComments.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);

    // ① import 面 = **闭集白名单**（新增依赖必须显式登记，不是「能跑就行」）
    expect([...paths].sort()).toEqual(
      [
        'node:fs',
        'node:path',
        'vitest',
        '../src/battle/arenaConfig',
        '../src/core/content',
        '../src/lab/buildEditorModel',
        '../src/lab/portraitBattleLab/runBattleRuntime',
        '../src/lab/portraitBattleLab/testData',
        '../src/player/opponentPool',
        '../src/product/playerLoadout',
        '../src/product/runCompatibility',
      ].sort(),
    );
    // ② 因此**结构上**不可能碰到编排器 / 敌方驱动 / 参数模块（不在白名单里）
    for (const forbidden of ['planckBattleOrchestrator', 'enemyDrive', 'planckWorld', 'runModifiers']) {
      expect(paths.some((p) => p.includes(forbidden)), `不得 import ${forbidden}`).toBe(false);
    }
    // ③ 本文件不得出现任何「写战斗数值」的语句（只读回读 + 冻结断言）
    //    ⚠️ 禁用词用**拼接**构造：否则守卫会匹配到它自己那张字面量表（自指陷阱）。
    const WRITE_TOKENS = ['.' + 'hp = ', '.' + 'maxHp = ', 'apply' + 'LinearImpulse', 'new ' + 'PlanckWorld'];
    for (const token of WRITE_TOKENS) {
      expect(noComments.includes(token), `取证文件不得出现 ${token}`).toBe(false);
    }
  });
});
