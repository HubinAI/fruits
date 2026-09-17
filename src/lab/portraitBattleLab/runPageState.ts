/**
 * PRP-F0-RUN-PAGE-SHELL｜PRP-R3-CAPYBARA-UI-HIERARCHY-REBUILD
 * ｜PRP-BUILD-01-TWO-STEP-CANNON-BUILD｜PRP-RUN-R1-DEATH-AND-DURABILITY-CONTINUITY
 * ｜PRP-RUN-02-FULL-RUN-VERTICAL-SLICE
 * Run Page 纯状态机（无 DOM / 无 Canvas / 无物理 / 无平台依赖 / 无副作用）。
 *
 * 产品基线：整个单局是**一个持续存在的竖屏 Adventure Run Page**，
 * 战斗 / 事件 / 耐久取舍 / 强化 / 结果是**同一个页面的若干状态**，不存在页面跳转。
 *
 * ## PRP-RUN-02：状态机**按固定 Run Script 推进**
 *
 * 本文件不再自己数「第几场 / 第几选」，而是读 `runScript.ts` 的**节点序列**：
 *
 *     d1-start(EVENT) → d2-battle1(BATTLE) → d2-choice1(CHOICE) → d3-battle2(BATTLE)
 *       → d4-durability(DURABILITY) ─┬─ repair  → d5-tend(EVENT) ────┐
 *                                    └─ upgrade → d5-choice2(CHOICE) ←┘ ← 两条分支在此汇合
 *                                      → d6-battle3(BATTLE) → d7-final(FINAL)
 *                                      → RUN COMPLETE / RUN FAILED
 *
 *   - 状态里唯一的进度锚点 = **`nodeId`**（当前已呈现的脚本节点）；推进只走
 *     `next` / `branch`，DAY 与叙事文本全部来自节点
 *     ⇒ 页面里**没有** `if (day === X)` 这类散落分支；
 *   - 呈现一个节点的节拍 = 「若 DAY 变化则追加 `DAY n` 行」+ 该节点的 `beat` 叙事，
 *     然后按节点类型决定落在哪个 phase：
 *       EVENT → `IDLE`（内容就是节拍本身，再按一次就推进）
 *       BATTLE / FINAL → `IDLE`（按一次进 `EVENT` 遭遇叙事，再按一次开打）
 *       CHOICE / DURABILITY → 直接进入对应浮层 phase（选择才是内容）
 *   - 战斗出口（`finishRunBattle`）按**节点类型**分岔：FINAL → `COMPLETE`（RUN COMPLETE），
 *     其余 → `RESULT`（战报 + 提示接下来是什么）。
 *
 * ## 四条贯穿规则（R1 起冻结，本 Queue 未改）
 *
 *   1) **单一耐久贯穿整个 Run**：`runCarriedPlayerHp` 是唯一的耐久传递口径，
 *      `null` 只表示「本次遭遇还没打过任何已结束的战斗」→ 第一场满耐久开幕；
 *   2) **`HP <= 0` = 本局立即失败**：`finishRunBattle` 是唯一战斗出口，统一检查真实 HP
 *      → 直接 `FAILED`（终态，**不经过 RESULT**，结构上不可能再走 RESULT→CHOICE）；
 *   3) `FAILED` / `COMPLETE` 两个终态**唯一**动作 = `createRunPageState()`（全新 Run）
 *      → 不存在「继续当前 Run」这条边，「隐式满血」无处可发生；
 *   4) 冒险记录是**玩家叙事**（无 `[系统]` / `[事件]` 前缀、无 Runtime 枚举、无逐帧伤害），
 *      `kind` 只用于渲染分级。
 *
 * ## PRP-RUN-02 必改 3：耐久事件（维修 vs 继续改装）
 *
 *   `DURABILITY` 是本 Queue 新增的**唯一**决策点，只做一件事：
 *   让「现在这点耐久」改变玩家的下一步选择。
 *
 *     A｜维修       → 恢复一段明确耐久（沿用 `EMERGENCY_REPAIR_FRACTION`，不新造数值）
 *                     → **不获得这一次额外改装**（当日走 `d5-tend` 的焊车叙事）
 *     B｜继续改装   → 不回耐久 → 直接进入**现有条件池**的第二次三选一
 *
 *   ⚠️ PRP-RUN-02-R1（真人验收修正）：`d4-durability` 与 `d5-choice2` 是**两个独立节点** ——
 *      **两条分支都会**到达 DAY 5 的第二次条件三选一；维修的机会成本只是「这一次额外改装」，
 *      不是「整局第二层 Build」。第一层在任何分支下都不被清除，第二层也不被阻止。
 *      ⇒ 本文件的推进逻辑**不含任何分支特判**：repair / upgrade 都只把状态推进到
 *        `node.branch[choice]`，之后按脚本自己的 `next` 继续（修正全部落在 `runScript.ts` 的数据里）。
 *
 *   没有货币、没有新资源；两者的文案与因果都在 `runScript.ts`（数据，不在 UI 里散落）。
 *
 * ## 本 Queue 明确不做
 *
 *   - 不做正式随机生成 / 随机权重 / 稀有度（固定脚本）；
 *   - 不做永久奖励 / 经济 / 存档 / 下一局系统（M2 再验）；
 *   - 不新增第一层强化、不新增联动（沿用既有 Build 池）。
 */

