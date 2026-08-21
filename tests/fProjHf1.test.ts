/**
 * F-PROJ-HF1｜高频小弹体动量收敛
 *
 * 根因（已沿正式 Runtime 确认）：机枪 / 喷火器的位移完全来自真实 projectile 碰撞动量
 * 传递（projectileMass × muzzleSpeed），项目没有任何「B 侧固定推力 / Damage→Knockback」
 * 规则（damageResolver 只扣 HP；所有 applyLinearImpulse 都是射手自身后坐；喷火器零 impulse）。
 * 单颗质量沿用了普通 projectile 档(1)，高频累积后推力过大：
 *   - 机枪一个 7 发 burst 把香蕉推 ~25px；
 *   - 喷火器一个 spray 把香蕉推 ~143px（≈1.5 车身，直接推出射程/画面）。
 * 仅下调 projectileMass（机枪 1→0.1、喷火器 1→0.03），不改 speed/damage/fire rate/radius/
 * CCD/视觉/Physics。
 *
 * 验收（沿正式 Runtime，autoDrive=false）：
 * 1. 机枪一个完整 burst 后香蕉仅轻微真实受击位移（≪ 1 车身）；
 * 2. 喷火器一个完整 spray 中香蕉稳定停留在火流有效区（不被推出射程）；
 * 3. 两种武器命中仍全部来自真实 projectile contact（香蕉仅在 projectile 抵达后才开始位移，
 *    不存在 step 0 即生效的 B 侧隐藏推力）；
 * 4. Damage / 射速 / 射程 / 当前视觉身份完全不变（HP 扣减与参数档位一致）；
 * 5. Cannon / Shotgun / Laser 等已有 projectileMass 仍为 1（行为不变）。
 */
import { describe, it, expect } from 'vitest';
import { getScenario } from '../src/lab/scenarios';
import { PhysicsLab } from '../src/lab/physicsLab';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import {
  isDamageEvent,
  type DamageEvent,
} from '../src/battle/combatEvents';
import { registry } from '../src/core/content';

const rendererStub = { bind: () => {} } as unknown as import('../src/render/renderer').Renderer;

function requirePlanck(lab: PhysicsLab): PlanckBattleOrchestrator {
  const o = lab.orchestrator;
  if (!(o instanceof PlanckBattleOrchestrator)) throw new Error('非 Planck orchestrator');
  return o;
}

interface BananaMeasure {
  x0: number;
  x1: number;
  dx: number;
  vx1: number;
  peakBVx: number;
  /** 香蕉首次出现非零 vx 的物理步（碰撞驱动则应明显晚于 0） */
  firstBVxNonZeroStep: number;
  /** 真实武器伤害事件累计数 */
  weaponHits: number;
  /** 香蕉最终 HP */
  hp: number;
}

function measureBanana(scenarioId: string, totalSteps: number): BananaMeasure {
  const lab = new PhysicsLab(rendererStub);
  lab.loadScenario(getScenario(scenarioId)!);
  const o = requirePlanck(lab);
  const banana = o.vehicleB;

  const x0 = o.world.getPosition(banana.body).x;
  let peakBVx = 0;
  let firstBVxNonZeroStep = -1;
  const weaponHits: DamageEvent[] = [];
  o.onCombatEvent((e) => {
    if (isDamageEvent(e) && e.damageSource === 'weapon') weaponHits.push(e);
  });

  for (let step = 1; step <= totalSteps; step++) {
    lab.step(16.6667);
    const vel = o.world.getLinearVelocity(banana.body);
    if (firstBVxNonZeroStep < 0 && Math.abs(vel.x) > 1e-3) firstBVxNonZeroStep = step;
    peakBVx = Math.max(peakBVx, Math.abs(vel.x));
  }

  const x1 = o.world.getPosition(banana.body).x;
  return {
    x0: +x0.toFixed(2),
    x1: +x1.toFixed(2),
    dx: +(x1 - x0).toFixed(2),
    vx1: +o.world.getLinearVelocity(banana.body).x.toFixed(4),
    peakBVx: +peakBVx.toFixed(4),
    firstBVxNonZeroStep,
    weaponHits: weaponHits.length,
    hp: banana.hp,
  };
}

