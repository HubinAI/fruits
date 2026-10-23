/**
 * FRUITS-RANDOM-ADVENTURE-R1｜隔离纯状态机（与冻结的 runPageState.ts 同一职责、独立实现）。
 *
 * 复用边界（不修改任何冻结文件）：
 *   - 复用 `RunBattleRuntime` 的**真实物理战斗**（由宿主 advPage 创建并逐帧 step）；
 *   - 复用 `runModifiers` 的**只读常量与查询**（`EMERGENCY_REPAIR_FRACTION`、
 *     Run Build 候选池、`runBuildOptionById`）—— 修复量 / 强化口径与正式一致；
 *   - **不**复用 `runPageState.ts` 的导航：它硬接线到固定 `RUN_SCRIPT`，无法注入随机脚本；
 *     因此本文件自带节点表与导航，保证「同种子完全可复现」且现有 E2E 零回归。
 *
 * 三种非战斗事件的效果**真实进入**本局状态（验收 ②）：
 *   - heal   → 修改 `carriedHp`（下一场真实战斗开局耐久随之变化）；
 *   - damage → 修改 `carriedHp`（可能降低后续战斗开局耐久）；
 *   - buff   → 追加到 `buffs`（下一建造/战斗真正注入 Run Build）；
 *   且每个事件的结果**只结算一次**（耐久类因果生成时预掷定；强化身份在领取时按
 *   种子候选序解析，见 applyEffect —— 同种子 + 同选择 = 同结果，选择即揭晓，
 *   进入 EVENT_DONE 后不可再选、刷新/重抽均不改变已落定的效果）。
 */
import {
  EMERGENCY_REPAIR_FRACTION,
  RUN_BASE_WEAPON_DEF_ID,
  RUN_LAYER1_POOL,
  runBuildOptionById,
  runGenericChoiceDefs,
  runLateralPoolDefs,
  runLayer1PoolDefs,
  runLayer2PoolDefs,
  type RunBuildId,
  type RunModifierDef,
} from '../runModifiers';
import { demoRunPlayerLoadout, runPageContext, type RunPlayerLoadout } from '../runPageScene';
import { type AdventureEffect, type AdventureNode, type AdventureScript } from './advScript';

export type AdventurePhase =
  | 'IDLE'
  | 'EVENT'
  | 'BATTLE'
  | 'RESULT'
  | 'CHOICE'
  | 'EVENT_CHOICE'
  | 'EVENT_DONE'
  | 'COMPLETE'
  | 'FAILED';

export interface AdventureBattleState {
  readonly enemyLabel: string;
  readonly playerHpMax: number;
  readonly playerHp: number;
  readonly enemyHpMax: number;
  readonly enemyHp: number;
  readonly steps: number;
  readonly done: boolean;
  readonly winner: string | null;
  readonly endReason: string | null;
}

export type AdventureLogKind = 'day' | 'travel' | 'event' | 'result' | 'choice' | 'durability';
export interface AdventureLogEntry {
  readonly seq: number;
  readonly kind: AdventureLogKind;
  readonly text: string;
}

export interface AdventureState {
  readonly phase: AdventurePhase;
  readonly nodeId: string;
  readonly day: number;
  readonly dayTotal: number;
  readonly buffs: readonly RunBuildId[];
  readonly baseWeaponDefId: string;
  /** 下一场真实战斗开局的耐久（null = 满耐久）。跨战斗单一口径，与正式 runCarriedPlayerHp 同源思路。 */
  readonly carriedHp: number | null;
  readonly battlesCompleted: number;
  /** 获胜战斗数（winner === 'A'）；与 battlesCompleted（完成场次，含打退）区分（R4 结算口径）。 */
  readonly battlesWon: number;
  readonly log: readonly AdventureLogEntry[];
  readonly battle: AdventureBattleState | null;
  /** EVENT_DONE 阶段展示的结果文本。 */
  readonly eventResult: string | null;
  readonly actionCount: number;
  readonly transitions: number;
  readonly phaseTrail: readonly AdventurePhase[];
  readonly revision: number;
}

export interface AdventureContext {
  readonly playerHpMax: number;
  readonly vehicleLabel: string;
  readonly baseWeaponDefId: string;
}

/** 真实战斗节点使用的既有正式 Encounter 的展示名（仅展示用；战斗本身由 RunBattleRuntime 解析）。 */
export const ADV_ENEMY_LABELS: Readonly<Record<string, string>> = {
  ProtoRusher: '原型冲撞者',
  Chaser: '追击者',
  RangedTurret: '远程炮塔车',
  ExtendedStandoffRod: '控距推杆车',
  ExtendedBurnSaw: '喷火锯车',
  ExtendedHeavyContact: '重锤装甲车',
};

const ADV_LOG_MAX = 240;
const ADV_HP_FLOOR_FRACTION = 0.1;
/** 阶段整备（BANNER 节点）恢复比例：真实物理下 7 战耐久经济偏紧，阶段节点补给使整局可通关且不 trivial。 */
const ADV_WAYPOINT_HEAL_FRACTION = 0.5;

