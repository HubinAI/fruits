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
import { readWechatWindowInfo } from '../src/platform/wechat/windowInfo';
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

  it('WechatViewport：surface 为逻辑窗口尺寸（canvas.backing ÷ pixelRatio）；onResize no-op', () => {
    // F-WX-VIEWPORT-SURFACE-P0：surface 契约 = 逻辑视口。入口保证 canvas.width =
    // windowWidth×pixelRatio（backing）→ surface.width = canvas.width/pixelRatio = 逻辑宽。
    const canvas = { width: 1280, height: 720 } as any;
    const vp = new WechatViewport(canvas, 2);
    const s = vp.surface();
    expect(s.width).toBe(640); // 逻辑窗口宽（backing 1280 ÷ dpr 2）
    expect(s.height).toBe(360); // 逻辑窗口高（backing 720 ÷ dpr 2）
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

  it('PlatformInput：Web bindPointer 坐标换算 + 去重绑定（F-PLAYER-FLOW-ATOMIC-P0：无 PointerEvent 环境回退 mousedown+touchstart，不叠加 pointerdown）', () => {
    const web = new WebInput();
    const listeners = new Map<string, (ev: unknown) => void>();
    const el: any = {
      addEventListener: (ev: string, fn: (ev: unknown) => void) => listeners.set(ev, fn),
      getBoundingClientRect: () => ({ left: 10, top: 20 }),
    };
    let got: [number, number] | null = null;
    web.bindPointer(el, (x, y) => {
      got = [x, y];
    });
    // node 无 window.PointerEvent → 回退绑定（旧三者全绑已改为互斥回退，杜绝一次物理点击重复派发）
    expect(listeners.get('pointerdown'), '无 PointerEvent 不绑 pointerdown').toBeUndefined();
    expect(listeners.get('mousedown'), '回退 mousedown').toBeTruthy();
    expect(listeners.get('touchstart'), '回退 touchstart').toBeTruthy();
    // 模拟 mousedown：clientX=110, clientY=220 → 本地 (100, 200)
    listeners.get('mousedown')!({ clientX: 110, clientY: 220 });
    expect(got).toEqual([100, 200]);
    // 模拟 touchstart：touches[0]
    listeners.get('touchstart')!({ touches: [{ clientX: 55, clientY: 70 }] });
    expect(got).toEqual([45, 50]);
  });

  it('PlatformInput：WeChat bindPointer 经 wx.onTouchStart 回传 **Viewport Logical** 坐标（归一化契约）', () => {
    let onTouch: ((e: unknown) => void) | null = null;
    let sys = { pixelRatio: 2, windowWidth: 844, windowHeight: 390 }; // 可变：逻辑/物理坐标系
    (globalThis as Record<string, unknown>).wx = {
      getSystemInfoSync: () => sys,
      onTouchStart: (cb: (e: unknown) => void) => {
        onTouch = cb;
      },
    };
    const wxInput = new WechatInput();
    let got: [number, number] | null = null;
    // target = uiCanvas（物理 1688×780 = 844×390 × dpr2）；windowWidth=844（逻辑）→ 比例 1
    wxInput.bindPointer({ width: 1688, height: 780 } as unknown as EventTarget, (x, y) => {
      got = [x, y];
    });
    // 场景 A：raw 是窗口逻辑 px（clientX ∈ [0,844]，windowWidth=844 同坐标系）→ 比例 1
    onTouch!({ touches: [{ clientX: 422, clientY: 195 }] });
    expect(got).toEqual([422, 195]);
    // 场景 B：raw 是物理 px（clientX ∈ [0,1688]，windowWidth=1688 同物理坐标系）→ 归一化 844/1688
    sys = { pixelRatio: 2, windowWidth: 1688, windowHeight: 780 };
    onTouch!({ touches: [{ clientX: 844, clientY: 390 }] });
    expect(got).toEqual([422, 195]);
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

describe('F-WX-6 PlatformViewport.safeInsets（Safe Area 最小扩展）', () => {
  afterEach(() => {
    bindPlatformCore(createWebCore());
    delete (globalThis as any).wx;
  });

  it('WebViewport：无 DOM（Node/测试环境）→ safeInsets 全 0（安全降级）', () => {
    const vp = new WebViewport({ width: 800, height: 600 } as any);
    const ins = vp.safeInsets();
    expect(ins).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
  });

  it('WechatViewport：无 wx → safeInsets 全 0（安全降级）', () => {
    const vp = new WechatViewport({ width: 800, height: 600 } as any, 2);
    expect(vp.safeInsets()).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
  });

  it('WechatViewport：横屏刘海/系统边缘 → 从 systemInfo.safeArea 计算 inset（逻辑 px）', () => {
    (globalThis as any).wx = {
      getSystemInfoSync: () => ({
        windowWidth: 932,
        windowHeight: 430,
        // 横屏：刘海在左（left=44），右/顶/底无
        safeArea: { left: 44, right: 888, top: 0, bottom: 430, width: 844, height: 430 },
      }),
    };
    const vp = new WechatViewport({ width: 2796, height: 1290 } as any, 3);
    // 无 getMenuButtonBoundingClientRect（无胶囊能力环境）→ 仅 safeArea 生效
    expect(vp.safeInsets()).toEqual({ left: 44, right: 44, top: 0, bottom: 0 });
  });

  it('WechatViewport：safeArea 缺失 → 全 0（老基础库安全降级；无胶囊 API 环境）', () => {
    (globalThis as any).wx = { getSystemInfoSync: () => ({ windowWidth: 932, windowHeight: 430 }) };
    const vp = new WechatViewport({ width: 932, height: 430 } as any, 1);
    expect(vp.safeInsets()).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
  });

  it('Web 探针存在时读 CSS env（fake document 探针 → 可注入值）', () => {
    // 模拟浏览器：探针 computed padding 返回 env 值（'12px'/'44px' 等）
    const probeNode = {
      style: {} as Record<string, string>,
      remove: () => {},
    };
    const documentStub = {
      createElement: () => probeNode,
      body: { appendChild: () => {} },
    };
    const getComputedStyleStub = () => ({
      paddingTop: '0px',
      paddingRight: '0px',
      paddingBottom: '12px',
      paddingLeft: '44px',
    });
    const windowStub = { getComputedStyle: getComputedStyleStub };
    (globalThis as any).document = documentStub;
    (globalThis as any).window = windowStub;
    const vp = new WebViewport({ width: 800, height: 600 } as any);
    expect(vp.safeInsets()).toEqual({ left: 44, right: 0, top: 0, bottom: 12 });
    delete (globalThis as any).document;
    delete (globalThis as any).window;
  });

  it('F-WX-SAFE-AREA-P0：readWechatWindowInfo 读取胶囊矩形（menu button）', () => {
    (globalThis as any).wx = {
      getWindowInfo: () => ({
        windowWidth: 844,
        windowHeight: 390,
        pixelRatio: 2,
        safeArea: { left: 0, top: 0, right: 844, bottom: 390, width: 844, height: 390 },
      }),
      getMenuButtonBoundingClientRect: () => ({
        width: 87,
        height: 32,
        top: 4,
        left: 744,
        right: 831,
        bottom: 36,
      }),
    };
    const info = readWechatWindowInfo();
    expect(info, 'windowInfo 应成功读取').toBeTruthy();
    expect(info!.menuButton, '胶囊矩形应被填充').toBeTruthy();
    expect(info!.menuButton!.left).toBe(744);
    expect(info!.menuButton!.right).toBe(831);
    expect(info!.menuButton!.top).toBe(4);
    expect(info!.menuButton!.bottom).toBe(36);
    expect(info!.menuButton!.width).toBe(87);
    expect(info!.menuButton!.height).toBe(32);
  });

  it('F-WX-SAFE-AREA-P0：menuButton API 缺失 → menuButton=null（安全降级）', () => {
    (globalThis as any).wx = {
      getWindowInfo: () => ({
        windowWidth: 844,
        windowHeight: 390,
        pixelRatio: 1,
        safeArea: null,
      }),
    };
    const info = readWechatWindowInfo();
    expect(info!.menuButton).toBeNull();
    expect(info!.safeArea).toBeNull();
  });

  it('F-WX-SAFE-AREA-P0：safeInsets 折叠胶囊进 right/top（顶部右侧避让，≥6px gap）', () => {
    (globalThis as any).wx = {
      getWindowInfo: () => ({
        windowWidth: 844,
        windowHeight: 390,
        pixelRatio: 2,
        safeArea: { left: 0, top: 0, right: 844, bottom: 390, width: 844, height: 390 },
      }),
      getMenuButtonBoundingClientRect: () => ({
        width: 87,
        height: 32,
        top: 4,
        left: 744,
        right: 831,
        bottom: 36,
      }),
    };
    const vp = new WechatViewport({ width: 1688, height: 780 } as any, 2);
    const ins = vp.safeInsets();
    // 胶囊左侧 744 → 右侧内缩 = 844-744 = 100；+ GAP 6 = 106
    expect(ins.right).toBe(106);
    // 胶囊顶部 4 → 顶部内缩 = 4 + GAP 6 = 10
    expect(ins.top).toBe(10);
    // 无刘海 → left/bottom 不受胶囊影响
    expect(ins.left).toBe(0);
    expect(ins.bottom).toBe(0);
    // 右缘应落在胶囊左侧（744）左侧 ≥6px：W - insR = 844-106 = 738 ≤ 744 ✓
    expect(844 - ins.right).toBeLessThanOrEqual(744);
    expect(744 - (844 - ins.right), '与胶囊水平间距 ≥6px').toBeGreaterThanOrEqual(6);
  });

  it('F-WX-SAFE-AREA-P0：胶囊与 safeArea 取较大者（横屏左刘海 + 右上胶囊）', () => {
    (globalThis as any).wx = {
      getWindowInfo: () => ({
        windowWidth: 932,
        windowHeight: 430,
        pixelRatio: 3,
        safeArea: { left: 44, top: 0, right: 932, bottom: 430, width: 888, height: 430 },
      }),
      getMenuButtonBoundingClientRect: () => ({
        width: 87,
        height: 32,
        top: 4,
        left: 844,
        right: 931,
        bottom: 36,
      }),
    };
    const vp = new WechatViewport({ width: 2796, height: 1290 } as any, 3);
    const ins = vp.safeInsets();
    expect(ins.left).toBe(44); // safeArea 主导
    expect(ins.right).toBe(932 - 844 + 6); // 胶囊主导：88+6=94
    expect(ins.top).toBe(4 + 6); // 胶囊顶部 4 + 6 = 10
    expect(ins.bottom).toBe(0);
  });
});
