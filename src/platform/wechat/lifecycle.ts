import type { PlatformLifecycle } from '../types';

/**
 * 微信生命周期后端：wx.requestAnimationFrame（+setTimeout 兜底）+ onHide/onShow。
 * 全部经 (globalThis as any).wx 懒取，wx 缺失时安全降级。
 */
export class WechatLifecycle implements PlatformLifecycle {
  private get wx(): any {
    return (globalThis as any).wx;
  }
  now(): number {
    return Date.now();
  }
  requestAnimationFrame(cb: (time: number) => void): number {
    const wx = this.wx;
    if (wx && typeof wx.requestAnimationFrame === 'function') {
      return wx.requestAnimationFrame(cb);
    }
    // 兜底（部分基础库缺 requestAnimationFrame）
    return setTimeout(() => cb(this.now()), 16) as unknown as number;
  }
  cancelAnimationFrame(handle: number): void {
    const wx = this.wx;
    if (wx && typeof wx.cancelAnimationFrame === 'function') {
      wx.cancelAnimationFrame(handle);
    } else {
      clearTimeout(handle);
    }
  }
  onVisibilityChange(cb: (hidden: boolean) => void): void {
    const wx = this.wx;
    if (!wx) return;
    if (typeof wx.onHide === 'function') wx.onHide(() => cb(true));
    if (typeof wx.onShow === 'function') wx.onShow(() => cb(false));
  }
}
