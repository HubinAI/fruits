/**
 * Q15 / Q16｜正常玩家对手池（纯数据 + 纯函数，可测试）。
 *
 * Q16+Q19：对手铺量——由 6 套扩到 36 套明显不同、全部合法的正常 Build。
 * F-CONTENT-OPPONENT-BUILD-POOL-R1：新增 13 套模板（heavyBox / tallBody 首次进对手池，
 * 补「重型/高惯性」类别），并给全部 49 套建立正式模板 ID + 五类战斗定位（rush/ranged/
 * heavy/control/hybrid）。只做内容组合铺量：不新增机制、不调整任何部件数值。
 * - Body：watermelon / banana / pineapple / coconut（Q16+Q19）+ heavyBox / tallBody（R1 新增）；
 *   容量 110 / 90 / 100 / 100 / 100 / 100；
 * - 只使用当前正式 PART_OPTIONS 部件（不含 wedge / ramHead / lifter / 旋锤 等 HOLD / prototype 内容）；
 * - 轮径显式指定（12 / 20 / 26），覆盖 前小后大 / 前大后小 / 双小 / 双标准 / 双大 五类组合，
 *   走真实 Physics，无姿态补偿；
 * - 6 类战斗身份各 ≥6 套（旧 4 + Q19 新 2）：远程压制 / 近距离爆发 / 持续贴身 / 冲锋接敌 / 控距干扰 / 混合型；
 *   R1 五类定位（模板表）：近战突进 rush ≥3 / 远程压制 ranged ≥3 / 重型高惯 heavy ≥2 /
 *   控距姿态 control ≥2 / 混合 hybrid ≥2；
 * - 每套都是合法 Build（≥1 Weapon、Energy 不超载、槽位合法、无 HOLD）。
 *
 * 不做匹配算法 / 段位 / Elo —— 玩家「寻找对手」随机抽取（不连续重复同一 index）。
 */
import type { BuildDraft, DriveMode } from '../lab/buildEditorModel';
import { EMPTY_SLOT } from '../lab/buildEditorModel';
import { registry } from '../core/content';
import type { Tier } from '../core/playerProgress';

/** 轮径组合（单位 px；WHEEL_OPTIONS 正式档位 12 小 / 20 标准 / 26 大） */
interface OppWheels {
  rear: number;
  front: number;
}

/** 生成一份完整 4 挂点（其余默认空槽）的对手 Draft；轮径必须显式指定 */
function opp(
  bodyDefId: string,
  wheels: OppWheels,
  selections: Partial<Record<string, string>>,
  drive?: DriveMode,
): BuildDraft {
  return {
    bodyDefId,
    rearRadius: wheels.rear,
    frontRadius: wheels.front,
    functionalSelections: {
      front: EMPTY_SLOT,
      frontMass: EMPTY_SLOT,
      top: EMPTY_SLOT,
      rear: EMPTY_SLOT,
      ...selections,
    },
    drive,
  };
}

/**
 * 24 套人工对手配置（车队风格明显不同；每类 4 套）。
 * 槽位：front / frontMass / top / rear（两 Body 均有这 4 个 functional 挂点）。
 * 能量（≤ 容量，西瓜 110 / 香蕉 90）：炮30 机枪30 镭射45 霰弹30 冲锤25 圆锯25 刺25
 *       锤25 喷火30 / 推杆20 推进器20。
 */

/* 1｜远程压制：炮 / 机枪 / 镭射 组合（4 套）— F-MOVE-1 全部「停驻」（站桩压制，约 4/24 停驻） */
const RANGED_SUPPRESSION = [
  opp('watermelonBody', { rear: 26, front: 12 }, { front: 'machineGun', frontMass: 'cannon' }, 'stationary'), // 前小后大 60/110
  opp('bananaBody', { rear: 20, front: 20 }, { front: 'laser', frontMass: 'cannon' }, 'stationary'), // 双标准 75/90
  opp('watermelonBody', { rear: 26, front: 26 }, { front: 'cannon', frontMass: 'machineGun' }, 'stationary'), // 双大 60/110
  opp('bananaBody', { rear: 12, front: 26 }, { front: 'machineGun', frontMass: 'laser' }, 'stationary'), // 前大后小 75/90
];

