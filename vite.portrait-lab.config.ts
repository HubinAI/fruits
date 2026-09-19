import { defineConfig } from 'vite';

/**
 * PBL-F0-PORTRAIT-BATTLE-LAB-FOUNDATION｜竖屏战场实验台独立构建（可整块删除）。
 *
 * PRP-F0 起本构建同时产出**两个独立 HTML 入口**（仍是同一块可删除的实验产物）：
 *   - `run-page.html`     —— PRP｜Portrait Run Prototype 的玩家页面（默认只看到它）；
 *   - `portrait-lab.html` —— Debug control area（Arena / Loadout / Encounter / Gate）。
 *
 * 隔离保证：
 * - 独立 HTML 入口 + 独立 outDir `dist-portrait-lab`：
 *   不进入 `dist` / `dist-pages` / `dist-e2e` / `dist-wechat` 任一正式产物；
 * - 不引入 runtimeInfoPlugin（Lab 不参与版本角标 / RC 可追溯链）；
 * - 不 define `__PAGES_PREVIEW__` / `__PLAYER_MODE__` / `__WX_DEBUG__` /
 *   `__E2E_INTERNAL_HANDLE__` —— Lab 入口不读取任何正式平台宏，正式构建语义零影响；
 * - `base: './'`：产物可整目录搬移 / 以静态目录方式任意路径托管（独立验证用）。
 *
 * 用法：npm run build:portrait-lab（脚本见 package.json）
 */
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist-portrait-lab',
    // 与既有三个构建同源处理：本机 safe-delete shim 会拦截 fs.rmSync，产物覆盖写即可
    emptyOutDir: false,
    rollupOptions: {
      input: {
        'run-page': 'run-page.html',
        'portrait-lab': 'portrait-lab.html',
        // PRP-M2：验证入口（「下一局起始改装」）。与另两个入口同源 —— 仍是同一块
        // 可整块删除的实验产物，不进入 dist / dist-pages / dist-e2e / dist-wechat。
        'next-run': 'next-run.html',
        // PRP-M3：遭遇验证台（同一辆玩家车 × 三个既有正式 Encounter 的集中对照）。
        // 仍是同一块可整块删除的实验产物，不进入 dist / dist-pages / dist-e2e / dist-wechat。
        'encounter-lab': 'encounter-lab.html',
        // PRP-VALIDATION-HUB-R1：验证中心（三个验证入口的导航壳，**没有画布**）。
        // 同上：仍是同一块可整块删除的实验产物，不进入任何正式产物。
        'validation-hub': 'validation-hub.html',
        // PRP-M3-CONTENT-BATCH-01：M3 内容批次验证台（三项内容：多单位 / 废弃修理站 /
        // 路边改装件；**没有画布**）。同上：仍是同一块可整块删除的实验产物。
        'content-batch': 'content-batch.html',
        // PRODUCT-LOOP-R1-A-HOME-GARAGE-INVENTORY：竖屏**正式产品**主循环第一段
        // （首页 / 调整战车，局外配车）。
        // ⚠️ 它不是验证页、不是 Lab 内容：页面在 `src/product/`（Lab 目录之外，
        //    因此既不扩 Lab，也不受 Lab 的 import 白名单约束），复用的是正式存档
        //    （Build / Inventory）与正式车辆美术。与 `run-page` 同产物 ⇒
        //    首页上的「开始冒险」是**同产物内的相对链接**（`./run-page.html`）。
        //    仍然不进入 dist / dist-pages / dist-e2e / dist-wechat 任一正式产物。
        'home': 'home.html',
      },
    },
  },
});
