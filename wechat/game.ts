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
import { resolveLayoutProfile } from '../src/ui/layoutProfile';
import { PlayerGameRuntime } from '../src/game/playerGameRuntime';
import { WechatBattleHost } from '../src/game/wechatBattleHost';
import { SingleLoop } from '../src/platform/wechat/singleLoop';
import { createViewportSync, type ViewportSyncReason } from '../src/platform/wechat/viewportSync';
import { installWechatErrorGuard } from '../src/platform/wechat/errorGuard';
import { APP_VERSION } from '../src/core/env';
import { PLAYER_LOGICAL_W, PLAYER_LOGICAL_H } from '../src/platform/playerViewport';
import { readWechatWindowInfo } from '../src/platform/wechat/windowInfo';
// F-BATTLE-READABILITY-R1：正式 Content 视觉（构建期 base64 内联 → wx.createImage 加载；
// 无此资源时 Renderer 灰盒 fallback——本加载使车辆显示正式 sprite，不再像 Physics Lab）
import bodyWatermelonUrl from '../assets/visuals/body_watermelon.png';
import bodyBananaUrl from '../assets/visuals/body_banana.png';
import partCannonUrl from '../assets/visuals/part_cannon.png';
import partHammerUrl from '../assets/visuals/part_hammer.png';
import partPushRodUrl from '../assets/visuals/part_pushRod.png';

const g = globalThis as any;
const wx = g.wx as any;

// —— 1) 唯一上屏 Canvas：第一次 wx.createCanvas()（微信真实规则：仅此画布最终上屏） ——
const screenCanvas = wx.createCanvas();
// F-WX-VIEWPORT-SURFACE-P0｜Must#1/#2/#3：微信首画布默认 width/height = window【逻辑】尺寸，
// 而整条链路（surface/UI/Input/诊断）按「canvas.width = 物理 backing = windowWidth×pixelRatio」
// 假设工作。必须在此【立刻】按 window×dpr 定版 backing，且必须发生在任何 surface / Renderer /
// UI mount / Input 绑定之前——否则所有 ×dpr 变换都作用在逻辑宽 buffer 上 → 全局放大+裁切。
// 官方高清渲染惯例：canvas.width = windowWidth × pixelRatio，绘制坐标系 = 逻辑 px（ctx ×dpr）。
const __wxInfo = readWechatWindowInfo();
const __backingDpr = (__wxInfo && __wxInfo.pixelRatio) || 1;
const __backingW =
  __wxInfo && __wxInfo.windowWidth > 0
    ? Math.max(1, Math.round(__wxInfo.windowWidth * __backingDpr))
    : screenCanvas.width;
const __backingH =
  __wxInfo && __wxInfo.windowHeight > 0
    ? Math.max(1, Math.round(__wxInfo.windowHeight * __backingDpr))
    : screenCanvas.height;
screenCanvas.width = __backingW;
screenCanvas.height = __backingH;
const screenCtx = screenCanvas.getContext('2d');
if (!screenCtx) throw new Error('Screen Canvas 2D not supported on WeChat');

// —— 2) UI offscreen Canvas（第二次 createCanvas = 离屏，不自动上屏） ——
// F-WX-P0：微信小游戏后续 createCanvas 均为离屏 canvas——不得假设「自动透明叠层」。
// UI 必须显式同步 screenCanvas 的物理像素尺寸（不能依赖第二次 createCanvas 的默认值），
// 再由 screenCtx.drawImage(uiCanvas) 逐帧合成上屏。
// F-WX-VIEWPORT-SURFACE-P0｜Must#3：uiCanvas 必须与 screenCanvas 完全同尺寸（同为
// window×dpr backing）——绝不允许一个是 844×dpr、另一个是 window×dpr。
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

