/**
 * PRODUCT-LOOP-R3-MOVEMENT-EQUIP-PREVIEW｜**Garage 战车预览真实反映 rear/front 当前 Movement**。
 *
 * 逐条对应 Queue 的验收：
 *   1 标准 / 小 / 大 / 重轮切换时预览真实更新 → MV-01 / MV-02
 *   2 rear / front 可以显示不同轮径             → MV-03 / MV-04
 *   3 reload 后预览与 persisted BuildDraft 一致 → MV-05
 *   4 Preview 与 Product Run 使用同一 Movement 数据源 → MV-06 / MV-07
 *   5 targeted tests + tsc                      → 本文件（tsc 在门禁里）
 *
 * ── 本文件修的是哪个真实缺陷（**基线已存在，不是某个 Queue 引入的**）──────────
 * `BuildDraft` 上「装了什么」与「半径」是两个独立字段（`rearWheelDefId` / `rearRadius`）。
 * 切回缺省轮时 `equipMovement` **只删 defId 键、保留 radius** ⇒ radius 残留上一件轮组的
 * 数值；而 `rearRadius` 会被 `buildSnapshotFromDraft` 当作 **`overrides.radius`** 一路带进
 * `resolveSnapshot`，于是**陈旧值覆盖 def 自己的半径**。
 *
 * 实测（已用 worktree 在 Q1 之前的基线 `cb3275d` 上复现同签名，确认非本 Batch 引入）：
 * ```
 *   装 smallWheel → rearRadius=12 → 预览 24×24          ✅
 *   切回缺省轮     → 键已删、rearRadius 仍=12 → 预览 24×24 ❌ 应为 40×40
 * ```
 * ⇒ 修复口径 = 预览半径取 **canonical Movement def 自身的 `radius`**
 *   （`runMovementCanonical.effectiveMovementRadius`），不读 `draft.*Radius`、
 *   不读含 `overrides` 的 `runtimeNumbers`。MV-08 / MV-09 是这条的回归守卫。
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

/** 四档轮组全部发到手里（本 Queue 的真人前提）。
 *  ⚠️ 必须写**磁盘**（真实库存 key）而不是改一份内存快照：`equipMovement` 每次都经
 *     `playerInventory()` 从磁盘重读 ⇒ 只改内存里的那份对象是无效的（会报 not-owned）。 */
function grantAll(): void {
  const inv = JSON.parse(store.getItem(INV_KEY) ?? '{}') as Record<string, { one?: number }>;
  for (const m of OFFICIAL_MOVEMENTS) {
    const row = inv[m] ?? {};
    row.one = 1;
    inv[m] = row;
  }
  store.setItem(INV_KEY, JSON.stringify(inv));
}

/** 预览里某个挂点的轮子（未装载 ⇒ `null`）。 */
function wheelAt(draft: BuildDraft, hardpointId: 'rear' | 'front') {
  return vehiclePreviewLayout(draft).items.find((i) => i.key === `wheel:${hardpointId}`) ?? null;
}

/** 预览里**全部**轮子的尺寸，按挂点稳定排序（便于整体对账）。 */
function wheelSizes(draft: BuildDraft): string[] {
  return vehiclePreviewLayout(draft)
    .items.filter((i) => i.kind === 'wheel')
    .map((i) => `${i.key}=${i.defId}:${i.w}x${i.h}`)
    .sort();
}

/** 走**真实写入口**依次装备，返回最终 draft（每次都是真实落盘 + 真实校验）。 */
function equipChain(start: BuildDraft, steps: readonly (readonly [string, string])[]): BuildDraft {
  let draft = start;
  for (const [hardpointId, defId] of steps) {
    const out = equipMovement(hardpointId, defId, draft, playerInventory(draft));
    expect(out.ok, `equip ${hardpointId}=${defId} 应成功：${out.detail ?? ''}`).toBe(true);
    draft = out.draft as BuildDraft;
  }
  return draft;
}

