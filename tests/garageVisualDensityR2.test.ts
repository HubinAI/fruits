import { describe, it, expect } from 'vitest';
import { CanvasPlayerUIHost } from '../src/ui/canvasPlayerUIHost';
import { computeMobileGarageLayout } from '../src/ui/mobileGarageLayout';
import { resolveLayoutProfile } from '../src/ui/layoutProfile';
import { bindPlatformCore } from '../src/platform/context';
import { createWebCore } from '../src/platform/web';
import { makeStarterDraft } from '../src/lab/buildEditorModel';
import { getInventory } from '../src/core/partInventory';
import { registry } from '../src/core/content';
import { V } from '../src/ui/visualTokens';
import type { PlayerUIState } from '../src/ui/playerUI';
import type { SafeInsets } from '../src/platform/types';

/**
 * F-GARAGE-VISUAL-DENSITY-R2｜强化中央车辆 + 精简底部装配带（targeted）
 * 验收均为「最终合成像素」前的逻辑布局契约（logical → backing 经 DPR 单次换算；
 * 车辆最终宽由 renderer previewSolo clamp 保证，已另有 garageCenterStageP0 T2/T3 覆盖）：
 * T1  装配带高度占屏 30%~34%（Must#3），4 档分辨率全过。
 * T2  中央舞台占主导（stage 高 ≥ 屏高 40% 且 ≥ 装配带高），车辆取景区中心 ≈ 舞台中心（Must#1）。
 * T3  左右翻页箭头落在卡片行两侧 gutter 内、不覆盖卡片命中区；gutter 区 garageCardAt 返回 null
 *     （Must#8 箭头不覆盖内容/命中区；Must#9 边缘露卡只作滚动暗示、不误点）。
 * T4  可装备 vs 已装备亮度差（Must#6：可装备不得与已装备同亮度）。
 */
const INSETS: SafeInsets = { left: 44, right: 20, top: 12, bottom: 16 };
const RES = [
  { w: 420, h: 210, short: true },
  { w: 621, h: 351, short: false },
  { w: 844, h: 390, short: false },
  { w: 1280, h: 592, short: false },
] as const;

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

function makeHost(vp: { w: number; h: number }, insets: SafeInsets) {
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
      surface: () => ({ width: vp.w, height: vp.h, devicePixelRatio: 1, now: () => 0 }),
      onResize: () => {},
      safeInsets: () => insets,
    }),
  } as unknown as Parameters<typeof bindPlatformCore>[0]);
  const canvas = {
    getContext: () => new Proxy({} as CanvasRenderingContext2D, { get: () => () => ({ width: 0 }), set: () => true }),
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
    cardAt: (x: number, y: number) => (host as unknown as { garageCardAt(x: number, y: number): unknown }).garageCardAt(x, y),
  };
}

function relLum(hex: string): number {
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16) / 255;
  const g = parseInt(m.slice(2, 4), 16) / 255;
  const b = parseInt(m.slice(4, 6), 16) / 255;
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