// —— 4a) F-BATTLE-READABILITY-R1：正式 Content 视觉注册 + 微信图片加载 ——
// （wx.createImage 是微信小游戏唯一图片加载方式；base64 data URI 由构建内联，无需网络）
const SILHOUETTE_ASSETS: Array<[string, string]> = [
  ['body_watermelon', bodyWatermelonUrl],
  ['body_banana', bodyBananaUrl],
  ['part_cannon', partCannonUrl],
  ['part_hammer', partHammerUrl],
  ['part_pushRod', partPushRodUrl],
];
for (const [visualId, url] of SILHOUETTE_ASSETS) {
  visualRegistry.register(visualId, url);
  const img = wx.createImage();
  img.onload = () => visualRegistry.setImage(visualId, img);
  img.onerror = () => {
    // 加载失败：保持 registry 无 image → Renderer 灰盒 fallback（不白屏/不抛错）
  };
  img.src = url;
}

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
  // isResetDevVisible / onDevResetReload：微信恒 false / 无 reload（DEV ?resetdev 不可达）。
  // F-WX-IOS-CANVAS-CRASH-P0｜Must#6：「全部件×1」调试入口仅依赖独立标志 __WX_DEBUG_GRANT__
  // （内部 RC 构建开启）；普通微信 / 正式 prod 构建恒 false → 永不出现、无法误触。
  // 与 SHA 水印（__WX_BUILD_BADGE__）解耦；E2E probe 不再作为微信体验版 Debug 总开关。
  isResetDevVisible: () => (typeof __WX_DEBUG_GRANT__ !== 'undefined' && __WX_DEBUG_GRANT__),
});
runtime.init(); // 装载存档 + 绑定 actions + 初始预览/取景/渲染

// —— 9) 构建期版本日志（virtual:runtime-info：build 时 git 注入，非手写；Queue 号不作类型名） ——
// eslint-disable-next-line no-console
console.log(
  `[WECHAT-RUNTIME] ${runtimeInfo.branch} @ ${runtimeInfo.sha.slice(0, 7)} · ${APP_VERSION}`,
);

// —— 9a) F-WX-9A：DEV-only 一次性视口尺度日志（__WX_DEBUG__=true，WECHAT_DEBUG_INPUT=1 构建注入；
//         PROD false → 常量折叠零日志）。用于核对「测试尺寸 vs 真实微信尺寸」的尺度链。 ——
if (typeof __WX_DEBUG__ !== 'undefined' && __WX_DEBUG__) {
  const sys = wx.getSystemInfoSync ? wx.getSystemInfoSync() : {};
  const dpr = sys.pixelRatio || 1;
  const lw = screenCanvas.width / dpr;
  const lh = screenCanvas.height / dpr;
  const insets = platform.createViewport(screenCanvas).safeInsets();
  // eslint-disable-next-line no-console
  console.log(
    '[WX-VIEWPORT]',
    JSON.stringify({
      window: {
        width: typeof sys.windowWidth === 'number' ? sys.windowWidth : null,
        height: typeof sys.windowHeight === 'number' ? sys.windowHeight : null,
        pixelRatio: dpr,
        safeArea: sys.safeArea ?? null,
      },
      screenCanvas: { width: screenCanvas.width, height: screenCanvas.height },
      logicalViewport: { width: lw, height: lh },
      layoutProfile: resolveLayoutProfile(lw, lh).mode,
      safeInsets: insets,
      canvasMatchesWindow:
        Math.abs(lw - (typeof sys.windowWidth === 'number' ? sys.windowWidth : 0)) < 0.5 &&
        Math.abs(lh - (typeof sys.windowHeight === 'number' ? sys.windowHeight : 0)) < 0.5,
    }),
  );
}