import { EMERGENCY_REPAIR_FRACTION, RUN_MODIFIERS, runLayer2PoolDefs, runModifierById, type RunModifierId } from './runModifiers';
import {
  RUN_DURABILITY_EVENT,
  RUN_SCRIPT_FIRST_ID,
  RUN_TOTAL_BATTLES,
  RUN_TOTAL_CHOICES,
  RUN_TOTAL_DAYS,
  requireRunScriptNode,
  runScriptNode,
  type RunDurabilityChoiceId,
  type RunScriptNode,
} from './runScript';

/**
 * Run Page 的状态（也是唯一允许的状态集合）。
 *
 * `FAILED`（PRP-RUN-R1）= **失败终态**：某一场的真实 Player HP 归零。
 * `COMPLETE`（PRP-RUN-02）= **完成终态**：终局战斗结束后仍然存活 → RUN COMPLETE。
 * 两者的**唯一**出口都是「重新开始冒险」→ 全新 Run；没有「继续当前 Run」这条边。
 */
export type RunPhase = 'IDLE' | 'EVENT' | 'BATTLE' | 'RESULT' | 'CHOICE' | 'DURABILITY' | 'COMPLETE' | 'FAILED';
export const RUN_PHASES: readonly RunPhase[] = [
  'IDLE',
  'EVENT',
  'BATTLE',
  'RESULT',
  'CHOICE',
  'DURABILITY',
  'COMPLETE',
  'FAILED',
];

/**
 * 日志条目的语义角色（**仅供渲染分级**，不产生任何玩家可见前缀）。
 *   - day        = 「今日」分隔行（加粗高亮）
 *   - travel     = 行进中的氛围叙事
 *   - event      = 遭遇 / 敌情
 *   - result     = 战斗结果 / 机会
 *   - durability = 战车耐久
 *   - choice     = 玩家做出的选择
 */
export type RunLogKind = 'day' | 'travel' | 'event' | 'result' | 'durability' | 'choice';

export interface RunLogEntry {
  /** 单调递增序号（跨状态不重置 → 可用于证明日志「保持完整历史」）。 */
  readonly seq: number;
  readonly kind: RunLogKind;
  /** 玩家可见文本（自然语言，**不含任何方括号前缀**）。 */
  readonly text: string;
}

/** 日志上限（防止无限增长；正常一局远达不到）。 */
export const RUN_LOG_MAX = 240;

/**
 * 一张浮层卡片（本局强化 或 耐久事件选项）——两者共用同一套「图标 / 名称 / 一句结果」绘制。
 * `id` 是字符串：强化用 `RunModifierId`，耐久事件用 `repair` / `upgrade`。
 */
export interface RunOverlayOption {
  readonly id: string;
  readonly label: string;
  readonly note: string;
}

/** 一个强化选项（不随机、不进任何正式强化池）。 */
export interface RunChoiceOption extends RunOverlayOption {
  readonly id: RunModifierId;
}

/** 第一层三选一（固定演示选项）。 */
export const RUN_CHOICE_OPTIONS: readonly RunChoiceOption[] = RUN_MODIFIERS.map((m) => ({
  id: m.id,
  label: m.label,
  note: m.note,
}));

/** 把 `runModifiers` 的池定义转成状态机 / UI 用的选项数组。 */
function toOptions(defs: readonly { id: RunModifierId; label: string; note: string }[]): RunChoiceOption[] {
  return defs.map((m) => ({ id: m.id, label: m.label, note: m.note }));
}

/** 每个 BATTLE / FINAL 节点的真实敌情（展示名 + 真实 HP 上限）。 */
export interface RunEncounterInfo {
  readonly label: string;
  readonly hpMax: number;
}

/**
 * 本 Queue 的固定演示装载（唯一一套；Run Page 不接 Debug 选择项）。
 *
 * ⚠️ `encounters` 由**宿主**用正式链路解析（`runPageScene.runPageContext`）后按**节点 id**
 *    提供：状态机只做编排，不 import 任何战斗 / 物理模块（保持「纯状态机」）。
 */
export interface RunPageContext {
  /** 我方载具展示名（来自 F1 共享测试数据，不手写）。 */
  readonly vehicleLabel: string;
  /** 我方耐久上限（取自 F1 共享数据的真实 HP）。 */
  readonly playerHpMax: number;
  /** 每个 BATTLE / FINAL 节点的敌情（节点 id → 展示名 / 真实 HP 上限）。 */
  readonly encounters: Readonly<Record<string, RunEncounterInfo>>;
}

