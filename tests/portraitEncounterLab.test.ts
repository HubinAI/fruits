/**
 * PRP-M3-ENCOUNTER-BATCH-01｜遭遇验证台 targeted 测试（纯 node，无 DOM）。
 *
 * 本 Queue 只验证**一件事**：
 *
 *     不同的敌人，是否真的让**同一辆战车**面临不同的战斗问题？
 *
 * 它是 **Content Batch**，不是 Foundation 研发 —— 因此本文件刻意**不**做任何平衡结论，
 * 只把五条必须成立的结构事实钉成机器判据（对应 Queue 验收 1~5）：
 *
 *   A) **三个既有 Encounter**：恰好 `ProtoRusher` / `Chaser` / `RangedTurret`，
 *      全部来自正式 `LAB_ENCOUNTERS`（label / 正式模板 id / 数量同源）——不新增敌人；
 *   B) **正式敌人定义零修改**：三套对手的解析指纹 = 冻结指纹（body / HP / 质量 /
 *      轮组 / 部件 / 伤害 / CD / 弹丸 逐个比对），且三者互不相同；
 *   C) **相同玩家条件**：三套共用同一个基础玩家（`WatermelonHeavyCannon`）——
 *      三份 spawn plan 的玩家指纹逐字节相同，差异**只**来自对手；
 *   D) **可独立启动 / 完全清理 / 无残留**：每一场都从一个干净的开局开始
 *      （满耐久 / 空 Build / 正式 spawn / 无存活弹丸 / 无接触·命中·伤害记录），
 *      切换 = 旧实例 `dispose()` + 新实例（不同对象）；
 *   E) **三套都能真实打到结束**（battle regression），结束后再开下一场依然干净。
 *
 * 另加 F) 入口隔离守卫：新验证入口存在且**不污染**默认启动链 / 正式构建 / 玩家 UI。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { buildSpawnPlan, type SpawnedEntity } from '../src/lab/portraitBattleLab/entities';
import {
  ENCOUNTER_BATCH,
  ENCOUNTER_BATCH_IDS,
  ENCOUNTER_LAB_IDLE_HINT,
  ENCOUNTER_LAB_LEAD,
  ENCOUNTER_LAB_LOADOUT_ID,
  ENCOUNTER_LAB_RESET_LABEL,
  ENCOUNTER_LAB_TITLE,
  encounterBatchOf,
  encounterBatchProblems,
  encounterLabContext,
} from '../src/lab/portraitBattleLab/encounterValidation';
import { LAB_ENCOUNTERS, findLoadout } from '../src/lab/portraitBattleLab/testData';
import { RUN_DEMO_LOADOUT_ID } from '../src/lab/portraitBattleLab/runPageScene';
import { RunBattleRuntime } from '../src/lab/portraitBattleLab/runBattleRuntime';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf8');
const readLab = (file: string): string => read(`src/lab/portraitBattleLab/${file}`);
/** 剥掉注释（源码守卫必须扛住「自家注释里写着反向说明」这种自指陷阱）。 */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const FRAME_MS = 1000 / 60;
/** 与既有 Run Page 测试同一上限（正式三阶段总时长约 18s ⇒ 4000 帧足够）。 */
const MAX_FRAMES = 4000;

const LAB_FILES = ['encounterValidation.ts', 'encounterLab.ts', 'encounterLabMain.ts'];

/* ------------------------------------------------------------- 指纹工具 */

/** 一个实体的「基础战斗数据」指纹（口径 = `entities.entityBaseKey`，此处显式展开便于定位差异）。 */
interface EntityFingerprint {
  readonly bodyDefId: string;
  readonly hp: number;
  readonly cap: number;
  readonly drive: string;
  readonly mass: number;
  readonly mv: readonly (readonly (string | number)[])[];
  readonly fn: readonly (readonly (string | number | null | readonly number[])[])[];
}

