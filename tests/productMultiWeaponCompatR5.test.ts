/**
 * PRODUCT-LOOP-R5-MULTI-WEAPON-PRODUCT-COMPAT-R1｜**多武器产品兼容性的统一矩阵**。
 *
 * ── 这个文件补的是什么（不是重复既有守卫）──────────────────────────────────
 * `tests/productRunBuildLoadoutCompat.test.ts`（LC-01…LC-23）钉的是**契约本身**
 * （单一判断 / 守门 / 拒绝形状 / 冻结项），但它的不受支持样本是**手写 4 件**
 * （`spear` / `hammer` / `laser` / `saw`）。R5 的内容池把正式武器扩到 9 件之后，
 * 「还有没有第 5 件悄悄被放行 / 悄悄被拒」就没有守卫回答了。
 *
 * 本文件把它换成**真源驱动**：集合一律从 `weaponDefs()`（正式 registry）与
 * `OFFICIAL_PARTS` **现读**，遍历**全部**武器逐件审，任何新增武器会**自动**进入矩阵。
 *
 * ── 本 Queue 的三条要求分别落在哪 ────────────────────────────────────────────
 *   Home：已支持可进 Run / 未支持明确阻止 / **禁 silent fallback 到 Cannon** /
 *         **禁自动替玩家换 Cannon**        → MW-02 / MW-03 / MW-04 / MW-05 / MW-09
 *   Run：每个已支持武器都走自己的真实 Runtime → MW-04（`source==='profile'` 逐件）
 *   Fusion：多武器库存不破坏现有 Fusion      → MW-08 / MW-08b
 *   （Garage 四槽 / 点卡即装备 / 当前武器名同步 / reload 保持 / Body·rear·front 不覆盖
 *     —— 已由 `tests/productGarageMobileInteraction.test.ts` 的 GS-01…GS-26 与
 *     `_e2e_product_home.cjs` 钉死，本文件不重复造第二条口径。）
 *
 * ── ⚠️ 两个容易搞错的真源事实（本文件用断言把它们钉住，而不是靠注释）──────────
 *   ① `weaponDefs()` = **10 件**：registry 里 `category === 'weapon'` 的**全部**定义，
 *      **含 `ramHead`（冲撞头）** —— 它有武器定义但**不在** `OFFICIAL_PARTS` 里
 *      ⇒ `isOfficialPart('ramHead') === false` ⇒ **玩家永远拿不到**（不进任何库存）。
 *      「本批次可接入的武器」= `OFFICIAL_PARTS` 的武器子集 = **9 件**（MW-01）。
 *   ② 判据是**存在性**（车上有没有基准武器），**不是**「主武器槽是不是 cannon」
 *      ⇒ 不支持武器占主武器槽、但车上另有 cannon 时必须**放行**，且装载**逐字节不被改写**
 *      （MW-06 —— 这正是「不许自动换炮」在语义层的对照面）。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it } from 'vitest';

import { validateSnapshot } from '../src/core/buildValidator';
import { registry } from '../src/core/content';
import { INVENTORY_MAX_STAR, OFFICIAL_PARTS, addPart, getCount, isOfficialPart } from '../src/core/partInventory';
import { buildSnapshotFromDraft, type BuildDraft } from '../src/lab/buildEditorModel';
import { snapshotHasRunBaseWeapon, RUN_BASE_WEAPON_DEF_ID } from '../src/lab/portraitBattleLab/runModifiers';
import { runLoadoutCompatOfDraft } from '../src/lab/portraitBattleLab/runLoadoutCompat';
import { resolveRunPlayerLoadout } from '../src/lab/portraitBattleLab/runPageScene';
import {
  FULL_RUN_SUPPORTED_WEAPON_IDS,
  canStartFullRun,
  fullRunCompat,
  supportsFullRun,
} from '../src/product/runCompatibility';
import {
  WEAPON_SLOT,
  defaultPlayerDraft,
  equippedWeaponId,
  isWeaponDefId,
  weaponDefs,
  weaponEntries,
} from '../src/product/playerLoadout';
import { REWARD_CHOICE_IDS, buildAdventureHref, buildRewardChoicePayload } from '../src/product/runReward';
import {
  FUSE_STACK,
  GROWTH_MAX_STAR,
  GROWTH_STAR,
  canFuseStack,
  fuseStack,
  openGrowthSession,
} from '../src/product/playerGrowth';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PRODUCT_DIR = join(REPO_ROOT, 'src', 'product');
const SRC_DIR = join(REPO_ROOT, 'src');

const readProduct = (f: string): string => readFileSync(join(PRODUCT_DIR, f), 'utf8');
/** 源码守卫必须先剥注释（本项目铁律：注释里「提到」某个标识符不等于「用了」它）。 */
const strip = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/** `src/` 下全部 `.ts`（递归）。 */
function walkTs(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkTs(p, out);
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** 全 `src/` 里某个常量**被声明**了几次（剥注释后；用来钉死「唯一真源」）。 */
function declarationCount(name: string): number {
  const re = new RegExp(`${name}\\s*[:=]`, 'g');
  let n = 0;
  for (const f of walkTs(SRC_DIR)) {
    const hits = strip(readFileSync(f, 'utf8')).match(re);
    if (hits) n += hits.length;
  }
  return n;
}

/* --------------------------------------------------------------- 夹具（真源现读） */

/** registry 里的**全部**正式武器定义（含玩家拿不到的 `ramHead`）—— 10 件。 */
const REGISTRY_WEAPONS: readonly string[] = weaponDefs().map((d) => d.id);
/** 玩家**可拥有**的正式武器 = `OFFICIAL_PARTS` 的武器子集 —— 9 件。 */
const OWNED_WEAPONS: readonly string[] = OFFICIAL_PARTS.filter(isWeaponDefId);
/** 不受支持的那些（= 全部武器 − 支持清单）。**不手写**：新增武器自动进入。 */
const UNSUPPORTED_WEAPONS: readonly string[] = REGISTRY_WEAPONS.filter((id) => !supportsFullRun(id));
/** 辅助件（不是武器）—— 用来证明「不参与武器成长合成」。 */
const GADGETS: readonly string[] = OFFICIAL_PARTS.filter((p) => !isWeaponDefId(p));

/** 内存版 localStorage（node 无原生；与本项目其它产品侧测试同一模式）。 */
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
  /** 全量键（排序）—— `storageSnapshot()` 用它做「一个字节都没写」的对账。 */
  keys(): string[] {
    return [...this.m.keys()].sort();
  }
}

