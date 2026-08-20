/**
 * 入口：Build 测试交互 UI（Q06-UX-R1 重构，P0）。
 *
 * 单一清晰流程：配置 → 实时预览 → 开战 → 结果 → 调整 → 再战。
 * - 顶层模式互斥：【装配测试】（默认）/【机制场景】；两模式控件绝不同时出现；
 * - Editing：Build 控件可操作 + 中央实时 Preview（loadCustomPreview，planck 站桩）；
 *   Fighting：Build 控件全部锁定 + 中央正式 Planck Battle；Ended：显示结果 + 控件重开；
 * - 首屏默认合法配置（A/B 各 front Cannon），Start 立即可点；
 * - 非法配置时 Start 明显禁用且旁边直接显示阻断原因（A：… / B：…）。
 */
import { Renderer, type CameraFit } from './render/renderer';
import { VisualRegistry } from './render/visualRegistry';
import { SfxAudioService } from './presentation/audioService';
import { BattlePresentationController } from './presentation/battlePresentationController';
import {
  DeathPauseScheduler,
  damageFeedbackColors,
  phaseRemainingMs,
  warningCountdown,
} from './presentation/battlePhaseFx';
// W2-SIL-1：5 个首批正式 Content 视觉占位（程序化轮廓 PNG；正式美术可替换）
// Vite asset import 返回构建后 URL（dev/prod 均有效；vite/client 提供 *.png 声明）。
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
import type { BuildSnapshot } from './core/types';

// F-DEV-1：Runtime 版本信息（vite 虚拟模块注入，git 读取非手写常量；类型见 virtual-runtime-info.d.ts）
import runtimeInfo from 'virtual:runtime-info';
import { registry } from './core/content';
import {
  buildSnapshotFromDraft,
  editableSlots,
  migrateDraftBody,
  slotLabel,
  EMPTY_SLOT,
  type BuildDraft,
} from './lab/buildEditorModel';
import { computeEnergy, validateSnapshot } from './core/buildValidator';

const app = document.getElementById('app')!;

