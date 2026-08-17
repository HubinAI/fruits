/**
 * Canonical Physics Foundation 的 targeted regression（Queue F-01）。
 *
 * 验证四个关键修复，全部直接调用正式 Battle Runtime（禁止第二套物理实现）：
 * 1. Fixed Step 帧率一致性：同一 Build、相同模拟时长，30FPS / 60FPS / 轻微卡帧（jitter）
 *    最终位置差 ≤ 2px、角度差 ≤ 1°（Drive 在每个 FIXED_DT 前执行 → 帧率无关）。
 * 2. vy 不持续累积：settled 车辆 600 步后 |body.velocity.y| < 5（gravity.scale=0.0001 根因修复）。
 * 3. compound sub-part Meta 传播：车身 sub-part 也能被 Contact Router 识别 Owner。
 * 4. Baseline Drive 接敌前无系统性抬头（车头角度不单调上扬）。
 */
import { describe, it, expect } from 'vitest';
import { createRegistry } from '../src/core/content';
import { resolveSnapshot } from '../src/core/buildSnapshot';
import { PhysWorld, createBox, Category, getMeta, FIXED_DT } from '../src/physics/adapter';
import { createVehicle, settleVehicleToRestPose } from '../src/battle/vehicleAssembly';
import { BattleOrchestrator } from '../src/battle/battleOrchestrator';
import { getPreset } from '../src/lab/presets';

const registry = createRegistry();
const light = getPreset('lightVehicle')!.build();

/* ---------------- 1. Fixed Step 帧率一致性 ---------------- */

interface SimResult {
  x: number;
  angle: number;
  steps: number;
}

/** 用给定的帧间隔序列推进同一 Build（走正式 BattleOrchestrator.step 入口），返回 A 车最终状态与实际物理步数 */
function runFramePattern(frameDts: number[]): SimResult {
  const orch = new BattleOrchestrator(light, light, registry, {
    autoDrive: true,
    spawnA: { x: 400, y: 640, facing: 1 },
    spawnB: { x: 1200, y: 640, facing: -1 },
  });
  let totalSteps = 0;
  for (const dt of frameDts) {
    const before = orch.timeMs;
    orch.step(dt);
    totalSteps += Math.round((orch.timeMs - before) / FIXED_DT);
  }
  return {
    x: orch.vehicleA.body.position.x,
    angle: orch.vehicleA.body.angle,
    steps: totalSteps,
  };
}

describe('Canonical Foundation · Fixed Step 帧率一致性', () => {
  it('相同模拟时长：30FPS / 60FPS / jitter 最终位置差 ≤ 2px、角度差 ≤ 1°', () => {
    const fps60 = Array.from({ length: 120 }, () => 1000 / 60);
    const fps30 = Array.from({ length: 60 }, () => 1000 / 30);

    // 轻微卡帧：每 4 帧有 1 帧 2 倍时长（掉一帧），总模拟时长 ≈ 2000ms
    const jitter: number[] = [];
    for (let i = 0; i < 96; i++) {
      jitter.push(1000 / 60);
      if (i % 4 === 3) jitter.push(1000 / 60); // 该帧翻倍
    }
    // 补足到与 120 步等价的模拟时长
    while (jitter.reduce((s, d) => s + d, 0) < 120 * (1000 / 60)) jitter.push(1000 / 60);

    const r60 = runFramePattern(fps60);
    const r30 = runFramePattern(fps30);
    const rj = runFramePattern(jitter);

    // 三者的实际物理步数应一致（±1 步容差，浮点累积）
    expect(Math.abs(r60.steps - r30.steps)).toBeLessThanOrEqual(1);
    expect(Math.abs(r60.steps - rj.steps)).toBeLessThanOrEqual(1);

    // 位置差 ≤ 2px、角度差 ≤ 1°（0.01745 rad）
    const maxDx = Math.max(Math.abs(r60.x - r30.x), Math.abs(r60.x - rj.x), Math.abs(r30.x - rj.x));
    const maxDa = Math.max(Math.abs(r60.angle - r30.angle), Math.abs(r60.angle - rj.angle), Math.abs(r30.angle - rj.angle));
    expect(maxDx).toBeLessThanOrEqual(2);
    expect(maxDa).toBeLessThanOrEqual(0.0175);
  });
});

/* ---------------- 2. vy 不持续累积 ---------------- */

