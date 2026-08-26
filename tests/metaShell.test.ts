import { describe, it, expect } from 'vitest';
import { CanvasPlayerUIHost } from '../src/ui/canvasPlayerUIHost';
import { computeHomeLayout } from '../src/ui/homeLayout';
import { bindPlatformCore } from '../src/platform/context';
import { createWebCore } from '../src/platform/web';
import { makeStarterDraft } from '../src/lab/buildEditorModel';
import { registry } from '../src/core/content';
import { getInventory, OFFICIAL_PARTS } from '../src/core/partInventory';
import type { SafeInsets } from '../src/platform/types';
import type { PlayerUIState } from '../src/ui/playerUI';

/**
 * F-HOME-1｜正式小游戏首页（默认主界面）：
 * 1. 首页只保留核心模块：寻找对手（主）/ 车辆展示 / 车库 / 排行榜 / 战令 / 宝箱栏 4 槽 / 个人信息；
 *    —— 背包/合成/更多/复杂配置不堆在首页；
 * 2. 「车库」→ 配置页（原 Garage：4 配置 + CTA + 顶栏背包/更多小按钮）；「‹ 首页」返回；
 * 3. Backpack / More 返回 → Home；离开局外回 Home；
 * 4. 配置页回归：2×2 主分类 + CTA + 车辆位置稳定（原 META-UX1/2B/3 断言保留）。
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
  host.setActions({ onToggleGarageSlot: () => {} } as never);
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

/** 富库存：每类部件 1★×2 + 2★×1，金币 600——合成可确认（Modal 主按钮非禁用态才注册命中） */
function richState(): PlayerUIState {
  const inv: Record<string, { one: number; two: number }> = {};
  for (const p of OFFICIAL_PARTS) inv[p] = { one: 2, two: 1 };
  return garageState({ inventory: inv as never, progress: { coin: 600, rating: 20 } });
}

function click(env: HostEnv, id: string): void {
  const a = env.areas().find((x) => x.id === id);
  expect(a, `应有 ${id}`).toBeTruthy();
  env.pointer(a!.x + a!.w / 2, a!.y + a!.h / 2);
}

/** F-HOME-1：Home → 点「车库」→ 配置页 */
function goGarage(env: HostEnv): void {
  click(env, 'home-garage');
  expect(env.areas().some((a) => a.id === 'entry:body'), '已进入配置页').toBe(true);
}