// F-DEV-1：Runtime Badge——仅开发环境显示 branch + short SHA。
// 一眼确认「我当前看到的是哪个代码版本」（正式玩家 UI 不显示）。
if (import.meta.env.DEV) {
  const badge = document.createElement('div');
  badge.style.cssText =
    'position:fixed;right:8px;bottom:8px;z-index:9999;font:11px/1.4 monospace;' +
    'color:#8fa3c8;background:rgba(15,20,30,0.72);border:1px solid #2a3140;' +
    'border-radius:6px;padding:4px 8px;pointer-events:none;';
  badge.textContent = `${runtimeInfo.branch} @ ${runtimeInfo.sha.slice(0, 7)}`;
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
  /* Q07-A：开发工具折叠区（机制场景 / Pause/Reset/Clear / 速度 / Preset 收进二级） */
  .tool-tools-host { display: none; align-items: center; gap: 8px; flex-wrap: wrap; padding: 6px 12px; background: #1b2130; border-bottom: 1px solid #2a3140; }
  .tool-tools-host .tool-tools-label { font-size: 12px; color: #9aa4b5; margin-right: 4px; }
  .tool-tools-host button, .tool-tools-host select { background: #242b38; color: #e8e8f0; border: 1px solid #38414f; border-radius: 6px; padding: 5px 9px; cursor: pointer; font-size: 12px; }
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
  /* Q09-B：选项两行——名称 + 武器/辅助类别 + Energy（不写长描述，不加属性系统） */
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
`;
document.head.appendChild(style);

/* ---------- 结构 ---------- */
const root = document.createElement('div');
root.className = 'lab-root';
app.appendChild(root);

const toolbar = document.createElement('div');
toolbar.className = 'lab-toolbar';
root.appendChild(toolbar);

const main = document.createElement('div');
main.className = 'lab-main';
root.appendChild(main);

const panelA = document.createElement('div');
panelA.className = 'lab-panel';
main.appendChild(panelA);

const canvasWrap = document.createElement('div');
canvasWrap.className = 'lab-canvas-wrap';
main.appendChild(canvasWrap);

const canvas = document.createElement('canvas');
canvasWrap.appendChild(canvas);

const panelB = document.createElement('div');
panelB.className = 'lab-panel right';
main.appendChild(panelB);

const debugPanel = document.createElement('div');
debugPanel.className = 'lab-debug';
canvasWrap.appendChild(debugPanel);

/* ---------- 战斗 HUD（Q06-HUD-U1：Fighting 顶部固定 A/B HP，不随车辆运动带走） ---------- */
const hudEl = document.createElement('div');
hudEl.className = 'battle-hud';
canvasWrap.appendChild(hudEl);

function makeHudSide(teamLabel: string, color: string): {
  root: HTMLElement;
  hpText: HTMLElement;
  barFill: HTMLElement;
} {
  const root = document.createElement('div');
  root.className = 'hud-side';
  const team = document.createElement('span');
  team.className = 'hud-team';
  team.textContent = teamLabel;
  team.style.color = color;
  const barWrap = document.createElement('div');
  barWrap.className = 'hud-bar-wrap';
  const barFill = document.createElement('div');
  barFill.className = 'hud-bar-fill';
  barFill.style.background = color;
  barWrap.appendChild(barFill);
  const hpText = document.createElement('span');
  hpText.className = 'hud-hp';
  root.appendChild(team);
  root.appendChild(barWrap);
  root.appendChild(hpText);
  hudEl.appendChild(root);
  return { root, hpText, barFill };
}
const hudA = makeHudSide('A', '#3b6fd4');
const hudB = makeHudSide('B', '#e08a2e');
const hudPhase = document.createElement('span');
hudPhase.className = 'hud-phase';
hudPhase.textContent = '战斗中';
hudEl.appendChild(hudPhase);

/* ---------- W2-FX-2：Warning 阶段倒计时（3 → 2 → 1；Closing 开始后消失） ---------- */
const phaseCountdown = document.createElement('span');
phaseCountdown.className = 'phase-countdown';
phaseCountdown.textContent = '';
hudEl.appendChild(phaseCountdown);

/* ---------- 结算 Modal（Q06-HUD-U1：Ended 中央第一视觉焦点） ---------- */
const resultModal = document.createElement('div');
resultModal.className = 'result-modal';
canvasWrap.appendChild(resultModal);

const resultCard = document.createElement('div');
resultCard.className = 'result-card';
resultModal.appendChild(resultCard);

const resultTitle = document.createElement('h2');
resultTitle.className = 'result-title';
resultCard.appendChild(resultTitle);

const resultHpA = document.createElement('div');
resultHpA.className = 'result-hp';
resultCard.appendChild(resultHpA);
const resultHpB = document.createElement('div');
resultHpB.className = 'result-hp';
resultCard.appendChild(resultHpB);

const resultActions = document.createElement('div');
resultActions.className = 'result-actions';
resultCard.appendChild(resultActions);

/** 每帧刷新 HUD：直读 getBattleStatusSnapshot()；整数 HP + clamp 比例条 */
function updateHud(): void {
  const o = lab.orchestrator;
  const s = o?.getBattleStatusSnapshot?.() ?? null;
  if ((battleState !== 'fighting' && battleState !== 'ended') || !s) {
    hudEl.style.display = 'none';
    return;
  }
  hudEl.style.display = 'flex';
  // W2-UX-R2：Ended 不再显示「战斗中」（改「战斗结束」，避免与结算卡矛盾）
  hudPhase.textContent = s.phase === 'End' ? '战斗结束' : '战斗中';
  hudA.hpText.textContent = `${Math.round(s.sideA.hp)} / ${Math.round(s.sideA.maxHp)}`;
  hudB.hpText.textContent = `${Math.round(s.sideB.hp)} / ${Math.round(s.sideB.maxHp)}`;
  hudA.barFill.style.width = `${Math.max(0, Math.min(1, s.sideA.hp / Math.max(s.sideA.maxHp, 1))) * 100}%`;
  hudB.barFill.style.width = `${Math.max(0, Math.min(1, s.sideB.hp / Math.max(s.sideB.maxHp, 1))) * 100}%`;
}

/** 显示结算卡：胜/负 + 双方整数剩余 HP（W1-END-1：正式战斗无平局，只反映 Runtime result） */
function showResultModal(r: { winner: 'A' | 'B'; hpA: number; hpB: number }): void {
  const isWin = r.winner === 'A';
  resultTitle.textContent = isWin ? '【胜利】' : '【失败】';
  resultTitle.style.color = isWin ? '#59c97a' : '#ff6b5e';
  resultHpA.textContent = `我方剩余 HP：${Math.round(r.hpA)}`;
  resultHpB.textContent = `对手剩余 HP：${Math.round(r.hpB)}`;
  resultModal.style.display = 'flex';
}

/** Ended 后玩家选择：调整配置 → 回 Editing + Preview（保持当前 Build 与对手，不重置） */
function adjustConfig(): void {
  resultModal.style.display = 'none';
  hudEl.style.display = 'none';
  battleState = 'editing';
  setBuildControlsLocked(false);
  panelA.style.display = '';
  panelB.style.display = '';
  startBar.style.display = '';
  toolsToggle.style.display = ''; // Q07-C：回装配恢复开发工具入口
  // Q08-CAM-A1：面板恢复 → canvas CSS 变窄，先同步 backing 再显示 Preview
  doResize();
  showPreview();
  updateStartButton();
}

/** Ended 后玩家选择：原配置再战 → 直接重建正式 Planck battle（不进入编辑） */
function rematch(): void {
  resultModal.style.display = 'none';
  startOrRematch(); // 当前 Build 不变；内部重建 battle → Fighting + HUD 回满
}

/* 结算卡按钮：调整配置（主）/ 原配置再战（次） */
const btnAdjust = document.createElement('button');
btnAdjust.className = 'primary';
btnAdjust.textContent = '调整配置';
btnAdjust.onclick = adjustConfig;
resultActions.appendChild(btnAdjust);

const btnRematch = document.createElement('button');
btnRematch.className = 'secondary'; // Q08-B：次 CTA（弱化，不与调整配置同级）
btnRematch.textContent = '原配置再战';
btnRematch.onclick = rematch;
resultActions.appendChild(btnRematch);

// W2-VIS-1：Sprite Visual Registry（首版无正式 Content 资源 → 全部 Collider graybox；
// 后续 Content 队列经 register + 图片加载注入正式 sprite，Preview/Fighting 共用同一 runtime）
const visualRegistry = new VisualRegistry();
const renderer = new Renderer(canvas, visualRegistry);

// W2-FX-1：BattleEvent → Presentation 统一消费层（正式表现唯一入口）。
// - 表现 hook 全部接到 Renderer 的「只画」方法 + 统一 AudioService；
// - Presentation 不决定伤害；FX/SFX 缺资源安全 skip；
// - Preview（loadCustomPreview）不消费战斗 FX（PhysicsLab 只在正式战斗 bind）。
const sfx = new SfxAudioService();
// W2-FX-2：Death 表现层定格调度（80~120ms）+ 阶段轮询状态
const deathPause = new DeathPauseScheduler();
let prevTimeScale = 1;
const presentation = new BattlePresentationController({
  // Q11-C-R3-FINAL：laser 开火 → 发射沿真实 fire 方向的「巨炮」能量束 VFX +
  // 明显炮口白青强闪；Cannon 仍用默认橙黄小闪。
  onMuzzleFlash: (ev) => {
    if (ev.behavior === 'laser') {
      renderer.spawnLaserBeam(
        ev.worldPosition.x,
        ev.worldPosition.y,
        ev.worldDirection.x,
        ev.worldDirection.y,
      );
      renderer.spawnMuzzleFlash(ev.worldPosition.x, ev.worldPosition.y, '#eafdff', 14);
    } else {
      renderer.spawnMuzzleFlash(ev.worldPosition.x, ev.worldPosition.y);
    }
  },
  // Q11-C-R3-FINAL：laser 不再播 Cannon 的 'fire' 音（避免与自身爆鸣混叠、保证
  // 明显区别 Cannon）；laser 的 fire 音由 onWeaponChargeEnd → stopLaserCharge 承担。
  onFireSound: (ev) => {
    if (ev.behavior !== 'laser') sfx.play('fire');
  },
  // Q11-C：蓄能光点（laser）——partId 为 key，发射完成清除
  // Q11-C-R2：蓄能音效升调/增强（progress 驱动）
  onWeaponCharge: (ev) => {
    renderer.spawnCharge(ev.partId, ev.worldPosition.x, ev.worldPosition.y, ev.progress);
    sfx.startLaserCharge(ev.progress);
  },
  // Q11-C-R2：fire 立即结束 charge 声 + 高频爆鸣 + 低频冲击
  onWeaponChargeEnd: (ev) => {
    renderer.clearCharge(ev.partId);
    sfx.stopLaserCharge();
  },
  onHitFlash: (ev) => renderer.spawnHitFlash(ev.target),
  onHitSpark: (ev) =>
    renderer.spawnSpark(
      ev.contactPoint.x,
      ev.contactPoint.y,
      damageFeedbackColors(ev.damageSource).spark,
    ),
  onDamageSound: () => sfx.play('hit'),
  onDamageNumber: (ev) => {
    // Q08-C：damage<=0 不显示无意义「-0」——Gameplay/DamageResolver 仍照常结算，
    // 只去掉无意义 Presentation 数字。
    const dmg = Math.round(ev.damage);
    if (dmg <= 0) return;
    const c = damageFeedbackColors(ev.damageSource);
    renderer.spawnDamageNumber(
      ev.contactPoint.x,
      ev.contactPoint.y,
      `-${dmg}`,
      c.number,
    );
  },
  onDeathFx: (ev) => {
    renderer.spawnDeathFx(ev.team);
    // W2-FX-2：死亡表现层定格 80~120ms（timeScale=0 冻结战斗推进，禁止修改
    // Gameplay/Physics 时间语义——恢复原 timeScale，不写死进任何规则）
    if (!lab.paused) {
      if (!deathPause.active) prevTimeScale = lab.timeScale;
      deathPause.trigger(100);
      if (lab.timeScale !== 0) lab.timeScale = 0;
    }
  },
  onDeathSound: () => sfx.play('death'),
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

/* ---------- 稳定取景（Q02-CAM-R1）：只在 load / Reset / resize 时构图一次 ---------- */
let currentCamera: ScenarioCamera | null = null;

/** 取当前 orchestrator 的 arena 尺寸（运行时 config，Planck/Matter 共用） */
function arenaDims(): { w: number; h: number } {
  const o = lab.orchestrator;
  if (o instanceof PlanckBattleOrchestrator) {
    return { w: o.arena.config.width, h: o.arena.config.height };
  }
  if (o instanceof BattleOrchestrator) {
    return { w: o.arena.config.width, h: o.arena.config.height };
  }
  return { w: 1600, h: 900 };
}

/** 按当前取景模式构图一次并固定（运行期间不再重算，无呼吸缩放/无跟随） */
function reframeCamera(): void {
  const orch = lab.orchestrator;
  if (!orch) return;
  // Q08-A：Custom 正式 Battle（装配测试模式、非 Preview）→ battle fit 按当前 Arena
  // phase 构图（Active 近景 / Warning 中景 / Closing+End 全景安全构图，见 renderer）；
  // Editing Preview：近距放大 fit（Q06-UX-R2-FIX）；机制场景维持原 fit 语义。
  const fit: CameraFit =
    uiMode === 'build'
      ? lab.previewMode
        ? 'preview' // 装配 Preview：明显放大，优先看清 Body 与 Functional 部件
        : 'battle' // 正式战斗：按 phase 构图（Q08-A）
      : (currentCamera?.fit ?? 'vehicles');
  renderer.reframe(
    orch.getRenderSnapshot(),
    fit,
    {
      forwardExtent: currentCamera?.forwardExtent,
      recoilExtent: currentCamera?.recoilExtent,
      // Q08-A：battle fit 需要 phase（Active→近景 / Warning→中景 / Closing+End→全景）
      phase: fit === 'battle' ? orch.phase : undefined,
    },
  );
}

/* ---------- 顶层模式 + 战斗状态（Q06-UX-R1） ---------- */

type UiMode = 'build' | 'scenario';
type BattleState = 'editing' | 'fighting' | 'ended';

let uiMode: UiMode = 'build'; // 默认【装配测试】
let battleState: BattleState = 'editing';
let buildControlsLocked = false; // Fighting 时锁定 A/B 全部 Build 控件
let lastShownResult: BattleOrchestratorApi['result'] = null;

function addButton(parent: HTMLElement, text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = text;
  b.onclick = onClick;
  parent.appendChild(b);
  return b;
}

/* ---------- Build 编辑状态（Draft 模型；编辑 → 实时 Preview） ---------- */

// Q10-A：正常装配（玩家）只展示当前正式内容——西瓜 / 香蕉。
// wedgeBody / boxBody / tallBody / heavyBox 不删除、不在此处暴露，
// 仍完整保留在 registry 供 Scenario / Preset / 开发测试链使用。
const BODY_OPTIONS: Array<{ v: string; t: string }> = [
  { v: 'watermelonBody', t: '西瓜车身（宽厚低矮）' },
  { v: 'bananaBody', t: '香蕉车身（长条弧形）' },
];

// Q10-B：玩家侧轮径命名（小/标准/大认知保留；三张等权卡片同一行展示）
const WHEEL_OPTIONS: Array<{ v: string; t: string }> = [
  { v: '12', t: '12 小' },
  { v: '20', t: '20 标准' },
  { v: '26', t: '26 大' },
];

// F-DEV-1：PART_OPTIONS 移入独立模块（src/core/partOptions.ts，UI 与测试共用同一数据源）
import { PART_OPTIONS } from './core/partOptions';

/** W2-SIL-1 视觉样板 Draft：双车并排展示 5 个首批正式 Content 轮廓
 *  - front=pushRod（基座在 chassis 侧、推板在前，Prismatic 伸缩自然）
 *  - frontMass=cannon（炮管与真实 muzzle 对齐，barrel +X）
 *  - top=hammer（pivot 与 Revolute 一致，锤头远端）
 *  - rear=空
 *  energy=20+30+25=75；watermelon capacity 110 ✓、banana 90 ✓；≥1 Weapon ✓ */
function silDraft(bodyDefId: string): BuildDraft {
  const body = registry.bodies.get(bodyDefId)!;
  const selections: Record<string, string> = {};
  for (const hp of body.functionalHardpoints) {
    if (hp.id === 'front') selections[hp.id] = 'pushRod';
    else if (hp.id === 'frontMass') selections[hp.id] = 'cannon';
    else if (hp.id === 'top') selections[hp.id] = 'hammer';
    else selections[hp.id] = EMPTY_SLOT;
  }
  return { bodyDefId, rearRadius: 20, frontRadius: 20, functionalSelections: selections };
}

const draftA = silDraft('watermelonBody');
const draftB = silDraft('bananaBody');

function currentSnapshot(side: 'A' | 'B'): BuildSnapshot {
  return buildSnapshotFromDraft(
    side === 'A' ? draftA : draftB,
    registry,
    side === 'A' ? 'customA' : 'customB',
  );
}

/** 渲染一侧 Build 面板（Body / 轮径卡片 / 真实 Functional 挂点卡片 / Energy / 校验错误）。
 *  W2-UX-R2：opts.collapsed=true 时表单折叠（B 当前对手默认收起，仅保留「编辑对手」入口） */
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
    toggle.disabled = buildControlsLocked;
    toggle.onclick = () => {
      bEditorOpen = !bEditorOpen;
      refreshFromEdit();
    };
    header.appendChild(toggle);
  }
  panel.appendChild(header);

  const form = document.createElement('div');
  form.style.display = opts.collapsed ? 'none' : '';
  panel.appendChild(form);

  const body = registry.bodies.get(d.bodyDefId);
  const snapshot = currentSnapshot(d === draftA ? 'A' : 'B');

  // Q09-A：Body / 前后轮去表单化——选项卡片（看选项 → 点一下 → Preview 立即变化，无 Apply）。
  // 点击立即更新 Draft → refreshFromEdit（Energy / Validator / 真实 Planck Preview）。
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
    // Q10-B：3 档及以下（轮径）同一行等权卡片；更多（Body）保持两列
    cards.className = 'opt-cards' + (options.length <= 3 ? ' wheel' : '');
    for (const opt of options) {
      const b = document.createElement('button');
      b.className = 'opt-card' + (isActive(opt.v) ? ' active' : '');
      b.textContent = opt.t;
      b.disabled = buildControlsLocked;
      b.onclick = () => {
        if (buildControlsLocked) return;
        onPick(opt.v);
        refreshFromEdit(); // Draft → Energy → Validator → 真实 Planck Preview（无 Apply）
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

  // Q07-B：Functional 挂点卡片化——按当前 Body 真实 hardpoints 生成挂点卡片，
  // 卡片直接显示当前安装内容；点击卡片选中（明确选中态）并展开部件选择区。
  // 点选项立即更新 Draft → Energy → Validator → 真实 Planck Preview（无 Apply）。
  if (body) {
    const isA = d === draftA;
    const selSlot = isA ? selectedSlotA : selectedSlotB;
    const slotList = document.createElement('div');
    slotList.className = 'part-slots';
    for (const hpId of editableSlots(body)) {
      const cur = d.functionalSelections[hpId] ?? EMPTY_SLOT;
      const curName =
        cur === EMPTY_SLOT ? '空' : registry.functionals.get(cur)?.name ?? cur;
      const card = document.createElement('button');
      card.className = 'part-slot-card' + (selSlot === hpId ? ' active' : '');
      card.disabled = buildControlsLocked;
      const lab2 = document.createElement('span');
      lab2.className = 'ps-label';
      lab2.textContent = slotLabel(hpId);
      const val = document.createElement('span');
      val.className = 'ps-value' + (cur === EMPTY_SLOT ? ' empty' : '');
      val.textContent = `[${curName}]`;
      card.appendChild(lab2);
      card.appendChild(val);
      card.onclick = () => {
        if (buildControlsLocked) return;
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
      const picker = document.createElement('div');
      picker.className = 'part-picker';
      const title = document.createElement('div');
      title.className = 'pp-title';
      title.textContent = `正在改「${slotLabel(selSlot)}」`;
      picker.appendChild(title);
      for (const opt of PART_OPTIONS) {
        const b = document.createElement('button');
        b.className = cur === opt.v ? 'active' : '';
        b.disabled = buildControlsLocked;
        // Q09-B：名称 + 武器/辅助类别 + Energy（当前装备仍 .active 高亮）
        const nameEl = document.createElement('div');
        nameEl.className = 'pp-name';
        nameEl.textContent = opt.t;
        const metaEl = document.createElement('div');
        metaEl.className = 'pp-meta';
        if (opt.v === EMPTY_SLOT) {
          metaEl.textContent = '空 · 0 能量';
        } else {
          const def = registry.functionals.get(opt.v);
          if (def) {
            // Q10-B：玩家侧类别命名——武器 / 辅助（内部 category defId 不变）
            const cat = def.category === 'weapon' ? '武器' : def.category === 'gadget' ? '辅助' : def.category;
            metaEl.textContent = `${cat} · ${def.energy} 能量`;
          } else {
            metaEl.textContent = '—';
          }
        }
        b.appendChild(nameEl);
        b.appendChild(metaEl);
        b.onclick = () => {
          if (buildControlsLocked) return;
          d.functionalSelections[selSlot] = opt.v; // 立即生效（无 Apply）
          refreshFromEdit(); // Draft → Energy → Validator → 真实 Planck Preview
        };
        picker.appendChild(b);
      }
      form.appendChild(picker);
    }
  }

  // Q09-B：Energy 明显表现——used / capacity 条形 + 数字（超载沿用现有
  // Validator/ computeEnergy 逻辑，仅表现层红色，不新增规则）
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
    const eTxt = Number.isFinite(used) ? String(used) : '?';
    summary.appendChild(document.createTextNode(` · 能量 ${eTxt}/${capacity}`));
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

/** W2-UX-R2：B 测试对手编辑是否展开（默认折叠，降低首屏信息量；能力不删除） */
let bEditorOpen = false;

/** Q07-B：A/B 各自当前选中的 Functional 挂点（null = 未选中；per-panel，互不干扰） */
let selectedSlotA: string | null = null;
let selectedSlotB: string | null = null;

/** 中央显示当前 Draft 的真实 Planck 装配预览（不推进战斗） */
function showPreview(): void {
  const sa = currentSnapshot('A');
  const sb = currentSnapshot('B');
  lab.loadCustomPreview(sa, sb);
  currentCamera = null; // 自定义 Preview：取景 A+B
  reframeCamera();
}

/** Q07-B：只重渲染 A/B 面板（挂点选中态 / 部件选择区显隐），不重建 Preview（Draft 未变） */
function renderPanelsOnly(): void {
  renderPanel(panelA, '我的车辆 A', draftA);
  // Q07-A：B 明确叫「当前对手」——默认只显示概要 + 「编辑对手」入口，不展开完整表单
  renderPanel(panelB, '当前对手 B', draftB, {
    collapsed: !bEditorOpen,
    expandLabel: '编辑对手',
  });
}

/** 编辑后刷新：面板 + （非战斗时）实时 Preview + 按钮/阻断原因 */
function refreshFromEdit(): void {
  renderPanelsOnly();
  if (battleState !== 'fighting') {
    showPreview();
  }
  updateStartButton();
}

/** A/B 是否均合法 */
function buildsValid(): boolean {
  return (
    validateSnapshot(currentSnapshot('A'), registry).valid &&
    validateSnapshot(currentSnapshot('B'), registry).valid
  );
}

/** Start 阻断原因（A/B 各自最主要错误；合法为 null） */
function blockReason(): string | null {
  const va = validateSnapshot(currentSnapshot('A'), registry);
  if (!va.valid && va.errors[0]) return `A：${va.errors[0]}`;
  const vb = validateSnapshot(currentSnapshot('B'), registry);
  if (!vb.valid && vb.errors[0]) return `B：${vb.errors[0]}`;
  return null;
}

/** 锁定 / 解锁 A/B 全部 Build 控件（Fighting 时锁定） */
function setBuildControlsLocked(locked: boolean): void {
  buildControlsLocked = locked;
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
  sideToggle.disabled = locked;
}

/* ---------- 工具栏（Q07-A：不再有模式双主按钮；Start 是唯一主 CTA，位于画布底部） ---------- */

// Q07-A：机制场景不再是同级主按钮——场景选择收进「开发工具」折叠区（toolsHost 内）；
// scenario 模式下才显示低优先级「返回装配」。
const backToBuildBtn = addButton(toolbar, '返回装配', () => setMode('build'));
backToBuildBtn.style.display = 'none';

// 场景选择（开发工具折叠区内显示；选中即进入机制场景模式）
const scenarioSelect = document.createElement('select');
SCENARIOS.forEach((s) => {
  const opt = document.createElement('option');
  opt.value = s.id;
  opt.textContent = `${s.id} · ${s.name}`;
  scenarioSelect.appendChild(opt);
});
scenarioSelect.onchange = () => {
  const sc = SCENARIOS.find((s) => s.id === scenarioSelect.value);
  if (sc) {
    setMode('scenario'); // Q07-A：从开发工具选中场景 → 直接进入机制场景模式
    lab.loadScenario(sc);
    lastShownResult = null;
    currentCamera = sc.camera ?? null;
    reframeCamera();
    updateHud(); // 场景模式隐藏战斗 HUD
  }
};

// Start 阻断原因（Q07-A：挂到画布底部 start-bar，与 Start 主 CTA 就近显示）
const startHint = document.createElement('span');
startHint.className = 'start-hint';

/** 开战 / 原配置再战：重新 validate 当前 Draft → Planck loadCustom → Fighting 专注模式 */
function startOrRematch(): void {
  const sa = currentSnapshot('A');
  const sb = currentSnapshot('B');
  if (!validateSnapshot(sa, registry).valid || !validateSnapshot(sb, registry).valid) {
    return; // 任一非法：不启动
  }
  lab.loadCustom(sa, sb, { autoDrive: true, engine: 'planck' });
  battleState = 'fighting';
  setBuildControlsLocked(true);
  // Q07-C：Fighting 彻底进入「战斗观看状态」——装配编辑 / 对手编辑 / Energy-Validator /
  // 开发工具入口全部隐藏；只保留战场 + A/B HP + 阶段提示。
  panelA.style.display = 'none';
  panelB.style.display = 'none';
  startBar.style.display = 'none';
  startHint.style.display = 'none';
  toolsToggle.style.display = 'none';
  toolsHost.style.display = 'none';
  resultModal.style.display = 'none';
  currentCamera = null;
  // Q08-CAM-A1：面板隐藏 → canvas CSS clientWidth 已变宽，但 backing
  // (canvas.width/height) 未同步——必须先 doResize()（内部 renderer.resize 按
  // clientWidth×DPR 同步 backing + reframeCamera）再构图，否则 Battle 刚进入
  // 即按新 clientWidth 取景、绘制在旧 backing 上 → 右侧被裁。
  doResize();
  updateHud();
  updateStartButton();
}

/* ---------- Q07-A：Start 唯一主 CTA（画布底部固定，合法高亮 / 非法禁用 + 就近原因） ---------- */
const startBar = document.createElement('div');
startBar.className = 'start-bar';
canvasWrap.appendChild(startBar);

const btnStart = document.createElement('button');
btnStart.className = 'btn-start-cta';
btnStart.textContent = '开始战斗';
startBar.appendChild(btnStart);
startBar.appendChild(startHint);

/* ---------- Q07-C：Start 后短暂状态转换（READY / 开战 0.8s；Presentation 延迟，
 * 不改 Physics 时间与正式 Battle 结果——build/engine/seed 均不变，只是晚 0.8s 创建实例） ---------- */
const readyOverlay = document.createElement('div');
readyOverlay.className = 'ready-overlay';
canvasWrap.appendChild(readyOverlay);
const readyCard = document.createElement('div');
readyCard.className = 'ready-card';
const readySub = document.createElement('div');
readySub.className = 'rd-sub';
readySub.textContent = 'READY';
const readyMain = document.createElement('div');
readyMain.className = 'rd-main';
readyMain.textContent = '开战！';
readyCard.appendChild(readySub);
readyCard.appendChild(readyMain);
readyOverlay.appendChild(readyCard);

let startTransitioning = false;
btnStart.onclick = () => {
  if (startTransitioning) return;
  if (battleState !== 'editing' || !buildsValid()) return;
  // Q11-C-R2：用户 Start 交互 → 恢复 AudioContext（浏览器自动播放策略）
  sfx.resume();
  // Q08-B：点击 Start 瞬间「配置结束」——立刻退出编辑视觉：
  // 隐藏 A/B 装配面板、开发工具、Start；Build 从此刻冻结（不再可操作），
  // 中央两车 Preview 成为 READY 背景，而不是在编辑器上弹一句开战。
  startTransitioning = true;
  btnStart.disabled = true;
  setBuildControlsLocked(true); // Build 从点击那一刻冻结（Runtime 输入语义不变）
  panelA.style.display = 'none';
  panelB.style.display = 'none';
  startBar.style.display = 'none';
  startHint.style.display = 'none';
  toolsToggle.style.display = 'none';
  toolsHost.style.display = 'none';
  // Q08-CAM-A1：面板隐藏 → canvas CSS 变宽，先同步 backing，README 背景
  // （两车 Preview）按新尺寸正常显示，不横向拉伸。
  doResize();
  readyOverlay.style.display = 'flex'; // READY / 开战！（0.6s；背景 = 保留的中央 Preview）
  window.setTimeout(() => {
    readyOverlay.style.display = 'none';
    startTransitioning = false;
    startOrRematch();
    if (battleState !== 'fighting') {
      // 理论上不可达（已锁定且校验通过），防御：完整恢复编辑视觉
      setBuildControlsLocked(false);
      panelA.style.display = '';
      panelB.style.display = '';
      startBar.style.display = '';
      toolsToggle.style.display = '';
      updateStartButton();
    }
  }, 600);
};

/* ---------- Q07-A：开发工具折叠区（机制场景 / Pause / Reset / Clear / 速度 / Preset 全部收进二级） ---------- */
const toolsToggle = addButton(toolbar, '开发工具 ▸', () => {
  toolsOpen = !toolsOpen;
  toolsHost.style.display = toolsOpen ? '' : 'none';
  toolsToggle.textContent = toolsOpen ? '开发工具 ▾' : '开发工具 ▸';
  toolsToggle.classList.toggle('active', toolsOpen);
});
toolsToggle.classList.add('dev-toggle');
const toolsHost = document.createElement('div');
toolsHost.className = 'tool-tools-host';
// Q07-A：机制场景入口收进开发工具（不再是同级主模式按钮）
toolsHost.appendChild(scenarioSelect);
const toolsLabel = document.createElement('span');
toolsLabel.className = 'tool-tools-label';
toolsLabel.textContent = '调试：';
toolsHost.appendChild(toolsLabel);
main.insertBefore(toolsHost, canvasWrap); // 放在工具栏下方、画面之上
let toolsOpen = false;

/** 按钮状态机 + Start 阻断原因（结果由中央结算卡展示，不再用 toolbar 小字） */
function updateStartButton(): void {
  const valid = buildsValid();

  // Start 阻断原因（仅编辑态提示）
  if (battleState === 'fighting' || battleState === 'ended') {
    startHint.textContent = '';
  } else {
    const reason = valid ? null : blockReason();
    startHint.textContent = reason ?? '';
    startHint.style.display = reason ? '' : 'none';
  }

  // 主 CTA（Q07-A：start-bar 整体）：editing 显示「开始战斗」；fighting/ended 隐藏
  if (battleState === 'fighting' || battleState === 'ended') {
    startBar.style.display = 'none';
  } else {
    startBar.style.display = '';
    btnStart.textContent = '开始战斗';
    btnStart.disabled = !valid; // 非法：禁用 + startHint 就近显示原因
  }
}

/** 每帧轮询：result 变化 → Ended（显示中央结算卡；Build 控件保持锁定，先选「调整配置」） */
function pollBattleResult(): void {
  const r = lab.orchestrator?.result ?? null;
  if (r === lastShownResult) return;
  lastShownResult = r;
  if (uiMode === 'build' && battleState === 'fighting' && r && r.phase === 'End') {
    battleState = 'ended';
    showResultModal(r); // 结算卡成为第一视觉焦点
    updateHud();
  }
  updateStartButton();
}

/** 顶层模式切换（Q07-A）：装配（默认主页面）↔ 机制场景（开发工具入口）。
 *  不再有双主按钮——scenario 由开发工具内场景选择进入，backToBuildBtn 返回装配。 */
function setMode(m: UiMode): void {
  uiMode = m;
  backToBuildBtn.style.display = m === 'scenario' ? '' : 'none';
  const showBuild = m === 'build';
  panelA.style.display = showBuild ? '' : 'none';
  panelB.style.display = showBuild ? '' : 'none';
  startBar.style.display = showBuild && battleState === 'editing' ? '' : 'none';
  startHint.style.display = showBuild && battleState === 'editing' ? '' : 'none';
  // Q07-A：scenarioSelect 位于开发工具折叠区内，显示与否由 toolsHost 控制，不再单独切换
  debugPanel.style.display = showBuild ? 'none' : '';
  resultModal.style.display = 'none'; // 模式切换关闭结算卡
  hudEl.style.display = 'none';
  // Q08-CAM-A1：模式切换改面板显隐 → canvas CSS 尺寸变化，先同步 backing 再构图
  doResize();
  if (showBuild && battleState !== 'fighting') {
    showPreview(); // 切回装配测试：恢复 Draft Preview（不把 Scenario 车辆伪装成 Preview）
  }
  updateStartButton();
}

/* ---------- 其余工具栏（Pause / Reset / Clear / 时间缩放）——收进「测试工具」折叠区 ---------- */

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
  lastShownResult = null;
  resultModal.style.display = 'none';
  // preview 重建 → Editing（中央恢复装配预览）；battle 重建 → Fighting
  if (uiMode === 'build') {
    battleState = lab.previewMode ? 'editing' : 'fighting';
    setBuildControlsLocked(!lab.previewMode);
    if (lab.previewMode) {
      panelA.style.display = '';
      panelB.style.display = '';
      startBar.style.display = '';
      toolsToggle.style.display = ''; // Q07-C：回装配恢复开发工具入口
      // Q08-CAM-A1：面板恢复 → CSS 变窄，先同步 backing 再构图
      doResize();
    } else {
      reframeCamera(); // Fighting：布局未变（面板已隐藏）
    }
    updateHud();
    updateStartButton();
  }
});
addButton(toolsHost, 'Clear', () => {
  lab.clear();
  lastShownResult = null;
  currentCamera = null;
  resultModal.style.display = 'none';
  hudEl.style.display = 'none';
  if (uiMode === 'build') {
    battleState = 'editing';
    setBuildControlsLocked(false);
    panelA.style.display = '';
    panelB.style.display = '';
    startBar.style.display = '';
    toolsToggle.style.display = ''; // Q07-C：回装配恢复开发工具入口
    doResize(); // Q08-CAM-A1：面板恢复 → CSS 变窄，先同步 backing
    showPreview(); // Clear 后恢复装配预览
    updateStartButton();
  }
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
let sideToggle!: HTMLButtonElement;
const presetButtons: HTMLButtonElement[] = [];
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
    sideToggle.textContent = `装载 → ${targetSide}`;
    ph.textContent = 'Preset 快捷（装到 ' + targetSide + '）';
  });

  PRESETS.forEach((p) => {
    const b = document.createElement('button');
    b.textContent = p.name;
    b.style.cssText =
      'display:block;width:100%;margin:4px 0;padding:5px;background:#242b38;color:#e8e8f0;border:1px solid #38414f;border-radius:5px;cursor:pointer;';
    b.onclick = () => {
      const target = targetSide === 'A' ? draftA : draftB;
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
      refreshFromEdit();
    };
    presetBox.appendChild(b);
    presetButtons.push(b);
  });
}

/* ---------- Debug 面板（仅机制场景模式显示） ---------- */
{
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

  // 「全部关闭」（Q02-LAB-DEBUG-UX）：一次取消所有 Debug 显示项，立即更新画面。
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
        reframeCamera(); // Override 触发 reset：重新构图一次
      }
    };
    lab2.appendChild(inp);
    debugPanel.appendChild(lab2);
  }
}

/* ---------- 初始：默认装配测试模式 + Draft Preview（不启动 Scenario） ---------- */
refreshFromEdit();
setMode('build');

function doResize(): void {
  const d = arenaDims();
  renderer.resize(d.w, d.h);
  reframeCamera(); // viewport resize：重新构图一次
}
window.addEventListener('resize', doResize);
doResize();

/* ---------- W2-FX-2：阶段表现轮询（Warning 倒计时 + 场边红脉冲 + 刺墙预高亮/Closing 进入） ---------- */
let lastPhase: string | null = null;
let phaseStartTimeMs = 0;
let lastPhaseOrch: unknown = null;
function pollArenaPhase(nowMs: number): void {
  const o = lab.orchestrator;
  // 战斗实例变化（load / reset / preview 重建）→ 阶段状态重置
  if (o !== lastPhaseOrch) {
    lastPhaseOrch = o;
    lastPhase = null;
    phaseStartTimeMs = 0;
  }
  // Preview / 无战斗：不显示阶段表现
  if (!o || lab.previewMode) {
    phaseCountdown.style.display = 'none';
    canvasWrap.classList.remove('phase-warning');
    return;
  }
  if (o.phase !== lastPhase) {
    lastPhase = o.phase;
    phaseStartTimeMs = o.timeMs;
    // Q08-A：phase 切换（Active→Warning→Closing/End）→ 稳定切换一次构图
    // （battle fit 按 phase：近景→中景→全景；非每帧重算、无呼吸/无跟随）。
    reframeCamera();
  }
  const phase = o.phase;
  const inWarning = phase === 'Warning' && o.result?.phase !== 'End';
  canvasWrap.classList.toggle('phase-warning', inWarning);
  if (inWarning) {
    const warningMs = o.config.arena?.phases?.warningMs ?? 3000;
    const remaining = phaseRemainingMs(phase, warningMs, o.timeMs - phaseStartTimeMs);
    phaseCountdown.textContent = warningCountdown(remaining);
    phaseCountdown.style.display = '';
  } else {
    // Closing / Active / End：倒计时消失（Closing 开始后刺墙正式进入，由 Renderer 表现）
    phaseCountdown.style.display = 'none';
  }
  // Death 定格恢复：表现层 80~120ms 冻结结束 → 恢复原 timeScale（不改 Gameplay/Physics 语义）
  if (deathPause.active && deathPause.shouldResume()) {
    lab.timeScale = prevTimeScale;
    deathPause.clear();
  }
  void nowMs;
}

let last = performance.now();
function loop(now: number): void {
  const dt = Math.min(50, now - last);
  last = now;
  lab.step(dt);
  lab.render();
  pollArenaPhase(now); // 阶段倒计时 / 场边红脉冲 / Death 定格恢复
  pollBattleResult(); // result 变化 → Ended 迁移 + 结果展示
  updateHud(); // 每帧读取 getBattleStatusSnapshot() → 顶部 A/B HP 实时
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
