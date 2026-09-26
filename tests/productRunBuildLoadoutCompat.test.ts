/**
 * PRODUCT-LOOP-P0-RUN-BUILD-LOADOUT-COMPATIBILITY｜Run Loadout 兼容性（真人 Runtime P0）。
 *
 * ── 本文件锁的缺陷 ─────────────────────────────────────────────────────────
 * 正式产品允许玩家装备非 Cannon Weapon，而**已真人验证的 Run Build 内容全部围绕 cannon 派生**
 * （`heavyShell` / `twinCannon` / `fastReload` / `kineticBurst` / `tripleLoad`）。真实复现：
 *
 *     equipped = 非 cannon → Run 前几日正常 → DAY3 选择/进入 heavyShell → beginBattle
 *     → `applyRunModifiersToSnapshot()` 找不到 cannon
 *     → throw：RunModifier: 本局装载里没有 "cannon"，无法注入强化 [heavyShell] → Run 卡死
 *
 * 强化注入发生在**第二次**战斗创建时，所以「非 cannon 的第一场 Battle」（R1-C 唯一验证过的那条）
 * **看不出**这个缺陷 —— 这正是漏测的形状。
 *
 * ── 五条必改分别由哪些用例钉死 ──────────────────────────────────────────────
 *   必改 1（单一产品层判断）  → LC-01 / LC-02 / LC-03 / LC-04
 *   必改 2（首页开始冒险守门）→ LC-02 / LC-05 / LC-20（源码）
 *   必改 3（Garage 可识别）   → LC-04 / LC-20（源码）
 *   必改 4（Run 创建第二层防线）→ LC-05 / LC-06 / LC-07 / LC-21（源码）
 *   必改 5（RunModifier invariant 保留）→ LC-11 / LC-12 / LC-22（源码）
 *   必改 6（Case A–E）        → LC-10（A）/ LC-02+LC-05（B、C）/ LC-05（D）/ LC-11（E）
 *
 * ⚠️ 本文件同时是**冻结项**的守卫（LC-23）：没有新 Spear / Hammer Buff、没有改任何
 *    既有 Run 强化、没有给非 cannon 偷偷补 cannon。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { registry } from '../src/core/content';
import { OFFICIAL_PARTS } from '../src/core/partInventory';
import { buildSnapshotFromDraft, type BuildDraft } from '../src/lab/buildEditorModel';
import { validateSnapshot } from '../src/core/buildValidator';
import {
  RUN_BASE_WEAPON_DEF_ID,
  RUN_LAYER1_POOL,
  RUN_MODIFIERS,
  RUN_MODIFIER_OVERLAY,
  applyRunModifiersToSnapshot,
  resolveRunBaseWeaponDefId,
  runOverlayDefId,
  snapshotHasRunBaseWeapon,
} from '../src/lab/portraitBattleLab/runModifiers';
import { runLoadoutCompatOfDraft } from '../src/lab/portraitBattleLab/runLoadoutCompat';
import { resolveRunPlayerLoadout } from '../src/lab/portraitBattleLab/runPageScene';
import { RunBattleRuntime } from '../src/lab/portraitBattleLab/runBattleRuntime';
import {
  FULL_RUN_NO_WEAPON_LEAD,
  FULL_RUN_SUPPORTED_WEAPON_IDS,
  FULL_RUN_UNSUPPORTED_HINT,
  FULL_RUN_UNSUPPORTED_LEAD,
  canStartFullRun,
  fullRunCompat,
  supportsFullRun,
} from '../src/product/runCompatibility';
import { PLAYER_BODY_DEF_ID, WEAPON_SLOT, defaultPlayerDraft } from '../src/product/playerLoadout';
import {
  REWARD_CHOICE_IDS,
  buildAdventureHref,
  buildRewardChoicePayload,
} from '../src/product/runReward';
import { FUSE_STACK, GROWTH_STAR } from '../src/product/playerGrowth';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PRODUCT_DIR = join(REPO_ROOT, 'src', 'product');
const LAB_DIR = join(REPO_ROOT, 'src', 'lab', 'portraitBattleLab');

const readProduct = (f: string): string => readFileSync(join(PRODUCT_DIR, f), 'utf8');
const readLab = (f: string): string => readFileSync(join(LAB_DIR, f), 'utf8');
/** 剥掉注释（守卫必须扫**代码**，不能扫到解释性文字）。 */
const strip = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/* --------------------------------------------------------------- 夹具 */

