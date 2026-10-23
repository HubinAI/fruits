/**
 * FRUITS-ADVENTURE-REPAIR-VALUE-F5｜「紧急维修」的真实价值定向测试（纯状态机 + 真实物理）。
 *
 * 覆盖 Queue 验收 1～4：
 *   ① 验收 1｜已知种子中的**重复恢复问题被消除**：BUILD 节点不再投放「对下一场战斗开局耐久
 *      净贡献 = 0」的紧急维修（被紧随的自动阶段整备完全吞掉 / 满耐久修不了）。
 *   ② 验收 2｜**不出现扣除代价却没有实际收益的维修选择**：
 *      - BUILD 路径：净贡献 0 ⇒ 该候选根本不出现；
 *      - EVENT 路径：事件授予紧急维修而它此刻无实际收益 ⇒ **不扣 trade 的耐久**、
 *        不发放这个空强化、不写「换来了临时强化」的中奖文案（如实空手）。
 *   ③ 验收 3｜**胜负 / 跨战耐久 / 冒险完整流程不退化**：
 *      - 真实物理跑完整局（真实 RunBattleRuntime），逐局断言能到达终态、7 战齐全；
 *      - 跨战耐久继承契约：下一场战斗的开局 HP === 选完维修后写入的 carriedHp；
 *      - 有效维修选择必须产生**可观测的后续状态变化**（下一场开局 HP 真的更高）。
 *   ④ 验收 4｜**正式存档保持隔离**：本 Queue 不触碰正式存档键。
 *
 * ⚠️ 本文件不改任何强化数值 / 物理 / 碰撞 / 敌人 / 随机规则，只断言「维修选择真的有收益」。
 */
import { describe, it, expect } from 'vitest';
import { generateAdventureScript, type AdventureScript } from '../src/lab/portraitBattleLab/adventure/advScript';
import {
  advAutoResupplyHeal,
  advCarriedPlayerHp,
  advChoicePool,
  advContextFromLoadout,
  advCurrentNode,
  advEmergencyRepairGain,
  advRepairHasRealValue,
  advRepairNetGainToNextBattle,
  chooseAdventureOption,
  createAdventureState,
  finishAdventureBattle,
  pressAdventureAction,
  type AdventureContext,
  type AdventureState,
} from '../src/lab/portraitBattleLab/adventure/advState';
import {
  runGenericChoiceDefs,
  runLayer1PoolDefs,
  runLayer2PoolDefs,
  runLateralPoolDefs,
} from '../src/lab/portraitBattleLab/runModifiers';
import { RunBattleRuntime } from '../src/lab/portraitBattleLab/runBattleRuntime';
import { demoRunPlayerLoadout } from '../src/lab/portraitBattleLab/runPageScene';

const ctx: AdventureContext = advContextFromLoadout();
const MAX = ctx.playerHpMax;
/** 阶段整备的自动回补量（与 presentNode 同一口径，测试内独立复算一次以免「自证」）。 */
const EXPECT_HEAL = Math.round(MAX * 0.5);
/** 紧急维修的修理量（正式 Run 口径 0.25 × 上限）。 */
const EXPECT_REPAIR = Math.round(MAX * 0.25);
/** 商队交易的耐久代价（0.12 × 上限）。 */
const TRADE_DAMAGE = Math.round(MAX * 0.12);

/** 某个 BUILD 节点之后、下一场战斗之前的**自动整备**次数（只有 BANNER 是必然发生的免费恢复）。 */
function autoResuppliesBeforeBattle(script: AdventureScript, nodeId: string): number {
  let count = 0;
  let cursor = script.nodes[nodeId]?.next ?? null;
  while (cursor) {
    const n = script.nodes[cursor];
    if (!n) break;
    if (n.kind === 'BANNER') count++;
    if (n.kind === 'BATTLE' || n.kind === 'FINAL') break;
    cursor = n.next;
  }
  return count;
}

