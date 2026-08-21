/**
 * Queue W1-BH-1｜Generic Behavior Runtime Registry targeted test
 *
 * 覆盖 W1-BH-1 验收：
 * 1. 注册表含 cannon / hammer / pushRod；未知 behavior → undefined（不报错）；
 * 2. factory 创建统一 PartBehaviorRuntime；cannon runtime 真正驱动发射
 *    （beforePhysicsStep → projectile 出现 → getRenderProjectiles 贡献 1 个）；
 * 3. 生命周期差异正确：cannon 有 afterPhysicsStep / destroyOutOfBoundsProjectiles /
 *    getRenderProjectiles；hammer / pushRod 无 projectile 相关能力（undefined）。
 */
import { describe, it, expect } from 'vitest';
import { createRegistry } from '../src/core/content';
import { resolveSnapshot } from '../src/core/buildSnapshot';
import { PlanckWorld } from '../src/physics/planckWorld';
import {
  createPlanckVehicle,
  settlePlanckVehicleToRestPose,
} from '../src/battle/planckVehicleAssembly';
import { getBehaviorFactory, registeredBehaviorIds } from '../src/battle/behaviorRegistry';
import type { PartBehaviorRuntime } from '../src/battle/behaviorRuntime';
import type { BuildSnapshot } from '../src/core/types';

const registry = createRegistry();

function makeVehicle(partDefId: string) {
  const world = new PlanckWorld({ x: 0, y: 10 });
  const ground = world.createStaticGround(0, 700, 4000, 80);
  world.setOwnerTag(ground, { kind: 'ground' });
  const build: BuildSnapshot = {
    id: 'car',
    bodyDefId: 'boxBody',
    quality: 1,
    movements: [
      { hardpointId: 'rear', defId: 'wheelStd' },
      { hardpointId: 'front', defId: 'wheelStd' },
    ],
    functionals: [{ hardpointId: 'front', defId: partDefId }],
  };
  const v = createPlanckVehicle(world, resolveSnapshot(build, registry), 'A', { x: 400, y: 640 }, 1);
  settlePlanckVehicleToRestPose(world, v, ground);
  return { world, vehicle: v, part: v.parts[0]! };
}

function makeRuntime(behaviorId: string): {
  runtime: PartBehaviorRuntime;
  world: PlanckWorld;
} {
  const { world, vehicle, part } = makeVehicle(
    behaviorId === 'cannon' ? 'cannon' : behaviorId === 'hammer' ? 'hammer' : behaviorId === 'pushRod' ? 'pushRod' : behaviorId === 'shotgun' ? 'shotgun' : behaviorId === 'thruster' ? 'thruster' : 'saw',
  );
  const factory = getBehaviorFactory(behaviorId)!;
  const runtime = factory({ vehicle, part, emit: () => {} });
  return { runtime, world };
}

