/**
 * PRODUCT-LOOP-P0-LEGACY-PROFILE-MIGRATION-AND-RUN-REACHABILITY｜旧 starter profile 迁移 + 产品基线可达性。
 *
 * ── 本文件锁的两件事 ────────────────────────────────────────────────────────
 *   ① 旧存档（starter 在 `front` 装推杆）必须被**一次性**迁移到当前 starter 形状，
 *      且**其它数据一个字节都不动**（不 reset Profile、不删库存里的推杆）；
 *   ② 迁移后的标准 Cannon 产品基线必须**真的**打到第一次局内强化（产品闭环可达）。
 *
 * ── 必改 → 用例对照 ────────────────────────────────────────────────────────
 *   必改 1（精确迁移，且只认旧 starter 结构）→ LM-10 / LM-11 / LM-12 / LM-20（源码）/ LM-21（夹具溯源）
 *   必改 2（fresh 与 migrated 同源）         → LM-13 / LM-31
 *   必改 3（Reachability Gate）             → LM-30 / LM-31 / LM-32
 *   必改 4（只允许一次有限处置）             → LM-33（本轮**未触发**：基线第一场不失败）
 *   必改 5（兼容性 P0 保持）                 → LM-40 / LM-41
 *
 * ⚠️ 判别式为什么不是「见到推杆就删」——
 *    旧横屏正式游戏的**正常玩家车库**开放全部 functional 硬点（`editableSlots(body)`），
 *    推杆也在候选池里 ⇒ 玩家可以**主动**把推杆装在 `front` 并落进同一个存档 key。
 *    因此迁移额外要求「该槽没有玩家侧写入留下的**星级印记**」（见 `migrateLegacyStarterProfile`）。
 *    本文件里 LM-12（玩家用过 ⇒ 不动）与 LM-11（玩家用过 ⇒ 不动）就是这条的守卫。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';

import { registry } from '../src/core/content';
import { buildSnapshotFromDraft, EMPTY_SLOT, makeStarterDraft, type BuildDraft } from '../src/lab/buildEditorModel';
import { validateSnapshot } from '../src/core/buildValidator';
import { getCount, isOwned } from '../src/core/partInventory';
import { loadPlayerBuild, savePlayerBuild } from '../src/core/buildPersistence';
import {
  DEFAULT_CLEARED_SLOT,
  PLAYER_BODY_DEF_ID,
  WEAPON_SLOT,
  defaultPlayerDraft,
  loadEquippedDraft,
  migrateLegacyStarterProfile,
  playerInventory,
} from '../src/product/playerLoadout';
import { canStartFullRun } from '../src/product/runCompatibility';
import { runPageContext, resolveRunPlayerLoadout } from '../src/lab/portraitBattleLab/runPageScene';
import { RunBattleRuntime } from '../src/lab/portraitBattleLab/runBattleRuntime';
import {
  createRunPageState,
  finishRunBattle,
  pressRunAction,
  runBuildIds,
  runCarriedPlayerHp,
  runChoicePoolKind,
  runCurrentNode,
  syncRunBattle,
  type RunPageState,
} from '../src/lab/portraitBattleLab/runPageState';
import { REWARD_CHOICE_IDS, buildAdventureHref, buildRewardChoicePayload } from '../src/product/runReward';
import { FUSE_STACK, GROWTH_STAR } from '../src/product/playerGrowth';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const readProduct = (f: string): string => readFileSync(join(REPO_ROOT, 'src', 'product', f), 'utf8');
/** 剥掉注释（守卫必须扫**代码**，不能扫到解释性文字）。 */
const strip = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/* --------------------------------------------------------------- 夹具 */

/** 正式存档 key（与 `core/buildPersistence.ts` 同一个；测试里显式写出来便于逐字节比对）。 */
const BUILD_KEY = 'strongfruit.playerBuild.v1';
const INV_KEY = 'strongfruit.ownedParts.v2';
const PROGRESS_KEY = 'strongfruit.playerProgress.v1';

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

let store: MemStorage;

beforeEach(() => {
  store = new MemStorage();
  (globalThis as unknown as { localStorage: MemStorage }).localStorage = store;
});

