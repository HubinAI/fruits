/**
 * PRODUCT-LOOP-R6-BATCH-RUNTIME-COMPLETE-WEAPON-BATCH｜targeted strict test。
 *
 * ── 本 Queue 做的事 ────────────────────────────────────────────────────────
 * R6 建立了「Run base weapon = 玩家装备的那件武器」这条 Foundation 规则，并**一次性登记**了
 * 8 件武器。但那 8 件是靠**静态判据**选的（`getBehaviorFactory` 存在 + 480 步物理 smoke
 * 「跑得起来、不崩」）—— smoke **不检查武器有没有真的造成伤害**。
 *
 * 本 Queue 把判据升级为**真实链**，逐件沿
 *     canonical Def → behavior → factory → entity → attack → collision / projectile
 *     → damage → result
 * 实测复核，并据此把 `saw` 从登记表**收回**（它是唯一一件「Runtime 齐、但挂在产品主武器槽
 * 上完全打不到人」的武器）。结论写回 `src/product/runCompatibility.ts` 模块头的兼容矩阵。
 *
 * ── 覆盖（Queue 明文要求，每个**新登记** Weapon 至少覆盖 5 项）──────────────
 *   - Run parse        → R7-01（base = 它自己 / 装配未被改写 / 本局定义 = 官方 canonical）
 *   - Runtime entity   → R7-02（factory 存在 + 该件真的装进战斗 + 真的动起来）
 *   - Attack / Damage  → R7-03（真实 `damage` 事件，且**逐发伤害 = 它的 canonical 伤害**）
 *   - COMPLETE / FAILED→ R7-04 + R7-04b（4 场连锁每场都到终态；两条路线的终局**机器钉死**）
 *   - 返回后装备保持    → R7-05（结算领奖后装备不变 / 仍拥有 / 下一局 base 仍是它）
 *   - Cannon 全链不退化 → R7-09
 *   - 被拒武器保持被拒  → R7-06（saw）/ R7-07（spear）/ R7-08（精确差集）
 *
 * ── 实测兼容矩阵（本文件与 `runCompatibility.ts` 头部**同源**）──────────────
 *
 *   | Weapon | Runtime 完整 | Full Run | Block 原因 |
 *   |---|---|---|---|
 *   | cannon       | ✅ factory + projectile 链        | ✅ 登记 | — |
 *   | hammer       | ✅ hammerBehavior（Revolute 摆锤） | ✅ 登记 | — |
 *   | laser        | ✅ laserBehavior（蓄能 + 弹道）    | ✅ 登记 | — |
 *   | rammer       | ✅ rammerBehavior（Prismatic 伸出）| ✅ 登记 | — |
 *   | shotgun      | ✅ shotgunBehavior（5 发扇形）     | ✅ 登记 | — |
 *   | machineGun   | ✅ machineGunBehavior（burst 7 发）| ✅ 登记 | — |
 *   | flamethrower | ✅ flamethrowerBehavior（短命火流）| ✅ 登记 | — |
 *   | saw          | ⚠️ 齐（contactTick 链存在）        | ❌ **收回** | ④/⑤：产品槽 `frontMass` 上圆锯 collider 整体落在车身内（圆锯前沿 x=73 < 车身前沿 x=85）⇒ 实测 **0 命中 / 0 伤害**；挂 `front` 时同一份 Runtime 打出 25 命中 / 200 伤害 ⇒ 要生效必须改挂点或几何 = 新规则 |
 *   | spear        | ❌ `behavior === 'ram'` 无 factory | ❌ 保持 BLOCK | ③：Runtime 不存在（穷尽核对：`src/battle/` 下没有任何漏接的正式 ram behavior） |
 *
 * ── ⚠️ 两条「终局」路线，口径必须分清（R7-04b / R7-04c）──────────────────────
 *
 * 两路线都用**归因夹具**：车上**只留这一件**武器（`top` 槽的锤也清掉）⇒ 伤害只能来自它。
 * 这是刻意的 —— 产品默认车（`defaultPlayerDraft`）在 `top` 槽本来还挂着一把锤，
 * 那台车测的是「这一套装配」，不是「这件武器」。实测对照（cannon，同一份 Runtime）：
 *   只留它一件  → 下界 COMPLETE（终局 234.8）
 *   产品默认车  → 下界 **FAILED@BananaRodLaser**（第 4 场）；要两次维修才能 COMPLETE（36.3）
 * ⇒ 两种夹具回答**两个不同问题**，本文件只对前者下结论。
 *
 *   ① **下界**（R7-04b）= ★1 + **零 Build** + 跨场耐久**不修**。比真实路线严；
 *      它的用途是把「非 Cannon 拿不到任何伤害成长」这条留白变成**机器可见的事实**。
 *   ② **维修模型**（R7-04c）= 在 ① 之上施放 **DAY4「维修」+ DAY5 第二层「紧急维修」**
 *      两笔（都在第 3 场**之前**），维修量 = 正式 `EMERGENCY_REPAIR_FRACTION` × 上限、
 *      按缺口截断（与 `runPageState` 同一公式）。⚠️ 它是**模型**：真实状态机在 DAY4 选了
 *      维修就放弃当日的横向改装（本研究里对非 Cannon 本就无收益），DAY5 选了紧急维修就
 *      放弃一个武器向第二层强化。两处都**不写死 275** —— 现读正式常量与真实上限。
 *
 * ⚠️ 本文件**不写战斗数值常量**：所有断言读的都是正式 registry / 真实战斗事件 /
 *    本局解析后的真实 def。唯一的字面量表是「逐武器 canonical 主伤害」（R7-03）——
 *    它的用途正是在内容被改时**立刻报警**。
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getBehaviorFactory, registeredBehaviorIds } from '../src/battle/behaviorRegistry';
import { registry } from '../src/core/content';
import { OFFICIAL_PARTS, addPart, getCount, saveInventory } from '../src/core/partInventory';
import { EMPTY_SLOT, buildSnapshotFromDraft, type BuildDraft } from '../src/lab/buildEditorModel';
import { RunBattleRuntime } from '../src/lab/portraitBattleLab/runBattleRuntime';
import { runLoadoutCompatOfDraft } from '../src/lab/portraitBattleLab/runLoadoutCompat';
import {
  EMERGENCY_REPAIR_FRACTION,
  resolveRunBaseWeaponDefId,
} from '../src/lab/portraitBattleLab/runModifiers';
import { REWARD_CHOICE_IDS } from '../src/product/runReward';
import {
  FULL_RUN_SUPPORTED_WEAPON_IDS,
  fullRunCompat,
  supportsFullRun,
} from '../src/product/runCompatibility';
import { claimRunReward } from '../src/product/playerProfile';
import {
  WEAPON_GROWTH_STAR,
  WEAPON_SLOT,
  defaultPlayerDraft,
  equipWeapon,
  isWeaponDefId,
  loadEquippedDraft,
  playerInventory,
} from '../src/product/playerLoadout';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const BATTLE_DIR = join(REPO_ROOT, 'src', 'battle');

/* --------------------------------------------------------------- 夹具 */

