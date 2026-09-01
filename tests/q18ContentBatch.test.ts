/**
 * Queue Q18 / Q19｜V0.3 战斗内容铺量批次 —— targeted test（纯模块层）。
 *
 * 覆盖：
 * A｜Q18 新 Body（菠萝 / 椰子）：注册、标准 4 挂点、Energy=100、几何身份
 *    （菠萝高窄+顶挂点更高；椰子短沉+更抗推），且无特殊规则/隐藏属性；
 * B｜Q19 对手池 24→36：全部合法、无重复、4 Body 均覆盖、stationary 20%~30%、不含 HOLD；
 * D｜V0.3 技术 Merge Gate：4 Body 均能实例化正式 Planck Battle（初始无 NaN）；
 *    49 套对手全部可实例化；代表性配置（4 Body × forward/stationary × 12/20/26 ×
 *    远程/近战/Gadget）最小 Battle smoke（步进无 NaN / 缺 def / 非法 hardpoint）。
 *
 * 注：本测试只证明技术链成立，不证明「好不好玩」。
 */
import { describe, it, expect } from 'vitest';
import { createRegistry } from '../src/core/content';
import {
  buildSnapshotFromDraft,
  EMPTY_SLOT,
  type BuildDraft,
} from '../src/lab/buildEditorModel';
import { validateSnapshot, computeEnergy } from '../src/core/buildValidator';
import { OPPONENT_POOL } from '../src/player/opponentPool';
import { PART_OPTIONS } from '../src/core/partOptions';
import { createPlanckBattle } from '../src/battle/battleRequestAdapter';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import type { BodyDef } from '../src/core/types';

const registry = createRegistry();
const PART_OPTION_VALUES = new Set(PART_OPTIONS.map((p) => p.v));
const HOLD_PARTS = new Set(['wedgeShovel', 'ramHead', 'lifter']);

function bodyDims(b: BodyDef): { w: number; h: number } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const c of b.colliders) {
    if (c.shape === 'box') {
      const ox = c.offset?.x ?? 0;
      const oy = c.offset?.y ?? 0;
      const hw = (c.width ?? 0) / 2;
      const hh = (c.height ?? 0) / 2;
      minX = Math.min(minX, ox - hw); maxX = Math.max(maxX, ox + hw);
      minY = Math.min(minY, oy - hh); maxY = Math.max(maxY, oy + hh);
    } else {
      for (const v of c.vertices ?? []) {
        minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
        minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
      }
    }
  }
  return { w: maxX - minX, h: maxY - minY };
}

function topY(bodyId: string): number {
  const b = registry.bodies.get(bodyId)!;
  return b.functionalHardpoints.find((h) => h.id === 'top')!.localPosition.y;
}

