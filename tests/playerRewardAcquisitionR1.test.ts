/**
 * F-CONTENT-REWARD-ACQUISITION-R1｜正式奖励获取链验收 T1-T22。
 *
 * 目标：把 4 个新车身（durian/pear/mango/orangeBody）与 3 个新轮组
 * （small/large/heavyWheel）接入正式单次奖励选择链，使玩家无需 debug 也可
 * 在正常核心循环中获得、保存并装备。只扩展现有奖励候选类型，不增加奖励次数、
 * 不重做经济、不调整战斗数值。
 *
 * 覆盖（对应用户 Queue 严格测试 T1-T22）：
 *  T1   typed 候选包含 functional/movement/body 三类；
 *  T2   四个未拥有车身都可通过正式奖励选中并解锁；
 *  T3   已拥有车身从候选池移除；
 *  T4   四个车身全拥有后自动移除 + 安全 fallback（不发空车身奖励）；
 *  T5   三个新轮组可被选中并库存 +1（复用 PartInventory，可累计）；
 *  T6   functional 既有奖励行为不变（computeReward kind=functional，可重复累计）；
 *  T7   同一 seed 与玩家状态 → 同一奖励（确定性随机源）；
 *  T8   不同 seed 采样能覆盖三类奖励；
 *  T9   body reward 显示「已解锁」（kind=body/countAfter=1）并立即可装备；
 *  T10  movement reward 显示 x1（kind=movement/countAfter≥1）并立即可装备；
 *  T11  同一 Result 重复结算只发一次（settler 幂等键）；
 *  T12  连点「下一场」不重复发奖（runtime 层）；
 *  T13  hide/show（同一 Result 重复轮询）不重复发奖；
 *  T14  新 session 可再次获得一份奖励；
 *  T15  彻底重启后 bodyOwnership 与 PartInventory 保持（写入即落盘）；
 *  T16  旧存档（无 bodyOwnership / 无 PartInventory key）安全 fallback；
 *  T17  Loss→奖励→调整配置→装备新车身→完成并再战，BattleSnapshot 使用新车身；
 *  T18  Win→奖励→下一场不经过 Garage，奖励只增加一次；
 *  T19  49 套对手池不变（数量 + 模板仍全 wheelStd）；
 *  T20  8 车身 / 4 轮组 / functional 正式目录不被意外修改；
 *  T21  debug grant 与正式奖励互不覆盖（累加非重置）；
 *  T22  Home 宝箱无伪开启入口（候选池无第四类 + UI 仍为占位）。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  OFFICIAL_PARTS,
  OFFICIAL_MOVEMENTS,
  computeReward,
  computeTypedReward,
  buildRewardCandidates,
  BattleRewardSettler,
  getCount,
  getInventory,
  loadInventoryRaw,
  canEquipMovement,
} from '../src/core/partInventory';
import {
  OFFICIAL_BODIES,
  DEFAULT_OWNED_BODIES,
  NEW_OFFICIAL_BODIES,
  isBodyOwned,
  canEquipBody,
  grantBody,
  grantAllNewBodies,
  loadOwnedBodies,
} from '../src/core/bodyOwnership';
import { grantAllPartsOnce } from '../src/core/debugGrants';
import { OPPONENT_POOL, OPPONENT_TEMPLATES } from '../src/player/opponentPool';
import { registry } from '../src/core/content';
import { buildSnapshotFromDraft } from '../src/lab/buildEditorModel';
import type { BuildSnapshot } from '../src/core/types';
import type { BattleOrchestratorApi, BattleConfig } from '../src/battle/battleContract';
import { bindPlatformCore } from '../src/platform/context';
import { createWechatCore } from '../src/platform/wechat';
import { PlayerGameRuntime } from '../src/game/playerGameRuntime';
import type { PlayerBattleHost } from '../src/game/playerGameRuntime';
import type { PlayerUIHost, PlayerUIState, PlayerUIActions } from '../src/ui/playerUI';

/* ---------------- 装配 helper（复用 playerMovementPackR1 语义） ---------------- */

