/**
 * FRUITS-RANDOM-ADVENTURE-R2｜随机冒险脚本生成器（数据 + 纯生成，零副作用）。
 *
 * 职责（与冻结的 runScript.ts 完全脱钩）：
 *   - 给定 seed，生成一条**逐天推进**的节点序列（START → 事件 → 战斗 → 建造 → … → FINAL）；
 *   - R2 事件随机机制（验收 ①「不同冒险经历」）：三个事件槽**各自独立**从 [crate, wreck, rest]
 *     按种子抽取（有放回），⇒ 不同种子可产生**不同事件组合**（不只是换顺序），同类事件可在
 *     不同位置重复出现；同一事件类型重复时，结果**独立**掷定。
 *   - 每个事件选项的**因果在生成时即预掷定**（heal / damage / buff / none），
 *     同种子恒定 ⇒ 选择只是「揭晓」，不可通过重复点击重抽（验收 ②「结果仅结算一次」）。
 *
 * ⚠️ 本文件不 import 任何既有 Run 冻结文件；只复用 `runModifiers` 的**只读常量**
 *   （Run Build 候选池 / 修复比例）来生成「临时强化」与「修复量」，数值口径与正式一致。
 */
import { AdvRng, toSeed } from './advRng';
import {
  EMERGENCY_REPAIR_FRACTION,
  RUN_GENERIC_CHOICE_POOL,
  type RunBuildId,
} from '../runModifiers';

export type AdventureNodeKind = 'START' | 'BATTLE' | 'EVENT' | 'BUILD' | 'FINAL';
export type AdventureEventKind = 'crate' | 'wreck' | 'rest';
export type AdventureBuildPool = 'layer1' | 'layer2' | 'lateral' | 'generic';

export interface AdventureOption {
  readonly id: string;
  readonly label: string;
  readonly note: string;
}

/**
 * 事件选项在生成时已预先掷定的因果（同种子恒定；选择即揭晓，不可重抽）。
 *   - heal   ：恢复一段耐久（fraction 为占上限比例，运行时换算成具体点数）；
 *   - damage ：损失一段耐久；
 *   - buff   ：获得一项临时强化（buildId 取自正式 Run Build 候选池）；
 *   - none   ：无事发生。
 */
export type AdventureEffect =
  | { readonly kind: 'none' }
  | { readonly kind: 'heal'; readonly fraction: number }
  | { readonly kind: 'damage'; readonly fraction: number }
  | { readonly kind: 'buff'; readonly buildId: RunBuildId };

export interface AdventureStartNode {
  readonly id: string;
  readonly kind: 'START';
  readonly day: number;
  readonly beat: readonly string[];
  readonly next: string | null;
}
export interface AdventureBattleNode {
  readonly id: string;
  readonly kind: 'BATTLE' | 'FINAL';
  readonly day: number;
  readonly beat: readonly string[];
  readonly encounter?: readonly string[];
  readonly after?: readonly string[];
  readonly encounterId: string;
  readonly next: string | null;
}
export interface AdventureEventNode {
  readonly id: string;
  readonly kind: 'EVENT';
  readonly day: number;
  readonly eventKind: AdventureEventKind;
  readonly title: string;
  readonly beat: readonly string[];
  readonly options: readonly AdventureOption[];
  readonly outcomes: Readonly<Record<string, AdventureEffect>>;
  readonly next: string | null;
}
export interface AdventureBuildNode {
  readonly id: string;
  readonly kind: 'BUILD';
  readonly day: number;
  readonly beat: readonly string[];
  readonly poolKind: AdventureBuildPool;
  readonly next: string | null;
}
export type AdventureNode =
  | AdventureStartNode
  | AdventureBattleNode
  | AdventureEventNode
  | AdventureBuildNode;

export interface AdventureScript {
  readonly seed: number;
  readonly seedLabel: string;
  readonly firstId: string;
  readonly dayTotal: number;
  readonly nodes: Readonly<Record<string, AdventureNode>>;
  /** 事件序列（验收/调试：哪一天遇到哪种事件）。 */
  readonly eventPlan: readonly { day: number; eventKind: AdventureEventKind }[];
}

/** 临时修整之外的事件「损失耐久」比例（占上限）。与正式修复比例区分，避免过重的惩罚。 */
const ADV_DAMAGE_FRACTION = 0.2;

/** 事件种类池（R2：按种子独立抽取，允许同类重复出现）。 */
const EVENT_KINDS: readonly AdventureEventKind[] = ['crate', 'wreck', 'rest'];

