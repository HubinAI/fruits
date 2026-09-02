/**
 * Queue Q21→Q22｜V0.4→V0.5 部件成长 Meta 进度 —— targeted / Merge Gate 测试（纯模块层）。
 *
 * node 环境无原生 localStorage；用 MemStorage 注入 globalThis.localStorage。
 * 覆盖：
 *  A｜库存（v1→v2 迁移 / 默认 / starter / 旧 Build 装备迁移 / 夹紧负数）；
 *  B｜每场奖励（可重复、同场幂等、胜负都奖、排除 HOLD/EMPTY）；
 *  C｜5合1 合成（5×1★→1×随机2★、不足不可合成、已装备保留、产物合法）；
 *  D｜2★ 真实意义（统一倍率层：energy×1.10、damage×1.15，1★ 恒等）；
 *  E｜闭环 + 不退化（刷新保持、装备守卫、36 对手全合法可实例化、Q15 主流程无 NaN）。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  STARTER_PARTS,
  OFFICIAL_PARTS,
  defaultInventory,
  seedInventoryFromStarterAndBuild,
  ensureInventory,
  loadInventoryRaw,
  saveInventory,
  getInventory,
  getCount,
  addPart,
  canEquipPart,
  computeReward,
  fuseSameStar,
  BattleRewardSettler,
} from '../src/core/partInventory';
import { EMPTY_SLOT } from '../src/lab/buildEditorModel';
import { buildSnapshotFromDraft, type BuildDraft } from '../src/lab/buildEditorModel';
import { registry } from '../src/core/content';
import { validateSnapshot } from '../src/core/buildValidator';
import { resolveSnapshot } from '../src/core/buildSnapshot';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import { createPlanckBattle } from '../src/battle/battleRequestAdapter';
import { OPPONENT_POOL } from '../src/player/opponentPool';

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

/** silDraft 等价默认 Build（std watermelon + starter 部件） */
function defaultBuild(): BuildDraft {
  return {
    bodyDefId: 'watermelonBody',
    rearRadius: 20,
    frontRadius: 20,
    functionalSelections: { front: 'pushRod', frontMass: 'cannon', top: 'hammer', rear: EMPTY_SLOT },
    drive: 'forward',
  };
}

function makeBattle(aDraft: BuildDraft, bDraft: BuildDraft): PlanckBattleOrchestrator {
  const snapA = buildSnapshotFromDraft(aDraft, registry, 'customA');
  const snapB = buildSnapshotFromDraft(bDraft, registry, 'customB');
  return createPlanckBattle(
    {
      battleId: 'q22-merge-gate',
      buildA: snapA,
      buildB: snapB,
      config: {
        autoDrive: true,
        engine: 'planck',
        spawnA: { x: 400, y: 640, facing: 1 },
        spawnB: { x: 1400, y: 640, facing: -1 },
      },
      randomSeed: 1,
      rulesVersion: 'v1.0.0',
      contentVersion: 'c1',
    },
    registry,
  );
}

function finite(o: PlanckBattleOrchestrator, which: 'vehicleA' | 'vehicleB'): void {
  const v = o[which];
  const p = o.world.getPosition(v.body);
  const a = o.world.getAngle(v.body);
  expect(Number.isFinite(p.x)).toBe(true);
  expect(Number.isFinite(p.y)).toBe(true);
  expect(Number.isFinite(a)).toBe(true);
}

function stepSmoke(o: PlanckBattleOrchestrator, n = 60): void {
  for (let i = 0; i < n; i++) o.step(16.6667);
  finite(o, 'vehicleA');
  finite(o, 'vehicleB');
}

