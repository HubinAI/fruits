/**
 * PRP-M3-CONTENT-BATCH-01｜M3 内容批次验证台的**纯逻辑层**（零 DOM / 零 Canvas / 零物理）。
 *
 * 本 Queue 是 **Content Batch**，不是 Foundation 研发：`本 Queue 不再开发 Foundation`。
 * 本文件因此只做三件事：
 *
 *   1) **固定三项内容**（顺序即 Queue 原文顺序）：多单位轻敌群 / 废弃修理站 / 路边改装件；
 *   2) 每一项的「验证目标」写成一句话，让「这一项想回答什么」是可读的假设，而不是靠人记；
 *   3) 给出两项非战斗事件的**真实状态迁移** —— 耐久与 Build 都是**现有状态**，
 *      恢复量 / 候选池全部来自既有正式链路，本文件**不新造任何战斗数值**。
 *
 * ⚠️ 本文件不 import 任何正式战斗栈模块（连 `battleContract` 都不需要）：
 *    非战斗事件既不需要世界、也不需要相机、更不需要物理 —— 这是「不新增 Foundation」
 *    在依赖图上的直接体现（Lab 侧 → 正式侧的导入白名单守卫因此无需任何改动）。
 *
 * ⚠️ 三项内容的**完工状态是如实标注的**，不是都能跑：
 *    · 第 1 项（多单位）在当前实现下 **BLOCK** —— 见 `MULTI_UNIT_BLOCK`（附 file:line 证据）；
 *    · 第 2 / 3 项 ready（各二选一，状态迁移完全可机测）。
 *    Queue 原文：「若某个内容因为缺 Foundation 无法简单实现：标记 BLOCK，不自行扩大开发范围。」
 *    ⇒ 这里只**标注**它在哪一层断掉，绝不为它伪造一场战斗或临时造一套多车宿主。
 */

import {
  EMERGENCY_REPAIR_FRACTION,
  runLateralPoolDefs,
  type RunModifierDef,
  type RunModifierId,
} from './runModifiers';

/* ------------------------------------------------------------- 类型定义 */

export type ContentBatchItemId = 'MultiUnitSwarm' | 'RepairStation' | 'RoadsideUpgrade';

/** 本项内容当前能不能真的跑起来（`blocked` 必须是**如实**的，不是保守起见）。 */
export type ContentBatchStatus = 'ready' | 'blocked';

/** 内容类别：战斗 / 非战斗事件（本 Queue 只有一项战斗，且它当前 blocked）。 */
export type ContentBatchKind = 'battle' | 'event';

/** 一个选项（二选一的一项）。`log` = 选择后写入记录的自然语言（与 Run 事件同一写法）。 */
export interface ContentBatchOption {
  readonly id: string;
  readonly label: string;
  readonly note: string;
  readonly log: string;
}

/** BLOCK 说明：为什么跑不了 + 证据落在哪（file:line），便于下一步单开 Queue。 */
export interface ContentBatchBlocked {
  readonly reason: string;
  readonly evidence: readonly string[];
  /** 需要补哪一层 Foundation 才能解除（本 Queue 明令不开发）。 */
  readonly needs: string;
}

export interface ContentBatchItem {
  readonly id: ContentBatchItemId;
  /** 中文展示名（Queue 原文）。 */
  readonly label: string;
  readonly kind: ContentBatchKind;
  readonly status: ContentBatchStatus;
  /** 这一项要回答的那个问题（一句话）。 */
  readonly verifies: string;
  /** 舞台标题（事件用；战斗项为空串）。 */
  readonly title: string;
  /** 二选一（战斗项为空数组）。 */
  readonly options: readonly ContentBatchOption[];
  readonly blocked: ContentBatchBlocked | null;
}

/** 耐久条件（只用于验证「当前耐久是否让选择不同」，不是新资源、不是存档）。 */
export type ContentBatchHpCase = 'damaged' | 'full';

/* ------------------------------------------------- 第 1 项｜BLOCK 证据 */

