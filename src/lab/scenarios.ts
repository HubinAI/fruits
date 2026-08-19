/**
 * Physics Lab 固定 Scenario（文档十一）。
 * 全部直接调用正式 Battle Runtime，禁止 Scenario 专属 Fake 物理。
 */
import type { BuildSnapshot } from '../core/types';
import type { BattleConfig } from '../battle/battleOrchestrator';
import { getPreset } from './presets';

export interface ScenarioDef {
  id: string;
  name: string;
  description: string;
  buildA: BuildSnapshot;
  buildB: BuildSnapshot;
  config: BattleConfig;
}

function presetBuild(id: string): BuildSnapshot {
  const p = getPreset(id);
  if (!p) throw new Error(`Unknown preset "${id}"`);
  return p.build();
}

/** 自定义轮径车（用于偏心 / 高度碰撞） */
function wheeledBuild(
  id: string,
  rearRadius: number,
  frontRadius: number,
  massPart?: 'frontMass' | 'rear',
): BuildSnapshot {
  return {
    id,
    bodyDefId: 'boxBody',
    quality: 1,
    movements: [
      { hardpointId: 'rear', defId: 'wheelStd', overrides: { radius: rearRadius } },
      { hardpointId: 'front', defId: 'wheelStd', overrides: { radius: frontRadius } },
    ],
    functionals: [
      { hardpointId: 'front', defId: 'ramHead' },
      ...(massPart ? [{ hardpointId: massPart, defId: 'testMass' }] : []),
    ],
  };
}

/** 单轮 build（只装后轮，单轮合法） */
function singleWheelBuild(): BuildSnapshot {
  return {
    id: 'singleWheel',
    bodyDefId: 'boxBody',
    quality: 1,
    movements: [{ hardpointId: 'rear', defId: 'wheelStd' }],
    functionals: [{ hardpointId: 'front', defId: 'ramHead' }],
  };
}

/** Cannon 车（Q02-C4）：boxBody + wheelStd×2 + front cannon（无自动瞄准/弹道修正） */
function cannonCarBuild(): BuildSnapshot {
  return {
    id: 'cannonCar',
    bodyDefId: 'boxBody',
    quality: 1,
    movements: [
      { hardpointId: 'rear', defId: 'wheelStd' },
      { hardpointId: 'front', defId: 'wheelStd' },
    ],
    functionals: [{ hardpointId: 'front', defId: 'cannon' }],
  };
}

/** 倾角 Cannon 车（Q02-C4）：前小后大轮径 → 车头下倾 ~7°，同一 front cannon */
function tiltedCannonBuild(): BuildSnapshot {
  return {
    id: 'cannonTilt',
    bodyDefId: 'boxBody',
    quality: 1,
    movements: [
      { hardpointId: 'rear', defId: 'wheelStd', overrides: { radius: 26 } },
      { hardpointId: 'front', defId: 'wheelStd', overrides: { radius: 12 } },
    ],
    functionals: [{ hardpointId: 'front', defId: 'cannon' }],
  };
}

/** 无攻击件目标车（Q02-C4）：正常双轮车体，无 Weapon / Gadget */
function plainCarBuild(): BuildSnapshot {
  return {
    id: 'plainCar',
    bodyDefId: 'boxBody',
    quality: 1,
    movements: [
      { hardpointId: 'rear', defId: 'wheelStd' },
      { hardpointId: 'front', defId: 'wheelStd' },
    ],
    functionals: [],
  };
}

