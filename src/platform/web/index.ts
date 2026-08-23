import { WebStorage } from './storage';
import { WebLifecycle } from './lifecycle';
import { WebViewport } from './viewport';
import { WebInput } from './input';
import type { PlatformCore, CanvasLike } from '../types';

export function createWebCore(): PlatformCore {
  return {
    storage: new WebStorage(),
    lifecycle: new WebLifecycle(),
    input: new WebInput(),
    createViewport(canvas: CanvasLike) {
      return new WebViewport(canvas);
    },
  };
}
