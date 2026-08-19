/**
 * Queue Q02-C3A｜Projectile Render Snapshot targeted test
 *
 * 覆盖 Q02-C3A 验收：
 * 1. 发射后 Snapshot 出现正确 projectile（仅世界坐标 circle + team）；
 * 2. center 取真实 body 世界位置（真实飞行轨迹）、radius 取真实碰撞几何（circle AABB 半宽）、
 *    team 取 projectile OwnerTag；
 * 3. 命中销毁后 Snapshot 自动消失；
 * 4. optional 语义：Matter Orchestrator 的 Snapshot 不提供 projectiles。
 */
import { describe, it, expect } from 'vitest';
import { createRegistry } from '../src/core/content';
import type { BuildSnapshot } from '../src/core/types';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import { BattleOrchestrator } from '../src/battle/battleOrchestrator';
import { getPreset } from '../src/lab/presets';

const registry = createRegistry();

/** cannon 车：wedgeBody + wheelStd×2 + cannon（front hardpoint） */
function cannonBuild(): BuildSnapshot {
  return {
    id: 'cannonCar',
    bodyDefId: 'wedgeBody',
    quality: 1,
    movements: [
      { hardpointId: 'rear', defId: 'wheelStd' },
      { hardpointId: 'front', defId: 'wheelStd' },
    ],
    functionals: [{ hardpointId: 'front', defId: 'cannon' }],
  };
}

function makeOrch(): PlanckBattleOrchestrator {
  return new PlanckBattleOrchestrator(
    cannonBuild(),
    getPreset('lightVehicle')!.build(),
    registry,
    {
      autoDrive: false,
      spawnA: { x: 400, y: 640, facing: 1 },
      // wedge 车头(78) + 炮管(硬点 66 + 40 → 右缘 506) < B 左缘 565：59px 弹道 ~5 步命中
      spawnB: { x: 640, y: 640, facing: -1 },
    },
  );
}

/** 与 CannonBehavior 一致的炮口世界点（真实 part 姿态 + facing） */
function expectedMuzzle(orch: PlanckBattleOrchestrator): { x: number; y: number } {
  const part = orch.vehicleA.parts.find((p) => p.def.behavior === 'cannon')!;
  const partPos = orch.world.getPosition(part.body);
  const partAngle = orch.world.getAngle(part.body);
  const c = part.def.collider;
  const muzzleLocal = {
    x: 1 * ((c.offset?.x ?? 0) + (c.width ?? 0) / 2),
    y: c.offset?.y ?? 0,
  };
  const rot = (p: { x: number; y: number }, a: number) => ({
    x: p.x * Math.cos(a) - p.y * Math.sin(a),
    y: p.x * Math.sin(a) + p.y * Math.cos(a),
  });
  const off = rot(muzzleLocal, partAngle);
  return { x: partPos.x + off.x, y: partPos.y + off.y };
}

describe('Q02-C3A Projectile Render Snapshot', () => {
  it('发射后 Snapshot 出现正确 projectile：center/radius/team 与真实 Runtime 一致', () => {
    const orch = makeOrch();

    // 发射前：无 projectile
    expect((orch.getRenderSnapshot().projectiles ?? []).length).toBe(0);

    // 第一步发射
    orch.step(16.6667);
    const snap = orch.getRenderSnapshot();
    expect(snap.projectiles).toBeDefined();
    expect(snap.projectiles!.length).toBe(1);
    const pr = snap.projectiles![0]!;

    // team 取 projectile OwnerTag
    expect(pr.team).toBe('A');
    // radius 取真实碰撞几何（circle 的几何 AABB 半宽 = 半径 6）
    expect(pr.radius).toBeCloseTo(6, 3);
    // center 取真实 body 世界位置：一步真实飞行 = 炮口 + 12px（水平），重力 ~0.28px 下落
    const muzzle = expectedMuzzle(orch);
    expect(Math.abs(pr.center.x - (muzzle.x + 12))).toBeLessThan(1);
    expect(Math.abs(pr.center.y - (muzzle.y + 0.3))).toBeLessThan(1);
  });

  it('命中销毁后 Snapshot 自动消失', () => {
    const orch = makeOrch();
    let weaponCount = 0;
    orch.onCombatEvent((e) => {
      if (e.damageSource === 'weapon') weaponCount++;
    });

    // 步进到首次 weapon 命中：该步弹体已销毁 → Snapshot 无 projectile
    let hitStep = -1;
    for (let i = 1; i <= 200 && hitStep < 0; i++) {
      orch.step(16.6667);
      if (weaponCount >= 1) hitStep = i;
    }
    expect(hitStep).toBeGreaterThan(0);
    expect(orch.getRenderSnapshot().projectiles!.length).toBe(0);

    // 命中后、下一次发射（step 61）前：Snapshot 持续为空
    for (let i = 0; i < 20; i++) {
      orch.step(16.6667);
      expect(orch.getRenderSnapshot().projectiles!.length).toBe(0);
    }
  });

  it('optional 语义：Matter Orchestrator 的 Snapshot 不提供 projectiles', () => {
    const matter = new BattleOrchestrator(
      cannonBuild(),
      getPreset('lightVehicle')!.build(),
      registry,
      {
        autoDrive: false,
        spawnA: { x: 400, y: 640, facing: 1 },
        spawnB: { x: 640, y: 640, facing: -1 },
      },
    );
    const snap = matter.getRenderSnapshot();
    expect(snap.projectiles).toBeUndefined();
  });
});
