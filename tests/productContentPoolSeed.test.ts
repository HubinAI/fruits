/**
 * PRODUCT-LOOP-R5-BASIC-CONTENT-POOL-R1｜**一次性「正式内容池」种子** targeted 测试。
 *
 * 逐条对应 Queue 的验收：
 *   ① 输出真实 canonical 内容清单         → CP-00（清单从真源现读，不写第二张表）
 *   ② 所有现有正式 Body 可供验证账号使用   → CP-01 / CP-02 / CP-03
 *   ③ Movement 不退化                      → CP-M1 / CP-M2
 *   ④ Runtime 已存在的正式 Weapon ★1 可用  → CP-04 / CP-05（不发 ★2+）
 *   ⑤ Seed 一次性、幂等、不覆盖当前配置    → CP-06 / CP-07 / CP-08 / CP-09
 *   ⑥ targeted + tsc                       → 本文件
 *
 * 外加本队列自己立的不变量：
 *   - **只增不减**：写动作只有 `grantBody` + `addPart`，没有 revoke / 不删键 / 不归零；
 *   - **不发 ★2+**：★2..★5 四档在结构上碰不到；
 *   - **不碰 BuildDraft**：`draft` 是**同一个对象**、磁盘那一份逐字节不变；
 *   - **不改任何数值**：Body / Movement / Weapon 的数值字段一个都没被读写；
 *   - **不制造第二套记录**：唯一的新 key 是本种子自己的版本标记；库存仍只有一份；
 *   - **不放宽「完整 Run 只支持 cannon」**：本种子**不**碰
 *     `runCompatibility.FULL_RUN_SUPPORTED_WEAPON_IDS`（那是**产品裁决**，不是内容池）。
 *
 * ⚠️ 本文件**不**调用 `markR5ContentPoolSeed()` 做隔离 —— 那份种子正是**被测对象**。
 *    反过来，这里**必须**预置 R2 / R3 / R4 的标记（`isolateOtherMigrations()`）：
 *    否则 onboarding 会补 cannon、reseed 会清 cannon ★≥2、Movement 种子会补轮组、
 *    Body 种子会解锁 durian/mango ⇒ 各种读数对账都会被搅浑。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it } from 'vitest';

import { savePlayerBuild } from '../src/core/buildPersistence';
import { makeStarterDraft, type BuildDraft } from '../src/lab/buildEditorModel';
import { registry } from '../src/core/content';
import {
  DEFAULT_OWNED_BODIES,
  NEW_OFFICIAL_BODIES,
  OFFICIAL_BODIES,
  isBodyOwned,
  loadOwnedBodies,
} from '../src/core/bodyOwnership';
import {
  OFFICIAL_MOVEMENTS,
  OFFICIAL_PARTS,
  STARTER_PARTS,
  getCount,
  loadInventoryRaw,
  saveInventory,
  type PartInventory,
} from '../src/core/partInventory';
import { STAMP_KEY } from '../src/core/saveVersion';
import { openGrowthSession } from '../src/product/playerGrowth';
import { markR2Onboarding } from '../src/product/r2Onboarding';
import { markR2Reseed } from '../src/product/r2Reseed';
import { markR3MovementSeed } from '../src/product/r3MovementChoiceSeed';
import { markR4BodySeed, MVP_BODY_CHOICE_IDS } from '../src/product/r4BodyChoiceSeed';
import { movementOwnership } from '../src/product/movementInventory';
import { FULL_RUN_SUPPORTED_WEAPON_IDS } from '../src/product/runCompatibility';
import { bodyOwnership } from '../src/product/bodyInventory';
import { defaultPlayerDraft, playerInventory } from '../src/product/playerLoadout';
import {
  R5_CONTENT_POOL_KEY,
  R5_CONTENT_POOL_VERSION,
  R5_POOL_BODY_IDS,
  R5_POOL_MIN_COUNT,
  R5_POOL_PART_IDS,
  R5_POOL_STAR,
  applyR5ContentPoolSeed,
  isR5ContentPoolDone,
  readR5ContentPoolSeed,
} from '../src/product/r5ContentPoolSeed';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC_DIR = join(REPO_ROOT, 'src');

function readSource(rel: string): string {
  return readFileSync(join(SRC_DIR, rel), 'utf8');
}
/** 源码守卫必须先剥注释（本项目铁律：注释里的自指文字会骗过字符串匹配）。 */
function strip(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** 内存版 localStorage（node 无原生；与其它产品侧测试同一模式）。 */
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
 * 预置 **R2 / R3 / R4** 那几份标记 ⇒ 本文件只观察内容池种子本身。
 *
 * ⚠️ 刻意**不**预置 `markR5ContentPoolSeed()`：那份种子是被测对象。
 */
function isolateOtherMigrations(): void {
  markR2Onboarding();
  markR2Reseed();
  markR3MovementSeed();
  markR4BodySeed();
}

/** 键序无关的规范化 JSON（对象键排序后比较，避免「顺序不同 = 不等」的假红）。 */
function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canon(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

/** 库存里**全部功能件 × 五档**的读数（「不丢数据」的对账口径）。 */
function partsSnapshot(inv: PartInventory): string {
  const out: Record<string, number[]> = {};
  for (const p of OFFICIAL_PARTS) {
    out[p] = [1, 2, 3, 4, 5].map((s) => getCount(inv, p, s));
  }
  return canon(out);
}

/** 库存里**全部轮组 × 五档**的读数（Movement 不退化 / 不被本种子碰的口径）。 */
function movementsSnapshot(inv: PartInventory): string {
  const out: Record<string, number[]> = {};
  for (const m of OFFICIAL_MOVEMENTS) {
    out[m] = [1, 2, 3, 4, 5].map((s) => getCount(inv, m, s));
  }
  return canon(out);
}

/**
 * 一个「**已有账号**」：磁盘上已经有 Build 与库存（所以 `isFreshProfile()` 为 false，
 * 新账号种子不发）。
 *
 * ⚠️ 刻意不经 `openGrowthSession`（那会顺带跑本文件要测的种子）：
 *    这里直接走 core 的 `savePlayerBuild` 落下**确定的**起点。
 */
function seedExistingAccount(opts: { readonly draft?: BuildDraft } = {}): BuildDraft {
  isolateOtherMigrations();
  const draft = opts.draft ?? defaultPlayerDraft();
  savePlayerBuild(draft);
  // 落 starter 库存（core ensureInventory）⇒ 既让 `isFreshProfile()` 为 false，
  // 又让 `loadInventoryRaw()` 非 null（对账前提）。
  playerInventory(draft);
  return draft;
}

/** starter 之外的功能件（= R5 应该补的那几件）。 */
const NON_STARTER_PARTS = OFFICIAL_PARTS.filter((p) => !STARTER_PARTS.includes(p));

/* ============================================================================
   A. 第一部分｜真实 canonical 内容清单（从真源现读，不写第二张表）
   ============================================================================ */

describe('A. canonical 内容清单（第一部分，全部现读自 core 真源）', () => {
  it('CP-00 内容池集合**就是** core 真源本身：不写第二张表、不筛子集', () => {
    // 车身：本种子投入的集合 === NEW_OFFICIAL_BODIES（同一个数组引用的内容）
    expect([...R5_POOL_BODY_IDS]).toEqual([...NEW_OFFICIAL_BODIES]);
    // 功能件：本种子投入的集合 === OFFICIAL_PARTS
    expect([...R5_POOL_PART_IDS]).toEqual([...OFFICIAL_PARTS]);
    // 且两个集合的每个 id 都真的能在正式内容库里解析出来（内容库认识它们）
    for (const b of R5_POOL_BODY_IDS) {
      expect(registry.bodies.get(b), `${b} 必须在 registry.bodies 里`).toBeTruthy();
    }
    for (const p of R5_POOL_PART_IDS) {
      expect(registry.functionals.get(p), `${p} 必须在 registry.functionals 里`).toBeTruthy();
    }
    // 保底件数 / 星级是**选择**常量（Queue：至少 ★1 ×1、不发 ★2+）
    expect(R5_POOL_MIN_COUNT).toBe(1);
    expect(R5_POOL_STAR).toBe(1);
    // 正式车身全集 = 旧 4（恒默认拥有）+ 新 4（需解锁）
    expect([...OFFICIAL_BODIES]).toEqual([...DEFAULT_OWNED_BODIES, ...NEW_OFFICIAL_BODIES]);
    expect(OFFICIAL_BODIES.length).toBe(8);
    // 正式功能件全集 = PART_OPTIONS 去 EMPTY（11 件）
    expect(OFFICIAL_PARTS.length).toBe(11);
    // 正式轮组 = 3 件（本种子**不**碰，见 CP-M1）
    expect([...OFFICIAL_MOVEMENTS]).toEqual(['smallWheel', 'largeWheel', 'heavyWheel']);
  });
});

/* ============================================================================
   B. 验收 ②｜首入 ⇒ 内容池铺满（只补缺的）
   ============================================================================ */

describe('B. 首入 ⇒ 内容池铺满（验收 ② / ④）', () => {
  it('CP-01 已有账号首入：全部正式车身可装备 + 全部正式功能件各 ★1，逐件读数对账', () => {
    const draft = seedExistingAccount();
    // 前提：4 台新增车身确实都没有（否则本用例在证一个已经成立的事）
    for (const b of NEW_OFFICIAL_BODIES) {
      expect(isBodyOwned(b), `前提：${b} 未拥有`).toBe(false);
    }
    expect(isR5ContentPoolDone(), '前提：首入判定尚未做出').toBe(false);

    const g = openGrowthSession(draft);

    expect(g.contentPoolSeed.reason).toBe('seeded');
    expect(g.contentPoolSeed.applied).toBe(true);
    expect(g.contentPoolSeed.decided, '首入判定 ⇒ 必须落标记').toBe(true);
    expect(g.contentPoolSeed.inventoryChanged, '功能件那一半改了内存 ⇒ 需要落盘').toBe(true);

    // ① 全部 8 台正式车身都可装备（旧 4 恒默认拥有 + 新 4 被本种子解锁）
    for (const b of OFFICIAL_BODIES) {
      expect(isBodyOwned(b), `${b} 可装备`).toBe(true);
    }
    // ② 全部 11 件正式功能件各 ★1 ≥ 1
    for (const p of OFFICIAL_PARTS) {
      expect(getCount(g.inv, p, R5_POOL_STAR), `${p} ★1 ≥ 1`).toBeGreaterThanOrEqual(
        R5_POOL_MIN_COUNT,
      );
    }
    // ③ 车身那一半：本夹具里 R4 被**隔离**（标记预置 ⇒ 它没跑，其 2 台也没发）
    //    ⇒ 4 台新增车身全部由本种子补上（这正是「只补当前缺少的」的极端形态）
    expect(g.contentPoolSeed.raisedBodies, '缺的 4 台全部补上').toBe(NEW_OFFICIAL_BODIES.length);
    expect(
      g.contentPoolSeed.bodies.filter((e) => e.raised === 1).map((e) => e.defId).sort(),
      '被补的正是全部新增正式车身',
    ).toEqual([...NEW_OFFICIAL_BODIES].sort());
    for (const e of g.contentPoolSeed.bodies) {
      expect(e.ownedBefore, `${e.defId} 首入前未拥有`).toBe(false);
      expect(e.ownedAfter).toBe(true);
      expect(e.raised, `${e.defId} 补 1 台`).toBe(1);
    }
    // ④ 功能件那一半：只补 starter 之外的那 7 件
    expect(g.contentPoolSeed.raisedParts).toBe(NON_STARTER_PARTS.length);
    expect(
      g.contentPoolSeed.parts.filter((e) => e.raised === 1).map((e) => e.defId).sort(),
      '被补的正是 starter 之外的全部正式功能件',
    ).toEqual([...NON_STARTER_PARTS].sort());
    // starter 那 4 件一件都没被抬高（cannon 的 4 件来自 R2 种子，不是本种子）
    for (const p of STARTER_PARTS) {
      const e = g.contentPoolSeed.parts.find((x) => x.defId === p)!;
      expect(e.raised, `${p} 已被 starter 拥有 ⇒ 不补`).toBe(0);
    }
    // ⑤ 真的落盘了（不是只改了内存）
    const raw = loadInventoryRaw()!;
    for (const p of OFFICIAL_PARTS) {
      expect(getCount(raw, p, R5_POOL_STAR), `${p} 已落盘`).toBeGreaterThanOrEqual(1);
    }
    for (const b of NEW_OFFICIAL_BODIES) {
      expect(isBodyOwned(b), `${b} 已落盘`).toBe(true);
    }
  });

  it('CP-02 旧 4 台车身**保持默认拥有语义**：本种子不给它们制造任何拥有记录', () => {
    const draft = seedExistingAccount();
    openGrowthSession(draft);
    // 拥有状态落在 `strongfruit.ownedBodies.v1`（只记新车身），旧 4 台不进这个集合
    const owned = loadOwnedBodies();
    for (const b of DEFAULT_OWNED_BODIES) {
      expect(owned, '旧车身不落拥有集合').not.toContain(b);
    }
    for (const b of DEFAULT_OWNED_BODIES) {
      expect(isBodyOwned(b)).toBe(true);
    }
  });

  it('CP-03 **部分拥有**：只补缺的那些，已有的原样不动（含「R4 已发过 2 台」的真实形态）', () => {
    /*
      ⚠️ 这里刻意**手工**把 R4 的 MVP 两台（durian / mango）+ pear 写进拥有集合，
        复刻真机上「R4 已经跑过、玩家自己又解锁过 pear」的形态
        —— 本文件的夹具把 R4 隔离掉了，所以它的效果必须手工给出来。
    */
    store.setItem(
      'strongfruit.ownedBodies.v1',
      JSON.stringify([...MVP_BODY_CHOICE_IDS, 'pearBody']),
    );
    const draft = seedExistingAccount();
    expect(isBodyOwned('pearBody')).toBe(true);
    expect(isBodyOwned('orangeBody')).toBe(false);

    const g = openGrowthSession(draft);

    // MVP 2 台 + pear 都已拥有 ⇒ 本次只补 orange 一台
    const expectedRaised = NEW_OFFICIAL_BODIES.filter(
      (b) => !MVP_BODY_CHOICE_IDS.includes(b) && b !== 'pearBody',
    );
    expect(g.contentPoolSeed.raisedBodies).toBe(expectedRaised.length);
    expect(g.contentPoolSeed.bodies.find((e) => e.defId === 'pearBody')!.raised, '已有的不动').toBe(0);
    expect(g.contentPoolSeed.bodies.find((e) => e.defId === 'orangeBody')!.raised).toBe(1);
    for (const b of NEW_OFFICIAL_BODIES) {
      expect(isBodyOwned(b), `${b} 拥有`).toBe(true);
    }
  });

  it('CP-04 **不发 ★2+**：一次性投放只写 ★1 档，★2..★5 四档一个都没被抬高', () => {
    const draft = seedExistingAccount();
    const g = openGrowthSession(draft);
    expect(g.contentPoolSeed.applied).toBe(true);
    const raw = loadInventoryRaw()!;
    for (const p of NON_STARTER_PARTS) {
      for (const star of [2, 3, 4, 5]) {
        expect(getCount(raw, p, star), `${p} ★${star} 必须为 0`).toBe(0);
      }
    }
  });

  it('CP-05 内容池里的「Runtime 已存在的武器」确实可装备（`canEquipPart` 口径）', () => {
    const draft = seedExistingAccount();
    const g = openGrowthSession(draft);
    // Queue 第四部分点名的形态：runtime 已存在、只是 Product Run 尚未开放
    for (const defId of ['laser', 'rammer', 'saw', 'shotgun', 'machineGun', 'flamethrower']) {
      expect(OFFICIAL_PARTS, `${defId} 必须是正式部件`).toContain(defId);
      expect(getCount(g.inv, defId, 1), `${defId} ★1 可用`).toBeGreaterThanOrEqual(1);
    }
    // Gadget 那一件也一并覆盖（模块头已如实披露）
    expect(getCount(g.inv, 'thruster', 1), 'thruster ★1 可用').toBeGreaterThanOrEqual(1);
  });

  it('CP-05b **不放宽**「完整 Run 支持清单」：本种子不改产品裁决', () => {
    seedExistingAccount();
    openGrowthSession(defaultPlayerDraft());
    /*
      PRODUCT-LOOP-R6 起这里**不再**断言「清单 = ['cannon']」（那是旧契约，清单已扩为显式能力登记）。
      本用例真正要钉的是**边界**：内容池种子（「已拥有」）与完整 Run 兼容（「能不能跑」）是两件事
      ⇒ 断言换成「清单仍以 cannon 为原生武器」+ 下面两条源码守卫（那才是真守卫）。
    */
    expect(FULL_RUN_SUPPORTED_WEAPON_IDS).toContain('cannon');
    // 源码守卫：本种子模块**不**引用 runCompatibility / 不改那条清单
    const src = strip(readSource('product/r5ContentPoolSeed.ts'));
    expect(src.includes('runCompatibility'), '不得引用 runCompatibility').toBe(false);
    expect(src.includes('FULL_RUN_SUPPORTED_WEAPON_IDS'), '不得碰支持清单').toBe(false);
  });
});

/* ============================================================================
   C. 验收 ⑤｜一次性 + 幂等 + 不覆盖当前配置
   ============================================================================ */

describe('C. 一次性 + 幂等 + 不覆盖（验收 ⑤）', () => {
  it('CP-06 第二次挂载（= reload）：两处存档逐字节不变、`reason` 翻成 `already-marked`', () => {
    const draft = seedExistingAccount();
    const first = openGrowthSession(draft);
    expect(first.contentPoolSeed.applied).toBe(true);
    const invAfterFirst = store.getItem('strongfruit.ownedParts.v2');
    const bodiesAfterFirst = store.getItem('strongfruit.ownedBodies.v1');

    const second = openGrowthSession(draft);

    expect(second.contentPoolSeed.reason, '首入判定已做出 ⇒ 不再重判').toBe('already-marked');
    expect(second.contentPoolSeed.applied).toBe(false);
    expect(second.contentPoolSeed.decided, '标记本来就在 ⇒ 不必再写').toBe(false);
    expect(second.contentPoolSeed.inventoryChanged).toBe(false);
    expect(second.contentPoolSeed.raisedBodies).toBe(0);
    expect(second.contentPoolSeed.raisedParts).toBe(0);
    expect(store.getItem('strongfruit.ownedParts.v2'), '库存逐字节不变').toBe(invAfterFirst);
    expect(store.getItem('strongfruit.ownedBodies.v1'), '拥有集合逐字节不变').toBe(bodiesAfterFirst);
  });

  it('CP-07 连跑五次：内容池恒满且不重复补（不是「每两次挂载才不涨」那种偶发通过）', () => {
    const draft = seedExistingAccount();
    for (let i = 0; i < 5; i += 1) {
      const g = openGrowthSession(draft);
      if (i === 0) expect(g.contentPoolSeed.applied, '第一次必须真的补').toBe(true);
      else expect(g.contentPoolSeed.applied, `第 ${i + 1} 次必须空操作`).toBe(false);
    }
    const raw = loadInventoryRaw()!;
    for (const p of OFFICIAL_PARTS) {
      expect(getCount(raw, p, 1), `${p} 恒为 1（不重复累加）`).toBe(
        STARTER_PARTS.includes(p) ? 1 : 1,
      );
    }
  });

  it('CP-08 `already-complete` 出口：内容池本来就齐 ⇒ 一个字节都不动，但**仍然落标记**', () => {
    // 先把内容池铺满（模拟「玩家 / 上一次投放已经全拥有」）
    isolateOtherMigrations();
    const full = playerInventory(defaultPlayerDraft());
    for (const p of OFFICIAL_PARTS) if (getCount(full, p, 1) < 1) full[p].one = 1;
    /*
      ⚠️ 刻意把一件抬到**保底之上**（3 件）：只有这样才能证明本种子的「不动已有」
      不是「反正大家都正好等于保底 1」的巧合 —— 它必须在「高于保底」的件上也成立
      （既不下调、也不归一化、也不清空）。下面用 `partsSnapshot` 做十一件 × 五档全量对账。
    */
    full['saw'].one = 3;
    saveInventory(full);
    savePlayerBuild(defaultPlayerDraft());
    // 4 台新车身全部拥有（本种子的车身那一半照旧走 core 的**唯一** `ownedBodies.v1`）
    store.setItem(
      'strongfruit.ownedBodies.v1',
      JSON.stringify([...new Set([...(loadOwnedBodies() ?? []), ...NEW_OFFICIAL_BODIES])]),
    );
    const bodiesBefore = store.getItem('strongfruit.ownedBodies.v1');
    const invBefore = store.getItem('strongfruit.ownedParts.v2');
    const partsBefore = partsSnapshot(playerInventory(defaultPlayerDraft()));

    const g = openGrowthSession(defaultPlayerDraft());

    expect(g.contentPoolSeed.reason).toBe('already-complete');
    expect(g.contentPoolSeed.applied).toBe(false);
    expect(g.contentPoolSeed.inventoryChanged).toBe(false);
    expect(g.contentPoolSeed.raisedBodies).toBe(0);
    expect(g.contentPoolSeed.raisedParts).toBe(0);
    expect(
      partsSnapshot(g.inv),
      '功能件十一件 × 五档逐条不变（含刻意抬到 3 件的那一件 —— 高于保底的也不被动）',
    ).toBe(partsBefore);
    /*
      ⚠️ `decided === true` 是**正确性要求**而不是风格选择：若不落标记，玩家之后把某件
      武器合成掉、或在 debug 里取消某台车身时，下一次挂载判据会重新成立
      ⇒ 玩家自己消耗掉的东西被重发。
    */
    expect(g.contentPoolSeed.decided, '「一个字节不动」的出口也必须落标记').toBe(true);
    expect(store.getItem('strongfruit.ownedBodies.v1'), '拥有集合逐字节不变').toBe(bodiesBefore);
    expect(store.getItem('strongfruit.ownedParts.v2'), '库存逐字节不变').toBe(invBefore);
  });

  it('CP-08b 落标记之后玩家自己消耗一件 ⇒ **不会**被重新发一遍', () => {
    const draft = seedExistingAccount();
    openGrowthSession(draft); // 首入：铺满 + 落标记
    // 玩家自己把 laser 用掉（合成 / 消耗）
    const inv = loadInventoryRaw()!;
    inv['laser'].one = 0;
    saveInventory(inv);
    expect(getCount(loadInventoryRaw()!, 'laser', 1)).toBe(0);

    const g = openGrowthSession(draft);

    expect(g.contentPoolSeed.reason, '判定已做出 ⇒ 不重判').toBe('already-marked');
    expect(getCount(loadInventoryRaw()!, 'laser', 1), '不重发').toBe(0);
  });

  it('CP-09 **不碰 BuildDraft**：会话回传的 `draft` 是同一个对象，磁盘那一份逐字节不变', () => {
    const draft = seedExistingAccount();
    const buildBefore = store.getItem('strongfruit.playerBuild.v1');

    const g = openGrowthSession(draft);

    expect(g.contentPoolSeed.applied).toBe(true);
    expect(g.draft, 'Build 是同一个对象（逐字节相同，不是副本）').toBe(draft);
    expect(store.getItem('strongfruit.playerBuild.v1'), '磁盘那一份 Build 逐字节不变').toBe(
      buildBefore,
    );
  });

  it('CP-10 **不自动替玩家换配置**：车身 / 武器槽 / 前后轮一件都没被改', () => {
    // 前提：玩家当前是「香蕉车身 + 刺 + 大轮/小轮」这种非缺省配置
    const base = defaultPlayerDraft();
    const draft: BuildDraft = {
      ...base,
      bodyDefId: 'bananaBody',
      functionalSelections: { ...base.functionalSelections },
      rearWheelDefId: 'largeWheel',
      frontWheelDefId: 'smallWheel',
    };
    const seeded = seedExistingAccount({ draft });

    const g = openGrowthSession(seeded);

    // ① 车身没被换
    expect(g.draft.bodyDefId, '不自动换车身').toBe('bananaBody');
    // ② 功能件槽一个都没被改
    expect(g.draft.functionalSelections, '武器槽没被改').toEqual(draft.functionalSelections);
    // ③ 前后轮没被改（不覆盖当前 Movement 配置）
    expect(g.draft.rearWheelDefId, '后轮没被改').toBe('largeWheel');
    expect(g.draft.frontWheelDefId, '前轮没被改').toBe('smallWheel');
    // ④ 但内容池**确实**铺满了 ⇒ 「拥有」与「装备」是两件事
    for (const b of OFFICIAL_BODIES) {
      expect(isBodyOwned(b), `${b} 拥有`).toBe(true);
    }
    const ownership = bodyOwnership(g.draft);
    expect(ownership.equippedDefIds, '只有 bananaBody 装着').toEqual(['bananaBody']);
    expect(ownership.bodyDefId).toBe('bananaBody');
  });
});

/* ============================================================================
   D. 验收 ③｜Movement 不退化 + 本种子不碰 Movement
   ============================================================================ */

describe('D. Movement 不退化（验收 ③）', () => {
  it('CP-M1 本种子**不碰** Movement 库存：三档任一档逐条不变（不新增 Movement）', () => {
    const draft = seedExistingAccount();
    // 隔离 R3 ⇒ 三档此时都还没被补
    const before = movementsSnapshot(playerInventory(draft));
    for (const m of OFFICIAL_MOVEMENTS) {
      expect(getCount(loadInventoryRaw() ?? playerInventory(draft), m, 1), `前提：${m} 为 0`).toBe(0);
    }

    const g = openGrowthSession(draft);

    expect(g.contentPoolSeed.applied).toBe(true);
    expect(movementsSnapshot(g.inv), '轮组五档逐条不变').toBe(before);
  });

  it('CP-M2 完整会话（R3 不隔离）⇒ 三档各 ≥1、不变式 legal=真、装备没被改（Movement 不退化）', () => {
    // 刻意**不**预置 R3 标记：让 Movement 种子成为这条断言的对照组
    markR2Onboarding();
    markR2Reseed();
    markR4BodySeed();
    const base = defaultPlayerDraft();
    const draft: BuildDraft = { ...base, rearWheelDefId: 'wheelStd', frontWheelDefId: 'largeWheel' };
    savePlayerBuild(draft);
    playerInventory(draft);

    const g = openGrowthSession(draft);

    // R3 的契约（不退化）：三档各 ≥1
    for (const m of OFFICIAL_MOVEMENTS) {
      expect(getCount(g.inv, m, 1), `${m} ≥ 1`).toBeGreaterThanOrEqual(1);
    }
    // 前后轮仍按玩家自己的配置（R5 没碰）
    expect(g.draft.rearWheelDefId).toBe('wheelStd');
    expect(g.draft.frontWheelDefId, '前轮仍是玩家自己装的那一档').toBe('largeWheel');
    // 不变式仍成立
    const reading = movementOwnership(g.inv, g.draft);
    expect(reading.legal, 'Movement ownership 不变式 legal=真').toBe(true);
  });
});

/* ============================================================================
   E. 结构守卫（不制造第二套记录 / 唯一真源 / 只增不减）
   ============================================================================ */

describe('E. 结构守卫', () => {
  it('CP-11 种子只新增**它自己的**那一个 key，且版本信封与其它迁移同型', () => {
    const draft = seedExistingAccount();
    const keysBefore = store.keys();

    openGrowthSession(draft);

    const added = store.keys().filter((k) => !keysBefore.includes(k));
    /*
      ⚠️ 已预置 R2/R3/R4 标记 ⇒ 它们的标记本来就在，本次新增只可能来自本种子：
           ① 本种子自己的版本标记 `strongfruit.r5ContentPoolSeed.v1`；
           ② 车身拥有集合 `strongfruit.ownedBodies.v1` —— 它由 `grantBody` 创建。
              本夹具里 R4 被隔离（没跑）⇒ 这个 key **首次**由本种子建立；
              真机上若 R4 跑过，它就已经存在、不会出现在 `added` 里。
         **闭集语义**：多出任何别的 key 这一条照样红。
    */
    expect(added.sort()).toEqual([R5_CONTENT_POOL_KEY, 'strongfruit.ownedBodies.v1'].sort());
    // 信封里有既有 `saveVersion` 的戳（不新造第二套版本机制）
    const raw = store.getItem(R5_CONTENT_POOL_KEY)!;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed[STAMP_KEY], `信封带 ${STAMP_KEY}`).toBeTypeOf('number');
    expect(readR5ContentPoolSeed()!.version).toBe(R5_CONTENT_POOL_VERSION);
    expect(isR5ContentPoolDone()).toBe(true);
    // 库存本体仍只有那一份（不新建第二个库存 key）
    expect(loadInventoryRaw(), '库存仍写在 ownedParts.v2').toBeTruthy();
  });

  it('CP-12 模块**只增不减**：源码里没有 revoke / consume / 删除动作（源码守卫，先剥注释）', () => {
    const src = strip(readSource('product/r5ContentPoolSeed.ts'));
    expect(src.includes('revoke'), '不得出现 revoke').toBe(false);
    expect(src.includes('consume'), '不得出现 consume（只增不减）').toBe(false);
    expect(src.includes('.removeItem'), '不得删除任何 key').toBe(false);
    expect(src.includes('setItem'), '不得直接写存储（经 mark 那一处封装）').toBe(true);
    // 写动作只有这两个
    expect(src.includes('grantBody('), '车身写动作只有 grantBody').toBe(true);
    expect(src.includes('addPart('), '功能件写动作只有 addPart').toBe(true);
    // 不发 ★2+：星级只经 R5_POOL_STAR（= 1）传入
    expect(src.includes('R5_POOL_STAR'), '星级必须经 R5_POOL_STAR').toBe(true);
  });

  it('CP-13 **唯一真源**：两个集合全部从 core 真源派生，模块里不写死任何 id 字面量', () => {
    const src = strip(readSource('product/r5ContentPoolSeed.ts'));
    expect(src.includes('NEW_OFFICIAL_BODIES'), '必须现读 NEW_OFFICIAL_BODIES').toBe(true);
    expect(src.includes('OFFICIAL_PARTS'), '必须现读 OFFICIAL_PARTS').toBe(true);
    // 不得写死任何具体 id（正文里只有注释可以提到它们）
    for (const id of [...OFFICIAL_BODIES, ...OFFICIAL_PARTS, ...OFFICIAL_MOVEMENTS]) {
      expect(src.includes(`'${id}'`), `不得写死 ${id} 字面量`).toBe(false);
    }
  });

  it('CP-14 **不改任何数值**：源码里不出现任何数值字段名（hp / mass / energy / damage …）', () => {
    const src = strip(readSource('product/r5ContentPoolSeed.ts'));
    for (const field of [
      'baseMass',
      'energyCapacity',
      'damage',
      'recoilImpulse',
      'projectileDamage',
      'driveTorque',
      'radius',
    ]) {
      expect(src.includes(field), `不得触碰数值字段 ${field}`).toBe(false);
    }
  });

  it('CP-15 接线守卫：成长会话在 Body 种子**之后**、落盘**之前**调用它，且读数如实回传、标记按序落', () => {
    const src = strip(readSource('product/playerGrowth.ts'));
    const iBodySeed = src.indexOf('applyR4BodyChoiceSeed()');
    const iPool = src.indexOf('applyR5ContentPoolSeed(inv)');
    const iSave = src.indexOf('if (changed) saveInventory(inv)');
    const iMark = src.indexOf('markR5ContentPoolSeed()');
    expect(iBodySeed, '必须先调 Body 种子').toBeGreaterThan(-1);
    expect(iPool, '必须调用本种子').toBeGreaterThan(-1);
    expect(iSave, '必须有那唯一一次落盘').toBeGreaterThan(-1);
    expect(iMark, '必须落标记').toBeGreaterThan(-1);
    // 顺序：Body 种子 → 内容池种子 → 落盘 → 标记
    expect(iPool, '内容池种子排在 Body 种子之后').toBeGreaterThan(iBodySeed);
    expect(iPool, '内容池种子排在落盘之前').toBeLessThan(iSave);
    expect(iMark, '标记晚于落盘（功能件那一半要靠那次落盘）').toBeGreaterThan(iSave);
    // `changed` 必须由 `inventoryChanged` 驱动（车身那一半自己落盘）
    expect(
      src.includes('contentPoolSeed.inventoryChanged'),
      'changed 必须由 inventoryChanged 驱动（不是 applied）',
    ).toBe(true);
    // 读数如实回传（探针 / 页面不各自再判一次）
    expect(src.includes('contentPoolSeed,'), '会话必须回传 contentPoolSeed 读数').toBe(true);
  });

  it('CP-16 纯函数 `applyR5ContentPoolSeed` 直接读数（不依赖成长会话，且不落标记）', () => {
    isolateOtherMigrations();
    const inv = playerInventory(defaultPlayerDraft());
    const out = applyR5ContentPoolSeed(inv);
    expect(out.applied).toBe(true);
    expect(out.raisedBodies).toBe(NEW_OFFICIAL_BODIES.length);
    expect(out.raisedParts).toBe(NON_STARTER_PARTS.length);
    expect(out.inventoryChanged).toBe(true);
    // 它**不落标记**（标记由调用方落）
    expect(isR5ContentPoolDone(), '标记由调用方落，不在本函数里').toBe(false);
    expect(store.getItem(R5_CONTENT_POOL_KEY)).toBeNull();
    // 车身那一半自己落了盘（grantBody 的语义）——「已拥有」与「标记」是两件事
    for (const b of NEW_OFFICIAL_BODIES) {
      expect(isBodyOwned(b)).toBe(true);
    }
  });

  it('CP-17 探针字段与页面同源（homePage 探针必须报出本种子的四个读数）', () => {
    const src = strip(readSource('product/homePage.ts'));
    expect(src.includes('contentPoolSeedApplied'), '探针必须报 applied').toBe(true);
    expect(src.includes('contentPoolSeedReason'), '探针必须报 reason').toBe(true);
    expect(src.includes('contentPoolSeedDecided'), '探针必须报 decided').toBe(true);
    expect(src.includes('contentPoolSeedRaisedBodies'), '探针必须报 raisedBodies').toBe(true);
    expect(src.includes('contentPoolSeedRaisedParts'), '探针必须报 raisedParts').toBe(true);
    // 页面不得自己算：只能从 growth.contentPoolSeed 现读
    expect(
      src.includes('growth.contentPoolSeed.applied'),
      '页面必须从 growth.contentPoolSeed 现读',
    ).toBe(true);
  });

  it('CP-18 全新账号首入：与其它几份种子叠加、互不覆盖（两条规则各管各的）', () => {
    isolateOtherMigrations();
    const starter = makeStarterDraft('watermelonBody', registry);
    const g = openGrowthSession(starter);

    expect(g.freshProfile, '前提：全新账号').toBe(true);
    expect(g.seeded, '新账号种子（cannon ×4）照常发放').toBe(true);
    expect(g.contentPoolSeed.applied, '内容池种子也照常生效').toBe(true);
    // 两条规则各管各的：新账号种子的 cannon 起点一件都没少
    const raw = loadInventoryRaw()!;
    expect(getCount(raw, 'cannon', 1)).toBe(4);
    // 内容池也铺满了
    for (const p of OFFICIAL_PARTS) {
      expect(getCount(raw, p, 1), `${p} 可装备`).toBeGreaterThanOrEqual(1);
    }
    /*
      ⚠️ 当前装备**一个槽都没被换**：`openGrowthSession` 会回传它自己那份 `draft`
         （reseed 可能换过主武器），所以这里比的不是「同一个对象」而是「同一份配置」
         —— 与入参逐字段相等。这正是「铺内容 ≠ 替玩家改配置」的可断言形式。
    */
    expect(g.draft.bodyDefId).toBe('watermelonBody');
    expect(g.draft.functionalSelections, '装备槽一个都没被改').toEqual(starter.functionalSelections);
    expect(g.draft.rearWheelDefId).toBe(starter.rearWheelDefId);
    expect(g.draft.frontWheelDefId).toBe(starter.frontWheelDefId);
  });
});
