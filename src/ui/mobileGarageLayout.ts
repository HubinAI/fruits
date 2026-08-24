import type { SafeInsets } from '../platform/types';

/**
 * F-WX-UI-F1 / F-WX-UI-2A：Mobile Garage 唯一布局源。
 *
 * 所有 Mobile Garage 的几何（绘制 / HitArea / Preview Camera framingRect）只允许读取
 * computeMobileGarageLayout 的同一份结果——禁止在其它函数再次手算 topBar / vehicle /
 * panel / cta 区域（此前这些规则分散在 drawMobileGarageDock、getPreviewFramingRect、
 * HitArea 注册与 Renderer Camera 参数四处，且 draw 的 panel 底部（ctaY-14）与 camera 的
 * vehicle 底部（safe bottom-16）两套语义不一致，导致「代码改了真人变化很小」）。
 *
 * F-WX-UI-2A（首屏强制重构）：固定三块结构，产生肉眼差异——
 * - 顶部薄栏：仅金币 / 段位 / 能量（高 34，只信息）；
 * - 左侧车辆展示区：占主要空间（~52% 可用宽，底部独立 safe bottom）；
 * - 右侧装配面板 + CTA 一个完整操作组（~42% 可用宽；「寻找对手」在面板正下方且与面板
 *   同宽、高 56、距 safe bottom ≥16，不贴整屏底边）。
 * 不再使用 57% 旧 split；两区中间留 12~16px。
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

/** 顶栏高（≤42 逻辑 px，只信息） */
export const GARAGE_TOP_BAR_H = 34;
/** 主 CTA 高（56~60 规格内） */
export const GARAGE_CTA_H = 56;
/** CTA 距 safe bottom 最小间隙（禁止贴整屏底边） */
export const GARAGE_CTA_BOTTOM_GAP = 16;
/** F-WX-UI-2A：左侧车辆展示区占可用宽比例（约 48%~52% 目标区间上沿，保证 core 占比不缩水） */
export const VEHICLE_RATIO = 0.52;
/** F-WX-UI-2A：右侧装配面板占可用宽比例（约 40%~44%） */
export const PANEL_RATIO = 0.42;
/** F-WX-UI-2A：车辆区与面板区中间间隙（12~16px） */
export const GARAGE_MID_GAP = 14;

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

  // F-WX-UI-2A：52% / 42% / gap14 三段分配，剩余分给左右两侧留白（不再 57% 旧 split）
  const vehicleW = Math.floor(usableW * VEHICLE_RATIO);
  const panelW = Math.max(200, Math.floor(usableW * PANEL_RATIO));
  const sidePad = Math.max(10, Math.floor((usableW - vehicleW - panelW - GARAGE_MID_GAP) / 2));
  const showX = uL + sidePad;
  const panelX = showX + vehicleW + GARAGE_MID_GAP;
  const panelR = panelX + panelW;

  // 顶栏（薄栏，只信息；与左右区域对齐）
  const topBarRect: Rect = {
    x: showX,
    y: uT,
    w: Math.max(200, panelR - showX),
    h: GARAGE_TOP_BAR_H,
  };

  // F-META-UX1：已删除 Main Shell 导航行（navRect/GARAGE_NAV_H）——Garage 回归唯一 Home，
  // 背包/更多改为装配区内次级入口，Backpack/More 顶部「← 返回车库」。内容区直接在顶栏下方。

  // CTA（右侧面板正下方，与面板同宽；不贴整屏底边）
  const ctaY = h - uB - GARAGE_CTA_BOTTOM_GAP - GARAGE_CTA_H;
  const ctaRect: Rect = { x: panelX, y: ctaY, w: panelW, h: GARAGE_CTA_H };

  // 面板（右侧中央；底部到 CTA 上方 14px，与 CTA 形成完整操作组）
  const bodyTop = uT + GARAGE_TOP_BAR_H + 8;
  const panelBot = ctaY - 14;
  const panelRect: Rect = {
    x: panelX,
    y: bodyTop,
    w: panelW,
    h: Math.max(120, panelBot - bodyTop),
  };

  // 车辆展示区（左侧，占主要空间；底部独立使用 safe bottom，不随右侧 CTA 变化）
  const vehBot = h - uB - 16;
  const vehicleRect: Rect = {
    x: showX,
    y: bodyTop,
    w: vehicleW,
    h: Math.max(120, vehBot - bodyTop),
  };

  // F-META-1：中央功能内容区（backpack/more 页；跨车辆区+面板区整宽）
  const contentRect: Rect = {
    x: showX,
    y: bodyTop,
    w: Math.max(200, panelR - showX),
    h: Math.max(120, vehBot - bodyTop),
  };

  return { topBarRect, contentRect, vehicleRect, panelRect, ctaRect };
}
