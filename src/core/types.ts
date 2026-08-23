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
 * Visual Definition（W1-VIS-1）：正式视觉合同，与 Physics Collider 解耦。
 * - 只描述「视觉外观 + 相对物理原点的 transform」，不参与物理（质量/碰撞/mask 全部来自 Collider）；
 * - 无 VisualDef 时 Renderer 继续用 Collider Shape fallback（当前灰盒视觉完全兼容）；
 * - 本阶段不加载 png/sprite atlas，只建立合同与 transform；visualId 供后续资源队列消费。
 */
export interface VisualDef {
  /** 视觉资源 id（后续 sprite/atlas 队列消费；本阶段仅透传） */
  visualId: string;
  /** 视觉矩形尺寸（px） */
  size: { width: number; height: number };
  /** 相对物理原点（part/body 真实原点）的锚点偏移（px） */
  anchor: { x: number; y: number };
  /** 相对视觉旋转（rad）；叠加在真实 body/part 世界 rotation 上 */
  rotation: number;
  /** 排序层级（后续 Renderer 排序用；数值大在上层） */
  layer: number;
  /** 是否随 facing 镜像（镜像 anchor.x 与 rotation 符号） */
  mirrorWithFacing: boolean;
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
  /** W1-VIS-1：可选视觉定义（无则 Renderer 用 Collider Shape fallback） */
  visual?: VisualDef;
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
  /** W1-VIS-1：可选视觉定义（无则 Renderer 用 Collider/Circle fallback） */
  visual?: VisualDef;
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
  /** W1-VIS-1：可选视觉定义（无则 Renderer 用 Collider Shape fallback） */
  visual?: VisualDef;
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
  /**
   * Q22｜星级（V0.5 部件成长）。1 = 基础；2 = 由 5×1★ 合成的高星。
   * 缺省 undefined = 1★（旧 Build / 对手 / 旧存档兼容）。
   * 倍率层在 buildSnapshot.ts 的 applyStarTier 统一接入（damage ×1.15、energy ×1.10，取整），
   * 不在每个 Weapon 内单独打补丁。
   */
  star?: number;
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
