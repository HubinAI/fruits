/**
 * PRODUCT-LOOP-R1-A-HOME-GARAGE-INVENTORY｜「当前战车」预览的**纯几何**（零 DOM、零 canvas）。
 *
 * 目的：首页与调整战车都要能**看到车**，且看到的车必须来自**正式数据**，不是自造美术。
 *
 * 复用面（只读，全部是正式单一真源）：
 *   - 车身/部件/轮组的正式视觉定义：`BodyDef.visual` / `FunctionalPartDef.visual` /
 *     `WheelDef.visual`（`visualId` + `size` + `anchor` + `layer`）；
 *   - 车身真实挂点：`BodyDef.functionalHardpoints` / `movementHardpoints` 的 `localPosition`；
 *   - 无 `visual` 的件（如刺/镭射/圆锯等尚未出图的武器）**不伪造外形**：按真实 Collider 的
 *     `shape` + `offset` 取外接框（box: width×height / circle: 2r×2r），并如实标 `visualId: null`。
 *
 * 绘制约定与正式 `Renderer.drawVisual` **逐字一致**（`src/render/renderer.ts:1854`）：
 *   `translate(position) · scale(-1,1)[mirror] · rotate(rotation)`，sprite 以 `(0,0)` 为中心、
 *   尺寸 = `visual.size` 绘制；其中 `position = physPos + anchor`（见正式纯函数
 *   `visualWorldTransform`）。本模块只算 `position`（facing=1、angle=0 的静态展示姿态），
 *   把 `anchor` 烘焙进中心点 ⇒ 与战斗里画出来的车**同一套 anchor 语义**。
 *
 * ⚠️ 坐标口径：本模块返回**车体本地坐标**（y **向上**，与物理一致）。
 *    页面 DOM 的 y 向下，翻转由视图层做（`top = cy - localY*scale`），
 *    本模块不做任何屏幕坐标换算 —— 避免出现第二套坐标语义。
 */

import { registry } from '../core/content';
import { EMPTY_SLOT, type BuildDraft } from '../lab/buildEditorModel';
import { WEAPON_SLOT } from './playerLoadout';
import type { BodyDef, ColliderDef } from '../core/types';

/**
 * `assets/visuals/` 里**真实存在** PNG 的 visualId 白名单。
 * 单测会拿磁盘上的实际文件与此表交叉核对（防止表变成「看起来齐全」的死配置）。
 */
export const PREVIEW_SPRITE_IDS: readonly string[] = [
  'body_banana',
  'body_watermelon',
  'part_cannon',
  'part_hammer',
  'part_pushRod',
];

/** 预览舞台的默认逻辑尺寸（与竖屏产品舞台同宽 390）。 */
export const PREVIEW_STAGE_W = 390;
/** 车身横向占舞台的目标宽度（逻辑 px）——车"看得清"但不越界。 */
export const PREVIEW_FIT_W = 300;
/** 预览区最大高度（逻辑 px）——竖屏首页给车留的主体空间。 */
export const PREVIEW_MAX_H = 170;

export interface PreviewItem {
  /** 稳定 DOM key（同车同 Build 恒定）。 */
  readonly key: string;
  readonly kind: 'body' | 'wheel' | 'part';
  readonly defId: string;
  readonly name: string;
  /** 正式视觉 id；无视觉定义的件为 null（视图按外接框画灰盒，不伪造外形）。 */
  readonly visualId: string | null;
  /** 车体本地中心（px，y 向上）。 */
  readonly cx: number;
  readonly cy: number;
  /** 未缩放尺寸（px，同 visual.size / Collider 外接框）。 */
  readonly w: number;
  readonly h: number;
  /** 圆形绘制（轮子 / circle collider）。 */
  readonly round: boolean;
  /** 正式 layer（大在上层）；灰盒件按 0 处理。 */
  readonly layer: number;
  /** 是否挂在 MVP 唯一可写的 Weapon 槽位上（首页高亮用）。 */
  readonly onWeaponSlot: boolean;
}

export interface VehiclePreviewLayout {
  readonly items: readonly PreviewItem[];
  /** 车体本地包围盒（含 sprite 外接框）。 */
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  /** 本地 px → 预览 px 的缩放。 */
  readonly scale: number;
  readonly stageW: number;
  readonly stageH: number;
  readonly bodyName: string;
}

const EMPTY_LAYOUT: VehiclePreviewLayout = {
  items: [],
  minX: 0,
  minY: 0,
  maxX: 0,
  maxY: 0,
  scale: 1,
  stageW: PREVIEW_STAGE_W,
  stageH: PREVIEW_MAX_H,
  bodyName: '',
};

