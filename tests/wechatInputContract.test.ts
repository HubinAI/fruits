/**
 * F-WX-P0-INPUT｜微信真实触控链契约测试。
 *
 * 验证从「raw 触摸坐标」到「CanvasPlayerUIHost 命中」的完整链路：
 *   raw touch → WechatInput 归一化（Viewport Logical Coordinates Contract）→
 *   handler(logicalX, logicalY) → screenToLayoutPoint → hitAreas → dispatch。
 *
 * 关键：不使用「fake touch 直接等于 logical coordinate」的捷径——
 * 用真实 WechatInput 实例 + fake wx.onTouchStart，raw 坐标经归一化后必须命中
 * 同一个视觉按钮中心（DPR=1/2/3 × 844×390/932×430、safeInsets≠0、mobile/desktop profile、
 * raw logical / raw physical 输入）。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { CanvasPlayerUIHost } from '../src/ui/canvasPlayerUIHost';
import { bindPlatformCore } from '../src/platform/context';
import { createWebCore } from '../src/platform/web';
import { createWechatCore } from '../src/platform/wechat';
import { makeStarterDraft } from '../src/lab/buildEditorModel';
import { registry } from '../src/core/content';
import { getInventory, OFFICIAL_PARTS } from '../src/core/partInventory';
import type { PlayerUIState } from '../src/ui/playerUI';
import type { SafeInsets } from '../src/platform/types';

function makeStubCtx(): CanvasRenderingContext2D {
  const handler = { get: () => () => ({ width: 0 }), set: () => true };
  return new Proxy({} as CanvasRenderingContext2D, handler);
}

interface Env {
  host: CanvasPlayerUIHost;
  fired: Record<string, string[]>;
  fireTouch(rawX: number, rawY: number): void;
  areas(): Array<{ id: string; x: number; y: number; w: number; h: number }>;
}

/** 用真实 WechatInput 建立全链：fake wx.onTouchStart → WechatInput 归一化 → host.handlePointer */
function setup(
  vp: { w: number; h: number },
  dpr: number,
  insets: SafeInsets = { left: 0, right: 0, top: 0, bottom: 0 },
  sysIsPhysical = false, // raw 坐标系（windowWidth 与 raw 同坐标系：逻辑=vp.w / 物理=vp.w×dpr）
): Env {
  const store = new Map<string, unknown>();
  const touchHandlers: Array<(e: unknown) => void> = [];
  const fired: Record<string, string[]> = {};
  const ww = sysIsPhysical ? vp.w * dpr : vp.w;
  const wh = sysIsPhysical ? vp.h * dpr : vp.h;
  (globalThis as any).wx = {
    getSystemInfoSync: () => ({
      pixelRatio: dpr,
      windowWidth: ww,
      windowHeight: wh,
      safeArea: { left: insets.left, right: ww - insets.right, top: insets.top, bottom: wh - insets.bottom, width: ww - insets.left - insets.right, height: wh - insets.top - insets.bottom },
    }),
    getStorageSync: (k: string) => (store.has(k) ? store.get(k) : null),
    setStorageSync: (k: string, v: unknown) => void store.set(k, v),
    removeStorageSync: (k: string) => void store.delete(k),
    onTouchStart: (cb: (e: unknown) => void) => {
      touchHandlers.push(cb);
    },
  };
  bindPlatformCore(createWechatCore(dpr)); // 真实 WechatInput + WechatViewport
  const canvas = {
    getContext: () => makeStubCtx(),
    width: vp.w * dpr,
    height: vp.h * dpr,
  } as unknown as HTMLCanvasElement;
  const host = new CanvasPlayerUIHost(canvas);
  host.mountCanvas(); // 内部 platform.input.bindPointer(uiCanvas) → WechatInput → wx.onTouchStart
  const rec = (k: string) => (v: string) => void (fired[k] = [...(fired[k] ?? []), v]);
  const once = (k: string) => () => void (fired[k] = [...(fired[k] ?? []), 'x']);
  host.setActions({
    onToggleGarageSlot: rec('toggle'),
    onPickGarageOption: rec('pick'),
    onFindOpponent: once('find'),
    onMatchAdjust: once('matchAdjust'),
    onStartBattle: once('startBattle'),
    onResultAdjust: once('resultAdjust'),
    onResultNext: once('next'),
    onClaimRewardAd: once('reward'),
    onMerge: once('merge'),
    onResetProgress: () => {},
  });
  return {
    host,
    fired,
    fireTouch: (rawX: number, rawY: number) => {
      for (const cb of touchHandlers) cb({ touches: [{ clientX: rawX, clientY: rawY }] });
    },
    areas: () => host.getHitAreasForTest() as unknown as Array<{ id: string; x: number; y: number; w: number; h: number }>,
  };
}

