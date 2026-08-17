import { describe, it, expect } from 'vitest';
import { createRegistry } from '../src/core/content';
import { BattleOrchestrator } from '../src/battle/battleOrchestrator';
import { getPreset } from '../src/lab/presets';
import type { BuildSnapshot } from '../src/core/types';

const registry = createRegistry();
const DT = 1000 / 60;

function pushRodBuild(id: string, bodyDefId = 'boxBody'): BuildSnapshot {
  return {
    id,
    bodyDefId,
    quality: 1,
    movements: [
      { hardpointId: 'rear', defId: 'wheelStd' },
      { hardpointId: 'front', defId: 'wheelStd' },
    ],
    functionals: [{ hardpointId: 'front', defId: 'pushRod' }],
  };
}

function targetBuild(id: string, bodyDefId: 'boxBody' | 'heavyBox'): BuildSnapshot {
  return {
    id,
    bodyDefId,
    quality: 1,
    movements: [
      { hardpointId: 'rear', defId: 'wheelStd' },
      { hardpointId: 'front', defId: 'wheelStd' },
    ],
    functionals: [],
  };
}

/** 跑一次推击循环，返回目标车位移 */
function runPush(targetDef: 'boxBody' | 'heavyBox', steps = 400): { dx: number; hp: number } {
  const orch = new BattleOrchestrator(
    pushRodBuild('pusher'),
    targetBuild('target', targetDef),
    registry,
    {
      autoDrive: false,
      spawnA: { x: 400, y: 650, facing: 1 },
      spawnB: { x: 620, y: 650, facing: -1 },
    },
  );
  const startX = orch.vehicleB.body.position.x;
  for (let i = 0; i < steps; i++) orch.step(DT);
  return { dx: orch.vehicleB.body.position.x - startX, hp: orch.vehicleB.hp };
}

describe('Push Rod (Queue 04)', () => {
  it('P1/P2：同一推力下轻车位移明显大于重车', () => {
    const light = runPush('boxBody');
    const heavy = runPush('heavyBox');
    // 轻车位移 > 重车位移（有限推力 → 质量不同加速度不同）
    expect(light.dx).toBeGreaterThan(heavy.dx);
    // 轻车被推的距离应可感知
    expect(light.dx).toBeGreaterThan(5);
  });

  it('Direct Damage = 0：推杆推动不掉血', () => {
    const light = runPush('boxBody');
    expect(light.hp).toBe(1000); // boxBody hp = 1000，未扣血
  });

  it('rod 真实伸出：rod 尖端位置沿 facing 方向前进', () => {
    const orch = new BattleOrchestrator(
      pushRodBuild('pusher'),
      targetBuild('target', 'boxBody'),
      registry,
      {
        autoDrive: false,
        spawnA: { x: 400, y: 650, facing: 1 },
        spawnB: { x: 900, y: 650, facing: -1 }, // 放远，避免接触干扰伸出
      },
    );
    const rod = orch.vehicleA.parts.find((p) => p.def.behavior === 'pushRod')!;
    const startX = rod.body.position.x;
    // 跑过冷却 + 伸出阶段
    for (let i = 0; i < 200; i++) orch.step(DT);
    const endX = rod.body.position.x;
    // rod 伸出（position.x 沿 +X 增加）
    expect(endX).toBeGreaterThan(startX + 10);
  });

  it('P3 几何：低位 / 高位安装的 rod 世界 Y 位置明显不同', () => {
    const rodY = (presetId: string): number => {
      const orch = new BattleOrchestrator(
        getPreset(presetId)!.build(),
        targetBuild('target', 'boxBody'),
        registry,
        {
          autoDrive: false,
          spawnA: { x: 400, y: 650, facing: 1 },
          spawnB: { x: 900, y: 650, facing: -1 },
        },
      );
      const rod = orch.vehicleA.parts.find((p) => p.def.behavior === 'pushRod')!;
      return rod.body.position.y;
    };
    const lowY = rodY('pushRodLow');
    const highY = rodY('pushRodHigh');
    // 低位（frontLow y=+25）在车底，Y 更大；高位（frontHigh y=-25）在车顶，Y 更小
    expect(lowY).toBeGreaterThan(highY + 30);
  });

  it('P3：低位 / 高位都能推动目标（推动链路成立）', () => {
    const push = (presetId: string): number => {
      const orch = new BattleOrchestrator(
        getPreset(presetId)!.build(),
        targetBuild('target', 'boxBody'),
        registry,
        {
          autoDrive: false,
          spawnA: { x: 400, y: 650, facing: 1 },
          spawnB: { x: 600, y: 650, facing: -1 },
        },
      );
      const startX = orch.vehicleB.body.position.x;
      for (let i = 0; i < 400; i++) orch.step(DT);
      return orch.vehicleB.body.position.x - startX;
    };
    expect(push('pushRodLow')).toBeGreaterThan(5);
    expect(push('pushRodHigh')).toBeGreaterThan(5);
  });

  it('镜像：facing=-1 时 rod 沿 -X 方向伸出', () => {
    const orch = new BattleOrchestrator(
      getPreset('pushRodVehicle')!.build(),
      targetBuild('target', 'boxBody'),
      registry,
      {
        autoDrive: false,
        spawnA: { x: 800, y: 650, facing: -1 },
        spawnB: { x: 400, y: 650, facing: 1 },
      },
    );
    const rod = orch.vehicleA.parts.find((p) => p.def.behavior === 'pushRod')!;
    const startX = rod.body.position.x;
    for (let i = 0; i < 200; i++) orch.step(DT);
    // 朝左的车，rod 沿 -X 伸出（position.x 减小）
    expect(rod.body.position.x).toBeLessThan(startX - 10);
  });
});
