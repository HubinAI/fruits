/**
 * Queue 03：Heavy Hammer / Swing Weapon 测试。
 *
 * 验证：真实挥击轨迹、命中 Direct Damage、挥空、左右镜像 swing 方向。
 */
import { describe, it, expect } from 'vitest';
import { createRegistry } from '../src/core/content';
import { BattleOrchestrator } from '../src/battle/battleOrchestrator';
import { getPreset } from '../src/lab/presets';
import type { BuildSnapshot } from '../src/core/types';

const registry = createRegistry();
const DT = 1000 / 60;

function preset(id: string): BuildSnapshot {
  const p = getPreset(id);
  if (!p) throw new Error(`unknown preset ${id}`);
  return p.build();
}

describe('Hammer Swing Weapon', () => {
  it('Hammer arm 真实绕 hardpoint 挥击（angle 显著变化）', () => {
    const orch = new BattleOrchestrator(preset('hammerVehicle'), preset('heavyVehicle'), registry, {
      autoDrive: false,
      spawnA: { x: 500, y: 650, facing: 1 },
      spawnB: { x: 800, y: 650, facing: -1 },
    });
    const part = orch.vehicleA.parts.find((p) => p.def.behavior === 'hammer')!;
    const a0 = part.body.angle;
    for (let i = 0; i < 200; i++) orch.step(DT);
    // arm 挥击了（角度变化 > ~28°）
    expect(Math.abs(part.body.angle - a0)).toBeGreaterThan(0.5);
  });

  it('H1：Hammer 命中近距离目标真实掉血', () => {
    const orch = new BattleOrchestrator(preset('hammerVehicle'), preset('heavyVehicle'), registry, {
      autoDrive: false,
      spawnA: { x: 500, y: 650, facing: 1 },
      spawnB: { x: 690, y: 650, facing: -1 },
    });
    const hpBefore = orch.vehicleB.hp;
    for (let i = 0; i < 600; i++) orch.step(DT);
    expect(orch.vehicleB.hp).toBeLessThan(hpBefore);
  });

  it('H3：距离不对 Hammer 真实挥空不造成 Damage', () => {
    const orch = new BattleOrchestrator(preset('hammerVehicle'), preset('heavyVehicle'), registry, {
      autoDrive: false,
      spawnA: { x: 500, y: 650, facing: 1 },
      spawnB: { x: 850, y: 650, facing: -1 },
    });
    const hpBefore = orch.vehicleB.hp;
    for (let i = 0; i < 600; i++) orch.step(DT);
    expect(orch.vehicleB.hp).toBe(hpBefore);
  });

  it('左右镜像：facing=1 与 facing=-1 的 swing 方向相反', () => {
    function swingDir(facing: 1 | -1): number {
      const orch = new BattleOrchestrator(preset('hammerVehicle'), preset('heavyVehicle'), registry, {
        autoDrive: false,
        spawnA: { x: 500, y: 650, facing },
        spawnB: { x: 850, y: 650, facing: -1 },
      });
      const part = orch.vehicleA.parts.find((p) => p.def.behavior === 'hammer')!;
      // 冷却 1800ms ≈ 108 步，跑 115 步让开火刚发生、arm 正在挥击
      for (let i = 0; i < 115; i++) orch.step(DT);
      return part.body.angularVelocity;
    }
    const right = swingDir(1);
    const left = swingDir(-1);
    expect(right).toBeGreaterThan(0);
    expect(left).toBeLessThan(0);
  });
});