/** Run Script 的四个 BATTLE / FINAL 节点用的正式 Encounter（顺序 = 真实局内顺序）。 */
const RUN_ENCOUNTERS = ['PineappleFireBrute', 'PineappleSawRusher', 'ProtoRusher', 'BananaRodLaser'] as const;

/** 本 Queue 新登记的非 Cannon 武器（= 登记表 − cannon）——**从真源现读**。 */
const REGISTERED_NON_CANNON: readonly string[] = FULL_RUN_SUPPORTED_WEAPON_IDS.filter(
  (id) => id !== 'cannon',
);

/**
 * 逐武器 canonical「一次命中扣多少血」。
 *
 * ⚠️ 刻意**写死**（而不是读一遍然后断言等于自己）：这样任何一次内容改动都会在这里炸出来。
 * ⚠️ `cannon` = **120** 而不是定义的 80：产品真实路径带 `playerBaseline: true`，
 *    玩家那门炮是本局 overlay 件（`PRODUCT_RUN_CANNON_BASE_DAMAGE`）；正式 `cannon` 键
 *    仍然是 80（敌方 `RangedTurret` 吃的那一份，R7-09 单独钉）。
 */
const CANONICAL_MAIN_DAMAGE: Readonly<Record<string, number>> = {
  cannon: 120,
  flamethrower: 8,
  hammer: 90,
  laser: 160,
  machineGun: 20,
  rammer: 70,
  shotgun: 30,
};

/** 玩家侧真实默认车 + 主武器槽换成指定武器（每份夹具都过正式 `validateSnapshot`）。 */
function equippedDraft(weaponDefId: string): BuildDraft {
  const base = defaultPlayerDraft();
  return {
    ...base,
    functionalSelections: { ...base.functionalSelections, [WEAPON_SLOT]: weaponDefId },
  };
}

/** 只留一件武器（把其它功能槽清空）——用于**归因**：车上没有第二件武器，伤害只能来自它。 */
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

/* ------------------------------------------------------- 真实战斗取证 */

interface HitReading {
  readonly count: number;
  readonly total: number;
  readonly damages: readonly number[];
}

interface BattleFact {
  readonly encounterId: string;
  readonly steps: number;
  readonly phase: string;
  readonly winner: string;
  readonly endReason: string;
  readonly hpA: number;
  readonly hpAMax: number;
  readonly hpB: number;
  /** 该场里**玩家方**各武器打出的真实伤害（按真实 `damage` 事件归组，partId = 本局 defId）。 */
  readonly hits: Readonly<Record<string, HitReading>>;
  /** 该场里是否观察到**玩家方**存活弹丸（entity → attack 的机器证据：真的动起来了）。 */
  readonly sawPlayerProjectile: boolean;
  /** 本场开局时主武器槽上那件武器的真实读数（defId / behavior / 一次命中伤害 / 星级）。 */
  readonly slotWeapon: {
    readonly defId: string;
    readonly behavior: string;
    readonly damage: number;
    readonly star: number;
  } | null;
}

/**
 * 跑**一场**真实战斗到终态（或步数上限）。
 *
 * `onlySlotWeapon` 为真 ⇒ 车上只留这一件武器（归因用，挂 `slot`）；否则 = 产品默认车。
 */
function runBattleToEnd(
  weaponDefId: string,
  encounterId: string,
  carriedHp: number | null,
  onlySlotWeapon = true,
  slot: string = WEAPON_SLOT,
): { fact: BattleFact; rtInfo: { runBaseWeaponDefId: string | null } } {
  const rt = new RunBattleRuntime({
    build: [],
    carriedHp,
    encounterId,
    playerDraft: onlySlotWeapon ? onlyDraft(weaponDefId, slot) : equippedDraft(weaponDefId),
    playerLoadoutTag: 'profile-equipped',
    playerBaseline: true, // 产品真实路径（`runPage.beginBattle` 就是这么传的）
  });
  try {
    let steps = 0;
    let sawPlayerProjectile = false;
    while (rt.result === null && steps < 4000) {
      rt.step(16);
      steps += 1;
      if (!sawPlayerProjectile && rt.playerProjectileCount() > 0) sawPlayerProjectile = true;
    }
    const hp = rt.hp();
    const summary = rt.playerWeaponHitSummary();
    const hits: Record<string, HitReading> = {};
    for (const [partId, read] of Object.entries(summary)) {
      hits[partId] = {
        count: read.count,
        total: read.damages.reduce((a, b) => a + b, 0),
        damages: [...read.damages],
      };
    }
    const slotWeapon = rt.playerWeapons().find((w) => w.hardpointId === slot);
    return {
      fact: {
        encounterId,
        steps,
        phase: rt.phase,
        winner: rt.result?.winner ?? '(none)',
        endReason: rt.result?.endReason ?? '(none)',
        hpA: hp.a,
        hpAMax: hp.aMax,
        hpB: hp.b,
        hits,
        sawPlayerProjectile,
        slotWeapon: slotWeapon
          ? {
              defId: slotWeapon.defId,
              behavior: slotWeapon.behavior,
              damage: slotWeapon.damage,
              star: slotWeapon.star,
            }
          : null,
      },
      rtInfo: { runBaseWeaponDefId: rt.runBaseWeaponDefId },
    };
  } finally {
    rt.dispose();
  }
}

