/**
 * PBL-F0 / PBL-F1｜Portrait Battle Lab 控制器（本实验唯一的 DOM / Canvas 交互层）。
 *
 * 设计边界：
 * - **不接正式 Renderer / Battle Runtime / Physics / Garage / Fusion / R4 / Meta / 存档 / 经济**；
 *   舞台按正式 registry 的真实 collider 几何自绘**占位**场景（不加载 sprite / 不做美术）。
 * - 固定摄像机：逻辑舞台恒为竖屏 390×844，屏幕映射复用正式共享契约
 *   `PlayerViewportTransform(390, 844)`（contain 缩放居中）——不新增第二套坐标系统。
 * - 舞台永远展示「当前选择」的实体组合（Arena / Loadout / Encounter 切换即时可见）；
 *   Start 把它变成一批运行期实体（spawnSerial 递增），Reset / 切换配置则彻底清空。
 *
 * 删除本文件即移除实验台核心；本目录可整块删除（清单见 constants.ts 头部）。
 */
import { PlayerViewportTransform } from '../../platform/playerViewport';
import {
  LAB_ARENAS,
  PORTRAIT_LOGICAL_H,
  PORTRAIT_LOGICAL_W,
} from './constants';
import { LAB_ENCOUNTERS, LAB_LOADOUTS } from './testData';
import { buildSpawnPlan, type SpawnPlan } from './entities';
import { buildScene } from './scene';
import { HUD_BAND_H, LAB_GROUND_Y, stageRect, type LabLayerId } from './layout';
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

/** 分层颜色：与 E2E 的像素分类一一对应（新增层必须同步 E2E 分类器）。 */
const LAYER_COLORS: Record<LabLayerId, string> = {
  arena: '#ffd35a',
  playerBody: '#4a7fe0',
  playerPart: '#a06bff',
  enemyBody: '#ff6b5e',
  enemyPart: '#ff9b3d',
};

