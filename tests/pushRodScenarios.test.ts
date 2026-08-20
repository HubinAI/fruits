/**
 * Queue Q04-C2｜Push Rod Visual Scenarios targeted test
 *
 * 覆盖 Q04-C2 验收：
 * 1. 3 个 Push Rod 场景（Push-Light / Push-Heavy / Push-Reaction）均能通过
 *    PhysicsLab 正式入口创建并稳定 step，全部 engine:'planck'、autoDrive:false；
 * 2. Push Rod 安装正确（front hardpoint / gadget / pushRod）、状态循环正常
 *    （Extend→Hold→Retract：translation 到 extendPx 且回零、多次循环）；
 * 3. Push-Light：轻目标被真实接触明显推离（无 weapon damage）；
 * 4. Push-Heavy：与 Light 同 A/同距离/同参数，仅 B 换 heavyBody → Heavy 位移明显更小；
 * 5. Push-Reaction：A 较轻 chassis 推重目标，A 自身被真实 joint+collision 反作用影响。
 */
import { describe, it, expect } from 'vitest';
import { getScenario } from '../src/lab/scenarios';
import { PhysicsLab } from '../src/lab/physicsLab';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import type { Renderer } from '../src/render/renderer';
import { isDamageEvent, type DamageEvent } from '../src/battle/combatEvents';
import { PUSH_ROD_DEFAULT_PARAMS } from '../src/battle/pushRodBehavior';

const rendererStub = { bind: () => {} } as unknown as Renderer;

const PUSH_SCENARIOS = ['Push-Light', 'Push-Heavy', 'Push-Reaction'];

function requirePlanck(lab: PhysicsLab): PlanckBattleOrchestrator {
  const o = lab.orchestrator;
  if (!(o instanceof PlanckBattleOrchestrator)) {
    throw new Error('未选择 PlanckBattleOrchestrator（engine selector 失效）');
  }
  return o;
}

/** 跑指定场景 N 步，返回 B/A 位移、weapon 统计、推杆 translation 极值 */
function runScenario(
  id: string,
  steps = 360,
): {
  bShift: number;
  aShift: number;
  weaponCount: number;
  hp: number;
  maxT: number;
  minT: number;
  bFinalX: number;
  aFinalX: number;
} {
  const lab = new PhysicsLab(rendererStub);
  lab.loadScenario(getScenario(id)!);
  const o = requirePlanck(lab);
  const weaponEvents: DamageEvent[] = [];
  o.onCombatEvent((e) => {
    if (isDamageEvent(e) && e.damageSource === 'weapon') weaponEvents.push(e);
  });
  const part = o.vehicleA.parts.find((p) => p.def.behavior === 'pushRod')!;
  const b0 = o.world.getPosition(o.vehicleB.body).x;
  const a0 = o.world.getPosition(o.vehicleA.body).x;
  let maxT = -Infinity;
  let minT = Infinity;
  for (let i = 0; i < steps; i++) {
    lab.step(16.6667);
    const t = o.world.getPrismaticTranslation(part.joint);
    if (t > maxT) maxT = t;
    if (t < minT) minT = t;
  }
  const b1 = o.world.getPosition(o.vehicleB.body).x;
  const a1 = o.world.getPosition(o.vehicleA.body).x;
  return {
    bShift: b1 - b0,
    aShift: a1 - a0,
    weaponCount: weaponEvents.length,
    hp: o.vehicleB.hp,
    maxT,
    minT,
    bFinalX: b1,
    aFinalX: a1,
  };
}

