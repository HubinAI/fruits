/**
 * PRP-RUN-02-FULL-RUN-VERTICAL-SLICE｜**固定 Run Script**（唯一的单局编排数据源）。
 * ｜PRODUCT-LOOP-R9-THREE-STAGE-BUILD-PACING（本文件当前的**节奏**口径）
 *
 * 本文件回答一个问题：**这趟路到底按什么顺序发生**。
 *
 *   - 只有**数据 + 纯查询**：没有状态、没有副作用、不 import 任何战斗 / DOM / Canvas；
 *   - 状态机（`runPageState.ts`）**只按本脚本推进**：节点 id → `next`，
 *     DAY 与叙事文本也全部来自节点 → 页面里**不存在** `if (day === X)` 这类散落分支；
 *   - 第一版是**固定脚本，不做 RNG、不做正式随机池**（Queue 必改 1 明令）。
 *
 * ## ⚠️ PRODUCT-LOOP-R9-THREE-STAGE-BUILD-PACING：**最简三段节奏**（当前唯一口径）
 *
 *   Queue 目标 = 把「Build 能改变结果」这件事放进**正式单局节奏**，且只要最简单的一条：
 *
 *     遭遇 1 → Build Choice → 遭遇 2 → Build Choice → 遭遇 3 → COMPLETE / FAILED
 *
 *   因此脚本收成下面这**六个节点**（不再是 PRP-RUN-02 期那条十天/分支路线）：
 *
 *   | 节点 | 类型 | DAY | 内容 |
 *   |---|---|---|---|
 *   | `d1-start`   | EVENT  | 1 | 冒险开始：开车上路 |
 *   | `d2-battle1` | BATTLE | 2 | **遭遇 1**：基础近身碰撞压力（`ProtoRusher`） |
 *   | `d2-choice1` | CHOICE | 2 | **第 1 次 Build Choice**（池种类 `layer1`） |
 *   | `d3-battle2` | BATTLE | 3 | **遭遇 2**：追击 / 接触节奏（`Chaser`） |
 *   | `d3-choice2` | CHOICE | 3 | **第 2 次 Build Choice**（池种类 `layer2`） |
 *   | `d4-final`   | FINAL  | 4 | **遭遇 3**：远程控距（`RangedTurret`）→ RUN COMPLETE / RUN FAILED |
 *
 *   ⇒ **战斗与选择严格交替**，且「遭遇 → Choice → 下一遭遇」之间**没有别的节点**：
 *     遭遇 1 打完 `next` 就是 CHOICE②，CHOICE①的 `next` 就是遭遇 2；同理遭遇 2 → CHOICE② → 遭遇 3。
 *     「任意阶段 FAILED → 正式 FAILED 流程」「遭遇 3 打完 → 正式 COMPLETE」都沿用既有出口。
 *
 *   ⚠️ 三段只是「打谁」不同：世界 / 出生点 / 玩家装配 / 全部数值都是正式默认。
 *      零新增敌人、零数值改动 —— 三个 `encounterId` 都只是 `testData.LAB_ENCOUNTERS`
 *      里**既有条目**的引用。
 *
 *   ⚠️ **`RangedTurret` 是全项目唯一声明 `enemyDrive: 'keep-distance'` 的 Encounter**
 *      （`testData.ts`）。它在这一条链上**真的生效**：`entities.ts` 原样透传 →
 *      `runBattleRuntime` 把 `ENEMY_KEEP_DISTANCE_BANDS` 交给正式契约
 *      （见 `REF_PRP_RUNTIME.md` §M）。⇒ 第 3 段与前两段的**战斗问题确实不同**。
 *      它同时也是「Build 能不能改变结果」的判据场（`PRODUCT-LOOP-R8` 实证：
 *      单件 `machineGun` 零 Build 打不过，带上官方 `damageUp` / `rateUp` 即可取胜）。
 *
 *   ⚠️ 本 Queue **不调 Enemy / 不调 Weapon 数值 / 不加 Build 词条 / 不加隐藏 Buff**：
 *      脚本只决定「谁在什么时候出现」。第 3 段打不打得过由「玩家装配 + 本局 Build」决定，
 *      两者都走既有正式链路，且**仍然允许失败**（无 Build / 不合适 Build 就是会输）。
 *
 * ## ⚠️ 已从 MVP 节奏退役的节点（PRP-RUN-02-R1 / R2 的内容，**机制保留**）
 *
 *   PRODUCT-LOOP-R9 之前，这条链上还有四个节点：
 *
 *     `d4-durability`(DURABILITY · 维修 vs 继续改装) ─┬─ repair  → `d5-tend`(EVENT)
 *                                                    └─ upgrade → `d4-lateral`(CHOICE · 横向改装)
 *     → `d5-choice2`(CHOICE · 第二层) → `d6-travel`(EVENT · 纯叙事) → `d7-final`
 *
 *   它们与 Queue 要求的严格链冲突（遭遇 2 之后必须先经过耐久事件才能到第二次 Build Choice，
 *   第二次 Choice 之后还要经过叙事节点才到遭遇 3），因此本 Queue 把它们**整段退役**：
 *
 *   - 脚本数据层：上面四个节点已删除 ⇒ 严格链成立；
 *   - 状态机 / 页面：`DURABILITY` 相位、耐久浮层、`resolveDurability`、横向池
 *     （`RunChoicePoolKind = 'lateral'`）**作为能力保留**（它们由脚本数据驱动，
 *     没有节点就永远不会被触发）—— 这样页面的浮层几何 / 命中区 / 探针契约零改动。
 *
 *   ⇒ 如实记录：**「维修 vs 继续改装」这个取舍与「横向改装」这一档，当前不在产品节奏里。**
 *     若将来要恢复，只需在本文件重新声明相应节点（状态机侧不需要改代码）。
 *
 *   ⚠️ 由此 `RUN_TOTAL_CHOICES` 从 3 变成 **2**、`RUN_TOTAL_DAYS` 从 7 变成 **4** ——
 *      两者都是**派生值**（见文件末尾），没有任何地方写死过这两个数字。
 *
 * ## 关于「上一段清场后才进入下一段」/「Enemy 不串场」
 *
 *   两件事都是**结构性的**，不靠人工核对：
 *     - 每场战斗由宿主 `runPage.beginBattle()` **新建一份** `RunBattleRuntime`
 *       （构造项 `encounterId` 现读自当前脚本节点），战斗结束后 `dispose()`；
 *     - 推进只走脚本的 `next` ⇒ **上一段没出结果就不会创建下一段的运行时**。
 *   ⇒ 战斗实体不跨段复用、上一段的敌人不可能出现在下一段。
 *
 * ## 关于「Build 是不是真的留到了后面的战斗」
 *
 *   同样是**结构性的**：`beginBattle()` 每次都把 `runBuildIds(this.state)`
 *   （= 本局**累积**的 Build）交给新运行时，旧运行时先 `dispose()` ⇒
 *   不存在「切段丢 Build / 每段重建未强化武器 / silent reset modifier」。
 *   机器取证见 `tests/productRunThreeStagePacingR9.test.ts`。
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

/**
 * **CHOICE 节点用哪一种候选池**（PRP-RUN-02-R2）。
 *
 * ⚠️ 这是「池的**种类**」，不是池的内容 —— 内容仍由 `runModifiers.ts` 独家提供，
 *    节点只声明「我这里该用哪一种」。这样状态机就不需要按「第几选 / 第几天」数数：
 *
 *   - `layer1`  → 第一层三选一（`RUN_LAYER1_POOL`）
 *   - `lateral` → **横向改装**：当前已拥有一层之外的另外两个一层强化（二选一，
 *                 **不含** `emergencyRepair`）
 *                 ⚠️ PRODUCT-LOOP-R9：`d4-lateral` 已从脚本退役 ⇒ 当前**没有任何节点**
 *                 声明这一种池。种类本身保留（它是能力，不是数据；恢复横向改装只需
 *                 在脚本里重新声明一个 `choicePool: 'lateral'` 的节点）。
 *   - `layer2`  → 第二层**条件池**（由**最初主路线** = 第一个拿到的一层强化决定）
 *
 * ⚠️ 三种池都会**剔除已拥有的强化**（`runChoicePool` 的统一去重）→ 结构上不可能重复拿同一个。
 */
