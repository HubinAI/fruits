/**
 * PRODUCT-LOOP-R4-BODY-CHOICE-SEED｜**一次性 Body 可选方案种子** targeted 测试。
 *
 * 逐条对应 Queue 的验收：
 *   ① 已有账号首次进入后 MVP 集合（2 台）正式车身均拥有 → BM-01 / BM-02 / BM-09
 *   ② reload / 再次进入数量不继续增长                    → BM-03 / BM-03b
 *   ③ 原 Weapon / Movement / BuildDraft 数据不丢失       → BM-05 / BM-06 / BM-07
 *   ④ 当前装备状态不被 Seed 自动改变                      → BM-04 / BM-08
 *   ⑤ targeted tests + tsc                                → 本文件
 *
 * 外加本队列自己立的不变量：
 *   - **只增不减**：唯一的写动作是 `grantBody`（没有 revoke / 不删键 / 不归零）；
 *   - **只影响 Body 拥有状态**：Weapon / Movement 库存一个字节都不动（BM-05）；
 *   - **不碰 BuildDraft**：`draft` 是**同一个对象**、磁盘那一份逐字节不变（BM-04）；
 *   - **不制造第二套记录**：唯一的新 key 是本种子自己的版本标记（BM-10 白名单形式）。
 *
 * ⚠️ 本文件**不**调用 `markR4BodySeed()` 做隔离 —— 那份种子正是**被测对象**。
 *    反过来，这里**必须**预置 R2 与 R3 的标记（`isolatePriorMigrations()`）：否则
 *    onboarding 会补 cannon、reseed 会清 cannon ★≥2、Movement 种子会补轮组，
 *    把读数对账搅浑。
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
  isBodyOwned,
  loadOwnedBodies,
} from '../src/core/bodyOwnership';
import {
  OFFICIAL_PARTS,
  getCount,
  loadInventoryRaw,
  type PartInventory,
} from '../src/core/partInventory';
import { STAMP_KEY } from '../src/core/saveVersion';
import { openGrowthSession } from '../src/product/playerGrowth';
import { markR2Onboarding } from '../src/product/r2Onboarding';
import { markR2Reseed } from '../src/product/r2Reseed';
import { markR3MovementSeed } from '../src/product/r3MovementChoiceSeed';
import { markR5ContentPoolSeed } from '../src/product/r5ContentPoolSeed';
import { bodyOwnership } from '../src/product/bodyInventory';
import { defaultPlayerDraft, playerInventory } from '../src/product/playerLoadout';
import {
  R4_BODY_SEED_KEY,
  R4_BODY_SEED_VERSION,
  MVP_BODY_CHOICE_IDS,
  applyR4BodyChoiceSeed,
  isR4BodySeedDone,
  readR4BodySeed,
} from '../src/product/r4BodyChoiceSeed';

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
 * 预置 **R2 + R3 + R5** 那几份标记 ⇒ 本文件只观察 Body 种子本身。
 *
 * ⚠️ 刻意**不**预置 `markR4BodySeed()`：那份种子是被测对象。
 *
 * ⚠️ PRODUCT-LOOP-R5-BASIC-CONTENT-POOL-R1｜**必须**把 R5 的内容池种子也预置掉：
 *    它排在 R4 **之后**、会把 R4 之外的 2 台车身（pear / orange）一并解锁、并给全部
 *    `OFFICIAL_PARTS` 补 ★1 ×1 ⇒ 不预置的话，下面「MVP 之外的其余新车身不被 seed」
 *    「Body 种子只碰拥有状态、Weapon 库存一个字节都不动」这两条会**被 R5 的副作用污染**，
 *    读到的是两份种子叠加后的形态，而不是 R4 自己的行为。
 *    这是**隔离被测对象**（与预置 R2 / R3 完全同一条纪律），不是放宽断言。
 */
