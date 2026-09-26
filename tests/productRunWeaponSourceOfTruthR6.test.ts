/**
 * PRODUCT-LOOP-R6-RUN-WEAPON-SOURCE-OF-TRUTH｜targeted strict test。
 *
 * ── 本 Queue 建立的**唯一规则** ─────────────────────────────────────────────
 *
 *     玩家装备什么正式武器，Product Run 就以**该武器自己的 canonical Def** 作为运行 base。
 *
 * 改前的形态（本 Queue 要根除的公共 Foundation 问题）：
 *   `RUN_BASE_WEAPON_DEF_ID = 'cannon'` 被当成「本局的武器」——overlay 以 Cannon 为 base 派生、
 *   装载找不到 Cannon 就 `throw`、产品侧 `FULL_RUN_SUPPORTED_WEAPON_IDS = ['cannon']`
 *   ⇒ 任何非 Cannon 武器即使自身 Runtime 完整也进不了完整 Run（Q3/Q4 两次 STOP 的真实阻塞点）。
 *
 * ── 验收映射（Queue 原文 A–E）───────────────────────────────────────────────
 *   A. Cannon 现有 Product Run 完全不变          → R6-01 / R6-02 / R6-03
 *   B. 非 Cannon：base 用自身 canonical Def，
 *      关键字段不来自 Cannon                     → R6-04 / R6-05 / R6-06
 *   C. 非 Cannon 不再因「Snapshot 没有 cannon」throw → R6-07
 *   D. Runtime 不完整武器仍被明确阻止             → R6-08
 *   E. 禁止 silent fallback                       → R6-10
 *   必改 3 的显式能力登记门槛（5 条）             → R6-09（①②③）+ R6-11（④）
 *
 * ⚠️ 本文件**不写任何战斗数值**：所有断言读的都是正式 registry / 正式装配结果。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { getBehaviorFactory } from '../src/battle/behaviorRegistry';
import { validateSnapshot } from '../src/core/buildValidator';
import { registry } from '../src/core/content';
import { OFFICIAL_PARTS } from '../src/core/partInventory';
import { buildSnapshotFromDraft, type BuildDraft } from '../src/lab/buildEditorModel';
import { RunBattleRuntime } from '../src/lab/portraitBattleLab/runBattleRuntime';
import { runLoadoutCompatOfDraft } from '../src/lab/portraitBattleLab/runLoadoutCompat';
import {
  PRODUCT_RUN_CANNON_BASE_DAMAGE,
  RUN_BASE_WEAPON_DEF_ID,
  applyRunModifiersToSnapshot,
  composeRunWeaponDef,
  createRunRegistry,
  resolveRunBaseWeaponDefId,
  runPlayerWeaponDefId,
} from '../src/lab/portraitBattleLab/runModifiers';
import { FULL_RUN_SUPPORTED_WEAPON_IDS, fullRunCompat } from '../src/product/runCompatibility';
import { WEAPON_SLOT, defaultPlayerDraft, isWeaponDefId } from '../src/product/playerLoadout';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const readLab = (f: string): string =>
  readFileSync(join(REPO_ROOT, 'src', 'lab', 'portraitBattleLab', f), 'utf8');
const readProduct = (f: string): string =>
  readFileSync(join(REPO_ROOT, 'src', 'product', f), 'utf8');
/** 剥掉注释（守卫必须扫**代码**，不能扫到解释性文字）。 */
const strip = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/* --------------------------------------------------------------- 夹具 */

/** 全部登记武器里**非 Cannon** 的那些（本 Queue 新放行的集合）。 */
const NON_CANNON: readonly string[] = FULL_RUN_SUPPORTED_WEAPON_IDS.filter(
  (id) => id !== RUN_BASE_WEAPON_DEF_ID,
);

/**
 * 「玩家身上那件装备」= 产品侧真实默认车 + 主武器槽换成指定武器。
 * 每份夹具都先过正式 `validateSnapshot`：否则「拒绝」可能只是因为装备本身非法。
 */
