/**
 * PRODUCT-LOOP-R2-A-REWARD-STACK-INVENTORY｜targeted 测试（纯 node，无浏览器）。
 *
 * 覆盖 Queue 九条验收里**可离线钉死**的那些：
 *   1  fresh profile cannon = ★1 ×4   → PG-01/02（`playerGrowthR2A.test.ts`）+ PC-01（本文件 C 段）
 *   2  COMPLETE 出现 3 个真实 Weapon  → PR-15/PR-16（真实状态机造 COMPLETE，三张卡齐备）
 *   3  选择 cannon 后变成 ×5          → PC-10（4 → 5，计数落在正式库存 key 上）
 *   4  选择其它 Weapon 只加对应 stack → PC-13（逐条候选各领一次，只有它自己 +1）
 *   5  同一奖励只能领取一次           → PC-11（同 token 换一件也落 `already-claimed`）
 *   6  FAILED 数量完全不变            → PR-16（结构上拿不到候选）+ PC-14（账本/库存逐字节不变）
 *   7  old Profile migration 不丢数据 → PG-05/06（`playerGrowthR2A.test.ts`）
 *   8  Equipped 仍指向有效库存实例     → PG-07（同上）
 *   9  targeted + tsc + product smoke  → 本文件 + 门禁（smoke = `e2e:product-reward`）
 *
 * 外加**结构守卫**（本 Queue 的边界必须能在源码层面被钉死）：
 *   - 候选只复用已有正式 Weapon（cannon / spear / hammer ⇒ 不新增定义、不能是 Run Buff）；
 *   - 同一 `(partId, star)` **归并成同一个 stack**（Queue 必改 1 的「不生成 5 张一样的卡」）；
 *   - UI 不得直接读写 localStorage（R1-B 起：必须封装在 Profile Repository 内）；
 *   - 产品地址只有**一个**真源，且 Lab 侧一个都没有（Lab 白名单结构上也 import 不了产品模块）；
 *   - 3选1 绘制不引入新的像素账本颜色（既有路径逐像素不变）。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { registry } from '../src/core/content';
import { computeEnergy, validateSnapshot } from '../src/core/buildValidator';
import {
  addPart,
  canFuse,
  defaultInventory,
  getCount,
  isOfficialPart,
  loadInventoryRaw,
  STARTER_PARTS,
} from '../src/core/partInventory';
import { buildSnapshotFromDraft, makeStarterDraft } from '../src/lab/buildEditorModel';
import {
  PLAYER_BODY_DEF_ID,
  WEAPON_SLOT,
  loadEquippedDraft,
  stackThreshold,
  weaponEntries,
} from '../src/product/playerLoadout';
import {
  FUSE_STACK,
  FRESH_STACK_SEED,
  GROWTH_STAR,
  openGrowthSession,
} from '../src/product/playerGrowth';
import {
  ADVENTURE_HREF,
  CHOICES_PARAM,
  HOME_HREF,
  HOME_PARAM,
  REWARD_CHOICE_IDS,
  REWARD_PARAM,
  RUN_PARAM,
  buildAdventureHref,
  buildClaimHref,
  buildRewardChoiceLinks,
  buildRewardChoicePayload,
  newRunToken,
  parsePendingClaim,
  rewardDisplayName,
} from '../src/product/runReward';
import {
  PROFILE_CLAIMS_KEY,
  claimRunReward,
  claimedRunCount,
  equippableOnCurrentVehicle,
  isRunClaimed,
  readClaimLedger,
} from '../src/product/playerProfile';
import {
  RUN_CLAIM_AND_RETURN_LABEL,
  RUN_CLAIMING_LABEL,
  RUN_REWARD_NOTE,
  RUN_REWARD_TITLE,
  fitRewardIcon,
  parseRunRewardChoices,
  rewardChoiceView,
  rewardColliderGeom,
  runRewardChoiceViews,
  runSelectedClaim,
  runSingleRewardClaim,
} from '../src/lab/portraitBattleLab/runProductReward';
// PRODUCT-LOOP-R2-RECOVERY（必改 2）：奖励池的**新不变式**要拿完整 Run 支持清单来对账。
import { FULL_RUN_SUPPORTED_WEAPON_IDS, supportsFullRun } from '../src/product/runCompatibility';
// PRODUCT-LOOP-R2-RECOVERY（必改 1）：一次性 onboarding 的版本标记 key（断言写入面用）。
import { R2_ONBOARDING_KEY } from '../src/product/r2Onboarding';
// PRODUCT-LOOP-R2-VALIDATION-STATE-RESEED-R1：**第二个**一次性迁移标记 key
// （`openGrowthSession` 现在会同时写它 ⇒ `PC-10` 的闭集断言要把白名单 +1）。
import { R2_RESEED_KEY } from '../src/product/r2Reseed';
import {
  RUN_FAIL_PARAM,
  parseRunFailReturn,
  runFailSettlementNow,
} from '../src/lab/portraitBattleLab/runFailSettlement';
import {
  createRunPageState,
  finishRunBattle,
  pressRunAction,
  runComplete,
  type RunPageState,
} from '../src/lab/portraitBattleLab/runPageState';
import { runPageContext } from '../src/lab/portraitBattleLab/runPageScene';
import { buildPriorCompletedRun } from '../src/lab/portraitBattleLab/nextRunValidation';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PRODUCT_DIR = join(REPO_ROOT, 'src', 'product');
const LAB_DIR = join(REPO_ROOT, 'src', 'lab', 'portraitBattleLab');

function readProduct(f: string): string {
  return readFileSync(join(PRODUCT_DIR, f), 'utf8');
}
function readLab(f: string): string {
  return readFileSync(join(LAB_DIR, f), 'utf8');
}
function strip(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

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

function allKeys(): string[] {
  const out: string[] = [];
  for (let i = 0; i < store.length; i += 1) {
    const k = store.key(i);
    if (k) out.push(k);
  }
  return out.sort();
}

const INV_KEY = 'strongfruit.ownedParts.v2';

/** 用**真实状态机**造一个 RUN COMPLETE（沿用验证脚手架的确定性快进，不伪造 phase）。 */
function completedState(): RunPageState {
  const s = buildPriorCompletedRun(runPageContext());
  expect(s.phase, '脚手架必须真的走到 COMPLETE').toBe('COMPLETE');
  return s;
}

/** 用**真实状态机**造一个 FAILED（第一场玩家耐久归零 → 立即终态）。 */
function failedState(): RunPageState {
  const ctx = runPageContext();
  let s = createRunPageState(ctx);
  for (let g = 0; g < 20 && s.phase !== 'BATTLE'; g += 1) s = pressRunAction(s, ctx);
  expect(s.phase, '推进到第一场战斗').toBe('BATTLE');
  const dead = finishRunBattle(s, {
    winner: 'B',
    endReason: 'hp',
    playerHp: 0,
    enemyHp: s.battle?.enemyHpMax ?? 1,
    steps: 1,
  });
  expect(dead.phase, '玩家耐久归零 → FAILED').toBe('FAILED');
  return dead;
}

/** 三条候选读数（`countBefore` 由调用方给；三选一的载荷就是用它们组的）。 */
function specs(countBefore = 0): Array<{ defId: string; star: number; countBefore: number }> {
  return REWARD_CHOICE_IDS.map((defId) => ({ defId, star: GROWTH_STAR, countBefore }));
}

/** 一份「出发那一刻」的完整产品上下文（走真实产出链，不手写 URL）。 */
function payloadOf(href: string): { stack: number; choices: Array<{ defId: string; star: number; countBefore: number; href: string }> } {
  const raw = new URLSearchParams(href.split('?')[1]).get(CHOICES_PARAM) ?? '';
  expect(raw, '出发地址必须带 choices 载荷').not.toBe('');
  return JSON.parse(raw);
}

