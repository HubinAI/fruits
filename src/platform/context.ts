/**
 * F-WX-2.1｜Platform Binding / Context（唯一绑定点）。
 *
 * 问题根因：F-WX-2 的 `src/platform/index.ts` 直接 `export const platform = createWebCore()`，
 * 导致业务模块永远绑定 Web Core，微信入口的 createWechatCore 只局部使用、从未成为共享绑定。
 *
 * 本模块是「当前启动平台真正注入的 PlatformCore」的唯一持有者：
 * - 入口（main.ts = createWebCore / wechat/game.ts = createWechatCore）必须在业务模块
 *   求值前调用 bindPlatformCore(...)（见 bootstrap.ts / bootstrap-wechat.ts）；
 * - 业务模块统一经 `platform`（index.ts 的惰性 facade）访问当前绑定；
 * - 未绑定即访问 → 抛错（fail-fast），禁止静默退回 Web（不许用 try/catch 掩盖错误绑定）。
 *
 * 本模块无任何运行时 import（只引用 type），因此不会把任何平台的 DOM 实现带入 bundle。
 */
import type { PlatformCore } from './types';

let current: PlatformCore | null = null;

/** 入口显式注入当前启动平台的 PlatformCore（Web→createWebCore，WeChat→createWechatCore）。 */
export function bindPlatformCore(core: PlatformCore): void {
  current = core;
}

/** 业务模块统一访问当前绑定的 PlatformCore；未绑定即访问 → 抛错（fail-fast）。 */
export function getPlatformCore(): PlatformCore {
  if (!current) {
    throw new Error(
      '[platform] PlatformCore 未绑定：入口必须在业务模块求值前 import bootstrap 并 bindPlatformCore（main.ts=Web / wechat/game.ts=WeChat）。',
    );
  }
  return current;
}

export function isPlatformCoreBound(): boolean {
  return current !== null;
}