export type RunChoicePoolKind = 'layer1' | 'lateral' | 'layer2';

export interface RunScriptNode {
  /** 脚本内唯一 id（状态机持有它 → 决定「现在轮到什么」）。 */
  readonly id: string;
  readonly kind: RunNodeKind;
  /** 到达该节点时的 DAY（1..RUN_TOTAL_DAYS）。 */
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
  /**
   * DURABILITY：两个分支各自的后继节点 id。
   *
   * ⚠️ PRODUCT-LOOP-R9：当前脚本**没有** DURABILITY 节点 ⇒ 这个可选字段没有生产者；
   *    字段与 `resolveDurability` 对它缺失时的处置（no-op）都保留（能力，不是数据）。
   */
  readonly branch?: Readonly<Record<RunDurabilityChoiceId, string>>;
  /**
   * CHOICE：这个节点该用哪一种候选池（`layer1` / `lateral` / `layer2`）。
   * ⚠️ 池的**内容**不在这里 —— 节点只声明种类，内容由 `runModifiers.ts` 提供。
   */
  readonly choicePool?: RunChoicePoolKind;
}

/**
 * 耐久事件的文案与因果（**数据**，不是 UI 内散落的字符串）。
 *
 * ⚠️ PRODUCT-LOOP-R9：这个事件**当前不在产品节奏里**（`d4-durability` 已退役，见文件头）。
 *    数据与状态机侧的裁决能力一并保留 —— `runPageState.resolveDurability` /
 *    `runDurabilityOptions` / `runDurabilityTitle` 以及页面的耐久浮层分支仍读这里，
 *    因此在脚本重新声明一个 DURABILITY 节点时它们会立刻恢复工作，**数值一字未改**。
 *
 *   A 维修         → 恢复一段明确耐久（沿用既有的 `EMERGENCY_REPAIR_FRACTION`，不新造数值）
 *   B 继续改装     → 不回耐久 → 立即获得一次横向改装机会
 */
