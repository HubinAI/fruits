/**
 * PRODUCT-LOOP-R3-MOVEMENT-GARAGE-EQUIP｜**Garage 里的 Movement 配置维度** targeted 测试。
 *
 * 逐条对应 Queue 的验收：
 *   1 Garage 可看到当前 owned Movement        → MG-01 / MG-02 / MG-03
 *   2 rear / front 可独立装备                → MG-06 / MG-07 / MG-08
 *   3 reload 后保持                          → MG-09 / MG-09b
 *   4 Product Run Snapshot 与 Garage 配置一致 → MG-10 / MG-10b
 *   5 Weapon 配置不被覆盖                    → MG-11 / MG-12 / MG-13
 *   6 targeted tests + tsc                   → 本文件（tsc 在门禁里）
 *
 * 外加本队列自己立的不变量：
 *   - **三态语义不被压成两态**：`undefined`（缺省轮）/ `'none'`（明确卸下）/ 正式 defId
 *     在 `BuildDraft` 上**逐字节可区分**（MG-05 / MG-05b / MG-05c）；
 *   - **只写唯一落盘点**：`savePlayerBuild(` 在 `playerLoadout.ts` 仍然只出现一次（MG-14）；
 *   - **不新增 Movement 内容 / 不改数值**：装备前后 `registry.movements` 逐件相同、
 *     `radius` / `mass` / `grip` / `energy` / `maxRPM` 一个都没变（MG-15 / MG-15b）；
 *   - **不给没拥有的轮组开口子**：未拥有的 Movement **结构上装不上**（MG-04 / MG-04b）。
 *
 * ⚠️ 每个用例开头都会 `isolateMigrations()`（预置两份一次性迁移的标记）：本文件要验的是
 *    **Movement 装备链路本身**，不该被 onboarding（补 cannon）或 reseed（清 cannon ★≥2）干扰。
 *    这是**隔离变量**，不是放宽断言 —— 那两份迁移各自的契约由 `playerGrowthR2A` /
 *    `productReseedR2` 分别在测。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it } from 'vitest';

import { savePlayerBuild } from '../src/core/buildPersistence';
import {
  EMPTY_SLOT,
  buildSnapshotFromDraft,
  makeStarterDraft,
  type BuildDraft,
} from '../src/lab/buildEditorModel';
import { registry } from '../src/core/content';
import { validateSnapshot } from '../src/core/buildValidator';
import { resolveSnapshot } from '../src/core/buildSnapshot';
import { OFFICIAL_MOVEMENTS, getCount, type PartInventory } from '../src/core/partInventory';
import { markR2Onboarding } from '../src/product/r2Onboarding';
import { markR2Reseed } from '../src/product/r2Reseed';
import { MOVEMENT_STAR } from '../src/product/movementInventory';
import { movementMapping } from '../src/product/runMovementCanonical';
import {
  WEAPON_SLOT,
  defaultPlayerDraft,
  equipMovement,
  equipWeapon,
  loadEquippedDraft,
  movementReading,
  playerInventory,
} from '../src/product/playerLoadout';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PRODUCT_DIR = join(REPO_ROOT, 'src', 'product');
function readProduct(f: string): string {
  return readFileSync(join(PRODUCT_DIR, f), 'utf8');
}
/** 源码守卫必须先剥注释（本项目铁律：注释里的自指文字会骗过字符串匹配）。 */
function strip(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const BUILD_KEY = 'strongfruit.playerBuild.v1';
const INV_KEY = 'strongfruit.ownedParts.v2';

/** 内存版 localStorage（node 无原生；与其它产品侧测试同一模式）。 */
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v));
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  key(i: number): string | null {
    return [...this.m.keys()][i] ?? null;
  }
  get length(): number {
    return this.m.size;
  }
}

let store: MemStorage;

beforeEach(() => {
  store = new MemStorage();
  (globalThis as unknown as { localStorage: MemStorage }).localStorage = store;
});

/** 预置两份一次性迁移的标记 ⇒ 本文件只观察 Movement 装备链路本身。 */
function isolateMigrations(): void {
  markR2Onboarding();
  markR2Reseed();
}

/** 某件 Movement 在本份 draft 上的**存档原值**（`undefined` / `'none'` / defId 三态）。 */
function storedWheel(draft: BuildDraft, hardpointId: 'rear' | 'front'): string | undefined {
  return hardpointId === 'rear' ? draft.rearWheelDefId : draft.frontWheelDefId;
}

