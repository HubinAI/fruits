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

/**
 * 西瓜车身（W2-SIL-1 正式 Content 视觉样板）：宽厚、低矮、明显重量感。
 * - Collider：单宽扁 box（170×50），物理稳定；质量 baseMass 120（明显重于 boxBody 50）；
 * - Visual：body_watermelon sprite（圆润西瓜轮廓 + 深绿条纹），视觉与 Collider 解耦，
 *   不再使用普通矩形视觉；anchor(0,0) 以 body 真实原点为中心，mirrorWithFacing 使
 *   facing=-1 时整体镜像。
 */
const watermelonBody: BodyDef = {
  id: 'watermelonBody',
  name: '西瓜车身',
  colliders: [{ shape: 'box', width: 170, height: 50, offset: { x: 0, y: 0 } }],
  baseMass: 120,
  hp: 1100,
  energyCapacity: 110,
  movementHardpoints: [
    { id: 'rear', localPosition: { x: -58, y: 25 }, localRotation: 0 },
    { id: 'front', localPosition: { x: 58, y: 25 }, localRotation: 0 },
  ],
  functionalHardpoints: [
    { id: 'front', localPosition: { x: 78, y: 0 }, localRotation: 0 },
    { id: 'frontMass', localPosition: { x: 45, y: -8 }, localRotation: 0 },
    { id: 'top', localPosition: { x: 0, y: -25 }, localRotation: 0 },
    { id: 'rear', localPosition: { x: -78, y: 0 }, localRotation: 0 },
  ],
  visual: {
    visualId: 'body_watermelon',
    size: { width: 180, height: 60 },
    anchor: { x: 0, y: 0 },
    rotation: 0,
    layer: 1,
    mirrorWithFacing: true,
  },
};

/**
 * 香蕉车身（W2-SIL-1 正式 Content 视觉样板）：长条/弧形视觉，前后高度关系明显。
 * - Collider：两段 box（前段略低、后段略高）近似弧形，简单非矩形组合，物理稳定；
 * - 质量 baseMass 45（轻），hp/energy 略低于西瓜（90），与西瓜一眼可区分；
 * - Visual：body_banana sprite（黄色弧形香蕉轮廓，后段明显更高），anchor(0,0) 居中。
 */
