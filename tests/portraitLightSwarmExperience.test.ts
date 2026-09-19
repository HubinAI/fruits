/**
 * PBL-M3-LIGHT-SWARM-EXPERIENCE-VALIDATION-R1｜体验验证套件（targeted）。
 *
 * 唯一目标：证明「3 个弱敌同时出现」这件事在 **Arena A 已经存在的真实多实体能力**上
 * 真的能跑起来，从而给真人一个可判断的对象 —— **不是**补正式 1vN 能力。
 *
 * 覆盖 Queue 技术验收 1-6：
 *   1) 真实出现 3 个独立敌方实体（LSE-07/09/14）
 *   2) 三者各自有独立 vehicleId / HP（LSE-08/10）
 *   3) 敌↔敌、敌↔玩家碰撞正常（LSE-11/12/13）
 *   4) Reset 后无实体 / contact / projectile 残留（LSE-15/16）
 *   5) 不修改正式 Run Runtime（LSE-17/18）
 *   6) targeted + tsc + Lab smoke（本文件 = targeted；smoke = `_e2e_portrait_battle_lab.cjs` 的 L 段）
 *
 * ⚠️ 本套件**刻意不**断言 Queue 里那句「单体明显弱于当前单车 Encounter」—— 实测该前提
 *    在 HP 维度**并不成立**（`LightSwarm3` 单敌 900 = `Chaser` 单敌 900），真实差异是
 *    **质量更低**（105 < 120）与**武器不同**（圆锯 `saw` vs 锤 `hammer`）。本文件只断言
 *    可核实的事实，并把这条差异钉成数据（LSE-06），交由真人裁决（见交接文档「如实上报」）。
 *
 * ⚠️ 本套件也不引入新的物理 / 数值 / 编排：全部走既有 `ArenaARuntime` +
 *    `buildSpawnPlan`，与 PBL-A1 同一套夹具语义。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  PBL_LIGHT_SWARM_VALIDATION,
  type PblLightSwarmValidationDef,
} from '../src/lab/portraitBattleLab/constants';
import { buildSpawnPlan, clearRun, createRunData, isRunClean, spawnRun } from '../src/lab/portraitBattleLab/entities';
import {
  ArenaARuntime,
  arenaAEnemySpawns,
  shapesSeparationPx,
  type ArenaAEntityView,
} from '../src/lab/portraitBattleLab/arenaA';
import {
  LAB_ENCOUNTERS,
  LAB_LOADOUTS,
  findEncounter,
} from '../src/lab/portraitBattleLab/testData';
import { OPPONENT_TEMPLATES } from '../src/player/opponentPool';

/* ------------------------------------------------------------ 夹具 */

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const LAB_DIR = join(REPO_ROOT, 'src', 'lab', 'portraitBattleLab');

const readLab = (file: string): string => readFileSync(join(LAB_DIR, file), 'utf8');
const readRepo = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf8');

/**
 * 剥注释（块 + 行 + HTML）—— 源码守卫必须先剥再匹配。
 * 本文件的注释里**刻意**写着被禁止的字面量（说明为什么要禁），直接匹配会被自家注释骗过。
 */
const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/<!--[\s\S]*?-->/g, '');

const V: PblLightSwarmValidationDef = PBL_LIGHT_SWARM_VALIDATION;

/** 固定物理步长（与 Arena A / PlanckWorld 一致）。 */
const DT = 1000 / 60;
/** 「录 10~20 秒」的下限 = 10s。 */
const STEPS_10S = 600;
/** 真实接触容差（与 PBL-A1 同口径：只排除「穿透量级失真」，不证明零穿透）。 */
const CONTACT_TOLERANCE_PX = 16;

function makeRuntime(loadout: string = V.loadout, encounter: string = V.encounter): ArenaARuntime {
  return new ArenaARuntime(buildSpawnPlan(loadout, encounter));
}

/** 两实体真实几何之间的净距（>0 分离 / <=0 相交）；取最近的一对。 */
function closestGap(a: ArenaAEntityView, b: ArenaAEntityView): number {
  let best = Infinity;
  for (const sa of a.shapes) for (const sb of b.shapes) best = Math.min(best, shapesSeparationPx(sa, sb));
  return best;
}

