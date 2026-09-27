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
 *   | `d2-battle1`    | BATTLE     | 2 | **第 1 段**：基础近身碰撞压力（`ProtoRusher`） |
 *   | `d2-choice1`    | CHOICE     | 2 | 第一次三选一（第一层：重型弹头 / 双联炮 / 快速装填） |
 *   | `d3-battle2`    | BATTLE     | 3 | **第 2 段**：追击 / 接触节奏（`Chaser`） |
 *   | `d4-durability` | DURABILITY | 4 | **耐久取舍事件**：维修 vs 继续改装 |
 *   | `d4-lateral`    | CHOICE     | 4 | **横向改装二选一**（只走「继续改装」分支）→ 汇入 `d5-choice2` |
 *   | `d5-tend`       | EVENT      | 5 | 维修分支的当日叙事（焊补车体）→ 汇入 `d5-choice2` |
 *   | `d5-choice2`    | CHOICE     | 5 | **第二次条件三选一（第二层）**——两条分支都会到达 |
 *   | `d6-travel`     | EVENT      | 6 | 纯叙事节拍（补 DAY 6 的叙事连续性，见下） |
 *   | `d7-final`      | FINAL      | 7 | **第 3 段**：第一次要求处理远程控距（`RangedTurret`）→ RUN COMPLETE / RUN FAILED |
 *
 * ⇒ **战斗与选择交替**，不存在「连续菜单」或「连续战斗」（Queue 目标结构）。
 *   DAY 是冒险阶段，不要求「一天只有一个节点」：`d4-durability` 与 `d4-lateral` 同为 DAY 4、
 *   `d5-tend` 与 `d5-choice2` 同为 DAY 5 —— 都是**同一分支上的先后两个节点**（先事件、后选择），
 *   不是互斥的两条边。
 *   ⚠️ `d6-travel` 是**纯叙事 EVENT**（无对手 / 无候选池 / 无战斗）：`d6-battle3` 删除后
 *     DAY 6 一度没有节点 ⇒ 日志会从 `DAY 5` 直接跳到 `DAY 7`（`presentNode` 只在 day 变化时
 *     追加 `DAY n` 行），而顶部进度条仍是 7 天 —— 那是**可见的叙事断口**。
 *     补这一个节拍节点后 **DAY 1~7 每天都有叙事**，`RUN_TOTAL_BATTLES` 仍 = 3、
 *     `RUN_TOTAL_CHOICES` 仍 = 3，任何数值都不动。
 *
 * ## ⚠️ PRP-RUN-02-R1（真人验收修正）：DAY 4 事件与 DAY 5 第二层选择是**两个独立节点**
 *
 *   维修的机会成本 = **放弃 DAY 4 这一次额外改装**，而**不是**「放弃整局第二层 Build」。
 *
 *     d4-durability ─┬─ repair  → d5-tend(EVENT · DAY 5 叙事) ──next──┐
 *                    └─ upgrade → d5-choice2(CHOICE · DAY 5) ←────────┴─ 两条分支在此汇合
 *
 *   ⇒ **无论选维修还是继续改装，都会进入 DAY 5 的第二次条件三选一**；
 *     第一层（DAY 2 的三选一）在任何分支下都**不被清除**，第二层也**不被阻止**。
 *     两条分支唯一的差别 = **耐久**：维修拿回一段耐久但当日用来修车，继续改装不回耐久。
 *   ⇒ 修正只落在本文件的**数据**里（`d5-tend.next` / 事件文案）；
 *     `runPageState.ts` 的推进逻辑**零分支特判**（两条分支都只走 `branch[choice]` + `next`）。
 *
 * ## ⚠️ PRP-RUN-02-R2（真人验收修正）：让「维修 vs 继续改装」成为**真实取舍**
 *
 *   修正前两条分支的差别**只剩耐久**（都拿到同一份第二层）⇒ 维修**严格支配**继续改装。
 *   本 Queue 把「继续改装」换到另一种优势上：
 *
 *     d4-durability ─┬─ repair  → d5-tend(EVENT · DAY 5 焊车) ──────┐
 *                    └─ upgrade → d4-lateral(CHOICE · DAY 4 横向) ─┴→ d5-choice2(CHOICE · DAY 5)
 *
 *   - **维修**     = 拿回一段耐久（**恢复值完全不动**），这一天用来修车 → **生存优势**；
 *   - **继续改装** = 不回耐久 → **立即**多拿一项横向改装（现有第一层之外的另外两个一层强化，
 *                    二选一，**不含** `emergencyRepair`）→ **构筑数量优势**。
 *   ⇒ 两条分支**仍然都**进入 DAY 5 的第二次条件三选一，且第二层的条件池**仍由最初主路线决定**。
 *   ⇒ 继续改装分支最终携带 **3 项**改装（一层 + 横向 + 二层），维修分支 **2 项**。
 *
 *   ⚠️ 「继续改装」的横向池**只复用既有第一层内容**：不新增 Buff、不提供 `emergencyRepair`、
 *      不重复展示已拥有的那一项。
 *   ⚠️ 候选池种类由 **CHOICE 节点自己声明**（`choicePool`）—— 状态机不按「第几选」数数，
 *      因此将来增删节点不会悄悄改变池的语义。
 *
 * ## ⚠️ PRODUCT-LOOP-R6-BASIC-ENCOUNTER-SEQUENCE：四场阶梯 → **三段问题序列**
 *
 *   Queue 目标不是正式关卡设计，而是「**让不同配置至少遇到不同战斗问题**」。
 *   改前四场里三场是同一类冲锋对手（`OPP-29 / OPP-31 / R1-RUSH-02`，见 `testData.ts`
 *   的 rush/rush/rush/control 标注）⇒ 四场只反复问同一个问题。
 *
 *   现在按**固定顺序**摆三段，每段一个明确的战斗问题（全部引用**既有正式对手模板**，
 *   零新增敌人、零数值改动）：
 *
 *   | 段 | 节点 | Encounter（Lab 引用） | 正式模板 | 这一段问的问题 |
 *   |---|---|---|---|---|
 *   | ① | `d2-battle1` | `ProtoRusher`  | `R1-RUSH-02` | 基础近身碰撞压力（能不能扛住冲撞） |
 *   | ② | `d3-battle2` | `Chaser`       | `OPP-16`     | 追击 / 接触节奏（对手跑得更快、咬得更紧） |
 *   | ③ | `d7-final`   | `RangedTurret` | `OPP-03`     | 第一次要求处理**远程控距**（对手主动维持作战距离） |
 *
 *   ⚠️ 三段只是「打谁」不同：世界 / 出生点 / 玩家装配 / 全部数值都是正式默认。
 *      `d6-battle3` 已删除（DAY 6 改由纯叙事 `d6-travel` 占据）—— 三段之间仍然是
 *      **选择 / 事件交替**，不是连续战斗。
 *
 *   ⚠️ **`RangedTurret` 是全项目唯一声明 `enemyDrive: 'keep-distance'` 的 Encounter**
 *      （`testData.ts`）。它在这一条链上**真的生效**：`entities.ts` 原样透传 →
 *      `runBattleRuntime` 把 `ENEMY_KEEP_DISTANCE_BANDS` 交给正式契约
 *      （见 `REF_PRP_RUNTIME.md` §M）。⇒ 第 3 段与前两段的**战斗问题确实不同**。
 *      ⚠️ 由此产生的**难度事实（如实记录，本 Queue 不调数值）**：产品默认车
 *      （`frontMass=cannon` + `top=hammer`）**打不过第 3 段** —— 控距会否掉接触伤害，
 *      实测终局敌剩 980/1100；要通关需要**多武器装配**（同一份实测里
 *      `machineGun ×3` 零 Build 即可 COMPLETE，终局 727.3；
 *      `machineGun ×2 + hammer` 268.5；`cannon + machineGun ×2` 206.5）。
 *      这些件玩家**结构上拥有**（`product/r5ContentPoolSeed.ts` 一次性把全部
 *      `OFFICIAL_PARTS` 补给账号）⇒ 「三段序列可通关」成立，但**不是默认装配**。
 *      详见 `tests/productRunEncounterSequenceQ3.test.ts` 的机器记录。
 *
 *   ## 关于「上一段清场后才进入下一段」/「Enemy 不串场」
 *
 *   两件事都是**结构性的**，不靠人工核对：
 *     - 每场战斗由宿主 `runPage.beginBattle()` **新建一份** `RunBattleRuntime`
 *       （构造项 `encounterId` 现读自当前脚本节点），战斗结束后 `dispose()`；
 *     - 推进只走脚本的 `next` ⇒ **上一段没出结果就不会创建下一段的运行时**。
 *   ⇒ 战斗实体不跨段复用、上一段的敌人不可能出现在下一段。
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
 *   - `layer2`  → 第二层**条件池**（由**最初主路线** = 第一个拿到的一层强化决定）
 *
 * ⚠️ 三种池都会**剔除已拥有的强化**（`runChoicePool` 的统一去重）→ 结构上不可能重复拿同一个。
 */
