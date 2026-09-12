/**
 * PRP-F0-RUN-PAGE-SHELL｜PRP-R3-CAPYBARA-UI-HIERARCHY-REBUILD
 * Portrait Run Prototype —— Run Page targeted 测试（纯 node，无 DOM）。
 *
 * 覆盖六层：
 *   A) 页面层级：竖屏 390×844 四条横带无缝无叠；**PRP-R3 新比例**（顶 8~10 / 台 33~36 / 志 40~45 / 作 8~10）；
 *   B) 五状态机与固定演示流程：IDLE → EVENT → BATTLE → RESULT → CHOICE → IDLE（同一页面内）；
 *   C) 侧视战斗舞台：玩家固定左 / 敌人固定右、EVENT 出现 / RESULT 消失、演出位移不影响数值；
 *   D) 面积账本：逐帧整页像素面积**精确冻结**（浏览器端再用真实 getImageData 交叉核对）；
 *   E) 源码守卫：Debug 与玩家界面分离、不接 Arena A/B、不接 Planck、不存在任何页面跳转；
 *   F) **PRP-R3 信息层级**：顶部无空槽 / 战斗主体是真实车辆 sprite / 日志是玩家叙事 / CHOICE 独占焦点。
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
  RUN_SIDE_VIEW_CLOSING_PX,
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
  runStageGroundY,
  type RunLayeredRect,
  type RunRect,
} from '../src/lab/portraitBattleLab/runPageLayout';
import {
  RUN_BATTLE_SCRIPT,
  RUN_CHOICE_OPTIONS,
  RUN_INITIAL_DAY,
  RUN_PHASES,
  RUN_TOTAL_DAYS,
  advanceRunBattle,
  chooseRunBuff,
  createRunPageState,
  durabilityPercent,
  formatRunLog,
  pressRunAction,
  runActionEnabled,
  runActionLabel,
  runChoiceOpen,
  visibleRunLog,
  type RunPageContext,
  type RunPageState,
} from '../src/lab/portraitBattleLab/runPageState';
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
  return runPaintedAreas(runPageLayerShapes(s, buildRunStageView(s.phase, s.battle)));
}

function layersOf(s: RunPageState): readonly RunLayeredRect[] {
  return runPageLayerShapes(s, buildRunStageView(s.phase, s.battle));
}

const CTX: RunPageContext = runPageContext();

/** 走完整条固定演示流程，返回每一步的状态（IDLE 起点 → 5 次状态切换）。 */
function runFullFlow(): { steps: RunPageState[]; finale: RunPageState } {
  const steps: RunPageState[] = [];
  let s = createRunPageState(CTX);
  steps.push(s); // IDLE
  s = pressRunAction(s, CTX); // EVENT
  steps.push(s);
  s = pressRunAction(s, CTX); // BATTLE
  steps.push(s);
  s = advanceRunBattle(s, RUN_BATTLE_SCRIPT.totalSteps); // RESULT
  steps.push(s);
  s = pressRunAction(s, CTX); // CHOICE
  steps.push(s);
  s = chooseRunBuff(s, RUN_CHOICE_OPTIONS[0].id); // IDLE
  steps.push(s);
  return { steps, finale: s };
}

/** 走到 RESULT（战斗已按脚本演完）的状态。 */
function reachResult(): RunPageState {
  return advanceRunBattle(
    pressRunAction(pressRunAction(createRunPageState(CTX), CTX), CTX),
    RUN_BATTLE_SCRIPT.totalSteps,
  );
}

