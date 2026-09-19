/**
 * PRP-M3-CONTENT-BATCH-01｜M3 内容批次验证台的**页面壳**（DOM 渲染 + 事件绑定）。
 *
 * 与 `contentBatch.ts` 的分工：那边是纯逻辑（可 node 侧单测），这边只负责
 * 「把状态画出来 + 把点击接回纯逻辑」，不含任何判定。
 *
 * 页面结构（Queue 原文「切内容 → 验证 → Reset → 下一项」）：
 *   1) 顶部：三项内容的切换按钮（顺序 = 批次顺序）；
 *   2) 中部舞台：
 *      · `ready` 事件 → 标题 + 当前读数（耐久 / Build）+ **固定二选一**按钮；
 *      · `blocked` 内容 → 如实展示 BLOCK 理由与 file:line 证据（**不伪造一场战斗**）；
 *   3) 底部控件：`Reset`（还原到进入本内容那一刻）/ `下一项`（顺序推进）/
 *      耐久条件（受损 · 满耐久，仅用于对照「同一事件在不同耐久下是否产生不同选择」）。
 *
 * ⚠️ 本页**没有画布、没有物理、没有战斗运行时** —— 两项内容都是非战斗事件，
 *    所以「清场后无 projectile / entity / listener 残留」在结构上不可能被违反：
 *    本页从头到尾没有创建过这些东西（`dispose` 语义不存在不适用）。
 *
 * ⚠️ 耐久上限不写死：由正式链路 `buildSpawnPlan(...).player.hp` 读出（= 正式 resolved body.hp）。
 */

import { RUN_DEMO_ENCOUNTER_ID, RUN_DEMO_LOADOUT_ID } from './runPageScene';
import { buildSpawnPlan } from './entities';
import type { RunModifierId } from './runModifiers';
import {
  CONTENT_BATCH_IDS,
  contentBatchChoose,
  contentBatchItem,
  contentBatchProblems,
  contentBatchReset,
  contentBatchSelect,
  contentBatchSetHpCase,
  createContentBatchState,
  hpForCase,
  nextContentBatchId,
  repairAmount,
  type ContentBatchHpCase,
  type ContentBatchItemId,
  type ContentBatchItem,
  type ContentBatchState,
} from './contentBatch';

export const CONTENT_BATCH_TITLE = 'M3 内容批次';
export const CONTENT_BATCH_SUBTITLE = 'Content Batch';
export const CONTENT_BATCH_LEAD = '一次启动 · 连续切三项 · 一段录像批量验收';
export const CONTENT_BATCH_RESET_LABEL = 'Reset';
export const CONTENT_BATCH_NEXT_LABEL = '下一项';

