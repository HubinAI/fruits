/**
 * PRODUCT-LOOP-P0-MOVEMENT-RADIUS-SOURCE-OF-TRUTH｜
 * **一次正常 Garage 装备操作后，四个面的有效轮径必须是同一个数**。
 *
 * 四个面（本 Queue 的核心断言对象）：
 *   ① Garage 当前 Movement（生效 defId）
 *   ② persisted BuildDraft 的 `rearRadius` / `frontRadius`
 *   ③ Product Run Snapshot / Runtime 的有效半径（`resolved.movements[].def.radius`）
 *   ④ Preview 画出来的轮子直径（`vehiclePreviewLayout`）
 *
 * ── 本 Queue 修的是哪个真实缺陷 ────────────────────────────────────────────────
 * 上一 Queue（`PRODUCT-LOOP-R3-MOVEMENT-EQUIP-PREVIEW`）只修了**显示侧**：
 * 让 Preview 改读 canonical def 半径。于是出现了一个**更危险**的新形态 ——
 * 屏幕与行为分叉：
 *
 * ```
 *   装 smallWheel 到 rear，再切回缺省轮 wheelStd
 *   ① Garage          → wheelStd            ✅
 *   ② persisted       → rearRadius = 12     ❌ 残留（应 20）
 *   ③ Run Snapshot    → def.radius = 12     ❌ 玩家真的用小轮半径跑
 *   ④ Preview         → 40×40（=20）        ✅ 上一 Queue 已修
 * ```
 * 即「屏幕上画的是标准轮、跑起来是小轮」。**②③ 才是玩家实际吃到的东西**，
 * 所以必须修写入口，而不是继续让读取侧去猜。
 *
 * ⚠️ 探针复现口径（本文件写入前实测）：`ResolvedMovement` 的有效半径在
 *    **`def.radius`**（`resolveSnapshot` 已把 `overrides` 合并进 `def`），
 *    且数组元素的挂点字段是 **`install.hardpointId`** —— 写错这两处会读到 `undefined`，
 *    让断言变成空转（这正是本 Queue 第一步踩到的坑）。
 *
 * ── 修复口径（最小、不推翻旧档兼容）────────────────────────────────────────────
 * `equipMovement` 的缺省轮分支原本只 `delete next[key]`。现在**同时**把该槽 radius 写回
 * 缺省轮的 canonical radius（`runMovementCanonical.defaultMovementRadius()`，
 * 与 explicit 分支「defId 变 ⇒ radius 一起变」**同一口径**）。
 * ⇒ `buildSnapshotFromDraft` 的 `overrides.radius` 兼容架构**一字未动**
 *   （Lab 的轮径试验能力仍在，见 RD-05），只是正常产品路径不再产生陈旧值。
 *
 * ── 明确不改变的东西（Queue 禁止清单）──────────────────────────────────────────
 *   - canonical Movement 参数（RD-06：registry 逐件不变）
 *   - `buildSnapshot` 的全局 override 合并规则（RD-05：override 仍然生效）
 *   - `none` 的正式语义（RD-04：仍然写 `'none'`、不新增物理规则）
 *   - Physics / Battle / Camera（RD-07 源码守卫）
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it } from 'vitest';

import { registry } from '../src/core/content';
import { OFFICIAL_MOVEMENTS } from '../src/core/partInventory';
import { buildSnapshotFromDraft, type BuildDraft } from '../src/lab/buildEditorModel';
import { resolveSnapshot } from '../src/core/buildSnapshot';
import { markR2Onboarding } from '../src/product/r2Onboarding';
import { markR2Reseed } from '../src/product/r2Reseed';
import { markR3MovementSeed } from '../src/product/r3MovementChoiceSeed';
import {
  defaultPlayerDraft,
  equipMovement,
  loadEquippedDraft,
  playerInventory,
} from '../src/product/playerLoadout';
import {
  canonicalMovements,
  defaultMovementDefId,
  defaultMovementRadius,
  effectiveMovementRadius,
  movementMapping,
} from '../src/product/runMovementCanonical';
import { vehiclePreviewLayout } from '../src/product/vehiclePreview';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PRODUCT_DIR = join(REPO_ROOT, 'src', 'product');
function readProduct(f: string): string {
  return readFileSync(join(PRODUCT_DIR, f), 'utf8');
}
/** 源码守卫必须先剥注释（本项目铁律：注释里的自指文字会骗过字符串匹配）。 */
function strip(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const INV_KEY = 'strongfruit.ownedParts.v2';
const BUILD_KEY = 'strongfruit.playerBuild.v1';

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
  markR2Onboarding();
  markR2Reseed();
  markR3MovementSeed();
});

