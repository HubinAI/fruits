/**
 * Planck 最小适配内核（Queue F-02M-A3 / A4 / A5）——
 * 不向上层泄漏 Planck 类型的最小 World / Body / Revolute API；
 * 支持可配置重力、静态地面、最小 contact 事件桥接。
 *
 * 约束：
 * - `import * as planck from 'planck'` 只允许存在于本文件。
 * - 对外只导出 BodyHandle / JointHandle / ContactBridgeEvent / PlanckWorld；
 *   Handle 为不透明对象，不得导出、返回或暴露 planck.Body/Joint/World。
 * - 每个 PlanckWorld 用私有 Map 管理 handle↔native；传入其他 world 的 handle 抛错。
 * - 全部换算只调用 units.ts；不翻转 Y 轴。
 * - 不实现 gameplay Meta、damage、relativeVelocity 伤害判定、collision category
 *   复杂规则、force、torque、impulse（留待后续队列）。
 * - 不提供任何 native escape hatch。
 * - 非有限数、非正尺寸/半径/质量立即抛错。
 */
import * as planck from 'planck';
import type { OwnerTag, ColliderDef } from '../core/types';
import {
  SECONDS_PER_STEP,
  PX_PER_M,
  pxToM,
  mToPx,
  pxPerStepToMps,
  mpsToPxPerStep,
  radPerStepToRadPerSec,
  radPerSecToRadPerStep,
} from './units';

/** 模块内部、不导出的 opaque 键（类型级不透明，外部无法构造/读取） */
const BODY_HANDLE_KEY: unique symbol = Symbol('PlanckBodyHandle');
const JOINT_HANDLE_KEY: unique symbol = Symbol('PlanckJointHandle');

/** 不透明 Body 句柄（类型级 opaque；运行时为冻结空对象，绝不暴露 native body） */
export interface BodyHandle {
  readonly [BODY_HANDLE_KEY]: void;
}

/** 不透明 Joint 句柄（类型级 opaque；运行时为冻结空对象，绝不暴露 native joint） */
export interface JointHandle {
  readonly [JOINT_HANDLE_KEY]: void;
}

/**
 * 接触事件（A5+B3）：携带 begin/end 与双方不透明 handle + 接触运动学快照。
 * bodyA/bodyB 已按内部创建序号规范化排序——同一对物体的 begin/end
 * 事件顺序一致，与碰撞检测中的 fixture 顺序无关。
 *
 * 运动学（B3）：
 * - contactPoint：世界接触点（px）；
 * - normal：单位向量，从最终规范化 bodyA 指向 bodyB；
 * - relativeVelocity：(vPointA − vPointB)·normal，经 mpsToPxPerStep 换算，
 *   正值 = 相互靠近；不取绝对值、不强制截零。
 * - begin 快照按 Contact 私有缓存，end 复用同一快照（避免分离时 manifold 失效）。
 *
 * 批次（B4A）：仅批次监听（setBatchedContactListener）派发的事件携带 batch；
 * 即时监听（setContactListener）的事件 batch 恒为 undefined（绝不被延迟）。
 */
export interface ContactBridgeEvent {
  phase: 'begin' | 'end';
  bodyA: BodyHandle;
  bodyB: BodyHandle;
  contactPoint: { x: number; y: number };
  normal: { x: number; y: number };
  relativeVelocity: number;
  /** 批次边界（仅批次监听）：同物理步同 phase 共享 timestamp/size，index 连续 0..size-1 */
  batch?: { timestamp: number; index: number; size: number };
}

/**
 * 碰撞过滤配置（B2）：映射 Planck fixture 的 category/mask/group。
 * - categoryBits: 1..0xffff（整数）
 * - maskBits: 0..0xffff（整数）
 * - groupIndex: 可选，-32768..32767（整数）；相同非零 groupIndex 时
 *   正 = 强制碰撞、负 = 永不碰撞（此时 mask 被忽略，Planck 语义）。
 */
export interface PlanckCollisionFilter {
  categoryBits: number;
  maskBits: number;
  groupIndex?: number;
}

/**
 * 统一动态 Body 材质/过滤选项（B7A1）：Box / Circle / Polygon 共用。
 * - friction: >= 0（默认 0）
 * - restitution: 0..1（默认 0）
 * - collisionFilter: 可选（默认全碰撞）
 */
export interface PlanckBodyOptions {
  friction?: number;
  restitution?: number;
  collisionFilter?: PlanckCollisionFilter;
}

