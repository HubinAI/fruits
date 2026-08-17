/**
 * Planck 最小适配内核（Queue F-02M-A3）—— 不向上层泄漏 Planck 类型的
 * 最小 World / Body / Revolute API。仅验证位置、速度、质量、固定步进和铰链。
 *
 * 约束：
 * - `import * as planck from 'planck'` 只允许存在于本文件。
 * - 对外只导出 BodyHandle / JointHandle / PlanckWorld；Handle 为不透明对象，
 *   不得导出、返回或暴露 planck.Body/Joint/World。
 * - 每个 PlanckWorld 用私有 Map 管理 handle→native；传入其他 world 的 handle 抛错。
 * - World 固定零重力。
 * - 全部换算只调用 units.ts；不翻转 Y 轴。
 * - 不实现重力、碰撞事件、Meta、force、torque、impulse（留待后续队列）。
 * - 不提供任何 native escape hatch。
 * - 非有限数、非正尺寸/半径/质量立即抛错。
 */
import * as planck from 'planck';
import {
  SECONDS_PER_STEP,
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

function createBodyHandle(): BodyHandle {
  return Object.freeze({ [BODY_HANDLE_KEY]: undefined }) as BodyHandle;
}

function createJointHandle(): JointHandle {
  return Object.freeze({ [JOINT_HANDLE_KEY]: undefined }) as JointHandle;
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

/** 零重力 Planck 世界（游戏层单位） */
export class PlanckWorld {
  private readonly world: planck.World;
  private readonly bodies = new Map<BodyHandle, planck.Body>();
  private readonly joints = new Map<JointHandle, planck.Joint>();

  constructor() {
    this.world = new planck.World({ gravity: planck.Vec2(0, 0) });
  }

  // ---------- 创建 ----------

  createDynamicBox(
    xPx: number,
    yPx: number,
    widthPx: number,
    heightPx: number,
    massKg: number,
  ): BodyHandle {
    assertFinite(xPx, yPx, widthPx, heightPx, massKg);
    assertPositive(widthPx, heightPx, massKg);
    const hw = pxToM(widthPx / 2);
    const hh = pxToM(heightPx / 2);
    // density = mass / shapeArea（shapeArea = width_m * height_m）
    const density = massKg / (pxToM(widthPx) * pxToM(heightPx));
    return this.createBody(planck.Box(hw, hh), density, pxToM(xPx), pxToM(yPx));
  }

  createDynamicCircle(
    xPx: number,
    yPx: number,
    radiusPx: number,
    massKg: number,
  ): BodyHandle {
    assertFinite(xPx, yPx, radiusPx, massKg);
    assertPositive(radiusPx, massKg);
    const r = pxToM(radiusPx);
    const density = massKg / (Math.PI * r * r);
    return this.createBody(planck.Circle(r), density, pxToM(xPx), pxToM(yPx));
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
    const created = this.world.createJoint(
      planck.RevoluteJoint({
        bodyA: a,
        bodyB: b,
        localAnchorA: planck.Vec2(pxToM(localAnchorAPx.x), pxToM(localAnchorAPx.y)),
        localAnchorB: planck.Vec2(pxToM(localAnchorBPx.x), pxToM(localAnchorBPx.y)),
      }),
    );
    if (created === null) {
      throw new Error('PlanckWorld: RevoluteJoint 创建失败（createJoint 返回 null）');
    }
    const native = created;
    const handle = createJointHandle();
    this.joints.set(handle, native);
    return handle;
  }

  private createBody(
    shape: planck.Shape,
    density: number,
    xM: number,
    yM: number,
  ): BodyHandle {
    const native = this.world.createBody({
      type: 'dynamic',
      position: planck.Vec2(xM, yM),
    });
    // 不预设任何碰撞过滤：碰撞分组留给后续 Meta/Category 队列
    native.createFixture(shape, { density, friction: 0 });
    const handle = createBodyHandle();
    this.bodies.set(handle, native);
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
    }
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
