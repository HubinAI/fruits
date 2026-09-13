/**
 * PRP-F0-RUN-PAGE-SHELL｜PRP-R3-CAPYBARA-UI-HIERARCHY-REBUILD
 * ｜PRP-F1-PORTRAIT-PLANCK-BATTLE-INTEGRATION
 * Portrait Run Prototype —— Run Page targeted 测试（纯 node，无 DOM）。
 *
 * 覆盖六层：
 *   A) 页面层级：竖屏 390×844 四条横带无缝无叠；PRP-R3 比例（顶 80 / 台 302 / 志 378 / 作 84）；
 *   B) 五状态机与固定演示流程：IDLE → EVENT → BATTLE → RESULT → CHOICE → IDLE（同一页面内）；
 *      ⚠️ PRP-F1：BATTLE 由**真实物理**推进（`RunBattleRuntime` → 正式 `PlanckBattleOrchestrator`），
 *      不再有 `RUN_BATTLE_SCRIPT` —— 本文件用与宿主同一条链（step → sync → finish）驱动。
 *   C) 中部舞台：IDLE 待机近景（PRP 构图）vs 真实战斗世界（正式世界尺度 + 固定远摄相机）；
 *   D) 面积账本：逐帧整页像素面积**精确冻结**（浏览器端再用真实 getImageData 交叉核对）；
 *   E) 源码守卫：Debug 与玩家界面分离、只经 runBattleRuntime 接正式战斗、不存在任何页面跳转；
 *   F) 信息层级：顶部无空槽 / IDLE 战斗主体是真实车辆 sprite / 日志是玩家叙事 / CHOICE 独占焦点。
 *
 * 面积期望值是**冻结字面量**（不是就地重算）：任何布局改动都必须显式更新这里，
 * 从而让「像素确实变了」这件事无法悄悄发生（与 F1-R22 同一约定）。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { PORTRAIT_LOGICAL_H, PORTRAIT_LOGICAL_W } from '../src/lab/portraitBattleLab/constants';
import { buildSpawnPlan } from '../src/lab/portraitBattleLab/entities';
import { registry } from '../src/core/content';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import { OPPONENT_TEMPLATES } from '../src/player/opponentPool';
import { LAB_ENCOUNTERS, LAB_LOADOUTS } from '../src/lab/portraitBattleLab/testData';
import {
  RUN_ACTION_BAND,
  RUN_BANDS,
  RUN_BUFF_ICON_MAX,
  RUN_CHOICE,
  RUN_LOG,
  RUN_LOG_BAND,
  RUN_LOG_LABEL_POS,
  RUN_PAGE_H,
  RUN_PAGE_W,
  RUN_SIDE_VIEW,
  RUN_STAGE_BAND,
  RUN_STAGE_HAZE_H,
  RUN_TOP_BAND,
  runActionBarRect,
  runActionButtonRect,
  runBuffIconRects,
  runChoiceBarRect,
  runChoiceCardRects,
  runChoiceIconRect,
  runChoiceMaskRect,
  runChoiceTextX,
  runChoiceTitlePos,
  runDayNodes,
  runLogBottomY,
  runLogLineRects,
  runLogTopY,
  runPaintedAreas,
  runStageHills,
  runRectsOverlap,
  runSideViewScale,
  runStageBaselineY,
  runStageGroundRect,
  runStageGroundY,
  runStageRoadRect,
  type RunLayeredRect,
  type RunRect,
} from '../src/lab/portraitBattleLab/runPageLayout';
import {
  RUN_CHOICE_OPTIONS,
  RUN_INITIAL_DAY,
  RUN_MAX_BATTLES,
  RUN_MAX_CHOICES,
  RUN_PHASES,
  RUN_RESTART_LABEL,
  RUN_TOTAL_DAYS,
  chooseRunBuff,
  createRunPageState,
  durabilityPercent,
  finishRunBattle,
  formatRunLog,
  pressRunAction,
  runActionEnabled,
  runActionLabel,
  runBuildIds,
  runCarriedPlayerHp,
  runChoiceOpen,
  runChoicePool,
  runFailed,
  runStartsNewRun,
  runVerificationComplete,
  syncRunBattle,
  visibleRunLog,
  type RunPageContext,
  type RunPageState,
} from '../src/lab/portraitBattleLab/runPageState';
import {
  EMERGENCY_REPAIR_FRACTION,
  RUN_LAYER1_POOL,
  RUN_LAYER2_POOLS,
  runModifierById,
} from '../src/lab/portraitBattleLab/runModifiers';
import {
  RUN_DEMO_ENCOUNTER_ID,
  RUN_DEMO_LOADOUT_ID,
  buildRunStageView,
  entityVisualWidth,
  hasPlaceholderVisual,
  runDemoPlan,
  runPageContext,
  runPageLayerShapes,
} from '../src/lab/portraitBattleLab/runPageScene';
import {
  RUN_BATTLE_VIEW_H,
  RUN_BATTLE_VIEW_INSET,
  RUN_BATTLE_VIEW_W,
  RunBattleRuntime,
} from '../src/lab/portraitBattleLab/runBattleRuntime';
import { RUN_VISUAL_ASSETS } from '../src/lab/portraitBattleLab/runVehicleAssets';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const LAB_DIR = join(REPO_ROOT, 'src', 'lab', 'portraitBattleLab');
const RUN_PAGE_FILES = [
  'runPageLayout.ts',
  'runPageState.ts',
  'runPageScene.ts',
  'runPage.ts',
  'runMain.ts',
  'runVehicleAssets.ts',
  'runBattleRuntime.ts',
  'runBattleView.ts',
];

function read(f: string): string {
  return readFileSync(join(LAB_DIR, f), 'utf8');
}

/** 剥注释后再做源码匹配（守卫必须扛得住「注释里写了禁用词」的自指陷阱）。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function inside(r: RunRect, band: RunRect): boolean {
  return r.x >= band.x && r.y >= band.y && r.x + r.w <= band.x + band.w && r.y + r.h <= band.y + band.h;
}

/** 逐帧账本（渲染与测试共用的同一入口）。 */
function ledger(s: RunPageState): Record<string, number> {
  return runPaintedAreas(runPageLayerShapes(s, buildRunStageView()));
}

function layersOf(s: RunPageState): readonly RunLayeredRect[] {
  return runPageLayerShapes(s, buildRunStageView());
}

const CTX: RunPageContext = runPageContext();

/* ---------------------------------------- 真实战斗驱动器（与宿主同一条链） */

const FRAME_MS = 1000 / 60;
/** 上限远大于实测结束时间（15.4s ≈ 920 帧）：只用于防止死循环，不参与断言。 */
const MAX_FRAMES = 4000;

/** 推进 `frames` 帧真实物理，并同步 HP / 步数（**日志零追加**，与宿主一致）。 */
function driveFrames(s: RunPageState, rt: RunBattleRuntime, frames: number): RunPageState {
  let cur = s;
  for (let i = 0; i < frames && cur.phase === 'BATTLE'; i++) {
    rt.step(FRAME_MS);
    const hp = rt.hp();
    cur = syncRunBattle(cur, { playerHp: hp.a, enemyHp: hp.b, steps: rt.stepCount });
    const r = rt.result;
    if (r) {
      cur = finishRunBattle(cur, {
        winner: r.winner ?? null,
        endReason: r.endReason ?? null,
        playerHp: hp.a,
        enemyHp: hp.b,
        steps: rt.stepCount,
      });
    }
  }
  return cur;
}

/** 推进到官方出结果（或触顶）。 */
function driveToEnd(s: RunPageState, rt: RunBattleRuntime): RunPageState {
  return driveFrames(s, rt, MAX_FRAMES);
}

interface Flow {
  readonly steps: RunPageState[];
  readonly finale: RunPageState;
  readonly runtime: RunBattleRuntime;
}

let flowCache: Flow | null = null;

/** 走完整条固定演示流程（真实物理，可能较慢 → 只跑一次并缓存；状态不可变，可安全共享）。 */
function runFullFlow(): Flow {
  if (flowCache) return flowCache;
  const runtime = new RunBattleRuntime(false);
  let s = createRunPageState(CTX);
  const steps: RunPageState[] = [s]; // IDLE
  s = pressRunAction(s, CTX);
  steps.push(s); // EVENT
  s = pressRunAction(s, CTX);
  steps.push(s); // BATTLE
  s = driveToEnd(s, runtime);
  steps.push(s); // RESULT
  s = pressRunAction(s, CTX);
  steps.push(s); // CHOICE
  s = chooseRunBuff(s, RUN_CHOICE_OPTIONS[0].id);
  steps.push(s); // IDLE
  flowCache = { steps, finale: s, runtime };
  return flowCache;
}

/** 建立战斗（EVENT → BATTLE）并返回新的运行时 + 状态。 */
function startBattle(): { rt: RunBattleRuntime; bt: RunPageState } {
  const rt = new RunBattleRuntime(false);
  const bt = pressRunAction(pressRunAction(createRunPageState(CTX), CTX), CTX);
  return { rt, bt };
}

/** 走到 RESULT（真实战斗已打完）。 */
function reachResult(): RunPageState {
  const { rt, bt } = startBattle();
  return driveToEnd(bt, rt);
}

/** 走到 CHOICE（改装机会浮层已打开）。 */
function reachChoice(): RunPageState {
  return pressRunAction(reachResult(), CTX);
}

/* ======================================================= A. 页面层级 */

