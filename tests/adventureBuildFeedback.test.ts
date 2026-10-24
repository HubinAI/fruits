/**
 * FRUITS-ADVENTURE-BUILD-FEEDBACK-F3｜强化「可感知」定向测试（纯状态机 + 纯函数）。
 *
 * 覆盖队列验收 1（四项强化真实生效且有可见结果）与必改 1/2/3：
 *   ① 紧急维修：BUILD 路径与 EVENT 路径都**真实修耐久**（正式 Run 口径：0.25 × 上限，
 *      按缺口截断）—— 冒险此前只把它记进 `buffs`（运行时能力只认 kineticBurst），
 *      选它等于空选；这条断言在 HEAD 上是失败的（修复前对照）。
 *   ② 武器三项（双联炮 / 重型弹头 / 三连装填）：经 `RunBattleRuntime` 注入后，
 *      快照里的真实弹丸数量 / 半径确实变了 —— 兑现来自正式逻辑，不是画面特效。
 *   ③ 顶栏显示（F2 口径）随维修同步上升；`advTopDurability` 的 source 判据不变。
 *
 * ⚠️ 本文件不改任何强化数值 / 物理 / 碰撞 / 敌人 / 随机规则，只断言「链路真的通」。
 */
import { describe, it, expect } from 'vitest';
import { generateAdventureScript } from '../src/lab/portraitBattleLab/adventure/advScript';
import {
  advAutoAdvance,
  advCarriedPlayerHp,
  advChoicePool,
  advContextFromLoadout,
  advCurrentNode,
  advEmergencyRepairGain,
  advTopDurability,
  chooseAdventureOption,
  createAdventureState,
  finishAdventureBattle,
  advNeedsPlayer,
  pressAdventureAction,
  type AdventureContext,
  type AdventureState,
} from '../src/lab/portraitBattleLab/adventure/advState';
import { RunBattleRuntime } from '../src/lab/portraitBattleLab/runBattleRuntime';
import { demoRunPlayerLoadout } from '../src/lab/portraitBattleLab/runPageScene';

const ctx: AdventureContext = advContextFromLoadout();
const MAX = ctx.playerHpMax;
/** 正式 Cannon 的 projectileRadius = 10（content.ts）；重型弹头 overlay = 16。 */
const BASE_SHELL_RADIUS = 10;
const HEAVY_SHELL_RADIUS = 16;

/**
 * 推进一个微步骤（事件走「不涉及强化候选」的安全项；BUILD 由调用方决定选谁；
 * 战斗用合成结果收口）。返回新状态；`choice` 非空时在 CHOICE 阶段选中它。
 */
function step(
  s: AdventureState,
  script: ReturnType<typeof generateAdventureScript>,
  choice?: string,
): AdventureState {
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
    if (node.kind !== 'EVENT') throw new Error('EVENT_CHOICE 但节点不是 EVENT');
    const safe = node.options.find((o) => {
      const eff = node.outcomes[o.id];
      return !eff || (eff.kind !== 'buff' && eff.kind !== 'trade');
    });
    return chooseAdventureOption(s, (safe ?? node.options[0]).id, ctx, script);
  }
  if (s.phase === 'CHOICE') {
    const pool = advChoicePool(s, advCurrentNode(s, script), ctx);
    return chooseAdventureOption(s, choice ?? pool[0]?.id ?? '__skip__', ctx, script);
  }
  // R1：纯信息阶段（EVENT / RESULT / EVENT_DONE）由 advAutoAdvance 自动承接，
  //     主操作在其上已是 no-op ⇒ 驱动按新语义分派（推进代码与 R1 前「按继续」相同）。
  return advNeedsPlayer(s) ? pressAdventureAction(s, ctx, script) : advAutoAdvance(s, ctx, script);
}

