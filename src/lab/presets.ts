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

function cannonAt(hardpointId = 'front', defId = 'cannon'): BuildSnapshot['functionals'] {
  return [{ hardpointId, defId }];
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

/* ---------- Cannon 相关 Preset（Queue 02） ---------- */

/** 标准炮车：正常车身 + 标准炮（front） */
const cannonStandard: Preset = {
  id: 'cannonStandard',
  name: '标准炮车',
  build: () => ({
    id: 'cannonStandard',
    bodyDefId: 'boxBody',
    quality: 1,
    movements: wheels(),
    functionals: cannonAt(),
  }),
};

/** 重后坐炮车：正常车身 + 高后坐炮（front） */
const cannonHeavyRecoil: Preset = {
  id: 'cannonHeavyRecoil',
  name: '重后坐炮车',
  build: () => ({
    id: 'cannonHeavyRecoil',
    bodyDefId: 'boxBody',
    quality: 1,
    movements: wheels(),
    functionals: cannonAt('front', 'cannonHeavy'),
  }),
};

/** 前倾炮车：前小后大 + 标准炮（验证弹道朝下） */
const cannonNoseDown: Preset = {
  id: 'cannonNoseDown',
  name: '前倾炮车',
  build: () => ({
    id: 'cannonNoseDown',
    bodyDefId: 'boxBody',
    quality: 1,
    movements: wheels(24, 12),
    functionals: cannonAt(),
  }),
};

/** 后倾炮车：前大后小 + 标准炮（验证弹道朝上） */
const cannonNoseUp: Preset = {
  id: 'cannonNoseUp',
  name: '后倾炮车',
  build: () => ({
    id: 'cannonNoseUp',
    bodyDefId: 'boxBody',
    quality: 1,
    movements: wheels(12, 24),
    functionals: cannonAt(),
  }),
};

// Cannon preset 追加到 PRESETS（供 Lab Preset 快捷装载）
PRESETS.push(cannonStandard, cannonHeavyRecoil, cannonNoseDown, cannonNoseUp);
