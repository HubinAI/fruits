/**
 * PRP-RUN-02-FULL-RUN-VERTICAL-SLICE｜**固定 Run Script**（唯一的单局编排数据源）。
 *
 * 本文件回答一个问题：**这七天到底按什么顺序发生**。
 *
 *   - 只有**数据 + 纯查询**：没有状态、没有副作用、不 import 任何战斗 / DOM / Canvas；
 *   - 状态机（`runPageState.ts`）**只按本脚本推进**：节点 id → `next` / `branch`，
 *     DAY 与叙事文本也全部来自节点 → 页面里**不存在** `if (day === X)` 这类散落分支；
 *   - 第一版是**固定脚本，不做 RNG、不做正式随机池**（Queue 必改 1 明令）。
 *
 * ## 七天节点序列（固定）
 *
 *   | 节点 | 类型 | DAY | 内容 |
 *   |---|---|---|---|
 *   | `d1-start`      | EVENT      | 1 | 冒险开始：开车上路 |
 *   | `d2-battle1`    | BATTLE     | 2 | 低压遭遇（阶梯 ①） |
 *   | `d2-choice1`    | CHOICE     | 2 | 第一次三选一（第一层：重型弹头 / 双联炮 / 快速装填） |
 *   | `d3-battle2`    | BATTLE     | 3 | 中低压遭遇（阶梯 ②） |
 *   | `d4-durability` | DURABILITY | 4 | **耐久取舍事件**：维修 vs 继续改装 |
 *   | `d5-tend`       | EVENT      | 5 | 维修分支：这一天用来修车 |
 *   | `d5-choice2`    | CHOICE     | 5 | 改装分支：第二次条件三选一（第二层） |
 *   | `d6-battle3`    | BATTLE     | 6 | 中压遭遇（阶梯 ③） |
 *   | `d7-final`      | FINAL      | 7 | 终局遭遇（阶梯 ④）→ RUN COMPLETE / RUN FAILED |
 *
 * ⇒ **战斗与选择交替**，不存在「连续菜单」或「连续战斗」（Queue 目标结构）。
 *   DAY 是冒险阶段，不要求「一天只有一个节点」：`d5-tend` 与 `d5-choice2` 同为 DAY 5、
 *   互斥（维修分支 / 改装分支）。
 *
 * ## 四场战斗（必改 2：压力阶梯，全部引用**既有正式对手模板**）
 *
 *   | 场次 | 节点 | Encounter（Lab 引用） | 正式模板 | 玩家**基础 Build** 实测掉血 |
 *   |---|---|---|---|---|
 *   | ① 低压   | `d2-battle1` | `PineappleFireBrute`  | `OPP-29`     | 181 |
 *   | ② 中低压 | `d3-battle2` | `PineappleSawRusher` | `OPP-31`     | 221 |
 *   | ③ 中压   | `d6-battle3` | `ProtoRusher`        | `R1-RUSH-02` | 257 |
 *   | ④ 较高压 | `d7-final`   | `BananaRodLaser`     | `OPP-20`     | 482 |
 *
 *   **没有新增敌人、没有改 HP / speed / damage / enemyCount**：四场只是「打谁」不同，
 *   世界 / 出生点 / 玩家装配 / 全部数值都是正式默认。选型依据见 `testData.ts`
 *   对应条目的普查注释（49 套正式模板 × 10 种真实 Build 的实测矩阵）。
 *
 * ## ⚠️ 关于文本里的 `{enemy}` / `{vehicle}`
 *
 *   敌情与车型展示名由宿主用**正式链路**解析（`runPageScene.runPageContext`），
 *   脚本里只留占位符 —— 文本的唯一来源仍在脚本，机器只做一次替换。
 */

/** 脚本节点类型（Queue 必改 1 点名的五种 + 耐久事件）。 */
export type RunNodeKind = 'EVENT' | 'BATTLE' | 'DURABILITY' | 'CHOICE' | 'FINAL';

/** 耐久事件的两个分支（唯一来源；UI / 状态机 / 测试都读这里）。 */
export type RunDurabilityChoiceId = 'repair' | 'upgrade';

