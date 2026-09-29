/**
 * PRP-M2-NEXT-RUN-SEED-VALIDATION｜「下一局起始改装」验证层。
 *
 * ## 本文件回答的唯一问题
 *
 *   一局结束以后，玩家会不会因为**下一局起点不同**而想立刻再打一局？
 *
 * 这是一个**元体验验证**，因此本文件刻意**不做**任何正式局外成长：
 *   - 不做永久存档 / 不做货币 / 不做赛季 / 不做 Garage 奖励 / 不做 Fusion；
 *   - 不做随机奖励池 / 不新增 Buff / 不修改任何已冻结强化数值。
 *
 * ## 流程（四个节拍，缺一不可）
 *
 *   `RUN COMPLETE`（上一局真实终态）
 *     → **种子三选一**（重炮开局 / 双联开局 / 快装开局）
 *     → **开启全新 Run**（满耐久 / DAY 1 / 日志重置 / Build 只剩刚选的 seed）
 *     → **第一场真实 Battle**（seed 真的注入 Runtime）
 *     → 第一场结束即 `NEXT RUN VALIDATION COMPLETE`（不再跑第二场）
 *
 * ## 三个种子（必改 1）
 *
 *   只复用**已经真人通过的第一层强化**（`heavyShell` / `twinCannon` / `fastReload`）——
 *   语义从「这次改装」变成「下一局开局就带着它」。**不新增第四种奖励。**
 *
 * ## 为什么「上一局」是**快进**出来的
 *
 *   Queue 允许「模拟/进入 RUN COMPLETE」。真打完一局要走三段真实战斗，而本 Queue 的
 *   验证目标是**第一场**；因此这里用 `buildPriorCompletedRun` 走**完全相同的状态机 API**
 *   （`pressRunAction` / `chooseRunBuff` / `resolveDurability` / `finishRunBattle`）
 *   把上一局推到 `COMPLETE`，只有「每场结束时剩多少耐久」取自固定表。
 *
 *   ⚠️ 固定表**只是脚手架**：它的用途是「构造出一个已完成的上一局语境」，
 *      不是任何平衡结论，也不参与任何产品路径。
 *   ⚠️ 快进产出的状态是**真状态机状态**（真实日志 / 真实 DAY / 真实 Build / 真实耐久百分比），
 *      因此「新旧两局完全隔离」这件事可以用**两个真实状态对象**直接比对证明。
 *
 * ## 隔离
 *
 *   本文件不 import 战斗 / DOM / Canvas / 平台 —— 只有纯状态机 + 纯数据，
 *   因此在 node 侧即可完整验证（浏览器只负责把它画出来）。
 */

import type { RunModifierId } from './runModifiers';
import {
  RUN_CHOICE_OPTIONS,
  chooseRunBuff,
  createRunPageState,
  finishRunBattle,
  pressRunAction,
  resolveDurability,
  runChoicePool,
  runChoicePoolFamily,
  type RunChoiceOption,
  type RunPageContext,
  type RunPageState,
} from './runPageState';

/* ------------------------------------------------------------------ 种子 */

/**
 * 一个「下一局起始改装」（= RUN COMPLETE 后三选一的一项）。
 *
 *   - `id`       —— 复用**既有第一层强化**的 id（不新增强化，不动其数值）；
 *   - `title`    —— 验证层的选项名（「重炮开局」= 说的是**下一局的开局**）；
 *   - `note`     —— 一句话说清「下一局会变成什么样」；
 *   - `startLog` —— 新 Run 第一行冒险记录（玩家叙事）。
 */
export interface RunSeedOption {
  readonly id: RunModifierId;
  readonly title: string;
  readonly note: string;
  readonly startLog: string;
}

/**
 * 三个固定种子（**唯一来源**；页面 / 状态机 / 测试都读这里）。
 *
 * ⚠️ 顺序 = 页面上的从上到下顺序 = 第一层强化的既有顺序（重炮 → 双联 → 快装）。
 * ⚠️ 不新增第四种：`RUN_CHOICE_OPTIONS` 有且只有这三个 `role: 'base'` 项。
 */
export const NEXT_RUN_SEEDS: readonly RunSeedOption[] = [
  {
    id: 'heavyShell',
    title: '重炮开局',
    note: '下一局直接携带重型弹头',
    startLog: '你带着上一局的重型弹头出发。',
  },
  {
    id: 'twinCannon',
    title: '双联开局',
    note: '下一局直接携带双联炮',
    startLog: '你带着上一局的双联炮出发。',
  },
  {
    id: 'fastReload',
    title: '快装开局',
    note: '下一局直接携带快速装填',
    startLog: '你带着上一局的快速装填机构出发。',
  },
];

