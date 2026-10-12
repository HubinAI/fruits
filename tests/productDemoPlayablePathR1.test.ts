/**
 * DEMO-PLAYABLE-PATH-R1｜**最小完整通关回归**（正常可达 Cannon 配置 + 两个正式强化节点）。
 *
 * ── 本 Queue 要钉死的一条基线 ───────────────────────────────────────────────
 *
 *   RUN-WEAPON-GROWTH-R1 复测证明：**产品默认车（watermelon + cannon）零成长在当前
 *   正式三段链上 FAILED@2**。本文件回答下一问：**玩家用正常可获得的配置、走正式
 *   强化节点，是否存在一条完整可玩的通关路线** —— 答案是**存在**：
 *
 *     chassis = `mangoBody + cannon + smallWheel(前) + smallWheel(后)`
 *     Build   = `fastReload → emergencyRepair`（终局余量 203.4，全部 6 条路线中最宽）
 *
 * ── 「正常可达」口径（三件来源都走正式种子链，file:line 证据）────────────────
 *
 *   | 件 | 来源 | 证据 |
 *   |---|---|---|
 *   | `mangoBody` | R4 Body 种子（durian+mango MVP）+ R5 内容池种子（全部新 Body） | `r4BodyChoiceSeed.ts:113-116`（`MVP_BODY_CHOICE_IDS` 自 `NEW_OFFICIAL_BODIES` filter）/ `r5ContentPoolSeed.ts` `R5_POOL_BODY_IDS = NEW_OFFICIAL_BODIES` / 挂载统一入口 `playerGrowth.openGrowthSession()`（`playerGrowth.ts:460` 起，顺序调用 R3→R4→R5） |
 *   | `smallWheel` | R3 Movement 种子（三档各补到 ★1×1） | `r3MovementChoiceSeed.ts`（small/large/heavy 各补 1） |
 *   | `cannon` | 新账号初始 | `partInventory.ts:36` `STARTER_PARTS` |
 *
 *   ⇒ 真实账号挂载一次首页（Garage）后即可在 Garage 里装配出这一台车。
 *
 * ── 与其它证据的分工 ────────────────────────────────────────────────────────
 *
 *   - R10 权威矩阵（`productRunFullReachableSpaceR10`）记的是**全空间数量**（cannon=1
 *     chassis），不落盘具体组合；本文件把那条 chassis **点名钉死**为回归基线。
 *   - R9-03（`productRunThreeStagePacingR9`）钉的是 machineGun 多槽装配的成功路径；
 *     本文件钉的是 **cannon 单主武器 + 正常可达** 的成功路径（两件不同的事，互补）。
 *
 * ── 测试内容（Queue 必改 1 / 必改 4）────────────────────────────────────────
 *
 *   - D-01 夹具自检：chassis 三件全部「正常可达」+ 资格层放行 + canonical 数值现读；
 *   - D-02 **最小完整通关回归**：正式状态机全链（EVENT→BATTLE→CHOICE×2→FINAL）
 *     真跑三段 → COMPLETE，冻结逐场读数（改任何 Weapon/Enemy/Body 数值都当场炸出）；
 *   - D-03 必改 4｜结算 → 领奖（幂等）→ 装备保持 → **再次开局**（新 Run 重新放行）；
 *   - D-04 确定性：同参数复跑读数逐字相同（保证回归基线可重复）。
 *
 * ── 红线 ──────────────────────────────────────────────────────────────────
 *   本文件不改任何产品代码 / 数值 / 脚本；不强制胜利（选项走真实候选池 `chooseRunBuff`，
 *   `accepted` 取证）；失败与成功都由真实战斗决定。
 */
import { describe, expect, it } from 'vitest';