describe('PRP-F0｜A 页面层级：竖屏 390×844 四条横带', () => {
  it('RP-01 逻辑基准 390×844；四带自上而下无缝无叠、合计正好铺满', () => {
    expect(RUN_PAGE_W).toBe(PORTRAIT_LOGICAL_W);
    expect(RUN_PAGE_H).toBe(PORTRAIT_LOGICAL_H);
    expect(RUN_PAGE_W).toBe(390);
    expect(RUN_PAGE_H).toBe(844);
    expect(RUN_PAGE_W).toBeLessThan(RUN_PAGE_H); // 竖屏

    expect(RUN_BANDS.length).toBe(4);
    let cursor = 0;
    for (const band of RUN_BANDS) {
      expect(band.x).toBe(0);
      expect(band.w).toBe(RUN_PAGE_W);
      expect(band.y).toBe(cursor); // 上一条的底边 = 下一条的顶边（无缝隙）
      cursor += band.h;
    }
    expect(cursor).toBe(RUN_PAGE_H); // 合计正好铺满（无溢出）
    for (let i = 0; i < RUN_BANDS.length; i++) {
      for (let j = i + 1; j < RUN_BANDS.length; j++) {
        expect(runRectsOverlap(RUN_BANDS[i], RUN_BANDS[j])).toBe(false);
      }
    }
    // 顶部必须是「薄层」：不超过总高的 12%
    expect(RUN_TOP_BAND.h).toBeLessThanOrEqual(Math.round(RUN_PAGE_H * 0.12));
  });

  it('RP-01b PRP-R3 必改 1/2/3：四带比例同时落在「绝对像素」与「百分比」两个区间', () => {
    const pct = (h: number): number => (h / RUN_PAGE_H) * 100;
    const px = RUN_BANDS.map((b) => b.h);
    const ratio = RUN_BANDS.map((b) => pct(b.h));
    const [topPx, stagePx, logPx, actionPx] = px;
    const [topPct, stagePct, logPct, actionPct] = ratio;

    // 百分比区间（Queue：顶 8~10 / 台 33~36 / 志 40~45 / 作 8~10）
    expect(topPct).toBeGreaterThanOrEqual(8);
    expect(topPct).toBeLessThanOrEqual(10);
    expect(stagePct).toBeGreaterThanOrEqual(33);
    expect(stagePct).toBeLessThanOrEqual(36);
    expect(logPct).toBeGreaterThanOrEqual(40);
    expect(logPct).toBeLessThanOrEqual(45);
    expect(actionPct).toBeGreaterThanOrEqual(8);
    expect(actionPct).toBeLessThanOrEqual(10);

    // 绝对像素区间（Queue：顶 70~80 / 台 280~310 / 志 约370 / 作 80~90）
    expect(topPx).toBeGreaterThanOrEqual(70);
    expect(topPx).toBeLessThanOrEqual(80);
    expect(stagePx).toBeGreaterThanOrEqual(280);
    expect(stagePx).toBeLessThanOrEqual(310);
    expect(logPx).toBeGreaterThanOrEqual(365);
    expect(logPx).toBeLessThanOrEqual(385);
    expect(actionPx).toBeGreaterThanOrEqual(80);
    expect(actionPx).toBeLessThanOrEqual(90);

    // 冻结字面量（现值）
    expect(px).toEqual([80, 302, 378, 84]);
    expect(RUN_STAGE_BAND.h).toBe(RUN_PAGE_H - topPx - logPx - actionPx);

    // 顶部薄层必须装得下「DAY 行 + 已获得图标行」（图标底边不得越入舞台带）
    for (const icon of runBuffIconRects(RUN_BUFF_ICON_MAX)) expect(inside(icon, RUN_TOP_BAND)).toBe(true);
    for (const n of runDayNodes(RUN_TOTAL_DAYS)) expect(inside(n, RUN_TOP_BAND)).toBe(true);
  });

  it('RP-02 顶部薄层：DAY 进度一行 + 已获得强化一行（右对齐节点 / 左对齐图标，互不重叠）', () => {
    const nodes = runDayNodes(RUN_TOTAL_DAYS);
    expect(nodes.length).toBe(7);
    for (const n of nodes) expect(inside(n, RUN_TOP_BAND)).toBe(true);
    for (let i = 1; i < nodes.length; i++) expect(nodes[i].x).toBeGreaterThan(nodes[i - 1].x + nodes[i - 1].w);
    // 右对齐
    expect(nodes[nodes.length - 1].x + nodes[nodes.length - 1].w).toBe(RUN_PAGE_W - 16);

    const icons = runBuffIconRects(RUN_BUFF_ICON_MAX);
    expect(icons.length).toBe(RUN_BUFF_ICON_MAX);
    for (const s of icons) expect(inside(s, RUN_TOP_BAND)).toBe(true);
    for (let i = 1; i < icons.length; i++) expect(icons[i].x).toBeGreaterThan(icons[i - 1].x + icons[i - 1].w);
    expect(icons[0].x).toBe(16); // 左对齐
    // 两行分明：进度节点行与图标行不重叠（薄层里两行互不干扰）
    for (const n of nodes) for (const s of icons) expect(runRectsOverlap(n, s)).toBe(false);
    // 图标行本身不承载文字 → 整块是纯色（可精确入账）
    expect(icons.length * icons[0].w * icons[0].h).toBe(5 * 30 * 30);
  });

  it('RP-03 IDLE 待机近景：地线 / 路面落在舞台带内、车贴基线、近景只有玩家一辆', () => {
    const view = buildRunStageView();
    expect(view.groundY).toBe(runStageGroundY());
    expect(view.baselineY).toBe(runStageBaselineY());
    expect(view.baselineY).toBe(view.groundY - RUN_SIDE_VIEW.baselineLiftPx);
    expect(view.groundY).toBeGreaterThan(RUN_STAGE_BAND.y);
    expect(view.groundY).toBeLessThan(RUN_STAGE_BAND.y + RUN_STAGE_BAND.h);
    // 必改 2：地面不压在战斗区最底边（底下要留出路面）
    expect(RUN_STAGE_BAND.y + RUN_STAGE_BAND.h - view.groundY).toBeGreaterThanOrEqual(40);
    expect(view.ground).toEqual(runStageGroundRect());
    expect(view.road).toEqual(runStageRoadRect());
    expect(inside(view.ground, RUN_STAGE_BAND)).toBe(true);
    expect(inside(view.road, RUN_STAGE_BAND)).toBe(true);

    // 玩家：左边缘 = 舞台左边距
    expect(view.player.bounds.x).toBe(RUN_STAGE_BAND.x + RUN_SIDE_VIEW.marginPx);
    // 贴地（底边 = 基线，压在基线上方 2px，不污染路面纯色）
    expect(view.player.bounds.y).toBe(view.baselineY - view.player.bounds.h);
    expect(runRectsOverlap(view.player.bounds, view.ground)).toBe(false);
    expect(runRectsOverlap(view.player.bounds, view.road)).toBe(false);
    // 全部可视件落在舞台带内（不得越出玩家可见区）
    for (const v of view.player.visuals) expect(inside(v.rect, RUN_STAGE_BAND)).toBe(true);
  });

  it('RP-04 下部冒险记录：标题与全部行都在日志带内，且不越过最底动作区', () => {
    // 标签（区块名）在第一条可见行上方
    expect(RUN_LOG_LABEL_POS.y).toBeLessThan(runLogTopY(RUN_LOG.maxLines));
    expect(inside({ x: RUN_LOG_LABEL_POS.x, y: RUN_LOG_LABEL_POS.y - 12, w: 60, h: 14 }, RUN_LOG_BAND)).toBe(true);

    const lines = runLogLineRects(RUN_LOG.maxLines);
    expect(lines.length).toBe(RUN_LOG.maxLines);
    expect(lines.length).toBe(12);
    for (const r of lines) expect(inside(r, RUN_LOG_BAND)).toBe(true);
    expect(runLogBottomY(RUN_LOG.maxLines)).toBeLessThan(RUN_ACTION_BAND.y);
    // 行间不重叠，且自上而下顺序排列
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i].y).toBe(lines[i - 1].y + RUN_LOG.lineH);
      expect(runRectsOverlap(lines[i], lines[i - 1])).toBe(false);
    }
    // 真实手机尺寸可直接阅读：行高 ≥ 26px（实绘字号 15px）
    expect(RUN_LOG.lineH).toBeGreaterThanOrEqual(26);
    expect(stripComments(read('runPage.ts')).includes('15px')).toBe(true);
  });

  it('RP-05 最底：唯一一个主动作按钮，落在动作带内', () => {
    const btn = runActionButtonRect();
    expect(inside(btn, RUN_ACTION_BAND)).toBe(true);
    expect(btn.w).toBeGreaterThan(200); // 触控友好
    expect(btn.x).toBe(RUN_PAGE_W - (btn.x + btn.w)); // 水平居中
    // 主动作不与日志区 / 舞台重叠
    expect(runRectsOverlap(btn, RUN_LOG_BAND)).toBe(false);
    expect(runRectsOverlap(btn, RUN_STAGE_BAND)).toBe(false);
    // 强调条（入账的纯色块）完全落在按钮内
    expect(inside(runActionBarRect(), btn)).toBe(true);
  });
});

/* ============================================ B. 五状态机 + 固定演示流程 */

describe('PRP-F0｜B 五状态机与固定演示流程（同一页面内）', () => {
  it('RP-06 初始为 IDLE、日志已可见且已是玩家叙事（无方括号前缀）', () => {
    const s = createRunPageState(CTX);
    expect(s.phase).toBe('IDLE');
    expect(RUN_PHASES).toContain(s.phase);
    expect(s.log.length).toBe(2); // DAY 行 + 行进叙事
    expect(visibleRunLog(s, RUN_LOG.maxLines).length).toBe(2);
    expect(s.log[0].kind).toBe('day');
    expect(s.log[0].text).toBe(`DAY ${RUN_INITIAL_DAY}`);
    expect(s.log[1].kind).toBe('travel');
    expect(s.log[1].text).toContain(CTX.vehicleLabel);
    expect(runActionLabel(s)).toBe('继续');
    expect(runActionEnabled(s)).toBe(true);
    expect(s.buffs.length).toBe(0);
    expect(s.battle).toBeNull();
    expect(s.day).toBe(RUN_INITIAL_DAY);
    expect(s.dayTotal).toBe(RUN_TOTAL_DAYS);
  });

  it('RP-07 一次完整操作连续走完 IDLE→EVENT→BATTLE→RESULT→CHOICE→IDLE', () => {
    const { steps, finale } = runFullFlow();
    expect(steps.map((s) => s.phase)).toEqual(['IDLE', 'EVENT', 'BATTLE', 'RESULT', 'CHOICE', 'IDLE']);
    expect(finale.phaseTrail).toEqual(['IDLE', 'EVENT', 'BATTLE', 'RESULT', 'CHOICE', 'IDLE']);
    expect(finale.transitions).toBe(5);
    // revision 单调递增（每次状态变更都 +1，没有静默 no-op 混进来）
    for (let i = 1; i < steps.length; i++) expect(steps[i].revision).toBeGreaterThan(steps[i - 1].revision);
  });

  it('RP-08 EVENT：页面不跳转（纯状态），日志追加 2 句敌情叙事，底部切为对应当前动作', () => {
    const idle = createRunPageState(CTX);
    const ev = pressRunAction(idle, CTX);
    expect(ev.phase).toBe('EVENT');
    expect(ev.log.length).toBe(idle.log.length + 2);
    expect(ev.log[ev.log.length - 2].kind).toBe('event');
    expect(ev.log[ev.log.length - 2].text).toBe('前方传来急促的引擎声。');
    const last = ev.log[ev.log.length - 1];
    expect(last.kind).toBe('event');
    expect(last.text).toBe(`你遭遇了${CTX.encounterLabel}。`);
    expect(runActionLabel(ev)).toBe('遭遇敌人');
    expect(runActionEnabled(ev)).toBe(true);
    // 原日志行一字不动（只追加）
    expect(ev.log.slice(0, idle.log.length)).toEqual(idle.log);
  });

  it('RP-09 BATTLE：底部切为「战斗中」并不可误触推进；入场不写日志；战斗数值=真实 HP', () => {
    const { bt } = startBattle();
    expect(bt.phase).toBe('BATTLE');
    expect(runActionLabel(bt)).toBe('战斗中');
    expect(runActionEnabled(bt)).toBe(false); // 禁触
    expect(pressRunAction(bt, CTX)).toBe(bt); // 同引用 = 真 no-op
    expect(bt.log.length).toBe(4); // 入场不写日志（保持在 EVENT 的 4 行）
    expect(bt.battle).not.toBeNull();
    expect(bt.battle!.enemyHp).toBe(bt.battle!.enemyHpMax);
    expect(bt.battle!.playerHp).toBe(bt.battle!.playerHpMax);
    expect(bt.battle!.steps).toBe(0);
    expect(bt.battle!.done).toBe(false);
    expect(bt.battle!.winner).toBeNull();
    // 耐久上限来自 F1 共享测试数据（正式 registry 解析，不是手写）
    expect(bt.battle!.playerHpMax).toBe(1100);
    expect(bt.battle!.enemyHpMax).toBe(1000); // PRP-RUN-R1：验证对手换为 ProtoRusher（菠萝 1000）
    // 没有任何脚本参数残留（`totalSteps` 已随 RUN_BATTLE_SCRIPT 一并删除）
    expect('totalSteps' in bt.battle!).toBe(false);
  });

  it('RP-10 BATTLE 期间不刷逐帧伤害日志；开局 41 帧内**零伤害**（远程阶段先于接敌）', () => {
    const { rt, bt } = startBattle();
    let cur = bt;
    for (const chunk of [1, 1, 1, 5, 13, 20]) {
      const next = driveFrames(cur, rt, chunk);
      expect(next.phase).toBe('BATTLE'); // 还没打完
      expect(next.log).toEqual(bt.log); // 日志零变化
      expect(next.log.length).toBe(bt.log.length);
      cur = next;
    }
    expect(cur.battle!.steps).toBe(41);
    // ⚠️ 实测：首次命中在 2.2s（≈131 帧）→ 41 帧时双方仍满血。
    // 这正是「先有距离、后有交火」的机器证据（旧脚本版会在第 1 帧就开始掉血）。
    expect(cur.battle!.enemyHp).toBe(bt.battle!.enemyHp);
    expect(cur.battle!.playerHp).toBe(bt.battle!.playerHp);
    // 继续推进到首次交火之后 → 敌方耐久真实下降，而日志依旧一字未动
    const late = driveFrames(cur, rt, 120);
    expect(late.battle!.steps).toBe(161);
    expect(late.battle!.enemyHp).toBeLessThan(bt.battle!.enemyHp);
    expect(late.log).toEqual(bt.log);
    rt.dispose();
  });

  it('RP-11 RESULT：一次性追加 3 行玩家叙事（胜负 + 耐久百分比 + 改装机会）', () => {
    const { rt, bt } = startBattle();
    let mid = bt;
    // 推进到「还没结束」的最后一帧（不能写死帧数 → 用真实结束点反推）
    for (let i = 0; i < MAX_FRAMES; i++) {
      const next = driveFrames(mid, rt, 1);
      if (next.phase !== 'BATTLE') break;
      mid = next;
    }
    expect(mid.phase).toBe('BATTLE');
    expect(mid.log.length).toBe(bt.log.length); // 结束前一帧仍不写日志

    const res = driveFrames(mid, rt, 1);
    expect(res.phase).toBe('RESULT');
    expect(res.log.length).toBe(bt.log.length + 3); // 一次性只加三条
    const added = res.log.slice(-3);
    expect(added[0].kind).toBe('result');
    expect(added[0].text).toBe('战斗胜利。');
    expect(added[1].kind).toBe('durability');
    expect(added[1].text).toBe(`战车耐久剩余 ${durabilityPercent(res.battle!)}%。`);
    expect(added[2].kind).toBe('result');
    expect(added[2].text).toBe('你发现了一次改装机会……');
    expect(res.battle!.done).toBe(true);
    // 官方结果被原样带回（不是自算的胜负）
    expect(res.battle!.winner).toBe('A');
    expect(res.battle!.endReason).toBe('hp');
    expect(runActionLabel(res)).toBe('继续');
    expect(runActionEnabled(res)).toBe(true);
  });

  it('RP-12 CHOICE：浮层打开、日志不变、原页面几何与位置一字不动', () => {
    const res = reachResult();
    const ch = pressRunAction(res, CTX);
    expect(ch.phase).toBe('CHOICE');
    expect(runChoiceOpen(ch)).toBe(true);
    expect(ch.log).toEqual(res.log); // 既不加也不减
    expect(ch.buffs).toEqual(res.buffs);
    expect(ch.battle).toEqual(res.battle); // 战斗结论整体保留（浮层下面是同一个战场）
    // 浮层出现其间「原页面整体变暗」= 遮罩恰好覆盖整个逻辑舞台（不多不少）
    expect(runChoiceMaskRect()).toEqual({ x: 0, y: 0, w: RUN_PAGE_W, h: RUN_PAGE_H });
  });

  it('RP-13 选择后回到 IDLE：顶部新增图标 + 日志追加自然语言结果 + 推进到下一 DAY + 历史完整', () => {
    const { steps, finale } = runFullFlow();
    const choice = steps[4];
    expect(choice.phase).toBe('CHOICE');
    expect(finale.phase).toBe('IDLE');
    expect(finale.buffs.length).toBe(choice.buffs.length + 1);
    expect(finale.buffs[0].id).toBe(RUN_CHOICE_OPTIONS[0].id);
    expect(finale.buffs[0].label).toBe('重型弹头');
    // PRP-F2 必改 3：选择后追加两行 —— ①强化记录（自然语言）②新的 DAY 行
    expect(finale.log.length).toBe(choice.log.length + 2);
    const last = finale.log[finale.log.length - 1];
    const prev = finale.log[finale.log.length - 2];
    expect(prev.kind).toBe('choice');
    expect(prev.text).toBe('你为大炮装上了重型弹头。');
    expect(last.kind).toBe('day');
    expect(last.text).toBe(`DAY ${RUN_INITIAL_DAY + 1}`);
    // 本局 Build 被记录（必改 3）；PRP-BUILD-01：`buffs` 就是 Build 的唯一来源
    expect(runBuildIds(finale)).toEqual([RUN_CHOICE_OPTIONS[0].id]);
    expect(finale.repairBonus).toBe(0); // 重型弹头不是维修项 → 无耐久补偿
    // 历史完整：CHOICE 之前的全部行原样保留
    expect(finale.log.slice(0, choice.log.length)).toEqual(choice.log);
    // seq 连续单调
    for (let i = 1; i < finale.log.length; i++) expect(finale.log[i].seq).toBe(finale.log[i - 1].seq + 1);
  });

  it('RP-13b 未选择之前本局没有任何强化（本局临时状态，新建 Run 回到空 Build）', () => {
    const fresh = createRunPageState(CTX);
    expect(runBuildIds(fresh)).toEqual([]);
    const { steps } = runFullFlow();
    expect(runBuildIds(steps[0])).toEqual([]); // IDLE
    expect(runBuildIds(steps[4])).toEqual([]); // CHOICE（还没选）
  });

  it('RP-14 误触保护：BATTLE / CHOICE 阶段按主动作 no-op；未知强化 id no-op', () => {
    const { steps } = runFullFlow();
    const bt = steps[2];
    const res = steps[3];
    expect(pressRunAction(bt, CTX)).toBe(bt);
    const choice = steps[4];
    expect(pressRunAction(choice, CTX)).toBe(choice);
    expect(chooseRunBuff(choice, 'not-a-buff')).toBe(choice);
    expect(chooseRunBuff(res, RUN_CHOICE_OPTIONS[0].id)).toBe(res); // 非 CHOICE 不生效
    // 非 BATTLE 状态不接受帧同步（真 no-op，同引用）
    const { rt } = startBattle();
    expect(syncRunBattle(res, { playerHp: 1, enemyHp: 1, steps: 1 })).toBe(res);
    expect(finishRunBattle(res, { winner: 'A', endReason: 'hp', playerHp: 1, enemyHp: 0, steps: 1 })).toBe(res);
    void rt;
  });

  it('RP-15 三个强化选项固定且正是 Queue 点名的 Cannon 三选一（本局临时，不随机）', () => {
    expect(RUN_CHOICE_OPTIONS.length).toBe(3);
    expect(RUN_CHOICE_OPTIONS.map((o) => o.label)).toEqual(['重型弹头', '双联炮', '快速装填']);
    expect(RUN_CHOICE_OPTIONS.map((o) => o.note)).toEqual([
      '炮弹更重，撞击和后坐都更明显',
      '一次开火连续打出两发炮弹',
      '开炮节奏明显变快',
    ]);
    expect(RUN_CHOICE_OPTIONS.map((o) => o.id)).toEqual(['heavyShell', 'twinCannon', 'fastReload']);
    expect(new Set(RUN_CHOICE_OPTIONS.map((o) => o.id)).size).toBe(3);
    for (const o of RUN_CHOICE_OPTIONS) {
      expect(o.note.length).toBeGreaterThan(0);
      expect(o.note.includes('[')).toBe(false); // 不是内部字段 / 枚举
      expect(o.note.length).toBeLessThanOrEqual(16); // 一句结果，不是说明段
    }
    // 两个不同选项给出可区分的顶部图标 / 日志结果（选择真的生效）
    const a = chooseRunBuff(reachChoice(), RUN_CHOICE_OPTIONS[1].id);
    const b = chooseRunBuff(reachChoice(), RUN_CHOICE_OPTIONS[2].id);
    expect(a.buffs[0].id).toBe('twinCannon');
    expect(b.buffs[0].id).toBe('fastReload');
    expect(a.buffs[0].id).not.toBe(b.buffs[0].id);
    expect(a.log[a.log.length - 2].text).toBe('你为大炮加装了一门副炮。');
    expect(b.log[b.log.length - 2].text).toBe('你改进了大炮的装填机构。');
  });

  it('RP-16 真实战斗的帧同步是纯函数：同样的步数序列 → 同样的 HP / 结局', () => {
    const { rt, bt } = startBattle();
    const oneShot = driveToEnd(bt, rt);
    expect(oneShot.phase).toBe('RESULT');
    // 同一个运行时不可能重放；这里验证「同步函数本身无隐藏状态」：
    // 用结束时的真实 HP 再走一次 sync/finish，结果与 oneShot 完全相同。
    const replay = finishRunBattle(
      syncRunBattle(bt, {
        playerHp: oneShot.battle!.playerHp,
        enemyHp: oneShot.battle!.enemyHp,
        steps: oneShot.battle!.steps,
      }),
      {
        winner: oneShot.battle!.winner,
        endReason: oneShot.battle!.endReason,
        playerHp: oneShot.battle!.playerHp,
        enemyHp: oneShot.battle!.enemyHp,
        steps: oneShot.battle!.steps,
      },
    );
    expect(replay.battle).toEqual(oneShot.battle);
    expect(replay.log).toEqual(oneShot.log);
    expect(replay.phase).toBe(oneShot.phase);
  });

  it('RP-17 耐久上限来自 F1 共享测试数据（不手写数值）；日志文本不再被二次格式化', () => {
    const plan = runDemoPlan();
    expect(CTX.playerHpMax).toBe(plan.player.hp);
    expect(CTX.enemyHpMax).toBe(plan.enemies[0].hp);
    expect(CTX.playerHpMax).toBe(1100);
    expect(CTX.enemyHpMax).toBe(1000); // ProtoRusher = 菠萝车身（正式模板 R1-RUSH-02）
    expect(CTX.vehicleLabel).toBe('西瓜重炮');
    expect(CTX.encounterLabel).toBe('菠萝冲刺车');
    expect(RUN_DEMO_LOADOUT_ID).toBe('WatermelonHeavyCannon');
    expect(RUN_DEMO_ENCOUNTER_ID).toBe('ProtoRusher');
    // PRP-R3 必改 3：formatRunLog 是恒等（**不再拼 `[耐久]` 之类前缀**）
    expect(formatRunLog({ seq: 1, kind: 'durability', text: '战车耐久剩余 78%。' })).toBe('战车耐久剩余 78%。');
  });
});