/**
 * PRODUCT-LOOP-R6 之后夹具的划分变了（契约变更，不是放宽）：
 *   - `SUPPORTED` = 能力登记表里的任一件（下面从真源现读，不再写死 cannon）；
 *   - `UNSUPPORTED` = **Runtime 不完整**的武器（`spear` 的 `behavior === 'ram'`
 *     在 `behaviorRegistry.FACTORIES` 里没有工厂）—— 它仍然是**合法武器**，
 *     只是跑不了完整 Run（必改 D）。改前 hammer 也在这一组，现在它在登记表里。
 */
const SUPPORTED = 'cannon';
const UNSUPPORTED: readonly string[] = ['spear'];

/**
 * 「玩家身上那件装备」= 产品侧真实默认车 + 主武器槽换成指定武器。
 *
 * ⚠️ 用 `defaultPlayerDraft()` 做底（产品**真的会发出去**的那台车），而不是
 *    `makeStarterDraft`：R1-C 起两者在 `front` 槽上不同，夹具必须跟着产品走。
 * ⚠️ 每份夹具都先过正式 `validateSnapshot`：否则「拒绝」可能只是因为装备本身非法，
 *    那样这些用例就证明不了「**合法**但不被支持」这件事。
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

/** 产品侧真实产出的出发地址（不手写参数）。 */
function adventureHref(draft?: BuildDraft | null, token = 'run-p0-00001'): string {
  const specs = REWARD_CHOICE_IDS.map((defId) => ({ defId, star: GROWTH_STAR, countBefore: 0 }));
  return buildAdventureHref(token, buildRewardChoicePayload(token, specs, FUSE_STACK), draft);
}

const searchOf = (draft?: BuildDraft | null): string => adventureHref(draft).split('?')[1] ?? '';

/* ============================================================================
   A. 产品层「单一判断」（必改 1）
   ============================================================================ */