describe('W1-BH-1 Behavior Registry', () => {
  it('1. 注册表含 cannon/hammer/pushRod/laser/lifter/rammer/saw；未知 behavior → undefined', () => {
    expect(registeredBehaviorIds().sort()).toEqual(['cannon', 'hammer', 'laser', 'lifter', 'pushRod', 'rammer', 'saw', 'shotgun', 'thruster']);
    expect(getBehaviorFactory('cannon')).toBeDefined();
    expect(getBehaviorFactory('hammer')).toBeDefined();
    expect(getBehaviorFactory('pushRod')).toBeDefined();
    expect(getBehaviorFactory('laser')).toBeDefined(); // Q11-C 蓄能镭射
    expect(getBehaviorFactory('lifter')).toBeDefined(); // Q12-B 举升臂（prototype/hold）
    expect(getBehaviorFactory('rammer')).toBeDefined(); // Q12-C 冲锤
    expect(getBehaviorFactory('saw')).toBeDefined(); // Q13-A 圆锯
    expect(getBehaviorFactory('shotgun')).toBeDefined(); // Q13-B 霰弹炮
    expect(getBehaviorFactory('thruster')).toBeDefined(); // Q13-C 推进器
    expect(getBehaviorFactory('ram')).toBeUndefined(); // 未注册（Weld-only）
    expect(getBehaviorFactory('noSuch')).toBeUndefined();
  });

  it('2. cannon runtime：beforePhysicsStep 真正发射 → projectile 渲染贡献 1 个', () => {
    const { runtime, world } = makeRuntime('cannon');
    // 首个 fixed step 就绪即发射
    runtime.beforePhysicsStep(world, 0);
    const shots = runtime.getRenderProjectiles!(world);
    expect(shots.length).toBe(1);
    expect(shots[0]!.team).toBe('A');
    expect(shots[0]!.radius).toBeGreaterThan(0);
  });

  it('2b. shotgun runtime：beforePhysicsStep 真正齐射 → 5 个 projectile（固定扇形，可复现）', () => {
    const { runtime, world } = makeRuntime('shotgun');
    runtime.beforePhysicsStep(world, 0);
    const shots = runtime.getRenderProjectiles!(world);
    expect(shots.length).toBe(5); // 一次齐射 = 5 发真实 projectile
    expect(shots.every((s) => s.team === 'A')).toBe(true);
    expect(shots.every((s) => s.radius > 0)).toBe(true);
  });

  it('2c. thruster runtime：固定周期 windup→thrust→cooldown；thrust 期喷焰出现且 chassis 受真实冲量（方向=车辆真实前向）', () => {
    const { runtime, world } = makeRuntime('thruster');
    const vx = (): number => world.getLinearVelocity(runtime.vehicle.body).x;
    // 前摇（共 14 步，windupMs≈250 在「第 15 步」切换到 thrust）：前摇显示喷口小橙光
    // （phase='windup'），不施力、不出现长焰
    for (let i = 0; i < 14; i++) runtime.beforePhysicsStep(world, i * 16.6667);
    const windupFlames = runtime.getRenderFlames!(world);
    expect(windupFlames.length).toBe(1); // Q13-C-R3：前摇喷口小橙光
    expect(windupFlames[0]!.phase).toBe('windup');
    const vEndWindup = vx();
    // 进入 thrust（第 15 步切换并开始施力）
    runtime.beforePhysicsStep(world, 14 * 16.6667);
    expect(runtime.getRenderFlames!(world).length).toBe(1); // 推进期喷焰出现
    const flame = runtime.getRenderFlames!(world)[0]!;
    expect(flame.team).toBe('A');
    expect(flame.length).toBeGreaterThan(0);
    expect(flame.width).toBeGreaterThan(0);
    // Q13-C-R2：方向=车辆真实前向（facing=+1 → 推进 +X），喷焰=-前向 → dirX<0（车尾反方向）
    expect(flame.dirX).toBeLessThan(0);
    // thrust 期 chassis 受真实冲量：沿 +X（车头方向=推进方向，安装位置不再反转方向）
    for (let i = 0; i < 5; i++) runtime.beforePhysicsStep(world, (15 + i) * 16.6667);
    const vAfterThrust = vx();
    expect(vAfterThrust).toBeGreaterThan(vEndWindup); // 真实冲量推进（非 setVelocity）
    expect(vAfterThrust).toBeGreaterThan(0); // facing=+1 → 向 +X 推（车头方向）
    // 进入冷却：喷焰立即消失
    for (let i = 0; i < 40; i++) runtime.beforePhysicsStep(world, (20 + i) * 16.6667);
    expect(runtime.getRenderFlames!(world).length).toBe(0); // 冷却期无喷焰
  });

  it('3. 生命周期差异：cannon 有 projectile 能力；hammer/pushRod 无', () => {
    const c = makeRuntime('cannon');
    expect(typeof c.runtime.afterPhysicsStep).toBe('function');
    expect(typeof c.runtime.destroyOutOfBoundsProjectiles).toBe('function');
    expect(typeof c.runtime.getRenderProjectiles).toBe('function');

    for (const id of ['hammer', 'pushRod'] as const) {
      const r = makeRuntime(id);
      expect(r.runtime.afterPhysicsStep).toBeUndefined();
      expect(r.runtime.destroyOutOfBoundsProjectiles).toBeUndefined();
      expect(r.runtime.getRenderProjectiles).toBeUndefined();
      // 状态机仍可驱动（不抛错）
      expect(() => r.runtime.beforePhysicsStep(r.world, 0)).not.toThrow();
    }
  });
});
