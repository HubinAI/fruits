/**
 * Vehicle Assembly：把 Build Snapshot 装配成真实物理实体。
 *
 * 真实 Assembly 组成：
 * - Body 主刚体（compound，来自 BodyDef.colliders，质量 = baseMass）；
 * - Wheel 物理件（独立刚体 + Revolute Joint 挂 Movement Hardpoint）；
 * - Functional Part（独立刚体 + Weld Joint 挂 Functional Hardpoint，Fixed Mount）。
 *
 * 固定安装部件的 Mass + Local Position 真实影响整车质量分布：
 * - 每个部件都是真实刚体（真实 mass / position）；
 * - 整车 COM / Inertia 由「各部件质量 + 到 COM 的距离」聚合（平行轴定理）。
 */
import type { Body, Constraint } from 'matter-js';
import type { ResolvedSnapshot } from '../core/buildSnapshot';
import type {
  FunctionalPartDef,
  MovementHardpointDef,
  FunctionalHardpointDef,
  TeamId,
  WheelDef,
} from '../core/types';
import {
  Category,
  type CategoryValue,
  PhysWorld,
  createBox,
  createCircle,
  createCompound,
  createRevoluteJoint,
  createWeldJoint,
  getMeta,
  setAngle,
  setMeta,
} from '../physics/adapter';

export interface WheelRuntime {
  /** hardpoint id */
  id: string;
  def: WheelDef;
  hardpoint: MovementHardpointDef;
  body: Body;
  joint: Constraint;
  grounded: boolean;
}

export interface PartRuntime {
  /** hardpoint id */
  id: string;
  def: FunctionalPartDef;
  hardpoint: FunctionalHardpointDef;
  body: Body;
  joint: Constraint;
}

export interface Vehicle {
  id: string;
  team: TeamId;
  resolved: ResolvedSnapshot;
  body: Body;
  wheels: WheelRuntime[];
  parts: PartRuntime[];
  hp: number;
  maxHp: number;
  /** 聚合物理量（每步更新） */
  totalMass: number;
  com: { x: number; y: number };
  inertia: number;
}

function rotate(v: { x: number; y: number }, angle: number): { x: number; y: number } {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
}

function vehicleCategory(team: TeamId): CategoryValue {
  return team === 'A' ? Category.VEHICLE_A : Category.VEHICLE_B;
}

function vehicleGroup(team: TeamId): number {
  return team === 'A' ? -1 : -2;
}

function vehicleMask(team: TeamId): number {
  const other = team === 'A' ? Category.VEHICLE_B : Category.VEHICLE_A;
  // 不含自身 category：同车互撞由负数 group 关闭，mask 层也不应包含自己
  return (
    Category.GROUND |
    Category.ARENA |
    Category.PROJECTILE |
    Category.HAZARD |
    other
  );
}

/**
 * 创建整车物理实体。
 * 同车所有 body 使用相同负数 group，保证「默认关闭同车普通 Collider 互撞」，
 * 但 Joint / Motor 等真实 Reaction 保留。
 */