/** 种子选择浮层的标题。 */
export const NEXT_RUN_SEED_TITLE = '带走一项改装';
/** 种子选择浮层的引导语（说明这是**下一局**，不是继续上一局）。 */
export const NEXT_RUN_SEED_LEAD = '这次冒险结束了。选一项带进下一局。';
/**
 * 验证终点态的**唯一出口**文案（PRP-M2-R1-NEXT-RUN-VALIDATION-EXIT-BUG）。
 *
 * ⚠️ 这里必须是**一句动作**（「返回验证中心」），不是状态标记。
 *    旧文案 `'下一局验证完成'` 是**状态描述**，却被画在唯一的主动作按钮上 ——
 *    于是出现真人录屏里的 P0：「按钮可见、连点完全无反应」。
 *    终点态的身份由 probe 的 `validationComplete === true` 承担，**不再占用按钮文案**。
 */
export const NEXT_RUN_VALIDATION_LABEL = '返回验证中心';

/**
 * PRP-M2-R1｜验证终点态的唯一出口**地址**（「返回验证中心」要去的那一页）。
 *
 * ⚠️ 刻意写在本模块里，而**不是**从 `validationHub.ts` import —— Hub 与入口是**单向**关系：
 *    Hub 认识入口（它的入口表里有 `next-run.html`），入口不认识 Hub。
 *    让入口去 import Hub 模块会把 `validationHub.ts` 变成**跨入口共享 chunk**，
 *    把 Hub 从「叶子页面」变成「被依赖的模块」——
 *    `tests/_e2e_validation_hub.cjs` 的 `I4`（Hub 只允许引用自己的 chunk）会直接抓到，
 *    那是一条**结构守卫**，本轮的选择是「让结构回到单向」，不是放宽守卫。
 *
 * 代价：这个文件名在两处出现（本模块 + 根目录 HTML）。
 * ⇒ 由 `tests/portraitNextRunValidation.test.ts` 的 `NR-19` 交叉核对钉死：
 *    ① 该文件真实存在；② 那一页真的是**挂 Hub 脚本的验证中心**；
 *    ③ Hub 的入口表里真的有 `next-run.html`（即「返回目标」与「我这页」互相认得）。
 */
export const NEXT_RUN_EXIT_HREF = './validation-hub.html';

/**
 * 验证终点态的主动作规格（PRP-M2-R1）。
 *
 * **本 Queue 的结构保证**：终点态的「按钮文案」与「点击后做什么」来自**同一个对象**
 * ⇒ 结构上不可能再出现「有按钮但无 action」这种分叉。
 *   - `validationComplete === false` → `null`（终点态之外不产生任何出口动作）；
 *   - `exitHref` 缺失 / 空串（宿主没声明返回地址）→ `null` ⇒ 页面**根本不画按钮**
 *     （而不是画一个点了没反应的按钮）。
 */
export interface NextRunFinalAction {
  /** 按钮文案（= 一句动作，不是状态）。 */
  readonly label: string;
  /** 点击后的**整页导航**目标（与 Validation Hub 入口同一套相对路径口径）。 */
  readonly href: string;
}

/**
 * 计算终点态的主动作（纯函数 → node 侧可直接断言「有按钮必有 action」）。
 */
export function nextRunFinalAction(
  validationComplete: boolean,
  exitHref: string | null | undefined,
): NextRunFinalAction | null {
  if (!validationComplete) return null;
  if (typeof exitHref !== 'string' || exitHref === '') return null;
  return { label: NEXT_RUN_VALIDATION_LABEL, href: exitHref };
}

/** 按 id 取种子（未知 → `null`，绝不静默回退到别的种子）。 */
export function nextRunSeedById(id: string): RunSeedOption | null {
  return NEXT_RUN_SEEDS.find((s) => s.id === id) ?? null;
}

/* ---------------------------------------------------- 上一局（快进脚手架） */

/**
 * 快进用的**每场掉血**（脚手架固定值，非平衡结论）。
 *
 * 取自 PRP-RUN-02 实测的「基础 Build 满耐久 1100」压力阶梯
 * （低压 181 / 中低压 221 / 中压 257）—— 三段打完仍剩 441 ⇒ 上一局在最后一天**仍然存活**
 * —— 本验证需要上一局以 `RUN COMPLETE` 结束（`FAILED` 不是本流程的入口）。
 *
 * ⚠️ PRODUCT-LOOP-R6-BASIC-ENCOUNTER-SEQUENCE：Run 从**四场**收成**三段**
 *    ⇒ 这个数组的长度随 `RUN_TOTAL_BATTLES` 走，多余项不会被读到（`battleIndex` 只走到 2）。
 */
const PRIOR_RUN_DAMAGE: readonly number[] = [181, 221, 257];

