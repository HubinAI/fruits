/**
 * F-WX-2.1｜Platform Binding 定向测试。
 *
 * 验收对应：
 * 1. Web 启动 → persistence 明确使用 WebStorage（globalThis.localStorage）；
 * 2. WeChat bootstrap → persistence 明确使用 WechatStorage（wx storage 同步 API）；
 * 3. WeChat Core 注入后，buildPersistence / inventory / progress 的读写实际落到
 *    fake WeChat storage，而不是 Web/localStorage；
 * 4. 「模块初始化即读取 storage」场景（adFrequency 顶层 loadState）：
 *    bootstrap 先绑定 WeChat Core 再 import 业务模块 → 顶层读落 WeChat storage。
 *
 * 运行于 Node：临时注入 globalThis.localStorage / globalThis.wx 模拟两平台，
 * 不依赖真实浏览器/微信。setup.ts 默认绑定 Web Core；本文件用例内改绑并在 afterEach 还原。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { bindPlatformCore, getPlatformCore } from '../src/platform/context';
import { platform } from '../src/platform/index';
import { createWebCore } from '../src/platform/web';
import { createWechatCore } from '../src/platform/wechat';
import { savePlayerBuild, loadPlayerBuild } from '../src/core/buildPersistence';
import { saveInventory, loadInventoryRaw } from '../src/core/partInventory';
import { saveProgress, loadProgressRaw } from '../src/core/playerProgress';
import { makeStarterDraft } from '../src/lab/buildEditorModel';
import { registry } from '../src/core/content';

const BUILD_KEY = 'strongfruit.playerBuild.v1';
const INV_KEY_V2 = 'strongfruit.ownedParts.v2';
const PROG_KEY = 'strongfruit.playerProgress.v1';
const AD_FREQ_KEY = 'strongfruit.ads.freq.v1';

function fakeWxStorage(): Map<string, unknown> {
  const store = new Map<string, unknown>();
  (globalThis as any).wx = {
    getSystemInfoSync: () => ({ pixelRatio: 3 }),
    getStorageSync: (k: string) => (store.has(k) ? store.get(k) : null),
    setStorageSync: (k: string, v: unknown) => void store.set(k, v),
    removeStorageSync: (k: string) => void store.delete(k),
  };
  return store;
}

function fakeWebStorage(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  return store;
}

describe('F-WX-2.1 Platform Binding', () => {
  afterEach(() => {
    bindPlatformCore(createWebCore());
    delete (globalThis as any).wx;
    delete (globalThis as any).localStorage;
  });

  it('验收1｜Web 绑定：persistence 经 WebStorage 读写 globalThis.localStorage', () => {
    const webStore = fakeWebStorage();
    bindPlatformCore(createWebCore());
    expect((platform.storage as any).constructor.name).toBe('WebStorage');

    const draft = makeStarterDraft('boxBody', registry);
    savePlayerBuild(draft);
    expect(webStore.has(BUILD_KEY)).toBe(true);
    const loaded = loadPlayerBuild();
    expect(loaded).not.toBeNull();
    expect(loaded?.bodyDefId).toBe('boxBody');
  });

  it('验收2/3｜WeChat 绑定：buildPersistence/inventory/progress 读写落到 fake WeChat storage', () => {
    const wxStore = fakeWxStorage();
    const webStore = fakeWebStorage(); // 对照：证明没有落到 Web/localStorage
    bindPlatformCore(createWechatCore(1));
    expect((platform.storage as any).constructor.name).toBe('WechatStorage');

    // buildPersistence
    const draft = makeStarterDraft('boxBody', registry);
    savePlayerBuild(draft);
    expect(wxStore.has(BUILD_KEY)).toBe(true);
    expect(webStore.has(BUILD_KEY)).toBe(false);
    expect(loadPlayerBuild()?.bodyDefId).toBe('boxBody');

    // inventory（含 v2 读写）
    saveInventory({ cannon: { one: 1, two: 0 } });
    expect(wxStore.has(INV_KEY_V2)).toBe(true);
    expect(webStore.has(INV_KEY_V2)).toBe(false);
    expect(loadInventoryRaw()?.cannon?.one).toBe(1);

    // progress
    saveProgress({ coin: 100, rating: 20 });
    expect(wxStore.has(PROG_KEY)).toBe(true);
    expect(webStore.has(PROG_KEY)).toBe(false);
    expect(loadProgressRaw()?.coin).toBe(100);
    expect(loadProgressRaw()?.rating).toBe(20);
  });

  it('验收2/3（读路径）｜wxStore 预置存档：load 从 WeChat storage 读回，而非 Web', () => {
    const wxStore = fakeWxStorage();
    const webStore = fakeWebStorage();
    bindPlatformCore(createWechatCore(1));

    // 预置 v2 存档到 fake WeChat storage（webStore 保持空）
    wxStore.set(INV_KEY_V2, JSON.stringify({ __v: 1, cannon: { one: 2, two: 1 } }));
    wxStore.set(PROG_KEY, JSON.stringify({ __v: 1, coin: 7, rating: 9 }));

    expect(webStore.has(INV_KEY_V2)).toBe(false);
    expect(webStore.has(PROG_KEY)).toBe(false);
    expect(loadInventoryRaw()?.cannon).toEqual({ one: 2, two: 1 });
    expect(loadProgressRaw()?.coin).toBe(7);
    expect(loadProgressRaw()?.rating).toBe(9);
  });

  it('验收4｜boot 顺序：bootstrap-wechat 先绑定，业务模块顶层读 storage 落 WeChat 而非 Web', async () => {
    vi.resetModules(); // 全新模块注册表，复现「启动时首次求值」的时序
    const wxStore = fakeWxStorage();
    // 预置 ad 频控存档 → 若顶层 loadState 读到它，证明走 WeChat storage
    wxStore.set(AD_FREQ_KEY, JSON.stringify({ __v: 1, battlesSinceLast: 5 }));

    // 模拟微信入口首行：先 import bootstrap-wechat（绑定 WechatCore），再 import 业务模块
    await import('../src/platform/bootstrap-wechat');
    const adf = await import('../src/core/adFrequency');

    // adFrequency 顶层 `let state = loadState()` 已从 fake WeChat storage 读到 5；
    // 若 boot 顺序错误（业务模块先于 bootstrap）或静默退回 Web，这里会是 0。
    // （注意：不能用静态 import 的 getPlatformCore 断言——resetModules 后它是旧注册表
    //  的原 context；真正的绑定证明就是 adf 顶层读到 5 本身。）
    expect(adf._getStateForTest().battlesSinceLast).toBe(5);

    vi.resetModules(); // 清理本用例的 fresh 注册表，不影响本文件静态导入的模块
  });

  it('平台绑定是当前启动平台真正注入的 core（可覆盖，不再固定 Web）', () => {
    bindPlatformCore(createWebCore());
    expect((getPlatformCore().storage as any).constructor.name).toBe('WebStorage');
    const wxStore = fakeWxStorage();
    bindPlatformCore(createWechatCore(1));
    expect((getPlatformCore().storage as any).constructor.name).toBe('WechatStorage');
    expect(wxStore.size).toBe(0); // WechatCore 已就位
  });
});