/* =================================  C. 中部舞台：待机近景 vs 真实战斗世界 */

describe('PRP-F1｜C 中部舞台：IDLE 近景 + 真实战斗世界（正式世界尺度）', () => {
  it('RP-18 必改 1：战斗世界用正式 arena 尺度，不是「按舞台带宽生成的假 arena」', () => {
    const { rt } = startBattle();
    expect(rt.arenaWidth).toBe(1600); // 正式 DEFAULT_ARENA_CONFIG.width
    expect(rt.arenaWidth).not.toBe(RUN_STAGE_BAND.w); // 且**不等于**舞台带宽 390
    expect(rt.arenaHeight).toBe(900);
    expect(rt.groundY).toBe(700);
    // 出生点就是正式 spawnA / spawnB（构造后实测，不是写死）
    expect(Math.round(rt.spawnAx)).toBe(400);
    expect(Math.round(rt.spawnBx)).toBe(1200);
    expect(rt.spawnSeparation).toBeCloseTo(800, 0);
    rt.dispose();
  });

  it('RP-19 必改 2：开局有明确距离（实测两车外廓间距 > 400 世界 px）', () => {
    const { rt } = startBattle();
    const gap = rt.gapWorld();
    expect(gap).toBeGreaterThan(400);
    // 冻结实测值（探针 + 本测试同源口径：车身 + 轮 + 部件 + visual）
    expect(Math.round(gap)).toBe(564); // PRP-RUN-R1：验证对手换为 ProtoRusher 后重测
    // 外廓间距与世界宽同量级 → 绝不是「贴车开局」
    expect(gap / rt.arenaWidth).toBeGreaterThan(0.25);
    rt.dispose();
  });

  it('RP-20 PRP-R5 必改 1/2：相机 = **正式 battle 相机链**，PRP 只做 viewport adapter', () => {
    // ① PRP-F1 的「固定全世界远摄」被废除：没有固定相机函数、没有写死的地面占比
    const runtime = stripComments(read('runBattleRuntime.ts'));
    const view = stripComments(read('runBattleView.ts'));
    expect(runtime.includes('runBattleCamera')).toBe(false);
    expect(runtime.includes('RUN_BATTLE_GROUND_FRAC')).toBe(false);
    // 不再出现「视图宽 / 世界宽」这种固定远摄公式
    expect(/viewW\s*\/\s*world/.test(runtime)).toBe(false);

    // ② PRP 不再自算镜头：视图层**不得**直接写 renderer.transform
    expect(view.includes('this.renderer.transform =')).toBe(false);
    expect(view.includes('applyBattleFollow')).toBe(false);
    // ③ 视图层**必须**调用正式 reframe(snap,'battle',{phase}) —— 这才是「复用正式相机」
    expect(view.includes('reframe(')).toBe(true);
    expect(/'battle'/.test(view)).toBe(true);
    expect(view.includes('const phase = runtime.phase;')).toBe(true);
    expect(/\{ phase \}/.test(view)).toBe(true);
    // 节奏必须走**正式口径**判定函数（Active 每帧 + 阶段切换那一帧），不得自造规则
    expect(view.includes('shouldReframeBattleCamera(phase, this.lastPhase)')).toBe(true);
    // ④ 每帧 reframe 之后必须 render()（正式 applyBattleFollow 在 render 内逐帧执行）
    expect(view.indexOf('reframe(')).toBeLessThan(view.indexOf('renderer.render('));

    // ⑤ viewport adapter：离屏视口 = 舞台带 + 正式 inset（安全区恰好等于舞台带）
    expect(RUN_BATTLE_VIEW_INSET).toEqual({ x: 56, y: 28 });
    expect(RUN_BATTLE_VIEW_W).toBe(RUN_STAGE_BAND.w + 112);
    expect(RUN_BATTLE_VIEW_H).toBe(RUN_STAGE_BAND.h + 56);
    expect(view.includes('RUN_BATTLE_VIEW_W')).toBe(true);
    expect(view.includes('RUN_BATTLE_VIEW_H')).toBe(true);
    // 合成时按 adapter 裁剪原点取源矩形（不再整画布 1:1 平铺）
    expect(view.includes('RUN_BATTLE_VIEW_INSET.x * this.dpr')).toBe(true);
    expect(view.includes('RUN_BATTLE_VIEW_INSET.y * this.dpr')).toBe(true);
  });

  it('RP-21 IDLE 近景缩放公式对 5 种车体都成立（战斗相机不参与 IDLE 构图）', () => {
    const avail = RUN_PAGE_W - 2 * RUN_SIDE_VIEW.marginPx - RUN_SIDE_VIEW.gapPx;
    let checked = 0;
    for (const l of LAB_LOADOUTS) {
      for (const e of LAB_ENCOUNTERS) {
        const plan = buildSpawnPlan(l.id, e.id);
        const pw = entityVisualWidth(plan.player);
        for (const enemy of plan.enemies) {
          const ew = entityVisualWidth(enemy);
          const scale = runSideViewScale(pw, ew);
          expect(scale).toBeGreaterThan(0);
          expect(scale).toBeLessThanOrEqual(RUN_SIDE_VIEW.maxScale);
          expect((pw + ew) * scale).toBeLessThanOrEqual(avail + 1e-6);
          checked += 1;
        }
      }
    }
    expect(checked).toBe(12); // 2 Loadout × (1 + 1 + 3 + 1) 敌人实例（PRP-RUN-R1 起含 ProtoRusher）
  });
});

/* ============================================ D. 面积账本（像素精确） */

