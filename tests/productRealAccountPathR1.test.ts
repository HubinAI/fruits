/**
 * DEMO-REAL-ACCOUNT-PATH-R1｜**真实新账号端到端通关闭环**（零注入、零 Debug、零绕过）。
 *
 * ── 本 Queue 回答的一个问题 ─────────────────────────────────────────────────
 *
 *   `productDemoPlayablePathR1` 钉的通关基线（mangoBody + cannon + smallWheel 前后各一）
 *   用的是**直接构造的 BuildDraft** —— 尚未证明**真实新账号**能合法装配出它：
 *   R3 Movement 种子每档只发 **×1**，而基线前后轮**都要** smallWheel。
 *
 *   本文件从**真空存档**出发，只走正式链路，端到端跑完整个闭环：
 *
 *     空存档 → `openGrowthSession()`（正式初始化，R2→R3→R4→R5 按序）
 *       → 读真实库存 → 正式写入口装配（`equipBody` / `equipMovement`）
 *       → `validateSnapshot` + Energy 闸门 → `canStartFullRun`
 *       → 正式状态机三段 COMPLETE → `claimRunReward` 领奖（幂等）
 *       → 装备保持 → 再次开局重新放行
 *
 * ── 先查结论（Phase 1 实测，2026-10-12，本文件的前身是临时探针）────────────────
 *
 *   Queue 疑点「种子只发 ×1、不够装前后双轮」被**实测否定**：
 *
 *   - R3 种子确实每档只补到 `R3_MOVEMENT_SEED_MIN_COUNT = 1`（`r3MovementChoiceSeed.ts:108`）；
 *   - 但装配资格按**「拥有（count > 0）」**判，**不按副本数**：
 *     `canEquipMovement`（`partInventory.ts:242-246`）与正式写入口 `equipMovement`
 *     （`playerLoadout.ts:1170`）都只查 `getCount(...) > 0`；
 *   - 「同一件装在两处」是正式能力：`movementInventory.ts:81` 明文
 *     「同一件装在两处会得到两个挂点」；
 *   - ⇒ **同一件 smallWheel ×1 同时装 front + rear 合法**。空存档实测：
 *     cannon ×4（fresh）/ small·large·heavy 各 ×1（R3）/ mangoBody 解锁（R4+R5）；
 *     `equipBody` ✅ → `equipMovement(front, smallWheel)` ✅ → `equipMovement(rear, smallWheel)` ✅；
 *     Energy = functional 30 + movement 10 = **40 / 95** ✅；`canStartFullRun` ✅。
 *
 *   ⇒ 必改 3（调整种子数量）**不触发**：不存在种子造成的单一阻塞，零产品改动。
 *
 * ── 红线 ──────────────────────────────────────────────────────────────────
 *   不调 Debug 授权；不直接注入库存 / BuildDraft（装配只走 `equipBody` / `equipMovement`
 *   两个唯一写入口）；不放宽任何校验；不碰 Runtime / 数值 / 难度。
 */
import { describe, expect, it } from 'vitest';

import { registry } from '../src/core/content';
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
  runComplete,
  runCurrentNode,
  type RunPageContext,
  type RunPageState,
} from '../src/lab/portraitBattleLab/runPageState';
import { runPageContext } from '../src/lab/portraitBattleLab/runPageScene';
import { canStartFullRun } from '../src/product/runCompatibility';
import {
  WEAPON_SLOT,
  defaultPlayerDraft,
  equipBody,
  equipMovement,
  playerInventory,
} from '../src/product/playerLoadout';
import { getCount } from '../src/core/partInventory';
import { canEquipBody } from '../src/core/bodyOwnership';
import { canEquipMovement } from '../src/core/partInventory';
import { validateSnapshot } from '../src/core/buildValidator';
import { buildSnapshotFromDraft } from '../src/lab/buildEditorModel';
import { openGrowthSession, isFreshProfile } from '../src/product/playerGrowth';
import { claimRunReward } from '../src/product/playerProfile';
import { newRunToken } from '../src/product/runReward';
import type { BuildDraft } from '../src/lab/buildEditorModel';

/* ------------------------------------------------------- 持久化桩（交接坑 3.2） */

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

/* --------------------------------------------------------------- 夹具常量 */

const FRAME_MS = 1000 / 60;
const MAX_FRAMES = 4000;
const PRODUCT_TAG = 'profile-equipped';
const SLOW_MS = 300_000;

const WIN_BODY = 'mangoBody';
const WIN_WEAPON = 'cannon';
const WIN_WHEEL = 'smallWheel';
/** 通关 Build（productDemoPlayablePathR1 钉死的路线）。 */
const WIN_PICKS: readonly string[] = ['fastReload', 'emergencyRepair'];

/* --------------------------------------------------- 状态机全链走查（同前） */

interface SegFact {
  readonly nodeId: string;
  readonly encounterId: string;
  readonly build: readonly string[];
  readonly hpA: number;
  readonly hpB: number;
  readonly steps: number;
  readonly winner: string | null;
  readonly perHit: readonly number[];
}

