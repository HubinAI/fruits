import { describe, it, expect } from 'vitest';
import { CanvasPlayerUIHost } from '../src/ui/canvasPlayerUIHost';
import { computeMobileGarageLayout } from '../src/ui/mobileGarageLayout';
import { bindPlatformCore } from '../src/platform/context';
import { createWebCore } from '../src/platform/web';
import { makeStarterDraft } from '../src/lab/buildEditorModel';
import { registry } from '../src/core/content';
import { getInventory, OFFICIAL_PARTS } from '../src/core/partInventory';
import type { SafeInsets } from '../src/platform/types';
import type { PlayerUIState } from '../src/ui/playerUI';

/**
 * F-META-UX1｜删除顶部大导航，Garage 回归唯一 Home：
 * 1. Garage 首屏无三等分顶部导航（nav 行删除；背包/更多为装配区内次级入口，弱于「寻找对手」）；
 * 2. Backpack / More 打开后顶部只提供「← 返回车库」（无全局 Tab），均可进入并返回；
 * 3. 621×351 内容区比旧版（含 nav 行）至少多 48px 高度；
 * 4. Garage 现有功能不回归（2×2 主分类 + CTA 可用）；Battle 状态不残留局外元素。
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

describe('F-META-UX1｜Garage 唯一 Home（删全局导航）', () => {
  it('验收1｜Garage 首屏无三等分顶部导航：背包/更多是装配区内次级入口（弱于 CTA），可进入并返回', () => {
    const env = makeHost({ w: 844, h: 390 }, INSETS);
    const s = garageState();
    env.host.render(s);
    // Garage 只有 2 个次级入口（nav:backpack/nav:more），无 nav:garage（Garage 是 Home，无需返回）
    const navIds = env.areas().filter((a) => a.id.startsWith('nav:')).map((a) => a.id);
    expect(navIds.sort(), 'Garage 无三等分导航，仅装配区内背包/更多次级入口').toEqual(['nav:backpack', 'nav:more']);
    expect(env.areas().some((a) => a.id === 'entry:body'), 'garage 页有车身入口').toBe(true);
    expect(env.areas().some((a) => a.id === 'cta-find'), 'garage 页有 CTA').toBe(true);
    // 次级入口在装配面板底部区域（y ≥ panelRect 内 2×2 卡片区之后），且高 ≥48
    const layout = computeMobileGarageLayout({ w: 844, h: 390 }, INSETS);
    const subBp = env.areas().find((a) => a.id === 'nav:backpack')!;
    const subMore = env.areas().find((a) => a.id === 'nav:more')!;
    expect(subBp.h, '次级入口高 ≥48').toBeGreaterThanOrEqual(48);
    expect(subMore.h, '次级入口高 ≥48').toBeGreaterThanOrEqual(48);
    expect(subBp.y, '次级入口在面板底部区域').toBeGreaterThanOrEqual(layout.panelRect.y + layout.panelRect.h - 70);
    expect(subBp.y, '次级入口在 CTA 上方（不与 CTA 重叠）').toBeLessThan(layout.ctaRect.y);
    // 次级入口明显弱于「寻找对手」：CTA 宽 ≥ 两次级入口宽之和
    const cta = env.areas().find((a) => a.id === 'cta-find')!;
    expect(cta.w, 'CTA 宽 ≥ 两个次级入口宽之和').toBeGreaterThanOrEqual(subBp.w + subMore.w + 8);
    // 点「背包」→ backpack 页：顶部有「← 返回车库」，无全局 Tab（无 nav:backpack/nav:more）
    click(env, 'nav:backpack');
    expect(env.areas().some((a) => a.id === 'nav:garage'), 'backpack 页有返回车库').toBe(true);
    expect(env.areas().some((a) => a.id === 'nav:backpack' || a.id === 'nav:more'), 'backpack 页无全局 Tab').toBe(false);
    expect(env.areas().some((a) => a.id === 'entry:body'), 'backpack 页无车身入口').toBe(false);
    // 返回车库
    click(env, 'nav:garage');
    expect(env.areas().some((a) => a.id === 'entry:body'), '返回后 garage 恢复').toBe(true);
    expect(env.areas().some((a) => a.id === 'cta-find'), '返回后 CTA 恢复').toBe(true);
    // 点「更多」→ more 页：顶部有「← 返回车库」，无全局 Tab
    click(env, 'nav:more');
    expect(env.areas().some((a) => a.id === 'nav:garage'), 'more 页有返回车库').toBe(true);
    expect(env.areas().some((a) => a.id === 'nav:backpack' || a.id === 'nav:more'), 'more 页无全局 Tab').toBe(false);
    click(env, 'nav:garage');
    expect(env.areas().some((a) => a.id === 'entry:body'), '更多返回后 garage 恢复').toBe(true);
  });

  it('验收2｜621×351 内容区比旧版至少多 48px；Garage 无三等分导航；Shell 几何仍来自唯一布局源', () => {
    const env = makeHost({ w: 621, h: 351 }, INSETS);
    env.host.render(garageState());
    const layout = computeMobileGarageLayout({ w: 621, h: 351 }, INSETS);
    // 内容区直接位于顶栏下方（旧版含 nav 行 → 顶 = topBar+34+8+48+8=110；新版 = 54）
    expect(layout.contentRect.y, '内容区顶 = topBar 下方').toBe(layout.topBarRect.y + layout.topBarRect.h + 8);
    const oldBodyTop = INSETS.top + 34 + 8 + 48 + 8;
    const gain = oldBodyTop - layout.contentRect.y;
    expect(gain, '621×351 内容区比旧版多 ≥48px').toBeGreaterThanOrEqual(48);
    // Garage 首屏无三等分导航（无 nav:garage；仅 2 个次级入口）
    expect(env.areas().some((a) => a.id === 'nav:garage'), 'Garage 无返回车库按钮').toBe(false);
    expect(env.areas().filter((a) => a.id.startsWith('nav:')).length, 'Garage 仅 2 个次级入口').toBe(2);
    // 次级入口在面板底部且不与 CTA 重叠（621 小屏）
    const sub = env.areas().find((a) => a.id === 'nav:more')!;
    expect(sub.y + sub.h, '次级入口底 ≤ CTA 顶').toBeLessThanOrEqual(layout.ctaRect.y);
    expect(sub.y, '次级入口 y ≥ panel 顶').toBeGreaterThanOrEqual(layout.panelRect.y);
  });

  it('验收3｜Garage 职责纯化（只配置/开战，无合成）；Backpack 合成走 Modal 且可返回', () => {
    const env = makeHost({ w: 844, h: 390 }, INSETS);
    env.host.render(richState());
    // Garage 只处理配置：2×2 入口 + CTA 可用
    const entry = env.areas().find((a) => a.id === 'entry:body')!;
    expect(entry.h, '入口高 ≥48').toBeGreaterThanOrEqual(48);
    expect(env.areas().some((a) => a.id === 'cta-find'), 'Garage 有 CTA').toBe(true);
    expect(env.areas().some((a) => a.id === 'merge'), 'Garage 无任何合成入口').toBe(false);
    // 装配区次级入口 → Backpack：合成入口 → Modal（不切换全屏页面）→ 取消 → 返回车库
    click(env, 'nav:backpack');
    const merge = env.areas().find((a) => a.id === 'merge')!;
    expect(merge.h, '合成入口高 ≥48').toBeGreaterThanOrEqual(48);
    click(env, 'merge');
    expect(env.areas().some((a) => a.id === 'modal-veil'), '合成 Modal 出现（不再是全屏面板）').toBe(true);
    expect(env.areas().some((a) => a.id === 'modal-primary'), '合成主按钮出现').toBe(true);
    click(env, 'modal-secondary'); // 取消（metaShell 无 onMerge 实现，不派发）
    expect(env.areas().some((a) => a.id === 'modal-veil'), '合成 Modal 关闭').toBe(false);
    expect(env.areas().some((a) => a.id === 'merge'), '仍停留 Backpack').toBe(true);
    // 顶部「← 返回车库」→ 回 Garage（仍无合成）
    click(env, 'nav:garage');
    expect(env.areas().some((a) => a.id === 'entry:body'), '返回后 garage 恢复').toBe(true);
    expect(env.areas().some((a) => a.id === 'merge'), '回 Garage 仍无合成').toBe(false);
  });

  it('验收4｜Battle 状态不残留局外元素；回 Garage 默认回车库页（Home）', () => {
    const env = makeHost({ w: 844, h: 390 }, INSETS);
    // 先进 Backpack，验证离开局外后复位
    env.host.render(garageState());
    click(env, 'nav:backpack');
    expect(env.areas().some((a) => a.id === 'entry:body'), 'backpack 页无入口').toBe(false);
    // 进入 matching（离开 garage）→ 无任何局外元素（无 nav 次级入口 / 配置入口）
    env.host.render(garageState({ playerPhase: 'matching', battleState: 'editing' }));
    expect(env.areas().some((a) => a.id.startsWith('nav:')), 'matching 无局外导航/次级入口').toBe(false);
    expect(env.areas().some((a) => a.id.startsWith('entry:')), 'matching 无配置入口').toBe(false);
    // 回 garage → metaPage 已复位为 garage（默认回车库页 Home）
    env.host.render(garageState());
    expect(env.areas().some((a) => a.id === 'entry:body'), '回 garage 显示车库页').toBe(true);
    expect(env.areas().some((a) => a.id === 'cta-find'), '回 garage 显示 CTA').toBe(true);
    // 再进 battle（fighting）→ 仍无局外元素
    env.host.render(garageState({ playerPhase: 'matchPreview', battleState: 'fighting' }));
    expect(env.areas().some((a) => a.id.startsWith('nav:')), 'battle 无局外导航/次级入口').toBe(false);
  });
});
