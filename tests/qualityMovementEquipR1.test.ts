/**
 * A｜QUALITY-MOVEMENT-RUNTIME-EQUIP-R1｜轮组品质 → **真实物理驱动** 的穿戴与验证。
 *
 * 回答四个问题（全部真实链路；物理结论必须来自真实 Planck 跑步，不是 resolvedDef 读数）：
 *  M1｜作用链（QM-01..03）：品质只放大 `driveTorque`（驱动扭矩，真实 Revolute motor
 *    已有路径）；radius/mass/grip/maxRPM/cruiseSpeed/几何/车高/碰撞零改动；
 *    7 档扭矩严格单调；无品质轮 def 逐字原值。
 *  M2｜真实物理（QM-04..06）：同一合法 Build 只有轮品质不同 ⇒ 正常速度下
 *    固定窗口内位移**严格单调**、首次接触时刻**提前**（接敌更快）；
 *    前后轮品质独立（只抬后轮时前轮滑行阶段不受影响）。
 *  M3｜穿戴事务（QM-07..10）：真实 fuse 造 qv2 轮组 → equipQualityProduct 落盘
 *    → 重载进正式 Run；同件实例禁占前后双槽；失败零写盘；已装备不可被 fuse 消耗。
 *  M4｜往返与旧链（QM-11..12）：切回旧轮清品质/ID；旧 Movement/旧 star 零漂移。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { registry } from '../src/core/content';
import { platform } from '../src/platform';
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
import { weaponMainDamage } from '../src/core/buildSnapshot';
import { RunBattleRuntime } from '../src/lab/portraitBattleLab/runBattleRuntime';
import {
  defaultPlayerDraft,
  equipMovement,
  playerInventory,
  WEAPON_SLOT,
} from '../src/product/playerLoadout';
import { addPart, getCount, saveInventory } from '../src/core/partInventory';
import { grantBody } from '../src/core/bodyOwnership';

/* ---------------------------------------------------------------- 夹具 */

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null { return this.m.has(k) ? (this.m.get(k) as string) : null; }
  setItem(k: string, v: string): void { this.m.set(k, String(v)); }
  removeItem(k: string): void { this.m.delete(k); }
  clear(): void { this.m.clear(); }
  key(i: number): string | null { return [...this.m.keys()][i] ?? null; }
  get length(): number { return this.m.size; }
}
let storage: MemStorage;
let prevStorage: unknown;