/** wx 垫片 + PlatformCore 绑定；返回内存 store（重启持久化 / 旧档场景可观察） */
function bindStore(): Map<string, unknown> {
  const store = new Map<string, unknown>();
  (globalThis as { wx?: unknown }).wx = {
    getSystemInfoSync: () => ({ pixelRatio: 2 }),
    getStorageSync: (k: string) => (store.has(k) ? store.get(k) : null),
    setStorageSync: (k: string, v: unknown) => void store.set(k, v),
    removeStorageSync: (k: string) => void store.delete(k),
  };
  bindPlatformCore(createWechatCore(2));
  return store;
}

/** 构造使 computeTypedReward 命中指定 defId 的 rng（基于当前候选池动态索引） */
function rngFor(defId: string): () => number {
  const pool = buildRewardCandidates();
  const idx = pool.findIndex((c) => c.defId === defId);
  return () => idx / pool.length;
}

class ScriptedBattleHost implements PlayerBattleHost {
  orchestrator: BattleOrchestratorApi | null = null;
  previewMode = false;
  loadCustomCalls: Array<{ a: BuildSnapshot; b: BuildSnapshot }> = [];
  clearFxCalls = 0;
  private idx = 0;
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
  loadCustomPreview(): void { this.previewMode = true; }
  loadCustom(a: BuildSnapshot, b: BuildSnapshot): void {
    this.previewMode = false;
    this.loadCustomCalls.push({ a, b });
    this.fakeOrch = this.makeOrch();
    this.orchestrator = this.fakeOrch;
  }
  step(): void {
    if (this.idx < 1) this.idx++;
    (this.fakeOrch as { phase: string }).phase = 'End';
  }
  render(): void {}
  setPreviewVehicleFx(): void {}
  arenaDims(): { w: number; h: number } { return { w: 1600, h: 900 }; }
  reframe(): void {}
  resize(): void {}
  clearBattleFx(): void { this.clearFxCalls++; }
  getMatchVehicleRects(): null { return null; }
  getHomeVehicleRect(): null { return null; }
}

class RecSfx {
  stops = 0;
  starts: string[] = [];
  resume(): void {}
  stopBattleAudio(): void { this.stops++; }
  startBattleAudio(sid: string): void { this.starts.push(sid); }
  play(): void {}
}

class FakeHost implements PlayerUIHost {
  actions: PlayerUIActions | null = null;
  lastState: PlayerUIState | null = null;
  setActions(a: PlayerUIActions): void { this.actions = a; }
  mount(): void {}
  render(s: PlayerUIState): void { this.lastState = s; }
  renderBattleFrame(): void {}
}

/** runtime 完整驱动到 Result 结算（mock Math.random：0.42 对手抽取 → settleRng 命中奖励） */
function driveToEnd(
  runtime: PlayerGameRuntime,
  host: FakeHost,
  settleRng: number,
): void {
  const spy = vi.spyOn(Math, 'random');
  spy.mockReturnValue(0.42); // 对手抽取（固定，战斗可结束）
  host.actions!.onFindOpponent();
  vi.advanceTimersByTime(1500);
  host.actions!.onStartBattle();
  vi.advanceTimersByTime(700);
  spy.mockReturnValue(settleRng); // 之后 Math.random 只被 reward settle 消费
  let now = 0;
  for (let i = 0; i < 3; i++) {
    now += 16.7;
    runtime.tick(now);
  }
}

/* ---------------- T1｜typed 候选三类 ---------------- */
describe('T1｜typed reward candidate 包含 functional/movement/body', () => {
  afterEach(() => {
    bindPlatformCore(undefined as never);
    delete (globalThis as { wx?: unknown }).wx;
  });
  it('候选池三类齐全且与正式目录一一对应', () => {
    bindStore();
    const pool = buildRewardCandidates();
    const kinds = new Set(pool.map((c) => c.kind));
    expect(kinds.has('functional')).toBe(true);
    expect(kinds.has('movement')).toBe(true);
    expect(kinds.has('body')).toBe(true);
    expect(
      pool.filter((c) => c.kind === 'functional').map((c) => c.defId).sort(),
    ).toEqual([...OFFICIAL_PARTS].sort());
    expect(
      pool.filter((c) => c.kind === 'movement').map((c) => c.defId).sort(),
    ).toEqual([...OFFICIAL_MOVEMENTS].sort());
    expect(
      pool.filter((c) => c.kind === 'body').map((c) => c.defId).sort(),
    ).toEqual([...NEW_OFFICIAL_BODIES].sort());
  });
});

