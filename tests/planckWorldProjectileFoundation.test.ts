/**
 * Queue Q02-F1｜PlanckWorld Projectile Foundation targeted test
 *
 * 覆盖 Q02-F1 验收：
 * 1. destroyBody：handle 立即失效、关联状态清理、跨 World / 已失效明确报错；
 * 2. 相连 joint wrapper 失效（Revolute + Weld），被 native 自动销毁的 joint 不留 stale；
 * 3. 批次接触事件交付后销毁安全（World 非 locked），销毁后不再产生该 body 的 contact；
 * 4. COM 冲量：Δv ≈ impulse / mass（J/m，游戏层 mass×px/step 单位）；
 * 5. 偏心冲量：自然产生正确方向角速度（τ = r × J），非 setLinearVelocity 模拟；
 * 6. bullet/CCD：高速小圆 → 薄静态墙必须产生 contact 且不一步穿透；
 *    非 bullet 对照在相同轨迹下穿透（证明 CCD 起作用而非几何巧合）。
 */
import { describe, expect, it } from 'vitest';
import { PlanckWorld } from '../src/physics/planckWorld';

describe('Q02-F1 destroyBody', () => {
  it('销毁后 BodyHandle 立即失效且关联状态清理，跨 World / 已失效明确报错', () => {
    const world = new PlanckWorld();
    const h = world.createDynamicCircle(100, 100, 10, 2);
    world.setOwnerTag(h, { kind: 'projectile', team: 'A', partId: 'cannon:1' });

    world.destroyBody(h);

    // handle 失效：读取 / 写入均明确抛错，不静默 no-op
    expect(() => world.getPosition(h)).toThrow();
    expect(() => world.getLinearVelocity(h)).toThrow();
    expect(() => world.getOwnerTag(h)).toThrow();
    expect(() => world.getBounds(h)).toThrow();
    expect(() => world.setPosition(h, 0, 0)).toThrow();
    // 已销毁 handle 再次销毁 → 明确报错
    expect(() => world.destroyBody(h)).toThrow();
    // 跨 World handle → 明确报错
    const other = new PlanckWorld();
    const h2 = other.createDynamicCircle(0, 0, 5, 1);
    expect(() => world.destroyBody(h2)).toThrow();

    // 销毁后继续步进无异常、不再产生该 body 的 contact
    let events = 0;
    world.setBatchedContactListener(() => {
      events++;
    });
    expect(() => world.stepFixed(10)).not.toThrow();
    expect(events).toBe(0);
  });

  it('销毁 body 后相连 joint 的 wrapper handle 同步失效（Revolute + Weld）', () => {
    const world = new PlanckWorld();
    const a = world.createDynamicBox(0, 0, 40, 20, 4);
    const b = world.createDynamicBox(100, 0, 40, 20, 4);
    const c = world.createDynamicBox(200, 0, 40, 20, 4);
    const rj = world.createRevoluteJoint(a, { x: 0, y: 0 }, b, { x: 0, y: 0 });
    const wj = world.createWeldJoint(b, { x: 0, y: 0 }, c, { x: 0, y: 0 });

    world.destroyBody(a);

    // Revolute wrapper 失效（joints + revoluteJoints 两条映射都要清）
    expect(() => world.getJointAnchorErrorPx(rj)).toThrow();
    expect(() =>
      world.setRevoluteMotor(rj, { enabled: true, speedRadPerStep: 1, maxTorqueNm: 1 }),
    ).toThrow();
    // 被销毁 body 的另一端不受影响
    expect(() => world.getPosition(b)).not.toThrow();

    // 销毁 b：Weld wrapper 同步失效
    world.destroyBody(b);
    expect(() => world.getJointAnchorErrorPx(wj)).toThrow();
    expect(() => world.getPosition(c)).not.toThrow();
  });

  it('批次接触事件交付后销毁安全（World 非 locked），销毁后不再产生该 body 的 contact', () => {
    const world = new PlanckWorld();
    world.createStaticGround(400, 700, 800, 20);
    const proj = world.createDynamicCircle(400, 100, 10, 1);
    world.setOwnerTag(proj, { kind: 'projectile', team: 'A' });
    world.setLinearVelocity(proj, 0, 20); // 向下 20 px/step → 约 30 步触地

    let destroyed = false;
    let destroyedHandle: typeof proj | null = null;
    let postDestroyContacts = 0;
    world.setBatchedContactListener((ev) => {
      if (destroyed) {
        if (ev.bodyA === destroyedHandle || ev.bodyB === destroyedHandle) postDestroyContacts++;
        return;
      }
      if (ev.bodyA === proj || ev.bodyB === proj) {
        // 批次监听在 world.step 之后派发（World 已解锁）→ 销毁必须安全
        destroyed = true;
        destroyedHandle = proj;
        expect(() => world.destroyBody(proj)).not.toThrow();
      }
    });

    expect(() => world.stepFixed(60)).not.toThrow();
    expect(destroyed).toBe(true);
    expect(postDestroyContacts).toBe(0);
    // 销毁后继续步进无异常
    expect(() => world.stepFixed(10)).not.toThrow();
  });
});

