import { describe, it, expect } from 'vitest';
import { createRegistry } from '../src/core/content';
import {
  resolveSnapshot,
  type ResolvedSnapshot,
} from '../src/core/buildSnapshot';
import { PlanckWorld } from '../src/physics/planckWorld';
import { createPlanckVehicle } from '../src/battle/planckVehicleAssembly';

const registry = createRegistry();

/** body-only wedge snapshot（movements/functionals 空） */
function wedgeBodyOnly(): ResolvedSnapshot {
  const body = registry.bodies.get('wedgeBody');
  if (!body) throw new Error('registry 缺少 wedgeBody');
  return {
    snapshot: {
      id: 'wedgeTest',
      bodyDefId: 'wedgeBody',
      quality: 1,
      movements: [],
      functionals: [],
    },
    body,
    movements: [],
    functionals: [],
    totalMass: body.baseMass,
    totalEnergy: 0,
  };
}

describe('F-02M-B8A · Planck Vehicle Chassis 装配（body-only wedge）', () => {
  it('A 车 facing=1：质量/OwnerTag/COM/聚合字段正确且全有限', () => {
    const world = new PlanckWorld();
    const v = createPlanckVehicle(world, wedgeBodyOnly(), 'A', {
      x: 100,
      y: 200,
    });

    // 位置：body 原点保持输入
    const pos = world.getPosition(v.body);
    expect(pos.x).toBeCloseTo(100, 5);
    expect(pos.y).toBeCloseTo(200, 5);

    // 质量：createDynamicCompound 统一 density → 精确等于 baseMass
    expect(world.getMass(v.body)).toBeCloseTo(50, 6);
    expect(v.totalMass).toBe(50);

    // OwnerTag：kind/vehicleId/partId/team
    const tag = world.getOwnerTag(v.body);
    expect(tag).toEqual({
      kind: 'vehicle',
      vehicleId: 'wedgeTest',
      partId: 'body',
      team: 'A',
    });

    // 聚合字段
    expect(v.id).toBe('wedgeTest');
    expect(v.team).toBe('A');
    expect(v.facing).toBe(1);
    expect(v.hp).toBe(1000);
    expect(v.maxHp).toBe(1000);
    expect(v.wheels).toEqual([]);
    expect(v.parts).toEqual([]);

    // COM：有限且非零偏移（wedge 尾部面积大，重心偏后 → com.x < 100 是正确几何）
    const com = world.getCenterOfMass(v.body);
    expect(Number.isFinite(com.x)).toBe(true);
    expect(Number.isFinite(com.y)).toBe(true);
    expect(Math.abs(com.x - 100)).toBeGreaterThan(0.5); // 非零局部偏移
    expect(v.com.x).toBeCloseTo(com.x, 6);
    expect(v.com.y).toBeCloseTo(com.y, 6);

    // 全部数值有限
    expect(Number.isFinite(pos.x) && Number.isFinite(pos.y)).toBe(true);
    console.log(
      `[B8A-1] A(facing=1) pos=(${pos.x.toFixed(1)},${pos.y.toFixed(1)}) mass=${world
        .getMass(v.body)
        .toFixed(4)} com=(${com.x.toFixed(3)},${com.y.toFixed(3)}) tag=${JSON.stringify(tag)}`,
    );
  });

  it('B 车 facing=-1：collider 镜像 → COM 关于 y 轴对称、OwnerTag team=B', () => {
    const world = new PlanckWorld();
    // A 车 (100,200) facing=1 与 B 车 (-100,200) facing=-1 关于 y 轴对称摆放
    const a = createPlanckVehicle(world, wedgeBodyOnly(), 'A', {
      x: 100,
      y: 200,
    });
    const b = createPlanckVehicle(
      world,
      wedgeBodyOnly(),
      'B',
      { x: -100, y: 200 },
      -1, // facing 是第 5 参数，不能塞进 initialPos
    );

    const comA = world.getCenterOfMass(a.body);
    const comB = world.getCenterOfMass(b.body);

    // 局部质心（相对各自初始位置：A=(100,200)、B=(-100,200)）
    const localA = { x: comA.x - 100, y: comA.y - 200 };
    const localB = { x: comB.x - -100, y: comB.y - 200 };
    // 镜像正确性（关于 y 轴）：X 取反、Y 严格保持（y 质心在反射下不变）
    expect(localB.x).toBeCloseTo(-localA.x, 3);
    expect(localB.y).toBeCloseTo(localA.y, 3);
    // B 前鼻指向左 → 局部 COM.x > 0（镜像后重心偏 +x，全局 > -100）
    expect(comB.x).toBeGreaterThan(-100);

    // OwnerTag team 独立
    expect(world.getOwnerTag(b.body)).toEqual({
      kind: 'vehicle',
      vehicleId: 'wedgeTest',
      partId: 'body',
      team: 'B',
    });
    expect(world.getOwnerTag(a.body)?.team).toBe('A');

    // 双方质量均精确
    expect(world.getMass(a.body)).toBeCloseTo(50, 6);
    expect(world.getMass(b.body)).toBeCloseTo(50, 6);

    // 有限数
    const posB = world.getPosition(b.body);
    expect(
      [posB.x, posB.y, comB.x, comB.y].every(Number.isFinite),
    ).toBe(true);
    console.log(
      `[B8A-2] A.com=(${comA.x.toFixed(3)},${comA.y.toFixed(3)}) B.com=(${comB.x.toFixed(
        3,
      )},${comB.y.toFixed(3)}) 镜像验证 OK`,
    );
  });
});

