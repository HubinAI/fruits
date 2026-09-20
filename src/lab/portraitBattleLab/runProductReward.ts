/**
 * PRODUCT-LOOP-R1-B-RUN-REWARD-PERMANENT-INVENTORY｜RUN COMPLETE 的**产品奖励出口**。
 * PRODUCT-LOOP-R2-A-REWARD-STACK-INVENTORY｜**改口径**：单件固定奖励 →「**候选列表**」。
 * PRODUCT-LOOP-R2-RECOVERY-ONBOARDING-CLARITY（必改 2）｜候选**当前只有 1 条**，
 * 卡片第二行改为**成长口径**（`当前 4/5 → 领取后 5/5`，见 `RunRewardChoiceView.progressText`）。
 * ⚠️ 本模块对候选**条数无假设**：N=1 与 N=3 走同一条代码路径
 *    （`runRewardChoiceRects(count)` 是 `Math.max(1, …)` ⇒ N=1 就是一张全宽卡）。
 *
 * 本模块只做三件事，全部是纯逻辑 / 纯几何（node 侧可直接断言）：
 *   ① 解析产品上下文（宿主从 URL 读到的 `run` 与 `choices` 两个参数）；
 *   ② 把每条「候选 + 库存读数」解析成**可绘制的最小视觉**（正式内容库的真实 Collider 外接框
 *      + `★` + 当前数量 + 领取后数量预览）；
 *   ③ 判定「终点态是否真的存在奖励出口」——**唯一的真源**，绘制 / 命中 / 文案 / 探针
 *      四处都从这里取（结构上不可能出现「画了卡片但其实拿不到」或「选了一个没地址的选项」）。
 *
 * ── 硬边界（写进代码，避免以后被误用）─────────────────────────────────────────
 *   - **不写库存、不写存档**：Lab 源码守卫 `R22a` 的 `ALLOWED_RELATIVE_IMPORTS` 是闭集，
 *     里面**没有** `core/buildPersistence` / `core/partInventory` ⇒ 本目录**结构上**写不了
 *     正式存档。「奖励入库」由产品侧的 Profile Repository（`src/product/playerProfile.ts`）
 *     在玩家带着 `claim` 参数回到首页时执行 —— 单机产品里只有**一个**写入点。
 *   - **不导航**：整页导航只由宿主 `runMain.ts` 执行（`runPage.ts` 与正式玩家页面共用，
 *     `RP-25` 机器禁止本目录的页面文件写 `location` / `history`）。
 *   - **FAILED 结构上拿不到奖励**：`runRewardChoiceViews()` 第一件事就是查 `runComplete(state)`
 *     —— 「失败也发奖」在结构上不可能，不是靠页面上自律（Queue 必改 4 / R2-A 必改 5）。
 *   - **候选与数量都只来自产品侧**：本模块不猜、不随机、不遍历候选池、**不读存档**
 *     （Queue 必改 4：「第一版只使用已有 cannon / spear / hammer」，且禁止随机奖励）。
 *   - **满 stack 阈值也由产品侧给**（`payload.stack`）：页面上写死一个 5 就是第二份真源，
 *     Queue B 做合成时两处必然漂移。
 */
import { registry } from '../../core/content';
import type { ColliderDef } from '../../core/types';
import { runComplete, type RunPageState } from './runPageState';

/** 面板标题（一句名词，不是状态描述）。 */
export const RUN_REWARD_TITLE = '选一件带回家';

/**
 * 面板说明（**承诺**而不是已完成的状态）。
 *
 * ⚠️ 入库发生在玩家**选中之后**（由产品侧 Profile Repository 幂等执行）——
 *    写成「已进入车库」就是假陈述。R1-B 的这条纪律在 3选1 下同样成立。
 */
export const RUN_REWARD_NOTE = '选中的那件会进入你的车库';

/**
 * 已选中标记（Queue 必改 4「当前 reward 被锁定」的可视形态）。
 *
 * ⚠️ 它表达的是**不可撤销**：选中即锁定 —— 再点别的选项不接受、也不会改主意。
 *    真正的幂等由产品侧账本保证（同一 Run 只入账一次），这里只负责「这一局已经定了」。
 */
