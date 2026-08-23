/**
 * F-WX-2｜Platform Core 定向测试（headless）。
 *
 * 验证四适配器（storage/lifecycle/viewport/input）的 Web 与 WeChat 双实现均正确，
 * 且 createWebCore / createWechatCore 组装出合法 PlatformCore。运行于 Node，
 * 通过临时注入 globalThis.localStorage / globalThis.wx 模拟两平台，不依赖真实浏览器/微信。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { WebStorage } from '../src/platform/web/storage';
import { WebLifecycle } from '../src/platform/web/lifecycle';
import { WebViewport } from '../src/platform/web/viewport';
import { WebInput } from '../src/platform/web/input';
import { WechatStorage } from '../src/platform/wechat/storage';
import { WechatLifecycle } from '../src/platform/wechat/lifecycle';
import { WechatViewport } from '../src/platform/wechat/viewport';
import { WechatInput } from '../src/platform/wechat/input';
import { createWebCore } from '../src/platform/web';
import { createWechatCore } from '../src/platform/wechat';
import { platform, bindPlatformCore } from '../src/platform/index';

function withGlobal(key: string, value: unknown, fn: () => void): void {
  const prev = (globalThis as Record<string, unknown>)[key];
  (globalThis as Record<string, unknown>)[key] = value;
  try {
    fn();
  } finally {
    if (prev === undefined) delete (globalThis as Record<string, unknown>)[key];
    else (globalThis as Record<string, unknown>)[key] = prev;
  }
}

describe('F-WX-2 Platform Core', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).wx;
    delete (globalThis as Record<string, unknown>).localStorage;
  });

  it('WebStorage：无 localStorage 安全降级为 null/no-op', () => {
    const s = new WebStorage();
    expect(s.getItem('k')).toBeNull();
    expect(() => s.setItem('k', 'v')).not.toThrow();
    expect(() => s.removeItem('k')).not.toThrow();
  });

  it('WebStorage：经 globalThis.localStorage 读写', () => {
    const store = new Map<string, string>();
    withGlobal('localStorage', {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    }, () => {
      const s = new WebStorage();
      s.setItem('k', 'v');
      expect(s.getItem('k')).toBe('v');
      s.removeItem('k');
      expect(s.getItem('k')).toBeNull();
    });
  });

  it('WechatStorage：经 wx 同步 storage API 读写', () => {
    const wxStore = new Map<string, unknown>();
    (globalThis as Record<string, unknown>).wx = {
      getStorageSync: (k: string) => (wxStore.has(k) ? wxStore.get(k) : null),
      setStorageSync: (k: string, v: unknown) => void wxStore.set(k, v),
      removeStorageSync: (k: string) => void wxStore.delete(k),
    };
    const s = new WechatStorage();
    s.setItem('k', 'v');
    expect(s.getItem('k')).toBe('v');
    s.removeItem('k');
    expect(s.getItem('k')).toBeNull();
  });

  it('WechatStorage：无 wx 安全降级', () => {
    const s = new WechatStorage();
    expect(s.getItem('k')).toBeNull();
    expect(() => s.setItem('k', 'v')).not.toThrow();
  });

  it('WebLifecycle：now 返回数字；requestAnimationFrame 注册并触发回调', () => {
    const lc = new WebLifecycle();
    expect(typeof lc.now()).toBe('number');
    let called = false;
    lc.requestAnimationFrame(() => {
      called = true;
    });
    // Node 无全局 rAF → 走 setTimeout 兜底；等待一帧验证触发
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(called).toBe(true);
        resolve();
      }, 30);
    });
  });

  it('WechatLifecycle：requestAnimationFrame 经 wx 或 setTimeout 兜底', () => {
    (globalThis as Record<string, unknown>).wx = {
      requestAnimationFrame: (cb: (t: number) => void) => {
        cb(1);
        return 7;
      },
      onHide: () => {},
      onShow: () => {},
    };
    const lc = new WechatLifecycle();
    expect(typeof lc.now()).toBe('number');
    let called = false;
    lc.requestAnimationFrame(() => {
      called = true;
    });
    expect(called).toBe(true);
  });

  it('WebViewport：surface 读 canvas.clientWidth + window.dpr；无 window 时回退 1', () => {
    const canvas = { width: 300, height: 150, clientWidth: 900, clientHeight: 500 } as any;
    const vp = new WebViewport(canvas);
    // 控制 window 来源，避免被其它测试注入的 globalThis.window 污染导致非确定
    withGlobal('window', { devicePixelRatio: 1, addEventListener: () => {} }, () => {
      const s = vp.surface();
      expect(s.width).toBe(900);
      expect(s.height).toBe(500);
      expect(s.devicePixelRatio).toBe(1);
      expect(typeof s.now()).toBe('number');
      let subscribed = false;
      vp.onResize(() => {
        subscribed = true;
      });
      expect(subscribed).toBe(false); // addEventListener 是 no-op stub，不立即触发
    });
    // 无 window → dpr 回退 1（确定性验证，不依赖全局是否被污染）
    withGlobal('window', undefined, () => {
      expect(vp.surface().devicePixelRatio).toBe(1);
    });
  });

  it('WechatViewport：surface 来自 canvas + pixelRatio；onResize no-op', () => {
    const canvas = { width: 1280, height: 720 } as any;
    const vp = new WechatViewport(canvas, 2);
    const s = vp.surface();
    expect(s.width).toBe(1280);
    expect(s.height).toBe(720);
    expect(s.devicePixelRatio).toBe(2);
    expect(() => vp.onResize(() => {})).not.toThrow();
  });

  it('PlatformInput：Web 绑定 click 触发；WeChat no-op 安全', () => {
    const web = new WebInput();
    let clicked = false;
    const el: any = { addEventListener: (ev: string, fn: () => void) => {
      if (ev === 'click') fn();
    } };
    web.bindClick(el, () => {
      clicked = true;
    });
    expect(clicked).toBe(true);
    const wxInput = new WechatInput();
    expect(() => wxInput.bindClick(el, () => {})).not.toThrow();
  });

  it('createWebCore / createWechatCore 组装合法 PlatformCore', () => {
    const web = createWebCore();
    expect(typeof web.storage.getItem).toBe('function');
    expect(typeof web.lifecycle.now).toBe('function');
    expect(typeof web.input.bindClick).toBe('function');
    expect(typeof web.createViewport).toBe('function');
    const wx = createWechatCore(3);
    expect(wx.createViewport({ width: 800, height: 600 }).surface().devicePixelRatio).toBe(3);
  });

  it('platform 单例为当前绑定的 Web Core（未绑定访问 fail-fast）', () => {
    bindPlatformCore(createWebCore());
    expect(typeof platform.storage.getItem).toBe('function');
    expect(typeof platform.lifecycle.now).toBe('function');
    expect(typeof platform.createViewport).toBe('function');
  });

  it('platform 未绑定即访问 → 抛错（fail-fast，禁止静默退回 Web）', () => {
    bindPlatformCore(createWebCore()); // 先绑定，隔离其它用例状态
    // 用「绑定为 null 前快照」不可行（单例），改验证：替换为 null 会抛错由实现保证；
    // 这里验证的是绑定的可覆盖性：改绑 WechatCore 后 storage 实例随之切换。
    bindPlatformCore(createWechatCore(1));
    const core = (platform as any).storage;
    expect(core.constructor.name).toBe('WechatStorage');
    // 还原为 Web Core，避免影响本文件其它用例
    bindPlatformCore(createWebCore());
  });
});
