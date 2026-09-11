/**
 * PBL-F0｜Portrait Battle Lab 占位几何（纯函数：无 DOM / 无 Canvas / 无副作用）。
 *
 * 固定摄像机约定：竖屏逻辑舞台 390×844 是唯一坐标基准；逻辑 → 屏幕的换算不在本模块，
 * 而是复用正式共享契约 `PlayerViewportTransform(390, 844)`（contain 缩放居中，唯一变换来源），
 * 因此本实验台不引入第二套坐标系统。
 *
 * 本模块只回答「占位元素画在哪」，全部产出逻辑 px 矩形，供渲染与单测共用同一来源。
 */
import {
  PORTRAIT_LOGICAL_H,
  PORTRAIT_LOGICAL_W,
  type LabArenaId,
  type LabEncounterDef,
  type LabLoadoutDef,
} from './constants';

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** 逻辑舞台矩形（固定摄像机下的可见区域；竖屏 390×844）。 */
export function stageRect(): Rect {
  return { x: 0, y: 0, w: PORTRAIT_LOGICAL_W, h: PORTRAIT_LOGICAL_H };
}

/** 占位地面线 y（逻辑 px）—— 舞台高度 74% 处取整。 */
export const LAB_GROUND_Y = Math.round(PORTRAIT_LOGICAL_H * 0.74);

/**
 * 占位区域划分（互不重叠 → 各占位色块像素面积可精确断言）：
 * - Arena 标记：舞台最外侧 14px 竖柱（x 6..20 / x 370..384）+ Arena B 的中央横条；
 * - 玩家区：x 22..178（左）；敌人区：x 200..364（右）。
 */
const PLAYER_REGION: Rect = { x: 22, y: 0, w: 156, h: 0 };

const ENEMY_REGION: Rect = { x: 200, y: 0, w: 164, h: 0 };

/** Arena 外侧竖柱宽度（逻辑 px）。 */
const ARENA_PILLAR_W = 14;

/** 敌人标记间距（逻辑 px）。 */
const ENEMY_GAP = 12;

/** 玩家占位车辆矩形：贴地（底边 = 地面线），水平居中于玩家区域。 */
export function playerBodyRect(body: LabLoadoutDef['body']): Rect {
  const cx = PLAYER_REGION.x + PLAYER_REGION.w / 2;
  return {
    x: Math.round(cx - body.w / 2),
    y: Math.round(LAB_GROUND_Y - body.h),
    w: body.w,
    h: body.h,
  };
}

/**
 * 敌人占位标记矩形组：贴地（或按 markerLift 抬高），在敌人区域内水平均匀分布。
 * 总宽超出区域时自动收缩标记边长（不溢出、不越界）。
 */
export function enemyMarkerRects(encounter: LabEncounterDef): Rect[] {
  const n = Math.max(1, Math.floor(encounter.enemyCount));
  const gap = ENEMY_GAP;
  const maxTotal = ENEMY_REGION.w;
  let size = encounter.markerSize;
  if (n * size + (n - 1) * gap > maxTotal) {
    size = Math.max(8, Math.floor((maxTotal - (n - 1) * gap) / n));
  }
  const total = n * size + (n - 1) * gap;
  const startX = Math.round(ENEMY_REGION.x + (maxTotal - total) / 2);
  const y = Math.round(LAB_GROUND_Y - encounter.markerLift - size);
  const out: Rect[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ x: startX + i * (size + gap), y, w: size, h: size });
  }
  return out;
}

/**
 * Arena 占位标记：A / B 使用不同布局（用于肉眼与像素级区分「切换是否真的生效」）。
 * 仅为占位表现，不表达任何真实关卡规则。所有矩形与玩家 / 敌人占位区互不重叠。
 */
export function arenaMarkers(arena: LabArenaId): Rect[] {
  const rightX = PORTRAIT_LOGICAL_W - (ARENA_PILLAR_W + 6);
  if (arena === 'A') {
    return [
      { x: 6, y: LAB_GROUND_Y - 150, w: ARENA_PILLAR_W, h: 150 },
      { x: rightX, y: LAB_GROUND_Y - 150, w: ARENA_PILLAR_W, h: 150 },
    ];
  }
  return [
    { x: 6, y: LAB_GROUND_Y - 110, w: ARENA_PILLAR_W, h: 110 },
    { x: rightX, y: LAB_GROUND_Y - 110, w: ARENA_PILLAR_W, h: 110 },
    { x: Math.round(PORTRAIT_LOGICAL_W / 2) - 40, y: LAB_GROUND_Y - 210, w: 80, h: 30 },
  ];
}