function garageState(over: Partial<PlayerUIState> = {}): PlayerUIState {
  return {
    uiMode: 'build',
    battleState: 'editing',
    playerPhase: 'garage',
    draft: makeStarterDraft('boxBody', registry),
    draftValid: true,
    blockReason: null,
    garageSelected: null,
    inventory: getInventory(),
    progress: { coin: 0, rating: 0 },
    onboarding: 'done',
    resetDevVisible: false,
    opponent: null,
    matchBarHidden: true,
    result: null,
    reward: null,
    economy: null,
    resultOnboardingVisible: false,
    rewardAdAvailable: false,
    rewardAdClaimed: false,
    readyOverlayVisible: false,
    ...over,
  };
}

/**
 * 视觉按钮中心 → raw 触摸坐标：
 * 布局中心 → viewport logical（layout×scale+ox，与 ensureSize 同语义）→
 * raw = logical × rawCoordinateWidth / logicalViewportWidth（raw 与 rawCoordinateWidth 同坐标系）。
 */
function rawFor(
  area: { x: number; y: number; w: number; h: number },
  vp: { w: number; h: number },
  dpr: number,
  rawIsPhysical: boolean,
): { rawX: number; rawY: number } {
  // layout 中心 → viewport logical（与 ensureSize 的 profile/scale/ox 同语义）
  const cx = area.x + area.w / 2;
  const cy = area.y + area.h / 2;
  const mobile = vp.h < 600; // 与 resolveLayoutProfile 一致
  const scale = mobile ? 1 : Math.min(vp.w / 1280, vp.h / 720);
  const ox = mobile ? 0 : (vp.w - 1280 * scale) / 2;
  const oy = mobile ? 0 : (vp.h - 720 * scale) / 2;
  const logicalX = cx * scale + ox;
  const logicalY = cy * scale + oy;
  const logicalVW = vp.w; // canvas.width / dpr
  const logicalVH = vp.h;
  // raw 坐标系宽度：逻辑 = windowWidth（vp.w）；物理 = vp.w × dpr（同坐标系）
  const rawWidth = rawIsPhysical ? vp.w * dpr : vp.w;
  const rawHeight = rawIsPhysical ? vp.h * dpr : vp.h;
  return { rawX: (logicalX * rawWidth) / logicalVW, rawY: (logicalY * rawHeight) / logicalVH };
}

/** F-HOME-1：Home（默认首页）→ 点「车库」→ 配置页（真实坐标链） */
function goGarage(env: Env, vp: { w: number; h: number }, dpr: number): void {
  const home = env.areas().find((a) => a.id === 'home-garage')!;
  expect(home, '首页有「车库」入口').toBeTruthy();
  const raw = rawFor(home, vp, dpr, false);
  env.fireTouch(raw.rawX, raw.rawY);
}