interface Trace {
  readonly view: ReturnType<ArenaARuntime['view']>;
  readonly minPairDistancePx: number;
  readonly worstOverlapPx: number;
  readonly minEnemyEnemyGapPx: number;
  readonly minEnemyPlayerGapPx: number;
  readonly distinctEnemyHpFrames: number;
}

/** 逐帧真实推进（几何极值每 10 帧采样一次，控制耗时）。 */
function runAndTrace(rt: ArenaARuntime, steps: number): Trace {
  let minPairDistancePx = Infinity;
  let worstOverlapPx = -Infinity;
  let minEnemyEnemyGapPx = Infinity;
  let minEnemyPlayerGapPx = Infinity;
  let distinctEnemyHpFrames = 0;
  for (let i = 0; i < steps; i++) {
    rt.advance(DT);
    const v = rt.view();
    minPairDistancePx = Math.min(minPairDistancePx, v.minPairDistancePx);
    worstOverlapPx = Math.max(worstOverlapPx, v.worstEntityOverlapDepthPx);
    const enemies = v.entities.filter((e) => e.team !== 'A');
    const player = v.entities.find((e) => e.team === 'A');
    if (enemies.length > 1 && new Set(enemies.map((e) => e.hp)).size === enemies.length) {
      distinctEnemyHpFrames += 1;
    }
    if (i % 10 === 0) {
      for (let a = 0; a < enemies.length; a++) {
        for (let b = a + 1; b < enemies.length; b++) {
          minEnemyEnemyGapPx = Math.min(minEnemyEnemyGapPx, closestGap(enemies[a]!, enemies[b]!));
        }
        if (player) minEnemyPlayerGapPx = Math.min(minEnemyPlayerGapPx, closestGap(enemies[a]!, player));
      }
    }
  }
  return {
    view: rt.view(),
    minPairDistancePx,
    worstOverlapPx,
    minEnemyEnemyGapPx,
    minEnemyPlayerGapPx,
    distinctEnemyHpFrames,
  };
}

/** 10 秒真实推进只跑一次（B 段多条断言共用同一份实测）。 */
let cached: Trace | null = null;
function trace10s(): Trace {
  if (!cached) {
    const rt = makeRuntime();
    cached = runAndTrace(rt, STEPS_10S);
    rt.dispose();
  }
  return cached;
}

/* ============================================ A) 组合与复用（零新增敌人 / 零新增数值） */