function walkRun(draft: BuildDraft, picks: readonly string[]): {
  phase: string;
  complete: boolean;
  segs: SegFact[];
  picks: { nodeId: string; pool: readonly string[]; pick: string; accepted: boolean }[];
} {
  const ctx: RunPageContext = runPageContext({
    source: 'profile',
    label: `RAP/${draft.bodyDefId}/${picks.join('+')}`,
    draft,
    tag: PRODUCT_TAG,
    key: `rap|${draft.bodyDefId}|${picks.join('+')}`,
  });
  const segs: SegFact[] = [];
  const pickFacts: { nodeId: string; pool: readonly string[]; pick: string; accepted: boolean }[] = [];
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
        let steps = 0;
        while (rt.result === null && steps < MAX_FRAMES) {
          rt.step(FRAME_MS);
          steps += 1;
        }
        const hp = rt.hp();
        const perHit: number[] = [];
        for (const read of Object.values(rt.playerWeaponHitSummary())) perHit.push(...read.damages);
        segs.push({
          nodeId: node.id,
          encounterId: node.encounterId!,
          build,
          hpA: hp.a,
          hpB: hp.b,
          steps,
          winner: rt.result?.winner ?? null,
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
  return { phase: s.phase, complete: runComplete(s), segs, picks: pickFacts };
}

/* ================================================================== 主测试 */

describe('DEMO-REAL-ACCOUNT-PATH-R1｜真实新账号端到端闭环（零注入）', () => {
  it(
    'RA-01 空存档 → 正式初始化 → 正式装配 → 校验 → 三段 COMPLETE → 领奖 → 再开局',
    () => {
      // ── ⓪ 真空存档（真实新账号的定义；持久化桩只为让 WebStorage 有处可写）──────
      (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();
      expect(isFreshProfile(), '前置：这是一台没有任何存档的新账号').toBe(true);

      // ── ① 正式新账号初始化（真实挂载链，R2→R3→R4→R5 按序；必改 1）────────────
      const draft0 = defaultPlayerDraft();
      const session = openGrowthSession(draft0);
      // 初始化真实发放读数（全部来自正式种子，非测试注入）：
      const inv = playerInventory(session.draft);
      expect(getCount(inv, 'cannon', 1), 'fresh seed：cannon ×4').toBe(4);
      expect(getCount(inv, WIN_WHEEL, 1), 'R3 种子：smallWheel 补到 ×1（每档保底 1 件）').toBe(1);
      expect(getCount(inv, 'largeWheel', 1), 'R3 种子：largeWheel ×1').toBe(1);
      expect(getCount(inv, 'heavyWheel', 1), 'R3 种子：heavyWheel ×1').toBe(1);
      expect(canEquipBody(WIN_BODY), 'R4+R5 种子：mangoBody 已解锁').toBe(true);
      expect(session.movements.legal, '初始化后 Movement 装备不变式成立').toBe(true);

      // ── ② 正式写入口装配 COMPLETE 组合（不用测试直接构造 BuildDraft）──────────
      //    拥有判据 = count > 0（不按副本数）⇒ 同一件 smallWheel ×1 装前后两轮合法
      //    （canEquipMovement / equipMovement / movementInventory.ts:81 三处同源）。
      expect(canEquipMovement(WIN_WHEEL), '装配资格：count > 0 即可（×1 足够装两处）').toBe(true);
      const b = equipBody(WIN_BODY, session.draft);
      expect(b.ok, `equipBody(mangoBody) 必须成功：${b.detail ?? ''}`).toBe(true);
      const d1 = b.draft!;
      const wf = equipMovement('front', WIN_WHEEL, d1);
      expect(wf.ok, `equipMovement(front, smallWheel) 必须成功：${wf.detail ?? ''}`).toBe(true);
      const d2 = wf.draft!;
      const wr = equipMovement('rear', WIN_WHEEL, d2);
      expect(wr.ok, `equipMovement(rear, smallWheel) 必须成功：${wr.detail ?? ''}`).toBe(true);
      const winDraft = wr.draft!;

      // 装配后不变式：装备合法 + 唯一武器 + 零注入证据（draft 来自正式写入口）
      expect(winDraft.functionalSelections[WEAPON_SLOT]).toBe(WIN_WEAPON);
      expect(winDraft.bodyDefId).toBe(WIN_BODY);
      expect(winDraft.frontWheelDefId).toBe(WIN_WHEEL);
      expect(winDraft.rearWheelDefId).toBe(WIN_WHEEL);

      // ── ③ 正式校验：Snapshot / Energy 闸门 / Run 资格（必改 2；显式复核在 RA-02）──
      expect(canStartFullRun(winDraft), '装配结果必须放行完整 Run').toBe(true);

      // ── ④ 正式三段 Run：COMPLETE（真实战斗，真实候选池选择）───────────────────
      const w = walkRun(winDraft, WIN_PICKS);
      console.log(
        '\n##### RA-01 通关走查（真实账号装配） #####\n' +
          w.segs
            .map(
              (f, i) =>
                `  B${i + 1} ${f.encounterId.padEnd(13)} build=[${f.build.join(',')}] ` +
                `hpA=${Math.round(f.hpA)} hpB=${Math.round(f.hpB)} steps=${f.steps} per=${f.perHit.join('/')}`,
            )
            .join('\n'),
      );
      expect(w.phase, '正式 COMPLETE 终态').toBe('COMPLETE');
      expect(w.segs.map((f) => f.winner)).toEqual(['A', 'A', 'A']);
      expect(w.segs.length).toBe(RUN_TOTAL_BATTLES);
      for (const f of w.segs) {
        expect(f.hpA, `${f.nodeId}：我方活下来`).toBeGreaterThan(0);
        expect(f.hpB, `${f.nodeId}：对手被真实打完`).toBe(0);
      }
      for (const p of w.picks) {
        expect(p.accepted, `${p.nodeId}：选项来自真实候选池`).toBe(true);
      }

      // ── ⑤ 领奖（幂等）→ 装备保持 → 再次开局（必改 4）─────────────────────────
      const token = newRunToken();
      const claim = claimRunReward({ runToken: token, rewardDefId: WIN_WEAPON });
      expect(claim.ok, `领奖成功：${claim.reason ?? ''}`).toBe(true);
      expect(claim.grant?.defId).toBe(WIN_WEAPON);
      const again = claimRunReward({ runToken: token, rewardDefId: WIN_WEAPON });
      expect(again.ok, '同 runToken 幂等拒绝').toBe(false);
      expect(again.reason).toBe('already-claimed');
      // 装备保持：装配仍指向通关组合（领奖流程不吃掉装备）
      expect(winDraft.functionalSelections[WEAPON_SLOT]).toBe(WIN_WEAPON);
      expect(getCount(playerInventory(winDraft), WIN_WEAPON, 1)).toBeGreaterThanOrEqual(1);
      // 再次开局：资格重新放行 + 再走一遍全链再 COMPLETE（可重复游玩）
      expect(canStartFullRun(winDraft), '再次开局资格放行').toBe(true);
      const w2 = walkRun(winDraft, WIN_PICKS);
      expect(w2.phase, '再次开局同样 COMPLETE（可重复闭环）').toBe('COMPLETE');
    },
    SLOW_MS,
  );

  it(
    'RA-02 显式复核：装配结果的 validateSnapshot / Energy（40/95）合规（必改 2）',
    () => {
      (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();
      const session = openGrowthSession(defaultPlayerDraft());
      const b = equipBody(WIN_BODY, session.draft);
      expect(b.ok).toBe(true);
      const wf = equipMovement('front', WIN_WHEEL, b.draft!);
      expect(wf.ok).toBe(true);
      const wr = equipMovement('rear', WIN_WHEEL, wf.draft!);
      expect(wr.ok).toBe(true);

      // core 唯一校验闸门显式复核（equipBody / equipMovement 内部已各过一次；这里拿读数）
      const snap = buildSnapshotFromDraft(wr.draft!, registry);
      const v = validateSnapshot(snap, registry);
      expect(v.valid, `正式校验必须通过：${'errors' in v ? v.errors.join(';') : ''}`).toBe(true);
      // Energy 读数：functional（cannon 30）+ movement（smallWheel 5 ×2 = 10）= 40 ≤ 95
      const functionalEnergy = snap.functionals.reduce(
        (a, f) => a + (registry.functionals.get(f.defId)?.energy ?? 0),
        0,
      );
      const movementEnergy = snap.movements.reduce(
        (a, m) => a + (registry.movements.get(m.defId)?.energy ?? 0),
        0,
      );
      const capacity = registry.bodies.get(WIN_BODY)!.energyCapacity;
      console.log(
        `\n##### RA-02 Energy #####\n  functional=${functionalEnergy} movement=${movementEnergy} ` +
          `total=${functionalEnergy + movementEnergy} / capacity=${capacity}`,
      );
      expect(functionalEnergy).toBe(30);
      expect(movementEnergy).toBe(10);
      expect(functionalEnergy + movementEnergy).toBeLessThanOrEqual(capacity);
    },
    SLOW_MS,
  );

  it(
    'RA-03 确定性：同一真实账号链复跑，装配与通关读数逐字相同',
    () => {
      const run = (): { equipOk: boolean; phase: string; hpA: number[] } => {
        (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();
        const session = openGrowthSession(defaultPlayerDraft());
        const b = equipBody(WIN_BODY, session.draft);
        const wf = b.ok ? equipMovement('front', WIN_WHEEL, b.draft!) : { ok: false as const };
        const wr = wf.ok ? equipMovement('rear', WIN_WHEEL, wf.draft) : { ok: false as const };
        if (!wr.ok) return { equipOk: false, phase: 'EQUIP-FAIL', hpA: [] };
        const w = walkRun(wr.draft!, WIN_PICKS);
        return { equipOk: true, phase: w.phase, hpA: w.segs.map((f) => Math.round(f.hpA)) };
      };
      const a = run();
      const b2 = run();
      expect(a.equipOk).toBe(true);
      expect(b2).toEqual(a);
      expect(a.phase).toBe('COMPLETE');
    },
    SLOW_MS,
  );
});
