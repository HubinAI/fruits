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
 *
 * ⚠️ PRODUCT-LOOP-R2-RECOVERY-ONBOARDING-CLARITY（必改 1）**修订了下面这一条契约**。
 *
 *     R2-A 当时的口径是「老档一个字节都不动」。真人反馈 ② 证明它带来一个致命副作用：
 *     真人用的就是历史 Profile ⇒ 永远停在 `cannon ★1 ×1` ⇒ 「4/5 → 打一局 → 5/5 → 合成」
 *     这条验证链在真人机器上**不可达**。因此本 Queue 新增一条**独立、版本化、一次性**的
 *     onboarding 迁移（`src/product/r2Onboarding.ts`），把老档的 `cannon ★1` 补到 4。
 *
 *     ⇒ 本文件的相关用例**不是被删掉，而是被改写成更精确的契约**（三层同时断言）：
 *       ① 旧口径仍然成立的部分：**种子**（`FRESH_STACK_SEED`）依然只发新账号；
 *       ② 新口径：**未成长**的老档会被 onboarding 一次性补到 4（且只补 cannon、只补一次）；
 *       ③ 新的更严约束：**已成长**的老档（存在 ★≥2 的 Weapon）**一个字节都不动**；
 *          老档的**其它 stack**（spear / hammer / 非武器）也**一个字节都不动**。
 *     需要「单独验 R2-A 的原有路径」（种子 / Equipped 兜底）时，用例会先把 onboarding
 *     的标记**预置**好（`markR2Onboarding()`），把这条新变量隔离出去 —— 这是**隔离变量**，
 *     不是放宽断言。
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
import {
  R2_ONBOARDING_KEY,
  R2_ONBOARDING_TARGET_COUNT,
  markR2Onboarding,
  planR2Onboarding,
} from '../src/product/r2Onboarding';
/**
 * PRODUCT-LOOP-R2-VALIDATION-STATE-RESEED-R1｜`openGrowthSession` 现在还会写**第二个**一次性标记。
 * 只取它的 key（`PG-10` 的闭集断言要把这个新 key 收进白名单，而不是把闭集放宽成「至少包含」）。
 */
