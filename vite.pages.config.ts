import { defineConfig } from 'vite';
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
 */
export default defineConfig({
  base: '/fruits/',
  plugins: [runtimeInfoPlugin()],
  define: {
    __PAGES_PREVIEW__: 'true',
  },
  build: {
    outDir: 'dist-pages',
    // F-DEMO-WEB-R1：emptyOutDir 关闭——与 vite.wechat.config.ts 同源：本机 safe-delete shim
    // 拦截 fs.rmSync（emptyDir 必失败）；产物文件名恒定（index.html + hash assets，旧文件
    // 不被 index.html 引用即无残留），覆盖写即可；Linux CI 无 shim 影响。
    emptyOutDir: false,
  },
});