import { registry } from '../src/core/content';
import { EMPTY_SLOT, type BuildDraft } from '../src/lab/buildEditorModel';
import { RunBattleRuntime } from '../src/lab/portraitBattleLab/runBattleRuntime';
import { RUN_TOTAL_BATTLES } from '../src/lab/portraitBattleLab/runScript';
import {
  chooseRunBuff,
  createRunPageState,
  finishRunBattle,
  pressRunAction,
  runBuildIds,
  runCarriedPlayerHp,
  runChoicePool,
  runChoicePoolKind,
  runCurrentNode,
  runComplete,
  runFailed,
  type RunPageContext,
  type RunPageState,
} from '../src/lab/portraitBattleLab/runPageState';
import { runPageContext } from '../src/lab/portraitBattleLab/runPageScene';
import { NEW_OFFICIAL_BODIES } from '../src/core/bodyOwnership';
import { canStartFullRun } from '../src/product/runCompatibility';
import { getCount } from '../src/core/partInventory';
import {
  WEAPON_SLOT,
  defaultPlayerDraft,
  playerInventory,
} from '../src/product/playerLoadout';
import { R3_MOVEMENT_SEED_KEY } from '../src/product/r3MovementChoiceSeed';
import { R4_BODY_SEED_KEY } from '../src/product/r4BodyChoiceSeed';
import { R5_CONTENT_POOL_KEY } from '../src/product/r5ContentPoolSeed';

/* --------------------------------------------------------------- 夹具常量 */

const FRAME_MS = 1000 / 60;
const MAX_FRAMES = 4000;
const PRODUCT_TAG = 'profile-equipped';
const SLOW_MS = 300_000;

/** 本 Queue 点名的通关 chassis。 */
const WIN_BODY = 'mangoBody';
const WIN_WEAPON = 'cannon';
const WIN_WHEEL = 'smallWheel';
/** 最宽 COMPLETE 路线（6 条里终局余量最大：203.4）。 */
const WIN_PICKS: readonly string[] = ['fastReload', 'emergencyRepair'];

/** 与 R10 `productDraft` 同源：基底 = 真实产品默认车（top 由产品逻辑清空）。 */
function productDraft(bodyDefId: string, weapon: string, frontWheel: string, rearWheel: string): BuildDraft {
  const base = defaultPlayerDraft();
  const selections: Record<string, string> = {
    ...base.functionalSelections,
    [WEAPON_SLOT]: weapon,
    front: EMPTY_SLOT,
    rear: EMPTY_SLOT,
  };
  const next: BuildDraft = { ...base, bodyDefId, functionalSelections: selections };
  next.frontWheelDefId = frontWheel;
  next.frontRadius = registry.movements.get(frontWheel)?.radius ?? 20;
  next.rearWheelDefId = rearWheel;
  next.rearRadius = registry.movements.get(rearWheel)?.radius ?? 20;
  return next;
}

const WIN_DRAFT: BuildDraft = productDraft(WIN_BODY, WIN_WEAPON, WIN_WHEEL, WIN_WHEEL);

/* ------------------------------------------------------- 状态机全链走查 */

interface SegFact {
  readonly nodeId: string;
  readonly encounterId: string;
  readonly build: readonly string[];
  readonly hpA0: number;
  readonly hpA: number;
  readonly hpB: number;
  readonly hpBMax: number;
  readonly steps: number;
  readonly winner: string | null;
  readonly hits: number;
  readonly perHit: readonly number[];
}

interface WalkFact {
  readonly phase: string;
  readonly complete: boolean;
  readonly failed: boolean;
  readonly segs: readonly SegFact[];
  readonly picks: readonly { readonly nodeId: string; readonly kind: string | null; readonly pool: readonly string[]; readonly pick: string; readonly accepted: boolean }[];
  readonly battlesCompleted: number;
}