/**
 * 事件「临时强化」候选池（R2 修正，验收③）：
 *   只取**路线无关**的正式 Run Build（damageUp / rateUp / emergencyRepair），
 *   保证对任意演示武器（Cannon 局）都真实生效、绝不静默变成别的奖励；
 *   且该池与 BUILD 节点的 layer1/layer2 池互不相交 ⇒ 不会与玩家已选强化重复 ⇒ 无「无效强化」。
 *   每个事件在生成时独立抽取；同一局内已抽过的强化会从后续抽取中排除（保证多样且不重复）。
 */
export const EVENT_BUFF_POOL: readonly RunBuildId[] = [...RUN_GENERIC_CHOICE_POOL];

/** 事件视觉与文案（仅展示/选项；因果在生成时掷定）。三种事件各有独立主题（UI 层据此一眼区分）。 */
const EVENT_CONTENT: Record<AdventureEventKind, { title: string; beat: readonly string[]; options: readonly AdventureOption[] }> = {
  crate: {
    title: '路边有一只神秘货箱',
    beat: ['你发现一只没人认领的货运箱，锁扣已经锈死。'],
    options: [
      { id: 'open', label: '撬开货箱', note: '也许有补给，也许有陷阱' },
      { id: 'leave', label: '绕道离开', note: '不冒这个险' },
    ],
  },
  wreck: {
    title: '一辆抛锚的废车',
    beat: ['路边停着一辆被遗弃的战车，车厢半开着。'],
    options: [
      { id: 'safe', label: '安全离开', note: '不贪心' },
      { id: 'scavenge', label: '冒险搜刮', note: '可能捡到好东西，也可能引火烧身' },
    ],
  },
  rest: {
    title: '找个地方临时修整',
    beat: ['天色尚可，你找到一处背风的角落。'],
    options: [
      { id: 'repair', label: '维修', note: '修回一段耐久' },
      { id: 'upgrade', label: '继续改装', note: '不修车，拿来改装配' },
    ],
  },
};

/**
 * 为某个事件类型掷定每个选项的因果（同种子恒定；选择即揭晓，不可重抽）。
 * `usedBuffs` 跨本局所有事件共享 ⇒ 同一局内已抽过的临时强化不会重复出现。
 */
function rollEventOutcomes(
  rng: AdvRng,
  kind: AdventureEventKind,
  usedBuffs: Set<RunBuildId>,
): Record<string, AdventureEffect> {
  const pickBuff = (): RunBuildId => {
    const avail = EVENT_BUFF_POOL.filter((id) => !usedBuffs.has(id));
    const pool = avail.length > 0 ? avail : EVENT_BUFF_POOL;
    const id = rng.pick(pool);
    usedBuffs.add(id);
    return id;
  };
  if (kind === 'crate') {
    return {
      leave: { kind: 'none' },
      open: rng.chance(0.5)
        ? { kind: 'heal', fraction: EMERGENCY_REPAIR_FRACTION }
        : { kind: 'buff', buildId: pickBuff() },
    };
  }
  if (kind === 'wreck') {
    return {
      safe: { kind: 'none' },
      scavenge: rng.chance(0.5)
        ? { kind: 'buff', buildId: pickBuff() }
        : { kind: 'damage', fraction: ADV_DAMAGE_FRACTION },
    };
  }
  // rest：维修 = 修复；继续改装 = 临时强化（均预掷定，选择即揭晓）
  return {
    repair: { kind: 'heal', fraction: EMERGENCY_REPAIR_FRACTION },
    upgrade: { kind: 'buff', buildId: pickBuff() },
  };
}

function makeEventNode(
  id: string,
  day: number,
  kind: AdventureEventKind,
  rng: AdvRng,
  usedBuffs: Set<RunBuildId>,
): AdventureEventNode {
  const c = EVENT_CONTENT[kind];
  return {
    id,
    kind: 'EVENT',
    day,
    eventKind: kind,
    title: c.title,
    beat: c.beat,
    options: c.options,
    outcomes: rollEventOutcomes(rng, kind, usedBuffs),
    next: null,
  };
}

