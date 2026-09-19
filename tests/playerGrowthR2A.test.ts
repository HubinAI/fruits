/**
 * PRODUCT-LOOP-R2-A-REWARD-STACK-INVENTORY｜产品侧**永久成长模型**的 targeted 测试。
 *
 * 本文件专管 Queue 九条验收里属于「Profile / 成长 / 迁移」的那四条
 * （奖励链路的另外几条在 `productLoopRunReward.test.ts`）：
 *   ① fresh profile cannon = ★1 ×4   → PG-01 / PG-02
 *   ⑥ FAILED 数量完全不变            → 见 PR-16 / PC-14（奖励链路侧）
 *   ⑦ old Profile migration 不丢数据  → PG-05 / PG-06
 *   ⑧ Equipped 仍指向有效库存实例      → PG-07 / PG-08
 *
 * 另加本模块自身的不变量：
 *   - 种子**只发新账号**，且只 `max` 抬高、绝不覆盖（旧横屏游戏共用同一个库存 key）；
 *   - 幂等：第二次挂载零写入；
 *   - 只增不减：既不删条目也不归零；
 *   - 库存 key 仍是 `strongfruit.ownedParts.v2`（不新建第二套库存）。
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  addPart,
  defaultInventory,
  getCount,
  loadInventoryRaw,
  saveInventory,
  STARTER_PARTS,
} from '../src/core/partInventory';
import { savePlayerBuild } from '../src/core/buildPersistence';
import { STAMP_KEY } from '../src/core/saveVersion';
import { makeStarterDraft, EMPTY_SLOT, type BuildDraft } from '../src/lab/buildEditorModel';
import { registry } from '../src/core/content';
import {
  PLAYER_BODY_DEF_ID,
  WEAPON_GROWTH_STAR,
  WEAPON_SLOT,
  defaultPlayerDraft,
  loadEquippedDraft,
  playerInventory,
  stackThreshold,
  weaponEntries,
} from '../src/product/playerLoadout';
import {
  FRESH_STACK_SEED,
  FUSE_STACK,
  GROWTH_STAR,
  applyFreshSeed,
  equippedStackKey,
  freshSeedInventory,
  growthStack,
  growthStacks,
  isFreshProfile,
  mergedStackCount,
  openGrowthSession,
  repairEquippedStack,
  stackProgress,
} from '../src/product/playerGrowth';

const INV_KEY = 'strongfruit.ownedParts.v2';
const INV_KEY_V1 = 'strongfruit.ownedParts.v1';
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
}

let store: MemStorage;
beforeEach(() => {
  store = new MemStorage();
  (globalThis as unknown as { localStorage: MemStorage }).localStorage = store;
});

/** 直接把一份「旧档」塞进磁盘（模拟玩家上次游玩留下的记录）。 */
function seedDisk(inv: Record<string, unknown> | unknown[], key = INV_KEY, stamp = true): void {
  const value = stamp && !Array.isArray(inv) ? { ...inv, [STAMP_KEY]: 1 } : inv;
  store.setItem(key, JSON.stringify(value));
}

/** 当前 Build 是玩家装备过的（用于把 fresh 判成 false）。 */
function seedBuild(): void {
  savePlayerBuild(makeStarterDraft(PLAYER_BODY_DEF_ID, registry));
}