/**
 * 冒险 BUILD 候选**策展排除项**（仅在冒险层过滤，不改 runModifiers / 任何物理与数值）：
 *   `fastReload`（Cannon cooldownMs 1000→650）与 `twinCannon`（burstRounds 1→2）在真实 Planck
 *   物理下叠加会发生 DPS 崩塌的涌现互斥——headless 隔离复现：6 强化（含 twinCannon、无
 *   fastReload）打 Chaser 稳赢剩 645 耐久；同样 6 强化把 rateUp 换成 fastReload 后
 *   1100→0 团灭（敌剩 57），且与 rateUp 是否在场逐帧一致。冒险整局必经 FINAL，
 *   若玩家沿该路径装配会走进**必然不可通关**的死局，故冒险池不发放该项
 *   （正式 Run 的车库装配不受影响，本表只作用于本原型冒险的候选浮层）。
 */
const ADV_EXCLUDED_BUILD_IDS: readonly RunBuildId[] = ['fastReload'];

export function advContextFromLoadout(loadout: RunPlayerLoadout = demoRunPlayerLoadout()): AdventureContext {
  const ctx = runPageContext(loadout);
  return {
    playerHpMax: ctx.playerHpMax,
    vehicleLabel: ctx.vehicleLabel,
    baseWeaponDefId: ctx.baseWeaponDefId ?? RUN_BASE_WEAPON_DEF_ID,
  };
}

/* --------------------------------------------------------------- 基础工具 */

function pushLog(log: readonly AdventureLogEntry[], kind: AdventureLogKind, text: string): AdventureLogEntry[] {
  const seq = log.length === 0 ? 1 : log[log.length - 1].seq + 1;
  const next = [...log, { seq, kind, text }];
  return next.length > ADV_LOG_MAX ? next.slice(next.length - ADV_LOG_MAX) : next;
}

function pushLogs(
  log: readonly AdventureLogEntry[],
  entries: readonly { kind: AdventureLogKind; text: string }[],
): readonly AdventureLogEntry[] {
  let out = log;
  for (const e of entries) out = pushLog(out, e.kind, e.text);
  return out;
}

function next(s: AdventureState, patch: Partial<AdventureState>): AdventureState {
  return { ...s, ...patch, revision: s.revision + 1 };
}

function goPhase(s: AdventureState, phase: AdventurePhase, patch: Partial<AdventureState>): AdventureState {
  return next(s, { ...patch, phase, transitions: s.transitions + 1, phaseTrail: [...s.phaseTrail, phase] });
}

function phaseForNode(kind: AdventureNode['kind']): AdventurePhase {
  if (kind === 'EVENT') return 'EVENT_CHOICE';
  if (kind === 'BUILD') return 'CHOICE';
  return 'IDLE';
}

function subst(text: string, ctx: AdventureContext, node: AdventureNode): string {
  const enemy = node.kind === 'BATTLE' || node.kind === 'FINAL' ? ADV_ENEMY_LABELS[node.encounterId] ?? '对手' : '';
  return text.replace(/\{vehicle\}/g, ctx.vehicleLabel).replace(/\{enemy\}/g, enemy);
}

function presentNode(
  s: AdventureState,
  nodeId: string,
  script: AdventureScript,
  ctx: AdventureContext,
): AdventureState {
  const node = script.nodes[nodeId];
  if (!node) return s;
  // 建造节点候选池已空（所有可见强化均已拥有）：诚实跳过，绝不进入「空浮层」——
  // 否则 UI / 调试驱动（debugStepOption / 真实点击）因无卡片可点而永久卡在 CHOICE（R3 浏览器 E2E 暴露的真实死锁）。
  // ⚠️ 终态 FINAL 恒为末节点，BUILD 节点必有非空 next，故跳过不会落入无后继的退化分支。
  if (node.kind === 'BUILD' && advChoicePool(s, node, ctx).length === 0) {
    if (node.next) return presentNode(s, node.next, script, ctx);
  }
  const entries: { kind: AdventureLogKind; text: string }[] = [];
  if (node.day !== s.day) entries.push({ kind: 'day', text: `DAY ${node.day}` });
  for (const line of node.beat) entries.push({ kind: 'travel', text: subst(line, ctx, node) });
  // 阶段整备（BANNER）：进入阶段节点时恢复一段耐久（真实补给，规则可见），使 7 战耐久经济可通关。
  let patch: Partial<AdventureState> = {};
  if (node.kind === 'BANNER') {
    const maxHp = ctx.playerHpMax;
    const current = s.carriedHp ?? maxHp;
    const heal = Math.round(maxHp * ADV_WAYPOINT_HEAL_FRACTION);
    const after = Math.min(maxHp, current + heal);
    const gained = after - current;
    if (gained > 0) {
      patch = { carriedHp: after };
      entries.push({ kind: 'durability', text: `阶段整备：恢复 ${gained} 点耐久。` });
    }
  }
  return goPhase(next(s, { nodeId, day: node.day, log: pushLogs(s.log, entries), ...patch }), phaseForNode(node.kind), {});
}

/* --------------------------------------------------------------- 查询 */

export function advCurrentNode(s: AdventureState, script: AdventureScript): AdventureNode {
  const n = script.nodes[s.nodeId];
  if (!n) throw new Error(`[ADV] 未知节点 "${s.nodeId}"`);
  return n;
}

/** 下一场真实战斗开局的耐久（null = 满耐久）。 */
export function advCarriedPlayerHp(s: AdventureState, ctx: AdventureContext): number {
  return s.carriedHp ?? ctx.playerHpMax;
}

