import type { PlatformViewport, CanvasLike } from '../types';
import type { CanvasSurface } from '../../render/canvasSurface';

/**
 * 微信视口后端：从 wx canvas + systemInfo 取尺寸/DPR（固定方向，无运行时 resize）。
 */
export class WechatViewport implements PlatformViewport {
  private readonly surfaceValue: CanvasSurface;
  constructor(canvas: CanvasLike, pixelRatio: number) {
    this.surfaceValue = {
      width: canvas.width,
      height: canvas.height,
      devicePixelRatio: pixelRatio || 1,
      now: () => Date.now(),
    };
  }
  surface(): CanvasSurface {
    return this.surfaceValue;
  }
  onResize(_cb: () => void): void {
    // 微信小游戏固定方向（landscape），无运行时 resize
  }
}
