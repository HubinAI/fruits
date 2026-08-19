/**
 * 入口：Physics Lab UI。
 * 左侧 Build 选择 / 右侧 Build 选择 / Start / Pause / Reset / Clear / 时间缩放 / Debug 开关 / Override。
 */
import { Renderer } from './render/renderer';
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
  .lab-main { display: flex; flex: 1; min-height: 0; }
  .lab-panel { width: 210px; padding: 12px; background: #171c26; border-right: 1px solid #2a3140; overflow-y: auto; }
  .lab-panel.right { border-right: none; border-left: 1px solid #2a3140; }
  .lab-panel h3 { font-size: 13px; color: #ffd35a; margin: 10px 0 6px; }
  .lab-panel label { display: block; font-size: 12px; color: #9aa4b5; margin-top: 8px; }
  .lab-panel select { width: 100%; margin-top: 2px; background: #242b38; color: #e8e8f0; border: 1px solid #38414f; border-radius: 4px; padding: 4px; }
  .lab-canvas-wrap { flex: 1; position: relative; }
  .lab-canvas-wrap canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
  .lab-debug { position: absolute; right: 8px; bottom: 8px; background: rgba(10,12,16,0.85); padding: 10px; border-radius: 8px; max-height: 62vh; overflow-y: auto; font-size: 12px; }
  .lab-debug label { display: block; color: #c8d0e0; margin: 3px 0; }
  .lab-debug input[type=number] { width: 64px; background: #242b38; color: #e8e8f0; border: 1px solid #38414f; border-radius: 4px; padding: 2px 4px; }
  .lab-debug h4 { color: #ffd35a; margin: 6px 0 4px; }
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

/** 按当前场景取景模式构图一次并固定（运行期间不再重算，无呼吸缩放/无跟随） */
function reframeCamera(): void {
  const orch = lab.orchestrator;
  if (!orch) return;
  renderer.reframe(
    orch.getRenderSnapshot(),
    currentCamera?.fit ?? 'vehicles',
    {
      forwardExtent: currentCamera?.forwardExtent,
      recoilExtent: currentCamera?.recoilExtent,
    },
  );
}

/* ---------- Build 编辑状态（Q06-U1：Draft 模型，编辑只改 Draft 不自动开战） ---------- */

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

function initialDraft(bodyDefId: string): BuildDraft {
  return { bodyDefId, rearRadius: 20, frontRadius: 20, functionalSelections: {} };
}

const draftA = initialDraft('boxBody');
const draftB = initialDraft('heavyBox');

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
    sel.onchange = () => {
      onChange(sel.value);
      onChanged();
    };
    lab2.appendChild(sel);
    panel.appendChild(lab2);
  };

  mkSelect('Body', BODY_OPTIONS, d.bodyDefId, (v) => {
    const migrated = migrateDraftBody(d, v, registry);
    d.bodyDefId = migrated.bodyDefId;
    d.functionalSelections = migrated.functionalSelections;
  });
  mkSelect('后轮半径', WHEEL_OPTIONS, String(d.rearRadius), (v) => {
    d.rearRadius = Number(v);
  });
  mkSelect('前轮半径', WHEEL_OPTIONS, String(d.frontRadius), (v) => {
    d.frontRadius = Number(v);
  });

  // Functional 槽位：按当前 Body 真实 hardpoints 动态生成（不区分 Weapon/Gadget 槽）
  if (body) {
    for (const hpId of editableSlots(body)) {
      const cur = d.functionalSelections[hpId] ?? EMPTY_SLOT;
      mkSelect(`槽 ${hpId}`, PART_OPTIONS, cur, (v) => {
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
  eRow.textContent = `Energy：${Number.isFinite(used) ? used : '?'} / ${capacity}`;
  eRow.style.color = overload ? '#ff6b5e' : '#9aa4b5';
  panel.appendChild(eRow);

  // 校验错误：显示最主要一条
  const validation = validateSnapshot(snapshot, registry);
  if (!validation.valid && validation.errors.length > 0) {
    const err = document.createElement('div');
    err.textContent = '⚠ ' + validation.errors[0];
    err.style.cssText = 'color:#ff6b5e;font-size:11px;margin-top:6px;';
    panel.appendChild(err);
  }
}

/** 全量刷新：A/B 面板 + 开始战斗按钮可用性 */
function refresh(): void {
  renderPanel(panelA, 'A 车 Build', draftA, refresh);
  renderPanel(panelB, 'B 车 Build', draftB, refresh);
  updateStartButton();
}

/* ---------- 工具栏 ---------- */
function addButton(parent: HTMLElement, text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = text;
  b.onclick = onClick;
  parent.appendChild(b);
  return b;
}

// 场景选择
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
    activeBattleKind = 'scenario';
    lastShownResult = null;
    currentCamera = sc.camera ?? null;
    reframeCamera();
    updateStartButton();
  }
};
toolbar.appendChild(scenarioSelect);

/* ---------- 战斗 Loop 状态（Q06-B1：Result → 修改 → 再战） ---------- */

/** 当前战斗种类：custom 战斗的按钮状态机与结果展示；场景模式不接管 */
let activeBattleKind: 'scenario' | 'custom' | null = null;

/** 结果展示条（toolbar） */
const resultLabel = document.createElement('span');
resultLabel.style.cssText = 'color:#ffd35a;font-size:13px;margin-left:10px;';
toolbar.appendChild(resultLabel);

/** 启动 / 再战 custom battle：重新 validate 当前 Draft，Planck loadCustom */
function startOrRematch(): void {
  const sa = currentSnapshot('A');
  const sb = currentSnapshot('B');
  const va = validateSnapshot(sa, registry);
  const vb = validateSnapshot(sb, registry);
  if (!va.valid || !vb.valid) return; // 任一非法：不启动
  lab.loadCustom(sa, sb, { autoDrive: true, engine: 'planck' });
  currentCamera = null; // 自定义 Build：取景 A+B
  reframeCamera();
  activeBattleKind = 'custom';
  updateStartButton(); // 立即进入「战斗中…」
}

const btnStart = addButton(toolbar, '开始战斗', startOrRematch);

/** 按钮状态机 + 结果展示（Draft 只影响下一局；当前战斗结果来自 orchestrator.result） */
function updateStartButton(): void {
  const o = lab.orchestrator;
  const r = o?.result ?? null;
  const valid =
    validateSnapshot(currentSnapshot('A'), registry).valid &&
    validateSnapshot(currentSnapshot('B'), registry).valid;

  if (r && r.phase === 'End') {
    const w =
      r.winner === 'A' ? 'A 胜' : r.winner === 'B' ? 'B 胜' : r.winner === 'draw' ? '平局' : '—';
    resultLabel.textContent = `结果：${w}（hpA ${r.hpA} / hpB ${r.hpB}）`;
    if (activeBattleKind === 'custom') {
      btnStart.textContent = '应用配置再战';
      btnStart.disabled = !valid; // 点击时会重新 validate
    } else {
      btnStart.textContent = '开始战斗';
      btnStart.disabled = !valid;
    }
    return;
  }

  // 未结束：custom 战斗中 → 锁定；否则可配置后开战
  resultLabel.textContent = '';
  if (activeBattleKind === 'custom' && o && r === null) {
    btnStart.textContent = '战斗中…';
    btnStart.disabled = true;
  } else {
    btnStart.textContent = '开始战斗';
    btnStart.disabled = !valid;
  }
}

/** 每帧轮询：orchestrator.result 变化时刷新结果展示与按钮 */
function pollBattleResult(): void {
  const r = lab.orchestrator?.result ?? null;
  if (r === lastShownResult) return;
  lastShownResult = r;
  updateStartButton();
}
let lastShownResult: BattleOrchestratorApi['result'] = null;

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
  reframeCamera(); // Reset 后可重新构图
  updateStartButton(); // custom Reset 后回到「战斗中…」（Q06-F1 重建同场战斗）
});
addButton(toolbar, 'Clear', () => {
  lab.clear();
  activeBattleKind = null;
  lastShownResult = null;
  resultLabel.textContent = '';
  currentCamera = null;
  updateStartButton();
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

/* ---------- Build 编辑面板（Q06-U1：Draft 模型动态渲染） ---------- */
refresh();

/* ---------- Preset 快捷 ---------- */
{
  let targetSide: 'A' | 'B' = 'A';
  const presetBox = document.createElement('div');
  const ph = document.createElement('h3');
  ph.textContent = 'Preset 快捷（装到 A）';
  presetBox.appendChild(ph);
  panelA.appendChild(presetBox);

  const sideToggle = addButton(toolbar, '装载 → A', () => {
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
      // Preset 只装载 Body / 轮径；ramHead/testMass 非正式内容 → 功能槽全部重置为 none
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
      refresh();
    };
    presetBox.appendChild(b);
  });
}

/* ---------- Debug 面板 ---------- */
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
  // 只清 Debug 显示，不修改物理 / Scenario / Override；不提供“全部开启”。
  const btnAllOff = document.createElement('button');
  btnAllOff.textContent = '全部关闭';
  btnAllOff.style.cssText =
    'display:block;width:100%;margin:6px 0 2px;padding:4px 8px;' +
    'background:#3a2a2a;color:#ffb4a0;border:1px solid #5a3a3a;' +
    'border-radius:4px;cursor:pointer;font-size:12px;';
  btnAllOff.onclick = () => {
    for (const [key, cb] of checkboxes) {
      lab.debugFlags[key] = false;
      cb.checked = false;
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

/* ---------- 初始加载 + 动画循环 ---------- */
lab.loadScenario(SCENARIOS[0]);
activeBattleKind = 'scenario';
currentCamera = SCENARIOS[0].camera ?? null;
updateStartButton();

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
  pollBattleResult(); // result 变化 → 胜负展示 + 「应用配置再战」
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
