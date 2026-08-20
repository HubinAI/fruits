/**
 * F-02M-B17A-A1 · Planck Battle Orchestrator 最小驱动闭环测试。
 *
 * 本轮只覆盖（不进入 A2）：
 * 1. Orchestrator 能构造且贴地后无明显穿透；
 * 2. 首次有效固定步后，wheel-ground begin 使轮子 grounded=true；
 * 3. autoDrive 下 A 向 +X、B 向 -X 移动；
 * 4. 禁用 autoDrive 时车辆不主动推进；
 * 5. 无 NaN/Infinity。
 *
 * 不覆盖：relativeVelocity 符号与伤害区间、重复伤害、Active→Warning→Closing→End 全阶段。
 */
import { describe, it, expect } from 'vitest';
import type { BuildSnapshot, BattlePhase } from '../src/core/types';
import { createRegistry } from '../src/core/content';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import type { BattleResult } from '../src/battle/battleContract';
import { deterministicTieBreak } from '../src/battle/battleContract';
import type { ContactBridgeEvent } from '../src/physics/planckWorld';
import { isDamageEvent, type BattleEvent } from '../src/battle/combatEvents';
import { PHYSICS_HZ } from '../src/physics/units';

const registry = createRegistry();

/** boxBody + wheelStd×2（rear/front）的双轮 snapshot */
function twoWheelBuild(id: string): BuildSnapshot {
  return {
    id,
    bodyDefId: 'boxBody',
    quality: 1,
    movements: [
      { hardpointId: 'rear', defId: 'wheelStd' },
      { hardpointId: 'front', defId: 'wheelStd' },
    ],
    functionals: [],
  };
}

interface MakeOpts {
  autoDrive?: boolean;
}

function makeOrchestrator(opts: MakeOpts = {}): PlanckBattleOrchestrator {
  return new PlanckBattleOrchestrator(
    twoWheelBuild('buildA'),
    twoWheelBuild('buildB'),
    registry,
    {
      spawnA: { x: 400, y: 640, facing: 1 },
      spawnB: { x: 1200, y: 640, facing: -1 },
      settleToGround: true,
      autoDrive: opts.autoDrive, // undefined → Matter 默认（开启）
    },
  );
}

/** 所有车辆 body / wheel / part 位置均有限 */
function assertAllFinite(o: PlanckBattleOrchestrator): void {
  for (const v of [o.vehicleA, o.vehicleB]) {
    const pos = o.world.getPosition(v.body);
    expect(Number.isFinite(pos.x) && Number.isFinite(pos.y)).toBe(true);
    for (const w of v.wheels) {
      const wp = o.world.getPosition(w.body);
      expect(Number.isFinite(wp.x) && Number.isFinite(wp.y)).toBe(true);
    }
    for (const p of v.parts) {
      const pp = o.world.getPosition(p.body);
      expect(Number.isFinite(pp.x) && Number.isFinite(pp.y)).toBe(true);
    }
  }
}

// ---- F-02M-B17A-A2D 诊断辅助 ----

/** A 带 ramHead 武器；B body-only（无 functionals） */
function weaponBuild(id: string): BuildSnapshot {
  return {
    id,
    bodyDefId: 'boxBody',
    quality: 1,
    movements: [
      { hardpointId: 'rear', defId: 'wheelStd' },
      { hardpointId: 'front', defId: 'wheelStd' },
    ],
    functionals: [{ hardpointId: 'front', defId: 'ramHead' }],
  };
}

/** 双方 body-only（无 functionals、无武器） */
function bodyOnlyBuild(id: string): BuildSnapshot {
  return {
    id,
    bodyDefId: 'boxBody',
    quality: 1,
    movements: [
      { hardpointId: 'rear', defId: 'wheelStd' },
      { hardpointId: 'front', defId: 'wheelStd' },
    ],
    functionals: [],
  };
}

interface RawPair {
  a: string;
  b: string;
  phase: string;
  relVel: number;
  hostile: boolean;
}

interface HostileBatchReport {
  timestamp: number;
  size: number;
  pairs: RawPair[];
  hostilePairs: RawPair[];
  hostileMax: number;
}

/**
 * 安装诊断探针：订阅 CombatEventBus 收集 Damage 事件；
 * 并将「orchestrator 构造时注册的同一 batched listener 行为」原样保留——
 * 仅额外记录真实桥接事件（不伪造任何事件），再转发给同一 ContactRouter。
 * 用途：回传 per-pair 接触细节（partIdA→partIdB / phase / relativeVelocity）。
 */