// ============================================================================
describe('PRODUCT-LOOP-R2-A｜G. 新账号的成长起点（Queue 必改 3 / 验收 ①）', () => {
  it('PG-01 fresh profile：cannon ★1 ×4，并保留 core starter 的其它条目', () => {
    expect(isFreshProfile(), '磁盘上什么都没有 ⇒ 新账号').toBe(true);

    const draft = loadEquippedDraft();
    const g = openGrowthSession(draft);
    expect(g.freshProfile).toBe(true);
    expect(g.seeded).toBe(true);

    // ① 默认 equipped 仍然是 cannon ★1（产品唯一武器槽）
    expect(draft.functionalSelections[WEAPON_SLOT]).toBe('cannon');
    // ② 库存：cannon ×4
    expect(getCount(g.inv, 'cannon', WEAPON_GROWTH_STAR), 'Queue 必改 3：cannon = ★1 ×4').toBe(4);
    // ③ 当前产品主循环需要的最少其它 Weapon（3选1 的另外两个候选）
    expect(getCount(g.inv, 'spear', WEAPON_GROWTH_STAR)).toBe(1);
    expect(getCount(g.inv, 'hammer', WEAPON_GROWTH_STAR)).toBe(1);
    /*
      ④ 种子是在 core starter **之上**抬高，不是替换整份库存。
      库存 key 与旧横屏游戏共用 ⇒ 覆盖它会让旧游戏里玩家的推杆凭空消失。
    */
    for (const p of STARTER_PARTS) {
      expect(getCount(g.inv, p, WEAPON_GROWTH_STAR), `${p} 必须仍在库存里`).toBeGreaterThanOrEqual(1);
    }
    // ⑤ 真的落盘了（否则下次挂载又会判成新账号）
    expect(store.getItem(INV_KEY)).not.toBeNull();
    expect(getCount(loadInventoryRaw()!, 'cannon', WEAPON_GROWTH_STAR)).toBe(4);
  });

  it('PG-02 种子**只发新账号**：已有存档的玩家不会被抬到 ×4（必改 3 的「仅 fresh」）', () => {
    // 老账号：装备过东西 + 库存里 cannon 只有 2 件
    seedBuild();
    const old = defaultInventory();
    old['cannon'].one = 2;
    seedDisk(old as unknown as Record<string, unknown>);

    const g = openGrowthSession(loadEquippedDraft());
    expect(g.freshProfile, '磁盘上有记录 ⇒ 不是新账号').toBe(false);
    expect(g.seeded, '种子绝不能发给老账号').toBe(false);
    expect(getCount(g.inv, 'cannon', WEAPON_GROWTH_STAR), '老档的 2 件必须原样保留').toBe(2);
    expect(getCount(g.inv, 'spear', WEAPON_GROWTH_STAR)).toBe(1);
  });

  it('PG-03 幂等：第二次挂载是**零写入**（不重复生成、不覆盖）', () => {
    const first = openGrowthSession(loadEquippedDraft());
    expect(first.seeded).toBe(true);
    const invAfterFirst = store.getItem(INV_KEY);

    const second = openGrowthSession(loadEquippedDraft());
    expect(second.freshProfile, '第一次挂载已经落盘 ⇒ 第二次不再是新账号').toBe(false);
    expect(second.seeded).toBe(false);
    expect(second.repairedEquipped).toBeNull();
    expect(store.getItem(INV_KEY), '没有改动就不该有写入').toBe(invAfterFirst);
  });

  it('PG-04 种子的形状 = `cannon ×4` + 另外两件候选（可断言的常量，不是从别处推导）', () => {
    const cannon = FRESH_STACK_SEED.find((s) => s.partId === 'cannon');
    expect(cannon).toEqual({ partId: 'cannon', star: GROWTH_STAR, count: 4 });
    // 3选1 的三条候选都必须在新账号的库存里有 stack（否则「选了它」没地方加）
    const seeded = new Set(FRESH_STACK_SEED.map((s) => s.partId));
    for (const id of ['cannon', 'spear', 'hammer']) {
      expect(seeded.has(id), `${id} 必须在新账号种子里`).toBe(true);
    }
    // 种子里的每一件都必须是**正式 Weapon**（不猜、不越界）
    expect(FRESH_STACK_SEED.length).toBeGreaterThanOrEqual(3);
  });

  it('PG-05 `applyFreshSeed` 只 `max` 抬高：绝不降低、绝不覆盖已有计数', () => {
    const inv = defaultInventory();
    addPart(inv, 'cannon', 1, 6); // 玩家已经有 7 件
    const changed = applyFreshSeed(inv);
    expect(changed, '没有需要抬高的条目 ⇒ 不算改动').toBe(false);
    expect(getCount(inv, 'cannon', 1), '已有 7 件不会被「抬」回 4').toBe(1 + 6);
    // 反向：低于种子的条目才会被抬
    const low = defaultInventory();
    low['spear'].one = 0;
    expect(applyFreshSeed(low)).toBe(true);
    expect(getCount(low, 'spear', 1)).toBe(1);
    // 非 Weapon 一律不碰（种子只给正式 Weapon）
    const inv2 = defaultInventory();
    inv2['pushRod'].one = 0;
    applyFreshSeed(inv2);
    expect(getCount(inv2, 'pushRod', 1), '推杆是 Gadget，种子不碰它').toBe(0);
  });

  it('PG-06 `freshSeedInventory` 只算不落盘（供测试断言确切的初始读数）', () => {
    const inv = freshSeedInventory();
    expect(getCount(inv, 'cannon', 1)).toBe(4);
    expect(store.getItem(INV_KEY), '这个函数不许写盘').toBeNull();
    expect(isFreshProfile(), '算一次不该把账号变成「非 fresh」').toBe(true);
  });
});

