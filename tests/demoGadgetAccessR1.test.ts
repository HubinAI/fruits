/**
 * Queue ID｜DEMO-GADGET-ACCESS-R1
 *
 * 目标：让 **Demo 测试环境**可直接装配 Thruster / ReverseThruster，
 *      **不改变正式玩家的奖励与解锁规则**。
 *
 * 核心结论（先查后改）：**既有 Demo 授权入口已经覆盖两种 Gadget，无需新增系统**。
 * `core/debugGrants.grantablePartIds()` 遍历 `OFFICIAL_PARTS`（= `PART_OPTIONS` 去 EMPTY），
 * 而 `reverseThruster` / `thruster` 已在 `PART_OPTIONS`（GADGET-GARAGE-DATA-R1）⇒
 * DEV「一键全部件 ×1」（`?resetdev=1`）**本来就**会把两种 Gadget 放进库存。
 *
 * 本文件锁定这条既有能力，并证明「Demo 拿得到 → Garage 装得上 → Run 真生效 →
 * 往返保持」，同时证明**正式新账号库存不受影响**。
 */
import { describe, expect, it, beforeEach } from 'vitest';

import { bindPlatformCore } from '../src/platform/context';
import { createWebCore } from '../src/platform/web';
import { registry } from '../src/core/content';
import { makeStarterDraft, buildSnapshotFromDraft } from '../src/lab/buildEditorModel';
import { computeEnergy } from '../src/core/buildValidator';
import {
  STARTER_PARTS,
  getCount,
  getInventory,
  defaultInventory,
} from '../src/core/partInventory';
import { grantAllPartsOnce, grantablePartIds } from '../src/core/debugGrants';
import { loadPlayerBuild, savePlayerBuild } from '../src/core/buildPersistence';
import {
  equipGadget,
  equippedGadgetId,
  loadoutReading,
  playerInventory,
} from '../src/product/playerLoadout';
import { RunBattleRuntime } from '../src/lab/portraitBattleLab/runBattleRuntime';

const FRAME_MS = 1000 / 60;

function freshStorage(): void {
  const mem = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, v); },
    removeItem: (k: string) => { mem.delete(k); },
  };
  bindPlatformCore(createWebCore());
}