/**
 * 生成一条完整的随机冒险脚本。
 *
 * 节奏（逐天推进、保证三次真实战斗 + 两次 Run Build + 三处事件槽）：
 *   DAY1 START → DAY2 事件A → DAY3 BATTLE(ProtoRusher) → DAY4 BUILD(layer1)
 *        → DAY5 事件B → DAY6 BATTLE(Chaser) → DAY7 BUILD(layer2)
 *        → DAY8 事件C → DAY9 FINAL(Chaser) → COMPLETE / FAILED
 *
 * 难度编排（原型可玩性优先）：采用基线 AI 主角可赢下的 ProtoRusher / Chaser，
 * 随耐久递减后续遭遇保持可赢 ⇒ 闭环可被赢下，失败是真实风险而非必然。
 * ⚠️ RangedTurret 暂未纳入 R1：基线 AI 主角在其面前胜率为 0，留待玩家手动操控接入后再启用；
 *    这属于原型已知限制，不改动任何正式物理 / 武器数值。
 *
 * 事件随机（R2，验收 ①）：三个事件槽**各自独立**从 [crate, wreck, rest] 按种子抽取（有放回），
 *   ⇒ 不同种子可产生**不同事件组合**（如 [crate,crate,wreck] / [rest,rest,rest] / [wreck,crate,wreck]），
 *      不只是换顺序；同类事件可在不同位置重复出现，且每次结果**独立**掷定。
 *   同一种子恒定 ⇒ 完整可复现。
 */
export function generateAdventureScript(seedInput: string | number): AdventureScript {
  const seed = toSeed(seedInput);
  const rng = new AdvRng(seed);
  /** 三个事件槽各自独立抽取（有放回），允许同类重复 ⇒ 不同组合。 */
  const eventKinds: AdventureEventKind[] = [rng.pick(EVENT_KINDS), rng.pick(EVENT_KINDS), rng.pick(EVENT_KINDS)];
  /** 本局已抽过的临时强化，保证事件强化多样且不重复。 */
  const usedBuffs = new Set<RunBuildId>();

  const list: AdventureNode[] = [
    {
      id: 'a1-start',
      kind: 'START',
      day: 1,
      beat: ['你驾驶着{vehicle}，驶入一片未知的荒原。', '这趟冒险要走九天。'],
      next: null,
    },
    makeEventNode('a2-event', 2, eventKinds[0], rng, usedBuffs),
    {
      id: 'a3-battle1',
      kind: 'BATTLE',
      day: 3,
      beat: ['第三天，碎石路把车带向远处。'],
      encounter: ['引擎轰鸣由远及近。', '你遭遇了{enemy}。'],
      after: ['你发现了一次改装机会……'],
      encounterId: 'ProtoRusher',
      next: null,
    },
    {
      id: 'a4-build1',
      kind: 'BUILD',
      day: 4,
      beat: ['第四天，你停下来整理装备。'],
      poolKind: 'layer1',
      next: null,
    },
    makeEventNode('a5-event', 5, eventKinds[1], rng, usedBuffs),
    {
      id: 'a6-battle2',
      kind: 'BATTLE',
      day: 6,
      beat: ['第六天，路变得开阔起来。'],
      encounter: ['一台车从侧后方咬了上来，速度比你快。', '你遭遇了{enemy}。'],
      after: ['你又找到了一次改装的机会……'],
      encounterId: 'Chaser',
      next: null,
    },
    {
      id: 'a7-build2',
      kind: 'BUILD',
      day: 7,
      beat: ['第七天，你为下一次遭遇做准备。'],
      poolKind: 'layer2',
      next: null,
    },
    makeEventNode('a8-event', 8, eventKinds[2], rng, usedBuffs),
    {
      id: 'a9-final',
      kind: 'FINAL',
      day: 9,
      beat: ['第九天，最后一段路。'],
      encounter: ['一台车孤零零地挡在路中央，引擎已经熄火了一半。', '你遭遇了{enemy}。'],
      encounterId: 'Chaser',
      next: null,
    },
  ];

  const nodes: Record<string, AdventureNode> = {};
  for (let i = 0; i < list.length; i++) {
    const node = { ...list[i], next: i < list.length - 1 ? list[i + 1].id : null };
    nodes[node.id] = node;
  }

  const eventPlan = list
    .filter((n): n is AdventureEventNode => n.kind === 'EVENT')
    .map((n) => ({ day: n.day, eventKind: n.eventKind }));

  return {
    seed,
    seedLabel: String(seedInput),
    firstId: 'a1-start',
    dayTotal: 9,
    nodes,
    eventPlan,
  };
}

/** 没有指定 seed 时，用时间生成一个「随机但可展示」的种子标签。 */
export function randomSeedLabel(): string {
  return `R${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}
