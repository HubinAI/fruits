/**
 * PRODUCT-LOOP-R4-BODY-CANONICAL-AND-GARAGE-MVP｜Body canonical + 写入口 targeted 契约测试。
 *
 * 被测对象 = `src/product/runBodyCanonical.ts`（canonical mapping）
 *          + `src/product/bodyInventory.ts`（只读真源）
 *          + `src/product/playerLoadout.ts` 的 `equipBody`（唯一写入口）
 *          + 它钉死的那条真实链路：**Garage / Profile → Run Snapshot → Runtime**。
 *
 * ── 本文件要证的四件事 ───────────────────────────────────────────────────────
 *   ① **唯一正式数据源明确**：正式 Body 内容 = `registry.bodies` ∩ `OFFICIAL_BODIES`；
 *      旧 4 台恒默认拥有、新 4 台需 seed 解锁（`BV-01` / `BV-02` / `BV-03` / `BV-04`）。
 *   ② **Garage/Profile → Run Snapshot → Runtime 映射一致**：局外那份 draft 里的 `bodyDefId`
 *      经「产品侧编码 → 局内解析 → 正式 Snapshot → 真实 Runtime 计划」之后，逐项与局外
 *      完全相同（`BV-05` / `BV-06`）。
 *   ③ 写入口 `equipBody` 只改 `bodyDefId` 一个字段，**结构上碰不到** Weapon / rear / front
 *      （`BV-07` / `BV-08` / `BV-09`），且校验顺序 = unknown → not-official → not-owned →
 *      invalid-build（`BV-10`）。
 *   ④ 边界：未知 / 非官方车身在**两侧都被拒绝**（`BV-11` / `BV-12`）。
 *   ⑤ PRODUCT-LOOP-R4-CONFIGURATION-BATCH-GATE（必验 C）：**Body + Weapon + Movement
 *      组成同一辆持久化战车**，且换其中一个维度不会覆盖另外两个
 *      （`BV-16` 只换 Body / `BV-17` 只换 rear）。
 *
 * ── 为什么这组断言不是「换个地方再抄一遍」──────────────────────────────────
 *   - 局外一侧读的是 `bodyMapping()`（内部走真实 `buildSnapshotFromDraft` +
 *     真实 `resolveSnapshot`）；局内一侧读的是**真实产品地址**（`buildAdventureHref`
 *     产出）经**真实解析器**（`parseRunPlayerLoadout`）再经**真实 Runtime 计划**
 *     （`buildSpawnPlanFromDraft`）之后的 `SpawnedEntity`。
 *   - 两侧都**不**由本测试自己拼装期望值：期望值就是另一侧的真实读数。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { registry } from '../src/core/content';
import { DEFAULT_OWNED_BODIES, OFFICIAL_BODIES } from '../src/core/bodyOwnership';
import { loadPlayerBuild, savePlayerBuild } from '../src/core/buildPersistence';
import type { BuildDraft } from '../src/lab/buildEditorModel';
import {
  PLAYER_BODY_DEF_ID,
  WEAPON_SLOT,
  defaultPlayerDraft,
  equipBody,
  equipMovement,
  equipWeapon,
  loadEquippedDraft,
  playerInventory,
} from '../src/product/playerLoadout';
import { buildAdventureHref } from '../src/product/runReward';
import {
  bodyEntries,
  bodyOwnership,
  isBodyEntryOwned,
} from '../src/product/bodyInventory';
import {
  bodyMapping,
  canonicalBodies,
  canonicalBodyDefIds,
  isCanonicalBody,
} from '../src/product/runBodyCanonical';
import { parseRunPlayerLoadout } from '../src/lab/portraitBattleLab/runPlayerLoadout';
import {
  RUN_DEMO_ENCOUNTER_ID,
  resolveRunPlayerLoadout,
} from '../src/lab/portraitBattleLab/runPageScene';
import { buildSpawnPlanFromDraft } from '../src/lab/portraitBattleLab/entities';

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

/* ------------------------------------------------------------------ 两侧读取入口 */