/** 走到 CHOICE（改装机会浮层已打开）的状态。 */
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

  it('RP-03 中部舞台：玩家固定贴左、敌人固定贴右；车辆贴基线、地面不压带底', () => {
    const view = buildRunStageView('BATTLE', null);
    expect(view.groundY).toBe(runStageGroundY());
    expect(view.baselineY).toBe(runStageBaselineY());
    expect(view.baselineY).toBe(view.groundY - RUN_SIDE_VIEW.baselineLiftPx);
    expect(view.groundY).toBeGreaterThan(RUN_STAGE_BAND.y);
    expect(view.groundY).toBeLessThan(RUN_STAGE_BAND.y + RUN_STAGE_BAND.h);
    // 必改 2：地面不压在战斗区最底边（底下要留出路面）
    expect(RUN_STAGE_BAND.y + RUN_STAGE_BAND.h - view.groundY).toBeGreaterThanOrEqual(40);
    expect(inside(view.ground, RUN_STAGE_BAND)).toBe(true);
    expect(inside(view.road, RUN_STAGE_BAND)).toBe(true);

    // 玩家：左边缘 = 舞台左边距
    expect(view.player.bounds.x).toBe(RUN_STAGE_BAND.x + RUN_SIDE_VIEW.marginPx);
    // 敌人：右边缘 = 舞台右边界 − 右边距
    expect(view.enemy).not.toBeNull();
    const eb = view.enemy!.bounds;
    expect(eb.x + eb.w).toBe(RUN_STAGE_BAND.x + RUN_STAGE_BAND.w - RUN_SIDE_VIEW.marginPx);
    // 完全分离（中缝 = 约定值，取整误差 ≤ 1）
    const gap = eb.x - (view.player.bounds.x + view.player.bounds.w);
    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeGreaterThanOrEqual(RUN_SIDE_VIEW.gapPx - 1);
    // 都贴地（底边 = 基线，压在基线上方 2px，不污染路面纯色）
    expect(view.player.bounds.y).toBe(view.baselineY - view.player.bounds.h);
    expect(eb.y).toBe(view.baselineY - eb.h);
    expect(runRectsOverlap(view.player.bounds, view.ground)).toBe(false);
    expect(runRectsOverlap(eb, view.ground)).toBe(false);
    expect(runRectsOverlap(view.player.bounds, view.road)).toBe(false);
    expect(runRectsOverlap(eb, view.road)).toBe(false);
    // 全部可视件落在舞台带内（不得越出玩家可见区）
    for (const v of [...view.player.visuals, ...view.enemy!.visuals]) {
      expect(inside(v.rect, RUN_STAGE_BAND)).toBe(true);
    }
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

  it('RP-09 BATTLE：底部切为「战斗中」并不可误触推进；入场不写日志', () => {
    const ev = pressRunAction(createRunPageState(CTX), CTX);
    const bt = pressRunAction(ev, CTX);
    expect(bt.phase).toBe('BATTLE');
    expect(runActionLabel(bt)).toBe('战斗中');
    expect(runActionEnabled(bt)).toBe(false); // 禁触
    expect(pressRunAction(bt, CTX)).toBe(bt); // 同引用 = 真 no-op
    expect(bt.log).toEqual(ev.log); // 入场不写日志（保持记录稳定）
    expect(bt.battle).not.toBeNull();
    expect(bt.battle!.enemyHp).toBe(bt.battle!.enemyHpMax);
    expect(bt.battle!.steps).toBe(0);
    expect(bt.battle!.done).toBe(false);
  });

  it('RP-10 BATTLE 期间不刷逐帧伤害日志（多段推进日志条数不变、条目完全一致）', () => {
    const bt = pressRunAction(pressRunAction(createRunPageState(CTX), CTX), CTX);
    let cur = bt;
    for (const chunk of [1, 1, 1, 5, 13, 20]) {
      const next = advanceRunBattle(cur, chunk);
      expect(next.phase).toBe('BATTLE'); // 还没演完
      expect(next.log).toEqual(bt.log); // 日志零变化
      expect(next.log.length).toBe(bt.log.length);
      cur = next;
    }
    expect(cur.battle!.steps).toBe(41);
    expect(cur.battle!.enemyHp).toBeLessThan(bt.battle!.enemyHp);
    expect(cur.battle!.playerHp).toBeLessThan(bt.battle!.playerHp);
  });

  it('RP-11 RESULT：一次性追加 3 行玩家叙事（胜负 + 耐久百分比 + 改装机会），敌人离开舞台', () => {
    const bt = pressRunAction(pressRunAction(createRunPageState(CTX), CTX), CTX);
    const mid = advanceRunBattle(bt, RUN_BATTLE_SCRIPT.totalSteps - 1);
    expect(mid.phase).toBe('BATTLE');
    expect(mid.log.length).toBe(bt.log.length); // 倒数第二步仍不写日志

    const res = advanceRunBattle(mid, 1);
    expect(res.phase).toBe('RESULT');
    expect(res.log.length).toBe(bt.log.length + 3); // 一次性只加三条
    const added = res.log.slice(-3);
    expect(added[0].kind).toBe('result');
    expect(added[0].text).toBe('战斗胜利。');
    expect(added[1].kind).toBe('durability');
    expect(added[1].text).toBe(`战车耐久剩余 ${durabilityPercent(res.battle!)}%。`);
    expect(added[1].text).toContain('78%'); // 1100 → 858
    expect(added[2].kind).toBe('result');
    expect(added[2].text).toBe('你发现了一次改装机会……');
    expect(res.battle!.enemyHp).toBe(0);
    expect(res.battle!.done).toBe(true);
    expect(runActionLabel(res)).toBe('继续');
    expect(runActionEnabled(res)).toBe(true);
    // 敌方进入结束 / 消失状态
    const view = buildRunStageView(res.phase, res.battle);
    expect(view.enemy).toBeNull();
    expect(view.enemyGone).toBe(true);
  });

  it('RP-12 CHOICE：浮层打开、日志不变、原页面几何与位置一字不动', () => {
    const res = reachResult();
    const before = buildRunStageView(res.phase, res.battle);
    const ch = pressRunAction(res, CTX);
    expect(ch.phase).toBe('CHOICE');
    expect(runChoiceOpen(ch)).toBe(true);
    expect(ch.log).toEqual(res.log); // 既不加也不减
    expect(ch.buffs).toEqual(res.buffs);
    const after = buildRunStageView(ch.phase, ch.battle);
    // 原页面位置 / 尺寸不变化（只有遮罩 + 浮层叠上去）
    expect(after.player).toEqual(before.player);
    expect(after.ground).toEqual(before.ground);
    expect(after.road).toEqual(before.road);
    expect(after.enemy).toBeNull();
    expect(after.enemyGone).toBe(true);
    // 浮层出现其间「原页面整体变暗」= 遮罩恰好覆盖整个逻辑舞台（不多不少）
    expect(runChoiceMaskRect()).toEqual({ x: 0, y: 0, w: RUN_PAGE_W, h: RUN_PAGE_H });
  });

  it('RP-13 选择后回到 IDLE：顶部新增图标 + 日志追加自然语言结果 + 历史完整', () => {
    const { steps, finale } = runFullFlow();
    const choice = steps[4];
    expect(choice.phase).toBe('CHOICE');
    expect(finale.phase).toBe('IDLE');
    expect(finale.buffs.length).toBe(choice.buffs.length + 1);
    expect(finale.buffs[0].id).toBe(RUN_CHOICE_OPTIONS[0].id);
    expect(finale.buffs[0].label).toBe('重型弹头');
    expect(finale.log.length).toBe(choice.log.length + 1);
    const last = finale.log[finale.log.length - 1];
    expect(last.kind).toBe('choice');
    expect(last.text).toBe('你换上了重型弹头。');
    // 历史完整：CHOICE 之前的全部行原样保留
    expect(finale.log.slice(0, choice.log.length)).toEqual(choice.log);
    // seq 连续单调
    for (let i = 1; i < finale.log.length; i++) expect(finale.log[i].seq).toBe(finale.log[i - 1].seq + 1);
  });

  it('RP-14 误触保护：BATTLE / CHOICE 阶段按主动作 no-op；未知强化 id no-op', () => {
    const { steps } = runFullFlow();
    const bt = steps[2];
    const res = steps[3];
    expect(pressRunAction(bt, CTX)).toBe(bt);
    expect(advanceRunBattle(res, 10)).toBe(res); // 非 BATTLE 不推进
    const choice = steps[4];
    expect(pressRunAction(choice, CTX)).toBe(choice);
    expect(chooseRunBuff(choice, 'not-a-buff')).toBe(choice);
    expect(chooseRunBuff(res, RUN_CHOICE_OPTIONS[0].id)).toBe(res); // 非 CHOICE 不生效
  });

  it('RP-15 三个强化选项固定且正是 Queue 点名的三项，note 是玩家向「一句结果」', () => {
    expect(RUN_CHOICE_OPTIONS.length).toBe(3);
    expect(RUN_CHOICE_OPTIONS.map((o) => o.label)).toEqual(['重型弹头', '爆裂弹', '紧急维修']);
    expect(RUN_CHOICE_OPTIONS.map((o) => o.note)).toEqual([
      '炮弹更重，撞击和后坐增强',
      '炮弹命中后发生范围爆炸',
      '立即恢复部分耐久',
    ]);
    expect(new Set(RUN_CHOICE_OPTIONS.map((o) => o.id)).size).toBe(3);
    for (const o of RUN_CHOICE_OPTIONS) {
      expect(o.note.length).toBeGreaterThan(0);
      expect(o.note.includes('[')).toBe(false); // 不是内部字段 / 枚举
      expect(o.note.length).toBeLessThanOrEqual(16); // 一句结果，不是说明段
    }
    // 两个不同选项给出可区分的顶部图标 / 日志结果（选择真的生效）
    const a = chooseRunBuff(reachChoice(), RUN_CHOICE_OPTIONS[1].id);
    const b = chooseRunBuff(reachChoice(), RUN_CHOICE_OPTIONS[2].id);
    expect(a.buffs[0].id).toBe('explosiveShell');
    expect(b.buffs[0].id).toBe('emergencyRepair');
    expect(a.buffs[0].id).not.toBe(b.buffs[0].id);
    expect(a.log[a.log.length - 1].text).toBe('你换上了爆裂弹。');
    expect(b.log[b.log.length - 1].text).toBe('你换上了紧急维修。');
  });

  it('RP-16 BATTLE 推进确定性：一次性推到结束 == 任意分块推到结束', () => {
    const start = pressRunAction(pressRunAction(createRunPageState(CTX), CTX), CTX);
    const oneShot = advanceRunBattle(start, RUN_BATTLE_SCRIPT.totalSteps);
    let chunked = start;
    for (let i = 0; i < RUN_BATTLE_SCRIPT.totalSteps; i++) chunked = advanceRunBattle(chunked, 1);
    expect(chunked.battle).toEqual(oneShot.battle);
    expect(chunked.log).toEqual(oneShot.log);
    expect(chunked.phase).toBe(oneShot.phase);
  });

  it('RP-17 耐久上限来自 F1 共享测试数据（不手写数值）；日志文本不再被二次格式化', () => {
    const plan = runDemoPlan();
    expect(CTX.playerHpMax).toBe(plan.player.hp);
    expect(CTX.enemyHpMax).toBe(plan.enemies[0].hp);
    expect(CTX.playerHpMax).toBe(1100);
    expect(CTX.enemyHpMax).toBe(900);
    expect(CTX.vehicleLabel).toBe('西瓜重炮');
    expect(CTX.encounterLabel).toBe('追猎者');
    expect(RUN_DEMO_LOADOUT_ID).toBe('WatermelonHeavyCannon');
    expect(RUN_DEMO_ENCOUNTER_ID).toBe('Chaser');
    // PRP-R3 必改 3：formatRunLog 是恒等（**不再拼 `[耐久]` 之类前缀**）
    expect(formatRunLog({ seq: 1, kind: 'durability', text: '战车耐久剩余 78%。' })).toBe('战车耐久剩余 78%。');
  });
});

