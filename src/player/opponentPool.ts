/**
 * Q15｜正常玩家游戏主循环 V1 —— 最小对手池（纯数据 + 纯函数，可测试）。
 *
 * 要求：
 * - 只使用 watermelon / banana 两种 Body；
 * - 只使用当前正式 PART_OPTIONS 部件（不含 wedge / ramHead / lifter / 旋锤 等 HOLD 内容）；
 * - 6 套配置彼此明显不同（不同 Body / 部件组合 / 远近战定位）；
 * - 每套都是合法 Build（≥1 Weapon、Energy 不超载）。
 *
 * 不做匹配算法 / 段位 / Elo —— 玩家「寻找对手」按固定顺序循环取用本池。
 */
import type { BuildDraft } from '../lab/buildEditorModel';
import { EMPTY_SLOT } from '../lab/buildEditorModel';

/** 生成一份完整 4 挂点（其余默认空槽）的对手 Draft */
function opp(
  bodyDefId: string,
  selections: Partial<Record<string, string>>,
): BuildDraft {
  return {
    bodyDefId,
    rearRadius: 20,
    frontRadius: 20,
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
 * 6 套人工对手配置（车队风格明显不同）：
 * 1. 西瓜重甲炮车：炮 + 推杆 + 锤（均衡近中距离）
 * 2. 香蕉机枪机动：机枪 + 锤 + 推杆（高速持续压制）
 * 3. 西瓜霰弹近战：霰弹炮 + 圆锯 + 推杆（近距离爆发 + 切割）
 * 4. 香蕉冲撞手：冲锤 + 锤 + 推进器（前压突进）
 * 5. 西瓜锯炮：圆锯 + 炮 + 推进器（旋转 + 远程 + 机动）
 * 6. 香蕉双枪：机枪 + 霰弹炮 + 锤（双远程武器压制）
 */
export const OPPONENT_POOL: BuildDraft[] = [
  opp('watermelonBody', { front: 'cannon', frontMass: 'pushRod', top: 'hammer' }),
  opp('bananaBody', { front: 'machineGun', top: 'hammer', frontMass: 'pushRod' }),
  opp('watermelonBody', { front: 'shotgun', top: 'saw', frontMass: 'pushRod' }),
  opp('bananaBody', { front: 'rammer', top: 'hammer', rear: 'thruster' }),
  opp('watermelonBody', { front: 'saw', frontMass: 'cannon', rear: 'thruster' }),
  opp('bananaBody', { front: 'machineGun', frontMass: 'shotgun', top: 'hammer' }),
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
 */
export function nextOpponentIndex(current: number, poolSize: number): number {
  if (poolSize <= 0) return 0;
  return (current + 1) % poolSize;
}