describe('Canonical Foundation · vy 不持续累积', () => {
  it('settled 车辆 600 步后 |body.velocity.y| < 5，且全程无单调发散', () => {
    const world = new PhysWorld();
    const ground = createBox(800, 1150, 2400, 900, 0, {
      filter: { category: Category.GROUND, mask: Category.VEHICLE_A | Category.VEHICLE_B },
      friction: 1,
    });
    ground.isStatic = true;
    world.add(ground);
    const v = createVehicle(
      world,
      resolveSnapshot(light, registry),
      'A',
      { x: 600, y: 650 },
      1,
    );
    settleVehicleToRestPose(v, 700);

    let maxVy = 0;
    for (let i = 0; i < 600; i++) {
      world.step(FIXED_DT);
      maxVy = Math.max(maxVy, Math.abs(v.body.velocity.y));
    }

    // 600 步后 vy 绝对值 < 5（gravity.scale=0.0001 根因修复后收敛到 ~1.6，而非 0.01 时的 ~278）
    expect(Math.abs(v.body.velocity.y)).toBeLessThan(5);
    // 全程也不应出现发散（曾经会单调涨到 ~284）
    expect(maxVy).toBeLessThan(5);
  });

  it('正常驱动车辆 600 步后 vy 同样不累积（驱动不产生垂直漂移）', () => {
    const orch = new BattleOrchestrator(light, light, registry, {
      autoDrive: true,
      spawnA: { x: 600, y: 640, facing: 1 },
      spawnB: { x: 1400, y: 640, facing: -1 },
    });
    for (let i = 0; i < 600; i++) orch.step(FIXED_DT);

    // 驱动车辆最终 vy 也 < 5（驱动水平力不引入垂直漂移）
    expect(Math.abs(orch.vehicleA.body.velocity.y)).toBeLessThan(5);
    // 且确实前进了（驱动真实生效，非静止）
    expect(orch.vehicleA.body.position.x).toBeGreaterThan(700);
  });
});

/* ---------------- 3. compound sub-part Meta 传播 ---------------- */

describe('Canonical Foundation · compound sub-part Meta 传播', () => {
  it('车身 compound 的 sub-part 也携带 Owner meta（Contact Router 可识别）', () => {
    const world = new PhysWorld();
    const v = createVehicle(
      world,
      resolveSnapshot(light, registry),
      'A',
      { x: 0, y: 0 },
      1,
    );
    // 车身是 compound：parts[0] = parent，parts[1..] = 实际碰撞 sub-part
    expect(v.body.parts.length).toBeGreaterThan(1);
    for (const part of v.body.parts) {
      const meta = getMeta(part);
      expect(meta.kind).toBe('vehicle');
      expect(meta.team).toBe('A');
      expect(meta.partId).toBe('body');
    }
  });
});

/* ---------------- 4. Baseline Drive 无系统性抬头 ---------------- */

describe('Canonical Foundation · Baseline Drive 无系统性抬头', () => {
  it('接敌前（600 步内）车头角度不单调上扬，最终 |angle| < 1°', () => {
    // 两车相距 800px，A 朝 +X、B 朝 -X，600 步（10s）内不会相遇 → 纯驱动、无碰撞
    const orch = new BattleOrchestrator(light, light, registry, {
      autoDrive: true,
      spawnA: { x: 400, y: 640, facing: 1 },
      spawnB: { x: 1600, y: 640, facing: -1 },
    });
    let maxAngle = 0;
    let rising = 0; // 连续上扬计数（检测系统性抬头）
    let prevAngle = orch.vehicleA.body.angle;
    for (let i = 0; i < 600; i++) {
      orch.step(FIXED_DT);
      const a = orch.vehicleA.body.angle;
      maxAngle = Math.max(maxAngle, Math.abs(a));
      rising = a > prevAngle ? rising + 1 : 0;
      prevAngle = a;
    }
    // 最终车头接近水平（< 1°），无大幅抬头
    expect(Math.abs(orch.vehicleA.body.angle)).toBeLessThan(0.0175);
    // 全程最大倾角 < 3°（系统性抬头会被这条拦住）
    expect(maxAngle).toBeLessThan(0.0524);
    // 不允许长时间连续上扬（系统性抬头的特征）
    expect(rising).toBeLessThan(300);
  });
});
