/**
 * PRP-F0-RUN-PAGE-SHELL｜PRP-R3-CAPYBARA-UI-HIERARCHY-REBUILD
 * ｜PRP-BUILD-01-TWO-STEP-CANNON-BUILD
 * Run Page 纯状态机（无 DOM / 无 Canvas / 无物理 / 无平台依赖 / 无副作用）。
 *
 * 产品基线：整个单局是**一个持续存在的竖屏 Adventure Run Page**，
 * 战斗 / 事件 / 强化 / 结果是**同一个页面的五个状态**，不存在页面跳转：
 *
 *   IDLE ──继续──▶ EVENT ──遭遇敌人──▶ BATTLE ──自动结束──▶ RESULT ──继续──▶ CHOICE ──选择──▶ IDLE
 *
 * ## 当前原型流程（PRP-BUILD-01：两层 Build 的单变量实验）
 *
 *     DAY 3 基础战斗
 *       → RESULT → CHOICE【第一层三选一：重型弹头 / 双联炮 / 快速装填】
 *       → DAY 4 强化后战斗（只带第一层）
 *       → RESULT → CHOICE【第二层条件池：由第一层选择决定出现哪三项】
 *       → DAY 5 最终战斗（**同时携带两层**）
 *       → RESULT → **验证结束**（主动作 =「重新开始验证」→ 干净新 Run）
 *
 * 结构上的硬约束（不依赖运行期检查）：
 *   - `RUN_MAX_BATTLES = 3` / `RUN_MAX_CHOICES = 2` —— 打完第三场即 `runVerificationComplete`，
 *     主动作变成「重新开始验证」→ 点击即 `createRunPageState()` 全新 Run；
 *   - 同一局**最多两次**强化选择，且第二次只能从**第一层决定的那个条件池**里选
 *     （`chooseRunBuff` 只接受 `runChoicePool(s)` 里的 id）→ 结构上不可能出现
 *     「DAY 8/7」「多 Buff 累计」「重复叠同一强化」「池外选项」。
 *
 * ⚠️ 必改 1：**第二次选择必须读取当前 Build** —— 第二层的候选来自
 *   `runModifiers.RUN_LAYER2_POOLS[第一层选择]`，不是同一套通用三选一。
 *
 * ⚠️ PRP-R3 必改 3：冒险记录**从 Console 改成玩家叙事** ——
 *   不再有 `[系统]` / `[事件]` / `[战斗]` / `[结果]` / `[耐久]` / `[强化]` 之类前缀，
 *   也没有任何 Runtime 状态 / 内部枚举 / 逐帧伤害；`kind` 只用于**渲染样式**
 *   （DAY 行加粗、结果行强调），不进入玩家可见文本。
 *
 * ⚠️ PRP-F1-PORTRAIT-PLANCK-BATTLE-INTEGRATION：
 *   本文件**不包含任何战斗推进脚本**。BATTLE 由 `RunBattleRuntime`（正式
 *   `PlanckBattleOrchestrator`）以**真实物理**推进，本文件只接收三件事：
 *     1) `syncRunBattle`   —— 每帧同步真实 HP / 真实物理步数（不写日志、不换状态）；
 *     2) `finishRunBattle` —— 官方 `resolveBattleResult` 出结果的**那一刻**一次性写 RESULT；
 *     3) `durabilityPercent` —— 真实耐久百分比（供叙事文本）。
 *   即：**状态机只负责「生命周期接线 + 结果回填」**，不再持有任何战斗语义。
 *
 * 本 Queue 明确不做（见 Queue 禁止项）：
 *   - 不做正式随机权重 / 稀有度 / Buff 升级等级；
 *   - 不做第四个第一层 Buff、不做 Body / Movement / Gadget 完整升级池；
 *   - 不做正式 7 天流程；不做永久奖励 / 经济 / 存档。
 */

import {
  EMERGENCY_REPAIR_FRACTION,
  RUN_MODIFIERS,
  runLayer2PoolDefs,
  runModifierById,
  type RunModifierId,
} from './runModifiers';

/** Run Page 的五个状态（也是唯一允许的状态集合）。 */
export type RunPhase = 'IDLE' | 'EVENT' | 'BATTLE' | 'RESULT' | 'CHOICE';
export const RUN_PHASES: readonly RunPhase[] = ['IDLE', 'EVENT', 'BATTLE', 'RESULT', 'CHOICE'];

