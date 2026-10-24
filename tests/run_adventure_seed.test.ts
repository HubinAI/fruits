/**
 * FRUITS-ADVENTURE-R4｜随机冒险 targeted 测试（纯状态机，无需 DOM）。
 *
 * R4 覆盖（在 R3 基础上）：
 *   ① 同种子完全可复现；不同种子产生不同事件组合（且相邻事件不同类）；
 *   ② 事件结果真实进入 HP / Build，且只结算一次；强化身份**领取时解析**
 *      （候选序同种子恒定；候选全被拥有 → 补救维修 / 如实空手，绝不零收益中奖、绝不无提示扣血）；
 *   ③ 结算口径：battlesWon（获胜）与 battlesCompleted（完成，含打退）分开统计；
 *   ④ 胜利与失败两种终态均可达；隔离测试档案不污染正式存档；
 *   ⑤ 「下一局目标」在 7 战上限内全部真实可达（绝不出现「挑战 8 场」类不可达目标）。
 *
 * 战斗用 `finishAdventureBattle` 在边界一次性推进（等价官方 result 出现那一刻）。
 */
import { describe, it, expect } from 'vitest';
import {
  generateAdventureScript,
  EVENT_BUFF_POOL,
  ADVENTURE_TOTAL_BATTLES,
  type AdventureEventKind,
  type AdventureEffect,
  type AdventureScript,
} from '../src/lab/portraitBattleLab/adventure/advScript';
import {
  advAutoAdvance,
  advChoicePool,
  advContextFromLoadout,
  advCurrentNode,
  advCarriedPlayerHp,
  advNeedsPlayer,
  chooseAdventureOption,
  createAdventureState,
  finishAdventureBattle,
  pressAdventureAction,
  type AdventureContext,
  type AdventureState,
} from '../src/lab/portraitBattleLab/adventure/advState';
import { runBuildOptionById } from '../src/lab/portraitBattleLab/runModifiers';
import {
  recordRun,
  readArchive,
  nextRunGoal,
  archiveStorageKey,
  type AdvArchive,
  type AdvRunSummary,
} from '../src/lab/portraitBattleLab/adventure/advArchive';

function eventStrategy(kind: AdventureEventKind): string {
  // 总是选「主动/有风险」选项，以触发 heal / buff / damage / trade（none 只在 leave/safe/ignore 上）
  if (kind === 'crate') return 'open';
  if (kind === 'wreck') return 'scavenge';
  if (kind === 'rest') return 'repair';
  if (kind === 'convoy') return 'trade';
  return 'touch'; // altar
}

interface EffectRecord {
  readonly eventKind: AdventureEventKind;
  readonly optionId: string;
  readonly outcome: AdventureEffect;
  readonly hpBefore: number;
  readonly hpAfter: number;
  readonly buffsBefore: number;
  readonly buffsAfter: number;
  readonly resultText: string;
}