describe('PRP-F0｜D 面积账本：逐帧整页像素面积精确冻结', () => {
  it('RP-22 六个关键帧的整页分层面积 = 冻结字面量；真实战场完全覆盖待机近景', () => {
    const { steps } = runFullFlow();
    const [idle, event, , result, choice, finale] = steps;

    /**
     * 入账的只有「**不承载文字、不被描边、不被 sprite / 图标覆盖**的纯色平铺矩形」：
     * 地线 / 路面 / 进度节点 / 主动作强调条 / 卡片强调条 / 已获得强化图标（底 + 高光块）。
     *
     * ⚠️ PRP-R3：车辆改用正式 sprite → 车身 / 部件**不再入账**（sprite 像素非纯色）。
     * ⚠️ PRP-F1：`ground` / `road` 只是 **IDLE 待机近景** 的两层。
     *    EVENT 起舞台带被真实 Planck 战斗世界（离屏位图）**整块覆盖** →
     *    这两层在画面上不再带精确色 → 账面归 0（这不是「少画了」，而是「被真实战场替代了」）。
     * 承载文字 / 描边 / 矢量图标的面（分带底色、按钮填充、卡片填充、图标字形）同样不入账。
     */
    const idleOnly = { ground: 780, road: 19500 };
    const noStage = { ground: 0, road: 0 };
    const base = { nodeDone: 384, nodeTodo: 512, buffIcon: 0, buffChip: 0, cardBar: 0 };
    const on = { actionBar: 990 };

    // IDLE：待机近景（地线 + 路面）+ 顶部第二行**完全不存在**（不是五个空框）
    expect(ledger(idle)).toEqual({ ...idleOnly, ...base, ...on });

    // EVENT：真实战斗世界接管舞台带 → 待机近景的地线 / 路面消失（车辆是 sprite，不入账）
    expect(ledger(event)).toEqual({ ...noStage, ...base, ...on });

    // BATTLE：战斗不可误触 → 主动作强调条整条消失
    const { rt, bt } = startBattle();
    const mid = driveFrames(bt, rt, 45);
    expect(mid.phase).toBe('BATTLE');
    expect(ledger(mid)).toEqual({ ...noStage, ...base, actionBar: 0 });
    // 战斗中段与开局账面完全一致（真实物理推进不改变任何入账面积）
    expect(ledger(mid)).toEqual(ledger(bt));
    rt.dispose();

    // RESULT：主动作恢复（战场保持冻结可见）
    expect(ledger(result)).toEqual({ ...noStage, ...base, ...on });

    // CHOICE：整页被遮罩合成 → 底层不再带精确色，只登记浮层自身（3 张卡片 × 强调条 1240）
    expect(ledger(choice)).toEqual({
      ground: 0,
      road: 0,
      nodeDone: 0,
      nodeTodo: 0,
      buffIcon: 0,
      buffChip: 0,
      cardBar: 3 * 1240,
      actionBar: 0,
    });

    // 回到 IDLE 且拿到 1 个强化 → 待机近景回来 + 顶部出现 1 个图标（底 900 − 高光块 144 = 756）
    //
    // ⚠️ PRP-F2：选择后 day 3→4 → 顶部进度节点整体前移一格（done 4×128 / todo 3×128）。
    //    节点总量不变（896），只是「已完成 / 未完成」对调 → 与 day 推进同源，不是账本漂移。
    const baseNextDay = { nodeDone: 512, nodeTodo: 384, buffIcon: 0, buffChip: 0, cardBar: 0 };
    expect(ledger(finale)).toEqual({ ...idleOnly, ...baseNextDay, buffIcon: 756, buffChip: 144, ...on });
    expect(ledger(finale).nodeDone + ledger(finale).nodeTodo).toBe(base.nodeDone + base.nodeTodo);
    expect(ledger(finale).buffIcon + ledger(finale).buffChip).toBe(30 * 30);
  });

  it('RP-22b PRP-BUILD-01：第二层 / 最终场的九个关键帧面积 = 冻结字面量（同源规则，非就地重算）', () => {
    /*
      三场两选的新流程里，同一 phase 会出现在**不同的 day**：
        DAY 3（第一场）→ DAY 4（第二场，1 个强化）→ DAY 5（第三场，2 个强化）。
      day 推进 → 顶部进度节点整体前移一格（done day×128 / todo (7−day)×128，**总量恒 896**）；
      强化行只画**实际已获得的**（每个图标 30×30 = 900：底色 756 + 高光块 144）。
      这里逐帧冻结，使「流程变长后账本悄悄漂移」不可能发生。
    */
    const idleOnly = { ground: 780, road: 19500 };
    const noStage = { ground: 0, road: 0 };
    const on = { actionBar: 990 };
    const off = { actionBar: 0 };
    const nodes = (day: number) => ({ nodeDone: day * 128, nodeTodo: (7 - day) * 128 });
    const icons = (n: number) => ({ buffIcon: 756 * n, buffChip: 144 * n });
    const choiceOnly = {
      ground: 0,
      road: 0,
      nodeDone: 0,
      nodeTodo: 0,
      buffIcon: 0,
      buffChip: 0,
      cardBar: 3 * 1240,
      actionBar: 0,
    };

    // ---- DAY 3：第一场（基础）
    let s = createRunPageState(CTX);
    const d3 = { ...nodes(3), ...icons(0), cardBar: 0 };
    expect(ledger(s)).toEqual({ ...idleOnly, ...d3, ...on });

    // ---- DAY 4：第二场（第一层 Build）+ 第二层条件池
    let s4 = pressRunAction(s, CTX); // EVENT
    s4 = pressRunAction(s4, CTX); // BATTLE①
    expect(ledger(s4)).toEqual({ ...noStage, ...d3, ...off });
    s4 = finishRunBattle(s4, { winner: 'A', endReason: 'hp', playerHp: 900, enemyHp: 0, steps: 300 });
    s4 = pressRunAction(s4, CTX); // CHOICE①
    expect(ledger(s4)).toEqual(choiceOnly);

    s4 = chooseRunBuff(s4, 'twinCannon');
    expect(s4.phase).toBe('IDLE');
    const d4 = { ...nodes(4), ...icons(1), cardBar: 0 };
    expect(ledger(s4)).toEqual({ ...idleOnly, ...d4, ...on });
    const b4 = pressRunAction(pressRunAction(s4, CTX), CTX); // EVENT → BATTLE②
    expect(ledger(b4)).toEqual({ ...noStage, ...d4, ...off });
    const r4 = finishRunBattle(b4, { winner: 'A', endReason: 'hp', playerHp: 800, enemyHp: 0, steps: 300 });
    expect(ledger(r4)).toEqual({ ...noStage, ...d4, ...on });

    // ---- DAY 5：第三场（两层 Build）→ 终局（不再进 CHOICE）
    const c5 = pressRunAction(r4, CTX); // CHOICE②
    expect(c5.phase).toBe('CHOICE');
    expect(runChoicePool(c5).map((o) => o.id)).toEqual([...RUN_LAYER2_POOLS.twinCannon]);
    expect(ledger(c5)).toEqual(choiceOnly);

    const s5 = chooseRunBuff(c5, 'tripleLoad');
    const d5 = { ...nodes(5), ...icons(2), cardBar: 0 };
    expect(ledger(s5)).toEqual({ ...idleOnly, ...d5, ...on });
    const b5 = pressRunAction(pressRunAction(s5, CTX), CTX);
    expect(ledger(b5)).toEqual({ ...noStage, ...d5, ...off });
    const r5 = finishRunBattle(b5, { winner: 'A', endReason: 'hp', playerHp: 700, enemyHp: 0, steps: 300 });
    expect(ledger(r5)).toEqual({ ...noStage, ...d5, ...on });
    // 终局：主动作变「重新开始验证」，但**不再有第二次 RESULT→CHOICE**
    expect(runVerificationComplete(r5)).toBe(true);
    expect(pressRunAction(r5, CTX).phase).toBe('IDLE'); // 直接是新 Run
    expect(runBuildIds(pressRunAction(r5, CTX))).toEqual([]);

    // 跨 day 的不变量：节点总量恒 896（只是「已完成 / 未完成」前移）
    for (const day of [3, 4, 5]) {
      const n = nodes(day);
      expect(n.nodeDone + n.nodeTodo).toBe(896);
    }
    // 图标总量口径：每个 30×30（底色 756 + 高光块 144）；
    // 顶部图标行**只画实际已获得的**（count 0 → 面积 0，不是五个空槽）
    expect(ledger(createRunPageState(CTX)).buffIcon).toBe(0);
    for (const n of [0, 1, 2]) {
      expect(icons(n).buffIcon + icons(n).buffChip).toBe(900 * n);
    }
  });

  it('RP-23 CHOICE 浮层：3 张互不重叠的卡片 + 全页遮罩；卡片面积与几何一致', () => {
    const cards = runChoiceCardRects(RUN_CHOICE_OPTIONS.length);
    expect(cards.length).toBe(3);
    for (const c of cards) {
      expect(c.w).toBe(RUN_CHOICE.cardW);
      expect(c.h).toBe(RUN_CHOICE.cardH);
      expect(inside(c, { x: 0, y: 0, w: RUN_PAGE_W, h: RUN_PAGE_H })).toBe(true);
    }
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) expect(runRectsOverlap(cards[i], cards[j])).toBe(false);
    }
    // 纵向居中
    const top = cards[0].y;
    const bottom = cards[cards.length - 1].y + cards[cards.length - 1].h;
    expect(top).toBe(RUN_PAGE_H - bottom);
    // 卡片强调条不含文字、不被描边覆盖 → 面积可精确冻结
    const bar0 = runChoiceBarRect(cards[0]);
    expect(bar0.y).toBeGreaterThanOrEqual(cards[0].y + 2); // 避开 2px 描边
    expect(bar0.h * bar0.w).toBe(310 * 4);
    // 遮罩覆盖整个逻辑舞台（原页面整体变暗，位置不变）
    expect(runChoiceMaskRect()).toEqual({ x: 0, y: 0, w: RUN_PAGE_W, h: RUN_PAGE_H });
    // 账面配色：每张卡片只入账「顶部强调条」一个纯色矩形
    const shapes = layersOf(reachChoice());
    expect(shapes.every((sh) => sh.layer === 'cardBar')).toBe(true);
    expect(shapes.length).toBe(3);
  });
});

/* ============================================ E. 源码守卫 */

describe('PRP-F1｜E 源码守卫：Debug 分离 / 只经 runtime 接正式战斗 / 零跳转', () => {
  it('RP-24 Run Page 不得引用 Arena A/B、Gate、PBL Lab 控制器或俯视驱动', () => {
    const bannedTokens = [
      'arenaA', // Arena A（俯视）
      'arenaScene',
      'ArenaARuntime',
      'PlanckArenaRuntime',
      'drivePlanckVehicle', // 俯视 Lab 驱动
      "from './gate'",
      'auditSharedCombatData',
      "from './lab'",
      'PortraitBattleLab',
      'pbl-',
      'PBL_',
    ];
    for (const f of RUN_PAGE_FILES) {
      const code = stripComments(read(f));
      for (const t of bannedTokens) {
        expect(code.includes(t), `${f} 不得出现 "${t}"`).toBe(false);
      }
    }
  });

  it('RP-24b 正式 Planck 侧视战斗**只能**从 runBattleRuntime.ts 进入，且构造时零 config 覆盖', () => {
    // 1) 其它 Run Page 文件一律不得直接摸正式战斗编排器（单一入口）
    for (const f of RUN_PAGE_FILES.filter((x) => x !== 'runBattleRuntime.ts')) {
      expect(stripComments(read(f)).includes('planckBattleOrchestrator'), `${f} 必须经 runBattleRuntime`).toBe(false);
    }
    const rt = stripComments(read('runBattleRuntime.ts'));
    expect(rt.includes("from '../../battle/planckBattleOrchestrator'")).toBe(true);
    // 2) 构造参数里**没有** gameplay 覆盖：第 4 个实参必须是**字面空对象** `{}`
    //    → 世界尺度 / 出生点 / 阶段 / 驱动 / 武器全部取正式默认值。
    const call = rt.match(/new PlanckBattleOrchestrator\(([\s\S]*?)\);/);
    expect(call, 'runBattleRuntime 必须构造正式 PlanckBattleOrchestrator').not.toBeNull();
    const args = call![1].split(',').map((x) => x.trim()).filter(Boolean);
    expect(args.length).toBe(5); // A 快照 / B 快照 / registry / config / soloA
    expect(args[3]).toBe('{}');
    for (const t of ['autoDrive:', 'sideDrive:', 'arenaConfig:', 'closingSpeed:', 'phases:']) {
      expect(args[3].includes(t), `config 不得覆盖 "${t}"`).toBe(false);
    }
    // 3) 世界尺度直接读正式配置（不是自己写 1600）；相机也不再需要自己拿 arena 宽
    expect(rt.includes('this.orchestrator.arena.config.width')).toBe(true);
    expect(rt.includes('this.orchestrator.arena.config.groundY')).toBe(true);
    expect(/=\s*1600\b/.test(rt)).toBe(false);
    expect(/=\s*900\b/.test(rt)).toBe(false);
    // 真实的出生位置是**实测**（读 world.getPosition），不是写死数字
    expect(rt.includes('w.getPosition(this.orchestrator.vehicleA.body).x')).toBe(true);
    expect(/spawnAx = .*getPosition/.test(rt)).toBe(true);
    // 4) PRP-R5：相机走正式 reframe（视图层只接线），但**不碰**正式相机内部状态
    const view = stripComments(read('runBattleView.ts'));
    expect(view.includes('reframe(')).toBe(true);
    expect(view.includes('battleCam')).toBe(false);
    expect(view.includes('this.renderer.transform =')).toBe(false);
    // 5) 战斗剧本 / 演出位移彻底不存在（否则会重新引入「假战斗」）
    const state = stripComments(read('runPageState.ts'));
    for (const t of ['RUN_BATTLE_SCRIPT', 'advanceRunBattle', 'Math.sin']) {
      expect(state.includes(t), `runPageState 不得残留 "${t}"`).toBe(false);
    }
    const scene = stripComments(read('runPageScene.ts'));
    for (const t of ['RUN_SIDE_VIEW_CLOSING_PX', 'translateRunGroup', 'battleClosingOffset']) {
      expect(scene.includes(t), `runPageScene 不得残留 "${t}"`).toBe(false);
    }
    const layout = stripComments(read('runPageLayout.ts'));
    for (const t of ['RUN_SIDE_VIEW_CLOSING_PX', 'translateRunGroup']) {
      expect(layout.includes(t), `runPageLayout 不得残留 "${t}"`).toBe(false);
    }
  });

  it('RP-25 Run Page 不创建任何 DOM 按钮、不写 location / history（结构上无法跳转）', () => {
    for (const f of RUN_PAGE_FILES) {
      const code = stripComments(read(f));
      for (const t of [
        "createElement('button')",
        'createElement("button")',
        'location.href',
        'location.assign',
        'location.replace',
        'history.pushState',
        'history.replaceState',
        'window.open',
      ]) {
        expect(code.includes(t), `${f} 不得出现 "${t}"`).toBe(false);
      }
    }
    const page = stripComments(read('runPage.ts'));
    expect(page.includes('run-root')).toBe(true);
    expect(page.includes('run-canvas')).toBe(true);
    expect(page.includes('run-stage')).toBe(true);
  });

  it('RP-26 run-page.html 只挂 runMain.ts，且不含任何 PBL 开发控制标记', () => {
    const html = readFileSync(join(REPO_ROOT, 'run-page.html'), 'utf8');
    expect(html.includes('src/lab/portraitBattleLab/runMain.ts')).toBe(true);
    expect(html.includes('pbl-root')).toBe(false);
    expect(html.includes('pbl-bar')).toBe(false);
    expect(html.includes('pbl-btn')).toBe(false);
    expect(html.includes('pbl-gate')).toBe(false);
    expect(html.includes('pbl-canvas')).toBe(false);
    const main = read('runMain.ts');
    expect(main.includes("from './runPage'")).toBe(true);
    expect(main.includes('#run-root')).toBe(true);
  });

  it('RP-27 四个正式构建配置与正式入口 0 引用 Run Page（原型不得写入正式产物）', () => {
    for (const t of ['index.html', 'vite.config.ts', 'vite.pages.config.ts', 'vite.e2e.config.ts', 'vite.wechat.config.ts']) {
      const src = readFileSync(join(REPO_ROOT, t), 'utf8');
      expect(src.includes('run-page'), `${t} 不得引用 run-page`).toBe(false);
      expect(src.includes('runMain'), `${t} 不得引用 runMain`).toBe(false);
    }
    // 唯一允许承载原型入口的构建配置就是 Lab 自己的那份
    const labCfg = readFileSync(join(REPO_ROOT, 'vite.portrait-lab.config.ts'), 'utf8');
    expect(labCfg.includes("'run-page': 'run-page.html'")).toBe(true);
    expect(labCfg.includes("'portrait-lab': 'portrait-lab.html'")).toBe(true);
  });

  it('RP-28 玩家页面运行时不得出现开发控制（源码层已禁，另加运行时计数入口）', () => {
    const page = stripComments(read('runPage.ts'));
    // DOM 只由 div + canvas 组成（不建 <button>、不建任何开发控制节点）
    expect(page.includes("createElement('div')")).toBe(true);
    expect(page.includes("createElement('canvas')")).toBe(true);
    expect(page.includes("createElement('button')")).toBe(false);
    // 运行时诊断会如实数出「开发控制 = 0 / DOM 按钮 = 0」，供浏览器端断言
    expect(page.includes('button, [data-dev-control], [data-dev]')).toBe(true);
    expect(page.includes("querySelectorAll('button')")).toBe(true);
    expect(page.includes('debugControls')).toBe(true);
    expect(page.includes('domButtons')).toBe(true);
  });
});