interface ChainOutcome {
  readonly kind: 'COMPLETE' | 'FAILED';
  /** FAILED 时 = 在哪一场阵亡；COMPLETE 时 = `null`。 */
  readonly atEncounter: string | null;
  /** COMPLETE 时的终局耐久（FAILED 恒 0）。 */
  readonly finalHp: number;
  readonly battles: readonly BattleFact[];
}

/**
 * 走一条**完整 4 场连锁**（归因夹具 = 车上只留这一件武器，跨场带耐久）。
 *
 * `repair = false` ⇒ **下界**：★1 + 零 Build + 一次维修都不选。
 * `repair = true`  ⇒ **维修模型**：DAY4「维修」+ DAY5 第二层「紧急维修」各一次，
 *                     两笔都在第 3 场之前（`RUN_ENCOUNTERS[2]`），按缺口截断。
 */
function chainOf(weaponDefId: string, repair: boolean): ChainOutcome {
  let carried: number | null = null;
  let maxHp = 0;
  const battles: BattleFact[] = [];
  for (const [i, enc] of RUN_ENCOUNTERS.entries()) {
    if (repair && i === 2 && carried !== null) {
      const want = Math.round(maxHp * EMERGENCY_REPAIR_FRACTION);
      // 两笔独立施放：第二笔按**施放后**的缺口截断（与 `runPageState` 同一口径）。
      for (let k = 0; k < 2; k++) carried += Math.max(0, Math.min(want, maxHp - carried));
    }
    const { fact } = runBattleToEnd(weaponDefId, enc, carried);
    maxHp = fact.hpAMax;
    battles.push(fact);
    carried = fact.hpA;
    if (fact.hpA <= 0) return { kind: 'FAILED', atEncounter: enc, finalHp: 0, battles };
  }
  return { kind: 'COMPLETE', atEncounter: null, finalHp: carried ?? 0, battles };
}

interface WeaponFact {
  readonly defId: string;
  readonly behavior: string;
  readonly factoryExists: boolean;
  /** ① Run parse：本局解析出的基准武器（`resolveRunBaseWeaponDefId`）。 */
  readonly parsedBaseWeaponDefId: string | null;
  /** ① Run parse：**直接从 BuildSnapshot 解析**的基准武器（与上面那条同源，双路取证）。 */
  readonly parsedBaseFromSnapshot: string | null;
  /** ① Run parse：交给编排器的那份 snapshot 里主武器槽上的 defId（不得被改写）。 */
  readonly snapshotSlotDefId: string | null;
  /** ① Run parse：产品侧 `fullRunCompat` 的读数。 */
  readonly productOk: boolean;
  readonly productBaseWeaponDefId: string | null;
  /** ② Runtime entity：本局 registry 里那件是否 = 官方 canonical（逐字段）。 */
  readonly runRegistryDefIsCanonical: boolean;
  /** ③ Attack / Damage：4 场连锁（下界路线）的逐场读数。 */
  readonly battles: readonly BattleFact[];
  /** ④ COMPLETE / FAILED：**下界**路线的终局。 */
  readonly outcome: { readonly kind: 'COMPLETE' | 'FAILED'; readonly atEncounter: string | null; readonly finalHp: number };
  /** ④ COMPLETE / FAILED：**维修模型**路线的终局（见文件头两条路线说明）。 */
  readonly repairOutcome: {
    readonly kind: 'COMPLETE' | 'FAILED';
    readonly atEncounter: string | null;
    readonly finalHp: number;
  };
}

/** 逐武器跑一遍**两条**完整 4 场连锁 + 一次产品默认车的 Run parse 读数。 */
function collect(weaponDefId: string): WeaponFact {
  const def = registry.functionals.get(weaponDefId)!;
  const draft = equippedDraft(weaponDefId);
  const snap = buildSnapshotFromDraft(draft, registry, 'r7');
  const product = fullRunCompat(draft);

  const lower = chainOf(weaponDefId, false);
  const withRepair = chainOf(weaponDefId, true);

  // 产品默认车（真实配置）下的 Run parse 读数 + 本局 registry 的 canonical 比对
  const realRt = new RunBattleRuntime({
    build: [],
    carriedHp: null,
    encounterId: RUN_ENCOUNTERS[0],
    playerDraft: draft,
    playerLoadoutTag: 'profile-equipped',
    playerBaseline: true,
  });
  let parsedBase: string | null;
  let snapshotSlot: string | null;
  let registryCanonical: boolean;
  try {
    parsedBase = realRt.runBaseWeaponDefId;
    snapshotSlot =
      realRt.playerSnapshot.functionals.find((f) => f.hardpointId === WEAPON_SLOT)?.defId ?? null;
    registryCanonical = JSON.stringify(realRt.registry.functionals.get(weaponDefId)) === JSON.stringify(def);
  } finally {
    realRt.dispose();
  }

  return {
    defId: weaponDefId,
    behavior: def.behavior,
    factoryExists: getBehaviorFactory(def.behavior) !== undefined,
    parsedBaseWeaponDefId: parsedBase,
    parsedBaseFromSnapshot: resolveRunBaseWeaponDefId(snap, registry),
    snapshotSlotDefId: snapshotSlot,
    productOk: product.ok,
    productBaseWeaponDefId: product.baseWeaponDefId,
    runRegistryDefIsCanonical: registryCanonical,
    battles: lower.battles,
    outcome: { kind: lower.kind, atEncounter: lower.atEncounter, finalHp: lower.finalHp },
    repairOutcome: {
      kind: withRepair.kind,
      atEncounter: withRepair.atEncounter,
      finalHp: withRepair.finalHp,
    },
  };
}