/**
 * **冻结的**历史旧 starter 形状（字面量，故意不引用 `makeStarterDraft`）。
 *
 * 迁移瞄准的是**已经落盘的历史数据**，因此这里用明文写死「当年那份 starter 长什么样」；
 * LM-21 再回头核对「Lab 的 `makeStarterDraft` 现在是否仍与它一致」——
 * 两边一旦分叉就会红，而不是让迁移悄悄失效。
 */
const LEGACY_FIXTURE: Readonly<Record<string, string>> = {
  front: 'pushRod',
  frontMass: 'cannon',
  top: 'hammer',
  rear: EMPTY_SLOT,
};

/**
 * 造一份「已落盘的旧 starter profile」。
 * ⚠️ 刻意附带一些**非默认**的旁路字段（轮径 / 轮组 / 驱动 / 其它槽星级），用来证明确实「其它数据全部保留」。
 */
interface LegacySeed {
  readonly draft: BuildDraft;
  readonly buildRaw: string;
  readonly invRaw: string;
  readonly progressRaw: string;
}

function seedLegacyProfile(): LegacySeed {
  const legacy: BuildDraft = {
    bodyDefId: PLAYER_BODY_DEF_ID,
    rearRadius: 26,
    frontRadius: 12,
    rearWheelDefId: 'smallWheel',
    frontWheelDefId: 'largeWheel',
    drive: 'stationary',
    functionalSelections: { ...LEGACY_FIXTURE },
    // 玩家**没有**碰过 front（否则会有 front 的印记），但别的槽有星级
    functionalStars: { top: 2 },
  };
  expect(validateSnapshot(buildSnapshotFromDraft(legacy, registry), registry).valid, '旧 starter 夹具本身必须合法').toBe(true);
  savePlayerBuild(legacy);
  // 库存：正式入口生成（推杆在里面）
  playerInventory(legacy);
  // 进度：故意塞一份可辨认的记录
  store.setItem(PROGRESS_KEY, JSON.stringify({ cleared: 3, best: 7 }));
  return {
    draft: legacy,
    buildRaw: store.getItem(BUILD_KEY) as string,
    invRaw: store.getItem(INV_KEY) as string,
    progressRaw: store.getItem(PROGRESS_KEY) as string,
  };
}

/** 产品侧真实产出的出发地址（不手写参数）。 */
function searchOf(draft: BuildDraft): string {
  const specs = REWARD_CHOICE_IDS.map((defId) => ({ defId, star: GROWTH_STAR, countBefore: 0 }));
  return buildAdventureHref('run-legacy-0001', buildRewardChoicePayload('run-legacy-0001', specs, FUSE_STACK), draft).split(
    '?',
  )[1] as string;
}

/** 主武器槽换成指定武器的产品默认车（产品**真的会发出去**的那台）。 */
function equippedDraft(weaponDefId: string): BuildDraft {
  const base = defaultPlayerDraft();
  const next: BuildDraft = {
    ...base,
    functionalSelections: { ...base.functionalSelections, [WEAPON_SLOT]: weaponDefId },
  };
  expect(validateSnapshot(buildSnapshotFromDraft(next, registry), registry).valid).toBe(true);
  return next;
}

/* ============================================================================
   A. 旧 starter profile 的一次性迁移（必改 1 / 必改 2）
   ============================================================================ */