describe('PRODUCT-LOOP-P0｜A. 产品层单一判断 canStartFullRun（必改 1）', () => {
  it('LC-01 支持清单 = **显式能力登记**（不是全部正式部件），且每项都必须是正式武器', () => {
    /*
      PRODUCT-LOOP-R6 起这里**不再**断言「清单 = [RUN_BASE_WEAPON_DEF_ID]」——
      那是契约变更：清单的语义已从「Run 硬绑的那一件」变成「**经过能力登记、可以跑完整 Run
      的武器**」，而 `RUN_BASE_WEAPON_DEF_ID` 现在的语义是「R2 武器强化体系的归属武器」（= cannon）。
      ⇒ 换成两条**更强**的断言：① 每项都是正式武器；② 清单 ≠ 全部正式部件（必改 3 明令）。
    */
    for (const defId of FULL_RUN_SUPPORTED_WEAPON_IDS) {
      expect(registry.functionals.get(defId)?.category, `${defId} 必须是正式武器`).toBe('weapon');
      expect(OFFICIAL_PARTS, `${defId} 必须在正式可拥有部件里`).toContain(defId);
    }
    // 必改 3：**明确禁止**「= 所有 OFFICIAL_PARTS」（那是含 Gadget 的 11 件）
    expect(FULL_RUN_SUPPORTED_WEAPON_IDS.length).toBeLessThan(OFFICIAL_PARTS.length);
    // cannon 必须仍在其列（R2 强化体系的原生武器，现有产品闭环依赖它）
    expect(FULL_RUN_SUPPORTED_WEAPON_IDS).toContain(RUN_BASE_WEAPON_DEF_ID);
  });

  it('LC-02 **Case B / Case C**：Runtime 不完整的武器一律不支持；登记表内的武器全部放行', () => {
    expect(canStartFullRun(equippedDraft(SUPPORTED)), 'cannon 必须可以开始完整 Run').toBe(true);
    for (const defId of UNSUPPORTED) {
      const compat = fullRunCompat(equippedDraft(defId));
      expect(compat.ok, `${defId} 不得被判定为支持完整 Run`).toBe(false);
      expect(compat.reason, `${defId} 的拒绝原因`).toBe('unsupported-weapon');
      // 不受支持 ≠ 非法：装备本身仍然过正式校验、仍然可以拥有 / 装备（必改 3）
      expect(supportsFullRun(defId)).toBe(false);
      expect(registry.functionals.get(defId)?.category).toBe('weapon');
      expect(OFFICIAL_PARTS, `${defId} 是正式可拥有武器，只是跑不了完整 Run`).toContain(defId);
    }
    // 反向：清单里有的就必须放行（防止「一律拒绝」也能让上面的断言通过）
    for (const defId of FULL_RUN_SUPPORTED_WEAPON_IDS) {
      expect(canStartFullRun(equippedDraft(defId)), `${defId} 必须放行`).toBe(true);
    }
    // 契约变更的**正面取证**：改前被拒、现在放行的那几件（各自用自己的 canonical Def 跑）
    for (const defId of ['hammer', 'laser', 'saw']) {
      expect(canStartFullRun(equippedDraft(defId)), `${defId} 现在必须放行`).toBe(true);
    }
  });

  it('LC-03 判据来自真实 BuildDraft / 正式分类字段，不是字符串（必改 1 明令）', () => {
    const compat = fullRunCompat(equippedDraft('spear'));
    // 读数来自真实装配（`functionalSelections` 逐槽解析），能报出「车上到底有什么武器」
    expect(compat.equippedWeaponIds).toContain('spear');
    // 支持清单的展示名从**正式内容库**现读，不是页面里的第二份字面量
    expect(compat.supportedWeaponNames).toEqual(
      FULL_RUN_SUPPORTED_WEAPON_IDS.map((id) => registry.functionals.get(id)?.name),
    );
    // 空武器（车上没有任何 weapon）⇒ 「没有武器」与「有武器但不支持」必须分得开
    const noWeapon: BuildDraft = { ...defaultPlayerDraft(), functionalSelections: {} };
    const bare = fullRunCompat(noWeapon);
    expect(bare.ok).toBe(false);
    expect(bare.reason).toBe('no-weapon');
    expect(bare.equippedWeaponIds).toEqual([]);
  });

  it('LC-04 提示文案：三种 reason 各自对应；可执行时两条都为 null（不画多余提示）', () => {
    // ① 有武器、但这件武器 Runtime 不完整（spear）⇒ 「不支持这件武器」
    const unsupported = fullRunCompat(equippedDraft('spear'));
    expect(unsupported.notice).toBe('当前原型尚不支持这件武器进行完整冒险');
    expect(unsupported.notice).toBe(FULL_RUN_UNSUPPORTED_LEAD);
    expect(unsupported.hint).toBe('请先调整战车');
    expect(unsupported.hint).toBe(FULL_RUN_UNSUPPORTED_HINT);
    // ② 车上**没有武器** ⇒ 与 ① 分开说（文案必须不同，否则玩家找不到原因）
    const bare = fullRunCompat({ ...defaultPlayerDraft(), functionalSelections: {} });
    expect(bare.reason).toBe('no-weapon');
    expect(bare.notice).toBe('车上还没有武器，无法开始完整冒险');
    expect(bare.notice).toBe(FULL_RUN_NO_WEAPON_LEAD);
    expect(bare.notice).not.toBe(FULL_RUN_UNSUPPORTED_LEAD);
    // ③ 可执行 ⇒ 两条都是 null
    const good = fullRunCompat(equippedDraft('cannon'));
    expect(good.notice).toBeNull();
    expect(good.hint).toBeNull();
  });
});

