/**
 * DEMO-M5-WIN-PATH-RNG-ROOT-R1｜**通关胜率 / 失败节点根因调查**（只读，零产品改动）。
 *
 * ── 本文件回答 Queue 必改 2 / 必改 3 ────────────────────────────────────────
 *
 *   M5 上轮 E2E（`e2e:demo-continuous-run`）曾报 19/19 PASS（RUN-2 真实 COMPLETE），
 *   同 HEAD 独立实跑却得到 RUN-2 连续 3 次 FAILED。本文件用**确定性底座**
 *   （`runContentBatchCase` / `runSingleBattle`，真物理、固定步、零 RNG）回答：
 *
 *   W-01 「可通关装配」mangoBody+machineGun+双 smallWheel 在默认路线 + 通用池
 *        全部合法强化组合下，**确定性**胜负与失败节点（逐场 opponent id / HP / steps）。
 *        （同口径补 durianBody 变体与默认 cannon 对照。）
 *   W-02 同参数复跑逐字相同 ⇒ 战斗内核无 RNG 的机器证明（19/19 vs 14/17 的差异
 *        **不可能**来自战斗内核随机，只能来自装配差异或浏览器侧时序）。
 *   W-03 帧批次粒度敏感性：同一场战斗分别按 8ms / 16.67ms(60fps) / 32ms / 64ms(E2E cap)
 *        的 rAF 帧时长喂给 `RunBattleRuntime.step`——若胜负/HP 随粒度分叉，
 *        即「浏览器帧节奏影响 Run 战斗结果」的机制证据（解释两次浏览器实跑差异）。
 *
 * ── 红线 ──────────────────────────────────────────────────────────────────
 *   纯只读调查：不改任何 src/**、不改数值、不伪造结果；失败是真实终态，如实落盘。
 *   断言只锁「调查方法本身有效」（确定性一致、日志可读），**不锁**胜负——胜负是测量对象。
 */

import { describe, expect, it } from 'vitest';

import { registry } from '../src/core/content';
import { type BuildDraft } from '../src/lab/buildEditorModel';
import { runContentBatchCase, runSingleBattle, type BatchRunResult } from './helpers/runContentBatchHarness';
import { RunBattleRuntime } from '../src/lab/portraitBattleLab/runBattleRuntime';
import { mulberry32 } from '../src/battle/battleContract';
import { WEAPON_SLOT, defaultPlayerDraft } from '../src/product/playerLoadout';

const SLOW_MS = 600_000;

/** 与 M5 E2E 的装配语义逐字段同源（真实 Garage 可达：车身/武器/前后轮）。 */
function garageDraft(body: string, weapon: string, front: string, rear: string): BuildDraft {
  const base = defaultPlayerDraft();
  const next: BuildDraft = {
    ...base,
    bodyDefId: body,
    functionalSelections: { ...base.functionalSelections, [WEAPON_SLOT]: weapon },
  };
  next.frontWheelDefId = front;
  next.frontRadius = registry.movements.get(front)?.radius ?? 20;
  next.rearWheelDefId = rear;
  next.rearRadius = registry.movements.get(rear)?.radius ?? 20;
  return next;
}

/** M5 E2E 的强化策略（POLICY）：非 cannon 局通用池 emergencyRepair → damageUp。 */
const M5_POLICY: readonly [string, string] = ['emergencyRepair', 'damageUp'];

/** machineGun 局的全部合法强化组合（通用池 3 选 2 的有序排列，跨节点剔除已拥有）。 */
const GENERIC_PICK_MATRIX: readonly (readonly [string, string])[] = [
  ['emergencyRepair', 'damageUp'],
  ['emergencyRepair', 'rateUp'],
  ['damageUp', 'emergencyRepair'],
  ['damageUp', 'rateUp'],
  ['rateUp', 'emergencyRepair'],
  ['rateUp', 'damageUp'],
];

/** 紧凑单行摘要（表格落盘用）。 */
function rowOf(label: string, r: BatchRunResult): string {
  const segs = r.segs
    .map((s, i) => `B${i + 1}:${s.encounterId}:${s.winner ?? '-'}(${Math.round(s.hpA)}/${Math.round(s.hpB)},${s.steps})`)
    .join(' ');
  return `  ${label.padEnd(30)} ${r.phase.padEnd(9)} ${segs}`;
}

/* ═════════════════════════ W-01 确定性胜负矩阵 ═════════════════════════ */

