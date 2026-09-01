/**
 * F-CONTENT-OPPONENT-BUILD-POOL-R1｜对手 Build 模板池验收（T1-T12）。
 *
 * 覆盖：模板可解析/合法性/武器/ID 唯一/主组合差异/五类定位覆盖/种子可复现/
 * 20 连续种子命中/ orchestrator 进入 Active / 自动战斗至 Result 无 NaN 死循环 /
 * 玩家存档与 Build 不被对手生成修改 / Loss→调整→再战闭环。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  OPPONENT_POOL,
  OPPONENT_TEMPLATES,
  OPPONENT_ROLES,
  ROLE_INDICES,
  pickOpponentForTier,
  type OpponentRole,
} from '../src/player/opponentPool';
import {
  buildSnapshotFromDraft,
  makeStarterDraft,
  type BuildDraft,
} from '../src/lab/buildEditorModel';
import { validateSnapshot } from '../src/core/buildValidator';
import { registry } from '../src/core/content';
import { createPlanckBattle } from '../src/battle/battleRequestAdapter';
import type { BattleRequest, BattleOrchestratorApi, BattleConfig } from '../src/battle/battleContract';
import { PHYSICS_HZ } from '../src/physics/units';
import type { BuildSnapshot } from '../src/core/types';
import type { PlayerBattleHost } from '../src/game/playerGameRuntime';
import type { PlayerUIHost, PlayerUIState, PlayerUIActions } from '../src/ui/playerUI';
import { PlayerGameRuntime } from '../src/game/playerGameRuntime';
import { bindPlatformCore } from '../src/platform/context';
import { createWechatCore } from '../src/platform/wechat';
import { savePlayerBuild, loadPlayerBuild } from '../src/core/buildPersistence';

const STEP = 1000 / PHYSICS_HZ;

/** 确定性 RNG（mulberry32，与既有测试同源） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 主组合 key：body + 轮径对 + weapon defId 集合 + gadget 集合 + drive */
function mainComboKey(d: BuildDraft): string {
  const sels = Object.values(d.functionalSelections).filter((v) => v && v !== 'none');
  const weapons = sels
    .filter((id) => registry.functionals.get(id)?.category === 'weapon')
    .sort()
    .join('+');
  const gadgets = sels
    .filter((id) => registry.functionals.get(id)?.category === 'gadget')
    .sort()
    .join('+');
  return `${d.bodyDefId}|r${d.rearRadius}f${d.frontRadius}|W[${weapons}]|G[${gadgets}]|${d.drive ?? 'forward'}`;
}

const ROLES: OpponentRole[] = ['rush', 'ranged', 'heavy', 'control', 'hybrid'];
/** 每类最小要求（用户 Queue）：rush≥3 / ranged≥3 / heavy≥2 / control≥2 / hybrid≥2 */
const ROLE_MIN: Record<OpponentRole, number> = {
  rush: 3,
  ranged: 3,
  heavy: 2,
  control: 2,
  hybrid: 2,
};

describe('T1｜全部模板可被正式解析', () => {
  it('T1. buildSnapshotFromDraft 对全部 49 套不抛异常且产生非空 snapshot', () => {
    for (const t of OPPONENT_TEMPLATES) {
      expect(() => buildSnapshotFromDraft(t.draft, registry, t.id)).not.toThrow();
      const snap = buildSnapshotFromDraft(t.draft, registry, t.id);
      expect(snap.bodyDefId).toBe(t.draft.bodyDefId);
      expect(snap.functionals.length).toBeGreaterThan(0);
    }
  });
});

describe('T2｜全部模板通过 Build 合法性与能量校验', () => {
  it('T2. validateSnapshot 全部 valid（槽位/能量/类型），新增 13 套单独点名校验', () => {
    for (const t of OPPONENT_TEMPLATES) {
      const snap = buildSnapshotFromDraft(t.draft, registry, t.id);
      const res = validateSnapshot(snap, registry);
      expect(res.valid, `模板 ${t.id} 非法: ${res.errors.join('; ')}`).toBe(true);
    }
    // 新增模板显式点名（防误删）
    const newIds = OPPONENT_TEMPLATES.slice(36).map((t) => t.id);
    expect(newIds).toEqual([
      'R1-HVY-01', 'R1-HVY-02', 'R1-HVY-03',
      'R1-RUSH-01', 'R1-RUSH-02', 'R1-RUSH-03',
      'R1-GUN-01', 'R1-GUN-02', 'R1-GUN-03',
      'R1-CTRL-01', 'R1-CTRL-02',
      'R1-MIX-01', 'R1-MIX-02',
    ]);
  });
});

