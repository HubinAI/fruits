import type { ClientToLogical, PlatformInput, PointerGestureHandlers } from '../types';

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
  bindPointer(
    target: EventTarget,
    handler: (x: number, y: number) => void,
    toLogical?: ClientToLogical,
  ): void {
    if (target == null) return;
    const node = target as HTMLElement;
    // F-PLAYER-INPUT-SCALE-P0：client → 逻辑舞台坐标的【唯一】转换逻辑（单点）。
    // down/move/up/cancel 若被绑定一律走本函数，保证各指针事件类型坐标一致（Must#5）。
    // 提供 toLogical（PlayerViewportTransform.clientToLogical）时输出逻辑舞台坐标（844×390）；
    // 未提供时保持 F-UX-REVIEW-1 的 CSS 局部坐标归一化（DEV / 非玩家路径不回归）。
    const toPoint = (cx: number, cy: number, r: DOMRect): { x: number; y: number } => {
      if (toLogical) {
        return toLogical(cx, cy, { left: r.left, top: r.top, width: r.width, height: r.height });
      }
      // F-UX-REVIEW-1：容器可能被 CSS transform 放大（PC Mobile Review 2x 显示）——
      // getBoundingClientRect 返回视觉尺寸，必须归一化回元素 CSS 逻辑坐标：
      //   localX = (clientX - rect.left) × clientWidth / rect.width
      // 未缩放（rect.width === clientWidth）时该式恒等于 (clientX - rect.left)，保持原行为。
      // 守卫：rect 无 width/height（极简环境/测试桩）或 clientWidth 缺失时 scale=1（不产生 NaN）。
      const rw = r.width > 0 ? r.width : (node.clientWidth || 1);
      const rh = r.height > 0 ? r.height : (node.clientHeight || 1);
      const scaleX = node.clientWidth > 0 && rw > 0 ? node.clientWidth / rw : 1;
      const scaleY = node.clientHeight > 0 && rh > 0 ? node.clientHeight / rh : 1;
      return { x: (cx - r.left) * scaleX, y: (cy - r.top) * scaleY };
    };
    const onDown = (ev: Event): void => {
      const withTouches = ev as unknown as { touches?: ReadonlyArray<{ clientX: number; clientY: number }> };
      const withClient = ev as unknown as { clientX?: number; clientY?: number };
      let cx = withClient.clientX ?? 0;
      let cy = withClient.clientY ?? 0;
      if (withTouches.touches && withTouches.touches.length > 0) {
        cx = withTouches.touches[0].clientX;
        cy = withTouches.touches[0].clientY;
      }
      const r = node.getBoundingClientRect();
      const p = toPoint(cx, cy, r);
      handler(p.x, p.y);
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

  /** F-GARAGE-CENTER-STAGE-P0：手势生命周期（down/move/up + pointercancel）；
   *  坐标转换与 bindPointer 同一 toPoint 单点。 */
  bindGesture(
    target: EventTarget,
    handlers: PointerGestureHandlers,
    toLogical?: ClientToLogical,
  ): void {
    if (target == null) return;
    const node = target as HTMLElement;
    const toPoint = (cx: number, cy: number, r: DOMRect): { x: number; y: number } => {
      if (toLogical) return toLogical(cx, cy, { left: r.left, top: r.top, width: r.width, height: r.height });
      const rw = r.width > 0 ? r.width : (node.clientWidth || 1);
      const rh = r.height > 0 ? r.height : (node.clientHeight || 1);
      const scaleX = node.clientWidth > 0 && rw > 0 ? node.clientWidth / rw : 1;
      const scaleY = node.clientHeight > 0 && rh > 0 ? node.clientHeight / rh : 1;
      return { x: (cx - r.left) * scaleX, y: (cy - r.top) * scaleY };
    };
    const pointOf = (ev: Event): { x: number; y: number } => {
      const withTouches = ev as unknown as { touches?: ReadonlyArray<{ clientX: number; clientY: number }> };
      const withClient = ev as unknown as { clientX?: number; clientY?: number };
      let cx = withClient.clientX ?? 0;
      let cy = withClient.clientY ?? 0;
      if (withTouches.touches && withTouches.touches.length > 0) {
        cx = withTouches.touches[0].clientX;
        cy = withTouches.touches[0].clientY;
      }
      return toPoint(cx, cy, node.getBoundingClientRect());
    };
    const supportsPointer =
      typeof window !== 'undefined' && typeof window.PointerEvent === 'function';
    if (supportsPointer) {
      // F-GARAGE-DRAG-CONTINUITY-R1（Must#1/7/11）：pointer capture 生命周期。
      // 捕获期间 move/up 即使发生在元素外部也派发到本元素 → 拖动离开装配带/卡片不断流；
      // up/cancel/lostpointercapture 一律释放并归零，不残留到下一次手势。
      let capturedId: number | null = null;
      const release = (): void => {
        if (capturedId === null) return;
        try {
          if (typeof node.releasePointerCapture === 'function' && node.hasPointerCapture?.(capturedId)) {
            node.releasePointerCapture(capturedId);
          }
        } catch {
          /* 指针已消失/未捕获：忽略，仅归零记账 */
        }
        capturedId = null;
      };
      node.addEventListener('pointerdown', (ev) => {
        const p = pointOf(ev);
        const id = (ev as PointerEvent).pointerId;
        if (handlers.captureOnDown && handlers.captureOnDown(p.x, p.y) && id !== undefined && id !== null) {
          try {
            if (typeof node.setPointerCapture === 'function') {
              node.setPointerCapture(id);
              capturedId = id;
            }
          } catch {
            capturedId = null; // 捕获失败 → 退回既有行为（不捕获），不影响功能
          }
        }
        handlers.onDown(p.x, p.y, {
          pointerId: typeof id === 'number' ? id : null,
          pointerType: (ev as PointerEvent).pointerType ?? null,
        });
      });
      const onMove = (ev: Event): void => {
        const p = pointOf(ev);
        handlers.onMove(p.x, p.y);
      };
      const onUp = (ev: Event, cancelled: boolean): void => {
        const p = pointOf(ev);
        // 先释放 capture（保证 lostpointercapture 不二次触发 onUp），再派发业务 up
        release();
        handlers.onUp(p.x, p.y, cancelled);
      };
      node.addEventListener('pointermove', onMove);
      node.addEventListener('pointerup', (ev) => onUp(ev, false));
      node.addEventListener('pointercancel', (ev) => onUp(ev, true));
      // 兜底：capture 被系统剥夺（如元素移除/指针设备丢失）→ 记账归零，避免状态残留
      node.addEventListener('lostpointercapture', () => {
        capturedId = null;
      });
    } else {
      node.addEventListener('touchstart', (ev) => {
        const p = pointOf(ev);
        handlers.onDown(p.x, p.y);
      }, { passive: true });
      node.addEventListener('touchmove', (ev) => {
        const p = pointOf(ev);
        handlers.onMove(p.x, p.y);
      }, { passive: true });
      node.addEventListener('touchend', (ev) => {
        const p = pointOf(ev);
        handlers.onUp(p.x, p.y, false);
      });
      node.addEventListener('touchcancel', (ev) => {
        const p = pointOf(ev);
        handlers.onUp(p.x, p.y, true);
      });
    }
  }
}