/* ---------------- T2｜四个未拥有车身均可被选中 ---------------- */
describe('T2｜四个未拥有车身都可通过正式奖励选中', () => {
  afterEach(() => {
    bindPlatformCore(undefined as never);
    delete (globalThis as { wx?: unknown }).wx;
  });
  it('每个 NEW_OFFICIAL_BODIES 都能被 settle 选中并解锁（countAfter=1，立即可装备）', () => {
    bindStore();
    const settler = new BattleRewardSettler();
    for (const b of NEW_OFFICIAL_BODIES) {
      const pool = buildRewardCandidates();
      const idx = pool.findIndex((c) => c.defId === b);
      expect(idx, `${b} 未拥有时应入池`).toBeGreaterThanOrEqual(0);
      const res = settler.settle({ b }, () => idx / pool.length)!;
      expect(res.kind).toBe('body');
      expect(res.defId).toBe(b);
      expect(res.countAfter).toBe(1); // 拥有即解锁（无 x1 概念）
      expect(isBodyOwned(b)).toBe(true);
      expect(canEquipBody(b)).toBe(true); // 立即可装备
    }
  });
});

/* ---------------- T3｜已拥有车身从池移除 ---------------- */
describe('T3｜已拥有车身从候选池移除', () => {
  afterEach(() => {
    bindPlatformCore(undefined as never);
    delete (globalThis as { wx?: unknown }).wx;
  });
  it('grantBody 后该车身不再出现在候选池', () => {
    bindStore();
    grantBody('durianBody');
    const pool = buildRewardCandidates();
    expect(pool.find((c) => c.defId === 'durianBody')).toBeUndefined();
    expect(pool.filter((c) => c.kind === 'body')).toHaveLength(3);
  });
});

/* ---------------- T4｜全拥有后安全 fallback ---------------- */
describe('T4｜四个车身全拥有后自动移除 + 安全 fallback', () => {
  afterEach(() => {
    bindPlatformCore(undefined as never);
    delete (globalThis as { wx?: unknown }).wx;
  });
  it('grantAllNewBodies 后池无 body；settle 不发空车身奖励、不报错', () => {
    bindStore();
    grantAllNewBodies();
    const pool = buildRewardCandidates();
    expect(pool.filter((c) => c.kind === 'body')).toHaveLength(0);
    const settler = new BattleRewardSettler();
    for (let i = 0; i < 10; i++) {
      const res = settler.settle({ f: i }, () => i / 20)!;
      expect(['functional', 'movement']).toContain(res.kind);
    }
  });
});

/* ---------------- T5｜新轮组可被选中并库存 +1 ---------------- */
describe('T5｜三个新轮组可被正式奖励选中并库存 +1', () => {
  afterEach(() => {
    bindPlatformCore(undefined as never);
    delete (globalThis as { wx?: unknown }).wx;
  });
  it('small/large/heavyWheel 均可 settle 命中并 PartInventory +1（可累计）', () => {
    bindStore();
    const settler = new BattleRewardSettler();
    for (const m of OFFICIAL_MOVEMENTS) {
      const before = getCount(getInventory(), m, 1);
      const res = settler.settle({ m }, rngFor(m))!;
      expect(res.kind).toBe('movement');
      expect(res.defId).toBe(m);
      expect(getCount(getInventory(), m, 1)).toBe(before + 1);
      expect(canEquipMovement(m)).toBe(true); // 立即可装备
    }
  });
});

/* ---------------- T6｜functional 既有行为不变 ---------------- */
describe('T6｜functional 既有奖励行为不变', () => {
  afterEach(() => {
    bindPlatformCore(undefined as never);
    delete (globalThis as { wx?: unknown }).wx;
  });
  it('computeReward 仍只发正式 functional（kind=functional/star=1），不含 EMPTY/HOLD', () => {
    for (let i = 0; i < 50; i++) {
      const r = computeReward(() => i / 50);
      expect(r.kind).toBe('functional');
      expect(OFFICIAL_PARTS).toContain(r.defId);
      expect(r.star).toBe(1);
    }
  });
  it('settle 命中 functional → 库存 +1（可重复累计，非覆盖）', () => {
    bindStore();
    const settler = new BattleRewardSettler();
    const before = getCount(getInventory(), 'cannon', 1);
    const res = settler.settle({ c: 1 }, rngFor('cannon'))!;
    expect(res.kind).toBe('functional');
    expect(res.defId).toBe('cannon');
    expect(getCount(getInventory(), 'cannon', 1)).toBe(before + 1);
  });
});

