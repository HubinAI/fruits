/**
 * FRUITS-ADVENTURE-FULL-PLAYABLE-R3｜随机冒险 targeted 测试（纯状态机，无需 DOM）。
 *
 * 覆盖验收：
 *   ① 同种子完全可复现；不同种子产生不同事件组合（且相邻事件不同类）；
 *   ② 事件结果真实进入 HP / Run Build，且只结算一次（重复点击不可重抽）；
 *   ③ 完整经历「事件 → 战斗 → 结算 → 下一天 → 阶段提示 → 终态」无卡死 / 无漏清理；
 *   ④ 胜利与失败两种终态均可达（合成边界推进）；
 *   ⑤ 满耐久维修诚实（恢复 0，不假装有效）；隔离测试档案不污染正式存档。
 *
 * 战斗用 `finishAdventureBattle` 在边界一次性推进（等价官方 result 出现那一刻），
 * 不依赖真实物理渲染 ⇒ 可在 node 下确定性验证状态机与效果。
 */
import { describe, it, expect } from 'vitest';
import {
  generateAdventureScript,
  EVENT_BUFF_POOL,
  ADVENTURE_TOTAL_BATTLES,
  ADVENTURE_EVENT_KINDS,
  type AdventureEventKind,
  type AdventureEffect,
  type AdventureEventNode,
  type AdventureScript,
} from '../src/lab/portraitBattleLab/adventure/advScript';
import {
  advChoicePool,
  advContextFromLoadout,
  advCurrentNode,
  advCarriedPlayerHp,
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
      // START / BANNER / EVENT(待选) / RESULT / EVENT_DONE → 主动作推进
      state = pressAdventureAction(state, ctx, script);
    }
  }
  return { final: state, records };
}

/** 精确复算 applyEffect 的期望 carriedHp（与 advState.applyEffect 同源口径，含 trade）。 */
function expectedHp(ctx: AdventureContext, beforeHp: number, outcome: AdventureEffect): number {
  const max = ctx.playerHpMax;
  const floor = Math.max(1, Math.round(max * 0.1));
  const current = beforeHp;
  if (outcome.kind === 'heal') return Math.min(max, current + Math.round(max * outcome.fraction));
  if (outcome.kind === 'damage') return Math.max(floor, current - Math.round(max * outcome.fraction));
  if (outcome.kind === 'trade') return Math.max(floor, current - Math.round(max * outcome.damageFraction));
  return current;
}

