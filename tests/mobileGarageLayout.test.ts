import { describe, it, expect } from 'vitest';
import { CanvasPlayerUIHost } from '../src/ui/canvasPlayerUIHost';
import { computeMobileGarageLayout } from '../src/ui/mobileGarageLayout';
import { computeHomeLayout } from '../src/ui/homeLayout';
import { bindPlatformCore } from '../src/platform/context';
import { createWebCore } from '../src/platform/web';
import { makeStarterDraft } from '../src/lab/buildEditorModel';
import { registry } from '../src/core/content';
import { getInventory } from '../src/core/partInventory';
import type { SafeInsets } from '../src/platform/types';
import type { PlayerUIState } from '../src/ui/playerUI';

/**
 * F-WX-UI-F1｜Mobile UI 单一布局源：draw / hit-test / preview framing 全部读取
 * computeMobileGarageLayout 同一份结果；resize 同步；621×351 / 844×390 / 932×430 合法。
 */

function makeStubCtx(): CanvasRenderingContext2D {
  return new Proxy({} as CanvasRenderingContext2D, {
    get: () => () => ({ width: 0 }),
    set: () => true,
  });
}

type TestHost = CanvasPlayerUIHost & { pointerForTest?: (x: number, y: number) => void };

function makeHost(
  vp: { w: number; h: number },
  insets: SafeInsets = { left: 0, right: 0, top: 0, bottom: 0 },
  dpr = 1,
): TestHost {
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
    width: vp.w,
    height: vp.h,
    style: undefined,
  } as unknown as HTMLCanvasElement;
  const host = new CanvasPlayerUIHost(canvas);
  host.mountCanvas();
  host.setActions({} as never);
  // F-HOME-1：测试钩子——真实坐标链进配置页（Home → home-garage）
  (host as TestHost).pointerForTest = (x, y) => captured!(x, y);
  return host as TestHost;
}

function garageState(): PlayerUIState {
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
  };
}

const VIEWPORTS = [
  { w: 621, h: 351 },
  { w: 844, h: 390 },
  { w: 932, h: 430 },
];
const INSETS: SafeInsets = { left: 44, right: 20, top: 12, bottom: 16 };

