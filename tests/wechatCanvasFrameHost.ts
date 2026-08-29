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

/** F-WX-VIEWPORT-SURFACE-P0：一次绘制操作的 device 空间记录（几何验收最小单位）。 */
export interface DrawOp {
  type: 'rect' | 'text' | 'path' | 'image' | 'clear';
  /** clamp 后的 device bbox */
  devX: number;
  devY: number;
  devW: number;
  devH: number;
  /** text 操作：文本内容（SHA 水印识别） */
  text?: string;
  /** rect/text/path 操作：当时 fillStyle/strokeStyle */
  fillStyle?: string;
  /** text 操作：当时字号（logical px，未乘 dpr） */
  fontSize?: number;
  /** image 操作：源画布 */
  srcCanvas?: FakeCanvas;
}
export class FakeCtx2D {
  readonly canvas: FakeCanvas;
  /** 被绘制的 device 像素（1 = 已绘制），长度 = width*height */
  ink: Uint8Array;
  /** 仅由 fillText / strokeText 贡献的「文字像素」 */
  textInk: Uint8Array;
  /** 当前 ink 计数（增量维护，避免每帧全量统计） */
  inkCount = 0;
  textInkCount = 0;

  // ---- F-WX-VIEWPORT-SURFACE-P0｜Must#4：device 空间绘制操作记录（几何验收） ----
  // 每帧由测试在驱动前 clearDrawOps()；op 的 devX/devY/devW/devH 为 clamp 后的 device bbox。
  drawOps: DrawOp[] = [];

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
  textAlign: string = 'left';
  textBaseline: string = 'alphabetic';

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

  /** F-WX-VIEWPORT-SURFACE-P0：canvas backing 变化（微信入口定版 / onWindowResize）时
   *  重分配 ink 缓冲——必须与 canvas.width/height 同步，否则绘制越界/残留。 */
  onCanvasResize(): void {
    const n = this.canvas.width * this.canvas.height;
    if (this.ink.length === n) return;
    this.ink = new Uint8Array(n);
    this.textInk = new Uint8Array(n);
    this.inkCount = 0;
    this.textInkCount = 0;
    this.drawOps = [];
  }

  /** 清空 ink 缓冲与计数（fast→slow 切换采样前调用，避免面积值残留污染唯一像素统计）。 */
  resetInk(): void {
    this.ink.fill(0);
    this.textInk.fill(0);
    this.inkCount = 0;
    this.textInkCount = 0;
  }

  /** 清空 draw-op 记录（每帧驱动前调用）。 */
  clearDrawOps(): void {
    this.drawOps = [];
  }

  /** 查询某 device 像素是否被绘制（几何验收：可见控件处应有 ink）。 */
  inkAt(px: number, py: number): boolean {
    const x = Math.floor(px);
    const y = Math.floor(py);
    if (x < 0 || y < 0 || x >= this.canvas.width || y >= this.canvas.height) return false;
    return this.ink[y * this.canvas.width + x] === 1;
  }

  /** 全部 ink 的 device 空间 union bbox（null = 无 ink）。 */
  inkBBox(): { x: number; y: number; w: number; h: number } | null {
    let minX = this.canvas.width;
    let minY = this.canvas.height;
    let maxX = -1;
    let maxY = -1;
    const w = this.canvas.width;
    for (let py = 0; py < this.canvas.height; py++) {
      const row = py * w;
      for (let px = 0; px < w; px++) {
        if (this.ink[row + px] === 1) {
          if (px < minX) minX = px;
          if (px > maxX) maxX = px;
          if (py < minY) minY = py;
          if (py > maxY) maxY = py;
        }
      }
    }
    if (maxX < 0) return null;
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }

  /** 是否存在（非 clear/image 的）绘制 op 覆盖某 device 点（几何验收：可见控件处应有绘制）。 */
  opCovers(px: number, py: number, filter?: (op: DrawOp) => boolean): boolean {
    return this.drawOps.some(
      (op) =>
        op.type !== 'clear' &&
        op.type !== 'image' &&
        (!filter || filter(op)) &&
        px >= op.devX &&
        px < op.devX + op.devW &&
        py >= op.devY &&
        py < op.devY + op.devH,
    );
  }