/**
 * BATTLE 状态（**全部字段都是真实战斗数据**，没有任何脚本插值）。
 *
 * ⚠️ 数值来源：`playerHpMax` = F1 共享测试数据（正式 registry 解析）；
 *   `enemyHpMax` = 本场 Encounter 的真实解析结果；
 *   `playerHp` / `enemyHp` / `steps` / `winner` / `endReason` = 正式战斗运行时实时回报。
 */
export interface RunBattleState {
  readonly enemyLabel: string;
  readonly playerHpMax: number;
  readonly playerHp: number;
  readonly enemyHpMax: number;
  readonly enemyHp: number;
  /** 已推进的**正式物理步数**（真实战斗推进，不是演示脚本步数）。 */
  readonly steps: number;
  /** 是否已结束（= 已进入 RESULT / COMPLETE / FAILED）。 */
  readonly done: boolean;
  /** 官方 `resolveBattleResult` 的胜负方（'A' = 玩家；未结束为 null）。 */
  readonly winner: string | null;
  /** 官方结束原因（'hp' / 'phase' 等；未结束为 null）。 */
  readonly endReason: string | null;
}

export interface RunPageState {
  readonly phase: RunPhase;
  /**
   * **当前已呈现的脚本节点 id** —— 本局唯一的进度锚点（推进只走 `next` / `branch`）。
   * `day` 与叙事文本都由它决定。
   */
  readonly nodeId: string;
  /** 当前 DAY（来自脚本节点；顶部 `DAY n / 7` 与进度节点都读它）。 */
  readonly day: number;
  readonly dayTotal: number;
  /**
   * **本局 Build**（= 已获得的强化，按选择顺序；顶部图标来源，最多两层）。
   *
   * ⚠️ 这是**本局临时状态**：只活在这次 Run 的内存里 ——
   * 不写 Garage、不改星级、不动正式 content；`createRunPageState()` 新建即回到空数组。
   * 也是「第一层选择决定第二层池」与「下一场战斗注入什么」的**唯一来源**。
   */
  readonly buffs: readonly RunChoiceOption[];
  /**
   * 本局累计的**额外耐久**（紧急维修 + 耐久事件「维修」）。
   *
   * ⚠️ 刻意**不改写上一场的战斗记录** `battle.playerHp`（那是真实结果，不该被改）；
   * 补偿单独记录，注入下一场时叠加在真实剩余耐久之上（且不超过上限）。
   */
  readonly repairBonus: number;
  /** 本局**已打完**的真实战斗场数（0..4；诊断用，进度由 `nodeId` 决定）。 */
  readonly battlesCompleted: number;
  /** 冒险日志（只追加、不重排；选择强化不会清空历史）。 */
  readonly log: readonly RunLogEntry[];
  /** 当前战斗（仅 BATTLE / RESULT / COMPLETE / FAILED 非空）。 */
  readonly battle: RunBattleState | null;
  /** 耐久事件的裁决结果（`null` = 还没做过这个决定）。 */
  readonly durability: RunDurabilityChoiceId | null;
  /** 主动作按钮被按下的累计次数（诊断 / 验收用）。 */
  readonly actionCount: number;
  /** 状态切换次数（本页面内发生，永不涉及跳转）。 */
  readonly transitions: number;
  /** 状态轨迹（含初始 IDLE）—— 证明「八状态在同一个页面里切换」。 */
  readonly phaseTrail: readonly RunPhase[];
  /** 每次变更 +1（渲染与测试共用的稳定版本号；同值操作为 no-op 不递增）。 */
  readonly revision: number;
}

/* --------------------------------------------------------------- 构造 */

function pushLog(
  log: readonly RunLogEntry[],
  kind: RunLogKind,
  text: string,
): readonly RunLogEntry[] {
  const next = [...log, { seq: log.length === 0 ? 1 : log[log.length - 1].seq + 1, kind, text }];
  return next.length > RUN_LOG_MAX ? next.slice(next.length - RUN_LOG_MAX) : next;
}

function pushLogs(
  log: readonly RunLogEntry[],
  entries: readonly { kind: RunLogKind; text: string }[],
): readonly RunLogEntry[] {
  let out = log;
  for (const e of entries) out = pushLog(out, e.kind, e.text);
  return out;
}

function next(s: RunPageState, patch: Partial<RunPageState>): RunPageState {
  return { ...s, ...patch, revision: s.revision + 1 };
}

/** 切到新 phase（记录轨迹 + 计数，这是「同一页面多状态」的最小证据）。 */
function goPhase(s: RunPageState, phase: RunPhase, patch: Partial<RunPageState>): RunPageState {
  return next(s, {
    ...patch,
    phase,
    transitions: s.transitions + 1,
    phaseTrail: [...s.phaseTrail, phase],
  });
}

