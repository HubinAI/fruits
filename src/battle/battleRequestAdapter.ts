/**
 * Battle Request Adapter（W1-ASYNC-1）：BattleRequest → Planck Runtime 的正式创建入口。
 *
 * - createPlanckBattle(request, registry)：按请求创建 PlanckBattleOrchestrator（确定性输入）；
 * - battleResultWithMeta(orch, request)：把 orchestrator.result 与请求元数据（battleId /
 *   rulesVersion / contentVersion / durationMs）包装成完整 BattleResult；
 *   不改正式胜负规则（winner/hp/phase 原样透传）。
 *
 * 兼容性：既有 constructor（PlanckBattleOrchestrator）与 PhysicsLab.loadCustom /
 * loadCustomPreview 入口全部保留不动；本模块只是新增的正式入口。
 */
import type {
  BattleRequest,
  BattleResult,
} from './battleContract';
import { PlanckBattleOrchestrator } from './planckBattleOrchestrator';
import type { ContentRegistry } from '../core/types';

/** BattleRequest → Planck Battle 实例（确定性：同 request 同初始状态） */
export function createPlanckBattle(
  request: BattleRequest,
  registry: ContentRegistry,
): PlanckBattleOrchestrator {
  return new PlanckBattleOrchestrator(
    request.buildA,
    request.buildB,
    registry,
    request.config,
  );
}

/**
 * 把 orchestrator 的实时 result 与请求 metadata 合并成完整 BattleResult。
 * - 战斗未结束（result null）→ 返回 null；
 * - winner / hpA / hpB / phase 完全来自 Runtime（不修改胜负规则）；
 * - durationMs = orchestrator.timeMs（正式战斗推进时间）。
 */
export function battleResultWithMeta(
  orch: PlanckBattleOrchestrator,
  request: BattleRequest,
): BattleResult | null {
  const r = orch.result;
  if (!r) return null;
  return {
    ...r,
    battleId: request.battleId,
    rulesVersion: request.rulesVersion,
    contentVersion: request.contentVersion,
    durationMs: orch.timeMs,
  };
}
