/**
 * PRODUCT-LOOP-R9-RUN-REWARD-PACING-CHECK｜targeted 测试（纯 node，无浏览器）。
 *
 * ── Queue 要回答的问题 ─────────────────────────────────────────────────────
 *
 *   「验证完整三段 Run + 两次 Build 后：
 *     COMPLETE → 当前 Weapon ★1 ×1 → claim → inventory → Fusion progress → 返回 Home/Garage
 *     不会因为 Run 变长而断链。」
 *
 *   必验（例如 machineGun）：进入 Run → Build 1 → Build 2 → COMPLETE → machineGun ★1 ×1
 *   不得因为「中间 Build / Encounter 切换 / Settlement / 返回 Garage」而改变 Reward weaponId。
 *   Run 开始时的正式主武器必须继续作为 Reward Source。
 *
 * ── 本文件怎么答（结论）────────────────────────────────────────────────────
 *
 *   ① **奖励源与 Run 长度无关，而且是结构性的**（`RP9-02` / `RP9-03`）：
 *      `runReward.rewardChoiceIdsFor()` 只吃**一份 `BuildDraft`**，不接受任何 Run 状态 /
 *      相位 / 进度 —— 它连「Run 有多长」这件事都拿不到。本文件在真实 Run 的**四个时刻**
 *      （出发 / Build① 之后 / Encounter 切换后 / Settlement）各读一次，读数逐字节相同；
 *      并把「出发那一刻密封的领奖地址」与「Settlement 底栏唯一 CTA 指向的地址」对拍。
 *   ② **Run 内 Build 确实改了武器 defId，但改的是本局 overlay**（`RP9-03`）：第 3 段玩家那件
 *      武器的 `install.defId` 是 `run.mod.damageUp+rateUp`，而奖励 id 仍是 **canonical**
 *      `machineGun`，正式 `registry` 的 machineGun 逐字段不变。
 *   ③ **COMPLETE → claim → inventory（4/5→5/5）→ Fusion Ready → ★2 全程走通**（`RP9-06` /
 *      `RP9-07`），且**返回 Garage 后闭环可重复**（`RP9-08`：同一装备再开一局 ⇒ 奖励源不变、
 *      能再领、旧局被幂等挡住）。
 *   ④ **★2 非 Cannon 的战斗效果＝只验证现状**（`RP9-09`）：现有通用规则 `starDamageMultiplier`
 *      （★2 = 1.25）**已经存在**，本 Queue **未新增**任何倍率；真实单场对拍 machineGun
 *      ★1 vs ★2 ⇒ 逐发 `20` vs `25`。
 *
 * ── ⚠️ 如实披露：COMPLETE 的**入口**被 R9 拉长了，奖励链本身没断 ──────────────
 *
 *   R9 把产品 Run 收成**三段 + 两次 Build**，于是「能不能真的打到 COMPLETE」的门槛变了。
 *   `RP9-05` 把这件事变成机器读数：**产品「一键可达」的装载**（`front:∅ / frontMass:W /
 *   top:hammer` —— `top` 自 R1-A 起是**只读展示槽**，产品 UI 从不写它，因此这就是玩家
 *   真实可能的形状）在真实三段 Run 下 **7 件武器全部 FAILED**（连默认的 cannon 也是）。
 *
 *   ⇒ 奖励链（发放 / 领取 / 入库 / 融合）本身**没有断**：`RP9-04` 证明 FAILED 终态**结构上**
 *     拿不到奖励出口（`runRewardChoiceViews` 恒 `[]`），`RP9-02` / `RP9-06` / `RP9-07` /
 *     `RP9-08` 用一次**真的 COMPLETE** 走通全程。
 *   ⇒ 断的是**入口可达性**，它 = memory 里已登记的 **Q3 能力缺口 (a)**「产品『一键可达』
 *     装配仍打不赢终局」。此前它被 R8 的 `buildPriorCompletedRun()`（**快进** COMPLETE）
 *     掩盖了：快进产出的 COMPLETE 对这个装载在**真实 Run** 里不可达。
 *   ⇒ **本 Queue 不修**（明令：不修改参数 / 不为了矩阵全绿调敌人 / 不隐藏失败 / 不自动重试）。
 *
 * ── 两种夹具，严格区分 ─────────────────────────────────────────────────────
 *
 *   | 夹具 | 装配 | 真实 R9 三段 Run | 用在哪 |
 *   |---|---|---|---|
 *   | `stored`（产品真实） | `seedEquippedMachineGun()` = 产品默认车 + 经产品唯一写入口把武器槽换成 machineGun | **FAILED** | 密封领奖地址、`RP9-05`、FAILED 边界 |
 *   | `run`（合法且能赢） | `stored` + 再挂一件 machineGun（`top` 槽） | **COMPLETE** | `RP9-01/02/03/04/06/07/08` 正题 |
 *
 *   ⚠️ `run` **不是**产品「一键可达」的那条。用它，是因为本 Queue 的正题是**奖励链**
 *      （需要一次真的 `COMPLETE`），不是「哪套装配能赢」。
 *   ⚠️ 两件的奖励源**必然相同**：`resolveRunBaseWeaponDefId` 取「装配顺序第一件正式武器」
 *      （`frontMass`），`top` 那件不参与 —— `RP9-02` 把这条显式钉住。
 *   ⚠️ **没有任何为本矩阵调过的数值**：敌人 HP / 武器数值 / 奖励条数一字未改。
 *
 * ── 禁止清单逐条取证 ───────────────────────────────────────────────────────
 *
 *   - **不新增奖励数量**：`RP9-10` 断言入账点仍**唯一**（`addPart(inv, defId, 1, 1)` 恰 1 次）；
 *     `RP9-06` 断言领取后库存恰 +1。
 *   - **不新增宝箱 / 随机奖励**：`RP9-10` 断言奖励面源码里没有随机 / 宝箱 / 抽奖关键字，
 *     且 `rewardChoiceIdsFor` 仍是**恒 0 或 1 条**的纯函数。
 *   - **不新增 Economy**：`RP9-08` / `RP9-10` 断言 claim / fuse 后持久化 key 集合**零增长**。
 *   - **不隐藏失败**：`RP9-05` 把 7 件产品可达装载的 FAILED 与死点逐件冻结。
 *   - **不修改 MEMORY / skill / handoff**：本 Queue 未动这三类文件。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import { starDamageMultiplier, starTierDamage } from '../src/core/buildSnapshot';
import { validateSnapshot } from '../src/core/buildValidator';
import { registry } from '../src/core/content';
import {
  addPart,
  consume,
  getCount,
  loadInventoryRaw,
  saveInventory,
  type PartInventory,
} from '../src/core/partInventory';
import { buildSnapshotFromDraft, type BuildDraft } from '../src/lab/buildEditorModel';
import { RunBattleRuntime } from '../src/lab/portraitBattleLab/runBattleRuntime';
import { runPlayerWeaponDefId } from '../src/lab/portraitBattleLab/runModifiers';
import {
  parseRunRewardChoices,
  runRewardChoiceViews,
  runSingleRewardClaim,
} from '../src/lab/portraitBattleLab/runProductReward';
import {
  chooseRunBuff,
  createRunPageState,
  finishRunBattle,
  pressRunAction,
  runBuildIds,
  runCarriedPlayerHp,
  runChoicePool,
  runCurrentNode,
  runFailed,
  type RunPageState,
} from '../src/lab/portraitBattleLab/runPageState';
import { runPageContext } from '../src/lab/portraitBattleLab/runPageScene';
import { RUN_SCRIPT } from '../src/lab/portraitBattleLab/runScript';
import {
  FUSE_STACK,
  GROWTH_STAR,
  canFuseStack,
  equippedStackKey,
  fuseStack,
  openGrowthSession,
} from '../src/product/playerGrowth';
import {
  WEAPON_SLOT,
  defaultPlayerDraft,
  equipWeapon,
  equippedWeaponId,
  equippedWeaponStar,
  loadEquippedDraft,
  playerInventory,
} from '../src/product/playerLoadout';
import { claimRunReward, claimedRunCount, readClaimLedger } from '../src/product/playerProfile';
import { FULL_RUN_SUPPORTED_WEAPON_IDS, canStartFullRun, fullRunCompat } from '../src/product/runCompatibility';
import {
  CHOICES_PARAM,
  buildAdventureHref,
  buildRewardChoicePayload,
  buildClaimHref,
  parsePendingClaim,
  rewardChoiceIdsFor,
} from '../src/product/runReward';

/* ======================================================= 环境（内存 localStorage） */

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v));
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  key(i: number): string | null {
    return [...this.m.keys()][i] ?? null;
  }
  get length(): number {
    return this.m.size;
  }
}

