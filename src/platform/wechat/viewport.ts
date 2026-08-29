import type { PlatformViewport, CanvasLike, SafeInsets } from '../types';
import type { CanvasSurface } from '../../render/canvasSurface';

const ZERO_INSETS: SafeInsets = { left: 0, right: 0, top: 0, bottom: 0 };

/**
 * 微信视口后端：从 wx canvas + systemInfo 取尺寸/DPR（固定方向，无运行时 resize）。
 *
 * F-WX-6：safeInsets() 从 wx.getSystemInfoSync().safeArea（逻辑 px 矩形）计算横屏内缩——
 * 横屏刘海在屏幕短边（left/right），圆角/系统边缘由 safeArea 顶底体现；单位 = 逻辑 px，
 * 与 canvas.width / pixelRatio 对应（宿主布局空间一致）。
 *
 * F-WX-VIEWPORT-SURFACE-P0｜Must#3：surface.width/height 为【逻辑窗口尺寸】=
 * canvas.width / pixelRatio（契约见 canvasSurface.ts：width 为「视口逻辑像素宽」）。
 * 入口保证 canvas.width = windowWidth×pixelRatio（backing）→ width/height 恒 =
 * windowWidth/windowHeight（逻辑）。两值实时 getter：backing 变更（boot 定版 /
 * onWindowResize）后自动反映，杜绝旧尺寸。Renderer 视 view 域=logical（fit 按逻辑，
 * 绘制经 setTransform(dpr) 一次映射到 backing）；UI/Input 直接读 canvas backing ÷dpr。
 */
export class WechatViewport implements PlatformViewport {
  private readonly surfaceValue: CanvasSurface;
  constructor(canvas: CanvasLike, pixelRatio = 1) {
    const dpr = Math.max(1, pixelRatio || 1);
    this.surfaceValue = {
      // 逻辑窗口尺寸（backing ÷ dpr；入口保证 backing = window×dpr → 结果 = window 逻辑）
      get width() {
        return canvas.width / dpr;
      },
      get height() {
        return canvas.height / dpr;
      },
      devicePixelRatio: dpr,
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
