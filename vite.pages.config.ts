import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { runtimeInfoPlugin } from './build/runtimeInfoPlugin.ts';

/**
 * F-WX-6.1｜GitHub Pages 固定 Web Mobile Preview 构建。
 *
 * - 独立 preview build（`npm run build:pages`），不触碰 `npm run build` /
 *   `npm run build:test` / `npm run build:wechat` / `npm run dev`；
 * - base `/fruits/`：Pages URL 为 https://hubinai.github.io/fruits/，静态 assets 前缀正确；
 * - 默认 production 语义（vite build 默认 mode=production → env.ts detectMode='prod' →
 *   DEV_TOOLS_VISIBLE=false / ANALYTICS_DEV=false），玩家版本干净；
 * - define `__PAGES_PREVIEW__`：固定预览页默认启用 Canvas Player UI（手机横屏可体验），
 *   无需手输 `?canvasui=1`；普通 DEV Web 默认行为不受影响（无该 define 时守卫为 false）；
 * - runtimeInfoPlugin：构建期注入 branch + HEAD SHA（非手写），页面 Badge 显示 short SHA
 *   用于确认「手机当前看到的页面 = 刚部署的 commit」。
 *
 * DEMO-FORMAL-PAGES-PACKAGING-R1｜**多入口**：在旧预览 `index.html` 不回归的前提下，
 *   把正式产品两页（`home.html` / `run-page.html`）一并打进 `dist-pages/`：
 *   - 产品循环的页面导航只有两个相对地址（`runReward.ts:129/131` 的
 *     `ADVENTURE_HREF = './run-page.html'` 与 `HOME_HREF = './home.html'`）；
 *     `next-run.html` / `validation-hub.html` / `encounter-lab.html` / `content-batch.html`
 *     均为 Lab 验证入口（`validationHub.ts`），产品循环**不依赖**，刻意不打包；
 *   - 三个入口共用同一 `runtimeInfoPlugin` 与 production define（调试句柄
 *     `__WX_DEBUG__` / `__E2E_INTERNAL_HANDLE__` 显式 false ⇒ 编译期折叠）；
 *   - HTML 内脚本均为相对/根路径 module 入口，Vite 按入口重写为 `/fruits/assets/…`，
 *     产品内导航全部是**相对链接**，base 前缀下无需任何路径改写。
 */
export default defineConfig({
  base: '/fruits/',
  plugins: [runtimeInfoPlugin()],
  define: {
    __PAGES_PREVIEW__: 'true',
    // F-DEMO-VISUAL-GATE-R4｜Must#6：正式 Pages 显式注入 false → esbuild 编译期折叠 + 死代码消除，
    // window.__h / window.__probe 探针代码不进入生产 bundle（E2E 专用构建 vite.e2e.config.ts 注入 true）。
    // 原 __E2E_PROBE__ 已弃用，统一迁移到 __WX_DEBUG__。
    __WX_DEBUG__: 'false',
    // F-WX-E2E-HANDLE-ISOLATION-P0：E2E-only 内部句柄宏显式 false → 编译期折叠（死代码消除）
    __E2E_INTERNAL_HANDLE__: 'false',
  },
  build: {
    outDir: 'dist-pages',
    // F-DEMO-WEB-R1：emptyOutDir 关闭——与 vite.wechat.config.ts 同源：本机 safe-delete shim
    // 拦截 fs.rmSync（emptyDir 必失败）；产物文件名恒定（index.html + hash assets，旧文件
    // 不被 index.html 引用即无残留），覆盖写即可；Linux CI 无 shim 影响。
    emptyOutDir: false,
    // 多入口：`index.html` 维持旧 Canvas 预览；`home.html` / `run-page.html` 为正式产品两页。
    // ⚠️ 三页都以仓库根目录为基准解析（rollupOptions.input 的相对路径相对 config 所在目录）。
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        home: resolve(__dirname, 'home.html'),
        runPage: resolve(__dirname, 'run-page.html'),
      },
    },
  },
});
