/**
 * PRP-M2-NEXT-RUN-SEED-VALIDATION｜「下一局起始改装」验证层 targeted 测试（纯 node，无 DOM）。
 *
 * 本 Queue 只验证**一件事**：
 *
 *     一局结束以后，玩家会不会因为「下一局起点不同」而想立刻再打一局？
 *
 * 因此本文件不重复验证任何战斗数值平衡，只冻结四件必须成立的事（对应 Queue 验收 1~4）：
 *
 *   A) **三个种子**只复用已真人通过的第一层强化，不新增第四种奖励；
 *   B) **上一局**（RUN COMPLETE）是走真实状态机快进出来的真实状态，且确定性；
 *   C) **新 Run 真正是「下一局」**：满耐久 / DAY 1 / 日志重置 / Build 只剩 seed
 *      —— 与上一局**没有任何共享对象**（隔离可证，不是「看起来干净」）；
 *   D) **seed 真的进第一场 Runtime**：真实 `RunBattleRuntime` 里解析出的武器
 *      `behaviorParams` 逐个对上第一层强化的冻结值（不是「只在顶部画了个图标」）。
 *
 * 另加 E) 入口隔离守卫：新验证入口存在且**不污染**默认启动链 / 正式构建。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  NEXT_RUN_EXIT_HREF,
  NEXT_RUN_SEEDS,
  NEXT_RUN_SEED_LEAD,
  NEXT_RUN_SEED_TITLE,
  NEXT_RUN_VALIDATION_LABEL,
  buildPriorCompletedRun,
  createSeededNewRun,
  nextRunFinalAction,
  nextRunSeedById,
  priorRunSummary,
  runSeedChoiceOption,
} from '../src/lab/portraitBattleLab/nextRunValidation';
import { VALIDATION_HUB_ENTRIES } from '../src/lab/portraitBattleLab/validationHub';
import {
  RUN_CHOICE_OPTIONS,
  createRunPageState,
  pressRunAction,
  runBuildIds,
  runCarriedPlayerHp,
  runComplete,
  runCurrentNode,
  type RunPageContext,
  type RunPageState,
} from '../src/lab/portraitBattleLab/runPageState';
import { RUN_MODIFIERS } from '../src/lab/portraitBattleLab/runModifiers';
import { RUN_SCRIPT_FIRST_ID } from '../src/lab/portraitBattleLab/runScript';
import { runPageContext } from '../src/lab/portraitBattleLab/runPageScene';
import { RunBattleRuntime } from '../src/lab/portraitBattleLab/runBattleRuntime';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf8');
const readLab = (file: string): string => read(`src/lab/portraitBattleLab/${file}`);
/** 剥掉注释（源码守卫必须扛住「自家注释里写着反向说明」这种自指陷阱）。 */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const CTX: RunPageContext = runPageContext();

/** 本场武器件的真实 `behaviorParams`（与既有 Run Page 测试同一口径）。 */
function weaponParamsOf(rt: RunBattleRuntime): Record<string, unknown> {
  const part = rt.orchestrator.vehicleA.parts.find((p) => p.def.category === 'weapon');
  return { ...((part?.def.behaviorParams ?? {}) as Record<string, unknown>) };
}

/**
 * 模拟宿主开一场真实战斗：**在 EVENT 那一刻取 carry**（页面 `beginBattle` 的唯一时机），
 * 然后构造与页面**逐字段相同**的 `RunBattleRuntime`。
 */
function openFirstBattle(s0: RunPageState): { rt: RunBattleRuntime; state: RunPageState; carriedHp: number | null } {
  let s = pressRunAction(s0, CTX); // d1-start(IDLE) → d2-battle1(IDLE)
  s = pressRunAction(s, CTX); // → EVENT（敌情叙事）
  const carriedHp = runCarriedPlayerHp(s); // ← 与宿主同一时机（进 BATTLE 后该值会变 null）
  s = pressRunAction(s, CTX); // → BATTLE
  const rt = new RunBattleRuntime({
    build: runBuildIds(s),
    carriedHp,
    encounterId: runCurrentNode(s).encounterId,
  });
  return { rt, state: s, carriedHp };
}

