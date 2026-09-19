/**
 * PRODUCT-LOOP-R1-C-END-TO-END-PLAYER-LOOP｜targeted 测试（纯 node，无浏览器）。
 *
 * 覆盖 Queue 验收里**可离线钉死**的那些（浏览器侧闭环见 `tests/_e2e_product_loop.cjs`）：
 *   1 Run Buff 不继承        → EL-20（终态开新局 = 全新 state；装备根本不在 Run 状态里）
 *   2 HP 不继承              → EL-20（新局 = ctx.playerHpMax，不是上一局剩的）
 *   3 Day 不继承             → EL-20（新局 day = 1）
 *   4 Permanent Inventory 继承 → EL-03/EL-04（产品侧读的是正式存档，Run 侧不持有库存）
 *   5 Equipped Weapon 继承   → EL-10/EL-12/EL-13（战斗真实装配 = Profile 装备）
 *   6 Reward 不重复领取      → 由 B 段 `productLoopRunReward.test.ts` + `e2e:product-reward` 负责
 *   7 Validation 入口仍独立可用 → EL-30（七个研发入口一个没少，且都不在默认启动链上）
 *
 * PRODUCT-LOOP-R1-D 追加（失败链）：
 *   8 失败**不发奖**、不动 Profile / Inventory / Equipped → EL-40 / EL-41
 *   9 失败**不隐式重开**（新 Run 只能由首页重新出发创建）  → EL-42（+ RP-D-06 的顺序守卫）
 *  10 两个出口分离（成功 = 领奖地址 / 失败 = 纯首页）      → EL-40（+ PR-07b）
 *
 * 三组结构守卫（本 Queue 的边界必须能在源码层面被钉死）：
 *   A) 装备交接口径**只有一处**：产品侧编码 ↔ Lab 侧解析，往返必须逐字段一致；
 *   B) 非法输入**必须被拒绝且可观测**（`fallback: 'invalid'`），绝不静默降级；
 *   C) Lab 侧结构上**读写不了正式存档**（白名单闭集里没有 buildPersistence / partInventory）
 *      ⇒ 「首页显示 A、战斗跑 B」不可能由「Run 自己造一份装备」产生。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { registry } from '../src/core/content';
import { computeEnergy, validateSnapshot } from '../src/core/buildValidator';
import { addPart, isOfficialPart, STARTER_PARTS, getCount } from '../src/core/partInventory';
import { buildSnapshotFromDraft, makeStarterDraft, EMPTY_SLOT, type BuildDraft } from '../src/lab/buildEditorModel';
import {
  PLAYER_BODY_DEF_ID,
  WEAPON_SLOT,
  defaultPlayerDraft,
  equipWeapon,
  loadEquippedDraft,
  loadoutReading,
  playerInventory,
} from '../src/product/playerLoadout';
import {
  LOADOUT_PARAM,
  HOME_PARAM,
  CHOICES_PARAM,
  REWARD_CHOICE_IDS,
  buildAdventureHref,
  buildRewardChoicePayload,
  encodeRunLoadout,
  newRunToken,
  parsePendingClaim,
  type RewardChoicePayload,
} from '../src/product/runReward';
import { FUSE_STACK, GROWTH_STAR } from '../src/product/playerGrowth';
import { PROFILE_CLAIMS_KEY, claimRunReward } from '../src/product/playerProfile';
import {
  RUN_FAIL_PARAM,
  parseRunFailReturn,
  runFailSettlementNow,
} from '../src/lab/portraitBattleLab/runFailSettlement';
import {
  RUN_LOADOUT_PARAM,
  hasRunLoadoutParam,
  parseExternalDraft,
  parseRunPlayerLoadout,
} from '../src/lab/portraitBattleLab/runPlayerLoadout';
import {
  buildRunStageView,
  demoRunPlayerLoadout,
  resolveRunPlayerLoadout,
  runPageContext,
  runPlanFor,
} from '../src/lab/portraitBattleLab/runPageScene';
import { RunBattleRuntime } from '../src/lab/portraitBattleLab/runBattleRuntime';
import {
  createRunPageState,
  finishRunBattle,
  pressRunAction,
  runCarriedPlayerHp,
  type RunPageState,
} from '../src/lab/portraitBattleLab/runPageState';
import { buildPriorCompletedRun } from '../src/lab/portraitBattleLab/nextRunValidation';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PRODUCT_DIR = join(REPO_ROOT, 'src', 'product');
const LAB_DIR = join(REPO_ROOT, 'src', 'lab', 'portraitBattleLab');

const readProduct = (f: string): string => readFileSync(join(PRODUCT_DIR, f), 'utf8');
const readLab = (f: string): string => readFileSync(join(LAB_DIR, f), 'utf8');
const strip = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/** 内存版 localStorage（node 无原生；与 A / B 段测试同一模式）。 */
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

/* --------------------------------------------------------------- 夹具 */

/**
 * 「玩家身上那件装备」= 正式 starter + 把主武器槽换成指定武器（走正式链路校验）。
 *
 * ⚠️ 本文件所有 EL-10 起的用例都用 `PROFILE_WEAPON`（**不在 starter 里**的一件）当装备：
 *    只有「装上去的件**不是**默认那件」才能证明装备参数真的被搬运了。
 *    R2-A 把**奖励候选**换成了 `cannon / spear / hammer`（都在 starter 里），
 *    但这个工具常量与奖励候选无关 —— 它测的是装载通道，不是奖励池。
 */
const PROFILE_WEAPON = 'laser';

