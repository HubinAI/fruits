/**
 * F-PLAYER-CANVAS-COMPOSE-P0｜单一 PlayerViewportTransform
 *
 * 玩家模式（Pages 预览 / ?player=1 / __PLAYER_MODE__）下，Renderer Canvas 与玩家 UI Canvas
 * 共享同一个视口变换，最终合成画面只有一套逻辑坐标（手机横屏 844×390）：
 *
 * - logical 尺寸：844×390（逻辑 px，所有布局/相机/跨层矩形都在这套坐标）；
 * - CSS contain rect：相对容器等比 contain 缩放居中（两个画布共用 → 最终屏幕矩形完全重合）；
 * - scale/offset：contain 缩放与居中偏移（视觉放大唯一来源）；
 * - DPR：backing store = logical × DPR（两画布同一规则）；
 * - logical ↔ surface 转换：唯一转换点（×DPR / ÷DPR）。
 *
 * 禁止再出现「UI Canvas 单独 applyPhoneScale、Renderer 用另一套实际页面尺寸」的双轨坐标。
 */
export const PLAYER_LOGICAL_W = 844;
export const PLAYER_LOGICAL_H = 390;

export class PlayerViewportTransform {
  readonly logicalW: number;
  readonly logicalH: number;
  private containerW = 0;
  private containerH = 0;
  private _dpr = 1;
  private s = 1; // contain scale
  private ox = 0; // 居中偏移（相对容器 CSS px）
  private oy = 0;

  constructor(logicalW: number = PLAYER_LOGICAL_W, logicalH: number = PLAYER_LOGICAL_H) {
    this.logicalW = logicalW;
    this.logicalH = logicalH;
  }

  /** 容器 / DPR 变化时重算 contain 布局；重算后必须重新 applyTo 各 canvas。 */
  update(containerW: number, containerH: number, dpr: number): void {
    this.containerW = Math.max(1, containerW || 1);
    this.containerH = Math.max(1, containerH || 1);
    this._dpr = Math.max(1, dpr || 1);
    this.s = Math.min(this.containerW / this.logicalW, this.containerH / this.logicalH);
    this.ox = (this.containerW - this.logicalW * this.s) / 2;
    this.oy = (this.containerH - this.logicalH * this.s) / 2;
  }

  get scale(): number {
    return this.s;
  }
  get offsetX(): number {
    return this.ox;
  }
  get offsetY(): number {
    return this.oy;
  }
  get dpr(): number {
    return this._dpr;
  }
  get containerWidth(): number {
    return this.containerW;
  }
  get containerHeight(): number {
    return this.containerH;
  }

  /** CSS contain rect（相对容器；两个画布共用同一结果 → 最终屏幕矩形完全重合） */
  cssRect(): { x: number; y: number; w: number; h: number } {
    return { x: this.ox, y: this.oy, w: this.logicalW * this.s, h: this.logicalH * this.s };
  }

  /** 逻辑坐标 → backing store 像素（唯一转换点：×DPR） */
  logicalToSurface(lx: number, ly: number): { x: number; y: number } {
    return { x: lx * this.dpr, y: ly * this.dpr };
  }

  /** backing store 像素 → 逻辑坐标（唯一转换点：÷DPR） */
  surfaceToLogical(px: number, py: number): { x: number; y: number } {
    return { x: px / this.dpr, y: py / this.dpr };
  }

  /**
   * F-PLAYER-INPUT-SCALE-P0｜client 坐标（viewport CSS px）→ 逻辑舞台坐标（844×390）唯一转换点。
   *
   * 输入只绑定唯一可见 Canvas；canvas 被 CSS contain 缩放（transform: scale(s)）时，
   * getBoundingClientRect() 返回的是【视觉矩形】而非逻辑尺寸。此处用该视觉矩形一步完成：
   *
   *   logicalX = (clientX - rect.left) × logicalW / rect.width
   *   logicalY = (clientY - rect.top)  × logicalH / rect.height
   *
   * 注意 logicalW/H 必须是逻辑舞台（844×390），【不得】使用含 DPR 的 backing 尺寸——
   * backing = logical × DPR，二者只在 DPR=1 时数值相等，DPR>1 时用 backing 会把命中点缩到
   * 舞台左上 1/DPR 区域（正是旧实现整类坐标错位的根源）。
   */
  clientToLogical(
    clientX: number,
    clientY: number,
    rect: { left: number; top: number; width: number; height: number },
  ): { x: number; y: number } {
    const rw = rect && rect.width > 0 ? rect.width : this.logicalW;
    const rh = rect && rect.height > 0 ? rect.height : this.logicalH;
    return {
      x: ((clientX - (rect ? rect.left : 0)) * this.logicalW) / rw,
      y: ((clientY - (rect ? rect.top : 0)) * this.logicalH) / rh,
    };
  }

  /** 逻辑坐标 → 容器 CSS px（含 contain 缩放与居中） */
  logicalToCss(lx: number, ly: number): { x: number; y: number } {
    return { x: this.ox + lx * this.s, y: this.oy + ly * this.s };
  }

  /**
   * 对单个 canvas 应用统一视口规则（Renderer canvas 与 UI canvas 共用 → 完全一致）：
   * - backing store = logical × DPR；
   * - CSS = logical px + contain transform 缩放居中。
   */
  applyTo(canvas: HTMLCanvasElement): void {
    canvas.width = Math.round(this.logicalW * this.dpr);
    canvas.height = Math.round(this.logicalH * this.dpr);
    const st = canvas.style;
    st.position = 'absolute';
    st.width = `${this.logicalW}px`;
    st.height = `${this.logicalH}px`;
    st.left = `${Math.round(this.ox)}px`;
    st.top = `${Math.round(this.oy)}px`;
    st.right = 'auto';
    st.bottom = 'auto';
    st.transformOrigin = 'top left';
    st.transform = `scale(${this.s})`;
  }
}
