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
  equipMovement,
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

  it('MC-07b 源码层面：Movement 写入口结构（defId 间接写 + radius 只经 equip 路径、用真源、不带裸数字、与 hardpoint 同侧）', () => {
    const raw = readProduct('playerLoadout.ts');
    const code = strip(raw);
    /*
      ⚠️ PRODUCT-LOOP-P0-MOVEMENT-RADIUS-SOURCE-OF-TRUTH｜**结构守卫（强化，不是魔法计数）**。

      上一版这条断言用「`rearWheelDefId` / `frontWheelDefId` 出现 4 行 / 5 token」的魔法计数，
      本 Queue 合法新增了缺省轮复位 + explicit 两个分支的 radius 同步写（各含一次
      `key === 'rearWheelDefId'` 判等）⇒ 计数必然变红。**按用户指令不把 4→5 简单放大**，
      改成**结构守卫**：只认「位置与形态」，不认「次数」。

      要守的结构：
        Ⓐ Movement defId 字段名只允许出现在两类地方 —— ① `MOVEMENT_DRAFT_KEY` 的声明
           （类型注解 + 表值）；② `equipMovement` 内 `key === 'rearWheelDefId'` /
           `key === 'frontWheelDefId'` 的 hardpoint 判等（用于 radius 同侧 gating）。
           任何其它出现（尤其直接左值赋值）一律红。
        Ⓑ `rearRadius` / `frontRadius` 的产品写入**只能**在 `equipMovement` 内：
           - 缺省轮分支写 `defaultMovementRadius().radius`（canonical default）；
           - explicit 分支写 `canonical.radius`（对应 def 的 canonical radius）；
           - RHS 不得是裸数字；
           - rear 的赋值必须与 `rearWheelDefId` 同侧、front 与 `frontWheelDefId` 同侧。
        Ⓒ 不得把 radius 写成裸数字；Drive 仍无任何产品侧写入。
    */
    // Ⓐ defId 字段名的每一处出现都必须是「表声明」或「hardpoint 判等」，不得散落
    const defIdUsages = [...code.matchAll(/(rearWheelDefId|frontWheelDefId)/g)];
    expect(defIdUsages.length, '应至少出现（表声明 3 + hardpoint 判等 2）').toBeGreaterThanOrEqual(5);
    for (const m of defIdUsages) {
      const idx = m.index ?? 0;
      const start = code.lastIndexOf('\n', idx) + 1;
      const end = code.indexOf('\n', idx);
      const line = code.slice(start, end);
      const isTableDecl =
        /Readonly<Record<string, 'rearWheelDefId' \| 'frontWheelDefId'>>/.test(line) ||
        /^\s*(?:rear|front):\s*'(?:rear|front)WheelDefId',?$/.test(line);
      const isHardpointCompare = /key\s*===\s*'(?:rear|front)WheelDefId'/.test(line);
      expect(
        isTableDecl || isHardpointCompare,
        `Movement 字段名只能出现在表声明或 hardpoint 判等，不能散落：${line.trim()}`,
      ).toBe(true);
    }
    // Ⓐb 绝不允许把字段名当左值直接赋值（写入必须经由 `next[key]`）
    expect(
      code,
      '不得出现「把 Movement 字段名直接当左值」的赋值（写入必须经由 MOVEMENT_DRAFT_KEY 取键）',
    ).not.toMatch(/(?:['"]?(?:rear|front)WheelDefId['"]?)\s*=[^=]/);
    // Ⓐc 间接写入仍然成立
    expect(code).toMatch(/MOVEMENT_DRAFT_KEY\[hardpointId\]/);
    expect(code).toMatch(/next\[key\]\s*=/);

    // Ⓑ radius 只经 equip 路径写：取出全部 `next.rearRadius` / `next.frontRadius` 赋值
    const radiusWrites = [...code.matchAll(/next\.(rear|front)Radius\s*=\s*([^;]+);/g)];
    // 2 侧（rear / front）× 2 分支（缺省轮复位 / explicit）= 4 处，且只能有这 4 处
    expect(radiusWrites.length, 'radius 赋值应恰好 2 侧 × 2 分支 = 4 处').toBe(4);
    for (const m of radiusWrites) {
      const side = m[1];
      const rhs = m[2].trim();
      // RHS 必须是变量/函数调用，**不得是裸数字**
      expect(/^\d+(\.\d+)?$/.test(rhs), `radius RHS 不得是裸数字：${side} = ${rhs}`).toBe(false);
      // 取该行完整语句，判断 gating 是否与 side 一致（rear↔rearWheelDefId，front↔frontWheelDefId）
      const idx = m.index ?? 0;
      const start = code.lastIndexOf('\n', idx) + 1;
      const end = code.indexOf('\n', idx);
      const stmt = code.slice(start, end);
      if (side === 'rear') {
        expect(stmt, 'rearRadius 必须与 rear 挂点同侧（rearWheelDefId）').toContain('rearWheelDefId');
      } else {
        // front 一侧：要么显式 `frontWheelDefId` 判等，要么是 `rear` 判等的 `else` 穷尽分支
        // （Movement 只有 rear / front 两个挂点，else 即 front，仍与 hardpoint 一致）
        const explicitFront = stmt.includes('frontWheelDefId');
        const isElseCounterpart = /^\s*else\b/.test(stmt);
        expect(
          explicitFront || isElseCounterpart,
          `frontRadius 必须与 front 挂点同侧（frontWheelDefId 判等，或 rear 判等的 else 穷尽分支）：${stmt.trim()}`,
        ).toBe(true);
      }
    }
    // Ⓑb 缺省轮分支：复位为 canonical default radius 真源（不写字面量）
    expect(code, '缺省轮分支必须复位为 canonical default radius 真源').toMatch(/defaultMovementRadius\(\)\.radius/);
    // Ⓑc explicit 分支：写对应 canonical def.radius
    expect(code, 'explicit 分支必须写对应 canonical def.radius').toMatch(/canonical\.radius/);
    // Ⓑd 整个文件不得出现「radius = 裸数字」的字面量写法
    expect(code, 'playerLoadout.ts 禁止把 radius 写成裸数字').not.toMatch(/(?:rear|front)Radius\s*[:=]\s*\d+/);
    // Ⓑe 这些 radius 赋值都落在 equipMovement 函数体内（不是别的写入路径）
    const fnStart = code.indexOf('export function equipMovement');
    const fnEnd = code.indexOf('export function ', fnStart + 1);
    const fnBody = code.slice(fnStart, fnEnd > 0 ? fnEnd : code.length);
    const writesInEquip = [...fnBody.matchAll(/next\.(?:rear|front)Radius\s*=/g)].length;
    expect(writesInEquip, '全部 radius 赋值都必须落在 equipMovement 内').toBe(radiusWrites.length);

    // Ⓒ Drive 仍然**没有任何**产品侧写入（本 Queue 不碰驱动模式）
    expect(code).not.toMatch(/\.drive\b|\bdrive:/);
    // Ⓓ 反向对照：注释里**必须**明确写着这条边界（否则下一个人会以为只是漏了）
    expect(raw).toMatch(/Body \/ Movement \/ 其它 Gadget/);
  });

  /*
    PRODUCT-LOOP-R3-MOVEMENT-GARAGE-EQUIP｜两个写入口的**互不越界**契约。

    `MC-07` 已经证明「equipWeapon 碰不到 Movement」；下面这条是反方向：
    「equipMovement 碰不到 Weapon / Functional / Drive / Body」。
    两条合起来才是「两个动作各写各的字段」—— 这正是 Queue 必改 1 / 验收 5 要的
    「不覆盖 Weapon 配置」在**行为层**（不是字符串层）的可断言形式。
  */
  it('MC-07c equipMovement 只改目标挂点的轮组与轮径：Weapon / Functional / Drive / Body 逐项不变', () => {
    const draft = defaultPlayerDraft();
    const inv = playerInventory(draft);
    // 发一件真轮组（走正式库存写入；未拥有会被 `not-owned` 拒绝）
    addPart(inv, OFFICIAL_MOVEMENTS[0], 1, 1);

    const weaponSlotBefore = draft.functionalSelections[WEAPON_SLOT];
    const selectionsBefore = JSON.stringify(draft.functionalSelections);
    const starsBefore = JSON.stringify(draft.functionalStars ?? null);
    const driveBefore = draft.drive;

    const out = equipMovement('rear', OFFICIAL_MOVEMENTS[0], draft, inv);
    expect(out.ok, `装轮组应成功（detail: ${out.detail ?? '–'}）`).toBe(true);
    const next = out.draft as BuildDraft;

    // ① 目标挂点真的换了
    expect(next.rearWheelDefId).toBe(OFFICIAL_MOVEMENTS[0]);
    // ② 另一个挂点一字未动（rear / front 是两个独立正式字段）
    expect(next.frontWheelDefId).toBe(draft.frontWheelDefId);
    expect(next.frontRadius).toBe(draft.frontRadius);
    // ③ Weapon / Functional 选择整份不变
    expect(next.functionalSelections[WEAPON_SLOT]).toBe(weaponSlotBefore);
    expect(JSON.stringify(next.functionalSelections)).toBe(selectionsBefore);
    expect(JSON.stringify(next.functionalStars ?? null)).toBe(starsBefore);
    // ④ Drive / Body 不变（本 Queue 不碰驱动模式与车身）
    expect(next.drive).toBe(driveBefore);
    expect(next.bodyDefId).toBe(draft.bodyDefId);
    // ⑤ 入参本身没被改写（纯函数语义）
    expect(draft.rearWheelDefId).toBeUndefined();
  });

  /*
    PRODUCT-LOOP-R3-MOVEMENT-GARAGE-EQUIP｜**本 Queue 的核心映射契约**。

    与 `MC-05`（局外 draft → 真实产品地址 → 局内解析 → 真实 Runtime 计划）**同一台机器**，
    唯一区别是这里的 draft 是**经产品 Garage 写入口真的装过轮组**的那一份。
    于是「Garage 装上的」与「Run 真正装载的」在**同一条真实链路**上被逐项对上 ——
    这正是 Queue 验收 4「Product Run Snapshot 与 Garage 配置一致」的机器形式。
  */
  it('MC-07d Garage 装上的轮组经真实地址 → 真实解析 → 真实 Runtime 计划后逐项一致', () => {
    const draft = defaultPlayerDraft();
    const inv = playerInventory(draft);
    for (const m of OFFICIAL_MOVEMENTS) addPart(inv, m, 1, 1);

    // ① 经**产品写入口**真的装上（rear 与 front 各一件，证明两侧独立）
    const a = equipMovement('rear', OFFICIAL_MOVEMENTS[0], draft, inv);
    expect(a.ok).toBe(true);
    const b = equipMovement('front', OFFICIAL_MOVEMENTS[1], a.draft as BuildDraft, inv);
    expect(b.ok).toBe(true);
    const equipped = b.draft as BuildDraft;

    // ② 局外读数（Garage 画的那一份）
    const garage = movementMapping(equipped);
    expect(garage.slots.map((s) => s.effectiveDefId)).toEqual([
      OFFICIAL_MOVEMENTS[0],
      OFFICIAL_MOVEMENTS[1],
    ]);

    // ③ 走真实产品地址 → 真实解析器 → 真实 Runtime 计划
    const run = runSide(equipped);
    // ④ 「Garage 显示的轮组」== 「Run 真实装载的轮组」，逐条 defId 相等
    expect(run.entity.movements.map((m) => m.defId)).toEqual(
      garage.slots.map((s) => s.effectiveDefId),
    );
    // ⑤ 半径也一致（overrides 合并语义在两侧同源）
    for (const m of run.entity.movements) {
      const slot = garage.slots.find((s) => s.hardpointId === m.hardpointId)!;
      expect(m.radius).toBe(slot.runtimeNumbers!.radius);
    }
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
    /*
      反向对照：本守卫确实扫到了东西（不是「一个都没匹配上」的假绿）。

      ⚠️ PRODUCT-LOOP-R3-MOVEMENT-EQUIP-PREVIEW 起对照对象**换成了一条恒定成立的探针**：
         原先这里钉的是 `vehiclePreview.ts` 里的 `?? 'wheelStd'` 字面量 —— 那正是本
         Queue 修掉的缺陷载体（把「没有 defId ⇒ 当作缺省轮」写成硬编码口径，并让轮径
         优先取陈旧的 `draft.*Radius`）。现在预览改读 `effectiveMovementRadius()`
         （缺省轮由正式链路给出）⇒ 该字面量已不存在，继续钉它只会变成假警报。
         同理，`playerLoadout.ts` 的 `'wheelStd'` 也已只剩注释里的文字（本守卫先剥注释 ⇒
         扫不到）。⚠️ 换句话说：**产品侧现在只剩 `'wheel'` / 字段名两类字面量**，
         「用一个真实 defId 字面量当反向对照」这条路已经没有了。
         ⇒ 改用 `'wheel'`（`MovementDef.kind` 的判别值，且已被 `NOT_A_DEF_ID` 排除）
            作为探针：它**恒定**存在于 `vehiclePreview.ts`，能证明正则真的在匹配
            （不是「一个都没扫到」的假绿），同时不引入任何对具体轮组 id 的依赖。
    */
    expect(strip(readProduct('vehiclePreview.ts'))).toMatch(/'wheel'/);
  });

  it('MC-10b 缺省轮的既有 fallback 字面量 == 正式缺省（钉死重复，不改实现）', () => {
    const fallback = defaultMovementDefId();
    /*
      ⚠️ 本条**按契约变更收窄**（不是放宽）：原先还钉一处
         「`vehiclePreview.ts` 里的 `?? '<缺省轮>'`」，但那处字面量已随
         PRODUCT-LOOP-R3-MOVEMENT-EQUIP-PREVIEW 的修复**消失**（预览改为经正式链路
         读缺省轮，不再自己写 fallback）⇒ 该断言的对象不复存在。
         本守卫**真正的意图**——「谁在代码里重复了缺省轮这个事实，就必须与正式缺省同值」
         —— 一字未改：仍然逐处枚举，只是不再枚举一处已经没有 fallback 的文件；
         并**同时**断言预览已不再持有该 fallback（否则将来有人加回来会无人察觉）。
    */
    const fallbackLiteral = /\?\? '([^']*[Ww]heel[^']*)'/;
    // `buildSnapshotFromDraft`：draft 没有轮组选择时填哪个 defId
    const snap = fallbackLiteral.exec(strip(readLab('buildEditorModel.ts')));
    expect(snap?.[1], 'buildEditorModel 的缺省轮 fallback 必须与正式缺省同值').toBe(fallback);
    // 预览**不再**自己写缺省轮 fallback（缺省轮由 `effectiveMovementRadius` 给出）
    const prevCode = strip(readProduct('vehiclePreview.ts'));
    expect(fallbackLiteral.exec(prevCode), 'vehiclePreview 不该再有缺省轮 fallback 字面量').toBeNull();
    expect(prevCode, 'vehiclePreview 必须走正式链路取生效轮径').toContain('effectiveMovementRadius');
  });

  it('MC-10c 局内解析器对轮组字段是「原样搬运」，不做第二套解释', () => {
    const code = strip(readFileSync(join(LAB_DIR, 'portraitBattleLab', 'runPlayerLoadout.ts'), 'utf8'));
    expect(code).toMatch(/rearWheelDefId/);
    expect(code).toMatch(/frontWheelDefId/);
    // 不得出现任何轮组 id 字面量（它不认识具体轮组，只认识 BuildDraft 的字段名）
    expect(code).not.toMatch(/wheelStd|smallWheel|largeWheel|heavyWheel/);
  });
});
