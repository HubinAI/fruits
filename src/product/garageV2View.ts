/**
 * GARAGE-V2-UX-RETURN-BAG-FUSE-R1｜正式页 Garage 2.0 装备/合成视图（【调整战车】默认入口）。
 *
 * ── 本轮做了什么（交互结构重做，不是数值微调）──────────────────────────────
 *   真人 102 秒实玩录屏三条硬伤 → 三条结构性修正：
 *     ① **返回按钮必须在画面内**：上一版 `.g2-bag-wrap` 不是 flex 列容器 ⇒ `.g2-bag`
 *        的 `flex/overflow` 全部失效 ⇒ 背包按内容撑高，把 footer 顶到 y=1198（画面外、
 *        外层 overflow:hidden ⇒ 点不到）。本版把外壳/滚动层两级的 flex + min-height:0
 *        都显式声明，footer 由 flex 固定占位；并**隐藏页面级 header**（V2 自带标题行，
 *        不再浪费 62px 上方空白）。
 *     ② **图标主导**：删除依赖浏览器窗口宽度的 `@media (min-width:430px) → 5 列`
 *        （逻辑画面恒 390，媒体查询看的是窗口 ⇒ 桌面被切成 5 列、图标压到 62%）；
 *        背包恒 4 列、图标 86%、锁定件不再灰到难认、角标/边框降权。
 *     ③ **合成改成同页合成模式**（不再是小遮罩里塞 44px 图标）：
 *        右上【合成】→ 直接铺开与装备背包**同规格 4 列大图标**候选（只列真实满足
 *        同部位+同品质≥5 的组）→ 单击主件 → 自动补 4 件材料并**明确标出被消耗者**
 *        → 底部固定区显示「主件 → 下一品质」→ 唯一【确认五合一】。
 *
 * ── 冻结（本模块**没有**动的东西）──────────────────────────────────────────
 *   - 七档品质 / 真实装备事务（`equipQualityProduct` / 旧 `equip*` 全家）/ 真实五合一
 *     （`fuseQualityFive`）/ 正式存档（`loadEquippedDraft` → 落盘）/ 战斗与奖励；
 *   - 旧限制一律不变：Body 不可消耗、旧 ★2..5 `legacy-star-locked`、装备中 `equipped`
 *     保护、彩封顶、非推进类 Gadget 不进合成组。
 *
 * ── 与 `garageV2Lab.ts` 的关系 ─────────────────────────────────────────────
 *   视觉结构同源，**数据完全不同源**：这里所有读写都走正式生产存档；
 *   **绝不** import `garageV2LabMain` / `seedLabFixture` / `bindPlatformCore` / 任何隔离内存 Map。
 */
import {
  QUALITY_LABELS,
  effectiveInventory,
  equipQualityProduct,
  fuseQualityFive,
  isMaxQuality,
  nextQuality,
  projectItemInstances,
  type ItemInstance,
  type ItemSlotKind,
  type QualityFuseResult,
  type QualityTier,
} from './garageV2Quality';
import { registry } from '../core/content';
import {
  equipBody,
  equipGadget,
  equipMovement,
  equipWeapon,
  loadEquippedDraft,
} from './playerLoadout';
import type { BuildDraft } from '../lab/buildEditorModel';
import { partIconNode } from './partIcon';
import { vehiclePreviewLayout, type VehiclePreviewLayout } from './vehiclePreview';

/* ────────────────────────── 常量 / 小工具 ────────────────────────── */

/** 五个穿戴槽（**同行**排列；左三右二的老两列布局吃掉两行高度，已删）。 */
const G2_SLOTS: readonly { key: string; kind: ItemSlotKind; label: string }[] = [
  { key: 'body', kind: 'body', label: '车身' },
  { key: 'weapon', kind: 'weapon', label: '武器' },
  { key: 'gadget', kind: 'gadget', label: '辅助' },
  { key: 'front', kind: 'movement', label: '前轮' },
  { key: 'rear', kind: 'movement', label: '后轮' },
];

