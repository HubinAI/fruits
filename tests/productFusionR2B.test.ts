/**
 * PRODUCT-LOOP-R2-B-FUSION-STAR｜产品侧**泛化合成**的 targeted 测试（Queue 九条验收）。
 *
 * 唯一合成规则（Queue 核心规则）：
 *     5 × (同一 partId + 同一 star)  →  1 × (同一 partId + star + 1)
 * 不可跨 Weapon、不可跨星级、★5 为上限不可继续合成；一次点击只合一次（不连锁）。
 *
 * 验收覆盖对照（本文件负责 1..8 的 domain / 持久化侧；页面 smoke 在
 * `tests/_e2e_product_reward.cjs` 的合成段）：
 *   ① 4/5 不能合成        → FB-01      ⑤ 不同 star 不能混合   → FB-06
 *   ② 5/5 可以合成        → FB-02      ⑥ equipped 自动升星    → FB-08
 *   ③ 5×★1 → 1×★2        → FB-03      ⑦ 5★ 不能继续融合     → FB-12 / FB-13
 *   ④ 不同 Weapon 不能混合 → FB-05      ⑧ reload 后三者保持    → FB-14
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  INVENTORY_MAX_STAR,
  addPart,
  defaultInventory,
  getCount,
  loadInventoryRaw,
  saveInventory,
  type PartInventory,
} from '../src/core/partInventory';
import { loadPlayerBuild, savePlayerBuild } from '../src/core/buildPersistence';
import {
  buildSnapshotFromDraft,
  makeStarterDraft,
  type BuildDraft,
} from '../src/lab/buildEditorModel';
import { validateSnapshot } from '../src/core/buildValidator';
import { starTierEnergy } from '../src/core/buildSnapshot';
import { registry } from '../src/core/content';
import {
  PLAYER_BODY_DEF_ID,
  WEAPON_SLOT,
  defaultPlayerDraft,
  equipWeapon,
  equippedWeaponStar,
  weaponEntries,
} from '../src/product/playerLoadout';
import {
  FUSE_STACK,
  GROWTH_MAX_STAR,
  GROWTH_STAR,
  canFuseStack,
  equippedStackKey,
  fuseStack,
  stackProgress,
} from '../src/product/playerGrowth';

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
}

let store: MemStorage;
beforeEach(() => {
  store = new MemStorage();
  (globalThis as unknown as { localStorage: MemStorage }).localStorage = store;
});

/** 默认库存（starter 各 ★1）再叠加若干件 —— 不手搓形状，避免与 core 的模型脱节。 */
function invWith(entries: ReadonlyArray<readonly [string, number, number]>): PartInventory {
  const inv = defaultInventory();
  for (const [id, star, n] of entries) addPart(inv, id, star, n);
  return inv;
}

/** 产品默认车（frontMass = cannon ★1）。 */
function draft(): BuildDraft {
  return defaultPlayerDraft();
}

/** 把库存 / Build 写成「上一局留下的磁盘状态」。 */
function persist(inv: PartInventory, d?: BuildDraft): void {
  saveInventory(inv);
  if (d) savePlayerBuild(d);
}

