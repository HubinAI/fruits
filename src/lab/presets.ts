/**
 * Preset Build：保存 / 加载固定 Build Preset。
 * 后续正式 P0 Scenario 需要可复用这些 Preset。
 */
import type { BuildSnapshot, MovementInstall } from '../core/types';

function wheels(rearRadius?: number, frontRadius?: number): MovementInstall[] {
  return [
    {
      hardpointId: 'rear',
      defId: 'wheelStd',
      overrides: rearRadius !== undefined ? { radius: rearRadius } : undefined,
    },
    {
      hardpointId: 'front',
      defId: 'wheelStd',
      overrides: frontRadius !== undefined ? { radius: frontRadius } : undefined,
    },
  ];
}

function ram(): BuildSnapshot['functionals'] {
  return [{ hardpointId: 'front', defId: 'ramHead' }];
}

export interface Preset {
  id: string;
  name: string;
  build: () => BuildSnapshot;
}

/** 轻车 */
const lightVehicle: Preset = {
  id: 'lightVehicle',
  name: '轻车',
  build: () => ({
    id: 'lightVehicle',
    bodyDefId: 'boxBody',
    quality: 1,
    movements: wheels(),
    functionals: ram(),
  }),
};

/** 重车 */
const heavyVehicle: Preset = {
  id: 'heavyVehicle',
  name: '重车',
  build: () => ({
    id: 'heavyVehicle',
    bodyDefId: 'heavyBox',
    quality: 1,
    movements: wheels(),
    functionals: ram(),
  }),
};

/** 前重：前部加测试质量块 */
const frontHeavy: Preset = {
  id: 'frontHeavy',
  name: '前重',
  build: () => ({
    id: 'frontHeavy',
    bodyDefId: 'boxBody',
    quality: 1,
    movements: wheels(),
    functionals: [
      ...ram(),
      { hardpointId: 'frontMass', defId: 'testMass' },
    ],
  }),
};

/** 后重：后部加测试质量块 */
const rearHeavy: Preset = {
  id: 'rearHeavy',
  name: '后重',
  build: () => ({
    id: 'rearHeavy',
    bodyDefId: 'boxBody',
    quality: 1,
    movements: wheels(),
    functionals: [
      ...ram(),
      { hardpointId: 'rear', defId: 'testMass' },
    ],
  }),
};

/**
 * 前倾：前小后大。
 * 刻意不装 ramHead（前重 30 会抵消轮径倾角、造成不对称），
 * 用平衡 Body 纯粹演示「轮径差 → Body 姿态」。
 */
const noseDown: Preset = {
  id: 'noseDown',
  name: '前倾（前小后大）',
  build: () => ({
    id: 'noseDown',
    bodyDefId: 'boxBody',
    quality: 1,
    movements: wheels(24, 12),
    functionals: [],
  }),
};

/** 后倾：前大后小。同 noseDown，平衡 Body，无 ramHead。 */
const noseUp: Preset = {
  id: 'noseUp',
  name: '后倾（前大后小）',
  build: () => ({
    id: 'noseUp',
    bodyDefId: 'boxBody',
    quality: 1,
    movements: wheels(12, 24),
    functionals: [],
  }),
};

export const PRESETS: Preset[] = [
  lightVehicle,
  heavyVehicle,
  frontHeavy,
  rearHeavy,
  noseDown,
  noseUp,
];

export function getPreset(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}

/* ---------- Lift Roller 相关 Preset（Queue 05） ---------- */

/** 举升滚轮车（低位）：滚轮装车底附近，从下方接触目标产生抬升 */
const liftRollerLow: Preset = {
  id: 'liftRollerLow',
  name: '举升滚轮车（低位）',
  build: () => ({
    id: 'liftRollerLow',
    bodyDefId: 'boxBody',
    quality: 1,
    movements: wheels(),
    functionals: [{ hardpointId: 'frontLow', defId: 'liftRoller' }],
  }),
};

/** 举升滚轮车（标准位）：滚轮装车中心高度 */
const liftRollerMid: Preset = {
  id: 'liftRollerMid',
  name: '举升滚轮车（标准位）',
  build: () => ({
    id: 'liftRollerMid',
    bodyDefId: 'boxBody',
    quality: 1,
    movements: wheels(),
    functionals: [{ hardpointId: 'front', defId: 'liftRoller' }],
  }),
};

PRESETS.push(liftRollerLow, liftRollerMid);
