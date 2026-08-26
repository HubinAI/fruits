import { describe, it, expect } from 'vitest';
import { CanvasPlayerUIHost } from '../src/ui/canvasPlayerUIHost';
import { computeMobileGarageLayout } from '../src/ui/mobileGarageLayout';
import { resolveLayoutProfile, MOBILE_SHORT_H } from '../src/ui/layoutProfile';
import { bindPlatformCore } from '../src/platform/context';
import { createWebCore } from '../src/platform/web';
import { makeStarterDraft } from '../src/lab/buildEditorModel';
import { registry } from '../src/core/content';
import { getInventory } from '../src/core/partInventory';
import type { SafeInsets } from '../src/platform/types';
import type { PlayerUIState } from '../src/ui/playerUI';

/**
 * F-WX-MOBILE-RCA-1｜真实安卓微信 Viewport 尺寸系统：
 * 1. 真实 Mobile logical viewport 矩阵（360×180 ~ 844×390）× DPR（1/1.5/2/2.75/3）——
 *    DPR 只改物理像素，不改变 logical 布局；
 * 2. 布局无固定下限强撑（panelW≥200 / H≥120 删除）——所有 rect 由 available 反推且
 *    必须完全处于 safe area（无例外）；
 * 3. mobile-short（logicalH<260）真正启用：触控 36~40、字体 ×0.8，不再复用 normal 固定下限；
 * 4. 全屏溢出守卫：Garage / Backpack / More / Modal / Result 主要 UI rect 全在 safe 内
 *    （360×180 ~ 621×351 五屏）。
 */

const INSETS: SafeInsets = { left: 44, right: 20, top: 12, bottom: 16 };
/** 真实安卓微信高 DPR logical viewport 下界矩阵 */
const VIEWPORTS = [
  { w: 360, h: 180 },
  { w: 390, h: 195 },
  { w: 420, h: 210 },
  { w: 460, h: 230 },
  { w: 621, h: 351 },
  { w: 844, h: 390 },
];
const DPRS = [1, 1.5, 2, 2.75, 3];

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