// ============================================================================
describe('R2-B｜FB-01..04. 唯一合成规则：5 合 1（验收 1/2/3 + 必改 1/5）', () => {
  it('FB-01 4/5 **不能**合成：预检不通过，动作被拒且零副作用（验收 1）', () => {
    // `defaultInventory()` 已含 cannon ★1 = 1 ⇒ 再加 3 件 = **恰好 4 件**
    const four = invWith([['cannon', 1, 3]]);
    expect(getCount(four, 'cannon', 1), '前置：刚好卡在阈值下面').toBe(4);

    const gate = canFuseStack(four, 'cannon', 1);
    expect(gate.ok, '4/5 不可合成').toBe(false);
    expect(gate.count).toBe(4);
    expect(gate.need).toBe(FUSE_STACK);
    expect(gate.maxStar).toBe(false);

    const res = fuseStack(four, 'cannon', 1, draft());
    expect(res.ok, '动作也必须被拒').toBe(false);
    if (!res.ok) expect(res.reason).toBe('not-enough');
    expect(getCount(four, 'cannon', 1), '零副作用：还是 4 件').toBe(4);
    expect(getCount(four, 'cannon', 2), '没有凭空产出 ★2').toBe(0);
    expect(store.getItem(INV_KEY), '被拒的合成不落盘').toBeNull();
  });

  it('FB-02 5/5 **可以**合成（验收 2）', () => {
    const inv = invWith([['cannon', 1, 4]]); // starter 1 + 4 = 5
    expect(getCount(inv, 'cannon', 1)).toBe(5);
    expect(canFuseStack(inv, 'cannon', 1).ok).toBe(true);
    expect(fuseStack(inv, 'cannon', 1, draft()).ok).toBe(true);
  });

  it('FB-03 **5 × ★1 → 1 × ★2**：★1 归零、★2 = 1（验收 3）', () => {
    const inv = invWith([['cannon', 1, 4]]);
    const res = fuseStack(inv, 'cannon', 1, draft());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.partId).toBe('cannon');
    expect(res.fromStar).toBe(1);
    expect(res.toStar).toBe(2);
    expect(res.consumed).toBe(5);
    expect(res.countBefore).toBe(5);
    expect(res.countAfter, '★1 归零').toBe(0);
    expect(res.productCount, '★2 = 1').toBe(1);
    expect(getCount(inv, 'cannon', 1)).toBe(0);
    expect(getCount(inv, 'cannon', 2)).toBe(1);
  });

  it('FB-04 同一个函数对**所有** Weapon 一视同仁（必改 1：不写 cannon 特例）', () => {
    for (const id of ['cannon', 'hammer', 'spear']) {
      const inv = invWith([[id, 1, 4]]);
      const res = fuseStack(inv, id, 1, draft());
      expect(res.ok, `${id} 走同一条路径`).toBe(true);
      expect(getCount(inv, id, 1)).toBe(0);
      expect(getCount(inv, id, 2), `${id} 产出 ★2`).toBe(1);
    }
  });
});

// ============================================================================
describe('R2-B｜FB-05..07. 不许混合（验收 4/5 + 必改 5）', () => {
  it('FB-05 不同 Weapon 不能混合：cannon 有 5 件，hammer 的 4 件仍然是 4 件（验收 4）', () => {
    const inv = invWith([
      ['cannon', 1, 4], // → 5
      ['hammer', 1, 3], // starter 1 + 3 = 4
    ]);
    expect(canFuseStack(inv, 'hammer', 1).ok, '4 件 hammer 借不到 cannon 的件').toBe(false);
    const res = fuseStack(inv, 'cannon', 1, draft());
    expect(res.ok).toBe(true);
    expect(getCount(inv, 'cannon', 2)).toBe(1);
    expect(getCount(inv, 'hammer', 1), 'hammer 一件都没被动').toBe(4);
    expect(getCount(inv, 'hammer', 2)).toBe(0);
    expect(getCount(inv, 'spear', 2), '其它武器同样不受影响').toBe(0);
  });

  it('FB-06 不同 star 不能混合：★1 可合、★2（4 件）不可合；合 ★1 不消耗 ★2（验收 5）', () => {
    const inv = invWith([
      ['cannon', 1, 4], // → ★1 = 5
      ['cannon', 2, 4], // → ★2 = 4
    ]);
    expect(canFuseStack(inv, 'cannon', 1).ok).toBe(true);
    expect(canFuseStack(inv, 'cannon', 2).ok, '★2 只有 4 件').toBe(false);

    const res = fuseStack(inv, 'cannon', 1, draft());
    expect(res.ok).toBe(true);
    expect(getCount(inv, 'cannon', 1), '★1 被消耗光').toBe(0);
    expect(getCount(inv, 'cannon', 2), '★2 是 4 + 1 = 5（既没被当材料也没被无视）').toBe(5);
    expect(getCount(inv, 'cannon', 3), '没有跨档产出 ★3').toBe(0);
  });

  it('FB-07 **一次点击只合一次**：★1 = 10 → ★1 = 5 + ★2 = 1（绝不连锁到 ★3，必改 5）', () => {
    const inv = invWith([['cannon', 1, 9]]); // starter 1 + 9 = 10
    expect(getCount(inv, 'cannon', 1)).toBe(10);
    const res = fuseStack(inv, 'cannon', 1, draft());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.countBefore).toBe(10);
    expect(res.countAfter, '只消耗一次 5 件').toBe(5);
    expect(getCount(inv, 'cannon', 2), '只产出 1 件 ★2').toBe(1);
    expect(getCount(inv, 'cannon', 3), '没有连锁到 ★3').toBe(0);
    // 第二次点击才轮到剩下的 5 件
    const again = fuseStack(inv, 'cannon', 1, draft());
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.countBefore, '第二次点击读到的仍是 5（不是「已经帮你合到底」）').toBe(5);
    expect(getCount(inv, 'cannon', 1)).toBe(0);
    expect(getCount(inv, 'cannon', 2)).toBe(2);
  });
});

