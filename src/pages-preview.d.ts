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
