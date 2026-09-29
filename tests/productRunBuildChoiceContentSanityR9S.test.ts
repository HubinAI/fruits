/**
 * PRODUCT-LOOP-R9-BUILD-CHOICE-CONTENT-SANITY｜**两次 Build Choice 里「画出来的每一项都选得动」**的机器取证。
 *
 * ── 本 Queue 要回答的一个问题 ────────────────────────────────────────────────
 *
 *   R9 把单局收成严格三段链（2 次 Build Choice）之后，玩家在 CHOICE 节点上**看得到**的每一项，
 *   是不是**真的**会作用于他这一局的武器 / 车体？也就是：
 *
 *     「可选择项的集合」 == 「真的会改数字的集合」。
 *
 *   不允许出现：对这件武器完全无效的条目 / Runtime 根本不消费的字段 / 重复且无效果的选项 /
 *   `behavior` 污染 / 已经到无意义状态还继续提供同一项。
 *
 * ── 本文件的做法：**真实能力矩阵**（不是第二张「武器 × 词条」表）────────────────
 *
 *   判据只有一条：把**运行时同一段派生**（`genericGrowthParamsOf` —— `composeRunWeaponDef`
 *   用的就是它）在**这件武器自己的 canonical Def** 上跑一遍，再逐字段比对：
 *   派生结果为空 / 与原值逐字段相同 ⇒ 选了也一个数字都不会变 ⇒ **该项不该出现**。
 *   ⇒ 由 `genericGrowthApplies`（单格）与 `genericGrowthPoolFor`（整池）承载。
 *
 * ── 与本 Queue 之外的既有证据的分工（**不重复造证据，也不掩盖缺口**）────────────
 *
 *   | 维度 | 证据所在 |
 *   |---|---|
 *   | 派生面（伤害键 / 节奏键 / hammer 基准同源） | `productRunWeaponBasicBuildR7.test.ts` GR-01/02/02b |
 *   | 合成语义 + `behavior` 不被改写 + Cannon 冻结 | 同上 GR-03/04/05 |
 *   | `damageUp` 的**逐件真战斗**逐发伤害（7 件） | 同上 GR-06 |
 *   | `machineGun` 的 `rateUp` 真实节奏 | 同上 GR-06b |
 *   | `damageUp` / `rateUp` 对终局段真实战果 | `productRunThreeStagePacingR9.test.ts` R9-04 |
 *   | **能力矩阵 × 7 件 + 池族闸门 + 两次可用池快照 + `rateUp` 逐件真实节奏 + `emergencyRepair` 真实耐久** | **本文件** |
 *
 * ── ⚠️ 如实披露：本批次在**通用池受众**（6 件非 Cannon）上**没有发现**「画出来但选不动」的项 ──
 *
 *   逐件实测（`R9S-01` / `R9S-06` / `R9S-07`）的结论是：
 *
 *   - **Cannon**：走**自己那三池**，通用成长对它**零适用**（`weaponOverlayMods` 显式排除，
 *     合成后逐字段等于 canonical）⇒ 本 Queue 一个字节都没动它（`R9S-01⑤` / `R9S-04` / `R9S-06④`）。
 *   - **6 件非 Cannon × 3 项通用池 = 18 格全部有效**：`damageUp` 6/6 真的抬高逐发伤害
 *     （本文件逐件真战斗；Cannon 之外的 `damageUp` 逐件真战斗另有 R7 GR-06 覆盖 7/7），
 *     `rateUp` 6/6 真的让**下一次攻击更早发生**（本文件逐件真战斗，读数见 `R9S-07` 的 console 表），
 *     `emergencyRepair` 与武器无关、恒作用于车体耐久（本文件逐件真状态机）。
 *
 *   ⇒ 本批次引入的**不是**「修 6 件武器的 bug」，而是**把「池 = 有效选择的集合」变成结构事实**：
 *     能力矩阵落地后，池内容不再靠人工核对，任何**将来**新增 / 改动的武器（缺伤害键、缺节奏键、
 *     倍率取整后撞回原值、节奏键已在下限）会**自动**被过滤，而不是继续出现在 UI 上。
 *     `R9S-02` 用**人造退化 Def** 把这条「将来会发生的格子」真实打了一遍。
 *
 *   ⚠️ 同时记录一条**容易搞混的结构事实**：`genericGrowthApplies(def,'damageUp')` 对 **Cannon
 *      也是 `true`**（它的 `projectileDamage` 当然改得动）。「对它有效」与「发给它」是**两道
 *      互相独立**的闸门 —— 后者由池族（`runChoicePoolFamily` / `RUN_BASE_WEAPON_DEF_ID`）决定。
 *      `R9S-01` 对这两件事分别取证，不把它们混成一条判据。
 *
 * ── 不修改任何数值（本 Queue 的红线）────────────────────────────────────────
 *
 *   本文件**不**新增词条 / **不**新增稀有度 / **不**新增 reroll / **不**改任何词条数值 /
 *   **不**动 Cannon 的 5 项与三个池。表里的数是从**正式 registry / 正式常量 / 真实战斗事件**
 *   现读的读数。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { registry } from '../src/core/content';
import type { FunctionalPartDef } from '../src/core/types';
import { EMPTY_SLOT, type BuildDraft } from '../src/lab/buildEditorModel';
import { RunBattleRuntime } from '../src/lab/portraitBattleLab/runBattleRuntime';
import {
  EMERGENCY_REPAIR_FRACTION,
  RUN_BASE_WEAPON_DEF_ID,
  RUN_GENERIC_CHOICE_POOL,
  RUN_GENERIC_GROWTH_IDS,
  RUN_LAYER1_POOL,
  RUN_LAYER2_POOLS,
  RUN_MODIFIER_OVERLAY,
  composeRunWeaponDef,
  genericGrowthApplies,
  genericGrowthPoolFor,
  genericGrowthPoolForDef,
  isGenericGrowth,
  weaponCadenceGrowth,
  weaponDamageParamKey,
  weaponOverlayMods,
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
  type RunPageContext,
  type RunPageState,
} from '../src/lab/portraitBattleLab/runPageState';
import { runPageContext } from '../src/lab/portraitBattleLab/runPageScene';
import { FULL_RUN_SUPPORTED_WEAPON_IDS } from '../src/product/runCompatibility';
import { WEAPON_SLOT, defaultPlayerDraft } from '../src/product/playerLoadout';

/* --------------------------------------------------------------- 取证常量 */

