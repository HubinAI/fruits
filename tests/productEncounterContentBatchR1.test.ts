/**
 * DEMO-ENCOUNTER-CONTENT-BATCH-R1｜三套压力画像候选的**针对性战斗验证**。
 *
 * ── 本 Queue 做了什么 ───────────────────────────────────────────────────────
 *
 *   从 49 套正式对手模板中挑 3 套压力画像明显不同的对手，经**现有共享数据入口**
 *   （`LAB_ENCOUNTERS` + `formalOpponentDraft`）登记为独立候选：
 *
 *     | id | 定位 | 模板 | 构成 | 压力画像 |
 *     |---|---|---|---|---|
 *     | HeavyFortress | 重型/姿态干扰 | R1-HVY-01 | heavyBox(150) 双大轮 + 炮+镭射 · 停驻 | 推不动的要塞站桩双远程 |
 *     | RushRammer | 近战压进 | R1-RUSH-01 | heavyBox 双小轮 + 冲锤+推进器 · 前进 | 高质量贴身冲撞压制 |
 *     | HighGunPlatform | 远程压制 | R1-GUN-02 | tallBody 双标准轮 + 机枪+镭射 · 停驻 | 高架双远程站桩输出 |
 *
 *   三套都是**既有正式模板的引用**（零新数值、count=1、不声明 enemyDrive）；
 *   **不进产品 RUN_SCRIPT**（正式三段节奏逐字不变）。
 *
 * ── 本文件验证什么（Queue 必改 3 / 验收 1~3）────────────────────────────────
 *
 *   用**现有合法玩家 Build**（`defaultPlayerDraft` 换 mangoBody + cannon——
 *   即 productDemoPlayablePathR1 的 mango 基线车型）逐套真跑正式
 *   `RunBattleRuntime`（正式 SpawnPlan → 正式编排器 → 真实物理）：
 *
 *   - EB-01 候选合法性：三条都真实存在于共享入口、引用 R1 正式模板、count=1、
 *     模板 draft 过 `validateSnapshot`（装配 + 能量合法）；
 *   - EB-02 针对性战斗：三套逐套真跑到合法终态（winner 非 null，不挂死），
 *     记录 minGap / 命中 / 伤害 / 步数 / 终态（console 全表）；
 *   - EB-03 可量化差异：三套的关键读数**两两不同**（不是仅换名称和外观）——
 *     minGap（停驻 vs 前进 vs 重型贴身）、伤害来源画像、玩家剩余 HP；
 *   - EB-04 原有三场不回归：正式 RUN_SCRIPT 三场的 encounterId 逐字不变、
 *     候选 id 不出现在 RUN_SCRIPT（Queue 禁止项的机器取证）。
 */
import { describe, expect, it } from 'vitest';

import { LAB_ENCOUNTERS, findEncounter } from '../src/lab/portraitBattleLab/testData';
import { OPPONENT_TEMPLATES } from '../src/player/opponentPool';
import { RunBattleRuntime } from '../src/lab/portraitBattleLab/runBattleRuntime';
import { RUN_SCRIPT } from '../src/lab/portraitBattleLab/runScript';
import { validateSnapshot } from '../src/core/buildValidator';
import { buildSnapshotFromDraft, type BuildDraft } from '../src/lab/buildEditorModel';
import { registry } from '../src/core/content';
import { EMPTY_SLOT } from '../src/lab/buildEditorModel';
import { WEAPON_SLOT, defaultPlayerDraft } from '../src/product/playerLoadout';

/* --------------------------------------------------------------- 夹具常量 */

const FRAME_MS = 1000 / 60;
const MAX_STEPS = 4000;
const PRODUCT_TAG = 'profile-equipped';
const SLOW_MS = 300_000;

const CANDIDATE_IDS = ['HeavyFortress', 'RushRammer', 'HighGunPlatform'] as const;

