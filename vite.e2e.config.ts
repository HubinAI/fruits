import { defineConfig } from 'vite';
import { runtimeInfoPlugin } from './build/runtimeInfoPlugin.ts';

/**
 * F-DEMO-VISUAL-GATE-R4｜专用 E2E 几何门禁构建。
 *
 * 与 vite.pages.config.ts 完全同源（base /fruits/、PROD 语义、Canvas Player UI），
 * 唯一差异：define __WX_DEBUG__='true' —— window.__h 只读几何诊断仅在此构建暴露；
 * 正式 Pages build（vite.pages.config.ts 无此 define）探针全部编译期折叠为 undefined，
 * 生产版本零调试对象暴露。__E2E_PROBE__ 已弃用（已迁移到 __WX_DEBUG__，不得出现在任何微信构建中）。
 */
export default defineConfig({
  base: '/fruits/',
  plugins: [runtimeInfoPlugin()],
  define: {
    __PAGES_PREVIEW__: 'true',
    __WX_DEBUG__: 'true',
    // F-WX-E2E-HANDLE-ISOLATION-P0：E2E 内部句柄（__h/__probe/__fx）专属宏——微信诊断构建
    //（WECHAT_DEBUG_INPUT=1 也设 __WX_DEBUG__=true）不再因此暴露任何内部句柄。
    __E2E_INTERNAL_HANDLE__: 'true',
  },
  build: {
    outDir: 'dist-e2e',
    emptyOutDir: false,
  },
});
