/**
 * Physics Adapter：唯一直接依赖 Matter.js 的入口。
 *
 * 上层（Battle Runtime / Vehicle Assembly / Contact Router / Lab）不 import 'matter-js'，
 * 全部通过本模块封装的 API 操作物理世界。若未来更换物理引擎，仅需重写本模块。
 *
 * 选定 Matter.js 的原因：
 * - 成熟稳定的 2D 刚体方案（不手写 Solver）；
 * - 纯 JS、无 DOM 依赖，vitest 可 headless 跑真实物理；
 * - 支持 compound fixture / constraint（revolute / weld）/ collision events；
 * - 内置固定步进（Engine.update(delta)），满足 Fixed Physics Timestep。
 */
import Matter from 'matter-js';

export type { Body, Constraint, Engine, Composite, Collision, Pair } from 'matter-js';

/** 固定物理步长（ms）。60Hz。 */
export const FIXED_DT = 1000 / 60;

/** 碰撞类别（bitmask） */
export const Category = {
  GROUND: 0x0001,
  ARENA: 0x0002,
  VEHICLE_A: 0x0004,
  VEHICLE_B: 0x0008,
  PROJECTILE: 0x0010,
  HAZARD: 0x0020,
} as const;

export type CategoryValue = (typeof Category)[keyof typeof Category];

/** 碰撞过滤配置 */
export interface CollisionFilterConfig {
  category: CategoryValue;
  mask: number;
  /** 负数 group = 同组永不碰撞；用于关闭同车内部碰撞 */
  group?: number;
}

export interface BodyOptions {
  filter?: CollisionFilterConfig;
  friction?: number;
  frictionStatic?: number;
  restitution?: number;
  /** 附加元数据（Owner 等），挂到 body.plugin 上 */
  meta?: Record<string, unknown>;
}

/** 归一化后的接触事件 */
export interface ContactEvent {
  bodyA: Matter.Body;
  bodyB: Matter.Body;
  /** 接触点 */
  contactPoint: { x: number; y: number };
  /** 接触法线（从 bodyA 指向 bodyB） */
  normal: { x: number; y: number };
  /** 沿法线的相对速度（正值 = 相互靠近） */
  relativeVelocity: number;
  phase: 'start' | 'active' | 'end';
  /**
   * 碰撞批次边界（同一物理步内一次事件派发的所有 pair 共享同一批次）：
   * - timestamp：本次事件（collisionStart/Active/End）的引擎时间戳，同批一致；
   * - index：本 pair 在当批中的下标（0..size-1，保持 Matter 原始 pair 顺序）；
   * - size：当批 pair 总数。
   * 供上层做「同一物理步内多 pair 去重 / 合并」的边界判定（本层不做去重）。
   */
  batch?: { timestamp: number; index: number; size: number };
}

/** 归一化后的碰撞回调 */
export interface CollisionHandlers {
  onStart?: (ev: ContactEvent) => void;
  onActive?: (ev: ContactEvent) => void;
  onEnd?: (ev: ContactEvent) => void;
}

/** 多边形面积（shoelace） */
export function polygonArea(verts: { x: number; y: number }[]): number {
  let area = 0;
  for (let i = 0; i < verts.length; i++) {
    const j = (i + 1) % verts.length;
    area += verts[i].x * verts[j].y - verts[j].x * verts[i].y;
  }
  return Math.abs(area) / 2;
}

function toFilter(cfg?: CollisionFilterConfig): Matter.ICollisionFilter | undefined {
  if (!cfg) return undefined;
  return {
    category: cfg.category,
    mask: cfg.mask,
    group: cfg.group ?? 0,
  };
}

function toBodyOptions(opts?: BodyOptions): Matter.IChamferableBodyDefinition {
  const def: Matter.IChamferableBodyDefinition = {};
  if (opts?.filter) def.collisionFilter = toFilter(opts.filter);
  if (opts?.friction !== undefined) def.friction = opts.friction;
  if (opts?.frictionStatic !== undefined) def.frictionStatic = opts.frictionStatic;
  if (opts?.restitution !== undefined) def.restitution = opts.restitution;
  if (opts?.meta) def.plugin = opts.meta;
  return def;
}

/** 依据质量反推 density（density = mass / area） */
function densityFor(mass: number, area: number): number {
  if (area <= 0) return 0.001;
  return mass / area;
}

/**
 * World 封装：持有 Matter Engine，支持固定步进与碰撞事件归一化。
 */
export class PhysWorld {
  readonly engine: Matter.Engine;
  private acc = 0;
  private handlers: CollisionHandlers;