/* 2｜近距离爆发：霰弹 / 圆锯 / 刺 组合（4 套）— 全部前进 */
const CLOSE_BURST = [
  opp('watermelonBody', { rear: 12, front: 12 }, { front: 'shotgun', top: 'saw' }), // 双小 55/110
  opp('bananaBody', { rear: 20, front: 20 }, { front: 'shotgun', frontMass: 'spear' }), // 双标准 55/90
  opp('watermelonBody', { rear: 26, front: 12 }, { front: 'saw', frontMass: 'shotgun' }), // 前小后大 55/110
  opp('bananaBody', { rear: 12, front: 26 }, { front: 'spear', frontMass: 'shotgun' }), // 前大后小 55/90
];

/* 3｜持续贴身：喷火 / 圆锯 / 锤 组合（4 套）— 全部前进 */
const CONTINUOUS_CONTACT = [
  opp('watermelonBody', { rear: 12, front: 12 }, { front: 'flamethrower', top: 'hammer' }), // 双小 55/110
  opp('bananaBody', { rear: 20, front: 20 }, { front: 'flamethrower', frontMass: 'saw' }), // 双标准 55/90
  opp('watermelonBody', { rear: 26, front: 26 }, { front: 'saw', frontMass: 'hammer' }), // 双大 50/110
  opp('bananaBody', { rear: 26, front: 12 }, { front: 'hammer', frontMass: 'flamethrower' }), // 前小后大 55/90
];

/* 4｜冲锋接敌：推进器 + 近战武器（4 套）— 全部前进 */
const CHARGE = [
  opp('watermelonBody', { rear: 12, front: 12 }, { front: 'rammer', rear: 'thruster' }), // 双小 45/110
  opp('bananaBody', { rear: 12, front: 26 }, { front: 'saw', rear: 'thruster' }), // 前大后小 45/90
  opp('watermelonBody', { rear: 20, front: 20 }, { front: 'spear', top: 'hammer', rear: 'thruster' }), // 双标准 70/110
  opp('bananaBody', { rear: 26, front: 26 }, { front: 'hammer', rear: 'thruster' }), // 双大 45/90
];

/* 5｜控距干扰：推杆 + 远程（4 套）— F-MOVE-1：2 套停驻 / 2 套前进（总体约 6/24 停驻） */
const RANGE_CONTROL = [
  opp('watermelonBody', { rear: 26, front: 12 }, { front: 'pushRod', frontMass: 'cannon' }, 'stationary'), // 前小后大 50/110 · 停驻
  opp('bananaBody', { rear: 20, front: 20 }, { front: 'pushRod', frontMass: 'machineGun' }, 'stationary'), // 双标准 50/90 · 停驻
  opp('watermelonBody', { rear: 26, front: 26 }, { front: 'pushRod', frontMass: 'shotgun' }), // 双大 50/110 · 前进
  opp('bananaBody', { rear: 12, front: 26 }, { front: 'pushRod', frontMass: 'laser' }), // 前大后小 65/90 · 前进
];

/* 6｜混合型：远程 + 近战 + Gadget（4 套）— 默认前进 */
const HYBRID = [
  opp('watermelonBody', { rear: 20, front: 20 }, { front: 'machineGun', frontMass: 'saw', rear: 'thruster' }), // 双标准 75/110
  opp('bananaBody', { rear: 26, front: 12 }, { front: 'cannon', top: 'hammer', rear: 'thruster' }), // 前小后大 75/90
  opp('watermelonBody', { rear: 12, front: 12 }, { front: 'shotgun', frontMass: 'hammer', rear: 'pushRod' }), // 双小 75/110
  opp('bananaBody', { rear: 26, front: 26 }, { front: 'flamethrower', frontMass: 'hammer', rear: 'thruster' }), // 双大 75/90
];

/**
 * Q19：新增 12 套（主要使用新 Body；6 类各 2 套 = 菠萝 6 + 椰子 6；3 套停驻）。
 * 能量（≤ 新 Body 容量 100）：炮30 机枪30 镭射45 霰弹30 圆锯25 刺25 锤25 喷火30 / 推杆20 推进器20。
 * 停驻：菠萝远程 / 椰子远程 / 菠萝控距 = 3 套（旧 6 + 新 3 = 9/36 ≈ 25%）。
 */