/**
 * 快进时上一局走过的**强化路线**（第一层 → 第二层；按 CHOICE 节点的到达顺序取值）。
 *
 * ⚠️ 与路线内容无关的验证目标：本 Queue 只关心「上一局存在且已结束」。
 *    这里选 `heavyShell → kineticBurst` 是因为它是既有条件池里最直接的一条联动。
 *
 * ⚠️ 这个数组的长度必须**恰好等于上一局实际会经过的 CHOICE 节点数**。
 *    PRODUCT-LOOP-R9-THREE-STAGE-BUILD-PACING：脚本是严格线性三段链，
 *    恰好 `d2-choice1`（第一层）与 `d3-choice2`（第二层）两个 CHOICE 节点 ⇒ 这里保持 **2 项**。
 *    任一项若不在当时那个节点的候选池里，快进会**停下报错**而不是静默换成别的。
 *
 * ⚠️ PRODUCT-LOOP-R7-WEAPON-BASIC-BUILD-CONTENT：候选池**按本局基准武器分成两族**
 *    （Cannon 三池 / 非 Cannon 的通用基础成长池，见 `runChoicePoolFamily`）——
 *    上面这张 Cannon 路线表在**非 Cannon 局里一项都不在池中**，快进会当场停住
 *    （实测：`EL-22` 用 `laser` 上下文时停在 `CHOICE`，拿不到 `COMPLETE`）。
 *    ⇒ 处置：**本脚手架只为自己拥有的那一族命名** ——
 *      · Cannon 族继续走上面这条声明路线（逐字节不变）；
 *      · 通用成长族**不由本文件命名任何 id**（它是一个**平铺的 3 项池**，没有「层级路线」
 *        语义，也不该在这里发明一条），而是按池**自己的声明顺序**取首项。
 *    两条支路都保留「取不到就 `break`」，**依然没有静默替换**。
 *    ⚠️ 刻意不在这里写死通用 id：本文件有一条源码守卫（`NR-03`）禁止出现未注册的强化 id
 *       字面量，且「通用池有哪些项」的真源只有 `runModifiers.RUN_GENERIC_CHOICE_POOL` 一处。
 */
const PRIOR_RUN_CHOICES: readonly RunModifierId[] = ['heavyShell', 'kineticBurst'];

/**
 * 快进时上一局在**耐久事件**上的选择。
 *
 * ⚠️ PRODUCT-LOOP-R9-THREE-STAGE-BUILD-PACING：脚本里已**没有** DURABILITY 节点
 *    ⇒ 下面那个分支当前不会被走到，这个常量是**保留的能力参数**（与状态机侧的
 *    `resolveDurability` 一起保留，脚本恢复该节点时立刻生效），不是当前路径的一部分。
 *
 *   ⚠️ 由此带来的口径变化（如实记录）：`repair` 分支过去会累计 `repairBonus`，
 *      而 `runCarriedPlayerHp` 会把 `repairBonus` 叠加到真实剩血上。现在这一步不再发生
 *      ⇒ `runCarriedPlayerHp(prior)` 报告的就是**裸剩血**（441），不再掺杂补偿。
 *      `priorRunSummary.durabilityPercent` 一直读 `battle.playerHp`（真实战果），**不受影响**。
 */
const PRIOR_RUN_DURABILITY = 'repair' as const;

/** 快进循环的硬上界（防脚本异常时死循环；正常一局远用不到）。 */
const PRIOR_RUN_GUARD = 64;

/** 快进的每场战斗步数（只用于让战报里的步数是一个真实量级的正数）。 */
const PRIOR_RUN_STEPS = 600;

/**
 * **确定性快进**：产出一个「上一局已经 RUN COMPLETE」的**真实状态机状态**。
 *
 * 推进方式与真人完全一致（同一批状态机函数），只有「每场结束时剩多少耐久」由
 * `PRIOR_RUN_DAMAGE` 决定 —— 因此不需要跑任何物理，也不引入任何随机性：
 * **同样输入必然得到同样输出**（测试可直接冻结结果）。
 *
 * ⚠️ 这不是产品路径：正式 Run 的起点永远由 `createRunPageState` / `createSeededNewRun` 给出。
 */
