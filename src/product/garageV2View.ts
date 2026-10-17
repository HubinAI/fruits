/**
 * GARAGE-V2-DEFAULT-CUTOVER-R1｜正式页 Garage V2 装备视图（【调整战车】默认入口）。
 *
 * 与 `garageV2Lab.ts` 的关系（⚠️ 本模块的存在理由）：
 *   - **视觉结构同源**（用户已拍板的布局）：中上真实战车预览 / 左右五槽
 *     / 下方单件品质图标背包（不显示名字/数量/星级/不堆叠）/ 背包右上合成预留 / 底部返回；
 *   - **数据完全不同源**：这里所有读写都走**正式生产存档**
     （`loadEquippedDraft` / `playerInventory` / `effectiveInventory` /
     `projectItemInstances` / `equipQualityProduct` / 旧 `equip*` 全家）；
 *   - **绝不** import `garageV2LabMain` / `seedLabFixture` / `bindPlatformCore` /
 *     任何隔离内存 Map —— 本模块不认识「测试种子」这个概念。
 *
 * 本模块能力（GARAGE-V2-DEFAULT-CUTOVER-R1 起 = 正式主入口）：
 *   - 合成 = 真实 `fuseQualityFive` 事务（同部位同品质 ≥5 → 主件下一品质）；
 *   - 装备链是**真实事务**：对比弹窗【取消】零写盘、【装备/替换】真实落盘并重读；
 *   - 旧 ★2..5 保留展示（明确「旧成长锁定，仅禁止 V2 消耗」），不静默降白/删除。
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

/** 五个穿戴槽（与 Lab 同序：左 body/weapon/gadget，右 front/rear）。 */
const G2_SLOTS: readonly { key: string; kind: ItemSlotKind; label: string; side: 'l' | 'r' }[] = [
  { key: 'body', kind: 'body', label: '车身', side: 'l' },
  { key: 'weapon', kind: 'weapon', label: '武器', side: 'l' },
  { key: 'gadget', kind: 'gadget', label: '辅助', side: 'l' },
  { key: 'front', kind: 'movement', label: '前轮', side: 'r' },
  { key: 'rear', kind: 'movement', label: '后轮', side: 'r' },
];

/** 部位角标字（格子左上角微型标注；不是名字、不是数量）。 */
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

type G2Modal =
  | {
      kind: 'compare';
      slotKey: string; // 'body' | 'weapon' | 'gadget' | 'front' | 'rear'
      slotKind: ItemSlotKind;
      candidate: ItemInstance;
      toast?: string; // 装备失败的如实回显（不吞错）
      /** movement 弹窗初始化标记：pick 只在打开时从入口槽初始化一次（rerender 保持用户选择）。 */
      targetInit?: boolean;
    }
  /** GARAGE-V2-FORMAL-FUSE-SLICE-R1：真实五合一合成弹窗（正式 fuseQualityFive 事务）。 */
  | {
      kind: 'fuse';
      /** 上一次合成失败的如实回显（不吞错；成功后弹窗关闭）。 */
      toast?: string;
    }
  | null;

let draft: BuildDraft;
let modal: G2Modal = null;
let root: HTMLElement;
/** movement 对比弹窗的当前目标槽（模块级：rerender 重建弹窗后仍保持用户选择）。 */
let movementTargetPick: 'front' | 'rear' = 'rear';
/** 合成弹窗当前选中的主件实例 id（模块级：rerender 重建弹窗后仍保持用户选择）。 */
let fuseMainPick: string | null = null;
let onClose: () => void = () => {}; // 底部【返回】动作（由 homePage 注入：回正式首页视图）

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

function rerender(): void {
  root.textContent = '';
  root.append(buildHead(), buildStage(), buildSlotsRow(), buildBag(), buildFoot());
  if (modal) root.append(buildModal(modal));
}

