/**
 * F-WX-6 / F-WX-MOBILE-RCA-1｜Landscape Layout Profile（布局策略）。
 *
 * F-WX-6：不再对全部尺寸机械使用 1280×720 整体等比缩放。
 *
 * F-WX-MOBILE-RCA-1：真实安卓微信高 DPR 下 logical viewport 可低至 360~480×180~240，
 * 原有「放不下也强撑」的固定下限（48/56/120/200）在短屏数学上无法同时成立 → 结构溢出。
 * 因此拆分两档 Mobile Profile：
 * - mobile-normal（logicalH ≥ 260）：保持既有触控/字号规格（48/52、字号 ×1.0），零回归；
 * - mobile-short（logicalH < 260）：TopBar 更薄、触控允许降到 36~40 logical px、CTA 动态
 *   40~48、字号统一 ×0.8（text() 内统一应用）——logical px 在高 DPR 下物理尺寸仍足够。
 *
 * 判定规则与 Renderer（isCompactLandscape）同一来源（src/render/viewportProfile.ts）。
 */
import { isCompactLandscape } from '../render/viewportProfile';

export type LayoutMode = 'desktop' | 'mobile-normal' | 'mobile-short';

export interface LayoutProfile {
  mode: LayoutMode;
  /** Desktop：1280×720 逻辑基准；Mobile：与视口同宽高（逻辑 px，scale=1） */
  baseW: number;
  baseH: number;
  /** 字体 scale（mobile-short ≈0.8；其余 1.0）——统一经 text() 应用，禁止页面自行除 0.8 */
  fontScale: number;
  /** 主触控目标最小/目标高度（mobile-short 36/40；normal 48/52；逻辑 px） */
  minTouchH: number;
  targetTouchH: number;
}

/** mobile-short 判定：logicalH < 260（不依赖具体机型） */
export const MOBILE_SHORT_H = 260;

export function resolveLayoutProfile(logicalW: number, logicalH: number): LayoutProfile {
  if (isCompactLandscape(logicalW, logicalH)) {
    const short = logicalH < MOBILE_SHORT_H;
    return {
      mode: short ? 'mobile-short' : 'mobile-normal',
      baseW: logicalW,
      baseH: logicalH,
      fontScale: short ? 0.8 : 1,
      minTouchH: short ? 36 : 48,
      targetTouchH: short ? 40 : 52,
    };
  }
  return { mode: 'desktop', baseW: 1280, baseH: 720, fontScale: 1, minTouchH: 48, targetTouchH: 52 };
}

/** 移动端主要触控目标的最小/目标高度（normal 语义，logical px）；short 档由 profile 提供。
 *  F-WX-UI-1：最小 48（Queue 规格），目标 52~60；F-WX-MOBILE-RCA-1：short 档允许 36~40。 */
export const MIN_TOUCH_H = 48;
export const TARGET_TOUCH_H = 52;