/**
 * FRUITS-ADVENTURE-BATTLE-HP-F3｜**紧急维修的真实修理量**（纯函数，沿用正式 Run 口径）。
 *
 * `emergencyRepair` 的语义只有一句：「选择时立刻修回一部分车体耐久」。正式 Run 的口径是
 * `EMERGENCY_REPAIR_FRACTION(0.25) × 耐久上限`，按**缺口截断**（`runPageState.chooseRunBuff` /
 * `resolveDurability` 同一公式）—— 本函数逐字复用，不新造数值。
 *
 * ⚠️ 为什么冒险必须自己算：冒险把 `buffs` 原样注入 `RunBattleRuntime`，而运行时的能力模块
 *    （`RunBuildAbilities`）只实现 `kineticBurst` ⇒ 若不在这里结算，选「紧急维修」在冒险里
 *    等于**空选**（只占一个 Build 位，耐久一点不涨）。D1 已实测该项无任何可感知结果。
 *
 * @param currentHp 修理前的耐久（冒险 = `carriedHp`；事件 trade 先扣耐久再修，也从这里进）
 * @returns `hp` = 修理后耐久；`gained` = 真实恢复量（0 = 已满，如实告知，不假装有效）
 */
export function advEmergencyRepairGain(
  currentHp: number,
  ctx: AdventureContext,
): { readonly hp: number; readonly gained: number } {
  const maxHp = ctx.playerHpMax;
  const want = Math.round(maxHp * EMERGENCY_REPAIR_FRACTION);
  const gained = Math.max(0, Math.min(want, maxHp - currentHp));
  return { hp: currentHp + gained, gained };
}

/**
 * FRUITS-ADVENTURE-REPAIR-VALUE-F5｜**阶段整备（BANNER）的自动回补量**（纯函数，与 `presentNode` 同一口径）。
 *
 * ⚠️ 不新增/不改动任何比例：这里只是把 `presentNode` 里那一行 `Math.round(maxHp * ADV_WAYPOINT_HEAL_FRACTION)`
 *    抽成可复算的纯函数，供 F5 的「维修净贡献」判据使用（同一口径 ⇒ 判据不会与真实行为漂移）。
 */
export function advAutoResupplyHeal(ctx: AdventureContext): number {
  return Math.round(ctx.playerHpMax * ADV_WAYPOINT_HEAL_FRACTION);
}

/**
 * FRUITS-ADVENTURE-REPAIR-VALUE-F5｜一次「紧急维修」对**下一场战斗开局耐久**的净贡献（纯函数）。
 *
 * 问题（Queue 必改 1 定位到的真实链路）：
 *   BUILD 候选里的「紧急维修」= 立刻修回 0.25 × 上限；阶段整备（BANNER）= 立刻回补 0.5 × 上限。
 *   当两者**紧邻**发生时（维修刚修好、紧接着的整备又把它顶满），这次强化选择对「下一场开局 HP」
 *   的净贡献 = 0 ⇒ 玩家白选了（Queue 验收 2：不允许「没有实际收益的选择」）。
 *
 * 判据（与真实结算同一口径，min(上限, …) 逐次封顶）：
 *   withRepair    = 维修后耐久，再经过 `autoResuppliesBeforeBattle` 次**必然发生**的自动整备；
 *   withoutRepair = 不维修，同样经过这些自动整备；
 *   净贡献 = withRepair − withoutRepair。
 *   ⚠️ 只数**必然发生**的免费恢复（BANNER）：EVENT 的恢复要玩家当场选（可能回血也可能扣血），
 *      属于玩家选择，不计入（否则会把玩家的主动决策也算成「被吞掉」）。
 *
 * @param hp 此刻的耐久（= 下一场战斗的开局耐久口径）
 * @param gain 本次维修的真实修理量（`advEmergencyRepairGain(...).gained`，满耐久时为 0）
 * @param autoResuppliesBeforeBattle 本节点之后、下一场战斗之前的自动整备次数
 */
export function advRepairNetGainToNextBattle(
  hp: number,
  gain: number,
  autoResuppliesBeforeBattle: number,
  ctx: AdventureContext,
): number {
  const maxHp = ctx.playerHpMax;
  const heal = advAutoResupplyHeal(ctx);
  const capped = (v: number): number => Math.min(maxHp, v);
  let withRepair = capped(hp + gain);
  let withoutRepair = capped(hp);
  for (let i = 0; i < autoResuppliesBeforeBattle; i++) {
    withRepair = capped(withRepair + heal);
    withoutRepair = capped(withoutRepair + heal);
  }
  return withRepair - withoutRepair;
}

/**
 * F5｜此刻选「紧急维修」对**下一场战斗开局耐久**是否还有实际收益（纯函数，唯一判据）。
 *
 * 返回 false 的两种情形（都属 Queue 验收 2 要消除的「无效选择」）：
 *   ① 满耐久：修理量本身 = 0；
 *   ② 维修值会被紧随其后的免费整备完全吞掉：净贡献 = 0。
 */
export function advRepairHasRealValue(
  hp: number,
  autoResuppliesBeforeBattle: number,
  ctx: AdventureContext,
): boolean {
  const { gained } = advEmergencyRepairGain(hp, ctx);
  return advRepairNetGainToNextBattle(hp, gained, autoResuppliesBeforeBattle, ctx) > 0;
}

