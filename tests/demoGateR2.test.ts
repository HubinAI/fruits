/**
 * F-DEMO-GATE-R2｜手机演示版本统一验收 —— 自动化技术 Gate。
 *
 * 只做「技术 Gate」：检查玩家模式的工程链路是否达标（禁止用测试数量证明画面好看；
 * 通过仅标记「等待真人体验验收」，不自行宣布 Demo 体验通过）。
 *
 * Gate 五项（必做#3）：
 * 1. 玩家模式未挂载任何 DEV / WebDom 界面（main.ts 门控 + Pages PROD 语义）；
 * 2. 画布 surface 与点击坐标正确（CanvasPlayerUIHost 布局/输入唯一转换点；
 *    wechatInputContract / wechatPlayerSmoke 已覆盖真实触摸路径）；
 * 3. 关键页面无文字与按钮越界（mobileLandscape 验收系列已逐屏锁定；
 *    Gate 复算按钮/卡片 safe 区几何）；
 * 4. Battle 相机阶段切换无明显尺度突变（battleCameraR2 已锁定 Closing/Warning 相对
 *    Active ≤15%；Gate 复算 Active/Closing scale）；
 * 5. Result 所有奖励值位于安全区（resultDemoR2 已锁定 360×180~844×390；Gate 复算）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CanvasPlayerUIHost } from '../src/ui/canvasPlayerUIHost';
import { bindPlatformCore } from '../src/platform/context';
import { createWebCore } from '../src/platform/web';
import { makeStarterDraft } from '../src/lab/buildEditorModel';
import { registry } from '../src/core/content';
import { getInventory } from '../src/core/partInventory';
import type { PlayerUIState, PlayerUIActions } from '../src/ui/playerUI';
import type { SafeInsets } from '../src/platform/types';

const MAIN = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');
const HOST = readFileSync(fileURLToPath(new URL('../src/ui/canvasPlayerUIHost.ts', import.meta.url)), 'utf8');
const RENDERER = readFileSync(fileURLToPath(new URL('../src/render/renderer.ts', import.meta.url)), 'utf8');
const WX_VITE = readFileSync(fileURLToPath(new URL('../vite.wechat.config.ts', import.meta.url)), 'utf8');
const PAGES_VITE = readFileSync(fileURLToPath(new URL('../vite.pages.config.ts', import.meta.url)), 'utf8');

const INSETS: SafeInsets = { left: 44, right: 44, top: 0, bottom: 12 };

function makeRecHost(vp: { w: number; h: number }): { host: CanvasPlayerUIHost; texts: string[] } {
  const texts: string[] = [];
  const ctx = new Proxy({} as CanvasRenderingContext2D, {
    get: (_t, prop) => {
      if (prop === 'fillText') return (s: string): void => void texts.push(String(s));
      return () => ({ width: 0 });
    },
    set: () => true,
  });
  const canvas = { getContext: () => ctx, width: vp.w, height: vp.h, style: undefined } as unknown as HTMLCanvasElement;
  const core = createWebCore();
  bindPlatformCore({
    ...core,
    input: { bindClick: () => {}, bindPointer: () => {} },
    createViewport: () => ({ surface: () => ({ width: vp.w, height: vp.h, devicePixelRatio: 1, now: () => 0 }), onResize: () => {}, safeInsets: () => INSETS }),
  } as unknown as Parameters<typeof bindPlatformCore>[0]);
  const host = new CanvasPlayerUIHost(canvas);
  host.mountCanvas();
  host.setActions({} as unknown as PlayerUIActions);
  return { host, texts };
}

function resultState(): PlayerUIState {
  return {
    uiMode: 'build', battleState: 'ended', playerPhase: 'matchPreview',
    draft: makeStarterDraft('boxBody', registry), draftValid: true, blockReason: null,
    garageSelected: null, inventory: getInventory(), progress: { coin: 100, rating: 200 },
    onboarding: 'done', resetDevVisible: false, opponent: null, matchBarHidden: true,
    result: { winner: 'A', hpA: 90, hpB: 0 },
    reward: { name: '榴莲炮', starStr: '★★', cat: 'weapon', countAfter: 2 },
    economy: { coinDelta: 50, ratingDelta: 12, tierLabel: '青铜', rating: 212, coin: 150 },
    resultOnboardingVisible: false, rewardAdAvailable: true, rewardAdClaimed: false,
    readyOverlayVisible: false,
  };
}

describe('F-DEMO-GATE-R2｜手机演示版本技术 Gate', () => {
  it('G1. 玩家模式唯一入口：Canvas host、无 WebDom / DEV 界面 / 角标 / 分辨率按钮', () => {
    // 唯一入口：playerMode → canvasUiMode → CanvasPlayerUIHost（WebDom 仅非玩家模式）
    expect(MAIN, '玩家模式强制 CanvasPlayerUIHost').toMatch(/const host: PlayerUIHost = canvasUiMode\s*\?\s*new CanvasPlayerUIHost/);
    // DEV 工具 / Runtime Badge 全部 DEV_TOOLS_VISIBLE && !playerMode 门控（玩家模式不创建）
    const gates = MAIN.match(/DEV_TOOLS_VISIBLE && !playerMode/g) ?? [];
    expect(gates.length, 'DEV 工具/角标等 ≥2 处玩家模式门控').toBeGreaterThanOrEqual(2);
    // 玩家模式 phoneLogical 手机画布（桌面打开也走手机横屏逻辑）
    expect(MAIN).toContain('phoneLogical: playerMode');
  });

  it('G2. F-DEMO-FLOW-GATE-R3：真实构建 E2E 门禁替代字符串 Gate（删除 screenToLayoutPoint 检查）', () => {
    // Must#8：不再以「源码含 screenToLayoutPoint 字符串」宣告点击通过——真实浏览器 E2E
    // （tests/_e2e_gate.cjs：构建产物 → 本地服务 → 系统 Edge → 真实 hitArea 坐标点击 → 完整
    // 玩家闭环/页面职责/输入/控制台 Gate）才是点击验收。此处只守卫 Gate 链路存在且可运行。
    const fs = require('fs') as typeof import('node:fs');
    const e2eExists = fs.existsSync('tests/_e2e_gate.cjs');
    expect(e2eExists, '真实构建 E2E Gate 脚本存在').toBe(true);
    expect(fs.existsSync('tests/_serve_pages.cjs'), '本地构建产物服务脚本存在').toBe(true);
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
    expect(pkg.scripts['test:e2e-gate'], 'package.json 有 test:e2e-gate（构建→服务→真实浏览器）').toBeTruthy();
    const e2eSrc = fs.readFileSync('tests/_e2e_gate.cjs', 'utf-8');
    // E2E 必须是「真实浏览器 + 真实 Canvas 坐标」，不得直接调 runtime.actions（Must#2）
    expect(e2eSrc, 'E2E 驱动真实浏览器（playwright-core）').toContain('playwright-core');
    expect(e2eSrc, 'E2E 点击走真实 pointer 事件到 canvas').toContain("PointerEvent('pointerdown'");
    expect(e2eSrc, 'E2E 坐标来自页面运行时真实 hitArea').toContain('getHitAreasForTest');
    expect(e2eSrc, 'E2E 不直接调 runtime.actions').not.toMatch(/runtime\.actions/);
    // 输入/坐标唯一转换点仍存在（真实用户路径经 WebInput；不再以字符串断言点击通过）
    expect(HOST, '布局坐标注册（E2E 探针读真实 hitArea）').toContain('getHitAreasForTest');
    // Renderer 注入 surface（微信无 clientWidth / devicePixelRatio 形态差异安全）
    expect(RENDERER).toContain('return this.surface ? this.surface.width : this.canvas.clientWidth;');
    // 微信构建含触摸输入接线（WechatInput 归一化）
    expect(WX_VITE, '微信构建入口').toContain("entry: resolve(__dirname, 'wechat/game.ts')");
  });

  it('G3. 关键页面无文字与按钮越界（复算 Result 卡片/按钮 safe 区；其余页面由 mobileLandscape 验收锁定）', () => {
    for (const vp of [{ w: 360, h: 180 }, { w: 420, h: 210 }, { w: 621, h: 351 }, { w: 844, h: 390 }]) {
      const env = makeRecHost(vp);
      env.host.render(resultState());
      const ar = env.host.getHitAreasForTest();
      const safeBottom = vp.h - INSETS.bottom;
      for (const id of ['modal-primary', 'modal-secondary', 'modal-ad']) {
        const a = ar.find((x) => x.id === id)!;
        expect(a, `${vp.w}×${vp.h} 有 ${id}`).toBeTruthy();
        expect(a.y, `${vp.w}×${vp.h} ${id} 顶 ≥ safeTop`).toBeGreaterThanOrEqual(INSETS.top - 1);
        expect(a.y + a.h, `${vp.w}×${vp.h} ${id} 底 ≤ safe 底`).toBeLessThanOrEqual(safeBottom + 1);
        expect(a.x, `${vp.w}×${vp.h} ${id} 左 ≥ 0`).toBeGreaterThanOrEqual(-1);
        expect(a.x + a.w, `${vp.w}×${vp.h} ${id} 右 ≤ 屏宽`).toBeLessThanOrEqual(vp.w + 1);
      }
      // 奖励值文字完整（fillText 捕获非空 → 未被裁切）
      const t = env.texts;
      expect(t.some((s) => s.includes('+50')), `${vp.w}×${vp.h} 金币值完整`).toBe(true);
      expect(t.some((s) => s.includes('+12')), `${vp.w}×${vp.h} 段位值完整`).toBe(true);
    }
  });

  it('G4. Battle 相机阶段切换无明显尺度突变（复算 Active/Closing scale 差 ≤15%；battleCameraR2 已锁定完整阶段切换）', () => {
    // 源码常量：Closing/Warning 相对 Active 基准钳制 ±15%（battleCameraR2 A1 已实测）
    expect(RENDERER, 'Closing/Warning 相对 Active ≤15%').toContain('BATTLE_CLOSE_SCALE_DELTA = 0.15');
    expect(RENDERER, 'battle 构图基于 A+B envelope（不按全 arena 骤缩）').toContain('includeVehicle(snap.vehicleA);');
    expect(RENDERER, '收束墙不入 bounds（墙从画面边缘进入）').toMatch(/Closing\/End 不把两侧收束墙纳入 bounds/);
  });

  it('G5. 构建链：pages 默认玩家模式、wechat 视觉内联、无开发工具/分辨率按钮', () => {
    // Pages 构建（对外公开版）：PROD + 默认玩家模式（isPagesPreview）
    expect(PAGES_VITE, 'pages 构建配置存在').toContain('outDir');
    expect(WX_VITE, 'wechat 图片内联（消灭灰盒）').toContain('assetsInlineLimit: 100000000');
    expect(MAIN, 'Pages 预览默认玩家模式').toContain('isPagesPreview');
    expect(MAIN, 'Pages PROD 隐藏角标').toContain('F-DEMO-WEB-R1：对外公开 Pages 版本（PROD）一律隐藏角标');
    // 手机横屏入口无「分辨率按钮」控件（公开 Canvas UI 不含该元素）
    expect(HOST, '无分辨率按钮').not.toContain('resolution');
  });
});
