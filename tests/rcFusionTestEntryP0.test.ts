/**
 * Queue F-RC-FUSION-TEST-ENTRY-P0（F-GARAGE-FUSION-UX-R2 适配版）｜
 * RC 包「真实 5→1」验收可达性（targeted，T1-T16）。
 *
 * 目标：RC 包能通过真实 UI 按钮验证 5合1；并恢复「全部件×1」按钮身份（§二→§七）。
 * 本 Queue 下测试材料按钮已从「满星选卡面板」改为「背包页顶右上角落 + 按当前分类补足可用 1★ ≥5」；
 * 正式合成已从「同 defId」改为「同分类混合 5→1（可注入 rng）」。测试相应适配（冻结项不变）。
 *
 * 验证双轨：
 * - 源码守卫（string 断言）：门控/文案/公式与实现一致、普通微信包不暴露入口；
 * - 逻辑（真实 partInventory 函数）：复算 topUp / fuse 闭环，断言数据正确与幂等。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  getCount,
  addPart,
  getInventory,
  equippedCount,
  OFFICIAL_PARTS,
  fusionCategoryAvailable,
  fusionCategoryPartIds,
  canFuseCategory,
  autoPickFusionMaterials,
  fuseCategoryMaterials,
  type PartInventory,
} from '../src/core/partInventory';
import { grantAllPartsOnce } from '../src/core/debugGrants';
import { bindPlatformCore } from '../src/platform/context';
import { createWebCore } from '../src/platform/web';
import type { BuildDraft } from '../src/lab/buildEditorModel';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const UI_SRC = readFileSync(resolve(__dirname, '../src/ui/canvasPlayerUIHost.ts'), 'utf8');
const CHECK = resolve(__dirname, '../scripts/check-wechat-bundle-clean.js');
const NODE = process.execPath;

/** 内存 storage 桩（WebStorage 无 localStorage 环境静默降级 → 需桩测持久化） */
function bindMemStorage(): { mem: Map<string, string> } {
  const mem = new Map<string, string>();
  bindPlatformCore({
    ...createWebCore(),
    storage: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        mem.set(k, v);
      },
      removeItem: (k: string) => {
        mem.delete(k);
      },
    },
  } as unknown as Parameters<typeof bindPlatformCore>[0]);
  return { mem };
}

/** F-GARAGE-FUSION-UX-R2｜§七：复算「测试材料×5」补足公式（与 dispatch 内联逻辑同源）——
 *  把「当前分类」可用 1★ 总数补到 ≥5；缺口加到可用数最多（次则 defId 序）的那件。 */
function topUpCategory(inv: PartInventory, cat: 'combat' | 'movement', draft: BuildDraft | null): number {
  const missing = 5 - fusionCategoryAvailable(inv, cat, draft, 1);
  if (missing <= 0) return 0; // 幂等：已 ≥5 不动作
  const cands = fusionCategoryPartIds(cat)
    .map((defId) => ({
      defId,
      avail: Math.max(0, getCount(inv, defId, 1) - equippedCount(defId, 1, draft)),
    }))
    .sort((a, b) => b.avail - a.avail || (a.defId < b.defId ? -1 : a.defId > b.defId ? 1 : 0));
  if (cands.length === 0) return 0;
  addPart(inv, cands[0].defId, 1, missing);
  return missing;
}

/** 库存归零 + 只设目标部件（其余正式键 0；走 normalize 口径） */
function seed(entries: Record<string, { one?: number; two?: number }>): PartInventory {
  const inv = getInventory();
  for (const k of Object.keys(inv)) {
    inv[k].one = 0;
    inv[k].two = 0;
  }
  for (const [defId, v] of Object.entries(entries)) {
    if (!inv[defId]) inv[defId] = { one: 0, two: 0 };
    inv[defId].one = v.one ?? 0;
    inv[defId].two = v.two ?? 0;
  }
  return inv;
}

/** draft：cannon 装在 frontMass（已装备 1 个 cannon） */
function draftWithCannon(): BuildDraft {
  return {
    bodyDefId: 'boxBody',
    rearRadius: 20,
    frontRadius: 20,
    functionalSelections: { frontMass: 'cannon', rearMass: 'EMPTY_SLOT' },
    functionalStars: { frontMass: 1, rearMass: 1 },
  };
}

/** draft：空（无任何功能件装备） */
function emptyDraft(): BuildDraft {
  return { bodyDefId: 'boxBody', rearRadius: 20, frontRadius: 20, functionalSelections: {} };
}