describe('T3｜每套至少一个有效武器', () => {
  it('T3. 全部模板 weapon 计数 ≥1', () => {
    for (const t of OPPONENT_TEMPLATES) {
      const snap = buildSnapshotFromDraft(t.draft, registry, t.id);
      const weapons = snap.functionals.filter(
        (f) => registry.functionals.get(f.defId)?.category === 'weapon',
      );
      expect(weapons.length, `模板 ${t.id} 无武器`).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('T4｜模板 ID 唯一', () => {
  it('T4. 49 套 ID 全部唯一', () => {
    const ids = OPPONENT_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('T5｜至少 8 套主组合不同', () => {
  it('T5. 主组合（Body+Movement+Combat）去重 ≥8（实测应 49/49）', () => {
    const combos = new Set(OPPONENT_TEMPLATES.map((t) => mainComboKey(t.draft)));
    // eslint-disable-next-line no-console
    console.log(`T5 mainCombos=${combos.size}/${OPPONENT_TEMPLATES.length}`);
    expect(combos.size).toBeGreaterThanOrEqual(8);
  });
});

describe('T6｜五类战斗定位覆盖数量', () => {
  it('T6. rush≥3 / ranged≥3 / heavy≥2 / control≥2 / hybrid≥2（ROLE_INDICES 实测）', () => {
    for (const r of ROLES) {
      const n = ROLE_INDICES[r].length;
      // eslint-disable-next-line no-console
      console.log(`T6 role=${r} count=${n}`);
      expect(n, `role ${r} 不足 ${ROLE_MIN[r]}`).toBeGreaterThanOrEqual(ROLE_MIN[r]);
    }
    // 并集 = 全部模板
    const all = ROLES.flatMap((r) => ROLE_INDICES[r]);
    expect(new Set(all).size).toBe(OPPONENT_TEMPLATES.length);
    expect(OPPONENT_ROLES.length).toBe(OPPONENT_TEMPLATES.length);
  });
});

describe('T7｜固定种子重复运行结果一致', () => {
  it('T7. pickOpponentForTier 同 seed 两次结果一致（4 段位 × 5 种子）', () => {
    for (const tier of ['bronze', 'silver', 'gold', 'diamond'] as const) {
      for (let seed = 1; seed <= 5; seed++) {
        const r1 = pickOpponentForTier(tier, -1, mulberry32(seed));
        const r2 = pickOpponentForTier(tier, -1, mulberry32(seed));
        expect(r1, `tier=${tier} seed=${seed}`).toBe(r2);
        expect(r1).toBeGreaterThanOrEqual(0);
        expect(r1).toBeLessThan(OPPONENT_POOL.length);
      }
    }
  });
});

describe('T8｜20 个连续种子至少命中 8 套不同模板', () => {
  it('T8A. 20 个连续种子（bronze）各抽 1 局 → 命中不同模板 ≥8', () => {
    const hit = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      const idx = pickOpponentForTier('bronze', -1, mulberry32(seed));
      hit.add(OPPONENT_TEMPLATES[idx].id);
    }
    // eslint-disable-next-line no-console
    console.log(`T8A distinct=${hit.size} ids=${[...hit].join(',')}`);
    expect(hit.size).toBeGreaterThanOrEqual(8);
  });
  it('T8B. 20 局连续对局（单种子）→ 命中不同模板 ≥8（silver 中等权重）', () => {
    const rng = mulberry32(42);
    let last = -1;
    const hit = new Set<string>();
    for (let g = 0; g < 20; g++) {
      const idx = pickOpponentForTier('silver', last, rng);
      last = idx;
      hit.add(OPPONENT_TEMPLATES[idx].id);
    }
    // eslint-disable-next-line no-console
    console.log(`T8B distinct=${hit.size}`);
    expect(hit.size).toBeGreaterThanOrEqual(8);
  });
});

describe('T9｜每套模板创建 orchestrator 并进入 Active', () => {
  it('T9. 全部 49 套 createPlanckBattle → arena phase=Active + step 1 帧正常', () => {
    const snapA = buildSnapshotFromDraft(makeStarterDraft('watermelonBody', registry), registry, 'playerA');
    for (const t of OPPONENT_TEMPLATES) {
      const snapB = buildSnapshotFromDraft(t.draft, registry, t.id);
      const req: BattleRequest = {
        battleId: `r1-t9-${t.id}`,
        buildA: snapA,
        buildB: snapB,
        config: {
          autoDrive: true,
          engine: 'planck',
          settleToGround: true,
          randomSeed: 9,
          arena: { phases: { activeMs: STEP * 40, warningMs: STEP * 20, closingMs: STEP * 40 } },
        },
        randomSeed: 9,
        rulesVersion: 'v1.0.0',
        contentVersion: 'c1',
      };
      const orch = createPlanckBattle(req, registry);
      expect(orch.arena.phase, `模板 ${t.id} 未进入 Active`).toBe('Active');
      expect(() => orch.step(STEP)).not.toThrow();
      expect(Number.isFinite(orch.timeMs)).toBe(true);
      orch.dispose();
    }
  });
});

describe('T10｜每套至少完成一次自动战斗至 Result，无异常/NaN/死循环', () => {
  it('T10. 全部 49 套短阶段自动战斗至 Result（winner A/B、hp 有限、600 步内结束）', () => {
    const snapA = buildSnapshotFromDraft(makeStarterDraft('watermelonBody', registry), registry, 'playerA');
    for (const t of OPPONENT_TEMPLATES) {
      const snapB = buildSnapshotFromDraft(t.draft, registry, t.id);
      const req: BattleRequest = {
        battleId: `r1-t10-${t.id}`,
        buildA: snapA,
        buildB: snapB,
        config: {
          autoDrive: true,
          engine: 'planck',
          settleToGround: true,
          randomSeed: 10,
          arena: { phases: { activeMs: STEP * 80, warningMs: STEP * 40, closingMs: STEP * 80 } },
        },
        randomSeed: 10,
        rulesVersion: 'v1.0.0',
        contentVersion: 'c1',
      };
      const orch = createPlanckBattle(req, registry);
      let steps = 0;
      while (!orch.result && steps < 600) {
        orch.step(STEP);
        steps++;
      }
      const r = orch.result;
      expect(r, `模板 ${t.id} ${steps} 步内未结束（死循环）`).not.toBeNull();
      expect(['A', 'B'], `模板 ${t.id} winner 非法`).toContain(r!.winner);
      expect(Number.isFinite(r!.hpA) && Number.isFinite(r!.hpB), `模板 ${t.id} hp NaN`).toBe(true);
      expect(r!.hpA).toBeGreaterThanOrEqual(0);
      expect(r!.hpB).toBeGreaterThanOrEqual(0);
      expect(r!.phase).toBe('End');
      orch.dispose();
    }
  }, 120000);
});

describe('T11｜玩家存档与当前 Build 不被对手生成修改', () => {
  afterEach(() => {
    vi.useRealTimers();
    bindPlatformCore(undefined as never);
    delete (globalThis as { wx?: unknown }).wx;
  });

  function runtimeSetup(): { runtime: PlayerGameRuntime; host: FakeHost; battle: ScriptedBattleHost } {
    const store = new Map<string, unknown>();
    (globalThis as { wx?: unknown }).wx = {
      getSystemInfoSync: () => ({ pixelRatio: 2 }),
      getStorageSync: (k: string) => (store.has(k) ? store.get(k) : null),
      setStorageSync: (k: string, v: unknown) => void store.set(k, v),
      removeStorageSync: (k: string) => void store.delete(k),
    };
    bindPlatformCore(createWechatCore(2));
    const host = new FakeHost();
    const battle = new ScriptedBattleHost();
    const runtime = new PlayerGameRuntime({ host, battle, sfx: new RecSfx() } as never);
    runtime.init();
    return { runtime, host, battle };
  }

  it('T11. 多次匹配对手变化：玩家 draft 引用与 bodyDefId 不变；存档 save/load 往返一致', () => {
    const { host, battle } = runtimeSetup();
    vi.useFakeTimers();
    const playerBody = host.lastState!.draft!.bodyDefId;
    const playerDraftRef = host.lastState!.draft;
    const before = JSON.stringify(playerDraftRef);
    // 连续 3 次匹配（loadCustom 在 onStartBattle → READY → startOrRematch 时调用）
    for (let i = 0; i < 3; i++) {
      host.actions!.onFindOpponent();
      vi.advanceTimersByTime(1500);
      host.actions!.onStartBattle();
      vi.advanceTimersByTime(700);
      const oppBody = battle.loadCustomCalls[battle.loadCustomCalls.length - 1]?.b.bodyDefId ?? '';
      expect(oppBody.length).toBeGreaterThan(0);
      // 玩家 draft 未被改写
      expect(host.lastState!.draft!.bodyDefId).toBe(playerBody);
      expect(JSON.stringify(host.lastState!.draft)).toBe(before);
    }
    // 存档往返一致（对手生成不触碰存档：直接存玩家 draft）
    savePlayerBuild(host.lastState!.draft!);
    const loaded = loadPlayerBuild();
    expect(loaded?.bodyDefId).toBe(playerBody);
    expect(Object.values(loaded?.functionalSelections ?? {}).filter((v) => v && v !== 'none').length).toBe(
      Object.values(host.lastState!.draft!.functionalSelections).filter((v) => v && v !== 'none').length,
    );
  });
});

describe('T12｜Loss→调整配置→完成并再战闭环保持通过', () => {
  afterEach(() => {
    vi.useRealTimers();
    bindPlatformCore(undefined as never);
    delete (globalThis as { wx?: unknown }).wx;
  });

  it('T12. Loss → adjust(garage 配置保持) → 换装 → 再战：对手为新模板、玩家新 build 生效', () => {
    const store = new Map<string, unknown>();
    (globalThis as { wx?: unknown }).wx = {
      getSystemInfoSync: () => ({ pixelRatio: 2 }),
      getStorageSync: (k: string) => (store.has(k) ? store.get(k) : null),
      setStorageSync: (k: string, v: unknown) => void store.set(k, v),
      removeStorageSync: (k: string) => void store.delete(k),
    };
    bindPlatformCore(createWechatCore(2));
    const host = new FakeHost();
    const battle = new ScriptedBattleHost('loss');
    const runtime = new PlayerGameRuntime({ host, battle, sfx: new RecSfx() } as never);
    runtime.init();
    const playerBody0 = host.lastState!.draft!.bodyDefId;

    // 第一场（Loss：host script result winner=B）
    vi.useFakeTimers();
    host.actions!.onFindOpponent();
    vi.advanceTimersByTime(1500);
    const oppFirst = battle.loadCustomCalls[battle.loadCustomCalls.length - 1]?.b.bodyDefId ?? '';
    host.actions!.onStartBattle();
    vi.advanceTimersByTime(700);
    let now = 0;
    for (let i = 0; i < 3; i++) { now += 16.7; runtime.tick(now); }
    expect(host.lastState!.battleState).toBe('ended');
    // Loss → adjust → garage 且玩家配置保持
    host.actions!.onResultAdjust();
    expect(host.lastState!.playerPhase).toBe('garage');
    expect(host.lastState!.draft!.bodyDefId).toBe(playerBody0);

    // 换装：切 body（Garage 装配 action：选中 body 槽 → 选新车身）
    const newBody = playerBody0 === 'watermelonBody' ? 'bananaBody' : 'watermelonBody';
    host.actions!.selectGarageSlot?.('body');
    host.actions!.onPickGarageOption(newBody);
    expect(host.lastState!.draft!.bodyDefId).toBe(newBody);

    // 再战：对手来自新池且与上场不连续重复（Runtime 避开 lastIndex）；
    // loadCustom 收到新玩家 build + 新对手
    host.actions!.onFindOpponent();
    vi.advanceTimersByTime(1500);
    host.actions!.onStartBattle();
    vi.advanceTimersByTime(700);
    const call = battle.loadCustomCalls[battle.loadCustomCalls.length - 1]!;
    expect(call.a.bodyDefId).toBe(newBody); // 玩家新 build 生效
    expect(call.b.bodyDefId.length).toBeGreaterThan(0);
    expect(call.b.bodyDefId === oppFirst, '两场对手不应连续重复').toBe(false);
    now = 0;
    for (let i = 0; i < 3; i++) { now += 16.7; runtime.tick(now); }
    expect(host.lastState!.battleState).toBe('ended'); // 闭环完成
  });
});

/* ---------- 轻量 host / ui / sfx 装配（复用 lossAdjustRematchLoopP0 语义） ---------- */
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
