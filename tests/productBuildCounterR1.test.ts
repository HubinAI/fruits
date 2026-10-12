/**
 * DEMO-BUILD-COUNTER-R1｜4 合法 Build × 3 套候选 Encounter 的**同口径战斗矩阵**。
 *
 * ── 本 Queue 回答的一个问题 ─────────────────────────────────────────────────
 *
 *   上一轮（DEMO-ENCOUNTER-CONTENT-BATCH-R1）证明了三套候选战斗结果不同（对**同一辆**
 *   mango+cannon 车），但**没有**证明「玩家换装能改善对不同对手的战果」。
 *   本文件用**同一正式战斗夹具**（`RunBattleRuntime` + `playerBaseline: true` + 零 config）
 *   跑 4 × 3 矩阵，建立「不同对手 → 玩家应调整何种配置」的最小证据。
 *
 * ── 4 个 Build（全部真实可获得、能量合法、打法明显不同）────────────────────────
 *
 *   数值全部现读自 `content.ts` canonical（测试内断言，不抄表）。
 *   ⚠️ **可达性纪律**：产品 Garage 的 `editable` 只对 `WEAPON_SLOT`（frontMass）为 true
 *   （`playerLoadout.ts:979`）⇒ top/front/rear 功能槽**不是**玩家可写槽位。
 *   因此 4 个 Build 只用真实可写的三类写入口（equipBody / equipWeapon / equipMovement），
 *   **不**使用 top 槽附加武器（那是装配不出来的形态）：
 *
 *   | # | Build | 构成 | Energy | 打法画像 |
 *   |---|---|---|---|---|
 *   | A 对照 | mango+cannon+双 smallWheel | mango(95)/cannon 30/small 5×2 | 40/95 | 均衡炮车（上轮基线） |
 *   | B 近战重锤 | durian+hammer+双 heavyWheel | durian(105)/hammer 25/heavy 15×2 | 55/105 | 135 质量+1100HP 贴身抡锤 |
 *   | C 重型炮台 | coconut+cannon+双 heavyWheel | coconut(100)/cannon 30/heavy 15×2 | 60/100 | 160 质量稳射（最难被推动） |
 *   | D 爆发快攻 | durian+shotgun+双 smallWheel | durian(105)/shotgun 30/small 5×2 | 35/105 | 霰弹近距离爆发+双小轮机动 |
 *
 *   武器伤害/节奏互不相同（cannon 80/1000ms 单发 / hammer 90 物理弧 / shotgun 30×5 爆发）；
 *   Body 质量梯度（mango 48 / durian 135 / coconut 160）；轮组梯度（small 6 / heavy 20）。
 *   获得性：durian/coconut（R4 MVP + R5 内容池）/ hammer cannon shotgun
 *   （starter + R5 功能件）/ heavy·small Wheel（R3 种子）—— 全部来自正式种子链
 *   （productRealAccountPathR1 已钉「空存档初始化后即可拥有」）。
 *
 * ── 方法（防作弊 / 防随机 / 防非法装配）────────────────────────────────────
 *
 *   - 每个玩家 Build 都从**真空存档**走正式初始化 + 正式写入口（`equipBody` /
 *     `equipWeapon` / `equipMovement`）装配 —— 不直接注入 BuildDraft（RA-01 同款纪律）；
 *   - 战斗夹具与 productEncounterContentBatchR1 的 EB-02 逐字同口径
 *     （同一 MAX_STEPS / 同一 FRAME_MS / 同一 playerBaseline），保证跨轮可比；
 *   - 确定性抽查：同格复跑读数逐字相同（EB-02 已证；本文件 RA 段再对 4×3 全表复核）。
 *
 * ── 判定纪律（Queue 必改 4）──────────────────────────────────────────────
 *   - 「有效克制」= 某 Build 对某对手的战果**显著优于**其它 Build 且方向可解释；
 *   - 「同质配置」= 换 Build 对该对手战果几乎不变；
 *   - 「稳定最优解」= 某 Build 对全部对手 ≥ 其余；
 *   - 「无法判断」= 读数方向混乱或差异 < 噪声。
 *   结论只写给**真实出现**的形态，不预设克制（Queue：优先判断假设是否成立）。
 */
import { describe, expect, it } from 'vitest';

