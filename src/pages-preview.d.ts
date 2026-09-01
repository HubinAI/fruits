/**
 * F-WX-6.1｜Pages Preview 构建标志的全局类型声明。
 *
 * 仅 `vite.pages.config.ts` 的 `define.__PAGES_PREVIEW__` 会注入真值；
 * 普通 dev / build / 微信构建未注入 → 运行时为 undefined（必须用 typeof 守卫，
 * 未声明变量直接访问会 ReferenceError）。
 */
declare const __PAGES_PREVIEW__: boolean | undefined;

/**
 * F-DEMO-PLAYER-RUNTIME-P0｜本地玩家演示模式构建标志的全局类型声明。
 *
 * 仅 `vite.config.ts` 的 `define.__PLAYER_MODE__` 会注入真值（npm run dev:player / 本地 dev web）；
 * Pages / 微信构建未注入 → 运行时为 undefined（必须用 typeof 守卫）。
 */
declare const __PLAYER_MODE__: boolean | undefined;

/**
 * F-WX-IOS-CANVAS-CRASH-P0｜Must#6｜E2E 几何门禁探针构建标志说明（构建标志已迁移到 __WX_DEBUG__）。
 *
 * 仅 `vite.e2e.config.ts` 的 `define.__WX_DEBUG__` 会注入真值（npm run build:e2e → dist-e2e）；
 * 正式 Pages / Web / 微信构建未注入 → 运行时为 undefined（必须用 typeof 守卫）——
 * window.__h 只读几何诊断仅存在于 E2E 专用构建，生产零调试对象暴露。
 * 注意：__E2E_PROBE__ 已弃用（已迁移到 __WX_DEBUG__），不得出现在任何微信构建中。
 * （__WX_DEBUG__ 的全局类型声明见 wechat-debug.d.ts，此处不再重复声明。）
 */

/**
 * F-WX-E2E-HANDLE-ISOLATION-P0｜E2E-only 内部句柄宏。
 *
 * 仅 `vite.e2e.config.ts` 的 `define.__E2E_INTERNAL_HANDLE__` 注入（'true'）；
 * 微信/普通/Pages/RC 构建均不注入 → 运行时 undefined（typeof 守卫折叠为 false）。
 * 职责唯一：控制 E2E 内部句柄（globalThis.__h / __probe / __fx）——与 __WX_DEBUG__
 * （微信诊断日志）、__WX_DEBUG_GRANT__（全部件×1）、__WX_BUILD_BADGE__（RC 版号）互不借用。
 */
declare const __E2E_INTERNAL_HANDLE__: boolean | undefined;