/** 完整跑一局（战斗在边界用合成结果推进），返回终态与逐事件效果记录。 */
function playAdventure(
  script: AdventureScript,
  ctx: AdventureContext,
  loseOnFirstBattle = false,
): { final: AdventureState; records: EffectRecord[] } {
  let state = createAdventureState(ctx, script);
  const records: EffectRecord[] = [];
  let guard = 0;
  let firstBattle = true;
  while (state.phase !== 'COMPLETE' && state.phase !== 'FAILED') {
    if (++guard > 400) throw new Error('[ADV-TEST] 意外死循环');

    if (state.phase === 'EVENT_CHOICE') {
      const node = advCurrentNode(state, script);
      if (node.kind !== 'EVENT') throw new Error('EVENT_CHOICE 但节点不是 EVENT');
      const optionId = eventStrategy(node.eventKind);
      const outcome = node.outcomes[optionId];
      const hpBefore = advCarriedPlayerHp(state, ctx);
      const buffsBefore = state.buffs.length;
      const after = chooseAdventureOption(state, optionId, ctx, script);

      // 验收 ②：结果仅结算一次 —— 事件进入 EVENT_DONE 后再次选同一选项必须 no-op（同引用）
      const again = chooseAdventureOption(after, optionId, ctx, script);
      expect(again).toBe(after);
      expect(after.phase).toBe('EVENT_DONE');
      expect(after.eventResult).not.toBeNull();

      records.push({
        eventKind: node.eventKind,
        optionId,
        outcome,
        hpBefore,
        hpAfter: advCarriedPlayerHp(after, ctx),
        buffsBefore,
        buffsAfter: after.buffs.length,
        resultText: after.eventResult ?? '',
      });
      state = after;
    } else if (state.phase === 'CHOICE') {
      const node = advCurrentNode(state, script);
      const pool = advChoicePool(state, node, ctx);
      if (pool.length === 0) {
        // 候选池已空（罕见）：走诚实跳过分支推进，避免死锁。
        state = chooseAdventureOption(state, '__skip__', ctx, script);
      } else {
        expect(pool.length).toBeGreaterThan(0);
        state = chooseAdventureOption(state, pool[0].id, ctx, script);
      }
    } else if (state.phase === 'BATTLE') {
      const cur = advCarriedPlayerHp(state, ctx);
      if (loseOnFirstBattle && firstBattle) {
        firstBattle = false;
        state = finishAdventureBattle(state, { winner: 'B', endReason: 'test', playerHp: 0, enemyHp: 10, steps: 50 }, script);
      } else {
        firstBattle = false;
        // 合成一场胜利（玩家剩余耐久 = 当前耐久 - 30，至少 1），验证跨战斗耐久继承
        state = finishAdventureBattle(state, { winner: 'A', endReason: 'test', playerHp: Math.max(1, cur - 30), enemyHp: 0, steps: 50 }, script);
      }
    } else {
      // START / BANNER / EVENT(待开打) / RESULT / EVENT_DONE / IDLE → 推进
      //
      // FRUITS-ADVENTURE-UX-CONTINUITY-R1：EVENT / RESULT / EVENT_DONE 已改为**纯信息阶段**
      // （`pressAdventureAction` 在其上为 no-op，由 `advAutoAdvance` 自动承接）。
      // 驱动必须按新语义走，否则会在这三个阶段上空转到 guard 上限。
      // ⚠️ 自动承接走的是 R1 之前「按继续」的**同一段**推进代码 ⇒ 本文件对经济/胜负/
      //    可复现性的全部断言仍然成立（等价性由 adventureContinuityR1.test.ts 显式证明）。
      const next = advNeedsPlayer(state)
        ? pressAdventureAction(state, ctx, script)
        : advAutoAdvance(state, ctx, script);
      if (next === state) throw new Error(`[ADV-TEST] 阶段 ${state.phase} 无法推进`);
      state = next;
    }
  }
  return { final: state, records };
}

describe('FRUITS-ADVENTURE-R4 种子可复现', () => {
  it('同种子 → 完全相同的事件顺序/候选/战斗对手', () => {
    const a = generateAdventureScript('repro-seed-42');
    const b = generateAdventureScript('repro-seed-42');
    expect(JSON.stringify(a.eventPlan)).toBe(JSON.stringify(b.eventPlan));
    expect(JSON.stringify(a.battlePlan)).toBe(JSON.stringify(b.battlePlan));
    expect(JSON.stringify(a.nodes)).toBe(JSON.stringify(b.nodes));
    expect(a.seed).toBe(b.seed);
  });

  it('不同种子 → 出现不同事件组合（不仅是顺序，验收 ①）', () => {
    const plans = new Set<string>();
    const battles = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const s = generateAdventureScript(`var-${i}`);
      plans.add(JSON.stringify(s.eventPlan));
      battles.add(JSON.stringify(s.battlePlan.map((b) => b.encounterId)));
    }
    expect(plans.size).toBeGreaterThan(5);
    expect(battles.size).toBeGreaterThan(1);
  });

  it('相邻事件不同类（避免连续同类太重复，验收 ①）', () => {
    for (let i = 0; i < 60; i++) {
      const plan = generateAdventureScript(`adj-${i}`).eventPlan;
      for (let j = 1; j < plan.length; j++) {
        expect(plan[j].eventKind).not.toBe(plan[j - 1].eventKind);
      }
    }
  });

  it('强化类选项的候选序 ⊆ EVENT_BUFF_POOL 且全池覆盖（领取时解析的基础）', () => {
    for (let i = 0; i < 60; i++) {
      const s = generateAdventureScript(`buff-${i}`);
      for (const n of Object.values(s.nodes)) {
        if (n.kind !== 'EVENT') continue;
        for (const eff of Object.values(n.outcomes)) {
          if (eff.kind === 'buff' || eff.kind === 'trade') {
            expect(eff.candidates.length).toBe(EVENT_BUFF_POOL.length);
            for (const id of eff.candidates) {
              expect(EVENT_BUFF_POOL.includes(id)).toBe(true);
              expect(runBuildOptionById(id)).not.toBeNull();
            }
          }
        }
      }
    }
  });
});

