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
 *
 * ── PRODUCT-LOOP-R3-MOVEMENT-EQUIP-PREVIEW｜轮径的**唯一正确出处** ─────────────
 * 轮子在预览里画多大，取的是**该挂点生效 Movement def 自身的 `radius`**
 * （`runMovementCanonical.effectiveMovementRadius`，真源 = `registry.movements`）。
 *
 * ⚠️ **刻意不读** `BuildDraft.rearRadius` / `frontRadius`，也**不读** `runtimeNumbers.radius`：
 *    前者会残留上一件轮组的数值（切回缺省轮时 `equipMovement` 只删 defId 键、保留 radius），
 *    后者含 `overrides` —— 而陈旧 `radius` 正是经 `overrides.radius` 覆盖 def 半径传下来的。
 *    两者都会让「标准轮」被画成小轮尺寸。实测与修复见
 *    `tests/productMovementEquipPreview.test.ts` 的 MV-08 / MV-08b / MV-09。
 *
 * ⇒ 由此「换轮子 → 轮子外观尺寸直接变化」由**数据**保证，不需要任何 UI 补偿；
 *   前后轮各读各的 def ⇒ 天然可以尺寸不同（必改 3）；
 *   三态由链路天然给出：`undefined` → 缺省轮 def（缺省轮视觉）·
 *   `'none'` → 该槽 `effectiveDefId === null` ⇒ **不画轮子** · `defId` → 该 def 真实轮径。
 */

import { registry } from '../core/content';
import { EMPTY_SLOT, type BuildDraft } from '../lab/buildEditorModel';
import { WEAPON_SLOT } from './playerLoadout';
// PRODUCT-LOOP-R3-MOVEMENT-EQUIP-PREVIEW｜轮径走**正式链路**读数（与 Product Run 同源）。
import { effectiveMovementRadius, movementMapping } from './runMovementCanonical';
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

  // ② 轮子：center = movementHardpoint.localPosition；半径取**真实生效轮径**
  /*
    ⚠️ PRODUCT-LOOP-R3-MOVEMENT-EQUIP-PREVIEW｜轮径必须来自**真实生效的那一件 Movement**，
       不能优先信任 `draft.rearRadius` / `frontRadius` 这两个数值字段。

    为什么（本 Queue 实测出来的真实缺陷）：`rearRadius` / `frontRadius` 是 Build 的**数值**
    字段，与 `rearWheelDefId` / `frontWheelDefId` 是**两个可以各自漂移的字段**。
    `equipMovement()` 正常路径会把两者同步（52 vs 24 能正确显示），但存在一条真实路径
    使它们分叉：**切回缺省轮时只删键、保留 radius**（`playerLoadout.equipMovement`
    的缺省轮分支）⇒ `rearRadius` 残留上一件轮组的半径。实测（本轮探针）：

        [T4] rear=smallWheel   → rearRadius=12 → 预览 wheel:rear = 24x24  ✅
        [T5] 切回缺省轮         → rearWheelDefId 已删除，rearRadius 仍 = 12
                                 预览 wheel:rear = 24x24  ❌ 标准轮应为 40x40

    ⇒ 玩家看到「标准轮」却是小轮尺寸。修复口径 = **以 Movement def 为准**：
    半径取自 `effectiveMovementRadius(draft, hp.id)`（真源 = `registry.movements` 的
    `def.radius`）—— 与卡片刻度、Run Snapshot 的 `movements[].defId` 同一个真源
    ⇒ 预览与 **Product Run 消费的是同一份数据**（验收 4），
    且「前后轮尺寸不同」由各自 def 独立决定（必改 3）。

    ⚠️ **不要**把这里改回 `runtimeNumbers.radius`：`buildSnapshotFromDraft` 会把
    `BuildDraft.rearRadius` / `frontRadius` 作为 `overrides.radius` 写进 movements，
    `applyMovementOverrides` 再做 `{ ...def, ...overrides }` ⇒ 陈旧 radius 会**覆盖**
    def 自身半径（这正是本轮缺陷的第二级传播）。`effectiveMovementRadius` 刻意只读
    `def.radius` 就是为了斩断这条链路（实测：改回 `runtimeNumbers` 时 MV-08 红）。

    三态由既有链路天然给出（必改 4）：
      `undefined` → 缺省轮（def = wheelStd）⇒ 缺省轮视觉；
      `'none'`    → `movementMapping` 的该槽 `effectiveDefId === null` ⇒ 该挂点无轮；
      `defId`     → 该 def 的真实 radius。
  */
  const mapping = movementMapping(draft);
  for (const hp of body.movementHardpoints) {
    const slot = mapping.slots.find((s) => s.hardpointId === hp.id);
    const wheelDefId = slot?.effectiveDefId ?? null;
    // 该槽明确卸下 / 没有装载 Movement ⇒ **不画轮子**（不是画一个 0 半径或猜一个半径）
    if (wheelDefId === null) continue;
    const wheel = registry.movements.get(wheelDefId);
    if (!wheel) continue;
    /*
      生效半径取 **def 自身**（`effectiveMovementRadius`），**不**读 `draft.rearRadius`、
      也不读 `runtimeNumbers.radius` —— 后两者都会带上可能陈旧的 `overrides`。
      详见 `runMovementCanonical.effectiveMovementRadius` 上的实测说明。
    */
    const r = effectiveMovementRadius(draft, hp.id)?.radius ?? wheel.radius;
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