export interface RunScriptNode {
  /** 脚本内唯一 id（状态机持有它 → 决定「现在轮到什么」）。 */
  readonly id: string;
  readonly kind: RunNodeKind;
  /** 到达该节点时的 DAY（1..7）。 */
  readonly day: number;
  /**
   * 到达该节点时的**节拍叙事**（旅行 / 事件），按顺序追加到冒险记录。
   * 文本里的 `{vehicle}` 由宿主解析后替换。
   */
  readonly beat: readonly string[];
  /**
   * BATTLE / FINAL：玩家按下「遭遇敌人」时的敌情叙事。
   * `{enemy}` = 本节点 Encounter 的正式展示名。
   */
  readonly encounter?: readonly string[];
  /**
   * BATTLE / FINAL：战斗结束后 RESULT 追加的第三行（提示接下来会发生什么）。
   * ⚠️ 终局（`next === null`）不用它 —— 终局走 RUN COMPLETE 的收束叙事。
   */
  readonly after?: readonly string[];
  /** BATTLE / FINAL：使用的 Lab Encounter id（= 既有正式对手模板的引用）。 */
  readonly encounterId?: string;
  /** 线性后继；`null` = 脚本最后一个节点（打完即 RUN COMPLETE）。 */
  readonly next: string | null;
  /** DURABILITY：两个分支各自的后继节点 id。 */
  readonly branch?: Readonly<Record<RunDurabilityChoiceId, string>>;
}

/**
 * 耐久事件的文案与因果（**数据**，不是 UI 内散落的字符串）。
 *
 * A 维修         → 恢复一段明确耐久（沿用既有的 `EMERGENCY_REPAIR_FRACTION`，不新造数值）
 *                  → **放弃这次强化机会**（脚本分支直接跳过第二次 CHOICE）
 * B 冒险改装     → 不回耐久 → 进入**现有条件池**的第二次三选一
 *
 * 不增加货币、不增加新资源 —— 唯一被权衡的就是「现在这点耐久」。
 */
export const RUN_DURABILITY_EVENT = {
  title: '停下来，还是继续改装？',
  options: [
    { id: 'repair' as const, label: '维修', note: '修回一段耐久，但放弃这次改装' },
    { id: 'upgrade' as const, label: '继续改装', note: '不回耐久，换一次强化机会' },
  ],
  /** 选「维修」写入冒险记录的叙事（耐久恢复量随后单独一行）。 */
  repairLog: '你花了一整天把车体焊补回去。',
  /** 选「继续改装」写入冒险记录的叙事。 */
  upgradeLog: '你没有停下来修车，把这段时间用来改装。',
} as const;

/** 固定脚本（顺序即 DAY 顺序；推进只走 `next` / `branch`）。 */
export const RUN_SCRIPT: readonly RunScriptNode[] = [
  {
    id: 'd1-start',
    kind: 'EVENT',
    day: 1,
    beat: ['你驾驶着{vehicle}，在荒原上继续前进。', '这趟路要走七天。'],
    next: 'd2-battle1',
  },
  {
    id: 'd2-battle1',
    kind: 'BATTLE',
    day: 2,
    beat: ['第二天，车辙把你带到一片碎石地。'],
    encounter: ['前方传来引擎的轰鸣。', '你遭遇了{enemy}。'],
    after: ['你发现了一次改装机会……'],
    encounterId: 'PineappleFireBrute',
    next: 'd2-choice1',
  },
  {
    id: 'd2-choice1',
    kind: 'CHOICE',
    day: 2,
    beat: [],
    next: 'd3-battle2',
  },
  {
    id: 'd3-battle2',
    kind: 'BATTLE',
    day: 3,
    beat: ['第三天，路变得开阔起来。'],
    encounter: ['一台顶着圆锯的车从侧面冲过来。', '你遭遇了{enemy}。'],
    after: ['车体伤得不轻，前面有一处能停下的地方。'],
    encounterId: 'PineappleSawRusher',
    next: 'd4-durability',
  },
  {
    id: 'd4-durability',
    kind: 'DURABILITY',
    day: 4,
    beat: ['第四天，你在一处背风的坡下停了车。'],
    next: null,
    branch: { repair: 'd5-tend', upgrade: 'd5-choice2' },
  },
  {
    id: 'd5-tend',
    kind: 'EVENT',
    day: 5,
    beat: ['第五天，你一整天都在焊补车体。'],
    next: 'd6-battle3',
  },
  {
    id: 'd5-choice2',
    kind: 'CHOICE',
    day: 5,
    beat: [],
    next: 'd6-battle3',
  },
  {
    id: 'd6-battle3',
    kind: 'BATTLE',
    day: 6,
    beat: ['第六天，远处已经是这片荒原的边界。'],
    encounter: ['一台高重心的冲刺车迎面撞了上来。', '你遭遇了{enemy}。'],
    after: ['再往前，就是这片荒原最深处的对手。'],
    encounterId: 'ProtoRusher',
    next: 'd7-final',
  },
  {
    id: 'd7-final',
    kind: 'FINAL',
    day: 7,
    beat: ['第七天，最后一段路。'],
    encounter: ['一台挂着长杆的重车挡在路中央。', '你遭遇了{enemy}。'],
    encounterId: 'BananaRodLaser',
    next: null,
  },
];

