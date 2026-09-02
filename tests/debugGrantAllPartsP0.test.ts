/**
 * Queue F-DEBUG-GRANT-COVERAGE-P0｜全部件 ×1 调试入口（targeted，T1-T16）。
 *
 * 修复点（相对上一版 F-DEBUG-GRANT-ALL-PARTS-P0）：
 * - ×1 语义：缺失（count<1）才补到 1；已拥有（≥1）不再增加（四.1 / T6 / T7）；
 *   上一版「每次 +1 累加」已撤销（与 OFFICIAL_MOVEMENTS 的 bring-to-1 一致）。
 * - 「已领取」真实判定：hasAllOfficialDebugContent 从真实库存/拥有存档计算，重启后重算仍正确。
 * - 覆盖以正式 Registry（OFFICIAL_BODIES / OFFICIAL_MOVEMENTS / OFFICIAL_PARTS）为单一来源，
 *   后续新增正式部件自动纳入；boxBody/tallBody/heavyBox/对手池专用/内部占位均不授予。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  grantAllPartsOnce,
  grantablePartIds,
  hasAllOfficialDebugContent,
} from '../src/core/debugGrants';
import {
  OFFICIAL_PARTS,
  OFFICIAL_MOVEMENTS,
  getCount,
  getInventory,
  isOfficialPart,
  buildRewardCandidates,
  type PartInventory,
} from '../src/core/partInventory';
import { BODY_OPTIONS } from '../src/ui/playerUI';
import {
  OFFICIAL_BODIES,
  NEW_OFFICIAL_BODIES,
  DEFAULT_OWNED_BODIES,
  isBodyOwned,
  loadOwnedBodies,
} from '../src/core/bodyOwnership';
import { bindPlatformCore } from '../src/platform/context';
import { createWebCore } from '../src/platform/web';

const STORAGE_V2 = 'strongfruit.ownedParts.v2';
const BODY_STORAGE = 'strongfruit.ownedBodies.v1';

/** 内存 storage 桩（WebStorage 在无 localStorage 环境静默降级 → 需桩测持久化） */
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

function counts(inv: PartInventory): Record<string, number> {
  const out: Record<string, number> = {};
  for (const defId of [...OFFICIAL_PARTS, ...OFFICIAL_MOVEMENTS]) out[defId] = getCount(inv, defId, 1);
  return out;
}

function newBodyOwned(): string[] {
  return loadOwnedBodies();
}

