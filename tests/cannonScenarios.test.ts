/**
 * Queue Q02-C4｜Cannon Visual Scenarios targeted test
 *
 * 覆盖 Q02-C4 验收：
 * 1. 3 个 cannon 场景均能通过 PhysicsLab 正式入口创建并 step（无启动即异常）；
 * 2. 全部显式 engine:'planck'，且实际选择 PlanckBattleOrchestrator；
 * 3. build 合法、Cannon 安装位置正确（front hardpoint / weapon / 六参数完整）；
 * 4. 无出生重叠（含 cannon 炮管伸出）；
 * 5. 场景专属行为：Cannon-Hit 真实命中结算；Cannon-Recoil B 不参与交互且整车真实后座；
 *    Cannon-Angle 弹道沿真实车身/炮管世界方向（无 Scenario 弹道补偿）。
 */
import { describe, it, expect } from 'vitest';
import { getScenario } from '../src/lab/scenarios';
import { PhysicsLab } from '../src/lab/physicsLab';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import type { Renderer } from '../src/render/renderer';
import type { CombatEvent } from '../src/battle/combatEvents';
import type { PlanckVehicle } from '../src/battle/planckVehicleAssembly';
import type { BodyHandle } from '../src/physics/planckWorld';

const rendererStub = { bind: () => {} } as unknown as Renderer;

const CANNON_SCENARIOS = ['Cannon-Hit', 'Cannon-Recoil', 'Cannon-Angle'];

/** 车辆整体右缘（chassis + parts 真实碰撞几何 maxX） */
function vehicleRightEdge(orch: PlanckBattleOrchestrator, v: PlanckVehicle): number {
  let maxX = -Infinity;
  const acc = (b: BodyHandle): void => {
    maxX = Math.max(maxX, orch.world.getBounds(b).maxX);
  };
  acc(v.body);
  for (const p of v.parts) acc(p.body);
  return maxX;
}

/** 车辆整体左缘（chassis + parts 真实碰撞几何 minX） */
function vehicleLeftEdge(orch: PlanckBattleOrchestrator, v: PlanckVehicle): number {
  let minX = Infinity;
  const acc = (b: BodyHandle): void => {
    minX = Math.min(minX, orch.world.getBounds(b).minX);
  };
  acc(v.body);
  for (const p of v.parts) acc(p.body);
  return minX;
}

function requirePlanck(lab: PhysicsLab): PlanckBattleOrchestrator {
  const o = lab.orchestrator;
  if (!(o instanceof PlanckBattleOrchestrator)) {
    throw new Error('未选择 PlanckBattleOrchestrator（engine selector 失效）');
  }
  return o;
}

