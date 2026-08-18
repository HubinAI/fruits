/**
 * 引擎中立 Battle 合同与结果解析（Queue F-02M-B14A）。
 *
 * - BattleConfig / BattleResult：字段与 battleOrchestrator.ts 现有定义完全一致；
 * - resolveBattleResult：严格复现 Matter BattleOrchestrator.detectEnd() 的判定，
 *   供引擎中立层与未来 Planck Orchestrator 复用。
 *
 * 约束：只使用 type import；禁止 Matter、Planck、adapter 及任何物理对象。
 */
import type { ArenaConfig } from './arenaConfig';
import type { ImpactConfig } from './contactRouter';
import type { BattlePhase, TeamId } from '../core/types';

/** Battle 配置（字段与 battleOrchestrator.BattleConfig 完全一致） */
export interface BattleConfig {
  impact?: Partial<ImpactConfig>;
  arena?: Partial<ArenaConfig>;
  /** 双方是否自动朝对方驱动（正式战斗为 true，部分 Lab 场景为 false） */
  autoDrive?: boolean;
  /**
   * 出生后是否把整车下沉到「最低点接触地面」（无下落弹跳）。
   * 消除「从空中落下→弹跳→混沌分叉」的 Reset 非确定性。空中出生场景（D-air）设 false。
   */
  settleToGround?: boolean;
  /** 车辆初始位置与朝向（facing：1 朝右 / -1 朝左，镜像而非旋转） */
  spawnA?: { x: number; y: number; facing?: 1 | -1 };
  spawnB?: { x: number; y: number; facing?: 1 | -1 };
}

/** Battle 结果（字段与 battleOrchestrator.BattleResult 完全一致） */
export interface BattleResult {
  winner: TeamId | 'draw' | null;
  hpA: number;
  hpB: number;
  phase: string;
}

/**
 * 严格复现 Matter BattleOrchestrator.detectEnd() 的判定：
 * - 非 End 且双方 HP>0 → null（战斗继续）；
 * - phase=End → 按剩余 HP 比较 A/B/draw（原值，不归零）；
 * - 非 End 下双方同时死亡 → draw（HP 均 0）；
 * - 非 End 下 A 死亡 → B 胜（hpA=0，hpB 原值）；B 死亡 → A 胜（hpA 原值，hpB=0）；
 * - 结果 phase 固定为 'End'。
 * 不修改输入 HP、不新增 clamp、校验、超时或其他规则。
 */
export function resolveBattleResult(
  phase: BattlePhase,
  hpA: number,
  hpB: number,
): BattleResult | null {
  if (phase === 'End') {
    return {
      winner: hpA > hpB ? 'A' : hpB > hpA ? 'B' : 'draw',
      hpA,
      hpB,
      phase: 'End',
    };
  }
  const aDead = hpA <= 0;
  const bDead = hpB <= 0;
  if (aDead && bDead) {
    return { winner: 'draw', hpA: 0, hpB: 0, phase: 'End' };
  }
  if (aDead) {
    return { winner: 'B', hpA: 0, hpB, phase: 'End' };
  }
  if (bDead) {
    return { winner: 'A', hpA, hpB: 0, phase: 'End' };
  }
  return null;
}
