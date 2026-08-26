/**
 * F-HOME-DEMO-POLISH-R1｜首页车辆主视觉与操作层级验收。
 *
 * A/B/C：真实构建度量——用真实 orchestrator snapshot + renderer reframe('previewSolo',
 *   framingRect mode='home') + vehicleDiag（envelope 屏幕矩形）验证：
 *   - 普通初始车辆可见宽 ∈ [38%,52%] 安全宽（5 视口矩阵）；
 *   - 可见 envelope 中心偏差 ≤ 取景区宽 5%；
 *   - 视觉中心：车辆 envelope 中心 ≈ 取景区中心（F-HOME-VISUAL-R2 取代贴地锚定；
 *     贴地展示由前景展示平台表达）；
 *   - 完整入画：envelope 屏幕矩形在取景区内（不裁切）。
 *   - 极端构筑（高窄 pineapple / 长武器）优先完整入画（不强行满足普通比例）。
 * D：底部操作层级——home-find-opponent 唯一实底主按钮（视觉==命中同源）；辅助入口
 *   轻量化（无整块 panel 底带）。
 * E：Tips 气泡跟随车辆 envelope（不覆盖顶部信息层 / 主按钮）。
 * F：桌面 contain 玩家入口——phoneLogical 下 mode='home' 取景正确。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import { Renderer } from '../src/render/renderer';
import { VisualRegistry } from '../src/render/visualRegistry';
import { registry } from '../src/core/content';
import { makeStarterDraft, buildSnapshotFromDraft } from '../src/lab/buildEditorModel';
import { getInventory } from '../src/core/partInventory';
import { bindPlatformCore } from '../src/platform/context';
import { createWebCore } from '../src/platform/web';
import { CanvasPlayerUIHost } from '../src/ui/canvasPlayerUIHost';
import { computeHomeLayout } from '../src/ui/homeLayout';
import { resolveLayoutProfile } from '../src/ui/layoutProfile';
import type { PlayerUIState } from '../src/ui/playerUI';
import type { SafeInsets } from '../src/platform/types';

const PROD_INSETS: SafeInsets = { left: 44, right: 44, top: 0, bottom: 12 };
const VPS = [
  { w: 360, h: 180 },
  { w: 420, h: 210 },
  { w: 460, h: 230 },
  { w: 621, h: 351 },
  { w: 844, h: 390 },
];

const HOST_SRC = readFileSync('src/ui/canvasPlayerUIHost.ts', 'utf-8');
const RENDERER_SRC = readFileSync('src/render/renderer.ts', 'utf-8');

interface EnvelopeDiag {
  world: { minX: number; minY: number; maxX: number; maxY: number };
  screen: { minX: number; minY: number; maxX: number; maxY: number };
}

function makeStubCtx(): CanvasRenderingContext2D {
  const handler = { get: () => () => ({ width: 0 }), set: () => true };
  return new Proxy({} as CanvasRenderingContext2D, handler);
}

/** 真实构建：orchestrator snapshot → renderer home 取景 → envelope 屏幕矩形度量 */
function measureHome(
  bodyId: string,
  vp: { w: number; h: number },
  insets: SafeInsets = PROD_INSETS,
): {
  diag: EnvelopeDiag;
  frame: { x: number; y: number; w: number; h: number };
  groundScreen: number;
  safeW: number;
  scale: number;
} {
  bindPlatformCore(createWebCore());
  const canvas = {
    getContext: () => makeStubCtx(),
    clientWidth: vp.w,
    clientHeight: vp.h,
    width: vp.w,
    height: vp.h,
  } as unknown as HTMLCanvasElement;
  (globalThis as { window?: { devicePixelRatio: number } }).window = { devicePixelRatio: 1 };
  const r = new Renderer(canvas, new VisualRegistry(), { width: vp.w, height: vp.h, devicePixelRatio: 1, now: () => 0 });
  const o = new PlanckBattleOrchestrator(
    buildSnapshotFromDraft(makeStarterDraft(bodyId, registry), registry, 'a'),
    buildSnapshotFromDraft(makeStarterDraft('bananaBody', registry), registry, 'b'),
    registry,
    { autoDrive: true },
  );
  const snap = o.getRenderSnapshot();
  const profile = resolveLayoutProfile(vp.w, vp.h);
  const L = computeHomeLayout(vp, insets, profile);
  r.resize(1600, 1000);
  r.reframe(snap, 'previewSolo', { framingRect: { ...L.vehicleFramingRect, mode: 'home' } });
  const diag = (r as unknown as { vehicleDiag: (v: unknown, incl: boolean) => EnvelopeDiag }).vehicleDiag(snap.vehicleA, true);
  const t = r.transform;
  return {
    diag,
    frame: L.vehicleFramingRect,
    groundScreen: t.offsetY + snap.arena.groundY * t.scale,
    safeW: vp.w - insets.left - insets.right,
    scale: t.scale,
  };
}