/* ============================================================================
   B. Run 创建资格（必改 4）—— 绕过产品首页也不能走到 DAY3 才炸
   ============================================================================ */

describe('PRODUCT-LOOP-P0｜B. Run 创建资格（必改 4）', () => {
  it('LC-05 **Case B / C / D**：不兼容装载在 **Run 创建前** 被拒绝，且结果结构化', () => {
    for (const defId of UNSUPPORTED) {
      const res = resolveRunPlayerLoadout(searchOf(equippedDraft(defId)));
      expect(res.blocked, `${defId} 必须禁止创建 Run`).toBe(true);
      expect(res.fallback).toBe('unsupported-loadout');
      // 拒绝理由 = **Runtime 不完整**（不是「不是 cannon」，也不是「没有武器」）—— 必改 D
      expect(res.blockedReason).toBe('no-weapon-runtime');
    }
    // Case D 的原形：旧 URL / stale href 里手工塞一份不兼容装载 —— 与「产品侧产出」无关，
    // 只要 search 里是它就必须被拒绝（这正是「测试入口 / 旧 Profile」那条路径）。
    const stale = `?equipped=${encodeURIComponent(
      JSON.stringify({
        bodyDefId: PLAYER_BODY_DEF_ID,
        rearRadius: 20,
        frontRadius: 20,
        functionalSelections: { frontMass: 'spear' },
        drive: 'forward',
      }),
    )}`;
    const res = resolveRunPlayerLoadout(stale);
    expect(res.blocked).toBe(true);
    expect(res.fallback).toBe('unsupported-loadout');
  });

  it('LC-06 被拒绝时**绝不**把玩家那份不兼容装载交回去（防「忽略 blocked ⇒ 照常开战」）', () => {
    /*
      这是本 Queue 最容易被写错的一行：如果这里返回的是**玩家那份**装载，
      调用方一旦漏看 `blocked`，就会退化成「照常开战，然后在 DAY3 崩」——
      正是要根除的形态。因此这里断言返回的是演示装载（占位），且它与玩家那份**不同**。
    */
    for (const defId of UNSUPPORTED) {
      const res = resolveRunPlayerLoadout(searchOf(equippedDraft(defId)));
      expect(res.loadout.source).toBe('demo');
      expect(res.loadout.draft.functionalSelections[WEAPON_SLOT]).not.toBe(defId);
    }
  });

  it('LC-07 cannon 的正常闭环不受影响（既不 blocked、也不降级）', () => {
    const res = resolveRunPlayerLoadout(searchOf(equippedDraft('cannon')));
    expect(res.blocked).toBe(false);
    expect(res.blockedReason).toBeNull();
    expect(res.fallback).toBe('none');
    expect(res.loadout.source).toBe('profile');
    expect(res.loadout.draft.functionalSelections[WEAPON_SLOT]).toBe('cannon');
  });

  it('LC-08 研发入口（不带装备参数）与「带了但坏了」两条既有路径**一字未变**', () => {
    const noParam = resolveRunPlayerLoadout('');
    expect(noParam.blocked).toBe(false);
    expect(noParam.fallback).toBe('no-param');
    const broken = resolveRunPlayerLoadout('?equipped=%7Bnot-json');
    expect(broken.blocked).toBe(false);
    expect(broken.fallback).toBe('invalid');
  });
});

/* ============================================================================
   C. 真实战斗创建（Case A / Case E）
   ============================================================================ */

