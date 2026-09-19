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
/**
 * PRODUCT-LOOP-R1-B｜领奖闭环的两块产品侧拼图：
 *   - `runReward.ts`：奖励策略 + **产品地址唯一真源**（`开始冒险` 的 href 由它产出）；
 *   - `playerProfile.ts`：**Profile Repository** —— 本页**唯一**允许触碰持久化状态的地方。
 *
 * ⚠️ 本页自己**不碰** `localStorage` / `platform.storage`（必改 1：UI 不得直接读写 localStorage），
 *    这条由 `tests/productLoopRunReward.test.ts` 的 `PR-20` 源码守卫机器钉死。
 */
import {
  REWARD_WEAPON_ID,
  buildAdventureHref,
  newRunToken,
  parsePendingClaim,
  type PendingClaim,
} from './runReward';
import { claimRunReward, claimedRunCount, type ClaimOutcome } from './playerProfile';

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
/**
 * `开始冒险` 的目的地：**不再是页面里的字面量**。
 *
 * PRODUCT-LOOP-R1-B 起该地址由 `runReward.ts` 的 `buildAdventureHref()` 产出
 * （带本局 token / 奖励 id / 回程地址），产品 URL 只在那一个模块里出现一次
 * （`tests/productLoopRunReward.test.ts` 的 `PR-21` 机器钉死）。
 */
/** 领奖提示文案（本页只展示 Repository 的**真实**结果，不做乐观提示）。 */
export const CLAIM_OK_LEAD = '已获得';
export const CLAIM_DUPLICATE_TEXT = '本局奖励已领取过（不会重复发放）。';
export const CLAIM_FAIL_TEXT = '本局奖励未能入库';
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
  /**
   * PRODUCT-LOOP-R1-B｜本页**本局**的 token（幂等键）与它对应的冒险地址。
   * ⚠️ 每次挂载生成一次（= 一次新的「准备出发」）⇒ 同一 token 只可能领一次奖。
   */
  readonly runToken: string;
  readonly adventureHref: string;
  /**
   * 本次挂载是否处理了一次**领奖请求**（`null` = 玩家是正常打开首页，不是带着奖励回来的）。
   * ⚠️ 直接来自 Profile Repository 的**真实**结果 —— 页面不猜、不乐观提示。
   */
  readonly claim: {
    readonly ok: boolean;
    readonly reason: string | null;
    readonly defId: string | null;
    readonly name: string | null;
    readonly countAfter: number | null;
  } | null;
  /** 账本里已领取的局数（只读；用于 E2E 断言「重复领取没有新增记录」）。 */
  readonly claimedRunCount: number;
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

/**
 * 页面唯一入口（由 `home.html` 用 `<script type="module">` 加载）。
 *
 * PRODUCT-LOOP-R1-B 起多一个**可选**入参 `opts.search`：玩家从 Run 的「领取并返回」
 * 带着 `?run=…&reward=…` 回到本页时，入口壳把 `location.search` **原样**传进来，
 * 由本模块的纯函数 `parsePendingClaim` 解析 —— 因此本模块**不读 `location`**
 * （保持可在 node 下单测、保持零跳转逻辑）。
 *
 * ⚠️ 领奖在**挂载时同步执行一次**（`claimRunReward`），结果只展示、不重试、不排队：
 *    重复进入同一个领奖 URL ⇒ Repository 返回 `already-claimed` ⇒ 页面如实说「已领取过」，
 *    库存**不会**再 +1（必改 4：重复点击 / 重复结算不允许重复发奖）。
 */