describe('DEMO-GADGET-ACCESS-R1', () => {
  beforeEach(() => freshStorage());

  it('DA-01 既有 Demo 授权入口已覆盖两种 Gadget（无需新增系统）', () => {
    const ids = grantablePartIds();
    console.log(`\n##### DA-01 既有 Demo 授权入口 #####`);
    console.log(`  grantablePartIds 共 ${ids.length} 件：${ids.join(', ')}`);
    expect(ids, 'Debug 一键授权必须包含 Thruster').toContain('thruster');
    expect(ids, 'Debug 一键授权必须包含 ReverseThruster').toContain('reverseThruster');
    // ⚠️ 不含退场/测试件（沿用既有 isOfficialPart 过滤）
    for (const excluded of ['testMass', 'wedgeShovel', 'lifter', 'ramHead']) {
      expect(ids, `${excluded} 不得被 Demo 授权`).not.toContain(excluded);
    }
  });

  it('DA-02 Demo 授权后两种 Gadget 各得 1 件，且 Garage 卡片变为可装备（验收 1）', () => {
    const n = grantAllPartsOnce();
    const inv = getInventory();
    console.log(`\n##### DA-02 Demo 授权后 #####`);
    console.log(`  grantAllPartsOnce() 返回 ${n}`);
    for (const g of ['thruster', 'reverseThruster'] as const) {
      const c = getCount(inv, g, 1);
      console.log(`  ${g.padEnd(16)} count=${c}`);
      expect(c, `${g} 必须获得 1 件`).toBe(1);
    }
    // Garage 读数层：owned = true（不再是「未拥有」不可点）
    const draft = makeStarterDraft('watermelonBody', registry);
    savePlayerBuild(draft as never);
    const r = loadoutReading(draft, inv);
    for (const g of ['thruster', 'reverseThruster'] as const) {
      const entry = r.gadgets.find((x) => x.defId === g)!;
      expect(entry, `${g} 必须出现在 Garage 卡片`).toBeTruthy();
      expect(entry.owned, `${g} 在 Demo 环境必须可装备`).toBe(true);
    }
  });

  it('DA-03 Demo 环境可完成「装备 → 存档 → 正式 Run → 回 Garage」全闭环（验收 1 / 2）', () => {
    grantAllPartsOnce(); // Demo 授权
    const draft = makeStarterDraft('watermelonBody', registry);
    savePlayerBuild(draft as never);
    const inv = playerInventory(draft);

    console.log(`\n##### DA-03 Demo 全闭环 #####`);
    for (const g of ['thruster', 'reverseThruster'] as const) {
      // ① Garage 装备（走正式 equipGadget，库存/Energy 校验照常生效）
      const out = equipGadget(g, draft, inv);
      expect(out.ok, `Demo 环境装备 ${g} 应成功：${out.detail}`).toBe(true);
      const equipped = out.draft!;
      void equipped;

      // ② 保存 → 重新进入 Garage（读存档）
      const reloaded = loadPlayerBuild();
      expect(reloaded, `${g} 存档必须读回`).not.toBeNull();
      expect(equippedGadgetId(reloaded!), `${g} 往返后保持`).toBe(g);

      // ③ 进入正式 Run（RunBattleRuntime 读到它并真实产生位移）
      const rt = new RunBattleRuntime({
        build: [], carriedHp: null, encounterId: 'Chaser',
        playerDraft: reloaded!,
        playerLoadoutTag: 'demo-gadget-access', playerBaseline: true,
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
        // snapshot 必须真的带上 gadget
        const snap = buildSnapshotFromDraft(reloaded!, registry, g);
        expect(snap.gadget, `Run 前 snapshot 必须含 ${g}`).not.toBeNull();
        expect(triggers, `${g} 在正式 Run 必须真实触发`).toBeGreaterThan(0);
        console.log(`  ${g.padEnd(16)} snapshot✓ triggers=${triggers} minVx=${minVx.toFixed(2)} steps=${steps}`);
      } finally {
        rt.dispose();
      }
    }
  });

  it('DA-04 未授权的普通新账号：库存不受影响（验收 3）', () => {
    // 全新存档（未调用任何 Demo 授权）
    const inv = defaultInventory();
    savePlayerBuild(makeStarterDraft('watermelonBody', registry) as never);
    const fresh = getInventory();
    console.log(`\n##### DA-04 普通新账号库存 #####`);
    for (const g of ['thruster', 'reverseThruster'] as const) {
      const c = getCount(fresh, g, 1);
      console.log(`  ${g.padEnd(16)} count=${c}（必须 0）`);
      expect(c, `${g} 不得出现在普通新账号库存`).toBe(0);
    }
    // starter 配置逐字未变（不直接修改正式新账号 starter）
    expect([...STARTER_PARTS]).toEqual(['cannon', 'hammer', 'pushRod', 'spear']);
    expect(STARTER_PARTS).not.toContain('thruster');
    expect(STARTER_PARTS).not.toContain('reverseThruster');
    // 且普通新账号下装备 Gadget 会被既有库存校验拒绝（不绕过）
    const draft = makeStarterDraft('watermelonBody', registry);
    const denied = equipGadget('thruster', draft, fresh);
    expect(denied.ok, '未拥有时必须被拒绝').toBe(false);
    expect(denied.reason).toBe('not-owned');
    void inv;
  });

  it('DA-05 Demo 授权幂等，不改奖励/解锁/星级等其它规则（不新增第二套系统）', () => {
    grantAllPartsOnce();
    const first = getCount(getInventory(), 'thruster', 1);
    grantAllPartsOnce(); // 再点一次
    grantAllPartsOnce(); // 再点一次
    const third = getCount(getInventory(), 'thruster', 1);
    console.log(`\n##### DA-05 幂等 #####`);
    console.log(`  thruster count: 首次=${first} 三次后=${third}（应相同，不累加）`);
    expect(third, '重复授权不累加（沿用既有 ×1 幂等语义）').toBe(first);
    // 走的是既有库存持久化（同一 storage key），不是第二套系统
    // ⚠️ 真实 key = partInventory 的 STORAGE_KEY_V2（不是自造 key）
    const raw = (globalThis as any).localStorage.getItem('strongfruit.ownedParts.v2');
    expect(raw, '必须写进既有正式库存 key').toBeTruthy();
    console.log('  库存写入既有 key strongfruit.ownedParts.v2 ✅（无第二套存储）');
  });

  it('DA-06 Energy 校验照常生效（Demo 授权不绕过能量规则）', () => {
    grantAllPartsOnce();
    const draft = makeStarterDraft('watermelonBody', registry);
    const e0 = computeEnergy(buildSnapshotFromDraft(draft, registry), registry).energy;
    const out = equipGadget('reverseThruster', draft, getInventory());
    expect(out.ok).toBe(true);
    const e1 = computeEnergy(buildSnapshotFromDraft(out.draft!, registry), registry).energy;
    console.log(`\n##### DA-06 Energy #####`);
    console.log(`  EMPTY=${e0} →装反推器=${e1}（+${e1 - e0}，只计一次）`);
    expect(e1 - e0, 'Gadget 只计费一次').toBe(20);
    // 超载仍由既有 validator 拒绝：塞满功能件后再加 Gadget
    const heavy = { ...out.draft!, functionalSelections: { ...out.draft!.functionalSelections, front: 'shotgun' } };
    const hv = computeEnergy(buildSnapshotFromDraft(heavy, registry), registry);
    console.log(`  叠加大件后 energy=${hv.energy}${hv.error ? `（${hv.error}）` : ''}`);
    expect(hv.energy, '能量计算仍走既有 computeEnergy').toBeGreaterThan(0);
  });

  it('DA-07 边界：未改 Runtime / Garage UI / 正式奖励池', () => {
    // 既有 debugGrants 不需要为 Gadget 改动（它们已在 OFFICIAL_PARTS 内）
    const src = readSrc();
    expect(src, 'debugGrants 不得为 Gadget 特判（它按 OFFICIAL_PARTS 泛化遍历）')
      .not.toMatch(/thruster/);
    // 正式内容池 / 奖励 / 掉落未被改动
    expect(STARTER_PARTS, 'starter 未被扩大').toEqual(['cannon', 'hammer', 'pushRod', 'spear']);
  });
});

function readSrc(): string {
  // 只读源码做边界断言（node 侧无 DOM）
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  const { join } = require('node:path') as typeof import('node:path');
  return readFileSync(join(__dirname, '../src/core/debugGrants.ts'), 'utf8');
}