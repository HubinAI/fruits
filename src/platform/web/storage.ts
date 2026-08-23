import type { PlatformStorage } from '../types';

/**
 * Web 存储后端：包装 localStorage，保留「无 localStorage 静默降级」语义。
 * 浏览器全局只在方法内引用，模块顶层不执行 → 可被微信包安全静态包含（永不调用）。
 */
export class WebStorage implements PlatformStorage {
  getItem(key: string): string | null {
    if (typeof localStorage === 'undefined') return null;
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  setItem(key: string, value: string): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(key, value);
    } catch {
      /* 隐私模式 / 配额：静默忽略 */
    }
  }
  removeItem(key: string): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.removeItem(key);
    } catch {
      /* 静默忽略 */
    }
  }
}