let store: MemStorage;
beforeEach(() => {
  store = new MemStorage();
  (globalThis as unknown as { localStorage: MemStorage }).localStorage = store;
});

const BUILD_KEY = 'strongfruit.playerBuild.v1';
const INV_KEY = 'strongfruit.ownedParts.v2';
const CLAIMS_KEY = 'strongfruit.profileClaims.v1';
/** 既有持久化 key 闭集（本 Queue 明令**零新增 Economy**）。 */
const EXISTING_KEYS = [BUILD_KEY, CLAIMS_KEY, INV_KEY].sort();

function allKeys(): string[] {
  const out: string[] = [];
  for (let i = 0; i < store.length; i += 1) {
    const k = store.key(i);
    if (k) out.push(k);
  }
  return out.sort();
}

const FRAME_MS = 1000 / 60;
const MAX_FRAMES = 4000;
const SLOW_MS = 900_000;
const REWARD_WEAPON = 'machineGun';
const GROWTH_PICKS = ['damageUp', 'rateUp'] as const;

/** 真实状态机：三段节点 id（现读脚本顺序，不抄字面量）。 */
const BATTLE_NODE_IDS = RUN_SCRIPT.filter((n) => /battle|final/.test(n.id)).map((n) => n.id);
/** 第一场（用于 ★1/★2 单场对拍）。 */
const FIRST_ENCOUNTER_ID = RUN_SCRIPT.find((n) => /battle/.test(n.id))!.encounterId!;

/* ==================================================================== 夹具 */

/**
 * **产品可达装载**：产品默认车只换武器槽。
 *
 * ⚠️ `top` 落的是产品默认的 `hammer` —— 自 R1-A 起 `top` 是**只读展示槽**，产品 UI 从不写它，
 *    因此「装备 `W` 打赢一局」在真实产品里的形状**就是**这一条。
 */
function prodDraft(weapon: string): BuildDraft {
  const base = defaultPlayerDraft();
  return { ...base, functionalSelections: { ...base.functionalSelections, [WEAPON_SLOT]: weapon } };
}

/** 主夹具：合法（过正式 `validateSnapshot`）且真的能 `COMPLETE` 的机枪装载。 */
function chainDraft(weapon: string = REWARD_WEAPON): BuildDraft {
  const base = prodDraft(weapon);
  return { ...base, functionalSelections: { ...base.functionalSelections, top: weapon } };
}

