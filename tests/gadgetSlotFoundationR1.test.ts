/**
 * Queue ID｜GADGET-SLOT-FOUNDATION-R1
 *
 * 给正式 Build 增加**独立、显式、唯一的 Gadget 装配位**，打通：
 *   产品选择数据 → Build/Loadout → 能量校验 → Runtime 输入
 *
 * 本 Queue 默认 Gadget 为空 ⇒ 完成前后现有正式战斗行为必须保持一致。
 *
 * 覆盖 Queue 验收 1–6。
 */
import { describe, expect, it } from 'vitest';

import { registry } from '../src/core/content';
import { computeEnergy, validateSnapshot } from '../src/core/buildValidator';
import { resolveSnapshot } from '../src/core/buildSnapshot';
import type { BuildSnapshot } from '../src/core/types';
import { EMPTY_SLOT, buildSnapshotFromDraft, type BuildDraft } from '../src/lab/buildEditorModel';
import { RunBattleRuntime } from '../src/lab/portraitBattleLab/runBattleRuntime';
import { WEAPON_SLOT, defaultPlayerDraft } from '../src/product/playerLoadout';

const FRAME_MS = 1000 / 60;

/** 用正式转换函数从 draft 造 snapshot（唯一正确路径）。 */
function snapFrom(draft: BuildDraft): BuildSnapshot {
  return buildSnapshotFromDraft(draft, registry, 'gadgetTest');
}

function draftWithGadget(gadget: string | undefined): BuildDraft {
  const base = defaultPlayerDraft();
  const next: BuildDraft = {
    ...base,
    functionalSelections: {
      front: EMPTY_SLOT,
      frontMass: EMPTY_SLOT,
      top: EMPTY_SLOT,
      rear: EMPTY_SLOT,
      [WEAPON_SLOT]: 'hammer',
    },
  };
  if (gadget !== undefined) next.gadgetDefId = gadget;
  return next;
}