/** 走查整局：每到 CHOICE 调 `onBuild(state, pool)`；返回 { final, picks }。 */
function walk(
  script: ReturnType<typeof generateAdventureScript>,
  onBuild: (s: AdventureState, pool: readonly { id: string }[]) => AdventureState,
): AdventureState {
  let s = createAdventureState(ctx, script);
  for (let i = 0; i < 500 && s.phase !== 'COMPLETE' && s.phase !== 'FAILED'; i++) {
    if (s.phase === 'CHOICE') {
      const pool = advChoicePool(s, advCurrentNode(s, script), ctx);
      s = onBuild(s, pool);
      continue;
    }
    s = step(s, script);
  }
  return s;
}

describe('FRUITS-ADVENTURE-BUILD-FEEDBACK-F3', () => {
  it('紧急维修：BUILD 路径真实修耐久（0.25 × 上限，按缺口截断）', () => {
    let checked = false;
    for (let i = 0; i < 40 && !checked; i++) {
      const script = generateAdventureScript(`f3-repair-${i}`);
      walk(script, (s, pool) => {
        if (checked || !pool.some((c) => c.id === 'emergencyRepair')) return step(s, script, pool[0]?.id);
        // 人为压低耐久后选紧急维修 ⇒ 必须真实回血
        const low = Math.round(MAX * 0.4);
        const base = advCarriedPlayerHp(s, ctx);
        const before = Math.min(base, low);
        const lowState = { ...s, carriedHp: before } as AdventureState;
        const after = chooseAdventureOption(lowState, 'emergencyRepair', ctx, script);
        expect(advEmergencyRepairGain(before, ctx).gained).toBe(Math.round(MAX * 0.25));
        expect(after.carriedHp).toBe(before + Math.round(MAX * 0.25));
        // 顶栏（F2 口径）同步上升
        expect(advTopDurability(after, ctx, null).hp).toBeGreaterThan(advTopDurability(lowState, ctx, null).hp);
        expect(advTopDurability(after, ctx, null).source).toBe('carried');
        checked = true;
        return after;
      });
    }
    expect(checked).toBe(true);
  });

  it('紧急维修：EVENT buff 路径也真实修耐久（耐久低时生效）', () => {
    let checked = false;
    for (let i = 0; i < 80 && !checked; i++) {
      const script = generateAdventureScript(`f3-ev-${i}`);
      let s = createAdventureState(ctx, script);
      for (let k = 0; k < 500 && !checked; k++) {
        if (s.phase === 'COMPLETE' || s.phase === 'FAILED') break;
        if (s.phase === 'EVENT_CHOICE') {
          const node = advCurrentNode(s, script);
          if (node.kind !== 'EVENT') throw new Error('EVENT_CHOICE 但节点不是 EVENT');
          const pick = node.options.find((o) => {
            const eff = node.outcomes[o.id];
            return (
              eff &&
              (eff.kind === 'buff' || eff.kind === 'trade') &&
              eff.candidates.includes('emergencyRepair' as never)
            );
          });
          if (pick) {
            const eff = node.outcomes[pick.id];
            const cands = (eff && (eff.kind === 'buff' || eff.kind === 'trade') ? eff.candidates : []) as readonly string[];
            // 领取时解析 = 第一个未拥有候选 ⇒ 先「拥有」它前面的候选，保证这次领到的就是紧急维修
            const preOwned = cands.slice(0, cands.indexOf('emergencyRepair'));
            const low = {
              ...s,
              carriedHp: Math.round(MAX * 0.5),
              buffs: [...s.buffs, ...preOwned.filter((id) => !s.buffs.includes(id as never))],
            } as AdventureState;
            const after = chooseAdventureOption(low, pick.id, ctx, script);
            expect(after.buffs).toContain('emergencyRepair');
            expect(after.carriedHp).toBeGreaterThan(low.carriedHp as number);
            checked = true;
            break;
          }
          s = step(s, script);
          continue;
        }
        s = step(s, script);
      }
    }
    expect(checked).toBe(true);
  });

  it('其它强化不碰耐久（只进 Build，carriedHp 不变）', () => {
    let checked = false;
    for (let i = 0; i < 40 && !checked; i++) {
      const script = generateAdventureScript(`f3-nohp-${i}`);
      walk(script, (s, pool) => {
        if (checked) return step(s, script, pool[0]?.id);
        const other = pool.find((c) => c.id !== 'emergencyRepair');
        if (!other) return step(s, script, pool[0]?.id);
        const before = advCarriedPlayerHp(s, ctx);
        const after = chooseAdventureOption(s, other.id, ctx, script);
        expect(after.buffs).toContain(other.id);
        expect(advCarriedPlayerHp(after, ctx)).toBe(before);
        checked = true;
        return after;
      });
    }
    expect(checked).toBe(true);
  });
});