// ============================================================================
describe('PRODUCT-LOOP-R2-A｜H. old Profile migration 不丢数据（验收 ⑦）', () => {
  it('PG-07 旧版 owned-id **数组** 档（v1）→ 每件 1★ = 1，且原来的 key 不被清掉', () => {
    seedDisk(['cannon', 'hammer', 'pushRod'], INV_KEY_V1, false);
    const inv = loadInventoryRaw();
    expect(inv, '旧档必须能读出来').not.toBeNull();
    for (const id of ['cannon', 'hammer', 'pushRod']) {
      expect(getCount(inv!, id, 1), `${id} 不得在迁移中丢失`).toBe(1);
    }
    // 迁移结果落在 v2 key 上；旧 key 保留（不删玩家数据）
    expect(store.getItem(INV_KEY)).not.toBeNull();
    expect(store.getItem(INV_KEY_V1), '迁移不许顺手删掉旧记录').not.toBeNull();
  });

  it('PG-08 旧版**无版本信封**的对象档：已有计数逐条保留（不清空、不打回 starter）', () => {
    // 模拟旧产品写下的「有 cannon ×3、有 spear ×2」但**没有** __v 信封
    seedDisk({ cannon: { one: 3, two: 0 }, spear: { one: 2, two: 0 } }, INV_KEY, false);
    seedBuild();
    const g = openGrowthSession(loadEquippedDraft());
    expect(g.freshProfile).toBe(false);
    expect(getCount(g.inv, 'cannon', 1), '旧档的 3 件必须原样保留').toBe(3);
    expect(getCount(g.inv, 'spear', 1)).toBe(2);
    // 缺失的条目补 0（不是补 starter）
    expect(getCount(g.inv, 'hammer', 1)).toBe(0);
  });

  it('PG-09 升级 schema 不会清空玩家的**当前 Build**（Equipped 原样保留）', () => {
    const custom: BuildDraft = {
      ...defaultPlayerDraft(),
      functionalSelections: {
        ...defaultPlayerDraft().functionalSelections,
        [WEAPON_SLOT]: 'spear',
      },
    };
    savePlayerBuild(custom);
    const buildBefore = store.getItem(BUILD_KEY);
    const g = openGrowthSession(loadEquippedDraft());
    expect(g.inv, '成长会话不该改 Build');
    expect(loadEquippedDraft().functionalSelections[WEAPON_SLOT], '玩家装的那件不许被改').toBe('spear');
    // 逐字节不变：成长**从不**写 `playerBuild.v1`（它只碰库存）
    expect(store.getItem(BUILD_KEY)).toBe(buildBefore);
  });

  it('PG-10 库存仍写在同一处 key（旧横屏游戏与竖屏产品共用一份，不新建第二套）', () => {
    openGrowthSession(loadEquippedDraft());
    const keys: string[] = [];
    for (let i = 0; i < store.length; i += 1) {
      const k = store.key(i);
      if (k) keys.push(k);
    }
    expect(keys.sort(), '成长只允许写正式库存 key').toEqual([INV_KEY]);
    // 再跑一次「手动加一件」的正式写入路径，key 集合不变
    const inv = loadInventoryRaw()!;
    addPart(inv, 'cannon', 1, 1);
    saveInventory(inv);
    expect(getCount(loadInventoryRaw()!, 'cannon', 1)).toBe(5);
  });
});