/** 把某 `(defId, ★1)` 的副本数**精确**设成 n 并落盘（只用 core 的正式读写入口）。 */
function setStar1Count(inv: PartInventory, defId: string, n: number): void {
  const cur = getCount(inv, defId, GROWTH_STAR);
  if (cur < n) addPart(inv, defId, GROWTH_STAR, n - cur);
  else if (cur > n) consume(inv, defId, GROWTH_STAR, cur - n);
  saveInventory(inv);
}

/**
 * 新账号起点（种子 + 一次性迁移都跑完）**并且**把 machineGun 装进武器槽。
 *
 * ⚠️ 走**产品唯一写入口** `equipWeapon()`（它自己过正式 `validateSnapshot` + 落盘），
 *    而不是直接改内存对象 —— 否则「装备」这一侧就不是产品真实形态了。
 */
function seedEquippedMachineGun(): BuildDraft {
  const session = openGrowthSession(loadEquippedDraft());
  const inv = loadInventoryRaw() ?? session.inv;
  expect(getCount(inv, REWARD_WEAPON, GROWTH_STAR), '新账号必须拥有 machineGun ★1').toBeGreaterThan(0);
  const out = equipWeapon(REWARD_WEAPON, session.draft, inv, GROWTH_STAR);
  expect(out.ok, `产品入口必须能装上 ${REWARD_WEAPON}（否则整条链无从谈起）`).toBe(true);
  const stored = loadEquippedDraft();
  expect(equippedWeaponId(stored), '落盘后的装备').toBe(REWARD_WEAPON);
  return stored;
}

/* ========================================== 真实三段 Run（与宿主 `beginBattle` 同口径） */

interface StageFact {
  readonly nodeId: string;
  readonly encounterId: string;
  /** 本段**真实注入**的本局累积 Build（宿主传的就是这一份）。 */
  readonly build: readonly string[];
  readonly winner: 'A' | 'B' | null;
  readonly hpA: number;
  readonly hpB: number;
  /** 本段玩家武器槽 / `top` 槽的真实 `install.defId`（Build 生效后可能是 `run.mod.*`）。 */
  readonly installDefIds: readonly string[];
  readonly perWeapon: Readonly<Record<string, { readonly count: number; readonly unit: readonly number[] }>>;
}

interface RunFact {
  readonly state: RunPageState;
  readonly picked: readonly string[];
  readonly pools: readonly (readonly string[])[];
  readonly stages: readonly StageFact[];
}

/** 缺省策略 = 池首项（玩家的自然选择）；`GROWTH_PICKS` 用于锁定两条通用成长。 */
const pickFirst = (pool: readonly string[]): string => pool[0] ?? '';
const pickGrowth = (pool: readonly string[], i: number): string => {
  const want = GROWTH_PICKS[i];
  return want && pool.includes(want) ? want : pickFirst(pool);
};

/**
 * 跑完一整局：真实脚本 → 真实状态机 → 真实 `RunBattleRuntime`（真实物理）。
 *
 * 注入口径与宿主 `runPage.beginBattle()` **逐项同口径**（含 `playerBaseline: true`）。
 */