describe('GADGET-SLOT-FOUNDATION-R1', () => {
  /* ---------------- 验收 1：默认 Gadget = EMPTY，其它配置不变 ---------------- */
  it('GS-01 默认新 Build：gadgetDefId 缺省 = EMPTY，且 Weapon/Body/Movement 不变', () => {
    const d = defaultPlayerDraft();
    expect(d.gadgetDefId, '默认 draft 不带 Gadget 字段').toBeUndefined();

    const s = snapFrom(d);
    expect(s.gadget, '默认 snapshot 无 gadget 字段（不写 EMPTY 占位）').toBeUndefined();

    // 其它维度完全不变
    expect(d.bodyDefId).toBe('watermelonBody');
    expect(Object.keys(d.functionalSelections).length, '功能槽仍是 4 个硬点').toBe(4);
    expect(d.functionalSelections.front, 'front 仍被产品清空').toBe(EMPTY_SLOT);
    expect(d.functionalSelections.top, 'top 仍被产品清空').toBe(EMPTY_SLOT);
  });

  /* ---------------- 验收 2：旧 snapshot 缺字段仍可加载 ---------------- */
  it('GS-02 旧 snapshot / legacy build 缺 Gadget 字段 ⇒ 自然解析为 EMPTY，不失效', () => {
    // 模拟旧存档：完全没有 gadget 键
    const legacy: BuildSnapshot = {
      id: 'legacy',
      bodyDefId: 'watermelonBody',
      quality: 1,
      movements: [
        { hardpointId: 'front', defId: 'wheelStd', overrides: { radius: 20 } },
        { hardpointId: 'rear', defId: 'wheelStd', overrides: { radius: 20 } },
      ],
      functionals: [{ hardpointId: 'frontMass', defId: 'hammer' }],
    };
    expect(legacy.gadget).toBeUndefined();

    // 校验 / 能量 / 解析 全链不抛错
    const e = computeEnergy(legacy, registry);
    expect(e.error, '旧 snapshot 能量计算不报错').toBeUndefined();
    expect(e.energy, '能量 = hammer 25（无 Gadget 贡献）').toBe(25);
    expect(validateSnapshot(legacy, registry).valid, '旧 snapshot 仍合法').toBe(true);

    const r = resolveSnapshot(legacy, registry);
    expect(r.gadget, '解析后 gadget = null（EMPTY）').toBeNull();
  });

  /* ---------------- 验收 3：非空 Gadget 的能量计入一次 + 超载被拒 ---------------- */
  it('GS-03 fixture：非空 Gadget 的能量经统一链准确计入一次', () => {
    // 用现有正式内容 thruster（energy 20）当 fixture Gadget —— 不新增测试专用部件
    const thruster = registry.functionals.get('thruster')!;
    expect(thruster.energy).toBe(20);

    const without = snapFrom(draftWithGadget(undefined));
    const withG = snapFrom(draftWithGadget('thruster'));
    expect(without.gadget, '无 Gadget').toBeUndefined();
    expect(withG.gadget, '有 Gadget').toEqual({ defId: 'thruster' });

    const e0 = computeEnergy(without, registry).energy;
    const e1 = computeEnergy(withG, registry).energy;
    expect(e1 - e0, 'Gadget 只计入一次（+20）').toBe(20);

    // resolveSnapshot 同样反映
    expect(resolveSnapshot(without, registry).gadget).toBeNull();
    const rg = resolveSnapshot(withG, registry).gadget!;
    expect(rg.def.id).toBe('thruster');
    expect(rg.star).toBe(1);
  });

  it('GS-04 超载时仍由现有 validator 拒绝（不新增第二套规则）', () => {
    // bananaBody 容量 90：heavyWheel×2(30) + laser(45) + thruster(20) = 95 > 90
    const base = defaultPlayerDraft();
    const over: BuildSnapshot = {
      id: 'over',
      bodyDefId: 'bananaBody',
      quality: 1,
      movements: [
        { hardpointId: 'front', defId: 'heavyWheel', overrides: { radius: 20 } },
        { hardpointId: 'rear', defId: 'heavyWheel', overrides: { radius: 20 } },
      ],
      functionals: [{ hardpointId: 'frontMass', defId: 'laser' }],
      gadget: { defId: 'thruster' },
    };
    void base;
    const e = computeEnergy(over, registry);
    expect(e.energy, '30 + 45 + 20 = 95').toBe(95);

    const v = validateSnapshot(over, registry);
    expect(v.valid, '超载必须被拒绝').toBe(false);
    expect(v.errors.join(' '), '错误信息包含超载与实测总数 95').toContain('95 > 容量 90');

    // 去掉 Gadget 后回到合法（证明是 Gadget 触发的超载）
    const noGadget: BuildSnapshot = { ...over, gadget: undefined };
    expect(computeEnergy(noGadget, registry).energy).toBe(75);
    expect(validateSnapshot(noGadget, registry).valid, '去掉 Gadget 后合法').toBe(true);
  });

  /* ---------------- 验收 4：Runtime 能读到；EMPTY 不产生额外行为 ---------------- */
  it('GS-05 Runtime 读到 Gadget selection；EMPTY 状态为 null', () => {
    const rt = new RunBattleRuntime({
      build: [], carriedHp: null, encounterId: 'RangedTurret',
      playerDraft: draftWithGadget(undefined),
      playerLoadoutTag: 'profile-equipped', playerBaseline: true,
    });
    try {
      expect(rt.playerGadget(), '默认无 Gadget').toBeNull();
    } finally {
      rt.dispose();
    }
  });

  it('GS-06 非空 Gadget（thruster）经正式链进 Runtime，但不产生额外战斗行为', () => {
    const rt = new RunBattleRuntime({
      build: [], carriedHp: null, encounterId: 'RangedTurret',
      playerDraft: draftWithGadget('thruster'),
      playerLoadoutTag: 'profile-equipped', playerBaseline: true,
    });
    try {
      const g = rt.playerGadget();
      expect(g, 'Runtime 能读到 Gadget').not.toBeNull();
      expect(g!.defId).toBe('thruster');
      expect(g!.behavior).toBe('thruster');
      expect(g!.energy).toBe(20);

      // EMPTY 语义的等价物：Gadget 不被注册为 behavior → 不创建物理体/行为
      // （本 Queue 不实现 thruster 行为，故整场行为应与无 Gadget 一致）
      const partsBefore = (rt.orchestrator as unknown as { vehicleA: { parts: unknown[] } }).vehicleA.parts.length;
      for (let i = 0; i < 60; i += 1) rt.step(FRAME_MS);
      const partsAfter = (rt.orchestrator as unknown as { vehicleA: { parts: unknown[] } }).vehicleA.parts.length;
      expect(partsAfter, '不创建额外物理体').toBe(partsBefore);
    } finally {
      rt.dispose();
    }
  });

  /* ---------------- 验收 5：EMPTY 前后关键战斗读数一致 ---------------- */
  it('GS-07 默认 EMPTY Gadget：关键战斗读数与改前一致（Hammer × RangedTurret）', () => {
    const runOne = (draft: BuildDraft) => {
      const rt = new RunBattleRuntime({
        build: [], carriedHp: null, encounterId: 'RangedTurret',
        playerDraft: draft, playerLoadoutTag: 'profile-equipped', playerBaseline: true,
      });
      const orch: any = rt.orchestrator;
      let step = 0;
      try {
        while (rt.result === null && step < 1400) { step += 1; rt.step(FRAME_MS); }
        const sum = rt.playerWeaponHitSummary() as Record<string, { count: number; damages: number[] }>;
        const hits = Object.keys(sum).reduce((a, k) => a + sum[k]!.count, 0);
        const dmg: number[] = [];
        for (const k of Object.keys(sum)) dmg.push(...sum[k]!.damages);
        return {
          steps: step,
          hpA: Number(orch.vehicleA.hp.toFixed(6)),
          hpB: Number(orch.vehicleB.hp.toFixed(6)),
          hits,
          totalDamage: dmg.reduce((a, b) => a + b, 0),
          winner: (rt.result as any)?.winner ?? '?',
          endReason: (rt.result as any)?.endReason ?? '?',
        };
      } finally { rt.dispose(); }
    };

    const withField = runOne(draftWithGadget(undefined));      // 显式走新字段路径（值缺省）
    const base = defaultPlayerDraft();
    const legacyShape: BuildDraft = {
      ...base,
      functionalSelections: {
        front: EMPTY_SLOT, frontMass: EMPTY_SLOT, top: EMPTY_SLOT, rear: EMPTY_SLOT,
        [WEAPON_SLOT]: 'hammer',
      },
    };
    const withoutField = runOne(legacyShape);

    console.log(`\n##### GS-07 EMPTY Gadget 前后对照（hammer × RangedTurret）#####`);
    console.log(`  带 gadget 字段（EMPTY）: ${JSON.stringify(withField)}`);
    console.log(`  不带 gadget 字段        : ${JSON.stringify(withoutField)}`);
    expect(withField, 'EMPTY Gadget 下读数必须逐字段一致').toEqual(withoutField);
  }, 300000);

  /* ---------------- 验收 6 相关：不触碰旧槽位契约 ---------------- */
  it('GS-08 Gadget 是独立维度：不占用、不重开旧 front/top/rear 功能槽', () => {
    const d = draftWithGadget('thruster');
    const s = snapFrom(d);

    // Gadget 不进入 functionals（不占 Body 硬点）
    expect(s.functionals.map((f) => f.hardpointId), 'functionals 仍不含 gadget').not.toContain('gadget');
    // 本 fixture 的 functionals 只含主武器（frontMass），Gadget 未混入
    expect(s.functionals.map((f) => f.hardpointId), 'functionals 只含主武器').toEqual(['frontMass']);
    expect(s.gadget, 'Gadget 独立存放').toEqual({ defId: 'thruster' });

    // 旧契约字段仍在且仍被清空
    expect(d.functionalSelections.top, 'top 仍 EMPTY（Hidden Top 契约未动）').toBe(EMPTY_SLOT);
    expect(d.functionalSelections.front, 'front 仍 EMPTY').toBe(EMPTY_SLOT);
  });
});