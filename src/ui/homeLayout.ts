import type { LayoutProfile } from './layoutProfile';
import type { SafeInsets } from '../platform/types';

/**
 * F-HOME-IA-R1｜正式小游戏首页布局（唯一布局源）——场景式信息架构重做。
 *
 * 模块（不新增、不删减）：个人信息（左上）+ 宝箱栏 4 槽（右上）+ 当前战车展示（中央
 * 主体 stageRect，renderer previewSolo fit 到 vehicleFramingRect）+ 寻找对手主按钮
 * （底部中央主按钮）+ 车库（左下）/ 排行榜·战令（右下）——同处一条底部主条。
 *
 * 视觉层级（F-HOME-P0-LAYER 已定，本队列不改）：
 * 背景（renderer.drawHomeBackdrop 程序化 underlay，单一入口，绘制于车辆之下）< 车辆 < UI 控件。
 *
 * 空间关系（本队列重做）——单底部条结构：
 * - 第一视觉 = 当前完整战车（stageRect 从顶部行下缘直达【底部主条上缘】，占据中央主体
 *   全部竖向空间；vehicleFramingRect = stageRect 上部留净空，CTA/辅助入口在底部条、不压车）；
 * - 第一交互 = 寻找对手（底部主条中央主按钮 ctaRect，中等宽、居中、不横贯整屏）；
 * - 宝箱 = 第二层（顶部右上 4 槽）；
 * - 车库 / 排行榜 / 战令 = 第三层（底部主条左右紧凑入口，与主按钮同条）。
 *
 * 为什么是单底部条（而非「CTA 之上再叠辅助底栏」）：
 * 矮屏（如 360×180，逻辑高仅 180）若把 CTA 与辅助入口拆成两条横栏，叠加顶部行后中央
 * 车辆取景区被压到 ~20px；renderer 的 MIN_CONTENT_SCALE 钳制会让完整车辆溢出取景区。
 * 改为「车库 | 寻找对手 | 排行榜 | 战令」单条浮于场景底部后，stage 获得完整竖向空间
 * （360×180 取景区 ~20px → ~64px），满足「第一视觉 = 完整战车」且不在 360×180 溢出。
 *
 * 规则：
 * - 所有 rect 必须完全处于 safe area（x ≥ insets.left 等，无例外）；
 * - 尺寸一律由 availableW / availableH 反推（禁止固定下限强撑）；
 * - short（logicalH<260）更紧凑：topRow 32 / 底部主条 44 / 辅助入口 36；normal：42 / 50 / 42；
 * - 寻找对手 CTA 仍全页最高/最显眼（= 主条高 44/50 > 辅助入口 36/42），但不横贯整屏；
 * - 车辆取景区（vehicleFramingRect）= stageRect 顶部 → 底部主条上缘（留 gap 净空，避免压 CTA）；
 *   完整车辆 envelope 进入 stageRect 且不被 CTA 裁切（getPreviewFramingRect 同源）。
 */
export interface HomeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface HomeLayout {
  /** 个人信息（左上：头像 + 段位；不含金币） */
  profileRect: HomeRect;
  /** 中央主体场景区（背景 + 车辆展示；CTA/辅助入口在底部主条，不进入此区） */
  stageRect: HomeRect;
  /** 车辆取景子区（stageRect 上部，底部主条之上；renderer previewSolo fit 到此） */
  vehicleFramingRect: HomeRect;
  /** 寻找对手主按钮（底部主条中央，中等宽） */
  ctaRect: HomeRect;
  /** 车库入口（底部主条左，紧凑图标 + 短标签） */
  garageRect: HomeRect;
  /** 排行榜入口（底部主条右，紧凑图标 + 短标签） */
  rankRect: HomeRect;
  /** 战令入口（底部主条最右，紧凑图标 + 短标签，位于 rank 右侧） */
  passRect: HomeRect;
  /** 宝箱栏 4 槽（右上；i ∈ 0..3） */
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
  const gap = short ? 6 : 10;

