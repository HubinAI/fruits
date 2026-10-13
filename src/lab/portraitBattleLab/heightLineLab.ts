/**
 * DEMO-HEIGHT-LINE-VISUAL-LAB-R1｜**车高 × 水平弹道对照台**控制器
 *（本页面**唯一**的 DOM / Canvas 层）。
 *
 * ── 它做什么（Queue 目标 / 必改 3）──────────────────────────────────────────
 *
 *     同一车身 + 同一门炮 + 同一对手（既有 `RangedTurret`），**只换轮径**
 *         → 选一套配置 = 立刻刷出一场**真实**战斗（正常速度）
 *         → 打完即停（画面冻结在终局）→ 清场 → 换下一套配置
 *
 *   页面上**没有**「谁强谁弱」的判定、没有解释框、没有特效修饰：
 *   玩家看到的就是正式 `RunBattleRuntime`（正式 Planck 编排器）里真实发生的
 *   弹道 / 命中 / 受击 / 收束，由正式 `RunBattleView`（正式 Renderer + 正式相机链）画出来。
 *
 * ── 复用面（Queue 必改 1）─────────────────────────────────────────────────
 *
 *   - `RunBattleRuntime` —— 正式 `PlanckBattleOrchestrator` 的薄适配，**零 config 覆盖**；
 *   - `RunBattleView`   —— 正式 `Renderer` + 正式 battle 相机链 + 舞台带贴图；
 *   - `playerDraft` 构造项 —— **既有**的玩家装配入口（本轮唯一新增的输入就是它）。
 *   ⇒ 不存在第二套战斗 / 第二套碰撞 / 第二套渲染。
 *
 * ⚠️ **为什么页面自己不调装配链**（如实记录边界）：Lab 目录的 import 面被 R22a 守卫
 *    冻结为显式白名单，且整目录禁止触碰 `platform/**`（唯一例外 `playerViewport`），
 *    而 `equipMovement` 必须经 `platform.storage` 读库存。⇒ 合法性证据在测试侧
 *    （同一份快照被正式装配链逐字段复现），页面只消费快照、**零存储访问**、
 *    也因此**不可能**碰到真人的存档。详见 `heightLineConfigs.ts` 头部。
 *
 * ⚠️ **本页不判定「哪套更好」**：不写 `if (wheel === 'smallWheel') 标记为优`，
 *    不显示预置结论，不放大 4px 差异（禁止用无敌 / 强制结算 / 攻击资格 / 说明文字伪造差异）。
 *
 * ⚠️ 切换语义（Queue 必改 3 / 验收 3）：`selectConfig(id)`
 *      ① `disposeRuntime()` —— 彻底释放上一场（弹丸 / 接触 / 事件订阅随对象消失）
 *      ② `new RunBattleRuntime({ playerDraft })` —— 满耐久 / 零 Run Buff / 正式 spawn
 *      ③ 在**任何一步物理推进之前**记下这一场的「开局读数」（`fresh`）
 *      ④ 真实时间步进直到出结果 → 战场冻结
 *    `clear()` = 清场（释放当前战斗、保留累计对照）；`reset()` = 清场 + 清空累计对照。
 */

import { PlayerViewportTransform } from '../../platform/playerViewport';
import { PORTRAIT_LOGICAL_H, PORTRAIT_LOGICAL_W } from './constants';
import {
  HEIGHT_LINE_ACTION_BAND,
  HEIGHT_LINE_BANDS,
  HEIGHT_LINE_BATTLE_BAND,
  HEIGHT_LINE_CONFIGS,
  HEIGHT_LINE_LAB_CLEAR_LABEL,
  HEIGHT_LINE_LAB_IDLE_HINT,
  HEIGHT_LINE_LAB_LEAD,
  HEIGHT_LINE_LAB_RESET_LABEL,
  HEIGHT_LINE_LAB_TITLE,
  HEIGHT_LINE_LOADOUT_TAG,
  HEIGHT_LINE_LOG_BAND,
  HEIGHT_LINE_OPPONENT_ID,
  HEIGHT_LINE_TOP_BAND,
  heightLineAssemblyFacts,
  heightLineCloseSupersample,
  heightLineCloseWindow,
  heightLineConfigOf,
  heightLineConfigsProblems,
  type HeightLineAssemblyFact,
  type HeightLineConfigId,
  type HeightLineCloseWindow,
} from './heightLineConfigs';
import { RUN_PAGE_H, RUN_PAGE_W, type RunRect } from './runPageLayout';
import { RunBattleRuntime } from './runBattleRuntime';
import { RunBattleView } from './runBattleView';
import { findEncounter } from './testData';

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