describe('FRUITS-ADVENTURE-R4 事件效果真实进入状态（领取时解析）', () => {
  it('每个事件结果都精确落到 HP / Build，且只结算一次；扣血必有收益', () => {
    const ctx = advContextFromLoadout();
    // 找一个同时含「强化类结果」与「耐久类结果（heal/damage/trade）」的种子，强化断言覆盖。
    let script: AdventureScript | null = null;
    for (let i = 0; i < 4000 && !script; i++) {
      const s = generateAdventureScript(`find-${i}`);
      let hasBuff = false;
      let hasHp = false;
      for (const n of Object.values(s.nodes)) {
        if (n.kind !== 'EVENT') continue;
        for (const eff of Object.values(n.outcomes)) {
          if (eff.kind === 'buff' || eff.kind === 'trade') hasBuff = true;
          if (eff.kind === 'heal' || eff.kind === 'damage' || eff.kind === 'trade') hasHp = true;
        }
      }
      if (hasBuff && hasHp) script = s;
    }
    expect(script).not.toBeNull();
    const sc = script as AdventureScript;

    const { final, records } = playAdventure(sc, ctx);

    expect(final.phase === 'COMPLETE' || final.phase === 'FAILED').toBe(true);
    expect(final.battlesCompleted).toBe(ADVENTURE_TOTAL_BATTLES);
    expect(final.battlesWon).toBe(ADVENTURE_TOTAL_BATTLES); // 全胜合成路径

    for (const r of records) {
      if (r.outcome.kind === 'heal') {
        expect(r.hpAfter).toBeGreaterThanOrEqual(r.hpBefore);
        expect(r.resultText).toMatch(/恢复|已满/);
      } else if (r.outcome.kind === 'damage') {
        expect(r.hpAfter).toBeLessThanOrEqual(r.hpBefore);
      } else if (r.outcome.kind === 'buff' || r.outcome.kind === 'trade') {
        // R4 核心不变量：
        //   - buff 永不扣血；
        //   - trade 只有真正领到新强化才扣血（扣血 ⟹ +1 强化）；
        //   - 拿到强化 ⟹ +1；没拿到 ⟹ 补救维修（hp 不降）或如实空手（hp 不变）。
        if (r.outcome.kind === 'buff') expect(r.hpAfter).toBeGreaterThanOrEqual(r.hpBefore);
        if (r.hpAfter < r.hpBefore) expect(r.buffsAfter).toBe(r.buffsBefore + 1);
        expect(r.buffsAfter >= r.buffsBefore && r.buffsAfter <= r.buffsBefore + 1).toBe(true);
        // 不再出现「已拥有，本次不重复计入」这类零收益结算文案（R4 移除该路径）
        expect(r.resultText).not.toMatch(/已拥有，本次不重复计入/);
        if (r.outcome.kind === 'trade' && r.hpAfter < r.hpBefore) {
          expect(r.resultText).toMatch(/换来了临时强化/);
        }
      }
    }

    const hpChanged = records.some((r) => r.hpAfter !== r.hpBefore);
    const buffAdded = records.some((r) => r.buffsAfter > r.buffsBefore);
    expect(hpChanged).toBe(true);
    expect(buffAdded).toBe(true);
  });

  it('候选全被拥有：buff/trade 不扣血、不改 Build，给补救维修或如实空手（R4 必改②）', () => {
    const ctx = advContextFromLoadout();
    // 找任意带 buff / trade 选项的事件
    let target: { script: AdventureScript; nodeId: string; optionId: string; kind: 'buff' | 'trade' } | null = null;
    outer: for (let i = 0; i < 2000; i++) {
      const s = generateAdventureScript(`own-${i}`);
      for (const n of Object.values(s.nodes)) {
        if (n.kind !== 'EVENT') continue;
        for (const [oid, eff] of Object.entries(n.outcomes)) {
          if (eff.kind === 'buff' || eff.kind === 'trade') {
            target = { script: s, nodeId: n.id, optionId: oid, kind: eff.kind };
            break outer;
          }
        }
      }
    }
    expect(target).not.toBeNull();
    const t = target as { script: AdventureScript; nodeId: string; optionId: string; kind: 'buff' | 'trade' };

    // 场景 A：已拥有全部候选 + 满耐久 → 如实空手（HP/Build 均不变，文案明示无收获无损失）
    let s = createAdventureState(ctx, t.script);
    s = { ...s, phase: 'EVENT_CHOICE', nodeId: t.nodeId, buffs: [...EVENT_BUFF_POOL], carriedHp: ctx.playerHpMax };
    const a = chooseAdventureOption(s, t.optionId, ctx, t.script);
    expect(advCarriedPlayerHp(a, ctx)).toBe(ctx.playerHpMax);
    expect(a.buffs.length).toBe(EVENT_BUFF_POOL.length);
    expect(a.eventResult ?? '').toMatch(/没有收获|作罢/);

    // 场景 B：已拥有全部候选 + 低耐久 → 补救维修（HP 上升、Build 不变、不扣血）
    const s2 = { ...s, carriedHp: 300 };
    const b = chooseAdventureOption(s2, t.optionId, ctx, t.script);
    expect(advCarriedPlayerHp(b, ctx)).toBeGreaterThan(300);
    expect(b.buffs.length).toBe(EVENT_BUFF_POOL.length);
    expect(b.eventResult ?? '').toMatch(/补给|维修/);
    // 绝不出现零收益扣血文案
    expect(b.eventResult ?? '').not.toMatch(/仅扣耐久/);
  });

  it('满耐久维修诚实：恢复 0 且明示「已满」，不假装有效奖励（验收③）', () => {
    const ctx = advContextFromLoadout();
    let target: { script: AdventureScript; nodeId: string; optionId: string } | null = null;
    for (let i = 0; i < 4000 && !target; i++) {
      const s = generateAdventureScript(`heal-${i}`);
      for (const n of Object.values(s.nodes)) {
        if (n.kind === 'EVENT') {
          for (const [oid, eff] of Object.entries(n.outcomes)) {
            if (eff.kind === 'heal') {
              target = { script: s, nodeId: n.id, optionId: oid };
              break;
            }
          }
        }
        if (target) break;
      }
    }
    expect(target).not.toBeNull();
    const t = target as { script: AdventureScript; nodeId: string; optionId: string };
    let state = createAdventureState(ctx, t.script);
    state = { ...state, phase: 'EVENT_CHOICE', nodeId: t.nodeId };
    const after = chooseAdventureOption(state, t.optionId, ctx, t.script);
    expect(advCarriedPlayerHp(after, ctx)).toBe(ctx.playerHpMax); // 恢复 0
    expect(after.eventResult ?? '').toMatch(/恢复 0|已满/);
  });

  it('刷新（同种子重放）→ 完全可复现（候选序恒定 ⇒ 领取结果一致），不重复领取', () => {
    const ctx = advContextFromLoadout();
    const s1 = generateAdventureScript('replay-seed');
    const s2 = generateAdventureScript('replay-seed');
    const r1 = playAdventure(s1, ctx);
    const r2 = playAdventure(s2, ctx);
    expect(r1.final.buffs).toEqual(r2.final.buffs);
    expect(r1.final.carriedHp).toBe(r2.final.carriedHp);
    expect(r1.records.map((r) => r.resultText)).toEqual(r2.records.map((r) => r.resultText));
  });
});