/* ---------------- T7｜同 seed 确定性 ---------------- */
describe('T7｜同一 seed 与玩家状态得到同一奖励', () => {
  afterEach(() => {
    bindPlatformCore(undefined as never);
    delete (globalThis as { wx?: unknown }).wx;
  });
  it('computeTypedReward 同 rng 两次结果一致；不同 settler 同 rng 同状态选中同一奖励（kind/defId 一致）', () => {
    bindStore();
    expect(computeTypedReward(() => 0.5)).toEqual(computeTypedReward(() => 0.5));
    const s1 = new BattleRewardSettler();
    const s2 = new BattleRewardSettler();
    const r1 = s1.settle({ a: 1 }, () => 0.5)!;
    const r2 = s2.settle({ b: 2 }, () => 0.5)!;
    // 注意：countAfter 会因第二次 settle 真实累计 +1（正常行为），确定性只约束选中结果
    expect(r1.kind).toBe(r2.kind);
    expect(r1.defId).toBe(r2.defId);
    expect(r1.star).toBe(r2.star);
  });
});

/* ---------------- T8｜不同 seed 覆盖三类 ---------------- */
describe('T8｜不同 seed 样本能覆盖三类奖励', () => {
  afterEach(() => {
    bindPlatformCore(undefined as never);
    delete (globalThis as { wx?: unknown }).wx;
  });
  it('初始池 18 项采样覆盖 functional/movement/body', () => {
    bindStore();
    const kinds = new Set<string>();
    for (let i = 0; i < 18; i++) {
      const r = computeTypedReward(() => i / 18);
      kinds.add(r.kind);
      expect(['functional', 'movement', 'body']).toContain(r.kind);
    }
    expect(kinds.has('functional')).toBe(true);
    expect(kinds.has('movement')).toBe(true);
    expect(kinds.has('body')).toBe(true);
  });
});

/* ---------------- T11｜同 Result 只结算一次（纯层） ---------------- */
describe('T11｜同一 Result 重复结算只发一次', () => {
  afterEach(() => {
    bindPlatformCore(undefined as never);
    delete (globalThis as { wx?: unknown }).wx;
  });
  it('同 ref 多次 settle 返回同一缓存，库存/拥有不重复增加', () => {
    bindStore();
    const settler = new BattleRewardSettler();
    const ref = { arena: 'x' };
    const r1 = settler.settle(ref, () => 0.5)!;
    const r2 = settler.settle(ref, () => 0.5)!;
    expect(r2).toBe(r1);
    if (r1.kind === 'body') {
      expect(loadOwnedBodies()).toHaveLength(1);
    } else {
      expect(getCount(loadInventoryRaw()!, r1.defId, 1)).toBe(r1.countAfter);
    }
  });
});

/* ---------------- T14｜新 session 可再发一份 ---------------- */
describe('T14｜新 session 可再次获得一份奖励', () => {
  afterEach(() => {
    bindPlatformCore(undefined as never);
    delete (globalThis as { wx?: unknown }).wx;
  });
  it('新 ref 结算再发一份（不重复、不覆盖）', () => {
    bindStore();
    const settler = new BattleRewardSettler();
    const r1 = settler.settle({ s: 1 }, () => 0.5)!;
    const r2 = settler.settle({ s: 2 }, () => 0.5)!;
    if (r1.kind === 'body') {
      expect(loadOwnedBodies()).toHaveLength(1); // body 解锁一次即可
    } else {
      expect(r2.countAfter).toBe(r1.countAfter + 1); // functional/movement 累计 +1
    }
  });
});

/* ---------------- T15｜重启持久化 ---------------- */
describe('T15｜彻底重启后 bodyOwnership 与 PartInventory 保持', () => {
  afterEach(() => {
    bindPlatformCore(undefined as never);
    delete (globalThis as { wx?: unknown }).wx;
  });
  it('写入即落盘：重读 storage 后车身已解锁、轮组 count 保持', () => {
    bindStore();
    const settler = new BattleRewardSettler();
    settler.settle({ s: 1 }, rngFor('durianBody'));
    const pool2 = buildRewardCandidates(); // durian 已拥有 → 池 17 项
    const mi = pool2.findIndex((c) => c.defId === 'smallWheel');
    settler.settle({ s: 2 }, () => mi / pool2.length);
    // 重启 = 新实例重读同一 storage
    expect(loadOwnedBodies()).toContain('durianBody');
    expect(isBodyOwned('durianBody')).toBe(true);
    expect(getCount(loadInventoryRaw()!, 'smallWheel', 1)).toBe(1);
  });
});