export type HeightLineLabPhase = 'idle' | 'running' | 'done';

/**
 * 一场战斗**刚建立**时的真实读数（在任何物理推进之前采集）。
 *
 * 这就是「切配置无残留」的判据来源：每一场都必须从这个形状开始 ——
 * 步数 0 / 时间 0 / 无存活弹丸 / 无接触·命中·伤害记录 / 满耐久 / 空 Build。
 */
export interface HeightLineFreshReading {
  /** 本场对手（运行时回读，不是把入参抄一遍）。 */
  readonly encounterId: string;
  /** 本场玩家配置 id（页面侧记录，用于对照表）。 */
  readonly configId: HeightLineConfigId;
  /** 本局 Build（本页恒为空数组 = 零 Run Buff）。 */
  readonly buildIds: readonly string[];
  readonly playerHpMax: number;
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
  readonly gapWorld: number;
  readonly arenaWidth: number;
  readonly arenaHeight: number;
  readonly groundY: number;
}

/** 当前战斗的**实时**读数（每帧刷新）。 */
export interface HeightLineLiveReading {
  readonly encounterId: string;
  readonly configId: HeightLineConfigId;
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
  readonly enemyDriveBand: 'near' | 'hold' | 'far' | null;
  readonly enemyDriveGap: number | null;
}

/** 一场跑完的战斗（用于「切配置 / 清场 / 下一配置」的对照累计）。 */
export interface HeightLineRoundRecord {
  readonly configId: HeightLineConfigId;
  readonly configLabel: string;
  readonly encounterId: string;
  readonly steps: number;
  readonly timeMs: number;
  readonly playerHp: number;
  readonly playerHpMax: number;
  readonly enemyHp: number;
  readonly enemyHpMax: number;
  readonly winner: string | null;
  readonly endReason: string | null;
}

/**
 * DEMO-HEIGHT-LINE-READABILITY-R2｜**本帧近景取景读数**（探针 / E2E 用）。
 *
 * ⚠️ 全部是**读数**：近景窗由「正式相机实时 scale/offset」+「玩家车真实世界包围盒」
 *    经纯函数 `heightLineCloseWindow()` 算出 —— 不含任何自己的镜头状态。
 *    `upscaleVsCamera` = 显示密度 / 正式相机密度，即「相对官方取景放大了几倍」。
 */
export interface HeightLineCloseReading extends HeightLineCloseWindow {
  /** 合成目标矩形（= Lab 本地战场带）。 */
  readonly dst: RunRect;
  /** 正式相机实时 scale（世界 px → 离屏画布逻辑 px）。 */
  readonly cameraScale: number;
  /** 正式相机在**本页像素密度**（`viewportScale` 归一）下的等效 scale。 */
  readonly officialCameraScale: number;
  /** 相对**本离屏画布**的放大倍数（= pxPerWorld / cameraScale）。 */
  readonly upscaleVsCamera: number;
  /**
   * 相对**正式取景**的放大倍数（= pxPerWorld / officialCameraScale）。
   *
   * 这才是「观众在页面上看到的车，比官方 Run 页面里大几倍」的答案：
   * 视口倍数只是让人看得清（不糊），真正把车放大的动作是近景裁切。
   */
  readonly upscaleVsOfficial: number;
  readonly viewportScale: number;
  readonly viewportW: number;
  readonly viewportH: number;
  /** 玩家（A 方）车体真实世界包围盒。 */
  readonly playerBox: {
    readonly minX: number;
    readonly minY: number;
    readonly maxX: number;
    readonly maxY: number;
  };
  /**
   * 本帧全部存活弹丸的只读样本（**世界坐标 + 阵营**；只读渲染快照，不写任何状态）。
   *
   * 它是「弹确实走在近景窗内、且**敌弹**从车顶上方掠过」这条验收的只读来源 ——
   * 不预测、不写死，直接读正式渲染快照；调用方把它与**同一帧**的真实像素交叉核对。
   */
  readonly projectiles: readonly {
    readonly x: number;
    readonly y: number;
    readonly team: string;
  }[];
}

