/**
 * F-WX-VIEWPORT-SURFACE-P0｜微信 surface 测试环境（非测试文件，供多个 .test.ts 共享）。
 *
 * - SURFACE_ENVS：设备矩阵（window 逻辑 × dpr → backing）。
 * - makeSurfaceFakeWx(env)：fake wx——createCanvas 返回【逻辑默认尺寸】画布
 *   （真实微信首画布行为：canvas.width = windowWidth），getWindowInfo/getSystemInfoSync
 *   提供 window 逻辑尺寸 + dpr；用于验证入口把 backing 定版为 window×dpr。
 * - setWindow(w,h,dpr)：Must#8 运行时 resize 模拟（改窗口信息 + 触发 onWindowResize）。
 */
import { FakeCanvas } from './wechatCanvasFrameHost';

export interface SurfaceEnv {
  name: string;
  windowW: number;
  windowH: number;
  dpr: number;
  backingW: number;
  backingH: number;
}

export const SURFACE_ENVS: SurfaceEnv[] = [
  { name: '844x390@1', windowW: 844, windowH: 390, dpr: 1, backingW: 844, backingH: 390 },
  { name: '1024x470.5@2', windowW: 1024, windowH: 470.5, dpr: 2, backingW: 2048, backingH: 941 },
  { name: '844x390@3', windowW: 844, windowH: 390, dpr: 3, backingW: 2532, backingH: 1170 },
  { name: '932x430@3', windowW: 932, windowH: 430, dpr: 3, backingW: 2796, backingH: 1290 },
];

/** 微信运行时桩：createCanvas 返回【逻辑默认尺寸】画布（真实微信首画布行为）。 */
export function makeSurfaceFakeWx(env: SurfaceEnv) {
  const screen = new FakeCanvas({ width: env.windowW, height: env.windowH }); // 微信默认 = window 逻辑
  const ui = new FakeCanvas({ width: env.windowW, height: env.windowH });
  let createCount = 0;
  const store = new Map<string, unknown>();
  const raf: Array<(t: number) => void> = [];
  const touchDown: Array<(e: unknown) => void> = [];
  const touchUp: Array<(e: unknown) => void> = [];
  const resizeHandlers: Array<() => void> = [];
  const state = { windowW: env.windowW, windowH: env.windowH, dpr: env.dpr };
  const info = () => ({
    windowWidth: state.windowW,
    windowHeight: state.windowH,
    screenWidth: Math.round(state.windowW * state.dpr),
    screenHeight: Math.round(state.windowH * state.dpr),
    pixelRatio: state.dpr,
    safeArea: { left: 0, top: 0, right: state.windowW, bottom: state.windowH, width: state.windowW, height: state.windowH },
  });
  const wx = {
    getWindowInfo: () => info(),
    getSystemInfoSync: () => info(),
    createCanvas: () => (createCount++ === 0 ? screen : ui),
    createImage: () => ({ onload: null as (() => void) | null, onerror: null as (() => void) | null, src: '' }),
    getStorageSync: (k: string) => (store.has(k) ? store.get(k) : null),
    setStorageSync: (k: string, v: unknown) => void store.set(k, v),
    removeStorageSync: (k: string) => void store.delete(k),
    requestAnimationFrame: (cb: (t: number) => void) => {
      raf.push(cb);
      return raf.length;
    },
    cancelAnimationFrame: () => {
      raf.length = 0;
    },
    onTouchStart: (cb: (e: unknown) => void) => void touchDown.push(cb),
    onTouchEnd: (cb: (e: unknown) => void) => void touchUp.push(cb),
    onHide: () => {},
    onShow: () => {},
    // Must#8：可选 resize 钩子（真实基础库部分存在）
    onWindowResize: (cb: () => void) => void resizeHandlers.push(cb),
  };
  return {
    wx,
    screen,
    ui,
    store,
    raf,
    touchDown,
    touchUp,
    resizeHandlers,
    /** 触摸派发：down + up（gesture tap 语义，与 WechatInput.bindGesture 一致） */
    tap(x: number, y: number): void {
      const e = { touches: [{ clientX: x, clientY: y }], changedTouches: [{ clientX: x, clientY: y }] };
      for (const h of [...touchDown]) h(e);
      for (const h of [...touchUp]) h(e);
    },
    /** Must#8：改窗口信息并触发 onWindowResize（模拟运行时尺寸变化） */
    setWindow(w: number, h: number, dpr: number): void {
      state.windowW = w;
      state.windowH = h;
      state.dpr = dpr;
      for (const h of [...resizeHandlers]) h();
    },
  };
}

/** 驱动 N 帧：弹出 rAF 队列回调并执行（now 递增模拟时间）。 */
export function driveFrames(fake: ReturnType<typeof makeSurfaceFakeWx>, n: number, nowBase = 0): void {
  for (let i = 0; i < n; i++) {
    const cb = fake.raf.shift();
    if (cb) cb(nowBase + i * 16.7);
  }
}