/**
 * 把一件需要库存的轮组**真的发到库存里**（走正式落盘，不走 `equipMovement`）。
 * ⚠️ 刻意用 `saveInventory` 而不是 `addPart` + 手动 save：口径与真实入库链路一致。
 */
function grantMovement(defId: string, n = 1): void {
  const inv = JSON.parse(store.getItem(INV_KEY) ?? '{}') as Record<string, { one?: number }>;
  const row = inv[defId] ?? {};
  row.one = (row.one ?? 0) + n;
  inv[defId] = row;
  store.setItem(INV_KEY, JSON.stringify(inv));
}

/** 从磁盘重读库存（与生产路径同口径），供 `equipMovement` 的 `inv` 形参使用。 */
function invNow(draft: BuildDraft): PartInventory {
  return playerInventory(draft);
}

// ============================================================================
describe('PRODUCT-LOOP-R3-MOVEMENT-GARAGE-EQUIP｜A. Garage 能看到真实 owned Movement', () => {
  it('MG-01 读数覆盖全部 canonical Movement（含不进库存的缺省轮），挂点顺序取自正式 BodyDef', () => {
    isolateMigrations();
    const draft = defaultPlayerDraft();
    const inv = playerInventory(draft);
    const r = movementReading(draft, inv);

    expect(r.cards.map((c) => c.defId)).toEqual([...registry.movements.keys()]);
    expect(r.slots.map((s) => s.hardpointId)).toEqual(
      (registry.bodies.get(draft.bodyDefId)?.movementHardpoints ?? []).map((h) => h.id),
    );
    expect(r.slots.map((s) => s.hardpointId)).toEqual(['rear', 'front']);
  });

  it('MG-02 新账号：只有缺省轮 owned（implicit），三档需库存轮组未拥有', () => {
    isolateMigrations();
    const draft = defaultPlayerDraft();
    const inv = playerInventory(draft);
    const r = movementReading(draft, inv);

    expect(r.available).toEqual([r.defaultDefId]);
    const implicitCard = r.cards.find((c) => c.defId === r.defaultDefId);
    expect(implicitCard?.implicit).toBe(true);
    expect(implicitCard?.owned).toBe(true);
    expect(implicitCard?.count).toBe(0);

    for (const m of OFFICIAL_MOVEMENTS) {
      const c = r.cards.find((x) => x.defId === m);
      expect(c?.owned, `${m} 新账号不应拥有`).toBe(false);
      expect(r.available).not.toContain(m);
    }
    expect(r.legal).toBe(true);
  });

  it('MG-03 两个挂点的读数与正式 Snapshot 一致：缺省轮在跑 ⇒ 两槽都生效、都不算「卸下」', () => {
    isolateMigrations();
    const draft = defaultPlayerDraft();
    const r = movementReading(draft, playerInventory(draft));

    for (const s of r.slots) {
      // 存档里没有这个键 ⇒ storedDefId = null（**不是** 'none'）
      expect(s.storedDefId).toBeNull();
      expect(s.unmounted).toBe(false);
      expect(s.effectiveDefId).toBe(r.defaultDefId);
      expect(s.name).not.toBe('空');
    }
    expect(r.equippedDefIds).toEqual([r.defaultDefId]);
  });
});

