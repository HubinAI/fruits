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
 * F-META-6｜未来功能入口预留：
 * 1. More 有 4 个清楚入口（2×2 功能卡：任务/商店/战令/设置）；
 * 2. 未开放功能（任务/商店/战令）统一弹「功能开发中」Modal；
 * 3. 设置入口做最小可用页：音效/震动开关（仅保存 UI preference，不接 Runtime 音频）；
 * 4. Garage/Backpack 不被这些入口污染；所有入口都有响应（无死按钮）。
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
  store: Record<string, string>;
}

function makeHost(
  vp: { w: number; h: number },
  insets: SafeInsets,
  preload: Record<string, string> = {},
): HostEnv {
  let captured: ((x: number, y: number) => void) | null = null;
  const store: Record<string, string> = { ...preload };
  const core = createWebCore();
  bindPlatformCore({
    ...core,
    storage: {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
    },
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
    store,
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

const INSETS: SafeInsets = { left: 44, right: 20, top: 12, bottom: 16 };
const VIEWPORTS = [
  { w: 621, h: 351 },
  { w: 844, h: 390 },
];

function click(env: HostEnv, id: string): void {
  const a = env.areas().find((x) => x.id === id);
  // F-GARAGE-CENTER-STAGE-P0：Garage 顶栏不再暴露 backpack/more 入口——走私有 dispatch
  if (!a && (id === 'nav:backpack' || id === 'nav:more' || id === 'nav:garage')) {
    (env.host as unknown as { dispatch: (i: string) => void }).dispatch(id);
    return;
  }
  expect(a, `应有 ${id}`).toBeTruthy();
  env.pointer(a!.x + a!.w / 2, a!.y + a!.h / 2);
}

/** 切到 More 页（F-HOME-1：Home → 配置页 → 顶栏「更多」） */
function goMore(env: HostEnv): void {
  env.host.render(state());
  if (env.areas().some((a) => a.id === 'home-garage')) click(env, 'home-garage');
  click(env, 'nav:more');
}

describe('F-META-6｜未来功能入口预留', () => {
  it('验收1｜More 有 4 个清楚入口（2×2 功能卡，触控 ≥48，全部在内容区内）', () => {
    for (const vp of VIEWPORTS) {
      const env = makeHost(vp, INSETS);
      goMore(env);
      const ids = ['more:task', 'more:shop', 'more:pass', 'more:settings'];
      for (const id of ids) {
        const a = env.areas().find((x) => x.id === id);
        expect(a, `${vp.w}×${vp.h} 应有 ${id}`).toBeTruthy();
        expect(a!.h, `${id} 高 ≥48`).toBeGreaterThanOrEqual(48);
        expect(a!.x, `${id} x ≥0`).toBeGreaterThanOrEqual(0);
        expect(a!.x + a!.w, `${id} 右缘 ≤ 屏宽`).toBeLessThanOrEqual(vp.w);
        expect(a!.y, `${id} y ≥0`).toBeGreaterThanOrEqual(0);
        expect(a!.y + a!.h, `${id} 底缘 ≤ 屏高`).toBeLessThanOrEqual(vp.h);
      }
      // 2×2 排布：第一行 任务|商店，第二行 战令|设置（同行 y 相等；同列 x 相等）
      const task = env.areas().find((x) => x.id === 'more:task')!;
      const shop = env.areas().find((x) => x.id === 'more:shop')!;
      const pass = env.areas().find((x) => x.id === 'more:pass')!;
      const set = env.areas().find((x) => x.id === 'more:settings')!;
      expect(shop.y, '任务/商店同行').toBe(task.y);
      expect(pass.y, '战令/设置同行').toBe(set.y);
      expect(pass.y, '第二行在第一行下方').toBeGreaterThan(task.y);
      expect(task.x, '任务/战令同列').toBe(pass.x);
      expect(shop.x, '商店/设置同列').toBe(set.x);
      expect(shop.x, '商店在任务右侧').toBeGreaterThan(task.x + task.w - 0.5);
    }
  });

  it('验收2｜未开放功能统一弹窗：任务/商店/战令 → 「功能开发中」Modal，关闭恢复 More 页', () => {
    const env = makeHost({ w: 844, h: 390 }, INSETS);
    goMore(env);
    for (const id of ['more:task', 'more:shop', 'more:pass']) {
      click(env, id);
      // 统一 Modal：遮罩 + 主按钮（「知道了」）出现；无假数据页面（卡片仍注册，被遮罩拦截）
      expect(env.areas().some((a) => a.id === 'modal-veil'), `${id} → Modal 遮罩`).toBe(true);
      expect(env.areas().some((a) => a.id === 'modal-primary'), `${id} → Modal 主按钮`).toBe(true);
      expect(env.areas().some((a) => a.id === 'modal-secondary'), `${id} → 无次按钮（单按钮关闭）`).toBe(false);
      expect(env.areas().some((a) => a.id === 'more:task'), `${id} → 底层卡片仍绘制`).toBe(true);
      // 关闭 → 恢复 More 页（卡片可再点）
      click(env, 'modal-primary');
      expect(env.areas().some((a) => a.id === 'modal-veil'), '关闭后 Modal 消失').toBe(false);
      expect(env.areas().some((a) => a.id === 'more:task'), '关闭后恢复 More 卡片').toBe(true);
    }
  });

  it('验收3｜设置入口最小可用页：音效/震动开关（UI preference 持久化）+ 返回', () => {
    const env = makeHost({ w: 844, h: 390 }, INSETS);
    goMore(env);
    click(env, 'more:settings');
    // 设置子页：返回 + 两个开关行；主页卡片消失
    expect(env.areas().some((a) => a.id === 'settings-back'), '设置页有返回').toBe(true);
    expect(env.areas().some((a) => a.id === 'settings-sound'), '设置页有音效开关').toBe(true);
    expect(env.areas().some((a) => a.id === 'settings-vibration'), '设置页有震动开关').toBe(true);
    expect(env.areas().some((a) => a.id === 'more:task'), '设置页无功能卡').toBe(false);
    // 开关行高 ≥52（整行可点）
    const sound = env.areas().find((a) => a.id === 'settings-sound')!;
    expect(sound.h, '开关行高 ≥52').toBeGreaterThanOrEqual(52);
    // 初始默认开 → 点击关（写入 '0'）→ 再点开（写入 '1'）
    expect(env.store['pref.sound'], '初始未写偏好').toBeUndefined();
    click(env, 'settings-sound');
    expect(env.store['pref.sound'], '音效关闭持久化').toBe('0');
    click(env, 'settings-sound');
    expect(env.store['pref.sound'], '音效重开持久化').toBe('1');
    click(env, 'settings-vibration');
    expect(env.store['pref.vibration'], '震动关闭持久化').toBe('0');
    // 返回 → 回 More 主页
    click(env, 'settings-back');
    expect(env.areas().some((a) => a.id === 'more:task'), '返回后恢复功能卡').toBe(true);
    expect(env.areas().some((a) => a.id === 'settings-sound'), '返回后设置页消失').toBe(false);
  });

  it('验收3b｜初始偏好读取：预存 pref.sound=0 → 音效默认关（首点写回 1）', () => {
    const env = makeHost({ w: 844, h: 390 }, INSETS, { 'pref.sound': '0' });
    goMore(env);
    click(env, 'more:settings');
    // 初始为关 → 点击后为开（写 '1'），证明构造时读取了已存偏好
    click(env, 'settings-sound');
    expect(env.store['pref.sound'], '从关切到开写 1').toBe('1');
  });

  it('验收4｜Home/Backpack 不被污染；More 页与设置页无死按钮', () => {
    const env = makeHost({ w: 844, h: 390 }, INSETS);
    // Home（F-HOME-1 正式首页）：无任何 more/settings 入口
    env.host.render(state());
    expect(env.areas().some((a) => a.id.startsWith('more:')), 'Home 无 More 入口').toBe(false);
    expect(env.areas().some((a) => a.id.startsWith('settings-')), 'Home 无设置元素').toBe(false);
    // Backpack：无任何 more/settings 入口（backpack 页仅顶部「‹ 返回车库」）
    click(env, 'home-garage'); // 进配置页
    click(env, 'nav:backpack');
    expect(env.areas().some((a) => a.id.startsWith('more:')), 'Backpack 无 More 入口').toBe(false);
    expect(env.areas().some((a) => a.id.startsWith('settings-')), 'Backpack 无设置元素').toBe(false);
    // 返回车库配置页（新设计：nav:garage 回车库，不经过 Home），再经 nav:more 进 More
    click(env, 'nav:garage');
    expect(env.areas().some((a) => a.id.startsWith('garage-cat:')), '返回车库配置页').toBe(true);
    click(env, 'nav:more');
    // More 页：每个入口都有响应（无死按钮）
    for (const id of ['more:task', 'more:shop', 'more:pass']) {
      click(env, id);
      expect(env.areas().some((a) => a.id === 'modal-primary'), `${id} 有响应（Modal）`).toBe(true);
      click(env, 'modal-primary');
    }
    click(env, 'more:settings');
    expect(env.areas().some((a) => a.id === 'settings-sound'), '设置入口有响应').toBe(true);
    click(env, 'settings-back');
    // 设置页：返回/开关都有响应（无死按钮）
    click(env, 'more:settings');
    click(env, 'settings-sound');
    click(env, 'settings-vibration');
    expect(env.store['pref.sound'], '音效开关响应').toBe('0');
    expect(env.store['pref.vibration'], '震动开关响应').toBe('0');
    click(env, 'settings-back');
    expect(env.areas().some((a) => a.id === 'more:task'), '设置返回响应').toBe(true);
    // 小屏 621×351 下同样成立
    const envS = makeHost({ w: 621, h: 351 }, INSETS);
    goMore(envS);
    click(envS, 'more:shop');
    expect(envS.areas().some((a) => a.id === 'modal-veil'), '小屏弹窗正常').toBe(true);
    click(envS, 'modal-primary');
    click(envS, 'more:settings');
    expect(envS.areas().some((a) => a.id === 'settings-vibration'), '小屏设置页正常').toBe(true);
    click(envS, 'settings-back');
    expect(envS.areas().some((a) => a.id === 'more:task'), '小屏返回正常').toBe(true);
  });

  it('验收5｜More 卡片几何来自唯一布局源 contentRect（不散落 Garage 几何）', () => {
    const env = makeHost({ w: 844, h: 390 }, INSETS);
    goMore(env);
    const layout = computeMobileGarageLayout({ w: 844, h: 390 }, INSETS);
    const c = layout.contentRect;
    for (const id of ['more:task', 'more:shop', 'more:pass', 'more:settings']) {
      const a = env.areas().find((x) => x.id === id)!;
      expect(a.x, `${id} 在 contentRect 内`).toBeGreaterThanOrEqual(c.x);
      expect(a.x + a.w, `${id} 在 contentRect 内`).toBeLessThanOrEqual(c.x + c.w + 0.5);
      expect(a.y, `${id} 在 contentRect 内`).toBeGreaterThanOrEqual(c.y);
      expect(a.y + a.h, `${id} 在 contentRect 内`).toBeLessThanOrEqual(c.y + c.h + 0.5);
    }
  });
});