// —— 9a2) F-WX-VIEWPORT-SURFACE-P0｜Must#1：微信尺寸全链诊断（__WX_DEBUG__=true 构建，
//         WECHAT_DEBUG_INPUT=1 注入）。boot（首尺寸定版，微信固定方向无运行时 resize）与
//         首帧各记录一次 logical / window / backing 三域数值链；PROD __WX_DEBUG__=false →
//         常量折叠零日志零行为。checks 用于判别「canvas.width 是物理 backing（window×DPR）
//         还是逻辑默认（window）」。 ——
function logSurfaceChain(step: 'resize' | 'frame'): void {
  if (typeof __WX_DEBUG__ === 'undefined' || !__WX_DEBUG__) return;
  const sys = wx.getSystemInfoSync ? wx.getSystemInfoSync() : {};
  const dpr = sys.pixelRatio || 1;
  const ww = typeof sys.windowWidth === 'number' ? sys.windowWidth : null;
  const wh = typeof sys.windowHeight === 'number' ? sys.windowHeight : null;
  const containS = ww !== null && wh !== null ? Math.min(ww / PLAYER_LOGICAL_W, wh / PLAYER_LOGICAL_H) : null;
  const containOx = containS !== null && ww !== null ? (ww - PLAYER_LOGICAL_W * containS) / 2 : null;
  const containOy = containS !== null && wh !== null ? (wh - PLAYER_LOGICAL_H * containS) / 2 : null;
  const ti = uiHost.getTransformInfo();
  // eslint-disable-next-line no-console
  console.log(
    '[WX-SURF]',
    JSON.stringify({
      step,
      // —— 坐标域标注：logical = 设计/布局 px；window = wx 窗口逻辑 px；backing = canvas 物理 px ——
      window: {
        width: ww, height: wh, // logical
        screenWidth: typeof sys.screenWidth === 'number' ? sys.screenWidth : null, // physical
        screenHeight: typeof sys.screenHeight === 'number' ? sys.screenHeight : null, // physical
        pixelRatio: dpr,
        safeArea: sys.safeArea ?? null, // logical
      },
      canvases: {
        screen: { width: screenCanvas.width, height: screenCanvas.height }, // backing
        ui: { width: uiCanvas.width, height: uiCanvas.height }, // backing
        uiMatchesScreen: uiCanvas.width === screenCanvas.width && uiCanvas.height === screenCanvas.height,
      },
      stageLogical: { width: PLAYER_LOGICAL_W, height: PLAYER_LOGICAL_H }, // 设计逻辑舞台
      // F-WX-VIEWPORT-SURFACE-P0：surface 契约 = 逻辑视口（backing ÷ dpr）——
      // renderer.viewWidth/viewHeight = 逻辑窗口尺寸；绘制经 setTransform(dpr) 一次映射 backing
      renderer: {
        viewWidth: screenCanvas.width / dpr,
        viewHeight: screenCanvas.height / dpr,
        viewDpr: dpr,
      }, // 逻辑 + dpr
      uiLayout: { cssW: ti.cssW, cssH: ti.cssH, dpr: ti.dpr, scale: ti.scale, ox: ti.ox, oy: ti.oy }, // logical
      contain: { scale: containS, offsetX: containOx, offsetY: containOy }, // logical→window
      windowToBacking: { scale: dpr }, // window→backing（应为 pixelRatio）
      finalLogicalToBacking: {
        // logical→backing 唯一最终变换（contain × DPR；offset 同乘）
        scale: containS !== null ? +(containS * dpr).toFixed(4) : null,
        offsetX: containOx !== null ? Math.round(containOx * dpr) : null,
        offsetY: containOy !== null ? Math.round(containOy * dpr) : null,
      },
      checks: {
        // canvas.width == windowWidth（原始值相等，非 /dpr）→ 画布停留在微信默认「逻辑尺寸」→ 链路塌缩（错）
        canvasIsLogicalDefault:
          ww !== null && wh !== null &&
          Math.abs(screenCanvas.width - ww) < 0.5 && Math.abs(screenCanvas.height - wh) < 0.5,
        // canvas.width == windowWidth × dpr → 画布是物理 backing（正确约定；dpr=1 时两判据数值重合）
        canvasIsBacking:
          ww !== null && wh !== null &&
          Math.abs(screenCanvas.width - ww * dpr) < 0.5 && Math.abs(screenCanvas.height - wh * dpr) < 0.5,
      },
    }),
  );
}

// —— 9b) F-WX-RCA-1：RCA 专用构建一次性视口日志（__WX_RCA__=true，仅 npm run build:wechat:rca；
//         PROD false → 常量折叠零日志）。Garage/Battle 段的 core/envelope 占比由 renderer
//         reframe 的 [WX-RCA] 输出（step=garage / step=battle）。 ——
if (typeof __WX_RCA__ !== 'undefined' && __WX_RCA__) {
  const sys = wx.getSystemInfoSync ? wx.getSystemInfoSync() : {};
  const dpr = sys.pixelRatio || 1;
  // eslint-disable-next-line no-console
  console.log(
    '[WX-RCA]',
    JSON.stringify({
      step: 'viewport',
      viewport: {
        logicalWidth: screenCanvas.width / dpr,
        logicalHeight: screenCanvas.height / dpr,
        dpr,
      },
      screenCanvas: { width: screenCanvas.width, height: screenCanvas.height },
    }),
  );
}

// —— 9c) F-WX-VIEWPORT-SURFACE-P0｜Must#1：boot 首尺寸定版记录（微信固定方向，无运行时 resize，
//          即「首次 resize」；首帧另记一次见 loop.onFrame）。仅 __WX_DEBUG__ 构建输出。 ——
logSurfaceChain('resize');