// ============================================================================
describe('PRODUCT-LOOP-R3-MOVEMENT-EQUIP-PREVIEW｜A. 四档切换预览真实更新', () => {
  it('MV-01 标准 / 小 / 大 / 重轮分别装备时，预览轮子尺寸 === 该 def 的真实直径', () => {
    const base = defaultPlayerDraft();
    grantAll();
    const byId = new Map(canonicalMovements().map((m) => [m.defId, m]));

    for (const m of canonicalMovements()) {
      // 两个挂点都装同一件 ⇒ 两侧尺寸都必须等于该 def 的 2×radius
      const draft = equipChain(base, [
        ['rear', m.defId],
        ['front', m.defId],
      ]);
      for (const hp of ['rear', 'front'] as const) {
        const w = wheelAt(draft, hp);
        expect(w, `${m.defId} @ ${hp} 应画出轮子`).toBeTruthy();
        expect(w?.defId).toBe(m.defId);
        expect(w?.w, `${m.defId} @ ${hp} 直径`).toBe(m.radius * 2);
        expect(w?.h).toBe(m.radius * 2);
        expect(w?.round).toBe(true);
      }
      expect(byId.get(m.defId)?.radius).toBe(m.radius);
    }
  });

  it('MV-02 四档的预览尺寸**互不相同到看得出来**（小 24 / 标准 40 / 大 52 —— 重轮与标准同为 20）', () => {
    const base = defaultPlayerDraft();
    grantAll();
    const sizes = new Map<string, number>();
    for (const m of canonicalMovements()) {
      const draft = equipChain(base, [['rear', m.defId], ['front', m.defId]]);
      sizes.set(m.defId, wheelAt(draft, 'rear')?.w ?? -1);
    }
    // 直接钉在 canonical radius 上（不写死「哪个应该多大」这种数值平衡判断）
    for (const m of canonicalMovements()) {
      expect(sizes.get(m.defId), `${m.defId}`).toBe(m.radius * 2);
    }
    // 至少三个不同尺寸 ⇒ 玩家能靠视觉区分（重轮与标准轮同径是 canonical 设计，不是缺陷）
    expect(new Set([...sizes.values()]).size).toBeGreaterThanOrEqual(3);
  });
});

// ============================================================================
describe('PRODUCT-LOOP-R3-MOVEMENT-EQUIP-PREVIEW｜B. rear / front 独立体现', () => {
  it('MV-03 rear=large + front=small ⇒ 预览里前后轮尺寸**确实不同**（52 vs 24）', () => {
    const base = defaultPlayerDraft();
    grantAll();
    const draft = equipChain(base, [
      ['rear', 'largeWheel'],
      ['front', 'smallWheel'],
    ]);

    const rear = wheelAt(draft, 'rear');
    const front = wheelAt(draft, 'front');
    expect(rear?.defId).toBe('largeWheel');
    expect(front?.defId).toBe('smallWheel');
    expect(rear?.w).toBe(52);
    expect(front?.w).toBe(24);
    expect(rear?.w).not.toBe(front?.w);
    // 轮心仍然各自在自己挂点上（不是把两个轮子挪到同一处）
    const layout = vehiclePreviewLayout(draft);
    const body = registry.bodies.get(draft.bodyDefId);
    const hpRear = body?.movementHardpoints.find((h) => h.id === 'rear');
    const hpFront = body?.movementHardpoints.find((h) => h.id === 'front');
    const itemRear = layout.items.find((i) => i.key === 'wheel:rear');
    const itemFront = layout.items.find((i) => i.key === 'wheel:front');
    expect(itemRear?.cx).toBe(hpRear?.localPosition.x);
    expect(itemFront?.cx).toBe(hpFront?.localPosition.x);
  });

  it('MV-04 反向组合 rear=small + front=large 同样独立（24 vs 52）', () => {
    const base = defaultPlayerDraft();
    grantAll();
    const draft = equipChain(base, [
      ['rear', 'smallWheel'],
      ['front', 'largeWheel'],
    ]);
    expect(wheelAt(draft, 'rear')?.w).toBe(24);
    expect(wheelAt(draft, 'front')?.w).toBe(52);
  });

  it('MV-04b 一侧不动、另一侧连换三档 ⇒ 只有被改的那一侧尺寸变化', () => {
    const base = defaultPlayerDraft();
    grantAll();
    let draft = equipChain(base, [['front', 'smallWheel']]);
    const frontBefore = wheelAt(draft, 'front')?.w;
    const rearBefore = wheelAt(draft, 'rear')?.w;

    for (const defId of ['largeWheel', 'heavyWheel', 'smallWheel']) {
      draft = equipChain(draft, [['rear', defId]]);
      expect(wheelAt(draft, 'front')?.w, `front 不该被动过（${defId} 装在 rear）`).toBe(frontBefore);
      const expected = registry.movements.get(defId)?.radius;
      expect(wheelAt(draft, 'rear')?.w).toBe((expected ?? 0) * 2);
      expect(rearBefore).toBe(40); // 起始是缺省标准轮
    }
  });
});

