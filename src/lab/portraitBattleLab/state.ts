/**
 * PBL-F0｜Portrait Battle Lab 纯状态机（无 DOM / 无 Canvas / 无副作用 / 无平台依赖）。
 *
 * 语义刻意保持最小（本 Queue 只要求「状态切换正确」）：
 * - 选择项（Arena / Loadout / Encounter）任何时刻都可切换（不存在锁死态）；
 * - running 中切换任一选择项 → 回到 idle（配置已变，占位运行中止）；
 * - Start：idle → running 且 startCount+1；running 中重复 Start 幂等（no-op）；
 * - Reset：回 idle + 选择项恢复默认 + startCount 归零。
 *
 * 这里【不】包含战斗推进 / 伤害 / AI / 生成 —— 真实 Arena A/B Runtime 属于后续 Queue。
 */
import {
  LAB_ARENAS,
  LAB_DEFAULTS,
  LAB_ENCOUNTERS,
  LAB_LOADOUTS,
  type LabArenaDef,
  type LabArenaId,
  type LabEncounterDef,
  type LabLoadoutDef,
} from './constants';

export type LabPhase = 'idle' | 'running';

export interface PortraitLabState {
  readonly arena: LabArenaId;
  readonly loadout: string;
  readonly encounter: string;
  readonly phase: LabPhase;
  /** Start 累计次数（Reset 归零）—— 验收「Start 生效 / Reset 清空」的直接证据。 */
  readonly startCount: number;
  /** 每次状态变更 +1（渲染与测试共用的稳定版本号；同值 set 为 no-op 不递增）。 */
  readonly revision: number;
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
  };
}

function next(s: PortraitLabState, patch: Partial<PortraitLabState>): PortraitLabState {
  return { ...s, ...patch, revision: s.revision + 1 };
}

/** 切换 Arena。同值 no-op；换 Arena 视为配置变更 → 中止占位运行回 idle。 */
export function setArena(s: PortraitLabState, arena: LabArenaId): PortraitLabState {
  if (s.arena === arena) return s;
  if (!LAB_ARENAS.some((a) => a.id === arena)) return s; // 未知 id：忽略（不抛错）
  return next(s, { arena, phase: 'idle' });
}

/** 切换 Loadout。同值 no-op；未知 id 忽略；running 中变更 → 回 idle。 */
export function setLoadout(s: PortraitLabState, loadout: string): PortraitLabState {
  if (s.loadout === loadout) return s;
  if (!LAB_LOADOUTS.some((l) => l.id === loadout)) return s;
  return next(s, { loadout, phase: 'idle' });
}

/** 切换 Encounter。同值 no-op；未知 id 忽略；running 中变更 → 回 idle。 */
export function setEncounter(s: PortraitLabState, encounter: string): PortraitLabState {
  if (s.encounter === encounter) return s;
  if (!LAB_ENCOUNTERS.some((e) => e.id === encounter)) return s;
  return next(s, { encounter, phase: 'idle' });
}

/** Start：idle → running（startCount+1）；running 中重复 Start 幂等。 */
export function start(s: PortraitLabState): PortraitLabState {
  if (s.phase === 'running') return s;
  return next(s, { phase: 'running', startCount: s.startCount + 1 });
}

/** Reset：回 idle + 选择项恢复默认 + startCount 归零（显式动作，revision 必递增）。 */
export function reset(s: PortraitLabState): PortraitLabState {
  return { ...createPortraitLabState(), revision: s.revision + 1 };
}

/* ---------- 目录查询（纯函数；catalog id 之外的输入返回 undefined） ---------- */

export function findArena(id: LabArenaId): LabArenaDef | undefined {
  return LAB_ARENAS.find((a) => a.id === id);
}

export function findLoadout(id: string): LabLoadoutDef | undefined {
  return LAB_LOADOUTS.find((l) => l.id === id);
}

export function findEncounter(id: string): LabEncounterDef | undefined {
  return LAB_ENCOUNTERS.find((e) => e.id === id);
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
  };
}