describe('FRUITS-ADVENTURE-R4 胜负可达与结算口径', () => {
  it('全胜路径 → COMPLETE，battlesWon === battlesCompleted === 7（完成/获胜区分的满值）', () => {
    const ctx = advContextFromLoadout();
    const script = generateAdventureScript('win-path');
    const { final } = playAdventure(script, ctx);
    expect(final.phase).toBe('COMPLETE');
    expect(final.battlesCompleted).toBe(ADVENTURE_TOTAL_BATTLES);
    expect(final.battlesWon).toBe(ADVENTURE_TOTAL_BATTLES);
  });

  it('首战失利 → FAILED：battlesCompleted=1 而 battlesWon=0（完成≠获胜，R4 口径）', () => {
    const ctx = advContextFromLoadout();
    const script = generateAdventureScript('lose-path');
    const { final } = playAdventure(script, ctx, true);
    expect(final.phase).toBe('FAILED');
    expect(final.carriedHp).toBe(0);
    expect(final.battlesCompleted).toBe(1);
    expect(final.battlesWon).toBe(0);
  });

  it('混胜负路径：完成 7 场但获胜 < 7（RESULT 打退也计入完成）', () => {
    const ctx = advContextFromLoadout();
    const script = generateAdventureScript('mixed-path');
    let s = createAdventureState(ctx, script);
    let guard = 0;
    let battleIdx = 0;
    while (s.phase !== 'COMPLETE' && s.phase !== 'FAILED' && guard < 400) {
      guard++;
      if (s.phase === 'EVENT_CHOICE') {
        const node = advCurrentNode(s, script);
        if (node.kind === 'EVENT') s = chooseAdventureOption(s, eventStrategy(node.eventKind), ctx, script);
        continue;
      }
      if (s.phase === 'CHOICE') {
        const node = advCurrentNode(s, script);
        const pool = advChoicePool(s, node, ctx);
        s = pool.length > 0 ? chooseAdventureOption(s, pool[0].id, ctx, script) : pressAdventureAction(s, ctx, script);
        continue;
      }
      if (s.phase === 'BATTLE') {
        battleIdx++;
        const cur = advCarriedPlayerHp(s, ctx);
        // 第 2 场打输但存活（打退）：完成后继续，验证完成≠获胜
        const lose = battleIdx === 2;
        s = finishAdventureBattle(
          s,
          { winner: lose ? 'B' : 'A', endReason: 'test', playerHp: lose ? Math.max(1, Math.round(ctx.playerHpMax * 0.3)) : Math.max(1, cur - 30), enemyHp: 0, steps: 50 },
          script,
        );
        continue;
      }
      // R1：纯信息阶段（EVENT / RESULT / EVENT_DONE）由 advAutoAdvance 自动承接，
      // 主操作在其上已是 no-op —— 驱动按新语义分派（推进代码与 R1 前「按继续」完全相同）。
      s = advNeedsPlayer(s) ? pressAdventureAction(s, ctx, script) : advAutoAdvance(s, ctx, script);
    }
    expect(s.phase).toBe('COMPLETE');
    expect(s.battlesCompleted).toBe(ADVENTURE_TOTAL_BATTLES);
    expect(s.battlesWon).toBe(ADVENTURE_TOTAL_BATTLES - 1);
  });
});

