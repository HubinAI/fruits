/**
 * Queue F-02I-A｜落地 Impact 阈值 0.75（只实现，不提交）
 *
 * 正式 Runtime 验收（正式 BattleOrchestrator + 当前 ContactRouter，
 * world.setCollisionHandlers 仅包裹记录，start/active/end 完整转发）：
 * 1. 正常碰撞（Body-only Light vs Body-only Heavy，autoDrive=true）：
 *    - 首次完整敌对 batch 最大 relVel > 0.75；
 *    - 只结算一次 Impact；lastImpact.relativeVelocity = batch 最大 relVel；
 *    - 总伤害 = (maxRelVel - 0.75) × 0.5，双方各半且只扣一次；lastDamage=null。
 * 2. 低速对照（Body-only Light vs Body-only Light，autoDrive=false，
 *    bounds 表面间距 ~4px，初速 ±0.25，清零角速度一次，不锁定）：
 *    - 120 步内真实敌对接触；batch 最大 relVel < 0.75；
 *    - 双方 HP 不变；lastImpact=null、lastDamage=null。
 */
import { describe, it, expect } from 'vitest';
import Matter from 'matter-js';
import { createRegistry } from '../src/core/content';
import type { BuildSnapshot } from '../src/core/types';
import { getMeta, FIXED_DT, type ContactEvent } from '../src/physics/adapter';
import { BattleOrchestrator } from '../src/battle/battleOrchestrator';
import { IMPACT_CONTACT_THRESHOLD } from '../src/battle/contactRouter';
import { getPreset } from '../src/lab/presets';
import type { Vehicle } from '../src/battle/vehicleAssembly';

const registry = createRegistry();
const lightSnapshot = getPreset('lightVehicle')!.build();
const heavySnapshot = getPreset('heavyVehicle')!.build();
const bodyOnlyLight: BuildSnapshot = { ...lightSnapshot, functionals: [] };
const bodyOnlyHeavy: BuildSnapshot = { ...heavySnapshot, functionals: [] };

interface BatchSample {
  hitStep: number;
  maxRelVel: number;
  entries: { partIdA: string; partIdB: string; relVel: number }[];
  hpA: { before: number; after: number };
  hpB: { before: number; after: number };
  lastImpact: { damage: number; relativeVelocity: number } | null;
  lastDamage: { damage: number; target: string } | null;
}

/** 采集首次完整敌对 batch */
function collectFirstHostileBatch(
  orch: BattleOrchestrator,
  maxSteps: number,
): BatchSample | null {
  let capture: { timestamp: number; size: number; entries: { partIdA: string; partIdB: string; relVel: number }[] } | null = null;
  let captureDone = false;
  let hitStep = -1;
  let hpABefore = orch.vehicleA.hp;
  let hpBBefore = orch.vehicleB.hp;

  orch.world.setCollisionHandlers({
    onStart: (ev: ContactEvent) => {
      orch.router.handleContact(ev);
      if (captureDone || !ev.batch) return;
      const mA = getMeta(ev.bodyA);
      const mB = getMeta(ev.bodyB);
      const hostile =
        mA.kind === 'vehicle' && mB.kind === 'vehicle' && mA.team !== mB.team;
      if (!capture) {
        capture = { timestamp: ev.batch.timestamp, size: ev.batch.size, entries: [] };
      }
      if (hostile) {
        capture.entries.push({
          partIdA: String(mA.partId ?? ''),
          partIdB: String(mB.partId ?? ''),
          relVel: ev.relativeVelocity,
        });
      }
      if (ev.batch.index === ev.batch.size - 1) {
        if (capture.entries.length > 0) captureDone = true;
        else capture = null;
      }
    },
    onActive: (ev: ContactEvent) => orch.router.handleContact(ev),
    onEnd: (ev: ContactEvent) => orch.router.handleContact(ev),
  });

  for (let i = 0; i < maxSteps && !captureDone; i++) {
    hpABefore = orch.vehicleA.hp;
    hpBBefore = orch.vehicleB.hp;
    orch.step(FIXED_DT);
    if (captureDone) hitStep = i;
  }
  if (!capture) return null;

  return {
    hitStep,
    maxRelVel: Math.max(...capture.entries.map((e) => e.relVel)),
    entries: capture.entries,
    hpA: { before: hpABefore, after: orch.vehicleA.hp },
    hpB: { before: hpBBefore, after: orch.vehicleB.hp },
    lastImpact: orch.router.debug.lastImpact
      ? {
          damage: orch.router.debug.lastImpact.damage,
          relativeVelocity: orch.router.debug.lastImpact.relativeVelocity,
        }
      : null,
    lastDamage: orch.router.debug.lastDamage
      ? { damage: orch.router.debug.lastDamage.damage, target: orch.router.debug.lastDamage.target }
      : null,
  };
}