/** 放行的 7 件（**真源现读**，不抄一份清单）。 */
const ALL = FULL_RUN_SUPPORTED_WEAPON_IDS;
/** 第 1 段遭遇（7 件都能真实接敌的那一场；与 Q3 / R7 同一对手）。 */
const SEG1 = 'ProtoRusher';
const FRAME_MS = 1000 / 60;
const MAX_FRAMES = 4000;
const PRODUCT_TAG = 'profile-equipped';
/** 真实物理用例的显式超时。 */
const SLOW_MS = 300_000;

const LAB_DIR = join(__dirname, '..', 'src', 'lab', 'portraitBattleLab');

function readLab(file: string): string {
  return readFileSync(join(LAB_DIR, file), 'utf8');
}

/** 剥注释后再匹配源码（守卫必须扛得住「注释里写了同一个词」的自指陷阱）。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function defOf(id: string): FunctionalPartDef {
  const def = registry.functionals.get(id);
  if (!def) throw new Error(`正式 registry 缺少武器 "${id}"`);
  return def;
}

/**
 * 归因夹具：车上**只留这一件**武器（伤害 / 节奏只能来自它）。
 * ⚠️ `slot` 做成参数（同 R7）而不是直接写 `[WEAPON_SLOT]`：`WEAPON_SLOT` 是字面量类型，
 *    与上面那行 `frontMass: EMPTY_SLOT` 会被 TS 判成「同一属性写了两次」。
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

function ctxFor(weaponDefId: string, key: string): RunPageContext {
  return runPageContext({
    source: 'profile',
    label: '测试车',
    draft: onlyDraft(weaponDefId),
    tag: PRODUCT_TAG,
    key: `r9s|${key}`,
  });
}

/* =================================================== A. 能力矩阵（零物理） */

/** 通用池里「与武器无关」的那一项（`affectsWeapon: false`）—— 池的地板。 */
const FLOOR_ITEM = 'emergencyRepair';

/**
 * **非 Cannon** 的 6 件：它们是**通用池**的受众。
 * ⚠️ Cannon 不在这个集合里，原因不是「它不支持通用成长」，而是
 *    **两条互相独立的闸门**（`R9S-01` 逐条取证）：
 *      ① 能力矩阵（`genericGrowthApplies`）：cannon 的 `projectileDamage` 当然会被 `damageUp` 改到 ⇒ **响应**；
 *      ② 池族闸门（`runChoicePoolFamily` ⇒ `RUN_BASE_WEAPON_DEF_ID`）：cannon 走**自己那三池**
 *         （`RUN_MODIFIER_OVERLAY` 显式排除通用成长）⇒ 通用池**根本不发放给它**。
 *    ⇒ 「对它有效」与「发给它」是两件事，本文件对 cannon 断言的是后者（保持原逻辑）。
 */
const NON_CANNON = ALL.filter((id) => id !== RUN_BASE_WEAPON_DEF_ID);