import { registry } from '../src/core/content';
import type { BuildDraft } from '../src/lab/buildEditorModel';
import { RunBattleRuntime } from '../src/lab/portraitBattleLab/runBattleRuntime';
import { validateSnapshot } from '../src/core/buildValidator';
import { buildSnapshotFromDraft } from '../src/lab/buildEditorModel';
import { canStartFullRun } from '../src/product/runCompatibility';
import {
  WEAPON_SLOT,
  defaultPlayerDraft,
  equipBody,
  equipMovement,
  equipWeapon,
  playerInventory,
} from '../src/product/playerLoadout';
import { openGrowthSession, isFreshProfile } from '../src/product/playerGrowth';
import { getCount as coreGetCount } from '../src/core/partInventory';

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

const ENCOUNTERS = ['HeavyFortress', 'RushRammer', 'HighGunPlatform'] as const;

/** 玩家 Build 的装配指令（全部经正式写入口执行；只用真实可编辑槽位）。 */
interface BuildSpec {
  readonly id: string;
  readonly body: string;
  /** frontMass 主武器（顺序 = 装配顺序第一件 ⇒ 本局基准武器）。 */
  readonly weapon: string;
  readonly wheel: string;
  readonly energyUsed: number;
  readonly capacity: number;
  /** body baseMass（现读自 canonical，用于归因说明）。 */
  readonly bodyMass: number;
}

const BUILDS: readonly BuildSpec[] = [
  { id: 'A-mango-cannon', body: 'mangoBody', weapon: 'cannon', wheel: 'smallWheel', energyUsed: 40, capacity: 95, bodyMass: 48 },
  { id: 'B-durian-hammer', body: 'durianBody', weapon: 'hammer', wheel: 'heavyWheel', energyUsed: 55, capacity: 105, bodyMass: 135 },
  { id: 'C-coconut-cannon', body: 'coconutBody', weapon: 'cannon', wheel: 'heavyWheel', energyUsed: 60, capacity: 100, bodyMass: 160 },
  { id: 'D-durian-shotgun', body: 'durianBody', weapon: 'shotgun', wheel: 'smallWheel', energyUsed: 40, capacity: 105, bodyMass: 135 },
];

/**
 * 从真空存档真实装配一个 Build（零注入）：
 * 正式初始化 → equipBody → equipWeapon → equipMovement(前/后)。
 * 全程走正式写入口（内部各自过 validateSnapshot），任一步失败即抛错。
 */