function equippedDraft(weaponDefId: string): BuildDraft {
  const base = defaultPlayerDraft();
  const next: BuildDraft = {
    ...base,
    functionalSelections: { ...base.functionalSelections, [WEAPON_SLOT]: weaponDefId },
  };
  const check = validateSnapshot(buildSnapshotFromDraft(next, registry), registry);
  expect(check.valid, `夹具本身必须合法：${weaponDefId} → ${check.errors.join('；')}`).toBe(true);
  return next;
}

const snapOf = (draft: BuildDraft) => buildSnapshotFromDraft(draft, registry, 'r6');

/** 某 registry 里某件武器的 behaviorParams 浅拷贝（比对用）。 */
const paramsOf = (reg: typeof registry, defId: string): Record<string, unknown> => ({
  ...(reg.functionals.get(defId)?.behaviorParams ?? {}),
});

/** 本局 registry 里**多出来**的部件 id（正式副本之外凭空新增的）。 */
const extraKeysOf = (reg: typeof registry): string[] =>
  [...reg.functionals.keys()].filter((k) => !registry.functionals.has(k)).sort();

/**
 * 跑一场真实战斗（无头、固定步长）。
 * 用来钉「这件武器装上去之后，Collision / Damage / Result 链真的不崩」。
 */
function smokeRun(weaponDefId: string, steps = 480): string {
  const rt = new RunBattleRuntime({
    build: [],
    carriedHp: null,
    encounterId: 'ProtoRusher',
    playerDraft: equippedDraft(weaponDefId),
    playerLoadoutTag: 'profile-equipped',
  });
  try {
    const t0 = rt.orchestrator.timeMs;
    for (let i = 0; i < steps; i++) rt.step(16);
    const advanced = rt.orchestrator.timeMs - t0;
    expect(advanced, `${weaponDefId}：物理必须真的推进`).toBeGreaterThan(0);
    expect(rt.playerWeapons().length, `${weaponDefId}：武器必须真的装配`).toBeGreaterThan(0);
    // 真实战斗：对手也在场上（不是空跑）
    expect(rt.orchestrator.vehicleB, `${weaponDefId}：对手必须存在`).toBeTruthy();
    return `${weaponDefId}:${advanced}ms:${rt.phase}`;
  } finally {
    rt.dispose();
  }
}

/* ============================================================================
   A. Cannon 现有 Product Run 完全不变（验收 A）
   ============================================================================ */