function equippedDraft(weaponDefId: string): BuildDraft {
  // ⚠️ 用**产品侧真实产出**的默认车（`defaultPlayerDraft`）做底，而不是直接 `makeStarterDraft`：
  //    R1-C 起两者在 `front` 槽上不同（产品默认车把前置槽留给主武器），夹具必须跟着产品走，
  //    否则这些用例测的是一台产品**永远不会**发出去的车。
  const base = defaultPlayerDraft();
  const next: BuildDraft = {
    ...base,
    functionalSelections: { ...base.functionalSelections, [WEAPON_SLOT]: weaponDefId },
  };
  const check = validateSnapshot(buildSnapshotFromDraft(next, registry), registry);
  expect(check.valid, `夹具本身必须合法：${weaponDefId} → ${check.errors.join('；')}`).toBe(true);
  return next;
}

/**
 * 出发地址的夹具（**产品侧真实产出**，不手写参数）。
 *
 * R2-A 起终点是 3选1，产品侧交给 Run Page 的不再是「一个 back」而是「一份 choices 载荷」
 * （三条候选各自的领奖地址 + 满 stack 阈值）。夹具按同一条链路产出它。
 */
function adventureHref(token: string, draft?: BuildDraft | null): string {
  const specs = REWARD_CHOICE_IDS.map((defId) => ({ defId, star: GROWTH_STAR, countBefore: 0 }));
  return buildAdventureHref(token, buildRewardChoicePayload(token, specs, FUSE_STACK), draft);
}

/** 从出发地址里取回那份候选载荷（产品侧给全的那一份）。 */
function payloadOf(href: string): RewardChoicePayload {
  const raw = new URLSearchParams(href.split('?')[1]).get(CHOICES_PARAM) ?? '';
  expect(raw, '出发地址必须带 choices 载荷').not.toBe('');
  return JSON.parse(raw) as RewardChoicePayload;
}

/** 「玩家从首页出发」的完整搜索串（产品侧真实产出，不手写参数）。 */
function adventureSearch(draft: BuildDraft, token = newRunToken(1700000000000, 0.5)): string {
  return adventureHref(token, draft).split('?')[1] ?? '';
}

/** 直接进 Run 的那一场战斗用的玩家 Functional 件，按挂点取。 */
function functionalAt(rt: RunBattleRuntime, hardpointId: string): string | null {
  return rt.playerFunctionals().find((f) => f.hardpointId === hardpointId)?.defId ?? null;
}

/* ============================================================================
   A. 装备交接口径：产品侧编码 ↔ Lab 侧解析（往返逐字段一致）
   ============================================================================ */

describe('PRODUCT-LOOP-R1-C｜A. 局外装备的交接口径（唯一真源 + 往返一致）', () => {
  it('EL-01 产品侧编码 → Lab 侧解析：字段逐项一致（不丢字段、不改语义）', () => {
    const draft = equippedDraft(PROFILE_WEAPON);
    const parsed = parseRunPlayerLoadout(`?${adventureSearch(draft)}`);
    expect(parsed).not.toBeNull();
    expect(parsed!.source).toBe('profile');
    expect(parsed!.tag).toBe('profile-equipped');
    // 逐字段（含可选字段）——「往返一致」而不是「大致一样」
    expect(parsed!.draft.bodyDefId).toBe(draft.bodyDefId);
    expect(parsed!.draft.rearRadius).toBe(draft.rearRadius);
    expect(parsed!.draft.frontRadius).toBe(draft.frontRadius);
    expect(parsed!.draft.rearWheelDefId).toBe(draft.rearWheelDefId);
    expect(parsed!.draft.frontWheelDefId).toBe(draft.frontWheelDefId);
    expect(parsed!.draft.drive).toBe(draft.drive);
    expect(parsed!.draft.functionalSelections).toEqual(draft.functionalSelections);
    expect(parsed!.draft.functionalStars).toBe(draft.functionalStars);
    // 展示名来自正式内容库（不是字面量）
    expect(parsed!.label).toBe(registry.bodies.get(draft.bodyDefId)?.name);
    // 产品侧序列化器（`encodeRunLoadout`）是这套交接口径的**唯一产出点**：
    // 它的输出必须能被 Lab 原样解析回去（两侧共用同一份词汇，而不是各写一份 JSON）
    const viaSerializer = parseRunPlayerLoadout(
      `?${LOADOUT_PARAM}=${encodeURIComponent(encodeRunLoadout(draft))}`,
    );
    expect(viaSerializer!.draft.bodyDefId).toBe(draft.bodyDefId);
    expect(viaSerializer!.draft.functionalSelections).toEqual(draft.functionalSelections);
    const back = parseExternalDraft(JSON.parse(encodeRunLoadout(draft)));
    expect(back).not.toBeNull();
    expect(back!.functionalSelections).toEqual(draft.functionalSelections);
  });

  it('EL-02 两个参数名由两侧各自声明，且必须同值（改单边 = 静默断链）', () => {
    // 产品侧 URL 参数名
    expect(LOADOUT_PARAM).toBe('equipped');
    // Lab 侧解析用的键名
    expect(RUN_LOADOUT_PARAM).toBe('equipped');
    expect(RUN_LOADOUT_PARAM).toBe(LOADOUT_PARAM);
    // 真实链接里用的就是它（不是「常量同值但代码里写的是别的字面量」）
    const href = adventureHref('run-t-s', equippedDraft(PROFILE_WEAPON));
    expect(new URLSearchParams(href.split('?')[1]).get(LOADOUT_PARAM)).not.toBeNull();
  });

  it('EL-03 不带装备的链接形态：装备参数缺席，但**候选载荷与失败回程照给**', () => {
    const token = 'run-abc-00001';
    const plain = adventureHref(token);
    expect(plain).not.toContain(`${LOADOUT_PARAM}=`);
    expect(plain).toContain('run=run-abc-00001');
    /*
      ⚠️ R2-A 的**契约变更**（不是回归）：出发地址里**不再有**裸的 `reward=` 参数。
      终点从「领走那一件」变成 3选1 之后，三条候选的领奖地址被**整份**装进 `choices` 载荷
      （每条自己的 href 里才带 `reward=<defId>`）。因此这里断言的是**载荷的形状**，
      而不是某个 top-level 参数 —— 「三条各自的去向都真的在地址里」才是要钉死的东西。
    */
    expect(new URLSearchParams(plain.split('?')[1]).get('reward')).toBeNull();
    const payload = payloadOf(plain);
    expect(payload.stack).toBe(FUSE_STACK);
    expect(payload.choices.map((c) => c.defId)).toEqual([...REWARD_CHOICE_IDS]);
    // 解析：**没有**「带了装备参数」⇒ Run 侧走演示装载（研发入口原行为）
    const res = resolveRunPlayerLoadout(plain.split('?')[1]);
    expect(res.loadout.source).toBe('demo');
    expect(res.fallback).toBe('no-param');
    // 装备参数一旦加上，链接与解析同时切换（不是「加了但没人读」）
    const withGear = adventureHref(token, equippedDraft(PROFILE_WEAPON));
    expect(withGear).toContain(`${LOADOUT_PARAM}=`);
    expect(resolveRunPlayerLoadout(withGear.split('?')[1]).fallback).toBe('none');
    /*
      领奖解析只认 `run` + `reward` 两个 top-level 参数 ⇒ **出发地址解析不出领奖请求**。
      这条在 R2-A 之后比 R1-B 更强：出发地址现在连一个 `reward=` 都没有，
      「拿出发地址回首页 = 白拿一件」在地址层上不可能。
    */
    expect(parsePendingClaim(plain.split('?')[1] ?? '')).toBeNull();
    expect(parsePendingClaim(withGear.split('?')[1] ?? '')).toBeNull();
    // 但**每条候选自己的 href** 才是真的领奖地址：逐条都能解析回来（往返闭合）
    for (const c of payload.choices) {
      expect(parsePendingClaim(c.href.slice(c.href.indexOf('?')))).toEqual({
        runToken: token,
        rewardDefId: c.defId,
      });
    }
  });

  it('EL-04 空 / null 形态的 search 一律 =「没带参数」（研发入口原行为）', () => {
    for (const s of ['', '?', '?run=x', '?reward=laser', '?run=x&reward=laser']) {
      const res = resolveRunPlayerLoadout(s);
      expect(res.loadout.source, `search=${JSON.stringify(s)}`).toBe('demo');
      expect(res.fallback).toBe('no-param');
      expect(hasRunLoadoutParam(s)).toBe(false);
    }
  });

  it('EL-05 缺省装载 = 既有演示装载（研发入口的像素与行为来源）', () => {
    const demo = demoRunPlayerLoadout();
    const res = resolveRunPlayerLoadout('');
    expect(res.loadout.key).toBe(demo.key);
    expect(res.loadout.tag).toBe(demo.tag);
    expect(res.loadout.label).toBe(demo.label);
    // ⚠️ 缺省路径必须与「完全不给参数」时的场景口径**同源**（同一个 key ⇒ 同一次缓存）
    expect(res.loadout.key).toBe(demoRunPlayerLoadout().key);
  });
});

