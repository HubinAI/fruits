import { describe, it, expect } from 'vitest';
import { CanvasPlayerUIHost } from '../src/ui/canvasPlayerUIHost';
import { bindPlatformCore } from '../src/platform/context';
import { createWebCore } from '../src/platform/web';
import { makeStarterDraft } from '../src/lab/buildEditorModel';
import { registry } from '../src/core/content';
import { getInventory, OFFICIAL_PARTS } from '../src/core/partInventory';
import type { SafeInsets } from '../src/platform/types';
import type { PlayerUIState } from '../src/ui/playerUI';

/**
 * F-META-3｜Backpack V1 + 合成整合：
 * 1. Garage 完全无合成入口（META-2 保持）；2. Backpack 显示真实库存（名称/星级/数量/装备态，
 * 未拥有不占列表）；3. 分类（全部/武器/功能件）；4. 5合1 完整迁入（复用 mergeWithCost 规则，
 * 合成区明确 可用1★/需要5/消耗/随机2★）；5. 当前装备不会被错误吃掉（available 排除 equipped）。
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
  fired: Record<string, number>;
}

function makeHost(vp: { w: number; h: number }, insets: SafeInsets): HostEnv {
  let captured: ((x: number, y: number) => void) | null = null;
  const fired: Record<string, number> = {};
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
  const rec = (k: string) => () => void (fired[k] = (fired[k] ?? 0) + 1);
  host.setActions({
    onMerge: rec('merge'),
  } as never);
  return {
    host,
    pointer: (x, y) => captured!(x, y),
    areas: () => host.getHitAreasForTest(),
    fired,
  };
}

function state(over: Partial<PlayerUIState> = {}): PlayerUIState {
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

/** 每类部件 1★×2 + 2★×1（全部分类有货） */
function richInv(): Record<string, { one: number; two: number }> {
  const inv: Record<string, { one: number; two: number }> = {};
  for (const p of OFFICIAL_PARTS) inv[p] = { one: 2, two: 1 };
  return inv;
}

/** 只 cannon 有货（其余全 0） */
function cannonOnlyInv(one: number): Record<string, { one: number; two: number }> {
  const inv: Record<string, { one: number; two: number }> = {};
  for (const p of OFFICIAL_PARTS) inv[p] = { one: 0, two: 0 };
  inv['cannon'] = { one, two: 0 };
  return inv;
}

const INSETS: SafeInsets = { left: 44, right: 20, top: 12, bottom: 16 };

function items(env: HostEnv): string[] {
  return env.areas().filter((a) => a.id.startsWith('bpack-item:')).map((a) => a.id.slice(11));
}

function goBackpack(env: HostEnv): void {
  const navBp = env.areas().find((a) => a.id === 'nav:backpack')!;
  env.pointer(navBp.x + navBp.w / 2, navBp.y + navBp.h / 2);
}

function click(env: HostEnv, id: string): void {
  const a = env.areas().find((x) => x.id === id);
  expect(a, `应有 ${id}`).toBeTruthy();
  env.pointer(a!.x + a!.w / 2, a!.y + a!.h / 2);
}

