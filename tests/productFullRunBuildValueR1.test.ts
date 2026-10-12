/**
 * DEMO-FULL-RUN-BUILD-VALUE-R1｜**4 Build × 3 路线完整链矩阵**（三战连锁 + 跨场 HP +
 * 两次真实强化的全探索）。
 *
 * ── 本 Queue 回答的问题 ─────────────────────────────────────────────────────
 *
 *   DEMO-BUILD-COUNTER-R1（单场 4×3）证明换装有差异；DEMO-RUN-VARIANTS-R1 证明
 *   heavy/rush 两条路线**炮车**可通关。但「单场胜利」≠「整局可通关」——本文件把
 *   4 个合法 Build × 3 条路线放到**正式状态机全链**（三战连锁 / 跨场 HP / 两次真实
 *   强化）下，回答：
 *
 *     ① 不同初始装配能否改变「可通关路线」的集合？
 *     ② 是否存在**稳定通吃**的初始配置（3×3 全 COMPLETE）？
 *     ③ 哪条路线真正有「更换局外配置」的收益？
 *
 * ── 方法（必改 1~3）─────────────────────────────────────────────────────────
 *
 *   - 4 个 Build 全部走**真实装配链**（空存档 → openGrowthSession → equipBody /
 *     equipWeapon / equipMovement×2），Energy / 挂点 / 库存现读断言——零 Debug 注入；
 *   - 3 条路线 = 默认 RUN_SCRIPT + heavy/rush 覆盖表（上轮已验证）；
 *   - **强化序全探索**：Cannon 局池 = layer1 3 项 × layer2 条件池 3 项（现读
 *     RUN_LAYER1_POOL / RUN_LAYER2_POOLS）⇒ 每格至多 9 条合法序，全部真跑，
 *     记录「最好尝试」（COMPLETE 中终局 HP 最高者；全败时记录最深的失败位置）；
 *   - 同条件复跑核对确定性（BC/RV 两轮已证确定性，本文件对 COMPLETE 路线复核）。
 *
 * ── 判定纪律（必改 3 / 停止条件）──────────────────────────────────────────
 *   - 「稳定通吃」= 某 Build 在 3 条路线全 COMPLETE；
 *   - 结论只写给真实出现的形态；无差异时如实判定「换装不成立」。
 */
import { describe, expect, it } from 'vitest';

import { registry } from '../src/core/content';
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
import {
  RUN_LAYER1_POOL,
  RUN_LAYER2_POOLS,
  type Layer1ModifierId,
} from '../src/lab/portraitBattleLab/runModifiers';
import type { RunRouteId } from '../src/lab/portraitBattleLab/runScript';
import {
  defaultPlayerDraft,
  equipBody,
  equipMovement,
  equipWeapon,
  playerInventory,
} from '../src/product/playerLoadout';
import { openGrowthSession, isFreshProfile } from '../src/product/playerGrowth';
import { getCount as coreGetCount } from '../src/core/partInventory';
import { canEquipBody } from '../src/core/bodyOwnership';

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
const SLOW_MS = 600_000;

const ROUTES: readonly (RunRouteId | undefined)[] = [undefined, 'heavy', 'rush'];
const ROUTE_NAME: Record<string, string> = { heavy: 'heavy', rush: 'rush', undefined: 'default' };

/** 4 个 Build（Queue 必改 1 点名；真实装配链产出）。 */
const BUILDS = [
  { id: 'A-mango-cannon', body: 'mangoBody', weapon: 'cannon', wheel: 'smallWheel', energy: 40, cap: 95 },
  { id: 'B-durian-hammer', body: 'durianBody', weapon: 'hammer', wheel: 'heavyWheel', energy: 55, cap: 105 },
  { id: 'C-coconut-cannon', body: 'coconutBody', weapon: 'cannon', wheel: 'heavyWheel', energy: 60, cap: 100 },
  { id: 'D-durian-shotgun', body: 'durianBody', weapon: 'shotgun', wheel: 'smallWheel', energy: 40, cap: 105 },
] as const;

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
  readonly encounterId: string;
  readonly build: readonly string[];
  readonly hpA0: number;
  readonly hpA: number;
  readonly steps: number;
  readonly winner: string | null;
}

interface WalkFact {
  readonly phase: string;
  readonly complete: boolean;
  readonly segs: readonly SegFact[];
  readonly picks: readonly string[];
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
      label: `BV/${route ?? 'default'}`,
      draft,
      tag: 'profile-equipped',
      key: `bv|${route ?? 'default'}`,
    },
    route,
  );
  const segs: SegFact[] = [];
  const usedPicks: string[] = [];
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
        playerLoadoutTag: 'profile-equipped',
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
          encounterId: node.encounterId!,
          build,
          hpA0: atStart.a,
          hpA: hp.a,
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
      expect(
        (pool as readonly string[]).includes(pick),
        `夹具：${pick} 必须来自真实候选池 [${pool.join(',')}]`,
      ).toBe(true);
      usedPicks.push(pick);
      s = chooseRunBuff(s, pick, ctx);
      if (s === before) break;
      continue;
    }
    if (s.phase === 'EVENT') carry = runCarriedPlayerHp(s);
    s = pressRunAction(s, ctx);
    if (s === before) break;
  }
  return { phase: s.phase, complete: runComplete(s), segs, picks: usedPicks };
}

