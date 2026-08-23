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

// —— Viewport（视口尺寸 + 变化订阅）——
export interface PlatformViewport {
  /** 当前视口 surface（宽/高/DPR/时间源），供 Renderer 注入 */
  surface(): CanvasSurface;
  /** 订阅视口尺寸变化（Web=window resize；微信=固定方向无变化 → no-op） */
  onResize(cb: () => void): void;
}

// —— Input（UI 事件抽象；微信无 DOM UI → bindClick no-op，bindPointer 走 wx 触摸）——
export interface PlatformInput {
  /** 绑定 UI 元素点击事件；微信侧安全忽略（Player UI 未移植 DOM） */
  bindClick(el: EventTarget, handler: () => void): void;
  /**
   * Canvas 命中输入：绑定指针/触摸按下，回调元素本地坐标（CSS px，相对元素左上角）。
   * Web=pointerdown/mousedown/touchstart + getBoundingClientRect；
   * 微信=wx.onTouchStart（clientX/clientY）。F-WX-4 CanvasPlayerUIHost 唯一输入入口。
   */
  bindPointer(target: EventTarget, handler: (x: number, y: number) => void): void;
}

// —— 聚合 ——
export interface PlatformCore {
  storage: PlatformStorage;
  lifecycle: PlatformLifecycle;
  input: PlatformInput;
  createViewport(canvas: CanvasLike): PlatformViewport;
}
