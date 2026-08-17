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
  ColliderDef,
  FunctionalPartDef,
  MovementHardpointDef,
  FunctionalHardpointDef,
  TeamId,
  WheelDef,
  PushRodParams,
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
  setPosition,
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
  /** Weld/Revolute Joint；Push Rod 无约束（运动学控制），为 null */
  joint: Constraint | null;
  /** Push Rod 状态机（Gadget） */
  pushPhase?: 'idle' | 'extending' | 'holding' | 'retracting';
  /** 当前伸出量（px） */
  pushExtension?: number;
  /** 阶段计时（ms）：idle=冷却剩余，holding=保持剩余 */
  pushTimer?: number;
}

export interface Vehicle {
  id: string;
  team: TeamId;
  /** 朝向：+1 朝右（+X），-1 朝左（-X）。镜像而非旋转，保证轮子始终朝下。 */
  facing: 1 | -1;
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

/**
 * 镜像 Collider（绕 Y 轴翻转 X）。
 * 用于「朝左（facing=-1）」的装配：车身/部件的斜面、偏移、顶点都镜像，
 * 使前鼻始终指向 facing 方向；轮子硬点保持 Y 不变（轮子永远朝下）。
 */
function mirrorCollider(c: ColliderDef): ColliderDef {
  const m: ColliderDef = { ...c, offset: { x: -c.offset.x, y: c.offset.y } };
  if (c.angle !== undefined) m.angle = -c.angle;
  if (c.shape === 'polygon' && c.vertices) {
    m.vertices = [...c.vertices].reverse().map((v) => ({ x: -v.x, y: v.y }));
  }
  return m;
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
  facing: 1 | -1 = 1,
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

  // 1. Body 主刚体（compound）。facing=-1 时镜像碰撞轮廓（前鼻指向左）。
  const bodyColliders = resolved.body.colliders.map((c) =>
    facing === -1 ? mirrorCollider(c) : c,
  );
  const body = createCompound(
    initialPos.x,
    initialPos.y,
    bodyColliders,
    resolved.body.baseMass,
    bodyOpts,
  );
  // 车身初始正立（角度 0）；朝向由镜像表达，而非 180° 旋转（避免轮子翻到车顶）。
  setAngle(body, 0);
  setMeta(body, {
    kind: 'vehicle',
    vehicleId: resolved.snapshot.id,
    partId: 'body',
    team,
  });
  world.add(body);

  // 2. Wheel 物理件：硬点 X 镜像（朝左时前/后轮对调），Y 保持不变（轮子朝下）。
  const wheels: WheelRuntime[] = resolved.movements.map((m) => {
    const hpWorld = {
      x: facing * m.hardpoint.localPosition.x,
      y: m.hardpoint.localPosition.y,
    };
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
      hpWorld,
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

  // 3. Functional Part（Fixed Mount，Weld）。facing=-1 时镜像硬点与碰撞轮廓。
  const parts: PartRuntime[] = resolved.functionals.map((f) => {
    // Push Rod（Linear Gadget）：单 box 杆，无 Joint，由 weaponPushRod 运动学控制伸出/收回。
    // 真实参与碰撞（category=vehicle、mask 含敌车），推动敌人靠 Matter 碰撞求解器接触反作用。
    if (f.def.behavior === 'pushRod') {
      const params = f.def.behaviorParams as unknown as PushRodParams;
      const hpLocal = {
        x: facing * f.hardpoint.localPosition.x,
        y: f.hardpoint.localPosition.y,
      };
      const hpWorld = { x: initialPos.x + hpLocal.x, y: initialPos.y + hpLocal.y };
      // 收回状态：杆后端贴 hardpoint，杆中心在 hardpoint + facing * rodLength/2
      const rodCenterX = hpWorld.x + facing * (params.rodLength / 2);
      // rod 是纯运动学刚体（weaponPushRod 每步 setPosition 控制位置），mask=0 不参与碰撞，
      // 避免「收回时尖端嵌进目标 → 碰撞位置修正 vs setPosition 冲突」产生 velocity 震荡。
      // 推动敌人靠 touchingOpponent 手动接触检测 + 显式冲量（真实力），不靠 rod 的 Collider 硬推。
      const rod = createBox(
        rodCenterX,
        hpWorld.y,
        params.rodLength,
        params.rodThickness,
        params.rodMass,
        { filter: { category: cat, mask: 0, group }, friction: 0.4, restitution: 0.05 },
      );
      setMeta(rod, {
        kind: 'vehicle',
        vehicleId: resolved.snapshot.id,
        partId: `part:${f.install.hardpointId}`,
        team,
      });
      world.add(rod);
      return {
        id: f.install.hardpointId,
        def: f.def,
        hardpoint: f.hardpoint,
        body: rod,
        joint: null,
        pushPhase: 'idle',
        pushExtension: 0,
        pushTimer: params.cooldown,
      };
    }

    const collider = facing === -1 ? mirrorCollider(f.def.collider) : f.def.collider;
    const hpWorld = {
      x: facing * f.hardpoint.localPosition.x,
      y: f.hardpoint.localPosition.y,
    };
    const partPos = {
      x: initialPos.x + hpWorld.x + collider.offset.x,
      y: initialPos.y + hpWorld.y + collider.offset.y,
    };
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
    setAngle(partBody, collider.angle ?? 0);
    setMeta(partBody, {
      kind: 'vehicle',
      vehicleId: resolved.snapshot.id,
      partId: `part:${f.install.hardpointId}`,
      team,
    });
    world.add(partBody);

    // Weld：body 挂点 = 镜像后的硬点（body 本地）；part 挂接点 = -offset（part 本地）
    const joint = createWeldJoint(
      body,
      hpWorld,
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
    facing,
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

/**
 * 整车（含 wheel / part）平移到「最低点（车底，即最大 y）= groundY」。
 * 消除「从空中落下→弹跳→混沌分叉」的 Reset 非确定性（Matter 浮点对初始下落高度极敏感）。
 * 注意：Matter y 轴向下，车底 = 最大 y；用顶点求最大 y（body.bounds 在 setPosition/setAngle 后
 * 只更新 part.bounds 不更新聚合 bounds，且 bounds.min 是车顶而非车底，易错）。
 */
export function settleVehicleToGround(v: Vehicle, groundY: number): void {
  const bodies: Body[] = [
    v.body,
    ...v.wheels.map((w) => w.body),
    ...v.parts.map((p) => p.body),
  ];
  let maxY = -Infinity;
  for (const b of bodies) {
    const parts = b.parts.length > 0 ? b.parts : [b];
    for (const part of parts) {
      for (const vert of part.vertices) {
        if (vert.y > maxY) maxY = vert.y;
      }
    }
  }
  const dy = groundY - maxY;
  for (const b of bodies) setPosition(b, { x: b.position.x, y: b.position.y + dy });
}

function rotateLocal(v: { x: number; y: number }, angle: number): { x: number; y: number } {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
}

/**
 * 沉降到「轮径差决定的静止姿态」。
 * 前后轮半径不同 → 两轮中心高度差 = Δr → 车身刚性倾角 θ = atan(Δr / 轴距)。
 * 先把车身摆到该几何倾角、把轮子放到旋转后的硬点位置，再整体下沉到地面接触。
 * 这样出生即处于正确静止姿态，无「前轮浮空 → 车身回平」的下落弹跳（Matter 软约束会吸收轮高差）。
 * 注意：这不是伪造姿态——θ 直接由轮径差 + 轴距几何导出，属于正确的初始物理条件。
 */
export function settleVehicleToRestPose(v: Vehicle, groundY: number): void {
  const rear = v.wheels.find((w) => w.id === 'rear');
  const front = v.wheels.find((w) => w.id === 'front');
  if (rear && front) {
    const wheelbase = Math.abs(front.hardpoint.localPosition.x - rear.hardpoint.localPosition.x);
    const theta = v.facing * Math.atan2(rear.def.radius - front.def.radius, wheelbase);
    setAngle(v.body, theta);
    for (const w of v.wheels) {
      const hp = rotateLocal(
        { x: v.facing * w.hardpoint.localPosition.x, y: w.hardpoint.localPosition.y },
        theta,
      );
      setPosition(w.body, { x: v.body.position.x + hp.x, y: v.body.position.y + hp.y });
    }
  }
  settleVehicleToGround(v, groundY);
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