/**
 * **局外侧**：产品首页「开始冒险」的地址 —— 用的就是产品侧真实函数
 * （`buildAdventureHref` 会把当前存档那份 draft 原样编进 `equipped`）。
 */
function adventureSearch(draft: BuildDraft): string {
  const href = buildAdventureHref('run-bv', { stack: 5, choices: [] }, draft);
  const i = href.indexOf('?');
  return i >= 0 ? href.slice(i) : '';
}

/** **局内侧**：解析产品地址 → 正式 Snapshot → 真实 Runtime 计划（`SpawnedEntity`）。 */
function runSide(draft: BuildDraft) {
  const parsed = parseRunPlayerLoadout(adventureSearch(draft));
  expect(parsed, '产品侧交进来的装备必须能被局内解析（否则就是「首页 A、战斗 B」）').not.toBeNull();
  const loadoutDraft = parsed!.draft;
  const plan = buildSpawnPlanFromDraft(loadoutDraft, 'profile-equipped', RUN_DEMO_ENCOUNTER_ID);
  return { loadoutDraft, entity: plan.player };
}

/** 把新 4 台正式车身都发到拥有状态（走正式 `grantBody` 落盘）。 */
function grantAllNew(): void {
  const store = (globalThis as unknown as { localStorage: MemStorage }).localStorage;
  const owned = JSON.parse(store.getItem('strongfruit.ownedBodies.v1') ?? '[]') as string[];
  const next = [...owned];
  for (const b of OFFICIAL_BODIES) {
    if (!DEFAULT_OWNED_BODIES.includes(b) && !next.includes(b)) next.push(b);
  }
  store.setItem('strongfruit.ownedBodies.v1', JSON.stringify(next));
}

/**
 * 把一件**需要库存**的 Movement 真的发到永久库存里（走正式落盘口径，不走 `equipMovement`）。
 * 与 `tests/productMovementGarageEquip.test.ts` 的同名夹具同源。
 */
function grantMovement(defId: string, n = 1): void {
  /*
    ⚠️ 必须**先**把正式默认库存落到磁盘（starter 各 1），再叠加要发的轮组。
    `loadInventoryRaw() ?? defaultInventory()` 只会「规范化**已存在的那一份**」——
    不会给已存在的存档补 starter ⇒ 凭空写一份只含轮组的部分库存，会让 cannon 等
    starter 变成 0（`equipWeapon` 随即以 `not-owned` 被拒，本文件正是这样抓到的）。
  */
  playerInventory(defaultPlayerDraft());
  const store = (globalThis as unknown as { localStorage: MemStorage }).localStorage;
  const inv = JSON.parse(store.getItem('strongfruit.ownedParts.v2') ?? '{}') as Record<
    string,
    { one?: number }
  >;
  const row = inv[defId] ?? {};
  row.one = (row.one ?? 0) + n;
  inv[defId] = row;
  store.setItem('strongfruit.ownedParts.v2', JSON.stringify(inv));
}

/* ================================================================== BV-01..04 唯一真源 */

