/**
 * Q15 / Q16｜正常玩家对手池（纯数据 + 纯函数，可测试）。
 *
 * Q16：第一轮对手铺量——由 6 套扩到 24 套明显不同、全部合法的正常 Build。
 * - 只使用 watermelon / banana 两种 Body（容量 110 / 90）；
 * - 只使用当前正式 PART_OPTIONS 部件（不含 wedge / ramHead / lifter / 旋锤 等 HOLD / prototype 内容）；
 * - 轮径显式指定（12 / 20 / 26），覆盖 前小后大 / 前大后小 / 双小 / 双标准 / 双大 五类组合，
 *   走真实 Physics，无姿态补偿；
 * - 6 类战斗身份各 ≥4 套：远程压制 / 近距离爆发 / 持续贴身 / 冲锋接敌 / 控距干扰 / 混合型
 *   （分类仅用于设计与测试覆盖，不建立正式「职业/标签系统」）；
 * - 每套都是合法 Build（≥1 Weapon、Energy 不超载、槽位合法、无 HOLD）。
 *
 * 不做匹配算法 / 段位 / Elo —— 玩家「寻找对手」随机抽取（不连续重复同一 index）。
 */
import type { BuildDraft } from '../lab/buildEditorModel';
import { EMPTY_SLOT } from '../lab/buildEditorModel';

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
  };
}

/**
 * 24 套人工对手配置（车队风格明显不同；每类 4 套）。
 * 槽位：front / frontMass / top / rear（两 Body 均有这 4 个 functional 挂点）。
 * 能量（≤ 容量，西瓜 110 / 香蕉 90）：炮30 机枪30 镭射45 霰弹30 冲锤25 圆锯25 刺25
 *       锤25 喷火30 / 推杆20 推进器20。
 */

/* 1｜远程压制：炮 / 机枪 / 镭射 组合（4 套） */
const RANGED_SUPPRESSION = [
  opp('watermelonBody', { rear: 26, front: 12 }, { front: 'machineGun', frontMass: 'cannon' }), // 前小后大 60/110
  opp('bananaBody', { rear: 20, front: 20 }, { front: 'laser', frontMass: 'cannon' }), // 双标准 75/90
  opp('watermelonBody', { rear: 26, front: 26 }, { front: 'cannon', frontMass: 'machineGun' }), // 双大 60/110
  opp('bananaBody', { rear: 12, front: 26 }, { front: 'machineGun', frontMass: 'laser' }), // 前大后小 75/90
];

/* 2｜近距离爆发：霰弹 / 圆锯 / 刺 组合（4 套） */
const CLOSE_BURST = [
  opp('watermelonBody', { rear: 12, front: 12 }, { front: 'shotgun', top: 'saw' }), // 双小 55/110
  opp('bananaBody', { rear: 20, front: 20 }, { front: 'shotgun', frontMass: 'spear' }), // 双标准 55/90
  opp('watermelonBody', { rear: 26, front: 12 }, { front: 'saw', frontMass: 'shotgun' }), // 前小后大 55/110
  opp('bananaBody', { rear: 12, front: 26 }, { front: 'spear', frontMass: 'shotgun' }), // 前大后小 55/90
];

/* 3｜持续贴身：喷火 / 圆锯 / 锤 组合（4 套） */
const CONTINUOUS_CONTACT = [
  opp('watermelonBody', { rear: 12, front: 12 }, { front: 'flamethrower', top: 'hammer' }), // 双小 55/110
  opp('bananaBody', { rear: 20, front: 20 }, { front: 'flamethrower', frontMass: 'saw' }), // 双标准 55/90
  opp('watermelonBody', { rear: 26, front: 26 }, { front: 'saw', frontMass: 'hammer' }), // 双大 50/110
  opp('bananaBody', { rear: 26, front: 12 }, { front: 'hammer', frontMass: 'flamethrower' }), // 前小后大 55/90
];

/* 4｜冲锋接敌：推进器 + 近战武器（4 套） */
const CHARGE = [
  opp('watermelonBody', { rear: 12, front: 12 }, { front: 'rammer', rear: 'thruster' }), // 双小 45/110
  opp('bananaBody', { rear: 12, front: 26 }, { front: 'saw', rear: 'thruster' }), // 前大后小 45/90
  opp('watermelonBody', { rear: 20, front: 20 }, { front: 'spear', top: 'hammer', rear: 'thruster' }), // 双标准 70/110
  opp('bananaBody', { rear: 26, front: 26 }, { front: 'hammer', rear: 'thruster' }), // 双大 45/90
];

/* 5｜控距干扰：推杆 + 远程（4 套） */
const RANGE_CONTROL = [
  opp('watermelonBody', { rear: 26, front: 12 }, { front: 'pushRod', frontMass: 'cannon' }), // 前小后大 50/110
  opp('bananaBody', { rear: 20, front: 20 }, { front: 'pushRod', frontMass: 'machineGun' }), // 双标准 50/90
  opp('watermelonBody', { rear: 26, front: 26 }, { front: 'pushRod', frontMass: 'shotgun' }), // 双大 50/110
  opp('bananaBody', { rear: 12, front: 26 }, { front: 'pushRod', frontMass: 'laser' }), // 前大后小 65/90
];

/* 6｜混合型：远程 + 近战 + Gadget（4 套） */
const HYBRID = [
  opp('watermelonBody', { rear: 20, front: 20 }, { front: 'machineGun', frontMass: 'saw', rear: 'thruster' }), // 双标准 75/110
  opp('bananaBody', { rear: 26, front: 12 }, { front: 'cannon', top: 'hammer', rear: 'thruster' }), // 前小后大 75/90
  opp('watermelonBody', { rear: 12, front: 12 }, { front: 'shotgun', frontMass: 'hammer', rear: 'pushRod' }), // 双小 75/110
  opp('bananaBody', { rear: 26, front: 26 }, { front: 'flamethrower', frontMass: 'hammer', rear: 'thruster' }), // 双大 75/90
];

/** 正式对手池：24 套（6 类 × 4 套，12 西瓜 / 12 香蕉） */
export const OPPONENT_POOL: BuildDraft[] = [
  ...RANGED_SUPPRESSION,
  ...CLOSE_BURST,
  ...CONTINUOUS_CONTACT,
  ...CHARGE,
  ...RANGE_CONTROL,
  ...HYBRID,
];

/** 深拷贝一份 Build Draft（避免直接改写池内常量） */
export function cloneBuildDraft(d: BuildDraft): BuildDraft {
  return {
    bodyDefId: d.bodyDefId,
    rearRadius: d.rearRadius,
    frontRadius: d.frontRadius,
    functionalSelections: { ...d.functionalSelections },
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
