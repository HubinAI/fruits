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
import { PhysicsLab } from './lab/physicsLab';
import { SCENARIOS, type ScenarioCamera } from './lab/scenarios';
import { PRESETS } from './lab/presets';
import { TIME_SCALES } from './render/debugOverlay';
import { BattleOrchestrator } from './battle/battleOrchestrator';
import { PlanckBattleOrchestrator } from './battle/planckBattleOrchestrator';
import type { BattleOrchestratorApi } from './battle/battleContract';
import type { BuildSnapshot } from './core/types';
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
  .result-modal { position: absolute; inset: 0; background: rgba(6,8,12,0.55); display: none; align-items: center; justify-content: center; z-index: 10; }
  .result-card { background: #1c2330; border: 1px solid #38414f; border-radius: 12px; padding: 26px 44px; text-align: center; min-width: 300px; }
  .result-title { margin: 0 0 14px; font-size: 30px; letter-spacing: 4px; }
  .result-hp { margin: 6px 0; font-size: 15px; color: #c8d0e0; }
  .result-actions { display: flex; gap: 10px; justify-content: center; margin-top: 18px; }
  .result-actions button { background: #242b38; color: #e8e8f0; border: 1px solid #38414f; border-radius: 6px; padding: 8px 16px; cursor: pointer; font-size: 14px; }
  .result-actions button:hover { background: #2e3747; }
  .result-actions button.primary { background: #3b6fd4; border-color: #4a7fe0; }
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

/** Ended 后玩家选择：调整配置 → 回 Editing + Preview */
function adjustConfig(): void {
  resultModal.style.display = 'none';
  hudEl.style.display = 'none';
  battleState = 'editing';
  setBuildControlsLocked(false);
  panelA.style.display = '';
  panelB.style.display = '';
  btnStart.style.display = '';
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
btnRematch.textContent = '原配置再战';
btnRematch.onclick = rematch;
resultActions.appendChild(btnRematch);

const renderer = new Renderer(canvas);
const lab = new PhysicsLab(renderer);

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
  // W1-P0-CLOSE-FIX：Custom 正式 Battle（装配测试模式、非 Preview）→ 固定战场构图
  // （覆盖 Arena 有效战斗区域，车辆被 Closing 推向边缘/中央的全过程始终可见）；
  // Editing Preview / 机制场景维持原 fit 语义。
  const fit: CameraFit =
    uiMode === 'build' && !lab.previewMode ? 'battle' : (currentCamera?.fit ?? 'vehicles');
  renderer.reframe(
    orch.getRenderSnapshot(),
    fit,
    {
      forwardExtent: currentCamera?.forwardExtent,
      recoilExtent: currentCamera?.recoilExtent,
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

const BODY_OPTIONS: Array<{ v: string; t: string }> = [
  { v: 'wedgeBody', t: '楔形车身（低前鼻）' },
  { v: 'boxBody', t: '箱式车身（厚实）' },
  { v: 'tallBody', t: '高身车身（compact）' },
  { v: 'heavyBox', t: '重型车身' },
];

const WHEEL_OPTIONS: Array<{ v: string; t: string }> = [
  { v: '12', t: '12（小）' },
  { v: '20', t: '20（标准）' },
  { v: '26', t: '26（大）' },
];

/** 正式可编辑部件（ramHead/testMass 非本轮已通过内容，不暴露） */
const PART_OPTIONS: Array<{ v: string; t: string }> = [
  { v: EMPTY_SLOT, t: '空' },
  { v: 'cannon', t: 'Cannon（炮）' },
  { v: 'hammer', t: 'Hammer（锤）' },
  { v: 'pushRod', t: 'Push Rod（推杆）' },
];

/** 默认合法可玩配置（Q06-UX-R1 首屏要求：进入即两车完整 Preview + Start 可点） */
function initialDraft(bodyDefId: string, frontPart: string): BuildDraft {
  return {
    bodyDefId,
    rearRadius: 20,
    frontRadius: 20,
    functionalSelections: { front: frontPart },
  };
}

const draftA = initialDraft('boxBody', 'cannon');
const draftB = initialDraft('heavyBox', 'cannon');

function currentSnapshot(side: 'A' | 'B'): BuildSnapshot {
  return buildSnapshotFromDraft(
    side === 'A' ? draftA : draftB,
    registry,
    side === 'A' ? 'customA' : 'customB',
  );
}

/** 渲染一侧 Build 面板（Body / 轮径 / 真实 Functional 槽位 / Energy / 校验错误） */
function renderPanel(
  panel: HTMLElement,
  title: string,
  d: BuildDraft,
  onChanged: () => void,
): void {
  panel.replaceChildren();

  const h = document.createElement('h3');
  h.textContent = title;
  panel.appendChild(h);

  const body = registry.bodies.get(d.bodyDefId);
  const snapshot = currentSnapshot(d === draftA ? 'A' : 'B');

  const mkSelect = (
    label: string,
    options: Array<{ v: string; t: string }>,
    value: string,
    onChange: (v: string) => void,
  ): void => {
    const lab2 = document.createElement('label');
    lab2.textContent = label;
    const sel = document.createElement('select');
    options.forEach((o) => {
      const opt = document.createElement('option');
      opt.value = o.v;
      opt.textContent = o.t;
      sel.appendChild(opt);
    });
    sel.value = value;
    sel.disabled = buildControlsLocked;
    sel.onchange = () => {
      onChange(sel.value);
      onChanged();
    };
    lab2.appendChild(sel);
    panel.appendChild(lab2);
  };

  mkSelect('车身', BODY_OPTIONS, d.bodyDefId, (v) => {
    const migrated = migrateDraftBody(d, v, registry);
    d.bodyDefId = migrated.bodyDefId;
    d.functionalSelections = migrated.functionalSelections;
  });
  mkSelect('后轮', WHEEL_OPTIONS, String(d.rearRadius), (v) => {
    d.rearRadius = Number(v);
  });
  mkSelect('前轮', WHEEL_OPTIONS, String(d.frontRadius), (v) => {
    d.frontRadius = Number(v);
  });

  // Functional 槽位：按当前 Body 真实 hardpoints 动态生成（不区分 Weapon/Gadget 槽）
  if (body) {
    for (const hpId of editableSlots(body)) {
      const cur = d.functionalSelections[hpId] ?? EMPTY_SLOT;
      // 主标签为位置语义；内部 id 作次级文字
      mkSelect(`${slotLabel(hpId)}（${hpId}）`, PART_OPTIONS, cur, (v) => {
        d.functionalSelections[hpId] = v;
      });
    }
  }

  // Energy：used / capacity（复用 computeEnergy，不复制计算逻辑）
  const energyRes = computeEnergy(snapshot, registry);
  const used = energyRes.error ? Number.NaN : energyRes.energy;
  const capacity = body?.energyCapacity ?? 0;
  const overload = Number.isFinite(used) && used > capacity;
  const eRow = document.createElement('label');
  eRow.textContent = `能量：${Number.isFinite(used) ? used : '?'} / ${capacity}`;
  eRow.style.color = overload ? '#ff6b5e' : '#9aa4b5';
  panel.appendChild(eRow);
}

/** 中央显示当前 Draft 的真实 Planck 装配预览（不推进战斗） */
function showPreview(): void {
  const sa = currentSnapshot('A');
  const sb = currentSnapshot('B');
  lab.loadCustomPreview(sa, sb);
  currentCamera = null; // 自定义 Preview：取景 A+B
  reframeCamera();
}

/** 编辑后刷新：面板 + （非战斗时）实时 Preview + 按钮/阻断原因 */
function refreshFromEdit(): void {
  renderPanel(panelA, 'A 车 Build', draftA, refreshFromEdit);
  renderPanel(panelB, 'B 车 Build', draftB, refreshFromEdit);
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
  for (const b of presetButtons) b.disabled = locked;
  sideToggle.disabled = locked;
}

/* ---------- 工具栏：模式切换 / 场景选择 / 战斗按钮 / 结果与阻断提示 ---------- */

const modeBuildBtn = addButton(toolbar, '装配测试', () => setMode('build'));
const modeScenarioBtn = addButton(toolbar, '机制场景', () => setMode('scenario'));

// 场景选择（仅机制场景模式显示）
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
    lab.loadScenario(sc);
    lastShownResult = null;
    currentCamera = sc.camera ?? null;
    reframeCamera();
    updateHud(); // 场景模式隐藏战斗 HUD
  }
};
toolbar.appendChild(scenarioSelect);

// Start 阻断原因（Start 附近直接显示，不要求去左右面板找红字）
const startHint = document.createElement('span');
startHint.style.cssText = 'color:#ff6b5e;font-size:12px;margin-left:8px;';
toolbar.appendChild(startHint);

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
  // Fighting 专注模式：Build 面板收起，Canvas 自动扩展 + 顶部固定 HUD
  panelA.style.display = 'none';
  panelB.style.display = 'none';
  btnStart.style.display = 'none';
  startHint.style.display = 'none';
  resultModal.style.display = 'none';
  currentCamera = null;
  reframeCamera();
  updateHud();
  updateStartButton();
}

const btnStart = addButton(toolbar, '开始战斗', startOrRematch);

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

  // 按钮：editing 显示「开始战斗」；fighting/ended 隐藏（战斗流程由结算卡接管）
  if (battleState === 'fighting' || battleState === 'ended') {
    btnStart.style.display = 'none';
  } else {
    btnStart.style.display = '';
    btnStart.textContent = '开始战斗';
    btnStart.disabled = !valid;
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

/** 顶层模式切换：装配测试 / 机制场景（控件严格互斥） */
function setMode(m: UiMode): void {
  uiMode = m;
  modeBuildBtn.classList.toggle('active', m === 'build');
  modeScenarioBtn.classList.toggle('active', m === 'scenario');
  const showBuild = m === 'build';
  panelA.style.display = showBuild ? '' : 'none';
  panelB.style.display = showBuild ? '' : 'none';
  btnStart.style.display = showBuild && battleState === 'editing' ? '' : 'none';
  startHint.style.display = showBuild && battleState === 'editing' ? '' : 'none';
  scenarioSelect.style.display = showBuild ? 'none' : '';
  debugPanel.style.display = showBuild ? 'none' : '';
  resultModal.style.display = 'none'; // 模式切换关闭结算卡
  hudEl.style.display = 'none';
  if (showBuild && battleState !== 'fighting') {
    showPreview(); // 切回装配测试：恢复 Draft Preview（不把 Scenario 车辆伪装成 Preview）
  }
  updateStartButton();
}

/* ---------- 其余工具栏（Pause / Reset / Clear / 时间缩放） ---------- */

const btnPause = addButton(toolbar, 'Pause', () => {
  lab.paused = !lab.paused;
  btnPause.textContent = lab.paused ? 'Resume' : 'Pause';
  btnPause.classList.toggle('active', lab.paused);
});
addButton(toolbar, 'Reset', () => {
  lab.paused = false;
  btnPause.textContent = 'Pause';
  btnPause.classList.remove('active');
  lab.reset();
  lastShownResult = null;
  reframeCamera();
  resultModal.style.display = 'none';
  // preview 重建 → Editing（中央恢复装配预览）；battle 重建 → Fighting
  if (uiMode === 'build') {
    battleState = lab.previewMode ? 'editing' : 'fighting';
    setBuildControlsLocked(!lab.previewMode);
    if (lab.previewMode) {
      panelA.style.display = '';
      panelB.style.display = '';
      btnStart.style.display = '';
    }
    updateHud();
    updateStartButton();
  }
});
addButton(toolbar, 'Clear', () => {
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
    btnStart.style.display = '';
    showPreview(); // Clear 后恢复装配预览
    updateStartButton();
  }
});

// 时间缩放
toolbar.appendChild(document.createTextNode('速度 '));
const tsButtons: HTMLButtonElement[] = [];
TIME_SCALES.forEach((ts) => {
  const b = addButton(toolbar, `${ts}x`, () => {
    lab.timeScale = ts;
    tsButtons.forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
  });
  tsButtons.push(b);
});
tsButtons[0].classList.add('active');

/* ---------- Preset 快捷（仅装配测试模式显示；只装载 Body/轮径，功能槽重置 none） ---------- */
let sideToggle!: HTMLButtonElement;
const presetButtons: HTMLButtonElement[] = [];
{
  let targetSide: 'A' | 'B' = 'A';
  const presetBox = document.createElement('div');
  const ph = document.createElement('h3');
  ph.textContent = 'Preset 快捷（装到 A）';
  presetBox.appendChild(ph);
  panelA.appendChild(presetBox);

  sideToggle = addButton(toolbar, '装载 → A', () => {
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

let last = performance.now();
function loop(now: number): void {
  const dt = Math.min(50, now - last);
  last = now;
  lab.step(dt);
  lab.render();
  pollBattleResult(); // result 变化 → Ended 迁移 + 结果展示
  updateHud(); // 每帧读取 getBattleStatusSnapshot() → 顶部 A/B HP 实时
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
