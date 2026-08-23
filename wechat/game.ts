/**
 * F-WX-1｜微信小游戏 Battle Runtime 最小实机 Spike 入口（F-WX-2 已接入 Platform Core）。
 *
 * 目标（与验收一一对应）：
 * - 完全不依赖正式 Garage / Result / DOM UI；只含 Platform boot + Canvas + Renderer
 *   + Planck Battle + 固定 Build（Queue F-WX-1 必改 1/2/3/4）；
 * - 不使用 document / HTMLElement / localStorage / DOM event（必改 2）；
 * - 复用现有正式 Registry / BuildSnapshot / PlanckBattleOrchestrator / Renderer，
 *   不复制第二套 Physics / Battle（必改 3）；
 * - 仅做很小的平台边界修复（CanvasSurface 注入），不重写 Renderer（必改 4）。
 *
 * 本文件是唯一的平台入口，所有 gameplay/physics 均来自 src/ 正式模块。
 * 平台能力（storage/lifecycle/viewport/input）经 src/platform/wechat 的
 * createWechatCore 统一抽象，与 Web 侧的 platform 单例对称。
 *
 * 注意：本沙箱无法启动微信开发者工具，故无法在此实机打开；本文件经 scoped tsc +
 * 微信构建（vite.wechat.config.ts → dist-wechat/game.js）+ bundle DOM-free 静态校验
 * 验证可导入与平台中立性。真实「Canvas 连续运行 ≥10s / 无依赖错误」需在微信开发者工具
 * 中执行（见根目录验收缺口说明）。
 */
import { registry } from '../src/core/content';
import { makeStarterDraft, buildSnapshotFromDraft } from '../src/lab/buildEditorModel';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import { Renderer } from '../src/render/renderer';
import { VisualRegistry } from '../src/render/visualRegistry';
import { createWechatCore } from '../src/platform/wechat';

const g = globalThis as any;
const wx = g.wx as any;

// —— Platform Core（微信实现）：storage/lifecycle/viewport/input 统一抽象 ——
const sys = wx.getSystemInfoSync();
const core = createWechatCore(sys.pixelRatio || 1);

// —— 1) 主画布（微信：首个 createCanvas 返回屏幕尺寸的显示画布） ——
const canvas = wx.createCanvas();
const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('Canvas 2D not supported on WeChat');

// —— 2) 视口 surface（经 Platform Viewport 抽象，非直接读 window） ——
const surface = core.createViewport(canvas).surface();

// —— 3) 固定合法 Build A/B（复用正式 Starter + BuildSnapshot） ——
const buildA = buildSnapshotFromDraft(makeStarterDraft('boxBody', registry), registry, 'wechatA');
const buildB = buildSnapshotFromDraft(makeStarterDraft('wedgeBody', registry), registry, 'wechatB');

// —— 4) 正式 Battle（复用 PlanckBattleOrchestrator，禁止第二套 Physics/Battle） ——
const orchestrator = new PlanckBattleOrchestrator(buildA, buildB, registry, {
  autoDrive: true,
});

// —— 5) Renderer（注入 surface，不感知平台） ——
const visualRegistry = new VisualRegistry();
const renderer = new Renderer(canvas as unknown as HTMLCanvasElement, visualRegistry, surface);

// —— 6) 初始取景一次 ——
const snap0 = orchestrator.getRenderSnapshot();
renderer.resize(snap0.arena.width, orchestrator.arena.config.height);
renderer.reframe(snap0, 'battle', { phase: orchestrator.phase });

// —— 7) 驱动循环（经 Platform Lifecycle：wx.requestAnimationFrame；缺失则 setTimeout 兜底） ——
let lastPhase = orchestrator.phase;
let running = true;

function frame(): void {
  if (!running) return;
  // 固定步长推进（≈60Hz），禁止按真实帧累计（与正式 Foundation 一致）
  orchestrator.step(16.6667);
  const phase = orchestrator.phase;
  if (phase !== lastPhase) {
    lastPhase = phase;
    renderer.reframe(orchestrator.getRenderSnapshot(), 'battle', { phase });
  }
  renderer.render(orchestrator);
  if (orchestrator.result) {
    // 战斗结束（约 18s：Active10 + Warning3 + Closing5）→ spike 验证可运行 ≥10s 达成
    running = false;
    return;
  }
  core.lifecycle.requestAnimationFrame(frame);
}

core.lifecycle.requestAnimationFrame(frame);

// 导出供外部调试（不影响运行；IIFE 下挂到全局返回对象）
export { orchestrator, renderer };