describe('BV-01..04｜唯一正式数据源 = 正式内容库 + OFFICIAL_BODIES（产品侧没有第二张表）', () => {
  it('BV-01 canonical Body 集合与 OFFICIAL_BODIES **集合相等**（且全在 registry.bodies 里）', () => {
    const fromModule = [...canonicalBodyDefIds()];
    expect(fromModule).toEqual([...OFFICIAL_BODIES]);
    for (const id of fromModule) {
      expect(registry.bodies.has(id), `"${id}" 必须在正式内容库里`).toBe(true);
    }
  });

  it('BV-02 每一项读数都现读自真实 def（本模块不复制任何数值）', () => {
    const rows = canonicalBodies();
    expect(rows.length).toBe(OFFICIAL_BODIES.length);
    for (const row of rows) {
      const def = registry.bodies.get(row.defId);
      expect(def, `"${row.defId}" 必须存在`).toBeDefined();
      expect(row.name).toBe(def!.name);
      expect(row.hp).toBe(def!.hp);
      expect(row.baseMass).toBe(def!.baseMass);
      expect(row.energyCapacity).toBe(def!.energyCapacity);
    }
  });

  it('BV-03 旧 4 台恒默认拥有（implicit），新 4 台默认未拥有（需 seed 解锁）', () => {
    const draft = defaultPlayerDraft();
    const r = bodyOwnership(draft);
    for (const e of r.entries) {
      const isDefault = DEFAULT_OWNED_BODIES.includes(e.defId);
      expect(e.implicit, `${e.defId} implicit 判据`).toBe(isDefault);
      // 前提：本用例未 seed ⇒ 新 4 台 owned === false，旧 4 台 owned === true
      expect(e.owned, `${e.defId} owned 判据`).toBe(isDefault);
    }
  });

  it('BV-04 isCanonicalBody / isBodyEntryOwned 判据与 OFFICIAL_BODIES 同源', () => {
    for (const id of OFFICIAL_BODIES) expect(isCanonicalBody(id)).toBe(true);
    for (const bad of ['wedgeBody', 'boxBody', 'tallBody', 'heavyBox', 'unknownBody', '']) {
      expect(isCanonicalBody(bad), `"${bad}" 不是正式车身`).toBe(false);
    }
    // 旧 4 台 isBodyEntryOwned 恒 true；新 4 台未 seed 时 false
    const draft = defaultPlayerDraft();
    for (const id of DEFAULT_OWNED_BODIES) expect(isBodyEntryOwned(id)).toBe(true);
    for (const id of OFFICIAL_BODIES.filter((b) => !DEFAULT_OWNED_BODIES.includes(b))) {
      expect(isBodyEntryOwned(id), `${id} 未 seed 时不可拥有`).toBe(false);
    }
    // bodyEntries 遍历 OFFICIAL_BODIES ⇒ 非官方车身（wedgeBody 等）绝不混入
    const entries = bodyEntries(draft).map((e) => e.defId);
    expect(entries).toEqual([...OFFICIAL_BODIES]);
    expect(entries).not.toContain('wedgeBody');
    expect(entries).not.toContain('heavyBox');
  });
});

/* ================================================================== BV-05..06 契约（映射一致） */

describe('BV-05｜Garage/Profile → Run Snapshot 映射一致（覆盖每台正式车身）', () => {
  it('BV-05 产品默认车（缺省 watermelonBody）经真实链路往返后 body 读数逐项一致', () => {
    const draft = defaultPlayerDraft();
    expect(draft.bodyDefId).toBe(PLAYER_BODY_DEF_ID);
    const mine = bodyMapping(draft);
    const { loadoutDraft, entity } = runSide(draft);

    // ① 携带无损：局内拿到的那份 draft 与局外逐字段相同
    expect(loadoutDraft.bodyDefId).toBe(draft.bodyDefId);
    // ② 真实 Runtime 实体用的 body 与局外映射读数一致
    const def = registry.bodies.get(draft.bodyDefId)!;
    expect(mine.bodyDefId).toBe(def.id);
    expect(mine.bodyName).toBe(def.name);
    expect(mine.hp).toBe(def.hp);
    expect(mine.baseMass).toBe(def.baseMass);
    expect(mine.energyCapacity).toBe(def.energyCapacity);
    expect(entity.bodyDefId, '真实实体消费的 bodyDefId 与局外一致').toBe(draft.bodyDefId);
  });

  it('BV-05b 每台正式车身经真实链路往返后 body 读数与 registry 逐字段一致', () => {
    grantAllNew();
    for (const defId of OFFICIAL_BODIES) {
      const draft: BuildDraft = { ...defaultPlayerDraft(), bodyDefId: defId };
      const mine = bodyMapping(draft);
      const { entity } = runSide(draft);
      const def = registry.bodies.get(defId)!;
      expect(mine.hp).toBe(def.hp);
      expect(mine.baseMass).toBe(def.baseMass);
      expect(mine.energyCapacity).toBe(def.energyCapacity);
      expect(entity.bodyDefId).toBe(defId);
    }
  });

  it('BV-06 bodyMapping 走**正式** resolveSnapshot（不是本模块自己拼的数值）', () => {
    const draft = defaultPlayerDraft();
    const mine = bodyMapping(draft);
    const def = registry.bodies.get(draft.bodyDefId)!;
    // 与 resolveSnapshot 的 body 字段同源：hp / baseMass / energyCapacity 都是 BodyDef 原值
    expect(mine.hp).toBe(def.hp);
    expect(mine.baseMass).toBe(def.baseMass);
    expect(mine.energyCapacity).toBe(def.energyCapacity);
    expect(mine.bodyName).toBe(def.name);
  });
});

