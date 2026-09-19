/**
 * PRODUCT-LOOP-R1-B-RUN-REWARD-PERMANENT-INVENTORY｜targeted 测试。
 *
 * 覆盖 Queue 的八条验收里可离线钉死的那些：
 *   1  COMPLETE 出现真实奖励      → PR-15/16（真实状态机造 COMPLETE，出口存在）
 *   2  领取一次后进入 Inventory   → PR-09（真实存储：库存 +1 且落在正式 key 上）
 *   3  重复领取不能重复发奖       → PR-10（同 token 第二次 = `already-claimed`，库存不动）
 *   4  FAILED 不获得奖励          → PR-14（真实状态机造 FAILED：出口恒 null）
 *   5  返回首页后状态存在         → PR-09 + PR-06（领奖 URL 的数据流）
 *   6  Garage 能看到新部件        → PR-12（库存里多出一件 ⇒ A 段的 `weaponEntries` 自动列出）
 *   7  Reload 后状态保持          → PR-09/PR-10（两次独立调用 = 两次独立读盘）
 *   8  targeted + tsc + smoke     → 本文件 + 门禁（smoke = `e2e:product-reward`）
 *
 * 外加**结构守卫**（本 Queue 的边界必须能在源码层面被钉死）：
 *   - 奖励只复用已有正式 Weapon（不新增定义、不能是 Run Buff）；
 *   - UI 不得直接读写 localStorage（必改 1：必须封装在 Profile Repository 内）；
 *   - 产品地址只有**一个**真源，且 Lab 侧一个都没有（Lab 白名单结构上也 import 不了产品模块）；
 *   - 卡片绘制不引入新的像素账本颜色（既有路径逐像素不变）。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { registry } from '../src/core/content';
import { computeEnergy, validateSnapshot } from '../src/core/buildValidator';
import {
  defaultInventory,
  getCount,
  isOfficialPart,
  loadInventoryRaw,
  STARTER_PARTS,
} from '../src/core/partInventory';
import { buildSnapshotFromDraft, makeStarterDraft } from '../src/lab/buildEditorModel';
import { PLAYER_BODY_DEF_ID, WEAPON_SLOT, loadEquippedDraft } from '../src/product/playerLoadout';
import {
  ADVENTURE_HREF,
  HOME_HREF,
  REWARD_WEAPON_ID,
  buildAdventureHref,
  buildClaimHref,
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
  RUN_REWARD_CLAIM_LABEL,
  RUN_REWARD_TITLE,
  fitRewardIcon,
  parseRunProductReward,
  rewardColliderGeom,
  runProductClaimNow,
  runRewardCard,
} from '../src/lab/portraitBattleLab/runProductReward';
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

/** 内存版 localStorage（node 无原生；与 A 段测试同一模式）。 */
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

const REWARD_CTX = { defId: REWARD_WEAPON_ID, runToken: 'run-test-1', backHref: './home.html?x=1' };

