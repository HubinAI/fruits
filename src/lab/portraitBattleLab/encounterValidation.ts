/**
 * PRP-M3-ENCOUNTER-BATCH-01｜遭遇验证台的**纯逻辑层**（无 DOM / 无 Canvas / 无物理）。
 *
 * 本 Queue 是 **Content Batch**，不是 Foundation 研发：**不开发新敌人**，
 * 只把当前**已经存在的正式 Encounter** 集中到一个可切换的验证面上，用来回答一个问题：
 *
 *     不同的敌人，是否真的让**同一辆战车**面临不同的战斗问题？
 *
 * 因此本文件只做三件事：
 *
 *   1) **固定三个已有 Encounter**（Queue 必改 1）：`ProtoRusher` / `Chaser` / `RangedTurret`。
 *      三者都只是 `testData.LAB_ENCOUNTERS` 里**既有条目**的引用，label / 正式模板 id / 数量
 *      全部由正式链路给出 —— 本文件不写任何敌人数值、不新增敌人、不改任何定义。
 *   2) **固定同一个基础玩家**（Queue 必改 2）：直接复用 PRP 的演示装载常量
 *      `RUN_DEMO_LOADOUT_ID`（= `WatermelonHeavyCannon`）—— 「同一玩家条件」在结构上
 *      不可能与原型其它入口分叉。
 *   3) 给出每个 Encounter 的**验证目标**（一句话），让「三个敌人提出的是三个不同的问题」
 *      成为可读的假设，而不是靠人记。
 *
 * ⚠️ 与 M2（下一局种子）的区别：M2 的种子**改变玩家**，M3 的 Encounter **只改变对手** ——
 *    所以这里刻意不引入任何 buff / 强化 / 随机；`build` 恒为空、耐久恒满。
 */

import { type LabEncounterId, type LabLoadoutId } from './constants';
import { buildSpawnPlan } from './entities';
import { RUN_DEMO_LOADOUT_ID } from './runPageScene';
import { findEncounter, findLoadout, LAB_ENCOUNTERS } from './testData';

/**
 * Queue 必改 1 点名的三个 Encounter（顺序即页面上的展示顺序）。
 *
 * ⚠️ 这是**唯一**的批次定义：验证台不接受其它 id，也不允许出现第四个。
 *    id 必须真实存在于 `LAB_ENCOUNTERS`（加载时校验，缺失即抛错，不静默跳过）。
 */
export type EncounterBatchId = 'ProtoRusher' | 'Chaser' | 'RangedTurret';

export const ENCOUNTER_BATCH_IDS: readonly EncounterBatchId[] = [
  'ProtoRusher',
  'Chaser',
  'RangedTurret',
];

/**
 * 每个 Encounter 要拿到答案的那个问题（Queue 必改 1 原文）。
 * 它不是数值、不是平衡结论 —— 只是「这一套 Encounter 引入的是什么压力」的一句话假设。
 */
const ENCOUNTER_VERIFIES: Readonly<Record<EncounterBatchId, string>> = {
  ProtoRusher: '快速接敌 / 近身压力',
  Chaser: '持续追击 / 重型接触压力',
  RangedTurret: '远程输出 / 接近压力',
};

export interface EncounterBatchEntry {
  readonly id: EncounterBatchId;
  /** 正式展示名（来自 `testData`，单一来源，不在这里重写一份中文名）。 */
  readonly label: string;
  /** 正式对手池模板 id（= 这一套 Encounter 到底是什么，来自 `testData`）。 */
  readonly templateId: string;
  /** 同场敌人数（三套都是 1；本 Queue 不加多实体）。 */
  readonly count: number;
  /** 这一套要验证的问题。 */
  readonly verifies: string;
}

/**
 * 固定批次（Queue 必改 1）。
 *
 * ⚠️ label / templateId / count 一律从 `testData.LAB_ENCOUNTERS` 里读现成的条目，
 *    本文件**不复制**它们 —— 正式内容一旦变化，这里会跟着变（或加载即抛错），
 *    不会出现「验证台里写着一套、正式内容里是另一套」。
 */