function createBodyHandle(): BodyHandle {
  return Object.freeze({ [BODY_HANDLE_KEY]: undefined }) as BodyHandle;
}

function createJointHandle(): JointHandle {
  return Object.freeze({ [JOINT_HANDLE_KEY]: undefined }) as JointHandle;
}

/** 合并 fixture def 与碰撞过滤（B2）：仅当传入 filter 时附加 category/mask/group 字段 */
function filterFixtureDef(
  base: { density?: number; friction?: number; restitution?: number },
  filter?: PlanckCollisionFilter,
): { density?: number; friction?: number; restitution?: number; filterCategoryBits?: number; filterMaskBits?: number; filterGroupIndex?: number } {
  if (!filter) return base;
  return {
    ...base,
    filterCategoryBits: filter.categoryBits,
    filterMaskBits: filter.maskBits,
    filterGroupIndex: filter.groupIndex ?? 0,
  };
}

/** 多边形有向面积（shoelace，单位与顶点一致） */
function polygonAreaM2(verts: { x: number; y: number }[]): number {
  let s = 0;
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i]!;
    const b = verts[(i + 1) % verts.length]!;
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

/**
 * 多边形顶点校验 + CCW 规范化（B7A1）：
 * - 非有限 → 抛错；顶点数 <3 或 >8 → 抛错；
 * - 零面积（含自交归零）→ 抛错；相邻共线/重复边 → 抛错；
 * - 凹多边形 → 抛错；
 * - 支持顺/逆时针：逆时针（CCW）保持，顺时针（CW）反转；
 * - 统一 px→m 换算，返回 planck.Vec2[]。
 */
function normalizePolygonVertices(verticesPx: { x: number; y: number }[]): planck.Vec2[] {
  const n = verticesPx.length;
  for (const v of verticesPx) assertFinite(v.x, v.y);
  if (n < 3 || n > 8) {
    throw new Error(`PlanckWorld: 多边形顶点数必须为 3..8，收到 ${n}`);
  }
  // 凸性 + 方向（相邻叉积同号）
  const cross = (a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): number =>
    (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const c = cross(verticesPx[i]!, verticesPx[(i + 1) % n]!, verticesPx[(i + 2) % n]!);
    if (Math.abs(c) < 1e-9) {
      throw new Error(`PlanckWorld: 多边形存在重复边/共线顶点（索引 ${i}），拒绝`);
    }
    if (sign === 0) sign = Math.sign(c);
    else if (Math.sign(c) !== sign) {
      throw new Error('PlanckWorld: 凹多边形不被支持，拒绝');
    }
  }
  const area = polygonAreaM2(verticesPx);
  if (Math.abs(area) < 1e-9) {
    throw new Error('PlanckWorld: 多边形面积为零，拒绝');
  }
  // CCW 规范化：CCW（area>0）保持，CW（area<0）反转
  const ordered = area > 0 ? [...verticesPx] : [...verticesPx].reverse();
  return ordered.map((v) => planck.Vec2(pxToM(v.x), pxToM(v.y)));
}

/**
 * ColliderDef → Planck shape（B7A2，body 本地坐标）：
 * - box → 4 角点（按 angle 旋转 + offset 平移，统一走 polygon 支持旋转）；
 * - circle → CircleShape(offset 本地位置, radius)；
 * - polygon → 顶点按 angle 旋转 + offset 平移；
 * - 顶点在 px 空间变换后经 normalizePolygonVertices 校验/CCW 规范化/px→m。
 */
function colliderToShape(c: ColliderDef): planck.Shape {
  const off = c.offset ?? { x: 0, y: 0 };
  const ang = c.angle ?? 0;
  if (c.shape === 'circle') {
    const r = c.radius ?? 0;
    if (!(r > 0)) throw new Error('PlanckWorld: circle collider radius 必须为正');
    return planck.CircleShape(planck.Vec2(pxToM(off.x), pxToM(off.y)), pxToM(r));
  }
  let pts: { x: number; y: number }[];
  if (c.shape === 'box') {
    const w = c.width ?? 0;
    const h = c.height ?? 0;
    if (!(w > 0 && h > 0)) throw new Error('PlanckWorld: box collider width/height 必须为正');
    pts = [
      { x: -w / 2, y: -h / 2 },
      { x: w / 2, y: -h / 2 },
      { x: w / 2, y: h / 2 },
      { x: -w / 2, y: h / 2 },
    ];
  } else {
    pts = c.vertices ?? [];
  }
  // 先按 collider angle 旋转，再加 offset（px 空间）
  const cos = Math.cos(ang);
  const sin = Math.sin(ang);
  const rotated = pts.map((v) => ({
    x: v.x * cos - v.y * sin + off.x,
    y: v.x * sin + v.y * cos + off.y,
  }));
  return planck.PolygonShape(normalizePolygonVertices(rotated));
}