describe('PRODUCT-LOOP-R9-BUILD-CHOICE-CONTENT-SANITY｜A. 真实能力矩阵', () => {
  it('R9S-01 矩阵 7×2 + 池族闸门：有效 ≠ 发放（cannon 保持原逻辑）', () => {
    // ① 点名清单就是 Queue 点的那 7 件（真源现读，不抄一份）
    expect([...ALL].sort()).toEqual(
      ['cannon', 'flamethrower', 'hammer', 'laser', 'machineGun', 'rammer', 'shotgun'].sort(),
    );
    expect(ALL.length).toBe(7);
    expect(NON_CANNON.length).toBe(6);

    // ② `emergencyRepair` 与武器无关 ⇒ 恒在（池的地板，保证任何武器的池都不为空）
    expect(RUN_MODIFIER_OVERLAY.emergencyRepair.affectsWeapon, '它不改武器').toBe(false);
    expect(RUN_GENERIC_CHOICE_POOL).toEqual(['damageUp', 'rateUp', FLOOR_ITEM]);

    // ③ 矩阵本体：7 件 ×（damageUp / rateUp）**全部在派生上有效**
    const matrix: Record<string, { readonly damageUp: boolean; readonly rateUp: boolean }> = {};
    for (const id of ALL) {
      const def = defOf(id);
      matrix[id] = {
        damageUp: genericGrowthApplies(def, 'damageUp'),
        rateUp: genericGrowthApplies(def, 'rateUp'),
      };
    }
    // 冻结整张矩阵：这 7 件武器上「两项都改得动数字」。将来任何一件退化成「选不动」，
    // 这一行会立刻红（而不是让 UI 继续画一个死选项）。
    expect(matrix).toEqual({
      cannon: { damageUp: true, rateUp: true },
      flamethrower: { damageUp: true, rateUp: true },
      hammer: { damageUp: true, rateUp: true },
      laser: { damageUp: true, rateUp: true },
      machineGun: { damageUp: true, rateUp: true },
      rammer: { damageUp: true, rateUp: true },
      shotgun: { damageUp: true, rateUp: true },
    });

    // ④ 池族闸门：**6 件非 Cannon** 的真实可用池 = 超集本身（本批次在这 6 件上「只做减法且没减掉东西」）
    for (const id of NON_CANNON) {
      expect(genericGrowthPoolFor(id), `${id} 的可用池`).toEqual([...RUN_GENERIC_CHOICE_POOL]);
    }

    // ⑤ Cannon 的闸门在**别处**：能力矩阵说「响应」，但池族把它整族排除 ⇒ 通用成长一次都不发放。
    //    ⚠️ 只对**两条通用成长**（`damageUp` / `rateUp`）成立 —— `emergencyRepair` 是
    //       PRP-BUILD-01 起的**共享内容**，它本来就同时属于 Cannon 的第二层池（安全通用项）。
    expect(weaponOverlayMods([...RUN_GENERIC_GROWTH_IDS], RUN_BASE_WEAPON_DEF_ID), '通用成长对 Cannon 零适用').toEqual([]);
    expect(
      composeRunWeaponDef(defOf(RUN_BASE_WEAPON_DEF_ID), [...RUN_GENERIC_GROWTH_IDS], RUN_BASE_WEAPON_DEF_ID),
      'Cannon 合成通用成长后必须**逐字段等于** canonical',
    ).toEqual(defOf(RUN_BASE_WEAPON_DEF_ID));
  });


  it('R9S-02 过滤纪律：**纯减法 + 地板非空**（用真实 registry 全量扫描 + 人造退化 Def）', () => {
    // ① 全量扫描：registry 里**每一件** functional 的可用池恒为超集的子集，且恒含地板项。
    //    ⇒ 「过滤会引入新词条」在结构上不可能；「过滤会把池清空」在结构上不可能。
    let scanned = 0;
    for (const id of registry.functionals.keys()) {
      const pool = genericGrowthPoolFor(id);
      scanned += 1;
      expect(pool, `${id}: 池必须是超集的子集`).toEqual(
        pool.filter((p) => (RUN_GENERIC_CHOICE_POOL as readonly string[]).includes(p)),
      );
      expect(pool, `${id}: 地板项恒在（玩家不可能卡在 CHOICE）`).toContain(FLOOR_ITEM);
      for (const p of pool) {
        expect(RUN_GENERIC_CHOICE_POOL, `${id}: ${p} 不是既有词条`).toContain(p);
      }
    }
    expect(scanned, 'registry 至少要有若干 functional 才谈得上全量扫描').toBeGreaterThan(10);

    // ② 解析不出基准武器 ⇒ 两项武器侧成长**一律不给**（无法证明有效就不提供）
    expect(genericGrowthPoolFor(null)).toEqual([FLOOR_ITEM]);
    expect(genericGrowthPoolFor('__not_a_real_def__')).toEqual([FLOOR_ITEM]);

    // ③ 人造退化 Def：把「真实 7 件今天到不了、但**将来一定会出现**」的格子逐格打一遍。
    // 人造 Def：只关心 `behavior` + `behaviorParams`（能力矩阵**只读这两个字段**），
    // 其余物理字段填最小合法值 —— 取证目标是「矩阵的判据本身」，不是把它装到车上跑。
    const fake = (behaviorParams: Record<string, number>, behavior = 'cannon'): FunctionalPartDef => ({
      id: 'truth-fake',
      name: 'truth-fake',
      category: 'weapon',
      mass: 1,
      energy: 0,
      collider: { shape: 'box', width: 10, height: 10, offset: { x: 0, y: 0 } },
      behavior,
      behaviorParams,
    });

    // (a) 既无伤害键也无节奏键 ⇒ 两项都选不动（池退化成地板，且**仍然非空**）
    const noKeys = fake({ mass: 5 });
    expect(genericGrowthApplies(noKeys, 'damageUp')).toBe(false);
    expect(genericGrowthApplies(noKeys, 'rateUp')).toBe(false);

    // (b) 只有节奏键 ⇒ 只有 rateUp 选得动（**纯减法**：damageUp 被拿掉，地板保留）
    const cadenceOnly = fake({ cooldownMs: 1000 });
    expect(genericGrowthApplies(cadenceOnly, 'damageUp')).toBe(false);
    expect(genericGrowthApplies(cadenceOnly, 'rateUp')).toBe(true);

    // (c) 伤害键为 0 ⇒ `0 × 1.25 = 0`，选了数字不变 ⇒ **无效**（不是「有键就算有效」）
    expect(genericGrowthApplies(fake({ projectileDamage: 0 }), 'damageUp')).toBe(false);

    // (d) 节奏键已在下限 1 ⇒ `max(1, round(1 × 0.75)) = 1`，选了数字不变 ⇒ **无效**
    expect(genericGrowthApplies(fake({ cooldownMs: 1 }), 'rateUp')).toBe(false);

    // (e) 极小的伤害键仍会**真的变大**（`round(2 × 1.25) = 3`）⇒ 有效（过滤不是「按阈值卡」）
    expect(genericGrowthApplies(fake({ projectileDamage: 2 }), 'damageUp')).toBe(true);

    // (f) `emergencyRepair` 不走这条判据（`affectsWeapon:false`）⇒ 上面任何一件都**照旧提供**它
    for (const d of [noKeys, cadenceOnly, fake({ projectileDamage: 0 }), fake({ cooldownMs: 1 })]) {
      expect(weaponOverlayMods([FLOOR_ITEM], d.id).length, '紧急维修不改武器').toBe(0);
    }

    // ④ ⚠️ **最关键的一段：打「池本体」，不只是打单格判据。**
    //    真实 7 件今天都「全部有效」⇒ 退化格子只能用人造 Def 打。若哪天有人把过滤
    //    「放宽」成无条件返回超集（或把它从取池路径上摘掉），下面这几行会立刻红。
    expect(genericGrowthPoolForDef(undefined), '解析不出基准武器 ⇒ 只留地板').toEqual([FLOOR_ITEM]);
    expect(genericGrowthPoolForDef(noKeys), '两项都选不动 ⇒ 池退化成地板（且**仍然非空**）').toEqual([FLOOR_ITEM]);
    expect(genericGrowthPoolForDef(cadenceOnly), '只有节奏键 ⇒ 只剩 rateUp + 地板').toEqual([
      'rateUp',
      FLOOR_ITEM,
    ]);
    expect(genericGrowthPoolForDef(fake({ projectileDamage: 0 })), '伤害键为 0 ⇒ 伤害提升被拿掉').toEqual([
      FLOOR_ITEM,
    ]);
    expect(genericGrowthPoolForDef(fake({ cooldownMs: 1 })), '节奏键已在下限 ⇒ 攻击加快被拿掉').toEqual([
      FLOOR_ITEM,
    ]);
    expect(
      genericGrowthPoolForDef(fake({ projectileDamage: 2, cooldownMs: 1000 })),
      '两个键都改得动 ⇒ 三项齐全',
    ).toEqual([...RUN_GENERIC_CHOICE_POOL]);

    // ⑤ 委托关系（口径只有一处）：`genericGrowthPoolFor(id)` 恒等于对它那件 def 的池本体
    for (const id of registry.functionals.keys()) {
      expect(genericGrowthPoolFor(id), `${id}: 查表口径必须与池本体一致`).toEqual(
        genericGrowthPoolForDef(registry.functionals.get(id)),
      );
    }
  });

  it('R9S-03 结构守卫：池内容**只**经能力矩阵产出（没有第二处取池的地方）', () => {
    const src = stripComments(readLab('runModifiers.ts'));

    // ① `runGenericChoiceDefs` 的 `baseWeaponDefId` **必传**（无缺省值）——
    //    给缺省值等于让调用点悄悄拿一个「对所有武器都成立」的假池。
    const at = src.indexOf('export function runGenericChoiceDefs(');
    expect(at, '找不到 runGenericChoiceDefs 的声明').toBeGreaterThan(-1);
    const decl = src.slice(at, at + 260).split('const out')[0]!;
    expect(decl.includes('='), `签名里不得出现默认值：${decl}`).toBe(false);

    // ② 它只经 `genericGrowthPoolFor` 取池（不直接遍历超集常量）
    expect(src).toContain('for (const id of genericGrowthPoolFor(baseWeaponDefId))');

    // ②b 口径只有一处：`genericGrowthPoolFor` 委托给纯函数 `genericGrowthPoolForDef`
    const pAt = src.indexOf('export function genericGrowthPoolForDef');
    expect(pAt, '找不到池本体 genericGrowthPoolForDef').toBeGreaterThan(-1);
    const poolFn = src.slice(src.indexOf('export function genericGrowthPoolFor('));
    expect(poolFn.slice(0, poolFn.indexOf('\n}')), '查表口径必须委托给池本体').toContain(
      'genericGrowthPoolForDef(',
    );

    // ③ 单格判据用的就是**运行时同一段派生**（不是另写一套规则）
    const gAt = src.indexOf('export function genericGrowthApplies');
    const gBody = src.slice(gAt, src.indexOf('\n}', gAt));
    expect(gBody, 'genericGrowthApplies 必须复用 genericGrowthParamsOf').toContain('genericGrowthParamsOf');

    // ④ 唯一生产调用点把**本局基准武器**传进去（口径 = 状态机自己读到的那个字段）
    const pageSrc = stripComments(readLab('runPageState.ts'));
    expect(pageSrc).toContain('runGenericChoiceDefs(owned, s.baseWeaponDefId)');
  });
});