describe('PRODUCT-LOOP-P0-LEGACY｜A. 旧 starter profile 迁移（必改 1）', () => {
  it('LM-10 **Case A**：旧 starter 存档 → 迁移 → 推杆清除 / cannon 保留 / 旁路数据一字不改', () => {
    const seed = seedLegacyProfile();
    const before = playerInventory(seed.draft);
    const pushRodBefore = getCount(before, 'pushRod', 1);

    const loaded = loadEquippedDraft();

    // ① 目标槽被清空，主武器**不动**
    expect(loaded.functionalSelections[DEFAULT_CLEARED_SLOT]).toBe(EMPTY_SLOT);
    expect(loaded.functionalSelections[WEAPON_SLOT]).toBe(LEGACY_FIXTURE[WEAPON_SLOT]);
    // ② 旁路数据全部保留（轮径 / 轮组 / 驱动 / 其它槽星级 / 其它槽内容）
    expect(loaded.rearRadius).toBe(26);
    expect(loaded.frontRadius).toBe(12);
    expect(loaded.rearWheelDefId).toBe('smallWheel');
    expect(loaded.frontWheelDefId).toBe('largeWheel');
    expect(loaded.drive).toBe('stationary');
    expect(loaded.functionalStars).toEqual({ top: 2 });
    expect(loaded.functionalSelections['top']).toBe('hammer');
    expect(loaded.bodyDefId).toBe(PLAYER_BODY_DEF_ID);
    // ③ 迁移结果仍然合法（`playerProfile` 依赖这条不变量）
    expect(validateSnapshot(buildSnapshotFromDraft(loaded, registry), registry).valid).toBe(true);
    // ④ **不粗暴删推杆**：库存里的推杆一件不少
    expect(pushRodBefore).toBeGreaterThan(0);
    expect(getCount(playerInventory(loaded), 'pushRod', 1)).toBe(pushRodBefore);
    expect(isOwned('pushRod', 1)).toBe(true);
    // ⑤ 迁移真的落盘（否则 Home / Run 下次读到的还是旧形状）
    //    判据走**正式读路径**，不是我直接 JSON.parse 自己的那份
    expect(loadPlayerBuild()?.functionalSelections[DEFAULT_CLEARED_SLOT]).toBe(EMPTY_SLOT);
    const after = JSON.parse(store.getItem(BUILD_KEY) as string) as BuildDraft;
    expect(after.functionalSelections[DEFAULT_CLEARED_SLOT]).toBe(EMPTY_SLOT);
  });

  it('LM-11 **永久数据不丢**：库存 / 进度 key 逐字节不变（迁移只动 Build 的那一个槽）', () => {
    const seed = seedLegacyProfile();
    loadEquippedDraft();
    expect(store.getItem(INV_KEY)).toBe(seed.invRaw);
    expect(store.getItem(PROGRESS_KEY)).toBe(seed.progressRaw);
  });

  it('LM-12 **玩家主动装过 front 的不动**（判别式收紧：有星级印记 ⇒ 原样返回）', () => {
    const base = makeStarterDraft(PLAYER_BODY_DEF_ID, registry);
    const chosen: BuildDraft = {
      ...base,
      functionalSelections: { ...base.functionalSelections },
      // 玩家在旧横屏车库把 front 装成推杆 → 该槽留下星级印记
      functionalStars: { [DEFAULT_CLEARED_SLOT]: 1 },
    };
    savePlayerBuild(chosen);
    const raw = store.getItem(BUILD_KEY) as string;

    const out = migrateLegacyStarterProfile(chosen);
    expect(out.migrated).toBe(false);
    expect(out.reason).toBe('player-chosen');
    expect(out.draft).toBe(chosen); // 同一个对象，连拷贝都没有
    // 读入口同样不动它
    expect(loadEquippedDraft().functionalSelections[DEFAULT_CLEARED_SLOT]).toBe(LEGACY_FIXTURE[DEFAULT_CLEARED_SLOT]);
    expect(store.getItem(BUILD_KEY)).toBe(raw); // 一个字节都没改
  });

  it('LM-13 **Case B/C**：fresh profile ⇒ no-op；其它形状（非推杆 / 非 cannon / 无此槽）⇒ 不误改', () => {
    // B：产品侧 fresh starter（front 已是空槽）
    const fresh = defaultPlayerDraft();
    expect(migrateLegacyStarterProfile(fresh).migrated).toBe(false);
    expect(migrateLegacyStarterProfile(fresh).reason).toBe('not-legacy-shape');
    savePlayerBuild(fresh);
    const freshRaw = store.getItem(BUILD_KEY) as string;
    expect(loadEquippedDraft()).toEqual(fresh);
    expect(store.getItem(BUILD_KEY)).toBe(freshRaw); // 零写盘

    // B'：完全没有存档 ⇒ 回退 starter，且**不落盘**
    store = new MemStorage();
    (globalThis as unknown as { localStorage: MemStorage }).localStorage = store;
    expect(loadEquippedDraft()).toEqual(defaultPlayerDraft());
    expect(store.getItem(BUILD_KEY)).toBeNull();

    // C：非 legacy 形状
    const base = makeStarterDraft(PLAYER_BODY_DEF_ID, registry);
    const spearFront: BuildDraft = {
      ...base,
      functionalSelections: { ...base.functionalSelections, [DEFAULT_CLEARED_SLOT]: 'spear' },
    };
    expect(migrateLegacyStarterProfile(spearFront).migrated).toBe(false);
    const spearWeapon: BuildDraft = {
      ...base,
      functionalSelections: { ...base.functionalSelections, [WEAPON_SLOT]: 'spear' },
    };
    expect(migrateLegacyStarterProfile(spearWeapon).migrated).toBe(false);
    const noFront: BuildDraft = {
      ...base,
      functionalSelections: { ...base.functionalSelections, [DEFAULT_CLEARED_SLOT]: EMPTY_SLOT },
    };
    expect(migrateLegacyStarterProfile(noFront).migrated).toBe(false);
  });

  it('LM-14 **Case D**：迁移过的存档 reload ⇒ 不重复修改（结构上一次为限）', () => {
    seedLegacyProfile();
    const first = loadEquippedDraft();
    expect(first.functionalSelections[DEFAULT_CLEARED_SLOT]).toBe(EMPTY_SLOT);
    const rawAfterFirst = store.getItem(BUILD_KEY) as string;
    const writesAfterFirst = store.writes;

    // 再读两次：签名已不成立 ⇒ 不再写盘、结果稳定
    const second = loadEquippedDraft();
    const third = loadEquippedDraft();
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(store.getItem(BUILD_KEY)).toBe(rawAfterFirst);
    expect(store.writes).toBe(writesAfterFirst);
  });

  it('LM-20 源码守卫：迁移**只清一个槽**，且本模块从不删存档（禁止 reset 整个 Profile）', () => {
    const code = strip(readProduct('playerLoadout.ts'));
    // 只允许改这一个槽的取值：迁移里出现的 `[DEFAULT_CLEARED_SLOT]: EMPTY_SLOT` 是唯一一处槽位写入
    expect(code.includes('migrateLegacyStarterProfile')).toBe(true);
    expect(code.includes('removeItem')).toBe(false);
    expect(code.includes('resetPlayerSave')).toBe(false);
    // 签名必须来自旧 starter 真源，而不是本模块自建的部件清单
    expect(code.includes('makeStarterDraft(')).toBe(true);
  });

  it('LM-21 夹具溯源：Lab 的 `makeStarterDraft` 现在仍等于冻结的历史旧 starter 形状', () => {
    /*
      ⚠️ 这条不是「测实现」，而是**漂移报警**：
      迁移用 `makeStarterDraft` 当签名真源（避免抄第二份常量表），代价是
      「有人改了 Lab starter」会让迁移悄悄失效。这条把那个前提显式钉死。
    */
    const starter = makeStarterDraft(PLAYER_BODY_DEF_ID, registry).functionalSelections;
    expect(starter[DEFAULT_CLEARED_SLOT]).toBe(LEGACY_FIXTURE[DEFAULT_CLEARED_SLOT]);
    expect(starter[WEAPON_SLOT]).toBe(LEGACY_FIXTURE[WEAPON_SLOT]);
    expect(starter['top']).toBe(LEGACY_FIXTURE['top']);
    // 迁移**不写** functionalStars 的旧事实：Lab starter 至今不盖星级印记
    expect(makeStarterDraft(PLAYER_BODY_DEF_ID, registry).functionalStars).toBeUndefined();
  });

  it('LM-22 旧 profiling 的 `front` 挂推杆确实是可达性问题（R1-C 实测形状的机器复述）', () => {
    // 迁移后的车与 fresh starter 在「功能槽」上完全一致 ⇒ 迁移不是「另一套 starter」
    const migrated = migrateLegacyStarterProfile({
      ...(makeStarterDraft(PLAYER_BODY_DEF_ID, registry) as BuildDraft),
    }).draft;
    const fresh = defaultPlayerDraft();
    expect(migrated.functionalSelections).toEqual(fresh.functionalSelections);
  });
});