/* ---------------------------------- 运行时兑现（正式逻辑，不是画面特效） */

function runtimeFor(build: readonly string[]): RunBattleRuntime {
  return new RunBattleRuntime({
    build: build as never,
    carriedHp: null,
    encounterId: 'ProtoRusher',
    playerDraft: demoRunPlayerLoadout().draft,
    playerLoadoutTag: 'profile-equipped',
    playerBaseline: true,
  });
}

/** 打到「玩家炮弹同时活着」的峰值数 / 峰值半径（真实快照，逐帧采样）。 */
function sampleShells(rt: RunBattleRuntime, steps = 900): { maxSeen: number; maxRadius: number } {
  let maxSeen = 0;
  let maxRadius = 0;
  for (let i = 0; i < steps && rt.result === null; i++) {
    rt.step(16);
    const mine = (rt.snapshot().projectiles ?? []).filter((p) => p.team === 'A');
    if (mine.length > maxSeen) maxSeen = mine.length;
    for (const p of mine) if (p.radius > maxRadius) maxRadius = p.radius;
  }
  rt.dispose();
  return { maxSeen, maxRadius };
}

describe('F3｜四项强化在正式 Runtime 里真实生效（快照为证）', () => {
  it('双联炮：一次攻击同时活着 2 发玩家炮弹（基线只有 1 发）', () => {
    const base = sampleShells(runtimeFor([]));
    const twin = sampleShells(runtimeFor(['twinCannon']));
    expect(base.maxSeen).toBeGreaterThanOrEqual(1);
    expect(twin.maxSeen).toBeGreaterThanOrEqual(2);
  });

  it('三连装填：一次攻击同时活着 3 发玩家炮弹', () => {
    const triple = sampleShells(runtimeFor(['tripleLoad']));
    expect(triple.maxSeen).toBeGreaterThanOrEqual(3);
  });

  it('重型弹头：玩家炮弹半径 16（基线 10）—— 画面里就是更大的炮弹', () => {
    const base = sampleShells(runtimeFor([]));
    const heavy = sampleShells(runtimeFor(['heavyShell']));
    expect(base.maxRadius).toBeGreaterThanOrEqual(BASE_SHELL_RADIUS - 0.001);
    expect(heavy.maxRadius).toBeGreaterThanOrEqual(HEAVY_SHELL_RADIUS - 0.001);
    expect(heavy.maxRadius).toBeGreaterThan(base.maxRadius);
  });

  it('跨战斗耐久：carriedHp 注入后开局 HP 就是它（紧急维修的兑现落点）', () => {
    const low = Math.round(MAX * 0.5);
    const rt = runtimeFor(['emergencyRepair']);
    const healed = new RunBattleRuntime({
      build: ['emergencyRepair'] as never,
      carriedHp: advEmergencyRepairGain(low, ctx).hp,
      encounterId: 'ProtoRusher',
      playerDraft: demoRunPlayerLoadout().draft,
      playerLoadoutTag: 'profile-equipped',
      playerBaseline: true,
    });
    expect(rt.initialPlayerHp).toBe(rt.playerMaxHp);
    expect(healed.initialPlayerHp).toBe(Math.min(MAX, low + Math.round(MAX * 0.25)));
    expect(healed.playerMaxHp).toBe(rt.playerMaxHp); // 上限不被维修改变
    rt.dispose();
    healed.dispose();
  });
});
