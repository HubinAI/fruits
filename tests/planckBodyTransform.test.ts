/**
 * Queue F-02M-B16A｜Planck Body 位置与边界契约测试
 *
 * 覆盖：
 * 1. setPosition：游戏层 px、只改位置、不动角度/速度；
 * 2. getBounds：box / circle / compound 合并边界、旋转后随 transform 更新、
 *    setPosition 平移、非有限输入与跨 World 抛错。
 */
import { describe, it, expect } from 'vitest';
import { PlanckWorld } from '../src/physics/planckWorld';

describe('F-02M-B16A · 1. setPosition 位置契约', () => {
  it('只改变位置；角度/线速度/角速度前后不变', () => {
    const world = new PlanckWorld();
    const b = world.createDynamicBox(100, 200, 40, 20, 5);
    world.setLinearVelocity(b, 1.5, -2.5);
    world.setAngularVelocity(b, 0.5);
    world.setAngle(b, 0.3);

    const a0 = world.getAngle(b);
    const v0 = world.getLinearVelocity(b);
    const w0 = world.getAngularVelocity(b);

    world.setPosition(b, 300, 400);
    const p = world.getPosition(b);
    expect(p.x).toBeCloseTo(300, 9);
    expect(p.y).toBeCloseTo(400, 9);
    // 角度/线速度/角速度不变
    expect(world.getAngle(b)).toBeCloseTo(a0, 9);
    const v1 = world.getLinearVelocity(b);
    expect(v1.x).toBeCloseTo(v0.x, 9);
    expect(v1.y).toBeCloseTo(v0.y, 9);
    expect(world.getAngularVelocity(b)).toBeCloseTo(w0, 9);
  });

  it('非有限输入抛错；跨 World handle 抛错', () => {
    const wa = new PlanckWorld();
    const wb = new PlanckWorld();
    const b = wa.createDynamicBox(0, 0, 10, 10, 1);
    expect(() => wa.setPosition(b, NaN, 0)).toThrow();
    expect(() => wa.setPosition(b, 0, Infinity)).toThrow();
    expect(() => wb.setPosition(b, 1, 1)).toThrow();
  });
});

describe('F-02M-B16A · 2. getBounds 边界契约', () => {
  it('40×20 box @ (100,200) → 80/190/120/210', () => {
    const world = new PlanckWorld();
    const b = world.createDynamicBox(100, 200, 40, 20, 5);
    const bb = world.getBounds(b);
    expect(bb.minX).toBeCloseTo(80, 9);
    expect(bb.minY).toBeCloseTo(190, 9);
    expect(bb.maxX).toBeCloseTo(120, 9);
    expect(bb.maxY).toBeCloseTo(210, 9);
  });

  it('circle r=15 @ (0,0) → -15/-15/15/15', () => {
    const world = new PlanckWorld();
    const c = world.createDynamicCircle(0, 0, 15, 2.5);
    const bb = world.getBounds(c);
    expect(bb.minX).toBeCloseTo(-15, 9);
    expect(bb.minY).toBeCloseTo(-15, 9);
    expect(bb.maxX).toBeCloseTo(15, 9);
    expect(bb.maxY).toBeCloseTo(15, 9);
  });

  it('compound 多 fixture 合并边界正确', () => {
    const world = new PlanckWorld();
    // box 40×40 offset(0,0) + circle r=15 offset(60,0) → 合并 [-20,-20]~[20,75]
    const b = world.createDynamicCompound(0, 0, [
      { shape: 'box', width: 40, height: 40, offset: { x: 0, y: 0 } },
      { shape: 'circle', radius: 15, offset: { x: 60, y: 0 } },
    ], 10);
    const bb = world.getBounds(b);
    expect(bb.minX).toBeCloseTo(-20, 9);
    expect(bb.minY).toBeCloseTo(-20, 9);
    expect(bb.maxX).toBeCloseTo(75, 9);
    expect(bb.maxY).toBeCloseTo(20, 9);
  });

  it('body 旋转后边界随当前 transform 更新（setAngle(π/2)）', () => {
    const world = new PlanckWorld();
    const b = world.createDynamicBox(100, 200, 40, 20, 5);
    // 旋转前：80/190/120/210
    const b0 = world.getBounds(b);
    expect(b0.minX).toBeCloseTo(80, 9);
    // 旋转 90°：40×20 绕中心旋转 → 世界 AABB 20×40 → 90/180/110/220
    world.setAngle(b, Math.PI / 2);
    const b1 = world.getBounds(b);
    console.log(
      `[B16A-rot] minX=${b1.minX.toFixed(4)} minY=${b1.minY.toFixed(4)} maxX=${b1.maxX.toFixed(4)} maxY=${b1.maxY.toFixed(4)}`,
    );
    expect(b1.minX).toBeCloseTo(90, 6);
    expect(b1.minY).toBeCloseTo(180, 6);
    expect(b1.maxX).toBeCloseTo(110, 6);
    expect(b1.maxY).toBeCloseTo(220, 6);
  });

  it('setPosition 后所有边界按相同 delta 平移', () => {
    const world = new PlanckWorld();
    const b = world.createDynamicBox(100, 200, 40, 20, 5);
    const before = world.getBounds(b);
    world.setPosition(b, 300, 400);
    const after = world.getBounds(b);
    expect(after.minX).toBeCloseTo(before.minX + 200, 9);
    expect(after.minY).toBeCloseTo(before.minY + 200, 9);
    expect(after.maxX).toBeCloseTo(before.maxX + 200, 9);
    expect(after.maxY).toBeCloseTo(before.maxY + 200, 9);
  });

  it('跨 World handle 抛错', () => {
    const wa = new PlanckWorld();
    const wb = new PlanckWorld();
    const b = wa.createDynamicBox(0, 0, 10, 10, 1);
    expect(() => wb.getBounds(b)).toThrow();
  });
});