/* ============================================ A. 三个种子（必改 1） */

describe('PRP-M2｜A 三个固定起始种子', () => {
  it('NR-01 恰好三个种子，且与既有第一层强化**逐项同源**（不新增第四种奖励）', () => {
    expect(NEXT_RUN_SEEDS).toHaveLength(3);
    // id 与顺序都必须等于第一层三选一 —— 种子只是把「这次改装」重述成「下一局开局」
    expect(NEXT_RUN_SEEDS.map((s) => s.id)).toEqual(RUN_MODIFIERS.map((m) => m.id));
    expect(NEXT_RUN_SEEDS.map((s) => s.id)).toEqual(['heavyShell', 'twinCannon', 'fastReload']);
    // 三个种子都必须能在**既有**选项表里找到（复用同一个选项对象，不另造一份）
    for (const seed of NEXT_RUN_SEEDS) {
      expect(runSeedChoiceOption(seed.id)).not.toBeNull();
      expect(RUN_CHOICE_OPTIONS.some((o) => o.id === seed.id)).toBe(true);
    }
    // 未知 id 不静默回退
    expect(nextRunSeedById('heavyShell')).not.toBeNull();
    expect(nextRunSeedById('tripleLoad')).toBeNull();
    expect(nextRunSeedById('')).toBeNull();
    expect(runSeedChoiceOption('nope')).toBeNull();
  });

  it('NR-02 每个种子的文案说清「下一局开局会变成什么样」', () => {
    for (const seed of NEXT_RUN_SEEDS) {
      expect(seed.title.length).toBeGreaterThan(0);
      expect(seed.note.length).toBeGreaterThan(0);
      expect(seed.startLog.length).toBeGreaterThan(0);
      // 选项名说的是**下一局**（不是「这次改装」）
      expect(seed.title.endsWith('开局')).toBe(true);
      expect(seed.note.startsWith('下一局直接携带')).toBe(true);
    }
    expect(NEXT_RUN_SEEDS.map((s) => s.title)).toEqual(['重炮开局', '双联开局', '快装开局']);
    expect(NEXT_RUN_SEED_TITLE).toBe('带走一项改装');
    // ⚠️ PRP-M2-R1：终点态按钮文案必须是**一句动作**（旧的 '下一局验证完成' 是状态描述，
    //    被画在按钮上就产生了「按钮可见 + 点了没反应」的 P0）。
    expect(NEXT_RUN_VALIDATION_LABEL).toBe('返回验证中心');
    // 引导语必须点明这是**下一局**（否则玩家会以为还在上一局）
    expect(NEXT_RUN_SEED_LEAD.includes('下一局')).toBe(true);
  });

  it('NR-03 未引入货币 / 存档 / 随机 / 赛季 / 新 Buff（Queue 禁止项）', () => {
    const src = stripComments(readLab('nextRunValidation.ts'));
    for (const banned of ['gold', 'coin', 'currency', 'price', 'shop', 'inventory', 'season', 'save', 'localStorage']) {
      expect(new RegExp(`\\b${banned}\\b`, 'i').test(src), `不得出现 ${banned}`).toBe(false);
    }
    expect(src.includes('Math.random')).toBe(false);
    // 不新造强化 id：文件里不得出现任何**不在既有**强化集合中的 id 字面量
    for (const m of suspiciousModifierIds(src)) {
      expect(
        ['heavyShell', 'twinCannon', 'fastReload', 'kineticBurst', 'tripleLoad', 'emergencyRepair'].includes(m),
        `未知强化 id "${m}"`,
      ).toBe(true);
    }
  });
});