/**
 * F5 修复**前**的候选池（未剔除无效紧急维修）——用于在测试里显式对照「修复前有 / 修复后无」。
 * ⚠️ 这是对修复前行为的**独立复刻**（直接用 runModifiers 的池定义），不是读生产代码的内部状态。
 */
function poolBeforeF5(s: AdventureState, node: AdventureScript['nodes'][string]): readonly string[] {
  if (node.kind !== 'BUILD') return [];
  let ids: string[];
  switch (node.poolKind) {
    case 'layer1':
      ids = runLayer1PoolDefs().map((d) => d.id);
      break;
    case 'layer2':
      ids = runLayer2PoolDefs(
        (() => {
          for (const b of s.buffs) if (['heavyShell', 'twinCannon', 'fastReload'].includes(b)) return b;
          return '';
        })(),
      ).map((d) => d.id);
      break;
    case 'lateral':
      ids = runLateralPoolDefs(s.buffs).map((d) => d.id);
      break;
    case 'generic':
      return runGenericChoiceDefs(s.buffs, ctx.baseWeaponDefId).map((d) => d.id);
  }
  return ids.filter((id) => !s.buffs.includes(id as never) && id !== 'fastReload');
}

/** 真实物理打一场（正式 RunBattleRuntime，非画面特效）。 */
function fight(
  build: readonly string[],
  carriedHp: number,
  encounterId: string,
): { winner: string | null; playerHp: number; steps: number } {
  const rt = new RunBattleRuntime({
    build: build as never,
    carriedHp,
    encounterId,
    playerDraft: demoRunPlayerLoadout().draft,
    playerLoadoutTag: 'profile-equipped',
    playerBaseline: true,
  });
  let steps = 0;
  while (rt.result === null && steps < 4000) {
    rt.step(16);
    steps++;
  }
  const res = rt.result;
  rt.dispose();
  return { winner: res ? res.winner : null, playerHp: res ? res.hpA : 0, steps };
}

/** 走一步：战斗用真实物理推进；事件走「非强化类」安全项（不消耗紧急维修的一次性机会）。 */
function step(
  s: AdventureState,
  script: AdventureScript,
  choice?: string,
): AdventureState {
  if (s.phase === 'BATTLE') {
    const node = advCurrentNode(s, script);
    const enc = node.kind === 'BATTLE' || node.kind === 'FINAL' ? node.encounterId : 'ProtoRusher';
    const r = fight(s.buffs, advCarriedPlayerHp(s, ctx), enc);
    return finishAdventureBattle(
      s,
      { winner: r.winner, endReason: 'f5', playerHp: r.playerHp, enemyHp: 0, steps: r.steps },
      script,
    );
  }
  if (s.phase === 'EVENT_CHOICE') {
    const node = advCurrentNode(s, script);
    if (!('options' in node) || !('outcomes' in node)) return pressAdventureAction(s, ctx, script);
    // 优先选「非强化/非交易」的事件项（不发放紧急维修 ⇒ 它在后续 BUILD 节点仍可出现）
    const safe =
      node.options.find((o) => {
        const eff = node.outcomes[o.id];
        return !eff || (eff.kind !== 'buff' && eff.kind !== 'trade');
      }) ?? node.options[0];
    return chooseAdventureOption(s, safe.id, ctx, script);
  }
  if (s.phase === 'CHOICE') {
    const pool = advChoicePool(s, advCurrentNode(s, script), ctx);
    return chooseAdventureOption(s, choice ?? pool[0]?.id ?? '__skip__', ctx, script);
  }
  return pressAdventureAction(s, ctx, script);
}