import { R2_RESEED_KEY } from '../src/product/r2Reseed';

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
    /*
      ⚠️ R2-RECOVERY（必改 1）**改写了这一条期望**：老档的 2 件不再「原样保留」，
         而是被**一次性的 onboarding 迁移**补到 4（这正是本 Queue 的目的：
         让历史 Profile 也真实处于「还差 1 件」的验证起点）。
         ⚠️ 但补的动作**不是种子**（`seeded` 仍是 false）—— 两条路径必须可区分，
         否则「种子只发新账号」这条不变量就会在无声中被吃掉。
    */
    expect(g.onboarding.applied, '未成长的老档必须被 onboarding 补件').toBe(true);
    expect(g.onboarding.reason).toBe('raised');
    expect(g.onboarding.raised, '2 → 4 只补 2 件').toBe(2);
    expect(getCount(g.inv, 'cannon', WEAPON_GROWTH_STAR), '补到目标 4').toBe(R2_ONBOARDING_TARGET_COUNT);
    // 其它 stack 一个字节都不动（补件只针对 cannon ★1）
    expect(getCount(g.inv, 'spear', WEAPON_GROWTH_STAR)).toBe(1);
    expect(getCount(g.inv, 'hammer', WEAPON_GROWTH_STAR)).toBe(1);
    expect(getCount(g.inv, 'pushRod', 1), '非武器一件都不动').toBe(1);
    expect(getCount(g.inv, 'cannon', 2), '★2 那一档不被无中生有').toBe(0);
  });

  it('PG-02b 已成长的老档（存在 ★≥2 的 Weapon）⇒ onboarding **完全不改库存**', () => {
    seedBuild();
    const grown = defaultInventory();
    grown['cannon'].one = 1;
    grown['cannon'].two = 1; // 玩家已经合出过 ★2 的炮 ⇒ 「已经发生过成长」
    seedDisk(grown as unknown as Record<string, unknown>);
    const cannonBefore = store.getItem(INV_KEY);

    const g = openGrowthSession(loadEquippedDraft());
    expect(g.onboarding.applied, '已成长的账号不被 onboarding 干涉').toBe(false);
    expect(g.onboarding.reason).toBe('already-grown');
    expect(g.onboarding.raised).toBe(0);
    expect(getCount(g.inv, 'cannon', WEAPON_GROWTH_STAR), '★1 的 1 件保持 1 件').toBe(1);
    expect(getCount(g.inv, 'cannon', 2), '★2 保持 1 件').toBe(1);
    expect(store.getItem(INV_KEY), '库存一个字节都不该被改写').toBe(cannonBefore);
    // 但仍然打了标记：下一次不会再判一次（判定被「钉住」而不是每轮重算）
    expect(store.getItem(R2_ONBOARDING_KEY), '已成长只打标记、不改库存').not.toBeNull();
  });

  it('PG-02c 只执行一次：打了标记之后 reload **不会再补**（否则每次进首页 +3）', () => {
    seedBuild();
    const old = defaultInventory();
    old['cannon'].one = 1;
    seedDisk(old as unknown as Record<string, unknown>);

    const first = openGrowthSession(loadEquippedDraft());
    expect(first.onboarding.applied).toBe(true);
    expect(getCount(first.inv, 'cannon', 1)).toBe(R2_ONBOARDING_TARGET_COUNT);
    const invAfterFirst = store.getItem(INV_KEY);

    // 模拟 reload：重新开会话（磁盘上已有标记）
    const second = openGrowthSession(loadEquippedDraft());
    expect(second.onboarding.applied, '第二次绝不能再补').toBe(false);
    expect(second.onboarding.reason).toBe('already-marked');
    expect(getCount(second.inv, 'cannon', 1), '仍然是 4，不是 7').toBe(R2_ONBOARDING_TARGET_COUNT);
    expect(store.getItem(INV_KEY), '没有改动就不该有库存写入').toBe(invAfterFirst);
  });

  it('PG-02d 已达 4 件的老档：只打标记、库存不动（不把 4 抬到更高，也不降回来）', () => {
    seedBuild();
    const enough = defaultInventory();
    enough['cannon'].one = 6;
    seedDisk(enough as unknown as Record<string, unknown>);
    const before = store.getItem(INV_KEY);

    const g = openGrowthSession(loadEquippedDraft());
    expect(g.onboarding.applied).toBe(false);
    expect(g.onboarding.reason).toBe('already-enough');
    expect(getCount(g.inv, 'cannon', 1), '多于 4 件不被「抬」也不被削减').toBe(6);
    expect(store.getItem(INV_KEY)).toBe(before);
  });

  it('PG-02e `planR2Onboarding` 是**纯判定**（不落盘、不改库存、不打标记）', () => {
    const inv = defaultInventory();
    inv['cannon'].one = 1;
    const before = JSON.stringify(inv);
    const plan = planR2Onboarding(inv);
    expect(plan.applied).toBe(true);
    expect(plan.raised).toBe(3);
    expect(JSON.stringify(inv), '判定不许改库存').toBe(before);
    expect(store.getItem(R2_ONBOARDING_KEY), '判定不许打标记').toBeNull();
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
    /*
      ⚠️ R2-RECOVERY（必改 1）：cannon 的 3 件被 onboarding 补到 4（本 Queue 的目的）。
         但「不清空、不打回 starter」这条才是本用例真正在守的东西 ⇒ 它由下面三条断言守住：
         ① spear 的 2 件**逐条保留**；② 缺失的 hammer 仍是 0（不是补 starter 的 1）；
         ③ 补件只发生在 cannon ★1 上。
    */
    expect(g.onboarding.applied, '3 → 4：未成长的老档被补一件').toBe(true);
    expect(g.onboarding.raised).toBe(1);
    expect(getCount(g.inv, 'cannon', 1), '3 → 4（只补到目标，不多补）').toBe(R2_ONBOARDING_TARGET_COUNT);
    expect(getCount(g.inv, 'spear', 1), '另一件的计数逐条保留').toBe(2);
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
    /*
      ⚠️ R2-RECOVERY（必改 1）在这里**加了一个 key**：一次性 onboarding 的版本标记
         `strongfruit.r2Onboarding.v1`。断言仍然是**闭集**（不是「至少包含」）——
         多写任何一个 key 都会红，这一点没有放宽。
      ⚠️ R2-VALIDATION-STATE-RESEED-R1 又**加了第二个**：版本化一次性 reseed 的标记
         `strongfruit.r2Reseed.v1`。**同样只是把白名单 +1，闭集语义原样保留** ——
         将来若再冒出第三个 key，这一条仍然会红（这正是它存在的意义）。
         两份迁移各用各的 key 是**刻意的**：它们的写语义相反（一个只增不减，一个必须删 ★≥2），
         共用一个 key 会让两边的不变量都无法审计。
      ⚠️ 库存本体仍然只有 `ownedParts.v2` 一处（旧横屏游戏与竖屏产品共用那一份）。
    */
    expect(keys.sort(), '成长只允许写「正式库存 key + 两个一次性迁移标记」').toEqual(
      [INV_KEY, R2_ONBOARDING_KEY, R2_RESEED_KEY].sort(),
    );
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
    /*
      ⚠️ R2-RECOVERY（必改 1）｜**隔离变量**：本用例守的是 R2-A 的 `repairEquippedStack`
         路径（「装备指向一个 count = 0 的 stack」）。而新的 onboarding 恰好也会给 cannon
         补件 ⇒ 两条路径会**同时**命中同一个 stack，让「到底是谁补的」不可区分。
         因此这里先把 onboarding 的标记预置好（= 「这条迁移对这个账号不适用」），
         让被测路径成为唯一自变量。这不是放宽断言：所有断言逐字保留，且**新增**了
         「onboarding 没参与」的显式确认（`g.onboarding.reason === 'already-marked'`）。
    */
    markR2Onboarding();
    // 老档：有 hammer / pushRod，没有 cannon；而当前装备是 cannon
    seedDisk({ hammer: { one: 1, two: 0 }, pushRod: { one: 1, two: 0 } });
    seedBuild();
    const draft = loadEquippedDraft();
    expect(draft.functionalSelections[WEAPON_SLOT]).toBe('cannon');
    // core 侧：只要**有任何一件**就原样返回 ⇒ 装备会指到一个 count = 0 的 stack
    expect(getCount(playerInventory(draft), 'cannon', 1), '这就是 R2-A 要兜底的那个缺口').toBe(0);

    const g = openGrowthSession(draft);
    expect(g.onboarding.reason, 'onboarding 已预置为已执行 ⇒ 补件只能来自 repairEquippedStack').toBe(
      'already-marked',
    );
    expect(g.repairedEquipped, '必须报告修了哪一件').toBe('cannon');
    expect(getCount(g.inv, 'cannon', 1)).toBe(1);
    expect(getCount(loadInventoryRaw()!, 'cannon', 1), '修复必须落盘').toBe(1);
    // 其它条目一个字节都不动
    expect(getCount(g.inv, 'hammer', 1)).toBe(1);
    expect(getCount(g.inv, 'pushRod', 1)).toBe(1);
  });

  it('PG-11b 不预置 onboarding 时，「Equipped 不得指向空 stack」这条不变量**仍然成立**', () => {
    // 与 PG-11 同一份老档，但**不**预置标记 ⇒ 被新的 onboarding 路径覆盖
    seedDisk({ hammer: { one: 1, two: 0 }, pushRod: { one: 1, two: 0 } });
    seedBuild();
    const draft = loadEquippedDraft();
    expect(draft.functionalSelections[WEAPON_SLOT]).toBe('cannon');

    const g = openGrowthSession(draft);
    // 不变量本身（本用例真正在守的东西）：装备指向的 stack 在库存里**有货**
    expect(getCount(g.inv, 'cannon', 1), '无论哪条路径补的，装备都必须指向有效 stack').toBeGreaterThan(0);
    expect(getCount(loadInventoryRaw()!, 'cannon', 1), '且已落盘').toBeGreaterThan(0);
    // 两条路径的**分工**在这里被显式钉住：onboarding 先补到目标 ⇒ 兜底路径无事可做
    expect(g.onboarding.reason).toBe('raised');
    expect(g.repairedEquipped, 'onboarding 已把它补到 4 ⇒ 兜底路径无需再补').toBeNull();
    expect(getCount(g.inv, 'hammer', 1)).toBe(1);
  });

  it('PG-12 装备那件**已经在**库存里 ⇒ 一个字节都不动（只增不减的另一半）', () => {
    // ⚠️ 同 PG-11：预置 onboarding 标记，把「新的补件路径」隔离出去，单验 R2-A 的兜底路径
    markR2Onboarding();
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
