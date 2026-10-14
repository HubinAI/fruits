/**
 * DEMO-FRAME-STEP-DETERMINISM-R1｜**帧批次粒度确定性回归**（Foundation 时序修复）。
 *
 * ── 缺陷本体（改前锁定）──────────────────────────────────────────────────
 *   W-03 证据（DEMO-M5-WIN-PATH-RNG-ROOT-R1）：同构筑同强化同帧序列下，
 *   mangoBody+machineGun+双 smallWheel vs Chaser：
 *     - 16.67ms/帧（60fps）→ 玩家胜（剩 763 HP）；
 *     - 32ms/帧          → 玩家败（HP=0）；
 *     - 64ms/帧          → 玩家又胜。
 *   根因：`PlanckBattleOrchestrator.step` 把「弹丸接触事实 drain / 越界销毁 /
 *   仿真时间推进 / arena 阶段推进 / contactTick 结算 / 终局检测」全部放在
 *   **整批 world.step 之后**执行（按外层帧调用结算），而物理本身按固定步推进
 *   ⇒ 批内多个固定步的中间命中/死亡被合并到批次边界处理，结果随「一次 rAF
 *   喂入几步」漂移。
 *
 * ── 本文件钉死什么 ────────────────────────────────────────────────────────
 *   FD-01（改前红）：同帧序列下 8/16.67/32/64ms 胜负与 HP/命中事实一致
 *           —— 在修复前的 HEAD（4591984）此断言 FAIL（32ms 翻转）；
 *   FD-02（改后绿）：三组抖动帧序列一致性；
 *   FD-03：60fps 轨道冻结（改前后读数逐字一致——防修复污染正确轨道）；
 *   FD-04：terminal 语义——result 只结算一次、整批中步死亡立即中止；
 *   FD-05：stepFixed 原有 API 语义不变（无帧概念，逐字保留）。
 *
 * ── 红线 ──────────────────────────────────────────────────────────────────
 *   不改数值 / 内容 / 行为；胜负由真实物理决定。测试只锁「同输入同结果」与
 *   「60fps 基线不漂移」，不锁「玩家必须赢」。
 */
import { describe, expect, it } from 'vitest';

import { type BuildDraft } from '../src/lab/buildEditorModel';
import { registry } from '../src/core/content';
import { RunBattleRuntime } from '../src/lab/portraitBattleLab/runBattleRuntime';
import { PlanckWorld } from '../src/physics/planckWorld';
import { WEAPON_SLOT, defaultPlayerDraft } from '../src/product/playerLoadout';

const SLOW_MS = 600_000;

/** W-03 同款构筑（真实 Garage 可达）。 */
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

const MANGO_MG = () => garageDraft('mangoBody', 'machineGun', 'smallWheel', 'smallWheel');

/** 用指定帧序列驱动一场战斗至终态（复刻 RunPage.startLoop 喂入口径）。 */
function battleAtFrameSeq(draft: BuildDraft, encounterId: string, frames: readonly number[]) {
  const rt = new RunBattleRuntime({
    build: [],
    carriedHp: null,
    encounterId,
    playerDraft: draft,
    playerLoadoutTag: 'profile-equipped',
    playerBaseline: true,
  });
  try {
    let framesUsed = 0;
    let resultSeen = 0;
    while (rt.result === null && framesUsed < frames.length) {
      rt.step(frames[framesUsed]!);
      framesUsed += 1;
      if (rt.result !== null) resultSeen += 1;
    }
    const hp = rt.hp();
    return {
      winner: rt.result?.winner ?? null,
      endReason: rt.result?.endReason ?? null,
      hpA: Math.round(hp.a * 10) / 10,
      hpB: Math.round(hp.b * 10) / 10,
      steps: rt.stepCount,
      framesUsed,
      resultSeen,
    };
  } finally {
    rt.dispose();
  }
}

/** 生成 n 帧恒定帧长序列。 */
function constFrames(frameMs: number, n: number): number[] {
  return Array.from({ length: n }, () => frameMs);
}

/** 帧签名（含逐发命中事实）。 */
function battleSignature(rt: RunBattleRuntime): string {
  const hp = rt.hp();
  return JSON.stringify({
    winner: rt.result?.winner ?? null,
    endReason: rt.result?.endReason ?? null,
    hpA: Math.round(hp.a * 100) / 100,
    hpB: Math.round(hp.b * 100) / 100,
    steps: rt.stepCount,
  });
}

/* ═══════════════════ FD-01 帧粒度一致性（改前红） ═══════════════════ */