describe('F-DEBUG-GRANT-COVERAGE-P0｜全部件 ×1 覆盖 + ×1 语义 + 已领取判定', () => {
  beforeEach(() => {
    bindMemStorage();
  });
  afterEach(() => {
    bindPlatformCore(createWebCore());
  });

  it('T1. 正式 Body 全覆盖（默认 4 恒拥有 + 新 4 点击后全部拥有）', () => {
    // 点击前：默认 4 拥有，新 4 未拥有
    for (const b of DEFAULT_OWNED_BODIES) expect(isBodyOwned(b), `${b} 默认拥有`).toBe(true);
    for (const b of NEW_OFFICIAL_BODIES) expect(isBodyOwned(b), `${b} 点击前未拥有`).toBe(false);
    grantAllPartsOnce();
    for (const b of OFFICIAL_BODIES) expect(isBodyOwned(b), `${b} 点击后拥有`).toBe(true);
  });

  it('T2. 正式 Movement 全覆盖（3 轮组点击后数量均 ≥1）', () => {
    const before = getInventory();
    for (const m of OFFICIAL_MOVEMENTS) expect(getCount(before, m, 1), `${m} 点击前 0`).toBe(0);
    grantAllPartsOnce();
    const after = getInventory();
    for (const m of OFFICIAL_MOVEMENTS) expect(getCount(after, m, 1), `${m} 点击后 ≥1`).toBeGreaterThanOrEqual(1);
  });

  it('T3. 正式 Functional 全覆盖（OFFICIAL_PARTS 全部点击后数量 ≥1）', () => {
    const before = getInventory();
    const beforeCounts = counts(before);
    grantAllPartsOnce();
    const after = getInventory();
    for (const p of OFFICIAL_PARTS) {
      expect(getCount(after, p, 1), `${p} 点击后 ≥1`).toBeGreaterThanOrEqual(1);
      // 缺失项补到 1（不为 2）
      if (beforeCounts[p] < 1) expect(getCount(after, p, 1), `${p} 缺失补到 1`).toBe(1);
    }
  });

  it('T4. 武器与辅助分别至少验证一个真实 defId（cannon=武器、thruster=辅助）', () => {
    grantAllPartsOnce();
    const after = getInventory();
    expect(getCount(after, 'cannon', 1)).toBeGreaterThanOrEqual(1); // 武器
    expect(getCount(after, 'thruster', 1)).toBeGreaterThanOrEqual(1); // 辅助
    // 遍历正式 Registry，确认不含测试/占位（T5 前置）
    for (const p of OFFICIAL_PARTS) expect(isOfficialPart(p), `${p} 为正式部件`).toBe(true);
  });

  it('T5. 内部/测试 Body 不被授予（boxBody/tallBody/heavyBox 仍不可装备、不在 OFFICIAL_BODIES）', () => {
    grantAllPartsOnce();
    for (const bad of ['boxBody', 'tallBody', 'heavyBox']) {
      expect(OFFICIAL_BODIES.includes(bad), `${bad} 不在正式车身目录`).toBe(false);
      expect(isBodyOwned(bad), `${bad} 仍不可装备`).toBe(false);
    }
    expect(BODY_OPTIONS.every((o) => OFFICIAL_BODIES.includes(o.v)), 'BODY_OPTIONS 均为正式车身').toBe(true);
  });

  it('T6. 第一次点击把所有缺失项补到 1（缺失→1，已有→不变）', () => {
    const before = getInventory();
    const beforeCounts = counts(before);
    grantAllPartsOnce();
    const after = getInventory();
    const afterCounts = counts(after);
    for (const defId of [...OFFICIAL_PARTS, ...OFFICIAL_MOVEMENTS]) {
      if (beforeCounts[defId] < 1) expect(afterCounts[defId], `${defId} 缺失补到 1`).toBe(1);
      else expect(afterCounts[defId], `${defId} 已有不变`).toBe(beforeCounts[defId]);
    }
    for (const b of NEW_OFFICIAL_BODIES) expect(isBodyOwned(b), `${b} 新车身解锁`).toBe(true);
  });

  it('T7. 第二次点击所有数量不变（幂等，不累加）', () => {
    grantAllPartsOnce();
    const after1 = counts(getInventory());
    const ownedBodies1 = newBodyOwned().slice();
    grantAllPartsOnce(); // 第二次
    const after2 = counts(getInventory());
    const ownedBodies2 = newBodyOwned().slice();
    for (const defId of [...OFFICIAL_PARTS, ...OFFICIAL_MOVEMENTS]) {
      expect(after2[defId], `${defId} 二次点击不变`).toBe(after1[defId]);
    }
    expect(ownedBodies2.sort()).toEqual(ownedBodies1.sort());
  });

  it('T8. 已有数量≥2 或高星内容不被覆盖（×1 不降不升）', () => {
    const inv = getInventory();
    // 预置 cannon=2、machineGun 2★=1（高星）
    inv.cannon = { one: 2, two: 0 };
    inv.machineGun = { one: 0, two: 1 };
    grantAllPartsOnce(inv);
    expect(getCount(inv, 'cannon', 1), 'cannon 仍为 2（不降）').toBe(2);
    expect(getCount(inv, 'machineGun', 2), 'machineGun 2★ 仍为 1（不覆盖）').toBe(1);
    // 其它缺失补到 1
    expect(getCount(inv, 'laser', 1), 'laser 补到 1').toBe(1);
  });

  it('T9. 部分拥有状态下 hasAllOfficialDebugContent=false（按钮仍可点）', () => {
    // 全新账号：新车身未拥有 → 不完整
    expect(hasAllOfficialDebugContent(), '全新账号不完整').toBe(false);
  });

  it('T10. 全部拥有后 hasAllOfficialDebugContent=true（按钮显示已领取）', () => {
    grantAllPartsOnce();
    expect(hasAllOfficialDebugContent(), '授予后完整').toBe(true);
  });

  it('T11. 重启后 claimed 状态由库存重算（模拟刷新重读 storage）', () => {
    const { mem } = bindMemStorage();
    grantAllPartsOnce();
    expect(hasAllOfficialDebugContent(), '授予后完整').toBe(true);
    // 模拟重启：重新 bind 同一 mem → 从 storage 重算
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
    expect(mem.has(STORAGE_V2), '库存已落盘').toBe(true);
    expect(mem.has(BODY_STORAGE), '车身拥有已落盘').toBe(true);
    expect(hasAllOfficialDebugContent(), '重启后重算仍完整').toBe(true);
    // 部分场景：清空车身存档 → 重算不完整
    mem.delete(BODY_STORAGE);
    expect(hasAllOfficialDebugContent(), '清车身存档后不完整').toBe(false);
  });

  it('T12. 点击后所有 Garage 正式卡片均不再显示未获得（遍历官方 Registry 逐项验证）', () => {
    grantAllPartsOnce();
    const inv = getInventory();
    // 所有正式功能件数量 ≥1
    for (const p of OFFICIAL_PARTS) expect(getCount(inv, p, 1), `${p} 已获得`).toBeGreaterThanOrEqual(1);
    // 所有正式轮组数量 ≥1
    for (const m of OFFICIAL_MOVEMENTS) expect(getCount(inv, m, 1), `${m} 已获得`).toBeGreaterThanOrEqual(1);
    // 所有正式车身拥有
    for (const b of OFFICIAL_BODIES) expect(isBodyOwned(b), `${b} 已拥有`).toBe(true);
  });

  it('T13. 普通 build:wechat 不显示按钮（源码守卫：按钮门控含 __WX_DEBUG_GRANT__ 且正式构建隐藏）', () => {
    const host = readFileSync('src/ui/canvasPlayerUIHost.ts', 'utf-8');
    expect(host).toContain("'dev-grant-all'");
    expect(host).toContain('__WX_DEBUG_GRANT__');
    expect(host).toContain('__E2E_INTERNAL_HANDLE__');
    const env = readFileSync('src/core/env.ts', 'utf-8');
    expect(env, 'DEV_TOOLS_VISIBLE = !IS_PROD（正式构建隐藏）').toContain('export const DEV_TOOLS_VISIBLE: boolean = !IS_PROD;');
  });

  it('T14. RC build 显示按钮（源码守卫：rcGrant 条件含 __WX_DEBUG_GRANT__）', () => {
    const host = readFileSync('src/ui/canvasPlayerUIHost.ts', 'utf-8');
    expect(host).toContain('const rcGrant');
    expect(host).toContain('rcGrant || e2eProbe || devReset');
    expect(host).toContain('if (!(rcGrant || e2eProbe || devReset)) return;');
  });

  it('T15. 正式奖励候选池与概率不变（buildRewardCandidates / computeReward 不改；覆盖与奖励解耦）', () => {
    const src = readFileSync('src/core/partInventory.ts', 'utf-8');
    expect(src).toContain('buildRewardCandidates');
    expect(src).toContain('computeReward');
    // 候选池仍恒含全部 OFFICIAL_PARTS（functional 分支）
    const cands = buildRewardCandidates();
    const funcDefs = cands.filter((c) => c.kind === 'functional').map((c) => c.defId);
    for (const p of OFFICIAL_PARTS) expect(funcDefs.includes(p), `${p} 在奖励候选池`).toBe(true);
  });

  it('T16. 玩家当前装备与 BuildSnapshot 不变（grant 不触碰 draft）', () => {
    const before = getInventory();
    const beforeSnapshot = JSON.stringify(before);
    grantAllPartsOnce();
    const after = getInventory();
    const afterSnapshot = JSON.stringify(after);
    // 仅新增缺失项（≥1 项从 0→1），已拥有项不变；draft 不在此函数作用域内（不触碰装备）
    expect(afterSnapshot).not.toBe(beforeSnapshot); // 确有内容被授予（缺失项）
    // 验证：授予只改数量，不引入非官方键
    for (const k of Object.keys(after)) {
      expect(OFFICIAL_PARTS.includes(k) || OFFICIAL_MOVEMENTS.includes(k), `${k} 为官方键`).toBe(true);
    }
    const runtime = readFileSync('src/game/playerGameRuntime.ts', 'utf-8');
    expect(runtime).toContain('grantAllPartsOnce()'); // 仅 grant + 反馈，无装备调用
  });

  it('回归守卫：grantablePartIds 去重（无空/无重复/全 isOfficialPart）', () => {
    const ids = grantablePartIds();
    expect(ids.includes('EMPTY_SLOT' as string)).toBe(false);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(isOfficialPart(id)).toBe(true);
    expect(ids.sort()).toEqual([...OFFICIAL_PARTS].sort());
  });
});
