import type { PlatformViewport, CanvasLike, SafeInsets } from '../types';
import type { CanvasSurface } from '../../render/canvasSurface';

const ZERO_INSETS: SafeInsets = { left: 0, right: 0, top: 0, bottom: 0 };

/**
 * Web 视口后端：从 DOM canvas + window 取尺寸/DPR，订阅 window resize。
 * 浏览器全局只在方法内引用，模块顶层不执行。
 *
 * F-WX-6：safeInsets() 通过 CSS env(safe-area-inset-*) 探测（刘海屏 Web 浏览器），
 * 无 DOM / 探测失败 / 桌面 → 安全回退 0（不抛错、不阻塞）。
 */
export class WebViewport implements PlatformViewport {
  constructor(private readonly canvas: CanvasLike) {}

  surface(): CanvasSurface {
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio ?? 1 : 1;
    const w = this.canvas.clientWidth ?? this.canvas.width;
    const h = this.canvas.clientHeight ?? this.canvas.height;
    return { width: w, height: h, devicePixelRatio: dpr, now: () => this.now() };
  }

  private now(): number {
    if (typeof performance !== 'undefined') return performance.now();
    return Date.now();
  }

  onResize(cb: () => void): void {
    if (typeof window === 'undefined') return;
    window.addEventListener('resize', cb);
  }

  safeInsets(): SafeInsets {
    if (typeof document === 'undefined' || typeof window === 'undefined') return ZERO_INSETS;
    try {
      // env(safe-area-inset-*) 只能经 CSS env() 读取：注入隐藏探针元素取 computed padding
      const probe = document.createElement('div');
      probe.style.cssText =
        'position:fixed;visibility:hidden;pointer-events:none;width:0;height:0;' +
        'top:0;left:0;' +
        'padding-top:env(safe-area-inset-top);padding-right:env(safe-area-inset-right);' +
        'padding-bottom:env(safe-area-inset-bottom);padding-left:env(safe-area-inset-left);';
      document.body.appendChild(probe);
      const cs = window.getComputedStyle(probe);
      const parse = (v: string): number => {
        const n = parseFloat(v);
        return Number.isFinite(n) && n > 0 ? n : 0;
      };
      const insets: SafeInsets = {
        top: parse(cs.paddingTop),
        right: parse(cs.paddingRight),
        bottom: parse(cs.paddingBottom),
        left: parse(cs.paddingLeft),
      };
      probe.remove();
      return insets;
    } catch {
      // 探测失败（非浏览器 / 异常）：安全回退 0
      return ZERO_INSETS;
    }
  }
}
