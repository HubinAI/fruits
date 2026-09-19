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
  PBL_LIGHT_SWARM_VALIDATION,
  PORTRAIT_LOGICAL_H,
  PORTRAIT_LOGICAL_W,
} from './constants';
import { LAB_ENCOUNTERS, LAB_LOADOUTS } from './testData';
import { buildSpawnPlan, type SpawnPlan } from './entities';
import { buildScene } from './scene';
import { arenaAScene } from './arenaScene';
import {
  ArenaARuntime,
  ARENA_A_WALL_RESTITUTION,
  TOPDOWN_ANTI_WEDGE,
  type ArenaAView,
} from './arenaA';
import {
  PBL_ALLOWED_ARENA_DIFFERENCES,
  PBL_GATE_SEQUENCE,
  PBL_GATE_SEQUENCE_NOTES,
  arenaAvailability,
  auditSharedCombatData,
  gateResidue,
  gateStepPlan,
  gateSummary,
  type GateResidueObservable,
  type SharedCombatDataAudit,
} from './gate';
import { HUD_BAND_H, LAB_GROUND_Y, stageRect, type LabLayerId, type LayeredRect } from './layout';
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
  /** Arena A 真实运行诊断（当前不是 Arena A 时为 null）。 */
  readonly arenaA: PblArenaAProbe | null;
  /** PBL-M3｜体验验证入口的当前状态（由 state 派生，非点击标记）。 */
  readonly experienceValidation: PblExperienceValidationProbe;
  /** PBL-G1 对照门禁诊断（审计 + 6 步验证顺序 + 切场零残留）。 */
  readonly gate: PblGateProbe;
  readonly camera: { scale: number; offsetX: number; offsetY: number; dpr: number };
  readonly canvas: { backingW: number; backingH: number; cssW: number; cssH: number };
}

/** Arena A 只读诊断（全部取自真实物理运行时的 `view()`，不做任何近似/伪造）。 */
export interface PblArenaAProbe {
  /** 是否已接入真实运行时（running）而非 idle 预览快照。 */
  readonly live: boolean;
  readonly gravity: { x: number; y: number };
  readonly wallRestitution: number;
  readonly antiWedge: typeof TOPDOWN_ANTI_WEDGE;
  readonly bounds: { minX: number; minY: number; maxX: number; maxY: number };
  readonly walls: readonly { x: number; y: number; w: number; h: number }[];
  readonly steps: number;
  readonly timeMs: number;
  readonly shotsFired: number;
  readonly hits: number;
  readonly lastDamage: {
    source: string;
    target: string;
    damageSource: string;
    partId: string | null;
    damage: number;
  } | null;
  readonly entities: readonly {
    entityId: string;
    /** 真实车辆实例身份（`OwnerTag.vehicleId`）——多实体区分归属的直接证据。 */
    vehicleId: string;
    team: string;
    role: string;
    bodyName: string;
    hp: number;
    maxHp: number;
    x: number;
    y: number;
    headingRad: number;
    speedPxPerStep: number;
    reversing: boolean;
    boundsRect: { x: number; y: number; w: number; h: number };
  }[];
  readonly projectiles: readonly { x: number; y: number; radius: number; team: string }[];
  /** 任一对实体最深的真实碰撞几何重叠（≤0 = 无重叠；>0 = 真实重叠）。 */
  readonly worstEntityOverlapDepthPx: number;
  readonly minPairDistancePx: number;
}

/**
 * PBL-M3-LIGHT-SWARM-EXPERIENCE-VALIDATION-R1｜体验验证入口诊断。
 *
 * ⚠️ 全部由**当前 state 派生**（不是「点过按钮」留下的标记）⇒ Reset / 切配置后自动失效，
 *    不会出现「显示已进入但实际已退出」的假状态。
 */
