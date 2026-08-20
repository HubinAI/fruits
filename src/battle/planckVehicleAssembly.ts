/**
 * Planck 车辆装配（Queue F-02M-B8A）—— 最小 PlanckVehicle Chassis 装配。
 *
 * 约束：
 * - 本文件禁止 import `src/physics/adapter.ts` 或 `matter-js`（Planck 文件边界）。
 * - 碰撞 category/mask/group 与现有正式规则（Matter vehicleAssembly.ts）保持一致，
 *   数值本地定义（见 PlanckCategory 注释），后续若有共享常量层再迁移。
 * - 本轮只装配 chassis（body compound），不装 wheels / functionals。
 */
import type { ResolvedSnapshot } from '../core/buildSnapshot';
import type {
  ColliderDef,
  FunctionalHardpointDef,
  FunctionalPartDef,
  MovementHardpointDef,
  OwnerTag,
  TeamId,
  WheelDef,
} from '../core/types';
import type {
  BodyHandle,
  JointHandle,
  PlanckCollisionFilter,
  PlanckWorld,
} from '../physics/planckWorld';

/**
 * 碰撞类别（bitmask）—— 与 `src/physics/adapter.ts` 的 Category 数值完全一致。
 * 禁止 import adapter.ts，故本地复制并加同步约束注释。
 */
export const PlanckCategory = {
  GROUND: 0x0001,
  ARENA: 0x0002,
  VEHICLE_A: 0x0004,
  VEHICLE_B: 0x0008,
  PROJECTILE: 0x0010,
  HAZARD: 0x0020,
} as const;

export type PlanckCategoryValue =
  (typeof PlanckCategory)[keyof typeof PlanckCategory];

/** 轮子运行时（B8B：真实 Revolute 装配；motor/drive 留待后续队列） */
export interface PlanckWheelRuntime {
  /** hardpoint id（如 rear / front） */
  id: string;
  def: WheelDef;
  hardpoint: MovementHardpointDef;
  body: BodyHandle;
  joint: JointHandle;
  grounded: boolean;
}

/** 部件运行时（B8C：Fixed Mount 用 Weld 刚性连接；Behavior 留待后续队列） */
export interface PlanckPartRuntime {
  /** hardpoint id（如 front / top / rear） */
  id: string;
  def: FunctionalPartDef;
  hardpoint: FunctionalHardpointDef;
  body: BodyHandle;
  joint: JointHandle;
}

/** Planck 车辆运行时（chassis 装配，含聚合物理量） */
export interface PlanckVehicle {
  /** build id（= BuildSnapshot.id） */
  id: string;
  team: TeamId;
  /** 朝向：+1 朝右（+X），-1 朝左（-X）。镜像而非旋转，保证轮子始终朝下。 */
  facing: 1 | -1;
  resolved: ResolvedSnapshot;
  /** chassis compound BodyHandle */
  body: BodyHandle;
  wheels: PlanckWheelRuntime[];
  parts: PlanckPartRuntime[];
  hp: number;
  maxHp: number;
  /** 总质量（本轮 = body.baseMass） */
  totalMass: number;
  /** 真实世界 COM（px） */
  com: { x: number; y: number };
}

function vehicleCategory(team: TeamId): PlanckCategoryValue {
  return team === 'A' ? PlanckCategory.VEHICLE_A : PlanckCategory.VEHICLE_B;
}

function vehicleGroup(team: TeamId): number {
  return team === 'A' ? -1 : -2;
}

function vehicleMask(team: TeamId): number {
  const other =
    team === 'A' ? PlanckCategory.VEHICLE_B : PlanckCategory.VEHICLE_A;
  // 不含自身 category：同车互撞由负数 group 关闭，mask 层也不应包含自己
  return (
    PlanckCategory.GROUND |
    PlanckCategory.ARENA |
    PlanckCategory.PROJECTILE |
    PlanckCategory.HAZARD |
    other
  );
}

