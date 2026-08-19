/**
 * Queue Q05-C2｜Lift Roller Visual Scenarios targeted test
 *
 * 覆盖 Q05-C2 验收：
 * 1. 3 个场景（Lift-Light / Lift-Posture / Lift-Grounded）均能通过 PhysicsLab 正式入口
 *    创建并稳定 step，全部 engine:'planck'、autoDrive:false；
 * 2. Lift Roller 安装正确（front / gadget / liftRoller）、Roller 真实旋转（angle 变化，
 *    Q05-V1 径向线随真实物理角度转动 → 肉眼可见）；
 * 3. Lift-Light：B 被真实接触明显顶起 / 改变姿态，0 weapon damage；
 * 4. Lift-Posture：B 俯仰姿态明显改变（接触位置 → 姿态结果，无补偿）；
 * 5. Lift-Grounded：B 至少一个驱动轮真实离地（grounded true→false）并落回恢复
 *    （false→true）；A 用重型平台反推小（稳定）；0 weapon damage。
 */
import { describe, it, expect } from 'vitest';
import { getScenario } from '../src/lab/scenarios';
import { PhysicsLab } from '../src/lab/physicsLab';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import type { Renderer } from '../src/render/renderer';
import type { CombatEvent } from '../src/battle/combatEvents';

const rendererStub = { bind: () => {} } as unknown as Renderer;

const LIFT_SCENARIOS = ['Lift-Light', 'Lift-Posture', 'Lift-Grounded'];

function requirePlanck(lab: PhysicsLab): PlanckBattleOrchestrator {
  const o = lab.orchestrator;
  if (!(o instanceof PlanckBattleOrchestrator)) {
    throw new Error('未选择 PlanckBattleOrchestrator（engine selector 失效）');
  }
  return o;
}

/** 跑场景 N 步，返回 B 姿态变化 / A 位移 / weapon / roller 旋转 / grounded 序列 */
function runScenario(
  id: string,
  steps = 360,
): {
  bAngShift: number;
  bYShift: number;
  aShiftMax: number;
  weaponCount: number;
  hp: number;
  rollerAngleDelta: number;
  groundedSeq: string[];
} {
  const lab = new PhysicsLab(rendererStub);
  lab.loadScenario(getScenario(id)!);
  const o = requirePlanck(lab);
  const weaponEvents: CombatEvent[] = [];
  o.onCombatEvent((e) => {
    if (e.damageSource === 'weapon') weaponEvents.push(e);
  });
  const part = o.vehicleA.parts.find((p) => p.def.behavior === 'liftRoller')!;
  const bA0 = o.world.getAngle(o.vehicleB.body);
  const bY0 = o.world.getPosition(o.vehicleB.body).y;
  const aX0 = o.world.getPosition(o.vehicleA.body).x;
  const rollerA0 = o.world.getRevoluteAngle(part.joint);
  let maxA = 0;
  let maxY = 0;
  let aShiftMax = 0;
  const groundedSeq: string[] = [];
  let prev = '';
  for (let i = 0; i < steps; i++) {
    lab.step(16.6667);
    maxA = Math.max(maxA, Math.abs(o.world.getAngle(o.vehicleB.body) - bA0));
    maxY = Math.max(maxY, Math.abs(o.world.getPosition(o.vehicleB.body).y - bY0));
    aShiftMax = Math.max(aShiftMax, Math.abs(o.world.getPosition(o.vehicleA.body).x - aX0));
    const g = o.vehicleB.wheels.map((w) => (w.grounded ? '1' : '0')).join('');
    if (g !== prev) {
      groundedSeq.push(g);
      prev = g;
    }
  }
  const rollerA1 = o.world.getRevoluteAngle(part.joint);
  let rollerDelta = rollerA1 - rollerA0;
  if (rollerDelta > Math.PI) rollerDelta -= Math.PI * 2;
  if (rollerDelta < -Math.PI) rollerDelta += Math.PI * 2;
  return {
    bAngShift: maxA,
    bYShift: maxY,
    aShiftMax,
    weaponCount: weaponEvents.length,
    hp: o.vehicleB.hp,
    rollerAngleDelta: Math.abs(rollerDelta),
    groundedSeq,
  };
}