/* ============================================ B. 两次 Build Choice 的真实池（零物理） */

interface ChoicePoolFact {
  readonly weaponDefId: string;
  readonly pool1: readonly string[];
  readonly pool2: readonly string[];
  readonly picked1: string;
  readonly repairBonusAfterPick: number;
  readonly carriedAfterPick: number | null;
}

const POOL_FACTS = new Map<string, ChoicePoolFact>();

/**
 * 走**真实状态机**（不跑物理：战斗按「胜、剩 800 耐久」记账），读出这台武器在
 * `d2-choice1` / `d3-choice2` 上**真的画出来的**候选池。
 */
function choicePoolsOf(weaponDefId: string): ChoicePoolFact {
  const hit = POOL_FACTS.get(weaponDefId);
  if (hit) return hit;

  const ctx = ctxFor(weaponDefId, `pools-${weaponDefId}`);
  let s: RunPageState = createRunPageState(ctx);

  const advanceToChoice = (state: RunPageState): RunPageState => {
    let cur = state;
    for (let guard = 0; guard < 20; guard++) {
      if (cur.phase === 'CHOICE' || cur.phase === 'COMPLETE' || cur.phase === 'FAILED') return cur;
      if (cur.phase === 'BATTLE') {
        cur = finishRunBattle(cur, {
          winner: 'A',
          endReason: 'hp',
          playerHp: 800,
          enemyHp: 0,
          steps: 600,
        });
        continue;
      }
      cur = pressRunAction(cur, ctx);
    }
    return cur;
  };

  const atChoice1 = advanceToChoice(s);
  expect(atChoice1.phase, `${weaponDefId}: 第 1 个 CHOICE 之前就结束了`).toBe('CHOICE');
  expect(runCurrentNode(atChoice1).id).toBe('d2-choice1');
  const pool1 = runChoicePool(atChoice1).map((o) => o.id as string);
  const picked1 = pool1[0]!;
  const picked = chooseRunBuff(atChoice1, picked1, ctx);
  expect(runBuildIds(picked), '第 1 次选择必须真的落地（不在池里会是 no-op）').toEqual([picked1]);
  const repairBonusAfterPick = picked.repairBonus;
  const carriedAfterPick = runCarriedPlayerHp(picked);

  const atChoice2 = advanceToChoice(picked);
  expect(atChoice2.phase, `${weaponDefId}: 第 2 个 CHOICE 之前就结束了`).toBe('CHOICE');
  expect(runCurrentNode(atChoice2).id).toBe('d3-choice2');
  const pool2 = runChoicePool(atChoice2).map((o) => o.id as string);

  const fact: ChoicePoolFact = {
    weaponDefId,
    pool1,
    pool2,
    picked1,
    repairBonusAfterPick,
    carriedAfterPick,
  };
  POOL_FACTS.set(weaponDefId, fact);
  return fact;
}

