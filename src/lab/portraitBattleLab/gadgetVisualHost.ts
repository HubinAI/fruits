/**
 * GADGET-VISUAL-VALIDATION-HOST-R1｜Gadget 真人**视觉**验收宿主（开发专用）。
 *
 * ⚠️ 为什么不用 portrait-lab.html：
 *   那个 Lab 的 `draw()` 只用 `fillRect` 画 `layeredShapes()` 矩形，
 *   车辆永远显示为红蓝方块 → 无法做真人**视觉**验收。
 *
 * ⚠️ 本页的硬纪律：
 *   ① **战斗复用正式实现**，不复制 Renderer：
 *      `BuildSnapshot` → `resolveSnapshot`（装配层）→ `RunBattleRuntime`
 *      → `RunBattleView`（内含**正式** `Renderer` + `VisualRegistry` + PNG 美术）。
 *   ② **Gadget 必须走正式链**：`gadgetDefId` → `BuildSnapshot.gadget`
 *      → `resolveSnapshot().gadget` → 装配 → BehaviorRegistry。
 *      本文件**不** import `applyThrust` / `ThrusterBehavior` 等任何行为实现。
 *   ③ **零接入正式产品**：不接 Garage、不改 run-page / home.html 任何行为。
 *   ④ **无 Debug overlay**：画面上只有战斗，不常驻任何数据面板。
 *
 * 删除本文件 + `gadget-lab.html` 即可整块移除，不影响任何正式产物。
 */
import { buildSnapshotFromDraft, EMPTY_SLOT, type BuildDraft } from '../buildEditorModel';
import { registry } from '../../core/content';
import { RunBattleRuntime } from './runBattleRuntime';
import { RunBattleView } from './runBattleView';
import { RUN_STAGE_BAND } from './runPageLayout';

/** 四个固定预设（真人验收用）。武器与 Gadget 的组合是唯一变量。 */
export interface GadgetVisualPreset {
  readonly key: 'A' | 'B' | 'C' | 'D';
  readonly label: string;
  readonly weapon: string;
  readonly gadget: string;
  readonly encounter: string;
  readonly note: string;
}

/**
 * A/B/C/D 的**配置真源**。
 *
 * ⚠️ 统一 `watermelonBody` + `wheelStd`（当前正式标准 Movement），
 * Weapon / Gadget / Encounter 全部是**正式内容 id**，不含任何 Lab 专用数值。
 */
export const GADGET_VISUAL_PRESETS: readonly GadgetVisualPreset[] = [
  {
    key: 'A', label: 'A Hammer + Thruster', weapon: 'hammer', gadget: 'thruster', encounter: 'RangedTurret',
    note: '敌人后撤 > 巡航 ⇒ 前冲制造近身',
  },
  {
    key: 'B', label: 'B Hammer + Reverse', weapon: 'hammer', gadget: 'reverseThruster', encounter: 'RangedTurret',
    note: '后撤只拉远 ⇒ 近战更打不到',
  },
  {
    key: 'C', label: 'C Cannon + Thruster', weapon: 'cannon', gadget: 'thruster', encounter: 'Chaser',
    note: '贴脸对手 ⇒ 前冲基本不启动',
  },
  {
    key: 'D', label: 'D Cannon + Reverse', weapon: 'cannon', gadget: 'reverseThruster', encounter: 'Chaser',
    note: '贴脸 ⇒ 后撤重建射击空间',
  },
];

/**
 * 预设 → 正式 `BuildSnapshot`（走 `buildSnapshotFromDraft`，与产品同一条转换）。
 * ⚠️ Weapon 走正式 `frontMass` 槽；Gadget 走**独立** `gadgetDefId`。
 */
export function presetSnapshot(preset: GadgetVisualPreset): ReturnType<typeof buildSnapshotFromDraft> {
  const draft: BuildDraft = {
    bodyDefId: 'watermelonBody',
    rearRadius: 20,
    frontRadius: 20,
    rearWheelDefId: 'wheelStd',
    frontWheelDefId: 'wheelStd',
    functionalSelections: {
      front: EMPTY_SLOT,
      top: EMPTY_SLOT,
      rear: EMPTY_SLOT,
      'frontMass': preset.weapon,
    },
    gadgetDefId: preset.gadget,
    drive: 'forward',
  };
  return buildSnapshotFromDraft(draft, registry, `gvh-${preset.key}`);
}

/* ------------------------------------------------------------------ 宿主 */

const FRAME_MS = 1000 / 60;

