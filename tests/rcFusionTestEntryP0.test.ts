/**
 * Queue F-RC-FUSION-TEST-ENTRY-P0｜RC 包「真实 5→1」验收可达性修复（targeted，T1-T16）。
 *
 * 目标：解决 RC 包无法验证真实 5合1 的问题，并恢复「全部件×1」按钮身份（§二→§七）。
 * 仅改 RC 测试工具/UI 入口，不碰正式经济与合成规则（冻结项）。
 *
 * 验证双轨：
 * - 源码守卫（string 断言）：保证门控/文案/公式与实现一致、普通微信包不暴露入口；
 * - 逻辑（真实 partInventory 函数）：复算 topUp / fuse 闭环，断言数据正确与幂等。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  getCount,
  addPart,
  getInventory,
  canFuse,
  equippedCount,
  fuseSameStar,
  buildRewardCandidates,
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

/** F-RC-FUSION-TEST-ENTRY-P0｜§三：复算「测试材料×5」补足公式（与 dispatch 内联逻辑同源）。 */
function topUpToFive(inv: PartInventory, defId: string, draft: BuildDraft | null): number {
  const eq = equippedCount(defId, 1, draft);
  const owned = getCount(inv, defId, 1);
  const requiredOwned = eq + 5;
  const topUp = Math.max(0, requiredOwned - owned);
  if (topUp > 0) addPart(inv, defId, 1, topUp);
  return topUp;
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

describe('F-RC-FUSION-TEST-ENTRY-P0｜全部件×1 身份 + 测试材料×5', () => {
  beforeEach(() => bindMemStorage());
  afterEach(() => bindPlatformCore(createWebCore()));

  // ───────────────────────── §二 全部件×1 身份 ─────────────────────────
  it('T1. 未领取时显示「全部件×1」（源码守卫：unclaimed 文案）', () => {
    expect(UI_SRC).toContain("const label = claimed ? '全部件×1 ✓' : '全部件×1';");
    // 未领取分支文案精确为「全部件×1」
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

  // ───────────────────────── §三 测试材料×5 门控 ─────────────────────────
  it('T4. 测试材料按钮仅调试/测试构建可见（源码守卫：含 __WX_DEBUG_GRANT__ 门控）', () => {
    expect(UI_SRC).toContain("'backpack-test-material'");
    expect(UI_SRC).toContain('const rcGrantTM');
    expect(UI_SRC).toContain('const e2eProbeTM');
    expect(UI_SRC).toContain('const devResetTM');
    expect(UI_SRC).toContain('const showTestMaterial = (rcGrantTM || e2eProbeTM || devResetTM) && ownedTwo === 0;');
    // 门控确实引用 RC 宏（普通微信包 __WX_DEBUG_GRANT__=false → 不绘制）
    expect(UI_SRC).toContain('typeof __WX_DEBUG_GRANT__ !== \'undefined\' && __WX_DEBUG_GRANT__');
  });

  it('T5. 普通微信包无两个测试入口（源码守卫：两个入口均被调试门控包裹）', () => {
    // 全部件×1 入口：提前 return
    expect(UI_SRC).toContain('if (!(rcGrant || e2eProbe || devReset)) return;');
    // 测试材料×5：仅 showTestMaterial 为真时绘制
    expect(UI_SRC).toContain('if (showTestMaterial) {');
    // 普通微信包：__WX_DEBUG_GRANT__/__E2E_INTERNAL_HANDLE__ 均为 false、DEV_TOOLS_VISIBLE=false
    // → 两个入口都不绘制、不注册命中区 → 无入口。
    expect(UI_SRC).toContain("'全部件×1'");
    expect(UI_SRC).toContain("'测试材料×5'");
  });

  it('T6. Body / 满星不显示测试材料按钮（源码守卫：车身 early-return + 满星 ownedTwo===0 门控）', () => {
    // 车身：drawBackpackFusePanel 早于测试材料按钮已 early-return
    expect(UI_SRC).toContain('if (OFFICIAL_BODIES.includes(defId)) {');
    // 满星：门控要求 ownedTwo === 0（有 2★ 副本则不显示）
    expect(UI_SRC).toContain('const showTestMaterial = (rcGrantTM || e2eProbeTM || devResetTM) && ownedTwo === 0;');
    // dispatch 也排除车身
    expect(UI_SRC).toContain("if (defId && !OFFICIAL_BODIES.includes(defId) && this.lastState) {");
  });

  // ───────────────────────── §三 topUp 逻辑 ─────────────────────────
  it('T7. 未装备且拥有 1 个 → 补到 5 个（1★ 可用=5）', () => {
    const inv = getInventory();
    inv.rammer = { one: 1, two: 0 }; // 冲锤：未装备、拥有 1
    const topUp = topUpToFive(inv, 'rammer', emptyDraft());
    expect(topUp, 'topUp = 4').toBe(4);
    expect(getCount(inv, 'rammer', 1), '拥有补到 5').toBe(5);
    expect(getCount(inv, 'rammer', 1) - equippedCount('rammer', 1, emptyDraft()), '可用 = 5').toBe(5);
  });

  it('T8. 已装备 1 个且拥有 1 个 → 总数 6、可用 5、已装备不消耗', () => {
    const inv = getInventory();
    inv.cannon = { one: 1, two: 0 }; // cannon：拥有 1，且装在 frontMass（已装备 1）
    const draft = draftWithCannon();
    expect(equippedCount('cannon', 1, draft), '已装备 1').toBe(1);
    const topUp = topUpToFive(inv, 'cannon', draft);
    expect(topUp, 'topUp = 5（requiredOwned=6, owned=1）').toBe(5);
    expect(getCount(inv, 'cannon', 1), '总数补到 6').toBe(6);
    expect(getCount(inv, 'cannon', 1) - equippedCount('cannon', 1, draft), '可用 = 5').toBe(5);
    expect(equippedCount('cannon', 1, draft), '已装备副本未被消耗').toBe(1);
  });

  it('T9. 已有可用 5 个时重复点击不增加（幂等）', () => {
    const inv = getInventory();
    inv.rammer = { one: 5, two: 0 }; // 可用 5
    const topUp = topUpToFive(inv, 'rammer', emptyDraft());
    expect(topUp, '已满足 5 可用 → topUp=0').toBe(0);
    expect(getCount(inv, 'rammer', 1), '拥有保持 5').toBe(5);
    // 已装备 1 + 拥有 6（可用 5）的边界也幂等
    const inv2 = getInventory();
    inv2.cannon = { one: 6, two: 0 };
    const topUp2 = topUpToFive(inv2, 'cannon', draftWithCannon());
    expect(topUp2, 'available=5 → topUp=0').toBe(0);
    expect(getCount(inv2, 'cannon', 1), '拥有保持 6').toBe(6);
  });

  it('T10. 只影响当前选中 defId（其它部件不变）', () => {
    const inv = getInventory();
    inv.rammer = { one: 1, two: 0 };
    inv.cannon = { one: 1, two: 0 };
    inv.laser = { one: 3, two: 0 };
    topUpToFive(inv, 'rammer', emptyDraft());
    expect(getCount(inv, 'rammer', 1), 'rammer 补到 5').toBe(5);
    expect(getCount(inv, 'cannon', 1), 'cannon 不变').toBe(1);
    expect(getCount(inv, 'laser', 1), 'laser 不变').toBe(3);
  });

  it('T11. 补足后正式合成按钮出现（canFuse.ok=true）', () => {
    const inv = getInventory();
    inv.rammer = { one: 1, two: 0 };
    topUpToFive(inv, 'rammer', emptyDraft());
    const fuse = canFuse(inv, 'rammer', 1, emptyDraft());
    expect(fuse.ok, '可用 5 → 可合成').toBe(true);
    expect(fuse.available).toBe(5);
  });

  it('T12. 真实 5→1 成功（1★ 消耗 5、2★ 增加 1）', () => {
    const inv = getInventory();
    inv.rammer = { one: 1, two: 0 };
    topUpToFive(inv, 'rammer', emptyDraft());
    const res = fuseSameStar(inv, 'rammer', 1, emptyDraft());
    expect(res, '合成成功').not.toBeNull();
    expect(getCount(inv, 'rammer', 1), '1★ 消耗 5（5-5=0）').toBe(0);
    expect(getCount(inv, 'rammer', 2), '2★ 增加 1').toBe(1);
  });

  it('T13. 连点不重复合成（第二次 canFuse 失败 / fuseSameStar 返回 null）', () => {
    const inv = getInventory();
    inv.rammer = { one: 1, two: 0 };
    topUpToFive(inv, 'rammer', emptyDraft());
    const res1 = fuseSameStar(inv, 'rammer', 1, emptyDraft());
    expect(res1, '第一次合成成功').not.toBeNull();
    const fuse2 = canFuse(inv, 'rammer', 1, emptyDraft());
    expect(fuse2.ok, '第二次可用 0 → 不可合成').toBe(false);
    const res2 = fuseSameStar(inv, 'rammer', 1, emptyDraft());
    expect(res2, '第二次合成空操作').toBeNull();
    expect(getCount(inv, 'rammer', 2), '2★ 仍为 1（不重复产出）').toBe(1);
  });

  it('T14. Build / 能量 / 奖励池不变（topUp 与 fuse 不触碰 draft / 奖励候选）', () => {
    const inv = getInventory();
    inv.ram = { one: 1, two: 0 };
    const draft = draftWithCannon();
    const draftSnap = JSON.stringify(draft);
    // 奖励候选池（functional 分支 defId 集合）仅依赖 OFFICIAL_PARTS，与库存数量无关
    const candsBefore = buildRewardCandidates()
      .filter((c) => c.kind === 'functional')
      .map((c) => c.defId)
      .sort();
    topUpToFive(inv, 'ram', draft);
    expect(JSON.stringify(draft), 'topUp 后 draft 未变').toBe(draftSnap);
    fuseSameStar(inv, 'ram', 1, draft);
    expect(JSON.stringify(draft), 'fuse 后 draft 未变').toBe(draftSnap);
    const candsAfter = buildRewardCandidates()
      .filter((c) => c.kind === 'functional')
      .map((c) => c.defId)
      .sort();
    expect(candsAfter, '奖励候选池 defId 集合不变').toEqual(candsBefore);
  });

  it('T15. reload 后 2★ 结果保持（saveInventory 落盘 + 重读）', () => {
    const { mem } = bindMemStorage();
    const inv = getInventory();
    inv.rammer = { one: 1, two: 0 };
    topUpToFive(inv, 'rammer', emptyDraft());
    fuseSameStar(inv, 'rammer', 1, emptyDraft()); // 内部 saveInventory
    expect(getCount(inv, 'rammer', 2), '当前 2★=1').toBe(1);
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
    expect(getCount(reloaded, 'rammer', 1), 'reload 后 1★=0').toBe(0);
    expect(getCount(reloaded, 'rammer', 2), 'reload 后 2★=1 保持').toBe(1);
  });

  it('T16. bundle-clean 确保普通/RC 无内部句柄泄漏（测试材料按钮仅为 UI，无 globalThis 句柄）', () => {
    // 含本 Queue 新增 UI 字符串、但无 globalThis.__* 赋值的合成 bundle → 普通/RC 均 PASS
    const bundle = [
      "const a = 1;",
      "this.button(x, y, w, h, 'backpack-test-material', '测试材料×5', { equipped: true });",
      "this.button(x, y, w, h, 'backpack-fuse', '合成', { selected: true });",
      "this.button(x, y, w, h, 'dev-grant-all', '全部件×1', {});",
      "__WX_DEBUG_GRANT__ = true;",
    ].join('\n');
    expect(runCheck(bundle, 'wechat').status, '普通微信 bundle PASS').toBe(0);
    expect(runCheck(bundle, 'rc').status, 'RC bundle PASS').toBe(0);
    // 回归：既有禁止句柄仍被拦（rc 模式）
    expect(runCheck('globalThis.__h = this;', 'rc').status, '__h 仍禁止').toBe(1);
    expect(runCheck('globalThis.__inv = {};', 'rc').status, '__inv 仍禁止（rc）').toBe(1);
    // E2E 专用句柄仍放行（不破既有 allowlist）
    expect(runCheck('globalThis.__inv = {};', 'e2e').status, '__inv 放行（e2e）').toBe(0);
  });

  it('回归守卫：dispatch 内 topUp 公式与源码一致', () => {
    expect(UI_SRC).toContain('const requiredOwned = eq + 5;');
    expect(UI_SRC).toContain('const topUp = Math.max(0, requiredOwned - owned);');
    expect(UI_SRC).toContain('addPart(inv, defId, 1, topUp);');
    expect(UI_SRC).toContain('saveInventory(inv);');
  });
});