export const ENCOUNTER_BATCH: readonly EncounterBatchEntry[] = ENCOUNTER_BATCH_IDS.map((id) => {
  const entry = findEncounter(id);
  if (!entry) throw new Error(`[PRP-M3] 正式 Encounter "${id}" 不存在于 LAB_ENCOUNTERS`);
  return {
    id,
    label: entry.label,
    templateId: entry.templateId,
    count: entry.count,
    verifies: ENCOUNTER_VERIFIES[id],
  };
});

/** 验证台固定使用的玩家（Queue 必改 2：三个 Encounter 共用同一个基础玩家）。 */
export const ENCOUNTER_LAB_LOADOUT_ID: LabLoadoutId = RUN_DEMO_LOADOUT_ID;

/** 页面标题（画在顶部带）。 */
export const ENCOUNTER_LAB_TITLE = '遭遇验证台';

/** 副标题：一句话说明「这里只换对手，不换车」。 */
export const ENCOUNTER_LAB_LEAD = '同一个玩家车、同一个战场，只换对手。';

/** Reset 控件文案（Queue 必改 3 允许的四个控件之一）。 */
export const ENCOUNTER_LAB_RESET_LABEL = 'Reset';

/** 未选对手时的舞台提示。 */
export const ENCOUNTER_LAB_IDLE_HINT = '选一个对手开始';

/** 按 id 取批次条目；不在批次内 → `null`（不静默回退到别的 Encounter）。 */
export function encounterBatchOf(id: string): EncounterBatchEntry | null {
  return ENCOUNTER_BATCH.find((e) => e.id === id) ?? null;
}

/* ------------------------------------------------------------ 页面上下文 */

export interface EncounterLabEntry {
  readonly id: EncounterBatchId;
  readonly label: string;
  readonly verifies: string;
  /** 对手车身展示名（正式链路解析结果，不是手写）。 */
  readonly enemyLabel: string;
  /** 对手真实耐久上限（正式链路解析结果）。 */
  readonly enemyHpMax: number;
}

export interface EncounterLabContext {
  readonly loadoutId: LabLoadoutId;
  readonly playerLabel: string;
  readonly playerBodyName: string;
  readonly playerHpMax: number;
  readonly encounters: readonly EncounterLabEntry[];
}

/**
 * 页面上下文：玩家与三个对手的展示名 / 耐久上限**全部**由正式链路解析
 * （`buildSpawnPlan` → 正式 registry），本文件不写任何数值。
 */
export function encounterLabContext(): EncounterLabContext {
  const loadout = findLoadout(ENCOUNTER_LAB_LOADOUT_ID);
  const player = buildSpawnPlan(ENCOUNTER_LAB_LOADOUT_ID, ENCOUNTER_BATCH_IDS[0]).player;
  const encounters = ENCOUNTER_BATCH.map((b) => {
    const enemy = buildSpawnPlan(ENCOUNTER_LAB_LOADOUT_ID, b.id).enemies[0];
    return {
      id: b.id,
      label: b.label,
      verifies: b.verifies,
      enemyLabel: enemy.bodyName,
      enemyHpMax: enemy.hp,
    };
  });
  return {
    loadoutId: ENCOUNTER_LAB_LOADOUT_ID,
    playerLabel: loadout ? loadout.label : player.bodyName,
    playerBodyName: player.bodyName,
    playerHpMax: player.hp,
    encounters,
  };
}

/** 出厂自检：批次里的每个 id 都必须真实存在于正式 Encounter 表（防止死配置）。 */
export function encounterBatchProblems(): readonly string[] {
  const problems: string[] = [];
  if (ENCOUNTER_BATCH.length !== 3) problems.push(`批次必须恰好 3 项，实际 ${ENCOUNTER_BATCH.length}`);
  for (const id of ENCOUNTER_BATCH_IDS) {
    if (!LAB_ENCOUNTERS.some((e) => e.id === id)) problems.push(`批次 id "${id}" 不在正式 Encounter 表内`);
  }
  for (const e of ENCOUNTER_BATCH) {
    if (e.count !== 1) problems.push(`"${e.id}" 必须单车（count=${e.count}）；本 Queue 不加多实体`);
    if (!e.verifies) problems.push(`"${e.id}" 缺少验证目标文案`);
  }
  return problems;
}

/** 类型级护栏：批次 id 必须是正式 `LabEncounterId` 的子集。 */
export const ENCOUNTER_BATCH_IDS_ARE_FORMAL: readonly LabEncounterId[] = ENCOUNTER_BATCH_IDS;