describe('R6-RUN-WEAPON-SOURCE-OF-TRUTH｜A. Cannon 路径完全不变（验收 A）', () => {
  it('R6-01 正式 cannon 键仍 80；玩家侧基线 120 仍由**独立 overlay 件**承载', () => {
    const withBaseline = createRunRegistry([], true, RUN_BASE_WEAPON_DEF_ID);
    const official = registry.functionals.get(RUN_BASE_WEAPON_DEF_ID)!;
    // ① 正式键逐字段不变（敌方 RangedTurret 的 cannon 也吃这一份 ⇒ 敌人不被 buff）
    expect(withBaseline.functionals.get(RUN_BASE_WEAPON_DEF_ID)).toEqual(official);
    expect(paramsOf(registry, 'cannon')['projectileDamage'], 'global Cannon Def 冻结').toBe(80);

    // ② 玩家那件 = 官方 cannon 除 `projectileDamage` 外**逐字段相同**，伤害 = 120
    const playerId = runPlayerWeaponDefId([], true, RUN_BASE_WEAPON_DEF_ID)!;
    const player = withBaseline.functionals.get(playerId);
    expect(player, `玩家侧 overlay 件 ${playerId} 必须存在`).toBeDefined();
    expect({ ...player!, behaviorParams: undefined }).toEqual({ ...official, behaviorParams: undefined });
    expect(paramsOf(withBaseline, playerId)).toEqual({
      ...paramsOf(registry, 'cannon'),
      projectileDamage: PRODUCT_RUN_CANNON_BASE_DAMAGE,
    });

    // ③ 键集合只多出那一件（本局副本不污染正式内容库）
    expect(extraKeysOf(withBaseline)).toEqual([playerId]);
  });

  it('R6-02 Cannon + heavyShell：重映射到「玩家基线 + 强化」的同一件 overlay（与改前同一条链）', () => {
    const snap = snapOf(equippedDraft('cannon'));
    const out = applyRunModifiersToSnapshot(snap, ['heavyShell'], true, RUN_BASE_WEAPON_DEF_ID);
    const expectId = runPlayerWeaponDefId(['heavyShell'], true, RUN_BASE_WEAPON_DEF_ID)!;
    expect(expectId).toBe('run.mod.@base+heavyShell');
    expect(out.functionals.find((f) => f.hardpointId === WEAPON_SLOT)?.defId).toBe(expectId);
    // 其余件一字未动
    for (const f of snap.functionals.filter((x) => x.hardpointId !== WEAPON_SLOT)) {
      expect(out.functionals.find((o) => o.hardpointId === f.hardpointId)?.defId).toBe(f.defId);
    }
  });

  it('R6-03 真实战斗里 base 仍是玩家那个 overlay 件（Cannon 闭环无变化）', () => {
    // `playerBaseline: true` = 产品真实路径（`runPage.beginBattle` 就是这么传的）
    const rt = new RunBattleRuntime({
      build: ['heavyShell'],
      carriedHp: null,
      encounterId: 'ProtoRusher',
      playerDraft: equippedDraft('cannon'),
      playerLoadoutTag: 'profile-equipped',
      playerBaseline: true,
    });
    try {
      expect(rt.runBaseWeaponDefId).toBe(RUN_BASE_WEAPON_DEF_ID);
      expect(rt.playerSnapshot.functionals.find((f) => f.hardpointId === WEAPON_SLOT)?.defId).toBe(
        runPlayerWeaponDefId(['heavyShell'], true, RUN_BASE_WEAPON_DEF_ID),
      );
      expect(rt.playerWeapons().length).toBeGreaterThan(0);
    } finally {
      rt.dispose();
    }
  });
});

/* ============================================================================
   B. 非 Cannon：base = 自身 canonical Def，关键字段不来自 Cannon（验收 B）
   ============================================================================ */

