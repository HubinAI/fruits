/**
 * PRP-VALIDATION-HUB-R1｜验证中心入口（独立页面：`/validation-hub.html`）。
 *
 * 这不是产品入口，也**不是**一个新的验证台 —— 它只是把已经存在的三个验证入口
 * 摆到一页上，让人不必再记 URL / 命令：
 *
 *     一次启动（npm run dev:validation） → 连续切换 → 一段录像批量验收
 *
 * ── 它**不做什么**（Queue 禁止项）───────────────────────────────────────────
 *   - 不改正式 Run / 不改 Gameplay / 不改任何数值；
 *   - 不做新的 Debug 系统：本页**没有画布**，不画也不读任何运行期数据；
 *   - 不把历史 Lab 全接进来（只有 Queue 点名的三个）；
 *   - 不往玩家画面注入控件（见下）。
 *
 * ── 切换方式 = 整页导航（有意选择，不是退让）────────────────────────────────
 * 点卡片 = 浏览器加载那个入口页面**本身**（真实 `<a href>`），于是：
 *
 *   ① **保真**：Full Run 的入口就是玩家正式页面 `run-page.html`（与 `npm run dev`
 *      的落地页逐字节同一个文件）。如果在 Hub 里另造一套宿主去 `new RunPage(...)`，
 *      那么「Hub 里录下来的」就不再是「玩家看到的那一页」—— 那是验证保真度的净损失。
 *   ② **清理**：整页导航 = 文档销毁 ⇒ 上一项的 Runtime / 弹丸 / 接触 / 计时器 /
 *      监听器 / Run-local state **一起消失**，不需要宿主逐个记得 dispose。
 *      （`RunPage` 与 `EncounterLab` 其实都带 `dispose()`；本条不是「做不到」，
 *        而是「浏览器连忘掉都会替你忘」——按 Queue「优先稳定」取后者。）
 *   ③ **单源**：不复制第二套宿主逻辑，Hub 版与独立版不可能出现两套口径。
 *
 * 代价：入口页面里**没有**「返回验证中心」的按钮 —— 加按钮就要改到正式玩家页面
 * （`run-page.html`），那是 Queue 明令禁止的。返回方式是浏览器后退（本页底部写明）。
 *
 * 隔离：
 *   - 独立 HTML（`validation-hub.html`）+ 独立脚本，**不进入**任何正式构建
 *     （`npm run build` / `build:pages` / `build:e2e` / `build:wechat` 零影响）；
 *   - **默认开发入口完全不变**：`npm run dev` 仍落在玩家页面（根路径重写规则未动），
 *     本页只由 `npm run dev:validation`（或显式访问 `/validation-hub.html`）打开；
 *   - 本文件只 import `./validationHub`（那份表本身），import 图里没有任何
 *     战斗 / 物理 / 正式 Runtime —— Hub 的 chunk 里不含玩法代码。
 *
 * 开发：`npm run dev:validation` → http://127.0.0.1:5173/validation-hub.html
 * 构建：`npm run build:portrait-lab` → dist-portrait-lab/（含 validation-hub.html）
 *
 * 整块删除清单见本目录 constants.ts 头部注释。
 */
import {
  VALIDATION_HUB_BACK_HINT,
  VALIDATION_HUB_ENTRIES,
  VALIDATION_HUB_LEAD,
  VALIDATION_HUB_SCOPE_NOTE,
  VALIDATION_HUB_SUBTITLE,
  VALIDATION_HUB_SWITCH_NOTE,
  VALIDATION_HUB_TITLE,
  nextValidationHubEntry,
  readValidationHubLastEntry,
  validationHubEntryById,
  writeValidationHubLastEntry,
  type ValidationHubEntry,
  type ValidationHubStore,
} from './validationHub';

/** 只读诊断句柄（仅本页面存在；不显示给用户，也不进入任何正式构建产物）。 */
interface ValidationHubDebugHandle {
  probe: () => unknown;
}

/**
 * 存储可能被浏览器策略禁用（无痕 / 受限上下文）。
 * 拿不到就当**没有这个功能**：`read` 退化成「没来过」，`write` 静默失败 —— 导航本身不受影响。
 */
