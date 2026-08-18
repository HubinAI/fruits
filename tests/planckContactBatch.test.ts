/**
 * Queue F-02M-B4A｜Planck 接触批次监听（保留不回删）
 *
 * 验证批次监听（setBatchedContactListener）：
 * 1. 同一步两个 begin：timestamp 相同、size=2、index=[0,1]；
 * 2. 下一物理步新接触：timestamp 严格增加、index 重新从 0；
 * 3. 即时监听无 batch、批次监听有 batch，双方运动学数据一致；
 * 4. 仅设置批次监听也能工作。
 */
import { describe, it, expect } from 'vitest';
import { PlanckWorld, type ContactBridgeEvent } from '../src/physics/planckWorld';

function makeListeners(batchedOnly: boolean): {
  world: PlanckWorld;
  immediate: ContactBridgeEvent[];
  batched: ContactBridgeEvent[];
} {
  const world = new PlanckWorld(); // 零重力
  const immediate: ContactBridgeEvent[] = [];
  const batched: ContactBridgeEvent[] = [];
  if (!batchedOnly) world.setContactListener((e) => immediate.push(e));
  world.setBatchedContactListener((e) => batched.push(e));
  return { world, immediate, batched };
}

describe('F-02M-B4A · Planck 接触批次监听', () => {
  it('同一步两个 begin：timestamp 相同、size=2、index=[0,1]', () => {
    const { world, batched } = makeListeners(true);
    // 中央 B 静止，A/C 对称相撞 → 同一物理步两个 begin
    world.createDynamicBox(0, 0, 40, 40, 50);
    const a = world.createDynamicBox(-60, 0, 40, 40, 5);
    const c = world.createDynamicBox(60, 0, 40, 40, 5);
    world.setLinearVelocity(a, 0.5, 0);
    world.setLinearVelocity(c, -0.5, 0);
    for (let i = 0; i < 240; i++) world.stepFixed(1);

    const begins = batched.filter((e) => e.phase === 'begin');
    const size2 = begins.filter((e) => e.batch!.size === 2);
    console.log(
      `[B4A-1] 总 begin=${begins.length} size=2 批次=${size2.length} ` +
        `ts=(${size2.map((e) => e.batch!.timestamp.toFixed(1)).join(',')}) ` +
        `index=(${size2.map((e) => e.batch!.index).join(',')})`,
    );
    expect(size2.length).toBe(2);
    // 相同 timestamp
    expect(size2[0]!.batch!.timestamp).toBe(size2[1]!.batch!.timestamp);
    // size=2、index=[0,1]
    expect(size2[0]!.batch!.size).toBe(2);
    expect(size2[1]!.batch!.size).toBe(2);
    const idxs = size2.map((e) => e.batch!.index).sort((x, y) => x - y);
    expect(idxs).toEqual([0, 1]);
  });

  it('下一物理步新接触：timestamp 严格增加、index 重新从 0', () => {
    const { world, batched } = makeListeners(true);
    // 两对独立 box（错开 y），间距不同 → 接触步不同
    const a = world.createDynamicBox(-40, 0, 40, 40, 5);
    const b = world.createDynamicBox(40, 0, 40, 40, 5);
    const c = world.createDynamicBox(-100, 100, 40, 40, 5);
    const d = world.createDynamicBox(100, 100, 40, 40, 5);
    world.setLinearVelocity(a, 0.5, 0);
    world.setLinearVelocity(b, -0.5, 0);
    world.setLinearVelocity(c, 0.5, 0);
    world.setLinearVelocity(d, -0.5, 0);
    for (let i = 0; i < 300; i++) world.stepFixed(1);

    const begins = batched.filter((e) => e.phase === 'begin');
    const tsList = [...new Set(begins.map((e) => e.batch!.timestamp))].sort((x, y) => x - y);
    console.log(
      `[B4A-2] begin=${begins.length} 批次时间戳=${tsList.map((t) => t.toFixed(1)).join(', ')}`,
    );
    expect(tsList.length).toBeGreaterThanOrEqual(2);
    // timestamp 严格增加
    for (let i = 1; i < tsList.length; i++) {
      expect(tsList[i]!).toBeGreaterThan(tsList[i - 1]!);
    }
    // 第二批 index 重新从 0 开始（size=1 → index=0）
    const secondBatch = begins.filter((e) => e.batch!.timestamp === tsList[1]!);
    const idxs = secondBatch.map((e) => e.batch!.index).sort((x, y) => x - y);
    expect(idxs).toEqual([0]);
  });

  it('即时监听无 batch、批次监听有 batch、运动学数据一致', () => {
    const { world, immediate, batched } = makeListeners(false);
    const a = world.createDynamicBox(-40, 0, 40, 40, 5);
    const b = world.createDynamicBox(40, 0, 40, 40, 5);
    world.setLinearVelocity(a, 0.5, 0);
    world.setLinearVelocity(b, -0.5, 0);
    for (let i = 0; i < 240; i++) world.stepFixed(1);

    const iBegins = immediate.filter((e) => e.phase === 'begin');
    const bBegins = batched.filter((e) => e.phase === 'begin');
    expect(iBegins.length).toBeGreaterThan(0);
    expect(iBegins.length).toBe(bBegins.length);
    // 即时无 batch；批次有 batch
    expect(iBegins[0]!.batch).toBeUndefined();
    expect(bBegins[0]!.batch).toBeDefined();
    // 运动学一致（同一快照，不重复不改变）
    expect(bBegins[0]!.bodyA).toBe(iBegins[0]!.bodyA);
    expect(bBegins[0]!.bodyB).toBe(iBegins[0]!.bodyB);
    expect(bBegins[0]!.relativeVelocity).toBe(iBegins[0]!.relativeVelocity);
    expect(bBegins[0]!.contactPoint.x).toBe(iBegins[0]!.contactPoint.x);
    expect(bBegins[0]!.normal.x).toBe(iBegins[0]!.normal.x);
    console.log(
      `[B4A-3] 即时无batch=${iBegins[0]!.batch === undefined} 批次batch=(${bBegins[0]!.batch!.timestamp.toFixed(1)},${bBegins[0]!.batch!.index}/${bBegins[0]!.batch!.size}) ` +
        `relVel 一致=${bBegins[0]!.relativeVelocity === iBegins[0]!.relativeVelocity}`,
    );
  });

  it('仅设置批次监听也能工作', () => {
    const world = new PlanckWorld();
    const batched: ContactBridgeEvent[] = [];
    world.setBatchedContactListener((e) => batched.push(e)); // 不设即时监听
    const a = world.createDynamicBox(-40, 0, 40, 40, 5);
    const b = world.createDynamicBox(40, 0, 40, 40, 5);
    world.setLinearVelocity(a, 0.5, 0);
    world.setLinearVelocity(b, -0.5, 0);
    for (let i = 0; i < 240; i++) world.stepFixed(1);

    const begins = batched.filter((e) => e.phase === 'begin');
    expect(begins.length).toBeGreaterThan(0);
    expect(begins[0]!.batch).toBeDefined();
    expect(begins[0]!.batch!.size).toBe(1);
    expect(begins[0]!.batch!.index).toBe(0);
    console.log(`[B4A-4] 仅批次监听 begin=${begins.length} batch=(${begins[0]!.batch!.timestamp.toFixed(1)},0/1)`);
  });
});