/** 顶部耐久条的显示值（见 `advTopDurability`）。 */
export interface AdventureTopDurability {
  readonly hp: number;
  readonly max: number;
  /** 0~100 整数百分比（顶栏唯一绘制口径）。 */
  readonly pct: number;
  /** `battle-live` = 读真实战斗运行时；`carried` = 读已结算的 carriedHp。 */
  readonly source: 'battle-live' | 'carried';
}

/**
 * FRUITS-ADVENTURE-BATTLE-HP-F2｜顶部耐久条的**显示值**（纯函数，唯一口径）。
 *
 * 背景：`carriedHp` 只在战斗结束那一刻由 `finishAdventureBattle` 写入，战斗期间它恒等于
 * **本场开局**耐久 ⇒ 顶栏在整场战斗里冻结（D1 已实测：真实 HP 968→839 时顶栏恒 88%）。
 * 真实 HP 的唯一真源是 `RunBattleRuntime.hp()`（正式物理车辆 `vehicleA.hp`）。
 *
 * 本函数**不持有任何状态**，只回答「这一帧该读哪一份」：
 *   - `BATTLE` 且有实时读数 ⇒ 用实时 `live.hp`；
 *   - 其余阶段（RESULT / 维修 / 下一场 / 事件 / 终局）⇒ 用已结算的 `carriedHp`。
 *
 * ⚠️ 分母在两种来源下**都**取 `ctx.playerHpMax`：战斗结束时
 *    `carriedHp = max(0, outcome.playerHp)`（= 最后一帧实时 HP），分母若跟着来源一起换，
 *    百分比就会在切场瞬间跳一下 —— 「切场后结果不回跳」的判据就落在这一点上。
 */
export function advTopDurability(
  s: AdventureState,
  ctx: AdventureContext,
  live: { readonly hp: number } | null,
): AdventureTopDurability {
  const max = ctx.playerHpMax > 0 ? ctx.playerHpMax : 1;
  // 只有 BATTLE 阶段的读数算「实时」；其它阶段即使调用方传了值也不采用（避免误用冻结帧）。
  const liveHp = s.phase === 'BATTLE' && live != null && Number.isFinite(live.hp) ? live.hp : null;
  const hp = Math.max(0, Math.min(max, Math.round(liveHp ?? advCarriedPlayerHp(s, ctx))));
  return {
    hp,
    max,
    pct: Math.max(0, Math.min(100, Math.round((hp / max) * 100))),
    source: liveHp !== null ? 'battle-live' : 'carried',
  };
}

export function advBuildIds(s: AdventureState): readonly RunBuildId[] {
  return s.buffs;
}

/** 本局最初主路线（第一层强化 id；用于第二层条件池）。 */
export function advMainRouteId(s: AdventureState): string | null {
  for (const b of s.buffs) if ((RUN_LAYER1_POOL as readonly string[]).includes(b)) return b;
  return null;
}

export function advActionEnabled(s: AdventureState): boolean {
  return (
    s.phase === 'IDLE' ||
    s.phase === 'EVENT' ||
    s.phase === 'RESULT' ||
    s.phase === 'EVENT_DONE' ||
    s.phase === 'COMPLETE' ||
    s.phase === 'FAILED'
  );
}

export function advActionLabel(s: AdventureState): string {
  switch (s.phase) {
    case 'EVENT':
      return '遭遇敌人';
    case 'BATTLE':
      return '战斗中';
    case 'RESULT':
    case 'EVENT_DONE':
      return '继续';
    case 'CHOICE':
      return '选择一个强化';
    case 'EVENT_CHOICE':
      return '做个决定';
    case 'COMPLETE':
      // R2：终局按钮实际动作是「开始新一局」（新随机种子），标签如实描述，避免与提示文案冲突
      return '再来一局';
    case 'FAILED':
      return '再试一次';
    default:
      return '继续';
  }
}

export function advEventChoiceOpen(s: AdventureState): boolean {
  return s.phase === 'EVENT_CHOICE';
}
export function advChoiceOpen(s: AdventureState): boolean {
  return s.phase === 'CHOICE';
}
export function advOverlayOpen(s: AdventureState): boolean {
  return advEventChoiceOpen(s) || advChoiceOpen(s);
}

/** 当前浮层卡片（事件选项 or 建造候选），绘制/命中区/测试同源。 */
export function advOverlayCards(s: AdventureState, script: AdventureScript, ctx: AdventureContext): readonly { id: string; label: string; note: string }[] {
  if (advEventChoiceOpen(s)) {
    const node = advCurrentNode(s, script);
    if (node.kind === 'EVENT') return node.options;
    return [];
  }
  if (advChoiceOpen(s)) {
    const node = advCurrentNode(s, script);
    if (node.kind === 'BUILD') return advChoicePool(s, node, ctx).map((d) => ({ id: d.id, label: d.label, note: d.note }));
    return [];
  }
  return [];
}

/** 当前浮层标题。 */
export function advOverlayTitle(s: AdventureState, script: AdventureScript): string {
  if (advEventChoiceOpen(s)) {
    const node = advCurrentNode(s, script);
    if (node.kind === 'EVENT') return node.title;
  }
  if (advChoiceOpen(s)) return '选择一项改装';
  return '';
}

