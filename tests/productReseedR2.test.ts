/**
 * PRODUCT-LOOP-R2-VALIDATION-STATE-RESEED-R1｜**版本化一次性 reseed** 的 targeted 测试。
 *
 * 被测对象 = `src/product/r2Reseed.ts`（+ 它在 `playerGrowth.openGrowthSession` 里的接入）。
 * 本文件只回答 Queue 的五条验收与必改 2/3 的边界：
 *   ① 用**上一轮已经合成过 ★2** 的 persisted profile 启动 ⇒ 自动一次性恢复 `cannon ★1 = 4/5` + 装备 ★1；
 *   ② 刷新 / 重进 ⇒ reseed **不重复执行**；
 *   ④ 其他已有 Weapon / 库存**不丢失**（逐条保留，键集不变）；
 *   必改 2 = 只处理 cannon 的 R2 验证状态；必改 3 = 恢复后必须是**真实 pre-fusion 状态**。
 * （③ 完整数据链「4/5 → 领奖 → 5/5 → 合成 → ★2 → 自动装备」是浏览器侧的真实行为，
 *  由 `tests/_e2e_product_reseed.cjs` 与既有的 `_e2e_product_star_power.cjs` 取证，不在本文件重复。）
 *
 * ⚠️ 本文件**不 import 任何 UI**：全部走产品侧的**纯函数入口**
 *    （`openGrowthSession` / `planR2Reseed` / `applyR2Reseed` / `playerLoadout` 的读数）。
 * ⚠️ 夹具里的「上一轮验证之后」形态是**手工构造**的（★1=1 / ★2=1 / 装备 ★2 / 旧标记 / 领奖账本）：
 *    这正是 Queue 原文描述的真实账号形态；fusion 本身怎么产出 ★2 由既有用例覆盖，本文件不重复证明。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getCount, loadInventoryRaw, type PartInventory } from '../src/core/partInventory';
import { savePlayerBuild } from '../src/core/buildPersistence';
import { STAMP_KEY } from '../src/core/saveVersion';
import { registry } from '../src/core/content';
import { buildSnapshotFromDraft, type BuildDraft } from '../src/lab/buildEditorModel';
import { validateSnapshot } from '../src/core/buildValidator';
import {
  WEAPON_SLOT,
  defaultPlayerDraft,
  equippedWeaponStar,
  loadEquippedDraft,
  playerInventory,
} from '../src/product/playerLoadout';
import { openGrowthSession } from '../src/product/playerGrowth';
import {
  R2_ONBOARDING_KEY,
  R2_ONBOARDING_TARGET_COUNT,
  markR2Onboarding,
} from '../src/product/r2Onboarding';
import {
  R2_RESEED_KEY,
  R2_RESEED_TARGET_COUNT,
  R2_RESEED_VERSION,
  applyR2Reseed,
  grownCannonCount,
  grownCannonStars,
  hasPrototypeClaim,
  isR2ReseedDone,
  markR2Reseed,
  planR2Reseed,
  readR2Reseed,
} from '../src/product/r2Reseed';
import { saveClaimLedger } from '../src/product/playerProfile';
// PRODUCT-LOOP-R3-MOVEMENT-CHOICE-SEED：第三份一次性迁移的标记（隔离变量用）
import { markR3MovementSeed } from '../src/product/r3MovementChoiceSeed';
// PRODUCT-LOOP-R4-BODY-CANONICAL-AND-GARAGE-MVP：第四份一次性迁移的标记（隔离变量用）
import { markR4BodySeed } from '../src/product/r4BodyChoiceSeed';
import { markR5ContentPoolSeed } from '../src/product/r5ContentPoolSeed';

const INV_KEY = 'strongfruit.ownedParts.v2';
const BUILD_KEY = 'strongfruit.playerBuild.v1';
const PROGRESS_KEY = 'strongfruit.playerProgress.v1';
/** 「把 ★1 补到 4」这个数字与旧 onboarding 的目标**同值**（两份迁移的起点是同一个起点）。 */
const TARGET = R2_RESEED_TARGET_COUNT;

/** 仓库根（源码守卫要读 `src/product/*.ts` 原文）。 */
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

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

/** 直接把一份库存塞进磁盘（模拟玩家上次游玩留下的记录）。 */
function seedDisk(inv: Record<string, unknown>, key = INV_KEY, stamp = true): void {
  store.setItem(key, JSON.stringify(stamp ? { ...inv, [STAMP_KEY]: 1 } : inv));
}

/** 全部 key（闭集断言用）。 */
function allKeys(): string[] {
  const out: string[] = [];
  for (let i = 0; i < store.length; i += 1) {
    const k = store.key(i);
    if (k) out.push(k);
  }
  return out.sort();
}

