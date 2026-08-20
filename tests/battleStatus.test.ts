/**
 * Queue Q06-HUD-F1｜双方实时战斗状态合同 targeted test
 *
 * 覆盖 Q06-HUD-F1 验收：
 * 1. 初始 status.hp === maxHp（直读真实 vehicle.maxHp，不在 UI 重算）；
 * 2. weapon damage 后对应 hp 实时下降（真实 ramHead 直击链路，80 伤害）；
 * 3. A/B 完全独立（只 B 扣血时 A 不变）；
 * 4. Battle End 后 status 与 result.hpA/hpB 一致；
 * 5. Matter / Planck 两套 Runtime 均可读（同一引擎中立合同）。
 */
import { describe, it, expect } from 'vitest';
import { createRegistry } from '../src/core/content';
import { BattleOrchestrator } from '../src/battle/battleOrchestrator';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import type { BattleConfig } from '../src/battle/battleContract';
import type { BuildSnapshot } from '../src/core/types';

const registry = createRegistry();

function wheels() {
  return [
    { hardpointId: 'rear', defId: 'wheelStd' },
    { hardpointId: 'front', defId: 'wheelStd' },
  ];
}

function ramBuild(id: string): BuildSnapshot {
  return {
    id,
    bodyDefId: 'boxBody',
    quality: 1,
    movements: wheels(),
    functionals: [{ hardpointId: 'front', defId: 'ramHead' }],
  };
}

function plainBuild(id: string): BuildSnapshot {
  return { id, bodyDefId: 'boxBody', quality: 1, movements: wheels(), functionals: [] };
}

/** 对撞配置（隔离 Impact，只走 Weapon 直击；参考 A2D-W1 结构） */
const RAM_CONFIG: BattleConfig = {
  spawnA: { x: 400, y: 640, facing: 1 },
  spawnB: { x: 1200, y: 640, facing: -1 },
  settleToGround: true,
  autoDrive: true,
  impact: { threshold: 999 },
};

/** step 直到 B 受到一次 weapon damage（hp 下降）或达到上限 */
function stepUntilBDamaged(
  step: (dt: number) => void,
  readHpB: () => number,
  maxHpB: number,
  maxSteps = 1500,
): number {
  for (let i = 0; i < maxSteps; i++) {
    step(1000 / 60);
    if (readHpB() < maxHpB) return i;
  }
  return -1;
}