function installSpy(o: PlanckBattleOrchestrator): {
  rawEvents: ContactBridgeEvent[];
  damageEvents: BattleEvent[];
} {
  const rawEvents: ContactBridgeEvent[] = [];
  const damageEvents: BattleEvent[] = [];
  o.onCombatEvent((ev) => damageEvents.push(ev));
  const forward = (ev: ContactBridgeEvent): void =>
    o.router.handlePlanckContact(o.world, ev);
  o.world.setBatchedContactListener((ev) => {
    rawEvents.push(ev);
    forward(ev);
  });
  return { rawEvents, damageEvents };
}

function describeBatch(
  o: PlanckBattleOrchestrator,
  ts: number,
  rawEvents: ContactBridgeEvent[],
): HostileBatchReport {
  const evs = rawEvents.filter((e) => e.batch && e.batch.timestamp === ts);
  const pairs: RawPair[] = evs.map((e) => {
    const tA = o.world.getOwnerTag(e.bodyA);
    const tB = o.world.getOwnerTag(e.bodyB);
    const hostile = !!(
      tA &&
      tB &&
      tA.kind === 'vehicle' &&
      tB.kind === 'vehicle' &&
      tA.team !== tB.team
    );
    return {
      a: `${tA?.team ?? '?'}/${tA?.partId ?? '?'}`,
      b: `${tB?.team ?? '?'}/${tB?.partId ?? '?'}`,
      phase: e.phase,
      relVel: e.relativeVelocity,
      hostile,
    };
  });
  const hostilePairs = pairs.filter((p) => p.hostile);
  const hostileMax = hostilePairs.length
    ? Math.max(...hostilePairs.map((p) => p.relVel))
    : 0;
  const size = evs.filter((e) => e.phase === 'begin').length;
  return { timestamp: ts, size, pairs, hostilePairs, hostileMax };
}

function findFirstHostileBatch(
  o: PlanckBattleOrchestrator,
  rawEvents: ContactBridgeEvent[],
): HostileBatchReport | null {
  for (const e of rawEvents) {
    if (e.batch && e.phase === 'begin') {
      const tA = o.world.getOwnerTag(e.bodyA);
      const tB = o.world.getOwnerTag(e.bodyB);
      if (
        tA &&
        tB &&
        tA.kind === 'vehicle' &&
        tB.kind === 'vehicle' &&
        tA.team !== tB.team
      ) {
        return describeBatch(o, e.batch.timestamp, rawEvents);
      }
    }
  }
  return null;
}