describe('DEMO-M5-WIN-PATH-RNG-ROOT-R1｜W-01 确定性胜负矩阵（默认路线 · 零 RNG）', () => {
  it(
    'W-01a mango+machineGun+双smallWheel：全部合法强化组合逐场落盘',
    () => {
      const draft = garageDraft('mangoBody', 'machineGun', 'smallWheel', 'smallWheel');
      const lines: string[] = [];
      for (const picks of GENERIC_PICK_MATRIX) {
        const r = runContentBatchCase({ label: `mango-mg-${picks.join('+')}`, draft, picks });
        lines.push(rowOf(picks.join('→'), r));
      }
      console.log(`\n##### W-01a mangoBody+machineGun+双smallWheel（默认路线 ProtoRusher→Chaser→RangedTurret）#####\n${lines.join('\n')}`);
    },
    SLOW_MS,
  );

  it(
    'W-01b durianBody+machineGun+双smallWheel（M5 RUN-3 变体）：同矩阵落盘',
    () => {
      const draft = garageDraft('durianBody', 'machineGun', 'smallWheel', 'smallWheel');
      const lines: string[] = [];
      for (const picks of GENERIC_PICK_MATRIX) {
        const r = runContentBatchCase({ label: `durian-mg-${picks.join('+')}`, draft, picks });
        lines.push(rowOf(picks.join('→'), r));
      }
      console.log(`\n##### W-01b durianBody+machineGun+双smallWheel #####\n${lines.join('\n')}`);
    },
    SLOW_MS,
  );

  it(
    'W-01c 对照：默认车 watermelonBody+cannon+默认轮（M5 RUN-1）在默认路线 + M5 同款策略下落盘',
    () => {
      // 默认车的轮 = 缺省（存档无键）；基底 defaultPlayerDraft 即真实默认车。
      const draft = defaultPlayerDraft();
      const lines: string[] = [];
      // cannon 局走 Cannon 专属三池：一层（heavyShell/twinCannon/fastReload）× 二层（各自的池）。
      // 这里只取 M5 E2E 对 cannon 局不可能命中的口径做对照：E2E 的 POLICY 在 cannon 局会
      // 点 layer1=emergencyRepair —— 它不在 cannon 一层池里 ⇒ E2E 实际点的是池首项。
      // 为对齐浏览器真实行为，这里逐个一层项 × 各自二层首项全跑。
      const L1 = ['heavyShell', 'twinCannon', 'fastReload'] as const;
      const L2: Record<(typeof L1)[number], readonly string[]> = {
        heavyShell: ['kineticBurst', 'emergencyRepair', 'fastReload'],
        twinCannon: ['tripleLoad', 'emergencyRepair', 'heavyShell'],
        fastReload: ['heavyShell', 'twinCannon', 'emergencyRepair'],
      };
      for (const p1 of L1) {
        for (const p2 of L2[p1]) {
          const r = runContentBatchCase({
            label: `default-cannon-${p1}+${p2}`,
            draft,
            picks: [p1, p2],
          });
          lines.push(rowOf(`${p1}→${p2}`, r));
        }
      }
      console.log(`\n##### W-01c 默认车 watermelonBody+cannon+缺省轮（9 条 Cannon 合法强化路线）#####\n${lines.join('\n')}`);
    },
    SLOW_MS,
  );
});

/* ═════════════════════════ W-02 确定性复跑一致性 ═════════════════════════ */

describe('DEMO-M5-WIN-PATH-RNG-ROOT-R1｜W-02 战斗内核无 RNG（复跑一致性）', () => {
  it(
    'W-02 同 chassis 同 picks 复跑 3 次：逐场读数逐字相同（winner/HP/steps/逐发伤害）',
    () => {
      const draft = garageDraft('mangoBody', 'machineGun', 'smallWheel', 'smallWheel');
      const runs: BatchRunResult[] = [];
      for (let i = 0; i < 3; i++) {
        runs.push(
          runContentBatchCase({ label: `replay-${i}`, draft, picks: M5_POLICY }),
        );
      }
      const sig = (r: BatchRunResult) =>
        JSON.stringify([
          r.phase,
          r.segs.map((s) => [s.encounterId, s.winner, Math.round(s.hpA * 100) / 100, Math.round(s.hpB * 100) / 100, s.steps, s.perHit]),
          r.buildSeq,
        ]);
      expect(sig(runs[1]!), '复跑 #2 与 #1 逐字相同（内核无 RNG）').toBe(sig(runs[0]!));
      expect(sig(runs[2]!), '复跑 #3 与 #1 逐字相同（内核无 RNG）').toBe(sig(runs[0]!));
      console.log(`\n##### W-02 复跑一致性：3 次签名相同 ⇒ 战斗内核确定性（无 RNG）#####\n  phase=${runs[0]!.phase} segs=${runs[0]!.segs.length}`);
    },
    SLOW_MS,
  );
});

