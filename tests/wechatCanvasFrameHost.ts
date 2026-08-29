/**
 * F-WX-IOS-CANVAS-CRASH-P0｜Must#1 无 DOM 微信 Canvas 测试宿主（辅助）
 *
 * 提供：
 * - FakeCanvas / FakeCtx2D：软件光栅化的 2D 上下文（用像素集合 ink 记录绘制），
 *   用于在无 DOM / 无真机的环境下复现「UI 离屏画布逐帧累积」「transform 污染」
 *   「compositeOverlay 前后 transform 未恢复」三类问题。
 * - makeFakePlatformCore：注入式 platform core，避免拉入 Web DOM / 微信运行时。
 *
 * 设计原则：
 * - 只实现 Renderer / UIHost 实际用到的 2D API 子集；
 * - clearRect / fillRect / fillText / strokeRect / drawImage 都经过「当前 transform」
 *   映射到 device 像素，忠实还原 WeChat 的坐标域语义；
 * - 不引入任何 Web / 微信专有全局，纯 TS 可在 vitest 直接跑。
 */
import { bindPlatformCore } from '../src/platform/context';
import type { CanvasSurface } from '../src/render/canvasSurface';

export interface FakeCanvasOptions {
  width: number;
  height: number;
  /** 该画布的逻辑宽（logical stage，如 844） */
  logicalW?: number;
  /** 该画布的逻辑高（如 390） */
  logicalH?: number;
}

/** 软件光栅化 2D 上下文：用 Uint8Array 记录被绘制（ink）的 device 像素（0/1）。 */
export class FakeCtx2D {
  readonly canvas: FakeCanvas;
  /** 被绘制的 device 像素（1 = 已绘制），长度 = width*height */
  ink: Uint8Array;
  /** 仅由 fillText / strokeText 贡献的「文字像素」 */
  textInk: Uint8Array;
  /** 当前 ink 计数（增量维护，避免每帧全量统计） */
  inkCount = 0;
  textInkCount = 0;

  // ---- transform ----
  private a = 1;
  private b = 0;
  private c = 0;
  private d = 1;
  private e = 0;
  private f = 0;
  private stack: Array<[number, number, number, number, number, number]> = [];

  // ---- style ----
  fillStyle = '#000000';
  strokeStyle = '#000000';
  font = '10px sans-serif';
  globalAlpha = 1;
  globalCompositeOperation = 'source-over';
  lineWidth = 1;

  // ---- 诊断探针 ----
  /** 上一次 clearRect 后残留的 ink 数（clear 正确应为 0） */
  lastClearResidual = 0;
  /** 以非 identity transform 调用 clearRect 的次数 */
  nonIdentityClearCount = 0;
  /** 最近一次 clearRect 时的 transform 是否为 identity */
  lastClearWasIdentity = true;
  /** 绘制（fillRect/fillText/strokeRect）所用的最大 |scale|（MUST#4：应恰好 = DPR，一次转换） */
  maxDrawScale = 0;
  /** 最近一次 drawImage（composite）调用时的 |scale|（MUST#3/4：应为 1，identity 1:1） */
  lastDrawImageScale = 1;
  /** 最近一次 drawImage 调用时的 globalAlpha（MUST#3：应为 1，不被 FX 残留污染） */
  lastDrawImageAlpha = 1;
  /** 最近一次 drawImage 调用时的 globalCompositeOperation（MUST#3：应为 'source-over'） */
  lastDrawImageComposite: string = 'source-over';

  constructor(canvas: FakeCanvas) {
    this.canvas = canvas;
    this.ink = new Uint8Array(canvas.width * canvas.height);
    this.textInk = new Uint8Array(canvas.width * canvas.height);
  }

  private tp(x: number, y: number): [number, number] {
    return [this.a * x + this.c * y + this.e, this.b * x + this.d * y + this.f];
  }

  private fontSize(): number {
    const m = /(\d+(?:\.\d+)?)/.exec(this.font);
    return m ? parseFloat(m[1]) : 10;
  }