describe('Q05-C2 Lift Roller Visual Scenarios', () => {
  it('3 场景：Lab 正式入口创建并 step，全部 Planck，Lift Roller 安装正确且真实旋转', () => {
    for (const id of LIFT_SCENARIOS) {
      const sc = getScenario(id);
      expect(sc).toBeDefined();
      expect(sc!.config.engine).toBe('planck');
      expect(sc!.config.autoDrive).toBe(false);

      const lab = new PhysicsLab(rendererStub);
      expect(() => lab.loadScenario(sc!)).not.toThrow();
      const o = requirePlanck(lab);

      // Lift Roller 安装正确：front / gadget / liftRoller
      const part = o.vehicleA.parts.find((p) => p.def.behavior === 'liftRoller');
      expect(part).toBeDefined();
      expect(part!.id).toBe('front');
      expect(part!.def.category).toBe('gadget');

      // Roller 真实旋转（Q05-V1 径向线随真实角度转动 → 肉眼可见）
      const a0 = o.world.getRevoluteAngle(part!.joint);
      let total = 0;
      let prev = a0;
      for (let i = 0; i < 300; i++) {
        lab.step(16.6667);
        const a = o.world.getRevoluteAngle(part!.joint);
        let d = a - prev;
        if (d > Math.PI) d -= Math.PI * 2;
        if (d < -Math.PI) d += Math.PI * 2;
        total += Math.abs(d);
        prev = a;
      }
      expect(total).toBeGreaterThan(Math.PI); // 累计旋转明显（非静止）
    }
  });

  it('Lift-Light：B 被真实接触明显顶起 / 改变姿态；0 weapon damage', () => {
    const r = runScenario('Lift-Light');
    // 顶起或姿态改变明显（Q05-C1 实测 bx=560：yShift 14.4 / angShift 0.314）
    expect(r.bAngShift > 0.05 || r.bYShift > 5).toBe(true);
    expect(r.weaponCount).toBe(0);
    expect(r.hp).toBe(1000);
    expect(r.rollerAngleDelta).toBeGreaterThan(0.5); // roller 持续旋转
  });

  it('Lift-Posture：B 俯仰姿态明显改变（接触位置 → 姿态结果）', () => {
    const r = runScenario('Lift-Posture');
    // 俯仰（角度）是主要可观察结果（实测 bx=550：angShift 0.334）
    expect(r.bAngShift).toBeGreaterThan(0.1);
    expect(r.weaponCount).toBe(0);
    expect(r.hp).toBe(1000);
  });

  it('Lift-Grounded：B 至少一个驱动轮真实离地（true→false）并落回恢复（false→true）；A 平台稳定', () => {
    const r = runScenario('Lift-Grounded');
    // grounded 序列真实翻转：初始 '11' → 出现含 '0'（某轮离地）→ 恢复 '11'（落地）
    expect(r.groundedSeq[0]).toBe('11'); // 初始两轮接地
    const hasLift = r.groundedSeq.some((g) => g.includes('0'));
    expect(hasLift).toBe(true); // 至少一个驱动轮离地
    const liftIdx = r.groundedSeq.findIndex((g) => g.includes('0'));
    expect(r.groundedSeq.slice(liftIdx).includes('11')).toBe(true); // 落回恢复
    // A 用重型平台：反推明显小于 boxBody 平台（Q05-C1 boxBody 反推达 218px）
    expect(r.aShiftMax).toBeLessThan(60);
    expect(r.weaponCount).toBe(0);
    expect(r.hp).toBe(1000);
  });
});
