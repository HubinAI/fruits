/**
 * 入口：Build 测试交互 UI（Q06-UX-R1 重构，P0）。
 *
 * F-WX-3：正常玩家 UI 已抽到唯一 PlayerUIHost 边界（WebDomPlayerUIHost / CanvasPlayerUIHost）。
 * F-WX-5：正常玩家 Gameplay 流程（Garage / Matching / Battle / Result / Reward / 经济 /
 * 引导 / 存档副作用 / 埋点 / 广告）已抽到平台中立 PlayerGameRuntime（src/game/playerGameRuntime.ts），
 * Web 与微信双入口复用同一份逻辑。本文件只负责：
 * - Web 平台接线：DOM 创建 / Renderer / Presentation / PhysicsLab（DEV 能力：Preview + 时间缩放）；
 * - DEV Scenario / Physics Lab / Runtime Debug Tools（保留 Web-only，不进 PlayerUIHost）；
 * - Web-only 表现钩子（场边红脉冲 / Death 定格 / DEV 面板重渲染 / Build 控件锁定 DOM）；
 * - 主循环调度（platform.lifecycle.requestAnimationFrame → runtime.tick）。
 *
 * 单一清晰流程：配置 → 实时预览 → 开战 → 结果 → 调整 → 再战（流程状态机在 runtime）。
 */
// F-WX-2.1：Web 启动 bootstrap 必须是第一个 import —— 在业务模块（含顶层读 storage 的
// adFrequency）求值前绑定 WebCore，否则它们会读到未绑定/错误平台的 Storage。
import './platform/bootstrap';
import { Renderer, type CameraFit } from './render/renderer';
import { platform } from './platform';
import { PlayerViewportTransform, PLAYER_LOGICAL_W, PLAYER_LOGICAL_H } from './platform/playerViewport';
import { VisualRegistry } from './render/visualRegistry';
import { SfxAudioService } from './presentation/audioService';
import { createPlayerPresentation } from './presentation/playerPresentation';
import { DeathPauseScheduler } from './presentation/battlePhaseFx';
// W2-SIL-1：5 个首批正式 Content 视觉占位（程序化轮廓 PNG；正式美术可替换）
import bodyWatermelonUrl from '../assets/visuals/body_watermelon.png';
import bodyBananaUrl from '../assets/visuals/body_banana.png';
import partCannonUrl from '../assets/visuals/part_cannon.png';
import partHammerUrl from '../assets/visuals/part_hammer.png';
import partPushRodUrl from '../assets/visuals/part_pushRod.png';
import { PhysicsLab } from './lab/physicsLab';
import { SCENARIOS, type ScenarioCamera } from './lab/scenarios';
import { PRESETS } from './lab/presets';
import { TIME_SCALES } from './render/debugOverlay';
import { BattleOrchestrator } from './battle/battleOrchestrator';
import { PlanckBattleOrchestrator } from './battle/planckBattleOrchestrator';
import type { BattleOrchestratorApi } from './battle/battleContract';
// F-WX-5：玩家 Gameplay Runtime（Web/微信共用）+ 战斗宿主接口
import { PlayerGameRuntime } from './game/playerGameRuntime';
import type { PlayerBattleHost } from './game/playerGameRuntime';

// F-DEV-1：Runtime 版本信息（vite 虚拟模块注入，git 读取非手写常量）
import runtimeInfo from 'virtual:runtime-info';
import { registry } from './core/content';
import {
  editableSlots,
  migrateDraftBody,
  slotLabel,
  EMPTY_SLOT,
  type BuildDraft,
} from './lab/buildEditorModel';
import { computeEnergy } from './core/buildValidator';
// Q22：星级统一倍率（用于 Garage 卡片展示 2★ 实际 Energy）
import { starTierEnergy } from './core/buildSnapshot';
import { DEV_TOOLS_VISIBLE, APP_VERSION } from './core/env';
// F-WX-3/4：玩家 UI Host（Web DOM 实现 / Canvas 实现；同一 State/Action）
import { WebDomPlayerUIHost } from './ui/webDomPlayerUIHost';
import { CanvasPlayerUIHost } from './ui/canvasPlayerUIHost';
// F-UX-REVIEW-1：DEV Mobile Review 纯逻辑（PC 复现手机 logical viewport；游戏内部零改动）
import {
  REVIEW_PRESETS,
  createMobileReviewState,
  selectReviewPreset,
  toggleReviewScale,
  reviewViewport,
  reviewContainerStyle,
} from './dev/reviewMode';
import {
  BODY_OPTIONS,
  WHEEL_OPTIONS,
  encodePartVal,
  decodePartVal,
} from './ui/playerUI';
import type { UiMode, PlayerUIHost } from './ui/playerUI';
// Q22：V0.5 部件库存（DEV 面板只读库存展示 + 装备校验）
import { canEquipPart, getInventory, getCount, OFFICIAL_PARTS } from './core/partInventory';

const app = document.getElementById('app')!;

// Q31｜Release Config：开发工具（Scenario / Runtime Debug Tools / 对手编辑）仅在非 PROD 可见
const TOOLS_DEV_VISIBLE: string = DEV_TOOLS_VISIBLE ? '' : 'none';

// F-WX-6.1：Pages Preview 构建标志（仅 vite.pages.config.ts define 注入；普通构建为 undefined）
const isPagesPreview: boolean =
  typeof __PAGES_PREVIEW__ !== 'undefined' && __PAGES_PREVIEW__ === true;

// F-DEMO-PLAYER-RUNTIME-P0：统一的「手机玩家演示入口」模式判定（必须早于 badge / 结构段声明，
// 因 badge 与 DEV DOM 创建都依赖它）。
//   playerMode = Pages 预览 / __PLAYER_MODE__ 本地构建标志 / ?player=1 任一为真；
//   玩家模式结构性禁止挂载 DEV 工具栏 / panelA·panelB 侧栏 / Physics Lab 与开发工具 /
//   WebDomPlayerUIHost / Debug 面板与版本角标，强制 CanvasPlayerUIHost。
const PLAYER_MODE_BUILD =
  typeof __PLAYER_MODE__ !== 'undefined' && __PLAYER_MODE__ === true;
const playerMode =
  isPagesPreview ||
  PLAYER_MODE_BUILD ||
  new URLSearchParams(location.search).has('player');

// F-DEV-1：Runtime Badge——仅开发 / 内部 RC（dev/test，DEV_TOOLS_VISIBLE=true）且非玩家模式显示
// branch + short SHA + 版本号，用于确认「运行画面 = 刚构建的 commit」；
// F-DEMO-WEB-R1：对外公开 Pages 版本（PROD）一律隐藏角标（不再因 isPagesPreview 显示）；
// F-DEMO-PLAYER-RUNTIME-P0：玩家模式（含 Pages 预览）也隐藏角标，满足「页面不显示调试内容 / 版本调试角标」验收。
// SHA 仍经 runtimeInfoPlugin 注入包内，可追溯但不以可见角标形式出现。
if (DEV_TOOLS_VISIBLE && !playerMode) {
  const badge = document.createElement('div');
  badge.style.cssText =
    'position:fixed;right:8px;bottom:8px;z-index:9999;font:11px/1.4 monospace;' +
    'color:#8fa3c8;background:rgba(15,20,30,0.72);border:1px solid #2a3140;' +
    'border-radius:6px;padding:4px 8px;pointer-events:none;';
  badge.textContent = `${runtimeInfo.branch} @ ${runtimeInfo.sha.slice(0, 7)} · ${APP_VERSION}`;
  document.body.appendChild(badge);
}

