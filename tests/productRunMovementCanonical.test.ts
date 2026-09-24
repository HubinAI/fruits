/**
 * PRODUCT-LOOP-R3-MOVEMENT-CANONICAL-INVENTORY｜targeted **契约** 测试（纯 node，无浏览器）。
 *
 * 被测对象 = `src/product/runMovementCanonical.ts`（canonical mapping）
 *          + 它钉死的那条真实链路：**Garage / Profile → Run Snapshot → Runtime**。
 *
 * ── 本文件要证的三件事 ───────────────────────────────────────────────────────
 *   ① **唯一正式数据源明确**：正式 Movement 内容 = `registry.movements`；
 *      「缺省轮组 / 缺省 Drive」由**正式函数**回答，产品侧没有任何第二条真源
 *      （`MC-01` / `MC-02` / `MC-03` / `MC-04` / `MC-10`）。
 *   ② **Garage/Profile → Run Snapshot → Runtime 映射一致**：局外那份 draft 里的
 *      Movement / Drive，经「产品侧编码 → 局内解析 → 正式 Snapshot → 真实 Runtime 计划」
 *      之后，逐项与局外**完全相同**（`MC-05` / `MC-06` / `MC-08`）。
 *   ③ 边界：产品 Garage 的写入口**结构上碰不到** Movement（`MC-07`）；
 *      未知轮组在**两侧都被拒绝**（`MC-09`）。
 *
 * ── 为什么这组断言不是「换个地方再抄一遍」──────────────────────────────────
 *   - 局外一侧读的是 `movementMapping()`（内部走真实 `buildSnapshotFromDraft` +
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
import { OFFICIAL_MOVEMENTS, addPart } from '../src/core/partInventory';
import { loadPlayerBuild, savePlayerBuild } from '../src/core/buildPersistence';
import {
  EMPTY_SLOT,
  makeStarterDraft,
  resolveDriveMode,
  type BuildDraft,
} from '../src/lab/buildEditorModel';
import {
  PLAYER_BODY_DEF_ID,
  WEAPON_SLOT,
  defaultPlayerDraft,
  equipWeapon,
  playerInventory,
} from '../src/product/playerLoadout';
import { buildAdventureHref } from '../src/product/runReward';
import {
  canonicalMovementDefIds,
  canonicalMovements,
  defaultDriveMode,
  defaultMovementDefId,
  isCanonicalMovement,
  isStoredUnmounted,
  movementHardpointIds,
  movementMapping,
} from '../src/product/runMovementCanonical';
import { parseRunPlayerLoadout } from '../src/lab/portraitBattleLab/runPlayerLoadout';
import {
  RUN_DEMO_ENCOUNTER_ID,
  resolveRunPlayerLoadout,
} from '../src/lab/portraitBattleLab/runPageScene';
import { buildSpawnPlanFromDraft } from '../src/lab/portraitBattleLab/entities';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PRODUCT_DIR = join(REPO_ROOT, 'src', 'product');
const LAB_DIR = join(REPO_ROOT, 'src', 'lab');

/** 剥注释（本项目铁律：注释里的自指文字会骗过字符串匹配）。 */
function strip(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
const readProduct = (f: string): string => readFileSync(join(PRODUCT_DIR, f), 'utf8');
const readLab = (f: string): string => readFileSync(join(LAB_DIR, f), 'utf8');

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
  const href = buildAdventureHref('run-mc', { stack: 5, choices: [] }, draft);
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

/** 同步轮径（真实写入路径的做法：选轮组时同时把该轮组默认半径写进 draft）。 */
function withWheel(draft: BuildDraft, key: 'rear' | 'front', defId: string): BuildDraft {
  const def = registry.movements.get(defId);
  const next: BuildDraft = { ...draft };
  if (key === 'rear') {
    next.rearWheelDefId = defId;
    next.rearRadius = def?.radius ?? next.rearRadius;
  } else {
    next.frontWheelDefId = defId;
    next.frontRadius = def?.radius ?? next.frontRadius;
  }
  return next;
}

/** 夹具矩阵：覆盖「缺省 / 每个正式轮组 / 双槽组合 / 卸下 / 停驻」这条链路的全部形态。 */
function fixtures(): Array<{ label: string; draft: BuildDraft }> {
  const out: Array<{ label: string; draft: BuildDraft }> = [];
  out.push({ label: '产品默认车（无轮组字段）', draft: defaultPlayerDraft() });
  out.push({ label: '正式 starter（无轮组字段）', draft: makeStarterDraft(PLAYER_BODY_DEF_ID, registry) });
  for (const defId of canonicalMovementDefIds()) {
    out.push({ label: `后轮=${defId}`, draft: withWheel(defaultPlayerDraft(), 'rear', defId) });
    out.push({ label: `前轮=${defId}`, draft: withWheel(defaultPlayerDraft(), 'front', defId) });
  }
  out.push({ label: '前+后=小轮组', draft: withWheel(withWheel(defaultPlayerDraft(), 'rear', 'smallWheel'), 'front', 'smallWheel') });
  out.push({ label: '后重轮 + 前大轮 + 停驻', draft: { ...withWheel(withWheel(defaultPlayerDraft(), 'rear', 'heavyWheel'), 'front', 'largeWheel'), drive: 'stationary' } });
  out.push({ label: '单轮卸下（rear=none）', draft: { ...defaultPlayerDraft(), rearWheelDefId: EMPTY_SLOT } });
  out.push({ label: '双轮卸下（站桩）', draft: { ...defaultPlayerDraft(), rearWheelDefId: EMPTY_SLOT, frontWheelDefId: EMPTY_SLOT, drive: 'stationary' } });
  return out;
}

/* ================================================================== MC-01..04 唯一真源 */

describe('MC-01..04｜唯一正式数据源 = 正式内容库 / 正式函数（产品侧没有第二张表）', () => {
  it('MC-01 canonical Movement 集合与 registry.movements **集合相等**（不是「至少包含」）', () => {
    const fromModule = [...canonicalMovementDefIds()].sort();
    const fromRegistry = [...registry.movements.keys()].sort();
    expect(fromModule).toEqual(fromRegistry);
    // 遍历 registry ⇒ 结构上不可能少一件；这里额外证「没有多出一件编造的 id」
    for (const id of fromModule) expect(registry.movements.has(id), `"${id}" 必须在正式内容库里`).toBe(true);
  });

  it('MC-02 每一项读数都现读自真实 def（本模块不复制任何数值）', () => {
    const rows = canonicalMovements();
    expect(rows.length).toBe(registry.movements.size);
    for (const row of rows) {
      const def = registry.movements.get(row.defId);
      expect(def, `"${row.defId}" 必须存在`).toBeDefined();
      expect(row.name).toBe(def!.name);
      expect(row.kind).toBe(def!.kind);
      expect(row.radius).toBe(def!.radius);
      expect(row.mass).toBe(def!.mass);
      expect(row.energy).toBe(def!.energy);
      expect(row.needsInventory).toBe(OFFICIAL_MOVEMENTS.includes(row.defId));
    }
    // V1 正式只支持 wheel（与 buildValidator 的口径一致）
    for (const row of rows) expect(row.kind).toBe('wheel');
  });

  it('MC-03 缺省轮组 = 「正式 Snapshot 对无轮组选择的 draft 实际填的那个」（不是本模块写的字面量）', () => {
    const fallback = defaultMovementDefId();
    expect(isCanonicalMovement(fallback), '缺省轮必须落在正式内容库里').toBe(true);
    // ⚠️ 由**真实链路**产出：正式 starter 没有轮组字段 ⇒ Snapshot 填的就是缺省
    const starter = makeStarterDraft(PLAYER_BODY_DEF_ID, registry);
    expect(movementMapping(starter).effectiveDefIds).toEqual([fallback, fallback]);
    // 缺省轮必须**无需库存**（否则新账号第一次打开首页就装不上轮子）
    const row = canonicalMovements().find((m) => m.defId === fallback);
    expect(row?.needsInventory, '缺省轮不得依赖库存').toBe(false);
    // 且有真实默认拥有语义
    expect(OFFICIAL_MOVEMENTS.includes(fallback), '缺省轮不进库存（恒默认拥有）').toBe(false);
  });

  it('MC-04 缺省 Drive = 正式归一函数的缺省结果（不是本模块写的字面量）', () => {
    expect(defaultDriveMode()).toBe('forward');
    expect(defaultDriveMode()).toBe(resolveDriveMode(undefined));
    expect(resolveDriveMode('stationary')).toBe('stationary');
  });

  it('MC-04b Movement 挂点取自真实 BodyDef（正式玩家车身 = rear/front）', () => {
    const ids = movementHardpointIds();
    const body = registry.bodies.get(PLAYER_BODY_DEF_ID);
    expect(ids).toEqual(body!.movementHardpoints.map((h) => h.id));
    expect([...ids].sort()).toEqual(['front', 'rear']);
  });
});

/* ================================================================== MC-05..06 契约（映射一致） */

describe('MC-05｜Garage/Profile → Run Snapshot 映射一致（全形态矩阵）', () => {
  for (const { label, draft } of fixtures()) {
    it(`MC-05 ${label}｜局外读数 == 局内解析后的读数`, () => {
      const mine = movementMapping(draft);
      const { loadoutDraft, entity } = runSide(draft);

      // ① 携带无损：局内拿到的那份 draft 与局外逐字段相同
      expect(loadoutDraft.bodyDefId).toBe(draft.bodyDefId);
      expect(loadoutDraft.rearWheelDefId).toBe(draft.rearWheelDefId);
      expect(loadoutDraft.frontWheelDefId).toBe(draft.frontWheelDefId);
      expect(loadoutDraft.rearRadius).toBe(draft.rearRadius);
      expect(loadoutDraft.frontRadius).toBe(draft.frontRadius);

      // ② Run Snapshot 真正装载的 Movement == 局外读数（顺序同硬点顺序）
      expect(entity.movements.map((m) => m.defId)).toEqual([...mine.effectiveDefIds]);

      // ③ Drive 一致
      expect(entity.drive).toBe(mine.drive);
      expect(mine.drive).toBe(resolveDriveMode(draft.drive));

      // ④ 生效的 Movement 全部落在正式内容库里（canonical 集合就是唯一口径）
      for (const id of mine.effectiveDefIds) expect(isCanonicalMovement(id)).toBe(true);
      for (const s of mine.slots) {
        if (s.effectiveDefId === null) {
          expect(s.runtimeNumbers, `${s.hardpointId} 未装 ⇒ 不该有 Runtime 数值`).toBeNull();
        } else {
          expect(isCanonicalMovement(s.effectiveDefId)).toBe(true);
        }
      }
    });
  }
});

describe('MC-06｜Runtime 用的数值确实来自正式 def（+ 轮径 override 语义）', () => {
  for (const { label, draft } of fixtures()) {
    it(`MC-06 ${label}｜mass/grip/maxRPM 来自 def；radius 来自 draft override（两者同源时可对账）`, () => {
      const mine = movementMapping(draft);
      const { entity } = runSide(draft);

      expect(entity.movements.length).toBe(mine.effectiveDefIds.length);
      for (let i = 0; i < entity.movements.length; i += 1) {
        const m = entity.movements[i]!;
        const slot = mine.slots.find((s) => s.hardpointId === m.hardpointId);
        expect(slot, `局外读数里必须有 ${m.hardpointId} 槽`).toBeDefined();
        expect(slot!.runtimeNumbers, `${label}: ${m.hardpointId} 应有 Runtime 数值`).not.toBeNull();

        // 局内真实实体 == 局外映射读数（两侧都来自正式 resolveSnapshot）
        expect(m.radius).toBe(slot!.runtimeNumbers!.radius);
        expect(m.mass).toBe(slot!.runtimeNumbers!.mass);
        expect(m.energy).toBe(slot!.runtimeNumbers!.energy);
        expect(m.maxRPM).toBe(slot!.runtimeNumbers!.maxRPM);
        expect(m.grip).toBe(slot!.runtimeNumbers!.grip);

        // mass / energy / maxRPM / grip **逐字**等于正式 def（无产品侧改写）
        const def = registry.movements.get(m.defId)!;
        expect(m.mass).toBe(def.mass);
        expect(m.energy).toBe(def.energy);
        expect(m.maxRPM).toBe(def.maxRPM);
        expect(m.grip).toBe(def.grip);

        // ⚠️ radius 走 **draft 数值 override**（`buildSnapshotFromDraft` 恒写 `overrides.radius`）
        //    ⇒ 生效半径由 draft 的 rear/frontRadius 决定，def.radius 只在写入者同步过时才等值。
        const expectedRadius =
          m.hardpointId === 'rear' ? draft.rearRadius : draft.frontRadius;
        expect(m.radius).toBe(expectedRadius);
      }
    });
  }

  it('MC-06b 写入者同步过轮径时（真实写入路径的做法）生效半径 == def.radius', () => {
    for (const defId of canonicalMovementDefIds()) {
      const def = registry.movements.get(defId)!;
      const draft = withWheel(withWheel(defaultPlayerDraft(), 'rear', defId), 'front', defId);
      const { entity } = runSide(draft);
      for (const m of entity.movements) expect(m.radius).toBe(def.radius);
    }
  });
});

/* ================================================================== MC-07 写路径不碰 Movement */

describe('MC-07｜产品 Garage 的写入口**结构上碰不到** Movement / Drive', () => {
  it('MC-07 equipWeapon 只改 frontMass 一槽：轮组 / 驱动 / 轮径逐项不变', () => {
    const draft = defaultPlayerDraft();
    const inv = playerInventory(draft);
    addPart(inv, 'spear', 1, 1);

    const before = movementMapping(draft);
    const out = equipWeapon('spear', draft, inv, 1);
    expect(out.ok, `换装应成功（detail: ${out.detail ?? '–'}）`).toBe(true);
    const next = out.draft!;

    // ① 唯一变化的字段 = 武器槽
    expect(next.functionalSelections[WEAPON_SLOT]).toBe('spear');
    // ② Movement / Drive 相关字段逐项不变
    expect(next.rearWheelDefId).toBe(draft.rearWheelDefId);
    expect(next.frontWheelDefId).toBe(draft.frontWheelDefId);
    expect(next.rearRadius).toBe(draft.rearRadius);
    expect(next.frontRadius).toBe(draft.frontRadius);
    expect(next.drive).toBe(draft.drive);
    // ③ 映射读数整份不变
    expect(movementMapping(next)).toEqual(before);
  });

  it('MC-07b 源码层面：playerLoadout.ts 的**代码**里没有任何 Movement / Drive 字段名', () => {
    const code = strip(readProduct('playerLoadout.ts'));
    expect(code).not.toMatch(/rearWheelDefId|frontWheelDefId/);
    expect(code).not.toMatch(/\.drive\b|\bdrive:/);
    // 反向对照：注释里**必须**明确写着这条边界（否则下一个人会以为只是漏了）
    const raw = readProduct('playerLoadout.ts');
    expect(raw).toMatch(/Body \/ Movement \/ 其它 Gadget/);
  });
});

/* ================================================================== MC-08 Drive 往返 */

describe('MC-08｜Drive 往返（缺省 / 停驻 / 非法值）', () => {
  it('MC-08 缺省（无 drive 字段）两侧都归一为 forward', () => {
    const draft = defaultPlayerDraft();
    delete draft.drive;
    expect(draft.drive).toBeUndefined();
    expect(movementMapping(draft).drive).toBe('forward');
    expect(runSide(draft).entity.drive).toBe('forward');
  });

  it('MC-08b drive=stationary 经真实地址往返后仍是 stationary（局内真实实体同值）', () => {
    const draft: BuildDraft = { ...defaultPlayerDraft(), drive: 'stationary' };
    const mine = movementMapping(draft);
    expect(mine.drive).toBe('stationary');
    const { loadoutDraft, entity } = runSide(draft);
    expect(loadoutDraft.drive).toBe('stationary');
    expect(entity.drive).toBe('stationary');
  });

  it('MC-08c 非法 drive 串：局外归一为 forward；局内解析**丢弃**该字段（不崩）', () => {
    const draft = { ...defaultPlayerDraft(), drive: 'reverse' } as unknown as BuildDraft;
    expect(resolveDriveMode((draft as BuildDraft).drive)).toBe('forward');
    const { loadoutDraft, entity } = runSide(draft);
    expect(loadoutDraft.drive, '局内解析不认识的值整字段不采纳').toBeUndefined();
    expect(entity.drive, '真实实体落到正式缺省').toBe('forward');
  });
});

/* ================================================================== MC-09 未知轮组两侧都拒绝 */

describe('MC-09｜未知轮组在**两侧都被拒绝**（不静默降级成别的车）', () => {
  it('MC-09 未知 Movement：局外存档层拒收 + 局内解析层拒绝（fallback=invalid）', () => {
    const bad: BuildDraft = {
      ...defaultPlayerDraft(),
      rearWheelDefId: 'tinyWheel',
      frontWheelDefId: 'tinyWheel',
    };
    // ① 局外：正式存档层结构校验拒绝 ⇒ 读回来是 null（调用方回退默认车，不会带着坏轮组开战）
    savePlayerBuild(bad);
    expect(loadPlayerBuild(), '未知轮组不得进正式存档').toBeNull();

    // ② 局内：解析层拒绝
    const search = adventureSearch(bad);
    expect(parseRunPlayerLoadout(search), '未知轮组不得进战斗').toBeNull();

    const res = resolveRunPlayerLoadout(search);
    expect(res.fallback).toBe('invalid');
    // ⚠️ 如实记录既有语义：`invalid`（数据坏了）**不**置 `blocked`（那是「数据好但产品不支持」，
    //    见 PRODUCT-LOOP-P0）。这条路径在真实产品里不可达 —— ① 已经把坏数据挡在存档之外。
    expect(res.blocked).toBe(false);

    // ③ 结构原因：正式解析层对未知轮组**抛错**（不会悄悄换成另一个轮子接着跑）
    expect(() => movementMapping(bad)).toThrow(/unknown movement "tinyWheel"/);
  });

  it('MC-09b canonical 判定 = 正式内容库，不是字符串形状', () => {
    expect(isCanonicalMovement(defaultMovementDefId())).toBe(true);
    for (const id of canonicalMovementDefIds()) expect(isCanonicalMovement(id)).toBe(true);
    for (const badId of ['tinyWheel', 'wheelTurbo', 'smallwheel', 'wheel_std', '', 'none']) {
      expect(isCanonicalMovement(badId), `"${badId}" 不是正式 Movement`).toBe(false);
    }
  });

  it('MC-09c 未装 / 缺省 / 明确卸下 三种形态在映射里可区分', () => {
    // 缺省（没有这个键）
    const absent = movementMapping(defaultPlayerDraft());
    expect(absent.slots[0]!.storedDefId).toBeNull();
    expect(absent.slots[0]!.effectiveDefId).toBe(defaultMovementDefId());
    expect(isStoredUnmounted(absent.slots[0]!)).toBe(false);

    // 明确卸下
    const unmounted = movementMapping({ ...defaultPlayerDraft(), rearWheelDefId: EMPTY_SLOT });
    const rear = unmounted.slots.find((s) => s.hardpointId === 'rear')!;
    expect(rear.storedDefId).toBe(EMPTY_SLOT);
    expect(rear.effectiveDefId, '卸下 ⇒ 该槽没有 Movement').toBeNull();
    expect(rear.runtimeNumbers).toBeNull();
    expect(isStoredUnmounted(rear)).toBe(true);
  });
});

/* ================================================================== MC-10 源码守卫 */

describe('MC-10｜源码守卫：产品链路里不得出现 canonical 集合之外的轮组字面量', () => {
  it('MC-10 产品目录（src/product/*.ts）里所有「轮组形态」字面量都必须在正式内容库里', () => {
    /**
     * 排除三个**不是轮组 id** 的 token（它们含有 `wheel` 字样但语义是字段名 / 判别值）：
     *   - `rearWheelDefId` / `frontWheelDefId` = `BuildDraft` 的**字段名**（协议的一部分）；
     *   - `wheel` = `MovementDef.kind` 的判别值（不是任何一个具体 Movement）。
     */
    const NOT_A_DEF_ID = new Set(['wheel', 'rearWheelDefId', 'frontWheelDefId']);
    const wheelLike = /'([A-Za-z_]*[Ww]heel[A-Za-z_0-9]*)'/g;
    const offenders: string[] = [];
    for (const f of readdirSync(PRODUCT_DIR).filter((n) => n.endsWith('.ts'))) {
      const code = strip(readProduct(f));
      for (const m of code.matchAll(wheelLike)) {
        const id = m[1]!;
        if (NOT_A_DEF_ID.has(id)) continue;
        if (!isCanonicalMovement(id)) offenders.push(`${f}: '${id}'`);
      }
    }
    expect(offenders, '产品链路出现了正式内容库之外的轮组 id').toEqual([]);
    // 反向对照：本守卫确实扫到了东西（不是「一个都没匹配上」的假绿）
    expect(strip(readProduct('vehiclePreview.ts'))).toMatch(/'wheelStd'/);
  });

  it('MC-10b 缺省轮的既有 fallback 字面量 == 正式缺省（钉死重复，不改实现）', () => {
    const fallback = defaultMovementDefId();
    const fallbackLiteral = /\?\? '([^']*[Ww]heel[^']*)'/;
    // `buildSnapshotFromDraft`：draft 没有轮组选择时填哪个 defId
    const snap = fallbackLiteral.exec(strip(readLab('buildEditorModel.ts')));
    expect(snap?.[1], 'buildEditorModel 的缺省轮 fallback 必须与正式缺省同值').toBe(fallback);
    // 首页整车预览同一处口径
    const prev = fallbackLiteral.exec(strip(readProduct('vehiclePreview.ts')));
    expect(prev?.[1], 'vehiclePreview 的缺省轮 fallback 必须与正式缺省同值').toBe(fallback);
  });

  it('MC-10c 局内解析器对轮组字段是「原样搬运」，不做第二套解释', () => {
    const code = strip(readFileSync(join(LAB_DIR, 'portraitBattleLab', 'runPlayerLoadout.ts'), 'utf8'));
    expect(code).toMatch(/rearWheelDefId/);
    expect(code).toMatch(/frontWheelDefId/);
    // 不得出现任何轮组 id 字面量（它不认识具体轮组，只认识 BuildDraft 的字段名）
    expect(code).not.toMatch(/wheelStd|smallWheel|largeWheel|heavyWheel/);
  });
});