/**
 * 把一个**手工构造的**候选载荷编成 search 串。
 *
 * ⚠️ 必须走 `URLSearchParams`：载荷是 JSON，里面天然含 `&` 与 `=`，
 *    直接拼 `?run=x&choices={"a":1,...}` 会被 query 解析在 JSON 内部切断
 *    ⇒ 测的就不是「坏候选」而是「坏 JSON」（本文件曾因此误判过一次）。
 */
function searchOf(runToken: string, payload: unknown): string {
  return `?${new URLSearchParams({
    [RUN_PARAM]: runToken,
    [CHOICES_PARAM]: JSON.stringify(payload),
  }).toString()}`;
}

const REWARD_CTX = parseRunRewardChoices(
  `?${new URLSearchParams({
    [RUN_PARAM]: 'run-test-1',
    [CHOICES_PARAM]: JSON.stringify(buildRewardChoicePayload('run-test-1', specs(4), FUSE_STACK)),
  }).toString()}`,
)!;

// ============================================================================
describe('PRODUCT-LOOP-R2-A｜A. 候选池必须「实测」而不是「偏好」', () => {
  it('PR-01 候选**全部**是正式部件库里的正式 Weapon，且**全部**支持完整 Run（本 Queue 新立的不变式）', () => {
    /*
      ⚠️ PRODUCT-LOOP-R2-RECOVERY（必改 2）**改写了这一条**：
         R2-A 断言的是「3选1 ⇒ 恰好三条」。真人反馈 ③ 证明「三条」本身就是一个缺陷
         （发了一件当前完整 Run 不支持的 Weapon ⇒ 奖励了一件用不上的东西）
         ⇒ 本 Queue 把口径从**条数**换成**可用性**：候选池可以只有一条，但**每一条**
         都必须是这一局真的用得上的东西（`REWARD_CHOICE_IDS ⊆ FULL_RUN_SUPPORTED_WEAPON_IDS`）。
         断言数量没放松（下面仍然要求非空），而且**加了一条 R2-A 没有的守门**。
    */
    expect(REWARD_CHOICE_IDS.length, '候选池不能是空集（否则 COMPLETE 就没有出口）').toBeGreaterThan(0);
    for (const id of REWARD_CHOICE_IDS) {
      expect(isOfficialPart(id), `${id} 必须在 PART_OPTIONS 正式池内`).toBe(true);
      const def = registry.functionals.get(id);
      expect(def, `${id} 必须存在于正式内容库`).toBeTruthy();
      expect(def!.category, `${id} 必须是 Weapon`).toBe('weapon');
      // 展示名来自正式内容库（不是第二份字面量）
      expect(rewardDisplayName(id)).toBe(def!.name);
      // ★ 新不变式：奖励池里不能出现「当前完整 Run 不支持」的 Weapon
      expect(
        supportsFullRun(id),
        `${id} 不支持完整 Run ⇒ 发出去就是「奖励一个用不上的东西」（真人反馈 ③）`,
      ).toBe(true);
    }
    // 未知 id → null（绝不静默回退到别的部件名）
    expect(rewardDisplayName('doesNotExist')).toBeNull();
  });

  it('PR-02 候选**全部来自 STARTER_PARTS**（第一版只用已有 Weapon，不新增内容）', () => {
    for (const id of REWARD_CHOICE_IDS) {
      expect(STARTER_PARTS, `${id} 必须是玩家一开始就拥有的那几件`).toContain(id);
    }
    // 对照：R1-B 的单件固定奖励（laser）**不是**候选 —— 它不在 starter 里，
    // 一旦它被写回候选池，本 Queue「只用已有 cannon / spear / hammer」就破了。
    expect(REWARD_CHOICE_IDS).not.toContain('laser');
  });

  /**
   * PR-03｜Queue 必改 1 的中心判据：「同一个 `partId + star` 必须归并为同一个 stack」。
   * 这里不靠「代码看起来对」，而是**真的加两次**再读计数。
   */
  it('PR-03 同一 (partId, star) 归并成**同一个** stack（不产生 5 张一样的库存卡）', () => {
    const inv = defaultInventory();
    const base = getCount(inv, 'cannon', 1);
    addPart(inv, 'cannon', 1, 2);
    addPart(inv, 'cannon', 1, 3); // 分两次加，必须落在同一个计数器上
    expect(getCount(inv, 'cannon', 1), '两次加 = 一个 stack（base + 5）').toBe(base + 5);
    expect(base + 5, '跨过满 stack 阈值 —— 合成阈值那条线也是同一个计数器').toBe(FUSE_STACK + base);
    // 不同 star 是不同 stack（`(partId, star)` 才是键）
    expect(getCount(inv, 'cannon', 2), '★1 与 ★2 不是同一个 stack').toBe(0);
    // 而 `weaponEntries` 是遍历**定义**取计数 ⇒ 结构上只会产生**一条** cannon 读数
    const entries = weaponEntries(inv);
    expect(entries.filter((w) => w.defId === 'cannon').length, '同一个 stack 只能有一条读数').toBe(1);
    expect(entries.find((w) => w.defId === 'cannon')!.count).toBe(base + 5);
  });

  it('PR-04 候选池内互不相同（不会出现两张指向同一个 stack 的卡）', () => {
    expect(new Set(REWARD_CHOICE_IDS).size).toBe(REWARD_CHOICE_IDS.length);
    const links = buildRewardChoiceLinks('run-x', specs(1));
    // ⚠️ 断言按 `links.length` 现算（不是写死 3）：候选池的**条数**是产品决策，
    //    「每条的地址 / 件号互不相同」才是本用例守的不变量。
    expect(new Set(links.map((l) => l.href)).size, '每个候选的领奖地址必须互不相同').toBe(links.length);
    expect(new Set(links.map((l) => l.defId)).size).toBe(links.length);
  });

  it('PR-05 Run 强化**结构上**不可能是候选（不是正式部件 ⇒ 直接拒收）', () => {
    expect(allKeys()).toEqual([]);
    for (const buff of ['heavyShell', 'twinCannon', 'fastReload']) {
      expect(registry.functionals.get(buff), `${buff} 不是部件`).toBeUndefined();
      expect(isOfficialPart(buff)).toBe(false);
      expect(REWARD_CHOICE_IDS).not.toContain(buff);
      const bad = claimRunReward({ runToken: `run-buff-${buff}`, rewardDefId: buff });
      expect(bad.ok).toBe(false);
      expect(bad.reason).toBe('not-official');
    }
    // 零副作用：一条记录都没写
    expect(allKeys()).toEqual([]);
  });

  it('PR-06 候选卡内容 = 正式定义的真实数据（名称 / 能量 / 外接框 / 数量预览）', () => {
    const def = registry.functionals.get('cannon')!;
    const view = rewardChoiceView({ defId: 'cannon', star: GROWTH_STAR, countBefore: 4, href: 'x' }, FUSE_STACK);
    expect(view).toBeTruthy();
    expect(view!.name).toBe(def.name);
    expect(view!.energy).toBe(def.energy);
    expect(view!.star).toBe(GROWTH_STAR);
    const geom = rewardColliderGeom(def.collider);
    expect([view!.w, view!.h, view!.round]).toEqual([geom.w, geom.h, geom.round]);
    expect(view!.w).toBeGreaterThan(0);
    expect(view!.h).toBeGreaterThan(0);
    // 数量读数（Queue 必改 4 的第四项）：当前 → 领取后
    expect(view!.countBefore).toBe(4);
    expect(view!.countAfter).toBe(5);
    expect(view!.previewText).toBe('4 → 5');
    expect(view!.stackText).toBe('4/5');
    expect(view!.reachesThreshold, '4 → 5 就摸到满 stack 了').toBe(true);
    // 已满的读数收敛成 5/5（不写 6/5）
    const full = rewardChoiceView({ defId: 'cannon', star: GROWTH_STAR, countBefore: 5, href: 'x' }, FUSE_STACK);
    expect(full!.stackText).toBe('5/5');
    expect(full!.countAfter).toBe(6);
    // 未知 / 非武器 / 非法读数 → 一律 null（不静默回退到别的部件）
    expect(rewardChoiceView({ defId: 'doesNotExist', star: 1, countBefore: 0, href: 'x' }, FUSE_STACK)).toBeNull();
    expect(rewardChoiceView({ defId: 'pushRod', star: 1, countBefore: 0, href: 'x' }, FUSE_STACK), '推杆是 Gadget').toBeNull();
    expect(rewardChoiceView({ defId: 'cannon', star: 1, countBefore: -1, href: 'x' }, FUSE_STACK)).toBeNull();
    expect(rewardChoiceView({ defId: 'cannon', star: 0, countBefore: 0, href: 'x' }, FUSE_STACK)).toBeNull();
    // fit 只缩不放，且塞得进方框
    const fit = fitRewardIcon(view!, 34, 34);
    expect(fit.w).toBeLessThanOrEqual(34);
    expect(fit.h).toBeLessThanOrEqual(34);
    expect(fit.w).toBeGreaterThan(0);
  });

  /**
   * PR-08b｜Queue 明令「第一版只使用已有 cannon / spear / hammer」的**可执行判据**：
   * 用**真实校验器**逐件确认「三个选项都能真的发出去」，
   * 而不是靠注释保证 —— 内容（能量 / 挂点）一变，这里立刻红灯。
   */
  it('PR-08b 三条候选在默认车上**逐件**都能合法装备（三选一里没有废选项）', () => {
    const base = makeStarterDraft(PLAYER_BODY_DEF_ID, registry);
    const cap = registry.bodies.get(PLAYER_BODY_DEF_ID)!.energyCapacity;
    for (const id of REWARD_CHOICE_IDS) {
      expect(equippableOnCurrentVehicle(id), `${id} 必须能装在当前车上`).toBe(true);
      const draft = {
        ...base,
        functionalSelections: { ...base.functionalSelections, [WEAPON_SLOT]: id },
      };
      const snap = buildSnapshotFromDraft(draft, registry, `pr08b-${id}`);
      const check = validateSnapshot(snap, registry);
      expect(check.valid, `${id} → ${check.errors.join('；')}`).toBe(true);
      const energy = computeEnergy(snap, registry).energy;
      expect(energy, `${id} 必须在能量上限内`).toBeLessThanOrEqual(cap);
    }
  });
});

