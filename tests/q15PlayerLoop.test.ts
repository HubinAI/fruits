/**
 * Queue Q15｜正常玩家游戏主循环 V1 —— targeted test（纯模块层）。
 *
 * 覆盖：
 * 1. 对手池（OPPONENT_POOL）：6 套、彼此不同、全部合法 Build、仅 watermelon/banana
 *    + 当前正式 PART_OPTIONS、不含 wedge/ramHead/lifter/旋锤 等 HOLD 内容；
 * 2. nextOpponentIndex：固定顺序循环（与上一场不同）；
 * 3. Build 持久化（buildPersistence）：存取往返、非法 JSON / 未知 Body / 未知部件 /
 *    缺字段 → null（回退默认）；无存档 → null。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  OPPONENT_POOL,
  cloneBuildDraft,
  nextOpponentIndex,
  pickRandomOpponent,
  buildMatchingSequence,
} from '../src/player/opponentPool';
import { PART_OPTIONS } from '../src/core/partOptions';
import { EMPTY_SLOT } from '../src/lab/buildEditorModel';
import { loadPlayerBuild, savePlayerBuild } from '../src/core/buildPersistence';
import { validateSnapshot, computeEnergy } from '../src/core/buildValidator';
import { registry } from '../src/core/content';
import type { BuildDraft } from '../src/lab/buildEditorModel';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';

const PART_OPTION_VALUES = new Set(PART_OPTIONS.map((p) => p.v));
const HOLD_PARTS = new Set(['wedgeShovel', 'ramHead', 'lifter']); // 楔铲/冲撞头/举升臂（旋锤未实现，无 defId）
const ALLOWED_BODIES = new Set(['watermelonBody', 'bananaBody']);

// buildSnapshot 辅助：Draft → BuildSnapshot（与运行时一致路径）
import { buildSnapshotFromDraft } from '../src/lab/buildEditorModel';
function buildSnapshot(d: BuildDraft) {
  return buildSnapshotFromDraft(d, registry, 'customA');
}

describe('Q15 对手池', () => {
  it('1. 共 6 套对手配置', () => {
    expect(OPPONENT_POOL.length).toBe(6);
  });

  it('2. 6 套配置彼此明显不同（无重复）', () => {
    const keys = OPPONENT_POOL.map((d) => JSON.stringify(d));
    expect(new Set(keys).size).toBe(6);
  });

  it('3. 全部合法 Build（≥1 Weapon 且 Energy 不超载）', () => {
    for (const d of OPPONENT_POOL) {
      const snap = buildSnapshot(d);
      const res = validateSnapshot(snap, registry);
      expect(res.valid, `${d.bodyDefId} 应合法: ${res.errors.join('; ')}`).toBe(true);
      const energy = computeEnergy(snap, registry).energy;
      const cap = registry.bodies.get(d.bodyDefId)!.energyCapacity;
      expect(energy).toBeLessThanOrEqual(cap);
    }
  });

  it('4. 只使用 watermelon / banana Body', () => {
    for (const d of OPPONENT_POOL) {
      expect(ALLOWED_BODIES.has(d.bodyDefId)).toBe(true);
    }
  });

  it('5. 只使用当前正式 PART_OPTIONS，且不含 HOLD 内容', () => {
    for (const d of OPPONENT_POOL) {
      for (const v of Object.values(d.functionalSelections)) {
        if (v === EMPTY_SLOT) continue;
        expect(PART_OPTION_VALUES.has(v)).toBe(true); // 来自正式 PART_OPTIONS
        expect(HOLD_PARTS.has(v)).toBe(false); // 不含 HOLD 部件
      }
    }
  });

  it('6. cloneBuildDraft 深拷贝（改副本不影响池内常量）', () => {
    const c = cloneBuildDraft(OPPONENT_POOL[0]);
    c.functionalSelections.front = EMPTY_SLOT;
    expect(OPPONENT_POOL[0].functionalSelections.front).not.toBe(EMPTY_SLOT);
  });
});

describe('Q15 对手循环', () => {
  it('nextOpponentIndex 顺序推进且与上一场不同', () => {
    expect(nextOpponentIndex(0, 6)).toBe(1);
    expect(nextOpponentIndex(2, 6)).toBe(3);
    expect(nextOpponentIndex(5, 6)).toBe(0); // 循环回首
  });

  it('pool 长度 0 安全回退 0', () => {
    expect(nextOpponentIndex(3, 0)).toBe(0);
  });

  it('连续 3 场对手均不同（验收 #4）', () => {
    let i = 0;
    const seen = new Set<number>();
    for (let n = 0; n < 3; n++) {
      seen.add(i);
      i = nextOpponentIndex(i, OPPONENT_POOL.length);
    }
    expect(seen.size).toBe(3);
  });
});

/** 确定性 rng：按给定序列返回（用于纯函数单测） */
function fixedRng(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[Math.min(i, values.length - 1)];
    i += 1;
    return v;
  };
}

