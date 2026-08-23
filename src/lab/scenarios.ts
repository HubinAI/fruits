/**
 * Physics Lab 固定 Scenario（文档十一）。
 * 全部直接调用正式 Battle Runtime，禁止 Scenario 专属 Fake 物理。
 */
import type { BuildSnapshot } from '../core/types';
import type { BattleConfig } from '../battle/battleOrchestrator';
import type { CameraFit } from '../render/renderer';
import { getPreset } from './presets';

/** 场景取景提示（Q02-CAM-R1/R2，仅显示层）：镜头在 load/Reset/resize 时按此构图一次并固定 */
export interface ScenarioCamera {
  fit: CameraFit;
  /** primary-fire：前方固定射击空间（世界 px，朝 +X） */
  forwardExtent?: number;
  /** primary-fire：身后 recoil 反冲空间（世界 px） */
  recoilExtent?: number;
}

export interface ScenarioDef {
  id: string;
  name: string;
  description: string;
  buildA: BuildSnapshot;
  buildB: BuildSnapshot;
  config: BattleConfig;
  /** 可选取景提示；缺省 = vehicles（A+B） */
  camera?: ScenarioCamera;
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

/** Hammer 车（Q03-C2）：boxBody + wheelStd×2 + front hammer（真实 Revolute 摆锤） */
function hammerCarBuild(): BuildSnapshot {
  return {
    id: 'hammerCar',
    bodyDefId: 'boxBody',
    quality: 1,
    movements: [
      { hardpointId: 'rear', defId: 'wheelStd' },
      { hardpointId: 'front', defId: 'wheelStd' },
    ],
    functionals: [{ hardpointId: 'front', defId: 'hammer' }],
  };
}

/** 轻型 Hammer 车（Q03-C2 Reaction）：wedgeBody（窄体、转动惯量小 → 挥锤反作用更明显） */
function hammerLightBuild(): BuildSnapshot {
  return {
    id: 'hammerLight',
    bodyDefId: 'wedgeBody',
    quality: 1,
    movements: [
      { hardpointId: 'rear', defId: 'wheelStd' },
      { hardpointId: 'front', defId: 'wheelStd' },
    ],
    functionals: [{ hardpointId: 'front', defId: 'hammer' }],
  };
}

/** Push Rod 车（Q04-C2）：boxBody + wheelStd×2 + front pushRod（Prismatic 伸缩杆） */
function pushRodCarBuild(): BuildSnapshot {
  return {
    id: 'pushRodCar',
    bodyDefId: 'boxBody',
    quality: 1,
    movements: [
      { hardpointId: 'rear', defId: 'wheelStd' },
      { hardpointId: 'front', defId: 'wheelStd' },
    ],
    functionals: [{ hardpointId: 'front', defId: 'pushRod' }],
  };
}

/** 轻型 Push Rod 车（Q04-C2 Reaction）：wedgeBody（窄体、惯量小 → 反作用更明显）+ front pushRod */
function pushRodLightBuild(): BuildSnapshot {
  return {
    id: 'pushRodLight',
    bodyDefId: 'wedgeBody',
    quality: 1,
    movements: [
      { hardpointId: 'rear', defId: 'wheelStd' },
      { hardpointId: 'front', defId: 'wheelStd' },
    ],
    functionals: [{ hardpointId: 'front', defId: 'pushRod' }],
  };
}

/** 重型目标车（Q04-C2 Push-Heavy / Reaction）：heavyBox + wheelStd×2，无攻击件 */
function heavyTargetBuild(): BuildSnapshot {
  return {
    id: 'heavyTarget',
    bodyDefId: 'heavyBox',
    quality: 1,
    movements: [
      { hardpointId: 'rear', defId: 'wheelStd' },
      { hardpointId: 'front', defId: 'wheelStd' },
    ],
    functionals: [],
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

/** Q11-A-R2：楔铲目标车——香蕉车身 + 标准轮，不装其它 Functional（隔离验证） */
function bananaTargetBuild(): BuildSnapshot {
  return {
    id: 'bananaTarget',
    bodyDefId: 'bananaBody',
    quality: 1,
    movements: [
      { hardpointId: 'rear', defId: 'wheelStd' },
      { hardpointId: 'front', defId: 'wheelStd' },
    ],
    functionals: [],
  };
}

/** Q12-A：冲撞头车——西瓜车身 + 前方冲撞头（复用既有 ramHead Runtime） */
function ramHeadCarBuild(): BuildSnapshot {
  return {
    id: 'ramHeadCar',
    bodyDefId: 'watermelonBody',
    quality: 1,
    movements: [
      { hardpointId: 'rear', defId: 'wheelStd' },
      { hardpointId: 'front', defId: 'wheelStd' },
    ],
    functionals: [{ hardpointId: 'front', defId: 'ramHead' }],
  };
}

/** Q12-B-CLOSE（prototype/hold）：举升臂车——西瓜车身 + 前方举升臂（front Revolute 上翻 Gadget）；Scenario 保留供复用，不在玩家装配页 */
function lifterCarBuild(): BuildSnapshot {
  return {
    id: 'lifterCar',
    bodyDefId: 'watermelonBody',
    quality: 1,
    movements: [
      { hardpointId: 'rear', defId: 'wheelStd' },
      { hardpointId: 'front', defId: 'wheelStd' },
    ],
    functionals: [{ hardpointId: 'front', defId: 'lifter' }],
  };
}

/** Q12-C：冲锤车——西瓜车身 + 前方冲锤（Prismatic 伸出撞击 Weapon） */
function rammerCarBuild(): BuildSnapshot {
  return {
    id: 'rammerCar',
    bodyDefId: 'watermelonBody',
    quality: 1,
    movements: [
      { hardpointId: 'rear', defId: 'wheelStd' },
      { hardpointId: 'front', defId: 'wheelStd' },
    ],
    functionals: [{ hardpointId: 'front', defId: 'rammer' }],
  };
}

/** Q13-A：圆锯车——西瓜车身 + 前方圆锯（front Revolute 持续高速旋转 Weapon） */
function sawCarBuild(): BuildSnapshot {
  return {
    id: 'sawCar',
    bodyDefId: 'watermelonBody',
    quality: 1,
    movements: [
      { hardpointId: 'rear', defId: 'wheelStd' },
      { hardpointId: 'front', defId: 'wheelStd' },
    ],
    functionals: [{ hardpointId: 'front', defId: 'saw' }],
  };
}

/** Q13-B：霰弹炮车——西瓜车身 + 前方霰弹炮（front Weld 短粗枪管，一次齐射 5 发固定扇形） */
function shotgunCarBuild(): BuildSnapshot {
  return {
    id: 'shotgunCar',
    bodyDefId: 'watermelonBody',
    quality: 1,
    movements: [
      { hardpointId: 'rear', defId: 'wheelStd' },
      { hardpointId: 'front', defId: 'wheelStd' },
    ],
    functionals: [{ hardpointId: 'front', defId: 'shotgun' }],
  };
}

/** Q13-C / Q13-C-R1：推进器车——西瓜车身 + 后方推进器（rear Weld Gadget，车尾点火向车外喷） */
function thrusterCarBuild(): BuildSnapshot {
  return {
    id: 'thrusterCar',
    bodyDefId: 'watermelonBody',
    quality: 1,
    movements: [
      { hardpointId: 'rear', defId: 'wheelStd' },
      { hardpointId: 'front', defId: 'wheelStd' },
    ],
    // Q13-C-R1：改装 rear hardpoint → 喷焰位于车尾外侧、绝不穿过车身；推力方向由安装位置推导。
    functionals: [{ hardpointId: 'rear', defId: 'thruster' }],
  };
}

/** Q14-A：机枪车——西瓜车身 + 前方机枪（front Weld 细长枪管，固定 burst 连发） */
function machineGunCarBuild(): BuildSnapshot {
  return {
    id: 'machineGunCar',
    bodyDefId: 'watermelonBody',
    quality: 1,
    movements: [
      { hardpointId: 'rear', defId: 'wheelStd' },
      { hardpointId: 'front', defId: 'wheelStd' },
    ],
    functionals: [{ hardpointId: 'front', defId: 'machineGun' }],
  };
}

/** Q14-B：喷火器车——西瓜车身 + 前方喷火器（front Weld 短粗喷口，持续短命火焰 projectile 流） */
function flamethrowerCarBuild(): BuildSnapshot {
  return {
    id: 'flamethrowerCar',
    bodyDefId: 'watermelonBody',
    quality: 1,
    movements: [
      { hardpointId: 'rear', defId: 'wheelStd' },
      { hardpointId: 'front', defId: 'wheelStd' },
    ],
    functionals: [{ hardpointId: 'front', defId: 'flamethrower' }],
  };
}

/** Q11-A：楔铲车——西瓜车身 + 前方楔铲（Gadget，无 Direct Damage，无主动动画） */
function wedgeShovelBuild(): BuildSnapshot {
  return {
    id: 'wedgeShovelCar',
    bodyDefId: 'watermelonBody',
    quality: 1,
    movements: [
      { hardpointId: 'rear', defId: 'wheelStd' },
      { hardpointId: 'front', defId: 'wheelStd' },
    ],
    functionals: [{ hardpointId: 'front', defId: 'wedgeShovel' }],
  };
}

/** Q11-B：刺车——西瓜车身 + 顶部刺（细长固定 Weapon，高处水平前伸） */
function spearBuild(): BuildSnapshot {
  return {
    id: 'spearCar',
    bodyDefId: 'watermelonBody',
    quality: 1,
    movements: [
      { hardpointId: 'rear', defId: 'wheelStd' },
      { hardpointId: 'front', defId: 'wheelStd' },
    ],
    functionals: [{ hardpointId: 'top', defId: 'spear' }],
  };
}

/** Q11-B：高目标车——tallBody（高身，刺尖高度可对上） */
function tallTargetBuild(): BuildSnapshot {
  return {
    id: 'tallTarget',
    bodyDefId: 'tallBody',
    quality: 1,
    movements: [
      { hardpointId: 'rear', defId: 'wheelStd' },
      { hardpointId: 'front', defId: 'wheelStd' },
    ],
    functionals: [],
  };
}

/** Q11-C：镭射车——西瓜车身 + 前方镭射（蓄能远程 Weapon，长前摇高威胁） */
function laserBuild(): BuildSnapshot {
  return {
    id: 'laserCar',
    bodyDefId: 'watermelonBody',
    quality: 1,
    movements: [
      { hardpointId: 'rear', defId: 'wheelStd' },
      { hardpointId: 'front', defId: 'wheelStd' },
    ],
    functionals: [{ hardpointId: 'front', defId: 'laser' }],
  };
}

/** Q17-MOVEMENT-PROBE：远程车——正常玩家西瓜车身 + 前方机枪（远程站桩侧） */
function q17RangedBuild(): BuildSnapshot {
  return {
    id: 'q17Ranged',
    bodyDefId: 'watermelonBody',
    quality: 1,
    movements: [
      { hardpointId: 'rear', defId: 'wheelStd' },
      { hardpointId: 'front', defId: 'wheelStd' },
    ],
    functionals: [{ hardpointId: 'front', defId: 'machineGun' }],
  };
}

/** Q17-MOVEMENT-PROBE：近战冲锋车——正常玩家西瓜车身 + 前方圆锯（正常前进侧） */
function q17MeleeBuild(): BuildSnapshot {
  return {
    id: 'q17Melee',
    bodyDefId: 'watermelonBody',
    quality: 1,
    movements: [
      { hardpointId: 'rear', defId: 'wheelStd' },
      { hardpointId: 'front', defId: 'wheelStd' },
    ],
    functionals: [{ hardpointId: 'front', defId: 'saw' }],
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
      // Q02-EXP-R1：拉开初始距离（spawnB 700→750）——A 炮口右缘 ~566，B 左缘 ~675，
      // 弹道 ~90-110px，muzzleSpeed=8 → 首发 ~13 步（≈0.22s）飞行后才命中，
      // 正常速度下有明显可观察飞行过程；再远则重力使慢弹在命中前落地（实测 780+ 打空）。
      spawnA: { x: 450, y: 650, facing: 1 },
      spawnB: { x: 750, y: 650, facing: -1 },
    },
    camera: { fit: 'vehicles' },
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
    camera: { fit: 'primary-fire', recoilExtent: 180, forwardExtent: 520 },
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
    // 与 Cannon-Recoil 共用同一套 primary-fire 固定镜头：A 偏左中部 + 身后 recoil 空间 + 前方射击空间
    camera: { fit: 'primary-fire', recoilExtent: 180, forwardExtent: 520 },
  },
  {
    id: 'Hammer-Hit',
    name: 'Hammer Hit',
    description:
      '锤（Planck）：A 装真实 Revolute 摆锤，固定弧 Wind-up → Swing → Recover 循环挥击；' +
      'B 无攻击件目标车位于挥击弧内，锤头真实接触结算 baseDamage。无自动追踪 / 补偿。',
    buildA: hammerCarBuild(),
    buildB: plainCarBuild(),
    config: {
      engine: 'planck',
      autoDrive: false,
      // A pivot ≈ 450+75=525，锤头初始水平伸至 ~595。spawnB 600 → B 左缘 = 525
      // 与 A 车身右缘相切（chassis 无重叠）；锤头初始伸入 B 区域是固定弧挥击武器的
      // 自然几何：windup 先抬起 → swing 落下命中（实测首次伤害 ~106 步 = swing 阶段，
      // 非出生接触；B 被 A 车身支撑稳定不滚走）。更远的 spawnB（620+）会把带轮 B
      // 推滚出挥击弧导致打空。
      spawnA: { x: 450, y: 650, facing: 1 },
      spawnB: { x: 600, y: 650, facing: -1 },
    },
    camera: { fit: 'vehicles' },
  },
  {
    id: 'Hammer-Miss',
    name: 'Hammer Miss',
    description:
      '锤（Planck）：B 明确放在挥击弧之外（锤头最远 ~595 < B 左缘 825）；' +
      'Hammer 按固定弧正常循环挥击但真实打空——不通过改挥击角追踪敌人。',
    buildA: hammerCarBuild(),
    buildB: plainCarBuild(),
    config: {
      engine: 'planck',
      autoDrive: false,
      spawnA: { x: 450, y: 650, facing: 1 },
      spawnB: { x: 900, y: 650, facing: -1 },
    },
    camera: { fit: 'primary-fire', recoilExtent: 180, forwardExtent: 520 },
  },
  {
    id: 'Hammer-Reaction',
    name: 'Hammer Reaction',
    description:
      '锤（Planck）：轻型 A（wedgeBody）装 hammer，B 放远前几秒无接触；' +
      '单独观察 motor 驱动挥锤时自身车体姿态 / 位置的真实反作用（无 Scenario 补偿力）。',
    buildA: hammerLightBuild(),
    buildB: plainCarBuild(),
    config: {
      engine: 'planck',
      autoDrive: false,
      spawnA: { x: 500, y: 650, facing: 1 },
      spawnB: { x: 1500, y: 650, facing: -1 },
    },
    camera: { fit: 'primary-fire', recoilExtent: 180, forwardExtent: 520 },
  },
  {
    id: 'Push-Light',
    name: 'Push Rod Light',
    description:
      '推杆（Planck）：A 装 Prismatic 推杆，Extend → Hold → Retract 循环；B 普通轻车位于' +
      '杆伸出路径，真实接触被明显推开。Gadget 无 weapon damage；通用 Impact 可自然存在。',
    buildA: pushRodCarBuild(),
    buildB: plainCarBuild(),
    config: {
      engine: 'planck',
      autoDrive: false,
      // A pivot ≈ 450+75=525，杆初始覆盖 525..605；B 左缘 = 700-75=625 > 605 无出生重叠；
      // 杆 extend 90 → 前端 695 > 625 → 顶推 B（Q04-C1 已验证轻目标位移 >30px）
      spawnA: { x: 450, y: 650, facing: 1 },
      spawnB: { x: 700, y: 650, facing: -1 },
    },
    camera: { fit: 'vehicles' },
  },
  {
    id: 'Push-Heavy',
    name: 'Push Rod Heavy',
    description:
      '与 Push-Light 完全相同（A 车 / 初始距离 / Push 参数），仅 B 换 heavyBody：' +
      '同一套 maxForce / speed 下 Heavy 位移明显小于 Light（真实质量反应，无按质量补偿）。',
    buildA: pushRodCarBuild(),
    buildB: heavyTargetBuild(),
    config: {
      engine: 'planck',
      autoDrive: false,
      spawnA: { x: 450, y: 650, facing: 1 },
      spawnB: { x: 700, y: 650, facing: -1 },
    },
    camera: { fit: 'vehicles' },
  },
  {
    id: 'Push-Reaction',
    name: 'Push Rod Reaction',
    description:
      'A 用较轻 chassis（wedgeBody），B 重目标（heavyBox）：推杆伸出接触后，' +
      'A 自身也被真实 joint motor + collision 反作用影响（无 Scenario 补偿）。',
    buildA: pushRodLightBuild(),
    buildB: heavyTargetBuild(),
    config: {
      engine: 'planck',
      autoDrive: false,
      spawnA: { x: 450, y: 650, facing: 1 },
      spawnB: { x: 700, y: 650, facing: -1 },
    },
    camera: { fit: 'primary-fire', recoilExtent: 180, forwardExtent: 520 },
  },
  {
    id: 'Q11',
    name: 'Wedge Shovel (Gadget) [ARCHIVED]',
    description:
      '楔铲（Q11-A-CLOSE ARCHIVED）：A 西瓜车身 + 前方楔铲（短陡 25° 楔形 ' +
      'polygon，Gadget，无 Direct Damage / 无主动动画）vs B 香蕉车身（标准轮、' +
      '无功能件）。已退出玩家 Build（连续真人验收失败：对方前轮/前置部件优先 ' +
      '阻挡楔面）；保留本场景仅用于参考 archived prototype 的真实物理行为。',
    buildA: wedgeShovelBuild(),
    buildB: bananaTargetBuild(),
    config: {
      engine: 'planck',
      autoDrive: true,
      spawnA: { x: 450, y: 650, facing: 1 },
      spawnB: { x: 1150, y: 650, facing: -1 },
    },
    camera: { fit: 'vehicles' },
  },
  {
    id: 'Q11-B',
    name: 'Spear (Weapon)',
    description:
      '固定刺（Q11-B）：A 西瓜车身 + 顶部刺（细长固定 Weapon，高处水平前伸，无摆动/无追踪）。' +
      'B 高身车（tallBody）高度对上 → 刺尖真实接触（Weapon Contact 正式链路）命中；' +
      '对手矮 / 姿态低时刺尖从上方自然擦空（Miss）。伤害与碰撞位置一致，擦空就是 Miss。',
    buildA: spearBuild(),
    buildB: tallTargetBuild(),
    config: {
      engine: 'planck',
      autoDrive: true,
      spawnA: { x: 450, y: 650, facing: 1 },
      spawnB: { x: 1150, y: 650, facing: -1 },
    },
    camera: { fit: 'vehicles' },
  },
  {
    id: 'Q11-C',
    name: 'Laser (Charge Weapon)',
    description:
      '蓄能镭射（Q11-C）：A 西瓜车身 + 前方镭射——固定方向蓄能 ~1.5s（蓄能过程'
      + '肉眼可见，weaponCharge 事件），发射复用真实 Projectile / CCD 链路'
      + '（speed/damage/recoil 约 Cannon 2×）。朝向不对可真实打空；开火瞬间自车'
      + '明显后坐；projectile 真实 hit / miss / destroy。',
    buildA: laserBuild(),
    buildB: plainCarBuild(),
    config: {
      engine: 'planck',
      autoDrive: true,
      spawnA: { x: 450, y: 650, facing: 1 },
      spawnB: { x: 1150, y: 650, facing: -1 },
    },
    camera: { fit: 'vehicles' },
  },
  // Q12-A-HOLD（prototype/hold）：冲撞头已暂退正式 Build（PART_OPTIONS 已移除），
  // 本 Scenario 保留为隔离验证 ramHead Runtime / 重做冲撞类内容的入口，仍可加载。
  {
    id: 'Q12',
    name: 'Ram Head (prototype/hold)',
    description:
      '冲撞头（Q12-A）：A 西瓜车身 + 前方冲撞头（短粗前置 box 44×26，固定'
      + 'Contact Weapon，复用既有 ramHead Runtime）vs B 香蕉车身（标准轮、无功能件，'
      + '隔离验证）。正面真实撞到才产生 Weapon Damage（baseDamage 80）；擦空/高度'
      + '错开自然失败；无隐藏击退/自动瞄准。与刺（96×6 长细）视觉与距离定位明显不同。',
    buildA: ramHeadCarBuild(),
    buildB: bananaTargetBuild(),
    config: {
      engine: 'planck',
      autoDrive: true,
      spawnA: { x: 450, y: 650, facing: 1 },
      spawnB: { x: 1150, y: 650, facing: -1 },
    },
    camera: { fit: 'vehicles' },
  },
  {
    id: 'Q12-B',
    name: 'Lifter Arm (prototype/hold)',
    description:
      '举升臂（Q12-B）：A 西瓜车身 + 前方举升臂（front Revolute，低位待机 → '
      + '主动向上翻 ~70° → 回落，复用 Hammer 的 Revolute / motor / limit，无 Direct '
      + 'Weapon Damage）vs B 香蕉车身（标准轮、无功能件，隔离验证）。臂在翻动弧内 '
      + '时对手由真实碰撞被明显抬起；错过弧内时机自然失败；自车承担真实反作用。',
    buildA: lifterCarBuild(),
    buildB: bananaTargetBuild(),
    config: {
      engine: 'planck',
      autoDrive: true,
      spawnA: { x: 450, y: 650, facing: 1 },
      spawnB: { x: 1150, y: 650, facing: -1 },
    },
    camera: { fit: 'vehicles' },
  },
  {
    id: 'Q12-C',
    name: 'Rammer (Prismatic Strike Weapon)',
    description:
      '冲锤（Q12-C）：A 西瓜车身 + 前方冲锤（Prismatic 前摇 → 快速伸出 → '
      + '接触伤害 → 回收，复用 Push Rod 的 motor + limit，仅锤头真实 Contact '
      + '走 Weapon Damage）vs B 香蕉车身（标准轮、无功能件，隔离验证）。'
      + '伸出撞击真实命中才有伤害；没撞到就是 Miss；无固定击退/自动瞄准。',
    buildA: rammerCarBuild(),
    buildB: bananaTargetBuild(),
    config: {
      engine: 'planck',
      autoDrive: true,
      spawnA: { x: 450, y: 650, facing: 1 },
      spawnB: { x: 1150, y: 650, facing: -1 },
    },
    camera: { fit: 'vehicles' },
  },
  {
    id: 'Q13-A',
    name: 'Saw (Circular Saw Weapon)',
    description:
      '圆锯（Q13-A）：A 西瓜车身 + 前方圆锯（front Revolute 持续单方向高速旋转，' +
      '真实圆形 Collider；锯片随真实 part angle 旋转，正常速度一眼可见）。B 香蕉车身' +
      '（标准轮、无功能件，隔离验证）。自动靠近时锯片真实圆边持续接触对手 → 走现有' +
      ' Weapon Contact 的 contactTick 持续切割伤害（每 100ms 一跳）；没接触 → 无伤害；' +
      '自车与对手均受真实碰撞反作用。无固定击退 / 不直扣 HP / 不新建伤害系统。',
    buildA: sawCarBuild(),
    buildB: bananaTargetBuild(),
    config: {
      engine: 'planck',
      autoDrive: true,
      spawnA: { x: 450, y: 650, facing: 1 },
      spawnB: { x: 1150, y: 650, facing: -1 },
    },
    camera: { fit: 'vehicles' },
  },
  {
    id: 'Q13-B',
    name: 'Shotgun (Scatter Weapon)',
    description:
      '霰弹炮（Q13-B / Q13-B-R1）：A 西瓜车身 + 前方霰弹炮（front Weld 短粗枪管，一次' +
      '齐射 5 发固定扇形 -12/-6/0/+6/+12° 真实 projectile，复用正式 Projectile / CCD /' +
      ' Owner Filter 链）。B 无攻击件目标车（boxBody），近距离放置以便首发即可看清多弹' +
      '命中。射程由「高速弹道 + 扇形散开」自然形成：近距离 5 发聚拢 → 多弹命中；远处' +
      '因扇形角自然散开 → 部分/全部 Miss（无距离判定消失伤害）。发射瞬间一次明显扇形' +
      '炮口爆闪 + 整车明显后坐；每发独立走 ContactRouter 正式 projectileDamage。无随机' +
      '散布 / 不自动瞄准 / 不做扇形 raycast / 不新建 Projectile 系统。',
    buildA: shotgunCarBuild(),
    buildB: plainCarBuild(),
    config: {
      engine: 'planck',
      autoDrive: true,
      spawnA: { x: 450, y: 650, facing: 1 },
      spawnB: { x: 560, y: 650, facing: -1 }, // Q13-B-R1：近距离隔离验收（首发即可看清多弹命中）
    },
    camera: { fit: 'vehicles' },
  },
  {
    id: 'Q13-C',
    name: 'Thruster (Gadget Boost)',
    description:
      '推进器（Q13-C / Q13-C-R1 / Q13-C-R2）：A 西瓜车身 + 后方推进器（rear Weld Gadget）。固定周期：' +
      ' 短前摇 0.25s → 强爆发推进 0.3s → 冷却 1.5s，循环。推进方向=车辆真实前向（车头方向=推进' +
      ' 方向；喷焰与推进方向严格相反；Q13-C-R2 删除「安装位置决定前进方向」规则，安装位置只影响' +
      ' 冲量作用点/力矩）；冲量只施加自己 chassis、作用点=真实安装点（applyLinearImpulse，不' +
      ' setVelocity / 不 teleport / 不给对手力 / 不造成 Direct Weapon Damage）。推进期在真实安装' +
      ' 位置画明显大喷焰（≈105×35），停推即消失。本场景 autoDrive=false 以单独呈现「车尾点火→大' +
      ' 喷焰→整车突然窜出去」。',
    buildA: thrusterCarBuild(),
    buildB: plainCarBuild(),
    config: {
      engine: 'planck',
      autoDrive: false, // 隔离推力效果：关闭自动驱动，单独看「喷火→突然加速」
      spawnA: { x: 450, y: 650, facing: 1 },
      spawnB: { x: 1150, y: 650, facing: -1 },
    },
    camera: { fit: 'vehicles' },
  },
  {
    id: 'Q14-A',
    name: 'MachineGun (Burst Weapon)',
    description:
      '机枪（Q14-A / Q14-A-R1）：A 西瓜车身 + 前方机枪（front Weld 细长枪管，固定 burst 连发）。固定节奏：' +
      ' 一次 burst 7 发（发间隔 100ms，burst 总持续 600ms）→ 冷却 1100ms，循环。每发都是真实' +
      ' projectile，全部沿真实炮口方向（part 世界姿态 × facing）高速水平直线（gravityScale=0）' +
      ' 射出——Q14-A-R1 视觉：枪口沿真实 fire 方向短促窄火舌连续快闪 + 每发细亮暖白高速弹链' +
      ' （machineGunTracer，独立于霰弹 tracer 身份；复用正式 Projectile / CCD / Owner Filter /' +
      ' ContactRouter 链，不创建第二套系统）。B 为正常玩家香蕉目标（bananaTargetBuild），' +
      ' autoDrive=false 隔离验收：按真实 bounds 留距（A 右缘含枪管 568 / 香蕉左缘 ~680），一个完整' +
      ' burst 全程可见、子弹直线命中香蕉、两车 burst 内不发生车体接触。每发真实碰到才伤害（Miss' +
      ' 就是 Miss）、每发单次小后坐作用于本车 chassis。无随机散布 / 不自动瞄准 / 不做 hitscan /' +
      ' 不 raycast / 不改 Cannon / Shotgun / Laser。',
    buildA: machineGunCarBuild(),
    buildB: bananaTargetBuild(),
    config: {
      engine: 'planck',
      // Q14-A-R1：隔离验收——两车静止，完整 burst 不被车体贴脸碰撞遮住射击表现
      autoDrive: false,
      spawnA: { x: 450, y: 650, facing: 1 },
      // Q14-A-R1：按真实 bounds 取距——A 右缘 568（含枪管）与香蕉左缘（x-95=680）留 ~112px：
      // 整个 burst（7 发 × 100ms）完整可见、子弹直线命中香蕉、两车 burst 内不发生车体接触。
      spawnB: { x: 775, y: 650, facing: -1 },
    },
    camera: { fit: 'vehicles' },
  },
  {
    id: 'Q14-B',
    name: 'Flamethrower (Close Flame)',
    description:
      '喷火器（Q14-B / Q14-B-R1）：A 西瓜车身 + 前方喷火器（front Weld 短粗喷口）。持续喷射 1.0s →' +
      ' 短冷却 0.6s → 再喷，循环：喷口点燃（每颗粒小型闪光）→ 一股短距离火流持续喷向前方。' +
      ' 伤害载体复用真实 Projectile 链：连续生成小型短命火焰 projectile（gravityScale=0、' +
      ' 生命周期由 behavior 自管理、超时真实 destroy）——射程 ≈1.1 个西瓜车身长（正常可读速度 +' +
      ' 很短寿命，非低速慢飘），贴近敌人才有效；确定性 -6°/0°/+6° 循环分叉（无随机）。' +
      ' Q14-B-R1 视觉：每颗火焰颗粒沿真实 velocity 画「填充火焰叶」（外层橙红 35~45px 后端收尖 +' +
      ' 内层黄橙 24~30px + 弹头黄白高亮），相邻叶明显重叠 → 正常速度连成一股连续火流（不再是一根根' +
      ' 细红线）；视觉可大于 collider 但命中范围不变、超时即同步消失。B 为正常玩家香蕉目标' +
      ' （bananaTargetBuild），autoDrive=false 隔离验收：按真实 bounds 留距（A 右缘含喷口 558 / 香蕉' +
      ' 左缘 ~625），火流可命中且一个完整 spray 期间两车不发生车体接触。不做 cone raycast / 不做隐藏' +
      ' 距离扣血 / 不建 Particle Foundation / 不改 Shotgun / MachineGun。',
    buildA: flamethrowerCarBuild(),
    buildB: bananaTargetBuild(),
    config: {
      engine: 'planck',
      // Q14-B-R1：隔离验收——两车静止，完整 spray 不被车体碰撞遮住火流
      autoDrive: false,
      spawnA: { x: 450, y: 650, facing: 1 },
      // Q14-B-R1：按真实 bounds 留距——A 右缘 558（含喷口）与香蕉左缘（x-95=625）留 ~67px：
      // 火流（射程 ≈192px）可命中香蕉，且一个完整喷射周期内两车不发生车体接触。
      spawnB: { x: 720, y: 650, facing: -1 },
    },
    camera: { fit: 'vehicles' },
  },
  // Q17-MOVEMENT-PROBE｜站桩 vs 前进 的接敌方式验证（DEV 隔离；正式玩家 Build 未接入）。
  // 唯一主要变量是 Movement/drive：A/B 同两套武器，Q17-A 只关 A 的 drive，Q17-B 双方正常前进。
  {
    id: 'Q17-A',
    name: 'Stationary Ranged vs Charger (Probe)',
    description:
      '站桩探针（Q17-A）：A 远程机枪车「轮子存在但不驱动」（sideDrive.a=false → wheel motor 关闭，' +
      '仍可被真实碰撞推动/翻转，非固定炮塔）；B 近战圆锯车正常前进冲锋。验证「远程车不主动前进」' +
      '是否自然形成「一方原地射击 / 一方主动接近」的不同接敌过程（无自动拉距/倒车/锁位置/隐藏职业）。',
    buildA: q17RangedBuild(),
    buildB: q17MeleeBuild(),
    config: {
      engine: 'planck',
      autoDrive: true,
      sideDrive: { a: false, b: true }, // A 站桩 / B 正常驱动（复用 drivePlanckVehicle 既有 enabled 语义）
      spawnA: { x: 450, y: 650, facing: 1 },
      spawnB: { x: 950, y: 650, facing: -1 },
    },
    camera: { fit: 'vehicles' },
  },
  {
    id: 'Q17-B',
    name: 'Ranged vs Charger · 双方正常前进（对照）',
    description:
      '站桩探针对照（Q17-B）：与 Q17-A 完全相同的两套武器与出生位置，但双方都使用当前正常自动驱动' +
      '（无 sideDrive → 跟随 autoDrive）。唯一主要变量 = Movement/drive，用于肉眼对照两种接敌过程。',
    buildA: q17RangedBuild(),
    buildB: q17MeleeBuild(),
    config: {
      engine: 'planck',
      autoDrive: true, // 双方驱动（无 sideDrive）
      spawnA: { x: 450, y: 650, facing: 1 },
      spawnB: { x: 950, y: 650, facing: -1 },
    },
    camera: { fit: 'vehicles' },
  },
];

export function getScenario(id: string): ScenarioDef | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
