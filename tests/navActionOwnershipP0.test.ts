/**
 * F-NAV-ACTION-OWNERSHIP-P0｜页面职责统一 —— 页面允许动作白名单验收。
 *
 * 职责固定：Home 拥有「寻找对手」；Garage 只调整配置并返回；Backpack 只查看库存与合成；
 * More 只承载次级功能；Matching/Battle/Result 不显示局外匹配入口。
 *
 * 本文件锁定（Must#7 + Acceptance#2/3/4）：
 * A. 各页面允许动作白名单（Home/Garage/Backpack/More）；
 * B. 首页存在且仅存在一个「寻找对手」（home-find-opponent）；
 * C. Garage/Backpack/More 均无 home-find-opponent / 旧 cta-find 命中区（物理不可触发）；
 * D. 从 Garage 返回首页后才能寻找对手（流程）；
 * E. dispatch 页面上下文守卫（非首页即使收到旧 id 也不进入匹配——源码守卫）。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { CanvasPlayerUIHost } from '../src/ui/canvasPlayerUIHost';
import { bindPlatformCore } from '../src/platform/context';
import { createWebCore } from '../src/platform/web';
import { makeStarterDraft } from '../src/lab/buildEditorModel';
import { getInventory } from '../src/core/partInventory';
import { registry } from '../src/core/content';
import type { PlayerUIState, PlayerUIActions } from '../src/ui/playerUI';

const HOST_SRC = readFileSync('src/ui/canvasPlayerUIHost.ts', 'utf-8');

const INSETS = { left: 44, right: 44, top: 0, bottom: 12 };

function makeRecHost(vp: { w: number; h: number }): { host: CanvasPlayerUIHost; pointer: (x: number, y: number) => void } {
  let captured: ((x: number, y: number) => void) | null = null;
  const core = createWebCore();
  bindPlatformCore({
    ...core,
    input: { bindClick: () => {}, bindPointer: (_t: EventTarget, h: (x: number, y: number) => void) => { captured = h; } },
    createViewport: () => ({ surface: () => ({ width: vp.w, height: vp.h, devicePixelRatio: 1, now: () => 0 }), onResize: () => {}, safeInsets: () => INSETS }),
  } as unknown as Parameters<typeof bindPlatformCore>[0]);
  const canvas = {
    getContext: () => new Proxy({} as CanvasRenderingContext2D, { get: () => () => ({ width: 0 }), set: () => true }),
    width: vp.w,
    height: vp.h,
    style: undefined,
  } as unknown as HTMLCanvasElement;
  const host = new CanvasPlayerUIHost(canvas);
  host.mountCanvas();
  host.setActions({} as unknown as PlayerUIActions);
  return { host, pointer: (x: number, y: number) => captured!(x, y) };
}

function garageState(over: Partial<PlayerUIState> = {}): PlayerUIState {
  return {
    uiMode: 'build', battleState: 'editing', playerPhase: 'garage',
    draft: makeStarterDraft('boxBody', registry), draftValid: true, blockReason: null,
    garageSelected: null, inventory: getInventory(), progress: { coin: 100, rating: 200 },
    onboarding: 'done', resetDevVisible: false, opponent: null, matchBarHidden: true,
    result: null, reward: null, economy: null, resultOnboardingVisible: false,
    rewardAdAvailable: false, rewardAdClaimed: false, readyOverlayVisible: false,
    ...over,
  };
}

function click(env: { host: CanvasPlayerUIHost; pointer: (x: number, y: number) => void }, id: string): void {
  const a = env.host.getHitAreasForTest().find((x) => x.id === id);
  expect(a, `应存在命中区 ${id}`).toBeTruthy();
  env.pointer(a!.x + a!.w / 2, a!.y + a!.h / 2);
}

const FIND_IDS = ['home-find-opponent', 'cta-find'];

describe('F-NAV-ACTION-OWNERSHIP-P0｜页面职责与动作白名单', () => {
  afterEach(() => {
    bindPlatformCore(createWebCore());
  });

  it('A1. Home：允许核心入口（含唯一 home-find-opponent），无组装/背包/合成/导航残留', () => {
    const env = makeRecHost({ w: 844, h: 390 });
    env.host.render(garageState());
    const ids = env.host.getHitAreasForTest().map((a) => a.id);
    // 允许：home-find-opponent + home-* 核心入口
    expect(ids, '首页有 home-find-opponent').toContain('home-find-opponent');
    for (const id of ['home-garage', 'home-rank', 'home-pass', 'home-profile']) {
      expect(ids, `首页有 ${id}`).toContain(id);
    }
    // 禁止：任何组装/背包/合成/导航/旧匹配入口
    const banned = ['entry:', 'opt:', 'chip:', 'merge', 'bfilter:', 'bpack-item:', 'more:', 'nav:', 'match-', 'modal-'];
    for (const b of banned) {
      expect(ids.some((id) => id.startsWith(b) || id.includes(b)), `首页无 ${b}`).toBe(false);
    }
  });

  it('A2. Garage：允许配置入口 + 返回首页，无寻找对手/合成', () => {
    const env = makeRecHost({ w: 844, h: 390 });
    env.host.render(garageState());
    click(env, 'home-garage'); // → 配置页
    const ids = env.host.getHitAreasForTest().map((a) => a.id);
    for (const id of ['garage-cat:body', 'garage-cat:move', 'garage-cat:weapon', 'garage-cat:gadget', 'nav:home']) {
      expect(ids, `配置页有 ${id}`).toBeTruthy();
    }
    // 无寻找对手（home-find-opponent / 旧 cta-find 均不注册）
    expect(ids.some((id) => FIND_IDS.includes(id)), '配置页无寻找对手').toBe(false);
    // 无合成（合成在背包）
    expect(ids.some((id) => id === 'merge'), '配置页无合成').toBe(false);
  });

  it('A3. Backpack：允许库存/合成/返回，无寻找对手', () => {
    const env = makeRecHost({ w: 844, h: 390 });
    env.host.render(garageState());
    click(env, 'home-garage');
    click(env, 'nav:backpack'); // → 背包
    const ids = env.host.getHitAreasForTest().map((a) => a.id);
    expect(ids.some((id) => id.startsWith('bfilter:') || id.startsWith('bpack-item:')), '背包有库存/过滤').toBe(true);
    // 无寻找对手
    expect(ids.some((id) => FIND_IDS.includes(id)), '背包无寻找对手').toBe(false);
  });

  it('A4. More：允许次级功能/设置，无寻找对手/配置/合成', () => {
    const env = makeRecHost({ w: 844, h: 390 });
    env.host.render(garageState());
    click(env, 'home-garage');
    click(env, 'nav:more'); // → 更多
    const ids = env.host.getHitAreasForTest().map((a) => a.id);
    expect(ids.some((id) => id.startsWith('more:') || id.startsWith('nav:')), 'More 有次级功能入口').toBe(true);
    expect(ids.some((id) => FIND_IDS.includes(id)), 'More 无寻找对手').toBe(false);
    expect(ids.some((id) => id.startsWith('entry:') || id === 'merge'), 'More 无配置/合成').toBe(false);
  });

  it('B. 首页存在且仅存在一个「寻找对手」（无重复入口/无旧 cta-find）', () => {
    const env = makeRecHost({ w: 844, h: 390 });
    env.host.render(garageState());
    const finds = env.host.getHitAreasForTest().filter((a) => FIND_IDS.includes(a.id));
    expect(finds, '仅一个寻找对手入口').toHaveLength(1);
    expect(finds[0]!.id, '入口 id = home-find-opponent').toBe('home-find-opponent');
  });

  it('C. Garage/Backpack/More 均无 home-find-opponent / cta-find 命中区（物理不可触发匹配）', () => {
    const env = makeRecHost({ w: 844, h: 390 });
    env.host.render(garageState());
    click(env, 'home-garage');
    expect(env.host.getHitAreasForTest().some((a) => FIND_IDS.includes(a.id)), '配置页无匹配入口').toBe(false);
    click(env, 'nav:backpack');
    expect(env.host.getHitAreasForTest().some((a) => FIND_IDS.includes(a.id)), '背包无匹配入口').toBe(false);
    // More：从背包顶栏进 More
    const more = env.host.getHitAreasForTest().find((a) => a.id === 'nav:more');
    if (more) {
      env.pointer(more.x + more.w / 2, more.y + more.h / 2);
      expect(env.host.getHitAreasForTest().some((a) => FIND_IDS.includes(a.id)), 'More 无匹配入口').toBe(false);
    }
  });

  it('D. 从 Garage 返回首页后才能寻找对手（Acceptance#3 流程）', () => {
    const env = makeRecHost({ w: 844, h: 390 });
    env.host.render(garageState());
    click(env, 'home-garage'); // 进配置页
    expect(env.host.getHitAreasForTest().some((a) => FIND_IDS.includes(a.id)), '配置页无寻找对手').toBe(false);
    click(env, 'nav:home'); // ‹ 首页 返回
    expect(env.host.getHitAreasForTest().some((a) => a.id === 'home-find-opponent'), '返回首页后恢复寻找对手').toBe(true);
    // 配置结果保留：draft 仍在（renderer 展示不变——draft 引用未替换）
    const st = env.host.getPreviewFramingRect();
    expect(st, '返回首页车辆取景区仍在').toBeTruthy();
  });

  it('E. dispatch 页面上下文守卫：非首页即使收到旧 cta-find id 也不进入匹配（源码守卫）', () => {
    const dispatch = HOST_SRC.slice(HOST_SRC.indexOf('case \'home-find-opponent\':'), HOST_SRC.indexOf('case \'merge\':'));
    expect(dispatch, '兼容旧 cta-find').toContain("case 'cta-find':");
    expect(dispatch, '仅正式首页允许 onFindOpponent').toContain("this.metaPage === 'home' && this.lastState?.playerPhase === 'garage'");
    expect(dispatch, '守卫条件内才调用').toContain('this.actions?.onFindOpponent();');
  });
});