describe('PRODUCT-LOOP-R9-BUILD-CHOICE-CONTENT-SANITY｜B. 两次可用池（状态机真实读数）', () => {
  it('R9S-04 逐件输出：Weapon → 第一次可用池 → 第二次可用池，逐项都过能力矩阵', () => {
    for (const id of ALL) {
      const f = choicePoolsOf(id);
      const def = defOf(id);
      const isGeneric = id !== RUN_BASE_WEAPON_DEF_ID;

      // ① 两个池都**非空** ⇒ 任何武器在任何一个 CHOICE 上都不会卡住
      expect(f.pool1.length, `${id} 第 1 次池为空`).toBeGreaterThan(0);
      expect(f.pool2.length, `${id} 第 2 次池为空`).toBeGreaterThan(0);

      // ② 第一次选的就是池里真实存在的那一项（不是被硬塞的）
      expect(f.pool1[0]).toBe(f.picked1);

      if (isGeneric) {
        // ②′ 通用池两族是**同一个平铺三项池**（两个节点同池）⇒ 第二次 = 第一次 − 已拥有项
        //     （**不重复提供**同一个；也不会提供已无意义的同一项）
        expect(f.pool2, `${id}: 通用池的第二次 = 第一次 − 已选`).toEqual(
          f.pool1.filter((p) => p !== f.picked1),
        );
        // ── 非 Cannon：通用池族 ────────────────────────────────────────────
        // 池恒为既有词条的**子集**（不新增词条），且不含 Cannon 项（两支互斥）
        for (const p of [...f.pool1, ...f.pool2]) {
          expect(RUN_GENERIC_CHOICE_POOL, `${id}: ${p} 不是既有通用词条`).toContain(p);
          expect(RUN_LAYER1_POOL as readonly string[], `${id}: ${p} 是 Cannon 项`).not.toContain(p);
        }
        // **每一个可出现词条都真的有效** —— 逐项过能力矩阵（这是本 Queue 的验收本体）
        for (const p of f.pool1) {
          if (!isGenericGrowth(p)) continue;
          expect(genericGrowthApplies(def, p), `${id} 的池里画了 ${p}，但它对这件武器无效果`).toBe(true);
        }
        // 池 = 能力矩阵过滤结果（不是超集的直接复制 —— 二者今天相等，但前者才是定义）
        expect(f.pool1, `${id}: 池必须等于能力矩阵过滤结果`).toEqual([...genericGrowthPoolFor(id)]);
      } else {
        // ── Cannon：**自己那三池，一字未动**（第二次是**条件池**，不是「第一次减已选」）────
        expect(f.pool1, 'Cannon 第 1 次 = 冻结的第一层池').toEqual([...RUN_LAYER1_POOL]);
        expect(f.pool2, 'Cannon 第 2 次 = 第一层选择决定的条件池 − 已选').toEqual(
          (RUN_LAYER2_POOLS as Readonly<Record<string, readonly string[]>>)[f.picked1]!.filter((p) => p !== f.picked1),
        );
        for (const p of [...f.pool1, ...f.pool2]) {
          // ⚠️ 只禁**两条通用成长**：`emergencyRepair` 是 PRP-BUILD-01 起的共享内容，
          //    它本来就同时属于 Cannon 的第二层池（`RUN_LAYER2_POOLS` 的安全通用项）。
          expect(RUN_GENERIC_GROWTH_IDS as readonly string[], `Cannon 局不得出现通用成长 ${p}`).not.toContain(p);
        }
      }
    }
  });

  it('R9S-05 `emergencyRepair` 真的作用于玩家耐久（两族逐件，且**不改武器**）', () => {
    // 结构面：它不在任何武器的 overlay 里（`affectsWeapon:false`）⇒ 选它不会碰武器 def
    for (const id of ALL) {
      expect(weaponOverlayMods([FLOOR_ITEM], id), `${id}: 紧急维修不该进武器 overlay`).toEqual([]);
    }

    // 真实状态机面：选它 ⇒ `repairBonus` 真的按 `round(上限 × 0.25)` 增加，
    // 且 `runCarriedPlayerHp`（宿主带给下一场的耐久，与 `runPage.beginBattle` 同口径）等量上升。
    // ⚠️ 两族进入「能选到它」的节点不同：非 Cannon 在第 1 次就有；Cannon 的它在**第 2 次**
    //    （`RUN_LAYER2_POOLS.heavyShell`）⇒ 这里不假设节点，按池自己有没有它来推进。
    for (const id of ALL) {
      const ctx = ctxFor(id, `repair-${id}`);
      let s = createRunPageState(ctx);
      let picked: string | null = null;

      for (let guard = 0; guard < 40; guard++) {
        if (s.phase === 'COMPLETE' || s.phase === 'FAILED') break;
        if (s.phase === 'CHOICE') {
          const pool = runChoicePool(s).map((o) => o.id as string);
          if (pool.includes(FLOOR_ITEM)) break;
          picked = pool[0]!;
          s = chooseRunBuff(s, picked, ctx);
          continue;
        }
        s = s.phase === 'BATTLE'
          ? finishRunBattle(s, { winner: 'A', endReason: 'hp', playerHp: 800, enemyHp: 0, steps: 600 })
          : pressRunAction(s, ctx);
      }

      expect(s.phase, `${id}: 没能停在一个含紧急维修的 CHOICE 上`).toBe('CHOICE');
      expect(runChoicePool(s).some((o) => o.id === FLOOR_ITEM), `${id}: 池里没有紧急维修`).toBe(true);

      const before = { bonus: s.repairBonus, carried: runCarriedPlayerHp(s) };
      const hpMax = s.battle!.playerHpMax;
      const after = chooseRunBuff(s, FLOOR_ITEM, ctx);
      const expected = Math.round(hpMax * EMERGENCY_REPAIR_FRACTION);

      expect(after.repairBonus, `${id}: 紧急维修必须真的记账`).toBe(before.bonus + expected);
      expect(expected, '维修量必须是一个真实的非零量').toBeGreaterThan(0);
      expect(runCarriedPlayerHp(after)! - before.carried!, `${id}: 结算给下一场的耐久必须等量上升`).toBe(expected);

      // 与武器无关：**加入这一项本身**不会改变本局武器（与不含它时逐字段相同）。
      // ⚠️ 注意口径：这里比的是「含它 vs 不含它」，**不是**「整个 Build 不改武器」——
      //    cannon 局里前面选的 `heavyShell` 本来就要改武器（那是 Cannon 自己的内容），
      //    混在一起断言会把「紧急维修不改武器」这条讲成一句不成立的话。
      expect(
        composeRunWeaponDef(defOf(id), runBuildIds(after), id),
        `${id}: 紧急维修不该改变本局武器`,
      ).toEqual(composeRunWeaponDef(defOf(id), runBuildIds(s), id));
    }
  });
});


