import type { SafeInsets } from '../platform/types';
import type { LayoutProfile } from './layoutProfile';

/**
 * F-WX-UI-F1 / F-WX-UI-2A / F-META-UX1 / F-WX-MOBILE-RCA-1：Mobile 唯一布局源。
 *
 * 所有 Mobile 几何（绘制 / HitArea / Preview Camera framingRect）只允许读取
 * computeMobileGarageLayout 的同一份结果——禁止在其它函数再次手算 topBar / vehicle /
 * panel / cta 区域。
 *
 * F-WX-MOBILE-RCA-1（尺寸系统重构）：删除「放不下也强撑」的固定下限
 * （panelW ≥200 / 区域高 ≥120 / TopBar 34 / CTA 56 / 触控 48）——在真实安卓高 DPR
 * logical viewport（360~480×180~240）下这些下限数学上无法同时成立，导致结构溢出。
 * 现在：
 * - 所有区域尺寸一律由 availableW / availableH 反推（short 档 TopBar 24、CTA 40~48、
 *   触控 36~40、间隙 6）；normal 档保持既有规格（零回归）。
 * - 硬条件：每个 rect 必须满足 x≥safeLeft、y≥safeTop、x+w≤logicalW-safeRight、
 *   y+h≤logicalH-safeBottom，无例外（矩形高用 ≥1 兜底防除零/负，不再强撑大值）。
 *
 * 本模块为纯函数：不 import CanvasPlayerUIHost / Renderer，无状态、无副作用，可直接单测。
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MobileGarageLayout {
  topBarRect: Rect;
  /** F-META-1：Main Shell 中央功能内容区（backpack/more 页用；garage 页用 vehicle/panel/cta） */
  contentRect: Rect;
  vehicleRect: Rect;
  panelRect: Rect;
  ctaRect: Rect;
}

/** 顶栏高（normal；只信息） */
export const GARAGE_TOP_BAR_H = 34;
/** 主 CTA 高（normal） */
export const GARAGE_CTA_H = 56;
/** CTA 距 safe bottom 最小间隙（normal；short 用 6） */
export const GARAGE_CTA_BOTTOM_GAP = 16;
/** F-WX-UI-2A：左侧车辆展示区占可用宽比例（约 48%~52% 目标区间上沿） */
export const VEHICLE_RATIO = 0.52;
/** F-WX-UI-2A：右侧装配面板占可用宽比例（约 40%~44%） */
export const PANEL_RATIO = 0.42;
/** F-WX-UI-2A：车辆区与面板区中间间隙（12~16px；short 用 8） */
export const GARAGE_MID_GAP = 14;

export function computeMobileGarageLayout(
  viewport: { w: number; h: number },
  insets: SafeInsets,
  profile: LayoutProfile = {
    mode: 'mobile-normal',
    baseW: viewport.w,
    baseH: viewport.h,
    fontScale: 1,
    minTouchH: 48,
    targetTouchH: 52,
  },
): MobileGarageLayout {
  const { w, h } = viewport;
  const short = profile.mode === 'mobile-short';
  const uL = insets.left;
  const uR = insets.right;
  const uT = insets.top;
  const uB = insets.bottom;
  // F-WX-MOBILE-RCA-1：不再 max(240) 强撑——可用宽由真实 viewport 反推
  const usableW = Math.max(40, w - uL - uR);

  // 横向：52% / gap / 42% 三段，剩余分两侧留白；panelW 由 availableW 反推（不再 max(200)）
  const sidePad = Math.max(6, Math.floor(usableW * 0.02));
  const vehicleW = Math.max(60, Math.floor(usableW * VEHICLE_RATIO));
  const midGap = short ? 8 : GARAGE_MID_GAP;
  const panelW = Math.max(48, usableW - vehicleW - midGap - 2 * sidePad);
  const showX = uL + sidePad;
  const panelX = showX + vehicleW + midGap;
  const panelR = panelX + panelW;

  // 纵向：TopBar / 内容区 / CTA 全部由 availableH 反推（short 更薄、间隙更小）
  const topBarH = short ? 24 : GARAGE_TOP_BAR_H;
  const ctaBottomGap = short ? 6 : GARAGE_CTA_BOTTOM_GAP;
  const bodyGap = short ? 6 : 8;
  const panelCtaGap = short ? 6 : 14;
  const vehBottomGap = short ? 8 : 16;
  const ctaH = short ? Math.max(36, Math.min(48, Math.floor((h - uT - uB) * 0.16))) : GARAGE_CTA_H;

  // 顶栏（薄栏，只信息；与左右区域对齐）
  const topBarRect: Rect = {
    x: showX,
    y: uT,
    w: Math.max(60, panelR - showX),
    h: topBarH,
  };

  // F-META-UX1：已删除 Main Shell 导航行——Garage 回归唯一 Home，内容区直接在顶栏下方。

  // CTA（右侧面板正下方，与面板同宽；不贴整屏底边）
  const ctaY = h - uB - ctaBottomGap - ctaH;
  const ctaRect: Rect = { x: panelX, y: ctaY, w: panelW, h: ctaH };

  // 面板（右侧中央；底部到 CTA 上方，与 CTA 形成完整操作组；高由 available 反推，不再 max(120)）
  const bodyTop = uT + topBarH + bodyGap;
  const panelBot = ctaY - panelCtaGap;
  const panelRect: Rect = {
    x: panelX,
    y: bodyTop,
    w: panelW,
    h: Math.max(1, panelBot - bodyTop),
  };

  // 车辆展示区（左侧；底部独立 safe bottom，不随右侧 CTA 变化；高反推）
  const vehBot = h - uB - vehBottomGap;
  const vehicleRect: Rect = {
    x: showX,
    y: bodyTop,
    w: vehicleW,
    h: Math.max(1, vehBot - bodyTop),
  };

  // F-META-1：中央功能内容区（backpack/more 页；跨车辆区+面板区整宽；高反推）
  const contentRect: Rect = {
    x: showX,
    y: bodyTop,
    w: Math.max(60, panelR - showX),
    h: Math.max(1, vehBot - bodyTop),
  };

  return { topBarRect, contentRect, vehicleRect, panelRect, ctaRect };
}
