/**
 * UX-BAG-VISUAL-FUSION-R2｜**部件图标**（Garage 图标化背包 / 合成工作台的视觉件）。
 *
 * ── 它回答什么问题 ──────────────────────────────────────────────────────────
 *   真人反馈（2026-10-14 录屏 + GPT 生产构建截图复核）：「合成仍无装备形状、是文字列表」、
 *   「一眼认出装备」做不到。本模块给每个部件一个**可识别图形**：
 *
 *   ① **有正式美术的用真美术**：`assets/visuals/` 里真实存在的 5 张 PNG
 *      （body_watermelon / body_banana / part_cannon / part_hammer / part_pushRod）
 *      —— 与战斗 / Run Page 引用的是**同一批资源**（`SPRITE_URLS` 同源）；
 *   ② **没有美术的按真实内容数据画简化矢量图**：炮 / 机枪 / 喷火 / 霰弹 / 镭射 / 圆锯 /
 *      锤 / 刺 / 冲锤 / 推杆 / 推进器 / 反推器 / 8 台车身 / 4 档轮组 ——
 *      轮廓全部取自 `registry` 的**真实 collider / radius / mass**（例如圆锯真的是正圆、
 *      轮径 12/20/26 真的是三个不同大小的圆、西瓜车身真的是 170×50 的宽扁矩形），
 *      **不伪造真实 Sprite**（无美术时不假装有美术，只画可辨的简化形状）。
 *
 * ── 硬边界 ────────────────────────────────────────────────────────────────
 *   - 本模块**只读** `../core/content`（registry）+ 5 张 PNG，零写、零存档、零产品逻辑；
 *   - 不新增任何部件 / 数值 / 属性 —— 图形的**比例参数**来自真实 def，但不是战斗力读数；
 *   - 不 import 页面 / Runtime / 平台（PL-26 白名单闭集内，见测试登记）；
 *     平台绑定由入口页 `homePage.ts` 的第一个 import 完成，本模块不碰存储。
 */

import bodyWatermelonUrl from '../../assets/visuals/body_watermelon.png';
import bodyBananaUrl from '../../assets/visuals/body_banana.png';
import partCannonUrl from '../../assets/visuals/part_cannon.png';
import partHammerUrl from '../../assets/visuals/part_hammer.png';
import partPushRodUrl from '../../assets/visuals/part_pushRod.png';

import { registry } from '../core/content';
import type { ColliderDef } from '../core/types';

/** 正式 visualId → 正式资源 URL（与战斗 / Run Page 同一批 PNG）。 */
const SPRITE_URLS: Readonly<Record<string, string>> = {
  body_watermelon: bodyWatermelonUrl,
  body_banana: bodyBananaUrl,
  part_cannon: partCannonUrl,
  part_hammer: partHammerUrl,
  part_pushRod: partPushRodUrl,
};

/** 部件大类（与 Garage 的槽位分类同名）。 */
export type PartIconKind = 'weapon' | 'body' | 'movement' | 'gadget';

/** visualId → 正式 PNG URL（`undefined` = 该件没有真美术 ⇒ 走矢量图）。 */
export function partSpriteUrl(visualId: string | undefined | null): string | undefined {
  return visualId ? SPRITE_URLS[visualId] : undefined;
}

/** defId → registry 里的 visualId（真源；没有 visual 定义的部件返回 undefined）。 */
function visualIdOf(kind: PartIconKind, defId: string): string | undefined {
  if (kind === 'body') return registry.bodies.get(defId)?.visual?.visualId;
  if (kind === 'movement') return undefined; // 轮组没有任何 visual 定义（全是矢量图标）
  return registry.functionals.get(defId)?.visual?.visualId;
}

/* --------------------------------------- 矢量图：公共骨架 */

/** 图标画布（viewBox）。所有图形都画在这个坐标系里，再由 CSS 缩放到卡面。 */
const VB_W = 64;
const VB_H = 48;

/** 简化矢量图的两档颜色（与页面暗色底高对比；不是任何读数）。 */
const V_FILL = '#31435c';
const V_EDGE = '#9fb4cc';
const V_ACCENT = '#ffd35a';

function svgWrap(inner: string, label: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${VB_W} ${VB_H}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  svg.setAttribute('focusable', 'false');
  svg.innerHTML = inner;
  return svg;
}

/* --------------------------------------- 矢量图：武器 / Gadget */

