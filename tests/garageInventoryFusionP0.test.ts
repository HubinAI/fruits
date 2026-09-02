/**
 * F-GARAGE-INVENTORY-FUSION-P0｜背包 / 部件合成 定向测试（纯模块层，无 UI 渲染）。
 *
 * node 环境无原生 localStorage；用 MemStorage 注入 globalThis.localStorage（同 q21 模式）。
 * 覆盖 Queue §3/§4/§5/§6：
 *  A｜数据模型（MAX_STAR 钉死 / PartInventory 结构 / 三类 Registry / 可合成性）；
 *  B｜canFuse 预检（充足 / 不足 / 已装备保护 / 满星 / available=owned-equipped）；
 *  C｜fuseSameStar 原子合成（5×1★→1×2★ / 不足 null / 持久化 / 已装备保护 / Body 不合成 /
 *     满星不合成 / 禁跨 defId）；
 *  D｜§4 边界规则（available 口径 / 连续合成需再积累 / 负库存防御 / 不改 Build）；
 *  E｜§6 与 grant 联动（hasAllOfficialDebugContent 一致 / ×1 幂等 / 不刷 5 材料）。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  MAX_STAR,
  OFFICIAL_PARTS,
  OFFICIAL_MOVEMENTS,
  defaultInventory,
  getCount,
  addPart,
  fuseSameStar,
  canFuse,
  isFusable,
  loadInventoryRaw,
} from '../src/core/partInventory';
import { OFFICIAL_BODIES } from '../src/core/bodyOwnership';
import { grantAllPartsOnce, hasAllOfficialDebugContent } from '../src/core/debugGrants';
import { EMPTY_SLOT } from '../src/lab/buildEditorModel';
import type { BuildDraft } from '../src/lab/buildEditorModel';

/** 内存版 localStorage（node 环境无原生） */
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
  clear(): void {
    this.m.clear();
  }
  key(i: number): string | null {
    return [...this.m.keys()][i] ?? null;
  }
  get length(): number {
    return this.m.size;
  }
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();
});

/** 装备 cannon 于 front 的 Build（用于已装备保护口径） */
function cannonBuild(): BuildDraft {
  return {
    bodyDefId: 'watermelonBody',
    rearRadius: 20,
    frontRadius: 20,
    functionalSelections: { front: 'cannon', frontMass: EMPTY_SLOT, top: EMPTY_SLOT, rear: EMPTY_SLOT },
    drive: 'forward',
  };
}

describe('F-GARAGE-INVENTORY-FUSION-P0 A｜数据模型', () => {
  it('T1. MAX_STAR = 2：库存仅支持 2 星，合成只做 1★→2★ 单步跃迁（数据模型钉死）', () => {
    expect(MAX_STAR).toBe(2);
  });

  it('T2. PartInventory 结构：每个正式 defId 含 { one, two }，默认全 0', () => {
    const inv = defaultInventory();
    for (const p of OFFICIAL_PARTS) {
      expect(inv[p]).toHaveProperty('one');
      expect(inv[p]).toHaveProperty('two');
      expect(inv[p].two).toBe(0);
    }
  });

  it('T3. 三类 Registry 互不包含、均非空；Body 不混入 Functional/Movement', () => {
    expect(OFFICIAL_PARTS.length).toBeGreaterThan(0);
    expect(OFFICIAL_MOVEMENTS.length).toBeGreaterThan(0);
    expect(OFFICIAL_BODIES.length).toBeGreaterThan(0);
    for (const b of OFFICIAL_BODIES) {
      expect(OFFICIAL_PARTS).not.toContain(b);
      expect(OFFICIAL_MOVEMENTS).not.toContain(b);
    }
  });

  it('T4. isFusable：Functional / Movement 可合成；Body 不可合成（§2/§4）', () => {
    expect(isFusable(OFFICIAL_PARTS[0])).toBe(true);
    expect(isFusable(OFFICIAL_MOVEMENTS[0])).toBe(true);
    expect(isFusable(OFFICIAL_BODIES[0])).toBe(false);
  });
});