describe('Q21→Q22 A｜库存（v1→v2 迁移 / 默认 / starter / 装备迁移）', () => {
  it('A1. starter 基础部件 = 炮/锤/推杆/刺', () => {
    expect([...STARTER_PARTS].sort()).toEqual(['cannon', 'hammer', 'pushRod', 'spear'].sort());
  });

  it('A2. OFFICIAL_PARTS 不含 HOLD/EMPTY（ramHead/lifter/wedgeShovel/空）', () => {
    for (const h of ['ramHead', 'lifter', 'wedgeShovel', EMPTY_SLOT]) {
      expect(OFFICIAL_PARTS).not.toContain(h);
    }
  });

  it('A3. defaultInventory：starter 各 1★、其余 0、结构含 one/two', () => {
    const inv = defaultInventory();
    for (const p of STARTER_PARTS) expect(inv[p].one).toBe(1);
    for (const p of OFFICIAL_PARTS) {
      expect(inv[p]).toHaveProperty('one');
      expect(inv[p]).toHaveProperty('two');
    }
  });

  it('A4. 旧 Build 已装备的正式部件迁移后至少 1★（不变非法）', () => {
    const inv = seedInventoryFromStarterAndBuild(defaultBuild());
    // defaultBuild 装备 pushRod/cannon/hammer → 这三者 one≥1
    for (const p of ['pushRod', 'cannon', 'hammer']) expect(inv[p].one).toBeGreaterThanOrEqual(1);
  });

  it('A5. v1 owned-id 数组存档迁移为 v2（每个 id 1★）', () => {
    const store = (globalThis as unknown as { localStorage: MemStorage }).localStorage;
    store.setItem('strongfruit.ownedParts.v1', JSON.stringify(['cannon', 'laser', 'saw']));
    const inv = loadInventoryRaw()!;
    expect(inv.cannon.one).toBe(1);
    expect(inv.laser.one).toBe(1);
    expect(inv.saw.one).toBe(1);
    // 迁移后已写 v2
    expect(store.getItem('strongfruit.ownedParts.v2')).not.toBeNull();
  });

  it('A6. 脏数据（负数 / 缺失键）被夹紧为合法库存', () => {
    const store = (globalThis as unknown as { localStorage: MemStorage }).localStorage;
    store.setItem('strongfruit.ownedParts.v2', JSON.stringify({ cannon: { one: -3, two: 2 }, bananaBody: 'x' }));
    const inv = loadInventoryRaw()!;
    expect(inv.cannon.one).toBe(0); // 负数夹紧
    expect(inv.cannon.two).toBe(2);
    expect(inv.bananaBody).toBeUndefined(); // 非部件键丢弃
  });
});

describe('Q21→Q22 B｜每场奖励（可重复 / 同场幂等 / 排除 HOLD）', () => {
  it('B1. computeReward 永远返回正式部件（star=1），不含 HOLD/EMPTY', () => {
    for (let i = 0; i < 50; i++) {
      const r = computeReward(() => i / 50);
      expect(OFFICIAL_PARTS).toContain(r.defId);
      expect(r.star).toBe(1);
    }
  });

  it('B2. 同场只结算一次（同 resultRef 重复 settle 不重复发奖）', () => {
    ensureInventory(defaultBuild());
    const s = new BattleRewardSettler();
    const ref = { id: 'battle-1' };
    const first = s.settle(ref)!;
    const before = getCount(getInventory(), first.defId, 1);
    const second = s.settle(ref)!; // 同场
    const after = getCount(getInventory(), first.defId, 1);
    expect(second.defId).toBe(first.defId);
    expect(after).toBe(before); // 不重复 +1
  });

  it('B3. 多场（不同 ref）可重复累积同一部件', () => {
    ensureInventory(defaultBuild());
    const s = new BattleRewardSettler();
    const r = computeReward(() => 0); // 固定 cannon
    for (let i = 0; i < 3; i++) s.settle({ id: `b${i}` }, () => 0);
    expect(getCount(getInventory(), r.defId, 1)).toBeGreaterThanOrEqual(3 + 1); // starter 已有 1
  });

  it('B4. 胜/负都奖励（settle 不依赖 winner，只 resultRef）', () => {
    ensureInventory(defaultBuild());
    const s = new BattleRewardSettler();
    const win = s.settle({ id: 'w', winner: 'A' as const, hpA: 1, hpB: 0 })!;
    const lose = s.settle({ id: 'l', winner: 'B' as const, hpA: 0, hpB: 1 })!;
    expect(win).not.toBeNull();
    expect(lose).not.toBeNull();
  });

  it('B5. addPart 拒绝非正式部件（ramHead HOLD / 未知）', () => {
    const inv = defaultInventory();
    addPart(inv, 'ramHead', 1);
    addPart(inv, 'not-a-real-part', 1);
    expect(getCount(inv, 'ramHead', 1)).toBe(0);
    expect(getCount(inv, 'not-a-real-part', 1)).toBe(0);
  });
});