/**
 * 当前 BUILD 节点的候选池（结构去重：剔除已拥有的强化）。
 *
 * FRUITS-ADVENTURE-REPAIR-VALUE-F5（必改 2｜**候选投放**）：
 *   「紧急维修」在**对下一场战斗开局耐久的净贡献 = 0** 的节点不再投放，具体是两种情形：
 *     ① 此刻满耐久（修理量本身 = 0）——选了也不会多回一点耐久；
 *     ② 紧随其后的**自动阶段整备**（BANNER）会把修好的耐久完全顶回上限
 *        （下一场开局耐久与「没修」一模一样）——玩家的这一次强化选择没有实际价值。
 *   ⇒ BUILD 节点上玩家看到的每一个候选，都**至少有一处真实收益**（验收 2）。
 *
 * ⚠️ 阶段整备本身**一字未改**（比例 / 时机 / 效果都没动）：这里只是不把「必然被整备吞掉」的
 *    候选投放出来（必改 2 明令「不直接削弱阶段整备」）。
 * ⚠️ EVENT 的恢复**不计入**：它要玩家当场选（可能回血、也可能扣血），属于玩家决策，
 *    不能算作「被整备覆盖」。
 */
export function advChoicePool(
  s: AdventureState,
  node: AdventureNode,
  ctx: AdventureContext,
): readonly { readonly id: RunBuildId; readonly label: string; readonly note: string }[] {
  if (node.kind !== 'BUILD') return [];
  const toChoice = (d: RunModifierDef): { id: RunBuildId; label: string; note: string } => ({
    id: d.id as RunBuildId,
    label: d.label,
    note: d.note,
  });
  let pool: readonly { id: RunBuildId; label: string; note: string }[];
  switch (node.poolKind) {
    case 'layer1':
      pool = runLayer1PoolDefs().map(toChoice);
      break;
    case 'layer2':
      pool = runLayer2PoolDefs(advMainRouteId(s) ?? '').map(toChoice);
      break;
    case 'lateral':
      pool = runLateralPoolDefs(s.buffs).map(toChoice);
      break;
    case 'generic':
      pool = runGenericChoiceDefs(s.buffs, ctx.baseWeaponDefId);
      break;
  }
  const hp = advCarriedPlayerHp(s, ctx);
  return pool
    .filter((d) => !s.buffs.includes(d.id) && !ADV_EXCLUDED_BUILD_IDS.includes(d.id))
    .filter((d) => d.id !== 'emergencyRepair' || advRepairHasRealValue(hp, node.autoResupplyBeforeBattle, ctx));
}

export function advVisibleLog(s: AdventureState, maxLines: number): readonly AdventureLogEntry[] {
  if (maxLines <= 0) return [];
  return s.log.length <= maxLines ? s.log : s.log.slice(s.log.length - maxLines);
}

export function advFormatLog(e: AdventureLogEntry): string {
  return e.text;
}

/* --------------------------------------------------------------- 创建 */

export function createAdventureState(ctx: AdventureContext, script: AdventureScript): AdventureState {
  const first = script.nodes[script.firstId];
  const entries: { kind: AdventureLogKind; text: string }[] = [{ kind: 'day', text: `DAY ${first.day}` }];
  for (const line of first.beat) entries.push({ kind: 'travel', text: subst(line, ctx, first) });
  const phase = phaseForNode(first.kind);
  return {
    phase,
    nodeId: first.id,
    day: first.day,
    dayTotal: script.dayTotal,
    buffs: [],
    baseWeaponDefId: ctx.baseWeaponDefId,
    carriedHp: null,
    battlesCompleted: 0,
    battlesWon: 0,
    log: pushLogs([], entries),
    battle: null,
    eventResult: null,
    actionCount: 0,
    transitions: 0,
    phaseTrail: [phase],
    revision: 0,
  };
}

/* --------------------------------------------------------------- 动作 */

/**
 * 按下底部唯一主动作（按当前节点 / phase 分派）：
 *   IDLE + START          → 推进到 next 节点
 *   IDLE + BATTLE/FINAL   → EVENT（敌情叙事）
 *   IDLE + EVENT          → EVENT_CHOICE（事件选项浮层）
 *   IDLE + BUILD          → CHOICE（建造候选浮层）
 *   EVENT                 → BATTLE（建立真实战斗状态）
 *   RESULT / EVENT_DONE   → 推进到 next 节点
 *   终态                  → 同一脚本重开（纯状态机口径 = 同种子重放，仅测试入口；
 *                            UI 层 advPage 在终态拦截主动作改为「新一局·新随机种子」，见 R4 必改①）
 *   BATTLE / CHOICE / EVENT_CHOICE → no-op（必须点卡片）
 */
