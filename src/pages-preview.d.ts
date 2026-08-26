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
 * F-DEMO-VISUAL-GATE-R4｜E2E 几何门禁探针构建标志的全局类型声明。
 *
 * 仅 `vite.e2e.config.ts` 的 `define.__E2E_PROBE__` 会注入真值（npm run build:e2e → dist-e2e）；
 * 正式 Pages / Web / 微信构建未注入 → 运行时为 undefined（必须用 typeof 守卫）——
 * window.__h / window.__probe 只读几何诊断仅存在于 E2E 专用构建，生产零调试对象暴露。
 */
declare const __E2E_PROBE__: boolean | undefined;
