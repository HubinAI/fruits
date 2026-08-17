/**
 * Queue F-02C-A1｜Contact 碰撞批次元数据（targeted regression）
 *
 * 验收：构造一次产生多个 collisionStart pair 的 compound 碰撞，确认：
 * 1. 同批事件 batch.timestamp 相同；
 * 2. batch.index 为 0 到 size-1（保持原 pair 顺序）；
 * 3. batch.size 等于当批实际回调数，且原 relativeVelocity 仍为正、phase 保持 'start'。
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

describe('F-02C-A1 · Contact 碰撞批次元数据', () => {
  it('一次多 pair collisionStart：同批 timestamp、连续 index、size 正确、relVel 为正', () => {
    const world = new PhysWorld({ x: 0, y: 0, scale: 0 }); // 无重力，测量纯净
    // A：compound 由两个竖直并排 box 组成，右缘对齐（都在 x=430）→ 同时接触 B
    const A = createCompound(
      400,
      400,
      [
        { shape: 'box', width: 60, height: 120, offset: { x: 0, y: -70 } }, // y∈[270,390]
        { shape: 'box', width: 60, height: 120, offset: { x: 0, y: 70 } }, // y∈[410,530]
      ],
      10,
      { friction: 0, restitution: 0 },
    );
    // B：高箱覆盖 A 两 part 高度（y∈[150,650]）→ 一次 update 内两个 pair 同时产生
    const B = createBox(560, 400, 120, 500, 10, { friction: 0, restitution: 0 });
    world.add(A);
    world.add(B);
    Matter.Body.setVelocity(A, { x: 2, y: 0 });
    Matter.Body.setVelocity(B, { x: -2, y: 0 });

    const events: ContactEvent[] = [];
    world.setCollisionHandlers({
      onStart: (ev) => {
        events.push(ev);
      },
    });
    for (let i = 0; i < 120 && events.length === 0; i++) world.step(FIXED_DT);

    // 确认确实是「一次派发多个 pair」的场景（size > 1 才能验证批次边界）
    expect(events.length).toBeGreaterThan(1);

    // 输出批次数值供观察
    for (const e of events) {
      console.log(
        `batch timestamp=${e.batch?.timestamp} index=${e.batch?.index}/${(e.batch?.size ?? 0) - 1} ` +
          `size=${e.batch?.size} relVel=${e.relativeVelocity.toFixed(3)} phase=${e.phase}`,
      );
    }

    // 验收 1：同批事件 timestamp 相同
    const timestamps = events.map((e) => e.batch?.timestamp);
    expect(new Set(timestamps).size).toBe(1);

    // 验收 2：index 为 0..size-1（按回调顺序，保持原 pair 顺序）
    events.forEach((e, i) => {
      expect(e.batch?.index).toBe(i);
    });
    expect(events[events.length - 1]!.batch?.index).toBe(events.length - 1);

    // 验收 3：size 等于当批实际回调数；relativeVelocity 仍为正；phase 保持 'start'
    for (const e of events) {
      expect(e.batch?.size).toBe(events.length);
      expect(e.relativeVelocity).toBeGreaterThan(0);
      expect(e.phase).toBe('start');
    }
  });
});