/* ============================================================================
   B. 产品基线 Run Reachability（必改 3 / 必改 4）
   ============================================================================ */

const FRAME_MS = 1000 / 60;
/** 与既有单局驱动器同口径：远大于实测结束时间（≈16s ≈ 960 帧），只防死循环。 */
const MAX_FRAMES = 4000;

/** 把一局驱动器推进到**第一次 BATTLE** 之前（真实脚本 + 真实状态机）。 */
function reachFirstBattle(): { state: RunPageState; ctx: ReturnType<typeof runPageContext> } {
  const ctx = runPageContext();
  let s = createRunPageState(ctx);
  let guard = 0;
  while (s.phase !== 'BATTLE' && guard < 40) {
    s = pressRunAction(s, ctx);
    guard += 1;
  }
  return { state: s, ctx };
}

/**
 * 用**指定玩家装载**跑完第一场真实战斗，返回（战斗后状态, 是否真的出了结果）。
 * 与宿主同一条链：`RunBattleRuntime({ build, carriedHp, encounterId, playerDraft })`。
 */
function runFirstBattleOn(
  playerDraft: BuildDraft,
): { state: RunPageState; ctx: ReturnType<typeof runPageContext>; resolved: boolean } {
  const { state, ctx } = reachFirstBattle();
  expect(state.phase, '必须先到达第一场战斗').toBe('BATTLE');
  const node = runCurrentNode(state);
  const rt = new RunBattleRuntime({
    build: runBuildIds(state),
    carriedHp: runCarriedPlayerHp(state),
    encounterId: node.encounterId,
    playerDraft,
    playerLoadoutTag: 'profile-equipped',
  });
  let cur = state;
  for (let i = 0; i < MAX_FRAMES && cur.phase === 'BATTLE'; i += 1) {
    rt.step(FRAME_MS);
    const hp = rt.hp();
    cur = syncRunBattle(cur, { playerHp: hp.a, enemyHp: hp.b, steps: rt.stepCount });
    const r = rt.result;
    if (r) {
      cur = finishRunBattle(cur, {
        winner: r.winner ?? null,
        endReason: r.endReason ?? null,
        playerHp: hp.a,
        enemyHp: hp.b,
        steps: rt.stepCount,
      });
    }
  }
  return { state: cur, ctx, resolved: rt.result !== null };
}