let store: MemStorage;

beforeEach(() => {
  store = new MemStorage();
  (globalThis as unknown as { localStorage: MemStorage }).localStorage = store;
});

/**
 * 「玩家身上那件装备」= 产品侧真实默认车 + 主武器槽换成指定武器。
 *
 * ⚠️ 用 `defaultPlayerDraft()` 做底（产品**真的会发出去**的那台车），并**逐份过正式
 *    `validateSnapshot`** —— 否则「拒绝」可能只是因为装备本身非法，证明不了
 *    「**合法**但不被支持」。
 */
function draftWithWeapon(defId: string): BuildDraft {
  return draftWithSelections({ [WEAPON_SLOT]: defId });
}

/** 同上，但可同时指定多个挂点（用于混合装载 / 只挂辅助件的夹具）。 */
function draftWithSelections(sel: Record<string, string>): BuildDraft {
  const base = defaultPlayerDraft();
  const next: BuildDraft = {
    ...base,
    functionalSelections: { ...base.functionalSelections, ...sel },
  };
  const check = validateSnapshot(buildSnapshotFromDraft(next, registry), registry);
  expect(check.valid, `夹具本身必须合法：${JSON.stringify(sel)} → ${check.errors.join('；')}`).toBe(true);
  return next;
}

/** 产品侧真实产出的出发地址（不手写参数）。 */
function searchOf(draft: BuildDraft): string {
  const token = 'run-mw-00001';
  const specs = REWARD_CHOICE_IDS.map((defId) => ({ defId, star: GROWTH_STAR, countBefore: 0 }));
  return buildAdventureHref(token, buildRewardChoicePayload(token, specs, FUSE_STACK), draft).split('?')[1] ?? '';
}

