/**
 * PRODUCT-LOOP-R1-D-FAILED-SETTLEMENT-TO-HOME｜失败结算与**返回主界面**出口。
 *
 * 本模块回答三个问题，全部只在这里回答一次（纯逻辑，node 侧可直接断言）：
 *   ① 「宿主有没有给失败回程地址」→ `parseRunFailReturn()`；
 *   ② 「这一局结束了吗、结算上写什么」→ `runFailSettlementNow()`（绘制 / 命中 / 探针同源）；
 *   ③ 「失败的唯一出口是什么」→ `settlement.href`（空串 = 没有出口 ⇒ 页面**不画按钮**）。
 *
 * ── 为什么需要独立模块 ─────────────────────────────────────────────────────
 *   - `runProductReward.ts` 是 **RUN COMPLETE 的奖励出口**，Queue 必改 5 要求成功链
 *     「完全冻结」⇒ 失败链的任何一行代码都不应该出现在那个文件里（改动本身就是风险）；
 *   - `runPage.ts` 是绘制 / 输入 / 宿主接线，策略写在里面**无法被 node 侧直接断言**；
 *   - 于是本模块承担「唯一真源」：绘制、命中区、探针三处都读同一个函数
 *     ⇒ 结构上不可能出现「画了按钮但点了没反应」或「结算写 A、点了去 B」。
 *
 * ── 硬边界（写进代码，避免以后被误用）────────────────────────────────────────
 *   - **不导航**：整页导航只由宿主 `runMain.ts` 执行（`RP-25` 机器禁止 Lab 页面写
 *     `location` / `history`），本模块连一个地址字面量都没有（地址是宿主交进来的**数据**）；
 *   - **不发奖**：不 import 任何奖励 / 库存 / 存档模块（Lab 闭集白名单里本来也没有）
 *     ⇒ 「失败也发奖」在结构上不可能，不是靠页面上自律（Queue 必改 5）；
 *   - **不开新局**：本模块**没有** `createRunPageState()` 这条边（Queue 必改 6：
 *     只有玩家回首页之后重新点「开始冒险」才允许创建新的 Run）；
 *   - **不新增 phase**：复用既有失败终态 `FAILED`（`runPageState.ts` 一字未改）
 *     ⇒ 「已通过的 Run 节奏」不被本 Queue 触碰。
 */
import { durabilityPercent, runFailed, type RunPageState } from './runPageState';

/** 结算标题 —— 玩家一眼看到「这一局结束了，而且是失败」。 */
export const RUN_FAIL_TITLE = '冒险失败';

/**
 * 失败终态的**唯一**主 CTA 文案。
 *
 * ⚠️ 必须是**一句动作**（「返回主界面」= 清理运行期 + 整页导航回正式首页），
 *    而不是状态描述 —— 按钮文案写成状态描述（PRP-M2-R1 的 P0）会让真人连点无反应。
 * ⚠️ 刻意**不是**「重新开始冒险 / 再来一次」：本 Queue 明令禁止在失败页提供重开，
 *    玩家的下一步是「回首页 → 调整战车 → 自己决定什么时候再出发」。
 */
export const RUN_FAIL_RETURN_LABEL = '返回主界面';

/**
 * 失败回程地址的 URL 参数名（产品侧给全，Lab 侧只原样使用）。
 *
 * ⚠️ 它和 COMPLETE 的 `back` **是两个不同的东西**，这是必改 5 在**地址层**上的保证：
 *   - `back`  = 领奖地址（产品侧收到它会执行一次幂等入库）→ 只发给 COMPLETE 出口；
 *   - `home`  = 纯首页地址（**不带任何领奖参数**）→ 只发给失败出口。
 *   失败链因此**结构上拿不到**领奖地址 ⇒ 不可能「失败也领到奖」。
 *
 * ⚠️ 值与产品侧 `runReward.ts` 的 `HOME_PARAM` 同值，由测试双向钉死
 *    （两侧各自声明、必须同值 —— 改单边 = 静默断链）。
 */
export const RUN_FAIL_PARAM = 'home';

/** 最终耐久已被打光时的玩家口径（如实陈述，不谎报剩余百分比）。 */
export const RUN_FAIL_DURABILITY_ZERO = '已耗尽';
/** 本局一次改装都没拿到时的最终 Build 口径。 */
export const RUN_FAIL_NO_BUILD = '未做任何改装';

