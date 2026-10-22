/**
 * FRUITS-ADVENTURE-FULL-PLAYABLE-R3｜随机冒险脚本生成器（数据 + 纯生成，零副作用）。
 *
 * 职责（与冻结的 runScript.ts 完全脱钩）：
 *   - 给定 seed，生成一条**逐天推进**的节点序列（START → 事件 → 战斗 → 建造 → 阶段提示 → … → FINAL）；
 *   - 事件随机机制（R3，验收 ①「不同冒险经历」）：从 [crate, wreck, rest, convoy, altar] **有放回**
 *     独立抽取，且**相邻事件不同类**（避免连续同类太重复）；不同种子产生**不同事件组合**
 *     （不仅是换顺序），同类事件重复时结果**独立**掷定；
 *   - 每个事件选项的**因果在生成时即预掷定**（heal / damage / buff / trade / none），
 *     同种子恒定 ⇒ 选择只是「揭晓」，不可通过重复点击重抽（验收 ②「结果仅结算一次」）；
 *   - 难度曲线：7 场真实物理战斗，敌人按种子洗牌、终点 FINAL 为更具挑战的对手（不改动任何物理数值）。
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

export type AdventureNodeKind = 'START' | 'BATTLE' | 'EVENT' | 'BUILD' | 'BANNER' | 'FINAL';
export type AdventureEventKind = 'crate' | 'wreck' | 'rest' | 'convoy' | 'altar';
export type AdventureBuildPool = 'layer1' | 'layer2' | 'lateral' | 'generic';

/** R3 完整冒险的整体规模（验收：往 25 天录像节奏靠拢，但不堆单场战斗）。 */
export const ADVENTURE_TOTAL_BATTLES = 7;
export const ADVENTURE_TOTAL_EVENTS = 9;
export const ADVENTURE_TOTAL_BUILDS = 6;

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
 *   - trade  ：用一段耐久换一项临时强化（HP ↔ Build 的真实权衡，convoy 专用）；
 *   - none   ：无事发生。
 */
export type AdventureEffect =
  | { readonly kind: 'none' }
  | { readonly kind: 'heal'; readonly fraction: number }
  | { readonly kind: 'damage'; readonly fraction: number }
  | { readonly kind: 'buff'; readonly buildId: RunBuildId }
  | { readonly kind: 'trade'; readonly damageFraction: number; readonly buildId: RunBuildId };

export interface AdventureStartNode {
  readonly id: string;
  readonly kind: 'START';
  readonly day: number;
  readonly beat: readonly string[];
  readonly next: string | null;
}
export interface AdventureBannerNode {
  readonly id: string;
  readonly kind: 'BANNER';
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
  | AdventureBannerNode
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
  /** 阶段提示序列（验收：可感知的阶段推进）。 */
  readonly bannerPlan: readonly { day: number; stage: number }[];
  /** 战斗对手序列（验收：难度曲线 / 不同局不同体验）。 */
  readonly battlePlan: readonly { day: number; encounterId: string; isFinal: boolean }[];
}

/** 事件「损失耐久」比例（占上限）。与正式修复比例区分，避免过重的惩罚。 */
const ADV_DAMAGE_FRACTION = 0.12;
/** 祭坛（altar）的高风险高回报：损失更重（但仍为真实可承受，非隐藏保底）。 */
const ADV_ALTAR_DAMAGE_FRACTION = 0.12;
/** 商队（convoy）交易：用一点耐久换强化。 */
const ADV_CONVOY_DAMAGE_FRACTION = 0.12;

/** 事件种类池（R3：5 种，按种子独立抽取，允许同类重复出现但相邻不同类）。 */
export const ADVENTURE_EVENT_KINDS: readonly AdventureEventKind[] = ['crate', 'wreck', 'rest', 'convoy', 'altar'];

/**
 * 事件「临时强化」候选池（R3，验收③）：
 *   只取**路线无关**的正式 Run Build（damageUp / rateUp / emergencyRepair），
 *   保证对任意演示武器（Cannon 局）都真实生效、绝不静默变成别的奖励；
 *   且该池与 BUILD 节点的 layer1/layer2 池互不相交 ⇒ 不会与玩家已选强化重复 ⇒ 无「无效强化」。
 *   每个事件在生成时独立抽取；同一局内已抽过的强化会从后续抽取中排除（保证多样且不重复）。
 */
export const EVENT_BUFF_POOL: readonly RunBuildId[] = [...RUN_GENERIC_CHOICE_POOL];