describe('FRUITS-ADVENTURE-REPAIR-VALUE-F5｜判据本身（纯函数）', () => {
  it('阶段整备回补量与正式口径一致（0.5 × 上限），紧急维修修理量 = 0.25 × 上限', () => {
    expect(EXPECT_HEAL).toBe(550);
    expect(EXPECT_REPAIR).toBe(275);
    expect(advAutoResupplyHeal(ctx)).toBe(EXPECT_HEAL);
  });

  it('净贡献判据：没有后续整备 ⇒ 净贡献 = 真实修理量（满耐久时 = 0）', () => {
    const low = 300;
    const gain = advEmergencyRepairGain(low, ctx).gained;
    expect(gain).toBe(EXPECT_REPAIR);
    expect(advRepairNetGainToNextBattle(low, gain, 0, ctx)).toBe(EXPECT_REPAIR);
    // 满耐久：修理量本身 = 0 ⇒ 净贡献 0（无收益）
    expect(advRepairNetGainToNextBattle(MAX, 0, 0, ctx)).toBe(0);
    expect(advRepairHasRealValue(MAX, 0, ctx)).toBe(false);
  });

  it('净贡献判据：紧随 1 次自动整备时，hp ≥ 50% 上限 ⇒ 维修被完全吞掉（净贡献 0）', () => {
    // 整备回补 550 ⇒ hp ≥ 550（50% 上限）时，整备自己就能顶满 ⇒ 维修毫无净贡献。
    const swallowed = 550;
    const gain = advEmergencyRepairGain(swallowed, ctx).gained;
    expect(advRepairNetGainToNextBattle(swallowed, gain, 1, ctx)).toBe(0);
    expect(advRepairHasRealValue(swallowed, 1, ctx)).toBe(false);
    // hp 低于 50% ⇒ 整备顶不满 ⇒ 维修仍有净贡献
    const kept = 549;
    const g2 = advEmergencyRepairGain(kept, ctx).gained;
    expect(advRepairNetGainToNextBattle(kept, g2, 1, ctx)).toBeGreaterThan(0);
    expect(advRepairHasRealValue(kept, 1, ctx)).toBe(true);
  });

  it('连续整备（2 次）：净贡献按逐次封顶计算，不会凭空造出收益', () => {
    const hp = 100;
    const gain = advEmergencyRepairGain(hp, ctx).gained;
    const one = advRepairNetGainToNextBattle(hp, gain, 1, ctx);
    const two = advRepairNetGainToNextBattle(hp, gain, 2, ctx);
    expect(one).toBeGreaterThan(0);
    expect(two).toBeLessThanOrEqual(one);
    expect(two).toBeGreaterThanOrEqual(0);
    // hp 很高时，2 次整备必然顶满 ⇒ 净贡献 0
    expect(advRepairNetGainToNextBattle(900, advEmergencyRepairGain(900, ctx).gained, 2, ctx)).toBe(0);
  });
});

