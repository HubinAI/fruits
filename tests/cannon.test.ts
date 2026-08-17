/**
 * Queue 02：Cannon / Projectile Weapon 测试。
 *
 * 验证：冷却自动开火、真实 Projectile 飞出、命中掉血、Recoil 轻重大小、
 * Body 姿态改变弹道方向、Projectile 撞墙销毁。
 */
import { describe, it, expect } from 'vitest';
import { createRegistry } from '../src/core/content';
import { BattleOrchestrator } from '../src/battle/battleOrchestrator';
import { muzzleTransform } from '../src/battle/weaponFire';
import { getPreset } from '../src/lab/presets';
import type { BuildSnapshot } from '../src/core/types';

const registry = createRegistry();
const DT = 1000 / 60;

function preset(id: string): BuildSnapshot {
  const p = getPreset(id);
  if (!p) throw new Error(`unknown preset ${id}`);
  return p.build();
}

function cannonBuild(bodyDefId: string, weaponId = 'cannon'): BuildSnapshot {
  return {
    id: 'x',
    bodyDefId,
    quality: 1,
    movements: [
      { hardpointId: 'rear', defId: 'wheelStd' },
      { hardpointId: 'front', defId: 'wheelStd' },
    ],
    functionals: [{ hardpointId: 'front', defId: weaponId }],
  };
}

/** 空目标（无武器，静止） */
function dummyTarget(): BuildSnapshot {
  return {
    id: 't',
    bodyDefId: 'boxBody',
    quality: 1,
    movements: [
      { hardpointId: 'rear', defId: 'wheelStd' },
      { hardpointId: 'front', defId: 'wheelStd' },
    ],
    functionals: [],
  };
}

describe('Cannon / Projectile Weapon', () => {
  it('P1：Cannon 按冷却自动开火，Projectile 真实飞出（带 team + 初速度）', () => {
    const orch = new BattleOrchestrator(preset('cannonStandard'), dummyTarget(), registry, {
      autoDrive: false,
      spawnA: { x: 400, y: 650, facing: 1 },
      spawnB: { x: 1200, y: 650, facing: -1 },
    });
    expect(orch.projectiles.length).toBe(0);
    // 冷却 1500ms ≈ 90 步
    for (let i = 0; i < 95; i++) orch.step(DT);
    expect(orch.projectiles.length).toBeGreaterThan(0);
    const p = orch.projectiles[0];
    expect(p.team).toBe('A');
    expect(p.body.velocity.x).toBeGreaterThan(0); // 沿 +X 飞行
  });

  it('P1：Projectile 命中目标真实掉血（Direct Weapon Damage）', () => {
    const orch = new BattleOrchestrator(preset('cannonStandard'), preset('heavyVehicle'), registry, {
      autoDrive: false,
      spawnA: { x: 400, y: 650, facing: 1 },
      spawnB: { x: 700, y: 650, facing: -1 },
    });
    const hpBefore = orch.vehicleB.hp;
    for (let i = 0; i < 400; i++) orch.step(DT);
    expect(orch.vehicleB.hp).toBeLessThan(hpBefore);
  });

  it('P2：Recoil 轻车后退明显大于重车（同炮）', () => {
    function recoilDisplacement(bodyDefId: string): number {
      const orch = new BattleOrchestrator(cannonBuild(bodyDefId, 'cannonHeavy'), dummyTarget(), registry, {
        autoDrive: false,
        spawnA: { x: 400, y: 650, facing: 1 },
        spawnB: { x: 1200, y: 650, facing: -1 },
      });
      const startX = orch.vehicleA.body.position.x;
      for (let i = 0; i < 100; i++) orch.step(DT);
      return startX - orch.vehicleA.body.position.x; // 后退位移（> 0 表示后退）
    }
    const light = recoilDisplacement('boxBody'); // 总质量 ~90
    const heavy = recoilDisplacement('heavyBox'); // 总质量 ~190
    expect(light).toBeGreaterThan(heavy);
    expect(light).toBeGreaterThan(0.5); // 轻车明显后退
  });

  it('P3：Body 姿态改变炮口方向（前倾朝下 vs 后倾朝上）', () => {
    function muzzleDirY(presetId: string): number {
      const orch = new BattleOrchestrator(preset(presetId), dummyTarget(), registry, {
        autoDrive: false,
        spawnA: { x: 400, y: 650, facing: 1 },
        spawnB: { x: 1200, y: 650, facing: -1 },
      });
      const part = orch.vehicleA.parts.find((p) => p.def.behavior === 'cannon')!;
      return muzzleTransform(orch.vehicleA, part).dir.y;
    }
    const down = muzzleDirY('cannonNoseDown'); // 前倾 → 炮口朝下 → dir.y > 0
    const up = muzzleDirY('cannonNoseUp'); // 后倾 → 炮口朝上 → dir.y < 0
    expect(down).toBeGreaterThan(0);
    expect(up).toBeLessThan(0);
  });

  it('Projectile 撞墙销毁（不反弹、不残留）', () => {
    // A 车朝左墙（x 很小，facing=-1），炮弹撞左墙销毁
    const orch = new BattleOrchestrator(preset('cannonStandard'), dummyTarget(), registry, {
      autoDrive: false,
      spawnA: { x: 150, y: 650, facing: -1 },
      spawnB: { x: 1200, y: 650, facing: -1 },
    });
    // 跑到第一发撞墙后（冷却 90 步 + 飞行 ~15 步），此时 projectiles 应为 0
    for (let i = 0; i < 130; i++) orch.step(DT);
    // 第一发已撞墙销毁；130 步 < 第二次开火 180 步，故 projectiles 应为空
    expect(orch.projectiles.length).toBe(0);
  });
});