/* ---------- 样式 ---------- */
const style = document.createElement('style');
style.textContent = `
  .lab-root { display: flex; flex-direction: column; height: 100vh; }
  .lab-toolbar { display: flex; gap: 8px; align-items: center; padding: 8px 12px; background: #171c26; border-bottom: 1px solid #2a3140; flex-wrap: wrap; }
  .lab-toolbar button, .lab-toolbar select { background: #242b38; color: #e8e8f0; border: 1px solid #38414f; border-radius: 6px; padding: 6px 10px; cursor: pointer; font-size: 13px; }
  .lab-toolbar button:hover { background: #2e3747; }
  .lab-toolbar button.active { background: #3b6fd4; border-color: #4a7fe0; }
  .lab-toolbar button:disabled { opacity: 0.45; cursor: not-allowed; }
  .lab-toolbar button:disabled:hover { background: #242b38; }
  .lab-main { display: flex; flex: 1; min-height: 0; }
  .lab-panel { width: 210px; padding: 12px; background: #171c26; border-right: 1px solid #2a3140; overflow-y: auto; }
  .lab-panel.right { border-right: none; border-left: 1px solid #2a3140; }
  .lab-panel h3 { font-size: 13px; color: #ffd35a; margin: 10px 0 6px; }
  .lab-panel label { display: block; font-size: 12px; color: #9aa4b5; margin-top: 8px; }
  .lab-panel select { width: 100%; margin-top: 2px; background: #242b38; color: #e8e8f0; border: 1px solid #38414f; border-radius: 4px; padding: 4px; }
  .lab-panel select:disabled { opacity: 0.45; cursor: not-allowed; }
  .lab-canvas-wrap { flex: 1; position: relative; }
  .lab-canvas-wrap canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
  .lab-debug { position: absolute; right: 8px; bottom: 8px; background: rgba(10,12,16,0.85); padding: 10px; border-radius: 8px; max-height: 62vh; overflow-y: auto; font-size: 12px; }
  .lab-debug label { display: block; color: #c8d0e0; margin: 3px 0; }
  .lab-debug input[type=number] { width: 64px; background: #242b38; color: #e8e8f0; border: 1px solid #38414f; border-radius: 4px; padding: 2px 4px; }
  .lab-debug h4 { color: #ffd35a; margin: 6px 0 4px; }
  .battle-hud { position: absolute; top: 0; left: 0; right: 0; display: none; justify-content: space-between; align-items: center; padding: 10px 18px; z-index: 5; pointer-events: none; }
  .hud-side { display: flex; align-items: center; gap: 8px; }
  .hud-team { font-size: 15px; font-weight: 700; }
  .hud-bar-wrap { width: 170px; height: 10px; background: #232b38; border: 1px solid #38414f; border-radius: 5px; overflow: hidden; }
  .hud-bar-fill { height: 100%; width: 100%; }
  .hud-hp { font-size: 13px; color: #e8e8f0; font-variant-numeric: tabular-nums; }
  .hud-phase { font-size: 14px; color: #ffd35a; letter-spacing: 2px; }
  /* W2-FX-2：Warning 阶段倒计时（中央，3→2→1） */
  .phase-countdown { position: absolute; left: 50%; top: 54px; transform: translateX(-50%); font-size: 44px; font-weight: 800; color: #ff6b5e; text-shadow: 0 0 14px rgba(255,90,80,0.8); display: none; pointer-events: none; }
  /* W2-FX-2：场边红色脉冲（Warning 阶段） */
  .lab-canvas-wrap.phase-warning::before,
  .lab-canvas-wrap.phase-warning::after { content: ''; position: absolute; top: 0; bottom: 0; width: 10px; z-index: 4; pointer-events: none; animation: phase-pulse 0.9s ease-in-out infinite; }
  .lab-canvas-wrap.phase-warning::before { left: 0; background: linear-gradient(90deg, rgba(255,60,50,0.85), rgba(255,60,50,0)); }
  .lab-canvas-wrap.phase-warning::after { right: 0; background: linear-gradient(270deg, rgba(255,60,50,0.85), rgba(255,60,50,0)); }
  @keyframes phase-pulse { 0%, 100% { opacity: 0.35; } 50% { opacity: 1; } }
  /* Q08-B：Result 明确结束层——背景进一步压暗，胜负为第一视觉信息，HP 降为次级 */
  .result-modal { position: absolute; inset: 0; background: rgba(4,6,10,0.78); display: none; align-items: center; justify-content: center; z-index: 10; }
  .result-card { background: #1c2330; border: 1px solid #38414f; border-radius: 14px; padding: 34px 58px; text-align: center; min-width: 420px; }
  .result-title { margin: 0 0 20px; font-size: 44px; letter-spacing: 8px; }
  .result-hp { margin: 5px 0; font-size: 14px; color: #8a93a5; }
  .result-actions { display: flex; gap: 12px; justify-content: center; margin-top: 22px; }
  .result-actions button { background: #242b38; color: #e8e8f0; border: 1px solid #38414f; border-radius: 8px; padding: 10px 22px; cursor: pointer; font-size: 14px; }
  .result-actions button:hover { background: #2e3747; }
  .result-actions button.primary { background: #3b6fd4; border-color: #5a8df0; color: #fff; font-size: 16px; font-weight: 700; padding: 12px 34px; box-shadow: 0 4px 14px rgba(59,111,212,0.35); }
  .result-actions button.primary:hover { background: #4a7fe0; }
  .result-actions button.secondary { opacity: 0.85; }
  /* Q21：战斗奖励区（进入 Result 时已自动入库，无领取按钮） */
  .result-reward { display: flex; flex-direction: column; align-items: center; gap: 2px; margin: 10px 0 4px;
    padding: 10px 16px; background: #1c2230; border: 1px solid #38414f; border-radius: 10px; }
  .result-reward .rr-label { font-size: 12px; color: #9aa4b5; letter-spacing: 2px; }
  .result-reward .rr-name { font-size: 22px; font-weight: 700; color: #ffd479; }
  .result-reward .rr-cat { font-size: 12px; color: #7c8799; }
  /* Q22：Garage 内合成 Panel（极简，不新页面） */
  .merge-panel { margin: 12px 0 4px; padding: 10px 14px; background: #1c2230; border: 1px solid #38414f; border-radius: 10px; display: flex; flex-direction: column; gap: 6px; }
  .merge-panel .mp-title { font-size: 13px; font-weight: 700; color: #c8d0e0; }
  .merge-panel .mp-info { font-size: 12px; color: #9aa4b5; }
  .merge-panel .mp-btn { align-self: flex-start; background: #2a3a5e; color: #dce6ff; border: 1px solid #3b6fd4; border-radius: 6px; padding: 6px 14px; cursor: pointer; font-size: 13px; }
  .merge-panel .mp-btn:disabled { opacity: 0.45; cursor: not-allowed; border-color: #38414f; background: #242b38; color: #7c8799; }
  /* Q23：车库顶部状态条（金币 / 段位） */
  .dock-stats { display: flex; gap: 14px; align-items: baseline; padding: 8px 12px; background: #161c28; border: 1px solid #2a3140; border-radius: 8px; font-size: 13px; color: #9aa4b5; }
  .dock-stats b { color: #ffd35a; font-size: 15px; }
  /* Q26：首轮引导提示（仅全新账号首 Garage 显示；极简 banner，非遮罩、不阻断操作） */
  .dock-onboard { padding: 8px 12px; background: #15233a; border: 1px solid #2f5fa0; border-radius: 8px; font-size: 13px; color: #bcd4ff; }
  /* Q27：DEV 重置入口（仅 ?resetdev=1 可见，正常游玩不可达） */
  .dock-dev-reset { padding: 6px 10px; background: #3a1f1f; border: 1px solid #a04a4a; border-radius: 8px; font-size: 12px; color: #ffbdbd; cursor: pointer; }
  /* Q23→Q24：结算卡经济/段位区 */
  .result-economy { display: flex; flex-direction: column; gap: 2px; padding: 8px 12px; background: #1c2230; border: 1px solid #38414f; border-radius: 8px; }
  .result-economy .re-label { font-size: 14px; font-weight: 700; color: #ffd35a; }
  .result-economy .re-cat { font-size: 12px; color: #9aa4b5; }
  /* Q26：首轮引导提示（仅全新账号首场 Result 显示；极简、非遮罩） */
  .result-onboard { margin: 6px auto 0; padding: 8px 14px; background: #15233a; border: 1px solid #2f5fa0; border-radius: 8px; font-size: 13px; color: #bcd4ff; }
  /* Q07-A：开发工具折叠区（机制场景 / Pause/Reset/Clear / 速度 / Preset 收进二级） */
  .tool-tools-host { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 6px 12px; background: #1b2130; border-bottom: 1px solid #2a3140; width: 100%; flex-shrink: 0; box-sizing: border-box; }
  .tool-tools-host .tool-tools-label { font-size: 12px; color: #9aa4b5; margin-right: 4px; }
  .tool-tools-host button, .tool-tools-host select { background: #242b38; color: #e8e8f0; border: 1px solid #38414f; border-radius: 6px; padding: 5px 9px; cursor: pointer; font-size: 12px; }
  .tool-tools-host select { min-width: 280px; }
  .tool-tools-host button:disabled { opacity: 0.45; cursor: not-allowed; }
  .tool-tools-host .preset-box { display: inline-flex; gap: 4px; align-items: center; margin-left: 6px; flex-wrap: wrap; }
  .tool-tools-host .preset-box h3 { display: inline; font-size: 12px; color: #ffd35a; margin: 0 4px 0 0; }
  .tool-tools-host .preset-box button { padding: 3px 7px; }
  /* W2-UX-R2：B 测试对手折叠（默认收起，降低首屏信息量） */
  .panel-collapse { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .panel-collapse h3 { margin: 10px 0 6px; }
  .panel-collapse button { background: #242b38; color: #e8e8f0; border: 1px solid #38414f; border-radius: 6px; padding: 4px 9px; cursor: pointer; font-size: 12px; }
  .panel-collapse button:disabled { opacity: 0.45; cursor: not-allowed; }
  /* Q07-A：开发工具入口弱化（不再是与 Start 同级的主操作） */
  .dev-toggle { font-size: 12px; opacity: 0.72; margin-left: auto; }
  .dev-toggle:hover { opacity: 1; }
  /* Q07-A：Start 唯一主 CTA——画布底部固定大按钮，合法高亮可点 / 非法禁用 + 就近原因 */
  .start-bar { position: absolute; left: 0; right: 0; bottom: 14px; display: flex; justify-content: center; align-items: center; gap: 14px; z-index: 6; pointer-events: none; }
  .start-bar .btn-start-cta { pointer-events: auto; font-size: 17px; font-weight: 700; letter-spacing: 3px; padding: 12px 48px; background: #3b6fd4; border: 1px solid #5a8df0; color: #fff; border-radius: 10px; cursor: pointer; box-shadow: 0 4px 16px rgba(59,111,212,0.4); }
  .start-bar .btn-start-cta:hover { background: #4a7fe0; }
  .start-bar .btn-start-cta:disabled { background: #262e3d; border-color: #38414f; color: #7c8799; box-shadow: none; cursor: not-allowed; }
  .start-bar .start-hint { pointer-events: auto; color: #ff6b5e; font-size: 13px; max-width: 280px; line-height: 1.5; }
  /* Q07-A：对手概要（B 默认折叠时显示；不展开完整表单） */
  .opponent-summary { font-size: 12px; color: #9aa4b5; padding: 4px 0 2px; line-height: 1.6; }
  .opponent-summary .os-name { color: #ffd35a; font-weight: 600; }
  .opponent-summary .os-parts { margin-top: 2px; font-size: 11px; color: #7c8799; }
  /* Q07-B：Functional 挂点卡片（看挂点 → 点挂点 → 选部件；无 Apply） */
  .part-slots { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; }
  .part-slot-card { display: flex; justify-content: space-between; align-items: center; gap: 8px; width: 100%; padding: 7px 9px; background: #242b38; color: #e8e8f0; border: 1px solid #38414f; border-radius: 6px; cursor: pointer; font-size: 12px; text-align: left; }
  .part-slot-card:hover { background: #2e3747; }
  .part-slot-card.active { border-color: #4a7fe0; background: #2a3a5c; box-shadow: 0 0 0 1px #3b6fd4 inset; }
  .part-slot-card:disabled { opacity: 0.45; cursor: not-allowed; }
  .part-slot-card:disabled:hover { background: #242b38; }
  .part-slot-card .ps-label { color: #9aa4b5; }
  .part-slot-card .ps-value { color: #ffd35a; font-weight: 600; }
  .part-slot-card .ps-value.empty { color: #7c8799; font-weight: 400; }
  .part-picker { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; padding: 6px; background: #1b2130; border: 1px solid #2a3140; border-radius: 6px; }
  .part-picker .pp-title { width: 100%; font-size: 11px; color: #9aa4b5; margin-bottom: 2px; }
  .part-picker button { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 6px 10px; background: #242b38; color: #e8e8f0; border: 1px solid #38414f; border-radius: 5px; cursor: pointer; }
  .part-picker button:hover { background: #2e3747; }
  .part-picker button.active { background: #3b6fd4; border-color: #5a8df0; color: #fff; }
  .part-picker button:disabled { opacity: 0.45; cursor: not-allowed; }
  .part-picker button:disabled:hover { background: #242b38; }
  .part-picker .pp-name { font-size: 12px; line-height: 1.3; }
  .part-picker .pp-meta { font-size: 10px; color: #7c8799; line-height: 1.3; }
  .part-picker button.active .pp-meta { color: #d4dcff; }
  /* Q09-B：Energy used / capacity 条形表现（超载沿用 Validator 逻辑，仅表现层红色） */
  .energy-row { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
  .energy-row .energy-label { font-size: 12px; color: #9aa4b5; }
  .energy-row .energy-bar { flex: 1; height: 8px; background: #232b38; border: 1px solid #38414f; border-radius: 4px; overflow: hidden; }
  .energy-row .energy-fill { height: 100%; background: #3b6fd4; }
  .energy-row .energy-fill.overload { background: #ff5a4e; }
  .energy-row .energy-text { font-size: 12px; color: #c8d0e0; font-variant-numeric: tabular-nums; }
  .energy-row .energy-text.overload { color: #ff6b5e; font-weight: 700; }
  /* Q09-A：Body / 前后轮去表单化——选项卡片（看选项 → 点一下 → Preview 立即变化） */
  .opt-group { margin-top: 10px; }
  .opt-group .og-label { font-size: 12px; color: #9aa4b5; margin-bottom: 4px; }
  .opt-cards { display: flex; flex-wrap: wrap; gap: 4px; }
  .opt-card { flex: 1 1 40%; min-width: 70px; padding: 7px 6px; background: #242b38; color: #e8e8f0; border: 1px solid #38414f; border-radius: 6px; cursor: pointer; font-size: 12px; text-align: center; line-height: 1.35; }
  .opt-card:hover { background: #2e3747; }
  .opt-card.active { border-color: #4a7fe0; background: #2a3a5c; box-shadow: 0 0 0 1px #3b6fd4 inset; color: #fff; }
  .opt-card:disabled { opacity: 0.45; cursor: not-allowed; }
  .opt-card:disabled:hover { background: #242b38; }
  /* Q10-B：轮径三档等权同一行（12 小 / 20 标准 / 26 大，一眼可扫完） */
  .opt-cards.wheel .opt-card { flex: 1 1 0; min-width: 0; }
  /* Q07-C/Q08-B：Start 后短暂「READY / 开战」状态转换（Presentation 延迟，不改 Physics/结果） */
  .ready-overlay { position: absolute; inset: 0; display: none; align-items: center; justify-content: center; z-index: 8; background: rgba(6,8,12,0.35); pointer-events: none; }
  .ready-card { text-align: center; }
  .ready-card .rd-sub { font-size: 15px; letter-spacing: 8px; color: #9aa4b5; margin-bottom: 8px; }
  .ready-card .rd-main { font-size: 46px; font-weight: 800; letter-spacing: 12px; color: #ffd35a; text-shadow: 0 0 22px rgba(255,211,90,0.55); }
  /* Q15-UI-R2：玩家 Shell —— 三层结构（顶部状态 / 主舞台 / 底部操作） */
  .player-top { position: absolute; left: 0; right: 0; top: 0; height: 56px; display: none; align-items: center; justify-content: center; z-index: 6; pointer-events: none; font-size: 18px; letter-spacing: 4px; color: #cdd6e6; background: linear-gradient(180deg, rgba(8,10,14,0.82), rgba(8,10,14,0)); }
  .player-top .pt-title { font-weight: 700; text-shadow: 0 0 12px rgba(0,0,0,0.6); }
  .garage-dock { position: absolute; left: 0; right: 0; bottom: 0; z-index: 6; display: none; flex-direction: column; gap: 8px; padding: 10px 14px 12px; background: rgba(15,19,27,0.93); border-top: 1px solid #2a3140; }
  .dock-row { display: flex; align-items: center; gap: 12px; }
  .dock-chips { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 2px; }
  .dock-chips::-webkit-scrollbar { height: 6px; }
  .dock-chips::-webkit-scrollbar-thumb { background: #38414f; border-radius: 3px; }
  .dock-chip { flex: 0 0 auto; display: flex; flex-direction: column; align-items: flex-start; gap: 1px; min-width: 88px; padding: 7px 12px; background: #242b38; color: #e8e8f0; border: 1px solid #38414f; border-radius: 8px; cursor: pointer; font-size: 12px; text-align: left; }
  .dock-chip:hover { background: #2e3747; }
  .dock-chip.active { border-color: #4a7fe0; background: #2a3a5c; box-shadow: 0 0 0 1px #3b6fd4 inset; }
  .dock-chip .dc-label { color: #9aa4b5; }
  .dock-chip .dc-value { color: #ffd35a; font-weight: 600; font-size: 12px; }
  .dock-chip .dc-value.empty { color: #7c8799; font-weight: 400; }
  .dock-picker { display: flex; flex-wrap: wrap; gap: 6px; }
  .dock-picker .dp-title { width: 100%; font-size: 11px; color: #9aa4b5; margin-bottom: 1px; }
  .dock-opt { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; padding: 6px 12px; background: #242b38; color: #e8e8f0; border: 1px solid #38414f; border-radius: 6px; cursor: pointer; font-size: 12px; }
  .dock-opt:hover { background: #2e3747; }
  .dock-opt.active { background: #3b6fd4; border-color: #5a8df0; color: #fff; }
  .dock-opt .do-meta { font-size: 10px; color: #7c8799; }
  .dock-opt.active .do-meta { color: #d4dcff; }
  .dock-opt.locked { opacity: 0.4; cursor: not-allowed; border-style: dashed; }
  .part-picker button.locked { opacity: 0.4; cursor: not-allowed; border-style: dashed; }
  .dock-opt.locked .do-meta { color: #c98b5e; }
  .dock-energy { flex: 1; display: flex; align-items: center; gap: 8px; min-width: 160px; }
  .dock-energy .de-label { font-size: 12px; color: #9aa4b5; }
  .dock-energy .de-bar { flex: 1; height: 8px; background: #232b38; border: 1px solid #38414f; border-radius: 4px; overflow: hidden; max-width: 220px; }
  .dock-energy .de-fill { height: 100%; background: #3b6fd4; }
  .dock-energy .de-fill.overload { background: #ff5a4e; }
  .dock-energy .de-text { font-size: 12px; color: #c8d0e0; font-variant-numeric: tabular-nums; }
  .dock-energy .de-text.overload { color: #ff6b5e; font-weight: 700; }
  .dock-cta { flex: 0 0 auto; font-size: 17px; font-weight: 700; letter-spacing: 3px; padding: 14px 40px; background: #3b6fd4; border: 1px solid #5a8df0; color: #fff; border-radius: 10px; cursor: pointer; box-shadow: 0 4px 16px rgba(59,111,212,0.4); }
  .dock-cta:hover { background: #4a7fe0; }
  .dock-cta:disabled { background: #262e3d; border-color: #38414f; color: #7c8799; box-shadow: none; cursor: not-allowed; }
  .dock-hint { font-size: 12px; color: #ff6b5e; }
  .matching-vs { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); font-size: 54px; font-weight: 900; color: #e8e8f0; opacity: 0.12; animation: match-pulse 0.9s ease-in-out infinite; z-index: 6; pointer-events: none; display: none; }
  @keyframes match-pulse { 0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 0.10; } 50% { transform: translate(-50%, -50%) scale(1.15); opacity: 0.22; } }
  .match-info { position: absolute; inset: 0; display: none; align-items: center; justify-content: center; gap: 6%; z-index: 7; pointer-events: none; }
  .match-info .mi-side { text-align: center; }
  .match-info .mi-label { font-size: 16px; color: #9aa4b5; letter-spacing: 3px; }
  .match-info .mi-vs { font-size: 56px; font-weight: 900; color: #ffd35a; text-shadow: 0 0 18px rgba(255,211,90,0.45); }
  .match-info .mi-body { font-size: 20px; color: #ff9d5a; font-weight: 700; margin-top: 6px; }
  .match-info .mi-parts { font-size: 12px; color: #9aa4b5; margin-top: 4px; }
  .match-info .mi-drive {
    display: inline-block; margin-top: 8px; padding: 2px 12px; border-radius: 12px;
    font-size: 13px; font-weight: 600; letter-spacing: 1px;
    border: 1px solid #3b6fd4; color: #cfe0ff; background: rgba(59,111,212,0.16);
  }
  /* F-WX-6：窄屏（手机横屏）隐藏 DEV 侧栏/工具栏，玩家 Canvas UI 占满画布
     （配合 npm run dev:mobile 手机浏览器预览；DEV 工具仅桌面宽度保留） */
  @media (max-width: 1000px) {
    .lab-toolbar { display: none !important; }
    .lab-panel { display: none !important; }
  }
`;
document.head.appendChild(style);

