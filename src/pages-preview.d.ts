/**
 * F-WX-6.1｜Pages Preview 构建标志的全局类型声明。
 *
 * 仅 `vite.pages.config.ts` 的 `define.__PAGES_PREVIEW__` 会注入真值；
 * 普通 dev / build / 微信构建未注入 → 运行时为 undefined（必须用 typeof 守卫，
 * 未声明变量直接访问会 ReferenceError）。
 */
declare const __PAGES_PREVIEW__: boolean | undefined;