/** 全量存储快照（键 + 值，键序归一）—— 用来证明「读取路径零写入」。 */
function storageSnapshot(): string {
  const keys = [...store.keys()].sort();
  return JSON.stringify(keys.map((k) => [k, store.getItem(k)]));
}

/* ============================================================================
   A. canonical 内容集合（真源现读）
   ============================================================================ */

describe('R5-MULTI-WEAPON｜A. canonical 武器集合', () => {
  it('MW-01 武器集合由真源现读：registry 10 件 / 玩家可拥有 9 件，差额恰为 ramHead', () => {
    // ① `weaponDefs()` 与 registry 直读同源（页面 / 测试 / 局内吃的是同一份定义）
    const fromRegistry = [...registry.functionals.values()]
      .filter((d) => d.category === 'weapon')
      .map((d) => d.id)
      .sort();
    expect(REGISTRY_WEAPONS.slice().sort()).toEqual(fromRegistry);
    expect(REGISTRY_WEAPONS.length).toBe(10);

    // ② 玩家可拥有集合 ⊆ registry 集合（`OFFICIAL_PARTS` 是**发放入口**，不参与内容定义）
    expect(OWNED_WEAPONS.length).toBe(9);
    for (const id of OWNED_WEAPONS) expect(REGISTRY_WEAPONS).toContain(id);

    // ③ 差额的唯一来源 = `ramHead`：有武器定义，但**不是正式部件** ⇒ 拿不到 ⇒ 不进库存
    expect(REGISTRY_WEAPONS.filter((id) => !OWNED_WEAPONS.includes(id))).toEqual(['ramHead']);
    expect(isOfficialPart('ramHead')).toBe(false);
    expect(registry.functionals.get('ramHead')?.category).toBe('weapon');

    // ④ 支持清单必须是**拿得到的东西**（支持一件永远发不出来的武器 = 幽灵条目）
    for (const id of FULL_RUN_SUPPORTED_WEAPON_IDS) expect(OWNED_WEAPONS).toContain(id);

    // ⑤ 不受支持集合由差集推出（不手写）：registry 10 − 支持 1 = 9（**含** ramHead）
    expect(UNSUPPORTED_WEAPONS.length).toBe(9);
    expect(UNSUPPORTED_WEAPONS).not.toContain('cannon');
    expect(UNSUPPORTED_WEAPONS).toContain('ramHead');
    // 其中「玩家真的可能装上」的只有 8 件（ramHead 拿不到 ⇒ 装不上）
    expect(OWNED_WEAPONS.filter((id) => !supportsFullRun(id)).length).toBe(8);
  });

  it('MW-02 支持清单唯一真源、与局内基准武器同值；奖励池 ⊆ 支持清单', () => {
    expect(FULL_RUN_SUPPORTED_WEAPON_IDS).toEqual([RUN_BASE_WEAPON_DEF_ID]);
    expect(RUN_BASE_WEAPON_DEF_ID).toBe('cannon');
    // 奖励只发「这一局真的用得上的东西」⇒ 必须落在支持清单里
    for (const id of REWARD_CHOICE_IDS) expect(supportsFullRun(id)).toBe(true);
    // 全 `src/` 只有一处**声明**（注释剥掉后）⇒ 不可能存在第二份清单
    expect(declarationCount('FULL_RUN_SUPPORTED_WEAPON_IDS')).toBe(1);
  });
});

/* ============================================================================
   B. 逐件矩阵（产品守门 + Run 创建资格）
   ============================================================================ */