/**
 * 日志条目的语义角色（**仅供渲染分级**，不产生任何玩家可见前缀）。
 *   - day        = 「今日」分隔行（加粗高亮）
 *   - travel     = 行进中的氛围叙事
 *   - event      = 遭遇 / 敌情
 *   - result     = 战斗结果 / 机会
 *   - durability = 战车耐久
 *   - choice     = 玩家做出的强化选择
 */
export type RunLogKind = 'day' | 'travel' | 'event' | 'result' | 'durability' | 'choice';

export interface RunLogEntry {
  /** 单调递增序号（跨状态不重置 → 可用于证明日志「保持完整历史」）。 */
  readonly seq: number;
  readonly kind: RunLogKind;
  /** 玩家可见文本（自然语言，**不含任何方括号前缀**）。 */
  readonly text: string;
}

/** 日志上限（防止无限增长；正常演示流程远达不到）。 */
export const RUN_LOG_MAX = 240;

/**
 * 一个强化选项（不随机、不进任何正式强化池）。
 * `note` = **一句结果**（玩家可读，不是开发占位说明 / 不是数值表）。
 *
 * ⚠️ 内容唯一来源 = `runModifiers`（含 overlay 数值与因果说明），本文件不重复定义。
 */
export interface RunChoiceOption {
  readonly id: RunModifierId;
  readonly label: string;
  readonly note: string;
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

/** 本 Queue 的演示装载（唯一一套；Run Page 不接 Debug 选择项）。 */
export interface RunPageContext {
  /** 我方载具展示名（来自 F1 共享测试数据，不手写）。 */
  readonly vehicleLabel: string;
  /** 遭遇的敌人展示名。 */
  readonly encounterLabel: string;
  /** 我方耐久上限（取自 F1 共享数据的真实 HP）。 */
  readonly playerHpMax: number;
  /** 敌方耐久上限（取自 F1 共享数据的真实 HP）。 */
  readonly enemyHpMax: number;
}

/**
 * BATTLE 状态（**全部字段都是真实战斗数据**，没有任何脚本插值）。
 *
 * ⚠️ 数值来源：`playerHpMax` / `enemyHpMax` = F1 共享测试数据（正式 registry 解析）；
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
  /** 是否已结束（= 已进入 RESULT）。 */
  readonly done: boolean;
  /** 官方 `resolveBattleResult` 的胜负方（'A' = 玩家；未结束为 null）。 */
  readonly winner: string | null;
  /** 官方结束原因（'hp' / 'phase' 等；未结束为 null）。 */
  readonly endReason: string | null;
}