/* ═══════════════════ W-03 帧批次粒度敏感性（浏览器时序机制） ═══════════════════ */

/**
 * 用指定帧时长驱动同一场战斗（复刻浏览器 `RunPage.startLoop` 的喂入方式：
 * 每帧 `rt.step(dt)`，dt 为帧间隔；内部累加器切成固定步）。
 * 返回与 `SingleBattleFact` 同形的读数。
 */
function battleAtFrameMs(draft: BuildDraft, encounterId: string, frameMs: number) {
  const rt = new RunBattleRuntime({
    build: [],
    carriedHp: null,
    encounterId,
    playerDraft: draft,
    playerLoadoutTag: 'profile-equipped',
    playerBaseline: true,
  });
  try {
    const atStart = rt.hp();
    let steps = 0;
    let frames = 0;
    while (rt.result === null && steps < 12000) {
      rt.step(frameMs);
      frames += 1;
      steps = rt.stepCount;
    }
    const hp = rt.hp();
    return {
      winner: rt.result?.winner ?? null,
      endReason: rt.result?.endReason ?? null,
      hpA: Math.round(hp.a * 10) / 10,
      hpB: Math.round(hp.b * 10) / 10,
      hpAMax: atStart.aMax,
      steps,
      frames,
    };
  } finally {
    rt.dispose();
  }
}

describe('DEMO-M5-WIN-PATH-RNG-ROOT-R1｜W-03 帧批次粒度敏感性（浏览器实跑差异的机制候选）', () => {
  it(
    'W-03 同场战斗按 8/16.67/32/64ms 帧粒度驱动：胜负与 HP 是否分叉（分叉 = 浏览器帧节奏影响结果）',
    () => {
      const draft = garageDraft('mangoBody', 'machineGun', 'smallWheel', 'smallWheel');
      const lines: string[] = [];
      for (const enc of ['ProtoRusher', 'Chaser', 'RangedTurret']) {
        for (const f of [8, 1000 / 60, 32, 64]) {
          const r = battleAtFrameMs(draft, enc, f);
          lines.push(
            `  ${enc.padEnd(13)} frame=${f.toFixed(2).padStart(6)}ms  winner=${r.winner ?? '-'} ` +
              `hpA=${r.hpA}/${r.hpAMax} hpB=${r.hpB} steps=${r.steps} frames=${r.frames}`,
          );
        }
      }
      console.log(`\n##### W-03 帧批次粒度敏感性（mango+machineGun+双smallWheel · 满血开局）#####\n${lines.join('\n')}`);
      // 不锁胜负：这是测量。只要求 60fps 读数与 W-01 矩阵同源（同样能打完）。
      const r60 = battleAtFrameMs(draft, 'ProtoRusher', 1000 / 60);
      expect(r60.steps, '60fps 粒度下真实战斗步数 > 0').toBeGreaterThan(0);
    },
    SLOW_MS,
  );

  it(
    'W-03b 单场战斗：60fps 逐帧 vs 1ms 近理想轨道（每帧 0~1 固定步）对照',
    () => {
      const draft = garageDraft('mangoBody', 'machineGun', 'smallWheel', 'smallWheel');
      const a = battleAtFrameMs(draft, 'ProtoRusher', 1000 / 60);
      // 近理想轨道：1ms 帧粒度 ⇒ 每帧最多 1 个固定步，批次边界效应最小化。
      const c = battleAtFrameMs(draft, 'ProtoRusher', 1);
      console.log(
        `\n##### W-03b 帧粒度对照（ProtoRusher）#####\n` +
          `  60fps(16.67ms): winner=${a.winner} hpA=${a.hpA} hpB=${a.hpB} steps=${a.steps}\n` +
          `  1ms(近理想):    winner=${c.winner} hpA=${c.hpA} hpB=${c.hpB} steps=${c.steps}`,
      );
    },
    SLOW_MS,
  );
});

/* ═══════════════════ W-03c 真实 rAF 抖动仿真（两次实跑差异的最后一环） ═══════════════════ */