export const RUN_REWARD_LOCKED_LABEL = '已选择';

/** URL 参数名（与产品侧 `runReward.ts` 的唯一约定；Lab 侧只读，不产出 URL）。 */
const RUN_PARAM = 'run';
const CHOICES_PARAM = 'choices';

/**
 * 产品上下文（由宿主 `runMain.ts` 从 URL 解析后注入，页面自身不读 URL）。
 *
 * ⚠️ 两个字段**都由产品侧提供**：Lab 不硬编码任何产品 URL
 *    （每条 `choice.href` 就是「选中它之后的去向」），因此 `runMain.ts` 里出现不了任何
 *    产品地址字面量 —— 这条由 `tests/portraitRunPage.test.ts` 的 `RP-25b` 机器钉死。
 */
export interface RunRewardChoiceSet {
  /** 本局唯一 token = 领奖幂等键（产品侧生成；同一 token 只能领一次）。 */
  readonly runToken: string;
  /** 满 stack 阈值（读数的分母；产品侧 `playerGrowth.FUSE_STACK` 给全，Lab 不自造）。 */
  readonly stack: number;
  /** 候选（至少 1 条；`(partId, star)` 在三选一里互不相同）。 */
  readonly choices: readonly RunRewardChoice[];
  /**
   * 解析时被**丢弃**的非法候选条数（0 = 产品侧给的载荷完全合法）。
   *
   * ⚠️ 刻意上报而不是静默吞掉：非法条目意味着产品侧出了 bug。丢弃是**兜底**
   *    （保证玩家至少还有选项，不会因为一条坏数据就整份奖励消失），
   *    但必须让这个事实可被看见 —— 探针与测试都会读它。
   */
  readonly dropped: number;
}

/** 一条候选（产品侧给的事实；`href` 是这一件自己的领奖地址）。 */
export interface RunRewardChoice {
  readonly defId: string;
  readonly star: number;
  /** 出发那一刻的库存数量（产品侧读的正式存档；Lab 读不到存档）。 */
  readonly countBefore: number;
  /** 选中这一件后落到的页面（产品侧给全，Lab 原样使用）。 */
  readonly href: string;
}

/** 出口请求（交给宿主执行导航；页面自己不做任何跳转）。 */
export interface RunProductClaim {
  readonly defId: string;
  readonly runToken: string;
  readonly href: string;
}

/** 一条候选的**可绘制视图**（图标几何 + 文字读数，全部与绘制同源）。 */
export interface RunRewardChoiceView {
  readonly defId: string;
  readonly name: string;
  readonly star: number;
  /** 正式能量消耗（展示用；不是本 Queue 的数值系统）。 */
  readonly energy: number;
  readonly countBefore: number;
  /** 选中后的数量（= `countBefore + 1`）。 */
  readonly countAfter: number;
  /** 数量预览文案，例如 `'4 → 5'`（Queue 必改 4 明列的第四项）。 */
  readonly previewText: string;
  /** stack 进度文案：满则 `'5/5'`，否则 `'4/5'`。 */
  readonly stackText: string;
  /**
   * PRODUCT-LOOP-R2-RECOVERY-ONBOARDING-CLARITY（必改 2）｜**成长口径的完整一行**。
   *
   * 值 = `当前 4/5 → 领取后 5/5`（阈值来自产品侧的 `stack`，数量是**真实计数**）。
   *
   * ── 为什么从 `拥有 ×4 → 领取后 ×5` 换成它 ────────────────────────────────
   * 真人反馈 ④：玩家完全找不到 `4/5` / `5/5` 这条真实成长过程 —— 三张卡的第二行写的是
   * 「库存多了一个」，而这一局真正要建立的认知是「**还差 1 个 → 到 5/5 → 可以升星**」。
   * ⇒ 本 Queue 授权打开这一行文案（只改**信息表达**，不改 Layout / 不改奖励行为）。
   *
   * ⚠️ 数字**动态**取真实计数，不写死 `4/5`（Queue 明令「不要伪造」）。
   * ⚠️ 两侧都用**原始计数**（不夹到阈值）：`stackText` 会在 ≥ 阈值时收敛成 `5/5`
   *    （那是 Garage「进度读数」那条 Queue 规则的写法），但这一行的语义是
   *    「现在有几件 → 领完有几件」，把它夹成「5/5 → 5/5」等于告诉玩家「领取没有变化」，
   *    那才是伪造。超过阈值的真实读数（`6/5`）在这里是**如实**的。
   */
  readonly progressText: string;
  /** 读数的分母（= 产品侧给的满 stack 阈值；区间 `4/5` 里的那个 5）。 */
  readonly stackLimit: number;
  /** 选中这一件后是否达到满 stack（玩家能体验第一次合成）。 */
  readonly reachesThreshold: boolean;
  /** 外接框宽 / 高（车体本地单位）。 */
  readonly w: number;
  readonly h: number;
  /** 真实 Collider 形状是否为圆形（圆形画圆，其余画矩形框）。 */
  readonly round: boolean;
  /** 该部件是否有正式 sprite（无 → 明确标注，绝不伪装成已用真实美术）。 */
  readonly hasSprite: boolean;
}