describe('PRODUCT-LOOP-P0｜C. 真实战斗创建（必改 6 的 Case A / Case E）', () => {
  it('LC-10 **Case A**：cannon + heavyShell ⇒ 下一场战斗正常创建（强化真的注进去了）', () => {
    /*
      Case A 的全链是「cannon → 可以开始 Run → DAY3 heavyShell → 下一场正常创建」。
      「下一场正常创建」的真实形态就是宿主那句
      `new RunBattleRuntime({ build: runBuildIds(state), playerDraft: loadout.draft, … })`
      —— 本用例按**逐字段相同**的构造复现它：装载 = cannon、build 里已经有 heavyShell。
    */
    const draft = equippedDraft('cannon');
    const rt = new RunBattleRuntime({
      build: [RUN_LAYER1_POOL[0]],
      carriedHp: null,
      encounterId: 'ProtoRusher',
      playerDraft: draft,
      playerLoadoutTag: 'profile-equipped',
    });
    try {
      /*
        怎么证明「强化真的注进去了」——
        ⚠️ **不能**用 `playerFunctionals()` / `playerWeapons()` 的 `defId`：它们读的是
           `orchestrator.vehicleA.parts[].def.id`，而 overlay 部件是 `{...正式cannon}` 派生出来的
           ⇒ 它的 `id` 字段**仍然是 `'cannon'`**（只有 registry 的**键**是 overlay id）。
        真正的证据在 `playerSnapshot.functionals[].defId`：那正是
        `applyRunModifiersToSnapshot()` 把基准武器重映射过去的结果（R2-C 起的既有口径）。
      */
      const slot = rt.playerSnapshot.functionals.find((f) => f.hardpointId === WEAPON_SLOT);
      expect(slot?.defId, '基准武器的 defId 必须已被重映射到本局 overlay 件').toBe(
        runOverlayDefId('heavyShell'),
      );
      expect(slot?.defId).not.toBe(RUN_BASE_WEAPON_DEF_ID);
      // 战斗世界真的建起来了（不是「没抛错就算过」）
      expect(rt.playerWeapons().length).toBeGreaterThan(0);
      expect(rt.result).toBeNull();
    } finally {
      rt.dispose();
    }
  });

  it('LC-11 **Case E（结构性守卫）**：Cannon 的武器强化不会被注入到别的武器上', () => {
    /*
      PRODUCT-LOOP-R6 起这条断言的**对象变了**：改前它钉的是「heavyShell + 没有 cannon ⇒ throw」
      （那时基准武器硬绑 cannon）；现在基准武器 = 装备本身，所以真正要钉的是**必改 2**：
      `heavyShell` 这套 overlay 属于 Cannon（behavior / 字段名全是 Cannon 的），
      装备 Hammer 时它**一项都不适用** —— 不得把 Cannon 的 behavior / projectile / recoil
      套到 Hammer 上，也不得把 Hammer 的件改写成 Cannon 的 overlay。
    */
    const rt = new RunBattleRuntime({
      build: ['heavyShell'],
      carriedHp: null,
      encounterId: 'ProtoRusher',
      playerDraft: equippedDraft('hammer'),
      playerLoadoutTag: 'profile-equipped',
    });
    try {
      const slot = rt.playerSnapshot.functionals.find((f) => f.hardpointId === WEAPON_SLOT);
      expect(slot?.defId, 'Hammer 必须用它自己的 canonical Def').toBe('hammer');
      expect(slot?.defId, '不得被重映射到 Cannon 的 overlay 件').not.toBe(
        runOverlayDefId('heavyShell'),
      );
      expect(slot?.defId).not.toBe(RUN_BASE_WEAPON_DEF_ID);
      // 战斗世界真的建起来了（不是「没抛错就算过」）
      expect(rt.playerWeapons().length).toBeGreaterThan(0);
    } finally {
      rt.dispose();
    }
  });

  it('LC-12 创建期资格与运行时判据**同源**（不可能一处放行、另一处拒绝）', () => {
    /*
      同源现在有两层含义，两层都必须成立：
        ① 「基准武器」两侧解析的是**同一件事**（装配顺序第一件正式武器）；
        ② 「放行」在局内资格与产品登记表之间一致（都由 Runtime 存在性决定）。
      ⚠️ 创建期资格不再与「注入会不会 throw」互为反面 —— 非 Cannon 装备的合法装载
         **既不 throw 也不放行到别的武器**（武器项不适用），这与「拒绝创建」是两件事。
    */
    for (const defId of ['cannon', 'hammer', 'laser', 'saw', ...UNSUPPORTED]) {
      const draft = equippedDraft(defId);
      const snap = buildSnapshotFromDraft(draft, registry, 'lc');
      // ① 基准武器 = 装备的那一件；装载里有可运行武器
      const base = resolveRunBaseWeaponDefId(snap, registry);
      expect(base, `${defId}：基准武器必须解析出来`).toBe(defId);
      expect(snapshotHasRunBaseWeapon(snap, registry), `${defId}：装载里有正式武器`).toBe(true);
      // ② 注入路径永不 throw（没有『找不到 cannon』这条理由了）+ 放行 ⇔ 登记表
      expect(() => applyRunModifiersToSnapshot(snap, 'heavyShell', false, base)).not.toThrow();
      const ok = runLoadoutCompatOfDraft(draft).ok;
      expect(ok, `${defId}：局内资格必须与产品登记表一致`).toBe(supportsFullRun(defId));
    }
    // 相机 / 辅助件不构成「有基准武器」（判据只看武器的那一件）
    expect(
      snapshotHasRunBaseWeapon(
        buildSnapshotFromDraft(equippedDraft('cannon'), registry, 'lc'),
        registry,
      ),
    ).toBe(true);
  });
});

