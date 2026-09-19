/**
 * PRODUCT-LOOP-R2-B-FUSION-STAR｜core 库存**星级模型**（★1..★5）的 targeted 测试。
 *
 * 这一层为什么需要单独管：`PartStack` 在 R2-A 之前只有 `one` / `two` 两档，
 * 而读写映射是 `star >= 2 ? two : one` ——
 *   ⚠️ 这意味着 **★3 与 ★2 会落进同一个桶**（5×★2 合成出 ★3 会把 ★2 的计数一起抬上去，
 *      而 `getCount(inv, id, 3)` 读回来的正是 ★2 的数量）⇒ **静默腐烂**，没有任何一处抛错。
 * 又因为 `normalizeInventory()` 只搬运已知字段、其余一律丢弃 ⇒ 产品侧也**不可能**绕过
 * core 在同一个 storage key 里另存高星档。所以「结构支持 ★1..★5」只能在 core 落地。
 *
 * 本文件钉死三件事：
 *   - ① 五个星级**各占一档**（含落盘往返不丢）；
 *   - ② 旧存档（只有 `one`/`two`、有 / 无 `__v` 信封、v1 owned-id 数组）读进来**零变化**；
 *   - ③ **`MAX_STAR = 2` 一字未动** —— 那是旧横屏 Garage 融合规则的策略上限，
 *        与数据模型的 `INVENTORY_MAX_STAR = 5` 是两件事（改了就会连带改横屏玩法）。
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  INVENTORY_MAX_STAR,
  MAX_STAR,
  addPart,
  canFuse,
  consume,
  defaultInventory,
  fuseCategoryMaterials,
  fuseSameStar,
  getCount,
  loadInventoryRaw,
  saveInventory,
} from '../src/core/partInventory';
import { STAMP_KEY } from '../src/core/saveVersion';

const INV_KEY = 'strongfruit.ownedParts.v2';
const INV_KEY_V1 = 'strongfruit.ownedParts.v1';

/** 内存版 localStorage（node 无原生；与其它 core / 产品侧测试同一模式）。 */
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

// ============================================================================
describe('R2-B｜SM-01..04. 星级档位：★1..★5 各占一档（不撞桶）', () => {
  it('SM-01 两个上限是**两件事**：数据模型 ★5 / 旧横屏融合规则 ★2（后者冻结）', () => {
    expect(INVENTORY_MAX_STAR, '库存数据模型能表达的档数').toBe(5);
    expect(MAX_STAR, '旧横屏 Garage 融合规则的策略上限（本分支不动）').toBe(2);
  });

  it('SM-02 ⚠️ ★3 不再与 ★2 撞桶（扩展前 `star >= 2 → two` 会让两者同桶）', () => {
    const inv = defaultInventory();
    addPart(inv, 'cannon', 2, 3);
    addPart(inv, 'cannon', 3, 7);
    expect(getCount(inv, 'cannon', 2), '★2 只算 ★2').toBe(3);
    expect(getCount(inv, 'cannon', 3), '★3 只算 ★3').toBe(7);
  });

  it('SM-03 ★4 / ★5 独立成档，且 `consume` 只减法到自己那一档', () => {
    const inv = defaultInventory();
    addPart(inv, 'spear', 4, 2);
    addPart(inv, 'spear', 5, 5);
    consume(inv, 'spear', 5, 2);
    expect(getCount(inv, 'spear', 4), '★4 未被 ★5 的消耗波及').toBe(2);
    expect(getCount(inv, 'spear', 5)).toBe(3);
    expect(getCount(inv, 'spear', 2), '★2 始终没被碰').toBe(0);
  });

  it('SM-04 越界 / 非整数星级被**夹**进 1..5（不抛、不 NaN、不落到 undefined）', () => {
    const inv = defaultInventory(); // ⚠️ 非空：starter 各 1 件 ★1（故下面不写死 4，而是先取基准读数）
    addPart(inv, 'hammer', 1, 4);
    addPart(inv, 'hammer', 5, 6);
    const one = getCount(inv, 'hammer', 1);
    const five = getCount(inv, 'hammer', 5);
    expect(one, '前置：★1 与 ★5 是两个不同的桶').not.toBe(five);
    expect(getCount(inv, 'hammer', 0), '下越界 → ★1').toBe(one);
    expect(getCount(inv, 'hammer', -3), '负数 → ★1').toBe(one);
    expect(getCount(inv, 'hammer', 9), '上越界 → ★5').toBe(five);
    expect(getCount(inv, 'hammer', 1.7), '小数向下取整 → ★1').toBe(one);
    expect(getCount(inv, 'hammer', 5.9), '小数向下取整 → ★5').toBe(five);
    expect(Number.isFinite(getCount(inv, 'hammer', Number.NaN)), 'NaN 不产生 NaN 读数').toBe(true);
    expect(getCount(inv, 'hammer', Number.NaN), 'NaN → ★1（夹到合法档，不落 undefined）').toBe(one);
  });
});

