/**
 * PRP-M3-ENCOUNTER-BATCH-01｜遭遇验证台控制器（本验证页面**唯一**的 DOM / Canvas 层）。
 *
 * 这个页面只回答一个问题：
 *
 *     不同的敌人，是否真的让**同一辆战车**面临不同的战斗问题？
 *
 * 它**不**开发新敌人、**不**调平衡、**不**改变玩家 —— 只把三个**已经存在**的正式
 * Encounter 摆到同一块舞台上，一个按钮切换一次。
 *
 * ── 与既有页面的关系（Queue 必改 4：只做独立验证路径）────────────────────
 *
 *   - 独立 HTML `encounter-lab.html` + 独立脚本；**不是** `npm run dev` 的落地页
 *     （根路径重写规则一个字节未改），也不进入任何正式构建产物；
 *   - 复用 `RunBattleRuntime`（正式 `PlanckBattleOrchestrator` 的薄适配，**零 config 覆盖**）
 *     与 `RunBattleView`（正式 `Renderer` + 正式 battle 相机链）——
 *     因此这里看到的画面与取景**就是正式战斗本身**，不是第二套实现；
 *   - 舞台带尺寸沿用 `RUN_STAGE_BAND`，于是 `RunBattleView` 的离屏视口
 *     （带 + 正式 inset 56/28）继续保持 1:1 —— **相机算法一行未改**（Queue 禁止项）。
 *
 * ── 切换语义（Queue 必改 3 与验收 2/3）────────────────────────────────
 *
 *   `select(id)`：
 *       ① `disposeRuntime()`  —— 彻底释放上一场（弹丸 / 接触 / 事件订阅随对象消失）
 *       ② `new RunBattleRuntime({ encounterId: id })` —— 满耐久 / 无 Run Buff / 正式 spawn
 *       ③ 在**任何一步物理推进之前**记下这一场的「开局读数」（`fresh`）
 *       ④ 真实时间步进直到出结果（`result` 非空）→ 战场冻结
 *   `reset()`：回到 idle（无 runtime），并清空本页的累计战果 —— 无状态残留。
 *
 * ⚠️ 「开局读数」刻意在构造那一刻采集，**不是**在点击后某帧去读：RAF 一启动物理就前进了，
 *    「t=0 的干净开局」在页面上根本抓不到第二遍。把读数固化下来，才是可断言的事实。
 */

import { PlayerViewportTransform } from '../../platform/playerViewport';
import { ENEMY_KEEP_DISTANCE_BANDS } from '../../battle/battleContract';
import { PORTRAIT_LOGICAL_H, PORTRAIT_LOGICAL_W } from './constants';
import {
  ENCOUNTER_BATCH,
  ENCOUNTER_LAB_IDLE_HINT,
  ENCOUNTER_LAB_LEAD,
  ENCOUNTER_LAB_RESET_LABEL,
  ENCOUNTER_LAB_TITLE,
  encounterBatchOf,
  encounterLabContext,
  type EncounterBatchId,
  type EncounterLabContext,
} from './encounterValidation';
import {
  RUN_ACTION_BAND,
  RUN_BANDS,
  RUN_LOG_BAND,
  RUN_PAGE_H,
  RUN_PAGE_W,
  RUN_STAGE_BAND,
  RUN_TOP_BAND,
} from './runPageLayout';
import { RunBattleRuntime } from './runBattleRuntime';
import { RunBattleView } from './runBattleView';

const FONT_STACK = 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';

const COLORS = {
  pageBg: '#0b0e14',
  topBandBg: '#151c28',
  stageBg: '#0d1119',
  logBandBg: '#0d121a',
  actionBandBg: '#141a26',
  divider: '#25314a',
  text: '#e8eef8',
  dim: '#8a93a5',
  accent: '#7fb0ff',
  good: '#5ee08a',
  warn: '#ff7a6b',
  idle: '#46536b',
} as const;

export type EncounterLabPhase = 'idle' | 'running' | 'done';

/**
 * 一场战斗**刚建立**时的真实读数（在任何物理推进之前采集）。
 *
 * 这就是「无残留」的判据来源：每一场都必须从这个形状开始 ——
 * 步数 0 / 时间 0 / 无存活弹丸 / 无接触·命中·伤害记录 / 满耐久 / 空 Build / 正式出生点。
 */
