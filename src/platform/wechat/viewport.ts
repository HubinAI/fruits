import type { PlatformViewport, CanvasLike, SafeInsets } from '../types';
import type { CanvasSurface } from '../../render/canvasSurface';

const ZERO_INSETS: SafeInsets = { left: 0, right: 0, top: 0, bottom: 0 };

/**
 * 微信视口后端：从 wx canvas + systemInfo 取尺寸/DPR（固定方向，无运行时 resize）。
 *
 * F-WX-6：safeInsets() 从 wx.getSystemInfoSync().safeArea（逻辑 px 矩形）计算横屏内缩——
 * 横屏刘海在屏幕短边（left/right），圆角/系统边缘由 safeArea 顶底体现；单位 = 逻辑 px，
 * 与 canvas.width / pixelRatio 对应（宿主布局空间一致）。
 */
export class WechatViewport implements PlatformViewport {
  private readonly surfaceValue: CanvasSurface;
  constructor(canvas: CanvasLike, pixelRatio = 1) {
    this.surfaceValue = {
      width: canvas.width,
      height: canvas.height,
      devicePixelRatio: pixelRatio || 1,
      now: () => Date.now(),
    };
  }

  surface(): CanvasSurface {
    return this.surfaceValue;
  }

  onResize(_cb: () => void): void {
    // 微信小游戏固定方向（landscape），无运行时 resize
  }

  safeInsets(): SafeInsets {
    const wx = (globalThis as any).wx as any;
    if (!wx || typeof wx.getSystemInfoSync !== 'function') return ZERO_INSETS;
    try {
      const sys = wx.getSystemInfoSync();
      const sa = sys && sys.safeArea;
      if (!sa || typeof sa.left !== 'number') return ZERO_INSETS;
      const ww = typeof sys.windowWidth === 'number' ? sys.windowWidth : 0;
      const wh = typeof sys.windowHeight === 'number' ? sys.windowHeight : 0;
      const clamp = (v: number): number => (Number.isFinite(v) && v > 0 ? v : 0);
      return {
        left: clamp(sa.left),
        right: ww > 0 ? clamp(ww - sa.right) : 0,
        top: clamp(sa.top),
        bottom: wh > 0 ? clamp(wh - sa.bottom) : 0,
      };
    } catch {
      return ZERO_INSETS;
    }
  }
}