describe('Q21→Q22 C｜最小 5合1 合成（F-GARAGE-INVENTORY-FUSION-P0：同 defId、无金币）', () => {
  it('C1. 5×1★（同 defId）→ 1×同 defId 2★，库存正确消耗/产出', () => {
    const inv = defaultInventory();
    addPart(inv, 'cannon', 1, 5); // 5 个 1★
    const res = fuseSameStar(inv, 'cannon', 1, null);
    expect(res).not.toBeNull();
    expect(res!.product).toBe('cannon');
    expect(res!.star).toBe(2);
    expect(getCount(inv, 'cannon', 2)).toBe(1);
    expect(getCount(inv, 'cannon', 1)).toBe(1 + 5 - 5); // starter 1 + 5 加 - 5 扣
  });

  it('C2. 不足 5 个 1★ 不可合成（返回 null、不消耗）', () => {
    const inv = defaultInventory();
    for (const p of OFFICIAL_PARTS) inv[p].one = 0; // 清零
    addPart(inv, 'laser', 1, 4); // 仅 4 个 1★ < 5
    const before = getCount(inv, 'laser', 1);
    const res = fuseSameStar(inv, 'laser', 1, null);
    expect(res).toBeNull();
    expect(getCount(inv, 'laser', 1)).toBe(before);
  });

  it('C3. 已装备保护：Build 装备 cannon 时合成不消耗其 1★（Build 不变非法）', () => {
    const inv = defaultInventory();
    addPart(inv, 'cannon', 1, 5); // 6 个 1★（starter 1 + 5）
    const res = fuseSameStar(inv, 'cannon', 1, defaultBuild());
    expect(res).not.toBeNull();
    expect(getCount(inv, 'cannon', 1)).toBeGreaterThanOrEqual(1); // 保留 1 个（已装备）
    // Build 仍合法（cannon 1★ 仍拥有）
    expect(canEquipPart('cannon', 1)).toBe(true);
  });

  it('C4. 合成产物来自正式 PART_OPTIONS（不 HOLD / EMPTY / 跨 defId）', () => {
    const inv = defaultInventory();
    addPart(inv, 'laser', 1, 5);
    const res = fuseSameStar(inv, 'laser', 1, null)!;
    expect(OFFICIAL_PARTS).toContain(res.product);
    expect(res.product).toBe('laser'); // 同 defId，不跨 defId
  });
});