/**
 * 武器 / Gadget 简化图形：按 **behavior 家族**画彼此可辨的轮廓。
 * ⚠️ 家族形状是**展示层简化**（炮=粗短炮管、机枪=细长枪管+弹箱、圆锯=真圆刃…），
 *    比例参考真实 collider 尺寸（如锤 60×14 ⇒ 长柄小头、炮 40×20 ⇒ 粗短炮管），
 *    但**不参与任何计算** —— 图形大小与战斗力无关。
 */
function weaponGlyph(defId: string): string {
  switch (defId) {
    case 'cannon':
      // 真实 collider 40×20（粗短）⇒ 粗炮管 + 炮口环
      return (
        `<rect x="8" y="18" width="30" height="13" rx="3" fill="${V_FILL}" stroke="${V_EDGE}" stroke-width="1.5"/>` +
        `<rect x="37" y="13" width="7" height="23" rx="2.5" fill="${V_FILL}" stroke="${V_EDGE}" stroke-width="1.5"/>` +
        `<circle cx="40.5" cy="24.5" r="3.2" fill="none" stroke="${V_ACCENT}" stroke-width="1.6"/>` +
        `<rect x="2" y="20" width="7" height="9" rx="1.5" fill="#22304a" stroke="${V_EDGE}" stroke-width="1.2"/>`
      );
    case 'machineGun':
      // 真实 collider 40×16（细长）⇒ 细枪管 + 弹箱 + 连发刻度
      return (
        `<rect x="9" y="20" width="36" height="5" rx="2" fill="${V_FILL}" stroke="${V_EDGE}" stroke-width="1.4"/>` +
        `<rect x="11" y="26" width="14" height="11" rx="2" fill="#22304a" stroke="${V_EDGE}" stroke-width="1.2"/>` +
        `<rect x="34" y="15" width="2.4" height="5" fill="${V_ACCENT}"/>` +
        `<rect x="39" y="13" width="2.4" height="7" fill="${V_ACCENT}"/>` +
        `<rect x="44" y="15" width="2.4" height="5" fill="${V_ACCENT}"/>`
      );
    case 'flamethrower':
      // 真实 collider 30×18（短粗喷嘴）⇒ 喷嘴 + 火焰流
      return (
        `<rect x="8" y="19" width="17" height="11" rx="2" fill="${V_FILL}" stroke="${V_EDGE}" stroke-width="1.4"/>` +
        `<path d="M25 21 L33 18 L33 31 L25 28 Z" fill="#22304a" stroke="${V_EDGE}" stroke-width="1.2"/>` +
        `<path d="M34 24 L44 20 L44 29 Z" fill="#e05a4e"/>` +
        `<path d="M38 24 L50 21.5 L50 26.5 Z" fill="${V_ACCENT}"/>`
      );
    case 'shotgun':
      // 真实 collider 46×22（一次齐射多弹）⇒ 双短枪管
      return (
        `<rect x="4" y="19" width="8" height="11" rx="1.5" fill="#22304a" stroke="${V_EDGE}" stroke-width="1.2"/>` +
        `<rect x="11" y="16" width="30" height="5.5" rx="2" fill="${V_FILL}" stroke="${V_EDGE}" stroke-width="1.4"/>` +
        `<rect x="11" y="26.5" width="30" height="5.5" rx="2" fill="${V_FILL}" stroke="${V_EDGE}" stroke-width="1.4"/>` +
        `<circle cx="43" cy="18.7" r="2" fill="${V_ACCENT}"/>` +
        `<circle cx="43" cy="29.2" r="2" fill="${V_ACCENT}"/>`
      );
    case 'laser':
      // 真实 collider 40×20 ⇒ 细长发射杆 + 光束
      return (
        `<rect x="8" y="21.5" width="32" height="5" rx="2" fill="${V_FILL}" stroke="${V_EDGE}" stroke-width="1.4"/>` +
        `<circle cx="43" cy="24" r="4" fill="none" stroke="${V_ACCENT}" stroke-width="1.8"/>` +
        `<circle cx="43" cy="24" r="1.4" fill="${V_ACCENT}"/>` +
        `<line x1="48" y1="24" x2="60" y2="24" stroke="${V_ACCENT}" stroke-width="1.6" stroke-dasharray="3 2.4"/>`
      );
    case 'saw':
      // 真实 collider = circle r=28（唯一正圆武器）⇒ 圆刃 + 齿 + 轴心
      return (
        `<g>` +
        Array.from({ length: 8 }, (_, i) => {
          const a = (i / 8) * Math.PI * 2;
          const x1 = 36 + Math.cos(a) * 15.5;
          const y1 = 24 + Math.sin(a) * 15.5;
          const x2 = 36 + Math.cos(a + 0.19) * 15.5;
          const y2 = 24 + Math.sin(a + 0.19) * 15.5;
          const x3 = 36 + Math.cos(a + 0.095) * 20;
          const y3 = 24 + Math.sin(a + 0.095) * 20;
          return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} L${x3.toFixed(1)} ${y3.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)} Z" fill="${V_FILL}" stroke="${V_EDGE}" stroke-width="1"/>`;
        }).join('') +
        `<circle cx="36" cy="24" r="15.5" fill="none" stroke="${V_EDGE}" stroke-width="1.6"/>` +
        `<circle cx="36" cy="24" r="4" fill="${V_ACCENT}" stroke="${V_EDGE}" stroke-width="1.2"/>` +
        `<rect x="2" y="20.5" width="12" height="7" rx="1.5" fill="#22304a" stroke="${V_EDGE}" stroke-width="1.2"/>` +
        `</g>`
      );
    case 'hammer':
      // 真实 collider 60×14（长柄）⇒ 柄 + 头部锤体
      return (
        `<rect x="6" y="22" width="30" height="4" rx="1.5" fill="#22304a" stroke="${V_EDGE}" stroke-width="1.2"/>` +
        `<rect x="35" y="12" width="13" height="24" rx="2.5" fill="${V_FILL}" stroke="${V_EDGE}" stroke-width="1.5"/>` +
        `<line x1="35" y1="18" x2="48" y2="18" stroke="${V_ACCENT}" stroke-width="1.4"/>` +
        `<line x1="35" y1="30" x2="48" y2="30" stroke="${V_ACCENT}" stroke-width="1.4"/>`
      );
    case 'spear':
      // 真实 collider = 长三角形（90 长）⇒ 长刺
      return (
        `<rect x="4" y="22.5" width="34" height="3" rx="1.5" fill="#22304a" stroke="${V_EDGE}" stroke-width="1.1"/>` +
        `<path d="M38 24 L60 19.5 L60 28.5 Z" fill="${V_FILL}" stroke="${V_EDGE}" stroke-width="1.4"/>` +
        `<path d="M38 24 L54 21.8 L54 26.2 Z" fill="${V_ACCENT}" opacity="0.85"/>`
      );
    case 'rammer':
      // 真实 collider 30×22（钝头）⇒ 冲撞头 + 连接板
      return (
        `<rect x="10" y="15" width="14" height="18" rx="2.5" fill="${V_FILL}" stroke="${V_EDGE}" stroke-width="1.5"/>` +
        `<rect x="26" y="19" width="20" height="10" rx="2" fill="#22304a" stroke="${V_EDGE}" stroke-width="1.2"/>` +
        `<line x1="14" y1="19" x2="14" y2="29" stroke="${V_ACCENT}" stroke-width="1.4"/>` +
        `<line x1="19" y1="19" x2="19" y2="29" stroke="${V_ACCENT}" stroke-width="1.4"/>`
      );
    case 'pushRod':
      // 真实 collider 80×12（最长最细）⇒ 长细杆 + 端头
      return (
        `<rect x="6" y="22" width="46" height="4.5" rx="2" fill="${V_FILL}" stroke="${V_EDGE}" stroke-width="1.3"/>` +
        `<circle cx="55" cy="24.2" r="4" fill="none" stroke="${V_ACCENT}" stroke-width="1.6"/>` +
        `<rect x="2" y="20" width="6" height="9" rx="1.5" fill="#22304a" stroke="${V_EDGE}" stroke-width="1.1"/>`
      );
    case 'thruster':
      // 真实 collider 30×24 ⇒ 喷口 + 向后（左）火焰 —— 过远→前冲
      return (
        `<rect x="24" y="15" width="16" height="18" rx="2.5" fill="${V_FILL}" stroke="${V_EDGE}" stroke-width="1.5"/>` +
        `<path d="M24 19 L18 16.5 L18 31.5 L24 29 Z" fill="#22304a" stroke="${V_EDGE}" stroke-width="1.2"/>` +
        `<path d="M17 24 L6 20 L6 28 Z" fill="#e05a4e"/>` +
        `<path d="M15 24 L9 22 L9 26 Z" fill="${V_ACCENT}"/>` +
        `<rect x="42" y="19" width="5" height="10" rx="1.5" fill="#22304a" stroke="${V_EDGE}" stroke-width="1.1"/>`
      );
    case 'reverseThruster':
      // 同一机制的另一种 mode（near→后撤）⇒ 喷口同侧、火焰朝前（右）—— 与推进器可辨
      return (
        `<rect x="14" y="15" width="16" height="18" rx="2.5" fill="${V_FILL}" stroke="${V_EDGE}" stroke-width="1.5"/>` +
        `<path d="M30 19 L36 16.5 L36 31.5 L30 29 Z" fill="#22304a" stroke="${V_EDGE}" stroke-width="1.2"/>` +
        `<path d="M37 24 L48 20 L48 28 Z" fill="#e05a4e"/>` +
        `<path d="M39 24 L45 22 L45 26 Z" fill="${V_ACCENT}"/>` +
        `<rect x="6" y="19" width="5" height="10" rx="1.5" fill="#22304a" stroke="${V_EDGE}" stroke-width="1.1"/>`
      );
    default: {
      // 兜底：按真实 collider 尺寸画一个通用件（不伪造特定形状）
      const c = registry.functionals.get(defId)?.collider;
      const w = c && c.shape === 'box' ? Math.min(40, Math.max(14, c.width ?? 24)) : 24;
      const h = c && c.shape === 'box' ? Math.min(24, Math.max(10, c.height ?? 14)) : 14;
      const x = (VB_W - w) / 2;
      const y = (VB_H - h) / 2;
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2.5" fill="${V_FILL}" stroke="${V_EDGE}" stroke-width="1.5"/>`;
    }
  }
}

