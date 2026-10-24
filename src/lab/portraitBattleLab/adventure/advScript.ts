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
 * 事件选项因果（R4 修订）：耐久类（heal/damage）在生成时预掷定；**强化身份在领取时解析**——
 * 生成期只按种子掷定候选顺序（`candidates`），领取时取第一个未拥有的候选。
 *   - 修复 R3 缺陷：生成期预分配并占用 EVENT_BUFF_POOL（仅 3 项而事件多达 9 个），
 *     未领取的奖励白白占池 ⇒ 后续事件整池重抽 ⇒ 必出「已拥有，不重复计入」的零收益中奖；
 *   - 候选顺序同种子恒定 + 解析是 `state.buffs` 的纯函数 ⇒ 同种子 + 同选择 = 同结果（可复现不变）；
 *   - 结算仍一次性（chooseAdventureOption 单向推进，EVENT_DONE 后不可重选/重抽）。
 *   - heal   ：恢复一段耐久（fraction 为占上限比例，运行时换算成具体点数）；
 *   - damage ：损失一段耐久；
 *   - buff   ：获得一项临时强化（领取时从 candidates 取第一个未拥有项；全拥有 → 补救维修 / 如实空手）；
 *   - trade  ：用一段耐久换一项临时强化（仅当领到未拥有强化时才扣耐久——绝不无收益扣血）；
 *   - none   ：无事发生。
 */
export type AdventureEffect =
  | { readonly kind: 'none' }
  | { readonly kind: 'heal'; readonly fraction: number }
  | { readonly kind: 'damage'; readonly fraction: number }
  | { readonly kind: 'buff'; readonly candidates: readonly RunBuildId[] }
  | { readonly kind: 'trade'; readonly damageFraction: number; readonly candidates: readonly RunBuildId[] };

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
  /**
   * 本节点之后、**下一场战斗**（BATTLE / FINAL）之前的**自动阶段整备**（BANNER）次数。
   *
   * ⚠️ 生成期按链序回填（见 `generateAdventureScript` 的节点装配）：只有 BANNER 是**必然发生**
   *    的免费恢复；EVENT 的恢复要玩家当场选（可能回血、也可能扣血），属于玩家选择，不计入。
   *    F5 用它判定「此刻选紧急维修，会不会被紧随其后的整备完全吞掉」。
   */
  readonly autoResupplyBeforeBattle: number;
  readonly next: string | null;
}
export type AdventureNode =
  | AdventureStartNode
  | AdventureBannerNode
  | AdventureBattleNode
  | AdventureEventNode
  | AdventureBuildNode;

/**
 * 生成期的节点草稿：与最终节点相比只缺 `next`（链序在装配时统一回填），
 * BUILD 还缺 `autoResupplyBeforeBattle`（**依赖链序**，只能在装配阶段统计，见 generateAdventureScript）。
 */
type AdventureNodeDraft =
  | Omit<AdventureStartNode, 'next'>
  | Omit<AdventureBannerNode, 'next'>
  | Omit<AdventureBattleNode, 'next'>
  | Omit<AdventureEventNode, 'next'>
  | Omit<AdventureBuildNode, 'next' | 'autoResupplyBeforeBattle'>;

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
 * 事件「临时强化」候选池。
 *
 * FRUITS-ADVENTURE-UX-CONTINUITY-R1 修订（**只改事件奖励池，不改任何数值/物理/概率**）：
 *
 * 原池 = `RUN_GENERIC_CHOICE_POOL`（damageUp / rateUp / emergencyRepair，共 3 项）。
 * R1 在真实浏览器里用「优先拿强化」的正常玩家策略跑同一 seed 时暴露了真实问题：
 *   9 个事件槽 × 3 项候选（且受「已拥有则跳过」约束）⇒ 整局最多拿到 3 种强化，
 *   而第 6 场成长门槛敌（ExtendedBurnSaw）与终点（ExtendedHeavyContact）的 headless 实测是：
 *
 *     build                                  BurnSaw        HeavyContact
 *     []                                     B（615 步归零） —
 *     damageUp+rateUp+heavyShell             B（625 步归零） —
 *     twinCannon+damageUp+rateUp             A（剩 443）     B（391 步归零）
 *     twinCannon+damageUp+rateUp+kineticBurst A（剩 1012）   **A（剩 352）**
 *     tripleLoad+damageUp+rateUp+heavyShell   A（剩 364）     B（703 步归零）
 *
 *   ⇒ 只靠通用池**结构上就不可能通关**：通关需要「炮台型强化（twinCannon）+ 动能爆发」，
 *     而这两个强化原本只出现在 BUILD 节点（layer1/layer2），一旦 BUILD 节点因池空被跳过
 *     （layer2 需要先有 layer1 主路线这条既有设计），成长链就断了。
 *
 * 修订方式（最小、可解释、不改机制）：把**炮台与弹药类**正式 Run Build 也纳入事件池 ——
 *   twinCannon（双联炮）/ tripleLoad（三连装填）/ heavyShell（重型弹头）/ kineticBurst（动能爆发）。
 *   它们同样是「路线无关」的正式强化（对演示 Cannon 局真实生效），与 layer1/layer2 池有交集，
 *   但 `applyEffect` 的「取第一个未拥有候选」已保证**不重复发放**（拥有即跳过）。
 *   ⚠️ 不改：抽取概率结构（仍是种子洗牌的候选序）、发放数量（仍是一次一项）、耐久取舍、战斗数值。
 *
 * 效果核对（R1 E2E，scan-4，正常速度真实点击）：同一策略下玩家能拿到 `twinCannon` 等关键强化，
 *   第 6 场由「必败」变为可赢，整局可通关（详见 docs/adventure-ux-continuity-r1/REPORT.md §4）。
 */