describe('PRODUCT-LOOP-P0-LEGACY｜B. 产品基线可达性（必改 3 / 必改 4）', () => {
  it('LM-30 **Case E**：标准 cannon 产品基线 ⇒ 第一场能结束，且真的走到第一次局内强化', () => {
    const baseline = loadEquippedDraft(); // 无存档 ⇒ fresh starter（front 空）
    expect(baseline.functionalSelections[DEFAULT_CLEARED_SLOT]).toBe(EMPTY_SLOT);

    const battle = runFirstBattleOn(baseline);
    expect(battle.resolved, '第一场必须真的出结果（不是触顶 / 卡死）').toBe(true);
    expect(battle.state.phase, `第一场结束后应进入后续相位（实得 ${battle.state.phase}）`).not.toBe('BATTLE');

    // 继续推进：必须走到**第一次强化**（第一层三选一）
    let s = battle.state;
    let guard = 0;
    while (s.phase !== 'CHOICE' && s.phase !== 'FAILED' && s.phase !== 'COMPLETE' && guard < 40) {
      s = pressRunAction(s, battle.ctx);
      guard += 1;
    }
    expect(s.phase, '产品闭环：第一场之后必须能进入强化节点（不能停在 RESULT / 直接失败）').toBe('CHOICE');
    expect(runChoicePoolKind(s), '第一次强化必须是第一层池').toBe('layer1');
    expect(runBuildIds(s), '进入强化时本局还没有任何强化（这正是「第一次」）').toEqual([]);
  });

  it('LM-31 迁移后的 profile 与 fresh 走**同一条**可达路径（必改 2：不存在第二套 starter）', () => {
    const seed = seedLegacyProfile();
    const migrated = loadEquippedDraft();
    expect(migrated.functionalSelections[DEFAULT_CLEARED_SLOT]).toBe(EMPTY_SLOT);
    /*
      「同一当前规则」= **功能槽这一层**与 fresh starter 逐槽相同（同一套 starter 规则）——
      不是「整份 draft 等于默认车」。玩家自己的车身 / 轮径 / 轮组 / 驱动 / 星级是**玩家数据**，
      迁移必须**原样保留**（那正是必改 1 的「其它数据全部保留」这一半）。
      ⚠️ 第一版断言写成了「等于 fresh 的轮径」⇒ 假红：夹具刻意用了非默认轮径来证明保留性。
    */
    const fresh = defaultPlayerDraft();
    expect(migrated.functionalSelections).toEqual(fresh.functionalSelections);
    expect(migrated.bodyDefId).toBe(fresh.bodyDefId);
    // 玩家数据保留（不因为迁移而被「重置成默认车」）
    expect(migrated.rearRadius).toBe(seed.draft.rearRadius);
    expect(migrated.frontRadius).toBe(seed.draft.frontRadius);
    expect(migrated.rearWheelDefId).toBe(seed.draft.rearWheelDefId);
    expect(migrated.frontWheelDefId).toBe(seed.draft.frontWheelDefId);
    // 主武器仍是 cannon ⇒ 完整 Run 资格成立
    expect(migrated.functionalSelections[WEAPON_SLOT]).toBe('cannon');
    expect(canStartFullRun(migrated)).toBe(true);
  });

  it('LM-32 基线**不受**「本局强化」影响：第一场 `build === []`（必改 3 说的是「进入第一次强化」而已）', () => {
    /*
      必改 3 的最低要求只是「产品闭环可达」，**不是**「一定通关」。
      这里把口径写死：第一场开打时本局还没有任何强化；强化是**第一场之后**才拿到的。
    */
    const { state } = reachFirstBattle();
    expect(runBuildIds(state)).toEqual([]);
    expect(state.phase).toBe('BATTLE');
  });

  it('LM-33 必改 4 **未触发**：基线第一场不失败 —— 因此本轮不需要换低压 Encounter', () => {
    /*
      必改 4 的处置是**条件性**的（「如果当前标准 Cannon Build 仍然在 Battle 1 稳定失败」）。
      本用例把前提机器化：基线车在第一场打赢 ⇒ 既不换 Encounter，也不做任何数值扫描。
      若哪天基线真的第一场就输，这条会红 —— 那时才按必改 4 的**唯一**最小处置走。
    */
    const battle = runFirstBattleOn(defaultPlayerDraft());
    expect(battle.resolved).toBe(true);
    expect(battle.state.phase, '基线第一场应判玩家胜（否则请按必改 4 换最低压的现成 Encounter）').not.toBe('FAILED');
  });
});

