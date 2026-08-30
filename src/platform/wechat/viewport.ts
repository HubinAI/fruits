import type { PlatformViewport, CanvasLike, SafeInsets } from '../types';
import type { CanvasSurface } from '../../render/canvasSurface';
import { readWechatWindowInfo } from './windowInfo';

const ZERO_INSETS: SafeInsets = { left: 0, right: 0, top: 0, bottom: 0 };
/** 与原生胶囊保持的最小间距（logical px；F-WX-SAFE-AREA-P0 Must#4）。 */
const CAPSULE_GAP = 6;
/** menuButton API 缺失/异常时的右侧保留 fallback：窗口逻辑宽比例（iPhone 横屏典型胶囊区 10~14%）。 */
const CAPSULE_FALLBACK_RATIO = 0.12;
/** fallback 下限（logical px；保守宁大勿小，不得回退为 0——Must#4）。 */
const CAPSULE_FALLBACK_PX = 96;

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
   * 唯一横屏安全区契约（F-WX-SAFE-AREA-P0｜Must#3 + F-WX-SAFE-AREA-R1）：统一读取
   * `wx.getWindowInfo()` 的 `safeArea` 与 `wx.getMenuButtonBoundingClientRect()` 的胶囊矩形，
   * 把「胶囊顶部 + 右侧」折叠进 insets.top / insets.right。UI 仅消费 insets 即可同时避让
   * 刘海/圆角与胶囊，禁止各页面独立硬编码 iPhone 偏移。
   *
   * - 顶部内缩 = max(safeArea.top, capsule.top) + GAP（横屏顶部短边/状态栏，兼避胶囊顶部）
   * - 右侧内缩（F-WX-SAFE-AREA-R1｜Must#2）= max(safeArea 右侧保留,
   *   windowWidth − (capsule.left − 6))——右侧 UI 右缘 ≤ capsule.left − 6 才不被遮挡。
   * - 坐标域（Must#3）：capsule.left 统一为 logical px——部分基础库/真机返回物理 px
   *   （left > windowWidth）时按 pixelRatio 归一到逻辑域，禁止混用 backing/DPR。
   * - 无胶囊 / API 异常（Must#4）：使用安全 fallback（窗口宽 12% 且 ≥96 logical px），
   *   不得回退为 0（iOS 横屏 safeArea.right≈0，回退 0 会让右侧 UI 落入胶囊区）。
   */
  safeInsets(): SafeInsets {
    const info = readWechatWindowInfo();
    if (!info) return ZERO_INSETS;
    const ww = info.windowWidth;
    const wh = info.windowHeight;
    const dpr = info.pixelRatio || 1;
    const sa = info.safeArea;
    const clamp = (v: number): number => (Number.isFinite(v) && v > 0 ? v : 0);
    let left = sa ? clamp(sa.left) : 0;
    let right = sa && ww > 0 ? clamp(ww - sa.right) : 0;
    let top = sa ? clamp(sa.top) : 0;
    let bottom = sa && wh > 0 ? clamp(wh - sa.bottom) : 0;
    const mb = info.menuButton;
    // Must#4 精确化：仅「API 存在但调用异常/返回无效」时用安全 fallback（不得回退 0）；
    // API 不存在（老基础库/测试桩，无胶囊能力）→ 保持 safeArea 语义（可 0，不制造虚假右保留）。
    const wxCtx = (globalThis as any).wx as any;
    const hasMenuButtonApi = !!wxCtx && typeof wxCtx.getMenuButtonBoundingClientRect === 'function';
    let rightReserved = 0;
    if (mb && Number.isFinite(mb.left)) {
      // Must#3：统一 logical px——物理 px（left > ww）÷ dpr 归一；逻辑 px 原样
      const mbLeftLogical = mb.left > ww && dpr > 1 ? mb.left / dpr : mb.left;
      // Must#2：rightReserved = ww − (capsule.left − GAP)；与 safeArea 右侧保留取较大值
      rightReserved = Math.max(0, ww - (mbLeftLogical - CAPSULE_GAP));
      // 胶囊顶部避让：仅 mb 有效时参与（避免无胶囊时误抬 top +GAP）
      const topCapsule = clamp(mb.top);
      if (topCapsule + CAPSULE_GAP > top) top = topCapsule + CAPSULE_GAP;
    } else if (hasMenuButtonApi) {
      rightReserved = ww > 0 ? Math.max(ww * CAPSULE_FALLBACK_RATIO, CAPSULE_FALLBACK_PX) : CAPSULE_FALLBACK_PX;
    }
    right = Math.max(right, rightReserved);
    return { left, right, top, bottom };
  }
}
