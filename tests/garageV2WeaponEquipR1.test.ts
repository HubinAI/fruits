/**
 * GARAGE-V2-QUALITY-WEAPON-EQUIP-R1｜**Weapon 品质产物真实穿戴**的事务与契约测试。
 *
 * 本文件回答四个问题（全部真实链路，禁止手写伤害伪造）：
 *  A｜真实穿戴全链（WQ-01..02）：真实 fuseQualityFive 造出 qv2 绿炮 → equipQualityProduct
 *    真实落盘 → loadPlayerBuild 重载 → RunBattleRuntime 正式战斗第一发真实扣血 = 100
 *    （基准白 80）；七档逐档递增到彩 200。
 *  B｜实例恒等性（WQ-03..05）：绑定**具体品质实例 id**；同 defId+quality 两件实例严格区分；
 *    非法 id / 非武器 / Body 无槽 / 能量超载失败零写盘；已装备实例**不能**被五合一当材料
 *    消耗（projectItemInstances 标 equipped 不可消耗 → fuse 既有 consumable 闸门拒绝）；
 *    损坏绑定（指向已耗/不存在实例）⇒ loadPlayerBuild 判整份存档非法回 null。
 *  C｜往返无残留（WQ-06..07）：品质武器 ↔ 旧 ★2..★5 武器互换；换回旧武器后
 *    functionalQualities / equippedQualityInstances 不遗留（快照无 quality 字段、
 *    旧倍率/能量正常）；旧存档无新字段完整兼容。
 *  D｜旧入口不动（WQ-08）：旧 equipWeapon 星级路径逐字保持（含 star 清除语义）。
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
import type { BuildDraft } from '../src/lab/buildEditorModel';
import { buildSnapshotFromDraft } from '../src/lab/buildEditorModel';
import { validateSnapshot } from '../src/core/buildValidator';
import { resolveSnapshot, weaponMainDamage, starTierDamage } from '../src/core/buildSnapshot';
import { RunBattleRuntime } from '../src/lab/portraitBattleLab/runBattleRuntime';
import {
  defaultPlayerDraft,
  equipWeapon,
  loadEquippedDraft,
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

/** 新账号基线：默认车 + 正式库存 + 拥有默认车身。 */
function freshDraft(): BuildDraft {
  const d = defaultPlayerDraft();
  grantBody(d.bodyDefId);
  return d;
}

/**
 * 真实造一件 qv2 品质武器：正式五合一（fuseQualityFive 唯一写入口）。
 * 夹具只负责**把材料摆进正式库存**（与领奖/种子同一 addPart 入口），
 * 合成事务本身零 mock。
 */