export interface PblExperienceValidationProbe {
  readonly queueId: string;
  /** 当前组合是否就是验证组合（Arena A + 西瓜重炮 + 3 轻敌人）。 */
  readonly active: boolean;
  readonly arena: string;
  readonly loadout: string;
  readonly encounter: string;
  /** 由正式数据源声明（`LAB_ENCOUNTERS[].count`）的同场敌人数 —— 不按运行时实体数反推。 */
  readonly declaredEnemyCount: number;
  /** 运行期真实敌方实体数；只有与 declaredEnemyCount 相等才算「3 个都真的在场」。 */
  readonly liveEnemyCount: number;
  /** 真实车辆实例身份（`OwnerTag.vehicleId`），按实体顺序；非 Arena A 时为空数组。 */
  readonly vehicleIds: readonly string[];
  /** 本入口**不是**正式 Run Runtime（如实声明；正式运行时 = `runBattleRuntime.ts` 的适配对象）。 */
  readonly isFormalRunRuntime: false;
  /** 页面必须展示的标记与真人问题（唯一来源 = `constants.ts`）。 */
  readonly badgeTitle: string;
  readonly badgeSubtitle: string;
  readonly question: string;
  /** 可选 A/B 未做的如实披露。 */
  readonly abNotDone: string;
}