/* ================================================================== BV-07..09 写入口不碰 Weapon / rear / front */

describe('BV-07..09｜equipBody 只改 bodyDefId 一个字段，结构上碰不到 Weapon / rear / front', () => {
  it('BV-07 equipBody 成功装备后：Weapon / rear / front / drive 逐项不变', () => {
    grantAllNew();
    const draft = defaultPlayerDraft();
    const weaponBefore = JSON.stringify(draft.functionalSelections);
    const starsBefore = JSON.stringify(draft.functionalStars ?? null);
    const rearBefore = draft.rearWheelDefId;
    const frontBefore = draft.frontWheelDefId;
    const driveBefore = draft.drive;

    const out = equipBody('durianBody', draft);
    expect(out.ok, `换车身应成功（detail: ${out.detail ?? '–'}）`).toBe(true);
    const next = out.draft as BuildDraft;

    expect(next.bodyDefId).toBe('durianBody');
    expect(JSON.stringify(next.functionalSelections)).toBe(weaponBefore);
    expect(JSON.stringify(next.functionalStars ?? null)).toBe(starsBefore);
    expect(next.rearWheelDefId).toBe(rearBefore);
    expect(next.frontWheelDefId).toBe(frontBefore);
    expect(next.drive).toBe(driveBefore);
    // 入参本身没被改写
    expect(draft.bodyDefId).toBe(PLAYER_BODY_DEF_ID);
  });

  it('BV-08 换回旧车身 / 再换新车身，均只改 bodyDefId（多轮切换不漂移）', () => {
    grantAllNew();
    const draft = defaultPlayerDraft();
    const weaponBefore = JSON.stringify(draft.functionalSelections);
    const rearBefore = draft.rearWheelDefId;

    const a = equipBody('bananaBody', draft);
    expect(a.ok).toBe(true);
    const b = equipBody('mangoBody', a.draft as BuildDraft);
    expect(b.ok).toBe(true);
    const c = equipBody('watermelonBody', b.draft as BuildDraft);
    expect(c.ok).toBe(true);

    const next = c.draft as BuildDraft;
    expect(next.bodyDefId).toBe('watermelonBody');
    expect(JSON.stringify(next.functionalSelections)).toBe(weaponBefore);
    expect(next.rearWheelDefId).toBe(rearBefore);
  });

  it('BV-09 Garage 写入口经真实地址 → 真实解析 → 真实 Runtime 计划后 bodyDefId 逐项一致', () => {
    grantAllNew();
    const draft = defaultPlayerDraft();
    const out = equipBody('orangeBody', draft);
    expect(out.ok).toBe(true);
    const equipped = out.draft as BuildDraft;

    // 局外读数（Garage 画的那一份）
    const garage = bodyMapping(equipped);
    expect(garage.bodyDefId).toBe('orangeBody');

    // 走真实产品地址 → 真实解析器 → 真实 Runtime 计划
    const run = runSide(equipped);
    expect(run.entity.bodyDefId).toBe('orangeBody');
    // 真实实体消费的 body 与 Garage 映射读数同源
    expect(run.entity.bodyDefId).toBe(garage.bodyDefId);
  });
});

/* ================================================================== BV-10 校验顺序 */