/* ============================================================================
   C. 兼容性 P0 保持（必改 5）
   ============================================================================ */

describe('PRODUCT-LOOP-P0-LEGACY｜C. 兼容性 P0 保持（必改 5）', () => {
  it('LM-40 cannon 仍可进入完整 Run；Runtime 不完整的武器仍被入口守门（必改 D）', () => {
    expect(canStartFullRun(equippedDraft('cannon'))).toBe(true);
    // PRODUCT-LOOP-R6（契约变更）：hammer 现在**可以**进 —— 它有完整的 `hammerBehavior`，
    // 且 Run 已不再把基准武器硬绑 cannon（它以 hammer 自己的 canonical Def 跑）。
    expect(canStartFullRun(equippedDraft('hammer')), 'hammer 有完整 Runtime ⇒ 放行').toBe(true);
    // 守门对象换成「Runtime 不完整」的那件：spear 的 `behavior === 'ram'` 没有工厂
    expect(canStartFullRun(equippedDraft('spear')), 'spear').toBe(false);
  });

  it('LM-41 **Case F**：Runtime 不完整武器的出发地址在 Run 侧仍被判 `unsupported-loadout`（第二层防线未失效）', () => {
    for (const defId of ['spear']) {
      const r = resolveRunPlayerLoadout(searchOf(equippedDraft(defId)));
      expect(r.blocked, defId).toBe(true);
      expect(r.fallback, defId).toBe('unsupported-loadout');
    }
    // R6：hammer 的地址现在走得通（第二层防线放行「有完整 Runtime」的武器）
    const hammer = resolveRunPlayerLoadout(searchOf(equippedDraft('hammer')));
    expect(hammer.blocked).toBe(false);
    expect(hammer.fallback).toBe('none');
    const ok = resolveRunPlayerLoadout(searchOf(equippedDraft('cannon')));
    expect(ok.blocked).toBe(false);
    expect(ok.fallback).toBe('none');
  });

  it('LM-42 迁移**不产生**新的兼容性口径：RunModifier 的强 invariant 仍在（判据已参数化）', () => {
    const code = strip(readFileSync(join(REPO_ROOT, 'src', 'lab', 'portraitBattleLab', 'runModifiers.ts'), 'utf8'));
    expect(code.includes('snapshotHasRunBaseWeapon')).toBe(true);
    // PRODUCT-LOOP-R6：基准武器改为**从装备解析**（参数化），不是新增第二套兼容口径
    expect(code.includes('resolveRunBaseWeaponDefId')).toBe(true);
    expect(code.includes('throw new Error')).toBe(true);
    expect(code.includes('catch')).toBe(false);
  });
});
