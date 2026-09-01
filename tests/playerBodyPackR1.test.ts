/**
 * F-CONTENT-PLAYER-BODY-PACK-R1｜玩家正式车身包验收（T1-T15）。
 *
 * 覆盖：4 新车身 defId 唯一/目录 / BodyDef 与 Build 合法性 / 轮廓包围盒与挂点结构
 * 真实差异 / 数值区间 / Garage 可装备可替换 / 未获得禁装 / 能量超载仍被阻止 /
 * 获得后装备 + 重启存档保持 / 旧存档兼容 / debug 全部件解锁 / 入画链路 /
 * 四分辨率布局不相交 / 战斗至 Result / Loss→调整→换新车身→再战 / 对手池 49 套不变。
 *
 * 冻结项（本文件不触碰）：Physics / 伤害 / 胜负规则 / 对手池模板 / viewport / DPR /
 * safe area / 冷启动（KNOWN-WX-COLD-BOOT-PREVIEW-SCALE-01）。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  DEFAULT_OWNED_BODIES,
  NEW_OFFICIAL_BODIES,
  OFFICIAL_BODIES,
  loadOwnedBodies,
  isBodyOwned,
  canEquipBody,
  grantBody,
  grantAllNewBodies,
} from '../src/core/bodyOwnership';
import { registry } from '../src/core/content';
import { BODY_OPTIONS, encodePartVal } from '../src/ui/playerUI';
import {
  buildSnapshotFromDraft,
  makeStarterDraft,
  EMPTY_SLOT,
} from '../src/lab/buildEditorModel';
import { validateSnapshot } from '../src/core/buildValidator';
import { savePlayerBuild, loadPlayerBuild } from '../src/core/buildPersistence';
import { resetPlayerSave, RESET_KEYS } from '../src/core/saveVersion';
import { grantAllPartsOnce } from '../src/core/debugGrants';
import { saveInventory, getInventory } from '../src/core/partInventory';
import { computeMobileGarageLayout, type Rect } from '../src/ui/mobileGarageLayout';
import { createPlanckBattle } from '../src/battle/battleRequestAdapter';
import type { BattleRequest, BattleOrchestratorApi, BattleConfig } from '../src/battle/battleContract';
import { PHYSICS_HZ } from '../src/physics/units';
import type { BodyDef, BuildSnapshot } from '../src/core/types';
import type { PlayerBattleHost } from '../src/game/playerGameRuntime';
import type { PlayerUIHost, PlayerUIState, PlayerUIActions } from '../src/ui/playerUI';
import { PlayerGameRuntime } from '../src/game/playerGameRuntime';
import { bindPlatformCore } from '../src/platform/context';
import { createWechatCore } from '../src/platform/wechat';
import {
  OPPONENT_POOL,
  OPPONENT_TEMPLATES,
  pickOpponentForTier,
} from '../src/player/opponentPool';

const STEP = 1000 / PHYSICS_HZ;

/** 本 Queue 新增 4 个正式车身（与 content.ts / playerUI.ts / bodyOwnership.ts 同源断言） */
const NEW_BODIES = ['durianBody', 'pearBody', 'mangoBody', 'orangeBody'] as const;

/** Body defId → bodyVisual.visualId（T11 断言） */
const BODY_VISUAL_ID: Record<string, string> = {
  durianBody: 'body_durian',
  pearBody: 'body_pear',
  mangoBody: 'body_mango',
  orangeBody: 'body_orange',
};

/* ---------- 平台 storage mock（与 opponentBuildPoolR1 同模式） ---------- */
function mockWx(store: Map<string, unknown>): void {
  (globalThis as { wx?: unknown }).wx = {
    getSystemInfoSync: () => ({ pixelRatio: 2 }),
    getStorageSync: (k: string) => (store.has(k) ? store.get(k) : null),
    setStorageSync: (k: string, v: unknown) => void store.set(k, v),
    removeStorageSync: (k: string) => void store.delete(k),
  };
  bindPlatformCore(createWechatCore(2));
}

function cleanupPlatform(): void {
  vi.useRealTimers();
  bindPlatformCore(undefined as never);
  delete (globalThis as { wx?: unknown }).wx;
}