function buildHead(): HTMLElement {
  const head = elDiv('g2-head', 'Garage 2.0 · 装备');
  head.dataset['g2Head'] = '1';
  return head;
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
  const left = elDiv('g2-slots-col');
  const right = elDiv('g2-slots-col');
  for (const s of G2_SLOTS) {
    const eq = equippedOf(s.key, s.kind);
    const btn = el('button', 'g2-slot' + (eq ? ' g2-slot-eq' : ''));
    btn.type = 'button';
    btn.dataset['g2Slot'] = s.key;
    btn.dataset['g2SlotKind'] = s.kind;
    if (eq) {
      btn.dataset['g2SlotDef'] = eq.defId;
      btn.append(partIconNode(s.kind === 'body' ? 'body' : s.kind, eq.defId, s.label));
      btn.append(elDiv('g2-slot-kind', s.label));
    } else {
      btn.append(elDiv('g2-slot-empty', '空'));
      btn.append(elDiv('g2-slot-kind', s.label));
    }
    // 槽点击 = 从背包里挑该部位第一件做候选对比（与 Lab 同交互；正式选件走背包格）
    btn.addEventListener('click', () => {
      const inst = instances().find((i) => i.slot === s.kind);
      if (inst) {
        modal = { kind: 'compare', slotKey: s.key, slotKind: s.kind, candidate: inst };
        rerender();
      }
    });
    (s.side === 'l' ? left : right).append(btn);
  }
  row.append(left, right);
  return row;
}

function buildBag(): HTMLElement {
  const head = elDiv('g2-bag-head');
  head.dataset['g2BagHead'] = '1';
  head.append(elDiv('g2-bag-title', '背包'));
  // 合成按钮（GARAGE-V2-FORMAL-FUSE-SLICE-R1）：真实资格红点 ——
  // 只有「当前存在满足同部位+同品质≥5 的可合成组」才亮红点数量；无组 = 素色可点（弹窗给空说明）。
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
    modal = { kind: 'fuse' };
    fuseMainPick = null; // 每次打开弹窗重置主件选择（选择不跨打开保留）
    rerender();
  });
  head.append(btn);

  const bag = elDiv('g2-bag');
  bag.dataset['g2Bag'] = '1';
  const grid = elDiv('g2-grid');
  grid.dataset['g2Grid'] = '1';
  for (const inst of instances()) {
    grid.append(buildCell(inst));
  }
  bag.append(grid);
  const wrap = elDiv('g2-bag-wrap');
  wrap.append(head, bag);
  return wrap;
}

function buildCell(inst: ItemInstance): HTMLElement {
  const cell = el('button', 'g2-cell' + (inst.consumable ? '' : ' g2-cell-locked'));
  cell.type = 'button';
  cell.dataset['g2Cell'] = inst.instanceId;
  cell.dataset['q'] = inst.quality;
  cell.dataset['g2SlotKind'] = inst.slot;
  cell.title = inst.lockedReason ? lockedText(inst.lockedReason) : `${inst.name}（${QUALITY_LABELS[inst.quality]}）`;
  cell.append(partIconNode(iconKindOf(inst.slot), inst.defId));
  const badge = elDiv('g2-corner', SLOT_BADGE[inst.slot]);
  badge.dataset['g2Badge'] = SLOT_BADGE[inst.slot];
  cell.append(badge);
  cell.addEventListener('click', () => {
    modal = { kind: 'compare', slotKey: defaultSlotKeyOf(inst), slotKind: inst.slot, candidate: inst };
    rerender();
  });
  return cell;
}

/** 背包格点击的默认目标槽：movement 拆前后（默认装后轮，弹窗里可换目标）。 */
function defaultSlotKeyOf(inst: ItemInstance): string {
  if (inst.slot === 'movement') return 'rear';
  return inst.slot;
}

function buildFoot(): HTMLElement {
  const foot = elDiv('g2-foot');
  foot.dataset['g2Foot'] = '1';
  const back = el('button', 'g2-back', '返回');
  back.type = 'button';
  back.dataset['g2Back'] = '1';
  back.addEventListener('click', () => onClose());
  foot.append(back);
  return foot;
}