describe('F-02I-A · 验收1：正常碰撞（Light vs Heavy，autoDrive）', () => {
  it('Impact 按 batch 最大 relVel 结算一次，双方各半', () => {
    const orch = new BattleOrchestrator(bodyOnlyLight, bodyOnlyHeavy, registry, {
      autoDrive: true,
      spawnA: { x: 400, y: 640, facing: 1 },
      spawnB: { x: 900, y: 640, facing: -1 },
    });
    const s = collectFirstHostileBatch(orch, 600);
    expect(s).not.toBeNull();
    const r = s!;

    console.log(
      `S1 步=${r.hitStep} entries=${r.entries.length} maxRelVel=${r.maxRelVel.toFixed(3)} ` +
        `HP A: ${r.hpA.before}->${r.hpA.after} HP B: ${r.hpB.before}->${r.hpB.after} ` +
        `lastImpact=${r.lastImpact ? `dmg=${r.lastImpact.damage.toFixed(4)}@${r.lastImpact.relativeVelocity.toFixed(3)}` : 'null'}`,
    );
    for (const e of r.entries) {
      console.log(`S1   ${e.partIdA}->${e.partIdB} relVel=${e.relVel.toFixed(3)}`);
    }

    // 1) batch 最大 relVel > 0.75
    expect(r.maxRelVel).toBeGreaterThan(IMPACT_CONTACT_THRESHOLD);
    // 2) 只结算一次 Impact，双方各半且只扣一次
    const totalDamage = (r.maxRelVel - IMPACT_CONTACT_THRESHOLD) * 0.5;
    expect(r.hpA.after).toBeCloseTo(r.hpA.before - totalDamage / 2, 5);
    expect(r.hpB.after).toBeCloseTo(r.hpB.before - totalDamage / 2, 5);
    // 3) lastImpact 用 batch 最大 relVel，总伤害 = (maxRelVel-0.75)*0.5
    expect(r.lastImpact?.relativeVelocity).toBeCloseTo(r.maxRelVel, 5);
    expect(r.lastImpact?.damage).toBeCloseTo(totalDamage, 5);
    // 4) 无武器 → lastDamage=null
    expect(r.lastDamage).toBeNull();
  });
});

