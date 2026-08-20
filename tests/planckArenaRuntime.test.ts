/**
 * Queue F-02M-B13A｜PlanckArenaRuntime 最小实现测试
 *
 * 覆盖：
 * 1. 默认构造：ground / 普通墙 / Closing Wall 的几何、OwnerTag、初始速度；
 * 2. 真实重力下 vehicle-category 动态体落在 ground 上不穿透；
 * 3. 完整阶段边界；进入 Closing 当步速度 0，下一步墙体各移动约 closingSpeed px 且方向相反；
 * 4. Closing→End、End 稳定、setPhase 及 Projectile Bounds；
 * 5. 无 NaN/Infinity。
 */
import { describe, it, expect } from 'vitest';
import { PlanckWorld } from '../src/physics/planckWorld';
import { PlanckArenaRuntime } from '../src/battle/planckArenaRuntime';
import { PlanckCategory } from '../src/battle/planckVehicleAssembly';
import { DEFAULT_ARENA_CONFIG } from '../src/battle/arenaConfig';

function assertFiniteAll(...vals: number[]): void {
  for (const v of vals) expect(Number.isFinite(v)).toBe(true);
}

describe('F-02M-B13A · 1. 默认构造：几何 / OwnerTag / 初始速度', () => {
  it('ground / 普通墙 / Closing Wall 位置、OwnerTag、初始速度', () => {
    const world = new PlanckWorld();
    const arena = new PlanckArenaRuntime(world);
    const c = DEFAULT_ARENA_CONFIG;
    const t = c.wallThickness;

    // Ground：中心 (width/2, groundY + height/2)，尺寸 width+2t × height
    const g = world.getPosition(arena.ground);
    expect(g.x).toBeCloseTo(c.width / 2, 9);
    expect(g.y).toBeCloseTo(c.groundY + c.height / 2, 9);
    expect(world.getOwnerTag(arena.ground)?.kind).toBe('ground');

    // 左右普通墙（static，friction=0.2 / restitution=0.05）
    const lw = world.getPosition(arena.leftWall);
    expect(lw.x).toBeCloseTo(-t / 2, 9);
    expect(lw.y).toBeCloseTo(c.groundY, 9);
    expect(world.getOwnerTag(arena.leftWall)).toMatchObject({ kind: 'arena' });
    const rw = world.getPosition(arena.rightWall);
    expect(rw.x).toBeCloseTo(c.width + t / 2, 9);
    expect(rw.y).toBeCloseTo(c.groundY, 9);
    expect(world.getOwnerTag(arena.rightWall)).toMatchObject({ kind: 'arena' });

    // Closing Wall ×2：left 在 -2t、right 在 width+2t；y = groundY - height/4
    expect(arena.closingWalls).toHaveLength(2);
    const cl = arena.closingWalls[0]!;
    const cr = arena.closingWalls[1]!;
    expect(cl.side).toBe('left');
    expect(cr.side).toBe('right');
    const clp = world.getPosition(cl.body);
    expect(clp.x).toBeCloseTo(-t * 2, 9);
    expect(clp.y).toBeCloseTo(c.groundY - c.height / 4, 9);
    const crp = world.getPosition(cr.body);
    expect(crp.x).toBeCloseTo(c.width + t * 2, 9);
    expect(crp.y).toBeCloseTo(c.groundY - c.height / 4, 9);
    expect(world.getOwnerTag(cl.body)?.kind).toBe('hazard');
    expect(world.getOwnerTag(cr.body)?.kind).toBe('hazard');

    // 初始速度 0
    const vcl = world.getLinearVelocity(cl.body);
    const vcr = world.getLinearVelocity(cr.body);
    expect(vcl.x).toBeCloseTo(0, 9);
    expect(vcl.y).toBeCloseTo(0, 9);
    expect(vcr.x).toBeCloseTo(0, 9);
    expect(vcr.y).toBeCloseTo(0, 9);

    assertFiniteAll(
      g.x, g.y, lw.x, lw.y, rw.x, rw.y,
      clp.x, clp.y, crp.x, crp.y,
      vcl.x, vcl.y, vcr.x, vcr.y,
    );
  });
});