  constructor(
    gravity: { x: number; y: number; scale?: number } = { x: 0, y: 1 },
    handlers: CollisionHandlers = {},
  ) {
    // 关键：重置全局 id 计数器，保证同一初始条件下跨 World 实例的物理确定性。
    // Matter 用全局递增 id 参与 broadphase/solver 迭代顺序，若不重置，
    // 每次新建 World 的 body id 不同 → 迭代顺序不同 → 浮点结果分叉（表现为 Reset 随机翻车）。
    (Matter as unknown as { Common: { _nextId: number } }).Common._nextId = 0;
    this.engine = Matter.Engine.create();
    this.engine.gravity.x = gravity.x;
    this.engine.gravity.y = gravity.y;
    // Gravity 标定（Canonical Foundation，对齐 Queue 02/03 已收敛值）：
    // Matter 用 Verlet 积分 `velocity += (force/mass) * deltaTime²`，deltaTime = FIXED_DT = 1000/60，
    // 因此 gravity.scale 会被放大 FIXED_DT² ≈ 277.8 倍成为实际加速度（px/step²）。
    // 0.01 → 每步 2.78px 加速度，抛射体约 5 步即坠地，弹道/挥击轨迹完全失真；
    // 更严重的是：Matter 的碰撞求解器只改 positionPrev、不回写 body.velocity，
    // 静止/匀速车 body.velocity.y 会因重力项单调累积到终速 ~278（实测 600 步后 vy≈284）。
    // 0.0001 → 每步 0.0278px，车仍正常接地驱动，抛射体获得合理平射弹道，vy 收敛到 <5。
    this.engine.gravity.scale = gravity.scale ?? 0.0001;
    this.handlers = handlers;

    Matter.Events.on(this.engine, 'collisionStart', (e) =>
      this.dispatch(e, 'start'),
    );
    Matter.Events.on(this.engine, 'collisionActive', (e) =>
      this.dispatch(e, 'active'),
    );
    Matter.Events.on(this.engine, 'collisionEnd', (e) =>
      this.dispatch(e, 'end'),
    );
  }

  /** 延迟绑定碰撞处理器（Battle Orchestrator 在装配完成后设置） */
  setCollisionHandlers(handlers: CollisionHandlers): void {
    this.handlers = handlers;
  }

  private dispatch(e: Matter.IEventCollision<Matter.Engine>, phase: ContactEvent['phase']): void {
    const cb =
      phase === 'start'
        ? this.handlers.onStart
        : phase === 'active'
          ? this.handlers.onActive
          : this.handlers.onEnd;
    if (!cb) return;

    for (let i = 0; i < e.pairs.length; i++) {
      const pair = e.pairs[i];
      const normal = pair.collision.normal ?? { x: 0, y: 1 };
      const support = pair.collision.supports?.[0] ?? { x: 0, y: 0 };
      // 接触点速度必须用父刚体（collision.parentA / parentB）而非 sub-part：
      // pair.bodyA/bodyB 是 compound 的 sub-part，其 velocity 字段恒为 stale 0
      // （碰撞求解器只改 positionPrev、不回写 sub-part velocity，见 F-01 根因），
      // 直接读 sub-part 会让 relativeVelocity 恒接近 0（F-02D 实测三场景均为 0）。
      // 旋转接触还必须计入 ω×r：vPoint = vCOM + ω×r，r = contactPoint − COM
      // （F-02D 实测：ω=0.373 时仅用 COM 报 0.81，含旋转的接触点公式报 26.39，差 32 倍）。
      const contactPoint = { x: support.x, y: support.y };
      const rA = {
        x: contactPoint.x - pair.collision.parentA.position.x,
        y: contactPoint.y - pair.collision.parentA.position.y,
      };
      const rB = {
        x: contactPoint.x - pair.collision.parentB.position.x,
        y: contactPoint.y - pair.collision.parentB.position.y,
      };
      const vPointA = {
        x: pair.collision.parentA.velocity.x - pair.collision.parentA.angularVelocity * rA.y,
        y: pair.collision.parentA.velocity.y + pair.collision.parentA.angularVelocity * rA.x,
      };
      const vPointB = {
        x: pair.collision.parentB.velocity.x - pair.collision.parentB.angularVelocity * rB.y,
        y: pair.collision.parentB.velocity.y + pair.collision.parentB.angularVelocity * rB.x,
      };
      // 沿法线（A→B）的相对速度：正值 = 相互靠近
      const relativeVelocity = -((vPointA.x - vPointB.x) * normal.x + (vPointA.y - vPointB.y) * normal.y);
      cb({
        bodyA: pair.bodyA, // 保持原 sub-part：Meta / Owner / Part 路由语义不变
        bodyB: pair.bodyB,
        contactPoint,
        normal: { x: normal.x, y: normal.y },
        relativeVelocity,
        phase,
        batch: {
          timestamp: e.timestamp,
          index: i,
          size: e.pairs.length,
        },
      });
    }
  }

  /** 加入 world */
  add(body: Matter.Body): void {
    Matter.Composite.add(this.engine.world, body);
  }

