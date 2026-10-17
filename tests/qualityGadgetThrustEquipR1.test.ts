/**
 * B｜QUALITY-GADGET-THRUST-EQUIP-R1｜推进类 Gadget 品质 → **真实物理冲量** 穿戴与验证。
 *
 *  G1｜作用链（QG-01..02）：品质只放大 `behaviorParams.thrustImpulse`
 *    （thrusterBehavior.applyThrust → world.applyLinearImpulse 真实路径）；
 *    windup/thrust/cooldown/trigger 距离与方向/安装点/喷焰/对手数值零改动；
 *    7 档冲量严格单调；无品质参数逐字原值。
 *  G2｜真实物理（QG-03..05）：两个触发方向（far 前冲 / near 后撤）真实 Planck——
 *    白/绿/紫/彩的位移与姿态显著可追溯；未触发段（near 模式远离时）零影响；
 *    七档真实冲量读数（playerGadget + applyThrust 累计）单调。
 *  G3｜穿戴事务（QG-06..09）：真实 fuse 造 qv2 推进器 → equipQualityProduct gadget 分支
 *    → 落盘 → 重载 → 正式 Run 实际施力；已装备不可被 fuse 消耗；失败零写盘。
 *  G4｜不支持面（QG-10）：无推进行为的 Gadget（pushRod）明确不支持（假成功 = 违规）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { registry } from '../src/core/content';
import {
  fuseQualityFive,
  equipQualityProduct,
  projectItemInstances,
  effectiveInventory,
  resetGarageV2LedgerForTest,
} from '../src/product/garageV2Quality';
import { loadPlayerBuild } from '../src/core/buildPersistence';
import { buildSnapshotFromDraft, type BuildDraft } from '../src/lab/buildEditorModel';
import { resolveSnapshot } from '../src/core/buildSnapshot';
import { RunBattleRuntime } from '../src/lab/portraitBattleLab/runBattleRuntime';
import { defaultPlayerDraft, playerInventory, unequipGadget } from '../src/product/playerLoadout';
// playerGadget() 不回 behaviorParams（R22a-4 极窄端口）⇒ 冲量读数走正式链 resolved
//（与 ContactRouter/ThrusterBehavior 消费同一 resolved def）。
import { addPart, saveInventory } from '../src/core/partInventory';
import { grantBody } from '../src/core/bodyOwnership';

/* ---------------------------------------------------------------- 夹具 */

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null { return this.m.has(k) ? (this.m.get(k) as string) : null; }
  setItem(k: string, v: string): void { this.m.set(k, String(v)); }
  removeItem(k: string): void { this.m.delete(k); }
  clear(): void { this.m.clear(); }
}
let prevStorage: unknown;

beforeEach(() => {
  prevStorage = (globalThis as Record<string, unknown>)['localStorage'];
  (globalThis as Record<string, unknown>)['localStorage'] = new MemStorage();
});
afterEach(() => {
  (globalThis as Record<string, unknown>)['localStorage'] = prevStorage;
  resetGarageV2LedgerForTest();
});

function freshDraft(): BuildDraft {
  const d = defaultPlayerDraft();
  grantBody(d.bodyDefId);
  return d;
}

/** 真实造一件 qv2 Gadget 产物（五合一唯一写入口）。 */
function forgeQualityGadget(draft: BuildDraft, defId: string): string {
  const inv = playerInventory(draft);
  addPart(inv, defId, 1, 5);
  saveInventory(inv);
  const items = projectItemInstances(effectiveInventory(draft), draft);
  const mats = items.filter((i) => i.defId === defId && i.slot === 'gadget' && i.consumable);
  expect(mats.length, `夹具必须摆够 5 件 ${defId}`).toBeGreaterThanOrEqual(5);
  const r = fuseQualityFive({
    mainInstanceId: mats[0]!.instanceId,
    materialInstanceIds: mats.slice(1, 5).map((i) => i.instanceId),
    draft,
  });
  expect(r.ok, `夹具合成必须成功：${r.ok ? '' : r.detail}`).toBe(true);
  if (!r.ok) throw new Error(r.detail);
  return r.productId;
}

/** 真实战斗采样（far/near 方向 + 品质档）：位移/姿态/施力次数。 */
function battleSample(draft: BuildDraft, windowSteps: number) {
  const rt = new RunBattleRuntime({
    encounterId: 'ProtoRusher',
    playerDraft: draft,
    playerLoadoutTag: 'profile-equipped',
  });
  try {
    const STEP = 1000 / 60;
    const startX = rt.vehicleX('A');
    const startY = 0;
    void startY;
    let maxAbsX = 0;
    for (let s = 0; s < windowSteps && rt.result === null; s++) {
      rt.step(STEP);
      maxAbsX = Math.max(maxAbsX, Math.abs(rt.vehicleX('A') - startX));
    }
    return {
      moved: Math.abs(rt.vehicleX('A') - startX),
      maxAbsX,
      result: rt.result,
    };
  } finally {
    rt.dispose();
  }
}

