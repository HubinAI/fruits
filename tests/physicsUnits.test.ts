/**
 * Queue F-02M-A2｜物理单位换算契约（targeted regression）
 *
 * 覆盖：
 * - 所有换算函数在正数/负数/0 输入下的往返误差 < 1e-12；
 * - 固定换算关系：100px=1m、1px/step=0.6m/s、0.75px/step=0.45m/s、
 *   0.5px/step=0.30m/s、1rad/step=60rad/s。
 */
import { describe, it, expect } from 'vitest';
import {
  PHYSICS_HZ,
  SECONDS_PER_STEP,
  PX_PER_M,
  pxToM,
  mToPx,
  pxPerStepToMps,
  mpsToPxPerStep,
  radPerStepToRadPerSec,
  radPerSecToRadPerStep,
  rpmToRadPerStep,
  radPerStepToRpm,
  solidDiskInertiaKgM2,
  angularAccelerationToTorqueNm,
} from '../src/physics/units';

describe('F-02M-A2 · 常量', () => {
  it('PHYSICS_HZ=60、SECONDS_PER_STEP=1/60、PX_PER_M=100', () => {
    expect(PHYSICS_HZ).toBe(60);
    expect(SECONDS_PER_STEP).toBeCloseTo(1 / 60, 15);
    expect(PX_PER_M).toBe(100);
  });
});

describe('F-02M-A2 · 固定换算关系', () => {
  it('100px = 1m', () => {
    expect(pxToM(100)).toBe(1);
    expect(mToPx(1)).toBe(100);
  });

  it('1px/step = 0.6m/s', () => {
    expect(pxPerStepToMps(1)).toBeCloseTo(0.6, 12);
  });

  it('0.75px/step = 0.45m/s', () => {
    expect(pxPerStepToMps(0.75)).toBeCloseTo(0.45, 12);
  });

  it('0.5px/step = 0.30m/s', () => {
    expect(pxPerStepToMps(0.5)).toBeCloseTo(0.3, 12);
  });

  it('1rad/step = 60rad/s', () => {
    expect(radPerStepToRadPerSec(1)).toBe(60);
  });
});

describe('F-02M-A2 · 往返误差（正/负/0）', () => {
  const samples = [0, 1, -1, 123.456, -789.012, 0.001, -0.001];

  it('pxToM ↔ mToPx 往返 < 1e-12', () => {
    for (const s of samples) {
      expect(Math.abs(mToPx(pxToM(s)) - s)).toBeLessThan(1e-12);
    }
  });

  it('pxPerStepToMps ↔ mpsToPxPerStep 往返 < 1e-12', () => {
    for (const s of samples) {
      expect(Math.abs(mpsToPxPerStep(pxPerStepToMps(s)) - s)).toBeLessThan(1e-12);
    }
  });

  it('radPerStepToRadPerSec ↔ radPerSecToRadPerStep 往返 < 1e-12', () => {
    for (const s of samples) {
      expect(Math.abs(radPerSecToRadPerStep(radPerStepToRadPerSec(s)) - s)).toBeLessThan(1e-12);
    }
  });

  it('符号保持（Y 轴向下不翻转）', () => {
    expect(pxToM(-50)).toBeLessThan(0);
    expect(pxPerStepToMps(-1)).toBeLessThan(0);
    expect(radPerStepToRadPerSec(-2)).toBeLessThan(0);
  });
});

describe('F-02M-B10A1 · 轮驱动力单位契约', () => {
  it('300 RPM = 0.5235987756 rad/step', () => {
    expect(rpmToRadPerStep(300)).toBeCloseTo(0.5235987756, 10);
  });

  it('RPM ↔ rad/step 对正数、负数、0 往返误差 < 1e-12', () => {
    for (const rpm of [300, 100, -300, -100, 0, 1.5, -1.5]) {
      const round = radPerStepToRpm(rpmToRadPerStep(rpm));
      expect(Math.abs(round - rpm)).toBeLessThan(1e-12);
    }
    // 逆方向往返（rad/step → rpm → rad/step）
    for (const w of [0.5235987756, -0.075, 0, 0.075]) {
      const round = rpmToRadPerStep(radPerStepToRpm(w));
      expect(Math.abs(round - w)).toBeLessThan(1e-12);
    }
  });

  it('mass=10kg、radius=20px 的实心圆盘惯量为 0.2 kg·m²', () => {
    // 0.5 × 10 × (20/100)² = 5 × 0.04 = 0.2
    expect(solidDiskInertiaKgM2(10, 20)).toBeCloseTo(0.2, 12);
  });

  it('α=100 rad/s²、I=0.2 kg·m² → τ=20 N·m', () => {
    expect(angularAccelerationToTorqueNm(100, 0.2)).toBeCloseTo(20, 12);
  });
});
