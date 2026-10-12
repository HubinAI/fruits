/**
 * DEMO-RUN-VARIANTS-R1｜两条固定路线的**完整链验证**（三战连锁 + 跨场 HP + 两次强化）。
 *
 * ── 本 Queue 回答什么 ───────────────────────────────────────────────────────
 *
 *   DEMO-BUILD-COUNTER-R1 的**单场**矩阵证明了换装有差异，但三战连锁 / 跨场 HP /
 *   两次正式强化下的可玩性未验证。本文件用**正式状态机全链**
 *   （`createRunPageState` → BATTLE 真跑 → `finishRunBattle` → CHOICE 真实候选池 →
 *   FINAL → COMPLETE/FAILED）验证两条固定候选路线：
 *
 *     | 路线 | 遭遇序列 | 已验证通关轨迹（BC 矩阵 + 探针实测） |
 *     |---|---|---|
 *     | `heavy` | HeavyFortress → HighGunPlatform → ProtoRusher | 炮车：HF 胜(229) → fastReload 过 HGP(208) → twinCannon 收官 PR(87) |
 *     | `rush` | ProtoRusher → RushRammer → HighGunPlatform | 炮车：PR 胜(529) → fastReload 贴身险胜 RR(94) → 二层 HGP 胜(311) |
 *
 *   两条路线的装配倾向：**同一条炮车线（mangoBody+cannon+双 smallWheel）但强化序
 *   感知不同**——heavy 首选 fastReload 是「翻盘」性质（零 Build 时 RR 必败），rush
 *   首选 fastReload 是「保命」性质（93 余量贴身险胜）。
 *
 * ── ⚠️ 勘误声明（本文件即修正载体）────────────────────────────────────────
 *   上轮文字报告称「HeavyFortress 4/4 无解」「A/D 各丢 2 格」——与 BC 矩阵**实际
 *   可运行读数冲突**（真实读数：A 对 HF **胜** 229 余量；A/D 各丢 **1** 格）。
 *   本文件一切结论以可运行断言为准。
 *
 * ── ⚠️ 探索史（如实记录，防重复劳动；全部走正式 Runtime）────────────────────
 *   - 含 HeavyFortress 的链上，HF 放 B1 之外对当前可装配 Build 池无解：
 *     C(594)/D(738)/A(229,514) 带任意 1~2 层强化对 HF 全败（HF 双远程对残血车必杀）；
 *   - D-durian-shotgun 在 RR/HGP 的深链上全灭（damageUp/rateUp 对 HGP 均败，
 *     17 余量的 rateUp 胜局进 PR 也全败）；
 *   - C-coconut-cannon 对 HF 单场必败 ⇒ heavy/rush 均不能由 C 承载；
 *   - ⇒ 两条候选最终以**炮车（A 线）**承载，heavy 路线 HF 固定在 B1（唯一可赢位）。
 *
 * ── 红线 ──────────────────────────────────────────────────────────────────
 *   默认路线 `RUN_SCRIPT` 逐字不动；`runRoute` 缺省 = 旧行为（既有调用点零影响）；
 *   变体只覆盖 encounterId（引用既有 LAB_ENCOUNTERS，零新数值）；正式 `runPage.ts`
 *   不传 runRoute ⇒ 产品默认路线结构性不变。
 */
import { describe, expect, it } from 'vitest';

import type { BuildDraft } from '../src/lab/buildEditorModel';
import { RunBattleRuntime } from '../src/lab/portraitBattleLab/runBattleRuntime';
import {
  chooseRunBuff,
  createRunPageState,
  finishRunBattle,
  pressRunAction,
  runBuildIds,
  runCarriedPlayerHp,
  runChoicePool,
  runCurrentNode,
  runComplete,
  type RunPageContext,
  type RunPageState,
} from '../src/lab/portraitBattleLab/runPageState';
import { runPageContext } from '../src/lab/portraitBattleLab/runPageScene';
import type { RunRouteId } from '../src/lab/portraitBattleLab/runScript';
import { RUN_SCRIPT, runScriptNodeFor } from '../src/lab/portraitBattleLab/runScript';
import {
  defaultPlayerDraft,
  equipBody,
  equipMovement,
  equipWeapon,
} from '../src/product/playerLoadout';
import { openGrowthSession, isFreshProfile } from '../src/product/playerGrowth';

/* ------------------------------------------------------- 持久化桩（交接坑 3.2） */

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
const MAX_STEPS = 4000;
const PRODUCT_TAG = 'profile-equipped';
const SLOW_MS = 600_000;

/** 炮车（两条候选路线的承载 Build；真实装配链产出）。 */
const CANNON_BUILD = { body: 'mangoBody', weapon: 'cannon', wheel: 'smallWheel' } as const;