// ============================================================================
describe('PRODUCT-LOOP-R2-A｜B. 产品地址与参数：只有一个真源', () => {
  it('PR-07 出发地址带 `run` + `choices` + `home`；三条候选各自往返闭合', () => {
    const token = newRunToken(1700000000000, 0.5);
    const href = buildAdventureHref(token, buildRewardChoicePayload(token, specs(4), FUSE_STACK));
    expect(href.startsWith(ADVENTURE_HREF)).toBe(true);
    const q = new URLSearchParams(href.split('?')[1]);
    expect(q.get(RUN_PARAM)).toBe(token);

    /*
      ⚠️ R2-A 的**契约变更**（不是丢字段）：R1-B 的 top-level `back` 已不存在，
      终点三条候选的领奖地址被整份装进 `choices`。
      因此「往返闭合」要逐条验，而不是取一个参数。
    */
    const payload = payloadOf(href);
    expect(payload.stack, '满 stack 阈值必须由产品侧给全（Lab 不自造 5）').toBe(FUSE_STACK);
    expect(payload.choices.map((c) => c.defId)).toEqual([...REWARD_CHOICE_IDS]);
    expect(q.get('reward'), '出发地址不得带裸 `reward=` 参数').toBeNull();
    for (const c of payload.choices) {
      expect(c.star).toBe(GROWTH_STAR);
      expect(c.href).toBe(buildClaimHref(token, c.defId));
      expect(c.href.startsWith(HOME_HREF)).toBe(true);
      expect(parsePendingClaim(c.href.slice(c.href.indexOf('?')))).toEqual({
        runToken: token,
        rewardDefId: c.defId,
      });
    }
    // PRODUCT-LOOP-R1-D：第三个参数 = 失败回程地址（**纯首页**，与候选地址是两类出口）
    expect(q.get(HOME_PARAM)).toBe(HOME_HREF);
  });

  /**
   * PR-07b｜「失败不发永久奖励」在地址层上的机器判据：失败出口拿到的地址一旦能被
   * `parsePendingClaim` 解析出 `{runToken, rewardDefId}`，首页就会执行一次入库 ⇒ 失败也发奖。
   */
  it('PR-07b 失败回程 ≠ 候选地址：`home` 解析不出领奖请求（失败链结构性拿不到奖励）', () => {
    const token = newRunToken(1700000000000, 0.5);
    const search = buildAdventureHref(token, buildRewardChoicePayload(token, specs(4), FUSE_STACK)).split('?')[1] ?? '';
    const payload = payloadOf(`?${search}`);
    // ① 两侧参数名同值（改单边 = 静默断链）
    expect(RUN_FAIL_PARAM).toBe('home');
    expect(RUN_FAIL_PARAM).toBe(HOME_PARAM);
    // ② Lab 侧解析出来的就是产品侧给的那个纯首页地址
    const ret = parseRunFailReturn(`?${search}`);
    expect(ret).toEqual({ href: HOME_HREF });
    expect(ret!.href).not.toContain(`${REWARD_PARAM}=`);
    expect(ret!.href).not.toContain(`${RUN_PARAM}=`);
    // ③ **关键**：拿这个地址回首页，首页**不会**入库（解析不出领奖请求）
    expect(parsePendingClaim(ret!.href.slice(ret!.href.indexOf('?')))).toBeNull();
    expect(parsePendingClaim('')).toBeNull();
    // ④ 反过来：候选地址也不能被当成失败出口（两类出口互不通用）
    for (const c of payload.choices) {
      expect(parseRunFailReturn(`?${c.href.split('?')[1]}`)).toBeNull();
    }
    // ⑤ 同一条链接里两类地址都在，且确确实实不同
    for (const c of payload.choices) expect(c.href).not.toBe(ret!.href);
  });

  it('PR-07c 候选出口与失败结算互斥：同一份产品上下文里只有 COMPLETE 拿得到候选', () => {
    const token = newRunToken(1700000000000, 0.5);
    const href = buildAdventureHref(token, buildRewardChoicePayload(token, specs(4), FUSE_STACK));
    const search = href.slice(href.indexOf('?'));
    const reward = parseRunRewardChoices(search)!;
    const ret = parseRunFailReturn(search)!;
    const ctx = runPageContext();

    // ① COMPLETE：候选齐备、**没有**失败结算
    const done = buildPriorCompletedRun(ctx);
    expect(runComplete(done)).toBe(true);
    expect(runRewardChoiceViews(done, reward).length).toBe(REWARD_CHOICE_IDS.length);
    expect(runSelectedClaim(done, reward, REWARD_CHOICE_IDS[0])).not.toBeNull();
    expect(runFailSettlementNow(done, ret)).toBeNull();

    // ② FAILED（真实推进到第一场战斗后被打死）：有失败结算、**没有**候选
    //    —— 即使这一局带着完整的产品奖励上下文（Queue 必改 5）
    let s = createRunPageState(ctx);
    for (let i = 0; i < 6 && s.phase !== 'BATTLE'; i++) s = pressRunAction(s, ctx);
    expect(s.phase).toBe('BATTLE');
    const failed = finishRunBattle(s, { winner: 'B', endReason: 'hp', playerHp: 0, enemyHp: 900, steps: 300 });
    expect(failed.phase).toBe('FAILED');
    expect(runRewardChoiceViews(failed, reward)).toEqual([]);
    for (const id of REWARD_CHOICE_IDS) expect(runSelectedClaim(failed, reward, id)).toBeNull();
    expect(runFailSettlementNow(failed, ret)!.href).toBe(HOME_HREF);
  });

  it('PR-08 参数不全 / 候选全坏 ⇒ 不进产品模式（既有路径逐像素不变的结构前提）', () => {
    const token = newRunToken(1700000000000, 0.5);
    // parsePendingClaim（首页侧）
    expect(parsePendingClaim('')).toBeNull();
    expect(parsePendingClaim('?run=')).toBeNull();
    expect(parsePendingClaim(`?run=${token}`)).toBeNull();
    expect(parsePendingClaim(`?${REWARD_PARAM}=laser`)).toBeNull();
    // parseRunRewardChoices（Run Page 侧）：缺一不可 / 坏载荷 → null
    expect(parseRunRewardChoices('')).toBeNull();
    expect(
      parseRunRewardChoices(
        `?${CHOICES_PARAM}=${encodeURIComponent(JSON.stringify(buildRewardChoicePayload(token, specs(1), FUSE_STACK)))}`,
      ),
      '缺 run',
    ).toBeNull();
    expect(parseRunRewardChoices(`?${RUN_PARAM}=${token}`), '缺 choices').toBeNull();
    expect(parseRunRewardChoices(`?${RUN_PARAM}=${token}&${CHOICES_PARAM}=`)).toBeNull();
    expect(parseRunRewardChoices(`?${RUN_PARAM}=${token}&${CHOICES_PARAM}=不是JSON`)).toBeNull();
    expect(parseRunRewardChoices(searchOf(token, { stack: FUSE_STACK, choices: [] }))).toBeNull();
    expect(parseRunRewardChoices(searchOf(token, { stack: FUSE_STACK })), '没有 choices 字段').toBeNull();
    // 候选**全坏** → null（不画假奖励）
    expect(
      parseRunRewardChoices(
        searchOf(token, {
          stack: FUSE_STACK,
          choices: [
            { defId: 'nope', star: 1, countBefore: 0, href: './home.html?x=1' },
            { defId: 'pushRod', star: 1, countBefore: 0, href: './home.html?x=1' },
            { defId: 'cannon', star: 1, countBefore: 0, href: '' },
          ],
        }),
      ),
    ).toBeNull();
  });

  it('PR-08c 部分坏 ⇒ 保留好的、坏条数**如实上报**（不静默吞掉产品侧的 bug）', () => {
    const token = newRunToken(1700000000000, 0.5);
    const set = parseRunRewardChoices(
      searchOf(token, {
        stack: FUSE_STACK,
        choices: [
          { defId: 'cannon', star: GROWTH_STAR, countBefore: 4, href: buildClaimHref(token, 'cannon') },
          { defId: 'nope', star: GROWTH_STAR, countBefore: 0, href: buildClaimHref(token, 'cannon') },
          { defId: 'spear', star: GROWTH_STAR, countBefore: 1, href: buildClaimHref(token, 'spear') },
        ],
      }),
    );
    expect(set).not.toBeNull();
    expect(set!.choices.map((c) => c.defId)).toEqual(['cannon', 'spear']);
    expect(set!.dropped, '坏了一条就必须被看见').toBe(1);
    // 阈值非法 → 不再是「满 stack 阈值」，但仍保留候选（读数不会被编造）
    const badStack = parseRunRewardChoices(
      searchOf(token, {
        stack: 0,
        choices: [{ defId: 'cannon', star: 1, countBefore: 0, href: buildClaimHref(token, 'cannon') }],
      }),
    );
    expect(badStack).not.toBeNull();
    expect(badStack!.stack, '非法阈值落到 0（页面据此显示 0/0，不编造一个 5）').toBe(0);
  });

  it('PR-09 token 由首页每次挂载生成：确定 + 互不相同', () => {
    expect(newRunToken(1700000000000, 0.5)).toBe(newRunToken(1700000000000, 0.5));
    expect(newRunToken(1700000000000, 0.5)).not.toBe(newRunToken(1700000000001, 0.5));
    expect(newRunToken(1700000000000, 0.5)).not.toBe(newRunToken(1700000000000, 0.25));
    // 三条候选共用同一个 token ⇒ 「本局只能领一次」在地址层就成立了
    const links = buildRewardChoiceLinks('run-shared', specs(0));
    expect(new Set(links.map((l) => parsePendingClaim(l.href.slice(l.href.indexOf('?')))!.runToken)).size).toBe(1);
  });
});