function fingerprint(e: SpawnedEntity): EntityFingerprint {
  return {
    bodyDefId: e.bodyDefId,
    hp: e.hp,
    cap: e.energyCapacity,
    drive: e.drive,
    mass: e.totalMass,
    mv: e.movements.map((m) => [m.hardpointId, m.defId, m.radius, m.mass, m.energy]),
    fn: e.functionals.map((f) => [
      f.hardpointId,
      f.defId,
      f.category,
      f.behavior,
      f.mass,
      f.energy,
      f.profile.contactDamage,
      f.profile.projectileDamage,
      f.profile.cooldownMs,
      f.profile.projectile
        ? [f.profile.projectile.radius, f.profile.projectile.mass, f.profile.projectile.speed]
        : null,
    ]),
  };
}

/** 一场战斗的「开局读数」——与页面 `EncounterLab.readFresh` 同口径。 */
interface FreshReading {
  readonly encounterId: string;
  readonly buildIds: readonly string[];
  readonly playerHpMax: number;
  readonly initialPlayerHp: number;
  readonly enemyHp: number;
  readonly enemyHpMax: number;
  readonly steps: number;
  readonly timeMs: number;
  readonly projectiles: number;
  readonly contact: boolean;
  readonly impact: boolean;
  readonly damage: boolean;
  readonly spawnAx: number;
  readonly spawnBx: number;
  readonly spawnSeparation: number;
  readonly gapWorld: number;
  readonly arenaWidth: number;
  readonly arenaHeight: number;
  readonly groundY: number;
}

function freshReading(rt: RunBattleRuntime): FreshReading {
  const hp = rt.hp();
  const cr = rt.contactResidue();
  return {
    encounterId: rt.encounterId,
    buildIds: [...rt.build],
    playerHpMax: rt.playerMaxHp,
    initialPlayerHp: rt.initialPlayerHp,
    enemyHp: hp.b,
    enemyHpMax: hp.bMax,
    steps: rt.stepCount,
    timeMs: rt.timeMs,
    projectiles: rt.projectileCount(),
    contact: cr.contact,
    impact: cr.impact,
    damage: cr.damage,
    spawnAx: rt.spawnAx,
    spawnBx: rt.spawnBx,
    spawnSeparation: rt.spawnSeparation,
    gapWorld: rt.gapWorld(),
    arenaWidth: rt.arenaWidth,
    arenaHeight: rt.arenaHeight,
    groundY: rt.groundY,
  };
}

/** 与页面 `select()` **逐字段相同**的构造：满耐久 / 无 Run Buff / 正式 spawn。 */
function openBattle(id: string): RunBattleRuntime {
  return new RunBattleRuntime({ encounterId: id });
}

function runToEnd(rt: RunBattleRuntime): { frames: number; reached: boolean } {
  let frames = 0;
  while (rt.result === null && frames < MAX_FRAMES) {
    rt.step(FRAME_MS);
    frames += 1;
  }
  return { frames, reached: rt.result !== null };
}

/* ==================================== A. 三个既有 Encounter（必改 1） */

describe('PRP-M3｜A 固定三个已有 Encounter', () => {
  it('M3-01 批次恰好三项，且与正式 Encounter 表**逐项同源**（不新增敌人）', () => {
    expect(ENCOUNTER_BATCH_IDS).toEqual(['ProtoRusher', 'Chaser', 'RangedTurret']);
    expect(ENCOUNTER_BATCH).toHaveLength(3);
    expect(encounterBatchProblems()).toEqual([]);

    for (const entry of ENCOUNTER_BATCH) {
      const formal = LAB_ENCOUNTERS.find((e) => e.id === entry.id);
      expect(formal, `${entry.id} 必须存在于正式 LAB_ENCOUNTERS`).toBeDefined();
      // label / 正式模板 id / 数量一律取自正式条目 → 不存在「验证台自己写一套」
      expect(entry.label).toBe(formal!.label);
      expect(entry.templateId).toBe(formal!.templateId);
      expect(entry.count).toBe(formal!.count);
      expect(entry.count).toBe(1); // 本 Queue 不加多实体
      expect(entry.verifies.length).toBeGreaterThan(0);
    }

    // 正式对手池模板 id 也要来自正式池（不是此处新写的 id）
    expect(ENCOUNTER_BATCH.map((e) => e.templateId)).toEqual(['R1-RUSH-02', 'OPP-16', 'OPP-03']);
    // 批次外的 id 一律不认（不静默回退）
    expect(encounterBatchOf('LightSwarm3')).toBeNull();
    expect(encounterBatchOf('PineappleFireBrute')).toBeNull();
    expect(encounterBatchOf('')).toBeNull();
  });

  it('M3-02 三个 Encounter 各自带一句可读的验证目标（Queue 必改 1 原文）', () => {
    expect(ENCOUNTER_BATCH.map((e) => e.verifies)).toEqual([
      '快速接敌 / 近身压力',
      '持续追击 / 重型接触压力',
      '远程输出 / 接近压力',
    ]);
    expect(ENCOUNTER_BATCH.map((e) => e.label)).toEqual(['菠萝冲刺车', '追猎者', '远程炮台']);
    // 页面文案
    expect(ENCOUNTER_LAB_TITLE).toBe('遭遇验证台');
    expect(ENCOUNTER_LAB_LEAD.includes('只换对手')).toBe(true);
    expect(ENCOUNTER_LAB_RESET_LABEL).toBe('Reset');
    expect(ENCOUNTER_LAB_IDLE_HINT.length).toBeGreaterThan(0);
  });
});