export const SCENARIOS: ScenarioDef[] = [
  {
    id: 'A',
    name: 'Light vs Heavy',
    description: '接近同速度正面碰撞：重车位移明显更小，轻车位移 / 反弹更大。',
    buildA: presetBuild('lightVehicle'),
    buildB: presetBuild('heavyVehicle'),
    config: {
      autoDrive: true,
      spawnA: { x: 450, y: 650, facing: 1 },
      spawnB: { x: 1150, y: 650, facing: -1 },
    },
  },
  {
    id: 'B',
    name: 'Off-center Collision',
    description: '相近质量、不同接触高度：B 车身高（大轮）撞 A 车车身（小轮）上部，产生明显 Z 轴角速度。',
    buildA: wheeledBuild('lowA', 12, 12),
    buildB: wheeledBuild('highB', 26, 26),
    config: {
      autoDrive: true,
      spawnA: { x: 500, y: 650, facing: 1 },
      spawnB: { x: 1100, y: 640, facing: -1 },
    },
  },
  {
    id: 'C',
    name: 'Wheel Radius / Body Angle',
    description: '同一 Body，前小后大 vs 前大后小：Body 世界倾角明显不同（静止对比）。',
    buildA: presetBuild('noseDown'),
    buildB: presetBuild('noseUp'),
    config: {
      autoDrive: false,
      spawnA: { x: 500, y: 650, facing: 1 },
      spawnB: { x: 1100, y: 650, facing: 1 },
    },
  },
  {
    id: 'D-double',
    name: 'Grounded Drive · 双轮',
    description: '双轮接地正常驱动。',
    buildA: presetBuild('lightVehicle'),
    buildB: presetBuild('lightVehicle'),
    config: {
      autoDrive: true,
      spawnA: { x: 600, y: 650, facing: 1 },
      spawnB: { x: 1400, y: 650, facing: -1 },
    },
  },
  {
    id: 'D-single',
    name: 'Grounded Drive · 单轮',
    description: '仅后轮接地时，只有接地轮提供驱动；前部拖地产生摩擦。',
    buildA: singleWheelBuild(),
    buildB: presetBuild('lightVehicle'),
    config: {
      autoDrive: true,
      spawnA: { x: 600, y: 650, facing: 1 },
      spawnB: { x: 1400, y: 650, facing: -1 },
    },
  },
  {
    id: 'D-air',
    name: 'Grounded Drive · 全腾空',
    description: '车从空中落下：腾空时无凭空牵引，落地后自然恢复驱动。',
    buildA: presetBuild('lightVehicle'),
    buildB: presetBuild('lightVehicle'),
    config: {
      autoDrive: true,
      settleToGround: false,
      spawnA: { x: 600, y: 300, facing: 1 },
      spawnB: { x: 1400, y: 650, facing: -1 },
    },
  },
  {
    id: 'E',
    name: 'Mass Distribution',
    description: '同一 Body，前 / 后不同位置加相同测试质量：Total Mass 相同、COM 前移 / 后移、碰撞旋转结果不同。',
    buildA: presetBuild('frontHeavy'),
    buildB: presetBuild('rearHeavy'),
    config: {
      autoDrive: true,
      spawnA: { x: 450, y: 650, facing: 1 },
      spawnB: { x: 1150, y: 650, facing: -1 },
    },
  },
  {
    id: 'Cannon-Hit',
    name: 'Cannon Hit',
    description:
      '普通炮（Planck）：A 双轮轻车 + front cannon，固定冷却真实发射；炮弹真实命中 B 结算 projectileDamage。' +
      'B 为无攻击件目标车。无自动瞄准 / 弹道修正，出生无重叠。',
    buildA: cannonCarBuild(),
    buildB: plainCarBuild(),
    config: {
      engine: 'planck',
      autoDrive: false,
      spawnA: { x: 450, y: 650, facing: 1 },
      spawnB: { x: 700, y: 650, facing: -1 },
    },
  },
  {
    id: 'Cannon-Recoil',
    name: 'Cannon Recoil',
    description:
      '普通炮后座（Planck）：B 放远不参与前几秒交互；A 连续开炮，recoilImpulse 经 Weld 传给整车，' +
      '观察真实位移 / 姿态变化（真实地面 / 轮子 / 车身，无隐藏力）。',
    buildA: cannonCarBuild(),
    buildB: plainCarBuild(),
    config: {
      engine: 'planck',
      autoDrive: false,
      spawnA: { x: 500, y: 650, facing: 1 },
      spawnB: { x: 1500, y: 650, facing: -1 },
    },
  },
  {
    id: 'Cannon-Angle',
    name: 'Cannon Angle',
    description:
      '普通炮倾角（Planck）：前小后大轮径制造明显车身倾角，同一 front cannon；' +
      '炮弹沿当前真实车身 / 炮管世界方向射出，不做任何 Scenario 弹道补偿。',
    buildA: tiltedCannonBuild(),
    buildB: plainCarBuild(),
    config: {
      engine: 'planck',
      autoDrive: false,
      spawnA: { x: 500, y: 650, facing: 1 },
      spawnB: { x: 1200, y: 650, facing: -1 },
    },
  },
];

export function getScenario(id: string): ScenarioDef | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