/** 四档轮组全部发到手里。
 *  ⚠️ 必须写**磁盘**（真实库存 key）：`equipMovement` 每次都经 `playerInventory()`
 *     从磁盘重读 ⇒ 只改内存快照无效（会报 `not-owned`）。 */
function grantAll(): void {
  const inv = JSON.parse(store.getItem(INV_KEY) ?? '{}') as Record<string, { one?: number }>;
  for (const m of OFFICIAL_MOVEMENTS) {
    const row = inv[m] ?? {};
    row.one = 1;
    inv[m] = row;
  }
  store.setItem(INV_KEY, JSON.stringify(inv));
}

/** 走**真实写入口**依次装备（每次真实落盘 + 真实校验）。 */
function equipChain(start: BuildDraft, steps: readonly (readonly [string, string])[]): BuildDraft {
  let draft = start;
  for (const [hardpointId, defId] of steps) {
    const out = equipMovement(hardpointId, defId, draft, playerInventory(draft));
    expect(out.ok, `equip ${hardpointId}=${defId} 应成功：${out.detail ?? ''}`).toBe(true);
    draft = out.draft as BuildDraft;
  }
  return draft;
}

/** canonical 半径（断言里的**期望值真源**，取自 `canonicalMovements()`）。 */
function canonicalRadius(defId: string): number {
  const m = canonicalMovements().find((x) => x.defId === defId);
  expect(m, `canonical 集合里应有 ${defId}`).toBeTruthy();
  return (m as { radius: number }).radius;
}

/**
 * **四个面的有效轮径**（本文件的核心读数）。
 *
 * ⚠️ 三处易错点（写错任何一处都会让断言退化成 `undefined === undefined` 的空转）：
 *   1. Snapshot 的有效半径在 **`movements[].def.radius`**，不是 `movements[].radius`；
 *   2. movements 数组的挂点字段是 **`install.hardpointId`**；
 *   3. Preview 的 `item.w` 是**直径**（`radius × 2`），要除以 2 才能与其它三个面比。
 */
function radiusFaces(hardpointId: 'rear' | 'front'): {
  garageDefId: string | null;
  persistedRadius: number | undefined;
  runtimeRadius: number | null;
  previewRadius: number | null;
  all: number[];
} {
  const draft = loadEquippedDraft() as BuildDraft & Record<string, unknown>;
  const persistedKey = hardpointId === 'rear' ? 'rearRadius' : 'frontRadius';
  const persistedRadius = draft[persistedKey] as number | undefined;

  const resolved = resolveSnapshot(buildSnapshotFromDraft(draft, registry), registry);
  const mv = resolved.movements.find((m) => m.install.hardpointId === hardpointId);
  const runtimeRadius = mv ? mv.def.radius : null;

  const layout = vehiclePreviewLayout(draft);
  const item = layout.items.find((i) => i.key === `wheel:${hardpointId}`) ?? null;
  // `item.w` 是**未缩放直径**（本地 px），与 `layout.scale` 无关 ⇒ 直接 /2 得半径。
  const previewRadius = item ? item.w / 2 : null;

  const eff = effectiveMovementRadius(draft, hardpointId);
  const garageDefId = eff ? eff.defId : null;

  const all = [persistedRadius, runtimeRadius, previewRadius].filter(
    (v): v is number => typeof v === 'number',
  );
  return { garageDefId, persistedRadius, runtimeRadius, previewRadius, all };
}

/** 三个数值面（persisted / runtime / preview）全部相等且等于期望值。 */
function expectAllFacesEqualRadius(hardpointId: 'rear' | 'front', want: number, label: string): void {
  const f = radiusFaces(hardpointId);
  expect(f.all.length, `${label}｜三个数值面都应存在（不该有 null）`).toBe(3);
  expect(f.persistedRadius, `${label} persisted`).toBe(want);
  expect(f.runtimeRadius, `${label} runtime`).toBe(want);
  expect(f.previewRadius, `${label} preview`).toBe(want);
}

