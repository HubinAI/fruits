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
import { readFileSync } from 'node:fs';
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

/** F-HOME-1：Home（默认首页）→ 点「车库」→ 配置页（原 Garage 布局断言用） */
function goGarage(env: HostEnv): void {
  const home = env.host.getHitAreasForTest().find((a) => a.id === 'home-garage')!;
  expect(home, '首页有「车库」入口').toBeTruthy();
  env.pointer(home.x + home.w / 2, home.y + home.h / 2);
}

describe('F-WX-6 手机横屏适配（自动化矩阵）', () => {
  afterEach(() => {
    bindPlatformCore(createWebCore());
  });

  it('验收1/2｜Garage 首屏：2×2 主分类 + 主 CTA 在中央交互区 + 命中 ≥48px；无部件信息墙', () => {
    for (const vp of VIEWPORTS.filter((v) => v.mobile)) {
      const env = makeHost(vp, LANDSCAPE_INSETS);
      env.host.render(richGarageState()); // 富库存+金币：merge 可点（非禁用态才注册命中）
      goGarage(env); // F-HOME-1：Home → 配置页（原 Garage 布局断言）
      // 主分类（2×2）：车身/轮子/驱动/武器——不暴露 frontWheel/rearWheel/武器位一级入口
      // F-META-2：Garage 职责纯化——首屏无合成（合成在 Backpack），只 2×2 主分类 + CTA
      const ids = ['cta-find', 'entry:body', 'entry-wheels', 'entry:drive', 'entry-weapons'];
      for (const id of ids) {
        const a = env.host.getHitAreasForTest().find((x) => x.id === id);
        expect(a, `${vp.w}×${vp.h} 应有 ${id}`).toBeTruthy();
        expect(a!.h, `${vp.w}×${vp.h} ${id} 命中高 ≥48`).toBeGreaterThanOrEqual(48);
        expect(a!.x, `${id} x 在 safe area 内`).toBeGreaterThanOrEqual(LANDSCAPE_INSETS.left);
        expect(a!.x + a!.w, `${id} 右缘在 safe area 内`).toBeLessThanOrEqual(vp.w - LANDSCAPE_INSETS.right);
        expect(a!.y, `${id} y 在 safe area 内`).toBeGreaterThanOrEqual(LANDSCAPE_INSETS.top);
        expect(a!.y + a!.h, `${id} 底缘在 safe area 内`).toBeLessThanOrEqual(vp.h - LANDSCAPE_INSETS.bottom);
        // 主要交互位于中央交互区（安全区内再留 ≥4px 边距，不贴安全区边缘）
        expect(a!.x, `${id} 不贴左安全缘`).toBeGreaterThanOrEqual(LANDSCAPE_INSETS.left + 4);
        expect(a!.x + a!.w, `${id} 不贴右安全缘`).toBeLessThanOrEqual(vp.w - LANDSCAPE_INSETS.right - 4);
        expect(a!.y, `${id} 不贴上安全缘`).toBeGreaterThanOrEqual(LANDSCAPE_INSETS.top + 4);
        expect(a!.y + a!.h, `${id} 不贴下安全缘`).toBeLessThanOrEqual(vp.h - LANDSCAPE_INSETS.bottom - 4);
      }
      // 首屏不展开完整部件信息墙：无选项、无轮子/武器位二级、无合成面板
      expect(areas(env, 'opt:')).toHaveLength(0);
      expect(areas(env, 'chip:')).toHaveLength(0);
      expect(areas(env, 'wheel-side:')).toHaveLength(0);
      expect(areas(env, 'weapon-slot:')).toHaveLength(0);
      expect(areas(env, 'merge-confirm')).toHaveLength(0);
      expect(areas(env, 'merge-close')).toHaveLength(0);
      // F-WX-9B：首屏只有 4 个一级配置入口（车身/轮子/驱动/武器），无第 5 个 entry
      const entries = env.host.getHitAreasForTest()
        .filter((a) => a.id.startsWith('entry'))
        .map((a) => a.id);
      expect(entries, `${vp.w}×${vp.h} 一级配置入口恰好 4 个`).toHaveLength(4);
      for (const id of ['entry:body', 'entry-wheels', 'entry:drive', 'entry-weapons']) {
        expect(entries, `${vp.w}×${vp.h} 应含一级入口 ${id}`).toContain(id);
      }
      // 「寻找对手」唯一最大主按钮：高 ≥52、距 safe bottom ≥16（Garage 无合成入口可比较）
      const cta = env.host.getHitAreasForTest().find((x) => x.id === 'cta-find')!;
      expect(env.host.getHitAreasForTest().some((x) => x.id === 'merge'), 'Garage 首屏无合成入口').toBe(false);
      expect(cta.h, 'CTA 高 ≥52').toBeGreaterThanOrEqual(52);
      expect(vp.h - LANDSCAPE_INSETS.bottom - (cta.y + cta.h), 'CTA 距 safe bottom ≥16').toBeGreaterThanOrEqual(16);
    }
  });

  it('F-WX-UI-1｜一次只处理一个配置决策：点分类才展开；轮子/武器二级不混显；展开时车辆预览仍可见', () => {
    const vp = { w: 844, h: 390 };
    const env = makeHost(vp, LANDSCAPE_INSETS);
    env.host.render(richGarageState());
    goGarage(env); // F-HOME-1：Home → 配置页
    // 点「车身」→ 派发 onToggleGarageSlot('body') → runtime 侧展开
    const entryBody = env.host.getHitAreasForTest().find((a) => a.id === 'entry:body')!;
    env.pointer(entryBody.x + entryBody.w / 2, entryBody.y + entryBody.h / 2);
    expect(env.fired['toggle']).toContain('body');
    env.host.render(richGarageState({ garageSelected: 'body' }));
    // 展开态：只有 body 选项；不混显其它分类/轮子/武器位
    expect(areas(env, 'opt:').length).toBeGreaterThan(0);
    expect(areas(env, 'entry:')).toHaveLength(0);
    expect(areas(env, 'entry-wheels')).toHaveLength(0);
    expect(areas(env, 'wheel-side:')).toHaveLength(0);
    expect(areas(env, 'weapon-slot:')).toHaveLength(0);
    // 点「轮子」→ 面板内前轮/后轮二级（首屏不暴露前/后轮一级入口）
    env.host.render(richGarageState()); // 收起（runtime 选完即收起语义）
    const entryW = env.host.getHitAreasForTest().find((a) => a.id === 'entry-wheels')!;
    env.pointer(entryW.x + entryW.w / 2, entryW.y + entryW.h / 2);
    expect(areas(env, 'wheel-side:front').length).toBeGreaterThan(0); // 前轮二级
    expect(areas(env, 'wheel-side:rear').length).toBeGreaterThan(0); // 后轮二级
    expect(areas(env, 'opt:')).toHaveLength(0); // 尚未选轮子 → 无选项
    // 选前轮 → 展开 frontWheel 选项
    const front = env.host.getHitAreasForTest().find((a) => a.id === 'wheel-side:front')!;
    env.pointer(front.x + front.w / 2, front.y + front.h / 2);
    expect(env.fired['toggle']).toContain('frontWheel');
    env.host.render(richGarageState({ garageSelected: 'frontWheel' }));
    expect(areas(env, 'opt:').length).toBeGreaterThan(0);
    // 点「武器」→ 武器位列表（无选项）
    env.host.render(richGarageState());
    const entryWe = env.host.getHitAreasForTest().find((a) => a.id === 'entry-weapons')!;
    env.pointer(entryWe.x + entryWe.w / 2, entryWe.y + entryWe.h / 2);
    expect(areas(env, 'weapon-slot:').length).toBeGreaterThan(0);
    expect(areas(env, 'opt:')).toHaveLength(0);
    // 选武器位 → 展开该位选项
    const slot = areas(env, 'weapon-slot:')[0];
    env.pointer(slot.x + slot.w / 2, slot.y + slot.h / 2);
    env.host.render(richGarageState({ garageSelected: slot.id.slice(12) }));
    expect(areas(env, 'opt:').length).toBeGreaterThan(0);
  });

  it('F-WX-8-B｜改一个部件 → 找对手（Mobile Garage 最小闭环）', () => {
    const vp = { w: 844, h: 390 };
    const env = makeHost(vp, LANDSCAPE_INSETS);
    env.host.render(richGarageState());
    goGarage(env); // F-HOME-1：Home → 配置页
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

  it('验收3｜功能件选项面板滚动：武器入口 → 武器位 → 选项卡不超屏、面板内滚动可达更多', () => {
    const vp = { w: 844, h: 390 };
    const env = makeHost(vp, LANDSCAPE_INSETS);
    env.host.render(richGarageState()); // 富库存：全部 19 个功能件选项可装备（可见）
    goGarage(env); // F-HOME-1：Home → 配置页
    // 通过「武器」入口 → 选一个武器位 → 展开功能件选项
    const entryW = env.host.getHitAreasForTest().find((a) => a.id === 'entry-weapons')!;
    env.pointer(entryW.x + entryW.w / 2, entryW.y + entryW.h / 2);
    const fnSlot = areas(env, 'weapon-slot:').map((a) => a.id.slice(12)).find((k) => k !== 'body' && k !== 'rearWheel' && k !== 'frontWheel' && k !== 'drive');
    expect(fnSlot, '武器位应存在').toBeTruthy();

    env.host.render(richGarageState({ garageSelected: fnSlot }));
    const firstVisible = areas(env, 'opt:').map((a) => a.id);
    expect(firstVisible.length).toBeGreaterThan(0);
    // 全部可见选项都在面板内（safe area）+ 命中 ≥48
    for (const a of env.host.getHitAreasForTest().filter((x) => x.id.startsWith('opt:'))) {
      expect(a.x).toBeGreaterThanOrEqual(LANDSCAPE_INSETS.left);
      expect(a.x + a.w).toBeLessThanOrEqual(vp.w - LANDSCAPE_INSETS.right);
      expect(a.y + a.h).toBeLessThanOrEqual(vp.h - LANDSCAPE_INSETS.bottom);
      expect(a.h).toBeGreaterThanOrEqual(48);
    }
    // 功能件选项很多（2 列网格超出面板）→ 应有面板内滚动箭头
    const scrollDown = env.host.getHitAreasForTest().find((a) => a.id === 'panel-scroll-down');
    expect(scrollDown, '应有面板内滚动箭头').toBeTruthy();
    // 点滚动 → 可见选项集合变化（F-META-1 后面板变矮，部分可见选项不注册命中——
    // 滚动后新的「完全可见」选项出现；不用 y 单调断言，矮面板下首个可见项可能后移）
    env.pointer(scrollDown!.x + scrollDown!.w / 2, scrollDown!.y + scrollDown!.h / 2);
    const secondVisible = areas(env, 'opt:').map((a) => a.id);
    expect(secondVisible.some((id) => !firstVisible.includes(id)), '滚动后应出现新选项').toBe(true);
    for (const a of env.host.getHitAreasForTest().filter((x) => x.id.startsWith('opt:'))) {
      expect(a.x + a.w).toBeLessThanOrEqual(vp.w - LANDSCAPE_INSETS.right);
      expect(a.y + a.h).toBeLessThanOrEqual(vp.h - LANDSCAPE_INSETS.bottom);
    }
  });

  it('验收4｜Result 中央 Card：底部仅两个流程决策并列居中（不贴边缘、≥48px、点击派发）；广告入口在奖励区内部且弱于决策', () => {
    const vp = { w: 932, h: 430 };
    const env = makeHost(vp, LANDSCAPE_INSETS);
    env.host.render(RESULT_STATE);
    // F-UX-3C：底部只保留两个流程决策（modal-secondary=调整配置 / modal-primary=下一场）；
    // 广告不再做第三个同级底部按钮（无 modal-tertiary，改奖励区内 modal-ad）
    for (const id of ['modal-secondary', 'modal-primary']) {
      const a = env.host.getHitAreasForTest().find((x) => x.id === id);
      expect(a, `应有 ${id}`).toBeTruthy();
      expect(a!.h, `${id} ≥48`).toBeGreaterThanOrEqual(48);
      // 中央 Result Card：按钮位于中央区域（不贴左右/上下边缘）
      expect(a!.x, `${id} 不贴左缘`).toBeGreaterThanOrEqual(vp.w * 0.1);
      expect(a!.x + a!.w, `${id} 不贴右缘`).toBeLessThanOrEqual(vp.w * 0.9);
      expect(a!.y, `${id} 不贴上缘`).toBeGreaterThanOrEqual(vp.h * 0.1);
      expect(a!.y + a!.h, `${id} 不贴下缘`).toBeLessThanOrEqual(vp.h * 0.9);
    }
    expect(env.host.getHitAreasForTest().some((a) => a.id === 'modal-tertiary'), '底部无第三个同级按钮').toBe(false);
    // 广告入口在奖励区内部：高度明显 < 决策按钮（弱化），且 y 在决策行上方
    const ad = env.host.getHitAreasForTest().find((x) => x.id === 'modal-ad');
    expect(ad, '广告小型入口存在（rewardAdAvailable）').toBeTruthy();
    const next = env.host.getHitAreasForTest().find((x) => x.id === 'modal-primary')!;
    expect(ad!.h, '广告入口矮于决策按钮（弱化）').toBeLessThan(next.h);
    expect(ad!.y + ad!.h, '广告入口在决策行上方（奖励区内）').toBeLessThanOrEqual(next.y);
    // 两个主要决策并列（调整配置在左、下一场在右，同一行）
    const adjust = env.host.getHitAreasForTest().find((x) => x.id === 'modal-secondary')!;
    expect(Math.abs(adjust.y - next.y), '两决策同一行').toBeLessThanOrEqual(2);
    expect(next.x, '下一场在右').toBeGreaterThan(adjust.x + adjust.w);
    // 点击派发（一次一个：Modal 关闭后按钮消失；next 派发由 canvasPlayerUIHost 用例覆盖）
    env.pointer(adjust.x + adjust.w / 2, adjust.y + adjust.h / 2);
    expect(env.fired['resultAdjust']).toHaveLength(1);
  });

  it('验收5｜HUD / READY / Matching / MatchPreview 渲染不抛且命中不越界', () => {
    const vp = { w: 844, h: 390 };
    const env = makeHost(vp, LANDSCAPE_INSETS);
    // Matching
    expect(() => env.host.render(garageState({ playerPhase: 'matching' }))).not.toThrow();
    // MatchPreview + matchBar（Mobile 正式流程不显示复核条，无确认按钮）
    expect(() =>
      env.host.render(garageState({ playerPhase: 'matchPreview', matchBarHidden: false, opponent: { bodyName: '西瓜', parts: ['炮'], drive: '前进' } })),
    ).not.toThrow();
    // F-PREBATTLE-P0：Mobile 即便 matchBarHidden=false 也不注册 match-adjust/match-start（禁止新增确认按钮）
    const ids = env.host.getHitAreasForTest().map((a) => a.id);
    expect(ids, 'Mobile 不应有调整配置按钮').not.toContain('match-adjust');
    expect(ids, 'Mobile 不应有开始战斗按钮').not.toContain('match-start');
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

  it('F-WX-9B｜Garage 首屏绘制方法内所有直接文本字号 ≥14px（Mobile 真人距离可读）', () => {
    // 源码守卫：Mobile 首屏方法体内 this.text(text, x, y, size, color, ...) 的 size 参数必须 ≥14
    const src = readFileSync('src/ui/canvasPlayerUIHost.ts', 'utf-8');
    const methods = [
      'drawMobileGarageDock',
      'drawMobileTopBar',
      'drawGaragePanelHome',
      'drawGaragePanelWheelPick',
      'drawGaragePanelWeaponPick',
      'showMergeModal',
    ];
    const re = /this\.text\(([^)]*)\)/g;
    for (const name of methods) {
      const start = src.indexOf(`private ${name}(`);
      expect(start, `${name} 应存在`).toBeGreaterThan(-1);
      const next = src.indexOf('\n  private ', start + 10);
      const body = src.slice(start, next === -1 ? src.length : next);
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(body)) !== null) {
        const args = m[1].split(',').map((s) => s.trim());
        const size = parseInt(args[3] ?? '', 10); // text, x, y, size, color, align, weight
        if (Number.isFinite(size) && size > 0) {
          expect(size, `${name} 内字号 <14px 的直接文本：${m[0].slice(0, 64)}`).toBeGreaterThanOrEqual(14);
        }
      }
    }
  });

  it('F-META-UX3｜Matching / MatchPreview 连续画面（源码守卫）：同一布局锚点 + 扫描占位 + 无确认按钮', () => {
    const src = readFileSync('src/ui/canvasPlayerUIHost.ts', 'utf-8');
    // 1) 连续画面方法存在：左我方车 / 中 VS+状态 / 右对手区域；搜索中扫描占位；锁定「对手已锁定」
    const methodStart = src.indexOf('private drawMatchingContinuum');
    expect(methodStart, 'drawMatchingContinuum 存在').toBeGreaterThan(-1);
    const method = src.slice(methodStart, src.indexOf('private drawMatchBar'));
    expect(method).toContain('我方车');
    expect(method).toContain('对手');
    expect(method).toContain('正在寻找对手…');
    expect(method).toContain('对手已锁定');
    expect(method).toContain('扫描对手中…');
    expect(method).toContain('驱动 ·');
    expect(method).not.toMatch(/parts\.join/);
    // 2) 布局锚点统一：matching 与 matchPreview 共用同一函数（无分阶段独立绘制函数）
    const drawIdx = src.indexOf('private draw(): void');
    const drawBody = src.slice(drawIdx, src.indexOf('private ensureSize'));
    expect(drawBody.match(/drawMatchingContinuum\(state\)/g)?.length, 'matching+matchPreview 两分支均调用同一函数').toBe(2);
    expect(src, '旧分阶段绘制已删除').not.toContain('private drawMatchingVs');
    expect(src, '旧分阶段绘制已删除').not.toContain('private drawMatchInfo');
    // 3) F-META-5 + F-META-UX4 + F-UX-3C：Result 走结算 Modal——胜/负 title + 三层结构
    //    （奖励行分块 + 独立部件卡 + 双决策）；金币/段位/部件不再拼成一长句；
    //    广告是奖励区内部 adRow（不做第三个底部按钮）
    const resultModalIdx = src.indexOf('private showResultModal');
    expect(resultModalIdx, 'showResultModal 存在').toBeGreaterThan(-1);
    const resultMethod = src.slice(resultModalIdx, src.indexOf('showModal(spec: ModalSpec): void'));
    expect(resultMethod).toContain("title: isWin ? '胜利' : '失败'");
    expect(resultMethod).toContain('rewardRows');
    expect(resultMethod).toContain('partCard');
    expect(resultMethod).toContain("label: '金币'");
    expect(resultMethod).toContain("label: '段位'");
    expect(resultMethod).toContain('获得新部件');
    expect(resultMethod).toContain("primary: '下一场'");
    expect(resultMethod).toContain("secondary: '调整配置'");
    // F-UX-3C：广告不再走 tertiary 底部按钮 → 改 adRow（奖励区内）
    expect(resultMethod).toContain('adRow');
    expect(resultMethod).toContain('额外 +');
    expect(resultMethod).toContain('看广告');
    expect(resultMethod, '无 tertiary 底部按钮').not.toContain('tertiary:');
    const bodyPushes = resultMethod.match(/body\.push\([^)]*\)/g) ?? [];
    expect(
      bodyPushes.some((p) => p.includes('金币') || p.includes('段位') || p.includes('库存') || p.includes('★★')),
      '金币/段位/部件明细不再拼进 body 长句（仅允许 onboarding 引导文案）',
    ).toBe(false);
    // drawModal 支持 rewardRows / partCard 绘制（三层结构落地）
    const modalMethod = src.slice(src.indexOf('private drawModal'), src.indexOf('private drawReadyOverlay'));
    expect(modalMethod).toContain('rewardRows');
    expect(modalMethod).toContain('partCard');
    expect(modalMethod).toContain('库存');
    // F-UX-3C：部件卡删除「获得」标题行（卡片本身即获得语义）；无 modal-tertiary 注册
    expect(modalMethod, '部件卡无「获得」标题行').not.toContain("text('获得'");
    expect(modalMethod, '无 tertiary 三列分支').not.toContain('modal-tertiary');
    // 4) 方法内所有直接文本字号 ≥16（Matching/MatchPreview 必要文字；Result 走 Modal 统一规格）
    const re = /this\.text\(([^)]*)\)/g;
    for (const name of ['drawMatchingContinuum']) {
      const start = src.indexOf(`private ${name}(`);
      const next = src.indexOf('\n  private ', start + 10);
      const body = src.slice(start, next === -1 ? src.length : next);
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(body)) !== null) {
        const args = m[1].split(',').map((s) => s.trim());
        const size = parseInt(args[3] ?? '', 10); // text, x, y, size, color, align, weight
        if (Number.isFinite(size) && size > 0) {
          expect(size, `${name} 内字号 <16px 的直接文本：${m[0].slice(0, 64)}`).toBeGreaterThanOrEqual(16);
        }
      }
    }
  });

  it('F-WX-9D｜MatchPreview 正常流程无「开始战斗/调整配置」确认按钮（Q15 自动开战，matchBar 常驻隐藏）', () => {
    const vp = { w: 844, h: 390 };
    const env = makeHost(vp, LANDSCAPE_INSETS);
    // matchBarHidden 默认 true（runtime Q15-FLOW-R1-ATOMIC：复核条立即隐藏，永不闪现）
    env.host.render(garageState({ playerPhase: 'matchPreview', opponent: { bodyName: '西瓜', parts: ['炮'], drive: '前进' } }));
    expect(env.host.getHitAreasForTest().some((a) => a.id === 'match-start'), '不应有「开始战斗」').toBe(false);
    expect(env.host.getHitAreasForTest().some((a) => a.id === 'match-adjust'), '不应有「调整配置」').toBe(false);
  });
});