/** Collider 面积（px²；offset/angle 不影响面积） */
function colliderAreaPx2(c: ColliderDef): number {
  if (c.shape === 'box') return (c.width ?? 0) * (c.height ?? 0);
  if (c.shape === 'circle') return Math.PI * ((c.radius ?? 0) ** 2);
  return Math.abs(polygonAreaM2(c.vertices ?? []));
}

function assertFinite(...values: number[]): void {
  for (const v of values) {
    if (!Number.isFinite(v)) {
      throw new Error(`PlanckWorld: 非有限数值 ${v} 不被接受`);
    }
  }
}

function assertPositive(...values: number[]): void {
  for (const v of values) {
    if (!(v > 0)) {
      throw new Error(`PlanckWorld: 尺寸/半径/质量必须为正，收到 ${v}`);
    }
  }
}

/** 碰撞过滤校验（B2）：category 1..0xffff、mask 0..0xffff、group -32768..32767，均须整数 */
function assertCollisionFilter(f: PlanckCollisionFilter): void {
  assertFinite(f.categoryBits, f.maskBits);
  if (!Number.isInteger(f.categoryBits) || f.categoryBits < 1 || f.categoryBits > 0xffff) {
    throw new Error(`PlanckWorld: categoryBits 必须是 1..0xffff 的整数，收到 ${f.categoryBits}`);
  }
  if (!Number.isInteger(f.maskBits) || f.maskBits < 0 || f.maskBits > 0xffff) {
    throw new Error(`PlanckWorld: maskBits 必须是 0..0xffff 的整数，收到 ${f.maskBits}`);
  }
  if (
    f.groupIndex !== undefined &&
    (!Number.isInteger(f.groupIndex) || f.groupIndex < -32768 || f.groupIndex > 32767)
  ) {
    throw new Error(`PlanckWorld: groupIndex 必须是 -32768..32767 的整数，收到 ${f.groupIndex}`);
  }
}

/** begin 接触运动学快照（B3）：end 复用 begin 快照并清理 */
interface ContactSnapshot {
  contactPoint: { x: number; y: number };
  normal: { x: number; y: number };
  relativeVelocity: number;
}

/**
 * Planck 世界（游戏层单位；默认零重力，可配置重力）。
 *
 * 重力参数沿用项目坐标语义（m/s²，Y 向下、不翻转）：
 * gravityMps2.y > 0 表示向下重力。
 * （Planck 本身不强制屏幕方向，本适配层沿用项目 Y-down 约定。）
 */
export class PlanckWorld {
  private readonly world: planck.World;
  private readonly bodies = new Map<BodyHandle, planck.Body>();
  private readonly joints = new Map<JointHandle, planck.Joint>();
  /** 保持真实 RevoluteJoint 类型引用（用于 motor 等 Revolute 特有 API，无 as any） */
  private readonly revoluteJoints = new Map<JointHandle, planck.RevoluteJoint>();
  /** Owner Meta：按 handle 私有保存（B1）；输入/返回均防御复制，外部修改不污染内部 */
  private readonly ownerTags = new Map<BodyHandle, OwnerTag>();
  private readonly bodyByNative = new Map<planck.Body, BodyHandle>();
  private readonly bodySeq = new Map<BodyHandle, number>();
  private nextSeq = 1;
  private contactListener: ((e: ContactBridgeEvent) => void) | null = null;
  /** 批次监听（B4A）：每个原生 world.step 完成后统一派发；与即时监听可并存 */
  private batchedListener: ((e: ContactBridgeEvent) => void) | null = null;
  /** 本物理步缓存的事件（B4A）：下一步开始前必须清空并派发，stepFixed(n) 不得跨步合并 */
  private readonly batchedEvents: ContactBridgeEvent[] = [];
  /** 单调物理步计数（B4A）：timestamp = physicsStep × SECONDS_PER_STEP × 1000（禁 Date.now） */
  private physicsStep = 0;
  /** begin 快照按 Contact 私有缓存（B3）：end 使用对应 begin 快照并清理 */
  private readonly contactSnapshots = new Map<planck.Contact, ContactSnapshot>();

