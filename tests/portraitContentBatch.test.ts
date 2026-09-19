/**
 * PRP-M3-CONTENT-BATCH-01｜定向测试（纯逻辑 + 结构守卫）。
 *
 * 覆盖 Queue 的技术验收：
 *   · 三项内容的顺序 / 完工状态（第 1 项如实 BLOCK，不是「保守起见」）；
 *   · 两个非战斗事件的**真实状态迁移**：只改「现有耐久 / 现有 Build」，Reset 可重复；
 *   · 「复用而不是新造」：维修量来自 `EMERGENCY_REPAIR_FRACTION`、候选池来自 `runLateralPoolDefs`；
 *   · 边界：额外入口不进入任何正式构建、不 import 正式战斗栈、Hub 只导航不 import 新页。
 *
 * ⚠️ 本文件里的期望值**全部**由正式链路 / 正式常量现算，不复制第二份数值。
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  CONTENT_BATCH_IDS,
  MULTI_UNIT_BLOCK,
  contentBatchChoose,
  contentBatchItem,
  contentBatchItemById,
  contentBatchProblems,
  contentBatchReset,
  contentBatchSelect,
  contentBatchSetHpCase,
  createContentBatchState,
  hpForCase,
  nextContentBatchId,
  repairAmount,
  roadsideCandidates,
  type ContentBatchItemId,
} from '../src/lab/portraitBattleLab/contentBatch';
import {
  EMERGENCY_REPAIR_FRACTION,
  RUN_LAYER1_POOL,
  runLateralPoolDefs,
  type RunModifierId,
} from '../src/lab/portraitBattleLab/runModifiers';
import { buildSpawnPlan } from '../src/lab/portraitBattleLab/entities';
import { RUN_DEMO_ENCOUNTER_ID, RUN_DEMO_LOADOUT_ID } from '../src/lab/portraitBattleLab/runPageScene';

const REPO_ROOT = process.cwd();
const LAB = 'src/lab/portraitBattleLab';
const LOGIC = `${LAB}/contentBatch.ts`;
const MAIN = `${LAB}/contentBatchMain.ts`;
const PAGE = 'content-batch.html';

/** 正式耐久上限（= 正式 registry 解析出的 body.hp）——不写死 1100。 */
const HP_MAX = buildSpawnPlan(RUN_DEMO_LOADOUT_ID, RUN_DEMO_ENCOUNTER_ID).player.hp;

const read = (p: string): string => readFileSync(join(REPO_ROOT, p), 'utf8');

/** 源码守卫匹配前剥注释（与项目既有口径一致：注释不算泄漏）。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/* ================================================================= A. 批次定义 */

describe('PRP-M3-CONTENT-BATCH-01｜A. 批次定义与完工状态（如实标注）', () => {
  it('CB-01 批次恰好三项，顺序 = Queue 原文（多单位 / 废弃修理站 / 路边改装件）', () => {
    expect([...CONTENT_BATCH_IDS]).toEqual(['MultiUnitSwarm', 'RepairStation', 'RoadsideUpgrade']);
    expect(CONTENT_BATCH_IDS).toHaveLength(3);
  });

  it('CB-02 第 1 项（多单位）如实 BLOCK：没有选项 + 带 file:line 证据 + 指明缺哪层 Foundation', () => {
    const item = contentBatchItem('MultiUnitSwarm');
    expect(item.kind).toBe('battle');
    expect(item.status).toBe('blocked');
    // BLOCK 的内容**不许**出现可点选项（否则就是伪造「能跑」）
    expect(item.options).toEqual([]);
    expect(item.blocked).not.toBeNull();
    expect(item.blocked?.evidence.length ?? 0).toBeGreaterThanOrEqual(5);
    // 证据必须是真实 file:line 形式（否则下一步无法定位）
    for (const line of item.blocked?.evidence ?? []) {
      expect(line, `证据不是 file:line：${line}`).toMatch(/\.ts:\d+/);
    }
    expect(item.blocked?.needs ?? '').toContain('Foundation');
    // 与导出的常量同源（不出现第二份 BLOCK 描述）
    expect(item.blocked).toBe(MULTI_UNIT_BLOCK);
  });

  it('CB-03 BLOCK 的证据里必须点名「正式编排器硬编码两车」与「只取 enemies[0]」', () => {
    const joined = MULTI_UNIT_BLOCK.evidence.join('\n');
    expect(joined).toContain('planckBattleOrchestrator.ts:217');
    expect(joined).toContain('runBattleRuntime.ts:355');
    expect(joined).toContain('battleContract.ts:96');
  });

  it('CB-04 第 2 / 3 项 ready，各恰好两个选项（固定二选一）', () => {
    for (const id of ['RepairStation', 'RoadsideUpgrade'] as const) {
      const item = contentBatchItem(id);
      expect(item.status, id).toBe('ready');
      expect(item.options.length, id).toBe(2);
      expect(item.blocked, id).toBeNull();
    }
  });

  it('CB-05 每项都有验证目标（一句话，不是占位）', () => {
    for (const id of CONTENT_BATCH_IDS) {
      expect(contentBatchItem(id).verifies.length, id).toBeGreaterThan(8);
    }
  });

  it('CB-06 按 id 取：批次内命中，批次外 null（不静默回退到别的项）', () => {
    expect(contentBatchItemById('RepairStation')?.id).toBe('RepairStation');
    expect(contentBatchItemById('BananaRodLaser')).toBeNull();
    expect(contentBatchItemById('')).toBeNull();
  });

  it('CB-07 「下一项」按批次顺序推进，末项回到第一项（循环）', () => {
    expect(nextContentBatchId('MultiUnitSwarm')).toBe('RepairStation');
    expect(nextContentBatchId('RepairStation')).toBe('RoadsideUpgrade');
    expect(nextContentBatchId('RoadsideUpgrade')).toBe('MultiUnitSwarm');
  });

  it('CB-08 出厂自检为零问题（批次结构 / 选项数 / BLOCK 形状 / 候选项规则）', () => {
    expect(contentBatchProblems()).toEqual([]);
  });
});

