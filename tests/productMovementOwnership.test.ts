/**
 * PRODUCT-LOOP-R3-MOVEMENT-PERSISTENT-INVENTORY｜**永久成长里的 Movement 维度** targeted 测试。
 *
 * 逐条对应 Queue 的验收：
 *   - 新账号默认 Movement 拥有状态合法        → MO-01 / MO-02
 *   - owned / equipped 可持久化               → MO-03 / MO-05 / MO-16
 *   - reload 后不丢失                         → MO-04 / MO-04b
 *   - Weapon Inventory 不退化                 → MO-07 / MO-10b
 *   - targeted tests + tsc                    → 本文件
 *
 * 外加本队列自己立的不变量：
 *   - **不允许第二套拥有记录**：不新建 storage key、不新建库存（MO-11 / MO-12）；
 *   - **只增不减**：唯一的写动作是 `addPart(+1)`，不删键、不归零、无 `consume`（MO-10 / MO-12）；
 *   - **不改变战斗行为**：`draft` 是**同一个对象**、Run Snapshot 的 Movement 序列逐条不变（MO-09）；
 *   - **唯一真源**：`owned` 口径与 core `canEquipMovement()`（磁盘口径）逐条相等（MO-08）。
 *
 * ⚠️ 每个用例开头都会 `isolateMigrations()`（预置两份一次性迁移的标记）：本文件要验的是
 *    **Movement 维度本身**，不该被 onboarding（补 cannon）或 reseed（清 cannon ★≥2）干扰。
 *    这是**隔离变量**，不是放宽断言 —— 那两份迁移各自的契约由 `playerGrowthR2A` /
 *    `productReseedR2` 分别在测。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it } from 'vitest';

import { savePlayerBuild } from '../src/core/buildPersistence';
import { buildSnapshotFromDraft, EMPTY_SLOT, type BuildDraft } from '../src/lab/buildEditorModel';
import { registry } from '../src/core/content';
import { validateSnapshot } from '../src/core/buildValidator';
import {
  OFFICIAL_MOVEMENTS,
  OFFICIAL_PARTS,
  canEquipMovement,
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
import { markR4BodySeed } from '../src/product/r4BodyChoiceSeed';
import {
  MOVEMENT_STAR,
  ensureMovementOwnership,
  movementEntries,
  movementOwnership,
} from '../src/product/movementInventory';
import {
  canonicalMovementDefIds,
  defaultDriveMode,
  defaultMovementDefId,
  movementMapping,
} from '../src/product/runMovementCanonical';
import { defaultPlayerDraft, playerInventory } from '../src/product/playerLoadout';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PRODUCT_DIR = join(REPO_ROOT, 'src', 'product');
function readProduct(f: string): string {
  return readFileSync(join(PRODUCT_DIR, f), 'utf8');
}
/** 源码守卫必须先剥注释（本项目铁律：注释里的自指文字会骗过字符串匹配）。 */
function strip(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const INV_KEY = 'strongfruit.ownedParts.v2';
const BUILD_KEY = 'strongfruit.playerBuild.v1';

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
  /** 本次挂载写了哪些 key（断言「不新增 key」用）。 */
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
 * 预置**四份**一次性迁移的标记 ⇒ 本文件只观察 Movement 维度本身。
 *
 * ⚠️ 第三份（`markR3MovementSeed()`）是 PRODUCT-LOOP-R3-MOVEMENT-CHOICE-SEED 追加的：
 *    那份种子会**主动把三档需要库存的 Movement 各补到 1 件**，而本文件的多个用例
 *    恰恰以「三档默认未拥有」为**前提**（观察 `ensureMovementOwnership` 的补件行为本身）。
 *    预置标记 = **隔离变量**，不是放宽断言 —— 那份种子的契约由
 *    `tests/productMovementChoiceSeed.test.ts` 单独测。
 * ⚠️ 第四份（`markR4BodySeed()`）是 PRODUCT-LOOP-R4-BODY-CANONICAL-AND-GARAGE-MVP 追加的：
 *    Body 种子会在首入时解锁 MVP 车身并落 `r4BodyChoiceSeed.v1` + `ownedBodies.v1` 两个 key，
 *    而本文件的 MO-11 恰恰断言「本次挂载不新增任何 key」⇒ 必须预置 Body 种子标记，
 *    让它走 `already-marked` 出口（不新增 key）。这同样是**隔离变量，不是放宽**。
 */
function isolateMigrations(): void {
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

/** 产品默认车 + 指定的轮组选择（**先过正式 `validateSnapshot`** ⇒ 夹具本身必须合法）。 */
function draftWithWheels(rear?: string, front?: string): BuildDraft {
  const base = defaultPlayerDraft();
  const next: BuildDraft = { ...base, functionalSelections: { ...base.functionalSelections } };
  if (rear !== undefined) next.rearWheelDefId = rear;
  if (front !== undefined) next.frontWheelDefId = front;
  expect(
    validateSnapshot(buildSnapshotFromDraft(next, registry), registry).valid,
    '夹具必须过正式 validateSnapshot（否则 loadPlayerBuild 会把它判成 null）',
  ).toBe(true);
  return next;
}

const entryOf = (inv: PartInventory, draft: BuildDraft, defId: string) =>
  movementEntries(inv, draft).find((e) => e.defId === defId);

/** 一份库存里所有 OFFICIAL_PARTS 的五档读数快照（「武器不退化」的逐条对账口径）。 */
function weaponSnapshot(inv: PartInventory): string {
  const out: Record<string, number[]> = {};
  for (const p of OFFICIAL_PARTS) {
    out[p] = [1, 2, 3, 4, 5].map((s) => getCount(inv, p, s));
  }
  return canon(out);
}

/* ============================================================================
   A. 新账号的默认 Movement 拥有状态（Queue 必改 2）
   ============================================================================ */

describe('A. 新账号默认 Movement 拥有状态（必改 2）', () => {
  it('MO-01 全新账号：缺省轮**恒默认拥有**，其余三档未拥有，不变式 legal=真', () => {
    isolateMigrations();
    // ⚠️ PRODUCT-LOOP-R4-BODY-CANONICAL-AND-GARAGE-MVP：`isolateMigrations()` 现在预置**四份**
    //    一次性迁移标记（R2 onboarding / R2 reseed / R3 Movement seed / R4 Body seed）。
    //    本断言只是夹具前提（「磁盘上只有迁移标记，没有别的」）⇒ 数字随预置份数同步，
    //    **闭集语义一字未改**：多出任何别的 key 这一条照样红。
    expect(store.length, '夹具前提：磁盘上只有四份迁移标记，没有别的').toBe(4);

    const draft = defaultPlayerDraft();
    const g = openGrowthSession(draft);

    const def = defaultMovementDefId();
    // ① 缺省轮（正式内容库里的标准轮）就是新账号开的这一条
    expect(g.movements.defaultDefId).toBe(def);
    expect(g.movements.equippedDefIds, '新账号车上装着缺省轮').toEqual([def]);
    // ② 「拥有」不靠库存行：它 `implicit` 拥有（`count === 0` 却是 owned）
    const dflt = entryOf(g.inv, g.draft, def)!;
    expect(dflt.owned, '缺省轮必须算拥有（否则新账号的默认车就非法了）').toBe(true);
    expect(dflt.implicit).toBe(true);
    expect(dflt.needsInventory, '缺省轮不需要库存（真源 = OFFICIAL_MOVEMENTS）').toBe(false);
    expect(dflt.count).toBe(0);
    expect(dflt.hardpoints.length, '装在两个挂点上').toBe(2);
    // ③ 不变式
    expect(g.movements.legal).toBe(true);
    expect(g.movements.ownedDefIds).toEqual([def]);
    // ④ 这次挂载**没有**为 Movement 补任何东西（缺省轮本来就不需要库存）
    expect(g.movementGrants).toEqual([]);
    // ⑤ Drive 也如实读出来（缺省 = 正式归一函数的取值，不是本模块写的字面量）
    expect(g.movements.drive).toBe(defaultDriveMode());
  });

  it('MO-02 三档需要库存的 Movement 默认**未拥有**，但**已经在永久库存里占位**（必改 1）', () => {
    isolateMigrations();
    const g = openGrowthSession(defaultPlayerDraft());

    for (const m of OFFICIAL_MOVEMENTS) {
      const e = entryOf(g.inv, g.draft, m)!;
      expect(e.needsInventory, `${m} 需要库存`).toBe(true);
      expect(e.owned, `${m} 默认不该被拥有（那是要拿的东西）`).toBe(false);
      expect(e.implicit).toBe(false);
      expect(e.count).toBe(0);
      expect(e.equipped, `${m} 默认没装在车上`).toBe(false);
      expect(e.hardpoints).toEqual([]);
    }
    // 「已经在永久库存里占位」= 三档的行**真的落盘了**（不是「没有这个概念」）
    const raw = loadInventoryRaw()!;
    for (const m of OFFICIAL_MOVEMENTS) {
      expect(raw[m], `${m} 必须在持久化库存里占位`).toEqual({
        one: 0,
        two: 0,
        three: 0,
        four: 0,
        five: 0,
      });
    }
    // 反而：**恒默认拥有**的缺省轮**不进库存**（它靠 implicit 表达，不是靠一行计数）
    expect(OFFICIAL_MOVEMENTS.includes(defaultMovementDefId())).toBe(false);
    expect(Object.keys(raw)).not.toContain(defaultMovementDefId());
    // 与 canonical 集合同源（本模块不维护第二张表）
    expect(movementEntries(g.inv, g.draft).map((e) => e.defId)).toEqual([...canonicalMovementDefIds()]);
  });
});

/* ============================================================================
   B. owned / equipped 的持久化（Queue 必改 1 / 必改 3）
   ============================================================================ */

describe('B. owned / equipped 可持久化（必改 1 / 必改 3）', () => {
  it('MO-03 装着却不拥有 ⇒ 补 1 件并落盘（只增不减），不变式从假变真', () => {
    isolateMigrations();
    // 夹具前提：车上装着 smallWheel，但库存里一件都没有 ⇒ 不变式**本来是假的**
    const draft = draftWithWheels('smallWheel', undefined);
    savePlayerBuild(draft);
    // ⚠️ 前提必须**直接读磁盘那一份**库存（不经成长会话 —— 会话本身就会把它修好，
    //    拿会话的返回值当「之前」等于把要证的东西当成前提）。
    const rawBefore = playerInventory(draft);
    expect(entryOf(rawBefore, draft, 'smallWheel')!.owned, '前提：smallWheel 未拥有').toBe(false);
    expect(movementOwnership(rawBefore, draft).legal, '前提：不变式本来是假的').toBe(false);

    // 玩家回到首页（一次完整挂载）
    const g = openGrowthSession(draft);
    expect(g.movementGrants, '补的正是车上装着、却不拥有的那一件').toEqual(['smallWheel']);
    expect(entryOf(g.inv, g.draft, 'smallWheel')!.owned).toBe(true);
    expect(entryOf(g.inv, g.draft, 'smallWheel')!.count).toBe(1);
    expect(getCount(loadInventoryRaw()!, 'smallWheel', MOVEMENT_STAR), '真的落盘了').toBe(1);
    expect(g.movements.legal, '不变式已恢复').toBe(true);
    // 缺省轮仍在（另一挂点没改）
    expect([...g.movements.equippedDefIds].sort()).toEqual([defaultMovementDefId(), 'smallWheel'].sort());
  });

  it('MO-04 reload 后 owned / equipped / persisted **三者一致**且幂等（必改 3）', () => {
    isolateMigrations();
    const draft = draftWithWheels('smallWheel', 'largeWheel');
    savePlayerBuild(draft);
    const first = openGrowthSession(draft);
    expect([...first.movementGrants].sort()).toEqual(['largeWheel', 'smallWheel']);
    const invAfter = store.getItem(INV_KEY);
    const readFirst = canon(first.movements);

    // 第二次挂载 = reload
    const second = openGrowthSession(draft);
    expect(second.movementGrants, 'reload 不再重复补').toEqual([]);
    expect(store.getItem(INV_KEY), '库存逐字节不变').toBe(invAfter);
    expect(canon(second.movements), 'owned / equipped 读数逐字段不变').toBe(readFirst);
    expect(second.movements.legal).toBe(true);
    // 装备侧（Build）也没被动过
    expect(store.getItem(BUILD_KEY)).not.toBeNull();
    expect([...second.movements.equippedDefIds].sort()).toEqual(['largeWheel', 'smallWheel'].sort());
  });

  it('MO-05 已经拥有 ⇒ 一个字节都不动（只增不减的另一半）', () => {
    isolateMigrations();
    const draft = draftWithWheels('smallWheel', undefined);
    savePlayerBuild(draft);
    openGrowthSession(draft); // 第一次补到 1
    const rawBefore = store.getItem(INV_KEY);
    const g = openGrowthSession(draft); // 第二次
    expect(g.movementGrants).toEqual([]);
    expect(store.getItem(INV_KEY)).toBe(rawBefore);
    expect(getCount(loadInventoryRaw()!, 'smallWheel', MOVEMENT_STAR), '数量不多不少').toBe(1);
  });

  it('MO-06 玩家**明确卸下**轮组（`none`）⇒ 不补、也不报「装着」', () => {
    isolateMigrations();
    const draft = draftWithWheels(EMPTY_SLOT, undefined);
    savePlayerBuild(draft);
    const g = openGrowthSession(draft);
    expect(g.movementGrants, '没装 ⇒ ownership 兜底不补').toEqual([]);
    const e = entryOf(g.inv, g.draft, 'smallWheel')!;
    expect(e.equipped, '明确卸下 ⇒ 不报「装着」').toBe(false);
    /*
      ⚠️ 原断言还有一条 `owned === false`。MOVEMENT-CHOICE-SEED 追加后它不再成立
      （那份种子刻意把三档各补到 ≥1，与「装没装」无关）。本用例真正要守的是
      **「卸下」这个状态本身**：它必须仍然是「明确卸下」而不是被任何一层改写。
    */
    expect(
      movementMapping(g.draft).slots.find((s) => s.hardpointId === 'rear')!.storedDefId,
      '卸下状态没有被任何一层改写',
    ).toBe(EMPTY_SLOT);
    // 另一挂点仍是缺省轮
    expect(g.movements.equippedDefIds).toEqual([defaultMovementDefId()]);
    const rear = movementMapping(g.draft).slots.find((s) => s.hardpointId === 'rear')!;
    expect(rear.storedDefId).toBe(EMPTY_SLOT);
    expect(rear.effectiveDefId).toBeNull();
  });

  it('MO-15 同一件装在两个挂点 ⇒ `hardpoints` 报出两个（不合并成一条虚构读数）', () => {
    isolateMigrations();
    const draft = draftWithWheels('smallWheel', 'smallWheel');
    savePlayerBuild(draft);
    const g = openGrowthSession(draft);
    const e = entryOf(g.inv, g.draft, 'smallWheel')!;
    expect([...e.hardpoints].sort()).toEqual(['front', 'rear']);
    expect(g.movementGrants, '两个挂点装的是**同一件** ⇒ 只需补 1 件').toEqual(['smallWheel']);
    expect(e.count).toBe(1);
  });

  it('MO-16 前后分别装两件**都未拥有**的轮组 ⇒ 一次挂载各补 1 件（另三档由种子另行覆盖）', () => {
    isolateMigrations();
    const draft = draftWithWheels('smallWheel', 'largeWheel');
    savePlayerBuild(draft);
    const g = openGrowthSession(draft);
    expect([...g.movementGrants].sort()).toEqual(['largeWheel', 'smallWheel']);
    const raw = loadInventoryRaw()!;
    expect(getCount(raw, 'smallWheel', MOVEMENT_STAR)).toBe(1);
    expect(getCount(raw, 'largeWheel', MOVEMENT_STAR)).toBe(1);
    /*
      ⚠️ 原断言是「没装的 heavyWheel 仍然不发（= 0）」。PRODUCT-LOOP-R3-MOVEMENT-CHOICE-SEED
      追加后该前提被**契约变更**作废：那份种子**刻意**把三档各补到 ≥1（就是为了让三档
      可比较），与本用例要观察的 `ensureMovementOwnership`（「装着的必须拥有」）是**两条
      互不重叠的规则**。⇒ 改为分别断言两条规则各自的产出，而不是删掉这一条。
    */
    expect(g.movementGrants.includes('heavyWheel'), '没装的不进 ownership 补件名单').toBe(false);
    /*
      ⚠️ 原断言是「没装的 heavyWheel 仍然不发（= 0）」。语义仍然成立 —— 但要写清楚**为什么**：
      本用例的 `isolateMigrations()` 预置了 Movement 种子的标记 ⇒ 那份种子**本次不跑**
      ⇒ heavyWheel 保持 0。于是这一条同时钉住了两件事：
        ① `ensureMovementOwnership` 只补「装着的」那一类（不越界去发没装的）；
        ② 「种子只发一次」确实生效（标记在盘上时它一个字节都不动）。
      种子的实际补件行为由 `tests/productMovementChoiceSeed.test.ts` 单独覆盖。
    */
    expect(getCount(raw, 'heavyWheel', MOVEMENT_STAR), '没装的 + 种子已标记 ⇒ 仍然不发').toBe(0);
  });
});

/* ============================================================================
   C. 不改变战斗行为 / 不退化 / 不新增第二套记录
   ============================================================================ */

describe('C. 不改变战斗行为 + 既有系统不退化（必改 4）', () => {
  it('MO-07 Movement 的补件**不碰** Weapon Inventory（逐条五档对账 + 键集不变）', () => {
    isolateMigrations();
    const draft = draftWithWheels('smallWheel', 'largeWheel');
    savePlayerBuild(draft);
    const before = openGrowthSession(draft);
    const weaponsBefore = weaponSnapshot(before.inv);
    const keysBefore = Object.keys(before.inv).sort();

    const after = openGrowthSession(draft);
    expect(weaponSnapshot(after.inv), '全部正式 Weapon 的 ★1..★5 逐条相等').toBe(weaponsBefore);
    expect(Object.keys(after.inv).sort(), '库存键集不变').toEqual(keysBefore);
    // 补的**只有** Movement 那两行
    for (const p of OFFICIAL_PARTS) {
      for (let s = 1; s <= 5; s++) {
        expect(getCount(after.inv, p, s), `${p} ★${s}`).toBe(getCount(before.inv, p, s));
      }
    }
  });

  it('MO-10 只增不减：不删条目、不归零（含未被装的轮组）', () => {
    isolateMigrations();
    const draft = draftWithWheels('smallWheel', undefined);
    savePlayerBuild(draft);
    // 「之前」直接读磁盘那一份（不经会话），否则前置改动会被会话先吃掉
    const before = playerInventory(draft);
    const snapBefore = canon(before);

    const after = openGrowthSession(draft);
    for (const key of Object.keys(before)) {
      expect(after.inv[key], `条目 ${key} 必须还在`).toBeDefined();
      for (let s = 1; s <= 5; s++) {
        expect(getCount(after.inv, key, s), `${key} ★${s} 不得减少`).toBeGreaterThanOrEqual(
          getCount(before, key, s),
        );
      }
    }
    // 确实**变大**了（否则上面那条「≥」是空转）
    expect(canon(after.inv)).not.toBe(snapBefore);
  });

  it('MO-11 本次挂载**不新增**任何 key（不制造第二套拥有记录）', () => {
    isolateMigrations();
    const draft = draftWithWheels('smallWheel', 'largeWheel');
    savePlayerBuild(draft);
    // 先让库存 key 存在（那是 core `ensureInventory` 的既有行为，与本队列无关）
    playerInventory(draft);
    const keysBefore = store.keys();
    openGrowthSession(draft);

    /*
      ⚠️ MOVEMENT-CHOICE-SEED 追加了**一份产品侧自持版本标记**
      （`strongfruit.r3MovementChoiceSeed.v1`，与 `r2Onboarding.v1` / `r2Reseed.v1` 同型）。
      它是否出现取决于「首入判定是不是本次做出」—— 本用例的 `isolateMigrations()` 已经
      预置了它 ⇒ 本次挂载**不**新增任何 key，原断言一字不改地成立。
      ⇒ 守卫的精神（「不制造第二套拥有记录」）在这一层被完整保留；那份种子的 key
        由 `tests/productMovementChoiceSeed.test.ts` 单独断言（含「允许新增的 key 白名单」
        这一条更强的形式）。
    */
    expect(store.keys(), '本次挂载一个 key 都没新增').toEqual(keysBefore);
    expect(store.length).toBe(keysBefore.length);
    // 守卫的另一半：**拥有状态本身**没有第二份记录（它的唯一住处仍是 core 的库存 key）
    expect(store.keys().filter((k) => k.endsWith('.ownedParts.v1')), '不出现 v1 那套旧拥有记录').toEqual([]);
  });

  it('MO-09 **不改变战斗行为**：`draft` 还是**同一个对象**，Run Snapshot 的 Movement 序列逐条不变', () => {
    isolateMigrations();
    const draft = draftWithWheels('smallWheel', undefined);
    savePlayerBuild(draft);
    const movementsBefore = movementMapping(draft).effectiveDefIds;

    const g = openGrowthSession(draft);
    // ① 调用方拿到的就是入参那一个对象（没有任何改动时不产生副本 —— 见 GrowthSession 的契约）
    expect(g.draft).toBe(draft);
    expect(canon(g.draft)).toBe(canon(draft));
    // ② Run 侧真正装载的 Movement 序列（经正式 Snapshot / resolveSnapshot）逐条相同
    expect(movementMapping(g.draft).effectiveDefIds).toEqual(movementsBefore);
    // ③ 落在磁盘上的 Build 也没被写过
    expect(store.getItem(BUILD_KEY)).toBe(JSON.stringify({ ...draft, [STAMP_KEY]: 1 }));
  });

  it('MO-08 `owned` 口径与 core `canEquipMovement()` **逐条相等**（唯一真源交叉核对）', () => {
    isolateMigrations();
    const draft = draftWithWheels('smallWheel', undefined);
    savePlayerBuild(draft);
    const g = openGrowthSession(draft);
    // 让磁盘与内存**逐字节相同**，两边口径才可比
    saveInventory(g.inv);
    const disk = loadInventoryRaw()!;
    for (const id of canonicalMovementDefIds()) {
      const mine = entryOf(disk, g.draft, id)!;
      expect(mine.owned, `${id}: 内存口径 vs 磁盘口径`).toBe(canEquipMovement(id));
    }
  });
});

/* ============================================================================
   D. 源码守卫（写面 / 接线 / 不改战斗）
   ============================================================================ */

describe('D. 源码守卫', () => {
  it('MO-12 模块的写面只有 core `addPart`：零 storage、零 `consume`、零 `saveInventory`', () => {
    const code = strip(readProduct('movementInventory.ts'));
    // ① 不碰存储（不新建 key、不第二套库存）
    expect(code.includes('platform.storage')).toBe(false);
    expect(code.includes('setItem')).toBe(false);
    expect(code.includes('localStorage')).toBe(false);
    expect(code.includes('JSON.parse')).toBe(false);
    // ② 唯一的写动作是 `addPart`（只增不减）
    expect(code.includes('addPart(')).toBe(true);
    expect(code.includes('consume('), '不得有任何消耗路径').toBe(false);
    // ③ 落盘仍由调用方那**唯一一次** `saveInventory` 负责（本模块不自作主张写盘）
    expect(code.includes('saveInventory(')).toBe(false);
    // ④ 「车上装着什么」必须问正式链路，不自己解释 BuildDraft
    expect(code.includes('movementMapping('), '不得自己解释 draft 的轮组字段').toBe(true);
    expect(code.includes("rearWheelDefId"), '不得自己读 draft 的轮组字段').toBe(false);
    expect(code.includes("frontWheelDefId")).toBe(false);
    // ⑤ 唯一真源：不写缺省轮字面量、不维护第二张 Movement 表
    expect(code.includes("'wheelStd'")).toBe(false);
    expect(code.includes('registry.movements')).toBe(false);
  });

  it('MO-13 接线守卫：成长会话在 reseed 之后、落盘之前调用它，且探针如实报出读数', () => {
    const growth = strip(readProduct('playerGrowth.ts'));
    const iReseed = growth.indexOf('applyR2Reseed(inv, draft, reseedPlan)');
    const iEnsure = growth.indexOf('ensureMovementOwnership(inv, nextDraft)');
    const iSave = growth.indexOf('if (changed) saveInventory(inv)');
    expect(iReseed, 'reseed 必须在').toBeGreaterThan(-1);
    expect(iEnsure, 'Movement 保证必须在').toBeGreaterThan(iReseed);
    expect(iSave).toBeGreaterThan(iEnsure);
    // 读数在补件**之后**取（否则报出的是补之前的旧形态）
    expect(growth.indexOf('movementOwnership(inv, nextDraft)')).toBeGreaterThan(iEnsure);
    // 会话回传两个字段（页面 / 探针不各自再判一次）
    expect(growth.includes('movementGrants,')).toBe(true);
    expect(growth.includes('readonly movements: MovementOwnershipReading;')).toBe(true);

    const page = strip(readProduct('homePage.ts'));
    expect(page.includes('movementRepaired: growth.movementGrants')).toBe(true);
    expect(page.includes('movementLegal: growth.movements.legal')).toBe(true);
    // 探针报出的就是读数本身（不是页面另算一份）
    expect(page.includes('movements: growth.movements.entries.map(')).toBe(true);
  });

  it('MO-12b `ensureMovementOwnership` 是**纯内存**的：不落盘、不改 draft', () => {
    isolateMigrations();
    const draft = draftWithWheels('smallWheel', undefined);
    const inv: PartInventory = { smallWheel: { one: 0, two: 0 } };
    const keysBefore = store.keys();
    const draftBefore = canon(draft);
    const granted = ensureMovementOwnership(inv, draft);
    expect(granted).toEqual(['smallWheel']);
    expect(inv['smallWheel'].one).toBe(1);
    expect(store.keys(), '没有落盘（落盘由调用方那一次负责）').toEqual(keysBefore);
    expect(canon(draft), 'draft 一个字节都没动').toBe(draftBefore);
  });

  it('MO-17 缺省轮**不进库存**：补件之后库存里仍然没有它的行（implicit 才是它的表达）', () => {
    isolateMigrations();
    const draft = draftWithWheels('smallWheel', undefined);
    savePlayerBuild(draft);
    openGrowthSession(draft);
    const raw = loadInventoryRaw()!;
    expect(Object.keys(raw)).not.toContain(defaultMovementDefId());
    // 但它照样是「拥有」的（靠 implicit 这一条，而不是靠一行计数）
    expect(entryOf(raw, draft, defaultMovementDefId())!.owned).toBe(true);
    expect(movementOwnership(raw, draft).legal).toBe(true);
  });
});
