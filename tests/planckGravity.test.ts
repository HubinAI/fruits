/**
 * Queue F-02M-A4R｜Planck 重力落地最小验证（Y-down 契约，保留不回删）
 *
 * 验证：可配置重力 + 静态地面下，dynamic body 能自然下落、
 * 稳定停在地面、无穿透/NaN/反弹爆炸、60Hz fixed-step 结果可重复。
 *
 * 坐标系：适配层沿用项目 Y-down、不翻转（units.ts 数值透传）。
 * gravityMps2.y > 0 表示向下重力。
 * 测试按 Y-down 语义构造：body 初始 y=300（上方），ground 中心 y=700（下方），
 * 重力 {x:0, y:10} 使 body 向数值增大方向（下）收敛到 ground。
 */
import { describe, it, expect } from 'vitest';
import { PlanckWorld } from '../src/physics/planckWorld';

const GROUND_Y_PX = 700; // 地面中心
const BODY_Y_PX = 300; // body 初始（Y-down：上方 = 数值更小）
const BODY_HALF_PX = 20; // body 半高 20px = 0.2m
const GROUND_HALF_PX = 40; // 地面半高 40px = 0.4m
// Y-down：ground 顶面 = 中心 - 半高 = 660；body 中心停稳 = 顶面 - body 半高 = 640
const GROUND_TOP_PX = GROUND_Y_PX - GROUND_HALF_PX; // 660
const REST_Y_PX = GROUND_TOP_PX - BODY_HALF_PX; // 640

function runDrop(): { pos: { x: number; y: number }; vel: { x: number; y: number }; maxAbsY: number; maxSpeed: number; nan: boolean; settledAt: number } {
  const world = new PlanckWorld({ x: 0, y: 10 }); // Y-down：+y = 向下重力
  const body = world.createDynamicBox(0, BODY_Y_PX, 40, 40, 5);
  world.createStaticGround(0, GROUND_Y_PX, 2000, 80);

  let maxAbsY = 0;
  let maxSpeed = 0;
  let nan = false;
  let prevY = world.getPosition(body).y;
  let settledAt = -1;
  let stableSteps = 0;

  for (let i = 0; i < 600; i++) {
    world.stepFixed(1);
    const pos = world.getPosition(body);
    const vel = world.getLinearVelocity(body);
    const speed = Math.hypot(vel.x, vel.y);
    if (Math.abs(pos.y) > maxAbsY) maxAbsY = Math.abs(pos.y);
    if (speed > maxSpeed) maxSpeed = speed;
    if (![pos.x, pos.y, vel.x, vel.y].every(Number.isFinite)) nan = true;
    // 稳定判定：位置变化 < 0.01px/step 连续 120 步
    if (Math.abs(pos.y - prevY) < 0.01 && speed < 0.01) {
      stableSteps++;
      if (settledAt < 0 && stableSteps === 120) settledAt = i;
    } else {
      stableSteps = 0;
    }
    prevY = pos.y;
    if (settledAt > 0) break;
  }

  const finalPos = world.getPosition(body);
  const finalVel = world.getLinearVelocity(body);
  return {
    pos: finalPos,
    vel: finalVel,
    maxAbsY,
    maxSpeed,
    nan,
    settledAt,
  };
}

describe('F-02M-A4R · 重力落地（Y-down）', () => {
  it('body 自然下落并稳定停在地面（无穿透/NaN/爆炸）', () => {
    const r = runDrop();
    console.log(
      `[A4R] 初始 pos=(${0},${BODY_Y_PX}) 最终 pos=(${r.pos.x.toFixed(2)},${r.pos.y.toFixed(2)}) ` +
        `预期停稳 y=${REST_Y_PX} 最终 vel=(${r.vel.x.toExponential(3)},${r.vel.y.toExponential(3)}) ` +
        `maxAbsY=${r.maxAbsY.toFixed(2)} maxSpeed=${r.maxSpeed.toFixed(3)} 稳定步=${r.settledAt} NaN=${r.nan}`,
    );
    // 无 NaN/爆炸
    expect(r.nan).toBe(false);
    expect(r.maxAbsY).toBeLessThan(1e6);
    // 下落：最终 y > 初始 y（Y-down 向下 = 数值增大）
    expect(r.pos.y).toBeGreaterThan(BODY_Y_PX);
    // 停稳中心 ≈ 640（接触求解容差 ±2.5px）
    expect(Math.abs(r.pos.y - REST_Y_PX)).toBeLessThan(2.5);
    // 停稳后垂直速度接近 0
    expect(Math.abs(r.vel.y)).toBeLessThan(0.01);
    // 无穿透：body 底部 pos.y+20 不得穿过 ground 顶面 660（允许 0.5px 求解容差）
    expect(r.pos.y + BODY_HALF_PX).toBeLessThanOrEqual(GROUND_TOP_PX + 0.5);
    // 已稳定（120 连续稳定步）
    expect(r.settledAt).toBeGreaterThan(0);
  });

  it('60Hz fixed-step 结果可重复（两次运行一致）', () => {
    const a = runDrop();
    const b = runDrop();
    expect(Math.abs(a.pos.x - b.pos.x)).toBeLessThan(1e-9);
    expect(Math.abs(a.pos.y - b.pos.y)).toBeLessThan(1e-9);
    expect(Math.abs(a.vel.y - b.vel.y)).toBeLessThan(1e-12);
    expect(a.settledAt).toBe(b.settledAt);
  });

  it('默认零重力 world 行为不变（body 不自行移动）', () => {
    const world = new PlanckWorld();
    const body = world.createDynamicBox(0, 100, 40, 40, 5);
    const p0 = world.getPosition(body);
    world.stepFixed(120);
    const p1 = world.getPosition(body);
    expect(Math.abs(p1.x - p0.x)).toBeLessThan(1e-12);
    expect(Math.abs(p1.y - p0.y)).toBeLessThan(1e-12);
  });
});