/* ---------- Body 几何辅助（T3/T12） ---------- */
/** 合并全部 box collider 的轴对齐包围盒（宽/高；不含轮子） */
function bodyAABB(body: BodyDef): { w: number; h: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const c of body.colliders) {
    if (c.shape !== 'box' || !c.width || !c.height) continue;
    minX = Math.min(minX, c.offset.x - c.width / 2);
    maxX = Math.max(maxX, c.offset.x + c.width / 2);
    minY = Math.min(minY, c.offset.y - c.height / 2);
    maxY = Math.max(maxY, c.offset.y + c.height / 2);
  }
  return { w: maxX - minX, h: maxY - minY };
}

/** 含轮子的完整 envelope（T12：movement 挂点中心 + 最大轮径 26 外伸） */
function bodyEnvelopeWithWheels(body: BodyDef, wheelR = 26): { w: number; h: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const c of body.colliders) {
    if (c.shape !== 'box' || !c.width || !c.height) continue;
    minX = Math.min(minX, c.offset.x - c.width / 2);
    maxX = Math.max(maxX, c.offset.x + c.width / 2);
    minY = Math.min(minY, c.offset.y - c.height / 2);
    maxY = Math.max(maxY, c.offset.y + c.height / 2);
  }
  for (const hp of body.movementHardpoints) {
    minX = Math.min(minX, hp.localPosition.x - wheelR);
    maxX = Math.max(maxX, hp.localPosition.x + wheelR);
    minY = Math.min(minY, hp.localPosition.y - wheelR);
    maxY = Math.max(maxY, hp.localPosition.y + wheelR);
  }
  return { w: maxX - minX, h: maxY - minY };
}