/* ============================================================================
   B. 非法输入必须被拒绝，且可观测（绝不静默降级）
   ============================================================================ */

describe('PRODUCT-LOOP-R1-C｜B. 非法装备输入：拒绝 + 可观测（`invalid`）', () => {
  const invalidCases: readonly [string, string][] = [
    ['不是合法 JSON', `?${LOADOUT_PARAM}=%7Bnot-json`],
    ['JSON 但不是对象', `?${LOADOUT_PARAM}=42`],
    ['缺少 bodyDefId', `?${LOADOUT_PARAM}=${encodeURIComponent(JSON.stringify({ rearRadius: 20, frontRadius: 20, functionalSelections: {} }))}`],
    ['functionalSelections 不是对象', `?${LOADOUT_PARAM}=${encodeURIComponent(JSON.stringify({ bodyDefId: 'watermelonBody', rearRadius: 20, frontRadius: 20, functionalSelections: [] }))}`],
    ['槽位选择值不是字符串', `?${LOADOUT_PARAM}=${encodeURIComponent(JSON.stringify({ bodyDefId: 'watermelonBody', rearRadius: 20, frontRadius: 20, functionalSelections: { frontMass: 7 } }))}`],
    ['半径不是有限数', `?${LOADOUT_PARAM}=${encodeURIComponent(JSON.stringify({ bodyDefId: 'watermelonBody', rearRadius: 'x', frontRadius: 20, functionalSelections: {} }))}`],
  ];

  it('EL-06 形状不合法 → 解析为 null，且 `resolve` 报 `invalid`（不是 `no-param`）', () => {
    for (const [what, search] of invalidCases) {
      expect(parseRunPlayerLoadout(search), `${what}：解析必须为 null`).toBeNull();
      // 关键：**带了**参数 ⇒ 必须与「没带」区分开（否则真实异常会伪装成研发入口）
      expect(hasRunLoadoutParam(search), `${what}：必须被识别为「带了参数」`).toBe(true);
      const res = resolveRunPlayerLoadout(search);
      expect(res.loadout.source, `${what}`).toBe('demo');
      expect(res.fallback, `${what}`).toBe('invalid');
    }
  });

  it('EL-07 形状合法但**过不了正式校验** → 同样拒绝（未知车身 / 超能量 / 空武器）', () => {
    const shapeOk = (over: Partial<BuildDraft>): string =>
      `?${LOADOUT_PARAM}=${encodeURIComponent(
        JSON.stringify({
          bodyDefId: PLAYER_BODY_DEF_ID,
          rearRadius: 20,
          frontRadius: 20,
          functionalSelections: {},
          ...over,
        }),
      )}`;

    // ① 未知车身
    const unknownBody = shapeOk({ bodyDefId: 'noSuchBody' });
    expect(parseExternalDraft(JSON.parse(decodeURIComponent(unknownBody.split('=')[1])))).not.toBeNull();
    expect(parseRunPlayerLoadout(unknownBody)).toBeNull();
    expect(resolveRunPlayerLoadout(unknownBody).fallback).toBe('invalid');

    // ② 形状通过但组合非法：参照「合法装备」把能量堆爆
    const legal = equippedDraft(PROFILE_WEAPON);
    const overloaded: BuildDraft = {
      ...legal,
      functionalSelections: { ...legal.functionalSelections, top: 'laser', front: 'laser' },
    };
    const overSnap = buildSnapshotFromDraft(overloaded, registry);
    const overEnergy = computeEnergy(overSnap, registry).energy;
    const cap = registry.bodies.get(PLAYER_BODY_DEF_ID)?.energyCapacity ?? 0;
    expect(overEnergy, '夹具必须真的超能量（否则这条断言是空转）').toBeGreaterThan(cap);

    const overSearch = shapeOk({ functionalSelections: overloaded.functionalSelections });
    expect(parseRunPlayerLoadout(overSearch)).toBeNull();
    expect(resolveRunPlayerLoadout(overSearch).fallback).toBe('invalid');
  });

  it('EL-08 `invalid` 的后果是「退回演示装载」，而**不是**「半份装备」', () => {
    const res = resolveRunPlayerLoadout(`?${LOADOUT_PARAM}=%7Bnot-json`);
    const demo = demoRunPlayerLoadout();
    // 退回的是**完整**的演示 draft（可以真的拿去构建计划），不是残缺对象
    expect(res.loadout.draft).toEqual(demo.draft);
    expect(() => runPlanFor('ProtoRusher', res.loadout)).not.toThrow();
  });
});