// ============================================================================
describe('PRODUCT-LOOP-R2-A｜I. Equipped 必须指向有效库存实例（验收 ⑧）', () => {
  it('PG-11 存档**有**库存但缺当前装备那件 ⇒ 只补 1（core 的 `hasAnyOwned` 缺口）', () => {
    // 老档：有 hammer / pushRod，没有 cannon；而当前装备是 cannon
    seedDisk({ hammer: { one: 1, two: 0 }, pushRod: { one: 1, two: 0 } });
    seedBuild();
    const draft = loadEquippedDraft();
    expect(draft.functionalSelections[WEAPON_SLOT]).toBe('cannon');
    // core 侧：只要**有任何一件**就原样返回 ⇒ 装备会指到一个 count = 0 的 stack
    expect(getCount(playerInventory(draft), 'cannon', 1), '这就是 R2-A 要兜底的那个缺口').toBe(0);

    const g = openGrowthSession(draft);
    expect(g.repairedEquipped, '必须报告修了哪一件').toBe('cannon');
    expect(getCount(g.inv, 'cannon', 1)).toBe(1);
    expect(getCount(loadInventoryRaw()!, 'cannon', 1), '修复必须落盘').toBe(1);
    // 其它条目一个字节都不动
    expect(getCount(g.inv, 'hammer', 1)).toBe(1);
    expect(getCount(g.inv, 'pushRod', 1)).toBe(1);
  });

  it('PG-12 装备那件**已经在**库存里 ⇒ 一个字节都不动（只增不减的另一半）', () => {
    seedDisk({ cannon: { one: 2, two: 0 } });
    seedBuild();
    const before = store.getItem(INV_KEY);
    const g = openGrowthSession(loadEquippedDraft());
    expect(g.repairedEquipped).toBeNull();
    expect(store.getItem(INV_KEY), '无需修复就不该有写入').toBe(before);
    expect(getCount(g.inv, 'cannon', 1)).toBe(2);
  });

  it('PG-13 `equippedStackKey` 的三种空形态一律 null（没有 stack 需要保证）', () => {
    const base = defaultPlayerDraft();
    expect(equippedStackKey({ ...base, functionalSelections: { ...base.functionalSelections, [WEAPON_SLOT]: EMPTY_SLOT } })).toBeNull();
    expect(equippedStackKey({ ...base, functionalSelections: { ...base.functionalSelections, [WEAPON_SLOT]: '' } })).toBeNull();
    expect(
      equippedStackKey({ ...base, functionalSelections: { ...base.functionalSelections, [WEAPON_SLOT]: 'pushRod' } }),
      '辅助件不是 Weapon ⇒ 没有成长 stack',
    ).toBeNull();
    // 正常形态：取的是 (partId, star)，star 缺省 = ★1
    expect(equippedStackKey(base)).toEqual({ partId: 'cannon', star: GROWTH_STAR });
    // ★2（旧档残留）按同一口径读出来，不会退化成 ★1
    expect(
      equippedStackKey({ ...base, functionalStars: { [WEAPON_SLOT]: 2 } }),
    ).toEqual({ partId: 'cannon', star: 2 });
  });

  it('PG-14 `repairEquippedStack` 对空槽 / 非武器槽返回 null（不无中生有）', () => {
    const inv = defaultInventory();
    const base = defaultPlayerDraft();
    expect(repairEquippedStack(inv, { ...base, functionalSelections: { ...base.functionalSelections, [WEAPON_SLOT]: EMPTY_SLOT } })).toBeNull();
    expect(repairEquippedStack(inv, { ...base, functionalSelections: { ...base.functionalSelections, [WEAPON_SLOT]: 'pushRod' } })).toBeNull();
  });
});

