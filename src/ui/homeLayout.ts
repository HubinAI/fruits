import type { LayoutProfile } from './layoutProfile';
import type { SafeInsets } from '../platform/types';

/**
 * F-HOME-1｜正式小游戏首页布局（唯一布局源）。
 *
 * 只保留核心模块：个人信息（顶部左）+ 宝箱栏 4 槽（顶部右）+ 当前车辆展示（中上）
 * + 寻找对手主按钮（中部，全页最强视觉）+ 车库/排行榜/战令三个辅助入口（底部）。
 * 背景（drawHomeBackground）与车辆（renderer previewSolo fit 到 vehicleRect）不含在本布局内。
 *
 * 规则：
 * - 所有 rect 必须完全处于 safe area（x ≥ insets.left 等，无例外）；
 * - 尺寸一律由 availableW / availableH 反推（禁止固定下限强撑）；
 * - short（logicalH<260）更紧凑：topBar 30 / cta 48 / assist 36；normal：44 / 52 / 44；
 * - 寻找对手 CTA 始终是全页最高按钮（short 48 > assist 36；normal 52 > 44）——最显眼焦点；
 * - 车辆区高度 = 剩余可用高（中上展示重点，尽量大）。
 */
export interface HomeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface HomeLayout {
  topBarRect: HomeRect;
  vehicleRect: HomeRect;
  ctaRect: HomeRect;
  assistRect: HomeRect;
  /** 宝箱栏 4 槽（顶部右侧；i ∈ 0..3） */
  chestSlot: (i: number) => HomeRect;
}

export function computeHomeLayout(
  viewport: { w: number; h: number },
  insets: SafeInsets,
  profile: LayoutProfile,
): HomeLayout {
  const W = viewport.w;
  const H = viewport.h;
  const short = profile.mode === 'mobile-short';
  const x0 = insets.left;
  const x1 = Math.max(x0 + 1, W - insets.right);
  const topBarH = short ? 30 : 44;
  const gap = short ? 6 : 10;
  const ctaH = short ? 48 : 52; // F-HOME-2：寻找对手主按钮全页最高（short 48 > assist 36）
  const assistH = short ? 36 : 44;
  const topBarY = insets.top;
  const vehicleY = topBarY + topBarH + gap;
  // 车辆区 = 顶栏与 CTA 之间剩余可用高（反推，不设固定下限）
  const vehicleH = Math.max(1, H - insets.bottom - vehicleY - ctaH - gap - assistH - gap);
  const ctaY = vehicleY + vehicleH + gap;
  const assistY = ctaY + ctaH + gap;
  const chestW = short ? 32 : 44; // F-HOME-4：宝箱槽位更大（正式入口感）
  const chestGap = short ? 6 : 10;
  const chestH = Math.max(1, topBarH - 6);
  const chestX0 = x1 - 4 * chestW - 3 * chestGap;
  return {
    topBarRect: { x: x0, y: topBarY, w: x1 - x0, h: topBarH },
    vehicleRect: { x: x0, y: vehicleY, w: x1 - x0, h: vehicleH },
    ctaRect: { x: x0, y: ctaY, w: x1 - x0, h: ctaH },
    assistRect: { x: x0, y: assistY, w: x1 - x0, h: assistH },
    chestSlot: (i: number): HomeRect => {
      const x = chestX0 + i * (chestW + chestGap);
      return { x, y: topBarY + 3, w: chestW, h: chestH };
    },
  };
}