describe('Q15-UX-R1 真随机匹配（纯函数）', () => {
  it('pool=1 恒返回 0（无对手可随机）', () => {
    expect(pickRandomOpponent(0, 1)).toBe(0);
    expect(pickRandomOpponent(0, 1, fixedRng([0.9]))).toBe(0);
  });

  it('首场（last=-1）不受连续限制，按 rng 抽取', () => {
    // 0.5*6=3 → 索引 3
    expect(pickRandomOpponent(-1, 6, fixedRng([0.5]))).toBe(3);
  });

  it('pool>1 禁止连续两场选到同一对手（首抽命中 last 触发重抽）', () => {
    // 第一次必然映射到 last(2) → 重抽 → 第二次映射到 3
    const idx = pickRandomOpponent(2, 6, fixedRng([0.4, 0.5]));
    expect(idx).toBe(3);
    expect(idx).not.toBe(2);
  });

  it('pool>1 普通抽取结果与 rng 一致（与 last 无关）', () => {
    // 0.16*6=0.96 → floor=0
    expect(pickRandomOpponent(1, 6, fixedRng([0.16]))).toBe(0);
  });

  it('buildMatchingSequence 长度 4，末位=最终对手，前 3 互异且≠末位', () => {
    const seq = buildMatchingSequence(2, 6, fixedRng([0.1, 0.3, 0.5, 0.7, 0.9]));
    expect(seq).toHaveLength(4);
    expect(seq[3]).toBe(2); // 末位 = 实际锁定对手（定格真正对手）
    const head = seq.slice(0, 3);
    expect(new Set(head).size).toBe(3); // 互异
    for (const h of head) expect(h).not.toBe(2); // 均≠最终对手 → 定格前可见 ≥3 次变化
  });

  it('buildMatchingSequence pool=1 退化为单元素 [finalIdx]', () => {
    expect(buildMatchingSequence(0, 1, fixedRng([0.5]))).toEqual([0]);
  });

  it('solo-A 预览标记贯穿 orchestrator → getRenderSnapshot', () => {
    const orch = new PlanckBattleOrchestrator(
      buildSnapshot(OPPONENT_POOL[0]),
      buildSnapshot(OPPONENT_POOL[1]),
      registry,
      { engine: 'planck', autoDrive: false },
      true,
    );
    expect(orch.soloA).toBe(true);
    expect(orch.getRenderSnapshot().soloA).toBe(true);
  });
});

/** 内存版 localStorage，供持久化测试（node 环境无原生 localStorage） */
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
}

describe('Q15 Build 持久化', () => {
  beforeEach(() => {
    (globalThis as unknown as { localStorage: MemStorage }).localStorage =
      new MemStorage();
  });

  it('1. 合法 Build 存取往返一致', () => {
    const d = cloneBuildDraft(OPPONENT_POOL[0]);
    savePlayerBuild(d);
    const loaded = loadPlayerBuild();
    expect(loaded).not.toBeNull();
    expect(loaded).toEqual(d);
  });

  it('2. 无存档 → null（回退默认）', () => {
    expect(loadPlayerBuild()).toBeNull();
  });

  it('3. 非法 JSON → null', () => {
    (
      globalThis as unknown as { localStorage: MemStorage }
    ).localStorage.setItem('strongfruit.playerBuild.v1', '{bad json');
    expect(loadPlayerBuild()).toBeNull();
  });

  it('4. 未知 Body → null（旧存档非法）', () => {
    const bad: BuildDraft = {
      bodyDefId: 'ghostBody',
      rearRadius: 20,
      frontRadius: 20,
      functionalSelections: { front: EMPTY_SLOT, frontMass: EMPTY_SLOT, top: EMPTY_SLOT, rear: EMPTY_SLOT },
    };
    savePlayerBuild(bad);
    expect(loadPlayerBuild()).toBeNull();
  });

  it('5. 未知部件 → null', () => {
    const bad: BuildDraft = {
      bodyDefId: 'watermelonBody',
      rearRadius: 20,
      frontRadius: 20,
      functionalSelections: { front: 'ghostPart', frontMass: EMPTY_SLOT, top: EMPTY_SLOT, rear: EMPTY_SLOT },
    };
    savePlayerBuild(bad);
    expect(loadPlayerBuild()).toBeNull();
  });

  it('6. 缺字段（无轮径）→ null', () => {
    const bad = { bodyDefId: 'watermelonBody' } as unknown as BuildDraft;
    savePlayerBuild(bad);
    expect(loadPlayerBuild()).toBeNull();
  });

  it('7. 合法默认 Build（silDraft 等价）可被接受', () => {
    const def: BuildDraft = {
      bodyDefId: 'watermelonBody',
      rearRadius: 20,
      frontRadius: 20,
      functionalSelections: { front: 'pushRod', frontMass: 'cannon', top: 'hammer', rear: EMPTY_SLOT },
    };
    expect(validateSnapshot(buildSnapshot(def), registry).valid).toBe(true);
    savePlayerBuild(def);
    expect(loadPlayerBuild()).toEqual(def);
  });
});