export interface FreshBattleReading {
  /** 本场对手（= 请求的那个 Encounter id，由运行时回读，不是把入参抄一遍）。 */
  readonly encounterId: string;
  /** 本局 Build（M3 恒为空数组 = 无 Run Buff）。 */
  readonly buildIds: readonly string[];
  /** 玩家耐久上限（正式 resolved body.hp）。 */
  readonly playerHpMax: number;
  /** 本场开局耐久（构造时捕获）——必须等于上限（满耐久）。 */
  readonly initialPlayerHp: number;
  readonly enemyHpMax: number;
  readonly enemyHp: number;
  readonly steps: number;
  readonly timeMs: number;
  readonly projectiles: number;
  /** 上一场残留的接触 / 命中 / 伤害记录（新 runtime 必须全 false）。 */
  readonly contact: boolean;
  readonly impact: boolean;
  readonly damage: boolean;
  readonly spawnAx: number;
  readonly spawnBx: number;
  readonly spawnSeparation: number;
  /** 开局两车外廓真实间距（世界 px）——每套 Encounter 的车形不同，这是真实测量值。 */
  readonly gapWorld: number;
  readonly arenaWidth: number;
  readonly arenaHeight: number;
  readonly groundY: number;
}

/** 当前战斗的**实时**读数（每帧刷新）。 */
export interface LiveBattleReading {
  readonly encounterId: string;
  readonly arenaPhase: string;
  readonly steps: number;
  readonly timeMs: number;
  readonly projectiles: number;
  readonly playerHp: number;
  readonly playerHpMax: number;
  readonly enemyHp: number;
  readonly enemyHpMax: number;
  readonly gapWorld: number;
  readonly contact: boolean;
  readonly impact: boolean;
  readonly damage: boolean;
  readonly cameraScale: number;
  /**
   * PBL-FOUNDATION-RANGED-DISTANCE-CONTROL-R1｜对手上一步实际生效的**距离档**
   * （`near` / `hold` / `far`；本套 Encounter 未声明 `enemyDrive` ⇒ `null`）。
   */
  readonly enemyDriveBand: 'near' | 'hold' | 'far' | null;
  /** 该决策真正读到的**core 间距**（Body + Wheels，与相机取景同源；无决策 ⇒ `null`）。 */
  readonly enemyDriveGap: number | null;
}

/** 一场跑完的战斗（用于「三种 Encounter 都能稳定进入 / 战斗 / 清理 / 重开」）。 */
export interface EncounterRoundRecord {
  readonly encounterId: string;
  readonly label: string;
  readonly steps: number;
  readonly timeMs: number;
  readonly playerHp: number;
  readonly playerHpMax: number;
  readonly enemyHp: number;
  readonly enemyHpMax: number;
  readonly winner: string | null;
  readonly endReason: string | null;
}

export interface EncounterLabProbe {
  readonly logicalW: number;
  readonly logicalH: number;
  readonly title: string;
  readonly lead: string;
  readonly loadoutId: string;
  readonly playerLabel: string;
  readonly playerBodyName: string;
  readonly playerHpMax: number;
  readonly batch: readonly {
    readonly id: string;
    readonly label: string;
    readonly templateId: string;
    readonly count: number;
    readonly verifies: string;
  }[];
  /** 页面上的测试控件（只允许三个对手 + Reset）。 */
  readonly controls: readonly { readonly id: string; readonly kind: string; readonly label: string }[];
  /** 当前选中的对手（`null` = Reset 后 / 未选）。 */
  readonly active: string | null;
  readonly phase: EncounterLabPhase;
  readonly runtimeActive: boolean;
  /** 本页累计创建过的战斗运行时数量（每次切换 +1；用于证明「每次都是新实例」）。 */
  readonly runtimeSerial: number;
  /** 已 `dispose()` 的次数（= 切换 + Reset 的次数）。 */
  readonly disposedCount: number;
  readonly resetCount: number;
  /** 当前这场战斗的**开局读数**（无 runtime → null）。 */
  readonly fresh: FreshBattleReading | null;
  /** 当前这场战斗的实时读数（无 runtime → null）。 */
  readonly live: LiveBattleReading | null;
  /** 本页累计跑完的战斗（Reset 清空）。 */
  readonly rounds: readonly EncounterRoundRecord[];
  readonly screen: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
    readonly scale: number;
    readonly dpr: number;
  };
  readonly camera: { readonly scale: number; readonly offsetX: number; readonly offsetY: number; readonly dpr: number };
  readonly canvas: { readonly backingW: number; readonly backingH: number; readonly cssW: number; readonly cssH: number };
  readonly assets: { readonly registered: number; readonly ready: number; readonly failed: readonly string[] };
}

