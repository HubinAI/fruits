/**
 * F-WX-RUNTIME-LIFECYCLE-P0（Must#7）：微信端错误兜底记录。
 *
 * 微信小游戏没有浏览器 devtools 的全局错误面板，未捕获异常 / Promise 拒绝会「静默消失」，
 * 导致真机崩溃无法归因。此处统一在平台层注册 wx.onError / wx.onUnhandledRejection，
 * 把构建 SHA + 当前玩家阶段写入日志，便于后续从运行记录里定位「哪次构建 / 哪个阶段」出错。
 *
 * 关键约束：仅日志，**绝不向玩家界面展示任何调试堆栈**——玩家界面必须保持干净。
 * 也**只注册一次**（wx.onError/onUnhandledRejection 是全局单例监听，重复注册会叠加）。
 */
export interface WechatLikeErrorHooks {
  onError?: (cb: (err: unknown) => void) => void;
  onUnhandledRejection?: (cb: (reason: unknown) => void) => void;
}

export interface InstallErrorGuardOptions {
  wx: WechatLikeErrorHooks | null | undefined;
  /** 构建期注入的 git SHA（来自 virtual:runtime-info，非手写常量） */
  sha: string;
  /** 当前玩家阶段（runtime.playerPhase）；在回调内惰性读取，避免模块求值期 TDZ */
  getPhase: () => string;
  /** 可注入的日志出口（默认 console.error）；测试可替换为 spy */
  log?: (line: string) => void;
}

/**
 * 安装微信错误兜底（幂等：多次调用只会读一次配置，不会重复注册 wx 监听）。
 * 返回 true 表示已成功绑定至少一种监听；wx 缺失 / 无错误钩子时返回 false（安全降级）。
 */
export function installWechatErrorGuard(opts: InstallErrorGuardOptions): boolean {
  const wx = opts.wx;
  if (!wx) return false;
  const log = opts.log ?? ((line: string) => console.error(line));
  const report = (tag: string, err: unknown): void => {
    const phase = opts.getPhase();
    const shortSha = opts.sha ? opts.sha.slice(0, 7) : 'unknown';
    const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err);
    log(`[WECHAT-ERROR] sha=${shortSha} phase=${phase} ${tag}: ${msg}`);
  };

  let bound = false;
  if (typeof wx.onError === 'function') {
    wx.onError((e: any) => report('onError', e?.message ?? e));
    bound = true;
  }
  if (typeof wx.onUnhandledRejection === 'function') {
    wx.onUnhandledRejection((e: any) => report('unhandledrejection', e?.reason ?? e));
    bound = true;
  }
  return bound;
}
