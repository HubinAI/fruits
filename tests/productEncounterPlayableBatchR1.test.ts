/**
 * CONTENT-ENCOUNTER-PLAYABLE-BATCH-R1｜遭遇验证台**扩展批次** targeted 测试（纯 node，无 DOM）。
 *
 * 本 Queue 只做「有无 / 可运行 / 能比较」——把正式库已有、尚未进入本 Lab 目录的三套
 * **明显不同物理压力**做成独立可切换内容批次，便于集中录像与挑选接入正式 Run。
 * **不微调胜负与特效**，不新增敌人、不改任何数值。
 *
 * 本文件钉死以下结构事实（对应 Queue 验收 1~4）：
 *
 *   A) **扩展批次恰好三套**，且与正式 `LAB_ENCOUNTERS` **逐项同源**
 *      （label / 正式模板 id / 数量）；三套 = R1-HVY-02 / R1-CTRL-01 / R1-MIX-02；
 *   B) **默认三敌批次一字不变**：`ENCOUNTER_BATCH_IDS` / `ENCOUNTER_BATCH` /
 *      `encounterBatchProblems()` 与扩展存在与否无关；
 *   C) **两批次互不串号**：扩展批次不认默认 id，默认批次不认扩展 id（不静默回退）；
 *   D) **真实可重复测量**：2 个合法现有玩家构筑 × 3 套对手，均从满耐久开打、
 *      真实分出胜负（一端耐久归零）；失败结论如实保留（不要求玩家全胜）；
 *   E) **清场无残留**：每一场新 runtime 的开局读数干净（步数 0 / 无接触·命中·伤害）。
 *
 * ⚠️ 本文件只做确定性内容验收；浏览器随机路线 BLOCKED 由 `_e2e_*` 单列统计，不在此混算。
 */
import { describe, expect, it } from 'vitest';

import { buildSpawnPlan } from '../src/lab/portraitBattleLab/entities';
import {
  EXTENDED_ENCOUNTER_BATCH,
  EXTENDED_ENCOUNTER_BATCH_IDS,
  EXTENDED_ENCOUNTER_BATCH_IDS_ARE_FORMAL,
  EXTENDED_LAB_LEAD,
  EXTENDED_LAB_TITLE,
  extendedEncounterBatchOf,
  extendedEncounterBatchProblems,
} from '../src/lab/portraitBattleLab/encounterBatchExtension';
import {
  ENCOUNTER_BATCH,
  ENCOUNTER_BATCH_IDS,
  ENCOUNTER_LAB_LOADOUT_ID,
  encounterBatchOf,
  encounterBatchProblems,
  encounterLabContextFor,
} from '../src/lab/portraitBattleLab/encounterValidation';
import { LAB_ENCOUNTERS, findLoadout } from '../src/lab/portraitBattleLab/testData';
import { runSingleBattle } from './helpers/runContentBatchHarness';

const FRAME_MS = 1000 / 60;
const MAX_FRAMES = 4000;

/* ================================================= A. 扩展批次三套（必改 1/2） */

describe('CONTENT-ENCOUNTER-PLAYABLE-BATCH-R1｜A 扩展批次恰好三套且与正式表同源', () => {
  it('CEB-01 扩展批次恰好三项，id 顺序固定，全部来自正式 LAB_ENCOUNTERS', () => {
    expect(EXTENDED_ENCOUNTER_BATCH_IDS).toEqual([
      'ExtendedHeavyContact',
      'ExtendedStandoffRod',
      'ExtendedBurnSaw',
    ]);
    expect(EXTENDED_ENCOUNTER_BATCH).toHaveLength(3);
    expect(extendedEncounterBatchProblems()).toEqual([]);

    for (const entry of EXTENDED_ENCOUNTER_BATCH) {
      const formal = LAB_ENCOUNTERS.find((e) => e.id === entry.id);
      expect(formal, `${entry.id} 必须存在于正式 LAB_ENCOUNTERS`).toBeDefined();
      expect(entry.label).toBe(formal!.label);
      expect(entry.templateId).toBe(formal!.templateId);
      expect(entry.count).toBe(formal!.count);
      expect(entry.count).toBe(1);
      expect(entry.verifies.length).toBeGreaterThan(0);
    }
  });

  it('CEB-02 扩展批次引用三套**指定**正式模板（R1-HVY-02 / R1-CTRL-01 / R1-MIX-02）', () => {
    expect(EXTENDED_ENCOUNTER_BATCH.map((e) => e.templateId)).toEqual([
      'R1-HVY-02',
      'R1-CTRL-01',
      'R1-MIX-02',
    ]);
    // 类型级护栏：扩展批次 id 必须是正式 LabEncounterId 子集
    expect(EXTENDED_ENCOUNTER_BATCH_IDS_ARE_FORMAL).toEqual(EXTENDED_ENCOUNTER_BATCH_IDS);
  });

  it('CEB-03 扩展批次标题 / 副标题与默认批次**不同**（可区分）', () => {
    expect(EXTENDED_LAB_TITLE).not.toBe('遭遇验证台');
    expect(EXTENDED_LAB_TITLE.includes('扩展')).toBe(true);
    expect(EXTENDED_LAB_LEAD.includes('只换对手')).toBe(true);
  });
});

