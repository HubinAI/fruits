import type { PlatformViewport, CanvasLike } from '../types';
import type { CanvasSurface } from '../../render/canvasSurface';

/**
 * Web 视口后端：从 DOM canvas + window 取尺寸/DPR，订阅 window resize。
 * 浏览器全局只在方法内引用，模块顶层不执行。
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
}