/* ============================================ C. 侧视战斗舞台 */

describe('PRP-F0｜C 侧视舞台：玩家左 / 敌人右', () => {
  it('RP-18 状态决定舞台内容：IDLE 仅玩家 → EVENT 敌人在右 → BATTLE 交战 → RESULT/CHOICE 敌人消失', () => {
    const { steps } = runFullFlow();
    const [idle, event, battle, result, choice] = steps;

    const vIdle = buildRunStageView(idle.phase, idle.battle);
    expect(vIdle.enemy).toBeNull();
    expect(vIdle.enemyGone).toBe(false);
    expect(vIdle.battle).toBe(false);

    const vEvent = buildRunStageView(event.phase, event.battle);
    expect(vEvent.enemy).not.toBeNull();
    expect(vEvent.enemyGone).toBe(false);
    expect(vEvent.battle).toBe(false);

    for (const [tag, st] of [['EVENT', event], ['BATTLE', battle]] as const) {
      const v = buildRunStageView(st.phase, st.battle);
      const pb = v.player.bounds;
      const eb = v.enemy!.bounds;
      // 玩家左 / 敌人右（严格分离，不重叠）
      expect(pb.x + pb.w, `${tag} 玩家应在敌人左侧`).toBeLessThanOrEqual(eb.x);
      expect(runRectsOverlap(pb, eb), `${tag} 两车不得重叠`).toBe(false);
      expect(runRectsOverlap(v.player.bounds, v.ground), `${tag} 玩家不得压地线`).toBe(false);
      expect(runRectsOverlap(eb, v.ground), `${tag} 敌人不得压地线`).toBe(false);
    }

    const vBattle = buildRunStageView(battle.phase, battle.battle);
    expect(vBattle.battle).toBe(true);

    for (const st of [result, choice]) {
      const v = buildRunStageView(st.phase, st.battle);
      expect(v.enemy).toBeNull();
      expect(v.enemyGone).toBe(true);
      // 玩家继续留在舞台上
      expect(v.player.bounds.x).toBe(RUN_STAGE_BAND.x + RUN_SIDE_VIEW.marginPx);
    }
  });

  it('RP-19 显示缩放与状态无关：敌人出现不会让玩家车体突然缩放', () => {
    const { steps } = runFullFlow();
    const [idle, event, battle] = steps;
    const vIdle = buildRunStageView(idle.phase, idle.battle);
    const vEvent = buildRunStageView(event.phase, event.battle);
    const vBattle = buildRunStageView(battle.phase, battle.battle);
    expect(vEvent.scale).toBe(vIdle.scale);
    expect(vBattle.scale).toBe(vIdle.scale);
    // 玩家几何在 EVENT 与 IDLE 完全一致（同一摆位 → 无跳变）
    expect(vEvent.player).toEqual(vIdle.player);
    // BATTLE 开局（位移 0）时与 EVENT 完全一致
    expect(vBattle.player).toEqual(vEvent.player);
    expect(vBattle.enemy).toEqual(vEvent.enemy);
  });

  it('RP-20 BATTLE 演出位移：中段最大且不超过约定值，结束时回到 0', () => {
    const bt = pressRunAction(pressRunAction(createRunPageState(CTX), CTX), CTX);
    const mid = advanceRunBattle(bt, RUN_BATTLE_SCRIPT.totalSteps / 2);
    const vMid = buildRunStageView(mid.phase, mid.battle);
    const v0 = buildRunStageView(bt.phase, bt.battle);
    const dxMid = vMid.player.bounds.x - v0.player.bounds.x;
    expect(dxMid).toBeGreaterThan(0);
    expect(dxMid).toBeLessThanOrEqual(RUN_SIDE_VIEW_CLOSING_PX);
    // 敌人相向（向左）
    expect(vMid.enemy!.bounds.x).toBeLessThan(v0.enemy!.bounds.x);
    // 仍然分离（演出位移不得让两车相撞）
    expect(vMid.enemy!.bounds.x - (vMid.player.bounds.x + vMid.player.bounds.w)).toBeGreaterThan(0);

    const last = advanceRunBattle(mid, RUN_BATTLE_SCRIPT.totalSteps / 2);
    const vEnd = buildRunStageView(last.phase, last.battle);
    expect(vEnd.enemy).toBeNull(); // 已消失
    expect(vEnd.player.bounds.x).toBe(v0.player.bounds.x); // 玩家回到固定起点
  });

  it('RP-21 全部正文车体组合都能两车同框（缩放公式对 5 种车体都成立）', () => {
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
    expect(checked).toBe(10); // 2 Loadout × (1 + 1 + 3) 敌人实例
  });
});