/* ---------------- T16｜旧存档 fallback ---------------- */
describe('T16｜旧存档安全 fallback', () => {
  afterEach(() => {
    bindPlatformCore(undefined as never);
    delete (globalThis as { wx?: unknown }).wx;
  });
  it('无 bodyOwnership → 新车身未拥有可入池；无 PartInventory → default starter；settle 不抛错', () => {
    bindStore(); // 空 store = 旧档无任何 key
    expect(loadOwnedBodies()).toEqual([]);
    expect(isBodyOwned('durianBody')).toBe(false);
    const pool = buildRewardCandidates();
    expect(pool.some((c) => c.kind === 'body')).toBe(true);
    const inv = getInventory();
    expect(getCount(inv, 'cannon', 1)).toBe(1); // starter 副本
    const settler = new BattleRewardSettler();
    const res = settler.settle({ f: 1 }, () => 0)!;
    expect(['functional', 'movement', 'body']).toContain(res.kind);
  });
});

/* ---------------- T9｜body reward 显示与可装备（runtime 层） ---------------- */
describe('T9｜body reward 显示「已解锁」并立即可装备', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    bindPlatformCore(undefined as never);
    delete (globalThis as { wx?: unknown }).wx;
  });
  it('runtime Result：kind=body、cat=车身、countAfter=1、canEquipBody=true', () => {
    bindStore();
    vi.useFakeTimers();
    const host = new FakeHost();
    const battle = new ScriptedBattleHost('win');
    const runtime = new PlayerGameRuntime({ host, battle, sfx: new RecSfx() } as never);
    runtime.init();
    driveToEnd(runtime, host, 0.8); // 0.8*18=14.4 → 14 = durianBody（初始池 18 项）
    expect(host.lastState!.battleState).toBe('ended');
    const rw = host.lastState!.reward;
    expect(rw).not.toBeNull();
    expect(rw!.kind).toBe('body');
    expect(rw!.cat).toBe('车身');
    expect(rw!.name).toBe('榴莲车身');
    expect(rw!.countAfter).toBe(1); // 「已解锁」语义
    expect(canEquipBody('durianBody')).toBe(true);
  });
});

/* ---------------- T10｜movement reward 显示与可装备（runtime 层） ---------------- */
describe('T10｜movement reward 显示 x1 并立即可装备', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    bindPlatformCore(undefined as never);
    delete (globalThis as { wx?: unknown }).wx;
  });
  it('runtime Result：kind=movement、cat=移动、countAfter=1、canEquipMovement=true', () => {
    bindStore();
    vi.useFakeTimers();
    const host = new FakeHost();
    const battle = new ScriptedBattleHost('win');
    const runtime = new PlayerGameRuntime({ host, battle, sfx: new RecSfx() } as never);
    runtime.init();
    driveToEnd(runtime, host, 0.75); // 0.75*18=13.5 → 13 = heavyWheel
    expect(host.lastState!.battleState).toBe('ended');
    const rw = host.lastState!.reward;
    expect(rw).not.toBeNull();
    expect(rw!.kind).toBe('movement');
    expect(rw!.cat).toBe('移动');
    expect(rw!.countAfter).toBe(1);
    expect(canEquipMovement('heavyWheel')).toBe(true);
  });
});

/* ---------------- T12｜连点 CTA 不重复发奖（runtime 层） ---------------- */
describe('T12｜连点「下一场/调整配置」不重复发奖', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    bindPlatformCore(undefined as never);
    delete (globalThis as { wx?: unknown }).wx;
  });
  it('ended 后连点 onResultNext 两次：同场 body 只解锁一次，不重复发奖', async () => {
    bindStore();
    vi.useFakeTimers();
    const host = new FakeHost();
    const battle = new ScriptedBattleHost('win');
    const runtime = new PlayerGameRuntime({ host, battle, sfx: new RecSfx() } as never);
    runtime.init();
    driveToEnd(runtime, host, 0.8); // durianBody
    expect(host.lastState!.battleState).toBe('ended');
    const ownedOnce = loadOwnedBodies();
    expect(ownedOnce).toContain('durianBody');
    // 连点「下一场」（nextMatchInFlight 防重入 + settler 幂等双保险）
    host.actions!.onResultNext();
    host.actions!.onResultNext();
    await vi.advanceTimersByTimeAsync(600);
    expect(loadOwnedBodies()).toEqual(ownedOnce); // 不重复发奖
  });
});

