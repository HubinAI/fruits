/**
 * F-UX-REVIEW-1｜DEV Mobile Review 纯逻辑（PC 复现真实手机 logical viewport）。
 *
 * 只提供「预设矩阵 + 容器样式计算 + 状态机」，不碰 DOM——main.ts 消费本模块构建工具栏，
 * 测试可直接单测本模块。游戏内部（PlayerGameRuntime / CanvasPlayerUIHost / Renderer）零改动：
 * 内部逻辑尺寸 = 所选 viewport（容器 CSS 尺寸 = vp.w × vp.h），视觉放大只走 CSS transform。
 */

/** 预设 logical viewport 矩阵（真实安卓/iPhone 微信横屏；DPR 只影响物理像素，不影响布局） */
export const REVIEW_PRESETS: ReadonlyArray<{ w: number; h: number }> = [
  { w: 360, h: 180 },
  { w: 390, h: 195 },
  { w: 420, h: 210 },
  { w: 460, h: 230 },
  { w: 621, h: 351 },
];

/** 默认 420×210 */
export const DEFAULT_REVIEW_INDEX = 2;

/** 显示放大倍数（1x / 2x；仅视觉，不改变内部 logical viewport） */
export type ReviewScale = 1 | 2;

export interface ReviewContainerStyle {
  width: number;
  height: number;
  transform: string;
  transformOrigin: string;
}

/** 容器样式：CSS 尺寸 = 逻辑 viewport（内部布局严格等于它）；视觉放大 = transform scale */
export function reviewContainerStyle(vp: { w: number; h: number }, scale: ReviewScale): ReviewContainerStyle {
  return {
    width: vp.w,
    height: vp.h,
    transform: `scale(${scale})`,
    transformOrigin: 'top left',
  };
}

export interface MobileReviewState {
  presetIndex: number;
  scale: ReviewScale;
}

export function createMobileReviewState(presetIndex = DEFAULT_REVIEW_INDEX): MobileReviewState {
  const clamped = Math.max(0, Math.min(REVIEW_PRESETS.length - 1, presetIndex));
  return { presetIndex: clamped, scale: 2 };
}

/** 切换到指定预设（越界钳制）；返回新状态 */
export function selectReviewPreset(state: MobileReviewState, index: number): MobileReviewState {
  return { ...state, presetIndex: Math.max(0, Math.min(REVIEW_PRESETS.length - 1, index)) };
}

/** 切换 1x/2x 显示（仅视觉放大） */
export function toggleReviewScale(state: MobileReviewState): MobileReviewState {
  return { ...state, scale: state.scale === 1 ? 2 : 1 };
}

/** 当前生效的 viewport 预设 */
export function reviewViewport(state: MobileReviewState): { w: number; h: number } {
  return REVIEW_PRESETS[state.presetIndex];
}