describe('R5-MULTI-WEAPON｜B. 逐件矩阵', () => {
  it('MW-03 **逐件**：registry 全部 10 件武器逐一审核 —— 放行 ⟺ 在支持清单里，原因三态正确', () => {
    const rows: string[] = [];
    for (const defId of REGISTRY_WEAPONS) {
      const draft = draftWithWeapon(defId);
      const compat = fullRunCompat(draft);
      const supported = supportsFullRun(defId);

      expect(compat.ok, `${defId}：ok 必须 = 是否在支持清单里`).toBe(supported);
      expect(compat.reason, `${defId} 的拒绝原因`).toBe(supported ? 'ok' : 'unsupported-weapon');
      expect(compat.equippedWeaponIds, `${defId} 必须出现在「车上的武器」读数里`).toContain(defId);
      // 提示只在不放行时出现（可执行时两条都为 null，不画多余提示）
      expect(compat.notice === null, `${defId} 的 notice`).toBe(supported);
      expect(compat.hint === null, `${defId} 的 hint`).toBe(supported);
      // 便捷入口与完整读数同源
      expect(canStartFullRun(draft)).toBe(supported);

      rows.push(`${defId}:${supported ? '放行' : '拒绝'}`);
    }
    expect(rows.length).toBe(REGISTRY_WEAPONS.length);
    /*
      ⚠️ 这一条**刻意写死「恰好一件放行」**（虽然 `FULL_RUN_SUPPORTED_WEAPON_IDS` 已由 LC-01 钉成
      `[RUN_BASE_WEAPON_DEF_ID]`）：它让**矩阵本身**（而不只是那个常量）对「白名单被放宽」失败。
      没有它的话，把白名单改成 `['cannon','spear']` 时矩阵会**自洽地**变绿
      （`ok` 与 `supportsFullRun` 一起翻），矩阵就不再是守卫。
    */
    expect(rows.filter((r) => r.endsWith('放行'))).toEqual(['cannon:放行']);
  });

  it('MW-04 **逐件** Run 创建资格：支持 ⇒ 交回玩家那份真实装载；不支持 ⇒ blocked + 演示占位', () => {
    for (const defId of REGISTRY_WEAPONS) {
      const draft = draftWithWeapon(defId);
      const res = resolveRunPlayerLoadout(searchOf(draft));
      if (supportsFullRun(defId)) {
        // 「Product Run 使用真实武器」：交回去的就是玩家那份（source=profile、槽位相同）
        expect(res.blocked, `${defId} 不得被拦住`).toBe(false);
        expect(res.blockedReason).toBeNull();
        expect(res.fallback).toBe('none');
        expect(res.loadout.source).toBe('profile');
        expect(res.loadout.draft.functionalSelections[WEAPON_SLOT]).toBe(defId);
      } else {
        expect(res.blocked, `${defId} 必须在**创建 Run 之前**被拒绝`).toBe(true);
        expect(res.fallback).toBe('unsupported-loadout');
        expect(res.blockedReason).toBe('no-base-weapon');
        // 被拒绝时**绝不**把玩家那份不兼容装载交回去（防「忽略 blocked ⇒ 照常开战」）
        expect(res.loadout.source).toBe('demo');
        expect(res.loadout.draft.functionalSelections[WEAPON_SLOT]).not.toBe(defId);
      }
      // 两层判据同源（产品侧 / 局内侧不可能一处放行、另一处拒绝）
      expect(runLoadoutCompatOfDraft(draft).ok).toBe(
        snapshotHasRunBaseWeapon(buildSnapshotFromDraft(draft, registry)),
      );
    }
  });

  it('MW-05 **读取路径零副作用**：审核 10 件武器不写盘、不改 draft ⇐「禁止自动换炮」的机器证据', () => {
    const before = storageSnapshot();
    for (const defId of REGISTRY_WEAPONS) {
      const draft = draftWithWeapon(defId);
      const frozen = JSON.stringify(draft);
      fullRunCompat(draft);
      canStartFullRun(draft);
      supportsFullRun(defId);
      runLoadoutCompatOfDraft(draft);
      resolveRunPlayerLoadout(searchOf(draft));
      expect(JSON.stringify(draft), `${defId}：审核不得改写玩家那份装载`).toBe(frozen);
      // 装备仍然是它自己 —— 「自动替玩家换成 Cannon」在这里会立刻红
      expect(equippedWeaponId(draft), `${defId}：装备没被换成别的`).toBe(defId);
    }
    expect(storageSnapshot(), '审核路径一个字节都不该写').toBe(before);
  });

  it('MW-06 判据 = **存在性**（不是主武器槽）：不支持武器占主武器槽 + cannon 在别的挂点 ⇒ 仍放行且不改写', () => {
    for (const w of UNSUPPORTED_WEAPONS) {
      // ① 混合装载：主武器槽 = 不支持的那件，cannon 挂在别处 ⇒ 必须放行
      const mixed = draftWithSelections({ [WEAPON_SLOT]: w, top: 'cannon' });
      const compat = fullRunCompat(mixed);
      expect(compat.ok, `${w} 占主武器槽、cannon 在 top ⇒ 必须放行（存在性判据）`).toBe(true);
      expect(compat.equippedWeaponIds).toContain('cannon');
      expect(compat.equippedWeaponIds).toContain(w);
      // 放行 ≠ 换炮：装载逐字节没动
      expect(mixed.functionalSelections[WEAPON_SLOT]).toBe(w);
      const res = resolveRunPlayerLoadout(searchOf(mixed));
      expect(res.blocked).toBe(false);
      expect(res.loadout.source).toBe('profile');
      expect(res.loadout.draft.functionalSelections[WEAPON_SLOT]).toBe(w);
      expect(res.loadout.draft.functionalSelections['top']).toBe('cannon');

      // ② 对照组：同一件武器，但车上没有 cannon ⇒ 必须拒绝
      const only = draftWithSelections({ [WEAPON_SLOT]: w, top: 'pushRod' });
      const onlyCompat = fullRunCompat(only);
      expect(onlyCompat.ok, `${w} 单独在车上 ⇒ 必须拒绝`).toBe(false);
      expect(onlyCompat.reason).toBe('unsupported-weapon');
      expect(onlyCompat.equippedWeaponIds).toEqual([w]);
    }
  });

  it('MW-07 「没有武器」在产品侧发不出来：辅助件-only 被正式校验拒绝 ⇒ 该原因只走「手改 / 旧参数」路径', () => {
    // ① 正式校验要求「至少 1 件 Weapon」⇒ 产品侧**不可能**交出一份没有武器的装备
    const base = defaultPlayerDraft();
    const aux: BuildDraft = {
      ...base,
      functionalSelections: { ...base.functionalSelections, [WEAPON_SLOT]: 'pushRod', top: 'thruster' },
    };
    const check = validateSnapshot(buildSnapshotFromDraft(aux, registry), registry);
    expect(check.valid, '辅助件-only 的装备必须过不了正式校验').toBe(false);
    expect(check.errors.join('；')).toContain('Weapon');

    // ② 但判据层仍把「没有武器」与「有武器但不支持」分得开（旧 URL / 手改参数的路径）
    const bare: BuildDraft = { ...defaultPlayerDraft(), functionalSelections: {} };
    const compat = fullRunCompat(bare);
    expect(compat.ok).toBe(false);
    expect(compat.reason).toBe('no-weapon');
    expect(compat.equippedWeaponIds).toEqual([]);

    // ③ 手改地址带着它 ⇒ 在**正式校验**那一关就被判 `invalid`（走不到支持性判断）
    const res = resolveRunPlayerLoadout(searchOf(bare));
    expect(res.blocked).toBe(false);
    expect(res.fallback).toBe('invalid');

    // ④ 辅助件任何一件都不是武器（「不参与武器成长合成」的同一条真源）
    for (const g of GADGETS) expect(isWeaponDefId(g)).toBe(false);
  });
});