export function pressAdventureAction(
  s: AdventureState,
  ctx: AdventureContext,
  script: AdventureScript,
): AdventureState {
  if (s.phase === 'COMPLETE' || s.phase === 'FAILED') return createAdventureState(ctx, script);

  if (s.phase === 'IDLE') {
    const node = advCurrentNode(s, script);
    if (node.kind === 'BATTLE' || node.kind === 'FINAL') {
      const entries = (node.encounter ?? []).map((line) => ({ kind: 'event' as AdventureLogKind, text: subst(line, ctx, node) }));
      return goPhase(next(s, { actionCount: s.actionCount + 1 }), 'EVENT', { log: pushLogs(s.log, entries) });
    }
    if (node.kind === 'EVENT') {
      return goPhase(next(s, { actionCount: s.actionCount + 1 }), 'EVENT_CHOICE', {});
    }
    if (node.kind === 'BUILD') {
      // 候选池已空（所有可见强化已拥有）：诚实跳过，不进入空浮层、不死锁。
      const pool = advChoicePool(s, node, ctx);
      if (pool.length === 0) {
        if (node.next) return presentNode(next(s, { actionCount: s.actionCount + 1 }), node.next, script, ctx);
        return next(s, { actionCount: s.actionCount + 1 });
      }
      return goPhase(next(s, { actionCount: s.actionCount + 1 }), 'CHOICE', {});
    }
    // START
    if (node.next) return presentNode(next(s, { actionCount: s.actionCount + 1 }), node.next, script, ctx);
    return s;
  }

  if (s.phase === 'EVENT') {
    const node = advCurrentNode(s, script);
    const startHp = advCarriedPlayerHp(s, ctx);
    const battle: AdventureBattleState = {
      enemyLabel: ADV_ENEMY_LABELS[node.kind === 'BATTLE' || node.kind === 'FINAL' ? node.encounterId : ''] ?? '对手',
      playerHpMax: ctx.playerHpMax,
      playerHp: startHp,
      enemyHpMax: ctx.playerHpMax,
      enemyHp: ctx.playerHpMax,
      steps: 0,
      done: false,
      winner: null,
      endReason: null,
    };
    return goPhase(next(s, { actionCount: s.actionCount + 1 }), 'BATTLE', { battle });
  }

  if (s.phase === 'RESULT' || s.phase === 'EVENT_DONE') {
    const node = advCurrentNode(s, script);
    if (node.next) return presentNode(next(s, { actionCount: s.actionCount + 1 }), node.next, script, ctx);
    return s;
  }

  return s; // BATTLE / CHOICE / EVENT_CHOICE → 不接受主动作
}

/**
 * 把事件效果落到状态（返回新状态 + 结果文本）。
 *
 * R4 领取时解析（修复预分配耗尽强化池 + 零收益中奖/无提示扣血）：
 *   - buff / trade 的 `candidates` 是生成期掷定的种子洗牌序（同种子恒定），
 *     领取时取**第一个未拥有**的候选 —— 纯函数 of (candidates, state.buffs)，可复现；
 *   - 候选全被拥有 → 降级为一次真实维修（不扣耐久）；
 *   - 候选全被拥有且耐久已满 → 如实空手（明确文案，绝不 framed 成中奖）；
 *   - trade 只有真正领到未拥有强化才扣耐久 —— 绝不「仅扣耐久」零收益。
 *
 * F5（FRUITS-ADVENTURE-REPAIR-VALUE-F5）追加的一层：
 *   候选解析时跳过「此刻没有任何实际收益」的**紧急维修**（满耐久 ⇒ 修不了）——
 *   否则它就是一次「零收益中奖」，trade 还要为此扣耐久（验收 2：绝不扣除代价却无收益）。
 *   ⇒ 候选解析 = 「第一个未拥有**且此刻有收益**的候选」；一个都没有 ⇒ 如实空手（不扣耐久）。
 */