describe('FRUITS-ADVENTURE-R4 流程完整性', () => {
  it('随机 20 个种子均能无卡死跑完一局并到达终态（含阶段提示与 7 战）', () => {
    const ctx = advContextFromLoadout();
    for (let i = 0; i < 20; i++) {
      const script = generateAdventureScript(`stress-${i}`);
      const { final } = playAdventure(script, ctx);
      expect(final.phase === 'COMPLETE' || final.phase === 'FAILED').toBe(true);
      expect(final.battlesCompleted).toBe(ADVENTURE_TOTAL_BATTLES);
      expect(final.battlesWon).toBeLessThanOrEqual(final.battlesCompleted);
      expect(script.bannerPlan.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('FRUITS-ADVENTURE-R4 隔离测试档案与可达目标', () => {
  it('recordRun 真实累计（完成/获胜分列）且不影响正式存档键', () => {
    const before = readArchive();
    const summary: AdvRunSummary = {
      seedLabel: 't-seed',
      won: true,
      dayReached: 18,
      dayTotal: 20,
      battlesCompleted: ADVENTURE_TOTAL_BATTLES,
      battlesWon: ADVENTURE_TOTAL_BATTLES,
      finalHpPct: 49,
      buffs: ['damageUp', 'rateUp'],
      finalHp: 540,
      playerHpMax: 1100,
      loadoutSource: '演示',
      ts: Date.now(),
    };
    const after = recordRun(summary);
    expect(after.totals.runs).toBe(before.totals.runs + 1);
    expect(after.totals.battlesCompleted).toBe(before.totals.battlesCompleted + ADVENTURE_TOTAL_BATTLES);
    expect(after.totals.battlesWon).toBe(before.totals.battlesWon + ADVENTURE_TOTAL_BATTLES);
    expect(after.best?.battlesWon).toBe(ADVENTURE_TOTAL_BATTLES);
    expect(after.best?.finalHpPct).toBe(49);
    expect(typeof nextRunGoal(after)).toBe('string');
    // 键名明确隔离（与正式存档 strongfruit.playerBuild.v1 不同）
    expect(archiveStorageKey()).toBe('strongfruit.adventure.r3.testArchive.v1');
  });

  it('下一局目标全部真实可达（7 战上限内绝不出现「8 场」类目标，R4 必改①）', () => {
    const ctxBase: AdvArchive['best'] = {
      battlesCompleted: ADVENTURE_TOTAL_BATTLES,
      battlesWon: ADVENTURE_TOTAL_BATTLES,
      dayReached: 26,
      won: true,
      finalHpPct: 40,
      seedLabel: 'best',
    };
    const mk = (best: AdvArchive['best'], runs = 1): AdvArchive => ({
      version: 2,
      runs: [],
      best,
      totals: { runs, wins: best?.won ? 1 : 0, battlesCompleted: best?.battlesCompleted ?? 0, battlesWon: best?.battlesWon ?? 0 },
    });

    // 首局（无档案）→ 起步目标
    expect(nextRunGoal(mk(null, 0))).toMatch(/目标：/);

    // 未通关 → 比最佳走得更远（恒可达）
    const notWon = nextRunGoal(mk({ ...ctxBase, won: false, battlesWon: 4 }));
    expect(notWon).toMatch(/走得更远/);
    expect(notWon).toMatch(/获胜 4 场/);

    // 已通关但非全胜 → 挑战全胜（7 战内可达）
    const wonPartial = nextRunGoal(mk({ ...ctxBase, won: true, battlesWon: 5 }));
    expect(wonPartial).toMatch(/全胜/);
    expect(wonPartial).toMatch(/7 战全胜/);
    expect(wonPartial).not.toMatch(/8 场/);

    // 已全胜通关 → 追平/刷新耐久纪录（可达），绝不出现「挑战 8 场不败」
    const wonAll = nextRunGoal(mk({ ...ctxBase, won: true, battlesWon: ADVENTURE_TOTAL_BATTLES }));
    expect(wonAll).toMatch(/耐久纪录/);
    expect(wonAll).not.toMatch(/8 场/);
    expect(wonAll).not.toMatch(/挑战 \d+ 场不败/);
  });
});