/* ============================================ B. 默认三敌批次一字不变（必改 2） */

describe('CONTENT-ENCOUNTER-PLAYABLE-BATCH-R1｜B 默认三敌批次不回归', () => {
  it('CEB-04 默认批次仍是 ProtoRusher / Chaser / RangedTurret（三项，无死配置）', () => {
    expect(ENCOUNTER_BATCH_IDS).toEqual(['ProtoRusher', 'Chaser', 'RangedTurret']);
    expect(ENCOUNTER_BATCH).toHaveLength(3);
    expect(encounterBatchProblems()).toEqual([]);
    expect(ENCOUNTER_BATCH.map((e) => e.templateId)).toEqual(['R1-RUSH-02', 'OPP-16', 'OPP-03']);
  });

  it('CEB-05 两批次**互不串号**（不静默回退到别的对手）', () => {
    // 扩展 id 不在默认批次内
    for (const id of EXTENDED_ENCOUNTER_BATCH_IDS) {
      expect(encounterBatchOf(id), `默认批次不得认扩展 id ${id}`).toBeNull();
    }
    // 默认 id 不在扩展批次内
    for (const id of ENCOUNTER_BATCH_IDS) {
      expect(extendedEncounterBatchOf(id), `扩展批次不得认默认 id ${id}`).toBeNull();
    }
    expect(encounterBatchOf('LightSwarm3')).toBeNull();
    expect(extendedEncounterBatchOf('')).toBeNull();
  });

  it('CEB-06 扩展批次的页面上下文同样来自正式链路（不手写展示名 / 耐久）', () => {
    const ctx = encounterLabContextFor(EXTENDED_ENCOUNTER_BATCH);
    expect(ctx.loadoutId).toBe(ENCOUNTER_LAB_LOADOUT_ID);
    expect(ctx.playerHpMax).toBe(1100);
    expect(ctx.encounters).toHaveLength(3);
    expect(ctx.encounters.map((e) => e.id)).toEqual([...EXTENDED_ENCOUNTER_BATCH_IDS]);
    for (const e of ctx.encounters) {
      const plan = buildSpawnPlan(ENCOUNTER_LAB_LOADOUT_ID, e.id);
      expect(e.enemyLabel).toBe(plan.enemies[0].bodyName);
      expect(e.enemyHpMax).toBe(plan.enemies[0].hp);
      expect(e.verifies.length).toBeGreaterThan(0);
    }
    // 默认批次的上下文（既有入口）逐字节不受影响
    const defCtx = encounterLabContextFor(ENCOUNTER_BATCH);
    expect(defCtx.encounters.map((e) => e.id)).toEqual(['ProtoRusher', 'Chaser', 'RangedTurret']);
    expect(defCtx.encounters.map((e) => e.enemyHpMax)).toEqual([1000, 900, 1100]);
  });
});

/* ================================= C. 真实可重复测量（必改 3 / 验收 2） */

/** 两个**合法现有玩家**构筑（来自 Lab 目录内既有 Loadout，非新增）。 */
const PLAYERS = ['WatermelonHeavyCannon', 'BananaChargeHammer'];

