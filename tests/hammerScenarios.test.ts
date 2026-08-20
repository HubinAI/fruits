/**
 * Queue Q03-C2 / Q03-C2R1｜Hammer Visual Scenarios targeted test
 *
 * 覆盖 Q03-C2 验收：
 * 1. 3 个 Hammer 场景（Hammer-Hit / Hammer-Miss / Hammer-Reaction）均能通过
 *    PhysicsLab 正式入口创建并稳定 step，全部 engine:'planck'、autoDrive:false；
 * 2. Hammer 安装正确（front hardpoint / weapon / baseDamage）、状态循环正常
 *    （锤头相对角真实摆荡覆盖固定弧 lower~upper，多次循环）；
 * 3. Hammer-Hit：真实接触才掉 weapon damage（baseDamage=90）；
 * 4. Hammer-Miss：目标在弧外 → 正常挥击但真实打空（0 weapon damage）；
 * 5. Hammer-Reaction：B 远置无接触，仍能测到 chassis 的真实反作用运动差异。
 *
 * Q03-C2R1（真实 Revolute Limit 接入后固定弧回归）：
 * - 三场景运行全程 joint angle 始终保持在 [lowerRad-tol, upperRad+tol] 内
 *   （物理 limit 约束，非状态机阈值）；
 * - Hammer-Hit 首次伤害发生在 Swing 阶段（非出生接触）；
 * - Miss / Reaction 语义不变。
 */
import { describe, it, expect } from 'vitest';
import { getScenario } from '../src/lab/scenarios';
import { PhysicsLab } from '../src/lab/physicsLab';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import type { Renderer } from '../src/render/renderer';
import { isDamageEvent, type DamageEvent } from '../src/battle/combatEvents';
import { HAMMER_DEFAULT_PARAMS } from '../src/battle/hammerBehavior';

const rendererStub = { bind: () => {} } as unknown as Renderer;

const HAMMER_SCENARIOS = ['Hammer-Hit', 'Hammer-Miss', 'Hammer-Reaction'];

function requirePlanck(lab: PhysicsLab): PlanckBattleOrchestrator {
  const o = lab.orchestrator;
  if (!(o instanceof PlanckBattleOrchestrator)) {
    throw new Error('未选择 PlanckBattleOrchestrator（engine selector 失效）');
  }
  return o;
}

