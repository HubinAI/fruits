/**
 * PRP-R2-DEFAULT-EXPERIENCE-ENTRY｜实验分支的「默认开发入口」重写（**dev-only**）。
 *
 * 背景（真实启动链实测）：
 *   `npm run dev` → `vite` → Vite 把根路径 `/` 解析为 `index.html`（正式横屏游戏）。
 *   于是用户「按正常方式启动」后看到的是旧横屏主界面 / 战斗 / 结算，
 *   必须手输 `/run-page.html` 才能看到本轮原型 —— 这正是 PRP-R1 之后真人录屏仍然失败的原因。
 *
 * 本插件把 dev server 的**根路径**重写为原型入口，使：
 *   1) 浏览器自动打开（`vite --open` 默认打开 `/`）落在 PRP Run Page；
 *   2) 手工输入 `http://127.0.0.1:5173` 也落在同一页面（服务端重写，地址栏 URL 保持 `/`）；
 *   3) 旧横屏正式游戏仍可通过显式地址 `/index.html` 访问（`npm run dev:legacy`）。
 *
 * 隔离保证（不削弱任何既有守卫）：
 * - `apply: 'serve'` —— **只在 dev server 生效，不参与任何构建**；
 *   `npm run build` / `build:pages` / `build:e2e` / `build:wechat` 的产物完全不受影响；
 * - 不 import 任何原型运行时代码（不 import `src/lab/**`），只改写请求路径字符串；
 * - 目标入口不存在时（例如分支未包含该文件）自动跳过，不会把根路径指向 404；
 * - 正式入口 `index.html` 与四个正式构建配置**零改动**（R23 / RP-27 守卫保持原强度）。
 *
 * 仅用于 `prototype-portrait-battle-lab` 实验分支；合回正式主线前必须整块删除本文件。
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';

/**
 * 实验分支的默认体验入口（本分支上的玩家产物）。
 * 注意：本常量**只在本文件内**存在 —— `vite.config.ts` 不得出现该字面量（RP-27 守卫）。
 */
export const BRANCH_DEFAULT_DEV_ENTRY = '/run-page.html';

/**
 * 请求路径 → 重写目标。
 *
 * 只重写「目录根」这一种情况；其余一律返回 null（不改写）：
 *   - `/`            → `/run-page.html`（默认体验入口）
 *   - `/index.html`  → null（旧横屏正式游戏，显式备用入口，必须仍能直达）
 *   - `/run-page.html` / `/portrait-lab.html` / `/src/...` / `/@vite/...` → null
 *
 * 纯函数（无副作用、无 IO），便于单测直接冻结规则。
 */
export function resolveDevEntryRewrite(url: string | undefined | null): string | null {
  if (typeof url !== 'string' || url.length === 0) return null;
  const pathname = url.split('?')[0].split('#')[0];
  if (pathname === '/' || pathname === '') return BRANCH_DEFAULT_DEV_ENTRY;
  return null;
}

/** 该 dev server 的根目录下是否真的存在原型入口（不存在则不重写，避免根路径 404）。 */
export function branchDefaultEntryAvailable(root: string): boolean {
  return existsSync(join(root, BRANCH_DEFAULT_DEV_ENTRY.replace(/^\//, '')));
}

/**
 * dev-only 插件：把根路径请求重写为原型入口。
 * 注册顺序应在 `plugins` 数组最前 —— 中间件按注册顺序执行，需先于 Vite 内部中间件。
 */
export function branchDefaultEntryPlugin(): Plugin {
  return {
    name: 'prp-branch-default-dev-entry',
    apply: 'serve', // 构建期完全不生效（含 npm run build / pages / e2e / wechat）
    configureServer(server: ViteDevServer) {
      if (!branchDefaultEntryAvailable(server.config.root)) return;
      server.middlewares.use((req, _res, next) => {
        const target = resolveDevEntryRewrite(req.url);
        if (target) req.url = target;
        next();
      });
    },
  };
}