/* --------------------------------------- 矢量图：车身 */

/**
 * 车身简化图形 = **真实 collider 轮廓**（box→矩形 / polygon→多边形 / circle→圆，
 * 多 collider 全部画出，如香蕉/梨是两段）+ 底部两枚装饰小轮（让它读作「车」而不是武器）。
 * ⚠️ 轮廓比例来自真实 def（西瓜 170×50 宽扁、菠萝 88×112 高耸…）⇒ 八台彼此可辨；
 *    装饰小轮不是 Body 数据（Body 不含轮子），只是简化图示，不参与任何计算。
 */
function bodyGlyph(defId: string): string {
  const def = registry.bodies.get(defId);
  if (!def || def.colliders.length === 0) {
    return `<rect x="18" y="14" width="28" height="20" rx="3" fill="${V_FILL}" stroke="${V_EDGE}" stroke-width="1.5"/>`;
  }
  // 真实 collider 包围盒 → 图标区（留出底部轮子带）
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of def.colliders) extendBounds(c, (x0, y0, x1, y1) => {
    minX = Math.min(minX, x0);
    minY = Math.min(minY, y0);
    maxX = Math.max(maxX, x1);
    maxY = Math.max(maxY, y1);
  });
  const areaW = 56;
  const areaH = 30;
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const s = Math.min(areaW / spanX, areaH / spanY);
  const offX = (VB_W - spanX * s) / 2 - minX * s;
  const offY = 6 + (areaH - spanY * s) / 2 - minY * s;
  const shapes = def.colliders
    .map((c) => colliderPath(c, s, offX, offY))
    .join('');
  return (
    shapes +
    `<circle cx="20" cy="41" r="4.5" fill="#22304a" stroke="${V_EDGE}" stroke-width="1.3"/>` +
    `<circle cx="44" cy="41" r="4.5" fill="#22304a" stroke="${V_EDGE}" stroke-width="1.3"/>`
  );
}

