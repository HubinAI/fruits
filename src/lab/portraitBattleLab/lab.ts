/**
 * PBL-F0｜Portrait Battle Lab 控制器（本实验唯一的 DOM / Canvas 交互层）。
 *
 * 设计边界（严格遵守 Queue 范围）：
 * - **不接正式 Renderer / Battle Runtime / Physics / Garage / Fusion / R4 / Meta / 存档 / 经济**；
 *   舞台为自绘「占位」场景，只用于证明「竖屏逻辑区可进入 + 状态切换正确」。
 * - 固定摄像机：逻辑舞台恒为竖屏 390×844，屏幕映射复用正式共享契约
 *   `PlayerViewportTransform(390, 844)`（contain 缩放居中）——不新增第二套坐标系统。
 * - 不做 UI 美化（队列明确排除）；控制面板仅为可操作的最小集合。
 *
 * 删除本文件即移除实验台核心；本目录可整块删除（清单见 constants.ts 头部）。
 */
import { PlayerViewportTransform } from '../../platform/playerViewport';
import {
  LAB_ARENAS,
  LAB_ENCOUNTERS,
  LAB_LOADOUTS,
  PORTRAIT_LOGICAL_H,
  PORTRAIT_LOGICAL_W,
} from './constants';
import {
  LAB_GROUND_Y,
  arenaMarkers,
  enemyMarkerRects,
  playerBodyRect,
  stageRect,
} from './layout';
import {
  createPortraitLabState,
  findArena,
  findEncounter,
  findLoadout,
  labSummary,
  reset,
  setArena,
  setEncounter,
  setLoadout,
  start,
  type PortraitLabState,
} from './state';

const COLORS = {
  bg: '#0d1016',
  stage: '#151a24',
  stageBorder: '#2a3140',
  ground: '#3a4353',
  player: '#4a7fe0',
  enemy: '#ff6b5e',
  arena: '#ffd35a',
  text: '#e8e8f0',
  dim: '#8a93a5',
  running: '#5ee08a',
} as const;

/** 只读诊断快照（Lab 专属；仅存在于本实验页面，不进入任何正式构建）。 */
export interface PblProbe {
  readonly logicalW: number;
  readonly logicalH: number;
  readonly arena: string;
  readonly loadout: string;
  readonly encounter: string;
  readonly phase: string;
  readonly startCount: number;
  readonly revision: number;
  readonly camera: { scale: number; offsetX: number; offsetY: number; dpr: number };
  readonly canvas: { backingW: number; backingH: number; cssW: number; cssH: number };
}

export class PortraitBattleLab {
  private readonly root: HTMLElement;
  private readonly stageWrap: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly statusEl: HTMLDivElement;
  private readonly arenaButtons = new Map<string, HTMLButtonElement>();
  private readonly loadoutButtons = new Map<string, HTMLButtonElement>();
  private readonly encounterButtons = new Map<string, HTMLButtonElement>();
  private btnStart!: HTMLButtonElement;
  private btnReset!: HTMLButtonElement;

  /** 固定摄像机：竖屏 390×844 逻辑舞台（复用共享 contain 变换契约）。 */
  private readonly vp = new PlayerViewportTransform(PORTRAIT_LOGICAL_W, PORTRAIT_LOGICAL_H);
  private state: PortraitLabState = createPortraitLabState();
  private resizeObserver: ResizeObserver | null = null;
  private readonly onWindowResize = (): void => this.render();

  constructor(root: HTMLElement) {
    this.root = root;
    this.stageWrap = document.createElement('div');
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'pbl-canvas';
    this.ctx = this.canvas.getContext('2d');
    this.statusEl = document.createElement('div');

    this.buildDom();
    this.observeResize();
    this.render();
  }

  /* ---------------------------------------------------------------- DOM */