// ============================================================================
describe('R2-B｜FB-08..11. 装备与星级（验收 6 + 必改 2）', () => {
  it('FB-08 ⚠️ 装备那一档**被合空** ⇒ 装备自动升到 ★2，且 Build 真的落盘（验收 6）', () => {
    const inv = invWith([['cannon', 1, 4]]); // ★1 = 5，其中 1 件正装备着
    const d = draft();
    expect(d.functionalSelections[WEAPON_SLOT]).toBe('cannon');
    expect(equippedStackKey(d)).toEqual({ partId: 'cannon', star: GROWTH_STAR });
    expect(
      registry
        .bodies.get(PLAYER_BODY_DEF_ID)!
        .functionalHardpoints.some((h) => h.id === WEAPON_SLOT),
      '前置：产品默认车的车身确实有 frontMass 挂点（★2 的装备写得进去）',
    ).toBe(true);
    persist(inv, d);

    const res = fuseStack(inv, 'cannon', 1, d);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.equippedBefore, '合成前装的是 ★1').toBe(1);
    expect(res.equippedAfter, '合成后装的是 ★2').toBe(2);
    expect(res.equippedUpgraded, '发生了自动升星').toBe(true);
    expect(equippedWeaponStar(res.draft), '返回的 Build 上确实是 ★2').toBe(2);
    // 装备指向的 stack 必须真实存在（Queue 必改 2 的硬要求）
    expect(getCount(inv, 'cannon', 2)).toBeGreaterThan(0);
    expect(getCount(inv, 'cannon', 1), '★1 已被合空 ⇒ 若没升星就会悬空').toBe(0);
    // 真的落盘了（不是只改了内存对象）
    expect(loadPlayerBuild()!.functionalSelections[WEAPON_SLOT]).toBe('cannon');
    expect(loadPlayerBuild()!.functionalStars?.[WEAPON_SLOT]).toBe(2);
    expect(getCount(loadInventoryRaw()!, 'cannon', 2)).toBe(1);
  });

  it('FB-09 装备那一档**没被合空** ⇒ 装备一个字节都不动（6 件里合掉 5 件）', () => {
    const inv = invWith([['cannon', 1, 5]]); // ★1 = 6
    const d = draft();
    const res = fuseStack(inv, 'cannon', 1, d);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.countAfter, '剩 1 件 ★1').toBe(1);
    expect(res.equippedBefore).toBe(1);
    expect(res.equippedAfter, '装备仍指向有效 stack ⇒ 不动它').toBe(1);
    expect(res.equippedUpgraded).toBe(false);
    expect(res.draft, 'Build 对象都没换（没有多余的写盘）').toBe(d);
  });

  it('FB-10 合成**没装备**的那件时，装备（甚至别的武器）完全不受影响', () => {
    const inv = invWith([['spear', 1, 4]]); // 装的是 cannon，合成 spear
    const d = draft();
    const res = fuseStack(inv, 'spear', 1, d);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.equippedBefore, 'spear 没装在车上').toBeNull();
    expect(res.equippedAfter).toBeNull();
    expect(res.equippedUpgraded).toBe(false);
    expect(equippedWeaponStar(res.draft)).toBe(1);
    expect(res.draft.functionalSelections[WEAPON_SLOT]).toBe('cannon');
  });

  it('FB-11 ⚠️ 升星写不进 Build（车身已无该挂点）⇒ 整体回滚：库存与 Build 都零变化', () => {
    /*
      必改 2 的另一半：升星失败时**绝不能**留下悬空装备，也**绝不能**留半成品库存。

      构造方式**刻意不用「能量超载」**——写这条测试时先探明了事实：`validateSnapshot`
      不含星级能量倍率（`buildValidator.ts:114` 累加的是 `def.energy`，只有 Lab 编辑路径的
      `computeEnergy` 才用 `starTierEnergy`）⇒ **升星本身不会被能量校验挡住**，
      详见紧随其后的 FB-11b。若这里仍然按「★2 超能量」写，只会得到一条假绿。

      改用 `unknown-slot`：`WEAPON_SLOT = 'frontMass'`，而 `wedgeBody` 的功能挂点只有
      front / top / rear —— 这正是 `equipWeapon` 那道守卫要防的场景（Body 变更后，
      旧 Build 指向一个已不存在的槽）。此时装备**必须**拒绝升星并回滚，而不是把
      ★1 吃掉、再让 Equipped 指着一个写不进去的 ★2。
    */
    const wedge = registry.bodies.get('wedgeBody');
    expect(wedge, '前置：wedgeBody 存在').toBeTruthy();
    expect(
      wedge!.functionalHardpoints.some((h) => h.id === WEAPON_SLOT),
      '前置：wedgeBody 确实**没有** frontMass 挂点（这是本条能触达回滚的原因）',
    ).toBe(false);

    const stale: BuildDraft = {
      ...makeStarterDraft('wedgeBody', registry),
      functionalSelections: { [WEAPON_SLOT]: 'cannon' },
    };
    expect(equippedStackKey(stale), '前置：这份（过期的）Build 声称装着 cannon ★1').toEqual({
      partId: 'cannon',
      star: 1,
    });

    const inv = invWith([['cannon', 1, 4]]); // ★1 = starter 1 + 4 = 5
    expect(getCount(inv, 'cannon', 1), '前置：恰好 5 件，能合一次').toBe(5);
    // 磁盘上先留一份**合法**的 Build：用来证明失败的合成连「别的东西」都没写坏
    const legal = draft();
    persist(inv, legal);
    const buildBefore = store.getItem(BUILD_KEY);
    expect(buildBefore, '前置：合法 Build 已落盘').toBeTruthy();

    const res = fuseStack(inv, 'cannon', 1, stale);
    expect(res.ok, '升星写不进 Build ⇒ 这次合成必须整体被拒').toBe(false);
    if (!res.ok) expect(res.reason).toBe('equip-failed');
    expect(getCount(inv, 'cannon', 1), '★1 回到 5（材料还回去了）').toBe(5);
    expect(getCount(inv, 'cannon', 2), '产物也回滚了（不留半成品）').toBe(0);
    expect(store.getItem(BUILD_KEY), 'Build 一字未改').toBe(buildBefore);
    expect(getCount(loadInventoryRaw()!, 'cannon', 1), '落盘库存同样是 5').toBe(5);
    expect(getCount(loadInventoryRaw()!, 'cannon', 2)).toBe(0);
    expect(loadPlayerBuild()?.functionalSelections[WEAPON_SLOT], '读回来还是原装备').toBe(
      legal.functionalSelections[WEAPON_SLOT],
    );
  });

  it('FB-11b ⚠️ 已探明事实（不是期望）：`validateSnapshot` **不含**星级能量倍率', () => {
    /*
      本条把「合成回滚为什么只能靠 unknown-slot 触达」这一事实钉死，避免后人误判：

        构造：bananaBody（容量 90）+ 三件 cannon（各 30）。
          ★1：30 + 30 + 30 = 90 = 容量 ⇒ 合法（校验是 `>`，不是 `>=`）。
          ★2：真实能量 round(30 × 1.1) = 33 ⇒ 33 + 30 + 30 = 93 > 90 ⇒ **应当**非法。
        但 `validateSnapshot` 累加的是 `def.energy`（不含倍率）⇒ 二者都判合法。

      ⇒ 结论：产品侧「合成升星」不会被能量校验挡住；`fuseStack` 的回滚分支因此是
      **防御性的**（当前唯一可达路径是 `unknown-slot`，见 FB-11）。
      ⚠️ 这是 `buildValidator` 侧一处**跨模块不一致**（`computeEnergy` 含倍率、
      `validateSnapshot` 不含）—— 按「门控缺陷拆独立 Bug Queue、禁混并 scope」，
      本 Queue **只记录不修**；将来若修好，本条应改成断言 ★2 非法。
    */
    const d: BuildDraft = {
      ...makeStarterDraft('bananaBody', registry),
      functionalSelections: { front: 'cannon', frontMass: 'cannon', top: 'cannon' },
    };
    expect(d.functionalSelections[WEAPON_SLOT], '前置：装备槽上是 cannon').toBe('cannon');

    const v1 = validateSnapshot(buildSnapshotFromDraft(d, registry), registry);
    expect(v1.valid, '★1 三件 cannon 恰好用满容量 ⇒ 合法').toBe(true);

    const d2: BuildDraft = { ...d, functionalStars: { [WEAPON_SLOT]: 2 } };
    const v2 = validateSnapshot(buildSnapshotFromDraft(d2, registry), registry);
    expect(v2.valid, '⚠️ 已探明事实：校验器不看星级，★2 也照样放行').toBe(true);

    // 对照：真正含星级倍率的那个函数确实算得出 33 —— 证明上面的「放行」不是数据算错
    expect(starTierEnergy(30, 2), '★2 炮的真实能量').toBe(33);
    expect(starTierEnergy(30, 2) + 30 + 30, '真实能量 93 > 容量 90').toBeGreaterThan(90);
  });
});