// —— 10) 每帧 UI 合成：把最新 UI offscreen canvas 作为最后一层画到唯一上屏 canvas ——
function compositeUi(): void {
  // F-WX-IOS-CANVAS-CRASH-P0｜Must#3：合成前显式恢复预期 transform（单位变换），
  // 不被上一帧世界相机变换污染；globalAlpha / globalCompositeOperation 复位为默认值；
  // 明确 source backing rect 与 destination backing rect，drawImage 仅执行一次；UI 离屏只作 overlay source。
  screenCtx.save();
  screenCtx.setTransform(1, 0, 0, 1, 0, 0);
  screenCtx.globalAlpha = 1;
  screenCtx.globalCompositeOperation = 'source-over';
  screenCtx.drawImage(
    uiCanvas,
    0,
    0,
    uiCanvas.width,
    uiCanvas.height,
    0,
    0,
    screenCanvas.width,
    screenCanvas.height,
  );
  screenCtx.restore();
}

// —— 11) 主循环（经共享 Platform Lifecycle；后台暂停 / 前台恢复） ——
/**
 * F-WX-RUNTIME-LIFECYCLE-P0（Must#3「onShow 只恢复一套循环 / 无重复 RAF」）：
 * 单循环守卫——任意时刻至多一个待执行帧。快速切后台再回前台 / 连续 onShow 不会起第二个
 * frame 循环（避免双倍 tick / 双倍渲染 / 双倍音频调度）。逻辑抽到 SingleLoop 以便单测。
 */
const loop = new SingleLoop(
  (cb) => platform.lifecycle.requestAnimationFrame(cb),
  (h) => platform.lifecycle.cancelAnimationFrame(h),
);
let surfFrameLogged = false;
loop.onFrame = (now: number) => {
  // F-WX-VIEWPORT-SURFACE-P0｜Must#1：首帧再记录一次（确认 boot 后无尺寸漂移）。
  if (!surfFrameLogged) {
    surfFrameLogged = true;
    logSurfaceChain('frame');
  }
  // 固定顺序（F-WX-P0）：Renderer 画 screenCanvas（Battle/Preview）→ UI Host 画 uiCanvas →
  // screenCtx.drawImage(uiCanvas) 作为最后一层。UI 透明区透出 Renderer。
  runtime.tick(now); // 战斗步进 + Matching B FX + 渲染 + 阶段/结果轮询 + HUD 帧
  compositeUi();
};

// —— 11a0) F-WX-IOS-RESUME-VIEWPORT-P0｜唯一视口同步入口（syncWechatViewport）。
// 所有 onShow / onWindowResize / transient 重试复用同一个入口（禁止两套尺寸逻辑）。
// 内部顺序（Queue 三节 1~11 步）：读 windowInfo → 判横屏稳定 → 同步双 Canvas backing →
// surface logical（getter 自动反映）→ PlayerViewportTransform（微信未实例化 no-op）→
// runtime.doResize（Renderer resize + reframe）→ UI Host forceRedraw → ctx DPR 单次变换 →
// 完成后 loop.start+request 恢复。竖屏 transient 不提交、有限帧重试；backing 内容清空
// 时同尺寸也重设 + 强制重绘（不依赖旧像素残留）。 ——
const viewportSync = createViewportSync({
  screenCanvas,
  uiCanvas,
  uiHost,
  runtime,
  loop,
  readWindowInfo: readWechatWindowInfo,
  scheduleRetry: (fn, ms) => setTimeout(fn, ms),
});

// 后台→前台：wx.onHide 暂停调度（微信会挂起 JS）；onShow 恢复 + 重置 dt 时钟防爆发。
// F-WX-RUNTIME-LIFECYCLE-P0：onHide 同时停止持续音源并清理交互瞬时状态（微信无 window，
// host 的 window 安全网恒不生效，必须在此显式处理）。
// F-WX-IOS-RESUME-VIEWPORT-P0：onShow 不再「只 reframe」——统一走唯一视口同步入口
// syncWechatViewport('show')（读 windowInfo → 判横屏稳定 → 同步双 Canvas backing →
// doResize/reframe → forceRedraw → 恢复 SingleLoop）。iOS 切后台返回时 window 可能短暂
// 报竖屏（390×844）或 canvas backing 被系统清空/重置——旧接线不回同步导致跨层错乱。
platform.lifecycle.onVisibilityChange((hidden) => {
  if (hidden) {
    loop.stop(); // 停 tick（含取消待执行帧）/ 清记账
    // Must#3/5：停止或暂停 tick（上）+ 持续音源 + 输入瞬时状态
    sfx.stopBattleAudio?.(); // 切后台停止全部循环战斗音源（回前台由新战斗重新登记，不叠加）
    uiHost.cancelInteraction(); // 清拖动 ghost / armed / 未闭合手势（不修改 Build 与存档）
  } else {
    runtime.resetClock(); // 防 dt 爆发（同步/重试期间不 tick）
    syncViewport('show'); // 唯一入口：读窗口→判横屏→同步 backing→doResize→forceRedraw→loop.start+request
  }
});