describe('BV-10｜equipBody 校验顺序 = unknown → not-official → not-owned → invalid-build', () => {
  it('BV-10 未知车身 → `unknown-body`', () => {
    const out = equipBody('ghostBody', defaultPlayerDraft());
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('unknown-body');
    expect(out.draft).toBeUndefined();
  });

  it('BV-10b 非官方车身（Lab / 对手池）→ `not-official`', () => {
    for (const bad of ['wedgeBody', 'boxBody', 'tallBody', 'heavyBox']) {
      const out = equipBody(bad, defaultPlayerDraft());
      expect(out.ok).toBe(false);
      expect(out.reason).toBe('not-official');
    }
  });

  it('BV-10c 未拥有的新车身 → `not-owned`', () => {
    // 不 grant ⇒ 新 4 台都未拥有
    const out = equipBody('durianBody', defaultPlayerDraft());
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('not-owned');
  });

  it('BV-10d 拒绝是**零副作用**：失败后磁盘上没有任何玩家 Build 被写入', () => {
    const draft = defaultPlayerDraft();
    // 先落一份确定的存档，再尝试非法装备
    savePlayerBuild(draft);
    const before = JSON.stringify(loadPlayerBuild());

    const out = equipBody('wedgeBody', draft);
    expect(out.ok).toBe(false);
    expect(JSON.stringify(loadPlayerBuild()), '失败不得改写存档').toBe(before);
  });
});

/* ================================================================== BV-11..12 边界 */

describe('BV-11..12｜未知 / 非官方车身在两侧都被拒绝（不静默降级成别的车）', () => {
  it('BV-11 未知 Body：局外存档层拒收 + 局内解析层拒绝', () => {
    const bad: BuildDraft = { ...defaultPlayerDraft(), bodyDefId: 'ghostBody' };
    savePlayerBuild(bad);
    expect(loadPlayerBuild(), '未知车身不得进正式存档').toBeNull();

    const search = adventureSearch(bad);
    expect(parseRunPlayerLoadout(search), '未知车身不得进战斗').toBeNull();
    const res = resolveRunPlayerLoadout(search);
    expect(res.fallback).toBe('invalid');
  });

  it('BV-12 未知 Body 会让正式 resolveSnapshot 抛错（不悄悄换成另一个车身接着跑）', () => {
    const bad: BuildDraft = { ...defaultPlayerDraft(), bodyDefId: 'ghostBody' };
    expect(() => bodyMapping(bad)).toThrow(/unknown body "ghostBody"/);
  });
});

/* ================================================================== BV-13 源码守卫 */

describe('BV-13｜源码守卫：产品链路里不得出现正式内容库之外的车身字面量', () => {
  it('BV-13 产品目录（src/product/*.ts）里所有「车身形态」字面量都必须在正式内容库里', () => {
    const NOT_A_BODY_ID = new Set(['bodyDefId']);
    // 车身 defId 是「小写开头 + Body 结尾」；data 属性名以 `ph` 开头（`phBody` / `phHomeBody` 等）
    // 不是车身 id，类型名（BodyDef / CanonicalBody / BodyReading 等）是「大写 B」开头或
    // 「Body」非结尾，也不会被下面的小写开头正则命中。
    const bodyLike = /'([a-z][A-Za-z0-9]*Body)'/g;
    const offenders: string[] = [];
    for (const f of readdirSync(PRODUCT_DIR).filter((n) => n.endsWith('.ts'))) {
      const code = strip(readProduct(f));
      for (const m of code.matchAll(bodyLike)) {
        const id = m[1]!;
        if (NOT_A_BODY_ID.has(id)) continue;
        if (id.startsWith('ph')) continue; // data 属性名（data-ph-body 等），不是车身 id
        if (!isCanonicalBody(id)) offenders.push(`${f}: '${id}'`);
      }
    }
    expect(offenders, '产品链路出现了正式内容库之外的车身 id').toEqual([]);
  });

  it('BV-14 equipBody 源码层面：只写 bodyDefId，不碰 functionalSelections / rear / front 字段', () => {
    const code = strip(readProduct('playerLoadout.ts'));
    // 唯一写字段 = bodyDefId（通过 `next = { ...draft, bodyDefId: defId }`）
    expect(code).toContain('bodyDefId: defId');
    // 收窄到 equipBody 函数体内：该函数内不得对 Weapon / Movement 字段赋值
    const fnStart = code.indexOf('export function equipBody');
    const fnEnd = code.indexOf('export function ', fnStart + 1);
    const fnBody = code.slice(fnStart, fnEnd > 0 ? fnEnd : code.length);
    expect(fnBody, 'equipBody 内不得写 functionalSelections').not.toMatch(/functionalSelections\s*[:=]/);
    expect(fnBody, 'equipBody 内不得写 rearWheelDefId').not.toMatch(/rearWheelDefId\s*[:=]/);
    expect(fnBody, 'equipBody 内不得写 frontWheelDefId').not.toMatch(/frontWheelDefId\s*[:=]/);
  });

  it('BV-15 bodyMapping 走正式 buildSnapshotFromDraft + resolveSnapshot（不自己拼）', () => {
    const code = strip(readProduct('runBodyCanonical.ts'));
    expect(code).toContain('buildSnapshotFromDraft');
    expect(code).toContain('resolveSnapshot');
    // 不复制任何车身数值字面量
    expect(code).not.toMatch(/hp:\s*\d/);
    expect(code).not.toMatch(/baseMass:\s*\d/);
    expect(code).not.toMatch(/energyCapacity:\s*\d/);
  });
});

