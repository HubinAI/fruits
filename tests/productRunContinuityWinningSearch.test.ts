/**
 * PRODUCT-LOOP-R10-NEXT-RUN-CONTINUITY｜获胜装配侦察（**测量工具，非回归守卫**）。
 *
 * 目的（Task #15）：在**产品真实可达**的装备空间里，找出除了已证明的 `machineGun`（P0 用
 * `coconutBody + rear heavyWheel`）之外，还有哪些 Full Run Weapon 能在产品可达装配下
 * 真的打到 COMPLETE —— 因为本 Queue 要求 E2E 覆盖「machineGun + 另一件非 Cannon + cannon」
 * 三条浏览器路径，而 R9F 的 `only` 夹具（默认车身/缺省轮/top 空）下 7 件全 FAILED，
 * 说明「默认车」不够，必须挑一个能赢的 (车身, 后轮) 组合。
 *
 * ── 产品可达空间的定义（与真实 Garage UI 落盘一一对应）────────────────────────
 *   · 只改 3 处：`bodyDefId`（车身）/ `rearWheelDefId`（后轮）/ `frontMass`（主武器槽）。
 *   · `top` 槽 = 产品默认 **hammer**（产品侧只读，Garage 改不到 ⇒ 真实运行时仍贡献输出）。
 *   · `front` 槽 = 产品默认 **EMPTY**（DEFAULT_CLEARED_SLOT，新账号默认留空）。
 *   · 前轮 = 缺省 `wheelStd`（E2E 不改前轮）。
 *   ⇒ 本文件用 `makeStarterDraft(body)` 起手，再覆盖 `frontMass=W` / `front=EMPTY`，
 *     最后按后轮写 `rearWheelDefId` + 同步 `rearRadius`（口径与 `equipMovement` 一致）。
 *
 * ── 驱动口径 ─────────────────────────────────────────────────────────────────
 *   与 `productRunFullRunPathMatrixR9F.test.ts` 的 `runRoute` **逐字同源**：同一份
 *   `runPageContext` + `RunBattleRuntime` + `runChoicePool/chooseRunBuff/finishRunBattle/
 *   pressRunAction/runCarriedPlayerHp`。**零测试专用 Buff / 零手工改 HP**。
 *
 * ── 输出 ─────────────────────────────────────────────────────────────────────
 *   控制台打印一张「车身 × 武器 × 后轮 → COMPLETE/FAILED（终局我方 HP）」矩阵，
 *   供人工挑出 E2E 要用的获胜组合。本文件**不**钉任何冻结值（它是侦察，不是契约）。
 *
 * ⚠️ 不修改任何 `src/**`；纯测量。
 */

import { describe, expect, it } from 'vitest';

import { registry } from '../src/core/content';
import { EMPTY_SLOT, makeStarterDraft, type BuildDraft } from '../src/lab/buildEditorModel';
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
  type RunPageState,
} from '../src/lab/portraitBattleLab/runPageState';
import { runPageContext } from '../src/lab/portraitBattleLab/runPageScene';
import { OFFICIAL_BODIES } from '../src/core/bodyOwnership';
import { FULL_RUN_SUPPORTED_WEAPON_IDS, canStartFullRun } from '../src/product/runCompatibility';

/* ------------------------------------------------------------------ 参数 */
const FRAME_MS = 1000 / 60;
const SLOW_MS_GUARD = 600_000;
const MAX_FRAMES = 4000;
const PRODUCT_TAG = 'profile-equipped';

const WHEELS: readonly string[] = ['wheelStd', 'smallWheel', 'largeWheel', 'heavyWheel', 'none'];
const WHEEL_RADIUS: Readonly<Record<string, number>> = (() => {
  const m: Record<string, number> = { none: 20 };
  for (const def of registry.movements.values()) m[def.id] = def.radius ?? 20;
  return m;
})();

/**
 * 产品可达装配：车身 B + 主武器 W（frontMass）+ 后轮 R（rearWheelDefId）。
 * ⚠️ PRODUCT-LOOP-P0-HIDDEN-TOP-WEAPON-REMOVAL｜**不再带隐藏锤**：真实产品可达空间里，
 *    `top` 槽已被本 Queue 清空（`defaultPlayerDraft` 清 + `loadEquippedDraft→clearHiddenTopWeapon`
 *    清旧存档）。所以这里 `top` 置 `EMPTY_SLOT`，如实侦察「只有 frontMass 一件武器」的玩家真实可达空间。
 *   这正是 Q3 能力缺口 (a) 被本 Queue 坐实后的状态：产品一键/可达装配在真实可达空间里**零 COMPLETE**。
 */
