/**
 * Queue F-DEBUG-GRANT-ALL-PARTS-P0｜一键全部件 ×1 调试入口（targeted）
 *
 * T1 去重：grantablePartIds 无「空」/ 无重复 / 全部 isOfficialPart（Must#4/9）
 * T2 每种部件 +1：点击一次后全部件 getCount 精确 +1（不重置为 1）
 * T3 连续点击累计：第二次再 +1（Must#5/9 幂等，便于合成测试）
 * T4 持久化：saveInventory 落盘 → 内存 storage 读回数量保留（Must#6）
 * T5 返回 N = 实际去重种类数（Must#8 反馈文案数据源）
 * T6 不触碰其他进度：只改库存，不动装备/金币/段位（本函数签名只接收库存）
 * T7 构建隔离（源码守卫）：按钮显示条件 = DEV_TOOLS_VISIBLE && resetDevVisible
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { grantAllPartsOnce, grantablePartIds } from '../src/core/debugGrants';
import { bindPlatformCore } from '../src/platform/context';
import { createWebCore } from '../src/platform/web';
import { EMPTY_SLOT } from '../src/lab/buildEditorModel';
import { getCount, isOfficialPart, OFFICIAL_PARTS, getInventory, type PartInventory } from '../src/core/partInventory';

const STORAGE_V2 = 'strongfruit.ownedParts.v2';

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
  for (const defId of OFFICIAL_PARTS) out[defId] = getCount(inv, defId, 1);
  return out;
}

describe('F-DEBUG-GRANT-ALL-PARTS-P0｜全部件 ×1 调试入口', () => {
  beforeEach(() => {
    bindMemStorage();
  });
  afterEach(() => {
    bindPlatformCore(createWebCore());
  });

  it('T1. grantablePartIds 去重：无「空」/ 无重复 / 全部 isOfficialPart（Must#4/9）', () => {
    const ids = grantablePartIds();
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.includes(EMPTY_SLOT), '排除「空」').toBe(false);
    expect(new Set(ids).size, '同一 part ID 只出现一次').toBe(ids.length);
    for (const id of ids) {
      expect(isOfficialPart(id), `${id} 是正式部件（排除 fixture/占位/内部虚拟）`).toBe(true);
    }
    // 与 OFFICIAL_PARTS（真实可获得集合）一致
    expect(ids.sort()).toEqual([...OFFICIAL_PARTS].sort());
  });

  it('T2. 每种部件精确 +1（不重置为 1）', () => {
    const ids = grantablePartIds();
    const before = getInventory();
    const beforeCounts = counts(before);
    const n = grantAllPartsOnce(before);
    expect(n).toBe(ids.length);
    for (const defId of ids) {
      expect(getCount(getInventory(), defId, 1), `${defId} +1`).toBe(beforeCounts[defId] + 1);
    }
  });

  it('T3. 连续点击继续 +1（幂等累计，便于合成测试）', () => {
    const before = getInventory();
    const b0 = counts(before);
    grantAllPartsOnce(before);
    grantAllPartsOnce(before); // 第二次点击
    for (const defId of OFFICIAL_PARTS) {
      expect(getCount(getInventory(), defId, 1), `${defId} 两次点击 = 原+2`).toBe(b0[defId] + 2);
    }
  });

  it('T4. 持久化：刷新（重读 storage）后数量保留（Must#6 不建 debug 副本）', () => {
    const { mem } = bindMemStorage();
    const before = getInventory();
    const n = grantAllPartsOnce(before);
    // 内存 storage 已写入（saveInventory → setItem）
    expect(mem.has(STORAGE_V2), '库存已落盘').toBe(true);
    // 模拟刷新：重新 bind 同一 mem → getInventory 从 storage 读回
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
    for (const defId of grantablePartIds()) {
      expect(getCount(reloaded, defId, 1), `${defId} 刷新后保留`).toBeGreaterThan(0);
    }
    expect(n, 'N = 去重种类数').toBe(grantablePartIds().length);
  });

  it('T5. 返回 N = 实际去重种类数（Must#8 反馈文案数据源）', () => {
    const n1 = grantAllPartsOnce();
    expect(n1).toBe(grantablePartIds().length);
    const n2 = grantAllPartsOnce(); // 重复点击 N 不变（同集合）
    expect(n2).toBe(n1);
  });

  it('T6. 只触碰库存：函数只修改 PartInventory，不涉及装备/金币/段位/能量（EMPTY_SLOT 哨兵常量除外）', () => {
    const src = readFileSync('src/core/debugGrants.ts', 'utf-8');
    expect(src).not.toContain('playerProgress');
    expect(src).not.toContain('buildValidator');
    expect(src).not.toContain('computeEnergy');
    expect(src).not.toContain('onPickGarageOption');
    // 每部件 star=1（不升星）
    expect(src).toContain('addPart(store, defId, 1, 1)');
  });

  it('T7. 构建隔离（源码守卫）：按钮仅 dev/test/e2e 构建 + ?resetdev=1 显示', () => {
    const host = readFileSync('src/ui/canvasPlayerUIHost.ts', 'utf-8');
    expect(host).toContain('DEV_TOOLS_VISIBLE');
    expect(host).toContain('__E2E_PROBE__');
    expect(host).toContain('state.resetDevVisible');
    expect(host, 'dev-grant-all 命中区').toContain("'dev-grant-all'");
    // 正式玩家模式（无 resetdev 参数）→ resetDevVisible=false → 无按钮（条件绘制）
    const env = readFileSync('src/core/env.ts', 'utf-8');
    expect(env, 'DEV_TOOLS_VISIBLE = !IS_PROD（正式构建隐藏）').toContain('export const DEV_TOOLS_VISIBLE: boolean = !IS_PROD;');
    // 不自动装备：runtime 仅 grant + 反馈，无装备调用
    const runtime = readFileSync('src/game/playerGameRuntime.ts', 'utf-8');
    expect(runtime).toContain('grantAllPartsOnce()');
  });
});
