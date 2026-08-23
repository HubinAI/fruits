/**
 * Queue Q26｜V0.7 新账号首轮流程 —— targeted 测试（纯模块层）。
 *
 * node 环境无原生 localStorage；用 MemStorage 注入 globalThis.localStorage。
 * 覆盖：
 *  A｜空存档合法 Starter Build（要求 1：≥1 Weapon / Energy 合法 / Drive 前进 / validateSnapshot 通过）；
 *  B｜首轮引导状态机（onboarding.ts）：
 *     B1 全新账号 → pending 且持久化；
 *     B2 老存档（已有 Build）→ done，不进引导（要求 3）；
 *     B3 完成闭环 completeOnboarding → done 持久化，刷新一致（要求 2 / 要求 4）；
 *     B4 全新账号中途落盘 Build 后刷新仍 pending（显式标志权威，不被误判为老存档）；
 *     B5 completeOnboarding 幂等。
 *  验收 5（主流程无新增确认步骤）由代码审查保证：本 Queue 仅新增极简提示 DOM + onboarding 标志，
 *  未新增任何按钮 / 确认页 / 遮罩；onboarding 完成仅在 Result「调整配置」路径触发，
 *  不影响 MatchPreview 的「调整配置」（其走独立 adjustConfig）。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  makeStarterDraft,
  resolveDriveMode,
  buildSnapshotFromDraft,
} from '../src/lab/buildEditorModel';
import { registry } from '../src/core/content';
import { validateSnapshot, computeEnergy } from '../src/core/buildValidator';
import {
  resolveOnboardingStage,
  completeOnboarding,
  loadOnboarding,
  isFreshAccount,
} from '../src/core/onboarding';
import { loadPlayerBuild, savePlayerBuild } from '../src/core/buildPersistence';

/** 内存版 localStorage（node 环境无原生） */
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
  clear(): void {
    this.m.clear();
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

function snapshotOf(bodyDefId: string) {
  return buildSnapshotFromDraft(makeStarterDraft(bodyDefId, registry), registry, 'customA');
}

function hasWeapon(bodyDefId: string): boolean {
  const snap = snapshotOf(bodyDefId);
  return snap.functionals.some(
    (f) => registry.functionals.get(f.defId)?.category === 'weapon',
  );
}

describe('A｜空存档合法 Starter Build（要求 1）', () => {
  it('A1. 至少 1 个 Weapon', () => {
    expect(hasWeapon('watermelonBody')).toBe(true);
    expect(hasWeapon('bananaBody')).toBe(true);
  });

  it('A2. Energy 合法（≤ 任意 Body 容量）', () => {
    for (const bodyId of ['watermelonBody', 'bananaBody', 'pineappleBody', 'coconutBody']) {
      const body = registry.bodies.get(bodyId)!;
      const used = computeEnergy(snapshotOf(bodyId), registry).energy;
      expect(used).toBeLessThanOrEqual(body.energyCapacity);
    }
  });

  it('A3. Drive 默认前进', () => {
    const d = makeStarterDraft('watermelonBody', registry);
    expect(resolveDriveMode(d.drive)).toBe('forward');
  });

  it('A4. validateSnapshot 通过（构成合法 Build，可开战）', () => {
    expect(validateSnapshot(snapshotOf('watermelonBody'), registry).valid).toBe(true);
    expect(validateSnapshot(snapshotOf('bananaBody'), registry).valid).toBe(true);
  });

  it('A5. 空存档 loadPlayerBuild 返回 null（main 回退到 makeStarterDraft，玩家无需先修配置）', () => {
    expect(loadPlayerBuild()).toBeNull();
    expect(isFreshAccount()).toBe(true);
  });
});

describe('B｜首轮引导状态机（onboarding.ts）', () => {
  it('B1. 全新账号 → pending 且持久化', () => {
    const stage = resolveOnboardingStage();
    expect(stage).toBe('pending');
    expect(loadOnboarding()).toBe('pending'); // 已落盘，刷新一致
    expect(isFreshAccount()).toBe(true);
  });

  it('B2. 老存档（已有 Build）→ done，不进引导（要求 3）', () => {
    // 模拟老玩家：启动前已有合法 Build 落盘
    savePlayerBuild(makeStarterDraft('watermelonBody', registry));
    expect(loadPlayerBuild()).not.toBeNull();
    const stage = resolveOnboardingStage();
    expect(stage).toBe('done');
    expect(loadOnboarding()).toBe('done');
  });

  it('B3. 完成闭环 → done 持久化，刷新不再重复（要求 2 / 要求 4）', () => {
    expect(resolveOnboardingStage()).toBe('pending'); // 全新账号首启动
    completeOnboarding();
    expect(loadOnboarding()).toBe('done');
    // 模拟刷新：重新解析，应仍为 done（不再提示）
    expect(resolveOnboardingStage()).toBe('done');
  });

  it('B4. 全新账号中途落盘 Build 后刷新仍 pending（显式标志权威）', () => {
    expect(resolveOnboardingStage()).toBe('pending'); // 写入 pending 标志
    // 玩家在闭环前改了配置 → Build 落盘（但尚未完成 Battle→Result→Garage）
    savePlayerBuild(makeStarterDraft('bananaBody', registry));
    expect(loadPlayerBuild()).not.toBeNull(); // 现在已「有 Build」
    // 刷新后不应被误判为老存档：显式 pending 标志优先
    expect(resolveOnboardingStage()).toBe('pending');
  });

  it('B5. completeOnboarding 幂等（重复调用仍 done）', () => {
    completeOnboarding();
    completeOnboarding();
    expect(loadOnboarding()).toBe('done');
    expect(resolveOnboardingStage()).toBe('done');
  });
});
