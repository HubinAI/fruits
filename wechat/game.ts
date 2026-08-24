/**
 * F-WX-P0｜微信小游戏正常玩家版本入口（唯一上屏 Canvas 合成链）。
 *
 * 组合已验证的三大件：WeChat Platform Adapter + CanvasPlayerUIHost + 现有 Gameplay Runtime
 * （PlayerGameRuntime，与 Web main.ts 共用同一份玩家流程，不复制 Gameplay）。
 *
 * 明确不加载：index.html / WebDomPlayerUIHost / Physics Lab（debugOverlay/Matter）/
 * Scenario / Runtime Debug Tools——正式玩家版本只有 Canvas + Renderer + 战斗 Runtime + 玩家 UI。
 *
 * 生命周期：
 * - 首行 import bootstrap-wechat：在业务模块求值前绑定 WechatCore（storage/lifecycle/input/
 *   viewport 全部微信实现；未绑定访问 fail-fast，无隐藏 Web fallback）；
 * - 正常玩家闭环：新账号 → Garage（装配/合成/金币段位）→ Matching（随机对手）→ MatchPreview
 *   （250ms 自动开战）→ Battle（HUD/阶段倒计时）→ Result（Reward/Economy/引导）→
 *   调整配置（回 Garage）/ 下一场（再战）→ 循环；
 * - 后台→前台：wx.onHide 暂停循环调度，onShow 恢复（runtime.resetClock 防 dt 爆发）；
 * - 刷新/重进：存档走 WechatStorage（getStorageSync），runtime.init 自动恢复 Build/Inventory/进度；
 * - 构建期版本：virtual:runtime-info 注入 build 时 SHA（非手写常量），启动日志 + 导出供平台层核对。
 *
 * F-WX-P0｜微信 Canvas 合成链（真实 Runtime 规则）：
 * - **第一次 wx.createCanvas() 是唯一上屏 Canvas（screenCanvas）**；后续 createCanvas 全部是
 *   离屏 Canvas（offscreen），**不会自动显示在屏幕上**——必须由玩家代码用
 *   screenCtx.drawImage(offscreen, ...) 合成到上屏 Canvas。
 * - 每帧固定顺序：Renderer 画 screenCanvas（Battle/Preview）→ UI Host 画 uiCanvas（offscreen）→
 *   screenCtx.drawImage(uiCanvas) 作为最后一层。UI 透明区透出 Renderer 画面。
 * - uiCanvas 尺寸必须显式同步 screenCanvas 物理像素；CanvasPlayerUIHost 的布局空间 =
 *   canvas.width / pixelRatio（逻辑 px），与微信触摸坐标（clientX/clientY 逻辑 px）同体系，
 *   无需额外换算。
 *
 * 环境缺口（如实报告）：本沙箱无法启动微信开发者工具，实机「开发者工具真打开 / Canvas≥10s /
 * 车辆·Projectile·Damage·Physics」以 headless smoke（tests/wechatPlayerSmoke.test.ts）+
 * bundle 静态分析间接验证，未用普通 Web build 冒充。
 */
import '../src/platform/bootstrap-wechat';
import runtimeInfo from 'virtual:runtime-info';
import { platform } from '../src/platform';
import { Renderer } from '../src/render/renderer';
import { VisualRegistry } from '../src/render/visualRegistry';
import { SfxAudioService } from '../src/presentation/audioService';
import { createPlayerPresentation } from '../src/presentation/playerPresentation';
import { CanvasPlayerUIHost } from '../src/ui/canvasPlayerUIHost';
import { PlayerGameRuntime } from '../src/game/playerGameRuntime';
import { WechatBattleHost } from '../src/game/wechatBattleHost';
import { APP_VERSION } from '../src/core/env';

const g = globalThis as any;
const wx = g.wx as any;

// —— 1) 唯一上屏 Canvas：第一次 wx.createCanvas()（微信真实规则：仅此画布最终上屏） ——
const screenCanvas = wx.createCanvas();
const screenCtx = screenCanvas.getContext('2d');
if (!screenCtx) throw new Error('Screen Canvas 2D not supported on WeChat');