describe('F-02M-B13A · 2. 真实重力下 vehicle 动态体落 ground 不穿透', () => {
  it('VEHICLE_A 动态体下落停稳在 ground 顶部，不穿透', () => {
    const world = new PlanckWorld({ x: 0, y: 10 });
    // 创建 Arena（含 static ground）——测试只关心 ground 的碰撞支撑
    new PlanckArenaRuntime(world);
    const c = DEFAULT_ARENA_CONFIG;
    const half = 20;
    const body = world.createDynamicBox(c.width / 2, 500, half * 2, half * 2, 10, {
      collisionFilter: {
        categoryBits: PlanckCategory.VEHICLE_A,
        maskBits:
          PlanckCategory.GROUND |
          PlanckCategory.ARENA |
          PlanckCategory.HAZARD |
          PlanckCategory.VEHICLE_A |
          PlanckCategory.VEHICLE_B,
      },
    });

    let nan = false;
    for (let i = 0; i < 300; i++) {
      world.stepFixed(1);
      const p = world.getPosition(body);
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) nan = true;
    }
    const p = world.getPosition(body);
    console.log(`[B13A-land] y=${p.y.toFixed(6)}`);
    // 停稳在 ground 顶部附近（Planck slop 允许 ≤2px 悬浮），不穿透
    expect(Math.abs(p.y - (c.groundY - half))).toBeLessThan(2);
    // 严格不穿透：body 底部不越过 ground 顶（+0.5px 容差）
    expect(p.y + half).toBeLessThan(c.groundY + 0.5);
    // 最后 30 步收敛
    const p0 = world.getPosition(body);
    for (let i = 0; i < 30; i++) world.stepFixed(1);
    const p1 = world.getPosition(body);
    expect(Math.abs(p1.y - p0.y)).toBeLessThan(0.05);
    expect(nan).toBe(false);
  });
});

describe('F-02M-B13A · 3. 阶段边界与 Closing 推进', () => {
  it('Active→Warning→Closing→End 边界；进入 Closing 当步速度 0，下一步 ±closingSpeed 相向推进', () => {
    const world = new PlanckWorld();
    const arena = new PlanckArenaRuntime(world);
    const cl = arena.closingWalls[0]!;
    const cr = arena.closingWalls[1]!;

    // 初始 Active
    expect(arena.phase).toBe('Active');
    // Active 边界：9999 不转，+1 转 Warning
    arena.update(9999);
    expect(arena.phase).toBe('Active');
    arena.update(1);
    expect(arena.phase).toBe('Warning');
    // Warning 边界：2999 不转，+1 转 Closing
    arena.update(2999);
    expect(arena.phase).toBe('Warning');
    arena.update(1);
    expect(arena.phase).toBe('Closing');

    // 进入 Closing 当步：速度仍 0
    const v0 = world.getLinearVelocity(cl.body);
    expect(v0.x).toBeCloseTo(0, 9);

    // 下一次 update（仍 Closing）：left +closingSpeed / right -closingSpeed
    arena.update(1);
    const vl = world.getLinearVelocity(cl.body);
    const vr = world.getLinearVelocity(cr.body);
    expect(vl.x).toBeCloseTo(DEFAULT_ARENA_CONFIG.closingSpeed, 9);
    expect(vr.x).toBeCloseTo(-DEFAULT_ARENA_CONFIG.closingSpeed, 9);

    // 推进 10 步：left +closingSpeed*10 / right -closingSpeed*10（kinematic 精确位移）
    const pcl0 = world.getPosition(cl.body).x;
    const pcr0 = world.getPosition(cr.body).x;
    world.stepFixed(10);
    const pcl1 = world.getPosition(cl.body).x;
    const pcr1 = world.getPosition(cr.body).x;
    console.log(
      `[B13A-close] left dx=${(pcl1 - pcl0).toFixed(6)} right dx=${(pcr1 - pcr0).toFixed(6)}`,
    );
    expect(Math.abs(pcl1 - pcl0 - DEFAULT_ARENA_CONFIG.closingSpeed * 10)).toBeLessThan(0.01);
    expect(Math.abs(pcr1 - pcr0 + DEFAULT_ARENA_CONFIG.closingSpeed * 10)).toBeLessThan(0.01);

    assertFiniteAll(v0.x, vl.x, vr.x, pcl0, pcr0, pcl1, pcr1);
  });
});