describe('F-GARAGE-INVENTORY-FUSION-P0 B｜canFuse 预检', () => {
  it('T5. 充足（5 个未装备 1★）→ ok、available=5、need=5', () => {
    const inv = defaultInventory();
    inv.cannon = { one: 0, two: 0 }; // 清零 starter，精确计数
    addPart(inv, 'cannon', 1, 5);
    const r = canFuse(inv, 'cannon', 1, null);
    expect(r.ok).toBe(true);
    expect(r.available).toBe(5);
    expect(r.need).toBe(5);
    expect(r.maxStar).toBe(false);
  });

  it('T6. 不足（3 个）→ ok=false、available=3、need=5（UI「还差 2 个」）', () => {
    const inv = defaultInventory();
    inv.cannon = { one: 0, two: 0 }; // 清零 starter，精确计数
    addPart(inv, 'cannon', 1, 3);
    const r = canFuse(inv, 'cannon', 1, null);
    expect(r.ok).toBe(false);
    expect(r.available).toBe(3);
    expect(r.need - r.available).toBe(2);
  });

  it('T7. 已装备保护：拥有 6、装备 1 → available=5 → 仍可合成（不消耗已装备）', () => {
    const inv = defaultInventory();
    addPart(inv, 'cannon', 1, 5); // starter 1 + 5 = 6
    const r = canFuse(inv, 'cannon', 1, cannonBuild());
    expect(r.available).toBe(5); // 6 - 1 装备
    expect(r.ok).toBe(true);
  });

  it('T8. 已装备全部消耗保护：拥有 5、装备 5 → available=0 → 不可合成', () => {
    const inv = defaultInventory();
    inv.cannon = { one: 0, two: 0 }; // 清零 starter
    addPart(inv, 'cannon', 1, 4); // 4 个 1★
    // 让 Build 装备 5 个 cannon（front + 重复选同挂点不可，但 equippedCount 按槽位汇总）
    const build: BuildDraft = {
      bodyDefId: 'watermelonBody',
      rearRadius: 20,
      frontRadius: 20,
      functionalSelections: { front: 'cannon', frontMass: 'cannon', top: 'cannon', rear: 'cannon' },
      drive: 'forward',
    };
    const r = canFuse(inv, 'cannon', 1, build);
    expect(r.available).toBe(0); // 5 拥有 - 5 装备
    expect(r.ok).toBe(false);
  });

  it('T9. 满星（star>=MAX_STAR）→ maxStar=true、ok=false（不可再合）', () => {
    const inv = defaultInventory();
    addPart(inv, 'cannon', 2, 5);
    const r = canFuse(inv, 'cannon', 2, null);
    expect(r.maxStar).toBe(true);
    expect(r.ok).toBe(false);
  });
});

describe('F-GARAGE-INVENTORY-FUSION-P0 C｜fuseSameStar 原子合成', () => {
  it('T10. 5×1★ → 1×同 defId 2★：one-5、two+1', () => {
    const inv = defaultInventory();
    addPart(inv, 'cannon', 1, 5); // starter 1 + 5 = 6
    const before = getCount(inv, 'cannon', 1);
    const res = fuseSameStar(inv, 'cannon', 1, null);
    expect(res).not.toBeNull();
    expect(res!.product).toBe('cannon');
    expect(res!.star).toBe(2);
    expect(getCount(inv, 'cannon', 2)).toBe(1);
    expect(getCount(inv, 'cannon', 1)).toBe(before - 5); // 消耗 5
  });

  it('T11. 不足 → 返回 null、库存不变（不消耗、不产出）', () => {
    const inv = defaultInventory();
    inv.cannon = { one: 0, two: 0 }; // 清零 starter
    addPart(inv, 'cannon', 1, 4);
    const oneBefore = getCount(inv, 'cannon', 1);
    const res = fuseSameStar(inv, 'cannon', 1, null);
    expect(res).toBeNull();
    expect(getCount(inv, 'cannon', 1)).toBe(oneBefore);
    expect(getCount(inv, 'cannon', 2)).toBe(0);
  });

  it('T12. 原子持久化：合成后 loadInventoryRaw 还原（一次 saveInventory）', () => {
    const inv = defaultInventory();
    addPart(inv, 'cannon', 1, 5);
    const res = fuseSameStar(inv, 'cannon', 1, null);
    expect(res).not.toBeNull();
    const re = loadInventoryRaw()!;
    expect(getCount(re, 'cannon', 2)).toBe(1);
    expect(getCount(re, 'cannon', 1)).toBe(1); // starter 1 + 5 - 5
  });

  it('T13. 已装备保护：Build 装备 cannon（6 个）→ 合成成功且保留 ≥1 个 1★（Build 不变非法）', () => {
    const inv = defaultInventory();
    addPart(inv, 'cannon', 1, 5); // 6 个 1★
    const res = fuseSameStar(inv, 'cannon', 1, cannonBuild());
    expect(res).not.toBeNull();
    expect(getCount(inv, 'cannon', 1)).toBeGreaterThanOrEqual(1); // 保留 1★（已装备）
    expect(getCount(inv, 'cannon', 2)).toBe(1);
  });

  it('T14. Body 不参与合成：fuseSameStar(body, 1) → null（isFusable 排除）', () => {
    const inv = defaultInventory();
    const body = OFFICIAL_BODIES[0];
    addPart(inv, body, 1, 5); // 即便车身有计数（旧档兼容），也不参与合成
    const res = fuseSameStar(inv, body, 1, null);
    expect(res).toBeNull();
  });

  it('T15. 满星不合成：fuseSameStar(defId, 2) → null（star >= MAX_STAR）', () => {
    const inv = defaultInventory();
    addPart(inv, 'cannon', 2, 5);
    const res = fuseSameStar(inv, 'cannon', 2, null);
    expect(res).toBeNull();
    expect(getCount(inv, 'cannon', 2)).toBe(5); // 未变
  });

  it('T16. 禁跨 defId：只消耗同 defId 的 5 个，不碰其它 defId', () => {
    const inv = defaultInventory();
    addPart(inv, 'cannon', 1, 5);
    addPart(inv, 'laser', 1, 5);
    const laserBefore = getCount(inv, 'laser', 1);
    const res = fuseSameStar(inv, 'cannon', 1, null);
    expect(res).not.toBeNull();
    expect(getCount(inv, 'cannon', 1)).toBe(1); // 6 - 5
    expect(getCount(inv, 'cannon', 2)).toBe(1);
    expect(getCount(inv, 'laser', 1)).toBe(laserBefore); // 未受影响
    expect(getCount(inv, 'laser', 2)).toBe(0);
  });
});

