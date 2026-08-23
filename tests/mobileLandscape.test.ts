/**
 * F-WX-6｜手机横屏体验适配验收（自动化矩阵）。
 *
 * 覆盖 viewport：844×390 / 932×430 / 960×540（Compact Mobile）+ 1280×720（Desktop 不退化）。
 * 逐项验收：
 * 1. Garage 关键按钮都在有效 safe area；
 * 2. 所有主交互 hit area 实际尺寸 ≥40px（目标 44~48）；
 * 3. 部件选项不会超出屏幕不可达（横向滚动条 + 边界断言）；
 * 4. Result 两个主要决策完整可点；
 * 5. Battle HUD / READY 渲染不抛（不裁切由 mobileBattleFraming 覆盖）；
 * 6. 横屏 resize 后布局即时更新；
 * 7. Web DOM Host 不退化（1280×720 Desktop 逻辑布局保持原值）；
 * 8. WeChat Canvas Host 与 Web 使用同一 Mobile Layout 规则（mountCanvas == mount 几何一致）。
 *
 * State / Action / Gameplay 完全复用（Host 不决定规则）。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { CanvasPlayerUIHost } from '../src/ui/canvasPlayerUIHost';
import { bindPlatformCore } from '../src/platform/context';
import { createWebCore } from '../src/platform/web';
import { makeStarterDraft } from '../src/lab/buildEditorModel';
import { registry } from '../src/core/content';
import { getInventory, OFFICIAL_PARTS } from '../src/core/partInventory';
import type { PlayerUIState, PlayerUIActions } from '../src/ui/playerUI';
import type { SafeInsets } from '../src/platform/types';

const VIEWPORTS: Array<{ w: number; h: number; mobile: boolean }> = [
  { w: 844, h: 390, mobile: true },
  { w: 932, h: 430, mobile: true },
  { w: 960, h: 540, mobile: true },
  { w: 1280, h: 720, mobile: false },
];

/** 横屏刘海（左侧 notch）+ 底部系统条（模拟） */
const LANDSCAPE_INSETS: SafeInsets = { left: 44, right: 44, top: 0, bottom: 12 };

function makeStubCtx(): CanvasRenderingContext2D {
  const handler = { get: () => () => ({ width: 0 }), set: () => true };
  return new Proxy({} as CanvasRenderingContext2D, handler);
}

interface HostEnv {
  host: CanvasPlayerUIHost;
  fired: Record<string, string[]>;
  pointer: (x: number, y: number) => void;
  canvas: HTMLCanvasElement;
}