/* ============================================================================
   C. 战斗真的用这份装备（Queue 的测试锁）
   ============================================================================ */

describe('PRODUCT-LOOP-R1-C｜C. 本局战斗真实使用「局外 Equipped」', () => {
  it('EL-09 真实装备 ≠ 演示装备：spawn 计划必须**不同**（不共用同一份基础数据）', () => {
    const profile = parseRunPlayerLoadout(`?${adventureSearch(equippedDraft('laser'))}`);
    expect(profile).not.toBeNull();
    const demoPlan = runPlanFor('ProtoRusher', demoRunPlayerLoadout());
    const profilePlan = runPlanFor('ProtoRusher', profile!);
    expect(profilePlan.baseKey).not.toBe(demoPlan.baseKey);
    expect(profilePlan.loadoutId).toBe('profile-equipped');
    // 对手一侧不受玩家装备影响（只换玩家那一侧）
    expect(profilePlan.enemies[0].bodyDefId).toBe(demoPlan.enemies[0].bodyDefId);
    expect(profilePlan.enemies[0].hp).toBe(demoPlan.enemies[0].hp);
  });

  it('EL-10 `RunBattleRuntime` 真实装配：主武器槽 = 交进来的那件', () => {
    const draft = equippedDraft('laser');
    const rt = new RunBattleRuntime({
      encounterId: 'ProtoRusher',
      playerDraft: draft,
      playerLoadoutTag: 'profile-equipped',
    });
    try {
      expect(functionalAt(rt, WEAPON_SLOT)).toBe('laser');
      // 正式 resolved 快照也一致（不是只有一份 Lab 侧的口径）
      const weapons = rt.playerFunctionals().filter((f) => f.category === 'weapon');
      expect(weapons.map((w) => w.defId).sort()).toEqual(['hammer', 'laser']);
      expect(weapons.every((w) => isOfficialPart(w.defId))).toBe(true);
    } finally {
      rt.dispose();
    }
  });

  it('EL-11 缺省（不给 playerDraft）⇒ 逐字节回落到 Lab 演示装载', () => {
    const rt = new RunBattleRuntime({ encounterId: 'ProtoRusher' });
    try {
      // 演示装载 `WatermelonHeavyCannon` 的主武器是炮（装在 front 槽），因此按挂点比对
      const demoPlan = runPlanFor('ProtoRusher', demoRunPlayerLoadout());
      expect(rt.plan.loadoutId).toBe('WatermelonHeavyCannon');
      expect(rt.plan.baseKey).toBe(demoPlan.baseKey);
      expect(functionalAt(rt, 'front')).toBe('cannon');
    } finally {
      rt.dispose();
    }
  });

  it('EL-11b 产品默认车把「前端挂点」留给主武器（R1-C 主循环可行性处置；正式 starter 一字未改）', () => {
    const d = defaultPlayerDraft();
    // 默认车：前置槽留空（否则推杆与 `frontMass` 主武器几何重叠、并被反推推出射程 ⇒ 第一场必输）
    expect(d.functionalSelections['front']).toBe(EMPTY_SLOT);
    // 主武器槽仍是 starter 的那一件（默认主武器不受影响）
    expect(d.functionalSelections[WEAPON_SLOT]).toBe('cannon');
    // 推杆仍在**正式库存**里（内容没删，只是不装在默认车上）
    expect(STARTER_PARTS).toContain('pushRod');
    // ⚠️ 冻结面：正式 gameplay 的 starter（`makeStarterDraft`）在 `front` 上仍然是推杆
    const starter = makeStarterDraft(PLAYER_BODY_DEF_ID, registry);
    expect(starter.functionalSelections['front']).toBe('pushRod');
    // 除 `front` 一槽外，默认车与正式 starter 逐槽相同
    for (const [hp, id] of Object.entries(starter.functionalSelections)) {
      if (hp === 'front') continue;
      expect(d.functionalSelections[hp], `槽 ${hp} 不应被改动`).toBe(id);
    }
  });

  it('EL-12 换装备 ⇒ 同一 Encounter 得到**另一份**计划（第二局不会沿用第一局装配）', () => {
    const loadoutFor = (w: string) => parseRunPlayerLoadout(`?${adventureSearch(equippedDraft(w))}`)!;
    const a = loadoutFor('cannon');
    const b = loadoutFor('laser');
    const planA = runPlanFor('ProtoRusher', a);
    const planB = runPlanFor('ProtoRusher', b);
    expect(planA.baseKey).not.toBe(planB.baseKey);
    // 缓存确实按装载身份分开（同一次调用返回同一对象 = 真的在缓存，不是每次重算）
    expect(runPlanFor('ProtoRusher', a)).toBe(planA);
    expect(runPlanFor('ProtoRusher', b)).toBe(planB);
  });

  it('EL-12b 视觉盒缓存按**装备内容**分键（换武器不会画出上一局的旧件）', () => {
    /*
      ⚠️ 这是本 Queue 开发期**实测踩到过**的真实缺陷的回归守卫：
         待机近景的视觉盒缓存原先按 `entityId:snapshot.id` 分键，而两者对
         「同一个挂点上的不同装备」是同一个值（车身没变、装载标签都是 profile-equipped）
         ⇒ 换上**无 sprite** 的激光后仍然画出 `part_cannon`（实测）。
         修复 = 缓存键改用实体内容指纹 `entityBaseKey`。
      本用例按「先无 sprite 后带 sprite 再回来」的顺序跑，把顺序依赖一起钉住。
    */
    const loadoutFor = (w: string) => parseRunPlayerLoadout(`?${adventureSearch(equippedDraft(w))}`)!;
    const idsOf = (w: string): readonly string[] =>
      buildRunStageView(loadoutFor(w)).player.visuals.map((v) => v.visualId ?? v.defId ?? '');

    const laserFirst = idsOf('laser');
    const cannonThen = idsOf('cannon');
    const laserAgain = idsOf('laser');
    expect(cannonThen).toContain('part_cannon');
    expect(laserFirst).not.toContain('part_cannon');
    expect(laserAgain).not.toContain('part_cannon');
    // 三者的可视件集合与顺序都稳定（缓存没有串味）
    expect(laserAgain).toEqual(laserFirst);
  });

  it('EL-13 `runPageContext` / 待机舞台都读本局装载（HP 上限与展示名同源）', () => {
    const draft = equippedDraft('laser');
    const loadout = parseRunPlayerLoadout(`?${adventureSearch(draft)}`)!;
    const ctx = runPageContext(loadout);
    const plan = runPlanFor('ProtoRusher', loadout);
    expect(ctx.playerHpMax).toBe(plan.player.hp);
    expect(ctx.vehicleLabel).toBe(loadout.label);

    // 待机近景：玩家那辆车来自本局装载（不同装备 ⇒ 视觉外接框或缩放随真实几何变化，
    // 至少必须能算出来且不等于演示装载的缓存结果）
    const view = buildRunStageView(loadout);
    expect(view.player.visuals.length).toBeGreaterThan(0);
    expect(view.scale).toBeGreaterThan(0);
    // 缺省 = 演示装载（既有调用点行为不变）
    expect(buildRunStageView().player.visuals.length).toBeGreaterThan(0);
  });

  it('EL-14 产品侧：装备在**出发那一刻**才读（车库换装后 href 必须跟着变）', () => {
    const code = strip(readProduct('homePage.ts'));
    // 地址必须是「函数 + 每次 render 重算」，不是挂载时算一次的常量
    expect(code.includes('const adventureHrefNow = ()')).toBe(true);
    expect(code.includes('start.href = adventureHrefNow();')).toBe(true);
    expect(code.includes('const adventureHref = buildAdventureHref(')).toBe(false);
    // 探针与按钮同源（探针也走同一个函数）
    expect(code.includes('adventureHref: adventureHrefNow(),')).toBe(true);
    // 旧措辞（「Run 仍用固定 demo loadout」）必须已被删掉 —— 那已经不是事实了
    expect(readProduct('homePage.ts').includes('Run 仍用固定 demo loadout')).toBe(false);
  });
});

