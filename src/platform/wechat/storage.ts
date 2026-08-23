import type { PlatformStorage } from '../types';

/**
 * 微信存储后端：wx.getStorageSync / setStorageSync / removeStorageSync。
 * 全部经 (globalThis as any).wx 懒取，wx 缺失时安全降级（与 Web 对称）。
 */
export class WechatStorage implements PlatformStorage {
  private get wx(): any {
    return (globalThis as any).wx;
  }
  getItem(key: string): string | null {
    const wx = this.wx;
    if (!wx || typeof wx.getStorageSync !== 'function') return null;
    try {
      const v = wx.getStorageSync(key);
      return v == null ? null : String(v);
    } catch {
      return null;
    }
  }
  setItem(key: string, value: string): void {
    const wx = this.wx;
    if (!wx || typeof wx.setStorageSync !== 'function') return;
    try {
      wx.setStorageSync(key, value);
    } catch {
      /* 配额 / 异常：静默忽略 */
    }
  }
  removeItem(key: string): void {
    const wx = this.wx;
    if (!wx || typeof wx.removeStorageSync !== 'function') return;
    try {
      wx.removeStorageSync(key);
    } catch {
      /* 静默忽略 */
    }
  }
}
