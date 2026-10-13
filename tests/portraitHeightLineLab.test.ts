/**
 * DEMO-HEIGHT-LINE-VISUAL-LAB-R1｜车高 × 水平弹道对照台的守门测试。
 *
 * ── 这份测试回答什么（Queue 必改 4 / 验收 3）────────────────────────────────
 *
 *   ① **三配置是合法的**：不是手写常量 —— 用**正式装配链**（`openGrowthSession` +
 *      `equipBody` / `equipWeapon` / `equipMovement`，过 Energy 容量与库存拥有判据）
 *      在 `MemStorage` 桩上重新生成，断言**逐字段等于**页面消费的那份快照；
 *   ② **切配置无残留**：上一场（真有弹丸 / 接触）被 dispose 之后，新建的那一场必须
 *      从「步数 0 / 0 弹丸 / 无接触·命中·伤害 / 满耐久 / 空 Build」开始，
 *      且**是另一个对象**（不是复用）—— 页面侧的 `selectConfig` 也有源码级顺序断言；
 *   ③ **三套配置的真实枪弹命中差异可复现**：同车身同炮，只换轮径 ⇒ 「被小口径弹命中」
 *      的次数从 0 变成几十次；复跑逐字节相同；
 *   ④ **刺墙击杀与武器命中有实际来源**：敌方掉血里既有真实武器伤害，又有**恰好等于**
 *      `DEFAULT_ARENA_CONFIG.hazardDamagePerTick` 的等周期脉冲，且脉冲**全部出现在
 *      收束阶段开始之后**（不是别的东西凑出来的 40）；
 *   ⑤ **原正式默认 Run 不回归**：默认三段链仍是 `ProtoRusher → Chaser → RangedTurret`，
 *      且冻结读数一字不变。
 *
 * ⚠️ 本文件**不回答**「真人能不能看出那 4px」——那是真人录屏的判据（Queue 停止条件②）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { DEFAULT_ARENA_CONFIG } from '../src/battle/arenaConfig';
import { registry } from '../src/core/content';
import { canEquipBody } from '../src/core/bodyOwnership';
import { getCount as coreGetCount } from '../src/core/partInventory';
import type { BuildDraft } from '../src/lab/buildEditorModel';
import {
  HEIGHT_LINE_ACTION_BAND,
  HEIGHT_LINE_BANDS,
  HEIGHT_LINE_BATTLE_BAND,
  HEIGHT_LINE_BATTLE_BAND_H,
  HEIGHT_LINE_CLOSE_MAX_SUPERSAMPLE,
  HEIGHT_LINE_CLOSE_ROOF_FRAC,
  HEIGHT_LINE_CLOSE_WORLD_W,
  HEIGHT_LINE_CONFIGS,
  HEIGHT_LINE_LOG_BAND,
  HEIGHT_LINE_OPPONENT_ID,
  HEIGHT_LINE_TOP_BAND,
  HEIGHT_LINE_TOP_BAND_H,
  HEIGHT_LINE_WEAPON_SLOT,
  heightLineAssemblyFacts,
  heightLineCloseSupersample,
  heightLineCloseWindow,
  heightLineConfigsProblems,
  type HeightLineConfigId,
} from '../src/lab/portraitBattleLab/heightLineConfigs';
import {
  RUN_ACTION_BAND_H,
  RUN_BANDS,
  RUN_LOG_BAND_H,
  RUN_PAGE_H,
  RUN_PAGE_W,
  RUN_STAGE_BAND,
  RUN_TOP_BAND_H,
} from '../src/lab/portraitBattleLab/runPageLayout';
import {
  RUN_BATTLE_VIEW_H,
  RUN_BATTLE_VIEW_INSET,
  RUN_BATTLE_VIEW_W,
  RunBattleRuntime,
} from '../src/lab/portraitBattleLab/runBattleRuntime';
import { RUN_SCRIPT } from '../src/lab/portraitBattleLab/runScript';
import { LAB_ENCOUNTERS, findEncounter } from '../src/lab/portraitBattleLab/testData';
import {
  createRunPageState,
  finishRunBattle,
  runBuildIds,
  runCarriedPlayerHp,
  runCurrentNode,
  pressRunAction,
  chooseRunBuff,
  runChoicePool,
  runComplete,
  type RunPageContext,
  type RunPageState,
} from '../src/lab/portraitBattleLab/runPageState';
import { runPageContext } from '../src/lab/portraitBattleLab/runPageScene';
import {
  defaultPlayerDraft,
  equipBody,
  equipMovement,
  equipWeapon,
  playerInventory,
} from '../src/product/playerLoadout';
import { isFreshProfile, openGrowthSession } from '../src/product/playerGrowth';

const LAB_DIR = join(process.cwd(), 'src', 'lab', 'portraitBattleLab');
const REPO_ROOT = process.cwd();

function readLab(f: string): string {
  return readFileSync(join(LAB_DIR, f), 'utf8');
}
/** 源码守卫先剥注释（本项目铁律：注释里的自指文字会骗过字符串匹配）。 */
function strip(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

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

const FRAME_MS = 1000 / 60;
const MAX_STEPS = 4000;
const SLOW_MS = 600_000;

/**
 * **正式装配链**（与页面上那三套配置的产出同源）。
 *
 * 用全新账号（`MemStorage` 桩 + `isFreshProfile()`）跑正式写入口：
 * 挂点合法性 / Energy 容量 / **库存拥有** 三条判据全部由 `src/product/playerLoadout` 裁决。
 */
function assembleViaFormalChain(wheel: string): BuildDraft {
  (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();
  expect(isFreshProfile()).toBe(true);
  const session = openGrowthSession(defaultPlayerDraft());
  const b = equipBody('mangoBody', session.draft);
  expect(b.ok, `equipBody(mangoBody): ${b.detail ?? ''}`).toBe(true);
  const w = equipWeapon('cannon', b.draft!);
  expect(w.ok, `equipWeapon(cannon): ${w.detail ?? ''}`).toBe(true);
  const wf = equipMovement('front', wheel, w.draft!);
  expect(wf.ok, `equipMovement(front,${wheel}): ${wf.detail ?? ''}`).toBe(true);
  const wr = equipMovement('rear', wheel, wf.draft!);
  expect(wr.ok, `equipMovement(rear,${wheel}): ${wr.detail ?? ''}`).toBe(true);
  return wr.draft!;
}

/* ------------------------------------------- 与页面**同口径**的单场战斗读数 */

interface HitEvent {
  readonly atMs: number;
  readonly amount: number;
  readonly target: 'A' | 'B';
}

interface BattleFact {
  readonly configId: HeightLineConfigId;
  readonly winner: string | null;
  readonly timeMs: number;
  readonly steps: number;
  readonly hpA: number;
  readonly hpA0: number;
  readonly hpB: number;
  readonly hpB0: number;
  readonly weaponHitCount: number;
  readonly weaponDamage: number;
  readonly boxAMinY: number;
  readonly enemyBulletYMedian: number;
  readonly events: readonly HitEvent[];
}

/** 页面口径：零 Build / 满耐久 / 正式玩家炮基线 / 既有对手。 */
function runConfig(draft: BuildDraft, configId: HeightLineConfigId): BattleFact {
  const rt = new RunBattleRuntime({
    build: [],
    carriedHp: null,
    encounterId: HEIGHT_LINE_OPPONENT_ID,
    playerDraft: draft,
    playerLoadoutTag: 'height-line-lab',
    playerBaseline: true,
  });
  try {
    const hp0 = rt.hp();
    const boxA = rt.vehicleBox('A');
    const events: HitEvent[] = [];
    const ys: number[] = [];
    let prevA = hp0.a;
    let prevB = hp0.b;
    let steps = 0;
    while (rt.result === null && steps < MAX_STEPS) {
      rt.step(FRAME_MS);
      steps += 1;
      const hp = rt.hp();
      if (hp.a < prevA) events.push({ atMs: rt.timeMs, amount: prevA - hp.a, target: 'A' });
      if (hp.b < prevB) events.push({ atMs: rt.timeMs, amount: prevB - hp.b, target: 'B' });
      prevA = hp.a;
      prevB = hp.b;
      for (const p of rt.snapshot().projectiles ?? []) if (p.team === 'B') ys.push(p.center.y);
    }
    const hp = rt.hp();
    const summary = rt.playerWeaponHitSummary();
    let weaponHitCount = 0;
    let weaponDamage = 0;
    for (const s of Object.values(summary)) {
      weaponHitCount += s.count;
      weaponDamage += s.damages.reduce((a, b) => a + b, 0);
    }
    const sorted = [...ys].sort((a, b) => a - b);
    return {
      configId,
      winner: (rt.result?.winner ?? null) as string | null,
      timeMs: rt.timeMs,
      steps: rt.stepCount,
      hpA: hp.a,
      hpA0: hp0.a,
      hpB: hp.b,
      hpB0: hp0.b,
      weaponHitCount,
      weaponDamage,
      boxAMinY: boxA.minY,
      enemyBulletYMedian:
        sorted.length === 0 ? Number.NaN : sorted.length % 2
          ? sorted[(sorted.length - 1) / 2]!
          : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2,
      events,
    };
  } finally {
    rt.dispose();
  }
}

/** 单发弹丸伤害（现读真源，不写死 20 / 80）。 */
function projectileDamage(id: string): number {
  return (
    (registry.functionals.get(id)?.behaviorParams as { projectileDamage?: number } | undefined)
      ?.projectileDamage ?? 0
  );
}

function countAmount(events: readonly HitEvent[], target: 'A' | 'B', amount: number): number {
  return events.filter((e) => e.target === target && Math.abs(e.amount - amount) < 0.01).length;
}

function draftsOf(): readonly { id: HeightLineConfigId; wheel: string; draft: BuildDraft }[] {
  return HEIGHT_LINE_CONFIGS.map((c) => ({
    id: c.id,
    wheel: c.wheelDefId,
    draft: assembleViaFormalChain(c.wheelDefId),
  }));
}

/* ================================================================== A. 形状 */

describe('DEMO-HEIGHT-LINE｜A. 配置形状与对手（只换轮径，不新增敌人）', () => {
  it('HL-01 三套配置自检通过 + 轮径互不相同 + 前后轮同款', () => {
    expect(HEIGHT_LINE_CONFIGS).toHaveLength(3);
    expect(HEIGHT_LINE_CONFIGS.map((c) => c.wheelDefId)).toEqual([
      'smallWheel',
      'heavyWheel',
      'largeWheel',
    ]);
    expect(heightLineConfigsProblems()).toEqual([]);
    const facts = heightLineAssemblyFacts();
    // 轮径由 def 自身给出（页面展示的 r 值不是写死的）
    expect(facts.map((f) => f.wheelRadius)).toEqual([
      registry.movements.get('smallWheel')!.radius,
      registry.movements.get('heavyWheel')!.radius,
      registry.movements.get('largeWheel')!.radius,
    ]);
    // Energy 现读：三套都在机身容量内
    for (const f of facts) {
      expect(f.energyUsed, `${f.id} energy`).toBeLessThanOrEqual(f.energyCapacity);
    }
    expect(facts.map((f) => f.energyUsed)).toEqual([40, 60, 54]);
    expect(facts.every((f) => f.energyCapacity === 95)).toBe(true);
  });

  it('HL-02 对手是既有 RangedTurret（不是新敌人、不改任何定义）', () => {
    expect(HEIGHT_LINE_OPPONENT_ID).toBe('RangedTurret');
    expect(LAB_ENCOUNTERS.some((e) => e.id === HEIGHT_LINE_OPPONENT_ID)).toBe(true);
    const entry = findEncounter(HEIGHT_LINE_OPPONENT_ID)!;
    expect(entry.templateId).toBe('OPP-03');
    expect(entry.count).toBe(1);
    // 本 Queue 不新增 Encounter：目录仍是 10 套
    expect(LAB_ENCOUNTERS).toHaveLength(10);
  });

  it('HL-03 源码级：页面/控制器不按轮径做任何判定，也不出现伪造手段', () => {
    const page = strip(readLab('heightLineLab.ts'));
    // ① 页面**不得**按轮径分支（「哪套更好」只能由真人看画面判断）
    for (const wheel of ['smallWheel', 'heavyWheel', 'largeWheel']) {
      expect(page.includes(wheel), `页面不得写死/分支轮径 ${wheel}`).toBe(false);
    }
    // ② 不得出现无敌 / 强制结算 / 改伤害 之类伪造差异的手段
    for (const banned of [
      'invincible',
      'godMode',
      'noDamage',
      'forceResult',
      'hp.a =',
      'hp.b =',
      'damageResolver',
      'contactRouter',
      'planckBattleOrchestrator',
      'new PlanckBattleOrchestrator',
    ]) {
      expect(page.includes(banned), `页面不得出现 "${banned}"`).toBe(false);
    }
    // ③ 口径必须与测试同源：零 Build / 满耐久 / 正式玩家炮基线 / 既有 playerDraft 入口
    expect(page.includes('playerDraft: cfg.draft')).toBe(true);
    expect(page.includes('playerBaseline: true')).toBe(true);
    expect(page.includes('build: []')).toBe(true);
    expect(page.includes('carriedHp: null')).toBe(true);
    expect(page.includes('encounterId: HEIGHT_LINE_OPPONENT_ID')).toBe(true);
    // ④ 「切配置」必须**先 dispose 再新建**（结构性无残留，不靠人工核对）
    const disposeAt = page.indexOf('this.disposeRuntime();');
    const createAt = page.indexOf('new RunBattleRuntime(');
    expect(disposeAt, 'selectConfig 必须先 disposeRuntime()').toBeGreaterThan(-1);
    expect(createAt, 'selectConfig 必须新建 RunBattleRuntime').toBeGreaterThan(-1);
    expect(disposeAt).toBeLessThan(createAt);
    // ⑤ 本页不接入正式 Run：不 import runPage* / runScript
    expect(page.includes('runPageState')).toBe(false);
    expect(page.includes('runScript')).toBe(false);
  });

  it('HL-04 三份快照 = 正式装配链的真实产出（不是手写常量）', () => {
    const rebuilt = draftsOf();
    for (const r of rebuilt) {
      const frozen = HEIGHT_LINE_CONFIGS.find((c) => c.id === r.id)!.draft;
      expect(r.draft, `${r.id}: 页面快照必须逐字段等于正式装配链产出`).toEqual(frozen);
      // 同车身 / 同炮 / 只换轮径
      expect(r.draft.bodyDefId).toBe('mangoBody');
      expect(r.draft.functionalSelections[HEIGHT_LINE_WEAPON_SLOT]).toBe('cannon');
      expect(r.draft.frontWheelDefId).toBe(r.wheel);
      expect(r.draft.rearWheelDefId).toBe(r.wheel);
    }
  });

  it('HL-05 三套配置的 Energy / 库存拥有判据都在真实存档上成立', () => {
    for (const c of HEIGHT_LINE_CONFIGS) {
      const draft = assembleViaFormalChain(c.wheelDefId);
      // 逐件 Energy 现读（与 validateSnapshot 同一口径）并在容量内
      const used =
        [...Object.values(draft.functionalSelections)]
          .filter((id) => id && id !== 'none' && registry.functionals.has(id))
          .reduce((a, id) => a + (registry.functionals.get(id!)?.energy ?? 0), 0) +
        (registry.movements.get(c.wheelDefId)?.energy ?? 0) * 2;
      expect(used).toBeLessThanOrEqual(registry.bodies.get('mangoBody')!.energyCapacity);
      // 库存拥有：车身由 R4/R5 种子解锁，武器与轮组计数 > 0
      (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();
      const session = openGrowthSession(defaultPlayerDraft());
      expect(canEquipBody('mangoBody'), 'mangoBody 由 R4+R5 种子解锁').toBe(true);
      expect(coreGetCount(playerInventory(session.draft), 'cannon', 1)).toBeGreaterThan(0);
      expect(
        coreGetCount(playerInventory(session.draft), c.wheelDefId, 1),
        `${c.wheelDefId} 由 R3 轮组种子发放`,
      ).toBeGreaterThan(0);
    }
  });
});

/* ============================================ B. 真实战果：切配置 / 差异 / 来源 */

describe('DEMO-HEIGHT-LINE｜B. 真实战果（同车身同炮，只换轮径）', () => {
  it(
    'HL-06 三套配置的真实枪弹命中差异可复现（复跑逐字节相同）',
    () => {
      const rebuilt = draftsOf();
      const facts = new Map<HeightLineConfigId, BattleFact>();
      const lines: string[] = [];
      for (const r of rebuilt) {
        const f = runConfig(r.draft, r.id);
        facts.set(r.id, f);
        lines.push(
          `  ${r.id.padEnd(12)} winner=${f.winner} t=${(f.timeMs / 1000).toFixed(2)}s ` +
            `玩家命中=${f.weaponHitCount} 玩家伤害=${f.weaponDamage} ` +
            `玩家受机枪弹=${countAmount(f.events, 'A', projectileDamage('machineGun'))} ` +
            `车顶=${f.boxAMinY.toFixed(1)} 敌弹中位=${f.enemyBulletYMedian.toFixed(1)} ` +
            `hpA=${f.hpA.toFixed(0)}/${f.hpA0} hpB=${f.hpB.toFixed(0)}/${f.hpB0}`,
        );
      }
      console.log(`\n##### HL-06 三配置真实战果（对手 ${HEIGHT_LINE_OPPONENT_ID}）#####\n${lines.join('\n')}`);

      const mg = projectileDamage('machineGun');
      expect(mg).toBe(20); // 现读真源：机枪单发 20

      const small = facts.get('mango-small')!;
      const heavy = facts.get('mango-heavy')!;
      const large = facts.get('mango-large')!;

      // ① 车顶随轮径**单调下降**，且下降量 = 轮半径差（几何来源可解释）
      expect(small.boxAMinY).toBeGreaterThan(heavy.boxAMinY);
      expect(heavy.boxAMinY).toBeGreaterThan(large.boxAMinY);
      const rSmall = registry.movements.get('smallWheel')!.radius;
      const rHeavy = registry.movements.get('heavyWheel')!.radius;
      const rLarge = registry.movements.get('largeWheel')!.radius;
      expect(small.boxAMinY - heavy.boxAMinY).toBeCloseTo(rHeavy - rSmall, 6);
      expect(heavy.boxAMinY - large.boxAMinY).toBeCloseTo(rLarge - rHeavy, 6);

      // ② 差异就是「小口径压制弹打不打得到」：小轮 0 次，重/大轮各几十次
      expect(countAmount(small.events, 'A', mg), '小轮：弹从车顶掠过 ⇒ 0 命中').toBe(0);
      expect(countAmount(heavy.events, 'A', mg)).toBeGreaterThan(20);
      expect(countAmount(large.events, 'A', mg)).toBeGreaterThan(20);
      // ③ 几何判据：胜者车顶**高于**敌弹弹线；败者车顶低于它
      expect(small.boxAMinY).toBeGreaterThan(small.enemyBulletYMedian);
      expect(heavy.boxAMinY).toBeLessThan(heavy.enemyBulletYMedian);
      expect(large.boxAMinY).toBeLessThan(large.enemyBulletYMedian);
      // ④ 胜负与命中互为印证
      expect([small.winner, heavy.winner, large.winner]).toEqual(['A', 'B', 'B']);
      expect(small.weaponHitCount).toBeGreaterThan(0);
      expect(heavy.weaponHitCount).toBe(0);
      expect(large.weaponHitCount).toBe(0);

      // ⑤ 复跑逐字节相同（同一条件可反复观察同一段弹道）
      const again = runConfig(rebuilt.find((r) => r.id === 'mango-small')!.draft, 'mango-small');
      expect(again).toEqual(small);
    },
    SLOW_MS,
  );

  it(
    'HL-07 刺墙击杀与武器命中有实际来源（不是别的东西凑出来的 40）',
    () => {
      const rebuilt = draftsOf();
      const small = runConfig(rebuilt.find((r) => r.id === 'mango-small')!.draft, 'mango-small');
      const heavy = runConfig(rebuilt.find((r) => r.id === 'mango-heavy')!.draft, 'mango-heavy');

      const tick = DEFAULT_ARENA_CONFIG.hazardDamagePerTick;
      const closingStartMs = DEFAULT_ARENA_CONFIG.phases.activeMs + DEFAULT_ARENA_CONFIG.phases.warningMs;
      const spikes = small.events.filter((e) => e.target === 'B' && Math.abs(e.amount - tick) < 0.01);
      const enemyLoss = small.hpB0 - small.hpB;
      const nonWeapon = enemyLoss - small.weaponDamage;
      console.log(
        `\n##### HL-07 终结来源 #####\n` +
          `  小轮：敌方掉血 ${enemyLoss.toFixed(0)} = 武器 ${small.weaponDamage.toFixed(0)} + 非武器 ${nonWeapon.toFixed(0)}\n` +
          `  尖刺脉冲(${tick}/次) ${spikes.length} 次，首次 ${spikes[0] ? (spikes[0].atMs / 1000).toFixed(2) : '—'}s` +
          `（收束起点 ${(closingStartMs / 1000).toFixed(2)}s）`,
      );

      // ① 武器命中确实造成了伤害（不是「纯靠墙」）
      expect(small.weaponHitCount).toBeGreaterThan(0);
      expect(small.weaponDamage).toBeGreaterThan(0);
      // ② 敌方掉血里存在等周期脉冲（= 场地收束尖刺），且**全部**在收束阶段开始之后
      expect(spikes.length).toBeGreaterThanOrEqual(3);
      expect(spikes[0]!.atMs).toBeGreaterThanOrEqual(closingStartMs);
      for (const s of spikes) expect(s.atMs).toBeGreaterThanOrEqual(closingStartMs);
      // ③ 尖刺贡献的伤害量级与脉冲数一致（40 × 次数 ≥ 非武器伤害的主体）
      expect(spikes.length * tick).toBeLessThanOrEqual(nonWeapon + tick);
      expect(nonWeapon).toBeGreaterThan(0);
      // ④ 重轮那一场**根本没走到收束阶段**（敌方零掉血 ⇒ 无脉冲）
      const heavySpikes = heavy.events.filter((e) => e.target === 'B');
      expect(heavySpikes).toHaveLength(0);
      expect(heavy.hpB).toBe(heavy.hpB0);
    },
    SLOW_MS,
  );

  it('HL-08 切配置无残留：新一场从干净开局开始，且不是复用同一个运行时', () => {
    const rebuilt = draftsOf();
    const a = rebuilt.find((r) => r.id === 'mango-small')!;
    const b = rebuilt.find((r) => r.id === 'mango-heavy')!;

    // 第一场：真的推进到有弹丸 / 有接触残留
    const rtA = new RunBattleRuntime({
      build: [],
      carriedHp: null,
      encounterId: HEIGHT_LINE_OPPONENT_ID,
      playerDraft: a.draft,
      playerLoadoutTag: 'height-line-lab',
      playerBaseline: true,
    });
    let aLive = 0;
    let aSteps = 0;
    while (rtA.result === null && aSteps < MAX_STEPS) {
      rtA.step(FRAME_MS);
      aSteps += 1;
      if (rtA.projectileCount() > 0) aLive += 1;
    }
    expect(rtA.stepCount).toBeGreaterThan(0);
    expect(aLive, '第一场必须真的出现过存活弹丸').toBeGreaterThan(0);
    const residueA = rtA.contactResidue();
    expect(residueA.damage || residueA.impact || residueA.contact, '第一场确实交过火').toBe(true);
    rtA.dispose();

    // 第二场：换配置 → 新实例，且开局读数是干净的
    const rtB = new RunBattleRuntime({
      build: [],
      carriedHp: null,
      encounterId: HEIGHT_LINE_OPPONENT_ID,
      playerDraft: b.draft,
      playerLoadoutTag: 'height-line-lab',
      playerBaseline: true,
    });
    expect(rtB).not.toBe(rtA);
    const hpB = rtB.hp();
    expect(rtB.stepCount).toBe(0);
    expect(rtB.timeMs).toBe(0);
    expect(rtB.projectileCount()).toBe(0);
    expect(rtB.contactResidue()).toEqual({ contact: false, impact: false, damage: false });
    expect(rtB.result).toBeNull();
    expect(hpB.a).toBe(hpB.aMax); // 满耐久（跨配置不携带上一场的耐久）
    expect([...rtB.build]).toEqual([]); // 零 Run Buff
    expect(rtB.encounterId).toBe(HEIGHT_LINE_OPPONENT_ID); // 对手恒定，只有轮径变
    // 第一场确实留下了接触 / 伤害记录 ⇒ 第二场的「全 false」是**新实例**的读数，不是空转
    rtB.dispose();
  });
});

/* ============================================ C. 原正式默认 Run 不回归 */

describe('DEMO-HEIGHT-LINE｜C. 原正式默认 Run 不回归', () => {
  it('HL-09 默认三段链仍是 ProtoRusher → Chaser → RangedTurret', () => {
    const battleIds = RUN_SCRIPT.filter((n) => n.kind === 'BATTLE' || n.kind === 'FINAL').map(
      (n) => n.encounterId,
    );
    expect(battleIds).toEqual(['ProtoRusher', 'Chaser', 'RangedTurret']);
    // 本 Queue 不动路线覆盖表
    const script = strip(readLab('runScript.ts'));
    expect(script.includes("'d2-battle1': 'HeavyFortress'")).toBe(true);
    expect(script.includes("'d2-battle1': 'ProtoRusher'")).toBe(true);
  });

  it(
    'HL-10 默认路线（mango+cannon+双小轮 + fastReload→emergencyRepair）三段 COMPLETE 读数冻结',
    () => {
      const draft = assembleViaFormalChain('smallWheel');
      const ctx: RunPageContext = runPageContext(
        {
          source: 'profile',
          label: 'HL/default',
          draft,
          tag: 'profile-equipped',
          key: 'hl|default',
        },
        undefined,
      );
      const picks = ['fastReload', 'emergencyRepair'];
      const segs: { enc: string; hpA0: number; hpA: number; winner: string | null }[] = [];
      let s: RunPageState = createRunPageState(ctx);
      let carry: number | null = null;
      for (let guard = 0; guard < 40; guard++) {
        if (s.phase === 'COMPLETE' || s.phase === 'FAILED') break;
        const before = s;
        if (s.phase === 'BATTLE') {
          const node = runCurrentNode(s);
          const rt = new RunBattleRuntime({
            build: [...runBuildIds(s)],
            carriedHp: carry,
            encounterId: node.encounterId!,
            playerDraft: draft,
            playerLoadoutTag: 'profile-equipped',
            playerBaseline: true,
          });
          try {
            const at0 = rt.hp();
            let steps = 0;
            while (rt.result === null && steps < MAX_STEPS) {
              rt.step(FRAME_MS);
              steps += 1;
            }
            const hp = rt.hp();
            segs.push({
              enc: node.encounterId!,
              hpA0: at0.a,
              hpA: hp.a,
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
          expect(pool as readonly string[]).toContain(pick);
          s = chooseRunBuff(s, pick, ctx);
          continue;
        }
        if (s.phase === 'EVENT') carry = runCarriedPlayerHp(s);
        s = pressRunAction(s, ctx);
        if (s === before) break;
      }
      console.log(
        `\n##### HL-10 默认路线 #####\n  ${segs
          .map((x) => `${x.enc} ${x.hpA0.toFixed(0)}→${x.hpA.toFixed(0)} winner=${x.winner}`)
          .join('\n  ')}\n  phase=${s.phase} complete=${runComplete(s)}`,
      );
      // 与 DEMO-PLAYABLE-PATH-R1 的 D-02 冻结读数逐值一致（本 Queue 零产品改动）
      expect(segs.map((x) => x.enc)).toEqual(['ProtoRusher', 'Chaser', 'RangedTurret']);
      expect(segs[0]!.hpA).toBeCloseTo(529.2702747034114, 6);
      expect(segs[1]!.hpA).toBeCloseTo(525.6192468960885, 6);
      expect(segs[2]!.hpA).toBeCloseTo(203.4334446872902, 6);
      expect(segs.every((x) => x.winner === 'A')).toBe(true);
      expect(s.phase).toBe('COMPLETE');
      expect(runComplete(s)).toBe(true);
    },
    SLOW_MS,
  );
});

/* ============================================ D. 入口登记（本地启动入口） */

describe('DEMO-HEIGHT-LINE｜D. 入口登记', () => {
  it('HL-11 页面入口 / 构建入口 / 开发 script 三处都在（且不进入正式构建）', () => {
    expect(existsSync(join(REPO_ROOT, 'height-line-lab.html'))).toBe(true);
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['dev:height-line-lab']).toBe('vite --open=/height-line-lab.html');
    const viteCfg = readFileSync(join(REPO_ROOT, 'vite.portrait-lab.config.ts'), 'utf8');
    expect(viteCfg.includes("'height-line-lab': 'height-line-lab.html'")).toBe(true);
    // 不进入任何正式构建入口
    const mainCfg = readFileSync(join(REPO_ROOT, 'vite.config.ts'), 'utf8');
    expect(mainCfg.includes('height-line-lab')).toBe(false);
    const pagesCfg = readFileSync(join(REPO_ROOT, 'vite.pages.config.ts'), 'utf8');
    expect(pagesCfg.includes('height-line-lab')).toBe(false);
  });
});

/* ================================ E. 可读性强化（R2：布局 + 近景取景） */

/**
 * ── 这一组回答什么（`DEMO-HEIGHT-LINE-READABILITY-R2` 必改 1 / 验收 1~2）─────
 *
 *   R1 已证明机制成立（小轮 0 命中、重轮 41 命中），但**官方取景下看不出**：
 *   官方 battle 相机 `scale` 实测只有 **0.41 ~ 0.64**（世界 px → 画布逻辑 px，S=1 等效），
 *   而「小轮车顶 645 vs 敌弹线 ≈641.3」只差 **3.7 个世界像素** ⇒ 屏上只有约 1.5 逻辑像素。
 *
 *   R2 的两个手段，本组给它们**机器判据**（不是「看起来变大了」）：
 *     ① **Lab 本地四带**：把中部战场带 302 → 344（只动本页，正式 `runPageLayout` 一字不改）；
 *     ② **近景裁切合成**：用一个**固定世界宽**（`HEIGHT_LINE_CLOSE_WORLD_W`）的窗，
 *        锚在玩家**车顶**，把官方相机渲染出的同一批像素裁一块铺满战场带
 *        ⇒ 显示密度恒定 `390 / 170 ≈ 2.294 显示px/世界px`，且**与轮径无关**
 *        （三套配置是同一把尺子量出来的对照）。
 *
 *   ⚠️ 本组**不**回答「真人是否真能看出」——那仍属真人体感（Queue 停止条件②）。
 *      这里只回答「同一个世界像素现在被摊到几个显示像素」这个可计算的事实。
 */

/** 近景窗的期望世界高（= 固定世界宽 × 战场带宽高比；等比 ⇒ 车轮不会被拉扁）。 */
function closeWorldH(): number {
  return (HEIGHT_LINE_CLOSE_WORLD_W * HEIGHT_LINE_BATTLE_BAND.h) / HEIGHT_LINE_BATTLE_BAND.w;
}

describe('DEMO-HEIGHT-LINE-R2｜E. 可读性强化（布局 + 近景取景）', () => {
  it('HL-12 Lab 本地四带连续铺满，且**正式** Run 四带一字未动', () => {
    // ① 正式 Run 布局仍是原样（本 Queue 不得触碰产品页面）
    expect(RUN_TOP_BAND_H).toBe(80);
    expect(RUN_STAGE_BAND.h).toBe(302);
    expect(RUN_LOG_BAND_H).toBe(378);
    expect(RUN_ACTION_BAND_H).toBe(84);
    let formalCursor = 0;
    for (const b of RUN_BANDS) {
      expect(b.y).toBe(formalCursor);
      formalCursor = b.y + b.h;
    }
    expect(formalCursor).toBe(RUN_PAGE_H);

    // ② Lab 本地四带：连续、同宽、合计 = 页面高（结构上不可能漏缝 / 重叠）
    let cursor = 0;
    for (const b of HEIGHT_LINE_BANDS) {
      expect(b.x).toBe(0);
      expect(b.w).toBe(RUN_PAGE_W);
      expect(b.y, '四带必须首尾相接').toBe(cursor);
      cursor = b.y + b.h;
    }
    expect(cursor).toBe(RUN_PAGE_H);
    expect(HEIGHT_LINE_TOP_BAND_H).toBe(RUN_TOP_BAND_H);
    expect(HEIGHT_LINE_TOP_BAND).toEqual({ x: 0, y: 0, w: RUN_PAGE_W, h: HEIGHT_LINE_TOP_BAND_H });
    expect(HEIGHT_LINE_ACTION_BAND.h).toBe(84);
    // ③ 与正式布局的**唯一**差别 = 战场带加高（302 → 344），日志带同比收窄
    expect(HEIGHT_LINE_BATTLE_BAND.h).toBe(HEIGHT_LINE_BATTLE_BAND_H);
    expect(HEIGHT_LINE_BATTLE_BAND.h).toBeGreaterThan(RUN_STAGE_BAND.h);
    expect(HEIGHT_LINE_BATTLE_BAND.y).toBe(RUN_STAGE_BAND.y);
    expect(HEIGHT_LINE_LOG_BAND.h).toBeLessThan(RUN_LOG_BAND_H);
    expect(HEIGHT_LINE_LOG_BAND.h + HEIGHT_LINE_BATTLE_BAND.h).toBe(
      RUN_LOG_BAND_H + RUN_STAGE_BAND.h,
    );
    // ④ 自检（含新加的布局 / 取景自检）必须为空
    expect(heightLineConfigsProblems()).toEqual([]);
  });

  it('HL-13 近景窗是纯换算：等比、恒定密度、车顶落在目标比例、源矩形永不越界', () => {
    const bandAspect = HEIGHT_LINE_BATTLE_BAND.h / HEIGHT_LINE_BATTLE_BAND.w;
    const vpW = RUN_BATTLE_VIEW_W * 2;
    const vpH = RUN_BATTLE_VIEW_H * 2;

    // ① 目标情形：不触发夹取 ⇒ 车顶恰好落在 HEIGHT_LINE_CLOSE_ROOF_FRAC
    const win = heightLineCloseWindow({
      roofWorldY: 645,
      anchorWorldX: 1000,
      scale: 0.5,
      offsetX: 200,
      offsetY: 100,
      viewportW: vpW,
      viewportH: vpH,
    });
    expect(win.worldW).toBe(HEIGHT_LINE_CLOSE_WORLD_W);
    expect(win.worldH).toBeCloseTo(closeWorldH(), 9);
    expect(win.worldW / win.worldH).toBeCloseTo(1 / bandAspect, 9); // 等比，不拉伸
    expect(win.clamped).toBe(false);
    expect(win.roofScreenFrac).toBeCloseTo(HEIGHT_LINE_CLOSE_ROOF_FRAC, 9);
    expect(win.pxPerWorld).toBeCloseTo(HEIGHT_LINE_BATTLE_BAND.w / HEIGHT_LINE_CLOSE_WORLD_W, 9);
    expect(win.pxPerWorld).toBeGreaterThan(2); // 每个世界像素被摊到 > 2 个显示像素
    // 源矩形 = 窗的世界矩形经官方相机变换到离屏画布逻辑坐标
    expect(win.srcW).toBeCloseTo(win.worldW * 0.5, 9);
    expect(win.srcH).toBeCloseTo(win.worldH * 0.5, 9);
    expect(win.worldLeft).toBeCloseTo(1000 - HEIGHT_LINE_CLOSE_WORLD_W / 2, 6);
    expect(win.worldTop).toBeCloseTo(645 - HEIGHT_LINE_CLOSE_ROOF_FRAC * closeWorldH(), 6);

    // ② 世界窗宽高与显示密度**与相机 scale 无关** ⇒ 三套轮径在同一把尺子下对照
    for (const scale of [0.41, 0.63, 1, 1.5, 2]) {
      const w = heightLineCloseWindow({
        roofWorldY: 645,
        anchorWorldX: 1000,
        scale,
        offsetX: 200,
        offsetY: 100,
        viewportW: vpW,
        viewportH: vpH,
      });
      expect(w.worldW, `scale=${scale} 时窗宽必须恒定`).toBe(HEIGHT_LINE_CLOSE_WORLD_W);
      expect(w.worldH).toBeCloseTo(closeWorldH(), 9);
      expect(w.pxPerWorld).toBeCloseTo(2.2941176470588234, 9);
      // 锚点比例只在**未贴边**时保持目标值（贴边是有意的构图夹取，密度不受影响）
      if (!w.clamped) expect(w.roofScreenFrac).toBeCloseTo(HEIGHT_LINE_CLOSE_ROOF_FRAC, 9);
    }

    // ③ 源矩形永远落在视口内（否则 drawImage 会画出透明边）—— 覆盖真实取景区间
    for (const scale of [0.2, 0.41, 0.63, 1, 1.5, 2]) {
      for (const anchorWorldX of [-5000, 0, 1000, 5000]) {
        for (const offsetX of [-200, 0, 300]) {
          const w = heightLineCloseWindow({
            roofWorldY: 645,
            anchorWorldX,
            scale,
            offsetX,
            offsetY: 100,
            viewportW: vpW,
            viewportH: vpH,
          });
          expect(w.srcX).toBeGreaterThanOrEqual(0);
          expect(w.srcY).toBeGreaterThanOrEqual(0);
          expect(w.srcX + w.srcW).toBeLessThanOrEqual(vpW + 1e-9);
          expect(w.srcY + w.srcH).toBeLessThanOrEqual(vpH + 1e-9);
        }
      }
    }

    // ④ 夹取语义：目标越界时贴边（`clamped` 置位，密度**不受影响**）
    const left = heightLineCloseWindow({
      roofWorldY: 645,
      anchorWorldX: -5000,
      scale: 0.5,
      offsetX: 200,
      offsetY: 100,
      viewportW: vpW,
      viewportH: vpH,
    });
    expect(left.clamped).toBe(true);
    expect(left.srcX).toBe(0);
    expect(left.pxPerWorld).toBeCloseTo(win.pxPerWorld, 9); // 夹取只挪构图，不改密度
  });

  it('HL-14 离屏视口放大倍数与 DPR 反比（backing 有上界，密度与设备无关）', () => {
    const maxS = HEIGHT_LINE_CLOSE_MAX_SUPERSAMPLE;
    expect(maxS).toBe(4);
    expect(heightLineCloseSupersample(1)).toBeCloseTo(4, 9);
    expect(heightLineCloseSupersample(2)).toBeCloseTo(2, 9);
    expect(heightLineCloseSupersample(4)).toBeCloseTo(1, 9);
    // 非法 / 越界输入被夹到 [1, maxS]（不抛错、不产生 0 或负数）
    expect(heightLineCloseSupersample(8)).toBe(1);
    expect(heightLineCloseSupersample(0)).toBe(maxS);
    expect(heightLineCloseSupersample(Number.NaN)).toBe(maxS);
    // dpr ≤ 上限时 S × dpr 恒定 ⇒ 画布 backing 面积与 DPR 无关
    for (const dpr of [1, 1.5, 2, 3, 4]) {
      const s = heightLineCloseSupersample(dpr);
      expect(s).toBeGreaterThanOrEqual(1);
      expect(s).toBeLessThanOrEqual(maxS);
      expect(s * dpr).toBeCloseTo(maxS, 9);
    }
  });

  it('HL-15 视图宿主：新增的只是「视口倍数 + 子矩形合成」，镜头算法与默认行为不变', () => {
    const view = strip(readLab('runBattleView.ts'));

    // ① 视口放大是**可选**的，默认 1 ⇒ 既有的四个 Lab 页面逐像素不变
    expect(view.includes('const requested = options.viewportScale ?? 1;')).toBe(true);
    expect(
      view.includes('this.viewportScale = Number.isFinite(requested) && requested > 1 ? requested : 1;'),
    ).toBe(true);
    expect(view.includes('Math.round(RUN_BATTLE_VIEW_W * this.viewportScale)')).toBe(true);
    expect(view.includes('Math.round(RUN_BATTLE_VIEW_H * this.viewportScale)')).toBe(true);
    // 安全区随视口同比放大（正式 inset 仍是 56/28，`viewportScale = 1` 时正好等于舞台带）
    expect(view.includes('w: this.viewportW() - RUN_BATTLE_VIEW_INSET.x * 2')).toBe(true);
    expect(view.includes('h: this.viewportH() - RUN_BATTLE_VIEW_INSET.y * 2')).toBe(true);
    expect(RUN_BATTLE_VIEW_INSET).toEqual({ x: 56, y: 28 });
    expect(RUN_BATTLE_VIEW_W).toBe(RUN_STAGE_BAND.w + 112);
    expect(RUN_BATTLE_VIEW_H).toBe(RUN_STAGE_BAND.h + 56);

    // ② 近景合成 = 9 参数 drawImage，且源坐标必须换算到 backing 的 device 域
    expect(view.includes('blitRegion(ctx: CanvasRenderingContext2D, src: RunRect, dst: RunRect): void {')).toBe(
      true,
    );
    expect(view.includes('src.x * this.dpr')).toBe(true);
    expect(view.includes('src.y * this.dpr')).toBe(true);
    // 合成动作**只有**两处（blit 远景 + blitRegion 近景）——不得出现第三个贴图口径
    expect(view.split('ctx.drawImage(').length - 1).toBe(2);

    // ③ 仍然没有第二套镜头：不写 transform、不碰 battleCam、不自己跟随
    expect(view.includes('reframe(')).toBe(true);
    expect(view.includes('battleCam')).toBe(false);
    expect(view.includes('applyBattleFollow')).toBe(false);
    expect(view.includes('this.renderer.transform =')).toBe(false);
    expect(view.indexOf('reframe(')).toBeLessThan(view.indexOf('renderer.render('));
  });

  it('HL-16 页面近景分支不画字 / 不画标线 / 不加特效（只做裁切合成）', () => {
    const page = strip(readLab('heightLineLab.ts'));
    const a = page.indexOf('this.battleView.render(rt);');
    const b = page.indexOf('} else {', a);
    expect(a).toBeGreaterThan(-1);
    expect(b, '近景分支必须有明确的边界').toBeGreaterThan(a);
    const branch = page.slice(a, b);
    expect(branch.length).toBeGreaterThan(50);
    // 只允许「渲染 → 算窗 → 裁切贴图」三步
    expect(branch.includes('this.closeUpWindow = this.computeCloseUpWindow(rt);')).toBe(true);
    expect(branch.includes('this.battleView.blitRegion(')).toBe(true);
    // 不得出现解释文字 / 辅助标线 / 特效叠加
    for (const t of ['fillText(', 'strokeStyle', 'strokeRect(', 'lineTo(', 'arc(', 'shadowBlur', 'globalAlpha']) {
      expect(branch.includes(t), `近景分支不得出现 "${t}"`).toBe(false);
    }
    // 不再走「整幅 1:1 贴安全区」的远景口径（战场带现在由近景窗铺满）
    expect(page.includes('this.battleView.blit(ctx')).toBe(false);
    // 页面自己不持有渲染器 / 不写相机状态
    expect(/new\s+Renderer\s*\(/.test(page)).toBe(false);
    expect(page.includes('renderer.transform')).toBe(false);
    // 近景窗的输入必须是**只读**运行时读数 + 正式相机读数
    expect(page.includes("roofWorldY: box.minY")).toBe(true);
    expect(page.includes("anchorWorldX: rt.vehicleX('A')")).toBe(true);
    expect(page.includes("const box = rt.vehicleBox('A');")).toBe(true);
    expect(page.includes('const t = this.battleView.viewTransform();')).toBe(true);
    expect(page.includes('heightLineCloseWindow({')).toBe(true);
  });
});

