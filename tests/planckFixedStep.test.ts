/**
 * Queue F-02M-B15A｜Planck 固定步累加接口测试
 *
 * 覆盖：
 * 1. 两次半帧累计为一步；回调只执行一次且发生在物理推进前；
 * 2. 30FPS / 60FPS / 轻微 jitter 的总固定步数与最终位置一致（帧率无关）；
 * 3. timeScale=0/0.5/2 的步数符合现有 Matter 语义；
 * 4. 长帧 catch-up 结果与 PhysWorld.step 完全一致（steps>8 break）；
 * 5. 原 planckWorldCore 测试全部回归通过（在队列验证中运行）。
 */
import { describe, it, expect } from 'vitest';
import { PlanckWorld } from '../src/physics/planckWorld';
import { PhysWorld } from '../src/physics/adapter';
import { PHYSICS_HZ } from '../src/physics/units';

const FIXED_DT = 1000 / PHYSICS_HZ; // 16.666...ms，与 Matter FIXED_DT 数值一致

describe('F-02M-B15A · 1. 半帧累加与回调时机', () => {
  it('两次半帧累计为一步；回调只执行一次且发生在物理推进前', () => {
    const world = new PlanckWorld();
    const b = world.createKinematicBox(0, 0, 10, 10);
    world.setLinearVelocity(b, 1, 0);
    const p0 = world.getPosition(b).x;
    let cbCount = 0;
    let posInCb = Number.NaN;
    const cb = () => {
      cbCount++;
      posInCb = world.getPosition(b).x;
    };

    // 半帧：不足一步
    expect(world.step(FIXED_DT / 2, 1, cb)).toBe(0);
    expect(cbCount).toBe(0);
    // 再半帧：累计满一步
    expect(world.step(FIXED_DT / 2, 1, cb)).toBe(1);
    expect(cbCount).toBe(1);
    // 回调发生在物理推进前：回调内位置 == step 前位置
    expect(posInCb).toBeCloseTo(p0, 9);
    // 物理已推进一步（kinematic 1px/step）
    expect(world.getPosition(b).x).toBeCloseTo(p0 + 1, 6);
  });
});

describe('F-02M-B15A · 2. 帧率无关：与 Matter PhysWorld 完全一致', () => {
  function runWith(dts: number[]): { steps: number; pos: number } {
    const world = new PlanckWorld();
    const b = world.createKinematicBox(0, 0, 10, 10);
    world.setLinearVelocity(b, 1, 0);
    let total = 0;
    for (const dt of dts) total += world.step(dt, 1);
    return { steps: total, pos: world.getPosition(b).x };
  }

  function runMatterWith(dts: number[]): number {
    const mw = new PhysWorld({ x: 0, y: 0 });
    let total = 0;
    for (const dt of dts) total += mw.step(dt, 1);
    return total;
  }

  it('30FPS / 60FPS / jitter：Planck 与 Matter 逐序列一致；jitter 1000ms 修正后均推进 60 步', () => {
    const r30 = runWith(Array.from({ length: 30 }, () => 1000 / 30));
    const r60 = runWith(Array.from({ length: 60 }, () => 1000 / 60));
    // 30 帧轻微 jitter：10 组 [34,33,33]，总和精确 1000ms
    const jitterDts = Array.from({ length: 10 }, () => [34, 33, 33]).flat();
    const rj = runWith(jitterDts);
    // Matter 参考（同序列输入）
    const m30 = runMatterWith(Array.from({ length: 30 }, () => 1000 / 30));
    const m60 = runMatterWith(Array.from({ length: 60 }, () => 1000 / 60));
    const mj = runMatterWith(jitterDts);
    console.log(
      `[B15A-R1-fps] 30fps p=${r30.steps}/m=${m30} 60fps p=${r60.steps}/m=${m60} jitter p=${rj.steps}/m=${mj} ` +
        `pos30=${r30.pos.toFixed(6)} pos60=${r60.pos.toFixed(6)} posJ=${rj.pos.toFixed(6)}`,
    );
    // 与 Matter 逐序列完全一致
    expect(r30.steps).toBe(m30);
    expect(r60.steps).toBe(m60);
    expect(rj.steps).toBe(mj);
    // jitter 修正目标（B15A-R1）：[34,33,33]×10 = 1000ms → Matter=60、Planck=60、位置=60
    expect(mj).toBe(60);
    expect(rj.steps).toBe(60);
    expect(rj.pos).toBeCloseTo(60, 6);
    // 其余序列位置 = 步数（kinematic 1px/step）
    expect(r30.pos).toBeCloseTo(r30.steps, 6);
    expect(r60.pos).toBeCloseTo(r60.steps, 6);
  });
});

describe('F-02M-B15A · 3. timeScale 语义（与 Matter 一致）', () => {
  it('timeScale=0 不推进；0.5 每 2 帧 1 步；2 每帧 2 步', () => {
    const w0 = new PlanckWorld();
    expect(w0.step(1000, 0)).toBe(0);
    expect(w0.step(1000, 0)).toBe(0);

    // 0.5：33.33ms × 0.5 = 16.67ms/帧 → 每帧 1 步，10 帧 = 10 步
    const w05 = new PlanckWorld();
    let t05 = 0;
    for (let i = 0; i < 10; i++) t05 += w05.step(1000 / 30, 0.5);
    expect(t05).toBe(10);

    // 2：16.67ms × 2 = 33.33ms/帧 → 每帧 2 步，10 帧 = 20 步
    const w2 = new PlanckWorld();
    let t2 = 0;
    for (let i = 0; i < 10; i++) t2 += w2.step(1000 / 60, 2);
    expect(t2).toBe(20);
  });
});

describe('F-02M-B15A · 4. 长帧 catch-up 与 PhysWorld 一致', () => {
  it('超长帧（5000ms）返回步数与 Matter PhysWorld.step 完全一致（steps>8 break）', () => {
    // Matter 参考
    const mw = new PhysWorld({ x: 0, y: 0 });
    let mcb = 0;
    const mSteps = mw.step(5000, 1, () => mcb++);
    // Planck
    const pw = new PlanckWorld();
    let pcb = 0;
    const pSteps = pw.step(5000, 1, () => pcb++);
    console.log(
      `[B15A-catchup] matter=${mSteps} (cb=${mcb}) planck=${pSteps} (cb=${pcb})`,
    );
    // 上限语义：steps>8 时 break（最多 9 次迭代）
    expect(mSteps).toBe(9);
    expect(mcb).toBe(9);
    // 与 PhysWorld 完全一致
    expect(pSteps).toBe(mSteps);
    expect(pcb).toBe(mcb);
    expect(pSteps).toBe(9);
  });
});
