import { describe, it, expect } from 'vitest';
import { CanvasPlayerUIHost } from '../src/ui/canvasPlayerUIHost';
import { computeMobileGarageLayout } from '../src/ui/mobileGarageLayout';
import { bindPlatformCore } from '../src/platform/context';
import { createWebCore } from '../src/platform/web';
import { makeStarterDraft } from '../src/lab/buildEditorModel';
import { registry } from '../src/core/content';
import { getInventory } from '../src/core/partInventory';
import type { SafeInsets } from '../src/platform/types';
import type { PlayerUIState } from '../src/ui/playerUI';

/**
 * F-META-1｜正式小游戏 Main UI Shell：
 * 1. 三个 MetaPage（garage/backpack/more）可切换（UI-only，Host 局部管理，不进 Gameplay 状态机）；
 * 2. Shell 几何统一（三页共享 topBar/nav/content 同一 layout rect）；
 * 3. Garage 现有功能不回归（2×2 主分类 + CTA + 合成次级入口可用）；
 * 4. Battle 状态不残留局外导航（matching/battle 无 nav：回 garage 默认回车库页）。
 */

function makeStubCtx(): CanvasRenderingContext2D {
  return new Proxy({} as CanvasRenderingContext2D, {
    get: () => () => ({ width: 0 }),
    set: () => true,
  });
}

interface HostEnv {
  host: CanvasPlayerUIHost;
  pointer: (x: number, y: number) => void;
  areas: () => ReturnType<CanvasPlayerUIHost['getHitAreasForTest']>;
}