/* ────────────────────────── 弹窗 ────────────────────────── */

function buildModal(m: NonNullable<G2Modal>): HTMLElement {
  const mask = elDiv('g2-mask');
  mask.dataset['g2Mask'] = '1';
  const card = elDiv('g2-modal');
  card.dataset['g2Modal'] = m.kind;
  card.append(...(m.kind === 'fuse' ? fuseModal(m) : compareModal(m)));
  mask.append(card);
  mask.addEventListener('click', (e) => {
    if (e.target === mask) {
      modal = null;
      rerender();
    }
  });
  return mask;
}

/** 「当前装备 / 新件」图形对比 + 真实装备事务（【取消】零写盘）。 */
function compareModal(m: NonNullable<G2Modal> & { kind: 'compare' }): HTMLElement[] {
  const cur = equippedOf(m.slotKey, m.slotKind);
  const curDefId = cur?.defId ?? null;
  const title = elDiv('g2-modal-title', modalTitleOf(m));
  title.dataset['g2ModalTitle'] = '1';

  const compare = elDiv('g2-compare');
  const colCur = elDiv('g2-col');
  colCur.dataset['g2Col'] = 'current';
  colCur.append(elDiv('g2-col-tag', '当前装备'));
  colCur.append(curDefId ? partIconNode(iconKindOf(m.slotKind), curDefId) : elDiv('g2-col-note', '空'));
  colCur.append(elDiv('g2-col-q', cur?.quality ? `${QUALITY_LABELS[cur.quality]}品质` : ''));

  const colNew = elDiv('g2-col g2-col-new');
  colNew.dataset['g2Col'] = 'new';
  colNew.dataset['q'] = m.candidate.quality;
  colNew.append(elDiv('g2-col-tag', '背包选中'));
  colNew.append(partIconNode(iconKindOf(m.slotKind), m.candidate.defId));
  colNew.append(elDiv('g2-col-q', `${QUALITY_LABELS[m.candidate.quality]}品质`));
  const note = elDiv(
    'g2-col-note',
    m.candidate.lockedReason ? lockedText(m.candidate.lockedReason) : '可装备（正式语义）',
  );
  note.dataset['g2ColNote'] = '1';
  colNew.append(note);
  compare.append(colCur, colNew);

  // movement：前后轮目标切换（独立槽位，绝不硬编码总装前轮）。
  // ⚠️ 只在弹窗「刚打开」时用入口槽初始化 pick 一次；此后 rerender 不得重置
  // （否则用户点「装到前轮」→ rerender 又被 m.slotKey 拉回入口槽 = 选择丢失）。
  if (m.slotKind === 'movement' && m.targetInit !== true) {
    movementTargetPick = m.slotKey === 'front' ? 'front' : 'rear';
    m.targetInit = true;
  }
  const movementTarget: 'front' | 'rear' | null = m.slotKind === 'movement' ? movementTargetPick : null;

  const warn = elDiv('g2-warn');
  warn.dataset['g2Warn'] = '1';
  if (m.toast) {
    warn.textContent = m.toast; // 上一次装备失败的如实回显
  } else if (m.candidate.lockedReason === 'legacy-star-locked') {
    warn.textContent = `旧 ★${m.candidate.legacyStar} 成长件：保留历史成长，可正常装备；仅禁止作为 V2 合成材料。`;
  } else if (m.candidate.lockedReason === 'body-not-consumable') {
    warn.textContent = '车身沿旧方式换装（不参与品质合成消耗）。';
  } else if (m.candidate.quality !== 'white') {
    warn.textContent = `品质件将走正式装备事务（equipQualityProduct）真实落盘，Run 按品质实效（${QUALITY_LABELS[m.candidate.quality]}）。`;
  }

  const actions = elDiv('g2-actions');
  const cancel = el('button', 'g2-btn', '取消');
  cancel.type = 'button';
  cancel.dataset['g2Action'] = 'cancel';
  cancel.addEventListener('click', () => {
    modal = null; // 【取消】零写盘：只关弹窗
    rerender();
  });

  {
    // movement：目标切换（装到后轮 / 装到前轮）+ 取消 + 装备，同一行
    if (movementTarget) {
      for (const t of ['rear', 'front'] as const) {
        const b = el('button', 'g2-btn' + (movementTarget === t ? ' g2-btn-primary' : ''), t === 'rear' ? '装到后轮' : '装到前轮');
        b.type = 'button';
        b.dataset['g2Target'] = t;
        b.addEventListener('click', () => {
          movementTargetPick = t;
          rerender();
        });
        actions.append(b);
      }
    }
    const go = el('button', 'g2-btn g2-btn-primary', curDefId ? '替换装备' : '装备');
    go.type = 'button';
    go.dataset['g2Action'] = 'equip';
    go.disabled = !!m.candidate.lockedReason && m.candidate.lockedReason !== 'legacy-star-locked' && m.candidate.lockedReason !== 'body-not-consumable';
    go.addEventListener('click', () => {
      const slotKey = movementTarget ?? m.slotKey;
      const res = equipTransaction(slotKey, m.slotKind, m.candidate);
      if (!res.ok) {
        m.toast = `装备失败：${res.detail}`; // 如实回显，零写盘（事务内部保证）
        rerender();
        return;
      }
      reloadFromStore(); // 成功：从正式存档重读（车预览与 Run 同源）
      modal = null;
      rerender();
    });
    actions.append(go);
  }
  actions.append(cancel);

  return [title, compare, warn, actions];
}