/** 挂点结构 key（functional / movement 坐标序列，含 id） */
function hpKey(hps: ReadonlyArray<{ id: string; localPosition: { x: number; y: number } }>): string {
  return JSON.stringify(hps.map((h) => [h.id, h.localPosition.x, h.localPosition.y]));
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/* ---------- battle / runtime harness（与 opponentBuildPoolR1 同模式） ---------- */
function battleReq(battleId: string, buildA: BuildSnapshot, buildB: BuildSnapshot): BattleRequest {
  return {
    battleId,
    buildA,
    buildB,
    config: {
      autoDrive: true,
      engine: 'planck',
      settleToGround: true,
      randomSeed: 42,
      arena: { phases: { activeMs: STEP * 80, warningMs: STEP * 40, closingMs: STEP * 80 } },
    },
    randomSeed: 42,
    rulesVersion: 'v1.0.0',
    contentVersion: 'c1',
  };
}

function runtimeSetup(store: Map<string, unknown>): {
  runtime: PlayerGameRuntime;
  host: FakeHost;
  battle: ScriptedBattleHost;
} {
  mockWx(store);
  const host = new FakeHost();
  const battle = new ScriptedBattleHost();
  const runtime = new PlayerGameRuntime({ host, battle, sfx: new RecSfx() } as never);
  runtime.init();
  return { runtime, host, battle };
}

describe('T1｜4 新车身 defId 唯一并进入正式目录', () => {
  afterEach(cleanupPlatform);
  it('T1. registry.bodies / BODY_OPTIONS / OFFICIAL_BODIES 均含 4 新车身，8 个正式 defId 无重复', () => {
    for (const id of NEW_BODIES) {
      expect(registry.bodies.has(id)).toBe(true);
      expect(BODY_OPTIONS.some((o) => o.v === id)).toBe(true);
      expect(OFFICIAL_BODIES).toContain(id);
      expect(NEW_OFFICIAL_BODIES).toContain(id);
    }
    expect(BODY_OPTIONS.length).toBe(8); // 玩家可见目录 = 8
    expect(OFFICIAL_BODIES.length).toBe(8);
    expect(new Set(OFFICIAL_BODIES).size).toBe(8);
    // 旧 4 个仍为恒默认拥有（零回归锚点）
    expect(DEFAULT_OWNED_BODIES).toEqual([
      'watermelonBody',
      'bananaBody',
      'pineappleBody',
      'coconutBody',
    ]);
  });
});

describe('T2｜BodyDef 结构与 Build 合法性', () => {
  it('T2. 4 新车身数值为正、标准 4 functional + 2 movement；Starter Build 全部通过 validateSnapshot', () => {
    for (const id of NEW_BODIES) {
      const body = registry.bodies.get(id)!;
      expect(body.hp).toBeGreaterThan(0);
      expect(body.baseMass).toBeGreaterThan(0);
      expect(body.energyCapacity).toBeGreaterThan(0);
      expect(body.functionalHardpoints.length).toBe(4);
      expect(body.movementHardpoints.length).toBe(2);
      const snap = buildSnapshotFromDraft(makeStarterDraft(id, registry), registry, `t2-${id}`);
      const res = validateSnapshot(snap, registry);
      expect(res.valid, `车身 ${id} Starter 非法: ${res.errors.join('; ')}`).toBe(true);
    }
  });
});

describe('T3｜轮廓包围盒与挂点结构真实差异', () => {
  it('T3. 8 个正式车身 collider 合并 AABB 两两不同；4 新车身挂点结构互不相同', () => {
    const aabbSet = new Set<string>();
    for (const id of OFFICIAL_BODIES) {
      const bb = bodyAABB(registry.bodies.get(id)!);
      aabbSet.add(`${bb.w}x${bb.h}`);
    }
    expect(aabbSet.size).toBe(8); // 轮廓包围盒 8 套全不同（无换皮）
    // 4 新车身 functional / movement 挂点结构两两不同（≥3 套结构）
    const fKeys = NEW_BODIES.map((id) => hpKey(registry.bodies.get(id)!.functionalHardpoints));
    const mKeys = NEW_BODIES.map((id) => hpKey(registry.bodies.get(id)!.movementHardpoints));
    expect(new Set(fKeys).size).toBe(4);
    expect(new Set(mKeys).size).toBe(4);
  });
});

describe('T4｜数值位于现有正式区间且非全部相同', () => {
  it('T4. baseMass ∈ [45,160]、energyCapacity ∈ [90,110]，4 新车身质量/能量不全相同', () => {
    for (const id of NEW_BODIES) {
      const body = registry.bodies.get(id)!;
      expect(body.baseMass).toBeGreaterThanOrEqual(45);
      expect(body.baseMass).toBeLessThanOrEqual(160);
      expect(body.energyCapacity).toBeGreaterThanOrEqual(90);
      expect(body.energyCapacity).toBeLessThanOrEqual(110);
    }
    const masses = NEW_BODIES.map((id) => registry.bodies.get(id)!.baseMass);
    const energies = NEW_BODIES.map((id) => registry.bodies.get(id)!.energyCapacity);
    expect(new Set(masses).size).toBeGreaterThan(1);
    expect(new Set(energies).size).toBeGreaterThan(1);
  });
});

describe('T5｜Garage 选择/装备/替换（解锁后）', () => {
  afterEach(cleanupPlatform);
  it('T5. grantAllNewBodies 后 4 新车身均可经 onPickGarageOption 装备并替换', () => {
    const store = new Map<string, unknown>();
    mockWx(store);
    grantAllNewBodies();
    const { host } = runtimeSetup(store);
    for (const id of NEW_BODIES) {
      host.actions!.selectGarageSlot?.('body');
      host.actions!.onPickGarageOption(id);
      expect(host.lastState!.draft!.bodyDefId).toBe(id);
    }
    // 替换回旧车身（零回归）
    host.actions!.selectGarageSlot?.('body');
    host.actions!.onPickGarageOption('watermelonBody');
    expect(host.lastState!.draft!.bodyDefId).toBe('watermelonBody');
  });
});

describe('T6｜未获得的新车身不可装备', () => {
  afterEach(cleanupPlatform);
  it('T6. 默认无授予：canEquipBody(新 4)=false、旧 4=true；runtime 守卫拒绝装备', () => {
    const store = new Map<string, unknown>();
    mockWx(store); // 无任何 grant
    for (const id of NEW_BODIES) expect(canEquipBody(id)).toBe(false);
    for (const id of DEFAULT_OWNED_BODIES) expect(canEquipBody(id)).toBe(true);
    const { host } = runtimeSetup(store);
    const before = host.lastState!.draft!.bodyDefId;
    host.actions!.selectGarageSlot?.('body');
    host.actions!.onPickGarageOption('durianBody');
    expect(host.lastState!.draft!.bodyDefId).toBe(before); // 未改变
  });
});

describe('T7｜能量超载仍被阻止', () => {
  afterEach(cleanupPlatform);
  it('T7. 超载构造 validateSnapshot invalid；runtime 换件超载整体回滚', () => {
    // 1) 4×laser(45)=180 > 105 最大容量 → 超载拒绝
    for (const id of NEW_BODIES) {
      const draft = makeStarterDraft(id, registry);
      draft.functionalSelections.front = 'laser';
      draft.functionalSelections.frontMass = 'laser';
      draft.functionalSelections.top = 'laser';
      draft.functionalSelections.rear = 'laser';
      const snap = buildSnapshotFromDraft(draft, registry, `t7-${id}`);
      const res = validateSnapshot(snap, registry);
      expect(res.valid).toBe(false);
      expect(res.errors.join('; ')).toContain('能量超载');
    }
    // 2) runtime：全部件×1（1★ cannon 可装备）→ 逐槽换 1★ cannon，最后一槽超载回滚
    const store = new Map<string, unknown>();
    mockWx(store);
    grantAllPartsOnce(); // 解锁功能件库存（1★）
    grantAllNewBodies(); // 解锁新车身
    const { host } = runtimeSetup(store);
    host.actions!.selectGarageSlot?.('body');
    host.actions!.onPickGarageOption('durianBody');
    for (const hp of ['front', 'frontMass', 'top']) {
      host.actions!.selectGarageSlot?.(hp);
      host.actions!.onPickGarageOption(encodePartVal('cannon', 1));
    }
    host.actions!.selectGarageSlot?.('rear');
    host.actions!.onPickGarageOption(encodePartVal('cannon', 1));
    const d = host.lastState!.draft!;
    expect(d.functionalSelections.rear).toBe(EMPTY_SLOT); // 超载回滚：未装上
    expect(host.lastState!.overloadDelta).toBeGreaterThan(0); // 差值已显示
    expect(d.bodyDefId).toBe('durianBody'); // 车身本身不被回滚（超载只回滚部件变更）
  });
});

describe('T8｜获得后可装备 + 彻底重启存档保持', () => {
  afterEach(cleanupPlatform);
  it('T8. grantBody 后可装备；新 storage 未拥有、旧 storage 恢复拥有', () => {
    const store = new Map<string, unknown>();
    mockWx(store);
    expect(canEquipBody('mangoBody')).toBe(false);
    expect(grantBody('mangoBody')).toBe(true);
    expect(canEquipBody('mangoBody')).toBe(true);
    // 幂等：重复授予无副作用（集合长度不变）
    const ownedOnce = loadOwnedBodies();
    grantBody('mangoBody');
    expect(loadOwnedBodies()).toEqual(ownedOnce);
    // 彻底重启：全新 storage → 未拥有（默认不赠送）
    const store2 = new Map<string, unknown>();
    mockWx(store2);
    expect(canEquipBody('mangoBody')).toBe(false);
    // 重启 + 存档复制 → 拥有恢复
    for (const [k, v] of store) store2.set(k, v);
    expect(canEquipBody('mangoBody')).toBe(true);
  });
});

describe('T9｜旧版本存档载入不报错不丢数据；新车身存档往返', () => {
  afterEach(cleanupPlatform);
  it('T9. 无 ownedBodies key 的旧存档：Build 读回、旧车身恒可装备、库存不丢；Reset 清理新 key', () => {
    const store = new Map<string, unknown>();
    mockWx(store);
    // 旧存档：仅 build + inventory（刻意无 ownedBodies.v1 key）
    savePlayerBuild(makeStarterDraft('watermelonBody', registry));
    saveInventory({ cannon: { one: 2, two: 1 } } as never);
    expect(store.has('strongfruit.ownedBodies.v1')).toBe(false);
    expect(loadPlayerBuild()?.bodyDefId).toBe('watermelonBody');
    expect(canEquipBody('watermelonBody')).toBe(true); // 无 key 仍恒拥有（零回归）
    expect(getInventory().cannon.one).toBe(2); // 库存不丢
    // 新车身存档往返（KNOWN_BODIES 自动含新 Body）
    savePlayerBuild(makeStarterDraft('durianBody', registry));
    expect(loadPlayerBuild()?.bodyDefId).toBe('durianBody');
    // Reset 清理 ownedBodies.v1
    expect(RESET_KEYS).toContain('strongfruit.ownedBodies.v1');
    resetPlayerSave();
    expect(store.has('strongfruit.ownedBodies.v1')).toBe(false);
  });
});

describe('T10｜debug「全部件×1」解锁 4 新车身', () => {
  afterEach(cleanupPlatform);
  it('T10. grantAllPartsOnce 后 4 新车身已拥有；重复调用幂等', () => {
    const store = new Map<string, unknown>();
    mockWx(store);
    expect(isBodyOwned('durianBody')).toBe(false);
    grantAllPartsOnce();
    for (const id of NEW_BODIES) expect(isBodyOwned(id)).toBe(true);
    const before = loadOwnedBodies().length;
    expect(grantAllNewBodies()).toBe(0); // 全部已拥有 → 0 新增
    expect(loadOwnedBodies().length).toBe(before);
  });
});

describe('T11｜正常链路 4 车身入画（bodyVisual 正确、位置有限）', () => {
  it('T11. createPlanckBattle snapshot 的 vehicleB.bodyVisual.visualId 正确且坐标有限', () => {
    const snapA = buildSnapshotFromDraft(makeStarterDraft('watermelonBody', registry), registry, 'playerA');
    for (const id of NEW_BODIES) {
      const snapB = buildSnapshotFromDraft(makeStarterDraft(id, registry), registry, id);
      const orch = createPlanckBattle(battleReq(`t11-${id}`, snapA, snapB), registry);
      expect(orch.arena.phase).toBe('Active');
      const bv = orch.getRenderSnapshot().vehicleB?.bodyVisual;
      expect(bv?.visualId).toBe(BODY_VISUAL_ID[id]);
      expect(Number.isFinite(bv?.position.x) && Number.isFinite(bv?.position.y)).toBe(true);
      // step 后中心仍有限（无 NaN / 无爆炸）
      for (let i = 0; i < 5; i++) orch.step(STEP);
      const bv2 = orch.getRenderSnapshot().vehicleB?.bodyVisual;
      expect(Number.isFinite(bv2?.position.x) && Number.isFinite(bv2?.position.y)).toBe(true);
      orch.dispose();
    }
  });
});

describe('T12｜四分辨率下车辆包围盒不与顶栏/装配带相交', () => {
  const VIEWPORTS: Array<[number, number]> = [
    [420, 210],
    [621, 351],
    [844, 390],
    [1280, 592],
  ];
  it('T12. vehicleRect 与 topBarRect/stripRect 无相交；含轮完整 envelope 可 fit 进 vehicleRect', () => {
    for (const [w, h] of VIEWPORTS) {
      const L = computeMobileGarageLayout({ w, h }, { left: 0, right: 0, top: 0, bottom: 0 });
      expect(rectsOverlap(L.vehicleRect, L.topBarRect), `${w}x${h} 顶栏相交`).toBe(false);
      expect(rectsOverlap(L.vehicleRect, L.stripRect), `${w}x${h} 装配带相交`).toBe(false);
      expect(L.vehicleRect.w).toBeGreaterThan(0);
      expect(L.vehicleRect.h).toBeGreaterThanOrEqual(1);
      for (const id of NEW_BODIES) {
        const env = bodyEnvelopeWithWheels(registry.bodies.get(id)!);
        const scale = Math.min(L.vehicleRect.w / env.w, L.vehicleRect.h / env.h);
        expect(scale).toBeGreaterThan(0);
        expect(env.w * scale).toBeLessThanOrEqual(L.vehicleRect.w + 1e-6);
        expect(env.h * scale).toBeLessThanOrEqual(L.vehicleRect.h + 1e-6);
      }
    }
  });
});

describe('T13｜4 新车身配合法武器自动战斗至 Result', () => {
  it('T13. 每新车身 createPlanckBattle → Active → 600 步内 Result（winner 合法、hp 有限）', () => {
    const snapA = buildSnapshotFromDraft(makeStarterDraft('watermelonBody', registry), registry, 'playerA');
    for (const id of NEW_BODIES) {
      const snapB = buildSnapshotFromDraft(makeStarterDraft(id, registry), registry, id);
      const orch = createPlanckBattle(battleReq(`t13-${id}`, snapA, snapB), registry);
      let steps = 0;
      while (!orch.result && steps < 600) {
        orch.step(STEP);
        steps++;
      }
      const r = orch.result;
      expect(r, `车身 ${id} ${steps} 步内未结束（死循环）`).not.toBeNull();
      expect(['A', 'B'], `车身 ${id} winner 非法`).toContain(r!.winner);
      expect(Number.isFinite(r!.hpA) && Number.isFinite(r!.hpB), `车身 ${id} hp NaN`).toBe(true);
      expect(r!.phase).toBe('End');
      orch.dispose();
    }
  }, 120000);
});

describe('T14｜Loss→adjust→换新车身→再战闭环', () => {
  afterEach(cleanupPlatform);
  it('T14. 战败后调整配置换榴莲车身，再战 loadCustom 收到新 bodyDefId', () => {
    const store = new Map<string, unknown>();
    mockWx(store);
    grantAllNewBodies();
    const host = new FakeHost();
    const battle = new ScriptedBattleHost('loss');
    const runtime = new PlayerGameRuntime({ host, battle, sfx: new RecSfx() } as never);
    runtime.init();
    vi.useFakeTimers();
    // 第一场（Loss）
    host.actions!.onFindOpponent();
    vi.advanceTimersByTime(1500);
    host.actions!.onStartBattle();
    vi.advanceTimersByTime(700);
    let now = 0;
    for (let i = 0; i < 3; i++) {
      now += 16.7;
      runtime.tick(now);
    }
    expect(host.lastState!.battleState).toBe('ended');
    host.actions!.onResultAdjust();
    expect(host.lastState!.playerPhase).toBe('garage');
    // 换新车身（榴莲）
    host.actions!.selectGarageSlot?.('body');
    host.actions!.onPickGarageOption('durianBody');
    expect(host.lastState!.draft!.bodyDefId).toBe('durianBody');
    // 再战：loadCustom 收到玩家新 build
    host.actions!.onFindOpponent();
    vi.advanceTimersByTime(1500);
    host.actions!.onStartBattle();
    vi.advanceTimersByTime(700);
    const call = battle.loadCustomCalls[battle.loadCustomCalls.length - 1]!;
    expect(call.a.bodyDefId).toBe('durianBody');
  });
});

describe('T15｜49 套对手池不被改动', () => {
  it('T15. OPPONENT_POOL / OPPONENT_TEMPLATES 数量不变（49），选择可正常命中', () => {
    expect(OPPONENT_POOL.length).toBe(49);
    expect(OPPONENT_TEMPLATES.length).toBe(49);
    for (const tier of ['bronze', 'silver', 'gold', 'diamond'] as const) {
      const idx = pickOpponentForTier(tier, 0, () => 0.5);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(49);
    }
  });
});

/* ---------- 轻量 host / ui / sfx（与 opponentBuildPoolR1 同模式） ---------- */
class ScriptedBattleHost implements PlayerBattleHost {
  orchestrator: BattleOrchestratorApi | null = null;
  previewMode = false;
  loadCustomCalls: Array<{ a: BuildSnapshot; b: BuildSnapshot }> = [];
  clearFxCalls = 0;
  private fakeOrch: BattleOrchestratorApi | null = null;
  constructor(private outcome: 'win' | 'loss' = 'win') {
    this.fakeOrch = this.makeOrch();
    this.orchestrator = this.fakeOrch;
  }
  private makeOrch(): BattleOrchestratorApi {
    const o = {
      result: null,
      phase: 'Active',
      timeMs: 0,
      config: { autoDrive: true, arena: { phases: { warningMs: 3000, closingMs: 5000 } } } as BattleConfig,
      getRenderSnapshot: () => ({}) as never,
      getBattleStatusSnapshot: () => null as never,
      step: () => {},
      onCombatEvent: () => () => {},
      dispose: () => {},
    } as unknown as BattleOrchestratorApi;
    (o as { result: unknown }).result = {
      winner: this.outcome === 'loss' ? 'B' : 'A',
      hpA: this.outcome === 'loss' ? 0 : 100,
      hpB: this.outcome === 'loss' ? 100 : 0,
      phase: 'End',
      endReason: 'hp',
    };
    return o;
  }
  loadCustomPreview(): void {
    this.previewMode = true;
  }
  loadCustom(a: BuildSnapshot, b: BuildSnapshot): void {
    this.previewMode = false;
    this.loadCustomCalls.push({ a, b });
    this.fakeOrch = this.makeOrch();
    this.orchestrator = this.fakeOrch;
  }
  step(): void {
    (this.fakeOrch as { phase: string }).phase = 'End';
  }
  render(): void {}
  setPreviewVehicleFx(): void {}
  arenaDims(): { w: number; h: number } {
    return { w: 1600, h: 900 };
  }
  reframe(): void {}
  resize(): void {}
  clearBattleFx(): void {
    this.clearFxCalls++;
  }
  getMatchVehicleRects(): null {
    return null;
  }
  getHomeVehicleRect(): null {
    return null;
  }
}

class RecSfx {
  stops = 0;
  starts: string[] = [];
  resume(): void {}
  stopBattleAudio(): void {
    this.stops++;
  }
  startBattleAudio(sid: string): void {
    this.starts.push(sid);
  }
  play(): void {}
}

class FakeHost implements PlayerUIHost {
  actions: PlayerUIActions | null = null;
  lastState: PlayerUIState | null = null;
  setActions(a: PlayerUIActions): void {
    this.actions = a;
  }
  mount(): void {}
  render(s: PlayerUIState): void {
    this.lastState = s;
  }
  renderBattleFrame(): void {}
}
