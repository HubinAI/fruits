/**
 * Queue F-02W-A｜落地 Ram Weapon 接触阈值 0.5（只实现，不提交）
 *
 * 正式 Runtime 验收（全部使用正式 BattleOrchestrator + 当前 ContactRouter，
 * world.setCollisionHandlers 仅包裹记录，start/active/end 完整转发）：
 * 1. Ram Light vs Body-only Heavy（autoDrive=true）：
 *    - 真实 ramHead→body collisionStart 发生、relVel > 0.5；
 *    - Weapon 直伤只结算一次 80；Impact（正式阈值 0.75）与 Weapon 可同时成立，
 *      正常攻击 relVel~1.1 触发微量 Impact（双方各半）；
 * 2. 低速擦碰对照（±0.25，autoDrive=false）：
 *    - 真实 ramHead→body collisionStart 发生、relVel < 0.5；
 *    - defender HP 保持不变。
 */
import { describe, it, expect } from 'vitest';
import Matter from 'matter-js';
import { createRegistry } from '../src/core/content';
import type { BuildSnapshot } from '../src/core/types';
import { getMeta, FIXED_DT, type ContactEvent } from '../src/physics/adapter';
import { BattleOrchestrator } from '../src/battle/battleOrchestrator';
import { WEAPON_CONTACT_THRESHOLD } from '../src/battle/contactRouter';
import { getPreset } from '../src/lab/presets';
import type { Vehicle } from '../src/battle/vehicleAssembly';

const registry = createRegistry();
const lightSnapshot = getPreset('lightVehicle')!.build();
const heavySnapshot = getPreset('heavyVehicle')!.build();
const bodyOnlyLight: BuildSnapshot = { ...lightSnapshot, functionals: [] };
const bodyOnlyHeavy: BuildSnapshot = { ...heavySnapshot, functionals: [] };

interface ScenarioResult {
  relVel: number;
  partIdA: string;
  partIdB: string;
  hpA: number;
  hpB: number;
  lastDamage: { damage: number; target: string } | null;
  lastImpact: { damage: number } | null;
}

function runScenario(
  buildA: BuildSnapshot,
  buildB: BuildSnapshot,
  cfg: {
    autoDrive: boolean;
    lowSpeedVx?: number;
    spawnA?: { x: number; y: number; facing: 1 | -1 };
    spawnB?: { x: number; y: number; facing: 1 | -1 };
  },
): ScenarioResult {
  const orch = new BattleOrchestrator(buildA, buildB, registry, {
    autoDrive: cfg.autoDrive,
    spawnA: cfg.spawnA ?? { x: 400, y: 640, facing: 1 },
    spawnB: cfg.spawnB ?? { x: 900, y: 640, facing: -1 },
  });

  if (cfg.lowSpeedVx !== undefined) {
    const setV = (v: Vehicle, vx: number): void => {
      Matter.Body.setVelocity(v.body, { x: vx, y: 0 });
      for (const w of v.wheels) Matter.Body.setVelocity(w.body, { x: vx, y: 0 });
      for (const p of v.parts) Matter.Body.setVelocity(p.body, { x: vx, y: 0 });
    };
    setV(orch.vehicleA, cfg.lowSpeedVx);
    setV(orch.vehicleB, -cfg.lowSpeedVx);
  }

  let ramHit: { relVel: number; partIdA: string; partIdB: string } | null = null;

  orch.world.setCollisionHandlers({
    onStart: (ev: ContactEvent) => {
      orch.router.handleContact(ev);
      const mA = getMeta(ev.bodyA);
      const mB = getMeta(ev.bodyB);
      const hostile =
        mA.kind === 'vehicle' && mB.kind === 'vehicle' && mA.team !== mB.team;
      if (!hostile) return;
      const partIdA = String(mA.partId ?? '');
      if (partIdA.startsWith('part:') && !ramHit) {
        ramHit = {
          relVel: ev.relativeVelocity,
          partIdA,
          partIdB: String(mB.partId ?? ''),
        };
      }
    },
    onActive: (ev: ContactEvent) => orch.router.handleContact(ev),
    onEnd: (ev: ContactEvent) => orch.router.handleContact(ev),
  });

  for (let i = 0; i < 1800 && !ramHit; i++) orch.step(FIXED_DT);

  expect(ramHit).not.toBeNull(); // 必须确认真实 ramHead→敌车 collisionStart 已发生
  const r = ramHit!;
  return {
    relVel: r.relVel,
    partIdA: r.partIdA,
    partIdB: r.partIdB,
    hpA: orch.vehicleA.hp,
    hpB: orch.vehicleB.hp,
    lastDamage: orch.router.debug.lastDamage
      ? { damage: orch.router.debug.lastDamage.damage, target: orch.router.debug.lastDamage.target }
      : null,
    lastImpact: orch.router.debug.lastImpact
      ? { damage: orch.router.debug.lastImpact.damage }
      : null,
  };
}

