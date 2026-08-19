/**
 * Queue Q02-C1A｜Cannon Fire + Cooldown + Recoil targeted test
 *
 * 覆盖 Q02-C1A 验收：
 * 1. 首发（初始就绪）+ cooldownMs 固定步周期；
 * 2. projectile owner / radius / mass / bullet / velocity 正确；
 * 3. A/B facing 相反 → 发射方向 +X / -X 正确，炮口外缘位置正确；
 * 4. recoil 与 projectile 动量方向严格相反（J/m 真实冲量），并产生真实物理响应；
 * 5. Orchestrator 正式插入口接线：首发近乎立即命中，冷却 ≈ 1000ms（60 固定步）→ 两次 weapon 命中。
 */
import { describe, it, expect } from 'vitest';
import { createRegistry } from '../src/core/content';
import type { BuildSnapshot } from '../src/core/types';
import { resolveSnapshot } from '../src/core/buildSnapshot';
import { PlanckWorld } from '../src/physics/planckWorld';
import {
  createPlanckVehicle,
  settlePlanckVehicleToRestPose,
  type PlanckVehicle,
} from '../src/battle/planckVehicleAssembly';
import { CannonBehavior } from '../src/battle/cannonBehavior';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import type { CombatEvent } from '../src/battle/combatEvents';
import { CombatEventBus } from '../src/battle/combatEvents';
import { ContactRouter } from '../src/battle/contactRouter';
import { DamageResolver } from '../src/battle/damageResolver';
import { PlanckArenaRuntime } from '../src/battle/planckArenaRuntime';
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

/** 真实 Planck 世界装配 + 贴地静置（地面带 OwnerTag kind=ground，与正式 Arena 一致；
 *  无 tag 的地面会让轮子↔地面 begin 被 Router 跳过，破坏 batch 连续性导致 projectile 伤害被丢弃） */
function makeVehicle(
  world: PlanckWorld,
  team: 'A' | 'B',
  x: number,
  facing: 1 | -1,
  build: BuildSnapshot = cannonBuild(),
): PlanckVehicle {
  const ground = world.createStaticGround(0, 700, 4000, 80);
  world.setOwnerTag(ground, { kind: 'ground' });
  const v = createPlanckVehicle(
    world,
    resolveSnapshot(build, registry),
    team,
    { x, y: 640 },
    facing,
  );
  settlePlanckVehicleToRestPose(world, v, ground);
  return v;
}

function cannonPart(v: PlanckVehicle) {
  const part = v.parts.find((p) => p.def.behavior === 'cannon');
  expect(part).toBeDefined();
  return part!;
}

/** 手动接线（与 Orchestrator 相同语义）：真实 ContactRouter 消费 Planck 接触事件 */
function makeHitHarness(world: PlanckWorld, vehicles: PlanckVehicle[]) {
  const bus = new CombatEventBus();
  const events: CombatEvent[] = [];
  bus.subscribe((e) => events.push(e));
  const router = new ContactRouter(vehicles, new DamageResolver(bus));
  world.setBatchedContactListener((ev) => router.handlePlanckContact(world, ev));
  return { router, events };
}