/** boxBody + wheelStd×2（rear/front）的带轮 snapshot */
function boxWithWheels(): ResolvedSnapshot {
  return resolveSnapshot(
    {
      id: 'boxTest',
      bodyDefId: 'boxBody',
      quality: 1,
      movements: [
        { hardpointId: 'rear', defId: 'wheelStd' },
        { hardpointId: 'front', defId: 'wheelStd' },
      ],
      functionals: [],
    },
    registry,
  );
}

describe('F-02M-B8B · Planck Vehicle Wheels 装配', () => {
  it('左右 facing 轮位镜像 + 初始锚点误差近零 + OwnerTag + 总质量', () => {
    const world = new PlanckWorld();
    const a = createPlanckVehicle(world, boxWithWheels(), 'A', {
      x: 0,
      y: 300,
    });
    const b = createPlanckVehicle(
      world,
      boxWithWheels(),
      'B',
      { x: 0, y: 300 },
      -1,
    );

    expect(a.wheels.length).toBe(2);
    expect(b.wheels.length).toBe(2);
    const aRear = a.wheels[0]!;
    const aFront = a.wheels[1]!;
    const bRear = b.wheels[0]!;
    const bFront = b.wheels[1]!;

    // 轮位镜像：boxBody hardpoints rear(-55,27)/front(55,27)，Y 不变、X 按 facing
    const posARear = world.getPosition(aRear.body);
    const posAFront = world.getPosition(aFront.body);
    const posBRear = world.getPosition(bRear.body);
    const posBFront = world.getPosition(bFront.body);
    expect(posARear.x).toBeCloseTo(-55, 3);
    expect(posARear.y).toBeCloseTo(327, 3);
    expect(posAFront.x).toBeCloseTo(55, 3);
    expect(posAFront.y).toBeCloseTo(327, 3);
    // B 车 facing=-1：rear/front X 对调
    expect(posBRear.x).toBeCloseTo(55, 3);
    expect(posBFront.x).toBeCloseTo(-55, 3);
    expect(posBRear.y).toBeCloseTo(327, 3);

    // 初始锚点误差近零（chassis 本地硬点与 wheel 原点精确重合）
    expect(world.getJointAnchorErrorPx(aRear.joint)).toBeLessThan(1e-6);
    expect(world.getJointAnchorErrorPx(aFront.joint)).toBeLessThan(1e-6);
    expect(world.getJointAnchorErrorPx(bRear.joint)).toBeLessThan(1e-6);

    // OwnerTag：partId = wheel:<hardpointId>
    expect(world.getOwnerTag(aRear.body)).toEqual({
      kind: 'vehicle',
      vehicleId: 'boxTest',
      partId: 'wheel:rear',
      team: 'A',
    });
    expect(world.getOwnerTag(aFront.body)).toEqual({
      kind: 'vehicle',
      vehicleId: 'boxTest',
      partId: 'wheel:front',
      team: 'A',
    });
    expect(world.getOwnerTag(bRear.body)).toEqual({
      kind: 'vehicle',
      vehicleId: 'boxTest',
      partId: 'wheel:rear',
      team: 'B',
    });

    // grounded 初始 false
    expect(aRear.grounded).toBe(false);
    expect(aFront.grounded).toBe(false);

    // 总质量 = baseMass 50 + 10 + 10 = 70（精确）
    expect(world.getMass(a.body)).toBeCloseTo(50, 6);
    expect(world.getMass(aRear.body)).toBeCloseTo(10, 6);
    expect(a.totalMass).toBeCloseTo(70, 6);

    // 质量加权 COM：有限、合理（box 对称 + 双轮对称 → x≈0，y < body 中心）
    expect(Number.isFinite(a.com.x) && Number.isFinite(a.com.y)).toBe(true);
    console.log(
      `[B8B-1] A wheels rear=(${posARear.x.toFixed(1)},${posARear.y.toFixed(
        1,
      )}) front=(${posAFront.x.toFixed(1)},${posAFront.y.toFixed(1)}) ` +
        `B rear=(${posBRear.x.toFixed(1)},${posBRear.y.toFixed(1)}) ` +
        `总质量=${a.totalMass.toFixed(1)} com=(${a.com.x.toFixed(3)},${a.com.y.toFixed(3)})`,
    );
  });

  it('真实重力/地面步进：joint 不脱离、同车无自碰撞、无逐步纠偏', () => {
    const world = new PlanckWorld({ x: 0, y: 10 });
    world.createStaticGround(0, 700, 4000, 80); // 顶面 660
    // 贴地 spawn：wheel 底 = groundTop → wheel y=640，chassis y = 640-27 = 613
    const v = createPlanckVehicle(world, boxWithWheels(), 'A', {
      x: 0,
      y: 613,
    });

    // 同车自碰撞监听：收集全部 begin，验证无「同车」接触（负 group 关闭）
    const selfContacts: string[] = [];
    world.setContactListener((e) => {
      if (e.phase !== 'begin') return;
      const ta = world.getOwnerTag(e.bodyA);
      const tb = world.getOwnerTag(e.bodyB);
      if (
        ta &&
        tb &&
        ta.kind === 'vehicle' &&
        tb.kind === 'vehicle' &&
        ta.team === tb.team &&
        ta.vehicleId === tb.vehicleId
      ) {
        selfContacts.push(`${ta.partId ?? 'body'}↔${tb.partId ?? 'body'}`);
      }
    });

    let maxAnchorErr = 0;
    for (let i = 0; i < 600; i++) {
      world.stepFixed(1); // 仅固定步进，无任何逐步位置/角度纠偏
      for (const w of v.wheels) {
        maxAnchorErr = Math.max(maxAnchorErr, world.getJointAnchorErrorPx(w.joint));
      }
    }

    // joint 不脱离（贴地 spawn，无高空砸地冲击；600 步全程锚点误差极小）
    expect(maxAnchorErr).toBeLessThan(2);
    // 同车无自碰撞
    expect(selfContacts).toEqual([]);
    // 无 NaN/Infinity
    const pos = world.getPosition(v.body);
    expect(
      [pos.x, pos.y, v.com.x, v.com.y].every(Number.isFinite),
    ).toBe(true);
    console.log(
      `[B8B-2] 600 步后 maxAnchorErr=${maxAnchorErr.toFixed(5)}px ` +
        `selfContacts=${selfContacts.length} chassis=(${pos.x.toFixed(2)},${pos.y.toFixed(
          2,
        )})`,
    );
  });
});

