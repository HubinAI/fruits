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
import type { BattlePhase, TeamId, BuildSnapshot } from '../core/types';
import type { CombatEvent } from './combatEvents';

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
  /**
   * 物理引擎选择（仅声明，本队列不主动改写 config）。
   * 缺省未设置时，后续正式入口 / Runtime selector 一律走 Matter（与现状一致）。
   * 'planck' 为正在接入的引擎中立 Runtime。
   */
  engine?: 'matter' | 'planck';
}

/** Battle 结果（字段与 battleOrchestrator.BattleResult 完全一致） */
export interface BattleResult {
  winner: TeamId | 'draw' | null;
  hpA: number;
  hpB: number;
  phase: string;
  /**
   * W1-ASYNC-1：异步战斗基础 metadata（可选；旧路径 / resolveBattleResult 不产生）。
   * 本队列只允许「携带」，不改正式胜负规则。
   */
  battleId?: string;
  rulesVersion?: string;
  contentVersion?: string;
  durationMs?: number;
}

/**
 * 异步战斗请求合同（W1-ASYNC-1）：稳定、可版本化、可复现的正式开战输入。
 * - randomSeed：确定性随机种子（uint32）；Runtime 一律使用确定性 PRNG，
 *   禁止 Math.random / crypto 随机源；
 * - rulesVersion / contentVersion：胜负规则与内容版本的稳定标识（重放/对账用）。
 */
export interface BattleRequest {
  battleId: string;
  buildA: BuildSnapshot;
  buildB: BuildSnapshot;
  config: BattleConfig;
  /** 确定性随机种子（uint32 number） */
  randomSeed: number;
  rulesVersion: string;
  contentVersion: string;
}

/**
 * 确定性 32-bit PRNG（mulberry32，W1-ASYNC-1）。
 * 禁止 Math.random / crypto.random：同 seed 永远产生同一序列。
 * seed 按 uint32 归一（>>> 0）。
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 确定性 tie-break（W1-ASYNC-1）：输入 randomSeed，稳定返回 'A' 或 'B'。
 * 同 seed 永远同结果；不同 seed 可产生 A/B 两种结果。未来「正式战斗无平局」
 * 的兜底判定使用本 helper，不使用运行时随机。
 */
export function deterministicTieBreak(seed: number): 'A' | 'B' {
  return mulberry32(seed)() < 0.5 ? 'A' : 'B';
}

/**
 * 单侧实时战斗状态（Q06-HUD-F1）：HUD 持续显示的引擎中立最小合同。
 * hp / maxHp 必须直接读取当前真实 Runtime vehicle（禁止在 UI 重算一套公式）；
 * maxHp = Build/Resolved 初始 HP（body.hp），不随战斗变化。
 */
export interface BattleSideStatus {
  team: TeamId;
  /** 当前真实 HP（随 weapon/impact damage 实时下降） */
  hp: number;
  /** 初始最大 HP（当前真实 Build/Resolved 初始值） */
  maxHp: number;
}

/** 双方实时战斗状态快照（引擎中立，Matter/Planck 同一合同） */
export interface BattleStatusSnapshot {
  sideA: BattleSideStatus;
  sideB: BattleSideStatus;
  /** 当前正式 Battle phase（Active/Warning/Closing/End；复用现有 phase，非 Debug 数据） */
  phase: string;
}

/**
 * 引擎中立渲染数据合同（Queue F-02M-B17B-A1）。
 *
 * 硬约束：本组类型禁止出现 Matter.Body / Vehicle / Planck BodyHandle / adapter
 * 或任何具体引擎类型；只描述「世界坐标几何 + 配色需要的 category」。
 * 几何必须来自 Runtime 的真实世界多边形 / 圆，不得用 AABB 近似替代。
 */

/** 世界坐标二维点 */
export interface RenderVec2 {
  x: number;
  y: number;
}

/** 世界坐标多边形：顶点为世界坐标序列（闭合，Renderer 原样描边） */
export interface RenderPolygon {
  points: RenderVec2[];
}

/** 世界坐标圆（轮子）：圆心 / 半径 / 当前旋转角 */
export interface RenderCircle {
  center: RenderVec2;
  radius: number;
  angle: number;
}

/** 引擎中立可绘制形状（discriminated union，无 any / cast） */
export type RenderShape =
  | { kind: 'polygons'; polygons: RenderPolygon[] }
  | { kind: 'circle'; circle: RenderCircle };

/** 功能部件：仅保留 Renderer 配色需要的 category */
export interface RenderFunctionalPart {
  shape: RenderShape;
  category: string;
  /**
   * 真实 Joint 连接几何（Q04-R1B）：世界坐标锚点对 + 轴宽，用于把
   * 「车身 ↔ 移动部件」之间的伸缩轴/套杆画出来（如 Push Rod 的 Prismatic
   * 连接）。optional：无独立移动 Joint 的部件（Cannon / Hammer / Roller /
   * Ram 等 Weld/Revolute 件）不提供，Renderer 绘制不变。
   * from = 车身侧锚点（chassis hardpoint 当前世界位置）；
   * to = 移动部件侧锚点（part 原点当前世界位置）；完全来自真实世界坐标，
   * 禁止假动画 / 补间。
   */
  connector?: RenderConnector;
}

/** 真实 Joint 连接件（引擎中立）：from→to 的窄轴，width 为垂直宽度（px） */
export interface RenderConnector {
  from: RenderVec2;
  to: RenderVec2;
  width: number;
}

/** 车辆渲染数据 */
export interface RenderVehicle {
  team: string;
  /** 车身主体（chassis） */
  body: RenderShape;
  wheels: RenderCircle[];
  parts: RenderFunctionalPart[];
}

/** 竞技场墙体渲染数据 */
export interface RenderArena {
  width: number;
  groundY: number;
  normalWalls: RenderShape[];
  closingWalls: RenderShape[];
}

/** 引擎中立 Render Snapshot：正式 Renderer 只消费此结构 */
export interface BattleRenderSnapshot {
  arena: RenderArena;
  vehicleA: RenderVehicle;
  vehicleB: RenderVehicle;
  /**
   * 存活 projectile（Q02-C3A）：仅世界坐标 circle + team，引擎中立；
   * optional——Matter Snapshot 不提供，Planck Runtime 提供。
   */
  projectiles?: RenderProjectile[];
}

/** 存活 projectile 渲染数据（Q02-C3A）：不出现 BodyHandle / Planck / Matter 类型 */
export interface RenderProjectile {
  center: RenderVec2;
  radius: number;
  team: TeamId;
}

/**
 * 引擎中立 Battle Orchestrator 公共面（Queue F-02M-B17B-A1）。
 * 后续正式入口与 Renderer 只依赖此接口，不依赖具体引擎 Orchestrator 类。
 * 渲染所需的世界几何统一经 getRenderSnapshot() 取得，不再直接读 arena/vehicleA/vehicleB。
 */
export interface BattleOrchestratorApi {
  config: BattleConfig;
  result: BattleResult | null;
  phase: string;
  timeMs: number;
  step(realDtMs: number, timeScale?: number): void;
  onCombatEvent(cb: (ev: CombatEvent) => void): void;
  dispose(): void;
  getRenderSnapshot(): BattleRenderSnapshot;
  /**
   * 双方实时战斗状态快照（Q06-HUD-F1）：hp/maxHp 直读真实 vehicle，
   * phase 复用正式 Battle phase；纯读取，无物理/Gameplay 副作用。
   */
  getBattleStatusSnapshot(): BattleStatusSnapshot;
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
