/**
 * F-DEV-1 / F-WX-5｜`virtual:runtime-info` 共享 Vite 插件。
 *
 * Web（vite.config.ts）与微信（vite.wechat.config.ts）双构建共用：
 * - 在 dev/build 启动时经 git（execSync）读取 branch + HEAD SHA，随本次构建注入；
 * - 业务代码 import 'virtual:runtime-info' 即得构建期版本（非手写常量——
 *   Release metadata 不得把「当前最终 HEAD SHA」手写进随后还要 commit 的文件）；
 * - git 不可用（如打包环境）降级 'no-git'/'unknown'，不阻塞启动。
 */
import type { Plugin } from 'vite';
import { execSync } from 'node:child_process';

const RUNTIME_INFO_ID = '\0virtual:runtime-info';

export function gitRuntimeInfo(): { sha: string; branch: string } {
  try {
    const sha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    return { sha, branch };
  } catch {
    // git 不可用（如打包环境）：降级为空标记，不阻塞启动
    return { sha: 'no-git', branch: 'unknown' };
  }
}

/** runtime-version 插件（dev/build 双用；每次请求读取最新 git 信息） */
export function runtimeInfoPlugin(): Plugin {
  return {
    name: 'runtime-version-badge',
    resolveId(id) {
      if (id === 'virtual:runtime-info') return RUNTIME_INFO_ID;
      return undefined;
    },
    load(id) {
      if (id === RUNTIME_INFO_ID) {
        return `export default ${JSON.stringify(gitRuntimeInfo())};`;
      }
      return undefined;
    },
  };
}