describe('F-WX-P0-INPUT 微信触控链契约', () => {
  afterEach(() => {
    bindPlatformCore(createWebCore());
    delete (globalThis as any).wx;
  });

  const MOBILE_VPS = [
    { w: 844, h: 390 },
    { w: 932, h: 430 },
  ];
  const DPRS = [1, 2, 3];

  for (const dpr of DPRS) {
    for (const vp of MOBILE_VPS) {
      it(`DPR=${dpr} ${vp.w}×${vp.h}：raw 逻辑坐标 → 归一化 → 命中同一 id（F-WX-UI-1 中央面板）`, () => {
        const env = setup(vp, dpr);
        env.host.render(garageState());
        goGarage(env, vp, dpr); // F-HOME-1：Home → 配置页（原 Garage 面板断言）
        // F-META-2：Garage 无合成入口（合成在 Backpack）；本循环只验证 garage 页交互
        for (const id of ['cta-find', 'entry:body', 'entry-wheels', 'entry-weapons']) {
          const area = env.areas().find((a) => a.id === id);
          expect(area, `${vp.w}×${vp.h} DPR=${dpr} 应有 ${id}`).toBeTruthy();
          const raw = rawFor(area!, vp, dpr, false); // raw = window logical px
          env.fireTouch(raw.rawX, raw.rawY);
          if (id === 'cta-find') {
            expect(env.fired['find'], `DPR=${dpr} ${id} 应派发 find`).toHaveLength(1);
          } else if (id === 'entry-wheels') {
            // 轮子一级 → 面板内前轮/后轮二级（首屏不暴露 frontWheel/rearWheel 入口）
            expect(env.areas().some((a) => a.id === 'wheel-side:front')).toBe(true);
            const front = env.areas().find((a) => a.id === 'wheel-side:front')!;
            const raw2 = rawFor(front, vp, dpr, false);
            env.fireTouch(raw2.rawX, raw2.rawY);
            expect(env.fired['toggle']).toContain('frontWheel');
          } else if (id === 'entry-weapons') {
            // 武器一级 → 面板内武器位列表（weapon-slot:）
            expect(env.areas().some((a) => a.id.startsWith('weapon-slot:'))).toBe(true);
          } else {
            expect(env.fired['toggle']).toContain(id.slice(6));
          }
          // 复位：回到 Garage 首屏（runtime 收起语义 + 面板返回 home）
          env.host.render(garageState());
          const back = env.areas().find((a) => a.id === 'panel-back');
          if (back) {
            const rawB = rawFor(back, vp, dpr, false);
            env.fireTouch(rawB.rawX, rawB.rawY);
          }
          delete env.fired['find'];
          delete env.fired['toggle'];
        }
      });
    }
  }

  for (const dpr of DPRS) {
    it(`DPR=${dpr}：raw 物理坐标输入（windowWidth 同物理坐标系）→ 归一化到逻辑 → 命中 cta-find`, () => {
      const vp = { w: 844, h: 390 };
      const env = setup(vp, dpr, { left: 0, right: 0, top: 0, bottom: 0 }, true); // sysIsPhysical
      env.host.render(garageState());
      const area = env.areas().find((a) => a.id === 'cta-find')!;
      const raw = rawFor(area, vp, dpr, true); // raw = 物理 px（windowWidth 同物理坐标系）
      env.fireTouch(raw.rawX, raw.rawY);
      expect(env.fired['find'], `DPR=${dpr} raw physical 应命中`).toHaveLength(1);
    });
  }

  it('safeInsets≠0：按钮在 safe area 内且真实坐标命中（不重复计算偏移）', () => {
    const vp = { w: 932, h: 430 };
    const insets: SafeInsets = { left: 44, right: 44, top: 0, bottom: 12 };
    const env = setup(vp, 2, insets);
    env.host.render(garageState());
    goGarage(env, vp, 2); // F-HOME-1：Home → 配置页
    for (const id of ['cta-find', 'entry:body']) {
      const area = env.areas().find((a) => a.id === id)!;
      expect(area.x, `${id} 起点 ≥ insL`).toBeGreaterThanOrEqual(insets.left);
      expect(area.x + area.w, `${id} 右缘 ≤ W-insR`).toBeLessThanOrEqual(vp.w - insets.right);
      expect(area.y + area.h, `${id} 底缘 ≤ H-insB`).toBeLessThanOrEqual(vp.h - insets.bottom);
      const raw = rawFor(area, vp, 2, false);
      env.fireTouch(raw.rawX, raw.rawY);
    }
    expect(env.fired['find']).toHaveLength(1);
    expect(env.fired['toggle']).toContain('body');
  });

  it('Desktop profile（1280×720）：screenToLayoutPoint 统一转换后命中', () => {
    const vp = { w: 1280, h: 720 };
    const env = setup(vp, 1);
    env.host.render(garageState());
    const area = env.areas().find((a) => a.id === 'cta-find')!;
    const raw = rawFor(area, vp, 1, false);
    env.fireTouch(raw.rawX, raw.rawY);
    expect(env.fired['find']).toHaveLength(1);
  });

  it('Desktop profile（1600×900，scale≠1）：fit 布局下仍命中同一视觉中心', () => {
    const vp = { w: 1600, h: 900 };
    const env = setup(vp, 1);
    env.host.render(garageState());
    const area = env.areas().find((a) => a.id === 'cta-find')!;
    const raw = rawFor(area, vp, 1, false);
    env.fireTouch(raw.rawX, raw.rawY);
    expect(env.fired['find']).toHaveLength(1);
  });

  it('一次触摸 → 一次 action：重复 fireTouch 同一位置不重复累积（事件生命周期）', () => {
    const vp = { w: 844, h: 390 };
    const env = setup(vp, 2);
    env.host.render(garageState());
    const area = env.areas().find((a) => a.id === 'cta-find')!;
    const raw = rawFor(area, vp, 2, false);
    env.fireTouch(raw.rawX, raw.rawY);
    env.fireTouch(raw.rawX, raw.rawY);
    // 两次独立触摸 → 两次 action（每次触摸一次派发，无 touchend 二次派发）
    expect(env.fired['find']).toHaveLength(2);
  });

  it('MISS 路径：点在空白处不派发任何 action', () => {
    const vp = { w: 844, h: 390 };
    const env = setup(vp, 2);
    env.host.render(garageState());
    env.fireTouch(10, 10); // 左上角空白（顶部状态条区域无按钮命中）
    const dispatched = Object.keys(env.fired).filter((k) => env.fired[k].length > 0);
    expect(dispatched).toHaveLength(0);
  });

  it('F-META-UX2｜Backpack 合成 Modal 流程：garage 无合成 → 切背包 → 点合成弹 Modal（真实坐标链命中）', () => {
    const vp = { w: 844, h: 390 };
    const env = setup(vp, 2);
    // 富库存（合成可确认——Modal 主按钮非禁用态才注册命中）
    const inv: Record<string, { one: number; two: number }> = {};
    for (const p of OFFICIAL_PARTS) inv[p] = { one: 2, two: 1 };
    env.host.render(garageState({ inventory: inv as never, progress: { coin: 600, rating: 20 } }));
    goGarage(env, vp, 2); // F-HOME-1：Home → 配置页
    // 配置页无任何合成入口/面板
    expect(env.areas().some((a) => a.id === 'merge')).toBe(false);
    // 点配置页顶栏「背包」→ backpack 页（按钮真实坐标命中）
    const navBp = env.areas().find((a) => a.id === 'nav:backpack')!;
    const rawNav = rawFor(navBp, vp, 2, false);
    env.fireTouch(rawNav.rawX, rawNav.rawY);
    const merge = env.areas().find((a) => a.id === 'merge')!;
    expect(merge, 'backpack 页有合成入口').toBeTruthy();
    // 点合成 → 合成说明 Modal（不切换全屏页面）
    const rawMerge = rawFor(merge, vp, 2, false);
    env.fireTouch(rawMerge.rawX, rawMerge.rawY);
    expect(env.areas().some((a) => a.id === 'modal-veil'), '合成 Modal 出现').toBe(true);
    expect(env.areas().some((a) => a.id === 'modal-primary'), '合成主按钮出现').toBe(true);
    // 取消 → Modal 消失，仍停留 Backpack
    const cancel = env.areas().find((a) => a.id === 'modal-secondary')!;
    const rawCancel = rawFor(cancel, vp, 2, false);
    env.fireTouch(rawCancel.rawX, rawCancel.rawY);
    expect(env.areas().some((a) => a.id === 'modal-veil'), '合成 Modal 关闭').toBe(false);
    expect(env.areas().some((a) => a.id === 'merge'), '仍停留 Backpack').toBe(true);
  });
});
