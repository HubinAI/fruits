import type { PlatformViewport, CanvasLike, SafeInsets } from '../types';
import type { CanvasSurface } from '../../render/canvasSurface';
import { readWechatWindowInfo } from './windowInfo';

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

  /**
   * 唯一横屏安全区契约（F-WX-SAFE-AREA-P0｜Must#3）：统一读取 `wx.getWindowInfo()` 的
   * `safeArea` 与 `wx.getMenuButtonBoundingClientRect()` 的胶囊矩形（两者同属 window 逻辑域），
   * 把「胶囊顶部 + 右侧」折叠进 insets.top / insets.right。UI 仅消费 insets 即可同时避让
   * 刘海/圆角与胶囊，禁止各页面独立硬编码 iPhone 偏移。
   *
   * - 顶部内缩 = max(safeArea.top, capsule.top) + GAP（横屏顶部短边/状态栏，兼避胶囊顶部）
   * - 右侧内缩 = max(safeArea.right, windowWidth − capsule.left) + GAP
   *   （胶囊位于顶部右侧，右侧 UI 右缘须 ≤ capsule.left 才不被遮挡）
   * - 无胶囊（menuButton=null，如测试桩 / 部分环境）→ 仅 safeArea 生效，行为不变。
   */
  safeInsets(): SafeInsets {
    const info = readWechatWindowInfo();
    if (!info) return ZERO_INSETS;
    const ww = info.windowWidth;
    const wh = info.windowHeight;
    const sa = info.safeArea;
    const clamp = (v: number): number => (Number.isFinite(v) && v > 0 ? v : 0);
    let left = sa ? clamp(sa.left) : 0;
    let right = sa && ww > 0 ? clamp(ww - sa.right) : 0;
    let top = sa ? clamp(sa.top) : 0;
    let bottom = sa && wh > 0 ? clamp(wh - sa.bottom) : 0;
    const mb = info.menuButton;
    if (mb) {
      const CAPSULE_GAP = 6; // Must#4：与胶囊保持 ≥6px logical 间距
      const rightCapsule = ww > 0 ? clamp(ww - mb.left) : 0;
      const topCapsule = clamp(mb.top);
      if (rightCapsule + CAPSULE_GAP > right) right = rightCapsule + CAPSULE_GAP;
      if (topCapsule + CAPSULE_GAP > top) top = topCapsule + CAPSULE_GAP;
    }
    return { left, right, top, bottom };
  }
}
