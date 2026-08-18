/**
 * 引擎中立战斗车辆契约（Queue F-02M-B9A）。
 *
 * 目的：Matter `Vehicle`（src/battle/vehicleAssembly.ts）与
 * `PlanckVehicle`（src/battle/planckVehicleAssembly.ts）结构兼容的统一战斗视图——
 * 战斗结算（HP / Grounded / Weapon 命中）只依赖本契约，不依赖任何物理引擎类型。
 *
 * 约束：
 * - 仅 type-import `TeamId`、`FunctionalPartDef`；
 * - 禁止依赖 Matter、Planck、adapter、Body、Joint。
 */
import type { FunctionalPartDef, TeamId } from '../core/types';

/** 轮子战斗状态（引擎中立）：战斗结算只读写 `grounded` */
export interface CombatWheelState {
  id: string;
  grounded: boolean;
}

/** 部件战斗状态（引擎中立）：Weapon 命中判定使用 `def`（含 collider/behavior） */
export interface CombatPartState {
  id: string;
  def: FunctionalPartDef;
}

/** 战斗车辆状态（引擎中立） */
export interface CombatVehicleState {
  id: string;
  team: TeamId;
  /** 可写：Damage Resolver 直接修改 */
  hp: number;
  maxHp: number;
  /** 只读数组视图（元素状态可写，数组本身不可替换） */
  readonly wheels: readonly CombatWheelState[];
  readonly parts: readonly CombatPartState[];
}