describe('PBL-M3｜A. 验证组合与复用（零新增敌人 / 零新增数值）', () => {
  it('LSE-01 验证组合 = Arena A + 西瓜重炮 + 3 轻敌人，且页面标记文案齐备（唯一来源 constants.ts）', () => {
    expect(V.queueId).toBe('PBL-M3-LIGHT-SWARM-EXPERIENCE-VALIDATION-R1');
    expect(V.arena).toBe('A');
    expect(V.loadout).toBe('WatermelonHeavyCannon');
    expect(V.encounter).toBe('LightSwarm3');
    expect(V.badgeTitle).toBe('EXPERIENCE VALIDATION ONLY');
    expect(V.badgeSubtitle).toBe('非正式 Run Runtime');
    expect(V.label.length).toBeGreaterThan(0);
    expect(V.question.length).toBeGreaterThan(0);
  });

  it('LSE-02 直接复用既有 LightSwarm3（count=3 / 正式模板 OPP-14），不新增 Encounter', () => {
    const e = findEncounter(V.encounter);
    expect(e, 'LightSwarm3 必须存在于既有数据源').toBeTruthy();
    expect(e!.count).toBe(3);
    expect(e!.templateId).toBe('OPP-14');
    expect(
      OPPONENT_TEMPLATES.some((t) => t.id === 'OPP-14'),
      'OPP-14 必须是正式对手池里的既有模板',
    ).toBe(true);
  });

  it('LSE-03 三敌 = 同一套正式模板复制 3 份（数值零改动，且不与任何新定义耦合）', () => {
    const plan = buildSpawnPlan(V.loadout, V.encounter);
    expect(plan.enemies).toHaveLength(3);
    const fingerprint = (i: number): string =>
      JSON.stringify({
        body: plan.enemies[i]!.bodyDefId,
        hp: plan.enemies[i]!.hp,
        mass: plan.enemies[i]!.totalMass,
        energy: plan.enemies[i]!.totalEnergy,
        fn: plan.enemies[i]!.functionals.map((f) => [f.defId, f.profile.contactDamage, f.profile.projectileDamage, f.profile.cooldownMs]),
      });
    expect(fingerprint(1)).toBe(fingerprint(0));
    expect(fingerprint(2)).toBe(fingerprint(0));
    // 同源到「正式对手池的同一模板」⇒ 不是 Lab 自造的敌人
    const single = buildSpawnPlan(V.loadout, 'Chaser');
    expect(single.enemies).toHaveLength(1);
    expect(plan.enemies[0]!.bodyDefId).toBe('bananaBody');
  });

  it('LSE-04 不新增敌人：Encounter 目录仍是既有 7 套（本 Queue 零新增）', () => {
    expect(LAB_ENCOUNTERS.map((e) => e.id)).toEqual([
      'Chaser',
      'RangedTurret',
      'LightSwarm3',
      'ProtoRusher',
      'PineappleFireBrute',
      'PineappleSawRusher',
      'BananaRodLaser',
    ]);
  });

  it('LSE-05 玩家固定 WatermelonHeavyCannon，且第一轮无 Buff（Lab 无 Modifier 层，天然无强化）', () => {
    const plan = buildSpawnPlan(V.loadout, V.encounter);
    expect(plan.player.bodyDefId).toBe('watermelonBody');
    expect(plan.player.functionals.map((f) => f.defId)).toEqual(['cannon']);
    // 「无 Buff」的结构证据：Lab 的实体解析链只吃 BuildDraft（部件级），不引用强化系统
    const entitiesSrc = stripComments(readLab('entities.ts'));
    expect(entitiesSrc.includes('runModifiers')).toBe(false);
    expect(entitiesSrc.includes('Modifier')).toBe(false);
    const labSrc = stripComments(readLab('lab.ts'));
    expect(labSrc.includes('runModifiers')).toBe(false);
  });

  it('LSE-06 如实钉住 Queue 前提的真实关系：单敌 HP **相同**、质量更低、武器不同（不由本套件美化）', () => {
    const lse = buildSpawnPlan(V.loadout, V.encounter).enemies[0]!;
    const chaser = buildSpawnPlan(V.loadout, 'Chaser').enemies[0]!;
    // 实测：HP 相同（都是香蕉车身 900）⇒ 「单体明显弱」在 HP 维度不成立
    expect(lse.hp).toBe(chaser.hp);
    // 真实差异 1：质量更低（105 < 120）⇒ 更容易被推挤
    expect(lse.totalMass).toBeLessThan(chaser.totalMass);
    // 真实差异 2：武器不同（圆锯 vs 锤）
    expect(lse.functionals[0]!.profile.behavior).toBe('saw');
    expect(chaser.functionals[0]!.profile.behavior).toBe('hammer');
  });
});

/* ============================================ B) 真实多实体 / 独立 HP / 真实碰撞 */

