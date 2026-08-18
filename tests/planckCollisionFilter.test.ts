/**
 * Queue F-02M-B2｜Planck Collision Filter（保留不回删）
 *
 * 验证 fixture 级碰撞过滤：
 * 1. 互相允许的 A/B category/mask 产生接触；
 * 2. 相同负 groupIndex 永不碰撞；
 * 3. mask 排除时不碰撞；
 * 4. 未传 filter 保持默认碰撞行为（对照）。
 *
 * 零重力 world，两 box 相向运动（±0.5px/step），用 contact listener 数 begin。
 */
import { describe, it, expect } from 'vitest';
import { PlanckWorld, type BodyHandle } from '../src/physics/planckWorld';

function collideWith(
  filterA: { categoryBits: number; maskBits: number; groupIndex?: number } | undefined,
  filterB: { categoryBits: number; maskBits: number; groupIndex?: number } | undefined,
  steps = 240,
): { begins: number; world: PlanckWorld; a: BodyHandle; b: BodyHandle } {
  const world = new PlanckWorld(); // 零重力
  let begins = 0;
  world.setContactListener((e) => {
    if (e.phase === 'begin') begins++;
  });
  const a = world.createDynamicBox(-40, 0, 40, 40, 5, filterA ? { collisionFilter: filterA } : undefined);
  const b = world.createDynamicBox(40, 0, 40, 40, 5, filterB ? { collisionFilter: filterB } : undefined);
  // 相向运动：左向右、右向左（间距 80px，相对 1px/step → ~80 步接触）
  world.setLinearVelocity(a, 0.5, 0);
  world.setLinearVelocity(b, -0.5, 0);
  for (let i = 0; i < steps; i++) world.stepFixed(1);
  return { begins, world, a, b };
}

describe('F-02M-B2 · Planck Collision Filter', () => {
  it('对照：未传 filter 保持默认碰撞（产生 begin）', () => {
    const r = collideWith(undefined, undefined);
    console.log(`[B2-0] 无 filter 接触 begin 数=${r.begins}`);
    expect(r.begins).toBeGreaterThan(0);
  });

  it('互相允许的 A/B category/mask 产生接触', () => {
    // A: category=0x1, mask=0x2；B: category=0x2, mask=0x1 → A 能匹配 B、B 能匹配 A
    const r = collideWith(
      { categoryBits: 0x0001, maskBits: 0x0002 },
      { categoryBits: 0x0002, maskBits: 0x0001 },
    );
    console.log(`[B2-1] 互相允许 mask 接触 begin 数=${r.begins}`);
    expect(r.begins).toBeGreaterThan(0);
  });

  it('相同负 groupIndex 永不碰撞', () => {
    const r = collideWith(
      { categoryBits: 0x0001, maskBits: 0xffff, groupIndex: -1 },
      { categoryBits: 0x0001, maskBits: 0xffff, groupIndex: -1 },
    );
    console.log(`[B2-2] 相同负 group 接触 begin 数=${r.begins}`);
    expect(r.begins).toBe(0);
  });

  it('mask 排除时不碰撞', () => {
    // A mask=0（不匹配任何 category）→ 与 B（category 0x1）不碰撞
    const r = collideWith(
      { categoryBits: 0x0001, maskBits: 0x0000 },
      { categoryBits: 0x0001, maskBits: 0x0001 },
    );
    console.log(`[B2-3] mask 排除接触 begin 数=${r.begins}`);
    expect(r.begins).toBe(0);
  });

  it('非法 filter 输入抛错', () => {
    const world = new PlanckWorld();
    expect(() =>
      world.createDynamicBox(0, 0, 40, 40, 5, {
        collisionFilter: { categoryBits: 0, maskBits: 0xffff },
      }),
    ).toThrow(); // category 0 非法（1..0xffff）
    expect(() =>
      world.createDynamicBox(0, 0, 40, 40, 5, {
        collisionFilter: { categoryBits: 0x0001, maskBits: 0x10000 },
      }),
    ).toThrow(); // mask 超 0xffff
    expect(() =>
      world.createDynamicBox(0, 0, 40, 40, 5, {
        collisionFilter: { categoryBits: 0x0001, maskBits: 0xffff, groupIndex: 32768 },
      }),
    ).toThrow(); // group 超 32767
    expect(() =>
      world.createDynamicCircle(0, 0, 20, 5, {
        friction: 1,
        collisionFilter: { categoryBits: 1.5, maskBits: 0xffff },
      }),
    ).toThrow(); // 非整数 category
  });
});
