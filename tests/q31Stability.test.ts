/**
 * Queue Q31｜V0.8 Release Hardening — 必查 1. Runtime Stability
 *
 * 头less 50 场连续自动 Battle（直接调用正式 Battle Runtime，禁第二套物理）：
 * - NaN / Infinity：车辆位置 / 线速度 / 角度 / 角速度 / HP 全程有限；
 * - Unhandled Error：单步 step 抛错即判失败；
 * - 状态机卡死：每场必须在 STEP_CAP 内抵达 phase 'End'（HP 归零或 Arena 时钟）；
 * - timer / listener 残留：每场使用正式 requestAnimationFrame 外的固定步进，
 *   全程不得新增持久句柄（setInterval/setTimeout/socket）→ 用 process._getActiveHandles 验证无残留；
 * - Reward 重复结算：BattleRewardSettler 同场只结算一次（见同文件第二段）。
 *
 * 性能热点（Projectile / MachineGun / Flamethrower / Damage Numbers / Renderer）
 * 均为有界结构，本队列「只修明显热点、禁改玩法」，结论写入 V0.8_RELEASE_CHECKLIST.md（Task #54）。
 */
import { describe, it, expect } from 'vitest';
import { createRegistry } from '../src/core/content';
import { buildSnapshotFromDraft, type BuildDraft } from '../src/lab/buildEditorModel';
import { PhysicsLab } from '../src/lab/physicsLab';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import type { Renderer } from '../src/render/renderer';
import { BattleRewardSettler, loadInventoryRaw, getInventory } from '../src/core/partInventory';

const registry = createRegistry();
const rendererStub = { bind: () => {} } as unknown as Renderer;

const N_BATTLES = 50;
const STEP_CAP = 4000;

/** 已知合法车身（content.ts 中确认存在） */
const BODIES = ['boxBody', 'heavyBox', 'wedgeBody', 'tallBody'] as const;

/** 攻击性部件池（含 projectile 类以压测 Projectile/MachineGun/Flamethrower 生命周期） */
const WEAPONS = ['cannon', 'hammer', 'pushRod', 'saw', 'shotgun', 'thruster', 'machineGun', 'flamethrower'];

/** 按车身硬点顺序把武器轮转分配到每个槽，保证每场都压测 Weapon/Gadget/Projectile */
function weaponDraft(bodyDefId: string, seed: number): BuildDraft {
  const body = registry.bodies.get(bodyDefId);
  const slots = body ? body.functionalHardpoints.map((h) => h.id) : [];
  const selections: Record<string, string> = {};
  slots.forEach((hp, idx) => {
    selections[hp] = WEAPONS[(seed + idx) % WEAPONS.length];
  });
  return { bodyDefId, rearRadius: 20, frontRadius: 20, functionalSelections: selections, drive: 'forward' };
}

/** 采样车辆全部运动学 / HP 字段，发现非有限数则记录 */
function sampleFinite(o: PlanckBattleOrchestrator, battle: number, step: number, fail: string[]): void {
  for (const v of [o.vehicleA, o.vehicleB]) {
    const pos = o.world.getPosition(v.body);
    const vel = o.world.getLinearVelocity(v.body);
    const ang = o.world.getAngle(v.body);
    const av = o.world.getAngularVelocity(v.body);
    const fields: Record<string, number> = {
      x: pos.x,
      y: pos.y,
      vx: vel.x,
      vy: vel.y,
      ang,
      av,
      hp: v.hp,
    };
    for (const [k, val] of Object.entries(fields)) {
      if (!Number.isFinite(val)) fail.push(`battle ${battle} step ${step} ${v.team}.${k}=${val}`);
    }
  }
}

