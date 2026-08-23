import type { PlatformInput } from '../types';

/**
 * 微信输入后端：当前无 DOM UI（Player UI 尚未移植），安全 no-op。
 * 待 Player UI 移植队列再实现（如 wx 触摸命中测试）。
 */
export class WechatInput implements PlatformInput {
  bindClick(_el: EventTarget, _handler: () => void): void {
    // 微信侧无 DOM UI；占位 no-op
  }
}
