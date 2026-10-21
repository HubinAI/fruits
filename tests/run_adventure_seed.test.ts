/**
 * FRUITS-RANDOM-ADVENTURE-R1｜随机冒险 targeted 测试（纯状态机，无需 DOM）。
 *
 * 覆盖验收：
 *   ① 同种子完全可复现（脚本 + 事件结果恒定；不同种子可出现不同事件顺序）；
 *   ② 事件结果真实进入 HP / Run Build，且**只结算一次**（重复点击不可重抽）；
 *   ③ 完整经历「事件 → 战斗 → 结算 → 下一天 → 终态」无卡死 / 无漏清理；
 *   ④ 三种非战斗事件（crate / wreck / rest）均被实现并出现在每局。
 *
 * 战斗用 `finishAdventureBattle` 在边界一次性推进（等价官方 result 出现那一刻），
 * 不依赖真实物理渲染 ⇒ 可在 node 下确定性验证状态机与效果。
 */
import { describe, it, expect } from 'vitest';
import {
  generateAdventureScript,
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

function eventStrategy(kind: AdventureEventKind): string {
  // 总是选「主动/有风险」选项，以触发 heal / buff / damage（none 只在 leave/safe 上）
  if (kind === 'crate') return 'open';
  if (kind === 'wreck') return 'scavenge';
  return 'repair'; // rest → 维修（heal）
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
): { final: AdventureState; records: EffectRecord[] } {
  let state = createAdventureState(ctx, script);
  const records: EffectRecord[] = [];
  let guard = 0;
  while (state.phase !== 'COMPLETE' && state.phase !== 'FAILED') {
    if (++guard > 200) throw new Error('[ADV-TEST] 意外死循环');

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
      expect(pool.length).toBeGreaterThan(0);
      state = chooseAdventureOption(state, pool[0].id, ctx, script);
    } else if (state.phase === 'BATTLE') {
      const cur = advCarriedPlayerHp(state, ctx);
      // 合成一场胜利（玩家剩余耐久 = 当前耐久 - 30，至少 1），验证跨战斗耐久继承
      state = finishAdventureBattle(
        state,
        { winner: 'A', endReason: 'test', playerHp: Math.max(1, cur - 30), enemyHp: 0, steps: 50 },
        script,
      );
    } else {
      state = pressAdventureAction(state, ctx, script);
    }
  }
  return { final: state, records };
}

/** 精确复算 applyEffect 的期望 carriedHp（与 advState.applyEffect 同源口径）。 */
function expectedHp(ctx: AdventureContext, beforeHp: number, outcome: AdventureEffect): number {
  const max = ctx.playerHpMax;
  const floor = Math.max(1, Math.round(max * 0.1));
  const current = beforeHp;
  if (outcome.kind === 'heal') return Math.min(max, current + Math.round(max * outcome.fraction));
  if (outcome.kind === 'damage') return Math.max(floor, current - Math.round(max * outcome.fraction));
  return current;
}

describe('FRUITS-RANDOM-ADVENTURE-R1 种子可复现', () => {
  it('同种子 → 完全相同的事件顺序与事件结果', () => {
    const a = generateAdventureScript('repro-seed-42');
    const b = generateAdventureScript('repro-seed-42');
    expect(JSON.stringify(a.eventPlan)).toBe(JSON.stringify(b.eventPlan));
    expect(JSON.stringify(a.nodes)).toBe(JSON.stringify(b.nodes));
    expect(a.seed).toBe(b.seed);
  });

  it('不同种子 → 出现不同事件顺序（验收 ①「多局出现不同事件」）', () => {
    // 24 种组合（3! 排列 × 2×2 结果）空间下，跨多个种子必然出现多种顺序
    const plans = new Set<string>();
    for (let i = 0; i < 30; i++) plans.add(JSON.stringify(generateAdventureScript(`var-${i}`).eventPlan));
    expect(plans.size).toBeGreaterThan(1);
  });

  it('每局三种非战斗事件都出现（crate / wreck / rest）', () => {
    const kinds = new Set(generateAdventureScript('coverage-1').eventPlan.map((e) => e.eventKind));
    expect(kinds.has('crate')).toBe(true);
    expect(kinds.has('wreck')).toBe(true);
    expect(kinds.has('rest')).toBe(true);
  });
});

describe('FRUITS-RANDOM-ADVENTURE-R1 事件效果真实进入状态', () => {
  it('每个事件结果都精确落到 HP / Build，且只结算一次', () => {
    const ctx = advContextFromLoadout();
    // 找一个能同时覆盖 buff 与 damage 的种子，强化断言覆盖。
    // 注意：事件顺序随种子洗牌，故按 eventKind 取节点，而非固定 id。
    let script: AdventureScript | null = null;
    for (let i = 0; i < 4000; i++) {
      const s = generateAdventureScript(`find-${i}`);
      const byKind: Record<string, AdventureEventNode> = {};
      for (const n of Object.values(s.nodes)) if (n.kind === 'EVENT') byKind[n.eventKind] = n;
      const crate = byKind['crate'].outcomes.open;
      const wreck = byKind['wreck'].outcomes.scavenge;
      if (crate.kind === 'buff' && wreck.kind === 'damage') {
        script = s;
        break;
      }
    }
    expect(script).not.toBeNull();
    const sc = script as AdventureScript;

    const { final, records } = playAdventure(sc, ctx);

    // 验收 ③：到达终态，且打满 3 场战斗
    expect(final.phase === 'COMPLETE' || final.phase === 'FAILED').toBe(true);
    expect(final.battlesCompleted).toBe(3);

    // 验收 ②：每个事件的效果与预掷定结果一致
    for (const r of records) {
      if (r.outcome.kind === 'heal') {
        expect(r.hpAfter).toBe(expectedHp(ctx, r.hpBefore, r.outcome));
        expect(r.hpAfter).toBeGreaterThanOrEqual(r.hpBefore); // 修复不会减耐久
      } else if (r.outcome.kind === 'damage') {
        expect(r.hpAfter).toBe(expectedHp(ctx, r.hpBefore, r.outcome));
        expect(r.hpAfter).toBeLessThan(r.hpBefore); // 损失耐久
      } else if (r.outcome.kind === 'buff') {
        expect(r.buffsAfter).toBe(r.buffsBefore + 1); // 真实获得一项强化
      }
    }

    // 本种子覆盖了：至少一次 heal/damage 改了 HP，且至少一次 buff 进了 Build
    const hpChanged = records.some((r) => r.hpAfter !== r.hpBefore);
    const buffAdded = records.some((r) => r.buffsAfter > r.buffsBefore);
    expect(hpChanged).toBe(true);
    expect(buffAdded).toBe(true);

    // 跨战斗耐久真实继承：终局 carriedHp 来自最后一战剩余（>0 因为合成胜利留 1+）
    expect(final.carriedHp).not.toBeNull();
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

describe('FRUITS-RANDOM-ADVENTURE-R1 流程完整性', () => {
  it('随机 20 个种子均能无卡死跑完一局并到达终态', () => {
    const ctx = advContextFromLoadout();
    for (let i = 0; i < 20; i++) {
      const script = generateAdventureScript(`stress-${i}`);
      const { final } = playAdventure(script, ctx);
      expect(final.phase === 'COMPLETE' || final.phase === 'FAILED').toBe(true);
      expect(final.battlesCompleted).toBe(3);
    }
  });
});
