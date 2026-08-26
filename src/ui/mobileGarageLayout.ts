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
  /** F-META-1：Main Shell 中央功能内容区（backpack/more 页用；garage 页用 vehicle/panel） */
  contentRect: Rect;
  vehicleRect: Rect;
  panelRect: Rect;
}

/** 顶栏高（normal；只信息） */
export const GARAGE_TOP_BAR_H = 34;
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

  // 纵向：TopBar / 内容区全部由 availableH 反推（short 更薄、间隙更小）
  const topBarH = short ? 24 : GARAGE_TOP_BAR_H;
  const bodyGap = short ? 6 : 8;
  const vehBottomGap = short ? 8 : 16;

  // 顶栏（薄栏，只信息；与左右区域对齐）
  const topBarRect: Rect = {
    x: showX,
    y: uT,
    w: Math.max(60, panelR - showX),
    h: topBarH,
  };

  // F-META-UX1：已删除 Main Shell 导航行——Garage 回归唯一 Home，内容区直接在顶栏下方。
  // F-GARAGE-MOBILE-SHELL-R1：Garage 已无「寻找对手」CTA——原 ctaRect（面板下方 56+14 高）
  // 空间整体并入右侧面板与中央内容区（消灭「下半部大块空白」），左右区底统一到 vehicle 底。

  // 面板与车辆区（右侧中央/左侧展示；底部统一，高由 available 反推，不再 max(120)）
  const bodyTop = uT + topBarH + bodyGap;
  const vehBot = h - uB - vehBottomGap;
  const panelRect: Rect = {
    x: panelX,
    y: bodyTop,
    w: panelW,
    h: Math.max(1, vehBot - bodyTop),
  };

  // 车辆展示区（左侧；底部独立 safe bottom；高反推）
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

  return { topBarRect, contentRect, vehicleRect, panelRect };
}

/**
 * F-GARAGE-MOBILE-SHELL-R1：保守文字宽度估算（与真实 fillText 取上界）。
 * - 全角/CJK（含 ‹ › 等符号）≈ 1em；
 * - ASCII/数字 ≈ 0.6em；
 * - 空格 ≈ 0.3em。
 * 布局与测试共用同一函数——「文字不进入相邻按钮」判定严格成立（真实绘制 ≤ 估算上界）。
 */
export function estimateTextWidth(text: string, fontSize: number): number {
  let w = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === ' ') w += fontSize * 0.3;
    else if (code >= 0x2e80 && code <= 0x9fff) w += fontSize; // CJK 全角
    else if (code >= 0xff00 && code <= 0xffef) w += fontSize; // 全角符号
    else if (code >= 0x2000 && code <= 0x206f) w += fontSize * 0.6; // 通用标点
    else w += fontSize * 0.6;
  }
  return w;
}

/** 顶栏文字内容（由调用方提供实际渲染文案；布局按估算宽度分配空间） */
export interface GarageTopBarTexts {
  back: string; // 「‹ 首页」
  coin: string; // 「金币 150」
  rating: string; // 「段位 青铜 212」（完整）
  ratingShort: string; // 「青铜 212」（去前缀降级）
  ratingTier: string; // 「青铜」（最少降级）
  energyLabel: string; // 「能量」
  energyValue: string; // 「75/90」
  backpack: string; // 「背包」
  more: string; // 「更多」
}

/** 顶栏每一组独立 rect 契约（F-GARAGE-MOBILE-SHELL-R1 Must#1）：
 *  back / coin / rating / energyGroup(label+bar+value) / backpack / more 各占独立矩形，
 *  组间无重叠；能量数值 rect 右缘 ≤ energyGroup 右缘 < backpack 左缘（数值永不侵入背包）。
 *  null = 该组因空间不足按优先级降级隐藏（garage 保留 back+energy+backpack；
 *  coin/rating 可缩写；more 最后舍弃）。 */
export interface GarageTopBarLayout {
  back: Rect | null;
  coin: Rect | null;
  rating: Rect | null;
  /** 最终应渲染的段位文案（完整 / 去前缀 / 仅段位名）——与 rating rect 宽度同源 */
  ratingRender: string;
  energyGroup: Rect;
  energyLabel: Rect;
  energyBar: Rect;
  energyValue: Rect;
  backpack: Rect | null;
  more: Rect | null;
}

/**
 * F-GARAGE-MOBILE-SHELL-R1：顶栏独立 rect 契约（唯一几何来源，绘制/HitArea/测试同源）。
 *
 * 布局规则（garage 模式）：
 * - 最左「‹ 首页」（必留）；
 * - 最右「背包」（必留）→「更多」（空间足够才保留）；
 * - 能量组（标签+条+数值）紧跟右侧组左侧，数值矩形在组内右对齐（不向右溢出）；
 * - 中间剩余空间给「金币」「段位」，按优先级降级：
 *   段位去前缀（青铜 212）→ 隐藏金币 → 段位只留段位名 → 隐藏段位。
 * - shell 模式（backpack/more 页）：无 back/backpack/more，仅 金币/段位/能量（空间宽裕）。
 *
 * 空间不足判定全部基于 estimateTextWidth 上界，保证「文字不进入相邻按钮」成立。
 */
