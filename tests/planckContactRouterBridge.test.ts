/**
 * Queue F-02M-B5A｜ContactRouter 接入 Planck Contact（保留不回删）
 *
 * 真实 Planck 碰撞作为事件来源，正式 ContactRouter / DamageResolver 作为结果端：
 * 1. 同一 ram 部件接触敌车只结算一次 baseDamage=80（batch 去重生效）；
 * 2. Impact 用高测试阈值（999）隔离，确认 Weapon 路径独立结算；
 * 3. wheel→ground begin 令 grounded=true、end 令 grounded=false；
 * 4. batch / 接触点 / 法线 / relativeVelocity 进入 Router Debug。
 *
 * 注意：Router 的 vehicles 来自正式 BattleOrchestrator（Matter 版 Vehicle 数据对象，
 * Router 只消费 team/id/hp/wheels[].id/.grounded/parts[].def，与 Planck 物理 body 无关）。
 */
import { describe, it, expect } from 'vitest';
import { createRegistry } from '../src/core/content';
import type { BuildSnapshot } from '../src/core/types';
import { BattleOrchestrator } from '../src/battle/battleOrchestrator';
import { ContactRouter } from '../src/battle/contactRouter';
import { DamageResolver } from '../src/battle/damageResolver';
import { CombatEventBus } from '../src/battle/combatEvents';
import { getPreset } from '../src/lab/presets';
import type { Vehicle } from '../src/battle/vehicleAssembly';
import { PlanckWorld, type BodyHandle } from '../src/physics/planckWorld';

const registry = createRegistry();
const lightSnapshot = getPreset('lightVehicle')!.build();

function makeOrchestrator(): BattleOrchestrator {
  return new BattleOrchestrator(lightSnapshot, lightSnapshot, registry, {
    autoDrive: true,
    spawnA: { x: 400, y: 640, facing: 1 },
    spawnB: { x: 900, y: 640, facing: -1 },
  });
}

/** 高阈值隔离 Impact（只测 Weapon 路径） */
function makeRouterIsolated(
  orch: BattleOrchestrator,
): ContactRouter {
  return new ContactRouter(
    [orch.vehicleA, orch.vehicleB],
    new DamageResolver(new CombatEventBus()),
    { threshold: 999, damagePerSpeed: 0.5, maxDamage: 120 },
  );
}

/**
 * Planck ram 部件（team A 武器）：20×100 box（高 100 覆盖 B chassis+wheelR 高度）。
 * 平移撞 B 时 ram 右面（竖直）同时接触 B 的 chassis 右面与 wheelR 右缘
 * （两者 x 对齐）→ 同一步两个 begin（真实 Planck 碰撞）。
 */
function buildPlanckRam(world: PlanckWorld, x: number): BodyHandle {
  const ram = world.createDynamicBox(x, 585, 20, 112, 5); // 高 112 [529,641]：覆盖 B chassis[568,608] 与 wheelL 最左点(y=640)
  world.setOwnerTag(ram, { kind: 'vehicle', vehicleId: 'lightVehicle', partId: 'part:front', team: 'A' });
  return ram;
}

/** Planck B 车：body-only 重型 chassis（team B），贴地 spawn，对称撞时不动 */
function buildPlanckB(world: PlanckWorld, x: number): void {
  const chassis = world.createDynamicBox(x, 640, 120, 40, 500);
  world.setOwnerTag(chassis, { kind: 'vehicle', vehicleId: 'lightVehicle', team: 'B' });
}