/**
 * F-WX-IOS-RESUME-VIEWPORT-P0｜唯一视口同步入口的微信接线（诊断 + 转发）。
 *
 * 所有 onShow / onWindowResize / transient 重试都必须经此转发到 createViewportSync 的
 * syncWechatViewport —— 不允许任何其它路径独立修改 canvas backing 或调用 runtime.doResize
 * （禁止两套尺寸逻辑）。
 *
 * 诊断：__WX_DEBUG__=true（WECHAT_DEBUG_INPUT=1 诊断构建）输出 [WX-VIEWPORT-SYNC] 单次
 * JSON；PROD false → 常量折叠零日志。不暴露 globalThis 句柄、不进最终 RC。
 */
function syncViewport(reason: ViewportSyncReason): void {
  const r = viewportSync.syncWechatViewport(reason);
  if (typeof __WX_DEBUG__ !== 'undefined' && __WX_DEBUG__) {
    // eslint-disable-next-line no-console
    console.log('[WX-VIEWPORT-SYNC]', JSON.stringify(r));
  }
}

// boot 首帧启动主循环（后续由 syncWechatViewport 的 loop.start+request 恢复）
loop.request();

// —— 11a) F-WX-VIEWPORT-SURFACE-P0｜Must#8 + F-WX-IOS-RESUME-VIEWPORT-P0：窗口尺寸变化
//   （DevTools 模拟器拖拽/横竖屏切换等，部分基础库存在 wx.onWindowResize）→ 统一走唯一
//   入口（读 windowInfo → 判横屏 → 同步两块 Canvas backing → runtime.doResize 重取景 →
//   forceRedraw → 恢复 loop）。不再保留独立的尺寸同步逻辑；竖屏 transient 值不会被提交。 ——
if (typeof wx.onWindowResize === 'function') {
  wx.onWindowResize(() => syncViewport('resize'));
}

// —— 12) 微信错误兜底（Must#7）：捕获未处理异常 / 拒绝，记录构建 SHA + 玩家阶段；
//         仅日志，不向玩家界面展示任何调试堆栈。wx 缺失 / 无钩子时安全降级。 ——
installWechatErrorGuard({
  wx: (globalThis as any).  wx,
  sha: runtimeInfo.sha,
  getPhase: () => (typeof runtime !== 'undefined' && runtime ? runtime.playerPhase : 'boot'),
});

// F-WX-IOS-CANVAS-CRASH-P0｜Must#5：SingleLoop 已捕获 onFrame 异常并续帧（避免静默卡死），
// 但异常根因不得被吞掉——首帧异常在此上报（SHA + 玩家阶段），供真机回溯。
loop.onError = (err) => {
  const msg = err instanceof Error ? err.message : String(err);
  const phase = typeof runtime !== 'undefined' && runtime ? runtime.playerPhase : 'boot';
  // eslint-disable-next-line no-console
  console.error(`[WECHAT-ERROR] sha=${runtimeInfo.sha.slice(0, 7)} phase=${phase} frame: ${msg}`);
};

// —— 13) 体验版 SHA 水印（F-WX-EXPERIENCE-RC-P0）：
// 仅 RC 体验构建（__WX_BUILD_BADGE__=true）在画面角落绘制短 SHA，供真人录屏确认版本；
// 正式发布构建（build:wechat，__WX_BUILD_BADGE__=false）→ 不注入 → 画面无 SHA（正式发布前可关闭）。
// F-WX-RC-REPRODUCIBLE-BUILD-P0：诊断 dirty 构建（wechat-rc.js --dirty → __WX_RC_DIRTY__=true）
// badge 显示 #<sha>-dirty（Must#4：临时诊断包，不伪装正式 RC）；正常 RC / 普通包无后缀。
if (typeof __WX_BUILD_BADGE__ !== 'undefined' && __WX_BUILD_BADGE__) {
  const dirty = typeof __WX_RC_DIRTY__ !== 'undefined' && __WX_RC_DIRTY__;
  uiHost.setBuildBadge(`#${runtimeInfo.sha.slice(0, 7)}${dirty ? '-dirty' : ''}`);
}

// 导出供调试 / headless smoke 断言（IIFE 下挂到全局返回对象）
export { runtime, renderer, uiHost, runtimeInfo, screenCanvas, uiCanvas };
