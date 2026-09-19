/**
 * PRODUCT-LOOP-R1-A-HOME-GARAGE-INVENTORY｜竖屏产品页面（首页 / 调整战车）的**入口壳**。
 *
 * 为什么单独一个文件（与 `runMain.ts` / `contentBatchMain.boot()` 同一分工）：
 *   - `homePage.ts` 只导出 `mountProductHome(root)`，模块级不碰 DOM ⇒ 可在 node 下
 *     直接 import 做单测；
 *   - 浏览器侧由本文件负责「找容器 → 挂载」（找不到容器明确报错，不静默白屏）。
 *
 * 与 `src/main.ts` 完全隔离：不 import PlayerGameRuntime / Renderer / 任何正式玩法 Runtime，
 * 也不 import 任何 DEBUG 实验台模块（本页面源码在 `src/product/`，不在实验目录内）。
 *
 * 开发：`npm run dev:home` → http://127.0.0.1:5173/home.html
 * 构建：竖屏产品构建脚本（见 package.json 的 `build:*`，与 `run-page.html` 同一产物）
 *       → 产物目录内含 home.html。
 */
import { mountProductHome } from './homePage';

function boot(): void {
  const root = document.getElementById('ph-root');
  if (!root) {
    // 页面缺失容器：明确报错（不静默白屏）
    throw new Error('[PRODUCT-LOOP] 未找到 #ph-root 容器');
  }
  mountProductHome(root);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
