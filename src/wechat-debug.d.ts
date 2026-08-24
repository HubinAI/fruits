/**
 * F-WX-P0-INPUT｜微信输入诊断构建标志的全局类型声明。
 *
 * 仅 `vite.wechat.config.ts` 的 `define.__WX_DEBUG__` 注入（WECHAT_DEBUG_INPUT=1 构建 = true，
 * 默认 false）；Web build / vitest 未注入 → undefined（typeof 守卫，未声明变量直接访问报错）。
 * DEV 构建输出 [WX-INPUT] 触摸诊断日志；PROD 构建零日志。
 */
declare const __WX_DEBUG__: boolean | undefined;