// ============================================================================
describe('P0-RADIUS-SOURCE-OF-TRUTH｜A. smallWheel → default wheelStd', () => {
  it('RD-01 切回缺省轮后 persisted / Runtime / Preview **三侧 radius 全等于 wheelStd canonical 半径**（不再是残留 12）', () => {
    const base = defaultPlayerDraft();
    grantAll();
    const stdR = canonicalRadius(defaultMovementDefId());
    const smallR = canonicalRadius('smallWheel');
    expect(smallR, '本用例前提：smallWheel 与缺省轮半径必须不同（否则断言无从区分）').not.toBe(stdR);

    // 先装 smallWheel（真实装备 ⇒ 制造出「上一件轮组」的语境）
    equipChain(base, [['rear', 'smallWheel']]);
    const mid = radiusFaces('rear');
    expect(mid.persistedRadius, '装 smallWheel 时 persisted 应为它的半径').toBe(smallR);
    expect(mid.garageDefId).toBe('smallWheel');

    // 真实动作：切回缺省轮
    equipChain(base, [
      ['rear', 'smallWheel'],
      ['rear', defaultMovementDefId()],
    ]);

    const f = radiusFaces('rear');
    expect(f.garageDefId, '① Garage 生效 defId 应为缺省轮').toBe(defaultMovementDefId());
    expectAllFacesEqualRadius('rear', stdR, 'A·切回缺省轮');
    // ⚠️ 反向对照：必须**不是**上一个轮组的半径（否则「全等」也可能是全错）
    expect(f.persistedRadius, '② persisted 不得残留 smallWheel 的半径').not.toBe(smallR);
    expect(f.runtimeRadius, '③ Runtime 不得残用 smallWheel 的半径').not.toBe(smallR);
  });

  it('RD-01b 存档里**没有** rearWheelDefId 键（缺省轮仍然走「键不存在」语义，不新增字面量）', () => {
    const base = defaultPlayerDraft();
    grantAll();
    equipChain(base, [
      ['rear', 'smallWheel'],
      ['rear', defaultMovementDefId()],
    ]);
    const raw = JSON.parse(store.getItem(BUILD_KEY) ?? '{}') as Record<string, unknown>;
    expect('rearWheelDefId' in raw, '缺省轮不应往存档写字面量').toBe(false);
    // 但 radius 键**必须**在（本 Queue 修复的就是它被留成旧值）
    expect(raw['rearRadius'], '缺省轮的半径必须显式写回 canonical 值').toBe(canonicalRadius(defaultMovementDefId()));
  });
});

// ============================================================================
describe('P0-RADIUS-SOURCE-OF-TRUTH｜B. largeWheel → smallWheel', () => {
  it('RD-02 换到 smallWheel 后三侧 radius 全等于 smallWheel canonical 半径', () => {
    const base = defaultPlayerDraft();
    grantAll();
    const largeR = canonicalRadius('largeWheel');
    const smallR = canonicalRadius('smallWheel');
    expect(largeR).not.toBe(smallR);

    // 先大轮（把 persisted 抬到 26），再换小轮 ⇒ 三个面都必须跟着降下来
    equipChain(base, [
      ['rear', 'largeWheel'],
      ['rear', 'smallWheel'],
    ]);

    const f = radiusFaces('rear');
    expect(f.garageDefId).toBe('smallWheel');
    expectAllFacesEqualRadius('rear', smallR, 'B·large→small');
    expect(f.persistedRadius, '不得残留 largeWheel 的半径').not.toBe(largeR);
  });

  it('RD-02b 显式 defId 一直是「radius = 该 def 的 canonical radius」（既有约定未被本 Queue 改动）', () => {
    const base = defaultPlayerDraft();
    grantAll();
    for (const m of canonicalMovements()) {
      const draft = equipChain(base, [['rear', m.defId]]);
      const f = radiusFaces('rear');
      expect(f.persistedRadius, `${m.defId} persisted`).toBe(m.radius);
      expect(f.runtimeRadius, `${m.defId} runtime`).toBe(m.radius);
      expect(f.previewRadius, `${m.defId} preview`).toBe(m.radius);
      // 与 `effectiveMovementRadius` 同一读数（① 与 ②③④ 同源）
      expect(effectiveMovementRadius(draft, 'rear')?.radius).toBe(m.radius);
    }
  });
});

