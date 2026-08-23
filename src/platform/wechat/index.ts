import { WechatStorage } from './storage';
import { WechatLifecycle } from './lifecycle';
import { WechatViewport } from './viewport';
import { WechatInput } from './input';
import type { PlatformCore, CanvasLike } from '../types';

export function createWechatCore(pixelRatio = 1): PlatformCore {
  return {
    storage: new WechatStorage(),
    lifecycle: new WechatLifecycle(),
    input: new WechatInput(),
    createViewport(canvas: CanvasLike) {
      return new WechatViewport(canvas, pixelRatio);
    },
  };
}