  constructor(gravityMps2: { x: number; y: number } = { x: 0, y: 0 }) {
    assertFinite(gravityMps2.x, gravityMps2.y);
    this.world = new planck.World({ gravity: planck.Vec2(gravityMps2.x, gravityMps2.y) });

    // 最小 contact 桥接：不暴露 native contact/fixture/body
    this.world.on('begin-contact', (contact) => {
      this.emitContact('begin', contact);
    });
    this.world.on('end-contact', (contact) => {
      this.emitContact('end', contact);
    });
  }

  /**
   * 设置接触事件监听（A5）。同一对物体的 begin/end 通过内部序号规范化
   * bodyA/bodyB 顺序，与碰撞检测的 fixture 顺序无关。
   * 即时监听：事件在每个原生接触回调内同步派发，batch 恒为 undefined。
   */
  setContactListener(cb: ((e: ContactBridgeEvent) => void) | null): void {
    this.contactListener = cb;
  }

  /**
   * 批次监听（B4A）：事件在每个原生 world.step 完成后统一派发。
   * - 同一物理步、同一 phase 的事件共享 timestamp/size，index 按回调顺序连续 0..size-1；
   * - begin/end 分别计数；timestamp = physicsStep × SECONDS_PER_STEP × 1000（单调，禁 Date.now）；
   * - 可单独使用；与即时监听并存时不重复、不改变运动学快照。
   */
  setBatchedContactListener(cb: ((e: ContactBridgeEvent) => void) | null): void {
    this.batchedListener = cb;
    if (!cb) this.batchedEvents.length = 0;
  }

  private emitContact(phase: 'begin' | 'end', contact: planck.Contact): void {
    if (!this.contactListener && !this.batchedListener) return;
    const nativeA = contact.getFixtureA().getBody();
    const nativeB = contact.getFixtureB().getBody();
    const ha = this.bodyByNative.get(nativeA);
    const hb = this.bodyByNative.get(nativeB);
    if (!ha || !hb) return;
    // 按创建序号规范化；若交换，法线反转（指向最终 bodyA→bodyB）、点速度对换
    const swap = this.seqOf(ha) > this.seqOf(hb);
    const a = swap ? hb : ha;
    const b = swap ? ha : hb;

    if (phase === 'begin') {
      const snap = this.buildContactSnapshot(contact, nativeA, nativeB, swap);
      this.contactSnapshots.set(contact, snap);
      const ev: ContactBridgeEvent = { phase, bodyA: a, bodyB: b, ...snap };
      // 即时监听立即派发（无 batch）；批次监听缓存（batch 在步末 flush 时填写）
      this.contactListener?.(ev);
      if (this.batchedListener) this.batchedEvents.push(ev);
    } else {
      const snap = this.contactSnapshots.get(contact);
      if (!snap) {
        // 分离时 manifold 已失效，必须复用 begin 快照；无快照则不伪造，跳过并报告
        console.error('PlanckWorld: end-contact 无对应 begin 快照（Contact 生命周期异常），跳过该事件');
        return;
      }
      this.contactSnapshots.delete(contact);
      const ev: ContactBridgeEvent = { phase, bodyA: a, bodyB: b, ...snap };
      this.contactListener?.(ev);
      if (this.batchedListener) this.batchedEvents.push(ev);
    }
  }

  /**
   * 构建 begin 接触运动学快照（B3）：
   * - 用原生 getWorldManifold 取首个真实世界接触点与法线（normal 从 fixtureA 指向 fixtureB）；
   * - handle 规范化若交换，则反转法线、对换点速度；
   * - 点速度必须用 getLinearVelocityFromWorldPoint（含 ω×r），禁止只读 COM 速度；
   * - relVel = (vPointA − vPointB)·normal（不取绝对值、不截零），经 mpsToPxPerStep 换算。
   */
  private buildContactSnapshot(
    contact: planck.Contact,
    nativeA: planck.Body,
    nativeB: planck.Body,
    swap: boolean,
  ): ContactSnapshot {
    const wm = contact.getWorldManifold(null);
    if (!wm || wm.pointCount === 0 || wm.points.length === 0) {
      // 无真实 manifold point：不得伪造数据，立即停止报告
      throw new Error('PlanckWorld: begin-contact 无真实 world manifold point，拒绝伪造数据');
    }
    let nx = wm.normal.x;
    let ny = wm.normal.y;
    if (swap) {
      nx = -nx;
      ny = -ny;
    }
    const nl = Math.hypot(nx, ny) || 1;
    const normal = { x: nx / nl, y: ny / nl };
    const wp = wm.points[0];

    // 规范化后：最终 bodyA/bodyB 对应的 native（swap 时对换）
    const fnA = swap ? nativeB : nativeA;
    const fnB = swap ? nativeA : nativeB;
    const pva = fnA.getLinearVelocityFromWorldPoint(planck.Vec2(wp.x, wp.y));
    const pvb = fnB.getLinearVelocityFromWorldPoint(planck.Vec2(wp.x, wp.y));
    const relMs = (pva.x - pvb.x) * normal.x + (pva.y - pvb.y) * normal.y;

    return {
      contactPoint: { x: mToPx(wp.x), y: mToPx(wp.y) },
      normal,
      relativeVelocity: mpsToPxPerStep(relMs),
    };
  }