/* ============================================================================
   D. 源码守卫（必改 1 / 2 / 3 / 4 / 5 + 冻结项）
   ============================================================================ */

describe('PRODUCT-LOOP-P0｜D. 源码守卫', () => {
  it('LC-20 首页 / 车库都不许自己判断武器（必改 1：不在 UI 里靠字符串判断）', () => {
    const home = strip(readProduct('homePage.ts'));
    // 必须走产品层那一个判断
    expect(home).toContain('fullRunCompat');
    // 不许出现「支持清单」或任何武器 id 的比较（页面不自列武器、不自判支持性）
    expect(home.includes('FULL_RUN_SUPPORTED_WEAPON_IDS')).toBe(false);
    for (const w of ['cannon', 'spear', 'hammer', 'laser', 'saw']) {
      for (const q of [`'${w}'`, `"${w}"`]) {
        expect(home.includes(q), `homePage 不应出现武器 id 字面量 ${q}（应走 fullRunCompat）`).toBe(false);
      }
    }
    // ⚠️ 刻意**不**断言「页面里不许出现 category === 'weapon'」：那是**展示**用途
    //    （槽位标签画「武器 / 辅助」），与「这件武器支不支持完整 Run」是两个问题。
  });

  it('LC-21 宿主在**创建 RunPage 之前**拒绝（必改 4 的「创建前」是位置要求，不是文案要求）', () => {
    const boot = strip(readLab('runMain.ts'));
    const guardAt = boot.indexOf('playerLoadout.blocked');
    const createAt = boot.indexOf('new RunPage(');
    expect(guardAt, 'runMain 必须有 blocked 分支').toBeGreaterThan(-1);
    expect(createAt, 'runMain 必须仍然创建 RunPage（正常路径）').toBeGreaterThan(-1);
    expect(guardAt, '守门必须出现在 new RunPage 之前').toBeLessThan(createAt);
    // 而且守门分支必须在创建之前**返回**（不许「先建了再补一句警告」）
    const between = boot.slice(guardAt, createAt);
    expect(between.includes('return'), 'blocked 分支必须在创建 RunPage 之前 return').toBe(true);
    /*
      拒绝态的**呈现**被抽到独立模块 —— 因为 `RP-25b` 对**宿主**有更严的约束：
        `runMain.ts` 必须恰好两次 `location.assign(`，且**不得出现 `createElement`**
        （宿主只做编排，不造 DOM）。所以「拒绝态不许有 button」这条要分两处看：
        「谁在造 DOM」和「造出来的 DOM 里有没有控件」。
    */
    expect(boot, '宿主必须把拒绝态交给独立视图（不得自己造 DOM）').toContain('renderRunBlocked(');
    expect(boot.includes('createElement'), '宿主不得 createElement（RP-25b）').toBe(false);
    const view = strip(readLab('runBlockedView.ts'));
    expect(view, '拒绝态视图必须真的存在并导出').toContain('export function renderRunBlocked(');
    // 拒绝态不引入测试控件（`e2e:encounter-lab` 的 J4 钉死玩家页面没有 button）
    for (const [name, code] of [
      ['runMain.ts', boot],
      ['runBlockedView.ts', view],
    ] as const) {
      expect(code.includes("createElement('button')"), `${name} 不得出现 createElement('button')`).toBe(false);
    }
  });

  it('LC-22 applyRunModifiersToSnapshot 的 invariant 保留：不许 try/catch 吞、不许静默返回（必改 5）', () => {
    const code = strip(readLab('runModifiers.ts'));
    const fnAt = code.indexOf('export function applyRunModifiersToSnapshot(');
    expect(fnAt).toBeGreaterThan(-1);
    const body = code.slice(fnAt, code.indexOf('\n}', fnAt));
    expect(body, '必须仍然显式抛错').toContain('throw new Error');
    expect(body, '不许 try/catch').not.toContain('catch');
    /*
      PRODUCT-LOOP-R6：判据从「有没有 cannon」变成「有没有**参数传进来的**基准武器」——
      因此守卫跟着换成两条更强的：
        ① 基准武器只能来自参数（不许写死某件武器）；
        ② 注入路径里**不得再出现** `'cannon'` 字面量（否则「装备什么就跑什么」就可能被写死的东西劫持）。
      「装载里有没有基准武器」这个**判据本体**仍然存在且共享（创建期资格用的是同一份解析）。
    */
    expect(body, '基准武器必须来自参数').toContain('baseWeaponDefId');
    expect(body.includes("'cannon'"), '注入路径不得出现写死的 cannon 字面量').toBe(false);
    expect(code).toContain('export function snapshotHasRunBaseWeapon(');
    expect(code).toContain('export function resolveRunBaseWeaponDefId(');
  });

  it('LC-23 冻结项：没有新 Spear / Hammer Buff，既有 Run 强化一字未改', () => {
    // 第一层仍然恰好三项，且仍是它们（不许为了本 P0 塞第四个）
    expect(RUN_MODIFIERS.map((m) => m.id)).toEqual(['heavyShell', 'twinCannon', 'fastReload']);
    expect(RUN_LAYER1_POOL).toEqual(['heavyShell', 'twinCannon', 'fastReload']);
    // overlay 数值表的键集不变 ⇒ 没有任何新增的、针对 spear / hammer 的强化
    expect(Object.keys(RUN_MODIFIER_OVERLAY).sort()).toEqual(
      ['emergencyRepair', 'fastReload', 'heavyShell', 'kineticBurst', 'tripleLoad', 'twinCannon'].sort(),
    );
    for (const id of Object.keys(RUN_MODIFIER_OVERLAY)) {
      expect(/spear|hammer|pike|lance/i.test(id), `${id} 看起来像新武器专属 Buff`).toBe(false);
    }
    // R2 强化体系的**归属武器**仍是 cannon（不许给别的武器偷偷补一套强化）
    expect(RUN_BASE_WEAPON_DEF_ID).toBe('cannon');
    // 每一个「改武器数值」的 overlay 仍然只声明 Cannon 的 behavior ⇒ 不会渗到别的武器上
    for (const id of Object.keys(RUN_MODIFIER_OVERLAY) as (keyof typeof RUN_MODIFIER_OVERLAY)[]) {
      const overlay = RUN_MODIFIER_OVERLAY[id];
      if (overlay.affectsWeapon) expect(overlay.behavior).toBe('cannon');
    }
    // spear 仍被明确拒绝 —— 但**理由已从「不是 cannon」变成「Runtime 不完整」**（必改 D）
    expect(FULL_RUN_SUPPORTED_WEAPON_IDS).not.toContain('spear');
  });
});