describe('F-PROJ-HF1 高频小弹体动量收敛', () => {
  it('1. 机枪 projectileMass 已降档；bananaBody 基础 HP=900、Damage 参数未变', () => {
    const mg = registry.functionals.get('machineGun')!.behaviorParams as Record<string, number>;
    expect(mg.projectileMass).toBe(0.1); // 1 → 0.1
    expect(mg.muzzleSpeed).toBe(12); // 射速/速度不变
    expect(mg.projectileDamage).toBe(20);
    expect(mg.projectileRadius).toBe(5); // Collider 不变

    const fl = registry.functionals.get('flamethrower')!.behaviorParams as Record<string, number>;
    expect(fl.projectileMass).toBe(0.03); // 1 → 0.03
    expect(fl.muzzleSpeed).toBe(10);
    expect(fl.projectileDamage).toBe(8);
    expect(fl.projectileRadius).toBe(4);

    const bananaDef = registry.bodies.get('bananaBody')!;
    expect((bananaDef as { hp?: number }).hp ?? 900).toBe(900);
  });

  it('2. 机枪一个完整 burst 后香蕉仅轻微真实受击位移（≪ 1 车身），不被连续推走', () => {
    const r = measureBanana('Q14-A', 50);
    // 实测降档后 Δx≈2.7px（已远低于 ~25px 与 1 车身≈95px）；给安全余量 < 12px
    expect(r.dx).toBeLessThan(12);
    expect(r.dx).toBeGreaterThan(-12);
    // 峰值速度明显小（强力推杆会 >1 px/步）
    expect(r.peakBVx).toBeLessThan(0.4);
    expect(Math.abs(r.vx1)).toBeLessThan(0.4);
    // 香蕉仅在 projectile 真实抵达后才开始位移（碰撞驱动，无 B 侧隐藏推力）
    expect(r.firstBVxNonZeroStep).toBeGreaterThanOrEqual(4);
    // 伤害仍来自真实 contact：整 burst 7 发全中（bananaBody HP 900 - 7×20 = 760）
    expect(r.weaponHits).toBeGreaterThanOrEqual(6);
    expect(r.hp).toBe(900 - r.weaponHits * 20);
  });

  it('3. 喷火器一个完整 spray 中香蕉稳定停留在火流有效区，不被推出射程', () => {
    const r = measureBanana('Q14-B', 80);
    // 实测降档后 Δx≈5.6px（已远低于 ~143px）；安全余量 < 15px
    expect(r.dx).toBeLessThan(15);
    expect(r.dx).toBeGreaterThan(-15);
    expect(r.peakBVx).toBeLessThan(0.4);
    expect(Math.abs(r.vx1)).toBeLessThan(0.4);
    // 香蕉仅在火焰颗粒真实抵达后才开始位移
    expect(r.firstBVxNonZeroStep).toBeGreaterThanOrEqual(4);
    // 真实 contact 命中仍成立：喷火期间香蕉吃到多颗火焰伤害
    expect(r.weaponHits).toBeGreaterThanOrEqual(3);
    expect(r.hp).toBeLessThan(900);
  });

  it('4. Cannon / Shotgun / Laser 的 projectileMass 与行为参数完全不变', () => {
    const cannon = registry.functionals.get('cannon')!.behaviorParams as Record<string, number>;
    const sg = registry.functionals.get('shotgun')!.behaviorParams as Record<string, number>;
    const laser = registry.functionals.get('laser')!.behaviorParams as Record<string, number>;
    expect(cannon.projectileMass).toBe(1);
    expect(cannon.muzzleSpeed).toBe(8);
    expect(cannon.recoilImpulse).toBe(30);
    expect(sg.projectileMass).toBe(1);
    expect(sg.muzzleSpeed).toBe(13);
    expect(laser.projectileMass).toBe(1);
    expect(laser.muzzleSpeed).toBe(56);
    expect(laser.recoilImpulse).toBe(560);
  });
});