/**
 * 真实 Collider 的外接框（口径与构建期一致；`R22a` 只放行 `core/types` 与 `core/content`）。
 *   - box：`offset` 即矩形中心；
 *   - circle：`offset` 即圆心，直径 = 2r；
 *   - polygon：`vertices` **相对 offset** ⇒ 框宽高 = 顶点包围盒尺寸。
 */
export function rewardColliderGeom(c: ColliderDef): { w: number; h: number; round: boolean } {
  if (c.shape === 'circle') return { w: (c.radius ?? 0) * 2, h: (c.radius ?? 0) * 2, round: true };
  if (c.shape === 'polygon') {
    const vs = c.vertices ?? [];
    if (vs.length === 0) return { w: 0, h: 0, round: false };
    const xs = vs.map((v) => v.x);
    const ys = vs.map((v) => v.y);
    return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), round: false };
  }
  return { w: c.width ?? 0, h: c.height ?? 0, round: false };
}

/** 把外接框按 fit 缩放塞进图标方框（只缩不放；返回**屏幕像素**尺寸）。 */
export function fitRewardIcon(
  view: { w: number; h: number },
  boxW: number,
  boxH: number,
): { w: number; h: number } {
  const w = Math.max(1, view.w);
  const h = Math.max(1, view.h);
  const s = Math.min(boxW / w, boxH / h, 1);
  return { w: Math.round(w * s), h: Math.round(h * s) };
}

/**
 * 一条候选 → 可绘制视图。**未知 / 非 weapon / 读数非法一律 `null`**
 * （绝不静默回退到别的部件；也绝不给一张读数说不清的卡）。
 */
export function rewardChoiceView(
  choice: RunRewardChoice,
  stack: number,
): RunRewardChoiceView | null {
  const def = registry.functionals.get(choice.defId);
  if (!def || def.category !== 'weapon') return null;
  if (!Number.isFinite(choice.countBefore) || choice.countBefore < 0) return null;
  if (!Number.isFinite(choice.star) || choice.star < 1) return null;
  const limit = Math.max(1, Math.floor(Number.isFinite(stack) ? stack : 1));
  const before = Math.floor(choice.countBefore);
  const after = before + 1;
  const geom = rewardColliderGeom(def.collider);
  return {
    defId: def.id,
    name: def.name,
    star: Math.floor(choice.star),
    energy: def.energy,
    countBefore: before,
    countAfter: after,
    previewText: `${before} → ${after}`,
    stackText: before >= limit ? `${limit}/${limit}` : `${before}/${limit}`,
    // 必改 2：成长口径那一行（真实计数，两侧都不夹 —— 见字段注释）
    progressText: `当前 ${before}/${limit} → 领取后 ${after}/${limit}`,
    stackLimit: limit,
    reachesThreshold: after >= limit,
    w: geom.w,
    h: geom.h,
    round: geom.round,
    hasSprite: !!def.visual,
  };
}

