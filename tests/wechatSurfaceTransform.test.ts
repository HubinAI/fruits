/**
 * F-WX-VIEWPORT-SURFACE-P0｜Must#1/#2/#3 微信 backing 定版门禁（先红后绿）。
 *
 * 复现真实微信行为：wx.createCanvas() 首画布默认 width/height = window【逻辑】尺寸
 * （如 844×390 @ dpr3，绝非物理 2532×1170）。旧代码从不显式设置 backing →
 * 整条链路按「canvas.width = 物理 backing」假设读取塌缩的逻辑视口 → 全局放大+裁切
 * （C3 真机/模拟器录屏）。本测试要求入口在创建 surface/UI/Input 之前把两块 Canvas
 * 定版为 windowWidth×pixelRatio，并让 canvas.width/dpr === windowWidth。
 *
 * 先红后绿：fake 画布初始为逻辑尺寸 → 修复前（backing 未定版）以下断言全部失败（红）；
 * 修复后（game.ts 显式定版）通过（绿）。
 *
 * 环境矩阵：844×390 @dpr1（=844×390）、1024×470.5 @dpr2（=2048×941 非整数逻辑）、
 * 844×390 @dpr3（=2532×1170）、932×430 @dpr3（=2796×1290）。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { makeSurfaceFakeWx, SURFACE_ENVS } from './wechatSurfaceEnv';

describe('F-WX-VIEWPORT-SURFACE-P0｜微信 backing 定版（canvas.width = windowWidth×dpr，先红后绿）', () => {
  afterEach(() => {
    delete (globalThis as any).wx;
    delete (globalThis as any).__WX_DEBUG__;
    vi.useRealTimers();
    vi.restoreAllMocks(); // 防止 console spy 跨用例累积（同 mock 复用）
  });

  for (const env of SURFACE_ENVS) {
    it(`env ${env.name}：boot 后 screen/ui 两块 Canvas = ${env.backingW}×${env.backingH} backing`, async () => {
      vi.useFakeTimers();
      const fake = makeSurfaceFakeWx(env);
      (globalThis as any).wx = fake.wx;
      (globalThis as any).__WX_DEBUG__ = true; // 开启 [WX-SURF]/[WX-VIEWPORT] 诊断（自由标识 → 全局解析）
      vi.resetModules();
      const consoleSpy = vi.spyOn(console, 'log');
      consoleSpy.mockClear(); // 丢弃前序用例残留 calls（同一 mock 复用）

      const mod = await import('../wechat/game');

      // —— Must#3：两块 Canvas backing 完全一致，且 = windowWidth×dpr ——
      expect(mod.screenCanvas.width).toBe(env.backingW);
      expect(mod.screenCanvas.height).toBe(env.backingH);
      expect(mod.uiCanvas.width).toBe(env.backingW);
      expect(mod.uiCanvas.height).toBe(env.backingH);

      // —— Must#3：logical viewport = canvas.width/dpr = windowWidth ——
      expect(mod.screenCanvas.width / env.dpr).toBeCloseTo(env.windowW, 5);
      expect(mod.screenCanvas.height / env.dpr).toBeCloseTo(env.windowH, 5);

      // —— Must#1：[WX-SURF] 全链诊断自证——canvasIsBacking=true、canvasIsLogicalDefault=false ——
      const surfCalls = consoleSpy.mock.calls.filter((c) => c[0] === '[WX-SURF]');
      const surfCall = surfCalls.find((c) => {
        try {
          return JSON.parse(String(c[1])).step === 'resize';
        } catch {
          return false;
        }
      });
      expect(surfCall, '[WX-SURF] step=resize 应输出').toBeTruthy();
      const surf = JSON.parse(String(surfCall![1]));
      expect(surf.canvases.uiMatchesScreen).toBe(true);
      expect(surf.checks.canvasIsBacking).toBe(true);
      // dpr=1 时「逻辑默认」与「物理 backing」数值重合（844==844×1），仅 dpr>1 可判别
      if (env.dpr > 1) expect(surf.checks.canvasIsLogicalDefault).toBe(false);
      // surface 契约：renderer.viewWidth/viewHeight = 逻辑窗口尺寸（backing ÷ dpr）
      expect(surf.renderer.viewWidth).toBeCloseTo(env.windowW, 3);
      expect(surf.renderer.viewHeight).toBeCloseTo(env.windowH, 3);
      expect(surf.stageLogical.width).toBe(844);
      expect(surf.uiLayout.cssW).toBeCloseTo(env.windowW, 3);
    }, 20000);
  }
});
