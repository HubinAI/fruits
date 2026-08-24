/**
 * F-WX-6｜Landscape Layout Profile（布局策略）。
 *
 * 不再对全部尺寸机械使用 1280×720 整体等比缩放：
 * - Desktop（大横屏，h≥600）：保持 1280×720 逻辑基准 + 整体 fit（既有行为，零回归）；
 * - Compact Mobile（手机横屏 ~800~950×360~450）：独立「逻辑 px」布局基准——
 *   scale=1、坐标即逻辑 px（Web=CSS px / 微信=逻辑 px），触控高度用显式最小尺寸
 *   （≥40 CSS px，目标 44~48），杜绝整体缩放把按钮压到 20~30px。
 *
 * 判定规则与 Renderer（isCompactLandscape）同一来源（src/render/viewportProfile.ts）。
 */
import { isCompactLandscape } from '../render/viewportProfile';

export type LayoutMode = 'desktop' | 'mobile';

export interface LayoutProfile {
  mode: LayoutMode;
  /** Desktop：1280×720 逻辑基准；Mobile：与视口同宽高（逻辑 px，scale=1） */
  baseW: number;
  baseH: number;
}

export function resolveLayoutProfile(logicalW: number, logicalH: number): LayoutProfile {
  if (isCompactLandscape(logicalW, logicalH)) {
    return { mode: 'mobile', baseW: logicalW, baseH: logicalH };
  }
  return { mode: 'desktop', baseW: 1280, baseH: 720 };
}

/** 移动端主要触控目标的最小/目标高度（CSS px / 逻辑 px）；视觉可略小，命中区不可小于此
 *  F-WX-UI-1：最小 48（Queue 规格），目标 52~60 */
export const MIN_TOUCH_H = 48;
export const TARGET_TOUCH_H = 52;