/**
 * 宿主交进来的失败回程地址（**不透明**：本模块不解析、不校验它的内容）。
 *
 * 与 `exitHref` / `RunProductReward.backHref` 同一纪律：Lab 侧不硬编码任何产品地址
 * （`EL-32` / `RP-25b` 机器钉死），因此「首页叫什么」这件事在产品侧只有**一个**真源。
 */
export interface RunFailReturn {
  readonly href: string;
}

/**
 * 失败结算的**完整内容**（标题 / 失败 DAY / 最终 Build / 最终耐久 / 唯一出口）。
 *
 * 形成「画什么」与「点了去哪」的同一份数据 ⇒ 两者不可能分叉。
 */
export interface RunFailSettlement {
  readonly title: string;
  /** 失败时所在的 DAY（真实状态，不是写死数字）。 */
  readonly day: number;
  /** 本局最终 Build（玩家选过的强化标签，按选择顺序）。 */
  readonly buildLabels: readonly string[];
  /** 最终耐久百分比（0..100，真实 HP 比例）。 */
  readonly durabilityPercent: number;
  /** 面板上的三行信息（顺序 = 绘制顺序；内容全部来自真实状态）。 */
  readonly lines: readonly string[];
  /** 唯一主 CTA 的文案。 */
  readonly label: string;
  /**
   * 唯一出口的地址。
   * ⚠️ **空串 = 宿主没有给回程地址**（研发入口）⇒ 页面**不画按钮**
   *    （绝不画一个点了没反应的按钮 —— 见 `RP-M2-R1` 的 P0 教训）。
   */
  readonly href: string;
}

/**
 * 从 `location.search` 形态的字符串解析失败回程地址。
 *
 * 唯一的判据是「`home` 参数存在且非空」：其它参数一概不参与
 * （`run` / `reward` / `back` / `equipped` 对失败链**没有任何影响** ——
 * 失败页面结构上读不到奖励与装备，因此不存在「失败时按领奖参数做了别的事」）。
 */
export function parseRunFailReturn(search: string): RunFailReturn | null {
  if (typeof search !== 'string' || search === '') return null;
  let p: URLSearchParams;
  try {
    p = new URLSearchParams(search);
  } catch {
    return null;
  }
  const href = p.get(RUN_FAIL_PARAM) ?? '';
  if (href === '') return null;
  return { href };
}

/**
 * 失败结算的**唯一**生产点。
 *
 *   - 不是 `FAILED` → `null`：本函数只服务失败终态，其它相位一个字段都不会多出来
 *     ⇒ 既有流程（IDLE / EVENT / BATTLE / RESULT / CHOICE / DURABILITY / COMPLETE）
 *     的诊断口径零变化；
 *   - 是 `FAILED` → 结算（即使宿主没给地址也返回，只是 `href` 为空串）
 *     ⇒ 「失败必须被明确呈现」这件事**不依赖**任何产品参数。
 *
 * ⚠️ 内容只陈述**真的发生过**的事：DAY 来自状态、Build 来自本局真是拿到的强化、
 *    耐久来自最后一场真实战斗的 HP ⇒ 这里不可能出现一个没发生过的结果。
 */
export function runFailSettlementNow(
  state: RunPageState,
  ret: RunFailReturn | null | undefined,
): RunFailSettlement | null {
  if (!runFailed(state)) return null;
  const buildLabels = state.buffs.map((b) => b.label);
  const pct = state.battle ? durabilityPercent(state.battle) : 0;
  const durabilityText = pct <= 0 ? RUN_FAIL_DURABILITY_ZERO : `剩余 ${pct}%`;
  return {
    title: RUN_FAIL_TITLE,
    day: state.day,
    buildLabels,
    durabilityPercent: pct,
    lines: [
      `失败于 DAY ${state.day}`,
      `最终改装：${buildLabels.length > 0 ? buildLabels.join(' + ') : RUN_FAIL_NO_BUILD}`,
      `战车耐久：${durabilityText}`,
    ],
    label: RUN_FAIL_RETURN_LABEL,
    href: ret?.href ?? '',
  };
}
