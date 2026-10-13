/**
 * CONTENT-ENCOUNTER-PLAYABLE-BATCH-R1｜遭遇验证台**扩展批次**（纯逻辑层，无 DOM / Canvas / 物理）。
 *
 * ── 这一层解决什么 ──────────────────────────────────────────────────────────
 *
 *   默认遭遇验证台（`encounterValidation.ts`）固定三敌 `ProtoRusher / Chaser / RangedTurret`，
 *   是**基线对照**，本 Queue 要求它**一字不变**。但正式对手池已有 49 套模板，其中不少
 *   （heavyBox / tallBody 系）尚未进入本 Lab 目录，Demo 缺「可连续切换的差异化实战内容」。
 *
 *   本文件提供**独立、可切换**的扩展批次：三套明显不同物理压力的内容，
 *   引用**既有正式模板**（不新增敌人、不改任何数值），供集中录像与挑选接入正式 Run。
 *   只做「有无 / 可运行 / 能比较」，**不微调胜负与特效**。
 *
 * ── 隔离方式（Queue 必改 2：默认原三敌批次一字不变）──────────────────────────
 *
 *   - 扩展批次是**另一个** `EncounterBatchEntry[]`（`EXTENDED_ENCOUNTER_BATCH`），
 *     不修改 `ENCOUNTER_BATCH` / `ENCOUNTER_BATCH_IDS` / `encounterBatchProblems()`；
 *   - 页面通过**显式 URL mode**（`encounter-lab.html?batch=ext`）切到扩展批次；
 *     不带参数 ⇒ 仍是默认三敌（默认页逐字节不变）。
 *   - 批次条目里的 label / templateId / count 一律从 `testData.LAB_ENCOUNTERS` 读现成条目，
 *     本文件**不复制**它们 —— 正式内容变化会跟着变或加载即抛错。
 *
 * ⚠️ 与 `encounterValidation.ts` 同构：本文件同样不写任何敌人数值、不新增敌人、不改定义。
 */

import { type LabEncounterId } from './constants';
import { findEncounter } from './testData';
import { type EncounterBatchEntry } from './encounterValidation';

/**
 * 扩展批次点名的三套 Encounter（顺序即页面上的展示顺序）。
 *
 * ⚠️ 三套都是**既有正式对手模板的引用**（`LAB_ENCOUNTERS` 内既有条目）：
 *    R1-HVY-02 / R1-CTRL-01 / R1-MIX-02。id 必须真实存在（加载时校验，缺失即抛错）。
 */
export type ExtendedEncounterBatchId =
  | 'ExtendedHeavyContact'
  | 'ExtendedStandoffRod'
  | 'ExtendedBurnSaw';

export const EXTENDED_ENCOUNTER_BATCH_IDS: readonly ExtendedEncounterBatchId[] = [
  'ExtendedHeavyContact',
  'ExtendedStandoffRod',
  'ExtendedBurnSaw',
];

/**
 * 每套 Encounter 的**威胁假设**（一句话，玩家视角）。
 *
 * 它不是数值、不是平衡结论 —— 只是「这一套内容引入的是什么压力」的一句话假设，
 * 复核时引用正式 Draft / 武器 / 真实物理（见 `testData.ts` 的登记表与注释）。
 */
const EXTENDED_VERIFIES: Readonly<Record<ExtendedEncounterBatchId, string>> = {
  ExtendedHeavyContact: '推不动的重车用霰弹 + 锤贴脸轰击（重型贴身压力）',
  ExtendedStandoffRod: '高重心站桩用推杆拉开距离 + 霰弹轰（控距姿态压力）',
  ExtendedBurnSaw: '高身车喷火 + 锯持续贴身磨血（持续近身压力）',
};

/**
 * 扩展批次（与默认批次**并存**，互不影响）。
 *
 * ⚠️ label / templateId / count 一律从 `testData.LAB_ENCOUNTERS` 读现成条目。
 */
export const EXTENDED_ENCOUNTER_BATCH: readonly EncounterBatchEntry[] =
  EXTENDED_ENCOUNTER_BATCH_IDS.map((id) => {
    const entry = findEncounter(id);
    if (!entry) throw new Error(`[CONTENT-ENCOUNTER-PLAYABLE-BATCH-R1] 正式 Encounter "${id}" 不存在于 LAB_ENCOUNTERS`);
    return {
      id,
      label: entry.label,
      templateId: entry.templateId,
      count: entry.count,
      verifies: EXTENDED_VERIFIES[id],
    };
  });

/** 页面标题（扩展批次模式；画在顶部带）。 */
export const EXTENDED_LAB_TITLE = '遭遇验证台 · 扩展批次';

/** 副标题：一句话说明扩展批次的定位。 */
export const EXTENDED_LAB_LEAD = '同一个玩家车、同一个战场，只换对手（扩展批次：三套差异化实战内容）。';

/** 按 id 取扩展批次条目；不在批次内 → `null`（不静默回退）。 */
export function extendedEncounterBatchOf(id: string): EncounterBatchEntry | null {
  return EXTENDED_ENCOUNTER_BATCH.find((e) => e.id === id) ?? null;
}

/** 出厂自检：扩展批次每个 id 都必须真实存在于正式 Encounter 表（防止死配置）。 */
export function extendedEncounterBatchProblems(): readonly string[] {
  const problems: string[] = [];
  if (EXTENDED_ENCOUNTER_BATCH.length !== 3) {
    problems.push(`扩展批次必须恰好 3 项，实际 ${EXTENDED_ENCOUNTER_BATCH.length}`);
  }
  for (const id of EXTENDED_ENCOUNTER_BATCH_IDS) {
    if (!findEncounter(id)) problems.push(`扩展批次 id "${id}" 不在正式 Encounter 表内`);
  }
  for (const e of EXTENDED_ENCOUNTER_BATCH) {
    if (e.count !== 1) problems.push(`"${e.id}" 必须单车（count=${e.count}）`);
    if (!e.verifies) problems.push(`"${e.id}" 缺少威胁假设文案`);
  }
  return problems;
}

/** 类型级护栏：扩展批次 id 必须是正式 `LabEncounterId` 的子集。 */
export const EXTENDED_ENCOUNTER_BATCH_IDS_ARE_FORMAL: readonly LabEncounterId[] =
  EXTENDED_ENCOUNTER_BATCH_IDS;
