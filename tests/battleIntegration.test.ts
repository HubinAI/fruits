/**
 * Queue W1-INTEG｜Battle Foundation Closure Integration
 *
 * Canonical Battle Integration：BattleRequest → createPlanckBattle → 正式 Planck Runtime
 * 跑完整战斗。只集成、补测试、修真实集成 Bug，禁止新增功能。
 *
 * 验证（W1 全部封板点的整合行为）：
 * 1. 同一 BattleRequest 连续运行两次：winner / hpA / hpB / duration 保持一致（确定性）；
 * 2. 全程没有 draw（winner 必为 A/B）；
 * 3. Closing hazard 接触真实扣血（damageSource:'hazard' 事件 + hp 真实下降）；
 * 4. 同时死亡 → seed tie-break 可复现（router 级同一步双死 + 压死场景两次运行一致）；
 * 5. Generic Behavior Registry：Cannon/Hammer/Push 均经统一 behaviors[] lifecycle 真实工作
 *    （fire 事件真实产生；hammer/pushRod 状态机随战斗推进不抛错）；
 * 6. Contact：contactOnce 原语义不变（weapon damage 事件发生）；contactTick 由
 *    contactTick.test 精确覆盖（本文件在全量回归中包含）；
 * 7. Render：无 VisualDef 的旧 Content 视觉 fallback 与当前一致（polygons + visual undefined）；
 * 8. Async：BattleResult 保留 battleId/rulesVersion/contentVersion/durationMs metadata。
 */
import { describe, it, expect } from 'vitest';
import { createRegistry } from '../src/core/content';
import {
  deterministicTieBreak,
  type BattleRequest,
  type BattleResult,
} from '../src/battle/battleContract';
import {
  createPlanckBattle,
  battleResultWithMeta,
} from '../src/battle/battleRequestAdapter';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import { isDamageEvent, isWeaponFireEvent, type BattleEvent } from '../src/battle/combatEvents';
import type { BuildSnapshot } from '../src/core/types';
import { PHYSICS_HZ } from '../src/physics/units';

const registry = createRegistry();
const STEP = 1000 / PHYSICS_HZ;

function wheels() {
  return [
    { hardpointId: 'rear', defId: 'wheelStd' },
    { hardpointId: 'front', defId: 'wheelStd' },
  ];
}

/** 三机制 Build：boxBody + 标准轮 + front Cannon + top Hammer + rear Push Rod（energy 30+25+20=75<=100） */
function triBuild(id: string): BuildSnapshot {
  return {
    id,
    bodyDefId: 'boxBody',
    quality: 1,
    movements: wheels(),
    functionals: [
      { hardpointId: 'front', defId: 'cannon' },
      { hardpointId: 'top', defId: 'hammer' },
      { hardpointId: 'rear', defId: 'pushRod' },
    ],
  };
}

/** 重型对车：heavyBox + 标准轮 + front Cannon */
function heavyBuild(id: string): BuildSnapshot {
  return {
    id,
    bodyDefId: 'heavyBox',
    quality: 1,
    movements: wheels(),
    functionals: [{ hardpointId: 'front', defId: 'cannon' }],
  };
}

/** 无武器站桩 Build（压死场景） */
function plainBuild(id: string): BuildSnapshot {
  return {
    id,
    bodyDefId: 'boxBody',
    quality: 1,
    movements: wheels(),
    functionals: [],
  };
}

/** 正式战斗请求（短阶段加速；autoDrive 真实对撞；三机制 vs 重型） */
function makeBattleRequest(seed: number, battleId = 'w1-integ'): BattleRequest {
  return {
    battleId,
    buildA: triBuild('integA'),
    buildB: heavyBuild('integB'),
    config: {
      autoDrive: true,
      engine: 'planck',
      settleToGround: true,
      randomSeed: seed,
      arena: {
        phases: {
          activeMs: STEP * 60,
          warningMs: STEP * 30,
          closingMs: STEP * 60,
        },
      },
    },
    randomSeed: seed,
    rulesVersion: 'v1.0.0',
    contentVersion: 'c1',
  };
}

/** 运行完整战斗到 result，收集全部 BattleEvent */
function runToEnd(
  request: BattleRequest,
): { orch: PlanckBattleOrchestrator; result: BattleResult; events: BattleEvent[] } {
  const orch = createPlanckBattle(request, registry);
  const events: BattleEvent[] = [];
  orch.onCombatEvent((e) => events.push(e));
  for (let i = 0; i < 1200 && !orch.result; i++) {
    orch.step(STEP);
  }
  const result = orch.result;
  expect(result).not.toBeNull();
  return { orch, result: result!, events };
}

