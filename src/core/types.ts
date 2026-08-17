/**
 * 《最强水果》核心类型定义
 *
 * 2D 侧视物理：X / Y 平移 + 屏幕平面 Z 轴旋转。
 * 坐标系约定（与 Matter.js 一致）：X 向右，Y 向下，角度为弧度。
 *
 * 四类结构：Body / Movement / Weapon / Gadget。
 * 第一阶段只搭 Foundation 与通用接口，不批量实现正式 Content。
 */

/** 二维向量 */
export interface Vec2 {
  x: number;
  y: number;
}

/** 碰撞形状类型（支持简单非矩形 Collider 组合） */
export type ColliderShape = 'box' | 'circle' | 'polygon';

/** Collider 定义（Body 与 Functional Part 共用） */
export interface ColliderDef {
  shape: ColliderShape;
  /** box */
  width?: number;
  height?: number;
  /** circle */
  radius?: number;
  /** polygon 的本地顶点（相对 offset） */
  vertices?: Vec2[];
  /** 相对父件的本地偏移 */
  offset: Vec2;
  /** 相对父件的本地角度（弧度） */
  angle?: number;
}

/**
 * Movement Hardpoint：底部专用挂点。
 * Hardpoint 拥有真实 Local Position 与 Local Rotation。
 */
export interface MovementHardpointDef {
  id: string;
  localPosition: Vec2;
  localRotation: number;
}

/** Functional Hardpoint：Weapon / Gadget 共享孔位 */
export interface FunctionalHardpointDef {
  id: string;
  localPosition: Vec2;
  localRotation: number;
}

/**
 * Body Definition。
 * Body 只描述被动碰撞轮廓 + 质量 + 质量分布 + 挂点。
 * 禁止拥有：BodyContactDamage / 职业 Buff / 主动技能 / 隐藏翻倒抗性 / 隐藏 Weapon 兼容属性。
 */
export interface BodyDef {
  id: string;
  name: string;
  /** 简单非矩形 Collider 组合 */
  colliders: ColliderDef[];
  /** 基础质量（不含部件） */
  baseMass: number;
  hp: number;
  energyCapacity: number;
  /** 至少 2 个 Movement Hardpoint */
  movementHardpoints: MovementHardpointDef[];
  functionalHardpoints: FunctionalHardpointDef[];
}

/**
 * Movement Definition。V1 首阶段只支持 Wheel。
 */
export interface WheelDef {
  kind: 'wheel';
  id: string;
  name: string;
  radius: number;
  mass: number;
  /** 驱动扭矩（角加速度，rad/s²，驱动 wheel 转速） */
  driveTorque: number;
  /** 驱动牵引力（接地时施加到车身的真实水平力） */
  driveForce: number;
  /** 最大转速（转/分钟） */
  maxRPM: number;
  /** 抓地力（Grip → 映射为 friction） */
  grip: number;
}

export type MovementDef = WheelDef;

/**
 * Functional Part Definition（Weapon 与 Gadget 共享 Functional Hardpoint）。
 * 内容类别保持独立；不建立 Weapon Slot / Gadget Slot 两套孔位。
 * 每件功能部件占用 1 个 Functional Hardpoint。
 */
export interface FunctionalPartDef {
  id: string;
  name: string;
  category: 'weapon' | 'gadget';
  mass: number;
  energy: number;
  /** 物理形状（真实参与碰撞与质量分布） */
  collider: ColliderDef;
  /** Behavior 标识（首版只保留接口，不批量实现正式 Weapon） */
  behavior: string;
  /** Behavior 配置参数（可选） */
  behaviorParams?: Record<string, unknown>;
}

/** 安装情况：某 Hardpoint 上安装的 Movement */
export interface MovementInstall {
  hardpointId: string;
  defId: string;
  /** 允许覆盖部分定义数值（用于 Lab 轮径/质量测试） */
  overrides?: Partial<WheelDef>;
}

/** 安装情况：某 Functional Hardpoint 上安装的 Functional Part */
export interface FunctionalInstall {
  hardpointId: string;
  defId: string;
}

/**
 * Build Snapshot：Battle Runtime 的输入必须是已经装配好的 Build Snapshot。
 * 不依赖 Inventory / Matchmaking / Rank / Season / Shop / Merge / Chest / Progression。
 */
export interface BuildSnapshot {
  id: string;
  bodyDefId: string;
  /** 品质等级 */
  quality: number;
  movements: MovementInstall[];
  functionals: FunctionalInstall[];
}

/** Build Validator 校验结果 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** Content Registry：可用的 Body / Movement / Functional Part 内容库 */
export interface ContentRegistry {
  bodies: Map<string, BodyDef>;
  movements: Map<string, MovementDef>;
  functionals: Map<string, FunctionalPartDef>;
}

/** 战斗阶段 */
export type BattlePhase = 'Active' | 'Warning' | 'Closing' | 'End';

/** 阵营 / 队伍标识 */
export type TeamId = 'A' | 'B';

/** 碰撞 Owner 类型（用于 Owner 过滤与 Contact Router） */
export type OwnerKind = 'ground' | 'arena' | 'vehicle' | 'projectile' | 'hazard';

/** 物理实体上的 Owner 标识 */
export interface OwnerTag {
  kind: OwnerKind;
  /** 所属载具 id（vehicle 时为 build id，其余为空） */
  vehicleId?: string;
  /** 所属部件 id（如 wheel / ram-head） */
  partId?: string;
  team?: TeamId;
}

/**
 * Heavy Hammer（挥击武器）行为参数。
 * Hammer 用 Revolute Joint 挂 Hardpoint，锤头真实 Mass 绕轴挥击，
 * Damage 与物理 Impulse 独立。
 */
export interface HammerParams {
  /** 冷却（ms） */
  cooldown: number;
  /** 臂长：锤头中心到挂点（hardpoint）的距离 */
  armLength: number;
  /** 锤头半径（Collider） */
  headRadius: number;
  /** 锤头质量 */
  headMass: number;
  /** 杆质量（次要，影响反作用与惯性） */
  armMass: number;
  /** 挥击角速度（rad/step，开火时施加到臂） */
  swingSpeed: number;
  /** 单次 Direct Damage */
  damage: number;
}
