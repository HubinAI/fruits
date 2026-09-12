/**
 * PRP-F0-RUN-PAGE-SHELL｜Portrait Run Prototype —— Run Page 纯几何层
 *（无 DOM / 无 Canvas / 无 registry / 无副作用）。
 *
 * 产品基线（本 Queue 唯一要验证的东西）：
 *   整个单局 = **一个持续存在的竖屏 Adventure Run Page**；战斗 / 事件 / 强化 / 结果是
 *   同一个页面的不同状态，不存在页面跳转。
 *
 * 页面结构与本模块的对应关系（全部落在逻辑基准 390×844 上，横向 4 条带、无缝无叠）：
 *   ┌ y=0   ── RUN_TOP_BAND   ( 84)  顶部薄层：本局进度节点 + 当前核心 Build 图标    9.95%
 *   │ y=84  ── RUN_STAGE_BAND (414)  中部主体：侧视车辆舞台（玩家固定左 / 敌人固定右）49.05%
 *   │ y=498 ── RUN_LOG_BAND   (262)  下部：可持续追加的冒险日志                    31.04%
 *   └ y=760 ── RUN_ACTION_BAND( 84)  最底：唯一一个当前主动作按钮                   9.95%
 *                                    合计 84+414+262+84 = 844
 *
 * ⚠️ PRP-R1-ACTUAL-RUNTIME-ENTRY-LAYOUT-FIX：比例取自 Queue 必改 3
 *    （顶部 8~10% / 舞台 45~50% / 日志 28~32% / 动作 8~10%），由 RP-01b 冻结。
 *    面积账本 `runPaintedAreas` 全部为**与 y 无关**的矩形面积 → 本次带高调整不改变账本。
 *
 * ⚠️ 面积账本 `runPaintedAreas` 与 F0 的 `layout.ts::paintedAreas` 是同一套算法的两份实现。
 * 刻意不去合并：`layout.ts` 属 **PBL-F0 冻结资产**（本 Queue 明令不扩展其能力），
 * 且两者的分层 id 集合不同（Run Page 多了 ground / 图标 / 节点 / 卡片 / 按钮层）。
 * 两份都是纯数学，互不引用 → 冻结资产的零改动可被源码守卫证明。
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

/** 顶部薄层高度：只放进度与 Build 图标，禁止做大块状态面板（≈9.95%）。 */
export const RUN_TOP_BAND_H = 84;
/** 下部日志区高度（可持续追加，≈31.04%）。 */
export const RUN_LOG_BAND_H = 262;
/** 最底动作区高度（只承载唯一一个主动作按钮，≈9.95%）。 */
export const RUN_ACTION_BAND_H = 84;
/** 中部舞台高度：由「总高 − 其余三带」反推 → 结构上不可能漏缝或重叠。 */
export const RUN_STAGE_BAND_H = RUN_PAGE_H - RUN_TOP_BAND_H - RUN_LOG_BAND_H - RUN_ACTION_BAND_H;

const BAND_X = 0;
const BAND_W = RUN_PAGE_W;

export const RUN_TOP_BAND: RunRect = { x: BAND_X, y: 0, w: BAND_W, h: RUN_TOP_BAND_H };
export const RUN_STAGE_BAND: RunRect = {
  x: BAND_X,
  y: RUN_TOP_BAND.y + RUN_TOP_BAND.h,
  w: BAND_W,
  h: RUN_STAGE_BAND_H,
};
export const RUN_LOG_BAND: RunRect = {
  x: BAND_X,
  y: RUN_STAGE_BAND.y + RUN_STAGE_BAND.h,
  w: BAND_W,
  h: RUN_LOG_BAND_H,
};
export const RUN_ACTION_BAND: RunRect = {
  x: BAND_X,
  y: RUN_LOG_BAND.y + RUN_LOG_BAND.h,
  w: BAND_W,
  h: RUN_ACTION_BAND_H,
};

/** 自上而下的绘制 / 布局顺序（数组顺序即 y 升序）。 */
export const RUN_BANDS: readonly RunRect[] = [
  RUN_TOP_BAND,
  RUN_STAGE_BAND,
  RUN_LOG_BAND,
  RUN_ACTION_BAND,
];

/* ------------------------------------------------- 顶部薄层：进度 + Build */

/** 「DAY 3 / 7」文本的绘制锚点（左下角基线起点）。 */
export const RUN_DAY_LABEL_POS = { x: 16, y: 30 } as const;

