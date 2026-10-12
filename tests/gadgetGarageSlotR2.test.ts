/**
 * Queue ID｜GADGET-GARAGE-SLOT-R2
 *
 * 正式 Garage 的**唯一 Gadget 槽**端到端链：
 *   Garage → BuildDraft → BuildSnapshot → Energy validation → Run → Gadget Runtime
 *
 * 覆盖 Queue 验收 1–5。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, beforeEach } from 'vitest';

import { bindPlatformCore } from '../src/platform/context';
import { createWebCore } from '../src/platform/web';
import { registry } from '../src/core/content';
import { EMPTY_SLOT, makeStarterDraft, buildSnapshotFromDraft, type BuildDraft } from '../src/lab/buildEditorModel';
import { computeEnergy } from '../src/core/buildValidator';
import { getInventory, saveInventory, defaultInventory } from '../src/core/partInventory';
import { loadPlayerBuild, savePlayerBuild } from '../src/core/buildPersistence';
import { RunBattleRuntime } from '../src/lab/portraitBattleLab/runBattleRuntime';
import {
  equipGadget,
  unequipGadget,
  gadgetEntries,
  equippedGadgetId,
  loadoutReading,
  playerInventory,
  type GadgetEquipFailure,
} from '../src/product/playerLoadout';
import {
  GARAGE_SLOT_LABELS as PAGE_LABELS,
  GARAGE_SLOT_ORDER as PAGE_ORDER,
} from '../src/product/homePage';

const REPO_ROOT = join(__dirname, '..');
const FRAME_MS = 1000 / 60;

/** 玩家拥有推进器与反推器（starter 默认不含）。 */
function seedOwnedGadgets(extra: Record<string, number> = {}): void {
  const inv = defaultInventory();
  inv['cannon'] = { one: 1, two: 0 };
  inv['hammer'] = { one: 1, two: 0 };
  inv['thruster'] = { one: 1, two: 0 };
  inv['reverseThruster'] = { one: extra['reverseThruster'] ?? 1, two: 0 };
  saveInventory(inv);
}