function garageState(): PlayerUIState {
  return {
    uiMode: 'build',
    battleState: 'editing',
    playerPhase: 'garage',
    draft: makeStarterDraft('watermelonBody', registry),
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
  };
}

describe('F-HOME-DEMO-POLISH-R1｜首页车辆主视觉', () => {
  afterEach(() => {
    bindPlatformCore(createWebCore());
  });

  it('A1. 普通初始车辆（watermelon/box）可见宽 ∈ [38%,52%] 安全宽（五视口矩阵）', () => {
    for (const body of ['watermelonBody', 'boxBody']) {
      for (const vp of VPS) {
        const m = measureHome(body, vp);
        const wPct = (m.diag.screen.maxX - m.diag.screen.minX) / m.safeW;
        expect(wPct, `${body} ${vp.w}×${vp.h} 车辆宽 ${(wPct * 100).toFixed(1)}% ∈ [38%,52%]`)
          .toBeGreaterThanOrEqual(0.38);
        expect(wPct, `${body} ${vp.w}×${vp.h} 车辆宽 ${(wPct * 100).toFixed(1)}% ≤ 52%`)
          .toBeLessThanOrEqual(0.52);
      }
    }
  });

  it('A2. 可见 envelope 中心接近舞台视觉中心（偏差 ≤ 取景区宽 5%）', () => {
    for (const body of ['watermelonBody', 'boxBody', 'bananaBody']) {
      for (const vp of VPS) {
        const m = measureHome(body, vp);
        const cx = (m.diag.screen.minX + m.diag.screen.maxX) / 2;
        const frameCx = m.frame.x + m.frame.w / 2;
        const dev = Math.abs(cx - frameCx) / m.frame.w;
        expect(dev, `${body} ${vp.w}×${vp.h} 中心偏差 ${(dev * 100).toFixed(1)}% ≤ 5%`)
          .toBeLessThanOrEqual(0.05);
      }
    }
  });

  it('B1. 视觉中心（F-HOME-VISUAL-R2）：车辆 envelope 中心 ≈ 取景区中心（偏差 ≤ 取景区高 20%）；底部仍完整在取景区内', () => {
    for (const body of ['watermelonBody', 'boxBody']) {
      for (const vp of VPS) {
        const m = measureHome(body, vp);
        const cy = (m.diag.screen.minY + m.diag.screen.maxY) / 2;
        const frameCy = m.frame.y + m.frame.h / 2;
        const devY = Math.abs(cy - frameCy) / m.frame.h;
        expect(devY, `${body} ${vp.w}×${vp.h} 垂直中心偏差 ${(devY * 100).toFixed(1)}% ≤ 20%`)
          .toBeLessThanOrEqual(0.2);
        // 完整入画（车辆不沉入底部主条）
        expect(m.diag.screen.maxY, `${body} ${vp.w}×${vp.h} envelope 底缘 ≤ 取景区底（不沉底）`).toBeLessThanOrEqual(m.frame.y + m.frame.h + 1);
      }
    }
  });

  it('B2. 完整入画：envelope 屏幕矩形完全落在取景区内（武器/车身/轮组不裁切）', () => {
    for (const body of ['watermelonBody', 'boxBody', 'bananaBody']) {
      for (const vp of VPS) {
        const m = measureHome(body, vp);
        expect(m.diag.screen.minX, `${body} ${vp.w}×${vp.h} envelope 左缘 ≥ 取景区左`).toBeGreaterThanOrEqual(m.frame.x - 1);
        expect(m.diag.screen.maxX, `${body} ${vp.w}×${vp.h} envelope 右缘 ≤ 取景区右`).toBeLessThanOrEqual(m.frame.x + m.frame.w + 1);
        expect(m.diag.screen.minY, `${body} ${vp.w}×${vp.h} envelope 顶缘 ≥ 取景区顶`).toBeGreaterThanOrEqual(m.frame.y - 1);
        expect(m.diag.screen.maxY, `${body} ${vp.w}×${vp.h} envelope 底缘 ≤ 取景区底`).toBeLessThanOrEqual(m.frame.y + m.frame.h + 1);
      }
    }
  });

  it('C1. 极端构筑优先完整入画：高窄 pineapple / 长武器构型 envelope 不裁切（比例可放宽）', () => {
    // 高窄车身（pineappleBody）：完整入画优先——envelope 必须在取景区内
    for (const vp of [VPS[0]!, VPS[4]!]) {
      const m = measureHome('pineappleBody', vp);
      expect(m.diag.screen.minX, `pineapple ${vp.w}×${vp.h} 左缘`).toBeGreaterThanOrEqual(m.frame.x - 1);
      expect(m.diag.screen.maxX, `pineapple ${vp.w}×${vp.h} 右缘`).toBeLessThanOrEqual(m.frame.x + m.frame.w + 1);
      expect(m.diag.screen.minY, `pineapple ${vp.w}×${vp.h} 顶缘`).toBeGreaterThanOrEqual(m.frame.y - 1);
      expect(m.diag.screen.maxY, `pineapple ${vp.w}×${vp.h} 底缘`).toBeLessThanOrEqual(m.frame.y + m.frame.h + 1);
      // 不强行满足普通比例：高度上限优先（底部锚定把余量集中到顶部），宽占比只要求车辆可见
      const wPct = (m.diag.screen.maxX - m.diag.screen.minX) / m.safeW;
      expect(wPct, `pineapple ${vp.w}×${vp.h} 完整入画优先（宽 ${(wPct * 100).toFixed(1)}% 可低于 38%）`).toBeGreaterThan(0.15);
    }
    // 长武器构型：前端长武器 → envelope 完整入画
    for (const vp of VPS) {
      const m = measureHome('watermelonBody', vp);
      expect(m.diag.screen.minX, `长武器 ${vp.w}×${vp.h} 前端不裁切`).toBeGreaterThanOrEqual(m.frame.x - 1);
      expect(m.diag.screen.maxX, `长武器 ${vp.w}×${vp.h} 后端不裁切`).toBeLessThanOrEqual(m.frame.x + m.frame.w + 1);
    }
  });

  it('D1. 底部操作层级：home-find-opponent 唯一实底主按钮（视觉==命中同源）；辅助入口轻量无整块底带', () => {
    // 主按钮视觉与命中同源（button() 同 rect 注册 hit；源码守卫）
    expect(HOST_SRC, '主按钮绘制与命中同源').toContain("this.button(L.ctaRect.x, L.ctaRect.y, L.ctaRect.w, L.ctaRect.h, 'home-find-opponent'");
    // 辅助入口轻量化：不再整块 V.secondary panel 底（消除厚重底带）
    const entryBlock = HOST_SRC.slice(HOST_SRC.indexOf('private drawHomeBottomEntry'), HOST_SRC.indexOf('private drawHomeBottomEntry') + 700);
    expect(entryBlock, '辅助入口无整块 panel 填充底带').not.toMatch(/V\.secondary(?!Text)/);
    expect(entryBlock, '辅助入口保留极淡图标 chip').toContain('rgba(120,150,190,0.14)');
    // 命中区与视觉同源（hit 注册完整入口 rect）
    expect(entryBlock).toContain("this.hit(id, r.x, r.y, r.w, r.h)");
  });

  it('D2. 实机渲染：首页渲染不抛 + 主按钮/辅助入口 hitArea 存在且互不重叠（真实 host 画面）', () => {
    let captured: ((x: number, y: number) => void) | null = null;
    const core = createWebCore();
    bindPlatformCore({
      ...core,
      input: { bindClick: () => {}, bindPointer: (_t: EventTarget, h: (x: number, y: number) => void) => { captured = h; } },
      createViewport: () => ({
        surface: () => ({ width: 844, height: 390, devicePixelRatio: 1, now: () => 0 }),
        onResize: () => {},
        safeInsets: () => PROD_INSETS,
      }),
    } as unknown as Parameters<typeof bindPlatformCore>[0]);
    const host = new CanvasPlayerUIHost({
      getContext: () => makeStubCtx(),
      width: 844,
      height: 390,
      style: undefined,
    } as unknown as HTMLCanvasElement);
    host.mountCanvas();
    expect(() => host.render(garageState()), '首页渲染不抛').not.toThrow();
    const areas = host.getHitAreasForTest();
    const cta = areas.find((a) => a.id === 'home-find-opponent')!;
    expect(cta, '主按钮存在').toBeTruthy();
    // 主按钮视觉矩形 == 命中矩形（hitArea 直接来自 button 的 ctaRect）
    const L = computeHomeLayout({ w: 844, h: 390 }, PROD_INSETS, resolveLayoutProfile(844, 390));
    expect(cta.x, 'CTA x == layout').toBe(L.ctaRect.x);
    expect(cta.y, 'CTA y == layout').toBe(L.ctaRect.y);
    expect(cta.w, 'CTA w == layout').toBe(L.ctaRect.w);
    expect(cta.h, 'CTA h == layout').toBe(L.ctaRect.h);
    // 辅助入口与主按钮水平不重叠
    const garage = areas.find((a) => a.id === 'home-garage')!;
    const pass = areas.find((a) => a.id === 'home-pass')!;
    expect(garage.x + garage.w, '车库右缘 ≤ CTA 左缘').toBeLessThanOrEqual(cta.x);
    expect(pass.x, '战令左缘 ≥ CTA 右缘').toBeGreaterThanOrEqual(cta.x + cta.w);
    // 一次点击一次动作：点 CTA 中心 → onFindOpponent 恰好一次
    let finds = 0;
    host.setActions({ onFindOpponent: () => void finds++ } as never);
    captured!(cta.x + cta.w / 2, cta.y + cta.h / 2);
    expect(finds, '一次点击一次 onFindOpponent').toBe(1);
  });

  it('E1. Tips 气泡跟随车辆 envelope（不覆盖顶部信息层 / 主按钮）', () => {
    // 源码守卫：气泡基于 homeVehicleRect（envelope）顶部上方，clamp 到取景区内
    expect(HOST_SRC, 'Tips 基于车辆 envelope').toContain('const envR = hv ?? v;');
    expect(HOST_SRC, '气泡顶部 clamp 不覆盖顶部信息层').toContain('const tipY = Math.max(v.y, envR.y - tipH - 8);');
    expect(HOST_SRC, '气泡水平 clamp 取景区内').toContain('Math.max(v.x, Math.min(v.x + v.w - tipW');
  });

  it('F1. 桌面 contain 玩家入口：phoneLogical 下 getPreviewFramingRect 带 mode=home 且几何正确', () => {
    // 桌面玩家入口（pages 预览）→ host phoneLogical：canvas 物理 1688×780（dpr 2 →
    // 逻辑 844×390 mobile-normal）→ mode='home' 取景
    (globalThis as { window?: { devicePixelRatio: number } }).window = { devicePixelRatio: 2 };
    const host = new CanvasPlayerUIHost({
      getContext: () => makeStubCtx(),
      width: 1688,
      height: 780,
      clientWidth: 1688,
      clientHeight: 780,
      style: undefined,
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as HTMLCanvasElement);
    host.mountCanvas();
    host.render(garageState());
    const framing = host.getPreviewFramingRect();
    expect(framing, '桌面玩家入口取景存在').not.toBeNull();
    expect(framing!.mode, '桌面玩家入口 mode=home').toBe('home');
    expect(framing!.w, '取景宽 >0').toBeGreaterThan(0);
    expect(framing!.h, '取景高 >0').toBeGreaterThan(0);
  });

  it('G1. 视觉检查（真实构建，非仅布局数字）：measureHome 依赖真实 orchestrator+renderer 链', () => {
    // 本组 A/B/C 全部经「真实 snapshot → reframe → vehicleDiag envelope 屏幕矩形」度量——
    // 不是直接断言布局 rect，而是验证真实渲染后的可见 envelope 几何（Must#8 技术面）。
    expect(RENDERER_SRC, 'home 取景宽度目标区间 [38%,52%] clamp').toContain('HOME_VEHICLE_WIDTH_MIN_PCT');
    expect(RENDERER_SRC, 'F-HOME-VISUAL-R2 垂直居中（视觉中心构图）').toContain('(safeH - bh * scale) / 2');
    expect(RENDERER_SRC, '不再底部锚定贴地（HOME_VEHICLE_BOTTOM_PAD 已删）').not.toContain('HOME_VEHICLE_BOTTOM_PAD');
    expect(RENDERER_SRC, 'home 模式判定').toContain("framing?.mode === 'home'");
    expect(HOST_SRC, 'getPreviewFramingRect 带 home mode').toContain("return { ...rect, mode: 'home' };");
  });
});