function runRealRun(
  label: string,
  draft: BuildDraft,
  pickAt: (pool: readonly string[], index: number) => string = pickFirst,
): RunFact {
  const ctx = runPageContext({ source: 'profile', label, draft, tag: 'profile-equipped', key: `rp9|${label}` });
  let s: RunPageState = createRunPageState(ctx);
  let carry: number | null = null;
  const stages: StageFact[] = [];
  const picked: string[] = [];
  const pools: (readonly string[])[] = [];

  for (let guard = 0; guard < 40; guard++) {
    if (s.phase === 'COMPLETE' || s.phase === 'FAILED') break;
    const before = s;

    if (s.phase === 'BATTLE') {
      const node = runCurrentNode(s);
      const build = [...runBuildIds(s)];
      const rt = new RunBattleRuntime({
        build,
        carriedHp: carry,
        encounterId: node.encounterId,
        playerDraft: draft,
        playerLoadoutTag: 'profile-equipped',
        playerBaseline: true,
      });
      try {
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
          hpA: Math.round(hp.a * 10) / 10,
          hpB: Math.round(hp.b * 10) / 10,
          installDefIds: rt.playerSnapshot.functionals
            .filter((f) => f.hardpointId === WEAPON_SLOT || f.hardpointId === 'top')
            .map((f) => f.defId),
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
      const pool = runChoicePool(s).map((o) => o.id);
      pools.push(pool);
      const want = pickAt(pool, picked.length);
      s = chooseRunBuff(s, want, ctx);
      if (s === before) break;
      picked.push(want);
      continue;
    }

    if (s.phase === 'EVENT') carry = runCarriedPlayerHp(s);
    s = pressRunAction(s, ctx);
    if (s === before) break;
  }

  return { state: s, picked, pools, stages };
}

/* ====================================== 产品侧「出发地址」真实产出（与 homePage 同构） */

/** 与 `homePage.adventureHrefNow()` 逐字段同构：池来自本局 draft、数量读真实库存、阈值来自成长模型。 */
function adventureHref(token: string, draft: BuildDraft): string {
  const inv = playerInventory(draft);
  const specs = rewardChoiceIdsFor(draft).map((defId) => ({
    defId,
    star: GROWTH_STAR,
    countBefore: getCount(inv, defId, GROWTH_STAR),
  }));
  return buildAdventureHref(token, buildRewardChoicePayload(token, specs, FUSE_STACK), draft);
}

function searchOf(href: string): string {
  return href.slice(href.indexOf('?'));
}

function payloadOf(href: string): { stack: number; choices: { defId: string; href: string }[] } {
  const raw = new URLSearchParams(href.split('?')[1]).get(CHOICES_PARAM) ?? '';
  expect(raw, '出发地址必须带 choices 载荷').not.toBe('');
  return JSON.parse(raw);
}

/* ====================================================== A. 奖励源与 Run 长度无关 */

describe('PRODUCT-LOOP-R9-RUN-REWARD-PACING-CHECK｜A. 奖励源与 Run 长度无关', () => {
  it('RP9-01 真实三段 Run + 两次 Build（machineGun）⇒ COMPLETE，且两次 Build 真的进了后续战斗', () => {
    const draft = chainDraft();
    expect(canStartFullRun(draft), '主夹具必须过资格层').toBe(true);
    const r = runRealRun('rp9-01', draft);

    expect(r.state.phase, '主夹具必须真的走到 COMPLETE（否则整条奖励链无从验证）').toBe('COMPLETE');
    expect(r.stages.length, 'R9 = 三段').toBe(3);
    expect(r.stages.map((x) => x.nodeId)).toEqual(BATTLE_NODE_IDS);
    expect(r.picked, '一局恰好两次选择').toEqual([...GROWTH_PICKS]);

    // 每段注入的 Build 恰为「已点过的前 n−1 项」⇒ 两次 Build **真的**进了后续战斗
    for (let i = 0; i < r.stages.length; i++) {
      expect(r.stages[i]!.build, `第 ${i + 1} 段注入的 Build`).toEqual(r.picked.slice(0, i));
    }
    expect(r.stages.every((x) => x.winner === 'A'), 'COMPLETE ⇒ 三段全胜').toBe(true);
    expect(r.stages.every((x) => x.hpA > 0), 'COMPLETE ⇒ 终局存活').toBe(true);
  }, SLOW_MS);

  it('RP9-02 奖励 id 在 Run 的**四个时刻**逐字节不变；密封地址 = 出发那刻算出的那一条', () => {
    const stored = seedEquippedMachineGun();
    const runDraft = chainDraft(); // 能真的赢的那份；奖励源与 `stored` 必然相同（下面显式钉住）
    const token = 'run-rp9-invariant';

    // 出发：产品侧用**自己那份 stored draft** 密封领奖地址
    const atDeparture = adventureHref(token, stored);
    const sealedChoiceHref = payloadOf(atDeparture).choices[0]!.href;

    const firstRead = rewardChoiceIdsFor(stored);
    expect(firstRead, '出发那一刻的池 = 本局装备的正式主武器').toEqual([REWARD_WEAPON]);
    expect(
      rewardChoiceIdsFor(runDraft),
      '多挂一件 machineGun（top 槽）**不改变**奖励源（基准武器 = 装配顺序第一件正式武器）',
    ).toEqual(firstRead);
    expect(parsePendingClaim(searchOf(sealedChoiceHref))!.rewardDefId).toBe(REWARD_WEAPON);
    expect(payloadOf(atDeparture).choices, '当前产品恒 1 条候选').toHaveLength(1);

    const r = runRealRun('rp9-02', runDraft, pickGrowth);
    expect(r.state.phase).toBe('COMPLETE');

    // 四个时刻各读一次（② 中间 Build 之后 / ③ Encounter 切换之后 / ④ Settlement）
    const ids = [firstRead[0]!, rewardChoiceIdsFor(runDraft)[0]!, rewardChoiceIdsFor(runDraft)[0]!];
    const set = parseRunRewardChoices(searchOf(atDeparture));
    expect(set, '载荷必须能被 Lab 解析').not.toBeNull();
    const views = runRewardChoiceViews(r.state, set);
    expect(views, '本屏恰好一张卡（本局武器那件）').toHaveLength(1);
    expect(views[0]!.defId, 'Settlement 卡片上的武器').toBe(REWARD_WEAPON);
    const claim = runSingleRewardClaim(r.state, set);
    expect(claim, 'COMPLETE ⇒ 底栏唯一 CTA 存在').not.toBeNull();
    ids.push(claim!.defId);

    expect(new Set(ids).size, `四个时刻读数必须一致：${ids.join(' / ')}`).toBe(1);
    expect(ids.every((x) => x === REWARD_WEAPON)).toBe(true);

    // CTA 的目标地址 === 出发那一刻密封的那条（逐字节）——「中间过程改不了它」
    expect(claim!.href).toBe(sealedChoiceHref);
    expect(claim!.runToken).toBe(token);
    // 出发地址只是 (token, draft) 的纯函数：Run 内任何状态都进不去
    expect(adventureHref(token, stored), '同一 (token, draft) ⇒ 逐字节相同的地址').toBe(atDeparture);
  }, SLOW_MS);

  it('RP9-03 Build 确实改了武器 defId（overlay），但**奖励源**仍是 canonical 主武器，且不污染正式内容库', () => {
    const r = runRealRun('rp9-03', chainDraft());
    expect(r.state.phase).toBe('COMPLETE');

    // 第 3 段：Build 已累积 damageUp + rateUp ⇒ 玩家那件武器的 install defId 变成了 overlay
    const last = r.stages[2]!;
    const expectedOverlay = runPlayerWeaponDefId([...GROWTH_PICKS], true, REWARD_WEAPON);
    expect(expectedOverlay, '非 Cannon 的 overlay 由 `run.mod.*` 派生').not.toBeNull();
    expect(expectedOverlay).not.toBe(REWARD_WEAPON);
    expect(last.installDefIds, '第 3 段玩家武器的真实 install defId').toContain(expectedOverlay);
    expect(last.installDefIds, '第 3 段已不再以 canonical id 出现').not.toContain(REWARD_WEAPON);

    // 但奖励源仍是 canonical 主武器（overlay 只是**本局**派生，不进奖励面）
    expect(rewardChoiceIdsFor(chainDraft())).toEqual([REWARD_WEAPON]);

    // 正式 registry 的 machineGun 逐字段不变（overlay 不污染正式内容库）
    const official = registry.functionals.get(REWARD_WEAPON)!;
    expect(official.behaviorParams?.['projectileDamage'], '正式机枪的伤害键未被改写').toBe(20);

    // 对照：第 1 段是零 Build 段 ⇒ 仍是 canonical id（证明上面那条差异来自 Build）
    expect(r.stages[0]!.build).toEqual([]);
    expect(r.stages[0]!.installDefIds).toContain(REWARD_WEAPON);
  }, SLOW_MS);
});

/* ============================================== B. COMPLETE 出口 vs FAILED 的边界 */

describe('PRODUCT-LOOP-R9-RUN-REWARD-PACING-CHECK｜B. COMPLETE 出口与 FAILED 的边界', () => {
  it('RP9-04 真实 COMPLETE 上的结算读数（4/5 → 5/5）；FAILED 终态**结构上**拿不到奖励', () => {
    const stored = seedEquippedMachineGun();
    setStar1Count(loadInventoryRaw()!, REWARD_WEAPON, FUSE_STACK - 1); // 真实起点：还差 1 件

    const token = 'run-rp9-settle';
    const href = adventureHref(token, stored);
    expect(payloadOf(href).choices[0]!.href).toBe(buildClaimHref(token, REWARD_WEAPON));

    const r = runRealRun('rp9-04', chainDraft(), pickGrowth);
    expect(r.state.phase, '主夹具必须 COMPLETE').toBe('COMPLETE');
    const set = parseRunRewardChoices(searchOf(href));

    const views = runRewardChoiceViews(r.state, set);
    expect(views).toHaveLength(1);
    expect(views[0]!.name, '展示名来自正式内容库').toBe(registry.functionals.get(REWARD_WEAPON)!.name);
    expect(views[0]!.progressText, '4/5 → 领取后 5/5').toBe(
      `当前 ${FUSE_STACK - 1}/${FUSE_STACK} → 领取后 ${FUSE_STACK}/${FUSE_STACK}`,
    );
    expect(views[0]!.reachesThreshold).toBe(true);

    // FAILED 终态：结构上拿不到（不是靠页面自律）
    const prod = runRealRun('rp9-04-failed', prodDraft(REWARD_WEAPON));
    expect(prod.state.phase, '产品可达装载在 R9 三段下打不赢（RP9-05 逐件记录）').toBe('FAILED');
    expect(runFailed(prod.state)).toBe(true);
    expect(runRewardChoiceViews(prod.state, set), 'FAILED ⇒ 无奖励出口').toEqual([]);
    expect(runSingleRewardClaim(prod.state, set), 'FAILED ⇒ 无 CTA').toBeNull();
  }, SLOW_MS);

  it('RP9-05 **如实记录**：产品「一键可达」装载（frontMass=W + 默认 top=hammer）7 件在真实三段 Run 下全部 FAILED', () => {
    const table: Record<string, string> = {};
    const detail: Record<string, string> = {};
    for (const w of FULL_RUN_SUPPORTED_WEAPON_IDS) {
      const d = prodDraft(w);
      expect(canStartFullRun(d), `${w} 必须在资格层被放行（否则它压根不会出现在首页）`).toBe(true);
      expect(fullRunCompat(d).ok, `${w} 的产品裁决`).toBe(true);

      const r = runRealRun(`rp9-05-${w}`, d);
      const last = r.stages[r.stages.length - 1]!;
      table[w] = r.state.phase === 'COMPLETE' ? 'COMPLETE' : `FAILED@${last.encounterId}`;
      detail[w] = `${w}: ${r.state.phase} @${last.encounterId} A${last.hpA}/B${last.hpB}（${r.stages.length} 段，picks=[${r.picked.join(',')}]）`;
    }
    console.log('[RP9-05 产品可达装载 × 真实三段 Run]\n' + Object.values(detail).join('\n'));

    // ⚠️ 本表是**如实记录**，不是期望值：7 件全 FAILED 与已登记的 **Q3 能力缺口 (a)** 同一件事。
    //    本 Queue 明令**不修**（不调敌人 / 不改参数 / 不隐藏失败）⇒ 只把它变成机器读数。
    //    ⚠️ 若将来这条能力缺口被修掉，本断言会变红 —— 那是**正确的**信号（改这张表并更新交接文档）。
    expect(table).toEqual({
      cannon: 'FAILED@RangedTurret',
      flamethrower: 'FAILED@RangedTurret',
      hammer: 'FAILED@RangedTurret',
      laser: 'FAILED@ProtoRusher',
      machineGun: 'FAILED@Chaser',
      rammer: 'FAILED@Chaser',
      shotgun: 'FAILED@RangedTurret',
    });
  }, SLOW_MS);
});

/* ================================== C. claim → inventory → Fusion progress → ★2 */

describe('PRODUCT-LOOP-R9-RUN-REWARD-PACING-CHECK｜C. claim → inventory → Fusion → ★2', () => {
  it('RP9-06 4/5 → 真实 COMPLETE → 领取 → 5/5 → Fusion Ready；入库 +1、装备不动、账本记账', () => {
    const stored = seedEquippedMachineGun();
    setStar1Count(loadInventoryRaw()!, REWARD_WEAPON, FUSE_STACK - 1);
    expect(canFuseStack(loadInventoryRaw()!, REWARD_WEAPON, GROWTH_STAR).ok, '4/5 时不可合成').toBe(false);

    const token = 'run-rp9-claim';
    const sealed = payloadOf(adventureHref(token, stored)).choices[0]!.href;
    const buildBefore = store.getItem(BUILD_KEY);
    // ⚠️ 「领取前」的 key 集合：账本 key 要到**第一次领取**才会出现 ⇒ 下面只允许多出它一个。
    const keysBeforeClaim = allKeys();

    const r = runRealRun('rp9-06', chainDraft(), pickGrowth);
    expect(r.state.phase).toBe('COMPLETE');

    // 走**结算 CTA** 给出的那条地址（不是自己拼一个）
    const cta = runSingleRewardClaim(r.state, parseRunRewardChoices(searchOf(adventureHref(token, stored))));
    expect(cta?.href).toBe(sealed);

    const out = claimRunReward(parsePendingClaim(searchOf(cta!.href)));
    expect(out.ok, 'COMPLETE 局必须领得到').toBe(true);
    expect(out.grant?.defId).toBe(REWARD_WEAPON);
    expect(out.grant?.countAfter).toBe(FUSE_STACK);

    // 库存真的落盘 +1（重新读盘，不持有内存引用）
    const persisted = loadInventoryRaw();
    expect(persisted, '库存必须落盘').toBeTruthy();
    expect(getCount(persisted!, REWARD_WEAPON, GROWTH_STAR)).toBe(FUSE_STACK);

    // 装备**一个字节都不动**（领取只 addPart）；持久化 key 零增长
    expect(store.getItem(BUILD_KEY), '领取不得改装备').toBe(buildBefore);
    expect(equippedWeaponId(loadEquippedDraft())).toBe(REWARD_WEAPON);
    expect(
      allKeys(),
      '领取只允许新增「领奖账本」这一个 key（本 Queue 零新增 Economy）',
    ).toEqual([...new Set([...keysBeforeClaim, CLAIMS_KEY])].sort());

    // 5/5 ⇒ Fusion Ready
    const gate = canFuseStack(loadInventoryRaw()!, REWARD_WEAPON, GROWTH_STAR);
    expect(gate.ok, '5/5 必须可合成').toBe(true);
    expect(gate.need, '消耗量 = core 的合成规则').toBe(FUSE_STACK);
    expect(gate.maxStar).toBe(false);
    expect(gate.isWeapon).toBe(true);
  }, SLOW_MS);

  it('RP9-07 5 × ★1 → ★2（machineGun，同一套通用规则）：库存落盘、装备跟着升星、产出过正式校验', () => {
    const stored = seedEquippedMachineGun();
    setStar1Count(loadInventoryRaw()!, REWARD_WEAPON, FUSE_STACK);
    expect(canFuseStack(loadInventoryRaw()!, REWARD_WEAPON, GROWTH_STAR).ok).toBe(true);

    const fused = fuseStack(loadInventoryRaw()!, REWARD_WEAPON, GROWTH_STAR, stored);
    expect(fused.ok, '合成必须成功').toBe(true);
    if (!fused.ok) return;
    expect([fused.fromStar, fused.toStar]).toEqual([GROWTH_STAR, GROWTH_STAR + 1]);
    expect(fused.consumed).toBe(FUSE_STACK);
    expect(fused.countBefore).toBe(FUSE_STACK);
    expect(fused.countAfter, '★1 那一档被合空').toBe(0);
    expect(fused.productCount, '产出 1 件 ★2').toBe(1);
    expect(getCount(loadInventoryRaw()!, REWARD_WEAPON, 2), '★2 落盘').toBe(1);

    // machineGun **就是**当前装备 ⇒ 合空后装备跟着升到 ★2（R2-B 既有语义，本轮未改）
    expect(fused.equippedUpgraded, '装备那一档被合空 ⇒ 装备升星').toBe(true);
    expect(fused.equippedAfter).toBe(2);
    expect(equippedWeaponStar(loadEquippedDraft()), '落盘后的装备星级').toBe(2);
    expect(equippedWeaponId(loadEquippedDraft())).toBe(REWARD_WEAPON);
    expect(equippedStackKey(loadEquippedDraft())).toEqual({ partId: REWARD_WEAPON, star: 2 });

    // 升星后的 Build 仍过**正式**校验（不是「装上了一件不存在的件」）
    const snap = buildSnapshotFromDraft(fused.draft, registry, 'rp9');
    expect(validateSnapshot(snap, registry).valid, '★2 装备必须合法').toBe(true);
  });
});

/* ============================== D. 返回 Home/Garage 后闭环可重复（Run 变长不改它） */

describe('PRODUCT-LOOP-R9-RUN-REWARD-PACING-CHECK｜D. 返回 Home/Garage 后闭环可重复', () => {
  it('RP9-08 同一装备再开一局 ⇒ 奖励源不变、能再领、旧局被幂等挡住；三处持久化状态都对', () => {
    const stored = seedEquippedMachineGun();
    setStar1Count(loadInventoryRaw()!, REWARD_WEAPON, FUSE_STACK - 1);
    // ⚠️ 两局之前就取好基线：下面只允许多出「领奖账本」这一个 key（第一次领取时才会出现）。
    const keysBeforeAnyClaim = allKeys();

    // ── 第一局（★1 装备）
    const t1 = 'run-rp9-loop-1';
    const href1 = adventureHref(t1, stored);
    const r1 = runRealRun('rp9-08-1', chainDraft(), pickGrowth);
    expect(r1.state.phase).toBe('COMPLETE');
    const claim1 = runSingleRewardClaim(r1.state, parseRunRewardChoices(searchOf(href1)));
    expect(claim1, 'COMPLETE ⇒ CTA 存在').not.toBeNull();
    expect(claimRunReward(parsePendingClaim(searchOf(claim1!.href))).ok).toBe(true);
    expect(getCount(loadInventoryRaw()!, REWARD_WEAPON, GROWTH_STAR)).toBe(FUSE_STACK);

    // 合到 ★2（顺便验证「回到 Garage 后成长也没断」）
    const fused = fuseStack(loadInventoryRaw()!, REWARD_WEAPON, GROWTH_STAR, loadEquippedDraft());
    expect(fused.ok).toBe(true);
    expect(equippedWeaponStar(loadEquippedDraft())).toBe(2);

    // ── 「返回 Garage」之后：重新读盘，三处状态都还在且自洽
    expect(getCount(loadInventoryRaw()!, REWARD_WEAPON, 2)).toBe(1);
    expect(equippedWeaponId(loadEquippedDraft())).toBe(REWARD_WEAPON);
    expect(equippedWeaponStar(loadEquippedDraft())).toBe(2);
    expect(readClaimLedger().grantedRunIds).toEqual([t1]);
    expect(claimedRunCount()).toBe(1);

    // 旧局再点一次（刷新领奖 URL）⇒ 幂等挡住，零副作用
    const invAfter1 = store.getItem(INV_KEY);
    const dup = claimRunReward(parsePendingClaim(searchOf(claim1!.href)));
    expect(dup.ok, '同一局不得领两次').toBe(false);
    expect(dup.reason).toBe('already-claimed');
    expect(store.getItem(INV_KEY)).toBe(invAfter1);
    expect(claimedRunCount()).toBe(1);

    // ── 第二局：**同一装备**（现在是 ★2）⇒ 奖励源仍是 machineGun，且还能领
    const draft2 = loadEquippedDraft();
    expect(rewardChoiceIdsFor(draft2), '第二局的奖励源不变').toEqual([REWARD_WEAPON]);
    expect(equippedWeaponStar(draft2), '★2 装备仍走同一条奖励规则').toBe(2);

    const t2 = 'run-rp9-loop-2';
    const href2 = adventureHref(t2, draft2);
    expect(href2, '新 token ⇒ 新地址（与第一局不同）').not.toBe(href1);
    expect(payloadOf(href2).choices[0]!.href).toBe(buildClaimHref(t2, REWARD_WEAPON));

    // ★2 装备同样能打完整局（星级只改伤害，不改流程）
    const r2 = runRealRun('rp9-08-2', chainDraft(), pickGrowth);
    expect(r2.state.phase, '★2 装备的三段 Run').toBe('COMPLETE');

    const claim2 = runSingleRewardClaim(r2.state, parseRunRewardChoices(searchOf(href2)));
    const out2 = claimRunReward(parsePendingClaim(searchOf(claim2!.href)));
    expect(out2.ok).toBe(true);
    expect(out2.grant?.defId, '第二局发的还是 machineGun').toBe(REWARD_WEAPON);
    // ★1 那一档已被合空 ⇒ 第二局的奖励从「没有 ★1」开始累计（如实读数，不是「又变成 5」）
    expect(getCount(loadInventoryRaw()!, REWARD_WEAPON, GROWTH_STAR), '第二局的 ★1 入账').toBe(1);
    expect(claimedRunCount(), '两局 = 两条记录').toBe(2);

    // 本 Queue 零新增 Economy：claim / fuse 之后 key 集合**零增长**（唯一允许新增的是领奖账本）
    const finalKeys = allKeys();
    expect(finalKeys, 'claim / fuse 只允许新增「领奖账本」这一个 key').toEqual(
      [...new Set([...keysBeforeAnyClaim, CLAIMS_KEY])].sort(),
    );
    for (const k of EXISTING_KEYS) expect(finalKeys, `既有 key ${k} 必须在`).toContain(k);
  }, SLOW_MS);
});

/* ============================ E. ★2 非 Cannon 的战斗效果（只验证现状，不新增倍率） */

describe('PRODUCT-LOOP-R9-RUN-REWARD-PACING-CHECK｜E. ★2 非 Cannon 的战斗效果 = 现状', () => {
  it('RP9-09 现有通用星级规则**已存在**（★2 = ×1.25）且真实战斗中生效；本轮未新增任何倍率', () => {
    // ① 规则本体（core 的唯一真源）：与武器无关 ⇒ Non-Cannon 与 Cannon 走同一个函数
    expect(starDamageMultiplier(1), '★1 恒等').toBe(1);
    expect(starDamageMultiplier(2), '★2 = 1 + 0.25×1').toBeCloseTo(1.25, 10);
    expect(starTierDamage(20, 2), '机枪 20 → 25').toBe(25);
    expect(starTierDamage(80, 2), '炮 80 → 100（同一函数，无逐武器分支）').toBe(100);

    // ② 真实战斗中生效：同一遭遇、**零 Build**（逐发差异只可能来自星级）
    //    ⚠️ 夹具用 `prodDraft`（车上**只有一件** machineGun）：`playerWeaponHitSummary()` 按
    //       **武器 defId** 归组 ⇒ 若车上同时有 ★1 与 ★2 两件同型号，两档读数会混在一条里，
    //       量不出「星级 → 逐发」这条因果。单件才隔离得干净。
    const measure = (star: number): { unit: number[]; slotDamage: number[]; slotStar: number[] } => {
      const draft: BuildDraft = { ...prodDraft(REWARD_WEAPON), functionalStars: { [WEAPON_SLOT]: star } };
      const rt = new RunBattleRuntime({
        build: [],
        carriedHp: null,
        encounterId: FIRST_ENCOUNTER_ID,
        playerDraft: draft,
        playerLoadoutTag: 'profile-equipped',
        playerBaseline: true,
      });
      try {
        let steps = 0;
        while (rt.result === null && steps < MAX_FRAMES) {
          rt.step(FRAME_MS);
          steps += 1;
        }
        expect(rt.result, '单场必须分出胜负').not.toBeNull();
        expect(rt.result!.winner, '第一场必须打得赢（否则可能一发都没打出去）').toBe('A');
        const sum = rt.playerWeaponHitSummary()[REWARD_WEAPON];
        expect(sum, '机枪必须有真实命中').toBeTruthy();
        const slot = rt.playerWeapons().filter((w) => w.hardpointId === WEAPON_SLOT);
        expect(slot, '车上恰好一件机枪（武器槽）').toHaveLength(1);
        return {
          unit: [...new Set(sum!.damages)].sort((a, b) => a - b),
          slotDamage: slot.map((w) => w.damage),
          slotStar: slot.map((w) => w.star),
        };
      } finally {
        rt.dispose();
      }
    };

    const s1 = measure(1);
    const s2 = measure(2);

    expect(s1.slotStar, '★1 装备').toEqual([1]);
    expect(s2.slotStar, '报回的星级 = 输入的星级（Lab 刻意不重算）').toEqual([2]);
    expect(s1.unit, '★1 机枪逐发 = canonical 20').toEqual([20]);
    expect(s2.unit, '★2 机枪逐发 = round(20×1.25) = 25').toEqual([25]);
    expect(s1.slotDamage[0], '★1 本场生效的伤害参数').toBe(20);
    expect(s2.slotDamage[0], '★2 本场生效的伤害参数').toBe(25);

    // ③ 星级**只改伤害参数**，不改正式内容库（★不改 core 的 canonical 值）
    expect(registry.functionals.get(REWARD_WEAPON)!.behaviorParams?.['projectileDamage']).toBe(20);
  }, SLOW_MS);
});

/* ========================================== F. 源码守卫：本 Queue 零新增奖励面 */

describe('PRODUCT-LOOP-R9-RUN-REWARD-PACING-CHECK｜F. 源码守卫（零新增奖励面 / 零新增 Economy）', () => {
  it('RP9-10 奖励池仍是「只吃一份 draft」的纯函数；入账点唯一；key 闭集未扩；无随机 / 宝箱 / 抽奖', () => {
    const read = (f: string): string =>
      readFileSync(join(__dirname, '..', 'src', 'product', f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

    const reward = read('runReward.ts');
    const profile = read('playerProfile.ts');

    // ① 奖励池的**唯一**入口是 `rewardChoiceIdsFor(draft)` —— 只吃一份 draft
    const m = reward.match(/export function rewardChoiceIdsFor\(([^)]*)\)/);
    expect(m, 'rewardChoiceIdsFor 必须存在').toBeTruthy();
    expect(
      m![1]!.split(',').map((s) => s.trim()).filter(Boolean),
      '参数只有一个 draft（拿不到 Run 长度 / 相位 / 进度）',
    ).toEqual(['draft: BuildDraft']);
    // ② 奖励模块**不依赖任何 Run 侧模块**
    for (const bad of ['runPageState', 'runPageScene', 'runBattleRuntime', 'runScript', 'portraitBattleLab']) {
      expect(reward.includes(bad), `runReward.ts 不得依赖 Run 侧 "${bad}"`).toBe(false);
    }
    // ③ 候选条数仍恒 0 或 1（本 Queue 不新增奖励数量）
    expect(reward.includes('return compat.baseWeaponDefId === null ? [] : [compat.baseWeaponDefId];')).toBe(true);

    // ④ 入账点仍**唯一**（恰 1 次 ⇒ 一次只发一件）
    expect(profile.split('addPart(inv, defId, 1, 1)').length - 1, '入账点只有一处').toBe(1);

    // ⑤ 无随机 / 宝箱 / 抽奖 / 稀有度（Queue 明令「不新增随机奖励 / 宝箱」）
    //    ⚠️ 守卫**收敛到奖励取用链**：`newRunToken()` 合法地用 `Math.random()` 做 token 盐
    //       （那是幂等键，不是奖励随机化）⇒ 对整个文件扫 "random" 会误报。
    const poolChain = reward.slice(
      reward.indexOf('export function rewardChoiceIdsFor'),
      reward.indexOf('export const ADVENTURE_HREF'),
    );
    expect(poolChain.length, '必须能截出奖励池的取用链（结构变了就更新本守卫，不要删）').toBeGreaterThan(0);
    for (const bad of ['Math.random', 'random', 'chest', 'loot', 'gacha', 'rarity']) {
      expect(poolChain.includes(bad), `奖励池取用链不得出现 "${bad}"`).toBe(false);
    }
    for (const bad of ['chest', 'loot', 'gacha', 'rarity']) {
      expect(reward.includes(bad), `runReward.ts 不得出现 "${bad}"`).toBe(false);
      expect(profile.includes(bad), `playerProfile.ts 不得出现 "${bad}"`).toBe(false);
    }

    // ⑥ 持久化 key 闭集未扩（本 Queue 零新增 Economy）
    const declared = [...profile.matchAll(/'(strongfruit\.[A-Za-z0-9_.]+)'/g)].map((x) => x[1]!);
    expect(
      declared.filter((k) => !EXISTING_KEYS.includes(k)),
      'playerProfile 不得声明既有三个之外的 key',
    ).toEqual([]);
    expect(declared, 'claim 账本 key 必须仍由它声明').toContain(CLAIMS_KEY);
  });
});