function modalTitleOf(m: NonNullable<G2Modal> & { kind: 'compare' }): string {
  if (m.slotKind === 'body') return '车身';
  if (m.slotKind === 'weapon') return '武器';
  if (m.slotKind === 'gadget') return '辅助';
  return m.slotKey === 'front' ? '前轮' : '后轮';
}

/* ───────────── GARAGE-V2-FORMAL-FUSE-SLICE-R1｜真实五合一合成（正式 fuseQualityFive） ───────────── */

interface FuseGroup {
  kind: ItemSlotKind;
  quality: QualityTier;
  /** 互异实例（全部列出；确认时 = 主件 + 其余 4）。 */
  members: readonly ItemInstance[];
}

/**
 * 「当前满足同部位+同品质 ≥5」的**真实可合成组**（纯读数，不写任何东西）。
 *
 * 排除（Queue 必改 1 逐条）：
 *   - Body（无数量模型，结构性不可消耗）；
 *   - 非 consumable（旧 ★2..5 legacy-star-locked / 已装备 equipped 保护 / 封顶）；
 *   - 彩品质封顶（isMaxQuality，无可再升的品质）；
 *   - **非推进类 Gadget**（pushRod 等）：它们没有品质实效通道 ⇒ 不能作主件、
 *     不能产出「伪可穿戴」产物 —— 整组排除（普通件照常在背包显示，只是不能合成）。
 *     推进类判据 = `registry.functionals.get(defId).behavior === 'thruster'`（与
 *     equipQualityProduct 的 gadget 分支同一真源）。
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

/** 组标题字（部位+品质；不是名字、不是数量堆叠）。 */
function fuseGroupLabel(g: FuseGroup): string {
  return `${g.kind === 'weapon' ? '武器' : g.kind === 'gadget' ? '辅助' : '轮组'} · ${QUALITY_LABELS[g.quality]}`;
}

/**
 * 合成弹窗：只列真实可合成组 → 点一件为主件（产物保留该 defId）→ 系统确定性补
 * 同组其余 4 件 → 预览主件 → 下一品质（外形+颜色）→ 唯一【确认合成】调
 * `fuseQualityFive` 一次。失败如实回显（零写盘由事务保证）；成功重读正式存档 +
 * 刷新红点/候选；取消/关闭零写盘。**无星级栏 / 常驻材料空槽 / 名字 / 数量。**
 */