/** facing=-1 时镜像 collider（与 Matter vehicleAssembly.mirrorCollider 逻辑一致） */
function mirrorCollider(c: ColliderDef): ColliderDef {
  const m: ColliderDef = { ...c, offset: { x: -c.offset.x, y: c.offset.y } };
  if (c.angle !== undefined) m.angle = -c.angle;
  if (c.shape === 'polygon' && c.vertices) {
    m.vertices = [...c.vertices].reverse().map((v) => ({ x: -v.x, y: v.y }));
  }
  return m;
}

/** 本地向量旋转（px；顺时针为正，与项目 Y-down 一致） */
function rotateLocal(p: { x: number; y: number }, angle: number): { x: number; y: number } {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos };
}

/**
 * Planck 整车无冲量贴地静置（B16B）：
 * - 复用 Matter 已验证的轮径差姿态公式 theta = facing × atan2(rearR − frontR, wheelbase)；
 * - 旋转 chassis 后按 theta 旋转镜像 hardpoint 重新摆放所有 wheels / parts
 *   （Revolute/Weld 锚点精确重合，禁止让求解器把错误装配拉回）；
 * - parts angle = theta + facing × localRotation（保持 Weld referenceAngle，无内部应力）；
 * - 合并 chassis + wheels + parts 的 getCollisionBounds，与 ground 碰撞边界 minY 对齐
 *   （整车统一平移，使碰撞 maxY 精确等于 ground minY）；
 * - 平移后清零所有车辆 body 线速度/角速度，保持已计算姿态；
 * - 更新 vehicle.com 为当前真实质量加权 COM（totalMass 不变）；不修改 wheel.grounded。
 */
export function settlePlanckVehicleToRestPose(
  world: PlanckWorld,
  vehicle: PlanckVehicle,
  groundBody: BodyHandle,
): void {
  // 轮径差姿态（与 Matter settleVehicleToRestPose 同公式）
  const rear = vehicle.wheels.find((w) => w.id === 'rear');
  const front = vehicle.wheels.find((w) => w.id === 'front');
  if (rear && front) {
    const wheelbase = Math.abs(
      front.hardpoint.localPosition.x - rear.hardpoint.localPosition.x,
    );
    const theta =
      vehicle.facing * Math.atan2(rear.def.radius - front.def.radius, wheelbase);
    world.setAngle(vehicle.body, theta);
    const chassisPos = world.getPosition(vehicle.body);

    // wheels：按 theta 旋转镜像硬点重新定位（Revolute 锚点 = wheel 圆心，保持精确重合）
    for (const w of vehicle.wheels) {
      const hp = rotateLocal(
        { x: vehicle.facing * w.hardpoint.localPosition.x, y: w.hardpoint.localPosition.y },
        theta,
      );
      world.setPosition(w.body, chassisPos.x + hp.x, chassisPos.y + hp.y);
    }
    // parts：position 跟随旋转后硬点；angle = theta + facing×localRotation（Weld 相对角不变）
    for (const p of vehicle.parts) {
      const hp = rotateLocal(
        { x: vehicle.facing * p.hardpoint.localPosition.x, y: p.hardpoint.localPosition.y },
        theta,
      );
      world.setPosition(p.body, chassisPos.x + hp.x, chassisPos.y + hp.y);
      world.setAngle(p.body, theta + vehicle.facing * (p.hardpoint.localRotation ?? 0));
    }
  }

  // 合并整车碰撞边界
  let minY = Infinity;
  let maxY = -Infinity;
  const merge = (bb: { minX: number; minY: number; maxX: number; maxY: number }): void => {
    minY = Math.min(minY, bb.minY);
    maxY = Math.max(maxY, bb.maxY);
  };
  merge(world.getCollisionBounds(vehicle.body));
  for (const w of vehicle.wheels) merge(world.getCollisionBounds(w.body));
  for (const p of vehicle.parts) merge(world.getCollisionBounds(p.body));

  // 整车统一平移：碰撞 maxY 精确等于 ground 碰撞 minY（仅 y 平移，x 不变）
  const deltaY = world.getCollisionBounds(groundBody).minY - maxY;
  const shiftY = (body: BodyHandle): void => {
    const pos = world.getPosition(body);
    world.setPosition(body, pos.x, pos.y + deltaY);
  };
  shiftY(vehicle.body);
  for (const w of vehicle.wheels) shiftY(w.body);
  for (const p of vehicle.parts) shiftY(p.body);

  // 平移后清零所有车辆 body 线/角速度（保持姿态）
  const zeroVel = (body: BodyHandle): void => {
    world.setLinearVelocity(body, 0, 0);
    world.setAngularVelocity(body, 0);
  };
  zeroVel(vehicle.body);
  for (const w of vehicle.wheels) zeroVel(w.body);
  for (const p of vehicle.parts) zeroVel(p.body);

  // 更新 vehicle.com：当前真实质量加权 COM（totalMass 不变）
  let mx = 0;
  let my = 0;
  const acc = (body: BodyHandle): void => {
    const m = world.getMass(body);
    const c = world.getCenterOfMass(body);
    mx += c.x * m;
    my += c.y * m;
  };
  acc(vehicle.body);
  for (const w of vehicle.wheels) acc(w.body);
  for (const p of vehicle.parts) acc(p.body);
  vehicle.com = { x: mx / vehicle.totalMass, y: my / vehicle.totalMass };
}

