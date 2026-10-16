/**
 * GARAGE-V2-INVENTORY-LAYOUT-LAB-R1｜Garage 2.0 布局验证 Lab 入口壳。
 *
 * ⚠️ 隔离铁律（本 Queue 必改 2 / 验收 B「Lab 隔离」）：
 *   本文件必须在 **import 任何业务模块之前** bindPlatformCore(<内存 Map 后端>)。
 *   ESM 按 import 顺序求值 ⇒ 把 bind 放在最顶部、业务 import 放其后，
 *   garageV2Quality / playerLoadout / bodyOwnership 等一切 storage 读写
 *   全部落在本文件的内存 Map 里 —— 真实 localStorage **一个字节不碰**。
 *
 * 删除本文件 + garage-v2-lab.html + garageV2Lab.ts 即整块移除。
 */
import type { PlatformCore } from '../platform/types';
import { bindPlatformCore } from '../platform/context';

/* ── ① 先建隔离存储并绑定（必须先于一切业务模块求值） ── */
const isolatedMap = new Map<string, string>();
const isolatedCore: PlatformCore = {
  storage: {
    getItem: (k: string) => isolatedMap.get(k) ?? null,
    setItem: (k: string, v: string) => void isolatedMap.set(k, String(v)),
    removeItem: (k: string) => void isolatedMap.delete(k),
  },
  lifecycle: {
    now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
    requestAnimationFrame: (cb: (t: number) => void) => requestAnimationFrame(cb),
    cancelAnimationFrame: (h: number) => cancelAnimationFrame(h),
    onVisibilityChange: () => undefined, // 本页不接前后台语义
  },
  input: {
    bindClick: (el: EventTarget, handler: () => void) => {
      (el as HTMLElement).addEventListener('click', handler);
    },
    bindPointer: () => undefined, // 本页无 canvas 命中
  } as PlatformCore['input'],
  createViewport: () => {
    throw new Error('[garage-v2-lab] 本页不接 canvas viewport（纯 DOM 预览）');
  },
};
bindPlatformCore(isolatedCore);

/* ── ② 业务模块（此刻才安全） ── */
import { bindLabIsolatedStorage, mountGarageV2Lab } from './garageV2Lab';

function boot(): void {
  // 把隔离 Map 的写通道交给页面模块（账本 fixture 预置用；仍是纯内存）
  bindLabIsolatedStorage((k, v) => isolatedMap.set(k, v));
  const root = document.getElementById('g2-root');
  if (!root) throw new Error('[garage-v2-lab] 未找到 #g2-root 容器');
  mountGarageV2Lab(root);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