/** 建立 host：fake viewport（surface 尺寸/dpr + safeInsets）+ 捕获指针的 fake input */
function makeHost(
  vp: { w: number; h: number },
  insets: SafeInsets = { left: 0, right: 0, top: 0, bottom: 0 },
  dpr = 1,
): HostEnv {
  let captured: ((x: number, y: number) => void) | null = null;
  const fired: Record<string, string[]> = {};
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
      surface: () => ({ width: vp.w, height: vp.h, devicePixelRatio: dpr, now: () => 0 }),
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
  const rec = (k: string) => (v: string) => void (fired[k] = [...(fired[k] ?? []), v]);
  const once = (k: string) => () => void (fired[k] = [...(fired[k] ?? []), 'x']);
  host.setActions({
    onToggleGarageSlot: rec('toggle'),
    onPickGarageOption: rec('pick'),
    onFindOpponent: once('find'),
    onMatchAdjust: once('matchAdjust'),
    onStartBattle: once('startBattle'),
    onResultAdjust: once('resultAdjust'),
    onResultNext: once('next'),
    onClaimRewardAd: once('reward'),
    onMerge: once('merge'),
    onResetProgress: () => {},
  });
  return {
    host,
    fired,
    pointer: (x, y) => captured!(x, y),
    canvas,
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
    progress: { coin: 0, rating: 0 },
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

const RESULT_STATE: PlayerUIState = {
  ...garageState(),
  battleState: 'ended',
  result: { winner: 'A', hpA: 80, hpB: 0 },
  reward: { name: '炮', starStr: '★', cat: '武器', countAfter: 2 },
  economy: { coinDelta: 100, ratingDelta: 10, tierLabel: '青铜', rating: 10, coin: 100 },
  resultOnboardingVisible: false,
  rewardAdAvailable: true,
  rewardAdClaimed: false,
};

/** 全部件拥有（1★×2 + 2★×1）→ 所有功能件选项可装备、合成可发起（merge 非禁用态） */
function richInv(): Record<string, { one: number; two: number }> {
  const inv: Record<string, { one: number; two: number }> = {};
  for (const p of OFFICIAL_PARTS) inv[p] = { one: 2, two: 1 };
  return inv;
}

function richGarageState(over: Partial<PlayerUIState> = {}): PlayerUIState {
  return garageState({
    inventory: richInv() as never,
    progress: { coin: 600, rating: 20 },
    ...over,
  });
}

function areas(env: HostEnv, idPrefix: string) {
  return env.host.getHitAreasForTest().filter((a) => a.id.startsWith(idPrefix));
}

describe('F-WX-6 手机横屏适配（自动化矩阵）', () => {
  afterEach(() => {
    bindPlatformCore(createWebCore());
  });

  it('验收1/2｜Garage 首屏：入口行 + 主 CTA 在有效 safe area + 命中 ≥44px；无部件信息墙', () => {
    for (const vp of VIEWPORTS.filter((v) => v.mobile)) {
      const env = makeHost(vp, LANDSCAPE_INSETS);
      env.host.render(richGarageState()); // 富库存+金币：merge 可点（非禁用态才注册命中）
      const ids = [
        'cta-find',
        'merge',
        'entry:body',
        'entry:rearWheel',
        'entry:frontWheel',
        'entry:drive',
        'entry-weapons',
      ];
      for (const id of ids) {
        const a = env.host.getHitAreasForTest().find((x) => x.id === id);
        expect(a, `${vp.w}×${vp.h} 应有 ${id}`).toBeTruthy();
        expect(a!.h, `${vp.w}×${vp.h} ${id} 命中高 ≥44`).toBeGreaterThanOrEqual(44);
        expect(a!.x, `${id} x 在 safe area 内`).toBeGreaterThanOrEqual(LANDSCAPE_INSETS.left);
        expect(a!.x + a!.w, `${id} 右缘在 safe area 内`).toBeLessThanOrEqual(vp.w - LANDSCAPE_INSETS.right);
        expect(a!.y, `${id} y 在 safe area 内`).toBeGreaterThanOrEqual(LANDSCAPE_INSETS.top);
        expect(a!.y + a!.h, `${id} 底缘在 safe area 内`).toBeLessThanOrEqual(vp.h - LANDSCAPE_INSETS.bottom);
      }
      // F-WX-8-B：首屏不展开完整部件信息墙——无选项、无武器位 chip、无合成面板
      expect(areas(env, 'opt:')).toHaveLength(0);
      expect(areas(env, 'chip:')).toHaveLength(0);
      expect(areas(env, 'merge-confirm')).toHaveLength(0);
      expect(areas(env, 'merge-close')).toHaveLength(0);
      // 「寻找对手」是最大主按钮（宽 > 合成入口宽）
      const cta = env.host.getHitAreasForTest().find((x) => x.id === 'cta-find')!;
      const merge = env.host.getHitAreasForTest().find((x) => x.id === 'merge')!;
      expect(cta.w, 'CTA 宽 > 合成入口宽').toBeGreaterThan(merge.w);
    }
  });

  it('F-WX-8-B｜一次只处理一个配置决策：点入口才展开该类；展开时不混显其它入口/武器位', () => {
    const vp = { w: 844, h: 390 };
    const env = makeHost(vp, LANDSCAPE_INSETS);
    env.host.render(richGarageState());
    // 点「车身」入口 → 派发 onToggleGarageSlot('body') → runtime 侧展开
    const entryBody = env.host.getHitAreasForTest().find((a) => a.id === 'entry:body')!;
    env.pointer(entryBody.x + entryBody.w / 2, entryBody.y + entryBody.h / 2);
    expect(env.fired['toggle']).toContain('body');
    env.host.render(richGarageState({ garageSelected: 'body' }));
    // 展开态：只有 body 选项；入口行/武器位 chip 不再混显
    expect(areas(env, 'opt:').length).toBeGreaterThan(0);
    expect(areas(env, 'entry:')).toHaveLength(0);
    expect(areas(env, 'chip:')).toHaveLength(0);
    // 点「武器」入口 → 展开武器位选择（chip: 功能件槽），无选项
    env.host.render(richGarageState()); // 收起（runtime 选完即收起语义）
    const entryW = env.host.getHitAreasForTest().find((a) => a.id === 'entry-weapons')!;
    env.pointer(entryW.x + entryW.w / 2, entryW.y + entryW.h / 2);
    expect(areas(env, 'chip:').length).toBeGreaterThan(0); // 武器位 chip 出现
    expect(areas(env, 'opt:')).toHaveLength(0); // 尚未选武器位 → 无选项
    expect(areas(env, 'entry:')).toHaveLength(0); // 入口行隐藏
    // 选一个武器位 → 展开该类选项
    const slot = areas(env, 'chip:')[0];
    env.pointer(slot.x + slot.w / 2, slot.y + slot.h / 2);
    expect(env.fired['toggle'].length).toBeGreaterThan(1);
    env.host.render(richGarageState({ garageSelected: slot.id.slice(5) }));
    expect(areas(env, 'opt:').length).toBeGreaterThan(0);
  });

  it('F-WX-8-B｜改一个部件 → 找对手（Mobile Garage 最小闭环）', () => {
    const vp = { w: 844, h: 390 };
    const env = makeHost(vp, LANDSCAPE_INSETS);
    env.host.render(richGarageState());
    // 改部件：点「车身」入口 → 展开 → 点一个选项（fake 记录 pick）→ 收起
    const entryBody = env.host.getHitAreasForTest().find((a) => a.id === 'entry:body')!;
    env.pointer(entryBody.x + entryBody.w / 2, entryBody.y + entryBody.h / 2);
    env.host.render(richGarageState({ garageSelected: 'body' }));
    const opt = areas(env, 'opt:')[0];
    env.pointer(opt.x + opt.w / 2, opt.y + opt.h / 2);
    expect(env.fired['pick'].length).toBe(1);
    // runtime 选完即收起 → 回到入口行
    env.host.render(richGarageState());
    expect(areas(env, 'entry:').length).toBeGreaterThan(0);
    // 找对手
    const cta = env.host.getHitAreasForTest().find((a) => a.id === 'cta-find')!;
    env.pointer(cta.x + cta.w / 2, cta.y + cta.h / 2);
    expect(env.fired['find']).toHaveLength(1);
  });

  it('验收7｜1280×720 Desktop 不退化（Canvas 逻辑布局保持原值）', () => {
    const env = makeHost({ w: 1280, h: 720 });
    env.host.render(garageState());
    const cta = env.host.getHitAreasForTest().find((a) => a.id === 'cta-find');
    expect(cta).toBeTruthy();
    // 旧 Desktop 布局：CTA 位于 1280×720 逻辑底部（y=662, h=44）——不变
    expect(cta!.x).toBe(1280 - 24 - 190);
    expect(cta!.y).toBe(720 - 46 - 12);
    expect(cta!.w).toBe(190);
    expect(cta!.h).toBe(44);
    const chip = env.host.getHitAreasForTest().find((a) => a.id === 'chip:body');
    expect(chip!.h).toBe(50); // 旧 chip 高 50 逻辑
  });

  it('验收3｜功能件选项横向滚动：点入口展开 → 可见选项不超屏、可滚动、滚动后可达更多', () => {
    const vp = { w: 844, h: 390 };
    const env = makeHost(vp, LANDSCAPE_INSETS);
    env.host.render(richGarageState()); // 富库存：全部 19 个功能件选项可装备（可见）
    // 通过「武器」入口 → 选一个武器位 → 展开功能件选项
    const entryW = env.host.getHitAreasForTest().find((a) => a.id === 'entry-weapons')!;
    env.pointer(entryW.x + entryW.w / 2, entryW.y + entryW.h / 2);
    const fnSlot = areas(env, 'chip:').map((a) => a.id.slice(5)).find((k) => k !== 'body' && k !== 'rearWheel' && k !== 'frontWheel' && k !== 'drive');
    expect(fnSlot, '武器位 chip 应存在').toBeTruthy();

    env.host.render(richGarageState({ garageSelected: fnSlot }));
    const firstVisible = areas(env, 'opt:').map((a) => a.id);
    expect(firstVisible.length).toBeGreaterThan(0);
    // 全部可见选项都在屏幕内（safe area）+ 命中 ≥44
    for (const a of env.host.getHitAreasForTest().filter((x) => x.id.startsWith('opt:'))) {
      expect(a.x).toBeGreaterThanOrEqual(LANDSCAPE_INSETS.left);
      expect(a.x + a.w).toBeLessThanOrEqual(vp.w - LANDSCAPE_INSETS.right);
      expect(a.y + a.h).toBeLessThanOrEqual(vp.h - LANDSCAPE_INSETS.bottom);
      expect(a.h).toBeGreaterThanOrEqual(44);
    }
    // 功能件选项很多 → 应有右滚动箭头
    const rightArrow = env.host.getHitAreasForTest().find((a) => a.id === 'opt-scroll-right');
    expect(rightArrow, '应有右滚动箭头').toBeTruthy();
    // 点右箭头 → 滚动 → 可见选项变化
    env.pointer(rightArrow!.x + rightArrow!.w / 2, rightArrow!.y + rightArrow!.h / 2);
    const secondVisible = areas(env, 'opt:').map((a) => a.id);
    expect(secondVisible.some((id) => !firstVisible.includes(id)), '滚动后应出现新选项').toBe(true);
    for (const a of env.host.getHitAreasForTest().filter((x) => x.id.startsWith('opt:'))) {
      expect(a.x + a.w).toBeLessThanOrEqual(vp.w - LANDSCAPE_INSETS.right);
    }
  });

  it('验收4｜Result 两个主要决策完整可点（≥40px、在屏内、点击派发）', () => {
    const vp = { w: 932, h: 430 };
    const env = makeHost(vp, LANDSCAPE_INSETS);
    env.host.render(RESULT_STATE);
    for (const id of ['result-adjust', 'result-next', 'reward-ad']) {
      const a = env.host.getHitAreasForTest().find((x) => x.id === id);
      expect(a, `应有 ${id}`).toBeTruthy();
      expect(a!.h, `${id} ≥40`).toBeGreaterThanOrEqual(40);
      expect(a!.x).toBeGreaterThanOrEqual(0);
      expect(a!.x + a!.w).toBeLessThanOrEqual(vp.w);
      expect(a!.y + a!.h).toBeLessThanOrEqual(vp.h - LANDSCAPE_INSETS.bottom);
    }
    const adjust = env.host.getHitAreasForTest().find((x) => x.id === 'result-adjust')!;
    const next = env.host.getHitAreasForTest().find((x) => x.id === 'result-next')!;
    env.pointer(adjust.x + adjust.w / 2, adjust.y + adjust.h / 2);
    env.pointer(next.x + next.w / 2, next.y + next.h / 2);
    expect(env.fired['resultAdjust']).toHaveLength(1);
    expect(env.fired['next']).toHaveLength(1);
  });

  it('验收5｜HUD / READY / Matching / MatchPreview 渲染不抛且命中不越界', () => {
    const vp = { w: 844, h: 390 };
    const env = makeHost(vp, LANDSCAPE_INSETS);
    // Matching
    expect(() => env.host.render(garageState({ playerPhase: 'matching' }))).not.toThrow();
    // MatchPreview + matchBar
    expect(() =>
      env.host.render(garageState({ playerPhase: 'matchPreview', matchBarHidden: false, opponent: { bodyName: '西瓜', parts: ['炮'], drive: '前进' } })),
    ).not.toThrow();
    for (const id of ['match-adjust', 'match-start']) {
      const a = env.host.getHitAreasForTest().find((x) => x.id === id);
      expect(a, `应有 ${id}`).toBeTruthy();
      expect(a!.h).toBeGreaterThanOrEqual(40);
      expect(a!.y + a!.h).toBeLessThanOrEqual(vp.h);
    }
    // Battle HUD + READY
    expect(() => {
      env.host.render({ ...garageState(), battleState: 'fighting' });
      env.host.renderBattleFrame({
        battleState: 'fighting',
        battleStatus: { phase: 'Warning', sideA: { hp: 50, maxHp: 100 }, sideB: { hp: 40, maxHp: 100 } },
        phaseCountdownText: '2',
      });
    }).not.toThrow();
    expect(() => env.host.render(garageState({ readyOverlayVisible: true }))).not.toThrow();
  });

  it('验收6｜横屏 resize 后布局即时更新', () => {
    const env = makeHost({ w: 844, h: 390 });
    env.host.render(garageState());
    const cta1 = env.host.getHitAreasForTest().find((a) => a.id === 'cta-find')!;
    expect(cta1.y + cta1.h).toBeLessThanOrEqual(390);
    // resize → 932×430
    env.canvas.width = 932;
    env.canvas.height = 430;
    env.host.render(garageState());
    const cta2 = env.host.getHitAreasForTest().find((a) => a.id === 'cta-find')!;
    expect(cta2.y + cta2.h).toBeLessThanOrEqual(430);
    expect(cta2.x + cta2.w).toBeLessThanOrEqual(932);
    expect(cta2.h).toBeGreaterThanOrEqual(40);
    // 新布局下点击仍派发
    env.pointer(cta2.x + cta2.w / 2, cta2.y + cta2.h / 2);
    expect(env.fired['find']).toHaveLength(1);
  });

  it('验收8｜WeChat mountCanvas 与 Web mount 使用同一 Mobile Layout 规则（几何一致）', () => {
    const vp = { w: 932, h: 430 };
    // mountCanvas（微信路径）
    const envWx = makeHost(vp, LANDSCAPE_INSETS);
    envWx.host.render(garageState());
    const wxAreas = envWx.host.getHitAreasForTest().map((a) => ({ id: a.id, x: a.x, y: a.y, w: a.w, h: a.h }));

    // mount（Web DOM 容器路径）：fake parent 同尺寸 + 同 safeInsets
    let captured: ((x: number, y: number) => void) | null = null;
    const core = createWebCore();
    bindPlatformCore({
      ...core,
      input: { bindClick: () => {}, bindPointer: (_t: EventTarget, h: (x: number, y: number) => void) => { captured = h; } },
      createViewport: () => ({
        surface: () => ({ width: vp.w, height: vp.h, devicePixelRatio: 1, now: () => 0 }),
        onResize: () => {},
        safeInsets: () => LANDSCAPE_INSETS,
      }),
    } as unknown as Parameters<typeof bindPlatformCore>[0]);
    const canvas = { getContext: () => makeStubCtx(), width: 932, height: 430, style: {} } as unknown as HTMLCanvasElement;
    const host = new CanvasPlayerUIHost(canvas);
    host.mount({ clientWidth: 932, clientHeight: 430, appendChild: () => {} } as unknown as HTMLElement);
    host.setActions({} as unknown as PlayerUIActions);
    host.render(garageState());
    const webAreas = host.getHitAreasForTest().map((a) => ({ id: a.id, x: a.x, y: a.y, w: a.w, h: a.h }));
    expect(webAreas).toEqual(wxAreas); // 同一 Mobile Layout 规则
    void captured;
  });
});
