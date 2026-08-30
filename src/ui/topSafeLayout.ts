import type { SafeInsets } from '../platform/types';
import type { LayoutProfile } from './layoutProfile';

/**
 * F-WX-SAFE-AREA-P0｜统一微信横屏顶部三区契约（唯一来源：现有 safeInsets，logical px）。
 *
 * 背景：各页面（Home/Garage/Matching/Battle）各自散算顶部元素，缺少统一「顶部安全区域」抽象。
 * 本模块把「微信横屏顶部」收敛为三个互不重叠的可用区域，全部由现有
 * WechatViewport.safeInsets()（wx safeArea + 胶囊折叠，logical px）派生——
 * 不新增第二套 viewport 转换、不改 Canvas backing / DPR / Renderer 相机。
 *
 * 三区（logical px）：
 * - left   左侧信息区：x = insets.left，y = insets.top（头像/货币/返回/Battle 左 HUD 锚点）；
 * - center 中央状态区：水平真居中（x = W/2）——左右 insets 不对称时中心不偏移；
 * - right  右侧信息区：右缘 = W - insets.right（含原生胶囊 +6 避让：UI 不得进入胶囊区）。
 *
 * 另提供：
 * - topRowH：统一顶部信息行高（normal 42 / short 32，与 computeHomeLayout 同源）——
 *   所有页面顶部信息行 ≤ 此值，badge 锚点置于其下方即天然避开全部顶部信息；
 * - badge：RC 版号低干扰锚点（左上角、顶部信息行之下 4px）——不覆盖头像/货币/返回/HP/
 *   Matching·Locked 状态；仅在 RC 构建（build:wechat:rc）注入，正式包布局零改动。
 *
 * 使用约定：页面布局源（computeHomeLayout 等）继续作为其唯一布局源（已正确消费 insets）；
 * 本契约用于统一锚点/断言/新增顶部元素时的一致性来源。
 */
export interface TopSafeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TopSafeAreas {
  /** 统一顶部信息行高（logical px；normal 42 / short 32） */
  topRowH: number;
  /** 左侧信息区（头像/货币/返回/左 HUD 锚点）：x=insL，y=insT */
  left: TopSafeRect;
  /** 中央状态区：x=W/2 为水平中心锚（左右 insets 不对称时仍真居中） */
  center: TopSafeRect;
  /** 右侧信息区（宝箱/能量/右 HUD 锚点）：右缘 = W-insR（含胶囊+6） */
  right: TopSafeRect;
  /** RC badge 低干扰锚点（左上角、顶部信息行之下 4 logical px） */
  badge: { x: number; y: number };
}

export function computeTopSafeAreas(
  viewport: { w: number; h: number },
  insets: SafeInsets,
  profile: LayoutProfile,
): TopSafeAreas {
  const W = viewport.w;
  const short = profile.mode === 'mobile-short';
  const topRowH = short ? 32 : 42; // 与 computeHomeLayout topRowH 同源
  const x0 = insets.left;
  const x1 = Math.max(x0 + 1, W - insets.right);
  const y0 = insets.top;
  const usableW = Math.max(1, x1 - x0);
  const sideW = Math.max(1, usableW * 0.32); // 左右区各 32% 可用宽 → 中央留 ≥36%（互不重叠）
  const left: TopSafeRect = { x: x0, y: y0, w: sideW, h: topRowH };
  const center: TopSafeRect = { x: W / 2, y: y0, w: 0, h: topRowH }; // 中心锚（宽 0，以 x 为水平中心）
  const right: TopSafeRect = { x: x1 - sideW, y: y0, w: sideW, h: topRowH };
  const badge = { x: x0 + 6, y: y0 + topRowH + 4 };
  return { topRowH, left, center, right, badge };
}