describe('F-WX-UI-F1｜computeMobileGarageLayout 纯函数（唯一几何来源）', () => {
  it('验收5｜621×351 / 844×390 / 932×430 布局均合法（safe 内 / 正尺寸 / stage 与 strip 不重叠）', () => {
    for (const vp of VIEWPORTS) {
      const l = computeMobileGarageLayout(vp, INSETS);
      const inSafe = (r: { x: number; y: number; w: number; h: number }) =>
        r.x >= INSETS.left && r.y >= INSETS.top &&
        r.x + r.w <= vp.w - INSETS.right && r.y + r.h <= vp.h - INSETS.bottom;
      expect(inSafe(l.topBarRect), `${vp.w}×${vp.h} topBar 在 safe 内`).toBe(true);
      expect(inSafe(l.contentRect), `${vp.w}×${vp.h} content 在 safe 内`).toBe(true);
      expect(inSafe(l.stageRect), `${vp.w}×${vp.h} stage 在 safe 内`).toBe(true);
      expect(inSafe(l.stripRect), `${vp.w}×${vp.h} strip 在 safe 内`).toBe(true);
      expect(inSafe(l.vehicleRect), `${vp.w}×${vp.h} vehicle 在 safe 内`).toBe(true);
      // F-META-UX1：无导航行——内容区直接位于顶栏下方（删除 navRect/GARAGE_NAV_H）
      expect(l.contentRect.y, 'content 在 topBar 下方（无 nav 行）').toBe(l.topBarRect.y + l.topBarRect.h + 8);
      expect(l.stageRect.y, 'stage 与 content 同顶').toBe(l.contentRect.y);
      for (const [k, r] of Object.entries(l)) {
        expect(r.w, `${vp.w}×${vp.h} ${k} 宽 >0`).toBeGreaterThan(0);
        expect(r.h, `${vp.w}×${vp.h} ${k} 高 >0`).toBeGreaterThan(0);
      }
      // F-GARAGE-CENTER-STAGE-P0：中央舞台全宽（左右贴 safe 边）；stage 与 strip 不重叠
      expect(l.stageRect.x, `${vp.w}×${vp.h} stage x == safeLeft`).toBe(INSETS.left);
      expect(l.stageRect.x + l.stageRect.w, `${vp.w}×${vp.h} stage 右缘 == safeRight`).toBe(vp.w - INSETS.right);
      expect(l.vehicleRect, 'vehicleRect == stageRect（中央取景同源）').toEqual(l.stageRect);
      expect(l.stageRect.y + l.stageRect.h, `${vp.w}×${vp.h} stage 底 ≤ strip 顶`).toBeLessThanOrEqual(l.stripRect.y);
      // Must#5：strip 高占屏幕 27%~34%
      const ratio = l.stripRect.h / vp.h;
      expect(ratio, `${vp.w}×${vp.h} strip 高占比 ${(ratio * 100).toFixed(1)}% ≥ 27%`).toBeGreaterThanOrEqual(0.27);
      expect(ratio, `${vp.w}×${vp.h} strip 高占比 ${(ratio * 100).toFixed(1)}% ≤ 34%`).toBeLessThanOrEqual(0.34);
      // 顶栏高 ≤42（只信息）
      expect(l.topBarRect.h, '顶栏 ≤42').toBeLessThanOrEqual(42);
      // F-META-UX1：621×351 内容区比旧版（含 nav 行：topBar34 + gap8 + nav48 + gap8）至少多 48px
      if (vp.w === 621 && vp.h === 351) {
        const oldBodyTop = INSETS.top + 34 + 8 + 48 + 8;
        const gain = oldBodyTop - l.contentRect.y;
        expect(gain, '621×351 内容区比旧版多 ≥48px').toBeGreaterThanOrEqual(48);
      }
    }
  });

  it('F-GARAGE-CENTER-STAGE-P0｜621×351 目标结构：strip 全宽贴 safe、stage 高 ≥ 屏幕 50%、vehicle == stage', () => {
    for (const vp of VIEWPORTS) {
      const l = computeMobileGarageLayout(vp, INSETS);
      // 装配带全宽（Must#5：底部横向装配带使用完整安全宽）
      expect(l.stripRect.x, `${vp.w}×${vp.h} strip x == safeLeft`).toBe(INSETS.left);
      expect(l.stripRect.x + l.stripRect.w, `${vp.w}×${vp.h} strip 右缘 == safeRight`).toBe(vp.w - INSETS.right);
      // 中央舞台足够高（≥ 可用高 50%——保证「画面中心永远是战车」）
      const usableH = vp.h - INSETS.top - INSETS.bottom;
      expect(l.stageRect.h, `${vp.w}×${vp.h} stage 高 ≥ 可用高 50%`).toBeGreaterThanOrEqual(usableH * 0.5);
      // 车辆取景 = 中央舞台（Must#2：车辆中心 = 屏幕中心横轴）
      expect(l.vehicleRect).toEqual(l.stageRect);
    }
  });

  it('验收1｜同一 viewport+insets → 同一份结果（确定性，无隐藏状态）', () => {
    const a = computeMobileGarageLayout({ w: 844, h: 390 }, INSETS);
    const b = computeMobileGarageLayout({ w: 844, h: 390 }, INSETS);
    expect(a).toEqual(b);
  });

  it('resize 后（viewport 变化）区域同步更新', () => {
    const small = computeMobileGarageLayout({ w: 621, h: 351 }, INSETS);
    const large = computeMobileGarageLayout({ w: 932, h: 430 }, INSETS);
    // 大屏 stage/strip/content 都应比小屏更大（至少不更小）
    expect(large.stageRect.w).toBeGreaterThan(small.stageRect.w);
    expect(large.stripRect.w).toBeGreaterThan(small.stripRect.w);
    expect(large.stageRect.h).toBeGreaterThan(small.stageRect.h);
    expect(large.contentRect.w).toBeGreaterThan(small.contentRect.w);
  });
});

