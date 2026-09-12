/**
 * PRP-F0-RUN-PAGE-SHELL｜Portrait Run Prototype 入口（独立页面：/run-page.html）。
 *
 * 这是**玩家视角**的入口：默认打开即是 Run Page，页面上不存在任何开发控制
 * （Arena / Loadout / Encounter / Start / Reset / Gate 全部留在独立入口
 *  `portrait-lab.html` —— 那个页面才是 Debug control area）。
 *
 * 与正式入口 `src/main.ts` 完全隔离：不 import 平台 bootstrap、不 import
 * PlayerGameRuntime / Renderer / 任何一个正式玩法模块 —— 正式 Home / Garage /
 * Matching / Battle / Result 的默认路径不被本原型写入。
 *
 * 开发：`npm run dev:run-page` → http://127.0.0.1:5173/run-page.html
 * 构建：`npm run build:portrait-lab` → dist-portrait-lab/（含 run-page.html）
 *
 * 整块删除清单见本目录 constants.ts 头部注释。
 */
import { RunPage } from './runPage';

/** Run Page 专属只读诊断句柄（仅本原型页面存在；不进入任何正式构建产物）。 */
interface RunPageDebugHandle {
  probe: () => unknown;
}

function boot(): void {
  const root = document.getElementById('run-root');
  if (!root) {
    // 页面缺失容器：明确报错（不静默白屏）
    throw new Error('[PRP-F0] 未找到 #run-root 容器');
  }
  const page = new RunPage(root);
  (globalThis as { __RUNPAGE__?: RunPageDebugHandle }).__RUNPAGE__ = { probe: () => page.probe() };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