/** 单场驱动（与 M2 底座同口径：真物理 / 真时间步 / 无 RNG）。 */
function fight(playerId: string, encounterId: string) {
  const l = findLoadout(playerId);
  if (!l) throw new Error(`未知 Loadout ${playerId}`);
  return runSingleBattle(l.draft, [], encounterId, null);
}

describe('CONTENT-ENCOUNTER-PLAYABLE-BATCH-R1｜C 2 玩家 × 3 对手真实可重复测量', () => {
  it('CEB-07 三套对手都能真实打到结束（一端耐久归零），失败结论如实保留', () => {
    const rows: string[] = [];
    for (const pid of PLAYERS) {
      for (const eid of EXTENDED_ENCOUNTER_BATCH_IDS) {
        const f = fight(pid, eid);
        rows.push(
          `${pid.padEnd(22)} vs ${eid.padEnd(22)} w=${String(f.winner)} hpA ${Math.round(f.hpA)}/${f.hpAMax} hpB ${Math.round(f.hpB)}/${f.hpBMax} steps=${f.steps} hits=${f.hits}`,
        );
        // 真实终态：分出胜负
        expect(f.winner, `${pid}/${eid}: 必须分出胜负`).not.toBeNull();
        expect(f.steps, `${pid}/${eid}: 真实战斗步数`).toBeGreaterThan(30);
        expect(f.steps, `${pid}/${eid}: 未超过帧上限（非卡死）`).toBeLessThan(MAX_FRAMES);
        // 一端耐久归零（不是摆件 / 不是瞬杀）
        expect(f.hpA === 0 || f.hpB === 0, `${pid}/${eid}: 一端耐久归零`).toBe(true);
        // 开局满耐久（无 carriedHp 污染）
        expect(f.hpA0, `${pid}/${eid}: 开局满耐久`).toBe(f.hpAMax);
      }
    }
    // 机器可读落盘（便于录像前挑选）
    // eslint-disable-next-line no-console
    console.log('\n##### CONTENT-ENCOUNTER-PLAYABLE-BATCH-R1 实测（2 玩家 × 3 对手）#####\n' + rows.join('\n'));
  }, 300_000);

  it('CEB-08 测量**可重复**：同一组合两次跑读数逐字节相同（确定性底座）', () => {
    for (const pid of PLAYERS) {
      const a = fight(pid, 'ExtendedHeavyContact');
      const b = fight(pid, 'ExtendedHeavyContact');
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  }, 300_000);

  it('CEB-09 三套对手**确实不同**（不是同一套换个名字）：至少胜者/终局耐久之一有差异', () => {
    const pid = 'WatermelonHeavyCannon';
    const sigs = EXTENDED_ENCOUNTER_BATCH_IDS.map((eid) => {
      const f = fight(pid, eid);
      return `${f.winner}|${Math.round(f.hpA)}|${Math.round(f.hpB)}`;
    });
    expect(new Set(sigs).size, `三套对手的实测签名应互不相同：${sigs.join(' / ')}`).toBe(3);
  }, 300_000);
});

/* ============================================ D. 清场无残留（必改 3 / 验收 3） */

describe('CONTENT-ENCOUNTER-PLAYABLE-BATCH-R1｜D 清场无残留', () => {
  it('CEB-10 每场新 runtime 从干净开局开始（连续切换三套互不污染）', async () => {
    // 复用正式链路构造运行时（与页面同一条），逐场检查 contactResidue 干净。
    const { RunBattleRuntime } = await import('../src/lab/portraitBattleLab/runBattleRuntime');
    for (const eid of EXTENDED_ENCOUNTER_BATCH_IDS) {
      const rt = new RunBattleRuntime({ encounterId: eid });
      try {
        const cr = rt.contactResidue();
        expect(cr.contact || cr.impact || cr.damage, `${eid}: 新 runtime 不得携带残留`).toBe(false);
        expect(rt.stepCount, `${eid}: 开局步数 0`).toBe(0);
        expect(rt.projectileCount(), `${eid}: 开局无存活弹丸`).toBe(0);
        let frames = 0;
        while (rt.result === null && frames < MAX_FRAMES) {
          rt.step(FRAME_MS);
          frames += 1;
        }
        expect(rt.result, `${eid}: 应在帧上限内结束`).not.toBeNull();
      } finally {
        rt.dispose();
      }
    }
  }, 300_000);
});
