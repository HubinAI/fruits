import { defineConfig } from 'vitest/config';
import { execSync } from 'node:child_process';

/**
 * F-DEV-1：Runtime 版本可追溯。
 * - virtual:runtime-info 虚拟模块在 dev/build 启动时经 git 读取（execSync），
 *   随本次构建注入页面——Badge 的 SHA 来自同一份启动源码，非手写常量；
 * - strictPort：端口被占用 → 启动直接失败并报明确错误，绝不自动换 5174/5175
 *   （防止浏览器录到旧 Runtime）；不自动 kill 其它进程；
 * - listening 时终端打印 cwd / branch / HEAD SHA / 实际监听端口。
 */
function gitRuntimeInfo(): { sha: string; branch: string } {
  try {
    const sha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    return { sha, branch };
  } catch {
    // git 不可用（如打包环境）：降级为空标记，不阻塞启动
    return { sha: 'no-git', branch: 'unknown' };
  }
}

const RUNTIME_INFO_ID = '\0virtual:runtime-info';

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true, // F-DEV-1：端口被占用直接失败，不自动切端口
  },
  plugins: [
    {
      name: 'runtime-version-badge',
      resolveId(id) {
        if (id === 'virtual:runtime-info') return RUNTIME_INFO_ID;
        return undefined;
      },
      load(id) {
        if (id === RUNTIME_INFO_ID) {
          // 每次请求读取最新 git 信息（与启动打印同一来源）
          return `export default ${JSON.stringify(gitRuntimeInfo())};`;
        }
        return undefined;
      },
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