// ============================================================================
describe('R2-B｜SM-05..09. 旧存档与脏数据：读进来零变化', () => {
  it('SM-05 老档只有 `one`/`two` ⇒ ★1/★2 逐字节不变，★3..★5 读作 0', () => {
    store.setItem(INV_KEY, JSON.stringify({ [STAMP_KEY]: 1, cannon: { one: 2, two: 1 } }));
    const inv = loadInventoryRaw()!;
    expect(inv).toBeTruthy();
    expect(getCount(inv, 'cannon', 1)).toBe(2);
    expect(getCount(inv, 'cannon', 2)).toBe(1);
    for (const s of [3, 4, 5]) expect(getCount(inv, 'cannon', s), `★${s}`).toBe(0);
  });

  it('SM-06 **无 `__v` 信封**的旧库存对象（v0）同样照读', () => {
    store.setItem(INV_KEY, JSON.stringify({ cannon: { one: 5 } }));
    const inv = loadInventoryRaw()!;
    expect(getCount(inv, 'cannon', 1), '缺 `two` 字段 → 0').toBe(5);
    expect(getCount(inv, 'cannon', 2)).toBe(0);
  });

  it('SM-07 ⚠️ ★3..★5 **落盘往返不丢**（normalizeInventory 不再只搬两档）', () => {
    const inv = defaultInventory();
    addPart(inv, 'cannon', 3, 2);
    addPart(inv, 'cannon', 5, 1);
    saveInventory(inv);
    const back = loadInventoryRaw()!;
    expect(getCount(back, 'cannon', 3), '★3 存活').toBe(2);
    expect(getCount(back, 'cannon', 5), '★5 存活').toBe(1);
    expect(getCount(back, 'cannon', 4), '没写过的档仍是 0').toBe(0);
  });

  it('SM-08 旧 v1（owned-id 数组）迁移仍是「每个 id ★1 = 1」（迁移路径未变）', () => {
    store.setItem(INV_KEY_V1, JSON.stringify(['cannon', 'laser']));
    const inv = loadInventoryRaw()!;
    expect(getCount(inv, 'cannon', 1)).toBe(1);
    expect(getCount(inv, 'laser', 1)).toBe(1);
    expect(getCount(inv, 'laser', 3), '迁移只会产出 ★1').toBe(0);
    expect(store.getItem(INV_KEY_V1), '迁移后仍保留 v1 key（不删玩家旧数据）').not.toBeNull();
  });

  it('SM-09 脏数据被夹紧：负数 / 非数 → 0；未知键整条剔除；缺失键补 0', () => {
    store.setItem(
      INV_KEY,
      JSON.stringify({
        [STAMP_KEY]: 1,
        cannon: { one: -3, two: 2, three: 'x', four: null, five: -1 },
        notAPart: { one: 99, two: 99 },
      }),
    );
    const inv = loadInventoryRaw()!;
    expect(getCount(inv, 'cannon', 1)).toBe(0);
    expect(getCount(inv, 'cannon', 2)).toBe(2);
    expect(getCount(inv, 'cannon', 3)).toBe(0);
    expect(getCount(inv, 'cannon', 5)).toBe(0);
    expect(inv['notAPart'], '未知键不保留').toBeUndefined();
    expect(getCount(inv, 'hammer', 1), '缺失的正式部件补 0').toBe(0);
  });
});

// ============================================================================
describe('R2-B｜SM-10..11. 旧横屏融合规则**一字未动**（否则就是静默改玩法）', () => {
  it('SM-10 横屏规则仍然冻结在 2★：★2 不可再合、不给产出', () => {
    const inv = defaultInventory();
    addPart(inv, 'cannon', 2, 5);
    expect(canFuse(inv, 'cannon', 2, null).maxStar, '★2 对横屏规则是满星').toBe(true);
    expect(fuseSameStar(inv, 'cannon', 2, null), '★2 → ★3 被拒').toBeNull();
    const m5 = ['cannon', 'cannon', 'cannon', 'cannon', 'cannon'];
    expect(
      fuseCategoryMaterials(inv, m5, 'combat', null, 2),
      '分类融合同样拒绝 star=2',
    ).toBeNull();
  });

  it('SM-11 横屏的 ★1 → ★2 仍然照常（同 defId 5 件 → 1 件 ★2）', () => {
    const inv = defaultInventory();
    addPart(inv, 'cannon', 1, 5); // starter 1 + 5 = 6
    const out = fuseSameStar(inv, 'cannon', 1, null);
    expect(out).toBeTruthy();
    expect(out!.star).toBe(2);
    expect(getCount(inv, 'cannon', 1)).toBe(1);
    expect(getCount(inv, 'cannon', 2)).toBe(1);
  });

  it('SM-12 五档同时存在时逐档读数与落盘往返都一致（结构真的支持 1..5）', () => {
    const inv = defaultInventory();
    for (let s = 1; s <= INVENTORY_MAX_STAR; s++) addPart(inv, 'laser', s, s);
    saveInventory(inv);
    const back = loadInventoryRaw()!;
    for (let s = 1; s <= INVENTORY_MAX_STAR; s++) {
      expect(getCount(back, 'laser', s), `★${s}`).toBe(s);
    }
  });
});