// ============================================================================
describe('R2-B｜FB-12..14. 星级上限与持久化（验收 7/8 + 必改 4）', () => {
  it('FB-12 ★5 **不能**继续融合（验收 7），且零副作用', () => {
    const inv = invWith([
      ['cannon', 5, 5],
      ['cannon', 1, 4], // 顺带放一件可合的，证明拒绝不是因为整个函数坏了
    ]);
    const gate = canFuseStack(inv, 'cannon', 5);
    expect(gate.ok).toBe(false);
    expect(gate.maxStar, '★5 = 上限').toBe(true);
    const res = fuseStack(inv, 'cannon', 5, draft());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('max-star');
    expect(getCount(inv, 'cannon', 5), '★5 一件不少').toBe(5);
    // ⚠️ 「★6 读作 0」是**错的期望**：`starKey` 把 6 夹回 ★5 ⇒ 要证明「★6 不存在」，
    // 只能看**桶的名字**（结构上只有 one..five 五个合法值），而不是读一个越界星级。
    const buckets = Object.keys(inv.cannon);
    expect(buckets, '★6 不是「数量 0 的桶」，而是**没有这个桶**').not.toContain('six');
    expect(
      buckets.every((k) => ['one', 'two', 'three', 'four', 'five'].includes(k)),
      `桶名只允许 one..five，实际 ${buckets.join('/')}`,
    ).toBe(true);
    addPart(inv, 'cannon', 6, 1);
    expect(getCount(inv, 'cannon', 5), '★6 会被**夹**进 ★5，不会新开一档').toBe(6);
    expect(canFuseStack(inv, 'cannon', 1).ok, '★1 仍然可合（拒绝只针对 ★5）').toBe(true);
  });

  it('FB-13 结构支持 ★1..★4 都能合、★5 是上限（必改 4：不是只支持 1★→2★）', () => {
    for (let s = 1; s < GROWTH_MAX_STAR; s++) {
      const inv = invWith([['laser', s, 5]]);
      const res = fuseStack(inv, 'laser', s, draft());
      expect(res.ok, `★${s} → ★${s + 1} 应当可行`).toBe(true);
      expect(getCount(inv, 'laser', s)).toBe(0);
      expect(getCount(inv, 'laser', s + 1)).toBe(1);
    }
    const top = invWith([['laser', GROWTH_MAX_STAR, 5]]);
    expect(fuseStack(top, 'laser', GROWTH_MAX_STAR, draft()).ok).toBe(false);
    // 上限只有一个真源（core 的库存档数），产品侧不再写一个 5
    expect(GROWTH_MAX_STAR).toBe(INVENTORY_MAX_STAR);
    expect(GROWTH_MAX_STAR).toBe(5);
  });

  it('FB-14 ⚠️ reload 后 **star / count / equipped 三样都保持**（验收 8）', () => {
    const inv = invWith([['cannon', 1, 4], ['spear', 2, 1]]);
    const d = draft();
    const res = fuseStack(inv, 'cannon', 1, d);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    persist(inv, res.draft);

    // 「reload」= 丢掉手里所有内存引用，只从磁盘重读（与页面 reload 同一口径）
    const invBack = loadInventoryRaw()!;
    const buildBack = loadPlayerBuild()!;
    expect(getCount(invBack, 'cannon', 1), '★1 归零被持久化').toBe(0);
    expect(getCount(invBack, 'cannon', 2), '★2 = 1 被持久化').toBe(1);
    expect(getCount(invBack, 'spear', 2), '其它星级档也活着').toBe(1);
    expect(equippedWeaponStar(buildBack), '装备的 ★2 被持久化').toBe(2);
    expect(buildBack.functionalSelections[WEAPON_SLOT]).toBe('cannon');
    // 装备指向的 stack 在重读后的库存里**确实存在**（不是只对了数字）
    const key = equippedStackKey(buildBack)!;
    expect(getCount(invBack, key.partId, key.star)).toBeGreaterThan(0);
  });
});