  private buildDom(): void {
    this.root.replaceChildren();
    this.root.classList.add('pbl-root');

    const bar = document.createElement('div');
    bar.className = 'pbl-bar';

    const mkGroup = (title: string, mkButtons: (host: HTMLElement) => void): void => {
      const group = document.createElement('div');
      group.className = 'pbl-group';
      const label = document.createElement('span');
      label.className = 'pbl-group-label';
      label.textContent = title;
      group.appendChild(label);
      mkButtons(group);
      bar.appendChild(group);
    };

    const mkButton = (host: HTMLElement, text: string, onClick: () => void): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pbl-btn';
      b.textContent = text;
      b.onclick = onClick;
      host.appendChild(b);
      return b;
    };

    mkGroup('Arena', (host) => {
      for (const a of LAB_ARENAS) {
        this.arenaButtons.set(
          a.id,
          mkButton(host, a.label, () => this.apply(setArena(this.state, a.id))),
        );
      }
    });
    mkGroup('Loadout', (host) => {
      for (const l of LAB_LOADOUTS) {
        this.loadoutButtons.set(
          l.id,
          mkButton(host, l.label, () => this.apply(setLoadout(this.state, l.id))),
        );
      }
    });
    mkGroup('Encounter', (host) => {
      for (const e of LAB_ENCOUNTERS) {
        this.encounterButtons.set(
          e.id,
          mkButton(host, e.label, () => this.apply(setEncounter(this.state, e.id))),
        );
      }
    });
    mkGroup('Run', (host) => {
      this.btnStart = mkButton(host, 'Start', () => this.apply(start(this.state)));
      this.btnStart.classList.add('pbl-btn-primary');
      this.btnReset = mkButton(host, 'Reset', () => this.apply(reset(this.state)));
    });

    this.statusEl.className = 'pbl-status';

    this.stageWrap.className = 'pbl-stage';
    this.stageWrap.appendChild(this.canvas);