describe('Q02-C1A Cannon Behavior（单元）', () => {
  it('首发即发射；按 cooldownMs 固定步计时（60 步间隔）；projectile 参数正确', () => {
    const world = new PlanckWorld({ x: 0, y: 10 });
    const v = makeVehicle(world, 'A', 400, 1);
    const part = cannonPart(v);
    const behavior = new CannonBehavior(part);

    // 首个 fixed step 发射
    const r1 = behavior.stepFixed(world, v, part);
    expect(r1.fired).toBe(true);
    expect(r1.projectile).not.toBeNull();
    const p1 = r1.projectile!;

    // owner：kind='projectile' + shooter team + cannon partId
    expect(world.getOwnerTag(p1)).toEqual({
      kind: 'projectile',
      vehicleId: 'cannonCar',
      partId: 'part:front',
      team: 'A',
    });
    // mass / spawn 参数（radius / bullet / velocity）
    expect(world.getMass(p1)).toBeCloseTo(1, 6);
    expect(r1.spawn).not.toBeNull();
    expect(r1.spawn!.radius).toBe(10); // Q02-EXP-R1：6→10
    expect(r1.spawn!.bullet).toBe(true);
    // 初速度 = 射手速度（静置 ≈0）+ 炮口方向(+X) × muzzleSpeed(8)（Q02-EXP-R1：12→8）
    const vel = world.getLinearVelocity(p1);
    expect(vel.x).toBeCloseTo(8, 3);
    expect(vel.y).toBeCloseTo(0, 3);
    // 炮口外缘：projectile 在 part 前方
    expect(world.getPosition(p1).x).toBeGreaterThan(world.getPosition(part.body).x);

    // Recoil：part 立即获得反向速度 = -recoilImpulse/mass = -30/20 = -1.5（Q02-EXP-R1：12→30；真实 J/m，非 setLinearVelocity）
    const partVel = world.getLinearVelocity(part.body);
    expect(partVel.x).toBeCloseTo(-1.5, 3);
    expect(partVel.y).toBeCloseTo(0, 3);

    // 冷却中：后续 59 步（调用 2..60）不发射
    for (let i = 0; i < 59; i++) {
      const r = behavior.stepFixed(world, v, part);
      expect(r.fired).toBe(false);
      expect(r.projectile).toBeNull();
    }
    // 第 61 次调用再次发射（60 步间隔 = 1000ms），且是新实例
    const r61 = behavior.stepFixed(world, v, part);
    expect(r61.fired).toBe(true);
    expect(r61.projectile).not.toBeNull();
    expect(r61.projectile).not.toBe(p1);

    // Recoil 真实物理响应：后续步进中整车获得 -X 速度（Weld 把冲量传给整车）
    for (let i = 0; i < 10; i++) world.stepFixed(1);
    expect(world.getLinearVelocity(v.body).x).toBeLessThan(0);
  });

  it('A/B facing 相反：projectile 发射方向 +X / -X，炮口位置在 facing 侧', () => {
    const world = new PlanckWorld({ x: 0, y: 10 });
    const va = makeVehicle(world, 'A', 400, 1);
    const vb = makeVehicle(world, 'B', 1200, -1);
    const pa = cannonPart(va);
    const pb = cannonPart(vb);
    const ba = new CannonBehavior(pa);
    const bb = new CannonBehavior(pb);

    const ra = ba.stepFixed(world, va, pa);
    expect(ra.fired).toBe(true);
    const velA = world.getLinearVelocity(ra.projectile!);
    expect(velA.x).toBeGreaterThan(0); // A → +X
    expect(velA.y).toBeCloseTo(0, 3);
    expect(world.getPosition(ra.projectile!).x).toBeGreaterThan(
      world.getPosition(pa.body).x,
    );

    const rb = bb.stepFixed(world, vb, pb);
    expect(rb.fired).toBe(true);
    const velB = world.getLinearVelocity(rb.projectile!);
    expect(velB.x).toBeLessThan(0); // B → -X
    expect(velB.y).toBeCloseTo(0, 3);
    expect(world.getPosition(rb.projectile!).x).toBeLessThan(
      world.getPosition(pb.body).x,
    );
  });
});

describe('Q02-C1A Orchestrator 正式插入口（端到端）', () => {
  it('首发 + 冷却 ≈1000ms → 四次 weapon 命中各 80（每次命中即销毁，伤害只发生一次）', () => {
    // 敌方用带轮子/部件的正式 lightVehicle：Q02-C1B 销毁生效后，
    // 弹体命中即销毁，不会下滑触轮产生第二次伤害——每发恰一次 weapon 伤害。
    const enemy = getPreset('lightVehicle')!.build();
    const orch = new PlanckBattleOrchestrator(cannonBuild(), enemy, registry, {
      autoDrive: false,
      spawnA: { x: 400, y: 640, facing: 1 },
      // Q02-EXP-R1：muzzleSpeed 8 + recoilImpulse 30 下，A 每发后坐会把车推离目标，
      // spawnB 过远时后 2 发会打空（真实物理）。实测 spawnB=580 → 4 发全中（step 1/61/121/181）。
      spawnB: { x: 580, y: 640, facing: -1 },
    });
    const weaponEvents: CombatEvent[] = [];
    orch.onCombatEvent((e) => {
      if (e.damageSource === 'weapon') weaponEvents.push(e);
    });

    // 记录每次 weapon 伤害出现的 step 序号（batched 监听在 step() 内同步交付）
    const hitSteps: number[] = [];
    for (let i = 1; i <= 200; i++) {
      orch.step(16.6667);
      if (weaponEvents.length > hitSteps.length) hitSteps.push(i);
    }

    // 200 步 ÷ 60 步冷却 = 4 发（step 1/61/121/181），弹道 ~8-10 步 → 命中于 ~10/71/132/192 附近
    expect(hitSteps.length).toBe(4);
    for (const ev of weaponEvents) {
      expect(ev.damage).toBe(80);
    }
    // 首发近乎立即（step 1 发射，弹道 ~8 步；Q02-EXP-R1 muzzleSpeed 8 后放宽容差）
    expect(hitSteps[0]!).toBeLessThan(15);
    // 冷却周期 ≈ 60 固定步 = 1000ms（±12 步容差，含 recoil 后座位移影响）
    for (let i = 1; i < hitSteps.length; i++) {
      expect(Math.abs(hitSteps[i]! - hitSteps[i - 1]! - 60)).toBeLessThan(12);
    }
    // 敌方 hp 精确扣 4×80
    expect(orch.vehicleB.hp).toBe(680);
  });
});

