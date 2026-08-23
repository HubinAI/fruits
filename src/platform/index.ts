import { createWebCore } from './web';
import type { PlatformCore } from './types';

/**
 * Web 侧 Platform Core 单例（main.ts 使用）。
 *
 * 注意：微信入口 wechat/game.ts 不使用本单例，而是直接调用 createWechatCore，
 * 以避免把 Web DOM 实现（window/document/localStorage）静态打进微信包。
 */
export const platform: PlatformCore = createWebCore();

export * from './types';
export { createWebCore } from './web';
export { createWechatCore } from './wechat';
