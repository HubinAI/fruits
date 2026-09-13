/**
 * PBL-G1-A-B-COMPARISON-GATE｜A/B 对照门禁 targeted 测试。
 *
 * 覆盖四层：
 *   1) 允许差异注册表：A/B 只允许 arena-geometry / physics-interpretation / movement-adapter
 *      三类差异，且每类声明的落点符号必须真实存在（防腐烂）；
 *   2) 共享配置审计：Body / HP / 质量 / 能量 / Weapon 伤害 / CD / 弹丸全部由正式链路**独立重算**
 *      比对；并做**反向验证**（被就地改写的计划必须被抓出）证明审计不是空转；
 *   3) 快速验证顺序：6 步逐字对齐 Queue；可用性由「Arena 运行时是否已落地」派生
 *      （Arena B 运行时不存在 → blocked 且 plan=null，绝不拿占位舞台冒充对照）；
 *   4) 切场 / Reset 零残留 + 运行时生命周期隔离。
 *
 * ⚠️ 本文件的 A/B 结论**只对 Arena A 成立**：Arena B 运行时不存在（PBL-B1 停止条件终止）。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  PBL_ALLOWED_ARENA_DIFFERENCES,
  PBL_ARENA_RUNTIMES,
  PBL_BLOCKED_ARENAS,
  PBL_GATE_SEQUENCE,
  PBL_GATE_SEQUENCE_NOTES,
  allowedDifferenceFiles,
  arenaAvailability,
  arenaRuntimeAvailable,
  auditSharedCombatData,
  auditSpawnPlan,
  gateResidue,
  gateStepPlan,
  gateSummary,
} from '../src/lab/portraitBattleLab/gate';
import { buildSpawnPlan, type SpawnPlan } from '../src/lab/portraitBattleLab/entities';
import { ArenaARuntime } from '../src/lab/portraitBattleLab/arenaA';
import {
  createPortraitLabState,
  reset,
  setArena,
  setEncounter,
  setLoadout,
  start,
} from '../src/lab/portraitBattleLab/state';
import { isRunClean } from '../src/lab/portraitBattleLab/entities';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const LAB_DIR = join(REPO_ROOT, 'src', 'lab', 'portraitBattleLab');

/** 剥掉块注释与行注释（保留 `http://` 这类非注释冒号斜杠）。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function labFiles(): string[] {
  return readdirSync(LAB_DIR).filter((f) => f.endsWith('.ts'));
}

function readLab(f: string): string {
  return readFileSync(join(LAB_DIR, f), 'utf8');
}

/**
 * 允许「感知 arena」的文件白名单（选择器 / 几何 / 门禁管道）。
 * 这些文件不得承载任何战斗数值；承载战斗数值的共享数据文件必须在**盲**名单里。
 */
const ARENA_AWARE_FILES = new Set([
  'constants.ts',
  'state.ts',
  'layout.ts',
  'scene.ts',
  'arenaScene.ts',
  'arenaA.ts',
  'lab.ts',
  'gate.ts',
]);

/** 必须**完全不感知 arena** 的共享数据文件（Body / HP / 伤害 / CD / 弹丸的唯一来源）。 */
const SHARED_DATA_FILES = ['entities.ts', 'testData.ts'];

/**
 * 已登记的「arena 键控数值表」。
 * 出现新的 arena 键控数值表 → 本用例失败，强制人工归类到某一条允许差异后再登记。
 */
const ARENA_KEYED_NUMERIC_TABLES = new Set(['ARENA_PILLAR_H']);

