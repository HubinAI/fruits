/**
 * Queue Q05-C1｜Lift Roller Continuous Motor targeted test
 *
 * 覆盖 Q05-C1 验收：
 * 1. Continuous Revolute motor：roller angle 单调累计旋转（不来回摆），无状态机/无 limit；
 * 2. 端到端：接触轻目标真实改变 B 的 y / angle / grounded 至少一个；
 * 3. Gadget weapon damage = 0；roller 接触产生真实自身反作用；
 * 4. 同一套 motor 参数面对不同目标（无按质量补偿）：轻目标响应明显大于重目标；
 * 5. 额外端到端：目标轮被 Roller 顶离地面时 grounded true→false、落地后 false→true
 *    （真实 wheel↔ground；drivePlanckVehicle 在 grounded=false 时关闭 wheel motor 的
 *    语义由既有代码保证：motor.enabled = cmd.enabled && w.grounded）。
 */
import { describe, it, expect } from 'vitest';
import { createRegistry } from '../src/core/content';
import type { BuildSnapshot } from '../src/core/types';
import { resolveSnapshot } from '../src/core/buildSnapshot';
import { PlanckWorld } from '../src/physics/planckWorld';
import { createPlanckVehicle, settlePlanckVehicleToRestPose } from '../src/battle/planckVehicleAssembly';
import { LiftRollerBehavior } from '../src/battle/liftRollerBehavior';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import type { CombatEvent } from '../src/battle/combatEvents';

const registry = createRegistry();

function liftBuild(): BuildSnapshot {
  return {
    id: 'liftCar',
    bodyDefId: 'boxBody',
    quality: 1,
    movements: [
      { hardpointId: 'rear', defId: 'wheelStd' },
      { hardpointId: 'front', defId: 'wheelStd' },
    ],
    functionals: [{ hardpointId: 'front', defId: 'liftRoller' }],
  };
}

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
    resolveSnapshot(liftBuild(), registry),
    'A',
    { x: 400, y: 640 },
    1,
  );
  settlePlanckVehicleToRestPose(world, v, ground);
  return { world, v };
}

function makeOrch(spawnBX: number, bodyDefId = 'boxBody') {
  return new PlanckBattleOrchestrator(liftBuild(), targetBuild(bodyDefId), registry, {
    autoDrive: false,
    spawnA: { x: 450, y: 640, facing: 1 },
    spawnB: { x: spawnBX, y: 640, facing: -1 },
  });
}

/** 跑 360 步测量目标响应与 A 反作用 */
function measure(spawnBX: number, bodyDefId: string): {
  yShift: number;
  angShift: number;
  aShift: number;
  weaponCount: number;
  groundedFalse: boolean;
} {
  const orch = makeOrch(spawnBX, bodyDefId);
  let weaponCount = 0;
  orch.onCombatEvent((e: CombatEvent) => {
    if (e.damageSource === 'weapon') weaponCount++;
  });
  const bY0 = orch.world.getPosition(orch.vehicleB.body).y;
  const bA0 = orch.world.getAngle(orch.vehicleB.body);
  const aX0 = orch.world.getPosition(orch.vehicleA.body).x;
  let maxY = 0;
  let maxA = 0;
  let groundedFalse = false;
  for (let i = 0; i < 360; i++) {
    orch.step(16.6667);
    const y = orch.world.getPosition(orch.vehicleB.body).y;
    const a = orch.world.getAngle(orch.vehicleB.body);
    maxY = Math.max(maxY, Math.abs(y - bY0));
    maxA = Math.max(maxA, Math.abs(a - bA0));
    if (orch.vehicleB.wheels.some((w) => !w.grounded)) groundedFalse = true;
  }
  const aX1 = orch.world.getPosition(orch.vehicleA.body).x;
  return {
    yShift: maxY,
    angShift: maxA,
    aShift: aX1 - aX0,
    weaponCount,
    groundedFalse,
  };
}