/**
 * ⚠️ 多单位轻敌群 = **BLOCK**（Queue 原文允许并要求如实标记）。
 *
 * 判定依据（先调查后结论，全部 file:line；不是保守起见）：
 *   · Queue 要求「3 个低压单位同时出现在**真实 Battle Runtime**」；
 *   · 本项目里「真实战斗运行时」是 `runBattleRuntime.ts` 自述的名字 —— 它 = 正式
 *     `PlanckBattleOrchestrator` 的薄适配；
 *   · 而正式编排器**硬编码两车**：`planckBattleOrchestrator.ts:217-218`
 *     `readonly vehicleA` / `readonly vehicleB`，`:266`/`:273` 只装配这两辆；
 *   · 胜负语义也只有两方：`battleContract.ts:96-98` `winner: TeamId`，
 *     `:488` `hpA > hpB ? 'A' : hpB > hpA ? 'B' : ...`；
 *   · `runBattleRuntime.ts:355` 只取 `this.plan.enemies[0].snapshot` —— 第 2 / 3 个敌人
 *     **在运行时被直接丢弃**（这与 `OPP-03` 的 `drive:'stationary'` 被丢弃是同一类缺口）。
 *
 * 1vN 的**能力本身是存在的**，但不在正式运行时里：
 *   · 接触层已经实例化：`contactRouter.ts:169/206-207` 用 `OwnerTag.vehicleId` 区分同队多车，
 *     `:242` `vehicles: CombatVehicleState[]`，`:282-293` 按 vehicleId 精确解析到实例；
 *   · 唯一宿主 = Lab 的 `ArenaARuntime`：`arenaA.ts:814-815`
 *     `[arenaAPlayerSpawn(), ...arenaAEnemySpawns(plan.enemies.length)]` + `[plan.player, ...plan.enemies]`；
 *   · 但 `arenaA.ts:28-30` 自述它**不调用**正式 `drivePlanckVehicle`（Lab-local Topdown
 *     Movement Adapter，冲量平移 + 力偶转向）⇒ 它不是「正式 Physics Battle」，
 *     而且 `constants.ts:13-19` 明写 `portrait-lab.html` 是 **DEBUG ONLY / 非体验入口**。
 *
 * 因此 `LightSwarm3`（`testData.ts:238-245`，`count: 3`）**已经存在**且已在 Arena A
 * 真实跑出 3 个实体（`portraitBattleLabA1.test.ts:724` 实测 `enemyBody: 22980`），
 * 但「复用 LightSwarm3」**无法**满足本项要求 —— 缺的是宿主，不是内容。
 *
 * ⇒ 解除 BLOCK 需要「N 车正式编排 + N 方胜负 + 对应相机」，即**新 Foundation**；
 *    本 Queue 禁止（`新 Foundation` / `新 Movement` / `新 Camera`）⇒ 如实标记，不扩范围。
 */
export const MULTI_UNIT_BLOCK: ContentBatchBlocked = Object.freeze({
  reason:
    '「真实 Battle Runtime」= 正式 PlanckBattleOrchestrator，它硬编码两车（vehicleA / vehicleB）' +
    '且胜负只有 A/B 两方；多单位在这个运行时里第 2 个起直接被丢弃。',
  evidence: Object.freeze([
    'src/battle/planckBattleOrchestrator.ts:217-218（只有 vehicleA / vehicleB 两个字段）',
    'src/battle/planckBattleOrchestrator.ts:266,273（只装配这两辆）',
    'src/battle/battleContract.ts:96-98,488（winner: TeamId，仅 A / B）',
    'src/lab/portraitBattleLab/runBattleRuntime.ts:355（只取 plan.enemies[0].snapshot）',
    'src/lab/portraitBattleLab/arenaA.ts:814-815（唯一 1vN 宿主，且 :28-30 自述不用正式 drivePlanckVehicle）',
    'src/lab/portraitBattleLab/constants.ts:13-19（portrait-lab.html = DEBUG ONLY，非体验入口）',
  ]),
  needs: 'N 车正式编排 + N 方胜负判定 + 对应相机（= 新 Foundation；本 Queue 禁止开发）',
});

/* --------------------------------------------------- 第 2 项｜废弃修理站 */