function applyEffect(
  s: AdventureState,
  effect: AdventureEffect,
  ctx: AdventureContext,
): { state: AdventureState; resultText: string } {
  const maxHp = ctx.playerHpMax;
  const floor = Math.max(1, Math.round(maxHp * ADV_HP_FLOOR_FRACTION));
  const current = s.carriedHp ?? maxHp;

  if (effect.kind === 'heal') {
    const amount = Math.round(maxHp * effect.fraction);
    const after = Math.min(maxHp, current + amount);
    const gained = after - current;
    // 满耐久：如实告知（0 恢复不是奖励，也不假装有效）。
    const text = gained === 0 ? `耐久已满，没有可修的地方（恢复 0 点，当前 ${after}/${maxHp}）。` : `你恢复了 ${gained} 点耐久（当前 ${after}/${maxHp}）。`;
    return { state: next(s, { carriedHp: after }), resultText: text };
  }
  if (effect.kind === 'damage') {
    // 最低保留（可见规则，非隐藏保底）：单事件不会把耐久打到 0，但损失是真实的；
    // 触及保留线时在结果里明示，不用隐藏保底冒充真实风险（验收③）。
    const amount = Math.round(maxHp * effect.fraction);
    const raw = current - amount;
    const clamped = raw < floor;
    const after = Math.max(floor, raw);
    const lost = current - after;
    const tail = clamped ? `（触及最低保留 ${floor}）` : '';
    return {
      state: next(s, { carriedHp: after }),
      resultText: `你损失了 ${lost} 点耐久。${tail}`,
    };
  }
  if (effect.kind === 'buff' || effect.kind === 'trade') {
    const tradeDmg = effect.kind === 'trade' ? Math.round(maxHp * effect.damageFraction) : 0;
    const labelOf = (id: RunBuildId): string => runBuildOptionById(id)?.label ?? id;

    // 领取时解析：候选序（同种子恒定）里**第一个未拥有**的候选。
    const unowned = effect.candidates.filter((id) => !s.buffs.includes(id));
    // F5｜再叠一层「此刻真的有收益」：候选里只有「紧急维修」会随耐久状态而失效
    //    （它的**全部**价值 = 此刻真修回的那点耐久；运行时能力只认 kineticBurst ⇒
    //    它作为 Build 项本身对战斗毫无影响）。
    //    ⇒ 满耐久时领到它 = 「零收益中奖」（R4 禁止）；trade 还要为此扣耐久
    //    ⇒ 正是「扣除代价却没有实际收益」（F5 验收 2）。
    //    ⇒ 此刻无效的候选直接跳过（纯函数：candidates + buffs + 当前耐久 ⇒ 同种子同结果）。
    const granted =
      unowned.find((id) => {
        if (id !== 'emergencyRepair') return true;
        const base = effect.kind === 'trade' ? Math.max(floor, current - tradeDmg) : current;
        return advEmergencyRepairGain(base, ctx).hp > current;
      }) ?? null;
    if (granted) {
      // F3：事件也可能发「紧急维修」⇒ 与 BUILD 路径同一口径真实修耐久（正式 Run 语义）。
      // trade 先扣耐久、再按扣后的值修（顺序可见：先付钱，后拿货）。
      const repair =
        granted === 'emergencyRepair'
          ? advEmergencyRepairGain(effect.kind === 'trade' ? Math.max(floor, current - tradeDmg) : current, ctx)
          : null;
      const repairTail =
        repair === null
          ? ''
          : repair.gained > 0
            ? `；车体修补完成，恢复 ${repair.gained} 点耐久（当前 ${repair.hp}/${maxHp}）`
            : '；耐久已满，这次维修没有可修的地方';
      if (effect.kind === 'buff') {
        return {
          state: next(s, { buffs: [...s.buffs, granted], ...(repair ? { carriedHp: repair.hp } : {}) }),
          resultText: `你获得了临时强化：${labelOf(granted)}（已生效，下一场战斗计入）${repairTail}。`,
        };
      }
      // trade：真实 HP ↔ Build 权衡，仅当真正领到强化才扣耐久。
      const raw = current - tradeDmg;
      const clamped = raw < floor;
      const after = Math.max(floor, raw);
      const lost = current - after;
      const tail = clamped ? `（触及最低保留 ${floor}）` : '';
      return {
        state: next(s, {
          carriedHp: repair ? repair.hp : after,
          buffs: [...s.buffs, granted],
        }),
        resultText: `你用 ${lost} 点耐久换来了临时强化：${labelOf(granted)}${repairTail}。${tail}`,
      };
    }

    // 兜底 A：有未拥有的候选，但它们此刻都没有实际收益（= 唯一可领的是紧急维修，而耐久已满）。
    //   → 如实空手：不扣耐久、不发空强化、绝不 framed 成中奖。
    if (unowned.length > 0) {
      const head =
        effect.kind === 'trade'
          ? '商队这份货此刻换不出实际收益（耐久已满，没有可修的地方）'
          : '这次唯一能领的是紧急维修，可耐久已满——没有可修的地方';
      return { state: s, resultText: `${head}：这次没有收益，但也没有损失。` };
    }

    // 兜底 B：候选全被拥有 → 补救维修（不扣耐久）。
    const { hp: after, gained } = advEmergencyRepairGain(current, ctx);
    if (gained > 0) {
      const head = effect.kind === 'trade' ? '商队的货你都已拥有，这单改为免费补给' : '箱里的强化你都已拥有，改为一次补给';
      return {
        state: next(s, { carriedHp: after }),
        resultText: `${head}：恢复 ${gained} 点耐久（当前 ${after}/${maxHp}），不重复计入已拥有的强化。`,
      };
    }
    // 候选全被拥有且耐久已满 → 如实空手（无收益、无损失，明确文案）。
    const head = effect.kind === 'trade' ? '商队的货你都已拥有，耐久也已满——这单作罢（不扣耐久）' : '强化你都已拥有，耐久也已满——这次没有收获，但也没有损失';
    return { state: s, resultText: `${head}。` };
  }
  return { state: s, resultText: '什么也没发生。' };
}

/**
 * 在浮层里选中一个选项（事件选项 or 建造强化）：
 *   - EVENT_CHOICE：应用该选项预掷定的因果（heal / damage / buff / none）→ EVENT_DONE；
 *   - CHOICE（BUILD）：记录到本局 Build → 推进到 next 节点。
 * 准入不满足 → 原状态（no-op，结构上不可重复结算）。
 */
