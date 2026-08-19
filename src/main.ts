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
import type { BuildSnapshot } from './core/types';

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

/* ---------- Build 编辑状态 ---------- */
interface EditState {
  body: string;
  front: number;
  rear: number;
  extra: 'none' | 'frontMass' | 'rear';
}

const editA: EditState = { body: 'boxBody', front: 20, rear: 20, extra: 'none' };
const editB: EditState = { body: 'heavyBox', front: 20, rear: 20, extra: 'none' };

function buildFromEdit(side: 'A' | 'B', e: EditState): BuildSnapshot {
  const id = side === 'A' ? 'customA' : 'customB';
  const extraPart =
    e.extra === 'none'
      ? []
      : [{ hardpointId: e.extra, defId: 'testMass' }];
  return {
    id,
    bodyDefId: e.body,
    quality: 1,
    movements: [
      { hardpointId: 'rear', defId: 'wheelStd', overrides: { radius: e.rear } },
      { hardpointId: 'front', defId: 'wheelStd', overrides: { radius: e.front } },
    ],
    functionals: [{ hardpointId: 'front', defId: 'ramHead' }, ...extraPart],
  };
}

function loadCustom(): void {
  lab.loadCustom(buildFromEdit('A', editA), buildFromEdit('B', editB));
  currentCamera = null; // 自定义 Build：取景 A+B
  reframeCamera();
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
    currentCamera = sc.camera ?? null;
    reframeCamera();
  }
};
toolbar.appendChild(scenarioSelect);

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
  reframeCamera(); // Reset 后可重新构图
});
addButton(toolbar, 'Clear', () => {
  lab.clear();
  currentCamera = null;
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

/* ---------- Build 编辑面板 ---------- */
function buildPanel(
  panel: HTMLElement,
  title: string,
  e: EditState,
): () => void {
  const h = document.createElement('h3');
  h.textContent = title;
  panel.appendChild(h);

  const fields: Array<{ sel: HTMLSelectElement; get: () => string }> = [];

  const mk = (
    label: string,
    options: Array<{ v: string; t: string }>,
    get: () => string,
    set: (v: string) => void,
  ) => {
    const lab2 = document.createElement('label');
    lab2.textContent = label;
    const sel = document.createElement('select');
    options.forEach((o) => {
      const opt = document.createElement('option');
      opt.value = o.v;
      opt.textContent = o.t;
      sel.appendChild(opt);
    });
    sel.value = get();
    sel.onchange = () => {
      set(sel.value);
      loadCustom();
    };
    lab2.appendChild(sel);
    panel.appendChild(lab2);
    fields.push({ sel, get });
  };

  mk('Body', [
    { v: 'wedgeBody', t: '楔形车身（低前鼻）' },
    { v: 'boxBody', t: '箱式车身（厚实）' },
    { v: 'tallBody', t: '高身车身（compact）' },
    { v: 'heavyBox', t: '重型车身' },
  ], () => e.body, (v) => (e.body = v));

  mk('后轮半径', [
    { v: '12', t: '12（小）' },
    { v: '20', t: '20（标准）' },
    { v: '26', t: '26（大）' },
  ], () => String(e.rear), (v) => (e.rear = Number(v)));

  mk('前轮半径', [
    { v: '12', t: '12（小）' },
    { v: '20', t: '20（标准）' },
    { v: '26', t: '26（大）' },
  ], () => String(e.front), (v) => (e.front = Number(v)));

  mk('额外部件', [
    { v: 'none', t: '无' },
    { v: 'frontMass', t: '前部质量块' },
    { v: 'rear', t: '后部质量块' },
  ], () => e.extra, (v) => (e.extra = v as EditState['extra']));

  return () => {
    fields.forEach((f) => (f.sel.value = f.get()));
  };
}

const refreshA = buildPanel(panelA, 'A 车 Build', editA);
const refreshB = buildPanel(panelB, 'B 车 Build', editB);

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
      const target = targetSide === 'A' ? editA : editB;
      const build = p.build();
      target.body = build.bodyDefId;
      const f = build.movements.find((m) => m.hardpointId === 'front');
      const r = build.movements.find((m) => m.hardpointId === 'rear');
      target.front = f?.overrides?.radius ?? 20;
      target.rear = r?.overrides?.radius ?? 20;
      const extra = build.functionals.find((x) => x.defId === 'testMass');
      target.extra = extra ? (extra.hardpointId as EditState['extra']) : 'none';
      refreshA();
      refreshB();
      loadCustom();
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
currentCamera = SCENARIOS[0].camera ?? null;

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
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