// ============================================================================
describe('PRODUCT-LOOP-R1-B｜A. 奖励选择必须「实测」而不是「偏好」', () => {
  it('PR-01 奖励是**正式**部件库里的**正式 Weapon**（不新增武器定义）', () => {
    expect(isOfficialPart(REWARD_WEAPON_ID), '奖励必须在 PART_OPTIONS 正式池内').toBe(true);
    const def = registry.functionals.get(REWARD_WEAPON_ID);
    expect(def, '奖励必须存在于正式内容库').toBeTruthy();
    expect(def!.category, '奖励必须是 Weapon（必改 2）').toBe('weapon');
    expect(rewardDisplayName()).toBe(def!.name);
  });

  it('PR-02 初始 Profile **不拥有**它（第一局拿到的是真正的新东西）', () => {
    const inv = defaultInventory();
    expect(STARTER_PARTS.includes(REWARD_WEAPON_ID), 'starter 不含奖励').toBe(false);
    expect(getCount(inv, REWARD_WEAPON_ID, 1), '默认库存计数必须为 0').toBe(0);
    // 对照：starter 的 3 件武器确实是「已拥有」
    for (const owned of ['cannon', 'hammer', 'spear']) {
      expect(getCount(inv, owned, 1)).toBe(1);
    }
  });

  it('PR-03 当前车辆**能合法装备**它（用正式校验器算，不是写死期望值）', () => {
    expect(equippableOnCurrentVehicle(REWARD_WEAPON_ID)).toBe(true);
    // 交叉核对：把奖励放进 WEAPON_SLOT 后过正式 validateSnapshot + computeEnergy
    const draft = {
      ...makeStarterDraft(PLAYER_BODY_DEF_ID, registry),
      functionalSelections: {
        ...makeStarterDraft(PLAYER_BODY_DEF_ID, registry).functionalSelections,
        [WEAPON_SLOT]: REWARD_WEAPON_ID,
      },
    };
    const snap = buildSnapshotFromDraft(draft, registry, 'pr03');
    expect(validateSnapshot(snap, registry).valid).toBe(true);
    const cap = registry.bodies.get(PLAYER_BODY_DEF_ID)!.energyCapacity;
    const energy = computeEnergy(snap, registry).energy;
    expect(energy).toBeLessThanOrEqual(cap);
    // 「装上之后能量读数真的变了」→ 首页能看出变化（可感知性）
    const before = computeEnergy(
      buildSnapshotFromDraft(makeStarterDraft(PLAYER_BODY_DEF_ID, registry), registry, 'pr03b'),
      registry,
    ).energy;
    expect(energy).not.toBe(before);
  });

  it('PR-04 奖池非空且全部合法（换奖励只需改一个常量，但必须重跑本组）', () => {
    const inv = defaultInventory();
    const candidates = [...registry.functionals.values()]
      .filter((d) => d.category === 'weapon')
      .filter((d) => isOfficialPart(d.id))
      .filter((d) => getCount(inv, d.id, 1) === 0)
      .filter((d) => equippableOnCurrentVehicle(d.id))
      .map((d) => d.id)
      .sort();
    expect(candidates.length, '至少要有 2 件未拥有的合法 Weapon 可选').toBeGreaterThanOrEqual(2);
    expect(candidates).toContain(REWARD_WEAPON_ID);
    // 当前选定的奖励必须是其中能量最高的一件（差异最明显 → 「想不想马上装上」最容易判）
    const energyOf = (id: string) => registry.functionals.get(id)!.energy;
    const maxEnergy = Math.max(...candidates.map(energyOf));
    expect(energyOf(REWARD_WEAPON_ID), `候选=${candidates.join(',')}`).toBe(maxEnergy);
  });

  it('PR-05 Run 强化**结构上**不可能是永久奖励（不是正式部件 ⇒ 直接拒收）', () => {
    expect(allKeys()).toEqual([]);
    for (const buff of ['heavyShell', 'twinCannon', 'fastReload']) {
      expect(registry.functionals.get(buff), `${buff} 不是部件`).toBeUndefined();
      expect(isOfficialPart(buff)).toBe(false);
      const bad = claimRunReward({ runToken: `run-buff-${buff}`, rewardDefId: buff });
      expect(bad.ok).toBe(false);
      expect(bad.reason).toBe('not-official');
    }
    // 零副作用：一条记录都没写
    expect(allKeys()).toEqual([]);
  });

  it('PR-06 奖励卡内容 = 正式定义的真实数据（名称 / 能量 / 真实 Collider 外接框）', () => {
    const card = runRewardCard(REWARD_WEAPON_ID);
    const def = registry.functionals.get(REWARD_WEAPON_ID)!;
    expect(card).toBeTruthy();
    expect(card!.name).toBe(def.name);
    expect(card!.energy).toBe(def.energy);
    const geom = rewardColliderGeom(def.collider);
    expect([card!.w, card!.h, card!.round]).toEqual([geom.w, geom.h, geom.round]);
    expect(card!.w).toBeGreaterThan(0);
    expect(card!.h).toBeGreaterThan(0);
    // 未知 / 非武器 → 一律 null（不静默回退到别的部件）
    expect(runRewardCard('doesNotExist')).toBeNull();
    expect(runRewardCard('pushRod'), '推杆是 Gadget，不是 Weapon').toBeNull();
    expect(runRewardCard('')).toBeNull();
    // fit 只缩不放，且塞得进方框
    const fit = fitRewardIcon(card!, 58, 58);
    expect(fit.w).toBeLessThanOrEqual(58);
    expect(fit.h).toBeLessThanOrEqual(58);
    expect(fit.w).toBeGreaterThan(0);
  });
});

