/**
 * F-HOME-P0-LAYER｜首页图层修复验收：
 *
 * 真实 compositor = renderer 画布（底层：背景 + 车辆）被 UI 画布（顶层：控件，zIndex 6）覆盖。
 * 旧 bug：首页 UI overlay 在 Renderer 之后绘制全屏不透明背景，把车辆盖掉。
 *
 * 本队列修复：背景下沉为 renderer underlay（背景层 < 车辆层 < UI 层），
 * 单一入口 = renderer.drawHomeBackdrop；UI 层只画控件（透出下层车辆）。
 *
 * 验收：
 * 1. renderer 开启 homeBackdrop 时，背景（渐变带）绘制顺序位于车辆（#4aa3ff）之前；
 *    且不再绘制旧实心背景 #14181f。
 * 2. renderer 关闭 homeBackdrop 时，绘制 #14181f 实心背景、不绘制渐变带（车库/战斗保持原背景）。
 * 3. 首页 UI host 渲染后，UI 层不再绘制渐变带（#0a0d13）——即不再用不透明背景覆盖车辆；
 *    同时 UI 控件（CTA #3b6fd4）仍正常绘制（覆盖车辆之上）。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import { Renderer } from '../src/render/renderer';
import { VisualRegistry } from '../src/render/visualRegistry';
import { registry } from '../src/core/content';
import { makeStarterDraft, buildSnapshotFromDraft } from '../src/lab/buildEditorModel';
import { getInventory } from '../src/core/partInventory';
import { CanvasPlayerUIHost } from '../src/ui/canvasPlayerUIHost';
import { bindPlatformCore } from '../src/platform/context';
import { createWebCore } from '../src/platform/web';
import type { CanvasSurface } from '../src/render/canvasSurface';
import type { SafeInsets } from '../src/platform/types';
import type { PlayerUIState } from '../src/ui/playerUI';

const INSETS: SafeInsets = { left: 44, right: 20, top: 12, bottom: 16 };

/** 录制每次绘图调用的 fillStyle（不依赖 createLinearGradient，Proxy 安全） */
function makeTraceCtx(): { ctx: CanvasRenderingContext2D; log: Array<{ op: string; fillStyle: string }> } {
  const state = { fillStyle: '', strokeStyle: '', globalAlpha: 1 };
  const log: Array<{ op: string; fillStyle: string }> = [];
  const ctx = new Proxy({} as CanvasRenderingContext2D, {
    get(_t, prop) {
      if (prop === 'fillStyle' || prop === 'strokeStyle' || prop === 'globalAlpha') {
        return (state as Record<string, unknown>)[prop as string];
      }
      // F-HOME-VISUAL-R2：三层背景使用渐变——mock 返回可 addColorStop 的渐变对象
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
        return (): { addColorStop: () => void } => ({ addColorStop: () => {} });
      }
      return (..._args: unknown[]): { width: number } => {
        log.push({ op: String(prop), fillStyle: state.fillStyle });
        return { width: 0 };
      };
    },
    set(_t, prop, val) {
      if (prop in state) (state as Record<string, unknown>)[prop as string] = val;
      return true;
    },
  });
  return { ctx, log };
}

/** 渲染首页预览（previewSolo + soloA），返回录制日志；homeBackdrop 控制背景下沉开关 */
function renderPreview(w: number, h: number, homeBackdrop: boolean): Array<{ op: string; fillStyle: string }> {
  const { ctx, log } = makeTraceCtx();
  const canvas = { getContext: () => ctx, width: w, height: h } as unknown as HTMLCanvasElement;
  const surface: CanvasSurface = { width: w, height: h, devicePixelRatio: 1, now: () => 0 };
  const o = new PlanckBattleOrchestrator(
    buildSnapshotFromDraft(makeStarterDraft('watermelonBody', registry), registry, 'a'),
    buildSnapshotFromDraft(makeStarterDraft('watermelonBody', registry), registry, 'a'),
    registry,
    { autoDrive: true },
    true,
  );
  const r = new Renderer(canvas, new VisualRegistry(), surface);
  const snap = o.getRenderSnapshot();
  r.resize(snap.arena.width, o.arena.config.height);
  r.reframe(snap, 'previewSolo');
  r.setHomeBackdrop(homeBackdrop);
  r.render(o);
  return log;
}