const Q19_NEW: BuildDraft[] = [
  // 远程压制 ×2（菠萝 / 椰子，各 1 停驻）
  opp('pineappleBody', { rear: 26, front: 12 }, { front: 'machineGun', frontMass: 'cannon' }, 'stationary'), // 前小后大 60/100 · 停驻
  opp('coconutBody', { rear: 26, front: 12 }, { front: 'laser', frontMass: 'cannon' }, 'stationary'), // 前小后大 75/100 · 停驻
  // 近距爆发 ×2（前进）
  opp('pineappleBody', { rear: 12, front: 12 }, { front: 'shotgun', top: 'saw' }), // 双小 55/100
  opp('coconutBody', { rear: 12, front: 12 }, { front: 'shotgun', frontMass: 'spear' }), // 双小 55/100
  // 持续贴身 ×2（前进）
  opp('pineappleBody', { rear: 20, front: 20 }, { front: 'flamethrower', top: 'hammer' }), // 双标准 55/100
  opp('coconutBody', { rear: 20, front: 20 }, { front: 'flamethrower', frontMass: 'saw' }), // 双标准 55/100
  // 冲锋接敌 ×2（前进）
  opp('pineappleBody', { rear: 12, front: 26 }, { front: 'saw', rear: 'thruster' }), // 前大后小 45/100
  opp('coconutBody', { rear: 12, front: 26 }, { front: 'hammer', rear: 'thruster' }), // 前大后小 45/100
  // 控距干扰 ×2（菠萝 1 停驻 / 椰子 前进）
  opp('pineappleBody', { rear: 26, front: 26 }, { front: 'pushRod', frontMass: 'shotgun' }, 'stationary'), // 双大 50/100 · 停驻
  opp('coconutBody', { rear: 26, front: 12 }, { front: 'pushRod', frontMass: 'machineGun' }), // 前小后大 50/100 · 前进
  // 混合型 ×2（前进）
  opp('pineappleBody', { rear: 20, front: 20 }, { front: 'machineGun', frontMass: 'saw', rear: 'thruster' }), // 双标准 75/100
  opp('coconutBody', { rear: 26, front: 26 }, { front: 'cannon', top: 'hammer', rear: 'thruster' }), // 双大 75/100
];

/** 正式对手池：36 套（6 类 × 6 套；12 西瓜 / 12 香蕉 / 6 菠萝 / 6 椰子） */
const LEGACY_POOL: BuildDraft[] = [
  ...RANGED_SUPPRESSION,
  ...CLOSE_BURST,
  ...CONTINUOUS_CONTACT,
  ...CHARGE,
  ...RANGE_CONTROL,
  ...HYBRID,
  ...Q19_NEW,
];

/* =====================================================================
 * F-CONTENT-OPPONENT-BUILD-POOL-R1｜新增 13 套模板
 * - heavyBox（baseMass 150）与 tallBody（高重心 110×80）首次进对手池；
 * - 全部使用 PART_OPTIONS 正式部件 + 现有轮径（12/20/26）+ drive（forward/stationary）；
 * - 能量全部 ≤ Body 容量（heavyBox 100 / tallBody 100 / pineapple 100）；
 * - 每套 ≥1 Weapon（validateSnapshot 正式校验）。
 * 定位五类：rush 近战突进 / ranged 远程压制 / heavy 重型高惯 / control 控距姿态 / hybrid 混合。
 * ===================================================================== */
export type OpponentRole = 'rush' | 'ranged' | 'heavy' | 'control' | 'hybrid';

/** 对手模板：唯一内部 ID + 五类战斗定位 + 可序列化 Draft */
export interface OpponentTemplate {
  id: string;
  role: OpponentRole;
  draft: BuildDraft;
}

function tmpl(id: string, role: OpponentRole, draft: BuildDraft): OpponentTemplate {
  return { id, role, draft };
}