  addConstraint(constraint: Matter.Constraint): void {
    Matter.Composite.add(this.engine.world, constraint);
  }

  remove(body: Matter.Body): void {
    Matter.Composite.remove(this.engine.world, body);
  }

  /**
   * 固定步进推进。
   * @param realDtMs 真实帧间隔（ms）
   * @param timeScale 时间缩放（1 / 0.5 / 0.25）
   * @param onBeforeStep 每个 FIXED_DT 物理步「Engine.update 之前」执行的回调。
   *   用于把 Drive / Behavior 施加到 body.force（引擎在本次 update 内消费），
   *   保证 30FPS / 60FPS / 轻微卡帧下每个物理步的驱动力一致（帧率无关）。
   */
  step(realDtMs: number, timeScale = 1, onBeforeStep?: () => void): number {
    this.acc += realDtMs * timeScale;
    let steps = 0;
    while (this.acc >= FIXED_DT) {
      onBeforeStep?.();
      Matter.Engine.update(this.engine, FIXED_DT);
      this.acc -= FIXED_DT;
      steps++;
      if (steps > 8) break; // 防 spiral-of-death
    }
    return steps;
  }
}

/* ---------------- Body 工厂 ---------------- */

export function createBox(
  x: number,
  y: number,
  w: number,
  h: number,
  mass: number,
  opts?: BodyOptions,
): Matter.Body {
  const density = densityFor(mass, w * h);
  return Matter.Bodies.rectangle(x, y, w, h, {
    density,
    ...toBodyOptions(opts),
  });
}

export function createCircle(
  x: number,
  y: number,
  radius: number,
  mass: number,
  opts?: BodyOptions,
): Matter.Body {
  const area = Math.PI * radius * radius;
  return Matter.Bodies.circle(x, y, radius, {
    density: densityFor(mass, area),
    ...toBodyOptions(opts),
  });
}

export function createPolygon(
  x: number,
  y: number,
  verts: { x: number; y: number }[],
  mass: number,
  opts?: BodyOptions,
): Matter.Body {
  const area = polygonArea(verts);
  return Matter.Bodies.fromVertices(x, y, [verts], {
    density: densityFor(mass, area),
    ...toBodyOptions(opts),
  });
}

/**
 * Compound Body：多个 Collider 组成一个主刚体，总质量 = mass。
 * 各 Collider 按面积比例分配质量（等价于均匀 density），COM / Inertia 由引擎自动计算。
 */
export function createCompound(
  x: number,
  y: number,
  colliders: Array<{
    shape: 'box' | 'circle' | 'polygon';
    width?: number;
    height?: number;
    radius?: number;
    vertices?: { x: number; y: number }[];
    offset: { x: number; y: number };
    angle?: number;
  }>,
  mass: number,
  opts?: BodyOptions,
): Matter.Body {
  let totalArea = 0;
  for (const c of colliders) {
    if (c.shape === 'box') totalArea += (c.width ?? 0) * (c.height ?? 0);
    else if (c.shape === 'circle') totalArea += Math.PI * (c.radius ?? 0) ** 2;
    else totalArea += polygonArea(c.vertices ?? []);
  }
  const density = densityFor(mass, totalArea);

  const parts = colliders.map((c) => {
    const localOpts: Matter.IChamferableBodyDefinition = {
      density,
      ...toBodyOptions(opts),
    };
    if (c.angle !== undefined) {
      // 通过预旋转 vertices 实现相对角度（Matter 部件不支持 angle 字段）
    }
    if (c.shape === 'box') {
      const p = Matter.Bodies.rectangle(
        c.offset.x,
        c.offset.y,
        c.width ?? 0,
        c.height ?? 0,
        localOpts,
      );
      if (c.angle) Matter.Body.setAngle(p, c.angle);
      return p;
    }
    if (c.shape === 'circle') {
      return Matter.Bodies.circle(
        c.offset.x,
        c.offset.y,
        c.radius ?? 0,
        localOpts,
      );
    }
    return Matter.Bodies.fromVertices(c.offset.x, c.offset.y, [
      c.vertices ?? [],
    ], localOpts);
  });

  const body = Matter.Body.create({
    parts,
    ...toBodyOptions(opts),
  });
  // Matter.Body.create 对 compound 会按 parts 的 COM 重算 position，
  // 覆盖传入的 position；因此必须显式 setPosition。
  Matter.Body.setPosition(body, { x, y });
  return body;
}

/* ---------------- Joint 工厂 ---------------- */

