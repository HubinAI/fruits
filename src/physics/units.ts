/**
 * 物理单位换算契约（Queue F-02M-A2）—— Planck 迁移的唯一单位边界。
 *
 * 契约规则（必须遵守）：
 * 1. 游戏层位置继续使用 px（像素）。
 * 2. 游戏层线速度继续使用 px/fixed-step（每物理步像素数）。
 * 3. 游戏层角速度继续使用 rad/fixed-step（每物理步弧度）。
 * 4. Planck 内部使用 m、m/s、rad/s（MKS 体系）。
 * 5. 项目继续采用 Y 轴向下，不在换算层翻转符号（正负号原样透传）。
 * 6. 扭矩换算：仅「圆盘惯量 0.5·m·r² + τ=I·α」这一条路径已由
 *    Queue F-02M-B10D1（Planck 双向驱动动力标定）实测验证，可安全使用；
 *    通用 force / impulse 换算仍未标定，禁止猜测。
 *
 * 上层代码不直接感知 Planck 单位：所有换算只在物理适配层（PlanckWorld
 * 及其配套）内发生。任何未经验证的 force/torque/impulse 换算，
 * 在动力标定完成前不得落地。
 */

/** 固定物理步率（Hz）：与现有 FIXED_DT=1000/60 一致 */
export const PHYSICS_HZ = 60;

/** 每个物理步的秒数 */
export const SECONDS_PER_STEP = 1 / PHYSICS_HZ;

/** 像素 → 米 的比例（100px = 1m） */
export const PX_PER_M = 100;

/** 像素 → 米（游戏层位置 → Planck 位置；Y 轴向下不翻转符号） */
export function pxToM(px: number): number {
  return px / PX_PER_M;
}

/** 米 → 像素（Planck 位置 → 游戏层位置；Y 轴向下不翻转符号） */
export function mToPx(m: number): number {
  return m * PX_PER_M;
}

/** px/fixed-step → m/s（游戏层线速度 → Planck 线速度） */
export function pxPerStepToMps(v: number): number {
  return (v * PHYSICS_HZ) / PX_PER_M;
}

/** m/s → px/fixed-step（Planck 线速度 → 游戏层线速度） */
export function mpsToPxPerStep(v: number): number {
  return (v * PX_PER_M) / PHYSICS_HZ;
}

/** rad/fixed-step → rad/s（游戏层角速度 → Planck 角速度） */
export function radPerStepToRadPerSec(w: number): number {
  return w * PHYSICS_HZ;
}

/** rad/s → rad/fixed-step（Planck 角速度 → 游戏层角速度） */
export function radPerSecToRadPerStep(w: number): number {
  return w / PHYSICS_HZ;
}

/**
 * RPM → rad/fixed-step（电机标称转速 → 游戏层角速度）。
 * 公式：rpm × 2π / 60 / PHYSICS_HZ；正负号与 0 原样透传，不隐藏任何倍率。
 */
export function rpmToRadPerStep(rpm: number): number {
  return (rpm * 2 * Math.PI) / 60 / PHYSICS_HZ;
}

/** rad/fixed-step → RPM（上式的精确逆换算；正负号与 0 原样透传） */
export function radPerStepToRpm(radPerStep: number): number {
  return (radPerStep * 60 * PHYSICS_HZ) / (2 * Math.PI);
}

/**
 * 实心圆盘绕中心轴的转动惯量（kg·m²）。
 * 公式：0.5 × massKg × pxToM(radiusPx)²；输入为游戏层半径（px）。
 */
export function solidDiskInertiaKgM2(massKg: number, radiusPx: number): number {
  return 0.5 * massKg * pxToM(radiusPx) ** 2;
}

/** 角加速度 → 扭矩（N·m）：τ = I × α（B10D1 已验证路径） */
export function angularAccelerationToTorqueNm(
  alphaRadPerSec2: number,
  inertiaKgM2: number,
): number {
  return inertiaKgM2 * alphaRadPerSec2;
}