/** 单局总天数 / 总战斗数 / 总选择次数 —— 唯一来源是 Run Script。 */
export const RUN_DAYS_TOTAL = RUN_TOTAL_DAYS;
export const RUN_BATTLES_TOTAL = RUN_TOTAL_BATTLES;
/** 一局最多两次强化选择（第一层 + 第二层条件池）。 */
export const RUN_MAX_CHOICES = RUN_TOTAL_CHOICES;

/** 终态动作文案（点击 = 新开一个干净 Run）。 */
export const RUN_RESTART_LABEL = '重新开始冒险';
/** RUN COMPLETE 的动作文案（同样开新一局；本阶段不接永久奖励）。 */
export const RUN_COMPLETE_LABEL = '完成本次冒险';

/** 把脚本文本里的占位符换成真实展示名（`{vehicle}` / `{enemy}`）。 */
function subst(text: string, ctx: RunPageContext, node: RunScriptNode): string {
  const enemy = node.encounterId ? (ctx.encounters[node.id]?.label ?? '对手') : '';
  return text.replace(/\{vehicle\}/g, ctx.vehicleLabel).replace(/\{enemy\}/g, enemy);
}

/** 一个节点**落在哪个 phase**（呈现时用；也是初始状态的 phase 来源）。 */
function phaseForNode(kind: RunScriptNode['kind']): RunPhase {
  if (kind === 'CHOICE') return 'CHOICE';
  if (kind === 'DURABILITY') return 'DURABILITY';
  return 'IDLE';
}

/**
 * **呈现一个脚本节点**（本状态机的唯一推进动作）。
 *
 *   - DAY 变化 → 追加 `DAY n` 行；再追加节点的 `beat` 叙事（占位符已替换）；
 *   - 落在哪个 phase 由节点类型决定：
 *       EVENT → IDLE（内容即节拍；再按一次推进）
 *       BATTLE / FINAL → IDLE（按一次进 EVENT 遭遇，再按一次开打）
 *       CHOICE / DURABILITY → 直接开浮层（选择本身就是内容）
 */
function presentNode(s: RunPageState, nodeId: string, ctx: RunPageContext): RunPageState {
  const node = requireRunScriptNode(nodeId);
  const entries: { kind: RunLogKind; text: string }[] = [];
  if (node.day !== s.day) entries.push({ kind: 'day', text: `DAY ${node.day}` });
  for (const line of node.beat) entries.push({ kind: 'travel', text: subst(line, ctx, node) });
  return goPhase(next(s, { nodeId, day: node.day, log: pushLogs(s.log, entries) }), phaseForNode(node.kind), {});
}

/**
 * 初始状态（= Reset 后的 fresh 状态）：**呈现脚本第一个节点**（DAY 1 的冒险开场）。
 *
 * ⚠️ 构造不走 `goPhase` —— fresh 状态必须保持既有契约：`phaseTrail = [初始 phase]` /
 *    `transitions = 0` / `revision = 0` / `actionCount = 0`（「还没发生过任何切换」）。
 */
export function createRunPageState(ctx: RunPageContext): RunPageState {
  const first = requireRunScriptNode(RUN_SCRIPT_FIRST_ID);
  const entries: { kind: RunLogKind; text: string }[] = [{ kind: 'day', text: `DAY ${first.day}` }];
  for (const line of first.beat) entries.push({ kind: 'travel', text: subst(line, ctx, first) });
  const phase = phaseForNode(first.kind);
  return {
    phase,
    nodeId: first.id,
    day: first.day,
    dayTotal: RUN_TOTAL_DAYS,
    buffs: [],
    repairBonus: 0,
    battlesCompleted: 0,
    log: pushLogs([], entries),
    battle: null,
    durability: null,
    actionCount: 0,
    transitions: 0,
    phaseTrail: [phase],
    revision: 0,
  };
}

/* --------------------------------------------------------------- 查询 */

/**
 * 底部主动作按钮的文案（每个状态一个，永远只有一个主动作）。
 *
 * 两个终态（失败 / 完成）都只能「重新开始 / 完成」→ 由 `runActionLabel` 统一分派。
 * `DURABILITY` 没有主动作（必须点卡片），因此它不可用（见 `runActionEnabled`）。
 */
export const RUN_ACTION_LABEL: Record<RunPhase, string> = {
  IDLE: '继续',
  EVENT: '遭遇敌人',
  BATTLE: '战斗中',
  RESULT: '继续',
  CHOICE: '选择一个强化',
  DURABILITY: '做个决定',
  COMPLETE: RUN_COMPLETE_LABEL,
  FAILED: RUN_RESTART_LABEL,
};

/** 当前脚本节点（状态机的进度锚点；未知 id 会抛错，绝不静默回退）。 */
export function runCurrentNode(s: RunPageState): RunScriptNode {
  return requireRunScriptNode(s.nodeId);
}