/** 进度节点（一个小矩形 = 一天）。 */
export const RUN_DAY_NODE = { w: 18, h: 8, gap: 6, right: 16, y: 20 } as const;

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

/** 当前核心 Build 图标槽（固定 3～5 个，本 Queue 取 5）。 */
export const RUN_BUILD_ICON_SLOTS = 5;
export const RUN_BUILD_ICON = { size: 28, gap: 8, x: 16, y: 52 } as const;
/** 已获得图标内部的高光小方块（与底色互斥的第二色 → 供像素级精确断言）。 */
export const RUN_BUILD_ICON_CHIP = { size: 12 } as const;

/** Build 图标槽位（左对齐，固定数量 → 未获得的槽位也占位，画面上不会「跳动」）。 */
export function runBuildIconSlots(count: number = RUN_BUILD_ICON_SLOTS): RunRect[] {
  const n = Math.max(0, Math.floor(count));
  return Array.from({ length: n }, (_, i) => ({
    x: RUN_BUILD_ICON.x + i * (RUN_BUILD_ICON.size + RUN_BUILD_ICON.gap),
    y: RUN_BUILD_ICON.y,
    w: RUN_BUILD_ICON.size,
    h: RUN_BUILD_ICON.size,
  }));
}

/** 已获得图标的高光方块（在槽位内居中）。 */
export function runBuildIconChip(slot: RunRect): RunRect {
  const inset = Math.floor((slot.w - RUN_BUILD_ICON_CHIP.size) / 2);
  return {
    x: slot.x + inset,
    y: slot.y + inset,
    w: RUN_BUILD_ICON_CHIP.size,
    h: RUN_BUILD_ICON_CHIP.size,
  };
}

/** 「核心构建」说明文本锚点（在图标带右侧）。 */
export const RUN_BUILD_LABEL_POS = { x: 200, y: 72 } as const;

/* --------------------------------------------------- 中部：侧视战斗舞台 */

/**
 * 侧视舞台的三条硬约束：
 *   1) 玩家**固定**视觉起点在左、敌人**固定**视觉起点在右（本模块的 place 函数保证）；
 *   2) 缩放只服务「两车都装得下」，不改变任何战斗数据（正式 collider 几何原样，仅整体等比缩放）；
 *   3) 车底贴地线（groundY），地线之下留出固定装饰余量。
 *
 * 缩放上限 0.6：实测两车外接框最大 247px（香蕉冲锋锤 / 追猎者），两张合计 494px，
 * 而 390 宽舞台扣掉左右边距与中缝后只有 334px → 必须缩放才能「两车同框」。
 * 这**不是**在解决 PBL-B1 的接敌距离问题（那是真实物理空间，已按停止条件终止），
 * 只是演示页面的显示缩放。
 */
export const RUN_SIDE_VIEW = {
  /** 左右边距（逻辑 px）。 */
  marginPx: 14,
  /** 两车之间必须保留的最小中缝（逻辑 px）。 */
  gapPx: 28,
  /** 显示缩放上限（只缩不放，避免小车体被放大到失真）。 */
  maxScale: 0.6,
  /** 地线到舞台带底边的余量（逻辑 px）。 */
  groundInsetPx: 44,
} as const;

/** 战斗演出时两车相向的最大位移（逻辑 px）——纯表现，不是物理。 */
export const RUN_SIDE_VIEW_CLOSING_PX = 24;

/** 侧视舞台地线 y（车辆底边贴这条线）。 */
export function runStageGroundY(): number {
  return RUN_STAGE_BAND.y + RUN_STAGE_BAND.h - RUN_SIDE_VIEW.groundInsetPx;
}

/**
 * 显示缩放：按「两车外接框宽度之和」推导，取上限封顶。
 * 传入两侧宽度（已含全部 collider 外接框）→ 结果只与几何有关，与状态无关，
 * 因此敌人在 EVENT / BATTLE 出现时**不会**导致玩家车体突然缩放。
 */
export function runSideViewScale(playerWidth: number, enemyWidth: number): number {
  const avail = RUN_PAGE_W - 2 * RUN_SIDE_VIEW.marginPx - RUN_SIDE_VIEW.gapPx;
  const need = Math.max(1, Math.max(0, playerWidth) + Math.max(0, enemyWidth));
  return Math.min(RUN_SIDE_VIEW.maxScale, avail / need);
}

export interface RunOffsetBox {
  readonly dx: number;
  readonly dy: number;
  readonly w: number;
  readonly h: number;
}