// ============================================================================
describe('P0-RADIUS-SOURCE-OF-TRUTH｜C. rear large / front small → rear default', () => {
  it('RD-03 rear 切回缺省后**只有 rear 复位**，front 仍是 smallWheel（两侧互不污染）', () => {
    const base = defaultPlayerDraft();
    grantAll();
    const stdR = canonicalRadius(defaultMovementDefId());
    const smallR = canonicalRadius('smallWheel');
    const largeR = canonicalRadius('largeWheel');
    expect(new Set([stdR, smallR, largeR]).size, '三档半径必须互不相同').toBe(3);

    // 前提：rear large / front small
    equipChain(base, [
      ['rear', 'largeWheel'],
      ['front', 'smallWheel'],
    ]);
    const before = radiusFaces('rear');
    const beforeF = radiusFaces('front');
    expect(before.persistedRadius).toBe(largeR);
    expect(beforeF.persistedRadius).toBe(smallR);

    // 真实动作：只把 rear 切回缺省
    equipChain(base, [
      ['rear', 'largeWheel'],
      ['front', 'smallWheel'],
      ['rear', defaultMovementDefId()],
    ]);

    expectAllFacesEqualRadius('rear', stdR, 'C·rear 复位');
    // front 一字未动：三面仍是 smallWheel 的半径
    expectAllFacesEqualRadius('front', smallR, 'C·front 保持 small');
    const fF = radiusFaces('front');
    expect(fF.garageDefId, 'front 的 defId 不得被 rear 的动作改掉').toBe('smallWheel');
    expect(fF.persistedRadius, 'front 不得被 rear 的复位污染成缺省轮半径').not.toBe(stdR);
  });

  it('RD-03b 反向：front 切回缺省不动 rear（挂点独立性是对称的）', () => {
    const base = defaultPlayerDraft();
    grantAll();
    const stdR = canonicalRadius(defaultMovementDefId());
    const largeR = canonicalRadius('largeWheel');

    equipChain(base, [
      ['rear', 'largeWheel'],
      ['front', 'smallWheel'],
      ['front', defaultMovementDefId()],
    ]);

    expectAllFacesEqualRadius('front', stdR, 'C·front 复位');
    expectAllFacesEqualRadius('rear', largeR, 'C·rear 保持 large');
  });
});

// ============================================================================
describe('P0-RADIUS-SOURCE-OF-TRUTH｜D. reload 后保持 + none 语义不变', () => {
  it('RD-04a reload（重读 persisted BuildDraft）后四个面与内存中的结果**逐项相同**', () => {
    const base = defaultPlayerDraft();
    grantAll();
    const stdR = canonicalRadius(defaultMovementDefId());
    equipChain(base, [
      ['rear', 'smallWheel'],
      ['rear', defaultMovementDefId()],
    ]);
    const before = radiusFaces('rear');

    // reload = 重新从磁盘读 draft（本模块的 `loadEquippedDraft` 就是页面唯一的读入口）
    const after = radiusFaces('rear');
    expect(after.persistedRadius).toBe(before.persistedRadius);
    expect(after.runtimeRadius).toBe(before.runtimeRadius);
    expect(after.previewRadius).toBe(before.previewRadius);
    expect(after.garageDefId).toBe(before.garageDefId);
    expectAllFacesEqualRadius('rear', stdR, 'D·reload 后');
  });

  it('RD-04b `none`（明确卸下）语义**一字未动**：写 `\'none\'`、该挂点无轮、不新增物理规则', () => {
    const base = defaultPlayerDraft();
    grantAll();
    equipChain(base, [
      ['rear', 'smallWheel'],
      ['rear', 'none'],
    ]);
    const raw = JSON.parse(store.getItem(BUILD_KEY) ?? '{}') as Record<string, unknown>;
    expect(raw['rearWheelDefId'], "`none` 仍然如实写 `'none'`").toBe('none');

    const f = radiusFaces('rear');
    // `none` ⇒ 该槽不进 Snapshot（`buildSnapshotFromDraft` 过滤 EMPTY_SLOT）⇒ 没有 runtime 半径
    expect(f.runtimeRadius, '`none` 的槽不应出现在 Snapshot 里').toBeNull();
    expect(f.previewRadius, '`none` 的槽不画轮子').toBeNull();
    expect(f.garageDefId, '`none` ⇒ 该挂点无生效 Movement').toBeNull();
  });

  it('RD-04c `defaultMovementRadius()` 的 defId 与 `defaultMovementDefId()` 一致（同一推导路径）', () => {
    const d = defaultMovementRadius();
    expect(d.defId).toBe(defaultMovementDefId());
    expect(d.radius).toBe(canonicalRadius(d.defId));
    expect(d.radius).toBeGreaterThan(0);
  });
});