describe('F-02W-A · 场景1：Ram Light vs Body-only Heavy（自动驱动）', () => {
  it('relVel>0.5 触发 Weapon：weapon 只减 80，Impact(0.75) 微量可同时成立', () => {
    const r = runScenario(lightSnapshot, bodyOnlyHeavy, { autoDrive: true });

    console.log(
      `S1 relVel=${r.relVel.toFixed(3)} partA=${r.partIdA} partB=${r.partIdB} ` +
        `HP A=${r.hpA} HP B=${r.hpB} lastDamage=${r.lastDamage ? `dmg=${r.lastDamage.damage}->${r.lastDamage.target}` : 'null'} ` +
        `lastImpact=${r.lastImpact ? `dmg=${r.lastImpact.damage}` : 'null'}`,
    );

    // 真实 ramHead→body 接触（诊断值 1.114，阈值 0.5 之上）
    expect(r.partIdA).toBe('part:front');
    expect(r.partIdB).toBe('body');
    expect(r.relVel).toBeGreaterThan(WEAPON_CONTACT_THRESHOLD);
    // Weapon 触发：defender 只扣一次 baseDamage 80（weapon 直伤路径）
    expect(r.lastDamage?.damage).toBe(80);
    // Impact 与 Weapon 可同时成立（正式阈值 IMPACT_CONTACT_THRESHOLD=0.75，非旧值 6）：
    // 正常攻击 relVel~1.1 > 0.75 → 微量 Impact，双方各半；
    // 用正式公式 min(120, (relVel-0.75)*0.5) 精确推导预期，避免写死阈值。
    expect(r.lastImpact).not.toBeNull();
    const expectImpact = Math.min(120, Math.max(0, (r.relVel - 0.75) * 0.5));
    expect(r.lastImpact!.damage).toBeCloseTo(expectImpact, 5);
    expect(r.hpB).toBeCloseTo(1000 - 80 - expectImpact / 2, 5);
    expect(r.hpA).toBeCloseTo(1000 - expectImpact / 2, 5);
  });
});

describe('F-02W-A · 场景2：低速擦碰对照（±0.25）', () => {
  it('relVel<0.5 不触发 Weapon：defender HP 保持不变', () => {
    const r = runScenario(lightSnapshot, bodyOnlyLight, {
      autoDrive: false,
      lowSpeedVx: 0.25,
      // 与 F-02W-D S3 相同的接近不重叠构造（gap 50px，短距离低速擦碰）
      spawnA: { x: 600, y: 640, facing: 1 },
      spawnB: { x: 800, y: 640, facing: -1 },
    });

    console.log(
      `S2 relVel=${r.relVel.toFixed(3)} partA=${r.partIdA} partB=${r.partIdB} ` +
        `HP A=${r.hpA} HP B=${r.hpB} lastDamage=${r.lastDamage ? `dmg=${r.lastDamage.damage}` : 'null'} ` +
        `lastImpact=${r.lastImpact ? `dmg=${r.lastImpact.damage}` : 'null'}`,
    );

    // 真实 ramHead→body 接触（诊断值 0.099，阈值 0.5 之下）
    expect(r.partIdA).toBe('part:front');
    expect(r.partIdB).toBe('body');
    expect(r.relVel).toBeLessThan(WEAPON_CONTACT_THRESHOLD);
    // Weapon 不触发：HP 不变
    expect(r.hpB).toBeCloseTo(1000, 5);
    expect(r.hpA).toBeCloseTo(1000, 5);
    expect(r.lastDamage).toBeNull();
  });
});