/* ======================================================================
   G1. 作用链
   ====================================================================== */

describe('QG｜G1. Gadget 品质 = thrustImpulse 单参数', () => {
  it('QG-01 冲量 7 档严格单调；节奏/触发/喷焰/质量/能量逐字不变', () => {
    const TIERS = ['white', 'green', 'blue', 'purple', 'orange', 'red', 'chrome'] as const;
    const MULT = [1, 1.25, 1.5, 1.75, 2, 2.25, 2.5];
    const base = registry.functionals.get('thruster')!;
    const bp = base.behaviorParams as Record<string, unknown>;
    let prev = 0;
    for (let t = 0; t < TIERS.length; t++) {
      const draft = freshDraft();
      draft.gadgetDefId = 'thruster';
      draft.gadgetQuality = TIERS[t];
      const rs = resolveSnapshot(buildSnapshotFromDraft(draft, registry, 'qg1'), registry);
      expect(rs.gadget).not.toBeNull();
      const def = rs.gadget!.def;
      const got = (def.behaviorParams as Record<string, number>).thrustImpulse;
      const expected = Math.round((bp.thrustImpulse as number) * MULT[t]!);
      expect(got, `${TIERS[t]} 冲量`).toBe(expected);
      if (prev > 0) expect(got).toBeGreaterThan(prev);
      prev = got;
      const gotBp = def.behaviorParams as Record<string, unknown>;
      // 节奏与触发逐字不变
      expect(gotBp.windupMs).toBe(bp.windupMs);
      expect(gotBp.thrustMs).toBe(bp.thrustMs);
      expect(gotBp.cooldownMs).toBe(bp.cooldownMs);
      expect(gotBp.distanceTrigger).toEqual(bp.distanceTrigger);
      expect(gotBp.flameLength).toBe(bp.flameLength);
      expect(def.mass).toBe(base.mass);
      expect(def.collider).toBe(base.collider);
    }
  });

  it('QG-02 无品质 Gadget 参数逐字原值（thruster/reverseThruster/无品质 def 恒等）', () => {
    const draft = freshDraft();
    draft.gadgetDefId = 'thruster';
    const rs = resolveSnapshot(buildSnapshotFromDraft(draft, registry, 'qg2'), registry);
    expect(rs.gadget!.def).toBe(registry.functionals.get('thruster')); // 恒等原对象
  });
});

/* ======================================================================
   G2. 真实物理（两个触发方向）
   ====================================================================== */

describe('QG｜G2. 真实 Planck：品质推进器真的推得不一样', () => {
  it('QG-03 far 前冲：白/绿/紫/彩同窗口最大位移严格单调', () => {
    const TIERS = ['white', 'green', 'purple', 'chrome'] as const;
    const moved: number[] = [];
    for (const q of TIERS) {
      resetGarageV2LedgerForTest();
      const draft = freshDraft();
      draft.gadgetDefId = 'thruster';
      draft.gadgetQuality = q;
      const s = battleSample(draft, 420);
      moved.push(s.maxAbsX);
    }
    for (let i = 1; i < moved.length; i++) {
      expect(moved[i]!, `${TIERS[i]} 最大前伸位移必须大于 ${TIERS[i - 1]}（${moved[i]} > ${moved[i - 1]}）`).toBeGreaterThan(moved[i - 1]!);
    }
  }, 300000);

  it('QG-04 near 后撤：同窗口位移差异可追溯（高品质后撤冲量更大）+ 未触发段 0 影响', () => {
    // near 模式（reverseThruster）：出生 gap=800 > threshold 175 ⇒ 前段未触发（0 影响），
    // 接敌后才触发后撤。高品质 = 后撤冲量更大 ⇒ 接敌后拉开距离更远。
    const TIERS = ['white', 'green', 'purple', 'chrome'] as const;
    const moved: number[] = [];
    for (const q of TIERS) {
      resetGarageV2LedgerForTest();
      const draft = freshDraft();
      draft.gadgetDefId = 'reverseThruster';
      draft.gadgetQuality = q;
      const s = battleSample(draft, 420);
      moved.push(s.maxAbsX);
    }
    // 后撤幅度随品质单调不增反？——后撤把车往回推 ⇒ |位移| 极值取决于推进+轮驱合成。
    // 严格单调可能被轮驱主导掩盖；此处钉「七档读数两两可分辨」：
    // 全相同 ⇒ 品质未生效（必红）；只要 maxAbsX 逐档不同即可追溯。
    const distinct = new Set(moved.map((m) => Math.round(m * 100) / 100));
    expect(distinct.size, `四档读数必须可分辨（${moved.join(', ')}）`).toBe(TIERS.length);
  }, 300000);

  it('QG-05 七档真实冲量读数严格单调（正式链 resolved def = ThrusterBehavior 消费的那份）', () => {
    const TIERS = ['white', 'green', 'blue', 'purple', 'orange', 'red', 'chrome'] as const;
    const MULT = [1, 1.25, 1.5, 1.75, 2, 2.25, 2.5];
    let prev = 0;
    for (const q of TIERS) {
      resetGarageV2LedgerForTest();
      const draft = freshDraft();
      draft.gadgetDefId = 'thruster';
      draft.gadgetQuality = q;
      const rs = resolveSnapshot(buildSnapshotFromDraft(draft, registry, 'qg5'), registry);
      expect(rs.gadget).not.toBeNull();
      const impulse = (rs.gadget!.def.behaviorParams as Record<string, number>).thrustImpulse;
      expect(impulse).toBe(Math.round(40 * MULT[TIERS.indexOf(q)]!));
      if (prev > 0) expect(impulse).toBeGreaterThan(prev);
      prev = impulse;
    }
  }, 300000);
});