function makeBattle(aDraft: BuildDraft, bDraft: BuildDraft): PlanckBattleOrchestrator {
  const snapA = buildSnapshotFromDraft(aDraft, registry, 'customA')!;
  const snapB = buildSnapshotFromDraft(bDraft, registry, 'customB')!;
  return createPlanckBattle(
    {
      battleId: 'merge-gate',
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

const PLAYER_DRAFT: BuildDraft = {
  bodyDefId: 'watermelonBody',
  rearRadius: 20,
  frontRadius: 20,
  functionalSelections: {
    front: 'cannon',
    frontMass: 'machineGun',
    top: 'hammer',
    rear: 'thruster',
  },
  drive: 'forward',
};

function finite2(o: PlanckBattleOrchestrator, which: 'vehicleA' | 'vehicleB'): void {
  const v = o[which];
  const p = o.world.getPosition(v.body);
  const a = o.world.getAngle(v.body);
  expect(Number.isFinite(p.x)).toBe(true);
  expect(Number.isFinite(p.y)).toBe(true);
  expect(Number.isFinite(a)).toBe(true);
}

describe('Q18 新 Body（菠萝 / 椰子）', () => {
  const fb = registry.bodies.get('pineappleBody')!;
  const cb = registry.bodies.get('coconutBody')!;
  const wb = registry.bodies.get('watermelonBody')!;
  const bb = registry.bodies.get('bananaBody')!;

  it('A1. 两新 Body 已注册且进入正常 Body 集', () => {
    expect(fb).toBeDefined();
    expect(cb).toBeDefined();
    expect(registry.bodies.has('pineappleBody')).toBe(true);
    expect(registry.bodies.has('coconutBody')).toBe(true);
  });

  it('A2. 标准 4 Functional hardpoints（front/frontMass/top/rear）+ ≥2 movement', () => {
    for (const b of [fb, cb] as BodyDef[]) {
      const ids = b.functionalHardpoints.map((h) => h.id).sort();
      expect(ids).toEqual(['front', 'frontMass', 'rear', 'top']);
      expect(b.movementHardpoints.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('A3. Energy capacity = 100', () => {
    expect(fb.energyCapacity).toBe(100);
    expect(cb.energyCapacity).toBe(100);
  });

  it('A4. 菠萝：高且窄（height > width），且顶挂点明显更高（y 更负）', () => {
    const d = bodyDims(fb);
    expect(d.h).toBeGreaterThan(d.w); // 高窄
    expect(topY('pineappleBody')).toBeLessThan(topY('watermelonBody'));
    expect(topY('pineappleBody')).toBeLessThan(topY('bananaBody'));
    expect(topY('pineappleBody')).toBeLessThan(topY('coconutBody'));
  });

  it('A5. 椰子：明显更沉（baseMass > 西瓜）且更短（height < 西瓜/香蕉）', () => {
    expect(cb.baseMass).toBeGreaterThan(wb.baseMass);
    expect(bodyDims(cb).h).toBeLessThan(bodyDims(wb).h);
    expect(bodyDims(cb).h).toBeLessThan(bodyDims(bb).h);
  });

  it('A6. 两新 Body 作玩家 Build 通过 Validator（无特殊规则/隐藏属性）', () => {
    const fbDraft: BuildDraft = {
      bodyDefId: 'pineappleBody',
      rearRadius: 20,
      frontRadius: 20,
      functionalSelections: { front: 'cannon', frontMass: 'machineGun', top: 'hammer', rear: EMPTY_SLOT },
      drive: 'forward',
    };
    const cbDraft: BuildDraft = {
      bodyDefId: 'coconutBody',
      rearRadius: 20,
      frontRadius: 20,
      functionalSelections: { front: 'cannon', frontMass: 'machineGun', top: 'hammer', rear: EMPTY_SLOT },
      drive: 'forward',
    };
    for (const d of [fbDraft, cbDraft]) {
      const snap = buildSnapshotFromDraft(d, registry, 'customA')!;
      const res = validateSnapshot(snap, registry);
      expect(res.valid, `${d.bodyDefId}: ${res.errors.join('; ')}`).toBe(true);
    }
  });
});

describe('Q19 对手池 24→36（R1 → 49）', () => {
  it('B1. 共 49 套（R1 新增 13），且全部通过 Validator + Energy≤容量', () => {
    expect(OPPONENT_POOL.length).toBe(49);
    for (const d of OPPONENT_POOL) {
      const snap = buildSnapshotFromDraft(d, registry, 'customB')!;
      const res = validateSnapshot(snap, registry);
      expect(res.valid, `${d.bodyDefId}: ${res.errors.join('; ')}`).toBe(true);
      const energy = computeEnergy(snap, registry).energy;
      const cap = registry.bodies.get(d.bodyDefId)!.energyCapacity;
      expect(energy).toBeLessThanOrEqual(cap);
    }
  });

  it('B2. 无完全重复 Build（body + 轮径 + selections + drive 唯一）', () => {
    const keys = OPPONENT_POOL.map((d) =>
      JSON.stringify({
        b: d.bodyDefId,
        r: d.rearRadius,
        f: d.frontRadius,
        s: d.functionalSelections,
        dr: d.drive ?? 'forward',
      }),
    );
    expect(new Set(keys).size).toBe(OPPONENT_POOL.length);
  });

  it('B3. 6 种 Body 均覆盖（R1 新增 heavyBox/tallBody），stationary 比例 20%~30%', () => {
    const bodies = new Set(OPPONENT_POOL.map((d) => d.bodyDefId));
    expect(bodies.has('watermelonBody')).toBe(true);
    expect(bodies.has('bananaBody')).toBe(true);
    expect(bodies.has('pineappleBody')).toBe(true);
    expect(bodies.has('coconutBody')).toBe(true);
    expect(bodies.has('heavyBox')).toBe(true); // R1 重型
    expect(bodies.has('tallBody')).toBe(true); // R1 高重心
    const sta = OPPONENT_POOL.filter((d) => d.drive === 'stationary').length;
    const ratio = sta / OPPONENT_POOL.length;
    expect(ratio).toBeGreaterThanOrEqual(0.2);
    expect(ratio).toBeLessThanOrEqual(0.3);
  });

  it('B4. 只使用正式 PART_OPTIONS（不含 HOLD 内容）', () => {
    for (const d of OPPONENT_POOL) {
      for (const v of Object.values(d.functionalSelections)) {
        if (v === EMPTY_SLOT) continue;
        expect(PART_OPTION_VALUES.has(v)).toBe(true);
        expect(HOLD_PARTS.has(v)).toBe(false);
      }
    }
  });
});

describe('D｜V0.3 技术 Merge Gate', () => {
  it('D1. 4 种 Body 均能实例化正式 Planck Battle（双方同 Body，初始无 NaN）', () => {
    for (const bodyId of ['watermelonBody', 'bananaBody', 'pineappleBody', 'coconutBody']) {
      const o = makeBattle({ ...PLAYER_DRAFT, bodyDefId: bodyId }, { ...PLAYER_DRAFT, bodyDefId: bodyId });
      expect(o.vehicleA).toBeDefined();
      expect(o.vehicleB).toBeDefined();
      finite2(o, 'vehicleA');
      finite2(o, 'vehicleB');
    }
  });

  it('D2. 全部 49 套对手能实例化正式 Planck Battle（无缺 def / 非法 hardpoint / NaN）', () => {
    for (const d of OPPONENT_POOL) {
      let o: PlanckBattleOrchestrator;
      expect(() => {
        o = makeBattle(PLAYER_DRAFT, d);
      }).not.toThrow();
      o = makeBattle(PLAYER_DRAFT, d);
      const pa = o.world.getPosition(o.vehicleA.body);
      const pb = o.world.getPosition(o.vehicleB.body);
      expect(Number.isFinite(pa.x) && Number.isFinite(pa.y)).toBe(true);
      expect(Number.isFinite(pb.x) && Number.isFinite(pb.y)).toBe(true);
    }
  });

  it('D3. 代表性配置最小 Battle smoke（4 Body × forward/stationary × 12/20/26 × 远程/近战/Gadget）', () => {
    const rep = (
      bodyDefId: string,
      rear: number,
      front: number,
      sel: Record<string, string>,
      drive?: 'forward' | 'stationary',
    ): BuildDraft => ({
      bodyDefId,
      rearRadius: rear,
      frontRadius: front,
      functionalSelections: { front: EMPTY_SLOT, frontMass: EMPTY_SLOT, top: EMPTY_SLOT, rear: EMPTY_SLOT, ...sel },
      drive,
    });

    const reps: BuildDraft[] = [
      // 4 Body × 远程 / 近战 / Gadget 覆盖；轮径 12/20/26 均出现；forward + stationary 均出现
      rep('pineappleBody', 12, 12, { front: 'shotgun', top: 'saw' }), // 近战·双小·前进
      rep('pineappleBody', 26, 26, { front: 'machineGun', frontMass: 'cannon' }, 'stationary'), // 远程·双大·停驻
      rep('coconutBody', 20, 20, { front: 'pushRod', rear: 'thruster' }), // Gadget·双标准·前进
      rep('coconutBody', 26, 12, { front: 'laser', frontMass: 'cannon' }, 'stationary'), // 远程·前小后大·停驻
      rep('watermelonBody', 12, 26, { front: 'saw', frontMass: 'shotgun' }), // 近战·前大后小·前进
      rep('watermelonBody', 20, 20, { front: 'machineGun', frontMass: 'cannon' }), // 远程·双标准·前进
      rep('bananaBody', 26, 12, { front: 'pushRod', frontMass: 'machineGun' }), // Gadget·前小后大·前进
      rep('bananaBody', 12, 12, { front: 'shotgun', frontMass: 'hammer', rear: 'thruster' }), // 混合·双小·前进
    ];

    expect(reps.length).toBeGreaterThanOrEqual(8);
    for (const d of reps) {
      const o = makeBattle(PLAYER_DRAFT, d);
      for (let s = 0; s < 120; s++) {
        o.step(1000 / 60);
        finite2(o, 'vehicleA');
        finite2(o, 'vehicleB');
      }
    }
  });
});