export const EVENT_BUFF_POOL: readonly RunBuildId[] = [
  ...RUN_GENERIC_CHOICE_POOL,
  'twinCannon',
  'tripleLoad',
  'heavyShell',
  'kineticBurst',
];

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
 * R4：不再在生成期占用强化池——每个强化类选项只掷定**候选顺序**（EVENT_BUFF_POOL 的种子洗牌），
 * 领取时由 advState 取第一个未拥有项；未领取的奖励不消耗任何池资源（修复预分配耗尽问题）。
 */
function rollEventOutcomes(
  rng: AdvRng,
  kind: AdventureEventKind,
): Record<string, AdventureEffect> {
  const pickCandidates = (): readonly RunBuildId[] => {
    const pool = [...EVENT_BUFF_POOL];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool;
  };
  if (kind === 'crate') {
    return {
      leave: { kind: 'none' },
      open: rng.chance(0.5)
        ? { kind: 'heal', fraction: EMERGENCY_REPAIR_FRACTION }
        : { kind: 'buff', candidates: pickCandidates() },
    };
  }
  if (kind === 'wreck') {
    // 安全离开 = 稳定维修（真实回复耐久）；搜刮 = 赌一把（强化 or 损失）。风险/收益可见、不隐藏。
    return {
      safe: { kind: 'heal', fraction: EMERGENCY_REPAIR_FRACTION },
      scavenge: rng.chance(0.5)
        ? { kind: 'buff', candidates: pickCandidates() }
        : { kind: 'damage', fraction: ADV_DAMAGE_FRACTION },
    };
  }
  if (kind === 'rest') {
    // 维修 = 修复；继续改装 = 临时强化（均预掷定，选择即揭晓）
    return {
      repair: { kind: 'heal', fraction: EMERGENCY_REPAIR_FRACTION },
      upgrade: { kind: 'buff', candidates: pickCandidates() },
    };
  }
  if (kind === 'convoy') {
    // 用少量耐久换一件临时强化（真实 HP ↔ Build 权衡；仅当领到未拥有强化才扣耐久）；离开 = 无
    return {
      trade: { kind: 'trade', damageFraction: ADV_CONVOY_DAMAGE_FRACTION, candidates: pickCandidates() },
      ignore: { kind: 'none' },
    };
  }
  // altar：高风险高回报（大强化 or 重创）；离开 = 无
  return {
    leave: { kind: 'none' },
    touch: rng.chance(0.5)
      ? { kind: 'buff', candidates: pickCandidates() }
      : { kind: 'damage', fraction: ADV_ALTAR_DAMAGE_FRACTION },
  };
}

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
    outcomes: rollEventOutcomes(rng, kind),
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
 * 难度曲线（R4 终版）：7 场战斗，真实物理 headless 校准（演示装载 1100 耐久入场）：
 *   - 前 5 场「易敌池」按种子洗牌：ProtoRusher ×2 / Chaser / ExtendedStandoffRod
 *     （四者在任意强化水平下均可赢，构成前期节奏）；
 *   - 第 6 场「成长门槛敌」：ExtendedBurnSaw（喷火+锯持续磨血）—— 无强化必败、Build 成型后
 *     可赢，把「局内 Build 成长是否真实兑现」变成胜负的真实判据；
 *   - 终点 FINAL = ExtendedHeavyContact（霰弹+锤贴脸爆发）：与门槛敌（持续磨血）、
 *     前期敌（冲撞/控距）挑战特征明确不同；真实物理校准：6 强化入场稳赢但仅剩
 *     409/1100（耗掉 63% 耐久，全程最高代价）—— 终点即最难一关，压力真实可感。
 *
 * ⚠️ 真实物理校准结论（headless，未改任何物理/武器数值）：
 *   - `RangedTurret` / `RushRammer` / `HeavyFortress` 在演示装载任意耐久/强化下均 1100→0
 *     不可赢，绝不入池（否则整局永远无法 COMPLETE，违反验收①）；
 *   - `HighGunPlatform` 六强化仅剩 97 耐久，过紧不入池；
 *   - FINAL=Chaser 方案（V1）实测终点只剩 734 且前期池含 Chaser 特征重复，R4 起改用 V2；
 *   - `fastReload` 与 `twinCannon` 存在 DPS 崩塌的涌现互斥（见 advState 策展排除），冒险池不发放。
 */