export interface HeightLineLabProbe {
  readonly logicalW: number;
  readonly logicalH: number;
  readonly title: string;
  readonly lead: string;
  readonly loadoutTag: string;
  readonly opponentId: string;
  readonly opponentLabel: string;
  /** 出厂自检（必须为空数组）。 */
  readonly problems: readonly string[];
  /** 三套配置的装配事实（Energy / 轮径 / 质量 / 扭矩 —— 全部现读 registry）。 */
  readonly configs: readonly HeightLineAssemblyFact[];
  readonly controls: readonly {
    readonly id: string;
    readonly kind: string;
    readonly label: string;
  }[];
  readonly active: string | null;
  readonly phase: HeightLineLabPhase;
  readonly runtimeActive: boolean;
  readonly runtimeSerial: number;
  readonly disposedCount: number;
  readonly clearCount: number;
  readonly resetCount: number;
  readonly fresh: HeightLineFreshReading | null;
  readonly live: HeightLineLiveReading | null;
  readonly rounds: readonly HeightLineRoundRecord[];
  readonly screen: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
    readonly scale: number;
    readonly dpr: number;
  };
  readonly camera: {
    readonly scale: number;
    readonly offsetX: number;
    readonly offsetY: number;
    readonly dpr: number;
  };
  /** 正式 battle 相机实时状态（离屏画布逻辑坐标域；坐标需减 `cropX/cropY` 才落到安全区）。 */
  readonly battleCamera: {
    readonly scale: number;
    readonly offsetX: number;
    readonly offsetY: number;
    readonly cropX: number;
    readonly cropY: number;
  };
  /** 本帧近景取景读数（未建立战斗 = `null`）。 */
  readonly closeUp: HeightLineCloseReading | null;
  readonly canvas: {
    readonly backingW: number;
    readonly backingH: number;
    readonly cssW: number;
    readonly cssH: number;
  };
  readonly assets: { readonly registered: number; readonly ready: number; readonly failed: readonly string[] };
}

export class HeightLineLab {
  private readonly root: HTMLElement;
  private readonly barEl: HTMLDivElement;
  private readonly stageWrap: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly statusEl: HTMLDivElement;
  private readonly buttons = new Map<HeightLineConfigId, HTMLButtonElement>();
  private readonly clearButton: HTMLButtonElement;
  private readonly resetButton: HTMLButtonElement;
  private readonly problems: readonly string[];
  private readonly facts: readonly HeightLineAssemblyFact[];

  /**
   * 离屏视口放大倍数（按设备 DPR 反比压回；见 `heightLineCloseSupersample`）。
   *
   * ⚠️ 它只让**官方画面被栅格化得更密**，不改任何镜头算法 —— 这是「看清 3.7 世界像素」
   *    的前提：低清中间图会把这条差异先降采样糊掉，再放大就只剩一团渐变。
   */
  private readonly viewportScale = heightLineCloseSupersample(
    typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1,
  );
  private readonly vp = new PlayerViewportTransform(PORTRAIT_LOGICAL_W, PORTRAIT_LOGICAL_H);
  /** 近景取景宿主：与另四个 Lab 页面**同一个** `RunBattleView`，只多给一个视口放大倍数。 */
  private readonly battleView = new RunBattleView(document, { viewportScale: this.viewportScale });
  /** 本帧近景窗（`draw()` 每帧重算；未建立战斗 = `null`）。 */
  private closeUpWindow: HeightLineCloseWindow | null = null;

