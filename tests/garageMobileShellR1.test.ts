/**
 * F-GARAGE-CENTER-STAGE-P0｜车库顶栏极简与中央装配台布局验收（演进自 F-GARAGE-MOBILE-SHELL-R1）。
 *
 * 覆盖：
 * A. 顶栏 garage 模式只保留 首页 + 能量 used/cap（金币/段位/背包/更多不显示——Must#4）；
 *    back/energy 独立 rect 互不重叠；能量数值右缘 ≤ 能量组右缘。
 * B. 文字 envelope 验证（estimateTextWidth 上界：energyLabel/energyValue 文案宽 ≤ 各自 rect 宽）。
 * C. 空间不足按优先级（360×180 short：back + 能量必留）。
 * D. 中央装配台：分类 tab + 部件卡 + 战车挂点 hp-sel 全部位于舞台/装配带；无右侧面板。
 * E. 五视口矩阵（360×180 / 420×210 / 460×230 / 621×351 / 844×390）：顶栏/stage/strip 全 safe；
 *    strip 高占屏幕 27%~34%；stage 全宽；车辆取景 = stageRect（中央）。
 * F. 中央取景区 = stageRect（唯一布局源；getPreviewFramingRect 同源）。
 * G. 换武器链路（战斗分类 → 挂点 → 部件卡）命中完整。
 * H. 返回首页后配置保留（nav:home → Home → home-garage 回来 draft 不变）。
 * I. 命中区与视觉同源（nav:home / 分类 tab 位于装配带内）。
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

describe('F-GARAGE-CENTER-STAGE-P0｜车库顶栏极简（garage 模式只 back+能量）', () => {
  afterEach(() => {
    bindPlatformCore(createWebCore());
    vi.unstubAllGlobals();
  });

  it('A1. 844×390 garage 模式：只 back + energy（coin/rating/backpack/more 为 null）、互不重叠、能量数值右缘 ≤ 组右缘', () => {
    const profile = resolveLayoutProfile(844, 390);
    const l = computeMobileGarageLayout({ w: 844, h: 390 }, PROD_INSETS, profile);
    const tb = computeGarageTopBarLayout(l.topBarRect, profile, { mode: 'garage' }, topBarTexts());
    expect(tb.back, '‹ 首页 存在').toBeTruthy();
    expect(tb.energyGroup, '能量组存在').toBeTruthy();
    // Must#4：金币/段位/背包/更多不在装配页顶栏显示
    expect(tb.coin, '金币不显示').toBeNull();
    expect(tb.rating, '段位不显示').toBeNull();
    expect(tb.backpack, '背包不显示').toBeNull();
    expect(tb.more, '更多不显示').toBeNull();
    // 能量数值右缘 ≤ 能量组右缘（不溢出）
    expect(tb.energyValue.x + tb.energyValue.w, '能量数值右缘 ≤ 能量组右缘').toBeLessThanOrEqual(tb.energyGroup.x + tb.energyGroup.w);
    // back 与 energy 组互不重叠
    expect(tb.back!.x + tb.back!.w, 'back 右缘 ≤ energy 左缘').toBeLessThanOrEqual(tb.energyGroup.x);
  });

  it('A2. Host 渲染：顶栏只注册 nav:home；Garage 内无 nav:backpack / nav:more / 金币段位（Must#4）', () => {
    const env = makeHost({ w: 844, h: 390 }, PROD_INSETS);
    env.host.render(garageState());
    goGarage(env);
    const areas = env.areas();
    expect(areas.find((x) => x.id === 'nav:home'), 'nav:home 存在').toBeTruthy();
    expect(areas.some((x) => x.id === 'nav:backpack'), '装配页无背包入口').toBe(false);
    expect(areas.some((x) => x.id === 'nav:more'), '装配页无更多入口').toBe(false);
  });

  it('B1. 文字 envelope：energyLabel/energyValue 文案估算宽 ≤ 各自 rect 宽', () => {
    const profile = resolveLayoutProfile(844, 390);
    const l = computeMobileGarageLayout({ w: 844, h: 390 }, PROD_INSETS, profile);
    const texts = topBarTexts();
    const tb = computeGarageTopBarLayout(l.topBarRect, profile, { mode: 'garage' }, texts);
    const fs = 14 * profile.fontScale;
    expect(estimateTextWidth(texts.energyValue, fs), '能量数值宽 ≤ energyValue rect 宽').toBeLessThanOrEqual(tb.energyValue.w);
    expect(estimateTextWidth(texts.energyLabel, fs), '能量标签宽 ≤ energyLabel rect 宽').toBeLessThanOrEqual(tb.energyLabel.w);
  });

  it('C1. 360×180 short：back + 能量必留；其余恒 null', () => {
    const profile = resolveLayoutProfile(360, 180);
    const l = computeMobileGarageLayout({ w: 360, h: 180 }, PROD_INSETS, profile);
    const tb = computeGarageTopBarLayout(l.topBarRect, profile, { mode: 'garage' }, topBarTexts());
    expect(tb.back, '‹ 首页 必留').toBeTruthy();
    expect(tb.energyGroup, '能量组 必留').toBeTruthy();
    expect(tb.backpack, '背包不显示').toBeNull();
    expect(tb.more, '更多不显示').toBeNull();
    expect(tb.coin, '金币不显示').toBeNull();
    expect(tb.rating, '段位不显示').toBeNull();
  });

  it('C2. 五视口矩阵：back/能量恒存在 + 组水平不重叠 + 全部在 safe 内', () => {
    for (const vp of VPS) {
      const profile = resolveLayoutProfile(vp.w, vp.h);
      const l = computeMobileGarageLayout(vp, PROD_INSETS, profile);
      const tb = computeGarageTopBarLayout(l.topBarRect, profile, { mode: 'garage' }, topBarTexts());
      expect(tb.back, `${vp.w}×${vp.h} back 必留`).toBeTruthy();
      expect(tb.energyGroup, `${vp.w}×${vp.h} energy 必留`).toBeTruthy();
      const groups: Array<[string, { x: number; w: number }]> = [
        ['back', tb.back!],
        ['energyGroup', tb.energyGroup],
      ];
      for (let i = 0; i < groups.length; i++) {
        for (let j = i + 1; j < groups.length; j++) {
          const a = groups[i]!;
          const b = groups[j]!;
          const overlap = a[1].x < b[1].x + b[1].w && b[1].x < a[1].x + a[1].w;
          expect(overlap, `${vp.w}×${vp.h} ${a[0]} 与 ${b[0]} 水平不重叠`).toBe(false);
        }
        expect(groups[i]![1].x, `${vp.w}×${vp.h} ${groups[i]![0]} x ≥ safeLeft`).toBeGreaterThanOrEqual(PROD_INSETS.left);
        expect(groups[i]![1].x + groups[i]![1].w, `${vp.w}×${vp.h} ${groups[i]![0]} 右缘 ≤ safeRight`).toBeLessThanOrEqual(vp.w - PROD_INSETS.right);
      }
    }
  });

  it('D1. 中央装配台：分类 tab + 部件卡 + 战车挂点全部在舞台/装配带；无右侧面板', () => {
    const env = makeHost({ w: 844, h: 390 }, PROD_INSETS);
    env.host.render(garageState({ garageSelected: 'body' }));
    goGarage(env);
    const profile = resolveLayoutProfile(844, 390);
    const l = computeMobileGarageLayout({ w: 844, h: 390 }, PROD_INSETS, profile);
    const areas = env.areas();
    // 分类 tab 3 个（车身/移动/战斗；武器+辅助合并）全部在底部装配带内
    for (const id of ['garage-cat:body', 'garage-cat:move', 'garage-cat:combat']) {
      const a = areas.find((x) => x.id === id);
      expect(a, `分类 tab ${id} 存在`).toBeTruthy();
      expect(a!.y, `${id} 位于装配带内`).toBeGreaterThanOrEqual(l.stripRect.y);
      expect(a!.y + a!.h, `${id} 不超出装配带`).toBeLessThanOrEqual(l.stripRect.y + l.stripRect.h + 0.5);
    }
    // 部件卡（opt:）在装配带内（不超屏、不越带）
    const opts = areas.filter((a) => a.id.startsWith('opt:'));
    expect(opts.length, '部件卡存在（garageSelected=body）').toBeGreaterThan(0);
    for (const o of opts) {
      expect(o.y, '部件卡 y ≥ 装配带顶').toBeGreaterThanOrEqual(l.stripRect.y);
      expect(o.y + o.h, '部件卡底 ≤ 装配带底').toBeLessThanOrEqual(l.stripRect.y + l.stripRect.h + 0.5);
    }
    // Must#2/Forbidden：无右侧固定面板——右半屏（x ≥ w/2）不得出现全高配置面板
    const rightPanel = areas.filter(
      (a) => a.x >= 844 / 2 - 1 && a.y < 100 && a.y + a.h > 200 && a.w > 150,
    );
    expect(rightPanel.length, '右半屏无固定配置面板').toBe(0);
  });

  it('E1. 五视口：topBar/stage/strip/vehicle 全 safe；stage 全宽；strip 高 27%~34%', () => {
    for (const vp of VPS) {
      const profile = resolveLayoutProfile(vp.w, vp.h);
      const l = computeMobileGarageLayout(vp, PROD_INSETS, profile);
      for (const [k, r] of [
        ['topBar', l.topBarRect],
        ['stage', l.stageRect],
        ['strip', l.stripRect],
        ['vehicle', l.vehicleRect],
      ] as const) {
        expect(r.x, `${vp.w}×${vp.h} ${k} x ≥ safeLeft`).toBeGreaterThanOrEqual(PROD_INSETS.left - 0.5);
        expect(r.y, `${vp.w}×${vp.h} ${k} y ≥ safeTop`).toBeGreaterThanOrEqual(PROD_INSETS.top - 0.5);
        expect(r.x + r.w, `${vp.w}×${vp.h} ${k} 右缘 ≤ safeRight`).toBeLessThanOrEqual(vp.w - PROD_INSETS.right + 0.5);
        expect(r.y + r.h, `${vp.w}×${vp.h} ${k} 底缘 ≤ safeBottom`).toBeLessThanOrEqual(vp.h - PROD_INSETS.bottom + 0.5);
      }
      // Must#2：中央舞台全宽（左右贴 safe 边）
      expect(l.stageRect.x, `${vp.w}×${vp.h} stage x == safeLeft`).toBe(PROD_INSETS.left);
      expect(l.stageRect.x + l.stageRect.w, `${vp.w}×${vp.h} stage 右缘 == safeRight`).toBe(vp.w - PROD_INSETS.right);
      expect(l.vehicleRect, 'vehicleRect == stageRect（中央取景同源）').toEqual(l.stageRect);
      // Must#5：装配带高占屏幕 27%~34%
      const ratio = l.stripRect.h / vp.h;
      expect(ratio, `${vp.w}×${vp.h} strip 高占比 ${(ratio * 100).toFixed(1)}% ≥ 27%`).toBeGreaterThanOrEqual(0.27);
      expect(ratio, `${vp.w}×${vp.h} strip 高占比 ${(ratio * 100).toFixed(1)}% ≤ 34%`).toBeLessThanOrEqual(0.34);
      // 舞台顶缘在顶栏之下（不被顶栏裁切）
      expect(l.stageRect.y, `${vp.w}×${vp.h} stage 顶缘 ≥ topBar 底`).toBeGreaterThanOrEqual(l.topBarRect.y + l.topBarRect.h);
      // 舞台不与装配带重叠
      expect(l.stageRect.y + l.stageRect.h, `${vp.w}×${vp.h} stage 底 ≤ strip 顶`).toBeLessThanOrEqual(l.stripRect.y);
    }
  });

  it('F1. 中央取景区 = stageRect（唯一布局源；getPreviewFramingRect 同源）', () => {
    const env = makeHost({ w: 360, h: 180 }, PROD_INSETS);
    env.host.render(garageState());
    goGarage(env);
    const profile = resolveLayoutProfile(360, 180);
    const expected = computeMobileGarageLayout({ w: 360, h: 180 }, PROD_INSETS, profile).vehicleRect;
    const host = env.host as unknown as {
      getPreviewFramingRect?: () => { x: number; y: number; w: number; h: number; mode?: string } | null;
    };
    const framing = host.getPreviewFramingRect?.();
    expect(framing, '车辆取景区存在').toBeTruthy();
    expect(framing!.x, '取景区 x == vehicleRect.x').toBe(expected.x);
    expect(framing!.y, '取景区 y == vehicleRect.y').toBe(expected.y);
    expect(framing!.w, '取景区 w == vehicleRect.w').toBe(expected.w);
    expect(framing!.h, '取景区 h == vehicleRect.h').toBe(expected.h);
    expect(framing!.mode, '取景区 mode = garage').toBe('garage');
  });

  it('G1. 换武器链路完整：战斗分类 tab → 挂点选中 → 部件卡命中 ≥40', () => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) =>
        key === 'strongfruit.ownedParts.v2' ? JSON.stringify({ ...richInv(), __v: 2 }) : null,
      setItem: () => {},
      removeItem: () => {},
    });
    const env = makeHost({ w: 844, h: 390 }, PROD_INSETS);
    env.host.render(garageState());
    goGarage(env);
    // 第 1 击：点「战斗」分类 tab
    const combat = env.areas().find((a) => a.id === 'garage-cat:combat')!;
    expect(combat.h, '战斗分类 tab 命中高>0').toBeGreaterThan(0);
    env.pointer(combat.x + combat.w / 2, combat.y + combat.h / 2);
    // 模拟 runtime 自动选中第一个挂点（Must#8 默认选择）
    const slotKey = 'front'; // boxBody 第一个硬点
    env.host.render(garageState({ garageSelected: slotKey }));
    // 第 2 击：选一个武器选项（opt:）——部件卡命中高 ≥40
    const opts = env.areas().filter((a) => a.id.startsWith('opt:') && a.id !== 'opt:none');
    expect(opts.length, '战斗部件选项出现（富库存）').toBeGreaterThan(0);
    const opt = opts[0]!;
    expect(opt.h, '部件卡命中高 ≥40').toBeGreaterThanOrEqual(40);
    // 无文字挂点页签（Must#7）：战斗页不存在 garage-cslot:/garage-cgroup: 命中区
    expect(env.areas().some((a) => a.id.startsWith('garage-cslot:')), '无文字挂点 chip').toBe(false);
    expect(env.areas().some((a) => a.id.startsWith('garage-cgroup:')), '无武器/辅助文字分段').toBe(false);
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
    expect(env.areas().some((a) => a.id === 'garage-cat:body'), '配置页装配带恢复').toBe(true);
  });

  it('I1. 命中区与视觉同源：nav:home 顶栏按钮 + 分类 tab 装配带内（绘制与命中同源）', () => {
    for (const vp of [VPS[0]!, VPS[3]!, VPS[4]!]) {
      const env = makeHost(vp, PROD_INSETS);
      env.host.render(garageState());
      goGarage(env);
      const profile = resolveLayoutProfile(vp.w, vp.h);
      const l = computeMobileGarageLayout(vp, PROD_INSETS, profile);
      const tb = computeGarageTopBarLayout(l.topBarRect, profile, { mode: 'garage' }, topBarTexts());
      const areas = env.areas();
      const a = areas.find((x) => x.id === 'nav:home')!;
      expect(a.x, `${vp.w}×${vp.h} nav:home x 同源`).toBe(tb.back!.x);
      expect(a.y, `${vp.w}×${vp.h} nav:home y 同源`).toBe(tb.back!.y);
      for (const id of ['garage-cat:body', 'garage-cat:move', 'garage-cat:combat']) {
        const t = areas.find((x) => x.id === id)!;
        expect(t.y, `${vp.w}×${vp.h} ${id} 在装配带内`).toBeGreaterThanOrEqual(l.stripRect.y);
        expect(t.y + t.h, `${vp.w}×${vp.h} ${id} 不超装配带`).toBeLessThanOrEqual(l.stripRect.y + l.stripRect.h);
      }
    }
  });
});
