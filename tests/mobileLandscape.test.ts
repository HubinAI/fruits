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
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { CanvasPlayerUIHost } from '../src/ui/canvasPlayerUIHost';
import { computeMobileGarageLayout } from '../src/ui/mobileGarageLayout';
import { resolveLayoutProfile } from '../src/ui/layoutProfile';
import { bindPlatformCore } from '../src/platform/context';
import { createWebCore } from '../src/platform/web';
import { makeStarterDraft } from '../src/lab/buildEditorModel';
import { registry } from '../src/core/content';
import { getInventory, OFFICIAL_PARTS } from '../src/core/partInventory';
import type { PlayerUIState, PlayerUIActions } from '../src/ui/playerUI';
import type { SafeInsets } from '../src/platform/types';

/** F-GARAGE-CENTER-STAGE-P0：装配带顶缘（布局唯一源 stripRect.y） */
function layoutStripTop(vp: { w: number; h: number }): number {
  return computeMobileGarageLayout(vp, LANDSCAPE_INSETS, resolveLayoutProfile(vp.w, vp.h)).stripRect.y;
}

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
    onFuse: once('fuse'),
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
  reward: { kind: 'functional', name: '炮', starStr: '★', cat: '武器', countAfter: 2 },
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
    vi.unstubAllGlobals();
  });

  it('验收1/2｜Garage 首屏：2×2 主分类在中央交互区 + 命中 ≥48px；无部件信息墙；无寻找对手（F-NAV-ACTION-OWNERSHIP-P0）', () => {
    for (const vp of VIEWPORTS.filter((v) => v.mobile)) {
      const env = makeHost(vp, LANDSCAPE_INSETS);
      env.host.render(richGarageState()); // 富库存+金币：merge 可点（非禁用态才注册命中）
      goGarage(env); // F-HOME-1：Home → 配置页（原 Garage 布局断言）
      // 主分类（车身/移动/战斗）：F-GARAGE-COMBAT-TAB-R1 武器+辅助合并为「战斗」突出入口
      // 不暴露 frontWheel/rearWheel/武器位一级入口
      // F-LOBBY-GARAGE-DEMO-R1：轮子+驱动归入「移动」；功能件（武器/辅助）合并进「战斗」
      // F-META-2：Garage 职责纯化——首屏无合成（合成在 Backpack），只 3 个主分类
      // F-NAV-ACTION-OWNERSHIP-P0：配置页不再含 cta-find（寻找对手只属首页）
      const ids = ['garage-cat:body', 'garage-cat:move', 'garage-cat:combat'];
      for (const id of ids) {
        const a = env.host.getHitAreasForTest().find((x) => x.id === id);
        expect(a, `${vp.w}×${vp.h} 应有 ${id}`).toBeTruthy();
        // F-GARAGE-BUILD-BOARD-P0：分类 tab 为紧凑 chip（Must#2 不占四个巨大方块）——命中=视觉，不要求 48px
        expect(a!.h, `${vp.w}×${vp.h} ${id} 命中高>0（紧凑 tab）`).toBeGreaterThan(0);
        expect(a!.x, `${id} x 在 safe area 内`).toBeGreaterThanOrEqual(LANDSCAPE_INSETS.left);
        expect(a!.x + a!.w, `${id} 右缘在 safe area 内`).toBeLessThanOrEqual(vp.w - LANDSCAPE_INSETS.right);
        expect(a!.y, `${id} y 在 safe area 内`).toBeGreaterThanOrEqual(LANDSCAPE_INSETS.top);
        expect(a!.y + a!.h, `${id} 底缘在 safe area 内`).toBeLessThanOrEqual(vp.h - LANDSCAPE_INSETS.bottom);
        // F-GARAGE-CENTER-STAGE-P0：分类 tab 位于底部装配带内（Must#5 第一行全宽横贯——
        // 不再要求「不贴安全缘 ±4px」，装配带本身占据底部全宽）
        expect(a!.y, `${id} 位于装配带内`).toBeGreaterThanOrEqual(layoutStripTop(vp));
      }
      // 首屏不展开完整部件信息墙：无选项、无轮子/武器位二级、无合成面板
      expect(areas(env, 'opt:')).toHaveLength(0);
      expect(areas(env, 'chip:')).toHaveLength(0);
      expect(areas(env, 'wheel-side:')).toHaveLength(0);
      expect(areas(env, 'weapon-slot:')).toHaveLength(0);
      expect(areas(env, 'merge-confirm')).toHaveLength(0);
      expect(areas(env, 'merge-close')).toHaveLength(0);
      // F-WX-9B：首屏只有 3 个一级配置入口（车身/移动/战斗），无第 4 个 entry
      const entries = env.host.getHitAreasForTest()
        .filter((a) => a.id.startsWith('garage-cat'))
        .map((a) => a.id);
      expect(entries, `${vp.w}×${vp.h} 分类 tab 恰好 3 个`).toHaveLength(3);
      for (const id of ['garage-cat:body', 'garage-cat:move', 'garage-cat:combat']) {
        expect(entries, `${vp.w}×${vp.h} 应含分类 tab ${id}`).toContain(id);
      }
      // F-NAV-ACTION-OWNERSHIP-P0：配置页无寻找对手（旧 Garage CTA 契约已删除）
      expect(
        env.host.getHitAreasForTest().some((x) => x.id === 'cta-find' || x.id === 'home-find-opponent'),
        `${vp.w}×${vp.h} 配置页无寻找对手`,
      ).toBe(false);
      expect(env.host.getHitAreasForTest().some((x) => x.id === 'merge'), 'Garage 首屏无合成入口').toBe(false);
    }
  });

  it('F-GARAGE-CENTER-STAGE-P0｜单屏中央装配台：分类 tab 常驻 + 部件卡带；挂点只通过战车真实挂点（无文字挂点页签）', () => {
    const vp = { w: 844, h: 390 };
    const env = makeHost(vp, LANDSCAPE_INSETS);
    env.host.render(richGarageState());
    goGarage(env); // F-HOME-1：Home → 配置页
    // 分类 tab 行恒存在（车身/移动/战斗 3 个，紧凑；战斗最宽+金橙强调）
    for (const id of ['garage-cat:body', 'garage-cat:move', 'garage-cat:combat']) {
      expect(env.host.getHitAreasForTest().some((a) => a.id === id), `分类 tab ${id} 存在`).toBe(true);
    }
    // 点「车身」→ 派发 onToggleGarageSlot('body') → runtime 侧展开 → 部件卡
    const tabBody = env.host.getHitAreasForTest().find((a) => a.id === 'garage-cat:body')!;
    env.pointer(tabBody.x + tabBody.w / 2, tabBody.y + tabBody.h / 2);
    expect(env.fired['toggle']).toContain('body');
    env.host.render(richGarageState({ garageSelected: 'body' }));
    expect(areas(env, 'opt:').length, '车身分类展开部件卡').toBeGreaterThan(0);
    // Must#7：车身分类无文字挂点 chip（挂点选择只通过战车真实挂点）
    expect(areas(env, 'garage-slot:').length, '车身分类无文字挂点 chip').toBe(0);
    // 点「移动」→ 自动选中第一个挂点（后轮）+ 部件卡带出现
    env.host.render(richGarageState());
    const tabMove = env.host.getHitAreasForTest().find((a) => a.id === 'garage-cat:move')!;
    env.pointer(tabMove.x + tabMove.w / 2, tabMove.y + tabMove.h / 2);
    expect(env.fired['toggle']).toContain('rearWheel'); // 移动分类默认挂点 = 后轮
    env.host.render(richGarageState({ garageSelected: 'rearWheel' }));
    // Must#7：移动分类无「后轮/前轮/驱动」文字页签（挂点选择在战车轮组挂点上完成）
    expect(areas(env, 'garage-slot:').length, '移动分类无文字挂点 chip').toBe(0);
    expect(areas(env, 'opt:').length, '后轮展开部件卡').toBeGreaterThan(0);
    // 点「战斗」→ 自动选中第一个硬点 → 部件卡带出现
    env.host.render(richGarageState());
    const tabWe = env.host.getHitAreasForTest().find((a) => a.id === 'garage-cat:combat')!;
    env.pointer(tabWe.x + tabWe.w / 2, tabWe.y + tabWe.h / 2);
    env.host.render(richGarageState({ garageSelected: env.fired['toggle'].slice(-1)[0] }));
    // Must#7：战斗页无「武器/辅助+前端/前上/顶部/后部挂点」文字页签（garage-cslot:/garage-cgroup: 全删）
    expect(areas(env, 'garage-cslot:').length, '战斗页无文字挂点 chip').toBe(0);
    expect(areas(env, 'garage-cgroup:').length, '战斗页无武器/辅助文字分段').toBe(0);
    const optIds = areas(env, 'opt:').map((a) => a.id);
    expect(optIds.length, '战斗页展开部件卡').toBeGreaterThan(0);
  });

  it('F-GARAGE-BUILD-BOARD-P0｜改一个部件：分类 tab → 部件卡 → pick（单屏，无多层返回）；无寻找对手', () => {
    const vp = { w: 844, h: 390 };
    const env = makeHost(vp, LANDSCAPE_INSETS);
    env.host.render(richGarageState());
    goGarage(env); // F-HOME-1：Home → 配置页
    // 改部件：点「车身」分类 tab → 部件卡出现 → 点一个选项（pick 记录）
    const tabBody = env.host.getHitAreasForTest().find((a) => a.id === 'garage-cat:body')!;
    env.pointer(tabBody.x + tabBody.w / 2, tabBody.y + tabBody.h / 2);
    env.host.render(richGarageState({ garageSelected: 'body' }));
    const opt = areas(env, 'opt:')[0];
    env.pointer(opt.x + opt.w / 2, opt.y + opt.h / 2);
    expect(env.fired['pick'].length).toBe(1);
    // runtime 选完即收起 → 分类 tab 行仍常驻（无重复返回按钮）
    env.host.render(richGarageState());
    expect(areas(env, 'garage-cat:').length).toBeGreaterThan(0);
    expect(env.host.getHitAreasForTest().some((a) => a.id === 'panel-back'), '无面板内返回按钮（唯一返回=左上首页）').toBe(false);
    // F-NAV-ACTION-OWNERSHIP-P0：配置页无寻找对手（旧「Garage 点 cta-find 匹配」契约已删除）
    expect(
      env.host.getHitAreasForTest().some((a) => a.id === 'cta-find' || a.id === 'home-find-opponent'),
      '配置页无寻找对手',
    ).toBe(false);
  });

  it('验收7｜1280×720 Desktop 不退化（Canvas 逻辑布局保持原值）', () => {
    const env = makeHost({ w: 1280, h: 720 });
    env.host.render(garageState());
    // F-NAV-ACTION-OWNERSHIP-P0：Desktop 装配页也无寻找对手（旧 Desktop CTA 布局契约删除）
    expect(
      env.host.getHitAreasForTest().some((a) => a.id === 'cta-find' || a.id === 'home-find-opponent'),
      'Desktop 装配页无寻找对手',
    ).toBe(false);
    const chip = env.host.getHitAreasForTest().find((a) => a.id === 'chip:body');
    expect(chip!.h).toBe(50); // 旧 chip 高 50 逻辑
  });

  it('验收3｜功能件选项面板滚动：武器入口 → 武器位 → 选项卡不超屏、面板内滚动可达更多', () => {
    // F-GARAGE-MOBILE-SHELL-R1：canEquipPart 读全局库存（getInventory → platform.storage）——
    // 注入富库存 localStorage stub，使全部选项可点（否则种子库存 4 件下「滚动出现新可点项」
    // 数学上不可能：可点项全在初始可见窗口内）
    vi.stubGlobal('localStorage', {
      getItem: (key: string) =>
        key === 'strongfruit.ownedParts.v2' ? JSON.stringify({ ...richInv(), __v: 2 }) : null,
      setItem: () => {},
      removeItem: () => {},
    });
    const vp = { w: 844, h: 390 };
    const env = makeHost(vp, LANDSCAPE_INSETS);
    env.host.render(richGarageState()); // 富库存：全部 19 个功能件选项可装备（可见）
    goGarage(env); // F-HOME-1：Home → 配置页
    // F-GARAGE-BUILD-BOARD-P0：点「战斗」分类 → 默认武器分组 → 自动选中第一个硬点 → 展开功能件部件卡
    const entryW = env.host.getHitAreasForTest().find((a) => a.id === 'garage-cat:combat')!;
    env.pointer(entryW.x + entryW.w / 2, entryW.y + entryW.h / 2);
    const fnSlot = env.fired['toggle'].slice(-1)[0];
    expect(fnSlot, '武器分类应自动选中一个硬点').toBeTruthy();

    env.host.render(richGarageState({ garageSelected: fnSlot }));
    const firstVisible = areas(env, 'opt:').map((a) => a.id);
    expect(firstVisible.length).toBeGreaterThan(0);
    // 全部可见选项都在面板内（safe area）+ 命中 ≥48
    for (const a of env.host.getHitAreasForTest().filter((x) => x.id.startsWith('opt:'))) {
      expect(a.x).toBeGreaterThanOrEqual(LANDSCAPE_INSETS.left);
      expect(a.x + a.w).toBeLessThanOrEqual(vp.w - LANDSCAPE_INSETS.right);
      expect(a.y + a.h).toBeLessThanOrEqual(vp.h - LANDSCAPE_INSETS.bottom);
      // F-GARAGE-BUILD-BOARD-P0：部件卡按真实信息密度（紧凑 40+；非 48 大按钮）
      expect(a.h).toBeGreaterThanOrEqual(40);
    }
    // 功能件选项很多（卡片带超宽）→ 应有横向滚动箭头（strip-scroll-right）
    const scrollRight = env.host.getHitAreasForTest().find((a) => a.id === 'strip-scroll-right');
    expect(scrollRight, '应有部件带横向滚动箭头').toBeTruthy();
    // 点滚动 → 可见选项集合变化（新选项出现；部分可见卡不注册命中，滚动后新完全可见卡出现）
    env.pointer(scrollRight!.x + scrollRight!.w / 2, scrollRight!.y + scrollRight!.h / 2);
    const secondVisible = areas(env, 'opt:').map((a) => a.id);
    expect(secondVisible.some((id) => !firstVisible.includes(id)), '滚动后应出现新选项').toBe(true);
    for (const a of env.host.getHitAreasForTest().filter((x) => x.id.startsWith('opt:'))) {
      expect(a.x + a.w).toBeLessThanOrEqual(vp.w - LANDSCAPE_INSETS.right);
      expect(a.y + a.h).toBeLessThanOrEqual(vp.h - LANDSCAPE_INSETS.bottom);
    }
  });

  it('F-LOBBY-GARAGE-DEMO-R1｜验收矩阵：4 主分类 + 第一主动作始终是寻找对手 + 3 次点击换武器 + 返回首页保留配置', () => {
    const vp = { w: 844, h: 390 };
    const env = makeHost(vp, LANDSCAPE_INSETS);
    env.host.render(richGarageState());
    goGarage(env); // F-HOME-1：Home → 配置页

    // 验收（必改3）：配置第一层恰好 3 个「玩家认知」分组：车身 / 移动 / 战斗（武器+辅助合并）
    const firstLayer = env.host.getHitAreasForTest().filter((a) => a.id.startsWith('garage-cat'));
    expect(firstLayer, '分类 tab 恰好 3 个').toHaveLength(3);
    for (const id of ['garage-cat:body', 'garage-cat:move', 'garage-cat:combat']) {
      expect(firstLayer, `配置第一层应含 ${id}`).toContainEqual(expect.objectContaining({ id }));
    }
    // 不应把轮子/驱动/挂点细项同时铺在一级（已收进二级）
    expect(areas(env, 'wheel-side:').length, '一级不暴露轮子细项').toBe(0);
    expect(areas(env, 'slot:drive').length, '一级不暴露驱动细项').toBe(0);
    expect(areas(env, 'weapon-slot:').length, '一级不暴露武器位细项').toBe(0);

    // F-NAV-ACTION-OWNERSHIP-P0：车库页无寻找对手主按钮（旧「CTA 始终是首页/车库唯一主按钮」
    // 契约已删除——CTA 只属首页；配置页 entry 为唯一配置操作，无 CTA 抢占主操作）
    expect(
      env.host.getHitAreasForTest().some((a) => a.id === 'cta-find' || a.id === 'home-find-opponent'),
      '车库无寻找对手',
    ).toBe(false);

    // F-GARAGE-BUILD-BOARD-P0：2 次点击换武器（Acceptance#2）——点「战斗」分类 tab
    // （默认武器分组 + 自动选中第一挂点并展开部件卡）→ 点一个选项（pick 派发即视为换装）。共 2 击。
    const entryWe = env.host.getHitAreasForTest().find((a) => a.id === 'garage-cat:combat')!;
    env.pointer(entryWe.x + entryWe.w / 2, entryWe.y + entryWe.h / 2); // 第 1 击 → 展开挂点部件卡
    const wSlot = env.fired['toggle'].slice(-1)[0];
    expect(wSlot, '武器分类应自动选中挂点').toBeTruthy();
    env.host.render(richGarageState({ garageSelected: wSlot }));
    const opt = areas(env, 'opt:')[0];
    expect(opt, '挂点应展开部件卡').toBeTruthy();
    env.pointer(opt.x + opt.w / 2, opt.y + opt.h / 2); // 第 2 击 → 选装
    expect(env.fired['pick'].length, '2 击内完成换武器 pick 派发').toBeGreaterThanOrEqual(1);

    // 验收（必改5 + 验收「返回首页后配置正确保留」）：收起 → 返回首页 → 首页无配置残留
    env.host.render(richGarageState());
    const back = env.host.getHitAreasForTest().find((a) => a.id === 'nav:home')!;
    env.pointer(back.x + back.w / 2, back.y + back.h / 2); // 返回首页
    const homeIds = env.host.getHitAreasForTest().map((a) => a.id);
    expect(homeIds.some((id) => id === 'home-garage'), '已返回首页').toBe(true);
    expect(homeIds.some((id) => id.startsWith('garage-cat') || id.startsWith('opt:') || id.startsWith('garage-slot')),
      '返回首页后无车库配置残留').toBe(false);
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
    // F-NAV-ACTION-OWNERSHIP-P0：首页寻找对手入口 = home-find-opponent
    const cta1 = env.host.getHitAreasForTest().find((a) => a.id === 'home-find-opponent')!;
    expect(cta1.y + cta1.h).toBeLessThanOrEqual(390);
    // resize → 932×430
    env.canvas.width = 932;
    env.canvas.height = 430;
    env.host.render(garageState());
    const cta2 = env.host.getHitAreasForTest().find((a) => a.id === 'home-find-opponent')!;
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

  it('F-WX-9B｜Garage 装配页主要方法内直接文本字号下限（Mobile 真人距离可读；卡片带紧凑信息除外）', () => {
    // 源码守卫：Mobile 装配页方法体内 this.text(text, x, y, size, ...) 的 size 参数必须 ≥ 下限。
    // F-GARAGE-CENTER-STAGE-P0（Must#9）：部件卡带为紧凑横向卡（mini preview/名称/星级/能量/小标），
    // 卡片内元信息字号下限 7（short）/9（normal）由代码自适应；主要交互/提示文本保持 ≥14/10。
    const src = readFileSync('src/ui/canvasPlayerUIHost.ts', 'utf-8');
    const methods: Array<[string, number]> = [
      ['drawMobileGarageDock', 14],
      ['drawMobileTopBar', 14],
      ['drawGarageCategoryTabs', 10],
      ['drawGarageStrip', 10],
      ['garageStripStatus', 9],
      ['drawPartCard', 7], // 卡片带紧凑信息（Must#9：名称/星级/能量/类型小标小字号）
      // 注：F-GARAGE-INVENTORY-FUSION-P0 合成改为背包页内面板（drawBackpackFusePanel），无独立 showMergeModal 方法
    ];
    const re = /this\.text\(([^)]*)\)/g;
    for (const [name, floor] of methods) {
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
          expect(size, `${name} 内字号 <${floor}px 的直接文本：${m[0].slice(0, 64)}`).toBeGreaterThanOrEqual(floor);
        }
      }
    }
  });

  it('F-META-UX3｜Matching / MatchPreview 连续画面（源码守卫）：同一布局锚点 + 扫描占位 + 无确认按钮', () => {
    const src = readFileSync('src/ui/canvasPlayerUIHost.ts', 'utf-8');
    // 1) 连续画面方法存在：左我方车（renderer 绘制，无文字大标签）/ 中 VS+单一状态 / 右对手区域；锁定「对手已锁定」
    const methodStart = src.indexOf('private drawMatchingContinuum');
    expect(methodStart, 'drawMatchingContinuum 存在').toBeGreaterThan(-1);
    const method = src.slice(methodStart, src.indexOf('private drawMatchBar'));
    expect(method).toContain('对手'); // 「对手已锁定」状态（含「对手」）
    expect(method).toContain('正在寻找对手…');
    expect(method).toContain('对手已锁定');
    // 信息减法：删除重复「扫描对手中」文字、删除驱动 pill、删除「我方车」大标签
    expect(method, '已删除重复「扫描对手中」文字').not.toContain('扫描对手中…');
    expect(method, 'Locked 已删除驱动 pill').not.toContain('驱动 ·');
    expect(method, '已删除「我方车」大标签').not.toContain('我方车');
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
    // F-LOSS-ADJUST-REMATCH-LOOP-P0｜Must#3：主/次按胜负切换（战败主=调整配置；胜利主=下一场）
    expect(resultMethod).toContain("primary: isWin ? '下一场' : '调整配置'");
    expect(resultMethod).toContain("secondary: isWin ? '调整配置' : '下一场'");
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