const R1_NEW_TEMPLATES: OpponentTemplate[] = [
  /* ---- 重型/高惯性（heavyBox baseMass 150：推不动、压着打；≥2 目标达成 3 套）---- */
  tmpl('R1-HVY-01', 'heavy', opp('heavyBox', { rear: 26, front: 26 }, { front: 'cannon', frontMass: 'laser' }, 'stationary')), // 重炮要塞 75/100 · 停驻
  tmpl('R1-HVY-02', 'heavy', opp('heavyBox', { rear: 26, front: 26 }, { front: 'shotgun', top: 'hammer' })), // 重装近战 55/100 · 前进
  tmpl('R1-HVY-03', 'heavy', opp('heavyBox', { rear: 26, front: 12 }, { front: 'machineGun', rear: 'thruster' })), // 重装压制推进 50/100 · 前进
  /* ---- 近战突进（重型/高重心冲撞；≥3 达成 3 套）---- */
  tmpl('R1-RUSH-01', 'rush', opp('heavyBox', { rear: 12, front: 12 }, { front: 'rammer', rear: 'thruster' })), // 重装冲锤 45/100 · 前进
  tmpl('R1-RUSH-02', 'rush', opp('pineappleBody', { rear: 26, front: 12 }, { front: 'saw', frontMass: 'spear', rear: 'thruster' })), // 菠萝高重心冲刺 70/100 · 前进
  tmpl('R1-RUSH-03', 'rush', opp('tallBody', { rear: 12, front: 26 }, { front: 'saw', rear: 'thruster' })), // 高身冲刺锯 45/100 · 前进
  /* ---- 远程压制（重型/高身远程；≥3 达成 3 套）---- */
  tmpl('R1-GUN-01', 'ranged', opp('heavyBox', { rear: 26, front: 26 }, { front: 'laser', frontMass: 'shotgun' }, 'stationary')), // 重炮压制 75/100 · 停驻
  tmpl('R1-GUN-02', 'ranged', opp('tallBody', { rear: 20, front: 20 }, { front: 'machineGun', top: 'laser' }, 'stationary')), // 高架机枪+镭射 75/100 · 停驻
  tmpl('R1-GUN-03', 'ranged', opp('heavyBox', { rear: 26, front: 12 }, { front: 'cannon', frontMass: 'machineGun' })), // 重炮压制前进 60/100 · 前进
  /* ---- 控距/姿态干扰（推杆 + 高重心；≥2 达成 2 套）---- */
  tmpl('R1-CTRL-01', 'control', opp('tallBody', { rear: 12, front: 26 }, { front: 'pushRod', top: 'shotgun' }, 'stationary')), // 高重心推杆炮台 50/100 · 停驻
  tmpl('R1-CTRL-02', 'control', opp('heavyBox', { rear: 26, front: 12 }, { front: 'pushRod', frontMass: 'machineGun' })), // 重推杆压制 50/100 · 前进
  /* ---- 混合型（≥2 达成 2 套）---- */
  tmpl('R1-MIX-01', 'hybrid', opp('heavyBox', { rear: 20, front: 20 }, { front: 'cannon', top: 'saw', rear: 'thruster' })), // 重装混合 75/100 · 前进
  tmpl('R1-MIX-02', 'hybrid', opp('tallBody', { rear: 20, front: 20 }, { front: 'flamethrower', top: 'saw' })), // 高身喷火锯 55/100 · 前进
];

/**
 * 全部对手模板（49 套：36 旧 + 13 新）。id 全局唯一；role 为五类战斗定位。
 * 旧 36 套按原设计分类映射：远程压制/近距离爆发/持续贴身/冲锋接敌→rush 或 ranged、
 * 控距干扰→control、混合型→hybrid（持续贴身归 rush：同为近战接敌压进）。
 */
export const OPPONENT_TEMPLATES: OpponentTemplate[] = [
  ...LEGACY_POOL.map((draft, i) =>
    tmpl(`OPP-${String(i + 1).padStart(2, '0')}`, legacyRole(i), draft),
  ),
  ...R1_NEW_TEMPLATES,
];

/** 旧 36 套的定位映射（按 LEGACY_POOL 索引，与设计分类一一对应） */
function legacyRole(i: number): OpponentRole {
  if (i < 4 || (i >= 24 && i < 26)) return 'ranged'; // RANGED_SUPPRESSION 0-3 + Q19 远程 24-25
  if (i >= 16 && i < 20) return 'control'; // RANGE_CONTROL 16-19
  if (i >= 32 && i < 34) return 'control'; // Q19 控距 32-33
  if (i >= 20 && i < 24) return 'hybrid'; // HYBRID 20-23
  if (i >= 34 && i < 36) return 'hybrid'; // Q19 混合 34-35
  return 'rush'; // 近爆 4-7 / 贴身 8-11 / 冲锋 12-15 / Q19 近爆 26-27 / 贴身 28-29 / 冲锋 30-31
}

/** 每套模板的定位（与 OPPONENT_TEMPLATES 索引对齐） */
export const OPPONENT_ROLES: OpponentRole[] = OPPONENT_TEMPLATES.map((t) => t.role);

/** 各定位包含的模板索引集合 */
export const ROLE_INDICES: Record<OpponentRole, number[]> = {
  rush: [],
  ranged: [],
  heavy: [],
  control: [],
  hybrid: [],
};
OPPONENT_ROLES.forEach((r, i) => ROLE_INDICES[r].push(i));