const COLORS = {
  bg: '#0d1016',
  stage: '#151a24',
  stageBorder: '#2a3140',
  ground: '#3a4353',
  text: '#e8e8f0',
  dim: '#8a93a5',
  /**
   * 缺口提示色：必须与**任何**分层颜色在 RGB 距离上互斥，否则文字抗锯齿像素会被
   * E2E 的像素分类器误计为实体（已实测踩坑：曾用 #ffd35a，与 Arena 层同色 → arena 虚增 ~310px）。
   */
  warn: '#ff5ee0',
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
  /** 运行期（Start 后）实体数；idle 为 0。 */
  readonly liveEntities: number;
  /** 运行期弹丸数；idle 为 0。 */
  readonly liveProjectiles: number;
  /** 累计 spawn 批次号（Reset 不归零）。 */
  readonly spawnSerial: number;
  /** 当前展示组合的基础数据指纹（A/B 必须一致）。 */
  readonly baseKey: string;
  readonly playerBody: string;
  readonly enemyBodies: readonly string[];
  readonly unavailable: readonly string[];
  readonly layers: Record<LabLayerId, number>;
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
  /** 预览计划缓存（key = loadout|encounter）——舞台始终展示当前选择。 */
  private previewCache: { key: string; plan: SpawnPlan } | null = null;
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

  /** 舞台展示用的计划（按当前选择构造并缓存；纯数据，无副作用）。 */
  private previewPlan(): SpawnPlan {
    const key = `${this.state.loadout}|${this.state.encounter}`;
    if (!this.previewCache || this.previewCache.key !== key) {
      this.previewCache = { key, plan: buildSpawnPlan(this.state.loadout, this.state.encounter) };
    }
    return this.previewCache.plan;
  }

  /** 只读诊断快照（Lab 专属，供独立 E2E 读取；不改变任何状态）。 */
  probe(): PblProbe {
    const r = this.canvas.getBoundingClientRect();
    const plan = this.previewPlan();
    const sum = labSummary(this.state);
    return {
      logicalW: PORTRAIT_LOGICAL_W,
      logicalH: PORTRAIT_LOGICAL_H,
      arena: this.state.arena,
      loadout: this.state.loadout,
      encounter: this.state.encounter,
      phase: this.state.phase,
      startCount: this.state.startCount,
      revision: this.state.revision,
      liveEntities: this.state.run.entities.length,
      liveProjectiles: this.state.run.projectiles.length,
      spawnSerial: this.state.run.spawnSerial,
      baseKey: plan.baseKey,
      playerBody: plan.player.bodyDefId,
      enemyBodies: plan.enemies.map((e) => e.bodyDefId),
      unavailable: sum.unavailable,
      layers: this.layerCounts(),
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

  private layerCounts(): Record<LabLayerId, number> {
    const counts: Record<LabLayerId, number> = {
      arena: 0,
      playerBody: 0,
      playerPart: 0,
      enemyBody: 0,
      enemyPart: 0,
    };
    for (const s of buildScene(this.state.arena, this.previewPlan())) counts[s.layer] += 1;
    return counts;
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

    // 实体场景：全部几何来自正式 registry（车身 + 功能件 collider）
    const scene = buildScene(s.arena, this.previewPlan());
    for (const shape of scene) {
      ctx.fillStyle = LAYER_COLORS[shape.layer];
      ctx.fillRect(shape.rect.x, shape.rect.y, shape.rect.w, shape.rect.h);
    }

    // 地面
    ctx.fillStyle = COLORS.ground;
    ctx.fillRect(2, LAB_GROUND_Y, stage.w - 4, 3);

    // 顶部 HUD 带（纯文字，带内不绘制任何实体 → 文字抗锯齿不会污染像素分类）
    ctx.fillStyle = 'rgba(13,16,22,0.9)';
    ctx.fillRect(2, 2, stage.w - 4, HUD_BAND_H);
    ctx.strokeStyle = COLORS.stageBorder;
    ctx.lineWidth = 1;
    ctx.strokeRect(2.5, 2.5, stage.w - 5, HUD_BAND_H);

    const arena = findArena(s.arena);
    const loadout = findLoadout(s.loadout);
    const encounter = findEncounter(s.encounter);
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = COLORS.text;
    ctx.font = 'bold 17px system-ui, sans-serif';
    ctx.fillText(`${arena ? arena.label : s.arena} · 竖屏 ${stage.w}×${stage.h}`, 12, 28);
    ctx.font = '14px system-ui, sans-serif';
    ctx.fillStyle = COLORS.dim;
    ctx.fillText(`Loadout: ${loadout ? loadout.label : s.loadout}`, 12, 50);
    ctx.fillText(
      `Encounter: ${encounter ? encounter.label : s.encounter}（${this.previewPlan().enemies.length} 敌）`,
      12,
      70,
    );

    // 数据缺口披露（正式内容库无对应件 —— 不隐藏、不伪造）
    const missing = labSummary(s).unavailable;
    if (missing.length > 0) {
      ctx.fillStyle = COLORS.warn;
      ctx.font = '13px system-ui, sans-serif';
      ctx.fillText(`正式库无：${missing.join(' / ')}（未引入）`, 12, 94);
    }

    // 运行态（占位；此处不推进任何战斗规则）
    if (s.phase === 'running') {
      ctx.fillStyle = COLORS.running;
      ctx.font = 'bold 17px system-ui, sans-serif';
      ctx.fillText(`RUNNING（占位）· 实体 ${s.run.entities.length}`, 12, 120);
    } else {
      ctx.fillStyle = COLORS.dim;
      ctx.font = 'bold 15px system-ui, sans-serif';
      ctx.fillText('IDLE（占位）· 未生成实体', 12, 120);
    }

    // 下方 Arena 信息带说明
    ctx.fillStyle = COLORS.dim;
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText('Arena 标记（下方带）', 12, PORTRAIT_LOGICAL_H - 6);
  }

  private syncStatus(): void {
    const sum = labSummary(this.state);
    this.statusEl.textContent =
      `Arena=${sum.arena}(${sum.arenaLabel}) · Loadout=${sum.loadout}(${sum.loadoutLabel}) · ` +
      `Encounter=${sum.encounter}(${sum.encounterLabel}) · phase=${sum.phase} · starts=${sum.startCount} · ` +
      `实体=${sum.entityCount}(敌 ${sum.enemyCount})` +
      (sum.unavailable.length ? ` · 缺口=${sum.unavailable.join('/')}` : '');
    this.statusEl.dataset['arena'] = sum.arena;
    this.statusEl.dataset['loadout'] = sum.loadout;
    this.statusEl.dataset['encounter'] = sum.encounter;
    this.statusEl.dataset['phase'] = sum.phase;
    this.statusEl.dataset['startCount'] = String(sum.startCount);
    this.statusEl.dataset['entityCount'] = String(sum.entityCount);
    this.statusEl.dataset['baseKey'] = sum.baseKey;
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