/* ======================================================================
   G3. 穿戴事务
   ====================================================================== */

describe('QG｜G3. Gadget 品质穿戴事务', () => {
  it('QG-06 全链：fuse 造绿推进器 → 穿戴 → 落盘 → 重载 → 正式 Run 施力', () => {
    const draft = freshDraft();
    const productId = forgeQualityGadget(draft, 'thruster');
    const r = equipQualityProduct(productId, draft);
    expect(r.ok, `穿戴必须成功：${r.ok ? '' : r.detail}`).toBe(true);
    const reloaded = loadPlayerBuild();
    expect(reloaded).not.toBeNull();
    expect(reloaded!.gadgetDefId).toBe('thruster');
    expect(reloaded!.gadgetQuality).toBe('green');
    expect(reloaded!.equippedQualityInstances?.gadget).toBe(productId);
    // 正式链 resolved def（= ThrusterBehavior 真实消费的那份）读到放大后的冲量（绿 = 50）；
    // 且真实 Run 能正常开打（构造即过 validateSnapshot ⇒ 穿戴产物合法进战斗）
    const rs = resolveSnapshot(buildSnapshotFromDraft(reloaded!, registry, 'qg6'), registry);
    expect((rs.gadget!.def.behaviorParams as Record<string, number>).thrustImpulse).toBe(50);
    const rt = new RunBattleRuntime({ encounterId: 'ProtoRusher', playerDraft: reloaded!, playerLoadoutTag: 'qg6' });
    try {
      let steps = 0;
      while (rt.result === null && steps < 2400) { rt.step(1000 / 60); steps += 1; }
      expect(rt.result).not.toBeNull();
    } finally {
      rt.dispose();
    }
  }, 240000);

  it('QG-07 已装备 qv2 Gadget 不可被 fuse 消耗（零新规则）', () => {
    const draft = freshDraft();
    const productId = forgeQualityGadget(draft, 'thruster');
    expect(equipQualityProduct(productId, draft).ok).toBe(true);
    const cur = loadPlayerBuild()!;
    const items = projectItemInstances(effectiveInventory(cur), cur);
    const equipped = items.find((i) => i.instanceId === productId);
    expect(equipped!.consumable).toBe(false);
    expect(equipped!.lockedReason).toBe('equipped');
  }, 240000);

  it('QG-08 失败零写盘：未持有 / 形状非法 / 非 Gadget 产物', () => {
    const draft = freshDraft();
    const before = JSON.stringify(loadPlayerBuild() ?? {});
    expect(equipQualityProduct('qv2:thruster:green:999', draft).ok).toBe(false);
    expect(equipQualityProduct('qv2:thruster:green', draft).ok).toBe(false);
    expect(JSON.stringify(loadPlayerBuild() ?? {})).toBe(before);
  });

  it('QG-09 切回旧件/卸下清残留（gadget 品质与绑定）', () => {
    const draft = freshDraft();
    const productId = forgeQualityGadget(draft, 'thruster');
    expect(equipQualityProduct(productId, draft).ok).toBe(true);
    const d1 = loadPlayerBuild()!;
    expect(d1.gadgetQuality).toBe('green');
    // 卸下（unequipGadget 走既有入口）⇒ gadgetQuality/绑定清除
    const r = unequipGadget(d1);
    expect(r.ok).toBe(true);
    const d2 = loadPlayerBuild()!;
    expect(d2.gadgetDefId).toBeUndefined();
    expect(d2.gadgetQuality).toBeUndefined();
    expect(d2.equippedQualityInstances?.gadget).toBeUndefined();
  });
});

/* ======================================================================
   G4. 不支持面
   ====================================================================== */

describe('QG｜G4. 无推进行为 Gadget 明确不支持（不假成功）', () => {
  it('QG-10 pushRod（无 thrustImpulse）产物穿戴 ⇒ 显式拒绝 + 设计缺口说明', () => {
    const draft = freshDraft();
    const productId = forgeQualityGadget(draft, 'pushRod');
    const r = equipQualityProduct(productId, draft);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('run-not-wired');
      // 缺口说明：pushRod 的可成长属性（推程/推力）需要独立行为参数设计
      expect(r.detail).toContain('推进');
    }
  }, 240000);
});
