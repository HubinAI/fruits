/**
 * PRODUCT-LOOP-R3-MOVEMENT-CHOICE-SEED｜**一次性 Movement 可选方案种子** targeted 测试。
 *
 * 逐条对应 Queue 的验收：
 *   ① 已有账号首次进入后 small / large / heavy 均至少拥有 1  → CS-01 / CS-02 / CS-09
 *   ② reload / 再次进入数量不继续增长                        → CS-03 / CS-03b
 *   ③ 原 Weapon / Movement / BuildDraft 数据不丢失            → CS-05 / CS-06 / CS-07
 *   ④ 当前装备状态不被 Seed 自动改变                          → CS-04 / CS-08
 *   ⑤ targeted tests + tsc                                    → 本文件
 *
 * 外加本队列自己立的不变量：
 *   - **只增不减**：唯一的写动作是 `addPart(+1)`（没有 `consume` / 不删键 / 不归零）；
 *   - **只影响 Movement**：Weapon / Body / Gadget 五档逐条不变（CS-06）；
 *   - **不碰 BuildDraft**：`draft` 是**同一个对象**、磁盘那一份逐字节不变（CS-04）；
 *   - **不制造第二套记录**：唯一的新 key 是本种子自己的版本标记（CS-10 白名单形式）。
 *
 * ⚠️ 本文件**不**调用 `markR3MovementSeed()` 做隔离 —— 那份种子正是**被测对象**。
 *    反过来，这里**必须**预置 R2 的两份标记（`isolateR2Migrations()`）：否则 onboarding
 *    会补 cannon、reseed 会清 cannon ★≥2，把库存读数的对账搅浑。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it } from 'vitest';

import { savePlayerBuild } from '../src/core/buildPersistence';
import { EMPTY_SLOT, makeStarterDraft, type BuildDraft } from '../src/lab/buildEditorModel';
import { registry } from '../src/core/content';
import {
  OFFICIAL_MOVEMENTS,
  OFFICIAL_PARTS,
  addPart,
  getCount,
  loadInventoryRaw,
  saveInventory,
  type PartInventory,
} from '../src/core/partInventory';
import { STAMP_KEY } from '../src/core/saveVersion';
import { openGrowthSession } from '../src/product/playerGrowth';
import { markR2Onboarding } from '../src/product/r2Onboarding';
import { markR2Reseed } from '../src/product/r2Reseed';
import { markR5ContentPoolSeed } from '../src/product/r5ContentPoolSeed';
import { MOVEMENT_STAR, movementEntries } from '../src/product/movementInventory';
import { defaultMovementDefId, movementMapping } from '../src/product/runMovementCanonical';
import { defaultPlayerDraft, playerInventory } from '../src/product/playerLoadout';
import {
  R3_MOVEMENT_SEED_KEY,
  R3_MOVEMENT_SEED_MIN_COUNT,
  R3_MOVEMENT_SEED_VERSION,
  applyR3MovementChoiceSeed,
  isR3MovementSeedDone,
  readR3MovementSeed,
} from '../src/product/r3MovementChoiceSeed';
// PRODUCT-LOOP-R4-BODY-CANONICAL-AND-GARAGE-MVP：Body 种子的标记 + 车身拥有集合
// （`openGrowthSession` 会顺带跑 Body 种子 ⇒ key 闭集白名单要把它俩一并纳入）
import { R4_BODY_SEED_KEY } from '../src/product/r4BodyChoiceSeed';

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
 * 预置 **R2 那两份 + R5 内容池**迁移的标记 ⇒ 本文件只观察 Movement 种子本身。
 *
 * ⚠️ 刻意**不**预置 `markR3MovementSeed()`：那份种子是被测对象。
 *
 * ⚠️ PRODUCT-LOOP-R5-BASIC-CONTENT-POOL-R1｜**必须**把 R5 的内容池种子也预置掉：
 *    它排在 R3 **之后**、会给全部 `OFFICIAL_PARTS` 补 ★1 ×1（即**会写同一份库存**）
 *    ⇒ 不预置的话，下面「只影响 Movement：Weapon / Body / Gadget 五档逐条不变」
 *    「`already-owned` 出口一个字节都不动」「本次挂载只新增白名单里那几个 key」
 *    这三条都会**被 R5 的库存副作用污染**（读到两份种子叠加后的形态）。
 *    这是**隔离被测对象**（与预置 R2 完全同一条纪律），不是放宽断言。
 * ⚠️ 刻意**不**预置 `markR4BodySeed()`：R4 只写车身拥有状态、**不碰库存**
 *    ⇒ 它对本文件观察的库存读数零影响（CS-10 的白名单里已把它的两个 key 登记上）。
 */