function homeState(): PlayerUIState {
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

describe('F-HOME-P0-LAYER｜首页图层（背景<车辆<UI）', () => {
  afterEach(() => {
    bindPlatformCore(createWebCore());
  });

  it('1. 420×210 首页：renderer 背景（渐变带）绘制顺序位于车辆（#4aa3ff）之前，且不绘制旧实心背景 #14181f', () => {
    const log = renderPreview(420, 210, true);
    const backdropIdx = log.findIndex((e) => e.op === 'fillRect' && e.fillStyle === '#0a0d13');
    const vehicleIdx = log.findIndex((e) => e.fillStyle === '#4aa3ff');
    expect(backdropIdx, '背景渐变带已绘制').toBeGreaterThanOrEqual(0);
    expect(vehicleIdx, '车辆（#4aa3ff）已绘制').toBeGreaterThanOrEqual(0);
    expect(vehicleIdx, '背景层 < 车辆层（背景在车辆之前绘制）').toBeGreaterThan(backdropIdx);
    expect(log.some((e) => e.fillStyle === '#14181f'), '开启 homeBackdrop 后不再绘制旧实心背景').toBe(false);
  });

  it('2. 844×390 首页：背景层 < 车辆层（跨尺寸一致）', () => {
    const log = renderPreview(844, 390, true);
    const backdropIdx = log.findIndex((e) => e.op === 'fillRect' && e.fillStyle === '#0a0d13');
    const vehicleIdx = log.findIndex((e) => e.fillStyle === '#4aa3ff');
    expect(backdropIdx).toBeGreaterThanOrEqual(0);
    expect(vehicleIdx).toBeGreaterThanOrEqual(0);
    expect(vehicleIdx).toBeGreaterThan(backdropIdx);
  });

  it('3. 关闭 homeBackdrop（车库/战斗）：绘制 #14181f 实心背景，不绘制渐变带', () => {
    const log = renderPreview(844, 390, false);
    expect(log.some((e) => e.fillStyle === '#14181f'), '#14181f 实心背景已绘制').toBe(true);
    expect(log.some((e) => e.fillStyle === '#0a0d13'), '关闭后不绘制首页渐变带').toBe(false);
  });

  it('4. 首页 UI host：不再用渐变带（#0a0d13）覆盖车辆；CTA/主操作（#ffb229 金黄）仍正常绘制（覆盖车辆之上）', () => {
    const { ctx, log } = makeTraceCtx();
    const core = createWebCore();
    bindPlatformCore({
      ...core,
      input: { bindClick: () => {}, bindPointer: () => {} },
      createViewport: () => ({
        surface: () => ({ width: 420, height: 210, devicePixelRatio: 1, now: () => 0 }),
        onResize: () => {},
        safeInsets: () => INSETS,
      }),
    } as unknown as Parameters<typeof bindPlatformCore>[0]);
    const canvas = { getContext: () => ctx, width: 420, height: 210, style: undefined } as unknown as HTMLCanvasElement;
    const host = new CanvasPlayerUIHost(canvas);
    host.mountCanvas();
    host.setActions({ setHomeBackdrop: () => {} } as never);
    host.render(homeState());
    // UI 层不再绘制首页渐变带（即不再用不透明背景覆盖下层车辆）
    expect(log.some((e) => e.fillStyle === '#0a0d13'), 'UI 层不再绘制渐变带覆盖车辆').toBe(false);
    // UI 控件仍绘制（F-MOBILE-VISUAL-BASE-R1：主操作为金黄 #ffb229）——证明 UI 层正常位于车辆之上
    expect(log.some((e) => e.fillStyle === '#ffb229'), 'CTA/主操作等 UI 控件仍正常绘制').toBe(true);
    expect(log.length, 'UI 层确有绘制内容').toBeGreaterThan(0);
  });

  it('5. 源码守卫：drawHomeBackground 已从 host 移除、renderer.drawHomeBackdrop 为单一入口', () => {
    const host = readFileSync('src/ui/canvasPlayerUIHost.ts', 'utf-8');
    const renderer = readFileSync('src/render/renderer.ts', 'utf-8');
    expect(host, 'host 不再引用 drawHomeBackground').not.toContain('drawHomeBackground');
    expect(renderer.indexOf('private drawHomeBackdrop'), 'renderer 提供 drawHomeBackdrop 单一入口').toBeGreaterThan(-1);
    expect(host, 'draw() 经 actions.setHomeBackdrop 驱动背景下沉').toContain('setHomeBackdrop');
  });
});
