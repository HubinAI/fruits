/**
 * Content Registry：Foundation 测试内容。
 *
 * 注意：这些是「验证 Foundation 成立的最小内容件」，
 * 不是正式水果 / Weapon / Gadget Content（第一阶段禁止批量实现）。
 *
 * 01B 调整：建立 3 种有碰撞意图的测试 Body（低前鼻 wedge / 厚实箱体 / 高身 compact），
 * 让 Body 成为整车主要碰撞 / 视觉主体，不再全是「规则长方形 + 对称标准轮」的工程观感。
 */
import type {
  BodyDef,
  ContentRegistry,
  FunctionalPartDef,
  WheelDef,
} from './types';

/**
 * 楔形车身（低前鼻）：前端低鼻用于从下方顶入对手，前高后低。
 * 简单凸四边形 Collider，视觉与 Collider 关键轮廓一致。
 */
const wedgeBody: BodyDef = {
  id: 'wedgeBody',
  name: '楔形车身',
  colliders: [
    {
      shape: 'polygon',
      vertices: [
        { x: -70, y: -25 },
        { x: -70, y: 25 },
        { x: 50, y: 25 },
        { x: 78, y: -8 },
      ],
      offset: { x: 0, y: 0 },
    },
  ],
  baseMass: 50,
  hp: 1000,
  energyCapacity: 100,
  movementHardpoints: [
    { id: 'rear', localPosition: { x: -52, y: 25 }, localRotation: 0 },
    { id: 'front', localPosition: { x: 44, y: 25 }, localRotation: 0 },
  ],
  functionalHardpoints: [
    { id: 'front', localPosition: { x: 66, y: -6 }, localRotation: 0 },
    { id: 'top', localPosition: { x: -18, y: -25 }, localRotation: 0 },
    { id: 'rear', localPosition: { x: -58, y: 0 }, localRotation: 0 },
  ],
};

/** 厚实箱体：对称长方体，是「平衡 Body」基准（用于轮径姿态演示）。 */
const boxBody: BodyDef = {
  id: 'boxBody',
  name: '箱式车身',
  colliders: [
    { shape: 'box', width: 150, height: 55, offset: { x: 0, y: 0 } },
  ],
  baseMass: 50,
  hp: 1000,
  energyCapacity: 100,
  movementHardpoints: [
    { id: 'rear', localPosition: { x: -55, y: 27 }, localRotation: 0 },
    { id: 'front', localPosition: { x: 55, y: 27 }, localRotation: 0 },
  ],
  functionalHardpoints: [
    { id: 'front', localPosition: { x: 75, y: 0 }, localRotation: 0 },
    { id: 'frontMass', localPosition: { x: 45, y: -10 }, localRotation: 0 },
    { id: 'top', localPosition: { x: 0, y: -27 }, localRotation: 0 },
    { id: 'rear', localPosition: { x: -75, y: 0 }, localRotation: 0 },
  ],
};

/** 高身 compact：比宽更高的车体，重心偏高，碰撞姿态变化更明显。 */
const tallBody: BodyDef = {
  id: 'tallBody',
  name: '高身车身',
  colliders: [
    { shape: 'box', width: 110, height: 80, offset: { x: 0, y: 0 } },
  ],
  baseMass: 55,
  hp: 1100,
  energyCapacity: 100,
  movementHardpoints: [
    { id: 'rear', localPosition: { x: -38, y: 40 }, localRotation: 0 },
    { id: 'front', localPosition: { x: 38, y: 40 }, localRotation: 0 },
  ],
  functionalHardpoints: [
    { id: 'front', localPosition: { x: 55, y: -10 }, localRotation: 0 },
    { id: 'top', localPosition: { x: 0, y: -40 }, localRotation: 0 },
    { id: 'rear', localPosition: { x: -55, y: -10 }, localRotation: 0 },
  ],
};

/** 重型车身：与 boxBody 结构相同，仅 baseMass 更大（用于 Light vs Heavy） */
const heavyBox: BodyDef = {
  ...boxBody,
  id: 'heavyBox',
  name: '重型车身',
  baseMass: 150,
};

/** 标准轮子 */
const wheelStd: WheelDef = {
  kind: 'wheel',
  id: 'wheelStd',
  name: '标准轮',
  radius: 20,
  mass: 10,
  driveTorque: 100,
  driveForce: 0.005,
  maxRPM: 300,
  grip: 0.9,
};

/**
 * Ram Head（撞角）：Fixed Mount 武器。
 * 用于证明「Weapon Damage 只能来自真实攻击轨迹 / Collider 的真实有效接触」。
 */
const ramHead: FunctionalPartDef = {
  id: 'ramHead',
  name: '撞角',
  category: 'weapon',
  mass: 30,
  energy: 20,
  collider: { shape: 'box', width: 20, height: 30, offset: { x: 10, y: 0 } },
  behavior: 'ram',
  behaviorParams: { baseDamage: 80 },
};

/** 测试质量块（Gadget，用于 Scenario E 质量分布验证） */
const testMass: FunctionalPartDef = {
  id: 'testMass',
  name: '测试质量块',
  category: 'gadget',
  mass: 60,
  energy: 0,
  collider: { shape: 'box', width: 20, height: 20, offset: { x: 0, y: 0 } },
  behavior: 'none',
};

/**
 * Cannon（炮，Q02-C2）：Fixed Mount 武器，只定义内容，不实现发射行为（Q02-C1）。
 * - 有真实 collider / mass / energy；
 * - 不设置 baseDamage：炮身接触不能直接造成 Weapon Damage，
 *   伤害只能来自 projectile 命中（behaviorParams.projectileDamage）；
 * - behaviorParams 仅含六个参数（首版取明显、易验证数值，不做精细平衡）：
 *   cooldownMs / muzzleSpeed / projectileDamage / projectileRadius /
 *   projectileMass / recoilImpulse。
 */
const cannon: FunctionalPartDef = {
  id: 'cannon',
  name: '炮',
  category: 'weapon',
  mass: 20,
  energy: 30,
  collider: { shape: 'box', width: 40, height: 20, offset: { x: 20, y: 0 } },
  behavior: 'cannon',
  behaviorParams: {
    cooldownMs: 1000,
    muzzleSpeed: 12,
    projectileDamage: 80,
    projectileRadius: 6,
    projectileMass: 1,
    recoilImpulse: 12,
  },
};

/** 构建 Content Registry */
export function createRegistry(): ContentRegistry {
  return {
    bodies: new Map([
      [wedgeBody.id, wedgeBody],
      [boxBody.id, boxBody],
      [tallBody.id, tallBody],
      [heavyBox.id, heavyBox],
    ]),
    movements: new Map([[wheelStd.id, wheelStd]]),
    functionals: new Map([
      [ramHead.id, ramHead],
      [cannon.id, cannon],
      [testMass.id, testMass],
    ]),
  };
}

/** 默认 Registry 单例（正式 Runtime 与 Lab 共用同一内容库） */
export const registry: ContentRegistry = createRegistry();