function battleCurve(rng: AdvRng): string[] {
  const early = ['ProtoRusher', 'ProtoRusher', 'Chaser', 'ExtendedStandoffRod', 'ProtoRusher'];
  for (let i = early.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [early[i], early[j]] = [early[j], early[i]];
  }
  // 第 6 场单「成长门槛敌」ExtendedBurnSaw；终点 ExtendedHeavyContact（贴脸爆发，全程最高代价）。
  // 双门槛（BurnSaw+HeavyContact 均在中段）经实测超出耐久预算（0/4 通关）故弃用；
  // 终点独占 HeavyContact 是唯一可负担的位次（校准见文件头注释）。
  return [...early, 'ExtendedBurnSaw', 'ExtendedHeavyContact'];
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
 *   START → [事件 → 战斗(+建造/阶段提示)] ×N → 终点 FINAL → 结算
 *   - 7 场真实物理战斗（难度曲线见 battleCurve，RangedTurret/RushRammer/HeavyFortress
 *     真实物理下不可赢已弃用）；
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

  const list: AdventureNodeDraft[] = [];
  list.push({
    id: 'a1-start',
    kind: 'START',
    day: 1,
    beat: ['你驾驶着{vehicle}，驶入一片未知的荒原。', `这趟冒险要走许多天，撑到最后便是赢家。`],
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
      list.push(makeEventNode(`e${ei + 1}`, day, eventKinds[ei], rng));
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
    list.push(makeEventNode(`e${ei + 1}`, day, eventKinds[ei], rng));
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
  });
  day++;
  battlesDone++;

  const nodes: Record<string, AdventureNode> = {};
  for (let i = 0; i < list.length; i++) {
    const draft = list[i];
    const next = i < list.length - 1 ? list[i + 1].id : null;
    if (draft.kind === 'BUILD') {
      // F5：回填「本节点之后、下一场战斗之前的自动整备（BANNER）次数」。
      //    链序即 list 顺序 ⇒ 从该节点往后扫到第一个 BATTLE/FINAL，统计其中的 BANNER 数。
      //    只有 BANNER 是必然发生的免费恢复；EVENT 的恢复由玩家当场选，不计入。
      let resupplies = 0;
      for (let j = i + 1; j < list.length; j++) {
        const n = list[j];
        if (n.kind === 'BANNER') resupplies++;
        if (n.kind === 'BATTLE' || n.kind === 'FINAL') break;
      }
      const build: AdventureBuildNode = { ...draft, autoResupplyBeforeBattle: resupplies, next };
      nodes[build.id] = build;
      continue;
    }
    // 非 BUILD 草稿：补上 next 即为完整节点（kind 是判别式，逐类收窄）。
    const node: AdventureNode =
      draft.kind === 'START'
        ? { ...draft, next }
        : draft.kind === 'BANNER'
          ? { ...draft, next }
          : draft.kind === 'BATTLE'
            ? { ...draft, next }
            : { ...draft, next };
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