/** boxBody + wheelStd×2 + ramHead@front 的 snapshot */
function boxWithRam(): ResolvedSnapshot {
  return resolveSnapshot(
    {
      id: 'boxTest',
      bodyDefId: 'boxBody',
      quality: 1,
      movements: [
        { hardpointId: 'rear', defId: 'wheelStd' },
        { hardpointId: 'front', defId: 'wheelStd' },
      ],
      functionals: [{ hardpointId: 'front', defId: 'ramHead' }],
    },
    registry,
  );
}

/** boxBody + ramHead@front（自定义非零 localRotation），无轮 */
function boxWithRamRotated(rotation: number): ResolvedSnapshot {
  const body = registry.bodies.get('boxBody')!;
  const ram = registry.functionals.get('ramHead')!;
  const hp = body.functionalHardpoints.find((h) => h.id === 'front')!;
  return {
    snapshot: {
      id: 'boxRot',
      bodyDefId: 'boxBody',
      quality: 1,
      movements: [],
      functionals: [{ hardpointId: 'front', defId: 'ramHead' }],
    },
    body,
    movements: [],
    functionals: [
      {
        install: { hardpointId: 'front', defId: 'ramHead' },
        hardpoint: { ...hp, localRotation: rotation },
        def: ram,
      },
    ],
    totalMass: body.baseMass + ram.mass,
    totalEnergy: ram.energy,
  };
}

