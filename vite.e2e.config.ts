import { defineConfig } from 'vite';
import { runtimeInfoPlugin } from './build/runtimeInfoPlugin.ts';

/**
 * F-DEMO-VISUAL-GATE-R4｜专用 E2E 几何门禁构建。
 *
 * 与 vite.pages.config.ts 完全同源（base /fruits/、PROD 语义、Canvas Player UI），
 * 唯一差异：define __E2E_PROBE__='true' —— window.__h / window.__probe 只读几何诊断
 * 仅在此构建存在；正式 Pages build（vite.pages.config.ts 无此 define）探针全部编译期
 * 折叠为 undefined，生产版本零调试对象暴露。
 */
export default defineConfig({
  base: '/fruits/',
  plugins: [runtimeInfoPlugin()],
  define: {
    __PAGES_PREVIEW__: 'true',
    __E2E_PROBE__: 'true',
  },
  build: {
    outDir: 'dist-e2e',
    emptyOutDir: false,
  },
});