  // 顶部行：个人信息（左）+ 宝箱 4 槽（右）——互不重叠（左段 < 右段预留）
  const topRowH = short ? 32 : 42;
  const topY = insets.top;

  // 底部主条（车库 | 寻找对手 CTA | 排行榜 | 战令 同处一条，浮于场景底部）：
  // 给中央 stage 最大竖向空间——stage 从顶部行下缘直达底部主条上缘，车辆取景区不再被
  // 拆成「CTA 栏 + 辅助栏」两段挤压（矮屏 360×180 取景区由 ~20px → ~64px）。
  const bandH = short ? 44 : 50; // 底部主条高度 = CTA 高度（主按钮最显眼）
  const bandY = H - insets.bottom - bandH; // 底部主条顶缘
  const entryH = bandH - 8; // 辅助入口略矮于 CTA（视觉主次；仍满足触控目标）

  // 中央主体舞台：顶部行之下 → 底部主条之上（车辆完整占据）
  const stageTop = topY + topRowH + gap;
  const stageRect: HomeRect = {
    x: x0,
    y: stageTop,
    w: x1 - x0,
    h: Math.max(1, bandY - stageTop),
  };

  // 车辆取景子区：stage 顶部 → 底部主条上缘（留 gap 净空，车辆落在取景区底缘着地，不压 CTA）
  const vehicleFramingRect: HomeRect = {
    x: stageRect.x,
    y: stageRect.y,
    w: stageRect.w,
    h: Math.max(1, bandY - stageRect.y - gap),
  };

  // 个人信息（左上）
  const profileW = short ? 120 : 150;
  const profileRect: HomeRect = { x: x0, y: topY, w: profileW, h: topRowH };

  // 宝箱 4 槽（右上）
  const chestW = short ? 30 : 40;
  const chestGap = short ? 6 : 8;
  const chestH = Math.max(1, topRowH - 6);
  const chestX0 = x1 - 4 * chestW - 3 * chestGap;

  // 底部主条内布局：[garage][gap][CTA][gap][rank][gap][pass]
  // CTA 居中于「车库右缘 ↔ 排行榜左缘」的中央留白区，左右等距（不与辅助入口重叠、不横贯整屏）；
  // 辅助入口在两侧，互不重叠。
  const entryW = short ? 60 : 76;
  const ctaMaxW = short ? 200 : 300; // 主按钮中等宽（不横贯整屏）
  const sideL = x0 + entryW; // 车库右缘
  const sideR = x1 - 2 * entryW - gap; // 排行榜左缘（rank + pass 占最右 2*entryW + gap）
  const sideRegion = Math.max(2, sideR - sideL - 2 * gap);
  const ctaW = Math.min(ctaMaxW, sideRegion);
  const ctaX = sideL + gap + (sideRegion - ctaW) / 2; // 左右等距居中
  const ctaRect: HomeRect = { x: ctaX, y: bandY, w: ctaW, h: bandH };

  // 辅助入口（底部主条，图标 + 短标签；入口略矮、垂直居中于主条）
  const entryY = bandY + (bandH - entryH) / 2;
  const garageRect: HomeRect = { x: x0, y: entryY, w: entryW, h: entryH };
  const passRect: HomeRect = { x: x1 - entryW, y: entryY, w: entryW, h: entryH };
  const rankRect: HomeRect = { x: passRect.x - gap - entryW, y: entryY, w: entryW, h: entryH };

  return {
    profileRect,
    stageRect,
    vehicleFramingRect,
    ctaRect,
    garageRect,
    rankRect,
    passRect,
    chestSlot: (i: number): HomeRect => {
      const x = chestX0 + i * (chestW + chestGap);
      return { x, y: topY + (topRowH - chestH) / 2, w: chestW, h: chestH };
    },
  };
}
