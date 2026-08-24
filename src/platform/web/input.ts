import type { PlatformInput } from '../types';

/** Web 输入后端：直接包装 DOM 事件绑定 */
export class WebInput implements PlatformInput {
  bindClick(el: EventTarget, handler: () => void): void {
    if (el == null) return;
    const node = el as HTMLElement;
    if (typeof node.addEventListener === 'function') {
      node.addEventListener('click', handler);
    } else {
      node.onclick = handler;
    }
  }

  /** Canvas 命中输入：pointerdown/mousedown/touchstart → 元素本地坐标（CSS px） */
  bindPointer(target: EventTarget, handler: (x: number, y: number) => void): void {
    if (target == null) return;
    const node = target as HTMLElement;
    const onDown = (ev: Event): void => {
      const withTouches = ev as unknown as { touches?: ReadonlyArray<{ clientX: number; clientY: number }> };
      const withClient = ev as unknown as { clientX?: number; clientY?: number };
      let cx = withClient.clientX ?? 0;
      let cy = withClient.clientY ?? 0;
      if (withTouches.touches && withTouches.touches.length > 0) {
        cx = withTouches.touches[0].clientX;
        cy = withTouches.touches[0].clientY;
      }
      // F-UX-REVIEW-1：容器可能被 CSS transform 放大（PC Mobile Review 2x 显示）——
      // getBoundingClientRect 返回视觉尺寸，必须归一化回元素 CSS 逻辑坐标：
      //   localX = (clientX - rect.left) × clientWidth / rect.width
      // 未缩放（rect.width === clientWidth）时该式恒等于 (clientX - rect.left)，保持原行为。
      const r = node.getBoundingClientRect();
      const cw = node.clientWidth || r.width;
      const ch = node.clientHeight || r.height;
      handler(((cx - r.left) * cw) / r.width, ((cy - r.top) * ch) / r.height);
    };
    node.addEventListener('pointerdown', onDown);
    node.addEventListener('mousedown', onDown);
    node.addEventListener('touchstart', onDown, { passive: true });
  }
}