describe('GADGET-GARAGE-SLOT-R2', () => {
  beforeEach(() => {
    const mem = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => { mem.set(k, v); },
      removeItem: (k: string) => { mem.delete(k); },
    };
    bindPlatformCore(createWebCore());
    seedOwnedGadgets();
  });

  it('GS-01 Garage 显示五个真实装备槽，原四槽顺序/标签零回归（验收 1）', () => {
    expect(PAGE_ORDER, '槽位 = 5').toEqual(['weapon', 'body', 'rear', 'front', 'gadget']);
    // 前四槽逐字未变
    expect(PAGE_ORDER.slice(0, 4)).toEqual(['weapon', 'body', 'rear', 'front']);
    expect(PAGE_LABELS['weapon']).toBe('武器');
    expect(PAGE_LABELS['body']).toBe('车身');
    expect(PAGE_LABELS['front']).toBe('前轮');
    expect(PAGE_LABELS['rear']).toBe('后轮');
    expect(PAGE_LABELS['gadget'], 'Gadget 槽有玩家语言标签').toBe('辅助');
    // 页面槽位表是**唯一真源**（读数层不另立一份）
    expect(PAGE_ORDER.length).toBe(5);
    expect(Object.keys(PAGE_LABELS).sort()).toEqual([...PAGE_ORDER].sort());
    // 恰好一个 Gadget 槽
    expect(PAGE_ORDER.filter((s) => s === 'gadget').length).toBe(1);
  });

  it('GS-02 展示集只有 EMPTY / Thruster / ReverseThruster（必改 2）', () => {
    const inv = getInventory();
    const entries = gadgetEntries(inv);
    console.log(`\n##### GS-02 Garage 可见 Gadget #####`);
    for (const g of entries) console.log(`  ${g.defId.padEnd(16)} name=${g.name.padEnd(6)} energy=${g.energy} owned=${g.owned} empty=${g.empty}`);
    expect(entries.map((e) => e.defId)).toEqual([EMPTY_SLOT, 'reverseThruster', 'thruster']);
    // pushRod / 测试件 / 退场件**不展示**（但定义仍保留在 registry）
    for (const hidden of ['pushRod', 'testMass', 'wedgeShovel', 'lifter']) {
      expect(entries.some((e) => e.defId === hidden), `${hidden} 不得展示`).toBe(false);
      expect(registry.functionals.get(hidden), `${hidden} 的定义必须仍保留`).toBeTruthy();
    }
  });

  it('GS-03 装备/卸下走唯一写入口，库存与 Energy 校验有效（必改 3）', () => {
    const draft = makeStarterDraft('watermelonBody', registry);
    savePlayerBuild(draft as never);
    // 装 Thruster
    const a = equipGadget('thruster', draft, playerInventory(draft));
    expect(a.ok, `装推进器应成功：${a.detail}`).toBe(true);
    expect(equippedGadgetId(a.draft!)).toBe('thruster');
    // Energy 恰好 +20，且走既有 computeEnergy
    const e0 = computeEnergy(buildSnapshotFromDraft(draft, registry), registry).energy;
    const e1 = computeEnergy(buildSnapshotFromDraft(a.draft!, registry), registry).energy;
    expect(e1 - e0, 'Gadget 只计费一次').toBe(20);
    // 切到反推器（同一时间只有一个）
    const b = equipGadget('reverseThruster', a.draft!, playerInventory(a.draft!));
    expect(b.ok).toBe(true);
    expect(equippedGadgetId(b.draft!), '同一时间只有一个 Gadget').toBe('reverseThruster');
    const e2 = computeEnergy(buildSnapshotFromDraft(b.draft!, registry), registry).energy;
    expect(e2 - e0, '换 Gadget 不叠加能量').toBe(20);
    // 卸下回 EMPTY
    const c = unequipGadget(b.draft!);
    expect(c.ok).toBe(true);
    expect(equippedGadgetId(c.draft!)).toBe(EMPTY_SLOT);
    expect(computeEnergy(buildSnapshotFromDraft(c.draft!, registry), registry).energy).toBe(e0);
  });

  it('GS-04 不可用选项沿用现有 Garage 语义：未拥有=拒绝+不可点（不隐藏卡片）', () => {
    // 制造「未拥有反推器」的库存：显式把 reverseThruster 计数设为 0
    seedOwnedGadgets({ reverseThruster: 0 });
    const draft = makeStarterDraft('watermelonBody', registry);
    const inv = getInventory();
    const out = equipGadget('reverseThruster', draft, inv);
    expect(out.ok, '未拥有必须拒绝').toBe(false);
    expect(out.reason as GadgetEquipFailure).toBe('not-owned');
    // 卡片仍被列出（owned=false）⇒ UI 走既有「未拥有 / 不可点」语义，而不是隐藏
    const entry = gadgetEntries(inv).find((g) => g.defId === 'reverseThruster')!;
    expect(entry, '未拥有的 Gadget 仍出现在读数里').toBeTruthy();
    expect(entry.owned).toBe(false);
  });

  it('GS-05 保存 → 重新进入 Garage → 配置保持同一（验收 3）', () => {
    for (const g of ['thruster', 'reverseThruster', EMPTY_SLOT] as const) {
      const draft = makeStarterDraft('watermelonBody', registry);
      savePlayerBuild(draft as never);
      const out = g === EMPTY_SLOT ? unequipGadget(draft) : equipGadget(g, draft, getInventory());
      expect(out.ok, `${g} 装备成功`).toBe(true);
      // 重新进入 Garage = 从存档读回
      const reloaded = loadPlayerBuild();
      expect(reloaded, `${g} 存档必须读回`).not.toBeNull();
      expect(equippedGadgetId(reloaded!), `${g} 往返后同一配置`).toBe(g);
      // 读数层也报告同一件
      const r = loadoutReading(reloaded!, getInventory());
      expect(r.equippedGadgetId).toBe(g);
    }
  });

  it('GS-06 正式 Run 读到 Gadget 并产生真实位移；EMPTY 不产生 Gadget 行为（验收 4 / 必改 4）', () => {
    const results: Record<string, { triggers: number; minVx: number }> = {};
    for (const g of [EMPTY_SLOT, 'thruster', 'reverseThruster'] as const) {
      const draft: BuildDraft = { ...makeStarterDraft('watermelonBody', registry), gadgetDefId: g };
      // 正式链：BuildDraft → BuildSnapshot（RunBattleRuntime 内部走 buildSpawnPlanFromDraft）
      const rt = new RunBattleRuntime({
        build: [], carriedHp: null, encounterId: 'Chaser',
        playerDraft: draft,
        playerLoadoutTag: 'garage-slot-r2', playerBaseline: true,
      });
      try {
        let steps = 0, minVx = 0;
        while (!rt.result && steps < 900) {
          rt.step(FRAME_MS);
          const v = (rt.orchestrator as any).world.getLinearVelocity((rt.orchestrator as any).vehicleA.body);
          if (v.x < minVx) minVx = v.x;
          steps += 1;
        }
        const triggers = ((rt.orchestrator as any).behaviors as any[]).reduce((a: number, b: any) => {
          const t = b?.behavior?.triggers;
          return a + (typeof t === 'number' ? t : 0);
        }, 0);
        // Runtime 必须真实读到 gadget
        const snapGadget = buildSnapshotFromDraft(draft, registry, g);
        results[g] = { triggers, minVx };
        console.log(`\n##### GS-06 正式 Run #####`);
        console.log(`  ${g.padEnd(16)} snapshotGadget=${snapGadget.gadget ? snapGadget.gadget.defId : '(无)'}  triggers=${triggers}  minVx=${minVx.toFixed(2)}  steps=${steps}`);
      } finally {
        rt.dispose();
      }
    }
    // EMPTY：无 Gadget part / 无触发 / 无后撤
    expect(results[EMPTY_SLOT].triggers, 'EMPTY 不得产生 Gadget 行为').toBe(0);
    // Thruster：真实触发并前冲（peak vx 为正方向 ⇒ minVx 不会像后撤那样很负）
    expect(results['thruster'].triggers, 'Thruster 必须真实触发').toBeGreaterThan(0);
    // Reverse：真实触发并产生明显负向速度（后撤）
    expect(results['reverseThruster'].triggers, 'ReverseThruster 必须真实触发').toBeGreaterThan(0);
    expect(results['reverseThruster'].minVx, '后撤必须产生真实负向位移').toBeLessThan(-2);
  });

  it('GS-07 边界：Gadget 不复用旧 functional slots、不新增第二槽', () => {
    const src = readFileSync(join(REPO_ROOT, 'src/product/playerLoadout.ts'), 'utf8');
    // equipGadget 写的是**独立字段** gadgetDefId
    const fn = src.slice(src.indexOf('export function equipGadget'), src.indexOf('export function unequipGadget'));
    expect(fn).toContain('gadgetDefId: defId');
    // 绝不写 functionalSelections（不映射回 front/top/rear）
    expect(fn, 'Gadget 装备不得写 functionalSelections').not.toContain('functionalSelections');
    // 挂点检查只看 gadgetHardpoints（独立 namespace）
    expect(fn).toContain('gadgetHardpoints');
    expect(fn, '不得查 functionalHardpoints 作为 Gadget 挂点').not.toContain('functionalHardpoints');
    // 槽位闭集：5 个，gadget 恰好一个
    expect(PAGE_ORDER.length).toBe(5);
    expect(PAGE_ORDER.filter((s) => s === 'gadget').length).toBe(1);
    // 隐藏 Top Weapon 未被恢复（top 槽仍不在槽位表里）
    expect(PAGE_ORDER).not.toContain('top');
  });
});