export function buildPriorCompletedRun(ctx: RunPageContext): RunPageState {
  let s = createRunPageState(ctx);
  let battleIndex = 0;
  let hp = ctx.playerHpMax;

  for (let guard = 0; guard < PRIOR_RUN_GUARD; guard++) {
    if (s.phase === 'COMPLETE' || s.phase === 'FAILED') break;

    if (s.phase === 'BATTLE') {
      // 本场结束：敌人被打光，玩家剩血按固定掉血表递减。
      hp = Math.max(1, hp - (PRIOR_RUN_DAMAGE[battleIndex] ?? PRIOR_RUN_DAMAGE[PRIOR_RUN_DAMAGE.length - 1]));
      battleIndex += 1;
      const done = finishRunBattle(s, {
        winner: 'A',
        endReason: 'hp',
        playerHp: hp,
        enemyHp: 0,
        steps: PRIOR_RUN_STEPS,
      });
      if (done === s) break; // 状态机拒绝（异常）→ 停止，绝不空转
      s = done;
      continue;
    }

    if (s.phase === 'CHOICE') {
      // ⚠️ PRODUCT-LOOP-R7：两族各有自己的「取哪个」规则（见 `PRIOR_RUN_CHOICES` 的注释）——
      //    Cannon 族 = 本脚手架声明的路线；通用成长族 = 池自己的声明顺序取首项。
      const pick =
        runChoicePoolFamily(s) === 'generic'
          ? runChoicePool(s)[0]?.id
          : PRIOR_RUN_CHOICES[s.buffs.length];
      if (!pick) break;
      const picked = chooseRunBuff(s, pick, ctx);
      if (picked === s) break; // 该去向不在当前候选池 → 停止（不静默换一个）
      s = picked;
      continue;
    }

    if (s.phase === 'DURABILITY') {
      // ⚠️ PRODUCT-LOOP-R9：脚本里已没有 DURABILITY 节点 ⇒ 当前走不到这里。
      //    保留这一支是为了「脚本恢复该节点时快进也不失配」。
      const resolved = resolveDurability(s, PRIOR_RUN_DURABILITY, ctx);
      if (resolved === s) break;
      s = resolved;
      continue;
    }

    // IDLE / EVENT / RESULT：按一下主动作（与真人同一个入口）。
    const pressed = pressRunAction(s, ctx);
    if (pressed === s) break;
    s = pressed;
  }

  return s;
}

/** 上一局的摘要（页面 / probe 用；全部从真实状态读出，不手写）。 */
export interface PriorRunSummary {
  /** 上一局结束时停在哪个脚本节点（FINAL = 走完了全程）。 */
  readonly nodeId: string;
  readonly day: number;
  readonly battlesCompleted: number;
  /** 上一局的 Build id 序列（新 Run 必须**不含**它们，只剩 seed）。 */
  readonly build: readonly string[];
  /** 上一局结束时的耐久百分比（新 Run 必须回到 100）。 */
  readonly durabilityPercent: number;
  readonly complete: boolean;
}

/** 读上一局摘要（纯读取）。 */
export function priorRunSummary(prior: RunPageState): PriorRunSummary {
  const b = prior.battle;
  return {
    nodeId: prior.nodeId,
    day: prior.day,
    battlesCompleted: prior.battlesCompleted,
    build: prior.buffs.map((x) => x.id),
    durabilityPercent:
      b && b.playerHpMax > 0 ? Math.max(0, Math.min(100, Math.round((b.playerHp / b.playerHpMax) * 100))) : 0,
    complete: prior.phase === 'COMPLETE',
  };
}

/* ------------------------------------------------------------ 新 Run 构造 */

/** 种子 → 本局 Build 里那一项（走既有 `RUN_CHOICE_OPTIONS`，不另造选项对象）。 */
export function runSeedChoiceOption(id: string): RunChoiceOption | null {
  const seed = nextRunSeedById(id);
  if (!seed) return null;
  return RUN_CHOICE_OPTIONS.find((o) => o.id === seed.id) ?? null;
}

/**
 * **开启全新 Run**（必改 2）：返回一个**与上一局完全没有共享状态**的新状态。
 *
 *   - 耐久满（`createRunPageState` 不携带任何 carry / repairBonus）；
 *   - DAY 回到 1（脚本第一个节点）；
 *   - 日志重置为「DAY 1 + 开场节拍 + 一行带种子的叙事」；
 *   - **上一局其它 Buff 全部不带**，Build 里**只有**刚选的 seed；
 *   - 战斗运行时不由本函数负责（宿主在切换到本状态时释放上一局的运行时）。
 *
 * ⚠️ 新 Run 的 `buffs` 长度为 1 ⇒ 第一场战斗注入的就是 `[seed]`（必改 3：真的进 Runtime）；
 *    后续 `d2-choice1` 若继续跑，候选池会是 **seed 对应的第二层条件池** ——
 *    这是「seed 占用了第一层选择」的自然推论（本 Queue 的验证在第一场就停止，不会走到）。
 *
 * 未知 seed → `null`（宿主不得据此进入新局，也不得回退到「无 seed 新局」）。
 */
export function createSeededNewRun(ctx: RunPageContext, seedId: string): RunPageState | null {
  const seed = nextRunSeedById(seedId);
  const option = runSeedChoiceOption(seedId);
  if (!seed || !option) return null;

  const base = createRunPageState(ctx);
  const lastSeq = base.log.length === 0 ? 0 : base.log[base.log.length - 1].seq;
  return {
    ...base,
    buffs: [option],
    log: [...base.log, { seq: lastSeq + 1, kind: 'choice', text: seed.startLog }],
  };
}