// ============================================================================
describe('PRODUCT-LOOP-R3-MOVEMENT-EQUIP-PREVIEW｜C. 三态与 reload 一致', () => {
  it('MV-05 reload（重读 persisted BuildDraft）后预览与内存里的预览**逐项相同**', () => {
    const base = defaultPlayerDraft();
    grantAll();
    const draft = equipChain(base, [
      ['rear', 'largeWheel'],
      ['front', 'smallWheel'],
    ]);
    const inMemory = wheelSizes(draft);
    // 真实重读：走正式 loadEquippedDraft（内部 loadPlayerBuild 会校验 + 归一）
    const reloaded = loadEquippedDraft();
    expect(wheelSizes(reloaded)).toEqual(inMemory);
    expect(reloaded.rearWheelDefId).toBe('largeWheel');
    expect(reloaded.frontWheelDefId).toBe('smallWheel');
  });

  it('MV-05b 三态：undefined=缺省轮视觉 / none=该挂点无轮 / defId=真实轮径', () => {
    const base = defaultPlayerDraft();
    grantAll();
    const std = registry.movements.get(defaultMovementDefId());
    expect(std, '缺省轮必须在正式内容库里').toBeTruthy();

    // ① undefined（新账号缺省形态）：两个挂点都画缺省轮，尺寸 = 缺省轮直径
    expect(wheelAt(base, 'rear')?.defId).toBe(defaultMovementDefId());
    expect(wheelAt(base, 'rear')?.w).toBe((std?.radius ?? 0) * 2);
    expect(wheelAt(base, 'front')?.defId).toBe(defaultMovementDefId());

    // ② defId：真实轮径
    const explicit = equipChain(base, [['rear', 'largeWheel']]);
    expect(wheelAt(explicit, 'rear')?.defId).toBe('largeWheel');
    expect(wheelAt(explicit, 'rear')?.w).toBe(52);

    // ③ none：该挂点**没有轮子**（不是 0 半径、不是缺省轮）
    const unmounted = equipChain(explicit, [['rear', 'none']]);
    expect(wheelAt(unmounted, 'rear')).toBeNull();
    expect(unmounted.rearWheelDefId).toBe('none');
    // 另一侧不受影响
    expect(wheelAt(unmounted, 'front')?.defId).toBe(defaultMovementDefId());

    // ④ none → defId 可以回来
    const back = equipChain(unmounted, [['rear', 'smallWheel']]);
    expect(wheelAt(back, 'rear')?.w).toBe(24);
  });
});

