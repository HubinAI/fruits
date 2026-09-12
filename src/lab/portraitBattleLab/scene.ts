/**
 * PBL-F1｜Lab 占位舞台的场景组装（纯函数）。
 *
 * 单一来源：所有实体外形都从**正式 registry 的真实 collider 几何**推导
 * （车身 collider + 功能件 collider × 真实挂点 localPosition），
 * 因此「切换 Loadout / Encounter 后画面确实换了实体」不是手写尺寸，而是数据驱动。
 *
 * 占位约定：
 *   - 所有车辆在本占位舞台一律朝右（facing=+1），故不做镜像；
 *   - 不绘制轮组（圆形 collider 的像素面积非整数，会破坏像素级精确断言）；
 *     轮组的真实数值仍在 SpawnPlan.movements 里，属 A1/B1 的表现范围。
 *
 * 真实的空间规则（出生点 / 朝向 / 站位）由 PBL-A1 决定：**Arena A 自 PBL-A1 起已改由
 * `arenaScene.ts` 直接取自真实物理运行时快照**（本模块的 'A' 分支保留为纯模型对照，
 * 供 F1 账本用例校验「占位几何」本身，不再被 Lab 实际渲染使用）；Arena B 仍走本模块。
 */
import { registry } from '../../core/content';
import type { ColliderDef } from '../../core/types';
import type { LabArenaId } from './constants';
import {
  arenaMarkers,
  boxBounds,
  enemyPlacement,
  playerPlacement,
  type LayeredRect,
  type OffsetBox,
  type Rect,
} from './layout';
import type { SpawnPlan, SpawnedEntity } from './entities';

/** 正式 collider → 相对父件原点的外接矩形（box / circle / polygon 统一处理）。 */
function colliderToOffsetBox(c: ColliderDef): OffsetBox | null {
  const ox = c.offset?.x ?? 0;
  const oy = c.offset?.y ?? 0;
  if (c.shape === 'box') {
    const w = c.width ?? 0;
    const h = c.height ?? 0;
    if (w <= 0 || h <= 0) return null;
    return { dx: ox - w / 2, dy: oy - h / 2, w, h };
  }
  if (c.shape === 'circle') {
    const r = c.radius ?? 0;
    if (r <= 0) return null;
    return { dx: ox - r, dy: oy - r, w: r * 2, h: r * 2 };
  }
  const pts = c.vertices ?? [];
  if (pts.length === 0) return null;
  const xs = pts.map((p) => p.x + ox);
  const ys = pts.map((p) => p.y + oy);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { dx: minX, dy: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
}

/** 车身 collider 外形（相对车身原点）；未知 Body 抛错，不静默画空。 */
export function bodyOffsetBoxes(bodyDefId: string): OffsetBox[] {
  const body = registry.bodies.get(bodyDefId);
  if (!body) throw new Error(`[PBL] 未知 Body "${bodyDefId}"（正式内容库无此车身）`);
  const boxes = body.colliders.map(colliderToOffsetBox).filter((b): b is OffsetBox => b !== null);
  if (boxes.length === 0) throw new Error(`[PBL] Body "${bodyDefId}" 没有可绘制 collider`);
  return boxes;
}

/** 功能件 collider 外形（已换算到车身原点坐标系）。缺失 hardpoint / def 抛错。 */
export function partOffsetBoxes(entity: SpawnedEntity): OffsetBox[] {
  const body = registry.bodies.get(entity.bodyDefId);
  if (!body) throw new Error(`[PBL] 未知 Body "${entity.bodyDefId}"`);
  const out: OffsetBox[] = [];
  for (const f of entity.functionals) {
    const hp = body.functionalHardpoints.find((h) => h.id === f.hardpointId);
    if (!hp) throw new Error(`[PBL] Body "${entity.bodyDefId}" 无挂点 "${f.hardpointId}"`);
    const def = registry.functionals.get(f.defId);
    if (!def) throw new Error(`[PBL] 正式内容库无功能性部件 "${f.defId}"`);
    const b = colliderToOffsetBox(def.collider);
    if (!b) continue;
    out.push({
      dx: hp.localPosition.x + b.dx,
      dy: hp.localPosition.y + b.dy,
      w: b.w,
      h: b.h,
    });
  }
  return out;
}

/**
 * 组装完整场景：按绘制顺序返回（数组顺序 = 绘制顺序，后者覆盖前者）。
 * 顺序：Arena 标记 → 玩家（车身 → 部件）→ 每个敌人（车身 → 部件）。
 */
export function buildScene(arena: LabArenaId, plan: SpawnPlan): LayeredRect[] {
  const shapes: LayeredRect[] = [];
  for (const r of arenaMarkers(arena)) shapes.push({ layer: 'arena', rect: r });

  const pushEntity = (
    bodyLayer: 'playerBody' | 'enemyBody',
    partLayer: 'playerPart' | 'enemyPart',
    bodyRects: readonly Rect[],
    partRects: readonly Rect[],
  ): void => {
    for (const r of bodyRects) shapes.push({ layer: bodyLayer, rect: r });
    for (const r of partRects) shapes.push({ layer: partLayer, rect: r });
  };

  // 玩家：贴地居中
  pushEntity(
    'playerBody',
    'playerPart',
    playerPlacement(bodyOffsetBoxes(plan.player.bodyDefId)),
    playerPlacement(partOffsetBoxes(plan.player)),
  );

  // 敌人：自顶部向下竖排（同 Body 只解析一次）
  const cache = new Map<string, { body: OffsetBox[]; bounds: OffsetBox }>();
  for (const e of plan.enemies) {
    let entry = cache.get(e.bodyDefId);
    if (!entry) {
      const body = bodyOffsetBoxes(e.bodyDefId);
      entry = { body, bounds: boxBounds(body) };
      cache.set(e.bodyDefId, entry);
    }
    pushEntity(
      'enemyBody',
      'enemyPart',
      enemyPlacement(entry.body, entry.bounds, e.slotIndex),
      enemyPlacement(partOffsetBoxes(e), entry.bounds, e.slotIndex),
    );
  }
  return shapes;
}