/** 只读诊断句柄（E2E 只能读，不能借它改状态）。 */
export interface ContentBatchDebugHandle {
  probe(): {
    readonly activeId: string;
    readonly items: readonly { readonly id: string; readonly label: string; readonly status: string; readonly kind: string }[];
    readonly optionIds: readonly string[];
    readonly chosenOptionId: string | null;
    readonly hp: number;
    readonly hpMax: number;
    readonly hpCase: string;
    readonly owned: readonly string[];
    readonly entryHp: number;
    readonly logCount: number;
    readonly blockedEvidence: number;
    readonly canvasCount: number;
    readonly buttonCount: number;
  };
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

/** 页面唯一入口（由 `content-batch.html` 用 `<script type="module">` 加载）。 */
export function mountContentBatch(root: HTMLElement): ContentBatchDebugHandle {
  // ① 正式链路读出玩家耐久上限（不写死 1100；换 Loadout / Encounter 这里跟着变）。
  const hpMax = buildSpawnPlan(RUN_DEMO_LOADOUT_ID, RUN_DEMO_ENCOUNTER_ID).player.hp;

  let state: ContentBatchState = createContentBatchState(CONTENT_BATCH_IDS[0], hpMax, 'damaged');

  /* ------------------------------------------------------------ DOM 骨架 */

  const head = el('header', 'cbatch-head');
  head.append(
    el('h1', 'cbatch-title', CONTENT_BATCH_TITLE),
    el('p', 'cbatch-lead', CONTENT_BATCH_LEAD),
  );
  const scopeNote = el('p', 'cbatch-scope');
  scopeNote.textContent =
    '本页只做内容验证：非战斗事件只改「现有耐久 / 现有 Build」，不新增资源、不新增 Buff、不改任何数值。';
  head.append(scopeNote);

  const switcher = el('nav', 'cbatch-switcher');
  const switcherBtns = new Map<ContentBatchItemId, HTMLButtonElement>();
  for (const id of CONTENT_BATCH_IDS) {
    const item = contentBatchItem(id);
    const b = el('button', 'cbatch-btn');
    b.type = 'button';
    b.dataset['cbatchItem'] = id;
    b.textContent = `${item.label}${item.status === 'blocked' ? '（BLOCK）' : ''}`;
    b.addEventListener('click', () => {
      state = contentBatchSelect(state, id);
      render();
    });
    switcherBtns.set(id, b);
    switcher.append(b);
  }

  const stage = el('section', 'cbatch-stage');

  const controls = el('div', 'cbatch-controls');
  const resetBtn = el('button', 'cbatch-btn cbatch-btn-reset', CONTENT_BATCH_RESET_LABEL);
  resetBtn.type = 'button';
  resetBtn.dataset['cbatchAction'] = 'reset';
  resetBtn.addEventListener('click', () => {
    state = contentBatchReset(state);
    render();
  });
  const nextBtn = el('button', 'cbatch-btn', CONTENT_BATCH_NEXT_LABEL);
  nextBtn.type = 'button';
  nextBtn.dataset['cbatchAction'] = 'next';
  nextBtn.addEventListener('click', () => {
    state = contentBatchSelect(state, nextContentBatchId(state.activeId));
    render();
  });
  controls.append(resetBtn, nextBtn);

  const caseBar = el('div', 'cbatch-cases');
  caseBar.append(el('span', 'cbatch-case-label', '耐久条件'));
  const caseBtns = new Map<ContentBatchHpCase, HTMLButtonElement>();
  for (const hpCase of ['damaged', 'full'] as const) {
    const b = el('button', 'cbatch-btn cbatch-btn-case');
    b.type = 'button';
    b.dataset['cbatchCase'] = hpCase;
    b.textContent = hpCase === 'damaged' ? '受损' : '满耐久';
    b.addEventListener('click', () => {
      state = contentBatchSetHpCase(state, hpCase);
      render();
    });
    caseBtns.set(hpCase, b);
    caseBar.append(b);
  }

  const problems = el('ul', 'cbatch-problems');
  const problemsList = contentBatchProblems();
  if (problemsList.length === 0) {
    problems.hidden = true;
  } else {
    for (const p of problemsList) problems.append(el('li', undefined, p));
  }

  root.append(head, switcher, caseBar, stage, controls, problems);

  /* ------------------------------------------------------------- 渲染 */

  function renderBlocked(item: ContentBatchItem): void {
    const box = el('div', 'cbatch-blocked');
    box.append(el('h2', 'cbatch-stage-title', `${item.label}｜BLOCK`));
    box.append(el('p', 'cbatch-blocked-reason', item.blocked?.reason ?? ''));
    const ev = el('ul', 'cbatch-evidence');
    for (const line of item.blocked?.evidence ?? []) ev.append(el('li', undefined, line));
    box.append(ev);
    box.append(el('p', 'cbatch-blocked-needs', `解除需要：${item.blocked?.needs ?? ''}`));
    box.append(
      el(
        'p',
        'cbatch-blocked-note',
        '本项按 Queue 原文如实标记 BLOCK，不自行扩大开发范围（不伪造多单位战斗、不新建多车宿主）。',
      ),
    );
    stage.append(box);
  }

  function renderReading(): void {
    const bar = el('div', 'cbatch-reading');
    bar.append(
      el('span', 'cbatch-hp', `耐久 ${Math.round(state.current.hp)} / ${state.hpMax}`),
      el(
        'span',
        'cbatch-owned',
        `Build ${state.current.owned.length === 0 ? '（基础）' : state.current.owned.join(' + ')}`,
      ),
    );
    stage.append(bar);
  }

  function renderEvent(item: ContentBatchItem): void {
    stage.append(el('h2', 'cbatch-stage-title', item.title));
    stage.append(el('p', 'cbatch-stage-lead', item.verifies));
    renderReading();

    const opts = el('div', 'cbatch-options');
    for (const o of item.options) {
      const b = el('button', 'cbatch-option');
      b.type = 'button';
      b.dataset['cbatchOption'] = o.id;
      b.disabled = state.chosenOptionId !== null;
      if (state.chosenOptionId === o.id) b.classList.add('cbatch-option-chosen');
      b.append(el('span', 'cbatch-option-label', o.label), el('span', 'cbatch-option-note', o.note));
      b.addEventListener('click', () => {
        state = contentBatchChoose(state, o.id);
        render();
      });
      opts.append(b);
    }
    stage.append(opts);

    if (state.chosenOptionId !== null) {
      const detail =
        item.id === 'RepairStation'
          ? `本次维修量（沿用正式 Repair Foundation 的 EMERGENCY_REPAIR_FRACTION）：${repairAmount(state.hpMax)}`
          : '本项写入的是现有 Modifier 状态（没有第二套容器）';
      stage.append(el('p', 'cbatch-choice-note', `已选择：${state.chosenOptionId} · ${detail}`));
    }
    if (state.log.length > 0) {
      const log = el('ul', 'cbatch-log');
      for (const line of state.log) log.append(el('li', undefined, line));
      stage.append(log);
    }
  }

  function render(): void {
    for (const [id, b] of switcherBtns) b.classList.toggle('cbatch-btn-active', id === state.activeId);
    for (const [hpCase, b] of caseBtns) b.classList.toggle('cbatch-btn-active', hpCase === state.hpCase);
    resetBtn.disabled = false;

    stage.replaceChildren();
    const item = contentBatchItem(state.activeId, state.current.owned);
    if (item.status === 'blocked') renderBlocked(item);
    else renderEvent(item);

    // 右侧「本项要回答什么」常驻（三项都显示，便于录像里一眼看到验证目标）。
    const goal = el('p', 'cbatch-goal', `本项验证：${item.verifies}`);
    stage.append(goal);
  }

  render();

  /* ------------------------------------------------------------- 句柄 */

  const handle: ContentBatchDebugHandle = {
    probe: () => ({
      activeId: state.activeId,
      items: CONTENT_BATCH_IDS.map((id) => {
        const it = contentBatchItem(id);
        return { id, label: it.label, status: it.status, kind: it.kind };
      }),
      optionIds: contentBatchItem(state.activeId, state.current.owned).options.map((o) => o.id),
      chosenOptionId: state.chosenOptionId,
      hp: state.current.hp,
      hpMax: state.hpMax,
      hpCase: state.hpCase,
      owned: [...state.current.owned],
      entryHp: state.entry.hp,
      logCount: state.log.length,
      blockedEvidence: contentBatchItem(state.activeId).blocked?.evidence.length ?? 0,
      canvasCount: root.querySelectorAll('canvas').length,
      buttonCount: root.querySelectorAll('button').length,
    }),
  };
  (globalThis as { __CONTENTBATCH__?: ContentBatchDebugHandle }).__CONTENTBATCH__ = handle;

  // 「受损」档位的一条可读说明（录像里能看出两个档位分别是什么耐久）。
  scopeNote.textContent += `（受损 = ${hpForCase(hpMax, 'damaged')} · 满耐久 = ${hpForCase(hpMax, 'full')}）`;

  return handle;
}

/** node 侧不需要 DOM，但保留一个显式类型出口便于测试引用。 */
export type ContentBatchOwned = readonly RunModifierId[];

/* --------------------------------------------------------------- 自挂载 */

function boot(): void {
  const root = document.getElementById('cbatch-root');
  if (!root) throw new Error('[PRP-M3] 缺少 #cbatch-root 容器');
  mountContentBatch(root);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
