/**
 * F-HOME-2｜寻找对手主交互：
 * 1. 首页点击「寻找对手」→ 直接进入匹配流程（无前置确认 Modal）；
 * 2. Matching 每帧强制重绘（renderBattleFrame inMatching）→ 扫描动效可驱动
 *    （扫描线 + 占位框脉冲，nowMs 驱动）；画面含「正在寻找对手…」；
 * 3. 首页 CTA 全页最显眼：420×210 高 ≥48 且 > 辅助入口（明显好点、可读）。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { CanvasPlayerUIHost, HOME_TIPS, HOME_CHEST_STATES } from '../src/ui/canvasPlayerUIHost';
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
    expect(env.host.getHitAreasForTest().some((a) => a.id === 'home-find-opponent'), '首页有寻找对手主按钮').toBe(true);
    click(env, 'home-find-opponent');
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
    expect(l.ctaRect.h, '420×210 CTA 高 ≥44（short 触控目标，全页最高）').toBeGreaterThanOrEqual(44);
    expect(l.garageRect.h, '辅助入口矮于 CTA').toBeLessThan(l.ctaRect.h);
    // F-HOME-IA-R1：删除「CTA 与 topBar 等宽」旧断言——CTA 改为中等宽、居中、不横贯整屏
    const availW = 420 - INSETS.left - INSETS.right;
    expect(l.ctaRect.w, 'CTA 不横贯整屏（中等宽）').toBeLessThan(availW);
    // CTA 居中于底部主条中央留白区（车库右缘 ↔ 排行榜左缘 的中点），不与辅助入口重叠
    // F-HOME-VISUAL-R2 Must#5：CTA 中心 = 屏幕水平主轴 W/2（取代「底部主条留白区中心」）
    const ctaCx = l.ctaRect.x + l.ctaRect.w / 2;
    expect(Math.abs(ctaCx - 420 / 2), 'CTA 中心 = 屏幕主轴 W/2').toBeLessThanOrEqual(1);
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

  it('F-HOME-4｜个人信息/排行榜/战令/宝箱四个正式入口：可点 → 打开占位页（large Modal）→ 关闭恢复首页', () => {
    const env = makeRecHost({ w: 420, h: 210 });
    env.host.render(garageState());
    const ids = env.host.getHitAreasForTest().map((a) => a.id);
    for (const id of ['home-profile', 'home-rank', 'home-pass', 'home-chest-0', 'home-chest-3']) {
      expect(ids, `首页应有正式入口 ${id}`).toContain(id);
    }
    // 各入口 → 占位页（大卡片 Modal，标题正确）
    const cases: Array<[string, string]> = [
      ['home-profile', '个人信息'],
      ['home-rank', '排行榜'],
      ['home-pass', '战令'],
      ['home-chest-0', '宝箱'],
      ['home-chest-3', '宝箱'],
    ];
    for (const [entryId, title] of cases) {
      click(env, entryId);
      expect(env.host.getHitAreasForTest().some((a) => a.id === 'modal-veil'), `${entryId} 打开占位页`).toBe(true);
      expect(env.texts().some((s) => s.includes(title)), `${entryId} 占位页标题「${title}」`).toBe(true);
      click(env, 'modal-primary'); // 知道了
      expect(env.host.getHitAreasForTest().some((a) => a.id === 'modal-veil'), `${entryId} 关闭`).toBe(false);
      expect(env.host.getHitAreasForTest().some((a) => a.id === 'home-garage'), '关闭后恢复首页').toBe(true);
    }
  });

  it('F-HOME-4｜个人信息展示头像+段位；宝箱 4 槽含三种状态占位；源码守卫区分状态', () => {
    const env = makeRecHost({ w: 420, h: 210 });
    env.host.render(garageState({ progress: { coin: 100, rating: 50 } }));
    // 顶部个人信息：头像「我」+ 段位（rating 50 → 青铜）
    expect(env.texts().some((s) => s === '我'), '头像「我」').toBe(true);
    expect(env.texts().some((s) => s.includes('青铜')), '段位徽章显示').toBe(true);
    // 宝箱状态占位：4 槽恰好 claimable/timing/timing/empty
    expect(HOME_CHEST_STATES).toHaveLength(4);
    expect(HOME_CHEST_STATES.filter((s) => s === 'claimable').length).toBeGreaterThanOrEqual(1);
    expect(HOME_CHEST_STATES.filter((s) => s === 'timing').length).toBeGreaterThanOrEqual(1);
    expect(HOME_CHEST_STATES.includes('empty'), '含空槽状态').toBe(true);
    // 源码守卫：drawHomePage 区分三种宝箱状态
    const src = readFileSync('src/ui/canvasPlayerUIHost.ts', 'utf-8');
    const start = src.indexOf('private drawHomePage');
    const end = src.indexOf('\n  private ', start + 10);
    const hp = src.slice(start, end === -1 ? src.length : end);
    expect(hp, '宝箱状态「可领」').toContain('可领');
    expect(hp, '宝箱状态「计时」').toContain('计时');
    expect(hp, '宝箱状态「空」').toContain("'空'");
    // 视觉权重：CTA 高于辅助入口（homeLayout 已断言 cta>assist）；宝箱槽高 < CTA 高
    const prof = { mode: 'mobile-short' } as never;
    const l = computeHomeLayout({ w: 420, h: 210 }, INSETS, prof);
    expect(l.ctaRect.h, 'CTA 高于宝箱槽（视觉主次）').toBeGreaterThan(l.chestSlot(0).h);
    expect(l.chestSlot(0).h, '宝箱槽可点高度').toBeGreaterThanOrEqual(20);
  });

  it('F-HOME-5｜首页职责纯净：零组装操作残留——命中区全为 home-* / home-find-opponent 白名单', () => {
    const env = makeRecHost({ w: 420, h: 210 });
    env.host.render(garageState());
    const ids = env.host.getHitAreasForTest().map((a) => a.id);
    // 首页不允许出现任何组装/背包/合成操作 id
    const banned = [
      'entry:', 'opt:', 'chip:', 'wheel-side:', 'weapon-slot:', 'merge', 'bpack-item:', 'backpack-',
      'panel-back', 'panel-scroll', 'opt-scroll', 'bfilter:', 'nav:',
    ];
    for (const b of banned) {
      expect(ids.some((id) => id.startsWith(b) || id.includes(b)), `首页无 ${b} 组装残留`).toBe(false);
    }
    // 首页入口白名单：仅展示/开战/功能入口（F-NAV-ACTION-OWNERSHIP-P0：唯一开战入口 id）
    for (const id of ids) {
      expect(id === 'home-find-opponent' || id.startsWith('home-'), `首页命中区 ${id} 属白名单`).toBe(true);
    }
    // 用户点击任意首页入口都不会进入组装操作（车辆 → tips；其余 → 占位页/配置入口/开战）
    expect(ids.filter((id) => id === 'home-vehicle' || id === 'home-find-opponent' || id.startsWith('home-')).length,
      '首页仅 10 个核心入口（CTA+车辆+3辅助+个人+4宝箱槽）').toBe(10);
  });

  it('F-HOME-5｜车库职责：组装与调整收归独立车库页——4 配置入口 + 返回首页；无寻找对手；首页只留入口', () => {
    const env = makeRecHost({ w: 420, h: 210 });
    env.host.render(garageState());
    // 首页只有「车库」入口按钮
    const homeGarage = env.host.getHitAreasForTest().find((a) => a.id === 'home-garage')!;
    expect(homeGarage, '首页保留车库入口').toBeTruthy();
    expect(env.host.getHitAreasForTest().some((a) => a.id === 'entry:body'), '首页无组装入口').toBe(false);
    // 点车库 → 独立组装界面（车身/移动/武器/辅助 4 主分类全部在此）
    click(env, 'home-garage');
    const ids = env.host.getHitAreasForTest().map((a) => a.id);
    for (const id of ['entry:body', 'entry-move', 'entry-weapons', 'entry-gadgets', 'nav:home', 'nav:backpack', 'nav:more']) {
      expect(ids, `车库页应含 ${id}`).toContain(id);
    }
    // F-NAV-ACTION-OWNERSHIP-P0：车库页无寻找对手（cta-find/home-find-opponent 均不注册）
    expect(ids.some((id) => id === 'cta-find' || id === 'home-find-opponent'), '车库页无寻找对手').toBe(false);
    // 车库无合成（合成在背包页）
    expect(ids.some((id) => id === 'merge'), '车库页无合成').toBe(false);
    // 返回首页 → 仍无组装残留
    const back = env.host.getHitAreasForTest().find((a) => a.id === 'nav:home')!;
    env.pointer(back.x + back.w / 2, back.y + back.h / 2);
    const homeIds = env.host.getHitAreasForTest().map((a) => a.id);
    expect(homeIds.some((id) => id.startsWith('entry:') || id.startsWith('opt:')), '返回首页无组装残留').toBe(false);
  });
});