/** 正式对手池：49 套（模板 draft 的深拷贝，供匹配链路消费；保持 BuildDraft[] 兼容） */
export const OPPONENT_POOL: BuildDraft[] = OPPONENT_TEMPLATES.map((t) => cloneBuildDraft(t.draft));

/** 深拷贝一份 Build Draft（避免直接改写池内常量） */
export function cloneBuildDraft(d: BuildDraft): BuildDraft {
  return {
    bodyDefId: d.bodyDefId,
    rearRadius: d.rearRadius,
    frontRadius: d.frontRadius,
    functionalSelections: { ...d.functionalSelections },
    drive: d.drive,
  };
}

/**
 * 下一场对手索引：固定顺序循环（保护 pool 长度，避免越界 / 负数）。
 * 每调用一次推进到「下一名」对手，确保与上一场不同（pool 长度 ≥ 2）。
 * 保留为纯函数（测试 / 旧逻辑可复用）；Q15-UX-R1 起正式玩家流程改用 pickRandomOpponent（真随机）。
 */
export function nextOpponentIndex(current: number, poolSize: number): number {
  if (poolSize <= 0) return 0;
  return (current + 1) % poolSize;
}

/**
 * Q15-UX-R1｜真随机选对手（正式玩家匹配调用）。
 * - pool > 1 时禁止连续两场选到同一个 index（避免出现与上场完全相同的对手）；
 * - 第一次匹配 lastIndex = -1 → 不限制（首场「无预设当前对手」，纯随机抽取）；
 * - rng 可注入（测试确定性）；正式调用用 Math.random。
 */
export function pickRandomOpponent(
  lastIndex: number,
  poolSize: number,
  rng: () => number = Math.random,
): number {
  if (poolSize <= 0) return 0;
  if (poolSize === 1) return 0;
  let idx = Math.floor(rng() * poolSize) % poolSize;
  let guard = 0;
  while (idx === lastIndex && guard < 64) {
    idx = Math.floor(rng() * poolSize) % poolSize;
    guard++;
  }
  return idx;
}

/**
 * Q15-UX-R1｜Matching 阶段候选车展示序列（纯函数，可测试）。
 * - 前 3 个为互不相同且 ≠ finalIdx 的随机候选 → 保证「约 1 秒内至少明显变化 3 次」；
 * - 末位固定为最终锁定对手 finalIdx（最后一个显示的车 = 实际进入 MatchPreview 的对手）；
 * - 返回长度 4（4 次显示 = 3 次切换），节奏由调用方 timing 控制（快→稍慢→定格）；
 * - pool 过小（≤3）退化：用确定性补位保证每个候选 ≠ finalIdx，避免定格前无可见变化。
 */
export function buildMatchingSequence(
  finalIdx: number,
  poolSize: number,
  rng: () => number = Math.random,
): number[] {
  if (poolSize <= 1) return [finalIdx];
  const intermediates: number[] = [];
  const used = new Set<number>([finalIdx]);
  let attempts = 0;
  while (intermediates.length < 3 && attempts < 200) {
    attempts++;
    const r = Math.floor(rng() * poolSize) % poolSize;
    if (!used.has(r)) {
      used.add(r);
      intermediates.push(r);
    }
  }
  // 退化补位（池子太小取不到 3 个互异）：用确定性与 finalIdx 不同的索引填满
  while (intermediates.length < 3) {
    let r = (finalIdx + 1 + intermediates.length) % poolSize;
    if (r === finalIdx) r = (r + 1) % poolSize;
    intermediates.push(r);
  }
  return [...intermediates, finalIdx];
}

/**
 * Q25｜V0.6 对手难度梯度（不新增 Content，按真实 Build 组合分层）。
 *
 * 难度来自真实 Build 变量（可解释数据代理，不按武器名拍脑袋）：
 *   - 功能件数（越多越具威胁）
 *   - 能量使用率（energy / capacity，越高越强）
 *   - Drive（前进更主动 > 停驻）
 *   - Body 质量（越重越难推动 / 位移）
 *   - 轮径（越大越具压迫）
 * 2★ 数量不纳入：对手池均为 1★（Q22 未进入对手侧）。
 * 严禁：修改 Weapon 参数 / 额外加 HP / 隐藏伤害倍率 / 作弊属性——难度只来自 Build 组合本身。
 */
