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
  /**
   * Closing 刺墙推进速度，当前游戏层实际单位 px/step（每物理步像素数）。
   * W1-P0-CLOSE-FIX：默认值 40 → 3（由场地几何 × Closing 时长推导，非临时调参）：
   * - Arena width=1600 / wallThickness=60；Closing wall 初始中心 left=-120 / right=1720；
   * - Closing 时长 5000ms ≈ 300 fixed steps（60Hz）；
   * - 若两墙在 Closing 尾声接近中央闭合，每侧约需移动 890~900px → ≈ 3 px/step。
   * 40 px/step（2400px/s）使 kinematic 墙每步穿透车辆（W1-P0-CLOSE-R1 实证：
   * Prismatic joint 约束崩溃、translation 1026、Push Rod part 真实分离）；3 为
   * 物理安全值（实测 firstAnomaly=null）。Scenario 可显式 override，不强制覆盖。
   */
  closingSpeed: number;
  /**
   * Closing 刺墙 hazard 伤害（W1-END-2）：车辆与 hazard 持续接触时按固定物理时间
   * tick 结算 Hazard Damage（damageSource:'hazard'，走 DamageResolver / contact tick
   * Foundation）。Active/Warning 刺墙不参与战斗（0 伤害）。本队列冻结规则，不冻结
   * 最终平衡数值（默认值为骨架占位）。
   * W1-P0-CLOSE-FIX：hazardTickMs 500 → 100（诊断依据）——kinematic 墙推车时车辆
   * 与墙是「短暂反复接触」（穿透→求解→分离，接触周期 ~百 ms 级），500ms 间隔下
   * tick 从未在接触窗口内结算（实测 0 伤害）；100ms 下真实战斗/对顶/站桩场景
   * hazard 全部正常扣血。damage 数值不变（非掩盖，机制真实工作）。
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
  // W1-P0-CLOSE-FIX：3 px/step（几何推导：Closing 5s≈300 步，每侧 890~900px 收束到中央）
  closingSpeed: 3,
  // W1-P0-CLOSE-FIX：hazardTickMs 500→100（诊断依据，见接口注释；damage 数值不变）
  hazardTickMs: 100,
  hazardDamagePerTick: 40,
  projectileTopY: -50,
};