export function computeGarageTopBarLayout(
  topBarRect: Rect,
  profile: LayoutProfile,
  opts: { mode: 'garage' | 'shell' },
  texts: GarageTopBarTexts,
): GarageTopBarLayout {
  const short = profile.mode === 'mobile-short';
  const fs = 14 * profile.fontScale; // 顶栏信息字号（text() 内统一 fontScale，逻辑 px 宽度）
  const { x: x0, y, w: W, h } = topBarRect;
  const tinyW = short ? 44 : 56;
  const tinyH = short ? 18 : 22;
  const gap = short ? 3 : 4;
  const groupGap = short ? 3 : 4;
  const barMin = short ? 36 : 56;
  const barMax = short ? 56 : 96;

  // —— 最左：返回首页（garage 必留） ——
  const back: Rect | null =
    opts.mode === 'garage'
      ? { x: x0, y: y + (h - tinyH) / 2, w: tinyW, h: tinyH }
      : null;
  const leftX = x0 + (back ? back.w + (short ? 6 : 8) : 0);

  // —— 最右：背包（garage 必留） ——
  const backpack: Rect | null =
    opts.mode === 'garage'
      ? { x: x0 + W - tinyW, y: y + (h - tinyH) / 2, w: tinyW, h: tinyH }
      : null;
  let cursor = backpack ? backpack.x - gap : x0 + W;

  // —— 更多（候选；带 more 时能量组仍有最小宽度才保留） ——
  const eLabelW = estimateTextWidth(texts.energyLabel, fs);
  const eValueW = estimateTextWidth(texts.energyValue, fs);
  const energyMin = eLabelW + groupGap + barMin + groupGap + eValueW;
  let more: Rect | null = null;
  if (opts.mode === 'garage') {
    const moreX = cursor - gap - tinyW;
    // 带 more 后：能量组最小宽 + 左侧至少一个段位缩写，仍放得下才保留 more
    const leftMin = leftX + estimateTextWidth(texts.ratingShort, fs);
    if (moreX - gap - energyMin >= leftMin) {
      more = { x: moreX, y: y + (h - tinyH) / 2, w: tinyW, h: tinyH };
      cursor = more.x - gap;
    }
  }

  // —— 能量组（bar 宽在 [barMin, barMax] 收缩；数值矩形在组内右对齐） ——
  const energyRight = cursor - groupGap;
  const barW = Math.min(barMax, Math.max(barMin, energyRight - eLabelW - groupGap - eValueW - leftX));
  const groupW = eLabelW + groupGap + barW + groupGap + eValueW;
  const groupX = Math.max(leftX, energyRight - groupW);
  const barY = y + (h - 10) / 2;
  const energyGroup: Rect = { x: groupX, y, w: groupW, h };
  const energyLabel: Rect = { x: groupX, y, w: eLabelW, h };
  const energyBar: Rect = { x: groupX + eLabelW + groupGap, y: barY, w: barW, h: 10 };
  const energyValue: Rect = {
    x: groupX + eLabelW + groupGap + barW + groupGap,
    y,
    w: eValueW,
    h,
  };

  // —— 中间：金币 + 段位（按优先级降级） ——
  const afterInfo = groupX - (short ? 4 : 6); // 信息区右界（与能量组留间隙）
  const coinW = estimateTextWidth(texts.coin, fs);
  const ratingFullW = estimateTextWidth(texts.rating, fs);
  const ratingShortW = estimateTextWidth(texts.ratingShort, fs);
  const ratingTierW = estimateTextWidth(texts.ratingTier, fs);
  let coin: Rect | null = null;
  let rating: Rect | null = null;
  let ratingRender = texts.rating;
  let ix = leftX;
  if (ix + coinW + gap + ratingFullW <= afterInfo) {
    coin = { x: ix, y, w: coinW, h };
    ix += coinW + gap;
    rating = { x: ix, y, w: ratingFullW, h };
    ratingRender = texts.rating;
  } else if (ix + coinW + gap + ratingShortW <= afterInfo) {
    coin = { x: ix, y, w: coinW, h };
    ix += coinW + gap;
    rating = { x: ix, y, w: ratingShortW, h };
    ratingRender = texts.ratingShort;
  } else if (ix + ratingShortW <= afterInfo) {
    rating = { x: ix, y, w: ratingShortW, h };
    ratingRender = texts.ratingShort;
  } else if (ix + ratingTierW <= afterInfo) {
    rating = { x: ix, y, w: ratingTierW, h };
    ratingRender = texts.ratingTier;
  }
  return { back, coin, rating, ratingRender, energyGroup, energyLabel, energyBar, energyValue, backpack, more };
}