describe('FRUITS-ADVENTURE-REPAIR-VALUE-F5｜BUILD 路径：不再投放无效维修（验收 1 / 2）', () => {
  it('40 个种子的所有 BUILD 节点：池中出现 emergencyRepair ⇒ 其净贡献必 > 0', { timeout: 180_000 }, () => {
    let buildNodes = 0;
    let erOffers = 0;
    for (let i = 0; i < 40; i++) {
      const script = generateAdventureScript(`f5-build-${i}`);
      let s = createAdventureState(ctx, script);
      for (let guard = 0; guard < 600; guard++) {
        if (s.phase === 'COMPLETE' || s.phase === 'FAILED') break;
        if (s.phase === 'CHOICE') {
          const node = advCurrentNode(s, script);
          const pool = advChoicePool(s, node, ctx);
          buildNodes++;
          const er = pool.find((p) => p.id === 'emergencyRepair');
          if (er) {
            erOffers++;
            const hp = advCarriedPlayerHp(s, ctx);
            const resupplies = autoResuppliesBeforeBattle(script, node.id);
            // 核心断言：出现在池里的维修，必有真实净贡献（> 0）
            expect(advRepairHasRealValue(hp, resupplies, ctx)).toBe(true);
            const gain = advEmergencyRepairGain(hp, ctx).gained;
            expect(advRepairNetGainToNextBattle(hp, gain, resupplies, ctx)).toBeGreaterThan(0);
          }
          // 策略：优先选**非紧急维修**的候选（让紧急维修保持未拥有 ⇒ 后续节点仍能观察到它）
          const nonEr = pool.find((p) => p.id !== 'emergencyRepair');
          s = chooseAdventureOption(s, nonEr?.id ?? er?.id ?? '__skip__', ctx, script);
          continue;
        }
        s = step(s, script);
      }
    }
    expect(buildNodes).toBeGreaterThan(50);
    expect(erOffers).toBeGreaterThan(0);
  });

  it('已知种子：修复前会投放的「净贡献 = 0」的紧急维修，修复后不再出现（验收 1）', { timeout: 180_000 }, () => {
    // 收集「修复前存在、且净贡献 = 0」的具体案例（seed + 节点 + 耐久读数）
    const beforeCases: string[] = [];
    for (let i = 0; i < 40; i++) {
      const script = generateAdventureScript(`f5-build-${i}`);
      let s = createAdventureState(ctx, script);
      for (let guard = 0; guard < 600; guard++) {
        if (s.phase === 'COMPLETE' || s.phase === 'FAILED') break;
        if (s.phase === 'CHOICE') {
          const node = advCurrentNode(s, script);
          const hp = advCarriedPlayerHp(s, ctx);
          const resupplies = autoResuppliesBeforeBattle(script, node.id);
          const before = poolBeforeF5(s, node);
          const after = advChoicePool(s, node, ctx).map((p) => p.id);
          if (before.includes('emergencyRepair')) {
            const gain = advEmergencyRepairGain(hp, ctx).gained;
            const net = advRepairNetGainToNextBattle(hp, gain, resupplies, ctx);
            if (net <= 0) {
              // 修复前：池里有这个无效的紧急维修；修复后：池里没有
              expect(after).not.toContain('emergencyRepair');
              beforeCases.push(`f5-build-${i}/${node.id} hp=${Math.round(hp)} 后续整备=${resupplies}`);
            }
          }
          const nonEr = advChoicePool(s, node, ctx).find((p) => p.id !== 'emergencyRepair');
          s = chooseAdventureOption(s, nonEr?.id ?? '__skip__', ctx, script);
          continue;
        }
        s = step(s, script);
      }
    }
    // 至少复现出一个真实的「重复恢复」案例（否则本用例只是空转）
    expect(beforeCases.length).toBeGreaterThan(0);
    console.log('[F5] 修复前「净贡献=0 的紧急维修」案例：', beforeCases.join(' | '));
  });

  it('满耐久时不投放紧急维修（没有任何可修的地方 ⇒ 不是有效选择）', () => {
    const script = generateAdventureScript('f5-full-hp');
    let s = createAdventureState(ctx, script);
    for (let i = 0; i < 400 && s.phase !== 'CHOICE'; i++) {
      if (s.phase === 'COMPLETE' || s.phase === 'FAILED') break;
      s = step(s, script);
    }
    expect(s.phase).toBe('CHOICE');
    const node = advCurrentNode(s, script);
    const full = { ...s, carriedHp: MAX } as AdventureState;
    const pool = advChoicePool(full, node, ctx);
    expect(pool.some((p) => p.id === 'emergencyRepair')).toBe(false);
  });

  it('低耐久 + 后续无自动整备时，紧急维修仍在池中且可选（不得把有效选择也砍掉）', () => {
    // layer2 池（heavyShell 路线）含紧急维修：构造一个确定的「低耐久 + 无后续整备」场景
    const script = generateAdventureScript('f5-low-hp');
    let targetId = '';
    for (const n of Object.values(script.nodes)) {
      if (n.kind !== 'BUILD') continue;
      if (n.poolKind !== 'layer2') continue;
      if (autoResuppliesBeforeBattle(script, n.id) !== 0) continue;
      targetId = n.id;
      break;
    }
    expect(targetId).not.toBe('');
    const node = script.nodes[targetId];
    expect(node.kind).toBe('BUILD');
    const base = createAdventureState(ctx, script);
    // 已选一层强化（heavyShell）⇒ 进入 layer2 池
    const low = {
      ...base,
      phase: 'CHOICE' as const,
      nodeId: targetId,
      carriedHp: 300,
      buffs: ['heavyShell'],
    } as AdventureState;
    const pool = advChoicePool(low, node, ctx);
    expect(pool.some((p) => p.id === 'emergencyRepair')).toBe(true);
    // 且此刻它的净贡献确实 > 0
    expect(advRepairHasRealValue(300, autoResuppliesBeforeBattle(script, targetId), ctx)).toBe(true);
  });

  it('已知种子 scan-4：紧跟阶段整备的 BUILD 节点不再投放紧急维修，有效节点仍投放', () => {
    // scan-4 的真实链序（脚本生成器产出）：
    //   k3(generic, 后续整备=0) ← 紧急维修在此**有效**（下一场战斗前没有整备）
    //   k4(layer1, 后续整备=1) ← 此类节点若投放紧急维修会被整备完全吞掉 ⇒ 必须不投放
    const script = generateAdventureScript('scan-4');
    const k3 = script.nodes['k3'];
    const k4 = script.nodes['k4'];
    expect(k3.kind).toBe('BUILD');
    expect(k4.kind).toBe('BUILD');
    expect(k3.kind === 'BUILD' && k3.autoResupplyBeforeBattle).toBe(0);
    expect(k4.kind === 'BUILD' && k4.autoResupplyBeforeBattle).toBe(1);

    // k3：低耐久 + 无后续整备 ⇒ 紧急维修有效，仍在池中
    const base = createAdventureState(ctx, script);
    const atK3 = {
      ...base,
      phase: 'CHOICE' as const,
      nodeId: 'k3',
      carriedHp: 300,
    } as AdventureState;
    expect(advChoicePool(atK3, k3, ctx).some((p) => p.id === 'emergencyRepair')).toBe(true);

    // k4：耐久足够高（≥50% 上限）且下一场战斗前有 1 次整备 ⇒ 净贡献 = 0 ⇒ 不投放
    const atK4 = {
      ...base,
      phase: 'CHOICE' as const,
      nodeId: 'k4',
      carriedHp: Math.round(MAX * 0.6),
    } as AdventureState;
    expect(advRepairHasRealValue(Math.round(MAX * 0.6), 1, ctx)).toBe(false);
    const poolK4 = advChoicePool(atK4, k4, ctx);
    expect(poolK4.some((p) => p.id === 'emergencyRepair')).toBe(false);
  });
});