export type OpponentTier = 'easy' | 'normal' | 'hard';

/** 基于真实 Build 变量的难度评分（越高越难）；权重均可解释。 */
function opponentScore(d: BuildDraft): number {
  const sels = Object.values(d.functionalSelections);
  const fnCount = sels.filter((v) => v && v !== EMPTY_SLOT).length; // 功能件数
  let energy = 0;
  for (const v of sels) {
    if (v && v !== EMPTY_SLOT) {
      const def = registry.functionals.get(v);
      if (def) energy += def.energy; // 对手均 1★，直接用基础能量
    }
  }
  const cap = registry.bodies.get(d.bodyDefId)?.energyCapacity ?? 100;
  const energyRate = energy / cap; // 能量使用率
  const driveTerm = d.drive === 'stationary' ? 0 : 1.2; // 前进更主动
  const mass = registry.bodies.get(d.bodyDefId)?.baseMass ?? 100;
  const massTerm = mass / 100; // 越重越难位移
  const wheelTerm = (d.frontRadius + d.rearRadius) / 12; // 轮径越大越具压迫
  return fnCount * 3 + energyRate * 4 + driveTerm + massTerm * 1.5 + wheelTerm * 0.5;
}

/** 36 套按难度评分升序排序后三等分：低 1/3=Easy、中 1/3=Normal、高 1/3=Hard（每层 12 套） */
function computeTiers(): OpponentTier[] {
  const n = OPPONENT_POOL.length;
  const order = OPPONENT_POOL.map((_, i) => i).sort(
    (a, b) => opponentScore(OPPONENT_POOL[a]) - opponentScore(OPPONENT_POOL[b]),
  );
  const third = Math.floor(n / 3);
  const tiers: OpponentTier[] = new Array(n).fill('normal');
  for (let k = 0; k < n; k++) {
    const idx = order[k];
    if (k < third) tiers[idx] = 'easy';
    else if (k < third * 2) tiers[idx] = 'normal';
    else tiers[idx] = 'hard';
  }
  return tiers;
}

/** 每套对手的固定难度层（与 OPPONENT_POOL 索引对齐；每套唯一、不重叠） */
export const OPPONENT_TIERS: OpponentTier[] = computeTiers();

/** 各难度层包含的对手索引集合 */
export const TIER_INDICES: Record<OpponentTier, number[]> = { easy: [], normal: [], hard: [] };
OPPONENT_TIERS.forEach((t, i) => TIER_INDICES[t].push(i));

/** 玩家段位 → 抽取难度层权重（与 Queue 配置一致） */
export const PLAYER_TIER_WEIGHTS: Record<Tier, { easy: number; normal: number; hard: number }> = {
  bronze: { easy: 0.7, normal: 0.3, hard: 0 },
  silver: { easy: 0.3, normal: 0.6, hard: 0.1 },
  gold: { easy: 0, normal: 0.5, hard: 0.5 },
  diamond: { easy: 0, normal: 0.2, hard: 0.8 },
};

function pickTier(weights: { easy: number; normal: number; hard: number }, rng: () => number): OpponentTier {
  const r = rng();
  let acc = 0;
  for (const t of ['easy', 'normal', 'hard'] as OpponentTier[]) {
    acc += weights[t];
    if (r < acc) return t;
  }
  return 'hard';
}

/**
 * Q25｜按玩家段位抽取对手：先按权重选难度层，再在该层内随机选一套 Build。
 * - 保持「随机匹配」与「不连续重复同一 Build」（避开上一场 final index）；
 * - 难度只来自真实 Build 组合，不修改任何 Build / Weapon / Physics；
 * - 若该层无 Build（理论不会发生），回退到全体随机。
 */
export function pickOpponentForTier(
  playerTier: Tier,
  lastIndex: number,
  rng: () => number = Math.random,
): number {
  const weights = PLAYER_TIER_WEIGHTS[playerTier];
  const tier = pickTier(weights, rng);
  const pool = TIER_INDICES[tier];
  if (pool.length === 0) return pickRandomOpponent(lastIndex, OPPONENT_POOL.length, rng);
  let idx = pool[Math.floor(rng() * pool.length) % pool.length];
  let guard = 0;
  while (idx === lastIndex && pool.length > 1 && guard < 64) {
    idx = pool[Math.floor(rng() * pool.length) % pool.length];
    guard++;
  }
  return idx;
}
