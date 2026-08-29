import type { PlatformLifecycle } from '../types';

/**
 * 微信生命周期后端：wx.requestAnimationFrame（+setTimeout 兜底）+ onHide/onShow。
 * 全部经 (globalThis as any).wx 懒取，wx 缺失时安全降级。
 */
export class WechatLifecycle implements PlatformLifecycle {
  private get wx(): any {
    return (globalThis as any).wx;
  }
  /**
   * F-WX-RUNTIME-LIFECYCLE-P0（Must#3「不重复注册 listener」）：
   * wx.onHide / wx.onShow 是**全局单例监听**（重复注册会叠加回调，导致一次切后台
   * 触发 N 次处理 → 多套循环 / 多次音频停止）。故此处：
   * - wx.onHide/onShow **只绑定一次**（bound 标志），后续调用只往本地数组追加回调；
   * - 多个业务方可安全调用 onVisibilityChange，各自收到通知，但 wx 侧仍只有一对监听。
   */
  private visibilityCbs: Array<(hidden: boolean) => void> = [];
  private bound = false;
  now(): number {
    return Date.now();
  }
  requestAnimationFrame(cb: (time: number) => void): number {
    const wx = this.wx;
    if (wx && typeof wx.requestAnimationFrame === 'function') {
      return wx.requestAnimationFrame(cb);
    }
    // 兜底（部分基础库缺 requestAnimationFrame）
    return setTimeout(() => cb(this.now()), 16) as unknown as number;
  }
  cancelAnimationFrame(handle: number): void {
    const wx = this.wx;
    if (wx && typeof wx.cancelAnimationFrame === 'function') {
      wx.cancelAnimationFrame(handle);
    } else {
      clearTimeout(handle);
    }
  }
  onVisibilityChange(cb: (hidden: boolean) => void): void {
    this.visibilityCbs.push(cb);
    if (this.bound) return; // 已绑定：只登记回调，绝不二次注册 wx.onHide/onShow
    const wx = this.wx;
    if (!wx) return; // wx 缺失（测试桩）：保持未绑定，待 wx 出现后首次绑定
    const hasHide = typeof wx.onHide === 'function';
    const hasShow = typeof wx.onShow === 'function';
    if (!hasHide && !hasShow) return;
    this.bound = true;
    if (hasHide) wx.onHide(() => this.emitVisibility(true));
    if (hasShow) wx.onShow(() => this.emitVisibility(false));
  }

  /** 微信侧一次 onHide/onShow → 通知所有登记方（异常隔离：单个回调抛错不影响其它） */
  private emitVisibility(hidden: boolean): void {
    for (const cb of [...this.visibilityCbs]) {
      try {
        cb(hidden);
      } catch {
        // 单个回调异常不得中断其它生命周期处理（也不得冒泡为崩溃）
      }
    }
  }

  /** 测试/诊断探针：wx.onHide/onShow 的实际注册次数（Must#3：恒 ≤1 对） */
  get boundOnce(): boolean {
    return this.bound;
  }
  get listenerCount(): number {
    return this.visibilityCbs.length;
  }
}