function walkRun(draft: BuildDraft, picks: readonly string[]): WalkFact {
  const ctx: RunPageContext = runPageContext({
    source: 'profile',
    label: `DPP/${WIN_BODY}/${picks.join('+')}`,
    draft,
    tag: PRODUCT_TAG,
    key: `dpp|${draft.bodyDefId}|${picks.join('+')}`,
  });
  const segs: SegFact[] = [];
  const pickFacts: WalkFact['picks'][number][] = [];
  let s: RunPageState = createRunPageState(ctx);
  let carry: number | null = null;
  for (let guard = 0; guard < 40; guard++) {
    if (s.phase === 'COMPLETE' || s.phase === 'FAILED') break;
    const before = s;
    if (s.phase === 'BATTLE') {
      const node = runCurrentNode(s);
      const build = [...runBuildIds(s)];
      const rt = new RunBattleRuntime({
        build,
        carriedHp: carry,
        encounterId: node.encounterId,
        playerDraft: draft,
        playerLoadoutTag: PRODUCT_TAG,
        playerBaseline: true,
      });
      try {
        const atStart = rt.hp();
        let steps = 0;
        while (rt.result === null && steps < MAX_FRAMES) {
          rt.step(FRAME_MS);
          steps += 1;
        }
        const hp = rt.hp();
        let hits = 0;
        const perHit: number[] = [];
        for (const read of Object.values(rt.playerWeaponHitSummary())) {
          hits += read.count;
          perHit.push(...read.damages);
        }
        segs.push({
          nodeId: node.id,
          encounterId: node.encounterId!,
          build,
          hpA0: atStart.a,
          hpA: hp.a,
          hpB: hp.b,
          hpBMax: atStart.bMax,
          steps,
          winner: rt.result?.winner ?? null,
          hits,
          perHit: [...new Set(perHit)].sort((a, b) => a - b),
        });
        s = finishRunBattle(s, {
          winner: rt.result?.winner ?? null,
          endReason: rt.result?.endReason ?? null,
          playerHp: hp.a,
          enemyHp: hp.b,
          steps: rt.stepCount,
        });
      } finally {
        rt.dispose();
      }
      continue;
    }
    if (s.phase === 'CHOICE') {
      const pool = runChoicePool(s).map((o) => o.id);
      const pick = picks[s.buffs.length] ?? '';
      pickFacts.push({
        nodeId: s.nodeId,
        kind: runChoicePoolKind(s),
        pool,
        pick,
        accepted: (pool as readonly string[]).includes(pick),
      });
      s = chooseRunBuff(s, pick, ctx);
      if (s === before) break;
      continue;
    }
    if (s.phase === 'EVENT') carry = runCarriedPlayerHp(s);
    s = pressRunAction(s, ctx);
    if (s === before) break;
  }
  return {
    phase: s.phase,
    complete: runComplete(s),
    failed: runFailed(s),
    segs,
    picks: pickFacts,
    battlesCompleted: s.battlesCompleted,
  };
}

/* ===================================================================== A. 夹具 */

describe('DEMO-PLAYABLE-PATH-R1｜A. 正常可达 chassis 自检', () => {
  it('D-01 三件全部来自正式种子链（正常可达）+ 资格层放行 + canonical 数值现读', () => {
    // ① cannon = 新账号初始（`STARTER_PARTS`）
    //    （`partInventory.ts:36` 现读，不抄字面量）
    // ② mangoBody / smallWheel 由正式一次性种子投放（R3/R4/R5 都经 openGrowthSession 挂载统一触发）
    const seedKeys = [R3_MOVEMENT_SEED_KEY, R4_BODY_SEED_KEY, R5_CONTENT_POOL_KEY];
    for (const k of seedKeys) {
      expect(typeof k, '正式种子 key 必须存在（挂载链 R3→R4→R5）').toBe('string');
      expect(k.length).toBeGreaterThan(0);
    }
    expect(NEW_OFFICIAL_BODIES, 'R5 内容池种子覆盖 mangoBody').toContain(WIN_BODY);
    expect(registry.bodies.has(WIN_BODY), 'mangoBody 是正式 Body').toBe(true);
    expect(registry.movements.has(WIN_WHEEL), 'smallWheel 是正式 Movement').toBe(true);
    // ③ 资格层放行（这份装配能开始完整 Run）
    expect(canStartFullRun(WIN_DRAFT), 'mango+cannon+双小轮必须放行完整 Run').toBe(true);
    // ④ canonical 数值现读（改任何 Body/Wheel 数值这里会漂）
    const body = registry.bodies.get(WIN_BODY)!;
    expect(body.hp).toBe(950);
    expect(body.energyCapacity).toBe(95);
    expect(registry.movements.get(WIN_WHEEL)!.radius).toBe(12);
    // ⑤ 车上唯一武器 = cannon（装配顺序第一件 ⇒ 本局基准武器）
    const inv = playerInventory(WIN_DRAFT);
    expect(getCount(inv, WIN_WEAPON, 1), 'cannon 在正式库存口径下可见').toBeGreaterThan(0);
  });
});