export interface RunPageState {
  readonly phase: RunPhase;
  /** 本局进度占位：DAY 3 起（本 Queue 不做正式 Day 状态机，dayTotal 仍是占位 7）。 */
  readonly day: number;
  readonly dayTotal: number;
  /**
   * **本局 Build**（= 已获得的强化，按选择顺序；顶部图标来源，最多两项）。
   *
   * ⚠️ 这是**本局临时状态**：只活在这次 Run 的内存里 ——
   * 不写 Garage、不改星级、不动正式 content；`createRunPageState()` 新建即回到空数组。
   * 也是「第一层选择决定第二层池」与「下一场战斗注入什么」的**唯一来源**。
   */
  readonly buffs: readonly RunChoiceOption[];
  /**
   * 紧急维修累计的额外耐久（本局临时）。
   *
   * ⚠️ 刻意**不改写上一场的战斗记录** `battle.playerHp`（那是真实结果，不该被改）；
   * 维修补偿单独记录，注入下一场时叠加在真实剩余耐久之上（且不超过上限）。
   */
  readonly repairBonus: number;
  /**
   * 本局**已打完**的真实战斗场数（0/1/2/3）。
   *
   * - `0` = 还没打过（DAY 3 基础战斗前）；
   * - `1` = 只打完基础战斗 → RESULT 的主动作进 CHOICE（第一层三选一）；
   * - `2` = 强化后战斗也打完 → RESULT 的主动作进 CHOICE（**第二层条件池**）；
   * - `3` = 最终战斗打完 → **验证结束**（主动作变成「重新开始验证」）。
   */
  readonly battlesCompleted: number;
  /** 冒险日志（只追加、不重排；选择强化不会清空历史）。 */
  readonly log: readonly RunLogEntry[];
  /** 当前战斗（仅 BATTLE / RESULT 非空）。 */
  readonly battle: RunBattleState | null;
  /** 主动作按钮被按下的累计次数（诊断 / 验收用）。 */
  readonly actionCount: number;
  /** 状态切换次数（本页面内发生，永不涉及跳转）。 */
  readonly transitions: number;
  /** 状态轨迹（含初始 IDLE）—— 证明「五状态在同一个页面里切换」。 */
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

/** 切到新 phase（记录轨迹 + 计数，这是「同一页面五状态」的最小证据）。 */
function goPhase(s: RunPageState, phase: RunPhase, patch: Partial<RunPageState>): RunPageState {
  return next(s, {
    ...patch,
    phase,
    transitions: s.transitions + 1,
    phaseTrail: [...s.phaseTrail, phase],
  });
}

/** 本局进度占位（本 Queue 不做正式 Day 状态机）：DAY 3 起 / 共 7。 */
export const RUN_INITIAL_DAY = 3;
export const RUN_TOTAL_DAYS = 7;

/**
 * PRP-BUILD-01：一次验证 Run 固定打 **三场**真实战斗
 * （DAY 3 基础 → DAY 4 第一层强化 → DAY 5 两层 Build），打完即停。
 */
export const RUN_MAX_BATTLES = 3;

/**
 * PRP-BUILD-01：一次验证 Run 固定 **两次**选择（第一层 + 第二层条件池）。
 * 这是「一局只有两次强化、且第二次受第一次约束」的结构性上限。
 */
export const RUN_MAX_CHOICES = 2;

/** 终局 RESULT 的唯一主动作文案（点击 = 新开一个干净 Run）。 */
export const RUN_RESTART_LABEL = '重新开始验证';

/** 初始状态（= Reset 后的 fresh 状态；IDLE 且日志已可见）。 */
export function createRunPageState(ctx: RunPageContext): RunPageState {
  return {
    phase: 'IDLE',
    day: RUN_INITIAL_DAY,
    dayTotal: RUN_TOTAL_DAYS,
    buffs: [],
    repairBonus: 0,
    battlesCompleted: 0,
    log: pushLogs([], [
      { kind: 'day', text: `DAY ${RUN_INITIAL_DAY}` },
      { kind: 'travel', text: `你驾驶着${ctx.vehicleLabel}，在荒原上继续前进。` },
    ]),
    battle: null,
    actionCount: 0,
    transitions: 0,
    phaseTrail: ['IDLE'],
    revision: 0,
  };
}

/* --------------------------------------------------------------- 查询 */

/** 底部主动作按钮的文案（每个状态一个，永远只有一个主动作）。 */
export const RUN_ACTION_LABEL: Record<RunPhase, string> = {
  IDLE: '继续',
  EVENT: '遭遇敌人',
  BATTLE: '战斗中',
  RESULT: '继续',
  CHOICE: '选择一个强化',
};

/**
 * PRP-BUILD-01：本次验证是否已结束（= 三场真实战斗都打完）。
 * 终局 RESULT 不再提供「继续」→ 只有「重新开始验证」。
 */
export function runVerificationComplete(s: RunPageState): boolean {
  return s.battlesCompleted >= RUN_MAX_BATTLES;
}

export function runActionLabel(s: RunPageState): string {
  // 终局 RESULT 的主动作是「重新开始验证」（不再继续 Day / 不再进 CHOICE）。
  if (s.phase === 'RESULT' && runVerificationComplete(s)) return RUN_RESTART_LABEL;
  return RUN_ACTION_LABEL[s.phase];
}

/** BATTLE 期间主动作不可用（禁止误触推进）。 */
export function runActionEnabled(s: RunPageState): boolean {
  return s.phase === 'IDLE' || s.phase === 'EVENT' || s.phase === 'RESULT';
}

/** 三选一浮层是否可见（= phase 为 CHOICE，两者永不脱节）。 */
export function runChoiceOpen(s: RunPageState): boolean {
  return s.phase === 'CHOICE';
}

/** 本局 Build 的 id 序列（有序 = 选择顺序）。 */
export function runBuildIds(s: RunPageState): readonly RunModifierId[] {
  return s.buffs.map((b) => b.id);
}

/**
 * **当前应该出现的候选池**（必改 1 的核心）。
 *
 *   - 还没选过（`buffs.length === 0`）→ 第一层固定三选一；
 *   - 已选一层（`buffs.length === 1`）→ **第二层条件池**（由第一层选择决定）；
 *   - 已选满（`RUN_MAX_CHOICES`）→ 空（结构上不会再进 CHOICE）。
 *
 * 池内顺序固定为「强联动 / 安全通用 / 轻度转向」（必改 5 的取舍结构）。
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

/**
 * 跨战斗耐久（必改 4）：**下一场开局的真实耐久**。
 *
 * - 尚未打过任何战斗 / 上一场还没结束 → `null`（本次遭遇按满耐久开始）；
 * - 上一场结束且剩 HP > 0（或带紧急维修补偿）→ 返回「真实剩余 + 维修补偿」（上限截断）；
 * - 剩 0 且无补偿（被打退）→ `null`（0 HP 无耐久可续用；正常推进路径是存活）。
 */
export function runCarriedPlayerHp(s: RunPageState): number | null {
  if (!s.battle || !s.battle.done) return null;
  const carried = Math.max(0, s.battle.playerHp) + Math.max(0, s.repairBonus);
  if (carried <= 0) return null;
  return Math.min(s.battle.playerHpMax, carried);
}

/** 当前应展示的日志行（底部对齐：新行从下方顶入）。 */
export function visibleRunLog(s: RunPageState, maxLines: number): readonly RunLogEntry[] {
  if (maxLines <= 0) return [];
  return s.log.length <= maxLines ? s.log : s.log.slice(s.log.length - maxLines);
}

/**
 * 日志行的玩家可见文本。
 *
 * ⚠️ PRP-R3 必改 3：**不再拼接任何 `[系统]` / `[事件]` 之类前缀** ——
 * 玩家读到的是「这一局发生了什么」，不是程序执行记录。
 * 保留函数（而不是让调用方直接读 `.text`）是为了让「文本的唯一格式化点」继续存在，
 * 将来若需要玩家向修饰（例如 DAY 行、强调行）也只在这里发生。
 */
export function formatRunLog(e: RunLogEntry): string {
  return e.text;
}

/* --------------------------------------------------------------- 动作 */

/**
 * 按下底部唯一主动作：
 *   IDLE → EVENT   （日志追加 2 句自然语言敌情叙事）
 *   EVENT → BATTLE （建立演示战斗；此后自动推进。**入场不写日志**，保持记录稳定）
 *   RESULT → CHOICE（**还没打完三场时**：获得改装机会 —— 原页面保留、整体变暗、中央浮层）
 *   RESULT → 全新 Run（**第三场之后**：验证结束 → 主动作 =「重新开始验证」）
 *   BATTLE / CHOICE → no-op（同引用；BATTLE 由物理自动结束，CHOICE 只能点卡片）
 */
export function pressRunAction(s: RunPageState, ctx: RunPageContext): RunPageState {
  if (s.phase === 'IDLE') {
    return goPhase(
      next(s, { actionCount: s.actionCount + 1 }),
      'EVENT',
      {
        log: pushLogs(s.log, [
          { kind: 'event', text: '前方传来急促的引擎声。' },
          { kind: 'event', text: `你遭遇了${ctx.encounterLabel}。` },
        ]),
      },
    );
  }
  if (s.phase === 'EVENT') {
    // 跨战斗耐久（必改 4）：上一场剩余 HP（+ 维修补偿）→ 下一场继续使用，**不自动满血**。
    const carried = runCarriedPlayerHp(s);
    const battle: RunBattleState = {
      enemyLabel: ctx.encounterLabel,
      playerHpMax: ctx.playerHpMax,
      playerHp: carried ?? ctx.playerHpMax,
      enemyHpMax: ctx.enemyHpMax,
      enemyHp: ctx.enemyHpMax,
      steps: 0,
      done: false,
      winner: null,
      endReason: null,
    };
    return goPhase(next(s, { actionCount: s.actionCount + 1 }), 'BATTLE', { battle });
  }
  if (s.phase === 'RESULT') {
    // 三场都打完 → 不能继续 Day / 不能进 CHOICE；点击即**新开一个干净 Run**
    // （DAY 回到 3 / Build 清零 / 耐久回到初始 → 单变量验证的下一轮）。
    if (runVerificationComplete(s)) return createRunPageState(ctx);
    return goPhase(next(s, { actionCount: s.actionCount + 1 }), 'CHOICE', {});
  }
  return s; // BATTLE（自动推进中）/ CHOICE（等选卡）→ 不接受主动作
}

/** 真实战斗的帧同步数据（全部来自正式运行时，无一处由本文件计算）。 */
export interface RunBattleSync {
  readonly playerHp: number;
  readonly enemyHp: number;
  readonly steps: number;
}

/**
 * 同步真实战斗数值（只接受 BATTLE）。**日志在此阶段零追加**——
 * 逐帧伤害明细一律不写日志（Queue 硬约束），只在结束时一次性追加结果。
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
 * 战斗结束 → RESULT（由宿主在**官方 result 出现的那一刻**调用一次）。
 *
 * 输出三行叙事，全部是**真实数据的自然语言转写**：
 *   ① 胜负（官方 winner；'A' = 玩家）
 *   ② 真实耐久百分比
 *   ③ 第三行按「这是第几场」分岔：
 *      - 第 1 / 第 2 场 → 「你发现了一次改装机会……」（进 CHOICE 的叙事引子）；
 *      - 第 3 场（终局）→ 「本次改装的验证到此结束。」（**不再引导下一次改装**）。
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
  const won = outcome.winner === 'A';
  const battlesCompleted = s.battlesCompleted + 1;
  // 第三场之后 = 验证结束：不再有改装机会，也就不能再进 CHOICE。
  const finale = battlesCompleted >= RUN_MAX_BATTLES;
  return goPhase(next(s, { battle: b, battlesCompleted }), 'RESULT', {
    log: pushLogs(s.log, [
      { kind: 'result', text: won ? '战斗胜利。' : '战车被打退，你撤出了战场。' },
      { kind: 'durability', text: `战车耐久剩余 ${durabilityPercent(b)}%。` },
      {
        kind: 'result',
        text: finale ? '本次改装的验证到此结束。' : '你发现了一次改装机会……',
      },
    ]),
  });
}

/** 战斗结束时的耐久百分比（0..100，整数；真实 HP 比例，不是平衡数值）。 */
export function durabilityPercent(b: RunBattleState): number {
  if (b.playerHpMax <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((b.playerHp / b.playerHpMax) * 100)));
}