/* ---------- 结构 ---------- */
const root = document.createElement('div');
root.className = 'lab-root';
app.appendChild(root);

const toolbar = document.createElement('div');
toolbar.className = 'lab-toolbar';

const main = document.createElement('div');
main.className = 'lab-main';
root.appendChild(main);

const panelA = document.createElement('div');
panelA.className = 'lab-panel';

const canvasWrap = document.createElement('div');
canvasWrap.className = 'lab-canvas-wrap';
main.appendChild(canvasWrap);

const canvas = document.createElement('canvas');
canvasWrap.appendChild(canvas);

const panelB = document.createElement('div');
panelB.className = 'lab-panel right';

// F-DEMO-PLAYER-RUNTIME-P0：玩家模式结构性禁止挂载 DEV 工具栏 / panelA·panelB 侧栏 /
// Debug 面板——它们本身不进入 DOM（非 CSS 遮挡），renderPanelsOnly/setBuildControlsLockedDom
// 等 DEV 引用在无面板时已是空操作（querySelectorAll 返回空），安全降级。
// 非玩家模式（普通 DEV Web）保留既有挂载行为。
if (!playerMode) {
  root.appendChild(toolbar);
  main.appendChild(panelA);
  main.appendChild(panelB);
}

// Q31：Runtime Debug Tools 仅在非 PROD 且非玩家模式创建（PROD / 玩家模式对正常玩家完全隐藏）。
let debugPanel: HTMLDivElement | null = null;
if (DEV_TOOLS_VISIBLE && !playerMode) {
  debugPanel = document.createElement('div');
  debugPanel.className = 'lab-debug';
  canvasWrap.appendChild(debugPanel);
}

