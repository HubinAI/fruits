/**
 * PBL-F0 / PBL-F1｜Portrait Battle Lab 占位几何原语（纯数学：无 DOM / 无 Canvas / 无 registry）。
 *
 * 固定摄像机约定：竖屏逻辑舞台 390×844 是唯一坐标基准；逻辑 → 屏幕的换算不在本模块，
 * 而是复用正式共享契约 `PlayerViewportTransform(390, 844)`（contain 缩放居中，唯一变换来源）。
 *
 * 场景元素的真实来源在 scene.ts（读正式 registry 的 collider 几何）；
 * 本模块只提供「坐标怎么算」与「画出来各层像素面积是多少」。
 *
 * ⚠️ 实体排布（玩家下中、敌人上中竖排）只是**占位展示**，不代表任何 Arena 的空间规则；
 * 真实出生点 / 站位 / 方向由 PBL-A1（纵向俯视）与 PBL-B1（侧视平地）各自决定。
 */
import { PORTRAIT_LOGICAL_H, PORTRAIT_LOGICAL_W, type LabArenaId } from './constants';

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** 相对某原点（车身 / 挂点）的矩形。 */
export interface OffsetBox {
  readonly dx: number;
  readonly dy: number;
  readonly w: number;
  readonly h: number;
}

/** 逻辑舞台矩形（固定摄像机下的可见区域；竖屏 390×844）。 */
export function stageRect(): Rect {
  return { x: 0, y: 0, w: PORTRAIT_LOGICAL_W, h: PORTRAIT_LOGICAL_H };
}

/** 占位地面线 y（逻辑 px）—— 舞台高度 74% 处取整（PBL-F0 起不变的坐标契约）。 */
export const LAB_GROUND_Y = Math.round(PORTRAIT_LOGICAL_H * 0.74);

/** Arena 标记所在的下方信息带底边（在实体活动区之下，确保与实体永不重叠）。 */
export const ARENA_BAND_BOTTOM = PORTRAIT_LOGICAL_H - 24;

/** Arena 外侧竖柱宽度（逻辑 px）。 */
const ARENA_PILLAR_W = 14;

/** Arena A / B 竖柱高度（不同 → 切换在像素级可见）。 */
const ARENA_PILLAR_H: Record<LabArenaId, number> = { A: 150, B: 110 };

/** Arena B 专属中央横条（区分 A / B）。 */
const ARENA_B_BAR = { w: 80, h: 30 };

/** 实体水平中心（占位排布：玩家与敌人均居中于竖屏舞台）。 */
export const ENTITY_CENTER_X = Math.round(PORTRAIT_LOGICAL_W / 2);

/**
 * 敌人竖排起始顶部与行距（逻辑 px）。
 * 约定：顶部 HUD 带高 0..136（纯文字，永不与实体矩形重叠 → 文字抗锯齿不会
 * 污染像素分类）；行距 100 + 车身 50 → 行间净空 100，3 行最底 520 < 玩家顶边 575。
 */
export const ENEMY_STACK_TOP = 170;
export const ENEMY_STACK_GAP = 100;

/** 顶部 HUD 带高度（逻辑 px）——实体一律绘制在其下方，文字不覆盖任何实体矩形。 */
export const HUD_BAND_H = 132;

/** 外接框（相对同一原点）。 */
export function boxBounds(boxes: readonly OffsetBox[]): OffsetBox {
  const minX = Math.min(...boxes.map((b) => b.dx));
  const minY = Math.min(...boxes.map((b) => b.dy));
  const maxX = Math.max(...boxes.map((b) => b.dx + b.w));
  const maxY = Math.max(...boxes.map((b) => b.dy + b.h));
  return { dx: minX, dy: minY, w: maxX - minX, h: maxY - minY };
}

/** 把相对矩形平移到 (cx, cy)；坐标取整 → 像素面积可精确断言（无抗锯齿）。 */
export function placeBoxes(boxes: readonly OffsetBox[], cx: number, cy: number): Rect[] {
  return boxes.map((b) => ({
    x: Math.round(cx + b.dx),
    y: Math.round(cy + b.dy),
    w: Math.round(b.w),
    h: Math.round(b.h),
  }));
}

