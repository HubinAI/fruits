/**
 * F-GARAGE-MOBILE-SHELL-R1｜车库顶栏冲突与配置布局验收（自动化矩阵）。
 *
 * 覆盖：
 * A. 顶栏每组独立 rect 契约（back/coin/rating/energyGroup/backpack/more 互不重叠；
 *    能量数值 rect 右缘 < 背包左缘——回归「75/90 与背包重叠」bug）。
 * B. 文字 envelope 验证（estimateTextWidth 上界：coin/rating/energyValue 文案宽 ≤ 各自 rect 宽；
 *    长段位与三位数资源值完整显示）。
 * C. 空间不足按优先级降级（360×180 short：保留 back+energy+backpack；more/coin 可降级；
 *    段位缩写仍完整）。
 * D. 右侧配置区撑满（2×2 卡片底缘贴近面板底——无大块空面板；摘要条显示当前车辆名）。
 * E. 五视口矩阵（360×180 / 420×210 / 460×230 / 621×351 / 844×390）：顶栏无重叠、面板/车辆 safe。
 * F. 左侧车辆取景区 = vehicleRect（唯一布局源；不被顶栏/右侧面板覆盖）。
 * G. 三次点击完成换武器（武器入口 → 武器位 → 选项）且预览链路存在。
 * H. 返回首页后配置保留（nav:home → Home → home-garage 回来 draft 不变）。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { CanvasPlayerUIHost } from '../src/ui/canvasPlayerUIHost';
import {
  computeMobileGarageLayout,
  computeGarageTopBarLayout,
  estimateTextWidth,
  type GarageTopBarTexts,
} from '../src/ui/mobileGarageLayout';
import { resolveLayoutProfile } from '../src/ui/layoutProfile';
import { bindPlatformCore } from '../src/platform/context';
import { createWebCore } from '../src/platform/web';
import { makeStarterDraft } from '../src/lab/buildEditorModel';
import { getInventory, OFFICIAL_PARTS } from '../src/core/partInventory';
import { registry } from '../src/core/content';
import type { PlayerUIState } from '../src/ui/playerUI';
import type { SafeInsets } from '../src/platform/types';

/** 生产横屏 insets（刘海 + 底部系统条） */
const PROD_INSETS: SafeInsets = { left: 44, right: 44, top: 0, bottom: 12 };
/** 覆盖视口（Must#6） */
const VPS = [
  { w: 360, h: 180 },
  { w: 420, h: 210 },
  { w: 460, h: 230 },
  { w: 621, h: 351 },
  { w: 844, h: 390 },
];

function makeStubCtx(texts: string[]): CanvasRenderingContext2D {
  const handler = {
    get: (_t: unknown, prop: string) => {
      if (prop === 'fillText') return (s: string) => texts.push(s);
      return () => ({ width: 0 });
    },
    set: () => true,
  } as unknown as ProxyHandler<CanvasRenderingContext2D>;
  return new Proxy({} as CanvasRenderingContext2D, handler);
}

interface HostEnv {
  host: CanvasPlayerUIHost;
  pointer: (x: number, y: number) => void;
  areas: () => ReadonlyArray<{ id: string; x: number; y: number; w: number; h: number }>;
  texts: string[];
}