function boot(): void {
  const root = document.getElementById('gvl-root');
  if (!root) throw new Error('[GVH] 未找到 #gvl-root 容器');

  // 正式视觉宿主（内含正式 Renderer + 正式 PNG 美术；**不是**复制品）
  const view = new RunBattleView();

  const bar = document.createElement('div');
  bar.className = 'gvl-bar';
  const stage = document.createElement('div');
  stage.className = 'gvl-stage';
  const onScreen = document.createElement('canvas');
  stage.appendChild(onScreen);
  const note = document.createElement('div');
  note.className = 'gvl-note';
  stage.appendChild(note);

  root.appendChild(bar);
  root.appendChild(stage);

  const ctx = onScreen.getContext('2d');
  let runtime: RunBattleRuntime | null = null;
  let current: GadgetVisualPreset | null = null;
  let raf = 0;

  /** 清理上一场 → 按固定配置重建 → 正常速度直接开打。 */
  function start(preset: GadgetVisualPreset): void {
    if (runtime) {
      // Reset：彻底丢弃上一场（不残留任何实体 / 触发状态）
      view.stopBattleAudio();
      runtime.dispose();
      runtime = null;
    }
    current = preset;
    // ✅ 正式链：BuildSnapshot → resolveSnapshot → RunBattleRuntime → RunBattleView
    runtime = new RunBattleRuntime({
      build: [],
      carriedHp: null,
      encounterId: preset.encounter,
      playerDraft: {
        bodyDefId: 'watermelonBody',
        rearRadius: 20,
        frontRadius: 20,
        rearWheelDefId: 'wheelStd',
        frontWheelDefId: 'wheelStd',
        functionalSelections: {
          front: EMPTY_SLOT,
          top: EMPTY_SLOT,
          rear: EMPTY_SLOT,
          'frontMass': preset.weapon,
        },
        gadgetDefId: preset.gadget,
        drive: 'forward',
      },
      playerLoadoutTag: 'gadget-visual-host',
      playerBaseline: true,
    });
    note.textContent = `${preset.label} · ${preset.note}（正式 Renderer 绘制）`;
    if (!raf) loop();
  }

  /** 每帧：步进正式 Runtime → 正式 Renderer 渲染 → blit 到全屏画布。 */
  function loop(): void {
    raf = requestAnimationFrame(loop);
    if (!runtime) return;
    if (!runtime.result) runtime.step(FRAME_MS);

    // 正式 Renderer 绘制（内部含正式相机链 / sprite / 程序化 visual）
    view.render(runtime);

    // blit 到「全屏」带：战斗画面占页面主要区域
    const dpr = window.devicePixelRatio || 1;
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (onScreen.width !== Math.round(w * dpr) || onScreen.height !== Math.round(h * dpr)) {
      onScreen.width = Math.round(w * dpr);
      onScreen.height = Math.round(h * dpr);
      onScreen.style.width = `${w}px`;
      onScreen.style.height = `${h}px`;
    }
    if (ctx) {
      // 官方 blit 以「离屏 inset裁剪 + 逻辑px 1:1」绘制 ⇒ 用 ctx 缩放把它放大到整块区域，
      // 不改动RunBattleView / Renderer 任何逻辑（不复制渲染器）。
      const w = stage.clientWidth;
      const h = stage.clientHeight;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#0b0e14';
      ctx.fillRect(0, 0, w, h);

      // 官方舞台带（= 离屏画布去掉 inset 后的可见区）宽高比
      const band = RUN_STAGE_BAND;
      const scale = Math.min(w / band.w, h / band.h);
      ctx.save();
      ctx.translate((w - band.w * scale) / 2, (h - band.h * scale) / 2);
      ctx.scale(scale, scale);
      view.blit(ctx, band);
      ctx.restore();
    }
  }

  // ---- 最小控制条：A/B/C/D + Reset（无任何 Debug 面板）----
  const title = document.createElement('span');
  title.className = 'gvl-title';
  title.textContent = 'Gadget 视觉验收（DEBUG ONLY）';
  bar.appendChild(title);

  const buttons: HTMLButtonElement[] = [];
  for (const p of GADGET_VISUAL_PRESETS) {
    const b = document.createElement('button');
    b.textContent = p.label;
    b.title = p.note;
    b.className = 'gvl-primary';
    b.onclick = () => {
      for (const other of buttons) other.classList.remove('gvl-primary');
      b.classList.add('gvl-primary');
      start(p);
    };
    buttons.push(b);
    bar.appendChild(b);
  }

  const reset = document.createElement('button');
  reset.textContent = 'Reset';
  reset.onclick = () => { if (current) start(current); };
  bar.appendChild(reset);

  // 默认启动 A（页面一打开就有画面）
  if (buttons[0]) buttons[0].click();
}

/**
 * 自启动守卫：`import` 本模块（例如 node 侧测试只读预设配置）**不得**触发 boot。
 * 只有真的存在浏览器 document 时才挂载。
 */
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
}