/** collider 包围盒回调（box / circle / polygon 三种真实形状）。 */
function extendBounds(c: ColliderDef, visit: (x0: number, y0: number, x1: number, y1: number) => void): void {
  const ox = c.offset.x;
  const oy = c.offset.y;
  if (c.shape === 'box') {
    const w = (c.width ?? 0) / 2;
    const h = (c.height ?? 0) / 2;
    visit(ox - w, oy - h, ox + w, oy + h);
  } else if (c.shape === 'circle') {
    const r = c.radius ?? 0;
    visit(ox - r, oy - r, ox + r, oy + r);
  } else if (c.shape === 'polygon' && c.vertices) {
    for (const v of c.vertices) visit(ox + v.x, oy + v.y, ox + v.x, oy + v.y);
  }
}

/** collider → 缩放平移后的 SVG 图元（真实形状，不重画）。 */
function colliderPath(c: ColliderDef, s: number, offX: number, offY: number): string {
  const px = (x: number): string => (offX + x * s).toFixed(1);
  const py = (y: number): string => (offY + y * s).toFixed(1);
  const common = `fill="${V_FILL}" stroke="${V_EDGE}" stroke-width="1.4"`;
  if (c.shape === 'box') {
    const w = (c.width ?? 0) * s;
    const h = (c.height ?? 0) * s;
    const x = offX + (c.offset.x - (c.width ?? 0) / 2) * s;
    const y = offY + (c.offset.y - (c.height ?? 0) / 2) * s;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="2" ${common}/>`;
  }
  if (c.shape === 'circle') {
    const r = (c.radius ?? 0) * s;
    return `<circle cx="${px(c.offset.x)}" cy="${py(c.offset.y)}" r="${r.toFixed(1)}" ${common}/>`;
  }
  if (c.shape === 'polygon' && c.vertices && c.vertices.length >= 3) {
    const pts = c.vertices.map((v) => `${px(c.offset.x + v.x)},${py(c.offset.y + v.y)}`).join(' ');
    return `<polygon points="${pts}" ${common}/>`;
  }
  return '';
}

/* --------------------------------------- 矢量图：轮组 */

/**
 * 轮组简化图形 = 真实 `radius` 决定的圆（12/20/26 ⇒ 三个不同大小的轮子）
 * + 轴心 + 辐条；`mass ≥ 20`（重型轮组）画双圈 —— 全部来自真实 def 字段。
 */
function wheelGlyph(defId: string): string {
  const def = registry.movements.get(defId);
  const radius = def?.radius ?? 20;
  // radius 12..26 → 图标半径 6.5..13.5（等比，不伪造第四档）
  const r = 6.5 + ((radius - 12) / 14) * 7;
  const cx = VB_W / 2;
  const cy = VB_H / 2 + 1;
  const heavy = (def?.mass ?? 0) >= 20;
  const spokes = Array.from({ length: 4 }, (_, i) => {
    const a = (i / 4) * Math.PI;
    return `<line x1="${(cx - Math.cos(a) * (r - 2)).toFixed(1)}" y1="${(cy - Math.sin(a) * (r - 2)).toFixed(1)}" x2="${(cx + Math.cos(a) * (r - 2)).toFixed(1)}" y2="${(cy + Math.sin(a) * (r - 2)).toFixed(1)}" stroke="${V_EDGE}" stroke-width="1.1"/>`;
  }).join('');
  return (
    `<circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="${V_FILL}" stroke="${V_EDGE}" stroke-width="1.6"/>` +
    (heavy ? `<circle cx="${cx}" cy="${cy}" r="${(r - 3).toFixed(1)}" fill="none" stroke="${V_ACCENT}" stroke-width="1.2"/>` : '') +
    spokes +
    `<circle cx="${cx}" cy="${cy}" r="2.6" fill="${V_ACCENT}" stroke="${V_EDGE}" stroke-width="1"/>`
  );
}

/* --------------------------------------- 入口 */

/**
 * 部件图标节点：有真美术 ⇒ `<img>`（正式 PNG）；否则 ⇒ 内联简化矢量 SVG。
 * ⚠️ 两种分支都带同一组 `data-ph-part-icon*` 探针（E2E 可分别取证）：
 *    `data-ph-part-icon` = defId；`data-ph-part-icon-kind` = 四大类；
 *    `data-ph-part-icon-src` = `'sprite' | 'vector'`（真美术还是简化矢量，如实标注）。
 */
export function partIconNode(kind: PartIconKind, defId: string, label?: string): HTMLElement {
  const url = partSpriteUrl(visualIdOf(kind, defId));
  if (url) {
    const img = document.createElement('img');
    img.className = 'ph-part-icon';
    img.src = url;
    img.alt = label ?? defId;
    img.draggable = false;
    img.dataset['phPartIcon'] = defId;
    img.dataset['phPartIconKind'] = kind;
    img.dataset['phPartIconSrc'] = 'sprite';
    return img;
  }
  const svg = svgWrap(
    kind === 'body' ? bodyGlyph(defId) : kind === 'movement' ? wheelGlyph(defId) : weaponGlyph(defId),
    label ?? defId,
  );
  svg.classList.add('ph-part-icon');
  svg.dataset['phPartIcon'] = defId;
  svg.dataset['phPartIconKind'] = kind;
  svg.dataset['phPartIconSrc'] = 'vector';
  return svg as unknown as HTMLElement;
}