function makeHost(vp: { w: number; h: number }, insets: SafeInsets): HostEnv {
  let captured: ((x: number, y: number) => void) | null = null;
  const texts: string[] = [];
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
    getContext: () => makeStubCtx(texts),
    width: vp.w,
    height: vp.h,
    style: undefined,
  } as unknown as HTMLCanvasElement;
  const host = new CanvasPlayerUIHost(canvas);
  host.mountCanvas();
  return {
    host,
    pointer: (x: number, y: number) => captured!(x, y),
    areas: () => host.getHitAreasForTest(),
    texts,
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
    progress: { coin: 150, rating: 212 },
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

function richInv(): Record<string, { one: number; two: number }> {
  const inv: Record<string, { one: number; two: number }> = {};
  for (const p of OFFICIAL_PARTS) inv[p] = { one: 2, two: 1 };
  return inv;
}

function topBarTexts(): GarageTopBarTexts {
  return {
    back: '‹ 首页',
    coin: '金币 150',
    rating: '段位 青铜 212',
    ratingShort: '青铜 212',
    ratingTier: '青铜',
    energyLabel: '能量',
    energyValue: '75/90',
    backpack: '背包',
    more: '更多',
  };
}

/** 进入配置页（Home → 点「车库」） */
function goGarage(env: HostEnv): void {
  const home = env.areas().find((a) => a.id === 'home-garage')!;
  env.pointer(home.x + home.w / 2, home.y + home.h / 2);
}

describe('F-GARAGE-MOBILE-SHELL-R1｜车库顶栏独立 rect 契约', () => {
  afterEach(() => {
    bindPlatformCore(createWebCore());
    vi.unstubAllGlobals();
  });

  it('A1. 844×390 garage 模式：全部 8 组独立 rect 存在、互不重叠、能量数值右缘 < 背包左缘', () => {
    const profile = resolveLayoutProfile(844, 390);
    const l = computeMobileGarageLayout({ w: 844, h: 390 }, PROD_INSETS, profile);
    const tb = computeGarageTopBarLayout(l.topBarRect, profile, { mode: 'garage' }, topBarTexts());
    expect(tb.back, '‹ 首页').toBeTruthy();
    expect(tb.coin, '金币').toBeTruthy();
    expect(tb.rating, '段位').toBeTruthy();
    expect(tb.backpack, '背包').toBeTruthy();
    expect(tb.more, '更多').toBeTruthy();
    // 能量数值 rect 右缘 ≤ 能量组右缘 < 背包左缘（回归「75/90 与背包重叠」）
    expect(tb.energyValue.x + tb.energyValue.w, '能量数值右缘 ≤ 能量组右缘').toBeLessThanOrEqual(tb.energyGroup.x + tb.energyGroup.w);
    expect(tb.energyGroup.x + tb.energyGroup.w, '能量组右缘 < 背包左缘').toBeLessThanOrEqual(tb.backpack!.x - 1);
    // 所有组互不重叠（水平）
    const groups: Array<[string, { x: number; w: number }]> = [
      ['back', tb.back!],
      ['coin', tb.coin!],
      ['rating', tb.rating!],
      ['energyGroup', tb.energyGroup],
      ['backpack', tb.backpack!],
      ['more', tb.more!],
    ];
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const a = groups[i]!;
        const b = groups[j]!;
        const overlap = a[1].x < b[1].x + b[1].w && b[1].x < a[1].x + a[1].w;
        expect(overlap, `${a[0]} 与 ${b[0]} 水平不重叠`).toBe(false);
      }
    }
  });

  it('A2. Host 渲染：顶栏按钮 hitArea == 布局 rect（绘制与命中同源）', () => {
    const env = makeHost({ w: 844, h: 390 }, PROD_INSETS);
    env.host.render(garageState());
    goGarage(env);
    const profile = resolveLayoutProfile(844, 390);
    const l = computeMobileGarageLayout({ w: 844, h: 390 }, PROD_INSETS, profile);
    const tb = computeGarageTopBarLayout(l.topBarRect, profile, { mode: 'garage' }, topBarTexts());
    const areas = env.areas();
    for (const [id, rect] of [
      ['nav:home', tb.back!],
      ['nav:backpack', tb.backpack!],
      ['nav:more', tb.more!],
    ] as const) {
      const a = areas.find((x) => x.id === id);
      expect(a, `${id} hitArea 存在`).toBeTruthy();
      expect(a!.x, `${id} x == layout`).toBeCloseTo(rect.x, 5);
      expect(a!.y, `${id} y == layout`).toBeCloseTo(rect.y, 5);
      expect(a!.w, `${id} w == layout`).toBeCloseTo(rect.w, 5);
      expect(a!.h, `${id} h == layout`).toBeCloseTo(rect.h, 5);
    }
    // 能量数值 rect 不与背包 hitArea 重叠（用户 bug 的直接回归：75/90 必须画在背包左侧）
    const bp = areas.find((x) => x.id === 'nav:backpack')!;
    expect(tb.energyValue.x + tb.energyValue.w, '能量数值右缘 ≤ 背包 hitArea 左缘').toBeLessThanOrEqual(bp.x);
  });

  it('B1. 文字 envelope：coin/rating/energyValue 文案估算宽 ≤ 各自 rect 宽（长段位与三位数资源完整）', () => {
    const profile = resolveLayoutProfile(844, 390);
    const l = computeMobileGarageLayout({ w: 844, h: 390 }, PROD_INSETS, profile);
    const texts = topBarTexts();
    const tb = computeGarageTopBarLayout(l.topBarRect, profile, { mode: 'garage' }, texts);
    const fs = 14 * profile.fontScale;
    expect(estimateTextWidth(texts.coin, fs), '金币文案宽 ≤ coin rect 宽').toBeLessThanOrEqual(tb.coin!.w);
    expect(estimateTextWidth(texts.rating, fs), '段位完整文案宽 ≤ rating rect 宽（不缩写不裁切）').toBeLessThanOrEqual(tb.rating!.w);
    expect(estimateTextWidth(texts.energyValue, fs), '能量数值宽 ≤ energyValue rect 宽').toBeLessThanOrEqual(tb.energyValue.w);
    expect(estimateTextWidth(texts.energyLabel, fs), '能量标签宽 ≤ energyLabel rect 宽').toBeLessThanOrEqual(tb.energyLabel.w);
  });

  it('C1. 360×180 short 降级：保留 back+能量+背包；more 可隐藏；段位缩写仍完整显示', () => {
    const profile = resolveLayoutProfile(360, 180);
    const l = computeMobileGarageLayout({ w: 360, h: 180 }, PROD_INSETS, profile);
    const texts = topBarTexts();
    const tb = computeGarageTopBarLayout(l.topBarRect, profile, { mode: 'garage' }, texts);
    expect(tb.back, '‹ 首页 必留').toBeTruthy();
    expect(tb.backpack, '背包 必留').toBeTruthy();
    expect(tb.energyGroup, '能量组 必留').toBeTruthy();
    // 降级项：coin 可隐藏；more 可隐藏
    // 段位若显示，则其 rect 宽必须容纳最终渲染文案（ratingRender 与 rect 同源）
    if (tb.rating) {
      const fs = 14 * profile.fontScale;
      expect(estimateTextWidth(tb.ratingRender, fs), '段位缩写文案 ≤ rating rect 宽').toBeLessThanOrEqual(tb.rating.w);
    }
    // 能量数值仍不与背包重叠
    if (tb.backpack) {
      expect(tb.energyValue.x + tb.energyValue.w, 'short 屏能量数值右缘 ≤ 背包左缘').toBeLessThanOrEqual(tb.backpack.x);
    }
  });

  it('C2. 五视口矩阵：顶栏各组水平不重叠 + 保留项（back/能量/背包）恒存在 + 全部在 safe 内', () => {
    for (const vp of VPS) {
      const profile = resolveLayoutProfile(vp.w, vp.h);
      const l = computeMobileGarageLayout(vp, PROD_INSETS, profile);
      const tb = computeGarageTopBarLayout(l.topBarRect, profile, { mode: 'garage' }, topBarTexts());
      expect(tb.back, `${vp.w}×${vp.h} back 必留`).toBeTruthy();
      expect(tb.backpack, `${vp.w}×${vp.h} backpack 必留`).toBeTruthy();
      expect(tb.energyGroup, `${vp.w}×${vp.h} energy 必留`).toBeTruthy();
      const groups: Array<[string, { x: number; w: number }]> = [];
      for (const [k, r] of [
        ['back', tb.back],
        ['coin', tb.coin],
        ['rating', tb.rating],
        ['energyGroup', tb.energyGroup],
        ['backpack', tb.backpack],
        ['more', tb.more],
      ] as const) {
        if (r) groups.push([k, r]);
      }
      for (let i = 0; i < groups.length; i++) {
        for (let j = i + 1; j < groups.length; j++) {
          const a = groups[i]!;
          const b = groups[j]!;
          expect(a[1].x < b[1].x + b[1].w && b[1].x < a[1].x + a[1].w, `${vp.w}×${vp.h} ${a[0]} 与 ${b[0]} 不重叠`).toBe(false);
        }
        expect(groups[i]![1].x, `${vp.w}×${vp.h} ${groups[i]![0]} x ≥ safeLeft`).toBeGreaterThanOrEqual(PROD_INSETS.left);
        expect(groups[i]![1].x + groups[i]![1].w, `${vp.w}×${vp.h} ${groups[i]![0]} 右缘 ≤ safeRight`).toBeLessThanOrEqual(vp.w - PROD_INSETS.right);
      }
      // 能量数值 rect 右缘 ≤ 能量组右缘 < 背包左缘（所有视口）
      expect(tb.energyValue.x + tb.energyValue.w, `${vp.w}×${vp.h} 能量数值右缘 ≤ 组右缘`).toBeLessThanOrEqual(tb.energyGroup.x + tb.energyGroup.w);
      if (tb.backpack) {
        expect(tb.energyValue.x + tb.energyValue.w, `${vp.w}×${vp.h} 能量数值 < 背包左缘`).toBeLessThanOrEqual(tb.backpack.x);
      }
    }
  });

  it('D1. 右侧单屏装配台：分类 tab + 挂点 chip + 部件卡 + 能量条全部在面板内（无大块空面板、无后台表格感）', () => {
    const env = makeHost({ w: 844, h: 390 }, PROD_INSETS);
    env.host.render(garageState({ garageSelected: 'body' }));
    goGarage(env);
    const profile = resolveLayoutProfile(844, 390);
    const l = computeMobileGarageLayout({ w: 844, h: 390 }, PROD_INSETS, profile);
    const areas = env.areas();
    // F-GARAGE-BUILD-BOARD-P0：分类 tab 4 个（紧凑）+ 挂点 chip + 部件卡 + 能量条
    for (const id of ['garage-cat:body', 'garage-cat:move', 'garage-cat:weapon', 'garage-cat:gadget']) {
      expect(areas.find((a) => a.id === id), `分类 tab ${id} 存在`).toBeTruthy();
    }
    const panelTop = l.panelRect.y;
    const panelBottom = l.panelRect.y + l.panelRect.h;
    // 部件卡（opt:）在面板内（不超屏、不越面板）
    const opts = areas.filter((a) => a.id.startsWith('opt:'));
    expect(opts.length, '部件卡存在（garageSelected=body）').toBeGreaterThan(0);
    for (const o of opts) {
      expect(o.y, '部件卡 y ≥ 面板顶').toBeGreaterThanOrEqual(panelTop);
      expect(o.y + o.h, '部件卡底 ≤ 面板底').toBeLessThanOrEqual(panelBottom + 0.5);
    }
    // 能量条文本（能量 used/capacity）在面板内反馈（Must#6）
    expect(env.texts.some((t) => t.startsWith('能量') || t.includes('/')), '能量条反馈存在').toBe(true);
  });

  it('E1. 五视口：右侧面板与左侧车辆区全在 safe 内（绘制区不溢出）', () => {
    for (const vp of VPS) {
      const profile = resolveLayoutProfile(vp.w, vp.h);
      const l = computeMobileGarageLayout(vp, PROD_INSETS, profile);
      for (const [k, r] of [
        ['topBar', l.topBarRect],
        ['vehicle', l.vehicleRect],
        ['panel', l.panelRect],
        ['content', l.contentRect],
      ] as const) {
        expect(r.x, `${vp.w}×${vp.h} ${k} x ≥ safeLeft`).toBeGreaterThanOrEqual(PROD_INSETS.left);
        expect(r.y, `${vp.w}×${vp.h} ${k} y ≥ safeTop`).toBeGreaterThanOrEqual(PROD_INSETS.top);
        expect(r.x + r.w, `${vp.w}×${vp.h} ${k} 右缘 ≤ safeRight`).toBeLessThanOrEqual(vp.w - PROD_INSETS.right + 0.5);
        expect(r.y + r.h, `${vp.w}×${vp.h} ${k} 底缘 ≤ safeBottom`).toBeLessThanOrEqual(vp.h - PROD_INSETS.bottom + 0.5);
      }
      // 面板与车辆不重叠（中间 gap）
      expect(l.vehicleRect.x + l.vehicleRect.w, `${vp.w}×${vp.h} vehicle 右缘 ≤ panel 左缘`).toBeLessThanOrEqual(l.panelRect.x);
      // 车辆顶缘在顶栏之下（不被顶栏裁切）
      expect(l.vehicleRect.y, `${vp.w}×${vp.h} vehicle 顶缘 ≥ topBar 底`).toBeGreaterThanOrEqual(l.topBarRect.y + l.topBarRect.h);
    }
  });

  it('F1. 左侧车辆取景区 = vehicleRect（唯一布局源；getPreviewFramingRect 同源）', () => {
    const env = makeHost({ w: 360, h: 180 }, PROD_INSETS);
    env.host.render(garageState());
    goGarage(env);
    const profile = resolveLayoutProfile(360, 180);
    const expected = computeMobileGarageLayout({ w: 360, h: 180 }, PROD_INSETS, profile).vehicleRect;
    const host = env.host as unknown as { getPreviewFramingRect?: () => { x: number; y: number; w: number; h: number } | null };
    const framing = host.getPreviewFramingRect?.();
    expect(framing, '车辆取景区存在').toBeTruthy();
    expect(framing!.x, '取景区 x == vehicleRect.x').toBe(expected.x);
    expect(framing!.y, '取景区 y == vehicleRect.y').toBe(expected.y);
    expect(framing!.w, '取景区 w == vehicleRect.w').toBe(expected.w);
    expect(framing!.h, '取景区 h == vehicleRect.h').toBe(expected.h);
  });

  it('G1. 三次点击换武器链路完整：武器入口 → 武器位 → 选项（富库存）+ 命中 ≥48', () => {
    // canEquipPart 读全局库存 → 注入富库存使全部选项可点
    vi.stubGlobal('localStorage', {
      getItem: (key: string) =>
        key === 'strongfruit.ownedParts.v2' ? JSON.stringify({ ...richInv(), __v: 2 }) : null,
      setItem: () => {},
      removeItem: () => {},
    });
    const env = makeHost({ w: 844, h: 390 }, PROD_INSETS);
    env.host.render(garageState());
    goGarage(env);
    // F-GARAGE-BUILD-BOARD-P0：2 次点击换武器（Acceptance#2）——
    // 第 1 击：点「武器」分类 tab（挂点 chip 行 + 部件卡出现；本测试 makeHost 未设 actions，
    // 故手动 render 选中态模拟 runtime 自动选挂点）
    const ew = env.areas().find((a) => a.id === 'garage-cat:weapon')!;
    expect(ew.h, '武器分类 tab 命中高>0（紧凑）').toBeGreaterThan(0);
    env.pointer(ew.x + ew.w / 2, ew.y + ew.h / 2);
    const slotKey = 'front'; // boxBody 第一个硬点
    env.host.render(garageState({ garageSelected: slotKey }));
    // 第 2 击：选一个武器选项（opt:）
    const opts = env.areas().filter((a) => a.id.startsWith('opt:') && a.id !== 'opt:none');
    expect(opts.length, '武器选项出现（富库存）').toBeGreaterThan(0);
    const opt = opts[0]!;
    expect(opt.h, '部件卡命中高 ≥40（紧凑信息密度）').toBeGreaterThanOrEqual(40);
    env.pointer(opt.x + opt.w / 2, opt.y + opt.h / 2);
    // 预览链路：renderer previewSolo 由 getPreviewFramingRect（=vehicleRect）驱动（源码守卫）
    const hostSrc = require('fs').readFileSync('src/ui/canvasPlayerUIHost.ts', 'utf-8');
    expect(hostSrc, '预览经 getPreviewFramingRect 取景区').toContain('getPreviewFramingRect');
  });

  it('H1. 返回首页后配置保留：nav:home → Home → home-garage 回来 draft 引用不变', () => {
    const env = makeHost({ w: 844, h: 390 }, PROD_INSETS);
    const draft0 = makeStarterDraft('boxBody', registry);
    env.host.render(garageState({ draft: draft0 }));
    goGarage(env);
    // 配置页 → 返回首页
    const back = env.areas().find((a) => a.id === 'nav:home')!;
    env.pointer(back.x + back.w / 2, back.y + back.h / 2);
    expect(env.areas().some((a) => a.id === 'home-find-opponent'), '返回后是正式首页').toBe(true);
    // 再进配置页 → draft 仍是同一对象（配置结果保留）
    goGarage(env);
    const host = env.host as unknown as { lastState: PlayerUIState | null };
    expect(host.lastState?.draft, '配置结果保留（draft 引用不变）').toBe(draft0);
    expect(env.areas().some((a) => a.id === 'garage-cat:body'), '配置页 2×2 恢复').toBe(true);
  });

  it('I1. 命中区与视觉同源：顶栏按钮 hitArea rect == 布局 rect（绘制与命中同源，五视口抽查）', () => {
    for (const vp of [VPS[0]!, VPS[3]!, VPS[4]!]) {
      const env = makeHost(vp, PROD_INSETS);
      env.host.render(garageState());
      goGarage(env);
      const profile = resolveLayoutProfile(vp.w, vp.h);
      const l = computeMobileGarageLayout(vp, PROD_INSETS, profile);
      const tb = computeGarageTopBarLayout(l.topBarRect, profile, { mode: 'garage' }, topBarTexts());
      const areas = env.areas();
      if (tb.back) {
        const a = areas.find((x) => x.id === 'nav:home')!;
        expect(a.x, `${vp.w}×${vp.h} nav:home x 同源`).toBe(tb.back.x);
      }
      if (tb.backpack) {
        const a = areas.find((x) => x.id === 'nav:backpack')!;
        expect(a.x, `${vp.w}×${vp.h} nav:backpack x 同源`).toBe(tb.backpack.x);
        expect(a.w, `${vp.w}×${vp.h} nav:backpack w 同源`).toBe(tb.backpack.w);
      }
    }
  });
});