/* ====================================== F. 信息层级（PRP-R3 + PRP-F1） */

describe('PRP-R3｜F 信息层级：少状态 / 大战斗主体 / 可读叙事 / 选择独占焦点', () => {
  it('RP-29 必改 1：顶部彻底减法 —— 无空槽、无「核心构建 X/5」、无预留格子', () => {
    // 结构性证据：0 个强化 → 顶部第二行**一个矩形都没有**（不可能画出空框）
    expect(runBuffIconRects(0)).toEqual([]);
    expect(layersOf(createRunPageState(CTX)).filter((l) => l.layer === 'buffIcon')).toEqual([]);
    expect(layersOf(createRunPageState(CTX)).filter((l) => l.layer === 'buffChip')).toEqual([]);
    // 有 N 个强化就恰好画 N 个（不是固定 5 个）
    for (const n of [1, 2, 3, 5]) expect(runBuffIconRects(n).length).toBe(n);
    // 上限约 5 个
    expect(RUN_BUFF_ICON_MAX).toBeLessThanOrEqual(5);
    expect(runBuffIconRects(9).length).toBe(RUN_BUFF_ICON_MAX);
    // 图标个数与已获得强化严格一致（1 个强化 → 1 个图标）
    expect(layersOf(chooseRunBuff(reachChoice(), RUN_CHOICE_OPTIONS[0].id)).filter((l) => l.layer === 'buffIcon').length).toBe(1);

    // 源码层：不得再出现「核心构建 X/5 / 空槽 / 占位格子」这类开发概念
    for (const f of RUN_PAGE_FILES) {
      const code = stripComments(read(f));
      for (const t of ['核心构建', 'CORE BUILD', '空槽', '预留', 'placeholderSlot', 'buildSlot']) {
        expect(code.includes(t), `${f} 玩家界面不得出现 "${t}"`).toBe(false);
      }
    }
  });

  it('RP-30 必改 3：日志是玩家叙事 —— 全流程无方括号前缀 / 无 Runtime 状态 / 无逐帧伤害', () => {
    const { steps, finale } = runFullFlow();
    const allKinds = new Set<string>();
    for (const s of steps) {
      for (const e of s.log) {
        allKinds.add(e.kind);
        // 玩家可见文本里不得出现任何 Debug 前缀或内部记号
        expect(e.text.includes('['), `日志不得含方括号前缀：${e.text}`).toBe(false);
        expect(e.text.includes(']')).toBe(false);
        expect(e.text.includes('{')).toBe(false);
        expect(/^\[?(系统|事件|战斗|结果|耐久|强化)\]/.test(e.text), `日志不得以 Debug 标签开头：${e.text}`).toBe(false);
        expect(e.text.trim().length).toBeGreaterThan(0);
        expect(e.text.length).toBeLessThanOrEqual(40); // 一句叙事，不是状态 dump
      }
    }
    // 使用的语义角色恰好是玩家叙事集（不含 system / battle 这类控制台角色）
    expect([...allKinds].sort()).toEqual(['choice', 'day', 'durability', 'event', 'result', 'travel']);
    // 逐帧伤害绝不进日志：BATTLE 全程日志条数恒定（真实物理推进 89 帧）
    const { rt, bt } = startBattle();
    const after = driveFrames(bt, rt, 89);
    expect(after.phase).toBe('BATTLE');
    expect(after.log).toEqual(bt.log);
    rt.dispose();
    // 最近事件才突出：可见行 ≤ maxLines，末 N 行视为「最近」
    expect(visibleRunLog(finale, 3).length).toBeLessThanOrEqual(3);
    expect(visibleRunLog(finale, 3)).toEqual(finale.log.slice(-3));
    expect(RUN_LOG.emphasis).toBeGreaterThanOrEqual(3);
    expect(RUN_LOG.emphasis).toBeLessThanOrEqual(5);
  });

  it('RP-31 必改 2：IDLE 战斗主体是**真实车辆视觉**（正式 sprite + 正式 anchor/镜像）', () => {
    const plan = runDemoPlan();
    // 1) 两个实体都不含「纯色矩形代表车辆」的降级件
    expect(hasPlaceholderVisual(plan.player)).toBe(false);
    expect(hasPlaceholderVisual(plan.enemies[0])).toBe(false);

    const view = buildRunStageView();
    const all = [...view.player.visuals];
    // 2) 非轮组可视件必须带正式 visualId（= 真实 sprite 外形）
    for (const v of all) {
      if (v.kind === 'wheel') continue;
      expect(v.visualId, `${v.kind} 必须有正式 visualId`).toBeTruthy();
    }
    const ids = new Set(all.map((v) => v.visualId).filter(Boolean));
    expect(ids.has('body_watermelon')).toBe(true); // 玩家车身（正式 BodyDef.visual）
    expect(ids.has('part_cannon')).toBe(true); // 玩家武器（正式 FunctionalPartDef.visual）
    // 3) 玩家车体朝右 → 不镜像（朝向语义来自正式 visual.mirrorWithFacing）
    for (const v of view.player.visuals) expect(v.mirror).toBe(false);

    // 4) 车辆**明显放大**：单体宽 ≥ 舞台宽的 40%，高 ≥ 舞台高的 1/6
    const pw = view.player.bounds.w;
    expect(pw).toBeGreaterThan(RUN_STAGE_BAND.w * 0.4);
    expect(view.player.bounds.h).toBeGreaterThan(RUN_STAGE_BAND.h / 6);

    // 5) 资源层：只引用正式 PNG（与正式入口 main.ts 同一批文件），不复制美术
    expect(Object.keys(RUN_VISUAL_ASSETS).sort()).toEqual([
      'body_banana',
      'body_watermelon',
      'part_cannon',
      'part_hammer',
      'part_pushRod',
    ]);
    const assets = stripComments(read('runVehicleAssets.ts'));
    expect(assets.includes('../../../assets/visuals/')).toBe(true);
    expect(assets.includes('body_watermelon.png')).toBe(true);
    // 不得绕过正式口径自造尺寸 / 自造美术
    for (const t of ['fillRect', 'arc(', 'drawImage(img, 0, 0']) {
      expect(assets.includes(t), `资源层不得自绘几何："${t}"`).toBe(false);
    }

    // 6) 渲染层：不存在「无 sprite 就用纯色矩形」的降级路径
    const page = stripComments(read('runPage.ts'));
    expect(page.includes('partFallback')).toBe(false);
    // 7) 战斗世界的车辆视觉走**正式 Renderer + 正式 VisualRegistry**（不是 PRP 自绘）
    const battleView = stripComments(read('runBattleView.ts'));
    expect(battleView.includes("from '../../render/renderer'")).toBe(true);
    expect(battleView.includes("from '../../render/visualRegistry'")).toBe(true);
    expect(battleView.includes('new Renderer(')).toBe(true);
    expect(battleView.includes('setBattleBackdrop(true)')).toBe(true);
    expect(battleView.includes("from '../../presentation/playerPresentation'")).toBe(true);
  });

  it('RP-32 必改 2：IDLE 中部舞台有真实景物，不存在大片空场（山脊 / 雾带填满地平线以上）', () => {
    const hills = runStageHills();
    const view = buildRunStageView();
    const hillBaseY = view.groundY - 6; // 与 runPage.drawBackdrop 同源
    const bandMid = RUN_STAGE_BAND.y + RUN_STAGE_BAND.h / 2;

    // 1) 最高山脊必须越过舞台带正中线 —— 否则战车会浮在大片空场中央
    const tallest = Math.max(...hills.far.map((h) => h.h));
    expect(hillBaseY - tallest).toBeLessThan(bandMid);
    // 2) 远山横向无缝铺满整个舞台宽（不留横向空档）
    const far = [...hills.far].sort((a, b) => a.x - b.x);
    let cursor = RUN_STAGE_BAND.x;
    for (const h of far) {
      expect(h.x).toBeLessThanOrEqual(cursor);
      cursor = Math.max(cursor, h.x + h.w);
    }
    expect(cursor).toBeGreaterThanOrEqual(RUN_STAGE_BAND.x + RUN_STAGE_BAND.w);
    // 3) 雾带要有厚度（不是一条细线），且完全落在地平线以上
    expect(RUN_STAGE_HAZE_H).toBeGreaterThanOrEqual(80);
    expect(view.groundY - RUN_STAGE_HAZE_H).toBeGreaterThan(RUN_STAGE_BAND.y);
    // 4) 战车**视觉重心偏下**（压在较下的地平线上，而不是浮在带中央）
    expect(view.player.bounds.y + view.player.bounds.h).toBe(view.baselineY);
    expect(view.player.bounds.y + view.player.bounds.h / 2).toBeGreaterThan(bandMid);
  });

  it('RP-33 必改 4：CHOICE 三选一 = 图标 + 名称 + 一句结果，且成为唯一视觉焦点', () => {
    const cards = runChoiceCardRects(RUN_CHOICE_OPTIONS.length);
    // 卡片接近整屏宽 → 焦点独占
    expect(RUN_CHOICE.cardW).toBeGreaterThanOrEqual(RUN_PAGE_W * 0.8);
    // 每张卡片：左侧图标绘制区（真实矢量图标，不承载文字）+ 右侧文本
    for (const c of cards) {
      const icon = runChoiceIconRect(c);
      expect(inside(icon, c)).toBe(true);
      expect(icon.w).toBe(RUN_CHOICE.iconSize);
      expect(icon.w).toBe(icon.h);
      // 文本从图标右侧开始 → 图标 / 名称 / 一句结果三者位置不重叠
      expect(runChoiceTextX(c)).toBeGreaterThan(icon.x + icon.w);
      expect(runChoiceTextX(c)).toBeLessThan(c.x + c.w);
      // 强调条与图标不重叠
      expect(runRectsOverlap(runChoiceBarRect(c), icon)).toBe(false);
    }
    // 浮层标题在所有卡片之上（先读标题，再读选项）
    expect(runChoiceTitlePos(3).y).toBeLessThan(cards[0].y);
    // 遮罩把整个页面压暗 → 其余信息自然退后（遮罩几何 = 整页）
    const mask = runChoiceMaskRect();
    expect(mask.w * mask.h).toBe(RUN_PAGE_W * RUN_PAGE_H);
    expect(stripComments(read('runPage.ts')).includes('rgba(')).toBe(true);
    // 三个选项的名称 / 一句结果都是玩家可读文案（无内部字段 / 无数值表）
    for (const o of RUN_CHOICE_OPTIONS) {
      expect(/^[\u4e00-\u9fa5]{2,6}$/.test(o.label), `名称应为短中文：${o.label}`).toBe(true);
      expect(/[\d]/.test(o.note), `一句结果不应是数值表：${o.note}`).toBe(false);
    }
    // 浮层出现时只有浮层入账（底层几何整体退出精确色 → 焦点唯一）
    expect(layersOf(reachChoice()).map((l) => l.layer)).toEqual(['cardBar', 'cardBar', 'cardBar']);
  });
});

