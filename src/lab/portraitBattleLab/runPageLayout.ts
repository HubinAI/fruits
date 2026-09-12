/**
 * PRP-F0-RUN-PAGE-SHELL｜PRP-R3-CAPYBARA-UI-HIERARCHY-REBUILD —— Run Page 纯几何层
 *（无 DOM / 无 Canvas / 无 registry / 无副作用）。
 *
 * 产品基线（本原型唯一要验证的东西）：
 *   整个单局 = **一个持续存在的竖屏 Adventure Run Page**；战斗 / 事件 / 强化 / 结果是
 *   同一个页面的不同状态，不存在页面跳转。
 *
 * PRP-R3 信息层级重构：**少状态、大战斗主体、可读冒险记录、重大选择独占焦点。**
 *
 *   ┌ y=0   ── RUN_TOP_BAND   ( 80)  顶部薄层：DAY 进度一行 + **实际已获得**的强化图标行  9.48%
 *   │ y=80  ── RUN_STAGE_BAND (302)  中部主体：侧视车辆舞台（真实车辆视觉，玩家左 / 敌人右）35.78%
 *   │ y=382 ── RUN_LOG_BAND   (378)  下部：自然语言的冒险记录（底部对齐、新行顶入）      44.79%
 *   └ y=760 ── RUN_ACTION_BAND( 84)  最底：唯一一个当前主动作按钮                        9.95%
 *                                    合计 80+302+378+84 = 844
 *
 * ⚠️ PRP-R3：比例取自 Queue「页面候选比例」（顶 70~80 / 台 280~310 / 志 ~370 / 作 80~90，
 *    并同时落在 8~10% / 33~36% / 40~45% / 8~10% 的百分比区间内），由 RP-01b 冻结。
 *
 * ⚠️ 面积账本 `runPaintedAreas` 只登记「**不承载文字、不被描边、不被 sprite 覆盖**的纯色
 *    平铺矩形」。PRP-R3 起车辆改用正式 sprite 绘制 → 车身 / 部件不再入账（sprite 像素不是
 *    纯色），改由浏览器端按「真实 sprite 特征色计数」验证。
 */

import { PORTRAIT_LOGICAL_H, PORTRAIT_LOGICAL_W } from './constants';

/** Run Page 逻辑舞台（= F0 竖屏基准，不引入第二套坐标）。 */
export const RUN_PAGE_W = PORTRAIT_LOGICAL_W;
export const RUN_PAGE_H = PORTRAIT_LOGICAL_H;

export interface RunRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/* ------------------------------------------------------------- 四条横带 */

/** 顶部薄层高度：只放 DAY 进度与已获得图标，禁止做大块状态面板（≈9.48%）。 */
export const RUN_TOP_BAND_H = 80;
/** 下部冒险记录区高度（自然语言叙事，≈44.79%）。 */
export const RUN_LOG_BAND_H = 378;
/** 最底动作区高度（只承载唯一一个主动作按钮，≈9.95%）。 */
export const RUN_ACTION_BAND_H = 84;
/** 中部舞台高度：由「总高 − 其余三带」反推 → 结构上不可能漏缝或重叠（≈35.78%）。 */
export const RUN_STAGE_BAND_H = RUN_PAGE_H - RUN_TOP_BAND_H - RUN_LOG_BAND_H - RUN_ACTION_BAND_H;

export const RUN_TOP_BAND: RunRect = { x: 0, y: 0, w: RUN_PAGE_W, h: RUN_TOP_BAND_H };
export const RUN_STAGE_BAND: RunRect = {
  x: 0,
  y: RUN_TOP_BAND.y + RUN_TOP_BAND.h,
  w: RUN_PAGE_W,
  h: RUN_STAGE_BAND_H,
};
export const RUN_LOG_BAND: RunRect = {
  x: 0,
  y: RUN_STAGE_BAND.y + RUN_STAGE_BAND.h,
  w: RUN_PAGE_W,
  h: RUN_LOG_BAND_H,
};
export const RUN_ACTION_BAND: RunRect = {
  x: 0,
  y: RUN_LOG_BAND.y + RUN_LOG_BAND.h,
  w: RUN_PAGE_W,
  h: RUN_ACTION_BAND_H,
};