const visualRegistry = new VisualRegistry();
const renderer = new Renderer(canvas, visualRegistry);
// F-WX-2：Viewport Adapter（Web 用 window resize 订阅）
const viewport = platform.createViewport(canvas);

// W2-FX-1：BattleEvent → Presentation 统一消费层（正式表现唯一入口；Preview 不消费）
const sfx = new SfxAudioService();
// W2-FX-2：Death 表现层定格调度（80~120ms）+ 阶段轮询状态（Web-only；微信玩家版无 timeScale）
const deathPause = new DeathPauseScheduler();
let prevTimeScale = 1;
const presentation = createPlayerPresentation(renderer, sfx, {
  // Web-only：死亡表现层定格 80~120ms（timeScale=0 冻结战斗推进；恢复原 timeScale）
  onDeathFreeze: () => {
    if (!lab.paused) {
      if (!deathPause.active) prevTimeScale = lab.timeScale;
      deathPause.trigger(100);
      if (lab.timeScale !== 0) lab.timeScale = 0;
    }
  },
});
const lab = new PhysicsLab(renderer, presentation);

/** W2-SIL-1：注册 + 加载首批正式 Content 视觉占位（缺资源/未加载 → Renderer 灰盒 fallback） */
const SILHOUETTE_ASSETS: Array<[string, string]> = [
  ['body_watermelon', bodyWatermelonUrl],
  ['body_banana', bodyBananaUrl],
  ['part_cannon', partCannonUrl],
  ['part_hammer', partHammerUrl],
  ['part_pushRod', partPushRodUrl],
];
for (const [visualId, url] of SILHOUETTE_ASSETS) {
  visualRegistry.register(visualId, url);
  const img = new Image();
  img.onload = () => visualRegistry.setImage(visualId, img);
  img.onerror = () => {
    // 加载失败：保持 registry 无 image → Renderer 灰盒 fallback（不白屏/不抛错）
  };
  img.src = url;
}

/* ---------- F-WX-3/4：玩家 UI 唯一 Host 边界 ----------
 * F-WX-6.1：Pages Preview 构建默认启用 Canvas Player UI（手机横屏可体验版本）。
 * F-DEMO-WEB-R1：外网 Pages 生产构建（isPagesPreview）默认进入同一玩家模式。
 * F-DEMO-PLAYER-RUNTIME-P0：统一的「手机玩家演示入口」——
 *   playerMode = Pages 预览 / __PLAYER_MODE__ 构建标志 / ?player=1 任一为真；
 *   玩家模式结构性禁止挂载 DEV 工具栏 / panelA·panelB 侧栏 / Physics Lab 与开发工具 /
 *   WebDomPlayerUIHost / Debug 面板与版本角标（非 CSS 遮挡，直接不创建这些 DOM），
 *   强制使用 CanvasPlayerUIHost，桌面打开时用 844×390 手机逻辑画布 + CSS contain 放大居中。
 * 非玩家模式（普通 DEV Web：isPagesPreview=false 且无 ?player/__PLAYER_MODE__）保留既有
 *   WebDom 行为（DEV 装配编辑器 + 开发工具），用于机制开发。 */
const reviewOn = new URLSearchParams(location.search).has('mobile-review');
// 玩家模式固定 Canvas Host；其余保持既有规则（pages/review/canvasui → Canvas，否则 WebDom）
const canvasUiMode = playerMode || reviewOn || new URLSearchParams(location.search).has('canvasui');
// F-PLAYER-CANVAS-COMPOSE-P0：玩家模式双画布共享同一 PlayerViewportTransform——
// Renderer Canvas（战斗/预览主体）与玩家 UI Canvas（HUD/扫描框/名称）用同一 logical 尺寸、
// 同一 CSS contain rect、同一 scale/offset、同一 DPR；跨层矩形只在逻辑空间转换一次。
const playerViewport = playerMode ? new PlayerViewportTransform() : null;
const host: PlayerUIHost = canvasUiMode
  ? new CanvasPlayerUIHost(document.createElement('canvas'), {
      // 桌面打开玩家模式：用手机逻辑画布（约 844×390）+ CSS contain 放大居中，
      // 不切回 Desktop 布局（isMobile=手机 profile，scale=1，点击坐标经 getBoundingClientRect 归一化反算）。
      phoneLogical: playerMode,
      viewportTransform: playerViewport ?? undefined,
    })
  : new WebDomPlayerUIHost();
host.mount(canvasWrap);
// F-PLAYER-CANVAS-COMPOSE-P0：Renderer Canvas 与 UI Canvas 应用同一视口变换
// （先 update 容器/DPR → 再 applyTo：backing = logical×DPR，CSS = logical px + contain 居中）。
if (playerViewport) {
  playerViewport.update(
    canvasWrap.clientWidth || PLAYER_LOGICAL_W,
    canvasWrap.clientHeight || PLAYER_LOGICAL_H,
    (typeof window !== 'undefined' && window.devicePixelRatio) || 1,
  );
  playerViewport.applyTo(canvas);
}
// F-DEMO-VISUAL-GATE-R4：E2E 探针（window.__h）仅存在于专用 E2E 构建（__E2E_PROBE__ define）；
// 正式 Pages/Web/微信构建编译期折叠为 false → 生产零调试对象暴露。几何快照在 loop() 内注入。
if (typeof __E2E_PROBE__ !== 'undefined' && __E2E_PROBE__) {
  (globalThis as { __h?: typeof host }).__h = host;
}

