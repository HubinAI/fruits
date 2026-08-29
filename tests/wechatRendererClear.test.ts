/**
 * F-WX-IOS-CANVAS-CRASH-P0｜MUST#2 / MUST#3 渲染器侧回归锁
 *
 * - MUST#2：可见 Canvas 清屏必须显式 identity + 完整 backing 尺寸（不由 dpr 变换下
 *   clearRect 残留）。驱动真实 Renderer.render()（注入 surface，模拟微信路径），
 *   断言 clearScreen 在 identity transform 下执行（nonIdentityClearCount === 0）。
 *   修复前代码 = `setTransform(dpr) ; clearRect(0,0,viewW,viewH)` → 非 identity →
 *   nonIdentityClearCount = 1；修复后 = 0。该断言在 render() 顶部 clearScreen 后立即
 *   成立，与后续绘制是否完整无关。
 *
 * - MUST#3：compositeOverlay（Web 路径 overlay 合成；契约与 game.ts compositeUi 一致）
 *   必须以 identity + globalAlpha=1 + globalCompositeOperation='source-over' 绘制 UI 离屏，
 *   且 drawImage 后 restore 回 identity（不被上一帧世界相机变换 / FX 混合模式污染）。
 */
import { describe, it, expect } from 'vitest';
import { Renderer } from '../src/render/renderer';
import { VisualRegistry } from '../src/render/visualRegistry';
import { FakeCanvas, FakeCtx2D, makeFakePlatformCore } from './wechatCanvasFrameHost';
import type { BattleOrchestratorApi, BattleRenderSnapshot, BattleStatusSnapshot, RenderShape, RenderCircle, RenderVehicle } from '../src/battle/battleContract';

const DPR = 2;
const W = 1280 * DPR; // 2560
const H = 720 * DPR; // 1440

function makeMinimalSnapshot(): BattleRenderSnapshot {
  const poly: RenderShape = { kind: 'polygons', polygons: [{ points: [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 12 }, { x: 0, y: 12 }] }] };
  const circle: RenderCircle = { center: { x: 0, y: 0 }, radius: 6, angle: 0 };
  const veh: RenderVehicle = { team: 'A', body: poly, wheels: [circle], parts: [], hardpoints: [] };
  return {
    arena: { width: 844, groundY: 300, normalWalls: [], closingWalls: [] },
    vehicleA: veh,
    vehicleB: { ...veh, team: 'B' },
  };
}

function makeOrchestrator(): BattleOrchestratorApi {
  const orch = {
    config: {} as BattleOrchestratorApi['config'],
    result: null,
    phase: 'Active',
    timeMs: 0,
    step: () => {},
    onCombatEvent: () => () => {},
    dispose: () => {},
    getRenderSnapshot: () => makeMinimalSnapshot(),
    getBattleStatusSnapshot: () => ({ sideA: {} as BattleStatusSnapshot['sideA'], sideB: {} as BattleStatusSnapshot['sideB'], phase: 'Active' }),
  };
  return orch as unknown as BattleOrchestratorApi;
}

describe('F-WX-IOS-CANVAS-CRASH-P0｜Renderer 清屏 identity + overlay 契约', () => {
  it('MUST#2｜render() 清屏在 identity transform 下执行（无残留 / 非 identity clear）', () => {
    makeFakePlatformCore({ dpr: DPR, surfaceWidth: W, surfaceHeight: H });
    const canvas = new FakeCanvas({ width: W, height: H });
    const ctx = canvas.ctx as FakeCtx2D;
    const surface = { width: W, height: H, devicePixelRatio: DPR, now: () => 0 };
    const renderer = new Renderer(canvas as unknown as HTMLCanvasElement, new VisualRegistry(), surface);
    renderer.setHomeBackdrop(true);
    renderer.resize(844, 390);

    const before = ctx.nonIdentityClearCount;
    let renderThrew: unknown = null;
    try {
      renderer.render(makeOrchestrator());
    } catch (err) {
      renderThrew = err;
    }
    // 调试输出：render 是否完整完成（不影响清屏契约断言）
    // eslint-disable-next-line no-console
    console.log('[RENDER] renderThrew =', renderThrew === null ? 'no' : (renderThrew as Error).message);

    // clearScreen 在 render() 顶部调用，无论后续绘制是否完成都成立：
    // 修复后：clear 在 identity 下执行 → nonIdentityClearCount 不增长、lastClearWasIdentity=true
    expect(ctx.lastClearWasIdentity).toBe(true);
    expect(ctx.nonIdentityClearCount).toBe(before); // 未新增非 identity clear
    expect(ctx.lastClearResidual).toBe(0); // 清屏后无残留 ink
  });

  it('MUST#3｜compositeOverlay 以 identity + alpha=1 + source-over 合成，且 restore 回 identity', () => {
    makeFakePlatformCore({ dpr: DPR, surfaceWidth: W, surfaceHeight: H });
    const canvas = new FakeCanvas({ width: W, height: H });
    const ctx = canvas.ctx as FakeCtx2D;
    const surface = { width: W, height: H, devicePixelRatio: DPR, now: () => 0 };
    const renderer = new Renderer(canvas as unknown as HTMLCanvasElement, new VisualRegistry(), surface);

    // 先制造一个「被世界相机变换 / FX 混合模式污染」的 ctx 状态（模拟上一帧残余）
    ctx.setTransform(1.8, 0, 0, 1.8, 50, 30);
    ctx.globalAlpha = 0.4;
    ctx.globalCompositeOperation = 'lighter';

    const overlay = new FakeCanvas({ width: W, height: H });
    overlay.ctx.fillRect(10, 10, 20, 20); // 在 overlay 上画一点内容

    const tBefore = ctx.currentTransform();
    renderer.compositeOverlay(overlay as unknown as HTMLCanvasElement);

    // 1) composite 时 transform 为 identity（不受污染的 1.8 变换影响）
    expect(ctx.lastDrawImageScale).toBe(1);
    // 2) composite 时 globalAlpha / globalCompositeOperation 已被复位
    expect(ctx.lastDrawImageAlpha).toBe(1);
    expect(ctx.lastDrawImageComposite).toBe('source-over');
    // 3) drawImage 后 restore → transform 回到 save 前（此处 save 前为污染的 1.8 变换，restore 还原）
    expect(ctx.currentTransform()).toEqual(tBefore);
    // 4) overlay 内容确实被搬到 screen
    expect(canvas.inkSize).toBeGreaterThan(0);
  });
});