// —— 2) UI offscreen Canvas（第二次 createCanvas = 离屏，不自动上屏） ——
// F-WX-P0：微信小游戏后续 createCanvas 均为离屏 canvas——不得假设「自动透明叠层」。
// UI 必须显式同步 screenCanvas 的物理像素尺寸（不能依赖第二次 createCanvas 的默认值），
// 再由 screenCtx.drawImage(uiCanvas) 逐帧合成上屏。
const uiCanvas = wx.createCanvas();
uiCanvas.width = screenCanvas.width;
uiCanvas.height = screenCanvas.height;
const uiCtx = uiCanvas.getContext('2d');
if (!uiCtx) throw new Error('UI Canvas 2D not supported on WeChat');

// —— 3) 视口 surface（经共享 Platform Viewport 抽象；bootstrap 已绑定 WechatCore） ——
const surface = platform.createViewport(screenCanvas).surface();

// —— 4) Renderer（画 screenCanvas；注入 surface，不感知平台；无正式 Content → 灰盒绘制） ——
const visualRegistry = new VisualRegistry();
const renderer = new Renderer(screenCanvas as unknown as HTMLCanvasElement, visualRegistry, surface);

// —— 5) 表现层（共享接线；微信无 Web Audio → SfxAudioService 惰性 no-op；无 timeScale 定格） ——
const sfx = new SfxAudioService();
const presentation = createPlayerPresentation(renderer, sfx);

// —— 6) 微信精简战斗宿主（PlanckBattleOrchestrator + Renderer + Presentation；无 lab/debug） ——
const battleHost = new WechatBattleHost(renderer, presentation);

// —— 7) 玩家 UI：CanvasPlayerUIHost（画 uiCanvas offscreen；布局空间 = 物理/pixelRatio 逻辑 px） ——
const uiHost = new CanvasPlayerUIHost(uiCanvas as unknown as HTMLCanvasElement);
uiHost.mountCanvas();

// —— 8) 玩家 Gameplay Runtime（与 Web 同一份流程；微信侧无 DEV 钩子） ——
const runtime = new PlayerGameRuntime({
  host: uiHost,
  battle: battleHost,
  sfx, // AudioContext 缺失 → play/resume 安全 no-op
  // isResetDevVisible / onDevResetReload：微信恒 false / 无 reload（DEV ?resetdev 不可达）
});
runtime.init(); // 装载存档 + 绑定 actions + 初始预览/取景/渲染

// —— 9) 构建期版本日志（virtual:runtime-info：build 时 git 注入，非手写；Queue 号不作类型名） ——
// eslint-disable-next-line no-console
console.log(
  `[WECHAT-RUNTIME] ${runtimeInfo.branch} @ ${runtimeInfo.sha.slice(0, 7)} · ${APP_VERSION}`,
);

// —— 10) 每帧 UI 合成：把最新 UI offscreen canvas 作为最后一层画到唯一上屏 canvas ——
function compositeUi(): void {
  // 上一帧 Renderer 可能残留非单位变换；合成必须用单位变换 1:1 覆盖。
  screenCtx.save();
  screenCtx.setTransform(1, 0, 0, 1, 0, 0);
  screenCtx.drawImage(uiCanvas, 0, 0, uiCanvas.width, uiCanvas.height);
  screenCtx.restore();
}

// —— 11) 主循环（经共享 Platform Lifecycle；后台暂停 / 前台恢复） ——
let running = true;
let rafHandle: number | null = null;

function frame(now: number): void {
  if (!running) return;
  // 固定顺序（F-WX-P0）：Renderer 画 screenCanvas（Battle/Preview）→ UI Host 画 uiCanvas →
  // screenCtx.drawImage(uiCanvas) 作为最后一层。UI 透明区透出 Renderer。
  runtime.tick(now); // 战斗步进 + Matching B FX + 渲染 + 阶段/结果轮询 + HUD 帧
  compositeUi();
  if (running) rafHandle = platform.lifecycle.requestAnimationFrame(frame);
}

// 后台→前台：wx.onHide 暂停调度（微信会挂起 JS）；onShow 恢复 + 重置 dt 时钟防爆发
platform.lifecycle.onVisibilityChange((hidden) => {
  if (hidden) {
    running = false;
    if (rafHandle !== null) {
      platform.lifecycle.cancelAnimationFrame(rafHandle);
      rafHandle = null;
    }
  } else {
    running = true;
    runtime.resetClock();
    rafHandle = platform.lifecycle.requestAnimationFrame(frame);
  }
});

rafHandle = platform.lifecycle.requestAnimationFrame(frame);

// 导出供调试 / headless smoke 断言（IIFE 下挂到全局返回对象）
export { runtime, renderer, uiHost, runtimeInfo, screenCanvas, uiCanvas };