/** 本局是否已**完成**（终局战斗打完且仍然存活 → RUN COMPLETE 终态）。 */
export function runComplete(s: RunPageState): boolean {
  return s.phase === 'COMPLETE';
}

/** 本局是否已**失败**（某场真实 Player HP 归零 → 失败终态）。 */
export function runFailed(s: RunPageState): boolean {
  return s.phase === 'FAILED';
}

/**
 * 按下的这一下会不会**开一个全新 Run** —— 「继续当前 Run」与「重新开始」的**唯一可观测判据**：
 *   - `true`  → 两个终态（`FAILED` / `COMPLETE`）：点击 = `createRunPageState()`
 *               → 满耐久 / DAY 回到 1 / Build 清空；
 *   - `false` → 继续当前 Run（RESULT → 下一个节点 / EVENT → 开打 / IDLE → 推进节点）。
 */
export function runStartsNewRun(s: RunPageState): boolean {
  return s.phase === 'FAILED' || s.phase === 'COMPLETE';
}

export function runActionLabel(s: RunPageState): string {
  if (s.phase === 'FAILED') return RUN_RESTART_LABEL;
  if (s.phase === 'COMPLETE') return RUN_COMPLETE_LABEL;
  return RUN_ACTION_LABEL[s.phase];
}

/**
 * 主动作是否可用。
 *   - `BATTLE`（自动推进中）/ `CHOICE` / `DURABILITY`（必须点卡片）→ 不可用（禁止误触推进）；
 *   - 两个终态**可用**（它们的主动作就是「重新开始 / 完成」）。
 */
export function runActionEnabled(s: RunPageState): boolean {
  return s.phase === 'IDLE' || s.phase === 'EVENT' || s.phase === 'RESULT' || s.phase === 'COMPLETE' || s.phase === 'FAILED';
}

/** 三选一浮层是否可见（= phase 为 CHOICE）。 */
export function runChoiceOpen(s: RunPageState): boolean {
  return s.phase === 'CHOICE';
}

/** 耐久取舍浮层是否可见（= phase 为 DURABILITY）。 */
export function runDurabilityOpen(s: RunPageState): boolean {
  return s.phase === 'DURABILITY';
}

/** 当前是否有**任何**浮层打开（CHOICE / DURABILITY）—— 绘制与账本共用的唯一判据。 */
export function runOverlayOpen(s: RunPageState): boolean {
  return runChoiceOpen(s) || runDurabilityOpen(s);
}

/** 本局 Build 的 id 序列（有序 = 选择顺序）。 */
export function runBuildIds(s: RunPageState): readonly RunModifierId[] {
  return s.buffs.map((b) => b.id);
}

/**
 * **当前应该出现的候选池**（结构规则，不随机）。
 *
 *   - 还没选过（`buffs.length === 0`）→ 第一层固定三选一；
 *   - 已选一层（`buffs.length === 1`）→ **第二层条件池**（由第一层选择决定）；
 *   - 已选满（`RUN_MAX_CHOICES`）→ 空。
 *
 * ⚠️ 与 phase 无关（这是**结构规则**，不是「屏幕上现在有什么」）；
 *    「屏幕上现在有什么」读 `runOverlayCards`。
 */
export function runChoicePool(s: RunPageState): readonly RunChoiceOption[] {
  if (s.buffs.length === 0) return RUN_CHOICE_OPTIONS;
  if (s.buffs.length === 1) return toOptions(runLayer2PoolDefs(s.buffs[0].id));
  return [];
}

/** 某个强化是否属于「当前候选池」（`chooseRunBuff` 的准入判据）。 */
export function runChoicePoolHas(s: RunPageState, optionId: string): boolean {
  return runChoicePool(s).some((o) => o.id === optionId);
}

/** 耐久事件的两个选项（来自 Run Script 数据）。 */
export function runDurabilityOptions(): readonly RunOverlayOption[] {
  return RUN_DURABILITY_EVENT.options.map((o) => ({ id: o.id, label: o.label, note: o.note }));
}

/** 耐久事件的浮层标题。 */
export function runDurabilityTitle(): string {
  return RUN_DURABILITY_EVENT.title;
}

/**
 * **当前浮层上真正画出来的卡片**（空数组 = 没有浮层）。
 * 绘制、命中区、探针三处都读它 → 结构上不可能出现「画的是池 A、点的是池 B」。
 */
export function runOverlayCards(s: RunPageState): readonly RunOverlayOption[] {
  if (runChoiceOpen(s)) return runChoicePool(s);
  if (runDurabilityOpen(s)) return runDurabilityOptions();
  return [];
}