const bananaBody: BodyDef = {
  id: 'bananaBody',
  name: '香蕉车身',
  colliders: [
    { shape: 'box', width: 120, height: 40, offset: { x: 35, y: 4 } },
    { shape: 'box', width: 120, height: 44, offset: { x: -35, y: -4 } },
  ],
  baseMass: 45,
  hp: 900,
  energyCapacity: 90,
  movementHardpoints: [
    { id: 'rear', localPosition: { x: -62, y: 24 }, localRotation: 0 },
    { id: 'front', localPosition: { x: 62, y: 24 }, localRotation: 0 },
  ],
  functionalHardpoints: [
    { id: 'front', localPosition: { x: 82, y: -2 }, localRotation: 0 },
    { id: 'frontMass', localPosition: { x: 48, y: -6 }, localRotation: 0 },
    { id: 'top', localPosition: { x: 0, y: -24 }, localRotation: 0 },
    { id: 'rear', localPosition: { x: -82, y: -2 }, localRotation: 0 },
  ],
  visual: {
    visualId: 'body_banana',
    size: { width: 200, height: 56 },
    anchor: { x: 0, y: 0 },
    rotation: 0,
    layer: 1,
    mirrorWithFacing: true,
  },
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
 * Hammer（锤，Q03-F2）：Revolute 摆动武器。
 * - 首版用长矩形 collider：part body 原点 = pivot（功能挂点），collider 中心经
 *   offset.x=40 前移 → 质量中心明显远离 pivot（createDynamicCompound 质量分布跟随
 *   形状位置，真实摆锤，无需 compound schema）；
 * - baseDamage：头部真实接触走 ContactRouter weapon 直击路径（复用 ram 语义）；
 * - 本队列不实现挥击状态机（motor / limit / Wind-up-Swing-Recover 由后续
 *   HammerBehavior 驱动，本定义只提供摆锤的物理装配输入）。
 */
const hammer: FunctionalPartDef = {
  id: 'hammer',
  name: '锤',
  category: 'weapon',
  mass: 40, // 明显质量（ram 30 / cannon 20 之上）
  energy: 25,
  // 长矩形 60×14：形状覆盖 x∈[10,70]（相对 pivot），质心在 x=40，离 pivot 40px
  collider: { shape: 'box', width: 60, height: 14, offset: { x: 40, y: 0 } },
  behavior: 'hammer',
  behaviorParams: { baseDamage: 90 },
  // W2-SIL-1：细长柄 + 大锤头；pivot 必须与真实 Revolute 一致——sprite 覆盖本地
  // x∈[-3,71]（anchor 34、半宽 37），本地 x=0（= Revolute pivot）处为柄根，锤头在远端。
  visual: {
    visualId: 'part_hammer',
    size: { width: 74, height: 20 },
    anchor: { x: 34, y: 0 },
    rotation: 0,
    layer: 10,
    mirrorWithFacing: true,
  },
};

/**
 * Cannon（炮，Q02-C2）：Fixed Mount 武器，只定义内容，不实现发射行为（Q02-C1）。
 * - 有真实 collider / mass / energy；
 * - 不设置 baseDamage：炮身接触不能直接造成 Weapon Damage，
 *   伤害只能来自 projectile 命中（behaviorParams.projectileDamage）；
 * - behaviorParams 仅含六个参数（首版取明显、易验证数值，不做精细平衡）：
 *   cooldownMs / muzzleSpeed / projectileDamage / projectileRadius /
 *   projectileMass / recoilImpulse。
 * - Q02-EXP-R1：可感知性放大（录屏验收，非平衡）——
 *   projectileRadius 6→10（弹体更可见）、muzzleSpeed 12→8（飞行过程可观察）、
 *   recoilImpulse 12→30（后座位移/姿态更明显）；cooldown / damage / mass 不变。
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
    muzzleSpeed: 8,
    projectileDamage: 80,
    projectileRadius: 10,
    projectileMass: 1,
    recoilImpulse: 30,
  },
  // W2-SIL-1：炮座 + 炮管 + 炮口；sprite 覆盖本地 x∈[-8,40]（anchor 16、半宽 24），
  // 炮口（图片右端）与真实 muzzle 对齐——muzzle 本地 x = offset 20 + halfW 20 = 40 ✓。
  visual: {
    visualId: 'part_cannon',
    size: { width: 48, height: 22 },
    anchor: { x: 16, y: 0 },
    rotation: 0,
    layer: 10,
    mirrorWithFacing: true,
  },
};

/**
 * Push Rod（推杆，Q04-F2）：Prismatic 伸缩 Gadget。
 * - 只通过真实接触改变敌我距离/姿态，Direct Damage = 0（Gadget 天然绕过
 *   ContactRouter weapon 路径；baseDamage 不设置）；
 * - 单长矩形 collider 从挂点向车辆前方延伸（offset.x=40、宽 80 → 覆盖 pivot..pivot+80）；
 * - 本队列不做伸缩状态机（Extend→Hold→Retract 由后续 PushRodBehavior 用 motor+limit 驱动）。
 */
const pushRod: FunctionalPartDef = {
  id: 'pushRod',
  name: '推杆',
  category: 'gadget',
  mass: 15,
  energy: 20,
  collider: { shape: 'box', width: 80, height: 12, offset: { x: 40, y: 0 } },
  behavior: 'pushRod',
  // W2-SIL-1：车身侧基座 + 细连接杆 + 前端宽推板；sprite 覆盖本地 x∈[-6,92]
  // （anchor 43、半宽 49）——基座贴近 chassis 锚点（t=0 时本地 0 ≈ 挂点）、推板位于
  // collider 前端（本地 80）附近，Prismatic 伸出时整件随 part 平移，视觉自然伸缩。
  visual: {
    visualId: 'part_pushRod',
    size: { width: 98, height: 18 },
    anchor: { x: 43, y: 0 },
    rotation: 0,
    layer: 10,
    mirrorWithFacing: true,
  },
};

/**
 * Q11-A：楔铲（Gadget）——低矮楔形 Collider（polygon），固定安装在前方，
 * 随整车移动，无主动动画 / 无 behavior（behavior:'none'）。
 * 翻起效果完全来自真实碰撞几何、质量、速度与力矩（钻入对手底部 → 沿坡面
 * 真实反作用抬起 / 掀翻）。
 * - 无 baseDamage → 不走 ContactRouter weapon 直击，无 Direct Weapon Damage；
 * - 不加隐藏向上力 / 不 setPosition / 不 setVelocity / 无固定翻转角；
 * - 接触位置不合适时只滑过 / 顶住，不自动翻车；自车同样承担碰撞反作用。
 *
 * 【ARCHIVED PROTOTYPE（Q11-A-CLOSE）】连续多轮真人验收失败：对方前轮 /
 * 前置部件会优先阻挡楔面，「钻底盘 → 明显抬升」核心体验不能稳定成立。
 * 已从玩家 Build PART_OPTIONS 移除；本定义 / Q11 专用 Scenario / 测试代码
 * 全部保留供参考。底层 polygon / collision 能力未删。
 */
const wedgeShovel: FunctionalPartDef = {
  id: 'wedgeShovel',
  name: '楔铲',
  category: 'gadget',
  mass: 25, // 明显质量：钻入反作用自车也承担
  energy: 15,
  // 楔形 polygon（Q11-A-R2 重新设计，不再沿用旧 9° 长浅坡）：
  // - 按正式 watermelonBody(A) + bananaBody(B) 世界几何计算（旧设计按
  //   boxBody 推导，对 banana 不成立——楔铲进入香蕉前轮下方但几乎不抬头）；
  // - 楔尖世界 (A+138, groundY−10)：贴地（离地 10px）、低于 banana 底盘
  //   下缘（groundY−20）10px、位于 banana 前轮（轮 y∈[groundY−40, groundY]）
  //   下部——前轮压上坡面即被抬起；
  // - 坡顶世界 (A+90, groundY−32)：侵入 banana 底盘（groundY−20）上方
  //   12px → 顶起整车；坡长 48px、高差 22px → atan(22/48)≈24.6°
  //   （目标 20°~30° 短陡坡，第一版允许矫枉过正）；
  // - 视觉灰盒 = 真实 Collider（Renderer part 灰盒直接由 collider 转
  //   RenderShape），轮廓与几何一致。
  collider: {
    shape: 'polygon',
    vertices: [
      { x: 40, y: 0 }, // 前端楔尖（低，贴近地面）
      { x: -8, y: -22 }, // 后端坡顶（高，侵入对手底盘顶起整车）
      { x: -8, y: 2 }, // 后端底面
      { x: 40, y: 2 }, // 前端底面
    ],
    offset: { x: 20, y: 35 },
  },
  behavior: 'none',
};

/**
 * Q11-B：刺（Weapon）——前向细长固定武器，无摆动 / 无追踪 / 无主动动画。
 * - 挂在顶部 hardpoint（高处水平前伸）：高度与姿态决定能否命中——
 *   对手高 / 前倾时刺尖真实接触（现有 Weapon Contact 正式链路），
 *   对手矮 / 低姿态时从上方自然擦空（Miss）。
 * - 伤害只走现有链路：category 'weapon' + behaviorParams.baseDamage +
 *   真实有效接触（relativeVelocity ≥ WEAPON_CONTACT_THRESHOLD）；
 *   真实碰到才伤害，擦空就是 Miss。无自动瞄准、无隐藏攻击范围、
 *   无击退补偿。
 * - 暂不加入玩家 Build 选项（PART_OPTIONS），仅供专用测试场景使用。
 */
const spear: FunctionalPartDef = {
  id: 'spear',
  name: '刺',
  category: 'weapon',
  mass: 12, // 细长，质量轻
  energy: 25,
  // 细长前伸 + 前端刺尖：本地 x∈[-6,90]（长 96）、y∈[-3,3]（高 6，细）。
  // 顶点相对 offset（part 原点 = 挂点）；offset (0,0) → 刺从挂点水平前伸。
  collider: {
    shape: 'polygon',
    vertices: [
      { x: 90, y: 0 }, // 前端刺尖（最远点，命中判定集中在尖）
      { x: -6, y: -3 }, // 后端上
      { x: -6, y: 3 }, // 后端下
    ],
    offset: { x: 0, y: 0 },
  },
  behavior: 'ram', // 固定接触武器（与 ramHead 同链路；无 behavior runtime）
  behaviorParams: { baseDamage: 60 },
};

/**
 * Q11-C：镭射（Weapon）——蓄能远程武器，与普通炮明显不同的体验：
 * 长前摇（蓄能 ~1.5s）→ 高威胁射击 → 强后坐力。
 * - 固定朝真实车身/挂点方向蓄能（不跟踪目标 / 不自动瞄准 / 不隐藏锁定）；
 * - 发射完全复用现有真实 Projectile / CCD 链路（dynamic circle + bullet=true，
 *   OwnerTag + ContactRouter 结算），不创建第二套 Projectile 系统；
 * - 初版差异故意做大（后续真人验收再回收）：muzzleSpeed / projectileDamage /
 *   recoilImpulse 约 Cannon 2×；
 * - 蓄能过程通过 weaponCharge 事件表现（肉眼可见），不参与伤害判定。
 * - 暂不加入玩家 Build 选项（PART_OPTIONS），仅供专用测试场景使用。
 */
const laser: FunctionalPartDef = {
  id: 'laser',
  name: '镭射',
  category: 'weapon',
  mass: 20,
  energy: 45,
  collider: { shape: 'box', width: 40, height: 20, offset: { x: 20, y: 0 } },
  behavior: 'laser',
  behaviorParams: {
    chargeMs: 1500,
    cooldownMs: 1800,
    // Q11-C-R2：16 → 56（Cannon 8 的 7×；R2 方案要求 48~64 高速能量束）。
    // 保留 F2 gravityScale=0（水平直线飞行，无抛物线）；真实 hit/miss/CCD 不变。
    muzzleSpeed: 56,
    projectileDamage: 160, // Cannon 80 ×2
    projectileRadius: 12,
    projectileMass: 1,
    // Q11-C-R1：60 → 240（Cannon 30 的 8×）——实测 60 时 chassis Δv 仅
    // 0.33px/step（≈20px/s）且 autoDrive 150ms 内拉回，正常速度肉眼不可
    // 感知；240 使开火瞬间 Δv ≈1.3px/step（≈79px/s 明显后顿），仍是
    // 「初版差异故意做大、后续真人验收再回收」的定位。
    recoilImpulse: 240,
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
      [watermelonBody.id, watermelonBody],
      [bananaBody.id, bananaBody],
    ]),
    movements: new Map([[wheelStd.id, wheelStd]]),
    functionals: new Map([
      [ramHead.id, ramHead],
      [cannon.id, cannon],
      [testMass.id, testMass],
      [wedgeShovel.id, wedgeShovel],
      [spear.id, spear],
      [laser.id, laser],
      [hammer.id, hammer],
      [pushRod.id, pushRod],
    ]),
  };
}

/** 默认 Registry 单例（正式 Runtime 与 Lab 共用同一内容库） */
export const registry: ContentRegistry = createRegistry();