/* ============================================================================
   C. 多武器库存 × Fusion（本轮核心）
   ============================================================================ */

describe('R5-MULTI-WEAPON｜C. 多武器库存 × Fusion', () => {
  it('MW-08 多武器库存下 Fusion 预检与库存同源：9 件武器全 ★1 ×1，不产生任何「可合成」误报', () => {
    // 真机同一条链：`openGrowthSession`（fresh seed → R2 → R3 → R4 → R5 内容池）
    const g = openGrowthSession(defaultPlayerDraft());
    const inv = g.inv;
    const entries = weaponEntries(inv);

    // ① 库存里恰好是那 9 件「玩家可拥有」的武器（`ramHead` 拿不到 ⇒ 不出现）
    expect(entries.map((e) => e.defId).sort()).toEqual(OWNED_WEAPONS.slice().sort());
    expect(entries.every((e) => e.star === GROWTH_STAR)).toBe(true);
    expect(entries.every((e) => e.threshold === FUSE_STACK)).toBe(true);
    // 主武器槽仍是 cannon（内容池种子**不碰**当前装备）
    expect(equippedWeaponId(g.draft)).toBe('cannon');

    // ② 多武器库存**不产生任何可合成项**（8 件各 1，cannon = 4）
    expect(entries.filter((e) => e.fusable).length).toBe(0);
    expect(entries.filter((e) => e.reachesThreshold).length).toBe(0);
    expect(entries.find((e) => e.defId === 'cannon')?.count).toBe(4);

    // ③ 逐件：合成预检与库存读数同源（页面徽标 / 合成按钮读的是它，不各自判一次）
    for (const e of entries) {
      const gate = canFuseStack(inv, e.defId, e.star);
      expect(gate.isWeapon, `${e.defId} 是正式武器`).toBe(true);
      expect(gate.count, `${e.defId} 的预检数量必须 = 库存读数`).toBe(e.count);
      expect(gate.ok, `${e.defId} 未满 ${FUSE_STACK} 件 ⇒ 不可合成`).toBe(false);
    }

    // ④ 规则真源一字未改（**没有**为了多武器新增任何成长规则）
    expect(FUSE_STACK).toBe(5);
    expect(GROWTH_MAX_STAR).toBe(INVENTORY_MAX_STAR);
    expect(GROWTH_MAX_STAR).toBe(5);

    // ⑤ 辅助件不参与武器成长合成（多武器库存不会把它们卷进来）
    for (const gadget of GADGETS) {
      const gate = canFuseStack(inv, gadget, 1);
      expect(gate.isWeapon, `${gadget} 不是武器`).toBe(false);
      expect(gate.ok).toBe(false);
    }
  });

  it('MW-08b 多武器库存下 Fusion 只碰目标 defId：材料不足零写入，合成功后其余武器逐字节不变', () => {
    const g = openGrowthSession(defaultPlayerDraft());
    const inv = g.inv;
    const draft = g.draft;

    const others = OWNED_WEAPONS.filter((id) => id !== 'spear').slice().sort();
    const othersSnapshot = (): string =>
      `${others.map((id) => `${id}:${getCount(inv, id, 1)}`).join(',')}|${GADGETS.map(
        (gid) => `${gid}:${getCount(inv, gid, 1)}`,
      ).join(',')}`;
    const beforeOthers = othersSnapshot();
    expect(getCount(inv, 'spear', 1)).toBe(1);

    // ① 材料不足 ⇒ 拒绝，且**零写入**（库存逐字节不变）
    const invBytes0 = JSON.stringify(inv);
    const refused = fuseStack(inv, 'spear', 1, draft);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toBe('not-enough');
    expect(JSON.stringify(inv), '材料不足时不得有任何写入').toBe(invBytes0);
    expect(othersSnapshot()).toBe(beforeOthers);

    // ② 补足材料 ⇒ 只动 spear
    addPart(inv, 'spear', 1, FUSE_STACK - 1);
    expect(getCount(inv, 'spear', 1)).toBe(FUSE_STACK);
    const fused = fuseStack(inv, 'spear', 1, draft);
    expect(fused.ok).toBe(true);
    if (fused.ok) {
      expect(fused.partId).toBe('spear');
      expect(fused.fromStar).toBe(1);
      expect(fused.toStar).toBe(2);
      expect(fused.consumed).toBe(FUSE_STACK);
      // 装备的是 cannon（不是被合的那件）⇒ 装备不该跟着动
      expect(fused.equippedBefore).toBeNull();
      expect(fused.equippedUpgraded).toBe(false);
      expect(equippedWeaponId(fused.draft)).toBe('cannon');
    }
    expect(getCount(inv, 'spear', 1)).toBe(0);
    expect(getCount(inv, 'spear', 2)).toBe(1);

    // ③ 其余 8 件武器 + 2 件辅助件逐字节未受影响（跨 defId 隔离）
    expect(othersSnapshot(), '合成 spear 不得影响其它任何部件').toBe(beforeOthers);

    // ④ 合成后仍是「多武器库存」，且仍然没有任何可合成项
    const entries = weaponEntries(inv);
    expect(entries.map((e) => e.defId).sort()).toEqual(OWNED_WEAPONS.slice().sort());
    expect(entries.filter((e) => e.fusable).length).toBe(0);
    expect(canFuseStack(inv, 'spear', 2).ok).toBe(false);
  });
});