/** 玩家实体矩形组：底边贴地面线、水平居中（占位排布）。 */
export function playerPlacement(boxes: readonly OffsetBox[]): Rect[] {
  const b = boxBounds(boxes);
  const cy = Math.round(LAB_GROUND_Y - (b.dy + b.h)); // 最低边 = 地面线
  return placeBoxes(boxes, ENTITY_CENTER_X, cy);
}

/** 敌人实体矩形组：自 ENEMY_STACK_TOP 起向下竖排（占位排布）。 */
export function enemyPlacement(
  boxes: readonly OffsetBox[],
  bounds: OffsetBox,
  slotIndex: number,
): Rect[] {
  const top = ENEMY_STACK_TOP + slotIndex * (Math.round(bounds.h) + ENEMY_STACK_GAP);
  const cy = Math.round(top - bounds.dy); // 顶边 = top
  return placeBoxes(boxes, ENTITY_CENTER_X, cy);
}

/**
 * Arena 标记（下方信息带）：A / B 高度不同 + B 追加中央横条，
 * 仅用于肉眼与像素级区分「Arena 切换是否真的生效」；不表达任何真实关卡规则。
 * 全部矩形位于实体活动区之下，与实体永不重叠。
 */
export function arenaMarkers(arena: LabArenaId): Rect[] {
  const h = ARENA_PILLAR_H[arena];
  const y = ARENA_BAND_BOTTOM - h;
  const rightX = PORTRAIT_LOGICAL_W - (ARENA_PILLAR_W + 6);
  const pillar = (x: number): Rect => ({ x, y, w: ARENA_PILLAR_W, h });
  if (arena === 'A') return [pillar(6), pillar(rightX)];
  return [
    pillar(6),
    pillar(rightX),
    {
      x: Math.round(PORTRAIT_LOGICAL_W / 2) - ARENA_B_BAR.w / 2,
      y: ARENA_BAND_BOTTOM - ARENA_B_BAR.h,
      w: ARENA_B_BAR.w,
      h: ARENA_B_BAR.h,
    },
  ];
}

/** 单层矩形总面积（不含层间覆盖）。 */
export function rectsArea(rects: readonly Rect[]): number {
  return rects.reduce((s, r) => s + r.w * r.h, 0);
}

/** Arena 标记的像素面积期望值（渲染与测试共用同一来源 → 像素断言可精确）。 */
export function arenaMarkerArea(arena: LabArenaId): number {
  return rectsArea(arenaMarkers(arena));
}

/** 矩形严格相交判定（边贴边不算相交）。 */
export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/* -------------------------------------------------- 分层绘制面积（精确） */

/** 场景分层 id（= 绘制层；数组顺序即绘制顺序，后者覆盖前者）。 */
export type LabLayerId = 'arena' | 'playerBody' | 'playerPart' | 'enemyBody' | 'enemyPart';

export interface LayeredRect {
  readonly layer: LabLayerId;
  readonly rect: Rect;
}

/**
 * 计算「按绘制顺序叠加后」每层最终可见的像素面积（最上层胜出）。
 * 坐标压缩 + 单元格判定：矩形数量极小（≤ 20），结果精确到 1px，无浮点误差。
 */
export function paintedAreas(shapes: readonly LayeredRect[]): Record<LabLayerId, number> {
  const out: Record<LabLayerId, number> = {
    arena: 0,
    playerBody: 0,
    playerPart: 0,
    enemyBody: 0,
    enemyPart: 0,
  };
  if (shapes.length === 0) return out;
  const xs = [...new Set(shapes.flatMap((s) => [s.rect.x, s.rect.x + s.rect.w]))].sort((a, b) => a - b);
  const ys = [...new Set(shapes.flatMap((s) => [s.rect.y, s.rect.y + s.rect.h]))].sort((a, b) => a - b);
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < ys.length - 1; j++) {
      const cx = (xs[i] + xs[i + 1]) / 2;
      const cy = (ys[j] + ys[j + 1]) / 2;
      let top: LabLayerId | null = null;
      for (const s of shapes) {
        const r = s.rect;
        if (cx > r.x && cx < r.x + r.w && cy > r.y && cy < r.y + r.h) top = s.layer;
      }
      if (top) out[top] += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]);
    }
  }
  return out;
}