describe('Q03-C2 Hammer Visual Scenarios', () => {
  it('3 场景：Lab 正式入口创建并 step，全部 Planck，Hammer 安装正确，状态循环正常', () => {
    for (const id of HAMMER_SCENARIOS) {
      const sc = getScenario(id);
      expect(sc).toBeDefined();
      expect(sc!.config.engine).toBe('planck');
      expect(sc!.config.autoDrive).toBe(false);

      const lab = new PhysicsLab(rendererStub);
      expect(() => lab.loadScenario(sc!)).not.toThrow();
      const o = requirePlanck(lab);

      // Hammer 安装正确：front hardpoint / weapon / baseDamage
      const part = o.vehicleA.parts.find((p) => p.def.behavior === 'hammer');
      expect(part).toBeDefined();
      expect(part!.id).toBe('front');
      expect(part!.def.category).toBe('weapon');
      expect((part!.def.behaviorParams as Record<string, unknown>).baseDamage).toBe(90);

      // 状态循环正常：300 步内锤头相对角真实摆荡覆盖 lower~upper（±求解余量）
      let minA = Infinity;
      let maxA = -Infinity;
      for (let i = 0; i < 300; i++) {
        lab.step(16.6667);
        const a = o.world.getRevoluteAngle(part!.joint);
        if (a < minA) minA = a;
        if (a > maxA) maxA = a;
      }
      const { lowerRad, upperRad } = HAMMER_DEFAULT_PARAMS;
      // 到达两端（状态循环成立）
      expect(minA).toBeLessThanOrEqual(lowerRad + 0.08);
      expect(maxA).toBeGreaterThanOrEqual(upperRad - 0.08);
      // Q03-C2R1：真实 Revolute Limit 接入后，angle 全程保持在固定弧内——
      // tolerance 取 C1R1 高压力实测穿透上限（~0.103 rad）含余量
      const tolerance = 0.15;
      expect(minA).toBeGreaterThanOrEqual(lowerRad - tolerance);
      expect(maxA).toBeLessThanOrEqual(upperRad + tolerance);
    }
  });

  it('Hammer-Hit：真实 Swing 接触产生 weapon damage（90，非出生接触）', () => {
    const lab = new PhysicsLab(rendererStub);
    lab.loadScenario(getScenario('Hammer-Hit')!);
    const o = requirePlanck(lab);
    const weaponEvents: DamageEvent[] = [];
    o.onCombatEvent((e) => {
      if (isDamageEvent(e) && e.damageSource === 'weapon') weaponEvents.push(e);
    });
    let firstHitStep = -1;
    for (let i = 1; i <= 360; i++) {
      lab.step(16.6667);
      if (firstHitStep < 0 && weaponEvents.length > 0) firstHitStep = i;
    }
    expect(weaponEvents.length).toBeGreaterThanOrEqual(1);
    for (const ev of weaponEvents) {
      expect(ev.damage).toBe(90); // hammer baseDamage
    }
    expect(o.vehicleB.hp).toBeLessThan(1000);
    // Q03-C2R1：首次伤害发生在 Swing 阶段而非出生接触——
    // windup 18 + 停顿 20 ≈ 38 步后才进入首个 Swing；<30 步的伤害只可能是初始重叠。
    expect(firstHitStep).toBeGreaterThanOrEqual(30);
  });

  it('Hammer-Miss：目标在挥击弧外 → 正常循环但真实打空（0 weapon damage）', () => {
    const lab = new PhysicsLab(rendererStub);
    lab.loadScenario(getScenario('Hammer-Miss')!);
    const o = requirePlanck(lab);
    const weaponEvents: DamageEvent[] = [];
    o.onCombatEvent((e) => {
      if (isDamageEvent(e) && e.damageSource === 'weapon') weaponEvents.push(e);
    });
    for (let i = 0; i < 360; i++) lab.step(16.6667);
    expect(weaponEvents.length).toBe(0);
    expect(o.vehicleB.hp).toBe(1000);
  });

  it('Hammer-Reaction：B 远置无接触，仍能测到 chassis 真实反作用运动差异', () => {
    const lab = new PhysicsLab(rendererStub);
    lab.loadScenario(getScenario('Hammer-Reaction')!);
    const o = requirePlanck(lab);
    const weaponEvents: DamageEvent[] = [];
    o.onCombatEvent((e) => {
      if (isDamageEvent(e) && e.damageSource === 'weapon') weaponEvents.push(e);
    });

    // 前 60 步（windup 阶段）无敌人接触 → B 保持 1000
    for (let i = 0; i < 60; i++) lab.step(16.6667);
    expect(weaponEvents.length).toBe(0);
    expect(o.vehicleB.hp).toBe(1000);

    // 全程记录 chassis 角速度峰值：motor 挥锤的真实扭矩反作用（轻型 wedgeBody → 更明显）
    let maxOmega = 0;
    for (let i = 0; i < 300; i++) {
      lab.step(16.6667);
      const w = o.world.getAngularVelocity(o.vehicleA.body);
      if (Math.abs(w) > maxOmega) maxOmega = Math.abs(w);
    }
    // 无敌人碰撞时的真实运动差异：chassis 角速度明显非零（远大于静止/噪声水平）。
    // 注：Q03-C1R1 后 limit 真实接入——swing 撞 upper 时力矩被硬约束吸收，反作用峰值
    // 略降（实测 ~0.016 rad/s），但真实存在（motor 扭矩反作用经 Revolute 传 chassis）。
    expect(maxOmega).toBeGreaterThan(0.01);
    // 全程无 weapon 伤害（B 远置确实不参与交互）
    expect(weaponEvents.length).toBe(0);
    expect(o.vehicleB.hp).toBe(1000);
  });
});