describe('R6-RUN-WEAPON-SOURCE-OF-TRUTH｜B. 非 Cannon 用自身 canonical Def（验收 B）', () => {
  it('R6-04 逐件：Run base = 它自己；装配不被改写；本局定义 = 官方 canonical', () => {
    expect(NON_CANNON.length, '本 Queue 至少要让一件非 Cannon 武器进来').toBeGreaterThan(0);
    for (const w of NON_CANNON) {
      const official = registry.functionals.get(w)!;
      const rt = new RunBattleRuntime({
        build: [],
        carriedHp: null,
        encounterId: 'ProtoRusher',
        playerDraft: equippedDraft(w),
        playerLoadoutTag: 'profile-equipped',
      });
      try {
        // ① 基准武器 = 它自己（不是 cannon）
        expect(rt.runBaseWeaponDefId, `${w}：基准武器必须是它自己`).toBe(w);
        // ② 装配里那件没被改写成 overlay / cannon
        expect(
          rt.playerSnapshot.functionals.find((f) => f.hardpointId === WEAPON_SLOT)?.defId,
          `${w}：不得被重映射`,
        ).toBe(w);
        // ③ 本局 registry 里那件武器 = 官方定义**逐字段相同**（没有注入 Cannon 的任何字段）
        expect(rt.registry.functionals.get(w), `${w}：本局定义必须 = 官方 canonical`).toEqual(official);
        // ④ 本局 registry 里不得凭空多出 overlay 部件（本局一个 Modifier 都没有）
        expect(extraKeysOf(rt.registry), `${w}：不许凭空多出部件`).toEqual([]);
        // ⑤ 战斗世界真的把它装配起来了
        const weapons = rt.playerWeapons();
        expect(weapons.length, `${w}：武器必须真的装配`).toBeGreaterThan(0);
        expect(
          weapons.find((x) => x.hardpointId === WEAPON_SLOT)?.behavior,
          `${w}：主武器槽那件的 behavior 必须是它自己的（${official.behavior}）`,
        ).toBe(official.behavior);
      } finally {
        rt.dispose();
      }
    }
  });

  it('R6-05 R2 武器强化（四项）不渗透到别的武器：一项都不适用，也不改写它的定义', () => {
    const ALL_WEAPON_MODS = ['heavyShell', 'twinCannon', 'fastReload', 'tripleLoad'] as const;
    for (const w of NON_CANNON) {
      const official = registry.functionals.get(w)!;
      const reg = createRunRegistry([...ALL_WEAPON_MODS], false, w);
      expect(extraKeysOf(reg), `${w}：四项武器强化都不适用 ⇒ 不得新增部件`).toEqual([]);
      expect(reg.functionals.get(w), `${w}：定义不得被改写`).toEqual(official);
      // 直接把 compose 也钉一次：behavior 与 behaviorParams 全部保持官方值
      const composed = composeRunWeaponDef(official, [...ALL_WEAPON_MODS], w);
      expect(composed.behavior, `${w}：behavior 不得被改成 cannon`).toBe(official.behavior);
      expect({ ...composed.behaviorParams }).toEqual({ ...official.behaviorParams });
    }
    // 对照组：同一组四项在 Cannon 上照旧生效（证明上面不是「一律不生效」的假绿）
    const cannonReg = createRunRegistry([...ALL_WEAPON_MODS], false, RUN_BASE_WEAPON_DEF_ID);
    expect(extraKeysOf(cannonReg).length, 'Cannon 上这四项必须真的合成出一个 overlay 部件').toBe(1);
  });

  it('R6-06 玩家侧基线（120）只作用于 Cannon，不写进别的武器', () => {
    for (const w of NON_CANNON) {
      const reg = createRunRegistry([], true, w);
      expect(extraKeysOf(reg), `${w}：基线也不得新增部件`).toEqual([]);
      // 本局 registry 里任何一件都不得被写成 Cannon 的 120
      for (const [defId, def] of reg.functionals) {
        const dmg = (def.behaviorParams ?? {})['projectileDamage'];
        if (typeof dmg === 'number') {
          expect(dmg, `${defId} 的伤害必须是它自己的，不是 Cannon 基线`).not.toBe(
            PRODUCT_RUN_CANNON_BASE_DAMAGE,
          );
        }
      }
    }
    // 对照组：Cannon 上基线照旧生效（80 → 120，落在独立 overlay 件上）
    const cannonReg = createRunRegistry([], true, RUN_BASE_WEAPON_DEF_ID);
    const playerId = runPlayerWeaponDefId([], true, RUN_BASE_WEAPON_DEF_ID)!;
    expect(paramsOf(cannonReg, playerId)['projectileDamage']).toBe(PRODUCT_RUN_CANNON_BASE_DAMAGE);
    expect(paramsOf(cannonReg, 'cannon')['projectileDamage'], '正式键仍 80').toBe(80);
  });
});

/* ============================================================================
   C. 非 Cannon 不再因「Snapshot 没有 cannon」throw（验收 C）
   ============================================================================ */