/**
 * 一次算好、所有用例共用 —— 每件武器要跑**两条** 4 场连锁 + 一场 parse 取证，
 * 6 件合计约 10s 真实物理。
 *
 * ⚠️ 刻意放 `beforeAll` 并给**显式**超时：默认 5s 会在这份重活上偶发假红
 *    （本机已知的负载抖动，与本文件无关）。逐条用例因此只做纯断言。
 */
let FACTS: readonly WeaponFact[] = [];
beforeAll(() => {
  FACTS = REGISTERED_NON_CANNON.map(collect);
}, 180_000);

function facts(): readonly WeaponFact[] {
  return FACTS;
}

/** 该武器在某一场里**自己**打出的伤害读数（车上只有它 ⇒ key 就是它）。 */
function ownHit(f: WeaponFact, battleIndex = 0): HitReading {
  const b = f.battles[battleIndex];
  return b.hits[f.defId] ?? { count: 0, total: 0, damages: [] };
}

/* ============================================================================
   0. 前置：本 Queue 的调查集合与登记表
   ============================================================================ */

describe('R6-BATCH｜0. 调查集合', () => {
  it('R7-00 本 Queue 逐件调查的正是「8 件非 Cannon 玩家武器」，登记表恰 7 件（含 cannon）', () => {
    const ownedWeapons = OFFICIAL_PARTS.filter((p) => isWeaponDefId(p));
    expect(ownedWeapons.length, '玩家可拥有武器恰 9 件').toBe(9);
    // 逐件调查集合 = 玩家可拥有 − cannon = 8 件（**Queue 点名的就是这 8 件**）
    const investigated = ownedWeapons.filter((id) => id !== 'cannon');
    expect(investigated.slice().sort()).toEqual(
      ['flamethrower', 'hammer', 'laser', 'machineGun', 'rammer', 'saw', 'shotgun', 'spear'].sort(),
    );
    // 其中 6 件进入登记表（本文件逐件验证），另 2 件被拒（saw / spear，各自单独钉）
    expect(REGISTERED_NON_CANNON.slice().sort()).toEqual(
      ['flamethrower', 'hammer', 'laser', 'machineGun', 'rammer', 'shotgun'].sort(),
    );
    expect(FULL_RUN_SUPPORTED_WEAPON_IDS.length, '登记表 = cannon + 6 件非 Cannon').toBe(7);
  });
});

/* ============================================================================
   A. 逐件真实链（Run parse / Runtime entity / Attack-Damage / 终态）
   ============================================================================ */