/** 从源码里揪出所有疑似强化 id 的字符串字面量（用于「不新增 Buff」的机器判据）。 */
function suspiciousModifierIds(src: string): string[] {
  const known = ['heavyShell', 'twinCannon', 'fastReload'];
  const out: string[] = [];
  for (const m of src.matchAll(/['"]([a-z][A-Za-z]{6,})['"]/g)) {
    const v = m[1];
    if (known.includes(v)) continue; // 允许出现的三个
    // 只关心驼峰式标识符（配置键 / 强化 id 形态），跳过普通句子
    if (!/^[a-z]+[A-Z]/.test(v)) continue;
    out.push(v);
  }
  return out;
}

/* ==================================== B. 上一局（RUN COMPLETE，快进） */

describe('PRP-M2｜B 上一局：真实状态机的确定性快进', () => {
  it('NR-04 快进产出一个**真实的 RUN COMPLETE 上一局**（DAY 7 / 4 场 / 走完两层 Build）', () => {
    const prior = buildPriorCompletedRun(CTX);
    expect(runComplete(prior)).toBe(true);
    expect(prior.phase).toBe('COMPLETE');
    expect(prior.day).toBe(7);
    expect(prior.battlesCompleted).toBe(4);
    expect(prior.nodeId).toBe('d7-final');
    // 上一局真的走完了一条两层路线（不是空 Build 直接结算）
    expect(runBuildIds(prior)).toEqual(['heavyShell', 'kineticBurst']);
    // 上一局的耐久**不是满的** —— 这正是「新局要把耐久重置」这件事的前提
    const sum = priorRunSummary(prior);
    expect(sum.complete).toBe(true);
    expect(sum.durabilityPercent).toBeGreaterThan(0);
    expect(sum.durabilityPercent).toBeLessThan(100);
    expect(sum.build).toEqual(['heavyShell', 'kineticBurst']);
    expect(sum.battlesCompleted).toBe(4);
    // 快进走的是真实终局叙事（四场战报 + 收束）
    const texts = prior.log.map((e) => e.text);
    expect(texts.filter((t) => t === '战斗胜利。')).toHaveLength(4);
    expect(texts.includes('这次冒险到此结束。')).toBe(true);
  });

  it('NR-05 快进是确定性的（同样输入 → 逐字节同样的输出，无随机、无时间依赖）', () => {
    const a = buildPriorCompletedRun(CTX);
    const b = buildPriorCompletedRun(CTX);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(a).not.toBe(b); // 但是两个独立对象（不得共享引用）
  });
});

/* ======================================= C. 新 Run（必改 2：真正的新一局） */

describe('PRP-M2｜C 新 Run：必须是「下一局」，不是上一局继续', () => {
  it('NR-06 三个种子分别开出的新 Run：满耐久 / DAY 1 / 日志重置 / Build 只剩 seed', () => {
    for (const seed of NEXT_RUN_SEEDS) {
      const fresh = createSeededNewRun(CTX, seed.id);
      expect(fresh, seed.id).not.toBeNull();
      const s = fresh as RunPageState;

      // ① DAY 回到脚本第一个节点
      expect(s.nodeId, seed.id).toBe(RUN_SCRIPT_FIRST_ID);
      expect(s.day, seed.id).toBe(1);
      expect(s.dayTotal, seed.id).toBe(7);
      // ② 战斗运行时清空、场数归零、无耐久补偿
      expect(s.battle, seed.id).toBeNull();
      expect(s.battlesCompleted, seed.id).toBe(0);
      expect(s.repairBonus, seed.id).toBe(0);
      expect(s.durability, seed.id).toBeNull();
      // ③ Build 里**只有**这一个 seed
      expect(runBuildIds(s), seed.id).toEqual([seed.id]);
      expect(s.buffs, seed.id).toHaveLength(1);
      // ④ 日志重置（seq 从 1 连续；开头仍是 DAY 1 + 开场节拍，结尾是本局的种子叙事）
      const seqs = s.log.map((e) => e.seq);
      expect(seqs, seed.id).toEqual(seqs.map((_, i) => i + 1));
      expect(s.log[0].text, seed.id).toBe('DAY 1');
      expect(s.log[s.log.length - 1].text, seed.id).toBe(seed.startLog);
      expect(s.log.some((e) => e.text.includes('这次冒险到此结束。')), seed.id).toBe(false);
      // ⑤ 还没发生任何切换（fresh 状态契约与 createRunPageState 一致）
      expect(s.transitions, seed.id).toBe(0);
      expect(s.revision, seed.id).toBe(0);
      expect(s.actionCount, seed.id).toBe(0);
      expect(s.phaseTrail, seed.id).toEqual(['IDLE']);
    }
  });

  it('NR-07 未知种子 → `null`（不进入新局，也不静默降级成「无 seed 新局」）', () => {
    expect(createSeededNewRun(CTX, 'tripleLoad')).toBeNull();
    expect(createSeededNewRun(CTX, '')).toBeNull();
    expect(createSeededNewRun(CTX, 'no-such-seed')).toBeNull();
  });

  it('NR-08 新旧两局**完全隔离**：无共享引用、上一局对象不被改动', () => {
    const prior = buildPriorCompletedRun(CTX);
    const before = JSON.stringify(prior);

    for (const seed of NEXT_RUN_SEEDS) {
      const s = createSeededNewRun(CTX, seed.id) as RunPageState;
      // 两个**独立对象**（隔离的第一层证据）
      expect(s).not.toBe(prior);
      // 关键状态逐项不同（不是「换了个壳子的同一局」）
      expect(s.day).not.toBe(prior.day);
      expect(s.nodeId).not.toBe(prior.nodeId);
      expect(s.battlesCompleted).not.toBe(prior.battlesCompleted);
      expect(runBuildIds(s)).not.toEqual(runBuildIds(prior));
      expect(s.log.length).not.toBe(prior.log.length);
      // 容器级隔离：日志 / Build 都不是同一个数组对象
      expect(s.log).not.toBe(prior.log);
      expect(s.buffs).not.toBe(prior.buffs);
      expect(s.phaseTrail).not.toBe(prior.phaseTrail);
      // 上一局**一个字段都没被改动**
      expect(JSON.stringify(prior)).toBe(before);
    }
  });

  it('NR-09 新 Run 的第一场**满耐久**（上一局的剩余耐久不继承）', () => {
    const prior = buildPriorCompletedRun(CTX);
    expect(runCarriedPlayerHp(prior)).not.toBeNull(); // 上一局确实留有一个可读的剩余耐久
    const priorHp = runCarriedPlayerHp(prior) as number;

    const s = createSeededNewRun(CTX, 'heavyShell') as RunPageState;
    const { rt, carriedHp, state } = openFirstBattle(s);
    try {
      // 新局第一场：carry 必须是 `null`（= 还没打过任何已结束的战斗 → 满耐久开幕）
      expect(carriedHp).toBeNull();
      expect(state.battle?.playerHp).toBe(CTX.playerHpMax);
      expect(rt.initialPlayerHp).toBe(CTX.playerHpMax);
      expect(rt.playerMaxHp).toBe(CTX.playerHpMax);
      // 与上一局的剩余耐久**明显不同** → 耐久没有被继承
      expect(priorHp).not.toBe(CTX.playerHpMax);
      expect(rt.initialPlayerHp).not.toBe(priorHp);
    } finally {
      rt.dispose();
    }
  });

  it('NR-10 新 Run 的第一场就是脚本里的第一个 BATTLE 节点（不跳过任何节拍）', () => {
    const s = createSeededNewRun(CTX, 'twinCannon') as RunPageState;
    const { rt, state } = openFirstBattle(s);
    try {
      expect(state.nodeId).toBe('d2-battle1');
      expect(state.phase).toBe('BATTLE');
      expect(state.battlesCompleted).toBe(0);
      // 对手来自**当前脚本节点**（与页面同一条链）
      expect(rt.encounterId).toBe('PineappleFireBrute');
      // 本局 Build 在运行时层就是这一个 seed
      expect(rt.build).toEqual(['twinCannon']);
      expect(rt.modifier).toBe('twinCannon');
    } finally {
      rt.dispose();
    }
  });
});

/* ========================= D. Seed 真的进第一场 Runtime（必改 3 / 验收 2） */

describe('PRP-M2｜D seed 真实注入第一场运行时', () => {
  it('NR-11 三个 seed 各自解析出**不同的真实武器数值**（不是只画图标）', () => {
    const observed: Record<string, Record<string, unknown>> = {};
    for (const seed of NEXT_RUN_SEEDS) {
      const s = createSeededNewRun(CTX, seed.id) as RunPageState;
      const { rt } = openFirstBattle(s);
      try {
        expect(rt.build, seed.id).toEqual([seed.id]);
        observed[seed.id] = weaponParamsOf(rt);
      } finally {
        rt.dispose();
      }
    }

    // ① 重型弹头：更粗更重（第一层冻结值）
    expect(observed.heavyShell.projectileRadius).toBe(16);
    expect(observed.heavyShell.projectileMass).toBe(4);
    // ② 双联炮：一次开火两发、间隔 100ms（第一层冻结值）
    expect(observed.twinCannon.burstRounds).toBe(2);
    expect(observed.twinCannon.burstIntervalMs).toBe(100);
    // ③ 快速装填：装填 650ms（第一层冻结值）
    expect(observed.fastReload.cooldownMs).toBe(650);

    // 三者互不相同（否则「选了不同的种子」在运行时里不可分辨）
    expect(observed.heavyShell.projectileRadius).not.toBe(observed.twinCannon.projectileRadius);
    expect(observed.heavyShell.projectileRadius).not.toBe(observed.fastReload.projectileRadius);
    expect(observed.twinCannon.cooldownMs).not.toBe(observed.fastReload.cooldownMs);
    // 只有双联炮带 burst；另外两个不带（否则「选了不同种子」在运行时里不可分辨）
    expect(observed.fastReload.burstRounds).toBeUndefined();
    expect(observed.heavyShell.burstRounds).toBeUndefined();
  });

  it('NR-12 基础状态（无 seed）与三个 seed 都不相同 —— 差异确实来自 seed 而不是场地', () => {
    const base = openFirstBattle(createRunPageState(CTX));
    try {
      const baseParams = weaponParamsOf(base.rt);
      expect(baseParams.projectileRadius).toBe(10);
      expect(baseParams.projectileMass).toBe(1);
      expect(baseParams.cooldownMs).toBe(1000);

      for (const seed of NEXT_RUN_SEEDS) {
        const s = createSeededNewRun(CTX, seed.id) as RunPageState;
        const { rt } = openFirstBattle(s);
        try {
          const p = weaponParamsOf(rt);
          expect(p, `${seed.id} 与基础状态应不同`).not.toEqual(baseParams);
          // 世界 / 装配 / 对手等**非 seed** 因素全部与基础状态一致（只换武器数值）
          expect(rt.spawnSeparation).toBe(base.rt.spawnSeparation);
          expect(rt.encounterId).toBe(base.rt.encounterId);
          expect(rt.groundY).toBe(base.rt.groundY);
        } finally {
          rt.dispose();
        }
      }
    } finally {
      base.rt.dispose();
    }
  });
});

/* ================================= E. 入口隔离（必改 4 / 不污染默认 dev） */

describe('PRP-M2｜E 独立验证入口且不污染默认启动链', () => {
  it('NR-13 next-run.html 存在、只挂 nextRunMain.ts，且不含任何 PBL 开发控制标记', () => {
    const html = read('next-run.html');
    expect(html.includes('src/lab/portraitBattleLab/nextRunMain.ts')).toBe(true);
    expect(html.includes('id="run-root"')).toBe(true);
    expect(html.includes('run-stage')).toBe(true);
    for (const marker of ['pbl-root', 'pbl-bar', 'pbl-btn', 'pbl-gate', 'pbl-canvas', 'data-dev']) {
      expect(html.includes(marker), `不得含开发控制标记 ${marker}`).toBe(false);
    }
    const main = readLab('nextRunMain.ts');
    expect(main.includes("from './runPage'")).toBe(true);
    expect(main.includes('#run-root')).toBe(true);
    // 验证入口必须真的开启验证流程（三个构造项缺一不可）
    expect(main.includes('priorRun: prior')).toBe(true);
    expect(main.includes('seedOptions: NEXT_RUN_SEEDS')).toBe(true);
    expect(main.includes('stopAfterFirstBattle: true')).toBe(true);
  });

  it('NR-14 默认启动链与正式构建 0 污染（`npm run dev` 仍是唯一正常启动命令）', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    // 默认 dev 一个字节都没改
    expect(pkg.scripts.dev).toBe('vite --open');
    // 验证入口是**显式**的第二条命令
    expect(pkg.scripts['dev:next-run']).toBe('vite --open=/next-run.html');
    expect(pkg.scripts['dev:run-page']).toBe('vite --open=/run-page.html');
    /*
      ⚠️ PRODUCT-LOOP-R1-C：这里原先断言 `branch.includes("'/run-page.html'")` ——
         在「默认落地页 = Run Page」的年代，那条断言证明的是「默认链确实指向玩家页」。
      Queue 必改 1 把落地页改成产品首页之后，本用例（NR 系列的职责 = 「验证入口不污染
      默认链」）改为钉住**本 Queue 真正关心的事**：
         · 根路径重写目标**不是**任何验证入口；
         · 验证入口 `next-run.html` 不出现在重写插件里（原断言的实质）。
      默认落地页到底是谁，由 `tests/portraitDefaultEntry.test.ts` 的 R2-01/R2-11 专责钉死。
    */
    const branch = stripComments(read('build/branchDevEntry.ts'));
    expect(branch.includes('/home.html')).toBe(true);
    expect(branch.includes('next-run')).toBe(false);
    expect(branch.includes('validation-hub')).toBe(false);
    for (const banned of ['run-page', 'runMain', 'portrait-lab', 'portraitBattleLab']) {
      expect(branch.includes(banned), `重写插件不得引用 ${banned}`).toBe(false);
    }
    // 四个正式构建配置 + 正式入口仍 0 引用原型字面量
    for (const t of ['index.html', 'vite.config.ts', 'vite.pages.config.ts', 'vite.e2e.config.ts', 'vite.wechat.config.ts']) {
      const code = stripComments(read(t));
      for (const banned of ['run-page', 'runMain', 'next-run', 'nextRun', 'portrait-lab', 'portraitBattleLab']) {
        expect(code.includes(banned), `${t} 不得引用 ${banned}`).toBe(false);
      }
    }
    // 实验构建**已接上**第三个入口（不是「文件存在但打不进产物」）
    const labCfg = read('vite.portrait-lab.config.ts');
    expect(labCfg.includes("'next-run': 'next-run.html'")).toBe(true);
    expect(labCfg.includes("'run-page': 'run-page.html'")).toBe(true);
    expect(labCfg.includes("'portrait-lab': 'portrait-lab.html'")).toBe(true);
  });

  it('NR-15 默认完整 Run 结构**未被修改**（runPageState / runScript 零 seed 概念）', () => {
    for (const f of ['runPageState.ts', 'runScript.ts', 'runBattleRuntime.ts']) {
      const code = stripComments(readLab(f));
      for (const banned of ['nextRun', 'Seed', 'seed', 'seedOptions', 'validationDone']) {
        expect(code.includes(banned), `${f} 不应出现 "${banned}"（本 Queue 不改默认 Run 结构）`).toBe(false);
      }
    }
    // 默认路径的 Run 起点仍然是 `createRunPageState`（新 Run 的构造是附加函数）
    // ⚠️ PRODUCT-LOOP-R1-C：起始上下文多了一个参数（`runPageContext(this.loadout)` =
    //    本局玩家装载），但**结构未变**：仍是 `opts.priorRun ?? createRunPageState(...)`，
    //    仍只有这一处构造点，验证流程仍不参与默认起点。
    const page = stripComments(readLab('runPage.ts'));
    expect(page.includes('opts.priorRun ?? createRunPageState(runPageContext(this.loadout))')).toBe(true);
    // 页面对验证项的读取全部经 `this.opts.*`（不存在全局单例 / 隐式开关）
    expect(page.includes('this.opts.seedOptions')).toBe(true);
    expect(page.includes('this.opts.stopAfterFirstBattle')).toBe(true);
  });

  it('NR-16 Lab 源码守卫仍覆盖新文件（新文件都在 Lab 顶层、只 import Lab 内部模块）', () => {
    // R22a 的 `labSourceFiles()` 只扫顶层 .ts ⇒ 新文件必须落在顶层，否则会**绕过**守卫。
    expect(existsSync(join(REPO_ROOT, 'src/lab/portraitBattleLab/nextRunValidation.ts'))).toBe(true);
    expect(existsSync(join(REPO_ROOT, 'src/lab/portraitBattleLab/nextRunMain.ts'))).toBe(true);
    expect(existsSync(join(REPO_ROOT, 'src/lab/portraitBattleLab/validation'))).toBe(false);
    for (const f of ['nextRunValidation.ts', 'nextRunMain.ts']) {
      for (const m of readLab(f).matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        const spec = m[1];
        if (spec.startsWith('.')) {
          expect(spec.startsWith('./'), `${f} 只允许引用 Lab 内部模块，实际 "${spec}"`).toBe(true);
        }
      }
    }
  });
});

/* ============ F. PRP-M2-R1｜NEXT_RUN_VALIDATION_COMPLETE 必须是一个真实出口 */

/**
 * 真人录屏 P0 的回归守卫（PRP-M2-R1-NEXT-RUN-VALIDATION-EXIT-BUG）。
 *
 * 旧实现的形态 = **有按钮但无 action**：
 *   · 按钮文案是**状态描述**（`'下一局验证完成'`），却被画在唯一的主动作位置上；
 *   · `onPointerDown` 在 hit test **之前**就 `return`（点击被吞，连 handler 都到不了）；
 *   · `actionEnabledNow()` 恒 `false`；
 *   · 没有任何 exit action / transition / 导航。
 *
 * 本组把「终点态必须是一个**真出口**」钉成机器判据：文案与目标**同源**，缺失即**不画按钮**。
 */
describe('PRP-M2-R1｜F 验证终点（NEXT_RUN_VALIDATION_COMPLETE）的唯一出口', () => {
  it('NR-17 终点态的主动作 = 「返回验证中心」+ 一个真实 href（文案与行为同源）', () => {
    const action = nextRunFinalAction(true, NEXT_RUN_EXIT_HREF);
    expect(action).not.toBeNull();
    expect(action && action.label).toBe(NEXT_RUN_VALIDATION_LABEL);
    expect(action && action.href).toBe(NEXT_RUN_EXIT_HREF);
    // 文案必须是一句**动作**，不能退回状态描述
    expect(NEXT_RUN_VALIDATION_LABEL).toBe('返回验证中心');
    expect(NEXT_RUN_VALIDATION_LABEL.includes('验证完成')).toBe(false);
  });

  it('NR-18 「有按钮但无 action」在结构上不可能出现', () => {
    // ① 非终点态：不产生出口动作（那一步该走 Run 正式流程的 pressRunAction）
    expect(nextRunFinalAction(false, NEXT_RUN_EXIT_HREF)).toBeNull();
    // ② 终点态但宿主没声明出口：同样**不产生动作** ⇒ 页面据此一个按钮都不画
    //    （而不是画一个点了没反应的按钮）
    for (const missing of [null, undefined, ''] as const) {
      expect(nextRunFinalAction(true, missing), `exitHref=${String(missing)}`).toBeNull();
    }
    // ③ 反过来：只要有动作，就一定同时带 label 与 href（不存在「有按钮没目标」）
    const action = nextRunFinalAction(true, NEXT_RUN_EXIT_HREF);
    expect(action && action.label.length).toBeGreaterThan(0);
    expect(action && action.href.length).toBeGreaterThan(0);
  });

  it('NR-19 出口目标 = **认得这一页的那个**验证中心（交叉核对，不是自说自话）', () => {
    // ① 目标是一个真实存在的根目录 HTML
    expect(NEXT_RUN_EXIT_HREF).toMatch(/^\.\/[A-Za-z0-9._-]+\.html$/);
    const file = NEXT_RUN_EXIT_HREF.replace(/^\.\//, '');
    expect(existsSync(join(REPO_ROOT, file))).toBe(true);
    const html = read(file);
    // ② 那一页真的挂的是 Hub 自己的脚本（否则「返回验证中心」就返回到了别处）
    expect(html.includes('/src/lab/portraitBattleLab/validationHubMain.ts')).toBe(true);
    expect(html.includes('<div id="vhub-root"></div>')).toBe(true);
    // ③ 闭环：Hub 的入口表里真的有本页（`next-run.html`）—— 即「我返回的目标」与
    //    「它入口表里的我」互相认得，改任一处不同源都会在这里炸。
    const self = VALIDATION_HUB_ENTRIES.filter((e) => e.pageFile === 'next-run.html');
    expect(self.length).toBe(1);
    expect(self[0].href).toBe('./next-run.html');
    // ④ 方向守卫：入口页面**不得** import Hub 模块（Hub 与入口是单向关系；
    //    反向依赖会把 `validationHub.ts` 拉成跨入口共享 chunk，`I4` 结构守卫会抓到）。
    const main = stripComments(readLab('nextRunMain.ts'));
    expect(main.includes("from './validationHub'")).toBe(false);
  });

  it('NR-20 出口是整页导航，但**导航动作不在 RunPage 里**（玩家页面结构上仍无法跳转）', () => {
    const page = stripComments(readLab('runPage.ts'));
    // ① RunPage 里**不得**出现 Hub 的页面文件名 —— 地址由宿主注入，不是页面硬编码
    expect(page.includes('validation-hub')).toBe(false);
    // ② 终点态的文案与点击行为都来自**同一个对象**
    expect(page.includes('finalActionNow()')).toBe(true);
    // ③ ⚠️ RunPage 与**正式玩家页面**（run-page.html）共用 ⇒ 必须仍然**不写 location / history**
    //    （`tests/portraitRunPage.test.ts` 的 RP-25 机器禁止；整页导航只能由宿主做）
    for (const t of [
      'createElement(\'button\')',
      'location.href',
      'location.assign',
      'location.replace',
      'history.pushState',
      'history.replaceState',
      'window.open',
    ]) {
      expect(page.includes(t), `runPage.ts 不得出现 "${t}"`).toBe(false);
    }
    // ④ 出口经**宿主回调**发出：RunPage 只发请求，不执行导航
    expect(page.includes('this.opts.onExit')).toBe(true);
    // ⑤ 终点态仍然**不得**落到 Run 正式流程的 pressRunAction 上（结构上跑不到第二场）
    expect(page.includes('if (this.validationDone)')).toBe(true);
    // ⑥ 宿主：注入出口地址 + 执行整页导航（地址来自**本页自己的**数据源）
    const main = stripComments(readLab('nextRunMain.ts'));
    expect(main.includes('exitHref: NEXT_RUN_EXIT_HREF')).toBe(true);
    expect(main.includes('window.location.assign(exit.href)')).toBe(true);
  });
});