export const RUN_DURABILITY_EVENT = {
  title: '停下来，还是继续改装？',
  options: [
    { id: 'repair' as const, label: '维修', note: '修回一段耐久，这一天用来修车' },
    { id: 'upgrade' as const, label: '继续改装', note: '不回耐久，这一天再改一次装' },
  ],
  /** 选「维修」写入冒险记录的叙事（耐久恢复量随后单独一行）。 */
  repairLog: '你花了一整天把车体焊补回去。',
  /** 选「继续改装」写入冒险记录的叙事。 */
  upgradeLog: '你没有停下来修车，把这段时间用来改装。',
} as const;

/** 固定脚本（顺序即 DAY 顺序；推进只走 `next`）。 */
export const RUN_SCRIPT: readonly RunScriptNode[] = [
  {
    id: 'd1-start',
    kind: 'EVENT',
    day: 1,
    beat: ['你驾驶着{vehicle}，在荒原上继续前进。', '这趟路要走四天。'],
    next: 'd2-battle1',
  },
  {
    id: 'd2-battle1',
    kind: 'BATTLE',
    day: 2,
    beat: ['第二天，车辙把你带到一片碎石地。'],
    // 遭遇 1：先把「近身碰撞」这个最基本的问题摆出来（`ProtoRusher` 会真的冲撞上来）。
    encounter: ['前方传来引擎的轰鸣。', '你遭遇了{enemy}。'],
    after: ['你发现了一次改装机会……'],
    encounterId: 'ProtoRusher',
    next: 'd2-choice1',
  },
  {
    id: 'd2-choice1',
    kind: 'CHOICE',
    day: 2,
    beat: [],
    // 第 1 次 Build Choice —— 池的种类由节点声明，内容由 `runModifiers` 提供：
    //   · Cannon 局 → 第一层三选一（重炮 / 双联 / 快装）；
    //   · 非 Cannon 局 → 通用基础成长池（`damageUp` / `rateUp` / `emergencyRepair`）。
    choicePool: 'layer1',
    next: 'd3-battle2',
  },
  {
    id: 'd3-battle2',
    kind: 'BATTLE',
    day: 3,
    beat: ['第三天，路变得开阔起来。'],
    // 遭遇 2：换的是**节奏** —— `Chaser` 跑得更快、咬得更紧（不是更硬）。
    encounter: ['一台车从侧后方咬了上来，速度比你快。', '你遭遇了{enemy}。'],
    after: ['你又找到了一次改装的机会……'],
    encounterId: 'Chaser',
    next: 'd3-choice2',
  },
  {
    id: 'd3-choice2',
    kind: 'CHOICE',
    day: 3,
    // ⚠️ 与 `d3-battle2` **同为 DAY 3** ⇒ 进入本节点不会追加 `DAY 3` 行（DAY 未变）。
    beat: [],
    // 第 2 次 Build Choice：
    //   · Cannon 局 → 第二层**条件池**（由第 1 次选的那条主路线决定）；
    //   · 非 Cannon 局 → 仍然是通用基础成长池（逐节点剔除已拥有项）。
    choicePool: 'layer2',
    next: 'd4-final',
  },
  {
    id: 'd4-final',
    kind: 'FINAL',
    day: 4,
    // 遭遇 3：唯一一段**对手主动维持作战距离**的战斗
    // （`RangedTurret` 声明 `enemyDrive: 'keep-distance'`，理由与实测见文件头）。
    beat: ['第四天，最后一段路。'],
    encounter: ['一台炮塔车停在开阔地上，在很远处就锁定了你。', '你遭遇了{enemy}。'],
    encounterId: 'RangedTurret',
    next: null,
  },
];