  private seqOf(h: BodyHandle): number {
    const s = this.bodySeq.get(h);
    return s ?? 0;
  }

  // ---------- 创建 ----------

  createDynamicBox(
    xPx: number,
    yPx: number,
    widthPx: number,
    heightPx: number,
    massKg: number,
    options?: PlanckBodyOptions,
  ): BodyHandle {
    assertFinite(xPx, yPx, widthPx, heightPx, massKg);
    assertPositive(widthPx, heightPx, massKg);
    this.assertBodyOptions(options);
    const hw = pxToM(widthPx / 2);
    const hh = pxToM(heightPx / 2);
    // density = mass / shapeArea（shapeArea = width_m * height_m）
    const density = massKg / (pxToM(widthPx) * pxToM(heightPx));
    return this.createBody(
      planck.Box(hw, hh),
      density,
      pxToM(xPx),
      pxToM(yPx),
      options?.friction ?? 0,
      options?.collisionFilter,
      options?.restitution ?? 0,
    );
  }

  createDynamicCircle(
    xPx: number,
    yPx: number,
    radiusPx: number,
    massKg: number,
    options?: PlanckBodyOptions,
  ): BodyHandle {
    assertFinite(xPx, yPx, radiusPx, massKg);
    assertPositive(radiusPx, massKg);
    this.assertBodyOptions(options);
    const r = pxToM(radiusPx);
    const density = massKg / (Math.PI * r * r);
    return this.createBody(
      planck.Circle(r),
      density,
      pxToM(xPx),
      pxToM(yPx),
      options?.friction ?? 0,
      options?.collisionFilter,
      options?.restitution ?? 0,
    );
  }

  /**
   * 动态多边形（B7A1）：
   * - 顶点为相对 body 原点的本地 px，统一经 units.ts 换算；
   * - 支持顺/逆时针（进入 Planck 前规范化为 CCW）；
   * - 拒绝：非有限、顶点数 <3 或 >8、零面积、重复边（相邻共线）、凹多边形；
   * - friction>=0、restitution∈[0,1]；density 按 mass/面积 使总质量等于传入 mass。
   */
  createDynamicPolygon(
    xPx: number,
    yPx: number,
    verticesPx: { x: number; y: number }[],
    massKg: number,
    options?: PlanckBodyOptions,
  ): BodyHandle {
    assertFinite(xPx, yPx, massKg);
    assertPositive(massKg);
    this.assertBodyOptions(options);
    const vertsM = normalizePolygonVertices(verticesPx); // 校验 + CCW 规范化 + px→m
    const areaM2 = Math.abs(polygonAreaM2(vertsM));
    const density = massKg / areaM2;
    return this.createBody(
      planck.PolygonShape(vertsM),
      density,
      pxToM(xPx),
      pxToM(yPx),
      options?.friction ?? 0,
      options?.collisionFilter,
      options?.restitution ?? 0,
    );
  }

  /** Body 材质/过滤校验（B7A1）：friction>=0、restitution∈[0,1]、filter 走 assertCollisionFilter */
  private assertBodyOptions(options?: PlanckBodyOptions): void {
    if (!options) return;
    if (options.friction !== undefined) {
      assertFinite(options.friction);
      if (options.friction < 0) {
        throw new Error(`PlanckWorld: friction 必须 >= 0，收到 ${options.friction}`);
      }
    }
    if (options.restitution !== undefined) {
      assertFinite(options.restitution);
      if (options.restitution < 0 || options.restitution > 1) {
        throw new Error(`PlanckWorld: restitution 必须在 0..1，收到 ${options.restitution}`);
      }
    }
    if (options.collisionFilter) assertCollisionFilter(options.collisionFilter);
  }

