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
  // F-HOME-1：Home（默认）→ 配置页 → 顶栏「背包」
  if (env.areas().some((a) => a.id === 'home-garage')) {
    const homeGarage = env.areas().find((a) => a.id === 'home-garage')!;
    env.pointer(homeGarage.x + homeGarage.w / 2, homeGarage.y + homeGarage.h / 2);
  }
  const navBp = env.areas().find((a) => a.id === 'nav:backpack')!;
  env.pointer(navBp.x + navBp.w / 2, navBp.y + navBp.h / 2);
}

function click(env: HostEnv, id: string): void {
  const a = env.areas().find((x) => x.id === id);
  expect(a, `应有 ${id}`).toBeTruthy();
  env.pointer(a!.x + a!.w / 2, a!.y + a!.h / 2);
}

describe('F-META-3｜Backpack V1 + 合成整合', () => {
  it('验收2｜Backpack 显示真实库存：未拥有不占列表；2×2 分页可达全部；装备项显示', () => {
    const env = makeHost({ w: 844, h: 390 }, INSETS);
    // 只有 cannon 有货 → 列表显示 cannon + starter 装备项（pushRod/cannon/hammer——装备态必显示）；
    // 未拥有的非装备项（如 laser）不占主列表
    env.host.render(state({ inventory: cannonOnlyInv(1) as never }));
    goBackpack(env);
    const sparse = items(env);
    expect(sparse, 'cannon（有货）显示').toContain('cannon');
    expect(sparse, '装备项 hammer 显示（装备态不隐藏）').toContain('hammer');
    expect(sparse, '未拥有的非装备项不占列表').not.toContain('laser');
    // 富库存：首屏 2×2 一屏 4 张卡（含 starter 装备项 cannon——装备态不被隐藏）
    env.host.render(state({ inventory: richInv() as never, progress: { coin: 600, rating: 20 } }));
    expect(items(env).length, '一屏最多 4 张卡').toBeLessThanOrEqual(4);
    expect(items(env), '装备项 cannon 显示').toContain('cannon');
    // F-UX-2C：分页（无 ▲▼ 滚动）——点 [下一页] 出现新项，可到达全部库存
    expect(env.areas().some((a) => a.id === 'panel-scroll-up' || a.id === 'panel-scroll-down'), '无 ▲▼ 滚动按钮').toBe(false);
    const before = items(env);
    const next = env.areas().find((a) => a.id === 'backpack-page-next');
    expect(next, '多于 4 项有下一页').toBeTruthy();
    env.pointer(next!.x + next!.w / 2, next!.y + next!.h / 2);
    const after = items(env);
    expect(after.some((id) => !before.includes(id)), '翻页后出现新项').toBe(true);
    expect(after.length, '翻页后仍一屏 ≤4 张').toBeLessThanOrEqual(4);
    // 回到第一页
    const prev = env.areas().find((a) => a.id === 'backpack-page-prev');
    expect(prev, '有上一页').toBeTruthy();
    env.pointer(prev!.x + prev!.w / 2, prev!.y + prev!.h / 2);
    expect(items(env), '回到第一页').toEqual(before);
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

  it('验收3｜合成用 Modal 流：确认派发 onMerge + 合成成功结果 Modal + 库存即时刷新 + 仍停留 Backpack', () => {
    const env = makeHost({ w: 844, h: 390 }, INSETS);
    // cannon 1★×6（装备 1 → 可用 5）→ 可合成
    env.host.render(state({ inventory: cannonOnlyInv(6) as never, progress: { coin: 600, rating: 20 } }));
    goBackpack(env);
    click(env, 'merge'); // 合成说明 Modal（不切换全屏页面）
    expect(env.areas().some((a) => a.id === 'modal-veil'), '合成 Modal 遮罩出现').toBe(true);
    expect(env.areas().some((a) => a.id === 'modal-primary'), '可合成 → 主按钮注册').toBe(true);
    expect(env.areas().some((a) => a.id === 'modal-secondary'), '取消按钮出现').toBe(true);
    // 模拟 runtime 合成成功：onMerge → 新 state（cannon 1★×6 消耗 5 → one=1 two=1、金币扣 100）
    const afterInv: Record<string, { one: number; two: number }> = {};
    for (const p of OFFICIAL_PARTS) afterInv[p] = { one: 0, two: 0 };
    afterInv['cannon'] = { one: 1, two: 1 };
    env.host.setActions({
      onMerge: () => {
        env.fired['merge'] = (env.fired['merge'] ?? 0) + 1;
        env.host.render(state({ inventory: afterInv as never, progress: { coin: 500, rating: 20 } }));
      },
    } as never);
    click(env, 'modal-primary'); // 确认合成
    expect(env.fired['merge'], 'onMerge 已派发').toBe(1);
    // 合成成功结果 Modal（diff 出新 2★）→ 关闭后仍停留 Backpack + 库存即时变化
    expect(env.areas().some((a) => a.id === 'modal-veil'), '合成成功结果 Modal 出现').toBe(true);
    click(env, 'modal-primary'); // 知道了
    expect(env.areas().some((a) => a.id === 'modal-veil'), '成功 Modal 关闭').toBe(false);
    expect(env.areas().some((a) => a.id === 'merge'), '仍停留 Backpack（合成入口仍在）').toBe(true);
    expect(items(env), '库存即时变化：cannon（2★）显示').toContain('cannon');
    // 合成后可用 1★ = 1-1(装备) = 0 < 5 → 再开合成主按钮禁用（不注册命中）
    click(env, 'merge');
    expect(env.areas().some((a) => a.id === 'modal-primary'), '1★ 不足时主按钮禁用（不注册命中）').toBe(false);
    click(env, 'modal-secondary'); // 取消
    expect(env.areas().some((a) => a.id === 'modal-veil'), '取消关闭合成 Modal').toBe(false);
  });

  it('验收4｜当前装备不会被错误吃掉：available 排除 equipped（主按钮禁用语义）', () => {
    const env = makeHost({ w: 844, h: 390 }, INSETS);
    // starter 已装备 cannon；cannon 1★×5 → 可用 = 5-1 = 4 < 5 → 主按钮禁用（不注册命中）
    env.host.render(state({ inventory: cannonOnlyInv(5) as never, progress: { coin: 600, rating: 20 } }));
    goBackpack(env);
    click(env, 'merge');
    expect(env.areas().some((a) => a.id === 'modal-primary'), 'cannon 1★×5 已装备 1 → 可用 4 < 5，主按钮禁用').toBe(false);
    click(env, 'modal-secondary');
    // cannon 1★×6 → 可用 = 6-1 = 5 ≥ 5 → 可合成（装备副本被排除，未被错误吃掉）
    env.host.render(state({ inventory: cannonOnlyInv(6) as never, progress: { coin: 600, rating: 20 } }));
    click(env, 'merge');
    expect(env.areas().some((a) => a.id === 'modal-primary'), 'cannon 1★×6 排除装备后可用 5 → 可合成').toBe(true);
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
    // 离开局外（matching）→ 回 garage（metaPage 复位 Home + backpackFilter 复位）
    env.host.render(state({ playerPhase: 'matching', battleState: 'editing' }));
    env.host.render(state());
    expect(env.areas().some((a) => a.id === 'home-garage'), '回 Garage 默认显示首页（F-HOME-1）').toBe(true);
    // F-NAV-ACTION-OWNERSHIP-P0：回 Garage 后首页显示 home-find-opponent（唯一寻找对手入口）
    expect(env.areas().some((a) => a.id === 'home-find-opponent'), '回 Garage 首页显示寻找对手').toBe(true);
    expect(env.areas().some((a) => a.id === 'cta-find'), '无旧 cta-find').toBe(false);
    // 再进 Backpack → 分类复位为「全部」：cannon（weapon）重新可见（gadget 过滤不残留）
    goBackpack(env);
    expect(items(env), '分类复位后 cannon（weapon）可见').toContain('cannon');
  });

  it('验收1｜Garage 完全无合成入口（META-2 保持）', () => {
    const env = makeHost({ w: 844, h: 390 }, INSETS);
    env.host.render(state({ inventory: richInv() as never, progress: { coin: 600, rating: 20 } }));
    expect(env.areas().some((a) => a.id === 'merge'), 'Garage 无任何合成入口').toBe(false);
  });

  it('F-UX-2C｜合成结束仍停在背包当前页：翻页后合成 → 关闭成功 Modal → 分页未复位', () => {
    const env = makeHost({ w: 844, h: 390 }, INSETS);
    env.host.render(state({ inventory: richInv() as never, progress: { coin: 600, rating: 20 } }));
    goBackpack(env);
    // 翻到第 2 页（富库存 7 项 → 2 页）
    click(env, 'backpack-page-next');
    expect(env.areas().some((a) => a.id === 'backpack-page-prev'), '第 2 页有上一页').toBe(true);
    // 合成（onMerge mock → 合成后 state：各 one 2→1，cannon two 1→2）
    const afterInv: Record<string, { one: number; two: number }> = {};
    for (const p of OFFICIAL_PARTS) afterInv[p] = { one: 1, two: p === 'cannon' ? 2 : 1 };
    env.host.setActions({
      onMerge: () => {
        env.fired['merge'] = (env.fired['merge'] ?? 0) + 1;
        env.host.render(state({ inventory: afterInv as never, progress: { coin: 500, rating: 20 } }));
      },
    } as never);
    click(env, 'merge');
    click(env, 'modal-primary'); // 合成
    expect(env.areas().some((a) => a.id === 'modal-veil'), '合成成功 Modal').toBe(true);
    click(env, 'modal-primary'); // 知道了
    expect(env.areas().some((a) => a.id === 'merge'), '合成后仍停留 Backpack').toBe(true);
    // 仍停留当前页（分页未因合成复位——backpack-page-prev 仍显示 = 非第一页）
    expect(env.areas().some((a) => a.id === 'backpack-page-prev'), '合成后分页未复位（仍第 2 页）').toBe(true);
  });
});