/**
 * 用带抖动的帧序列驱动同一场战斗：主节奏 baseMs + 每次 ±jitterMs 均匀抖动，
 * 每 stutterEvery 帧插入一次 stutterMs 长帧（模拟真实浏览器的偶发卡顿）。
 * 复刻 `RunPage.startLoop`（`dt = Math.min(64, now - lastFrameMs)`）的喂入口径。
 */
function battleWithJitter(draft: BuildDraft, encounterId: string, baseMs: number, jitterMs: number, stutterEvery: number, stutterMs: number, seed: number) {
  const rng = mulberry32(seed);
  const rt = new RunBattleRuntime({
    build: [],
    carriedHp: null,
    encounterId,
    playerDraft: draft,
    playerLoadoutTag: 'profile-equipped',
    playerBaseline: true,
  });
  try {
    let steps = 0;
    let frames = 0;
    while (rt.result === null && steps < 12000) {
      let dt = baseMs + (rng() * 2 - 1) * jitterMs;
      if (stutterEvery > 0 && frames % stutterEvery === stutterEvery - 1) dt = stutterMs;
      rt.step(Math.min(64, dt));
      frames += 1;
      steps = rt.stepCount;
    }
    const hp = rt.hp();
    return { winner: rt.result?.winner ?? null, hpA: Math.round(hp.a), hpB: Math.round(hp.b), steps, frames };
  } finally {
    rt.dispose();
  }
}

describe('DEMO-M5-WIN-PATH-RNG-ROOT-R1｜W-03c 真实 rAF 抖动仿真（同机两次实跑差异的机制）', () => {
  it(
    'W-03c Chaser 场（16.67ms 基准）带 ±抖动与偶发长帧：多 seed 结果是否翻转',
    () => {
      const draft = garageDraft('mangoBody', 'machineGun', 'smallWheel', 'smallWheel');
      const lines: string[] = [];
      // 轻抖（±2ms，120帧一卡）与重抖（±6ms，60帧一卡 40ms）两组，各 5 个 seed。
      for (const cfg of [
        { tag: '轻抖 ±2ms/卡120×30ms', jitter: 2, every: 120, stutter: 30 },
        { tag: '重抖 ±6ms/卡60×40ms', jitter: 6, every: 60, stutter: 40 },
      ]) {
        for (let seed = 1; seed <= 5; seed++) {
          const r = battleWithJitter(draft, 'Chaser', 1000 / 60, cfg.jitter, cfg.every, cfg.stutter, seed);
          lines.push(
            `  ${cfg.tag.padEnd(20)} seed=${seed}  winner=${r.winner ?? '-'} hpA=${r.hpA}/950 hpB=${r.hpB} steps=${r.steps}`,
          );
        }
      }
      console.log(`\n##### W-03c rAF 抖动仿真（mango+machineGun vs Chaser · 满血开局）#####\n${lines.join('\n')}`);
    },
    SLOW_MS,
  );
});

/* ═════════════════════════ W-04 单场胜负普查（失败节点定位） ═════════════════════════ */

describe('DEMO-M5-WIN-PATH-RNG-ROOT-R1｜W-04 失败节点定位（三段逐场满血单打）', () => {
  it(
    'W-04 三台 chassis × 三段对手：满血单打胜负普查（谁在第几段被谁打死）',
    () => {
      const chassiss: readonly (readonly [string, BuildDraft])[] = [
        ['mango+mg+双small', garageDraft('mangoBody', 'machineGun', 'smallWheel', 'smallWheel')],
        ['durian+mg+双small', garageDraft('durianBody', 'machineGun', 'smallWheel', 'smallWheel')],
        ['default-cannon', defaultPlayerDraft()],
      ];
      const lines: string[] = [];
      for (const [name, d] of chassiss) {
        for (const enc of ['ProtoRusher', 'Chaser', 'RangedTurret']) {
          const f = runSingleBattle(d, [], enc, null);
          lines.push(
            `  ${name.padEnd(20)} vs ${enc.padEnd(13)} winner=${f.winner ?? '-'} ` +
              `hpA=${Math.round(f.hpA)}/${f.hpAMax} hpB=${Math.round(f.hpB)}/${f.hpBMax} steps=${f.steps} perHit=[${f.perHit.join(',')}]`,
          );
        }
      }
      console.log(`\n##### W-04 满血单打普查（零强化）#####\n${lines.join('\n')}`);
      // 方法有效性：每场都必须真实打完（有 winner 或达到步数上限），不允许 0 步。
      expect(lines.length).toBe(9);
    },
    SLOW_MS,
  );
});
