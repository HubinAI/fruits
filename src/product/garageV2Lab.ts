/**
 * GARAGE-V2-INVENTORY-LAYOUT-LAB-R1｜Garage 2.0 布局/交互验证 Lab 页面逻辑。
 *
 * ⚠️ 隔离：存储由入口壳（garageV2LabMain.ts）在 import 本模块**之前**绑定成
 *   内存 Map 后端 ⇒ 本页所有读写都发生在内存里，真实 localStorage 零接触。
 *   本模块自身**不读 localStorage、不读 platform.storage**（遵循页面模块纪律）。
 *
 * 验证目标（用户拍板的 Garage 2.0 视觉结构，Queue 必改 1）：
 *   中上成品战车预览（正式 sprite 同源）/ 左右五个穿戴槽
 *   / 下方单件图标背包（品质边框 + 部位角标，**不显示**名字/数量/星级/不堆叠）
 *   / 合成按钮在背包标题右上 / 底部仅返回。
 *
 * 品质边界（必改 2：不得冒充）：
 *   - 品质产物（qv2）未接正式 Run 战斗 ⇒ 装备候选对比里明确「未接入战斗」，
 *     **本页不提供任何把 qv2 写进正式装备的入口**；
 *   - 旧 ★2..★5（legacy-star-locked）与 Body（body-not-consumable）如置灰并直白说明；
 *   - 「合成」= 真实调用 `fuseQualityFive`（存储在隔离 Map ⇒ 写了也不碰真档），
 *     选主件 → 系统确定性补 4 材料 → 产物外形可见 → 一键确认。
 */
import {
  QUALITY_LABELS,
  effectiveInventory,
  fuseQualityFive,
  isMaxQuality,
  nextQuality,
  projectItemInstances,
  type ItemInstance,
  type ItemSlotKind,
  type QualityFuseResult,
  type QualityTier,
} from './garageV2Quality';
import { defaultPlayerDraft, loadEquippedDraft } from './playerLoadout';
import { savePlayerBuild } from '../core/buildPersistence';
import { addPart, defaultInventory, saveInventory } from '../core/partInventory';
import { grantBody } from '../core/bodyOwnership';
import type { BuildDraft } from '../lab/buildEditorModel';
import { partIconNode } from './partIcon';
import { vehiclePreviewLayout, type VehiclePreviewLayout } from './vehiclePreview';

/* ────────────────────────── 常量 / 小工具 ────────────────────────── */

/** 五个穿戴槽（页面顺序：左列 body/front，右列 weapon/rear；gadget 独立一行跨列）。 */
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

/* ──────────────────────── Lab 专用确定性 fixture（必改 2） ──────────────────────── */

/**
 * **内存内** fixture：只往隔离 Map 后端写。
 * 覆盖：多品质产物（绿/蓝 qv2）、多武器白件 ≥5（可合成）、旧 ★2（锁定）、
 * Body 拥有若干（不可消耗）。**绝不**触碰任何正式 key 语义之外的东西——
 * 而且这些 key 全在内存 Map 里，页面关闭即消失。
 */
function seedLabFixture(): void {
  const inv = defaultInventory();
  // 白 ★1 武器：cannon ×5（可合成组）、machineGun ×7、hammer ×6、pushRod ×4（不足 5）
  addPart(inv, 'cannon', 1, 5);
  addPart(inv, 'machineGun', 1, 7);
  addPart(inv, 'hammer', 1, 6);
  addPart(inv, 'pushRod', 1, 4);
  // 旧 ★2 一件（legacy-star-locked 演示）
  addPart(inv, 'shotgun', 2, 1);
  // 白 ★1 轮组若干（movement 单件格演示；wheelStd 不进库存——用真实登记的轮组）
  addPart(inv, 'smallWheel', 1, 3);
  addPart(inv, 'largeWheel', 1, 2);
  saveInventory(inv);
  // Body：拥有两台（投影为不可消耗件）
  grantBody('watermelonBody');
  grantBody('mangoBody');
  // Build：默认车（cannon / watermelon）
  savePlayerBuild(defaultPlayerDraft());
  // 品质产物（qv2）：直接预置账本形状的绿/蓝件（隔离 Map 内演示多品质格子）
  const LEDGER_KEY = 'strongfruit.garageV2Ledger.v1';
  isolatedLedgerSeed(LEDGER_KEY);
}