// ============================================================================
describe('PRODUCT-LOOP-R2-A｜C. 领奖：一次、真入库、数量累积', () => {
  it('PC-10 第一次领取：该 stack +1 落在**正式** key 上，且只新增一个 key（验收 ③）', () => {
    expect(allKeys()).toEqual([]);
    expect(isRunClaimed('run-test-1')).toBe(false);

    // 先建一份「新账号」的库存（cannon ×4），再模拟玩家选了 cannon
    const draft = loadEquippedDraft();
    const growth = openGrowthSession(draft);
    expect(growth.freshProfile, '此刻磁盘上还什么都没有 ⇒ 新账号').toBe(true);
    expect(getCount(growth.inv, 'cannon', GROWTH_STAR)).toBe(4);

    const out = claimRunReward({ runToken: 'run-test-1', rewardDefId: 'cannon' });
    expect(out.ok).toBe(true);
    expect(out.reason).toBeNull();
    expect(out.grant?.defId).toBe('cannon');
    expect(out.grant?.countAfter, '4 → 5（Queue 验收 ③）').toBe(5);

    // 真的写进了正式库存 key（不是页面自建的第二套库存）
    /*
      ⚠️ PRODUCT-LOOP-R2-RECOVERY（必改 1）在这里**加了一个 key**：一次性 onboarding
         的版本标记 `strongfruit.r2Onboarding.v1`（上面那次 `openGrowthSession` 会落它）。
         断言仍是**闭集**（不是「包含」）⇒ 多写任何一个 key 都会红，没有放宽。
      ⚠️ PRODUCT-LOOP-R2-VALIDATION-STATE-RESEED-R1 又加了**第二个**：版本化一次性 reseed 的
         标记 `strongfruit.r2Reseed.v1`。**仍然只是白名单 +1，闭集语义一字未改** ——
         第三个 key 出现时这一条照样红。
    */
    expect(allKeys()).toEqual([INV_KEY, PROFILE_CLAIMS_KEY, R2_ONBOARDING_KEY, R2_RESEED_KEY].sort());
    const inv = loadInventoryRaw();
    expect(inv, '库存必须真的落盘').toBeTruthy();
    expect(getCount(inv!, 'cannon', GROWTH_STAR)).toBe(5);
    // 账本记录本局（幂等键）
    expect(isRunClaimed('run-test-1')).toBe(true);
    expect(claimedRunCount()).toBe(1);
    expect(readClaimLedger().grantedRunIds).toEqual(['run-test-1']);
  });

  it('PC-11 同一 Run **换一件也算重复领取**：拒绝且零副作用（验收 ⑤）', () => {
    openGrowthSession(loadEquippedDraft());
    const first = claimRunReward({ runToken: 'run-test-1', rewardDefId: 'cannon' });
    expect(first.ok).toBe(true);
    const invAfterFirst = store.getItem(INV_KEY);
    const ledgerAfterFirst = store.getItem(PROFILE_CLAIMS_KEY);

    // ① 同一件再领：拒
    // ② **换一件**再领（玩家在终点改主意 / 两个标签页各选一件）：同样拒
    for (const defId of ['cannon', 'spear', 'hammer']) {
      const again = claimRunReward({ runToken: 'run-test-1', rewardDefId: defId });
      expect(again.ok, `同 token 再领 ${defId} 必须被拒绝`).toBe(false);
      expect(again.reason).toBe('already-claimed');
      expect(again.grant).toBeNull();
    }
    // 库存与账本逐字节不变（既没加副本，也没多加一条记录）
    expect(store.getItem(INV_KEY)).toBe(invAfterFirst);
    expect(store.getItem(PROFILE_CLAIMS_KEY)).toBe(ledgerAfterFirst);
    expect(getCount(loadInventoryRaw()!, 'cannon', GROWTH_STAR)).toBe(5);
    expect(claimedRunCount()).toBe(1);
  });

  it('PC-12 新的一局（新 token）才再发一次；重复获得**累积数量**（Queue 必改 1 的目的）', () => {
    openGrowthSession(loadEquippedDraft());
    claimRunReward({ runToken: 'run-1', rewardDefId: 'cannon' });
    const second = claimRunReward({ runToken: 'run-2', rewardDefId: 'cannon' });
    expect(second.ok).toBe(true);
    expect(second.grant?.countAfter).toBe(6);
    expect(claimedRunCount()).toBe(2);
    expect(getCount(loadInventoryRaw()!, 'cannon', GROWTH_STAR)).toBe(6);
  });

  it('PC-13 选择**其它** Weapon 只加对应 stack（验收 ④）', () => {
    openGrowthSession(loadEquippedDraft());
    const base = { cannon: 4, spear: 1, hammer: 1 };
    const inv0 = loadInventoryRaw()!;
    for (const [defId, before] of Object.entries(base)) {
      expect(getCount(inv0, defId, GROWTH_STAR), `${defId} 的初始读数`).toBe(before);
    }
    // 第一局选 spear：只有 spear 变，其它两件一个字节都不动
    const out = claimRunReward({ runToken: 'run-spear', rewardDefId: 'spear' });
    expect(out.ok).toBe(true);
    expect(out.grant?.countAfter).toBe(2);
    const inv1 = loadInventoryRaw()!;
    expect(getCount(inv1, 'cannon', GROWTH_STAR), '没选的件不许动').toBe(4);
    expect(getCount(inv1, 'hammer', GROWTH_STAR), '没选的件不许动').toBe(1);
    expect(getCount(inv1, 'spear', GROWTH_STAR)).toBe(2);
    // 第二局选 hammer：同理
    claimRunReward({ runToken: 'run-hammer', rewardDefId: 'hammer' });
    const inv2 = loadInventoryRaw()!;
    expect(getCount(inv2, 'hammer', GROWTH_STAR)).toBe(2);
    expect(getCount(inv2, 'cannon', GROWTH_STAR)).toBe(4);
    expect(getCount(inv2, 'spear', GROWTH_STAR)).toBe(2);
  });

  it('PC-14 非法输入一律拒收且零副作用（含空 token / 未知部件 / Gadget）', () => {
    expect(claimRunReward(null).reason).toBe('no-run-token');
    expect(claimRunReward({ runToken: '', rewardDefId: 'cannon' }).reason).toBe('no-run-token');
    expect(claimRunReward({ runToken: 'run-x', rewardDefId: 'nope' }).reason).toBe('not-official');
    expect(claimRunReward({ runToken: 'run-x', rewardDefId: 'pushRod' }).reason).toBe('not-weapon');
    expect(allKeys(), '全部失败路径都不许写盘').toEqual([]);
    expect(claimedRunCount()).toBe(0);
    // 判据本身对真实数据成立：正式部件在 frontMass 上全部合法；未知部件不合法
    for (const p of [...registry.functionals.keys()].filter((id) => isOfficialPart(id))) {
      expect(equippableOnCurrentVehicle(p), `${p} 应可装备`).toBe(true);
    }
    expect(equippableOnCurrentVehicle('doesNotExist'), '未知部件装不上').toBe(false);
  });

  it('PC-15 重载即状态仍在：两次独立调用 = 两次独立读盘（验收 ⑦）', () => {
    openGrowthSession(loadEquippedDraft());
    claimRunReward({ runToken: 'run-persist', rewardDefId: 'cannon' });
    // 模拟 reload：不持有任何内存引用，重新从 store 读
    expect(isRunClaimed('run-persist')).toBe(true);
    expect(getCount(loadInventoryRaw()!, 'cannon', GROWTH_STAR)).toBe(5);
    const again = claimRunReward({ runToken: 'run-persist', rewardDefId: 'cannon' });
    expect(again.reason).toBe('already-claimed');
    // 库里已经有这件武器 ⇒ Garage 列表（weaponEntries）会把它列出来并带上真实读数
    const draft = loadEquippedDraft();
    expect(draft.bodyDefId).toBe(PLAYER_BODY_DEF_ID);
    const entry = weaponEntries(loadInventoryRaw()!).find((w) => w.defId === 'cannon');
    expect(entry, 'Garage 必须能看到这件').toBeTruthy();
    expect(entry!.count).toBe(5);
    expect(entry!.stackText, '满 stack 显示 5/5（Queue「Garage 最小显示」）').toBe('5/5');
  });

  /**
   * PC-16｜阈值真源：`playerGrowth.FUSE_STACK` 必须等于 **core 自己的合成规则**。
   * 不靠注释：core 若改消耗量，这里立刻红灯（Queue B 做合成时两处必然漂移的那条隐患被钉死）。
   */
  it('PC-16 FUSE_STACK 就是 core 的合成消耗量（不是产品侧另写的一个 5）', () => {
    const inv = defaultInventory();
    expect(canFuse(inv, 'cannon', GROWTH_STAR, null).need).toBe(FUSE_STACK);
    expect(stackThreshold(inv, 'cannon', GROWTH_STAR)).toBe(FUSE_STACK);
    // 阈值与「这件装没装在车上」无关（`stackThreshold` 传 null build 的理由）
    expect(stackThreshold(inv, 'spear', GROWTH_STAR)).toBe(FUSE_STACK);
    expect(stackThreshold(inv, 'hammer', GROWTH_STAR)).toBe(FUSE_STACK);
  });
});