/**
 * 创建 Planck 车辆 chassis（body compound + OwnerTag）。
 * 同车所有 body 使用相同负数 group（A=-1 / B=-2），保证「默认关闭同车普通
 * Collider 互撞」；category/mask 与正式规则一致。材质 friction 0.5、restitution 0.05。
 */
export function createPlanckVehicle(
  world: PlanckWorld,
  resolved: ResolvedSnapshot,
  team: TeamId,
  initialPos: { x: number; y: number },
  facing: 1 | -1 = 1,
): PlanckVehicle {
  const filter: PlanckCollisionFilter = {
    categoryBits: vehicleCategory(team),
    maskBits: vehicleMask(team),
    groupIndex: vehicleGroup(team),
  };

  // Body 主刚体（compound）。facing=-1 时镜像碰撞轮廓（前鼻指向左）。
  const colliders = resolved.body.colliders.map((c) =>
    facing === -1 ? mirrorCollider(c) : c,
  );

  const body = world.createDynamicCompound(
    initialPos.x,
    initialPos.y,
    colliders,
    resolved.body.baseMass,
    { friction: 0.5, restitution: 0.05, collisionFilter: filter },
  );

  const ownerTag: OwnerTag = {
    kind: 'vehicle',
    vehicleId: resolved.snapshot.id,
    partId: 'body',
    team,
  };
  world.setOwnerTag(body, ownerTag);

  // 2. Wheel 物理件：硬点 X 镜像（朝左时前/后轮对调），Y 保持不变（轮子朝下）。
  //    与 Matter vehicleAssembly 语义一致：wheelPos = initialPos + (facing*hp.x, hp.y)。
  const wheels: PlanckWheelRuntime[] = resolved.movements.map((m) => {
    const hpWorld = {
      x: facing * m.hardpoint.localPosition.x,
      y: m.hardpoint.localPosition.y,
    };
    const wheelPos = {
      x: initialPos.x + hpWorld.x,
      y: initialPos.y + hpWorld.y,
    };
    // wheel 用真实半径/质量/grip（→ friction）；同车碰撞过滤（category/mask/group）
    const wheel = world.createDynamicCircle(
      wheelPos.x,
      wheelPos.y,
      m.def.radius,
      m.def.mass,
      {
        friction: m.def.grip,
        restitution: 0.05,
        collisionFilter: filter,
      },
    );
    world.setOwnerTag(wheel, {
      kind: 'vehicle',
      vehicleId: resolved.snapshot.id,
      partId: `wheel:${m.install.hardpointId}`,
      team,
    });
    // chassis 本地硬点与 wheel 原点创建时精确重合，再建 RevoluteJoint
    const joint = world.createRevoluteJoint(
      body,
      hpWorld, // chassis 本地锚点 = 硬点（px）
      wheel,
      { x: 0, y: 0 }, // wheel 本地锚点 = 圆心
    );
    return {
      id: m.install.hardpointId,
      def: m.def,
      hardpoint: m.hardpoint,
      body: wheel,
      joint,
      grounded: false,
    };
  });

  // 3. Functional Part（Fixed Mount，Weld）。facing=-1 时镜像硬点与碰撞轮廓；
  //    Hardpoint localRotation 真实生效（朝左符号镜像）。part body 原点 = 镜像后
  //    硬点世界位置，collider offset/angle 由 compound 保留（shape 中心 = 硬点+offset）。
  const parts: PlanckPartRuntime[] = resolved.functionals.map((f) => {
    const collider =
      facing === -1 ? mirrorCollider(f.def.collider) : f.def.collider;
    const hpWorld = {
      x: facing * f.hardpoint.localPosition.x,
      y: f.hardpoint.localPosition.y,
    };
    const partPos = {
      x: initialPos.x + hpWorld.x,
      y: initialPos.y + hpWorld.y,
    };
    // 单 collider Compound（真实 offset/angle）、真实 part mass、同车负 group
    const partBody = world.createDynamicCompound(
      partPos.x,
      partPos.y,
      [collider],
      f.def.mass,
      { friction: 0.4, restitution: 0.05, collisionFilter: filter },
    );
    // Hardpoint localRotation 真实生效（朝左符号镜像）；Weld 会锁定该相对角度
    world.setAngle(partBody, facing * (f.hardpoint.localRotation ?? 0));
    world.setOwnerTag(partBody, {
      kind: 'vehicle',
      vehicleId: resolved.snapshot.id,
      partId: `part:${f.install.hardpointId}`,
      team,
    });
    // 连接：chassis 本地硬点 ↔ part 本地原点。part body 原点即硬点世界位置，
    // 创建瞬间两锚点精确重合，不得让求解器把错误装配拉回。
    // Q03-F2：Hammer 为 Revolute 件——摆动摆锤（pivot=挂点、质量远端集中、
    // motor/limit 由 HammerBehavior 驱动）。Q04-F2：Push Rod 为 Prismatic 伸缩件——
    // axis 取 chassis 本地 ±X（facing 前方，跟随 chassis 姿态的本地轴，非固定世界 X；
    // motor/limit 由后续 PushRodBehavior 驱动）。
    // Q12-B：Lifter（举升臂）为 Revolute 件——低位待机 → 主动上翻 → 回落
    // （motor/limit 由 LifterBehavior 驱动）。
    // 其余 Functional Part（ram / cannon / gadget）保持 Weld 刚性连接。
    const joint =
      f.def.behavior === 'hammer' || f.def.behavior === 'lifter'
        ? world.createRevoluteJoint(
            body,
            hpWorld,
            partBody,
            { x: 0, y: 0 },
          )
        : f.def.behavior === 'pushRod'
          ? world.createPrismaticJoint(
              body,
              hpWorld,
              partBody,
              { x: 0, y: 0 },
              { x: facing, y: 0 },
            )
          : world.createWeldJoint(
              body,
              hpWorld,
              partBody,
              { x: 0, y: 0 },
            );
    return {
      id: f.install.hardpointId,
      def: f.def,
      hardpoint: f.hardpoint,
      body: partBody,
      joint,
    };
  });

  // 4. 聚合物理量：总质量 = body + wheels + parts；质量加权真实 COM
  let totalMass = resolved.body.baseMass;
  for (const w of wheels) totalMass += w.def.mass;
  for (const p of parts) totalMass += p.def.mass;
  const bodyCom = world.getCenterOfMass(body);
  let comX = bodyCom.x * resolved.body.baseMass;
  let comY = bodyCom.y * resolved.body.baseMass;
  for (const w of wheels) {
    const c = world.getCenterOfMass(w.body);
    comX += c.x * w.def.mass;
    comY += c.y * w.def.mass;
  }
  for (const p of parts) {
    const c = world.getCenterOfMass(p.body);
    comX += c.x * p.def.mass;
    comY += c.y * p.def.mass;
  }
  const com = { x: comX / totalMass, y: comY / totalMass };

  return {
    id: resolved.snapshot.id,
    team,
    facing,
    resolved,
    body,
    wheels,
    parts,
    hp: resolved.body.hp,
    maxHp: resolved.body.hp,
    totalMass,
    com,
  };
}