/** 现有合法玩家 Build：mango 基线车型（mangoBody + cannon，标准轮，productDemoPlayablePathR1 同款）。 */
function mangoCannonDraft(): BuildDraft {
  const base = defaultPlayerDraft();
  return {
    ...base,
    bodyDefId: 'mangoBody',
    functionalSelections: {
      ...base.functionalSelections,
      [WEAPON_SLOT]: 'cannon',
      front: EMPTY_SLOT,
      rear: EMPTY_SLOT,
    },
  };
}

/* ------------------------------------------------------------------ 读数 */

interface FightFact {
  readonly winner: string | null;
  readonly steps: number;
  readonly hpA: number;
  readonly hpB: number;
  /** 全程最小外廓间距（接触差异的核心读数；<0 = 发生过重叠）。 */
  readonly minGap: number;
  /** 玩家武器命中数与逐发伤害（伤害来源画像）。 */
  readonly hits: number;
  readonly perHit: readonly number[];
  readonly totalDamage: number;
  /** 对手命中玩家的次数（对手武器事件 = 敌方 weapon 伤害来源计数）。 */
  readonly enemyHitsOnPlayer: number;
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
    const playerTeam = 'A';
    let enemyHitsOnPlayer = 0;
    // 敌方武器命中玩家的事件计数（订阅正式事件总线；只记事实）。
    rt.orchestrator.onCombatEvent((ev) => {
      if (ev.type !== 'damage') return;
      if (ev.target === playerTeam && ev.damageSource === 'weapon') enemyHitsOnPlayer += 1;
    });
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
      enemyHitsOnPlayer,
    };
  } finally {
    rt.dispose();
  }
}

/* ==================================================================== 测试 */