describe('F-HOME-1｜正式首页（默认主界面）+ 配置页回归', () => {
  it('验收1｜首页第一眼只有核心模块：寻找对手主按钮 + 车辆展示 + 车库/排行榜/战令 + 宝箱栏；无背包/合成/更多/配置', () => {
    const env = makeHost({ w: 844, h: 390 }, INSETS);
    env.host.render(garageState());
    const ids = env.areas().map((a) => a.id);
    // 核心模块入口（F-NAV-ACTION-OWNERSHIP-P0：唯一首页入口 id = home-find-opponent）
    expect(ids, '寻找对手主按钮').toContain('home-find-opponent');
    expect(ids, '首页无旧 cta-find').not.toContain('cta-find');
    for (const id of ['home-garage', 'home-rank', 'home-pass']) {
      expect(ids, `辅助入口 ${id}`).toContain(id);
    }
    for (let i = 0; i < 4; i++) {
      expect(ids, `宝箱槽 ${i}`).toContain(`home-chest-${i}`);
    }
    // 不堆在首页：无背包/合成/更多/配置/导航
    expect(ids.some((id) => id === 'nav:backpack' || id === 'nav:more' || id === 'nav:garage'), '首页无背包/更多导航').toBe(false);
    expect(ids.some((id) => id.startsWith('entry:')), '首页无配置入口').toBe(false);
    expect(ids.some((id) => id === 'merge' || id.startsWith('bfilter:') || id.startsWith('more:')), '首页无背包/合成/更多内容').toBe(false);
    // 「寻找对手」是首页最强视觉：全宽 primary（宽 ≥ 全部辅助入口之和）
    const cta = env.areas().find((a) => a.id === 'home-find-opponent')!;
    const assist = env.areas().find((a) => a.id === 'home-garage')!;
    const rank = env.areas().find((a) => a.id === 'home-rank')!;
    const pass = env.areas().find((a) => a.id === 'home-pass')!;
    expect(cta.w, 'CTA 宽 ≥ 三辅助入口之和').toBeGreaterThanOrEqual(assist.w + rank.w + pass.w);
    // 车辆展示区存在（Home framingRect 非空且面积大）
    const homeLayout = computeHomeLayout({ w: 844, h: 390 }, INSETS, { mode: 'mobile' } as never);
    const v = env.host.getPreviewFramingRect()!;
    expect(v, 'Home 车辆取景区').toEqual(homeLayout.vehicleFramingRect);
    expect(v.h, '车辆展示区高（明显可见）').toBeGreaterThanOrEqual(80);
  });

  it('验收2｜首页只回答核心动作：点「车库」进配置页，「‹ 首页」返回；排行榜/战令/宝箱弹「功能开发中」', () => {
    const env = makeHost({ w: 844, h: 390 }, INSETS);
    env.host.render(garageState());
    // 车库 → 配置页（原 Garage 布局回归：4 配置入口 + 顶栏背包/更多；F-NAV-ACTION-OWNERSHIP-P0：
    // 配置页不再含 cta-find——寻找对手只属首页）
    click(env, 'home-garage');
    const ids = env.areas().map((a) => a.id);
    for (const id of ['entry:body', 'entry-move', 'entry-weapons', 'entry-gadgets', 'nav:home', 'nav:backpack', 'nav:more']) {
      expect(ids, `配置页应含 ${id}`).toContain(id);
    }
    expect(ids.some((id) => id === 'cta-find' || id === 'home-find-opponent'), '配置页无寻找对手').toBe(false);
    // 「‹ 首页」返回 Home
    click(env, 'nav:home');
    expect(env.areas().some((a) => a.id === 'home-garage'), '返回首页').toBe(true);
    expect(env.areas().some((a) => a.id === 'entry:body'), '首页无配置入口').toBe(false);
    // 排行榜 / 战令 / 宝箱槽 → 「功能开发中」（无假数据页）
    for (const id of ['home-rank', 'home-pass', 'home-chest-0', 'home-chest-3']) {
      click(env, id);
      expect(env.areas().some((a) => a.id === 'modal-veil'), `${id} 弹占位 Modal`).toBe(true);
      click(env, 'modal-primary'); // 知道了 → 关闭
      expect(env.areas().some((a) => a.id === 'modal-veil'), `${id} Modal 关闭`).toBe(false);
      expect(env.areas().some((a) => a.id === 'home-garage'), '仍在首页').toBe(true);
    }
  });

  it('验收3｜Backpack / More 经配置页进入并返回 Home；返回后首页恢复（无配置残留）', () => {
    const env = makeHost({ w: 844, h: 390 }, INSETS);
    env.host.render(richState());
    goGarage(env);
    // 配置页顶栏「背包」→ Backpack（合成入口在）
    click(env, 'nav:backpack');
    expect(env.areas().some((a) => a.id === 'merge'), 'Backpack 有合成入口').toBe(true);
    // 返回（nav:garage）→ Home（非配置页）
    click(env, 'nav:garage');
    expect(env.areas().some((a) => a.id === 'home-garage'), '返回首页').toBe(true);
    expect(env.areas().some((a) => a.id === 'merge' || a.id.startsWith('entry:')), '首页无配置/合成残留').toBe(false);
    // 配置页顶栏「更多」→ More → 返回 Home
    goGarage(env);
    click(env, 'nav:more');
    expect(env.areas().some((a) => a.id === 'more:task'), 'More 页有入口').toBe(true);
    click(env, 'nav:garage');
    expect(env.areas().some((a) => a.id === 'home-garage'), '返回首页').toBe(true);
  });

  it('验收4｜配置页回归：合成走 Modal 且可返回；车辆位置稳定（切配置不跳）', () => {
    const env = makeHost({ w: 844, h: 390 }, INSETS);
    env.host.render(richState());
    goGarage(env);
    // 配置页无合成（Garage 职责纯化）
    expect(env.areas().some((a) => a.id === 'merge'), '配置页无合成入口').toBe(false);
    // Backpack 合成 Modal
    click(env, 'nav:backpack');
    const merge = env.areas().find((a) => a.id === 'merge')!;
    expect(merge.h, '合成入口高 ≥48').toBeGreaterThanOrEqual(48);
    click(env, 'merge');
    expect(env.areas().some((a) => a.id === 'modal-veil'), '合成 Modal 出现').toBe(true);
    click(env, 'modal-secondary'); // 取消
    expect(env.areas().some((a) => a.id === 'modal-veil'), '合成 Modal 关闭').toBe(false);
    expect(env.areas().some((a) => a.id === 'merge'), '仍停留 Backpack').toBe(true);
    // 返回 Home
    click(env, 'nav:garage');
    expect(env.areas().some((a) => a.id === 'home-garage'), '返回首页').toBe(true);
    // 车辆位置稳定：配置页内切配置 → 取景区不变
    goGarage(env);
    const before = env.host.getPreviewFramingRect();
    env.host.render(garageState({ garageSelected: 'body' }));
    expect(env.areas().some((a) => a.id.startsWith('opt:')), '车身选项展开').toBe(true);
    expect(env.host.getPreviewFramingRect(), '切配置后取景区不变').toEqual(before);
  });

  it('验收5｜离开局外回 Garage 默认回 Home；Battle 状态不残留局外元素', () => {
    const env = makeHost({ w: 844, h: 390 }, INSETS);
    env.host.render(garageState());
    goGarage(env);
    // 进入 matching（离开 garage）→ 无任何局外元素
    env.host.render(garageState({ playerPhase: 'matching', battleState: 'editing' }));
    expect(env.areas().some((a) => a.id.startsWith('nav:') || a.id.startsWith('entry:') || a.id.startsWith('home-')), 'matching 无局外元素').toBe(false);
    // 回 garage → metaPage 复位为 home（默认首页）
    env.host.render(garageState());
    expect(env.areas().some((a) => a.id === 'home-garage'), '回 garage 显示首页').toBe(true);
    expect(env.areas().some((a) => a.id === 'entry:body'), '首页无配置入口').toBe(false);
    // 进 battle（fighting）→ 仍无局外元素
    env.host.render(garageState({ playerPhase: 'matchPreview', battleState: 'fighting' }));
    expect(env.areas().some((a) => a.id.startsWith('nav:') || a.id.startsWith('home-')), 'battle 无局外元素').toBe(false);
  });
});