describe('F-02M-B8C · Planck Fixed Functional Parts 装配', () => {
  it('带 offset 的 Ram：左右镜像 + OwnerTag + 质量/COM + Weld 锚点近零、步进后 <1px', () => {
    const world = new PlanckWorld();
    const a = createPlanckVehicle(world, boxWithRam(), 'A', { x: 0, y: 300 });
    const b = createPlanckVehicle(
      world,
      boxWithRam(),
      'B',
      { x: 0, y: 300 },
      -1,
    );

    expect(a.parts.length).toBe(1);
    const ramA = a.parts[0]!;
    const ramB = b.parts[0]!;

    // part body 原点 = 镜像后硬点世界位置（boxBody front hardpoint (75,0)）
    const posA = world.getPosition(ramA.body);
    const posB = world.getPosition(ramB.body);
    expect(posA.x).toBeCloseTo(75, 3);
    expect(posA.y).toBeCloseTo(300, 3);
    expect(posB.x).toBeCloseTo(-75, 3);
    expect(posB.y).toBeCloseTo(300, 3);

    // collider offset 保留：shape 中心 = 硬点 + offset(22,0) → A: 97 / B: -97（镜像）
    // Q12-A：ramHead 短粗前置 offset 10 → 22（宽 20×30 → 44×26）
    // 通过 COM 验证：ram collider 中心即 part COM（单 collider、angle 0）
    const comA = world.getCenterOfMass(ramA.body);
    const comB = world.getCenterOfMass(ramB.body);
    expect(comA.x).toBeCloseTo(97, 3);
    expect(comB.x).toBeCloseTo(-97, 3);
    expect(comA.y).toBeCloseTo(300, 3);

    // OwnerTag
    expect(world.getOwnerTag(ramA.body)).toEqual({
      kind: 'vehicle',
      vehicleId: 'boxTest',
      partId: 'part:front',
      team: 'A',
    });
    expect(world.getOwnerTag(ramB.body)?.team).toBe('B');

    // 质量与总质量：50+10+10+30=100
    expect(world.getMass(ramA.body)).toBeCloseTo(30, 6);
    expect(a.totalMass).toBeCloseTo(100, 6);
    expect(b.totalMass).toBeCloseTo(100, 6);

    // Weld 初始锚点近零（chassis 硬点 ↔ part 本地原点精确重合）
    expect(world.getJointAnchorErrorPx(ramA.joint)).toBeLessThan(1e-6);
    expect(world.getJointAnchorErrorPx(ramB.joint)).toBeLessThan(1e-6);

    // 整车 COM 有限
    expect(Number.isFinite(a.com.x) && Number.isFinite(a.com.y)).toBe(true);
    console.log(
      `[B8C-1] A ram pos=(${posA.x.toFixed(1)},${posA.y.toFixed(1)}) com=(${comA.x.toFixed(
        1,
      )},${comA.y.toFixed(1)}) 总质量=${a.totalMass.toFixed(1)} ` +
        `B ram pos=(${posB.x.toFixed(1)},${posB.y.toFixed(1)}) com=(${comB.x.toFixed(1)},${comB.y.toFixed(1)})`,
    );

    // 真实重力/地面步进（贴地 spawn）：Weld 不脱离
    const w2 = new PlanckWorld({ x: 0, y: 10 });
    w2.createStaticGround(0, 700, 4000, 80); // 顶面 660
    const v = createPlanckVehicle(w2, boxWithRam(), 'A', { x: 0, y: 613 });
    let maxErr = 0;
    for (let i = 0; i < 300; i++) {
      w2.stepFixed(1);
      for (const p of v.parts) {
        maxErr = Math.max(maxErr, w2.getJointAnchorErrorPx(p.joint));
      }
    }
    expect(maxErr).toBeLessThan(1);
    console.log(`[B8C-1] 300 步后 Weld maxAnchorErr=${maxErr.toFixed(5)}px (<1 ✓)`);
  });

  it('非零 Hardpoint rotation 真实生效且朝左符号镜像；步进后保持相对角度', () => {
    const world = new PlanckWorld();
    const a = createPlanckVehicle(world, boxWithRamRotated(0.3), 'A', {
      x: 0,
      y: 300,
    });
    const b = createPlanckVehicle(
      world,
      boxWithRamRotated(0.3),
      'B',
      { x: 0, y: 300 },
      -1,
    );

    const ramA = a.parts[0]!;
    const ramB = b.parts[0]!;

    // facing=1 → part angle = +0.3；facing=-1 → -0.3（符号镜像）
    expect(world.getAngle(ramA.body)).toBeCloseTo(0.3, 5);
    expect(world.getAngle(ramB.body)).toBeCloseTo(-0.3, 5);

    // 初始 Weld 锚点近零（旋转后 {0,0} 锚点不变）
    expect(world.getJointAnchorErrorPx(ramA.joint)).toBeLessThan(1e-6);
    expect(world.getJointAnchorErrorPx(ramB.joint)).toBeLessThan(1e-6);

    // 重力/地面步进：贴地 spawn；Weld 锁参考角 → 相对角度保持、锚点 <1px
    const w2 = new PlanckWorld({ x: 0, y: 10 });
    w2.createStaticGround(0, 700, 4000, 80);
    const v = createPlanckVehicle(w2, boxWithRamRotated(0.3), 'A', {
      x: 0,
      y: 613,
    });
    const ram = v.parts[0]!;
    const chassisAngle0 = w2.getAngle(v.body);
    const rel0 = w2.getAngle(ram.body) - chassisAngle0;
    let maxErr = 0;
    for (let i = 0; i < 300; i++) {
      w2.stepFixed(1);
      maxErr = Math.max(maxErr, w2.getJointAnchorErrorPx(ram.joint));
    }
    const rel1 = w2.getAngle(ram.body) - w2.getAngle(v.body);
    expect(maxErr).toBeLessThan(1);
    expect(rel1).toBeCloseTo(rel0, 3);
    console.log(
      `[B8C-2] A angle=+0.3 / B angle=-0.3（镜像 ✓）｜300 步后 Weld maxErr=${maxErr.toFixed(
        5,
      )}px 相对角度 ${rel0.toFixed(4)}→${rel1.toFixed(4)}（保持 ✓）`,
    );
  });
});