/**
 * 在 CHOICE 浮层里选中一个强化（必改 1 / 必改 3 / 必改 5 的状态侧）：
 *   - 记录到**本局 Build** `buffs`（下一场战斗会真正注入；顶部出现对应图标）；
 *   - 浮层关闭、原页面恢复；日志追加「你为大炮装上了 XXX。」+ 新的 `DAY n` 行；
 *   - 回到 IDLE 后按唯一主动作「继续」即进入下一场真实战斗。
 *
 * 准入（结构性约束，不靠运行期扫描）：
 *   1) 必须是 CHOICE；
 *   2) 本局选择次数 < `RUN_MAX_CHOICES`（**一局最多两次**）；
 *   3) 选项必须在**当前候选池**里（第二次只能从第一层决定的条件池里选）。
 * 不满足 → no-op（同引用）。
 */
export function chooseRunBuff(s: RunPageState, optionId: string): RunPageState {
  if (s.phase !== 'CHOICE') return s;
  if (s.buffs.length >= RUN_MAX_CHOICES) return s;
  if (!runChoicePoolHas(s, optionId)) return s;
  const mod = runModifierById(optionId);
  if (!mod) return s;

  const opt: RunChoiceOption = { id: mod.id, label: mod.label, note: mod.note };
  const day = s.day + 1;

  // 紧急维修：不改写上一场真实记录，只累加本局维修补偿（注入下一场时叠加）。
  let repairBonus = s.repairBonus;
  const logs: { kind: RunLogKind; text: string }[] = [{ kind: 'choice', text: mod.logText }];
  if (mod.id === 'emergencyRepair' && s.battle) {
    const heal = Math.round(s.battle.playerHpMax * EMERGENCY_REPAIR_FRACTION);
    repairBonus += heal;
    logs.push({ kind: 'durability', text: `车体修补完成，恢复了 ${heal} 点耐久。` });
  }
  logs.push({ kind: 'day', text: `DAY ${day}` });

  return goPhase(next(s, { buffs: [...s.buffs, opt], repairBonus, day }), 'IDLE', {
    log: pushLogs(s.log, logs),
  });
}