// ============================================================================
describe('PRODUCT-LOOP-R3-MOVEMENT-GARAGE-EQUIP｜B. 只允许装备真实 owned Movement', () => {
  it('MG-04 未拥有 ⇒ `not-owned` 拒绝，且**一个字节都没写**（Build 存档未被创建）', () => {
    isolateMigrations();
    const draft = defaultPlayerDraft();
    const inv = invNow(draft);
    const before = store.getItem(BUILD_KEY);

    for (const m of OFFICIAL_MOVEMENTS) {
      const out = equipMovement('rear', m, draft, inv);
      expect(out.ok, `${m} 未拥有不得装上`).toBe(false);
      expect(out.reason).toBe('not-owned');
      expect(out.draft).toBeUndefined();
    }
    expect(store.getItem(BUILD_KEY)).toBe(before);
  });

  it('MG-04b 拥有之后同一调用**通过**（证明拒绝来自「未拥有」而不是别的分支）', () => {
    isolateMigrations();
    const draft = defaultPlayerDraft();
    playerInventory(draft); // 先把库存落到盘上（正式 ensureInventory）
    const target = OFFICIAL_MOVEMENTS[0];
    grantMovement(target);
    const out = equipMovement('rear', target, draft, invNow(draft));
    expect(out.ok).toBe(true);
    expect(out.draft?.rearWheelDefId).toBe(target);
  });

  it('MG-04c 非 Movement 的 defId ⇒ `not-movement`（含 Weapon 与 Run 强化名）', () => {
    isolateMigrations();
    const draft = defaultPlayerDraft();
    const inv = invNow(draft);
    for (const bad of ['cannon', 'hammer', 'watermelonBody', 'heavyShell', 'noSuchWheel']) {
      const out = equipMovement('rear', bad, draft, inv);
      expect(out.ok, `${bad} 不得被当成 Movement`).toBe(false);
      expect(out.reason).toBe('not-movement');
    }
  });

  it('MG-04d 车身没有的 Movement 挂点 ⇒ `unknown-slot`（不写入任意字段）', () => {
    isolateMigrations();
    const draft = defaultPlayerDraft();
    const inv = invNow(draft);
    for (const bad of ['frontMass', 'top', 'middle', '']) {
      const out = equipMovement(bad, 'wheelStd', draft, inv);
      expect(out.ok, `"${bad}" 不是 Movement 挂点`).toBe(false);
      expect(out.reason).toBe('unknown-slot');
    }
  });
});

// ============================================================================
describe('PRODUCT-LOOP-R3-MOVEMENT-GARAGE-EQUIP｜C. 三态语义（缺省 / 卸下 / 指定）逐字节可区分', () => {
  it('MG-05 装缺省轮 ⇒ **删除该键**（回到「存档里没有」形态，不是写字面量）', () => {
    isolateMigrations();
    const draft0 = defaultPlayerDraft();
    playerInventory(draft0);
    const target = OFFICIAL_MOVEMENTS[0];
    grantMovement(target);
    const inv = invNow(draft0);

    // 先装上一件真轮组
    const a = equipMovement('rear', target, draft0, inv);
    expect(a.ok).toBe(true);
    expect(a.draft?.rearWheelDefId).toBe(target);

    // 再选回缺省轮 ⇒ 键被删掉
    const b = equipMovement('rear', 'wheelStd', a.draft as BuildDraft, inv);
    expect(b.ok).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(b.draft, 'rearWheelDefId')).toBe(false);
    expect(storedWheel(b.draft as BuildDraft, 'rear')).toBeUndefined();
  });

  it("MG-05b 卸下 ⇒ 写 `'none'`（≠ 删除键），且正式 Snapshot **不含**该槽", () => {
    isolateMigrations();
    const draft0 = defaultPlayerDraft();
    const inv = invNow(draft0);

    const out = equipMovement('front', EMPTY_SLOT, draft0, inv);
    expect(out.ok).toBe(true);
    const next = out.draft as BuildDraft;
    expect(next.frontWheelDefId).toBe(EMPTY_SLOT);
    // ⚠️ 三态里最容易出事的一条：'none' 必须与「没有这个键」区分开
    expect(Object.prototype.hasOwnProperty.call(next, 'frontWheelDefId')).toBe(true);

    const snap = buildSnapshotFromDraft(next, registry);
    expect(snap.movements.map((m) => m.hardpointId)).toEqual(['rear']);
    const r = movementReading(next, inv);
    expect(r.slots.find((s) => s.hardpointId === 'front')?.unmounted).toBe(true);
    expect(r.slots.find((s) => s.hardpointId === 'front')?.effectiveDefId).toBeNull();
  });

  it('MG-05c 缺省（undefined）与卸下（`none`）在正式 `validateSnapshot` 下都合法，但语义不同', () => {
    isolateMigrations();
    const base = defaultPlayerDraft();
    const bothFull = equipMovement('rear', EMPTY_SLOT, base, invNow(base));
    expect(bothFull.ok).toBe(true);
    const noWheels = equipMovement('front', EMPTY_SLOT, bothFull.draft as BuildDraft, invNow(base));
    // 卸光两个轮组仍然合法（validateSnapshot 没有「必须有轮」规则）—— 口径与 Weapon 侧一致
    expect(noWheels.ok).toBe(true);
    const snap = buildSnapshotFromDraft(noWheels.draft as BuildDraft, registry);
    expect(snap.movements).toEqual([]);

    // 而「缺省」形态下两槽都在（缺省轮），数量与前者不同 ⇒ 三态确实可区分
    const dflt = buildSnapshotFromDraft(base, registry);
    expect(dflt.movements.length).toBe(2);
  });
});