describe('F-WX-UI-F1｜CanvasPlayerUIHost 与唯一布局源一致', () => {
  it('验收2/3｜getPreviewFramingRect == layout.vehicleRect（含 mode）；resize 后同步', () => {
    const insets: SafeInsets = { left: 44, right: 20, top: 12, bottom: 16 };
    const host = makeHost({ w: 844, h: 390 }, insets);
    host.render(garageState());
    // F-HOME-1：默认 Home → 取景区 = Home vehicleFramingRect（首页车辆展示区）
    // F-HOME-DEMO-POLISH-R1：home 取景带 mode='home'（renderer 按宽 38~52% + 贴地构图）
    const homeLayout = computeHomeLayout({ w: 844, h: 390 }, insets, { mode: 'mobile' } as never);
    const gotHome = host.getPreviewFramingRect();
    expect(gotHome, '非空').not.toBeNull();
    expect(gotHome!.x, 'home x').toBe(homeLayout.vehicleFramingRect.x);
    expect(gotHome!.y, 'home y').toBe(homeLayout.vehicleFramingRect.y);
    expect(gotHome!.w, 'home w').toBe(homeLayout.vehicleFramingRect.w);
    expect(gotHome!.h, 'home h').toBe(homeLayout.vehicleFramingRect.h);
    expect(gotHome!.mode, 'home mode').toBe('home');
    // 进配置页 → 取景区 = 配置页 vehicleRect（唯一布局源；mode='garage'）
    const homeBtn = host.getHitAreasForTest().find((a) => a.id === 'home-garage')!;
    host.pointerForTest?.(homeBtn.x + homeBtn.w / 2, homeBtn.y + homeBtn.h / 2);
    const expected = computeMobileGarageLayout({ w: 844, h: 390 }, insets).vehicleRect;
    const got = host.getPreviewFramingRect();
    expect(got, '非空').not.toBeNull();
    expect(got!.x, 'garage x').toBe(expected.x);
    expect(got!.y, 'garage y').toBe(expected.y);
    expect(got!.w, 'garage w').toBe(expected.w);
    expect(got!.h, 'garage h').toBe(expected.h);
    expect(got!.mode, 'garage mode').toBe('garage');
    // resize 语义：host 尺寸变化（新 host 用新 viewport）→ 取景同步变化（同一函数同一输入同一输出）
    const host2 = makeHost({ w: 932, h: 430 }, insets);
    host2.render(garageState());
    const homeBtn2 = host2.getHitAreasForTest().find((a) => a.id === 'home-garage')!;
    host2.pointerForTest?.(homeBtn2.x + homeBtn2.w / 2, homeBtn2.y + homeBtn2.h / 2);
    const expected2 = computeMobileGarageLayout({ w: 932, h: 430 }, insets).vehicleRect;
    const got2 = host2.getPreviewFramingRect();
    expect(got2!.x, 'resize garage x').toBe(expected2.x);
    expect(got2!.w, 'resize garage w').toBe(expected2.w);
    expect(got2!.w).toBeGreaterThan(got!.w);
  });

  it('验收2｜F-NAV-ACTION-OWNERSHIP-P0：HitArea 与布局同源——配置页无寻找对手命中区（CTA 只属首页）；分类 tab 全部在装配带内', () => {
    const insets: SafeInsets = { left: 44, right: 20, top: 12, bottom: 16 };
    const host = makeHost({ w: 844, h: 390 }, insets);
    host.render(garageState());
    // F-HOME-1：Home → 配置页（原 Garage 布局同源断言）
    const homeBtn = host.getHitAreasForTest().find((a) => a.id === 'home-garage')!;
    host.pointerForTest?.(homeBtn.x + homeBtn.w / 2, homeBtn.y + homeBtn.h / 2);
    const l = computeMobileGarageLayout({ w: 844, h: 390 }, insets);
    const areas = host.getHitAreasForTest();
    // F-NAV-ACTION-OWNERSHIP-P0：配置页只调整车辆配置并返回首页——无寻找对手命中区
    //（cta-find 已从 Garage/Backpack 删除；home-find-opponent 只注册于首页）
    expect(
      areas.some((a) => a.id === 'cta-find' || a.id === 'home-find-opponent'),
      '配置页无寻找对手命中区',
    ).toBe(false);
    // 3 主分类入口全部落在底部装配带内（车身/移动/战斗；绘制与命中同源）
    for (const id of ['garage-cat:body', 'garage-cat:move', 'garage-cat:combat']) {
      const a = areas.find((x) => x.id === id);
      expect(a, `应有 ${id}`).toBeTruthy();
      expect(a!.x, `${id} x ≥ strip.x`).toBeGreaterThanOrEqual(l.stripRect.x - 0.5);
      expect(a!.x + a!.w, `${id} 右缘 ≤ strip 右缘`).toBeLessThanOrEqual(l.stripRect.x + l.stripRect.w + 0.5);
      expect(a!.y, `${id} y ≥ strip.y`).toBeGreaterThanOrEqual(l.stripRect.y - 0.5);
      expect(a!.y + a!.h, `${id} 底缘 ≤ strip 底缘`).toBeLessThanOrEqual(l.stripRect.y + l.stripRect.h + 0.5);
    }
  });

  it('验收4｜删除旧重复几何：CanvasHost 内不再手算 garage 区域；布局模块负责全部几何常量', () => {
    const hostSrc = require('fs').readFileSync('src/ui/canvasPlayerUIHost.ts', 'utf-8');
    // 0.57 分区 / ctaBottomGap / 34 / 56 等几何常量必须只存在于布局模块（computeMobileGarageLayout），
    // CanvasHost 只消费 layout 结果
    const layoutSrc = require('fs').readFileSync('src/ui/mobileGarageLayout.ts', 'utf-8');
    expect(hostSrc, 'CanvasHost 不再出现 0.57 分区手算').not.toContain('* 0.57');
    expect(hostSrc, 'CanvasHost 不再出现 ctaBottomGap').not.toContain('ctaBottomGap');
    // F-META-UX1：全局导航行已删除（布局无 navRect/GARAGE_NAV_H；Host 无 drawMainNav）
    expect(hostSrc, 'CanvasHost 无 drawMainNav').not.toContain('drawMainNav');
    // F-GARAGE-CENTER-STAGE-P0：Host 不再引用已删除的 panelRect 字段（左右分栏已删）
    expect(hostSrc, 'CanvasHost 不再使用 panelRect').not.toContain('panelRect');
    // 布局模块负责全部几何常量（F-GARAGE-CENTER-STAGE-P0：中央舞台 + 底部装配带）
    expect(layoutSrc).toContain('STRIP_HEIGHT_RATIO');
    expect(layoutSrc).toContain('GARAGE_TOP_BAR_H');
    expect(layoutSrc).toContain('computeGarageTopBarLayout');
    expect(layoutSrc).toContain('estimateTextWidth');
    expect(layoutSrc).toContain('stageRect');
    expect(layoutSrc).toContain('stripRect');
    expect(layoutSrc, 'UX1：布局无 GARAGE_NAV_H 定义').not.toContain('GARAGE_NAV_H =');
    expect(layoutSrc, 'UX1：布局无 navRect 字段定义').not.toContain('navRect:');
  });
});
