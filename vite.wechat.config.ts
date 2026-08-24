/**
 * F-WX-1/F-WX-5/F-WX-7｜微信小游戏正式玩家版本构建配置。
 *
 * 产出：`dist-wechat/` 标准微信小游戏工程目录（可直接导入微信开发者工具）：
 * - game.js：单文件 IIFE（仅 wechat/game.ts 及其正式 src 依赖：Platform boot + Canvas +
 *   Renderer + PlayerGameRuntime + CanvasPlayerUIHost + Planck Battle + 玩家流程；不含
 *   WebDomPlayerUIHost / Physics Lab / Scenario / Runtime Debug Tools）；
 * - game.json：平台配置（横屏 deviceOrientation: landscape、showStatusBar 等），
 *   由 closeBundle 从 wechat/game.json 复制；
 * - project.config.json：工程配置（compileType: game），由 closeBundle 复制；
 *   appid 默认 touristappid（游客模式，无需真实 AppID 即可打开调试），可用环境变量
 *   WECHAT_APPID 覆盖——**禁止把私人 AppID / private key 提交进 Git**（dist-wechat 已
 *   gitignore，且源码 project.config.json 恒为 touristappid）。
 *
 * 其他：
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
import { copyFileSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { runtimeInfoPlugin } from './build/runtimeInfoPlugin.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * F-WX-7｜构建收尾：把微信开发者工具需要的平台/工程配置复制进 dist-wechat。
 * 使 `npm run build:wechat` 之后得到一个可直接「导入项目 → 运行」的标准小游戏目录，
 * 无需用户手工拷贝多个文件。
 */
function finalizeWechatProject(): void {
  const outDir = resolve(__dirname, 'dist-wechat');
  const srcDir = resolve(__dirname, 'wechat');
  mkdirSync(outDir, { recursive: true });

  // 1) game.json：原样复制（deviceOrientation: landscape / showStatusBar / networkTimeout）
  copyFileSync(resolve(srcDir, 'game.json'), resolve(outDir, 'game.json'));

  // 2) project.config.json：复制；appid 支持 WECHAT_APPID 环境变量覆盖，
  //    默认 touristappid（游客模式）。源文件恒为 touristappid，绝不写入私人 AppID。
  const raw = readFileSync(resolve(srcDir, 'project.config.json'), 'utf8');
  const cfg = JSON.parse(raw) as { appid: string };
  if (process.env.WECHAT_APPID) cfg.appid = process.env.WECHAT_APPID;
  writeFileSync(resolve(outDir, 'project.config.json'), JSON.stringify(cfg, null, 2) + '\n');
}

export default defineConfig({
  build: {
    outDir: 'dist-wechat',
    // F-WX-7：emptyOutDir 关闭——本机 safe-delete shim 拦截 fs.rmSync（emptyDir 必失败），
    // 且产物文件名恒定（game.js + game.json + project.config.json，覆盖写即可）；
    // Linux CI 无 shim 影响；目录内容始终是这 3 个文件，不会残留旧产物。
    emptyOutDir: false,
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
  // F-WX-P0-INPUT：__WX_DEBUG__ 默认 false（PROD 零诊断日志）；WECHAT_DEBUG_INPUT=1 构建
  // 时为 true（输出 [WX-INPUT] 触摸诊断，供微信开发者工具定位坐标/命中）。
  // F-WX-RCA-1：__WX_RCA__ 默认 false（PROD 零日志）；WECHAT_RCA=1 构建（npm run build:wechat:rca）
  // 时为 true（输出 [WX-RCA] 真实尺度数据，供真人 Runtime 核对 Garage/Battle 主体占比）。
  define: {
    'import.meta': JSON.stringify({
      env: { MODE: 'production', DEV: false, PROD: true },
    }),
    __WX_DEBUG__: process.env.WECHAT_DEBUG_INPUT ? 'true' : 'false',
    __WX_RCA__: process.env.WECHAT_RCA ? 'true' : 'false',
  },
  plugins: [
    runtimeInfoPlugin(),
    {
      name: 'wechat-finalize-project',
      closeBundle: finalizeWechatProject,
    },
  ],
});