  private paintRectDevice(x0: number, y0: number, x1: number, y1: number, isText: boolean): void {
    const minX = Math.max(0, Math.floor(Math.min(x0, x1)));
    const maxX = Math.min(this.canvas.width, Math.ceil(Math.max(x0, x1)));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1)));
    const maxY = Math.min(this.canvas.height, Math.ceil(Math.max(y0, y1)));
    for (let py = minY; py < maxY; py++) {
      const row = py * this.canvas.width;
      for (let px = minX; px < maxX; px++) {
        const idx = row + px;
        if (this.ink[idx] === 0) {
          this.ink[idx] = 1;
          this.inkCount++;
        }
        if (isText && this.textInk[idx] === 0) {
          this.textInk[idx] = 1;
          this.textInkCount++;
        }
      }
    }
    const s = Math.max(Math.abs(this.a), Math.abs(this.d));
    if (s > this.maxDrawScale) this.maxDrawScale = s;
  }

  private paintRect(x: number, y: number, w: number, h: number, isText: boolean): void {
    const [x0, y0] = this.tp(x, y);
    const [x1, y1] = this.tp(x + w, y + h);
    this.paintRectDevice(x0, y0, x1, y1, isText);
  }

  // ===== Canvas API =====
  save(): void {
    this.stack.push([this.a, this.b, this.c, this.d, this.e, this.f]);
  }
  restore(): void {
    const t = this.stack.pop();
    if (t) [this.a, this.b, this.c, this.d, this.e, this.f] = t;
  }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.a = a; this.b = b; this.c = c; this.d = d; this.e = e; this.f = f;
  }
  resetTransform(): void {
    this.setTransform(1, 0, 0, 1, 0, 0);
  }
  /** 当前 transform 快照（测试断言用） */
  currentTransform(): [number, number, number, number, number, number] {
    return [this.a, this.b, this.c, this.d, this.e, this.f];
  }
  clearRect(x: number, y: number, w: number, h: number): void {
    const identity = this.a === 1 && this.b === 0 && this.c === 0 && this.d === 1 && this.e === 0 && this.f === 0;
    this.lastClearWasIdentity = identity;
    if (!identity) this.nonIdentityClearCount++;
    const [x0, y0] = this.tp(x, y);
    const [x1, y1] = this.tp(x + w, y + h);
    const minX = Math.max(0, Math.floor(Math.min(x0, x1)));
    const maxX = Math.min(this.canvas.width, Math.ceil(Math.max(x0, x1)));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1)));
    const maxY = Math.min(this.canvas.height, Math.ceil(Math.max(y0, y1)));
    let removed = 0;
    let removedText = 0;
    for (let py = minY; py < maxY; py++) {
      const row = py * this.canvas.width;
      for (let px = minX; px < maxX; px++) {
        const idx = row + px;
        if (this.ink[idx] === 1) {
          this.ink[idx] = 0;
          removed++;
        }
        if (this.textInk[idx] === 1) {
          this.textInk[idx] = 0;
          removedText++;
        }
      }
    }
    this.inkCount -= removed;
    this.textInkCount -= removedText;
    this.lastClearResidual = this.inkCount;
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.paintRect(x, y, w, h, false);
  }
  strokeRect(x: number, y: number, w: number, h: number): void {
    this.paintRect(x, y, w, h, false);
  }
  fillText(text: string, x: number, y: number): void {
    const m = this.measureText(text);
    this.paintRect(x, y - this.fontSize(), m.width, this.fontSize(), true);
  }
  strokeText(text: string, x: number, y: number): void {
    const m = this.measureText(text);
    this.paintRect(x, y - this.fontSize(), m.width, this.fontSize(), true);
  }
  measureText(text: string): { width: number } {
    return { width: Math.max(1, text.length * this.fontSize() * 0.55) };
  }
  beginPath(): void {}
  closePath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  arcTo(): void {}
  roundRect(): void {}
  arc(): void {}
  fill(): void {}
  stroke(): void {}
  createLinearGradient(): { addColorStop(): void } {
    return { addColorStop(): void {} };
  }
  /** drawImage：本门禁只关心「整图 1:1 拷贝到目标画布」的合成场景（compositeUi 用 5 参数 + identity）。
   * 在 identity transform 下把 source 所有 ink 像素搬到 dest 同坐标。 */
  drawImage(
    img: FakeCanvas,
    _sx?: number,
    _sy?: number,
    _sw?: number,
    _sh?: number,
    dx?: number,
    dy?: number,
    _dw?: number,
    _dh?: number,
  ): void {
    const src = img as FakeCanvas;
    if (!src || !(src instanceof FakeCanvas)) return;
    this.lastDrawImageScale = Math.max(Math.abs(this.a), Math.abs(this.d));
    this.lastDrawImageAlpha = this.globalAlpha;
    this.lastDrawImageComposite = this.globalCompositeOperation;
    const tdx = dx ?? 0;
    const tdy = dy ?? 0;
    const sctx = src.ctx;
    for (let py = 0; py < src.height; py++) {
      const srow = py * src.width;
      const dpy = Math.round(tdy + py);
      if (dpy < 0 || dpy >= this.canvas.height) continue;
      const drow = dpy * this.canvas.width;
      for (let px = 0; px < src.width; px++) {
        const sidx = srow + px;
        if (sctx.ink[sidx] === 0) continue;
        const dpx = Math.round(tdx + px);
        if (dpx < 0 || dpx >= this.canvas.width) continue;
        const didx = drow + dpx;
        if (this.ink[didx] === 0) {
          this.ink[didx] = 1;
          this.inkCount++;
        }
        if (sctx.textInk[sidx] === 1 && this.textInk[didx] === 0) {
          this.textInk[didx] = 1;
          this.textInkCount++;
        }
      }
    }
  }
}