// ============================================================================
describe('PRODUCT-LOOP-R1-B｜B. 产品地址与参数：只有一个真源', () => {
  it('PR-07 冒险地址三个参数齐备，且 `back` 与领奖地址完全一致（往返闭合）', () => {
    const token = newRunToken(1700000000000, 0.5);
    const href = buildAdventureHref(token);
    expect(href.startsWith(ADVENTURE_HREF)).toBe(true);
    const parsed = parseRunProductReward(href.slice(href.indexOf('?')));
    expect(parsed).toEqual({ defId: REWARD_WEAPON_ID, runToken: token, backHref: buildClaimHref(token) });
    // 领奖地址本身：解析回来就是同一局（幂等键不丢）
    const claimHref = buildClaimHref(token);
    expect(claimHref.startsWith(HOME_HREF)).toBe(true);
    expect(parsePendingClaim(claimHref.slice(claimHref.indexOf('?')))).toEqual({
      runToken: token,
      rewardDefId: REWARD_WEAPON_ID,
    });
  });

  it('PR-08 参数不全 / 未知奖励 ⇒ 不进产品模式（既有路径逐像素不变的结构前提）', () => {
    const token = newRunToken(1700000000000, 0.5);
    // parsePendingClaim（首页侧）
    expect(parsePendingClaim('')).toBeNull();
    expect(parsePendingClaim('?run=')).toBeNull();
    expect(parsePendingClaim(`?run=${token}`)).toBeNull();
    expect(parsePendingClaim('?reward=laser')).toBeNull();
    // parseRunProductReward（Run Page 侧）：缺 back / 未知奖励 → null
    expect(parseRunProductReward('')).toBeNull();
    expect(parseRunProductReward(`?run=${token}&reward=laser`)).toBeNull();
    expect(parseRunProductReward(`?run=${token}&reward=laser&back=`)).toBeNull();
    expect(parseRunProductReward(`?run=${token}&reward=nope&back=x`)).toBeNull();
    expect(parseRunProductReward(`?run=${token}&reward=pushRod&back=x`), 'Gadget 不算奖励').toBeNull();
  });

  it('PR-09 token 由首页每次挂载生成：确定 + 互不相同', () => {
    expect(newRunToken(1700000000000, 0.5)).toBe(newRunToken(1700000000000, 0.5));
    expect(newRunToken(1700000000000, 0.5)).not.toBe(newRunToken(1700000000001, 0.5));
    expect(newRunToken(1700000000000, 0.5)).not.toBe(newRunToken(1700000000000, 0.25));
  });
});