    this.root.appendChild(bar);
    this.root.appendChild(this.statusEl);
    this.root.appendChild(this.stageWrap);
  }

  private observeResize(): void {
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.render());
      this.resizeObserver.observe(this.stageWrap);
    }
    window.addEventListener('resize', this.onWindowResize);
  }

  /** 释放监听（整块删除 / 热更新友好）。 */
  dispose(): void {
    window.removeEventListener('resize', this.onWindowResize);
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
  }

  /* ------------------------------------------------------------- 状态 */

  private apply(nextState: PortraitLabState): void {
    if (nextState === this.state) return; // no-op（同值 set / running 中重复 Start）
    this.state = nextState;
    this.render();
  }

  /** 只读诊断快照（Lab 专属，供独立 E2E 读取；不改变任何状态）。 */
  probe(): PblProbe {
    const r = this.canvas.getBoundingClientRect();
    return {
      logicalW: PORTRAIT_LOGICAL_W,
      logicalH: PORTRAIT_LOGICAL_H,
      arena: this.state.arena,
      loadout: this.state.loadout,
      encounter: this.state.encounter,
      phase: this.state.phase,
      startCount: this.state.startCount,
      revision: this.state.revision,
      camera: {
        scale: this.vp.scale,
        offsetX: this.vp.offsetX,
        offsetY: this.vp.offsetY,
        dpr: this.vp.dpr,
      },
      canvas: {
        backingW: this.canvas.width,
        backingH: this.canvas.height,
        cssW: Math.round(r.width * 100) / 100,
        cssH: Math.round(r.height * 100) / 100,
      },
    };
  }

  /* ------------------------------------------------------------- 渲染 */

  private render(): void {
    // 固定摄像机：容器 / DPR 变化只重算 contain（逻辑舞台恒为 390×844，永不 reframe）。
    const wrapW = this.stageWrap.clientWidth || PORTRAIT_LOGICAL_W;
    const wrapH = this.stageWrap.clientHeight || PORTRAIT_LOGICAL_H;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    this.vp.update(wrapW, wrapH, dpr);
    this.vp.applyTo(this.canvas); // 会重置 canvas 尺寸 → 上下文变换必须在其后设置

    const ctx = this.ctx;
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // 之后全部按逻辑 px 绘制
      this.draw(ctx);
    }

    this.syncStatus();
    this.syncControls();
  }

  private draw(ctx: CanvasRenderingContext2D): void {
    const s = this.state;
    const stage = stageRect();

    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, stage.w, stage.h);

    // 竖屏逻辑区（固定摄像机下的可见舞台）
    ctx.fillStyle = COLORS.stage;
    ctx.fillRect(2, 2, stage.w - 4, stage.h - 4);
    ctx.strokeStyle = COLORS.stageBorder;
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, stage.w - 2, stage.h - 2);

    // Arena 占位标记
    ctx.fillStyle = COLORS.arena;
    for (const r of arenaMarkers(s.arena)) ctx.fillRect(r.x, r.y, r.w, r.h);

    // 地面
    ctx.fillStyle = COLORS.ground;
    ctx.fillRect(2, LAB_GROUND_Y, stage.w - 4, 3);

    // 玩家占位轮廓
    const loadout = findLoadout(s.loadout);
    if (loadout) {
      const pb = playerBodyRect(loadout.body);
      ctx.fillStyle = COLORS.player;
      ctx.fillRect(pb.x, pb.y, pb.w, pb.h);
    }

    // 敌人占位标记
    const encounter = findEncounter(s.encounter);
    if (encounter) {
      ctx.fillStyle = COLORS.enemy;
      for (const r of enemyMarkerRects(encounter)) ctx.fillRect(r.x, r.y, r.w, r.h);
    }

    // 舞台信息（占位说明文字）
    const arena = findArena(s.arena);
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = COLORS.text;
    ctx.font = 'bold 17px system-ui, sans-serif';
    ctx.fillText(`${arena ? arena.label : s.arena} · ${arena ? arena.note : ''}`, 16, 34);
    ctx.font = '14px system-ui, sans-serif';
    ctx.fillStyle = COLORS.dim;
    ctx.fillText(`Loadout: ${loadout ? loadout.label : s.loadout}`, 16, 58);
    ctx.fillText(`Encounter: ${encounter ? encounter.label : s.encounter}`, 16, 78);
    ctx.fillText(`竖屏逻辑区 ${stage.w}×${stage.h} · 固定摄像机`, 16, 98);

    // 运行态（占位；此处不推进任何战斗规则）
    if (s.phase === 'running') {
      ctx.fillStyle = 'rgba(94,224,138,0.14)';
      ctx.fillRect(2, 2, stage.w - 4, stage.h - 4);
      ctx.fillStyle = COLORS.running;
      ctx.font = 'bold 22px system-ui, sans-serif';
      ctx.fillText('RUNNING（占位）', 16, 140);
      ctx.font = '13px system-ui, sans-serif';
      ctx.fillText('本 Queue 不实现真实 A/B 战斗规则', 16, 164);
    } else {
      ctx.fillStyle = COLORS.dim;
      ctx.font = 'bold 18px system-ui, sans-serif';
      ctx.fillText('IDLE（占位）', 16, 140);
    }
  }

  private syncStatus(): void {
    const sum = labSummary(this.state);
    this.statusEl.textContent =
      `Arena=${sum.arena}(${sum.arenaLabel}) · Loadout=${sum.loadout}(${sum.loadoutLabel}) · ` +
      `Encounter=${sum.encounter}(${sum.encounterLabel}) · phase=${sum.phase} · starts=${sum.startCount}`;
    this.statusEl.dataset['arena'] = sum.arena;
    this.statusEl.dataset['loadout'] = sum.loadout;
    this.statusEl.dataset['encounter'] = sum.encounter;
    this.statusEl.dataset['phase'] = sum.phase;
    this.statusEl.dataset['startCount'] = String(sum.startCount);
  }

  private syncControls(): void {
    const active = (btn: HTMLButtonElement | undefined, on: boolean): void => {
      if (btn) btn.classList.toggle('pbl-btn-active', on);
    };
    for (const [id, btn] of this.arenaButtons) active(btn, id === this.state.arena);
    for (const [id, btn] of this.loadoutButtons) active(btn, id === this.state.loadout);
    for (const [id, btn] of this.encounterButtons) active(btn, id === this.state.encounter);

    const running = this.state.phase === 'running';
    if (this.btnStart) this.btnStart.disabled = running; // running 中 Start 幂等 → 禁用
    if (this.btnReset) this.btnReset.disabled = false;
  }
}