export function createVehicle(
  world: PhysWorld,
  resolved: ResolvedSnapshot,
  team: TeamId,
  initialPos: { x: number; y: number },
  initialAngle: number,
): Vehicle {
  const cat = vehicleCategory(team);
  const mask = vehicleMask(team);
  const group = vehicleGroup(team);

  const bodyFilter = { category: cat, mask, group };
  const bodyOpts = {
    filter: bodyFilter,
    friction: 0.5,
    restitution: 0.05,
  };

  // 1. Body 主刚体（compound）
  const body = createCompound(
    initialPos.x,
    initialPos.y,
    resolved.body.colliders.map((c) => ({
      shape: c.shape,
      width: c.width,
      height: c.height,
      radius: c.radius,
      vertices: c.vertices,
      offset: c.offset,
      angle: c.angle,
    })),
    resolved.body.baseMass,
    bodyOpts,
  );
  setAngle(body, initialAngle);
  setMeta(body, {
    kind: 'vehicle',
    vehicleId: resolved.snapshot.id,
    partId: 'body',
    team,
  });
  world.add(body);

  // 2. Wheel 物理件
  const wheels: WheelRuntime[] = resolved.movements.map((m) => {
    const hpWorld = rotate(m.hardpoint.localPosition, initialAngle);
    const wheelPos = {
      x: initialPos.x + hpWorld.x,
      y: initialPos.y + hpWorld.y,
    };
    const wheel = createCircle(
      wheelPos.x,
      wheelPos.y,
      m.def.radius,
      m.def.mass,
      {
        filter: { category: cat, mask, group },
        friction: m.def.grip,
        frictionStatic: m.def.grip,
        restitution: 0.05,
      },
    );
    setMeta(wheel, {
      kind: 'vehicle',
      vehicleId: resolved.snapshot.id,
      partId: `wheel:${m.install.hardpointId}`,
      team,
    });
    world.add(wheel);

    const joint = createRevoluteJoint(
      body,
      m.hardpoint.localPosition,
      wheel,
      { x: 0, y: 0 },
    );
    world.addConstraint(joint);

    return {
      id: m.install.hardpointId,
      def: m.def,
      hardpoint: m.hardpoint,
      body: wheel,
      joint,
      grounded: false,
    };
  });

  // 3. Functional Part（Fixed Mount，Weld）
  const parts: PartRuntime[] = resolved.functionals.map((f) => {
    const hpWorld = rotate(f.hardpoint.localPosition, initialAngle);
    const offsetRotated = rotate(f.def.collider.offset, initialAngle);
    const partPos = {
      x: initialPos.x + hpWorld.x + offsetRotated.x,
      y: initialPos.y + hpWorld.y + offsetRotated.y,
    };
    const collider = f.def.collider;
    let partBody: Body;
    if (collider.shape === 'box') {
      partBody = createBox(
        partPos.x,
        partPos.y,
        collider.width ?? 0,
        collider.height ?? 0,
        f.def.mass,
        { filter: { category: cat, mask, group }, friction: 0.4, restitution: 0.05 },
      );
    } else if (collider.shape === 'circle') {
      partBody = createCircle(partPos.x, partPos.y, collider.radius ?? 0, f.def.mass, {
        filter: { category: cat, mask, group },
        friction: 0.4,
        restitution: 0.05,
      });
    } else {
      partBody = createCompound(
        partPos.x,
        partPos.y,
        [{ shape: 'polygon', vertices: collider.vertices, offset: { x: 0, y: 0 } }],
        f.def.mass,
        { filter: { category: cat, mask, group }, friction: 0.4, restitution: 0.05 },
      );
    }
    setAngle(partBody, initialAngle);
    setMeta(partBody, {
      kind: 'vehicle',
      vehicleId: resolved.snapshot.id,
      partId: `part:${f.install.hardpointId}`,
      team,
    });
    world.add(partBody);

    // Weld：body 挂点 = hardpoint.localPosition；part 挂接点 = -offset（part 本地）
    const joint = createWeldJoint(
      body,
      f.hardpoint.localPosition,
      partBody,
      { x: -collider.offset.x, y: -collider.offset.y },
    );
    world.addConstraint(joint);

    return {
      id: f.install.hardpointId,
      def: f.def,
      hardpoint: f.hardpoint,
      body: partBody,
      joint,
    };
  });

  const vehicle: Vehicle = {
    id: resolved.snapshot.id,
    team,
    resolved,
    body,
    wheels,
    parts,
    hp: resolved.body.hp,
    maxHp: resolved.body.hp,
    totalMass: resolved.totalMass,
    com: { x: initialPos.x, y: initialPos.y },
    inertia: 0,
  };

  updateVehiclePhysics(vehicle);
  return vehicle;
}

/** 每步更新整车聚合物理量：Total Mass / COM / Inertia（平行轴定理） */
export function updateVehiclePhysics(v: Vehicle): void {
  let mass = 0;
  let mx = 0;
  let my = 0;

  const accumulate = (b: Body) => {
    mass += b.mass;
    mx += b.position.x * b.mass;
    my += b.position.y * b.mass;
  };

  accumulate(v.body);
  for (const w of v.wheels) accumulate(w.body);
  for (const p of v.parts) accumulate(p.body);

  const com = { x: mx / mass, y: my / mass };

  let inertia = 0;
  const addInertia = (b: Body) => {
    const dx = b.position.x - com.x;
    const dy = b.position.y - com.y;
    inertia += b.inertia + b.mass * (dx * dx + dy * dy);
  };
  addInertia(v.body);
  for (const w of v.wheels) addInertia(w.body);
  for (const p of v.parts) addInertia(p.body);

  v.totalMass = mass;
  v.com = com;
  v.inertia = inertia;
}

/** 查询某 body 属于哪个 vehicle（通过 meta），供 Contact Router 用 */
export function metaOf(body: Body): Record<string, unknown> {
  return getMeta(body);
}