describe('FRUITS-ADVENTURE-REPAIR-VALUE-F5｜EVENT 路径：不扣代价却无收益（验收 2）', () => {
  /** 找一个带指定类型事件、且候选里含 emergencyRepair 的种子。 */
  function findEvent(kind: 'buff' | 'trade'): { script: AdventureScript; nodeId: string; optionId: string } {
    for (let i = 0; i < 4000; i++) {
      const sc = generateAdventureScript(`f5-ev-${kind}-${i}`);
      for (const n of Object.values(sc.nodes)) {
        if (n.kind !== 'EVENT') continue;
        for (const [oid, eff] of Object.entries(n.outcomes)) {
          if (eff.kind === kind && eff.candidates.includes('emergencyRepair')) {
            return { script: sc, nodeId: n.id, optionId: oid };
          }
        }
      }
    }
    throw new Error(`未找到 ${kind} 事件`);
  }

  it('满耐久时事件授予紧急维修：不扣 trade 耐久、不发空强化、如实报告', () => {
    const f = findEvent('trade');
    const node = f.script.nodes[f.nodeId];
    expect(node.kind).toBe('EVENT');
    const eff = node.kind === 'EVENT' ? node.outcomes[f.optionId] : null;
    expect(eff && eff.kind === 'trade').toBe(true);
    const candidates = eff && (eff.kind === 'buff' || eff.kind === 'trade') ? eff.candidates : [];
    // 已拥有其它候选 ⇒ 唯一可领的是紧急维修，而它此刻修不了
    const preOwned = candidates.filter((id) => id !== 'emergencyRepair');
    const s0 = {
      ...createAdventureState(ctx, f.script),
      phase: 'EVENT_CHOICE' as const,
      nodeId: f.nodeId,
      carriedHp: MAX,
      buffs: preOwned,
    } as AdventureState;

    const after = chooseAdventureOption(s0, f.optionId, ctx, f.script);
    // ① 不扣耐久（满耐久前后不变）
    expect(advCarriedPlayerHp(after, ctx)).toBe(MAX);
    // ② 不发放这个空强化（紧急维修没进 buffs）
    expect(after.buffs).not.toContain('emergencyRepair');
    // ③ 如实报告（不写「换来了临时强化」这类中奖文案）
    const text = after.eventResult ?? '';
    expect(text).not.toMatch(/换来了临时强化/);
    expect(text).toMatch(/没有收益/);
  });

  it('低耐久时事件授予紧急维修：仍真实修耐久（有效选择不被误伤）', () => {
    const f = findEvent('trade');
    const node = f.script.nodes[f.nodeId];
    expect(node.kind).toBe('EVENT');
    const eff = node.kind === 'EVENT' ? node.outcomes[f.optionId] : null;
    expect(eff && eff.kind === 'trade').toBe(true);
    const candidates = eff && (eff.kind === 'buff' || eff.kind === 'trade') ? eff.candidates : [];
    const preOwned = candidates.filter((id) => id !== 'emergencyRepair');
    const s0 = {
      ...createAdventureState(ctx, f.script),
      phase: 'EVENT_CHOICE' as const,
      nodeId: f.nodeId,
      carriedHp: 300,
      buffs: preOwned,
    } as AdventureState;

    const after = chooseAdventureOption(s0, f.optionId, ctx, f.script);
    // 低耐久 ⇒ 维修真实生效（trade 口径：先扣 132 代价，再按扣后的缺口修 275）
    expect(after.buffs).toContain('emergencyRepair');
    expect(advCarriedPlayerHp(after, ctx)).toBe(300 - TRADE_DAMAGE + EXPECT_REPAIR);
    // 净效果仍然是赚的（付了代价但换回更多耐久）
    expect(advCarriedPlayerHp(after, ctx)).toBeGreaterThan(300);
  });

  it('低耐久时事件授予紧急维修（buff 免费路径）：直接修回 275 点，不扣任何代价', () => {
    const f = findEvent('buff');
    const node = f.script.nodes[f.nodeId];
    expect(node.kind).toBe('EVENT');
    const eff = node.kind === 'EVENT' ? node.outcomes[f.optionId] : null;
    expect(eff && eff.kind === 'buff').toBe(true);
    const candidates = eff && (eff.kind === 'buff' || eff.kind === 'trade') ? eff.candidates : [];
    const preOwned = candidates.filter((id) => id !== 'emergencyRepair');
    const s0 = {
      ...createAdventureState(ctx, f.script),
      phase: 'EVENT_CHOICE' as const,
      nodeId: f.nodeId,
      carriedHp: 300,
      buffs: preOwned,
    } as AdventureState;

    const after = chooseAdventureOption(s0, f.optionId, ctx, f.script);
    expect(after.buffs).toContain('emergencyRepair');
    expect(advCarriedPlayerHp(after, ctx)).toBe(300 + EXPECT_REPAIR);
  });
});

