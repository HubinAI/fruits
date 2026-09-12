/**
 * PBL-F0｜Portrait Battle Lab 入口（独立页面：/portrait-lab.html）= **DEBUG ONLY**。
 *
 * ⚠️ PRP-R1-ACTUAL-RUNTIME-ENTRY-LAYOUT-FIX：本页面是开发/调试面，**不是玩家体验入口**。
 *    玩家体验入口只有一个：`run-page.html`（`npm run dev:run-page`）。
 *
 * 与正式入口 `src/main.ts` 完全隔离：本文件只构造本实验台的控制器，
 * 不 import 平台 bootstrap、不 import PlayerGameRuntime / Renderer / 任何一个正式玩法模块。
 * 因此正式 Home / Garage / Matching / Battle / Result 的默认路径不被竖屏实验规则写入。
 *
 * 开发：`npm run dev:debug-lab` → 打开 http://127.0.0.1:5173/portrait-lab.html（DEBUG ONLY）
 * 构建：`npm run build:portrait-lab` → dist-portrait-lab/（与 dist / dist-pages / dist-e2e /
 *       dist-wechat 完全隔离，不参与任何正式产物）。
 *
 * 整块删除清单见本目录 constants.ts 头部注释。
 */
import { PortraitBattleLab } from './lab';

/** Lab 专属只读诊断句柄（仅本实验页面存在；不进入任何正式构建产物）。 */
interface PblDebugHandle {
  probe: () => unknown;
}

function boot(): void {
  const root = document.getElementById('pbl-root');
  if (!root) {
    // Lab 页面缺失容器：明确报错（不静默白屏）
    throw new Error('[PBL-F0] 未找到 #pbl-root 容器');
  }
  const lab = new PortraitBattleLab(root);
  (globalThis as { __PBL__?: PblDebugHandle }).__PBL__ = { probe: () => lab.probe() };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