function productDraft(bodyDefId: string, weapon: string, rearWheel: string): BuildDraft {
  const base = makeStarterDraft(bodyDefId, registry);
  const selections: Record<string, string> = {
    ...base.functionalSelections,
    front: EMPTY_SLOT, // DEFAULT_CLEARED_SLOT
    frontMass: weapon, // 唯一可写主武器槽
    top: EMPTY_SLOT, // 产品侧已清空隐藏锤（本 Queue）；真实产品不再带锤
    rear: EMPTY_SLOT, // rear 槽不挂功能件；后轮走 rearWheelDefId
  };
  const next: BuildDraft = { ...base, functionalSelections: selections };
  if (rearWheel === 'none') {
    delete next.rearWheelDefId;
    next.rearRadius = 20;
  } else {
    next.rearWheelDefId = rearWheel;
    next.rearRadius = WHEEL_RADIUS[rearWheel] ?? 20;
  }
  return next;
}

/** 按武器挑「真实可达」的成长路线（非 Cannon → 通用池 emergencyRepair→damageUp；Cannon → 自己那套）。 */
function policyPicks(weapon: string): readonly string[] {
  if (weapon === 'cannon') return ['heavyShell', 'kineticBurst'];
  return ['emergencyRepair', 'damageUp'];
}

interface ComboResult {
  body: string;
  weapon: string;
  rear: string;
  phase: string;
  stages: number;
  finalHpA: number;
  valid: boolean;
}

function runCombo(body: string, weapon: string, rear: string): ComboResult {
  const draft = productDraft(body, weapon, rear);
  const valid = canStartFullRun(draft);
  if (!valid) return { body, weapon, rear, phase: 'INVALID', stages: 0, finalHpA: 0, valid: false };
  const picks = policyPicks(weapon);
  const ctx = runPageContext({
    source: 'profile',
    label: `CONT/${body}/${weapon}/${rear}`,
    draft,
    tag: PRODUCT_TAG,
    key: `cont|${body}|${weapon}|${rear}`,
  });
  let s: RunPageState = createRunPageState(ctx);
  let carry: number | null = null;
  let finalHpA = 0;
  let stages = 0;
  let phase = s.phase;
  for (let guard = 0; guard < 40; guard++) {
    const before = s;
    if (s.phase === 'COMPLETE' || s.phase === 'FAILED') {
      phase = s.phase;
      break;
    }
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
        finalHpA = Math.round(hp.a * 10) / 10;
        stages += 1;
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
      const pool: string[] = runChoicePool(s).map((o) => o.id);
      const want = picks[s.buffs.length] ?? pool[0] ?? '';
      const use = pool.includes(want) ? want : pool[0] ?? '';
      s = chooseRunBuff(s, use, ctx);
      if (s === before) break; // no-op（项不在池里）⇒ 停在 CHOICE，本局截断
      continue;
    }
    if (s.phase === 'EVENT') carry = runCarriedPlayerHp(s);
    s = pressRunAction(s, ctx);
  }
  return { body, weapon, rear, phase, stages, finalHpA, valid: true };
}

describe('PRODUCT-LOOP-R10-NEXT-RUN-CONTINUITY｜获胜装配侦察矩阵', () => {
  it(
    '扫描 车身 × 武器 × 后轮 的可达 COMPLETE 组合',
    () => {
      const bodies = [...OFFICIAL_BODIES];
      const weapons = FULL_RUN_SUPPORTED_WEAPON_IDS;
      const results: ComboResult[] = [];
      for (const body of bodies) {
        for (const weapon of weapons) {
          for (const rear of WHEELS) {
            results.push(runCombo(body, weapon, rear));
          }
        }
      }

      // 打印矩阵
      const lines: string[] = [];
      lines.push('| 车身 \\ (武器,后轮) | ' + weapons.map((w) => `${w}`).join(' | '));
      lines.push('|---|' + weapons.map(() => '---').join('|'));
      for (const rear of WHEELS) {
        for (const body of bodies) {
          const cells = weapons.map((w) => {
            const r = results.find((x) => x.body === body && x.weapon === w && x.rear === rear);
            if (!r) return '?';
            if (!r.valid) return 'INVALID';
            return r.phase === 'COMPLETE' ? `✅${r.finalHpA}` : `❌${r.stages}`;
          });
          lines.push(`| ${body}/${rear} | ` + cells.join(' | '));
        }
      }
      console.log('\n[CONT 侦察矩阵] ✅=COMPLETE(终局HP) ❌=FAILED(打到第几段)\n' + lines.join('\n'));

      // 汇总：每个武器在哪些 (body,rear) 下 COMPLETE
      for (const w of weapons) {
        const wins = results.filter((r) => r.weapon === w && r.phase === 'COMPLETE');
        console.log(
          `[CONT] ${w}: COMPLETE 组合 ${wins.length} 个 → ` +
            wins.map((r) => `${r.body}+${r.rear}(hp${r.finalHpA})`).join(', ') || '（无）',
        );
      }

      expect(results.length, '确实扫完了所有组合').toBe(bodies.length * weapons.length * WHEELS.length);
    },
    SLOW_MS_GUARD,
  );
});