describe('Q02-C1B Projectile Lifecycle', () => {
  it('hostile 命中：伤害只发生一次，随后 projectile 销毁（无 stale-handle 异常）', () => {
    const world = new PlanckWorld({ x: 0, y: 10 });
    const va = makeVehicle(world, 'A', 400, 1); // cannon 车
    // 带轮子/部件目标：若未销毁，弹体会下滑触轮产生第二次伤害——销毁语义下只发生一次
    const vb = makeVehicle(world, 'B', 620, -1, getPreset('lightVehicle')!.build());
    const pa = cannonPart(va);
    const behavior = new CannonBehavior(pa);
    const { router, events } = makeHitHarness(world, [va, vb]);

    const r1 = behavior.stepFixed(world, va, pa);
    expect(r1.fired).toBe(true);
    const p1 = r1.projectile!;
    expect(behavior.aliveProjectiles.length).toBe(1);

    let hit = false;
    for (let i = 0; i < 200 && !hit; i++) {
      world.stepFixed(1);
      const facts = router.drainProjectileContactFacts();
      behavior.consumeProjectileFacts(world, facts);
      hit = events.some((e) => e.damageSource === 'weapon');
    }
    expect(hit).toBe(true);
    // 伤害只发生一次（命中即销毁 → 不会下滑触轮产生第二次）
    expect(events.filter((e) => e.damageSource === 'weapon').length).toBe(1);
    expect(vb.hp).toBe(920);
    // projectile 已销毁并从追踪集合移除；handle 失效（非 stale 半死状态）
    expect(behavior.aliveProjectiles.length).toBe(0);
    expect(() => world.getPosition(p1)).toThrow();
    // 销毁后继续步进无异常
    expect(() => world.stepFixed(5)).not.toThrow();
  });

  it('撞 arena 墙：销毁且无额外伤害', () => {
    const world = new PlanckWorld({ x: 0, y: 10 });
    const va = makeVehicle(world, 'A', 400, 1);
    const pa = cannonPart(va);
    const behavior = new CannonBehavior(pa);
    const { router, events } = makeHitHarness(world, [va]);
    // A 正前方真实静态墙 + OwnerTag kind=arena：弹体 ~2 步撞上
    const wall = world.createStaticBox(520, 640, 12, 300);
    world.setOwnerTag(wall, { kind: 'arena' });

    const r1 = behavior.stepFixed(world, va, pa);
    expect(r1.fired).toBe(true);
    const p1 = r1.projectile!;

    for (let i = 0; i < 60; i++) {
      world.stepFixed(1);
      const facts = router.drainProjectileContactFacts();
      behavior.consumeProjectileFacts(world, facts);
      if (behavior.aliveProjectiles.length === 0) break;
    }
    expect(behavior.aliveProjectiles.length).toBe(0);
    expect(() => world.getPosition(p1)).toThrow();
    expect(events.length).toBe(0); // arena 非 vehicle → 无伤害
  });

  it('打空：持续真实飞行；越界后销毁，无 stale-handle 异常', () => {
    const world = new PlanckWorld({ x: 0, y: 10 });
    const va = makeVehicle(world, 'A', 400, 1);
    const pa = cannonPart(va);
    const behavior = new CannonBehavior(pa);
    const { router } = makeHitHarness(world, [va]);

    const r1 = behavior.stepFixed(world, va, pa);
    expect(r1.fired).toBe(true);
    const p1 = r1.projectile!;

    // 打空：持续飞行数步，未接触、未越界 → 保持存活且可读位置
    for (let i = 0; i < 5; i++) {
      world.stepFixed(1);
      const facts = router.drainProjectileContactFacts();
      behavior.consumeProjectileFacts(world, facts);
    }
    expect(behavior.aliveProjectiles.length).toBe(1);
    expect(() => world.getPosition(p1)).not.toThrow();

    // 越界判定（真实 arena.isOutOfProjectileBounds：y < projectileTopY=-50）→ 销毁
    const arena = new PlanckArenaRuntime(world);
    world.setPosition(p1, 300, -100);
    expect(arena.isOutOfProjectileBounds(world.getPosition(p1))).toBe(true);
    behavior.destroyProjectile(world, p1);

    expect(behavior.aliveProjectiles.length).toBe(0);
    expect(() => world.getPosition(p1)).toThrow(); // 已销毁
    // 已销毁 handle 再次销毁 → 明确报错（不静默 no-op）
    expect(() => behavior.destroyProjectile(world, p1)).toThrow();
    // 销毁后继续步进无异常
    expect(() => world.stepFixed(5)).not.toThrow();
  });
});
