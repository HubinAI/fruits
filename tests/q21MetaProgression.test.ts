/**
 * Queue Q21｜V0.4 Meta V0：获得部件 → 回车库 → 再战 —— targeted / Merge Gate 测试（纯模块层）。
 *
 * node 环境无原生 localStorage；沿用 q15PlayerLoop 的 MemStorage 注入 globalThis.localStorage。
 * 覆盖：
 *  A｜最小部件库存：starter 初始、旧存档迁移、持久化、Reward Pool 排除 HOLD/EMPTY；
 *  B｜每场奖励：随机挑 1 未拥有、全部拥有→collected-all、同场只结算一次、多场直到收集完；
 *  C｜闭环守卫：canEquipPart、刷新后 owned 保留；
 *  D｜Merge Gate：新奖励部件可进入 Build→Preview→正式 Battle（无 NaN）；36 对手全部合法且可实例化。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  STARTER_PARTS,
  OFFICIAL_PARTS,
  ensureOwnedParts,
  loadOwnedRaw,
  getOwnedParts,
  isOwned,
  canEquipPart,
  addOwnedPart,
  computeReward,
  BattleRewardSettler,
} from '../src/core/partInventory';
import { PART_OPTIONS } from '../src/core/partOptions';
import { buildSnapshotFromDraft, EMPTY_SLOT, type BuildDraft } from '../src/lab/buildEditorModel';
import { registry } from '../src/core/content';
import { validateSnapshot } from '../src/core/buildValidator';
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
  const snapA = buildSnapshotFromDraft(aDraft, registry, 'customA')!;
  const snapB = buildSnapshotFromDraft(bDraft, registry, 'customB')!;
  return createPlanckBattle(
    {
      battleId: 'q21-merge-gate',
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

describe('Q21 A｜最小部件库存', () => {
  it('A1. starter 基础部件 = 炮/锤/推杆/刺', () => {
    expect([...STARTER_PARTS].sort()).toEqual(['cannon', 'hammer', 'pushRod', 'spear'].sort());
  });

  it('A2. 正式 Functional 集排除 EMPTY 与 HOLD/prototype（ramHead/lifter/wedgeShovel）', () => {
    const vals = PART_OPTIONS.map((p) => p.v);
    expect(vals).toContain(EMPTY_SLOT);
    for (const h of ['ramHead', 'lifter', 'wedgeShovel']) {
      expect(OFFICIAL_PARTS).not.toContain(h);
    }
    expect(OFFICIAL_PARTS).not.toContain(EMPTY_SLOT);
    // OFFICIAL = PART_OPTIONS 去 EMPTY
    expect(OFFICIAL_PARTS).toEqual(vals.filter((v) => v !== EMPTY_SLOT));
  });

  it('A3. 新存档初始化仅含 starter 且落盘', () => {
    const owned = ensureOwnedParts(defaultBuild());
    expect([...owned].sort()).toEqual([...STARTER_PARTS].sort());
    expect(loadOwnedRaw()).not.toBeNull(); // 已落盘（非仅内存回退）
  });

  it('A4. 旧存档已装备的正式部件首次迁移一并入 owned（旧 Build 不变非法）', () => {
    const legacy: BuildDraft = {
      bodyDefId: 'bananaBody',
      rearRadius: 26,
      frontRadius: 26,
      functionalSelections: { front: 'laser', frontMass: 'saw', top: 'shotgun', rear: EMPTY_SLOT },
      drive: 'forward',
    };
    const owned = ensureOwnedParts(legacy);
    for (const p of ['laser', 'saw', 'shotgun']) expect(owned).toContain(p); // 迁移已装备
    // starter 仍保留
    for (const p of STARTER_PARTS) expect(owned).toContain(p);
  });

  it('A5. 无存档时 loadOwnedRaw 返回 null', () => {
    expect(loadOwnedRaw()).toBeNull();
  });
});

describe('Q21 B｜每场获得一个新部件', () => {
  it('B1. 从「未拥有正式部件」中随机挑 1（rng=0 → 首个未拥有）', () => {
    ensureOwnedParts(defaultBuild());
    const out = computeReward(getOwnedParts(), () => 0);
    expect(out.collectedAll).toBe(false);
    expect(out.awarded).toBe('laser'); // starter 之后首个正式部件
    expect(OFFICIAL_PARTS).toContain(out.awarded);
  });

  it('B2. 全部拥有 → collected-all，不发重复件', () => {
    // 模拟全收集
    for (const p of OFFICIAL_PARTS) addOwnedPart(p);
    const out = computeReward(getOwnedParts());
    expect(out.awarded).toBeNull();
    expect(out.collectedAll).toBe(true);
  });

  it('B3. 同场 Battle 只结算一次（同 result ref 返回缓存，owned 仅 +1）', () => {
    ensureOwnedParts(defaultBuild());
    const s = new BattleRewardSettler();
    const ref = { phase: 'End' };
    const first = s.settle(ref);
    const second = s.settle(ref); // 同场重复
    expect(second).toBe(first); // 返回缓存
    expect(first?.awarded).not.toBeNull();
    // owned 只增加 1 个
    expect(getOwnedParts().length).toBe(STARTER_PARTS.length + 1);
    // canEquipPart 对新解锁件为 true
    expect(canEquipPart(first!.awarded!)).toBe(true);
  });

  it('B4. 多场直到全部收集：每场恰好 +1，不重复、不超发', () => {
    ensureOwnedParts(defaultBuild());
    const s = new BattleRewardSettler();
    const rng = () => 0;
    const refs = Array.from({ length: OFFICIAL_PARTS.length }, () => ({}));
    let awarded = 0;
    for (const ref of refs) {
      const out = s.settle(ref, rng);
      if (out?.awarded) awarded++;
    }
    // 初始未拥有数 = 全部 - starter
    expect(awarded).toBe(OFFICIAL_PARTS.length - STARTER_PARTS.length);
    expect(getOwnedParts().length).toBe(OFFICIAL_PARTS.length); // 全部收集
    // 第 N+1 场（新 ref）→ collected-all
    const extra = s.settle({}, rng);
    expect(extra?.awarded).toBeNull();
    expect(extra?.collectedAll).toBe(true);
    expect(getOwnedParts().length).toBe(OFFICIAL_PARTS.length); // 仍不超发
  });

  it('B5. addOwnedPart 拒绝非正式部件', () => {
    ensureOwnedParts(defaultBuild());
    const before = getOwnedParts().length;
    addOwnedPart('ramHead'); // HOLD
    addOwnedPart('not-a-real-part');
    expect(getOwnedParts().length).toBe(before);
  });
});

describe('Q21 C｜闭环守卫', () => {
  it('C1. canEquipPart：空槽恒可装备、已拥有可装备、未拥有不可装备', () => {
    ensureOwnedParts(defaultBuild());
    expect(canEquipPart(EMPTY_SLOT)).toBe(true);
    expect(canEquipPart('cannon')).toBe(true); // starter
    expect(canEquipPart('laser')).toBe(false); // 未拥有
  });

  it('C2. 结算后 owned 持久化，模拟刷新（再次 ensureOwnedParts）仍保留', () => {
    ensureOwnedParts(defaultBuild());
    const s = new BattleRewardSettler();
    const out = s.settle({ phase: 'End' }, () => 0);
    expect(out?.awarded).toBe('laser');
    // 落盘校验
    expect(loadOwnedRaw()).toContain('laser');
    // 模拟刷新：重新读取（localStorage 不变）
    const reloaded = ensureOwnedParts(defaultBuild());
    expect(reloaded).toContain('laser'); // 已拥有保留，未回退到仅 starter
    expect(isOwned('laser')).toBe(true);
  });
});

describe('Q21 D｜V0.4 Merge Gate', () => {
  it('D7. 新奖励部件可进入 Build → 正式 Battle（无 NaN / 缺 def）', () => {
    ensureOwnedParts(defaultBuild());
    const s = new BattleRewardSettler();
    const out = s.settle({ phase: 'End' }, () => 0); // 解锁 laser
    expect(out?.awarded).toBe('laser');
    expect(canEquipPart('laser')).toBe(true); // 进入 Build 前已可装备
    const draft: BuildDraft = {
      bodyDefId: 'watermelonBody',
      rearRadius: 20,
      frontRadius: 20,
      functionalSelections: { front: 'laser', frontMass: 'cannon', top: 'hammer', rear: EMPTY_SLOT },
      drive: 'forward',
    };
    const snap = buildSnapshotFromDraft(draft, registry, 'customA')!;
    expect(validateSnapshot(snap, registry).valid).toBe(true); // 合法 Build
    const o = makeBattle(draft, defaultBuild());
    for (let i = 0; i < 60; i++) {
      o.step(1000 / 60);
      finite(o, 'vehicleA');
      finite(o, 'vehicleB');
    }
  });

  it('D8. 36 对手全部合法且可实例化正式 Battle（无 NaN / 缺 def / 非法 hardpoint）', () => {
    expect(OPPONENT_POOL.length).toBe(36);
    const player = defaultBuild();
    for (let i = 0; i < OPPONENT_POOL.length; i++) {
      const opp = OPPONENT_POOL[i];
      const snap = buildSnapshotFromDraft(opp, registry, `opp${i}`)!;
      const vr = validateSnapshot(snap, registry);
      expect(vr.valid, `opp${i} 非法: ${vr.errors.join('; ')}`).toBe(true);
      const o = makeBattle(player, opp);
      for (let s = 0; s < 12; s++) {
        o.step(1000 / 60);
        finite(o, 'vehicleA');
        finite(o, 'vehicleB');
      }
    }
  });
});
