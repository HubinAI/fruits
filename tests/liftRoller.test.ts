import { describe, it, expect } from 'vitest';
import { createRegistry } from '../src/core/content';
import { BattleOrchestrator } from '../src/battle/battleOrchestrator';
import { getPreset } from '../src/lab/presets';

const registry = createRegistry();
const DT = 1000 / 60;

describe('Lift Roller (Queue 05)', () => {
  it('滚轮持续真实旋转（angularVelocity 持续非零）', () => {
    const orch = new BattleOrchestrator(
      getPreset('liftRollerLow')!.build(),
      getPreset('lightVehicle')!.build(),
      registry,
      { autoDrive: false, spawnA: { x: 400, y: 650, facing: 1 }, spawnB: { x: 900, y: 650, facing: -1 } },
    );
    const roller = orch.vehicleA.parts.find((p) => p.def.behavior === 'liftRoller')!;
    let maxAv = 0;
    for (let i = 0; i < 100; i++) {
      orch.step(DT);
      maxAv = Math.max(maxAv, Math.abs(roller.body.angularVelocity));
    }
    expect(maxAv).toBeGreaterThan(0.1);
  });

  it('Direct Damage = 0：滚轮接触不掉血', () => {
    const orch = new BattleOrchestrator(
      getPreset('liftRollerLow')!.build(),
      getPreset('lightVehicle')!.build(),
      registry,
      { autoDrive: false, spawnA: { x: 400, y: 650, facing: 1 }, spawnB: { x: 550, y: 650, facing: -1 } },
    );
    for (let i = 0; i < 400; i++) orch.step(DT);
    expect(orch.vehicleB.hp).toBe(1000); // boxBody hp = 1000
  });

  it('L1：滚轮接触产生真实姿态变化（Force/Posture）', () => {
    const orch = new BattleOrchestrator(
      getPreset('liftRollerLow')!.build(),
      getPreset('lightVehicle')!.build(),
      registry,
      { autoDrive: false, spawnA: { x: 400, y: 650, facing: 1 }, spawnB: { x: 550, y: 650, facing: -1 } },
    );
    let maxAng = 0;
    for (let i = 0; i < 400; i++) {
      orch.step(DT);
      maxAng = Math.max(maxAng, Math.abs(orch.vehicleB.body.angle));
    }
    // 目标被滚轮「卷」起，姿态明显变化（> ~5°）
    expect(maxAng).toBeGreaterThan(0.09);
  });

  it('L2：轻目标的姿态变化（旋转）明显大于重目标', () => {
    const run = (target: 'lightVehicle' | 'heavyVehicle'): number => {
      const orch = new BattleOrchestrator(
        getPreset('liftRollerLow')!.build(),
        getPreset(target)!.build(),
        registry,
        { autoDrive: false, spawnA: { x: 400, y: 650, facing: 1 }, spawnB: { x: 550, y: 650, facing: -1 } },
      );
      let maxAng = 0;
      for (let i = 0; i < 400; i++) {
        orch.step(DT);
        maxAng = Math.max(maxAng, Math.abs(orch.vehicleB.body.angle));
      }
      return maxAng;
    };
    const light = run('lightVehicle');
    const heavy = run('heavyVehicle');
    // 轻目标被抬升旋转更明显（质量小，反作用姿态变化大）
    expect(light).toBeGreaterThan(heavy);
  });

  it('镜像：facing=-1 时滚轮旋转方向镜像（正角速度 = 顺时针）', () => {
    const orch = new BattleOrchestrator(
      getPreset('liftRollerLow')!.build(),
      getPreset('lightVehicle')!.build(),
      registry,
      { autoDrive: false, spawnA: { x: 800, y: 650, facing: -1 }, spawnB: { x: 400, y: 650, facing: 1 } },
    );
    const roller = orch.vehicleA.parts.find((p) => p.def.behavior === 'liftRoller')!;
    let maxAv = 0;
    for (let i = 0; i < 100; i++) {
      orch.step(DT);
      maxAv = Math.max(maxAv, roller.body.angularVelocity);
    }
    // facing=-1 时 spinDirection 镜像（spinDirection=-1 → 实际 +0.5 顺时针）
    expect(maxAv).toBeGreaterThan(0.1);
  });
});
