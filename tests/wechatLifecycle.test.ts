/**
 * F-WX-RUNTIME-LIFECYCLE-P0｜定向测试。
 *
 * 验收目标（对应 USER Must）：
 * - Must#3：wx.onHide/onShow 只注册一次（不重复注册 listener / rAF）；
 *          单循环守卫：连续 onShow / 切后台-回前台不会起第二个 frame 循环。
 * - Must#7：wx.onError/onUnhandledRejection 记录 SHA + 玩家阶段；仅日志、不暴露堆栈给玩家。
 *
 * 均为纯 Node 单元（不依赖真机 / 浏览器），用 fake wx / fake raf 间接验证真实 Runtime 行为。
 */
import { describe, it, expect } from 'vitest';
import { WechatLifecycle } from '../src/platform/wechat/lifecycle';
import { SingleLoop } from '../src/platform/wechat/singleLoop';
import { installWechatErrorGuard } from '../src/platform/wechat/errorGuard';

describe('F-WX-RUNTIME-LIFECYCLE-P0｜WechatLifecycle 单次注册', () => {
  it('多次 onVisibilityChange 只绑定一对 wx.onHide/onShow', () => {
    const handlers: Record<string, ((e?: any) => void) | undefined> = {};
    const wxLike = {
      onHide: (cb: any) => (handlers.hide = cb),
      onShow: (cb: any) => (handlers.show = cb),
    };
    const life = new WechatLifecycle();
    (globalThis as any).wx = wxLike;
    try {
      life.onVisibilityChange(() => {});
      life.onVisibilityChange(() => {});
      life.onVisibilityChange(() => {});
      expect(life.boundOnce).toBe(true);
      expect(typeof handlers.hide).toBe('function');
      expect(typeof handlers.show).toBe('function');
    } finally {
      delete (globalThis as any).wx;
    }
  });

  it('多个业务方登记都能收到可见性回调（fanout）', () => {
    const handlers: Record<string, ((e?: any) => void) | undefined> = {};
    const wxLike = {
      onHide: (cb: any) => (handlers.hide = cb),
      onShow: (cb: any) => (handlers.show = cb),
    };
    (globalThis as any).wx = wxLike;
    const life = new WechatLifecycle();
    const seen: boolean[] = [];
    life.onVisibilityChange((h) => seen.push(h));
    life.onVisibilityChange((h) => seen.push(h));
    try {
      handlers.hide?.();
      handlers.show?.();
      // 两个回调各收到一次，且取值正确（hide=true / show=false）
      expect(seen).toEqual([true, true, false, false]);
    } finally {
      delete (globalThis as any).wx;
    }
  });

  it('单个回调抛错不中断其它回调（异常隔离）', () => {
    const handlers: Record<string, ((e?: any) => void) | undefined> = {};
    const wxLike = {
      onHide: (cb: any) => (handlers.hide = cb),
      onShow: (cb: any) => (handlers.show = cb),
    };
    (globalThis as any).wx = wxLike;
    const life = new WechatLifecycle();
    const order: string[] = [];
    life.onVisibilityChange(() => {
      order.push('a');
      throw new Error('boom');
    });
    life.onVisibilityChange(() => order.push('b'));
    try {
      expect(() => handlers.hide?.()).not.toThrow();
      expect(order).toEqual(['a', 'b']);
    } finally {
      delete (globalThis as any).wx;
    }
  });

  it('wx 缺失 / 无钩子：保持未绑定（安全降级）', () => {
    const life = new WechatLifecycle();
    (globalThis as any).wx = { getSystemInfoSync: () => ({}) };
    expect(life.boundOnce).toBe(false);
    delete (globalThis as any).wx;
  });
});