/* ---------- 稳定取景（Q02-CAM-R1）：DEV scenario 相机；build 玩家相机由 runtime 持有 ---------- */
let currentCamera: ScenarioCamera | null = null;

/** 取指定 orchestrator 的 arena 尺寸（运行时 config，Planck/Matter 共用） */
function arenaDimsOf(o: BattleOrchestratorApi | null): { w: number; h: number } {
  if (o instanceof PlanckBattleOrchestrator) {
    return { w: o.arena.config.width, h: o.arena.config.height };
  }
  if (o instanceof BattleOrchestrator) {
    return { w: o.arena.config.width, h: o.arena.config.height };
  }
  return { w: 1600, h: 900 };
}

/** DEV scenario 相机（仅机制场景模式；build 模式由 runtime.reframePlayerCamera 负责） */
function devReframeCamera(): void {
  const orch = lab.orchestrator;
  if (!orch) return;
  const fit: CameraFit = currentCamera?.fit ?? 'vehicles';
  renderer.reframe(orch.getRenderSnapshot(), fit, {
    forwardExtent: currentCamera?.forwardExtent,
    recoilExtent: currentCamera?.recoilExtent,
    phase: fit === 'battle' ? orch.phase : undefined,
  });
}

/** 视口 resize：同步 backing + 按模式重构图（build → runtime 玩家相机；scenario → DEV 相机） */
function doResize(): void {
  const d = arenaDimsOf(lab.orchestrator);
  renderer.resize(d.w, d.h);
  if (runtime.uiMode === 'scenario') devReframeCamera();
  else runtime.reframePlayerCamera();
}

/* ---------- F-WX-5：Web 战斗宿主（PlayerBattleHost 适配 PhysicsLab；DEV 能力保留在 lab） ---------- */
const battleHost: PlayerBattleHost = {
  get orchestrator() {
    return lab.orchestrator;
  },
  get previewMode() {
    return lab.previewMode;
  },
  loadCustomPreview: (a, b, soloA) => lab.loadCustomPreview(a, b, soloA),
  loadCustom: (a, b, c) => lab.loadCustom(a, b, c),
  step: (dt) => lab.step(dt),
  render: () => lab.render(),
  setPreviewVehicleFx: (fx) => renderer.setPreviewVehicleFx(fx),
  arenaDims: () => arenaDimsOf(lab.orchestrator),
  reframe: (fit, framingRect) => {
    const o = lab.orchestrator;
    if (!o) return;
    renderer.reframe(o.getRenderSnapshot(), fit, {
      phase: fit === 'battle' ? o.phase : undefined,
      framingRect,
    });
  },
  resize: (w, h) => renderer.resize(w, h),
  setHomeBackdrop: (on) => renderer.setHomeBackdrop(on),
  setPrebattleBackdrop: (on) => renderer.setPrebattleBackdrop(on),
  getMatchVehicleRects: () => {
    const o = lab.orchestrator;
    if (!o) return null;
    return renderer.getVehicleScreenRects(o.getRenderSnapshot());
  },
  getHomeVehicleRect: () => {
    const o = lab.orchestrator;
    if (!o) return null;
    const rects = renderer.getVehicleScreenRects(o.getRenderSnapshot());
    return rects ? rects.a : null;
  },
};

/* ---------- DEV Build 编辑状态（面板；玩家装配经 runtime actions） ---------- */

function addButton(parent: HTMLElement, text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = text;
  b.onclick = onClick;
  parent.appendChild(b);
  return b;
}

/** Q07-B：A/B 各自当前选中的 Functional 挂点（null = 未选中；per-panel，互不干扰） */
let selectedSlotA: string | null = null;
let selectedSlotB: string | null = null;

/** 锁定 / 解锁 A/B 全部 Build 控件 DOM（Fighting 时锁定；标志在 runtime）。
 *  F-PLAYER-FLOW-ATOMIC-P0：sideToggle 仅在 DEV（DEV_TOOLS_VISIBLE && !playerMode）
 *  挂载（见 882 行赋值）——玩家模式/未创建时 guard 解引用，杜绝
 *  「Cannot set properties of undefined (setting 'disabled')」。panelA/panelB 恒为
 *  createElement 元素（即使玩家模式不挂载，querySelectorAll 也安全返回空）。 */
function setBuildControlsLockedDom(locked: boolean): void {
  for (const sel of panelA.querySelectorAll('select')) {
    (sel as HTMLSelectElement).disabled = locked;
  }
  for (const sel of panelB.querySelectorAll('select')) {
    (sel as HTMLSelectElement).disabled = locked;
  }
  // W2-UX-R2：B 折叠 toggle 同锁（Fighting/Ended 不可展开）
  for (const b of panelB.querySelectorAll('.panel-collapse button')) {
    (b as HTMLButtonElement).disabled = locked;
  }
  for (const b of presetButtons) b.disabled = locked;
  // sideToggle 未创建（玩家模式 / PROD）→ 不解引用（守卫与实际变量状态一致）
  if (sideToggle) sideToggle.disabled = locked;
}

/** 渲染一侧 Build 面板（Body / 轮径卡片 / 真实 Functional 挂点卡片 / Energy / 校验错误）。
 *  DEV/Scenario 专用（正常玩家使用 Garage Dock，不进入 PlayerUIHost）。 */