describe('F-02M-B13A · 4. Closing→End、End 稳定、setPhase、Projectile Bounds', () => {
  it('Closing→End 当步保留最后一次推进；End 后不再改速度', () => {
    const world = new PlanckWorld();
    const arena = new PlanckArenaRuntime(world);
    const cl = arena.closingWalls[0]!;
    const cr = arena.closingWalls[1]!;

    // 推进到 Closing 并设速度：Active 10000 → Warning，3000 → Closing，1 → 设速度
    arena.update(10_000);
    arena.update(3_000);
    arena.update(1);
    expect(world.getLinearVelocity(cl.body).x).toBeCloseTo(DEFAULT_ARENA_CONFIG.closingSpeed, 9);
    expect(world.getLinearVelocity(cr.body).x).toBeCloseTo(-DEFAULT_ARENA_CONFIG.closingSpeed, 9);

    // Closing→End 当步（1+4999=5000 达到边界）：保留最后一次推进
    arena.update(4_999);
    expect(arena.phase).toBe('End');
    expect(world.getLinearVelocity(cl.body).x).toBeCloseTo(DEFAULT_ARENA_CONFIG.closingSpeed, 9);
    expect(world.getLinearVelocity(cr.body).x).toBeCloseTo(-DEFAULT_ARENA_CONFIG.closingSpeed, 9);

    // End 后不再改速度
    arena.update(100);
    arena.update(100);
    expect(arena.phase).toBe('End');
    expect(world.getLinearVelocity(cl.body).x).toBeCloseTo(DEFAULT_ARENA_CONFIG.closingSpeed, 9);
    expect(world.getLinearVelocity(cr.body).x).toBeCloseTo(-DEFAULT_ARENA_CONFIG.closingSpeed, 9);
  });

  it('setPhase 只切阶段清零计时、不驱动墙体；Projectile Bounds 判定', () => {
    const world = new PlanckWorld();
    const arena = new PlanckArenaRuntime(world);
    const cl = arena.closingWalls[0]!;

    // setPhase('Closing')：阶段切换、速度保持 0
    arena.setPhase('Closing');
    expect(arena.phase).toBe('Closing');
    expect(world.getLinearVelocity(cl.body).x).toBeCloseTo(0, 9);

    // 下一次 update 才驱动（elapsed=1 < 5000，仍 Closing）
    arena.update(1);
    expect(arena.phase).toBe('Closing');
    expect(world.getLinearVelocity(cl.body).x).toBeCloseTo(DEFAULT_ARENA_CONFIG.closingSpeed, 9);

    // 5000ms 边界到达 End（1+4999）
    arena.update(4_999);
    expect(arena.phase).toBe('End');

    // setPhase 可回 Active
    arena.setPhase('Active');
    expect(arena.phase).toBe('Active');
    arena.update(9_999);
    expect(arena.phase).toBe('Active');

    // Projectile Bounds：y < -50 越界
    expect(arena.isOutOfProjectileBounds({ x: 0, y: -51 })).toBe(true);
    expect(arena.isOutOfProjectileBounds({ x: 0, y: -50.001 })).toBe(true);
    expect(arena.isOutOfProjectileBounds({ x: 0, y: -50 })).toBe(false);
    expect(arena.isOutOfProjectileBounds({ x: 0, y: 0 })).toBe(false);
    expect(arena.isOutOfProjectileBounds({ x: 800, y: 700 })).toBe(false);
  });
});
