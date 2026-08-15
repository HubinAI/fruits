import { describe, it, expect } from 'vitest';
import { createRegistry } from '../src/core/content';
import { BattleOrchestrator } from '../src/battle/battleOrchestrator';
import { getPreset } from '../src/lab/presets';

const registry = createRegistry();
const light = getPreset('lightVehicle')!.build();
const DT = 1000 / 60;

describe('Grounded Wheel 驱动', () => {
  it('双轮接地后，接地轮被驱动（角速度朝前进方向）', () => {
    const orch = new BattleOrchestrator(light, light, registry, {
      autoDrive: true,
      spawnA: { x: 600, y: 640, angle: 0 },
      spawnB: { x: 1400, y: 640, angle: Math.PI },
    });
    for (let i = 0; i < 120; i++) orch.step(DT);

    const grounded = orch.vehicleA.wheels.filter((w) => w.grounded);
    expect(grounded.length).toBeGreaterThan(0);
    for (const w of grounded) {
      // A 车朝 +X 前进，轮子顺时针（正角速度）
      expect(w.body.angularVelocity).toBeGreaterThan(0.5);
    }
  });

  it('全轮腾空时不产生凭空牵引（角速度保持 ~0）', () => {
    const orch = new BattleOrchestrator(light, light, registry, {
      autoDrive: true,
      spawnA: { x: 600, y: 200, angle: 0 },
      spawnB: { x: 1400, y: 640, angle: Math.PI },
    });
    // 前几帧 A 车仍在空中
    for (let i = 0; i < 5; i++) orch.step(DT);
    for (const w of orch.vehicleA.wheels) {
      expect(w.grounded).toBe(false);
      // 腾空轮不被 driveVehicle 驱动，角速度应接近 0（允许约束微小扰动）
      expect(Math.abs(w.body.angularVelocity)).toBeLessThan(0.1);
    }
  });
});
