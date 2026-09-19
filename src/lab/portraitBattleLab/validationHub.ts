/**
 * PRP-VALIDATION-HUB-R1｜验证中心（Validation Hub）的**唯一数据源**（纯逻辑，零 DOM）。
 *
 * 问题（Queue 原文）：Prototype 已经出现多个独立验证入口。后续若继续
 * 「改一个机制 → 重新找 URL/命令 → 单独录像 → 再切另一个」，人工验收成本会持续上升。
 *
 * 本文件只做一件事：把「当前需要人工验收的验证入口」列成一张**可枚举的表**，
 * 让页面壳（`validationHubMain.ts`）与守卫（`tests/portraitValidationHub.test.ts`）
 * 读同一份数据 —— 于是「Hub 上摆了什么」与「测试断言了什么」不可能分叉。
 *
 * 它**不 import 任何东西**（连 Lab 内部的都不 import）：
 *   - 无 DOM / Canvas / 像素读取；
 *   - 无战斗 / 物理 / 正式 Runtime / Run-local state；
 *   - 无任何战斗数值、无敌人、无掉落。
 *
 * ⚠️ 切换方式 = **整页导航**（点入口 = 浏览器加载那个入口页面**本身**），
 *    不是「在同一个文档里换控制器」。理由（逐条见 `validationHubMain.ts` 头部注释）：
 *      · Full Run 的入口就是**玩家正式页面本身**（`run-page.html`，与 `npm run dev`
 *        的落地页逐字节同一个文件）—— 只有整页导航才能保证「Hub 里看到的 = 玩家看到的」；
 *      · 整页导航 = 文档销毁 ⇒ 上一项验证的 Runtime / 弹丸 / 接触 / 计时器 / 监听器 /
 *        Run-local state **一起消失**，这是比「手动逐个 dispose」更强的清理保证；
 *      · 不在 Hub 里再造一套宿主（否则 Hub 版与独立版必然出现两套口径）。
 *
 * 整块删除清单见本目录 constants.ts 头部注释。
 */

/** 验证中心里的入口 id（数组顺序 = 页面顺序 = 建议的人工验收顺序）。 */
export type ValidationHubEntryId = 'fullRun' | 'nextRun' | 'encounterBatch' | 'contentBatch';

export interface ValidationHubEntry {
  readonly id: ValidationHubEntryId;
  /** 英文短名（Queue 原文：Full Run / Next Run / Encounter Batch）。 */
  readonly label: string;
  /** 中文短名（一眼知道这块在验什么面）。 */
  readonly zhLabel: string;
  /** 这个入口回的是哪个 Queue 的交付（可追溯到具体 Queue ID）。 */
  readonly queueId: string;
  /** 这个入口要回答的那个问题（一句话，人话）。 */
  readonly verifies: string;
  /** 真实入口页面（相对本页）。点它 = 整页导航到那个页面**本身**。 */
  readonly href: string;
  /** 根目录 HTML 文件名（与 `href` 同源，供守卫核对「文件真的存在」）。 */
  readonly pageFile: string;
  /** 单独打开同一入口的等价命令（Hub 之外的后备方式，仍可用）。 */
  readonly command: string;
}

/**
 * 四个入口（顺序 = 建议的人工验收顺序）。
 *
 * ⚠️ `fullRun` 的入口就是玩家正式页面**本身**：
 *    `npm run dev` 的落地页（根路径重写目标）也是 `run-page.html` —— 同一个文件。
 *    验证中心**不复制、不包裹、不改写**它，只提供一个入口。
 *    代价是它不会带着「返回验证中心」的按钮（那会改到正式页面），返回方式见
 *    `VALIDATION_HUB_BACK_HINT`。
 *
 * ⚠️ 第四个（`contentBatch`）是 PRP-M3-CONTENT-BATCH-01 新增的**内容批次验证台** ——
 *    它只**新增一条导航**，Hub 的架构（纯导航 / 零画布 / 整页导航）一个字没动。
 */
