/**
 * PRODUCT-LOOP-R9-FULL-RUN-PATH-MATRIX｜**整局路线矩阵**（本 Queue 的验收本体）。
 *
 * ── Queue 要回答的问题 ─────────────────────────────────────────────────────
 *
 *   「对当前正式三段 Run 做自动化路径验证。不是要求 7 把武器全部通关，
 *     而是判断：**Build 选择不同，是否真的产生不同整局结果**。」
 *
 *   本文件把这个问题变成**可重复的机器读数**：每条路线都跑一遍**真实的**三段 Run
 *   （真实脚本 → 真实状态机 → 真实 `RunBattleRuntime` 真实物理），记录
 *   Weapon / Build① / Build② / 三段结果 / 终态 / 双方最终 HP / **各武器实际伤害**，
 *   并冻结成矩阵（改任何 Weapon / Enemy / Build 数值都会在这里炸出来）。
 *
 * ── 驱动口径（与宿主 `runPage.beginBattle()` **同一套**，不是另写剧本）────────
 *
 *   | 环节 | 真源 |
 *   |---|---|
 *   | 节点顺序 / DAY / 对手 | `runScript.ts` 的六节点链（现读，不抄字面量） |
 *   | 池的种类与内容 | `runChoicePool()`（`layer1` / `layer2`，池族由基准武器决定） |
 *   | Build 落地 | `chooseRunBuff()`（**必须在池里**，否则 no-op —— 借此取证「不硬塞」） |
 *   | 跨段耐久 | `runCarriedPlayerHp()`（`EVENT` 那一刻读，与宿主同源同刻） |
 *   | 战斗 | `new RunBattleRuntime({ build: runBuildIds(s), carriedHp, encounterId, playerDraft, playerLoadoutTag, playerBaseline: true })` |
 *   | 出口 | `finishRunBattle()`（官方 `winner` / `endReason` / 真实 HP） |
 *
 *   ⚠️ 本文件**没有**任何「测试专用剧本 / 测试专用 Buff / 手工改 HP」：
 *      `playerDraft` 与 `encounters` 都来自宿主同一条 `runPageContext()` ——
 *      `R9F-01` / `R9F-07` 逐条断言这件事。
 *
 * ── 两种夹具形态（**同一个路线集**各跑一遍；夹具本身也是变量，如实标注）──────
 *
 *   | 形态 | 装配 | 为什么用它 |
 *   |---|---|---|
 *   | `walk` | `{ front: W, top: 'machineGun', rear: 'machineGun' }` | 既有 `WALK` 形态（`portraitRunPage.test.ts` / R9-07 同源）：7 件武器**都能真的走到第 3 段** ⇒ 「两次 Build 都拿到、三段都可比」是完整记录 |
 *   | `only` | `{ frontMass: W }`（单件归因夹具，R7 / R8 / R9-06 同源） | 车上**只有这一件**武器 ⇒ 「Weapon」是唯一变量；代价是部分武器活不过前两段，路线会被截断（这本身也是记录） |
 *
 *   ⚠️ `walk` 车上有**两件**武器（基准武器 + 2 件 `machineGun`）—— 那是既有产品形态，
 *      不是为本矩阵造出来的；代价是「各武器实际伤害」有两行（本文件按**武器 defId** 分列）。
 *   ⚠️ 两个形态都不是为「让路线赢」挑的：`only` 形态 **17 条路线 17 条 FAILED**，一条没改。
 *
 * ── 路线集（Queue 点名的 A–F + 补齐其余放行武器，共 7 件 / 17 路线 × 2 形态）──
 *
 *   | id | Weapon | Build① | Build② | 对应 Queue |
 *   |---|---|---|---|---|
 *   | `A`  | machineGun | `damageUp` | `rateUp` | A |
 *   | `B`  | machineGun | `rateUp` | `damageUp` | B |
 *   | `C1` | machineGun | `emergencyRepair` | `damageUp` | **C（不投输出的路线）** |
 *   | `C2` | machineGun | `emergencyRepair` | `rateUp` | C 的对照臂（同一「不投输出」起点，第 2 次取另一项） |
 *   | `D1`/`D2` | hammer / flamethrower / rammer / shotgun | `damageUp`/`rateUp` | `rateUp`/`damageUp` | D + 「7 件」补全 |
 *   | `E1`/`E2` | laser | `damageUp`/`rateUp` | `rateUp`/`damageUp` | E |
 *   | `F1`/`F2`/`F3` | cannon | `heavyShell`/`twinCannon`/`fastReload` | 各自条件池首项 | F（既有 Cannon Build） |
 *
 * ── 结论（本文件实测，不掩盖任何一条）───────────────────────────────────────
 *
 *   ① **不同 Build 真的产生不同的整局读数**（`R9F-04`）：固定 (形态, 武器) 后，
 *      只要两条路线的 Build 序列不同、且都走到了第 2 段，**整局签名必不同**；
 *      例：machineGun `walk` 四次选择 → 终局我方耐久 **871.2 / 869.7 / 900 / 980**。
 *
 *   ② **Build 只从第 2 段起生效**（`R9F-02`）：同一 (形态, 武器) 下所有路线的**第 1 段读数
 *      逐字节相同**（第 1 段是零 Build 段）—— 这条不变量同时**解释了**下面 ③。
 *
 *   ③ **「零 Build 第 1 段就截断」的路线现已为零**：`rammer` 曾是唯一一件单件撑不过第 1 段的武器，
 *      但两轮 R11 先后把它的前一段补上了 —— `laser`（`cooldownMs` 1800 → 600）与
 *      `rammer`（`restSteps` 24 → 12，**只动攻击后的恢复节奏**）。
 *      ⇒ 17 条 `only` 路线里**没有任何一条**还在满耐久零 Build 的第 1 段阵亡
 *        （`R9F-04` ⑤ 把它钉成「集合必须为空」）。
 *      `rammer` 现在**能**撑过第 1 段（`ProtoRusher:A/538.4/0/1033`，命中 11 → 12），
 *      第 ② 段仍败（`Chaser`：接触类打控距对手）⇒ `R9F-06` 的 `only` 表里它
 *      从 `FAILED@ProtoRusher` 改成 **`FAILED@Chaser`**；`R9F-08` 那两行同步改。
 *      ⚠️ 同一轮里 `walk` 形态的 `rammer` **反向退化**（`D1`/`D2` 由 COMPLETE 变 FAILED，差 11.7 血）
 *        ⇒ 「7 件全部 COMPLETE」降级为「6 件 COMPLETE」（`R9F-06` 反向表）。两条都如实冻结。
 *
 *   ④ **Queue 的 C 臂「完全不产生核心输出提升」在结构上不可能存在于一局之内**
 *      （`R9F-05` 给出机器证明）：通用池 3 项里只有 `emergencyRepair` 不是输出项，
 *      而一局**恰好 2 次选择** ⇒ 第 2 次必然拿到 `damageUp` / `rateUp`。
 *      C 臂能证明的是「**第 2 段**零输出提升」：`emergencyRepair` 之后该武器逐发伤害
 *      仍是 canonical（machineGun 20，不是 25），且 C1 / C2 第 2 段读数逐字节相同
 *      ⇒ 它只动耐久、不动武器。
 *
 *   ⑤ `only` 形态 `cannon` 三条路线第 3 段**零命中**（对手 1100 满血）——与 R8 的
 *      「`RangedTurret` 够不着」结论同源。本 Queue **未修**（未替换 / 未削弱 / 未改数值）。
 *
 *   ⑥ **读数与执行顺序 / 装载 key 无关**（`R9F-09`）：四条代表路线在「整张矩阵跑完之后」
 *      用**不同的 `loadout.key`** 复跑，结果与伤害逐字节一致 ⇒ 本表的冻结值可复现，
 *      且不存在「跨路线把运行时 / 装载状态串味」的隐患。
 *      ⚠️ 因此：**换个临时脚本量出别的值，先怀疑那个脚本**，不要直接改本表。
 *      （本轮实测踩过：一个临时探针给出过 `walk/cannon/F1` 第 2 段 `cannon:120x3`，
 *        四种上下文复跑 + 两次整测均稳定为 **`x2`** ⇒ 那个探针是错的。）
 *
 * ── 禁止清单逐条取证 ───────────────────────────────────────────────────────
 *
 *   - **不修改参数**：`R9F-07` 断言基准武器每一发的伤害值 ∈ {canonical, round(canonical×1.25)}
 *     且与该段**是否已拥有 `damageUp`** 严格对应；非基准武器恒为自己的 canonical（不被污染）。
 *   - **不为了矩阵全绿调敌人**：`R9F-01` 断言三段 `hpBMax` 恰为 `[1000, 900, 1100]` 且 ==
 *     `runPageContext()` 现读值。
 *   - **不隐藏失败**：`R9F-08` 把 `FAILED` 与「未到达的 Build」一并冻结进矩阵。
 *   - **不自动重试**：`R9F-01` 断言「创建的战斗运行时次数 == 实际打过的段数」。
 *   - **不给测试专用 Buff**：`R9F-01` 断言第 1 段 `build === []`，且每段 `build` 恰为
 *     「已点过的项按点击顺序」。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { registry } from '../src/core/content';
import { EMPTY_SLOT, type BuildDraft } from '../src/lab/buildEditorModel';
import { RunBattleRuntime } from '../src/lab/portraitBattleLab/runBattleRuntime';
import {
  PRODUCT_RUN_CANNON_BASE_DAMAGE,
  RUN_BASE_WEAPON_DEF_ID,
  RUN_GENERIC_CHOICE_POOL,
  RUN_GENERIC_GROWTH_IDS,
  RUN_LAYER1_POOL,
  RUN_LAYER2_POOLS,
  isLayer1Modifier,
  weaponDamageParamKey,
  type RunBuildId,
} from '../src/lab/portraitBattleLab/runModifiers';
import {
  chooseRunBuff,
  createRunPageState,
  finishRunBattle,
  pressRunAction,
  runBuildIds,
  runCarriedPlayerHp,
  runChoicePool,
  runCurrentNode,
  type RunPageState,
} from '../src/lab/portraitBattleLab/runPageState';
import { runPageContext } from '../src/lab/portraitBattleLab/runPageScene';
import { RUN_SCRIPT, RUN_TOTAL_BATTLES, RUN_TOTAL_CHOICES } from '../src/lab/portraitBattleLab/runScript';
import { defaultPlayerDraft } from '../src/product/playerLoadout';
import { FULL_RUN_SUPPORTED_WEAPON_IDS, canStartFullRun } from '../src/product/runCompatibility';

/* --------------------------------------------------------------- 取证常量 */