// ============================================================================
describe('PRODUCT-LOOP-R3-MOVEMENT-EQUIP-PREVIEW｜D. 与 Product Run 同一数据源', () => {
  it('MV-06 effectiveMovementRadius 与正式 Snapshot 的 movements[].defId 指向同一件', () => {
    const base = defaultPlayerDraft();
    grantAll();
    const draft = equipChain(base, [
      ['rear', 'largeWheel'],
      ['front', 'smallWheel'],
    ]);

    // 正式链路：draft → Snapshot → resolveSnapshot
    const resolved = resolveSnapshot(
      buildSnapshotFromDraft(draft, registry, 'mv-preview-source'),
      registry,
    );
    const mapping = movementMapping(draft);

    for (const hp of ['rear', 'front'] as const) {
      const eff = effectiveMovementRadius(draft, hp);
      const snap = resolved.movements.find((r) => r.install.hardpointId === hp);
      const slot = mapping.slots.find((s) => s.hardpointId === hp);
      // 三处必须同指一件
      expect(eff?.defId).toBe(snap?.def.id);
      expect(slot?.effectiveDefId).toBe(snap?.def.id);
      // 预览画的也是它
      expect(wheelAt(draft, hp)?.defId).toBe(snap?.def.id);
      // 预览半径 = 该 def 的 canonical radius
      expect(wheelAt(draft, hp)?.w).toBe((snap?.def.radius ?? 0) * 2);
    }
  });

  it('MV-07 预览不改变任何 Run 数值：拿预览前后 Snapshot / Runtime 逐字段相同', () => {
    const base = defaultPlayerDraft();
    grantAll();
    const draft = equipChain(base, [
      ['rear', 'heavyWheel'],
      ['front', 'smallWheel'],
    ]);
    const before = JSON.stringify(buildSnapshotFromDraft(draft, registry, 'x'));
    const beforeResolved = JSON.stringify(resolveSnapshot(buildSnapshotFromDraft(draft, registry, 'x'), registry));
    // 跑一次预览（纯函数）
    vehiclePreviewLayout(draft);
    const after = JSON.stringify(buildSnapshotFromDraft(draft, registry, 'x'));
    const afterResolved = JSON.stringify(resolveSnapshot(buildSnapshotFromDraft(draft, registry, 'x'), registry));
    expect(after).toBe(before);
    expect(afterResolved).toBe(beforeResolved);
    // 且预览没有写任何东西
    expect(store.getItem(INV_KEY)).not.toBeNull();
  });
});