/* ---------------- T13｜hide/show（重复轮询）不重复发奖 ---------------- */
describe('T13｜hide/show 后不重复发奖', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    bindPlatformCore(undefined as never);
    delete (globalThis as { wx?: unknown }).wx;
  });
  it('同一 Result 重复 render/tick（等价 hide/show 后返回 Result 轮询）：reward 缓存一致、拥有不增', () => {
    bindStore();
    vi.useFakeTimers();
    const host = new FakeHost();
    const battle = new ScriptedBattleHost('win');
    const runtime = new PlayerGameRuntime({ host, battle, sfx: new RecSfx() } as never);
    runtime.init();
    driveToEnd(runtime, host, 0.8); // durianBody
    const owned = loadOwnedBodies();
    const rw1 = host.lastState!.reward;
    // 前后台切换后返回 Result：同一 result 引用，重复轮询不重发
    let now = 5000;
    for (let i = 0; i < 8; i++) {
      now += 16.7;
      runtime.tick(now);
    }
    expect(host.lastState!.reward).toBe(rw1); // 同一缓存
    expect(loadOwnedBodies()).toEqual(owned); // 不重复发奖
  });
});

/* ---------------- T17｜Loss→奖励→调整配置→装备新车身→再战 ---------------- */
describe('T17｜Loss→奖励→调整配置→装备新内容→完成并再战', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    bindPlatformCore(undefined as never);
    delete (globalThis as { wx?: unknown }).wx;
  });
  it('Loss 奖励 durianBody → garage 装备 → 再战 loadCustom 玩家快照 bodyDefId=durianBody', () => {
    bindStore();
    vi.useFakeTimers();
    const host = new FakeHost();
    const battle = new ScriptedBattleHost('loss');
    const runtime = new PlayerGameRuntime({ host, battle, sfx: new RecSfx() } as never);
    runtime.init();
    const playerBody0 = host.lastState!.draft!.bodyDefId;
    driveToEnd(runtime, host, 0.8); // durianBody 奖励
    expect(host.lastState!.battleState).toBe('ended');
    expect(host.lastState!.reward!.kind).toBe('body');
    expect(canEquipBody('durianBody')).toBe(true);
    // Loss → 调整配置 → garage（玩家配置保持）
    host.actions!.onResultAdjust();
    expect(host.lastState!.playerPhase).toBe('garage');
    expect(host.lastState!.draft!.bodyDefId).toBe(playerBody0);
    // 换车身：body 槽 → durianBody
    host.actions!.selectGarageSlot!('body');
    host.actions!.onPickGarageOption('durianBody');
    expect(host.lastState!.draft!.bodyDefId).toBe('durianBody');
    // 完成并再战
    host.actions!.onFindOpponent();
    vi.advanceTimersByTime(1500);
    host.actions!.onStartBattle();
    vi.advanceTimersByTime(700);
    const call = battle.loadCustomCalls[battle.loadCustomCalls.length - 1]!;
    expect(call.a.bodyDefId, '再战玩家快照应为 durianBody').toBe('durianBody');
  });
});

/* ---------------- T18｜Win→奖励→下一场不经过 Garage ---------------- */
describe('T18｜Win→奖励→下一场不经过 Garage，奖励只增加一次', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    bindPlatformCore(undefined as never);
    delete (globalThis as { wx?: unknown }).wx;
  });
  it('Win 后 onResultNext 直接进入 matching（不经 garage），同场奖励只一次', async () => {
    bindStore();
    vi.useFakeTimers();
    const host = new FakeHost();
    const battle = new ScriptedBattleHost('win');
    const runtime = new PlayerGameRuntime({ host, battle, sfx: new RecSfx() } as never);
    runtime.init();
    driveToEnd(runtime, host, 0.8); // durianBody
    expect(host.lastState!.reward!.kind).toBe('body');
    const ownedOnce = loadOwnedBodies();
    // 下一场（不经过 Garage）
    host.actions!.onResultNext();
    await vi.advanceTimersByTimeAsync(600);
    expect(host.lastState!.playerPhase).toBe('matching');
    expect(loadOwnedBodies()).toEqual(ownedOnce); // 奖励只增加一次
  });
});