// ============================================================================
describe('PRODUCT-LOOP-R2-A｜D. 终点态：只有 COMPLETE 才有候选', () => {
  it('PR-15 COMPLETE + 产品载荷 → 候选齐备，且每张卡各自的出口都由产品数据给出', () => {
    const s = completedState();
    expect(runComplete(s)).toBe(true);
    const views = runRewardChoiceViews(s, REWARD_CTX);
    expect(views.length).toBe(REWARD_CHOICE_IDS.length);
    expect(views.map((v) => v.defId)).toEqual([...REWARD_CHOICE_IDS]);
    // 每张卡的读数来自产品侧给的那份载荷（`countBefore` = 4）
    for (const v of views) {
      expect(v.countBefore).toBe(4);
      expect(v.previewText).toBe('4 → 5');
      expect(v.reachesThreshold).toBe(true);
      /*
        ★ PRODUCT-LOOP-R2-RECOVERY（必改 2）｜第二行 = **成长口径**。
          R2-A 时这一行是「库存多了一个」（`×4 → ×5`），真人反馈 ④ 判明它让人
          「完全找不到 4/5 / 5/5 的真实成长过程」⇒ 本 Queue 授权改成成长口径。
          两侧都用**原始计数**（不夹到阈值），阈值来自产品侧给的 `stack`。
      */
      expect(v.progressText, '必改 2：当前 X/5 → 领取后 Y/5').toBe('当前 4/5 → 领取后 5/5');
      expect(v.stackLimit, '阈值的真源是产品侧给的 stack').toBe(FUSE_STACK);
    }
    // 选中那一条 → 出口是**它自己的**地址，且 token 是本局的
    const pick = REWARD_CHOICE_IDS[0];
    const claim = runSelectedClaim(s, REWARD_CTX, pick);
    expect(claim).toEqual({
      defId: pick,
      runToken: 'run-test-1',
      href: buildClaimHref('run-test-1', pick),
    });
    /*
      ★ PRODUCT-LOOP-P0-SETTLEMENT-SINGLE-CTA-AND-AUDIO-LIFECYCLE（必改 1 / 2）｜
        底栏唯一 CTA 的出口**与上面那个对象完全一致** —— 出口换了触发方式（按按钮而不是
        点卡片），但**没有**换规则：同一个候选表、同一个 token、同一条 `href`。
    */
    expect(runSingleRewardClaim(s, REWARD_CTX)).toEqual(claim);
    // 每条候选的出口互不相同（「选哪条」是真选择；条数由产品决策给）
    const hrefs = REWARD_CHOICE_IDS.map((id) => runSelectedClaim(s, REWARD_CTX, id)!.href);
    expect(new Set(hrefs).size).toBe(REWARD_CHOICE_IDS.length);
    // 不在候选里的件（spear / hammer：仍有库存、仍可装备，但**当前不进奖励池**）
    expect(runSelectedClaim(s, REWARD_CTX, 'spear'), '未入池的件拿不到出口').toBeNull();
    expect(runSelectedClaim(s, REWARD_CTX, 'hammer'), '未入池的件拿不到出口').toBeNull();
    /*
      文案必须是**动作 / 承诺**，不是已完成的状态描述。
      ⚠️ 必改 1：卡片纯展示 ⇒ 标题/说明不能再暗示「选一件 / 选中的那件」，
         否则就是「引导玩家去做一个这一屏上不存在的动作」。
      ⚠️ 必改 2：底栏唯一 CTA 的文案 = 「领取并返回」，且它**是动作**；处理中的
         「领取中…」只表达状态，不承诺结果（入库仍发生在导航之后）。
    */
    expect(RUN_REWARD_TITLE).toBe('本局奖励');
    expect(RUN_REWARD_NOTE).toBe('领取后进入你的车库');
    for (const t of [RUN_REWARD_TITLE, RUN_REWARD_NOTE]) {
      expect(t.includes('完成'), `${t} 不得是状态描述`).toBe(false);
      expect(t.includes('选'), `${t} 不得暗示「选择」（本屏没有可选项、卡片纯展示）`).toBe(false);
    }
    expect(RUN_CLAIM_AND_RETURN_LABEL).toBe('领取并返回');
    expect(RUN_CLAIMING_LABEL).toBe('领取中…');
  });

  it('PR-15b 必改 1｜奖励卡**不再是入口**：卡片纯展示，底栏 CTA 是唯一出口', () => {
    const s = completedState();
    // 同一份载荷 ⇒ 底栏 CTA 拿到的就是「那件固定奖励」的请求（页面里没有第二个真源）
    const viaCta = runSingleRewardClaim(s, REWARD_CTX);
    expect(viaCta).toEqual(runSelectedClaim(s, REWARD_CTX, REWARD_CHOICE_IDS[0]));
    // 三道闸门与 `runSelectedClaim` 一致：没有载荷 / 不是 COMPLETE ⇒ 拿不到请求
    expect(runSingleRewardClaim(s, null)).toBeNull();
    expect(runSingleRewardClaim(s, undefined)).toBeNull();
    expect(runSingleRewardClaim(failedState(), REWARD_CTX), 'FAILED 结构上拿不到').toBeNull();
    // 载荷里一条候选都没有（理论上解析阶段就已 `null`）⇒ 同样拿不到，不会「点了没反应」
    expect(
      runSingleRewardClaim(s, { runToken: 'r', stack: FUSE_STACK, choices: [], dropped: 0 }),
    ).toBeNull();
  });

  it('PR-16 FAILED **结构上**拿不到 3选1（必改 5：无奖励选择 / 无 count 变化 / 无 Profile 增长）', () => {
    const s = failedState();
    expect(runComplete(s)).toBe(false);
    expect(runRewardChoiceViews(s, REWARD_CTX)).toEqual([]);
    for (const id of REWARD_CHOICE_IDS) expect(runSelectedClaim(s, REWARD_CTX, id)).toBeNull();
    // 动一下「点击」也不该写盘：候选恒空 ⇒ 页面结构上没有可点的东西
    expect(allKeys()).toEqual([]);
    expect(claimedRunCount()).toBe(0);
  });

  it('PR-17 没有产品载荷 ⇒ 恒空（既有验证 / 玩家路径零变化）', () => {
    const s = completedState();
    expect(runRewardChoiceViews(s, null)).toEqual([]);
    expect(runRewardChoiceViews(s, undefined)).toEqual([]);
    expect(runRewardChoiceViews(s, { runToken: 'r', stack: FUSE_STACK, choices: [], dropped: 0 })).toEqual([]);
    expect(runSelectedClaim(s, null, 'cannon')).toBeNull();
    // 「点了一个不在候选里的件」这类接线 bug：必须拒（不是顺手发一件）
    expect(runSelectedClaim(s, REWARD_CTX, 'laser')).toBeNull();
    expect(runSelectedClaim(s, REWARD_CTX, 'nope')).toBeNull();
    expect(runSelectedClaim(s, REWARD_CTX, 'pushRod')).toBeNull();
  });
});