function fuseModal(m: NonNullable<G2Modal> & { kind: 'fuse' }): HTMLElement[] {
  const groups = fuseCandidateGroups();
  const title = elDiv('g2-modal-title', '合成（同部位 + 同品质 ×5 → 主件下一品质）');
  title.dataset['g2ModalTitle'] = '1';

  const wrap = elDiv('g2-bag-wrap');
  wrap.dataset['g2FuseGroups'] = '1';
  if (groups.length === 0) {
    // 无可合成组：只展示空说明，确认不可用（不造假）
    const empty = elDiv('g2-col-note', '当前没有满足「同部位+同品质 ≥5」的组（Body/旧星级锁定/彩件/非推进辅助不计）。');
    empty.dataset['g2FuseEmpty'] = '1';
    wrap.append(empty);
  }
  for (const g of groups) {
    const headRow = elDiv('g2-bag-head');
    headRow.dataset['g2FuseGroup'] = fuseGroupLabel(g);
    headRow.append(elDiv('g2-bag-title', fuseGroupLabel(g)));
    wrap.append(headRow);
    const mats = elDiv('g2-mats');
    mats.dataset['g2FuseGroupKind'] = g.kind;
    mats.dataset['g2FuseGroupQ'] = g.quality;
    for (const mem of g.members) {
      const isMain = fuseMainPick === mem.instanceId;
      const mat = el('button', 'g2-mat' + (isMain ? ' g2-mat-main' : ''));
      mat.type = 'button';
      mat.style.setProperty('--q', qualityHex(g.quality));
      mat.dataset['g2FuseMember'] = mem.instanceId;
      mat.dataset['g2FuseMain'] = String(isMain);
      mat.append(partIconNode(iconKindOf(g.kind), mem.defId));
      mat.addEventListener('click', () => {
        fuseMainPick = isMain ? null : mem.instanceId; // 再点取消
        rerender();
      });
      mats.append(mat);
    }
    wrap.append(mats);
  }

  // 产物预览（选了主件才有）：主件外形 → 下一品质（颜色 + 同 defId 外形）
  const previewWrap = elDiv('g2-bag-wrap');
  previewWrap.dataset['g2FusePreview'] = '1';
  const pickedGroup = fuseMainPick
    ? groups.find((g) => g.members.some((mm) => mm.instanceId === fuseMainPick)) ?? null
    : null;
  const pickedMain = pickedGroup && fuseMainPick
    ? pickedGroup.members.find((mm) => mm.instanceId === fuseMainPick) ?? null
    : null;
  if (pickedGroup && pickedMain) {
    const next = nextQuality(pickedGroup.quality);
    if (next) {
      const prev = elDiv('g2-compare');
      const colA = elDiv('g2-col');
      colA.append(elDiv('g2-col-tag', '主件（保留外形）'));
      colA.append(partIconNode(iconKindOf(pickedGroup.kind), pickedMain.defId));
      colA.append(elDiv('g2-col-q', `${QUALITY_LABELS[pickedGroup.quality]}品质`));
      const colB = elDiv('g2-col g2-col-new');
      colB.dataset['q'] = next;
      colB.append(elDiv('g2-col-tag', '将得到'));
      colB.append(partIconNode(iconKindOf(pickedGroup.kind), pickedMain.defId));
      colB.append(elDiv('g2-col-q', `${QUALITY_LABELS[next]}品质`));
      prev.append(colA, colB);
      previewWrap.append(prev);
    }
  }

  const warn = elDiv('g2-warn');
  warn.dataset['g2Warn'] = '1';
  warn.textContent = m.toast ?? (pickedMain ? '确认后消耗主件+4 件同组材料，产出一件事下一品质成品（可继续穿戴）。' : '点组内一件选为主件（成品保留它的外形）。');

  const actions = elDiv('g2-actions');
  const cancel = el('button', 'g2-btn', '取消');
  cancel.type = 'button';
  cancel.dataset['g2Action'] = 'cancel';
  cancel.addEventListener('click', () => {
    modal = null; // 取消零写盘：只关弹窗
    fuseMainPick = null;
    rerender();
  });
  const go = el('button', 'g2-btn g2-btn-primary', '确认合成');
  go.type = 'button';
  go.dataset['g2Action'] = 'fuse';
  go.disabled = !pickedMain; // 无主件 = 不可确认（4/5 组本来就不出现在候选里）
  go.addEventListener('click', () => {
    if (!pickedGroup || !pickedMain) return;
    // 系统确定性补齐同组其余 4 件（互异、排除主件本身）
    const mats = pickedGroup.members
      .filter((mm) => mm.instanceId !== pickedMain.instanceId)
      .slice(0, 4)
      .map((mm) => mm.instanceId);
    if (mats.length < 4) {
      m.toast = '合成失败：同组可补材料不足 4 件';
      rerender();
      return;
    }
    const res: QualityFuseResult = fuseQualityFive({
      mainInstanceId: pickedMain.instanceId,
      materialInstanceIds: mats,
      draft,
    });
    if (!res.ok) {
      m.toast = `合成失败：${res.detail}`; // 实际 reason 如实回显；事务零写盘
      rerender();
      return;
    }
    // 成功：从正式存档重读（库存/账本/装备同一次刷新），关弹窗、清主件选择；
    // 新产物立即出现在背包（可点击穿戴），红点随重算消失/更新。
    reloadFromStore();
    modal = null;
    fuseMainPick = null;
    rerender();
  });
  actions.append(cancel, go);

  return [title, wrap, previewWrap, warn, actions];
}