/**
 * 跨战斗耐久：**下一场开局的真实耐久**（本局**唯一**的耐久传递口径）。
 *
 * ⚠️ `null` 只有**一个**含义：「本次遭遇还没打过任何**已结束**的战斗」→ 本局第一场，
 *    按满耐久开幕。上一场结束且剩 0 且无补偿（被打退）→ 返回 **`0`**（如实回报，
 *    绝不伪装成满耐久）。真正阻止「死亡后继续」的是 `finishRunBattle` 直接进 `FAILED`。
 *
 * ⚠️ **可读窗口（PRP-RUN-02 实测抓到的陷阱，勿踩）**：
 *    只在「上一场已结束（`RESULT` / 浮层 / `IDLE` / `EVENT`）、本场还没建立」这段窗口里读它，
 *    因为它读的是 `s.battle` —— 而 `EVENT → BATTLE` 的那一刻，`s.battle` 会被**本场战斗**
 *    替换（`done === false`）→ 本函数返回 `null`。
 *    因此：
 *      - 宿主**必须**在 `EVENT` 那一刻取它（`beginBattle` 就是唯一这些时机）；
 *      - 一旦进了 `BATTLE`，「本场开局耐久」的权威来源是 `RunBattleState.playerHp`
 *        （状态机在 `EVENT → BATTLE` 时已经写入同一个数，此后由 `syncRunBattle` 更新为实时值）。
 *    任何「进 BATTLE 之后再读 carry、读不到就回退满耐久」的写法都会**静默丢掉跨战斗耐久**。
 */
export function runCarriedPlayerHp(s: RunPageState): number | null {
  if (!s.battle || !s.battle.done) return null;
  const carried = Math.max(0, s.battle.playerHp) + Math.max(0, s.repairBonus);
  return Math.min(s.battle.playerHpMax, carried);
}

/** 当前应展示的日志行（底部对齐：新行从下方顶入）。 */
export function visibleRunLog(s: RunPageState, maxLines: number): readonly RunLogEntry[] {
  if (maxLines <= 0) return [];
  return s.log.length <= maxLines ? s.log : s.log.slice(s.log.length - maxLines);
}

/**
 * 日志行的玩家可见文本。
 * ⚠️ 不拼接任何 `[系统]` / `[事件]` 之类前缀 —— 玩家读到的是「这一局发生了什么」。
 * 保留函数（而不是让调用方直接读 `.text`）是为了让「文本的唯一格式化点」继续存在。
 */
export function formatRunLog(e: RunLogEntry): string {
  return e.text;
}

/* --------------------------------------------------------------- 动作 */

/**
 * 按下底部唯一主动作（**按当前脚本节点分派**）：
 *
 *   IDLE   → 节点是 BATTLE / FINAL → EVENT（追加敌情叙事，再按一次开打）
 *          → 节点是 CHOICE / DURABILITY → 打开对应浮层
 *          → 节点是 EVENT（内容就是它的节拍）→ 推进到 `next` 节点
 *   EVENT  → BATTLE（建立本场真实战斗；此后由物理自动推进）
 *   RESULT → 推进到 `next` 节点（战报之后是选择 / 耐久事件 / 下一场）
 *   终态   → 全新 Run（`createRunPageState`）
 *   BATTLE / CHOICE / DURABILITY → no-op（同引用）
 */
export function pressRunAction(s: RunPageState, ctx: RunPageContext): RunPageState {
  // 终态：本局已结束，点击 = 开一个干净新 Run（不是「恢复耐久继续」）。
  if (runStartsNewRun(s)) return createRunPageState(ctx);

  if (s.phase === 'IDLE') {
    const node = runCurrentNode(s);
    if (node.kind === 'BATTLE' || node.kind === 'FINAL') {
      const entries = (node.encounter ?? []).map((line) => ({
        kind: 'event' as RunLogKind,
        text: subst(line, ctx, node),
      }));
      return goPhase(next(s, { actionCount: s.actionCount + 1 }), 'EVENT', { log: pushLogs(s.log, entries) });
    }
    if (node.kind === 'CHOICE' || node.kind === 'DURABILITY') {
      return goPhase(next(s, { actionCount: s.actionCount + 1 }), node.kind, {});
    }
    // EVENT 节点：节拍已经在呈现时写进记录 → 这一按推进到下一个节点
    if (node.next) return presentNode(next(s, { actionCount: s.actionCount + 1 }), node.next, ctx);
    return s;
  }

  if (s.phase === 'EVENT') {
    const node = runCurrentNode(s);
    const info = ctx.encounters[node.id];
    // 跨战斗耐久：上一场真实剩余 HP（+ 维修补偿）→ 下一场继续使用，**不自动满血**。
    const carried = runCarriedPlayerHp(s);
    const battle: RunBattleState = {
      enemyLabel: info?.label ?? '对手',
      playerHpMax: ctx.playerHpMax,
      playerHp: carried ?? ctx.playerHpMax,
      enemyHpMax: info?.hpMax ?? 0,
      enemyHp: info?.hpMax ?? 0,
      steps: 0,
      done: false,
      winner: null,
      endReason: null,
    };
    return goPhase(next(s, { actionCount: s.actionCount + 1 }), 'BATTLE', { battle });
  }

  if (s.phase === 'RESULT') {
    const node = runCurrentNode(s);
    if (node.next) return presentNode(next(s, { actionCount: s.actionCount + 1 }), node.next, ctx);
    return s;
  }

  return s; // BATTLE（自动推进中）/ CHOICE / DURABILITY（等玩家点卡片）→ 不接受主动作
}

