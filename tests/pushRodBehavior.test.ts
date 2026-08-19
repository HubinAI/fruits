/**
 * Queue Q04-C1｜Push Rod Extend → Hold → Retract targeted test
 *
 * 覆盖 Q04-C1 验收：
 * 1. 状态机循环：Extend（正向伸出至 upper）→ Hold（停顿）→ Retract（回 lower）→ Extend；
 * 2. 首次运行设置真实 Prismatic Limit（lower=0 / upper=extendPx），translation 不越界；
 * 3. 端到端：真实碰撞能推动目标（无 weapon damage——Gadget 天然绕过）；
 * 4. 轻目标位移 > 重目标位移（同一套 maxForce/speed，禁止按质量动态补偿）；
 * 5. 推目标时自身车辆产生真实反作用；
 * 6. 不读敌方位置 / 不自动调整 extendPx（固定行程、固定周期）。
 */
import { describe, it, expect } from 'vitest';
import { createRegistry } from '../src/core/content';
import type { BuildSnapshot } from '../src/core/types';
import { resolveSnapshot } from '../src/core/buildSnapshot';
import { PlanckWorld } from '../src/physics/planckWorld';
import { createPlanckVehicle, settlePlanckVehicleToRestPose } from '../src/battle/planckVehicleAssembly';
import { PushRodBehavior, PUSH_ROD_DEFAULT_PARAMS } from '../src/battle/pushRodBehavior';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import type { CombatEvent } from '../src/battle/combatEvents';

const registry = createRegistry();

function pushRodBuild(): BuildSnapshot {
  return {
    id: 'pushRodCar',
    bodyDefId: 'boxBody',
    quality: 1,
    movements: [
      { hardpointId: 'rear', defId: 'wheelStd' },
      { hardpointId: 'front', defId: 'wheelStd' },
    ],
    functionals: [{ hardpointId: 'front', defId: 'pushRod' }],
  };
}

/** 目标车：指定 body（轻=boxBody / 重=heavyBox），无攻击件 */
function targetBuild(bodyDefId: string): BuildSnapshot {
  return {
    id: 'target',
    bodyDefId,
    quality: 1,
    movements: [
      { hardpointId: 'rear', defId: 'wheelStd' },
      { hardpointId: 'front', defId: 'wheelStd' },
    ],
    functionals: [],
  };
}

function makeVehicle(): { world: PlanckWorld; v: ReturnType<typeof createPlanckVehicle> } {
  const world = new PlanckWorld({ x: 0, y: 10 });
  const ground = world.createStaticGround(0, 700, 4000, 80);
  world.setOwnerTag(ground, { kind: 'ground' });
  const v = createPlanckVehicle(
    world,
    resolveSnapshot(pushRodBuild(), registry),
    'A',
    { x: 400, y: 640 },
    1,
  );
  settlePlanckVehicleToRestPose(world, v, ground);
  return { world, v };
}

/** 端到端跑推杆场景，返回 B/A 位移与 weapon 事件统计 */
function runPush(bodyDefId: string, steps = 480): {
  bShift: number;
  aShift: number;
  weaponCount: number;
  hp: number;
} {
  const orch = new PlanckBattleOrchestrator(pushRodBuild(), targetBuild(bodyDefId), registry, {
    autoDrive: false,
    // A pivot ≈ 450+75=525，杆初始覆盖 525..605；B 左缘 = spawnB-75。
    // spawnB 700 → 左缘 625 > 605 无出生重叠；杆 extend 90 → 前端 695 > 625 → 顶推 B。
    spawnA: { x: 450, y: 640, facing: 1 },
    spawnB: { x: 700, y: 640, facing: -1 },
  });
  const weaponEvents: CombatEvent[] = [];
  orch.onCombatEvent((e) => {
    if (e.damageSource === 'weapon') weaponEvents.push(e);
  });
  const b0 = orch.world.getPosition(orch.vehicleB.body).x;
  const a0 = orch.world.getPosition(orch.vehicleA.body).x;
  for (let i = 0; i < steps; i++) orch.step(16.6667);
  const b1 = orch.world.getPosition(orch.vehicleB.body).x;
  const a1 = orch.world.getPosition(orch.vehicleA.body).x;
  return {
    bShift: b1 - b0,
    aShift: a1 - a0,
    weaponCount: weaponEvents.length,
    hp: orch.vehicleB.hp,
  };
}

describe('Q04-C1 PushRodBehavior 状态机（单元）', () => {
  it('Extend → Hold → Retract → Extend 循环；真实 limit 下 translation 不越界', () => {
    const { world, v } = makeVehicle();
    const part = v.parts.find((p) => p.def.behavior === 'pushRod')!;
    const behavior = new PushRodBehavior(part);
    const { extendPx } = PUSH_ROD_DEFAULT_PARAMS;

    const phaseLog: string[] = [];
    const tSamples: number[] = [];
    let lastPhase = behavior.phase;
    for (let step = 0; step < 520; step++) {
      behavior.stepFixed(world, v, part);
      world.stepFixed(1);
      if (behavior.phase !== lastPhase) {
        phaseLog.push(`${behavior.phase}@${step}`);
        lastPhase = behavior.phase;
      }
      if (step % 10 === 0) tSamples.push(world.getPrismaticTranslation(part.joint));
    }

    // 三相位都出现且循环回 extend
    expect(phaseLog.some((p) => p.startsWith('hold@'))).toBe(true);
    expect(phaseLog.some((p) => p.startsWith('retract@'))).toBe(true);
    expect(phaseLog.filter((p) => p.startsWith('extend@')).length).toBeGreaterThanOrEqual(2);

    // 真实 limit：translation 不越 [0, extendPx]（±求解余量），且到达远端与回零
    const maxT = Math.max(...tSamples);
    const minT = Math.min(...tSamples);
    expect(maxT).toBeLessThanOrEqual(extendPx + 1.5);
    expect(minT).toBeGreaterThanOrEqual(-1.5);
    expect(maxT).toBeGreaterThan(extendPx - 5);
    expect(minT).toBeLessThan(5);
  });
});

describe('Q04-C1 Orchestrator 端到端', () => {
  it('真实碰撞推动目标：轻目标被明显推离，无 weapon damage', () => {
    const r = runPush('boxBody');
    expect(r.weaponCount).toBe(0); // Gadget 不产生 damageSource='weapon'
    // 无 Direct Weapon Damage；通用 Impact（vehicle↔vehicle 真实碰撞）可自然存在
    // （微量掉血属预期，不为 Push Rod 特判关闭）
    expect(r.hp).toBeGreaterThan(990);
    expect(r.bShift).toBeGreaterThan(30); // B 被真实碰撞推离
  });

  it('轻目标位移 > 重目标位移（同一套 maxForce/speed，无按质量补偿）', () => {
    const light = runPush('boxBody'); // baseMass 50
    const heavy = runPush('heavyBox'); // baseMass 150
    expect(light.bShift).toBeGreaterThan(0);
    expect(heavy.bShift).toBeGreaterThan(0);
    expect(light.bShift).toBeGreaterThan(heavy.bShift);
  });

  it('推目标时自身车辆产生真实反作用', () => {
    const r = runPush('boxBody');
    // motor 推力反作用 + 顶 B 的接触反作用 → A 被向后推动
    expect(Math.abs(r.aShift)).toBeGreaterThan(1);
  });
});