function runCheck(bundleContent: string, mode: string): { status: number } {
  const dir = mkdtempSync(join(tmpdir(), 'bundle-clean-'));
  const file = join(dir, 'game.js');
  writeFileSync(file, bundleContent, 'utf8');
  const r = spawnSync(NODE, [CHECK, file, mode], { encoding: 'utf8' });
  rmSync(dir, { recursive: true, force: true });
  return { status: r.status ?? -1 };
}

describe('F-RC-FUSION-TEST-ENTRY-P0（R2 适配）｜全部件×1 身份 + 测试材料×5', () => {
  beforeEach(() => bindMemStorage());
  afterEach(() => bindPlatformCore(createWebCore()));

  // ───────────────────────── §二 全部件×1 身份 ─────────────────────────
  it('T1. 未领取时显示「全部件×1」（源码守卫：unclaimed 文案）', () => {
    expect(UI_SRC).toContain("const label = claimed ? '全部件×1 ✓' : '全部件×1';");
    const m = UI_SRC.match(/const label = claimed \? '([^']+)' : '([^']+)';/);
    expect(m).not.toBeNull();
    expect(m![2], '未领取文案 = 全部件×1').toBe('全部件×1');
  });

  it('T2. 领取后显示「全部件×1 ✓」（源码守卫：claimed 文案带 ✓）', () => {
    const m = UI_SRC.match(/const label = claimed \? '([^']+)' : '([^']+)';/);
    expect(m).not.toBeNull();
    expect(m![1], '领取后文案 = 全部件×1 ✓').toBe('全部件×1 ✓');
  });

  it('T3. 重复领取库存不增加（×1 幂等语义不变）', () => {
    grantAllPartsOnce();
    const after1 = getInventory();
    const snap1 = JSON.stringify(after1);
    grantAllPartsOnce(); // 第二次
    const after2 = getInventory();
    expect(JSON.stringify(after2), '二次领取库存不变').toBe(snap1);
  });

  // ───────────────────────── §三 测试材料×5 门控（R2：页顶右上角 + 分类级） ─────────────────────────
  it('T4. 测试材料按钮仅调试/测试构建可见（源码守卫：RC/E2E/DEV 宏 + 背包页顶右上角位置）', () => {
    expect(UI_SRC).toContain("'backpack-test-material'");
    expect(UI_SRC).toContain('const rcGrantTM');
    expect(UI_SRC).toContain('const e2eProbeTM');
    expect(UI_SRC).toContain('const devResetTM');
    // R2 门控 = RC/E2E/DEV 任一 + 非车身分类（旧「满星 ownedTwo===0」面板级门控已随面板删除）
    expect(UI_SRC).toContain('const tmShow = (rcGrantTM || e2eProbeTM || devResetTM) && this.backpackFilter !== \'body\';');
    // 角落按钮：页顶右上（右侧贴边），不占正式核心按钮位
    expect(UI_SRC).toContain("this.button(c.x + c.w - pad - tw, yy, tw, hh, 'backpack-test-material'");
    expect(UI_SRC).toContain("typeof __WX_DEBUG_GRANT__ !== 'undefined' && __WX_DEBUG_GRANT__");
  });

  it('T5. 普通微信包无两个测试入口（源码守卫：两个入口均被调试门控包裹）', () => {
    // 全部件×1 入口：提前 return
    expect(UI_SRC).toContain('if (!(rcGrant || e2eProbe || devReset)) return;');
    // 测试材料×5：仅 tmShow 为真时绘制
    expect(UI_SRC).toContain('if (tmShow) {');
    // 普通微信包：__WX_DEBUG_GRANT__/__E2E_INTERNAL_HANDLE__ 均为 false、DEV_TOOLS_VISIBLE=false
    // → 两个入口都不绘制、不注册命中区 → 无入口。
    expect(UI_SRC).toContain("'全部件×1'");
    expect(UI_SRC).toContain("'测试材料×5'");
  });

  it('T6. 车身分类不显示测试材料按钮（源码守卫：filter!==body 门控 + fusionCategory 车身→null 早退）', () => {
    // tmShow 门控排除车身
    expect(UI_SRC).toContain("this.backpackFilter !== 'body'");
    // dispatch/topUp 链路：车身 → fusionCategory()=null → topUp 早退（无任何入库副作用）
    expect(UI_SRC).toContain('private fusionCategory(): FusionCategory | null');
    expect(UI_SRC).toContain("if (this.backpackFilter === 'combat') return 'combat';");
    expect(UI_SRC).toContain('return null;');
  });

  // ───────────────────────── §三 topUp 逻辑（R2：分类级补足） ─────────────────────────
  it('T7. 分类可用 1 件（未装备）→ 补到 5（缺口 4 加到可用最多者；1★ 可用=5）', () => {
    const inv = seed({ rammer: { one: 1 } });
    const topUp = topUpCategory(inv, 'combat', emptyDraft());
    expect(topUp, 'topUp = 4').toBe(4);
    expect(getCount(inv, 'rammer', 1), 'rammer 拥有 5').toBe(5);
    expect(fusionCategoryAvailable(inv, 'combat', emptyDraft(), 1), '分类可用 = 5').toBe(5);
  });

  it('T8. 已装备 1 个 cannon + 拥有 1 个 → 分类可用 0 → 补 5（总数 6、可用 5、已装备不消耗）', () => {
    const inv = seed({ cannon: { one: 1 } });
    const draft = draftWithCannon();
    expect(equippedCount('cannon', 1, draft), '已装备 1').toBe(1);
    const topUp = topUpCategory(inv, 'combat', draft);
    expect(topUp, 'topUp = 5（分类可用 0 → 需 5）').toBe(5);
    expect(getCount(inv, 'cannon', 1), '总数补到 6').toBe(6);
    expect(fusionCategoryAvailable(inv, 'combat', draft, 1), '分类可用 = 5').toBe(5);
    expect(equippedCount('cannon', 1, draft), '已装备副本未被消耗').toBe(1);
  });

  it('T9. 分类可用已 ≥5 时重复点击不增加（幂等）', () => {
    const inv = seed({ rammer: { one: 5 } });
    expect(topUpCategory(inv, 'combat', emptyDraft()), '已满足 → topUp=0').toBe(0);
    expect(getCount(inv, 'rammer', 1), '拥有保持 5').toBe(5);
    // 已装备 1 + 拥有 6（可用 5）的边界也幂等
    const inv2 = seed({ cannon: { one: 6 } });
    expect(topUpCategory(inv2, 'combat', draftWithCannon()), 'available=5 → topUp=0').toBe(0);
    expect(getCount(inv2, 'cannon', 1), '拥有保持 6').toBe(6);
  });

  it('T10. 缺口只加到「可用最多」的 defId（其它部件不变）', () => {
    const inv = seed({ cannon: { one: 1 }, laser: { one: 3 } }); // 分类可用 4 → 缺 1
    const topUp = topUpCategory(inv, 'combat', emptyDraft());
    expect(topUp, 'topUp = 1').toBe(1);
    expect(getCount(inv, 'laser', 1), '可用最多者 laser +1').toBe(4);
    expect(getCount(inv, 'cannon', 1), 'cannon 不变').toBe(1);
    expect(fusionCategoryAvailable(inv, 'combat', emptyDraft(), 1), '分类可用 = 5').toBe(5);
  });

  it('T11. 补足后正式合成预检通过（canFuseCategory.ok=true）', () => {
    const inv = seed({ rammer: { one: 1 } });
    topUpCategory(inv, 'combat', emptyDraft());
    const fuse = canFuseCategory(inv, 'combat', emptyDraft(), 1);
    expect(fuse.ok, '分类可用 5 → 可合成').toBe(true);
    expect(fuse.available).toBe(5);
  });

  // ───────────────────────── §三/§四 正式合成闭环（R2：分类混合 + rng 注入） ─────────────────────────
  it('T12. 真实 5→1 成功（自动放入恰 5 → 合成：1★ -5 / 2★ +1，产物 ∈ Registry）', () => {
    const inv = seed({ cannon: { one: 3 }, hammer: { one: 3 } });
    const picked = autoPickFusionMaterials(inv, 'combat', emptyDraft(), 1, 5);
    expect(picked.length, '自动放入恰 5').toBe(5);
    const before1 = Object.keys(inv).reduce((s, k) => s + getCount(inv, k, 1), 0);
    const res = fuseCategoryMaterials(inv, picked, 'combat', emptyDraft(), 1, () => 0);
    expect(res, '合成成功').not.toBeNull();
    expect(OFFICIAL_PARTS, '产物 ∈ OFFICIAL_PARTS').toContain(res!.product);
    const after1 = Object.keys(inv).reduce((s, k) => s + getCount(inv, k, 1), 0);
    expect(after1, '1★ 总数 -5').toBe(before1 - 5);
    expect(getCount(inv, res!.product, 2), '产物 2★ +1').toBe(1);
  });

  it('T13. 连点不重复合成（材料不足 → null / 不重复产出）', () => {
    const inv = seed({ cannon: { one: 5 } });
    const res1 = fuseCategoryMaterials(inv, ['cannon', 'cannon', 'cannon', 'cannon', 'cannon'], 'combat', emptyDraft(), 1, () => 0);
    expect(res1, '第一次合成成功').not.toBeNull();
    expect(canFuseCategory(inv, 'combat', emptyDraft(), 1).ok, '二次分类可用 0 → 不可合成').toBe(false);
    const res2 = fuseCategoryMaterials(inv, ['cannon', 'cannon', 'cannon', 'cannon', 'cannon'], 'combat', emptyDraft(), 1, () => 0);
    expect(res2, '第二次合成空操作').toBeNull();
    expect(getCount(inv, res1!.product, 2), '2★ 仍为 1（不重复产出）').toBe(1);
  });

  it('T14. Build / 能量 / 奖励池不变（topUp 与合成不触碰 draft）', () => {
    const inv = seed({ cannon: { one: 1 } });
    const draft = draftWithCannon();
    const draftSnap = JSON.stringify(draft);
    topUpCategory(inv, 'combat', draft);
    expect(JSON.stringify(draft), 'topUp 后 draft 未变').toBe(draftSnap);
    const picked = autoPickFusionMaterials(inv, 'combat', draft, 1, 5);
    fuseCategoryMaterials(inv, picked, 'combat', draft, 1, () => 0.5);
    expect(JSON.stringify(draft), '合成后 draft 未变').toBe(draftSnap);
    expect(equippedCount('cannon', 1, draft), '已装备副本始终保留').toBe(1);
  });

  it('T15. reload 后 2★ 结果保持（saveInventory 落盘 + 重读）', () => {
    const { mem } = bindMemStorage();
    const inv = seed({ cannon: { one: 5 } });
    const res = fuseCategoryMaterials(inv, ['cannon', 'cannon', 'cannon', 'cannon', 'cannon'], 'combat', emptyDraft(), 1, () => 0);
    expect(res, '合成成功').not.toBeNull();
    expect(getCount(inv, res!.product, 2), '当前 2★=1').toBe(1);
    // 模拟 reload：重新 bind 同一 mem（同一 localStorage）→ 重读存档
    bindPlatformCore({
      ...createWebCore(),
      storage: {
        getItem: (k: string) => mem.get(k) ?? null,
        setItem: (k: string, v: string) => {
          mem.set(k, v);
        },
        removeItem: (k: string) => {
          mem.delete(k);
        },
      },
    } as unknown as Parameters<typeof bindPlatformCore>[0]);
    const reloaded = getInventory();
    expect(getCount(reloaded, res!.product, 2), 'reload 后 2★=1 保持').toBe(1);
    expect(getCount(reloaded, 'cannon', 1), 'reload 后 cannon 1★=0').toBe(0);
  });

  it('T16. bundle-clean 确保普通/RC 无内部句柄泄漏（测试材料按钮仅为 UI，无 globalThis 句柄）', () => {
    // 含本 Queue 新增 UI 字符串、但无 globalThis.__* 赋值的合成 bundle → 普通/RC 均 PASS
    const bundle = [
      'const a = 1;',
      "this.button(x, y, w, h, 'backpack-test-material', '测试材料×5', { equipped: true });",
      "this.button(x, y, w, h, 'backpack-fuse', '合成', { primary: true });",
      "this.button(x, y, w, h, 'dev-grant-all', '全部件×1', {});",
      '__WX_DEBUG_GRANT__ = true;',
    ].join('\n');
    expect(runCheck(bundle, 'wechat').status, '普通微信 bundle PASS').toBe(0);
    expect(runCheck(bundle, 'rc').status, 'RC bundle PASS').toBe(0);
    // 回归：既有禁止句柄仍被拦（rc 模式）
    expect(runCheck('globalThis.__h = this;', 'rc').status, '__h 仍禁止').toBe(1);
    expect(runCheck('globalThis.__inv = {};', 'rc').status, '__inv 仍禁止（rc）').toBe(1);
    // E2E 专用句柄仍放行（不破既有 allowlist）
    expect(runCheck('globalThis.__inv = {};', 'e2e').status, '__inv 放行（e2e）').toBe(0);
  });

  it('回归守卫：dispatch 内 topUp 公式与源码一致（分类级补足 + 幂等早退）', () => {
    expect(UI_SRC).toContain('const missing = 5 - fusionCategoryAvailable(inv, cat, draft, 1);');
    expect(UI_SRC).toContain('if (missing <= 0) return;');
    expect(UI_SRC).toContain('const cands = fusionCategoryPartIds(cat)');
    expect(UI_SRC).toContain('addPart(inv, cands[0].defId, 1, missing);');
    expect(UI_SRC).toContain('saveInventory(inv);');
  });
});
