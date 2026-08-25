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
  it('验收5｜621×351 / 844×390 / 932×430 布局均合法（safe 内 / 正尺寸 / 不重叠 / CTA 完整）', () => {
    for (const vp of VIEWPORTS) {
      const l = computeMobileGarageLayout(vp, INSETS);
      const inSafe = (r: { x: number; y: number; w: number; h: number }) =>
        r.x >= INSETS.left && r.y >= INSETS.top &&
        r.x + r.w <= vp.w - INSETS.right && r.y + r.h <= vp.h - INSETS.bottom;
      expect(inSafe(l.topBarRect), `${vp.w}×${vp.h} topBar 在 safe 内`).toBe(true);
      expect(inSafe(l.contentRect), `${vp.w}×${vp.h} content 在 safe 内`).toBe(true);
      expect(inSafe(l.vehicleRect), `${vp.w}×${vp.h} vehicle 在 safe 内`).toBe(true);
      expect(inSafe(l.panelRect), `${vp.w}×${vp.h} panel 在 safe 内`).toBe(true);
      expect(inSafe(l.ctaRect), `${vp.w}×${vp.h} cta 在 safe 内`).toBe(true);
      // F-META-UX1：无导航行——内容区直接位于顶栏下方（删除 navRect/GARAGE_NAV_H）
      expect(l.contentRect.y, 'content 在 topBar 下方（无 nav 行）').toBe(l.topBarRect.y + l.topBarRect.h + 8);
      expect(l.vehicleRect.y, 'vehicle 与 content 同顶').toBe(l.contentRect.y);
      expect(l.panelRect.y, 'panel 与 content 同顶').toBe(l.contentRect.y);
      for (const [k, r] of Object.entries(l)) {
        expect(r.w, `${vp.w}×${vp.h} ${k} 宽 >0`).toBeGreaterThan(0);
        expect(r.h, `${vp.w}×${vp.h} ${k} 高 >0`).toBeGreaterThan(0);
      }
      // vehicle 与 panel 不重叠（左右分区；中间留 12~16px）
      expect(l.vehicleRect.x + l.vehicleRect.w, `${vp.w}×${vp.h} vehicle 右缘 ≤ panel 左缘`).toBeLessThanOrEqual(l.panelRect.x);
      expect(l.panelRect.x - (l.vehicleRect.x + l.vehicleRect.w), '两区中间 gap 12~16').toBeGreaterThanOrEqual(12);
      expect(l.panelRect.x - (l.vehicleRect.x + l.vehicleRect.w), '两区中间 gap ≤16').toBeLessThanOrEqual(16);
      // F-WX-UI-2A：CTA 与面板同宽（右侧完整操作组）、高 56、距 safe bottom ≥16、不贴底
      expect(l.ctaRect.w, 'CTA 与面板同宽').toBe(l.panelRect.w);
      expect(l.ctaRect.x, 'CTA x == panel.x').toBe(l.panelRect.x);
      expect(l.ctaRect.h, 'CTA 高 = 56').toBe(56);
      expect(vp.h - INSETS.bottom - (l.ctaRect.y + l.ctaRect.h), 'CTA 距 safe bottom ≥16').toBeGreaterThanOrEqual(16);
      expect(l.ctaRect.w, 'CTA 宽 ≥220').toBeGreaterThanOrEqual(220);
      // 顶栏高 ≤42（只信息）
      expect(l.topBarRect.h, '顶栏 ≤42').toBeLessThanOrEqual(42);
      // vehicleRect 底部 = 独立 safe bottom（不随 CTA 变化）
      expect(vp.h - INSETS.bottom - (l.vehicleRect.y + l.vehicleRect.h), 'vehicle 底部独立 safe bottom').toBe(16);
      // F-META-UX1：621×351 内容区比旧版（含 nav 行：topBar34 + gap8 + nav48 + gap8）至少多 48px
      if (vp.w === 621 && vp.h === 351) {
        const oldBodyTop = INSETS.top + 34 + 8 + 48 + 8;
        const gain = oldBodyTop - l.contentRect.y;
        expect(gain, '621×351 内容区比旧版多 ≥48px').toBeGreaterThanOrEqual(48);
      }
    }
  });

  it('F-WX-UI-2A｜621×351 目标比例：vehicle ~48~52% / panel ~40~44%（可用宽）', () => {
    for (const vp of VIEWPORTS) {
      const l = computeMobileGarageLayout(vp, INSETS);
      const usableW = vp.w - INSETS.left - INSETS.right;
      const vRatio = l.vehicleRect.w / usableW;
      const pRatio = l.panelRect.w / usableW;
      expect(vRatio, `${vp.w}×${vp.h} vehicle 占比 ${(vRatio * 100).toFixed(1)}% ∈ [48%,52%]`).toBeGreaterThanOrEqual(0.48);
      expect(vRatio, `${vp.w}×${vp.h} vehicle 占比 ${(vRatio * 100).toFixed(1)}% ≤ 52%`).toBeLessThanOrEqual(0.52);
      expect(pRatio, `${vp.w}×${vp.h} panel 占比 ${(pRatio * 100).toFixed(1)}% ∈ [40%,44%]`).toBeGreaterThanOrEqual(0.4);
      expect(pRatio, `${vp.w}×${vp.h} panel 占比 ${(pRatio * 100).toFixed(1)}% ≤ 44%`).toBeLessThanOrEqual(0.44);
      // 不再使用 57% 旧 split：vehicle 必须 < 55%
      expect(vRatio, '不再使用 57% 旧 split').toBeLessThan(0.55);
      // 左侧车辆区 > 右侧面板区（左看车占主要空间）
      expect(l.vehicleRect.w).toBeGreaterThan(l.panelRect.w);
    }
  });

  it('验收1｜同一 viewport+insets → 同一份结果（确定性，无隐藏状态）', () => {
    const a = computeMobileGarageLayout({ w: 844, h: 390 }, INSETS);
    const b = computeMobileGarageLayout({ w: 844, h: 390 }, INSETS);
    expect(a).toEqual(b);
  });

  it('resize 后（viewport 变化）四区域同步更新', () => {
    const small = computeMobileGarageLayout({ w: 621, h: 351 }, INSETS);
    const large = computeMobileGarageLayout({ w: 932, h: 430 }, INSETS);
    // 大屏 vehicle/panel/cta 都应比小屏更大（至少不更小）
    expect(large.vehicleRect.w).toBeGreaterThan(small.vehicleRect.w);
    expect(large.panelRect.w).toBeGreaterThan(small.panelRect.w);
    expect(large.ctaRect.w).toBeGreaterThan(small.ctaRect.w);
  });
});