/* ---------------- T19｜49 套对手池不变 ---------------- */
describe('T19｜49 套对手池不变', () => {
  it('OPPONENT_POOL/TEMPLATES 数量 49；模板快照 movements 全 wheelStd', () => {
    expect(OPPONENT_POOL.length).toBe(49);
    expect(OPPONENT_TEMPLATES.length).toBe(49);
    for (const t of OPPONENT_TEMPLATES) {
      const snap = buildSnapshotFromDraft(t.draft, registry, `t-${t.id}`);
      for (const m of snap.movements) {
        expect(m.defId, `模板 ${t.id} 轮组不应引用新轮组`).toBe('wheelStd');
      }
      expect(snap.bodyDefId.length).toBeGreaterThan(0);
    }
  });
});

/* ---------------- T20｜正式目录不被意外修改 ---------------- */
describe('T20｜8 车身 / 4 轮组 / functional 目录不变', () => {
  it('OFFICIAL_BODIES=8、OFFICIAL_MOVEMENTS=3、OFFICIAL_PARTS=11 且与 registry 一致', () => {
    expect(OFFICIAL_BODIES).toHaveLength(8);
    expect(DEFAULT_OWNED_BODIES).toHaveLength(4);
    expect(NEW_OFFICIAL_BODIES).toHaveLength(4);
    expect(OFFICIAL_MOVEMENTS).toHaveLength(3);
    expect(registry.movements.size).toBe(4);
    expect(OFFICIAL_PARTS).toHaveLength(11);
    for (const p of OFFICIAL_PARTS) {
      expect(registry.functionals.has(p), `functional ${p} 应在 registry`).toBe(true);
    }
    for (const b of OFFICIAL_BODIES) {
      expect(registry.bodies.has(b), `body ${b} 应在 registry`).toBe(true);
    }
  });
});

/* ---------------- T21｜debug grant 与正式奖励互不覆盖 ---------------- */
describe('T21｜debug grant 与正式奖励互不覆盖', () => {
  afterEach(() => {
    bindPlatformCore(undefined as never);
    delete (globalThis as { wx?: unknown }).wx;
  });
  it('grantAllPartsOnce 后正式奖励再命中 → 累加非重置（functional 与 movement 均验证）', () => {
    bindStore();
    grantAllPartsOnce(); // functional 各 +1 + 4 车身 + 3 轮组
    const settler = new BattleRewardSettler();
    const pool = buildRewardCandidates(); // body 全拥有 → 池 14 项
    const cannonBefore = getCount(getInventory(), 'cannon', 1);
    const ci = pool.findIndex((c) => c.defId === 'cannon');
    const r1 = settler.settle({ d: 1 }, () => ci / pool.length)!;
    expect(r1.kind).toBe('functional');
    expect(getCount(getInventory(), 'cannon', 1)).toBe(cannonBefore + 1);
    const smallBefore = getCount(getInventory(), 'smallWheel', 1);
    expect(smallBefore).toBeGreaterThanOrEqual(1); // debug 已授予
    const mi = pool.findIndex((c) => c.defId === 'smallWheel');
    settler.settle({ d: 2 }, () => mi / pool.length);
    expect(getCount(getInventory(), 'smallWheel', 1)).toBe(smallBefore + 1);
  });
});

/* ---------------- T22｜Home 宝箱无伪开启入口 ---------------- */
describe('T22｜Home 宝箱无伪开启入口', () => {
  afterEach(() => {
    bindPlatformCore(undefined as never);
    delete (globalThis as { wx?: unknown }).wx;
  });
  it('候选池只含 f/m/b 三类（无宝箱类）；UI 仍为「功能开发中」占位、无真实开启链', () => {
    bindStore();
    const pool = buildRewardCandidates();
    const kinds = new Set(pool.map((c) => c.kind));
    expect(kinds.size).toBe(3);
    const src = readFileSync('src/ui/canvasPlayerUIHost.ts', 'utf8');
    expect(src).toContain('宝箱功能开发中'); // 仍占位
    expect(src).not.toMatch(/chestClaim|claimChest|onChestOpen|chestDrop|openChest/i);
  });
});