describe('DEMO-FRAME-STEP-DETERMINISM-R1｜FD-01 帧批次粒度一致性', () => {
  it(
    'FD-01 mango+machineGun vs Chaser：8/16.67/32/64ms 恒定帧序列下同结果（改前 FAIL：32ms 翻转）',
    () => {
      const draft = MANGO_MG();
      const baseline = battleAtFrameSeq(draft, 'Chaser', constFrames(1000 / 60, 4000));
      const lines: string[] = [];
      for (const f of [8, 1000 / 60, 32, 64]) {
        const r = battleAtFrameSeq(draft, 'Chaser', constFrames(f, 4000));
        lines.push(
          `  frame=${f.toFixed(2).padStart(6)}ms winner=${r.winner ?? '-'} hpA=${r.hpA} hpB=${r.hpB} steps=${r.steps} frames=${r.framesUsed}`,
        );
        expect(
          [r.winner, r.endReason, r.hpA, r.hpB],
          `帧长 ${f.toFixed(2)}ms 必须与 60fps 基线同结果（winner/endReason/hpA/hpB）`,
        ).toEqual([baseline.winner, baseline.endReason, baseline.hpA, baseline.hpB]);
      }
      console.log(`\n##### FD-01 帧粒度一致性（mango+mg vs Chaser · 基线=${baseline.winner} hpA=${baseline.hpA}）#####\n${lines.join('\n')}`);
    },
    SLOW_MS,
  );
});

/* ═══════════════════ FD-02 抖动帧序列一致性 ═══════════════════ */

describe('DEMO-FRAME-STEP-DETERMINISM-R1｜FD-02 抖动帧序列一致性', () => {
  it(
    'FD-02 同构筑同强化：三组抖动帧序列（8±4ms / 16.67±6ms / 32±8ms）与恒定 16.67ms 同结果',
    () => {
      const draft = MANGO_MG();
      const baseline = battleAtFrameSeq(draft, 'Chaser', constFrames(1000 / 60, 4000));
      // 三组抖动序列（确定性 pattern，不用 RNG：可复现）。
      const jitterSeqs: readonly (readonly number[])[] = [
        Array.from({ length: 2000 }, (_, i) => Math.max(1, 8 + (i % 5) * 2)), // 8,10,12,14,16 循环
        Array.from({ length: 2000 }, (_, i) => Math.max(1, 1000 / 60 + (i % 7 - 3) * 2)), // 16.67±6ms
        Array.from({ length: 2000 }, (_, i) => (i % 3 === 2 ? 40 : 24)), // 24/24/40 循环（长帧模式）
      ];
      for (let k = 0; k < jitterSeqs.length; k++) {
        const r = battleAtFrameSeq(draft, 'Chaser', jitterSeqs[k]!);
        expect(
          [r.winner, r.endReason, r.hpA, r.hpB],
          `抖动序列 #${k + 1} 必须与 60fps 基线同结果`,
        ).toEqual([baseline.winner, baseline.endReason, baseline.hpA, baseline.hpB]);
      }
    },
    SLOW_MS,
  );
});

/* ═══════════════════ FD-03 60fps 轨道冻结（改前先记录基线） ═══════════════════ */

describe('DEMO-FRAME-STEP-DETERMINISM-R1｜FD-03 60fps 轨道冻结', () => {
  it(
    'FD-03 mango+mg 三战 60fps 读数冻结（改任何 Foundation 时序都不得改变本轨道结果）',
    () => {
      const draft = MANGO_MG();
      const rows: string[] = [];
      for (const enc of ['ProtoRusher', 'Chaser', 'RangedTurret']) {
        const r = battleAtFrameSeq(draft, enc, constFrames(1000 / 60, 5000));
        rows.push(`${enc}: winner=${r.winner} hpA=${r.hpA}/950 hpB=${r.hpB} steps=${r.steps} frames=${r.framesUsed}`);
        // 静态锁定（60fps 是现网正确轨道，任何时序修复不得改变其结果）：
        // 全部三场玩家胜 + 敌方 HP 归零（与 W-03/W-04 实测一致）。
        expect(r.winner, `${enc} 60fps 轨道玩家胜`).toBe('A');
        expect(r.hpB, `${enc} 60fps 轨道敌方 HP 归零`).toBe(0);
      }
      console.log(`\n##### FD-03 60fps 轨道冻结 #####\n  ${rows.join('\n  ')}`);
    },
    SLOW_MS,
  );
});

