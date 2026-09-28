/**
 * PRODUCT-LOOP-R8-EQUIPPED-WEAPON-REWARD-R1｜targeted 测试（纯 node，无浏览器）。
 *
 * Queue 的口径：**本局使用哪件 Full Run 主武器，胜利后就获得该武器 ★1 ×1。**
 *
 * 本文件覆盖 Queue 的六条必改 / 六条验收里**可离线钉死**的那些：
 *   - 必改 1（Reward Source）→ ER-01 / ER-02（奖励 id === 本局 Run Snapshot 的基准武器）
 *     · 且**不是**「当前 Garage 后来切换的状态」→ ER-04（出发密封后改装，发放的仍是密封件）
 *     · 也**不是**「默认 Cannon」→ ER-01 逐件（装备机枪就发机枪）
 *   - 必改 2（Reward = same weapon ★1 ×1）→ ER-05 / ER-06
 *   - 必改 3（Fusion 复用现有通用规则、不写特例）→ ER-07（逐件 5/5 → ★2）
 *   - 必改 4（Settlement 展示武器名 + N/5 → M/5，沿用单 CTA）→ ER-08
 *   - 必改 5（不支持完整 Run 的武器不得靠伪造 Run 数据领取）→ ER-03 / ER-09
 *   - Cannon 原有 R2 路径完全一致 → ER-02 / ER-07（cannon 那一格）
 *
 * ⚠️ 本文件**不测**战斗行为（那是 R6 / R7 的账本）：它只沿
 *    「装备 → 出发地址 → 终点结算 → 领取 → 库存 / Build」这一条真实产品链取证，
 *    过程中不伪造任何 Run 数据（COMPLETE 状态由真实状态机快进产出）。
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { registry } from '../src/core/content';
import {
  addPart,
  consume,
  getCount,
  loadInventoryRaw,
  saveInventory,
  type PartInventory,
} from '../src/core/partInventory';
import type { BuildDraft } from '../src/lab/buildEditorModel';
import { runLoadoutCompatOfDraft } from '../src/lab/portraitBattleLab/runLoadoutCompat';
import { buildPriorCompletedRun } from '../src/lab/portraitBattleLab/nextRunValidation';
import { parseRunPlayerLoadout } from '../src/lab/portraitBattleLab/runPlayerLoadout';
import {
  parseRunRewardChoices,
  runRewardChoiceViews,
  runSingleRewardClaim,
} from '../src/lab/portraitBattleLab/runProductReward';
import { runPageContext } from '../src/lab/portraitBattleLab/runPageScene';
import {
  FUSE_STACK,
  GROWTH_STAR,
  canFuseStack,
  fuseStack,
  openGrowthSession,
} from '../src/product/playerGrowth';
import {
  WEAPON_SLOT,
  defaultPlayerDraft,
  loadEquippedDraft,
  playerInventory,
} from '../src/product/playerLoadout';
import { claimRunReward, claimedRunCount, readClaimLedger } from '../src/product/playerProfile';
import {
  FULL_RUN_SUPPORTED_WEAPON_IDS,
  canStartFullRun,
  fullRunCompat,
  supportsFullRun,
} from '../src/product/runCompatibility';
import {
  CHOICES_PARAM,
  buildAdventureHref,
  buildClaimHref,
  buildRewardChoicePayload,
  parsePendingClaim,
  rewardChoiceIdsFor,
} from '../src/product/runReward';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PRODUCT_DIR = join(REPO_ROOT, 'src', 'product');

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

const BUILD_KEY = 'strongfruit.playerBuild.v1';
const INV_KEY = 'strongfruit.ownedParts.v2';
const CLAIMS_KEY = 'strongfruit.profileClaims.v1';

function allKeys(): string[] {
  const out: string[] = [];
  for (let i = 0; i < store.length; i += 1) {
    const k = store.key(i);
    if (k) out.push(k);
  }
  return out.sort();
}

function readProduct(f: string): string {
  return readFileSync(join(PRODUCT_DIR, f), 'utf8');
}
/** 剥注释（本项目纪律：源码字符串守卫匹配前必须剥掉注释）。 */
function strip(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** 产品默认车 + 主武器槽换成指定武器（= 玩家会在「调整战车」里做出的那一步）。 */
function equippedDraft(weaponDefId: string): BuildDraft {
  const base = defaultPlayerDraft();
  return {
    ...base,
    functionalSelections: { ...base.functionalSelections, [WEAPON_SLOT]: weaponDefId },
  };
}

/** 把某 `(defId, ★1)` 的副本数**精确**设成 n 并落盘（只用 core 的正式读写入口）。 */
function setStar1Count(inv: PartInventory, defId: string, n: number): void {
  const cur = getCount(inv, defId, GROWTH_STAR);
  if (cur < n) addPart(inv, defId, GROWTH_STAR, n - cur);
  else if (cur > n) consume(inv, defId, GROWTH_STAR, cur - n);
  saveInventory(inv);
}

/**
 * 产品侧真实产出的出发地址（不手写参数）。
 *
 * ⚠️ 与 `homePage.adventureHrefNow()` **逐字段同构**：池子来自本局 draft、数量读真实库存、
 *    阈值来自产品成长模型 —— 否则这一条链测的就不是产品真正发出去的那条地址。
 */
function adventureHref(token: string, draft: BuildDraft): string {
  const inv = playerInventory(draft);
  const specs = rewardChoiceIdsFor(draft).map((defId) => ({
    defId,
    star: GROWTH_STAR,
    countBefore: getCount(inv, defId, GROWTH_STAR),
  }));
  return buildAdventureHref(token, buildRewardChoicePayload(token, specs, FUSE_STACK), draft);
}

function searchOf(href: string): string {
  return href.slice(href.indexOf('?'));
}

interface PayloadChoice {
  defId: string;
  star: number;
  countBefore: number;
  href: string;
}

function payloadOf(href: string): { stack: number; choices: PayloadChoice[] } {
  const raw = new URLSearchParams(href.split('?')[1]).get(CHOICES_PARAM) ?? '';
  expect(raw, '出发地址必须带 choices 载荷').not.toBe('');
  return JSON.parse(raw);
}

/** 一局的完整读数：出发地址 → 载荷 → Lab 侧解析结果。 */
function departure(token: string, draft: BuildDraft) {
  const href = adventureHref(token, draft);
  const search = searchOf(href);
  return { href, search, payload: payloadOf(href), set: parseRunRewardChoices(search) };
}

/** 真实状态机快进出的 RUN COMPLETE（不伪造 phase）。 */
function completedState() {
  const s = buildPriorCompletedRun(runPageContext());
  expect(s.phase, '脚手架必须真的走到 COMPLETE').toBe('COMPLETE');
  return s;
}

/** 新账号起点（种子 + 一次性迁移都跑完 ⇒ 库存就是玩家真实看到的那一份）。 */
function seedGrowth(): BuildDraft {
  return openGrowthSession(loadEquippedDraft()).draft;
}

/* ============================================================================
   A. Reward Source = 本局 Run Snapshot 的实际主武器（必改 1）
   ============================================================================ */

describe('PRODUCT-LOOP-R8｜A. 奖励源 = 本局装备的主武器', () => {
  it('ER-01 **逐件**：装备哪件 ⇒ 池里就是哪件（7 件参数化，无一条特例）', () => {
    expect(FULL_RUN_SUPPORTED_WEAPON_IDS.length, 'Full Run 武器登记表').toBe(7);
    for (const w of FULL_RUN_SUPPORTED_WEAPON_IDS) {
      const draft = equippedDraft(w);
      // ① 池子 = 它自己（唯一一条），且它就是本局的基准武器
      expect(rewardChoiceIdsFor(draft), `装备 ${w} ⇒ 发 ${w}`).toEqual([w]);
      expect(fullRunCompat(draft).baseWeaponDefId, `${w} 是本局基准武器`).toBe(w);

      // ② 出发地址里的载荷与出口都指向它
      const token = `run-r8-${w}`;
      const { payload, set } = departure(token, draft);
      expect(payload.stack, '满 stack 阈值由产品侧给全').toBe(FUSE_STACK);
      expect(payload.choices.map((c) => c.defId), `载荷里只能有 ${w}`).toEqual([w]);
      expect(payload.choices[0]!.star, '固定 ★1 ×1').toBe(GROWTH_STAR);
      expect(payload.choices[0]!.href, '这条候选自己的领奖地址').toBe(buildClaimHref(token, w));
      expect(set, 'Lab 侧必须解析得出一条真实候选').not.toBeNull();
      expect(set!.choices.map((c) => c.defId)).toEqual([w]);
      expect(parsePendingClaim(searchOf(payload.choices[0]!.href))).toEqual({
        runToken: token,
        rewardDefId: w,
      });

      // ③ **与 Run Snapshot 一致**：同一份 Build 交给 Lab 之后解析出的基准武器还是它
      //    （产品侧 `fullRunCompat` 与 Lab 侧 `runLoadoutCompatOfDraft` 两层同值）
      const handed = parseRunPlayerLoadout(searchOf(departure(token, draft).href));
      expect(handed, '出发地址必须真的带着这份装备').not.toBeNull();
      expect(handed!.source).toBe('profile');
      expect(fullRunCompat(handed!.draft).baseWeaponDefId, '产品层读到的基准武器').toBe(w);
      expect(runLoadoutCompatOfDraft(handed!.draft).baseWeaponDefId, '局内层读到的基准武器').toBe(w);
      expect(payload.choices[0]!.defId, '奖励 id === Run Snapshot 的基准武器').toBe(
        runLoadoutCompatOfDraft(handed!.draft).baseWeaponDefId,
      );
    }
  });

  it('ER-02 Cannon 路径**逐条不变**：默认车 ⇒ cannon 局 ⇒ 池 = [cannon]（R2 不退化）', () => {
    const draft = defaultPlayerDraft();
    expect(draft.functionalSelections[WEAPON_SLOT], '默认车主武器槽 = cannon').toBe('cannon');
    expect(rewardChoiceIdsFor(draft), '默认车的池逐字等于 R2-RECOVERY 期的固定值').toEqual(['cannon']);
    expect(canStartFullRun(draft)).toBe(true);
    const { payload, set } = departure('run-r8-cannon', draft);
    expect(payload.choices.map((c) => c.defId)).toEqual(['cannon']);
    expect(set!.choices[0]!.defId).toBe('cannon');
  });

  it('ER-03 车上没有武器 / 只有不支持的武器 ⇒ **空池**（与「不发出发链接」同一条判据）', () => {
    // ① 完全没有功能件
    const bare: BuildDraft = { ...defaultPlayerDraft(), functionalSelections: {} };
    expect(fullRunCompat(bare).reason).toBe('no-weapon');
    expect(canStartFullRun(bare)).toBe(false);
    expect(rewardChoiceIdsFor(bare), '没有武器 ⇒ 没有奖励可言').toEqual([]);

    // ② 有武器、但那件跑不了完整 Run（spear = Runtime 不完整；saw = 产品槽打不到人）
    for (const w of ['spear', 'saw']) {
      const draft = equippedDraft(w);
      expect(supportsFullRun(w), `${w} 未登记`).toBe(false);
      expect(fullRunCompat(draft).reason, `${w} 局不可开始`).toBe('unsupported-weapon');
      expect(canStartFullRun(draft)).toBe(false);
      expect(rewardChoiceIdsFor(draft), `${w} ⇒ 空池`).toEqual([]);
    }
  });

  it('ER-04 奖励**不来自「当前 Garage 后来切换的状态」**：出发那刻密封，之后改装也不改发放件', () => {
    seedGrowth();
    const token = 'run-r8-sealed';
    // 出发时装备 machineGun ⇒ 载荷密封成 machineGun 的领奖地址
    const atDeparture = departure(token, equippedDraft('machineGun'));
    const sealedHref = atDeparture.payload.choices[0]!.href;
    expect(parsePendingClaim(searchOf(sealedHref))!.rewardDefId).toBe('machineGun');

    // 玩家（在另一条时间线上）把车改成了 laser —— 那**不影响**已经密封的那条地址
    const laterDraft = equippedDraft('laser');
    expect(rewardChoiceIdsFor(laterDraft), '新的一局才会是 laser 局').toEqual(['laser']);
    expect(parsePendingClaim(searchOf(sealedHref))!.rewardDefId, '密封地址不会被改写').toBe('machineGun');

    // 真领一次：发的是 machineGun，而不是「现在的 garage 状态」（laser）
    const laserBefore = getCount(loadInventoryRaw()!, 'laser', GROWTH_STAR);
    const out = claimRunReward(parsePendingClaim(searchOf(sealedHref)));
    expect(out.ok).toBe(true);
    expect(out.grant?.defId, '发的是出发那一刻密封的那件').toBe('machineGun');
    const inv = loadInventoryRaw()!;
    expect(getCount(inv, 'laser', GROWTH_STAR), 'laser 一件都没多发').toBe(laserBefore);
    expect(getCount(inv, 'machineGun', GROWTH_STAR)).toBeGreaterThan(0);
  });
});

/* ============================================================================
   B. 领取：一件、真入库、reload 保持、不动当前装备（必改 2）
   ============================================================================ */

describe('PRODUCT-LOOP-R8｜B. 领取', () => {
  it('ER-05 **逐件**：领到的是这一件 ★1 ×1，库存 +1 且落盘（7 件参数化）', () => {
    const draft0 = seedGrowth();
    for (const w of FULL_RUN_SUPPORTED_WEAPON_IDS) {
      const before = getCount(loadInventoryRaw()!, w, GROWTH_STAR);
      const beforeBuildRaw = store.getItem(BUILD_KEY);

      const out = claimRunReward({ runToken: `run-r8-${w}`, rewardDefId: w });
      expect(out.ok, `${w} 必须能领`).toBe(true);
      expect(out.grant?.defId).toBe(w);
      expect(out.grant?.name, '展示名来自正式内容库').toBe(registry.functionals.get(w)?.name);
      expect(out.grant?.countAfter, `${w}: ${before} → ${before + 1}`).toBe(before + 1);

      // ① reload 保持：不持有任何内存引用，重新读盘
      const persisted = loadInventoryRaw();
      expect(persisted, '库存必须真的落盘').toBeTruthy();
      expect(getCount(persisted!, w, GROWTH_STAR)).toBe(before + 1);

      // ② **不改变当前装备**：Build 存档逐字节不变
      expect(store.getItem(BUILD_KEY), `${w} 的领取不得改装备`).toBe(beforeBuildRaw);
      expect(JSON.stringify(loadEquippedDraft())).toBe(JSON.stringify(draft0));

      // ③ 账本记了本局（幂等键）
      expect(readClaimLedger().grantedRunIds).toContain(`run-r8-${w}`);
    }
    expect(claimedRunCount(), '7 局 = 7 条记录').toBe(FULL_RUN_SUPPORTED_WEAPON_IDS.length);
  });

  it('ER-06 同一局只能领一次（换一件也算重复）；新的一局才再发一次', () => {
    seedGrowth();
    const first = claimRunReward({ runToken: 'run-r8-dup', rewardDefId: 'machineGun' });
    expect(first.ok).toBe(true);
    const mgAfter = getCount(loadInventoryRaw()!, 'machineGun', GROWTH_STAR);
    const ledgerRaw = store.getItem(CLAIMS_KEY);

    for (const w of ['machineGun', 'laser']) {
      const again = claimRunReward({ runToken: 'run-r8-dup', rewardDefId: w });
      expect(again.ok, `同 token 再领 ${w} 必须被拒`).toBe(false);
      expect(again.reason).toBe('already-claimed');
      expect(again.grant).toBeNull();
    }
    expect(getCount(loadInventoryRaw()!, 'machineGun', GROWTH_STAR), '重复领取零副作用').toBe(mgAfter);
    expect(store.getItem(CLAIMS_KEY)).toBe(ledgerRaw);
    expect(claimedRunCount()).toBe(1);

    const second = claimRunReward({ runToken: 'run-r8-dup2', rewardDefId: 'machineGun' });
    expect(second.ok).toBe(true);
    expect(second.grant?.countAfter).toBe(mgAfter + 1);
    expect(claimedRunCount()).toBe(2);
  });
});

/* ============================================================================
   C. Fusion：复用现有通用规则（必改 3）
   ============================================================================ */

describe('PRODUCT-LOOP-R8｜C. 5/5 可 Fusion（同一套通用规则，无逐武器特例）', () => {
  it('ER-07 **逐件**：领到第 5 件 ⇒ 可合成 ⇒ ★1 ×5 → ★2 ×1（7 件参数化）', () => {
    seedGrowth();
    for (const w of FULL_RUN_SUPPORTED_WEAPON_IDS) {
      const draft = loadEquippedDraft();
      // 每一件都从「还差 1 件」的起点开始（把该 stack 精确设成 4/5）
      setStar1Count(loadInventoryRaw()!, w, FUSE_STACK - 1);
      expect(getCount(loadInventoryRaw()!, w, GROWTH_STAR), `${w} 起点 = 4/5`).toBe(FUSE_STACK - 1);

      // ① 还差 1 件 ⇒ 现在不可合成
      expect(canFuseStack(loadInventoryRaw()!, w, GROWTH_STAR).ok, `${w} 4/5 时不可合成`).toBe(false);

      // ② 这一局打完领回来 ⇒ 5/5 ⇒ 可合成
      const out = claimRunReward({ runToken: `run-r8-fuse-${w}`, rewardDefId: w });
      expect(out.ok).toBe(true);
      expect(out.grant?.countAfter).toBe(FUSE_STACK);
      const gate = canFuseStack(loadInventoryRaw()!, w, GROWTH_STAR);
      expect(gate.ok, `${w} 5/5 必须可合成`).toBe(true);
      expect(gate.need, '消耗量 = core 的合成规则').toBe(FUSE_STACK);

      // ③ 合成：**同一套通用规则**（5 × ★1 → 1 × ★2），对 7 件武器逐字相同
      const fused = fuseStack(loadInventoryRaw()!, w, GROWTH_STAR, draft);
      expect(fused.ok, `${w} 合成必须成功`).toBe(true);
      if (!fused.ok) continue;
      expect(fused.partId).toBe(w);
      expect([fused.fromStar, fused.toStar]).toEqual([GROWTH_STAR, GROWTH_STAR + 1]);
      expect(fused.consumed).toBe(FUSE_STACK);
      expect(fused.countAfter, '★1 那一档被合空').toBe(0);
      expect(fused.productCount, '产出 1 件 ★2').toBe(1);
      expect(getCount(loadInventoryRaw()!, w, 2), '★2 落盘').toBe(1);
      /*
        ④ 装备语义（R2 原语义，本 Queue 未改）：只有「装备着的那一件被合空」才自动升星。
           夹具装备的是默认车的 cannon ⇒ 只有 cannon 那一格会升到 ★2，其余 6 件装备一个
           字节都不动。
      */
      if (w === 'cannon') {
        expect(fused.equippedUpgraded, 'cannon 是默认车的装备 ⇒ 自动升星').toBe(true);
        expect(fused.equippedAfter).toBe(2);
        expect(loadEquippedDraft().functionalSelections[WEAPON_SLOT]).toBe('cannon');
      } else {
        expect(fused.equippedUpgraded, `${w} 没装在车上 ⇒ 装备不动`).toBe(false);
        expect(fused.draft).toBe(draft);
      }
    }
  });
});

/* ============================================================================
   D. Settlement 展示 + 唯一 CTA（必改 4）
   ============================================================================ */

describe('PRODUCT-LOOP-R8｜D. 结算卡按本局武器展示，出口仍是唯一单 CTA', () => {
  it('ER-08 卡片 = 对应武器名 + `当前 N/5 → 领取后 M/5`；底栏 CTA 领取的正是它', () => {
    seedGrowth();
    const draft = equippedDraft('machineGun');
    const token = 'run-r8-card';
    // 真实起点：机枪 4/5（还差 1 件）
    setStar1Count(loadInventoryRaw()!, 'machineGun', FUSE_STACK - 1);

    const { payload, search } = departure(token, draft);
    expect(payload.choices[0]!.countBefore, '数量 = 出发那一刻的真实库存读数').toBe(FUSE_STACK - 1);
    expect(payload.choices[0]!.href).toBe(buildClaimHref(token, 'machineGun'));

    const set = parseRunRewardChoices(search);
    expect(set, '载荷必须能解析').not.toBeNull();

    const s = completedState();
    const views = runRewardChoiceViews(s, set);
    expect(views.length, '这一屏只有一张卡（本局武器那件）').toBe(1);
    const v = views[0]!;
    expect(v.defId).toBe('machineGun');
    expect(v.name, '对应武器名（正式内容库现读）').toBe('机枪');
    expect(v.star).toBe(GROWTH_STAR);
    expect(v.progressText, '必改 4：当前 N/5 → 领取后 M/5').toBe('当前 4/5 → 领取后 5/5');
    expect(v.stackLimit).toBe(FUSE_STACK);
    expect(v.reachesThreshold, '4 → 5 摸到满 stack').toBe(true);

    // 出口：底栏唯一 CTA，且它领的就是卡片上那一件（「画的是 A、领的是 B」不可能）
    const claim = runSingleRewardClaim(s, set);
    expect(claim).toEqual({
      defId: 'machineGun',
      runToken: token,
      href: buildClaimHref(token, 'machineGun'),
    });
    // FAILED / 没有载荷时结构上拿不到（沿用既有口径，R8 未改）
    expect(runSingleRewardClaim(completedState(), null)).toBeNull();
  });
});

/* ============================================================================
   E. 反伪造 + 源码守卫（必改 5 / 禁止清单）
   ============================================================================ */

describe('PRODUCT-LOOP-R8｜E. 反伪造与边界', () => {
  it('ER-09 `spear` / `saw` 不能靠伪造 Run 数据领取：拒绝且**零副作用**', () => {
    seedGrowth();
    const invBefore = store.getItem(INV_KEY);
    const ledgerBefore = store.getItem(CLAIMS_KEY);
    const buildBefore = store.getItem(BUILD_KEY);
    const keysBefore = allKeys();

    for (const w of ['spear', 'saw']) {
      const out = claimRunReward({ runToken: `run-forged-${w}`, rewardDefId: w });
      expect(out.ok, `${w} 不得领取`).toBe(false);
      expect(out.reason, `${w} 的拒绝理由必须是「没有完整 Run 资格」`).toBe('not-full-run-supported');
      expect(out.grant).toBeNull();
    }
    // 零副作用：库存 / 账本 / Build / key 集合一个字节都没动
    expect(store.getItem(INV_KEY)).toBe(invBefore);
    expect(store.getItem(CLAIMS_KEY)).toBe(ledgerBefore);
    expect(store.getItem(BUILD_KEY)).toBe(buildBefore);
    expect(allKeys()).toEqual(keysBefore);
    expect(claimedRunCount()).toBe(0);

    // 对照：换一件受支持的武器 ⇒ 领得到（证明上面拒的是「武器」，不是「token」）
    const ok = claimRunReward({ runToken: 'run-forged-ok', rewardDefId: 'shotgun' });
    expect(ok.ok).toBe(true);
  });

  it('ER-10 源码守卫：奖励 id 只由装备现算；无固定池常量、无逐武器特例、唯一入账点', () => {
    const reward = strip(readProduct('runReward.ts'));
    const profile = strip(readProduct('playerProfile.ts'));
    const page = strip(readProduct('homePage.ts'));

    // ① 旧的「默认发炮」固定池常量**必须已经不存在**（它就是 R8 修掉的缺陷）
    for (const [f, code] of [
      ['runReward.ts', reward],
      ['homePage.ts', page],
    ] as const) {
      expect(code.includes('REWARD_CHOICE_IDS'), `${f} 不得残留固定池常量`).toBe(false);
    }
    // ② 池子只由 `fullRunCompat`（产品裁决唯一处）回答，且页面用的是**本局 draft**
    expect(reward.includes('rewardChoiceIdsFor'), '奖励模块必须只留现算入口').toBe(true);
    expect(reward.includes('fullRunCompat('), '池子判据必须复用产品裁决那一处').toBe(true);
    expect(page.includes('rewardChoiceIdsFor(draft)'), '页面必须用本局的 draft 现算').toBe(true);
    // ③ 不按武器名写特例（Queue 明令「不得为每把武器写特例」）
    for (const w of FULL_RUN_SUPPORTED_WEAPON_IDS) {
      for (const [f, code] of [
        ['runReward.ts', reward],
        ['playerProfile.ts', profile],
        ['homePage.ts', page],
      ] as const) {
        expect(code.includes(`=== '${w}'`), `${f} 不得对 ${w} 写特例`).toBe(false);
      }
    }
    // ④ 入账只有一处，且是 core 的 `addPart`（不新建第二套库存、结构上发不出多件）
    expect(
      profile.split('addPart(inv, defId, 1, 1)').length - 1,
      '入库点只有一处',
    ).toBe(1);
    // ⑤ 反伪造闸门用的是**产品裁决同一处**（不是自己抄一张武器名单）
    expect(profile.includes('supportsFullRun(defId)'), '闸门必须复用 supportsFullRun').toBe(true);
    // ⑥ 装备交接通道仍是同一个：页面只调 `buildAdventureHref`，自己不拼 `equipped`
    expect(page.includes('buildAdventureHref(')).toBe(true);
    expect(page.includes('encodeRunLoadout('), '页面不得自己编码装备').toBe(false);
    expect(page.includes("'equipped'"), '页面不得出现装备参数名（真源在 runReward）').toBe(false);
  });
});
