import type { PlatformCore, CanvasLike } from './types';
import { getPlatformCore } from './context';

export { bindPlatformCore, getPlatformCore, isPlatformCoreBound } from './context';
export * from './types';

/**
 * F-WX-2.1｜业务模块统一入口：访问「当前启动平台真正注入的 PlatformCore」。
 *
 * 不再是固定 createWebCore()——由入口（main.ts=createWebCore / wechat/game.ts=createWechatCore）
 * 在业务模块求值前 bindPlatformCore(...)，本对象仅为惰性代理：每次属性访问读取当前绑定。
 * 未绑定即访问会抛错（fail-fast），不静默退回 Web。
 *
 * 注意：本文件不得 import web/ 或 wechat/ 实现——否则微信包会因业务持久化模块 import
 * 本入口而静态拉入 Web DOM 实现（Queue F-WX-2.1 必改 3 / 验收 5）。createWebCore /
 * createWechatCore 只由 bootstrap 或入口从具体子路径导入。
 */
export const platform: PlatformCore = {
  get storage() {
    return getPlatformCore().storage;
  },
  get lifecycle() {
    return getPlatformCore().lifecycle;
  },
  get input() {
    return getPlatformCore().input;
  },
  createViewport(canvas: CanvasLike) {
    return getPlatformCore().createViewport(canvas);
  },
};
