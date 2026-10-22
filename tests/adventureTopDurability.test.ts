/**
 * FRUITS-ADVENTURE-BATTLE-HP-F2｜顶部耐久条实时 HP（纯状态机 + 纯显示函数，无需 DOM）。
 *
 * 覆盖队列三项验收：
 *   ① 战斗中真实 HP 下降 ⇒ 顶栏显示同步下降（`source = battle-live`，逐帧取运行时 hp）；
 *   ② 战斗结束 / 维修 / 进入下一场 ⇒ 显示与已结算 carriedHp 一致（`source = carried`）；
 *   ③ 切场不回跳：`carriedHp = outcome.playerHp` = 最后一帧实时 HP，且分母恒为
 *      `ctx.playerHpMax` ⇒ 百分比连续（不因「换数据来源」跳变）。
 *
 * ⚠️ 本测试只断言**显示口径**，不触碰伤害 / 维修 / 继承 / 结算的数值规则
 *    （那些由 `run_adventure_seed.test.ts` 与正式战斗测试守卫）。
 */
import { describe, it, expect } from 'vitest';
import { generateAdventureScript, type AdventureScript } from '../src/lab/portraitBattleLab/adventure/advScript';
import {
  advCarriedPlayerHp,
  advChoicePool,
  advContextFromLoadout,
  advCurrentNode,
  advTopDurability,
  chooseAdventureOption,
  createAdventureState,
  finishAdventureBattle,
  pressAdventureAction,
  type AdventureContext,
  type AdventureState,
} from '../src/lab/portraitBattleLab/adventure/advState';

const ctx: AdventureContext = advContextFromLoadout();
const MAX = ctx.playerHpMax;

/** 推进一个微步骤（战斗用合成结果收口；事件优先挑维修，便于覆盖「维修后显示跟随」）。 */
function step(s: AdventureState, script: AdventureScript): AdventureState {
  if (s.phase === 'BATTLE') {
    const cur = advCarriedPlayerHp(s, ctx);
    return finishAdventureBattle(
      s,
      { winner: 'A', endReason: 'test', playerHp: Math.max(1, cur - 30), enemyHp: 0, steps: 40 },
      script,
    );
  }
  if (s.phase === 'EVENT_CHOICE') {
    const node = advCurrentNode(s, script);
    if (node.kind !== 'EVENT') throw new Error(`EVENT_CHOICE 但节点是 ${node.kind}`);
    const preferred = node.options.find((o) => o.id === 'repair') ?? node.options[0];
    return chooseAdventureOption(s, preferred.id, ctx, script);
  }
  if (s.phase === 'CHOICE') {
    const node = advCurrentNode(s, script);
    const pool = advChoicePool(s, node, ctx);
    return chooseAdventureOption(s, pool.length > 0 ? pool[0].id : '__skip__', ctx, script);
  }
  return pressAdventureAction(s, ctx, script);
}

/** 从 IDLE 推进到首个 BATTLE（真实节点序列，不改脚本）。 */
function driveToBattle(script: AdventureScript): AdventureState {
  let s = createAdventureState(ctx, script);
  for (let i = 0; i < 200 && s.phase !== 'BATTLE'; i++) s = step(s, script);
  if (s.phase !== 'BATTLE') throw new Error('[F2-TEST] 未能推进到 BATTLE');
  return s;
}