/** 脚本的第一个节点 id（`createRunPageState` 从这里开始）。 */
export const RUN_SCRIPT_FIRST_ID = RUN_SCRIPT[0].id;

/** 单局起始 DAY（= 脚本第一个节点的 day；新开一局就回到这一天）。 */
export const RUN_FIRST_DAY = RUN_SCRIPT[0].day;

/** 单局总天数（= 脚本覆盖的最后一天；顶部进度节点按它画）。 */
export const RUN_TOTAL_DAYS = RUN_SCRIPT.reduce((max, n) => Math.max(max, n.day), 1);

/**
 * 单局真实战斗场数（= 脚本里 BATTLE + FINAL 节点数）。
 *
 * ⚠️ PRODUCT-LOOP-R9：**3**（三段问题序列；R6 之前是 4）。
 */
export const RUN_TOTAL_BATTLES = RUN_SCRIPT.filter((n) => n.kind === 'BATTLE' || n.kind === 'FINAL').length;

/**
 * 单局强化选择次数上限（脚本里 CHOICE 节点数；结构性上限，不靠运行期扫描）。
 *
 * ⚠️ PRODUCT-LOOP-R9：脚本现在有**两个** CHOICE 节点（`d2-choice1` / `d3-choice2`）
 *    ⇒ 上限 **2**，且**任何路径**都恰好经过这两个（脚本是严格线性链，没有分支）。
 *    R9 之前是 3（多出的那次来自已退役的「横向改装」节点）。
 */
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

/** 枚举脚本里全部 BATTLE / FINAL 节点 id（宿主据此预热 Encounter 解析缓存）。 */
export const RUN_SCRIPT_BATTLE_NODE_IDS: readonly string[] = runScriptBattleNodes().map((n) => n.id);
