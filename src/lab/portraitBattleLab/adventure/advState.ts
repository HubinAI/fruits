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
 *   且每个事件的结果**只结算一次**（选项因果在脚本生成时已预掷定，选择即揭晓，
 *   进入 EVENT_DONE 后不可再选、刷新/重抽均不改变已落定的效果）。
 */
import {
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

/** 真实战斗节点使用的三个既有正式 Encounter 的展示名（仅展示用；战斗本身由 RunBattleRuntime 解析）。 */
export const ADV_ENEMY_LABELS: Readonly<Record<string, string>> = {
  ProtoRusher: '原型冲撞者',
  Chaser: '追击者',
  RangedTurret: '远程炮塔车',
};

const ADV_LOG_MAX = 240;
const ADV_HP_FLOOR_FRACTION = 0.1;

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
  const entries: { kind: AdventureLogKind; text: string }[] = [];
  if (node.day !== s.day) entries.push({ kind: 'day', text: `DAY ${node.day}` });
  for (const line of node.beat) entries.push({ kind: 'travel', text: subst(line, ctx, node) });
  return goPhase(next(s, { nodeId, day: node.day, log: pushLogs(s.log, entries) }), phaseForNode(node.kind), {});
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
      return '完成本次冒险';
    case 'FAILED':
      return '重新开始冒险';
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

/** 当前 BUILD 节点的候选池（结构去重：剔除已拥有的强化）。 */
export function advChoicePool(
  s: AdventureState,
  node: AdventureNode,
  ctx: AdventureContext,
): readonly { readonly id: RunBuildId; readonly label: string; readonly note: string }[] {
  if (node.kind !== 'BUILD') return [];
  let defs: readonly RunModifierDef[];
  switch (node.poolKind) {
    case 'layer1':
      defs = runLayer1PoolDefs();
      break;
    case 'layer2':
      defs = runLayer2PoolDefs(advMainRouteId(s) ?? '');
      break;
    case 'lateral':
      defs = runLateralPoolDefs(s.buffs);
      break;
    case 'generic':
      return runGenericChoiceDefs(s.buffs, ctx.baseWeaponDefId);
  }
  return defs
    .filter((d) => !s.buffs.includes(d.id as RunBuildId))
    .map((d) => ({ id: d.id as RunBuildId, label: d.label, note: d.note }));
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
 *   终态                  → 全新一局（同一脚本 / 同种子，可复现）
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

/** 把事件效果落到状态（返回新状态 + 结果文本）。 */
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
    return {
      state: next(s, { carriedHp: after }),
      resultText: `你恢复了 ${gained} 点耐久（当前 ${after}/${maxHp}）。`,
    };
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
  if (effect.kind === 'buff') {
    // 事件强化来自 EVENT_BUFF_POOL（路线无关、对演示武器恒有效），生成时已排除重复 ⇒ 默认直接计入。
    // 若（理论上不会发生的）重复，则透明告知，不静默改成别的奖励（验收③）。
    const mod = runBuildOptionById(effect.buildId);
    const label = mod?.label ?? effect.buildId;
    if (s.buffs.includes(effect.buildId)) {
      return {
        state: s,
        resultText: `预掷的是「${label}」，但你已拥有，本次不重复计入（耐久不变）。`,
      };
    }
    return {
      state: next(s, { buffs: [...s.buffs, effect.buildId] }),
      resultText: `你获得了临时强化：${label}（已生效，下一场战斗计入）。`,
    };
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
    const def = pool.find((d) => d.id === optionId);
    if (!def) return s; // 不在候选池 → 不结算
    const mod = runBuildOptionById(optionId);
    const logs = [{ kind: 'choice' as AdventureLogKind, text: mod?.logText ?? def.label }];
    const advanced = next(s, { buffs: [...s.buffs, optionId as RunBuildId], log: pushLogs(s.log, logs) });
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
  const outcomeLine = won ? '战斗胜利。' : '战车被打退，你撤出了战场。';
  const carried = Math.max(0, outcome.playerHp);
  const node = advCurrentNode(s, script);

  if (outcome.playerHp <= 0) {
    return goPhase(next(s, { battle: b, battlesCompleted, carriedHp: 0 }), 'FAILED', {
      log: pushLogs(s.log, [
        { kind: 'result', text: `战车耐久耗尽，DAY ${s.day} 的冒险到此结束。` },
        { kind: 'durability', text: `战车耐久剩余 ${durabilityPercent(b)}%。` },
      ]),
    });
  }
  if (node.kind === 'FINAL') {
    return goPhase(next(s, { battle: b, battlesCompleted, carriedHp: carried }), 'COMPLETE', {
      log: pushLogs(s.log, [
        { kind: 'result', text: outcomeLine },
        { kind: 'durability', text: `战车耐久剩余 ${durabilityPercent(b)}%。` },
        { kind: 'result', text: `你在第 ${script.dayTotal} 天走完了这趟路。` },
        { kind: 'result', text: '这次冒险到此结束。' },
      ]),
    });
  }
  const after = node.kind === 'BATTLE' && node.after ? node.after.map((t) => ({ kind: 'result' as AdventureLogKind, text: t })) : [];
  return goPhase(next(s, { battle: b, battlesCompleted, carriedHp: carried }), 'RESULT', {
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