describe('Q31 Runtime Stability — 50-battle headless loop', () => {
  it(
    `连续跑 ${N_BATTLES} 场 Battle：无 NaN / 无抛错 / 无卡死 / 无句柄残留 / 内存有界`,
    { timeout: 120_000 },
    () => {
      const lab = new PhysicsLab(rendererStub);

      // timer / listener 残留检查：开战前记录活跃句柄数，结束后比对是否新增持久句柄
      const handlesBefore = (process as unknown as { _getActiveHandles?: () => unknown[] })
        ._getActiveHandles?.()
        .length ?? 0;

      const heapStart = process.memoryUsage().heapUsed;
      const heapWindows: number[] = [];
      const nanFailures: string[] = [];
      let reachedEnd = 0;
      let threw = '';

      for (let i = 0; i < N_BATTLES; i++) {
        const bodyA = BODIES[i % BODIES.length];
        const bodyB = BODIES[(i + 1) % BODIES.length];
        const snapA = buildSnapshotFromDraft(weaponDraft(bodyA, i), registry, 'A');
        const snapB = buildSnapshotFromDraft(weaponDraft(bodyB, i + 3), registry, 'B');
        lab.loadCustom(snapA, snapB, { autoDrive: true, engine: 'planck' });
        const o = lab.orchestrator as PlanckBattleOrchestrator;

        let steps = 0;
        for (; steps < STEP_CAP; steps++) {
          try {
            lab.step(16.6667);
          } catch (e) {
            threw = `battle ${i} (${bodyA} vs ${bodyB}) step ${steps}: ${(e as Error).message}`;
            break;
          }
          if (steps % 40 === 0) sampleFinite(o, i, steps, nanFailures);
          if (o.result?.phase === 'End') break;
        }

        // 收尾采样 + 卡死判定
        sampleFinite(o, i, steps, nanFailures);
        if (threw) break;
        if (o.result?.phase === 'End') reachedEnd++;
        else threw = `battle ${i} (${bodyA} vs ${bodyB}) 未在 ${STEP_CAP} 步内抵达 End（疑似状态机卡死）`;

        if (i % 5 === 4) heapWindows.push(process.memoryUsage().heapUsed);
      }

      // 清场（模拟 main.ts 一局结束后 clear）
      lab.clear();

      const handlesAfter = (process as unknown as { _getActiveHandles?: () => unknown[] })
        ._getActiveHandles?.()
        .length ?? handlesBefore;

      // 断言
      expect(threw, threw).toBe('');
      expect(reachedEnd, `抵达 End 的场次数不足（${reachedEnd}/${N_BATTLES}）`).toBe(N_BATTLES);
      expect(nanFailures, `检测到 NaN/Infinity：\n${nanFailures.join('\n')}`).toHaveLength(0);

      // 句柄残留：正式战斗运行时不应新增持久句柄（无 setInterval/setTimeout/socket）
      expect(handlesAfter, `活跃句柄新增（${handlesBefore} → ${handlesAfter}），疑似 timer/listener 残留`).toBeLessThanOrEqual(handlesBefore);

      // 内存有界：净增长不超过 256MB（真实泄漏会远超此线），且每 5 场窗口不持续暴涨
      const heapEnd = process.memoryUsage().heapUsed;
      const growthMB = (heapEnd - heapStart) / 1024 / 1024;
      expect(growthMB, `50 场后堆净增长 ${growthMB.toFixed(1)}MB 疑似持续泄漏`).toBeLessThan(256);
      heapWindows.forEach((h, idx) => {
        if (idx === 0) return;
        const deltaMB = (h - heapWindows[idx - 1]) / 1024 / 1024;
        expect(deltaMB, `第 ${idx} 个 5 场窗口堆增长 ${deltaMB.toFixed(1)}MB 疑似持续泄漏`).toBeLessThan(128);
      });
    },
  );
});

describe('Q31 Runtime Stability — Reward 重复结算幂等', () => {
  /** 内存版 localStorage 垫片，使 BattleRewardSettler 的库存落盘/读取可在 node 下观测 */
  class MemStorage {
    private store = new Map<string, string>();
    getItem(k: string): string | null {
      return this.store.has(k) ? (this.store.get(k) as string) : null;
    }
    setItem(k: string, v: string): void {
      this.store.set(k, v);
    }
    removeItem(k: string): void {
      this.store.delete(k);
    }
    clear(): void {
      this.store.clear();
    }
  }

  it('同场 Battle 重复 poll settle 只结算一次（不重复发奖）', () => {
    (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();

    const settler = new BattleRewardSettler();
    const ref = { arena: 'x' }; // 模拟 main.ts 持有的当前 Battle result 引用

    const r1 = settler.settle(ref, () => 0.5)!; // 取固定部件（settle 在正常运行路径恒非空）
    const r2 = settler.settle(ref, () => 0.5); // 同场再次 poll

    expect(r2).toBe(r1); // 直接返回缓存结果，无二次计算
    const defId = r1.defId;
    const afterFirst = loadInventoryRaw()![defId].one;

    // 同场第三次 poll：返回同一缓存，落盘库存不增加（不重复发奖）
    const r3 = settler.settle(ref, () => 0.5);
    expect(r3).toBe(r1);
    expect(loadInventoryRaw()![defId].one).toBe(afterFirst);

    // 新一场 Battle（不同 ref）→ 应再次结算并累加 1（证明「不同战会发奖、同战不重发」）
    const ref2 = { arena: 'y' };
    const r4 = settler.settle(ref2, () => 0.5)!;
    expect(r4.countAfter).toBe(afterFirst + 1);
    expect(loadInventoryRaw()![defId].one).toBe(afterFirst + 1);
  });

  it('reset() 后可结算新一场（开战前清幂等键）', () => {
    (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();
    const settler = new BattleRewardSettler();
    const ref = {};
    const r1 = settler.settle(ref, () => 0.1)!;
    const base = r1.countAfter;
    // 同 ref 仍幂等（不重复发）
    expect(settler.settle(ref, () => 0.1)!.countAfter).toBe(base);
    // 开战前 reset → 同 ref 可再次结算（模拟新一场），累加 1
    settler.reset();
    const r2 = settler.settle(ref, () => 0.1)!;
    expect(r2.countAfter).toBe(base + 1);
  });

  it('零存档新账号 getInventory 不抛错（默认 starter 库存）', () => {
    (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();
    const inv = getInventory();
    expect(inv).toBeTruthy();
    // 默认界面：starter 部件各 1★
    expect(inv['cannon'].one).toBe(1);
  });
});