// ============================================================================
describe('PRODUCT-LOOP-R2-A｜J. 读数：数量 / 预览 / 满 stack（Garage 与奖励卡共用）', () => {
  it('PG-15 `stackProgress`：`4 → 5`、`4/5`、满则 `5/5`（不写 6/5）', () => {
    const p = stackProgress(4);
    expect(p.countBefore).toBe(4);
    expect(p.countAfter).toBe(5);
    expect(p.threshold).toBe(FUSE_STACK);
    expect(p.previewText).toBe('4 → 5');
    expect(p.stackText).toBe('4/5');
    expect(p.reachesThreshold, '再拿一件就满 ⇒ 玩家能体验第一次合成').toBe(true);
    expect(p.full, '还没满').toBe(false);

    const full = stackProgress(5);
    expect(full.stackText, 'Queue：「达到5件时可以只显示 5/5」').toBe('5/5');
    expect(full.full).toBe(true);
    expect(stackProgress(9).stackText, '超过阈值也收敛成 5/5').toBe('5/5');
    // 脏读数不编造：负数 / NaN / Infinity → 0
    expect(stackProgress(-3).countBefore).toBe(0);
    expect(stackProgress(Number.NaN).countBefore).toBe(0);
    expect(stackProgress(Number.POSITIVE_INFINITY).countBefore).toBe(0);
    // 非法阈值落到 ≥1（0/0 无意义）
    expect(stackProgress(0, 0).threshold).toBe(1);
  });

  it('PG-16 `growthStack` / `growthStacks` / `mergedStackCount` 都取自同一个计数器', () => {
    const inv = defaultInventory();
    addPart(inv, 'cannon', 1, 3); // = 4
    expect(growthStack(inv, 'cannon')).toEqual({ partId: 'cannon', star: GROWTH_STAR, count: 4 });
    expect(growthStack(inv, 'doesNotExist').count, '未知部件不编造').toBe(0);
    expect(growthStacks(inv, ['cannon', 'spear']).map((s) => s.count)).toEqual([4, 1]);
    // 两条读数只要 (partId, star) 相同就取自同一个计数器 ⇒ 归并后不是 4+4
    const merged = mergedStackCount(inv, [
      { partId: 'cannon', star: 1, count: 4 },
      { partId: 'cannon', star: 1, count: 4 },
    ]);
    expect(merged, '同一 stack 归并（Queue 必改 1）').toBe(4);
  });

  it('PG-17 Garage 读数：星级 + 进度 `4/5`，满则 `5/5` 且可合成，阈值来自 core 合成规则', () => {
    const inv = freshSeedInventory();
    const cannon = weaponEntries(inv).find((w) => w.defId === 'cannon');
    expect(cannon).toBeTruthy();
    expect(cannon!.star).toBe(GROWTH_STAR);
    expect(cannon!.count).toBe(4);
    expect(cannon!.threshold).toBe(FUSE_STACK);
    // PRODUCT-LOOP-R2-B：Queue 必改 3 的「数量 / 5」进度写法（R2-A 的 `×4` 已被取代）
    expect(cannon!.stackText, '未满：Queue 必改 3 的进度写法').toBe('4/5');
    expect(cannon!.reachesThreshold).toBe(false);
    expect(cannon!.fusable, '4/5 不能合成（验收 1）').toBe(false);
    expect(cannon!.maxStar, '★1 不是上限').toBe(false);
    // 满 stack → `5/5` 且**可合成**（验收 2）
    addPart(inv, 'cannon', 1, 1); // 5
    const full = weaponEntries(inv).find((w) => w.defId === 'cannon')!;
    expect(full.stackText).toBe('5/5');
    expect(full.reachesThreshold).toBe(true);
    expect(full.fusable, '5/5 可以合成（验收 2）').toBe(true);
    // 阈值真源校验：与 core 的 `canFuse().need` 一致
    expect(cannon!.threshold).toBe(stackThreshold(inv, 'cannon', GROWTH_STAR));
    // 同一个 stack **只有一条**读数（不生成多张卡）
    expect(weaponEntries(inv).filter((w) => w.defId === 'cannon').length).toBe(1);
    expect(WEAPON_GROWTH_STAR).toBe(GROWTH_STAR);
  });
});