/** 真实战斗的帧同步数据（全部来自正式运行时，无一处由本文件计算）。 */
export interface RunBattleSync {
  readonly playerHp: number;
  readonly enemyHp: number;
  readonly steps: number;
}

/**
 * 同步真实战斗数值（只接受 BATTLE）。**日志在此阶段零追加**——
 * 逐帧伤害明细一律不写日志，只在结束时一次性追加结果。
 * 数值未变 → 返回同引用（no-op，避免无谓重绘）。
 */
export function syncRunBattle(s: RunPageState, sync: RunBattleSync): RunPageState {
  if (s.phase !== 'BATTLE' || !s.battle) return s;
  const b = s.battle;
  if (b.playerHp === sync.playerHp && b.enemyHp === sync.enemyHp && b.steps === sync.steps) return s;
  return next(s, {
    battle: { ...b, playerHp: sync.playerHp, enemyHp: sync.enemyHp, steps: sync.steps },
  });
}

/** 战斗结束回报（官方 `resolveBattleResult` 的原始输出 + 最终 HP）。 */
export interface RunBattleOutcome {
  readonly winner: string | null;
  readonly endReason: string | null;
  readonly playerHp: number;
  readonly enemyHp: number;
  readonly steps: number;
}

/**
 * 战斗结束 → 出口一次性判定（由宿主在**官方 result 出现的那一刻**调用一次）。
 *
 * ⚠️ 这里是**唯一**的战斗出口，因此「真实 Player HP 检查」也**只在这里**做一次 ——
 *    所有场次走同一条判据，不存在「某一场忘了检查」的可能。
 *
 *   - `playerHp <= 0` → **`FAILED`**（失败终态）：
 *       日志只有两行（失败叙事 + 真实耐久），**没有**任何「继续」引导，
 *       结构上也确实进不了 CHOICE / 下一个节点；
 *   - 当前节点是 `FINAL` → **`COMPLETE`**（RUN COMPLETE）：
 *       这一场的战报 + 收束叙事（**不再引导下一次改装**）；
 *   - 其余 → `RESULT`（战报）：胜负 + 真实耐久 + **该节点自己的**下一段提示
 *     （提示文案来自脚本节点的 `after`，因此页面上没有散落的 `if (day === X)`）。
 */
export function finishRunBattle(s: RunPageState, outcome: RunBattleOutcome): RunPageState {
  if (s.phase !== 'BATTLE' || !s.battle) return s;
  const b: RunBattleState = {
    ...s.battle,
    playerHp: outcome.playerHp,
    enemyHp: outcome.enemyHp,
    steps: outcome.steps,
    done: true,
    winner: outcome.winner,
    endReason: outcome.endReason,
  };
  const battlesCompleted = s.battlesCompleted + 1;
  const won = outcome.winner === 'A';
  const outcomeLine = won ? '战斗胜利。' : '战车被打退，你撤出了战场。';

  // ① 死亡 = 本局立即失败。⚠️ 判据取**真实 HP**（不是 winner / endReason）：
  //    「单一耐久贯穿整个 Run」这条冻结规则的直接转写。
  if (outcome.playerHp <= 0) {
    return goPhase(next(s, { battle: b, battlesCompleted }), 'FAILED', {
      log: pushLogs(s.log, [
        { kind: 'result', text: `战车耐久耗尽，DAY ${s.day} 的冒险到此结束。` },
        { kind: 'durability', text: `战车耐久剩余 ${durabilityPercent(b)}%。` },
      ]),
    });
  }

  // ② 终局战斗结束且仍然存活 → RUN COMPLETE（本阶段不接永久奖励，M2 再验下一局期待）。
  if (runCurrentNode(s).kind === 'FINAL') {
    return goPhase(next(s, { battle: b, battlesCompleted }), 'COMPLETE', {
      log: pushLogs(s.log, [
        { kind: 'result', text: outcomeLine },
        { kind: 'durability', text: `战车耐久剩余 ${durabilityPercent(b)}%。` },
        { kind: 'result', text: `你在第七天走完了这趟路。` },
        { kind: 'result', text: '这次冒险到此结束。' },
      ]),
    });
  }

  // ③ 普通战斗 → 战报 + 脚本节点自带的「接下来是什么」。
  const after = (runCurrentNode(s).after ?? []).map((text) => ({ kind: 'result' as RunLogKind, text }));
  return goPhase(next(s, { battle: b, battlesCompleted }), 'RESULT', {
    log: pushLogs(s.log, [
      { kind: 'result', text: outcomeLine },
      { kind: 'durability', text: `战车耐久剩余 ${durabilityPercent(b)}%。` },
      ...after,
    ]),
  });
}

