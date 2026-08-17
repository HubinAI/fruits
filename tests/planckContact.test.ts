/**
 * Queue F-02M-A5｜Planck 接触事件最小桥接（保留不回删）
 *
 * 验证最小 contact listener：
 * 1. 两物体首次接触只产生正确 begin；
 * 2. 持续接触不重复误报 begin；
 * 3. 分离后产生 end；
 * 4. body 创建顺序变化不影响事件语义（同一对的 begin/end 内部配对一致，
 *    无序对始终包含双方）。
 *
 * 事件只携带 opaque BodyHandle；不泄漏 Planck native 类型。
 */
import { describe, it, expect } from 'vitest';
import { PlanckWorld, type ContactBridgeEvent } from '../src/physics/planckWorld';

interface CollideResult {
  events: ContactBridgeEvent[];
  beginCount: number;
  endCount: number;
  /** 无序对：事件包含 A 与 B 则为 'AB' */
  beginPair: string;
  endPair: string;
  /** begin 与 end 的 bodyA/bodyB 是否完全一致（规范化配对稳定） */
  beginEndSamePair: boolean;
}

/**
 * 两个 box（boxA 恒在 x=0 左、boxB 恒在 x=39 右，初始轻微重叠 1px），
 * 初始接触 → 静止贴合 → boxA 向左拉开分离。
 * boxBFirst=true 时 boxB 先创建（序号更小），验证创建顺序不影响语义。
 */
function runCollide(boxBFirst: boolean): CollideResult {
  const world = new PlanckWorld(); // 零重力
  const events: ContactBridgeEvent[] = [];
  world.setContactListener((e) => events.push(e));

  // 创建顺序可交换；物理位置固定（boxA 左、boxB 右）
  let boxA: ReturnType<PlanckWorld['createDynamicBox']>;
  let boxB: ReturnType<PlanckWorld['createDynamicBox']>;
  if (boxBFirst) {
    boxB = world.createDynamicBox(39, 0, 40, 40, 5);
    boxA = world.createDynamicBox(0, 0, 40, 40, 5);
  } else {
    boxA = world.createDynamicBox(0, 0, 40, 40, 5);
    boxB = world.createDynamicBox(39, 0, 40, 40, 5);
  }

  // 初始接触（重叠 1px）+ 静止贴合 300 步（期望：仅一次 begin，无 end）
  for (let i = 0; i < 300; i++) world.stepFixed(1);

  // 分离：boxA 向左拉开（远离 boxB）
  world.setLinearVelocity(boxA, -0.75, 0);
  for (let i = 0; i < 300; i++) world.stepFixed(1);

  const begins = events.filter((e) => e.phase === 'begin');
  const ends = events.filter((e) => e.phase === 'end');
  const pairOf = (e: ContactBridgeEvent): string => {
    const hasA = e.bodyA === boxA || e.bodyB === boxA;
    const hasB = e.bodyA === boxB || e.bodyB === boxB;
    return hasA && hasB ? 'AB' : hasA ? 'A' : hasB ? 'B' : '?';
  };
  const beginEndSamePair =
    begins.length > 0 &&
    ends.length > 0 &&
    begins[0]!.bodyA === ends[0]!.bodyA &&
    begins[0]!.bodyB === ends[0]!.bodyB;

  return {
    events,
    beginCount: begins.length,
    endCount: ends.length,
    beginPair: begins.length > 0 ? pairOf(begins[0]!) : 'none',
    endPair: ends.length > 0 ? pairOf(ends[0]!) : 'none',
    beginEndSamePair,
  };
}

describe('F-02M-A5 · 接触事件桥接', () => {
  it('首次接触一次 begin、贴合不重复、分离一次 end（boxA 先创建）', () => {
    const r = runCollide(false);
    console.log(
      `[A5-A] events=${r.events.map((e) => e.phase).join(',')} ` +
        `begin=${r.beginCount} end=${r.endCount} beginPair=${r.beginPair} endPair=${r.endPair} ` +
        `beginEndSamePair=${r.beginEndSamePair}`,
    );
    expect(r.beginCount).toBe(1);
    expect(r.endCount).toBe(1);
    expect(r.beginPair).toBe('AB');
    expect(r.endPair).toBe('AB');
    expect(r.beginEndSamePair).toBe(true);
    expect(r.events[0]!.phase).toBe('begin');
    expect(r.events[r.events.length - 1]!.phase).toBe('end');
  });

  it('boxB 先创建时语义一致（创建顺序变化不影响）', () => {
    const rA = runCollide(false);
    const rB = runCollide(true);
    console.log(
      `[A5-B] begin=${rB.beginCount} end=${rB.endCount} beginPair=${rB.beginPair} endPair=${rB.endPair} ` +
        `beginEndSamePair=${rB.beginEndSamePair}`,
    );
    expect(rB.beginCount).toBe(1);
    expect(rB.endCount).toBe(1);
    expect(rB.beginPair).toBe('AB');
    expect(rB.endPair).toBe('AB');
    expect(rB.beginEndSamePair).toBe(true);
    // 两种创建顺序下事件数量一致
    expect(rB.events.length).toBe(rA.events.length);
  });
});