/** 脚本的第一个节点 id（`createRunPageState` 从这里开始）。 */
export const RUN_SCRIPT_FIRST_ID = RUN_SCRIPT[0].id;

/** 单局起始 DAY（= 脚本第一个节点的 day；新开一局就回到这一天）。 */
export const RUN_FIRST_DAY = RUN_SCRIPT[0].day;

/** 单局总天数（= 脚本覆盖的最后一天；顶部进度节点按它画）。 */
export const RUN_TOTAL_DAYS = RUN_SCRIPT.reduce((max, n) => Math.max(max, n.day), 1);

/** 单局真实战斗场数（= 脚本里 BATTLE + FINAL 节点数；本阶段固定 4）。 */
export const RUN_TOTAL_BATTLES = RUN_SCRIPT.filter((n) => n.kind === 'BATTLE' || n.kind === 'FINAL').length;

/** 单局强化选择次数上限（脚本里 CHOICE 节点数；结构性上限，不靠运行期扫描）。 */
export const RUN_TOTAL_CHOICES = RUN_SCRIPT.filter((n) => n.kind === 'CHOICE').length;

/** 按 id 取节点（未知 id → `null`，绝不静默回退到别的节点）。 */
export function runScriptNode(id: string): RunScriptNode | null {
  return RUN_SCRIPT.find((n) => n.id === id) ?? null;
}

/** 取节点（未知 id 抛错）—— 状态机内部的硬契约。 */
export function requireRunScriptNode(id: string): RunScriptNode {
  const n = runScriptNode(id);
  if (!n) throw new Error(`[PRP-RUN-02] Run Script 不存在节点 "${id}"`);
  return n;
}

/** 需要真实战斗的节点（BATTLE / FINAL）—— 全部有 `encounterId`。 */
export function runScriptBattleNodes(): readonly RunScriptNode[] {
  return RUN_SCRIPT.filter((n) => n.kind === 'BATTLE' || n.kind === 'FINAL');
}

/** 脚本里全部会被玩家看见的节点（诊断 / 测试用：节点总数与类型序列）。 */
export function runScriptKindSequence(): readonly RunNodeKind[] {
  return RUN_SCRIPT.map((n) => n.kind);
}

/**
 * 耐久事件的某条分支通向哪个节点（`branch` 缺失 = 该节点不是耐久事件 → 抛错）。
 */
export function runDurabilityBranchNodeId(choice: RunDurabilityChoiceId): string {
  const node = RUN_SCRIPT.find((n) => n.kind === 'DURABILITY');
  if (!node || !node.branch) throw new Error('[PRP-RUN-02] Run Script 缺少耐久事件节点');
  return node.branch[choice];
}

/** 枚举脚本里全部 BATTLE / FINAL 节点 id（宿主据此预热 Encounter 解析缓存）。 */
export const RUN_SCRIPT_BATTLE_NODE_IDS: readonly string[] = runScriptBattleNodes().map((n) => n.id);