describe('F-02M-B17A-A1 · Planck Battle Orchestrator 最小驱动闭环', () => {
  it('1. 构造且贴地后无明显穿透', () => {
    const o = makeOrchestrator();
    const groundTop = o.arena.config.groundY; // 700

    // 构造后：全部有限；轮子碰撞底（maxY）≈ groundTop（穿透 < 1px）。
    // 注意：getCollisionBounds 的 minY 是轮子顶部、maxY 是轮子底部；
    // 穿透 = 轮子底部 − groundTop，必须用 maxY 判定。
    assertAllFinite(o);
    for (const v of [o.vehicleA, o.vehicleB]) {
      for (const w of v.wheels) {
        const bb = o.world.getCollisionBounds(w.body);
        expect(bb.maxY).toBeGreaterThanOrEqual(groundTop - 1);
        expect(bb.maxY).toBeLessThanOrEqual(groundTop + 1);
      }
    }

    // 步进 60 步后无爆炸：仍有限、穿透有界（< 3px）
    for (let i = 0; i < 60; i++) o.step(1000 / 60);
    assertAllFinite(o);
    for (const v of [o.vehicleA, o.vehicleB]) {
      for (const w of v.wheels) {
        const bb = o.world.getCollisionBounds(w.body);
        expect(bb.maxY).toBeLessThanOrEqual(groundTop + 3);
      }
    }
    console.log(
      `[A1-1] groundTop=${groundTop} 构造+60步后无穿透/爆炸 OK`,
    );
  });

  it('2. 首次有效固定步后轮子 grounded=true', () => {
    const o = makeOrchestrator();

    // 构造后尚未步进：grounded 初始 false
    expect(o.vehicleA.wheels.every((w) => w.grounded === false)).toBe(true);
    expect(o.vehicleB.wheels.every((w) => w.grounded === false)).toBe(true);

    // 一次有效固定步：onBeforeStep 驱动（grounded 仍 false）→ world.step
    // → flush 触发 begin → ContactRouter.handlePlanckContact 置 grounded=true
    o.step(1000 / 60);
    expect(o.vehicleA.wheels.every((w) => w.grounded === true)).toBe(true);
    expect(o.vehicleB.wheels.every((w) => w.grounded === true)).toBe(true);
    console.log(
      `[A1-2] 首次固定步后 A/B 全部轮子 grounded=true OK`,
    );
  });

  it('3. autoDrive 下 A 向 +X、B 向 -X 移动', () => {
    const o = makeOrchestrator(); // autoDrive 默认开启
    const ax0 = o.world.getPosition(o.vehicleA.body).x;
    const bx0 = o.world.getPosition(o.vehicleB.body).x;

    for (let i = 0; i < 120; i++) o.step(1000 / 60);

    const ax1 = o.world.getPosition(o.vehicleA.body).x;
    const bx1 = o.world.getPosition(o.vehicleB.body).x;
    const dA = ax1 - ax0;
    const dB = bx1 - bx0;

    expect(dA).toBeGreaterThan(5); // A 明显向 +X
    expect(dB).toBeLessThan(-5); // B 明显向 -X
    console.log(
      `[A1-3] autoDrive: A dx=${dA.toFixed(2)} (>0) B dx=${dB.toFixed(2)} (<0) OK`,
    );
  });

  it('4. 禁用 autoDrive 时车辆不主动推进', () => {
    const o = makeOrchestrator({ autoDrive: false });
    const ax0 = o.world.getPosition(o.vehicleA.body).x;
    const bx0 = o.world.getPosition(o.vehicleB.body).x;

    for (let i = 0; i < 120; i++) o.step(1000 / 60);

    const ax1 = o.world.getPosition(o.vehicleA.body).x;
    const bx1 = o.world.getPosition(o.vehicleB.body).x;
    const dA = ax1 - ax0;
    const dB = bx1 - bx0;

    // 无主动驱动：仅重力静止，不出现有意义的水平位移（< 0.05px）
    expect(Math.abs(dA)).toBeLessThan(0.05);
    expect(Math.abs(dB)).toBeLessThan(0.05);
    console.log(
      `[A1-4] autoDrive=false: A dx=${dA.toFixed(6)} B dx=${dB.toFixed(6)}（无推进）OK`,
    );
  });

  it('5. 无 NaN/Infinity（构造 + 多步步进后）', () => {
    const o = makeOrchestrator();
    for (let i = 0; i < 200; i++) o.step(1000 / 60);

    assertAllFinite(o);
    // 速度分量也有限
    for (const v of [o.vehicleA, o.vehicleB]) {
      const lv = o.world.getLinearVelocity(v.body);
      const av = o.world.getAngularVelocity(v.body);
      expect(Number.isFinite(lv.x) && Number.isFinite(lv.y) && Number.isFinite(av)).toBe(true);
      expect(Number.isFinite(v.com.x) && Number.isFinite(v.com.y)).toBe(true);
    }
    console.log(
      `[A1-5] 200 步后位置/速度/COM 全部有限 OK`,
    );
  });

  it('6. Weapon 隔离：ramHead→B 仅扣血一次且恰好 80（无重复 / 无 Impact）', () => {
    const o = new PlanckBattleOrchestrator(
      weaponBuild('A'),
      bodyOnlyBuild('B'),
      registry,
      {
        spawnA: { x: 400, y: 640, facing: 1 },
        spawnB: { x: 1200, y: 640, facing: -1 },
        settleToGround: true,
        autoDrive: true,
        impact: { threshold: 999 }, // 隔离 Weapon：Impact 阈值拉到 999，不触发 Impact
      },
    );
    const spy = installSpy(o);
    const hpABefore = o.vehicleA.hp; // 1000
    const hpBBefore = o.vehicleB.hp; // 1000

    let batch: HostileBatchReport | null = null;
    for (let i = 0; i < 1500 && !batch; i++) {
      o.step(1000 / 60);
      batch = findFirstHostileBatch(o, spy.rawEvents);
    }
    expect(batch).not.toBeNull();
    const b = batch as HostileBatchReport;

    const weaponEvents = spy.damageEvents.filter((e): e is import('../src/battle/combatEvents').DamageEvent => isDamageEvent(e) && e.damageSource === 'weapon');
    const impactEvents = spy.damageEvents.filter((e): e is import('../src/battle/combatEvents').DamageEvent => isDamageEvent(e) && e.damageSource === 'impact');

    // 实测数据回传（A2D 必须回传项）
    console.log(`[A2D-W1] firstHostileBatch ts=${b.timestamp} size=${b.size}`);
    for (const p of b.pairs) {
      console.log(
        `  pair ${p.a} -> ${p.b} phase=${p.phase} relVel=${p.relVel.toFixed(4)} hostile=${p.hostile}`,
      );
    }
    console.log(`[A2D-W1] hostileMaxRelVel=${b.hostileMax.toFixed(4)}`);
    console.log(
      `[A2D-W1] hpA ${hpABefore} -> ${o.vehicleA.hp}; hpB ${hpBBefore} -> ${o.vehicleB.hp}`,
    );
    console.log(
      `[A2D-W1] damageEvents=${spy.damageEvents.length} weapon=${weaponEvents.length} impact=${impactEvents.length}`,
    );
    console.log(
      `[A2D-W1] lastDamage=${JSON.stringify(o.router.debug.lastDamage)} lastImpact=${JSON.stringify(o.router.debug.lastImpact)}`,
    );

    // 断言
    expect(b.hostileMax).toBeGreaterThan(0.5); // 首敌 batch 最大 closing relVel > 0.5
    expect(hpBBefore).toBe(1000);
    expect(o.vehicleB.hp).toBe(920); // 恰好扣 80
    expect(spy.damageEvents.length).toBe(1); // Damage 事件恰好 1 条
    expect(weaponEvents.length).toBe(1);
    expect(weaponEvents[0].target).toBe('B');
    expect(weaponEvents[0].damage).toBe(80);
    expect(weaponEvents[0].partId).toBe('ramHead');
    expect(impactEvents.length).toBe(0); // 无 Impact
    expect(o.vehicleA.hp).toBe(1000); // A 不受伤（B body-only）
    expect(o.router.debug.lastDamage?.damage).toBe(80);
    expect(o.router.debug.lastDamage?.target).toBe('B');
    expect(o.router.debug.lastImpact).toBeNull();
  });

  it('7. Impact 隔离：body-only 双方仅结算一次 Impact，lastImpact.relVel=批次最大', () => {
    const o = new PlanckBattleOrchestrator(
      bodyOnlyBuild('A'),
      bodyOnlyBuild('B'),
      registry,
      {
        spawnA: { x: 400, y: 640, facing: 1 },
        spawnB: { x: 1200, y: 640, facing: -1 },
        settleToGround: true,
        autoDrive: true,
        impact: { threshold: 0.75 }, // 正式 Impact 阈值
      },
    );
    const spy = installSpy(o);
    const hpABefore = o.vehicleA.hp; // 1000
    const hpBBefore = o.vehicleB.hp; // 1000

    let batch: HostileBatchReport | null = null;
    for (let i = 0; i < 1500 && !batch; i++) {
      o.step(1000 / 60);
      batch = findFirstHostileBatch(o, spy.rawEvents);
    }
    expect(batch).not.toBeNull();
    const b = batch as HostileBatchReport;

    const impactEvents = spy.damageEvents.filter((e): e is import('../src/battle/combatEvents').DamageEvent => isDamageEvent(e) && e.damageSource === 'impact');
    const weaponEvents = spy.damageEvents.filter((e): e is import('../src/battle/combatEvents').DamageEvent => isDamageEvent(e) && e.damageSource === 'weapon');

    // 现有公式：total = min(120, max(0, (R - 0.75) * 0.5))；每方 = total/2
    const expectedTotal = Math.min(120, Math.max(0, (b.hostileMax - 0.75) * 0.5));
    const expectedPerSide = expectedTotal / 2;

    console.log(`[A2D-I1] firstHostileBatch ts=${b.timestamp} size=${b.size}`);
    for (const p of b.pairs) {
      console.log(
        `  pair ${p.a} -> ${p.b} phase=${p.phase} relVel=${p.relVel.toFixed(4)} hostile=${p.hostile}`,
      );
    }
    console.log(`[A2D-I1] hostileMaxRelVel=${b.hostileMax.toFixed(4)}`);
    console.log(
      `[A2D-I1] hpA ${hpABefore} -> ${o.vehicleA.hp}; hpB ${hpBBefore} -> ${o.vehicleB.hp}`,
    );
    console.log(
      `[A2D-I1] damageEvents=${spy.damageEvents.length} impact=${impactEvents.length} weapon=${weaponEvents.length}`,
    );
    console.log(
      `[A2D-I1] lastImpact=${JSON.stringify(o.router.debug.lastImpact)} lastDamage=${JSON.stringify(o.router.debug.lastDamage)}`,
    );

    // 断言
    expect(b.hostileMax).toBeGreaterThan(0.75); // batch 最大 closing relVel > 0.75
    expect(weaponEvents.length).toBe(0); // 无 Weapon
    expect(impactEvents.length).toBe(2); // Impact 仅结算一次 → A/B 各一条
    expect(o.router.debug.lastImpact).not.toBeNull();
    expect(o.router.debug.lastImpact!.relativeVelocity).toBeCloseTo(b.hostileMax, 6);
    expect(o.vehicleA.hp).toBeCloseTo(hpABefore - expectedPerSide, 6);
    expect(o.vehicleB.hp).toBeCloseTo(hpBBefore - expectedPerSide, 6);

    const impactTargets = impactEvents
      .map((e) => `${e.target}:${e.damage.toFixed(4)}`)
      .sort();
    console.log(`[A2D-I1] impactTargets=${impactTargets.join(', ')}`);
  });

  it('8. 完整阶段时钟闭环：Active→Warning→Closing→End，单次最多跨一阶段', () => {
    const STEP = 1000 / PHYSICS_HZ; // 固定步（ms），整数倍阶段时长
    const o = new PlanckBattleOrchestrator(
      twoWheelBuild('A'),
      twoWheelBuild('B'),
      registry,
      {
        spawnA: { x: 400, y: 640, facing: 1 },
        spawnB: { x: 1200, y: 640, facing: -1 },
        settleToGround: true,
        autoDrive: false, // 关闭驱动，避免碰撞/伤害干扰阶段时钟
        arena: {
          phases: {
            // 较短且为固定步整数倍：Active=60步 / Warning=30步 / Closing=60步
            activeMs: STEP * 60,
            warningMs: STEP * 30,
            closingMs: STEP * 60,
          },
          // 关闭刺墙推进（closingSpeed=0）：阶段时钟为纯时间驱动，与墙速无关；
          // 隔离阶段闭环免受 Closing 刺墙 hazard 伤害干扰（符合「避免伤害干扰」意图）。
          closingSpeed: 0,
        },
      },
    );

    const CANON: BattlePhase[] = ['Active', 'Warning', 'Closing', 'End'];
    interface Row {
      call: number;
      phase: string;
      timeMs: number;
      result: BattleResult | null;
    }
    const log: Row[] = [];
    let endCall = -1;
    for (let i = 1; i <= 200; i++) {
      o.step(STEP); // 每次只推进一个固定步
      const phase = o.phase;
      const result = o.result;
      log.push({ call: i, phase, timeMs: o.timeMs, result });
      if (phase === 'End') {
        endCall = i;
        break;
      }
    }

    // 顺序严格为 Active → Warning → Closing → End（无跳过/乱序/多余）
    const seen: string[] = [];
    for (const row of log) {
      if (seen.length === 0 || seen[seen.length - 1] !== row.phase) {
        seen.push(row.phase);
      }
    }
    expect(seen).toEqual(['Active', 'Warning', 'Closing', 'End']);

    // 单次 step 最多跨一个阶段：相邻不同 phase 必为 CANON 的相邻后继
    for (let i = 1; i < log.length; i++) {
      if (log[i].phase !== log[i - 1].phase) {
        const prevIdx = CANON.indexOf(log[i - 1].phase as BattlePhase);
        const curIdx = CANON.indexOf(log[i].phase as BattlePhase);
        expect(curIdx).toBe(prevIdx + 1);
      }
    }

    // End 前 result 始终为 null；首次进入 End 时 result 非空
    const firstEnd = log.findIndex((r) => r.phase === 'End');
    expect(firstEnd).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < firstEnd; i++) {
      expect(log[i].result).toBeNull();
    }
    expect(log[firstEnd].result).not.toBeNull();

    // W1-END-1：双方 HP 未变化（同 HP）→ deterministicTieBreak(seed 缺省 0) 兜底，
    // 必为 A 或 B（正式战斗无平局）；result.phase=End、endReason=arenaEnd，hpA/hpB 保留原值
    const r = log[firstEnd].result as BattleResult;
    expect(['A', 'B']).toContain(r.winner);
    expect(r.winner).toBe(deterministicTieBreak(0));
    expect(r.phase).toBe('End');
    expect(r.endReason).toBe('arenaEnd');
    expect(o.vehicleA.hp).toBe(1000);
    expect(o.vehicleB.hp).toBe(1000);
    expect(r.hpA).toBe(1000);
    expect(r.hpB).toBe(1000);

    // 回传：阶段变化表（phase 变化的行）+ 首次 End 完整 BattleResult
    const changes = log.filter(
      (row, idx) => idx === 0 || row.phase !== log[idx - 1].phase,
    );
    console.log(
      `[A3-8] STEP=${STEP.toFixed(4)} endCall=${endCall} totalActiveStepsToEnd=${endCall}`,
    );
    for (const row of changes) {
      console.log(
        `  call=${row.call} phase=${row.phase} timeMs=${row.timeMs.toFixed(2)} result=${row.result ? JSON.stringify(row.result) : 'null'}`,
      );
    }
    console.log(`[A3-8] firstEndResult=${JSON.stringify(r)}`);
  });

  it('9. KO 结果与 End 后稳定性（B.hp=0 → A 胜；再 step 10 次数据不变）', () => {
    const STEP = 1000 / PHYSICS_HZ;
    const o = new PlanckBattleOrchestrator(
      twoWheelBuild('A'),
      twoWheelBuild('B'),
      registry,
      {
        spawnA: { x: 400, y: 640, facing: 1 },
        spawnB: { x: 1200, y: 640, facing: -1 },
        settleToGround: true,
        autoDrive: false, // 关闭驱动，避免碰撞把双方 HP 打没
      },
    );

    const hpA0 = o.vehicleA.hp; // 1000（原值）
    const hpB0 = o.vehicleB.hp; // 1000
    // 仅将 B.hp 设为 0，保持 A 原值
    o.vehicleB.hp = 0;

    let damageCount = 0;
    o.onCombatEvent((ev) => {
      if (isDamageEvent(ev)) damageCount++; // 仅统计伤害事件
    });

    // 通过一次正常 orchestrator.step() 触发结算
    o.step(STEP);

    const r = o.result;
    expect(r).not.toBeNull();
    expect(r!.winner).toBe('A');
    expect(r!.phase).toBe('End');
    expect(r!.hpA).toBe(hpA0);
    expect(r!.hpB).toBe(0);

    // 快照：result / 双方 HP / 位置 / Damage 事件数
    const snap = {
      result: JSON.parse(JSON.stringify(r)),
      hpA: o.vehicleA.hp,
      hpB: o.vehicleB.hp,
      posA: { ...o.world.getPosition(o.vehicleA.body) },
      posB: { ...o.world.getPosition(o.vehicleB.body) },
      damageCount,
    };

    // End 后调用 step() 10 次
    for (let i = 0; i < 10; i++) o.step(STEP);

    // 验证：上述数据全部不变，不新增伤害事件
    expect(o.result).toEqual(snap.result);
    expect(o.vehicleA.hp).toBe(snap.hpA);
    expect(o.vehicleB.hp).toBe(snap.hpB);
    expect(o.world.getPosition(o.vehicleA.body)).toEqual(snap.posA);
    expect(o.world.getPosition(o.vehicleB.body)).toEqual(snap.posB);
    expect(damageCount).toBe(snap.damageCount);

    // 回传
    console.log(
      `[A3-9] firstEndResult=${JSON.stringify(r)} hpA0=${hpA0} hpB0=${hpB0}`,
    );
    console.log(
      `[A3-9] snap posA=${JSON.stringify(snap.posA)} posB=${JSON.stringify(snap.posB)} damage=${snap.damageCount}`,
    );
    console.log(
      `[A3-9] after10steps hpA=${o.vehicleA.hp} hpB=${o.vehicleB.hp} damage=${damageCount} resultUnchanged=${JSON.stringify(o.result) === JSON.stringify(snap.result)}`,
    );
  });
});