export function mountProductHome(
  root: HTMLElement,
  opts?: { readonly search?: string },
): ProductDebugHandle {
  // 唯一读入口：正式存档 → starter 回退；库存走正式 ensureInventory（幂等，不重复生成）
  let draft: BuildDraft = loadEquippedDraft();
  let inv: PartInventory = playerInventory(draft);
  let view: ProductView = 'home';
  let selectedWeaponId: string | null = null;
  let lastEquip: { ok: boolean; reason: EquipFailure | null; detail: string } | null = null;
  // 本局 token：**每次挂载一次**（刷新首页 = 准备新的一局，因此会换一个新 token）
  const runToken = newRunToken();
  /**
   * PRODUCT-LOOP-R1-C｜「开始冒险」的地址 = **当前这一份** `draft` 的实时投影。
   *
   * ⚠️ 必须是函数而不是挂载时算一次的常量：首页与「调整战车」是同一页面的两个视图，
   *    玩家可以「进车库 → 换武器 → 回首页 → 直接点开始冒险」（**不刷新**）。
   *    若沿用挂载时的旧地址，首页会显示新武器、而链接带的是旧装备
   *    ⇒ 正是 Queue 必改 2 禁止的「首页显示 A，战斗实际跑 B」。
   *    ⇒ 每次 `render()` 都重算，地址与屏幕上显示的那辆车**同一次读取**产出。
   */
  const adventureHrefNow = (): string => buildAdventureHref(runToken, REWARD_WEAPON_ID, draft);
  // 领奖请求：入口壳给的 `location.search` 原样解析（纯函数）→ **当场**交给 Repository 处理一次
  const pendingClaim: PendingClaim | null = parsePendingClaim(opts?.search ?? '');
  const claim: ClaimOutcome | null = pendingClaim ? claimRunReward(pendingClaim) : null;
  /**
   * ⚠️ PRODUCT-LOOP-R1-C｜**领奖之后必须重读局外状态**。
   *
   * 上面的 `draft` / `inv` 是在**领奖之前**读的；而领奖会往正式库存里写入新部件
   * （`playerProfile.claimRunReward` → `partInventory.addPart`）。若不重读，本次挂载
   * 手里的库存就是**领奖前的旧快照** ⇒ 玩家从 COMPLETE 点「领取并返回」落回本页后，
   * 「调整战车」里**看不到刚拿到的那件部件**，必须先手动刷新一次才行
   * —— 那正是 Queue 必改 4 要求打通的「领取 → 首页 → Garage 新奖励可见 → 装备」链路，
   * 所以这里不是优化而是**主循环阻断缺陷**的修复。
   *
   * 重读走的是同两个正式入口（`loadEquippedDraft` / `playerInventory`），**不新增数据源**；
   * `ensureInventory` 幂等 ⇒ 没有领到新部件时（`already-claimed` / 校验失败）重读是无副作用的空操作。
   */
  if (claim) {
    draft = loadEquippedDraft();
    inv = playerInventory(draft);
  }

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

  /**
   * PRODUCT-LOOP-R1-B｜领奖提示（**只陈述 Repository 的真实结果**）。
   *
   *   - 成功 → 「已获得：<正式部件名>（已进入车库）」，带 `data-ph-claim-def` 供 E2E 对账；
   *   - 重复 → 如实说「已领取过，不会重复发放」（不是静默忽略，也不是假装成功）；
   *   - 失败 → 带上 Repository 给出的**具体原因**（`not-weapon` / `not-equippable` / …）。
   */
  function claimNotice(): HTMLElement | null {
    if (!claim) return null;
    if (claim.ok && claim.grant) {
      const n = el('div', 'ph-claim ph-claim-ok', `${CLAIM_OK_LEAD}：${claim.grant.name}（已进入车库）`);
      n.dataset['phClaim'] = 'ok';
      n.dataset['phClaimDef'] = claim.grant.defId;
      return n;
    }
    if (claim.reason === 'already-claimed') {
      const n = el('div', 'ph-claim ph-claim-dim', CLAIM_DUPLICATE_TEXT);
      n.dataset['phClaim'] = 'duplicate';
      return n;
    }
    const n = el('div', 'ph-claim ph-claim-bad', `${CLAIM_FAIL_TEXT}（${String(claim.reason)}）`);
    n.dataset['phClaim'] = 'fail';
    return n;
  }

  /** 页头（两个视图共用）：标题 + 领奖提示（有才有）。 */
  function renderHeader(title: string): void {
    header.replaceChildren(el('h1', 'ph-title', title));
    const notice = claimNotice();
    if (notice) header.append(notice);
  }

  function renderHome(r: LoadoutReading): void {
    renderHeader(HOME_TITLE);

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
    // `开始冒险` 是同产物内的真实相对链接；地址由 `runReward.buildAdventureHref()` 产出
    // （带本局 token / 奖励 id / **当前这份装备** / 回程地址）—— 「打完一局 → 领奖 → 回首页」
    // 与「车库换装 → 下一局就用新装备」都靠同一个地址。
    const start = el('a', 'ph-btn ph-btn-start', HOME_START_LABEL);
    start.href = adventureHrefNow();
    start.dataset['phAction'] = 'start-run';
    start.dataset['phRunToken'] = runToken;
    actions.append(toGarage, start);
    stage.append(actions);

    stage.append(
      el(
        'p',
        'ph-note',
        '首页显示的主武器 = 下一局战斗里实际使用的装备（同一份正式玩家 Build 存档，随「开始冒险」交给 Run）。',
      ),
    );
    stage.append(
      el(
        'p',
        'ph-note',
        '打完一局（RUN COMPLETE）会获得一件永久部件；领回来后在「调整战车」里就能看到并装上。',
      ),
    );
  }

  function renderGarage(r: LoadoutReading): void {
    renderHeader(GARAGE_TITLE);
    header.append(el('span', 'ph-sub', `${r.weaponSlotLabel} · 当前主武器`));

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
        runToken,
        adventureHref: adventureHrefNow(),
        claim: claim
          ? {
              ok: claim.ok,
              reason: claim.reason,
              defId: claim.grant?.defId ?? null,
              name: claim.grant?.name ?? null,
              countAfter: claim.grant?.countAfter ?? null,
            }
          : null,
        claimedRunCount: claimedRunCount(),
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