/**
 * 维修量 = **沿用现有 Repair Foundation**：`EMERGENCY_REPAIR_FRACTION`（0.25）× 耐久上限。
 *
 * ⚠️ 这是既有 Run 耐久事件**同一个**公式与同一个常量（`runPageState.ts:800`
 *    `Math.round(maxHp * EMERGENCY_REPAIR_FRACTION)`）——本文件不新造数值、不改它。
 *    对正式上限 1100 ⇒ 275（与 `nextRunValidation.ts:202` 记录的补偿量同值）。
 */
export function repairAmount(hpMax: number): number {
  return Math.round(hpMax * EMERGENCY_REPAIR_FRACTION);
}

/** 真实上限 → 该条件下的当前耐久。两档都**只用正式上限与正式维修量**派生。 */
export function hpForCase(hpMax: number, hpCase: ContentBatchHpCase): number {
  return hpCase === 'full' ? hpMax : Math.max(0, hpMax - repairAmount(hpMax));
}

export const REPAIR_STATION_TITLE = '废弃修理站';
export const REPAIR_STATION_LEAD = '路边有一处还能用的修理站。停不停？';

/** 固定二选一（Queue 原文）：临时维修 / 继续赶路。 */
export const REPAIR_STATION_OPTIONS: readonly ContentBatchOption[] = Object.freeze([
  Object.freeze({
    id: 'repair',
    label: '临时维修',
    note: '在这里修一段耐久，晚一点再上路',
    log: '你在废弃修理站停下来，把车体焊补回去。',
  }),
  Object.freeze({
    id: 'continue',
    label: '继续赶路',
    note: '不修，保持当前状态继续走',
    log: '你没有停下，直接开了过去。',
  }),
]);

/* --------------------------------------------------- 第 3 项｜路边改装件 */

export const ROADSIDE_UPGRADE_TITLE = '路边改装件';
export const ROADSIDE_UPGRADE_LEAD = '有人把改装配件丢在路边。拿一件走。';

/**
 * 候选池 = **复用现有横向改装池**（`runLateralPoolDefs`）：只取未拥有的第一层强化、
 * 不含 `emergencyRepair` ⇒ 本文件**不新增 Modifier**（Queue 原文）。
 *
 * ⚠️ 与 Run 里「继续改装」的唯一差别：这里**固定给两个**（Queue 原文「固定提供两个」），
 *    所以对池取前 2 项。池本身仍是那一个函数，规则零复制。
 */
export function roadsideCandidates(owned: readonly RunModifierId[]): readonly RunModifierDef[] {
  return runLateralPoolDefs(owned).slice(0, 2);
}

/** 把候选池转成二选一的选项（label / note 来自正式 Modifier 定义，不在本文件重写中文名）。 */
export function roadsideOptions(owned: readonly RunModifierId[]): readonly ContentBatchOption[] {
  return roadsideCandidates(owned).map((m) => ({
    id: m.id,
    label: m.label,
    note: m.note,
    log: m.logText,
  }));
}

/* ----------------------------------------------------------- 三项内容表 */

export const CONTENT_BATCH_IDS: readonly ContentBatchItemId[] = Object.freeze([
  'MultiUnitSwarm',
  'RepairStation',
  'RoadsideUpgrade',
]);

const CONTENT_VERIFIES: Readonly<Record<ContentBatchItemId, string>> = {
  MultiUnitSwarm: '数量（而不是单车强度）是否让单发重炮与多发 Build 产生不同价值。',
  RepairStation: '玩家当前耐久是否会让一个简单事件产生不同选择。',
  RoadsideUpgrade: '非战斗节点是否也可以改变战车 Build。',
};

/**
 * 固定批次（顺序 = Queue 原文顺序，不重排、不增删）。
 *
 * ⚠️ 第 3 项的候选池**随当前 Build 变化** ⇒ 它不能在这里固化；`contentBatchItem()` 每次
 *    用传入的 `owned` 现算（这也正是「已经拥有则过滤」这条规则的落点）。
 */
