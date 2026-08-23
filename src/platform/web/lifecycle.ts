import type { PlatformLifecycle } from '../types';

/**
 * Web 生命周期后端：浏览器 rAF + performance.now + visibilitychange。
 * 浏览器全局只在方法内引用，模块顶层不执行 → 可被微信包安全静态包含（永不调用）。
 */
export class WebLifecycle implements PlatformLifecycle {
  now(): number {
    if (typeof performance !== 'undefined') return performance.now();
    return Date.now();
  }
  requestAnimationFrame(cb: (time: number) => void): number {
    if (typeof requestAnimationFrame === 'function') {
      return requestAnimationFrame(cb);
    }
    // 极旧环境兜底（不应发生）
    return setTimeout(() => cb(this.now()), 16) as unknown as number;
  }
  cancelAnimationFrame(handle: number): void {
    if (typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(handle);
    } else {
      clearTimeout(handle);
    }
  }
  onVisibilityChange(cb: (hidden: boolean) => void): void {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    window.addEventListener('visibilitychange', () => cb(document.hidden));
    // 后台→前台 dt 钳制已由主循环 Math.min(50, dt) 覆盖；此处仅暴露钩子
  }
}