// ============================================================================
describe('PRODUCT-LOOP-R3-MOVEMENT-GARAGE-EQUIP｜D. rear / front 两个独立正式字段', () => {
  it('MG-06 rear 与 front 可以装**不同**的轮组，互不覆盖', () => {
    isolateMigrations();
    const draft0 = defaultPlayerDraft();
    playerInventory(draft0);
    const [a, b] = OFFICIAL_MOVEMENTS;
    grantMovement(a);
    grantMovement(b);
    const inv = invNow(draft0);

    const r1 = equipMovement('rear', a, draft0, inv);
    expect(r1.ok).toBe(true);
    const r2 = equipMovement('front', b, r1.draft as BuildDraft, inv);
    expect(r2.ok).toBe(true);

    const next = r2.draft as BuildDraft;
    expect(next.rearWheelDefId).toBe(a);
    expect(next.frontWheelDefId).toBe(b);
    // 两个字段各自独立 ⇒ 不是「一套轮组管两处」
    expect(next.rearWheelDefId).not.toBe(next.frontWheelDefId);
  });

  it('MG-07 改 rear 不动 front（逐字节证明：只动了一个键）', () => {
    isolateMigrations();
    const draft0 = defaultPlayerDraft();
    playerInventory(draft0);
    const [a, b] = OFFICIAL_MOVEMENTS;
    grantMovement(a, 2);
    grantMovement(b);
    const inv = invNow(draft0);

    const r1 = equipMovement('front', b, draft0, inv);
    const withFront = r1.draft as BuildDraft;
    const r2 = equipMovement('rear', a, withFront, inv);
    const next = r2.draft as BuildDraft;

    expect(next.frontWheelDefId).toBe(withFront.frontWheelDefId);
    expect(next.rearWheelDefId).toBe(a);
    // 只改了 rear 的那两个键（defId + radius）
    const changed = Object.keys(next).filter(
      (k) => JSON.stringify((next as unknown as Record<string, unknown>)[k]) !==
        JSON.stringify((withFront as unknown as Record<string, unknown>)[k]),
    );
    expect(changed.sort()).toEqual(['rearRadius', 'rearWheelDefId']);
  });

  it('MG-08 半径随轮组一起改写（口径同 buildEditorModel：选中轮组即写入该轮组默认半径）', () => {
    isolateMigrations();
    const draft0 = defaultPlayerDraft();
    playerInventory(draft0);
    const target = OFFICIAL_MOVEMENTS[0];
    grantMovement(target);
    const def = registry.movements.get(target);
    expect(def).toBeDefined();

    const out = equipMovement('rear', target, draft0, invNow(draft0));
    expect(out.ok).toBe(true);
    expect((out.draft as BuildDraft).rearRadius).toBe(def?.radius);
    // 另一侧半径不动
    expect((out.draft as BuildDraft).frontRadius).toBe(draft0.frontRadius);

    // Snapshot 的 overrides.radius 与之一致（下游数值链路零改动）
    const snap = buildSnapshotFromDraft(out.draft as BuildDraft, registry);
    expect(snap.movements.find((m) => m.hardpointId === 'rear')?.overrides?.radius).toBe(def?.radius);
  });

  it('MG-08b runtime 读数真的换了轮：radius / mass / grip / maxRPM 来自新 def', () => {
    isolateMigrations();
    const draft0 = defaultPlayerDraft();
    playerInventory(draft0);
    const target = OFFICIAL_MOVEMENTS[0];
    grantMovement(target);
    const def = registry.movements.get(target);
    const out = equipMovement('rear', target, draft0, invNow(draft0));
    const m = movementMapping(out.draft as BuildDraft);
    const rear = m.slots.find((s) => s.hardpointId === 'rear');
    expect(rear?.runtimeNumbers?.mass).toBe(def?.mass);
    expect(rear?.runtimeNumbers?.grip).toBe(def?.grip);
    expect(rear?.runtimeNumbers?.maxRPM).toBe(def?.maxRPM);
    // radius 走 overrides（= 上面写进去的那个值），与 def 默认半径同值
    expect(rear?.runtimeNumbers?.radius).toBe(def?.radius);
  });
});