export class EncounterLab {
  private readonly root: HTMLElement;
  private readonly barEl: HTMLDivElement;
  private readonly stageWrap: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly statusEl: HTMLDivElement;
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private readonly resetButton: HTMLButtonElement;
  /** 页面文案与对手清单（全部来自正式链路解析的上下文）。 */
  private readonly ctxInfo: EncounterLabContext;

  /** 固定摄像机：竖屏 390×844 逻辑舞台（复用共享 contain 变换契约，不引入第二套坐标）。 */
  private readonly vp = new PlayerViewportTransform(PORTRAIT_LOGICAL_W, PORTRAIT_LOGICAL_H);
  /** 真实战斗视图宿主（正式 Renderer + 正式 battle 相机链 + 舞台带贴图）。 */
  private readonly battleView = new RunBattleView();

  /** 当前这一场的运行时。**同一时刻只允许存在一个** —— 切换/Reset 一律先 dispose。 */
  private runtime: RunBattleRuntime | null = null;
  private activeId: EncounterBatchId | null = null;
  private fresh: FreshBattleReading | null = null;
  private runtimeSerial = 0;
  private disposedCount = 0;
  private resetCount = 0;
  private readonly rounds: EncounterRoundRecord[] = [];

  private rafHandle = 0;
  private lastFrameMs = 0;
  private resizeObserver: ResizeObserver | null = null;
  private readonly onWindowResize = (): void => this.render();

  constructor(root: HTMLElement) {
    this.root = root;
    this.ctxInfo = encounterLabContext();
    this.barEl = document.createElement('div');
    this.barEl.className = 'elab-bar';
    this.stageWrap = document.createElement('div');
    this.stageWrap.className = 'elab-stage';
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'elab-canvas';
    this.ctx = this.canvas.getContext('2d');
    this.statusEl = document.createElement('div');
    this.statusEl.className = 'elab-status';

    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'elab-btn elab-btn-reset';
    reset.textContent = ENCOUNTER_LAB_RESET_LABEL;
    reset.dataset['elabControl'] = 'reset';
    reset.dataset['elabId'] = 'reset';
    reset.onclick = () => this.reset();
    this.resetButton = reset;

    this.buildDom();
    this.observeResize();
    // 正式车辆 sprite 异步加载（完成即重绘；缺失则如实降级为几何）
    this.battleView.onAssetsReady(() => this.render());
    this.render();
  }

  /* ---------------------------------------------------------------- DOM */

  private buildDom(): void {
    this.root.replaceChildren();
    this.root.classList.add('elab-root');

    for (const entry of ENCOUNTER_BATCH) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'elab-btn';
      b.textContent = entry.label;
      b.title = `${entry.id} · ${entry.verifies}`;
      b.dataset['elabControl'] = 'encounter';
      b.dataset['elabId'] = entry.id;
      b.onclick = () => this.select(entry.id);
      this.buttons.set(entry.id, b);
      this.barEl.appendChild(b);
    }
    this.barEl.appendChild(this.resetButton);