/** Cannon 局的**全部合法强化序**（layer1 × 对应 layer2 池，现读真源）。 */
function cannonPickOrders(): readonly (readonly string[])[] {
  const out: (readonly string[])[] = [];
  for (const l1 of RUN_LAYER1_POOL as readonly Layer1ModifierId[]) {
    for (const l2 of RUN_LAYER2_POOLS[l1]) {
      out.push([l1, l2]);
    }
  }
  return out;
}

/**
 * 非 Cannon 局（通用基础成长池，R7）的**全部合法强化序**：
 * 池 = damageUp / rateUp / emergencyRepair（恒 3 项，逐节点剔除已拥有）⇒ 3×2 = 6 条。
 */
function genericPickOrders(): readonly (readonly string[])[] {
  const pool = ['damageUp', 'rateUp', 'emergencyRepair'];
  const out: (readonly string[])[] = [];
  for (const p1 of pool) {
    for (const p2 of pool) {
      if (p2 !== p1) out.push([p1, p2]);
    }
  }
  return out;
}

interface BestAttempt {
  readonly complete: boolean;
  readonly picks: readonly string[];
  /** COMPLETE = 终局 HP；全败 = 打到第几场（越大越好）。 */
  readonly score: number;
  readonly segs: readonly SegFact[];
  readonly phase: string;
}

function better(a: BestAttempt, b: BestAttempt): BestAttempt {
  if (a.complete !== b.complete) return a.complete ? a : b;
  if (a.complete) return a.score >= b.score ? a : b;
  return a.score >= b.score ? a : b;
}

/** 探索一个格子的全部合法强化序，返回最好尝试。 */
function exploreCell(
  route: RunRouteId | undefined,
  draft: BuildDraft,
  orders: readonly (readonly string[])[],
): BestAttempt {
  let best: BestAttempt | null = null;
  for (const picks of orders) {
    const w = walkRoute(route, draft, picks);
    const last = w.segs[w.segs.length - 1];
    const attempt: BestAttempt = {
      complete: w.complete,
      picks,
      score: w.complete ? Math.round(last!.hpA) : w.segs.length,
      segs: w.segs,
      phase: w.phase,
    };
    best = best === null ? attempt : better(best, attempt);
  }
  return best!;
}

/* ==================================================================== 测试 */

