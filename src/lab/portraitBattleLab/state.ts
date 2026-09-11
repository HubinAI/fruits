/**
 * PBL-F0 / PBL-F1｜Portrait Battle Lab 纯状态机（无 DOM / 无 Canvas / 无副作用 / 无平台依赖）。
 *
 * 语义（PBL-F1 起包含「场上有哪些实体」）：
 * - 选择项（Arena / Loadout / Encounter）任何时刻都可切换；
 * - 任一选择项变更 → 中止当前运行并**彻底清空**实体与弹丸（配置已变，旧批次作废）；
 * - Start：idle → running；按当前配置生成一批实体（spawnSerial 递增）；running 中重复 Start 幂等；
 * - Reset：回 idle + 选择项恢复默认 + startCount 归零 + 实体/弹丸彻底清空（spawnSerial 保留便于排查）。
 *
 * 这里【不】包含战斗推进 / 伤害 / AI / 移动 —— 真实 Arena A/B Runtime 属 PBL-A1 / PBL-B1。
 */
import {
  LAB_ARENAS,
  LAB_DEFAULTS,
  type LabArenaId,
  type LabEncounterId,
  type LabLoadoutId,
} from './constants';
import { findEncounter, findLoadout, type LabLoadoutSlot } from './testData';
import { clearRun, createRunData, spawnRun, type LabRunData } from './entities';

export type LabPhase = 'idle' | 'running';

export interface PortraitLabState {
  readonly arena: LabArenaId;
  readonly loadout: LabLoadoutId;
  readonly encounter: LabEncounterId;
  readonly phase: LabPhase;
  /** Start 累计次数（Reset 归零）—— 验收「Start 生效 / Reset 清空」的直接证据。 */
  readonly startCount: number;
  /** 每次状态变更 +1（渲染与测试共用的稳定版本号；同值 set 为 no-op 不递增）。 */
  readonly revision: number;
  /** 运行期数据：实体 / 弹丸 / 批次号。Start 生成，Reset 彻底清空。 */
  readonly run: LabRunData;
}

/** 初始状态（fresh 状态，等价于 Reset 之后的状态）。 */
export function createPortraitLabState(): PortraitLabState {
  return {
    arena: LAB_DEFAULTS.arena,
    loadout: LAB_DEFAULTS.loadout,
    encounter: LAB_DEFAULTS.encounter,
    phase: 'idle',
    startCount: 0,
    revision: 0,
    run: createRunData(),
  };
}

function next(s: PortraitLabState, patch: Partial<PortraitLabState>): PortraitLabState {
  return { ...s, ...patch, revision: s.revision + 1 };
}

/** 配置变更 → 中止运行并清空场上一切旧实体 / 弹丸。 */
function reconfigure(s: PortraitLabState, patch: Partial<PortraitLabState>): PortraitLabState {
  return next(s, { ...patch, phase: 'idle', run: clearRun(s.run) });
}

/** 切换 Arena。同值 no-op；换 Arena 视为配置变更 → 中止并清空。 */
export function setArena(s: PortraitLabState, arena: LabArenaId): PortraitLabState {
  if (s.arena === arena) return s;
  if (!LAB_ARENAS.some((a) => a.id === arena)) return s; // 未知 id：忽略（不抛错）
  return reconfigure(s, { arena });
}

/** 切换 Loadout。同值 no-op；未知 id 忽略；变更 → 中止并清空。 */
export function setLoadout(s: PortraitLabState, loadout: string): PortraitLabState {
  if (s.loadout === loadout) return s;
  if (!findLoadout(loadout)) return s;
  return reconfigure(s, { loadout: loadout as LabLoadoutId });
}

/** 切换 Encounter。同值 no-op；未知 id 忽略；变更 → 中止并清空。 */
export function setEncounter(s: PortraitLabState, encounter: string): PortraitLabState {
  if (s.encounter === encounter) return s;
  if (!findEncounter(encounter)) return s;
  return reconfigure(s, { encounter: encounter as LabEncounterId });
}

/**
 * Start：idle → running，并按当前 Loadout / Encounter 生成一批实体
 * （数值全部来自正式 registry；本 Queue 不推进任何战斗规则）。
 * running 中重复 Start 幂等（不重复生成、不递增 spawnSerial）。
 */
export function start(s: PortraitLabState): PortraitLabState {
  if (s.phase === 'running') return s;
  const run = spawnRun(s.loadout, s.encounter, s.run.spawnSerial + 1);
  return next(s, { phase: 'running', startCount: s.startCount + 1, run });
}

/** Reset：回 idle + 选择项恢复默认 + startCount 归零 + 实体/弹丸彻底清空。 */
export function reset(s: PortraitLabState): PortraitLabState {
  return {
    ...createPortraitLabState(),
    revision: s.revision + 1,
    run: clearRun(s.run),
  };
}

/* ---------- 目录查询（纯函数；catalog id 之外的输入返回 undefined） ---------- */

export function findArena(id: LabArenaId): { id: LabArenaId; label: string; note: string } | undefined {
  return LAB_ARENAS.find((a) => a.id === id);
}

export { findEncounter, findLoadout };

/** 本 Loadout 在正式内容库中找不到对应件的槽位名（如「磁铁」「护盾」）。 */
export function unavailableSlots(loadoutId: string): string[] {
  const l = findLoadout(loadoutId);
  if (!l) return [];
  return l.slots.filter((s) => s.kind === 'unavailable').map((s) => s.requested);
}

/** 供 UI / 诊断使用的可序列化视图（标签解析失败时回退原始 id，UI 不因此崩溃）。 */
export interface LabSummary {
  readonly arena: string;
  readonly arenaLabel: string;
  readonly loadout: string;
  readonly loadoutLabel: string;
  readonly encounter: string;
  readonly encounterLabel: string;
  readonly phase: LabPhase;
  readonly startCount: number;
  readonly revision: number;
  readonly arenaNote: string;
  readonly loadoutNote: string;
  readonly encounterNote: string;
  /** 场上实体数（player + enemies；idle 时为 0）。 */
  readonly entityCount: number;
  readonly enemyCount: number;
  readonly playerBodyName: string;
  /** 共享基础数据指纹（idle 时为空串）。 */
  readonly baseKey: string;
  /** 正式内容库中不存在的槽位名（数据缺口，必须如实展示）。 */
  readonly unavailable: readonly string[];
  readonly slots: readonly LabLoadoutSlot[];
}

export function labSummary(s: PortraitLabState): LabSummary {
  const arena = findArena(s.arena);
  const loadout = findLoadout(s.loadout);
  const encounter = findEncounter(s.encounter);
  return {
    arena: s.arena,
    arenaLabel: arena ? arena.label : s.arena,
    loadout: s.loadout,
    loadoutLabel: loadout ? loadout.label : s.loadout,
    encounter: s.encounter,
    encounterLabel: encounter ? encounter.label : s.encounter,
    phase: s.phase,
    startCount: s.startCount,
    revision: s.revision,
    arenaNote: arena ? arena.note : '',
    loadoutNote: loadout ? loadout.note : '',
    encounterNote: encounter ? encounter.note : '',
    entityCount: s.run.entities.length,
    enemyCount: s.run.plan ? s.run.plan.enemies.length : 0,
    playerBodyName: s.run.plan ? s.run.plan.player.bodyName : '',
    baseKey: s.run.plan ? s.run.plan.baseKey : '',
    unavailable: unavailableSlots(s.loadout),
    slots: loadout ? loadout.slots : [],
  };
}