export type RunChoicePoolKind = 'layer1' | 'lateral' | 'layer2';

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
  /**
   * CHOICE：这个节点该用哪一种候选池（`layer1` / `lateral` / `layer2`）。
   * ⚠️ 池的**内容**不在这里 —— 节点只声明种类，内容由 `runModifiers.ts` 提供。
   */
  readonly choicePool?: RunChoicePoolKind;
}

/**
 * 耐久事件的文案与因果（**数据**，不是 UI 内散落的字符串）。
 *
 * A 维修         → 恢复一段明确耐久（沿用既有的 `EMERGENCY_REPAIR_FRACTION`，不新造数值）
 *                  → **不获得**这一天额外改装（当日走 `d5-tend` 的焊车叙事）
 *                  → **不跳过** DAY 5 的第二次条件三选一（PRP-RUN-02-R1 修正）
 * B 继续改装     → 不回耐久 → **立即获得一次横向改装机会**（`d4-lateral`：
 *                  现有第一层之外的另外两个一层强化，二选一；PRP-RUN-02-R2）
 *                  → **再正常进入** DAY 5 的第二次条件三选一
 *
 * ⚠️ PRP-RUN-02-R2：两条分支**都会**到达 DAY 5 的第二次条件三选一（第一层不清除、第二层不阻止），
 *    差别是**两种不同的优势**：维修 = 生存（拿回一段耐久），继续改装 = 构筑数量（多一项横向改装）。
 *    不增加货币、不增加新资源、不增加第四种强化。
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
    // 第 1 段：先把「近身碰撞」这个最基本的问题摆出来（`ProtoRusher` 会真的冲撞上来）。
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
    // 第一层三选一（重炮 / 双联 / 快装）—— 池的种类由节点声明，内容由 `runModifiers` 提供。
    choicePool: 'layer1',
    next: 'd3-battle2',
  },
  {
    id: 'd3-battle2',
    kind: 'BATTLE',
    day: 3,
    beat: ['第三天，路变得开阔起来。'],
    // 第 2 段：换的是**节奏** —— `Chaser` 跑得更快、咬得更紧（不是更硬）。
    encounter: ['一台车从侧后方咬了上来，速度比你快。', '你遭遇了{enemy}。'],
    after: ['车体伤得不轻，前面有一处能停下的地方。'],
    encounterId: 'Chaser',
    next: 'd4-durability',
  },
  {
    id: 'd4-durability',
    kind: 'DURABILITY',
    day: 4,
    beat: ['第四天，你在一处背风的坡下停了车。'],
    next: null,
    // ⚠️ 两条分支**都会**走到 DAY 5 的第二次条件三选一，但**路径不同**：
    //    repair  → `d5-tend`（当日焊车叙事）→ `d5-choice2`    ：拿回耐久，**放弃**这一天额外改装
    //    upgrade → `d4-lateral`（横向改装二选一）→ `d5-choice2`：不回耐久，**换到**一次额外改装
    //    两条分支的差别 = 「生存优势」vs「构筑数量优势」（PRP-RUN-02-R2）。
    branch: { repair: 'd5-tend', upgrade: 'd4-lateral' },
  },
  {
    id: 'd4-lateral',
    kind: 'CHOICE',
    day: 4,
    // ⚠️ 与 `d4-durability` **同为 DAY 4** ⇒ 进入本节点不会追加 `DAY 4` 行（DAY 未变）；
    //    下面的 `d5-choice2` 才是 DAY 5。
    beat: ['第四天，你把这一天全用来改装，再挑一项装上。'],
    // 横向改装：候选 = 现有第一层之外的**另外两个**一层强化（二选一，不含 `emergencyRepair`）。
    choicePool: 'lateral',
    next: 'd5-choice2',
  },
  {
    id: 'd5-tend',
    kind: 'EVENT',
    day: 5,
    beat: ['第五天，你一整天都在焊补车体。'],
    // ⚠️ PRP-RUN-02-R1：**不是** `d6-battle3` —— 维修分支修完车**继续**进入 DAY 5 的
    //    第二次条件三选一。维修的机会成本只是「这一次额外改装」，不是整局第二层 Build。
    next: 'd5-choice2',
  },
  {
    id: 'd5-choice2',
    kind: 'CHOICE',
    day: 5,
    // 到达方式有两条（repair 经 `d5-tend` / upgrade 经 `d4-lateral`），但**节点只有一个**。
    // 候选池种类由节点声明；池内容由**最初主路线**决定（`runChoicePool`）——这里不写任何池内容。
    choicePool: 'layer2',
    beat: [],
    next: 'd6-travel',
  },
  {
    /*
      ⚠️ PRODUCT-LOOP-R6-BASIC-ENCOUNTER-SEQUENCE：本节点存在的原因是**叙事连续性**，不是战斗。

      改前 DAY 6 由 `d6-battle3` 占据；三段序列把第 3 段放进终局 `d7-final`（DAY 7）之后，
      DAY 6 就**没有任何节点** ⇒ `presentNode` 只在「节点 day ≠ 当前 day」时追加 `DAY n` 行，
      日志会从 `DAY 5` 直接跳到 `DAY 7`，而顶部进度条仍然是 7 天 —— 这是一处**可见的叙事断口**。

      因此补一个**纯叙事 EVENT 节拍**（`kind: 'EVENT'`，无对手、无候选池、无战斗）：
      `RUN_TOTAL_BATTLES` 仍 = 3、`RUN_TOTAL_CHOICES` 仍 = 3、任何数值都不动
      （Queue 冻结项：Enemy / AI / Battle / Physics / Camera / Reward / Garage / Weapon /
      Body / Movement 全部零改动）。
    */
    id: 'd6-travel',
    kind: 'EVENT',
    day: 6,
    beat: ['第六天，路上没有遇到对手，你把车开到了荒原的边界。'],
    next: 'd7-final',
  },
  {
    id: 'd7-final',
    kind: 'FINAL',
    day: 7,
    // 第 3 段：唯一一段**对手主动维持作战距离**的战斗
    // （`RangedTurret` 声明 `enemyDrive: 'keep-distance'`，理由与实测见文件头）。
    beat: ['第七天，最后一段路。'],
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
 * ⚠️ PRODUCT-LOOP-R6-BASIC-ENCOUNTER-SEQUENCE：**4 → 3**（三段问题序列，见文件头）。
 */
export const RUN_TOTAL_BATTLES = RUN_SCRIPT.filter((n) => n.kind === 'BATTLE' || n.kind === 'FINAL').length;

/**
 * 单局强化选择次数上限（脚本里 CHOICE 节点数；结构性上限，不靠运行期扫描）。
 *
 * ⚠️ PRP-RUN-02-R2：脚本现在有三个 CHOICE 节点（第一层 / 横向 / 第二层）⇒ 上限 **3**。
 *    但**单条分支**拿不到 3 次：维修分支只经 `d2-choice1` + `d5-choice2`（2 次），
 *    继续改装分支才经三个（3 次）—— 「构筑数量优势」正是这个差别的名字。
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