/* ============================================================================
   D. 局外装备 ≠ 局内 Buff（Queue 必改 3）＋ 第二局状态干净（必改 4）
   ============================================================================ */

describe('PRODUCT-LOOP-R1-C｜D. 局内 Modifier 与局外永久装备的边界', () => {
  it('EL-20 Run 强化在正式内容库里查无此件 ⇒ 结构上装不进永久装备', () => {
    for (const runBuff of ['heavyShell', 'twinCannon', 'fastReload', 'tripleLoad']) {
      expect(registry.functionals.has(runBuff), `${runBuff} 不应是正式部件`).toBe(false);
      expect(isOfficialPart(runBuff)).toBe(false);
    }
    // 反向：本局用的真武器全部是正式件
    for (const w of ['cannon', 'hammer', 'laser']) {
      expect(isOfficialPart(w)).toBe(true);
    }
  });

  it('EL-21 装备**不在** Run 状态里：新局重置 Run-local 状态，装备天然保留', () => {
    const demo = demoRunPlayerLoadout();
    const fresh = createRunPageState(runPageContext(demo));
    // Run 状态里没有「装备」字段（局外装备不属于这一局的状态）——
    // 因此「新局清空 Run 状态」不可能顺手把永久装备也清掉。
    const keys = Object.keys(fresh).sort();
    expect(keys.some((k) => /equip|loadout|owned|inventory/i.test(k))).toBe(false);
    // Run-local 的三件事确实在状态里（它们才是「新局要清空」的东西）
    expect(keys).toContain('buffs');
    expect(keys).toContain('repairBonus');
    expect(keys).toContain('day');
  });

  it('EL-22 终局 → 再按主动作 = 全新一局：Day / HP / Run Buff / 维修补偿全部归零', () => {
    const loadout = parseRunPlayerLoadout(`?${adventureSearch(equippedDraft('laser'))}`)!;
    const ctx = runPageContext(loadout);
    const done = buildPriorCompletedRun(ctx);
    expect(done.phase).toBe('COMPLETE');

    // 上一局确实攒了东西（否则「清零」这条断言是空转）
    expect(done.day).toBeGreaterThan(1);
    expect(done.buffs.length).toBeGreaterThan(0);
    // 上一局终局时确实带着「残血 / 已用过的耐久」这一事实（跨战斗耐久的来源）
    expect(runCarriedPlayerHp(done)).not.toBeNull();

    const next: RunPageState = pressRunAction(done, ctx);
    expect(next).not.toBe(done);
    expect(next.day).toBe(1);
    expect(next.buffs).toEqual([]);
    expect(next.repairBonus).toBe(0);
    expect(next.battlesCompleted).toBe(0);
    expect(next.phase).toBe('IDLE');
    expect(next.battle).toBeNull();
    // HP：新局从**满耐久**开始 —— 不是上一局剩下的那点血
    expect(runCarriedPlayerHp(next)).toBeNull();
    // 一路推到新局的第一场真实战斗（节点节拍：IDLE → … → EVENT → BATTLE）
    let s: RunPageState = next;
    let presses = 0;
    while (s.phase !== 'BATTLE' && presses < 6) {
      s = pressRunAction(s, ctx);
      presses += 1;
    }
    expect(s.phase, `推到第一场战斗用了 ${presses} 次推进`).toBe('BATTLE');
    expect(s.battle?.playerHp).toBe(ctx.playerHpMax);
    expect(s.battle?.steps).toBe(0);
    // 耐久上限也来自**本局装载**（不是写死的）
    expect(s.battle?.playerHpMax).toBe(ctx.playerHpMax);

    // 上一局对象**没有被就地改写**（两个独立对象 —— 这是「不继承」的结构保证）
    expect(done.day).toBeGreaterThan(1);
    expect(done.buffs.length).toBeGreaterThan(0);
  });

  it('EL-23 第一层强化只是本局临时状态：不落盘、不进任何存档 key', () => {
    // `runModifiers` 的层 id 只在内存 overlay registry 里注册（B 段已钉死 overlay 语义）；
    // 本 Queue 追加的判据：Run 侧**不持有任何存档读写能力**（见 EL-31 的白名单断言）。
    const code = strip(readLab('runModifiers.ts'));
    expect(code.includes('localStorage')).toBe(false);
    expect(readLab('runPageState.ts').includes('localStorage')).toBe(false);
  });
});