export function chooseAdventureOption(
  s: AdventureState,
  optionId: string,
  ctx: AdventureContext,
  script: AdventureScript,
): AdventureState {
  if (advEventChoiceOpen(s)) {
    const node = advCurrentNode(s, script);
    if (node.kind !== 'EVENT') return s;
    const effect = node.outcomes[optionId];
    if (!effect) return s; // 未知选项 → 不结算
    const { state, resultText } = applyEffect(s, effect, ctx);
    const entries = [
      { kind: 'event' as AdventureLogKind, text: node.title },
      { kind: 'result' as AdventureLogKind, text: resultText },
    ];
    return goPhase(next(state, { eventResult: resultText, log: pushLogs(state.log, entries) }), 'EVENT_DONE', {});
  }

  if (advChoiceOpen(s)) {
    const node = advCurrentNode(s, script);
    if (node.kind !== 'BUILD') return s;
    const pool = advChoicePool(s, node, ctx);
    // 防御性：候选池为空（所有可见强化已拥有）→ 诚实跳过，不重复发放也不死锁。
    if (pool.length === 0) {
      if (node.next) return presentNode(s, node.next, script, ctx);
      return s;
    }
    const def = pool.find((d) => d.id === optionId);
    if (!def) return s; // 不在候选池 → 不结算
    const mod = runBuildOptionById(optionId);
    const logs = [{ kind: 'choice' as AdventureLogKind, text: mod?.logText ?? def.label }];
    let advanced = next(s, { buffs: [...s.buffs, optionId as RunBuildId], log: pushLogs(s.log, logs) });
    // F3：紧急维修 = 选择即真实修耐久（正式 Run 口径：0.25 × 上限，按缺口截断）。
    // 冒险此前只把它记进 buffs（运行时能力只认 kineticBurst）⇒ 选它等于空选；这里补上真实效果。
    // carriedHp 是「下一场战斗的开局耐久」⇒ 顶栏（F2 实时口径）与下一场真实 HP 同时兑现。
    if (optionId === 'emergencyRepair') {
      const repair = advEmergencyRepairGain(advanced.carriedHp ?? ctx.playerHpMax, ctx);
      advanced = next(advanced, {
        carriedHp: repair.hp,
        log: pushLogs(
          advanced.log,
          [
            repair.gained > 0
              ? { kind: 'durability' as AdventureLogKind, text: `车体修补完成，恢复了 ${repair.gained} 点耐久。` }
              : { kind: 'durability' as AdventureLogKind, text: '耐久已满，紧急维修没有可修的地方。' },
          ],
        ),
      });
    }
    if (node.next) return presentNode(advanced, node.next, script, ctx);
    return advanced;
  }

  return s;
}

/** 真实战斗的帧同步（只接受 BATTLE）。数值未变 → 同引用（no-op）。 */
export function syncAdventureBattle(s: AdventureState, sync: { playerHp: number; enemyHp: number; steps: number }): AdventureState {
  if (s.phase !== 'BATTLE' || !s.battle) return s;
  const b = s.battle;
  if (b.playerHp === sync.playerHp && b.enemyHp === sync.enemyHp && b.steps === sync.steps) return s;
  return next(s, { battle: { ...b, playerHp: sync.playerHp, enemyHp: sync.enemyHp, steps: sync.steps } });
}

export interface AdventureBattleOutcome {
  readonly winner: string | null;
  readonly endReason: string | null;
  readonly playerHp: number;
  readonly enemyHp: number;
  readonly steps: number;
}

/**
 * 战斗结束一次性判定（由宿主在官方 result 出现那一刻调用）：
 *   - playerHp <= 0 → FAILED（单一耐久贯穿本局的真源判据）；
 *   - 当前节点 FINAL → COMPLETE；
 *   - 其余 → RESULT（战报 + 节点 after）；
 *   并把真实剩余耐久写入 `carriedHp`，下一场从它继续（跨战斗耐久真实继承）。
 */
export function finishAdventureBattle(
  s: AdventureState,
  outcome: AdventureBattleOutcome,
  script: AdventureScript,
): AdventureState {
  if (s.phase !== 'BATTLE' || !s.battle) return s;
  const b: AdventureBattleState = {
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
  const battlesWon = s.battlesWon + (won ? 1 : 0);
  const outcomeLine = won ? '战斗胜利。' : '战车被打退，你撤出了战场。';
  const carried = Math.max(0, outcome.playerHp);
  const node = advCurrentNode(s, script);

  if (outcome.playerHp <= 0) {
    return goPhase(next(s, { battle: b, battlesCompleted, battlesWon, carriedHp: 0 }), 'FAILED', {
      log: pushLogs(s.log, [
        { kind: 'result', text: `战车耐久耗尽，DAY ${s.day} 的冒险到此结束。` },
        { kind: 'durability', text: `战车耐久剩余 ${durabilityPercent(b)}%。` },
      ]),
    });
  }
  if (node.kind === 'FINAL') {
    return goPhase(next(s, { battle: b, battlesCompleted, battlesWon, carriedHp: carried }), 'COMPLETE', {
      log: pushLogs(s.log, [
        { kind: 'result', text: outcomeLine },
        { kind: 'durability', text: `战车耐久剩余 ${durabilityPercent(b)}%。` },
        { kind: 'result', text: `你在第 ${script.dayTotal} 天走完了这趟路。` },
        { kind: 'result', text: '这次冒险到此结束。' },
      ]),
    });
  }
  const after = node.kind === 'BATTLE' && node.after ? node.after.map((t) => ({ kind: 'result' as AdventureLogKind, text: t })) : [];
  return goPhase(next(s, { battle: b, battlesCompleted, battlesWon, carriedHp: carried }), 'RESULT', {
    log: pushLogs(s.log, [
      { kind: 'result', text: outcomeLine },
      { kind: 'durability', text: `战车耐久剩余 ${durabilityPercent(b)}%。` },
      ...after,
    ]),
  });
}

function durabilityPercent(b: AdventureBattleState): number {
  if (b.playerHpMax <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((b.playerHp / b.playerHpMax) * 100)));
}