function makeHost(vp: { w: number; h: number }, insets: SafeInsets, dpr = 1): HostEnv {
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
      surface: () => ({ width: vp.w, height: vp.h, devicePixelRatio: dpr, now: () => 0 }),
      onResize: () => {},
      safeInsets: () => insets,
    }),
  } as unknown as Parameters<typeof bindPlatformCore>[0]);
  const canvas = {
    getContext: () => makeStubCtx(),
    // 微信挂载语义：canvas 物理像素 = logical × dpr（ensureSize 里 w = canvas.width / dpr）
    width: vp.w * dpr,
    height: vp.h * dpr,
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

function click(env: HostEnv, id: string): void {
  const a = env.areas().find((x) => x.id === id);
  expect(a, `应有 ${id}`).toBeTruthy();
  env.pointer(a!.x + a!.w / 2, a!.y + a!.h / 2);
}

/** 全屏溢出守卫：每个 hitArea（除 modal-veil 全屏遮罩）必须完全处于 safe area */
function assertAllInSafe(env: HostEnv, vp: { w: number; h: number }, insets: SafeInsets, label: string): void {
  const areas = env.areas();
  expect(areas.length, `${label} 应有可交互元素`).toBeGreaterThan(0);
  for (const a of areas) {
    if (a.id === 'modal-veil') continue; // 全屏遮罩覆盖整个 canvas 是设计（拦截底层）
    expect(a.x, `${label} ${a.id} x ≥ safeLeft`).toBeGreaterThanOrEqual(insets.left);
    expect(a.y, `${label} ${a.id} y ≥ safeTop`).toBeGreaterThanOrEqual(insets.top);
    expect(a.x + a.w, `${label} ${a.id} 右缘 ≤ logicalW-safeRight`).toBeLessThanOrEqual(vp.w - insets.right + 0.5);
    expect(a.y + a.h, `${label} ${a.id} 底缘 ≤ logicalH-safeBottom`).toBeLessThanOrEqual(vp.h - insets.bottom + 0.5);
  }
}

describe('F-WX-MOBILE-RCA-1｜真实 viewport matrix 尺寸系统', () => {
  it('验收1a｜布局矩阵：360×180 ~ 844×390 全部 rect 无溢出（safe 内 + 正尺寸）', () => {
    for (const vp of VIEWPORTS) {
      const profile = resolveLayoutProfile(vp.w, vp.h);
      const l = computeMobileGarageLayout(vp, INSETS, profile);
      const rects: Array<[string, { x: number; y: number; w: number; h: number }]> = [
        ['topBar', l.topBarRect],
        ['content', l.contentRect],
        ['vehicle', l.vehicleRect],
        ['panel', l.panelRect],
      ];
      for (const [name, r] of rects) {
        expect(r.w, `${vp.w}×${vp.h} ${name} 宽>0`).toBeGreaterThan(0);
        expect(r.h, `${vp.w}×${vp.h} ${name} 高>0`).toBeGreaterThan(0);
        expect(r.x, `${vp.w}×${vp.h} ${name} x ≥ safeLeft`).toBeGreaterThanOrEqual(INSETS.left);
        expect(r.y, `${vp.w}×${vp.h} ${name} y ≥ safeTop`).toBeGreaterThanOrEqual(INSETS.top);
        expect(r.x + r.w, `${vp.w}×${vp.h} ${name} 右缘 ≤ logicalW-safeRight`).toBeLessThanOrEqual(vp.w - INSETS.right + 0.5);
        expect(r.y + r.h, `${vp.w}×${vp.h} ${name} 底缘 ≤ logicalH-safeBottom`).toBeLessThanOrEqual(vp.h - INSETS.bottom + 0.5);
      }
      // 车辆区与面板区不重叠（左右分区）
      expect(l.vehicleRect.x + l.vehicleRect.w, `${vp.w}×${vp.h} vehicle 右缘 ≤ panel 左缘`).toBeLessThanOrEqual(l.panelRect.x + 0.5);
    }
  });

  it('验收2｜DPR 不改变 logical 布局：同 viewport 下 DPR=1/1.5/2/2.75/3 布局与 hitArea 完全一致', () => {
    for (const vp of [{ w: 360, h: 180 }, { w: 621, h: 351 }]) {
      // 纯函数层：布局不接收 DPR，天然一致（验证短屏与常规屏）
      const prof = resolveLayoutProfile(vp.w, vp.h);
      const base = computeMobileGarageLayout(vp, INSETS, prof);
      const re = computeMobileGarageLayout(vp, INSETS, prof);
      expect(re, `${vp.w}×${vp.h} 布局确定性`).toEqual(base);
      // Host 层：物理像素随 DPR 变化，但逻辑 hitArea 相同
      const ref = makeHost(vp, INSETS, 1);
      ref.host.render(garageState());
      const baseAreas = ref.areas();
      for (const dpr of DPRS) {
        const env = makeHost(vp, INSETS, dpr);
        env.host.render(garageState());
        const areas = env.areas();
        expect(areas, `${vp.w}×${vp.h} DPR=${dpr} 不改变逻辑布局`).toEqual(baseAreas);
      }
    }
  });

  it('验收3｜mobile-short 真正启用：logicalH<260 → short；触控 36~40、字体 ×0.8；不再用 normal 固定下限', () => {
    expect(MOBILE_SHORT_H).toBe(260);
    // short 档（360×180 / 390×195 / 420×210 / 460×230）
    for (const vp of VIEWPORTS.slice(0, 4)) {
      const p = resolveLayoutProfile(vp.w, vp.h);
      expect(p.mode, `${vp.w}×${vp.h} → mobile-short`).toBe('mobile-short');
      expect(p.minTouchH, 'short 触控最小 36').toBe(36);
      expect(p.targetTouchH, 'short 触控目标 40').toBe(40);
      expect(p.fontScale, 'short 字体 ×0.8').toBeCloseTo(0.8, 5);
    }
    // normal 档（621×351 / 844×390）保持既有规格（零回归）
    for (const vp of VIEWPORTS.slice(4)) {
      const p = resolveLayoutProfile(vp.w, vp.h);
      expect(p.mode, `${vp.w}×${vp.h} → mobile-normal`).toBe('mobile-normal');
      expect(p.minTouchH).toBe(48);
      expect(p.targetTouchH).toBe(52);
      expect(p.fontScale).toBe(1);
    }
    // 源码守卫：布局函数不再「放不下也强撑」（无 max(200)/max(120) 固定下限）
    const layoutSrc = require('fs').readFileSync('src/ui/mobileGarageLayout.ts', 'utf-8');
    expect(layoutSrc, 'panel 宽不再 max(200)').not.toMatch(/Math\.max\(200/);
    expect(layoutSrc, '区域高不再 max(120)').not.toMatch(/Math\.max\(120/);
    // 字体统一经 text() fontScale（禁止页面自行除 0.8）
    const hostSrc = require('fs').readFileSync('src/ui/canvasPlayerUIHost.ts', 'utf-8');
    expect(hostSrc).toContain('size * this.fontScale');
  });

  it('验收4｜全屏溢出守卫：Home / Backpack / More / Modal / Result 主要 UI rect 全在 safe 内（5 屏）', () => {
    for (const vp of VIEWPORTS.slice(0, 5)) {
      const env = makeHost(vp, INSETS);
      // F-HOME-1：Home（正式首页：CTA + 三辅助入口 + 宝箱 4 槽）
      env.host.render(garageState());
      assertAllInSafe(env, vp, INSETS, `Home ${vp.w}×${vp.h}`);
      // 配置页（garage：2×2 + CTA + 顶栏背包/更多/‹首页）
      click(env, 'home-garage');
      assertAllInSafe(env, vp, INSETS, `Garage ${vp.w}×${vp.h}`);
      // Backpack（返回 + tabs + 列表 + 合成入口）
      click(env, 'nav:backpack');
      assertAllInSafe(env, vp, INSETS, `Backpack ${vp.w}×${vp.h}`);
      // More（返回 + 2×2 功能卡；F-GARAGE-MOBILE-SHELL-R1：short 极限屏 nav:more 按
      // 优先级降级隐藏（保留 back+energy+backpack），normal 屏必达）
      click(env, 'nav:garage'); // Backpack → 回 Home
      click(env, 'home-garage'); // 进配置页（garage 模式顶栏才有 nav:more）
      const moreArea = env.areas().find((x) => x.id === 'nav:more');
      if (moreArea) {
        click(env, 'nav:more');
        assertAllInSafe(env, vp, INSETS, `More ${vp.w}×${vp.h}`);
        click(env, 'nav:garage'); // More → 回 Home
      } else {
        click(env, 'nav:home'); // 配置页 → 回 Home
      }
      // Modal（合成说明 Modal：遮罩+主/次按钮）
      click(env, 'home-garage'); // 进配置页
      click(env, 'nav:backpack');
      click(env, 'merge');
      assertAllInSafe(env, vp, INSETS, `Modal ${vp.w}×${vp.h}`);
      click(env, 'modal-secondary');
      // Result（三层结算 Modal）
      env.host.render(
        garageState({
          playerPhase: 'matchPreview',
          battleState: 'ended',
          result: { winner: 'A', hpA: 100, hpB: 0 },
          reward: { name: '榴莲炮', starStr: '★★', cat: 'weapon', countAfter: 2 },
          economy: { coinDelta: 50, ratingDelta: 12, tierLabel: '青铜', rating: 212, coin: 150 },
        }),
      );
      assertAllInSafe(env, vp, INSETS, `Result ${vp.w}×${vp.h}`);
    }
  });

  it('验收5｜360×180 极限屏首页可交互：寻找对手 / 三辅助入口 / 宝箱 4 槽全部在屏内且不重叠；配置页同样无溢出', () => {
    const env = makeHost({ w: 360, h: 180 }, INSETS);
    env.host.render(garageState());
    // F-HOME-1：Home 首屏核心入口（F-NAV-ACTION-OWNERSHIP-P0：寻找对手 = home-find-opponent）
    for (const id of ['home-find-opponent', 'home-garage', 'home-rank', 'home-pass', 'home-chest-0', 'home-chest-3']) {
      const a = env.areas().find((x) => x.id === id);
      expect(a, `360×180 首页应有 ${id}`).toBeTruthy();
      expect(a!.x, `${id} x ≥ safeLeft`).toBeGreaterThanOrEqual(INSETS.left);
      expect(a!.x + a!.w, `${id} 右缘 ≤ safeRight`).toBeLessThanOrEqual(360 - INSETS.right + 0.5);
      expect(a!.y, `${id} y ≥ safeTop`).toBeGreaterThanOrEqual(INSETS.top);
      expect(a!.y + a!.h, `${id} 底缘 ≤ safeBottom`).toBeLessThanOrEqual(180 - INSETS.bottom + 0.5);
    }
    // 单底部条结构（F-HOME-IA-R1）：主 CTA 与辅助入口同处底部主条、水平不重叠（操作组完整）
    const cta = env.areas().find((x) => x.id === 'home-find-opponent')!;
    const assist = env.areas().find((x) => x.id === 'home-garage')!;
    expect(assist.x + assist.w, '车库右缘 ≤ 寻找对手左缘（水平不重叠）').toBeLessThanOrEqual(cta.x + 0.5);
    // 配置页（360×180 极限屏）同样全在 safe 内（F-NAV-ACTION-OWNERSHIP-P0：配置页无寻找对手；
    // F-GARAGE-MOBILE-SHELL-R1：nav:more 在极限屏按优先级降级，back/backpack/能量必留）
    click(env, 'home-garage');
    expect(
      env.areas().some((x) => x.id === 'cta-find' || x.id === 'home-find-opponent'),
      '配置页无寻找对手',
    ).toBe(false);
    for (const id of ['entry:body', 'nav:home', 'nav:backpack']) {
      const a = env.areas().find((x) => x.id === id);
      expect(a, `360×180 配置页应有 ${id}`).toBeTruthy();
      expect(a!.x, `${id} x ≥ safeLeft`).toBeGreaterThanOrEqual(INSETS.left);
      expect(a!.x + a!.w, `${id} 右缘 ≤ safeRight`).toBeLessThanOrEqual(360 - INSETS.right + 0.5);
      expect(a!.y, `${id} y ≥ safeTop`).toBeGreaterThanOrEqual(INSETS.top);
      expect(a!.y + a!.h, `${id} 底缘 ≤ safeBottom`).toBeLessThanOrEqual(180 - INSETS.bottom + 0.5);
    }
  });
});
