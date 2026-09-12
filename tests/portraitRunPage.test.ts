/**
 * PRP-F0-RUN-PAGE-SHELL｜Portrait Run Prototype —— Run Page targeted 测试（纯 node，无 DOM）。
 *
 * 覆盖五层：
 *   A) 页面层级：竖屏 390×844 四条横带无缝无叠，顶部薄 / 中部舞台 / 下部日志 / 最底唯一动作；
 *   B) 五状态机与固定演示流程：IDLE → EVENT → BATTLE → RESULT → CHOICE → IDLE（同一页面内）；
 *   C) 侧视战斗舞台：玩家固定左 / 敌人固定右、EVENT 出现 / RESULT 消失、演出位移不影响数值；
 *   D) 面积账本：逐帧整页像素面积**精确冻结**（浏览器端再用真实 getImageData 交叉核对）；
 *   E) 源码守卫：Debug 与玩家界面分离、不接 Arena A/B、不接 Planck、不存在任何页面跳转。
 *
 * 面积期望值是**冻结字面量**（不是就地重算）：任何布局改动都必须显式更新这里，
 * 从而让「像素确实变了」这件事无法悄悄发生（与 F1-R22 同一约定）。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { PORTRAIT_LOGICAL_H, PORTRAIT_LOGICAL_W } from '../src/lab/portraitBattleLab/constants';
import { bodyOffsetBoxes, partOffsetBoxes } from '../src/lab/portraitBattleLab/scene';
import { buildSpawnPlan, type SpawnedEntity } from '../src/lab/portraitBattleLab/entities';
import { LAB_ENCOUNTERS, LAB_LOADOUTS } from '../src/lab/portraitBattleLab/testData';
import {
  RUN_ACTION_BAND,
  RUN_BANDS,
  RUN_BUILD_ICON_SLOTS,
  RUN_CHOICE,
  RUN_LOG,
  RUN_LOG_BAND,
  RUN_PAGE_H,
  RUN_PAGE_W,
  RUN_SIDE_VIEW,
  RUN_SIDE_VIEW_CLOSING_PX,
  RUN_STAGE_BAND,
  RUN_TOP_BAND,
  runActionButtonRect,
  runBuildIconSlots,
  runChoiceBarRect,
  runChoiceCardRects,
  runChoiceChipRect,
  runChoiceMaskRect,
  runDayNodes,
  runLogBottomY,
  runLogLineRects,
  runPaintedAreas,
  runRectsOverlap,
  runSideViewScale,
  runStageGroundY,
  type RunLayeredRect,
  type RunRect,
} from '../src/lab/portraitBattleLab/runPageLayout';
import {
  RUN_BATTLE_SCRIPT,
  RUN_CHOICE_OPTIONS,
  RUN_PHASES,
  advanceRunBattle,
  chooseRunBuff,
  createRunPageState,
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
  runDemoPlan,
  runPageContext,
  runPageLayerShapes,
} from '../src/lab/portraitBattleLab/runPageScene';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const LAB_DIR = join(REPO_ROOT, 'src', 'lab', 'portraitBattleLab');
const RUN_PAGE_FILES = [
  'runPageLayout.ts',
  'runPageState.ts',
  'runPageScene.ts',
  'runPage.ts',
  'runMain.ts',
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

  it('RP-01b PRP-R1 必改 3：四带比例落在指定区间（顶 8~10 / 台 45~50 / 志 28~32 / 作 8~10）', () => {
    const pct = (h: number): number => (h / RUN_PAGE_H) * 100;
    const [top, stage, log, action] = RUN_BANDS.map((b) => pct(b.h));
    expect(top).toBeGreaterThanOrEqual(8);
    expect(top).toBeLessThanOrEqual(10);
    expect(stage).toBeGreaterThanOrEqual(45);
    expect(stage).toBeLessThanOrEqual(50);
    expect(log).toBeGreaterThanOrEqual(28);
    expect(log).toBeLessThanOrEqual(32);
    expect(action).toBeGreaterThanOrEqual(8);
    expect(action).toBeLessThanOrEqual(10);
    // 中部舞台必须是面积最大的一条带（「当前最大视觉主体」的结构形式）
    expect(RUN_STAGE_BAND.h).toBeGreaterThan(RUN_TOP_BAND.h);
    expect(RUN_STAGE_BAND.h).toBeGreaterThan(RUN_LOG_BAND.h);
    expect(RUN_STAGE_BAND.h).toBeGreaterThan(RUN_ACTION_BAND.h);
    // 顶部薄层必须装得下图标行（图标底边不得越入舞台带）
    for (const s of runBuildIconSlots(RUN_BUILD_ICON_SLOTS)) expect(inside(s, RUN_TOP_BAND)).toBe(true);
  });

  it('RP-02 顶部薄层：进度节点右对齐 + Build 图标左对齐，全部落在带内且互不重叠', () => {
    const nodes = runDayNodes(7);
    expect(nodes.length).toBe(7);
    for (const n of nodes) expect(inside(n, RUN_TOP_BAND)).toBe(true);
    for (let i = 1; i < nodes.length; i++) expect(nodes[i].x).toBeGreaterThan(nodes[i - 1].x + nodes[i - 1].w);
    // 右对齐
    expect(nodes[nodes.length - 1].x + nodes[nodes.length - 1].w).toBe(RUN_PAGE_W - 16);

    const slots = runBuildIconSlots(RUN_BUILD_ICON_SLOTS);
    expect(slots.length).toBe(5); // 3～5 个
    expect(slots.length).toBeGreaterThanOrEqual(3);
    expect(slots.length).toBeLessThanOrEqual(5);
    for (const s of slots) expect(inside(s, RUN_TOP_BAND)).toBe(true);
    for (let i = 1; i < slots.length; i++) expect(slots[i].x).toBeGreaterThan(slots[i - 1].x + slots[i - 1].w);
    expect(slots[0].x).toBe(16); // 左对齐
    // 节点行与图标行不重叠（薄层里两行分明）
    for (const n of nodes) for (const s of slots) expect(runRectsOverlap(n, s)).toBe(false);
  });

  it('RP-03 中部舞台：玩家固定贴左、敌人固定贴右，两车分离且都完整落在舞台带内', () => {
    const view = buildRunStageView('BATTLE', null);
    expect(view.groundY).toBe(runStageGroundY());
    expect(view.groundY).toBeGreaterThan(RUN_STAGE_BAND.y);
    expect(view.groundY).toBeLessThan(RUN_STAGE_BAND.y + RUN_STAGE_BAND.h);
    expect(inside(view.ground, RUN_STAGE_BAND)).toBe(true);

    // 玩家：左边缘 = 舞台左边距
    expect(view.player.bounds.x).toBe(RUN_STAGE_BAND.x + RUN_SIDE_VIEW.marginPx);
    // 敌人：右边缘 = 舞台右边界 − 右边距
    expect(view.enemy).not.toBeNull();
    const eb = view.enemy!.bounds;
    expect(eb.x + eb.w).toBe(RUN_STAGE_BAND.x + RUN_STAGE_BAND.w - RUN_SIDE_VIEW.marginPx);
    // 完全分离（中缝 ≥ 约定值 − 演出位移）
    expect(eb.x - (view.player.bounds.x + view.player.bounds.w)).toBeGreaterThanOrEqual(RUN_SIDE_VIEW.gapPx);
    // 都贴地（底边 = 地线）
    expect(view.player.bounds.y + view.player.bounds.h).toBe(view.groundY);
    expect(eb.y + eb.h).toBe(view.groundY);
    // 全部矩形落在舞台带内（不得越出玩家可见区）
    for (const r of [...view.player.body, ...view.player.part, ...view.enemy!.body, ...view.enemy!.part]) {
      expect(inside(r, RUN_STAGE_BAND)).toBe(true);
    }
  });

  it('RP-04 下部日志：标题与全部行都在日志带内，且不越过最底动作区', () => {
    const lines = runLogLineRects(RUN_LOG.maxLines);
    expect(lines.length).toBe(10);
    for (const r of lines) expect(inside(r, RUN_LOG_BAND)).toBe(true);
    expect(runLogBottomY(RUN_LOG.maxLines)).toBeLessThan(RUN_ACTION_BAND.y);
    // 行间不重叠，且自上而下顺序排列
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i].y).toBe(lines[i - 1].y + lines[i - 1].h);
    }
  });

  it('RP-05 最底：唯一一个主动作按钮，落在动作带内', () => {
    const btn = runActionButtonRect();
    expect(inside(btn, RUN_ACTION_BAND)).toBe(true);
    expect(btn.w).toBeGreaterThan(200); // 触控友好
    expect(btn.x).toBe(RUN_PAGE_W - (btn.x + btn.w)); // 水平居中
    // 主动作不与日志区 / 舞台重叠
    expect(runRectsOverlap(btn, RUN_LOG_BAND)).toBe(false);
    expect(runRectsOverlap(btn, RUN_STAGE_BAND)).toBe(false);
  });
});

/* ============================================ B. 五状态机 + 固定演示流程 */

