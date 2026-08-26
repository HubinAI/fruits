import { defineConfig } from 'vitest/config';
import { gitRuntimeInfo, runtimeInfoPlugin } from './build/runtimeInfoPlugin.ts';

/**
 * F-DEV-1：Runtime 版本可追溯（插件见 build/runtimeInfoPlugin.ts）。
 * - virtual:runtime-info 虚拟模块在 dev/build 启动时经 git 读取（execSync），
 *   随本次构建注入页面——Badge 的 SHA 来自同一份启动源码，非手写常量；
 * - strictPort：端口被占用 → 启动直接失败并报明确错误，绝不自动换 5174/5175
 *   （防止浏览器录到旧 Runtime）；不自动 kill 其它进程；
 * - listening 时终端打印 cwd / branch / HEAD SHA / 实际监听端口。
 */
export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true, // F-DEV-1：端口被占用直接失败，不自动切端口
  },
  build: {
    // F-DEMO-GATE-R2：emptyOutDir 关闭——与 vite.pages/vite.wechat 同源处理：
    // 本机 safe-delete shim 拦截 fs.rmSync（emptyDir 必失败），产物覆盖写即可
    // （dist 内容始终是 index.html + assets，无旧产物残留）。
    emptyOutDir: false,
  },
  plugins: [
    runtimeInfoPlugin(),
    // F-DEMO-PLAYER-RUNTIME-P0：本地玩家演示模式（npm run dev:player / ?player=1）。
    // 与 vite.pages.config.ts 的 __PAGES_PREVIEW__ 同源机制——构建期注入标志，
    // 使 main.ts 进入「唯一手机玩家 Canvas 宿主」分支（结构性禁止 DEV 工具栏/侧栏/Debug）。
    {
      name: 'player-mode-define',
      config: () => ({
        define: { __PLAYER_MODE__: 'true' },
      }),
    },
    {
      name: 'runtime-version-listening-log',
      configureServer(server) {
        server.httpServer?.on('listening', () => {
          const info = gitRuntimeInfo();
          const addr = server.httpServer?.address();
          const port = typeof addr === 'object' && addr ? addr.port : '?';
          // F-DEV-1：npm dev 启动明确打印一次（cwd/branch/SHA/端口）
          // eslint-disable-next-line no-console
          console.log('\n[F-DEV-1] Runtime 版本信息');
          // eslint-disable-next-line no-console
          console.log(`  cwd     : ${process.cwd()}`);
          // eslint-disable-next-line no-console
          console.log(`  branch  : ${info.branch}`);
          // eslint-disable-next-line no-console
          console.log(`  HEAD    : ${info.sha}`);
          // eslint-disable-next-line no-console
          console.log(`  port    : ${port}\n`);
        });
      },
    },
  ],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
    // F-WX-2.1：每个测试文件求值前先绑定 Web Core（与 Web 启动一致），
    // 使既有持久化测试无需逐个改造；验证 WeChat 绑定的用例内再 bindPlatformCore 并还原。
    setupFiles: ['tests/setup.ts'],
  },
});
