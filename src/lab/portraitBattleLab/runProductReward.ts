/**
 * PRODUCT-LOOP-R1-B-RUN-REWARD-PERMANENT-INVENTORY｜RUN COMPLETE 的**产品奖励出口**。
 *
 * 本模块只做三件事，全部是纯逻辑 / 纯几何（node 侧可直接断言）：
 *   ① 解析产品上下文（宿主从 URL 读到的 `run` / `reward` / `back` 三个参数）；
 *   ② 把「奖励部件 defId」解析成**可绘制的最小视觉**（正式内容库的真实 Collider 外接框）；
 *   ③ 判定「终点态是否真的存在奖励出口」——**唯一的真源**，按钮文案 / 点击行为 / 探针
 *      三处都从这里取（结构上不可能出现「有按钮但无 action」或「画了奖励但其实拿不到」）。
 *
 * ── 硬边界（写进代码，避免以后被误用）─────────────────────────────────────────
 *   - **不写库存、不写存档**：Lab 源码守卫 `R22a` 的 `ALLOWED_RELATIVE_IMPORTS` 是闭集，
 *     里面**没有** `core/buildPersistence` / `core/partInventory` ⇒ 本目录**结构上**写不了
 *     正式存档。「奖励入库」由产品侧的 Profile Repository（`src/product/playerProfile.ts`）
 *     在玩家带着 `claim` 参数回到首页时执行 —— 单机产品里只有**一个**写入点。
 *   - **不导航**：整页导航只由宿主 `runMain.ts` 执行（`run-page.ts` 与正式玩家页面共用，
 *     `RP-25` 机器禁止本目录的页面文件写 `location` / `history`）。
 *   - **FAILED 结构上拿不到奖励**：`runProductClaimNow()` 第一件事就是查 `runComplete(state)`
 *     —— 「失败也发奖」在结构上不可能，不是靠页面上自律（Queue 必改 4）。
 *   - **奖励 id 只来自产品侧**：本模块不猜、不随机、不遍历候选池（Queue 必改 2：
 *     验证的是「获得一个新东西后想不想马上装上它」，不是随机掉落）。
 */
import { registry } from '../../core/content';
import type { ColliderDef } from '../../core/types';
import { runComplete, type RunPageState } from './runPageState';

/** 卡片标题（一句名词，不是状态描述）。 */
export const RUN_REWARD_TITLE = '本局获得';

/**
 * 终点态的动作文案。
 *
 * ⚠️ 必须是**一句动作**：「领取并返回」= 领奖 + 整页导航回正式首页。
 *    PRP-M2-R1 的 P0 教训（按钮文案写成状态描述 ⇒ 真人连点无反应）在这里同样适用。
 */
export const RUN_REWARD_CLAIM_LABEL = '领取并返回';

/**
 * 卡片上说明「这件东西会去哪」的一行。
 *
 * ⚠️ 措辞必须是**承诺**而不是**已完成的状态**：入库发生在玩家点「领取并返回」之后
 *    （由产品侧 Profile Repository 幂等执行）——写成「已进入车库」就是假陈述。
 */
export const RUN_REWARD_NOTE = '领取后进入你的车库';

/**
 * 产品上下文（由宿主 `runMain.ts` 从 URL 解析后注入，页面自身不读 URL）。
 *
 * ⚠️ 三个字段**都由产品侧提供**：Lab 不硬编码任何产品 URL
 *    （`backHref` 就是「领取并返回」的目标），因此 `runMain.ts` 里出现不了任何
 *    产品地址字面量 —— 这条由 `tests/portraitRunPage.test.ts` 的 `RP-25b` 机器钉死。
 */
export interface RunProductReward {
  /** 本局奖励的正式部件 defId（必须是内容库内 `category === 'weapon'` 的正式部件）。 */
  readonly defId: string;
  /** 本局唯一 token = 领奖幂等键（产品侧生成；同一 token 只能领一次）。 */
  readonly runToken: string;
  /** 「领取并返回」的整页导航目标（产品侧给全，Lab 原样使用）。 */
  readonly backHref: string;
}

/** 出口请求（交给宿主执行导航；页面自己不做任何跳转）。 */
export interface RunProductClaim {
  readonly defId: string;
  readonly runToken: string;
  readonly href: string;
}

/** 「本局获得」卡片的内容（最小必要视觉 = 真实 Collider 外接框）。 */
export interface RunRewardCard {
  readonly defId: string;
  readonly name: string;
  /** 正式能量消耗（展示用；不是本 Queue 的数值系统）。 */
  readonly energy: number;
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

/**
 * defId → 卡片内容。**未知 / 非 weapon / 非正式部件一律 `null`**（绝不静默回退到别的部件）。
 * 「正式」的判据 = 内容库里查得到 + `category === 'weapon'`（Queue 必改 2：只复用已有正式 Weapon）。
 */
export function runRewardCard(defId: string | null | undefined): RunRewardCard | null {
  if (typeof defId !== 'string' || defId === '') return null;
  const def = registry.functionals.get(defId);
  if (!def || def.category !== 'weapon') return null;
  const geom = rewardColliderGeom(def.collider);
  return {
    defId: def.id,
    name: def.name,
    energy: def.energy,
    w: geom.w,
    h: geom.h,
    round: geom.round,
    hasSprite: !!def.visual,
  };
}

/** 把外接框按 fit 缩放塞进图标方框（只缩不放；返回**屏幕像素**尺寸与偏移）。 */
export function fitRewardIcon(
  card: RunRewardCard,
  boxW: number,
  boxH: number,
): { w: number; h: number } {
  const w = Math.max(1, card.w);
  const h = Math.max(1, card.h);
  const s = Math.min(boxW / w, boxH / h, 1);
  return { w: Math.round(w * s), h: Math.round(h * s) };
}

/**
 * 从 `location.search` 形态的字符串解析产品上下文。
 *
 * 三个参数**缺一不可**（缺 ⇒ `null` = 不进产品奖励模式，页面与既有路径逐像素相同）；
 * 并且 `reward` 必须能解析成一张真实卡片（未知 id ⇒ `null`，**不画假奖励**）。
 */
export function parseRunProductReward(search: string): RunProductReward | null {
  if (typeof search !== 'string' || search === '') return null;
  let p: URLSearchParams;
  try {
    p = new URLSearchParams(search);
  } catch {
    return null;
  }
  const runToken = p.get('run') ?? '';
  const defId = p.get('reward') ?? '';
  const backHref = p.get('back') ?? '';
  if (runToken === '' || defId === '' || backHref === '') return null;
  if (!runRewardCard(defId)) return null;
  return { defId, runToken, backHref };
}

/**
 * 终点态的**唯一**奖励出口 —— 本 Queue 的中心判据。
 *
 *   - 没有产品上下文（`reward === null`）→ `null`：既有验证 / 玩家路径行为**零变化**；
 *   - **不是 `COMPLETE`**（含 `FAILED`）→ `null`：失败终态**结构上**没有奖励出口；
 *   - 奖励 id 解析不出真实卡片 → `null`：不产生「画了按钮但拿不到东西」的分叉；
 *   - 齐备 → 出口（文案 + 幂等键 + 目标地址）。
 */
export function runProductClaimNow(
  state: RunPageState,
  reward: RunProductReward | null | undefined,
): RunProductClaim | null {
  if (!reward) return null;
  if (!runComplete(state)) return null;
  if (!runRewardCard(reward.defId)) return null;
  return { defId: reward.defId, runToken: reward.runToken, href: reward.backHref };
}