// ============================================================================
describe('R2-B｜FB-15..18. 读数 / 真源 / 装备写入口（维护性守卫）', () => {
  it('FB-15 `weaponEntries` 逐 `(defId, star)` 列出：同一个 defId 可以是**两条**读数', () => {
    const inv = invWith([
      ['cannon', 1, 1],
      ['cannon', 2, 1],
    ]);
    const cannons = weaponEntries(inv).filter((w) => w.defId === 'cannon');
    expect(cannons.length, '★1 与 ★2 是两张卡').toBe(2);
    expect(cannons.map((w) => w.star).sort()).toEqual([1, 2]);
    // 同一个 (defId, star) 只有一条（归并铁律）
    const keys = weaponEntries(inv).map((w) => `${w.defId}★${w.star}`);
    expect(new Set(keys).size).toBe(keys.length);
    // ★2 的实际能量 = 基准 × 星级倍率（与 Build 总能量同源）
    const two = cannons.find((w) => w.star === 2)!;
    expect(two.energyInUse).toBeGreaterThan(two.energy);
  });

  it('FB-16 满 5 件且 ★5 时 `fusable=false` / `maxStar=true`；★1..★4 满 5 件则 `fusable=true`', () => {
    const inv = invWith([
      ['cannon', 1, 4], // ★1 = 5
      ['spear', 4, 5], // ★4 = 5
      ['laser', 5, 5], // ★5 = 5
    ]);
    const by = (id: string, s: number) => weaponEntries(inv).find((w) => w.defId === id && w.star === s)!;
    expect(by('cannon', 1).fusable, '★1 满 5 件').toBe(true);
    expect(by('spear', 4).fusable, '★4 满 5 件仍可合出 ★5').toBe(true);
    expect(by('laser', 5).fusable, '★5 是上限').toBe(false);
    expect(by('laser', 5).maxStar).toBe(true);
    expect(by('cannon', 1).stackText, '进度写法').toBe('5/5');
  });

  it('FB-17 `equipWeapon` 星级泛化：装 ★2 会写 `functionalStars`，装回 ★1 会删掉该键', () => {
    const inv = invWith([['cannon', 2, 1]]);
    const d = draft();
    const up = equipWeapon('cannon', d, inv, 2);
    expect(up.ok, `装上 ★2：${up.detail ?? ''}`).toBe(true);
    expect(up.draft!.functionalStars?.[WEAPON_SLOT]).toBe(2);
    expect(loadPlayerBuild()!.functionalStars?.[WEAPON_SLOT]).toBe(2);

    const back = equipWeapon('cannon', up.draft!, inv, 1);
    expect(back.ok).toBe(true);
    expect(back.draft!.functionalStars?.[WEAPON_SLOT], '★1 不写字段（旧 Build 形状最简）').toBeUndefined();
    expect(loadPlayerBuild()!.functionalStars, '落盘里也不该留一个 1').toBeUndefined();
  });

  it('FB-18 非法星级 / **库存里那一档没有货**都会被装备拒绝（不静默换档）', () => {
    const inv = invWith([]); // cannon ★1 = 1（starter），★2 = 0
    const d = draft();
    const bad = equipWeapon('cannon', d, inv, 9);
    expect(bad.ok).toBe(false);
    expect(bad.reason, '越界星级直接拒（不夹到 ★5）').toBe('bad-star');
    const missing = equipWeapon('cannon', d, inv, 2);
    expect(missing.ok).toBe(false);
    expect(missing.reason).toBe('not-owned');
    expect(store.getItem(BUILD_KEY), '两次拒绝都零副作用').toBeNull();
  });

  it('FB-19 `stackProgress` 的进度文案与阈值同源（阈值真源仍是 core 的 need）', () => {
    const p = stackProgress(4, FUSE_STACK);
    expect(p.stackText).toBe('4/5');
    expect(p.previewText).toBe('4 → 5');
    expect(p.reachesThreshold).toBe(true);
    expect(p.full).toBe(false);
    expect(stackProgress(5, FUSE_STACK).stackText, '满则收敛成 5/5').toBe('5/5');
  });
});