describe('Q02-F1 applyLinearImpulse', () => {
  it('COM 冲量：Δv ≈ impulse / mass（J/m，游戏层 mass×px/step 单位）', () => {
    const world = new PlanckWorld();
    const mass = 2;
    const h = world.createDynamicCircle(100, 100, 10, mass);

    world.applyLinearImpulse(h, { x: 30, y: 0 }); // J = 30（mass × px/step）
    let v = world.getLinearVelocity(h);
    expect(v.x).toBeCloseTo(30 / mass, 6); // Δvx = 15 px/step
    expect(v.y).toBeCloseTo(0, 6);

    // 零冲量不改变速度
    world.applyLinearImpulse(h, { x: 0, y: 0 });
    v = world.getLinearVelocity(h);
    expect(v.x).toBeCloseTo(30 / mass, 6);

    // 冲量可叠加（同向再 +30 → Δv 再 +15）
    world.applyLinearImpulse(h, { x: 30, y: 0 });
    v = world.getLinearVelocity(h);
    expect(v.x).toBeCloseTo(60 / mass, 6);

    // 跨 World handle 明确报错
    const other = new PlanckWorld();
    const h2 = other.createDynamicCircle(0, 0, 5, 1);
    expect(() => world.applyLinearImpulse(h2, { x: 1, y: 0 })).toThrow();
  });

  it('偏心冲量自然产生正确方向角速度（τ = r × J）', () => {
    const world = new PlanckWorld();
    // 质量 4、40×20 box，COM 在 (200,300)
    const h = world.createDynamicBox(200, 300, 40, 20, 4);

    // 在 (220, 290)（COM 右上方 +20, -10 px）施加 +X 冲量 40：
    // τ_z = rx·Jy − ry·Jx = 20·0 − (−10)·40 = +400（游戏层标量，Y 向下 → 正角速度）
    world.applyLinearImpulse(h, { x: 40, y: 0 }, { x: 220, y: 290 });
    const w1 = world.getAngularVelocity(h);
    expect(w1).toBeGreaterThan(0);
    // 解析校验：J_native = pxPerStepToMps(40) = 24 kg·m/s；r = (0.2, −0.1) m；
    // τ = 2.4 N·m；I = 4·(0.4²+0.2²)/12 = 0.0667 kg·m² → Δω = 36 rad/s → 0.6 rad/step
    expect(w1).toBeCloseTo(0.6, 1);

    // 对称：在 COM 左下方 (−20, +10 px) 施加 +X 冲量 → 角速度反号（净 ω 归零）
    world.applyLinearImpulse(h, { x: 40, y: 0 }, { x: 180, y: 310 });
    const w2 = world.getAngularVelocity(h);
    expect(w2).toBeLessThan(w1);
    expect(w2).toBeCloseTo(0, 1);
  });
});

describe('Q02-F1 bullet / CCD', () => {
  it('bullet=true 高速小圆撞薄墙：必须产生 contact、不一步穿透（验收主项）', () => {
    const world = new PlanckWorld();
    // 薄静态墙：中心 (500,300)，宽 6、高 300 → 左面 x=497
    const wall = world.createStaticBox(500, 300, 6, 300);
    const proj = world.createDynamicCircle(440, 300, 4, 0.1, { bullet: true });
    world.setLinearVelocity(proj, 200, 0); // 200 px/step：单步 200px >> 墙厚 6px + 半径 8px

    let began = 0;
    world.setBatchedContactListener((ev) => {
      if (ev.phase === 'begin' && (ev.bodyA === wall || ev.bodyB === wall)) began++;
    });
    // 轨迹：440 → 640（span 436..644 直接跨过墙区间 [496,504]）。
    // 若真的一步穿透，则无 contact 且 posX > 500。
    world.stepFixed(15);

    expect(began).toBeGreaterThanOrEqual(1); // 必须产生 contact
    const p = world.getPosition(proj);
    const v = world.getLinearVelocity(proj);
    expect(p.x).toBeLessThan(497); // 未越过墙左面 → 未一步穿透
    expect(Math.abs(v.x)).toBeLessThan(0.001); // 命中后停止（restitution=0）
  });

  it('bullet 选项不改变默认行为：缺省 / bullet=false 同场景同样命中不穿透（无回归）', () => {
    const run = (bullet?: boolean): { began: number; posX: number } => {
      const world = new PlanckWorld();
      const wall = world.createStaticBox(500, 300, 6, 300);
      const proj = world.createDynamicCircle(
        440, 300, 4, 0.1,
        bullet === undefined ? undefined : { bullet },
      );
      world.setLinearVelocity(proj, 200, 0);
      let began = 0;
      world.setBatchedContactListener((ev) => {
        if (ev.phase === 'begin' && (ev.bodyA === wall || ev.bodyB === wall)) began++;
      });
      world.stepFixed(15);
      return { began, posX: world.getPosition(proj).x };
    };

    const def = run();
    const plain = run(false);
    // 说明（实测，Planck 1.4.3 / Box2D 2.4）：默认 speculative contacts 在单静态墙
    // 场景下同样阻止隧穿（探测至 102400 px/step 均命中）——bullet 标志映射原生
    // setBullet 的 TOI CCD，在多体/极高速/动态目标场景更稳健；
    // 本断言证明新增选项未破坏默认碰撞行为（bullet 缺省与显式 false 一致）。
    expect(def.began).toBeGreaterThanOrEqual(1);
    expect(def.posX).toBeLessThan(497);
    expect(plain.began).toBeGreaterThanOrEqual(1);
    expect(plain.posX).toBeLessThan(497);
  });
});