  /** 当前这一场的运行时。**同一时刻只允许存在一个** —— 切换 / 清场一律先 dispose。 */
  private runtime: RunBattleRuntime | null = null;
  private activeId: HeightLineConfigId | null = null;
  private fresh: HeightLineFreshReading | null = null;
  private runtimeSerial = 0;
  private disposedCount = 0;
  private clearCount = 0;
  private resetCount = 0;
  private readonly rounds: HeightLineRoundRecord[] = [];

  private rafHandle = 0;
  private lastFrameMs = 0;
  private resizeObserver: ResizeObserver | null = null;
  private readonly onWindowResize = (): void => this.render();

  constructor(root: HTMLElement) {
    this.root = root;
    this.problems = heightLineConfigsProblems();
    this.facts = heightLineAssemblyFacts();
    this.barEl = document.createElement('div');
    this.barEl.className = 'hlab-bar';
    this.stageWrap = document.createElement('div');
    this.stageWrap.className = 'hlab-stage';
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'hlab-canvas';
    this.ctx = this.canvas.getContext('2d');
    this.statusEl = document.createElement('div');
    this.statusEl.className = 'hlab-status';

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'hlab-btn hlab-btn-clear';
    clear.textContent = HEIGHT_LINE_LAB_CLEAR_LABEL;
    clear.dataset['hlabControl'] = 'clear';
    clear.dataset['hlabId'] = 'clear';
    clear.onclick = () => this.clear();
    this.clearButton = clear;

    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'hlab-btn hlab-btn-reset';
    reset.textContent = HEIGHT_LINE_LAB_RESET_LABEL;
    reset.dataset['hlabControl'] = 'reset';
    reset.dataset['hlabId'] = 'reset';
    reset.onclick = () => this.reset();
    this.resetButton = reset;

    this.buildDom();
    this.observeResize();
    this.battleView.onAssetsReady(() => this.render());
    this.render();
  }

  /* ---------------------------------------------------------------- DOM */