describe('PBL-M3｜B. Arena A 真实多实体（3 独立实体 / 独立 HP / 真实碰撞）', () => {
  it('LSE-07 SpawnPlan = 1 玩家 + 3 敌（同场敌人数由声明给出，不按计数推断）', () => {
    const plan = buildSpawnPlan(V.loadout, V.encounter);
    expect(plan.entities).toHaveLength(4);
    expect(plan.enemies).toHaveLength(3);
    expect(findEncounter(V.encounter)!.count).toBe(plan.enemies.length);
    expect(plan.player.entityId).toBe('player');
    expect(plan.enemies.map((e) => e.entityId)).toEqual(['enemy-1', 'enemy-2', 'enemy-3']);
  });

  it('LSE-08 三者各自有独立 vehicleId（= OwnerTag.vehicleId 的来源 snapshot.id），且与玩家互不相同', () => {
    const plan = buildSpawnPlan(V.loadout, V.encounter);
    const ids = plan.entities.map((e) => e.snapshot.id);
    expect(ids.every((s) => typeof s === 'string' && s.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(4);
    expect(plan.enemies.map((e) => e.snapshot.id)).toEqual([
      'lab-encounter-LightSwarm3-1',
      'lab-encounter-LightSwarm3-2',
      'lab-encounter-LightSwarm3-3',
    ]);
  });

  it('LSE-09 真实物理推进 10s：场上始终是 4 个实体，且 vehicleId 与 SpawnPlan 逐一一致', () => {
    const t = trace10s();
    const plan = buildSpawnPlan(V.loadout, V.encounter);
    expect(t.view.steps).toBeGreaterThanOrEqual(STEPS_10S);
    expect(t.view.entities).toHaveLength(4);
    expect(t.view.entities.map((e) => e.vehicleId)).toEqual(plan.entities.map((e) => e.snapshot.id));
    // 探针通道（Lab → E2E）也必须报同一条真实数据
    expect(t.view.entities.map((e) => e.entityId)).toEqual(plan.entities.map((e) => e.entityId));
  });

  it('LSE-10 三敌各有独立 HP 通道：整段存在大量「三者 HP 互不相同」的帧（实例级伤害各自结算）', () => {
    const t = trace10s();
    expect(t.distinctEnemyHpFrames).toBeGreaterThan(300);
    for (const e of t.view.entities) {
      expect(e.hp).toBeLessThanOrEqual(e.maxHp);
      expect(e.maxHp).toBeGreaterThan(0);
    }
    // 三敌 maxHp 同源（同一模板），但各自 hp 独立读数
    const enemies = t.view.entities.filter((e) => e.team !== 'A');
    expect(new Set(enemies.map((e) => e.maxHp)).size).toBe(1);
    expect(new Set(enemies.map((e) => e.hp)).size).toBeGreaterThan(1);
  });

  it('LSE-11 敌↔敌碰撞正常：三敌之间出现过真实几何接触（不是只靠 AABB 的近似）', () => {
    const t = trace10s();
    expect(t.minEnemyEnemyGapPx).toBeLessThanOrEqual(CONTACT_TOLERANCE_PX);
  });

  it('LSE-12 敌↔玩家碰撞正常：至少一个敌人与玩家出现过真实几何接触', () => {
    const t = trace10s();
    expect(t.minEnemyPlayerGapPx).toBeLessThanOrEqual(CONTACT_TOLERANCE_PX);
    expect(t.minPairDistancePx).toBeLessThan(200);
  });

  it('LSE-13 无穿模：整段最深真实几何重叠不超过 PBL-A1 的同一容差', () => {
    const t = trace10s();
    expect(t.worstOverlapPx).toBeGreaterThanOrEqual(-CONTACT_TOLERANCE_PX);
    expect(t.worstOverlapPx).toBeLessThanOrEqual(CONTACT_TOLERANCE_PX);
  });

  it('LSE-14 三敌纵向同排、横向铺开（同时出现在同一画面内，可判断「拥挤」）', () => {
    const spawns = arenaAEnemySpawns(3);
    expect(spawns).toHaveLength(3);
    expect(new Set(spawns.map((s) => s.x)).size).toBe(3);
    expect(new Set(spawns.map((s) => s.y)).size).toBe(1);
    const xs = spawns.map((s) => s.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0);
  });
});

/* ============================================ C) 清场无残留 / 边界守卫 */

describe('PBL-M3｜C. 清场无残留 + 不修改正式 Run Runtime（结构守卫）', () => {
  it('LSE-15 dispose 后不再产生开火 / 命中（真实行为与 contact 监听都已释放）', () => {
    const rt = makeRuntime();
    for (let i = 0; i < 120; i++) rt.advance(DT);
    const before = rt.view();
    expect(before.shotsFired).toBeGreaterThan(0);
    rt.dispose();
    for (let i = 0; i < 120; i++) rt.advance(DT);
    const after = rt.view();
    expect(after.shotsFired).toBe(before.shotsFired);
    expect(after.hits).toBe(before.hits);
  });

  it('LSE-16 重复一批又一批：新批次结果与首批逐值一致（上一批无残留影响），且 clearRun 判据为「已清空」', () => {
    const sample = (steps: number): string => {
      const rt = makeRuntime();
      for (let i = 0; i < steps; i++) rt.advance(DT);
      const v = rt.view();
      const s = JSON.stringify(
        v.entities.map((e) => [e.entityId, e.vehicleId, Math.round(e.hp * 1000), Math.round(e.x * 100), Math.round(e.y * 100)]),
      );
      rt.dispose();
      return s;
    };
    const first = sample(240);
    const second = sample(240);
    expect(second).toBe(first);

    // Reset 语义（Lab 侧清场的底层判据）：实体 / 弹丸 / plan 全部清空
    const run = spawnRun(V.loadout, V.encounter, 1);
    expect(isRunClean(clearRun(run))).toBe(true);
    expect(isRunClean(createRunData())).toBe(true);
    expect(clearRun(run).spawnSerial).toBe(run.spawnSerial);
  });

  it('LSE-17 不修改正式 Run Runtime：正式适配与 1v1 编排器源码里没有本验证入口的任何痕迹', () => {
    for (const rel of [
      'src/lab/portraitBattleLab/runBattleRuntime.ts',
      'src/battle/planckBattleOrchestrator.ts',
    ]) {
      const code = stripComments(readRepo(rel));
      expect(code.includes('LightSwarm'), `${rel} 不得为多单位验证做改动`).toBe(false);
      expect(code.includes('PBL_LIGHT_SWARM'), `${rel} 不得引用验证入口`).toBe(false);
      expect(code.includes('EXPERIENCE VALIDATION'), `${rel} 不得携带验证标记`).toBe(false);
    }
  });

  it('LSE-18 Lab 侧不接正式 1v1 编排器、不新增 1vN 编排（多实体全部由既有 Arena A 承担）', () => {
    for (const f of ['lab.ts', 'arenaA.ts', 'constants.ts']) {
      const code = stripComments(readLab(f));
      expect(code.includes('PlanckBattleOrchestrator')).toBe(false);
      expect(code.includes('planckBattleOrchestrator')).toBe(false);
    }
    // 多实体宿主只可能是 Arena A（`sources` = 玩家 + 全部敌人，逐辆装配）
    const arenaSrc = readLab('arenaA.ts');
    expect(arenaSrc.includes('...arenaAEnemySpawns(plan.enemies.length)')).toBe(true);
    expect(arenaSrc.includes('[plan.player, ...plan.enemies]')).toBe(true);
  });

  it('LSE-19 页面必须明确标记 EXPERIENCE VALIDATION ONLY / 非正式 Run Runtime（标记来自常量，非硬编码散落）', () => {
    const labSrc = readLab('lab.ts');
    expect(labSrc.includes('buildValidationBanner')).toBe(true);
    expect(labSrc.includes('v.badgeTitle')).toBe(true);
    expect(labSrc.includes('v.badgeSubtitle')).toBe(true);
    expect(labSrc.includes('pbl-validation-banner')).toBe(true);
    // 页面壳：条幅样式必须真实存在于 HTML（否则条幅只是无名 div）
    const html = readRepo('portrait-lab.html');
    expect(html.includes('.pbl-validation-banner')).toBe(true);
    expect(html.includes('.pbl-vb-title')).toBe(true);
  });

  it('LSE-20 只增加一个明确入口/按钮（不新建页面、不新建 Runtime）', () => {
    const labSrc = stripComments(readLab('lab.ts'));
    expect(labSrc.split("mkGroup('体验验证'").length - 1).toBe(1);
    expect(labSrc.includes('PBL_LIGHT_SWARM_VALIDATION.label')).toBe(true);
    // 一键进入必须复用既有状态机，不得自造第二套驱动
    const fn = stripComments(readLab('lab.ts'));
    for (const api of ['setArena(', 'setLoadout(', 'setEncounter(', 'start(']) {
      expect(fn.includes(api), `一键入口必须走既有状态机 ${api}`).toBe(true);
    }
  });

  it('LSE-21 可选 A/B（Twin Cannon）**未做**这件事必须如实披露，且保持单玩家版本', () => {
    expect(V.abNotDone).toContain('twinCannon');
    expect(V.abNotDone).toContain('未做');
    // 单玩家版本 = Loadout 目录仍是既有 2 项（没有为 A/B 悄悄加一个玩家）
    expect(LAB_LOADOUTS.map((l) => l.id)).toEqual(['WatermelonHeavyCannon', 'BananaChargeHammer']);
  });

  it('LSE-22 不新增数值：LightSwarm3 条目里只有「数量」没有手写战斗数字', () => {
    const src = readLab('testData.ts');
    const start = src.indexOf("id: 'LightSwarm3'");
    expect(start).toBeGreaterThan(0);
    const block = stripComments(src.slice(start, src.indexOf('},', start) + 2));
    expect(block).toContain('count: 3');
    for (const forbidden of ['hp', 'damage', 'speed', 'mass', 'restitution', 'cooldown']) {
      expect(block.includes(forbidden), `LightSwarm3 条目不得手写 ${forbidden}`).toBe(false);
    }
  });
});
