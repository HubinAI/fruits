/**
 * Queue F-02M-B3｜Planck Contact Kinematics（保留不回删）
 *
 * 验证 ContactBridgeEvent 的接触运动学：
 * 1. 纯平移正面对撞：relVel ≈ 1、法线单位、数值有限；end 保留同一 begin 快照；
 * 2. 反向创建顺序：bodyA/bodyB 按创建序号，法线随交换反转，relVel 仍为正；
 * 3. 旋转接触：point relVel 明显大于 COM-only 投影，证明 ω×r 已计入。
 */
import { describe, it, expect } from 'vitest';
import { PlanckWorld, type BodyHandle, type ContactBridgeEvent } from '../src/physics/planckWorld';

function collide(
  createBFirst: boolean,
  spinA = 0,
  steps = 240,
): { events: ContactBridgeEvent[]; world: PlanckWorld; a: BodyHandle; b: BodyHandle } {
  const world = new PlanckWorld(); // 零重力
  const events: ContactBridgeEvent[] = [];
  world.setContactListener((e) => events.push(e));
  const first = createBFirst ? { x: 40 } : { x: -40 };
  const second = createBFirst ? { x: -40 } : { x: 40 };
  const bodyFirst = world.createDynamicBox(first.x, 0, 40, 40, 5);
  const bodySecond = world.createDynamicBox(second.x, 0, 40, 40, 5);
  const a = createBFirst ? bodySecond : bodyFirst; // 语义 A = 左侧车（向右）
  const b = createBFirst ? bodyFirst : bodySecond; // 语义 B = 右侧车（向左）
  world.setLinearVelocity(a, 0.5, 0);
  world.setLinearVelocity(b, -0.5, 0);
  if (spinA !== 0) world.setAngularVelocity(a, spinA);
  for (let i = 0; i < steps; i++) world.stepFixed(1);
  return { events, world, a, b };
}

describe('F-02M-B3 · Planck Contact Kinematics', () => {
  it('纯平移正面对撞：relVel≈1、法线单位、数值有限；end 保留同一快照', () => {
    const world = new PlanckWorld(); // 零重力
    const events: ContactBridgeEvent[] = [];
    world.setContactListener((e) => events.push(e));
    const a = world.createDynamicBox(-40, 0, 40, 40, 5);
    const b = world.createDynamicBox(40, 0, 40, 40, 5);
    world.setLinearVelocity(a, 0.5, 0);
    world.setLinearVelocity(b, -0.5, 0);
    for (let i = 0; i < 120; i++) world.stepFixed(1); // 相向碰撞（贴合，restitution 0）
    world.setLinearVelocity(a, -1, 0); // 主动拉开 → 产生 end
    for (let i = 0; i < 120; i++) world.stepFixed(1);

    const begin = events.find((e) => e.phase === 'begin');
    const end = events.find((e) => e.phase === 'end');
    expect(begin).toBeDefined();
    const be = begin!;
    console.log(
      `[B3-1] relVel=${be.relativeVelocity.toFixed(4)} normal=(${be.normal.x.toFixed(4)},${be.normal.y.toFixed(4)}) ` +
        `|n|=${Math.hypot(be.normal.x, be.normal.y).toFixed(6)} point=(${be.contactPoint.x.toFixed(2)},${be.contactPoint.y.toFixed(2)})`,
    );
    // relVel ≈ 1（0.5+0.5，容差 0.15）
    expect(Math.abs(be.relativeVelocity - 1.0)).toBeLessThan(0.15);
    // 法线单位向量
    expect(Math.hypot(be.normal.x, be.normal.y)).toBeCloseTo(1, 5);
    // 数值有限
    expect(Number.isFinite(be.contactPoint.x)).toBe(true);
    expect(Number.isFinite(be.contactPoint.y)).toBe(true);
    expect(Number.isFinite(be.relativeVelocity)).toBe(true);
    // end 复用 begin 快照（同一数据）
    expect(end).toBeDefined();
    expect(end!.relativeVelocity).toBe(be.relativeVelocity);
    expect(end!.contactPoint.x).toBe(be.contactPoint.x);
    expect(end!.normal.x).toBe(be.normal.x);
  });

  it('反向创建顺序：body 按创建序号、法线随交换反转、relVel 仍为正', () => {
    const { events, a, b } = collide(true);
    const begin = events.find((e) => e.phase === 'begin');
    expect(begin).toBeDefined();
    const be = begin!;
    // B（右车）先创建 → 序号小 → 事件 bodyA = B、bodyB = A
    expect(be.bodyA).toBe(b);
    expect(be.bodyB).toBe(a);
    // 法线从 B（右）指向 A（左）→ x 分量为负
    expect(be.normal.x).toBeLessThan(0);
    console.log(
      `[B3-2] bodyA=右侧车  normal=(${be.normal.x.toFixed(4)},${be.normal.y.toFixed(4)}) relVel=${be.relativeVelocity.toFixed(4)}`,
    );
    // relVel 仍为正且 ≈1（物理事实不变）
    expect(be.relativeVelocity).toBeGreaterThan(0);
    expect(Math.abs(be.relativeVelocity - 1.0)).toBeLessThan(0.15);
  });

  it('旋转接触：point relVel 明显大于 COM-only 投影（ω×r 已计入）', () => {
    const { events, world, a, b } = collide(false, -0.5);
    const begin = events.find((e) => e.phase === 'begin');
    expect(begin).toBeDefined();
    const be = begin!;
    // 测试侧用公开 API 复算 COM-only 投影（事件后读取，供对比）
    const comA = world.getLinearVelocity(a);
    const comB = world.getLinearVelocity(b);
    const comOnly = (comA.x - comB.x) * be.normal.x + (comA.y - comB.y) * be.normal.y;
    console.log(
      `[B3-3] relVel=${be.relativeVelocity.toFixed(4)} comOnly=${comOnly.toFixed(4)} ` +
        `diff=${Math.abs(be.relativeVelocity - comOnly).toFixed(4)} ωA=${world.getAngularVelocity(a).toFixed(4)}`,
    );
    expect(Number.isFinite(be.relativeVelocity)).toBe(true);
    // ω×r 贡献明显（旋转接触点离 COM 有切向臂）
    expect(Math.abs(be.relativeVelocity - comOnly)).toBeGreaterThan(1);
  });
});