/* ============================================================================
   E. 源码守卫（边界 / 冻结项 / 唯一真源）
   ============================================================================ */

describe('PRODUCT-LOOP-R1-C｜E. 源码守卫', () => {
  it('EL-30 七个研发 / 验证入口一个都没少（Queue 必改 1「不要删除」）', () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    for (const [script, page] of [
      ['dev:run-page', '/run-page.html'],
      ['dev:validation', '/validation-hub.html'],
      ['dev:next-run', '/next-run.html'],
      ['dev:encounter-lab', '/encounter-lab.html'],
      ['dev:content-batch', '/content-batch.html'],
      ['dev:debug-lab', '/portrait-lab.html'],
      ['dev:legacy', '/index.html'],
      ['dev:home', '/home.html'],
    ] as const) {
      expect(pkg.scripts[script], `${script} 必须仍存在`).toBe(`vite --open=${page}`);
    }
    expect(pkg.scripts['dev']).toBe('vite --open');
    // 新闭环 smoke 有自己的脚本（本 Queue 的「一次完整 E2E」入口）
    expect(pkg.scripts['e2e:product-loop']).toBe('node tests/_e2e_product_loop.cjs');
  });

  it('EL-31 Lab 侧结构上读写不了正式存档（白名单里没有持久化模块）', () => {
    const src = strip(readLab('runPlayerLoadout.ts'));
    for (const banned of ['buildPersistence', 'partInventory', 'saveVersion', 'localStorage']) {
      expect(src.includes(banned), `runPlayerLoadout.ts 不得引用 ${banned}`).toBe(false);
    }
    // 只 import 白名单模块（Lab 闭集守卫 R22a-1 已覆盖全目录，这里显式复述本文件）
    const specs = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(specs.sort()).toEqual(
      ['../../core/buildValidator', '../../core/content', '../buildEditorModel'].sort(),
    );
  });

  it('EL-32 Lab 侧仍然 0 处产品地址字面量（产品 URL 只有产品侧一个真源）', () => {
    for (const f of ['runPlayerLoadout.ts', 'runPageScene.ts', 'runMain.ts', 'runBattleRuntime.ts']) {
      const code = strip(readLab(f));
      for (const banned of ['.html', 'http://', 'https://']) {
        expect(code.includes(banned), `${f} 不得含地址字面量 ${banned}`).toBe(false);
      }
    }
    // 产品地址唯一真源：`runReward.ts` 里 ADVENTURE_HREF 恰一次
    const reward = strip(readProduct('runReward.ts'));
    expect(reward.split("'./run-page.html'").length - 1).toBe(1);
    // 页面不得自己硬编码地址（必须走 buildAdventureHref）
    const home = strip(readProduct('homePage.ts'));
    expect(home.includes('./run-page.html')).toBe(false);
    expect(home.includes('buildAdventureHref(')).toBe(true);
  });

  it('EL-33 默认入口 = 产品首页，且 Run 入口降级为显式入口（必改 1 的机器判据）', () => {
    const entry = strip(readFileSync(join(REPO_ROOT, 'build', 'branchDevEntry.ts'), 'utf8'));
    expect(entry.includes("'/home.html'")).toBe(true);
    expect(entry.includes("'/run-page.html'")).toBe(false);
    // 反查：Lab 侧的 Run 页宿主仍真实存在（降级 ≠ 删除）
    expect(readFileSync(join(REPO_ROOT, 'run-page.html'), 'utf8').includes('/src/lab/portraitBattleLab/runMain.ts')).toBe(true);
    expect(readFileSync(join(REPO_ROOT, 'home.html'), 'utf8').includes('/src/product/homeMain.ts')).toBe(true);
  });

  it('EL-34 冻结面：本 Queue 不改 Run 节奏 / 相机 / 战斗 / Buff 数值', () => {
    // 玩家装载只替换 `BuildDraft` 一个输入；以下文件本轮**不应**出现与本 Queue 相关的改动痕迹
    for (const f of ['runScript.ts', 'runModifiers.ts', 'runPageLayout.ts', 'runBattleView.ts']) {
      const code = strip(readLab(f));
      for (const banned of ['playerDraft', 'profile-equipped', 'RunPlayerLoadout', 'equipped']) {
        expect(code.includes(banned), `${f} 不应涉及本 Queue 的装备接线`).toBe(false);
      }
    }
    // Run 节奏（脚本节点 / 总场数）与相机契约没有被本 Queue 触碰
    const state = strip(readLab('runPageState.ts'));
    expect(state.includes('playerDraft')).toBe(false);
    expect(state.includes('RunPlayerLoadout')).toBe(false);
  });

  it('EL-35 库存口径不变：Run 拿到的装备必须是玩家**真实拥有**的件', () => {
    // EL-10/EL-12 用的那件是「初始不拥有」的件 ⇒ 用真实库存链验证「先拥有才能装」
    const before = loadEquippedDraft();
    const invBefore = playerInventory(before);
    expect(getCount(invBefore, PROFILE_WEAPON, 1)).toBe(0);
    expect(STARTER_PARTS).not.toContain(PROFILE_WEAPON);

    // 走上正式装备链路（会写正式 playerBuild 存档）→ 之后才可能把它交进 Run
    const outcome = equipWeapon(PROFILE_WEAPON, before, playerInventory(makeStarterDraft(PLAYER_BODY_DEF_ID, registry)));
    // 没拥有 ⇒ 拒绝（`not-owned`）；拥有（EL-10 的夹具）才允许 —— 两条路径都不是「随便传什么都行」
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('not-owned');

    // 真实拥有之后：`loadoutReading` 把它列为可装备，且能量读数真实变化
    const owned = playerInventory(makeStarterDraft(PLAYER_BODY_DEF_ID, registry));
    addPart(owned, PROFILE_WEAPON, 1, 1); // 走正式入库函数（不是手改对象）
    const reading = loadoutReading(equippedDraft(PROFILE_WEAPON), owned);
    expect(reading.weapons.map((w) => w.defId)).toContain(PROFILE_WEAPON);
    expect(reading.equippedWeaponId).toBe(PROFILE_WEAPON);
    // 装上它之后能量读数真的变了（「装上它不一样」的机器判据）
    const withoutIt = loadoutReading(equippedDraft('cannon'), owned).energy;
    expect(reading.energy).not.toBe(withoutIt);
  });
});

