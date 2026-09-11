import { defineConfig } from 'vite';

/**
 * PBL-F0-PORTRAIT-BATTLE-LAB-FOUNDATION｜竖屏战场实验台独立构建（可整块删除）。
 *
 * 隔离保证：
 * - 独立 HTML 入口 `portrait-lab.html` + 独立 outDir `dist-portrait-lab`：
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
      input: { 'portrait-lab': 'portrait-lab.html' },
    },
  },
});