// ============================================================================
describe('PRODUCT-LOOP-R2-A｜E. 源码守卫（本 Queue 的边界必须结构性成立）', () => {
  it('PR-20 UI 不得直接读写 localStorage / platform.storage', () => {
    for (const f of ['homePage.ts', 'homeMain.ts']) {
      const code = strip(readProduct(f));
      expect(code.includes('localStorage'), `${f} 不得直接碰 localStorage`).toBe(false);
      expect(code.includes('sessionStorage'), `${f} 不得直接碰 sessionStorage`).toBe(false);
      expect(code.includes('platform.storage'), `${f} 不得直接碰 platform.storage`).toBe(false);
      expect(code.includes('STORAGE_KEY'), `${f} 不得自建 key`).toBe(false);
    }
    const html = readFileSync(join(REPO_ROOT, 'home.html'), 'utf8');
    // 页面模板里也不许有脚本级存储访问（唯一脚本就是入口壳）
    expect(html.includes('localStorage')).toBe(false);
    // 持久化只发生在 Repository 内（它复用既有模块：buildPersistence / partInventory / saveVersion）
    const repo = strip(readProduct('playerProfile.ts'));
    expect(repo.includes('platform.storage')).toBe(true);
    expect(repo.includes("from '../core/partInventory'")).toBe(true);
    expect(repo.includes("from '../core/saveVersion'")).toBe(true);
    /*
      ⚠️ R2-A 新增的成长入口同样不许自己碰存储：它只能经 core 的
      `loadInventoryRaw` / `saveInventory`（= 与旧横屏游戏共用同一份库存）。
    */
    const growth = strip(readProduct('playerGrowth.ts'));
    for (const banned of ['localStorage', 'sessionStorage', 'platform.storage']) {
      expect(growth.includes(banned), `playerGrowth.ts 不得直接碰 ${banned}`).toBe(false);
    }
    expect(growth.includes("from '../core/partInventory'")).toBe(true);
    expect(growth.includes('saveInventory'), '成长写入必须经 core 的 saveInventory').toBe(true);
    /*
      ⚠️ PRODUCT-LOOP-R2-B｜R2-A 在这里断言过「成长**不做**合成：不得出现任何消耗 / 升星调用」。
         本 Queue 的交付物恰恰就是合成 ⇒ 那条禁令**由 Queue 取代**，换成的不是「删掉守卫」，
         而是四条**更具体**的约束（禁止面收窄、要求面变严）：
    */
    for (const banned of ['fuseSameStar', 'fuseCategoryMaterials', 'grantAllNewMovements']) {
      expect(
        growth.includes(banned),
        `playerGrowth.ts 不得复用旧横屏的融合规则：${banned}（两边对「已装备副本」的语义相反）`,
      ).toBe(false);
    }
    for (const banned of ['金币', 'gold', '手续费', '品质', 'rarity']) {
      expect(growth.includes(banned), `playerGrowth.ts 不得出现经济项：${banned}`).toBe(false);
    }
    // 必改 5：一次调用只做**一次** 5 合 1（材料消耗只有一处 ⇒ 结构上做不出连锁 / 批量）
    expect(
      growth.split('consume(inv, partId, s, FUSE_STACK)').length - 1,
      '材料消耗只有一处 ⇒ 不连锁、不批量',
    ).toBe(1);
    // 必改 1：合成对 partId **泛化** —— 源码里不得出现针对具体武器的相等判断
    for (const id of ['cannon', 'spear', 'hammer', 'laser']) {
      expect(growth.includes(`=== '${id}'`), `合成不得对 ${id} 写特例`).toBe(false);
    }
  });

  it('PR-21 产品地址只有一个真源，Lab 侧一个都没有（Lab 也 import 不了产品模块）', () => {
    const reward = strip(readProduct('runReward.ts'));
    expect(reward.split("'./run-page.html'").length - 1).toBe(1);
    expect(reward.split("'./home.html'").length - 1).toBe(1);
    for (const f of ['runPage.ts', 'runMain.ts', 'runProductReward.ts']) {
      const code = strip(readLab(f));
      for (const t of ['./run-page.html', './home.html', 'home.html?', 'run-page.html?']) {
        expect(code.includes(t), `${f} 不得出现产品地址 "${t}"`).toBe(false);
      }
    }
    // Lab 白名单（R22a）结构上不包含任何产品模块 ⇒ 写不进正式存档、也拿不到产品常量
    for (const f of ['runProductReward.ts', 'runMain.ts']) {
      const code = strip(readLab(f));
      expect(code.includes("'../product") && code.includes("'../product/"), `${f} 不得 import 产品模块`).toBe(false);
      expect(code.includes('buildPersistence'), `${f} 不得碰正式存档写入`).toBe(false);
      expect(code.includes('saveInventory'), `${f} 不得碰库存写入`).toBe(false);
      // ⚠️ 满 stack 阈值也必须由产品侧经 URL 给全 —— Lab 里不许出现第二个 `5`
      expect(code.includes('FUSE_STACK'), `${f} 不得引用产品侧阈值常量`).toBe(false);
    }
  });

  it('PR-22 奖励卡绘制**不引入新的入账色**，且绘制 / 命中 / 出口 / 探针**四处同源**', () => {
    const src = strip(readLab('runPage.ts'));
    const start = src.indexOf('private drawRewardChoiceCards(');
    expect(start, 'runPage.ts 必须有 drawRewardChoiceCards').toBeGreaterThan(0);
    const body = src.slice(start, src.indexOf('\n  private ', start + 10));
    // 只允许复用 COLORS.*，不许出现十六进制字面量 / rgba
    expect(body.includes('#'), '奖励卡不得写死颜色（必须复用 COLORS）').toBe(false);
    expect(body.includes('rgba(')).toBe(false);
    /*
      四处同源（本项目的铁律）：`rewardChoiceViewsNow()` 是**唯一**判据，
      绘制 / 底栏可用性 / 底栏文案 / 命中 / 探针都经它 ⇒
      「画的是 A、领的是 B」「探针说有卡、屏幕上没有」结构上不可能。
      ⚠️ PRODUCT-LOOP-P0-SETTLEMENT-SINGLE-CTA-AND-AUDIO-LIFECYCLE（必改 1）之后
         **卡片不再参与命中** ⇒ 同源调用点里不再有「卡片命中」这一路。
    */
    expect(src.split('private rewardChoiceViewsNow(').length - 1).toBe(1);
    expect(
      src.split('this.rewardChoiceViewsNow()').length - 1,
      '至少 4 处同源调用（绘制 / 命中 / actionEnabled / actionLabel / 探针）',
    ).toBeGreaterThanOrEqual(4);
    expect(src.includes('this.drawRewardChoiceCards(ctx);'), '绘制入口必须存在').toBe(true);
    /*
      ★ 必改 2「hit rect 与绘制完全一致」的机器证据：**同一个函数**。
        绘制在 `drawActionButton()` 里取 `runActionButtonRect()`，命中在奖励分支里取**同一个**；
        并且卡片矩形**不再**出现在命中路径上（卡片纯展示）。
    */
    const drawFn = src.indexOf('private drawActionButton(');
    expect(drawFn, 'drawActionButton 必须存在').toBeGreaterThan(-1);
    expect(
      src.indexOf('const btn = runActionButtonRect();', drawFn),
      '绘制必须取 `runActionButtonRect()`',
    ).toBeGreaterThan(drawFn);
    expect(
      src.includes('if (hit(runActionButtonRect(), p)) {'),
      '命中必须取**同一个** `runActionButtonRect()`（hit rect 与绘制一致）',
    ).toBe(true);
    // 卡片纯展示 ⇒ 命中路径里不得再出现卡片矩形
    expect(
      src.includes('const rects = runRewardChoiceRects(choiceViews.length);'),
      '卡片命中分支必须已删除（必改 1 / 6：卡片纯展示）',
    ).toBe(false);
    // 出口同理：唯一路径是 `runSingleRewardClaim()`（底栏 CTA），不再是「点了哪张卡」
    expect(src.includes('runSingleRewardClaim(this.state, this.opts.rewardChoices)')).toBe(true);
    expect(
      src.includes('runSelectedClaim(this.state, this.opts.rewardChoices, choiceViews[i].defId)'),
      'card-only claim assumption 必须已删除（必改 6）',
    ).toBe(false);
    // 旧单件出口**必须已经不存在**（否则就是两份真源并存）
    for (const gone of ['productClaimNow', 'rewardCardNow', 'runRewardCardRect()']) {
      expect(src.includes(gone), `runPage.ts 不得残留旧单件出口：${gone}`).toBe(false);
    }
  });

  it('PR-23 验收 ⑨：奖励展示与 Garage 用的是**同一份**库存（不存在第二套数据）', () => {
    openGrowthSession(loadEquippedDraft());
    claimRunReward({ runToken: 'run-garage', rewardDefId: 'cannon' });
    const inv = loadInventoryRaw()!;
    expect(getCount(inv, 'cannon', GROWTH_STAR)).toBe(5);
    // Garage 侧的唯一数据源就是这份库存
    const a = strip(readProduct('playerLoadout.ts'));
    expect(a.includes("from '../core/partInventory'")).toBe(true);
    // 页面侧不写死候选 / 奖励 id（候选来自产品策略常量，名称来自内容库）
    const page = strip(readProduct('homePage.ts'));
    for (const id of ['cannon', 'spear', 'hammer']) {
      expect(page.includes(`'${id}'`), `页面不得写死候选 id：${id}`).toBe(false);
    }
    expect(page.includes('REWARD_CHOICE_IDS'), '候选必须来自策略常量').toBe(true);
  });

  it('PR-24 成长会话的顺序**结构性**正确：先判 fresh 再取库存（写反 = 种子静默失效）', () => {
    const growth = strip(readProduct('playerGrowth.ts'));
    const fn = growth.slice(growth.indexOf('export function openGrowthSession('));
    const freshAt = fn.indexOf('isFreshProfile()');
    const invAt = fn.indexOf('playerInventory(draft)');
    expect(freshAt, 'openGrowthSession 必须先判 fresh').toBeGreaterThan(0);
    expect(invAt, 'openGrowthSession 必须自己取库存').toBeGreaterThan(0);
    expect(freshAt, '① 判 fresh 必须在 ② 取库存之前').toBeLessThan(invAt);
    // 签名只有 draft（不再收一份现成的 inv —— 那正是让人能写反顺序的形状）
    expect(/export function openGrowthSession\(draft: BuildDraft\)/.test(growth)).toBe(true);
    // 页面侧不许自己先 `playerInventory(draft)` 再开会话
    const page = strip(readProduct('homePage.ts'));
    expect(page.includes('openGrowthSession(draft)'), '页面必须用唯一的成长入口').toBe(true);
    // 页面侧**只**通过成长会话拿库存初始值（不再有一行裸的 playerInventory 初始化）
    expect(page.includes('let inv: PartInventory = growth.inv;')).toBe(true);
    // 种子只发新账号：已有存档的玩家不该被抬到 ×4；种子本身必须真的是「cannon ×4」
    const seed = FRESH_STACK_SEED.find((s) => s.partId === 'cannon');
    expect(seed, '新账号种子必须有 cannon').toBeTruthy();
    expect(seed!.star).toBe(GROWTH_STAR);
    expect(seed!.count, 'Queue 必改 3：fresh profile cannon = ★1 ×4').toBe(4);
  });

  it('PR-25 R2-B 禁止清单：不做经济 / 不复用旧横屏融合 / 合成只有唯一入口 / Lab 侧无合成', () => {
    // ① 经济 / 品质 / 手续费仍然一律不做（R2-B 一项都没解锁）
    for (const f of ['playerGrowth.ts', 'playerLoadout.ts', 'playerProfile.ts']) {
      const code = strip(readProduct(f));
      for (const banned of ['金币', 'gold', '手续费', '品质', 'rarity', 'rarityTier']) {
        expect(code.includes(banned), `${f} 不得出现禁止项：${banned}`).toBe(false);
      }
    }
    /*
      ⚠️ PRODUCT-LOOP-R2-RECOVERY（必改 2）**收窄**了候选池（3 → 1）。
         R2-A 这里断言「恰好三件且都在正式内容库里」；现在改成：
         ① 候选池**非空**；② 候选池是 `FULL_RUN_SUPPORTED_WEAPON_IDS` 的**子集**
            （= 只发这一局真的用得上的东西）；③ 未入池的件仍在正式内容库里
            （**保留内容、只是暂时不发**，不是删定义）。
    */
    expect(REWARD_CHOICE_IDS.length, '候选池不能为空').toBeGreaterThan(0);
    for (const id of REWARD_CHOICE_IDS) {
      expect(FULL_RUN_SUPPORTED_WEAPON_IDS, `${id} 必须在完整 Run 支持清单里`).toContain(id);
      expect(registry.functionals.get(id), `${id} 仍是正式内容`).toBeTruthy();
    }
    for (const id of ['spear', 'hammer']) {
      expect(REWARD_CHOICE_IDS, `${id} 当前退出奖励池`).not.toContain(id);
      expect(registry.functionals.get(id), `${id} 的定义**不许被删**（内容未完成 ≠ 物品不存在）`).toBeTruthy();
      expect(isOfficialPart(id), `${id} 仍在正式部件池里`).toBe(true);
    }
    /*
      ③ PRODUCT-LOOP-R2-B｜合成动作**只能有一个入口**（`playerGrowth.fuseStack`），
         规则（消耗 / 产出 / 落盘）不许洇进页面：页面必须**没有**任何直接改库存的调用。
         ⚠️ R2-A 曾经在这里禁止页面出现 `fuse` / `合成`；本 Queue 的必改 3 要求
            Garage 提供最小合成动作 ⇒ 守卫改成断言**分界线**（动作在、规则不在），
            而不是否定整件事。
    */
    const page = strip(readProduct('homePage.ts'));
    expect(page.includes('fuseStack'), '页面的合成动作必须走唯一入口 playerGrowth.fuseStack').toBe(true);
    for (const banned of ['consume(', 'addPart(', 'saveInventory', 'fuseSameStar', 'fuseCategoryMaterials']) {
      expect(page.includes(banned), `homePage.ts 不得自己改库存：${banned}`).toBe(false);
    }
    // ④ Run / Lab 侧仍然不产生「合成」语义（R2-B 一行都没碰 Lab）
    const lab = strip(readLab('runProductReward.ts')) + strip(readLab('runPage.ts'));
    for (const banned of ['fuse', 'Fuse', '合成', '升星']) {
      expect(lab.includes(banned), `Lab 侧不得做合成：${banned}`).toBe(false);
    }
  });

  it('PR-26 失败链仍然只有它自己的出口（R1-D 契约未被本 Queue 破坏）', () => {
    // 失败结算模块没有奖励能力
    const fail = strip(readLab('runFailSettlement.ts'));
    for (const t of ['reward', 'rewardChoice', 'claim']) {
      expect(fail.includes(t), `runFailSettlement.ts 不得涉及奖励：${t}`).toBe(false);
    }
    // 宿主里「产品出口」只有一个，且以 `rewardChoices` 为条件
    const host = strip(readLab('runMain.ts'));
    expect(host.split('onProductClaim:').length - 1).toBe(1);
    expect(host.includes('rewardChoices')).toBe(true);
    expect(host.split("location.assign(claim.href);").length - 1, '奖励导航只能有一次').toBe(1);
    // 页面里 COMPLETE 的候选分支与 FAILED 的结算分支**都先于**通用推进
    //（写反 = 点候选卡 / 点失败页 → 悄悄开新局，正是 R1-D 的 P0 根因）
    const page = strip(readLab('runPage.ts'));
    const choiceAt = page.indexOf('const choiceViews = this.rewardChoiceViewsNow();');
    const failAt = page.indexOf('const fail = this.failSettlementNow();');
    const pressAt = page.indexOf('this.apply(pressRunAction(');
    expect(choiceAt, '候选分支必须存在').toBeGreaterThan(0);
    expect(failAt, '失败分支必须存在').toBeGreaterThan(0);
    expect(pressAt, '通用推进必须存在').toBeGreaterThan(0);
    expect(choiceAt, '候选分支必须先于通用推进').toBeLessThan(pressAt);
    expect(failAt, '失败分支必须先于通用推进').toBeLessThan(pressAt);
  });

  it('PR-27 R2-C｜星级伤害只有一个真源：产品侧只许调 core，页面 / Lab 都不许自算', () => {
    /*
      Queue 必改 1 的**结构性**保证：星级 → 伤害这条关系只允许有**一个**实现
      （`core/buildSnapshot.starDamageMultiplier` / `starTierDamage`）。
      一旦产品侧或 Lab 侧自己写一个 ×1.25 之类的算法，卡面上承诺的数与战斗里打出的数
      就会各说各话 —— 那是玩家绝对会发现的 bug，所以这里把它钉在源码层。
    */
    const loadout = strip(readProduct('playerLoadout.ts'));
    expect(loadout.includes("from '../core/buildSnapshot'"), '产品侧必须从 core 取星级口径').toBe(true);
    expect(loadout.includes('starTierDamage'), '卡面伤害必须经 core 的星级曲线').toBe(true);
    expect(loadout.includes('weaponMainDamage'), '「主伤取哪个键」必须只有 core 一处').toBe(true);
    for (const banned of ['STAR_DAMAGE_STEP', 'STAR_DAMAGE_MAX_STAR', 'starDamageMultiplier']) {
      expect(loadout.includes(banned), `playerLoadout.ts 不得自建星级曲线：${banned}`).toBe(false);
    }
    // 页面：那一行只许来自 `weaponEntries()` 的字段（不许自己算）
    const home = strip(readProduct('homePage.ts'));
    expect(home.includes('w.damageText'), '卡面主属性必须来自 weaponEntries 的字段').toBe(true);
    for (const banned of ['starTierDamage', 'weaponMainDamage', 'starDamageMultiplier']) {
      expect(home.includes(banned), `homePage.ts 不得自己算伤害：${banned}`).toBe(false);
    }
    // Lab：本场武器的星级 / 伤害只许**回读真实装配**（RunBattleRuntime），不许 probe 自算
    const page = strip(readLab('runPage.ts'));
    expect(page.includes('playerWeapons'), 'probe 必须回读战斗运行时的真实武器读数').toBe(true);
    for (const banned of ['starTierDamage', 'starDamageMultiplier', 'weaponMainDamage']) {
      expect(page.includes(banned), `runPage.ts 不得自己算星级倍率：${banned}`).toBe(false);
    }
    // 正式战斗侧（ContactRouter）仍然只读 behaviorParams 的伤害字段：本 Queue 没碰它
    const router = readFileSync(
      join(REPO_ROOT, 'src', 'battle', 'contactRouter.ts'),
      'utf8',
    );
    expect(router.includes("behaviorParams?.projectileDamage"), '弹丸伤害仍读顶层字段').toBe(true);
  });
});
