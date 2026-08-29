/**
 * F-WX-IOS-CANVAS-CRASH-P0｜MUST#5 SingleLoop 异常续帧回归锁
 *
 * 修复前：onFrame 抛异常 → scheduled=false、running 仍为 true、request() 不再被调用
 * → 「running=true 但 pending=0」的静默假运行态（真机 ~6s 画面停止更新）。
 *
 * 修复后：onFrame 异常被捕获并上报一次（不吞根因），随后仍续帧（request 照常），
 * 主循环不因单帧错误停摆。
 */
import { describe, it, expect } from 'vitest';
import { SingleLoop } from '../src/platform/wechat/singleLoop';

/** 捕获式 raf/caf 驱动：tick(t) 手动推进一帧 */
function makeDriver() {
  let pending: ((t: number) => void) | null = null;
  const raf = (cb: (t: number) => void): number => {
    pending = cb;
    return 1;
  };
  const caf = (_h: number): void => {
    pending = null;
  };
  return {
    raf,
    caf,
    tick(t: number): void {
      const c = pending;
      pending = null;
      if (c) c(t);
    },
  };
}

describe('F-WX-IOS-CANVAS-CRASH-P0｜SingleLoop 异常续帧', () => {
  it('120 帧正常驱动：每帧都执行，pendingFrames 恒 ≤1', () => {
    const d = makeDriver();
    const loop = new SingleLoop(d.raf, d.caf);
    let frames = 0;
    loop.onFrame = () => {
      frames++;
    };
    loop.request();
    for (let i = 0; i < 120; i++) {
      expect(loop.pendingFrames).toBe(1); // 待执行帧至多 1
      d.tick(i);
    }
    expect(frames).toBe(120);
    expect(loop.pendingFrames).toBe(1); // 末帧后已续帧
  });

  it('第 10 帧抛异常：仅上报一次，循环继续调度（无静默卡死）', () => {
    const d = makeDriver();
    const loop = new SingleLoop(d.raf, d.caf);
    const errors: unknown[] = [];
    loop.onError = (err) => {
      errors.push(err);
    };
    let frames = 0;
    loop.onFrame = (t) => {
      frames++;
      if (t === 10) throw new Error('boom');
    };
    loop.request();
    for (let i = 0; i < 120; i++) {
      d.tick(i);
    }
    // 其他 119 帧照常运行（异常帧也已进入 onFrame，仅抛错）
    expect(frames).toBe(120);
    // 首异常仅上报一次（去重，杜绝无限刷屏）
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe('boom');
    // 循环仍在运行且已续帧 —— 无「running=true 但 pending=0」假运行态
    expect(loop.isRunning).toBe(true);
    expect(loop.pendingFrames).toBe(1);
  });

  it('异常帧后下一帧调度已就绪（立刻续帧，不等待）', () => {
    const d = makeDriver();
    const loop = new SingleLoop(d.raf, d.caf);
    loop.onError = () => {};
    loop.onFrame = (t) => {
      if (t === 5) throw new Error('x');
    };
    loop.request();
    for (let i = 0; i <= 5; i++) d.tick(i);
    // 第 5 帧抛错后，step 应已再次 request → pending=1（不是死锁）
    expect(loop.pendingFrames).toBe(1);
    expect(loop.isRunning).toBe(true);
  });

  it('stop() 后异常不再续帧（生命周期正确）', () => {
    const d = makeDriver();
    const loop = new SingleLoop(d.raf, d.caf);
    let frames = 0;
    loop.onFrame = () => {
      frames++;
    };
    loop.request();
    d.tick(0);
    loop.stop();
    expect(loop.isRunning).toBe(false);
    expect(loop.pendingFrames).toBe(0);
  });
});