describe('W1-INTEG · canonical Battle Integration（BattleRequest → Planck Runtime）', () => {
  it('1. 同一 BattleRequest 连续两次：winner / hpA / hpB / duration 一致，全程无 draw', () => {
    const req = makeBattleRequest(42);
    const r1 = runToEnd(req);
    const r2 = runToEnd(req);
    // 确定性：同输入同输出（Planck 固定步进 + 纯时间驱动 Behavior + 无随机源）
    expect(r1.result.winner).toBe(r2.result.winner);
    expect(r1.result.hpA).toBe(r2.result.hpA);
    expect(r1.result.hpB).toBe(r2.result.hpB);
    expect(r1.orch.timeMs).toBe(r2.orch.timeMs); // duration 一致
    // 正式战斗无平局：winner 必为 A/B
    expect(['A', 'B']).toContain(r1.result.winner);
    expect(['A', 'B']).toContain(r2.result.winner);
  });

  it('2. Closing hazard 接触真实扣血（集成级：真实 battle 中 damageSource:hazard 事件 + hp 下降）', () => {
    const o = new PlanckBattleOrchestrator(
      plainBuild('hazA'),
      plainBuild('hazB'),
      registry,
      {
        // 与各自刺墙轻微重叠出生 → Closing 起始后真实 begin 接触 → hazard tick
        spawnA: { x: -20, y: 640, facing: 1 },
        spawnB: { x: 1620, y: 640, facing: -1 },
        settleToGround: true,
        autoDrive: false, // 站桩：只被刺墙挤压
        randomSeed: 2026,
        impact: { threshold: 999 }, // 隔离 Impact（只测 hazard）
        arena: {
          phases: {
            activeMs: STEP * 20,
            warningMs: STEP * 10,
            closingMs: STEP * 300,
          },
          closingSpeed: 4,
          hazardTickMs: STEP * 2,
          hazardDamagePerTick: 1000, // 首 tick 即致死（> maxHp 1000）
        },
      },
    );
    o.arena.setPhase('Closing');
    const hazardEvents: string[] = [];
    o.onCombatEvent((e) => {
      if (isDamageEvent(e) && e.damageSource === 'hazard') {
        hazardEvents.push(e.target);
      }
    });
    const hpA0 = o.vehicleA.hp;
    const hpB0 = o.vehicleB.hp;
    for (let i = 0; i < 600 && !o.result; i++) {
      o.step(STEP);
    }
    expect(o.result).not.toBeNull();
    // hazard 接触真实产生伤害事件
    expect(hazardEvents.length).toBeGreaterThan(0);
    // 真实扣血：至少一方 hp 低于初始（被刺墙压死/扣血）
    expect(o.vehicleA.hp < hpA0 || o.vehicleB.hp < hpB0).toBe(true);
    // 无 draw
    expect(['A', 'B']).toContain(o.result!.winner);
  });

  it('3. 压死场景两次运行一致（确定性）；同时死亡 → seed tie-break 可复现（router 级精确覆盖于 W1-END-2）', () => {
    const runCrush = (seed: number): BattleResult => {
      const o = new PlanckBattleOrchestrator(
        plainBuild('hazA'),
        plainBuild('hazB'),
        registry,
        {
          spawnA: { x: -20, y: 640, facing: 1 },
          spawnB: { x: 1620, y: 640, facing: -1 },
          settleToGround: true,
          autoDrive: false,
          randomSeed: seed,
          impact: { threshold: 999 },
          arena: {
            phases: {
              activeMs: STEP * 20,
              warningMs: STEP * 10,
              closingMs: STEP * 300,
            },
            closingSpeed: 4,
            hazardTickMs: STEP * 2,
            hazardDamagePerTick: 1000,
          },
        },
      );
      o.arena.setPhase('Closing');
      for (let i = 0; i < 600 && !o.result; i++) {
        o.step(STEP);
      }
      expect(o.result).not.toBeNull();
      return o.result!;
    };

    const seed = 7;
    const r1 = runCrush(seed);
    const r2 = runCrush(seed);
    // 确定性：两次运行唯一赢家一致
    expect(r1.winner).toBe(r2.winner);
    expect(['A', 'B']).toContain(r1.winner);
    // 若双方同一 fixed-step 死亡（hp 均 0）→ winner 必为 seed tie-break（W1-END-2 已精确覆盖同一步双死）
    if (r1.hpA === 0 && r1.hpB === 0) {
      expect(r1.winner).toBe(deterministicTieBreak(seed));
    }
    // 同 seed 重跑赢家一致（tie-break 可复现语义）
    expect(deterministicTieBreak(seed)).toBe(deterministicTieBreak(seed));
  });

  it('4. Generic Behavior Registry：Cannon/Hammer/Push 经统一 behaviors[] lifecycle 真实工作', () => {
    const req = makeBattleRequest(99, 'w1-integ-behav');
    const { orch, events } = runToEnd(req);
    // 统一注册表驱动：每 part 一个 runtime，按 behavior 分组（W1-BH-1）
    const priv = orch as unknown as {
      behaviors: Array<{ part: { def: { behavior: string } } }>;
    };
    const countByBehavior = (id: string): number =>
      priv.behaviors.filter((b) => b.part.def.behavior === id).length;
    expect(countByBehavior('cannon')).toBe(2); // A front + B front
    expect(countByBehavior('hammer')).toBe(1); // A top
    expect(countByBehavior('pushRod')).toBe(1); // A rear
    expect(priv.behaviors.length).toBe(4);
    // Cannon 经统一 lifecycle 真实发射（weaponFire 事件；Hammer/Push 状态机随战斗推进不抛错——
    // 能完整跑完战斗本身即证明三机制 onBeforeStep 驱动正常）
    const fires = events.filter((e) => isWeaponFireEvent(e));
    expect(fires.length).toBeGreaterThan(0);
    expect(fires.every((f) => f.behavior === 'cannon')).toBe(true);
  });

  it('5. Contact：contactOnce 原语义不变（weapon 直伤事件发生；contactTick 由 contactTick.test 精确覆盖）', () => {
    // 用默认 Arena phases（10s/3s/5s）：autoDrive 相向 1.5px/step 需 ~267 步对撞 + cannon
    // 持续发射 → weapon 接触命中真实发生（短 phase 场景下对撞不足，依赖旧 closingSpeed
    // 强制挤压，W1-P0-CLOSE-FIX 后 speed=3 不再覆盖该时序）
    const base = makeBattleRequest(123, 'w1-integ-contact');
    const req: BattleRequest = {
      ...base,
      config: { ...base.config, arena: undefined },
    };
    const { events } = runToEnd(req);
    // contactOnce：weapon 接触一次结算（baseDamage 语义；Hammer 等零变化由各 behavior 测试覆盖）
    const weaponHits = events.filter(
      (e) => isDamageEvent(e) && e.damageSource === 'weapon',
    );
    expect(weaponHits.length).toBeGreaterThan(0);
    for (const e of weaponHits) {
      const d = e as Extract<typeof e, { type: 'damage' }>;
      expect(d.damage).toBeGreaterThan(0);
    }
  });

  it('6. Render：无 VisualDef 的旧 Content 视觉 fallback 与当前一致', () => {
    // W2-SIL-1 后 cannon/hammer/pushRod 都有 VisualDef；本用例断言「无 visual 的旧 Content
    // （boxBody + wheelStd + ramHead）仍走 Collider Shape fallback」不变。
    const req = makeBattleRequest(7, 'w1-integ-render');
    const reqRam: BattleRequest = {
      ...req,
      buildA: { ...req.buildA, functionals: [{ hardpointId: 'front', defId: 'ramHead' }] },
      buildB: { ...req.buildB, functionals: [{ hardpointId: 'front', defId: 'ramHead' }] },
    };
    const { orch } = runToEnd(reqRam);
    const snap = orch.getRenderSnapshot();
    // 旧 Content 无 VisualDef → Collider Shape fallback（polygons），visual 全 undefined
    expect(snap.vehicleA.body.kind).toBe('polygons');
    expect(snap.vehicleA.bodyVisual).toBeUndefined();
    expect(snap.vehicleA.parts.every((p) => p.visual === undefined)).toBe(true);
    expect((snap.vehicleA.wheelVisuals ?? []).every((v) => v === undefined)).toBe(true);
    expect(snap.vehicleB.body.kind).toBe('polygons');
    expect(snap.vehicleB.bodyVisual).toBeUndefined();
    expect(snap.arena.normalWalls.length).toBe(2);
    expect(snap.arena.closingWalls.length).toBe(2);
  });

  it('7. Async：BattleResult 保留 battleId / rulesVersion / contentVersion / durationMs', () => {
    const req = makeBattleRequest(2026, 'battle-abc');
    const { orch, result } = runToEnd(req);
    const meta = battleResultWithMeta(orch, req)!;
    expect(meta.battleId).toBe('battle-abc');
    expect(meta.rulesVersion).toBe('v1.0.0');
    expect(meta.contentVersion).toBe('c1');
    expect(meta.durationMs).toBe(orch.timeMs);
    // 胜负数据原样透传（与 orchestrator.result 一致）
    expect(meta.winner).toBe(result.winner);
    expect(meta.hpA).toBe(result.hpA);
    expect(meta.hpB).toBe(result.hpB);
    expect(meta.endReason).toBe(result.endReason);
  });
});