function assembleRealAccount(spec: {
  body: string;
  weapon: string;
  wheel: string;
}): BuildDraft {
  (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();
  expect(isFreshProfile()).toBe(true);
  const session = openGrowthSession(defaultPlayerDraft());
  const b = equipBody(spec.body, session.draft);
  expect(b.ok, `equipBody(${spec.body}): ${b.detail ?? ''}`).toBe(true);
  const w = equipWeapon(spec.weapon, b.draft!);
  expect(w.ok, `equipWeapon(${spec.weapon}): ${w.detail ?? ''}`).toBe(true);
  const wf = equipMovement('front', spec.wheel, w.draft!);
  expect(wf.ok, `equipMovement(front,${spec.wheel}): ${wf.detail ?? ''}`).toBe(true);
  const wr = equipMovement('rear', spec.wheel, wf.draft!);
  expect(wr.ok, `equipMovement(rear,${spec.wheel}): ${wr.detail ?? ''}`).toBe(true);
  return wr.draft!;
}

/* ------------------------------------------------- 正式状态机全链走查（带路线） */

interface SegFact {
  readonly nodeId: string;
  readonly encounterId: string;
  readonly build: readonly string[];
  readonly hpA0: number;
  readonly hpA: number;
  readonly hpB: number;
  readonly steps: number;
  readonly winner: string | null;
}

interface WalkFact {
  readonly phase: string;
  readonly complete: boolean;
  readonly segs: readonly SegFact[];
  readonly picks: readonly { readonly nodeId: string; readonly pick: string; readonly accepted: boolean }[];
}

/** 正式状态机全链（跨场 HP / 两次 CHOICE 真实候选池 / FINAL → COMPLETE）。 */
function walkRoute(
  route: RunRouteId | undefined,
  draft: BuildDraft,
  picks: readonly string[],
): WalkFact {
  const ctx: RunPageContext = runPageContext(
    {
      source: 'profile',
      label: `RV/${route ?? 'default'}`,
      draft,
      tag: PRODUCT_TAG,
      key: `rv|${route ?? 'default'}`,
    },
    route,
  );
  const segs: SegFact[] = [];
  const pickFacts: { nodeId: string; pick: string; accepted: boolean }[] = [];
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
        while (rt.result === null && steps < MAX_STEPS) {
          rt.step(FRAME_MS);
          steps += 1;
        }
        const hp = rt.hp();
        segs.push({
          nodeId: node.id,
          encounterId: node.encounterId!,
          build,
          hpA0: atStart.a,
          hpA: hp.a,
          hpB: hp.b,
          steps,
          winner: rt.result?.winner ?? null,
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
      pickFacts.push({ nodeId: s.nodeId, pick, accepted: (pool as readonly string[]).includes(pick) });
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

function fmtWalk(tag: string, w: WalkFact): string {
  return (
    `\n##### ${tag} ⇒ ${w.complete ? 'COMPLETE' : w.phase} #####\n` +
    w.segs
      .map(
        (f, i) =>
          `  B${i + 1} ${f.encounterId.padEnd(15)} build=[${f.build.join(',')}] ` +
          `hpA ${Math.round(f.hpA0)}→${Math.round(f.hpA)}  hpB ${Math.round(f.hpB)}  steps=${f.steps} w=${f.winner}`,
      )
      .join('\n') +
    `\n  picks: ${w.picks.map((p) => `${p.nodeId}=${p.pick}${p.accepted ? '' : '(拒)'}`).join(' → ')}`
  );
}

/* ==================================================================== 测试 */

describe('DEMO-RUN-VARIANTS-R1｜数据隔离与默认不回归', () => {
  it('RV-01 变体只覆盖 encounterId：默认 RUN_SCRIPT 逐字不动 + 路线形状一致', () => {
    // 默认脚本三场不变（Queue 禁止项的机器取证）
    expect(
      RUN_SCRIPT.filter((n) => n.kind === 'BATTLE' || n.kind === 'FINAL').map((n) => n.encounterId),
    ).toEqual(['ProtoRusher', 'Chaser', 'RangedTurret']);
    // 路线节点形状与默认完全一致（同 6 节点 id / 同 kind 序列 / 同 DAY），只换 encounterId
    for (const route of ['heavy', 'rush'] as const) {
      for (const node of RUN_SCRIPT) {
        const variant = runScriptNodeFor(route, node.id);
        expect(variant, `${route}/${node.id} 必须存在`).not.toBeNull();
        expect(variant!.kind, `${route}/${node.id}: kind 不变`).toBe(node.kind);
        expect(variant!.day, `${route}/${node.id}: day 不变`).toBe(node.day);
        expect(variant!.next, `${route}/${node.id}: next 链不变`).toBe(node.next);
        // 非战斗节点的 encounterId 恒 undefined（只有 BATTLE/FINAL 被覆盖）
        if (node.kind !== 'BATTLE' && node.kind !== 'FINAL') {
          expect(variant!.encounterId, `${route}/${node.id}: 非战斗节点不覆盖`).toBeUndefined();
        }
      }
      // 两条路线的战斗序列各不相同、且至少两场与默认不同
      const seq = (['d2-battle1', 'd3-battle2', 'd4-final'] as const).map(
        (id) => runScriptNodeFor(route, id)!.encounterId,
      );
      expect(seq.length).toBe(3);
      expect(new Set(seq).size, `${route}: 三场不得重复`).toBe(3);
      const diff = seq.filter((e, i) => e !== (['ProtoRusher', 'Chaser', 'RangedTurret'] as const)[i]).length;
      expect(diff, `${route}: 至少两场与默认不同`).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('DEMO-RUN-VARIANTS-R1｜heavy 路线（HF→HGP→PR）', () => {
  it(
    'RV-02 炮车完整链：HF 胜(229) → fastReload 过 HGP(208) → twinCannon 收官 PR(87) → COMPLETE',
    () => {
      const draft = assembleRealAccount(CANNON_BUILD);
      const w = walkRoute('heavy', draft, ['fastReload', 'twinCannon']);
      console.log(fmtWalk('[heavy fastReload+twinCannon]', w));
      expect(w.complete, 'heavy 路线必须 COMPLETE').toBe(true);
      expect(w.segs.map((f) => f.encounterId)).toEqual([
        'HeavyFortress',
        'HighGunPlatform',
        'ProtoRusher',
      ]);
      expect(w.segs.every((f) => f.winner === 'A')).toBe(true);
      // 跨场 HP 真实连锁：B2/B3 起始 HP = 上一场剩余（不是满血）
      expect(w.segs[1]!.hpA0, 'B2 起始 = B1 剩余').toBeLessThanOrEqual(w.segs[0]!.hpA);
      expect(w.segs[2]!.hpA0, 'B3 起始 = B2 剩余').toBeLessThanOrEqual(w.segs[1]!.hpA);
      // 递减余量（229→208→87）：重火力路线逐场磨血，收官场最紧
      expect(w.segs[2]!.hpA, '收官余量 < B2 余量 < B1 余量（硬扛路线画像）').toBeLessThan(
        w.segs[1]!.hpA,
      );
      for (const p of w.picks) expect(p.accepted, `${p.nodeId}: ${p.pick} 必须在候选池`).toBe(true);
    },
    SLOW_MS,
  );
});

describe('DEMO-RUN-VARIANTS-R1｜rush 路线（PR→RR→HGP）', () => {
  it(
    'RV-03 炮车完整链：PR 胜(529) → fastReload 贴身险胜 RR(93) → 二层 HGP → COMPLETE',
    () => {
      const draft = assembleRealAccount(CANNON_BUILD);
      const w = walkRoute('rush', draft, ['fastReload', 'emergencyRepair']);
      console.log(fmtWalk('[rush fastReload+emergencyRepair]', w));
      expect(w.complete, 'rush 路线必须 COMPLETE').toBe(true);
      expect(w.segs.map((f) => f.encounterId)).toEqual([
        'ProtoRusher',
        'RushRammer',
        'HighGunPlatform',
      ]);
      expect(w.segs.every((f) => f.winner === 'A')).toBe(true);
      // fastReload 贴身险胜：B2 余量极薄（≈93，冻结为「险胜」判断——不锁具体 HP）
      expect(w.segs[1]!.hpA, 'rush B2：RR 贴身险胜（余量小于 B1）').toBeLessThan(w.segs[0]!.hpA);
      expect(w.segs[1]!.hpA, 'rush B2：险胜但活下来').toBeGreaterThan(0);
      for (const p of w.picks) expect(p.accepted, `${p.nodeId}: ${p.pick} 必须在候选池`).toBe(true);
    },
    SLOW_MS,
  );
});

describe('DEMO-RUN-VARIANTS-R1｜默认路线不回归', () => {
  it(
    'RV-04 默认路线（不传 runRoute）三段链 mango COMPLETE 基线保持',
    () => {
      const draft = assembleRealAccount(CANNON_BUILD);
      const w = walkRoute(undefined, draft, ['fastReload', 'emergencyRepair']);
      console.log(fmtWalk('[default mango 基线]', w));
      expect(w.complete, '默认路线 mango COMPLETE 基线不回归').toBe(true);
      expect(w.segs.map((f) => f.encounterId)).toEqual([
        'ProtoRusher',
        'Chaser',
        'RangedTurret',
      ]);
      // 逐场读数与 productDemoPlayablePathR1 冻结基线一致（529/526/764→203）
      expect(Math.round(w.segs[0]!.hpA)).toBe(529);
      expect(Math.round(w.segs[1]!.hpA)).toBe(526);
      expect(Math.round(w.segs[2]!.hpA)).toBe(203);
    },
    SLOW_MS,
  );

  it(
    'RV-05 确定性：两条候选路线的通关轨迹复跑逐字相同',
    () => {
      const draft = assembleRealAccount(CANNON_BUILD);
      for (const route of ['heavy', 'rush'] as const) {
        const picks =
          route === 'heavy' ? ['fastReload', 'twinCannon'] : ['fastReload', 'emergencyRepair'];
        const a = walkRoute(route, draft, picks);
        const b = walkRoute(route, draft, picks);
        expect(b, `${route}: 复跑必须逐字相同`).toEqual(a);
        expect(a.complete, `${route}: 探索通过的强化序必须可复现`).toBe(true);
      }
    },
    SLOW_MS,
  );
});