describe('F-GARAGE-VISUAL-DENSITY-R2｜强化中央车辆 + 精简装配带', () => {
  it('T1. 装配带高度占屏 30%~34%（Must#3，4 档分辨率）', () => {
    for (const r of RES) {
      const profile = resolveLayoutProfile(r.w, r.h);
      const l = computeMobileGarageLayout({ w: r.w, h: r.h }, INSETS, profile);
      const ratio = l.stripRect.h / r.h;
      expect(ratio, `${r.w}×${r.h} 装配带占比 ${(ratio * 100).toFixed(1)}% ∈ [30%,34%]`).toBeGreaterThanOrEqual(0.30);
      expect(ratio, `${r.w}×${r.h} 装配带占比 ≤34%`).toBeLessThanOrEqual(0.34);
    }
  });

  it('T2. 中央舞台占主导 + 车辆取景区中心≈舞台中心（Must#1，4 档分辨率）', () => {
    for (const r of RES) {
      const profile = resolveLayoutProfile(r.w, r.h);
      const l = computeMobileGarageLayout({ w: r.w, h: r.h }, INSETS, profile);
      const stageRatio = l.stageRect.h / r.h;
      expect(stageRatio, `${r.w}×${r.h} 舞台占比 ${(stageRatio * 100).toFixed(1)}% ≥ 40%（主导且高于装配带）`).toBeGreaterThanOrEqual(0.40);
      expect(l.stageRect.h, '舞台高于装配带（车辆为主视觉）').toBeGreaterThan(l.stripRect.h);
      // 车辆取景区 == 中央舞台（唯一布局源）→ 中心一致
      const scx = l.stageRect.x + l.stageRect.w / 2;
      const scy = l.stageRect.y + l.stageRect.h / 2;
      const vcx = l.vehicleRect.x + l.vehicleRect.w / 2;
      const vcy = l.vehicleRect.y + l.vehicleRect.h / 2;
      expect(Math.abs(scx - vcx), '车辆水平中心≈舞台中心').toBeLessThanOrEqual(0.5);
      expect(Math.abs(scy - vcy), '车辆垂直中心≈舞台中心').toBeLessThanOrEqual(0.5);
    }
  });

  it('T3. 翻页箭头在 gutter 内、不覆盖卡片命中区；gutter 区不误点（Must#8/#9）', () => {
    const vp = { w: 844, h: 390 };
    const env = makeHost(vp, INSETS);
    const gutter = 20; // normal 档
    env.host.render(garageState());
    const home = env.areas().find((a) => a.id === 'home-garage')!;
    env.pointer(home.x + home.w / 2, home.y + home.h / 2); // 进配置页
    const profile = resolveLayoutProfile(vp.w, vp.h);
    const l = computeMobileGarageLayout(vp, INSETS, profile);
    for (const cat of ['body', 'move', 'combat'] as const) {
      const tab = env.areas().find((a) => a.id === `garage-cat:${cat}`);
      if (tab) env.pointer(tab.x + tab.w / 2, tab.y + tab.h / 2);
      env.host.render(garageState({ garageSelected: cat === 'body' ? 'body' : undefined }));
      const opts = env.areas().filter((a) => a.id.startsWith('opt:'));
      // 卡片全部位于卡片行（已两侧内缩 gutter），箭头槽位不被卡片命中区占用
      for (const o of opts) {
        expect(o.x, `${o.id} 不进入左箭头槽`).toBeGreaterThanOrEqual(l.stripRect.x + gutter - 0.5);
        expect(o.x + o.w, `${o.id} 不进入右箭头槽`).toBeLessThanOrEqual(l.stripRect.x + l.stripRect.w - gutter + 0.5);
      }
      // 箭头命中区（若存在）不与任何卡片命中区重叠
      const arrows = env.areas().filter((a) => a.id === 'strip-scroll-left' || a.id === 'strip-scroll-right');
      for (const ar of arrows) {
        for (const o of opts) {
          const overlap = !(ar.x + ar.w <= o.x || o.x + o.w <= ar.x || ar.y + ar.h <= o.y || o.y + o.h <= ar.y);
          expect(overlap, `${ar.id} 不与 ${o.id} 命中区重叠`).toBe(false);
        }
      }
      // gutter 区点击不命中卡片（边缘露卡只作滚动暗示、不误点）
      if (opts.length > 0) {
        const cy = opts[0]!.y + opts[0]!.h / 2;
        const hit = env.cardAt(l.stripRect.x + 4, cy);
        expect(hit, '左 gutter 区 garageCardAt 返回 null（不误点）').toBeNull();
      }
    }
  });

  it('T4. 可装备与已装备亮度差（Must#6：可装备不得与已装备同亮度）', () => {
    const lumAvail = relLum(V.availableFill);
    const lumEquip = relLum(V.equippedFill);
    expect(lumAvail, `可装备亮度 ${lumAvail.toFixed(3)} > 已装备 ${lumEquip.toFixed(3)}`).toBeGreaterThan(lumEquip);
    expect(lumAvail - lumEquip, '亮度差 ≥ 0.04（明确可辨）').toBeGreaterThanOrEqual(0.04);
  });
});
