import { describe, it, expect, afterEach } from 'vitest';
import { CanvasPlayerUIHost } from '../src/ui/canvasPlayerUIHost';
import { Renderer } from '../src/render/renderer';
import { VisualRegistry } from '../src/render/visualRegistry';
import { createWebCore } from '../src/platform/web';
import { bindPlatformCore } from '../src/platform/context';
import { WebInput } from '../src/platform/web/input';
import type { CanvasSurface } from '../src/render/canvasSurface';

// ---- 复用最小桩（与 composeP0 同源，保持独立文件）----
function makeCtx() {
  return new Proxy({} as CanvasRenderingContext2D, {
    get: () => () => ({ width: 0 }),
    set: () => true,
  });
}
function makeCanvas(w: number, h: number) {
  const style: Record<string, string> = {};
  const canvas = {
    getContext: () => makeCtx(),
    width: w,
    height: h,
    clientWidth: w,
    clientHeight: h,
    style,
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as HTMLCanvasElement;
  return { canvas, style };
}
// 记录型 2D ctx：捕获 save/restore/setTransform/drawImage
function recordingCtx() {
  const calls: Array<{ method: string; args?: unknown[] }> = [];
  const handler = {
    get(_t: unknown, prop: string) {
      if (prop === 'canvas') return undefined;
      if (prop === 'drawImage') return (...a: unknown[]) => calls.push({ method: 'drawImage', args: a });
      if (prop === 'save' || prop === 'restore' || prop === 'setTransform' || prop === 'clearRect') {
        return () => calls.push({ method: prop });
      }
      return () => {};
    },
    set: () => true,
  };
  return { ctx: new Proxy({} as unknown as CanvasRenderingContext2D, handler), calls };
}

describe('F-PLAYER-SINGLE-CANVAS-RECOVERY-P0｜统一玩家最终画布/合成/输入坐标', () => {
  afterEach(() => {
    bindPlatformCore(createWebCore());
  });

  it('S1. mountScreen：UI 画布离屏（不 appendChild），compositeCanvas 返回离屏 UI 画布', () => {
    bindPlatformCore(createWebCore());
    const appended: unknown[] = [];
    const parent = { appendChild: (c: unknown) => appended.push(c), clientWidth: 1920, clientHeight: 1008 } as unknown as HTMLElement;
    const ui = makeCanvas(844, 390);
    const screen = makeCanvas(1688, 780);
    const host = new CanvasPlayerUIHost(ui.canvas, { phoneLogical: true });
    host.mountScreen(screen.canvas, parent);
    // 玩家模式：UI 画布不进入 DOM（离屏绘制，仅 Renderer 画布可见）
    expect(appended.includes(ui.canvas), 'UI 画布不得进入 DOM').toBe(false);
    expect(host.compositeCanvas, 'compositeCanvas = 离屏 UI 画布').toBe(ui.canvas);

    // 对照：非玩家 mount(parent) 仍把 UI 画布 append 到 DOM（既有双画布路径保留，不在本 Queue 改造范围）
    const appended2: unknown[] = [];
    const parent2 = { appendChild: (c: unknown) => appended2.push(c), clientWidth: 1920, clientHeight: 1008 } as unknown as HTMLElement;
    const ui2 = makeCanvas(844, 390);
    const host2 = new CanvasPlayerUIHost(ui2.canvas, { phoneLogical: true });
    host2.mount(parent2);
    expect(appended2.includes(ui2.canvas), '非玩家 mount 仍 append UI 画布').toBe(true);
  });

  it('S2. Renderer.compositeOverlay：离屏 UI 以 1:1 映射到 Renderer backing（同 844×390×DPR 舞台，无二次缩放）', () => {
    const { ctx, calls } = recordingCtx();
    const canvas = { getContext: () => ctx, width: 1688, height: 780, style: {} } as unknown as HTMLCanvasElement;
    const surface: CanvasSurface = { width: 1688, height: 780, devicePixelRatio: 2, now: () => 0 };
    const r = new Renderer(canvas, new VisualRegistry(), surface);
    const src = { width: 1688, height: 780 } as unknown as HTMLCanvasElement;
    r.compositeOverlay(src);
    const di = calls.find((c) => c.method === 'drawImage');
    expect(di, '调用 drawImage 合成').toBeTruthy();
    expect(di!.args![0], '源 = 离屏 UI 画布').toBe(src);
    // drawImage(src, 0,0, srcW,srcH, 0,0, dstW,dstH)：src 全幅 → dst 全幅 = 1:1
    expect(di!.args![1]).toBe(0);
    expect(di!.args![2]).toBe(0);
    expect(di!.args![3]).toBe(1688); // src 宽
    expect(di!.args![4]).toBe(780); // src 高
    expect(di!.args![5]).toBe(0);
    expect(di!.args![6]).toBe(0);
    expect(di!.args![7]).toBe(1688); // dst 宽 = 1:1（无二次缩放）
    expect(di!.args![8]).toBe(780); // dst 高 = 1:1
    expect(calls.some((c) => c.method === 'save'), 'save 隔离变换').toBe(true);
    expect(calls.some((c) => c.method === 'restore'), 'restore 复原变换').toBe(true);
  });

  it('S3. 输入仅绑定到唯一可见屏幕画布：mountScreen 只 bindPointer(screen)，不 bind 离屏 UI 画布', () => {
    let boundTarget: unknown = null;
    let boundHandler: unknown = null;
    const core = createWebCore();
    bindPlatformCore({
      ...core,
      input: { ...core.input, bindPointer: (t: unknown, h: unknown) => { boundTarget = t; boundHandler = h; } },
    } as Parameters<typeof bindPlatformCore>[0]);
    const ui = makeCanvas(844, 390);
    const screen = makeCanvas(1688, 780);
    const host = new CanvasPlayerUIHost(ui.canvas, { phoneLogical: true });
    host.mountScreen(screen.canvas, { appendChild() {}, clientWidth: 1920, clientHeight: 1008 } as unknown as HTMLElement);
    expect(boundTarget, '输入绑定目标 = 唯一可见屏幕画布').toBe(screen.canvas);
    expect(boundTarget, '输入不得绑定到离屏 UI 画布').not.toBe(ui.canvas);
    expect(typeof boundHandler, '传入了指针处理回调').toBe('function');
  });

  it('S5. 输入坐标单次转换：屏幕画布 CSS=逻辑844，WebInput 把 client 归一化为逻辑坐标一次', () => {
    const input = new WebInput();
    let got: [number, number] | null = null;
    let screenHandler: ((e: unknown) => void) | null = null;
    const screen = {
      clientWidth: 844,
      clientHeight: 390,
      getBoundingClientRect: () => ({ left: 100, top: 50, width: 1688, height: 780, right: 0, bottom: 0, x: 0, y: 0 } as DOMRect),
      addEventListener: (_t: string, h: (e: unknown) => void) => { screenHandler = h; },
    } as unknown as HTMLElement;
    input.bindPointer(screen, (x, y) => { got = [x, y]; });
    // 逻辑 (422,195) 在 contain scale=2 下：clientX = 100 + 422*2 = 944；clientY = 50 + 195*2 = 440
    screenHandler!({ clientX: 944, clientY: 440 });
    expect(got, '收到归一化坐标').not.toBeNull();
    expect(got![0], 'localX = 逻辑 x（仅转换一次）').toBeCloseTo(422, 3);
    expect(got![1], 'localY = 逻辑 y（仅转换一次）').toBeCloseTo(195, 3);
  });

  it('S4. 架构守卫：玩家模式 main.ts 路由 mountScreen + 每帧 compositeOverlay；DPR 变换在 applyPhoneScale 后回写', () => {
    const fs = require('fs');
    const path = require('path');
    const MAIN = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.ts'), 'utf-8');
    expect(MAIN, '玩家模式走 mountScreen').toContain('(host as CanvasPlayerUIHost).mountScreen(canvas, canvasWrap)');
    expect(MAIN, '每帧合成离屏 UI').toContain('renderer.compositeOverlay(oc)');
    expect(MAIN, 'compositeCanvas 取自 host').toContain('host.compositeCanvas');
    const HOST = (CanvasPlayerUIHost as unknown as { toString: () => string }).toString();
    expect(HOST, 'mountScreen 方法存在').toContain('mountScreen(screen');
    expect(HOST, 'compositeCanvas getter 存在').toContain('get compositeCanvas');
  });
});
