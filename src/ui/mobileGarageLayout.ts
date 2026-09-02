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
  /** F-META-1：Main Shell 中央功能内容区（backpack/more 页用；garage 页用 stageRect） */
  contentRect: Rect;
  /** F-GARAGE-CENTER-STAGE-P0：中央战车舞台（全宽；顶栏下至装配带上）。车辆取景同源。 */
  stageRect: Rect;
  /** F-GARAGE-CENTER-STAGE-P0：车辆取景区 == stageRect（唯一布局源；绘制/取景/HitArea 同源） */
  vehicleRect: Rect;
  /** F-GARAGE-CENTER-STAGE-P0：底部横向装配带（第一行分类 tab + 第二行部件卡带） */
  stripRect: Rect;
}

/** 顶栏高（normal；只信息） */
export const GARAGE_TOP_BAR_H = 34;
/** F-GARAGE-CENTER-STAGE-P0 / F-GARAGE-VISUAL-DENSITY-R2：底部装配带高占屏幕高比例（Must#3：30%~34%） */
export const STRIP_HEIGHT_RATIO = 0.30;

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
  const usableH = Math.max(40, h - uT - uB);

  // 纵向：顶栏 / 中央舞台 / 底部装配带（F-GARAGE-CENTER-STAGE-P0）
  const topBarH = short ? 24 : GARAGE_TOP_BAR_H;
  const bodyGap = short ? 6 : 8;

  // 顶栏（全宽薄栏；garage 模式只 back + 能量；shell 模式保留 金币/段位/能量）
  const topBarRect: Rect = {
    x: uL,
    y: uT,
    w: Math.max(60, usableW),
    h: topBarH,
  };

  // F-GARAGE-CENTER-STAGE-P0：底部横向装配带——高 = 屏幕高 27%~34%（取 32%）。
  // 第一行分类 tab（车身/移动/战斗）、第二行部件卡带；能量变化/失败原因嵌入带内。
  // 向上取整：保证 stripH 始终 ≥ 屏幕高 30%（Must#3 下限，避免 小数舍入跌到 29.9%）
  const stripH = Math.max(44, Math.ceil(h * STRIP_HEIGHT_RATIO));
  const stripRect: Rect = {
    x: uL,
    y: Math.max(uT + topBarH + bodyGap, h - uB - stripH),
    w: Math.max(60, usableW),
    h: stripH,
  };

  // F-GARAGE-CENTER-STAGE-P0：中央战车舞台（顶栏下至装配带上）——车辆取景同源。
  // F-WX-SAFE-AREA-R1：舞台水平居中于屏幕主轴 W/2（右侧原生胶囊保留不再把车辆推向左侧）；
  // 宽度 = min(可用宽, 左右半区各 2 倍)（可居中且不越 safeArea 左右边界）；装配带/顶栏不受影响。
  const bodyTop = uT + topBarH + bodyGap;
  const stageW = Math.max(60, Math.min(usableW, 2 * (w / 2 - uL), 2 * (w - uR - w / 2)));
  const stageX = Math.round(w / 2 - stageW / 2);
  const stageRect: Rect = {
    x: stageX,
    y: bodyTop,
    w: stageW,
    h: Math.max(1, stripRect.y - bodyTop),
  };

  // 车辆取景区 == 中央舞台（Garage previewSolo fit 到该区域 → 车辆最终像素居中）
  const vehicleRect: Rect = { ...stageRect };

  // F-META-1：中央功能内容区（backpack/more 页；全宽，顶栏下到底部 safe bottom）
  const contentRect: Rect = {
    x: uL,
    y: bodyTop,
    w: Math.max(60, usableW),
    h: Math.max(1, usableH - topBarH - bodyGap),
  };

  return { topBarRect, contentRect, stageRect, vehicleRect, stripRect };
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

  // F-GARAGE-CENTER-STAGE-P0：garage 模式顶栏极简——左「‹ 首页」+ 右「能量 used/cap」。
  // 金币/段位/背包/更多不再出现在装配页（数据与其他页入口保留，只是不在 Garage 展示）。
  if (opts.mode === 'garage') {
    const back: Rect = { x: x0, y: y + (h - tinyH) / 2, w: tinyW, h: tinyH };
    // F-GARAGE-INVENTORY-FUSION-P0：Garage 顶栏「背包」入口（back 右侧、energy 左侧；
    // 不遮挡 back/energy/完成并再战/原生胶囊/安全区）。
    const bpW = short ? 44 : 56;
    const bpGap = short ? 4 : 6;
    const backpack: Rect = { x: back.x + back.w + bpGap, y: y + (h - tinyH) / 2, w: bpW, h: tinyH };
    const eLabelW = estimateTextWidth(texts.energyLabel, fs);
    const eValueW = estimateTextWidth(texts.energyValue, fs);
    const energyRight = x0 + W - (short ? 4 : 8); // 右端留白
    const leftX = backpack.x + bpW + bpGap; // 能量组从 backpack 右侧起排
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
    return { back, coin: null, rating: null, ratingRender: texts.rating, energyGroup, energyLabel, energyBar, energyValue, backpack, more: null };
  }

  // —— shell 模式（backpack/more 页）：无 back/backpack/more，仅 金币/段位/能量 ——
  const back: Rect | null = null;
  const backpack: Rect | null = null;
  const more: Rect | null = null;
  const leftX = x0;
  const eLabelW = estimateTextWidth(texts.energyLabel, fs);
  const eValueW = estimateTextWidth(texts.energyValue, fs);
  const cursor = x0 + W; // 能量组从右端排
  const energyRight = cursor - (short ? 4 : 8);
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
