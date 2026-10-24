/**
 * FRUITS-ADVENTURE-UX-CONTINUITY-R1｜测试侧的统一驱动（只在 tests/ 内使用，不进产品代码）。
 *
 * 为什么需要它：R1 把纯信息阶段（EVENT / RESULT / EVENT_DONE）改成自动承接之后，
 * 「每步都按一次主动作」的旧驱动会在这些阶段原地打转（主操作已是 no-op）。
 * 这个 helper 给出**唯一**正确驱动：需要玩家 → 按主操作 / 选卡；纯信息 → 自动承接。
 *
 * ⚠️ 它与产品代码同构、不改变任何结算：两条分支分别调用 `pressAdventureAction` 与
 *    `advAutoAdvance`，而后者就是 R1 之前「按继续」所走的同一段推进代码。
 */
import {
  advAutoAdvance,
  advCarriedPlayerHp,
  advChoicePool,
  advCurrentNode,
  advNeedsPlayer,
  chooseAdventureOption,
  createAdventureState,
  finishAdventureBattle,
  pressAdventureAction,
  type AdventureContext,
  type AdventureState,
} from '../src/lab/portraitBattleLab/adventure/advState';
import type { AdventureScript } from '../src/lab/portraitBattleLab/adventure/advScript';

export interface DriveOptions {
  /** 选择策略：事件选项（默认取第一个选项）；BUILD（默认取候选池第一个）。 */
  readonly pickEventOption?: (optionIds: readonly string[], nodeId: string) => string;
  readonly pickBuild?: (pool: readonly string[], nodeId: string) => string;
  /** 战斗合成结果（默认每场都赢，剩余耐久 -30）。 */
  readonly resolveBattle?: (state: AdventureState, ctx: AdventureContext, index: number) => AdventureState;
}

/** 推进一个微步骤（不改脚本、不改结算）。 */
export function driveStep(s: AdventureState, ctx: AdventureContext, script: AdventureScript, opts: DriveOptions = {}): AdventureState {
  if (s.phase === 'BATTLE') {
    if (opts.resolveBattle) return opts.resolveBattle(s, ctx, s.battlesCompleted);
    const cur = advCarriedPlayerHp(s, ctx);
    return finishAdventureBattle(s, { winner: 'A', endReason: 'test', playerHp: Math.max(1, cur - 30), enemyHp: 0, steps: 40 }, script);
  }
  if (s.phase === 'EVENT_CHOICE') {
    const node = advCurrentNode(s, script);
    if (node.kind !== 'EVENT') throw new Error(`EVENT_CHOICE 但节点是 ${node.kind}`);
    const ids = node.options.map((o) => o.id);
    const id = opts.pickEventOption ? opts.pickEventOption(ids, node.id) : ids[0];
    return chooseAdventureOption(s, id, ctx, script);
  }
  if (s.phase === 'CHOICE') {
    const node = advCurrentNode(s, script);
    if (node.kind !== 'BUILD') throw new Error(`CHOICE 但节点是 ${node.kind}`);
    const pool = advChoicePool(s, node, ctx).map((d) => d.id);
    const id = opts.pickBuild ? opts.pickBuild(pool, node.id) : pool[0];
    return chooseAdventureOption(s, id ?? '__skip__', ctx, script);
  }
  // IDLE → 按主操作；EVENT / RESULT / EVENT_DONE → 自动承接（R1 后主操作在其上为 no-op）
  return advNeedsPlayer(s) ? pressAdventureAction(s, ctx, script) : advAutoAdvance(s, ctx, script);
}

/** 从开局跑到终态（COMPLETE / FAILED），返回终态与经过的阶段序列。 */
export function driveRun(
  script: AdventureScript,
  ctx: AdventureContext,
  opts: DriveOptions = {},
): { final: AdventureState; trail: string[] } {
  let s = createAdventureState(ctx, script);
  const trail: string[] = [s.phase];
  for (let guard = 0; guard < 800; guard++) {
    if (s.phase === 'COMPLETE' || s.phase === 'FAILED') break;
    const next = driveStep(s, ctx, script, opts);
    if (next === s) throw new Error(`[R1-DRIVE] 阶段 ${s.phase} 无法推进`);
    s = next;
    if (trail[trail.length - 1] !== s.phase) trail.push(s.phase);
  }
  return { final: s, trail };
}
