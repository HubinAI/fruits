/**
 * Queue F-02M-A4｜Planck 重力落地最小验证（保留不回删）
 *
 * 验证：可配置重力 + 静态地面下，dynamic body 能自然下落、
 * 稳定停在地面、无穿透/NaN/反弹爆炸、60Hz fixed-step 结果可重复。
 *
 * 坐标系：px↔m 数值透传（units.ts，不翻转 Y）；重力参数使用 Planck 坐标
 * （m/s²，y 向上，负 y = 下落）。测试按数值语义构造：
 * body 初始 y 大于地面 y，重力使其向地面收敛。
 */
import { describe, it, expect } from 'vitest';
import { PlanckWorld } from '../src/physics/planckWorld';

const GROUND_Y_PX = 300; // 地面中心
const BODY_Y_PX = 700; // body 初始（数值上方）
const BODY_HALF_PX = 20; // body 半高 20px = 0.2m
const GROUND_HALF_PX = 40; // 地面半高 40px = 0.4m
// 停稳位置：Planck y 向上 → 地面顶面 = 中心+半高 = 340，body 中心 = 顶面+body 半高 = 360
const GROUND_TOP_PX = GROUND_Y_PX + GROUND_HALF_PX; // 340
const REST_Y_PX = GROUND_TOP_PX + BODY_HALF_PX; // 360

function runDrop(): { pos: { x: number; y: number }; vel: { x: number; y: number }; maxAbsY: number; maxSpeed: number; nan: boolean; settledAt: number } {
  const world = new PlanckWorld({ x: 0, y: -10 }); // Planck 坐标：-y = 下落
  const body = world.createDynamicBox(0, BODY_Y_PX, 40, 40, 5);
  const ground = world.createStaticGround(0, GROUND_Y_PX, 2000, 80);

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
  void ground;
  return {
    pos: finalPos,
    vel: finalVel,
    maxAbsY,
    maxSpeed,
    nan,
    settledAt,
  };
}

describe('F-02M-A4 · 重力落地', () => {
  it('body 自然下落并稳定停在地面（无穿透/NaN/爆炸）', () => {
    const r = runDrop();
    console.log(
      `[A4] 初始 pos=(${0},${BODY_Y_PX}) 最终 pos=(${r.pos.x.toFixed(2)},${r.pos.y.toFixed(2)}) ` +
        `最终 vel=(${r.vel.x.toExponential(3)},${r.vel.y.toExponential(3)}) ` +
        `maxAbsY=${r.maxAbsY.toFixed(2)} maxSpeed=${r.maxSpeed.toFixed(3)} 稳定步=${r.settledAt} NaN=${r.nan}`,
    );
    // 无 NaN/爆炸
    expect(r.nan).toBe(false);
    expect(r.maxAbsY).toBeLessThan(1e6);
    // 下落（初始 700 → 停稳 ~360）；接触求解容差 ±2.5px
    expect(r.pos.y).toBeGreaterThan(REST_Y_PX - 2.5);
    expect(r.pos.y).toBeLessThan(REST_Y_PX + 2.5);
    // 停稳后垂直速度接近 0
    expect(Math.abs(r.vel.y)).toBeLessThan(0.01);
    // 无穿透：body 底部不应低于地面顶面（允许 0.5px 求解容差）
    expect(r.pos.y - BODY_HALF_PX).toBeGreaterThanOrEqual(GROUND_TOP_PX - 0.5);
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
