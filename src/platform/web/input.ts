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

  /** Canvas 命中输入：pointerdown（支持 Pointer Event 时唯一绑定）/ 回退 mousedown+touchstart
   *  （F-PLAYER-FLOW-ATOMIC-P0：旧实现三者全绑 → 一次物理点击重复派发多次 action） */
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
      // 守卫：rect 无 width/height（极简环境/测试桩）或 clientWidth 缺失时 scale=1（不产生 NaN）。
      const r = node.getBoundingClientRect();
      const rw = r.width > 0 ? r.width : (node.clientWidth || 1);
      const rh = r.height > 0 ? r.height : (node.clientHeight || 1);
      const scaleX = node.clientWidth > 0 && rw > 0 ? node.clientWidth / rw : 1;
      const scaleY = node.clientHeight > 0 && rh > 0 ? node.clientHeight / rh : 1;
      handler((cx - r.left) * scaleX, (cy - r.top) * scaleY);
    };
    // F-PLAYER-FLOW-ATOMIC-P0：支持 Pointer Event → 只绑 pointerdown（一次物理点击 = 一次
    // 派发）；仅在不支持 Pointer Event 的环境回退 mouse/touch（二者互斥，不叠加）。
    const supportsPointer =
      typeof window !== 'undefined' && typeof window.PointerEvent === 'function';
    if (supportsPointer) {
      node.addEventListener('pointerdown', onDown);
    } else {
      node.addEventListener('mousedown', onDown);
      node.addEventListener('touchstart', onDown, { passive: true });
    }
  }
}