describe('F-META-3｜Backpack V1 + 合成整合', () => {
  it('验收2｜Backpack 显示真实库存：未拥有不占列表；滚动可达更多；装备项显示', () => {
    const env = makeHost({ w: 844, h: 390 }, INSETS);
    // 只有 cannon 有货 → 列表显示 cannon + starter 装备项（pushRod/cannon/hammer——装备态必显示）；
    // 未拥有的非装备项（如 laser）不占主列表
    env.host.render(state({ inventory: cannonOnlyInv(1) as never }));
    goBackpack(env);
    const sparse = items(env);
    expect(sparse, 'cannon（有货）显示').toContain('cannon');
    expect(sparse, '装备项 hammer 显示（装备态不隐藏）').toContain('hammer');
    expect(sparse, '未拥有的非装备项不占列表').not.toContain('laser');
    // 富库存：首屏可见若干项（含 starter 装备项 cannon——装备态不被隐藏）
    env.host.render(state({ inventory: richInv() as never, progress: { coin: 600, rating: 20 } }));
    expect(items(env).length, '富库存首屏可见 > 0').toBeGreaterThan(0);
    expect(items(env), '装备项 cannon 显示').toContain('cannon');
    // 滚动后可见集合变化（更多项可达）
    const before = items(env);
    const sd = env.areas().find((a) => a.id === 'panel-scroll-down');
    expect(sd, '富库存列表应有滚动').toBeTruthy();
    env.pointer(sd!.x + sd!.w / 2, sd!.y + sd!.h / 2);
    const after = items(env);
    expect(after.some((id) => !before.includes(id)), '滚动后出现新项').toBe(true);
  });

  it('验收2b｜分类：全部 / 武器 / 功能件——过滤后可见项集合满足分类约束', () => {
    const env = makeHost({ w: 844, h: 390 }, INSETS);
    env.host.render(state({ inventory: richInv() as never, progress: { coin: 600, rating: 20 } }));
    goBackpack(env);
    const allCount = items(env).length;
    expect(allCount).toBeGreaterThan(0);
    // 武器
    click(env, 'bfilter:weapon');
    const wItems = items(env);
    expect(wItems.length).toBeGreaterThan(0);
    for (const id of wItems) expect(registry.functionals.get(id)?.category, `${id} 应为 weapon`).toBe('weapon');
    // 功能件
    click(env, 'bfilter:gadget');
    const gItems = items(env);
    expect(gItems.length).toBeGreaterThan(0);
    for (const id of gItems) expect(registry.functionals.get(id)?.category, `${id} 应为 gadget`).toBe('gadget');
    // 全部恢复
    click(env, 'bfilter:all');
    expect(items(env).length, '恢复全部').toBe(allCount);
  });

  it('验收3｜合成后更新：确认派发 onMerge；render 新 state 后列表更新；副本不足时确认禁用', () => {
    const env = makeHost({ w: 844, h: 390 }, INSETS);
    env.host.render(state({ inventory: richInv() as never, progress: { coin: 600, rating: 20 } }));
    goBackpack(env);
    click(env, 'merge'); // 展开合成面板
    expect(env.areas().some((a) => a.id === 'merge-confirm'), '可合成时确认按钮出现').toBe(true);
    click(env, 'merge-confirm'); // 确认 → 派发 onMerge（数量/金币更新由 runtime mergeWithCost 处理）
    expect(env.fired['merge'], 'onMerge 已派发').toBe(1);
    // 关闭合成面板 → runtime 合成后返回新 state（各扣 1 个 1★）→ render 后列表仍显示
    click(env, 'merge-close');
    const mergedInv: Record<string, { one: number; two: number }> = {};
    for (const p of OFFICIAL_PARTS) mergedInv[p] = { one: 1, two: 1 };
    env.host.render(state({ inventory: mergedInv as never, progress: { coin: 100, rating: 20 } }));
    expect(items(env).length, '更新后列表仍显示').toBeGreaterThan(0);
    // 再开合成面板：可用 1★ 减少后（副本不足）确认按钮禁用（不注册命中）
    click(env, 'merge');
    expect(env.areas().some((a) => a.id === 'merge-confirm'), '1★ 不足时确认按钮禁用（不注册命中）').toBe(false);
  });

  it('验收4｜当前装备不会被错误吃掉：available 排除 equipped', () => {
    const env = makeHost({ w: 844, h: 390 }, INSETS);
    // starter 已装备 cannon；cannon 1★×5 → 可用 = 5-1 = 4 < 5 → 不可合成（disabled）
    env.host.render(state({ inventory: cannonOnlyInv(5) as never, progress: { coin: 600, rating: 20 } }));
    goBackpack(env);
    click(env, 'merge');
    expect(env.areas().some((a) => a.id === 'merge-confirm'), 'cannon 1★×5 已装备 1 → 可用 4 < 5，确认禁用').toBe(false);
    click(env, 'merge-close');
    // cannon 1★×6 → 可用 = 6-1 = 5 ≥ 5 → 可合成（装备副本被排除，未被错误吃掉）
    env.host.render(state({ inventory: cannonOnlyInv(6) as never, progress: { coin: 600, rating: 20 } }));
    click(env, 'merge');
    expect(env.areas().some((a) => a.id === 'merge-confirm'), 'cannon 1★×6 排除装备后可用 5 → 可合成').toBe(true);
  });

  it('验收5｜返回 Garage 装备状态正常：离开局外后回 Garage 默认车库页 + Backpack 分类复位', () => {
    const env = makeHost({ w: 844, h: 390 }, INSETS);
    env.host.render(state({ inventory: richInv() as never, progress: { coin: 600, rating: 20 } }));
    goBackpack(env);
    // 切「功能件」过滤 → 可见项全部为 gadget（cannon 等 weapon 不可见）
    click(env, 'bfilter:gadget');
    const gItems = items(env);
    expect(gItems.length).toBeGreaterThan(0);
    expect(gItems, 'gadget 过滤下无 weapon 项').not.toContain('cannon');
    // 离开局外（matching）→ 回 garage（metaPage/backpackFilter 复位）
    env.host.render(state({ playerPhase: 'matching', battleState: 'editing' }));
    env.host.render(state());
    expect(env.areas().some((a) => a.id === 'entry:body'), '回 Garage 显示车库页').toBe(true);
    expect(env.areas().some((a) => a.id === 'cta-find'), '回 Garage 显示 CTA').toBe(true);
    // 再进 Backpack → 分类复位为「全部」：cannon（weapon）重新可见（gadget 过滤不残留）
    goBackpack(env);
    expect(items(env), '分类复位后 cannon（weapon）可见').toContain('cannon');
  });

  it('验收1｜Garage 完全无合成入口（META-2 保持）', () => {
    const env = makeHost({ w: 844, h: 390 }, INSETS);
    env.host.render(state({ inventory: richInv() as never, progress: { coin: 600, rating: 20 } }));
    expect(env.areas().some((a) => a.id === 'merge' || a.id === 'merge-close' || a.id === 'merge-confirm'), 'Garage 无任何合成痕迹').toBe(false);
  });
});
