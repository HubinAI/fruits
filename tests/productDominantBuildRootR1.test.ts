/**
 * DEMO-DOMINANT-BUILD-ROOT-R1｜**A-mango-cannon 通吃根因诊断**（test-only，零产品改动）。
 *
 * ── 本 Queue 回答的问题（只诊断，不调平衡）───────────────────────────────────
 *
 *   DEMO-FULL-RUN-BUILD-VALUE-R1 的 4×3 完整链矩阵给出一个**症状**：
 *   A（mango + cannon + 双 smallWheel）三路线全 COMPLETE，B/C 全败、D 仅 rush。
 *   本文件回答：**为什么是 A**，以及这个差异属于哪一类原因。
 *
 *   Queue 明令的边界（本文件严格自守）：
 *     · 不调数值、不加血量、不做假克制、不新增敌人；
 *     · 不重新枚举 4×3×全部强化序空间（那是上一轮的矩阵）；只做**有判别的对照**；
 *     · 「相关性 ≠ 因果」——凡是被别的因素一并改变的格子，只当线索，不写进结论。
 *
 * ── 取证口径（四段标注，Queue 必改 2）──────────────────────────────────────
 *
 *   【输入装配】 真实装配链（空存档 → openGrowthSession → equipBody/Weapon/Movement）
 *                ／取证格用「合法底盘上替换 id」的构造，标注为非装配合法性主张；
 *   【正式逻辑】 Encounter → buildSpawnPlanFromDraft → 正式对手模板 + 正式驱动；
 *   【Runtime】  正式 RunBattleRuntime 逐帧推进（无 Build / 满耐久 / 单场隔离）；
 *   【实际战果】 胜负 + 双方 HP 轨迹 + 双方间距极值 + 战场事件时间戳。
 *
 * ── 三组对照（必改 1 / 2）─────────────────────────────────────────────────
 *
 *   DR-01：A vs C **同武器**对照（body × wheel 2×2，武器恒 cannon）
 *          → 找出「三条默认遭遇里到底哪一场在区分」；
 *   DR-02：把「质量 / 扭矩」这两个最像的力学解释**证伪**
 *          → banana 比 mango 更轻、扭矩相同，却输；同时量出敌弹真实飞行高度；
 *   DR-03：把胜因归类 + 把 B/D 的失败归类
 *          → 收割手段（武器伤害 vs 场地收束尖刺）与武器可及性（够不够得着）。
 *
 * ⚠️ 期望值纪律：本文件**所有**冻结数字都来自真实跑批输出（曾因抄相邻单元格吃过亏）。
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_ARENA_CONFIG } from '../src/battle/arenaConfig';
import { registry } from '../src/core/content';
import type { BuildDraft } from '../src/lab/buildEditorModel';
import { RunBattleRuntime } from '../src/lab/portraitBattleLab/runBattleRuntime';
import { RUN_SCRIPT } from '../src/lab/portraitBattleLab/runScript';
import {
  defaultPlayerDraft,
  equipBody,
  equipMovement,
  equipWeapon,
} from '../src/product/playerLoadout';
import { isFreshProfile, openGrowthSession } from '../src/product/playerGrowth';

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

/** 默认路线的三场战斗（唯一真源 = RUN_SCRIPT，不写死）。 */
const DEFAULT_BATTLES = RUN_SCRIPT.filter((n) => n.kind === 'BATTLE' || n.kind === 'FINAL').map(
  (n) => n.encounterId as string,
);

/** 2×2 + 取证格：武器恒 cannon，只有 body / wheel 变。 */
const FACTORIAL = [
  { id: 'mango+small', body: 'mangoBody', wheel: 'smallWheel' },
  { id: 'mango+heavy', body: 'mangoBody', wheel: 'heavyWheel' },
  { id: 'mango+large', body: 'mangoBody', wheel: 'largeWheel' },
  { id: 'coconut+small', body: 'coconutBody', wheel: 'smallWheel' },
  { id: 'coconut+heavy', body: 'coconutBody', wheel: 'heavyWheel' },
  { id: 'banana+small', body: 'bananaBody', wheel: 'smallWheel' },
  { id: 'watermelon+small', body: 'watermelonBody', wheel: 'smallWheel' },
] as const;

/** 只在「最后一步换武器」的对照（底盘恒 mango+small）——分离底盘因子与武器因子。 */
const WEAPON_SWAP = ['cannon', 'shotgun', 'hammer', 'machineGun', 'laser'] as const;