function makeHost(
  vp: { w: number; h: number },
  insets: SafeInsets = { left: 44, right: 20, top: 12, bottom: 16 },
): HostEnv {
  let captured: ((x: number, y: number) => void) | null = null;
  const core = createWebCore();
  bindPlatformCore({
    ...core,
    input: {
      bindClick: () => {},
      bindPointer: (_t: EventTarget, h: (x: number, y: number) => void) => {
        captured = h;
      },
    },
    createViewport: () => ({
      surface: () => ({ width: vp.w, height: vp.h, devicePixelRatio: 1, now: () => 0 }),
      onResize: () => {},
      safeInsets: () => insets,
    }),
  } as unknown as Parameters<typeof bindPlatformCore>[0]);
  const canvas = {
    getContext: () => makeStubCtx(),
    width: vp.w,
    height: vp.h,
    style: undefined,
  } as unknown as HTMLCanvasElement;
  const host = new CanvasPlayerUIHost(canvas);
  host.mountCanvas();
  host.setActions({} as never);
  return {
    host,
    pointer: (x, y) => captured!(x, y),
    areas: () => host.getHitAreasForTest(),
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
    progress: { coin: 100, rating: 200 },
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

const INSETS: SafeInsets = { left: 44, right: 20, top: 12, bottom: 16 };

describe('F-META-1｜Main UI Shell', () => {
  it('验收1｜三个 MetaPage 可切换：garage → backpack → more → garage', () => {
    const env = makeHost({ w: 844, h: 390 }, INSETS);
    const s = garageState();
    env.host.render(s);
    // garage 页：2×2 主分类 + CTA + 合成入口 + 三个 nav tab
    expect(env.areas().some((a) => a.id === 'entry:body'), 'garage 页有车身入口').toBe(true);
    expect(env.areas().some((a) => a.id === 'cta-find'), 'garage 页有 CTA').toBe(true);
    expect(env.areas().some((a) => a.id === 'merge'), 'garage 页有合成次级入口').toBe(true);
    for (const id of ['nav:garage', 'nav:backpack', 'nav:more']) {
      expect(env.areas().some((a) => a.id === id), `应有 ${id}`).toBe(true);
    }
    // 点「背包」→ backpack 页：无 garage 专属（entry/cta/merge），仍有三 nav
    const navBp = env.areas().find((a) => a.id === 'nav:backpack')!;
    env.pointer(navBp.x + navBp.w / 2, navBp.y + navBp.h / 2);
    expect(env.areas().some((a) => a.id === 'entry:body'), 'backpack 页无车身入口').toBe(false);
    expect(env.areas().some((a) => a.id === 'cta-find'), 'backpack 页无 CTA').toBe(false);
    expect(env.areas().some((a) => a.id === 'merge'), 'backpack 页无合成入口').toBe(false);
    expect(env.areas().some((a) => a.id === 'nav:garage'), 'backpack 页仍有车库 tab').toBe(true);
    // 点「更多」→ more 页
    const navMore = env.areas().find((a) => a.id === 'nav:more')!;
    env.pointer(navMore.x + navMore.w / 2, navMore.y + navMore.h / 2);
    expect(env.areas().some((a) => a.id === 'entry:body'), 'more 页无车身入口').toBe(false);
    // 点「车库」→ 回 garage 页
    const navGarage = env.areas().find((a) => a.id === 'nav:garage')!;
    env.pointer(navGarage.x + navGarage.w / 2, navGarage.y + navGarage.h / 2);
    expect(env.areas().some((a) => a.id === 'entry:body'), '回 garage 页车身入口恢复').toBe(true);
    expect(env.areas().some((a) => a.id === 'cta-find'), '回 garage 页 CTA 恢复').toBe(true);
  });

  it('验收2｜Shell 几何统一：三页 topBar/nav 来自同一 layout rect', () => {
    const env = makeHost({ w: 844, h: 390 }, INSETS);
    const s = garageState();
    env.host.render(s);
    const layout = computeMobileGarageLayout({ w: 844, h: 390 }, INSETS);
    // garage 页：nav:garage 按钮 rect == layout.navRect（首 tab）
    const navGarage = env.areas().find((a) => a.id === 'nav:garage')!;
    expect(navGarage.x, 'nav:garage x == navRect.x').toBe(layout.navRect.x);
    expect(navGarage.y, 'nav:garage y == navRect.y').toBe(layout.navRect.y);
    expect(navGarage.h, 'nav 高 == navRect.h').toBe(layout.navRect.h);
    // 切 backpack → nav 按钮几何不变（Shell 统一）
    const bp = env.areas().find((a) => a.id === 'nav:backpack')!;
    env.pointer(bp.x + bp.w / 2, bp.y + bp.h / 2);
    const navG2 = env.areas().find((a) => a.id === 'nav:garage')!;
    expect(navG2.x, 'backpack 页 nav:garage x 不变').toBe(layout.navRect.x);
    expect(navG2.y, 'backpack 页 nav:garage y 不变').toBe(layout.navRect.y);
    expect(navG2.h, 'backpack 页 nav 高不变').toBe(layout.navRect.h);
  });

  it('验收3｜Garage 现有功能不回归：改部件入口 + 合成面板仍可用', () => {
    const env = makeHost({ w: 844, h: 390 }, INSETS);
    env.host.render(garageState());
    // 点车身 → onToggleGarageSlot 语义（entry:body 存在即可点；actions mock 空——验证 hitArea 存在）
    const entry = env.areas().find((a) => a.id === 'entry:body')!;
    expect(entry.h, '入口高 ≥48').toBeGreaterThanOrEqual(48);
    // 点合成（nav 行第 4 位）→ 合成面板展开（merge-close 出现）
    const merge = env.areas().find((a) => a.id === 'merge')!;
    expect(merge.h, '合成入口高 ≥48').toBeGreaterThanOrEqual(48);
    env.pointer(merge.x + merge.w / 2, merge.y + merge.h / 2);
    expect(env.areas().some((a) => a.id === 'merge-close'), '合成面板展开').toBe(true);
    // 关闭合成面板
    const close = env.areas().find((a) => a.id === 'merge-close')!;
    env.pointer(close.x + close.w / 2, close.y + close.h / 2);
    expect(env.areas().some((a) => a.id === 'merge-close'), '合成面板关闭').toBe(false);
  });

  it('验收4｜Battle 状态不残留局外导航；回 Garage 默认回车库页', () => {
    const env = makeHost({ w: 844, h: 390 }, INSETS);
    // 先进 backpack，验证离开局外后复位
    env.host.render(garageState());
    const navBp = env.areas().find((a) => a.id === 'nav:backpack')!;
    env.pointer(navBp.x + navBp.w / 2, navBp.y + navBp.h / 2);
    expect(env.areas().some((a) => a.id === 'entry:body'), 'backpack 页无入口').toBe(false);
    // 进入 matching（离开 garage）→ 无任何局外 nav
    env.host.render(garageState({ playerPhase: 'matching', battleState: 'editing' }));
    expect(env.areas().some((a) => a.id.startsWith('nav:')), 'matching 无局外导航').toBe(false);
    expect(env.areas().some((a) => a.id.startsWith('entry:')), 'matching 无配置入口').toBe(false);
    // 回 garage → metaPage 已复位为 garage（默认回车库页，不是 backpack）
    env.host.render(garageState());
    expect(env.areas().some((a) => a.id === 'entry:body'), '回 garage 显示车库页').toBe(true);
    expect(env.areas().some((a) => a.id === 'cta-find'), '回 garage 显示 CTA').toBe(true);
    // 再进 battle（fighting）→ 仍无局外导航
    env.host.render(garageState({ playerPhase: 'matchPreview', battleState: 'fighting' }));
    expect(env.areas().some((a) => a.id.startsWith('nav:')), 'battle 无局外导航').toBe(false);
  });
});