/* ================================ G. PRP-BUILD-01 两层 Build 闭环 */

describe('PRP-BUILD-01｜G 两层 Cannon Build：基础战斗 → 一层 → 强化战斗 → 二层条件池 → 最终战斗', () => {
  /**
   * 走完**三场**真实战斗 + **两次**选择（全程同一个页面 / 同一个状态机）：
   *   DAY 3 → 战斗①（基础）→ CHOICE① → 选择第一层 → DAY 4 → 战斗②（一层）
   *   → CHOICE②（**由第一层决定的条件池**）→ 选择第二层 → DAY 5 → 战斗③（两层）→ 终局 RESULT
   *
   * ⚠️ 到第三次 RESULT **就停**（这正是新流程的终点）；
   * 之后的「重新开始验证」由 RP-F2-08/09 断言。
   * ⚠️ 真实物理 3 场很慢 → 按 (layer1, layer2) 缓存，同一组合只跑一次。
   */
  const loopCache = new Map<string, BuildLoop>();
  interface BuildLoop {
    readonly trail: RunPageState[];
    readonly firstEnd: RunPageState;
    readonly afterChoice1: RunPageState;
    readonly choice2: RunPageState;
    readonly afterChoice2: RunPageState;
    /** 战斗②（第一层）开局时真正注入的耐久（= 规则算出的 carry）。 */
    readonly secondInitialHp: number;
    readonly finalRuntime: RunBattleRuntime;
    readonly finale: RunPageState;
  }
  function runBuildLoop(layer1: string, layer2: string): BuildLoop {
    const key = `${layer1}>${layer2}`;
    const hit = loopCache.get(key);
    if (hit) return hit;

    const rt1 = new RunBattleRuntime();
    let s = createRunPageState(CTX);
    const trail: RunPageState[] = [s]; // IDLE(DAY3)
    s = pressRunAction(s, CTX); // EVENT
    s = pressRunAction(s, CTX); // BATTLE①
    trail.push(s);
    s = driveToEnd(s, rt1); // RESULT
    trail.push(s);
    const firstEnd = s;
    rt1.dispose();

    s = pressRunAction(s, CTX); // CHOICE①（第一层三选一）
    trail.push(s);
    s = chooseRunBuff(s, layer1); // → IDLE(DAY4)
    trail.push(s);
    const afterChoice1 = s;

    const rt2 = new RunBattleRuntime({ build: runBuildIds(afterChoice1), carriedHp: runCarriedPlayerHp(afterChoice1) });
    const secondInitialHp = rt2.initialPlayerHp;
    s = pressRunAction(s, CTX); // EVENT
    s = pressRunAction(s, CTX); // BATTLE②
    trail.push(s);
    s = driveToEnd(s, rt2); // RESULT
    trail.push(s);
    rt2.dispose();

    s = pressRunAction(s, CTX); // CHOICE②（第二层条件池）
    trail.push(s);
    const choice2 = s;
    s = chooseRunBuff(s, layer2); // → IDLE(DAY5)
    trail.push(s);
    const afterChoice2 = s;

    const rt3 = new RunBattleRuntime({ build: runBuildIds(afterChoice2), carriedHp: runCarriedPlayerHp(afterChoice2) });
    s = pressRunAction(s, CTX); // EVENT
    s = pressRunAction(s, CTX); // BATTLE③
    trail.push(s);
    s = driveToEnd(s, rt3); // 终局 RESULT
    trail.push(s);

    const loop: BuildLoop = {
      trail,
      firstEnd,
      afterChoice1,
      choice2,
      afterChoice2,
      secondInitialHp,
      finalRuntime: rt3,
      finale: s,
    };
    loopCache.set(key, loop);
    return loop;
  }

  /**
   * 用**合成战果**快速推进到第 n 次 CHOICE（不跑真实物理）——只用于状态机结构断言。
   * `layer1 === null` → 停在第 1 次 CHOICE；否则停在第 2 次 CHOICE。
   */
  function syntheticChoice(layer1: string | null): RunPageState {
    let s = createRunPageState(CTX);
    s = pressRunAction(s, CTX); // EVENT
    s = pressRunAction(s, CTX); // BATTLE①
    s = finishRunBattle(s, { winner: 'A', endReason: 'hp', playerHp: 900, enemyHp: 0, steps: 300 });
    s = pressRunAction(s, CTX); // CHOICE①
    if (layer1 === null) return s;
    s = chooseRunBuff(s, layer1); // IDLE
    s = pressRunAction(s, CTX); // EVENT
    s = pressRunAction(s, CTX); // BATTLE②
    s = finishRunBattle(s, { winner: 'A', endReason: 'hp', playerHp: 800, enemyHp: 0, steps: 300 });
    s = pressRunAction(s, CTX); // CHOICE②
    return s;
  }

  it('RP-F2-01 完整两层闭环走完，全程同一页面（三次战斗 / 两次选择）', () => {
    const { trail } = runBuildLoop('heavyShell', 'kineticBurst');
    // trail 里同一 phase 可能连续出现 → 先连续去重，得到「状态切换序列」。
    const seq: string[] = [];
    for (const t of trail) if (seq[seq.length - 1] !== t.phase) seq.push(t.phase);
    expect(seq).toEqual([
      'IDLE', 'BATTLE', 'RESULT', 'CHOICE', 'IDLE',
      'BATTLE', 'RESULT', 'CHOICE', 'IDLE',
      'BATTLE', 'RESULT',
    ]);
    expect(seq.filter((p) => p === 'BATTLE').length).toBe(RUN_MAX_BATTLES);
    expect(seq.filter((p) => p === 'CHOICE').length).toBe(RUN_MAX_CHOICES);
    // transitions 单调递增（状态切换计数只增不减 → 同一页面内推进）
    for (let i = 1; i < trail.length; i++) {
      expect(trail[i].transitions).toBeGreaterThanOrEqual(trail[i - 1].transitions);
    }
    // 第一场无任何强化；第二场带一层；第三场带两层
    expect(trail[2].buffs.length).toBe(0);
    expect(runBuildIds(trail[trail.length - 4])).toEqual(['heavyShell']);
    expect(runBuildIds(trail[trail.length - 1])).toEqual(['heavyShell', 'kineticBurst']);
  });

  it('RP-F2-02 DAY 3 → 4 → 5，日志是玩家向自然语言 + 新 DAY 行', () => {
    const { firstEnd, afterChoice1, afterChoice2 } = runBuildLoop('twinCannon', 'tripleLoad');
    expect(firstEnd.day).toBe(RUN_INITIAL_DAY);
    expect(afterChoice1.day).toBe(RUN_INITIAL_DAY + 1);
    expect(afterChoice2.day).toBe(RUN_INITIAL_DAY + 2);
    expect(afterChoice2.day).toBeLessThanOrEqual(afterChoice2.dayTotal); // 结构上不可能是 8/7
    const texts = afterChoice2.log.map((e) => e.text);
    expect(texts).toContain('你为大炮加装了一门副炮。');
    expect(texts).toContain('你把副炮接进了主装填链。');
    expect(texts).toContain('DAY 4');
    expect(texts).toContain('DAY 5');
    // 两次选择各追加 2 行（强化结果 + DAY 行）
    expect(afterChoice1.log.length).toBe(firstEnd.log.length + 2);
    // 日志仍是纯自然语言（结构上吐不出方括号前缀）
    for (const e of afterChoice2.log) {
      expect(formatRunLog(e)).toBe(e.text);
      expect(/^\[/.test(e.text)).toBe(false);
    }
  });

  it('RP-F2-03 必改 4：跨战斗耐久逐场按同一规则传递（不自动满血）', () => {
    const { firstEnd, afterChoice1, afterChoice2, secondInitialHp, finalRuntime } = runBuildLoop(
      'fastReload',
      'recoilCharge',
    );
    // 规则（PRP-RUN-R1 起，`runCarriedPlayerHp`）：carry = 上一场真实剩余 + 维修补偿，上限截断。
    // ⚠️ 旧注释「<= 0 → null（满耐久开幕）」已作废：那正是被真人录屏抓到的 P0 缺陷。
    //    现在「上一场已结束」**恒返回一个数**（死亡 → 0），`null` 只剩「本次遭遇还没打过」一个含义。
    // ① 第一场：真实剩余确实低于上限
    const hp1 = firstEnd.battle!.playerHp;
    expect(hp1).toBeGreaterThan(0);
    expect(hp1).toBeLessThan(firstEnd.battle!.playerHpMax);
    expect(afterChoice1.repairBonus).toBe(0); // 第一层都不是维修项 → 无补偿
    expect(runCarriedPlayerHp(afterChoice1)).toBe(hp1);

    // ② 第二场**真的**以「第一场剩余」开局（这就是「不自动满血」的直接证据，
    //    而不是只检查状态机里的数字）。
    expect(secondInitialHp).toBe(hp1);
    expect(secondInitialHp).toBeLessThan(finalRuntime.playerMaxHp);

    // ③ 第二场 → 第三场沿用**同一条规则**（胜负由真实物理决定，不做任何数值调优）。
    //
    // ⚠️ PRP-RUN-R1 起这里**没有 else 分支**：若第二场 HP 归零，`finishRunBattle` 会直接
    //    进 `FAILED`（终态），第三场根本不存在 —— 所以「能走到这里」本身就等于
    //    「第二场存活」，这就是单一耐久真的续到第三场的直接证据。
    //    修复前这里有一条「0 HP → carry = null → 终局满耐久开幕」的兜底分支，
    //    正是被真人录屏抓到的那条错误路径。
    expect(afterChoice2.phase).toBe('IDLE');
    const hp2 = afterChoice2.battle!.playerHp;
    expect(hp2).toBeGreaterThan(0);
    const carry2 = runCarriedPlayerHp(afterChoice2);
    expect(carry2).toBe(hp2); // 上一场已结束时恒为真实剩余（死亡 → 0，绝不返回 null）
    expect(finalRuntime.initialPlayerHp).toBe(hp2);
    expect(finalRuntime.initialPlayerHp).toBeLessThan(finalRuntime.playerMaxHp);

    // 三场耐久**单调不增**：不存在任何隐藏回血（本路线没拿紧急维修 → repairBonus 全程 0）
    expect(afterChoice1.repairBonus).toBe(0);
    expect(afterChoice2.repairBonus).toBe(0);
    expect(hp1).toBeLessThanOrEqual(afterChoice1.battle!.playerHpMax);
    expect(hp2).toBeLessThanOrEqual(hp1);
    expect(finalRuntime.initialPlayerHp).toBeLessThanOrEqual(hp2);
    expect(finalRuntime.playerMaxHp).toBe(afterChoice2.battle!.playerHpMax);

    // 演示遭遇余量（PRP-RUN-R1 换用 Build Prototype Encounter = `LightRusher` 之后的实测）：
    // 第一场（无强化）只损约 1/6 耐久，而不是旧 `Chaser` 的 ~75% → 三场验证有稳定余量。
    expect(hp1).toBeGreaterThan(afterChoice2.battle!.playerHpMax * 0.75);
    finalRuntime.dispose();
  });

  it('RP-F2-04 必改 6：最终战斗的运行时**真的**同时携带两层（不是只写 state / 只画图标）', () => {
    // 三条路线各跑一次；每条的第三场都必须同时带「一层 + 二层」
    const routes: readonly [string, string][] = [
      ['heavyShell', 'kineticBurst'],
      ['twinCannon', 'tripleLoad'],
      ['fastReload', 'recoilCharge'],
    ];
    for (const [l1, l2] of routes) {
      const { finalRuntime } = runBuildLoop(l1, l2);
      expect(finalRuntime.build).toEqual([l1, l2]);
      const params = finalRuntime.orchestrator.vehicleA.parts.find(
        (p) => p.def.category === 'weapon',
      )!.def.behaviorParams as Record<string, unknown>;
      if (l1 === 'heavyShell') {
        // 一层：重弹三项冻结值
        expect(params.projectileRadius).toBe(16);
        expect(params.projectileMass).toBe(4);
        expect(params.recoilImpulse).toBe(90);
        expect(params.cooldownMs).toBe(1000);
      }
      if (l1 === 'twinCannon' && l2 === 'tripleLoad') {
        // 二层：**在双联基础上**抬到三连（真实 burst，间隔不变）
        expect(params.burstRounds).toBe(3);
        expect(params.burstIntervalMs).toBe(100);
        expect(params.fanAnglesDeg).toBeUndefined();
      }
      if (l1 === 'fastReload') {
        expect(params.cooldownMs).toBe(650);
        expect(params.projectileMass).toBe(1); // 其它字段一律沿用正式 Cannon
      }
      // 能力类第二层的真实运行状态随 Build 一起注入
      const ab = finalRuntime.abilitySnapshot();
      expect(ab.kineticBurst).toBe(l2 === 'kineticBurst');
      expect(ab.recoilCharge).toBe(l2 === 'recoilCharge');
      finalRuntime.dispose();
    }
  });

  it('RP-F2-05 必改 3：Build 只在本局 —— 新开 Run 立刻回到基础状态', () => {
    const { afterChoice1, finalRuntime } = runBuildLoop('fastReload', 'recoilCharge');
    expect(runBuildIds(afterChoice1)).toEqual(['fastReload']);
    finalRuntime.dispose();
    const fresh = createRunPageState(CTX);
    expect(runBuildIds(fresh)).toEqual([]);
    expect(fresh.repairBonus).toBe(0);
    expect(fresh.day).toBe(RUN_INITIAL_DAY);
    expect(fresh.battlesCompleted).toBe(0);
    expect(runVerificationComplete(fresh)).toBe(false);
    // 新局用基础运行时 → 武器回到正式定义，能力全关
    const rt = new RunBattleRuntime();
    expect(rt.build).toEqual([]);
    expect(rt.modifier).toBeNull();
    const params = rt.orchestrator.vehicleA.parts.find(
      (p) => p.def.category === 'weapon',
    )!.def.behaviorParams as Record<string, number>;
    expect(params.cooldownMs).toBe(1000);
    expect(params.projectileRadius).toBe(10);
    const ab = rt.abilitySnapshot();
    expect(ab.kineticBurst).toBe(false);
    expect(ab.recoilCharge).toBe(false);
    rt.dispose();
  });

  it('RP-F2-06 宿主把 build / carriedHp 真正注入每次新建的战斗', () => {
    const src = stripComments(read('runPage.ts'));
    expect(src.includes('runCarriedPlayerHp')).toBe(true);
    expect(src.includes('runBuildIds')).toBe(true);
    // beginBattle 必须同时传两项 Run-local 状态（缺一即「选了强化但下一场没生效」）
    expect(/new RunBattleRuntime\(\{[\s\S]{0,220}build:\s*runBuildIds\(this\.state\)/.test(src)).toBe(true);
    expect(/new RunBattleRuntime\(\{[\s\S]{0,260}carriedHp:\s*runCarriedPlayerHp\(this\.state\)/.test(src)).toBe(
      true,
    );
    // 遭遇结束时释放旧运行时 → 弹丸 / 事件订阅 / 世界不跨场残留
    expect(src.includes('this.battle.dispose()')).toBe(true);
  });

  it('RP-F2-07 宿主入口仍是唯一画布点击源，且卡片来自**当前候选池**（无 DOM 按钮 / 无跳转）', () => {
    const src = stripComments(read('runPage.ts'));
    expect(src.includes('runChoiceCardRects(pool.length)')).toBe(true);
    expect(src.includes('chooseRunBuff(this.state, pool[i].id)')).toBe(true);
    expect(src.includes('const pool = runChoicePool(this.state)')).toBe(true);
    expect(src.includes('location.href')).toBe(false);
    expect(src.includes('window.open')).toBe(false);
  });

  it('RP-F2-08 第三场结束 = 验证结束：不再进 CHOICE、不再加 Day、主动作=重新开始验证', () => {
    const { finale, afterChoice2, finalRuntime } = runBuildLoop('heavyShell', 'kineticBurst');
    expect(finale.phase).toBe('RESULT');
    expect(finale.battlesCompleted).toBe(RUN_MAX_BATTLES);
    expect(runVerificationComplete(finale)).toBe(true);
    // day 停在 DAY 5（**没有** DAY 6/7，更不可能是 8/7）
    expect(finale.day).toBe(afterChoice2.day);
    expect(finale.day).toBe(RUN_INITIAL_DAY + 2);
    expect(runBuildIds(finale)).toEqual(['heavyShell', 'kineticBurst']); // 两层仍在，但没有第三层
    expect(runActionLabel(finale)).toBe(RUN_RESTART_LABEL);
    expect(runActionEnabled(finale)).toBe(true);
    // 终局 RESULT 的第三行叙事改为「验证结束」，不再引导下一次改装
    expect(finale.log[finale.log.length - 1].text).toBe('本次改装的验证到此结束。');
    expect(finale.log.some((e) => e.text === '你发现了一次改装机会……')).toBe(true); // 前两场那两次仍在
    finalRuntime.dispose();
  });

  it('RP-F2-09 重新开始验证 = 全新 Run（DAY 3 / Build 清零 / 耐久回初始）', () => {
    const { finale, finalRuntime } = runBuildLoop('twinCannon', 'tripleLoad');
    const restart = pressRunAction(finale, CTX);
    finalRuntime.dispose();

    expect(restart).not.toBe(finale); // 不是原地改状态，而是**新局**
    expect(restart.phase).toBe('IDLE');
    expect(restart.day).toBe(RUN_INITIAL_DAY);
    expect(restart.dayTotal).toBe(RUN_TOTAL_DAYS);
    expect(restart.buffs).toEqual([]);
    expect(runBuildIds(restart)).toEqual([]);
    expect(restart.repairBonus).toBe(0);
    expect(restart.battlesCompleted).toBe(0);
    expect(restart.battle).toBeNull();
    expect(runCarriedPlayerHp(restart)).toBeNull(); // 新局第一场从满耐久开始
    expect(restart.log.length).toBe(2);
    expect(restart.log.map((e) => e.text)).toContain(`DAY ${RUN_INITIAL_DAY}`);
    expect(restart.phaseTrail).toEqual(['IDLE']);
    expect(runActionLabel(restart)).toBe('继续');
    expect(runVerificationComplete(restart)).toBe(false);
    // 新局第一场照样是第一层三选一（可换一条路线做同条件独立验证）
    let s = pressRunAction(restart, CTX);
    s = pressRunAction(s, CTX);
    s = finishRunBattle(s, { winner: 'A', endReason: 'hp', playerHp: 600, enemyHp: 0, steps: 400 });
    s = pressRunAction(s, CTX);
    expect(s.phase).toBe('CHOICE');
    expect(runChoicePool(s).map((o) => o.id)).toEqual(RUN_CHOICE_OPTIONS.map((o) => o.id));
    const other = chooseRunBuff(s, 'fastReload');
    expect(runBuildIds(other)).toEqual(['fastReload']);
    expect(other.day).toBe(RUN_INITIAL_DAY + 1);
  });

  it('RP-F2-10 必改 1：第二次候选池由第一层决定（不是同一套通用三选一）', () => {
    for (const l1 of ['heavyShell', 'twinCannon', 'fastReload'] as const) {
      const atChoice2 = syntheticChoice(l1);
      expect(atChoice2.phase).toBe('CHOICE');
      const pool = runChoicePool(atChoice2).map((o) => o.id);
      expect(pool).toEqual([...RUN_LAYER2_POOLS[l1]]);
      expect(pool.length).toBe(3);
      // 结构 = 强联动 / 安全通用 / 轻度转向（槽位语义；第三格复用第一层的定义 → role 'base'）
      expect(runModifierById(pool[0])!.role).toBe('synergy');
      expect(runModifierById(pool[1])!.role).toBe('safe');
      expect(RUN_LAYER1_POOL).toContain(pool[2]);
      expect(pool[2]).not.toBe(l1); // 转向的是另一个方向
      // 第二次池与第一次池**不是同一套**（至少两项不同）
      const l1Pool = RUN_CHOICE_OPTIONS.map((o) => o.id);
      expect(pool.filter((id) => l1Pool.includes(id)).length).toBeLessThanOrEqual(1);
    }
    // 三个池的强联动各不相同（三条 Build 方向）
    expect(RUN_LAYER2_POOLS.heavyShell[0]).toBe('kineticBurst');
    expect(RUN_LAYER2_POOLS.twinCannon[0]).toBe('tripleLoad');
    expect(RUN_LAYER2_POOLS.fastReload[0]).toBe('recoilCharge');
  });

  it('RP-F2-11 一局最多两次选择，且第二次只能从条件池里选（池外选项被拒）', () => {
    const atChoice1 = syntheticChoice(null);
    const chosen1 = chooseRunBuff(atChoice1, 'heavyShell');
    expect(runBuildIds(chosen1)).toEqual(['heavyShell']);

    // 非 CHOICE 状态下再选 → no-op（同引用）
    expect(chooseRunBuff(chosen1, 'kineticBurst')).toBe(chosen1);

    const atChoice2 = syntheticChoice('heavyShell');
    // 池外选项（第一层的另两项之一，且不在本池）→ 拒绝
    expect(runChoicePool(atChoice2).map((o) => o.id)).toEqual(['kineticBurst', 'emergencyRepair', 'fastReload']);
    expect(chooseRunBuff(atChoice2, 'twinCannon')).toBe(atChoice2);
    // 池内选项 → 接受
    const chosen2 = chooseRunBuff(atChoice2, 'kineticBurst');
    expect(runBuildIds(chosen2)).toEqual(['heavyShell', 'kineticBurst']);

    // 已选满两次 → 即使强行改回 CHOICE 也被拒（防第三层 / 多 Buff 累计）
    const forced = { ...chosen2, phase: 'CHOICE' as const };
    expect(chooseRunBuff(forced, 'fastReload')).toBe(forced);
    expect(forced.buffs.length).toBe(RUN_MAX_CHOICES);
  });

  it('RP-F2-12 必改 5：三条路线的强联动都能完整执行（一层 → 二层 → 最终真实战斗）', () => {
    const routes: readonly [string, string, string][] = [
      ['heavyShell', 'kineticBurst', '动能爆发'],
      ['twinCannon', 'tripleLoad', '三连装填'],
      ['fastReload', 'recoilCharge', '反冲蓄能'],
    ];
    for (const [l1, l2, label] of routes) {
      const { choice2, afterChoice2, finale } = runBuildLoop(l1, l2);
      // 第二次选择时，强联动确实出现在**由第一层决定**的那一格
      const pool = runChoicePool(choice2);
      expect(pool[0].id).toBe(l2);
      expect(pool[0].label).toBe(label);
      expect(afterChoice2.log[afterChoice2.log.length - 2].text).toBe(runModifierById(l2)!.logText);
      expect(runBuildIds(afterChoice2)).toEqual([l1, l2]);
      // 最终战斗真的打完（不是卡死）
      expect(finale.phase).toBe('RESULT');
      expect(finale.battle!.steps).toBeGreaterThan(0);
    }
  });

  it('RP-F2-13 紧急维修：真实耐久补偿，且不改写上一场的战斗记录', () => {
    const atChoice2 = syntheticChoice('heavyShell');
    const hpBefore = atChoice2.battle!.playerHp;
    const maxHp = atChoice2.battle!.playerHpMax;
    const healed = chooseRunBuff(atChoice2, 'emergencyRepair');
    const expectHeal = Math.round(maxHp * EMERGENCY_REPAIR_FRACTION);
    // 上一场的真实结果**原样保留**（不是把 battle.playerHp 改大）
    expect(healed.battle!.playerHp).toBe(hpBefore);
    expect(healed.repairBonus).toBe(expectHeal);
    // 下一场开局耐久 = 真实剩余 + 补偿（且不超过上限）
    expect(runCarriedPlayerHp(healed)).toBe(Math.min(maxHp, hpBefore + expectHeal));
    expect(runCarriedPlayerHp(healed)!).toBeGreaterThan(hpBefore);
    // 维修不改武器（本局武器仍是第一层那一项）
    expect(runBuildIds(healed)).toEqual(['heavyShell', 'emergencyRepair']);
    // 真实注入：下一场的开局 HP 就是补偿后的数值
    const rt = new RunBattleRuntime({ build: runBuildIds(healed), carriedHp: runCarriedPlayerHp(healed) });
    expect(rt.initialPlayerHp).toBe(Math.min(maxHp, hpBefore + expectHeal));
    expect(rt.playerMaxHp).toBe(maxHp);
    rt.dispose();
  });

  it('RP-F2-14 单一耐久贯穿三场：每场开局 = 上一场结束，全程单调不增（无隐藏回血）', () => {
    /**
     * 三条路线的**冻结实测值**（PRP-RUN-R1｜ProtoRusher 下的真实物理结果，Node 端确定性）。
     *
     * ⚠️ 与 RP-19 / RP-22 同一纪律：这些是**冻结字面量**而不是就地重算 ——
     *    任何影响三场连锁的改动（对手 / 武器 / 物理）都必须回到这里显式更新，
     *    从而让「三场能不能跑完」这件事无法悄悄变化。
     *    表内 = [第一场结束(=第二场开局), 第二场结束(=第三场开局), 第三场结束]。
     */
    const FROZEN: Record<string, readonly [number, number, number]> = {
      // ⚠️ PRP-BUILD-01-R1：kineticBurst 的追加冲量从质心改到**真实命中点**（产生扭矩），
      //    增益 12 → 28；实测第一/第二场开局不变，第三场残血 537 → 430（已按真实测量显式更新，
      //    不是就地重算）。40% 余量仍在，三场连锁没有被"一次强化把末场打崩"。
      'heavyShell+kineticBurst': [843, 714, 430],
      'twinCannon+tripleLoad': [843, 678, 470],
      'fastReload+recoilCharge': [843, 622, 350],
    };
    const routes: readonly [string, string][] = [
      ['heavyShell', 'kineticBurst'],
      ['twinCannon', 'tripleLoad'],
      ['fastReload', 'recoilCharge'],
    ];
    for (const [l1, l2] of routes) {
      const key = `${l1}+${l2}`;
      const { finale, firstEnd, afterChoice1, afterChoice2, secondInitialHp, finalRuntime } = runBuildLoop(
        l1,
        l2,
      );
      const hp1 = firstEnd.battle!.playerHp;
      const hp2 = afterChoice2.battle!.playerHp;
      const hp3 = finale.battle!.playerHp;

      // ① 第一场确实掉过血，但远未致命（低压验证对手：1100 → 843，只损 257）
      expect(hp1).toBeLessThan(firstEnd.battle!.playerHpMax);
      expect(Math.round(hp1), key).toBe(FROZEN[key][0]);

      // ② 第二场开局**就是**第一场结束（不是重算、不是满耐久）
      expect(secondInitialHp, `${key}: 第二场开局`).toBe(hp1);
      expect(Math.round(hp2), key).toBe(FROZEN[key][1]);

      // ③ 第三场开局**就是**第二场结束；终局真的打完（RESULT，不是 FAILED）
      expect(finalRuntime.initialPlayerHp, `${key}: 第三场开局`).toBe(hp2);
      expect(finale.phase, `${key}: 终局`).toBe('RESULT');
      expect(Math.round(hp3), key).toBe(FROZEN[key][2]);

      // ④ 单调不增（三场都没拿紧急维修 → repairBonus 恒 0，carry 就是真实剩余）
      expect(afterChoice1.repairBonus).toBe(0);
      expect(afterChoice2.repairBonus).toBe(0);
      expect(hp2, `${key}: hp2<=hp1`).toBeLessThanOrEqual(hp1);
      expect(hp3, `${key}: hp3<=hp2`).toBeLessThanOrEqual(hp2);

      // ⑤ 三场都活着，且终局留下可观余量（32%~43%）—— 不是勉强擦线
      expect(hp1, `${key}: 第一场存活`).toBeGreaterThan(0);
      expect(hp2, `${key}: 第二场存活`).toBeGreaterThan(0);
      expect(hp3, `${key}: 第三场存活`).toBeGreaterThan(0);
      expect(hp3, `${key}: 末场余量`).toBeGreaterThan(finalRuntime.playerMaxHp * 0.3);
      finalRuntime.dispose();
    }
  });
});

/* ============ I. PRP-RUN-R1：「HP <= 0 = 本局立即失败」与耐久连续性修复 */

describe('PRP-RUN-R1｜I 死亡即终局：单一耐久贯穿 Run、失败后只能重开', () => {
  /** 合成一份「刚打完一场真实战斗」的 BATTLE 状态（不跑物理，纯状态机）。 */
  function atBattle(): RunPageState {
    return pressRunAction(pressRunAction(createRunPageState(CTX), CTX), CTX);
  }

  it('RP-R1-01 任意一场 Player HP = 0 → 立即 FAILED（不经过 RESULT、Day 不推进）', () => {
    // 先在 CHOICE 里拿一层，确保失败时**本局 Build 非空**（Build 必须原样保留给人看）
    let s = atBattle();
    s = finishRunBattle(s, { winner: 'A', endReason: 'hp', playerHp: 700, enemyHp: 0, steps: 300 });
    expect(s.phase).toBe('RESULT');
    s = pressRunAction(s, CTX); // CHOICE
    s = chooseRunBuff(s, 'heavyShell'); // → IDLE(DAY 4)
    expect(s.day).toBe(RUN_INITIAL_DAY + 1);
    const dayBeforeDeath = s.day;

    s = pressRunAction(s, CTX); // EVENT
    s = pressRunAction(s, CTX); // BATTLE②
    const logBeforeDeath = s.log;
    s = finishRunBattle(s, { winner: 'B', endReason: 'hp', playerHp: 0, enemyHp: 420, steps: 500 });

    // ① 直接进失败终态（**没有** RESULT 这一站）
    expect(s.phase).toBe('FAILED');
    expect(runFailed(s)).toBe(true);
    expect(s.phaseTrail[s.phaseTrail.length - 1]).toBe('FAILED');
    // 这一场是 BATTLE → FAILED（第一场那次 RESULT 仍在历史里，但**之后**没再出现 RESULT）
    expect(s.phaseTrail.slice(-2)).toEqual(['BATTLE', 'FAILED']);
    expect(s.phaseTrail.lastIndexOf('RESULT')).toBeLessThan(s.phaseTrail.length - 1);
    // ② Day 不推进（失败不发生 Day 前进）
    expect(s.day).toBe(dayBeforeDeath);
    // ③ 最终 Build 原样保留（失败页要展示它）
    expect(runBuildIds(s)).toEqual(['heavyShell']);
    // ④ 战斗记录如实保留（真实 HP 0，没有被改写成满耐久）
    expect(s.battle!.playerHp).toBe(0);
    expect(s.battle!.done).toBe(true);
    expect(s.battle!.endReason).toBe('hp');
    // ⑤ 失败只追加**两行**（失败叙事 + 真实耐久），且这两行里没有任何「继续 / 改装机会」引导
    expect(s.log.length).toBe(logBeforeDeath.length + 2);
    const tail = s.log.slice(-2).map((e) => e.text);
    expect(tail[0]).toBe(`战车耐久耗尽，DAY ${dayBeforeDeath} 的验证到此结束。`);
    expect(tail[1]).toBe('战车耐久剩余 0%。');
    for (const line of tail) {
      expect(line.includes('改装机会')).toBe(false);
      expect(line.includes('继续')).toBe(false);
    }
    // 第一场那次「改装机会」仍在历史里（日志只追加、不清空）——只是不会再引出第二次
    expect(logBeforeDeath.some((e) => e.text === '你发现了一次改装机会……')).toBe(true);
    expect(s.log.slice(-2).some((e) => e.text === '你发现了一次改装机会……')).toBe(false);
    for (const e of s.log) expect(/^\[/.test(e.text)).toBe(false);
  });

  it('RP-R1-02 FAILED 下结构上进不了 CHOICE：不推进 Day、不接受选卡、主动作=重新开始验证', () => {
    let s = atBattle();
    s = finishRunBattle(s, { winner: 'B', endReason: 'hp', playerHp: 0, enemyHp: 900, steps: 300 });
    expect(s.phase).toBe('FAILED');

    // 三选一浮层不打开
    expect(runChoiceOpen(s)).toBe(false);
    // 主动作可用，但文案是「重新开始验证」（不是「继续」）
    expect(runActionEnabled(s)).toBe(true);
    expect(runActionLabel(s)).toBe(RUN_RESTART_LABEL);
    expect(runStartsNewRun(s)).toBe(true);
    // 直接调 chooseRunBuff 也不能改变任何东西（准入要求 phase === 'CHOICE'）
    expect(chooseRunBuff(s, 'kineticBurst')).toBe(s);
    expect(chooseRunBuff(s, 'heavyShell')).toBe(s);
    expect(runBuildIds(chooseRunBuff(s, 'heavyShell'))).toEqual([]);
    // Day / 战斗记录 / 阶段都没被这些尝试推动
    expect(s.day).toBe(RUN_INITIAL_DAY);
    expect(s.phase).toBe('FAILED');

    // ⚠️ 关键回归：`runCarriedPlayerHp` 不再把死亡伪装成「满耐久开幕」。
    //    修复前它返回 null，调用方 `carried ?? playerHpMax` 会开出满耐久下一场。
    expect(runCarriedPlayerHp(s)).toBe(0);
    expect(runCarriedPlayerHp(s)).not.toBeNull();
  });

  it('RP-R1-03 失败后「重新开始验证」= 全新 Run（满耐久 / DAY 初始 / Build 与补偿清空）', () => {
    let s = atBattle();
    s = finishRunBattle(s, { winner: 'A', endReason: 'hp', playerHp: 600, enemyHp: 0, steps: 300 });
    s = pressRunAction(s, CTX);
    s = chooseRunBuff(s, 'twinCannon');
    s = pressRunAction(s, CTX);
    s = pressRunAction(s, CTX);
    s = finishRunBattle(s, { winner: 'B', endReason: 'hp', playerHp: 0, enemyHp: 300, steps: 300 });
    expect(s.phase).toBe('FAILED');
    expect(runBuildIds(s)).toEqual(['twinCannon']);

    const restart = pressRunAction(s, CTX);
    expect(restart).not.toBe(s); // 不是原地改状态，而是**新局**
    expect(restart.phase).toBe('IDLE');
    expect(restart.day).toBe(RUN_INITIAL_DAY);
    expect(restart.dayTotal).toBe(RUN_TOTAL_DAYS);
    expect(restart.buffs).toEqual([]);
    expect(runBuildIds(restart)).toEqual([]);
    expect(restart.repairBonus).toBe(0);
    expect(restart.battlesCompleted).toBe(0);
    expect(restart.battle).toBeNull();
    expect(runFailed(restart)).toBe(false);
    expect(runStartsNewRun(restart)).toBe(false); // 新局的「继续」是继续**当前** Run
    expect(runActionLabel(restart)).toBe('继续');
    expect(runCarriedPlayerHp(restart)).toBeNull(); // 唯一合法的「满耐久开幕」来源
    expect(restart.phaseTrail).toEqual(['IDLE']);
    expect(restart.log.length).toBe(2);

    // ⚠️ 必改 3：两种「按主动作」必须可区分 ——
    //    失败/终局的这一下**开新 Run**；RESULT（未打完）的那一下**继续当前 Run**。
    let mid = pressRunAction(pressRunAction(restart, CTX), CTX); // EVENT → BATTLE
    mid = finishRunBattle(mid, { winner: 'A', endReason: 'hp', playerHp: 800, enemyHp: 0, steps: 300 });
    expect(mid.phase).toBe('RESULT');
    expect(runStartsNewRun(mid)).toBe(false);
    expect(runActionLabel(mid)).toBe('继续');
    const carried = pressRunAction(mid, CTX);
    expect(carried.phase).toBe('CHOICE'); // 继续**当前** Run
    expect(carried.day).toBe(mid.day); // 未选择前 Day 不动
    expect(runBuildIds(carried)).toEqual([]);
  });

  it('RP-R1-04 真实物理确实能打出 HP = 0（死亡不是假设输入；状态机对真实战果生效）', () => {
    // 夹具用**既有 Lab encounter** `RangedTurret`（OPP-03，停驻重炮）——它在同一玩家装载下
    // 第一场就打死玩家。这里只用它来**客观产生**一次真实死亡，不参与 PRP 的演示流程。
    const plan = buildSpawnPlan(RUN_DEMO_LOADOUT_ID, 'RangedTurret');
    const rt = new PlanckBattleOrchestrator(plan.player.snapshot, plan.enemies[0].snapshot, registry, {}, false);
    let frames = 0;
    while (rt.result === null && frames < MAX_FRAMES) {
      rt.step(FRAME_MS, 1);
      frames += 1;
    }
    const result = rt.result;
    expect(result, '夹具必须真的分出胜负').not.toBeNull();
    // 真实物理死亡：HP 恰好归零、官方 winner = B、官方 endReason = hp
    expect(rt.vehicleA.hp).toBe(0);
    expect(result!.winner).toBe('B');
    expect(result!.endReason).toBe('hp');
    const enemyHp = rt.vehicleB.hp;
    rt.dispose();

    // 把**真实战果**喂给状态机 → 必须进 FAILED
    let s = atBattle();
    s = finishRunBattle(s, { winner: 'B', endReason: 'hp', playerHp: 0, enemyHp, steps: frames });
    expect(s.phase).toBe('FAILED');
    expect(s.battle!.playerHp).toBe(0);
    expect(s.battlesCompleted).toBe(1); // 这一场确实打完了（战败也计入）
    expect(runCarriedPlayerHp(s)).toBe(0);
    expect(runStartsNewRun(s)).toBe(true);
  });

  it('RP-R1-05 未死的战败（phase 结束）不误判为失败：判据是真实 HP，不是 winner', () => {
    // 构造「玩家落败但仍有耐久」的官方结果形态（endReason = 'phase'，HP > 0）
    let s = atBattle();
    s = finishRunBattle(s, { winner: 'B', endReason: 'phase', playerHp: 350, enemyHp: 800, steps: 900 });
    expect(s.phase).toBe('RESULT'); // 不是 FAILED
    expect(runFailed(s)).toBe(false);
    expect(runStartsNewRun(s)).toBe(false);
    expect(runCarriedPlayerHp(s)).toBe(350); // 血还在 → 可继续，且带着这 350 继续
    const next = pressRunAction(s, CTX);
    expect(next.phase).toBe('CHOICE');
  });

  it('RP-R1-06 Build Prototype Encounter 只是**引用**既有正式模板（零数值改动），且低压余量可量化', () => {
    const rusher = LAB_ENCOUNTERS.find((e) => e.id === RUN_DEMO_ENCOUNTER_ID)!;
    // ① 引用的模板 id 在正式对手池里真实存在（不是悬空 id）
    const official = OPPONENT_TEMPLATES.find((t) => t.id === rusher.templateId);
    expect(official, `正式对手池必须有 ${rusher.templateId}`).toBeDefined();
    // ② 单体一车 + Draft **逐字段等于**正式池那一套 → 证明「没有修改正式敌人定义」
    expect(rusher.count).toBe(1);
    expect(rusher.draft).toEqual(official!.draft);
    // ③ PRP 演示组合真的指向它（单车）
    const plan = buildSpawnPlan(RUN_DEMO_LOADOUT_ID, RUN_DEMO_ENCOUNTER_ID);
    expect(plan.encounterId).toBe(RUN_DEMO_ENCOUNTER_ID);
    expect(plan.enemies.length).toBe(1);
    // ④ 第一场（无强化）的真实余量：明显更低压，但**仍然真实接敌**（会掉血、敌人真的被打死）
    let s = atBattle();
    const rt = new RunBattleRuntime();
    s = driveToEnd(s, rt);
    const maxHp = s.battle!.playerHpMax;
    const hp1 = s.battle!.playerHp;
    expect(s.phase).toBe('RESULT'); // 第一场不死
    expect(s.battle!.winner).toBe('A');
    expect(s.battle!.endReason).toBe('hp');
    expect(s.battle!.enemyHp).toBe(0); // 敌人真的被打死（不是放水 / 无接触）
    expect(hp1).toBeGreaterThan(0);
    expect(hp1).toBeGreaterThan(maxHp * 0.7); // 余量 > 70%（旧 Chaser 同一场只剩 24.5%）
    expect(hp1).toBeLessThan(maxHp); // 但确实掉血了 —— 不是「无接敌」
    rt.dispose();
  });
});