describe('R6-RUN-WEAPON-SOURCE-OF-TRUTH｜C. 注入不再因缺 cannon 抛错（验收 C）', () => {
  it('R6-07 逐件：非 Cannon 注入**不抛错**且原样返回（改前的真人卡死点）', () => {
    for (const w of NON_CANNON) {
      const snap = snapOf(equippedDraft(w));
      // 改前这条链正是真人 P0 的卡死点：`applyRunModifiersToSnapshot` 找不到 cannon → throw
      const out = applyRunModifiersToSnapshot(
        snap,
        ['heavyShell', 'twinCannon', 'tripleLoad'],
        true,
        w,
      );
      expect(out.functionals.map((f) => f.defId), `${w}：原样返回，不得改写`).toEqual(
        snap.functionals.map((f) => f.defId),
      );
      // 直接构造战斗运行时（真人路径上的那一步）也不 throw
      const rt = new RunBattleRuntime({
        build: ['heavyShell'],
        carriedHp: null,
        encounterId: 'ProtoRusher',
        playerDraft: equippedDraft(w),
        playerLoadoutTag: 'profile-equipped',
      });
      rt.dispose();
    }
  });

  it('R6-07b 强 invariant 仍在它该在的地方：有适用项要注入、却找不到 base 件 ⇒ 照样 throw', () => {
    const cannonSnap = snapOf(equippedDraft('cannon'));
    expect(() => applyRunModifiersToSnapshot(cannonSnap, ['heavyShell'], false, 'cannon')).not.toThrow();
    /*
      ⚠️ 触发条件必须**两者同时**成立：base 是 Cannon（⇒ 那些项确实适用）**且**装载里没有
      Cannon 的件。改前那种「非 Cannon 装备 = 没有 base」的情形现在**不会**再触发它
      （非 Cannon 的武器项本来就不适用）—— 这正是验收 C。
    */
    const hammerSnap = snapOf(equippedDraft('hammer'));
    expect(
      () => applyRunModifiersToSnapshot(hammerSnap, ['heavyShell'], false, 'cannon'),
      '声称 base 是 cannon、但车上根本没有 cannon ⇒ 不能静默跳过',
    ).toThrow(/无法注入强化/);
  });
});

/* ============================================================================
   D. Runtime 不完整武器仍被明确阻止（验收 D）
   ============================================================================ */

describe('R6-RUN-WEAPON-SOURCE-OF-TRUTH｜D. Runtime 不完整的武器仍被阻止（验收 D）', () => {
  it('R6-08 spear（behavior "ram" 没有工厂）在两层资格上都被明确拒绝', () => {
    const spearDef = registry.functionals.get('spear')!;
    expect(spearDef.behavior).toBe('ram');
    expect(getBehaviorFactory('ram'), '事实取证：ram 没有注册工厂').toBeUndefined();
    expect(getBehaviorFactory(spearDef.behavior)).toBeUndefined();

    const draft = equippedDraft('spear');
    // 局内资格：理由 = Runtime 不完整（不是「没有武器」、更不是「不是 cannon」）
    const local = runLoadoutCompatOfDraft(draft);
    expect(local.ok).toBe(false);
    expect(local.reason).toBe('no-weapon-runtime');
    expect(local.baseWeaponDefId, '基准武器仍然被解析出来（它就是 spear）').toBe('spear');
    // 产品侧：不在能力登记表里
    const product = fullRunCompat(draft);
    expect(product.ok).toBe(false);
    expect(product.reason).toBe('unsupported-weapon');
    expect(product.baseWeaponDefId).toBe('spear');
    expect(FULL_RUN_SUPPORTED_WEAPON_IDS).not.toContain('spear');
  });
});

/* ============================================================================
   E. 显式能力登记门槛 + 禁止 silent fallback（必改 3 / 验收 E）
   ============================================================================ */