/* ======================================== B. 两项非战斗事件：真实状态迁移 */

describe('PRP-M3-CONTENT-BATCH-01｜B. 非战斗事件只改「现有 HP / Modifier 状态」', () => {
  it('CB-09 维修量 = 正式 EMERGENCY_REPAIR_FRACTION × 上限（复用，不新造数值）', () => {
    expect(repairAmount(HP_MAX)).toBe(Math.round(HP_MAX * EMERGENCY_REPAIR_FRACTION));
    // 与 Run 耐久事件同一口径：round(maxHp × 0.25)
    expect(repairAmount(1000)).toBe(250);
  });

  it('CB-10 两档耐久条件都由正式上限与正式维修量派生（受损 / 满耐久）', () => {
    expect(hpForCase(HP_MAX, 'full')).toBe(HP_MAX);
    expect(hpForCase(HP_MAX, 'damaged')).toBe(HP_MAX - repairAmount(HP_MAX));
    expect(hpForCase(HP_MAX, 'damaged')).toBeLessThan(hpForCase(HP_MAX, 'full'));
  });

  it('CB-11 维修事件：「临时维修」回一段且不超过上限；「继续赶路」耐久一点不变', () => {
    let s = createContentBatchState('RepairStation', HP_MAX, 'damaged');
    const before = s.current.hp;

    const repaired = contentBatchChoose(s, 'repair');
    expect(repaired.chosenOptionId).toBe('repair');
    expect(repaired.current.hp).toBe(Math.min(HP_MAX, before + repairAmount(HP_MAX)));
    expect(repaired.current.hp).toBeGreaterThan(before);
    expect(repaired.current.hp).toBeLessThanOrEqual(HP_MAX);

    const continued = contentBatchChoose(s, 'continue');
    expect(continued.chosenOptionId).toBe('continue');
    expect(continued.current.hp).toBe(before);
    // 记录里写的是自然语言（与 Run 事件同一写法），不是数值转储
    expect(continued.log.join('')).toContain('没有停');

    // 满耐久下「维修」不该溢出上限（如实记账）
    s = contentBatchSetHpCase(s, 'full');
    expect(contentBatchChoose(s, 'repair').current.hp).toBe(HP_MAX);
  });

  it('CB-12 改装事件：候选恰两个且全部来自「未拥有的第一层」（复用现有池，不新增 Modifier）', () => {
    const none = roadsideCandidates([]);
    expect(none).toHaveLength(2);
    for (const m of none) expect(RUN_LAYER1_POOL).toContain(m.id);
    // 与既有横向池规则同源：拥有 1 项 ⇒ 池里剩下另外两个
    const one: RunModifierId[] = ['heavyShell'];
    expect(roadsideCandidates(one).map((m) => m.id)).toEqual(
      runLateralPoolDefs(one).slice(0, 2).map((m) => m.id),
    );
    // 拥有全部一层 ⇒ 没有候选（「已经拥有则过滤」这条规则真的在生效）
    expect(roadsideCandidates([...RUN_LAYER1_POOL])).toEqual([]);
  });

  it('CB-13 改装选择把 id 写进**现有** Modifier 状态；已拥有的项立刻被过滤（再选即非法）', () => {
    let s = createContentBatchState('RoadsideUpgrade', HP_MAX, 'damaged');
    const optionId = contentBatchItem('RoadsideUpgrade', s.current.owned).options[0].id as RunModifierId;

    s = contentBatchChoose(s, optionId);
    expect(s.current.owned).toEqual([optionId]);
    // 选择后候选池自动把它过滤掉（「已经拥有则过滤」这条规则真的在生效）
    expect(contentBatchItem('RoadsideUpgrade', s.current.owned).options.map((o) => o.id)).not.toContain(optionId);

    // ⇒ 对「已拥有」的项再选一次是**非法**操作：显式抛错，而不是静默重复添加
    expect(() => contentBatchChoose(s, optionId)).toThrow(/没有选项/);

    // 换一个仍未拥有的项仍然可选（非战斗节点可以持续改变 Build）
    const next = contentBatchItem('RoadsideUpgrade', s.current.owned).options[0].id as RunModifierId;
    expect(next).not.toBe(optionId);
    expect(contentBatchChoose(s, next).current.owned).toEqual([optionId, next]);
  });

  it('CB-14 事件只改这两样：读数键集恒为 {hp, owned}（没有新增资源 / 计数 / 货币）', () => {
    let s = createContentBatchState('RepairStation', HP_MAX, 'damaged');
    expect(Object.keys(s.current).sort()).toEqual(['hp', 'owned']);
    s = contentBatchChoose(s, 'repair');
    expect(Object.keys(s.current).sort()).toEqual(['hp', 'owned']);
    s = contentBatchSelect(s, 'RoadsideUpgrade');
    s = contentBatchChoose(s, contentBatchItem('RoadsideUpgrade', s.current.owned).options[0].id);
    expect(Object.keys(s.current).sort()).toEqual(['hp', 'owned']);
    // 状态对象本身也没有多余容器
    expect(Object.keys(s).sort()).toEqual(
      ['activeId', 'chosenOptionId', 'current', 'entry', 'hpCase', 'hpMax', 'log'].sort(),
    );
  });

  it('CB-15 「进入 → 选择 → Reset」在耐久与 Build 两条线上逐字段回到进入时（可重复验证）', () => {
    for (const id of ['RepairStation', 'RoadsideUpgrade'] as const) {
      let s = createContentBatchState(id, HP_MAX, 'damaged');
      const entry = { hp: s.entry.hp, owned: [...s.entry.owned] };
      s = contentBatchChoose(s, contentBatchItem(id, s.current.owned).options[0].id);
      expect(s.chosenOptionId, id).not.toBeNull();
      s = contentBatchReset(s);
      expect(s.chosenOptionId, id).toBeNull();
      expect(s.log, id).toEqual([]);
      expect(s.current.hp, id).toBe(entry.hp);
      expect([...s.current.owned], id).toEqual(entry.owned);
      // Reset 是「回到进入态」而不是「回到出厂态」：进入态本身不被动过
      expect(s.entry.hp, id).toBe(entry.hp);
    }
  });

  it('CB-16 切换内容带走当前读数（同一次 Run 里读数跨节点延续），并重记进入态', () => {
    let s = createContentBatchState('RepairStation', HP_MAX, 'damaged');
    s = contentBatchChoose(s, 'repair');
    const afterRepair = s.current.hp;
    s = contentBatchSelect(s, 'RoadsideUpgrade');
    // 读数延续
    expect(s.current.hp).toBe(afterRepair);
    // 新进入态 = 切换那一刻的读数 ⇒ 这次 Reset 不会把上一项的维修退掉
    expect(s.entry.hp).toBe(afterRepair);
    expect(s.chosenOptionId).toBeNull();
    expect(s.log).toEqual([]);
  });

  it('CB-17 切换耐久条件回到该条件下的进入态（对照「同一事件在不同耐久下是否产生不同选择」）', () => {
    let s = createContentBatchState('RepairStation', HP_MAX, 'damaged');
    s = contentBatchChoose(s, 'repair');
    s = contentBatchSetHpCase(s, 'full');
    expect(s.hpCase).toBe('full');
    expect(s.current.hp).toBe(HP_MAX);
    expect(s.entry.hp).toBe(HP_MAX);
    expect(s.chosenOptionId).toBeNull();
    // 满耐久下「临时维修」= 无可修（这就是「当前耐久让选择不同」的机器证据）
    expect(contentBatchChoose(s, 'repair').current.hp - s.current.hp).toBe(0);
  });

  it('CB-18 对 BLOCK 项做选择必须显式抛错（拒绝静默成功 / 拒绝伪造）', () => {
    const s = createContentBatchState('MultiUnitSwarm', HP_MAX, 'damaged');
    expect(() => contentBatchChoose(s, 'repair')).toThrow(/BLOCK/);
  });

  it('CB-19 未知选项 id 显式抛错（不静默忽略）', () => {
    const s = createContentBatchState('RepairStation', HP_MAX, 'damaged');
    expect(() => contentBatchChoose(s, 'teleport')).toThrow(/没有选项/);
  });
});

