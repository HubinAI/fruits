import type { SafeInsets } from '../platform/types';

/**
 * F-WX-UI-F1：Mobile Garage 唯一布局源。
 *
 * 所有 Mobile Garage 的几何（绘制 / HitArea / Preview Camera framingRect）只允许读取
 * computeMobileGarageLayout 的同一份结果——禁止在其它函数再次手算 topBar / vehicle /
 * panel / cta 区域（此前这些规则分散在 drawMobileGarageDock、getPreviewFramingRect、
 * HitArea 注册与 Renderer Camera 参数四处，且 draw 的 panel 底部（ctaY-14）与 camera 的
 * vehicle 底部（safe bottom-16）两套语义不一致，导致「代码改了真人变化很小」）。
 *
 * 本模块为纯函数：不 import CanvasPlayerUIHost / Renderer，无状态、无副作用，可直接单测。
 * 几何规则与 F-WX-UI-1 / F-WX-RCA-3A 既有行为一致（不改视觉样式、不改按钮结构）：
 * - topBarRect  顶部信息栏（只信息，高 34）；
 * - vehicleRect 左侧车辆展示区（~57% 屏宽；底部独立 safe bottom，不随右侧 CTA 变化）；
 * - panelRect   右侧装配面板（2×2 分类/二级/选项卡；底部到 CTA 上方 14px）；
 * - ctaRect     主 CTA「寻找对手」（唯一最大 220-300×56，距 safe bottom ≥16，不贴底）。
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MobileGarageLayout {
  topBarRect: Rect;
  vehicleRect: Rect;
  panelRect: Rect;
  ctaRect: Rect;
}

/** 顶栏高（≤42 逻辑 px，只信息） */
export const GARAGE_TOP_BAR_H = 34;
/** 主 CTA 高（触控 ≥52 规格内的最大值 56） */
export const GARAGE_CTA_H = 56;
/** CTA 距 safe bottom 最小间隙 */
export const GARAGE_CTA_BOTTOM_GAP = 16;
/** 车辆展示区占可用宽比例（面板左缘 = uL+10+0.57×usableW+12） */
const PANEL_SPLIT = 0.57;
/** 车辆/面板内容区距 safe 边缘的横向留白 */
const GARAGE_X_PAD = 10;

export function computeMobileGarageLayout(
  viewport: { w: number; h: number },
  insets: SafeInsets,
): MobileGarageLayout {
  const { w, h } = viewport;
  const uL = insets.left;
  const uR = insets.right;
  const uT = insets.top;
  const uB = insets.bottom;
  const usableW = Math.max(240, w - uL - uR);

  // 顶栏（内容区；绘制处可保留 ±4/8 视觉描边偏移，不算区域手算）
  const topBarRect: Rect = {
    x: uL + GARAGE_X_PAD,
    y: uT,
    w: Math.max(200, usableW - 20),
    h: GARAGE_TOP_BAR_H,
  };

  // CTA（唯一最大；与装配面板同一操作组，不贴屏幕边缘）
  const ctaY = h - uB - GARAGE_CTA_BOTTOM_GAP - GARAGE_CTA_H;
  const panelX = uL + GARAGE_X_PAD + Math.round(usableW * PANEL_SPLIT) + 12;
  const panelR = Math.max(panelX + 200, w - uR - GARAGE_X_PAD);
  const panelW = panelR - panelX;
  const ctaW = Math.min(300, Math.max(220, panelW));
  const ctaX = panelR - ctaW;
  const ctaRect: Rect = { x: ctaX, y: ctaY, w: ctaW, h: GARAGE_CTA_H };

  // 面板（右侧中央；底部到 CTA 上方 14px，与 CTA 形成操作组）
  const bodyTop = uT + GARAGE_TOP_BAR_H + 14;
  const panelBot = ctaY - 14;
  const panelRect: Rect = {
    x: panelX,
    y: bodyTop,
    w: panelW,
    h: Math.max(120, panelBot - bodyTop),
  };

  // 车辆展示区（左侧；F-WX-RCA-3A：底部独立使用 safe bottom，不随右侧 CTA 变化）
  const showX = uL + GARAGE_X_PAD;
  const showW = Math.max(200, panelX - 12 - showX);
  const vehBot = h - uB - 16;
  const vehicleRect: Rect = {
    x: showX,
    y: bodyTop,
    w: showW,
    h: Math.max(120, vehBot - bodyTop),
  };

  return { topBarRect, vehicleRect, panelRect, ctaRect };
}