export const VALIDATION_HUB_ENTRIES: readonly ValidationHubEntry[] = [
  {
    id: 'fullRun',
    label: 'Full Run',
    zhLabel: '完整一局',
    queueId: 'PRP-RUN-02-FULL-RUN-VERTICAL-SLICE',
    verifies: '一整局从开局走到终局：脚本驱动的多场战斗 + 强化选择 + 耐久取舍 + 终态，是否成立。',
    href: './run-page.html',
    pageFile: 'run-page.html',
    command: 'npm run dev:run-page',
  },
  {
    id: 'nextRun',
    label: 'Next Run',
    zhLabel: '下一局起始改装',
    queueId: 'PRP-M2-NEXT-RUN-SEED-VALIDATION',
    verifies: '一局结束后，玩家会不会因为「下一局起点不同」而立刻想再打一局。',
    href: './next-run.html',
    pageFile: 'next-run.html',
    command: 'npm run dev:next-run',
  },
  {
    id: 'encounterBatch',
    label: 'Encounter Batch',
    zhLabel: '遭遇对照',
    queueId: 'PRP-M3-ENCOUNTER-BATCH-01',
    verifies: '不同的敌人，是否真的让同一辆战车面临不同的战斗问题。',
    href: './encounter-lab.html',
    pageFile: 'encounter-lab.html',
    command: 'npm run dev:encounter-lab',
  },
  {
    id: 'contentBatch',
    label: 'Content Batch',
    zhLabel: '内容批次',
    queueId: 'PRP-M3-CONTENT-BATCH-01',
    verifies: '一批 M3 内容（多单位 / 废弃修理站 / 路边改装件）能不能一次集中看完 —— 其中多单位项当前如实标记 BLOCK。',
    href: './content-batch.html',
    pageFile: 'content-batch.html',
    command: 'npm run dev:content-batch',
  },
];

export const VALIDATION_HUB_TITLE = '验证中心';

export const VALIDATION_HUB_SUBTITLE = 'Validation Hub';

/** 页面副标题（一句话说明这个壳为什么存在）。 */
export const VALIDATION_HUB_LEAD = '一次启动 · 连续切换 · 一段录像批量验收';

/**
 * 切换纪律（页面底部固定显示）。
 * 注意：这句话是**说明**，不是数据 —— 页面上不会出现任何运行期读数。
 */
export const VALIDATION_HUB_SWITCH_NOTE =
  '点任一入口 = 整页导航到那个入口页面本身：上一项的运行时、弹丸、接触记录、计时器、监听器与 Run-local 状态随文档一起消失，下一个入口从零开始。';

/** 返回方式（页面底部固定显示）。 */
export const VALIDATION_HUB_BACK_HINT = '返回本页：浏览器后退（Alt + ←）';

/** 边界声明（页面底部固定显示）。 */
export const VALIDATION_HUB_SCOPE_NOTE = '本页只负责导航，不承载任何运行期数据面板。';

/** 「上次进入」标记的存储键（仅用于给人指路，不参与任何判定）。 */
export const VALIDATION_HUB_STORAGE_KEY = 'prp-validation-hub:last-entry';

/** 只用到 `getItem` / `setItem` —— 便于 node 侧用假实现覆盖私有模式 / 抛异常分支。 */
export interface ValidationHubStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** 按 id 取入口（不在表内 → `null`）。 */
export function validationHubEntryById(id: string): ValidationHubEntry | null {
  return VALIDATION_HUB_ENTRIES.find((e) => e.id === id) ?? null;
}

/**
 * 按 Hub 顺序取「下一个」：`null` / 未知 id → 第一个；末项 → 回到第一个（循环）。
 * 它只是「给人指路」的默认值，不改变任何入口的行为。
 */
export function nextValidationHubEntry(lastId: string | null): ValidationHubEntry {
  const at = lastId === null ? -1 : VALIDATION_HUB_ENTRIES.findIndex((e) => e.id === lastId);
  const step = at < 0 ? 0 : at + 1;
  return VALIDATION_HUB_ENTRIES[step % VALIDATION_HUB_ENTRIES.length];
}

/**
 * 读「上次进入」。
 * ⚠️ 只认本表内的 id（历史残留值 / 手改值一律当没写过），且任何异常都退化成 `null`。
 */
export function readValidationHubLastEntry(store: ValidationHubStore | null): ValidationHubEntryId | null {
  if (!store) return null;
  let raw: string | null;
  try {
    raw = store.getItem(VALIDATION_HUB_STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null || raw === '') return null;
  const entry = validationHubEntryById(raw);
  return entry ? entry.id : null;
}

/** 写「上次进入」（只接受本表内的 id；异常 / 非法 id 一律返回 `false`，绝不抛）。 */
export function writeValidationHubLastEntry(store: ValidationHubStore | null, id: string): boolean {
  if (!store) return false;
  const entry = validationHubEntryById(id);
  if (!entry) return false;
  try {
    store.setItem(VALIDATION_HUB_STORAGE_KEY, entry.id);
  } catch {
    return false;
  }
  return true;
}