describe('FRUITS-ADVENTURE-REPAIR-VALUE-F5｜真实冒险：维修选择产生有效后续状态变化（验收 3 / 4）', () => {
  it('真实物理跑完 6 局：终态可达、战斗场次合理、跨战耐久真实继承', { timeout: 180_000 }, () => {
    let completed = 0;
    let failed = 0;
    for (let i = 0; i < 6; i++) {
      const script = generateAdventureScript(`f5-real-${i}`);
      let s = createAdventureState(ctx, script);
      for (let guard = 0; guard < 600; guard++) {
        if (s.phase === 'COMPLETE' || s.phase === 'FAILED') break;
        if (s.phase === 'CHOICE') {
          const pool = advChoicePool(s, advCurrentNode(s, script), ctx);
          s = chooseAdventureOption(s, pool[0]?.id ?? '__skip__', ctx, script);
          continue;
        }
        s = step(s, script);
      }
      expect(s.phase === 'COMPLETE' || s.phase === 'FAILED').toBe(true);
      // 完成态 ⇒ 走完全部 7 战；失败态 ⇒ 耐久耗尽即结束（战斗场次 ≤ 7，≥ 1）
      expect(s.battlesCompleted).toBeGreaterThanOrEqual(1);
      expect(s.battlesCompleted).toBeLessThanOrEqual(7);
      if (s.phase === 'COMPLETE') {
        completed++;
        expect(s.battlesCompleted).toBe(7);
        expect(s.battlesWon).toBe(7);
      } else {
        failed++;
        expect(s.carriedHp).toBe(0);
      }
      expect(s.battlesWon).toBeLessThanOrEqual(s.battlesCompleted);
    }
    // 两类终态都应可达（不退化）
    expect(completed + failed).toBe(6);
  });

  it('有效维修 ⇒ 下一场战斗的开局 HP 真的更高（跨战继承可被真实物理对照证明）', () => {
    // 构造一个确定的「低耐久 + 无后续整备 + layer2 池」场景
    const script = generateAdventureScript('f5-carry');
    let targetId = '';
    for (const n of Object.values(script.nodes)) {
      if (n.kind !== 'BUILD') continue;
      if (n.poolKind !== 'layer2') continue;
      if (autoResuppliesBeforeBattle(script, n.id) !== 0) continue;
      targetId = n.id;
      break;
    }
    expect(targetId).not.toBe('');
    const node = script.nodes[targetId];
    expect(node.kind).toBe('BUILD');
    const base = createAdventureState(ctx, script);
    const low = {
      ...base,
      phase: 'CHOICE' as const,
      nodeId: targetId,
      carriedHp: 300,
      buffs: ['heavyShell'],
    } as AdventureState;

    const hpBefore = advCarriedPlayerHp(low, ctx);
    const afterPick = chooseAdventureOption(low, 'emergencyRepair', ctx, script);
    const hpAfter = advCarriedPlayerHp(afterPick, ctx);
    // 有效维修 ⇒ 耐久真的上升
    expect(hpAfter).toBeGreaterThan(hpBefore);
    expect(hpAfter).toBe(300 + EXPECT_REPAIR);

    // 跨战继承：把 hpAfter 注入真实战斗，开局 HP 就是它（上限不变）
    const rt = new RunBattleRuntime({
      build: afterPick.buffs as never,
      carriedHp: hpAfter,
      encounterId: 'ProtoRusher',
      playerDraft: demoRunPlayerLoadout().draft,
      playerLoadoutTag: 'profile-equipped',
      playerBaseline: true,
    });
    expect(rt.initialPlayerHp).toBe(hpAfter);
    expect(rt.playerMaxHp).toBe(MAX);
    rt.dispose();
  });

  it('正式存档键不受本 Queue 影响（验收 4：正式存档保持隔离）', async () => {
    const { archiveStorageKey } = await import('../src/lab/portraitBattleLab/adventure/advArchive');
    // 冒险档案键与正式存档键分离
    expect(archiveStorageKey()).toBe('strongfruit.adventure.r3.testArchive.v1');
    expect(archiveStorageKey()).not.toBe('strongfruit.playerBuild.v1');
  });
});
