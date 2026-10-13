/**
 * CONTENT-BATCH-CREATION-PIPELINE-R1｜**Foundation 示范批测**（确定性底座 × 现有 Build / 路线）。
 *
 * ── 本文件做什么（必改 2 / 必改 3 / 必改 4）──────────────────────────────────
 *
 *   用**声明式案例**驱动新底座 `runContentBatchHarness`：
 *
 *     · 3 组**现有 Build**（数据全部来自当前 content registry / 真实装备，零新敌人、零改数值）：
 *         - `mgPrimary`      = machineGun ×3（`WEAPON_SLOT`+top+rear）⇒ 通用成长池
 *         - `cannonWalk`     = 默认车身 + cannon(`WEAPON_SLOT`) ⇒ Cannon 池
 *         - `mangoCannon`    = mangoBody + cannon(`WEAPON_SLOT`) ⇒ Cannon 池
 *     · 3 条**既有路线**（引用 `LAB_ENCOUNTERS` 既有条目，零新数值）：
 *         - 默认三段链  /  `heavy`  /  `rush`
 *     ⇒ 共 9 条「Build × 路线」全部跑通确定性底座，每阶段输出可追溯真实数据。
 *
 * ── 验收口径（验收 ① / ② / ④）──────────────────────────────────────────────
 *
 *   - ① 9 条均通过共享底座真正跑完；胜负按**实际结果**断言（不要求全胜）；
 *   - ② 非法装备 / 错误路线被**红灯**明确拒绝；案例间状态隔离（每例独立 `runPageContext`）；
 *   - ④ 确定性 PASS/FAIL 与浏览器 RNG `BLOCKED` **分开统计**：本文件只做确定性内容验收，
 *     浏览器随机路线 BLOCKED 不在本底座内混算（见 `tests/_e2e_*` 既有 BLOCKED 口径）。
 *
 * ⚠️ 不改任何正式 Runtime / 经济 / 数值；不新增提示 / 特效 / UI。
 */

import { describe, expect, it } from 'vitest';

import {
  BatchRunError,
  DEFAULT_WEAPON_SLOT,
  EMPTY_SLOT,
  buildDraftFromContentSpec,
  printBatchSummary,
  runContentBatchCase,
  type BatchRunResult,
  type ContentBatchCaseSpec,
} from './helpers/runContentBatchHarness';

const SLOW_MS = 300_000;

/** 3 组现有 Build（声明式 spec，全部来自真实 content registry）。 */
const MG_PRIMARY_FUNCTIONAL: ContentBatchCaseSpec['functional'] = {
  [DEFAULT_WEAPON_SLOT]: 'machineGun',
  top: 'machineGun',
  rear: 'machineGun',
};
const CANNON_WALK_FUNCTIONAL: ContentBatchCaseSpec['functional'] = {
  [DEFAULT_WEAPON_SLOT]: 'cannon',
};
/** mangoCannon 用独立 spec（换车身）。 */
function mangoCannonSpec(): ContentBatchCaseSpec {
  return {
    label: 'mangoCannon',
    bodyDefId: 'mangoBody',
    functional: { [DEFAULT_WEAPON_SLOT]: 'cannon' },
    picks: ['heavyShell', 'kineticBurst'],
  };
}

/** 每个 Build 的两项合法强化（来自当时候选池：Cannon 局走 Cannon 池，通用局走通用池）。 */
const PICKS: Record<string, [string, string]> = {
  mgPrimary: ['damageUp', 'rateUp'],
  cannonWalk: ['heavyShell', 'kineticBurst'],
  mangoCannon: ['heavyShell', 'kineticBurst'],
};

/** 3 条既有路线（含默认）。 */
const ROUTES: { id: 'default' | 'heavy' | 'rush'; route?: 'heavy' | 'rush' }[] = [
  { id: 'default', route: undefined },
  { id: 'heavy', route: 'heavy' },
  { id: 'rush', route: 'rush' },
];

/** 生成 9 条「Build × 路线」案例。 */
function buildCases(): ContentBatchCaseSpec[] {
  const out: ContentBatchCaseSpec[] = [];
  for (const buildName of ['mgPrimary', 'cannonWalk', 'mangoCannon'] as const) {
    for (const r of ROUTES) {
      const base =
        buildName === 'mgPrimary'
          ? { functional: MG_PRIMARY_FUNCTIONAL }
          : buildName === 'cannonWalk'
            ? { functional: CANNON_WALK_FUNCTIONAL }
            : { bodyDefId: 'mangoBody', functional: mangoCannonSpec().functional };
      out.push({
        label: `${buildName}/${r.id}`,
        ...base,
        route: r.route,
        picks: PICKS[buildName],
      });
    }
  }
  return out;
}