/** 往隔离 Map 写一份 v2 账本 fixture（绿 machineGun ×1 + 蓝 cannon ×1）。 */
function isolatedLedgerSeed(key: string): void {
  // 走 platform 无关的直写：入口壳已绑定隔离 core，这里用 module-scope Map 的 getter。
  // （本模块不 import platform —— 由 garageV2LabMain 暴露的桥写入；见 bottom。）
  writeIsolated(
    key,
    JSON.stringify({
      __v: 1,
      version: 2,
      consumed: {},
      products: [
        { defId: 'machineGun', quality: 'green', seq: 1 },
        { defId: 'cannon', quality: 'blue', seq: 1 },
      ],
    }),
  );
}

/* ── 隔离写桥：由入口壳注入（避免本模块直接依赖 platform 细节） ── */
let writeIsolated: (key: string, value: string) => void = () => {
  throw new Error('[garage-v2-lab] 隔离写桥未注入');
};

/** 入口壳调用：注入隔离 Map 的写通道（仅 Lab 页面用）。 */
export function bindLabIsolatedStorage(write: (key: string, value: string) => void): void {
  writeIsolated = write;
}

/* ────────────────────────── 页面状态（纯视图） ────────────────────────── */

type G2Modal =
  | { kind: 'compare'; slot: ItemSlotKind; candidate: ItemInstance }
  | { kind: 'fuse' }
  | null;

let draft: BuildDraft;
let modal: G2Modal = null;
let fuseMainPick: string | null = null; // 合成弹窗里选中的主件实例 id
let root: HTMLElement;

/* ────────────────────────── 数据读数（全走 COH 契约） ────────────────────────── */

function instances(): readonly ItemInstance[] {
  return projectItemInstances(effectiveInventory(draft), draft);
}

/** 当前 Build 各槽装备的实例 id（供槽位渲染与「使用中」判断；stack 级）。 */
function equippedOfSlot(kind: ItemSlotKind): { defId: string; star: number } | null {
  if (kind === 'body') return { defId: draft.bodyDefId, star: 1 };
  if (kind === 'weapon') {
    const defId = draft.functionalSelections['frontMass'] ?? 'none';
    if (defId === 'none') return null;
    return { defId, star: draft.functionalStars?.['frontMass'] ?? 1 };
  }
  if (kind === 'gadget') {
    const defId = draft.gadgetDefId ?? 'none';
    return defId === 'none' ? null : { defId, star: 1 };
  }
  // movement：kind 只是 'movement'，具体前后由调用方传槽 key —— 这里不分支
  return null;
}

function equippedMovement(slotKey: 'front' | 'rear'): { defId: string } | null {
  const defId = slotKey === 'front' ? draft.frontWheelDefId : draft.rearWheelDefId;
  if (!defId) return { defId: 'wheelStd' }; // 缺省 = 标准轮（不进库存，仍如实展示）
  return { defId };
}

/* ────────────────────────── 渲染 ────────────────────────── */

function rerender(): void {
  root.textContent = '';
  root.append(buildHead(), buildStage(), buildSlotsRow(), buildBag(), buildFoot());
  const m = modal;
  if (m) root.append(buildModal(m));
}