/** 战斗结束时的耐久百分比（0..100，整数；真实 HP 比例，不是平衡数值）。 */
export function durabilityPercent(b: RunBattleState): number {
  if (b.playerHpMax <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((b.playerHp / b.playerHpMax) * 100)));
}

/**
 * 在 CHOICE 浮层里选中一个强化：
 *   - 记录到**本局 Build** `buffs`（下一场战斗会真正注入；顶部出现对应图标）；
 *   - 浮层关闭 → **按脚本推进到下一个节点**（节拍叙事随之写入记录；DAY 可能前进）；
 *   - 日志追加「你为大炮装上了 XXX。」；
 *   - 紧急维修额外累计耐久补偿（不改写上一场的真实战斗记录）。
 *
 * 准入（结构性约束，不靠运行期扫描）：
 *   1) 必须是 CHOICE；2) 选择次数 < `RUN_MAX_CHOICES`；3) 选项必须在**当前候选池**里。
 * 不满足 → no-op（同引用）。
 */
export function chooseRunBuff(s: RunPageState, optionId: string, ctx: RunPageContext): RunPageState {
  if (!runChoiceOpen(s)) return s;
  if (s.buffs.length >= RUN_MAX_CHOICES) return s;
  if (!runChoicePoolHas(s, optionId)) return s;
  const mod = runModifierById(optionId);
  if (!mod) return s;

  const opt: RunChoiceOption = { id: mod.id, label: mod.label, note: mod.note };
  let repairBonus = s.repairBonus;
  const logs: { kind: RunLogKind; text: string }[] = [{ kind: 'choice', text: mod.logText }];
  if (mod.id === 'emergencyRepair' && s.battle) {
    const heal = Math.round(s.battle.playerHpMax * EMERGENCY_REPAIR_FRACTION);
    repairBonus += heal;
    logs.push({ kind: 'durability', text: `车体修补完成，恢复了 ${heal} 点耐久。` });
  }
  const advanced = next(s, { buffs: [...s.buffs, opt], repairBonus, log: pushLogs(s.log, logs) });
  const node = runCurrentNode(s);
  return node.next ? presentNode(advanced, node.next, ctx) : advanced;
}

/**
 * 耐久事件的裁决（本 Queue 唯一的耐久取舍点）。
 *
 *   `repair`  → 按 `EMERGENCY_REPAIR_FRACTION` 修回一段耐久（不超过上限，**如实记账**），
 *               然后走**维修分支**：中经「把这一天用在修车上」的当日叙事节点（`d5-tend`），
 *               **再继续**进入 DAY 5 的第二次条件三选一；
 *   `upgrade` → 不回耐久，走**改装分支**：立刻进入第二层条件池的三选一。
 *
 * ⚠️ PRP-RUN-02-R1：两条分支**都会**到达 `d5-choice2`（第二层）。本函数不做任何分支特判 ——
 *    只把状态推进到 `node.branch[choice]`，后续由脚本自己的 `next` 决定。
 *
 * ⚠️ 修复量按「当前真实剩余耐久 + 本局累计补偿」计算缺口，避免日志报出一个实际没吃满的数字。
 */
export function resolveDurability(
  s: RunPageState,
  choice: RunDurabilityChoiceId,
  ctx: RunPageContext,
): RunPageState {
  if (!runDurabilityOpen(s)) return s;
  const node = runCurrentNode(s);
  if (!node.branch) return s;

  let repairBonus = s.repairBonus;
  const logs: { kind: RunLogKind; text: string }[] = [];
  if (choice === 'repair') {
    const maxHp = s.battle?.playerHpMax ?? ctx.playerHpMax;
    const current = runCarriedPlayerHp(s) ?? maxHp;
    const want = Math.round(maxHp * EMERGENCY_REPAIR_FRACTION);
    const applied = Math.max(0, Math.min(want, maxHp - current));
    repairBonus += applied;
    logs.push({ kind: 'durability', text: RUN_DURABILITY_EVENT.repairLog });
    logs.push({ kind: 'durability', text: `车体修补完成，恢复了 ${applied} 点耐久。` });
  } else {
    logs.push({ kind: 'choice', text: RUN_DURABILITY_EVENT.upgradeLog });
  }

  const advanced = next(s, { durability: choice, repairBonus, log: pushLogs(s.log, logs) });
  return presentNode(advanced, node.branch[choice], ctx);
}

/** 本局当前节点的类型（诊断 / 测试用）。 */
export function runNodeKind(s: RunPageState): string {
  return runScriptNode(s.nodeId)?.kind ?? 'UNKNOWN';
}
