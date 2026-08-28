/**
 * F-WX-2｜统一 Platform Core 抽象。
 *
 * Gameplay / Physics / 成长经济逻辑不得直接依赖浏览器或微信全局
 * （localStorage / window / document / requestAnimationFrame / DOM 事件）。
 * 一切平台能力经本文件定义的四个接口抽象，由 Web / WeChat 各自实现。
 */
import type { CanvasSurface } from '../render/canvasSurface';

/** 最小 canvas 结构（Web HTMLCanvasElement 与微信 canvas 均满足） */
export interface CanvasLike {
  width: number;
  height: number;
  clientWidth?: number;
  clientHeight?: number;
}

// —— Storage（持久化后端抽象）——
export interface PlatformStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

// —— Lifecycle（主循环驱动 + 时间源 + 前后台）——
export interface PlatformLifecycle {
  /** 单调时间源（ms）；Web=performance.now，微信=Date.now */
  now(): number;
  requestAnimationFrame(cb: (time: number) => void): number;
  cancelAnimationFrame(handle: number): void;
  /** 前后台切换（Web=visibilitychange，微信=onHide/onShow）；hidden=true 表示进入后台 */
  onVisibilityChange(cb: (hidden: boolean) => void): void;
}

// —— Viewport（视口尺寸 + 变化订阅 + Safe Area）——
/** 安全区内缩（CSS px / 微信逻辑 px；横屏注意 left/right = 刘海侧） */
export interface SafeInsets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface PlatformViewport {
  /** 当前视口 surface（宽/高/DPR/时间源），供 Renderer 注入 */
  surface(): CanvasSurface;
  /** 订阅视口尺寸变化（Web=window resize；微信=固定方向无变化 → no-op） */
  onResize(cb: () => void): void;
  /**
   * 当前安全区内缩（刘海 / 圆角 / 系统边缘）。
   * F-WX-6：单位与 surface 宽度一致（Web=CSS px；微信=逻辑 px，与 canvas.width/pixelRatio 对应）。
   * Web 默认 0，可读 CSS env(safe-area-inset-*) 时安全使用；微信从 systemInfo.safeArea 计算。
   */
  safeInsets(): SafeInsets;
}

// —— Input（UI 事件抽象；微信无 DOM UI → bindClick no-op，bindPointer 走 wx 触摸）——
/** client 坐标 → 逻辑舞台坐标的转换（F-PLAYER-INPUT-SCALE-P0：PlayerViewportTransform.clientToLogical） */
export type ClientToLogical = (
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
) => { x: number; y: number };

/** F-GARAGE-CENTER-STAGE-P0：指针手势生命周期（down/move/up；up 的 cancelled=true 表示系统取消）。
 *  用于「横向滑动超过 8 logical px 取消该次点击」——部件带滑动浏览不误装备。 */
export interface PointerGestureHandlers {
  onDown(x: number, y: number): void;
  onMove(x: number, y: number): void;
  onUp(x: number, y: number, cancelled: boolean): void;
}

export interface PlatformInput {
  /** 绑定 UI 元素点击事件；微信侧安全忽略（Player UI 未移植 DOM） */
  bindClick(el: EventTarget, handler: () => void): void;
  /**
   * Canvas 命中输入：绑定指针/触摸按下，回调元素本地坐标（CSS px，相对元素左上角）。
   * Web=pointerdown/mousedown/touchstart + getBoundingClientRect；
   * 微信=wx.onTouchStart（clientX/clientY）。F-WX-4 CanvasPlayerUIHost 唯一输入入口。
   *
   * F-PLAYER-INPUT-SCALE-P0：可传可选 `toLogical` 转换——提供时回调输出为转换后的
   * 逻辑舞台坐标（844×390，经 PlayerViewportTransform.clientToLogical 统一转换，
   * client→可见 rect→logical 只发生一次）；不传时保持后端默认输出（Web=元素 CSS 局部
   * 坐标归一化；微信=viewport logical）。down/move/up/cancel 一律经同一转换（单点）。
   */
  bindPointer(
    target: EventTarget,
    handler: (x: number, y: number) => void,
    toLogical?: ClientToLogical,
  ): void;
  /**
   * F-GARAGE-CENTER-STAGE-P0：可选手势绑定（down/move/up 完整生命周期）。
   * 供 UI 实现「横向滑动取消点击 + 部件带滑动浏览」；平台不支持时（测试桩/旧后端）
   * 可省略本方法，调用方回退 bindPointer（纯 tap）。坐标语义与 bindPointer 一致。
   */
  bindGesture?(
    target: EventTarget,
    handlers: PointerGestureHandlers,
    toLogical?: ClientToLogical,
  ): void;
}

// —— 聚合 ——
export interface PlatformCore {
  storage: PlatformStorage;
  lifecycle: PlatformLifecycle;
  input: PlatformInput;
  createViewport(canvas: CanvasLike): PlatformViewport;
}