/* ────────────────────────── 杂项 ────────────────────────── */

function iconKindOf(slot: ItemSlotKind): 'weapon' | 'body' | 'movement' | 'gadget' {
  return slot;
}

function qualityHex(q: QualityTier): string {  return (
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
 * 正式 Garage V2 装备视图挂载（homePage 对【调整战车】默认调用；
 * 旧星级 Garage 仅 `?garageLegacy=1` 兼容测试入口可达）。
 * @param container 挂载容器（正式 stage）
 * @param draft0 初始 draft（由 homePage 从正式存档读入）
 * @param backAction 底部【返回】动作（homePage 注入：`view='home'; render()`）
 */
export function mountGarageV2View(
  container: HTMLElement,
  draft0: BuildDraft,
  backAction: () => void,
): void {
  root = container;
  draft = draft0;
  onClose = backAction;
  rerender();
}

/** Debug 只读探针（E2E/真人验收读数；与 __PRODUCTHOME__ 同一「只读」纪律）。 */
export function garageV2ViewProbe(): Record<string, unknown> {
  if (!root) return { mounted: false };
  const fuseGroups = fuseCandidateGroups();
  return {
    mounted: true,
    cells: root.querySelectorAll('[data-g2-cell]').length,
    slots: root.querySelectorAll('[data-g2-slot]').length,
    slotsEquipped: root.querySelectorAll('[data-g2-slot-def]').length,
    modal: root.querySelector('[data-g2-modal]')?.getAttribute('data-g2-modal') ?? null,
    /** 真实可合成组数（红点口径同源）。 */
    fuseReadyGroups: fuseGroups.length,
    fuseDot: root.querySelector('[data-g2-fuse-dot]')?.textContent ?? null,
    /** 弹窗内已选主件（null = 未选）。 */
    fuseMainPick: fuseMainPick,
    fuseMembers: root.querySelectorAll('[data-g2-fuse-member]').length,
    fuseConfirmDisabled: (root.querySelector('[data-g2-action="fuse"]') as HTMLButtonElement | null)?.disabled ?? null,
    gridTextFree: isGridTextFree(),
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

/** 验收 1 判据：背包格内**零**名字/数量/星级文本（角标「武/身/轮/辅」除外）。 */
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
