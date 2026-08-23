/**
 * F-WX-5｜微信小游戏正常玩家版本入口（Integration Gate）。
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

// —— 1) 主画布（微信：首个 createCanvas 返回屏幕尺寸的显示画布） ——
const canvas = wx.createCanvas();
const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('Canvas 2D not supported on WeChat');

// F-WX-8-A｜P0 修复：玩家 UI 必须用独立的第二个 canvas（UI overlay）。
// 根因：此前 CanvasPlayerUIHost 与 Renderer 共享同一个主 canvas——Renderer.render() 每帧
// clearRect + 全屏深色背景（renderer.ts），第一个 rAF tick 就把 CanvasHost 画的 Garage UI
// 完全覆盖，玩家首屏只剩「战场」场景（地面线 + preview 车辆），Garage 不可见。
// 微信小游戏支持多 canvas 层叠（后 createCanvas 的在上层、默认透明）：UI overlay 叠在
// 主画布之上，与 Web 版（main.ts 的 Renderer battle canvas + CanvasHost 独立 overlay canvas）
// 结构一致；CanvasHost.clear() 只 clearRect 不画背景（透明透出 renderer 场景）。
const uiCanvas = wx.createCanvas();
const uiCtx = uiCanvas.getContext('2d');
if (!uiCtx) throw new Error('UI Canvas 2D not supported on WeChat');

// —— 2) 视口 surface（经共享 Platform Viewport 抽象；bootstrap 已绑定 WechatCore） ——
const surface = platform.createViewport(canvas).surface();

// —— 3) Renderer（注入 surface，不感知平台；无正式 Content 资源 → 灰盒 Collider 绘制） ——
const visualRegistry = new VisualRegistry();
const renderer = new Renderer(canvas as unknown as HTMLCanvasElement, visualRegistry, surface);

// —— 4) 表现层（共享接线；微信无 Web Audio → SfxAudioService 惰性 no-op；无 timeScale 定格） ——
const sfx = new SfxAudioService();
const presentation = createPlayerPresentation(renderer, sfx);

// —— 5) 微信精简战斗宿主（PlanckBattleOrchestrator + Renderer + Presentation；无 lab/debug） ——
const battleHost = new WechatBattleHost(renderer, presentation);

// —— 6) 玩家 UI：CanvasPlayerUIHost（同一 State/Action；独立 UI overlay canvas，无 DOM） ——
const uiHost = new CanvasPlayerUIHost(uiCanvas as unknown as HTMLCanvasElement);
uiHost.mountCanvas();

// —— 7) 玩家 Gameplay Runtime（与 Web 同一份流程；微信侧无 DEV 钩子） ——
const runtime = new PlayerGameRuntime({
  host: uiHost,
  battle: battleHost,
  sfx, // AudioContext 缺失 → play/resume 安全 no-op
  // isResetDevVisible / onDevResetReload：微信恒 false / 无 reload（DEV ?resetdev 不可达）
});
runtime.init(); // 装载存档 + 绑定 actions + 初始预览/取景/渲染

// —— 8) 构建期版本日志（virtual:runtime-info：build 时 git 注入，非手写） ——
// eslint-disable-next-line no-console
console.log(`[F-WX-5] ${runtimeInfo.branch} @ ${runtimeInfo.sha.slice(0, 7)} · ${APP_VERSION}`);

// —— 9) 主循环（经共享 Platform Lifecycle；后台暂停 / 前台恢复） ——
let running = true;
let rafHandle: number | null = null;

function frame(now: number): void {
  if (!running) return;
  runtime.tick(now); // 战斗步进 + Matching B FX + 渲染 + 阶段/结果轮询 + HUD 帧
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
export { runtime, renderer, uiHost, runtimeInfo };