describe('Q04-C2 Push Rod Visual Scenarios', () => {
  it('3 场景：Lab 正式入口创建并 step，全部 Planck，Push Rod 安装正确，Extend/Hold/Retract 循环正常', () => {
    for (const id of PUSH_SCENARIOS) {
      const sc = getScenario(id);
      expect(sc).toBeDefined();
      expect(sc!.config.engine).toBe('planck');
      expect(sc!.config.autoDrive).toBe(false);

      const lab = new PhysicsLab(rendererStub);
      expect(() => lab.loadScenario(sc!)).not.toThrow();
      const o = requirePlanck(lab);

      // Push Rod 安装正确：front hardpoint / gadget / pushRod
      const part = o.vehicleA.parts.find((p) => p.def.behavior === 'pushRod');
      expect(part).toBeDefined();
      expect(part!.id).toBe('front');
      expect(part!.def.category).toBe('gadget');

      // 状态循环正常：translation 覆盖 [0, extendPx]（Extend 到远端、Retract 回零）
      let maxT = -Infinity;
      let minT = Infinity;
      for (let i = 0; i < 300; i++) {
        lab.step(16.6667);
        const t = o.world.getPrismaticTranslation(part!.joint);
        if (t > maxT) maxT = t;
        if (t < minT) minT = t;
      }
      const { extendPx } = PUSH_ROD_DEFAULT_PARAMS;
      expect(maxT).toBeGreaterThan(extendPx - 5); // Extend 到位
      expect(minT).toBeLessThan(5); // Retract 回零
    }
  });

  it('Push-Light：轻目标被真实接触明显推离，无 weapon damage，且不飞出安全画面（Q04-R1A 回收后）', () => {
    const r = runScenario('Push-Light');
    expect(r.weaponCount).toBe(0); // Gadget 不产生 weapon damage
    expect(r.hp).toBeGreaterThan(990); // 无直接扣血（自然 Impact 允许）
    // Q04-R1A：maxForceN 30 明显回收推力——B 仍被明显推离但停在安全区
    expect(r.bShift).toBeGreaterThan(150); // 明显移动（原 >30，回收后 ~241）
    expect(r.bShift).toBeLessThan(400); // 但不再“爆开”（原 500N 下 ~324）
    expect(r.bFinalX).toBeLessThan(1400); // 不飞出安全画面（arena 墙内 1600，B 半宽 75）
    expect(r.aFinalX).toBeGreaterThan(75); // A 有反作用但自身不滑出画面（左墙内）
    // Extend/Hold/Retract 清楚：translation 到达远端且回零
    expect(r.maxT).toBeGreaterThan(PUSH_ROD_DEFAULT_PARAMS.extendPx - 5);
    expect(r.minT).toBeLessThan(5);
  });

  it('Push-Heavy：与 Light 完全相同的 A/距离/参数，仅 B 换 heavyBody → Heavy 位移明显更小', () => {
    const light = runScenario('Push-Light');
    const heavy = runScenario('Push-Heavy');
    expect(heavy.bShift).toBeGreaterThan(40); // Heavy 也被推一点（真实接触，回收后 ~131）
    // Heavy 位移明显小于 Light（同一套 maxForce/speed，无按质量补偿）
    expect(light.bShift).toBeGreaterThan(heavy.bShift);
    expect(light.bShift - heavy.bShift).toBeGreaterThan(15);
    // Q04-R1A：Light 位移至少约为 Heavy 的 1.5 倍（质量差异成为主要结果，实测 ~1.84）
    expect(light.bShift / heavy.bShift).toBeGreaterThanOrEqual(1.5);
  });

  it('Push-Reaction：较轻 A 推重目标，A 自身被真实 joint+collision 反作用影响', () => {
    const r = runScenario('Push-Reaction');
    // A 较轻（wedgeBody ~50 vs B heavyBox ~150）→ 推 B 时 A 被反推明显
    // Q04-R1A：回收后仍明显可见（实测 ~-241），但不再瞬间飞离
    expect(r.aShift).toBeLessThan(-50); // A 明显后退（反作用）
    expect(r.aFinalX).toBeGreaterThan(75); // A 不滑出画面
    expect(r.weaponCount).toBe(0);
    expect(r.bShift).toBeGreaterThan(40); // B 确实被推（实测 ~123）
  });
});