/* ============================================================================
   G. 失败链（PRODUCT-LOOP-R1-D）：不发奖 / 不动局外三件套 / 不隐式重开
   ============================================================================ */

describe('PRODUCT-LOOP-R1-D｜G. 失败链：两个出口分离、不发奖、不隐式重开', () => {
  /** 三份正式存档 key（与 src 同值；E2E 侧另有一份不经过页面的独立取证）。 */
  const BUILD_KEY = 'strongfruit.playerBuild.v1';
  const INV_KEY = 'strongfruit.ownedParts.v2';

  it('EL-40 出发链接同时给出「成功有哪几个去处」与「失败回哪儿」，且失败地址解析不出领奖请求', () => {
    const token = newRunToken(1700000000000, 0.5);
    const href = adventureHref(token, equippedDraft('cannon'));
    const q = new URLSearchParams(href.split('?')[1]);
    const payload = payloadOf(href);
    const home = q.get(HOME_PARAM) ?? '';
    /*
      ⚠️ R2-A 的**契约变更**：成功侧不再是「一个 back」，而是 `choices` 里**每条候选各自的**
      领奖地址（三条 defId 不同 ⇒ 目的地必然不同）。因此这里逐条钉死，而不是取一个 top-level 参数。
    */
    expect(payload.choices.length, '终点 3选1 ⇒ 必须有三条候选').toBe(3);
    expect(home, '失败出口（纯首页）必须给全').not.toBe('');
    for (const c of payload.choices) {
      expect(c.href, `候选 ${c.defId} 的领奖地址必须给全`).not.toBe('');
      // 每条都是一条**真的**领奖地址（首页会执行一次幂等入库）
      expect(parsePendingClaim(c.href.slice(c.href.indexOf('?')))).toEqual({
        runToken: token,
        rewardDefId: c.defId,
      });
      // 三条互不相同（同一个地址发三遍 = 三选一是假的）
      expect(c.href).not.toBe(home);
    }
    expect(new Set(payload.choices.map((c) => c.href)).size).toBe(3);
    // 失败出口 = 解析不出领奖请求（首页什么都不做）
    expect(parsePendingClaim(home.slice(home.indexOf('?')))).toBeNull();
    // Lab 侧两侧参数名同值（改单边 = 静默断链）
    expect(RUN_FAIL_PARAM).toBe(HOME_PARAM);
    expect(parseRunFailReturn(`?${q.toString()}`)).toEqual({ href: home });

    /*
      产品 → Lab 的完整接线（离线版）：拿**产品链接里那个失败地址**去喂一个**真实 FAILED 状态**，
      结算给出的出口必须**逐字**就是这个地址（不是 Lab 自己编的第二个地址）。
    */
    const failReturn = parseRunFailReturn(`?${q.toString()}`)!;
    const ctx = runPageContext(resolveRunPlayerLoadout(`?${q.toString()}`).loadout);
    let s: RunPageState = createRunPageState(ctx);
    for (let i = 0; i < 6 && s.phase !== 'BATTLE'; i++) s = pressRunAction(s, ctx);
    expect(s.phase).toBe('BATTLE');
    const failed = finishRunBattle(s, {
      winner: 'B',
      endReason: 'hp',
      playerHp: 0,
      enemyHp: 900,
      steps: 300,
    });
    expect(failed.phase).toBe('FAILED');
    expect(runFailSettlementNow(failed, failReturn)!.href).toBe(home);
    // 宿主没给地址 ⇒ 结算照常出现，但没有出口（研发入口）
    expect(runFailSettlementNow(failed, null)!.title.length).toBeGreaterThan(0);
    expect(runFailSettlementNow(failed, null)!.href).toBe('');
    // 非失败状态恒无结算（COMPLETE 也不该有）
    const done = buildPriorCompletedRun(ctx);
    expect(runFailSettlementNow(done, failReturn)).toBeNull();
  });

  it('EL-41 失败链**不发奖**：失败回首页的地址一个字节都改不了存档（成功链对照）', () => {
    // ① 建一份真实存档基线（starter 库存 + 玩家 Build，都走正式入口）
    const before = loadEquippedDraft();
    playerInventory(before);
    const baseline = {
      build: store.getItem(BUILD_KEY),
      inv: store.getItem(INV_KEY),
      claims: store.getItem(PROFILE_CLAIMS_KEY),
    };

    const token = newRunToken(1700000000000, 0.5);
    const payload = payloadOf(adventureHref(token));
    const q = new URLSearchParams(adventureHref(token).split('?')[1]);
    const home = q.get(HOME_PARAM) ?? '';

    // ② 玩家从**失败页**回首页：search 里只有 `home` ⇒ 解析不出领奖请求 ⇒ 页面不会入库
    const failClaim = parsePendingClaim(home.slice(home.indexOf('?')));
    expect(failClaim, '失败回程地址必须解析不出领奖请求').toBeNull();
    // ⚠️ R2-A：成功侧是 `choices` 载荷，**出发地址本身**也解析不出领奖请求
    //    （裸 `reward=` 参数已经不存在）—— 白拿一件在地址层上不可能。
    expect(parsePendingClaim(q.toString())).toBeNull();

    /*
      ③ 对照（证明 ② 不是空转）：玩家**真的在局内选了一件**（= 跳到那件自己的领奖地址）时，
      同一条链会入库。R2-A 起「选哪件」是玩家的选择，因此这里逐个候选各验证一次
      「它的地址真的能入库那件」——但不能都领（同一局只能领一次，见下一段）。
    */
    const first = payload.choices[0];
    const okClaim = parsePendingClaim(first.href.slice(first.href.indexOf('?')) ?? '');
    expect(okClaim).toEqual({ runToken: token, rewardDefId: first.defId });
    const out = claimRunReward(okClaim!);
    expect(out.ok).toBe(true);
    expect(store.getItem(INV_KEY), '成功链真的写了库存').not.toBe(baseline.inv);
    expect(store.getItem(PROFILE_CLAIMS_KEY), '成功链真的写了领奖账本').not.toBeNull();
    // ④ **同一局只能领一次**：另外两条候选的地址现在一律落 `already-claimed` 且零副作用
    const invAfterFirst = store.getItem(INV_KEY);
    for (const other of payload.choices.slice(1)) {
      const again = parsePendingClaim(other.href.slice(other.href.indexOf('?')) ?? '');
      expect(again!.runToken, '三条候选必须共用同一个本局 token').toBe(token);
      const rej = claimRunReward(again!);
      expect(rej.ok, `候选 ${other.defId} 不得在同一局里再发一次`).toBe(false);
      expect(rej.reason).toBe('already-claimed');
      expect(store.getItem(INV_KEY), '被拒绝的领取不许改库存').toBe(invAfterFirst);
    }
    // 装备没有被成功链顺手改掉（失败链更是没碰过）
    expect(loadEquippedDraft().functionalSelections[WEAPON_SLOT]).toBe(
      before.functionalSelections[WEAPON_SLOT],
    );
  });

  it('EL-42 失败后**不隐式重开**：策略模块与页面都没有「开新局」这条边', () => {
    // ① 策略模块结构上没有创建新 Run 的能力
    const mod = strip(readLab('runFailSettlement.ts'));
    for (const t of ['createRunPageState', 'pressRunAction', 'nextRun', 'restart']) {
      expect(mod.includes(t), `runFailSettlement.ts 不得出现 ${t}`).toBe(false);
    }
    // ② 宿主：失败回路只有**一次**数据驱动的整页导航，没有第二条分支
    const host = strip(readLab('runMain.ts'));
    const failBranch = host.slice(host.indexOf('onFailReturn:'));
    expect(failBranch.includes('location.assign(action.href);')).toBe(true);
    expect(failBranch.split('location.assign(').length - 1, '失败回调里只能有一次导航').toBe(1);
    // ③ 页面：失败终态不引用状态机的「重开」文案（失败页不提供重开入口）
    const page = strip(readLab('runPage.ts'));
    expect(page.includes('RUN_RESTART_LABEL')).toBe(false);
    expect(page.includes('RUN_FAIL_RETURN_LABEL')).toBe(true);
    expect(page.includes('this.failSettlementNow()')).toBe(true);
    // ④ 唯一的「新 Run 起点」仍然是首页的开始冒险地址（产品侧唯一真源）
    const homePage = strip(readProduct('homePage.ts'));
    expect(homePage.includes('buildAdventureHref(')).toBe(true);
    expect(homePage.includes('./run-page.html'), '页面不得自己造地址').toBe(false);
  });
});