/* ================================================================== BV-16..17 三维组合 */

/**
 * PRODUCT-LOOP-R4-CONFIGURATION-BATCH-GATE｜**必验 C**：Body + Weapon + Movement 组成
 * **同一辆持久化战车**（而不是「三个系统分别能工作」）。
 *
 * 真实组合（全部是正式内容库里的 defId，没有一处是本测试自造的）：
 *   Body   = `mangoBody`   （新 4 台之一 / MVP 集合成员；质量 48，与默认西瓜 120 差异明显）
 *   Weapon = `cannon`      （当前唯一支持完整 RUN 的主武器）
 *   rear   = `largeWheel`  （正式 `OFFICIAL_MOVEMENTS` 成员）
 *   front  = `smallWheel`  （同上）
 *
 * ⚠️ 四个维度**各走它自己的唯一写入口**（`equipBody` / `equipWeapon` / `equipMovement`），
 *    落盘之后**整页 reload**（`loadEquippedDraft()` 从磁盘重读）再逐项对账，最后过**正式**
 *    Run 链路（产品地址 → 局内解析 → Snapshot → 真实 Runtime 计划）。
 *
 * 两条「互不覆盖」的实证：
 *   BV-16 只换 Body（mango → durian）⇒ Weapon / rear / front 逐字节不变；
 *   BV-17 只换 rear（large → heavy）⇒ Body / Weapon / front 逐字节不变。
 */