  private buildDom(): void {
    this.root.replaceChildren();
    this.root.classList.add('hlab-root');

    for (const cfg of HEIGHT_LINE_CONFIGS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'hlab-btn';
      b.textContent = cfg.label;
      b.title = `${cfg.id} · ${cfg.wheelDefId}`;
      b.dataset['hlabControl'] = 'config';
      b.dataset['hlabId'] = cfg.id;
      b.onclick = () => this.selectConfig(cfg.id);
      this.buttons.set(cfg.id, b);
      this.barEl.appendChild(b);
    }
    this.barEl.appendChild(this.clearButton);
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

  /* --------------------------------------------------- 切配置 / 清场 */

  /**
   * 选一套配置 → 立刻刷出一场真实战斗（Queue 必改 3 的操作流第一步）。
   *
   * 顺序是硬性的：**先彻底清空上一场**，再新建 —— 结构上不可能出现两场共存，
   * 也不可能让上一场的弹丸 / 接触 / 事件订阅活到下一场。
   *
   * ⚠️ 同一套配置在**战斗中**重复点 = 幂等（不打断）；在**已结束**后重点 = 再跑一场
   *    （同一条件的复跑能力，用于反复观察同一段弹道）。
   */
  selectConfig(id: string): void {
    const cfg = heightLineConfigOf(id);
    if (!cfg) return; // 不在配置表内 → 什么都不做（不静默换成别的配置）
    if (this.activeId === cfg.id && this.runtime !== null && this.runtime.result === null) return;

    this.disposeRuntime();
    this.activeId = cfg.id;

    // 满耐久（不传 carriedHp）/ 零 Run Buff（build: []）/ 正式 spawn（不改 config）。
    // playerBaseline = 正式 Run 玩家侧那门炮的基线（runPage.beginBattle 传的就是它）。
    const rt = new RunBattleRuntime({
      build: [],
      carriedHp: null,
      encounterId: HEIGHT_LINE_OPPONENT_ID,
      playerDraft: cfg.draft,
      playerLoadoutTag: HEIGHT_LINE_LOADOUT_TAG,
      playerBaseline: true,
    });
    this.runtime = rt;
    this.runtimeSerial += 1;
    // ⚠️ 开局读数必须在**任何物理推进之前**采集（见文件头说明）
    this.fresh = this.readFresh(rt, cfg.id);
    this.startLoop();
    this.render();
  }

  /** 清场：释放当前战斗（保留累计对照表）。 */
  clear(): void {
    this.stopLoop();
    this.disposeRuntime();
    this.activeId = null;
    this.fresh = null;
    this.clearCount += 1;
    this.render();
  }

  /** Reset：清场 + 清空累计对照。 */
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

  private readFresh(rt: RunBattleRuntime, configId: HeightLineConfigId): HeightLineFreshReading {
    const hp = rt.hp();
    const cr = rt.contactResidue();
    return {
      encounterId: rt.encounterId,
      configId,
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

  private readLive(rt: RunBattleRuntime, configId: HeightLineConfigId): HeightLineLiveReading {
    const hp = rt.hp();
    const cr = rt.contactResidue();
    const drive = rt.enemyDriveState();
    return {
      encounterId: rt.encounterId,
      configId,
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

  private phaseNow(): HeightLineLabPhase {
    if (!this.runtime) return 'idle';
    return this.runtime.result === null ? 'running' : 'done';
  }

  /**
   * DEMO-HEIGHT-LINE-READABILITY-R2｜本帧近景窗 = 「正式相机读数 + 玩家车真实世界包围盒」
   * 经**纯函数**换算出「离屏画布上的哪个子矩形铺满战场带」。
   *
   * ⚠️ 不写任何相机状态、不新建相机：`render()` 仍由正式 `reframe` + 逐帧跟随决定；
   *    本方法只做**裁切合成**的前半段（算出源矩形）。
   */
  private computeCloseUpWindow(rt: RunBattleRuntime): HeightLineCloseWindow {
    const t = this.battleView.viewTransform();
    const size = this.battleView.viewportSize();
    const box = rt.vehicleBox('A');
    return heightLineCloseWindow({
      roofWorldY: box.minY,
      anchorWorldX: rt.vehicleX('A'),
      scale: t.scale,
      offsetX: t.offsetX,
      offsetY: t.offsetY,
      viewportW: size.w,
      viewportH: size.h,
    });
  }

  /**
   * 近景取景读数（探针 / E2E 用）：把 `draw()` 算出的窗、本帧正式相机读数、
   * 玩家车真实包围盒、以及**本帧全部存活弹丸（世界坐标 + 阵营）**打包。
   *
   * ⚠️ `projectiles` 是「弹确实走在近景窗内、且**敌弹**从车顶上方掠过」这条验收的
   *    **只读来源** —— 不预测、不写死，直接读正式渲染快照；E2E 会在**同一帧**里
   *    再用真实像素交叉核对，避免只读快照自证。
   */
  private readCloseUp(): HeightLineCloseReading | null {
    const win = this.closeUpWindow;
    const rt = this.runtime;
    if (!win || !rt) return null;
    const t = this.battleView.viewTransform();
    const size = this.battleView.viewportSize();
    const box = rt.vehicleBox('A');
    // 视口按 `viewportScale` 等比放大 ⇒ 安全区同比 ⇒ 正式相机 scale 同比
    // ⇒ 除以 `viewportScale` 就是「同一算法在正式 390×302 视口下会得到多少」。
    const officialCameraScale = t.scale / this.viewportScale;
    return {
      ...win,
      dst: { ...HEIGHT_LINE_BATTLE_BAND },
      cameraScale: t.scale,
      officialCameraScale,
      upscaleVsCamera: t.scale > 0 ? win.pxPerWorld / t.scale : 0,
      upscaleVsOfficial: officialCameraScale > 0 ? win.pxPerWorld / officialCameraScale : 0,
      viewportScale: this.viewportScale,
      viewportW: size.w,
      viewportH: size.h,
      playerBox: { minX: box.minX, minY: box.minY, maxX: box.maxX, maxY: box.maxY },
      projectiles: (rt.snapshot().projectiles ?? []).map((p) => ({
        x: p.center.x,
        y: p.center.y,
        team: p.team,
      })),
    };
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
        const cfg = heightLineConfigOf(this.activeId ?? '');
        this.rounds.push({
          configId: cfg?.id ?? 'mango-small',
          configLabel: cfg?.label ?? (this.activeId ?? '—'),
          encounterId: rt.encounterId,
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
    this.vp.applyTo(this.canvas);
    const ctx = this.ctx;
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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

    ctx.fillStyle = COLORS.pageBg;
    ctx.fillRect(0, 0, RUN_PAGE_W, RUN_PAGE_H);
    ctx.fillStyle = COLORS.topBandBg;
    ctx.fillRect(HEIGHT_LINE_TOP_BAND.x, HEIGHT_LINE_TOP_BAND.y, HEIGHT_LINE_TOP_BAND.w, HEIGHT_LINE_TOP_BAND.h);
    ctx.fillStyle = COLORS.stageBg;
    ctx.fillRect(
      HEIGHT_LINE_BATTLE_BAND.x,
      HEIGHT_LINE_BATTLE_BAND.y,
      HEIGHT_LINE_BATTLE_BAND.w,
      HEIGHT_LINE_BATTLE_BAND.h,
    );
    ctx.fillStyle = COLORS.logBandBg;
    ctx.fillRect(HEIGHT_LINE_LOG_BAND.x, HEIGHT_LINE_LOG_BAND.y, HEIGHT_LINE_LOG_BAND.w, HEIGHT_LINE_LOG_BAND.h);
    ctx.fillStyle = COLORS.actionBandBg;
    ctx.fillRect(
      HEIGHT_LINE_ACTION_BAND.x,
      HEIGHT_LINE_ACTION_BAND.y,
      HEIGHT_LINE_ACTION_BAND.w,
      HEIGHT_LINE_ACTION_BAND.h,
    );

    // 中部战场：真实战斗世界（正式 Renderer + 正式相机），**近景裁切**后铺满战场带。
    const rt = this.runtime;
    if (rt && this.activeId) {
      this.battleView.render(rt);
      this.closeUpWindow = this.computeCloseUpWindow(rt);
      this.battleView.blitRegion(
        ctx,
        {
          x: this.closeUpWindow.srcX,
          y: this.closeUpWindow.srcY,
          w: this.closeUpWindow.srcW,
          h: this.closeUpWindow.srcH,
        },
        HEIGHT_LINE_BATTLE_BAND,
      );
    } else {
      this.closeUpWindow = null;
      ctx.fillStyle = COLORS.idle;
      ctx.font = `bold 20px ${FONT_STACK}`;
      ctx.textAlign = 'center';
      ctx.fillText(
        HEIGHT_LINE_LAB_IDLE_HINT,
        HEIGHT_LINE_BATTLE_BAND.w / 2,
        HEIGHT_LINE_BATTLE_BAND.y + HEIGHT_LINE_BATTLE_BAND.h / 2,
      );
      ctx.textAlign = 'left';
    }

    ctx.fillStyle = COLORS.divider;
    for (const band of HEIGHT_LINE_BANDS.slice(1)) ctx.fillRect(band.x, band.y, band.w, 1);

    // 顶部带
    ctx.fillStyle = COLORS.text;
    ctx.font = `bold 17px ${FONT_STACK}`;
    ctx.fillText(HEIGHT_LINE_LAB_TITLE, 14, 23);
    ctx.fillStyle = COLORS.dim;
    ctx.font = `12px ${FONT_STACK}`;
    ctx.fillText(HEIGHT_LINE_LAB_LEAD, 14, 40);

    const cfg = heightLineConfigOf(this.activeId ?? '');
    const fact = cfg ? this.facts.find((f) => f.id === cfg.id) : null;
    if (cfg && fact) {
      ctx.fillStyle = COLORS.accent;
      ctx.font = `12px ${FONT_STACK}`;
      ctx.fillText(`${cfg.label}（${cfg.wheelDefId} r${fact.wheelRadius}）`, 14, 58);
      ctx.fillStyle = COLORS.dim;
      ctx.font = `11px ${FONT_STACK}`;
      ctx.fillText(
        `${fact.bodyName}+${fact.weaponName} · Energy ${fact.energyUsed}/${fact.energyCapacity} · 轮质量 ${fact.wheelMass} · 扭矩 ${fact.driveTorque}`,
        14,
        72,
      );
    } else {
      ctx.fillStyle = COLORS.idle;
      ctx.font = `12px ${FONT_STACK}`;
      ctx.fillText('未选配置', 14, 58);
    }

    this.drawLog(ctx);

    ctx.fillStyle = COLORS.dim;
    ctx.font = `13px ${FONT_STACK}`;
    ctx.fillText(this.statusLine(), 14, HEIGHT_LINE_ACTION_BAND.y + 30);
  }

  private drawLog(ctx: CanvasRenderingContext2D): void {
    const x = 14;
    let y = HEIGHT_LINE_LOG_BAND.y + 26;
    const line = (text: string, color: string = COLORS.dim, bold = false): void => {
      ctx.fillStyle = color;
      ctx.font = `${bold ? 'bold ' : ''}12px ${FONT_STACK}`;
      ctx.fillText(text, x, y);
      y += 18;
    };

    if (this.problems.length > 0) {
      line('配置自检未通过（页面不可信）', COLORS.warn, true);
      for (const p of this.problems) line(`· ${p}`, COLORS.warn);
      y += 6;
    }

    const fresh = this.fresh;
    const live = this.runtime && this.activeId ? this.readLive(this.runtime, this.activeId) : null;

    line('本场开局读数（物理推进之前）', COLORS.text, true);
    if (!fresh) {
      line('（无 — 清场后未建立战斗）', COLORS.idle);
    } else {
      const clean =
        !fresh.contact && !fresh.impact && !fresh.damage && fresh.steps === 0 && fresh.projectiles === 0;
      line(`对手 ${fresh.encounterId} · 配置 ${fresh.configId} · Build ${fresh.buildIds.length === 0 ? '[] （零 Run Buff）' : `[${fresh.buildIds.join(', ')}]`}`);
      line(
        `耐久 ${fresh.initialPlayerHp}/${fresh.playerHpMax}` +
          `${fresh.initialPlayerHp === fresh.playerHpMax ? '（满）' : '（非满！）'} · 敌耐久 ${fresh.enemyHp}/${fresh.enemyHpMax}`,
        fresh.initialPlayerHp === fresh.playerHpMax ? COLORS.good : COLORS.warn,
      );
      line(
        `残留检查 接触=${fresh.contact} 命中=${fresh.impact} 伤害=${fresh.damage} · 步数 ${fresh.steps} · 时间 ${fresh.timeMs}ms · 存活弹丸 ${fresh.projectiles}`,
        clean ? COLORS.good : COLORS.warn,
      );
      line(`开局外廓间距 ${fresh.gapWorld.toFixed(1)}px（真实测量，非写死）`);
    }

    y += 6;
    line('实时', COLORS.text, true);
    if (!live) {
      line('（无 — 未建立战斗）', COLORS.idle);
    } else {
      line(`阶段 ${live.arenaPhase} · 步数 ${live.steps} · ${(live.timeMs / 1000).toFixed(2)}s · 存活弹丸 ${live.projectiles}`);
      line(`玩家 ${live.playerHp.toFixed(0)}/${live.playerHpMax} · 敌 ${live.enemyHp.toFixed(0)}/${live.enemyHpMax} · 外廓间距 ${live.gapWorld.toFixed(1)}px`);
    }

    y += 6;
    line(`累计对照 ${this.rounds.length} 场（清场保留 / Reset 清空）`, COLORS.text, true);
    if (this.rounds.length === 0) {
      line('（无）', COLORS.idle);
    } else {
      for (const r of this.rounds) {
        line(
          `${r.configLabel} · ${(r.timeMs / 1000).toFixed(2)}s · 玩家 ${r.playerHp.toFixed(0)}/${r.playerHpMax}` +
            ` · 敌 ${r.enemyHp.toFixed(0)}/${r.enemyHpMax} · winner=${r.winner ?? 'null'}`,
        );
      }
    }
  }

  private statusLine(): string {
    if (!this.runtime) return 'IDLE · 未建立战斗（弹性可重开）';
    const res = this.runtime.result;
    if (!res) return 'RUNNING · 真实物理推进中（正式编排器 · 正常速度）';
    return `DONE · winner=${res.winner ?? 'null'} · ${res.endReason ?? 'null'}（战场冻结）`;
  }

  private syncStatus(): void {
    const p = this.phaseNow();
    this.statusEl.textContent =
      `active=${this.activeId ?? 'null'} · phase=${p} · runtime=${this.runtime ? 'live' : 'null'} · ` +
      `serial=${this.runtimeSerial} · disposed=${this.disposedCount} · cleared=${this.clearCount} · ` +
      `resets=${this.resetCount} · rounds=${this.rounds.length}`;
    this.statusEl.dataset['active'] = this.activeId ?? 'null';
    this.statusEl.dataset['phase'] = p;
    this.statusEl.dataset['runtimeActive'] = String(this.runtime !== null);
    this.statusEl.dataset['runtimeSerial'] = String(this.runtimeSerial);
    this.statusEl.dataset['disposedCount'] = String(this.disposedCount);
    this.statusEl.dataset['clearCount'] = String(this.clearCount);
    this.statusEl.dataset['resetCount'] = String(this.resetCount);
    this.statusEl.dataset['rounds'] = String(this.rounds.length);
  }

  private syncControls(): void {
    for (const [id, btn] of this.buttons) btn.classList.toggle('hlab-btn-active', id === this.activeId);
    this.clearButton.disabled = this.activeId === null;
    this.resetButton.disabled = this.activeId === null && this.rounds.length === 0;
  }

  /* ------------------------------------------------------------- 探针 */

  probe(): HeightLineLabProbe {
    const r = this.canvas.getBoundingClientRect();
    const live = this.runtime && this.activeId ? this.readLive(this.runtime, this.activeId) : null;
    const stats = this.battleView.assetStats();
    const cam = this.battleView.viewTransform();
    return {
      logicalW: PORTRAIT_LOGICAL_W,
      logicalH: PORTRAIT_LOGICAL_H,
      title: HEIGHT_LINE_LAB_TITLE,
      lead: HEIGHT_LINE_LAB_LEAD,
      loadoutTag: HEIGHT_LINE_LOADOUT_TAG,
      opponentId: HEIGHT_LINE_OPPONENT_ID,
      opponentLabel: findEncounter(HEIGHT_LINE_OPPONENT_ID)?.label ?? HEIGHT_LINE_OPPONENT_ID,
      problems: [...this.problems],
      configs: this.facts.map((f) => ({ ...f })),
      controls: [
        ...HEIGHT_LINE_CONFIGS.map((c) => ({
          id: c.id as string,
          kind: 'config',
          label: c.label,
        })),
        { id: 'clear', kind: 'clear', label: HEIGHT_LINE_LAB_CLEAR_LABEL },
        { id: 'reset', kind: 'reset', label: HEIGHT_LINE_LAB_RESET_LABEL },
      ],
      active: this.activeId,
      phase: this.phaseNow(),
      runtimeActive: this.runtime !== null,
      runtimeSerial: this.runtimeSerial,
      disposedCount: this.disposedCount,
      clearCount: this.clearCount,
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
      battleCamera: {
        scale: cam.scale,
        offsetX: cam.offsetX,
        offsetY: cam.offsetY,
        cropX: cam.cropX,
        cropY: cam.cropY,
      },
      closeUp: this.readCloseUp(),
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