describe('PRP-F0｜B 五状态机与固定演示流程（同一页面内）', () => {
  it('RP-06 初始为 IDLE、日志已可见、底部显示「继续」', () => {
    const s = createRunPageState(CTX);
    expect(s.phase).toBe('IDLE');
    expect(RUN_PHASES).toContain(s.phase);
    expect(s.log.length).toBeGreaterThanOrEqual(3);
    expect(visibleRunLog(s, RUN_LOG.maxLines).length).toBeGreaterThanOrEqual(3);
    expect(runActionLabel(s)).toBe('继续');
    expect(runActionEnabled(s)).toBe(true);
    expect(s.buffs.length).toBe(0);
    expect(s.battle).toBeNull();
  });

  it('RP-07 一次完整操作连续走完 IDLE→EVENT→BATTLE→RESULT→CHOICE→IDLE', () => {
    const { steps, finale } = runFullFlow();
    expect(steps.map((s) => s.phase)).toEqual(['IDLE', 'EVENT', 'BATTLE', 'RESULT', 'CHOICE', 'IDLE']);
    expect(finale.phaseTrail).toEqual(['IDLE', 'EVENT', 'BATTLE', 'RESULT', 'CHOICE', 'IDLE']);
    expect(finale.transitions).toBe(5);
    // revision 单调递增（每次状态变更都 +1，没有静默 no-op 混进来）
    for (let i = 1; i < steps.length; i++) expect(steps[i].revision).toBeGreaterThan(steps[i - 1].revision);
  });

  it('RP-08 EVENT：页面不跳转（纯状态），日志追加事件文本，底部切为对应当前动作', () => {
    const idle = createRunPageState(CTX);
    const ev = pressRunAction(idle, CTX);
    expect(ev.phase).toBe('EVENT');
    expect(ev.log.length).toBe(idle.log.length + 1);
    const last = ev.log[ev.log.length - 1];
    expect(last.kind).toBe('event');
    expect(last.text).toContain('遭遇敌人');
    expect(last.text).toContain(CTX.encounterLabel);
    expect(runActionLabel(ev)).toBe('遭遇敌人');
    expect(runActionEnabled(ev)).toBe(true);
    // 原日志行一字不动（只追加）
    expect(ev.log.slice(0, idle.log.length)).toEqual(idle.log);
  });

  it('RP-09 BATTLE：底部切为「战斗中」并不可误触推进；日志只加一条「交战开始」', () => {
    const ev = pressRunAction(createRunPageState(CTX), CTX);
    const bt = pressRunAction(ev, CTX);
    expect(bt.phase).toBe('BATTLE');
    expect(runActionLabel(bt)).toBe('战斗中');
    expect(runActionEnabled(bt)).toBe(false); // 禁触
    expect(pressRunAction(bt, CTX)).toBe(bt); // 同引用 = 真 no-op
    expect(bt.log.length).toBe(ev.log.length + 1);
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

  it('RP-11 RESULT：一次性追加 2 行（战斗结果 + 耐久占位），敌人离开舞台', () => {
    const bt = pressRunAction(pressRunAction(createRunPageState(CTX), CTX), CTX);
    const mid = advanceRunBattle(bt, RUN_BATTLE_SCRIPT.totalSteps - 1);
    expect(mid.phase).toBe('BATTLE');
    expect(mid.log.length).toBe(bt.log.length); // 倒数第二步仍不写日志

    const res = advanceRunBattle(mid, 1);
    expect(res.phase).toBe('RESULT');
    expect(res.log.length).toBe(bt.log.length + 2); // 一次性只加两条
    const added = res.log.slice(-2);
    expect(added[0].kind).toBe('result');
    expect(added[0].text).toContain('战斗结束');
    expect(added[1].kind).toBe('durability');
    expect(added[1].text).toContain('耐久');
    expect(added[1].text).toContain(`${res.battle!.playerHp} / ${res.battle!.playerHpMax}`);
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
    expect(after.enemy).toBeNull();
    expect(after.enemyGone).toBe(true);
    // 浮层出现其间「原页面整体变暗」= 遮罩恰好覆盖整个逻辑舞台（不多不少）
    expect(runChoiceMaskRect()).toEqual({ x: 0, y: 0, w: RUN_PAGE_W, h: RUN_PAGE_H });
  });

  it('RP-13 选择后回到 IDLE：顶部新增图标 + 日志追加「你选择了 XXX」+ 历史完整', () => {
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
    expect(last.text).toBe('你选择了 重型弹头');
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

  it('RP-15 三个强化选项固定且正是 Queue 点名的三项（不随机、不进正式池）', () => {
    expect(RUN_CHOICE_OPTIONS.length).toBe(3);
    expect(RUN_CHOICE_OPTIONS.map((o) => o.label)).toEqual(['重型弹头', '爆裂弹', '紧急维修']);
    expect(new Set(RUN_CHOICE_OPTIONS.map((o) => o.id)).size).toBe(3);
    // 两个不同选项给出可区分的顶部图标 / 日志结果（选择真的生效）
    const a = chooseRunBuff(reachChoice(), RUN_CHOICE_OPTIONS[1].id);
    const b = chooseRunBuff(reachChoice(), RUN_CHOICE_OPTIONS[2].id);
    expect(a.buffs[0].id).toBe('explosiveShell');
    expect(b.buffs[0].id).toBe('emergencyRepair');
    expect(a.buffs[0].id).not.toBe(b.buffs[0].id);
    expect(a.log[a.log.length - 1].text).toBe('你选择了 爆裂弹');
    expect(b.log[b.log.length - 1].text).toBe('你选择了 紧急维修');
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

  it('RP-17 耐久上限来自 F1 共享测试数据（不手写数值）', () => {
    const plan = runDemoPlan();
    expect(CTX.playerHpMax).toBe(plan.player.hp);
    expect(CTX.enemyHpMax).toBe(plan.enemies[0].hp);
    expect(CTX.playerHpMax).toBe(1100);
    expect(CTX.enemyHpMax).toBe(900);
    expect(CTX.vehicleLabel).toBe('西瓜重炮');
    expect(CTX.encounterLabel).toBe('追猎者');
    expect(RUN_DEMO_LOADOUT_ID).toBe('WatermelonHeavyCannon');
    expect(RUN_DEMO_ENCOUNTER_ID).toBe('Chaser');
    // 日志前缀统一格式化（渲染与测试同源）
    expect(formatRunLog({ seq: 1, kind: 'durability', text: 'x' })).toBe('[耐久] x');
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
    // 仍然分离
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
        const pw = unionWidth(plan.player);
        for (const enemy of plan.enemies) {
          const ew = unionWidth(enemy);
          const scale = runSideViewScale(pw, ew);
          expect(scale).toBeGreaterThan(0);
          expect(scale).toBeLessThanOrEqual(RUN_SIDE_VIEW.maxScale);
          expect((pw + ew) * scale).toBeLessThanOrEqual(avail + 1e-6);
          checked += 1;
        }
      }
    }
    expect(checked).toBe(10); // 2 Loadout × (1 + 1 + 3) 敌人实例

    function unionWidth(entity: SpawnedEntity): number {
      const boxes = [...bodyOffsetBoxes(entity.bodyDefId), ...partOffsetBoxes(entity)];
      const minX = Math.min(...boxes.map((b) => b.dx));
      const maxX = Math.max(...boxes.map((b) => b.dx + b.w));
      return maxX - minX;
    }
  });
});

/* ============================================ D. 面积账本（像素精确） */

describe('PRP-F0｜D 面积账本：逐帧整页像素面积精确冻结', () => {
  it('RP-22 六个关键帧的整页分层面积 = 冻结字面量；BATTLE 演出不改变可见面积', () => {
    const { steps } = runFullFlow();
    const [idle, event, battle, result, choice, finale] = steps;

    /**
     * 入账的只有「纯色平铺矩形」：地线 / 两车 / 进度节点 / Build 图标 / 主动作强调条 / 卡片强调条与色块。
     * 承载文字与描边的面（分带底色、按钮填充、卡片填充）不入账 —— 它们由浏览器端按点位精确采样验证。
     */
    const base = {
      ground: 1496,
      playerBody: 3012,
      playerPart: 288,
      nodeDone: 432,
      nodeTodo: 576,
      iconSlot: 3920,
      iconOwned: 0,
      iconChip: 0,
      cardBar: 0,
      cardChip: 0,
    };
    const noEnemy = { enemyBody: 0, enemyPart: 0 };

    // IDLE：只有玩家 + 顶部 + 主动作可用
    expect(ledger(idle)).toEqual({ ...base, ...noEnemy, actionBar: 966, actionBarOff: 0 });

    // EVENT：敌人出现（车身 2774 / 部件 540）
    expect(ledger(event)).toEqual({
      ...base,
      enemyBody: 2774,
      enemyPart: 540,
      actionBar: 966,
      actionBarOff: 0,
    });

    // BATTLE t0：战斗不可误触 → 主动作强调条换成「禁用色」
    expect(ledger(battle)).toEqual({
      ...base,
      enemyBody: 2774,
      enemyPart: 540,
      actionBar: 0,
      actionBarOff: 966,
    });

    // BATTLE 中段（两车相向位移中）：整页面积与 t0 **完全一致**（平移不改变面积）
    const mid = advanceRunBattle(battle, 45);
    expect(mid.phase).toBe('BATTLE');
    expect(ledger(mid)).toEqual(ledger(battle));

    // RESULT：敌人消失、主动作恢复
    expect(ledger(result)).toEqual({ ...base, ...noEnemy, actionBar: 966, actionBarOff: 0 });

    // CHOICE：整页被遮罩合成 → 底层不再带精确色，只登记浮层自身
    expect(ledger(choice)).toEqual({
      ground: 0,
      playerBody: 0,
      playerPart: 0,
      ...noEnemy,
      nodeDone: 0,
      nodeTodo: 0,
      iconSlot: 0,
      iconOwned: 0,
      iconChip: 0,
      cardBar: 3624,
      cardChip: 2028,
      actionBar: 0,
      actionBarOff: 0,
    });

    // 回到 IDLE 且拿到 1 个强化 → 顶部第 1 个图标变「已获得」
    expect(ledger(finale)).toEqual({
      ...base,
      ...noEnemy,
      iconSlot: 3136,
      iconOwned: 640,
      iconChip: 144,
      actionBar: 966,
      actionBarOff: 0,
    });
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
    // 卡片色块不含文字（面积可精确断言）
    const chip = runChoiceChipRect(cards[0]);
    expect(chip.w * chip.h).toBe(RUN_CHOICE.chipSize * RUN_CHOICE.chipSize);
    // 遮罩覆盖整个逻辑舞台（原页面整体变暗，位置不变）
    expect(runChoiceMaskRect()).toEqual({ x: 0, y: 0, w: RUN_PAGE_W, h: RUN_PAGE_H });
    // 账面配色：每张卡片入账「顶部强调条 + 左侧色块」两个纯色矩形
    const shapes = layersOf(reachChoice());
    expect(shapes.every((sh) => sh.layer === 'cardBar' || sh.layer === 'cardChip')).toBe(true);
    expect(shapes.length).toBe(6);
    expect(shapes.filter((sh) => sh.layer === 'cardBar').length).toBe(3);
    expect(shapes.filter((sh) => sh.layer === 'cardChip').length).toBe(3);
    // 强调条不含文字、不被描边覆盖 → 面积可精确冻结
    const bar0 = runChoiceBarRect(cards[0]);
    expect(bar0.y).toBeGreaterThanOrEqual(cards[0].y + 2); // 避开 2px 描边
    expect(bar0.h * bar0.w).toBe(302 * 4);
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