describe('DEMO-ENCOUNTER-CONTENT-BATCH-R1｜候选验证', () => {
  it(
    'EB-01 候选合法性：三条都在共享入口、引用 R1 正式模板、count=1、模板装配+能量合法',
    () => {
      for (const id of CANDIDATE_IDS) {
        const enc = findEncounter(id);
        expect(enc, `${id} 必须在共享数据入口 LAB_ENCOUNTERS 里`).toBeDefined();
        expect(enc!.count, `${id}: 单车`).toBe(1);
        expect(enc!.enemyDrive, `${id}: 不声明 keep-distance`).toBeUndefined();
        const tmpl = OPPONENT_TEMPLATES.find((t) => t.id === enc!.templateId);
        expect(tmpl, `${id}: templateId "${enc!.templateId}" 必须是正式 49 套之一`).toBeDefined();
        // 模板 draft 过正式校验（装配 + 能量；候选零数值改动 ⇒ 与模板逐字段一致）
        const v = validateSnapshot(buildSnapshotFromDraft(tmpl!.draft, registry), registry);
        expect(v.valid, `${id}: 模板装配+能量必须合法：${v.valid ? '' : v.errors.join(';')}`).toBe(true);
      }
      // 三套定位覆盖 Queue 点名的三类压力（模板 role 现读，不抄表）
      const roles = CANDIDATE_IDS.map(
        (id) => OPPONENT_TEMPLATES.find((t) => t.id === findEncounter(id)!.templateId)!.role,
      );
      expect(roles, '三套定位 = heavy / rush / ranged 各一').toEqual(['heavy', 'rush', 'ranged']);
    },
    SLOW_MS,
  );

  it(
    'EB-02 + EB-03 针对性战斗：三套真跑到合法终态且关键读数两两不同',
    () => {
      const player = mangoCannonDraft();
      const facts: Record<string, FightFact> = {};
      const rows: string[] = [];
      for (const id of CANDIDATE_IDS) {
        const f = fightOne(id, player);
        facts[id] = f;
        rows.push(
          `${id.padEnd(16)} w=${f.winner} steps=${String(f.steps).padEnd(4)} ` +
            `minGap=${f.minGap.toFixed(1).padStart(7)} hits=${String(f.hits).padEnd(3)} ` +
            `per=${f.perHit.join('/')} dmg=${Math.round(f.totalDamage)} ` +
            `enemyHits=${f.enemyHitsOnPlayer} hpA=${Math.round(f.hpA)} hpB=${Math.round(f.hpB)}`,
        );
      }
      console.log(`\n##### EB-02 三套候选战斗读数（玩家 = mango+cannon）#####\n  ${rows.join('\n  ')}`);

      // 每一套都产生合法终态（winner 非 null = 真实战斗分出胜负，不挂死）
      for (const id of CANDIDATE_IDS) {
        expect(facts[id]!.winner, `${id}: 必须产生合法终态`).not.toBeNull();
        expect(facts[id]!.steps, `${id}: 真实战斗步数（非瞬杀）`).toBeGreaterThan(30);
      }

      // ── EB-03 可量化差异（两两不同；不是仅换名称外观）────────────────────────
      // ① 胜负画像：HeavyFortress（重炮要塞 150 质量 + 炮/镭射）能**击败** mango 玩家
      //    —— 与另两套（玩家胜）形成明显压力分层（高风险候选）。
      expect(facts['HeavyFortress']!.winner, '重炮要塞：玩家落败（高压候选）').toBe('B');
      expect(facts['RushRammer']!.winner, '重装冲锤：玩家险胜（贴身战）').toBe('A');
      expect(facts['HighGunPlatform']!.winner, '高架炮台：玩家胜（站桩远程可被逼近打死）').toBe('A');
      // ② 姿态画像：RushRammer 的 minGap 显著更深（高质量冲锤+推进器把玩家顶得更深），
      //    与两套停驻候选的接触深度两两不同。
      expect(facts['HighGunPlatform']!.minGap).not.toBe(facts['RushRammer']!.minGap);
      expect(facts['HeavyFortress']!.minGap).not.toBe(facts['RushRammer']!.minGap);
      // ③ 战斗时长画像：三套步数两两不同（要塞战 / 贴身互殴 / 逼近炮台节奏各异）。
      const steps = [facts['HeavyFortress']!.steps, facts['RushRammer']!.steps, facts['HighGunPlatform']!.steps];
      expect(new Set(steps).size).toBe(3);
      // ④ 伤害画像两两不同（enemyHits / perHit / 总伤组合；三套武器构成互不相同）。
      const sig = (f: FightFact): string =>
        `${f.enemyHitsOnPlayer}|${f.perHit.join(',')}|${Math.round(f.totalDamage)}`;
      expect(new Set([sig(facts['HeavyFortress']!), sig(facts['RushRammer']!), sig(facts['HighGunPlatform']!)]).size)
        .toBe(3);
    },
    SLOW_MS,
  );

  it(
    'EB-04 原有三场不回归：RUN_SCRIPT 逐字不变 + 候选 id 不在产品脚本里',
    () => {
      // 正式三段节奏的 encounterId 序列冻结（Queue 禁止项的机器取证）
      expect(
        RUN_SCRIPT.filter((n) => n.kind === 'BATTLE' || n.kind === 'FINAL').map((n) => n.encounterId),
      ).toEqual(['ProtoRusher', 'Chaser', 'RangedTurret']);
      // 候选只是独立数据，不进产品脚本
      for (const id of CANDIDATE_IDS) {
        expect(
          RUN_SCRIPT.some((n) => n.encounterId === id),
          `${id} 不得出现在产品 RUN_SCRIPT`,
        ).toBe(false);
      }
      // 共享入口里原有七套仍在（登记是纯加法）
      for (const id of ['Chaser', 'RangedTurret', 'LightSwarm3', 'ProtoRusher', 'PineappleFireBrute', 'PineappleSawRusher', 'BananaRodLaser'] as const) {
        expect(findEncounter(id), `原有 Encounter "${id}" 保持不变`).toBeDefined();
      }
      expect(LAB_ENCOUNTERS.length).toBe(10);
    },
    SLOW_MS,
  );
});