  /** 非 clear/image 绘制 op 的 device union bbox（null = 无）。 */
  opsUnionBBox(filter?: (op: DrawOp) => boolean): { x: number; y: number; w: number; h: number } | null {
    let minX = this.canvas.width;
    let minY = this.canvas.height;
    let maxX = -1;
    let maxY = -1;
    for (const op of this.drawOps) {
      if (op.type === 'clear' || op.type === 'image') continue;
      if (filter && !filter(op)) continue;
      if (op.devW <= 0 || op.devH <= 0) continue;
      if (op.devX < minX) minX = op.devX;
      if (op.devY < minY) minY = op.devY;
      if (op.devX + op.devW > maxX) maxX = op.devX + op.devW;
      if (op.devY + op.devH > maxY) maxY = op.devY + op.devH;
    }
    if (maxX < 0) return null;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  private tp(x: number, y: number): [number, number] {
    return [this.a * x + this.c * y + this.e, this.b * x + this.d * y + this.f];
  }

  private fontSize(): number {
    // ctx.font 形如 "700 25px sans-serif" / "bold 12px ..."——必须取 px 后缀的数字，
    // 否则会误抓字重（700）导致 measureText 宽 / text bbox 虚大数倍
    const m = /(\d+(?:\.\d+)?)px/.exec(this.font);
    return m ? parseFloat(m[1]) : 10;
  }

  // ---- F-WX-VIEWPORT-SURFACE-P0：几何验收（fast）模式 ----
  // true 时 paintRectDevice/clearRect/drawImage 只做面积记账（不逐像素写 ink）——
  // 120 帧 × 全 backing（最高 2796×1290）慢速光栅化会让门禁耗时不可接受；
  // 几何验收全部基于 drawOps 的 device bbox（每 op 即其最终像素位置）。默认 false。
  fastRaster = false;

  private paintRectDevice(x0: number, y0: number, x1: number, y1: number, isText: boolean): void {
    const minX = Math.max(0, Math.floor(Math.min(x0, x1)));
    const maxX = Math.min(this.canvas.width, Math.ceil(Math.max(x0, x1)));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1)));
    const maxY = Math.min(this.canvas.height, Math.ceil(Math.max(y0, y1)));
    if (this.fastRaster) {
      const w = Math.max(0, maxX - minX);
      const h = Math.max(0, maxY - minY);
      this.inkCount += w * h;
      if (isText) this.textInkCount += w * h;
    } else {
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
    }
    const s = Math.max(Math.abs(this.a), Math.abs(this.d));
    if (s > this.maxDrawScale) this.maxDrawScale = s;
  }

  private paintRect(x: number, y: number, w: number, h: number, isText: boolean): void {
    const [x0, y0] = this.tp(x, y);
    const [x1, y1] = this.tp(x + w, y + h);
    this.paintRectDevice(x0, y0, x1, y1, isText);
  }

  /** 记录一次绘制 op（device 空间，原始未 clamp bbox——裁切检测依赖越界原始值）。 */
  private recordOp(op: DrawOp): void {
    this.drawOps.push(op);
  }

  /** op 记录：逻辑坐标 → device bbox（含 transform）。 */
  private recordRect(type: 'rect' | 'text', x: number, y: number, w: number, h: number, extra: Omit<DrawOp, 'type' | 'devX' | 'devY' | 'devW' | 'devH'>): void {
    const [x0, y0] = this.tp(x, y);
    const [x1, y1] = this.tp(x + w, y + h);
    this.recordOp({ type, devX: x0, devY: y0, devW: x1 - x0, devH: y1 - y0, ...extra });
  }

  // ---- 路径跟踪（几何验收：renderer 车辆形状用 arc/path+fill，需 device bbox 记录） ----
  private pMinX = Infinity;
  private pMinY = Infinity;
  private pMaxX = -Infinity;
  private pMaxY = -Infinity;

  private trackPath(x: number, y: number): void {
    const [dx, dy] = this.tp(x, y);
    if (dx < this.pMinX) this.pMinX = dx;
    if (dy < this.pMinY) this.pMinY = dy;
    if (dx > this.pMaxX) this.pMaxX = dx;
    if (dy > this.pMaxY) this.pMaxY = dy;
  }

  private flushPath(color: string): void {
    if (!Number.isFinite(this.pMinX)) return;
    this.recordOp({
      type: 'path',
      devX: this.pMinX,
      devY: this.pMinY,
      devW: this.pMaxX - this.pMinX,
      devH: this.pMaxY - this.pMinY,
      fillStyle: color,
    });
    this.pMinX = Infinity;
    this.pMinY = Infinity;
    this.pMaxX = -Infinity;
    this.pMaxY = -Infinity;
  }

  private trackArc(cx: number, cy: number, r: number): void {
    // 4 轴向点：对角两点在 ±45° 旋转下退化（y 重合 → devH=0），轴向点在任意旋转下保真
    this.trackPath(cx - r, cy);
    this.trackPath(cx + r, cy);
    this.trackPath(cx, cy - r);
    this.trackPath(cx, cy + r);
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
  // ---- affine（renderer 车辆绘制用；几何保真） ----
  translate(tx: number, ty: number): void {
    this.e += tx * this.a + ty * this.c;
    this.f += tx * this.b + ty * this.d;
  }
  scale(sx: number, sy: number): void {
    this.a *= sx; this.b *= sx; this.c *= sy; this.d *= sy;
  }
  rotate(angle: number): void {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const a = this.a; const c = this.c; const b = this.b; const d = this.d;
    this.a = a * cos + c * sin;
    this.c = -a * sin + c * cos;
    this.b = b * cos + d * sin;
    this.d = -b * sin + d * cos;
  }
  transform(a2: number, b2: number, c2: number, d2: number, e2: number, f2: number): void {
    const a = this.a; const c = this.c; const e = this.e;
    const b = this.b; const d = this.d; const f = this.f;
    this.a = a * a2 + c * b2;
    this.b = b * a2 + d * b2;
    this.c = a * c2 + c * d2;
    this.d = b * c2 + d * d2;
    this.e = a * e2 + c * f2 + e;
    this.f = b * e2 + d * f2 + f;
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
    if (this.fastRaster) {
      const w = Math.max(0, maxX - minX);
      const h = Math.max(0, maxY - minY);
      removed = w * h;
      removedText = w * h;
      this.inkCount = Math.max(0, this.inkCount - removed);
      this.textInkCount = Math.max(0, this.textInkCount - removedText);
    } else {
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
    }
    this.lastClearResidual = this.inkCount;
    this.recordOp({ type: 'clear', devX: minX, devY: minY, devW: maxX - minX, devH: maxY - minY });
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.recordRect('rect', x, y, w, h, { fillStyle: this.fillStyle });
    this.paintRect(x, y, w, h, false);
  }
  strokeRect(x: number, y: number, w: number, h: number): void {
    this.recordRect('rect', x, y, w, h, { fillStyle: this.strokeStyle });
    this.paintRect(x, y, w, h, false);
  }
  /** 按当前 textAlign/textBaseline 计算文本 bbox 左上角（逻辑，未含 dpr）。 */
  private textOrigin(x: number, y: number, w: number, fs: number): { lx: number; ly: number } {
    let lx = x;
    if (this.textAlign === 'right') lx = x - w;
    else if (this.textAlign === 'center') lx = x - w / 2;
    let ly = y - fs;
    if (this.textBaseline === 'middle') ly = y - fs / 2;
    else if (this.textBaseline === 'bottom') ly = y - fs;
    return { lx, ly };
  }

  fillText(text: string, x: number, y: number): void {
    const fs = this.fontSize();
    const m = this.measureText(text);
    const { lx, ly } = this.textOrigin(x, y, m.width, fs);
    this.recordRect('text', lx, ly, m.width, fs, {
      text,
      fillStyle: this.fillStyle,
      fontSize: fs,
    });
    this.paintRect(lx, ly, m.width, fs, true);
  }
  strokeText(text: string, x: number, y: number): void {
    const fs = this.fontSize();
    const m = this.measureText(text);
    const { lx, ly } = this.textOrigin(x, y, m.width, fs);
    this.recordRect('text', lx, ly, m.width, fs, {
      text,
      fillStyle: this.strokeStyle,
      fontSize: fs,
    });
    this.paintRect(lx, ly, m.width, fs, true);
  }
  measureText(text: string): { width: number } {
    return { width: Math.max(1, text.length * this.fontSize() * 0.55) };
  }
  beginPath(): void {
    this.pMinX = Infinity;
    this.pMinY = Infinity;
    this.pMaxX = -Infinity;
    this.pMaxY = -Infinity;
  }
  closePath(): void {}
  moveTo(x: number, y: number): void {
    this.trackPath(x, y);
  }
  lineTo(x: number, y: number): void {
    this.trackPath(x, y);
  }
  arcTo(x1: number, y1: number, x2: number, y2: number): void {
    this.trackPath(x1, y1);
    this.trackPath(x2, y2);
  }
  arc(x: number, y: number, r: number, _sa: number, _ea: number): void {
    this.trackArc(x, y, r);
  }
  ellipse(x: number, y: number, rx: number, ry: number): void {
    this.trackArc(x, y, Math.max(rx, ry));
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.trackPath(x, y);
    this.trackPath(x + w, y + h);
  }
  quadraticCurveTo(x1: number, y1: number, x2: number, y2: number): void {
    this.trackPath(x1, y1);
    this.trackPath(x2, y2);
  }
  bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): void {
    this.trackPath(x1, y1);
    this.trackPath(x2, y2);
    this.trackPath(x3, y3);
  }
  fill(): void {
    this.flushPath(this.fillStyle);
  }
  stroke(): void {
    this.flushPath(this.strokeStyle);
  }
  createLinearGradient(): { addColorStop(): void } {
    return { addColorStop(): void {} };
  }
  createRadialGradient(): { addColorStop(): void } {
    return { addColorStop(): void {} };
  }
  createPattern(): { setTransform(): void } {
    return { setTransform(): void {} };
  }
  // ---- 样式/裁剪 noop（路径光栅化非必需；bbox 记录已由 trackPath/flushPath 覆盖） ----
  setLineDash(): void {}
  getLineDash(): number[] {
    return [];
  }
  clip(): void {}
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
    // F-WX-VIEWPORT-SURFACE-P0：记录合成 op（destination device bbox；identity 1:1 合成）。
    this.recordOp({
      type: 'image',
      devX: tdx,
      devY: tdy,
      devW: src.width,
      devH: src.height,
      srcCanvas: src,
    });
    if (this.fastRaster) {
      // 面积记账：只计入源画布【已绘制】面积（慢速模式=仅 ink 像素拷贝的等价语义）
      this.inkCount += src.ctx.inkCount;
      this.textInkCount += src.ctx.textInkCount;
      return;
    }
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
  private _width: number;
  private _height: number;
  private _ctx: FakeCtx2D;
  logicalW: number;
  logicalH: number;
  constructor(opts: FakeCanvasOptions) {
    this._width = opts.width;
    this._height = opts.height;
    this.logicalW = opts.logicalW ?? opts.width;
    this.logicalH = opts.logicalH ?? opts.height;
    this._ctx = new FakeCtx2D(this);
  }
  /** F-WX-VIEWPORT-SURFACE-P0：backing 可运行时变更（微信入口定版 / onWindowResize）；
   *  变更时同步重分配 ctx ink 缓冲。 */
  get width(): number {
    return this._width;
  }
  set width(v: number) {
    if (v === this._width) return;
    this._width = v;
    if (this._ctx) this._ctx.onCanvasResize();
  }
  get height(): number {
    return this._height;
  }
  set height(v: number) {
    if (v === this._height) return;
    this._height = v;
    if (this._ctx) this._ctx.onCanvasResize();
  }
  get ctx(): FakeCtx2D {
    return this._ctx;
  }
  getContext(): FakeCtx2D {
    return this._ctx;
  }
  /** 仅 FakeCtx2D 使用的便捷访问 */
  get inkSize(): number {
    return this._ctx.inkCount;
  }
  get textInkSize(): number {
    return this._ctx.textInkCount;
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