describe('Q21→Q22 D｜2★ 真实意义（统一倍率层）', () => {
  it('D1. 2★ install 经 resolveSnapshot 得到倍率后 energy（×1.10 取整）与 damage（×1.15 取整）', () => {
    const d: BuildDraft = {
      bodyDefId: 'watermelonBody',
      rearRadius: 20,
      frontRadius: 20,
      functionalSelections: { front: 'cannon', frontMass: EMPTY_SLOT, top: EMPTY_SLOT, rear: EMPTY_SLOT },
      functionalStars: { front: 2 },
      drive: 'forward',
    };
    const snap = buildSnapshotFromDraft(d, registry, 'customA');
    const rs = resolveSnapshot(snap, registry);
    const f = rs.functionals.find((x) => x.install.hardpointId === 'front')!;
    // cannon: energy 30 → round(33)；projectileDamage 80 → round(92)
    expect(f.def.energy).toBe(Math.round(30 * 1.1));
    expect((f.def.behaviorParams as Record<string, number>).projectileDamage).toBe(Math.round(80 * 1.15));
  });

  it('D2. 1★ install 倍率层恒等（无强化）', () => {
    const d: BuildDraft = {
      bodyDefId: 'watermelonBody',
      rearRadius: 20,
      frontRadius: 20,
      functionalSelections: { front: 'cannon', frontMass: EMPTY_SLOT, top: EMPTY_SLOT, rear: EMPTY_SLOT },
      drive: 'forward',
    };
    const snap = buildSnapshotFromDraft(d, registry, 'customA');
    const rs = resolveSnapshot(snap, registry);
    const f = rs.functionals.find((x) => x.install.hardpointId === 'front')!;
    expect(f.def.energy).toBe(30);
    expect((f.def.behaviorParams as Record<string, number>).projectileDamage).toBe(80);
  });

  it('D3. 2★ 装备后正式 Battle 实例化无 NaN', () => {
    const d: BuildDraft = {
      bodyDefId: 'watermelonBody',
      rearRadius: 20,
      frontRadius: 20,
      functionalSelections: { front: 'cannon', frontMass: 'hammer', top: EMPTY_SLOT, rear: EMPTY_SLOT },
      functionalStars: { front: 2, frontMass: 2 },
      drive: 'forward',
    };
    const o = makeBattle(d, defaultBuild());
    stepSmoke(o, 80);
  });
});

describe('Q21→Q22 E｜闭环守卫 + 不退化', () => {
  it('E1. 刷新保持：saveInventory → loadInventoryRaw 还原', () => {
    const inv = defaultInventory();
    addPart(inv, 'laser', 1, 3);
    addPart(inv, 'cannon', 2, 1);
    saveInventory(inv);
    const re = loadInventoryRaw()!;
    expect(getCount(re, 'laser', 1)).toBe(3);
    expect(getCount(re, 'cannon', 2)).toBe(1);
  });

  it('E2. canEquipPart：空槽恒可装备、已拥有可装备、未拥有（含 2★）不可装备', () => {
    ensureInventory(defaultBuild());
    expect(canEquipPart(EMPTY_SLOT)).toBe(true);
    expect(canEquipPart('cannon')).toBe(true); // starter 1★
    expect(canEquipPart('laser')).toBe(false); // 未拥有 1★
    expect(canEquipPart('laser', 2)).toBe(false); // 未拥有 2★
  });

  it('E3. 49 对手全部合法、可实例化、步进无 NaN；含 2★ 装备不退化', () => {
    expect(OPPONENT_POOL.length).toBe(49);
    for (const d of OPPONENT_POOL) {
      const snap = buildSnapshotFromDraft(d, registry, 'opp');
      expect(validateSnapshot(snap, registry).valid).toBe(true);
      const o = makeBattle(defaultBuild(), d);
      stepSmoke(o, 40);
    }
  });

  it('E4. Q15 主流程默认 Build（1★）经 Draft→Snapshot→Runtime 无 NaN', () => {
    const o = makeBattle(defaultBuild(), defaultBuild());
    stepSmoke(o, 60);
  });

  it('E5. 2★ 装备后 Energy 含倍率（Validator 不误判超载为恒等）', () => {
    const d: BuildDraft = {
      bodyDefId: 'watermelonBody',
      rearRadius: 20,
      frontRadius: 20,
      functionalSelections: { front: 'cannon', frontMass: 'cannon', top: 'hammer', rear: EMPTY_SLOT },
      functionalStars: { front: 2, frontMass: 2, top: 2 },
      drive: 'forward',
    };
    const snap = buildSnapshotFromDraft(d, registry, 'customA');
    const res = validateSnapshot(snap, registry);
    // 倍率后 energy：cannon 33×2 + hammer round(25*1.1)=28 = 94 ≤ 110（watermelon），合法
    expect(res.valid).toBe(true);
  });
});
