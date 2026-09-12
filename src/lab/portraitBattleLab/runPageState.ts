/**
 * PRP-F0-RUN-PAGE-SHELL｜PRP-R3-CAPYBARA-UI-HIERARCHY-REBUILD
 * Run Page 纯状态机（无 DOM / 无 Canvas / 无物理 / 无平台依赖 / 无副作用）。
 *
 * 产品基线：整个单局是**一个持续存在的竖屏 Adventure Run Page**，
 * 战斗 / 事件 / 强化 / 结果是**同一个页面的五个状态**，不存在页面跳转：
 *
 *   IDLE ──继续──▶ EVENT ──遭遇敌人──▶ BATTLE ──自动结束──▶ RESULT ──继续──▶ CHOICE ──选择──▶ IDLE
 *
 * ⚠️ PRP-R3 必改 3：冒险记录**从 Console 改成玩家叙事** ——
 *   不再有 `[系统]` / `[事件]` / `[战斗]` / `[结果]` / `[耐久]` / `[强化]` 之类前缀，
 *   也没有任何 Runtime 状态 / 内部枚举 / 逐帧伤害；`kind` 只用于**渲染样式**
 *   （DAY 行加粗、结果行强调），不进入玩家可见文本。
 *
 * 本 Queue 明确不做（见 Queue 禁止项）：
 *   - 不开发正式 Day 状态机（`day` 恒为 3 / 7，属占位）；
 *   - 不开发随机强化池（三个选项是**固定**的演示选项，不抽取、不随机）；
 *   - 不做永久奖励 / 经济 / 存档；
 *   - 不做正式敌人 AI，也不做真实战斗数值 —— BATTLE 的推进是**纯演示脚本**
 *     （固定步数线性推进，见 RUN_BATTLE_SCRIPT），耐久上限取自 F1 共享测试数据，
 *     脚本本身只是「让它能自动演完」，不是任何平衡数值。
 */

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
 * 三个固定演示强化选项（不随机、不进任何正式强化池）。
 * `note` = **一句结果**（玩家可读，不是开发占位说明 / 不是数值表）。
 */
export interface RunChoiceOption {
  readonly id: string;
  readonly label: string;
  readonly note: string;
}

export const RUN_CHOICE_OPTIONS: readonly RunChoiceOption[] = [
  { id: 'heavyWarhead', label: '重型弹头', note: '炮弹更重，撞击和后坐增强' },
  { id: 'explosiveShell', label: '爆裂弹', note: '炮弹命中后发生范围爆炸' },
  { id: 'emergencyRepair', label: '紧急维修', note: '立即恢复部分耐久' },
];

/** 本 Queue 的演示装载（唯一一套；Run Page 不接 Debug 选择项）。 */
export interface RunPageContext {
  /** 我方载具展示名（来自 F1 共享测试数据，不手写）。 */
  readonly vehicleLabel: string;
  /** 遭遇的敌人展示名。 */
  readonly encounterLabel: string;
  /** 敌人车身 defId（仅用于取真实 collider 几何画占位外形）。 */
  readonly enemyBodyDefId: string;
  /** 我方耐久上限（取自 F1 共享数据的真实 HP）。 */
  readonly playerHpMax: number;
  /** 敌方耐久上限（取自 F1 共享数据的真实 HP）。 */
  readonly enemyHpMax: number;
}

/**
 * BATTLE 演示脚本（**不是战斗数值**）：
 *   - `totalSteps` 步内线性推进到结束；
 *   - 敌方耐久从满到 0，我方耐久按固定比例下降 —— 目的只是让 RESULT 有「当前耐久占位」可报；
 *   - `durationMs` 决定真实时间轴长度（约 2.4s，肉眼可辨且不拖沓）。
 */
export const RUN_BATTLE_SCRIPT = {
  durationMs: 2400,
  totalSteps: 90,
  playerDurabilityLossRatio: 0.22,
} as const;

export interface RunBattleState {
  readonly enemyLabel: string;
  readonly enemyBodyDefId: string;
  readonly playerHpMax: number;
  readonly playerHp: number;
  readonly enemyHpMax: number;
  readonly enemyHp: number;
  readonly steps: number;
  readonly totalSteps: number;
  /** 是否已演完（= 已进入 RESULT）。 */
  readonly done: boolean;
}