describe('F-02I-A · 验收2：低速对照（±0.25，表面间距 ~4px，120 步）', () => {
  it('relVel < 0.75 不触发 Impact，HP 不变', () => {
    const orch = new BattleOrchestrator(bodyOnlyLight, bodyOnlyLight, registry, {
      autoDrive: false,
      spawnA: { x: 600, y: 640, facing: 1 },
      spawnB: { x: 800, y: 640, facing: -1 },
    });

    // 按实际 bounds 计算达到 4px 表面间距所需的水平 delta
    const aRight = orch.vehicleA.body.bounds.max.x;
    const bLeft = orch.vehicleB.body.bounds.min.x;
    const delta = aRight + 4 - bLeft; // 负值 = B 向左平移

    // 平移前：wheels 相对 parent 的水平偏移（用于约束未拉伸校验）
    const wheelOffsetBefore = orch.vehicleB.wheels.map(
      (w) => w.body.position.x - orch.vehicleB.body.position.x,
    );

    // 用同一个 delta 平移整个 vehicleB（body + 每个 wheel + 每个独立 part）。
    // vehicleB.body 是 compound parent，sub-parts 随 parent 平移，不得再单独遍历 body.parts。
    if (Math.abs(delta) > 0.01) {
      Matter.Body.setPosition(orch.vehicleB.body, {
        x: orch.vehicleB.body.position.x + delta,
        y: orch.vehicleB.body.position.y,
      });
      for (const w of orch.vehicleB.wheels) {
        Matter.Body.setPosition(w.body, {
          x: w.body.position.x + delta,
          y: w.body.position.y,
        });
      }
      for (const p of orch.vehicleB.parts) {
        Matter.Body.setPosition(p.body, {
          x: p.body.position.x + delta,
          y: p.body.position.y,
        });
      }
    }

    // 平移后断言：实际车身表面间距 ≈ 4px；wheels 相对偏移不变（约束未被拉伸）
    const aRightAfter = orch.vehicleA.body.bounds.max.x;
    const bLeftAfter = orch.vehicleB.body.bounds.min.x;
    const surfaceGap = bLeftAfter - aRightAfter;
    expect(Math.abs(surfaceGap - 4)).toBeLessThan(0.5);
    const wheelOffsetAfter = orch.vehicleB.wheels.map(
      (w) => w.body.position.x - orch.vehicleB.body.position.x,
    );
    wheelOffsetBefore.forEach((off, i) => {
      expect(Math.abs(wheelOffsetAfter[i]! - off)).toBeLessThan(0.01);
    });
    console.log(`S2 平移 delta=${delta.toFixed(2)}px，表面间距=${surfaceGap.toFixed(2)}px`);

    // 同步 parent/wheel/parts 速度 ±0.25，角速度清零一次（之后不锁定）
    const setV = (v: Vehicle, vx: number): void => {
      Matter.Body.setVelocity(v.body, { x: vx, y: 0 });
      Matter.Body.setAngularVelocity(v.body, 0);
      for (const w of v.wheels) {
        Matter.Body.setVelocity(w.body, { x: vx, y: 0 });
        Matter.Body.setAngularVelocity(w.body, 0);
      }
      for (const p of v.parts) {
        Matter.Body.setVelocity(p.body, { x: vx, y: 0 });
        Matter.Body.setAngularVelocity(p.body, 0);
      }
    };
    setV(orch.vehicleA, 0.25);
    setV(orch.vehicleB, -0.25);

    const s = collectFirstHostileBatch(orch, 120);
    expect(s).not.toBeNull();
    const r = s!;

    console.log(
      `S2 步=${r.hitStep} entries=${r.entries.length} maxRelVel=${r.maxRelVel.toFixed(3)} ` +
        `HP A: ${r.hpA.before}->${r.hpA.after} HP B: ${r.hpB.before}->${r.hpB.after} ` +
        `lastImpact=${r.lastImpact ? 'non-null' : 'null'} lastDamage=${r.lastDamage ? 'non-null' : 'null'}`,
    );
    for (const e of r.entries) {
      console.log(`S2   ${e.partIdA}->${e.partIdB} relVel=${e.relVel.toFixed(3)}`);
    }

    // 120 步内真实接触（hitStep >= 0）
    expect(r.hitStep).toBeGreaterThanOrEqual(0);
    // batch 最大 relVel < 0.75
    expect(r.maxRelVel).toBeLessThan(IMPACT_CONTACT_THRESHOLD);
    // 双方 HP 不变
    expect(r.hpA.after).toBeCloseTo(r.hpA.before, 5);
    expect(r.hpB.after).toBeCloseTo(r.hpB.before, 5);
    // 不触发
    expect(r.lastImpact).toBeNull();
    expect(r.lastDamage).toBeNull();
  });
});