  /**
   * 动态复合体（B7A2）：多个 ColliderDef 真实进入一个 native dynamic body 的多个 fixtures。
   * - Box/Circle/Polygon、offset、angle 全部真实进入（box 旋转走 polygon）；
   * - Polygon 顶点先按 angle 旋转再加 offset；禁止拆成多个 body / Weld；
   * - 所有 fixtures 使用同一过滤/material 配置；
   * - 按全部形状面积设置统一 density，使总质量严格等于 massKg；
   * - 对外仍是一个不透明 BodyHandle。
   */
  createDynamicCompound(
    xPx: number,
    yPx: number,
    colliders: ColliderDef[],
    massKg: number,
    options?: PlanckBodyOptions,
  ): BodyHandle {
    assertFinite(xPx, yPx, massKg);
    assertPositive(massKg);
    this.assertBodyOptions(options);
    if (colliders.length === 0) {
      throw new Error('PlanckWorld: compound 至少需要一个 collider');
    }
    let totalAreaPx2 = 0;
    const shapes: planck.Shape[] = [];
    for (const c of colliders) {
      totalAreaPx2 += colliderAreaPx2(c);
      shapes.push(colliderToShape(c));
    }
    if (!(totalAreaPx2 > 0)) {
      throw new Error('PlanckWorld: compound 总面积必须为正');
    }
    // 统一 density：总质量 / 总面积（m²）
    const density = massKg / (totalAreaPx2 / (PX_PER_M * PX_PER_M));
    const native = this.world.createBody({
      type: 'dynamic',
      position: planck.Vec2(pxToM(xPx), pxToM(yPx)),
    });
    const base = {
      density,
      friction: options?.friction ?? 0,
      restitution: options?.restitution ?? 0,
    };
    for (const s of shapes) {
      native.createFixture(s, filterFixtureDef(base, options?.collisionFilter));
    }
    const handle = createBodyHandle();
    this.bodies.set(handle, native);
    this.bodyByNative.set(native, handle);
    this.bodySeq.set(handle, this.nextSeq++);
    return handle;
  }

  /** 静态矩形地面（碰撞静止；同 handle 管理，可被查询但不参与动态求解） */
  createStaticGround(
    xPx: number,
    yPx: number,
    widthPx: number,
    heightPx: number,
    options?: { collisionFilter?: PlanckCollisionFilter },
  ): BodyHandle {
    assertFinite(xPx, yPx, widthPx, heightPx);
    assertPositive(widthPx, heightPx);
    if (options?.collisionFilter) assertCollisionFilter(options.collisionFilter);
    const hw = pxToM(widthPx / 2);
    const hh = pxToM(heightPx / 2);
    const native = this.world.createBody({
      type: 'static',
      position: planck.Vec2(pxToM(xPx), pxToM(yPx)),
    });
    native.createFixture(
      planck.Box(hw, hh),
      filterFixtureDef({ friction: 1 }, options?.collisionFilter),
    );
    const handle = createBodyHandle();
    this.bodies.set(handle, native);
    this.bodyByNative.set(native, handle);
    this.bodySeq.set(handle, this.nextSeq++);
    return handle;
  }

  createRevoluteJoint(
    bodyA: BodyHandle,
    localAnchorAPx: { x: number; y: number },
    bodyB: BodyHandle,
    localAnchorBPx: { x: number; y: number },
  ): JointHandle {
    assertFinite(localAnchorAPx.x, localAnchorAPx.y, localAnchorBPx.x, localAnchorBPx.y);
    const a = this.bodyOf(bodyA);
    const b = this.bodyOf(bodyB);
    // 显式收窄：createJoint 在 planck@1.4.2 类型中可返回 null。
    // RevoluteJoint 使用 1 参数构造（def 携带 bodyA/bodyB 与 local anchors，
    // 匹配 planck@1.4.2 类型重载：1 参数 def 或 4 参数带世界 anchor）。
    // 单独保留 RevoluteJoint 类型引用（revoluteJoints），供 setRevoluteMotor 使用。
    const revolute = planck.RevoluteJoint({
      bodyA: a,
      bodyB: b,
      localAnchorA: planck.Vec2(pxToM(localAnchorAPx.x), pxToM(localAnchorAPx.y)),
      localAnchorB: planck.Vec2(pxToM(localAnchorBPx.x), pxToM(localAnchorBPx.y)),
    });
    const created = this.world.createJoint(revolute);
    if (created === null) {
      throw new Error('PlanckWorld: RevoluteJoint 创建失败（createJoint 返回 null）');
    }
    const handle = createJointHandle();
    this.joints.set(handle, created);
    this.revoluteJoints.set(handle, revolute);
    return handle;
  }