/** 自上而下的绘制 / 布局顺序（数组顺序即 y 升序）。 */
export const RUN_BANDS: readonly RunRect[] = [
  RUN_TOP_BAND,
  RUN_STAGE_BAND,
  RUN_LOG_BAND,
  RUN_ACTION_BAND,
];

/* --------------------------------------- 顶部薄层：DAY 一行 + 已获得图标一行 */

/** 「DAY 3 / 7」文本的绘制锚点（左下角基线起点）。 */
export const RUN_DAY_LABEL_POS = { x: 16, y: 34 } as const;

/** 进度节点（一个小矩形 = 一天），右对齐。 */
export const RUN_DAY_NODE = { w: 16, h: 8, gap: 5, right: 16, y: 24 } as const;

/** 本局进度节点：共 `total` 个，右对齐。 */
export function runDayNodes(total: number): RunRect[] {
  const n = Math.max(0, Math.floor(total));
  if (n === 0) return [];
  const span = n * RUN_DAY_NODE.w + (n - 1) * RUN_DAY_NODE.gap;
  const x0 = RUN_PAGE_W - RUN_DAY_NODE.right - span;
  return Array.from({ length: n }, (_, i) => ({
    x: x0 + i * (RUN_DAY_NODE.w + RUN_DAY_NODE.gap),
    y: RUN_DAY_NODE.y,
    w: RUN_DAY_NODE.w,
    h: RUN_DAY_NODE.h,
  }));
}

/**
 * 已获得的核心强化图标。
 *
 * ⚠️ PRP-R3 必改 1：**不再有固定空槽 / 占位格子 / 「核心构建 X/5」计数**。
 * 传 0 就返回空数组 —— 画面上什么都没有（而不是五个空框）。
 */
export const RUN_BUFF_ICON_MAX = 5;
export const RUN_BUFF_ICON = { size: 30, gap: 8, x: 16, y: 44 } as const;
/** 已获得图标内部的高光小方块（与底色互斥的第二色 → 供像素级精确断言）。 */
export const RUN_BUFF_ICON_CHIP = { size: 12 } as const;

export function runBuffIconRects(count: number): RunRect[] {
  const n = Math.min(RUN_BUFF_ICON_MAX, Math.max(0, Math.floor(count)));
  return Array.from({ length: n }, (_, i) => ({
    x: RUN_BUFF_ICON.x + i * (RUN_BUFF_ICON.size + RUN_BUFF_ICON.gap),
    y: RUN_BUFF_ICON.y,
    w: RUN_BUFF_ICON.size,
    h: RUN_BUFF_ICON.size,
  }));
}

/** 已获得图标的高光方块（在图标内居中）。 */
export function runBuffIconChip(icon: RunRect): RunRect {
  const inset = Math.floor((icon.w - RUN_BUFF_ICON_CHIP.size) / 2);
  return {
    x: icon.x + inset,
    y: icon.y + inset,
    w: RUN_BUFF_ICON_CHIP.size,
    h: RUN_BUFF_ICON_CHIP.size,
  };
}

/* --------------------------------------------------- 中部：侧视战斗舞台 */

/**
 * 侧视舞台参数（PRP-R3 重新构图）。
 *
 * 三条硬约束：
 *   1) 玩家**固定**视觉起点在左、敌人**固定**视觉起点在右；
 *   2) 缩放只服务「两车都装得下」，不改任何战斗数据（正式几何原样，整体等比缩放）；
 *   3) 车辆底边落在**基线上**，基线之下是路面（禁止把地线压在舞台带最底边）。
 *
 * `maxScale` 只作上限（不放大到失真）：实测演示组合两车真实视觉外接框合计 461px，
 * 可用宽度 356px → 实际缩放 0.772（宽度驱动，上限不生效）。
 */