// ============================================================================
describe('PRODUCT-LOOP-R3-MOVEMENT-GARAGE-EQUIP｜E. 落盘与 reload 保持', () => {
  it('MG-09 装备真的写进正式 Build 存档 key，reload（重读）后 rear / front 都在', () => {
    isolateMigrations();
    const draft0 = defaultPlayerDraft();
    playerInventory(draft0);
    const [a, b] = OFFICIAL_MOVEMENTS;
    grantMovement(a);
    grantMovement(b);
    const inv = invNow(draft0);

    const r1 = equipMovement('rear', a, draft0, inv);
    const r2 = equipMovement('front', b, r1.draft as BuildDraft, inv);
    expect(r2.ok).toBe(true);

    // 落盘取证：独立读磁盘（不经过 loadEquippedDraft）
    const raw = store.getItem(BUILD_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string) as BuildDraft;
    const inner = (parsed as unknown as { draft?: BuildDraft }).draft ?? parsed;
    expect(inner.rearWheelDefId).toBe(a);
    expect(inner.frontWheelDefId).toBe(b);

    // reload 等价物 = 唯一读入口重读
    const reloaded = loadEquippedDraft();
    expect(reloaded.rearWheelDefId).toBe(a);
    expect(reloaded.frontWheelDefId).toBe(b);
  });

  it('MG-09b reload 后 Garage 读数与 reload 前**逐字段相同**，且不再写盘', () => {
    isolateMigrations();
    const draft0 = defaultPlayerDraft();
    playerInventory(draft0);
    const target = OFFICIAL_MOVEMENTS[0];
    grantMovement(target);
    const inv = invNow(draft0);
    const out = equipMovement('rear', target, draft0, inv);
    const after = out.draft as BuildDraft;

    const readingBefore = movementReading(after, inv);
    const diskBefore = store.getItem(BUILD_KEY);

    const reloaded = loadEquippedDraft();
    const readingAfter = movementReading(reloaded, playerInventory(reloaded));

    expect(readingAfter.slots).toEqual(readingBefore.slots);
    expect(readingAfter.cards).toEqual(readingBefore.cards);
    expect(readingAfter.equippedDefIds).toEqual(readingBefore.equippedDefIds);
    // reload 是纯读（迁移已标记 ⇒ 不写盘）
    expect(store.getItem(BUILD_KEY)).toBe(diskBefore);
  });

  it('MG-09c 卸下/换档后 reload 仍保持三态（`none` 不会被读成缺省轮）', () => {
    isolateMigrations();
    const draft0 = defaultPlayerDraft();
    const inv = invNow(draft0);
    const out = equipMovement('front', EMPTY_SLOT, draft0, inv);
    expect(out.ok).toBe(true);

    const reloaded = loadEquippedDraft();
    expect(reloaded.frontWheelDefId).toBe(EMPTY_SLOT);
    const r = movementReading(reloaded, playerInventory(reloaded));
    expect(r.slots.find((s) => s.hardpointId === 'front')?.unmounted).toBe(true);
    expect(r.slots.find((s) => s.hardpointId === 'front')?.effectiveDefId).toBeNull();
    // 另一侧不受影响
    expect(r.slots.find((s) => s.hardpointId === 'rear')?.effectiveDefId).toBe(r.defaultDefId);
  });
});