export function contentBatchItem(id: ContentBatchItemId, owned: readonly RunModifierId[] = []): ContentBatchItem {
  const base = {
    id,
    verifies: CONTENT_VERIFIES[id],
  };
  if (id === 'MultiUnitSwarm') {
    return {
      ...base,
      label: '多单位轻敌群',
      kind: 'battle',
      status: 'blocked',
      title: '',
      options: [],
      blocked: MULTI_UNIT_BLOCK,
    };
  }
  if (id === 'RepairStation') {
    return {
      ...base,
      label: REPAIR_STATION_TITLE,
      kind: 'event',
      status: 'ready',
      title: REPAIR_STATION_TITLE,
      options: REPAIR_STATION_OPTIONS,
      blocked: null,
    };
  }
  return {
    ...base,
    label: ROADSIDE_UPGRADE_TITLE,
    kind: 'event',
    status: 'ready',
    title: ROADSIDE_UPGRADE_TITLE,
    options: roadsideOptions(owned),
    blocked: null,
  };
}

/** 按 id 取（不在批次内 → `null`，不静默回退到别的项）。 */
export function contentBatchItemById(
  id: string,
  owned: readonly RunModifierId[] = [],
): ContentBatchItem | null {
  return (CONTENT_BATCH_IDS as readonly string[]).includes(id)
    ? contentBatchItem(id as ContentBatchItemId, owned)
    : null;
}

/** 顺序推进（「下一项」）：末项 → 回到第一项（循环）。只指路，不改任何读数。 */
export function nextContentBatchId(id: ContentBatchItemId): ContentBatchItemId {
  const at = CONTENT_BATCH_IDS.indexOf(id);
  return CONTENT_BATCH_IDS[(at + 1) % CONTENT_BATCH_IDS.length];
}

/* --------------------------------------------------------------- 状态机 */

/** 一份「读数」（耐久 + Build）——事件**只改这两样**（Queue 验收 5：使用现有 HP / Modifier 状态）。 */
export interface ContentBatchReading {
  readonly hp: number;
  readonly owned: readonly RunModifierId[];
}

export interface ContentBatchState {
  readonly activeId: ContentBatchItemId;
  readonly hpMax: number;
  readonly hpCase: ContentBatchHpCase;
  /**
   * **进入本内容那一刻**的读数 = Reset 的还原目标。
   * ⚠️ 与 `current` 分开存是「Reset 后与进入时逐字段相同」这条判据的唯一依据（不靠重算）。
   */
  readonly entry: ContentBatchReading;
  readonly current: ContentBatchReading;
  readonly chosenOptionId: string | null;
  readonly log: readonly string[];
}

export function createContentBatchState(
  activeId: ContentBatchItemId,
  hpMax: number,
  hpCase: ContentBatchHpCase = 'damaged',
  owned: readonly RunModifierId[] = [],
): ContentBatchState {
  const reading: ContentBatchReading = { hp: hpForCase(hpMax, hpCase), owned: [...owned] };
  return {
    activeId,
    hpMax,
    hpCase,
    entry: reading,
    current: reading,
    chosenOptionId: null,
    log: [],
  };
}

/** 切换内容：**带走当前读数**（同一次 Run 里读数本来就跨节点延续），重记进入态并清空本次选择。 */
export function contentBatchSelect(state: ContentBatchState, id: ContentBatchItemId): ContentBatchState {
  return {
    ...state,
    activeId: id,
    entry: state.current,
    chosenOptionId: null,
    log: [],
  };
}

/** 切换耐久条件：回到该条件下的进入态（用于对照「同一事件在不同耐久下是否产生不同选择」）。 */
export function contentBatchSetHpCase(
  state: ContentBatchState,
  hpCase: ContentBatchHpCase,
): ContentBatchState {
  const reading: ContentBatchReading = {
    hp: hpForCase(state.hpMax, hpCase),
    owned: [...state.current.owned],
  };
  return { ...state, hpCase, entry: reading, current: reading, chosenOptionId: null, log: [] };
}

/** Reset：把读数还原到**进入本内容那一刻**，并清空本次选择与记录（不新建任何运行期对象）。 */
export function contentBatchReset(state: ContentBatchState): ContentBatchState {
  return { ...state, current: state.entry, chosenOptionId: null, log: [] };
}