function buildHead(): HTMLElement {
  const head = elDiv('g2-head', 'Garage V2 · 布局 Lab（隔离存储）');
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

/** 与 homePage.renderPreview 同口径的纯 DOM 预览（正式 sprite 同源）。 */
function previewNodes(layout: VehiclePreviewLayout): HTMLElement[] {
  const nodes: HTMLElement[] = [];
  const ordered = [...layout.items].sort((a, b) => a.layer - b.layer);
  const bx = (layout.minX + layout.maxX) / 2;
  const by = (layout.minY + layout.maxY) / 2;
  for (const it of ordered) {
    const url = it.visualId ? spriteUrlOf(it.visualId) : undefined;
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

/** 正式 visualId → 正式资源 URL（与战斗/RunPage 同一批 PNG；Vite 静态 import）。 */
function spriteUrlOf(visualId: string): string | undefined {
  return SPRITE_URLS[visualId];
}

function buildSlotsRow(): HTMLElement {
  const row = elDiv('g2-slots-row');
  row.dataset['g2Slots'] = '1';
  const left = elDiv('g2-slots-col');
  const right = elDiv('g2-slots-col');
  for (const s of G2_SLOTS) {
    const eq =
      s.kind === 'movement'
        ? equippedMovement(s.key as 'front' | 'rear')
        : equippedOfSlot(s.kind);
    const defId = eq?.defId ?? null;
    const btn = el('button', 'g2-slot' + (defId ? ' g2-slot-eq' : ''));
    btn.type = 'button';
    btn.dataset['g2Slot'] = s.key;
    btn.dataset['g2SlotKind'] = s.kind;
    if (defId) {
      btn.dataset['g2SlotDef'] = defId;
      btn.append(partIconNode(s.kind === 'body' ? 'body' : s.kind, defId, s.label));
      btn.append(elDiv('g2-slot-kind', s.label));
    } else {
      btn.append(elDiv('g2-slot-empty', '空'));
      btn.append(elDiv('g2-slot-kind', s.label));
    }
    // 槽点击 = 打开该部位的候选对比（从背包实例里挑该部位第一件做直观演示）
    btn.addEventListener('click', () => {
      const inst = instances().find((i) => i.slot === s.kind);
      if (inst) {
        modal = { kind: 'compare', slot: s.kind, candidate: inst };
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
  // 合成按钮：只有真实可合成组才亮红点数量（与正式 Queue 契约同口径）
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
    fuseMainPick = null;
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
    modal = { kind: 'compare', slot: inst.slot, candidate: inst };
    rerender();
  });
  return cell;
}

function buildFoot(): HTMLElement {
  const foot = elDiv('g2-foot');
  foot.dataset['g2Foot'] = '1';
  const back = el('button', 'g2-back', '返回（Lab 无上一页 · 仅演示）');
  back.type = 'button';
  back.dataset['g2Back'] = '1';
  back.addEventListener('click', () => {
    window.alert('[garage-v2-lab] 这是独立 Lab 页：返回动作在正式 Garage 2.0 落地时接 home.html');
  });
  foot.append(back);
  return foot;
}

/* ────────────────────────── 弹窗 ────────────────────────── */

function buildModal(m: NonNullable<G2Modal>): HTMLElement {
  const mask = elDiv('g2-mask');
  mask.dataset['g2Mask'] = '1';
  const card = elDiv('g2-modal');
  card.dataset['g2Modal'] = m.kind;
  if (m.kind === 'compare') card.append(...compareModal(m));
  else card.append(...fuseModal());
  mask.append(card);
  // 点 mask 空白关闭（不点在卡片上）
  mask.addEventListener('click', (e) => {
    if (e.target === mask) {
      modal = null;
      rerender();
    }
  });
  return mask;
}

/** 「当前装备 / 新件」直观图形对比（必改 2：真实对比 + 不得假成功）。 */
function compareModal(m: Extract<G2Modal, { kind: 'compare' }>): HTMLElement[] {
  const cur =
    m.slot === 'movement' ? equippedMovement('front') : equippedOfSlot(m.slot);
  const curDefId = cur?.defId ?? null;

  const title = elDiv('g2-modal-title', m.slot === 'body' ? '车身' : m.slot === 'weapon' ? '武器' : m.slot === 'gadget' ? '辅助' : '轮组');
  title.dataset['g2ModalTitle'] = '1';

  const compare = elDiv('g2-compare');
  const colCur = elDiv('g2-col');
  colCur.dataset['g2Col'] = 'current';
  colCur.append(elDiv('g2-col-tag', '当前装备'));
  colCur.append(curDefId ? partIconNode(iconKindOf(m.slot), curDefId) : elDiv('g2-col-note', '空'));
  colCur.append(elDiv('g2-col-q', curDefId ? '' : '—'));

  const colNew = elDiv('g2-col g2-col-new');
  colNew.dataset['g2Col'] = 'new';
  colNew.dataset['q'] = m.candidate.quality;
  colNew.append(elDiv('g2-col-tag', '背包选中'));
  colNew.append(partIconNode(iconKindOf(m.slot), m.candidate.defId));
  colNew.append(elDiv('g2-col-q', `${QUALITY_LABELS[m.candidate.quality]}品质`));
  const note = elDiv(
    'g2-col-note',
    m.candidate.lockedReason ? lockedText(m.candidate.lockedReason) : '可装备（正式语义）',
  );
  note.dataset['g2ColNote'] = '1';
  colNew.append(note);
  compare.append(colCur, colNew);

  const warn = elDiv('g2-warn');
  warn.dataset['g2Warn'] = '1';
  if (m.candidate.quality !== 'white') {
    warn.textContent =
      '品质件尚未接入正式 Run 战斗（强度映射待设计决策）：本 Lab 不能演示它的正式换装落盘。';
  } else if (m.candidate.legacyStar !== null && m.candidate.legacyStar > 1) {
    warn.textContent = `旧 ★${m.candidate.legacyStar} 成长件：品质模型尚无对等映射，已锁定不可作为材料。`;
  } else {
    warn.textContent = '本页是隔离 Lab：所有读写都发生在内存里，不碰真实存档。';
  }

  const actions = elDiv('g2-actions');
  const cancel = el('button', 'g2-btn', '关闭');
  cancel.type = 'button';
  cancel.dataset['g2Action'] = 'close';
  cancel.addEventListener('click', () => {
    modal = null;
    rerender();
  });
  actions.append(cancel);
  return [title, compare, warn, actions];
}

/** 合成弹窗：只列合格组 → 选主件 → 自动 4 材料 → 产物外形预览 → 一键确认。 */
function fuseModal(): HTMLElement[] {
  const groups = fuseCandidateGroups();
  const title = elDiv('g2-modal-title', '合成（同部位 + 同品质 ×5 → 主件下一品质）');
  title.dataset['g2ModalTitle'] = '1';

  const wrap = elDiv('g2-bag-wrap');
  if (groups.length === 0) {
    const empty = elDiv('g2-col-note', '当前没有满足「同部位+同品质 ≥5」的组（Body/锁定/彩件不计）。');
    empty.dataset['g2FuseEmpty'] = '1';
    wrap.append(empty);
  }
  for (const g of groups) {
    // 每组：组头（部位+品质）+ 成员格（点选主件）
    const headRow = elDiv('g2-bag-head');
    headRow.dataset['g2FuseGroup'] = `${slotLabel(g.kind)} · ${QUALITY_LABELS[g.quality]} ×${g.members.length}`;
    headRow.append(elDiv('g2-bag-title', headRow.dataset['g2FuseGroup']));
    wrap.append(headRow);
    const mats = elDiv('g2-mats');
    for (const mem of g.members) {
      const isMain = fuseMainPick === mem.instanceId;
      const mat = el('button', 'g2-mat');
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

  // 产物预览（选了主件才有）
  const pickedGroup = groups.find((g) => g.members.some((m) => m.instanceId === fuseMainPick));
  const previewWrap = elDiv('g2-bag-wrap');
  previewWrap.dataset['g2FusePreview'] = '1';
  if (pickedGroup && fuseMainPick) {
    const main = pickedGroup.members.find((m) => m.instanceId === fuseMainPick)!;
    const next = nextQuality(pickedGroup.quality)!;
    const prev = elDiv('g2-compare');
    const colA = elDiv('g2-col');
    colA.append(elDiv('g2-col-tag', '主件（保留外形）'));
    colA.append(partIconNode(iconKindOf(pickedGroup.kind), main.defId));
    const colB = elDiv('g2-col g2-col-new');
    colB.dataset['q'] = next;
    colB.append(elDiv('g2-col-tag', '将得到'));
    colB.append(partIconNode(iconKindOf(pickedGroup.kind), main.defId));
    colB.append(elDiv('g2-col-q', `${QUALITY_LABELS[next]}品质 · ${main.name}`));
    prev.append(colA, colB);
    previewWrap.append(prev);
  }

  const warn = elDiv('g2-warn', '隔离 Lab：合成真实执行但只写内存，不碰真实存档。');
  warn.dataset['g2Warn'] = '1';

  const actions = elDiv('g2-actions');
  const cancel = el('button', 'g2-btn', '关闭');
  cancel.type = 'button';
  cancel.dataset['g2Action'] = 'close';
  cancel.addEventListener('click', () => {
    modal = null;
    rerender();
  });
  const go = el('button', 'g2-btn g2-btn-primary', '确认合成');
  go.type = 'button';
  go.dataset['g2Action'] = 'fuse';
  go.disabled = !pickedGroup;
  go.addEventListener('click', () => {
    if (!pickedGroup || !fuseMainPick) return;
    const mats = pickedGroup.members.filter((m) => m.instanceId !== fuseMainPick).slice(0, 4);
    const res: QualityFuseResult = fuseQualityFive({
      mainInstanceId: fuseMainPick,
      materialInstanceIds: mats.map((m) => m.instanceId),
      draft,
    });
    // 失败如实回显（不吞）；成功弹窗关闭、红点即时刷新
    if (!res.ok) {
      window.alert(`[garage-v2-lab] 合成失败：${res.detail}`);
      return;
    }
    modal = null;
    fuseMainPick = null;
    rerender();
  });
  actions.append(cancel, go);

  return [title, wrap, previewWrap, warn, actions];
}

/* ────────────────────────── 合成候选（页面侧纯读数） ────────────────────────── */

interface FuseGroup {
  kind: ItemSlotKind;
  quality: QualityTier;
  /** 互异实例（≤5 全列；确认时取主件 + 其余 4）。 */
  members: readonly ItemInstance[];
}

/**
 * 「当前满足同部位+同品质 ≥5」的组（排除 body / 旧锁定 / 封顶 / 不可消耗）。
 * 纯读数：只看 `projectItemInstances`，不写任何东西。
 */
function fuseCandidateGroups(): readonly FuseGroup[] {
  const byKey = new Map<string, ItemInstance[]>();
  for (const inst of instances()) {
    if (inst.slot === 'body') continue; // Body 无数量模型 ⇒ 明确不可合
    if (!inst.consumable) continue; // 锁定（旧 ★2..5 / 装备中 stack 语义）/ 封顶
    if (isMaxQuality(inst.quality)) continue;
    const key = `${inst.slot}|${inst.quality}`;
    const arr = byKey.get(key) ?? [];
    arr.push(inst);
    byKey.set(key, arr);
  }
  const out: FuseGroup[] = [];
  for (const [key, arr] of byKey) {
    if (arr.length < 5) continue;
    const [kind, quality] = key.split('|') as [ItemSlotKind, QualityTier];
    out.push({ kind, quality, members: arr });
  }
  return out;
}

/* ────────────────────────── 杂项 ────────────────────────── */

function iconKindOf(slot: ItemSlotKind): 'weapon' | 'body' | 'movement' | 'gadget' {
  return slot; // ItemSlotKind 与 PartIconKind 四值同构
}

function slotLabel(kind: ItemSlotKind): string {
  return kind === 'weapon' ? '武器' : kind === 'body' ? '车身' : kind === 'gadget' ? '辅助' : '轮组';
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

function lockedText(reason: NonNullable<ItemInstance['lockedReason']>): string {
  return reason === 'equipped'
    ? '装备中（stack 保护）'
    : reason === 'body-not-consumable'
      ? '车身不参与合成消耗'
      : reason === 'max-quality'
        ? '彩品质：封顶不可再合'
        : reason === 'legacy-star-locked'
          ? '旧星级成长件：品质映射未定，锁定'
          : '不可消耗';
}

/* 正式 sprite（与 homePage 同一批 PNG 静态 import；缺美术件走矢量回退）。 */
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

/* ────────────────────────── 页面唯一入口 ────────────────────────── */

/** Lab 页面挂载入口（由 garageV2LabMain 调用）。 */
export function mountGarageV2Lab(container: HTMLElement): void {
  root = container;
  seedLabFixture();
  draft = loadEquippedDraft();
  rerender();
  // 把 Debug 句柄挂出来（E2E/真人验收读数用；与正式 __PRODUCTHOME__ 无关）
  (globalThis as { __GARAGEV2LAB__?: unknown }).__GARAGEV2LAB__ = {
    probe: () => {
      const insts = instances();
      return {
        cells: root.querySelectorAll('[data-g2-cell]').length,
        slots: root.querySelectorAll('[data-g2-slot]').length,
        fuseReadyGroups: fuseCandidateGroups().length,
        fuseDot: root.querySelector('[data-g2-fuse-dot]')?.textContent ?? null,
        modal: (modal as { kind: string } | null)?.kind ?? null,
        qualitySpread: [...new Set(insts.map((i) => i.quality))],
        lockedCells: insts.filter((i) => i.lockedReason).map((i) => i.lockedReason),
      };
    },
  };
}