// ============================================================================
describe('PRODUCT-LOOP-R3-MOVEMENT-GARAGE-EQUIP｜F. Product Run Snapshot 与 Garage 配置一致', () => {
  it('MG-10 「Garage 装上的」== 「Run Snapshot 装载的」：走同一条正式链路，逐挂点相等', () => {
    isolateMigrations();
    const draft0 = defaultPlayerDraft();
    playerInventory(draft0);
    const target = OFFICIAL_MOVEMENTS[0];
    grantMovement(target);
    const inv = invNow(draft0);
    const out = equipMovement('rear', target, draft0, inv);
    const after = out.draft as BuildDraft;

    // ① 产品侧读数（Garage 画卡片用的那一份）
    const reading = movementReading(after, playerInventory(after));
    const garageRear = reading.slots.find((s) => s.hardpointId === 'rear')?.effectiveDefId;

    // ② Run 侧入口：把存档原样交给 Run 的解析器（= 「开始冒险」地址里的 `equipped=` 做的事）
    const runDraft = JSON.parse(JSON.stringify(after)) as BuildDraft;
    const snapshot = buildSnapshotFromDraft(runDraft, registry, 'run-profile-loadout');
    expect(validateSnapshot(snapshot, registry).valid).toBe(true);
    const runRear = snapshot.movements.find((m) => m.hardpointId === 'rear')?.defId;

    expect(garageRear).toBe(target);
    expect(runRear).toBe(garageRear);
  });

  it('MG-10b Runtime 数值也与之一致（`resolveSnapshot` 的合并结果逐字段对上）', () => {
    isolateMigrations();
    const draft0 = defaultPlayerDraft();
    playerInventory(draft0);
    const target = OFFICIAL_MOVEMENTS[0];
    grantMovement(target);
    const out = equipMovement('rear', target, draft0, invNow(draft0));
    const after = out.draft as BuildDraft;

    const resolved = resolveSnapshot(buildSnapshotFromDraft(after, registry), registry);
    const rear = resolved.movements.find((m) => m.install.hardpointId === 'rear');
    const reading = movementReading(after, playerInventory(after));
    const slot = reading.slots.find((s) => s.hardpointId === 'rear');

    expect(rear?.def.id).toBe(slot?.effectiveDefId);
    expect(rear?.def.id).toBe(target);
  });
});

// ============================================================================
describe('PRODUCT-LOOP-R3-MOVEMENT-GARAGE-EQUIP｜G. 其它维度零回归', () => {
  it('MG-11 装备 Movement **不覆盖** Weapon 槽（两套挂点不同名，结构上不可能互踩）', () => {
    isolateMigrations();
    const draft0 = defaultPlayerDraft();
    playerInventory(draft0);
    const target = OFFICIAL_MOVEMENTS[0];
    grantMovement(target);
    const inv = invNow(draft0);

    const weaponBefore = loadoutWeapon(draft0);
    const out = equipMovement('rear', target, draft0, inv);
    const after = out.draft as BuildDraft;

    expect(loadoutWeapon(after)).toEqual(weaponBefore);
    // 车身确实没有名为 rear 的 functional 挂点被 Movement 写入
    expect(after.functionalSelections[WEAPON_SLOT]).toBe(weaponBefore.defId);
    expect(after.functionalSelections[WEAPON_SLOT]).not.toBe(target);
  });

  it('MG-12 装 Movement 后 `equipWeapon` 仍照常工作，且不冲掉 Movement 选择', () => {
    isolateMigrations();
    const draft0 = defaultPlayerDraft();
    playerInventory(draft0);
    const target = OFFICIAL_MOVEMENTS[0];
    grantMovement(target);
    const inv = invNow(draft0);

    const m = equipMovement('rear', target, draft0, inv);
    const withMovement = m.draft as BuildDraft;
    const w = equipWeapon('hammer', withMovement, inv, 1);
    expect(w.ok).toBe(true);

    const next = w.draft as BuildDraft;
    expect(next.functionalSelections[WEAPON_SLOT]).toBe('hammer');
    // Movement 选择一字未动
    expect(next.rearWheelDefId).toBe(target);
    expect(next.frontRadius).toBe(withMovement.frontRadius);
    expect(next.rearRadius).toBe(withMovement.rearRadius);
  });

  it('MG-13 Weapon 库存与 Build 的其它字段不被 Movement 装备改写（只增不减、不动库存）', () => {
    isolateMigrations();
    const draft0 = defaultPlayerDraft();
    playerInventory(draft0);
    const target = OFFICIAL_MOVEMENTS[0];
    grantMovement(target);
    const inv = invNow(draft0);
    const invBefore = JSON.stringify(inv);
    const buildBefore = JSON.stringify(draft0);

    const out = equipMovement('rear', target, draft0, inv);
    expect(out.ok).toBe(true);

    // 装备是**引用**，不是消耗 ⇒ 库存一个字节都没变
    expect(JSON.stringify(inv)).toBe(invBefore);
    expect(getCount(inv, target, MOVEMENT_STAR)).toBe(1);
    // 装备**不修改入参**（入参照旧 == 只读）
    expect(JSON.stringify(draft0)).toBe(buildBefore);
  });

  it('MG-13b 三段迁移语义不被本维度触碰：drive / functionalStars / Body 全保留', () => {
    isolateMigrations();
    const base = defaultPlayerDraft();
    playerInventory(base);
    const draft0: BuildDraft = {
      ...base,
      functionalSelections: { ...base.functionalSelections },
      drive: 'stationary',
      functionalStars: { [WEAPON_SLOT]: 2 },
    };
    // 先把这份（合法的）Build 落到盘上
    savePlayerBuild(draft0);
    const target = OFFICIAL_MOVEMENTS[0];
    grantMovement(target);

    const out = equipMovement('rear', target, draft0, invNow(draft0));
    expect(out.ok).toBe(true);
    const next = out.draft as BuildDraft;

    expect(next.drive).toBe('stationary');
    expect(next.functionalStars).toEqual({ [WEAPON_SLOT]: 2 });
    expect(next.bodyDefId).toBe(draft0.bodyDefId);
    expect(next.functionalSelections).toEqual(draft0.functionalSelections);
  });
});