/* ================================================= C. 结构守卫（边界） */

describe('PRP-M3-CONTENT-BATCH-01｜C. 结构守卫：不新增 Foundation / 不进入正式构建', () => {
  it('CB-20 纯逻辑层零 DOM / 零 Canvas / 零物理，且**只** import 既有 Modifier 模块', () => {
    const src = read(LOGIC);
    const code = stripComments(src);
    for (const banned of ['document', 'window', 'canvas', 'requestAnimationFrame']) {
      expect(code.includes(banned), `${LOGIC} 不得触碰 ${banned}`).toBe(false);
    }
    // 依赖面：本文件只允许引用既有 Modifier 模块（不碰战斗栈 / 物理 / 渲染）
    const specs = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(specs).toEqual(['./runModifiers']);
    for (const banned of ['planckBattleOrchestrator', 'planckWorld', 'renderer', 'arenaA', 'content']) {
      expect(specs.some((s) => s.includes(banned)), `${LOGIC} 不得依赖 ${banned}`).toBe(false);
    }
  });

  it('CB-21 纯逻辑层不新造数值：维修比例与耐久上限都不写死', () => {
    const code = stripComments(read(LOGIC));
    // 0.25 必须来自 EMERGENCY_REPAIR_FRACTION，不能在文件里再写一遍
    expect(code.includes('0.25'), '维修比例不得在本文件出现字面量').toBe(false);
    // 耐久上限必须由正式链路给出（1100 是 Lab 之外的正式数值）
    expect(code.includes('1100'), '耐久上限不得在本文件出现字面量').toBe(false);
  });

  it('CB-22 页面壳不 import 正式编排器（单入口守卫：只有 runBattleRuntime.ts 可用）', () => {
    const code = stripComments(read(MAIN));
    expect(code.includes('planckBattleOrchestrator')).toBe(false);
    // 耐久上限由正式链路读出，不写死
    expect(code.includes('1100')).toBe(false);
    expect(read(MAIN).includes('buildSpawnPlan')).toBe(true);
  });

  it('CB-23 新页面存在、加载自己的 chunk、不含正式入口痕迹', () => {
    expect(existsSync(join(REPO_ROOT, PAGE))).toBe(true);
    const html = read(PAGE);
    expect(html.includes('/src/lab/portraitBattleLab/contentBatchMain.ts')).toBe(true);
    expect(html.includes('cbatch-root')).toBe(true);
    // 不引用旧横屏正式游戏（它不是体验入口，也不进正式构建）
    expect(html.includes('/src/main.ts')).toBe(false);
    for (const banned of ['validation-hub', 'vhub', '__VALIDATIONHUB__']) {
      expect(html.includes(banned), `${PAGE} 不得含 Hub 字面量`).toBe(false);
    }
  });

  it('CB-24 例外入口只进实验构建，不进入任何正式构建配置', () => {
    expect(read('vite.portrait-lab.config.ts').includes("'content-batch': 'content-batch.html'")).toBe(true);
    for (const cfg of ['vite.config.ts', 'vite.pages.config.ts', 'vite.e2e.config.ts', 'vite.wechat.config.ts']) {
      const code = stripComments(read(cfg));
      expect(code.includes('content-batch'), `${cfg} 不得引用 content-batch`).toBe(false);
    }
  });

  it('CB-25 npm script 形状正确（Hub 的后备命令与它同源）', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts['dev:content-batch']).toBe('vite --open=/content-batch.html');
  });

  it('CB-26 Hub 只新增一条导航：第四条指向本页且 queueId 正确，Hub 壳不 import 本页', () => {
    const hub = readFileSync(join(REPO_ROOT, `${LAB}/validationHub.ts`), 'utf8');
    expect(hub.includes("id: 'contentBatch'")).toBe(true);
    expect(hub.includes("queueId: 'PRP-M3-CONTENT-BATCH-01'")).toBe(true);
    expect(hub.includes("pageFile: 'content-batch.html'")).toBe(true);
    // Hub 是纯导航壳：不得 import 任何入口页面模块（否则 Hub 会变成被依赖模块）
    const hubMain = readFileSync(join(REPO_ROOT, `${LAB}/validationHubMain.ts`), 'utf8');
    expect(hubMain.includes('contentBatch')).toBe(false);
  });

  it('CB-27 页面壳用批次表作唯一来源（不复制 id 列表），并展示出厂自检结果', () => {
    const ids: readonly ContentBatchItemId[] = CONTENT_BATCH_IDS;
    expect(ids.length).toBe(3);
    const main = read(MAIN);
    // 壳从批次表读，而不是自己写一份三项清单
    expect(main.includes('CONTENT_BATCH_IDS')).toBe(true);
    expect(main.includes('contentBatchProblems')).toBe(true);
    // 批次清单本身只定义在纯逻辑层一处
    expect(read(LOGIC).includes("'MultiUnitSwarm'")).toBe(true);
  });
});