/* ============================================ D. 面积账本（像素精确） */

describe('PRP-F0｜D 面积账本：逐帧整页像素面积精确冻结', () => {
  it('RP-22 六个关键帧的整页分层面积 = 冻结字面量；BATTLE 演出不改变可见面积', () => {
    const { steps } = runFullFlow();
    const [idle, event, battle, result, choice, finale] = steps;

    /**
     * 入账的只有「**不承载文字、不被描边、不被 sprite / 图标覆盖**的纯色平铺矩形」：
     * 地线 / 路面 / 进度节点 / 主动作强调条 / 卡片强调条 / 已获得强化图标（底 + 高光块）。
     *
     * ⚠️ PRP-R3：车辆改用正式 sprite → 车身 / 部件**不再入账**（sprite 像素非纯色），
     * 其「真实车辆视觉在场」改由 RP-31（模型层）+ 浏览器端 sprite 特征色计数（E2E）证明。
     * 承载文字 / 描边 / 矢量图标的面（分带底色、按钮填充、卡片填充、图标字形）同样不入账。
     * 禁用态强调条不入账（sprite 重采样会产生 1 个恰好同色的抗锯齿像素 → 面积不可冻结），
     * BATTLE 的「不可误触」表现为**可用态强调条消失**（actionBar = 0）。
     */
    const base = {
      ground: 780,
      road: 19500,
      nodeDone: 384,
      nodeTodo: 512,
      buffIcon: 0,
      buffChip: 0,
      cardBar: 0,
    };
    const on = { actionBar: 990 };

    // IDLE：顶部第二行**完全不存在**（不是五个空框）
    expect(ledger(idle)).toEqual({ ...base, ...on });

    // EVENT：敌人出现 —— 车辆是 sprite，不入账 → 账面与 IDLE 完全一致
    expect(ledger(event)).toEqual({ ...base, ...on });

    // BATTLE t0：战斗不可误触 → 主动作强调条整条消失
    expect(ledger(battle)).toEqual({ ...base, actionBar: 0 });

    // BATTLE 中段（两车相向位移中）：整页面积与 t0 **完全一致**（平移不改变面积）
    const mid = advanceRunBattle(battle, 45);
    expect(mid.phase).toBe('BATTLE');
    expect(ledger(mid)).toEqual(ledger(battle));

    // RESULT：主动作恢复
    expect(ledger(result)).toEqual({ ...base, ...on });

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

    // 回到 IDLE 且拿到 1 个强化 → 顶部出现 1 个图标（底 900 − 高光块 144 = 756）
    expect(ledger(finale)).toEqual({ ...base, buffIcon: 756, buffChip: 144, ...on });
    expect(ledger(finale).buffIcon + ledger(finale).buffChip).toBe(30 * 30);
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

describe('PRP-F0｜E 源码守卫：Debug 分离 / 不接 Arena / 零跳转', () => {
  it('RP-24 Run Page 源码不得引用 Arena A/B、Gate、PBL Lab 控制器、Planck 或俯视驱动', () => {
    const bannedTokens = [
      'arenaA', // Arena A（俯视）
      'arenaScene',
      'ArenaARuntime',
      'PlanckArenaRuntime',
      'planck',
      'drivePlanckVehicle',
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

/* ====================================== F. PRP-R3 信息层级（本 Queue 的正题） */

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
    // 逐帧伤害绝不进日志：BATTLE 全程日志条数恒定
    const bt = steps[2];
    expect(advanceRunBattle(bt, 89).log).toEqual(bt.log);
    // 最近事件才突出：可见行 ≤ maxLines，末 N 行视为「最近」
    expect(visibleRunLog(finale, 3).length).toBeLessThanOrEqual(3);
    expect(visibleRunLog(finale, 3)).toEqual(finale.log.slice(-3));
    expect(RUN_LOG.emphasis).toBeGreaterThanOrEqual(3);
    expect(RUN_LOG.emphasis).toBeLessThanOrEqual(5);
  });

  it('RP-31 必改 2：战斗主体是**真实车辆视觉**（正式 sprite + 正式 anchor/镜像），不是纯色矩形', () => {
    const plan = runDemoPlan();
    // 1) 两个实体都不含「纯色矩形代表车辆」的降级件
    expect(hasPlaceholderVisual(plan.player)).toBe(false);
    expect(hasPlaceholderVisual(plan.enemies[0])).toBe(false);

    const view = buildRunStageView('BATTLE', null);
    const all = [...view.player.visuals, ...view.enemy!.visuals];
    // 2) 非轮组可视件必须带正式 visualId（= 真实 sprite 外形）
    for (const v of all) {
      if (v.kind === 'wheel') continue;
      expect(v.visualId, `${v.kind} 必须有正式 visualId`).toBeTruthy();
    }
    const ids = new Set(all.map((v) => v.visualId).filter(Boolean));
    expect(ids.has('body_watermelon')).toBe(true); // 玩家车身（正式 BodyDef.visual）
    expect(ids.has('body_banana')).toBe(true); // 敌人车身
    expect(ids.has('part_cannon')).toBe(true); // 玩家武器（正式 FunctionalPartDef.visual）
    expect(ids.has('part_hammer')).toBe(true); // 敌人武器

    // 3) 敌人车体朝左 → 车身 / 武器必须声明镜像（朝向语义来自正式 visual.mirrorWithFacing）
    for (const v of view.enemy!.visuals) {
      if (v.kind === 'wheel') continue;
      expect(v.mirror, `敌人件 ${v.visualId} 应镜像`).toBe(true);
    }
    for (const v of view.player.visuals) expect(v.mirror).toBe(false);

    // 4) 车辆**明显放大**：两车合计横向占用 ≥ 舞台宽的 85%，单体高 ≥ 舞台高的 1/6
    const pw = view.player.bounds.w;
    const ew = view.enemy!.bounds.w;
    expect(pw + ew).toBeGreaterThanOrEqual(RUN_STAGE_BAND.w * 0.85);
    expect(pw).toBeGreaterThan(RUN_STAGE_BAND.w * 0.35);
    expect(ew).toBeGreaterThan(RUN_STAGE_BAND.w * 0.4);
    for (const b of [view.player.bounds, view.enemy!.bounds]) {
      expect(b.h).toBeGreaterThan(RUN_STAGE_BAND.h / 6);
    }

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
  });

  it('RP-32 必改 2：中部舞台有真实景物，不存在大片空场（山脊 / 雾带填满地平线以上）', () => {
    const hills = runStageHills();
    const view = buildRunStageView('BATTLE', null);
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
    for (const b of [view.player.bounds, view.enemy!.bounds]) {
      expect(b.y + b.h).toBe(view.baselineY);
      expect(b.y + b.h / 2).toBeGreaterThan(bandMid);
    }
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