/** Collider → 外接框 + 框心（无 visual 件的如实回退；不猜外形、不补美术）。 */
function colliderGeom(c: ColliderDef): { w: number; h: number; round: boolean; dx: number; dy: number } {
  if (c.shape === 'circle') {
    const r = c.radius ?? 0;
    return { w: r * 2, h: r * 2, round: true, dx: c.offset.x, dy: c.offset.y };
  }
  if (c.shape === 'polygon' && c.vertices && c.vertices.length > 0) {
    // polygon：顶点是「相对 offset」的 ⇒ 外接框 = offset + 顶点包围盒
    const xs = c.vertices.map((v) => v.x);
    const ys = c.vertices.map((v) => v.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return {
      w: maxX - minX,
      h: maxY - minY,
      round: false,
      dx: c.offset.x + (minX + maxX) / 2,
      dy: c.offset.y + (minY + maxY) / 2,
    };
  }
  // box：`offset` 即矩形中心（与 renderer 的 drawShape 同口径）
  return { w: c.width ?? 0, h: c.height ?? 0, round: false, dx: c.offset.x, dy: c.offset.y };
}

/**
 * 由 Build + 正式 registry 算出当前战车的静态预览布局。
 * 纯函数：无副作用、不读存档、不写任何状态（可直接 node 单测）。
 */
export function vehiclePreviewLayout(draft: BuildDraft): VehiclePreviewLayout {
  const body: BodyDef | undefined = registry.bodies.get(draft.bodyDefId);
  if (!body) return EMPTY_LAYOUT;

  const items: PreviewItem[] = [];

  // ① 车身：position = (0,0) + anchor（正式 visualWorldTransform 在 physPos=(0,0) 处的取值）
  if (body.visual) {
    const v = body.visual;
    items.push({
      key: 'body',
      kind: 'body',
      defId: body.id,
      name: body.name,
      visualId: v.visualId,
      cx: v.anchor.x,
      cy: v.anchor.y,
      w: v.size.width,
      h: v.size.height,
      round: false,
      layer: v.layer,
      onWeaponSlot: false,
    });
  }

  // ② 轮子：center = movementHardpoint.localPosition；半径取 Build 真实轮径（缺省用轮组 radius）
  for (const hp of body.movementHardpoints) {
    const wheelDefId =
      (hp.id === 'rear' ? draft.rearWheelDefId : draft.frontWheelDefId) ?? 'wheelStd';
    const wheel = registry.movements.get(wheelDefId);
    const r =
      (hp.id === 'rear' ? draft.rearRadius : draft.frontRadius) || wheel?.radius || 0;
    if (!wheel) continue;
    items.push({
      key: `wheel:${hp.id}`,
      kind: 'wheel',
      defId: wheel.id,
      name: wheel.name,
      visualId: wheel.visual?.visualId ?? null,
      cx: hp.localPosition.x,
      cy: hp.localPosition.y,
      w: r * 2,
      h: r * 2,
      round: true,
      layer: wheel.visual?.layer ?? 0,
      onWeaponSlot: false,
    });
  }

  // ③ 功能部件：有 visual → 用正式 size/anchor；无 visual → 真实 Collider 外接框
  for (const hp of body.functionalHardpoints) {
    const defId = draft.functionalSelections[hp.id] ?? EMPTY_SLOT;
    if (defId === EMPTY_SLOT) continue;
    const def = registry.functionals.get(defId);
    if (!def) continue;
    const onSlot = hp.id === WEAPON_SLOT;
    if (def.visual) {
      items.push({
        key: `part:${hp.id}`,
        kind: 'part',
        defId: def.id,
        name: def.name,
        visualId: def.visual.visualId,
        cx: hp.localPosition.x + def.visual.anchor.x,
        cy: hp.localPosition.y + def.visual.anchor.y,
        w: def.visual.size.width,
        h: def.visual.size.height,
        round: false,
        layer: def.visual.layer,
        onWeaponSlot: onSlot,
      });
    } else {
      const g = colliderGeom(def.collider);
      items.push({
        key: `part:${hp.id}`,
        kind: 'part',
        defId: def.id,
        name: def.name,
        visualId: null,
        cx: hp.localPosition.x + g.dx,
        cy: hp.localPosition.y + g.dy,
        w: g.w,
        h: g.h,
        round: g.round,
        layer: 0,
        onWeaponSlot: onSlot,
      });
    }
  }

  if (items.length === 0) return { ...EMPTY_LAYOUT, bodyName: body.name };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const it of items) {
    minX = Math.min(minX, it.cx - it.w / 2);
    maxX = Math.max(maxX, it.cx + it.w / 2);
    minY = Math.min(minY, it.cy - it.h / 2);
    maxY = Math.max(maxY, it.cy + it.h / 2);
  }
  const nativeW = Math.max(1, maxX - minX);
  const nativeH = Math.max(1, maxY - minY);
  // 同时满足「横向目标宽」与「最大高度」——取更严格的那个，绝不强撑越界
  const scale = Math.min(PREVIEW_FIT_W / nativeW, PREVIEW_MAX_H / nativeH);
  const stageH = Math.round(nativeH * scale) + 24;

  return { items, minX, minY, maxX, maxY, scale, stageW: PREVIEW_STAGE_W, stageH, bodyName: body.name };
}