describe('R6-BATCH｜A. 逐件真实链（每个新登记武器）', () => {
  it('R7-01 **Run parse**：基准武器 = 它自己；装配未被改写；本局定义 = 官方 canonical', () => {
    for (const f of facts()) {
      expect(f.factoryExists, `${f.defId}：behavior "${f.behavior}" 必须有 factory`).toBe(true);
      // 产品侧：放行，且 base 就是它（不是 cannon）
      expect(f.productOk, `${f.defId}：产品侧必须放行`).toBe(true);
      expect(f.productBaseWeaponDefId, `${f.defId}：产品侧 base 必须是它自己`).toBe(f.defId);
      // 局内：同一件事（装配顺序第一件正式武器）—— 两条独立路径都要得出它
      expect(f.parsedBaseWeaponDefId, `${f.defId}：局内 base 必须是它自己`).toBe(f.defId);
      expect(
        f.parsedBaseFromSnapshot,
        `${f.defId}：直接从 BuildSnapshot 解析的 base 也必须是它自己`,
      ).toBe(f.defId);
      // 交给编排器的 snapshot 里主武器槽那件**没有被重映射**成别的武器 / overlay
      expect(f.snapshotSlotDefId, `${f.defId}：装配不得被改写`).toBe(f.defId);
      // 本局 registry 里那件 = 官方 canonical（**逐字段**，没有注入 Cannon 的任何字段）
      expect(f.runRegistryDefIsCanonical, `${f.defId}：本局定义必须 = 官方 canonical`).toBe(true);
    }
  });

  it('R7-02 **Runtime entity**：那件真的装进战斗，且 ① 有 factory ② 主武器槽上 behavior = 它自己的', () => {
    for (const f of facts()) {
      const first = f.battles[0];
      expect(first, `${f.defId}：至少跑过一场`).toBeDefined();
      expect(first.slotWeapon, `${f.defId}：主武器槽上必须有真实武器`).toBeTruthy();
      expect(first.slotWeapon!.defId, `${f.defId}：槽上就是它`).toBe(f.defId);
      expect(
        first.slotWeapon!.behavior,
        `${f.defId}：behavior 必须是它自己的（${f.behavior}）`,
      ).toBe(f.behavior);
      // 星级 1（本 Queue 明令每个成功武器只做 ★1）
      expect(first.slotWeapon!.star, `${f.defId}：本 Queue 只做 ★1`).toBe(1);
      // 该件真的**动起来**：弹道武器有玩家方存活弹丸；近战武器由下面的真实伤害证明
      if (['cannon', 'laser', 'shotgun', 'machineGun', 'flamethrower'].includes(f.defId)) {
        expect(first.sawPlayerProjectile, `${f.defId}：必须真的发射出弹丸`).toBe(true);
      }
    }
  });

  it('R7-03 **Attack / Damage**：真实 damage 事件，且**逐发伤害 = 它的 canonical 伤害**', () => {
    for (const f of facts()) {
      const expected = CANONICAL_MAIN_DAMAGE[f.defId];
      expect(expected, `${f.defId} 必须有 canonical 主伤害读数（内容改了要同步这张表）`).toBeDefined();
      // ① 本局解析出的「一次命中伤害」= 写死的 canonical 值
      expect(
        f.battles[0].slotWeapon!.damage,
        `${f.defId}：一次命中伤害必须 = canonical ${expected}`,
      ).toBe(expected);
      // ② 第 1 场里它**真的**打出了伤害（不是「能跑但不打」）
      const hit = ownHit(f);
      expect(hit.count, `${f.defId}：第 1 场必须有真实命中`).toBeGreaterThan(0);
      expect(hit.total, `${f.defId}：第 1 场总伤害必须可观（> 300）`).toBeGreaterThan(300);
      // ③ 每一发都**等于** canonical 伤害（排除「平均值凑巧对上」）
      expect(
        hit.damages.every((d) => d === expected),
        `${f.defId}：每一发伤害都必须 = ${expected}，实测 ${JSON.stringify(hit.damages.slice(0, 8))}…`,
      ).toBe(true);
    }
  });

  it('R7-04 **COMPLETE 或 FAILED**：4 场连锁每场都到达**终态**（不会卡死 / 不会无终局）', () => {
    for (const f of facts()) {
      for (const [i, b] of f.battles.entries()) {
        expect(b.steps, `${f.defId} 第 ${i + 1} 场（${b.encounterId}）不得撞上步数上限`).toBeLessThan(4000);
        expect(b.phase, `${f.defId} 第 ${i + 1} 场必须到 End`).toBe('End');
        expect(['A', 'B'], `${f.defId} 第 ${i + 1} 场必须有胜者`).toContain(b.winner);
        expect(['hp', 'arenaEnd'], `${f.defId} 第 ${i + 1} 场必须有结束原因`).toContain(b.endReason);
      }
      // 整局也必须给出一个**明确**终局（本 Queue 只要求「到达 COMPLETE 或 FAILED」，不要求必胜）
      expect(['COMPLETE', 'FAILED'], `${f.defId}：整局必须有明确终局`).toContain(f.outcome.kind);
      if (f.outcome.kind === 'FAILED') {
        expect(
          f.battles[f.battles.length - 1].hpA,
          `${f.defId}：FAILED ⇒ 该场 HP 必须归零`,
        ).toBe(0);
      }
    }
  });

  it('R7-04b 下界路线的终局结论**机器记录**（平衡留白 = 可见事实，不是靠人记）', () => {
    /*
      ⚠️ 这条钉的是**平衡事实**，不是游戏规则。它的价值在于：把「非 Cannon 装备在本局拿不到
      任何伤害成长（三个第一层强化 + 横向改装对非 Cannon 全是空操作）」这条留白变成**机器可见的结论**
      —— 将来谁给非 Cannon 补了专属强化 / 专属 Build，这一条会立刻响，提醒同步更新矩阵。

      口径 = ★1 + **零 Build** + 跨场耐久**不修**，车上只留这一件（比真实路线更严的下界）。
      实测（本次，machine-recorded）：COMPLETE = flamethrower（终局 222.2）/ machineGun（580.9）；
      FAILED = hammer@ProtoRusher · laser@PineappleFireBrute · rammer@PineappleSawRusher ·
               shotgun@BananaRodLaser。
      断言只钉**集合与阵亡场次**（不钉 HP 浮点数）：浮点数会因无关物理改动抖动，
      「在哪一场走到终态」才是这条结论的语义。
    */
    const complete = facts().filter((f) => f.outcome.kind === 'COMPLETE').map((f) => f.defId);
    const failed = facts()
      .filter((f) => f.outcome.kind === 'FAILED')
      .map((f) => `${f.defId}@${f.outcome.atEncounter}`);
    expect(complete.slice().sort()).toEqual(['flamethrower', 'machineGun'].sort());
    expect(failed.slice().sort()).toEqual(
      [
        'hammer@ProtoRusher',
        'laser@PineappleFireBrute',
        'rammer@PineappleSawRusher',
        'shotgun@BananaRodLaser',
      ].sort(),
    );
    // 反向：这条结论必须真的覆盖全部登记的非 Cannon 武器（没有一件落空）
    expect(complete.length + failed.length).toBe(REGISTERED_NON_CANNON.length);
    // 下界里「阵亡」必须真的归零（不能只是「没跑完」）
    for (const f of facts()) {
      if (f.outcome.kind === 'FAILED') expect(f.outcome.finalHp, `${f.defId}`).toBe(0);
    }
  });

  it('R7-04c 真实路线（含 DAY4 / DAY5 两次紧急维修）的终局结论**机器记录**（见文件头两路线说明）', () => {
    /*
      口径 = R7-04b 的下界 + 两笔 `emergencyRepair`（DAY4「维修」+ DAY5 第二层，
      两笔都在第 3 场之前；维修量 = 正式 `EMERGENCY_REPAIR_FRACTION` × 上限，按缺口截断）。

      实测（本次）：COMPLETE = flamethrower（437.2）· machineGun（657.1）· shotgun（16.8，余量极薄）；
      FAILED = hammer@BananaRodLaser · laser@PineappleFireBrute · rammer@PineappleSawRusher。
      ⇒ 「非 Cannon 拿不到伤害成长，只能靠维修换生存」这条留白在真实路线上的**兑换率**就在这里：
        六件里三件刚好能走完，三件走不完（且差值只有一场到三场的量级）。
      ⚠️ 与 R7-04b 的差集 = `{shotgun}` —— 它恰恰是唯一一件「下界死在第 4 场、维修后刚好活下来」的。
    */
    const complete = facts().filter((f) => f.repairOutcome.kind === 'COMPLETE').map((f) => f.defId);
    const failed = facts()
      .filter((f) => f.repairOutcome.kind === 'FAILED')
      .map((f) => `${f.defId}@${f.repairOutcome.atEncounter}`);
    expect(complete.slice().sort()).toEqual(['flamethrower', 'machineGun', 'shotgun'].sort());
    expect(failed.slice().sort()).toEqual(
      ['hammer@BananaRodLaser', 'laser@PineappleFireBrute', 'rammer@PineappleSawRusher'].sort(),
    );
    expect(complete.length + failed.length).toBe(REGISTERED_NON_CANNON.length);
    // 维修**只可能救命，不可能害死**：下界 COMPLETE 的，维修路线必须也 COMPLETE
    for (const f of facts()) {
      if (f.outcome.kind === 'COMPLETE') {
        expect(f.repairOutcome.kind, `${f.defId}：维修不得让能走完的变得更糟`).toBe('COMPLETE');
      }
    }
    // 维修量由**正式常量 × 真实上限**派生 —— 本文件不写死 275
    expect(Math.round(facts()[0].battles[0].hpAMax * EMERGENCY_REPAIR_FRACTION)).toBe(275);
  });
});