describe('Q05-C1 LiftRollerBehavior 单元', () => {
  it('continuous motor：roller angle 单调累计旋转（不来回摆）', () => {
    const { world, v } = makeVehicle();
    const part = v.parts.find((p) => p.def.behavior === 'liftRoller')!;
    const behavior = new LiftRollerBehavior(part);
    let total = 0;
    let prev = 0;
    for (let i = 0; i < 300; i++) {
      behavior.stepFixed(world, v, part);
      world.stepFixed(1);
      const a = world.getRevoluteAngle(part.joint);
      let d = a - prev;
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      total += d; // 带符号累计（连续单向）
      prev = a;
    }
    expect(total).toBeGreaterThan(Math.PI * 2); // 累计一整圈以上（连续，非来回摆）
  });
});

describe('Q05-C1 Orchestrator 端到端', () => {
  it('接触轻目标：真实改变 B 的 y / angle / grounded；无 weapon damage；A 有真实反作用', () => {
    const r = measure(560, 'boxBody'); // Q05-C1 实测 bx=560 顶起效果最佳
    // 至少一个真实改变
    expect(r.yShift > 5 || r.angShift > 0.05 || r.groundedFalse).toBe(true);
    // 明确出现轮子离地（grounded false）
    expect(r.groundedFalse).toBe(true);
    // Gadget：无 weapon damage、无直接扣血
    expect(r.weaponCount).toBe(0);
    expect(r.aShift).not.toBe(0);
    expect(Math.abs(r.aShift)).toBeGreaterThan(1); // roller 接触的真实反作用
  });

  it('同一套 motor 参数：轻目标响应明显大于重目标（无按质量补偿）', () => {
    const light = measure(560, 'boxBody'); // baseMass 50
    const heavy = measure(560, 'heavyBox'); // baseMass 150
    // 轻目标被顶起/倾斜明显更明显
    expect(light.yShift).toBeGreaterThan(heavy.yShift);
    expect(light.angShift).toBeGreaterThan(heavy.angShift);
    // 参数固定（同一套）：两个 behavior 的 motor speed 相同
    const bLight = new LiftRollerBehavior(
      makeOrch(560, 'boxBody').vehicleA.parts.find((p) => p.def.behavior === 'liftRoller')!,
    );
    const bHeavy = new LiftRollerBehavior(
      makeOrch(560, 'heavyBox').vehicleA.parts.find((p) => p.def.behavior === 'liftRoller')!,
    );
    expect(bLight.speedRadPerStep).toBe(bHeavy.speedRadPerStep);
  });

  it('端到端 grounded 翻转：目标轮被顶离地 true→false，落地后 false→true（真实 wheel↔ground）', () => {
    const orch = makeOrch(560, 'boxBody');
    // 记录 B 全部轮子的 grounded 状态序列
    const seq: Array<{ step: number; grounded: boolean[] }> = [];
    for (let i = 1; i <= 360; i++) {
      orch.step(16.6667);
      seq.push({ step: i, grounded: orch.vehicleB.wheels.map((w) => w.grounded) });
    }
    // 初始接地（settle 后 true）
    expect(seq[0]!.grounded.every(Boolean)).toBe(true);
    // 被顶离地：出现 grounded=false
    const firstFalseIdx = seq.findIndex((s) => s.grounded.includes(false));
    expect(firstFalseIdx).toBeGreaterThanOrEqual(0);
    // 落地恢复：false 之后又出现全部 true
    expect(seq.slice(firstFalseIdx).some((s) => s.grounded.every(Boolean))).toBe(true);
    // 说明：drivePlanckVehicle 在 grounded=false 时关闭 wheel motor 的语义由
    // motor.enabled = command.enabled && w.grounded（planckMovement.ts L65）保证，
    // 已被既有 baselineDrive / foundationCanonical 测试覆盖；此处验证 grounded 真实翻转。
  });
});