function hubStore(): ValidationHubStore | null {
  try {
    const raw = window.sessionStorage;
    if (raw === undefined || raw === null) return null;
    return {
      getItem: (key: string): string | null => raw.getItem(key),
      setItem: (key: string, value: string): void => {
        raw.setItem(key, value);
      },
    };
  } catch {
    return null;
  }
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function boot(): void {
  const root = document.getElementById('vhub-root');
  if (!root) {
    // 页面缺失容器：明确报错（不静默白屏）
    throw new Error('[PRP-VALIDATION-HUB] 未找到 #vhub-root 容器');
  }

  const store = hubStore();

  /* ---------------------------------------------------------------- 头部 */
  const head = el('header', 'vhub-head');
  head.appendChild(el('h1', 'vhub-title', `${VALIDATION_HUB_TITLE}｜${VALIDATION_HUB_SUBTITLE}`));
  head.appendChild(el('p', 'vhub-lead', VALIDATION_HUB_LEAD));
  const marker = el('p', 'vhub-marker');
  head.appendChild(marker);
  root.appendChild(head);

  /* ------------------------------------------- 三个入口（真实 <a>，原生导航） */
  const list = el('ul', 'vhub-list');
  const cards = new Map<string, HTMLAnchorElement>();
  VALIDATION_HUB_ENTRIES.forEach((entry, index) => {
    const item = el('li', 'vhub-item');
    const card = document.createElement('a');
    card.className = 'vhub-card';
    card.href = entry.href;
    card.dataset['vhubId'] = entry.id;

    card.appendChild(el('span', 'vhub-index', String(index + 1)));

    const body = el('span', 'vhub-body');
    const title = el('span', 'vhub-name');
    title.appendChild(el('span', 'vhub-label', entry.label));
    title.appendChild(el('span', 'vhub-zh', entry.zhLabel));
    body.appendChild(title);
    body.appendChild(el('span', 'vhub-queue', entry.queueId));
    body.appendChild(el('span', 'vhub-verifies', entry.verifies));
    body.appendChild(el('span', 'vhub-command', entry.command));
    card.appendChild(body);

    card.appendChild(el('span', 'vhub-go', '进入 →'));

    // 只记下「点了哪个」；切换本身由浏览器导航完成（不 preventDefault）。
    card.addEventListener('click', () => {
      writeValidationHubLastEntry(store, entry.id);
    });

    item.appendChild(card);
    list.appendChild(item);
    cards.set(entry.id, card);
  });
  root.appendChild(list);

  /* ------------------------------------------------- 底部：切换纪律 / 返回 / 边界 */
  const foot = el('footer', 'vhub-foot');
  foot.appendChild(el('p', 'vhub-note', VALIDATION_HUB_SWITCH_NOTE));
  foot.appendChild(el('p', 'vhub-note vhub-back', VALIDATION_HUB_BACK_HINT));
  foot.appendChild(el('p', 'vhub-note vhub-scope', VALIDATION_HUB_SCOPE_NOTE));
  root.appendChild(foot);

  /**
   * 重读「上次进入」标记。
   * ⚠️ 必须同时覆盖**首次加载**与**从 bfcache 后退回来**两种情形：后退复用的可能是
   *    同一份已执行过的文档（脚本不会重跑），只在 boot 时读一次会永远停在旧值。
   *    本函数只是**显示**，不参与任何判定。
   */
  const refresh = (): void => {
    const last = readValidationHubLastEntry(store);
    const next = nextValidationHubEntry(last);
    const lastEntry = last === null ? null : validationHubEntryById(last);
    marker.textContent =
      lastEntry === null
        ? `尚未进入任何入口　→　建议从 ${next.label} 开始`
        : `上次进入：${lastEntry.label}　→　建议下一个：${next.label}`;
    for (const [id, card] of cards) card.classList.toggle('vhub-card-next', id === next.id);
  };
  refresh();
  window.addEventListener('pageshow', refresh);

  (globalThis as { __VALIDATIONHUB__?: ValidationHubDebugHandle }).__VALIDATIONHUB__ = {
    probe: () => {
      const last = readValidationHubLastEntry(store);
      return {
        title: VALIDATION_HUB_TITLE,
        lead: VALIDATION_HUB_LEAD,
        entries: VALIDATION_HUB_ENTRIES.map((e: ValidationHubEntry) => ({
          id: e.id,
          label: e.label,
          zhLabel: e.zhLabel,
          queueId: e.queueId,
          verifies: e.verifies,
          href: e.href,
          pageFile: e.pageFile,
          command: e.command,
        })),
        lastEntry: last,
        nextEntry: nextValidationHubEntry(last).id,
        cardCount: root.querySelectorAll('a.vhub-card').length,
        // Hub 恒为 0：本页没有画布，也就不存在「录像区域混入 Debug 数据」的物理条件。
        canvasCount: root.querySelectorAll('canvas').length,
      };
    },
  };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
