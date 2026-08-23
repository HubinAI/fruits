import type { PlatformInput } from '../types';

/**
 * 微信输入后端：
 * - bindClick：无 DOM UI（Player UI 未移植 DOM）→ 安全 no-op；
 * - bindPointer：Canvas 命中输入走 wx.onTouchStart（F-WX-4 CanvasPlayerUIHost 入口）。
 */
export class WechatInput implements PlatformInput {
  private get wx(): any {
    return (globalThis as any).wx;
  }

  bindClick(_el: EventTarget, _handler: () => void): void {
    // 微信侧无 DOM UI；占位 no-op
  }

  bindPointer(_target: EventTarget, handler: (x: number, y: number) => void): void {
    const wx = this.wx;
    if (!wx || typeof wx.onTouchStart !== 'function') return;
    wx.onTouchStart((e: any) => {
      const t = e && e.touches && e.touches[0];
      if (t) handler(t.clientX, t.clientY);
    });
  }
}
