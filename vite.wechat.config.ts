/**
 * F-WX-1/F-WX-5｜微信小游戏正式玩家版本构建配置。
 *
 * 产出：`dist-wechat/game.js`（单文件 IIFE，可直接作为微信开发者工具导入包入口）。
 * - 仅打包 wechat/game.ts 及其正式 src 依赖（Platform boot + Canvas + Renderer +
 *   PlayerGameRuntime + CanvasPlayerUIHost + Planck Battle + 玩家流程）；不含正式 Web
 *   Player UI（WebDomPlayerUIHost）/ Physics Lab / Scenario / Runtime Debug Tools；
 * - 不生成 HTML（微信小游戏无 DOM）；不注入任何 DOM 相关 plugin；
 * - F-WX-5：接入共享 runtimeInfoPlugin → 包内嵌构建期 branch+SHA（virtual:runtime-info，
 *   非手写常量；Release metadata 追溯与 Web 同源）；
 * - inlineDynamicImports：单入口、无代码分割，便于整体导入。
 *
 * 运行：`npm run build:wechat`（= vite build -c vite.wechat.config.ts）
 */
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { runtimeInfoPlugin } from './build/runtimeInfoPlugin';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    outDir: 'dist-wechat',
    emptyOutDir: true,
    target: 'es2018',
    lib: {
      entry: resolve(__dirname, 'wechat/game.ts'),
      name: 'WeChatPlayerGame',
      formats: ['iife'],
      fileName: () => 'game.js',
    },
    minify: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
  // F-WX-5：IIFE 格式下 vite 会把 import.meta 替换为 {}（env 信息丢失 → env.ts 兜底成 dev）。
  // 微信正式玩家版本必须是 production 语义（DEV_TOOLS_VISIBLE=false / ANALYTICS_DEV=false /
  // ads PROD 路径）；显式 define 注入，与 Web production 构建行为一致。
  define: {
    'import.meta': JSON.stringify({
      env: { MODE: 'production', DEV: false, PROD: true },
    }),
  },
  plugins: [runtimeInfoPlugin()],
});