/** PBL-G1 门禁诊断（全部来自 gate.ts 的真实审计结果，不做任何美化/兜底）。 */
export interface PblGateProbe {
  /** 共享配置审计是否通过（Body / HP / Weapon 伤害 / CD / 弹丸 全部由正式链路独立重算比对）。 */
  readonly auditOk: boolean;
  readonly auditProblems: readonly string[];
  readonly auditCombos: number;
  readonly auditMismatchCount: number;
  /** 允许差异（集中可枚举；A/B 只允许这三类差异）。 */
  readonly allowedDifferences: readonly {
    readonly id: string;
    readonly kind: string;
    readonly arenas: readonly string[];
    readonly files: readonly string[];
    readonly symbols: readonly string[];
  }[];
  /** Queue 必改 2 的 6 步快速验证顺序 + 每步的计划可用性与本 Lab 的实际执行结果。 */
  readonly sequence: readonly {
    readonly index: number;
    readonly arena: string;
    readonly loadout: string;
    readonly encounter: string;
    readonly assumed: readonly string[];
    readonly planned: string;
    readonly observed: string;
    readonly reason: string;
  }[];
  readonly notes: readonly string[];
  /** 已推进到的步数（0 = 未开始；Reset / 清空后归零）。 */
  readonly cursor: number;
  /** 最近一次切场（最后一次配置变更）= 0 步时记录的残留项（必须为空）。 */
  readonly switchResidue: readonly string[];
  /** 门禁总体结论：blocked = 存在因运行时未实现而无法执行的步骤。 */
  readonly verdict: string;
  /** 各 Arena 的运行时可用性（由「运行时是否已落地」派生）。 */
  readonly arenaAvailable: Record<string, boolean>;
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
  /**
   * Arena A 真实运行时（**仅 running 且 arena=A 时存在**）。
   * idle 预览用一次性运行时快照（见 previewArenaView），不长期持有。
   */
  private arenaRuntime: ArenaARuntime | null = null;
  /** Arena A idle 预览快照缓存（key = loadout|encounter；t=0 确定性快照）。 */
  private idleArenaView: { key: string; view: ArenaAView } | null = null;
  /** 当前渲染用的 Arena A 快照（idle = t0；running = 实时）。 */
  private arenaAView: ArenaAView | null = null;
  private rafHandle = 0;
  private lastFrameMs = 0;
  private gatePanel: HTMLDivElement | null = null;
  private btnGateNext: HTMLButtonElement | null = null;
  private btnGateClear: HTMLButtonElement | null = null;
  /**
   * PBL-M3｜体验验证条幅 + 一键入口按钮。
   * ⚠️ 条幅是**纯 DOM**（在 canvas 之外）⇒ 对像素分类零影响；
   *    「是否已进入验证组合」由 state 派生（见 `isLightSwarmValidation`），不存标记。
   */
  private validationBanner: HTMLDivElement | null = null;
  private validationStateEl: HTMLSpanElement | null = null;
  private btnLightSwarm: HTMLButtonElement | null = null;
  /** 共享配置审计结果（惰性计算一次并缓存；配置目录是模块常量，无需失效）。 */
  private gateAudit: SharedCombatDataAudit | null = null;
  /** 已推进到的步数（Reset / Gate 清空后归零）。 */
  private gateCursor = 0;
  /** 每步的实际执行结果（未推进的步骤为 pending）。 */
  private readonly gateObserved = new Map<number, 'pending' | 'running' | 'blocked'>();
  /** 最近一次「回到 idle」时观测到的残留（必须为空 → 必改 3）。 */
  private lastIdleResidue: string[] = [];
  /** 最近一次 Gate 切场后观测到的残留。 */
  private gateSwitchResidue: string[] = [];
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
    this.refreshArenaAView();
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
      this.btnReset = mkButton(host, 'Reset', () => {
        this.gateClear();
        this.apply(reset(this.state));
      });
    });
    mkGroup('Gate', (host) => {
      this.btnGateNext = mkButton(host, 'Gate 下一步', () => this.gateNext());
      this.btnGateClear = mkButton(host, 'Gate 清空', () => this.gateClear());
    });
    /**
     * PBL-M3-LIGHT-SWARM-EXPERIENCE-VALIDATION-R1｜**唯一**新增入口：
     * 一键把 Lab 切到「Arena A + 西瓜重炮 + 3 轻敌人」并 Start。
     * 全部走既有状态机（`setArena` → `setLoadout` → `setEncounter` → `start`），
     * **不新建 Runtime、不新建页面**（复用 Arena A 已经存在的真实多实体能力）。
     */
    mkGroup('体验验证', (host) => {
      this.btnLightSwarm = mkButton(host, PBL_LIGHT_SWARM_VALIDATION.label, () =>
        this.applyLightSwarmValidation(),
      );
      this.btnLightSwarm.classList.add('pbl-btn-primary');
    });

    this.validationBanner = this.buildValidationBanner();
    this.statusEl.className = 'pbl-status';
    this.gatePanel = document.createElement('div');
    this.gatePanel.className = 'pbl-gate';

    this.stageWrap.className = 'pbl-stage';
    this.stageWrap.appendChild(this.canvas);

    this.root.appendChild(bar);
    this.root.appendChild(this.validationBanner);
    this.root.appendChild(this.statusEl);
    this.root.appendChild(this.gatePanel);
    this.root.appendChild(this.stageWrap);
  }

  /**
   * 体验验证条幅（Queue 必改 3：页面必须明确标记 EXPERIENCE VALIDATION ONLY / 非正式 Run Runtime）。
   *
   * 纯 DOM、位于 canvas 之外 ⇒ 不进入任何像素统计；文案唯一来源 = `constants.ts`。
   */
  private buildValidationBanner(): HTMLDivElement {
    const v = PBL_LIGHT_SWARM_VALIDATION;
    const el = document.createElement('div');
    el.className = 'pbl-validation-banner';
    el.dataset['queue'] = v.queueId;
    el.dataset['active'] = 'false';

    const title = document.createElement('span');
    title.className = 'pbl-vb-title';
    title.textContent = v.badgeTitle;

    const sub = document.createElement('span');
    sub.className = 'pbl-vb-sub';
    sub.textContent = v.badgeSubtitle;

    this.validationStateEl = document.createElement('span');
    this.validationStateEl.className = 'pbl-vb-state';

    const question = document.createElement('div');
    question.className = 'pbl-vb-question';
    question.textContent = `真人只回答：${v.question}`;

    const note = document.createElement('div');
    note.className = 'pbl-vb-note';
    note.textContent = v.abNotDone;

    el.appendChild(title);
    el.appendChild(sub);
    el.appendChild(this.validationStateEl);
    el.appendChild(question);
    el.appendChild(note);
    return el;
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
    this.stopLoop();
    this.stopArenaARuntime();
    window.removeEventListener('resize', this.onWindowResize);
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
  }

  /* ------------------------------------------------------- Arena A 运行时 */

  /** 当前 Arena A 的配置指纹（idle 预览缓存 / running 运行时重建都按它判断）。 */
  private arenaAKey(): string {
    return `${this.state.loadout}|${this.state.encounter}`;
  }

  /**
   * idle 预览快照：用一次性运行时取 t=0 真实快照后立刻释放。
   * 只在 Arena A 且未运行时使用（running 时一律用长驻运行时）。
   */
  private previewArenaView(): ArenaAView {
    const key = this.arenaAKey();
    if (this.idleArenaView && this.idleArenaView.key === key) return this.idleArenaView.view;
    const rt = new ArenaARuntime(this.previewPlan());
    const view = rt.view();
    rt.dispose();
    this.idleArenaView = { key, view };
    return view;
  }

  /** 让 Arena A 快照与当前 phase 对齐（idle = 预览，running = 实时）。 */
  private refreshArenaAView(): void {
    if (this.state.arena !== 'A') {
      this.arenaAView = null;
      return;
    }
    this.arenaAView = this.arenaRuntime ? this.arenaRuntime.view() : this.previewArenaView();
  }

  private startArenaARuntime(): void {
    this.stopArenaARuntime();
    const plan = this.state.run.plan ?? this.previewPlan();
    this.arenaRuntime = new ArenaARuntime(plan);
  }

  private stopArenaARuntime(): void {
    if (this.arenaRuntime) {
      this.arenaRuntime.dispose();
      this.arenaRuntime = null;
    }
  }

  /** 只在 phase=running 且 arena=A 时开启真实物理推进循环。 */
  private startLoop(): void {
    if (this.rafHandle !== 0) return;
    this.lastFrameMs = performance.now();
    const tick = (now: number): void => {
      const dt = Math.min(64, now - this.lastFrameMs);
      this.lastFrameMs = now;
      if (!this.arenaRuntime) {
        this.rafHandle = 0;
        return;
      }
      this.arenaRuntime.advance(dt);
      this.refreshArenaAView();
      this.render();
      this.rafHandle = requestAnimationFrame(tick);
    };
    this.rafHandle = requestAnimationFrame(tick);
  }

  private stopLoop(): void {
    if (this.rafHandle !== 0) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = 0;
    }
  }

  /* ------------------------------------------------------- Gate（PBL-G1） */

  /** 门禁残留可观测量的构造（判据唯一来源 = gate.ts 的 `gateResidue`）。 */
  private residueObservable(): GateResidueObservable {
    const isA = this.state.arena === 'A';
    const v = isA ? this.arenaAView : null;
    return {
      phase: this.state.phase,
      liveEntities: this.state.run.entities.length,
      liveProjectiles: this.state.run.projectiles.length,
      arenaA: isA
        ? {
            live: this.arenaRuntime !== null,
            steps: v ? v.steps : 0,
            shotsFired: v ? v.shotsFired : 0,
            hits: v ? v.hits : 0,
          }
        : null,
    };
  }

  /** 缓存共享配置审计（目录是模块常量 → 算一次即可）。 */
  private gateAuditResult(): SharedCombatDataAudit {
    if (!this.gateAudit) this.gateAudit = auditSharedCombatData();
    return this.gateAudit;
  }

  private gateVerdict(): string {
    const audit = this.gateAuditResult();
    return gateSummary(
      audit.ok,
      PBL_GATE_SEQUENCE.map((s) => gateStepPlan(s).status),
    ).verdict;
  }

  /**
   * 推进一步（Queue 必改 2）：按固定顺序切换 Arena / Loadout / Encounter ——
   * 状态机对每次配置变更都强制清场，本方法随即核对**零残留**（必改 3）；
   * 该 Arena 有真实运行时则 Start，否则判 blocked 且**绝不 Start**（不拿占位舞台冒充对照）。
   * 审计未通过时拒绝推进。
   */
  private gateNext(): void {
    const audit = this.gateAuditResult();
    if (!audit.ok) {
      this.render();
      return;
    }
    if (this.gateCursor >= PBL_GATE_SEQUENCE.length) return;
    const step = PBL_GATE_SEQUENCE[this.gateCursor]!;
    const planned = gateStepPlan(step);
    this.gateCursor += 1;

    this.apply(setArena(this.state, step.arena));
    this.apply(setLoadout(this.state, step.loadout));
    this.apply(setEncounter(this.state, step.encounter));

    this.lastIdleResidue = gateResidue(this.residueObservable());
    this.gateSwitchResidue = [...this.lastIdleResidue];

    this.gateObserved.set(step.index, planned.status === 'ready' ? 'running' : 'blocked');
    if (planned.status === 'ready') this.apply(start(this.state));
    this.render();
  }

  /** 复位门禁游标（Reset 时一并调用）。 */
  private gateClear(): void {
    this.gateCursor = 0;
    this.gateObserved.clear();
    this.gateSwitchResidue = [];
    this.render();
  }

  /* -------------------- 体验验证（PBL-M3-LIGHT-SWARM-EXPERIENCE-VALIDATION-R1） */

  /**
   * 当前组合是否就是体验验证组合。
   * ⚠️ 由 state **派生**（三个既有 id 同时命中），不是点击留下的标记 ⇒ Reset / 切配置后自动失效。
   */
  private isLightSwarmValidation(): boolean {
    const v = PBL_LIGHT_SWARM_VALIDATION;
    return (
      this.state.arena === v.arena &&
      this.state.loadout === v.loadout &&
      this.state.encounter === v.encounter
    );
  }

  /**
   * 一键进入体验验证组合：Arena A + 西瓜重炮 + 3 轻敌人 + Start。
   *
   * 全部走既有状态机（`reset` → `setArena` → `setLoadout` → `setEncounter` → `start`），
   * 与 `gateNext` 同一套语义；不额外造状态、不改任何数值、不动任何正式 Runtime。
   *
   * ⚠️ 先 `reset` 再配置：**无论当前处于什么状态，点这个按钮都一定有真实动作**
   *    （= 干净地重新开始这场验证，可反复重录），而不是「已经在组合里就完全没响应」
   *    —— 后者正是 PRP-M2-R1 的 P0（按钮可见但点了没反应）。`spawnSerial` 不归零
   *    （`clearRun` 保留），所以每次重开的批次号都能证明「这是新一批实体」。
   */
  private applyLightSwarmValidation(): void {
    const v = PBL_LIGHT_SWARM_VALIDATION;
    this.gateClear();
    this.apply(reset(this.state));
    this.apply(setArena(this.state, v.arena));
    this.apply(setLoadout(this.state, v.loadout));
    this.apply(setEncounter(this.state, v.encounter));
    this.apply(start(this.state));
  }

  /** 同步条幅的「已进入 / 未进入」状态（纯展示；判据 = state 派生）。 */
  private syncValidationBanner(): void {
    const el = this.validationBanner;
    if (!el) return;
    const active = this.isLightSwarmValidation();
    el.dataset['active'] = String(active);
    if (this.validationStateEl) {
      this.validationStateEl.textContent = active
        ? `已进入 · Arena A + 西瓜重炮 + 3 轻敌人（${this.state.phase === 'running' ? '运行中' : '未运行'}）`
        : `未进入（点「${PBL_LIGHT_SWARM_VALIDATION.label}」）`;
    }
  }

  private syncGatePanel(): void {
    const el = this.gatePanel;
    if (!el) return;
    const audit = this.gateAuditResult();
    const lines: string[] = [];
    lines.push(
      `PBL-G1 对照门禁 · verdict=${this.gateVerdict()} · 审计=${audit.ok ? 'PASS' : 'FAIL'}` +
        `（共享组合 ${audit.combos.length} · 数值不符 ${audit.combos.reduce((s, c) => s + c.mismatches.length, 0)}）`,
    );
    lines.push(
      `允许差异 ${PBL_ALLOWED_ARENA_DIFFERENCES.length} 类（仅此三类）：` +
        PBL_ALLOWED_ARENA_DIFFERENCES.map((d) => `${d.kind}[${d.arenas.join('/')}]`).join(' · '),
    );
    lines.push(`快速验证顺序（已推进 ${this.gateCursor}/${PBL_GATE_SEQUENCE.length}；BLK = 运行时未实现，未 Start）：`);
    for (const step of PBL_GATE_SEQUENCE) {
      const planned = gateStepPlan(step);
      const observed = this.gateObserved.get(step.index) ?? 'pending';
      const l = findLoadout(step.loadout);
      const e = findEncounter(step.encounter);
      const mark = observed === 'running' ? 'RUN' : observed === 'blocked' ? 'BLK' : '---';
      lines.push(
        `  ${mark} ${step.index}. [${step.arena}] ${l ? l.label : step.loadout} × ${e ? e.label : step.encounter}` +
          ` · planned=${planned.status} observed=${observed}` +
          (planned.status === 'blocked' ? ' ← Arena 运行时未实现' : ''),
      );
    }
    lines.push(
      `切场零残留：${this.gateSwitchResidue.length === 0 ? '[] （干净）' : JSON.stringify(this.gateSwitchResidue)}`,
    );
    for (const n of PBL_GATE_SEQUENCE_NOTES) lines.push(`注：${n}`);
    for (const p of audit.problems.slice(0, 3)) lines.push(`审计问题：${p}`);
    el.textContent = lines.join('\n');
    el.dataset['verdict'] = this.gateVerdict();
    el.dataset['auditOk'] = String(audit.ok);
    el.dataset['cursor'] = String(this.gateCursor);
  }

  /* ------------------------------------------------------------- 状态 */

  private apply(nextState: PortraitLabState): void {
    if (nextState === this.state) return; // no-op（同值 set / running 中重复 Start）
    const prev = this.state;
    this.state = nextState;
    this.syncRuntime(prev);
    // 回到 idle（Reset / 切配置）时立刻核对零残留：HP / 实体 / 弹丸 / 接触 / AI / 移动 / arena 状态
    if (nextState.phase === 'idle') this.lastIdleResidue = gateResidue(this.residueObservable());
    this.render();
  }

  /**
   * 把纯状态机的 phase / 配置变化映射为 Arena A 运行时生命周期：
   * - running 且 arena=A → 长驻真实运行时 + 物理推进循环（配置变了则重建）；
   * - 其余情况（idle / Reset / 切配置 / 切到 Arena B）→ 立即停止推进并释放运行时。
   * 状态机本身保持纯粹（无副作用），运行时只活在 Lab 控制器里。
   */
  private syncRuntime(prev: PortraitLabState): void {
    const configChanged =
      prev.loadout !== this.state.loadout ||
      prev.encounter !== this.state.encounter ||
      prev.arena !== this.state.arena;
    if (configChanged) this.idleArenaView = null;

    if (this.state.phase === 'running' && this.state.arena === 'A') {
      if (!this.arenaRuntime || configChanged) this.startArenaARuntime();
      this.startLoop();
    } else {
      this.stopLoop();
      this.stopArenaARuntime();
    }
    this.refreshArenaAView();
  }

  /** 当前应绘制的分层场景（Arena A = 真实物理快照；其余 = F1 占位舞台）。 */
  private currentScene(): LayeredRect[] {
    if (this.state.arena === 'A') {
      return arenaAScene(this.arenaAView ?? this.previewArenaView());
    }
    return buildScene(this.state.arena, this.previewPlan());
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
      arenaA: this.arenaAProbe(),
      experienceValidation: this.experienceValidationProbe(),
      gate: this.gateProbe(),
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
    for (const s of this.currentScene()) counts[s.layer] += 1;
    return counts;
  }

  /** Arena A 真实运行诊断（当前不是 Arena A → null）。 */
  private arenaAProbe(): PblArenaAProbe | null {
    if (this.state.arena !== 'A') return null;
    const v = this.arenaAView ?? this.previewArenaView();
    return {
      live: this.arenaRuntime !== null,
      gravity: { x: v.gravity.x, y: v.gravity.y },
      wallRestitution: ARENA_A_WALL_RESTITUTION,
      antiWedge: TOPDOWN_ANTI_WEDGE,
      bounds: { ...v.bounds },
      walls: v.walls.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })),
      steps: v.steps,
      timeMs: v.timeMs,
      shotsFired: v.shotsFired,
      hits: v.hits,
      lastDamage: v.lastDamage ? { ...v.lastDamage } : null,
      entities: v.entities.map((e) => ({
        entityId: e.entityId,
        vehicleId: e.vehicleId,
        team: e.team,
        role: e.role,
        bodyName: e.bodyName,
        hp: e.hp,
        maxHp: e.maxHp,
        x: e.x,
        y: e.y,
        headingRad: e.headingRad,
        speedPxPerStep: e.speedPxPerStep,
        reversing: e.reversing,
        boundsRect: { ...e.boundsRect },
      })),
      projectiles: v.projectiles.map((p) => ({ ...p })),
      worstEntityOverlapDepthPx: v.worstEntityOverlapDepthPx,
      minPairDistancePx: v.minPairDistancePx,
    };
  }

  /**
   * 体验验证入口诊断（PBL-M3）。
   *
   * 判据全部来自真实数据源，不做近似：
   *   - `declaredEnemyCount` = `LAB_ENCOUNTERS[].count`（**声明**，不按运行时实体数反推）；
   *   - `liveEnemyCount` = 真实运行期敌方实体数（Arena A 快照里 `team !== 'A'` 的实体）；
   *   - `vehicleIds` = `OwnerTag.vehicleId`（真实车辆实例身份；非 Arena A 时为空）。
   */
  private experienceValidationProbe(): PblExperienceValidationProbe {
    const v = PBL_LIGHT_SWARM_VALIDATION;
    const encounter = findEncounter(this.state.encounter);
    const view = this.state.arena === 'A' ? (this.arenaAView ?? this.previewArenaView()) : null;
    const entities = view ? view.entities : [];
    return {
      queueId: v.queueId,
      active: this.isLightSwarmValidation(),
      arena: this.state.arena,
      loadout: this.state.loadout,
      encounter: this.state.encounter,
      declaredEnemyCount: encounter ? encounter.count : 0,
      liveEnemyCount: entities.filter((e) => e.team !== 'A').length,
      vehicleIds: entities.map((e) => e.vehicleId),
      isFormalRunRuntime: false,
      badgeTitle: v.badgeTitle,
      badgeSubtitle: v.badgeSubtitle,
      question: v.question,
      abNotDone: v.abNotDone,
    };
  }

  /** PBL-G1 门禁诊断（审计结果 + 6 步顺序 + 每步实际结果 + 切场零残留）。 */
  private gateProbe(): PblGateProbe {
    const audit = this.gateAuditResult();
    return {
      auditOk: audit.ok,
      auditProblems: audit.problems,
      auditCombos: audit.combos.length,
      auditMismatchCount: audit.combos.reduce((s, c) => s + c.mismatches.length, 0) + audit.problems.length,
      allowedDifferences: PBL_ALLOWED_ARENA_DIFFERENCES.map((d) => ({
        id: d.id,
        kind: d.kind,
        arenas: d.arenas,
        files: d.files,
        symbols: d.symbols,
      })),
      sequence: PBL_GATE_SEQUENCE.map((step) => {
        const planned = gateStepPlan(step);
        return {
          index: step.index,
          arena: step.arena,
          loadout: step.loadout,
          encounter: step.encounter,
          assumed: step.assumed,
          planned: planned.status,
          observed: this.gateObserved.get(step.index) ?? 'pending',
          reason: planned.reason,
        };
      }),
      notes: PBL_GATE_SEQUENCE_NOTES,
      cursor: this.gateCursor,
      switchResidue: this.gateSwitchResidue,
      verdict: this.gateVerdict(),
      arenaAvailable: arenaAvailability(),
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
    this.syncGatePanel();
    this.syncValidationBanner();
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

    // 实体场景：Arena A = 真实物理快照（边界墙 + 真实姿态车辆）；其余 = F1 占位舞台
    const scene = this.currentScene();
    for (const shape of scene) {
      ctx.fillStyle = LAYER_COLORS[shape.layer];
      ctx.fillRect(shape.rect.x, shape.rect.y, shape.rect.w, shape.rect.h);
    }

    // 地面线只属于 F1 占位舞台（Arena A 是俯视场，没有地面）
    if (s.arena !== 'A') {
      ctx.fillStyle = COLORS.ground;
      ctx.fillRect(2, LAB_GROUND_Y, stage.w - 4, 3);
    }

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

    // 运行态：Arena A = 真实物理推进；其余 Arena 仍是 PBL-B1 未实现的占位态
    const running = s.phase === 'running';
    if (s.arena === 'A') {
      const a = this.arenaAProbe();
      ctx.fillStyle = running ? COLORS.running : COLORS.dim;
      ctx.font = 'bold 15px system-ui, sans-serif';
      if (a && running) {
        ctx.fillText(
          `RUNNING ${a.live ? '(A1 真实物理)' : '(预览)'} · ${(a.timeMs / 1000).toFixed(1)}s / ${a.steps} 步`,
          12,
          120,
        );
      } else if (a) {
        ctx.fillText(`READY（A1 俯视场 · t=0 静止）· 实体 ${a.entities.length}`, 12, 120);
      }
    } else if (running) {
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
    ctx.fillText(
      s.arena === 'A' ? 'Arena A：四边实体边界（无重力 / 无刺墙 / 无缩圈）' : 'Arena 标记（下方带）',
      12,
      PORTRAIT_LOGICAL_H - 6,
    );
  }

  private syncStatus(): void {
    const sum = labSummary(this.state);
    const a = this.arenaAProbe();
    const a1 =
      a && this.state.arena === 'A'
        ? ` · A1[bounds=${a.bounds.minX},${a.bounds.minY}-${a.bounds.maxX},${a.bounds.maxY} walls=${a.walls.length} ` +
          `gravity=${a.gravity.x},${a.gravity.y} steps=${a.steps} shots=${a.shotsFired} hits=${a.hits} ` +
          `overlap=${a.worstEntityOverlapDepthPx.toFixed(2)}]`
        : '';
    this.statusEl.textContent =
      `Arena=${sum.arena}(${sum.arenaLabel}) · Loadout=${sum.loadout}(${sum.loadoutLabel}) · ` +
      `Encounter=${sum.encounter}(${sum.encounterLabel}) · phase=${sum.phase} · starts=${sum.startCount} · ` +
      `实体=${sum.entityCount}(敌 ${sum.enemyCount})` +
      (sum.unavailable.length ? ` · 缺口=${sum.unavailable.join('/')}` : '') +
      a1;
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
    // Gate：审计不过 / 顺序已走完 → 不可再推进；未开始 → 无可清空
    if (this.btnGateNext) {
      this.btnGateNext.disabled = !this.gateAuditResult().ok || this.gateCursor >= PBL_GATE_SEQUENCE.length;
    }
    if (this.btnGateClear) {
      this.btnGateClear.disabled = this.gateCursor === 0 && this.gateSwitchResidue.length === 0;
    }
  }
}