describe('Q06-HUD-F1 BattleStatusSnapshot', () => {
  it('1a. Matter 初始：hp === maxHp（直读 vehicle），phase 复用正式 phase', () => {
    const o = new BattleOrchestrator(ramBuild('A'), plainBuild('B'), registry, {
      autoDrive: false,
    });
    const s = o.getBattleStatusSnapshot();
    expect(s.sideA.team).toBe('A');
    expect(s.sideB.team).toBe('B');
    expect(s.sideA.hp).toBe(o.vehicleA.maxHp);
    expect(s.sideA.maxHp).toBe(o.vehicleA.maxHp);
    expect(s.sideB.hp).toBe(o.vehicleB.maxHp);
    expect(s.sideB.maxHp).toBe(o.vehicleB.maxHp);
    expect(s.sideA.maxHp).toBe(1000); // boxBody 初始 HP（Build/Resolved 初始值）
    expect(s.phase).toBe(o.phase);
  });

  it('1b. Planck 初始：hp === maxHp，phase 复用正式 phase', () => {
    const o = new PlanckBattleOrchestrator(ramBuild('A'), plainBuild('B'), registry, {
      autoDrive: false,
    });
    const s = o.getBattleStatusSnapshot();
    expect(s.sideA.hp).toBe(o.vehicleA.maxHp);
    expect(s.sideA.maxHp).toBe(o.vehicleA.maxHp);
    expect(s.sideB.hp).toBe(o.vehicleB.maxHp);
    expect(s.sideB.maxHp).toBe(o.vehicleB.maxHp);
    expect(s.sideA.maxHp).toBe(1000);
    expect(s.phase).toBe(o.phase);
  });

  it('2a. Matter weapon damage 后 B 的 hp 实时下降（A/B 独立）', () => {
    const o = new BattleOrchestrator(ramBuild('A'), plainBuild('B'), registry, RAM_CONFIG);
    const hpB0 = o.vehicleB.hp; // 1000
    const steps = stepUntilBDamaged(
      (dt) => o.step(dt),
      () => o.vehicleB.hp,
      hpB0,
    );
    expect(steps).toBeGreaterThanOrEqual(0); // 真实接触产生 weapon damage

    const s = o.getBattleStatusSnapshot();
    expect(s.sideB.hp).toBe(o.vehicleB.hp); // 直读真实 vehicle
    expect(s.sideB.hp).toBeLessThan(hpB0); // 实时下降
    expect(s.sideB.hp).toBeCloseTo(hpB0 - 80, 6); // ramHead baseDamage 80
    expect(s.sideB.maxHp).toBe(1000);
    expect(s.sideA.hp).toBe(1000); // A 不受伤（A/B 独立）
  });

  it('2b. Planck weapon damage 后 B 的 hp 实时下降（A/B 独立）', () => {
    const o = new PlanckBattleOrchestrator(ramBuild('A'), plainBuild('B'), registry, RAM_CONFIG);
    const hpB0 = o.vehicleB.hp; // 1000
    const steps = stepUntilBDamaged(
      (dt) => o.step(dt),
      () => o.vehicleB.hp,
      hpB0,
    );
    expect(steps).toBeGreaterThanOrEqual(0);

    const s = o.getBattleStatusSnapshot();
    expect(s.sideB.hp).toBe(o.vehicleB.hp);
    expect(s.sideB.hp).toBeLessThan(hpB0);
    expect(s.sideB.hp).toBeCloseTo(hpB0 - 80, 6);
    expect(s.sideB.maxHp).toBe(1000);
    expect(s.sideA.hp).toBe(1000); // A 独立不变
  });

  it('3. Battle End 后 status 与 result.hpA/hpB 一致（Matter + Planck）', () => {
    // Matter：B.hp=0 → step 触发 detectEnd → result；status 与 result 一致
    const mo = new BattleOrchestrator(plainBuild('A'), plainBuild('B'), registry, {
      autoDrive: false,
    });
    mo.vehicleB.hp = 0;
    mo.step(1000 / 60);
    expect(mo.result).not.toBeNull();
    const ms = mo.getBattleStatusSnapshot();
    expect(ms.sideA.hp).toBe(mo.result!.hpA);
    expect(ms.sideB.hp).toBe(mo.result!.hpB);
    expect(ms.sideB.hp).toBe(0);
    expect(ms.phase).toBe('End');

    // Planck：同样
    const po = new PlanckBattleOrchestrator(plainBuild('A'), plainBuild('B'), registry, {
      autoDrive: false,
    });
    po.vehicleB.hp = 0;
    po.step(1000 / 60);
    expect(po.result).not.toBeNull();
    const ps = po.getBattleStatusSnapshot();
    expect(ps.sideA.hp).toBe(po.result!.hpA);
    expect(ps.sideB.hp).toBe(po.result!.hpB);
    expect(ps.sideB.hp).toBe(0);
    expect(ps.phase).toBe('End');
  });

  it('4. 战斗进行中 status 每步实时反映（连续读取一致且只读无副作用）', () => {
    const o = new PlanckBattleOrchestrator(ramBuild('A'), plainBuild('B'), registry, RAM_CONFIG);
    const before = o.getBattleStatusSnapshot();
    // 连续读两次无副作用（hp 不变）
    const again = o.getBattleStatusSnapshot();
    expect(again.sideA).toEqual(before.sideA);
    expect(again.sideB).toEqual(before.sideB);
    // step 过程中可随时读（不抛错）
    for (let i = 0; i < 30; i++) {
      o.step(1000 / 60);
      expect(() => o.getBattleStatusSnapshot()).not.toThrow();
    }
  });
});