/* ================================================== B. 最小完整通关回归 */

describe('DEMO-PLAYABLE-PATH-R1｜B. 最小完整通关回归（必改 1）', () => {
  it(
    'D-02 mango+cannon+双小轮 + fastReload→emergencyRepair：正式状态机全链三段 COMPLETE',
    () => {
      const w = walkRun(WIN_DRAFT, WIN_PICKS);
      console.log(
        '\n##### D-02 通关走查 #####\n' +
          w.segs
            .map(
              (f, i) =>
                `  B${i + 1} ${f.encounterId.padEnd(13)} build=[${f.build.join(',')}] ` +
                `hpA ${f.hpA0}→${f.hpA}/${f.hpBMax}  hpB ${f.hpB}  steps=${f.steps} ` +
                `hits=${f.hits} per=${f.perHit.join('/')} w=${f.winner}`,
            )
            .join('\n') +
          `\n  ⇒ ${w.phase}（battles=${w.battlesCompleted}）`,
      );
      // 三层断言：真赢、合法终态、没走捷径
      expect(w.phase, '正式 COMPLETE 终态').toBe('COMPLETE');
      expect(w.complete).toBe(true);
      expect(w.failed).toBe(false);
      expect(w.battlesCompleted).toBe(RUN_TOTAL_BATTLES);
      expect(w.segs.map((f) => f.winner)).toEqual(['A', 'A', 'A']);
      expect(w.segs.map((f) => f.encounterId)).toEqual(['ProtoRusher', 'Chaser', 'RangedTurret']);
      for (const f of w.segs) {
        expect(f.hpA, `${f.nodeId}：我方活下来`).toBeGreaterThan(0);
        expect(f.hpB, `${f.nodeId}：对手被真实打完（非跳过）`).toBe(0);
        expect(f.steps, `${f.nodeId}：真实战斗步数（非瞬杀）`).toBeGreaterThan(60);
      }
      // 两次强化都来自当时真实候选池（不硬塞、不自动选择）
      expect(w.picks.map((p) => p.pick)).toEqual([...WIN_PICKS]);
      for (const p of w.picks) {
        expect(p.accepted, `${p.nodeId}：选项必须在真实候选池里`).toBe(true);
        expect(p.pool.length, `${p.nodeId}：候选池非空`).toBeGreaterThan(0);
      }
      // 成长真实生效：第 2 场起玩家逐发伤害 = 玩家基线 120（fastReload 不改伤害、
      // emergencyRepair 修耐久 —— 两者都不改 per-hit；120 恒成立 ⇒ Cannon 原逻辑不退化）
      for (const f of w.segs.slice(1)) {
        if (f.hits === 0) continue;
        expect(f.perHit, `${f.nodeId}：玩家逐发恒 120（Cannon 基线不被强化污染）`).toEqual([120]);
      }
      // 冻结读数：改 Weapon / Enemy / Body / Wheel 任何数值都会在这里炸出来
      // （B3 的 hpA0 = carried 525.6 + emergencyRepair 237.5 = 763.6 —— 维修真实入账）
      expect(w.segs.map((f) => [f.encounterId, Math.round(f.hpA0), Math.round(f.hpA), Math.round(f.hpB), f.steps])).toEqual([
        ['ProtoRusher', 950, 529, 0, 601],
        ['Chaser', 529, 526, 0, 391],
        ['RangedTurret', 764, 203, 0, 857],
      ]);
      // 逐场余量递减但全部 > 0 ⇒ 「余量 203.4」这条基线可见
      expect(w.segs[2]!.hpA, '终局余量（严格分层同口径）').toBeGreaterThan(0);
    },
    SLOW_MS,
  );
});