export class FakeCanvas {
  width: number;
  height: number;
  logicalW: number;
  logicalH: number;
  readonly ctx: FakeCtx2D;
  constructor(opts: FakeCanvasOptions) {
    this.width = opts.width;
    this.height = opts.height;
    this.logicalW = opts.logicalW ?? opts.width;
    this.logicalH = opts.logicalH ?? opts.height;
    this.ctx = new FakeCtx2D(this);
  }
  getContext(): FakeCtx2D {
    return this.ctx;
  }
  /** 仅 FakeCtx2D 使用的便捷访问 */
  get inkSize(): number {
    return this.ctx.inkCount;
  }
  get textInkSize(): number {
    return this.ctx.textInkCount;
  }
}

/** 注入式 platform core（避免拉入 Web DOM / 微信运行时）。 */
export function makeFakePlatformCore(opts: {
  dpr: number;
  surfaceWidth: number;
  surfaceHeight: number;
}) {
  const surface: CanvasSurface = {
    width: opts.surfaceWidth,
    height: opts.surfaceHeight,
    devicePixelRatio: opts.dpr,
    now: () => 0,
  };
  const core = {
    storage: {
      getItem: (_k: string): string | null => null,
      setItem: (_k: string, _v: string): void => {},
    },
    /** MUST#7：捕获 bindPointer 注册的 tap handler，供测试模拟点击 */
    capturedPointerHandlers: [] as Array<(x: number, y: number) => void>,
    input: {
      bindPointer: (_target: EventTarget, handler: (x: number, y: number) => void): (() => void) => {
        core.capturedPointerHandlers.push(handler);
        return () => {};
      },
    },
    lifecycle: {
      requestAnimationFrame: (_cb: (t: number) => void): number => {
        // 测试不依赖真实 rAF；返回占位 handle
        return 1;
      },
      cancelAnimationFrame: (_h: number): void => {},
      now: (): number => 0,
      onVisibilityChange: (_fn: (hidden: boolean) => void): void => {},
      onHide: (_fn: () => void): void => {},
      onShow: (_fn: () => void): void => {},
    },
    createViewport: (_canvas: FakeCanvas) => ({
      surface: () => surface,
      safeInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
      applyTo: (_c: FakeCanvas) => {},
      clientToLogical: (
        cx: number,
        cy: number,
        _rect: { left: number; top: number; width: number; height: number },
      ) => ({ x: cx, y: cy }),
    }),
  };
  bindPlatformCore(core as unknown as Parameters<typeof bindPlatformCore>[0]);
  return core;
}