/**
 * Revolute Joint：点对点铰链（Wheel 用）。
 * Matter 没有真正 revolute joint；用 length: 0 + 中等刚度模拟「轴」。
 *
 * 参数标定（01B）：
 * - stiffness 0.5：足够刚性让「前后轮径差」转化为可见 Body 倾角（约 ±17°），
 *   又不会像 1.0 那样把轮子压穿地面（约束求解器与地面碰撞打架）。
 * - damping 0.2：抑制落地/行驶的悬挂振荡，配合 spawn 贴地让 settle 更稳。
 * 根因（非掩盖）：驱动已改为 applyForce@wheel-top + 目标速度控制（无强制 setAngularVelocity），
 * 抬头力矩大幅下降；stiffness 从 0.4 升到 0.5 是为恢复轮径几何效果，属正常物理标定。
 */
export function createRevoluteJoint(
  bodyA: Matter.Body,
  pointA: { x: number; y: number },
  bodyB: Matter.Body,
  pointB: { x: number; y: number },
): Matter.Constraint {
  return Matter.Constraint.create({
    bodyA,
    pointA,
    bodyB,
    pointB,
    length: 0,
    stiffness: 0.5,
    damping: 0.2,
  });
}

/** Fixed Mount（Weld）：刚性固定（Ram Head 等用） */
export function createWeldJoint(
  bodyA: Matter.Body,
  pointA: { x: number; y: number },
  bodyB: Matter.Body,
  pointB: { x: number; y: number },
): Matter.Constraint {
  return Matter.Constraint.create({
    bodyA,
    pointA,
    bodyB,
    pointB,
    length: 0,
    stiffness: 1,
  });
}

/* ---------------- 物理查询 / 工具 ---------------- */

export function getPosition(body: Matter.Body): { x: number; y: number } {
  return { x: body.position.x, y: body.position.y };
}

export function getAngle(body: Matter.Body): number {
  return body.angle;
}

export function getVelocity(body: Matter.Body): { x: number; y: number } {
  return { x: body.velocity.x, y: body.velocity.y };
}

export function getAngularVelocity(body: Matter.Body): number {
  return body.angularVelocity;
}

export function getMass(body: Matter.Body): number {
  return body.mass;
}

export function getInertia(body: Matter.Body): number {
  return body.inertia;
}

export function setAngle(body: Matter.Body, angle: number): void {
  Matter.Body.setAngle(body, angle);
}

export function setPosition(body: Matter.Body, pos: { x: number; y: number }): void {
  Matter.Body.setPosition(body, pos);
}

export function getBounds(body: Matter.Body): { min: { x: number; y: number }; max: { x: number; y: number } } {
  return { min: { x: body.bounds.min.x, y: body.bounds.min.y }, max: { x: body.bounds.max.x, y: body.bounds.max.y } };
}

export function setStatic(body: Matter.Body, isStatic: boolean): void {
  Matter.Body.setStatic(body, isStatic);
}

export function setAngularVelocity(body: Matter.Body, av: number): void {
  Matter.Body.setAngularVelocity(body, av);
}

export function addAngularVelocity(body: Matter.Body, delta: number): void {
  Matter.Body.setAngularVelocity(body, body.angularVelocity + delta);
}

export function setVelocity(body: Matter.Body, vx: number, vy: number): void {
  Matter.Body.setVelocity(body, { x: vx, y: vy });
}

export function applyForce(body: Matter.Body, fx: number, fy: number): void {
  Matter.Body.applyForce(body, body.position, { x: fx, y: fy });
}

/**
 * 在指定世界坐标点施加力（用于把牵引力施加在接地接触点，而非 COM）。
 * 力作用在地面高度时，绕任何地面支撑点的力臂为 0，不产生凭空抬头/低头力矩。
 */
export function applyForceAt(
  body: Matter.Body,
  point: { x: number; y: number },
  fx: number,
  fy: number,
): void {
  Matter.Body.applyForce(body, point, { x: fx, y: fy });
}

/**
 * 设置 body 上挂载的元数据（Owner 等）。
 * 关键：Matter 的 compound sub-part 不继承 parent 的 plugin；且碰撞事件里
 * pair.bodyA/bodyB 是 sub-part（不是 parent），Contact Router 通过 getMeta 读到的正是 sub-part。
 * 因此必须把 meta 同步到所有 sub-parts，否则「车身被撞 / 撞到车身」这类 compound 接触
 * 会读不到 Owner，导致 Impact / Direct Weapon Damage 全部失效。
 * 单 body（wheel / part / ground 等）的 parts === [self]，同步是幂等的。
 */
export function setMeta(body: Matter.Body, meta: Record<string, unknown>): void {
  (body as unknown as { plugin: Record<string, unknown> }).plugin = meta;
  for (const part of body.parts) {
    if (part !== body) {
      (part as unknown as { plugin: Record<string, unknown> }).plugin = meta;
    }
  }
}

export function getMeta(body: Matter.Body): Record<string, unknown> {
  return ((body as unknown as { plugin?: Record<string, unknown> }).plugin ?? {}) as Record<string, unknown>;
}