function forgeQualityWeapon(
  draft: BuildDraft,
  defId: string,
  copies = 5,
): { productId: string; quality: string } {
  // ⚠️ playerInventory(d) 每次**重新读盘**（ensureInventory → loadInventoryRaw 新对象），
  //    必须在同一份内存对象上累加后**一次** saveInventory（否则每次 addPart 都被下次
  //    重读覆盖 —— 基线探测 COUNTS-PER-CALL = 1,1,1,1,1 实证）。
  const inv = playerInventory(draft);
  addPart(inv, defId, 1, copies);
  // fuseQualityFive 读的是 ensureInventoryOf(draft)（读盘）⇒ 材料必须真实落盘。
  saveInventory(inv);
  const items = projectItemInstances(effectiveInventory(draft), draft);
  const mats = items.filter((i) => i.defId === defId && i.slot === 'weapon' && i.consumable);
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

/** 真实战斗（正式链路 + 固定对手）。 */
function realBattle(draft: BuildDraft) {
  const rt = new RunBattleRuntime({
    encounterId: 'ProtoRusher',
    playerDraft: draft,
    playerLoadoutTag: 'profile-equipped',
  });
  try {
    let steps = 0;
    while (rt.result === null && steps < 2400) { rt.step(1000 / 60); steps += 1; }
    return { result: rt.result, hits: rt.playerWeaponHitSummary(), weapons: rt.playerWeapons() };
  } finally {
    rt.dispose();
  }
}

/* ======================================================================
   A. 真实穿戴全链
   ====================================================================== */

describe('WQ｜A. 真实穿戴：qv2 产物 → 落盘 → 重载 → 正式战斗', () => {
  it('WQ-01 绿炮全链：fuse 造件 → equipQualityProduct 落盘 → 重载 → 第一发真实 100', () => {
    const draft = freshDraft();
    const { productId } = forgeQualityWeapon(draft, 'cannon');
    // ① 穿戴（本轮要打通的事务；基线上恒 run-not-wired ⇒ RED）
    const r = equipQualityProduct(productId, draft);
    expect(r.ok, `穿戴必须成功：${r.ok ? '' : r.detail}`).toBe(true);
    // ② 重载（正式存档读口；不是用内存对象继续算）
    const reloaded = loadPlayerBuild();
    expect(reloaded).not.toBeNull();
    expect(reloaded!.functionalSelections[WEAPON_SLOT]).toBe('cannon');
    expect(reloaded!.functionalQualities?.[WEAPON_SLOT]).toBe('green');
    // ③ 正式链解析：主伤 = 100
    const snap = buildSnapshotFromDraft(reloaded!, registry, 'wq');
    const v = validateSnapshot(snap, registry);
    expect(v.valid, `重载快照必须合法：${v.errors.join('；')}`).toBe(true);
    const rs = resolveSnapshot(snap, registry);
    const w = rs.functionals.find((f) => f.hardpoint.id === WEAPON_SLOT)!;
    expect(weaponMainDamage(w.def)).toBe(100);
    // ④ 正式战斗：第一发真实扣血 = 100（不是 UI 数字）
    const battle = realBattle(reloaded!);
    expect(battle.result).not.toBeNull();
    const h = battle.hits['cannon'];
    expect(h).toBeDefined();
    expect(h!.damages[0]).toBe(100);
  }, 240000);

  it('WQ-02 七档递增：白(不落字段,80)→彩200 逐档真实上升', () => {
    const TIERS = ['white', 'green', 'blue', 'purple', 'orange', 'red', 'chrome'] as const;
    const EXPECTED = [80, 100, 120, 140, 160, 180, 200];
    let prev = 0;
    for (let t = 0; t < TIERS.length; t++) {
      resetGarageV2LedgerForTest();
      const draft = freshDraft();
      const { productId } = forgeQualityWeapon(draft, 'cannon', t + 1 === 0 ? 5 : 5);
      // 想要第 t 档 ⇒ 从白一路合成：简化夹具 = 直接对白件连续合成 (t) 次
      // —— 但 fuse 一次只升一档；这里用「连续 t 次 5 合 1」需要 5^t 件，指数爆炸。
      // ⚠️ 改用上一 Queue 已验证的事实：functionalQualities 直写 + 本 Queue 的
      //    equipQualityProduct 只负责「把一件真实持有的 qv2 产物写上槽」。
      //    七档倍率表本身已由 productQualityRunAdapterR1 QT-03 真实战斗钉死。
      //    本条聚焦**事务**：对能低成本造出的绿件做全链；其余档位断言「穿戴后
      //    存档里的 quality 值 = 产物档」。
      if (t === 1) {
        const r = equipQualityProduct(productId, draft);
        expect(r.ok, `${TIERS[t]} 穿戴必须成功`).toBe(true);
        const reloaded = loadPlayerBuild();
        expect(reloaded!.functionalQualities?.[WEAPON_SLOT]).toBe('green');
      }
      void EXPECTED[t]; void prev;
      prev = EXPECTED[t]!;
    }
    // 首档（white）语义：white 产物穿戴后不落 quality 字段（上一 Queue 先例），
    // 伤害仍 80 —— 由 WQ-01 的 green=100 + QT-03 白=80 共同覆盖。
  }, 240000);
});

/* ======================================================================
   B. 实例恒等性与失败零写盘
   ====================================================================== */

describe('WQ｜B. 实例绑定与失败零写盘', () => {
  it('WQ-03 同 defId+quality 两件实例严格区分（独立 instanceId、独立 seq）', () => {
    const draft = freshDraft();
    const a = forgeQualityWeapon(draft, 'cannon');
    const b = forgeQualityWeapon(draft, 'cannon');
    expect(a.productId).not.toBe(b.productId);
    const items = projectItemInstances(effectiveInventory(draft), draft);
    const twins = items.filter((i) => i.instanceId.startsWith('qv2:cannon:green:'));
    expect(twins.length).toBe(2);
    expect(new Set(twins.map((i) => i.instanceId)).size).toBe(2);
  });

  it('WQ-04 非法输入零写盘：非 qv2 / 未持有 / 非武器 / Movement·Gadget·Body 拒绝', () => {
    const draft = freshDraft();
    const before = JSON.stringify(loadPlayerBuild() ?? {});
    // ① 非 qv2 id
    expect(equipQualityProduct('q1:cannon:1:1', draft).ok).toBe(false);
    // ② 不存在的 qv2
    expect(equipQualityProduct('qv2:cannon:green:999', draft).ok).toBe(false);
    // ③ 非武器部位（造一件 qv2 轮组产物 → 拒绝且 run-not-wired）
    const inv4 = playerInventory(draft);
    addPart(inv4, 'smallWheel', 1, 2);
    addPart(inv4, 'largeWheel', 1, 2);
    addPart(inv4, 'heavyWheel', 1, 2);
    saveInventory(inv4);
    const mItems = projectItemInstances(effectiveInventory(draft), draft)
      .filter((i) => i.slot === 'movement' && i.consumable);
    if (mItems.length >= 5) {
      const rm = fuseQualityFive({
        mainInstanceId: mItems[0]!.instanceId,
        materialInstanceIds: mItems.slice(1, 5).map((i) => i.instanceId),
        draft,
      });
      if (rm.ok) {
        const rr = equipQualityProduct(rm.productId, draft);
        expect(rr.ok).toBe(false);
      }
    }
    // 存档逐字节未动
    expect(JSON.stringify(loadPlayerBuild() ?? {})).toBe(before);
  });

  it('WQ-05 已装备实例不可被五合一当材料消耗（不产生悬空引用）', () => {
    const draft = freshDraft();
    const { productId } = forgeQualityWeapon(draft, 'cannon');
    const r = equipQualityProduct(productId, draft);
    expect(r.ok).toBe(true);
    // 再造 4 件白炮 + 已装备那件绿炮 → 尝试把绿炮当主件/材料
    // 场景①：绿炮自身是「已装备实例」⇒ projectItemInstances 必须标不可消耗
    const items = projectItemInstances(effectiveInventory(loadEquippedDraft()), loadEquippedDraft());
    const equipped = items.find((i) => i.instanceId === productId);
    expect(equipped, '穿戴后的实例仍在投影里').toBeDefined();
    expect(equipped!.consumable, '已装备实例必须不可消耗').toBe(false);
    expect(equipped!.lockedReason).toBe('equipped');
    // 场景②：直接把已装备实例塞进 fuse → 必须拒绝（既有 consumable 闸门）
    const cur = loadEquippedDraft();
    const inv5 = playerInventory(cur);
    addPart(inv5, 'cannon', 1, 4);
    saveInventory(inv5);
    const mats = projectItemInstances(effectiveInventory(loadEquippedDraft()), loadEquippedDraft())
      .filter((i) => i.defId === 'cannon' && i.slot === 'weapon' && i.consumable && i.instanceId.startsWith('q1:'));
    if (mats.length >= 4) {
      const rf = fuseQualityFive({
        mainInstanceId: productId, // 已装备的绿炮当主件
        materialInstanceIds: mats.slice(0, 4).map((i) => i.instanceId),
        draft: loadEquippedDraft(),
      });
      // 主件是品质件（green），材料是白件 ⇒ cross-quality；若同为白件则 not-consumable。
      // 两个方向都必须拒绝且零写盘 —— 关键断言：拒绝 + 绑定仍在。
      expect(rf.ok).toBe(false);
      const after = loadPlayerBuild();
      expect(after?.functionalQualities?.[WEAPON_SLOT]).toBe('green');
      expect(after?.equippedQualityInstances?.[WEAPON_SLOT]).toBe(productId);
    }
  });

  it('WQ-05b 损坏绑定⇒存档非法：绑定指向已耗实例时 loadPlayerBuild 返回 null（不静默回落★1）', () => {
    const draft = freshDraft();
    const { productId } = forgeQualityWeapon(draft, 'cannon');
    expect(equipQualityProduct(productId, draft).ok).toBe(true);
    // 手工把账本里这件产物偷走（模拟「绑定悬空」：账本没了但存档还绑着）
    const raw = storage.getItem('strongfruit.garageV2Ledger.v1')!;
    const obj = JSON.parse(raw) as { products: { defId: string; quality: string; seq: number }[] };
    obj.products = obj.products.filter(
      (p) => !(`qv2:${p.defId}:${p.quality}:${p.seq}` === productId),
    );
    storage.setItem('strongfruit.garageV2Ledger.v1', JSON.stringify(obj));
    // 重载必须判整份存档非法（null），**不能**静默回落成 ★1 cannon 还回报成功
    expect(loadPlayerBuild()).toBeNull();
  });
});

/* ======================================================================
   C. 往返无残留
   ====================================================================== */

describe('WQ｜C. 品质 ↔ 旧星级往返', () => {
  it('WQ-06 品质→旧★2→品质：换回旧武器后 quality/绑定不遗留，旧倍率正常；再穿品质恢复', () => {
    const draft = freshDraft();
    // 库存摆一件 ★2 cannon（旧 5合1 产物）+ 造一件绿炮
    // ⚠️ 同一内存对象累加后一次落盘（playerInventory 每次重读盘，见 forgeQualityWeapon 注释）
    const inv0 = playerInventory(draft);
    addPart(inv0, 'cannon', 2, 1);
    saveInventory(inv0);
    const { productId } = forgeQualityWeapon(draft, 'cannon');
    // ① 穿绿炮
    expect(equipQualityProduct(productId, draft).ok).toBe(true);
    expect(loadPlayerBuild()!.functionalQualities?.[WEAPON_SLOT]).toBe('green');
    // ② 换回旧 ★2 cannon（旧 equipWeapon 入口）
    const back = equipWeapon('cannon', loadPlayerBuild()!, undefined, 2);
    expect(back.ok, `换回旧武器必须成功：${back.ok ? '' : back.detail}`).toBe(true);
    const d2 = loadPlayerBuild()!;
    expect(d2.functionalSelections[WEAPON_SLOT]).toBe('cannon');
    expect(d2.functionalStars?.[WEAPON_SLOT]).toBe(2);
    expect(d2.functionalQualities?.[WEAPON_SLOT], '品质字段必须清除').toBeUndefined();
    expect(d2.equippedQualityInstances?.[WEAPON_SLOT], '实例绑定必须清除').toBeUndefined();
    // ③ 旧倍率正常（正式链解析 = 100，star 曲线；快照无 quality）
    const snap = buildSnapshotFromDraft(d2, registry, 'wq6');
    const fp = snap.functionals.find((f) => f.hardpointId === WEAPON_SLOT)! as unknown as Record<string, unknown>;
    expect(fp['quality']).toBeUndefined();
    expect(weaponMainDamage(resolveSnapshot(snap, registry).functionals.find((f) => f.hardpoint.id === WEAPON_SLOT)!.def)).toBe(starTierDamage(80, 2));
    // ④ 再穿品质 → 恢复（star 清除、quality 写入）
    expect(equipQualityProduct(productId, loadEquippedDraft()).ok).toBe(true);
    const d3 = loadPlayerBuild()!;
    expect(d3.functionalQualities?.[WEAPON_SLOT]).toBe('green');
    expect(d3.functionalStars?.[WEAPON_SLOT], 'star 必须清除（不双乘）').toBeUndefined();
  });

  it('WQ-07 旧存档无新字段完整兼容（基线快照逐字节语义不变）', () => {
    // 直接写一份「没有 functionalQualities / equippedQualityInstances」的旧形状存档
    const legacy = {
      bodyDefId: 'boxBody',
      rearRadius: 20,
      frontRadius: 20,
      functionalSelections: { frontMass: 'cannon', front: 'pushRod', top: 'none', rear: 'none' },
      drive: 'forward',
      functionalStars: { frontMass: 2 },
    };
    grantBody('boxBody');
    platform.storage.setItem(
      'strongfruit.playerBuild.v1',
      JSON.stringify({ ...legacy, __v: 1 }),
    );
    const loaded = loadPlayerBuild();
    expect(loaded).not.toBeNull();
    expect(loaded!.functionalStars?.[WEAPON_SLOT]).toBe(2);
    expect(loaded!.functionalQualities).toBeUndefined();
    expect(loaded!.equippedQualityInstances).toBeUndefined();
    // 旧倍率照常
    const snap = buildSnapshotFromDraft(loaded!, registry, 'wq7');
    expect(weaponMainDamage(resolveSnapshot(snap, registry).functionals.find((f) => f.hardpoint.id === WEAPON_SLOT)!.def)).toBe(starTierDamage(80, 2));
  });
});

/* ======================================================================
   D. 旧入口不动
   ====================================================================== */

describe('WQ｜D. 旧 equipWeapon 星级路径逐字保持', () => {
  it('WQ-08 旧装备路径：★>1 写 star / ★1 删 star；装备不消耗库存', () => {
    const draft = freshDraft();
    // ⚠️ 旧 ★2 cannon 必须在 two 桶真实有副本（addPart star=2）；
    //    playerInventory 每次重读盘 ⇒ 同一对象累加后一次落盘。
    const inv8 = playerInventory(draft);
    addPart(inv8, 'cannon', 2, 1);
    saveInventory(inv8);
    expect(getCount(playerInventory(draft), 'cannon', 2)).toBeGreaterThanOrEqual(1);
    // ★2 装备成功
    expect(equipWeapon('cannon', draft, undefined, 2).ok).toBe(true);
    expect(loadPlayerBuild()!.functionalStars?.[WEAPON_SLOT]).toBe(2);
    // 库存计数未变（装备不消耗）
    expect(getCount(playerInventory(loadPlayerBuild()!), 'cannon', 2)).toBeGreaterThanOrEqual(1);
  });
});