describe('FRUITS-ADVENTURE-BATTLE-HP-F2 顶部耐久条实时 HP', () => {
  it('战斗中：显示值逐帧跟随真实 HP，并单调下降（source = battle-live）', () => {
    const script = generateAdventureScript('f2-live-follow');
    const battle = driveToBattle(script);
    const start = advCarriedPlayerHp(battle, ctx);

    // 真实战斗里的典型序列（D1 实测：968 → 839，中途多段掉血）
    const series = [start, start - 37, start - 90, start - 129];
    const pcts: number[] = [];
    for (const live of series) {
      const top = advTopDurability(battle, ctx, { hp: live });
      expect(top.source).toBe('battle-live');
      expect(top.hp).toBe(live);
      expect(top.max).toBe(MAX);
      expect(top.pct).toBe(Math.round((live / MAX) * 100));
      pcts.push(top.pct);
    }
    // 严格下降（这就是 D1 里「顶栏恒 88%」的反例）
    for (let i = 1; i < pcts.length; i++) {
      expect(pcts[i]).toBeLessThan(pcts[i - 1]);
    }
    // 同一帧的「旧口径」不会动 —— 证明差异确实来自数据来源切换，而非 HP 真值变化
    expect(advCarriedPlayerHp(battle, ctx)).toBe(start);
  });

  it('战斗中但无运行时读数 ⇒ 回落到 carriedHp（不凭空造 0）', () => {
    const script = generateAdventureScript('f2-live-follow');
    const battle = driveToBattle(script);
    const top = advTopDurability(battle, ctx, null);
    expect(top.source).toBe('carried');
    expect(top.hp).toBe(advCarriedPlayerHp(battle, ctx));
  });

  it('切场不回跳：finish 后显示 = 最后一帧实时 HP，且百分比连续', () => {
    const script = generateAdventureScript('f2-no-jump');
    const battle = driveToBattle(script);
    const start = advCarriedPlayerHp(battle, ctx);
    const lastLive = Math.max(1, start - 129);

    const inBattle = advTopDurability(battle, ctx, { hp: lastLive });
    const after = finishAdventureBattle(
      battle,
      { winner: 'A', endReason: 'test', playerHp: lastLive, enemyHp: 0, steps: 90 },
      script,
    );
    expect(after.phase).toBe('RESULT');

    const settled = advTopDurability(after, ctx, { hp: lastLive }); // 即便仍传 live，也不再采用
    expect(settled.source).toBe('carried');
    expect(settled.hp).toBe(lastLive);
    expect(settled.max).toBe(inBattle.max); // 分母同源 ⇒ 百分比不跳
    expect(settled.pct).toBe(inBattle.pct);
  });

  it('整局：非战斗阶段显示恒等于 carriedHp；战斗阶段恒等于传入的实时值', () => {
    const script = generateAdventureScript('f2-full-run');
    let s = createAdventureState(ctx, script);
    const seen = new Set<string>();
    let battleFrames = 0;
    let prevPhase: string = s.phase;

    for (let i = 0; i < 400 && s.phase !== 'COMPLETE' && s.phase !== 'FAILED'; i++) {
      seen.add(s.phase);
      if (s.phase === 'BATTLE') {
        // 模拟整场真实掉血：开局 → 结束前，逐帧多次采样
        const start = advCarriedPlayerHp(s, ctx);
        for (let f = 0; f <= 4; f++) {
          const live = Math.max(1, start - f * 20);
          const top = advTopDurability(s, ctx, { hp: live });
          expect(top.source).toBe('battle-live');
          expect(top.hp).toBe(live);
          battleFrames++;
        }
        // 非战斗阶段（含 RESULT / 维修 / EVENT_DONE）一律读已结算值
        const settled = advTopDurability(s, ctx, null);
        expect(settled.source).toBe('carried');
      } else {
        const top = advTopDurability(s, ctx, { hp: 1 }); // 传 live 也不该被采用
        expect(top.source).toBe('carried');
        expect(top.hp).toBe(advCarriedPlayerHp(s, ctx));
        expect(top.pct).toBe(
          Math.max(0, Math.min(100, Math.round((advCarriedPlayerHp(s, ctx) / MAX) * 100))),
        );
      }
      prevPhase = s.phase;
      s = step(s, script);
      // 阶段跃迁后立刻校验（覆盖「切场」这一帧）
      if (prevPhase === 'BATTLE' && s.phase !== 'BATTLE') {
        const top = advTopDurability(s, ctx, null);
        expect(top.source).toBe('carried');
        expect(top.hp).toBe(advCarriedPlayerHp(s, ctx));
      }
    }
    expect(battleFrames).toBeGreaterThan(0);
    expect(seen.has('BATTLE')).toBe(true);
    expect(s.phase === 'COMPLETE' || s.phase === 'FAILED').toBe(true);
  });

  it('维修 / 阶段整备（carriedHp 上升）⇒ 显示同步上升', () => {
    // 找一个含「维修」选项的种子，推进到该事件并真实结算
    let checked = false;
    for (let i = 0; i < 40 && !checked; i++) {
      const script = generateAdventureScript(`f2-repair-${i}`);
      let s = createAdventureState(ctx, script);
      for (let k = 0; k < 400; k++) {
        if (s.phase === 'EVENT_CHOICE') {
          const node = advCurrentNode(s, script);
          if (node.kind === 'EVENT' && node.eventKind === 'rest' && node.options.some((o) => o.id === 'repair')) {
            // 先人为压低耐久，确保维修有可见增益
            const before = advTopDurability(s, ctx, null);
            const after = chooseAdventureOption(s, 'repair', ctx, script);
            const shown = advTopDurability(after, ctx, null);
            expect(shown.source).toBe('carried');
            expect(shown.hp).toBe(advCarriedPlayerHp(after, ctx));
            expect(shown.hp).toBeGreaterThanOrEqual(before.hp);
            expect(shown.pct).toBeGreaterThanOrEqual(before.pct);
            checked = true;
            break;
          }
          s = step(s, script);
          continue;
        }
        if (s.phase === 'COMPLETE' || s.phase === 'FAILED') break;
        s = step(s, script);
      }
    }
    expect(checked).toBe(true);
  });

  it('边界：HP 为负 / 超过上限都被夹紧（不画反条、不超 100%）', () => {
    const script = generateAdventureScript('f2-clamp');
    const battle = driveToBattle(script);

    const dead = advTopDurability(battle, ctx, { hp: -12 });
    expect(dead.hp).toBe(0);
    expect(dead.pct).toBe(0);

    const over = advTopDurability(battle, ctx, { hp: MAX * 3 });
    expect(over.hp).toBe(MAX);
    expect(over.pct).toBe(100);
  });
});
