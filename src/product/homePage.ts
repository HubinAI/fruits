/**
 * PRODUCT-LOOP-R1-A-HOME-GARAGE-INVENTORY｜竖屏正式产品主循环第一段的**页面**。
 *
 * 首屏 = 「我的战车」首页；「调整战车」是**同一页面的另一个视图**（整页零跳转，
 * 与本分支既有玩家页面「单页多状态」的产品结构一致）。
 *
 *   `首页（看车 + 已装备） --[调整战车]--> 调整战车（选一个已拥有武器 → 装备） --[返回首页]--> 首页（同步变化）`
 *
 * 视图层职责边界（与既有页面同一套路）：
 *   - **不推导任何数据**：车身 / 耐久 / 能量 / 槽位 / 可装备武器 / 当前主武器，
 *     全部来自 `playerLoadout.ts`（唯一数据源）与 `vehiclePreview.ts`（纯几何）；
 *   - **不写存档**：写只发生在 `equipWeapon()` 内部（含 `validateSnapshot` 与 `savePlayerBuild`）；
 *   - **不新建 Runtime**：本页没有物理、没有战斗、没有相机、没有 Gameplay 状态机
 *     （`开始冒险` 只是同产物内的相对链接，本轮不改 Run —— 见 Queue 冻结项）。
 *
 * 视觉：竖屏 390×844 逻辑舞台（与 Run Page 同一口径），DOM 承载（**零画布**）。
 * 车辆预览用正式 `assets/visuals/*.png`（与战斗里同一批文件），缺图退化为灰色外接框并
 * 如实标注 —— 不伪造外形、不新增美术。
 */

import '../platform/bootstrap'; // 必须是第一个 import：绑定 Web PlatformCore（storage 等）

import bodyWatermelonUrl from '../../assets/visuals/body_watermelon.png';
import bodyBananaUrl from '../../assets/visuals/body_banana.png';
import partCannonUrl from '../../assets/visuals/part_cannon.png';
import partHammerUrl from '../../assets/visuals/part_hammer.png';
import partPushRodUrl from '../../assets/visuals/part_pushRod.png';

import type { BuildDraft } from '../lab/buildEditorModel';
import type { PartInventory } from '../core/partInventory';
import {
  WEAPON_SLOT,
  equipWeapon,
  loadEquippedDraft,
  loadoutReading,
  playerInventory,
  type EquipFailure,
  type LoadoutReading,
} from './playerLoadout';
import { vehiclePreviewLayout, type VehiclePreviewLayout } from './vehiclePreview';

/** 正式 visualId → 正式资源 URL（与战斗 / Run Page 引用的是同一批 PNG 文件）。 */
const SPRITE_URLS: Readonly<Record<string, string>> = {
  body_watermelon: bodyWatermelonUrl,
  body_banana: bodyBananaUrl,
  part_cannon: partCannonUrl,
  part_hammer: partHammerUrl,
  part_pushRod: partPushRodUrl,
};

export const HOME_TITLE = '我的战车';
export const HOME_GARAGE_LABEL = '调整战车';
export const HOME_START_LABEL = '开始冒险';
export const GARAGE_TITLE = '调整战车';
export const GARAGE_BACK_LABEL = '返回首页';
export const GARAGE_EQUIP_LABEL = '装备';
/** `开始冒险` 的目的地：同一构建产物内的既有玩家 Run 入口（相对路径，产物内可搬移）。 */
export const START_RUN_HREF = './run-page.html';
/** 正式逻辑舞台（与 Run Page 同口径）。 */
export const PRODUCT_STAGE_W = 390;
export const PRODUCT_STAGE_H = 844;
/**
 * 装备状态落盘的正式 key（**只读展示**：本页自己不碰 localStorage，
 * 写只发生在 `core/buildPersistence.ts` 内）。E2E 用它证明「装备写进了正式存档」。
 */
export const SAVE_KEY = 'strongfruit.playerBuild.v1';

export type ProductView = 'home' | 'garage';

