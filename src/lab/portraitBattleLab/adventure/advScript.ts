/**
 * FRUITS-RANDOM-ADVENTURE-R1｜随机冒险脚本生成器（数据 + 纯生成，零副作用）。
 *
 * 职责（与冻结的 runScript.ts 完全脱钩）：
 *   - 给定 seed，生成一条**逐天推进**的节点序列（START → 事件 → 战斗 → 建造 → … → FINAL）；
 *   - 三种非战斗事件（神秘货箱 / 废车搜刮 / 临时修整）按 seed 排列顺序，**每局都齐活**，
 *     但顺序随种子变化 ⇒ 不同种子出现不同顺序（验收 ①「同装配多局出现不同事件」）；
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
  RUN_LAYER1_POOL,
  RUN_LAYER2_POOLS,
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

/** 临时强化候选池（Cannon 局可见的全部 Run Build id；与正式候选集同源）。 */
export const BUFF_CANDIDATES: readonly RunBuildId[] = [
  ...RUN_LAYER1_POOL,
  ...Object.values(RUN_LAYER2_POOLS).flat(),
  ...RUN_GENERIC_CHOICE_POOL,
];

interface EventContent {
  readonly title: string;
  readonly beat: readonly string[];
  readonly options: readonly AdventureOption[];
  /** 给定 rng，为每个选项掷定因果。 */
  rollOutcomes(rng: AdvRng): Record<string, AdventureEffect>;
}

const EVENT_CONTENT: Record<AdventureEventKind, EventContent> = {
  crate: {
    title: '路边有一只神秘货箱',
    beat: ['你发现一只没人认领的货运箱，锁扣已经锈死。'],
    options: [
      { id: 'open', label: '撬开货箱', note: '也许有补给，也许有陷阱' },
      { id: 'leave', label: '绕道离开', note: '不冒这个险' },
    ],
    rollOutcomes(rng) {
      const outcomes: Record<string, AdventureEffect> = { leave: { kind: 'none' } };
      outcomes.open = rng.chance(0.5)
        ? { kind: 'heal', fraction: EMERGENCY_REPAIR_FRACTION }
        : { kind: 'buff', buildId: rng.pick(BUFF_CANDIDATES) };
      return outcomes;
    },
  },
  wreck: {
    title: '一辆抛锚的废车',
    beat: ['路边停着一辆被遗弃的战车，车厢半开着。'],
    options: [
      { id: 'safe', label: '安全离开', note: '不贪心' },
      { id: 'scavenge', label: '冒险搜刮', note: '可能捡到好东西，也可能引火烧身' },
    ],
    rollOutcomes(rng) {
      const outcomes: Record<string, AdventureEffect> = { safe: { kind: 'none' } };
      outcomes.scavenge = rng.chance(0.5)
        ? { kind: 'buff', buildId: rng.pick(BUFF_CANDIDATES) }
        : { kind: 'damage', fraction: ADV_DAMAGE_FRACTION };
      return outcomes;
    },
  },
  rest: {
    title: '找个地方临时修整',
    beat: ['天色尚可，你找到一处背风的角落。'],
    options: [
      { id: 'repair', label: '维修', note: '修回一段耐久' },
      { id: 'upgrade', label: '继续改装', note: '不修车，拿来改装配' },
    ],
    rollOutcomes(rng) {
      // 维修 = 修复（与正式 DURABILITY 同源比例）；继续改装 = 临时强化。
      return {
        repair: { kind: 'heal', fraction: EMERGENCY_REPAIR_FRACTION },
        upgrade: { kind: 'buff', buildId: rng.pick(BUFF_CANDIDATES) },
      };
    },
  },
};

function makeEventNode(
  id: string,
  day: number,
  kind: AdventureEventKind,
  rng: AdvRng,
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
    outcomes: c.rollOutcomes(rng),
    next: null,
  };
}

/** Fisher–Yates 洗牌（用 rng，保证可复现）。 */
function shuffle<T>(arr: readonly T[], rng: AdvRng): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * 生成一条完整的随机冒险脚本。
 *
 * 节奏（逐天推进、保证三次真实战斗 + 两次 Run Build + 三种事件各一次）：
 *   DAY1 START → DAY2 事件A → DAY3 BATTLE(ProtoRusher) → DAY4 BUILD(layer1)
 *        → DAY5 事件B → DAY6 BATTLE(Chaser) → DAY7 BUILD(layer2)
 *        → DAY8 事件C → DAY9 FINAL(Chaser) → COMPLETE / FAILED
 *
 * 难度编排（原型可玩性优先）：采用基线 AI 主角可赢下的 ProtoRusher / Chaser，
 * 随耐久递减后续遭遇保持可赢 ⇒ 闭环可被赢下，失败是真实风险而非必然。
 * ⚠️ RangedTurret 暂未纳入 R1：基线 AI 主角在其面前胜率为 0，留待玩家手动操控接入后再启用；
 *    这属于原型已知限制，不改动任何正式物理 / 武器数值。
 *
 * 事件 A/B/C 是 [crate, wreck, rest] 的一个**种子洗牌排列** ⇒ 每局三种事件都出现，
 * 但顺序随种子变化；每个事件结果的因果在生成时即确定。
 */
export function generateAdventureScript(seedInput: string | number): AdventureScript {
  const seed = toSeed(seedInput);
  const rng = new AdvRng(seed);
  const eventOrder = shuffle<AdventureEventKind>(['crate', 'wreck', 'rest'], rng);

  const list: AdventureNode[] = [
    {
      id: 'a1-start',
      kind: 'START',
      day: 1,
      beat: ['你驾驶着{vehicle}，驶入一片未知的荒原。', '这趟冒险要走九天。'],
      next: null,
    },
    makeEventNode('a2-event', 2, eventOrder[0], rng),
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
    makeEventNode('a5-event', 5, eventOrder[1], rng),
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
    makeEventNode('a8-event', 8, eventOrder[2], rng),
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
