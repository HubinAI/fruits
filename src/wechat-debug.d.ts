/**
 * F-WX-P0-INPUT｜微信输入诊断构建标志的全局类型声明。
 *
 * 仅 `vite.wechat.config.ts` 的 `define.__WX_DEBUG__` 注入（WECHAT_DEBUG_INPUT=1 构建 = true，
 * 默认 false）；Web build / vitest 未注入 → undefined（typeof 守卫，未声明变量直接访问报错）。
 * DEV 构建输出 [WX-INPUT] 触摸诊断日志；PROD 构建零日志。
 */
declare const __WX_DEBUG__: boolean | undefined;

/**
 * F-WX-RCA-1｜真实尺度核对构建标志。
 *
 * 仅 `vite.wechat.config.ts` 的 `define.__WX_RCA__` 注入（WECHAT_RCA=1 构建 = true，
 * 即 `npm run build:wechat:rca`；默认 false）。RCA 构建输出 [WX-RCA] 真实尺度数据
 * （viewport + Garage core/envelope 占比 + Battle Active core/envelope 占比）；
 * 普通 build:wechat PROD 零日志。
 */
declare const __WX_RCA__: boolean | undefined;

/**
 * F-WX-IOS-CANVAS-CRASH-P0｜Must#6｜体验版 SHA 水印构建标志。
 *
 * 仅 `vite.wechat.config.ts` 的 `define.__WX_BUILD_BADGE__` 注入（WECHAT_BADGE=1 构建 = true，
 * 即 `npm run build:wechat:rc`；默认 false）。RC 构建于画面角落绘制短 SHA 水印，供真人录屏
 * 确认版本；正式 build:wechat PROD 不注入 → 恒不绘制（正式发布前可关闭）。
 */
declare const __WX_BUILD_BADGE__: boolean | undefined;

/**
 * F-WX-IOS-CANVAS-CRASH-P0｜Must#6｜「全部件×1」调试入口构建标志（独立于 SHA / E2E probe）。
 *
 * 仅 `vite.wechat.config.ts` 的 `define.__WX_DEBUG_GRANT__` 注入（WECHAT_DEBUG_GRANT=1 构建 = true，
 * 即 `npm run build:wechat:rc`；默认 false）。配合 game.ts 的 isResetDevVisible 使「全部件×1」
 * 可达且隔离于普通体验入口；普通 prod 构建恒 false → 永不出现、无法误触。
 * 注意：E2E probe（__E2E_PROBE__，已弃用、已迁移到 __WX_DEBUG__）不得出现在任何微信构建中。
 */
declare const __WX_DEBUG_GRANT__: boolean | undefined;

/**
 * F-WX-RC-REPRODUCIBLE-BUILD-P0｜诊断 dirty 构建标记。
 *
 * 仅 `vite.wechat.config.ts` 的 `define.__WX_RC_DIRTY__` 注入（scripts/wechat-rc.js --dirty 诊断
 * 构建时 WECHAT_RC_DIRTY=1 → true；默认 false）。此时 badge 显示 #<sha>-dirty（Must#4：临时诊断
 * 包，不得伪装正式 RC）；正常 RC / 普通 build:wechat 恒 false → 无后缀。
 */
declare const __WX_RC_DIRTY__: boolean | undefined;