describe('DEMO-FULL-RUN-BUILD-VALUE-R1｜先查：装配合法性（必改 1）', () => {
  it(
    'FV-01 四个 Build 真实装配 + Energy/挂点/库存现读 + 资格放行',
    () => {
      for (const spec of BUILDS) {
        const draft = assembleRealAccount(spec);
        expect(draft.bodyDefId).toBe(spec.body);
        expect(draft.functionalSelections['frontMass']).toBe(spec.weapon);
        expect(draft.frontWheelDefId).toBe(spec.wheel);
        expect(draft.rearWheelDefId).toBe(spec.wheel);
        // Energy 现读 = 预估（挂点合法性的间接证据：validateSnapshot 在写入口内已过）
        const used =
          [...Object.values(draft.functionalSelections)]
            .filter((id) => id && id !== 'none' && registry.functionals.has(id))
            .reduce((a, id) => a + (registry.functionals.get(id!)?.energy ?? 0), 0) +
          (registry.movements.get(spec.wheel)?.energy ?? 0) * 2;
        expect(used).toBe(spec.energy);
        expect(used).toBeLessThanOrEqual(spec.cap);
        // 库存与拥有证据（种子链发放）
        (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();
        const session = openGrowthSession(defaultPlayerDraft());
        expect(canEquipBody(spec.body), `${spec.body} 由 R4+R5 种子解锁`).toBe(true);
        expect(coreGetCount(playerInventory(session.draft), spec.weapon, 1)).toBeGreaterThan(0);
        expect(coreGetCount(playerInventory(session.draft), spec.wheel, 1)).toBeGreaterThan(0);
      }
    },
    SLOW_MS,
  );
});

describe('DEMO-FULL-RUN-BUILD-VALUE-R1｜4×3 完整链矩阵（全强化序探索）', () => {
  it(
    'FV-02 全矩阵：每格探索全部合法强化序，输出最好尝试诊断表 + 判定',
    () => {
      // 池族按 Build 现读：A/C = cannon 局（Cannon 三池 9 条序）；
      // B/D = 非 cannon 局（R7 通用基础成长池 6 条序）。
      const cannonOrders = cannonPickOrders();
      const genericOrders = genericPickOrders();
      expect(cannonOrders.length).toBe(9);
      expect(genericOrders.length).toBe(6);

      const table: Record<string, Record<string, BestAttempt>> = {};
      const lines: string[] = [];
      for (const spec of BUILDS) {
        const draft = assembleRealAccount(spec);
        const isCannonFamily = spec.weapon === 'cannon';
        const orders = isCannonFamily ? cannonOrders : genericOrders;
        table[spec.id] = {};
        for (const route of ROUTES) {
          const name = ROUTE_NAME[String(route)];
          const best = exploreCell(route, draft, orders);
          table[spec.id]![name] = best;
          lines.push(
            `${spec.id.padEnd(18)} × ${name.padEnd(7)} ⇒ ${best.complete ? 'COMPLETE' : `FAILED@${best.segs.length}`} ` +
              `picks=[${best.picks.join(',')}] ` +
              (best.complete
                ? `finalHP=${best.score} (${best.segs.map((f) => Math.round(f.hpA)).join('→')})`
                : `lastEnc=${best.segs[best.segs.length - 1]?.encounterId ?? '—'}`),
          );
        }
      }
      console.log(`\n##### FV-02 4×3 完整链矩阵（每格 = 该池族全部合法强化序的最好尝试）#####\n  ${lines.join('\n  ')}`);

      // ① 每格都有合法终态（不存在挂死）
      for (const spec of BUILDS) {
        for (const route of ROUTES) {
          const best = table[spec.id]![ROUTE_NAME[String(route)]]!;
          expect(best.segs.length, `${spec.id}×${ROUTE_NAME[String(route)]}: 必须真实推进`).toBeGreaterThan(0);
          for (const f of best.segs) expect(f.winner, `${spec.id}: 战斗必须到终态`).not.toBeNull();
        }
      }

      // ── 判定（必改 3）─────────────────────────────────────────────────────
      const wins: Record<string, string[]> = {};
      for (const spec of BUILDS) {
        wins[spec.id] = ROUTES.filter((r) => table[spec.id]![ROUTE_NAME[String(r)]]!.complete).map(
          (r) => ROUTE_NAME[String(r)],
        );
      }
      console.log(`\n##### FV-02 判定 #####`);
      for (const spec of BUILDS) {
        console.log(`  ${spec.id}: 可通关路线 = [${wins[spec.id]!.join(', ') || '（无）'}]`);
      }
      const sweep = BUILDS.filter((s) => wins[s.id]!.length === 3);
      console.log(
        sweep.length === 0
          ? '  稳定通吃：无（没有任何 Build 三路线全 COMPLETE）'
          : `  ⚠️ 稳定通吃：${sweep.map((s) => s.id).join(', ')}（三路线全 COMPLETE ⇒ 停止条件触发）`,
      );

      // ② 断言层：判定结论冻结（读数来自真实矩阵，此处钉死防漂移）
      //    ⚠️ 池族差异是本轮新证据：B/D 走 R7 通用池（damageUp/rateUp/repair），
      //    A/C 走 Cannon 三池 —— 换装不仅改变战局，还改变**强化内容本身**。
      //    真实矩阵读数（FV-02 全探索）：
      //      A：三路线全 COMPLETE ⇒ **稳定通吃**（mango+cannon+双smallWheel）；
      //      B：三路线全败（@1）—— 近战重锤在连锁中被单场证据预言；
      //      C：三路线全败（默认/rush @3 终局、heavy @1）；
      //      D：仅 rush COMPLETE（[emergencyRepair,rateUp]，104 余量）。
      expect(wins['A-mango-cannon']).toEqual(['default', 'heavy', 'rush']);
      expect(wins['B-durian-hammer']).toEqual([]);
      expect(wins['C-coconut-cannon']).toEqual([]);
      expect(wins['D-durian-shotgun']).toEqual(['rush']);
      // 冠军强化序冻结（换路线改变最优选择 ⇒ 没有单一万金油强化）
      expect(table['A-mango-cannon']!['default']!.picks).toEqual(['fastReload', 'emergencyRepair']);
      expect(table['A-mango-cannon']!['heavy']!.picks).toEqual(['fastReload', 'twinCannon']);
      expect(table['A-mango-cannon']!['rush']!.picks).toEqual(['twinCannon', 'emergencyRepair']);
      expect(table['D-durian-shotgun']!['rush']!.picks).toEqual(['emergencyRepair', 'rateUp']);
    },
    SLOW_MS,
  );

  it(
    'FV-03 确定性：A 的三条 COMPLETE 路线复跑逐字相同（必改 3）',
    () => {
      const draft = assembleRealAccount(BUILDS[0]!);
      // FV-02 冠军序（现读）：default/heavy = fastReload→emergencyRepair(or twinCannon)；
      // rush 冠军 = twinCannon→emergencyRepair（fastReload 序在 rush 链不 COMPLETE）。
      const champion: Record<string, readonly string[]> = {
        default: ['fastReload', 'emergencyRepair'],
        heavy: ['fastReload', 'twinCannon'],
        rush: ['twinCannon', 'emergencyRepair'],
      };
      for (const route of ROUTES) {
        const picks = champion[ROUTE_NAME[String(route)]]!;
        const a = walkRoute(route, draft, picks);
        const b = walkRoute(route, draft, picks);
        expect(b, `route=${ROUTE_NAME[String(route)]}: 复跑逐字相同`).toEqual(a);
        expect(a.complete, `${ROUTE_NAME[String(route)]}: 冠军序必须可复现 COMPLETE`).toBe(true);
      }
    },
    SLOW_MS,
  );
});