describe('F-02M-B16A-R1 · 3. 几何边界 vs 碰撞边界', () => {
  it('box 40×20：几何 80/190/120/210；碰撞 79/189/121/211（含 polygon skin）', () => {
    const world = new PlanckWorld();
    const b = world.createDynamicBox(100, 200, 40, 20, 5);
    const g = world.getBounds(b);
    expect(g.minX).toBeCloseTo(80, 9);
    expect(g.minY).toBeCloseTo(190, 9);
    expect(g.maxX).toBeCloseTo(120, 9);
    expect(g.maxY).toBeCloseTo(210, 9);
    const c = world.getCollisionBounds(b);
    console.log(
      `[B16A-R1-box] geo=${g.minX}/${g.minY}/${g.maxX}/${g.maxY} col=${c.minX}/${c.minY}/${c.maxX}/${c.maxY}`,
    );
    expect(c.minX).toBeCloseTo(79, 6);
    expect(c.minY).toBeCloseTo(189, 6);
    expect(c.maxX).toBeCloseTo(121, 6);
    expect(c.maxY).toBeCloseTo(211, 6);
  });

  it('circle r=15：几何边界与碰撞边界一致（无额外 skin）', () => {
    const world = new PlanckWorld();
    const c = world.createDynamicCircle(0, 0, 15, 2.5);
    const g = world.getBounds(c);
    const cb = world.getCollisionBounds(c);
    expect(g.minX).toBeCloseTo(-15, 9);
    expect(g.maxX).toBeCloseTo(15, 9);
    expect(g.minY).toBeCloseTo(-15, 9);
    expect(g.maxY).toBeCloseTo(15, 9);
    // 两类边界完全一致
    expect(cb.minX).toBeCloseTo(g.minX, 9);
    expect(cb.minY).toBeCloseTo(g.minY, 9);
    expect(cb.maxX).toBeCloseTo(g.maxX, 9);
    expect(cb.maxY).toBeCloseTo(g.maxY, 9);
  });

  it('compound：两类边界分别正确（box 部分 ±1px skin，circle 部分一致）', () => {
    const world = new PlanckWorld();
    const b = world.createDynamicCompound(0, 0, [
      { shape: 'box', width: 40, height: 40, offset: { x: 0, y: 0 } },
      { shape: 'circle', radius: 15, offset: { x: 60, y: 0 } },
    ], 10);
    // 几何：box [-20,20]² ∪ circle [45,75]×[-15,15] → -20/-20/75/20
    const g = world.getBounds(b);
    expect(g.minX).toBeCloseTo(-20, 9);
    expect(g.minY).toBeCloseTo(-20, 9);
    expect(g.maxX).toBeCloseTo(75, 9);
    expect(g.maxY).toBeCloseTo(20, 9);
    // 碰撞：box 含 skin [-21,21]² ∪ circle [45,75]×[-15,15] → -21/-21/75/21
    const c = world.getCollisionBounds(b);
    console.log(
      `[B16A-R1-cpd] geo=${g.minX}/${g.minY}/${g.maxX}/${g.maxY} col=${c.minX}/${c.minY}/${c.maxX}/${c.maxY}`,
    );
    expect(c.minX).toBeCloseTo(-21, 6);
    expect(c.minY).toBeCloseTo(-21, 6);
    expect(c.maxX).toBeCloseTo(75, 6);
    expect(c.maxY).toBeCloseTo(21, 6);
  });

  it('setPosition / rotation 后两类边界均实时更新', () => {
    const world = new PlanckWorld();
    const b = world.createDynamicBox(100, 200, 40, 20, 5);
    // 旋转 90°：几何 90/180/110/220；碰撞 89/179/111/221
    world.setAngle(b, Math.PI / 2);
    const g1 = world.getBounds(b);
    const c1 = world.getCollisionBounds(b);
    expect(g1.minX).toBeCloseTo(90, 6);
    expect(g1.maxX).toBeCloseTo(110, 6);
    expect(c1.minX).toBeCloseTo(89, 6);
    expect(c1.maxX).toBeCloseTo(111, 6);
    // setPosition(300,400)：两类边界均平移 +200
    world.setPosition(b, 300, 400);
    const g2 = world.getBounds(b);
    const c2 = world.getCollisionBounds(b);
    expect(g2.minX).toBeCloseTo(g1.minX + 200, 6);
    expect(g2.minY).toBeCloseTo(g1.minY + 200, 6);
    expect(g2.maxX).toBeCloseTo(g1.maxX + 200, 6);
    expect(g2.maxY).toBeCloseTo(g1.maxY + 200, 6);
    expect(c2.minX).toBeCloseTo(c1.minX + 200, 6);
    expect(c2.maxX).toBeCloseTo(c1.maxX + 200, 6);
  });

  it('getCollisionBounds 跨 World handle 抛错', () => {
    const wa = new PlanckWorld();
    const wb = new PlanckWorld();
    const b = wa.createDynamicBox(0, 0, 10, 10, 1);
    expect(() => wb.getCollisionBounds(b)).toThrow();
  });
});