const ARENA_CONDITION_RE = /(?:===|!==)\s*['"][AB]['"]|arena\s*(?:={2,3}|!==?)\s*|state\.arena\b|\bLabArenaId\b/;

/**
 * ⚠️ PRP-F1：`ARENA_CONDITION_RE` 里的裸 `=== 'A'` / `=== 'B'` 分支，本意是抓
 * 「按 **Arena** 常量分叉」，但 `'A' | 'B'` 在本项目里同时是**队伍 id**（`TeamId`）——
 * 正式战斗代码里合法存在 `team === 'A'` / `winner === 'A'` 这类比较，
 * 它们与 Arena（俯视 A / 侧视 B）**毫无关系**。
 *
 * 两者是不同的领域，因此这里精确剔除「左侧是队伍语义标识」的行再判定：
 * Arena 分叉（`arena === 'A'`）依旧 100% 会被抓到，队伍判定不会被误报。
 */
const TEAM_COMPARISON_RE = /\b(?:team|winner|loser|vehicle|snapshot|projectile|side|driver)\w*\s*[!=]==?\s*['"][AB]['"]/;

/** 剥注释后，只保留「真正的 arena 条件」行（剔除队伍语义比较）。 */
function arenaConditionLines(code: string): string[] {
  return code.split('\n').filter((l) => !TEAM_COMPARISON_RE.test(l) && ARENA_CONDITION_RE.test(l));
}

describe('PBL-G1｜允许差异注册表（集中、可枚举、防腐烂）', () => {
  it('G1-01 恰好 3 类允许差异，且 kind 覆盖 Queue 白名单三条', () => {
    expect(PBL_ALLOWED_ARENA_DIFFERENCES).toHaveLength(3);
    expect(PBL_ALLOWED_ARENA_DIFFERENCES.map((d) => d.kind).sort()).toEqual([
      'arena-geometry',
      'movement-adapter',
      'physics-interpretation',
    ]);
    for (const d of PBL_ALLOWED_ARENA_DIFFERENCES) {
      expect(d.arenas.length, `${d.id} 未声明作用 Arena`).toBeGreaterThan(0);
      expect(d.files.length, `${d.id} 未声明落点文件`).toBeGreaterThan(0);
      expect(d.symbols.length, `${d.id} 未声明落点符号`).toBeGreaterThan(0);
      for (const f of d.files) expect(f.endsWith('.ts'), `${d.id} 落点必须是 Lab 内的 .ts：${f}`).toBe(true);
    }
  });

  it('G1-02 每类差异声明的符号必须真实存在于其落点文件中（防白名单腐烂）', () => {
    for (const d of PBL_ALLOWED_ARENA_DIFFERENCES) {
      const sources = d.files.map((f) => {
        try {
          return readLab(f);
        } catch {
          return null;
        }
      });
      for (const sym of d.symbols) {
        expect(
          sources.some((s) => s !== null && s.includes(sym)),
          `${d.id} 声明的符号 "${sym}" 在落点文件 ${d.files.join('/')} 中找不到`,
        ).toBe(true);
      }
    }
  });

  it('G1-03 允许差异的落点文件必须真实存在于 Lab 目录内', () => {
    const present = new Set(labFiles());
    for (const f of allowedDifferenceFiles()) {
      expect(present.has(f), `允许差异落点文件不存在：${f}`).toBe(true);
    }
  });

  it('G1-04 arena 键控数值表必须全部登记，且只允许落在 arena-geometry 类落点内', () => {
    const re = /const\s+(\w+)[^=]*=\s*\{[^}]*\b[AB]\s*:\s*-?\d/g;
    const found = new Map<string, string[]>();
    for (const f of labFiles()) {
      const code = stripComments(readLab(f));
      let m: RegExpExecArray | null;
      while ((m = re.exec(code)) !== null) {
        const name = m[1]!;
        if (!found.has(name)) found.set(name, []);
        found.get(name)!.push(f);
      }
    }
    expect([...found.keys()].sort()).toEqual([...ARENA_KEYED_NUMERIC_TABLES].sort());
    const geoFiles = new Set(
      PBL_ALLOWED_ARENA_DIFFERENCES.filter((d) => d.kind === 'arena-geometry').flatMap((d) => [...d.files]),
    );
    for (const [name, files] of found) {
      for (const f of files) {
        expect(geoFiles.has(f), `arena 键控数值表 ${name} 落在未归类文件 ${f}`).toBe(true);
      }
    }
  });
});

describe('PBL-G1｜共享配置审计：无 Arena 专属平衡覆盖', () => {
  const audit = auditSharedCombatData();

  it('G1-05 全部 8 个组合（2 Loadout × 4 Encounter）审计通过且零数值差异', () => {
    expect(audit.combos).toHaveLength(8);
    expect(audit.problems).toEqual([]);
    expect(audit.ok).toBe(true);
    for (const c of audit.combos) {
      expect(c.mismatches, `${c.key} 存在数值差异`).toEqual([]);
      expect(c.baseKey.length).toBeGreaterThan(0);
    }
    // LightSwarm3 的组合必须是 1 玩家 + 3 敌人
    const swarm = audit.combos.filter((c) => c.encounter === 'LightSwarm3');
    expect(swarm).toHaveLength(2);
    for (const c of swarm) expect(c.entityCount).toBe(4);
  });

  it('G1-06 反向验证：被就地改写的战斗数值必须被审计抓出（证明审计不是空转）', () => {
    const plan = buildSpawnPlan('WatermelonHeavyCannon', 'Chaser');

    // ① 改 HP
    const hpTampered: SpawnPlan = {
      ...plan,
      player: { ...plan.player, hp: plan.player.hp + 777 },
      entities: plan.entities.map((e, i) => (i === 0 ? { ...e, hp: e.hp + 777 } : e)),
    };
    const hpResult = auditSpawnPlan(hpTampered);
    expect(hpResult.mismatches.some((m) => m.includes('hp'))).toBe(true);

    // ② 改武器冷却（profile 数值）
    const f0 = plan.player.functionals[0]!;
    const cdTampered: SpawnPlan = {
      ...plan,
      player: {
        ...plan.player,
        functionals: [
          { ...f0, profile: { ...f0.profile, cooldownMs: (f0.profile.cooldownMs ?? 0) + 12345 } },
          ...plan.player.functionals.slice(1),
        ],
      },
      entities: plan.entities.map((e, i) =>
        i === 0
          ? {
              ...e,
              functionals: [
                { ...f0, profile: { ...f0.profile, cooldownMs: (f0.profile.cooldownMs ?? 0) + 12345 } },
                ...e.functionals.slice(1),
              ],
            }
          : e,
      ),
    };
    const cdResult = auditSpawnPlan(cdTampered);
    expect(cdResult.mismatches.some((m) => m.includes('cooldownMs'))).toBe(true);

    // ③ 改质量
    const massTampered: SpawnPlan = {
      ...plan,
      entities: plan.entities.map((e, i) => (i === 0 ? { ...e, totalMass: e.totalMass * 1.5 } : e)),
    };
    expect(auditSpawnPlan(massTampered).mismatches.some((m) => m.includes('totalMass'))).toBe(true);
  });

  it('G1-07 共享数据文件（entities.ts / testData.ts）剥注释后完全不感知 arena → 结构性无 Arena 专属覆盖', () => {
    for (const f of SHARED_DATA_FILES) {
      const code = stripComments(readLab(f));
      const hits = arenaConditionLines(code);
      expect(hits, `${f} 出现 arena 条件分支：${hits.join(' | ')}`).toEqual([]);
    }
  });

  it('G1-08 arena 感知文件白名单：Lab 内其余 .ts 剥注释后 0 处 arena 条件', () => {
    const offenders: string[] = [];
    let teamExemptions = 0;
    for (const f of labFiles()) {
      const code = stripComments(readLab(f));
      // 队伍语义比较（team / winner / vehicle …）+ 'A'|'B'）：合法，计入豁免并计数
      teamExemptions += code.split('\n').filter((l) => TEAM_COMPARISON_RE.test(l)).length;
      if (ARENA_AWARE_FILES.has(f)) continue;
      if (arenaConditionLines(code).length > 0) offenders.push(f);
    }
    expect(offenders, `未在白名单内的 arena 感知文件：${offenders.join(', ')}`).toEqual([]);
    // 豁免不能是空转（必须真的存在被豁免的队伍比较行）
    expect(teamExemptions).toBeGreaterThan(0);
  });

  it('G1-09 SpawnPlan 入参不含 arena：同 (loadout, encounter) 的指纹与 arena 完全无关', () => {
    const plan = buildSpawnPlan('BananaChargeHammer', 'RangedTurret');
    const again = buildSpawnPlan('BananaChargeHammer', 'RangedTurret');
    expect(again.baseKey).toBe(plan.baseKey);
    // A / B 读到的必须是同一份计划（同一指纹）——这是 A/B 对照的前提
    expect(plan.entities.map((e) => e.hp)).toEqual(again.entities.map((e) => e.hp));
  });
});

describe('PBL-G1｜快速验证顺序（Queue 必改 2，6 步逐字对齐）', () => {
  it('G1-10 顺序为 A/B 交替的 6 步，且与 Queue 清单逐字一致', () => {
    expect(PBL_GATE_SEQUENCE.map((s) => `${s.index}:${s.arena}:${s.loadout}:${s.encounter}`)).toEqual([
      '1:A:WatermelonHeavyCannon:Chaser',
      '2:B:WatermelonHeavyCannon:Chaser',
      '3:A:BananaChargeHammer:RangedTurret',
      '4:B:BananaChargeHammer:RangedTurret',
      '5:A:BananaChargeHammer:LightSwarm3',
      '6:B:BananaChargeHammer:LightSwarm3',
    ]);
    expect(PBL_GATE_SEQUENCE.filter((s) => s.arena === 'A')).toHaveLength(3);
    expect(PBL_GATE_SEQUENCE.filter((s) => s.arena === 'B')).toHaveLength(3);
  });

  it('G1-11 Queue 未写明的字段必须在 assumed 中显式暴露（不静默补）', () => {
    expect(PBL_GATE_SEQUENCE.filter((s) => s.assumed.length > 0).map((s) => s.index)).toEqual([5, 6]);
    for (const s of PBL_GATE_SEQUENCE) {
      if (s.index <= 4) expect(s.assumed).toEqual([]);
      else expect(s.assumed).toEqual(['Loadout']);
    }
    expect(PBL_GATE_SEQUENCE_NOTES.join('')).toContain('第 5 / 6 步');
  });

  it('G1-12 可用性由「Arena 运行时是否已落地」派生，不是写死布尔', () => {
    for (const arena of ['A', 'B'] as const) {
      const inTable = Object.prototype.hasOwnProperty.call(PBL_ARENA_RUNTIMES, arena);
      expect(arenaRuntimeAvailable(arena)).toBe(inTable);
      const steps = PBL_GATE_SEQUENCE.filter((s) => s.arena === arena);
      expect(steps.length).toBeGreaterThan(0);
      for (const s of steps) {
        expect(gateStepPlan(s).status).toBe(inTable ? 'ready' : 'blocked');
      }
    }
    expect(arenaAvailability()).toEqual({ A: true, B: false });
  });

  it('G1-13 Arena A 步骤 ready 且带真实计划；Arena B 步骤 blocked 且 plan=null（不伪造 B 战斗）', () => {
    for (const step of PBL_GATE_SEQUENCE) {
      const planned = gateStepPlan(step);
      if (step.arena === 'A') {
        expect(planned.status).toBe('ready');
        expect(planned.plan).not.toBeNull();
        expect(planned.plan!.loadoutId).toBe(step.loadout);
        expect(planned.plan!.encounterId).toBe(step.encounter);
      } else {
        expect(planned.status).toBe('blocked');
        expect(planned.plan).toBeNull(); // 关键：绝不产出可运行的 B 数据
        expect(planned.reason).toContain('Arena B 运行时未实现');
        expect(PBL_BLOCKED_ARENAS.B).toBeTruthy();
      }
    }
  });

  it('G1-14 门禁总体结论：审计失败→fail；有 blocked 步骤→blocked；全 ready→pass', () => {
    expect(gateSummary(false, ['ready', 'ready']).verdict).toBe('fail');
    expect(gateSummary(true, ['ready', 'blocked']).verdict).toBe('blocked');
    expect(gateSummary(true, ['ready', 'ready']).verdict).toBe('pass');
    // 当前真实状态：审计通过但存在 B 步骤 → blocked（不是 pass）
    expect(gateSummary(true, PBL_GATE_SEQUENCE.map((s) => gateStepPlan(s).status)).verdict).toBe('blocked');
  });
});

describe('PBL-G1｜切场 / Reset 零残留（Queue 必改 3）', () => {
  it('G1-15 gateResidue：干净状态为空，且每种残留都被精确报出', () => {
    const clean = {
      phase: 'idle',
      liveEntities: 0,
      liveProjectiles: 0,
      arenaA: { live: false, steps: 0, shotsFired: 0, hits: 0 },
    };
    expect(gateResidue(clean)).toEqual([]);
    expect(gateResidue({ ...clean, phase: 'running' })[0]).toContain('phase=running');
    expect(gateResidue({ ...clean, liveEntities: 4 })[0]).toContain('实体残留');
    expect(gateResidue({ ...clean, liveProjectiles: 2 })[0]).toContain('弹丸残留');
    expect(gateResidue({ ...clean, arenaA: { live: true, steps: 0, shotsFired: 0, hits: 0 } })[0]).toContain(
      '未 dispose',
    );
    expect(gateResidue({ ...clean, arenaA: { live: false, steps: 60, shotsFired: 0, hits: 0 } })[0]).toContain(
      '物理步进残留',
    );
    expect(gateResidue({ ...clean, arenaA: { live: false, steps: 0, shotsFired: 3, hits: 0 } })[0]).toContain(
      '开火计数残留',
    );
    expect(gateResidue({ ...clean, arenaA: { live: false, steps: 0, shotsFired: 0, hits: 2 } })[0]).toContain(
      '命中计数残留',
    );
    expect(gateResidue({ ...clean, arenaA: null })).toEqual([]);
  });

  it('G1-16 状态机：Reset / 切 Arena / 切 Loadout / 切 Encounter 之后运行期必须彻底清空且回 idle', () => {
    const variants: ((s: ReturnType<typeof createPortraitLabState>) => ReturnType<typeof createPortraitLabState>)[] = [
      (s) => setArena(s, 'B'),
      (s) => setLoadout(s, 'BananaChargeHammer'),
      (s) => setEncounter(s, 'LightSwarm3'),
      (s) => reset(s),
    ];
    for (const mutate of variants) {
      const running = start(createPortraitLabState());
      expect(running.phase).toBe('running');
      expect(running.run.entities.length).toBeGreaterThan(0);
      const after = mutate(running);
      expect(after.phase).toBe('idle');
      expect(isRunClean(after.run)).toBe(true);
      expect(after.run.entities).toHaveLength(0);
      expect(after.run.projectiles).toHaveLength(0);
    }
  });

  it('G1-17 运行时生命周期隔离：连续两个 ArenaARuntime 之间不共享任何状态（AI / 接触 / 移动 / arena）', () => {
    const plan = buildSpawnPlan('WatermelonHeavyCannon', 'Chaser');
    const first = new ArenaARuntime(plan);
    for (let i = 0; i < 600; i++) first.stepFixed(1); // 10s：真实推进
    const firstView = first.view();
    expect(firstView.steps).toBe(600);
    first.dispose();

    const second = new ArenaARuntime(plan);
    const secondView = second.view();
    expect(secondView.steps).toBe(0);
    expect(secondView.shotsFired).toBe(0);
    expect(secondView.hits).toBe(0);
    expect(secondView.lastDamage).toBeNull();
    // HP 必须回到满值 → 不存在跨实例的伤害 / 接触状态泄漏
    for (const e of secondView.entities) expect(e.hp).toBe(e.maxHp);
    // 第一实例开火过或没开火都不影响第二实例（此处只断言「第二实例干净」）
    expect(firstView.timeMs).toBeGreaterThan(0);
    second.dispose();
  });

  it('G1-18 Lab 源码守卫：运行时释放会把引用置空，且 idle 时记录零残留', () => {
    const src = readLab('lab.ts');
    const code = stripComments(src);
    // stopArenaARuntime 必须把长驻运行时置 null（否则残留会跨步泄漏）
    const stop = code.slice(code.indexOf('private stopArenaARuntime'));
    expect(stop.slice(0, 400)).toContain('this.arenaRuntime = null');
    // apply() 回到 idle 时必须核对零残留
    expect(code).toContain('this.lastIdleResidue = gateResidue(');
    // Gate 面板必须是 DOM（canvas 之外）→ 对像素分类零影响
    expect(code).toContain("this.gatePanel = document.createElement('div')");
    expect(code).toContain('this.root.appendChild(this.gatePanel)');
    const html = readFileSync(join(REPO_ROOT, 'portrait-lab.html'), 'utf8');
    expect(html).toContain('.pbl-gate');
  });
});