export interface RunPageState {
  readonly phase: RunPhase;
  /** 本局进度占位：DAY 3 / 7（本 Queue 不做正式 Day 状态机）。 */
  readonly day: number;
  readonly dayTotal: number;
  /** 已获得的核心 Build（顶部图标来源，最多显示 RUN_BUILD_ICON_SLOTS 个）。 */
  readonly buffs: readonly RunChoiceOption[];
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

/** 本局进度占位（本 Queue 不做正式 Day 状态机）：DAY 3 / 7。 */
export const RUN_INITIAL_DAY = 3;
export const RUN_TOTAL_DAYS = 7;

/** 初始状态（= Reset 后的 fresh 状态；IDLE 且日志已可见）。 */
export function createRunPageState(ctx: RunPageContext): RunPageState {
  return {
    phase: 'IDLE',
    day: RUN_INITIAL_DAY,
    dayTotal: RUN_TOTAL_DAYS,
    buffs: [],
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

export function runActionLabel(s: RunPageState): string {
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

/** 当前战斗的进度（0..1；无战斗时为 0）。 */
export function runBattleProgress(b: RunBattleState | null): number {
  if (!b || b.totalSteps <= 0) return 0;
  return Math.min(1, Math.max(0, b.steps / b.totalSteps));
}

/* --------------------------------------------------------------- 动作 */

/**
 * 按下底部唯一主动作：
 *   IDLE → EVENT   （日志追加 2 句自然语言敌情叙事）
 *   EVENT → BATTLE （建立演示战斗；此后自动推进。**入场不写日志**，保持记录稳定）
 *   RESULT → CHOICE（获得改装机会：原页面保留、整体变暗、中央浮层）
 *   BATTLE / CHOICE → no-op（同引用；BATTLE 由脚本自动结束，CHOICE 只能点卡片）
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
    const battle: RunBattleState = {
      enemyLabel: ctx.encounterLabel,
      enemyBodyDefId: ctx.enemyBodyDefId,
      playerHpMax: ctx.playerHpMax,
      playerHp: ctx.playerHpMax,
      enemyHpMax: ctx.enemyHpMax,
      enemyHp: ctx.enemyHpMax,
      steps: 0,
      totalSteps: RUN_BATTLE_SCRIPT.totalSteps,
      done: false,
    };
    return goPhase(next(s, { actionCount: s.actionCount + 1 }), 'BATTLE', { battle });
  }
  if (s.phase === 'RESULT') {
    return goPhase(next(s, { actionCount: s.actionCount + 1 }), 'CHOICE', {});
  }
  return s; // BATTLE（自动推进中）/ CHOICE（等选卡）→ 不接受主动作
}

function enemyHpAt(b: RunBattleState, steps: number): number {
  const p = b.totalSteps <= 0 ? 1 : Math.min(1, steps / b.totalSteps);
  return Math.max(0, Math.round(b.enemyHpMax * (1 - p)));
}

function playerHpAt(b: RunBattleState, steps: number): number {
  const p = b.totalSteps <= 0 ? 1 : Math.min(1, steps / b.totalSteps);
  const loss = Math.round(b.playerHpMax * RUN_BATTLE_SCRIPT.playerDurabilityLossRatio * p);
  return Math.max(0, b.playerHpMax - loss);
}

/**
 * 推进战斗（只接受 BATTLE）。**日志在此阶段不追加任何内容**——
 * 逐帧伤害明细一律不写日志（Queue 硬约束），只在演完时一次性追加结果。
 */
export function advanceRunBattle(s: RunPageState, steps: number): RunPageState {
  if (s.phase !== 'BATTLE' || !s.battle) return s;
  const n = Math.max(0, Math.floor(steps));
  if (n === 0) return s;
  const b = s.battle;
  const t = Math.min(b.totalSteps, b.steps + n);
  const mid: RunBattleState = {
    ...b,
    steps: t,
    enemyHp: enemyHpAt(b, t),
    playerHp: playerHpAt(b, t),
  };
  if (t < b.totalSteps) {
    // 仍在交战：只更新数值，不写日志、不换 phase
    return next(s, { battle: mid });
  }
  const done: RunBattleState = { ...mid, enemyHp: 0, done: true };
  return goPhase(next(s, { battle: done }), 'RESULT', {
    log: pushLogs(s.log, [
      { kind: 'result', text: '战斗胜利。' },
      { kind: 'durability', text: `战车耐久剩余 ${durabilityPercent(done)}%。` },
      { kind: 'result', text: '你发现了一次改装机会……' },
    ]),
  });
}

/** 战斗结束时的耐久百分比（0..100，整数；仅用于叙事文本，不是平衡数值）。 */
export function durabilityPercent(b: RunBattleState): number {
  if (b.playerHpMax <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((b.playerHp / b.playerHpMax) * 100)));
}

/**
 * 在 CHOICE 浮层里选中一个强化：
 *   - 浮层关闭、原页面恢复（可见状态回到 RESULT 的构图）；
 *   - 顶部出现对应核心 Build 图标（buffs +1）；
 *   - 日志追加「你选择了 XXX」，历史保持完整。
 * 未知 id / 非 CHOICE 状态 → no-op（同引用）。
 */
export function chooseRunBuff(s: RunPageState, optionId: string): RunPageState {
  if (s.phase !== 'CHOICE') return s;
  const opt = RUN_CHOICE_OPTIONS.find((o) => o.id === optionId);
  if (!opt) return s;
  return goPhase(next(s, { buffs: [...s.buffs, opt] }), 'IDLE', {
    log: pushLog(s.log, 'choice', `你换上了${opt.label}。`),
  });
}