function isolatePriorMigrations(): void {
  markR2Onboarding();
  markR2Reseed();
  markR3MovementSeed();
  markR5ContentPoolSeed();
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

/** 一份库存里**非 Movement** 的全部读数（OFFICIAL_PARTS 五档；「不丢数据」的对账口径）。 */
function nonMovementSnapshot(inv: PartInventory): string {
  const out: Record<string, number[]> = {};
  for (const p of OFFICIAL_PARTS) {
    out[p] = [1, 2, 3, 4, 5].map((s) => getCount(inv, p, s));
  }
  return canon(out);
}

/**
 * 一个「**历史账号**」：磁盘上已经有 Build 与库存（所以 `isFreshProfile()` 为 false，
 * 新账号种子不发 —— 这正是 Queue 描述的「已有账号」形态）。
 *
 * ⚠️ 刻意不经 `openGrowthSession`（那会顺带跑本文件要测的种子）：
 *    这里直接走 core 的 `savePlayerBuild` 落下**确定的**起点。
 */
function seedExistingAccount(
  opts: { readonly draft?: BuildDraft } = {},
): BuildDraft {
  isolatePriorMigrations();
  const draft = opts.draft ?? defaultPlayerDraft();
  savePlayerBuild(draft);
  // 落 starter 库存（core ensureInventory）⇒ 既让 `isFreshProfile()` 为 false，
  // 又让 `loadInventoryRaw()` 非 null（BM-05 的对账前提）。
  playerInventory(draft);
  return draft;
}

/* ============================================================================
   A. 验收 ①｜首次进入后新 4 台均拥有
   ============================================================================ */

describe('A. 首次进入 ⇒ MVP 集合各均拥有（验收 ①）', () => {
  it('BM-01 已有账号首入：MVP 集合全部拥有、`applied` 为真且逐件读数对账', () => {
    const draft = seedExistingAccount();
    // 前提：历史账号上 MVP 集合确实**都没有**（否则本用例在证一个已经成立的事）
    for (const b of MVP_BODY_CHOICE_IDS) {
      expect(isBodyOwned(b), `前提：${b} 未拥有`).toBe(false);
    }
    expect(isR4BodySeedDone(), '前提：首入判定尚未做出').toBe(false);

    const g = openGrowthSession(draft);

    expect(g.bodySeed.reason).toBe('seeded');
    expect(g.bodySeed.applied).toBe(true);
    expect(g.bodySeed.decided, '首入判定 ⇒ 必须落标记').toBe(true);
    expect(g.bodySeed.raised, 'MVP 集合各补 1').toBe(MVP_BODY_CHOICE_IDS.length);

    // 逐件对账：`ownedBefore` 如实报出改动前读数，`ownedAfter` 是改完之后的现读值
    expect(g.bodySeed.entries.map((e) => e.defId)).toEqual([...MVP_BODY_CHOICE_IDS]);
    for (const e of g.bodySeed.entries) {
      expect(e.ownedBefore, `${e.defId} 改前`).toBe(false);
      expect(e.ownedAfter, `${e.defId} 改后`).toBe(true);
      expect(e.raised, `${e.defId} 补 1`).toBe(1);
    }

    // 真的落盘了（不是只改了内存）
    for (const b of MVP_BODY_CHOICE_IDS) {
      expect(isBodyOwned(b), `${b} 已落盘`).toBe(true);
    }
    // MVP 之外的其余新车身（pearBody / orangeBody）**不**被 seed（MVP 是刻意收窄的验证面）
    for (const b of NEW_OFFICIAL_BODIES.filter((x) => !MVP_BODY_CHOICE_IDS.includes(x))) {
      expect(isBodyOwned(b), `${b} 不属于 MVP，不应被 seed`).toBe(false);
    }
    // 旧 4 台恒默认拥有，种子碰不到它们
    for (const b of DEFAULT_OWNED_BODIES) {
      expect(isBodyOwned(b), `${b} 恒默认拥有`).toBe(true);
    }
  });

  it('BM-02 旧 4 台**保持默认拥有语义**：种子不给它们制造任何拥有记录（必改 2）', () => {
    const draft = seedExistingAccount();
    openGrowthSession(draft);
    // 拥有状态落在 `strongfruit.ownedBodies.v1`（只记新车身），旧 4 台不进这个集合
    const owned = loadOwnedBodies();
    for (const b of DEFAULT_OWNED_BODIES) {
      expect(owned, '旧车身不落拥有集合').not.toContain(b);
    }
    // 但 `isBodyOwned` 对旧 4 台恒 true（DEFAULT_OWNED_BODIES 语义）
    for (const b of DEFAULT_OWNED_BODIES) {
      expect(isBodyOwned(b)).toBe(true);
    }
  });

  it('BM-09 全新账号首入：种子同样生效（两条规则叠加，互不覆盖）', () => {
    isolatePriorMigrations();
    // 全新账号（磁盘上既没有 Build 也没有库存）⇒ `isFreshProfile()` 为真
    const g = openGrowthSession(makeStarterDraft('watermelonBody', registry));

    expect(g.freshProfile, '前提：全新账号').toBe(true);
    expect(g.seeded, '新账号种子（cannon ×4）照常发放').toBe(true);
    expect(g.bodySeed.applied, 'Body 种子也照常生效').toBe(true);
    for (const b of MVP_BODY_CHOICE_IDS) {
      expect(isBodyOwned(b), `${b}`).toBe(true);
    }
    // 两条规则各管各的：新账号种子的三件一件都没少
    const raw = loadInventoryRaw()!;
    expect(getCount(raw, 'cannon', 1)).toBe(4);
  });
});

/* ============================================================================
   B. 验收 ②｜只执行一次，reload 不重复增加
   ============================================================================ */

describe('B. 只执行一次 + reload 幂等（验收 ② / 必改 3）', () => {
  it('BM-03 第二次挂载（= reload）：拥有集合逐字节不变、`reason` 翻成 `already-marked`', () => {
    const draft = seedExistingAccount();
    const first = openGrowthSession(draft);
    expect(first.bodySeed.applied).toBe(true);
    const afterFirst = store.getItem('strongfruit.ownedBodies.v1');

    // 第二次挂载
    const second = openGrowthSession(draft);

    expect(second.bodySeed.reason, '首入判定已做出 ⇒ 不再重判').toBe('already-marked');
    expect(second.bodySeed.applied).toBe(false);
    expect(second.bodySeed.decided, '标记本来就在 ⇒ 不必再写').toBe(false);
    expect(second.bodySeed.raised).toBe(0);
    expect(store.getItem('strongfruit.ownedBodies.v1'), '拥有集合逐字节不变').toBe(afterFirst);
    // `already-marked` 出口的 `entries` 也如实报出读数（前后相同、raised 0）
    for (const e of second.bodySeed.entries) {
      expect(e.ownedBefore).toBe(e.ownedAfter);
      expect(e.raised).toBe(0);
    }
  });

  it('BM-03b 连跑五次：MVP 集合恒拥有且不重复补（不是「每两次挂载才不涨」那种偶发通过）', () => {
    const draft = seedExistingAccount();
    for (let i = 0; i < 5; i += 1) {
      const g = openGrowthSession(draft);
      if (i === 0) expect(g.bodySeed.applied, '第一次必须真的补').toBe(true);
      else expect(g.bodySeed.applied, `第 ${i + 1} 次必须空操作`).toBe(false);
    }
    const owned = loadOwnedBodies();
    expect(owned.sort()).toEqual([...MVP_BODY_CHOICE_IDS].sort());
  });

  it('BM-11 `already-owned` 出口：MVP 集合本来就有 ⇒ 一个字节都不动，但**仍然落标记**', () => {
    // 先手动把 MVP 集合都发到拥有集合（模拟「玩家自己已经解锁」）
    store.setItem('strongfruit.ownedBodies.v1', JSON.stringify([...MVP_BODY_CHOICE_IDS]));
    const draft = seedExistingAccount();
    const before = store.getItem('strongfruit.ownedBodies.v1');

    const g = openGrowthSession(draft);

    expect(g.bodySeed.reason).toBe('already-owned');
    expect(g.bodySeed.applied).toBe(false);
    expect(g.bodySeed.raised).toBe(0);
    /*
      ⚠️ `decided === true` 是**正确性要求**而不是风格选择：若不落标记，玩家之后在
      debug 里取消某台车身的拥有时，下一次挂载判据会重新成立 ⇒ 玩家自己取消的拥有被重发。
    */
    expect(g.bodySeed.decided, '「一个字节不动」的出口也必须落标记').toBe(true);
    expect(store.getItem('strongfruit.ownedBodies.v1'), '拥有集合逐字节不变').toBe(before);
  });

  it('BM-11b 落标记之后玩家自己取消某台 MVP 车身 ⇒ **不会**被重新发一遍', () => {
    const draft = seedExistingAccount();
    openGrowthSession(draft); // 首入：补 MVP 集合 + 落标记
    // 玩家自己把 durianBody 取消拥有
    const owned = loadOwnedBodies().filter((b) => b !== 'durianBody');
    store.setItem('strongfruit.ownedBodies.v1', JSON.stringify(owned));
    expect(isBodyOwned('durianBody')).toBe(false);

    const g = openGrowthSession(draft);

    expect(g.bodySeed.reason, '判定已做出 ⇒ 不重判').toBe('already-marked');
    expect(isBodyOwned('durianBody'), '不重发').toBe(false);
  });

  it('BM-12 **部分拥有**：只补缺的那几台，已有的原样不动', () => {
    store.setItem('strongfruit.ownedBodies.v1', JSON.stringify(['durianBody']));
    const draft = seedExistingAccount();
    expect(isBodyOwned('durianBody')).toBe(true);
    expect(isBodyOwned('mangoBody')).toBe(false);

    const g = openGrowthSession(draft);

    expect(g.bodySeed.raised, '只补一台（mangoBody）').toBe(1);
    expect(isBodyOwned('durianBody')).toBe(true);
    expect(isBodyOwned('mangoBody')).toBe(true);
    // 逐件读数里，已经拥有的那一台如实报 `raised: 0`
    expect(g.bodySeed.entries.find((e) => e.defId === 'durianBody')!.raised).toBe(0);
    expect(g.bodySeed.entries.find((e) => e.defId === 'mangoBody')!.raised).toBe(1);
  });
});

/* ============================================================================
   C. 验收 ③ / ④｜数据不丢失 + 不改装备
   ============================================================================ */

describe('C. 不丢数据 + 不改装备状态（验收 ③ / ④）', () => {
  it('BM-05 只影响 Body 拥有状态：Weapon / Movement 库存一个字节都不动', () => {
    const draft = seedExistingAccount();
    const inv = loadInventoryRaw()!;
    const weaponsBefore = nonMovementSnapshot(inv);
    const keysBefore = Object.keys(inv).sort();

    const g = openGrowthSession(draft);

    expect(g.bodySeed.applied).toBe(true);
    expect(nonMovementSnapshot(g.inv), '全部正式 Weapon 的 ★1..★5 逐条相等').toBe(weaponsBefore);
    expect(Object.keys(g.inv).sort(), '库存键集不变').toEqual(keysBefore);
  });

  it('BM-04 **不碰 BuildDraft**：会话回传的 `draft` 是同一个对象，磁盘那一份逐字节不变', () => {
    const draft = seedExistingAccount();
    const buildBefore = store.getItem('strongfruit.playerBuild.v1');

    const g = openGrowthSession(draft);

    expect(g.bodySeed.applied).toBe(true);
    expect(g.draft, 'Build 是同一个对象（逐字节相同，不是副本）').toBe(draft);
    expect(store.getItem('strongfruit.playerBuild.v1'), '磁盘那一份 Build 逐字节不变').toBe(buildBefore);
  });

  it('BM-08 Seed **不自动替玩家换车身**（验收 ④）', () => {
    // 前提：玩家当前装的是香蕉车身（一个「非缺省」的当前配置）
    const base = defaultPlayerDraft();
    const draft: BuildDraft = { ...base, bodyDefId: 'bananaBody' };
    const seeded = seedExistingAccount({ draft });
    expect(seeded.bodyDefId, '前提：当前是 bananaBody').toBe('bananaBody');

    const g = openGrowthSession(seeded);

    // ① 存档字段一个字节都没改（不自动替玩家换车身）
    expect(g.draft.bodyDefId, '不自动换车身').toBe('bananaBody');
    // ② MVP 集合**都拥有了**，但**一台都没被自动装上**
    for (const b of MVP_BODY_CHOICE_IDS) {
      expect(isBodyOwned(b), `${b} 拥有`).toBe(true);
    }
    const ownership = bodyOwnership(g.draft);
    expect(ownership.equippedDefIds, '只有 bananaBody 装着').toEqual(['bananaBody']);
    expect(ownership.bodyDefId).toBe('bananaBody');
  });

  it('BM-07 历史账号的 Build 不被迁移改写', () => {
    const starter = makeStarterDraft('watermelonBody', registry);
    const { draft } = { draft: seedExistingAccount({ draft: { ...defaultPlayerDraft(), bodyDefId: starter.bodyDefId } }) };
    const before = store.getItem('strongfruit.playerBuild.v1');

    openGrowthSession(draft);

    expect(store.getItem('strongfruit.playerBuild.v1'), 'Build 逐字节不变').toBe(before);
  });
});

/* ============================================================================
   D. 结构与边界守卫（不制造第二套记录 / 唯一真源 / 只增不减）
   ============================================================================ */

describe('D. 结构守卫', () => {
  it('BM-10 种子只新增**它自己的**那一个 key，且版本信封与其它迁移同型', () => {
    const draft = seedExistingAccount();
    const keysBefore = store.keys();

    openGrowthSession(draft);

    const added = store.keys().filter((k) => !keysBefore.includes(k));
    // 已预置 R2/R3 标记；新增只有本种子自己的标记（注意：也可能含 ownedBodies.v1 若为全新）
    expect(added).toContain(R4_BODY_SEED_KEY);
    // 信封里有既有 `saveVersion` 的戳（不新造第二套版本机制）
    const raw = store.getItem(R4_BODY_SEED_KEY)!;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed[STAMP_KEY], `信封带 ${STAMP_KEY}`).toBeTypeOf('number');
    expect(readR4BodySeed()!.version).toBe(R4_BODY_SEED_VERSION);
    expect(isR4BodySeedDone()).toBe(true);
  });

  it('BM-13 模块**只增不减**：源码里没有 revoke，没有删除动作（源码守卫，先剥注释）', () => {
    const src = strip(readSource('product/r4BodyChoiceSeed.ts'));
    expect(src.includes('revoke'), '不得出现 revoke').toBe(false);
    expect(src.includes('.removeItem'), '不得删除任何 key').toBe(false);
    expect(src.includes('resetPlayerSave'), '不得触发任何 Reset').toBe(false);
    // 唯一的写动作是 grantBody（幂等追加）
    expect(src.includes('grantBody('), '写动作只有 grantBody').toBe(true);
  });

  it('BM-14 **唯一真源**：MVP id 全部从 NEW_OFFICIAL_BODIES 派生，模块里不写死第二张车身字面量表', () => {
    const src = strip(readSource('product/r4BodyChoiceSeed.ts'));
    // MVP 集合是 `NEW_OFFICIAL_BODIES.filter(...)` 派生，必须现读 NEW_OFFICIAL_BODIES
    expect(src.includes('NEW_OFFICIAL_BODIES'), '必须现读 NEW_OFFICIAL_BODIES').toBe(true);
    expect(src.includes('MVP_BODY_CHOICE_IDS'), '必须声明 MVP 集合').toBe(true);
    // MVP 集合里的 id 必须与 NEW_OFFICIAL_BODIES 真源对齐（不是凭空造 id）
    for (const b of MVP_BODY_CHOICE_IDS) {
      expect(NEW_OFFICIAL_BODIES, `MVP 的 ${b} 必须来自 NEW_OFFICIAL_BODIES`).toContain(b);
    }
    // 且不能「静默发全部」：源码不得仍调用 grantAllNewBodies（那会一次解锁全部 4 台）
    expect(src.includes('grantAllNewBodies('), 'MVP 收窄后不得再调用 grantAllNewBodies').toBe(false);
  });

  it('BM-15 接线守卫：成长会话在 Movement 种子**之后**调用它，且读数如实回传、标记按序落', () => {
    const src = strip(readSource('product/playerGrowth.ts'));
    const iMovementSeed = src.indexOf('applyR3MovementChoiceSeed(inv)');
    const iBodySeed = src.indexOf('applyR4BodyChoiceSeed()');
    const iMark = src.indexOf('markR4BodySeed()');
    expect(iMovementSeed, '必须先调 Movement 种子').toBeGreaterThan(-1);
    expect(iBodySeed, '必须调用本种子').toBeGreaterThan(-1);
    expect(iMark, '必须落标记').toBeGreaterThan(-1);
    // 顺序：Movement 种子 → Body 种子 → 标记
    expect(iBodySeed, 'Body 种子排在 Movement 种子之后').toBeGreaterThan(iMovementSeed);
    expect(iMark, '标记晚于 Body 种子').toBeGreaterThan(iBodySeed);
    // 读数如实回传（探针 / 页面不各自再判一次）
    expect(src.includes('bodySeed'), '会话必须回传 bodySeed 读数').toBe(true);
  });

  it('BM-16 纯函数 `applyR4BodyChoiceSeed` 直接读数（不依赖成长会话，且不落标记）', () => {
    const out = applyR4BodyChoiceSeed();
    expect(out.applied).toBe(true);
    expect(out.raised).toBe(MVP_BODY_CHOICE_IDS.length);
    for (const b of MVP_BODY_CHOICE_IDS) {
      expect(isBodyOwned(b)).toBe(true);
    }
    // MVP 之外的其余新车身不被 seed
    for (const b of NEW_OFFICIAL_BODIES.filter((x) => !MVP_BODY_CHOICE_IDS.includes(x))) {
      expect(isBodyOwned(b), `${b} 不属于 MVP，不应被 seed`).toBe(false);
    }
    // 它**不落标记**（标记由调用方落）⇒ 标记仍未写入
    expect(isR4BodySeedDone(), '标记由调用方落，不在本函数里').toBe(false);
    expect(store.getItem(R4_BODY_SEED_KEY)).toBeNull();
  });
});