function renderPanel(
  panel: HTMLElement,
  title: string,
  d: BuildDraft,
  opts: { collapsed?: boolean; expandLabel?: string } = {},
): void {
  panel.replaceChildren();

  const header = document.createElement('div');
  header.className = 'panel-collapse';
  const h = document.createElement('h3');
  h.textContent = title;
  header.appendChild(h);
  if (opts.collapsed !== undefined) {
    const toggle = document.createElement('button');
    toggle.textContent = opts.collapsed ? `${opts.expandLabel ?? '展开'} ▸` : '收起 ▾';
    // Q15：玩家流程中对手(B)只读 —— PROD 下禁止展开/编辑；dev / test（RC）可临时改对手做验收
    toggle.disabled = runtime.buildControlsLocked || !DEV_TOOLS_VISIBLE;
    toggle.onclick = () => {
      runtime.bEditorOpen = !runtime.bEditorOpen;
      runtime.refreshFromEdit();
    };
    header.appendChild(toggle);
  }
  panel.appendChild(header);

  const form = document.createElement('div');
  form.style.display = opts.collapsed ? 'none' : '';
  panel.appendChild(form);

  const body = registry.bodies.get(d.bodyDefId);
  const snapshot = runtime.snapshotOf(d === runtime.draftA ? 'A' : 'B');

  // Q09-A：Body / 前后轮去表单化——选项卡片（看选项 → 点一下 → Preview 立即变化，无 Apply）。
  const mkOptGroup = (
    label: string,
    options: Array<{ v: string; t: string }>,
    isActive: (v: string) => boolean,
    onPick: (v: string) => void,
  ): void => {
    const group = document.createElement('div');
    group.className = 'opt-group';
    const gLabel = document.createElement('div');
    gLabel.className = 'og-label';
    gLabel.textContent = label;
    group.appendChild(gLabel);
    const cards = document.createElement('div');
    cards.className = 'opt-cards' + (options.length <= 3 ? ' wheel' : '');
    for (const opt of options) {
      const b = document.createElement('button');
      b.className = 'opt-card' + (isActive(opt.v) ? ' active' : '');
      b.textContent = opt.t;
      b.disabled = runtime.buildControlsLocked;
      b.onclick = () => {
        if (runtime.buildControlsLocked) return;
        onPick(opt.v);
        runtime.refreshFromEdit(); // Draft → Energy → Validator → 真实 Planck Preview（无 Apply）
      };
      cards.appendChild(b);
    }
    group.appendChild(cards);
    form.appendChild(group);
  };

  // Body：复用 migrateDraftBody 真实 hardpoint 迁移（同 ID 保留 / 不存在删除 / 新挂点空）
  mkOptGroup('车身', BODY_OPTIONS, (v) => d.bodyDefId === v, (v) => {
    const migrated = migrateDraftBody(d, v, registry);
    d.bodyDefId = migrated.bodyDefId;
    d.functionalSelections = migrated.functionalSelections;
  });
  mkOptGroup('后轮', WHEEL_OPTIONS, (v) => String(d.rearRadius) === v, (v) => {
    d.rearRadius = Number(v);
  });
  mkOptGroup('前轮', WHEEL_OPTIONS, (v) => String(d.frontRadius) === v, (v) => {
    d.frontRadius = Number(v);
  });

  // Q07-B：Functional 挂点卡片化——点击卡片选中（明确选中态）并展开部件选择区。
  if (body) {
    const isA = d === runtime.draftA;
    const selSlot = isA ? selectedSlotA : selectedSlotB;
    const slotList = document.createElement('div');
    slotList.className = 'part-slots';
    for (const hpId of editableSlots(body)) {
      const cur = d.functionalSelections[hpId] ?? EMPTY_SLOT;
      const curName = cur === EMPTY_SLOT ? '空' : registry.functionals.get(cur)?.name ?? cur;
      const card = document.createElement('button');
      card.className = 'part-slot-card' + (selSlot === hpId ? ' active' : '');
      card.disabled = runtime.buildControlsLocked;
      const lab2 = document.createElement('span');
      lab2.className = 'ps-label';
      lab2.textContent = slotLabel(hpId);
      const val = document.createElement('span');
      val.className = 'ps-value' + (cur === EMPTY_SLOT ? ' empty' : '');
      val.textContent = `[${curName}]`;
      card.appendChild(lab2);
      card.appendChild(val);
      card.onclick = () => {
        if (runtime.buildControlsLocked) return;
        // 点击挂点：切换选中（再点一次取消）；只重渲染面板，不重建 Preview
        if (isA) selectedSlotA = selectedSlotA === hpId ? null : hpId;
        else selectedSlotB = selectedSlotB === hpId ? null : hpId;
        renderPanelsOnly();
      };
      slotList.appendChild(card);
    }
    form.appendChild(slotList);

    // 部件选择区：当前选中挂点展开（选项即点即改；当前装备高亮）
    if (selSlot && editableSlots(body).includes(selSlot)) {
      const cur = d.functionalSelections[selSlot] ?? EMPTY_SLOT;
      const curStar = d.functionalStars?.[selSlot] ?? 1;
      const curValEnc = encodePartVal(cur, curStar);
      const picker = document.createElement('div');
      picker.className = 'part-picker';
      const title = document.createElement('div');
      title.className = 'pp-title';
      title.textContent = `正在改「${slotLabel(selSlot)}」`;
      picker.appendChild(title);
      const inv = getInventory();
      const options: Array<{ v: string; t: string; meta: string }> = [];
      options.push({ v: EMPTY_SLOT, t: '空', meta: '空 · 0 能量' });
      for (const defId of OFFICIAL_PARTS) {
        const def = registry.functionals.get(defId);
        if (!def) continue;
        const cat = def.category === 'weapon' ? '武器' : def.category === 'gadget' ? '辅助' : def.category;
        for (const star of [1, 2]) {
          const count = getCount(inv, defId, star);
          const starStr = star >= 2 ? '★★' : '★';
          const t = `${def.name} ${starStr}`;
          const meta = count > 0
            ? `${cat} · ${starTierEnergy(def.energy, star)} 能量 · 拥有 ×${count}`
            : '未获得';
          options.push({ v: encodePartVal(defId, star), t, meta });
        }
      }
      for (const opt of options) {
        const equip = opt.v === EMPTY_SLOT
          ? true
          : (() => {
              const { defId, star } = decodePartVal(opt.v);
              return canEquipPart(defId, star);
            })();
        const b = document.createElement('button');
        b.className = (opt.v === curValEnc ? 'active' : '') + (equip ? '' : ' locked');
        b.disabled = runtime.buildControlsLocked || !equip;
        const nameEl = document.createElement('div');
        nameEl.className = 'pp-name';
        nameEl.textContent = opt.t;
        const metaEl = document.createElement('div');
        metaEl.className = 'pp-meta';
        metaEl.textContent = opt.meta;
        b.appendChild(nameEl);
        b.appendChild(metaEl);
        b.onclick = () => {
          if (runtime.buildControlsLocked) return;
          const oldPart = d.functionalSelections[selSlot] ?? EMPTY_SLOT;
          let newPart = EMPTY_SLOT;
          if (opt.v !== EMPTY_SLOT) {
            const { defId, star } = decodePartVal(opt.v);
            if (!canEquipPart(defId, star)) return;
            d.functionalSelections[selSlot] = defId;
            d.functionalStars = d.functionalStars ?? {};
            d.functionalStars[selSlot] = star;
            newPart = defId;
          } else {
            d.functionalSelections[selSlot] = EMPTY_SLOT;
          }
          runtime.emitBuildChange(selSlot, oldPart, newPart, true); // Q28：功能件变更埋点
          if (isA) selectedSlotA = null;
          else selectedSlotB = null;
          runtime.refreshFromEdit(); // Draft → Energy → Validator → 真实 Planck Preview
        };
        picker.appendChild(b);
      }
      form.appendChild(picker);
    }
  }

  // Q09-B：Energy 明显表现——used / capacity 条形 + 数字（超载沿用 Validator 逻辑，仅表现层红色）
  const energyRes = computeEnergy(snapshot, registry);
  const used = energyRes.error ? Number.NaN : energyRes.energy;
  const capacity = body?.energyCapacity ?? 0;
  const overload = Number.isFinite(used) && used > capacity;
  const eRow = document.createElement('div');
  eRow.className = 'energy-row';
  const eLabel = document.createElement('span');
  eLabel.className = 'energy-label';
  eLabel.textContent = '能量';
  const eBar = document.createElement('div');
  eBar.className = 'energy-bar';
  const pct = Number.isFinite(used) ? Math.min(100, (used / Math.max(capacity, 1)) * 100) : 0;
  const eFill = document.createElement('div');
  eFill.className = 'energy-fill' + (overload ? ' overload' : '');
  eFill.style.width = `${pct}%`;
  eBar.appendChild(eFill);
  const eTxt = document.createElement('span');
  eTxt.className = 'energy-text' + (overload ? ' overload' : '');
  eTxt.textContent = Number.isFinite(used) ? `${used} / ${capacity}` : '? / ?';
  eRow.appendChild(eLabel);
  eRow.appendChild(eBar);
  eRow.appendChild(eTxt);
  form.appendChild(eRow);

  // Q07-A：对手概要（collapsed 时显示——Body 名 / 部件 / 能量，不展开完整表单）
  if (opts.collapsed) {
    const summary = document.createElement('div');
    summary.className = 'opponent-summary';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'os-name';
    nameSpan.textContent = `${body?.name ?? d.bodyDefId}`;
    summary.appendChild(nameSpan);
    const eTxt2 = Number.isFinite(used) ? String(used) : '?';
    summary.appendChild(document.createTextNode(` · 能量 ${eTxt2}/${capacity}`));
    if (body) {
      const partNames = editableSlots(body)
        .map((hpId) => {
          const v = d.functionalSelections[hpId];
          if (!v || v === EMPTY_SLOT) return null;
          return registry.functionals.get(v)?.name ?? v;
        })
        .filter((x): x is string => x !== null);
      if (partNames.length) {
        const partsRow = document.createElement('div');
        partsRow.className = 'os-parts';
        partsRow.textContent = partNames.join(' / ');
        summary.appendChild(partsRow);
      }
    }
    panel.appendChild(summary);
  }
}

/** Q07-B：只重渲染 A/B 面板（挂点选中态 / 部件选择区显隐），不重建 Preview。
 *  Q15-UX-R1：Garage 只渲染 A 编辑器；MatchPreview 彻底退出编辑器。
 *  F-DEMO-PLAYER-RUNTIME-P0：玩家模式下无 DEV 侧栏面板，直接跳过（结构性已不挂载）。 */
function renderPanelsOnly(): void {
  if (playerMode) return;
  if (runtime.playerPhase === 'matchPreview') {
    panelA.style.display = 'none';
    panelB.style.display = 'none';
    return;
  }
  // Garage：仅 A 编辑器；B 面板隐藏
  panelB.style.display = 'none';
  renderPanel(panelA, '我的车辆', runtime.draftA);
}

/* ---------- 工具栏（Q07-A：Start 是唯一主 CTA，位于画布底部；由 PlayerUIHost 提供） ----------
 * F-DEMO-PLAYER-RUNTIME-P0：玩家模式下整段 DEV 工具栏 / 场景选择 / 开发工具折叠区 / Debug /
 * Preset 均不创建（结构性禁止挂载），不进入 DOM、不占用玩家流程。 */

// Q07-A：机制场景不再是同级主按钮——场景选择收进「开发工具」折叠区。
// F-DEMO-PLAYER-RUNTIME-P0：这些 DEV-only 变量仅在 if (!playerMode) 块内赋值（definite assignment）；
// 玩家模式下不创建，外部守卫（if (x)）静态正确跳过。
let backToBuildBtn!: HTMLButtonElement;
// 场景选择（开发工具折叠区内显示；选中即进入机制场景模式）
// Q31：Scenario 仅在非 PROD 且非玩家模式创建（PROD / 玩家模式对正常玩家完全隐藏）。
let scenarioSelect: HTMLSelectElement | null = null;
// Q07-A：开发工具折叠区（机制场景 / Pause / Reset / Clear / 速度 / Preset 收进二级）。
let toolsToggle!: HTMLButtonElement;
let toolsHost!: HTMLDivElement;
let toolsOpen = false;
// F-PLAYER-FLOW-ATOMIC-P0：sideToggle 仅 DEV 挂载（if (!playerMode) 块内赋值）。
// 声明为 `| null`（初始 null）——setBuildControlsLockedDom 的 `if (sideToggle)` 守卫
// 与实际变量状态一致（旧 `!` 断言在玩家模式下是 undefined，解引用即崩溃）。
let sideToggle: HTMLButtonElement | null = null;
const presetButtons: HTMLButtonElement[] = [];