  /**
   * Weld 刚性连接（B6A）：
   * - 创建时自动保存两刚体当前相对角度（referenceAngle），不强制归零；
   * - 锚点统一经 units.ts 换算；
   * - createJoint 返回 null 必须明确抛错；opaque handle，无 as any / native escape hatch。
   */
  createWeldJoint(
    bodyA: BodyHandle,
    localAnchorAPx: { x: number; y: number },
    bodyB: BodyHandle,
    localAnchorBPx: { x: number; y: number },
  ): JointHandle {
    assertFinite(localAnchorAPx.x, localAnchorAPx.y, localAnchorBPx.x, localAnchorBPx.y);
    const a = this.bodyOf(bodyA);
    const b = this.bodyOf(bodyB);
    // 保存当前相对角度（不归零）：weld 保持初始相对姿态
    const referenceAngle = b.getAngle() - a.getAngle();
    const weld = planck.WeldJoint({
      bodyA: a,
      bodyB: b,
      localAnchorA: planck.Vec2(pxToM(localAnchorAPx.x), pxToM(localAnchorAPx.y)),
      localAnchorB: planck.Vec2(pxToM(localAnchorBPx.x), pxToM(localAnchorBPx.y)),
      referenceAngle,
    });
    const created = this.world.createJoint(weld);
    if (created === null) {
      throw new Error('PlanckWorld: WeldJoint 创建失败（createJoint 返回 null）');
    }
    const handle = createJointHandle();
    this.joints.set(handle, created);
    return handle;
  }

  /**
   * Revolute motor 开关（A8）。
   * - speedRadPerStep 用现有换算转 rad/s；
   * - maxTorqueNm 为 Planck 原生 N·m，原值传入（不猜游戏层 torque 换算）；
   * - speed/torque 必须有限、torque >= 0、enabled 必须为 boolean；
   * - 内部保持真实 RevoluteJoint 类型，无 as any / escape hatch / 不暴露 Planck 类型。
   */
  setRevoluteMotor(
    joint: JointHandle,
    cfg: { enabled: boolean; speedRadPerStep: number; maxTorqueNm: number },
  ): void {
    assertFinite(cfg.speedRadPerStep, cfg.maxTorqueNm);
    if (cfg.maxTorqueNm < 0) {
      throw new Error(`PlanckWorld: maxTorqueNm 必须 >= 0，收到 ${cfg.maxTorqueNm}`);
    }
    if (typeof cfg.enabled !== 'boolean') {
      throw new Error(`PlanckWorld: enabled 必须为 boolean，收到 ${String(cfg.enabled)}`);
    }
    const j = this.revoluteJoints.get(joint);
    if (!j) {
      throw new Error(
        'PlanckWorld: JointHandle 不是 RevoluteJoint 或不属于当前 world（跨 World 使用不被允许）',
      );
    }
    j.enableMotor(cfg.enabled);
    j.setMotorSpeed(radPerStepToRadPerSec(cfg.speedRadPerStep));
    j.setMaxMotorTorque(cfg.maxTorqueNm);
  }

  private createBody(
    shape: planck.Shape,
    density: number,
    xM: number,
    yM: number,
    friction = 0,
    collisionFilter?: PlanckCollisionFilter,
    restitution = 0,
  ): BodyHandle {
    const native = this.world.createBody({
      type: 'dynamic',
      position: planck.Vec2(xM, yM),
    });
    // 未传 collisionFilter 时不预设任何碰撞过滤（默认全碰撞，Planck 行为）
    native.createFixture(shape, filterFixtureDef({ density, friction, restitution }, collisionFilter));
    const handle = createBodyHandle();
    this.bodies.set(handle, native);
    this.bodyByNative.set(native, handle);
    this.bodySeq.set(handle, this.nextSeq++);
    return handle;
  }

  // ---------- 步进 ----------

  /** 固定步进：每步 world.step(SECONDS_PER_STEP)；steps 必须为 >=1 的整数 */
  stepFixed(steps = 1): void {
    if (!Number.isFinite(steps) || !Number.isInteger(steps) || steps < 1) {
      throw new Error(
        `PlanckWorld: steps 必须是 >=1 的整数（收到 ${steps}），不做静默修正`,
      );
    }
    for (let i = 0; i < steps; i++) {
      // 单参数调用：使用 planck@1.4.2 锁定版本的默认 solver iterations（8/3）
      this.world.step(SECONDS_PER_STEP);
      // 每原生物理步完成后独立派发批次（B4A）：stepFixed(n) 不得跨步合并
      this.flushBatched();
    }
  }

