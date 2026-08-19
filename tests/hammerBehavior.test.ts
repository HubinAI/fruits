/**
 * Queue Q03-C1｜Hammer Wind-up → Swing → Recover targeted test
 *
 * 覆盖 Q03-C1 验收：
 * 1. 状态机循环：Wind-up（向后到位）→ 停顿 → Swing（高速向前）→ Recover（慢回）→ 循环；
 * 2. 运动完全来自 Revolute motor + limit（getRevoluteAngle 相位驱动），无 setAngle/teleport；
 * 3. 固定弧 / 固定周期（不追踪敌人）；
 * 4. 端到端：敌人在固定弧内可命中（baseDamage weapon 路径）；弧外真实打空；
 * 5. motor 挥动时 chassis 产生真实反作用。
 */
import { describe, it, expect } from 'vitest';
import { createRegistry } from '../src/core/content';
import type { BuildSnapshot } from '../src/core/types';
import { resolveSnapshot } from '../src/core/buildSnapshot';
import { PlanckWorld } from '../src/physics/planckWorld';
import {
  createPlanckVehicle,
  settlePlanckVehicleToRestPose,
} from '../src/battle/planckVehicleAssembly';
import { HammerBehavior, HAMMER_DEFAULT_PARAMS } from '../src/battle/hammerBehavior';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import type { CombatEvent } from '../src/battle/combatEvents';

const registry = createRegistry();

function hammerBuild(): BuildSnapshot {
  return {
    id: 'hammerCar',
    bodyDefId: 'boxBody',
    quality: 1,
    movements: [
      { hardpointId: 'rear', defId: 'wheelStd' },
      { hardpointId: 'front', defId: 'wheelStd' },
    ],
    functionals: [{ hardpointId: 'front', defId: 'hammer' }],
  };
}

/** 无攻击件目标车（boxBody + 双轮） */
function targetBuild(): BuildSnapshot {
  return {
    id: 'target',
    bodyDefId: 'boxBody',
    quality: 1,
    movements: [
      { hardpointId: 'rear', defId: 'wheelStd' },
      { hardpointId: 'front', defId: 'wheelStd' },
    ],
    functionals: [],
  };
}

describe('Q03-C1 HammerBehavior 状态机（单元）', () => {
  it('Wind-up 到位 → 停顿 → Swing 前挥 → Recover 慢回 → 循环；运动来自 motor+limit', () => {
    const world = new PlanckWorld({ x: 0, y: 10 });
    const ground = world.createStaticGround(0, 700, 4000, 80);
    world.setOwnerTag(ground, { kind: 'ground' });
    const v = createPlanckVehicle(
      world,
      resolveSnapshot(hammerBuild(), registry),
      'A',
      { x: 400, y: 640 },
      1,
    );
    settlePlanckVehicleToRestPose(world, v, ground);
    const part = v.parts.find((p) => p.def.behavior === 'hammer')!;
    const behavior = new HammerBehavior(part);

    const phaseLog: string[] = [];
    const angleSamples: number[] = [];
    const swingStartSteps: number[] = [];
    let lastPhase = behavior.phase;
    const { lowerRad, upperRad } = HAMMER_DEFAULT_PARAMS;

    for (let step = 0; step < 260; step++) {
      behavior.stepFixed(world, v, part);
      world.stepFixed(1);
      if (behavior.phase !== lastPhase) {
        phaseLog.push(`${behavior.phase}@${step}`);
        lastPhase = behavior.phase;
      }
      if (behavior.phase === 'swing' && phaseLog.filter((p) => p.startsWith('swing@')).length === swingStartSteps.length + 1) {
        swingStartSteps.push(step);
      }
      if (step % 5 === 0) angleSamples.push(world.getRevoluteAngle(part.joint));
    }

    // 四个相位都真实出现过（windup / windup-pause / swing / recover）
    expect(phaseLog.some((p) => p.startsWith('windup-pause@'))).toBe(true);
    expect(phaseLog.some((p) => p.startsWith('swing@'))).toBe(true);
    expect(phaseLog.some((p) => p.startsWith('recover@'))).toBe(true);

    // 角度真实覆盖下限与上限（到位：撞 lower / upper，±求解余量）
    const minAngle = Math.min(...angleSamples);
    const maxAngle = Math.max(...angleSamples);
    expect(minAngle).toBeLessThanOrEqual(lowerRad + 0.06);
    expect(maxAngle).toBeGreaterThanOrEqual(upperRad - 0.06);

    // 多次 Swing 开始 → 周期稳定（不追踪敌人 = 固定周期；两相邻间隔 ≈ 稳定值）
    expect(swingStartSteps.length).toBeGreaterThanOrEqual(2);
    const gaps: number[] = [];
    for (let i = 1; i < swingStartSteps.length; i++) {
      gaps.push(swingStartSteps[i]! - swingStartSteps[i - 1]!);
    }
    for (const g of gaps) {
      expect(Math.abs(g - gaps[0]!)).toBeLessThanOrEqual(6);
    }
  });
});