const FRAME_MS = 1000 / 60;
/** 单场推进上限（只防死循环；`R9F-01` 断言**没有一场**撞到它）。 */
const MAX_FRAMES = 4000;
const PRODUCT_TAG = 'profile-equipped';
/** 真实物理用例的显式超时。 */
const SLOW_MS = 600_000;

/** 三段对手的真实 HP 上限（ProtoRusher / Chaser / RangedTurret；`R9F-01` 逐段对拍现读值）。 */
const ENEMY_HP_MAX = [1000, 900, 1100] as const;
/** 三段对手（顺序 = 脚本顺序）。 */
const ENCOUNTERS = ['ProtoRusher', 'Chaser', 'RangedTurret'] as const;

/** 六节点链的 id（线性链 ⇒ 任何一局的节点序列都是它的**前缀**）。 */
const CHAIN = RUN_SCRIPT.map((n) => n.id);
/** 链上 BATTLE / FINAL 节点 id（顺序 = 三段）。 */
const BATTLE_NODES = CHAIN.filter((id) => /battle|final/.test(id));

/* ------------------------------------------------------------------ 夹具 */

function draftOf(sel: Record<string, string>): BuildDraft {
  return {
    ...defaultPlayerDraft(),
    functionalSelections: {
      front: EMPTY_SLOT,
      frontMass: EMPTY_SLOT,
      top: EMPTY_SLOT,
      rear: EMPTY_SLOT,
      ...sel,
    },
  };
}

/**
 * 两种夹具形态。⚠️ 两个都**只是既有装配**（`walk` = `portraitRunPage` 的 WALK 形态；
 * `only` = R7/R8/R9-06 的单件归因夹具），**没有任何为本矩阵调过的数值**。
 */
const SHAPES = {
  walk: (w: string): BuildDraft => draftOf({ front: w, top: 'machineGun', rear: 'machineGun' }),
  only: (w: string): BuildDraft => draftOf({ frontMass: w }),
} as const;

type ShapeId = keyof typeof SHAPES;
const SHAPE_IDS = Object.keys(SHAPES) as ShapeId[];

/* ------------------------------------------------------------- 路线集 */

interface RouteSpec {
  readonly id: string;
  readonly weapon: string;
  readonly picks: readonly [string, string];
}

function routesFor(weapon: string): readonly RouteSpec[] {
  if (weapon === 'machineGun') {
    return [
      { id: 'A', weapon, picks: ['damageUp', 'rateUp'] },
      { id: 'B', weapon, picks: ['rateUp', 'damageUp'] },
      { id: 'C1', weapon, picks: ['emergencyRepair', 'damageUp'] },
      { id: 'C2', weapon, picks: ['emergencyRepair', 'rateUp'] },
    ];
  }
  if (weapon === RUN_BASE_WEAPON_DEF_ID) {
    return [
      { id: 'F1', weapon, picks: ['heavyShell', 'kineticBurst'] },
      { id: 'F2', weapon, picks: ['twinCannon', 'tripleLoad'] },
      { id: 'F3', weapon, picks: ['fastReload', 'heavyShell'] },
    ];
  }
  return [
    { id: 'D1', weapon, picks: ['damageUp', 'rateUp'] },
    { id: 'D2', weapon, picks: ['rateUp', 'damageUp'] },
  ];
}

const ROUTES: readonly RouteSpec[] = FULL_RUN_SUPPORTED_WEAPON_IDS.flatMap((w) => routesFor(w));

/* --------------------------------------------------------- 全跑（真实物理） */

interface StageFact {
  readonly nodeId: string;
  readonly encounterId: string;
  /** 本段**真实注入**的本局累积 Build（宿主 `beginBattle` 传的就是这一份）。 */
  readonly build: readonly RunBuildId[];
  readonly winner: 'A' | 'B' | null;
  /** 本段**开局**耐久（= 跨段携带值；第 1 段 = 满耐久）。 */
  readonly hpA0: number;
  readonly hpA: number;
  readonly hpB: number;
  readonly hpBMax: number;
  readonly steps: number;
  /** 是否撞到 `MAX_FRAMES` 还没出结果（断言必须为假）。 */
  readonly hitFrameCap: boolean;
  /** 本段**各武器**（按武器 defId 归组）的真实命中：命中次数 + 逐发伤害去重升序。 */
  readonly perWeapon: Readonly<Record<string, { readonly count: number; readonly unit: readonly number[] }>>;
}

interface RouteFact {
  readonly shape: ShapeId;
  readonly spec: RouteSpec;
  /** 实际被点掉的项（按点击顺序；Run 早死 ⇒ 短于 `spec.picks`）。 */
  readonly picked: readonly string[];
  /** 每个**真的到达**的 CHOICE 节点当下画出来的池。 */
  readonly pools: readonly (readonly string[])[];
  /** 每个到达的 CHOICE：指定的项是否真的在池里（假 ⇒ 被静默挡下）。 */
  readonly accepted: readonly boolean[];
  /** 该局创建的 `RunBattleRuntime` 次数（断言 == 段数 ⇒ 无自动重试）。 */
  readonly runtimesCreated: number;
  readonly stages: readonly StageFact[];
  readonly phase: string;
  /** 三段敌人的 HP 上限（现读自 `runPageContext`，用于证明敌人没被调）。 */
  readonly enemyHpMax: readonly number[];
  readonly valid: boolean;
}

const FACT_CACHE = new Map<string, RouteFact>();

/**
 * 跑完一整局（真实脚本 + 真实状态机 + 真实物理）。
 *
 * `ctxKeySuffix` 只用于 `R9F-09` 的**复跑守卫**：给了它就**绕过缓存**、并用一个不同的
 * `loadout.key` 重新解析装载 ⇒ 用同一段代码在「更脏」的上下文里再量一次。
 */