beforeEach(() => {
  prevStorage = (globalThis as Record<string, unknown>)['localStorage'];
  storage = new MemStorage();
  (globalThis as Record<string, unknown>)['localStorage'] = storage;
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

/**
 * 真实造一件 qv2 轮组：正式五合一（材料摆进正式库存同一对象后一次落盘——
 * ⚠️ playerInventory(d) 每次重读盘，循环累加会被覆盖，必须同一对象一次 save）。
 */
function forgeQualityMovement(draft: BuildDraft, defId: string): { productId: string; quality: string } {
  // ⚠️ COH 装备保护：正在装备的轮组若是同档最后一件，fuse 会拒绝（装备引用悬空）。
  //    夹具先把前后轮切到 heavyWheel（车库持有），让目标轮组堆叠可消耗；
  //    产物穿戴时再由 equipQualityProduct 原子换上（合法快照校验兜底）。
  const invGrant = playerInventory(draft);
  addPart(invGrant, 'heavyWheel', 1, 1);
  saveInventory(invGrant); // ⚠️ 先落盘：equipMovement 的拥有判据读盘（playerInventory 每次重读）
  const invPre = playerInventory(draft);
  const er = equipMovement('rear', 'heavyWheel', draft, invPre);
  const ef = equipMovement('front', 'heavyWheel', er.ok && er.draft ? er.draft : draft, invPre);
  // ⚠️ equipMovement 返回新 draft（不原地改参）⇒ 把结果写回调用方的对象（fuse 装备保护读它）
  const merged = ef.ok && ef.draft ? ef.draft : (er.ok && er.draft ? er.draft : draft);
  Object.assign(draft, merged);
  draft.rearWheelDefId = merged.rearWheelDefId;
  draft.frontWheelDefId = merged.frontWheelDefId;
  const inv = playerInventory(draft);
  addPart(inv, defId, 1, 5);
  saveInventory(inv);
  const items = projectItemInstances(effectiveInventory(draft), draft);
  const mats = items.filter((i) => i.defId === defId && i.slot === 'movement' && i.consumable);
  expect(mats.length, `夹具必须摆够 5 件 ${defId}`).toBeGreaterThanOrEqual(5);
  const r = fuseQualityFive({
    mainInstanceId: mats[0]!.instanceId,
    materialInstanceIds: mats.slice(1, 5).map((i) => i.instanceId),
    draft,
  });
  expect(r.ok, `夹具合成必须成功：${r.ok ? '' : r.detail}`).toBe(true);
  if (!r.ok) throw new Error(r.detail);
  return { productId: r.productId, quality: r.productQuality };
}

/** 真实战斗采样：固定窗口内的位移与首次接触时刻（固定对手 ProtoRusher）。 */
function battleSample(draft: BuildDraft, windowSteps: number) {
  const rt = new RunBattleRuntime({
    encounterId: 'ProtoRusher',
    playerDraft: draft,
    playerLoadoutTag: 'profile-equipped',
  });
  try {
    const STEP = 1000 / 60;
    const startX = rt.vehicleX('A');
    let firstContactMs: number | null = null;
    for (let s = 0; s < windowSteps && rt.result === null; s++) {
      rt.step(STEP);
      if (firstContactMs === null) {
        const d = rt.contactResidue();
        if (d.contact || d.damage) firstContactMs = rt.timeMs;
      }
    }
    return { moved: Math.abs(rt.vehicleX('A') - startX), firstContactMs, x: rt.vehicleX('A') };
  } finally {
    rt.dispose();
  }
}

/* ======================================================================
   M1. 作用链（解析层）
   ====================================================================== */

describe('QM｜M1. 轮组品质 = driveTorque 单属性（解析层）', () => {
  it('QM-01 扭矩 7 档严格单调；其余轮参数逐字不变', () => {
    const TIERS = ['white', 'green', 'blue', 'purple', 'orange', 'red', 'chrome'] as const;
    const EXPECTED_MULT = [1, 1.25, 1.5, 1.75, 2, 2.25, 2.5];
    const base = registry.movements.get('smallWheel')!;
    let prev = 0;
    for (let t = 0; t < TIERS.length; t++) {
      // 直接构造带品质的 MovementInstall → resolveSnapshot
      const draft = freshDraft();
      draft.rearWheelDefId = 'smallWheel';
      // 排除 radius overrides 干扰（freshDraft 基准 20 ≠ smallWheel 12）
      draft.rearRadius = 12;
      draft.frontRadius = 12;
      draft.movementQualities = { rear: TIERS[t] };
      const rs = resolveSnapshot(buildSnapshotFromDraft(draft, registry, 'qm1'), registry);
      const rear = rs.movements.find((m) => m.install.hardpointId === 'rear')!;
      const def = rear.def as typeof base;
      const expectTorque = Math.round(base.driveTorque * EXPECTED_MULT[t]!);
      expect(def.driveTorque, `${TIERS[t]} 扭矩`).toBe(expectTorque);
      if (prev > 0) expect(def.driveTorque).toBeGreaterThan(prev);
      prev = def.driveTorque;
      // 其余参数逐字不变（几何/质量/抓地/转速/速度/能量）
      expect(def.radius).toBe(base.radius);
      expect(def.mass).toBe(base.mass);
      expect(def.grip).toBe(base.grip);
      expect(def.maxRPM).toBe(base.maxRPM);
      expect(def.cruiseSpeedPxPerStep).toBe(base.cruiseSpeedPxPerStep);
      expect(def.energy).toBe(base.energy);
    }
  });

  it('QM-02 无品质轮 def 逐字原值（旧 Build/对手池零漂移）', () => {
    // ① 无 overrides（Lab 直构）⇒ 无品质恒等返回同一对象（零 clone）
    const bare: BuildDraft = {
      ...freshDraft(),
      rearWheelDefId: 'smallWheel',
      rearRadius: 12,
    } as BuildDraft;
    // 直构 snapshot 绕过 draft.radius overrides：手动剥掉 overrides 字段
    const snapBare = buildSnapshotFromDraft(bare, registry, 'qm2a');
    const rsBare = resolveSnapshot(
      { ...snapBare, movements: snapBare.movements.map((m) => ({ ...m, overrides: undefined })) },
      registry,
    );
    const rearBare = rsBare.movements.find((m) => m.install.hardpointId === 'rear')!;
    expect(rearBare.def).toBe(registry.movements.get('smallWheel'));
    // ② 有 overrides（正式 draft 路径）⇒ 无品质时 resolved def 全键与 registry 逐值相等
    const draft = freshDraft();
    draft.rearWheelDefId = 'smallWheel';
    draft.frontWheelDefId = 'heavyWheel';
    draft.rearRadius = 12;
    draft.frontRadius = 20;
    const rs = resolveSnapshot(buildSnapshotFromDraft(draft, registry, 'qm2b'), registry);
    for (const m of rs.movements) {
      const base = registry.movements.get(m.def.id)!;
      expect(m.def).toEqual(base); // 无品质 ⇒ 无任何键被改
    }
  });

  it('QM-03 只抬后轮：前轮 def 零改动（槽位独立）', () => {
    const draft = freshDraft();
    draft.rearWheelDefId = 'smallWheel';
    draft.frontWheelDefId = 'smallWheel';
    draft.rearRadius = 12;
    draft.frontRadius = 12;
    draft.movementQualities = { rear: 'purple' };
    const rs = resolveSnapshot(buildSnapshotFromDraft(draft, registry, 'qm3'), registry);
    const rear = rs.movements.find((m) => m.install.hardpointId === 'rear')!;
    const front = rs.movements.find((m) => m.install.hardpointId === 'front')!;
    expect((rear.def as { driveTorque: number }).driveTorque).toBe(Math.round(520 * 1.75));
    // 前轮：无品质 ⇒ 全键与 registry 逐值相等（overrides radius 12 也 = canonical 12）
    expect(front.def).toEqual(registry.movements.get('smallWheel'));
  });
});

/* ======================================================================
   M2. 真实物理
   ====================================================================== */

describe('QM｜M2. 真实 Planck：品质轮真的跑得不一样', () => {
  const WINDOW = 420; // 7s 固定步窗口（ProtoRusher 接敌段）

  it('QM-04 同 Build 只有轮品质不同：起步段位移严格单调 + 首次接触时刻单调提前', () => {
    // ⚠️ 口径裁定（实测）：7s 全窗口内高品质先接敌 ⇒ 战斗交互（击退）污染纯驱动位移
    //    （反例 394<424 = 彩轮 4.2s 接敌、白轮 4.9s）。扭矩差异的直接物理表现是
    //    「加速到 cruise 1.5 上限之前」的起步段 ⇒ 取固定 120 步（2s，无接触干扰），
    //    与 content.ts:494 既有口径（2s 位移 160 vs 145）同源。
    const TIERS = ['white', 'green', 'blue', 'purple', 'orange', 'red', 'chrome'] as const;
    const movedList: number[] = [];
    const contactList: (number | null)[] = [];
    for (const q of TIERS) {
      resetGarageV2LedgerForTest();
      const draft = freshDraft();
      draft.rearWheelDefId = 'smallWheel';
      draft.frontWheelDefId = 'smallWheel';
      draft.movementQualities = { rear: q };
      const sStart = battleSample(draft, 120);
      movedList.push(sStart.moved);
      const sFull = battleSample(draft, WINDOW);
      contactList.push(sFull.firstContactMs);
    }
    for (let i = 1; i < movedList.length; i++) {
      expect(movedList[i]!, `第 ${i + 1} 档起步位移必须大于第 ${i} 档（${movedList[i]} > ${movedList[i - 1]}）`).toBeGreaterThan(movedList[i - 1]!);
    }
    for (let i = 1; i < contactList.length; i++) {
      const a = contactList[i - 1]!;
      const b = contactList[i]!;
      expect(b, `第 ${i + 1} 档接触时刻必须不晚于第 ${i} 档`).toBeLessThanOrEqual(a);
    }
  }, 600000);

  it('QM-05 高品质轮首次接触时刻不晚于低品质（接敌更快）', () => {
    const mk = (q: 'white' | 'chrome'): BuildDraft => {
      const d = freshDraft();
      d.rearWheelDefId = 'smallWheel';
      d.frontWheelDefId = 'smallWheel';
      d.movementQualities = { rear: q };
      return d;
    };
    const white = battleSample(mk('white'), WINDOW);
    const chrome = battleSample(mk('chrome'), WINDOW);
    expect(white.firstContactMs).not.toBeNull();
    expect(chrome.firstContactMs).not.toBeNull();
    expect(chrome.firstContactMs!, '彩轮必须不晚于白轮接触').toBeLessThanOrEqual(white.firstContactMs!);
  }, 300000);

  it('QM-06 只有后轮带品质：前轮读数与旧 Build 相同（另一槽零影响）', () => {
    const base = freshDraft();
    base.rearWheelDefId = 'smallWheel';
    base.frontWheelDefId = 'smallWheel';
    base.rearRadius = 12;
    base.frontRadius = 12;
    const q = freshDraft();
    q.rearWheelDefId = 'smallWheel';
    q.frontWheelDefId = 'smallWheel';
    q.rearRadius = 12;
    q.frontRadius = 12;
    q.movementQualities = { rear: 'purple' };
    const rsB = resolveSnapshot(buildSnapshotFromDraft(base, registry, 'qm6b'), registry);
    const rsQ = resolveSnapshot(buildSnapshotFromDraft(q, registry, 'qm6q'), registry);
    const frontB = rsB.movements.find((m) => m.install.hardpointId === 'front')!;
    const frontQ = rsQ.movements.find((m) => m.install.hardpointId === 'front')!;
    expect(frontQ.def).toEqual(frontB.def); // 前轮全键相同（品质只抬本槽扭矩）
  });
});

/* ======================================================================
   M3. 穿戴事务
   ====================================================================== */

describe('QM｜M3. 轮组品质穿戴事务', () => {
  it('QM-07 真实穿戴全链：fuse 造绿轮 → equipQualityProduct rear → 落盘 → 重载 → Run 生效', () => {
    const draft = freshDraft();
    draft.rearWheelDefId = 'smallWheel';
    draft.frontWheelDefId = 'smallWheel';
    const { productId } = forgeQualityMovement(draft, 'smallWheel');
    const r = equipQualityProduct(productId, draft);
    expect(r.ok, `穿戴必须成功：${r.ok ? '' : r.detail}`).toBe(true);
    const reloaded = loadPlayerBuild();
    expect(reloaded).not.toBeNull();
    expect(reloaded!.rearWheelDefId).toBe('smallWheel');
    expect(reloaded!.movementQualities?.rear).toBe('green');
    expect(reloaded!.equippedQualityInstances?.rear).toBe(productId);
    // 前轮未受影响
    expect(reloaded!.movementQualities?.front).toBeUndefined();
    // 正式链：后轮扭矩 = 绿 650
    const rs = resolveSnapshot(buildSnapshotFromDraft(reloaded!, registry, 'qm7'), registry);
    const rear = rs.movements.find((m) => m.install.hardpointId === 'rear')!;
    expect((rear.def as { driveTorque: number }).driveTorque).toBe(650);
  }, 240000);

  it('QM-08 同一件 qv2 轮组不能同时占前后轮（零写盘）', () => {
    const draft = freshDraft();
    draft.rearWheelDefId = 'smallWheel';
    draft.frontWheelDefId = 'smallWheel';
    const { productId } = forgeQualityMovement(draft, 'smallWheel');
    expect(equipQualityProduct(productId, draft).ok).toBe(true);
    const d1 = loadPlayerBuild()!;
    // 已装后轮，再穿前轮 ⇒ 拒绝
    const r2 = equipQualityProduct(productId, d1, 'front');
    expect(r2.ok).toBe(false);
    const d2 = loadPlayerBuild()!;
    expect(d2.movementQualities?.front).toBeUndefined();
    expect(d2.equippedQualityInstances?.front).toBeUndefined();
  }, 240000);

  it('QM-09 失败零写盘：非轮子 qv2 / 未持有 / 非法槽位', () => {
    const draft = freshDraft();
    const before = JSON.stringify(loadPlayerBuild() ?? {});
    // 未持有
    expect(equipQualityProduct('qv2:smallWheel:green:999', draft, 'rear').ok).toBe(false);
    // 形状非法
    expect(equipQualityProduct('qv2:smallWheel:green', draft, 'rear').ok).toBe(false);
    // 非轮子（weapon 产物走旧槽语义，此处 movementSlot 语义下应拒绝 weapon）
    expect(equipQualityProduct('qv2:cannon:green:1', draft, 'rear').ok).toBe(false);
    expect(JSON.stringify(loadPlayerBuild() ?? {})).toBe(before);
  });

  it('QM-10 已装备 qv2 轮组不可被五合一当材料（防双槽/悬空）', () => {
    const draft = freshDraft();
    draft.rearWheelDefId = 'smallWheel';
    draft.frontWheelDefId = 'smallWheel';
    const { productId } = forgeQualityMovement(draft, 'smallWheel');
    expect(equipQualityProduct(productId, draft).ok).toBe(true);
    const cur = loadPlayerBuild()!;
    const items = projectItemInstances(effectiveInventory(cur), cur);
    const equipped = items.find((i) => i.instanceId === productId);
    expect(equipped!.consumable).toBe(false);
    expect(equipped!.lockedReason).toBe('equipped');
  }, 240000);
});

/* ======================================================================
   M4. 往返与旧链
   ====================================================================== */

describe('QM｜M4. 往返无残留与旧链不动', () => {
  it('QM-11 切回旧轮：本槽品质/ID 清除；另一槽不动；旧 star 武器不动', () => {
    const draft = freshDraft();
    // 前后轮先挂 heavyWheel（equipMovement 返回新 draft，须合并）
    const invG = playerInventory(draft);
    addPart(invG, 'heavyWheel', 1, 1);
    saveInventory(invG);
    const invPre = playerInventory(draft);
    const er = equipMovement('rear', 'heavyWheel', draft, invPre);
    const ef = equipMovement('front', 'heavyWheel', er.ok && er.draft ? er.draft : draft, invPre);
    const merged = ef.ok && ef.draft ? ef.draft : draft;
    Object.assign(draft, merged);
    // 造两件品质轮（同 defId+quality 的两个独立实例：seq 1 / 2）：
    // 实例 A 穿 rear、实例 B 穿 front —— 同时验证「同件禁双槽」（不同实例可分占两槽）。
    const instA = forgeQualityMovement(draft, 'smallWheel');
    const instB = forgeQualityMovement(draft, 'smallWheel');
    expect(instA.productId).not.toBe(instB.productId);
    expect(equipQualityProduct(instA.productId, draft).ok).toBe(true);
    const dRear = loadPlayerBuild()!;
    const eqFront = equipQualityProduct(instB.productId, dRear, 'front');
    expect(eqFront.ok, `front 穿戴必须成功：${eqFront.ok ? '' : eqFront.detail}`).toBe(true);
    const d1 = loadPlayerBuild()!;
    expect(d1.movementQualities?.rear).toBe('green');
    expect(d1.movementQualities?.front).toBe('green');
    // 切回旧轮（rear → heavyWheel）
    const back = equipMovement('rear', 'heavyWheel', d1);
    expect(back.ok).toBe(true);
    const d2 = loadPlayerBuild()!;
    expect(d2.rearWheelDefId).toBe('heavyWheel');
    expect(d2.movementQualities?.rear, 'rear 品质必须清除').toBeUndefined();
    expect(d2.equippedQualityInstances?.rear, 'rear 绑定必须清除').toBeUndefined();
    // front 品质与绑定不受影响
    expect(d2.movementQualities?.front).toBe('green');
    expect(d2.equippedQualityInstances?.front).toBe(instB.productId);
    // 武器槽不受影响
    expect(d2.functionalSelections[WEAPON_SLOT]).toBe('cannon');
    expect(weaponMainDamage(
      resolveSnapshot(buildSnapshotFromDraft(d2, registry, 'qm11'), registry)
        .functionals.find((f) => f.hardpoint.id === WEAPON_SLOT)!.def,
    )).toBe(80);
  });

  it('QM-12 旧 star 与旧 Movement 零漂移：无品质 Build 与基线快照同源', () => {
    const draft = freshDraft();
    draft.rearWheelDefId = 'smallWheel';
    draft.rearRadius = 12;
    const rs = resolveSnapshot(buildSnapshotFromDraft(draft, registry, 'qm12'), registry);
    const rear = rs.movements.find((m) => m.install.hardpointId === 'rear')!;
    expect(rear.def).toEqual(registry.movements.get('smallWheel'));
    // 旧轮装备照常（⚠️ addPart 后必须同一对象一次落盘——playerInventory 每次重读盘）
    const inv12 = playerInventory(draft);
    addPart(inv12, 'heavyWheel', 1, 1);
    saveInventory(inv12);
    expect(equipMovement('front', 'heavyWheel', draft).ok).toBe(true);
    expect(loadPlayerBuild()!.frontWheelDefId).toBe('heavyWheel');
    void getCount;
    void platform;
  });
});