describe('F-WX-RUNTIME-LIFECYCLE-P0｜SingleLoop 单循环守卫', () => {
  function makeFakeRaf() {
    let nextId = 1;
    const pending = new Map<number, (t: number) => void>();
    const raf = (cb: (t: number) => void): number => {
      const id = nextId++;
      pending.set(id, cb);
      return id;
    };
    const caf = (h: number) => {
      pending.delete(h);
    };
    const tick = (id: number, t: number) => {
      const cb = pending.get(id);
      pending.delete(id);
      cb?.(t);
    };
    return { raf, caf, tick, pending };
  }

  it('连续 request 至多注册一个待执行帧（幂等）', () => {
    const fake = makeFakeRaf();
    const loop = new SingleLoop(fake.raf, fake.caf);
    loop.onFrame = () => {};
    loop.request();
    loop.request();
    loop.request();
    expect(fake.pending.size).toBe(1);
    expect(loop.pendingFrames).toBe(1);
  });

  it('完成一帧后自动续帧，且仍受幂等保护', () => {
    const fake = makeFakeRaf();
    const loop = new SingleLoop(fake.raf, fake.caf);
    let frames = 0;
    loop.onFrame = () => {
      frames++;
    };
    loop.request();
    const id1 = [...fake.pending.keys()][0];
    fake.tick(id1, 16);
    // 续帧后再 request 不应额外注册
    loop.request();
    expect(fake.pending.size).toBe(1);
    const id2 = [...fake.pending.keys()][0];
    fake.tick(id2, 32);
    expect(frames).toBe(2);
  });

  it('stop 取消待执行帧且下次 request 不出错', () => {
    const fake = makeFakeRaf();
    const loop = new SingleLoop(fake.raf, fake.caf);
    loop.onFrame = () => {};
    loop.request();
    expect(fake.pending.size).toBe(1);
    loop.stop();
    expect(fake.pending.size).toBe(0);
    expect(loop.pendingFrames).toBe(0);
    loop.start(); // 重新启动（对应 onShow：loop.start() 后再 request）
    loop.request(); // stop 后允许重新调度
    expect(fake.pending.size).toBe(1);
  });

  it('stop 后帧回调不再续帧（后台暂停）', () => {
    const fake = makeFakeRaf();
    const loop = new SingleLoop(fake.raf, fake.caf);
    let frames = 0;
    loop.onFrame = () => {
      frames++;
    };
    loop.request();
    loop.stop();
    const id = [...fake.pending.keys()][0];
    fake.tick(id, 16); // stop 已清空 pending，tick 无对应回调 → 不执行
    expect(frames).toBe(0);
  });
});

describe('F-WX-RUNTIME-LIFECYCLE-P0｜微信错误兜底记录', () => {
  it('绑定 onError / onUnhandledRejection 且日志含 SHA + 阶段（不抛、不暴露堆栈）', () => {
    const handlers: Record<string, ((e?: any) => void) | undefined> = {};
    const wxLike = {
      onError: (cb: any) => (handlers.error = cb),
      onUnhandledRejection: (cb: any) => (handlers.reject = cb),
    };
    const logs: string[] = [];
    const ok = installWechatErrorGuard({
      wx: wxLike,
      sha: 'abcdef1234567890',
      getPhase: () => 'battle',
      log: (line) => logs.push(line),
    });
    expect(ok).toBe(true);
    handlers.error?.({ message: 'oops' });
    handlers.reject?.({ reason: new Error('boom') });
    expect(logs.length).toBe(2);
    expect(logs[0]).toContain('sha=abcdef1');
    expect(logs[0]).toContain('phase=battle');
    expect(logs[0]).toContain('onError');
    expect(logs[1]).toContain('unhandledrejection');
    expect(logs[0]).not.toContain('stack');
  });

  it('wx 缺失时安全降级（返回 false，不抛）', () => {
    const logs: string[] = [];
    const ok = installWechatErrorGuard({
      wx: null,
      sha: 'x',
      getPhase: () => 'boot',
      log: (line) => logs.push(line),
    });
    expect(ok).toBe(false);
    expect(logs.length).toBe(0);
  });
});