describe('CONTENT-BATCH-FOUNDATION-R1｜9 例「现有 Build × 既有路线」确定性跑批', () => {
  const cases = buildCases();

  it(
    'CBF-01 必改 2/① 9 例全部通过确定性底座跑完三段两强化，每阶段可追溯真实数据',
    () => {
      const results: BatchRunResult[] = [];
      for (const spec of cases) {
        const r = runContentBatchCase(spec);
        results.push(r);

        // ① 到达真实终态（COMPLETE / FAILED 任一，不是卡死）
        expect(['COMPLETE', 'FAILED'], `${spec.label}: 必须到达真实终态`).toContain(r.phase);
        // ② COMPLETE ⇒ 三段全打满；FAILED ⇒ 至少打了一场
        if (r.complete) expect(r.battlesCompleted, `${spec.label}: 全胜 ⇒ 三段`).toBe(3);
        expect(r.segs.length, `${spec.label}: 至少一场真实战斗`).toBeGreaterThanOrEqual(1);
        // ③ 每场都是真实分出胜负的战斗（一端耐久归零），不是摆件 / 瞬杀
        for (const seg of r.segs) {
          expect(seg.winner, `${spec.label}/${seg.nodeId}: 真实终态胜者非 null`).not.toBeNull();
          expect(seg.steps, `${spec.label}/${seg.nodeId}: 真实战斗步数`).toBeGreaterThan(30);
          expect(seg.hpA === 0 || seg.hpB === 0, `${spec.label}/${seg.nodeId}: 一端耐久归零`).toBe(true);
        }
        // ④ 累积 Build 逐段增长（第 i 场开局累积 = i 项）
        r.segs.forEach((seg, i) => {
          expect(seg.build.length, `${spec.label}/${seg.nodeId}: 累积 Build 时序`).toBe(i);
        });
        // ⑤ 强化选择来自当时候选池（不硬塞、不自动选择）
        for (const p of r.picks) {
          expect(p.pool.length, `${spec.label}/${p.nodeId}: 候选池非空`).toBeGreaterThan(0);
          expect(p.accepted, `${spec.label}/${p.nodeId}: 选项在真实候选池`).toBe(true);
        }
      }

      // 机器可读汇总（落盘 / 复查口径）
      printBatchSummary(results);

      // ⑥ 9 例全部独立（案例间状态隔离）：不存在「某例因为上一例残留而偏离」
      expect(results.length, '共 9 例').toBe(9);
      //   武器确实开过火（整轮累计命中 > 0）—— 失败局里输掉的那场可能 0 命中
      //   （如被 RangedTurret 控距），但整轮至少一场证明武器真实发射、底座读数非空
      //   （不要求每场都命中：要求「每场都有伤害」会误杀合法的失败局）。
      for (const r of results) {
        const totalHits = r.segs.reduce((a, s) => a + s.hits, 0);
        expect(totalHits, `${r.label}: 整轮武器至少开火一次`).toBeGreaterThan(0);
      }
    },
    SLOW_MS,
  );

  it(
    'CBF-02 必改 4/② 非法装备被红灯拒绝（不静默放行）',
    () => {
      // ① 未登记武器（spear 不在 Full Run 能力登记表）⇒ 资格层拒绝 ⇒ 红线
      const illegalSpear: ContentBatchCaseSpec = {
        label: 'illegal/spear',
        functional: { [DEFAULT_WEAPON_SLOT]: 'spear' as string },
        picks: ['damageUp', 'rateUp'],
      };
      expect(() => runContentBatchCase(illegalSpear), 'spear：必须红线拒绝').toThrow(BatchRunError);

      // ② 装配不合法（强制一个不可能合法的组合：车身不存在）⇒ 装配校验失败 ⇒ 红线
      const illegalBody: ContentBatchCaseSpec = {
        label: 'illegal/body',
        bodyDefId: 'noSuchBodyXYZ',
        functional: { [DEFAULT_WEAPON_SLOT]: 'cannon' },
        picks: ['heavyShell', 'kineticBurst'],
      };
      let caught: unknown;
      try {
        runContentBatchCase(illegalBody);
      } catch (e) {
        caught = e;
      }
      expect(caught, '不存在车身：必须红线拒绝').toBeInstanceOf(BatchRunError);
      expect((caught as BatchRunError).kind, '红线类型 = illegal').toBe('illegal');
    },
    SLOW_MS,
  );

  it('CBF-03 必改 4/② 错误路线被红灯拒绝（仅允许 default/heavy/rush）', () => {
    const badRoute = {
      label: 'badroute',
      functional: { [DEFAULT_WEAPON_SLOT]: 'cannon' },
      route: 'bogus' as 'heavy', // 故意越界
      picks: ['heavyShell', 'kineticBurst'] as [string, string],
    };
    let caught: unknown;
    try {
      runContentBatchCase(badRoute);
    } catch (e) {
      caught = e;
    }
    expect(caught, '未知路线：必须红线拒绝').toBeInstanceOf(BatchRunError);
    expect((caught as BatchRunError).kind, '红线类型 = route').toBe('route');
  });

  it(
    'CBF-04 必改 4/④ 确定性底座与浏览器 RNG BLOCKED 分账（声明式 spec 可编译为合法 draft）',
    () => {
      // 底座只做确定性内容验收；本断言证明「声明式 spec → 合法 draft」链路可用，
      // 浏览器随机路线 BLOCKED 仍由 `tests/_e2e_*` 单独统计，不在此混算。
      const d = buildDraftFromContentSpec(mangoCannonSpec());
      expect(d.bodyDefId, 'mangoCannon spec 编译车身').toBe('mangoBody');
      expect(d.functionalSelections[DEFAULT_WEAPON_SLOT], 'mangoCannon spec 编译主武器').toBe('cannon');
      expect(d.functionalSelections.front, '其余槽缺省 EMPTY').toBe(EMPTY_SLOT);
      expect(d.functionalSelections.rear, '其余槽缺省 EMPTY').toBe(EMPTY_SLOT);
    },
    SLOW_MS,
  );
});