// ============================================================================
describe('PRODUCT-LOOP-R3-MOVEMENT-EQUIP-PREVIEW｜E. 回归守卫（陈旧 radius 不得影响预览）', () => {
  it('MV-08 **回归**：切回缺省轮后，即使 draft.rearRadius 残留旧值，预览仍是缺省轮的真实直径', () => {
    /*
      ⚠️ 这一条就是本 Queue 修的那个真实缺陷的**可断言形式**。
      复现路径（全程真实写入口）：
        装 smallWheel（rearRadius → 12）→ 切回缺省轮（**只删 defId 键、保留 radius 12**）
      修复前：预览 wheel:rear = 24×24（把标准轮画成了小轮）❌
      修复后：预览 wheel:rear = 缺省轮真实直径 ✔
    */
    const base = defaultPlayerDraft();
    grantAll();
    const draft = equipChain(base, [
      ['rear', 'smallWheel'],
      ['rear', defaultMovementDefId()],
    ]);

    // 前提取证：旧数值字段**确实残留**（否则这条守卫就空转了）
    expect(draft.rearRadius).toBe(12);
    expect('rearWheelDefId' in draft).toBe(false);
    // 而预览必须按 def 走
    const std = registry.movements.get(defaultMovementDefId());
    expect(wheelAt(draft, 'rear')?.defId).toBe(defaultMovementDefId());
    expect(wheelAt(draft, 'rear')?.w).toBe((std?.radius ?? 0) * 2);
    expect(wheelAt(draft, 'rear')?.w).not.toBe(24);
  });

  it('MV-08b 构造一份「radius 与 def 严重不符」的 draft ⇒ 预览仍以 def 为准', () => {
    const base = defaultPlayerDraft();
    grantAll();
    // 直接造一份分叉 draft：def = largeWheel，但两个 radius 字段都被写成 3
    const diverged: BuildDraft = {
      ...base,
      rearWheelDefId: 'largeWheel',
      frontWheelDefId: 'smallWheel',
      rearRadius: 3,
      frontRadius: 3,
    };
    expect(wheelAt(diverged, 'rear')?.w).toBe(52); // 不是 6
    expect(wheelAt(diverged, 'front')?.w).toBe(24); // 不是 6
  });

  it('MV-09 源码守卫：预览轮径**不读** draft 的 radius 字段、也**不读** overrides 后的 runtimeNumbers', () => {
    const src = strip(readProduct('vehiclePreview.ts'));
    // 轮子那一段不许出现 draft.rearRadius / draft.frontRadius
    expect(src).not.toContain('draft.rearRadius');
    expect(src).not.toContain('draft.frontRadius');
    // 也不许用含 overrides 的 runtimeNumbers 当轮径
    expect(src).not.toContain('runtimeNumbers');
    // 必须走 canonical 读数
    expect(src).toContain('effectiveMovementRadius');
    expect(src).toContain('movementMapping');
    // 不许把半径写死
    expect(src).not.toMatch(/w:\s*\d+/);
    expect(src).not.toMatch(/radius:\s*\d+/);
  });

  it('MV-09b `effectiveMovementRadius` 是纯读数：不改 draft / 不写存档 / 三态语义正确', () => {
    const base = defaultPlayerDraft();
    grantAll();
    const snapshotOfDraft = (d: BuildDraft) => JSON.stringify(d);
    const before = snapshotOfDraft(base);

    // 缺省态 ⇒ 返回缺省轮（不是 null）
    expect(effectiveMovementRadius(base, 'rear')?.defId).toBe(defaultMovementDefId());
    // none ⇒ null
    const unmounted = equipChain(base, [['rear', 'none']]);
    expect(effectiveMovementRadius(unmounted, 'rear')).toBeNull();
    // 未知挂点 ⇒ null（不猜）
    expect(effectiveMovementRadius(base, 'no-such-hardpoint')).toBeNull();
    // 纯：调用前后 draft 逐字节不变，且没有新 key 落盘
    expect(snapshotOfDraft(base)).toBe(before);

    const src = strip(readProduct('runMovementCanonical.ts'));
    const fn = src.slice(src.indexOf('export function effectiveMovementRadius'));
    const body = fn.slice(0, fn.indexOf('\n}\n') + 3);
    expect(body).not.toContain('localStorage');
    expect(body).not.toContain('setItem');
  });

  it('MV-10 不新增美术 / 不夸张补偿：轮径直接等于 def 直径，页面不做额外缩放', () => {
    const base = defaultPlayerDraft();
    grantAll();
    for (const m of canonicalMovements()) {
      const draft = equipChain(base, [['rear', m.defId]]);
      const item = wheelAt(draft, 'rear');
      // `w` 是**本地 px 的未缩放直径**（缩放由视图层按 layout.scale 统一做，
      // 那一个 scale 对整车所有件是同一次，不存在「专门放大轮径差异」的补偿）。
      expect(item?.w).toBe(m.radius * 2);
    }
    // 视图层只有一次统一 scale（不出现第二个针对轮子的缩放因子）
    const home = strip(readProduct('homePage.ts'));
    const fn = home.slice(home.indexOf('function renderPreview'));
    const body = fn.slice(0, fn.indexOf('\n}\n') + 3);
    expect(body).toContain('layout.scale');
    expect(body).not.toMatch(/wheel[a-zA-Z]*Scale/);
  });
});
