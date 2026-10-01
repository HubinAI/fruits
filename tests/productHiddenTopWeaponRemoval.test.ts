/**
 * PRODUCT-LOOP-P0-HIDDEN-TOP-WEAPON-REMOVAL｜必改 3（Runtime 一致性守卫）+ 验收 1~6。
 *
 * ── 守卫锁定的事实 ─────────────────────────────────────────────────────────
 *   ① 隐藏顶部武器确实存在过、且被 Run 真消费：旧 starter（`makeStarterDraft`）在 `top` 装锤，
 *      `buildSnapshotFromDraft` 会把所有非空 `functionalSelections` 塞进 `Snapshot.functionals`
 *      → 进战斗、贡献伤害（`runCompatibility` 还直接拿它当「已装备武器」）。
 *   ② 本 Queue 的修复：产品默认车（`defaultPlayerDraft`）清空 `top`；旧存档经
 *      `loadEquippedDraft` → `clearHiddenTopWeapon` 一次性清理 `top`；Lab / legacy 的
 *      `makeStarterDraft` 一字未改（验收 6：Lab 不退化）。
 *
 * ── 用例对照 ──────────────────────────────────────────────────────────────
 *   验收 1（新账号 top=EMPTY）        → HT-01 / HT-02 / HT-03
 *   验收 2（老存档 minimal 清理）     → HT-10 / HT-11 / HT-12
 *   验收 3（machineGun 运行时只有 machineGun） → HT-20
 *   验收 4（无隐藏锤伤害贡献）        → HT-20（snapshot.functionals 无 top）
 *   验收 5（cannon 等同理）           → HT-21 / HT-22
 *   验收 6（Lab 不退化）              → HT-30 / HT-31
 *   必改 3（一致性守卫）              → HT-20（Garage Weapon = Draft Weapon = Snapshot Weapon = Runtime Weapon）
 *   判别式健壮性（玩家主动装 top 不动）→ HT-13
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { registry } from '../src/core/content';
import { buildSnapshotFromDraft, EMPTY_SLOT, makeStarterDraft, type BuildDraft } from '../src/lab/buildEditorModel';
import { loadPlayerBuild, savePlayerBuild } from '../src/core/buildPersistence';
import {
  PLAYER_BODY_DEF_ID,
  WEAPON_SLOT,
  clearHiddenTopWeapon,
  defaultPlayerDraft,
  equipWeapon,
  loadEquippedDraft,
  playerInventory,
} from '../src/product/playerLoadout';
import { fullRunCompat } from '../src/product/runCompatibility';

/** 内存版 localStorage（node 无原生；与既有产品测试同一模式）。 */
class MemStorage {
  private m = new Map<string, string>();
  /** `setItem` 调用计数 —— 用来证明「迁移只落盘一次」。 */
  writes = 0;
  getItem(k: string): string | null {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.writes += 1;
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

const BUILD_KEY = 'strongfruit.playerBuild.v1';
let store: MemStorage;

beforeEach(() => {
  store = new MemStorage();
  (globalThis as unknown as { localStorage: MemStorage }).localStorage = store;
});

/* --------------------------------------------------------------- 夹具 */

/** 用 `makeStarterDraft` 起手，再可选覆盖 top / 加 top 星级印记 —— 模拟旧存档形状。 */
function legacyDraft(opts: { top?: string; topStar?: number; front?: string } = {}): BuildDraft {
  const base = makeStarterDraft(PLAYER_BODY_DEF_ID, registry);
  const selections = { ...base.functionalSelections };
  if (opts.top !== undefined) selections.top = opts.top;
  if (opts.front !== undefined) selections.front = opts.front;
  const d: BuildDraft = { ...base, functionalSelections: selections };
  if (opts.topStar !== undefined) d.functionalStars = { top: opts.topStar };
  return d;
}

/** 产品默认车换上指定武器（不改 top，它本就 EMPTY）。 */
function productDraftWithWeapon(weaponDefId: string): BuildDraft {
  const base = defaultPlayerDraft();
  return { ...base, functionalSelections: { ...base.functionalSelections, [WEAPON_SLOT]: weaponDefId } };
}

/* ============================================================================
   A. 新 Product 账号：top=EMPTY（验收 1 / 必改 1）
   ============================================================================ */
describe('PRODUCT-LOOP-P0-HIDDEN-TOP｜A. 新账号 top=EMPTY（验收 1）', () => {
  it('HT-01 新账号默认车：top=EMPTY，且只保留一个可见主武器 frontMass=cannon', () => {
    const d = defaultPlayerDraft();
    expect(d.functionalSelections.top).toBe(EMPTY_SLOT);
    // 可见武器槽仍是 cannon（Garage 显示、玩家可改）
    expect(d.functionalSelections[WEAPON_SLOT]).toBe('cannon');
    // front / rear 功能性槽为空（推杆不挂），Movement 由独立字段承载
    expect(d.functionalSelections.front).toBe(EMPTY_SLOT);
    expect(d.functionalSelections.rear).toBe(EMPTY_SLOT);
  });

  it('HT-02 loadEquippedDraft 无存档直接回退默认车 ⇒ top=EMPTY（且不落盘）', () => {
    const d = loadEquippedDraft();
    expect(d.functionalSelections.top).toBe(EMPTY_SLOT);
    expect(store.getItem(BUILD_KEY)).toBeNull();
  });

  it('HT-03 装备武器后落盘的 Build 仍不携带隐藏 top（equipWeapon 不重新引入）', () => {
    // cannon 是 starter 武器，默认库存一定拥有
    const out = equipWeapon('cannon', defaultPlayerDraft(), playerInventory(defaultPlayerDraft()));
    expect(out.ok).toBe(true);
    const stored = loadPlayerBuild();
    expect(stored?.functionalSelections.top).toBe(EMPTY_SLOT);
    expect(stored?.functionalSelections[WEAPON_SLOT]).toBe('cannon');
  });
});

/* ============================================================================
   B. 老存档：隐藏 top 被最小清理（必改 2 / 验收 2）
   ============================================================================ */
describe('PRODUCT-LOOP-P0-HIDDEN-TOP｜B. 老存档 minimal 清理（必改 2 / 验收 2）', () => {
  it('HT-10 完整 legacy 存档（front=推杆 + top=锤，均无星）⇒ front/top 都清空，其它数据一字不动，落盘一次', () => {
    savePlayerBuild(legacyDraft()); // front=pushRod, top=hammer, 无星
    const before = JSON.parse(store.getItem(BUILD_KEY) as string) as BuildDraft;
    store.writes = 0; // 只统计 loadEquippedDraft 的落盘次数（seed 写入不计入）

    const loaded = loadEquippedDraft();
    // 两个隐藏遗留都被清理
    expect(loaded.functionalSelections.front).toBe(EMPTY_SLOT);
    expect(loaded.functionalSelections.top).toBe(EMPTY_SLOT);
    // 主武器 / 车身 / 其它槽**不动**
    expect(loaded.functionalSelections[WEAPON_SLOT]).toBe('cannon');
    expect(loaded.bodyDefId).toBe(PLAYER_BODY_DEF_ID);
    expect(loaded.functionalSelections.rear).toBe(EMPTY_SLOT);
    // inventory / 进度不碰（本测试没写，只证明确实没动 Build 之外的东西）
    expect(loaded.functionalStars).toBeUndefined();
    // 真落盘了（Home / Run 下次读到的就是清理后的形状）
    expect(loadPlayerBuild()?.functionalSelections.top).toBe(EMPTY_SLOT);
    // 落盘恰好一次（front 迁移 + top 清理同一次 loadEquippedDraft 内完成）
    expect(store.writes).toBe(1);
    // 与入参比对：只有两个槽从 legacy 值变成 EMPTY，其余逐字节相同
    const after = JSON.parse(store.getItem(BUILD_KEY) as string) as BuildDraft;
    expect(after.functionalSelections).not.toEqual(before.functionalSelections);
    expect(after.bodyDefId).toBe(before.bodyDefId);
  });

  it('HT-11 已是「front 已空」的 legacy 存档 ⇒ 只清 top，且仅落盘一次', () => {
    savePlayerBuild(legacyDraft({ front: EMPTY_SLOT })); // 只有 top=hammer 是遗留
    store.writes = 0; // 只统计 loadEquippedDraft 的落盘次数（seed 写入不计入）
    const loaded = loadEquippedDraft();
    expect(loaded.functionalSelections.front).toBe(EMPTY_SLOT);
    expect(loaded.functionalSelections.top).toBe(EMPTY_SLOT);
    expect(store.writes).toBe(1);
    // reload 幂等：签名已不成立 ⇒ 不再写盘
    const reloaded = loadEquippedDraft();
    expect(reloaded.functionalSelections.top).toBe(EMPTY_SLOT);
    expect(store.writes).toBe(1);
  });

  it('HT-12 玩家在旧横屏游戏主动把锤装上 top（带星级印记）⇒ 隐藏武器清理不碰它，原样保留', () => {
    // 让 front 不触发旧 starter 迁移（front 已非推杆），只隔离验证 top 的「玩家选择保护」
    savePlayerBuild(legacyDraft({ front: EMPTY_SLOT, top: 'hammer', topStar: 2 }));
    store.writes = 0; // 只统计 loadEquippedDraft 的落盘次数（seed 写入不计入）
    const raw = store.getItem(BUILD_KEY) as string;
    const loaded = loadEquippedDraft();
    // 有星级印记 = 玩家主动选择 ⇒ 隐藏武器清理一个字节都不改
    expect(loaded.functionalSelections.top).toBe('hammer');
    expect(loaded.functionalStars).toEqual({ top: 2 });
    // 整个 Build 原样保留（front 非 legacy 推杆 ⇒ 不触发 front 迁移；top 有星 ⇒ 不被清理）
    expect(store.getItem(BUILD_KEY)).toBe(raw);
    expect(store.writes).toBe(0);
  });

  it('HT-13 clearHiddenTopWeapon 纯函数：各分支判别式', () => {
    // ① legacy top 无星 ⇒ 清理
    const a = clearHiddenTopWeapon(legacyDraft());
    expect(a.cleaned).toBe(true);
    expect(a.reason).toBe('hidden-top');
    expect(a.draft.functionalSelections.top).toBe(EMPTY_SLOT);
    // ② 有星 ⇒ 玩家选择，不动
    expect(clearHiddenTopWeapon(legacyDraft({ topStar: 2 })).cleaned).toBe(false);
    expect(clearHiddenTopWeapon(legacyDraft({ topStar: 2 })).reason).toBe('player-chosen');
    // ③ 非 legacy top（玩家换成了别的件）⇒ 不动
    expect(clearHiddenTopWeapon(legacyDraft({ top: 'saw' })).cleaned).toBe(false);
    expect(clearHiddenTopWeapon(legacyDraft({ top: 'saw' })).reason).toBe('not-legacy-top');
    // ④ 幂等：再清一次已清过的 ⇒ 不再清理
    const cleaned = clearHiddenTopWeapon(legacyDraft()).draft;
    const second = clearHiddenTopWeapon(cleaned);
    expect(second.cleaned).toBe(false);
    expect(second.reason).toBe('not-legacy-top');
    // ⑤ 其它数据保留：清理只动 top 一个槽
    const base = legacyDraft();
    const out = clearHiddenTopWeapon(base).draft;
    expect(out.functionalSelections[WEAPON_SLOT]).toBe(base.functionalSelections[WEAPON_SLOT]);
    expect(out.bodyDefId).toBe(base.bodyDefId);
    expect(out.functionalSelections.front).toBe(base.functionalSelections.front);
  });
});

/* ============================================================================
   C. Runtime 一致性：Garage Weapon = Draft Weapon = Snapshot Weapon = Runtime Weapon（必改 3）
   ============================================================================ */
describe('PRODUCT-LOOP-P0-HIDDEN-TOP｜C. Runtime 一致性（必改 3 / 验收 3·4·5）', () => {
  it('HT-20 machineGun：Snapshot 的 functionals 只有 machineGun，无 top；Run 识别的武器也只有 machineGun', () => {
    const draft = productDraftWithWeapon('machineGun');
    const snap = buildSnapshotFromDraft(draft, registry);
    // 没有第二个隐藏武器
    expect(snap.functionals.some((f) => f.hardpointId === 'top')).toBe(false);
    expect(snap.functionals.some((f) => f.defId === 'hammer')).toBe(false);
    // Snapshot 里的武器恰好一件 = 玩家在 Garage 装备的那件
    const playerWeapon = draft.functionalSelections[WEAPON_SLOT];
    expect(playerWeapon).toBe('machineGun');
    expect(snap.functionals.length).toBe(1);
    expect(snap.functionals[0].defId).toBe('machineGun');
    // Run 入口把 Snapshot.functionals 当成「已装备武器」—— 验证只识别到 machineGun
    const compat = fullRunCompat(draft);
    expect(compat.equippedWeaponIds.length).toBe(1);
    expect(compat.equippedWeaponIds[0]).toBe('machineGun');
    // 运行时武器来自可见槽位 WEAPON_SLOT，绝不可能是隐藏的 'top'
    expect(snap.functionals[0].hardpointId).toBe(WEAPON_SLOT);
    expect(snap.functionals[0].hardpointId).not.toBe('top');
    expect(compat.baseWeaponDefId).toBe('machineGun');
  });

  it('HT-21 cannon 同理：Snapshot / Run 识别都只有 cannon，无隐藏锤（验收 5）', () => {
    const draft = productDraftWithWeapon('cannon');
    const snap = buildSnapshotFromDraft(draft, registry);
    expect(snap.functionals.some((f) => f.hardpointId === 'top')).toBe(false);
    expect(snap.functionals.length).toBe(1);
    expect(snap.functionals[0].defId).toBe('cannon');
    const compat = fullRunCompat(draft);
    expect(compat.equippedWeaponIds).toEqual(['cannon']);
    expect(compat.baseWeaponDefId).toBe('cannon');
  });

  it('HT-22 旧存档未清理时 top=hammer 确实会进 Snapshot；经本 Queue 清理后 Runtime 只认 machineGun（不认隐藏锤）', () => {
    // 模拟一个「尚未迁移」的 legacy 存档：top=hammer 仍在，但玩家把主武器换成了 machineGun
    const legacy = legacyDraft();
    const draft: BuildDraft = {
      ...legacy,
      functionalSelections: { ...legacy.functionalSelections, [WEAPON_SLOT]: 'machineGun' },
    };
    // 未清理的 dirty 确实含 top=hammer（证明隐藏武器真的会进 Snapshot / 进战斗 —— 正是本 Queue 要修的病灶）
    const dirty = buildSnapshotFromDraft(draft, registry);
    expect(dirty.functionals.some((f) => f.hardpointId === 'top' && f.defId === 'hammer')).toBe(true);
    // 用本 Queue 的隐藏武器清理函数清掉 top ⇒ 隐藏锤被移除
    const cleaned = clearHiddenTopWeapon(draft).draft;
    const snap = buildSnapshotFromDraft(cleaned, registry);
    expect(snap.functionals.some((f) => f.hardpointId === 'top')).toBe(false);
    expect(snap.functionals.some((f) => f.defId === 'hammer')).toBe(false);
    // Run 入口把 Snapshot.functionals 当「已装备武器」并只挑 weapon 类 —— 清理后只识别到 machineGun，不再有隐藏锤
    const compat = fullRunCompat(cleaned);
    expect(compat.equippedWeaponIds).toEqual(['machineGun']);
    expect(compat.baseWeaponDefId).toBe('machineGun');
  });
});

/* ============================================================================
   D. Lab / Validation / legacy fixture 不退化（验收 6）
   ============================================================================ */
describe('PRODUCT-LOOP-P0-HIDDEN-TOP｜D. Lab 不退化（验收 6）', () => {
  it('HT-30 全局 makeStarterDraft 仍带 top=hammer（Lab / Validation / legacy fixture 真源未改）', () => {
    const starter = makeStarterDraft(PLAYER_BODY_DEF_ID, registry);
    expect(starter.functionalSelections.top).toBe('hammer');
    expect(starter.functionalSelections.front).toBe('pushRod');
    expect(starter.functionalSelections[WEAPON_SLOT]).toBe('cannon');
  });

  it('HT-31 旧 starter 的 Snapshot 仍把 top=hammer 当 functional 进战斗（Lab 路径不变）', () => {
    // 证明「隐藏武器被 Run 真消费」这条路径依然存在 —— 只是产品侧不再喂入 top=hammer
    const snap = buildSnapshotFromDraft(makeStarterDraft(PLAYER_BODY_DEF_ID, registry), registry);
    const top = snap.functionals.find((f) => f.hardpointId === 'top');
    expect(top?.defId).toBe('hammer');
    // 对比：产品默认车同一份 Snapshot 必须没有 top
    const product = buildSnapshotFromDraft(defaultPlayerDraft(), registry);
    expect(product.functionals.some((f) => f.hardpointId === 'top')).toBe(false);
  });
});