// ============================================================================
describe('PRODUCT-LOOP-R3-MOVEMENT-GARAGE-EQUIP｜H. 源码守卫（边界与冻结项）', () => {
  it('MG-14 唯一落盘点未被破坏：`savePlayerBuild(` 在 playerLoadout.ts 仍然只出现一次', () => {
    const code = strip(readProduct('playerLoadout.ts'));
    expect(code.split('savePlayerBuild(').length - 1).toBe(1);
    // 新写入口必须走它，而不是自己碰存储
    expect(code.includes('localStorage')).toBe(false);
  });

  it('MG-15 Movement 的**唯一写入口**在同一文件（页面不得自己写 rear/front 字段）', () => {
    const page = strip(readProduct('homePage.ts'));
    // 页面只能经 `equipMovement(` 写 Movement，不得直接赋值 draft.rearWheelDefId / frontWheelDefId
    expect(page.includes('equipMovement(')).toBe(true);
    for (const banned of ['rearWheelDefId =', 'frontWheelDefId =', 'rearWheelDefId:', 'frontWheelDefId:']) {
      expect(page.includes(banned), `homePage.ts 不得直接写 ${banned}`).toBe(false);
    }
  });

  it('MG-15b 不新增 Movement 内容 / 不改数值：装备前后 registry.movements 逐件相同', () => {
    isolateMigrations();
    const numericOf = (): string =>
      JSON.stringify(
        [...registry.movements.values()].map((m) => ({
          id: m.id,
          radius: m.radius,
          mass: m.mass,
          energy: m.energy,
          grip: m.grip,
          maxRPM: m.maxRPM,
          kind: m.kind,
        })),
      );
    const before = numericOf();

    const draft0 = defaultPlayerDraft();
    playerInventory(draft0);
    const target = OFFICIAL_MOVEMENTS[0];
    grantMovement(target);
    const inv = invNow(draft0);
    equipMovement('rear', target, draft0, inv);
    equipMovement('front', EMPTY_SLOT, draft0, inv);

    expect(numericOf()).toBe(before);
  });

  it('MG-16 产品层不引用 Battle / Camera / Physics / Run 实现（冻结面零扩权）', () => {
    for (const f of ['playerLoadout.ts', 'movementInventory.ts', 'homePage.ts']) {
      const code = strip(readProduct(f));
      for (const banned of [
        'planckBattleOrchestrator',
        'runBattleRuntime',
        'runPage',
        'contactRouter',
        'playerGameRuntime',
        'renderer',
        'planck',
      ]) {
        expect(code.includes(banned), `${f} 不得引用 ${banned}`).toBe(false);
      }
    }
  });

  it('MG-17 产品默认车本身合法（夹具前提）：`makeStarterDraft` 的形状未被本队列改动', () => {
    isolateMigrations();
    const starter = makeStarterDraft('watermelonBody', registry);
    expect(starter.rearWheelDefId).toBeUndefined();
    expect(starter.frontWheelDefId).toBeUndefined();
    expect(validateSnapshot(buildSnapshotFromDraft(starter, registry), registry).valid).toBe(true);
  });
});

/** 当前 Build 上 Weapon 槽的读数（供「Movement 不影响 Weapon」的对照）。 */
function loadoutWeapon(draft: BuildDraft): { defId: string; star: number } {
  return {
    defId: draft.functionalSelections[WEAPON_SLOT] ?? EMPTY_SLOT,
    star: draft.functionalStars?.[WEAPON_SLOT] ?? 1,
  };
}