/* =================================================== C. 真实 Runtime 效果（真物理） */

interface CombatFact {
  /** 本场玩家武器的逐发真实伤害。 */
  readonly perHit: readonly number[];
  readonly hits: number;
  /** **原始事件步号**（弹丸类 = 弹丸出生；接触类 = 命中事件）。一次攻击可能含多段。 */
  readonly rawSteps: readonly number[];
  /** **攻击轮次起始**步号（`rawSteps` 按 `CYCLE_GAP_STEPS` 聚簇后的结果）。 */
  readonly attackSteps: readonly number[];
  readonly steps: number;
  readonly result: 'A' | 'B' | null;
}

const COMBAT_CACHE = new Map<string, CombatFact>();

/** 弹丸类武器：攻击事件 = 玩家侧新弹丸出生。 */
const PROJECTILE_WEAPONS = new Set(['cannon', 'flamethrower', 'laser', 'machineGun', 'shotgun']);

/**
 * 聚簇门槛（步）：把「**同一次攻击**内的多段事件」并成一轮攻击。
 *
 * ⚠️ 门槛不是拍的，两端都由**本轮实测**定：
 *   - **上界**（一轮攻击内部的**最大跨度**）= `machineGun` 的一次攻击 = **7 连发**
 *     × `burstIntervalMs = 100ms`（6 步）= **36 步**（实测 raw `[1,7,13,19,25,31,37]`）；
 *     喷火器的连续颗粒、锤/撞车的同一次挥击多段命中也都在这个量级以下。
 *   - **下界**（两轮攻击之间的**最小**间隔）= 实测最小值 = `shotgun` 带 `rateUp` 的 **59 步**
 *     （`plainCycles [1,79,157]` → `fastCycles [1,60,119,178]`）。
 *   ⇒ 取两者中间的 **48 步**（≈0.8s），离两端都留 11~12 步余量。
 *   ⚠️ 用 20 步会**错误地**把 `machineGun` 的一轮 7 连发切成两轮（本轮踩过：第 2 轮读数
 *      变成 `25→25` 而真实是 `103→87`）。
 */