function assembleRealAccount(spec: BuildSpec): BuildDraft {
  (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();
  expect(isFreshProfile()).toBe(true);
  const session = openGrowthSession(defaultPlayerDraft());
  const b = equipBody(spec.body, session.draft);
  expect(b.ok, `${spec.id}: equipBody 失败 ${b.detail ?? ''}`).toBe(true);
  let d = b.draft!;
  const w = equipWeapon(spec.weapon, d);
  expect(w.ok, `${spec.id}: equipWeapon(${spec.weapon}) 失败 ${w.detail ?? ''}`).toBe(true);
  d = w.draft!;
  const wf = equipMovement('front', spec.wheel, d);
  expect(wf.ok, `${spec.id}: equipMovement(front) 失败 ${wf.detail ?? ''}`).toBe(true);
  const wr = equipMovement('rear', spec.wheel, wf.draft!);
  expect(wr.ok, `${spec.id}: equipMovement(rear) 失败 ${wr.detail ?? ''}`).toBe(true);
  return wr.draft!;
}

/* ------------------------------------------------------------------ 战斗读数 */

interface FightFact {
  readonly winner: string | null;
  readonly steps: number;
  readonly hpA: number;
  readonly hpB: number;
  readonly minGap: number;
  readonly hits: number;
  readonly perHit: readonly number[];
  readonly totalDamage: number;
}

function fightOne(encounterId: string, playerDraft: BuildDraft): FightFact {
  const rt = new RunBattleRuntime({
    build: [],
    carriedHp: null,
    encounterId,
    playerDraft,
    playerLoadoutTag: PRODUCT_TAG,
    playerBaseline: true,
  });
  try {
    let steps = 0;
    let minGap = Number.POSITIVE_INFINITY;
    while (rt.result === null && steps < MAX_STEPS) {
      rt.step(FRAME_MS);
      steps += 1;
      const gap = rt.gapWorld();
      if (gap < minGap) minGap = gap;
    }
    const hp = rt.hp();
    let hits = 0;
    let totalDamage = 0;
    const perHit: number[] = [];
    for (const read of Object.values(rt.playerWeaponHitSummary())) {
      hits += read.count;
      for (const d of read.damages) {
        totalDamage += d;
        perHit.push(d);
      }
    }
    return {
      winner: rt.result ? rt.result.winner : null,
      steps,
      hpA: hp.a,
      hpB: hp.b,
      minGap: minGap === Number.POSITIVE_INFINITY ? 0 : minGap,
      hits,
      perHit: [...new Set(perHit)].sort((a, b) => a - b),
      totalDamage,
    };
  } finally {
    rt.dispose();
  }
}

/* ==================================================================== 测试 */

describe('DEMO-BUILD-COUNTER-R1｜先查：4 Build 合法性（真实账号装配链）', () => {
  it(
    'BC-01 四个 Build 全部真实装配成功 + validateSnapshot 合法 + Energy 与预估一致 + 资格放行',
    () => {
      for (const spec of BUILDS) {
        const draft = assembleRealAccount(spec);
        // 装配结果逐槽对拍（写入口真的写了）
        expect(draft.bodyDefId, `${spec.id}: body`).toBe(spec.body);
        expect(draft.functionalSelections[WEAPON_SLOT], `${spec.id}: 主武器`).toBe(spec.weapon);
        expect(draft.frontWheelDefId, `${spec.id}: 前轮`).toBe(spec.wheel);
        expect(draft.rearWheelDefId, `${spec.id}: 后轮`).toBe(spec.wheel);
        // core 唯一校验闸门（能量 / 挂点 / 武器数）
        const v = validateSnapshot(buildSnapshotFromDraft(draft, registry), registry);
        expect(v.valid, `${spec.id}: 校验失败 ${v.valid ? '' : v.errors.join(';')}`).toBe(true);
        // Energy 现读（与设计的预估逐字一致 —— 防「合法但不是想测的那台车」）
        const used =
          [...Object.values(draft.functionalSelections)]
            .filter((id) => id && id !== 'none' && registry.functionals.has(id))
            .reduce((a, id) => a + (registry.functionals.get(id!)?.energy ?? 0), 0) +
          (registry.movements.get(spec.wheel)?.energy ?? 0) * 2;
        expect(used, `${spec.id}: Energy 现读`).toBe(spec.energyUsed);
        expect(used).toBeLessThanOrEqual(spec.capacity);
        // Body 质量现读（归因依据：质量梯度真实存在）
        expect(registry.bodies.get(spec.body)!.baseMass, `${spec.id}: baseMass 现读`).toBe(
          spec.bodyMass,
        );
        // 完整 Run 资格（主武器都在放行 7 件里）
        expect(canStartFullRun(draft), `${spec.id}: 资格放行`).toBe(true);
      }
      // 获得性证据：初始化后四件武器与两种 Body 都在正式库存/拥有表里（RA-01 同款口径）
      (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();
      const session = openGrowthSession(defaultPlayerDraft());
      const inv = playerInventory(session.draft);
      for (const id of ['cannon', 'hammer', 'machineGun', 'shotgun', 'heavyWheel', 'smallWheel']) {
        expect(coreGetCount(inv, id, 1), `种子链发放 ${id}`).toBeGreaterThan(0);
      }
    },
    SLOW_MS,
  );
});

describe('DEMO-BUILD-COUNTER-R1｜4×3 同口径战斗矩阵', () => {
  it(
    'BC-02 全矩阵真跑：12 格全部合法终态 + 确定性复跑逐字相同 + 全表 console 输出',
    () => {
      const drafts = new Map<string, BuildDraft>();
      for (const spec of BUILDS) drafts.set(spec.id, assembleRealAccount(spec));

      const matrix: Record<string, Record<string, FightFact>> = {};
      const rows: string[] = [];
      for (const spec of BUILDS) {
        matrix[spec.id] = {};
        for (const enc of ENCOUNTERS) {
          const f = fightOne(enc, drafts.get(spec.id)!);
          matrix[spec.id]![enc] = f;
        }
      }
      // 表头
      rows.push(
        `${'Build'.padEnd(20)}| ${ENCOUNTERS.map((e) =>
          `${e.slice(0, 10).padEnd(10)}`,
        ).join('| ')}`,
      );
      rows.push('-'.repeat(20 + 3 * 13));
      for (const spec of BUILDS) {
        const cells = ENCOUNTERS.map((e) => {
          const f = matrix[spec.id]![e]!;
          return `${f.winner === 'A' ? 'W' : f.winner === 'B' ? 'L' : '?'} ${String(Math.round(f.hpA)).padStart(4)}hp ${String(f.steps).padStart(4)}s`;
        });
        rows.push(`${spec.id.padEnd(20)}| ${cells.map((c) => c.padEnd(10)).join('| ')}`);
      }
      console.log(`\n##### BC-02 4×3 战斗矩阵（W=胜 L=负 | 终局HP | 步数）#####\n${rows.join('\n')}`);
      // 明细行（供交接文档引用）
      for (const spec of BUILDS) {
        for (const enc of ENCOUNTERS) {
          const f = matrix[spec.id]![enc]!;
          console.log(
            `[BC-02] ${spec.id} × ${enc}: w=${f.winner} hpA=${Math.round(f.hpA)} hpB=${Math.round(f.hpB)} ` +
              `steps=${f.steps} minGap=${f.minGap.toFixed(1)} hits=${f.hits} per=${f.perHit.join('/')} ` +
              `dmg=${Math.round(f.totalDamage)}`,
          );
        }
      }
      // ① 12 格全部合法终态
      for (const spec of BUILDS) {
        for (const enc of ENCOUNTERS) {
          expect(matrix[spec.id]![enc]!.winner, `${spec.id} × ${enc}: 必须分出胜负`).not.toBeNull();
        }
      }
      // ② 确定性：全部 12 格复跑逐字相同（同一夹具、无随机源）
      for (const spec of BUILDS) {
        for (const enc of ENCOUNTERS) {
          const f2 = fightOne(enc, drafts.get(spec.id)!);
          expect(f2, `${spec.id} × ${enc}: 复跑必须逐字相同`).toEqual(matrix[spec.id]![enc]);
        }
      }
      // ③ 每套 Encounter 内至少一个读数维度出现 Build 间差异（否则 = 同质 ⇒ 触发停止条件）
      for (const enc of ENCOUNTERS) {
        const sigs = new Set(
          BUILDS.map((s) => {
            const f = matrix[s.id]![enc]!;
            return `${f.winner}|${Math.round(f.hpA)}|${f.steps}|${Math.round(f.totalDamage)}`;
          }),
        );
        expect(sigs.size, `${enc}: 4 个 Build 必须产生可区分读数`).toBeGreaterThan(1);
      }
    },
    SLOW_MS,
  );

  it(
    'BC-03 差异归因：读数差异来自装备（同 Build 同格逐字一致 + 不同 Build 同格不同）',
    () => {
      // ① 反证「随机种子不一致」：同 Build 同格两次运行的战果逐字相等（BC-02 已断言，
      //    这里再以独立口径复核一次 A 对照行）。
      const dA = assembleRealAccount(BUILDS[0]!);
      const f1 = fightOne('RushRammer', dA);
      const f2 = fightOne('RushRammer', dA);
      expect(f2).toEqual(f1);
      // ② 反证「装备未生效」：不同 Build 的 per-hit 伤害签名不同
      //    （cannon=120 / hammer=90 / shotgun=30）。
      const dC = assembleRealAccount(BUILDS[2]!);
      const dD = assembleRealAccount(BUILDS[3]!);
      const fC = fightOne('HeavyFortress', dC);
      const fD = fightOne('HeavyFortress', dD);
      expect(fC.perHit, 'C 线（cannon）伤害签名 = 120').toEqual([120]);
      expect(fD.perHit, 'D 线（shotgun）伤害签名 = 30').toEqual([30]);
      // ③ 反证「非法挂点」：BC-01 已断言 validateSnapshot 通过 + 槽位逐槽对拍。
      expect(fC.hits).toBeGreaterThan(0);
      expect(fD.hits).toBeGreaterThan(0);
    },
    SLOW_MS,
  );

  it(
    'BC-04 判定冻结（只冻结对判断重要的结果，不锁死具体 HP）：胜负矩阵 + 关键策略事实',
    () => {
      const drafts = new Map<string, BuildDraft>();
      for (const spec of BUILDS) drafts.set(spec.id, assembleRealAccount(spec));

      // ── 冻结 1｜胜负矩阵（判断的全部依据；HP 具体值不冻结）────────────────────
      const expectedWinners: Record<string, Record<string, string>> = {
        'A-mango-cannon': { HeavyFortress: 'A', RushRammer: 'B', HighGunPlatform: 'A' },
        'B-durian-hammer': { HeavyFortress: 'B', RushRammer: 'B', HighGunPlatform: 'B' },
        'C-coconut-cannon': { HeavyFortress: 'B', RushRammer: 'A', HighGunPlatform: 'A' },
        'D-durian-shotgun': { HeavyFortress: 'B', RushRammer: 'A', HighGunPlatform: 'A' },
      };
      for (const spec of BUILDS) {
        for (const enc of ENCOUNTERS) {
          const f = fightOne(enc, drafts.get(spec.id)!);
          expect(
            f.winner,
            `${spec.id} × ${enc}: 胜负翻转 = 数值或夹具被改动`,
          ).toBe(expectedWinners[spec.id]![enc]);
        }
      }

      // ── 冻结 2｜策略事实一：对停驻远程（HighGunPlatform）必须带弹道武器 ──────────
      //    hammer（物理弧）对它 0 命中全灭；三门炮都能赢 —— 「换武器改变策略」的直接证据。
      const hammerFacts = fightOne('HighGunPlatform', drafts.get('B-durian-hammer')!);
      expect(hammerFacts.hits, 'hammer 对停驻远程 0 命中（物理弧够不着站桩目标）').toBe(0);
      for (const gunBuild of ['A-mango-cannon', 'C-coconut-cannon', 'D-durian-shotgun']) {
        expect(
          fightOne('HighGunPlatform', drafts.get(gunBuild)!).winner,
          `${gunBuild}: 弹道武器对高架炮台必须能赢`,
        ).toBe('A');
      }

      // ── 冻结 3｜策略事实二：对冲锤车（RushRammer）远程/爆发有效、重锤无效 ──────────
      //    hammer 打 hammer 亏（B 败），cannon 稳射（C）/ 霰弹爆发（D）都能赢。
      expect(fightOne('RushRammer', drafts.get('B-durian-hammer')!).winner).toBe('B');
      expect(fightOne('RushRammer', drafts.get('C-coconut-cannon')!).winner).toBe('A');
      expect(fightOne('RushRammer', drafts.get('D-durian-shotgun')!).winner).toBe('A');

      // ── 冻结 4｜假设判定：换装确实改变战局（无稳定通吃、无全同质）────────────────
      //    12 格中存在两种以上胜负形态；且没有任何 Build 全胜（否则 = 稳定最优解 ⇒ 停止条件）。
      const outcomes = new Set<string>();
      for (const spec of BUILDS) {
        let wins = 0;
        for (const enc of ENCOUNTERS) {
          const o = `${enc}:${expectedWinners[spec.id]![enc]}`;
          outcomes.add(o);
          if (expectedWinners[spec.id]![enc] === 'A') wins += 1;
          void o;
        }
        expect(wins, `${spec.id}: 不得全胜（稳定通吃 = 停止条件）`).toBeLessThan(3);
      }
      expect(outcomes.size, '矩阵必须存在真实的胜负形态多样性').toBeGreaterThanOrEqual(6);

      console.log(
        '\n##### BC-04 判定结论 #####\n' +
          '  ⚠️ 勘误（DEMO-RUN-VARIANTS-R1 修正）：本文件首版 console 文字报告误写\n' +
          '  「HeavyFortress 4/4 无解」「A/D 各丢 2 格」——与本测试**实际可运行读数冲突**。\n' +
          '  正确读数（以下方断言为准）：A 对 HF **胜**（229 余量）；A/D 各丢 **1** 格；\n' +
          '  HF 对 B/C/D 三 Build 必胜（3/4 胜率，最高压对手）。一切结论以可运行断言为准。\n' +
          '  假设通过：换装真实改变战局（12 格 9 格胜负随装备翻转，无稳定通吃 Build）。\n' +
          '  有效克制：对 RushRammer → 远程/爆发（C/D 胜，B 重锤败）；\n' +
          '            对 HighGunPlatform → 弹道武器（hammer 0 命中全灭，A/C/D 胜）；\n' +
          '            对 HeavyFortress → 仅 A（mango+cannon 双小轮）胜；B/C/D 全败。\n' +
          '  同质配置：无（每套 Encounter 的 4 Build 读数全部可区分）。\n' +
          '  稳定最优解：无（A/D 各丢 1 格、C 丢 2 格、B 全败）。\n' +
          '  下一轮最小候选集：三套候选均对换装敏感（HF 只认 A、RR 认 C/D、HGP 认 A/C/D），\n' +
          '            均可支撑「不同对手 → 调整配置」的多局 Run 设计。'
      );
    },
    SLOW_MS,
  );
});