export const RUN_SIDE_VIEW = {
  /** 左右边距（逻辑 px）。 */
  marginPx: 10,
  /** 两车之间必须保留的最小中缝（逻辑 px）。 */
  gapPx: 14,
  /** 显示缩放上限（只缩不放）。 */
  maxScale: 0.9,
  /** 基线到舞台带底边的距离 = 路面高度（逻辑 px）。 */
  groundInsetPx: 52,
  /**
   * 车辆底边相对基线的抬升量（逻辑 px）。
   * 目的：车轮是圆形，切点上的抗锯齿像素会污染基线以下的路面 → 纯色面积断言失准。
   * 抬升 2px 后路面 / 地线是**未被覆盖的纯色矩形**，可被精确冻结（视觉上不可辨）。
   */
  baselineLiftPx: 2,
} as const;

/** 战斗演出时两车相向的最大位移（逻辑 px）——纯表现，不是物理。必须 < 中缝的一半。 */
export const RUN_SIDE_VIEW_CLOSING_PX = 6;

/** 侧视舞台基线 y（车辆底边贴这条线之上）。 */
export function runStageGroundY(): number {
  return RUN_STAGE_BAND.y + RUN_STAGE_BAND.h - RUN_SIDE_VIEW.groundInsetPx;
}

/** 车辆实际落点 y（基线 − 抬升量）。 */
export function runStageBaselineY(): number {
  return runStageGroundY() - RUN_SIDE_VIEW.baselineLiftPx;
}

/** 地线（纯色矩形，无人覆盖 → 入面积账本）。 */
export function runStageGroundRect(): RunRect {
  return { x: 0, y: runStageGroundY(), w: RUN_PAGE_W, h: RUN_SIDE_VIEW.baselineLiftPx };
}

/** 路面（纯色矩形，无人覆盖 → 入面积账本）。 */
export function runStageRoadRect(): RunRect {
  const g = runStageGroundRect();
  return {
    x: 0,
    y: g.y + g.h,
    w: RUN_PAGE_W,
    h: RUN_STAGE_BAND.y + RUN_STAGE_BAND.h - (g.y + g.h),
  };
}

/** 远景 / 近景山脊（确定性，无随机数）。 */
export interface RunHill {
  readonly x: number;
  readonly w: number;
  readonly h: number;
}

/**
 * 地平线暖端所占的**渐变厚度**（逻辑 px）：
 * 天空从 `stageSky` 渐到 `stageHaze`，最后在贴近地平线的这 118px 内过渡到暖端 `horizonGlow`。
 * 用渐变而不是「平涂 + 一条雾带」→ 上半带不会出现大片平铺空黑，也不会引入与战车争焦点的形状。
 */
export const RUN_STAGE_HAZE_H = 118;

/**
 * 地平线以上的两条山脊（**必须足够高**）。
 *
 * ⚠️ PRP-R3 必改 2：舞台带高 302px 而侧视战车只有 ~60px 高 —— 如果山脊只在地平线上冒个小头，
 * 中带就会出现「大片无意义空黑」，战车看起来像浮在空场里（正是本 Queue 要消灭的观感）。
 * 因此远山最高抬到地平线以上 ~138px，让**战车压在山脊线上**而不是浮在空场中央。
 * 山脊不属于任何入账层（纯装饰、且被 sprite / 车辆覆盖），抬高山脊**不改变任何账本面积**。
 */
export function runStageHills(): { readonly far: readonly RunHill[]; readonly near: readonly RunHill[] } {
  return {
    far: [
      { x: -30, w: 150, h: 84 },
      { x: 96, w: 132, h: 104 },
      { x: 208, w: 118, h: 74 },
      { x: 306, w: 120, h: 92 },
    ],
    near: [
      { x: 34, w: 120, h: 46 },
      { x: 176, w: 150, h: 58 },
      { x: 300, w: 110, h: 40 },
    ],
  };
}

/**
 * 显示缩放：按「两车视觉外接框宽度之和」推导，取上限封顶。
 * 结果只与几何有关、与状态无关 → 敌人在 EVENT / BATTLE 出现时**不会**导致玩家车体突然缩放。
 */