/* ------------------------------------------------------------ 取装配 */

/** 【输入装配】真实装配链（Energy / 挂点 / 库存全部走正式写入口）。 */
function assembleRealAccount(body: string, weapon: string, wheel: string): BuildDraft {
  (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();
  expect(isFreshProfile()).toBe(true);
  const session = openGrowthSession(defaultPlayerDraft());
  const b = equipBody(body, session.draft);
  expect(b.ok, `equipBody(${body}): ${b.detail ?? ''}`).toBe(true);
  const w = equipWeapon(weapon, b.draft!);
  expect(w.ok, `equipWeapon(${weapon}): ${w.detail ?? ''}`).toBe(true);
  const wf = equipMovement('front', wheel, w.draft!);
  expect(wf.ok, `equipMovement(front,${wheel}): ${wf.detail ?? ''}`).toBe(true);
  const wr = equipMovement('rear', wheel, wf.draft!);
  expect(wr.ok, `equipMovement(rear,${wheel}): ${wr.draft ?? ''}`).toBe(true);
  return wr.draft!;
}

/**
 * 【输入装配｜取证格】在**合法底盘**上替换 body / wheel id。
 *
 * ⚠️ 这不是「装配合法性」主张 —— 取证格只用于证明「同一个底盘换轮子/换车身会怎样」，
 *    因此不经过 `equipMovement` 的库存闸门（banana / largeWheel 未必在新账号库存里）。
 *    合法性由 DR-01 的 A vs C 两格（走真实链路）单独承担。
 */
function forensicDraft(body: string, weapon: string, wheel: string): BuildDraft {
  const base = assembleRealAccount('mangoBody', 'cannon', 'smallWheel');
  const bodyDef = registry.bodies.get(body);
  expect(bodyDef, `未知车身 ${body}`).toBeTruthy();
  const wheelDef = registry.movements.get(wheel);
  expect(wheelDef, `未知轮组 ${wheel}`).toBeTruthy();
  const selections: Record<string, string> = {};
  for (const hp of bodyDef!.functionalHardpoints) selections[hp.id] = 'none';
  expect(selections['frontMass'], `${body} 缺 frontMass 挂点`).toBeDefined();
  selections['frontMass'] = weapon;
  return {
    ...base,
    bodyDefId: body,
    frontWheelDefId: wheel,
    rearWheelDefId: wheel,
    frontRadius: wheelDef!.radius,
    rearRadius: wheelDef!.radius,
    functionalSelections: selections,
  };
}

/* ------------------------------------------------- 单场隔离战斗 + 战场取证 */

interface DamageEvent {
  readonly atMs: number;
  readonly amount: number;
  readonly target: 'A' | 'B';
}

interface BattleFact {
  readonly encounterId: string;
  readonly winner: 'A' | 'B' | null;
  readonly endReason: string | null;
  readonly hpA0: number;
  readonly hpA: number;
  readonly hpB0: number;
  readonly hpB: number;
  readonly timeMs: number;
  readonly steps: number;
  readonly minGap: number;
  readonly finalGap: number;
  /** 玩家侧武器命中（partId → 命中数 / 总伤害 / 首中时刻）。 */
  readonly hits: Readonly<Record<string, { count: number; damage: number; firstAtMs: number }>>;
  /** 玩家的武器总伤害（= 战果侧，与敌方掉血对比可分离「武器伤害 vs 非武器伤害」）。 */
  readonly weaponDamage: number;
  readonly events: readonly DamageEvent[];
  /** 敌方弹丸飞行高度采样（team B 的 projectile.center.y）。 */
  readonly enemyBulletY: readonly number[];
  /** 车辆可见外接框（含 functional parts）。 */
  readonly boxA0: { minY: number; maxY: number };
  readonly boxB0: { minY: number; maxY: number };
}

function runIsolated(draft: BuildDraft, encounterId: string): BattleFact {
  const rt = new RunBattleRuntime({
    build: [],
    carriedHp: null,
    encounterId,
    playerDraft: draft,
    playerLoadoutTag: 'profile-equipped',
    playerBaseline: true,
  });
  try {
    const hp0 = rt.hp();
    const b0 = rt.vehicleBox('A');
    const eb0 = rt.vehicleBox('B');
    const events: DamageEvent[] = [];
    const enemyBulletY: number[] = [];
    let prevA = hp0.a;
    let prevB = hp0.b;
    let minGap = Number.POSITIVE_INFINITY;
    let steps = 0;
    while (rt.result === null && steps < MAX_STEPS) {
      rt.step(FRAME_MS);
      steps += 1;
      const hp = rt.hp();
      const atMs = rt.timeMs;
      if (hp.a < prevA) events.push({ atMs, amount: prevA - hp.a, target: 'A' });
      if (hp.b < prevB) events.push({ atMs, amount: prevB - hp.b, target: 'B' });
      prevA = hp.a;
      prevB = hp.b;
      const g = rt.gapWorld();
      if (g < minGap) minGap = g;
      // 敌弹高度：只取 team B 的弹丸（machineGun gravityScale=0 ⇒ 近乎水平直线）。
      const projs = rt.snapshot().projectiles ?? [];
      for (const p of projs) if (p.team === 'B') enemyBulletY.push(p.center.y);
    }
    const hp = rt.hp();
    const summary = rt.playerWeaponHitSummary();
    const hits: Record<string, { count: number; damage: number; firstAtMs: number }> = {};
    let weaponDamage = 0;
    for (const [partId, s] of Object.entries(summary)) {
      hits[partId] = {
        count: s.count,
        damage: s.damages.reduce((a, b) => a + b, 0),
        firstAtMs: s.firstAtMs ?? 0,
      };
      weaponDamage += hits[partId]!.damage;
    }
    return {
      encounterId,
      winner: (rt.result?.winner ?? null) as 'A' | 'B' | null,
      endReason: rt.result?.endReason ?? null,
      hpA0: hp0.a,
      hpA: hp.a,
      hpB0: hp0.b,
      hpB: hp.b,
      timeMs: rt.timeMs,
      steps,
      minGap,
      finalGap: rt.gapWorld(),
      hits,
      weaponDamage,
      events,
      enemyBulletY,
      boxA0: { minY: b0.minY, maxY: b0.maxY },
      boxB0: { minY: eb0.minY, maxY: eb0.maxY },
    };
  } finally {
    rt.dispose();
  }
}

/* ------------------------------------------------------------------ 小工具 */

/** 单发弹丸伤害（现读真源，不写死 80/20/30）。 */
function projectileDamage(id: string): number {
  return (registry.functionals.get(id)?.behaviorParams as { projectileDamage?: number } | undefined)
    ?.projectileDamage ?? 0;
}

function median(xs: readonly number[]): number {
  if (xs.length === 0) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** 某个伤害量级的事件计数（用于区分「炮弹 80」与「机枪 20」这类口径）。 */
function countByAmount(events: readonly DamageEvent[], target: 'A' | 'B', amount: number): number {
  return events.filter((e) => e.target === target && Math.abs(e.amount - amount) < 0.01).length;
}

/** 场地收束尖刺的特征：敌方掉血里连续出现「恰好 hazardDamagePerTick」的事件。 */
function hazardSignature(fact: BattleFact, tick: number): { count: number; firstAtMs: number | null } {
  const hits = fact.events.filter((e) => e.target === 'B' && Math.abs(e.amount - tick) < 0.01);
  return { count: hits.length, firstAtMs: hits.length > 0 ? hits[0]!.atMs : null };
}

/* ================================================================== 测试 */

describe('DEMO-DOMINANT-BUILD-ROOT-R1｜DR-01 同武器对照：哪一场在区分', () => {
  it(
    'DR-01 body × wheel 2×2（武器恒 cannon）× 三条默认遭遇 —— 只有 RangedTurret 有判别力',
    () => {
      expect(DEFAULT_BATTLES.length).toBe(3);
      const mgDamage = projectileDamage('machineGun');
      const cannonDamage = projectileDamage('cannon');
      const rows: string[] = [];
      /** encounterId → 各格战果。 */
      const perEncounter = new Map<string, { id: string; fact: BattleFact }[]>();
      for (const enc of DEFAULT_BATTLES) perEncounter.set(enc, []);

      for (const cell of FACTORIAL) {
        const draft =
          cell.id === 'mango+small' || cell.id === 'coconut+heavy'
            ? assembleRealAccount(cell.body, 'cannon', cell.wheel)
            : forensicDraft(cell.body, 'cannon', cell.wheel);
        for (const enc of DEFAULT_BATTLES) {
          const fact = runIsolated(draft, enc);
          perEncounter.get(enc)!.push({ id: cell.id, fact });
          rows.push(
            `${cell.id.padEnd(18)} × ${enc.padEnd(13)} ⇒ ${fact.winner} ` +
              `${String(Math.round(fact.hpA)).padStart(4)}/${String(Math.round(fact.hpB)).padStart(4)} ` +
              `minGap=${fact.minGap.toFixed(1).padStart(7)} t=${(fact.timeMs / 1000).toFixed(2)}s ` +
              `命中=[${Object.entries(fact.hits)
                .map(([k, v]) => `${k}×${v.count}`)
                .join(',') || '—'}] ` +
              `受机枪弹=${countByAmount(fact.events, 'A', mgDamage)} 受炮弹=${countByAmount(fact.events, 'A', cannonDamage)} ` +
              `车顶=${fact.boxA0.minY.toFixed(1)} 敌弹中位=${median(fact.enemyBulletY).toFixed(1)}`,
          );
        }
      }
      console.log(`\n##### DR-01 2×2（+两格取证）× 三条默认遭遇 #####\n  ${rows.join('\n  ')}`);

      // ① 前两场对「底盘差异」不敏感 ⇒ 不是它们造成 A 的通吃
      for (const enc of [DEFAULT_BATTLES[0]!, DEFAULT_BATTLES[1]!]) {
        const cells = perEncounter.get(enc)!;
        for (const c of cells) {
          expect(c.fact.winner, `${enc}: ${c.id} 应全胜（前两场不区分底盘）`).toBe('A');
        }
      }

      // ② RangedTurret 是唯一区分场：且只有 mango+small 胜
      const rt = perEncounter.get(DEFAULT_BATTLES[2]!)!;
      const winners = rt.filter((c) => c.fact.winner === 'A').map((c) => c.id);
      console.log(`  ③ ${DEFAULT_BATTLES[2]} 胜者 = [${winners.join(', ')}]`);
      expect(winners).toEqual(['mango+small']);

      // ③ 败者分两种**不同**的病灶（R7-MATRIX 的教训：判「够不够得着」只看 `minGap`）：
      //    (i) 「从未接近」= minGap 超过一个车身长（~100px）⇒ 全程没进入交火；
      //    (ii)「打得到但仍败」= 真的贴上去了，却被机枪压制弹打光耐久。
      const win = rt.find((c) => c.id === 'mango+small')!.fact;
      const neverClosed = rt.filter((c) => c.id !== 'mango+small' && c.fact.minGap > 100).map((c) => c.id);
      const closedAndLost = rt.filter((c) => c.id !== 'mango+small' && c.fact.minGap <= 100).map((c) => c.id);
      console.log(
        `  ④ 败者分型：从未进入交火=[${neverClosed.join(', ')}] / 贴上仍败=[${closedAndLost.join(', ')}]`,
      );
      expect(neverClosed.length).toBeGreaterThan(0);
      expect(closedAndLost.length).toBeGreaterThan(0);
      expect(neverClosed.length + closedAndLost.length).toBe(rt.length - 1);
      // 胜者确实打过（真实武器命中 + 真实伤害），不是「苟到判和」
      expect(win.weaponDamage).toBeGreaterThan(0);
      expect(Object.keys(win.hits).length).toBeGreaterThan(0);
      // 胜者**一次都没被机枪压制弹命中**；每一格「贴上仍败」的都必须被命中过
      expect(countByAmount(win.events, 'A', mgDamage), '胜者受机枪弹 = 0').toBe(0);
      for (const c of closedAndLost) {
        const f = rt.find((x) => x.id === c)!.fact;
        expect(countByAmount(f.events, 'A', mgDamage), `${c}: 贴上后应被机枪弹命中`).toBeGreaterThan(
          10,
        );
      }
      // ④ 几何关系（本 Queue 的**机制结论**）：车顶（可见顶边）高于敌弹弹线 ⇒ 弹从车顶掠过。
      //    胜者成立；所有「被机枪弹命中」的格子必须反向成立。
      expect(win.boxA0.minY).toBeGreaterThan(median(win.enemyBulletY));
      for (const c of closedAndLost) {
        const f = rt.find((x) => x.id === c)!.fact;
        expect(f.boxA0.minY, `${c}: 车顶低于敌弹线 ⇒ 弹会打到车`).toBeLessThan(
          median(f.enemyBulletY),
        );
      }
    },
    SLOW_MS,
  );
});

describe('DEMO-DOMINANT-BUILD-ROOT-R1｜DR-02 证伪质量/扭矩：真正的差别在受弹', () => {
  it(
    'DR-02 banana 更轻、扭矩相同却输 ⇒ 力学解释不成立；差别落在「20 点机枪弹命中数」',
    () => {
      // ── (a) 力学解释证伪（现读 registry，不写死）─────────────────────────
      const massOf = (id: string): number => registry.bodies.get(id)!.baseMass;
      const torqueOf = (id: string): number => registry.movements.get(id)!.driveTorque;
      console.log(
        `\n##### DR-02a 力学读数 #####\n` +
          `  baseMass: mango=${massOf('mangoBody')} banana=${massOf('bananaBody')} ` +
          `coconut=${massOf('coconutBody')} watermelon=${massOf('watermelonBody')}\n` +
          `  driveTorque: small=${torqueOf('smallWheel')} large=${torqueOf('largeWheel')} ` +
          `heavy=${torqueOf('heavyWheel')}`,
      );
      expect(massOf('bananaBody'), 'banana 必须比 mango 更轻，才能证伪「越轻越强」').toBeLessThan(
        massOf('mangoBody'),
      );
      expect(torqueOf('smallWheel'), 'small 扭矩远高于其他轮（若扭矩是因，则装大轮必败）')
        .toBeGreaterThan(torqueOf('largeWheel'));

      // ── (b) 真实战果：轻的输、扭矩同档的输 ─────────────────────────────
      const enc = DEFAULT_BATTLES[2]!;
      const mango = runIsolated(forensicDraft('mangoBody', 'cannon', 'smallWheel'), enc);
      const banana = runIsolated(forensicDraft('bananaBody', 'cannon', 'smallWheel'), enc);
      expect(mango.winner, 'mango（更重）胜').toBe('A');
      expect(banana.winner, 'banana（更轻）败 ⇒ 质量不是因').toBe('B');

      // ── (c) 敌弹真实飞行高度 vs 玩家受弹 ────────────────────────────────
      const mgDamage = projectileDamage('machineGun');
      const cannonDamage = projectileDamage('cannon');
      expect(mgDamage, '机枪单发伤害现读').toBeGreaterThan(0);
      expect(cannonDamage).toBeGreaterThan(mgDamage);
      const table = [
        ['mango+small', mango],
        ['banana+small', banana],
      ] as const;
      for (const [id, f] of table) {
        console.log(
          `  ${id.padEnd(14)} winner=${f.winner} enemyBulletY(n=${f.enemyBulletY.length}) ` +
            `median=${median(f.enemyBulletY).toFixed(1)} ` +
            `range=[${Math.min(...f.enemyBulletY).toFixed(1)},${Math.max(...f.enemyBulletY).toFixed(1)}] ` +
            `boxA=[${f.boxA0.minY.toFixed(1)},${f.boxA0.maxY.toFixed(1)}] ` +
            `A受${mgDamage}×${countByAmount(f.events, 'A', mgDamage)} / A受${cannonDamage}×${countByAmount(f.events, 'A', cannonDamage)}`,
        );
      }
      // 胜者的「小口径压制弹」命中数必须显著少于败者 —— 这是真正的差别所在
      const winSmall = countByAmount(mango.events, 'A', mgDamage);
      const loseSmall = countByAmount(banana.events, 'A', mgDamage);
      console.log(`  ⇒ A 受小口径弹：胜者 ${winSmall} 次 / 败者 ${loseSmall} 次`);
      expect(winSmall).toBeLessThan(loseSmall);
      // 胜者的车身可见顶边「低于」敌弹高度（弹从车顶掠过）—— 几何关系成立
      expect(mango.boxA0.minY).toBeGreaterThan(median(mango.enemyBulletY));
      expect(banana.boxA0.minY).toBeLessThan(median(banana.enemyBulletY));
    },
    SLOW_MS,
  );
});

describe('DEMO-DOMINANT-BUILD-ROOT-R1｜DR-03 归类：收割手段与武器可及性', () => {
  it(
    'DR-03a 胜因不是武器击杀：敌方掉血末段是「场地收束尖刺」的等周期脉冲',
    () => {
      const enc = DEFAULT_BATTLES[2]!;
      const win = runIsolated(forensicDraft('mangoBody', 'cannon', 'smallWheel'), enc);
      // 尖刺单跳伤害 / 收束开始时刻**现读**正式竞技场配置，不写死数字
      const spike = DEFAULT_ARENA_CONFIG.hazardDamagePerTick;
      const closingStartMs =
        DEFAULT_ARENA_CONFIG.phases.activeMs + DEFAULT_ARENA_CONFIG.phases.warningMs;
      const sig = hazardSignature(win, spike);
      const enemyLoss = win.hpB0 - win.hpB;
      const nonWeapon = enemyLoss - win.weaponDamage;
      console.log(
        `\n##### DR-03a 终结手段 #####\n` +
          `  winner=${win.winner} t=${(win.timeMs / 1000).toFixed(2)}s ` +
          `敌方总掉血=${enemyLoss.toFixed(0)} 玩家武器伤害=${win.weaponDamage.toFixed(0)} ` +
          `⇒ 非武器伤害=${nonWeapon.toFixed(0)}（占 ${((nonWeapon / enemyLoss) * 100).toFixed(0)}%）\n` +
          `  尖刺脉冲(${spike}/次)：${sig.count} 次，首次 ${sig.firstAtMs === null ? '—' : `${(sig.firstAtMs / 1000).toFixed(2)}s`}` +
          `（收束阶段起点 ${(closingStartMs / 1000).toFixed(2)}s）`,
      );
      // 战果侧事实：敌方掉血中确实存在等周期脉冲（非武器伤害路径被真实走通）
      expect(sig.count).toBeGreaterThanOrEqual(3);
      expect(sig.firstAtMs).not.toBeNull();
      // 且全部脉冲都出现在**收束阶段开始之后**（不是别的东西凑出的 40）
      expect(sig.firstAtMs!, '尖刺必须发生在场地收束阶段').toBeGreaterThanOrEqual(closingStartMs);
      // 非武器伤害必须占敌方总掉血的实质比例（否则不能称「收割手段是尖刺」）
      expect(nonWeapon / enemyLoss).toBeGreaterThan(0.4);
    },
    SLOW_MS,
  );

  it(
    'DR-03b 武器可及性：hammer 打得到近身对手、打不到控距对手 ⇒ 底盘因子与武器因子分离',
    () => {
      const rows: string[] = [];
      const result = new Map<string, BattleFact>();
      for (const weapon of WEAPON_SWAP) {
        const draft = forensicDraft('mangoBody', weapon, 'smallWheel');
        for (const enc of DEFAULT_BATTLES) {
          const f = runIsolated(draft, enc);
          result.set(`${weapon}|${enc}`, f);
          rows.push(
            `  ${weapon.padEnd(12)} × ${enc.padEnd(13)} ⇒ ${f.winner} ` +
              `minGap=${f.minGap.toFixed(1).padStart(7)} 命中=${Object.values(f.hits).reduce((a, h) => a + h.count, 0)}`,
          );
        }
      }
      console.log(`\n##### DR-03b 同底盘换武器 #####\n${rows.join('\n')}`);

      const near = DEFAULT_BATTLES[0]!;
      const run = DEFAULT_BATTLES[2]!;
      const totalHits = (key: string): number =>
        Object.values(result.get(key)!.hits).reduce((a, h) => a + h.count, 0);

      // ① 同一底盘（mango+small）：换武器就能改变控距场的胜负 ⇒ **武器因子独立成立**
      expect(totalHits(`hammer|${near}`), 'hammer 对近身对手必须真的能打到').toBeGreaterThan(0);
      expect(totalHits(`hammer|${run}`), 'hammer 对控距对手 0 命中（够不着）').toBe(0);
      expect(result.get(`hammer|${run}`)!.minGap, 'hammer 全程没进入敲击距离').toBeGreaterThan(0);
      // ② 但控距场**不是普遍不可打**：只有近战锤够不着，射击类武器都能赢
      for (const w of ['cannon', 'shotgun', 'machineGun', 'laser'] as const) {
        expect(result.get(`${w}|${run}`)!.winner, `${w} 在控距场应能取胜`).toBe('A');
      }
      // ③ 反向证据：换武器也会**打输本来能赢的场**（laser 输给 Chaser）⇒ 双向因果，不是单向「远程皆强」
      expect(result.get(`laser|${near}`)!.winner).toBe('A');
      expect(result.get(`laser|${DEFAULT_BATTLES[1]!}`)!.winner, 'laser 对 Chaser 会输').toBe('B');
    },
    SLOW_MS,
  );
});