describe('R6-RUN-WEAPON-SOURCE-OF-TRUTH｜E. 登记门槛与禁 fallback', () => {
  it('R6-09 **必改 3**｜登记门槛 ①②③ 逐条机器钉死，且明确拒绝的那件真的存在', () => {
    expect(FULL_RUN_SUPPORTED_WEAPON_IDS.length).toBeGreaterThan(0);
    for (const defId of FULL_RUN_SUPPORTED_WEAPON_IDS) {
      // ① 正式可拥有 Weapon（不是 prototype/hold、不是 Gadget）
      expect(OFFICIAL_PARTS, `${defId}：必须在 OFFICIAL_PARTS 里`).toContain(defId);
      expect(isWeaponDefId(defId), `${defId}：必须是武器（category === 'weapon'）`).toBe(true);
      // ② Snapshot 能解析（正式 registry 里有定义）
      const def = registry.functionals.get(defId);
      expect(def, `${defId}：必须能在正式 registry 里解析`).toBeDefined();
      // ③ 对应 behavior Runtime 真存在
      expect(
        getBehaviorFactory(def!.behavior),
        `${defId} 的 behavior "${def!.behavior}" 必须有工厂`,
      ).toBeDefined();
    }
    // 必改 3 明令：不许写成「全部 OFFICIAL_PARTS」
    expect(FULL_RUN_SUPPORTED_WEAPON_IDS.length).toBeLessThan(OFFICIAL_PARTS.length);
    /*
      反例必须真的存在（否则上面的门槛是空转）：玩家可拥有但**未被登记**的恰好 2 件 ——
        - `spear`：③ 不满足（`behavior === 'ram'` 没有工厂）；
        - `saw`：④/⑤ 不满足（R6-BATCH 实测：产品主武器槽 `frontMass` 上圆锯 collider
          整体落在车身内 ⇒ 0 命中 / 0 伤害；既有测试全部挂 `front` 所以此前没被发现）。
      ⇒ 这两件的拒绝理由**都**在下面的 `R6-BATCH` 逐条测试里机器钉死。
    */
    const rejected = OFFICIAL_PARTS.filter(
      (p) => isWeaponDefId(p) && !FULL_RUN_SUPPORTED_WEAPON_IDS.includes(p),
    );
    expect(rejected).toEqual(['spear', 'saw']);
    // 且它们被拒的理由分别是 ③ / ④
    expect(getBehaviorFactory(registry.functionals.get('spear')!.behavior)).toBeUndefined();
    expect(
      FULL_RUN_SUPPORTED_WEAPON_IDS.includes('saw'),
      'saw 的 Runtime 齐但产品槽打不到人 ⇒ 必须保持不登记',
    ).toBe(false);
  });

  it('R6-10 **验收 E**｜禁止 silent fallback：base 只能来自装备，两层判据都不许退回某件武器', () => {
    // ① 解析器里不得出现任何武器 id 字面量（不许「找不到就退回某件武器」）
    const mods = strip(readLab('runModifiers.ts'));
    const resolveAt = mods.indexOf('export function resolveRunBaseWeaponDefId(');
    expect(resolveAt, 'resolveRunBaseWeaponDefId 必须存在').toBeGreaterThan(-1);
    const resolveBody = mods.slice(resolveAt, mods.indexOf('\n}', resolveAt));
    expect(resolveBody.includes("'cannon'"), '解析器不得写死 cannon').toBe(false);
    expect(
      resolveBody.includes('RUN_BASE_WEAPON_DEF_ID'),
      '解析器不得退回 R2 归属武器（那是强化体系的字段，不是 Run 的基准武器）',
    ).toBe(false);
    // ② 产品侧判据必须落在 base（装配顺序第一件）上，而不是「车上存在某件受支持武器」
    const compat = strip(readProduct('runCompatibility.ts'));
    const fnAt = compat.indexOf('export function fullRunCompat(');
    expect(fnAt).toBeGreaterThan(-1);
    const body = compat.slice(fnAt, compat.indexOf('\n}', fnAt));
    expect(body, '判据必须读 baseWeaponDefId').toContain('baseWeaponDefId');
    expect(body.includes('some('), '不得退回「存在性」判据（会与局内 base 分叉）').toBe(false);
  });

  it('R6-10b 「车上没有武器」不得被静默替换成某件武器（返回 null，交给资格层拒绝）', () => {
    const bare: BuildDraft = { ...defaultPlayerDraft(), functionalSelections: {} };
    const snap = snapOf(bare);
    expect(resolveRunBaseWeaponDefId(snap, registry), '没有武器 ⇒ null').toBeNull();
    // 注入路径原样返回 / 正式副本（不 throw、也**不**偷偷塞一件武器进去）
    expect(applyRunModifiersToSnapshot(snap, ['heavyShell'], true, null)).toBe(snap);
    const reg = createRunRegistry(['heavyShell'], true, null);
    expect(extraKeysOf(reg)).toEqual([]);
  });

  it('R6-11 **门槛 ④**｜真实物理 smoke：每件登记武器都跑得起来（Collision / Damage / Result 不崩）', () => {
    const rows: string[] = [];
    for (const defId of FULL_RUN_SUPPORTED_WEAPON_IDS) rows.push(smokeRun(defId));
    expect(rows.length, '每件登记武器都要真的跑一遍').toBe(FULL_RUN_SUPPORTED_WEAPON_IDS.length);
  });
});