describe('F-GARAGE-INVENTORY-FUSION-P0 D｜§4 边界规则', () => {
  it('T17. available 口径 = owned - equipped（与 build 无关时 = 全部拥有）', () => {
    const inv = defaultInventory();
    addPart(inv, 'cannon', 1, 5); // 6 个
    expect(canFuse(inv, 'cannon', 1, null).available).toBe(6);
    expect(canFuse(inv, 'cannon', 1, cannonBuild()).available).toBe(5); // 6 - 1 装备
  });

  it('T18. 连续合成需重新积累：一次合成后仅剩 1 个 1★ → 不能再次合成', () => {
    const inv = defaultInventory();
    addPart(inv, 'cannon', 1, 5); // 6
    const r1 = fuseSameStar(inv, 'cannon', 1, null);
    expect(r1).not.toBeNull();
    // 只剩 1 个 1★ → 不可再合 1★；2★ 为满星也不可合
    expect(fuseSameStar(inv, 'cannon', 1, null)).toBeNull();
    expect(fuseSameStar(inv, 'cannon', 2, null)).toBeNull();
  });

  it('T19. 负库存防御：脏数据（one 为负）传入不崩溃、不产出负、返回 null', () => {
    const inv = defaultInventory();
    inv.cannon = { one: -3, two: 0 };
    const res = fuseSameStar(inv, 'cannon', 1, null);
    expect(res).toBeNull();
    expect(inv.cannon.one).toBeLessThanOrEqual(0); // 未变成更负（无负消耗）
  });

  it('T20. 不改 Build：合成不修改传入 build 引用与字段', () => {
    const inv = defaultInventory();
    addPart(inv, 'cannon', 1, 5);
    const build = cannonBuild();
    const snapshot = JSON.stringify(build);
    fuseSameStar(inv, 'cannon', 1, build);
    expect(JSON.stringify(build)).toBe(snapshot); // build 未变
  });
});

describe('F-GARAGE-INVENTORY-FUSION-P0 E｜§6 与 grant 联动', () => {
  it('T21. 全新账号 hasAllOfficialDebugContent = false（未全部拥有）', () => {
    const inv = defaultInventory();
    expect(hasAllOfficialDebugContent(inv)).toBe(false);
  });

  it('T22. grantAllPartsOnce 后 hasAllOfficialDebugContent = true，且每个 Functional/Movement one≥1', () => {
    grantAllPartsOnce();
    expect(hasAllOfficialDebugContent()).toBe(true);
    // 直接从真实库存校验（hasAllOfficialDebugContent 同源）
    const inv = loadInventoryRaw()!;
    for (const p of OFFICIAL_PARTS) expect(getCount(inv, p, 1)).toBeGreaterThanOrEqual(1);
    for (const m of OFFICIAL_MOVEMENTS) expect(getCount(inv, m, 1)).toBeGreaterThanOrEqual(1);
  });

  it('T23. 重复 grant 幂等：两次 grantAllPartsOnce 后每个 Functional one 仍为 1（不刷 5 个材料）', () => {
    grantAllPartsOnce();
    grantAllPartsOnce(); // 第二次不重复累加
    const inv = loadInventoryRaw()!;
    for (const p of OFFICIAL_PARTS) expect(getCount(inv, p, 1)).toBe(1);
    for (const m of OFFICIAL_MOVEMENTS) expect(getCount(inv, m, 1)).toBe(1);
  });

  it('T24. grant 后无「白送 5 材料」：任一 Functional available < 5 → canFuse 均 false（不能靠 grant 直接合成）', () => {
    grantAllPartsOnce();
    const inv = loadInventoryRaw()!;
    for (const p of OFFICIAL_PARTS) {
      const r = canFuse(inv, p, 1, null);
      expect(r.available).toBeLessThan(5); // 各仅 1
      expect(r.ok).toBe(false);
    }
  });
});
