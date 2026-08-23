/**
 * CanvasSurface：渲染所需的「平台视口 + 时间源」抽象。
 *
 * 动机（F-WX-1 / F-WX-2）：
 * - Web 下 Renderer 过去直接读 `window.devicePixelRatio` / `canvas.clientWidth`
 *   / `performance.now()`，这些是浏览器专属全局，在微信小游戏（无 window / 无
 *   HTMLCanvasElement.clientWidth / performance 全局形态不同）无法运行；
 * - 抽离为可注入的 CanvasSurface 后，Renderer 不再感知平台：Web 用 DOM canvas 的
 *   真实 clientWidth/devicePixelRatio/performance；WeChat 用 wx.getSystemInfoSync()
 *   的 pixelRatio + canvas.width/height + Date.now()；
 * - 此接口即 F-WX-2 Platform Core 中 Viewport Adapter 的最小契约雏形（viewport 提供
 *   width/height/pixelRatio，驱动循环提供 now）。
 *
 * 设计约束（不破坏现有 Web 行为）：surface 为「可选注入」。未注入时 Renderer 退回
 * 原有浏览器全局读取路径，现有 20+ 渲染测试零回归。
 */
export interface CanvasSurface {
  /** 视口逻辑像素宽（CSS px；Web = canvas.clientWidth，WeChat = canvas.width） */
  width: number;
  /** 视口逻辑像素高（CSS px；Web = canvas.clientHeight，WeChat = canvas.height） */
  height: number;
  /** 设备像素比（Web = window.devicePixelRatio，WeChat = sys.pixelRatio） */
  devicePixelRatio: number;
  /** 单调时间源（ms；Web = performance.now()，WeChat = Date.now() 或 wx 性能接口） */
  now(): number;
}