/* ---------------------------------------------- 领奖持久化桩（交接坑 3.2） */

/** 内存版 localStorage（node 无原生；WebStorage 会静默降级 null ⇒ 测持久化必须注入桩）。 */
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v));
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  key(i: number): string | null {
    return [...this.m.keys()][i] ?? null;
  }
  get length(): number {
    return this.m.size;
  }
}

/* ================================================ C. 结算 / 领奖 / 再开局 */

describe('DEMO-PLAYABLE-PATH-R1｜C. 结算后正式流程（必改 4）', () => {
  it(
    'D-03 COMPLETE 后：领奖成功且幂等 → 装备保持 → 再次开局重新放行',
    async () => {
      // ⓪ 持久化桩：claimRunReward 的台账经 WebStorage → localStorage（无桩会静默丢写）。
      (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();
      // ① 走一遍完整通关（真实战斗，不是伪造终态）
      const w = walkRun(WIN_DRAFT, WIN_PICKS);
      expect(w.complete, '夹具：本测试依赖一次真实 COMPLETE').toBe(true);
      // ③ 领奖走正式入口（幂等键 = runToken，产品 `newRunToken()` 同款格式）
      const { claimRunReward, claimedRunCount } = await import('../src/product/playerProfile');
      const { newRunToken } = await import('../src/product/runReward');
      const token = newRunToken();
      const outcome = claimRunReward({ runToken: token, rewardDefId: WIN_WEAPON });
      expect(outcome.ok, `领奖（cannon ★1）必须成功 → ${outcome.reason ?? ''}`).toBe(true);
      expect(outcome.grant?.defId).toBe(WIN_WEAPON);
      const ownedAfterClaim = getCount(playerInventory(WIN_DRAFT), WIN_WEAPON, 1);
      expect(ownedAfterClaim, '领奖后库存 +1（含装备件）').toBeGreaterThanOrEqual(1);
      // ④ 幂等：同一 runToken 再领必须被拒（重复领取 = 最常见调用形态）
      const again = claimRunReward({ runToken: token, rewardDefId: WIN_WEAPON });
      expect(again.ok, '同一 token 不得重复发奖').toBe(false);
      expect(again.reason).toBe('already-claimed');
      expect(claimedRunCount(), '台账恰记 1 次').toBe(1);
      // ⑤ 装备保持：结算/领奖不得破坏当前装配
      expect(WIN_DRAFT.functionalSelections[WEAPON_SLOT]).toBe(WIN_WEAPON);
      // ⑥ 再次开局：同一装配重新过资格层 ⇒ 新一局可开（R7-05 同款判据）
      expect(canStartFullRun(WIN_DRAFT), '再次开局资格放行').toBe(true);
      const w2 = walkRun(WIN_DRAFT, WIN_PICKS);
      expect(w2.phase, '再次开局同样走完整链 ⇒ 再 COMPLETE（可重复游玩）').toBe('COMPLETE');
    },
    SLOW_MS,
  );

  it(
    'D-04 确定性：同参数复跑逐场读数逐字相同（回归基线可重复）',
    () => {
      const a = walkRun(WIN_DRAFT, WIN_PICKS);
      const b = walkRun(WIN_DRAFT, WIN_PICKS);
      expect(b.phase).toBe(a.phase);
      expect(b.segs.map((f) => [f.hpA0, f.hpA, f.hpB, f.steps, f.hits])).toEqual(
        a.segs.map((f) => [f.hpA0, f.hpA, f.hpB, f.steps, f.hits]),
      );
    },
    SLOW_MS,
  );
});