describe('F-02M-B5A · ContactRouter 接入 Planck Contact', () => {
  it('ram 同一步接触敌车只结算一次 baseDamage=80；Impact 高阈值隔离；Debug 有数据', () => {
    const orch = makeOrchestrator();
    const router = makeRouterIsolated(orch);
    const hpBBefore = orch.vehicleB.hp;

    const world = new PlanckWorld({ x: 0, y: 10 });
    world.createStaticGround(0, 700, 4000, 80);
    // 两个 ram（同一 part:front/team A）对称撞 B（team B）→ 同一物理步两个 begin → 批次去重只结算一次
    const ramL = buildPlanckRam(world, -75); // 右面 -65 vs B 左面 -60（5px 间距）
    const ramR = buildPlanckRam(world, 75); // 左面 65 vs B 右面 60（5px 间距）
    buildPlanckB(world, 0);
    // 批次监听 → Router（单投递，不设即时监听）；同时记录含 ram 的批次 size
    const ramBatches: { ts: number; size: number; pairs: number; detail: string[] }[] = [];
    world.setBatchedContactListener((e) => {
      router.handlePlanckContact(world, e);
      if (e.phase === 'begin' && e.batch) {
        const ta = world.getOwnerTag(e.bodyA);
        const tb = world.getOwnerTag(e.bodyB);
        // 仅记录「ram 对敌车（不同 team）」的批次
        if (ta && tb && ta.team !== tb.team && (ta.partId === 'part:front' || tb.partId === 'part:front')) {
          let found = ramBatches.find((s) => s.ts === e.batch!.timestamp);
          if (!found) {
            found = { ts: e.batch!.timestamp, size: e.batch!.size, pairs: 0, detail: [] };
            ramBatches.push(found);
          }
          found.pairs++;
          found.detail.push(`${ta.partId ?? 'body'}→${tb.partId ?? 'body'}`);
        }
      }
    });
    // 对称平移：ramL 向右、ramR 向左（真实 Planck 碰撞，同一步接触 B 两侧）
    world.setLinearVelocity(ramL, 1, 0);
    world.setLinearVelocity(ramR, -1, 0);

    // 推进到首次出现 ram（part:front）批次完成结算后停止
    let ramBatchSeen = false;
    let steps = 0;
    for (steps = 0; steps < 900 && !ramBatchSeen; steps++) {
      const before = router.debug.lastDamage;
      world.stepFixed(1);
      if (router.debug.lastDamage !== before) {
        ramBatchSeen = true; // Router 已结算（含 ram 的批次完成）
      }
    }
    expect(ramBatchSeen).toBe(true);
    expect(ramBatches.length).toBeGreaterThan(0);
    const first = ramBatches[0]!;
    console.log(
      `[B5A-1] 首次 ram 批次：step=${steps} ts=${first.ts.toFixed(1)} size=${first.size} ramPairs=${first.pairs} ` +
        `pairs=[${first.detail.join(', ')}]  hpB=${orch.vehicleB.hp.toFixed(2)} (前 ${hpBBefore}) 变化=${(hpBBefore - orch.vehicleB.hp).toFixed(2)}`,
    );
    // 同一 ram 同一步接触敌车两个部位（chassis + wheelR，size=2 且两 pair 均含 ram）
    expect(first.size).toBe(2);
    expect(first.pairs).toBe(2);
    // Weapon 只结算一次 baseDamage=80
    expect(hpBBefore - orch.vehicleB.hp).toBe(80);
    // Impact 高阈值（999）隔离：不触发
    expect(router.debug.lastImpact).toBeNull();
    // Debug：batch / 接触点 / 法线 / relativeVelocity 进入
    expect(router.debug.lastContact).not.toBeNull();
    expect(router.debug.lastContact!.point).toEqual(expect.objectContaining({ x: expect.any(Number) }));
    expect(router.debug.lastContact!.normal).toEqual(expect.objectContaining({ x: expect.any(Number) }));
    expect(typeof router.debug.lastContact!.relativeVelocity).toBe('number');
    expect(router.debug.lastDamage?.damage).toBe(80);
    expect(router.debug.lastDamage?.target).toBe(orch.vehicleB.id);
  });

  it('wheel→ground（完整）：ground 带 OwnerTag，begin/end 翻转 grounded', () => {
    const orch = makeOrchestrator();
    const router = new ContactRouter(
      [orch.vehicleA],
      new DamageResolver(new CombatEventBus()),
    );
    const wheelRuntime = orch.vehicleA.wheels.find((w) => w.id === 'front')!;

    const world = new PlanckWorld({ x: 0, y: 10 });
    const ground = world.createStaticGround(0, 700, 4000, 80);
    world.setOwnerTag(ground, { kind: 'ground' });
    const wheel = world.createDynamicCircle(0, 680, 20, 10, { friction: 1 });
    world.setOwnerTag(wheel, { kind: 'vehicle', vehicleId: 'lightVehicle', partId: 'wheel:front', team: 'A' });
    world.setBatchedContactListener((e) => router.handlePlanckContact(world, e));

    // 落下 → begin → grounded=true
    let grounded = false;
    for (let i = 0; i < 300 && !grounded; i++) {
      world.stepFixed(1);
      grounded = wheelRuntime.grounded;
    }
    expect(wheelRuntime.grounded).toBe(true);
    console.log(`[B5A-2] 落地下沉后 grounded=${wheelRuntime.grounded}`);

    // 向上拉开 → end → grounded=false
    world.setLinearVelocity(wheel, 0, -3);
    let lifted = false;
    for (let i = 0; i < 300 && !lifted; i++) {
      world.stepFixed(1);
      lifted = !wheelRuntime.grounded;
    }
    expect(wheelRuntime.grounded).toBe(false);
    console.log(`[B5A-2] 拉开后 grounded=${wheelRuntime.grounded}`);
  });
});
