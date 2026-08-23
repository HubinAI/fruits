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
}