// ============================================================================
describe('P0-RADIUS-SOURCE-OF-TRUTH｜E. 不动旧档兼容 / 不动战斗面（禁止清单）', () => {
  it('RD-05 `buildSnapshot` 的 override 合并规则**一字未动**：旧档的 radius override 仍然生效', () => {
    // 直接构造一份带陈旧 override 的 draft（模拟旧档），确认 override 仍然被消费
    const draft = { ...defaultPlayerDraft(), rearRadius: 33 } as BuildDraft;
    const resolved = resolveSnapshot(buildSnapshotFromDraft(draft, registry), registry);
    const mv = resolved.movements.find((m) => m.install.hardpointId === 'rear');
    expect(mv, 'rear 应解析出来').toBeTruthy();
    expect(mv?.def.radius, 'override 必须仍然被应用（旧档兼容架构不许被本 Queue 推翻）').toBe(33);
    // 而 canonical 读数**不受** override 影响（两个读数各司其职）
    expect(effectiveMovementRadius(draft, 'rear')?.radius).toBe(canonicalRadius(defaultMovementDefId()));
  });

  it('RD-06 canonical Movement 参数逐件不变（本 Queue 不碰任何 radius/mass/energy 数值）', () => {
    for (const m of canonicalMovements()) {
      const def = registry.movements.get(m.defId);
      expect(def, `${m.defId} 应在 registry 里`).toBeTruthy();
      expect(m.radius, `${m.defId}.radius`).toBe(def?.radius);
      expect(m.mass, `${m.defId}.mass`).toBe(def?.mass);
      expect(m.energy, `${m.defId}.energy`).toBe(def?.energy);
    }
    // 集合没有增删（不新增 Movement）
    expect(canonicalMovements().map((m) => m.defId).sort()).toEqual(
      [...registry.movements.keys()].sort(),
    );
  });

  it('RD-07 源码守卫：产品层不引用 Battle / Camera / Physics 实现（冻结面零扩权）', () => {
    const src = strip(readProduct('playerLoadout.ts'));
    for (const banned of [
      '../battle/',
      '../physics/',
      '../render/',
      'Camera',
      'contactRouter',
      'planck',
    ]) {
      expect(src.includes(banned), `playerLoadout.ts 不得引用 ${banned}`).toBe(false);
    }
    // 本 Queue 的修复必须落在**写入口**，不能靠读取侧补偿
    expect(src, '缺省轮分支必须写回 radius').toContain('next.rearRadius = defaultRadius');
    expect(src).toContain('next.frontRadius = defaultRadius');
    expect(src, '半径真源必须是 canonical 读数，不是字面量').toContain('defaultMovementRadius()');
  });

  it('RD-08 源码守卫：写入口**不**自己写 radius 字面量（真源仍是 registry）', () => {
    const src = strip(readProduct('playerLoadout.ts'));
    // 找 `next.rearRadius = <expr>` / `next.frontRadius = <expr>`
    const assigns = [...src.matchAll(/next\.(?:rear|front)Radius\s*=\s*([^;]+);/g)].map((m) =>
      m[1].trim(),
    );
    expect(
      assigns.length,
      '应恰好有两处 radius 赋值（rear / front 各一处的缺省轮复位）',
    ).toBeGreaterThanOrEqual(2);
    for (const rhs of assigns) {
      /*
        ⚠️ 判据必须能真的抓住「裸数字」，否则这条守卫只是装饰。
        写法演进（本 Queue 自己踩过）：`Number.isFinite(Number(rhs))` 对**变量名**
        恒为 NaN ⇒ 恒 false ⇒ 断言永远通过（空转）。
        正确判据 = 「右侧不得由数字字面量**开头**」：
          `20`        → 命中（裸数字）✅ 抓得住
          `defaultRadius` → 不命中 ✅ 放行
          `canonical.radius` → 不命中 ✅ 放行
        同时显式排除**字面量出现在表达式里**的形态（如 `20 * 1`、`0 + x`）。
      */
      expect(/^\d/.test(rhs), `radius 赋值不得以数字字面量开头（裸数字）：${rhs}`).toBe(false);
      // 更严一层：整段右侧里不得出现「纯数字」这个 token（如 `= 20`、`= 12 + 0`）
      const numericTokens = rhs.match(/(?<![\w.$])\d+(?:\.\d+)?(?![\w.])/g) ?? [];
      expect(numericTokens, `radius 赋值里不得出现数字字面量：${rhs} → ${numericTokens.join(',')}`).toEqual([]);
    }
    // canonical 读数模块本身也不许写死轮径
    const canon = strip(readProduct('runMovementCanonical.ts'));
    expect(canon.includes('defaultMovementRadius'), '缺省轮半径读数应在 canonical 模块里').toBe(true);

    /*
      ⚠️ 只查 `next.*Radius = ...` 的右侧**不够** —— 负控制实测暴露了这个缺口：
      把真源换成 `const defaultRadius = 20;`（裸数字放在中间变量里）时，
      上面那条正则完全看不见（右侧是标识符 `defaultRadius`）。
      ⇒ 补一层「**缺省轮半径这个量**，从定义到使用，全程不得出现数字字面量」：
        抓 `defaultRadius` 的**声明行**，其右侧同样不许有数字。
    */
    const decls = [...src.matchAll(/const\s+defaultRadius\s*=\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(decls.length, '应有 `defaultRadius` 的声明（缺省轮半径的唯一中间量）').toBeGreaterThanOrEqual(1);
    for (const rhs of decls) {
      const numericTokens = rhs.match(/(?<![\w.$])\d+(?:\.\d+)?(?![\w.])/g) ?? [];
      expect(
        numericTokens,
        `缺省轮半径的来源不得是数字字面量：${rhs} → ${numericTokens.join(',')}`,
      ).toEqual([]);
    }
  });

  it('RD-09 `defaultMovementRadius` 是纯读数：不改 draft / 不写存档', () => {
    const draft = defaultPlayerDraft();
    const snapshotOfDraft = JSON.stringify(draft);
    const storeBefore = JSON.stringify([...Array(store.length)].map((_, i) => store.key(i)));
    const d1 = defaultMovementRadius();
    const d2 = defaultMovementRadius();
    expect(d1).toEqual(d2);
    expect(JSON.stringify(draft), '不得改 draft').toBe(snapshotOfDraft);
    expect(
      JSON.stringify([...Array(store.length)].map((_, i) => store.key(i))),
      '不得新增任何 storage key',
    ).toBe(storeBefore);
  });

  it('RD-10 三方一致性总闸：`movementMapping` 的 effectiveDefId === Snapshot defId === Preview defId', () => {
    const base = defaultPlayerDraft();
    grantAll();
    const draft = equipChain(base, [
      ['rear', 'largeWheel'],
      ['front', 'smallWheel'],
      ['rear', defaultMovementDefId()],
    ]);
    const mapping = movementMapping(draft);
    const resolved = resolveSnapshot(buildSnapshotFromDraft(draft, registry), registry);
    const layout = vehiclePreviewLayout(draft);
    for (const hp of ['rear', 'front'] as const) {
      const slotDef = mapping.slots.find((s) => s.hardpointId === hp)?.effectiveDefId ?? null;
      const snapDef = resolved.movements.find((m) => m.install.hardpointId === hp)?.install.defId ?? null;
      const prevDef = layout.items.find((i) => i.key === `wheel:${hp}`)?.defId ?? null;
      expect(slotDef, `${hp} mapping`).toBe(snapDef);
      expect(prevDef, `${hp} preview`).toBe(snapDef);
    }
  });
});