// ============================================================================
describe('PRODUCT-LOOP-R1-B｜C. 领奖：一次、真入库、可重入', () => {
  it('PR-10 第一次领取：库存 +1 落在**正式** key 上，且只新增一个 key', () => {
    expect(allKeys()).toEqual([]);
    expect(isRunClaimed('run-test-1')).toBe(false);

    const out = claimRunReward({ runToken: 'run-test-1', rewardDefId: REWARD_WEAPON_ID });
    expect(out.ok).toBe(true);
    expect(out.reason).toBeNull();
    expect(out.grant?.defId).toBe(REWARD_WEAPON_ID);
    expect(out.grant?.countAfter).toBe(1);

    // 真的写进了正式库存 key（不是页面自建的第二套库存）——验收 2
    expect(allKeys()).toEqual(['strongfruit.ownedParts.v2', PROFILE_CLAIMS_KEY]);
    const inv = loadInventoryRaw();
    expect(inv, '库存必须真的落盘').toBeTruthy();
    expect(getCount(inv!, REWARD_WEAPON_ID, 1)).toBe(1);
    // 账本记录本局（幂等键）
    expect(isRunClaimed('run-test-1')).toBe(true);
    expect(claimedRunCount()).toBe(1);
    expect(readClaimLedger().grantedRunIds).toEqual(['run-test-1']);
  });

  it('PR-11 重复领取（同 token）：拒绝且**零副作用** —— 验收 3', () => {
    const first = claimRunReward({ runToken: 'run-test-1', rewardDefId: REWARD_WEAPON_ID });
    expect(first.ok).toBe(true);
    const invAfterFirst = store.getItem('strongfruit.ownedParts.v2');
    const ledgerAfterFirst = store.getItem(PROFILE_CLAIMS_KEY);

    for (const attempt of [1, 2, 3]) {
      const again = claimRunReward({ runToken: 'run-test-1', rewardDefId: REWARD_WEAPON_ID });
      expect(again.ok, `第 ${attempt} 次重复领取必须被拒绝`).toBe(false);
      expect(again.reason).toBe('already-claimed');
      expect(again.grant).toBeNull();
    }
    // 库存与账本逐字节不变（既没加副本，也没多加一条记录）
    expect(store.getItem('strongfruit.ownedParts.v2')).toBe(invAfterFirst);
    expect(store.getItem(PROFILE_CLAIMS_KEY)).toBe(ledgerAfterFirst);
    expect(getCount(loadInventoryRaw()!, REWARD_WEAPON_ID, 1)).toBe(1);
    expect(claimedRunCount()).toBe(1);
  });

  it('PR-12 新的一局（新 token）才再发一次；重复获得累计副本数（既有库存语义）', () => {
    claimRunReward({ runToken: 'run-1', rewardDefId: REWARD_WEAPON_ID });
    const second = claimRunReward({ runToken: 'run-2', rewardDefId: REWARD_WEAPON_ID });
    expect(second.ok).toBe(true);
    expect(second.grant?.countAfter).toBe(2);
    expect(claimedRunCount()).toBe(2);
    expect(getCount(loadInventoryRaw()!, REWARD_WEAPON_ID, 1)).toBe(2);
  });

  it('PR-13 非法输入一律拒收且零副作用（含空 token / 未知部件 / Gadget）', () => {
    expect(claimRunReward(null).reason).toBe('no-run-token');
    expect(claimRunReward({ runToken: '', rewardDefId: REWARD_WEAPON_ID }).reason).toBe('no-run-token');
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

  it('PR-14 重载即状态仍在：两次独立调用 = 两次独立读盘（验收 7）', () => {
    claimRunReward({ runToken: 'run-persist', rewardDefId: REWARD_WEAPON_ID });
    // 模拟 reload：不持有任何内存引用，重新从 store 读
    expect(isRunClaimed('run-persist')).toBe(true);
    expect(getCount(loadInventoryRaw()!, REWARD_WEAPON_ID, 1)).toBe(1);
    const again = claimRunReward({ runToken: 'run-persist', rewardDefId: REWARD_WEAPON_ID });
    expect(again.reason).toBe('already-claimed');
    // 库里已经有这件武器 ⇒ 首页「已装备部件 / 拥有武器」列表会把它列出来（验收 6 的数据前提）
    const draft = loadEquippedDraft();
    expect(draft.bodyDefId).toBe(PLAYER_BODY_DEF_ID);
  });
});

// ============================================================================
describe('PRODUCT-LOOP-R1-B｜D. 终点态：只有 COMPLETE 才有奖励出口', () => {
  it('PR-15 COMPLETE + 产品上下文 → 出口存在，文案是**动作**、地址来自产品数据', () => {
    const s = completedState();
    expect(runComplete(s)).toBe(true);
    const claim = runProductClaimNow(s, REWARD_CTX);
    expect(claim).toEqual({
      defId: REWARD_WEAPON_ID,
      runToken: 'run-test-1',
      href: REWARD_CTX.backHref,
    });
    // 文案必须是动作，不是状态描述（PRP-M2-R1 的 P0 教训）
    expect(RUN_REWARD_CLAIM_LABEL).toBe('领取并返回');
    expect(RUN_REWARD_CLAIM_LABEL.includes('完成')).toBe(false);
    expect(RUN_REWARD_TITLE).toBe('本局获得');
  });

  it('PR-16 FAILED **结构上**拿不到奖励出口（必改 4：第一版失败不发永久部件）', () => {
    const s = failedState();
    expect(runComplete(s)).toBe(false);
    expect(runProductClaimNow(s, REWARD_CTX)).toBeNull();
    // 失败终态仍然有它自己的既有出口（开新局），本 Queue 不动它
    expect(registry.functionals.has(REWARD_WEAPON_ID)).toBe(true);
  });

  it('PR-17 没有产品上下文 ⇒ 出口恒 null（既有验证 / 玩家路径零变化）', () => {
    const s = completedState();
    expect(runProductClaimNow(s, null)).toBeNull();
    expect(runProductClaimNow(s, undefined)).toBeNull();
    // 未知奖励 id 同样不进产品模式（不产生「画了按钮但领不到」的分叉）
    expect(runProductClaimNow(s, { ...REWARD_CTX, defId: 'nope' })).toBeNull();
    expect(runProductClaimNow(s, { ...REWARD_CTX, defId: 'pushRod' })).toBeNull();
  });
});

// ============================================================================
describe('PRODUCT-LOOP-R1-B｜E. 源码守卫（本 Queue 的边界必须结构性成立）', () => {
  it('PR-20 UI 不得直接读写 localStorage / platform.storage（必改 1）', () => {
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
    }
  });

  it('PR-22 奖励卡绘制**不引入新的入账色**（既有像素账本不受影响）', () => {
    const src = strip(readLab('runPage.ts'));
    const start = src.indexOf('private drawRewardCard(');
    expect(start, 'runPage.ts 必须有 drawRewardCard').toBeGreaterThan(0);
    const body = src.slice(start, src.indexOf('\n  private ', start + 10));
    // 只允许复用 COLORS.*，不许出现十六进制字面量 / rgba
    expect(body.includes('#'), '奖励卡不得写死颜色（必须复用 COLORS）').toBe(false);
    expect(body.includes('rgba(')).toBe(false);
    // 绘制 / 探针**同源**：`rewardCardNow()` 是唯一判据，且两处都用它
    //（「画的是 A、探针报的是 B」结构上不可能 —— 这是本项目的四处同源铁律）
    expect(src.split('private rewardCardNow(').length - 1).toBe(1);
    expect(src.includes('const card = this.rewardCardNow();'), '绘制处必须经 rewardCardNow').toBe(true);
    expect(src.includes('const rewardCard = this.rewardCardNow();'), '探针处必须经 rewardCardNow').toBe(true);
    // 出口同理：文案 / 行为 / 探针 / 命中都经 `productClaimNow()`
    expect(src.split('private productClaimNow(').length - 1).toBe(1);
    expect(src.split('this.productClaimNow()').length - 1).toBeGreaterThanOrEqual(4);
  });

  it('PR-23 验收 5：奖励展示与 Garage 用的是**同一份**库存（不存在第二套数据）', () => {
    // 领奖后：库存里读得到 ⇒ A 段的 Garage 列表（weaponEntries）自动包含它
    claimRunReward({ runToken: 'run-garage', rewardDefId: REWARD_WEAPON_ID });
    const inv = loadInventoryRaw()!;
    expect(getCount(inv, REWARD_WEAPON_ID, 1)).toBe(1);
    // Garage 侧的唯一数据源就是这份库存（A 段的实现未被本 Queue 改动）
    const a = strip(readProduct('playerLoadout.ts'));
    expect(a.includes("from '../core/partInventory'")).toBe(true);
    // 页面侧不写死「本局获得」文案（标题来自 Lab 常量，名称来自内容库）
    const page = strip(readProduct('homePage.ts'));
    expect(page.includes(REWARD_WEAPON_ID), '页面不得写死奖励 id').toBe(false);
  });
});