export function runSideViewScale(playerWidth: number, enemyWidth: number): number {
  const avail = RUN_PAGE_W - 2 * RUN_SIDE_VIEW.marginPx - RUN_SIDE_VIEW.gapPx;
  const need = Math.max(1, Math.max(0, playerWidth) + Math.max(0, enemyWidth));
  return Math.min(RUN_SIDE_VIEW.maxScale, avail / need);
}

/**
 * 一个实体的「可视件」——车身 / 轮组 / 部件，坐标相对**实体原点**（已含 facing 镜像）。
 * `visualId` 有值 = 用正式 sprite 绘制；轮组无 sprite → 用圆形（真实半径）绘制。
 */
export interface RunVisualBox {
  readonly cx: number;
  readonly cy: number;
  readonly w: number;
  readonly h: number;
  readonly kind: 'body' | 'wheel' | 'part';
  readonly visualId?: string;
  readonly defId?: string;
}

export interface RunVisualBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly w: number;
  readonly h: number;
}

/** 可视件并集（未缩放，相对实体原点）。 */
export function runVisualBounds(boxes: readonly RunVisualBox[]): RunVisualBounds {
  if (boxes.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0, w: 0, h: 0 };
  const minX = Math.min(...boxes.map((b) => b.cx - b.w / 2));
  const minY = Math.min(...boxes.map((b) => b.cy - b.h / 2));
  const maxX = Math.max(...boxes.map((b) => b.cx + b.w / 2));
  const maxY = Math.max(...boxes.map((b) => b.cy + b.h / 2));
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

/** 已摆到舞台上的可视件（rect 为最终绘制 / 命中矩形）。 */
export interface RunPlacedVisual {
  readonly rect: RunRect;
  readonly kind: 'body' | 'wheel' | 'part';
  readonly visualId?: string;
  readonly defId?: string;
  /** facing 为 -1 且视觉声明 mirrorWithFacing 时，sprite 需水平镜像。 */
  readonly mirror: boolean;
}

export interface RunPlacedGroup {
  readonly visuals: readonly RunPlacedVisual[];
  /** 全部可视件的精确并集（取整后）→ 供「玩家左 / 敌人右」判定使用。 */
  readonly bounds: RunRect;
}

/**
 * 把一个实体的可视件摆到侧视舞台上。
 *
 * 取整策略：缩放后再对「每条边的坐标」取整 → 矩形之间不会出现 1px 缝隙，
 * 且整组的最小 / 最大边**恰好**落在边距线上 —— 这是「玩家固定左 / 敌人固定右」的可断言形式。
 */
export function placeSideViewVisuals(
  boxes: readonly RunVisualBox[],
  side: 'left' | 'right',
  scale: number,
  baselineY: number,
  mirrors: readonly boolean[] = [],
): RunPlacedGroup {
  if (boxes.length === 0) return { visuals: [], bounds: { x: 0, y: 0, w: 0, h: 0 } };
  const s = (v: number): number => Math.round(v * scale);
  const edges = boxes.map((b) => ({
    x0: s(b.cx - b.w / 2),
    y0: s(b.cy - b.h / 2),
    x1: s(b.cx + b.w / 2),
    y1: s(b.cy + b.h / 2),
  }));
  const minX = Math.min(...edges.map((e) => e.x0));
  const maxX = Math.max(...edges.map((e) => e.x1));
  const maxY = Math.max(...edges.map((e) => e.y1));

  const tx =
    side === 'left'
      ? RUN_STAGE_BAND.x + RUN_SIDE_VIEW.marginPx - minX
      : RUN_STAGE_BAND.x + RUN_STAGE_BAND.w - RUN_SIDE_VIEW.marginPx - maxX;
  const ty = baselineY - maxY;

  const visuals: RunPlacedVisual[] = boxes.map((b, i) => ({
    rect: {
      x: edges[i].x0 + tx,
      y: edges[i].y0 + ty,
      w: Math.max(1, edges[i].x1 - edges[i].x0),
      h: Math.max(1, edges[i].y1 - edges[i].y0),
    },
    kind: b.kind,
    visualId: b.visualId,
    defId: b.defId,
    mirror: mirrors[i] ?? false,
  }));
  const bx0 = Math.min(...visuals.map((v) => v.rect.x));
  const by0 = Math.min(...visuals.map((v) => v.rect.y));
  const bx1 = Math.max(...visuals.map((v) => v.rect.x + v.rect.w));
  const by1 = Math.max(...visuals.map((v) => v.rect.y + v.rect.h));
  return { visuals, bounds: { x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0 } };
}

/** 整体水平平移（战斗演出用；不影响任何数值）。 */
export function translateRunRects(rects: readonly RunRect[], dx: number): RunRect[] {
  if (dx === 0) return [...rects];
  return rects.map((r) => ({ x: r.x + dx, y: r.y, w: r.w, h: r.h }));
}

/** 平移后的精确并集（与 translateRunRects 同源，避免二次推导）。 */
export function translateRunBounds(b: RunRect, dx: number): RunRect {
  return { x: b.x + dx, y: b.y, w: b.w, h: b.h };
}

/** 平移整组可视件（战斗演出）。 */
export function translateRunGroup(g: RunPlacedGroup, dx: number): RunPlacedGroup {
  if (dx === 0) return g;
  return {
    visuals: v(g.visuals),
    bounds: translateRunBounds(g.bounds, dx),
  };
  function v(list: readonly RunPlacedVisual[]): RunPlacedVisual[] {
    return list.map((it) => ({ ...it, rect: { x: it.rect.x + dx, y: it.rect.y, w: it.rect.w, h: it.rect.h } }));
  }
}

/** 两个矩形是否真实重叠（边贴边不算）。 */
export function runRectsOverlap(a: RunRect, b: RunRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/* -------------------------------------------------- 下部：冒险记录 */

/**
 * 冒险记录：**自然语言叙事**（PRP-R3 必改 3）。
 *
 * ⚠️ 这里只描述排版几何；文本内容与「无 [系统] 前缀」由 runPageState 负责。
 * 行**自上而下**排列（紧接区块标签）：新行在下方自然追加；
 * 超过 `maxLines` 时最早的行走出可视区 → 其余行整体上移（= 旧日志向上滚动并弱化）。
 */
export const RUN_LOG = {
  /** 区块标签锚点（相对日志带顶部）。 */
  labelOffsetY: 26,
  /** 第一条可见行的顶部（相对日志带顶部）。 */
  topOffsetY: 34,
  /** 行高（字号 15px → 真实手机尺寸可直接阅读）。 */
  lineH: 28,
  /** 可见行数上限（溢出的旧行向上滚出）。 */
  maxLines: 12,
  /** 末 N 行视为「最近事件」→ 全不透明；更早的行弱化。 */
  emphasis: 4,
  x: 18,
  right: 18,
} as const;

/** 日志区标签锚点（绝对坐标）。 */
export const RUN_LOG_LABEL_POS = { x: RUN_LOG.x, y: RUN_LOG_BAND.y + RUN_LOG.labelOffsetY } as const;

/**
 * 日志行矩形（自上而下，行位置不随内容条数抖动）。
 * 返回顺序 = 阅读顺序（index 0 = 最早可见行）。
 */
export function runLogLineRects(count: number = RUN_LOG.maxLines): RunRect[] {
  const n = Math.max(0, Math.floor(count));
  return Array.from({ length: n }, (_, i) => ({
    x: RUN_LOG.x,
    y: RUN_LOG_BAND.y + RUN_LOG.topOffsetY + i * RUN_LOG.lineH,
    w: RUN_PAGE_W - RUN_LOG.x - RUN_LOG.right,
    h: RUN_LOG.lineH,
  }));
}

/** 日志区第一条可见行的顶边（越界检测用）。 */
export function runLogTopY(count: number = RUN_LOG.maxLines): number {
  const rects = runLogLineRects(count);
  return rects.length === 0 ? RUN_LOG_BAND.y + RUN_LOG.labelOffsetY : rects[0].y;
}

/** 日志区最后一行底边（必须不越过动作区上沿 → 由测试守卫）。 */
export function runLogBottomY(count: number = RUN_LOG.maxLines): number {
  const rects = runLogLineRects(count);
  return rects.length === 0
    ? RUN_LOG_BAND.y + RUN_LOG.labelOffsetY
    : rects[rects.length - 1].y + rects[rects.length - 1].h;
}

/* ------------------------------------------------------- 最底：主动作按钮 */

/** 主动作按钮：整条动作带内**唯一**的可点击目标（≈10% 页高，触控友好）。 */
export function runActionButtonRect(): RunRect {
  const h = 54;
  return {
    x: 24,
    y: RUN_ACTION_BAND.y + Math.round((RUN_ACTION_BAND.h - h) / 2),
    w: RUN_PAGE_W - 48,
    h,
  };
}

/**
 * 主动作按钮底部的纯色强调块。
 *
 * 为什么需要它：按钮上要写文案、要描边，两者都会吃掉「净色像素」，
 * 使按钮整体的精确面积无法断言。这条**不承载文字、不被描边覆盖**的纯色块，
 * 让「按钮存在 / 可用态切换」有可精确断言的像素证据。
 */
export const RUN_ACTION_BAR = { insetX: 6, h: 3, bottomInset: 10 } as const;

export function runActionBarRect(): RunRect {
  const btn = runActionButtonRect();
  return {
    x: btn.x + RUN_ACTION_BAR.insetX,
    y: btn.y + btn.h - RUN_ACTION_BAR.bottomInset,
    w: btn.w - 2 * RUN_ACTION_BAR.insetX,
    h: RUN_ACTION_BAR.h,
  };
}

/* ------------------------------------------------------- CHOICE：三选一浮层 */

/**
 * PRP-R3 必改 4：卡片只显示「图标 + 名称 + 一句结果」。
 * 尺寸放大到接近整屏宽 → CHOICE 成为当前页面**唯一**视觉焦点。
 */
export const RUN_CHOICE = {
  cardW: 330,
  cardH: 100,
  gap: 14,
  /** 图标绘制区边长（画在卡片左侧）。 */
  iconSize: 46,
  iconInsetX: 18,
  /** 卡片顶部纯色强调条（不含文字、不被描边覆盖、不被图标覆盖 → 可精确断言）。 */
  barH: 4,
  barInsetX: 10,
  /** 浮层标题相对第一张卡片顶部的上移量。 */
  titleOffsetY: 36,
} as const;

/** 整个逻辑舞台的遮罩矩形（原页面整体变暗，位置不变）。 */
export function runChoiceMaskRect(): RunRect {
  return { x: 0, y: 0, w: RUN_PAGE_W, h: RUN_PAGE_H };
}

/** 三选一卡片（纵向居中堆叠）。 */
export function runChoiceCardRects(count: number): RunRect[] {
  const n = Math.max(0, Math.floor(count));
  if (n === 0) return [];
  const total = n * RUN_CHOICE.cardH + (n - 1) * RUN_CHOICE.gap;
  const x = Math.round((RUN_PAGE_W - RUN_CHOICE.cardW) / 2);
  const y0 = Math.round((RUN_PAGE_H - total) / 2);
  return Array.from({ length: n }, (_, i) => ({
    x,
    y: y0 + i * (RUN_CHOICE.cardH + RUN_CHOICE.gap),
    w: RUN_CHOICE.cardW,
    h: RUN_CHOICE.cardH,
  }));
}

/** 卡片左侧图标绘制区（真实矢量图标画在这里；不承载文字）。 */
export function runChoiceIconRect(card: RunRect): RunRect {
  return {
    x: card.x + RUN_CHOICE.iconInsetX,
    y: card.y + Math.round((card.h - RUN_CHOICE.iconSize) / 2),
    w: RUN_CHOICE.iconSize,
    h: RUN_CHOICE.iconSize,
  };
}

/** 卡片顶部纯色强调条（不含文字、不被描边覆盖 → 入面积账本）。 */
export function runChoiceBarRect(card: RunRect): RunRect {
  return {
    x: card.x + RUN_CHOICE.barInsetX,
    y: card.y + RUN_CHOICE.barH,
    w: card.w - 2 * RUN_CHOICE.barInsetX,
    h: RUN_CHOICE.barH,
  };
}

/** 卡片文案起始 x（图标右侧）。 */
export function runChoiceTextX(card: RunRect): number {
  return runChoiceIconRect(card).x + RUN_CHOICE.iconSize + 16;
}

/** 浮层标题锚点。 */
export function runChoiceTitlePos(count: number): { x: number; y: number } {
  const cards = runChoiceCardRects(count);
  const y = cards.length > 0 ? cards[0].y - RUN_CHOICE.titleOffsetY : Math.round(RUN_PAGE_H / 2);
  return { x: 30, y };
}

/* --------------------------------------------------------- 面积账本（精确） */

/**
 * Run Page 分层 id（数组顺序即绘制顺序，后者覆盖前者）。
 *
 * ⚠️ 只登记「**纯色平铺矩形**」层，且必须同时满足三条硬条件：
 *   1) 不承载任何文字（文字抗锯齿会吃掉净色面积）；
 *   2) 不被描边 / 边框覆盖（描边用的是另一个颜色）；
 *   3) 不被 sprite / 矢量图标覆盖（PRP-R3：车辆改用正式 sprite → 车身 / 部件不再入账）。
 *
 *   - `ground` / `road`   = 地线与路面（车辆底边抬升 2px → 恒为未被覆盖的纯色矩形）；
 *   - `nodeDone/nodeTodo` = 顶部 DAY 进度节点；
 *   - `buffIcon/buffChip` = **实际已获得**的强化图标（无强化时两者面积恒为 0 → 可反证「没有空槽」）；
 *   - `cardBar`           = CHOICE 卡片顶部强调条；
 *   - `actionBar`         = 主动作按钮底部强调条（**只在可用态登记**，面积恒 990）。
 *
 * ⚠️ 为什么没有 `actionBarOff`：sprite 缩放重采样会产生海量中间色，实测存在 1 个抗锯齿像素
 *    恰好等于禁用态强调条的颜色（(149,295)，西瓜车身 sprite 边缘）→ 精确面积无法冻结。
 *    禁用态的真实证据改由 probe 的 `actionEnabled === false` + 按钮填充色点位采样承担
 *    （见 tests/_e2e_run_page.cjs 的 R12b / R22b），因此这里只登记**可用态**。
 */
export type RunLayerId =
  | 'ground'
  | 'road'
  | 'nodeDone'
  | 'nodeTodo'
  | 'buffIcon'
  | 'buffChip'
  | 'cardBar'
  | 'actionBar';

export const RUN_LAYER_IDS: readonly RunLayerId[] = [
  'ground',
  'road',
  'nodeDone',
  'nodeTodo',
  'buffIcon',
  'buffChip',
  'cardBar',
  'actionBar',
];

export interface RunLayeredRect {
  readonly layer: RunLayerId;
  readonly rect: RunRect;
}

export function emptyRunLayerAreas(): Record<RunLayerId, number> {
  const out = {} as Record<RunLayerId, number>;
  for (const id of RUN_LAYER_IDS) out[id] = 0;
  return out;
}

/**
 * 「按绘制顺序叠加后」每层最终可见的像素面积（最上层胜出）。
 * 坐标压缩 + 单元格判定：矩形数量极小，结果精确到 1px，无浮点误差。
 */
export function runPaintedAreas(shapes: readonly RunLayeredRect[]): Record<RunLayerId, number> {
  const out = emptyRunLayerAreas();
  if (shapes.length === 0) return out;
  const xs = [...new Set(shapes.flatMap((s) => [s.rect.x, s.rect.x + s.rect.w]))].sort((a, b) => a - b);
  const ys = [...new Set(shapes.flatMap((s) => [s.rect.y, s.rect.y + s.rect.h]))].sort((a, b) => a - b);
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < ys.length - 1; j++) {
      const cx = (xs[i] + xs[i + 1]) / 2;
      const cy = (ys[j] + ys[j + 1]) / 2;
      let top: RunLayerId | null = null;
      for (const s of shapes) {
        const r = s.rect;
        if (cx > r.x && cx < r.x + r.w && cy > r.y && cy < r.y + r.h) top = s.layer;
      }
      if (top) out[top] += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]);
    }
  }
  return out;
}