  /** 每物理步末派发批次事件（B4A）；timestamp 单调物理步时间，begin/end 分别计数 */
  private flushBatched(): void {
    const ts = this.physicsStep * SECONDS_PER_STEP * 1000;
    this.physicsStep++;
    if (!this.batchedListener || this.batchedEvents.length === 0) return;
    const beginCount = this.batchedEvents.filter((e) => e.phase === 'begin').length;
    const endCount = this.batchedEvents.filter((e) => e.phase === 'end').length;
    let bi = 0;
    let ei = 0;
    for (const ev of this.batchedEvents) {
      const isBegin = ev.phase === 'begin';
      const index = isBegin ? bi++ : ei++;
      const size = isBegin ? beginCount : endCount;
      this.batchedListener({ ...ev, batch: { timestamp: ts, index, size } });
    }
    this.batchedEvents.length = 0;
  }

  // ---------- 读取 / 写入（游戏层单位） ----------

  getPosition(body: BodyHandle): { x: number; y: number } {
    const pos = this.bodyOf(body).getPosition();
    return { x: mToPx(pos.x), y: mToPx(pos.y) };
  }

  getLinearVelocity(body: BodyHandle): { x: number; y: number } {
    const v = this.bodyOf(body).getLinearVelocity();
    return { x: mpsToPxPerStep(v.x), y: mpsToPxPerStep(v.y) };
  }

  setLinearVelocity(body: BodyHandle, vx: number, vy: number): void {
    assertFinite(vx, vy);
    this.bodyOf(body).setLinearVelocity(
      planck.Vec2(pxPerStepToMps(vx), pxPerStepToMps(vy)),
    );
  }

  getAngle(body: BodyHandle): number {
    return this.bodyOf(body).getAngle();
  }

  /**
   * 直接设置 body 角度（B6A）：仅校验有限数；保留当前位置，不清零速度。
   */
  setAngle(body: BodyHandle, angleRad: number): void {
    assertFinite(angleRad);
    this.bodyOf(body).setAngle(angleRad);
  }

  getAngularVelocity(body: BodyHandle): number {
    return radPerSecToRadPerStep(this.bodyOf(body).getAngularVelocity());
  }

  setAngularVelocity(body: BodyHandle, value: number): void {
    assertFinite(value);
    this.bodyOf(body).setAngularVelocity(radPerStepToRadPerSec(value));
  }

  getMass(body: BodyHandle): number {
    return this.bodyOf(body).getMass();
  }

  /** 真实世界 COM（B7A2）：复合体按各 fixture 面积/密度计算的重心，px 坐标 */
  getCenterOfMass(body: BodyHandle): { x: number; y: number } {
    const c = this.bodyOf(body).getWorldCenter();
    return { x: mToPx(c.x), y: mToPx(c.y) };
  }

  /**
   * Owner Meta 存取（B1）：
   * - 按 handle 私有保存（ownerTags Map）；输入与返回值均防御复制（字段全为原始 string 的浅拷贝）；
   * - 未设置返回 null；跨 World / 无效 handle 抛错（走 bodyOf 校验）；
   * - 保持 handle opaque，不暴露 Planck 类型，无 as any / native escape hatch。
   */
  setOwnerTag(body: BodyHandle, tag: OwnerTag): void {
    this.bodyOf(body); // 跨 World / 无效 handle 立即抛错
    this.ownerTags.set(body, { ...tag });
  }

  getOwnerTag(body: BodyHandle): OwnerTag | null {
    this.bodyOf(body); // 跨 World / 无效 handle 立即抛错
    const tag = this.ownerTags.get(body);
    return tag ? { ...tag } : null;
  }

  /** 铰链世界锚点误差（px） */
  getJointAnchorErrorPx(joint: JointHandle): number {
    const j = this.jointOf(joint);
    const a = j.getAnchorA();
    const b = j.getAnchorB();
    return mToPx(Math.hypot(a.x - b.x, a.y - b.y));
  }

  // ---------- 内部 ----------

  private bodyOf(h: BodyHandle): planck.Body {
    const native = this.bodies.get(h);
    if (!native) {
      throw new Error(
        'PlanckWorld: BodyHandle 不属于当前 world 或已失效（跨 World 使用不被允许）',
      );
    }
    return native;
  }

  private jointOf(h: JointHandle): planck.Joint {
    const native = this.joints.get(h);
    if (!native) {
      throw new Error(
        'PlanckWorld: JointHandle 不属于当前 world 或已失效（跨 World 使用不被允许）',
      );
    }
    return native;
  }
}