/**
 * 从 `location.search` 形态的字符串解析产品上下文。
 *
 * 两个参数**缺一不可**（缺 / 坏 ⇒ `null` = 不进产品奖励模式，页面与既有路径逐像素相同）；
 * 并且候选必须**至少一条能解析成真实卡片**（全坏 ⇒ `null`，**不画假奖励**）。
 * 部分坏 ⇒ 保留好的、把坏条数记进 `dropped`（见该字段注释）。
 */
export function parseRunRewardChoices(search: string): RunRewardChoiceSet | null {
  if (typeof search !== 'string' || search === '') return null;
  let p: URLSearchParams;
  try {
    p = new URLSearchParams(search);
  } catch {
    return null;
  }
  const runToken = p.get(RUN_PARAM) ?? '';
  const raw = p.get(CHOICES_PARAM) ?? '';
  if (runToken === '' || raw === '') return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  const stackRaw = Number(obj['stack']);
  const listRaw = obj['choices'];
  if (!Array.isArray(listRaw) || listRaw.length === 0) return null;

  const stack = Number.isFinite(stackRaw) && stackRaw >= 1 ? Math.floor(stackRaw) : 0;
  const choices: RunRewardChoice[] = [];
  let dropped = 0;
  for (const item of listRaw) {
    if (!item || typeof item !== 'object') {
      dropped += 1;
      continue;
    }
    const o = item as Record<string, unknown>;
    const defId = typeof o['defId'] === 'string' ? o['defId'] : '';
    const href = typeof o['href'] === 'string' ? o['href'] : '';
    const star = Number(o['star']);
    const countBefore = Number(o['countBefore']);
    const entry: RunRewardChoice = { defId, star, countBefore, href };
    if (href === '' || !rewardChoiceView(entry, stack)) {
      dropped += 1;
      continue;
    }
    choices.push(entry);
  }
  if (choices.length === 0) return null;
  return { runToken, stack, choices, dropped };
}

/**
 * 终点态的**唯一**奖励出口集合 —— 本 Queue 的中心判据。
 *
 *   - 没有产品上下文（`set === null`）→ `[]`：既有验证 / 玩家路径行为**零变化**；
 *   - **不是 `COMPLETE`**（含 `FAILED`）→ `[]`：失败终态**结构上**没有奖励出口
 *     （R2-A 必改 5：FAILED 无奖励选择 / 无 count 变化 / 无 Profile 增长）；
 *   - 有任何一条解析不出真实卡片 → 它已经在 `parseRunRewardChoices` 被丢弃并计入 `dropped`，
 *     这里再取一次视图（徽标与出口同源）；
 *   - 齐备 → 可绘制视图列表（顺序 = 产品侧给的顺序）。
 */
export function runRewardChoiceViews(
  state: RunPageState,
  set: RunRewardChoiceSet | null | undefined,
): readonly RunRewardChoiceView[] {
  if (!set) return [];
  if (!runComplete(state)) return [];
  const out: RunRewardChoiceView[] = [];
  for (const c of set.choices) {
    const v = rewardChoiceView(c, set.stack);
    if (v) out.push(v);
  }
  return out;
}

/**
 * 玩家**选中某一件**之后的出口请求（Queue 必改 4 的动作面）。
 *
 * 三道闸门缺一不可（任一不满足 ⇒ `null`，页面不接受这次选择）：
 *   ① 有产品上下文；
 *   ② 是 `COMPLETE`（FAILED 结构上拿不到）；
 *   ③ 被选中的 defId **就在这次给的候选里**（防「点了一个不在候选里的卡」这类接线 bug）。
 */
export function runSelectedClaim(
  state: RunPageState,
  set: RunRewardChoiceSet | null | undefined,
  defId: string,
): RunProductClaim | null {
  if (!set) return null;
  if (!runComplete(state)) return null;
  const hit = set.choices.find((c) => c.defId === defId);
  if (!hit) return null;
  return { defId: hit.defId, runToken: set.runToken, href: hit.href };
}
