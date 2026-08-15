/**
 * Content Registry：首版测试内容。
 *
 * 注意：这些是「验证 Foundation 成立的最小内容件」，
 * 不是正式水果 / Weapon / Gadget Content（第一阶段禁止批量实现）。
 */
import type {
  BodyDef,
  ContentRegistry,
  FunctionalPartDef,
  WheelDef,
} from './types';

/** 基础车身：矩形车身，2 个 Movement Hardpoint + 3 个 Functional Hardpoint */
const boxBody: BodyDef = {
  id: 'boxBody',
  name: '箱式车身',
  colliders: [
    { shape: 'box', width: 120, height: 40, offset: { x: 0, y: 0 } },
  ],
  baseMass: 50,
  hp: 1000,
  energyCapacity: 100,
  movementHardpoints: [
    { id: 'rear', localPosition: { x: -40, y: 20 }, localRotation: 0 },
    { id: 'front', localPosition: { x: 40, y: 20 }, localRotation: 0 },
  ],
  functionalHardpoints: [
    { id: 'front', localPosition: { x: 60, y: 0 }, localRotation: 0 },
    { id: 'frontMass', localPosition: { x: 40, y: -10 }, localRotation: 0 },
    { id: 'rear', localPosition: { x: -60, y: 0 }, localRotation: 0 },
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

/** 构建 Content Registry */
export function createRegistry(): ContentRegistry {
  return {
    bodies: new Map([
      [boxBody.id, boxBody],
      [heavyBox.id, heavyBox],
    ]),
    movements: new Map([[wheelStd.id, wheelStd]]),
    functionals: new Map([
      [ramHead.id, ramHead],
      [testMass.id, testMass],
    ]),
  };
}

/** 默认 Registry 单例（正式 Runtime 与 Lab 共用同一内容库） */
export const registry: ContentRegistry = createRegistry();