describe('FRUITS-ADVENTURE-R3 种子可复现', () => {
  it('同种子 → 完全相同的事件顺序/结果/战斗对手', () => {
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

  it('同类事件可在不同位置重复，且重复时结果独立掷定（验收 ①）', () => {
    let found = false;
    for (let i = 0; i < 3000 && !found; i++) {
      const s = generateAdventureScript(`rep-${i}`);
      const byKind: Record<string, AdventureEventNode[]> = {};
      for (const n of Object.values(s.nodes)) if (n.kind === 'EVENT') (byKind[n.eventKind] ||= []).push(n);
      for (const kind of ADVENTURE_EVENT_KINDS) {
        const arr = byKind[kind];
        if (arr && arr.length >= 2) {
          if (JSON.stringify(arr[0].outcomes) !== JSON.stringify(arr[1].outcomes)) {
            found = true;
            break;
          }
        }
      }
    }
    expect(found).toBe(true);
  });

  it('事件临时强化来自路线无关池，对演示武器恒有效（验收③）', () => {
    for (let i = 0; i < 60; i++) {
      const s = generateAdventureScript(`buff-${i}`);
      for (const n of Object.values(s.nodes)) {
        if (n.kind !== 'EVENT') continue;
        for (const eff of Object.values(n.outcomes)) {
          if (eff.kind === 'buff' || eff.kind === 'trade') {
            const id = eff.kind === 'buff' ? eff.buildId : eff.buildId;
            expect(EVENT_BUFF_POOL.includes(id)).toBe(true);
            expect(runBuildOptionById(id)).not.toBeNull();
          }
        }
      }
    }
  });
});

describe('FRUITS-ADVENTURE-R3 事件效果真实进入状态', () => {
  it('每个事件结果都精确落到 HP / Build，且只结算一次', () => {
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

    for (const r of records) {
      if (r.outcome.kind === 'heal') {
        expect(r.hpAfter).toBe(expectedHp(ctx, r.hpBefore, r.outcome));
        expect(r.hpAfter).toBeGreaterThanOrEqual(r.hpBefore);
      } else if (r.outcome.kind === 'damage') {
        expect(r.hpAfter).toBe(expectedHp(ctx, r.hpBefore, r.outcome));
        expect(r.hpAfter).toBeLessThanOrEqual(r.hpBefore);
      } else if (r.outcome.kind === 'trade') {
        expect(r.hpAfter).toBe(expectedHp(ctx, r.hpBefore, r.outcome));
        // 已拥有该强化 → 只扣耐久不重复计入；未拥有 → +1。两者均为诚实结果（验收③）。
        expect(r.buffsAfter >= r.buffsBefore && r.buffsAfter <= r.buffsBefore + 1).toBe(true);
      } else if (r.outcome.kind === 'buff') {
        // 已拥有该强化 → 不重复计入（耐久不变）；未拥有 → +1。诚实、不伪造奖励（验收③）。
        expect(r.buffsAfter >= r.buffsBefore && r.buffsAfter <= r.buffsBefore + 1).toBe(true);
      }
    }

    const hpChanged = records.some((r) => r.hpAfter !== r.hpBefore);
    const buffAdded = records.some((r) => r.buffsAfter > r.buffsBefore);
    expect(hpChanged).toBe(true);
    expect(buffAdded).toBe(true);
  });

  it('满耐久维修诚实：恢复 0，不假装有效奖励（验收③）', () => {
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
    // 满耐久开局
    let state = createAdventureState(ctx, t.script);
    // 直接跳到该事件节点
    state = { ...state, phase: 'EVENT_CHOICE', nodeId: t.nodeId };
    const after = chooseAdventureOption(state, t.optionId, ctx, t.script);
    expect(advCarriedPlayerHp(after, ctx)).toBe(ctx.playerHpMax); // 恢复 0
    expect(after.eventResult ?? '').toMatch(/恢复了 0|已满/);
  });

  it('刷新（重新开局同种子）→ 完全可复现，不重复领取', () => {
    const ctx = advContextFromLoadout();
    const s1 = generateAdventureScript('replay-seed');
    const s2 = generateAdventureScript('replay-seed');
    const r1 = playAdventure(s1, ctx);
    const r2 = playAdventure(s2, ctx);
    expect(r1.final.buffs).toEqual(r2.final.buffs);
    expect(r1.final.carriedHp).toBe(r2.final.carriedHp);
    expect(r1.records.map((r) => r.outcome.kind)).toEqual(r2.records.map((r) => r.outcome.kind));
  });
});

describe('FRUITS-ADVENTURE-R3 胜利与失败均可达', () => {
  it('全胜路径 → COMPLETE（胜利可达）', () => {
    const ctx = advContextFromLoadout();
    const script = generateAdventureScript('win-path');
    const { final } = playAdventure(script, ctx);
    expect(final.phase).toBe('COMPLETE');
    expect(final.battlesCompleted).toBe(ADVENTURE_TOTAL_BATTLES);
  });

  it('首战失利 → FAILED（失败可达，且耐久真实归零）', () => {
    const ctx = advContextFromLoadout();
    const script = generateAdventureScript('lose-path');
    const { final } = playAdventure(script, ctx, true);
    expect(final.phase).toBe('FAILED');
    expect(final.carriedHp).toBe(0);
  });
});

describe('FRUITS-ADVENTURE-R3 流程完整性', () => {
  it('随机 20 个种子均能无卡死跑完一局并到达终态（含阶段提示与 7 战）', () => {
    const ctx = advContextFromLoadout();
    for (let i = 0; i < 20; i++) {
      const script = generateAdventureScript(`stress-${i}`);
      const { final } = playAdventure(script, ctx);
      expect(final.phase === 'COMPLETE' || final.phase === 'FAILED').toBe(true);
      expect(final.battlesCompleted).toBe(ADVENTURE_TOTAL_BATTLES);
      // 阶段提示确实生成（每 3 战一次）
      expect(script.bannerPlan.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('FRUITS-ADVENTURE-R3 隔离测试档案（不污染正式存档）', () => {
  it('recordRun 真实累计且不影响正式存档键', () => {
    const before = readArchive();
    const summary: AdvRunSummary = {
      seedLabel: 't-seed',
      won: true,
      dayReached: 18,
      dayTotal: 20,
      battlesCompleted: ADVENTURE_TOTAL_BATTLES,
      buffs: ['damageUp', 'rateUp'],
      finalHp: 540,
      playerHpMax: 1100,
      loadoutSource: '演示',
      ts: Date.now(),
    };
    const after = recordRun(summary);
    expect(after.totals.runs).toBe(before.totals.runs + 1);
    expect(after.best?.battlesCompleted).toBe(ADVENTURE_TOTAL_BATTLES);
    expect(typeof nextRunGoal(after)).toBe('string');
    // 键名明确隔离（与正式存档 strongfruit.playerBuild.v1 不同）
    expect(archiveStorageKey()).toBe('strongfruit.adventure.r3.testArchive.v1');
  });
});