export interface RunPlaced {
  readonly rects: readonly RunRect[];
  /** 该实体全部矩形的精确并集（取整后）→ 供「玩家左 / 敌人右」判定使用。 */
  readonly bounds: RunRect;
}

/** 外接框（相对同一原点）。 */
export function runBoxBounds(boxes: readonly RunOffsetBox[]): RunOffsetBox {
  const minX = Math.min(...boxes.map((b) => b.dx));
  const minY = Math.min(...boxes.map((b) => b.dy));
  const maxX = Math.max(...boxes.map((b) => b.dx + b.w));
  const maxY = Math.max(...boxes.map((b) => b.dy + b.h));
  return { dx: minX, dy: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * 把一个实体的相对矩形组摆到侧视舞台上。
 *
 * 取整策略：缩放后再对「每条边的坐标」取整（而不是先取整再缩放），
 * 于是矩形之间不会出现 1px 缝隙，且整组的最小 / 最大边**恰好**落在边距线上 ——
 * 这就是「玩家固定起点在左 / 敌人固定起点在右」的可断言形式。
 */
export function placeSideViewEntity(
  boxes: readonly RunOffsetBox[],
  side: 'left' | 'right',
  scale: number,
  groundY: number,
): RunPlaced {
  if (boxes.length === 0) {
    return { rects: [], bounds: { x: 0, y: 0, w: 0, h: 0 } };
  }
  const s = (v: number): number => Math.round(v * scale);
  const edges = boxes.map((b) => ({
    x0: s(b.dx),
    y0: s(b.dy),
    x1: s(b.dx + b.w),
    y1: s(b.dy + b.h),
  }));
  const minX = Math.min(...edges.map((e) => e.x0));
  const maxX = Math.max(...edges.map((e) => e.x1));
  const maxY = Math.max(...edges.map((e) => e.y1));

  const tx =
    side === 'left'
      ? RUN_STAGE_BAND.x + RUN_SIDE_VIEW.marginPx - minX
      : RUN_STAGE_BAND.x + RUN_STAGE_BAND.w - RUN_SIDE_VIEW.marginPx - maxX;
  const ty = groundY - maxY;

  const rects: RunRect[] = edges.map((e) => ({
    x: e.x0 + tx,
    y: e.y0 + ty,
    w: Math.max(1, e.x1 - e.x0),
    h: Math.max(1, e.y1 - e.y0),
  }));
  const bx0 = Math.min(...rects.map((r) => r.x));
  const by0 = Math.min(...rects.map((r) => r.y));
  const bx1 = Math.max(...rects.map((r) => r.x + r.w));
  const by1 = Math.max(...rects.map((r) => r.y + r.h));
  return { rects, bounds: { x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0 } };
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

/** 两个矩形是否真实重叠（边贴边不算）。 */
export function runRectsOverlap(a: RunRect, b: RunRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/* -------------------------------------------------- 下部：冒险日志 */

export const RUN_LOG = {
  /** 日志区标题锚点（相对日志带顶部）。 */
  labelOffsetY: 22,
  /** 第一条日志的顶部（相对日志带顶部）。 */
  topOffsetY: 28,
  /** 行高。 */
  lineH: 21,
  /** 固定可见行数（新行从底部顶入，呈现「可持续追加」的观感）。 */
  maxLines: 10,
  x: 16,
  right: 16,
} as const;

/** 日志区标题锚点（绝对坐标）。 */
export const RUN_LOG_LABEL_POS = { x: RUN_LOG.x, y: RUN_LOG_BAND.y + RUN_LOG.labelOffsetY } as const;

/** 日志行矩形（从顶部顺序排列，固定行数 → 行位置不会因内容多少而抖动）。 */
export function runLogLineRects(count: number = RUN_LOG.maxLines): RunRect[] {
  const n = Math.max(0, Math.floor(count));
  return Array.from({ length: n }, (_, i) => ({
    x: RUN_LOG.x,
    y: RUN_LOG_BAND.y + RUN_LOG.topOffsetY + i * RUN_LOG.lineH,
    w: RUN_PAGE_W - RUN_LOG.x - RUN_LOG.right,
    h: RUN_LOG.lineH,
  }));
}

/** 日志区最后一行底边（必须不越过动作区上沿 → 由测试守卫）。 */
export function runLogBottomY(count: number = RUN_LOG.maxLines): number {
  const rects = runLogLineRects(count);
  if (rects.length === 0) return RUN_LOG_BAND.y + RUN_LOG.topOffsetY;
  const last = rects[rects.length - 1];
  return last.y + last.h;
}

/* ------------------------------------------------------- 最底：主动作按钮 */

/** 主动作按钮：整条动作带内**唯一**的可点击目标。 */
export function runActionButtonRect(): RunRect {
  const h = 48;
  return {
    x: 28,
    y: RUN_ACTION_BAND.y + Math.round((RUN_ACTION_BAND.h - h) / 2),
    w: RUN_PAGE_W - 56,
    h,
  };
}

/**
 * 主动作按钮底部的纯色强调块。
 *
 * 为什么需要它：按钮上要写文案、要描边，这两者都会吃掉「净色像素」，
 * 使按钮整体的精确面积无法断言。这里额外画一条**不承载文字、不被描边覆盖**的
 * 纯色块，于是「按钮存在 / 可用态切换」就有了可精确断言的像素证据。
 */
export const RUN_ACTION_BAR = { insetX: 6, h: 3, bottomInset: 9 } as const;

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

export const RUN_CHOICE = {
  cardW: 318,
  cardH: 78,
  gap: 14,
  /** 卡片左侧颜色小方块（不含文字 → 面积可精确断言）。 */
  chipSize: 26,
  chipInsetX: 16,
  /** 卡片顶部纯色强调条（不含文字、不被描边覆盖 → 面积可精确断言）。 */
  barH: 4,
  barInsetX: 8,
  /** 浮层标题相对第一张卡片顶部的上移量。 */
  titleOffsetY: 34,
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

/** 卡片左侧色块（不含文字）。 */
export function runChoiceChipRect(card: RunRect): RunRect {
  return {
    x: card.x + RUN_CHOICE.chipInsetX,
    y: card.y + Math.round((card.h - RUN_CHOICE.chipSize) / 2),
    w: RUN_CHOICE.chipSize,
    h: RUN_CHOICE.chipSize,
  };
}

/** 卡片顶部纯色强调条（不含文字、不被描边覆盖）。 */
export function runChoiceBarRect(card: RunRect): RunRect {
  return {
    x: card.x + RUN_CHOICE.barInsetX,
    y: card.y + RUN_CHOICE.barH,
    w: card.w - 2 * RUN_CHOICE.barInsetX,
    h: RUN_CHOICE.barH,
  };
}

/** 浮层标题锚点。 */
export function runChoiceTitlePos(count: number): { x: number; y: number } {
  const cards = runChoiceCardRects(count);
  const y = cards.length > 0 ? cards[0].y - RUN_CHOICE.titleOffsetY : Math.round(RUN_PAGE_H / 2);
  return { x: 36, y };
}

/* --------------------------------------------------------- 面积账本（精确） */

/**
 * Run Page 分层 id（数组顺序即绘制顺序，后者覆盖前者）。
 *
 * ⚠️ 只登记「**纯色平铺矩形**」层，且这些矩形必须满足两条硬条件：
 *   1) 不承载任何文字（文字的抗锯齿像素会吃掉净色面积）；
 *   2) 不被描边 / 边框覆盖（描边用的是另一个颜色）。
 * 正因如此，这些层的像素面积可以被**精确冻结**并在浏览器端用真实 getImageData 交叉核对。
 * 承载文字的面（分带底色、按钮填充、卡片填充、日志区）一律不入账，
 * 它们在浏览器端改用「按点位采样精确色」来验证。
 *
 *   - `actionBar` / `actionBarOff` = 主动作按钮底部的纯色强调条（可用态 / 禁用态）；
 *   - `cardBar` / `cardChip` = CHOICE 卡片顶部强调条 / 左侧色块。
 */
export type RunLayerId =
  | 'ground'
  | 'playerBody'
  | 'playerPart'
  | 'enemyBody'
  | 'enemyPart'
  | 'nodeDone'
  | 'nodeTodo'
  | 'iconSlot'
  | 'iconOwned'
  | 'iconChip'
  | 'cardBar'
  | 'cardChip'
  | 'actionBar'
  | 'actionBarOff';

export const RUN_LAYER_IDS: readonly RunLayerId[] = [
  'ground',
  'playerBody',
  'playerPart',
  'enemyBody',
  'enemyPart',
  'nodeDone',
  'nodeTodo',
  'iconSlot',
  'iconOwned',
  'iconChip',
  'cardBar',
  'cardChip',
  'actionBar',
  'actionBarOff',
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