const CYCLE_GAP_STEPS = 48;

/** 把原始事件步号聚簇成攻击轮次（同一轮内间隔 ≤ 门槛 ⇒ 并入上一轮）。 */
function clusterCycles(raw: readonly number[]): number[] {
  const out: number[] = [];
  for (const st of raw) {
    const last = out[out.length - 1];
    if (last === undefined || st - last > CYCLE_GAP_STEPS) out.push(st);
  }
  return out;
}

/**
 * 跑一场**真实**战斗（真物理 / 真时间步 / 与宿主同口径 `playerBaseline:true`），
 * 并顺手记录「新一次攻击开始的真实步号」。
 *
 * 口径（为什么分两类）：
 *   - 弹丸类（`PROJECTILE_WEAPONS`）⇒ `playerProjectileCount()` 的**增量**，
 *     这是武器**内部**的开火事实，不受「对手有没有被打退」影响 ⇒ 无混淆；
 *   - 接触类（`hammer` / `rammer`）⇒ 它们**不产生弹丸**，攻击由接触触发，
 *     唯一可观察的既有只读端口是 `playerWeaponHitSummary()` 的命中计数增量。
 *     （本轮实测：`hammer` 第 2 次命中 121 → 116 步、`rammer` 第 2 次命中严格更早。）
 */
function combat(weaponDefId: string, build: readonly RunBuildId[]): CombatFact {
  const key = `${weaponDefId}|${build.join('+')}`;
  const hit = COMBAT_CACHE.get(key);
  if (hit) return hit;

  const rt = new RunBattleRuntime({
    build,
    carriedHp: null,
    encounterId: SEG1,
    playerDraft: onlyDraft(weaponDefId),
    playerLoadoutTag: PRODUCT_TAG,
    // 与 `runPage.beginBattle()` **同口径**（那边恒传 true）。
    playerBaseline: true,
  });
  try {
    const useProjectiles = PROJECTILE_WEAPONS.has(weaponDefId);
    const rawSteps: number[] = [];
    let prevProj = rt.playerProjectileCount();
    let prevHits = 0;
    let steps = 0;
    while (rt.result === null && steps < MAX_FRAMES) {
      rt.step(FRAME_MS);
      steps += 1;
      if (useProjectiles) {
        const now = rt.playerProjectileCount();
        for (let k = prevProj; k < now; k++) rawSteps.push(steps);
        prevProj = now;
      } else {
        let now = 0;
        for (const read of Object.values(rt.playerWeaponHitSummary())) now += read.count;
        for (let k = prevHits; k < now; k++) rawSteps.push(steps);
        prevHits = now;
      }
    }
    const perHit: number[] = [];
    for (const read of Object.values(rt.playerWeaponHitSummary())) perHit.push(...read.damages);
    const fact: CombatFact = {
      perHit,
      hits: perHit.length,
      rawSteps,
      attackSteps: clusterCycles(rawSteps),
      steps,
      result: rt.result?.winner ?? null,
    };
    COMBAT_CACHE.set(key, fact);
    return fact;
  } finally {
    rt.dispose();
  }
}