function isolateR2Migrations(): void {
  markR2Onboarding();
  markR2Reseed();
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
 *    这里直接走 core 的 `savePlayerBuild` / `saveInventory` 落下**确定的**起点。
 */
function seedExistingAccount(
  opts: { readonly draft?: BuildDraft; readonly movementCounts?: Record<string, number> } = {},
): { draft: BuildDraft; inv: PartInventory } {
  isolateR2Migrations();
  const draft = opts.draft ?? defaultPlayerDraft();
  savePlayerBuild(draft);
  const inv = playerInventory(draft); // core `ensureInventory`：落下 starter 库存
  for (const [defId, n] of Object.entries(opts.movementCounts ?? {})) {
    addPart(inv, defId, MOVEMENT_STAR, n);
  }
  saveInventory(inv);
  return { draft, inv: loadInventoryRaw() as PartInventory };
}

/* ============================================================================
   A. 验收 ①｜首次进入后三档均至少拥有 1 件
   ============================================================================ */

describe('A. 首次进入 ⇒ 三档各至少 1 件（验收 ①）', () => {
  it('CS-01 已有账号首入：三档 `count` 均 ≥ 1、`owned` 全真、`applied` 为真且逐件读数对账', () => {
    const { draft, inv: before } = seedExistingAccount();
    // 前提：历史账号上三档确实**一件都没有**（否则本用例在证一个已经成立的事）
    for (const m of OFFICIAL_MOVEMENTS) {
      expect(getCount(before, m, MOVEMENT_STAR), `前提：${m} 未拥有`).toBe(0);
    }
    expect(isR3MovementSeedDone(), '前提：首入判定尚未做出').toBe(false);

    const g = openGrowthSession(draft);

    expect(g.movementSeed.reason).toBe('seeded');
    expect(g.movementSeed.applied).toBe(true);
    expect(g.movementSeed.decided, '首入判定 ⇒ 必须落标记').toBe(true);
    expect(g.movementSeed.raised, '三档各补 1 件').toBe(OFFICIAL_MOVEMENTS.length);

    // 逐件对账：`countBefore` 如实报出改动前的读数，`countAfter` 是**改完之后**的现读值
    expect(g.movementSeed.entries.map((e) => e.defId)).toEqual([...OFFICIAL_MOVEMENTS]);
    for (const e of g.movementSeed.entries) {
      expect(e.countBefore, `${e.defId} 改前`).toBe(0);
      expect(e.raised, `${e.defId} 补 1`).toBe(R3_MOVEMENT_SEED_MIN_COUNT);
      expect(e.countAfter, `${e.defId} 改后`).toBe(R3_MOVEMENT_SEED_MIN_COUNT);
    }

    // 拥有状态：三档 owned 全真（`implicit` 全假 —— 它们是**真的进了库存**）
    for (const m of OFFICIAL_MOVEMENTS) {
      const entry = movementEntries(g.inv, g.draft).find((e) => e.defId === m)!;
      expect(entry.owned, `${m} 现在拥有`).toBe(true);
      expect(entry.implicit, `${m} 靠库存拥有，不是 implicit`).toBe(false);
      expect(entry.count, `${m} 库存计数`).toBeGreaterThanOrEqual(1);
    }
    // 真的落盘了（不是只改了内存）
    const raw = loadInventoryRaw()!;
    for (const m of OFFICIAL_MOVEMENTS) {
      expect(getCount(raw, m, MOVEMENT_STAR), `${m} 已落盘`).toBe(1);
    }
  });

  it('CS-02 缺省轮**保持原有 implicit / default 语义**：种子不给它补件、也不让它进库存（必改 2）', () => {
    const { draft } = seedExistingAccount();
    const def = defaultMovementDefId();
    // 前提：缺省轮不在 OFFICIAL_MOVEMENTS 里（它本来就不需要库存）⇒ 种子结构上碰不到它
    expect(OFFICIAL_MOVEMENTS.includes(def), '前提：缺省轮不属于「需要库存」的那一档').toBe(false);

    const g = openGrowthSession(draft);

    const dflt = movementEntries(g.inv, g.draft).find((e) => e.defId === def)!;
    expect(dflt.owned, '缺省轮仍然恒默认拥有').toBe(true);
    expect(dflt.implicit, '且仍然靠 implicit 表达').toBe(true);
    expect(dflt.count, '而且**仍然没有**库存行（种子没给它发东西）').toBe(0);
    // 库存键里也没有它
    expect(Object.keys(loadInventoryRaw()!), '缺省轮不进库存').not.toContain(def);
    expect(g.movements.defaultDefId).toBe(def);
  });

  it('CS-09 全新账号首入：种子同样生效（两条规则叠加，互不覆盖）', () => {
    isolateR2Migrations();
    // 全新账号（磁盘上既没有 Build 也没有库存）⇒ `isFreshProfile()` 为真
    const g = openGrowthSession(makeStarterDraft('watermelonBody', registry));

    expect(g.freshProfile, '前提：全新账号').toBe(true);
    expect(g.seeded, '新账号种子（cannon ×4）照常发放').toBe(true);
    expect(g.movementSeed.applied, 'Movement 种子也照常生效').toBe(true);
    for (const m of OFFICIAL_MOVEMENTS) {
      expect(getCount(loadInventoryRaw()!, m, MOVEMENT_STAR), `${m}`).toBe(1);
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
  it('CS-03 第二次挂载（= reload）：数量不增长、库存逐字节不变、`reason` 翻成 `already-marked`', () => {
    const { draft } = seedExistingAccount();
    const first = openGrowthSession(draft);
    expect(first.movementSeed.applied).toBe(true);
    const afterFirst = store.getItem('strongfruit.ownedParts.v2');

    // 第二次挂载
    const second = openGrowthSession(draft);

    expect(second.movementSeed.reason, '首入判定已做出 ⇒ 不再重判').toBe('already-marked');
    expect(second.movementSeed.applied).toBe(false);
    expect(second.movementSeed.decided, '标记本来就在 ⇒ 不必再写').toBe(false);
    expect(second.movementSeed.raised).toBe(0);
    expect(store.getItem('strongfruit.ownedParts.v2'), '库存逐字节不变').toBe(afterFirst);
    for (const m of OFFICIAL_MOVEMENTS) {
      expect(getCount(loadInventoryRaw()!, m, MOVEMENT_STAR), `${m} 不增长`).toBe(1);
    }
    // `already-marked` 出口的 `entries` 也如实报出读数（前后相同、raised 0）
    for (const e of second.movementSeed.entries) {
      expect(e.countBefore).toBe(e.countAfter);
      expect(e.raised).toBe(0);
    }
  });

  it('CS-03b 连跑五次：计数恒为 1（不是「每两次挂载才不涨」那种偶发通过）', () => {
    const { draft } = seedExistingAccount();
    for (let i = 0; i < 5; i += 1) {
      const g = openGrowthSession(draft);
      if (i === 0) expect(g.movementSeed.applied, '第一次必须真的补').toBe(true);
      else expect(g.movementSeed.applied, `第 ${i + 1} 次必须空操作`).toBe(false);
    }
    const raw = loadInventoryRaw()!;
    for (const m of OFFICIAL_MOVEMENTS) {
      expect(getCount(raw, m, MOVEMENT_STAR), `${m} 恒为 1`).toBe(1);
    }
  });

  it('CS-11 `already-owned` 出口：三档本来就有 ⇒ 一个字节都不动，但**仍然落标记**', () => {
    const { draft } = seedExistingAccount({
      movementCounts: { smallWheel: 2, largeWheel: 3, heavyWheel: 1 },
    });
    const before = store.getItem('strongfruit.ownedParts.v2');

    const g = openGrowthSession(draft);

    expect(g.movementSeed.reason).toBe('already-owned');
    expect(g.movementSeed.applied).toBe(false);
    expect(g.movementSeed.raised).toBe(0);
    /*
      ⚠️ `decided === true` 是**正确性要求**而不是风格选择：若不落标记，玩家之后把
      heavyWheel 当材料用掉时，下一次挂载判据会重新成立 ⇒ 玩家自己消耗掉的东西被重发。
    */
    expect(g.movementSeed.decided, '「一个字节不动」的出口也必须落标记').toBe(true);
    expect(store.getItem('strongfruit.ownedParts.v2'), '库存逐字节不变').toBe(before);
    // 数量既不加也不减（玩家自己攒的 2 / 3 / 1 原样保留）
    const raw = loadInventoryRaw()!;
    expect(getCount(raw, 'smallWheel', MOVEMENT_STAR)).toBe(2);
    expect(getCount(raw, 'largeWheel', MOVEMENT_STAR)).toBe(3);
    expect(getCount(raw, 'heavyWheel', MOVEMENT_STAR)).toBe(1);
  });

  it('CS-11b 落标记之后玩家自己消耗掉一件 ⇒ **不会**被重新发一遍', () => {
    const { draft } = seedExistingAccount();
    openGrowthSession(draft); // 首入：补三档 + 落标记
    // 玩家自己把 heavyWheel 用掉（模拟：任何外部消耗）
    const inv = loadInventoryRaw()!;
    inv['heavyWheel'].one = 0;
    saveInventory(inv);
    expect(getCount(loadInventoryRaw()!, 'heavyWheel', MOVEMENT_STAR)).toBe(0);

    const g = openGrowthSession(draft);

    expect(g.movementSeed.reason, '判定已做出 ⇒ 不重判').toBe('already-marked');
    expect(getCount(loadInventoryRaw()!, 'heavyWheel', MOVEMENT_STAR), '不重发').toBe(0);
  });

  it('CS-12 **部分拥有**：只补缺的那一档，已有的原样不动', () => {
    const { draft } = seedExistingAccount({ movementCounts: { largeWheel: 1 } });
    const before = loadInventoryRaw()!;
    expect(getCount(before, 'smallWheel', MOVEMENT_STAR)).toBe(0);
    expect(getCount(before, 'largeWheel', MOVEMENT_STAR)).toBe(1);

    const g = openGrowthSession(draft);

    expect(g.movementSeed.raised, '只补两档').toBe(2);
    const raw = loadInventoryRaw()!;
    expect(getCount(raw, 'smallWheel', MOVEMENT_STAR)).toBe(1);
    expect(getCount(raw, 'largeWheel', MOVEMENT_STAR), '已有的不多补').toBe(1);
    expect(getCount(raw, 'heavyWheel', MOVEMENT_STAR)).toBe(1);
    // 逐件读数里，已经拥有的那一档如实报 `raised: 0`
    expect(g.movementSeed.entries.find((e) => e.defId === 'largeWheel')!.raised).toBe(0);
  });
});

/* ============================================================================
   C. 验收 ③ / ④｜数据不丢失 + 不改装备
   ============================================================================ */

describe('C. 不丢数据 + 不改装备状态（验收 ③ / ④）', () => {
  it('CS-06 只影响 Movement：Weapon / Body / Gadget 五档逐条不变，且**只**多出 Movement 计数', () => {
    const { draft, inv: before } = seedExistingAccount();
    const weaponsBefore = nonMovementSnapshot(before);
    const keysBefore = Object.keys(before).sort();
    const movementBefore = OFFICIAL_MOVEMENTS.map((m) => getCount(before, m, MOVEMENT_STAR));

    const g = openGrowthSession(draft);

    expect(nonMovementSnapshot(g.inv), '全部正式 Weapon 的 ★1..★5 逐条相等').toBe(weaponsBefore);
    expect(Object.keys(g.inv).sort(), '库存键集不变（不新增/不删除任何部件键）').toEqual(keysBefore);
    // Movement 只增不减：每一档都 ≥ 改前
    OFFICIAL_MOVEMENTS.forEach((m, i) => {
      expect(getCount(g.inv, m, MOVEMENT_STAR), `${m} 只增不减`).toBeGreaterThanOrEqual(movementBefore[i]);
    });
  });

  it('CS-04 **不碰 BuildDraft**：会话回传的 `draft` 是同一个对象，磁盘那一份逐字节不变', () => {
    const { draft } = seedExistingAccount();
    const buildBefore = store.getItem('strongfruit.playerBuild.v1');

    const g = openGrowthSession(draft);

    expect(g.movementSeed.applied).toBe(true);
    expect(g.draft, 'Build 是同一个对象（逐字节相同，不是副本）').toBe(draft);
    expect(store.getItem('strongfruit.playerBuild.v1'), '磁盘那一份 Build 逐字节不变').toBe(buildBefore);
  });

  it('CS-08 Seed **不自动替玩家装备**新轮子、也**不重置**当前 rear / front（验收 ④）', () => {
    // 前提：玩家把后轮明确卸下、前轮选成 smallWheel（= 一个「非缺省」的当前配置）
    const base = defaultPlayerDraft();
    const draft: BuildDraft = {
      ...base,
      functionalSelections: { ...base.functionalSelections },
      rearWheelDefId: EMPTY_SLOT,
      frontWheelDefId: 'smallWheel',
    };
    const { draft: seeded } = seedExistingAccount({ draft });
    expect(seeded.rearWheelDefId, '前提：后轮是明确卸下').toBe(EMPTY_SLOT);
    expect(seeded.frontWheelDefId, '前提：前轮是 smallWheel').toBe('smallWheel');

    const g = openGrowthSession(seeded);

    // ① 存档字段一个字节都没改
    expect(g.draft.rearWheelDefId, '不重置后轮（仍是明确卸下）').toBe(EMPTY_SLOT);
    expect(g.draft.frontWheelDefId, '不改前轮').toBe('smallWheel');
    // ② 生效装载与调用前**完全一致**（Run Snapshot 侧的 Movement 序列）
    const mapping = movementMapping(g.draft);
    expect(mapping.effectiveDefIds, 'Run 侧装载序列不变（后轮卸下 ⇒ 只有前轮一条）').toEqual(['smallWheel']);
    expect(mapping.slots.find((s) => s.hardpointId === 'rear')!.effectiveDefId, '后轮未装').toBeNull();
    // ③ 三档**都拥有了**，但**一件都没被装上**
    for (const m of OFFICIAL_MOVEMENTS) {
      const entry = movementEntries(g.inv, g.draft).find((e) => e.defId === m)!;
      expect(entry.owned, `${m} 拥有`).toBe(true);
      expect(entry.equipped, `${m} 但**没有**被自动装备（只有 smallWheel 本来就装着）`).toBe(m === 'smallWheel');
    }
  });

  it('CS-07 历史账号的 Build 不被迁移改写（`migrateLegacyStarterProfile` 的判别式不受影响）', () => {
    /*
      本种子的硬边界之一是「一个字节都不写 Build」。这里用一个**可观察**的形式钉住它：
      Build 与「历史 starter 档」的判别式（`rear`/`frontMass` == `makeStarterDraft()`）
      在种子跑完之后**仍然成立** —— 若种子偷偷写过 Build，这条判别式会翻转。
    */
    const starter = makeStarterDraft('watermelonBody', registry);
    const { draft } = seedExistingAccount({
      draft: {
        ...defaultPlayerDraft(),
        functionalSelections: { ...defaultPlayerDraft().functionalSelections },
        rearWheelDefId: starter.rearWheelDefId,
        frontWheelDefId: starter.frontWheelDefId,
      },
    });
    const before = store.getItem('strongfruit.playerBuild.v1');

    openGrowthSession(draft);

    expect(store.getItem('strongfruit.playerBuild.v1'), 'Build 逐字节不变').toBe(before);
  });
});

/* ============================================================================
   D. 结构与边界守卫（不制造第二套记录 / 唯一真源 / 只增不减）
   ============================================================================ */

describe('D. 结构守卫', () => {
  it('CS-10 种子只新增**它自己的**那一个 key，且版本信封与其它迁移同型', () => {
    const { draft } = seedExistingAccount();
    const keysBefore = store.keys();

    openGrowthSession(draft);

    const added = store.keys().filter((k) => !keysBefore.includes(k));
    /*
      ⚠️ PRODUCT-LOOP-R4-BODY-CANONICAL-AND-GARAGE-MVP：`openGrowthSession` 会**顺带**跑
         Body 种子（`applyR4BodyChoiceSeed`），它落 `r4BodyChoiceSeed.v1` 标记 + `ownedBodies.v1`
         拥有集合。因此「本次挂载新增的 key」从「只有 Movement 种子自己一条」变成
         「Movement 种子 + Body 种子 + Body 拥有集合」三条。**仍然只是白名单 +2，闭集语义
         原样保留** —— 多出任何别的 key 照样红。
    */
    expect(added.sort(), '新增的 key 白名单 = Movement 种子 + Body 种子&拥有集合').toEqual(
      [R3_MOVEMENT_SEED_KEY, R4_BODY_SEED_KEY, 'strongfruit.ownedBodies.v1'].sort(),
    );
    // 信封里有既有 `saveVersion` 的戳（不新造第二套版本机制）
    const raw = store.getItem(R3_MOVEMENT_SEED_KEY)!;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed[STAMP_KEY], `信封带 ${STAMP_KEY}`).toBeTypeOf('number');
    expect(readR3MovementSeed()!.version).toBe(R3_MOVEMENT_SEED_VERSION);
    expect(isR3MovementSeedDone()).toBe(true);
  });

  it('CS-13 模块**只增不减**：源码里没有 `consume`，没有删除动作（源码守卫，先剥注释）', () => {
    const src = strip(readSource('product/r3MovementChoiceSeed.ts'));
    expect(src.includes('consume('), '不得出现 consume').toBe(false);
    expect(src.includes('.removeItem'), '不得删除任何 key').toBe(false);
    expect(src.includes('resetPlayerSave'), '不得触发任何 Reset').toBe(false);
    // 唯一的写动作是 addPart
    expect(src.includes('addPart('), '写动作只有 addPart').toBe(true);
  });

  it('CS-14 **唯一真源**：id 全部现读自 `OFFICIAL_MOVEMENTS`，模块里不写死任何轮组字面量', () => {
    const src = strip(readSource('product/r3MovementChoiceSeed.ts'));
    for (const m of OFFICIAL_MOVEMENTS) {
      expect(src.includes(`'${m}'`), `不得写死 ${m} 字面量（真源是 OFFICIAL_MOVEMENTS）`).toBe(false);
    }
    expect(src.includes('OFFICIAL_MOVEMENTS'), '必须现读 OFFICIAL_MOVEMENTS').toBe(true);
  });

  it('CS-15 接线守卫：成长会话在 Movement 兜底**之后**、落盘**之前**调用它，且读数如实回传', () => {
    const src = strip(readSource('product/playerGrowth.ts'));
    const iOwnership = src.indexOf('ensureMovementOwnership(inv, nextDraft)');
    const iSeed = src.indexOf('applyR3MovementChoiceSeed(inv)');
    const iSave = src.indexOf('if (changed) saveInventory(inv)');
    const iMark = src.indexOf('markR3MovementSeed()');
    expect(iOwnership, '必须调用 Movement ownership 兜底').toBeGreaterThan(-1);
    expect(iSeed, '必须调用本种子').toBeGreaterThan(-1);
    expect(iSave, '必须有那唯一一次落盘').toBeGreaterThan(-1);
    expect(iMark, '必须落标记').toBeGreaterThan(-1);
    // 顺序：兜底 → 种子 → 落盘 → 标记
    expect(iSeed, '种子排在 ownership 兜底之后').toBeGreaterThan(iOwnership);
    expect(iSeed, '种子排在落盘之前').toBeLessThan(iSave);
    expect(iMark, '标记晚于落盘').toBeGreaterThan(iSave);
    // 读数如实回传（探针 / 页面不各自再判一次）
    expect(src.includes('movementSeed'), '会话必须回传 movementSeed 读数').toBe(true);
  });

  it('CS-16 本种子**与** Movement ownership 兜底是两条互不串味的规则', () => {
    // 装着一件「需要库存、未拥有」的轮组：ownership 兜底会补它；种子也会补它
    // ⇒ 两者都指向「至少 1 件」，但**报在各自的字段里**，不互相冒充。
    const base = defaultPlayerDraft();
    const draft: BuildDraft = {
      ...base,
      functionalSelections: { ...base.functionalSelections },
      rearWheelDefId: 'heavyWheel',
      frontWheelDefId: undefined,
    };
    const { draft: seeded } = seedExistingAccount({ draft });

    const g = openGrowthSession(seeded);

    expect(g.movementGrants, 'ownership 兜底报出「装着的」那一件').toEqual(['heavyWheel']);
    expect(g.movementSeed.entries.map((e) => e.defId), '种子的读数覆盖三档').toEqual([...OFFICIAL_MOVEMENTS]);
    // 计数不叠加成 2（两条规则都只保证「≥1」⇒ 同一件不会被补两遍）
    expect(getCount(loadInventoryRaw()!, 'heavyWheel', MOVEMENT_STAR), '不重复补').toBe(1);
  });

  it('CS-17 纯函数 `applyR3MovementChoiceSeed` 对一份空库存的**直接**读数（不依赖成长会话）', () => {
    const inv: PartInventory = {};
    for (const m of [...OFFICIAL_PARTS, ...OFFICIAL_MOVEMENTS]) {
      inv[m] = { one: 0, two: 0, three: 0, four: 0, five: 0 };
    }
    const out = applyR3MovementChoiceSeed(inv);
    expect(out.applied).toBe(true);
    expect(out.raised).toBe(OFFICIAL_MOVEMENTS.length);
    for (const m of OFFICIAL_MOVEMENTS) {
      expect(getCount(inv, m, MOVEMENT_STAR)).toBe(R3_MOVEMENT_SEED_MIN_COUNT);
    }
    // 它**不落盘**（纯内存）⇒ 磁盘上仍然什么都没有
    expect(store.length).toBe(0);
    expect(isR3MovementSeedDone(), '标记由调用方落，不在本函数里').toBe(false);
  });
});
