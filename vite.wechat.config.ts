/**
 * F-WX-1｜微信小游戏 Spike 构建配置。
 *
 * 产出：`dist-wechat/game.js`（单文件 IIFE，可直接作为微信开发者工具导入包入口）。
 * - 仅打包 wechat/game.ts 及其正式 src 依赖（Platform boot + Canvas + Renderer +
 *   Planck Battle + 固定 Build）；不含正式 Web Player UI / audio / storage；
 * - 不生成 HTML（微信小游戏无 DOM）；
 * - 不注入任何 DOM 相关 plugin；
 * - inlineDynamicImports：单入口、无代码分割，便于整体导入。
 *
 * 运行：`vite build -c vite.wechat.config.ts`
 */
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    outDir: 'dist-wechat',
    emptyOutDir: true,
    target: 'es2018',
    lib: {
      entry: resolve(__dirname, 'wechat/game.ts'),
      name: 'WeChatBattleSpike',
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
  plugins: [],
});