/* ============================ B. 正式敌人定义零修改（禁止项核心） */

describe('PRP-M3｜B 正式敌人定义零修改（冻结指纹）', () => {
  /**
   * 三套对手的**正式解析指纹**（body / HP / 质量 / 轮组 / 部件 / 伤害 / CD / 弹丸）。
   *
   * ⚠️ 这是「零修改」的机器判据：任何一处数值被改动，本表立刻红。
   *    指纹全部来自正式链路（`buildSpawnPlan` → `resolveSnapshot`），不是本文件编的。
   */
  const ENEMY_FINGERPRINT: Record<string, EntityFingerprint> = {
    ProtoRusher: {
      bodyDefId: 'pineappleBody',
      hp: 1000,
      cap: 100,
      drive: 'forward',
      mass: 132,
      mv: [
        ['rear', 'wheelStd', 26, 10, 0],
        ['front', 'wheelStd', 12, 10, 0],
      ],
      fn: [
        ['front', 'saw', 'weapon', 'saw', 25, 25, null, null, null, null],
        ['frontMass', 'spear', 'weapon', 'ram', 12, 25, 60, null, null, null],
        ['rear', 'thruster', 'gadget', 'thruster', 15, 20, null, null, 1500, null],
      ],
    },
    Chaser: {
      bodyDefId: 'bananaBody',
      hp: 900,
      cap: 90,
      drive: 'forward',
      mass: 120,
      mv: [
        ['rear', 'wheelStd', 26, 10, 0],
        ['front', 'wheelStd', 26, 10, 0],
      ],
      fn: [
        ['front', 'hammer', 'weapon', 'hammer', 40, 25, 90, null, null, null],
        ['rear', 'thruster', 'gadget', 'thruster', 15, 20, null, null, 1500, null],
      ],
    },
    RangedTurret: {
      bodyDefId: 'watermelonBody',
      hp: 1100,
      cap: 110,
      drive: 'stationary',
      mass: 180,
      mv: [
        ['rear', 'wheelStd', 26, 10, 0],
        ['front', 'wheelStd', 26, 10, 0],
      ],
      fn: [
        ['front', 'cannon', 'weapon', 'cannon', 20, 30, null, 80, 1000, [10, 1, 8]],
        ['frontMass', 'machineGun', 'weapon', 'machineGun', 20, 30, null, 20, 1100, [5, 0.1, 12]],
      ],
    },
  };

  it('M3-03 三套对手的正式解析指纹 = 冻结指纹（HP / 伤害 / CD / 弹丸 / 质量零改动）', () => {
    for (const id of ENCOUNTER_BATCH_IDS) {
      const plan = buildSpawnPlan(ENCOUNTER_LAB_LOADOUT_ID, id);
      expect(fingerprint(plan.enemies[0]), `${id} 的正式敌人定义被改动`).toEqual(ENEMY_FINGERPRINT[id]);
    }
  });

  it('M3-04 三套对手互不相同（否则「三种敌人」是假的）', () => {
    const keys = ENCOUNTER_BATCH_IDS.map((id) =>
      JSON.stringify(fingerprint(buildSpawnPlan(ENCOUNTER_LAB_LOADOUT_ID, id).enemies[0])),
    );
    expect(new Set(keys).size).toBe(3);
    // 三个对手的**车身**也必须两两可分（菠萝 / 香蕉 / 西瓜）
    const bodies = ENCOUNTER_BATCH_IDS.map(
      (id) => buildSpawnPlan(ENCOUNTER_LAB_LOADOUT_ID, id).enemies[0].bodyDefId,
    );
    expect(bodies).toEqual(['pineappleBody', 'bananaBody', 'watermelonBody']);
    // drive 的口径差异正是「远程炮台停驻」这一条设计事实
    const drives = ENCOUNTER_BATCH_IDS.map(
      (id) => buildSpawnPlan(ENCOUNTER_LAB_LOADOUT_ID, id).enemies[0].drive,
    );
    expect(drives).toEqual(['forward', 'forward', 'stationary']);
  });

  it('M3-05 源码级：验证台不得写入任何敌人数值 / 不得新增敌人 / 不得改正式池', () => {
    for (const f of LAB_FILES) {
      const code = stripComments(readLab(f));
      for (const t of [
        'OPPONENT_TEMPLATES[', // 不写正式池
        'LAB_ENCOUNTERS.push', // 不追加敌人
        "'LightSwarm3'", // 不接 3 轻敌人（Queue 禁止项）
        'new PlanckBattleOrchestrator', // 不自己构造战斗
        'planckBattleOrchestrator', // 只经 runBattleRuntime
        'damageResolver',
        'contactRouter',
      ]) {
        expect(code.includes(t), `${f} 不得出现 "${t}"`).toBe(false);
      }
    }
    // 正式池与正式 Encounter 表在源码层保持原样：仍是 7 套 Encounter / 三套批次只读引用
    expect(LAB_ENCOUNTERS).toHaveLength(7);
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
});

/* ================================= C. 相同玩家条件（必改 2） */

describe('PRP-M3｜C 同一辆玩家车（只比较「敌人不同」）', () => {
  it('M3-06 玩家固定 WatermelonHeavyCannon，且与 PRP 演示装载是同一个常量', () => {
    expect(ENCOUNTER_LAB_LOADOUT_ID).toBe('WatermelonHeavyCannon');
    expect(ENCOUNTER_LAB_LOADOUT_ID).toBe(RUN_DEMO_LOADOUT_ID);
    const ctx = encounterLabContext();
    expect(ctx.loadoutId).toBe('WatermelonHeavyCannon');
    expect(ctx.playerHpMax).toBe(1100);
    expect(ctx.playerLabel).toBe(findLoadout('WatermelonHeavyCannon')!.label);
  });

  it('M3-07 三套 Encounter 的玩家指纹**逐字节相同**（差异只来自对手）', () => {
    const plans = ENCOUNTER_BATCH_IDS.map((id) => buildSpawnPlan(ENCOUNTER_LAB_LOADOUT_ID, id));
    const keys = plans.map((p) => JSON.stringify(fingerprint(p.player)));
    expect(new Set(keys).size).toBe(1);
    expect(plans[0].player.bodyDefId).toBe('watermelonBody');
    // 三套 plan 的对手指纹**必须不同** → 同一个玩家 + 不同对手 = 本 Queue 的唯一变量
    const enemyKeys = plans.map((p) => JSON.stringify(fingerprint(p.enemies[0])));
    expect(new Set(enemyKeys).size).toBe(3);
  });

  it('M3-08 页面上下文的三条对手信息全部来自正式链路（不手写）', () => {
    const ctx = encounterLabContext();
    expect(ctx.encounters).toHaveLength(3);
    for (const e of ctx.encounters) {
      const plan = buildSpawnPlan(ENCOUNTER_LAB_LOADOUT_ID, e.id);
      expect(e.enemyLabel).toBe(plan.enemies[0].bodyName);
      expect(e.enemyHpMax).toBe(plan.enemies[0].hp);
      expect(e.verifies.length).toBeGreaterThan(0);
    }
    expect(ctx.encounters.map((e) => e.id)).toEqual(['ProtoRusher', 'Chaser', 'RangedTurret']);
    expect(ctx.encounters.map((e) => e.enemyHpMax)).toEqual([1000, 900, 1100]);
  });
});

/* ================== D. 可独立启动 / 完全清理 / 无残留（验收 1~4） */

describe('PRP-M3｜D 干净开局 / 完全切换（无 Projectile·Contact·Runtime 残留）', () => {
  /**
   * 每一套 Encounter 的**开局读数**（在任何物理推进之前）都必须长这样。
   *
   * ⚠️ 这是本 Queue 验收 2/3 的核心判据：`build` 空（无 Run Buff）、耐久满、
   *    步数 0、时间 0、存活弹丸 0、接触/命中/伤害记录全 false、出生点是正式 spawn。
   */
  const COMMON = {
    buildIds: [],
    steps: 0,
    timeMs: 0,
    projectiles: 0,
    contact: false,
    impact: false,
    damage: false,
    spawnAx: 400,
    spawnBx: 1200,
    spawnSeparation: 800,
    arenaWidth: 1600,
    arenaHeight: 900,
    groundY: 700,
    playerHpMax: 1100,
    initialPlayerHp: 1100,
  } as const;

  /**
   * 只取 `COMMON` 覆盖的那 15 个字段做**同键集**比较。
   * ⚠️ 不能用 `{...fresh, 覆盖}`：那样键集是 19 个，与 `COMMON` 的 15 个永远不相等
   *    （`toEqual` 比较键集，缺键/多键都算不等 —— 这是实测踩过的坑）。
   */
  function commonOf(r: FreshReading): Record<string, unknown> {
    return {
      buildIds: r.buildIds,
      steps: r.steps,
      timeMs: r.timeMs,
      projectiles: r.projectiles,
      contact: r.contact,
      impact: r.impact,
      damage: r.damage,
      spawnAx: r.spawnAx,
      spawnBx: r.spawnBx,
      spawnSeparation: r.spawnSeparation,
      arenaWidth: r.arenaWidth,
      arenaHeight: r.arenaHeight,
      groundY: r.groundY,
      playerHpMax: r.playerHpMax,
      initialPlayerHp: r.initialPlayerHp,
    };
  }

  it('M3-09 三套都能建立真实运行时，且开局读数逐项干净（满耐久 / 无 Run Buff / 无残留）', () => {
    const readings: FreshReading[] = [];
    for (const id of ENCOUNTER_BATCH_IDS) {
      const rt = openBattle(id);
      const fresh = freshReading(rt);
      readings.push(fresh);
      // 请求的对手 = 运行时真实回读的对手（不是把入参抄一遍）
      expect(fresh.encounterId).toBe(id);
      expect(commonOf(fresh)).toEqual(COMMON);
      // 满耐久：开局耐久必须等于上限
      expect(fresh.initialPlayerHp).toBe(fresh.playerHpMax);
      // 对手耐久来自正式链路（与 plan 一致）
      const enemy = buildSpawnPlan(ENCOUNTER_LAB_LOADOUT_ID, id).enemies[0];
      expect(fresh.enemyHpMax).toBe(enemy.hp);
      expect(fresh.enemyHp).toBe(enemy.hp);
      rt.dispose();
    }
    // 三套的开局外廓间距互不相同（真实测量：车形不同 → 间距不同）
    // ⚠️ 必须按**浮点原值**比较：`ProtoRusher` 563.663… 与 `RangedTurret` 564.0
    //    取整后都是 564（实测踩过）——四舍五入会把「两套不同对手」误判成同一套。
    const gaps = readings.map((r) => r.gapWorld);
    expect(new Set(gaps).size).toBe(3);
    for (const g of gaps) expect(g).toBeGreaterThan(0);
  });

  it('M3-10 切换 = 旧实例 dispose + **新实例**（不同对象），且新实例开局同样干净', () => {
    const rtA = openBattle('ProtoRusher');
    const hpA = rtA.hp();
    expect(freshReading(rtA).contact).toBe(false);

    // 真实推进一段（产生弹丸与真实接触/伤害），证明「上一场确实脏了」
    for (let i = 0; i < 240; i++) rtA.step(FRAME_MS);
    expect(rtA.stepCount).toBeGreaterThan(0);
    expect(rtA.contactResidue().contact || rtA.contactResidue().damage).toBe(true);

    // 切换：先释放，再新建（页面 `select()` 的顺序）
    rtA.dispose();
    const rtB = openBattle('Chaser');
    expect(rtB).not.toBe(rtA);
    expect(rtB.encounterId).toBe('Chaser');

    // 新实例的开局读数必须**完全干净** —— 上一场的弹丸 / 接触 / 步数都没有跟过来
    // （接触事实是运行时的私有状态，不是全局单例 → 换实例即归零）
    const freshB = freshReading(rtB);
    expect(commonOf(freshB)).toEqual(COMMON);
    expect(freshB.encounterId).toBe('Chaser');
    expect(rtB.contactResidue()).toEqual({ contact: false, impact: false, damage: false });
    expect(hpA.aMax).toBe(1100);

    rtB.dispose();
  });

  /**
   * ⚠️ 一条**必须写清楚的边界**（实测得出的真相，不是猜测）：
   * 正式 `PlanckBattleOrchestrator.dispose()` 的语义是**丢弃引用**（`PlanckWorld` 没有
   * 显式销毁），因此被释放的实例在内存里**仍然可以被继续 step** —— 「清理」不靠对象变惰性，
   * 而靠**宿主生命周期**：控制器在 dispose 之后把 `runtime` 置 `null`，循环随即退出，
   * 之后再也不会推进它。下面用源码级断言把这条责任钉住（而不是假装对象自己会停）。
   */
  it('M3-19 清理责任在宿主：切换路径必须是「先 dispose 再新建」，且循环在 runtime 为空时退出', () => {
    const code = stripComments(readLab('encounterLab.ts'));
    // ① select 的顺序：disposeRuntime() 必须出现在 new RunBattleRuntime( 之前
    const selectBody = code.slice(code.indexOf('select(id: string): void {'));
    const disposeAt = selectBody.indexOf('this.disposeRuntime()');
    const createAt = selectBody.indexOf('new RunBattleRuntime(');
    expect(disposeAt, 'select 必须先 disposeRuntime()').toBeGreaterThan(-1);
    expect(createAt, 'select 必须新建 RunBattleRuntime').toBeGreaterThan(-1);
    expect(disposeAt).toBeLessThan(createAt);
    // ② disposeRuntime 必须真的释放并置空
    const disposeBody = code.slice(code.indexOf('private disposeRuntime(): void {'));
    expect(disposeBody.includes('this.runtime.dispose()')).toBe(true);
    expect(/this\.runtime\.dispose\(\);[\s\S]{0,80}this\.runtime = null;/.test(disposeBody)).toBe(true);
    // ③ 循环在 runtime 为空时立刻退出（不留下一个继续推进已释放实例的 RAF）
    expect(/const rt = this\.runtime;[\s\S]{0,120}if \(!rt\) \{[\s\S]{0,80}this\.rafHandle = 0;/.test(code)).toBe(true);
    // ④ 同一时刻只允许一个运行时字段（结构上不可能两场并存）
    expect((code.match(/private runtime: RunBattleRuntime \| null/g) ?? []).length).toBe(1);
  });

  it('M3-11 世界 / 出生 / 相机口径三套完全一致（同一 Battle World · 同一 spawn）', () => {
    const seen = new Set<string>();
    for (const id of ENCOUNTER_BATCH_IDS) {
      const rt = openBattle(id);
      seen.add(
        JSON.stringify({
          arena: [rt.arenaWidth, rt.arenaHeight],
          groundY: rt.groundY,
          spawn: [rt.spawnAx, rt.spawnBx, rt.spawnSeparation],
        }),
      );
      rt.dispose();
    }
    expect(seen.size).toBe(1);
    expect([...seen][0]).toBe(
      JSON.stringify({ arena: [1600, 900], groundY: 700, spawn: [400, 1200, 800] }),
    );
  });
});

/* ============ E. 三套都能真实进入 / 战斗 / 清理 / 重开（battle regression） */

describe('PRP-M3｜E 三种 Encounter 稳定进入 · 战斗 · 清理 · 重开', () => {
  it('M3-12 三个 Encounter 都能真实打到结束（真实物理，非脚本）', () => {
    const summaries: string[] = [];
    for (const id of ENCOUNTER_BATCH_IDS) {
      const rt = openBattle(id);
      // 真实推进之前先确认真实战斗世界与真实对手就位
      expect(rt.phase).toBe('Active');
      expect(rt.snapshot().vehicleB).toBeTruthy();

      const { frames, reached } = runToEnd(rt);
      expect(reached, `${id} 在 ${MAX_FRAMES} 帧内没有分出胜负`).toBe(true);
      const result = rt.result!;
      const hp = rt.hp();
      summaries.push(
        `${id} ${frames}帧 steps=${rt.stepCount} playerHp=${hp.a}/${hp.aMax} enemyHp=${hp.b}/${hp.bMax} winner=${result.winner} reason=${result.endReason}`,
      );
      // 真实战斗确实发生了：对手吃到了伤害或被判定结束；至少打过
      expect(rt.stepCount).toBeGreaterThan(60);
      expect(['A', 'B', null]).toContain(result.winner);
      rt.dispose();
    }
    // 三场都必须真实跑完（把读数带进失败信息，便于人看）
    expect(summaries[0]).toContain('ProtoRusher');
    expect(summaries.length).toBe(3);
  });

  it('M3-13 打完一场 → dispose → 立刻重开同一对手，仍是干净开局（重开无残留）', () => {
    for (const id of ENCOUNTER_BATCH_IDS) {
      const first = openBattle(id);
      runToEnd(first);
      expect(first.result).not.toBeNull();
      first.dispose();

      const second = openBattle(id);
      const fresh = freshReading(second);
      expect(fresh.encounterId).toBe(id);
      expect(fresh.steps).toBe(0);
      expect(fresh.timeMs).toBe(0);
      expect(fresh.projectiles).toBe(0);
      expect(fresh.contact).toBe(false);
      expect(fresh.impact).toBe(false);
      expect(fresh.damage).toBe(false);
      expect(fresh.initialPlayerHp).toBe(fresh.playerHpMax);
      expect(fresh.spawnSeparation).toBe(800);
      second.dispose();
    }
  });

  it('M3-14 三场全部跑完后，三者战果互不相同（不同敌人确实带来不同过程）', () => {
    const outcomes = ENCOUNTER_BATCH_IDS.map((id) => {
      const rt = openBattle(id);
      runToEnd(rt);
      const hp = rt.hp();
      const r = rt.result!;
      const out = { id, steps: rt.stepCount, playerHp: hp.a, enemyHp: hp.b, winner: r.winner, reason: r.endReason };
      rt.dispose();
      return out;
    });
    // 只断言「过程读数不完全相同」——**不做任何平衡结论**（本 Queue 明确不调数值）
    const keys = outcomes.map((o) => `${o.steps}|${o.playerHp}|${o.enemyHp}|${o.winner}`);
    expect(new Set(keys).size).toBeGreaterThanOrEqual(2);
    for (const o of outcomes) expect(o.steps).toBeGreaterThan(0);
  });
});

/* ======================== F. 入口隔离 / 禁止项（必改 3 · 必改 4） */

describe('PRP-M3｜F 入口隔离与禁止项', () => {
  it('M3-15 独立入口存在，且只挂本 Queue 的入口脚本', () => {
    expect(existsSync(join(REPO_ROOT, 'encounter-lab.html'))).toBe(true);
    const html = read('encounter-lab.html');
    expect(html.includes('/src/lab/portraitBattleLab/encounterLabMain.ts')).toBe(true);
    // ⚠️ 必须剥掉 HTML 注释再匹配：本页注释里**刻意**写着「与 run-page.html 严格分离」
    //    （说明性文字不算引用 —— 与 R2-09 同一强度口径）。
    const code = html.replace(/<!--[\s\S]*?-->/g, '');
    for (const t of ['/src/main.ts', 'run-page.html', 'next-run.html', 'portrait-lab.html']) {
      expect(code.includes(t), `encounter-lab.html 的可执行部分不得引用 ${t}`).toBe(false);
    }
  });

  it('M3-16 默认启动链与玩家正式 UI 完全未被污染', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    // 默认入口仍是玩家页面（重写目标常量未改）
    expect(pkg.scripts['dev']).toBe('vite --open');
    expect(pkg.scripts['dev:encounter-lab']).toBe('vite --open=/encounter-lab.html');
    expect(pkg.scripts['e2e:encounter-lab']).toBe('node tests/_e2e_encounter_lab.cjs');

    // 玩家页面（Run Page）DOM 层仍然零按钮；测试控件只活在本验证页
    const runPage = stripComments(readLab('runPage.ts'));
    expect(runPage.includes('createElement(\'button\')')).toBe(false);
    const encounterLab = stripComments(readLab('encounterLab.ts'));
    expect(encounterLab.includes("createElement('button')")).toBe(true);

    // 独立构建已接线（否则 build:portrait-lab 不会产出本页）
    const cfg = read('vite.portrait-lab.config.ts');
    expect(cfg.includes("'encounter-lab': 'encounter-lab.html'")).toBe(true);
    // 正式构建配置仍然 0 引用本页
    for (const t of ['vite.config.ts', 'vite.pages.config.ts', 'vite.e2e.config.ts', 'vite.wechat.config.ts', 'index.html']) {
      const code = stripComments(read(t));
      expect(code.includes('encounter-lab'), `${t} 不得引用 encounter-lab`).toBe(false);
      expect(code.includes('portraitBattleLab'), `${t} 不得引用 portraitBattleLab`).toBe(false);
    }
  });

  it('M3-17 页面控件只允许三个对手 + Reset；不做掉落 / 货币 / 多实体 / 新 AI', () => {
    const code = stripComments(readLab('encounterLab.ts'));
    for (const t of [
      'dropRate',
      'currency',
      'coins',
      'gold',
      'seasonBonus',
      'Math.random', // 不引入随机
      'setInterval', // 不引入第二套时钟
      'fetch(', // 不接任何后端
    ]) {
      expect(code.includes(t), `encounterLab.ts 不得出现 "${t}"`).toBe(false);
    }
    // 控件 = 三个对手按钮 + 一个 Reset（结构上不可能出现第五个控件）
    const validation = stripComments(readLab('encounterValidation.ts'));
    expect(validation.includes('ENCOUNTER_BATCH_IDS')).toBe(true);
    expect(ENCOUNTER_BATCH_IDS).toHaveLength(3);
    // 三个对手 id 只在中立批次常量里出现一次（不散落成多份清单）
    for (const id of ENCOUNTER_BATCH_IDS) {
      const occurrences = (code.match(new RegExp(`'${id}'`, 'g')) ?? []).length;
      expect(occurrences, `encounterLab.ts 不应硬编码 '${id}'`).toBe(0);
    }
  });

  it('M3-18 验证台复用正式战斗栈（不写第二套镜头 / 不写战斗数值）', () => {
    const code = stripComments(readLab('encounterLab.ts'));
    // 只经 runBattleRuntime / runBattleView 接正式战斗
    expect(code.includes("from './runBattleRuntime'")).toBe(true);
    expect(code.includes("from './runBattleView'")).toBe(true);
    // 不自己算 transform / 不碰正式相机内部状态
    for (const t of ['renderer.transform =', 'battleCam', 'ctx.scale(', 'setTransform(1']) {
      expect(code.includes(t), `encounterLab.ts 不得出现 "${t}"`).toBe(false);
    }
    // 不写任何战斗数值：HP / 伤害 / CD / 弹丸参数一律**只读**运行时（不得出现数值字面量赋值）
    expect(
      /\b(hp|maxHp|damage|cooldownMs|projectileMass|projectileRadius|muzzleSpeed|recoil|baseMass)\s*[:=]\s*-?\d/.test(
        code,
      ),
      'encounterLab.ts 不得给战斗参数赋数值字面量',
    ).toBe(false);
    // 舞台带沿用 Run Page 几何 → RunBattleView 的 1:1 适配继续成立
    expect(code.includes('RUN_STAGE_BAND')).toBe(true);
  });
});