/** 剥注释（本项目铁律：注释里的自指文字会骗过字符串匹配）。 */
function strip(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/* ------------------------------------------------------------------ 夹具 */

/**
 * 「上一轮 R2 验证**已经消费掉起点**」的真实账号形态（Queue 原文逐条对应）：
 *   - `cannon ★2` 已合成（`grown = 1`）；
 *   - 新领到的 `cannon ★1` 只有 **1** 件；
 *   - 旧 R2 onboarding 标记已消费（⇒ 它不会再补到 4）；
 *   - 领奖账本非空（⇒ 真的走过产品验证链）；
 *   - **别的** Weapon / Movement 也各有成长与数量（用来证「不是重置整个 Profile」）。
 */
const CONSUMED_INV: Record<string, unknown> = {
  cannon: { one: 1, two: 1 },
  spear: { one: 2, two: 1 },
  hammer: { one: 1, two: 0 },
  pushRod: { one: 1, two: 0 },
  smallWheel: { one: 1, two: 0 },
};

/** 上一轮验证结束时的 Build：主武器槽装的是 **★2 的炮**（`functionalStars` 印记在）。 */
function consumedBuild(extra: Partial<BuildDraft> = {}): BuildDraft {
  return {
    ...defaultPlayerDraft(),
    functionalStars: { [WEAPON_SLOT]: 2 },
    ...extra,
  };
}

/**
 * 把「已消费起点」的账号整体写进磁盘（库存 + Build + 旧标记 + 领奖账本 + 一份可辨认的进度）。
 *
 * ⚠️ PRODUCT-LOOP-R3-MOVEMENT-CHOICE-SEED｜这里**追加预置第三份一次性迁移的标记**：
 *    那份种子（Movement 可选方案，三档各补到 ≥1）同样会写库存 ⇒ 若不预置，
 *    本文件里所有「`r2Reseed` 一个字节都不动库存」的逐字节断言都会被它触发的合法写入打破。
 *    预置标记 = **隔离变量**（把第三份迁移变成「对这个账号不适用」），不是放宽断言：
 *    所有断言逐字保留，且 `r2Reseed` 的契约由本文件单独覆盖。
 * ⚠️ PRODUCT-LOOP-R4-BODY-CANONICAL-AND-GARAGE-MVP｜再预置**第四份**（`markR4BodySeed()`）：
 *    Body 种子首入会解锁 MVP 车身，并落 `r4BodyChoiceSeed.v1` + `ownedBodies.v1` **两个** key
 *    ⇒ 若不预置，VR-03 那条「只多出 `r2Reseed` 自己的一个标记」的**闭集**键集断言就会被打破。
 *    同样是**隔离变量，不是放宽**：闭集语义逐字保留（多写任何别的 key 照样红）。
 */
function seedConsumedProfile(build: BuildDraft = consumedBuild()): void {
  seedDisk(CONSUMED_INV);
  savePlayerBuild(build);
  markR2Onboarding();
  markR3MovementSeed();
  markR4BodySeed();
  // ⚠️ PRODUCT-LOOP-R5-BASIC-CONTENT-POOL-R1｜第五份（`markR5ContentPoolSeed()`）：
  //    R5 内容池种子**同样会写库存**（给全部 `OFFICIAL_PARTS` 补 ★1 ×1）⇒ 同一条隔离纪律
  //    （与第三 / 第四份逐条同源）。这是隔离变量，不是放宽断言。
  markR5ContentPoolSeed();
  saveClaimLedger({ grantedRunIds: ['run-r2-validation'] });
  store.setItem(PROGRESS_KEY, JSON.stringify({ cleared: 3, best: 7 }));
}

/** 库存里**除 cannon 之外**的全部条目（逐字节快照，用来证「别的件一字未动」）。 */
function nonCannonSnapshot(inv: PartInventory): string {
  const rest: Record<string, unknown> = {};
  for (const k of Object.keys(inv).sort()) {
    if (k === 'cannon') continue;
    rest[k] = { ...inv[k] };
  }
  return JSON.stringify(rest);
}

// ============================================================================
describe('PRODUCT-LOOP-R2-VALIDATION-STATE-RESEED-R1｜A. 已消费起点的账号被一次性恢复', () => {
  it('VR-01 **验收 ①/必改 3**：★2 已装备 + ★1 只剩 1 件 ⇒ 恢复成 `★1 = 4/5` 且装备 ★1', () => {
    seedConsumedProfile();
    const draft = loadEquippedDraft();
    // 夹具自检：进来时确实是「上一轮验证之后」的形态
    expect(equippedWeaponStar(draft), '进来时装的是 ★2 的炮').toBe(2);
    expect(getCount(playerInventory(draft), 'cannon', 1)).toBe(1);

    const g = openGrowthSession(draft);
    expect(g.reseed.applied, '五条判据成立 ⇒ 这一次真的执行了').toBe(true);
    expect(g.reseed.reason).toBe('reseeded');
    expect(g.reseed.cannonBefore).toBe(1);
    expect(g.reseed.cannonAfter).toBe(TARGET);
    expect(g.reseed.raised, '补 3 件（1 → 4）').toBe(3);
    expect(g.reseed.cleared, '清掉 1 件 ★2').toBe(1);
    expect(g.reseed.clearedStars).toEqual([2]);

    // 会话回传的 Build 就是「装备 ★1」那一份（页面必须用它，见 homePage 的注释）
    expect(g.draft.functionalSelections[WEAPON_SLOT]).toBe('cannon');
    expect(g.draft.functionalStars?.[WEAPON_SLOT], '★1 = 缺省 ⇒ 该键必须不存在').toBeUndefined();
    expect(equippedWeaponStar(g.draft)).toBe(1);
  });

  it('VR-02 **落盘取证**：库存与 Build 两处**真实写进磁盘**（不是只在内存改了）', () => {
    seedConsumedProfile();
    openGrowthSession(loadEquippedDraft());

    const inv = loadInventoryRaw()!;
    expect(getCount(inv, 'cannon', 1), '磁盘上 ★1 = 4').toBe(TARGET);
    expect(getCount(inv, 'cannon', 2), '磁盘上 ★2 已清零').toBe(0);
    const stored = JSON.parse(store.getItem(BUILD_KEY)!) as BuildDraft;
    expect(stored.functionalSelections[WEAPON_SLOT]).toBe('cannon');
    expect(stored.functionalStars?.[WEAPON_SLOT]).toBeUndefined();
    // 再走一次**唯一读入口**：读回来的就是恢复后的那份（页面/下一局读的是同一处）
    expect(equippedWeaponStar(loadEquippedDraft())).toBe(1);
    expect(isR2ReseedDone(), '标记已落盘').toBe(true);
    expect(readR2Reseed()?.version).toBe(R2_RESEED_VERSION);
  });

  it('VR-03 **必改 2 / 验收 ④**：只碰 cannon —— 其它库存条目**逐条不变**、键集不变', () => {
    seedConsumedProfile();
    const invBefore = loadInventoryRaw()!;
    const restBefore = nonCannonSnapshot(invBefore);
    const keysBefore = allKeys();
    const progressBefore = store.getItem(PROGRESS_KEY);
    const onboardingMarkBefore = store.getItem(R2_ONBOARDING_KEY);

    openGrowthSession(loadEquippedDraft());

    const invAfter = loadInventoryRaw()!;
    expect(nonCannonSnapshot(invAfter), '除 cannon 之外的条目逐条保留').toBe(restBefore);
    expect(getCount(invAfter, 'spear', 1), 'spear ★1 仍是 2').toBe(2);
    expect(getCount(invAfter, 'spear', 2), 'spear ★2（别的 Weapon 的成长）仍在').toBe(1);
    expect(getCount(invAfter, 'hammer', 1)).toBe(1);
    expect(getCount(invAfter, 'pushRod', 1)).toBe(1);
    expect(getCount(invAfter, 'smallWheel', 1), 'Movement（轮组）也在').toBe(1);
    expect(store.getItem(PROGRESS_KEY), '进度 key 逐字节不变').toBe(progressBefore);
    expect(store.getItem(R2_ONBOARDING_KEY), '旧标记既不复用也不改写').toBe(onboardingMarkBefore);
    // 键集：只多出本迁移**自己的**一个标记（不删任何 key、不换 key）
    expect(allKeys()).toEqual([...keysBefore, R2_RESEED_KEY].sort());
  });

  it('VR-04 只动装备槽：Build 的其它字段（车身 / 轮径 / 轮组 / 驱动 / 其它槽 / 其它槽星级）一字未改', () => {
    const rich = consumedBuild({
      drive: 'forward',
      rearWheelDefId: 'smallWheel',
      frontWheelDefId: 'smallWheel',
      rearRadius: 26,
      frontRadius: 26,
      functionalStars: { [WEAPON_SLOT]: 2, top: 1 },
    });
    seedConsumedProfile(rich);
    const before = JSON.parse(store.getItem(BUILD_KEY)!) as BuildDraft;

    const g = openGrowthSession(loadEquippedDraft());
    expect(g.reseed.applied).toBe(true);
    const after = JSON.parse(store.getItem(BUILD_KEY)!) as BuildDraft;
    expect(after.bodyDefId).toBe(before.bodyDefId);
    expect(after.rearRadius).toBe(before.rearRadius);
    expect(after.frontRadius).toBe(before.frontRadius);
    expect(after.rearWheelDefId).toBe(before.rearWheelDefId);
    expect(after.frontWheelDefId).toBe(before.frontWheelDefId);
    expect(after.drive).toBe(before.drive);
    // 别的槽的选择与星级原样（equipWeapon 只写 WEAPON_SLOT 一个键）
    expect({ ...after.functionalSelections, [WEAPON_SLOT]: before.functionalSelections[WEAPON_SLOT] }).toEqual(
      before.functionalSelections,
    );
    expect(after.functionalStars?.['top'], '别的槽的星级印记仍在').toBe(1);
    expect(Object.keys(after.functionalStars ?? {})).toEqual(['top']);
  });

  it('VR-01b ★3..★5 也是「上一轮验证的产物」⇒ 一起清掉（恢复后是**真实**的 pre-fusion 态）', () => {
    seedDisk({
      cannon: { one: 1, two: 1, three: 2, four: 1, five: 0 },
      spear: { one: 1, two: 0 },
    });
    savePlayerBuild(consumedBuild());
    markR2Onboarding();
    saveClaimLedger({ grantedRunIds: ['run-x'] });

    const g = openGrowthSession(loadEquippedDraft());
    expect(g.reseed.applied).toBe(true);
    expect(g.reseed.clearedStars).toEqual([2, 3, 4]);
    expect(g.reseed.cleared).toBe(4);
    const inv = loadInventoryRaw()!;
    for (const star of [2, 3, 4, 5]) {
      expect(getCount(inv, 'cannon', star), `★${star} 必须为 0`).toBe(0);
    }
    expect(getCount(inv, 'cannon', 1)).toBe(TARGET);
    expect(getCount(inv, 'spear', 1), '别的 Weapon 不受影响').toBe(1);
  });
});

// ============================================================================
describe('PRODUCT-LOOP-R2-VALIDATION-STATE-RESEED-R1｜B. 幂等：只执行一次', () => {
  it('VR-05 **验收 ②**：刷新 / 重进 ⇒ `already-marked`，三份存档**逐字节不变**', () => {
    seedConsumedProfile();
    openGrowthSession(loadEquippedDraft());
    const inv1 = store.getItem(INV_KEY);
    const build1 = store.getItem(BUILD_KEY);
    const mark1 = store.getItem(R2_RESEED_KEY);

    const again = openGrowthSession(loadEquippedDraft());
    expect(again.reseed.applied).toBe(false);
    expect(again.reseed.reason).toBe('already-marked');
    expect(again.reseed.raised).toBe(0);
    expect(again.reseed.cleared).toBe(0);
    expect(store.getItem(INV_KEY)).toBe(inv1);
    expect(store.getItem(BUILD_KEY)).toBe(build1);
    expect(store.getItem(R2_RESEED_KEY)).toBe(mark1);
  });

  it('VR-06 落标记的判据是**决策**（`decided`）而不是动作（`applied`）：四个「不动」的出口同样落标记', () => {
    // 起点完好（★1 已 4 件）但仍有上一轮的 ★2 ⇒ 不清，但**首入判定已经做出** ⇒ 落标记
    seedDisk({ cannon: { one: 4, two: 1 } });
    savePlayerBuild(consumedBuild());
    markR2Onboarding();
    // ⚠️ 隔离变量：第三份一次性迁移（Movement 种子）也会写库存 ⇒ 预置其标记
    markR3MovementSeed();
    // ⚠️ 隔离变量：第五份一次性迁移（R5 内容池种子）**同样会写库存**
    //    （给全部 `OFFICIAL_PARTS` 补 ★1 ×1）⇒ 预置其标记；否则本文件所有
    //    「库存零写入 / 逐字节不变」的断言都会被它的**合法**写入打破。
    //    这是隔离变量，不是放宽断言 —— 那份种子的契约由
    //    `tests/productContentPoolSeed.test.ts` 单独覆盖。
    markR5ContentPoolSeed();
    saveClaimLedger({ grantedRunIds: ['run-x'] });
    const invBefore = store.getItem(INV_KEY);

    const first = openGrowthSession(loadEquippedDraft());
    expect(first.reseed.reason).toBe('start-intact');
    expect(first.reseed.applied).toBe(false);
    expect(first.reseed.decided, '首入判定必须落定').toBe(true);
    expect(isR2ReseedDone(), '决策已做出 ⇒ 标记落盘（尽管动作没有执行）').toBe(true);
    expect(getCount(loadInventoryRaw()!, 'cannon', 2), '★2 原样保留（不越权清）').toBe(1);
    expect(store.getItem(INV_KEY), '库存一个字节都没动').toBe(invBefore);

    // 第二次挂载：只看标记，不再重判（即使库存此时已经"长得像被消费过"）
    seedDisk({ cannon: { one: 1, two: 1 } });
    const second = openGrowthSession(loadEquippedDraft());
    expect(second.reseed.reason).toBe('already-marked');
    expect(second.reseed.applied).toBe(false);
    expect(getCount(loadInventoryRaw()!, 'cannon', 2), '★2 保留（一次性）').toBe(1);
  });

  it('VR-06b **门禁抓出的真实丢档路径（回归）**：首入时还没领过奖 ⇒ 判定照样落定，玩家之后**自己合出来**的 ★2 绝不被清', () => {
    /*
      逐字复刻 `e2e:product-reward` 在门禁里抓到的形态（K8 / H2 / H3 三条同时红）：
        新账号首入（打开过首页、但一次奖都还没领过 ⇒ `no-claim`）
        → 玩家自己打一局、领奖、把 ★1 攒到 5、合成 ★2
        → 回到首页 ⇒ 五条判据**全部成立** ⇒ 旧实现把玩家**自己刚合出来的** ★2 当成
          「上一轮的产物」清掉，并把 ★1 补回 4（等于倒扣一件、还吞掉升星成果）。
      根因 = 把「连续判定」当成了「首入判定」（判据读的是**会被玩家自己改变**的库存）；
      修法 = 判定在**第一次挂载**就落定，此后只看标记。
    */
    seedDisk({ cannon: { one: 4, two: 0 } });
    savePlayerBuild(defaultPlayerDraft());
    markR2Onboarding();

    const first = openGrowthSession(loadEquippedDraft());
    expect(first.reseed.reason, '首入时确实还不满足「走过产品验证链」').toBe('no-claim');
    expect(first.reseed.applied).toBe(false);
    expect(first.reseed.decided, '首入判定必须落定').toBe(true);
    expect(isR2ReseedDone(), '标记必须落盘，否则下一次挂载会重判').toBe(true);

    // 玩家自己走完整条链：领一件 ⇒ 5/5 ⇒ 合成 ⇒ ★2（★1 归 0，装备自动升到 ★2）
    seedDisk({ cannon: { one: 0, two: 1 } });
    savePlayerBuild(consumedBuild());

    const second = openGrowthSession(loadEquippedDraft());
    expect(second.reseed.reason, '下次挂载只看标记，不再重判').toBe('already-marked');
    expect(second.reseed.applied).toBe(false);
    expect(getCount(loadInventoryRaw()!, 'cannon', 1), '★1 **不补**到 4（不倒扣玩家自己的成果）').toBe(0);
    expect(getCount(loadInventoryRaw()!, 'cannon', 2), '玩家自己合出来的 ★2 原样保留').toBe(1);
    expect(equippedWeaponStar(loadEquippedDraft()), '装备仍是玩家自己升上去的 ★2').toBe(2);
  });

  it('VR-07 执行过之后，玩家再合成一次 ★2 也不会被反复清掉（一次性）', () => {
    seedConsumedProfile();
    openGrowthSession(loadEquippedDraft());

    // 玩家之后又合成了一件 ★2（模拟下一轮验证的产物）
    seedDisk({ cannon: { one: 0, two: 1 } });
    const g = openGrowthSession(loadEquippedDraft());
    expect(g.reseed.reason).toBe('already-marked');
    expect(getCount(loadInventoryRaw()!, 'cannon', 2), '★2 保留 —— 本迁移只执行一次').toBe(1);
    expect(g.onboarding.reason, '旧 onboarding 同样早已消费').toBe('already-marked');
  });
});

// ============================================================================
describe('PRODUCT-LOOP-R2-VALIDATION-STATE-RESEED-R1｜C. 四个「一个字节都不动」的出口', () => {
  it('VR-08 `not-prototype`：没打开过产品首页（旧 R2 onboarding 标记不存在）⇒ 不清 ★2', () => {
    seedDisk({ cannon: { one: 1, two: 1 } });
    savePlayerBuild(consumedBuild());
    // ⚠️ 隔离变量：第三份一次性迁移（Movement 种子）也会写库存 ⇒ 预置其标记
    markR3MovementSeed();
    // ⚠️ 隔离变量：第五份一次性迁移（R5 内容池种子）**同样会写库存**
    //    （给全部 `OFFICIAL_PARTS` 补 ★1 ×1）⇒ 预置其标记；否则本文件所有
    //    「库存零写入 / 逐字节不变」的断言都会被它的**合法**写入打破。
    //    这是隔离变量，不是放宽断言 —— 那份种子的契约由
    //    `tests/productContentPoolSeed.test.ts` 单独覆盖。
    markR5ContentPoolSeed();
    saveClaimLedger({ grantedRunIds: ['run-x'] }); // 有领奖记录，但没跑过 onboarding
    const invBefore = store.getItem(INV_KEY);

    const g = openGrowthSession(loadEquippedDraft());
    expect(g.reseed.reason).toBe('not-prototype');
    expect(g.reseed.applied).toBe(false);
    expect(getCount(g.inv, 'cannon', 2), '★2 保留').toBe(1);
    expect(getCount(g.inv, 'cannon', 1)).toBe(1);
    expect(store.getItem(INV_KEY), '库存连一次写入都没有').toBe(invBefore);
    expect(g.reseed.decided, '首入判定同样落定（否则第二次挂载就会重判并误清）').toBe(true);
    expect(isR2ReseedDone(), '标记落盘；但库存零写入').toBe(true);
  });

  it('VR-09 `no-claim`：领奖账本为空（没走过产品验证链）⇒ 不清 ★2', () => {
    seedDisk({ cannon: { one: 1, two: 1 } });
    savePlayerBuild(consumedBuild());
    markR2Onboarding(); // 有旧标记，但一次奖都没领过
    // ⚠️ 隔离变量：第三份一次性迁移（Movement 种子）也会写库存 ⇒ 预置其标记
    markR3MovementSeed();
    // ⚠️ 隔离变量：第五份一次性迁移（R5 内容池种子）**同样会写库存**
    //    （给全部 `OFFICIAL_PARTS` 补 ★1 ×1）⇒ 预置其标记；否则本文件所有
    //    「库存零写入 / 逐字节不变」的断言都会被它的**合法**写入打破。
    //    这是隔离变量，不是放宽断言 —— 那份种子的契约由
    //    `tests/productContentPoolSeed.test.ts` 单独覆盖。
    markR5ContentPoolSeed();
    expect(hasPrototypeClaim()).toBe(false);
    const invBefore = store.getItem(INV_KEY);

    const g = openGrowthSession(loadEquippedDraft());
    expect(g.reseed.reason).toBe('no-claim');
    expect(getCount(g.inv, 'cannon', 2), '★2 保留').toBe(1);
    expect(store.getItem(INV_KEY)).toBe(invBefore);
    // ⚠️ 这一个出口**必须**落标记：它是 `e2e:product-reward` 那条丢档路径的入口
    //    （首入时还没领过奖 ⇒ 不落标记 ⇒ 玩家自己合成 ★2 后被下一次挂载误清）。
    expect(g.reseed.decided, 'no-claim 也是首入判定 ⇒ 必须落定').toBe(true);
    expect(isR2ReseedDone()).toBe(true);
  });

  it('VR-10 `not-consumed`：没有 ★≥2（上一次没合成过）⇒ 不动，也不为了凑数而清零', () => {
    seedDisk({ cannon: { one: 1, two: 0 }, spear: { one: 2, two: 0 } });
    savePlayerBuild(defaultPlayerDraft());
    markR2Onboarding();
    // ⚠️ 隔离变量：第三份一次性迁移（Movement 种子）也会写库存 ⇒ 预置其标记
    markR3MovementSeed();
    // ⚠️ 隔离变量：第五份一次性迁移（R5 内容池种子）**同样会写库存**
    //    （给全部 `OFFICIAL_PARTS` 补 ★1 ×1）⇒ 预置其标记；否则本文件所有
    //    「库存零写入 / 逐字节不变」的断言都会被它的**合法**写入打破。
    //    这是隔离变量，不是放宽断言 —— 那份种子的契约由
    //    `tests/productContentPoolSeed.test.ts` 单独覆盖。
    markR5ContentPoolSeed();
    saveClaimLedger({ grantedRunIds: ['run-x'] });
    const invBefore = store.getItem(INV_KEY);

    const g = openGrowthSession(loadEquippedDraft());
    expect(g.reseed.reason).toBe('not-consumed');
    expect(getCount(g.inv, 'cannon', 1), '不补（那是旧 onboarding 的职责）').toBe(1);
    expect(store.getItem(INV_KEY), '这次挂载没有写入库存').toBe(invBefore);
    expect(g.reseed.decided, '首入判定落定（此后不再重判）').toBe(true);
    expect(isR2ReseedDone()).toBe(true);
  });

  it('VR-10b 回归：未成长的**老档**仍由旧 onboarding 补到 4/5（本迁移不抢它的活）', () => {
    seedDisk({ cannon: { one: 1, two: 0 }, spear: { one: 2, two: 0 } });
    savePlayerBuild(defaultPlayerDraft());
    // 刻意**不**预置旧标记：让 R2-RECOVERY 的一次性 onboarding 成为唯一自变量
    const g = openGrowthSession(loadEquippedDraft());
    expect(g.onboarding.reason, '旧路径行为不变').toBe('raised');
    expect(getCount(g.inv, 'cannon', 1)).toBe(R2_ONBOARDING_TARGET_COUNT);
    expect(g.reseed.reason, '本次 reseed 不参与（还没成为原型账号）').toBe('not-prototype');
    expect(g.reseed.applied).toBe(false);
    expect(getCount(g.inv, 'spear', 1), '别的件一字未动').toBe(2);
  });

  it('VR-11 `start-intact`：`cannon ★1` 已有 4 件 ⇒ 绝不被**降**到 4（只增不减）', () => {
    seedDisk({ cannon: { one: 5, two: 1 } });
    savePlayerBuild(consumedBuild());
    markR2Onboarding();
    saveClaimLedger({ grantedRunIds: ['run-x'] });

    const g = openGrowthSession(loadEquippedDraft());
    expect(g.reseed.reason).toBe('start-intact');
    expect(getCount(g.inv, 'cannon', 1), '5 件仍是 5 件').toBe(5);
    expect(getCount(loadInventoryRaw()!, 'cannon', 1)).toBe(5);
    expect(g.reseed.decided, '首入判定落定').toBe(true);
    expect(isR2ReseedDone()).toBe(true);
  });
});

// ============================================================================
describe('PRODUCT-LOOP-R2-VALIDATION-STATE-RESEED-R1｜D. 装备被拒 ⇒ 原子（零副作用）', () => {
  /**
   * 真实内容里的**超能量**夹具（不是编造的形状）：
   *   `watermelonBody` 能量上限 110；`frontMass=lifter(15)` + `front=pushRod(20)`
   *   + `top=laser(45)` + `rear=thruster(20)` = **100** ⇒ **当前 Build 合法**；
   *   把主武器槽换成 `cannon ★1`（30）⇒ 100 − 15 + 30 = **115 > 110** ⇒ 正式校验拒绝。
   */
  const OVERFLOW_BUILD: BuildDraft = {
    ...defaultPlayerDraft(),
    functionalSelections: { front: 'pushRod', frontMass: 'lifter', top: 'laser', rear: 'thruster' },
    functionalStars: { [WEAPON_SLOT]: 2 },
  };

  it('VR-12 夹具自检：这份 Build **当前合法**，而换上 `cannon ★1` 会让它超能量', () => {
    const now = validateSnapshot(buildSnapshotFromDraft(OVERFLOW_BUILD, registry), registry);
    expect(now.valid, `夹具本身必须合法，否则测的就不是「换装被拒」了：${now.errors.join(' / ')}`).toBe(true);
    const swapped: BuildDraft = {
      ...OVERFLOW_BUILD,
      functionalSelections: { ...OVERFLOW_BUILD.functionalSelections, [WEAPON_SLOT]: 'cannon' },
      functionalStars: {},
    };
    const after = validateSnapshot(buildSnapshotFromDraft(swapped, registry), registry);
    expect(after.valid, '换炮之后必须**不合法**（否则本组用例失去意义）').toBe(false);
  });

  it('VR-12b `equip-failed` ⇒ 库存 / Build 两处**一个字节都不动**，且不落标记（下次可重试）', () => {
    seedDisk(CONSUMED_INV);
    savePlayerBuild(OVERFLOW_BUILD);
    markR2Onboarding();
    // ⚠️ 隔离变量：第三份一次性迁移（Movement 种子）也会写库存 ⇒ 预置其标记
    markR3MovementSeed();
    // ⚠️ 隔离变量：第五份一次性迁移（R5 内容池种子）**同样会写库存**
    //    （给全部 `OFFICIAL_PARTS` 补 ★1 ×1）⇒ 预置其标记；否则本文件所有
    //    「库存零写入 / 逐字节不变」的断言都会被它的**合法**写入打破。
    //    这是隔离变量，不是放宽断言 —— 那份种子的契约由
    //    `tests/productContentPoolSeed.test.ts` 单独覆盖。
    markR5ContentPoolSeed();
    saveClaimLedger({ grantedRunIds: ['run-x'] });
    const invBefore = store.getItem(INV_KEY);
    const buildBefore = store.getItem(BUILD_KEY);

    const g = openGrowthSession(loadEquippedDraft());
    expect(g.reseed.applied).toBe(false);
    expect(g.reseed.reason).toBe('equip-failed');
    expect(g.reseed.equipped?.ok).toBe(false);
    expect(g.reseed.raised, '补件被回滚 ⇒ 0').toBe(0);
    expect(g.reseed.cleared, '没有清任何东西').toBe(0);
    expect(g.reseed.cannonAfter, '内存库存也回到原样（1 件）').toBe(1);
    expect(store.getItem(INV_KEY), '库存零落盘').toBe(invBefore);
    expect(store.getItem(BUILD_KEY), 'Build 零落盘').toBe(buildBefore);
    expect(isR2ReseedDone(), '没成功就不该落标记').toBe(false);
    // 玩家自己背包里的 ★2 与 ★1 一件都没少
    expect(g.inv && getCount(g.inv, 'cannon', 1)).toBe(1);
    expect(getCount(g.inv, 'cannon', 2)).toBe(1);
  });
});

// ============================================================================
describe('PRODUCT-LOOP-R2-VALIDATION-STATE-RESEED-R1｜E. 纯判定 + 源码守卫', () => {
  it('VR-13 `planR2Reseed` 是**纯判定**：不落盘、不改库存、不打标记', () => {
    seedDisk(CONSUMED_INV);
    savePlayerBuild(consumedBuild());
    markR2Onboarding();
    saveClaimLedger({ grantedRunIds: ['run-x'] });
    const inv = playerInventory(loadEquippedDraft());
    const keysBefore = allKeys();
    const invRawBefore = store.getItem(INV_KEY);

    const plan = planR2Reseed(inv, consumedBuild());
    expect(plan.applied).toBe(true);
    expect(plan.reason).toBe('reseeded');
    expect(plan.cannonBefore).toBe(1);
    expect(plan.grownBefore).toBe(1);
    expect(plan.clearedStars).toEqual([2]);
    // 纯：什么都没写、内存库存也没动
    expect(allKeys()).toEqual(keysBefore);
    expect(store.getItem(INV_KEY)).toBe(invRawBefore);
    expect(getCount(inv, 'cannon', 1)).toBe(1);
    expect(isR2ReseedDone()).toBe(false);
    // 直接调 apply 也不会重复判定（不 applied 的 plan ⇒ 原样透传）
    const skipped = applyR2Reseed(inv, consumedBuild(), { ...plan, applied: false, reason: 'start-intact' });
    expect(skipped.reason).toBe('start-intact');
    expect(skipped.raised).toBe(0);
    expect(getCount(inv, 'cannon', 1)).toBe(1);
  });

  it('VR-14 计数器口径：`grownCannonStars` / `grownCannonCount` 只数 cannon 的 ★≥2', () => {
    const inv = playerInventory(defaultPlayerDraft());
    expect(grownCannonStars(inv)).toEqual([]);
    expect(grownCannonCount(inv)).toBe(0);
    seedDisk({ cannon: { one: 3, two: 2, four: 1 }, spear: { one: 1, two: 9 } });
    const inv2 = loadInventoryRaw()!;
    expect(grownCannonStars(inv2), '★1 永远不在里面；别的 Weapon 不算').toEqual([2, 4]);
    expect(grownCannonCount(inv2)).toBe(3);
  });

  it('VR-15 源码守卫：新 key / 无 Reset 语义 / 清星走 core / 标记晚于落盘 / 首页收回会话的 Build', () => {
    const reseed = strip(readFileSync(join(REPO_ROOT, 'src', 'product', 'r2Reseed.ts'), 'utf8'));
    // ① 必须用自己的 key（不复用已被消费的旧标记）
    expect(R2_RESEED_KEY).not.toBe(R2_ONBOARDING_KEY);
    expect(reseed.includes('r2Onboarding.v1'), '不得出现旧 key 的字面量').toBe(false);
    // ② 不得有 Reset / 清档语义
    for (const banned of ['removeItem', 'resetPlayerSave', 'clear()', 'localStorage']) {
      expect(reseed.includes(banned), `r2Reseed.ts 不得出现 ${banned}`).toBe(false);
    }
    // ③ 清星必须走 core 的既有写路径（不自己展开 PartStack 形状）
    expect(reseed.includes('consume('), '清星走 core 的 consume').toBe(true);
    expect(reseed.includes('addPart('), '补件走 core 的 addPart').toBe(true);
    expect(reseed.includes('savePlayerBuild('), '唯一写 Build 的入口仍是 playerLoadout').toBe(false);
    // ④ 装备必须走正式 equipWeapon（过 validateSnapshot）
    expect(reseed.includes('equipWeapon(')).toBe(true);
    /*
      ⑤ **落标记的判据是「决策」不是「动作」** —— 本轮被 `e2e:product-reward` 抓出的真实丢档
         路径的结构性防线：除 `already-marked`（这次不是首入）与 `equip-failed`（可重试）之外，
         每一个出口都必须 `decided = true`，否则「首入还没领奖、之后自己合成 ★2」的账号会被误清。
    */
    const keepFalse = reseed.match(/keep\([^)]*,\s*false\s*\)/g) ?? [];
    expect(keepFalse.length, '只允许 `already-marked` 这一个出口带 decided = false').toBe(1);
    expect(reseed.includes("keep('already-marked', false)"), '唯一 decided=false 的出口就是它').toBe(true);

    const growth = strip(readFileSync(join(REPO_ROOT, 'src', 'product', 'playerGrowth.ts'), 'utf8'));
    const fn = growth.slice(growth.indexOf('export function openGrowthSession('));
    const applyAt = fn.indexOf('applyR2Reseed(');
    const markAt = fn.indexOf('markR2Reseed()');
    const saveAt = fn.indexOf('saveInventory(inv)');
    expect(applyAt, 'openGrowthSession 必须调用 applyR2Reseed').toBeGreaterThan(0);
    expect(markAt, 'openGrowthSession 必须落 reseed 标记').toBeGreaterThan(0);
    expect(saveAt, '库存落盘必须存在').toBeGreaterThan(0);
    expect(markAt, '标记必须晚于判定与执行').toBeGreaterThan(applyAt);
    expect(markAt, '标记必须晚于库存落盘').toBeGreaterThan(saveAt);
    expect(fn.includes('const nextDraft: BuildDraft = reseed.draft;'), 'reseed 换过装 ⇒ 后续都用它').toBe(true);
    expect(
      fn.includes('if (reseed.decided) markR2Reseed();'),
      '标记必须由 `decided`（决策）驱动，而不是 `applied`（动作）—— 否则那四个「不动」的出口会漏标记',
    ).toBe(true);

    const page = strip(readFileSync(join(REPO_ROOT, 'src', 'product', 'homePage.ts'), 'utf8'));
    expect(page.includes('draft = growth.draft;'), '首页必须收回会话归一化后的 Build').toBe(true);
  });

  it('VR-16 标记的读写在无存储环境下是安全的（静默、不抛、判据回退）', () => {
    (globalThis as unknown as { localStorage: undefined }).localStorage = undefined;
    expect(readR2Reseed()).toBeNull();
    expect(isR2ReseedDone()).toBe(false);
    expect(hasPrototypeClaim()).toBe(false);
    expect(() => markR2Reseed()).not.toThrow();
  });
});