describe('PRODUCT-LOOP-R9-BUILD-CHOICE-CONTENT-SANITY｜C. 真实 Runtime 效果', () => {
  it('R9S-06 `damageUp`：6 件非 Cannon 逐件真战斗，**逐发伤害真的变大**', () => {
    for (const id of NON_CANNON) {
      const plain = combat(id, []);
      const up = combat(id, ['damageUp']);

      // 夹具充分性：这一场真的打中了（否则「伤害变了」无从谈起）
      expect(plain.hits, `${id}: 本场零命中 ⇒ 结论无效`).toBeGreaterThan(0);
      expect(up.hits, `${id}: 本场零命中 ⇒ 结论无效`).toBeGreaterThan(0);

      // ① 逐发伤害真的变大（同一件武器 ⇒ 每一发同为合成后的那一个值）
      const plainDmg = Math.max(...plain.perHit);
      const upDmg = Math.max(...up.perHit);
      expect(upDmg, `${id}: 选了伤害提升，逐发伤害却没变大`).toBeGreaterThan(plainDmg);

      // ② 与合成后的 def 逐字一致（不是「看起来变大」）
      const composed = composeRunWeaponDef(defOf(id), ['damageUp'], id);
      expect(Object.values(composed.behaviorParams ?? {}), `${id}: 战斗中用的伤害 = 合成后的伤害`).toContain(upDmg);

      // ③ 只改伤害、**不改节奏**：本场攻击次数上限不增加
      expect(up.attackSteps.length, `${id}: 伤害提升不该让攻击次数变多`).toBeLessThanOrEqual(
        plain.attackSteps.length,
      );

      // ④ Cannon 侧对照（不是「忘了跑」）：通用成长对它**零适用**，合成后逐字段等于 canonical
      expect(
        composeRunWeaponDef(defOf(RUN_BASE_WEAPON_DEF_ID), ['damageUp'], RUN_BASE_WEAPON_DEF_ID),
        'Cannon 的通用成长必须零效果（保持原逻辑）',
      ).toEqual(defOf(RUN_BASE_WEAPON_DEF_ID));
    }
  }, SLOW_MS);

  it('R9S-07 `rateUp`：6 件非 Cannon 逐件真战斗，**下一次攻击真的更早发生**', () => {
    // ① 先取**全部**读数并打表 —— 断言在下一段，这样任何一件失败时也能看到全部原始数据。
    const table: Record<string, string> = {};
    for (const id of NON_CANNON) {
      const plain = combat(id, []);
      const fast = combat(id, ['rateUp']);
      table[id] =
        `轮次 ${plain.attackSteps.length}→${fast.attackSteps.length} / ` +
        `第2轮 ${plain.attackSteps[1] ?? '（无）'}→${fast.attackSteps[1] ?? '（无）'} / ` +
        `原始事件 ${plain.rawSteps.length}→${fast.rawSteps.length} / ` +
        `逐发伤害 ${JSON.stringify([...new Set(plain.perHit)])}→${JSON.stringify([...new Set(fast.perHit)])}`;
      console.log(
        `[R9S-07 ${id}] ${table[id]}` +
          `\n    plainCycles=${JSON.stringify(plain.attackSteps.slice(0, 6))}` +
          `\n    fastCycles =${JSON.stringify(fast.attackSteps.slice(0, 6))}` +
          `\n    plainRaw   =${JSON.stringify(plain.rawSteps.slice(0, 10))}` +
          `\n    fastRaw    =${JSON.stringify(fast.rawSteps.slice(0, 10))}`,
      );
    }

    // ② 再逐件断言
    for (const id of NON_CANNON) {
      const plain = combat(id, []);
      const fast = combat(id, ['rateUp']);
      const P = plain.attackSteps;
      const F = fast.attackSteps;

      // 夹具充分性：**加快后**那一场必须观察到 ≥2 次攻击（否则「下一次更早」无从谈起）
      expect(F.length, `${id}: 加快后本场只观察到 ${F.length} 次攻击 ⇒ 夹具失效`).toBeGreaterThanOrEqual(2);

      if (P.length >= 2) {
        // ① 主判据：第 2 次攻击真的更早（真实节奏被 Runtime 消费的直接读数）
        expect(
          F[1]!,
          `${id}: 选了攻击加快，第 2 次攻击并没有更早（plain=${P[1]} fast=${F[1]}）`,
        ).toBeLessThan(P[1]!);
      } else {
        // ② 原速那一场整场只打了一次 ⇒ 「节奏更快」直接表现为**多出一次攻击**
        //    （本轮实测 `laser` 即此形态：plain 第 2 发从未发生）
        expect(
          F.length,
          `${id}: 原速只打了 ${P.length} 次、加快后也只有 ${F.length} 次 ⇒ 节奏没被消费`,
        ).toBeGreaterThan(P.length);
      }

      // ③ 只改节奏：**逐发伤害一字不变**
      expect(new Set(fast.perHit), `${id}: 攻击加快不该改变逐发伤害`).toEqual(new Set(plain.perHit));

      // ④ 合成后的 def 真的带了节奏键（不是「只在文档里」）
      const composed = composeRunWeaponDef(defOf(id), ['rateUp'], id);
      const cad = weaponCadenceGrowth(defOf(id))!;
      expect(composed.behaviorParams?.[cad.key], `${id}: 本局 def 的节奏键必须已生效`).toBeDefined();
      expect(composed.behaviorParams?.[cad.key], `${id}: 节奏键必须真的变小`).toBeLessThan(cad.base);
    }
  }, SLOW_MS);

  it('R9S-08 `behavior` 零污染：两条通用成长叠加也不改 behavior、只动它自己那两个键', () => {
    for (const id of NON_CANNON) {
      const def = defOf(id);
      const both = composeRunWeaponDef(def, ['damageUp', 'rateUp'], id);
      expect(both.behavior, `${id}: 通用成长改了 behavior`).toBe(def.behavior);
      expect(both.id).toBe(def.id);
      expect(both.category).toBe(def.category);

      // 被改的字段**只可能**是「该武器自己的伤害键」与「该武器自己的节奏键」
      const dmgKey = weaponDamageParamKey(def)!;
      const cadKey = weaponCadenceGrowth(def)!.key;
      const changed = Object.keys(both.behaviorParams ?? {}).filter(
        (k) =>
          (both.behaviorParams as Record<string, unknown>)[k] !==
          (def.behaviorParams as Record<string, unknown>)[k],
      );
      expect(changed.length, `${id}: 通用成长改的字段数`).toBeLessThanOrEqual(2);
      for (const k of changed) {
        expect([dmgKey, cadKey], `${id}: 被改的字段 "${k}" 既不是伤害键(${dmgKey})也不是节奏键(${cadKey})`).toContain(k);
      }
      // 伤害键与节奏键**确实都被改到了**（否则上面那条 `<=2` 会在「一个都没改」时假绿）
      expect(changed.sort()).toEqual([dmgKey, cadKey].sort());
      // 除这两个键外，其余字段逐字段保留 canonical
      for (const k of Object.keys(def.behaviorParams ?? {})) {
        if (k === dmgKey || k === cadKey) continue;
        expect((both.behaviorParams as Record<string, unknown>)[k], `${id}: ${k} 不该被通用成长改动`).toBe(
          (def.behaviorParams as Record<string, unknown>)[k],
        );
      }
    }
  });
});
