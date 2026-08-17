/**
 * Queue F-02A｜修正 Contact 接触点相对速度（targeted regression）
 *
 * 验收三场景（对齐 F-02D 诊断数据）：
 * 1. compound 纯平移：relativeVelocity = parent COM 投影（不再读 sub-part 恒为 0）；
 * 2. 旋转接触：relativeVelocity 包含 ω×r，明显大于仅用 COM 的数值；
 * 3. 普通非 compound 碰撞：保持「靠近为正」的符号语义。
 * 另验证：ContactEvent.bodyA/bodyB 仍是原 collision sub-part（Meta/Owner/Part 路由不变）。
 */
import { describe, it, expect } from 'vitest';
import Matter from 'matter-js';
import {
  PhysWorld,
  createCompound,
  createBox,
  FIXED_DT,
  type ContactEvent,
} from '../src/physics/adapter';

/** L 形 compound（模拟车身：主箱 + 凸出 Hardpoint 部段） */
function compoundAt(x: number, y = 400): Matter.Body {
  return createCompound(
    x,
    y,
    [
      { shape: 'box', width: 100, height: 40, offset: { x: 0, y: 0 } },
      { shape: 'box', width: 40, height: 100, offset: { x: 60, y: 0 } },
    ],
    10,
    { friction: 0, restitution: 0 },
  );
}

/**
 * 推进 world 直到捕获到第一个 collisionStart。
 *
 * 注意：对比基准（parent COM 投影）必须在事件回调内同步读取——
 * Matter 的 Resolver.solveVelocity 会在 collisionStart 事件之后回写 body.velocity，
 * 事件外读取到的是「已被碰撞求解改写」的值（实测 1.845 → 0.00014），不是真实接近速度。
 * 生产代码 dispatch 在事件内同步读取，故不受影响。
 */
function collideUntilStart(
  world: PhysWorld,
  parentA: Matter.Body,
  parentB: Matter.Body,
  maxSteps = 120,
): { ev: ContactEvent; comRel: number } | undefined {
  let result: { ev: ContactEvent; comRel: number } | undefined;
  world.setCollisionHandlers({
    onStart: (e) => {
      if (!result) {
        // 此刻（事件内）：velocity = 本步积分后、碰撞求解前，是真实接近速度
        const dvx = parentA.velocity.x - parentB.velocity.x;
        const dvy = parentA.velocity.y - parentB.velocity.y;
        result = { ev: e, comRel: -(dvx * e.normal.x + dvy * e.normal.y) };
      }
    },
  });
  for (let i = 0; i < maxSteps && !result; i++) world.step(FIXED_DT);
  return result;
}

describe('F-02A · compound 纯平移碰撞', () => {
  it('relativeVelocity = parent COM 投影（>0 且不再为 0）', () => {
    const world = new PhysWorld({ x: 0, y: 0, scale: 0 }); // 无重力，测量纯净
    const A = compoundAt(400);
    const B = compoundAt(560);
    world.add(A);
    world.add(B);
    Matter.Body.setVelocity(A, { x: 2, y: 0 });
    Matter.Body.setVelocity(B, { x: -2, y: 0 });

    const r = collideUntilStart(world, A, B);
    expect(r).toBeDefined();
    const { ev: e, comRel } = r!;

    // 验收 1a：真实接近速度，不再读为 0（F-02D 实测 ≈3.69；阈值留余量 > 2）
    expect(e.relativeVelocity).toBeGreaterThan(2);
    // 验收 1b：与 parent COM 投影一致（纯平移无旋转 → 两值应相同，误差 < 15%）
    expect(Math.abs(e.relativeVelocity - comRel)).toBeLessThan(Math.abs(comRel) * 0.15);

    // 验收 1c：bodyA/bodyB 仍是 sub-part（parts=[self]，且不是父刚体本身）
    expect(e.bodyA.parts.length).toBe(1);
    expect(e.bodyA).not.toBe(A);
    expect(e.bodyB).not.toBe(B);
  });
});

describe('F-02A · 旋转接触', () => {
  it('relativeVelocity 包含 ω×r，明显大于仅用 COM 的数值', () => {
    const world = new PhysWorld({ x: 0, y: 0, scale: 0 });
    const A = compoundAt(400);
    const B = compoundAt(560);
    world.add(A);
    world.add(B);
    Matter.Body.setVelocity(A, { x: 2, y: 0 });
    Matter.Body.setAngularVelocity(A, 0.4); // 旋转着撞静止目标

    const r = collideUntilStart(world, A, B);
    expect(r).toBeDefined();
    const { ev: e, comRel } = r!;

    // 旋转贡献显著（F-02D 实测 26.39 vs 仅 COM 0.81，差 32 倍；阈值 > 2 倍 + > 10 留余量）
    expect(e.relativeVelocity).toBeGreaterThan(Math.abs(comRel) * 2);
    expect(e.relativeVelocity).toBeGreaterThan(10);
  });
});

describe('F-02A · 普通非 compound 碰撞', () => {
  it('靠近为正（正值 = 相互靠近，符号语义不变）', () => {
    const world = new PhysWorld({ x: 0, y: 0, scale: 0 });
    const A = createBox(300, 400, 100, 40, 10, { friction: 0, restitution: 0 });
    const B = createBox(500, 400, 100, 40, 10, { friction: 0, restitution: 0 });
    world.add(A);
    world.add(B);
    Matter.Body.setVelocity(A, { x: 2, y: 0 });
    Matter.Body.setVelocity(B, { x: -2, y: 0 });

    const r = collideUntilStart(world, A, B);
    expect(r).toBeDefined();
    expect(r!.ev.relativeVelocity).toBeGreaterThan(0);

    // 非 compound：bodyA/bodyB 即父刚体本身（parts=[self]）
    expect(r!.ev.bodyA.parts.length).toBe(1);
    expect(r!.ev.bodyA).toBe(r!.ev.bodyA.parent);
  });
});