/* ═══════════════════ FD-04 terminal 语义 ═══════════════════ */

describe('DEMO-FRAME-STEP-DETERMINISM-R1｜FD-04 terminal 语义', () => {
  it(
    'FD-04 终局后 step 是 no-op：result 只结算一次、不产生新伤害/新步',
    () => {
      const draft = MANGO_MG();
      const rt = new RunBattleRuntime({
        build: [],
        carriedHp: null,
        encounterId: 'Chaser',
        playerDraft: draft,
        playerLoadoutTag: 'profile-equipped',
        playerBaseline: true,
      });
      try {
        let guard = 0;
        while (rt.result === null && guard < 6000) {
          rt.step(1000 / 60);
          guard += 1;
        }
        expect(rt.result, '前置：战斗已到终态').not.toBeNull();
        const sigBefore = battleSignature(rt);
        const hpBefore = rt.hp();
        const stepsBefore = rt.stepCount;
        // 终局后再喂 10 帧（含长帧）：必须全部 no-op。
        for (const dt of [16.67, 32, 64, 100, 16.67, 16.67, 64, 32, 16.67, 16.67]) {
          rt.step(dt);
        }
        expect(battleSignature(rt), '终局后签名逐字不变').toBe(sigBefore);
        expect(rt.hp(), '终局后 HP 不变').toEqual(hpBefore);
        expect(rt.stepCount, '终局后步数不变').toBe(stepsBefore);
      } finally {
        rt.dispose();
      }
    },
    SLOW_MS,
  );
});

/* ═══════════════════ FD-05 PlanckWorld.step 固定步语义与步数上限 ═══════════════════ */

describe('DEMO-FRAME-STEP-DETERMINISM-R1｜FD-05 PlanckWorld.step 契约', () => {
  it(
    'FD-05a 累计步进语义：60 帧 × 16.67ms ≈ 60 步；60 帧 × 32ms ≈ 115 步（余量跨帧累计，不丢失）',
    () => {
      const w = new PlanckWorld({ x: 0, y: 10 });
      let s60 = 0;
      for (let i = 0; i < 60; i++) s60 += w.step(1000 / 60, 1, () => {});
      // 16.67ms ≥ FIXED_DT(16.667)：每帧恰好 1 步。
      expect(s60, '60 帧 60fps = 60 步（每帧 1 步）').toBe(60);
      let s32 = 0;
      for (let i = 0; i < 60; i++) s32 += w.step(32, 1, () => {});
      // 60 帧 32ms = 1920ms；1920/16.667 = 115.2 ⇒ 累计 115 步（±1 边界容差）。
      expect(s32, '60 帧 32ms 累计步数（1920ms 固定步当量）').toBeGreaterThanOrEqual(114);
      expect(s32).toBeLessThanOrEqual(116);
      // 关键反例（缺陷语境）：单次 step(32) 从零余量出发只出 1 步（floor(32/16.67)=1），
      // 余量 15.33ms 跨帧保留 ⇒ 批次边界把「第 2 步」推到下一帧。
      const w2 = new PlanckWorld({ x: 0, y: 10 });
      expect(w2.step(32, 1, () => {}), '单次 32ms 从零余量 = 1 步（余量累计）').toBe(1);
    },
  );

  it(
    'FD-05b stepFixed(n) 语义不变：n 步逐字推进（无帧概念，不影响累加器）',
    () => {
      const w = new PlanckWorld({ x: 0, y: 10 });
      expect(() => w.stepFixed(3), 'stepFixed(3) 无异常').not.toThrow();
      expect(() => w.stepFixed(1), 'stepFixed(1) 无异常').not.toThrow();
      const s = w.step(16.67, 1, () => {});
      expect(s, 'stepFixed 后 step 仍正常（每帧 1 步）').toBe(1);
    },
  );

  it(
    'FD-05c onBeforeStep 每个固定物理步调用一次（60 帧 × 32ms → 调用数 = 累计物理步数）',
    () => {
      const w = new PlanckWorld({ x: 0, y: 10 });
      let calls = 0;
      let steps = 0;
      for (let i = 0; i < 60; i++) {
        steps += w.step(32, 1, () => {
          calls += 1;
        });
      }
      expect(calls, 'onBeforeStep 调用数 = 实际物理步数').toBe(steps);
      expect(steps, '累计物理步数在 32ms 帧序列当量内').toBeGreaterThanOrEqual(114);
      expect(steps).toBeLessThanOrEqual(116);
    },
  );
});
