/**
 * F-HOME-2｜寻找对手主交互：
 * 1. 首页点击「寻找对手」→ 直接进入匹配流程（无前置确认 Modal）；
 * 2. Matching 每帧强制重绘（renderBattleFrame inMatching）→ 扫描动效可驱动
 *    （扫描线 + 占位框脉冲，nowMs 驱动）；画面含「正在寻找对手…」；
 * 3. 首页 CTA 全页最显眼：420×210 高 ≥48 且 > 辅助入口（明显好点、可读）。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { CanvasPlayerUIHost, HOME_TIPS } from '../src/ui/canvasPlayerUIHost';
import { computeHomeLayout } from '../src/ui/homeLayout';
import { bindPlatformCore } from '../src/platform/context';
import { createWebCore } from '../src/platform/web';
import { makeStarterDraft } from '../src/lab/buildEditorModel';
import { registry } from '../src/core/content';
import { getInventory } from '../src/core/partInventory';
import type { SafeInsets } from '../src/platform/types';
import type { PlayerUIState } from '../src/ui/playerUI';

const INSETS: SafeInsets = { left: 44, right: 20, top: 12, bottom: 16 };

function makeRecCtx(): { ctx: CanvasRenderingContext2D; texts: string[] } {
  const texts: string[] = [];
  const ctx = new Proxy({} as CanvasRenderingContext2D, {
    get: (_t, prop) => {
      if (prop === 'fillText') return (s: string): void => void texts.push(String(s));
      return () => ({ width: 0 });
    },
    set: () => true,
  });
  return { ctx, texts };
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

function makeRecHost(vp: { w: number; h: number }): {
  host: CanvasPlayerUIHost;
  texts: () => string[];
  pointer: (x: number, y: number) => void;
  fired: Record<string, number>;
} {
  const { ctx, texts } = makeRecCtx();
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
      safeInsets: () => INSETS,
    }),
  } as unknown as Parameters<typeof bindPlatformCore>[0]);
  const canvas = {
    getContext: () => ctx,
    width: vp.w,
    height: vp.h,
    style: undefined,
  } as unknown as HTMLCanvasElement;
  const host = new CanvasPlayerUIHost(canvas);
  host.mountCanvas();
  host.setActions({
    onFindOpponent: () => void (fired['find'] = (fired['find'] ?? 0) + 1),
  } as never);
  return {
    host,
    texts: () => texts,
    pointer: (x, y) => captured!(x, y),
    fired,
  };
}

function click(env: ReturnType<typeof makeRecHost>, id: string): void {
  const areas = env.host.getHitAreasForTest();
  const a = areas.find((x) => x.id === id);
  expect(a, `应有 ${id}`).toBeTruthy();
  env.pointer(a!.x + a!.w / 2, a!.y + a!.h / 2);
}

describe('F-HOME-2｜寻找对手主交互', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it('1. 首页点击「寻找对手」直接匹配：派发 find、无前置确认 Modal、画面立即切换（不停留原地）', () => {
    const env = makeRecHost({ w: 420, h: 210 });
    env.host.render(garageState());
    expect(env.host.getHitAreasForTest().some((a) => a.id === 'cta-find'), '首页有寻找对手主按钮').toBe(true);
    click(env, 'cta-find');
    expect(env.fired['find'], 'onFindOpponent 已派发（点击即匹配）').toBe(1);
    expect(env.host.getHitAreasForTest().some((a) => a.id === 'modal-veil'), '无前置确认 Modal').toBe(false);
    // 派发后 runtime 切 matching → Host 渲染 matching 画面（「正在寻找对手…」）
    env.host.render(garageState({ playerPhase: 'matching' }));
    expect(env.texts().some((s) => s.includes('正在寻找对手')), 'matching 画面显示「正在寻找对手」').toBe(true);
  });

  it('2. Matching 每帧重绘（扫描动效可驱动）：连续 renderBattleFrame 每次都重绘；画面含扫描占位', () => {
    const env = makeRecHost({ w: 420, h: 210 });
    env.host.render(garageState({ playerPhase: 'matching' }));
    const before = env.texts().length;
    env.host.renderBattleFrame({
      battleState: 'editing',
      battleStatus: null,
      phaseCountdownText: null,
    });
    const after1 = env.texts().length;
    expect(after1, 'matching 阶段 renderBattleFrame 触发重绘').toBeGreaterThan(before);
    env.host.renderBattleFrame({
      battleState: 'editing',
      battleStatus: null,
      phaseCountdownText: null,
    });
    expect(env.texts().length, '连续帧再次重绘（动画驱动）').toBeGreaterThan(after1);
  });

  it('3. 首页 CTA 全页最显眼：420×210 高 ≥48 且 > 辅助入口；动画/流程源码守卫', () => {
    const prof = { mode: 'mobile-short' } as never;
    const l = computeHomeLayout({ w: 420, h: 210 }, INSETS, prof);
    expect(l.ctaRect.h, '420×210 CTA 高 ≥48').toBeGreaterThanOrEqual(48);
    expect(l.assistRect.h, '辅助入口矮于 CTA').toBeLessThan(l.ctaRect.h);
    expect(l.ctaRect.w, 'CTA 全宽').toBe(l.topBarRect.w);
    // 源码守卫：matching 每帧重绘 + 扫描动效（nowMs 驱动）
    const src = readFileSync('src/ui/canvasPlayerUIHost.ts', 'utf-8');
    const rf = src.slice(src.indexOf('renderBattleFrame('), src.indexOf('getHitAreasForTest'));
    expect(rf, 'Matching 阶段强制重绘').toContain('inMatching');
    const mcStart = src.indexOf('private drawMatchingContinuum');
    const mcEnd = src.indexOf('\n  private ', mcStart + 10);
    const mc = src.slice(mcStart, mcEnd === -1 ? src.length : mcEnd);
    expect(mc, '扫描动效含脉冲呼吸').toContain('Math.sin(t * 0.012)');
    expect(mc, '扫描动效含扫描线').toContain('this.nowMs');
  });

  it('F-HOME-3｜车辆可点：点击首页车辆 → 随机出现 1 条气泡 tips（每次重新随机）', () => {
    const env = makeRecHost({ w: 420, h: 210 });
    env.host.render(garageState());
    // 车辆区可点（覆盖 vehicleRect 区域）
    const v = env.host.getHitAreasForTest().find((a) => a.id === 'home-vehicle');
    expect(v, '首页车辆区可点').toBeTruthy();
    expect(v!.w, '车辆区宽（不是小缩略图）').toBeGreaterThanOrEqual(200);
    // mock 随机 → 第一条 tips
    vi.spyOn(Math, 'random').mockReturnValue(0);
    click(env, 'home-vehicle');
    expect(env.texts().some((s) => s === HOME_TIPS[0]), '气泡显示随机 tips 第 1 条').toBe(true);
    // 再次点击 → 重新随机（mock 返回 0.5 → 第 10 条左右）
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    click(env, 'home-vehicle');
    const idx = Math.floor(0.5 * HOME_TIPS.length);
    expect(env.texts().some((s) => s === HOME_TIPS[idx]), '再次点击换一条 tips').toBe(true);
  });

  it('F-HOME-3｜≥20 条内置 tips、每条一句话简洁；点别处可关闭气泡', () => {
    expect(HOME_TIPS.length, 'tips ≥20 条').toBeGreaterThanOrEqual(20);
    for (const t of HOME_TIPS) {
      expect(t.length, `tips 每条 ≤24 字（${t}）`).toBeLessThanOrEqual(24);
    }
    // 点车辆出现气泡 → 点其它入口（home-garage 进配置页）→ 气泡随离开消失（vehicleTip 清除）
    const env = makeRecHost({ w: 420, h: 210 });
    env.host.render(garageState());
    vi.spyOn(Math, 'random').mockReturnValue(0);
    click(env, 'home-vehicle');
    expect(env.texts().some((s) => s === HOME_TIPS[0]), '气泡出现').toBe(true);
    click(env, 'home-garage');
    expect(env.host.getHitAreasForTest().some((a) => a.id === 'entry:body'), '已进配置页').toBe(true);
    // 回 Home → 气泡已关闭（返回这次绘制的新增文本不再含 tips 文字）
    const back = env.host.getHitAreasForTest().find((a) => a.id === 'nav:home')!;
    const beforeBack = env.texts().length;
    env.pointer(back.x + back.w / 2, back.y + back.h / 2);
    const added = env.texts().slice(beforeBack);
    expect(added.some((s) => s === HOME_TIPS[0]), '返回后未再画气泡 tips').toBe(false);
    expect(env.host.getHitAreasForTest().some((a) => a.id === 'home-vehicle'), '返回首页车辆可点').toBe(true);
  });
});