if (!playerMode) {
// Q07-A：机制场景不再是同级主按钮——场景选择收进「开发工具」折叠区。
backToBuildBtn = addButton(toolbar, '返回装配', () => setMode('build'));
backToBuildBtn.style.display = 'none';

// 场景选择（开发工具折叠区内显示；选中即进入机制场景模式）
// Q31：Scenario 仅在非 PROD 创建（PROD 对正常玩家完全隐藏）。
if (DEV_TOOLS_VISIBLE) {
  scenarioSelect = document.createElement('select');
  SCENARIOS.forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = `${s.id} · ${s.name}`;
    scenarioSelect!.appendChild(opt);
  });
  scenarioSelect.onchange = () => {
    const sc = SCENARIOS.find((s) => s.id === scenarioSelect!.value);
    if (sc) {
      setMode('scenario'); // Q07-A：从开发工具选中场景 → 直接进入机制场景模式（DOM + runtime 流）
      lab.loadScenario(sc);
      runtime.clearResultState(); // 清结算/结果状态并重推 UI（Host 按 uiMode 渲染隐藏玩家 Shell）
      currentCamera = sc.camera ?? null;
      devReframeCamera();
    }
  };
}

/* ---------- Q07-A：开发工具折叠区（机制场景 / Pause / Reset / Clear / 速度 / Preset 收进二级） ---------- */
toolsToggle = addButton(toolbar, '开发工具 ▸', () => {
  toolsOpen = !toolsOpen;
  if (toolsHost) toolsHost.style.display = toolsOpen ? '' : 'none';
  toolsToggle!.textContent = toolsOpen ? '开发工具 ▾' : '开发工具 ▸';
  toolsToggle!.classList.toggle('active', toolsOpen);
});
toolsToggle.classList.add('dev-toggle');
// Q15：PROD 对正常玩家隐藏开发工具（玩家流程不依赖它）；DEV 仍可见可用
toolsToggle.style.display = TOOLS_DEV_VISIBLE;
toolsHost = document.createElement('div');
toolsHost.className = 'tool-tools-host';
// Q07-A：机制场景入口收进开发工具（不再是同级主模式按钮）
// Q31：PROD 下 scenarioSelect 为 null（Scenario 已隐藏）→ 不挂载。
if (scenarioSelect) toolsHost.appendChild(scenarioSelect);
const toolsLabel = document.createElement('span');
toolsLabel.className = 'tool-tools-label';
toolsLabel.textContent = '调试：';
toolsHost.appendChild(toolsLabel);
root.insertBefore(toolsHost, main);
toolsHost.style.display = 'none';

const btnPause = addButton(toolsHost, 'Pause', () => {
  lab.paused = !lab.paused;
  btnPause.textContent = lab.paused ? 'Resume' : 'Pause';
  btnPause.classList.toggle('active', lab.paused);
});
addButton(toolsHost, 'Reset', () => {
  lab.paused = false;
  btnPause.textContent = 'Pause';
  btnPause.classList.remove('active');
  lab.reset();
  runtime.syncAfterLabReset(); // flow 同步（preview → Editing / battle → Fighting）
  if (lab.previewMode && toolsToggle) toolsToggle.style.display = TOOLS_DEV_VISIBLE;
});
addButton(toolsHost, 'Clear', () => {
  lab.clear();
  currentCamera = null;
  selectedSlotA = null;
  runtime.syncAfterLabClear(); // flow 同步（→ Editing + 恢复装配预览）
  if (toolsToggle) toolsToggle.style.display = TOOLS_DEV_VISIBLE;
});

// 时间缩放（测试工具折叠区内）
toolsHost.appendChild(document.createTextNode('速度 '));
const tsButtons: HTMLButtonElement[] = [];
TIME_SCALES.forEach((ts) => {
  const b = addButton(toolsHost, `${ts}x`, () => {
    lab.timeScale = ts;
    tsButtons.forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
  });
  tsButtons.push(b);
});
tsButtons[0].classList.add('active');

/* ---------- Preset 快捷（测试工具折叠区内；只装载 Body/轮径，功能槽重置 none） ---------- */
{
  let targetSide: 'A' | 'B' = 'A';
  const presetBox = document.createElement('div');
  presetBox.className = 'preset-box';
  const ph = document.createElement('h3');
  ph.textContent = 'Preset 快捷（装到 A）';
  presetBox.appendChild(ph);
  toolsHost.appendChild(presetBox);

  sideToggle = addButton(toolsHost, '装载 → A', () => {
    targetSide = targetSide === 'A' ? 'B' : 'A';
    sideToggle!.textContent = `装载 → ${targetSide}`;
    ph.textContent = 'Preset 快捷（装到 ' + targetSide + '）';
  });

  PRESETS.forEach((p) => {
    const b = document.createElement('button');
    b.textContent = p.name;
    b.style.cssText =
      'display:block;width:100%;margin:4px 0;padding:5px;background:#242b38;color:#e8e8f0;border:1px solid #38414f;border-radius:5px;cursor:pointer;';
    b.onclick = () => {
      const target = targetSide === 'A' ? runtime.draftA : runtime.draftB;
      const build = p.build();
      target.bodyDefId = build.bodyDefId;
      const f = build.movements.find((m) => m.hardpointId === 'front');
      const r = build.movements.find((m) => m.hardpointId === 'rear');
      target.frontRadius = f?.overrides?.radius ?? 20;
      target.rearRadius = r?.overrides?.radius ?? 20;
      const body = registry.bodies.get(target.bodyDefId);
      target.functionalSelections = {};
      if (body) {
        for (const hp of body.functionalHardpoints) {
          target.functionalSelections[hp.id] = EMPTY_SLOT;
        }
      }
      runtime.refreshFromEdit();
    };
    presetBox.appendChild(b);
    presetButtons.push(b);
  });
}
} // F-DEMO-PLAYER-RUNTIME-P0：if (!playerMode) —— 玩家模式下整段 DEV 工具栏 / 侧栏 / 工具 / Debug / Preset 结构性不创建

/* ---------- Debug 面板（仅机制场景模式显示；PROD 完全不构建） ---------- */
if (DEV_TOOLS_VISIBLE && debugPanel) {
  const h4 = document.createElement('h4');
  h4.textContent = 'Debug 显示';
  debugPanel.appendChild(h4);

  const flagDefs: Array<[keyof typeof lab.debugFlags, string]> = [
    ['com', 'COM 重心'],
    ['movementHardpoint', '移动挂点'],
    ['functionalHardpoint', '功能挂点'],
    ['groundedWheel', '接地轮'],
    ['linearVelocity', '线速度'],
    ['angularVelocity', '角速度'],
    ['contactPoint', '接触点'],
    ['contactNormal', '接触法线'],
    ['impulse', '冲量'],
    ['totalMass', '总质量'],
    ['inertia', '转动惯量'],
    ['lastImpact', '最近 Impact'],
    ['lastDamage', '最近 Damage'],
    ['collider', 'Collider'],
  ];
  const checkboxes = new Map<keyof typeof lab.debugFlags, HTMLInputElement>();
  for (const [key, label] of flagDefs) {
    const lab2 = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = lab.debugFlags[key];
    cb.onchange = () => {
      lab.debugFlags[key] = cb.checked;
    };
    lab2.appendChild(cb);
    lab2.appendChild(document.createTextNode(' ' + label));
    debugPanel.appendChild(lab2);
    checkboxes.set(key, cb);
  }

  const btnAllOff = document.createElement('button');
  btnAllOff.textContent = '全部关闭';
  btnAllOff.style.cssText =
    'display:block;width:100%;margin:6px 0 2px;padding:4px 8px;' +
    'background:#3a2a2a;color:#ffb4a0;border:1px solid #5a3a3a;' +
    'border-radius:4px;cursor:pointer;font-size:12px;';
  btnAllOff.onclick = () => {
    for (const [key, cb] of checkboxes) {
      cb.checked = false;
      lab.debugFlags[key] = false;
    }
  };
  debugPanel.appendChild(btnAllOff);

  const oh = document.createElement('h4');
  oh.textContent = 'Override（隔离）';
  debugPanel.appendChild(oh);

  const overrideDefs: Array<[keyof typeof lab.overrides, string, number, number]> = [
    ['massScale', '质量缩放', 0.1, 5],
    ['driveTorqueScale', '驱动缩放', 0.1, 5],
    ['gripScale', '抓地缩放', 0.1, 5],
    ['impactThreshold', 'Impact 阈值', 0, 40],
  ];
  for (const [key, label, min, max] of overrideDefs) {
    const lab2 = document.createElement('label');
    lab2.textContent = label + ' ';
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.step = '0.1';
    inp.min = String(min);
    inp.max = String(max);
    inp.value = String(lab.overrides[key] ?? '');
    inp.onchange = () => {
      const v = parseFloat(inp.value);
      if (!Number.isNaN(v)) {
        (lab.overrides as Record<string, number>)[key] = v;
        lab.reset();
        devReframeCamera(); // Override 触发 reset：重新构图一次
      }
    };
    lab2.appendChild(inp);
    debugPanel.appendChild(lab2);
  }
}