    this.stageWrap.appendChild(this.canvas);
    this.root.appendChild(this.barEl);
    this.root.appendChild(this.stageWrap);
    this.root.appendChild(this.statusEl);
  }

  private observeResize(): void {
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.render());
      this.resizeObserver.observe(this.stageWrap);
    }
    window.addEventListener('resize', this.onWindowResize);
  }

  /** 释放监听与战斗运行时（整块删除 / 热更新友好）。 */
  dispose(): void {
    this.stopLoop();
    this.disposeRuntime();
    this.battleView.dispose();
    window.removeEventListener('resize', this.onWindowResize);
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
  }

  /* --------------------------------------------------------- 切换 / 清空 */

  /**
   * 选一个对手（Queue 必改 3 的唯一入口之一）。
   *
   * 顺序是硬性的：**先彻底清空上一场**，再新建 —— 结构上不可能出现两场共存、
   * 也不可能让上一场的弹丸 / 接触 / 事件订阅活到下一场。
   */
  select(id: string): void {
    const entry = encounterBatchOf(id);
    if (!entry) return; // 不在批次内 → 什么都不做（不静默换成别的对手）
    if (this.activeId === id && this.runtime !== null) return; // 同一对手重复点击 = 幂等

    this.disposeRuntime();
    this.activeId = entry.id;

    // 满耐久（不传 carriedHp）/ 无 Run Buff（不传 build）/ 正式 spawn（不改 config）
    const rt = new RunBattleRuntime({ encounterId: entry.id });
    this.runtime = rt;
    this.runtimeSerial += 1;
    // ⚠️ 开局读数必须在**任何物理推进之前**采集（见文件头说明）
    this.fresh = this.readFresh(rt);
    this.startLoop();
    this.render();
  }

  /** Reset：回到 idle（无运行时、无累计战果）。 */
  reset(): void {
    this.stopLoop();
    this.disposeRuntime();
    this.activeId = null;
    this.fresh = null;
    this.rounds.length = 0;
    this.resetCount += 1;
    this.render();
  }

  /** 释放当前战斗运行时（弹丸 / 接触 / 事件订阅随对象一起消失）。 */
  private disposeRuntime(): void {
    this.stopLoop();
    if (!this.runtime) return;
    this.runtime.dispose();
    this.runtime = null;
    this.disposedCount += 1;
  }

  /* ------------------------------------------------------------- 读数 */

  private readFresh(rt: RunBattleRuntime): FreshBattleReading {
    const hp = rt.hp();
    const cr = rt.contactResidue();
    return {
      encounterId: rt.encounterId,
      buildIds: [...rt.build],
      playerHpMax: rt.playerMaxHp,
      initialPlayerHp: rt.initialPlayerHp,
      enemyHpMax: hp.bMax,
      enemyHp: hp.b,
      steps: rt.stepCount,
      timeMs: rt.timeMs,
      projectiles: rt.projectileCount(),
      contact: cr.contact,
      impact: cr.impact,
      damage: cr.damage,
      spawnAx: rt.spawnAx,
      spawnBx: rt.spawnBx,
      spawnSeparation: rt.spawnSeparation,
      gapWorld: rt.gapWorld(),
      arenaWidth: rt.arenaWidth,
      arenaHeight: rt.arenaHeight,
      groundY: rt.groundY,
    };
  }

  private readLive(rt: RunBattleRuntime): LiveBattleReading {
    const hp = rt.hp();
    const cr = rt.contactResidue();
    // PBL-FOUNDATION-RANGED-DISTANCE-CONTROL-R1：只读回读正式编排器的上一步决策
    const drive = rt.enemyDriveState();
    return {
      encounterId: rt.encounterId,
      arenaPhase: rt.phase,
      steps: rt.stepCount,
      timeMs: rt.timeMs,
      projectiles: rt.projectileCount(),
      playerHp: hp.a,
      playerHpMax: hp.aMax,
      enemyHp: hp.b,
      enemyHpMax: hp.bMax,
      gapWorld: rt.gapWorld(),
      contact: cr.contact,
      impact: cr.impact,
      damage: cr.damage,
      cameraScale: this.battleView.viewTransform().scale,
      enemyDriveBand: drive ? drive.band : null,
      enemyDriveGap: drive ? drive.gap : null,
    };
  }

  private phaseNow(): EncounterLabPhase {
    if (!this.runtime) return 'idle';
    return this.runtime.result === null ? 'running' : 'done';
  }

  /* ------------------------------------------------------------- 循环 */

  /** 真实物理时间推进正式编排器，直到出结果（与 Run Page 同一条 `world.step` 语义）。 */
  private startLoop(): void {
    if (this.rafHandle !== 0) return;
    this.lastFrameMs = performance.now();
    const tick = (now: number): void => {
      const dt = Math.min(64, now - this.lastFrameMs);
      this.lastFrameMs = now;
      const rt = this.runtime;
      if (!rt) {
        this.rafHandle = 0;
        return;
      }
      rt.step(dt);
      const result = rt.result;
      if (result) {
        const hp = rt.hp();
        this.rounds.push({
          encounterId: rt.encounterId,
          label: encounterBatchOf(rt.encounterId)?.label ?? rt.encounterId,
          steps: rt.stepCount,
          timeMs: rt.timeMs,
          playerHp: hp.a,
          playerHpMax: hp.aMax,
          enemyHp: hp.b,
          enemyHpMax: hp.bMax,
          winner: result.winner ?? null,
          endReason: result.endReason ?? null,
        });
        this.rafHandle = 0; // 打完即停（结束画面是静止的一帧）
        this.render();
        return;
      }
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

  /* ------------------------------------------------------------- 渲染 */

  private render(): void {
    const wrapW = this.stageWrap.clientWidth || PORTRAIT_LOGICAL_W;
    const wrapH = this.stageWrap.clientHeight || PORTRAIT_LOGICAL_H;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    this.vp.update(wrapW, wrapH, dpr);
    this.vp.applyTo(this.canvas); // 会重置 canvas 尺寸 → 上下文变换必须在其后设置

    const ctx = this.ctx;
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // 之后全部按逻辑 px 绘制
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      this.draw(ctx);
    }
    this.syncStatus();
    this.syncControls();
  }

  private draw(ctx: CanvasRenderingContext2D): void {
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';

    // 1) 底色 + 四条横带（几何与 Run Page 同源 → 舞台带就是 RunBattleView 的适配带）
    ctx.fillStyle = COLORS.pageBg;
    ctx.fillRect(0, 0, RUN_PAGE_W, RUN_PAGE_H);
    ctx.fillStyle = COLORS.topBandBg;
    ctx.fillRect(RUN_TOP_BAND.x, RUN_TOP_BAND.y, RUN_TOP_BAND.w, RUN_TOP_BAND.h);
    ctx.fillStyle = COLORS.stageBg;
    ctx.fillRect(RUN_STAGE_BAND.x, RUN_STAGE_BAND.y, RUN_STAGE_BAND.w, RUN_STAGE_BAND.h);
    ctx.fillStyle = COLORS.logBandBg;
    ctx.fillRect(RUN_LOG_BAND.x, RUN_LOG_BAND.y, RUN_LOG_BAND.w, RUN_LOG_BAND.h);
    ctx.fillStyle = COLORS.actionBandBg;
    ctx.fillRect(RUN_ACTION_BAND.x, RUN_ACTION_BAND.y, RUN_ACTION_BAND.w, RUN_ACTION_BAND.h);

    // 2) 中部舞台：真实战斗世界（正式 Renderer + 正式相机）或待机提示
    const rt = this.runtime;
    if (rt) {
      this.battleView.render(rt);
      this.battleView.blit(ctx);
    } else {
      ctx.fillStyle = COLORS.idle;
      ctx.font = `bold 20px ${FONT_STACK}`;
      ctx.textAlign = 'center';
      ctx.fillText(ENCOUNTER_LAB_IDLE_HINT, RUN_STAGE_BAND.w / 2, RUN_STAGE_BAND.y + RUN_STAGE_BAND.h / 2);
      ctx.textAlign = 'left';
    }

    // 分带线（1px，画在下一条带首行）
    ctx.fillStyle = COLORS.divider;
    for (const band of RUN_BANDS.slice(1)) ctx.fillRect(band.x, band.y, band.w, 1);

    // 3) 顶部带（4 行，全部落在 80px 带内：23 / 40 / 58 / 74）
    ctx.fillStyle = COLORS.text;
    ctx.font = `bold 17px ${FONT_STACK}`;
    ctx.fillText(ENCOUNTER_LAB_TITLE, 14, 23);
    ctx.fillStyle = COLORS.dim;
    ctx.font = `12px ${FONT_STACK}`;
    ctx.fillText(ENCOUNTER_LAB_LEAD, 14, 40);

    const active = this.activeId ? encounterBatchOf(this.activeId) : null;
    const entry = active ? this.ctxInfo.encounters.find((e) => e.id === active.id) : null;
    if (active && entry) {
      ctx.fillStyle = COLORS.accent;
      ctx.font = `12px ${FONT_STACK}`;
      ctx.fillText(`对手 ${active.label}（${active.id}）· 验证：${active.verifies}`, 14, 58);
      ctx.fillStyle = COLORS.dim;
      ctx.fillText(`敌 ${entry.enemyLabel} · HP ${entry.enemyHpMax}`, 250, 58);
    } else {
      ctx.fillStyle = COLORS.idle;
      ctx.font = `12px ${FONT_STACK}`;
      ctx.fillText('未选择对手', 14, 58);
    }
    ctx.fillStyle = COLORS.dim;
    ctx.font = `11px ${FONT_STACK}`;
    ctx.fillText(
      `玩家 ${this.ctxInfo.playerLabel}（${this.ctxInfo.playerBodyName}）· HP ${this.ctxInfo.playerHpMax} · 无 Run Buff`,
      14,
      74,
    );

    // 4) 下部：本场读数 + 历史战果（纯文字；这里不是玩家页面，只求可读）
    this.drawLog(ctx);

    // 5) 最底：状态行
    ctx.fillStyle = COLORS.dim;
    ctx.font = `13px ${FONT_STACK}`;
    ctx.fillText(this.statusLine(), 14, RUN_ACTION_BAND.y + 30);
  }

  private drawLog(ctx: CanvasRenderingContext2D): void {
    const x = 14;
    let y = RUN_LOG_BAND.y + 26;
    const line = (text: string, color: string = COLORS.dim, bold = false): void => {
      ctx.fillStyle = color;
      ctx.font = `${bold ? 'bold ' : ''}12px ${FONT_STACK}`;
      ctx.fillText(text, x, y);
      y += 18;
    };

    const fresh = this.fresh;
    const live = this.runtime ? this.readLive(this.runtime) : null;

    line('本场开局读数（物理推进之前）', COLORS.text, true);
    if (!fresh) {
      line('（无 — Reset 后未建立战斗）', COLORS.idle);
    } else {
      line(`对手 ${fresh.encounterId} · Build ${fresh.buildIds.length === 0 ? '[] （无 Run Buff）' : `[${fresh.buildIds.join(', ')}]`}`);
      line(
        `耐久 ${fresh.initialPlayerHp}/${fresh.playerHpMax}` +
          `${fresh.initialPlayerHp === fresh.playerHpMax ? '（满）' : '（非满！）'} · 敌耐久 ${fresh.enemyHp}/${fresh.enemyHpMax}`,
        fresh.initialPlayerHp === fresh.playerHpMax ? COLORS.good : COLORS.warn,
      );
      line(
        `残留检查 接触=${fresh.contact} 命中=${fresh.impact} 伤害=${fresh.damage} · 步数 ${fresh.steps} · 时间 ${fresh.timeMs}ms · 存活弹丸 ${fresh.projectiles}`,
        !fresh.contact && !fresh.impact && !fresh.damage && fresh.steps === 0 && fresh.projectiles === 0
          ? COLORS.good
          : COLORS.warn,
      );
      line(
        `世界 ${fresh.arenaWidth}×${fresh.arenaHeight} · groundY ${fresh.groundY} · 出生 ${fresh.spawnAx} / ${fresh.spawnBx}（间距 ${fresh.spawnSeparation}）`,
      );
      line(`开局外廓间距 ${fresh.gapWorld.toFixed(1)}px（真实测量，非写死）`);
    }

    y += 6;
    line('实时', COLORS.text, true);
    if (!live) {
      line('（无 — 未建立战斗）', COLORS.idle);
    } else {
      line(`阶段 ${live.arenaPhase} · 步数 ${live.steps} · ${(live.timeMs / 1000).toFixed(2)}s · 存活弹丸 ${live.projectiles}`);
      line(`玩家 ${live.playerHp}/${live.playerHpMax} · 敌 ${live.enemyHp}/${live.enemyHpMax} · 外廓间距 ${live.gapWorld.toFixed(1)}px`);
      // PBL-FOUNDATION-RANGED-DISTANCE-CONTROL-R1：对手「维持作战距离」的实时档位
      line(
        live.enemyDriveBand === null
          ? '对手距离档 无（本套 Encounter 未声明 enemyDrive ⇒ 既有恒定驱动）'
          : `对手距离档 ${live.enemyDriveBand} · core 间距 ${(live.enemyDriveGap ?? 0).toFixed(0)}px` +
            `（近=${ENEMY_KEEP_DISTANCE_BANDS.near} 远=${ENEMY_KEEP_DISTANCE_BANDS.far}）`,
        live.enemyDriveBand === null ? COLORS.idle : COLORS.accent,
      );
      line(`相机 scale ${live.cameraScale.toFixed(3)}（正式 battle 相机链）`);
    }

    y += 6;
    line(`累计战果 ${this.rounds.length} 场（Reset 清空）`, COLORS.text, true);
    if (this.rounds.length === 0) {
      line('（无）', COLORS.idle);
    } else {
      for (const r of this.rounds) {
        line(
          `${r.label}(${r.encounterId}) · ${r.steps} 步 / ${(r.timeMs / 1000).toFixed(1)}s · ` +
            `玩家 ${r.playerHp}/${r.playerHpMax} · 敌 ${r.enemyHp}/${r.enemyHpMax} · winner=${r.winner ?? 'null'} · ${r.endReason ?? 'null'}`,
        );
      }
    }
  }

  private statusLine(): string {
    if (!this.runtime) return 'IDLE · 未建立战斗（弹性可重开）';
    const res = this.runtime.result;
    if (!res) return 'RUNNING · 真实物理推进中（正式编排器）';
    return `DONE · winner=${res.winner ?? 'null'} · ${res.endReason ?? 'null'}（战场冻结）`;
  }

  private syncStatus(): void {
    const p = this.phaseNow();
    this.statusEl.textContent =
      `active=${this.activeId ?? 'null'} · phase=${p} · runtime=${this.runtime ? 'live' : 'null'} · ` +
      `serial=${this.runtimeSerial} · disposed=${this.disposedCount} · resets=${this.resetCount} · rounds=${this.rounds.length}`;
    this.statusEl.dataset['active'] = this.activeId ?? 'null';
    this.statusEl.dataset['phase'] = p;
    this.statusEl.dataset['runtimeActive'] = String(this.runtime !== null);
    this.statusEl.dataset['runtimeSerial'] = String(this.runtimeSerial);
    this.statusEl.dataset['disposedCount'] = String(this.disposedCount);
    this.statusEl.dataset['resetCount'] = String(this.resetCount);
    this.statusEl.dataset['rounds'] = String(this.rounds.length);
  }

  private syncControls(): void {
    for (const [id, btn] of this.buttons) btn.classList.toggle('elab-btn-active', id === this.activeId);
    this.resetButton.disabled = this.activeId === null && this.rounds.length === 0;
  }

  /* ------------------------------------------------------------- 探针 */

  probe(): EncounterLabProbe {
    const r = this.canvas.getBoundingClientRect();
    const live = this.runtime ? this.readLive(this.runtime) : null;
    const stats = this.battleView.assetStats();
    return {
      logicalW: PORTRAIT_LOGICAL_W,
      logicalH: PORTRAIT_LOGICAL_H,
      title: ENCOUNTER_LAB_TITLE,
      lead: ENCOUNTER_LAB_LEAD,
      loadoutId: this.ctxInfo.loadoutId,
      playerLabel: this.ctxInfo.playerLabel,
      playerBodyName: this.ctxInfo.playerBodyName,
      playerHpMax: this.ctxInfo.playerHpMax,
      batch: ENCOUNTER_BATCH.map((e) => ({
        id: e.id,
        label: e.label,
        templateId: e.templateId,
        count: e.count,
        verifies: e.verifies,
      })),
      controls: [
        ...ENCOUNTER_BATCH.map((e) => ({ id: e.id as string, kind: 'encounter', label: e.label })),
        { id: 'reset', kind: 'reset', label: ENCOUNTER_LAB_RESET_LABEL },
      ],
      active: this.activeId,
      phase: this.phaseNow(),
      runtimeActive: this.runtime !== null,
      runtimeSerial: this.runtimeSerial,
      disposedCount: this.disposedCount,
      resetCount: this.resetCount,
      fresh: this.fresh ? { ...this.fresh, buildIds: [...this.fresh.buildIds] } : null,
      live,
      rounds: this.rounds.map((x) => ({ ...x })),
      screen: {
        left: r.left,
        top: r.top,
        width: r.width,
        height: r.height,
        scale: this.vp.scale,
        dpr: this.vp.dpr,
      },
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
      assets: { registered: stats.registered, ready: stats.ready, failed: stats.failed },
    };
  }
}