describe('F-WX-UI-F1｜CanvasPlayerUIHost 与唯一布局源一致', () => {
  it('验收2/3｜getPreviewFramingRect == layout.vehicleRect；resize 后同步', () => {
    const insets: SafeInsets = { left: 44, right: 20, top: 12, bottom: 16 };
    const host = makeHost({ w: 844, h: 390 }, insets);
    host.render(garageState());
    // F-HOME-1：默认 Home → 取景区 = Home vehicleRect（首页车辆展示区）
    const homeLayout = computeHomeLayout({ w: 844, h: 390 }, insets, { mode: 'mobile' } as never);
    expect(host.getPreviewFramingRect()).toEqual(homeLayout.vehicleRect);
    // 进配置页 → 取景区 = 配置页 vehicleRect（唯一布局源）
    const homeBtn = host.getHitAreasForTest().find((a) => a.id === 'home-garage')!;
    host.pointerForTest?.(homeBtn.x + homeBtn.w / 2, homeBtn.y + homeBtn.h / 2);
    const expected = computeMobileGarageLayout({ w: 844, h: 390 }, insets).vehicleRect;
    const got = host.getPreviewFramingRect();
    expect(got, '非空').not.toBeNull();
    expect(got).toEqual(expected);
    // resize 语义：host 尺寸变化（新 host 用新 viewport）→ 取景同步变化（同一函数同一输入同一输出）
    const host2 = makeHost({ w: 932, h: 430 }, insets);
    host2.render(garageState());
    const homeBtn2 = host2.getHitAreasForTest().find((a) => a.id === 'home-garage')!;
    host2.pointerForTest?.(homeBtn2.x + homeBtn2.w / 2, homeBtn2.y + homeBtn2.h / 2);
    const expected2 = computeMobileGarageLayout({ w: 932, h: 430 }, insets).vehicleRect;
    expect(host2.getPreviewFramingRect()).toEqual(expected2);
    expect(host2.getPreviewFramingRect()!.w).toBeGreaterThan(got!.w);
  });

  it('验收2｜HitArea 与布局同源：cta-find rect == layout.ctaRect、入口在 panelRect 内', () => {
    const insets: SafeInsets = { left: 44, right: 20, top: 12, bottom: 16 };
    const host = makeHost({ w: 844, h: 390 }, insets);
    host.render(garageState());
    // F-HOME-1：Home → 配置页（原 Garage 布局同源断言）
    const homeBtn = host.getHitAreasForTest().find((a) => a.id === 'home-garage')!;
    host.pointerForTest?.(homeBtn.x + homeBtn.w / 2, homeBtn.y + homeBtn.h / 2);
    const l = computeMobileGarageLayout({ w: 844, h: 390 }, insets);
    const areas = host.getHitAreasForTest();
    const cta = areas.find((a) => a.id === 'cta-find');
    expect(cta, 'cta-find 命中区存在').toBeTruthy();
    expect(cta!.x, 'cta-find x == layout.ctaRect.x').toBe(l.ctaRect.x);
    expect(cta!.y, 'cta-find y == layout.ctaRect.y').toBe(l.ctaRect.y);
    expect(cta!.w, 'cta-find w == layout.ctaRect.w').toBe(l.ctaRect.w);
    expect(cta!.h, 'cta-find h == layout.ctaRect.h').toBe(l.ctaRect.h);
    // 2×2 主分类入口全部落在 panelRect 内（绘制与命中同源）
    for (const id of ['entry:body', 'entry-wheels', 'entry:drive', 'entry-weapons']) {
      const a = areas.find((x) => x.id === id);
      expect(a, `应有 ${id}`).toBeTruthy();
      expect(a!.x, `${id} x ≥ panel.x`).toBeGreaterThanOrEqual(l.panelRect.x);
      expect(a!.x + a!.w, `${id} 右缘 ≤ panel 右缘`).toBeLessThanOrEqual(l.panelRect.x + l.panelRect.w);
      expect(a!.y, `${id} y ≥ panel.y`).toBeGreaterThanOrEqual(l.panelRect.y);
      expect(a!.y + a!.h, `${id} 底缘 ≤ panel 底缘`).toBeLessThanOrEqual(l.panelRect.y + l.panelRect.h);
    }
  });

  it('验收4｜删除旧重复几何：CanvasHost 内不再手算 garage 区域', () => {
    const hostSrc = require('fs').readFileSync('src/ui/canvasPlayerUIHost.ts', 'utf-8');
    // 0.57 分区 / ctaBottomGap / 34 / 56 等几何常量必须只存在于布局模块（computeMobileGarageLayout），
    // CanvasHost 只消费 layout 结果
    const layoutSrc = require('fs').readFileSync('src/ui/mobileGarageLayout.ts', 'utf-8');
    expect(hostSrc, 'CanvasHost 不再出现 0.57 分区手算').not.toContain('* 0.57');
    expect(hostSrc, 'CanvasHost 不再出现 ctaBottomGap').not.toContain('ctaBottomGap');
    // F-META-UX1：全局导航行已删除（布局无 navRect/GARAGE_NAV_H；Host 无 drawMainNav）
    expect(hostSrc, 'CanvasHost 无 drawMainNav').not.toContain('drawMainNav');
    // 布局模块负责全部几何常量（F-WX-UI-2A：52/42 分区替代旧 0.57 split）
    expect(layoutSrc).toContain('VEHICLE_RATIO');
    expect(layoutSrc).toContain('PANEL_RATIO');
    expect(layoutSrc).toContain('GARAGE_CTA_H');
    expect(layoutSrc).toContain('vehicleRect');
    expect(layoutSrc, 'UX1：布局无 GARAGE_NAV_H 定义').not.toContain('GARAGE_NAV_H =');
    expect(layoutSrc, 'UX1：布局无 navRect 字段定义').not.toContain('navRect:');
  });
});