/* ============================================================================
   B. 返回后装备保持（结算 / 下一局）
   ============================================================================ */

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

describe('R6-BATCH｜B. 返回后装备保持（Queue：不得自动换回 Cannon / 不得破坏装备 / 不得 fallback）', () => {
  beforeEach(() => {
    (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();
  });

  it('R7-05 结算领奖（固定 cannon ★1）之后：装备仍是它 · 仍拥有 · 下一局 base 仍是它', () => {
    for (const defId of REGISTERED_NON_CANNON) {
      /*
        ⚠️ 每件武器用一份**全新档案**（清空内存存档）—— 否则第一轮 `ensureInventory` 已经把
        库存落盘，后面几轮就只读那份旧库存（不会再补种）⇒ 「这项武器是否被拥有」取决于循环顺序，
        测试会变成「第一件能过、其余莫名失败」。
      */
      (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();

      // ① **真的拥有它**：走 core 唯一库存写入口（`addPart` + `saveInventory`）——
      //    与 debug「全部件×1」/ 奖励入账同一条路径，不是测试自己造库存对象。
      const inv0 = playerInventory(loadEquippedDraft());
      addPart(inv0, defId, WEAPON_GROWTH_STAR, 1);
      saveInventory(inv0);

      // ② **真的装备它**：走产品唯一装备写入口（Queue 要求的 Garage → Equip → Persist）
      const equipped = equipWeapon(defId);
      expect(
        equipped.ok,
        `${defId}：正式装备入口必须成功 → ${equipped.reason ?? ''} ${equipped.detail ?? ''}`,
      ).toBe(true);

      const before = loadEquippedDraft();
      expect(before.functionalSelections[WEAPON_SLOT], `夹具：主武器槽必须是 ${defId}`).toBe(defId);
      const ownedBefore = getCount(playerInventory(before), defId, 1);
      expect(ownedBefore, `${defId} 必须至少在库存里有一份`).toBeGreaterThan(0);

      // ③ 结算领奖 —— COMPLETE 的固定奖励（本 Queue 明令：**不重做经济系统**，仍是 cannon ★1）
      const outcome = claimRunReward({ runToken: `run-r7-${defId}`, rewardDefId: 'cannon' });
      expect(outcome.ok, `${defId}：领奖（发 cannon ★1）必须成功 → ${outcome.reason}`).toBe(true);
      expect(outcome.grant?.defId).toBe('cannon');

      // ④ 装备**没被动过**：槽位仍是它，且它仍然在库存里（没被领奖流程吃掉 / 替换）
      const after = loadEquippedDraft();
      expect(after.functionalSelections[WEAPON_SLOT], '结算不得破坏当前装备').toBe(defId);
      expect(
        getCount(playerInventory(after), defId, 1),
        `${defId}：领奖不得消耗 / 删除当前装备的那一件`,
      ).toBe(ownedBefore);

      // ⑤ 下一局**不得 silent fallback 回 Cannon**：base 仍是它，且仍然放行
      const compat = fullRunCompat(after);
      expect(compat.baseWeaponDefId, `${defId}：下一局 base 必须仍是它`).toBe(defId);
      expect(compat.ok, `${defId}：下一局仍必须放行`).toBe(true);
      expect(
        runLoadoutCompatOfDraft(after).baseWeaponDefId,
        `${defId}：局内资格解析的 base 也必须仍是它`,
      ).toBe(defId);
    }
  });
});

/* ============================================================================
   C. 被拒武器保持被拒（记录缺口）
   ============================================================================ */

describe('R6-BATCH｜C. Runtime 不完整 / 打不到人的武器保持 BLOCK', () => {
  it('R7-06 **saw**：Runtime 齐（contactTick 链在 `front` 上真实生效）但**产品槽打不到人** ⇒ 不登记', () => {
    // ① Runtime 与伤害链**确实存在**（这条很重要：saw 不是「没有 Runtime」，是「挂错位置」）
    expect(getBehaviorFactory('saw'), 'saw 有 factory').toBeDefined();
    const def = registry.functionals.get('saw')!;
    expect(def.behavior).toBe('saw');
    const policy = def.behaviorParams?.hitPolicy as
      | { mode?: string; intervalMs?: number; damage?: number }
      | undefined;
    expect(policy?.mode, 'saw 走 contactTick 持续切割').toBe('contactTick');
    expect(policy?.damage).toBeGreaterThan(0);

    // ② **几何**：圆锯的圆完全落在车身 collider 的 x 区间内 ⇒ 正面接敌由车身先碰
    const body = registry.bodies.get('watermelonBody')!;
    const hardpoint = body.functionalHardpoints.find((h) => h.id === WEAPON_SLOT)!;
    const bodyHalfW = (body.colliders[0] as { width: number }).width / 2;
    const sawR = (def.collider as { radius: number }).radius;
    expect(
      hardpoint.localPosition.x + sawR,
      '圆锯前沿必须在车身前沿**之内**（这才是它打不到人的原因）',
    ).toBeLessThan(bodyHalfW);
    // 对照：`front` 槽（既有 saw 测试用的槽）能伸出车身 —— 说明问题在**挂点**，不在 Runtime
    const frontHp = body.functionalHardpoints.find((h) => h.id === 'front')!;
    expect(frontHp.localPosition.x + sawR).toBeGreaterThan(bodyHalfW);

    // ③ **实测同场对照**：第 1 场、同一份 Runtime，`front` 打得出伤害，产品槽 `frontMass` 打不出。
    //    实测（本次）：front ⇒ 25 命中 / 200 伤害；frontMass / top / rear ⇒ **0 命中 / 0 伤害**。
    const onFront = runBattleToEnd('saw', RUN_ENCOUNTERS[0], null, true, 'front').fact;
    expect(
      onFront.sawPlayerProjectile,
      'saw 不是弹道武器（它的实现在 contactTick，不发射弹丸）',
    ).toBe(false);
    expect(
      onFront.hits['saw']?.count ?? 0,
      'saw 挂 front 时必须有真实命中（Runtime 齐的证据）',
    ).toBeGreaterThan(0);
    expect(onFront.hits['saw']?.total ?? 0, 'saw 挂 front 时有真实伤害').toBeGreaterThan(0);

    const onProductSlot = runBattleToEnd('saw', RUN_ENCOUNTERS[0], null).fact;
    expect(
      onProductSlot.hits['saw']?.count ?? 0,
      'saw 挂**产品主武器槽**时实测 0 命中 —— 这是它保持 BLOCK 的直接证据',
    ).toBe(0);

    // ④ 产品侧与局内侧各自的裁决（**两层关系**：产品拒、局内按设计不拒）
    expect(supportsFullRun('saw'), 'saw 不得进登记表').toBe(false);
    expect(fullRunCompat(equippedDraft('saw')).ok).toBe(false);
    expect(fullRunCompat(equippedDraft('saw')).reason).toBe('unsupported-weapon');
    expect(runLoadoutCompatOfDraft(equippedDraft('saw')).ok, '局内资格层只判 Runtime 是否存在').toBe(true);
  });

  it('R7-07 **spear**：`behavior === "ram"` 没有 factory；且真实代码里**没有**漏接的 ram behavior', () => {
    const def = registry.functionals.get('spear')!;
    expect(def.behavior).toBe('ram');
    expect(getBehaviorFactory('ram'), 'ram 没有注册工厂').toBeUndefined();
    expect(registeredBehaviorIds(), '注册表里不得有 ram').not.toContain('ram');

    /*
      Queue 的例外条件：「除非真实代码中找到**已经存在但此前漏接**的正式 ram behavior」。
      穷尽核对（不靠记忆、不靠单一 grep）：
        ① 注册表里没有 `ram`；
        ② `src/battle/` 目录下的行为实现文件里，名字含 `ram` 的**只有** `rammerBehavior.ts`
           （那是 Q12-C 冲锤，behavior id 是 `rammer`，不是 `ram`）；
        ③ registry 里**所有**武器 def 中「behavior 没有 factory」的恰好 = ramHead + spear，
           且它们的 behavior 都是 `'ram'` —— 任何「漏接的正式 ram behavior」都会让这条不等。
    */
    const battleFiles = readdirSync(BATTLE_DIR).filter((f) => /ram/i.test(f));
    expect(battleFiles, 'src/battle 下与 ram 相关的实现只应有冲锤（rammer）').toEqual([
      'rammerBehavior.ts',
    ]);
    const missing = [...registry.functionals.values()]
      .filter((d) => d.category === 'weapon' && getBehaviorFactory(d.behavior) === undefined)
      .map((d) => `${d.id}:${d.behavior}`);
    expect(missing.slice().sort(), '没有 factory 的武器恰好这两件，且都是 ram').toEqual([
      'ramHead:ram',
      'spear:ram',
    ]);

    // 产品侧：不登记（③ 不满足）
    expect(supportsFullRun('spear')).toBe(false);
    expect(fullRunCompat(equippedDraft('spear')).reason).toBe('unsupported-weapon');
    // 局内资格层：也拒（Runtime 事实就不成立）
    expect(runLoadoutCompatOfDraft(equippedDraft('spear')).ok).toBe(false);
    expect(runLoadoutCompatOfDraft(equippedDraft('spear')).reason).toBe('no-weapon-runtime');
    /*
      ⚠️ 如实记录（Queue 点名不许据以判完整的情形）：spear **确实**能通过 `contactOnce`
      路径打出伤害（实测第 1 场 10 命中 / 600 = 每发 60）。把它写成断言是为了**防止**
      下一个人再拿「碰撞已经能造成伤害」当完整证据。
    */
    const spearHit = runBattleToEnd('spear', RUN_ENCOUNTERS[0], null).fact.hits['spear'];
    expect(spearHit?.count ?? 0, 'spear 能靠碰撞造成伤害（**但这不构成 Runtime 完整**）').toBeGreaterThan(0);
  });

  it('R7-08 两件的**产品表现必须一致**，且被拒集合精确 = {saw, spear}', () => {
    const rejected = OFFICIAL_PARTS.filter((p) => isWeaponDefId(p) && !supportsFullRun(p));
    expect(rejected.slice().sort()).toEqual(['saw', 'spear']);
    for (const defId of rejected) {
      const draft = equippedDraft(defId);
      // ① 它们仍然是**合法武器**：过正式校验、仍可拥有 / 装备（拒的是「完整 Run」，不是「这件东西」）
      expect(registry.functionals.get(defId)?.category).toBe('weapon');
      expect(OFFICIAL_PARTS).toContain(defId);
      expect(buildSnapshotFromDraft(draft, registry, 'r7'), `${defId} 装备本身必须合法`).toBeTruthy();
      // ② 产品侧表现一致：不放行、base 报得出、理由都是 unsupported-weapon
      const compat = fullRunCompat(draft);
      expect(compat.ok, `${defId}：不得放行`).toBe(false);
      expect(compat.reason, `${defId}：产品侧理由`).toBe('unsupported-weapon');
      expect(compat.baseWeaponDefId, `${defId}：仍然要如实报出 base`).toBe(defId);
    }
    // 反向：登记表里的 7 件必须**全部**放行（防止「一律拒绝」也能让上面通过）
    for (const defId of FULL_RUN_SUPPORTED_WEAPON_IDS) {
      expect(fullRunCompat(equippedDraft(defId)).ok, `${defId} 必须放行`).toBe(true);
    }
  });
});

/* ============================================================================
   D. Cannon 全链不退化
   ============================================================================ */

describe('R6-BATCH｜D. Cannon 全链不退化', () => {
  it('R7-09 cannon：仍在登记表、仍然是 R2 强化体系的归属武器、数值与终局结论未变', () => {
    expect(FULL_RUN_SUPPORTED_WEAPON_IDS).toContain('cannon');
    // 正式键仍 80（敌方 RangedTurret 吃的那一份）；玩家侧基线仍是 120（独立 overlay 件）
    expect(registry.functionals.get('cannon')!.behaviorParams?.['projectileDamage']).toBe(80);
    const draft = defaultPlayerDraft();
    const compat = fullRunCompat(draft);
    expect(compat.ok).toBe(true);
    expect(compat.baseWeaponDefId).toBe('cannon');
    expect(compat.reason).toBe('ok');
    expect(compat.notice).toBeNull();
    // 玩家那门炮的真实一次命中伤害 = 120（本局 overlay）
    const cannonFact = runBattleToEnd('cannon', RUN_ENCOUNTERS[0], null).fact;
    expect(cannonFact.slotWeapon!.damage).toBe(CANONICAL_MAIN_DAMAGE['cannon']);
    // ⚠️ 产品默认车（`defaultPlayerDraft`）在 `top` 槽另有一把锤 ⇒ 这台车的 Run base 仍是 cannon
    //    （装配顺序第一件正式武器 = `frontMass` 上的 cannon），不被本 Queue 改变。
    const rt0 = new RunBattleRuntime({
      build: [],
      carriedHp: null,
      encounterId: RUN_ENCOUNTERS[0],
      playerDraft: draft,
      playerLoadoutTag: 'profile-equipped',
      playerBaseline: true,
    });
    try {
      expect(rt0.runBaseWeaponDefId).toBe('cannon');
    } finally {
      rt0.dispose();
    }
  });

  it('R7-10 cannon 的**完整 4 场连锁**不退化（归因夹具 = 车上只留这一件）', () => {
    /*
      ⚠️ 夹具说明（与文件头「两条路线」同一件事）：这里用**只留它一件**的归因夹具。
      产品默认车（cannon + `top` 的锤）是**另一台车**，下界实测在第 4 场阵亡 ——
      那是装配层面的平衡事实，不是「Cannon 链退化」。两种夹具测两件事，本用例只钉前者。
      实测（本次）：只留 cannon ⇒ 下界 COMPLETE（终局 234.8）；含两次维修 ⇒ COMPLETE（377.0）。
    */
    const chain = chainOf('cannon', false);
    expect(chain.kind, 'cannon 的下界连锁必须能走完 4 场').toBe('COMPLETE');
    expect(chain.battles.length, '4 场一场不少').toBe(RUN_ENCOUNTERS.length);
    expect(chain.finalHp).toBeGreaterThan(0);
    // 4 场都真的打出过伤害（不是「活着混过去」）
    for (const b of chain.battles) {
      expect(b.hits['cannon']?.count ?? 0, `${b.encounterId}：cannon 必须有真实命中`).toBeGreaterThan(0);
      expect(
        (b.hits['cannon']?.damages ?? []).every((d) => d === CANONICAL_MAIN_DAMAGE['cannon']),
        `${b.encounterId}：每一发都必须是 canonical 120`,
      ).toBe(true);
    }
  });

  it('R7-09b 奖励池不变式仍在：`REWARD_CHOICE_IDS` ⊆ 登记表，且本 Queue 没动奖励池', () => {
    expect(REWARD_CHOICE_IDS).toEqual(['cannon']);
    for (const id of REWARD_CHOICE_IDS) expect(supportsFullRun(id)).toBe(true);
  });
});