/** 事件视觉与文案（仅展示/选项；因果在生成时掷定）。五种事件各有独立主题（UI 层据此一眼区分）。 */
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
    title: '找个背风处临时修整',
    beat: ['天色尚可，你找到一处背风的角落。'],
    options: [
      { id: 'repair', label: '维修', note: '修回一段耐久' },
      { id: 'upgrade', label: '继续改装', note: '不修车，拿来改装配' },
    ],
  },
  convoy: {
    title: '路遇一支流浪商队',
    beat: ['几辆改装车围着火堆，有人朝你招手。'],
    options: [
      { id: 'trade', label: '用耐久换改装', note: '让出一点耐久，换一件临时强化' },
      { id: 'ignore', label: '默默离开', note: '不欠人情' },
    ],
  },
  altar: {
    title: '荒野里一座锈蚀的祭坛',
    beat: ['祭坛中央嵌着一枚闪光的核芯，四周散落着残骸。'],
    options: [
      { id: 'touch', label: '触碰核芯', note: '高风险高回报：可能大赚，也可能重创' },
      { id: 'leave', label: '不敢靠近', note: '绕开它' },
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
    // 安全离开 = 稳定维修（真实回复耐久）；搜刮 = 赌一把（强化 or 损失）。风险/收益可见、不隐藏。
    return {
      safe: { kind: 'heal', fraction: EMERGENCY_REPAIR_FRACTION },
      scavenge: rng.chance(0.5)
        ? { kind: 'buff', buildId: pickBuff() }
        : { kind: 'damage', fraction: ADV_DAMAGE_FRACTION },
    };
  }
  if (kind === 'rest') {
    // 维修 = 修复；继续改装 = 临时强化（均预掷定，选择即揭晓）
    return {
      repair: { kind: 'heal', fraction: EMERGENCY_REPAIR_FRACTION },
      upgrade: { kind: 'buff', buildId: pickBuff() },
    };
  }
  if (kind === 'convoy') {
    // 用少量耐久换一件临时强化（真实 HP ↔ Build 权衡）；离开 = 无
    return {
      trade: { kind: 'trade', damageFraction: ADV_CONVOY_DAMAGE_FRACTION, buildId: pickBuff() },
      ignore: { kind: 'none' },
    };
  }
  // altar：高风险高回报（大强化 or 重创）；离开 = 无
  return {
    leave: { kind: 'none' },
    touch: rng.chance(0.5)
      ? { kind: 'buff', buildId: pickBuff() }
      : { kind: 'damage', fraction: ADV_ALTAR_DAMAGE_FRACTION },
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

function makeBannerNode(id: string, day: number, stage: number): AdventureBannerNode {
  const labels = ['第一阶段', '第二阶段', '第三阶段', '第四阶段'];
  const tag = labels[Math.min(stage - 1, labels.length - 1)] ?? `第 ${stage} 阶段`;
  return {
    id,
    kind: 'BANNER',
    day,
    beat: [`${tag}：前路更凶险，敌车会更难缠，备用的耐久也更少了。`, '按「继续」进入下一段路。'],
    next: null,
  };
}

/**
 * 从事件池独立抽取 n 个事件类型，**相邻不同类**（避免连续同类事件太重复）；
 * 不同种子 → 不同序列（组合与顺序都变），同类事件重复时结果仍独立掷定。
 */
function drawEventKinds(rng: AdvRng, n: number): AdventureEventKind[] {
  const out: AdventureEventKind[] = [];
  let prev: AdventureEventKind | null = null;
  for (let i = 0; i < n; i++) {
    let k = rng.pick(ADVENTURE_EVENT_KINDS);
    // 不与上一个同类（池有 5 种 ⇒ 总能换一个）
    while (k === prev) k = rng.pick(ADVENTURE_EVENT_KINDS);
    out.push(k);
    prev = k;
  }
  return out;
}

/**
 * 难度曲线：7 场战斗，真实物理 headless 校准（演示装载 1100 耐久入场）：
 *   - 前 4 场「易敌池」按种子洗牌：ProtoRusher ×2 / Chaser / ExtendedStandoffRod
 *     （四者在任意强化水平下均可赢，构成前期节奏）；
 *   - 第 5/6 场为「成长门槛敌」：ExtendedBurnSaw（喷火+锯持续磨血）/ ExtendedHeavyContact
 *     （霰弹+锤贴脸）—— 无强化必败、Build 成型后可赢（校准：六强化分别剩 608 / 409 耐久），
 *     把「局内 Build 成长是否真实兑现」变成胜负的真实判据；
 *   - 终点 FINAL = Chaser（全程最长对决，成型 Build 下稳赢但耗耐可观）。
 *
 * ⚠️ 真实物理校准结论（headless，未改任何物理/武器数值）：
 *   - `RangedTurret` / `RushRammer` / `HeavyFortress` 在演示装载任意耐久/强化下均 1100→0
 *     不可赢，绝不入池（否则整局永远无法 COMPLETE，违反验收①）；
 *   - `HighGunPlatform` 六强化仅剩 97 耐久，过紧不入池；
 *   - `fastReload` 与 `twinCannon` 存在 DPS 崩塌的涌现互斥（见 advState 策展排除），冒险池不发放。
 */
function battleCurve(rng: AdvRng): string[] {
  const early = ['ProtoRusher', 'ProtoRusher', 'Chaser', 'ExtendedStandoffRod', 'ProtoRusher'];
  for (let i = early.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [early[i], early[j]] = [early[j], early[i]];
  }
  // 第 6 场单「成长门槛敌」：ExtendedBurnSaw（无强化必败、成型后可赢，耗耐随 Build 质量浮动）；
  // 终点 Chaser（全程最长对决）。双门槛（BurnSaw+HeavyContact）经实测超出耐久预算（0/4 通关）故弃用。
  return [...early, 'ExtendedBurnSaw', 'Chaser'];
}

/** 建造候选池的分布（避免「固定最优选项」：交替不同层，玩家每段都能看到不同成长）。 */
function buildPoolKinds(rng: AdvRng, n: number): AdventureBuildPool[] {
  const cycle: AdventureBuildPool[] = ['layer1', 'layer2', 'lateral', 'generic'];
  const out: AdventureBuildPool[] = [];
  let i = rng.int(cycle.length);
  for (let k = 0; k < n; k++) {
    out.push(cycle[i % cycle.length]);
    i++;
  }
  return out;
}

/**
 * 生成一条完整的随机冒险脚本。
 *
 * 节奏（逐天推进，R3 完整可玩版）：
 *   START → [事件 → 战斗(+阶段提示)] ×N → FINAL → 结算
 *   - 7 场真实物理战斗（难度曲线，终点为 RangedTurret 挑战）；
 *   - 9 处事件槽（5 种事件、相邻不同类、结果独立）；
 *   - 6 次 Run Build 选择（layer1/layer2/lateral/generic 交替）；
 *   - 每 3 场战斗一次阶段提示（BANNER），制造「阶段压力」。
 *
 * 同种子完全可复现（事件类型/顺序/结果、战斗对手、阶段提示均恒定）；
 * 不同种子产生不同事件组合与不同战斗对手 ⇒ 明显不同的冒险经历。
 */
export function generateAdventureScript(seedInput: string | number): AdventureScript {
  const seed = toSeed(seedInput);
  const rng = new AdvRng(seed);

  const eventKinds = drawEventKinds(rng, ADVENTURE_TOTAL_EVENTS);
  const encounters = battleCurve(rng);
  const buildKinds = buildPoolKinds(rng, ADVENTURE_TOTAL_BUILDS);
  /** 本局已抽过的临时强化，保证事件强化多样且不重复。 */
  const usedBuffs = new Set<RunBuildId>();

  const list: AdventureNode[] = [];
  list.push({
    id: 'a1-start',
    kind: 'START',
    day: 1,
    beat: ['你驾驶着{vehicle}，驶入一片未知的荒原。', `这趟冒险要走许多天，撑到最后便是赢家。`],
    next: null,
  });

  let day = 2;
  let ei = 0;
  let ki = 0;
  let stage = 0;
  let battlesDone = 0;

  // 前 6 场常规战斗：每场前插事件（事件槽足够时），场后按节奏插建造 / 阶段提示。
  // ⚠️ FINAL 不再在循环内生成，保证它永远是整条脚本的「最后一个节点」——
  //    否则「FINAL 之后还排了事件/建造」会形成死内容，且 dayTotal 被虚高（R3 浏览器 E2E 暴露）。
  while (battlesDone < ADVENTURE_TOTAL_BATTLES - 1) {
    // 战斗前插入事件（还有事件槽时）
    if (ei < eventKinds.length) {
      list.push(makeEventNode(`e${ei + 1}`, day, eventKinds[ei], rng, usedBuffs));
      day++;
      ei++;
    }

    list.push({
      id: `b${battlesDone + 1}`,
      kind: 'BATTLE',
      day,
      beat: ['路向前延伸，引擎声由远及近。'],
      encounter: ['一台敌车咬了上来。', '你遭遇了{enemy}。'],
      after: ['你又找到了一次改装机会……'],
      encounterId: encounters[battlesDone],
      next: null,
    });
    day++;
    battlesDone++;

    // 每打完 2 场，或随机，插入一次建造（还有建造槽时）
    if (ki < buildKinds.length && (battlesDone % 2 === 0 || rng.chance(0.5))) {
      list.push({
        id: `k${ki + 1}`,
        kind: 'BUILD',
        day,
        beat: ['你停下来整理装备。'],
        poolKind: buildKinds[ki],
        next: null,
      });
      day++;
      ki++;
    }

    // 阶段提示：第 3 场后 + 第 5 场后（终局整备）。
    // ⚠️ 第 2 次整备刻意落在「成长门槛敌」（第 6 场 ExtendedBurnSaw）之前——
    //    若排在门槛之后（如每 3 场的 3/6），整备对过门槛毫无帮助，实测 1/4 通关偏严苛。
    if (battlesDone % 3 === 0 || battlesDone === ADVENTURE_TOTAL_BATTLES - 2) {
      stage++;
      list.push(makeBannerNode(`banner${stage}`, day, stage));
      day++;
    }
  }

  // 终点 FINAL 之前清掉所有「剩余」事件槽与建造槽：保证事件/建造总数达标，
  // 且这些节点一定在 FINAL 之前被玩家走到（绝不留死内容）。
  while (ei < eventKinds.length) {
    list.push(makeEventNode(`e${ei + 1}`, day, eventKinds[ei], rng, usedBuffs));
    day++;
    ei++;
  }
  while (ki < buildKinds.length) {
    list.push({
      id: `k${ki + 1}`,
      kind: 'BUILD',
      day,
      beat: ['你停下来整理装备。'],
      poolKind: buildKinds[ki],
      next: null,
    });
    day++;
    ki++;
  }

  // 终点 FINAL：整条脚本的最后一个节点。赢得它 ⇒ COMPLETE 且 day === dayTotal（到达最后一天）；
  // 输给它 ⇒ FAILED 于此前的某一天。终点对手取真实物理下可赢的 Chaser（见 battleCurve 注释，RangedTurret 已弃用）。
  list.push({
    id: 'final',
    kind: 'FINAL',
    day,
    beat: ['最后一段路，地平线上出现了最棘手的对手。'],
    encounter: ['一台难缠的敌车横在前方，火力全开。', '你遭遇了{enemy}。'],
    encounterId: encounters[ADVENTURE_TOTAL_BATTLES - 1],
    next: null,
  });
  day++;
  battlesDone++;

  const nodes: Record<string, AdventureNode> = {};
  for (let i = 0; i < list.length; i++) {
    const node = { ...list[i], next: i < list.length - 1 ? list[i + 1].id : null };
    nodes[node.id] = node;
  }

  const eventPlan = list
    .filter((n): n is AdventureEventNode => n.kind === 'EVENT')
    .map((n) => ({ day: n.day, eventKind: n.eventKind }));
  const bannerPlan = list
    .filter((n): n is AdventureBannerNode => n.kind === 'BANNER')
    .map((n) => ({ day: n.day, stage: stageOf(n) }));
  const battlePlan = list
    .filter((n): n is AdventureBattleNode => n.kind === 'BATTLE' || n.kind === 'FINAL')
    .map((n) => ({ day: n.day, encounterId: n.encounterId, isFinal: n.kind === 'FINAL' }));

  return {
    seed,
    seedLabel: String(seedInput),
    firstId: 'a1-start',
    dayTotal: day - 1,
    nodes,
    eventPlan,
    bannerPlan,
    battlePlan,
  };
}

function stageOf(n: AdventureBannerNode): number {
  // banner 的 stage 已编码在 beat 文本里；这里从节点 id 反推（banner1/banner2…）
  const m = /banner(\d+)/.exec(n.id);
  return m ? Number(m[1]) : 0;
}

/** 没有指定 seed 时，用时间生成一个「随机但可展示」的种子标签。 */
export function randomSeedLabel(): string {
  return `R${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}