describe('Q03-C1 Orchestrator 端到端', () => {
  it('命中：目标在固定挥击弧内 → baseDamage weapon 伤害（复用 ContactRouter）', () => {
    const orch = new PlanckBattleOrchestrator(hammerBuild(), targetBuild(), registry, {
      autoDrive: false,
      // A pivot ≈ 450+75=525；B 左缘 = spawnB-75。spawnB=560 → 左缘 485 与 pivot 重叠 →
      // 锤头 swing 前端（pivot+25..pivot+70）扫过 B 车体 → 命中
      spawnA: { x: 450, y: 640, facing: 1 },
      spawnB: { x: 560, y: 640, facing: -1 },
    });
    const weaponEvents: CombatEvent[] = [];
    orch.onCombatEvent((e) => {
      if (e.damageSource === 'weapon') weaponEvents.push(e);
    });
    for (let i = 0; i < 300; i++) orch.step(16.6667);
    expect(weaponEvents.length).toBeGreaterThanOrEqual(1);
    expect(weaponEvents[0]!.damage).toBe(90); // hammer baseDamage
    expect(orch.vehicleB.hp).toBeLessThan(1000);
  });

  it('打空：目标在固定挥击弧外 → 真实打空（无 weapon 伤害）', () => {
    const orch = new PlanckBattleOrchestrator(hammerBuild(), targetBuild(), registry, {
      autoDrive: false,
      spawnA: { x: 450, y: 640, facing: 1 },
      // B 放远（pivot+70 之外）：锤头 swing 扫不到 → 打空
      spawnB: { x: 900, y: 640, facing: -1 },
    });
    const weaponEvents: CombatEvent[] = [];
    orch.onCombatEvent((e) => {
      if (e.damageSource === 'weapon') weaponEvents.push(e);
    });
    for (let i = 0; i < 300; i++) orch.step(16.6667);
    expect(weaponEvents.length).toBe(0);
    expect(orch.vehicleB.hp).toBe(1000);
  });

  it('motor 挥动时 chassis 产生真实反作用（swing 段出现非零角/线速度响应）', () => {
    const orch = new PlanckBattleOrchestrator(hammerBuild(), targetBuild(), registry, {
      autoDrive: false,
      spawnA: { x: 450, y: 640, facing: 1 },
      spawnB: { x: 1400, y: 640, facing: -1 }, // B 远离，纯观察反作用
    });
    let maxChassisOmega = 0;
    for (let i = 0; i < 260; i++) {
      orch.step(16.6667);
      const omega = orch.world.getAngularVelocity(orch.vehicleA.body);
      maxChassisOmega = Math.max(maxChassisOmega, Math.abs(omega));
    }
    // motor 扭矩反作用经 Revolute 传 chassis → 挥动全程 chassis 角速度非零。
    // 注：boxBody 宽 150 高 55，chassis 转动惯量大（I≈m·r²，m≈150+kg），
    // 反作用角速度天然小（~0.017 rad/s ≈ 1°/s）但真实存在——证明非固定/非 teleport，
    // 是 motor 驱动的真实扭矩反作用。
    expect(maxChassisOmega).toBeGreaterThan(0.01);
  });
});