/* ---------- 顶层模式切换（Q07-A）：装配 ↔ 机制场景（DOM 部分；Gameplay 流在 runtime.setMode） ---------- */
function setMode(m: UiMode): void {
  if (m === 'build') selectedSlotA = null; // 切回装配：不展开部件全集（须先于 refresh）
  runtime.setMode(m);
  if (backToBuildBtn) backToBuildBtn.style.display = m === 'scenario' ? '' : 'none';
  const showBuild = m === 'build';
  if (debugPanel) debugPanel.style.display = showBuild ? 'none' : '';
}

/* ---------- F-WX-5：PlayerGameRuntime（Web 接线；玩家流程唯一出口） ---------- */
// F-PLAYER-FLOW-ATOMIC-P0：玩家模式不注入任何依赖未挂载 DEV DOM 的回调
// （onBuildLocked/onPanelsChanged/isResetDevVisible/onDevResetReload 全部 DEV-only——
// sideToggle/panelA·B/tools 等 DOM 在 playerMode 下不创建；注入即存在解引用 undefined
// 的崩溃路径，见外网 TypeError: Cannot set properties of undefined (setting 'disabled')）。
// 非玩家模式（普通 DEV Web）保留既有 DEV 接线（面板锁定/重渲染/重置刷新）。
// onArenaFrame（场边红脉冲 + Death 定格）不依赖 DEV DOM（canvasWrap 恒存在），两侧共用。
const runtime = new PlayerGameRuntime({
  host,
  battle: battleHost,
  sfx,
  ...(playerMode
    ? {}
    : {
        isResetDevVisible: () => new URLSearchParams(location.search).has('resetdev'),
        onDevResetReload: () => location.reload(),
        onPanelsChanged: () => renderPanelsOnly(),
        onBuildLocked: (locked: boolean) => setBuildControlsLockedDom(locked),
      }),
  // Web-only 每帧表现：场边红脉冲（Warning）+ Death 定格恢复（timeScale）
  onArenaFrame: ({ previewMode, inWarning }) => {
    canvasWrap.classList.toggle('phase-warning', inWarning);
    if (previewMode) return;
    if (deathPause.active && deathPause.shouldResume()) {
      lab.timeScale = prevTimeScale;
      deathPause.clear();
    }
  },
  onResize: doResize,
  onCameraReset: () => {
    currentCamera = null;
  },
});

/* ---------- 初始：默认装配测试模式（runtime.init 装载玩家状态 + 初始渲染） ---------- */
// F-WX-2：Viewport Adapter（window resize → doResize；build 玩家相机 / scenario DEV 相机）
viewport.onResize(() => {
  if (playerViewport) {
    // F-PLAYER-CANVAS-COMPOSE-P0：玩家模式 resize——重算 contain 并同步到两画布
    // （Renderer Canvas + UI Canvas 同一变换；host 画布在 syncViewport 内复用同一 transform），
    // 再走既有 doResize（renderer.resize 读 clientWidth = logical → 与 UI 完全同源）。
    playerViewport.update(
      canvasWrap.clientWidth || PLAYER_LOGICAL_W,
      canvasWrap.clientHeight || PLAYER_LOGICAL_H,
      (typeof window !== 'undefined' && window.devicePixelRatio) || 1,
    );
    playerViewport.applyTo(canvas);
    host.syncViewport?.();
  }
  doResize();
});
runtime.init(); // track(game_start) + 玩家状态装载 + 初始 doResize/reframe + pushUI
if (debugPanel) debugPanel.style.display = 'none';
if (backToBuildBtn) backToBuildBtn.style.display = 'none';

/* ---------- F-UX-REVIEW-1：DEV Mobile Review（?mobile-review=1） ----------
 * PC 直接复现真实手机 logical viewport：游戏内部逻辑尺寸严格等于所选 viewport
 * （容器 CSS 尺寸 = vp.w×vp.h），视觉放大只走 CSS transform（WebInput 已归一化坐标）。
 * 工具栏在游戏画面外部（顶部条），不占用游戏内部空间；正常流程全部可用鼠标完成。 */
if (reviewOn) {
  const reviewBar = document.createElement('div');
  reviewBar.className = 'tool-tools-host';
  reviewBar.style.justifyContent = 'center';
  root.insertBefore(reviewBar, main);

  // F-UX-2A：纯净模式——Review 页面只留 顶部 Review 工具栏 + 手机游戏画面，
  // 隐藏全部 DEV 控件（Build Editor / DEV side panel / Physics·Lab 控件 / 开发工具按钮 /
  // 非游戏状态栏）；1x/2x 切换不涉及它们（一次性隐藏，与显示倍率无关）。
  toolbar.style.display = 'none';
  panelA.style.display = 'none';
  panelB.style.display = 'none';
  if (debugPanel) debugPanel.style.display = 'none';

  // canvasWrap：flex:1 填满 → 固定逻辑尺寸 + 居中 + transform 放大（仅视觉，不改变位置逻辑）
  canvasWrap.style.flex = 'none';
  canvasWrap.style.margin = 'auto';
  canvasWrap.style.transformOrigin = 'top left';

  const vpLabel = document.createElement('span');
  vpLabel.style.cssText = 'font:12px monospace;color:#ffd35a;margin-left:8px;';
  reviewBar.appendChild(vpLabel);

  let reviewState = createMobileReviewState();
  const applyReview = (): void => {
    const vp = reviewViewport(reviewState);
    const st = reviewContainerStyle(vp, reviewState.scale);
    canvasWrap.style.width = `${st.width}px`;
    canvasWrap.style.height = `${st.height}px`;
    canvasWrap.style.transform = st.transform;
    canvasWrap.style.transformOrigin = st.transformOrigin;
    vpLabel.textContent = `logical ${vp.w}×${vp.h} @ ${reviewState.scale}x`;
    // 游戏内部尺寸随容器变化 → 重排（host ensureSize + 相机重构图）
    runtime.refreshFromEdit();
    doResize();
  };
  for (let i = 0; i < REVIEW_PRESETS.length; i++) {
    const vp = REVIEW_PRESETS[i];
    const b = document.createElement('button');
    b.textContent = `${vp.w}×${vp.h}`;
    b.style.fontFamily = 'monospace';
    b.onclick = () => {
      reviewState = selectReviewPreset(reviewState, i);
      applyReview();
    };
    reviewBar.appendChild(b);
  }
  const scaleBtn = document.createElement('button');
  scaleBtn.textContent = '显示 2x';
  scaleBtn.style.fontFamily = 'monospace';
  scaleBtn.onclick = () => {
    reviewState = toggleReviewScale(reviewState);
    scaleBtn.textContent = `显示 ${reviewState.scale}x`;
    applyReview();
  };
  reviewBar.appendChild(scaleBtn);
  applyReview();
}

/* ---------- 主循环（F-WX-5：调度在入口，推进在 runtime.tick；dt 钳制在 runtime） ---------- */
function loop(now: number): void {
  runtime.tick(now);
  // F-DEMO-VISUAL-GATE-R4：E2E 构建（__E2E_PROBE__）每帧写入只读几何诊断快照——
  // phase / A/B 屏幕 envelope / matchVehicleRects / transform / groundScreenY /
  // 收束墙屏幕 rect / 阶段文案（供浏览器 Gate 硬断言；只读、不参与任何 Gameplay 规则；
  // 正式构建编译期折叠为零开销）。
  if (typeof __E2E_PROBE__ !== 'undefined' && __E2E_PROBE__) {
    try {
      const orch = lab.orchestrator;
      const snap = orch?.getRenderSnapshot?.();
      const cam = renderer?.getProbeCamera?.() ?? null;
      (globalThis as { __probe?: unknown }).__probe = {
        playerPhase: runtime.playerPhase,
        battleState: runtime.battleState,
        battlePhase: orch?.phase ?? null,
        phaseCountdownText: runtime.getProbeCountdownText?.() ?? null,
        matchVehicleRects: battleHost.getMatchVehicleRects?.() ?? null,
        transform: cam ? { scale: cam.scale, offsetX: cam.offsetX, offsetY: cam.offsetY } : null,
        groundScreenY: cam ? cam.groundScreenY : null,
        hazardRects: snap ? (renderer?.getProbeHazardRects?.(snap) ?? null) : null,
        vehicleRects: snap ? (renderer?.getVehicleScreenRects(snap) ?? null) : null,
      };
    } catch {
      // 探针失败静默（不因诊断影响游戏运行）
    }
  }
  platform.lifecycle.requestAnimationFrame(loop);
}
platform.lifecycle.requestAnimationFrame(loop);
