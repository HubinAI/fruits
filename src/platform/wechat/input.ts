import type { PlatformInput, PointerGestureHandlers } from '../types';

/**
 * F-WX-P0-INPUT｜微信输入后端——Viewport Logical Coordinates Contract。
 *
 * 契约：PlatformInput 输出 **Viewport Logical Coordinates**（x ∈ [0, viewportLogicalWidth]，
 * y ∈ [0, viewportLogicalHeight]），与 CanvasPlayerUIHost 的布局空间（canvas.width/pixelRatio）
 * 同一体系；CanvasPlayerUIHost 不感知 physical pixel / devicePixelRatio / 微信原始坐标差异。
 *
 * 归一化（不硬编码 /2 /3 /机型比例）：
 *   logicalX = rawX × logicalViewportWidth / rawCoordinateWidth
 *   logicalY = rawY × logicalViewportHeight / rawCoordinateHeight
 * 微信小游戏 touch clientX/clientY 官方语义 = 窗口逻辑 px（与 windowWidth/Height 同体系），
 * 此时 rawCoordinateWidth == logicalViewportWidth → 比例 1 直接使用；
 * 若某平台/模拟器返回物理 px（rawCoordinateWidth == 物理宽），比例自动归一化到逻辑空间。
 *
 * DEV-only Input Trace（__WX_DEBUG__ = true，WECHAT_DEBUG_INPUT=1 构建注入）：
 * 每次真实触摸输出 [WX-INPUT] raw / viewport / canvas / converted 结构化日志；
 * PROD 构建 __WX_DEBUG__=false → 零日志。
 *
 * 事件生命周期：wx.onTouchStart 一次触摸 → 一次 handler 调用 → 一次 action（无 touchend 二次派发）。
 */
const isDebug = typeof __WX_DEBUG__ !== 'undefined' && __WX_DEBUG__ === true;

export class WechatInput implements PlatformInput {
  private get wx(): any {
    return (globalThis as any).wx;
  }

  bindClick(_el: EventTarget, _handler: () => void): void {
    // 微信侧无 DOM UI；占位 no-op
  }

  bindPointer(target: EventTarget, handler: (x: number, y: number) => void): void {
    const wx = this.wx;
    if (!wx || typeof wx.onTouchStart !== 'function') return;
    wx.onTouchStart((e: any) => {
      const t = e && e.touches && e.touches[0];
      if (!t) return;
      const p = this.toLogical(t, target);
      handler(p.x, p.y);
    });
  }

  /** F-GARAGE-CENTER-STAGE-P0：微信手势生命周期（onTouchStart/Move/End/Cancel）。 */
  bindGesture(target: EventTarget, handlers: PointerGestureHandlers): void {
    const wx = this.wx;
    if (!wx || typeof wx.onTouchStart !== 'function') return;
    const touch0 = (e: any): any => e && e.touches && e.touches[0];
    // 防御性：测试桩 wx 可能只含 onTouchStart；缺 move/end/cancel 时单次点击仍能派发（onUp 必调）。
    if (typeof wx.onTouchStart === 'function') {
      wx.onTouchStart((e: any) => {
        const t = touch0(e);
        if (!t) return;
        const p = this.toLogical(t, target);
        handlers.onDown(p.x, p.y);
      });
    }
    if (typeof wx.onTouchMove === 'function') {
      wx.onTouchMove((e: any) => {
        const t = touch0(e);
        if (!t) return;
        const p = this.toLogical(t, target);
        handlers.onMove(p.x, p.y);
      });
    }
    if (typeof wx.onTouchEnd === 'function') {
      wx.onTouchEnd((e: any) => {
        const t = touch0(e);
        if (!t) return;
        const p = this.toLogical(t, target);
        handlers.onUp(p.x, p.y, false);
      });
    }
    if (typeof wx.onTouchCancel === 'function') {
      wx.onTouchCancel((e: any) => {
        const t = touch0(e);
        if (!t) return;
        const p = this.toLogical(t, target);
        handlers.onUp(p.x, p.y, true);
      });
    }
  }

  /** Viewport Logical Coordinates 归一化（与 bindPointer 同一转换）。 */
  private toLogical(t: any, target: EventTarget): { x: number; y: number } {
    const rawX = typeof t.clientX === 'number' ? t.clientX : (t.pageX ?? 0);
    const rawY = typeof t.clientY === 'number' ? t.clientY : (t.pageY ?? 0);
    const wx = this.wx;
    const sys = wx && wx.getSystemInfoSync ? wx.getSystemInfoSync() : null;
    const pixelRatio = (sys && sys.pixelRatio) || 1;
    const windowWidth = (sys && sys.windowWidth) || 0;
    const windowHeight = (sys && sys.windowHeight) || 0;
    const el = target as { width?: number; height?: number };
    const logicalVW = (el.width ?? 0) / Math.max(pixelRatio, 1);
    const logicalVH = (el.height ?? 0) / Math.max(pixelRatio, 1);
    const logicalX = rawX * (logicalVW / Math.max(windowWidth, 1));
    const logicalY = rawY * (logicalVH / Math.max(windowHeight, 1));
    if (isDebug) {
      // eslint-disable-next-line no-console
      console.log('[WX-INPUT] converted', JSON.stringify({ logicalX: +logicalX.toFixed(2), logicalY: +logicalY.toFixed(2) }));
    }
    return { x: logicalX, y: logicalY };
  }
}