export interface ProductProbe {
  readonly view: ProductView;
  readonly bodyName: string;
  readonly hp: number;
  readonly energy: number;
  readonly energyCapacity: number;
  readonly weaponSlot: string;
  readonly equippedWeaponId: string;
  readonly equippedWeaponName: string;
  readonly weaponIds: readonly string[];
  readonly weaponNames: readonly string[];
  readonly selectedWeaponId: string | null;
  readonly equipEnabled: boolean;
  readonly slots: readonly { readonly hardpointId: string; readonly defId: string; readonly name: string; readonly category: string | null; readonly editable: boolean }[];
  readonly previewItems: readonly { readonly key: string; readonly defId: string; readonly visualId: string | null; readonly onWeaponSlot: boolean }[];
  readonly previewSpriteCount: number;
  readonly previewFallbackCount: number;
  readonly startRunHref: string | null;
  readonly canvasCount: number;
  readonly buttonCount: number;
  readonly lastEquip: { readonly ok: boolean; readonly reason: EquipFailure | null } | null;
  readonly saveKey: string;
}

export interface ProductDebugHandle {
  probe(): ProductProbe;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** 把逻辑舞台缩放到容器（contain 语义：390×844 恒等比，只改 scale，不改布局口径）。 */
function fitStage(frame: HTMLElement, screen: HTMLElement): void {
  const s = Math.min(window.innerWidth / PRODUCT_STAGE_W, window.innerHeight / PRODUCT_STAGE_H);
  frame.style.width = `${PRODUCT_STAGE_W * s}px`;
  frame.style.height = `${PRODUCT_STAGE_H * s}px`;
  screen.style.transform = `scale(${s})`;
}

/**
 * 车辆预览（纯 DOM，零画布）：每个 item 一个绝对定位元素；
 * 有正式 sprite → `<img>`，无 → 按真实 Collider 外接框画灰盒并带 `data-ph-nosprite` 标注。
 *
 * 定位口径：元素以 `.ph-car` **盒心**为原点（`calc(50% + Δpx)`），Δ 由车体本地坐标 × `scale`
 * 得出（y 翻转：本地 y 向上、DOM y 向下）。盒子宽度与布局无关 ⇒ 不会被父级内边距挤偏。
 */
function renderPreview(layout: VehiclePreviewLayout): HTMLElement {
  const box = el('div', 'ph-car');
  box.dataset['phStageH'] = String(layout.stageH);
  box.style.height = `${layout.stageH}px`;
  const bx = (layout.minX + layout.maxX) / 2;
  const by = (layout.minY + layout.maxY) / 2;
  const ordered = [...layout.items].sort((a, b) => a.layer - b.layer);
  for (const it of ordered) {
    const url = it.visualId ? SPRITE_URLS[it.visualId] : undefined;
    const node = url ? el('img', 'ph-car-item') : el('div', 'ph-car-item ph-car-fallback');
    const w = it.w * layout.scale;
    const h = it.h * layout.scale;
    node.style.left = `calc(50% + ${(it.cx - bx) * layout.scale - w / 2}px)`;
    node.style.top = `calc(50% + ${-(it.cy - by) * layout.scale - h / 2}px)`;
    node.style.width = `${w}px`;
    node.style.height = `${h}px`;
    if (it.round) node.style.borderRadius = '50%';
    if (it.onWeaponSlot) node.classList.add('ph-car-weapon');
    node.dataset['phPreviewItem'] = it.key;
    node.dataset['phDefId'] = it.defId;
    if (url) {
      (node as HTMLImageElement).src = url;
      (node as HTMLImageElement).alt = it.name;
    } else {
      node.dataset['phNosprite'] = '1';
    }
    node.title = it.name;
    box.append(node);
  }
  return box;
}

/** 页面唯一入口（由 `home.html` 用 `<script type="module">` 加载）。 */
export function mountProductHome(root: HTMLElement): ProductDebugHandle {
  // 唯一读入口：正式存档 → starter 回退；库存走正式 ensureInventory（幂等，不重复生成）
  let draft: BuildDraft = loadEquippedDraft();
  let inv: PartInventory = playerInventory(draft);
  let view: ProductView = 'home';
  let selectedWeaponId: string | null = null;
  let lastEquip: { ok: boolean; reason: EquipFailure | null; detail: string } | null = null;

  /* -------------------------------------------------------------- 骨架 */

  const frame = el('div', 'ph-frame');
  const screen = el('div', 'ph-screen');
  screen.dataset['phScreen'] = '1';
  frame.append(screen);

  const header = el('header', 'ph-header');
  const stage = el('section', 'ph-main');
  screen.append(header, stage);

  root.append(frame);
  fitStage(frame, screen);
  window.addEventListener('resize', () => fitStage(frame, screen));

  /* ------------------------------------------------------------- 渲染 */

  function read(): LoadoutReading {
    return loadoutReading(draft, inv);
  }

  function renderHome(r: LoadoutReading): void {
    header.replaceChildren(el('h1', 'ph-title', HOME_TITLE));

    const car = el('div', 'ph-car-wrap');
    car.append(renderPreview(vehiclePreviewLayout(draft)));
    const spec = el('div', 'ph-spec');
    spec.append(
      el('span', 'ph-body', r.bodyName),
      el('span', 'ph-stat', `耐久 ${r.hp}`),
      el('span', 'ph-stat', `能量 ${r.energy}/${r.energyCapacity}`),
    );
    car.append(spec);
    stage.append(car);

    stage.append(el('h2', 'ph-sec', '已装备部件'));
    const list = el('ul', 'ph-slots');
    for (const s of r.slots) {
      const li = el('li', 'ph-slot');
      if (s.hardpointId === WEAPON_SLOT) li.classList.add('ph-slot-weapon');
      li.dataset['phSlot'] = s.hardpointId;
      li.dataset['phSlotDef'] = s.defId;
      const cat = s.category === 'weapon' ? '武器' : s.category === 'gadget' ? '辅助' : '';
      li.append(
        el('span', 'ph-slot-label', s.label),
        el('span', 'ph-slot-name', cat ? `${s.name}（${cat}）` : s.name),
      );
      if (s.hardpointId === WEAPON_SLOT) li.append(el('span', 'ph-slot-tag', '主武器'));
      list.append(li);
    }
    stage.append(list);

    const actions = el('div', 'ph-actions');
    const toGarage = el('button', 'ph-btn ph-btn-primary', HOME_GARAGE_LABEL);
    toGarage.type = 'button';
    toGarage.dataset['phAction'] = 'open-garage';
    toGarage.addEventListener('click', () => {
      view = 'garage';
      selectedWeaponId = null;
      render();
    });
    // `开始冒险` 是同产物内的真实相对链接；本轮不改 Run（Run 仍用自己的固定 demo loadout）
    const start = el('a', 'ph-btn ph-btn-start', HOME_START_LABEL);
    start.href = START_RUN_HREF;
    start.dataset['phAction'] = 'start-run';
    actions.append(toGarage, start);
    stage.append(actions);

    stage.append(
      el(
        'p',
        'ph-note',
        '首页显示的主武器 = 下一局准备使用的装备（写入正式玩家 Build 存档；本 Queue 尚未把它接进 Run）。',
      ),
    );
  }

  function renderGarage(r: LoadoutReading): void {
    header.replaceChildren(
      el('h1', 'ph-title', GARAGE_TITLE),
      el('span', 'ph-sub', `${r.weaponSlotLabel} · 当前主武器`),
    );

    const car = el('div', 'ph-car-wrap ph-car-wrap-sm');
    car.append(renderPreview(vehiclePreviewLayout(draft)));
    stage.append(car);

    const cur = el('div', 'ph-current');
    cur.dataset['phCurrent'] = r.equippedWeaponId;
    cur.append(
      el('span', 'ph-current-label', '当前 Weapon'),
      el('span', 'ph-current-name', r.equippedWeaponName),
    );
    stage.append(cur);

    stage.append(el('h2', 'ph-sec', `拥有的 Weapon（${r.weapons.length}）`));
    if (r.weapons.length === 0) {
      stage.append(el('p', 'ph-note', '库存里没有可装备的武器。'));
    }
    const grid = el('div', 'ph-grid');
    for (const w of r.weapons) {
      const card = el('button', 'ph-card');
      card.type = 'button';
      card.dataset['phWeapon'] = w.defId;
      card.dataset['phEquipped'] = String(w.defId === r.equippedWeaponId);
      if (w.defId === r.equippedWeaponId) card.classList.add('ph-card-equipped');
      if (w.defId === selectedWeaponId) card.classList.add('ph-card-selected');
      card.append(
        el('span', 'ph-card-name', w.name),
        el('span', 'ph-card-meta', `能量 ${w.energy} · 拥有 ×${w.count}`),
      );
      if (w.defId === r.equippedWeaponId) card.append(el('span', 'ph-card-tag', '已装备'));
      card.addEventListener('click', () => {
        selectedWeaponId = w.defId;
        render();
      });
      grid.append(card);
    }
    stage.append(grid);

    const actions = el('div', 'ph-actions');
    const equip = el('button', 'ph-btn ph-btn-primary', GARAGE_EQUIP_LABEL);
    equip.type = 'button';
    equip.dataset['phAction'] = 'equip';
    equip.disabled = selectedWeaponId === null;
    equip.addEventListener('click', () => {
      if (selectedWeaponId === null) return;
      const out = equipWeapon(selectedWeaponId, draft, inv);
      lastEquip = { ok: out.ok, reason: out.reason ?? null, detail: out.detail ?? '' };
      if (out.ok && out.draft) {
        draft = out.draft;
        // 库存不因装备而消耗；重读仍走正式 ensureInventory（幂等 → 不重复生成库存）
        inv = playerInventory(draft);
      }
      selectedWeaponId = null;
      render();
    });

    const back = el('button', 'ph-btn', GARAGE_BACK_LABEL);
    back.type = 'button';
    back.dataset['phAction'] = 'back-home';
    back.addEventListener('click', () => {
      view = 'home';
      selectedWeaponId = null;
      render();
    });
    actions.append(equip, back);
    stage.append(actions);

    if (lastEquip) {
      const msg = el(
        'p',
        lastEquip.ok ? 'ph-note ph-note-ok' : 'ph-note ph-note-bad',
        lastEquip.ok ? '已装备并写入正式玩家 Build 存档。' : `装备被拒绝（${lastEquip.reason}）：${lastEquip.detail}`,
      );
      msg.dataset['phEquipMsg'] = lastEquip.ok ? 'ok' : 'fail';
      stage.append(msg);
    }
  }

  function render(): void {
    screen.dataset['phView'] = view;
    stage.replaceChildren();
    const r = read();
    if (view === 'home') renderHome(r);
    else renderGarage(r);
  }

  render();

  /* -------------------------------------------------------------- 句柄 */

  const handle: ProductDebugHandle = {
    probe: () => {
      const r = read();
      const layout = vehiclePreviewLayout(draft);
      const start = stage.querySelector<HTMLAnchorElement>('[data-ph-action="start-run"]');
      const equipBtn = stage.querySelector<HTMLButtonElement>('[data-ph-action="equip"]');
      return {
        view,
        bodyName: r.bodyName,
        hp: r.hp,
        energy: r.energy,
        energyCapacity: r.energyCapacity,
        weaponSlot: r.weaponSlot,
        equippedWeaponId: r.equippedWeaponId,
        equippedWeaponName: r.equippedWeaponName,
        weaponIds: r.weapons.map((w) => w.defId),
        weaponNames: r.weapons.map((w) => w.name),
        selectedWeaponId,
        equipEnabled: !!equipBtn && !equipBtn.disabled,
        slots: r.slots.map((s) => ({
          hardpointId: s.hardpointId,
          defId: s.defId,
          name: s.name,
          category: s.category,
          editable: s.editable,
        })),
        previewItems: layout.items.map((i) => ({
          key: i.key,
          defId: i.defId,
          visualId: i.visualId,
          onWeaponSlot: i.onWeaponSlot,
        })),
        previewSpriteCount: layout.items.filter((i) => !!i.visualId && !!SPRITE_URLS[i.visualId]).length,
        previewFallbackCount: layout.items.filter((i) => !i.visualId || !SPRITE_URLS[i.visualId]).length,
        startRunHref: start ? start.getAttribute('href') : null,
        canvasCount: root.querySelectorAll('canvas').length,
        buttonCount: root.querySelectorAll('button').length,
        lastEquip: lastEquip ? { ok: lastEquip.ok, reason: lastEquip.reason } : null,
        saveKey: SAVE_KEY,
      };
    },
  };
  (globalThis as { __PRODUCTHOME__?: ProductDebugHandle }).__PRODUCTHOME__ = handle;

  return handle;
}

/* -------------------------------------------------------- 挂载（在入口壳） */

/**
 * ⚠️ 本模块**不自挂载**：与 `runPage.ts` / `runMain.ts` 同一分工 ——
 * 页面逻辑保持「可在 node 下 import（无模块级 DOM）」以便直接单测，
 * 真正的挂载在入口壳 `homeMain.ts`（由 `home.html` 加载）。
 * 唯一入口 = `mountProductHome(root)`（上方已导出）。
 */
