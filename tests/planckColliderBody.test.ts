/**
 * Queue F-02M-B7A1｜Planck Polygon Body（保留不回删）
 *
 * 验证 createDynamicPolygon：
 * 1. 项目现有 wedge 轮廓（[(-70,-25),(-70,25),(50,25),(78,-8)]）可创建；
 * 2. 反向顶点顺序（CW）规范化后行为一致（质量/位置相同）；
 * 3. 质量 = 传入 mass、位置正确；
 * 4. 非法 polygon：非有限、2/9 顶点、零面积、凹、重复边（共线）均抛错；
 * 5. 非法 material：friction<0、restitution<0、restitution>1 抛错。
 */
import { describe, it, expect } from 'vitest';
import { PlanckWorld, type BodyHandle } from '../src/physics/planckWorld';

/** 项目现有 wedgeBody 轮廓（content.ts，相对原点本地 px） */
const WEDGE = [
  { x: -70, y: -25 },
  { x: -70, y: 25 },
  { x: 50, y: 25 },
  { x: 78, y: -8 },
];

describe('F-02M-B7A1 · Planck Polygon Body', () => {
  it('现有 wedge 轮廓可创建；质量=传入、位置正确', () => {
    const world = new PlanckWorld();
    const p: BodyHandle = world.createDynamicPolygon(0, 0, WEDGE, 50);
    // 质量 = 50（density 按面积标定）
    expect(world.getMass(p)).toBeCloseTo(50, 6);
    // 位置
    const pos = world.getPosition(p);
    expect(pos.x).toBeCloseTo(0, 6);
    expect(pos.y).toBeCloseTo(0, 6);
    // 正常 step 无 NaN（形状有效可求解）
    world.stepFixed(10);
    const after = world.getPosition(p);
    expect(Number.isFinite(after.x)).toBe(true);
    expect(Number.isFinite(after.y)).toBe(true);
    console.log(`[B7A1-1] wedge mass=${world.getMass(p).toFixed(4)} 10 步后 pos=(${after.x.toFixed(2)},${after.y.toFixed(2)})`);
  });

  it('反向顶点顺序（CW）规范化为 CCW，质量/位置一致', () => {
    const world = new PlanckWorld();
    const cw = [...WEDGE].reverse(); // CW
    const p: BodyHandle = world.createDynamicPolygon(0, 0, cw, 50);
    expect(world.getMass(p)).toBeCloseTo(50, 6);
    const pos = world.getPosition(p);
    expect(pos.x).toBeCloseTo(0, 6);
    expect(pos.y).toBeCloseTo(0, 6);
    console.log(`[B7A1-2] CW 顶点 mass=${world.getMass(p).toFixed(4)} pos=(${pos.x.toFixed(2)},${pos.y.toFixed(2)})`);
  });

  it('非法 polygon 全部抛错', () => {
    const world = new PlanckWorld();
    // 非有限
    expect(() => world.createDynamicPolygon(0, 0, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: NaN }], 5)).toThrow();
    // 顶点数 <3 / >8
    expect(() => world.createDynamicPolygon(0, 0, [{ x: 0, y: 0 }, { x: 1, y: 0 }], 5)).toThrow();
    const nine = Array.from({ length: 9 }, (_, i) => ({ x: Math.cos((i / 9) * Math.PI * 2), y: Math.sin((i / 9) * Math.PI * 2) }));
    expect(() => world.createDynamicPolygon(0, 0, nine, 5)).toThrow();
    // 零面积（三点共线）
    expect(() =>
      world.createDynamicPolygon(0, 0, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }], 5),
    ).toThrow();
    // 凹多边形
    expect(() =>
      world.createDynamicPolygon(
        0,
        0,
        [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 5, y: 2 }, { x: 0, y: 10 }],
        5,
      ),
    ).toThrow();
    // 重复边（相邻共线）
    expect(() =>
      world.createDynamicPolygon(
        0,
        0,
        [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }],
        5,
      ),
    ).toThrow();
    console.log('[B7A1-3] 6 类非法 polygon 全部抛错');
  });

  it('非法 material 抛错', () => {
    const world = new PlanckWorld();
    // friction < 0
    expect(() => world.createDynamicPolygon(0, 0, WEDGE, 50, { friction: -0.1 })).toThrow();
    // restitution 越界
    expect(() => world.createDynamicPolygon(0, 0, WEDGE, 50, { restitution: -0.1 })).toThrow();
    expect(() => world.createDynamicPolygon(0, 0, WEDGE, 50, { restitution: 1.1 })).toThrow();
    // 合法 material 正常
    const ok: BodyHandle = world.createDynamicPolygon(0, 0, WEDGE, 50, { friction: 0.8, restitution: 0.4 });
    expect(world.getMass(ok)).toBeCloseTo(50, 6);
    console.log('[B7A1-4] 非法 material 抛错；合法 friction=0.8/restitution=0.4 正常');
  });

  it('Compound（Box+Circle+Polygon）单 body：原点保持、mass 精确、COM 偏移可测', () => {
    const world = new PlanckWorld();
    const body: BodyHandle = world.createDynamicCompound(
      50,
      100,
      [
        { shape: 'box', width: 60, height: 40, offset: { x: -30, y: 0 } }, // 左侧大 box
        { shape: 'circle', radius: 15, offset: { x: 30, y: 10 } }, // 右侧小圆
        {
          shape: 'polygon',
          vertices: [
            { x: -10, y: -10 },
            { x: 10, y: -10 },
            { x: 10, y: 10 },
            { x: -10, y: 10 },
          ],
          offset: { x: 0, y: 25 },
          angle: 0.3, // 旋转 polygon 也真实进入
        },
      ],
      100,
      { friction: 0.5, restitution: 0.1 },
    );

    // body 原点保持输入位置
    const pos = world.getPosition(body);
    expect(pos.x).toBeCloseTo(50, 6);
    expect(pos.y).toBeCloseTo(100, 6);
    // mass 精确 = 100
    expect(world.getMass(body)).toBeCloseTo(100, 6);
    // 非对称 offset → COM 可测偏移（box 在左侧面积大 → COM 偏左）
    const com = world.getCenterOfMass(body);
    console.log(
      `[B7A2-1] mass=${world.getMass(body).toFixed(4)} pos=(${pos.x.toFixed(2)},${pos.y.toFixed(2)}) ` +
        `COM=(${com.x.toFixed(2)},${com.y.toFixed(2)}) 偏移=(${(com.x - pos.x).toFixed(2)},${(com.y - pos.y).toFixed(2)})`,
    );
    expect(Math.abs(com.x - pos.x)).toBeGreaterThan(0.1); // COM x 偏移显著
    // 不使用逐步位置/角度修正：仅 stepFixed 若干步无 NaN
    world.stepFixed(30);
    const after = world.getPosition(body);
    expect(Number.isFinite(after.x)).toBe(true);
    expect(Number.isFinite(after.y)).toBe(true);

    // OwnerTag / contact 中仍表现为单一 BodyHandle
    world.setOwnerTag(body, { kind: 'vehicle', vehicleId: 'compound-test', team: 'A' });
    expect(world.getOwnerTag(body)).toEqual({ kind: 'vehicle', vehicleId: 'compound-test', team: 'A' });
    expect(world.getMass(body)).toBeCloseTo(100, 6); // tag 后仍单一 handle
    console.log('[B7A2-1] OwnerTag 单一 handle 往返 OK');
  });
});