/** 部位角标字（格子角落的微型标注；不是名字、不是数量）。 */
const SLOT_BADGE: Readonly<Record<ItemSlotKind, string>> = {
  weapon: '武',
  body: '身',
  movement: '轮',
  gadget: '辅',
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function elDiv(cls: string, text?: string): HTMLDivElement {
  return el('div', cls, text);
}

/* ────────────────────────── 页面状态 ────────────────────────── */

type G2Modal = {
  kind: 'compare';
  slotKey: string; // 'body' | 'weapon' | 'gadget' | 'front' | 'rear'
  slotKind: ItemSlotKind;
  candidate: ItemInstance;
  /** 装备失败的如实回显（不吞错）。 */
  toast?: string;
};

/** 同页两种模式（合成不再是遮罩弹窗）。 */
type G2Mode = 'equip' | 'fuse';

let draft: BuildDraft;
let modal: G2Modal | null = null;
let mode: G2Mode = 'equip';
let root: HTMLElement;
/** movement 对比弹窗的当前目标槽（模块级：rerender 重建后仍保持用户选择）。 */
let movementTargetPick: 'front' | 'rear' = 'rear';
/** 合成模式当前选中的主件实例 id（模块级：rerender 重建后仍保持用户选择）。 */
let fuseMainPick: string | null = null;
/** 装备页顶部提示（合成成功 / 失败如实回显）。 */
let flash: { ok: boolean; text: string } | null = null;
/** 合成成功后要高亮的产物实例 id（**一次**，后续 rerender 不再滚动）。 */
let pendingRevealId: string | null = null;
/** 合成产物在背包里的「刚出炉」金环高亮（持续到玩家下一次操作）。 */
let freshInstId: string | null = null;
/** 滚动位置记忆（列表 rerender 不滚回顶部；只在换模式时归零）。 */
let scrollMemo = 0;
let onClose: () => void = () => {};
/** 页面级 header（V2 自带标题行 ⇒ 进入时藏起来，返回时原样恢复）。 */
let pageHeader: HTMLElement | null = null;

/* ────────────────────────── 数据读数（全走正式契约） ────────────────────────── */

function instances(): readonly ItemInstance[] {
  return projectItemInstances(effectiveInventory(draft), draft);
}

/** 槽位当前装备（defId + 品质 + 实例绑定）。 */
function equippedOf(
  slotKey: string,
  slotKind: ItemSlotKind,
): { defId: string; quality: QualityTier | null; instId: string | null } | null {
  if (slotKind === 'body') return { defId: draft.bodyDefId, quality: null, instId: null };
  if (slotKind === 'weapon') {
    const defId = draft.functionalSelections['frontMass'];
    if (!defId || defId === 'none') return null;
    return {
      defId,
      quality: draft.functionalQualities?.['frontMass'] ?? null,
      instId: draft.equippedQualityInstances?.['frontMass'] ?? null,
    };
  }
  if (slotKind === 'gadget') {
    const defId = draft.gadgetDefId;
    if (!defId || defId === 'none') return null;
    return {
      defId,
      quality: draft.gadgetQuality ?? null,
      instId: draft.equippedQualityInstances?.['gadget'] ?? null,
    };
  }
  // movement：front / rear 各自独立
  const defId = slotKey === 'front' ? draft.frontWheelDefId : draft.rearWheelDefId;
  if (!defId) return { defId: 'wheelStd', quality: null, instId: null };
  return {
    defId,
    quality: draft.movementQualities?.[slotKey as 'front' | 'rear'] ?? null,
    instId: draft.equippedQualityInstances?.[slotKey] ?? null,
  };
}

/** 装备事务分派：qv2 品质实例走 equipQualityProduct，旧 q1 件走既有 equip* 全家。 */
function equipTransaction(
  slotKey: string,
  slotKind: ItemSlotKind,
  inst: ItemInstance,
): { ok: true } | { ok: false; detail: string } {
  if (inst.instanceId.startsWith('qv2:')) {
    const movementSlot: 'rear' | 'front' | undefined =
      slotKind === 'movement' && (slotKey === 'front' || slotKey === 'rear') ? slotKey : undefined;
    const res = equipQualityProduct(inst.instanceId, draft, movementSlot ?? 'rear');
    return res.ok ? { ok: true } : { ok: false, detail: res.detail ?? '品质件穿戴被拒绝' };
  }
  // 旧 q1 件（含旧 ★2..5）：走各自既有入口（正式落盘 + 正式校验）
  if (slotKind === 'weapon') {
    const r = equipWeapon(inst.defId, draft, undefined, inst.legacyStar ?? 1);
    return r.ok ? { ok: true } : { ok: false, detail: r.detail ?? r.reason ?? '装备失败' };
  }
  if (slotKind === 'body') {
    const r = equipBody(inst.defId, draft);
    return r.ok ? { ok: true } : { ok: false, detail: r.detail ?? r.reason ?? '装备失败' };
  }
  if (slotKind === 'gadget') {
    const r = equipGadget(inst.defId, draft);
    return r.ok ? { ok: true } : { ok: false, detail: r.detail ?? r.reason ?? '装备失败' };
  }
  // movement：前后轮各自独立传槽（绝不硬编码总装前轮）
  const r = equipMovement(slotKey, inst.defId, draft);
  return r.ok ? { ok: true } : { ok: false, detail: r.detail ?? r.reason ?? '装备失败' };
}

/** 装备成功后：从正式存档重读（页面态 = 存档态，无本地副本漂移）。 */
function reloadFromStore(): void {
  draft = loadEquippedDraft();
}

/* ────────────────────────── 渲染 ────────────────────────── */

/**
 * 全量重建（数据量小、无虚拟滚动）+ **滚动位置保持**：
 * 旧版每次 rerender 都让 `.g2-bag` 回到顶部（真人抱怨「刚翻到下面就跳回上面」），
 * 这里在拆树前记住 scrollTop、建完树后写回；只有切换模式才归零。
 */
function rerender(): void {
  const scroller = root.querySelector<HTMLElement>('[data-g2-scroll]');
  if (scroller) scrollMemo = scroller.scrollTop;

  root.textContent = '';
  root.dataset['g2Mode'] = mode;
  // 装备页**恒为底层**（合成是叠加弹窗，不再换页）⇒ 关闭合成时背包/战车/五槽原样还在。
  root.append(...buildEquipPage());
  if (mode === 'fuse') root.append(buildFuseOverlay());
  if (modal) root.append(buildModal(modal));

  const next = root.querySelector<HTMLElement>('[data-g2-scroll]');
  if (next) next.scrollTop = scrollMemo;

  // 合成产物：**只滚一次**到它身上（结果清晰），之后不再打扰。
  if (pendingRevealId) {
    const cell = root.querySelector<HTMLElement>(`[data-g2-cell="${pendingRevealId}"]`);
    pendingRevealId = null;
    if (cell) cell.scrollIntoView({ block: 'nearest' });
  }
}

/* ── 装备页 ── */

function buildEquipPage(): HTMLElement[] {
  const note = buildNote();
  return [
    buildHead(),
    buildStage(),
    buildSlotsRow(),
    ...(note ? [note] : []),
    buildBag(),
    buildFoot(),
  ];
}

/**
 * 顶部标题行：装备页标题（**不再承载任何合成入口**）。
 *
 * 合成是装备页之上的弹窗（见 `buildFuseOverlay`），它的【返回装备】在**弹窗底部**，
 * 所以这一行在两种状态下都只有「装备」——不会出现两个入口或两个返回。
 */
function buildHead(): HTMLElement {
  const head = elDiv('g2-head');
  head.dataset['g2Head'] = '1';
  head.append(elDiv('g2-title', '装备'));
  return head;
}

/**
 * 【合成】入口（真实资格红点：只有存在满足 同部位+同品质≥5 的组才亮数字）。
 *
 * 挂载位置 = `.g2-bag-head` 第三列（右端），与「背包」「点一件 · 换成它」同一行。
 * 点击 = 打开叠加在装备页之上的合成弹窗（底层装备页与背包滚动位置原样保留）。
 */
function buildFuseEntry(): HTMLElement {
  const groups = fuseCandidateGroups();
  const btn = el('button', 'g2-fuse-btn' + (groups.length > 0 ? ' g2-fuse-btn-ready' : ''));
  btn.type = 'button';
  btn.dataset['g2FuseEntry'] = '1';
  btn.dataset['g2FuseReady'] = String(groups.length);
  btn.append(document.createTextNode('合成'));
  if (groups.length > 0) {
    const dot = elDiv('g2-fuse-dot', String(groups.length));
    dot.dataset['g2FuseDot'] = '1';
    btn.append(dot);
  }
  btn.addEventListener('click', () => {
    mode = 'fuse';
    modal = null;
    flash = null;
    freshInstId = null;
    fuseMainPick = null; // 选择不跨打开保留
    // ⚠️ 不动 scrollMemo：关掉弹窗要回到**原背包位置**（旧版这里把它清零了）。
    rerender();
  });
  return btn;
}

/** 关闭合成弹窗：**零写盘**（只清状态 + 重渲染；背包滚动位置由 scrollMemo 原样恢复）。 */
function exitFuseMode(): void {
  mode = 'equip';
  fuseMainPick = null;
  modal = null;
  flash = null;
  freshInstId = null;
  rerender();
}

function buildStage(): HTMLElement {
  const stage = elDiv('g2-stage');
  stage.dataset['g2Stage'] = '1';
  const car = elDiv('g2-car');
  const layout = vehiclePreviewLayout(draft);
  car.append(...previewNodes(layout));
  stage.append(car);
  return stage;
}

/** 与 homePage / garageV2Lab 同口径的纯 DOM 预览（正式 sprite 同源）。 */
function previewNodes(layout: VehiclePreviewLayout): HTMLElement[] {
  const nodes: HTMLElement[] = [];
  const ordered = [...layout.items].sort((a, b) => a.layer - b.layer);
  const bx = (layout.minX + layout.maxX) / 2;
  const by = (layout.minY + layout.maxY) / 2;
  for (const it of ordered) {
    const url = it.visualId ? SPRITE_URLS[it.visualId] : undefined;
    const node = url ? el('img', 'g2-car-item') : elDiv('g2-car-item g2-car-fallback');
    const w = it.w * layout.scale;
    const h = it.h * layout.scale;
    const dx = (it.cx - bx) * layout.scale;
    const dy = (it.cy - by) * layout.scale;
    node.style.left = `calc(50% + ${dx - w / 2}px)`;
    node.style.top = `calc(50% + ${dy - h / 2}px)`;
    node.style.width = `${w}px`;
    node.style.height = `${h}px`;
    if (it.round) node.style.borderRadius = '50%';
    node.dataset['g2PreviewItem'] = it.key;
    node.dataset['g2DefId'] = it.defId;
    if (url) {
      (node as HTMLImageElement).src = url;
      (node as HTMLImageElement).alt = it.name;
    }
    nodes.push(node);
  }
  return nodes;
}

function buildSlotsRow(): HTMLElement {
  const row = elDiv('g2-slots-row');
  row.dataset['g2Slots'] = '1';
  for (const s of G2_SLOTS) {
    const eq = equippedOf(s.key, s.kind);
    const hasEq = !!eq && (s.kind !== 'movement' || eq.defId !== 'wheelStd');
    const btn = el('button', 'g2-slot' + (hasEq ? ' g2-slot-eq' : ''));
    btn.type = 'button';
    btn.dataset['g2Slot'] = s.key;
    btn.dataset['g2SlotKind'] = s.kind;
    if (hasEq && eq) {
      btn.dataset['g2SlotDef'] = eq.defId;
      btn.append(partIconNode(iconKindOf(s.kind), eq.defId));
    } else {
      btn.append(elDiv('g2-slot-empty', '空'));
    }
    btn.append(elDiv('g2-slot-kind', s.label));
    // 槽点击 = 拿该槽「另一件」做候选对比（movement 必须落在被点的那个轮上）。
    btn.addEventListener('click', () => {
      const inst = firstCandidateFor(s.kind, eq?.defId ?? null);
      if (!inst) return;
      if (s.kind === 'movement') movementTargetPick = s.key === 'front' ? 'front' : 'rear';
      modal = { kind: 'compare', slotKey: s.key, slotKind: s.kind, candidate: inst };
      flash = null;
      rerender();
    });
    row.append(btn);
  }
  return row;
}

/** 该槽的第一件「可替换候选」（优先与当前装备不同 defId 的；没有就退回第一件）。 */
function firstCandidateFor(
  slotKind: ItemSlotKind,
  curDefId: string | null,
): ItemInstance | null {
  const pool = instances().filter((i) => i.slot === slotKind);
  if (pool.length === 0) return null;
  const different = pool.find((i) => i.defId !== curDefId);
  return different ?? pool[0] ?? null;
}

/** 装备页顶部提示（合成结果 / 装备失败如实回显）。自带 `data-g2-note`。 */
function buildNote(): HTMLElement | null {
  if (!flash) return null;
  const note = elDiv('g2-note ' + (flash.ok ? 'g2-note-ok' : 'g2-note-bad'), flash.text);
  note.dataset['g2Note'] = flash.ok ? 'ok' : 'bad';
  return note;
}

/**
 * 背包外壳 = **有明确 min-height:0 的 flex 列**（本轮必改 1）：
 *   `.g2-bag-wrap { flex:1 1 auto; min-height:0; display:flex; flex-direction:column }`
 *   `.g2-bag      { flex:1 1 auto; min-height:0; overflow-y:auto }`
 * 只有这两级同时成立，滚动才真的发生在背包内、footer 才由 flex 固定占位。
 */
function buildBag(): HTMLElement {
  const wrap = elDiv('g2-bag-wrap');
  wrap.dataset['g2BagWrap'] = '1';
  const head = elDiv('g2-bag-head');
  // 值 = 'equip'：CSS 只对这一行用三段 grid（合成组行 `g2-bag-head` 仍是两段 flex）。
  head.dataset['g2BagHead'] = 'equip';
  head.append(elDiv('g2-bag-title', '背包'));
  head.append(elDiv('g2-bag-hint', '点一件 · 换成它'));
  // 同一行最右：【合成】入口（唯一一处；顶部 .g2-head 不再重复）
  head.append(buildFuseEntry());

  const bag = elDiv('g2-bag');
  bag.dataset['g2Bag'] = '1';
  bag.dataset['g2Scroll'] = '1';

  const grid = elDiv('g2-grid');
  grid.dataset['g2Grid'] = '1';
  for (const inst of instances()) grid.append(buildCell(inst));
  bag.append(grid);
  wrap.append(head, bag);
  return wrap;
}

function buildCell(inst: ItemInstance): HTMLElement {
  const isFresh = freshInstId === inst.instanceId;
  const cell = el(
    'button',
    'g2-cell' + (inst.consumable ? '' : ' g2-cell-locked') + (isFresh ? ' g2-cell-fresh' : ''),
  );
  cell.type = 'button';
  cell.dataset['g2Cell'] = inst.instanceId;
  if (isFresh) cell.dataset['g2Fresh'] = '1';
  cell.dataset['q'] = inst.quality;
  cell.dataset['g2SlotKind'] = inst.slot;
  cell.title = inst.lockedReason ? lockedText(inst.lockedReason) : `${inst.name}（${QUALITY_LABELS[inst.quality]}）`;
  cell.append(partIconNode(iconKindOf(inst.slot), inst.defId));
  const badge = elDiv('g2-corner', SLOT_BADGE[inst.slot]);
  badge.dataset['g2Badge'] = SLOT_BADGE[inst.slot];
  cell.append(badge);
  cell.addEventListener('click', () => {
    // 背包格：movement 默认后轮（弹窗里是一目了然的二选一，随时可改目标）
    if (inst.slot === 'movement') movementTargetPick = 'rear';
    modal = { kind: 'compare', slotKey: defaultSlotKeyOf(inst), slotKind: inst.slot, candidate: inst };
    flash = null;
    rerender();
  });
  return cell;
}

/** 背包格点击的默认目标槽：movement 拆前后（默认装后轮，弹窗内二选一可改）。 */
function defaultSlotKeyOf(inst: ItemInstance): string {
  if (inst.slot === 'movement') return 'rear';
  return inst.slot;
}

function buildFoot(): HTMLElement {
  const foot = elDiv('g2-foot');
  foot.dataset['g2Foot'] = '1';
  const back = el('button', 'g2-back', '返回首页');
  back.type = 'button';
  back.dataset['g2Back'] = '1';
  back.addEventListener('click', () => closeToHome());
  foot.append(back);
  return foot;
}

/** 返回首页：恢复页面 header → 交回 homePage（其内部重读正式存档，语义未改）。 */
function closeToHome(): void {
  if (pageHeader) pageHeader.style.display = '';
  onClose();
}

/* ── 合成弹窗（叠加在**装备页之上**，不再替换整页） ── */

/**
 * 旧版点击【合成】会 `mode='fuse'` 把整页换成合成页 ⇒ 背包/战车/五槽上下文全消失，
 * 且【返回装备】跑到顶部。现在：装备页**原样留在下面**，合成内容作为一个居中卡片
 * 叠在遮罩上（高度上限 70% 逻辑画面，候选区自己滚），【返回装备】固定在卡片底部。
 *
 * 数据/事务全部复用（`fuseCandidateGroups` / `fusePickState` / `fuseQualityFive`）；
 * 关闭只是把 `mode` 拨回 `'equip'`，**不写盘、不重载配置**，背包滚动位置原样保留。
 */
function buildFuseOverlay(): HTMLElement {
  const groups = fuseCandidateGroups();
  const overlay = elDiv('g2-fuse-overlay');
  overlay.dataset['g2FuseOverlay'] = '1';

  const card = elDiv('g2-fuse-modal');
  card.dataset['g2FuseModal'] = '1';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', '合成');

  const head = elDiv('g2-fuse-modal-head');
  head.dataset['g2FuseModalHead'] = '1';
  head.append(elDiv('g2-modal-title', '合成'));
  card.append(head);

  const hint = elDiv(
    'g2-fuse-hint',
    groups.length > 0
      ? `同部位 · 同品质 5 合 1 → 主件升一档（可合成 ${groups.length} 组）`
      : '同部位 · 同品质 5 合 1 → 主件升一档',
  );
  hint.dataset['g2FuseHint'] = '1';
  card.append(hint);

  // 候选区：**唯一内部滚动层**（卡片本身不滚，底部主操作/返回恒定可见）
  const body = elDiv('g2-fuse-body');
  body.dataset['g2FuseScroll'] = '1';
  if (groups.length === 0) {
    const empty = elDiv(
      'g2-fuse-empty',
      '没有满足「同部位 + 同品质 ≥5」的组（车身 / 旧星级成长件 / 装备中 / 彩封顶 / 非推进辅助 不计入）。',
    );
    empty.dataset['g2FuseEmpty'] = '1';
    body.append(empty);
  }
  for (const g of groups) body.append(buildFuseGroup(g, groups));
  card.append(body, buildFuseResult(groups));

  overlay.append(card);
  return overlay;
}

function buildFuseGroup(g: FuseGroup, allGroups: readonly FuseGroup[]): HTMLElement {
  const box = elDiv('g2-fuse-group');
  box.dataset['g2FuseGroupKind'] = g.kind;
  box.dataset['g2FuseGroupQ'] = g.quality;
  box.dataset['g2FuseGroup'] = fuseGroupLabel(g);

  const head = elDiv('g2-bag-head');
  head.append(elDiv('g2-bag-title', fuseGroupLabel(g)));
  head.append(elDiv('g2-group-count', `×${g.members.length}`));

  const pick = fusePickState(allGroups);
  const grid = elDiv('g2-grid');
  for (const mem of g.members) grid.append(buildFuseCell(g, mem, pick));

  box.append(head, grid);
  return box;
}

/**
 * 合成候选格（**与装备背包同规格**：同一 `.g2-cell` / 4 列 / 86% 图标）：
 *   - `g2-cell-main`   = 玩家要保留的主件（金环 + 角标「主」）；
 *   - `g2-cell-consume`= 系统自动补的 4 件材料（压暗 + 角标「料」+ × 覆盖）⇒ 消耗者一目了然。
 */
function buildFuseCell(
  g: FuseGroup,
  mem: ItemInstance,
  pick: { group: FuseGroup; main: ItemInstance; mats: readonly ItemInstance[] } | null,
): HTMLElement {
  const isMain = pick?.main.instanceId === mem.instanceId;
  const isConsumed = !!pick && pick.mats.some((mm) => mm.instanceId === mem.instanceId);
  const cell = el(
    'button',
    'g2-cell' + (isMain ? ' g2-cell-main' : '') + (isConsumed ? ' g2-cell-consume' : ''),
  );
  cell.type = 'button';
  cell.style.setProperty('--q', qualityHex(g.quality));
  cell.dataset['g2FuseMember'] = mem.instanceId;
  cell.dataset['g2FuseMain'] = String(isMain);
  cell.dataset['g2FuseConsume'] = String(isConsumed);
  cell.dataset['g2SlotKind'] = g.kind;
  cell.title = `${mem.name}（${QUALITY_LABELS[g.quality]}）`;
  cell.append(partIconNode(iconKindOf(g.kind), mem.defId));
  const badge = elDiv('g2-corner', isMain ? '主' : isConsumed ? '料' : SLOT_BADGE[g.kind]);
  cell.append(badge);
  cell.addEventListener('click', () => {
    fuseMainPick = isMain ? null : mem.instanceId; // 再点主件 = 取消选择
    rerender();
  });
  return cell;
}

/** 底部固定区：主件 → 下一品质 + 唯一【确认五合一】。恒定存在（不跳动）。 */
function buildFuseResult(groups: readonly FuseGroup[]): HTMLElement {
  const bar = elDiv('g2-fuse-result');
  bar.dataset['g2FusePreview'] = '1';
  const pick = fusePickState(groups);

  const icons = elDiv('g2-fuse-icons');
  icons.dataset['g2FuseIcons'] = '1';
  if (pick) {
    const next = nextQuality(pick.group.quality);
    icons.append(fuseSlot(pick.group.kind, pick.main.defId, pick.group.quality));
    icons.append(elDiv('g2-fuse-arrow', '→'));
    const to = fuseSlot(pick.group.kind, pick.main.defId, next ?? pick.group.quality);
    if (next) to.dataset['g2FuseNext'] = next;
    icons.append(to);
  } else {
    const ph = elDiv('g2-fuse-placeholder', '选主件');
    ph.dataset['g2FuseNoPick'] = '1';
    icons.append(ph);
  }

  const text = elDiv(
    'g2-fuse-result-text',
    pick
      ? `${QUALITY_LABELS[pick.group.quality]} → ${QUALITY_LABELS[nextQuality(pick.group.quality) ?? pick.group.quality]}｜消耗主件 + 4 件同组材料`
      : groups.length === 0
        ? '暂无可合成组'
        : '点一件你最想保留的（成品保留它的外形）',
  );
  text.dataset['g2FuseText'] = '1';

  const go = el('button', 'g2-fuse-confirm', '确认五合一');
  go.type = 'button';
  go.dataset['g2Action'] = 'fuse';
  go.disabled = !pick;
  go.addEventListener('click', () => {
    const now = fusePickState(fuseCandidateGroups());
    if (!now) return;
    const mats = now.mats.map((mm) => mm.instanceId);
    const res: QualityFuseResult = fuseQualityFive({
      mainInstanceId: now.main.instanceId,
      materialInstanceIds: mats,
      draft,
    });
    if (!res.ok) {
      // 失败如实回显；事务内部保证零写盘
      flash = { ok: false, text: `合成失败：${res.detail}` };
      mode = 'equip';
      fuseMainPick = null;
      rerender();
      return;
    }
    // 成功：从正式存档重读 → 回装备页 → 结果清晰（顶部提示 + 新件金环 + 滚到它）
    reloadFromStore();
    const before = now.group.quality;
    flash = {
      ok: true,
      text: `合成成功：${QUALITY_LABELS[before]} → ${QUALITY_LABELS[res.productQuality]}（外形保留主件，已在背包里，可直接穿戴）`,
    };
    mode = 'equip';
    fuseMainPick = null;
    freshInstId = res.productId; // 背包里立刻带金环（结果清晰）
    pendingRevealId = res.productId;
    rerender();
  });

  // 底部固定两段：上「主件 → 下一品质」预览，下【返回装备】+ 唯一【确认五合一】。
  // 返回按钮在**卡片底部**（旧版在顶部标题行，操作不自然），候选多寡都恒可见。
  const preview = elDiv('g2-fuse-preview');
  preview.dataset['g2FusePreviewRow'] = '1';
  preview.append(icons, text);

  const back = el('button', 'g2-fuse-back', '返回装备');
  back.type = 'button';
  back.dataset['g2FuseBack'] = '1';
  back.dataset['g2Action'] = 'fuse-back';
  back.addEventListener('click', () => exitFuseMode());

  const actions = elDiv('g2-fuse-actions');
  actions.dataset['g2FuseActions'] = '1';
  actions.append(back, go);

  bar.append(preview, actions);
  return bar;
}

function fuseSlot(kind: ItemSlotKind, defId: string, q: QualityTier): HTMLElement {
  const box = elDiv('g2-fuse-slot');
  box.dataset['q'] = q;
  box.style.setProperty('--q', qualityHex(q));
  box.append(partIconNode(iconKindOf(kind), defId));
  return box;
}

/* ────────────────────────── 对比弹窗（装备唯一入口） ────────────────────────── */

function buildModal(m: G2Modal): HTMLElement {
  const mask = elDiv('g2-mask');
  mask.dataset['g2Mask'] = '1';
  const card = elDiv('g2-modal');
  card.dataset['g2Modal'] = m.kind;
  card.append(...compareModal(m));
  mask.append(card);
  mask.addEventListener('click', (e) => {
    if (e.target === mask) {
      modal = null; // 点遮罩 = 取消（零写盘）
      rerender();
    }
  });
  return mask;
}

/**
 * 「当前装备 / 新件」图形对比 + 真实装备事务（【取消】零写盘）。
 *
 * 本轮结构（必改 3）：
 *   - movement 的前/后轮目标 = **标题正下方的独立二选一**（各带该槽当前件图标），
 *     不再和「装备/取消」挤在同一行抢主操作；
 *   - 底部主操作**只有两个**：【取消】(左·次要) + 【装备/替换】(右·唯一主操作)。
 *   - 二选一同时切换「当前装备」列的读数（对比的是**那个轮**现在装的是什么）。
 */
function compareModal(m: G2Modal): HTMLElement[] {
  const isMovement = m.slotKind === 'movement';
  const activeSlotKey = isMovement ? movementTargetPick : m.slotKey;
  const cur = equippedOf(activeSlotKey, m.slotKind);
  const rawCur = cur?.defId ?? null;
  const hasCur = !!rawCur && rawCur !== 'wheelStd';

  const title = elDiv('g2-modal-title', modalTitleOf(activeSlotKey, m.slotKind));
  title.dataset['g2ModalTitle'] = '1';

  const blocks: HTMLElement[] = [title];

  // ① 前/后轮目标（仅 movement）：独立二选一，先选「装到哪」，再看对比。
  if (isMovement) {
    const row = elDiv('g2-targets');
    row.dataset['g2Targets'] = '1';
    for (const t of ['front', 'rear'] as const) {
      const nowDef = (t === 'front' ? draft.frontWheelDefId : draft.rearWheelDefId) ?? null;
      const on = movementTargetPick === t;
      const btn = el('button', 'g2-target' + (on ? ' g2-target-on' : ''));
      btn.type = 'button';
      btn.dataset['g2Target'] = t;
      btn.dataset['g2TargetOn'] = String(on);
      btn.append(partIconNode('movement', nowDef ?? 'wheelStd'));
      btn.append(elDiv('g2-target-label', t === 'front' ? '装到前轮' : '装到后轮'));
      btn.addEventListener('click', () => {
        movementTargetPick = t;
        rerender();
      });
      row.append(btn);
    }
    blocks.push(row);
  }

  // ② 图形对比
  const compare = elDiv('g2-compare');
  const colCur = elDiv('g2-col');
  colCur.dataset['g2Col'] = 'current';
  colCur.append(elDiv('g2-col-tag', '当前装备'));
  colCur.append(hasCur && rawCur ? partIconNode(iconKindOf(m.slotKind), rawCur) : elDiv('g2-col-note', '空'));
  colCur.append(elDiv('g2-col-q', cur?.quality ? `${QUALITY_LABELS[cur.quality]}品质` : ''));

  const colNew = elDiv('g2-col g2-col-new');
  colNew.dataset['g2Col'] = 'new';
  colNew.dataset['q'] = m.candidate.quality;
  colNew.append(elDiv('g2-col-tag', '背包选中'));
  colNew.append(partIconNode(iconKindOf(m.slotKind), m.candidate.defId));
  colNew.append(elDiv('g2-col-q', `${QUALITY_LABELS[m.candidate.quality]}品质`));
  const blocked = equipBlockedReason(m.candidate);
  const note = elDiv(
    'g2-col-note',
    blocked ?? (m.candidate.lockedReason ? lockedText(m.candidate.lockedReason) : '可装备（正式语义）'),
  );
  note.dataset['g2ColNote'] = '1';
  colNew.append(note);
  compare.append(colCur, colNew);
  blocks.push(compare);

  // ③ 提示
  const warn = elDiv('g2-warn');
  warn.dataset['g2Warn'] = '1';
  if (m.toast) {
    warn.textContent = m.toast; // 上一次装备失败的如实回显
  } else if (blocked) {
    warn.textContent = blocked; // 结构性装不上（Body 品质件 / 非推进类 Gadget 品质件）
  } else if (m.candidate.quality === 'chrome') {
    warn.textContent = '彩品质（封顶）：不能再合成，但**可以正常穿戴**，Run 按 2.50 实效。';
  } else if (m.candidate.lockedReason === 'legacy-star-locked') {
    warn.textContent = `旧 ★${m.candidate.legacyStar} 成长件：保留历史成长，可正常装备；仅禁止作为 V2 合成材料。`;
  } else if (m.candidate.lockedReason === 'body-not-consumable') {
    warn.textContent = '车身沿旧方式换装（不参与品质合成消耗）。';
  } else if (m.candidate.quality !== 'white') {
    warn.textContent = `品质件走正式装备事务真实落盘，Run 按品质实效（${QUALITY_LABELS[m.candidate.quality]}）。`;
  }
  blocks.push(warn);

  // ④ 底部主操作：**只有两个**（取消 / 装备·替换）
  const actions = elDiv('g2-actions');
  const cancel = el('button', 'g2-btn g2-btn-cancel', '取消');
  cancel.type = 'button';
  cancel.dataset['g2Action'] = 'cancel';
  cancel.addEventListener('click', () => {
    modal = null; // 【取消】零写盘：只关弹窗
    rerender();
  });
  const go = el('button', 'g2-btn g2-btn-primary', hasCur ? '替换' : '装备');
  go.type = 'button';
  go.dataset['g2Action'] = 'equip';
  // ⚠️ 只有「事务结构性拒绝」才禁用主操作；lockedReason（能否被消耗）与穿戴无关。
  go.disabled = !!blocked;
  go.addEventListener('click', () => {
    const slotKey = isMovement ? movementTargetPick : m.slotKey;
    const res = equipTransaction(slotKey, m.slotKind, m.candidate);
    if (!res.ok) {
      m.toast = `装备失败：${res.detail}`; // 如实回显，零写盘（事务内部保证）
      rerender();
      return;
    }
    reloadFromStore(); // 成功：从正式存档重读（车预览与 Run 同源）
    modal = null;
    flash = null;
    freshInstId = null;
    rerender();
  });
  actions.append(cancel, go);
  blocks.push(actions);

  return blocks;
}

function modalTitleOf(slotKey: string, kind: ItemSlotKind): string {
  if (kind === 'body') return '车身';
  if (kind === 'weapon') return '武器';
  if (kind === 'gadget') return '辅助';
  return slotKey === 'front' ? '前轮' : '后轮';
}

/* ───────────── 真实五合一候选（正式 fuseQualityFive 的资格口径） ───────────── */

interface FuseGroup {
  kind: ItemSlotKind;
  quality: QualityTier;
  /** 互异实例（全部列出；确认时 = 主件 + 其余 4）。 */
  members: readonly ItemInstance[];
}

/**
 * 「当前满足同部位+同品质 ≥5」的**真实可合成组**（纯读数，不写任何东西）。
 *
 * 排除（旧限制，一条不改）：
 *   - Body（无数量模型，结构性不可消耗）；
 *   - 非 consumable（旧 ★2..5 legacy-star-locked / 已装备 equipped 保护 / 封顶）；
 *   - 彩品质封顶（isMaxQuality，无可再升的品质）；
 *   - **非推进类 Gadget**（pushRod 等）：没有品质实效通道 ⇒ 整组排除
 *     （普通件照常在背包显示，只是不能合成）。判据与 `equipQualityProduct` 的
 *     gadget 分支同一真源：`registry.functionals.get(defId).behavior === 'thruster'`。
 */
function fuseCandidateGroups(): readonly FuseGroup[] {
  const byKey = new Map<string, ItemInstance[]>();
  for (const inst of instances()) {
    if (inst.slot === 'body') continue;
    if (!inst.consumable) continue; // 锁定（旧 ★2..5 / 装备中 stack）与封顶（max-quality）
    if (isMaxQuality(inst.quality)) continue;
    if (inst.slot === 'gadget') {
      const def = registry.functionals.get(inst.defId);
      if (!def || def.behavior !== 'thruster') continue; // 非推进类 = 不可品质合成
    }
    const key = `${inst.slot}|${inst.quality}`;
    const arr = byKey.get(key) ?? [];
    arr.push(inst);
    byKey.set(key, arr);
  }
  const out: FuseGroup[] = [];
  for (const [key, arr] of byKey) {
    if (arr.length < 5) continue; // ≥5 个互异实例才有资格
    const [kind, quality] = key.split('|') as [ItemSlotKind, QualityTier];
    out.push({ kind, quality, members: arr });
  }
  return out;
}

/** 当前主件选择 → (组, 主件, 自动补的 4 件材料)；无选择/不足 4 件 = null。 */
function fusePickState(
  groups: readonly FuseGroup[],
): { group: FuseGroup; main: ItemInstance; mats: readonly ItemInstance[] } | null {
  if (!fuseMainPick) return null;
  for (const g of groups) {
    const main = g.members.find((mm) => mm.instanceId === fuseMainPick);
    if (!main) continue;
    const mats = g.members.filter((mm) => mm.instanceId !== fuseMainPick).slice(0, 4);
    if (mats.length < 4) return null;
    return { group: g, main, mats };
  }
  return null;
}

/** 组标题字（部位+品质；不是名字、不是数量堆叠）。 */
function fuseGroupLabel(g: FuseGroup): string {
  return `${g.kind === 'weapon' ? '武器' : g.kind === 'gadget' ? '辅助' : '轮组'} · ${QUALITY_LABELS[g.quality]}`;
}

/* ────────────────────────── 杂项 ────────────────────────── */

function iconKindOf(slot: ItemSlotKind): 'weapon' | 'body' | 'movement' | 'gadget' {
  return slot;
}

function qualityHex(q: QualityTier): string {
  return (
    {
      white: '#9aa7b8',
      green: '#4caf6d',
      blue: '#3f8fd2',
      purple: '#9b6bd8',
      orange: '#e08b3a',
      red: '#e2445c',
      chrome: '#ffd35a',
    } as Readonly<Record<QualityTier, string>>
  )[q];
}

/**
 * 「穿上它」这件事**结构性做不到**的原因（null = 可以装）。本轮修正的一个真实缺陷：
 *
 *   `ItemInstance.lockedReason` 描述的是「**能否被五合一消耗**」（equipped / Body /
 *   max-quality / legacy-star-locked），**不是**「能否穿戴」。旧版 UI 把
 *   `lockedReason !== legacy && !== body` 直接当作「装备按钮禁用」⇒
 *   **红品质 / 彩品质（max-quality）件根本装不上**（而 `equipQualityProduct` 本来接受它们，
 *   它只挡 Body 与「非推进类 Gadget」）。⇒ 现在只拦截事务本身会结构性拒绝的两类：
 *     · 品质件里的 Body（Body 无数量模型 ⇒ run-not-wired，独立冻结）；
 *     · 品质件里的**非推进类 Gadget**（没有品质实效通道）。
 *   旧 q1 件一律不拦：闸门在各自既有 equip* 事务里，如实回显即可。
 */
function equipBlockedReason(inst: ItemInstance): string | null {
  if (!inst.instanceId.startsWith('qv2:')) return null;
  if (inst.slot === 'body') return '品质车身暂不支持穿戴（Body 数量模型独立冻结），可先换车身再谈品质。';
  if (inst.slot === 'gadget') {
    const def = registry.functionals.get(inst.defId);
    if (!def || def.behavior !== 'thruster') {
      return '该辅助件没有品质实效通道（只有推进器类支持按品质放大推力）。';
    }
  }
  return null;
}

function lockedText(reason: NonNullable<ItemInstance['lockedReason']>): string {
  return reason === 'equipped'
    ? '装备中（stack 保护）'
    : reason === 'body-not-consumable'
      ? '车身不参与合成消耗'
      : reason === 'max-quality'
        ? '彩品质：封顶不可再合'
        : reason === 'legacy-star-locked'
          ? '旧星级成长件：保留成长，仅禁 V2 消耗'
          : '不可消耗';
}

/** 正式 sprite（与 homePage / 战斗同批 PNG 静态 import；缺美术件走矢量回退）。 */
import bodyWatermelonUrl from '../../assets/visuals/body_watermelon.png';
import bodyBananaUrl from '../../assets/visuals/body_banana.png';
import partCannonUrl from '../../assets/visuals/part_cannon.png';
import partHammerUrl from '../../assets/visuals/part_hammer.png';
import partPushRodUrl from '../../assets/visuals/part_pushRod.png';
const SPRITE_URLS: Readonly<Record<string, string>> = {
  body_watermelon: bodyWatermelonUrl,
  body_banana: bodyBananaUrl,
  part_cannon: partCannonUrl,
  part_hammer: partHammerUrl,
  part_pushRod: partPushRodUrl,
};

/* ────────────────────────── 挂载入口 ────────────────────────── */

/**
 * 正式 Garage V2 视图挂载（homePage 对【调整战车】默认调用；
 * 旧星级 Garage 仅 `?garageLegacy=1` 兼容测试入口可达）。
 *
 * ⚠️ 进入时把页面级 `.ph-header` 藏起来（V2 自带标题行）：390×844 下它白占 59~62px
 *    上方空白，正是真人抱怨的「上面一大块没用的空」。返回时**原样恢复**，
 *    首页布局与 homePage 代码都不动。
 *
 * @param container 挂载容器（正式 stage）
 * @param draft0 初始 draft（由 homePage 从正式存档读入）
 * @param backAction 底部【返回首页】动作（homePage 注入：重读正式存档 + `view='home'`）
 */
export function mountGarageV2View(
  container: HTMLElement,
  draft0: BuildDraft,
  backAction: () => void,
): void {
  root = container;
  draft = draft0;
  onClose = backAction;
  mode = 'equip';
  modal = null;
  flash = null;
  fuseMainPick = null;
  movementTargetPick = 'rear';
  scrollMemo = 0;
  pendingRevealId = null;
  freshInstId = null;
  pageHeader = container.parentElement?.querySelector<HTMLElement>('.ph-header') ?? null;
  if (pageHeader) pageHeader.style.display = 'none';
  rerender();
}

/** Debug 只读探针（E2E/真人验收读数；与 __PRODUCTHOME__ 同一「只读」纪律）。 */
export function garageV2ViewProbe(): Record<string, unknown> {
  if (!root) return { mounted: false };
  const fuseGroups = fuseCandidateGroups();
  return {
    mounted: true,
    /** 'equip' | 'fuse'（fuse = 装备页之上的合成弹窗；底层装备页仍在 DOM）。 */
    mode,
    /** 合成弹窗是否真的挂在装备页之上。 */
    fuseModalOpen: !!root.querySelector('[data-g2-fuse-modal]'),
    /** 底层装备页是否仍在（弹窗打开时也必须为 true）。 */
    equipBehind: !!root.querySelector('[data-g2-foot]') && !!root.querySelector('[data-g2-stage]'),
    cells: root.querySelectorAll('[data-g2-cell]').length,
    slots: root.querySelectorAll('[data-g2-slot]').length,
    slotsEquipped: root.querySelectorAll('[data-g2-slot-def]').length,
    modal: root.querySelector('[data-g2-modal]')?.getAttribute('data-g2-modal') ?? null,
    /** 真实可合成组数（红点口径同源）。 */
    fuseReadyGroups: fuseGroups.length,
    fuseDot: root.querySelector('[data-g2-fuse-dot]')?.textContent ?? null,
    /** 已选主件（null = 未选）。 */
    fuseMainPick: fuseMainPick,
    fuseMembers: root.querySelectorAll('[data-g2-fuse-member]').length,
    /** 自动补的 4 件材料数（视觉上标为「料」）。 */
    fuseConsumeMarked: root.querySelectorAll('[data-g2-fuse-consume="true"]').length,
    fuseConfirmDisabled:
      (root.querySelector('[data-g2-action="fuse"]') as HTMLButtonElement | null)?.disabled ?? null,
    fuseBackVisible: !!root.querySelector('[data-g2-fuse-back]'),
    gridTextFree: isGridTextFree(),
    /** movement 弹窗当前目标槽 + 二选一是否存在（保证唯一主操作）。 */
    movementTarget: movementTargetPick,
    compareTargetButtons: root.querySelectorAll('[data-g2-target]').length,
    comparePrimaryActions: root.querySelectorAll('[data-g2-modal] [data-g2-action="equip"]').length,
    flash: flash?.text ?? null,
    rearDef: draft.rearWheelDefId ?? null,
    frontDef: draft.frontWheelDefId ?? null,
    weaponDef: draft.functionalSelections['frontMass'] ?? null,
    gadgetDef: draft.gadgetDefId ?? null,
    bodyDef: draft.bodyDefId,
    movementQualities: draft.movementQualities ?? null,
    functionalQualities: draft.functionalQualities ?? null,
    binds: draft.equippedQualityInstances ?? null,
  };
}

/** 验收判据：背包格内**零**名字/数量/星级文本（角标「武/身/轮/辅」除外）。 */
function isGridTextFree(): boolean {
  const grid = root.querySelector('[data-g2-grid]');
  if (!grid) return true;
  for (const c of Array.from(grid.querySelectorAll('.g2-cell'))) {
    // 克隆后剥掉角标，剩下的直接文本必须为空
    const clone = c.cloneNode(true) as HTMLElement;
    for (const b of Array.from(clone.querySelectorAll('.g2-corner'))) b.remove();
    if ((clone.textContent ?? '').trim() !== '') return false;
  }
  return true;
}