/* ============================================================================
   D. 源码守卫（禁 silent fallback / 禁自动换炮）
   ============================================================================ */

describe('R5-MULTI-WEAPON｜D. 源码守卫', () => {
  it('MW-09 守门路径零写盘；支持清单唯一真源；「换炮」只可能来自一次性迁移', () => {
    // ① 裁决模块是纯逻辑：剥注释后不含任何写盘调用
    const compatSrc = strip(readProduct('runCompatibility.ts'));
    for (const k of ['saveInventory', 'savePlayerBuild', 'persistPlayerBuild', 'setItem', 'localStorage']) {
      expect(compatSrc.includes(k), `runCompatibility.ts 不得出现 ${k}`).toBe(false);
    }

    // ② 首页零写盘（GS-21 的同型加强）；唯一的装备写入点是**玩家动作**
    const home = strip(readProduct('homePage.ts'));
    for (const k of ['saveInventory(', 'savePlayerBuild(', 'persistPlayerBuild(', 'setItem(']) {
      expect(home.includes(k), `homePage.ts 不得直接写盘：${k}`).toBe(false);
    }
    expect(home.split('equipWeapon(').length - 1, '首页只有一个装备写入点').toBe(1);

    // ③ 全 `src/product` 的 `equipWeapon(` 调用点闭环 —— 不存在第 4 条「自动换炮」路径
    const productFiles = readdirSync(PRODUCT_DIR).filter((f) => f.endsWith('.ts'));
    const callers = productFiles
      .filter((f) => f !== 'playerLoadout.ts')
      .filter((f) => strip(readProduct(f)).includes('equipWeapon('))
      .sort();
    expect(callers).toEqual(['homePage.ts', 'playerGrowth.ts', 'r2Reseed.ts']);
    // `playerLoadout.ts` 只有**定义**（不是调用）
    expect(strip(readProduct('playerLoadout.ts')).split('equipWeapon(').length - 1).toBe(1);

    // ④ 唯一会「主动换成 cannon」的那条是**版本化一次性迁移**（不是每次渲染都跑）
    expect(strip(readProduct('r2Reseed.ts'))).toContain('equipWeapon(R2_RESEED_CANNON_ID');
    expect(strip(readProduct('playerGrowth.ts'))).toContain('equipWeapon(partId');
  });

  it('MW-10 页面不自算支持性：探针 `runCompat` 直接取自产品层唯一判断', () => {
    const home = strip(readProduct('homePage.ts'));
    expect(home).toContain('fullRunCompat(draft)');
    // 探针字段来自同一个 `compat` 读数（页面没有第二套口径）
    // ⚠️ 用 `lastIndexOf`：`runCompat: {` 第一次出现在**类型声明**里，探针实现才是最后一处。
    const probeBlock = home.slice(home.lastIndexOf('runCompat: {'));
    expect(probeBlock.length, '探针必须真的有 runCompat 字段').toBeGreaterThan(0);
    expect(probeBlock.slice(0, 400)).toContain('compat.ok');
    expect(probeBlock.slice(0, 400)).toContain('compat.reason');
    // 页面不许自列支持清单、不许自判武器 id
    expect(home.includes('FULL_RUN_SUPPORTED_WEAPON_IDS')).toBe(false);
    for (const w of REGISTRY_WEAPONS) {
      for (const q of [`'${w}'`, `"${w}"`]) {
        expect(home.includes(q), `homePage 不应出现武器 id 字面量 ${q}（应走 fullRunCompat）`).toBe(false);
      }
    }
  });
});