/**
 * 做出选择。**唯一会改动读数的入口**，且只改「现有状态」：
 *   · 废弃修理站：`repair` → 按正式维修量回耐久（**不超过上限，如实记账**）；`continue` → 读数不变；
 *   · 路边改装件：选中的 Modifier **加进 Build**（就是现有 Modifier 状态，没有第二套容器）；
 *   · 多单位：`blocked` ⇒ 没有选项可点，任何选择都显式抛错（不静默吞掉）。
 */
export function contentBatchChoose(state: ContentBatchState, optionId: string): ContentBatchState {
  const item = contentBatchItem(state.activeId, state.current.owned);

  if (item.status === 'blocked') {
    // ⚠️ 不伪造：BLOCK 的内容没有选项，调用方不应该能走到这里。
    throw new Error(`[PRP-M3] 内容 "${state.activeId}" 当前为 BLOCK，没有可选项（拒绝静默成功）`);
  }
  const option = item.options.find((o) => o.id === optionId);
  if (!option) {
    throw new Error(`[PRP-M3] 内容 "${state.activeId}" 没有选项 "${optionId}"`);
  }

  let reading: ContentBatchReading = state.current;
  if (state.activeId === 'RepairStation') {
    if (option.id === 'repair') {
      // 与 Run 耐久事件同一口径：修回一段，**不超过上限**（`Math.min` 是如实记账，不是补偿）。
      reading = { ...reading, hp: Math.min(state.hpMax, reading.hp + repairAmount(state.hpMax)) };
    }
  } else {
    // RoadsideUpgrade：选项 id 就是 Modifier id（候选池来自正式定义）。
    if (!reading.owned.includes(option.id as RunModifierId)) {
      reading = { ...reading, owned: [...reading.owned, option.id as RunModifierId] };
    }
  }

  return { ...state, current: reading, chosenOptionId: option.id, log: [...state.log, option.log] };
}

/* ------------------------------------------------------- 出厂自检 / 护栏 */

/**
 * 出厂自检：批次必须**恰好三项**、顺序固定、每项都有验证目标；
 * `ready` 的事件项必须恰有 2 个选项；`blocked` 的项必须**没有**选项且带证据。
 * （任一不成立 → 页面壳与守卫都会看到问题，而不是悄悄少一项。）
 */
export function contentBatchProblems(): readonly string[] {
  const problems: string[] = [];
  if (CONTENT_BATCH_IDS.length !== 3) {
    problems.push(`批次必须恰好 3 项，实际 ${CONTENT_BATCH_IDS.length}`);
  }
  CONTENT_BATCH_IDS.forEach((id, i) => {
    const item = contentBatchItem(id);
    if (!item.verifies) problems.push(`"${id}" 缺少验证目标文案`);
    if (item.status === 'ready' && item.options.length !== 2) {
      problems.push(`"${id}" 是 ready 事件，必须恰好 2 个选项，实际 ${item.options.length}`);
    }
    if (item.status === 'blocked') {
      if (item.options.length !== 0) problems.push(`"${id}" 已 BLOCK 却仍有选项（不许伪造可运行）`);
      if (!item.blocked || item.blocked.evidence.length === 0) problems.push(`"${id}" 已 BLOCK 却没有证据`);
    }
    if (item.status !== 'ready' && item.status !== 'blocked') {
      problems.push(`"${id}" 状态非法`);
    }
    if (i > 0 && !item.verifies) problems.push(`"${id}" 位置 ${i} 异常`);
  });
  // 第 3 项的候选池必须真的来自「未拥有」规则（拥有全部一层 ⇒ 池空 ⇒ 没有可选项）。
  const allLayer1: RunModifierId[] = ['heavyShell', 'twinCannon', 'fastReload'];
  if (roadsideCandidates(allLayer1).length !== 0) {
    problems.push('路边改装件：已拥有全部一层时仍给出了候选（未复用「未拥有则过滤」规则）');
  }
  if (roadsideCandidates([]).length !== 2) {
    problems.push('路边改装件：未拥有任何一层时不是恰好两个候选');
  }
  return problems;
}

/** 类型级护栏：批次 id 必须与三项内容一一对应（改名时编译期即失败）。 */
export const CONTENT_BATCH_IDS_TYPED: readonly ContentBatchItemId[] = CONTENT_BATCH_IDS;