describe('BV-16..17｜必验 C：三维组合真正贯通，且换一个维度不会覆盖另外两个', () => {
  /** 组装这辆「Body + Weapon + 前后轮」都非默认的战车（每一步都过正式写入口）。 */
  function assembleVehicle(): BuildDraft {
    let draft = defaultPlayerDraft();

    const bodyOut = equipBody('mangoBody', draft);
    expect(bodyOut.ok, `Body 装备应成功（${bodyOut.detail ?? '–'}）`).toBe(true);
    draft = bodyOut.draft as BuildDraft;

    const rearOut = equipMovement('rear', 'largeWheel', draft, playerInventory(draft));
    expect(rearOut.ok, `rear 装备应成功（${rearOut.detail ?? '–'}）`).toBe(true);
    draft = rearOut.draft as BuildDraft;

    const frontOut = equipMovement('front', 'smallWheel', draft, playerInventory(draft));
    expect(frontOut.ok, `front 装备应成功（${frontOut.detail ?? '–'}）`).toBe(true);
    draft = frontOut.draft as BuildDraft;

    // Weapon 槽也走它自己的写入口（值本来就是 cannon，但这一步是**真实落盘动作**）
    const wpnOut = equipWeapon('cannon', draft, playerInventory(draft));
    expect(wpnOut.ok, 'Weapon 装备应成功').toBe(true);
    return wpnOut.draft as BuildDraft;
  }

  /** 四维度 + Weapon 星级的逐字节快照（用来断言「别的维度一个字都没动」）。 */
  function snap(d: BuildDraft) {
    return {
      body: d.bodyDefId,
      weapon: JSON.stringify(d.functionalSelections),
      stars: JSON.stringify(d.functionalStars ?? null),
      rear: d.rearWheelDefId,
      front: d.frontWheelDefId,
      drive: d.drive,
    };
  }

  it('BV-16 三维组合 → 落盘 → reload → Run Snapshot/Runtime 四者同源；再只换 Body ⇒ 其余逐字节不变', () => {
    grantAllNew();
    grantMovement('largeWheel');
    grantMovement('smallWheel');
    grantMovement('heavyWheel');

    const built = assembleVehicle();
    // 前提：四个维度都真的**非默认**，否则「不覆盖」是空证
    expect(built.bodyDefId).toBe('mangoBody');
    expect(built.rearWheelDefId).toBe('largeWheel');
    expect(built.frontWheelDefId).toBe('smallWheel');
    expect(built.functionalSelections[WEAPON_SLOT]).toBe('cannon');

    // ① reload：从磁盘重读的那一份与内存里逐字段相同（持久化真的生效）
    const reloaded = loadEquippedDraft();
    expect(snap(reloaded)).toEqual(snap(built));

    // ② Run 侧同源：产品地址 → 局内解析 → Snapshot → 真实 Runtime 计划，四个维度全带上
    const { loadoutDraft, entity } = runSide(reloaded);
    expect(snap(loadoutDraft), '局内拿到的那份与局外逐字段相同').toEqual(snap(reloaded));
    expect(entity.bodyDefId, '真实实体消费的 bodyDefId 与局外一致').toBe('mangoBody');
    const mangoDef = registry.bodies.get('mangoBody')!;
    const mine = bodyMapping(reloaded);
    expect(mine.hp).toBe(mangoDef.hp);
    expect(mine.baseMass).toBe(mangoDef.baseMass);
    expect(mine.energyCapacity).toBe(mangoDef.energyCapacity);

    // ③ 只换 Body（mango → durian）⇒ Weapon / rear / front / drive **逐字节**不变
    const before = snap(reloaded);
    const swapped = equipBody('durianBody', reloaded);
    expect(swapped.ok, '换第二台车身应成功').toBe(true);
    const after = snap(swapped.draft as BuildDraft);
    expect(after.body, 'Body 确实换了').toBe('durianBody');
    expect(after.weapon, 'Weapon 不得被换 Body 覆盖').toBe(before.weapon);
    expect(after.stars, 'Weapon 星级不得被换 Body 覆盖').toBe(before.stars);
    expect(after.rear, 'rear Movement 不得被换 Body 覆盖').toBe(before.rear);
    expect(after.front, 'front Movement 不得被换 Body 覆盖').toBe(before.front);
    expect(after.drive).toBe(before.drive);
  });

  it('BV-17 同一组合下只换 rear（large → heavy）⇒ Body / Weapon / front 逐字节不变', () => {
    grantAllNew();
    grantMovement('largeWheel');
    grantMovement('smallWheel');
    grantMovement('heavyWheel');

    const built = assembleVehicle();
    const before = snap(built);

    const out = equipMovement('rear', 'heavyWheel', built, playerInventory(built));
    expect(out.ok, `rear 换重型应成功（${out.detail ?? '–'}）`).toBe(true);
    const after = snap(out.draft as BuildDraft);

    expect(after.rear, 'rear 确实换了').toBe('heavyWheel');
    expect(after.body, 'Body 不得被换 Movement 覆盖').toBe(before.body);
    expect(after.weapon, 'Weapon 不得被换 Movement 覆盖').toBe(before.weapon);
    expect(after.stars, 'Weapon 星级不得被换 Movement 覆盖').toBe(before.stars);
    expect(after.front, '另一个挂点（front）不得被覆盖').toBe(before.front);
    // 落盘 + reload 之后仍然是这四个值（写入口落的就是磁盘那唯一一份）
    expect(snap(loadEquippedDraft())).toEqual(after);
  });
});
