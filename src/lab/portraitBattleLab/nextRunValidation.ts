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
 *   Queue 允许「模拟/进入 RUN COMPLETE」。真打完一局要走四场真实战斗，而本 Queue 的
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
/** 验证终点的可见标记（第一场结束后出现在唯一的主动作位置上）。 */
export const NEXT_RUN_VALIDATION_LABEL = '下一局验证完成';

/** 按 id 取种子（未知 → `null`，绝不静默回退到别的种子）。 */
export function nextRunSeedById(id: string): RunSeedOption | null {
  return NEXT_RUN_SEEDS.find((s) => s.id === id) ?? null;
}

/* ---------------------------------------------------- 上一局（快进脚手架） */

/**
 * 快进用的**每场掉血**（脚手架固定值，非平衡结论）。
 *
 * 前三个取自 PRP-RUN-02 实测的「基础 Build 满耐久 1100」压力阶梯
 * （低压 181 / 中低压 221 / 中压 257），第四场取 300 使上一局在第 7 天**仍然存活**
 * —— 本验证需要上一局以 `RUN COMPLETE` 结束（`FAILED` 不是本流程的入口）。
 */
const PRIOR_RUN_DAMAGE: readonly number[] = [181, 221, 257, 300];

/**
 * 快进时上一局走过的**强化路线**（第一层 → 第二层）。
 *
 * ⚠️ 与路线内容无关的验证目标：本 Queue 只关心「上一局存在且已结束」。
 *    这里选 `heavyShell → kineticBurst` 是因为它是既有条件池里最直接的一条联动。
 */
const PRIOR_RUN_CHOICES: readonly RunModifierId[] = ['heavyShell', 'kineticBurst'];

/**
 * 快进时上一局在耐久事件上的选择：**继续改装**。
 *
 * ⚠️ 刻意不选「维修」：`repair` 会累计 `repairBonus`，而 `runCarriedPlayerHp`
 *    会把 `repairBonus` 叠加到真实剩血上 —— 快进给的是「每场结束时的最终 HP」，
 *    若再叠一次补偿就会得到一个与表不符的数字。选 `upgrade` 让耐久链保持干净可预测。
 */
const PRIOR_RUN_DURABILITY = 'upgrade' as const;

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
      const pick = PRIOR_RUN_CHOICES[s.buffs.length];
      if (!pick) break;
      const picked = chooseRunBuff(s, pick, ctx);
      if (picked === s) break; // 该去向不在当前候选池 → 停止（不静默换一个）
      s = picked;
      continue;
    }

    if (s.phase === 'DURABILITY') {
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
  /** 上一局结束时停在哪个脚本节点（FINAL = 走完了七天）。 */
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
