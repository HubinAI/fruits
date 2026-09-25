/**
 * PRODUCT-LOOP-R3-MOVEMENT-PRODUCT-LOOP-SURFACE｜targeted **契约** 测试（纯 node，无浏览器）。
 *
 * ── 本 Queue 要证的四件事 ────────────────────────────────────────────────────
 *   ① **Home / Garage 能明确确认当前 rear / front**（`PS-01` / `PS-02`）；
 *   ② **reload 后显示与 persisted BuildDraft 一致**（`PS-03`）；
 *   ③ **Product Run encoded Snapshot 与当前 rear / front 一致**（`PS-04` / `PS-05`）——
 *      三方一致：`Home/Garage 读数 === persisted BuildDraft === Run encoded Snapshot`；
 *   ④ **非法 persisted Movement 不存在 silent Runtime fallback**（`PS-06` / `PS-07` / `PS-08`）。
 *
 * ── 为什么这组断言不是「把上一轮的测试抄一遍」────────────────────────────────
 *   上一轮（`productMovementGarageEquip` / `productRunMovementCanonical`）证的是
 *   「**能不能装 / 装完 Run 收到的是不是它**」。本轮证的是另一件事：
 *   **产品主线表面上「能不能看见并确认」**，以及**非法存档会不会被悄悄修好**。
 *   两者的失败模式不同 —— 前者失败是「装备没用」，后者失败是
 *   「玩家存档坏了但局内居然还能开打，用的还是默认轮」。
 *
 * ── 关于「silent fallback」的判据（本文件的核心）────────────────────────────
 *   禁止的是**静默替换**，不是「拒绝启动」。合法判据只有两条：
 *     - 非法 ⇒ 整份拒绝（`parseRunPlayerLoadout` 返回 `null`），Run **不开**；
 *     - 合法 ⇒ 原样交给 Runtime，一个字段都不改。
 *   ⚠️ 因此下面 `PS-06` 特意断言的是 `null` **而不是**「回退成 wheelStd 后能跑」——
 *      后者才是被禁止的行为。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { registry } from '../src/core/content';
import {
  OFFICIAL_MOVEMENTS,
  getCount,
  loadInventoryRaw,
  saveInventory,
  type PartInventory,
} from '../src/core/partInventory';
import { loadPlayerBuild, savePlayerBuild } from '../src/core/buildPersistence';
import { EMPTY_SLOT, makeStarterDraft, type BuildDraft } from '../src/lab/buildEditorModel';
import { markR2Onboarding } from '../src/product/r2Onboarding';
import { markR2Reseed } from '../src/product/r2Reseed';
import {
  PLAYER_BODY_DEF_ID,
  equipMovement,
  movementReading,
  playerInventory,
  type MovementReading,
} from '../src/product/playerLoadout';
import { buildAdventureHref } from '../src/product/runReward';
import { canonicalMovementDefIds, defaultMovementDefId } from '../src/product/runMovementCanonical';
import { parseRunPlayerLoadout } from '../src/lab/portraitBattleLab/runPlayerLoadout';
import { buildSpawnPlanFromDraft } from '../src/lab/portraitBattleLab/entities';
import { RUN_DEMO_ENCOUNTER_ID } from '../src/lab/portraitBattleLab/runPageScene';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PRODUCT_DIR = join(REPO_ROOT, 'src', 'product');

/** 剥注释（本项目铁律：注释里的自指文字会骗过字符串匹配）。 */
function strip(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
const readProduct = (f: string): string => readFileSync(join(PRODUCT_DIR, f), 'utf8');

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

beforeEach(() => {
  (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();
});

/**
 * 预置两份**一次性迁移**的标记（`r2Onboarding` / `r2Reseed`），并把一份真实的
 * starter Build **落盘** —— 本文件要验的是「产品主线表面 + 非法存档拒绝」，
 * 不是迁移本身；不隔离的话迁移会在 `loadPlayerBuild()` 时介入，把测的东西变成迁移结果。
 *
 * ⚠️ 返回值是**落盘后重新读出来**的那一份（不是内存里的对象）：
 *    后面所有断言都应以「存档里真实是什么」为起点。
 */
function seedAccount(): BuildDraft {
  markR2Onboarding();
  markR2Reseed();
  const starter = makeStarterDraft(PLAYER_BODY_DEF_ID, registry);
  savePlayerBuild(starter);
  const back = loadPlayerBuild();
  expect(back, '前置：starter Build 必须能落盘并被读回').not.toBeNull();
  return back as BuildDraft;
}

/** 每个用例的统一起点 = 一份已落盘的合法 starter Build（无轮组字段 ⇒ 两侧皆缺省轮）。 */
function baseDraft(): BuildDraft {
  return seedAccount();
}

/** 两件**彼此不同**、且**能同时装到两个挂点**（不超载）的正式轮组。 */
function twoCompatibleMovements(): [string, string] {
  const cap = registry.bodies.get(PLAYER_BODY_DEF_ID)?.energyCapacity ?? 0;
  const sorted = [...OFFICIAL_MOVEMENTS]
    .map((id) => ({ id, energy: registry.movements.get(id)?.energy ?? Number.POSITIVE_INFINITY }))
    .sort((a, b) => a.energy - b.energy);
  for (const a of sorted) {
    for (const b of sorted) {
      // ⚠️ 必须是**不同**的 defId：若两侧取同一件，「写反了」这类缺陷测不出来
      if (a.id === b.id) continue;
      // starter Build 已占 75/110，留出余量：两轮合计不超过容量的 1/3
      if (a.energy + b.energy <= cap / 3) return [a.id, b.id];
    }
  }
  throw new Error('找不到两件既不超载又互不相同的轮组 —— 正式内容库或能量规则变了');
}

/** 库存 key（与 `core/partInventory` 同值）—— 授予必须写**盘**，否则重读看不到。 */
const INV_KEY = 'strongfruit.ownedParts.v2';

/**
 * 往正式库存 key 里**真的**授予一件轮组（★1）。
 *
 * ⚠️ 必须直接写 storage，不能只改内存里的 `inv` 对象：
 *    `equipMovement` 的第二件装备会经 `playerInventory(draft)` **重新从盘上读**，
 *    只改内存那次授予会被读丢掉 ⇒ 第二件报 `not-owned`
 *    （实测踩过：rear=smallWheel 成功、front=largeWheel 报「库存里没有」）。
 */
function grantMovement(defId: string, n = 1): void {
  const inv = JSON.parse(localStorage.getItem(INV_KEY) ?? '{}') as Record<string, { one?: number }>;
  const row = inv[defId] ?? {};
  row.one = (row.one ?? 0) + n;
  inv[defId] = row;
  localStorage.setItem(INV_KEY, JSON.stringify(inv));
}

/* ================================================================== 三方读数 */

/**
 * 一方的读数 = **Home / Garage 摘要看到的那个值**。
 *
 * ⚠️ 刻意走 `movementReading()`（页面的探针与 Movement 区**画的就是这些字段**），
 *    而不是测试自己从 draft 上 `.rearWheelDefId` 抠 —— 后者会把「页面读错了」
 *    这类缺陷一起放过（期望值与被测对象同错）。
 */
function surfaceSide(draft: BuildDraft): MovementReading {
  return movementReading(draft, playerInventory(draft));
}

/** 二方读数 = **落盘存档里的真实字段**（不经任何函数，直接读 JSON）。 */
function persistedSide(): Record<string, unknown> {
  const raw = localStorage.getItem('strongfruit.playerBuild.v1');
  expect(raw, '此处必须先有一次真实落盘（否则这条断言没有意义）').not.toBeNull();
  return JSON.parse(raw as string) as Record<string, unknown>;
}

/**
 * 三方读数 = **Product Run encoded Snapshot** —— 真实产品地址上的 `equipped=`
 * 载荷，再经真实解析器与真实 Runtime 计划。
 */
function runSide(draft: BuildDraft) {
  const href = buildAdventureHref('run-ps', { stack: 5, choices: [] }, draft);
  const search = href.slice(href.indexOf('?'));
  const parsed = parseRunPlayerLoadout(search);
  if (!parsed) return { parsed: null, encoded: null, entity: null } as const;
  const plan = buildSpawnPlanFromDraft(parsed.draft, 'profile-equipped', RUN_DEMO_ENCOUNTER_ID);
  const encoded = JSON.parse(
    new URLSearchParams(search).get('equipped') as string,
  ) as Record<string, unknown>;
  return { parsed, encoded, entity: plan.player } as const;
}

/** 该挂点在「存档字段」上的**规范值**：`undefined` = 缺省轮（合法）、否则原值。 */
function storedFieldOf(draft: BuildDraft, hp: 'rear' | 'front'): string | undefined {
  return hp === 'rear' ? draft.rearWheelDefId : draft.frontWheelDefId;
}

/** 该挂点在 `movementReading` 上的 effective defId（`null` = 存档里没这个键 ⇒ 缺省轮）。 */
function readingEffective(r: MovementReading, hp: string): string | null {
  return r.slots.find((s) => s.hardpointId === hp)?.effectiveDefId ?? null;
}

/* ================================================================== PS-01..03 可见性 */

describe('PS-01..03｜Home / Garage 能明确确认当前 rear / front（验收 1 / 2）', () => {
  it('PS-01 Home 首页**真的画出了** rear / front 两项 Movement（不是只有 Garage 有）', () => {
    const page = strip(readProduct('homePage.ts'));
    /*
      ⚠️ 判据必须是「首页**视图**里真的有一段落画 Movement 摘要」，而不是
         「文件里出现了 `movementReading(` 这个函数名」—— 后者在函数**只被 Garage 调用**
         时同样会通过（那是本 Queue 之前的状态，也就是这条测试要防的回归）。

      因此分三层钉：
        ① 挂点：首页摘要带 `data-ph-home-movement*`（E2E / 探针定位用，不靠文案）；
        ② 数据：摘要里逐 `slot` 遍历 `movementReading(...)` 的结果（不是硬编码两个名字）；
        ③ 词汇：沿用 Garage 已有的「后轮 / 前轮 / 未装载」，不造第二套说法。

      ① 的判定用「首页专属前缀」`phHomeMovement` 而不是泛化的 `data-ph-home-movement`：
         后者作为**子串**会被 `phHomeMovement` 包含，看起来一样，但前者语义更窄、
         不会误命中别的 `data-ph-home-*` 挂点。
    */
    expect(page, '首页必须有一个带 `phHomeMovement` 挂点的 Movement 摘要段').toMatch(
      /phHomeMovement/,
    );
    // ② 摘要段必须是 `movementReading(...)` 的结果被**逐 slot 遍历**画出来
    expect(page, '首页摘要必须走 movementReading 真源').toMatch(/movementReading\s*\(/);
    expect(page, '首页摘要必须逐 slot 遍历（不能硬编码两个挂点）').toMatch(
      /for\s*\(\s*const\s+slot\s+of\s+movement\.slots\s*\)/,
    );
    // ③ 词汇与 Garage 同源：两个标签来自**同一个**常量表，不是各写一份
    expect(page, '「后轮」必须来自共享标签表').toMatch(/rear:\s*'后轮'/);
    expect(page, '「前轮」必须来自共享标签表').toMatch(/front:\s*'前轮'/);
    expect(
      page,
      'Garage 与首页必须共用 MOVEMENT_HARDPOINT_LABELS（不许各写一份挂点标签）',
    ).not.toMatch(/hardpointId\s*===\s*'rear'\s*\?\s*'后轮'\s*:\s*'前轮'/);
  });

  it('PS-02 缺省轮 / 已装轮组 两种状态下，读数都给出**可读名称**（不是 defId 原样吐出）', () => {
    const d0 = baseDraft();
    const r0 = surfaceSide(d0);
    for (const hp of ['rear', 'front']) {
      const s = r0.slots.find((x) => x.hardpointId === hp);
      expect(s, `缺省状态下 ${hp} 必须有读数`).toBeTruthy();
      expect(s!.name.length, `${hp} 的名称不能为空`).toBeGreaterThan(0);
      expect(s!.name, `${hp} 不能把内部 defId 当名称吐出`).not.toBe(s!.effectiveDefId);
    }
    // 装一件真轮组后，名称随之变化（证明它不是写死的常量）
    // ⚠️ 必须先授予（写盘）再读库存：库存是**从盘上读**的，先读会拿到授予前那一份
    grantMovement(OFFICIAL_MOVEMENTS[0]);
    const inv = playerInventory(d0);
    const out = equipMovement('rear', OFFICIAL_MOVEMENTS[0], d0, inv);
    expect(out.ok, `前置：应能装上 ${OFFICIAL_MOVEMENTS[0]}`).toBe(true);
    const r1 = surfaceSide(out.draft as BuildDraft);
    const rear1 = r1.slots.find((x) => x.hardpointId === 'rear');
    expect(rear1!.effectiveDefId).toBe(OFFICIAL_MOVEMENTS[0]);
    expect(rear1!.name).not.toBe(
      r0.slots.find((x) => x.hardpointId === 'rear')!.name,
    );
  });

  it('PS-03 reload（重读存档）后，Home 读数与 persisted BuildDraft **逐字段一致**（验收 2）', () => {
    const d0 = baseDraft();
    // 两个挂点各装一件**不同**的轮组 ⇒ 若「两侧读数」被写反，这条立刻变红
    const [rearWheel, frontWheel] = twoCompatibleMovements();
    for (const defId of [rearWheel, frontWheel]) grantMovement(defId);
    const inv = playerInventory(d0);
    const a = equipMovement('rear', rearWheel, d0, inv);
    expect(a.ok, `前置：rear=${rearWheel} 应能装上`).toBe(true);
    let cur = a.draft as BuildDraft;
    const b = equipMovement('front', frontWheel, cur, playerInventory(cur));
    expect(b.ok, `前置：front=${frontWheel} 应能装上`).toBe(true);
    cur = b.draft as BuildDraft;

    // 「reload」= 丢掉内存态，重新从存档读
    const reloaded = loadPlayerBuild() as BuildDraft;
    const persisted = persistedSide();
    const r = surfaceSide(reloaded);

    expect(persisted['rearWheelDefId']).toBe(rearWheel);
    expect(persisted['frontWheelDefId']).toBe(frontWheel);
    expect(readingEffective(r, 'rear')).toBe(rearWheel);
    expect(readingEffective(r, 'front')).toBe(frontWheel);
    // 逐项同值（不是「都非空」）
    expect(readingEffective(r, 'rear')).toBe(storedFieldOf(reloaded, 'rear'));
    expect(readingEffective(r, 'front')).toBe(storedFieldOf(reloaded, 'front'));
  });
});

/* ================================================================== PS-04..05 三方一致 */

describe('PS-04..05｜Home/Garage = persisted = Run encoded Snapshot（验收 3）', () => {
  it('PS-04 三方一致：表面读数 === 存档字段 === Run 载荷，且 Runtime 真的用了它', () => {
    const d0 = baseDraft();
    const [rearWheel, frontWheel] = twoCompatibleMovements();
    for (const defId of [rearWheel, frontWheel]) grantMovement(defId);
    const inv = playerInventory(d0);
    const a = equipMovement('rear', rearWheel, d0, inv);
    expect(a.ok, `前置：rear=${rearWheel} 应能装上`).toBe(true);
    const cur = a.draft as BuildDraft;
    const b = equipMovement('front', frontWheel, cur, playerInventory(cur));
    expect(b.ok, `前置：front=${frontWheel} 应能装上`).toBe(true);
    const after = b.draft as BuildDraft;

    const surface = surfaceSide(after);
    const persisted = persistedSide();
    const run = runSide(after);
    expect(run.parsed, '合法装备必须能被 Run 解析').not.toBeNull();

    const surfaces = {
      rear: readingEffective(surface, 'rear'),
      front: readingEffective(surface, 'front'),
    };
    const persisteds = {
      rear: persisted['rearWheelDefId'] ?? null,
      front: persisted['frontWheelDefId'] ?? null,
    };
    const encodeds = {
      rear: run.encoded!['rearWheelDefId'] ?? null,
      front: run.encoded!['frontWheelDefId'] ?? null,
    };
    expect(surfaces, 'Home/Garage 读数必须 = 存档 = Run 载荷').toEqual(persisteds);
    expect(encodeds, 'Run 载荷必须 = 存档').toEqual(persisteds);

    // 最强的一条：**真实 Runtime 实体**的 movements 就是这两个 defId（消费端也一致）
    const runtimeMovementDefIds = run.entity!.movements.map((m) => m.defId).sort();
    expect(runtimeMovementDefIds).toEqual([rearWheel, frontWheel].sort());
  });

  it('PS-05 缺省状态下三方**同样**一致（`undefined` 在载荷里表现为「没有这个键」）', () => {
    // 全新账号：两个挂点都是缺省轮
    const fresh = baseDraft();
    const surface = surfaceSide(fresh);
    const run = runSide(fresh);
    expect(run.parsed).not.toBeNull();
    // 缺省轮在存档里**没有键**（三态之一），在载荷里也**没有键**（`encodeRunLoadout` 只在有定义时写）
    expect(fresh.rearWheelDefId).toBeUndefined();
    expect(fresh.frontWheelDefId).toBeUndefined();
    expect('rearWheelDefId' in run.encoded!).toBe(false);
    expect('frontWheelDefId' in run.encoded!).toBe(false);
    // 但**表面读数**必须仍然给出「在跑的是缺省轮」（`null` = 存档无键；effective 有值）
    for (const hp of ['rear', 'front']) {
      const s = surface.slots.find((x) => x.hardpointId === hp)!;
      expect(s.storedDefId, `${hp} 缺省态在存档里应是「无键」`).toBeNull();
      expect(s.effectiveDefId, `${hp} 缺省态仍必须有在跑的轮组`).toBeTruthy();
    }
  });
});

/* ================================================================== PS-06..08 无静默回退 */

describe('PS-06..08｜非法 persisted Movement **不得**被静默替换（验收 4、必改 2 / 3）', () => {
  /**
   * **绕过 `savePlayerBuild` 直接往 localStorage 写原始串** —— 这是唯一能造出
   * 「非法 persisted Movement」的方式，也**正好**对应真实的坏档来源：
   *   - 玩家手改 localStorage / 装了别的版本又把存档拷回来；
   *   - 内容包改动导致某个 defId 在新版本里不存在了。
   * ⚠️ 不能用 `savePlayerBuild` 造这种档：它写的是 `stampVersion(d)` 后原样序列化，
   *    但**读回**时会过 `isBuildDraftShape` + `validateSnapshot` 双关 ⇒ 非法值根本读不回来。
   *    所以本组测试必须走「写原始串」这条路，否则测的是空气。
   */
  function persistRawString(obj: Record<string, unknown>): void {
    localStorage.setItem('strongfruit.playerBuild.v1', JSON.stringify(obj));
  }

  it('PS-06 非法 rearWheelDefId（不存在的 defId）⇒ 存档读取层**整份拒绝**，绝不回退成 wheelStd', () => {
    const good = baseDraft();
    persistRawString({ ...good, rearWheelDefId: 'noSuchWheel-xyz' });

    /*
      ⚠️ 这一条就是「无 silent fallback」的**第一道**机器判据，也是最靠前的一道：
         被禁止的行为 = 读到 `noSuchWheel-xyz` 之后偷偷换成 `wheelStd` 让玩家照常玩。
         正确行为     = `loadPlayerBuild()` 返回 `null`（整份拒绝）。
         ⇒ 断言 `null`，且**顺带**断言它**没有**被改写成 `wheelStd`（两者必须同时成立：
           只看「能用」不足以排除「被静默修好了」）。
    */
    const loaded = loadPlayerBuild();
    expect(
      loaded,
      '非法 defId 必须让存档读取层整份拒绝（null），而不是被静默替换后照常返回',
    ).toBeNull();
    // 反向取证：盘上那份**没有被就地改写**（读取层的拒绝不应产生副作用）
    const onDisk = JSON.parse(localStorage.getItem('strongfruit.playerBuild.v1') as string) as Record<string, unknown>;
    expect(onDisk['rearWheelDefId']).toBe('noSuchWheel-xyz');
    expect(
      JSON.stringify(onDisk).includes('wheelStd'),
      '读取层不得把非法 defId 就地改写成 wheelStd',
    ).toBe(false);
  });

  it('PS-07 非法 frontWheelDefId 同样整份拒绝（不是只守 rear 一侧）', () => {
    const good = baseDraft();
    persistRawString({ ...good, frontWheelDefId: 'notARealWheel-abc' });
    expect(loadPlayerBuild()).toBeNull();
  });

  it('PS-07b 非法值**确实**能进入 Run 解析器时，同样被拒绝（第二道关：`parseRunPlayerLoadout`）', () => {
    /*
      上一道门（`loadPlayerBuild`）已经把坏档挡住了。但要证明「即使非法值**绕过局外**、
      直接出现在 Run 的 `equipped=` 载荷里，Run 侧也**不会**静默替换」，就必须
      手工构造那个 URL —— 因为真实链路里它到不了这里。
      ⚠️ 这不是「造一个不可能的场景」：`equipped=` 是**查询串**，任何人都能手工拼一个
         （分享链接、书签、脚本）⇒ 这条恰好覆盖了最容易被忽视的入口。
    */
    const badPayload = encodeURIComponent(
      JSON.stringify({
        bodyDefId: 'watermelonBody',
        rearRadius: 20,
        frontRadius: 20,
        functionalSelections: { frontMass: 'cannon', front: 'none', top: 'none', rear: 'none' },
        rearWheelDefId: 'ghostWheel-zzz',
      }),
    );
    const parsed = parseRunPlayerLoadout(`?equipped=${badPayload}`);
    expect(
      parsed,
      'Run 侧拿到非法 defId 必须整份拒绝，而不是回退成默认轮后照常开打',
    ).toBeNull();
  });

  it('PS-08 合法但「未拥有」的轮组：Run 侧**不做** owned 纠正（owned 是局外的事）', () => {
    /*
      必改 2 的第三条：`owned 状态异常就 Runtime 自动纠正` 是禁止的。

      这里构造的是**最刁钻的一种**：Build 里写着 `largeWheel`，但库存里一件都没有
      （玩家把 localStorage 改过 / 存档被复制到别的账号）。
      ⚠️ 正确行为有两层，必须**分开**断言，不能混成一条：
        ① **Run 侧**（`parseRunPlayerLoadout`）**不做 owned 判断** —— 它的职责只有
           「格式 + 内容合法性」；owned 是**局外**（Garage / inventory）的事。
           若 Run 侧开始纠正 owned，就等于在 Battle Runtime 里加了补偿逻辑（Queue 明令禁止）。
        ② 因此它**照常解析成功**，并把 `largeWheel` **原样**交给 Runtime —— 不换成 wheelStd。
      真正该拦住这种情况的是局外的 equip 入口（`not-owned`），那条已由上一轮覆盖。
    */
    const good = baseDraft();
    // ⚠️ 用**真实写入口**（`savePlayerBuild`）落盘：`largeWheel` 是合法 defId，
    //    所以它**能**通过存档读取双关 —— 这条测的正是「合法但未拥有」。
    savePlayerBuild({ ...good, rearWheelDefId: 'largeWheel' });

    // 前置取证：库存里确实**没有** largeWheel（否则这条测试没有意义）
    const inv = playerInventory(good);
    expect(
      (inv as Record<string, { one?: number }>)['largeWheel']?.one ?? 0,
      '前置：库存里必须没有 largeWheel',
    ).toBe(0);

    // 坏档真的在盘上（读回来必须还是 largeWheel）
    const reloaded = loadPlayerBuild() as BuildDraft;
    expect(reloaded, 'largeWheel 是合法 defId ⇒ 应当能读回').not.toBeNull();
    expect(reloaded.rearWheelDefId).toBe('largeWheel');

    const run = runSide(reloaded);
    expect(run.parsed, 'Run 侧不做 owned 判断（owned 是局外的事）').not.toBeNull();
    expect(
      run.encoded!['rearWheelDefId'],
      'owned 异常不得导致 Runtime 自动把轮组换成别的',
    ).toBe('largeWheel');
    expect(run.entity!.movements.map((m) => m.defId)).toContain('largeWheel');
  });

  it('PS-08b 源码守卫：Run 侧（Lab）与存档层都没有「找不到就换默认」的补偿分支', () => {
    /*
      `PS-06/07/08` 是行为层；这条是**结构层**，防止将来有人加一个
      「catch 一下、失败就用 wheelStd 兜底」的分支 —— 那种代码在行为测试里
      只有在**恰好构造出失败**时才会暴露，而结构守卫每次都会拦住。
    */
    const lab = strip(
      readFileSync(join(REPO_ROOT, 'src', 'lab', 'portraitBattleLab', 'runPlayerLoadout.ts'), 'utf8'),
    );
    // Run 解析器里**不允许**出现 wheelStd 字面量（= 它无从「知道」默认轮是什么）
    expect(
      lab.includes('wheelStd'),
      'runPlayerLoadout.ts 不得出现 wheelStd —— 它无从把非法轮组替换成默认轮',
    ).toBe(false);
    /*
      ⚠️ 存档层（`buildPersistence`）必须**保持拒绝语义**：
         `isBuildDraftShape` 的轮组那一支必须仍在（若被删掉，非法 defId 就能过第一道关）。
      这里只钉「该判据存在且仍是 `return false`」，不改它的实现。
    */
    const persistence = strip(readFileSync(join(REPO_ROOT, 'src', 'core', 'buildPersistence.ts'), 'utf8'));
    expect(
      persistence,
      'buildPersistence 必须保留「未知 Movement defId ⇒ 形状不合法」的判据',
    ).toMatch(/KNOWN_MOVEMENTS\.has\(o\.rearWheelDefId\)/);
    expect(
      persistence,
      'buildPersistence 必须保留「未知 Movement defId ⇒ 形状不合法」的判据',
    ).toMatch(/KNOWN_MOVEMENTS\.has\(o\.frontWheelDefId\)/);
  });

  /**
   * PS-10｜**发现于本 Queue 的真实丢档缺陷**（回归守卫）。
   *
   * `partInventory.hasAnyOwned()` 是 `ensureInventory()` 判定「这份存档是否已初始化」的
   * **唯一**依据：判为 false ⇒ 走种子分支 ⇒ **落盘覆写**。旧实现只扫 `OFFICIAL_PARTS`，
   * 完全不看 `OFFICIAL_MOVEMENTS` ⇒ 一个「功能件计数全为 0、但拥有轮组」的合法存档会被
   * 判为「未初始化」，下一次 `playerInventory()` / `ensureInventory()` 就把玩家的轮组
   * **静默清空**（实测：`smallWheel.one` 授予后经一次 `ensureInventory` 归零）。
   *
   * ⚠️ 这是**存档写入路径**的缺陷，不是显示问题：它会让玩家真的丢掉已获得的轮组。
   *    修法是让判据与 `normalizeInventory` / `emptyInventory` 对齐（两类键同属一份库存），
   *    而不是把测试夹具绕过去。
   */
  it('PS-10 `hasAnyOwned` 必须把轮组算作「已有库存」，否则 ensureInventory 会覆写掉玩家轮组', () => {
    /*
      行为层：造一份「功能件全 0 + 拥有一件轮组」的**合法**库存，落盘；
      再走一次正式入口 `playerInventory(draft)`（内部 = `ensureInventory`）。
      修复前：轮组计数被种子覆写归零 ⇒ 这条立刻变红。
    */
    baseDraft(); // 建一份真实 starter Build（含落盘）
    const seeded = playerInventory(baseDraft());
    // 模拟「玩家把功能件都用掉 / 从没有过功能件，但打到了轮组」的状态
    for (const key of Object.keys(seeded)) seeded[key].one = 0;
    seeded[OFFICIAL_MOVEMENTS[0]].one = 1;
    saveInventory(seeded);
    expect(getCount(loadInventoryRaw() as PartInventory, OFFICIAL_MOVEMENTS[0], 1)).toBe(1);

    // 正式入口再读一次 —— 这一次**不得**改变盘上的轮组计数
    const again = playerInventory(baseDraft());
    expect(
      getCount(again, OFFICIAL_MOVEMENTS[0], 1),
      `「拥有轮组、功能件全 0」的存档不得被 ensureInventory 判为未初始化：` +
        `${OFFICIAL_MOVEMENTS[0]} 会被静默清空`,
    ).toBe(1);
    expect(
      getCount(loadInventoryRaw() as PartInventory, OFFICIAL_MOVEMENTS[0], 1),
      '盘上的轮组计数不得被覆写',
    ).toBe(1);
  });
});

/* ================================================================== PS-09 契约守卫 */

describe('PS-09｜最小契约守卫（必改 4）', () => {
  it('PS-09 三方一致的断言覆盖**全部** canonical Movement 与三态', () => {
    /*
      只测「装了 largeWheel」不足以守住契约 —— 漏掉缺省态 / 卸下态时，
      实现可以「只在装了轮组时正确」。这里对**每个 canonical wheel × 每个挂点**
      都跑一遍三方读数。
    */
    for (const defId of canonicalMovementDefIds()) {
      for (const hp of ['rear', 'front'] as const) {
        const base = baseDraft();
        // ⚠️ 必须先授予（写盘）再读库存：库存是**从盘上读**的，先读会拿到授予前那一份
        grantMovement(defId);
        const inv = playerInventory(base);
        const out = equipMovement(hp, defId, base, inv);
        expect(out.ok, `前置：${hp}=${defId} 应能装上`).toBe(true);
        const after = out.draft as BuildDraft;

        const surface = surfaceSide(after);
        const persisted = persistedSide();
        const run = runSide(after);
        expect(run.parsed, `${hp}=${defId} 应能被 Run 解析`).not.toBeNull();

        const field = hp === 'rear' ? 'rearWheelDefId' : 'frontWheelDefId';
        expect(surface.slots.find((s) => s.hardpointId === hp)!.effectiveDefId).toBe(defId);
        /*
          ⚠️ 装**缺省轮**时，`equipMovement` 会**删掉那个键**（三态语义：缺省 = 无键），
             所以此刻持久层里是 `undefined` 而不是 `'wheelStd'` —— 这是**正确**行为，
             不是缺陷。载荷同理（`encodeRunLoadout` 只在有定义时才写）。
             故此处的期望值必须**按 defId 是不是缺省轮**分两种口径，而不是一律写死 defId。
        */
        const isDefaultWheel = defId === defaultMovementDefId();
        expect(persisted[field]).toBe(isDefaultWheel ? undefined : defId);
        expect(run.encoded![field]).toBe(isDefaultWheel ? undefined : defId);
        // 但**表面读数**两种情况都必须给出同一个「在跑的轮组」（这是契约的另一半）
        expect(surface.slots.find((s) => s.hardpointId === hp)!.effectiveDefId).toBe(defId);
      }
    }
    // 三态之「明确卸下」：`'none'` 在载荷里原样出现，且该槽**不进** movements
    const base = baseDraft();
    const off = equipMovement('rear', EMPTY_SLOT, base, playerInventory(base));
    expect(off.ok).toBe(true);
    const afterOff = off.draft as BuildDraft;
    const runOff = runSide(afterOff);
    expect(runOff.encoded!['rearWheelDefId']).toBe(EMPTY_SLOT);
    expect(runOff.entity!.movements.map((m) => m.hardpointId)).not.toContain('rear');
  });
});