function runRoute(shape: ShapeId, spec: RouteSpec, ctxKeySuffix = ''): RouteFact {
  const key = `${shape}/${spec.weapon}/${spec.id}`;
  const hit = FACT_CACHE.get(key);
  if (hit && ctxKeySuffix === '') return hit;

  const draft = SHAPES[shape](spec.weapon);
  const valid = canStartFullRun(draft);
  const ctx = runPageContext({
    source: 'profile',
    label: `R9F/${key}`,
    draft,
    tag: PRODUCT_TAG,
    key: `r9f|${ctxKeySuffix}${key}`,
  });

  let s: RunPageState = createRunPageState(ctx);
  let carry: number | null = null;
  let runtimesCreated = 0;
  const stages: StageFact[] = [];
  const picked: string[] = [];
  const pools: (readonly string[])[] = [];
  const accepted: boolean[] = [];

  for (let guard = 0; guard < 40; guard++) {
    if (s.phase === 'COMPLETE' || s.phase === 'FAILED') break;
    const before = s;

    if (s.phase === 'BATTLE') {
      const node = runCurrentNode(s);
      const build = [...runBuildIds(s)];
      runtimesCreated += 1;
      // 与宿主 `runPage.beginBattle()` **逐项同口径**（含 `playerBaseline: true`）。
      const rt = new RunBattleRuntime({
        build,
        carriedHp: carry,
        encounterId: node.encounterId,
        playerDraft: draft,
        playerLoadoutTag: PRODUCT_TAG,
        playerBaseline: true,
      });
      try {
        const atStart = rt.hp();
        let steps = 0;
        while (rt.result === null && steps < MAX_FRAMES) {
          rt.step(FRAME_MS);
          steps += 1;
        }
        const hp = rt.hp();
        const perWeapon: Record<string, { count: number; unit: number[] }> = {};
        for (const [w, read] of Object.entries(rt.playerWeaponHitSummary())) {
          perWeapon[w] = { count: read.count, unit: [...new Set(read.damages)].sort((a, b) => a - b) };
        }
        stages.push({
          nodeId: node.id,
          encounterId: node.encounterId ?? '',
          build,
          winner: (rt.result?.winner ?? null) as 'A' | 'B' | null,
          hpA0: Math.round(atStart.a * 10) / 10,
          hpA: Math.round(hp.a * 10) / 10,
          hpB: Math.round(hp.b * 10) / 10,
          hpBMax: atStart.bMax,
          steps,
          hitFrameCap: rt.result === null,
          perWeapon,
        });
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
      pools.push(pool);
      const want = spec.picks[s.buffs.length] ?? '';
      accepted.push(pool.includes(want));
      s = chooseRunBuff(s, want, ctx);
      if (s === before) break; // no-op（项不在池里）⇒ 停在 CHOICE，本局截断
      picked.push(want);
      continue;
    }

    if (s.phase === 'EVENT') carry = runCarriedPlayerHp(s);
    s = pressRunAction(s, ctx);
    if (s === before) break;
  }

  const fact: RouteFact = {
    shape,
    spec,
    picked,
    pools,
    accepted,
    runtimesCreated,
    stages,
    phase: s.phase,
    enemyHpMax: BATTLE_NODES.map((id) => ctx.encounters[id]?.hpMax ?? -1),
    valid,
  };
  if (ctxKeySuffix === '') FACT_CACHE.set(key, fact);
  return fact;
}

const KEY_OF = (shape: ShapeId, spec: RouteSpec): string => `${shape}/${spec.weapon}/${spec.id}`;

const FACTS = new Map<string, RouteFact>();
for (const shape of SHAPE_IDS) for (const spec of ROUTES) FACTS.set(KEY_OF(shape, spec), runRoute(shape, spec));

const ALL_KEYS = [...FACTS.keys()];

/** 同一 (形态, 武器) 分组（因果比较必须限定在组内）。 */
function groupOf(shape: ShapeId, weapon: string): RouteFact[] {
  return ROUTES.filter((r) => r.weapon === weapon).map((r) => FACTS.get(KEY_OF(shape, r))!);
}

/* ------------------------------------------------------------- 读数格式 */

/** 单段读数：`对手:胜方/我方HP/敌方HP/步数`。 */
function stageRow(f: RouteFact, i: number): string {
  const x = f.stages[i];
  if (!x) return '（未到达）';
  return `${x.encounterId}:${x.winner}/${x.hpA}/${x.hpB}/${x.steps}`;
}

/** 单段「各武器实际伤害」：`武器:逐发×次数`（零命中 ⇒ `-`）。 */
function stageDamage(f: RouteFact, i: number): string {
  const x = f.stages[i];
  if (!x) return '-';
  const parts = Object.entries(x.perWeapon).map(([w, r]) => `${w}:${r.unit.join('/')}x${r.count}`);
  return parts.length > 0 ? parts.join(' ') : '-';
}

/** 整局读数行：`终态 | 段1 | 段2 | 段3`。 */
function resultRow(f: RouteFact): string {
  return [f.phase, ...f.stages.map((_, i) => stageRow(f, i))].join(' | ');
}

/** 整局「各武器实际伤害」行（逐段列出）。 */
function damageRow(f: RouteFact): string {
  return f.stages.map((_, i) => stageDamage(f, i)).join(' ; ');
}

/** 整局签名（用于「不同 Build ⇒ 不同结果」的判据）。 */
function signature(f: RouteFact): string {
  return `${resultRow(f)}##${damageRow(f)}`;
}

/* ============================================================ 冻结矩阵 */

/** ⚠️ **本表就是本 Queue 的交付物**：每条路线的三段结果 + 终态 + 双方 HP。 */
const FROZEN_RESULT: Readonly<Record<string, string>> = {
  /* ── walk 形态（7 件武器全部走到第 3 段）──────────────────────────────── */
  'walk/cannon/F1': 'COMPLETE | ProtoRusher:A/915.2/0/241 | Chaser:A/822.2/0/228 | RangedTurret:A/282.2/0/372',
  'walk/cannon/F2': 'COMPLETE | ProtoRusher:A/915.2/0/241 | Chaser:A/822.6/0/199 | RangedTurret:A/282.6/0/373',
  'walk/cannon/F3': 'COMPLETE | ProtoRusher:A/915.2/0/241 | Chaser:A/822.1/0/196 | RangedTurret:A/282.1/0/371',
  'walk/flamethrower/D1':
    'COMPLETE | ProtoRusher:A/1023.2/0/222 | Chaser:A/930.4/0/203 | RangedTurret:A/530.4/0/258',
  'walk/flamethrower/D2':
    'COMPLETE | ProtoRusher:A/1023.2/0/222 | Chaser:A/930.1/0/197 | RangedTurret:A/530.1/0/258',
  'walk/hammer/D1': 'COMPLETE | ProtoRusher:A/977.7/0/281 | Chaser:A/704.1/0/237 | RangedTurret:A/64.1/0/382',
  'walk/hammer/D2': 'COMPLETE | ProtoRusher:A/977.7/0/281 | Chaser:A/794.4/0/228 | RangedTurret:A/154.4/0/382',
  // PRODUCT-LOOP-R11-LASER-CADENCE-R1：laser `cooldownMs` 1800 → 600（只动攻击间隔）
  //   ⇒ 三段内发射次数上升 ⇒ 三段终局我方耐久整体抬高（判据/形状一字未改）。
  'walk/laser/D1': 'COMPLETE | ProtoRusher:A/1100/0/230 | Chaser:A/828/0/218 | RangedTurret:A/468/0/259',
  'walk/laser/D2': 'COMPLETE | ProtoRusher:A/1100/0/230 | Chaser:A/918/0/209 | RangedTurret:A/558/0/259',
  'walk/machineGun/A': 'COMPLETE | ProtoRusher:A/991.2/0/223 | Chaser:A/991.2/0/147 | RangedTurret:A/871.2/0/191',
  'walk/machineGun/B': 'COMPLETE | ProtoRusher:A/991.2/0/223 | Chaser:A/989.7/0/190 | RangedTurret:A/869.7/0/191',
  'walk/machineGun/C1': 'COMPLETE | ProtoRusher:A/991.2/0/223 | Chaser:A/918.1/0/220 | RangedTurret:A/900/0/220',
  'walk/machineGun/C2': 'COMPLETE | ProtoRusher:A/991.2/0/223 | Chaser:A/918.1/0/220 | RangedTurret:A/980/0/212',
  // PRODUCT-LOOP-R11-RAMMER-REST-R1：rammer `restSteps` 24 → 12。
  //   ⚠️ **R11 的代价（如实冻结，不掩盖）**：`walk` 形态这两条 `damageUp`/`rateUp` 组合由 COMPLETE 翻成 FAILED。
  //      唯一胜方判定的终点 = 第 3 段（`RangedTurret` 控距）差 11.7 血。
  //      机制：`walk` 车上主输出是上下位 2 件 `machineGun`，rammer 在 346 步里只轮到 2~3 发；
  //      缩短 rest ⇒ 伸出相位整体前移 ⇒ 第 ① 段反而多挨 88.5 → 211.8 点，把这点余量一路带到终局。
  //      ⇒ 两条口径方向相反（`only` 变好 / `walk` 变差）已由 `productRunRammerRestR11` 的 `RR-02c` 双形态对照钉住。
  //      `walk/rammer` 的 `emergencyRepair` 相关 4 条组合仍为 COMPLETE（6 → 4）。
  'walk/rammer/D1': 'FAILED | ProtoRusher:A/888.2/0/319 | Chaser:A/525.8/0/205 | RangedTurret:B/0/11.7/363',
  'walk/rammer/D2': 'FAILED | ProtoRusher:A/888.2/0/319 | Chaser:A/346.4/0/200 | RangedTurret:B/0/411.7/229',
  'walk/shotgun/D1': 'COMPLETE | ProtoRusher:A/971.8/0/235 | Chaser:A/879/0/238 | RangedTurret:A/459/0/307',
  'walk/shotgun/D2': 'COMPLETE | ProtoRusher:A/971.8/0/235 | Chaser:A/698.7/0/233 | RangedTurret:A/278.7/0/307',

  /* ── only 形态（单件归因；17/17 全部 FAILED，截断的段数如实记在行里）──── */
  'only/cannon/F1': 'FAILED | ProtoRusher:A/859.2/0/601 | Chaser:A/311.8/0/545 | RangedTurret:B/0/1100/224',
  'only/cannon/F2': 'FAILED | ProtoRusher:A/859.2/0/601 | Chaser:A/494.1/0/338 | RangedTurret:B/0/1100/348',
  'only/cannon/F3': 'FAILED | ProtoRusher:A/859.2/0/601 | Chaser:A/313.2/0/392 | RangedTurret:B/0/1100/225',
  'only/flamethrower/D1':
    'FAILED | ProtoRusher:A/919.6/0/486 | Chaser:A/372.6/0/386 | RangedTurret:B/0/960/217',
  'only/flamethrower/D2':
    'FAILED | ProtoRusher:A/919.6/0/486 | Chaser:A/284.4/0/400 | RangedTurret:B/0/1060/197',
  'only/hammer/D1': 'FAILED | ProtoRusher:A/414.2/0/1010 | Chaser:B/0/441.7/322',
  'only/hammer/D2': 'FAILED | ProtoRusher:A/414.2/0/1010 | Chaser:B/0/352.9/350',
  // R11：laser 不再「零 Build 段就截断」——D1 走进终局才败（3 段），D2 死在 ②。
  'only/laser/D1': 'FAILED | ProtoRusher:A/739.6/0/853 | Chaser:A/190.7/0/599 | RangedTurret:B/0/900/149',
  'only/laser/D2': 'FAILED | ProtoRusher:A/739.6/0/853 | Chaser:B/0/252.4/534',
  'only/machineGun/A': 'FAILED | ProtoRusher:A/979.5/0/715 | Chaser:A/340.5/0/511 | RangedTurret:B/0/575/236',
  'only/machineGun/B': 'FAILED | ProtoRusher:A/979.5/0/715 | Chaser:A/250.4/0/529 | RangedTurret:B/0/750/154',
  'only/machineGun/C1': 'FAILED | ProtoRusher:A/979.5/0/715 | Chaser:A/278.3/0/626 | RangedTurret:B/0/400/368',
  'only/machineGun/C2': 'FAILED | ProtoRusher:A/979.5/0/715 | Chaser:A/278.3/0/626 | RangedTurret:B/0/520/369',
  // PRODUCT-LOOP-R11-RAMMER-REST-R1：rammer `restSteps` 24 → 12（**只动「攻击后的恢复节奏」**）。
  //   ⇒ `only` 形态不再「零 Build 的第 ① 段就阵亡」，改成**打进第 ② 段**才阵亡（这正是本 Queue 的收益：
  //      `ProtoRusher` 段剩余 HP 0 → 538.4，命中 11 → 12）。第 ② 段仍败（接触类打控距对手）。
  'only/rammer/D1': 'FAILED | ProtoRusher:A/538.4/0/1033 | Chaser:B/0/273.9/524',
  'only/rammer/D2': 'FAILED | ProtoRusher:A/538.4/0/1033 | Chaser:B/0/402/480',
  'only/shotgun/D1': 'FAILED | ProtoRusher:A/499.3/0/625 | Chaser:B/0/210.5/339',
  'only/shotgun/D2': 'FAILED | ProtoRusher:A/499.3/0/625 | Chaser:B/0/143.3/355',
};

/** 与 `FROZEN_RESULT` 一一对应的「各武器实际伤害」冻结表。 */
const FROZEN_DAMAGE: Readonly<Record<string, string>> = {
  'walk/cannon/F1': 'machineGun:20x39 cannon:120x3 ; machineGun:20x33 cannon:120x2 ; machineGun:20x55',
  'walk/cannon/F2': 'machineGun:20x39 cannon:120x3 ; machineGun:20x27 cannon:120x3 ; machineGun:20x55',
  'walk/cannon/F3': 'machineGun:20x39 cannon:120x3 ; machineGun:20x27 cannon:120x3 ; machineGun:20x55',
  'walk/flamethrower/D1':
    'machineGun:20x33 flamethrower:8x46 ; machineGun:20x27 flamethrower:10x36 ; machineGun:20x40 flamethrower:10x30',
  'walk/flamethrower/D2':
    'machineGun:20x33 flamethrower:8x46 ; machineGun:20x28 flamethrower:8x43 ; machineGun:20x40 flamethrower:10x30',
  'walk/hammer/D1': 'machineGun:20x42 hammer:90x2 ; machineGun:20x34 hammer:113x2 ; machineGun:20x55',
  'walk/hammer/D2': 'machineGun:20x42 hammer:90x2 ; machineGun:20x32 hammer:90x3 ; machineGun:20x55',
  'walk/laser/D1': 'machineGun:20x34 laser:160x2 ; machineGun:20x30 laser:200x2 ; machineGun:20x35 laser:200x2',
  'walk/laser/D2': 'machineGun:20x34 laser:160x2 ; machineGun:20x29 laser:160x2 ; machineGun:20x35 laser:200x2',
  'walk/machineGun/A': 'machineGun:20x51 ; machineGun:25x37 ; machineGun:25x44',
  'walk/machineGun/B': 'machineGun:20x51 ; machineGun:20x46 ; machineGun:25x44',
  'walk/machineGun/C1': 'machineGun:20x51 ; machineGun:20x45 ; machineGun:25x44',
  'walk/machineGun/C2': 'machineGun:20x51 ; machineGun:20x45 ; machineGun:20x55',
  'walk/rammer/D1': 'machineGun:20x42 rammer:70x3 ; machineGun:20x28 rammer:88x4 ; machineGun:20x50 rammer:88x1',
  'walk/rammer/D2': 'machineGun:20x42 rammer:70x3 ; machineGun:20x28 rammer:70x5 ; machineGun:20x30 rammer:88x1',
  'walk/shotgun/D1': 'machineGun:20x35 shotgun:30x13 ; machineGun:20x34 shotgun:38x8 ; machineGun:20x42 shotgun:38x7',
  'walk/shotgun/D2': 'machineGun:20x35 shotgun:30x13 ; machineGun:20x32 shotgun:30x9 ; machineGun:20x42 shotgun:38x7',
  'only/cannon/F1': 'cannon:120x9 ; cannon:120x8 ; -',
  'only/cannon/F2': 'cannon:120x9 ; cannon:120x8 ; -',
  'only/cannon/F3': 'cannon:120x9 ; cannon:120x8 ; -',
  'only/flamethrower/D1': 'flamethrower:8x125 ; flamethrower:10x90 ; flamethrower:10x14',
  'only/flamethrower/D2': 'flamethrower:8x125 ; flamethrower:8x113 ; flamethrower:10x4',
  'only/hammer/D1': 'hammer:90x12 ; hammer:113x4',
  'only/hammer/D2': 'hammer:90x12 ; hammer:90x6',
  'only/laser/D1': 'laser:160x7 ; laser:200x5 ; laser:200x1',
  'only/laser/D2': 'laser:160x7 ; laser:160x4',
  'only/machineGun/A': 'machineGun:20x50 ; machineGun:25x36 ; machineGun:25x21',
  'only/machineGun/B': 'machineGun:20x50 ; machineGun:20x45 ; machineGun:25x14',
  'only/machineGun/C1': 'machineGun:20x50 ; machineGun:20x45 ; machineGun:25x28',
  'only/machineGun/C2': 'machineGun:20x50 ; machineGun:20x45 ; machineGun:20x29',
  // R11：`only/rammer` 的**单发值不变**（仍 70 / `damageUp` 后 88），变的只是「轮到了几发」（11 → 12 / 进 ② 段）。
  'only/rammer/D1': 'rammer:70x12 ; rammer:88x7',
  'only/rammer/D2': 'rammer:70x12 ; rammer:70x7',
  'only/shotgun/D1': 'shotgun:30x38 ; shotgun:38x18',
  'only/shotgun/D2': 'shotgun:30x38 ; shotgun:30x25',
};

/* ------------------------------------------------- 逐武器 canonical 伤害 */

/** 该武器**本局基准伤害键**的 canonical 值（现读 registry，不抄一份）。 */
function canonicalDamage(weapon: string): number {
  const def = registry.functionals.get(weapon);
  if (!def) throw new Error(`正式 registry 缺少武器 "${weapon}"`);
  const key = weaponDamageParamKey(def);
  if (!key) throw new Error(`武器 "${weapon}" 没有伤害键 ⇒ 本文件的伤害断言前提不成立`);
  const v = (def.behaviorParams ?? {})[key];
  if (typeof v !== 'number') throw new Error(`武器 "${weapon}" 的伤害键 "${key}" 不是数字`);
  return v;
}

/** `damageUp` 的派生规则（与运行时 `runModifiers` 逐字同口径）。 */
const boostedDamage = (canonical: number): number => Math.round(canonical * 1.25);

/**
 * **本局基准武器**在本场战斗里的 canonical 逐发伤害。
 *
 * ⚠️ 不能直接用 `registry` 的 cannon（= **80**）：产品 Run 的宿主恒传 `playerBaseline: true`
 *    ⇒ 玩家侧那一门炮的基线是 `PRODUCT_RUN_CANNON_BASE_DAMAGE`（**120**，见 `runModifiers` §11）。
 *    两者是**两件事**：正式 cannon 80（旧横屏玩法 / Validation / 敌方 `RangedTurret` 仍用 80），
 *    产品 Run 玩家侧 120。本文件断言的是**本场真正生效**的那一个。
 */
function baseWeaponCanonical(weapon: string): number {
  return weapon === RUN_BASE_WEAPON_DEF_ID ? PRODUCT_RUN_CANNON_BASE_DAMAGE : canonicalDamage(weapon);
}

/**
 * 产品里**全部既有**的 Build 词条 id（通用成长 ∪ Cannon 一层 ∪ Cannon 二层）。
 * 现读真源，不抄一份 ⇒ 「零新增词条」这条断言不可能因为名单抄错而假绿。
 */
const EXISTING_BUILD_IDS: readonly string[] = [
  ...RUN_GENERIC_CHOICE_POOL,
  ...RUN_LAYER1_POOL,
  ...Object.values(RUN_LAYER2_POOLS).flat(),
];

/** 每件武器在路线集里的「第一条」路线 id（现读 `routesFor`，避免手写字面量写错）。 */
function firstRouteId(weapon: string): string {
  return routesFor(weapon)[0]!.id;
}

/* ------------------------------------------------- 源码口径（宿主一致性） */

const LAB_DIR = join(__dirname, '..', 'src', 'lab', 'portraitBattleLab');

function readSrc(absPath: string): string {
  return readFileSync(absPath, 'utf8');
}

/** 剥注释后再匹配源码（守卫必须扛得住「注释里写了同一个词」的自指陷阱）。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/* ================================================================ 用例 */

describe('PRODUCT-LOOP-R9-FULL-RUN-PATH-MATRIX｜A. 整局结构不变量', () => {
  it('R9F-01 每条路线都恰好是「一次完整 Run」：真脚本 / 真状态机 / 真物理，无重试无隐藏项', () => {
    // 夹具自检：7 件放行武器 ×（machineGun 4 + cannon 3 + 其余各 2）条路线 × 2 形态
    const expectedRouteCount = ROUTES.length * SHAPE_IDS.length;
    expect(ALL_KEYS).toHaveLength(expectedRouteCount);
    expect(ROUTES.length).toBe(17);
    expect(FULL_RUN_SUPPORTED_WEAPON_IDS).toHaveLength(7);

    for (const key of ALL_KEYS) {
      const f = FACTS.get(key)!;

      // ① 夹具先要合法（否则后面所有读数都没有意义）
      expect(f.valid, `${key}: 资格层必须放行这份装配`).toBe(true);

      // ② 真的跑到了终态
      expect(['COMPLETE', 'FAILED'], `${key}: 必须到终态`).toContain(f.phase);

      // ③ 每一场都真的分出胜负（没有一场是靠撞 `MAX_FRAMES` 收场的）
      expect(f.stages.length, `${key}: 至少打了 1 场`).toBeGreaterThan(0);
      expect(f.stages.length, `${key}: 最多 3 场`).toBeLessThanOrEqual(RUN_TOTAL_BATTLES);
      for (const st of f.stages) {
        expect(st.hitFrameCap, `${key}/${st.nodeId}: 撞到帧上限 ⇒ 读数无效`).toBe(false);
        expect(st.winner, `${key}/${st.nodeId}: 必须有正式胜方`).not.toBe(null);
        expect(st.hpA0, `${key}/${st.nodeId}: 开局耐久必须 > 0`).toBeGreaterThan(0);
      }

      // ④ 三段严格按脚本顺序（线性链 ⇒ 不存在跳段 / 重排）
      expect(f.stages.map((x) => x.nodeId), `${key}: 段序`).toEqual(BATTLE_NODES.slice(0, f.stages.length));
      expect(f.stages.map((x) => x.encounterId), `${key}: 对手序`).toEqual(
        ENCOUNTERS.slice(0, f.stages.length),
      );

      // ⑤ **无自动重试**：创建战斗运行时的次数 == 真的打完的段数
      expect(f.runtimesCreated, `${key}: 运行时创建次数`).toBe(f.stages.length);

      // ⑥ **敌人没被调**：三段敌人 HP 上限逐段等于正式 `runPageContext()` 现读值
      expect(f.enemyHpMax, `${key}: 正式链路解析出的三段敌人 HP 上限`).toEqual([...ENEMY_HP_MAX]);
      for (let i = 0; i < f.stages.length; i++) {
        expect(f.stages[i]!.hpBMax, `${key}/${f.stages[i]!.nodeId}: 敌人 HP 上限`).toBe(ENEMY_HP_MAX[i]);
      }

      // ⑦ **没有隐藏 Build**：第 n 段注入的 Build 恰为「已点过的前 n-1 项」
      for (let i = 0; i < f.stages.length; i++) {
        expect(f.stages[i]!.build, `${key}: 第 ${i + 1} 段注入的 Build`).toEqual([...f.picked.slice(0, i)]);
      }
      expect(f.stages[0]!.build, `${key}: 第 1 段必须零 Build`).toEqual([]);

      // ⑧ 点掉的项必须都真的来自当时的池（不存在「指定了却被静默挡下」）
      expect(f.picked.length, `${key}: 实际点掉的项数 == 到达的 CHOICE 数`).toBe(f.accepted.length);
      expect(f.picked.length, `${key}: 到达的 CHOICE 数 == 池读数条数`).toBe(f.pools.length);
      for (const ok of f.accepted) expect(ok, `${key}: 指定的项必须来自当时真实的池`).toBe(true);
      expect(f.picked.length, `${key}: 一局最多 2 次选择`).toBeLessThanOrEqual(RUN_TOTAL_CHOICES);

      // ⑨ 终态与最后一段自洽
      const last = f.stages[f.stages.length - 1]!;
      if (f.phase === 'FAILED') {
        expect(last.hpA, `${key}: 失败 ⇒ 阵亡段我方耐久归零`).toBe(0);
        expect(last.winner, `${key}: 失败 ⇒ 阵亡段我方落败`).toBe('B');
      } else {
        expect(f.stages.map((x) => x.encounterId), `${key}: COMPLETE ⇒ 三段齐备`).toEqual([...ENCOUNTERS]);
        expect(f.stages.every((x) => x.winner === 'A'), `${key}: COMPLETE ⇒ 三段全胜`).toBe(true);
        expect(last.hpA, `${key}: COMPLETE ⇒ 终局存活`).toBeGreaterThan(0);
      }

      // ⑩ 池内容永远来自既有闭集（零新增词条），且不跨池族（Cannon 项 vs 通用成长）
      for (const pool of f.pools) {
        for (const id of pool) {
          expect(EXISTING_BUILD_IDS, `${key}: ${id} 不在现有词条闭集里（本 Queue 零新增）`).toContain(id);
          if (isLayer1Modifier(id)) {
            expect(RUN_GENERIC_GROWTH_IDS as readonly string[], `${key}: 通用成长不得出现在 cannon 池`).not.toContain(id);
          }
          if ((RUN_GENERIC_GROWTH_IDS as readonly string[]).includes(id)) {
            expect(f.spec.weapon, `${key}: 通用成长只发给非 Cannon 局`).not.toBe(RUN_BASE_WEAPON_DEF_ID);
          }
        }
      }
    }
  }, SLOW_MS);

  it('R9F-02 不变量：**第 1 段是零 Build 段** ⇒ 同一 (形态, 武器) 的所有路线第 1 段读数逐字节相同', () => {
    for (const shape of SHAPE_IDS) {
      for (const weapon of FULL_RUN_SUPPORTED_WEAPON_IDS) {
        const g = groupOf(shape, weapon);
        const base = `${stageRow(g[0]!, 0)}##${stageDamage(g[0]!, 0)}`;
        for (const f of g) {
          expect(f.stages[0]!.build, `${shape}/${weapon}: 第 1 段零 Build`).toEqual([]);
          expect(
            `${stageRow(f, 0)}##${stageDamage(f, 0)}`,
            `${shape}/${weapon}: 第 1 段（零 Build）不可能被 Build 影响`,
          ).toBe(base);
        }
      }
    }
  });

  it('R9F-03 Build 真的被消费：**第 1 次选择不同** ⇒ 第 2 段读数必不同；**相同** ⇒ 必相同', () => {
    let comparedPairs = 0;
    for (const shape of SHAPE_IDS) {
      for (const weapon of FULL_RUN_SUPPORTED_WEAPON_IDS) {
        const g = groupOf(shape, weapon);
        for (const a of g) {
          for (const b of g) {
            if (a === b) continue;
            // 只有「两边都真的打到了第 2 段」才构成有效对照
            if (a.stages.length < 2 || b.stages.length < 2) continue;
            const sameFirstPick = a.picked[0] === b.picked[0];
            const sigA = `${stageRow(a, 1)}##${stageDamage(a, 1)}`;
            const sigB = `${stageRow(b, 1)}##${stageDamage(b, 1)}`;
            const label = `${shape}/${weapon}: ${a.spec.id}(${a.picked[0]}) vs ${b.spec.id}(${b.picked[0]})`;
            if (sameFirstPick) {
              // 第 2 段的 Build 完全相同 ⇒ 物理结果必须逐字节相同（确定性、无隐藏随机）
              expect(sigA, `${label}: 同一份 Build 必须得到同一份结果`).toBe(sigB);
            } else {
              // 第 2 段的唯一变量就是第 1 次选择 ⇒ 读数必须不同
              expect(sigA, `${label}: 第 1 次选择不同，第 2 段读数却完全相同 ⇒ Build 没被消费`).not.toBe(
                sigB,
              );
              comparedPairs += 1;
            }
          }
        }
      }
    }
    // 夹具充分性：真的比过足够多的「不同 Build」对照
    expect(comparedPairs, '有效对照对数').toBeGreaterThanOrEqual(10);
  });
});

describe('PRODUCT-LOOP-R9-FULL-RUN-PATH-MATRIX｜B. 本 Queue 的判断标准', () => {
  it('R9F-04 不同 Build ⇒ 不同整局读数（固定形态 + 固定武器，Build 是唯一变量）', () => {
    let comparable = 0;
    const zeroBuildTruncated: string[] = [];

    for (const shape of SHAPE_IDS) {
      for (const weapon of FULL_RUN_SUPPORTED_WEAPON_IDS) {
        const g = groupOf(shape, weapon);
        const reachedTwo = g.filter((f) => f.stages.length >= 2);
        const distinctPicks = new Set(reachedTwo.map((f) => f.picked.join('+')));
        const distinctSignatures = new Set(reachedTwo.map(signature));

        // ① 走到第 2 段的路线里，Build 序列两两不同 ⇒ 整局签名必须两两不同
        expect(
          distinctSignatures.size,
          `${shape}/${weapon}: Build 序列不同却出现相同整局读数 ⇒ Build 没作用`,
        ).toBe(distinctPicks.size);

        // ② 同 Build 序列 ⇒ 同整局签名（确定性；顺带证明没有隐藏状态）
        for (const a of reachedTwo) {
          for (const b of reachedTwo) {
            if (a.picked.join('+') !== b.picked.join('+')) continue;
            expect(signature(a), `${shape}/${weapon}: 同 Build 必须同读数`).toBe(signature(b));
          }
        }

        if (distinctPicks.size >= 2) comparable += 1;

        // ③ **如实记录例外**：在第 1 段（零 Build）就结束的路线，
        //    「Build 不同」不可能产生不同读数 —— 这是结构事实，不是 Build 失效。
        for (const f of g) {
          if (f.stages.length >= 2) continue;
          expect(f.pools, `${shape}/${weapon}/${f.spec.id}: 截断的路线没有到达任何 CHOICE`).toHaveLength(0);
          expect(f.stages[0]!.build, `${shape}/${weapon}/${f.spec.id}: 截断的路线打的是零 Build 的第 1 段`).toEqual([]);
          zeroBuildTruncated.push(`${shape}/${weapon}/${f.spec.id}`);
        }
      }
    }

    // ④ 全局：至少存在两组「同一形态 + 同一武器下不同 Build 产生不同整局读数」
    expect(comparable, '存在可比对的 (形态, 武器) 组数').toBeGreaterThanOrEqual(6);

    // ⑤ 如实记录「零 Build 段就截断 ⇒ 两次选择拿同一份读数」的路线（不隐藏）
    //    ⚠️ PRODUCT-LOOP-R11-LASER-CADENCE-R1：laser 的 `cooldownMs` 1800 → 600 后，
    //       `only/laser/D1` 与 `D2` **不再**在第 1 段截断（D1 打进终局、D2 死在第 2 段，
    //       见 `FROZEN_RESULT`）⇒ 它们已不再属于这个「零 Build 截断」集合。
    //
    //    ⚠️ **本组现已空**（PRODUCT-LOOP-R11-RAMMER-REST-R1）：`rammer` 的 `restSteps` 24 → 12 后，
    //       `only/rammer/D1|D2` 第 ① 段**赢了**（`ProtoRusher:A/538.4/0/1033`），改成打进第 ② 段才阵亡
    //       ⇒ 17 条 `only` 路线里**已经没有任何一条**死在满耐久零 Build 的第 1 段。
    //       断言因此改为「必须为空」——它是**更强**的结论（比「恰好剩 rammer 两条」更强），不是放宽。
    expect(
      zeroBuildTruncated.sort(),
      'R11 之后不应再有「零 Build 第 1 段就截断」的路线',
    ).toEqual([]);
  });

  it('R9F-05 Queue 的 C 臂：**第 2 段零输出提升**可证；「整局都不投输出」结构上不可能', () => {
    // ① 结构证明：通用池 3 项里只有 1 项不是输出成长，而一局恰好 2 次选择
    const outputGrowth = RUN_GENERIC_GROWTH_IDS as readonly string[];
    const nonOutput = RUN_GENERIC_CHOICE_POOL.filter((id) => !outputGrowth.includes(id));
    expect(nonOutput, '通用池里的非输出项').toEqual(['emergencyRepair']);
    expect(RUN_TOTAL_CHOICES, '一局恰好两次选择').toBe(2);
    expect(
      nonOutput.length < RUN_TOTAL_CHOICES,
      '非输出项比选择次数少 ⇒ 「两次都不投输出」不可能',
    ).toBe(true);

    // ② 逐路线机器核对这条不可能性：**通用池族**里 emergencyRepair 至多出现一次，
    //    且点满两次的通用局面里至少有一项是输出成长。
    //    ⚠️ Cannon 局**不适用**这条 —— 它走自己那三池（那两个 id 既不是通用成长、
    //       也不以「输出 / 非输出」二分，它们是 Cannon 自己的强化）⇒ 逐段取证在 ⑥。
    for (const key of ALL_KEYS) {
      const f = FACTS.get(key)!;
      if (f.spec.weapon === RUN_BASE_WEAPON_DEF_ID) continue;
      expect(
        f.picked.filter((p) => p === 'emergencyRepair').length,
        `${key}: 非输出项不可能拿到两次`,
      ).toBeLessThanOrEqual(1);
      if (f.picked.length === RUN_TOTAL_CHOICES) {
        expect(
          f.picked.some((p) => outputGrowth.includes(p)),
          `${key}: 通用局点满两次 ⇒ 至少有一项是输出成长`,
        ).toBe(true);
      }
    }

    // ③ C 臂的**第 2 段**确实零输出提升：`emergencyRepair` 之后该武器逐发伤害仍是 canonical
    const canon = canonicalDamage('machineGun');
    for (const id of ['C1', 'C2'] as const) {
      const f = FACTS.get(`walk/machineGun/${id}`)!;
      expect(f.picked[0], `${id}: 第 1 次点的是非输出项`).toBe('emergencyRepair');
      expect(f.stages[1]!.build, `${id}: 第 2 段的 Build`).toEqual(['emergencyRepair']);
      expect(
        f.stages[1]!.perWeapon['machineGun']?.unit,
        `${id}: emergencyRepair 不改武器 ⇒ 第 2 段逐发仍是 canonical`,
      ).toEqual([canon]);
    }

    // ④ 对照：A 臂第 2 段（`damageUp`）逐发真的被抬高（否则上面那条只是「都没变」）
    const a = FACTS.get('walk/machineGun/A')!;
    expect(a.stages[1]!.perWeapon['machineGun']?.unit, 'damageUp ⇒ 第 2 段逐发被抬高').toEqual([
      boostedDamage(canon),
    ]);

    // ⑤ **同一份 Build ⇒ 同一份结果**：C1 / C2 的第 2 段逐字节相同
    //    ⇒ `emergencyRepair` 对本段战斗只有耐久效果，没有别的隐藏作用
    const c1 = FACTS.get('walk/machineGun/C1')!;
    const c2 = FACTS.get('walk/machineGun/C2')!;
    expect(`${stageRow(c1, 1)}##${stageDamage(c1, 1)}`).toBe(`${stageRow(c2, 1)}##${stageDamage(c2, 1)}`);

    // ⑥ Cannon 局根本不发放通用成长（池族闸门）—— C 臂的讨论只属于非 Cannon
    for (const id of ['F1', 'F2', 'F3'] as const) {
      const f = FACTS.get(`walk/cannon/${id}`)!;
      for (const pool of f.pools) {
        for (const g of RUN_GENERIC_GROWTH_IDS) {
          expect(pool, `cannon/${id}: 不得出现通用成长 ${g}`).not.toContain(g);
        }
      }
    }
  });

  it('R9F-06 与 R9-06 独立互证：`only` 形态 × 7 件的「死在哪一段」必须与既有冻结表一致', () => {
    const deathOf = (f: RouteFact): string =>
      f.phase === 'COMPLETE' ? 'COMPLETE' : `FAILED@${f.stages[f.stages.length - 1]!.encounterId}`;

    const table: Record<string, string> = {};
    for (const weapon of FULL_RUN_SUPPORTED_WEAPON_IDS) {
      // 与 R9-06 ② 同一口径：cannon 走 Cannon 池首项，其余走 `damageUp` → `rateUp`
      const f = FACTS.get(`only/${weapon}/${firstRouteId(weapon)}`)!;
      expect(f, `only/${weapon}: 路线必须存在`).toBeDefined();
      table[weapon] = deathOf(f);
    }
    // ⚠️ 这张表逐字来自 `productRunThreeStagePacingR9.test.ts` 的 `R9-06` ②（两次独立测量）
    expect(table).toEqual({
      cannon: 'FAILED@RangedTurret',
      flamethrower: 'FAILED@RangedTurret',
      hammer: 'FAILED@Chaser',
      laser: 'FAILED@RangedTurret', // R11：与 R9-06 ② 独立互证（两处都测到同一段）
      machineGun: 'FAILED@RangedTurret',
      rammer: 'FAILED@Chaser', // R11-RAMMER：`restSteps` 24 → 12 ⇒ 第 ① 段不再阵亡，改为死在 ② 段
      shotgun: 'FAILED@Chaser',
    });

    // 反向：多槽形态（walk）同样口径下 7 件里 **6 件** COMPLETE —— 与 R9-03 / R9-07 的结论同向
    //   ⚠️ PRODUCT-LOOP-R11-RAMMER-REST-R1：rammer `restSteps` 24 → 12 后，它的 `D1`（`damageUp`→`rateUp`）
    //      由 COMPLETE 翻成 FAILED（终局差 11.7 血）⇒ 本表从「7 件全部 COMPLETE」降级为「6 件 COMPLETE」。
    //      这是 R11 的**真实代价**，如实冻结（`FROZEN_RESULT` 的 `walk/rammer/D1|D2` 同步改）。
    //      机制与双形态对照见 `productRunRammerRestR11` 的 `RR-02c`。
    const walkTable: Record<string, string> = {};
    for (const weapon of FULL_RUN_SUPPORTED_WEAPON_IDS) {
      const f = FACTS.get(`walk/${weapon}/${firstRouteId(weapon)}`)!;
      walkTable[weapon] = deathOf(f);
    }
    expect(walkTable).toEqual({
      cannon: 'COMPLETE',
      flamethrower: 'COMPLETE',
      hammer: 'COMPLETE',
      laser: 'COMPLETE',
      machineGun: 'COMPLETE',
      rammer: 'FAILED@RangedTurret', // R11-RAMMER：唯一一件由 COMPLETE 退化者（差 11.7 血）
      shotgun: 'COMPLETE',
    });
    expect(
      Object.values(walkTable).filter((v) => v === 'COMPLETE'),
      'walk 形态仍必须有 6 件能通关（退化只允许发生在 rammer 这一件上）',
    ).toHaveLength(6);
  });
});

describe('PRODUCT-LOOP-R9-FULL-RUN-PATH-MATRIX｜C. 禁止清单取证', () => {
  it('R9F-07 只用既有内容：伤害值 ∈ {canonical, canonical×1.25}，且与「是否已拥有 damageUp」严格对应', () => {
    const registryCanonical = new Map<string, number>();
    for (const w of FULL_RUN_SUPPORTED_WEAPON_IDS) registryCanonical.set(w, canonicalDamage(w));

    for (const key of ALL_KEYS) {
      const f = FACTS.get(key)!;
      const weapon = f.spec.weapon;
      // ⚠️ 基准武器用**本场真正生效**的基线（cannon 在产品 Run 里是 120，不是正式 80）
      const base = baseWeaponCanonical(weapon);
      const boosted = boostedDamage(base);

      for (let i = 0; i < f.stages.length; i++) {
        const st = f.stages[i]!;
        const ownsDamageUp = st.build.includes('damageUp');

        // ① 基准武器**本段**的逐发伤害（没命中 ⇒ 本段无读数，跳过）
        const baseRead = st.perWeapon[weapon];
        if (baseRead) {
          expect(
            [...baseRead.unit].sort((x, y) => x - y),
            `${key}/${st.nodeId}: 基准武器 ${weapon} 的逐发值只可能是 canonical(${base}) 或 damageUp 后的值(${boosted})`,
          ).toEqual([ownsDamageUp ? boosted : base]);
        }

        // ② 非基准武器**一律不被通用成长污染**（通用成长只重映射基准武器那一件）
        for (const [w, read] of Object.entries(st.perWeapon)) {
          if (w === weapon) continue;
          expect(
            [...read.unit],
            `${key}/${st.nodeId}: ${w} 不是本局基准武器 ⇒ 不得被本局的通用成长改到`,
          ).toEqual([registryCanonical.get(w)!]);
        }
      }
    }

    // ③ 反向取证：这一批路线的确覆盖到「抬升」的段（否则 ① 只是「都没变」）
    const busters = ALL_KEYS.filter((k) => FACTS.get(k)!.stages.some((s) => s.build.includes('damageUp')));
    expect(busters.length, '真的有路线拿到过 damageUp').toBeGreaterThanOrEqual(8);

    // ④ 产品侧基线本身：cannon 在玩家侧是 120（正式 registry 仍是 80）—— 两个数不混
    expect(PRODUCT_RUN_CANNON_BASE_DAMAGE, '产品 Run 玩家侧 cannon 基线').toBe(120);
    expect(canonicalDamage(RUN_BASE_WEAPON_DEF_ID), '正式 registry 的 cannon 仍是 80').toBe(80);
  });

  it('R9F-08 路线矩阵（本 Queue 的记录表）：结果 + 各武器实际伤害，逐条冻结', () => {
    const measuredResult: Record<string, string> = {};
    const measuredDamage: Record<string, string> = {};
    for (const key of ALL_KEYS) {
      const f = FACTS.get(key)!;
      measuredResult[key] = resultRow(f);
      measuredDamage[key] = damageRow(f);
    }

    expect(Object.keys(measuredResult).sort()).toEqual(Object.keys(FROZEN_RESULT).sort());
    expect(measuredResult).toEqual({ ...FROZEN_RESULT });
    expect(measuredDamage).toEqual({ ...FROZEN_DAMAGE });

    // 记录表（人工核对用；不断言排版）
    const lines = [
      '| 形态 | Weapon | Build① | Build② | 段1 | 段2 | 段3 | 终态 | 终局我方HP | 终局敌方HP | 各武器实际伤害 |',
      '|---|---|---|---|---|---|---|---|---|---|---|',
    ];
    for (const key of ALL_KEYS) {
      const f = FACTS.get(key)!;
      const last = f.stages[f.stages.length - 1]!;
      lines.push(
        `| ${f.shape} | ${f.spec.weapon} | ${f.picked[0] ?? '（未到达）'} | ${f.picked[1] ?? '（未到达）'} | ` +
          `${stageRow(f, 0).split(':')[1] ?? '-'} | ${f.stages.length > 1 ? stageRow(f, 1).split(':')[1] : '（未到达）'} | ` +
          `${f.stages.length > 2 ? stageRow(f, 2).split(':')[1] : '（未到达）'} | ${f.phase} | ${last.hpA} | ${last.hpB} | ` +
          `${damageRow(f)} |`,
      );
    }
    console.log('[R9F 路线矩阵记录表]\n' + lines.join('\n'));
  }, SLOW_MS);

  it('R9F-09 读数与执行顺序 / 装载 key 无关：同一路线在**最脏的上下文**里复跑，读数逐字节一致', () => {
    // 此时整张矩阵已全部跑完 ⇒ 进程里已经有大量「之前的运行时 / 之前的装载解析」，
    // 是最容易暴露「跨路线状态串味」的上下文。
    const RECHECK: readonly (readonly [ShapeId, string, string])[] = [
      ['walk', 'cannon', 'F1'],
      ['walk', 'machineGun', 'A'],
      ['only', 'hammer', 'D1'],
      ['only', 'laser', 'D1'],
    ];
    for (const [shape, weapon, id] of RECHECK) {
      const spec = ROUTES.find((r) => r.weapon === weapon && r.id === id);
      expect(spec, `${shape}/${weapon}/${id}: 路线必须存在`).toBeDefined();
      const first = FACTS.get(`${shape}/${weapon}/${id}`)!;
      const again = runRoute(shape, spec!, 'recheck|');

      expect(again.phase, `${shape}/${weapon}/${id}: 复跑终态`).toBe(first.phase);
      expect(resultRow(again), `${shape}/${weapon}/${id}: 复跑结果必须逐字节一致`).toBe(resultRow(first));
      expect(damageRow(again), `${shape}/${weapon}/${id}: 复跑伤害必须逐字节一致`).toBe(damageRow(first));
      expect(again.runtimesCreated, `${shape}/${weapon}/${id}: 复跑同样不重试`).toBe(
        again.stages.length,
      );
      expect(again.picked, `${shape}/${weapon}/${id}: 复跑选择路径一致`).toEqual(first.picked);
    }
  }, SLOW_MS);

  it('R9F-10 源码口径守卫：本文件的驱动口径 == 宿主 `runPage.beginBattle()` 的口径', () => {
    /*
      ⚠️ **走查口径 ≠ 宿主级回归**（R9 memory 里已登记的陷阱）：
      本文件像 `R9-02` 一样**自己驱动**状态机 + 运行时 —— 把宿主
      `runPage.ts:beginBattle` 的 `build: runBuildIds(this.state)` 改成 `build: []`，
      `R9F-01`…`R9F-09` **全都不会红**（走查不经宿主）。因此必须另有一条源码守卫，
      把「本文件的注入口径」与「宿主真实注入口径」钉在一起。
    */
    const hostSrc = stripComments(readSrc(join(LAB_DIR, 'runPage.ts')));
    const fromBegin = hostSrc.slice(hostSrc.indexOf('private beginBattle()'));
    expect(fromBegin.length, 'runPage.ts 必须仍然有 private beginBattle()').toBeGreaterThan(0);
    const endIdx = fromBegin.indexOf('private endBattle()');
    expect(endIdx, '文件结构变了 ⇒ 本守卫需要更新（不要删）').toBeGreaterThan(0);
    const body = fromBegin.slice(0, endIdx);

    for (const required of [
      'new RunBattleRuntime(',
      'build: runBuildIds(this.state)',
      'carriedHp: runCarriedPlayerHp(this.state)',
      'encounterId: runCurrentNode(this.state).encounterId',
      'playerDraft: this.loadout.draft',
      'playerBaseline: true',
    ]) {
      expect(body, `宿主 beginBattle 必须仍然把「${required}」交给本场运行时`).toContain(required);
    }

    // 本文件的 harness 必须用**同一组**注入项（逐条现读，防止两边漂移）
    const selfSrc = stripComments(readSrc(join(__dirname, 'productRunFullRunPathMatrixR9F.test.ts')));
    for (const required of [
      'new RunBattleRuntime(',
      'build,',
      'carriedHp: carry,',
      'encounterId: node.encounterId,',
      'playerDraft: draft,',
      'playerLoadoutTag: PRODUCT_TAG,',
      'playerBaseline: true,',
    ]) {
      expect(selfSrc, `本文件的 harness 必须仍然用「${required}」`).toContain(required);
    }

    // 跨段耐久也必须同源同刻（宿主在 EVENT 那一刻读；本文件同样）
    expect(body, '宿主必须用 EVENT 时刻的真实耐久带入下一场').toContain('runCarriedPlayerHp(this.state)');
  });
});
