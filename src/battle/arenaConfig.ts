/**
 * Arena 配置契约（Queue F-02M-B12B）—— 引擎中立，零物理引擎依赖。
 *
 * 机械搬迁自 Matter 的 arenaRuntime.ts：ArenaConfig + 默认配置
 * （原 DEFAULT_ARENA，改名 DEFAULT_ARENA_CONFIG）。
 * 仅修正 closingSpeed 的文档契约（px/step），字段名与数值一律不变。
 */
export interface ArenaConfig {
  /** 墙内宽度 */
  width: number;
  /** 墙内高度 */
  height: number;
  /** 地面顶部 y（车辆落点参考） */
  groundY: number;
  wallThickness: number;
  /** 阶段时长（ms） */
  phases: {
    activeMs: number;
    warningMs: number;
    closingMs: number;
  };
  /** Closing 刺墙推进速度，当前游戏层实际单位 px/step（每物理步像素数）。骨架阶段默认较慢，不精调节奏。 */
  closingSpeed: number;
  /**
   * Closing 刺墙 hazard 伤害（W1-END-2）：车辆与 hazard 持续接触时按固定物理时间
   * tick 结算 Hazard Damage（damageSource:'hazard'，走 DamageResolver / contact tick
   * Foundation）。Active/Warning 刺墙不参与战斗（0 伤害）。本队列冻结规则，不冻结
   * 最终平衡数值（默认值为骨架占位）。
   */
  hazardTickMs: number;
  /** 每次 hazard tick 结算的伤害 */
  hazardDamagePerTick: number;
  /** Projectile Bounds（顶部越界销毁） */
  projectileTopY: number;
}

export const DEFAULT_ARENA_CONFIG: ArenaConfig = {
  width: 1600,
  height: 900,
  groundY: 700,
  wallThickness: 60,
  phases: {
    activeMs: 10_000,
    warningMs: 3_000,
    closingMs: 5_000,
  },
  closingSpeed: 40,
  // W1-END-2：Closing 持续接触 tick 参数（骨架占位值，规则冻结、数值不冻结）
  hazardTickMs: 500,
  hazardDamagePerTick: 40,
  projectileTopY: -50,
};