describe('Q02-C4 Cannon Visual Scenarios', () => {
  it('3 个场景：Lab 正式入口创建并 step，全部 Planck，Cannon 安装正确，无出生重叠', () => {
    for (const id of CANNON_SCENARIOS) {
      const sc = getScenario(id);
      expect(sc).toBeDefined();
      // 全部显式 engine:'planck'
      expect(sc!.config.engine).toBe('planck');
      expect(sc!.config.autoDrive).toBe(false);

      const lab = new PhysicsLab(rendererStub);
      expect(() => lab.loadScenario(sc!)).not.toThrow();
      const o = requirePlanck(lab);

      // 无出生重叠（含 cannon 炮管伸出）
      expect(vehicleRightEdge(o, o.vehicleA)).toBeLessThan(vehicleLeftEdge(o, o.vehicleB));

      // Cannon 安装位置正确：front hardpoint、weapon、六参数完整
      const part = o.vehicleA.parts.find((p) => p.def.behavior === 'cannon');
      expect(part).toBeDefined();
      expect(part!.id).toBe('front');
      expect(part!.def.category).toBe('weapon');
      expect(part!.def.behaviorParams).toEqual(
        expect.objectContaining({
          cooldownMs: expect.any(Number),
          muzzleSpeed: expect.any(Number),
          projectileDamage: expect.any(Number),
          projectileRadius: expect.any(Number),
          projectileMass: expect.any(Number),
          recoilImpulse: expect.any(Number),
        }),
      );
      // 炮管在车身前方（facing +1）
      expect(o.world.getPosition(part!.body).x).toBeGreaterThan(
        o.world.getPosition(o.vehicleA.body).x,
      );

      // 120 步（2s）正式 step 无异常
      expect(() => {
        for (let i = 0; i < 120; i++) lab.step(16.6667);
      }).not.toThrow();
    }
  });

  it('Cannon-Hit：固定冷却真实命中并结算 projectileDamage（2 发 × 80）', () => {
    const lab = new PhysicsLab(rendererStub);
    lab.loadScenario(getScenario('Cannon-Hit')!);
    const o = requirePlanck(lab);
    const weaponEvents: CombatEvent[] = [];
    o.onCombatEvent((e) => {
      if (e.damageSource === 'weapon') weaponEvents.push(e);
    });
    for (let i = 0; i < 120; i++) lab.step(16.6667);
    // 120 步内 2 发（step 1/61）均真实命中 B（命中即销毁，每发恰一次伤害）
    expect(weaponEvents.length).toBe(2);
    for (const ev of weaponEvents) expect(ev.damage).toBe(80);
    expect(o.vehicleB.hp).toBe(840);
  });

  it('Cannon-Recoil：B 远置不参与前几秒交互；连续开炮整车真实后座', () => {
    const lab = new PhysicsLab(rendererStub);
    lab.loadScenario(getScenario('Cannon-Recoil')!);
    const o = requirePlanck(lab);
    const weaponEvents: CombatEvent[] = [];
    o.onCombatEvent((e) => {
      if (e.damageSource === 'weapon') weaponEvents.push(e);
    });
    const x0 = o.world.getPosition(o.vehicleA.body).x;
    // 第一帧开炮后整车立即获得 -X 速度（真实 recoil 经 Weld 传整车）
    lab.step(16.6667);
    expect(o.world.getLinearVelocity(o.vehicleA.body).x).toBeLessThan(0);
    for (let i = 1; i < 120; i++) lab.step(16.6667);
    // B 不参与交互：无 weapon 伤害、hp 不变
    expect(weaponEvents.length).toBe(0);
    expect(o.vehicleB.hp).toBe(1000);
    // 连续开炮净后座位移（无驱动，只有 recoil 反向）
    const x1 = o.world.getPosition(o.vehicleA.body).x;
    expect(x1).toBeLessThan(x0);
  });

  it('Cannon-Angle：炮弹沿真实车身/炮管世界方向射出（无 Scenario 弹道补偿）', () => {
    const lab = new PhysicsLab(rendererStub);
    lab.loadScenario(getScenario('Cannon-Angle')!);
    const o = requirePlanck(lab);
    // 前后轮径差（rear 26 / front 12）→ 明显车身倾角
    const part = o.vehicleA.parts.find((p) => p.def.behavior === 'cannon')!;
    const partAngle = o.world.getAngle(part.body);
    expect(Math.abs(partAngle)).toBeGreaterThan(0.05); // > ~3°

    // 发射一帧
    lab.step(16.6667);
    const pr = o.getRenderSnapshot().projectiles?.[0];
    expect(pr).toBeDefined();

    // 一步后位移方向 ≈ part 世界角（弹道沿真实炮管方向；重力仅 ~0.28px 小量）
    const partPos = o.world.getPosition(part.body);
    const c = part.def.collider;
    const muzzleLocal = {
      x: 1 * ((c.offset?.x ?? 0) + (c.width ?? 0) / 2),
      y: c.offset?.y ?? 0,
    };
    const rot = (p: { x: number; y: number }, a: number) => ({
      x: p.x * Math.cos(a) - p.y * Math.sin(a),
      y: p.x * Math.sin(a) + p.y * Math.cos(a),
    });
    const muzzle = {
      x: partPos.x + rot(muzzleLocal, partAngle).x,
      y: partPos.y + rot(muzzleLocal, partAngle).y,
    };
    const dx = pr!.center.x - muzzle.x;
    const dy = pr!.center.y - muzzle.y;
    const observedAngle = Math.atan2(dy, dx);
    // 明显偏离水平（倾角生效）且与真实炮管方向一致（无补偿）
    expect(Math.abs(observedAngle)).toBeGreaterThan(0.03);
    expect(Math.abs(observedAngle - partAngle)).toBeLessThan(0.03);
  });
});
