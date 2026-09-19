/**
 * PRODUCT-LOOP-R1-A-HOME-GARAGE-INVENTORY｜竖屏正式产品主循环第一段的**页面**。
 *
 * 首屏 = 「我的战车」首页；「调整战车」是**同一页面的另一个视图**（整页零跳转，
 * 与本分支既有玩家页面「单页多状态」的产品结构一致）。
 *
 *   `首页（看车 + 已装备） --[调整战车]--> 调整战车（选一个已拥有武器 → 装备） --[返回首页]--> 首页（同步变化）`
 *
 * 视图层职责边界（与既有页面同一套路）：
 *   - **不推导任何数据**：车身 / 耐久 / 能量 / 槽位 / 可装备武器 / 当前主武器，
 *     全部来自 `playerLoadout.ts`（唯一数据源）与 `vehiclePreview.ts`（纯几何）；
 *   - **不写存档**：写只发生在 `equipWeapon()` 内部（含 `validateSnapshot` 与 `savePlayerBuild`）；
 *   - **不新建 Runtime**：本页没有物理、没有战斗、没有相机、没有 Gameplay 状态机
 *     （`开始冒险` 只是同产物内的相对链接，本轮不改 Run —— 见 Queue 冻结项）。
 *
 * 视觉：竖屏 390×844 逻辑舞台（与 Run Page 同一口径），DOM 承载（**零画布**）。
 * 车辆预览用正式 `assets/visuals/*.png`（与战斗里同一批文件），缺图退化为灰色外接框并
 * 如实标注 —— 不伪造外形、不新增美术。
 */

import '../platform/bootstrap'; // 必须是第一个 import：绑定 Web PlatformCore（storage 等）

import bodyWatermelonUrl from '../../assets/visuals/body_watermelon.png';
import bodyBananaUrl from '../../assets/visuals/body_banana.png';
import partCannonUrl from '../../assets/visuals/part_cannon.png';
import partHammerUrl from '../../assets/visuals/part_hammer.png';
import partPushRodUrl from '../../assets/visuals/part_pushRod.png';

import type { BuildDraft } from '../lab/buildEditorModel';
import type { PartInventory } from '../core/partInventory';
import {
  WEAPON_SLOT,
  equipWeapon,
  loadEquippedDraft,
  loadoutReading,
  playerInventory,
  type EquipFailure,
  type LoadoutReading,
} from './playerLoadout';
import { vehiclePreviewLayout, type VehiclePreviewLayout } from './vehiclePreview';
/**
 * PRODUCT-LOOP-R1-B｜领奖闭环的两块产品侧拼图：
 *   - `runReward.ts`：奖励策略 + **产品地址唯一真源**（`开始冒险` 的 href 由它产出）；
 *   - `playerProfile.ts`：**Profile Repository** —— 本页**唯一**允许触碰持久化状态的地方。
 *
 * ⚠️ 本页自己**不碰** `localStorage` / `platform.storage`（必改 1：UI 不得直接读写 localStorage），
 *    这条由 `tests/productLoopRunReward.test.ts` 的 `PR-20` 源码守卫机器钉死。
 *
 * PRODUCT-LOOP-R2-A｜额外两块：
 *   - `playerGrowth.ts`：永久成长的**唯一模型与写入口**（新账号种子 / Equipped stack 兜底）；
 *     本页只调 `openGrowthSession()` 一次，不自己拼装成长逻辑。
 * PRODUCT-LOOP-R2-B｜本页多一个**写动作**：Garage 里对满 5 件的卡点一次「合成」。
 *   - 合成规则与判定**一行都不在本页**：调 `playerGrowth.fuseStack()`（唯一合成动作），
 *     本页只负责①把 `weaponEntries()` 给的 `fusable` 画成「可合成」徽标与按钮、
 *     ②把 `fuseStack` 返回的**真实**结果重读到屏幕上（成功就换掉手里的库存与 Build）。
 *   - ⚠️ 本页**不**做任何连锁 / 批量合成（一次点击 = 一次 5 合 1，Queue 必改 5），
 *     也**不做**拖拽合成（Queue 必改 3：第一版只验证成长循环）。
 */
import {
  REWARD_CHOICE_IDS,
  buildAdventureHref,
  buildRewardChoicePayload,
  newRunToken,
  parsePendingClaim,
  type PendingClaim,
  type RewardChoiceSpec,
} from './runReward';
import { claimRunReward, claimedRunCount, type ClaimOutcome } from './playerProfile';
import {
  GROWTH_STAR,
  FUSE_STACK,
  fuseStack,
  growthStacks,
  openGrowthSession,
  type FusionResult,
  type GrowthSession,
} from './playerGrowth';

/** 正式 visualId → 正式资源 URL（与战斗 / Run Page 引用的是同一批 PNG 文件）。 */
const SPRITE_URLS: Readonly<Record<string, string>> = {
  body_watermelon: bodyWatermelonUrl,
  body_banana: bodyBananaUrl,
  part_cannon: partCannonUrl,
  part_hammer: partHammerUrl,
  part_pushRod: partPushRodUrl,
};

export const HOME_TITLE = '我的战车';
export const HOME_GARAGE_LABEL = '调整战车';
export const HOME_START_LABEL = '开始冒险';
export const GARAGE_TITLE = '调整战车';
export const GARAGE_BACK_LABEL = '返回首页';
export const GARAGE_EQUIP_LABEL = '装备';
/**
 * PRODUCT-LOOP-R2-B｜合成动作的文案（Queue 必改 3）。
 *   - `可合成`：满 5 件且未到星级上限时**明确**显示的状态词（不是隐晦的进度数字）；
 *   - `合成`：第一版唯一的合成入口 —— 点一次执行**一次** 5 合 1（必改 5：不连锁）；
 *   - `已满星`：★5 的卡不再有合成入口（Queue：「5★为当前最高星级，不可继续合成」）。
 */
export const GARAGE_FUSE_LABEL = '合成';
export const GARAGE_FUSE_READY_LABEL = '可合成';
export const GARAGE_MAX_STAR_LABEL = '已满星';
/**
 * `开始冒险` 的目的地：**不再是页面里的字面量**。
 *
 * PRODUCT-LOOP-R1-B 起该地址由 `runReward.ts` 的 `buildAdventureHref()` 产出
 * （带本局 token / 奖励 id / 回程地址），产品 URL 只在那一个模块里出现一次
 * （`tests/productLoopRunReward.test.ts` 的 `PR-21` 机器钉死）。
 */
/** 领奖提示文案（本页只展示 Repository 的**真实**结果，不做乐观提示）。 */
export const CLAIM_OK_LEAD = '已获得';
export const CLAIM_DUPLICATE_TEXT = '本局奖励已领取过（不会重复发放）。';
export const CLAIM_FAIL_TEXT = '本局奖励未能入库';
/** 正式逻辑舞台（与 Run Page 同口径）。 */
export const PRODUCT_STAGE_W = 390;
export const PRODUCT_STAGE_H = 844;
/**
 * 装备状态落盘的正式 key（**只读展示**：本页自己不碰 localStorage，
 * 写只发生在 `core/buildPersistence.ts` 内）。E2E 用它证明「装备写进了正式存档」。
 */
export const SAVE_KEY = 'strongfruit.playerBuild.v1';

export type ProductView = 'home' | 'garage';

export interface ProductProbe {
  readonly view: ProductView;
  readonly bodyName: string;
  readonly hp: number;
  readonly energy: number;
  readonly energyCapacity: number;
  readonly weaponSlot: string;
  readonly equippedWeaponId: string;
  readonly equippedWeaponName: string;
  readonly weaponIds: readonly string[];
  readonly weaponNames: readonly string[];
  /**
   * PRODUCT-LOOP-R2-A｜每件武器的**成长读数**（逐 `(defId, star)` 一条）。
   *
   * ⚠️ 直接来自 `playerLoadout.weaponEntries()`（Garage 卡片画的**就是这些字段**，
   *    不是探针另算一份）⇒ 「屏幕上写着 `4/5`」与「探针说 count=4」不可能分叉。
   * ⚠️ PRODUCT-LOOP-R2-B｜同一个 `defId` 现在可能出现**多条**（★1 与 ★2 是两个 stack）。
   *    因此「取某件的读数」必须**同时**按 `defId` + `star` 定位，只按 defId 取会拿到第一条。
   */
  readonly weapons: readonly {
    readonly defId: string;
    readonly name: string;
    readonly star: number;
    readonly count: number;
    readonly threshold: number;
    /** 卡片上的进度写法：`4/5`（满则 `5/5`） */
    readonly stackText: string;
    readonly reachesThreshold: boolean;
    /** 该星级下**实际**占用的能量（★1 恒等于基准值） */
    readonly energyInUse: number;
    /** 现在能不能对这张卡发起一次合成（= Queue「可合成」徽标的判据） */
    readonly fusable: boolean;
    /** 已到 ★5 星级上限（不可再合） */
    readonly maxStar: boolean;
    /** PRODUCT-LOOP-R2-C：该星级下一次命中扣对手多少血（= 战斗侧真实结算的那个数） */
    readonly damage: number;
    /** 升一星后的伤害；★5 ⇒ `null` */
    readonly damageNext: number | null;
    /** 卡片上那一行字：`攻击 80 → 100` */
    readonly damageText: string;
  }[];
  /**
   * 本局 3选1 的三条候选读数（与 `开始冒险` 地址里 `choices` 载荷**同源**）。
   *
   * ⚠️ 这是「COMPLETE 会出现哪三件」在产品侧的**出发时快照**；真正的展示由 Run Page 读
   *    地址里的 `choices` 决定。两边同源（都出自本页这一次 `specsNow()`）⇒ E2E 可以对账。
   */
  readonly rewardChoices: readonly RewardChoiceSpec[];
  /**
   * PRODUCT-LOOP-R2-A｜本次挂载的成长会话读数（新账号种子 / Equipped stack 兜底）。
   * ⚠️ `fresh===true` 且 `seeded===true` ⇒ 这是**新账号的第一次挂载**，库存被抬到
   *    `cannon ×4`；老档两者恒为 false（种子只发新账号，Queue 必改 3）。
   */
  readonly growth: {
    readonly fresh: boolean;
    readonly seeded: boolean;
    readonly repairedEquipped: string | null;
    readonly stackThreshold: number;
  };
  /**
   * PRODUCT-LOOP-R2-B｜**当前装备的星级**（`BuildDraft.functionalStars` 缺省 = ★1）。
   * ⚠️「装备」在产品侧 = `(equippedWeaponId, equippedWeaponStar)` **这一对**；
   *    只报 defId 会让「★1 的炮」与「★2 的炮」看起来是同一件事。
   */
  readonly equippedWeaponStar: number;
  readonly selectedWeaponId: string | null;
  /** 选中那张卡的星级（`null` = 没选）；与 `selectedWeaponId` 合起来才是完整选择。 */
  readonly selectedWeaponStar: number | null;
  readonly equipEnabled: boolean;
  readonly slots: readonly { readonly hardpointId: string; readonly defId: string; readonly name: string; readonly star: number; readonly category: string | null; readonly editable: boolean }[];
  readonly previewItems: readonly { readonly key: string; readonly defId: string; readonly visualId: string | null; readonly onWeaponSlot: boolean }[];
  readonly previewSpriteCount: number;
  readonly previewFallbackCount: number;
  readonly startRunHref: string | null;
  /**
   * PRODUCT-LOOP-R1-B｜本页**本局**的 token（幂等键）与它对应的冒险地址。
   * ⚠️ 每次挂载生成一次（= 一次新的「准备出发」）⇒ 同一 token 只可能领一次奖。
   */
  readonly runToken: string;
  readonly adventureHref: string;
  /**
   * 本次挂载是否处理了一次**领奖请求**（`null` = 玩家是正常打开首页，不是带着奖励回来的）。
   * ⚠️ 直接来自 Profile Repository 的**真实**结果 —— 页面不猜、不乐观提示。
   */
  readonly claim: {
    readonly ok: boolean;
    readonly reason: string | null;
    readonly defId: string | null;
    readonly name: string | null;
    readonly countAfter: number | null;
  } | null;
  /** 账本里已领取的局数（只读；用于 E2E 断言「重复领取没有新增记录」）。 */
  readonly claimedRunCount: number;
  readonly canvasCount: number;
  readonly buttonCount: number;
  readonly lastEquip: { readonly ok: boolean; readonly reason: EquipFailure | null } | null;
  /**
   * PRODUCT-LOOP-R2-B｜本次挂载**最后一次**合成动作的**真实**结果（`null` = 还没点过）。
   * ⚠️ 与 `lastEquip` 同一纪律：只陈述 `playerGrowth.fuseStack()` 的返回值，
   *    页面不做乐观提示、不在失败时假装成功。
   */
  readonly lastFuse: {
    readonly ok: boolean;
    readonly reason: string | null;
    readonly partId: string | null;
    readonly fromStar: number | null;
    readonly toStar: number | null;
    readonly countAfter: number | null;
    readonly productCount: number | null;
    readonly equippedUpgraded: boolean;
  } | null;
  readonly saveKey: string;
}

export interface ProductDebugHandle {
  probe(): ProductProbe;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** 把逻辑舞台缩放到容器（contain 语义：390×844 恒等比，只改 scale，不改布局口径）。 */
function fitStage(frame: HTMLElement, screen: HTMLElement): void {
  const s = Math.min(window.innerWidth / PRODUCT_STAGE_W, window.innerHeight / PRODUCT_STAGE_H);
  frame.style.width = `${PRODUCT_STAGE_W * s}px`;
  frame.style.height = `${PRODUCT_STAGE_H * s}px`;
  screen.style.transform = `scale(${s})`;
}

/**
 * 车辆预览（纯 DOM，零画布）：每个 item 一个绝对定位元素；
 * 有正式 sprite → `<img>`，无 → 按真实 Collider 外接框画灰盒并带 `data-ph-nosprite` 标注。
 *
 * 定位口径：元素以 `.ph-car` **盒心**为原点（`calc(50% + Δpx)`），Δ 由车体本地坐标 × `scale`
 * 得出（y 翻转：本地 y 向上、DOM y 向下）。盒子宽度与布局无关 ⇒ 不会被父级内边距挤偏。
 */
function renderPreview(layout: VehiclePreviewLayout): HTMLElement {
  const box = el('div', 'ph-car');
  box.dataset['phStageH'] = String(layout.stageH);
  box.style.height = `${layout.stageH}px`;
  const bx = (layout.minX + layout.maxX) / 2;
  const by = (layout.minY + layout.maxY) / 2;
  const ordered = [...layout.items].sort((a, b) => a.layer - b.layer);
  for (const it of ordered) {
    const url = it.visualId ? SPRITE_URLS[it.visualId] : undefined;
    const node = url ? el('img', 'ph-car-item') : el('div', 'ph-car-item ph-car-fallback');
    const w = it.w * layout.scale;
    const h = it.h * layout.scale;
    node.style.left = `calc(50% + ${(it.cx - bx) * layout.scale - w / 2}px)`;
    node.style.top = `calc(50% + ${-(it.cy - by) * layout.scale - h / 2}px)`;
    node.style.width = `${w}px`;
    node.style.height = `${h}px`;
    if (it.round) node.style.borderRadius = '50%';
    if (it.onWeaponSlot) node.classList.add('ph-car-weapon');
    node.dataset['phPreviewItem'] = it.key;
    node.dataset['phDefId'] = it.defId;
    if (url) {
      (node as HTMLImageElement).src = url;
      (node as HTMLImageElement).alt = it.name;
    } else {
      node.dataset['phNosprite'] = '1';
    }
    node.title = it.name;
    box.append(node);
  }
  return box;
}

/**
 * 页面唯一入口（由 `home.html` 用 `<script type="module">` 加载）。
 *
 * PRODUCT-LOOP-R1-B 起多一个**可选**入参 `opts.search`：玩家从 Run 的「领取并返回」
 * 带着 `?run=…&reward=…` 回到本页时，入口壳把 `location.search` **原样**传进来，
 * 由本模块的纯函数 `parsePendingClaim` 解析 —— 因此本模块**不读 `location`**
 * （保持可在 node 下单测、保持零跳转逻辑）。
 *
 * ⚠️ 领奖在**挂载时同步执行一次**（`claimRunReward`），结果只展示、不重试、不排队：
 *    重复进入同一个领奖 URL ⇒ Repository 返回 `already-claimed` ⇒ 页面如实说「已领取过」，
 *    库存**不会**再 +1（必改 4：重复点击 / 重复结算不允许重复发奖）。
 */
export function mountProductHome(
  root: HTMLElement,
  opts?: { readonly search?: string },
): ProductDebugHandle {
  // 唯一读入口：正式存档 → starter 回退（⚠️ 回退值不落盘，见 `loadEquippedDraft`）
  let draft: BuildDraft = loadEquippedDraft();
  /**
   * PRODUCT-LOOP-R2-A｜成长会话：**必须在任何库存落盘之前**开始。
   *
   * ⚠️ 严格的先后（已收进 `openGrowthSession` 内部，这里不可能写反）：
   *    ① 判 fresh 读的是**磁盘**（「既没有 Build 也没有库存记录」）；
   *    ② `ensureInventory()` **首次调用就会把 starter 库存落盘**。
   *    若这里先 `playerInventory(draft)` 再把结果传进去，① 永远为 false
   *    ⇒ 新账号种子（`cannon ×4`）**静默失效**，而现象与「一切正常」一模一样。
   */
  const growth: GrowthSession = openGrowthSession(draft);
  let inv: PartInventory = growth.inv;
  let view: ProductView = 'home';
  /**
   * 选中的那张**库存卡** = `(defId, star)` **一对**，而不是只有一个 defId。
   *
   * ⚠️ PRODUCT-LOOP-R2-B 起同一个 defId 可以有多个星级档（★1 的炮与 ★2 的炮是两张卡、
   *    两个 stack）⇒ 只记 defId，「点 ★2 那张」与「点 ★1 那张」就无法区分，
   *    而「装备」要装的正是玩家点的那一档。
   */
  let selected: { defId: string; star: number } | null = null;
  let lastEquip: { ok: boolean; reason: EquipFailure | null; detail: string } | null = null;
  /** 最近一次合成的**真实**结果（成功与失败同构地存下来，探针原样报出）。 */
  let lastFuse: {
    ok: boolean;
    reason: string | null;
    partId: string | null;
    fromStar: number | null;
    toStar: number | null;
    countAfter: number | null;
    productCount: number | null;
    equippedUpgraded: boolean;
    detail: string;
  } | null = null;
  // 本局 token：**每次挂载一次**（刷新首页 = 准备新的一局，因此会换一个新 token）
  const runToken = newRunToken();
  /**
   * PRODUCT-LOOP-R2-A｜本局 **3选1** 的候选读数 = **出发那一刻**的库存快照。
   *
   * ⚠️ 三件候选固定来自 `REWARD_CHOICE_IDS`（产品策略，`runReward.ts` 是唯一真源），
   *    数量读数来自**当前这份** `inv` ⇒ 与地址里 `choices` 载荷、与探针三者同源。
   * ⚠️ 必须每次重算（与 `adventureHrefNow` 绑在一起）：玩家可以「进车库 → 换武器 →
   *    回首页 → 直接点开始冒险」（**不刷新**），地址必须与屏幕上那辆车同一次读取产出。
   *    数量同理 —— 领奖后本页会重读库存（见下方 `claim` 段），旧快照会显示成没领到货。
   */
  const rewardSpecsNow = (): readonly RewardChoiceSpec[] =>
    growthStacks(inv, REWARD_CHOICE_IDS, GROWTH_STAR).map((s) => ({
      defId: s.partId,
      star: s.star,
      countBefore: s.count,
    }));
  /**
   * 「开始冒险」的地址 = **当前这一份** `draft` + **当前库存读数**的实时投影。
   *
   * ⚠️ 必须是函数而不是挂载时算一次的常量：首页与「调整战车」是同一页面的两个视图，
   *    玩家可以「进车库 → 换武器 → 回首页 → 直接点开始冒险」（**不刷新**）。
   *    若沿用挂载时的旧地址，首页会显示新武器、而链接带的是旧装备 / 旧数量
   *    ⇒ 正是 Queue 必改 2 禁止的「首页显示 A，战斗实际跑 B」。
   *    ⇒ 每次 `render()` 都重算，地址与屏幕上显示的那辆车**同一次读取**产出。
   */
  const adventureHrefNow = (): string =>
    buildAdventureHref(
      runToken,
      // 满 stack 阈值也由产品侧给（真源 = `playerGrowth.FUSE_STACK`），Lab 侧不自造这个数字
      buildRewardChoicePayload(runToken, rewardSpecsNow(), FUSE_STACK),
      draft,
    );
  // 领奖请求：入口壳给的 `location.search` 原样解析（纯函数）→ **当场**交给 Repository 处理一次
  const pendingClaim: PendingClaim | null = parsePendingClaim(opts?.search ?? '');
  const claim: ClaimOutcome | null = pendingClaim ? claimRunReward(pendingClaim) : null;
  /**
   * ⚠️ PRODUCT-LOOP-R1-C｜**领奖之后必须重读局外状态**。
   *
   * 上面的 `draft` / `inv` 是在**领奖之前**读的；而领奖会往正式库存里写入新部件
   * （`playerProfile.claimRunReward` → `partInventory.addPart`）。若不重读，本次挂载
   * 手里的库存就是**领奖前的旧快照** ⇒ 玩家从 COMPLETE 点「领取并返回」落回本页后，
   * 「调整战车」里**看不到刚拿到的那件部件**，必须先手动刷新一次才行
   * —— 那正是 Queue 必改 4 要求打通的「领取 → 首页 → Garage 新奖励可见 → 装备」链路，
   * 所以这里不是优化而是**主循环阻断缺陷**的修复。
   *
   * 重读走的是同两个正式入口（`loadEquippedDraft` / `playerInventory`），**不新增数据源**；
   * `ensureInventory` 幂等 ⇒ 没有领到新部件时（`already-claimed` / 校验失败）重读是无副作用的空操作。
   */
  if (claim) {
    draft = loadEquippedDraft();
    inv = playerInventory(draft);
  }

  /* -------------------------------------------------------------- 骨架 */

  const frame = el('div', 'ph-frame');
  const screen = el('div', 'ph-screen');
  screen.dataset['phScreen'] = '1';
  frame.append(screen);

  const header = el('header', 'ph-header');
  const stage = el('section', 'ph-main');
  screen.append(header, stage);

  root.append(frame);
  fitStage(frame, screen);
  window.addEventListener('resize', () => fitStage(frame, screen));

  /* ------------------------------------------------------------- 渲染 */

  function read(): LoadoutReading {
    return loadoutReading(draft, inv);
  }

  /**
   * PRODUCT-LOOP-R1-B｜领奖提示（**只陈述 Repository 的真实结果**）。
   *
   *   - 成功 → 「已获得：<正式部件名>（已进入车库）」，带 `data-ph-claim-def` 供 E2E 对账；
   *   - 重复 → 如实说「已领取过，不会重复发放」（不是静默忽略，也不是假装成功）；
   *   - 失败 → 带上 Repository 给出的**具体原因**（`not-weapon` / `not-equippable` / …）。
   */
  function claimNotice(): HTMLElement | null {
    if (!claim) return null;
    if (claim.ok && claim.grant) {
      const n = el('div', 'ph-claim ph-claim-ok', `${CLAIM_OK_LEAD}：${claim.grant.name}（已进入车库）`);
      n.dataset['phClaim'] = 'ok';
      n.dataset['phClaimDef'] = claim.grant.defId;
      return n;
    }
    if (claim.reason === 'already-claimed') {
      const n = el('div', 'ph-claim ph-claim-dim', CLAIM_DUPLICATE_TEXT);
      n.dataset['phClaim'] = 'duplicate';
      return n;
    }
    const n = el('div', 'ph-claim ph-claim-bad', `${CLAIM_FAIL_TEXT}（${String(claim.reason)}）`);
    n.dataset['phClaim'] = 'fail';
    return n;
  }

  /** 页头（两个视图共用）：标题 + 领奖提示（有才有）。 */
  function renderHeader(title: string): void {
    header.replaceChildren(el('h1', 'ph-title', title));
    const notice = claimNotice();
    if (notice) header.append(notice);
  }

  function renderHome(r: LoadoutReading): void {
    renderHeader(HOME_TITLE);

    const car = el('div', 'ph-car-wrap');
    car.append(renderPreview(vehiclePreviewLayout(draft)));
    const spec = el('div', 'ph-spec');
    spec.append(
      el('span', 'ph-body', r.bodyName),
      el('span', 'ph-stat', `耐久 ${r.hp}`),
      el('span', 'ph-stat', `能量 ${r.energy}/${r.energyCapacity}`),
    );
    car.append(spec);
    stage.append(car);

    stage.append(el('h2', 'ph-sec', '已装备部件'));
    const list = el('ul', 'ph-slots');
    for (const s of r.slots) {
      const li = el('li', 'ph-slot');
      if (s.hardpointId === WEAPON_SLOT) li.classList.add('ph-slot-weapon');
      li.dataset['phSlot'] = s.hardpointId;
      li.dataset['phSlotDef'] = s.defId;
      li.dataset['phSlotStar'] = String(s.star);
      const cat = s.category === 'weapon' ? '武器' : s.category === 'gadget' ? '辅助' : '';
      /**
       * PRODUCT-LOOP-R2-B｜星级**由数据驱动**地画出来（`s.star` 来自 Build 的
       * `functionalStars`）。⚠️ 刻意**不写** `star === 1 ? '★' : '★★'` 这类按档位分支的
       * 写法：合成会把装备升到 ★2..★5，任何「只有 1★ / 2★ 两种形态」的硬编码
       * 从 ★3 起就会静默画错（Queue 必改 4）。
       */
      li.append(
        el('span', 'ph-slot-label', s.label),
        el('span', 'ph-slot-name', cat ? `${s.name} ★${s.star}（${cat}）` : `${s.name} ★${s.star}`),
      );
      if (s.hardpointId === WEAPON_SLOT) li.append(el('span', 'ph-slot-tag', '主武器'));
      list.append(li);
    }
    stage.append(list);

    const actions = el('div', 'ph-actions');
    const toGarage = el('button', 'ph-btn ph-btn-primary', HOME_GARAGE_LABEL);
    toGarage.type = 'button';
    toGarage.dataset['phAction'] = 'open-garage';
    toGarage.addEventListener('click', () => {
      view = 'garage';
      selected = null;
      render();
    });
    // `开始冒险` 是同产物内的真实相对链接；地址由 `runReward.buildAdventureHref()` 产出
    // （带本局 token / 奖励 id / **当前这份装备** / 回程地址）—— 「打完一局 → 领奖 → 回首页」
    // 与「车库换装 → 下一局就用新装备」都靠同一个地址。
    const start = el('a', 'ph-btn ph-btn-start', HOME_START_LABEL);
    start.href = adventureHrefNow();
    start.dataset['phAction'] = 'start-run';
    start.dataset['phRunToken'] = runToken;
    actions.append(toGarage, start);
    stage.append(actions);

    stage.append(
      el(
        'p',
        'ph-note',
        '首页显示的主武器 = 下一局战斗里实际使用的装备（同一份正式玩家 Build 存档，随「开始冒险」交给 Run）。',
      ),
    );
    stage.append(
      el(
        'p',
        'ph-note',
        '打完一局（RUN COMPLETE）会获得一个三选一的机会：选中哪件就带哪件回家；领回来后在「调整战车」里就能看到并装上。',
      ),
    );
    stage.append(
      el('p', 'ph-note', '同一件部件可以累积数量（例如炮 4/5 → 5/5）。'),
    );
    stage.append(
      el(
        'p',
        'ph-note',
        '凑满 5 件后在「调整战车」里可以合成下一星级：5 件 ★1 → 1 件 ★2。' +
          '星级越高占的能量越多；★5 是目前的上限，到了就不能再合。',
      ),
    );
  }

  function renderGarage(r: LoadoutReading): void {
    renderHeader(GARAGE_TITLE);
    header.append(el('span', 'ph-sub', `${r.weaponSlotLabel} · 当前主武器`));

    const car = el('div', 'ph-car-wrap ph-car-wrap-sm');
    car.append(renderPreview(vehiclePreviewLayout(draft)));
    stage.append(car);

    const cur = el('div', 'ph-current');
    cur.dataset['phCurrent'] = r.equippedWeaponId;
    cur.append(
      el('span', 'ph-current-label', '当前 Weapon'),
      el('span', 'ph-current-name', r.equippedWeaponName),
    );
    stage.append(cur);

    stage.append(el('h2', 'ph-sec', `拥有的 Weapon（${r.weapons.length}）`));
    if (r.weapons.length === 0) {
      stage.append(el('p', 'ph-note', '库存里没有可装备的武器。'));
    }
    const grid = el('div', 'ph-grid');
    for (const w of r.weapons) {
      const equippedHere = w.defId === r.equippedWeaponId && w.star === r.equippedWeaponStar;
      /**
       * ⚠️ 卡片是 `<button>`，而「合成」也是一个按钮 ⇒ **不能嵌套**（HTML 不允许
       *    button 里套 button）。因此合成按钮是卡片的**兄弟节点**，两者共同放在
       *    `.ph-card-cell` 里（合成按钮绝对定位在右上角，视觉上仍在卡内）。
       */
      const cell = el('div', 'ph-card-cell');
      const card = el('button', 'ph-card');
      card.type = 'button';
      card.dataset['phWeapon'] = w.defId;
      card.dataset['phStar'] = String(w.star);
      card.dataset['phEquipped'] = String(equippedHere);
      /**
       * PRODUCT-LOOP-R2-B｜Weapon 卡的**名称 / 星级 / 数量 / 5**（Queue 必改 3）。
       *
       *   - 每张卡 = 一个 `(defId, star)` stack（★1 的炮与 ★2 的炮是**两张**卡）；
       *   - `★{star}` 与 `{stackText}`（`4/5`）都直接来自 `playerLoadout.weaponEntries()`
       *     （唯一数据源）⇒ 卡片文案与探针读数不可能分叉；
       *   - 星级是**数据驱动**的纯数字：没有 `1★ / 2★` 的硬编码分支（必改 4），
       *     结构上支持 ★1..★5（`INVENTORY_MAX_STAR`）；
       *   - `fusable`（满 5 件且未到上限）→ 显示 `可合成` 徽标 + 右上角「合成」按钮；
       *     到 ★5 → 显示 `已满星`，**没有**合成入口（必改 3 / 验收 7）。
       */
      if (equippedHere) card.classList.add('ph-card-equipped');
      if (selected && selected.defId === w.defId && selected.star === w.star) {
        card.classList.add('ph-card-selected');
      }
      card.dataset['phCount'] = String(w.count);
      card.dataset['phStackText'] = w.stackText;
      card.dataset['phStackThreshold'] = String(w.threshold);
      card.dataset['phFusable'] = String(w.fusable);
      card.dataset['phMaxStar'] = String(w.maxStar);
      card.dataset['phDamage'] = String(w.damage);
      card.dataset['phDamageNext'] = w.damageNext === null ? '' : String(w.damageNext);
      card.dataset['phDamageText'] = w.damageText;
      if (w.reachesThreshold) card.classList.add('ph-card-full');
      card.append(
        el('span', 'ph-card-name', `${w.name} ★${w.star}`),
        /**
         * PRODUCT-LOOP-R2-C（Queue 必改 4）｜**最终主属性**：升星到底换来什么。
         *
         * `攻击 80 → 100` = 这一档一次命中扣多少血 → 升一星后扣多少血。
         * 数字来自 `playerLoadout.weaponEntries()`（`starTierDamage` + `weaponMainDamage`），
         * 与战斗里真实结算的伤害**同一次计算** ⇒ 卡片不会承诺一个打不出来的数。
         * 只有这一行，不加属性面板（Queue 明令）。
         * ⚠️ `damageText === ''`（该武器的伤害不在星级层的作用面上）= **不画这一行**，
         *    而不是画一个 `攻击 0`。
         */
        ...(w.damageText === '' ? [] : [el('span', 'ph-card-damage', w.damageText)]),
        el('span', 'ph-card-meta', `能量 ${w.energyInUse} · ${w.stackText}`),
      );
      if (w.fusable) card.append(el('span', 'ph-card-badge', GARAGE_FUSE_READY_LABEL));
      if (w.maxStar) card.append(el('span', 'ph-card-badge ph-card-badge-max', GARAGE_MAX_STAR_LABEL));
      if (equippedHere) card.append(el('span', 'ph-card-tag', '已装备'));
      card.addEventListener('click', () => {
        selected = { defId: w.defId, star: w.star };
        render();
      });
      cell.append(card);

      if (w.fusable) {
        // 第一版唯一的合成入口：点一次 = **执行一次** 5 合 1（必改 5：不连锁、不批量）
        const fuse = el('button', 'ph-card-fuse', GARAGE_FUSE_LABEL);
        fuse.type = 'button';
        fuse.dataset['phAction'] = 'fuse';
        fuse.dataset['phFuseDef'] = w.defId;
        fuse.dataset['phFuseStar'] = String(w.star);
        fuse.addEventListener('click', () => {
          const res: FusionResult = fuseStack(inv, w.defId, w.star, draft);
          lastFuse = res.ok
            ? {
                ok: true,
                reason: null,
                partId: res.partId,
                fromStar: res.fromStar,
                toStar: res.toStar,
                countAfter: res.countAfter,
                productCount: res.productCount,
                equippedUpgraded: res.equippedUpgraded,
                detail: '',
              }
            : {
                ok: false,
                reason: res.reason,
                partId: w.defId,
                fromStar: w.star,
                toStar: null,
                countAfter: null,
                productCount: null,
                equippedUpgraded: false,
                detail: res.detail,
              };
          if (res.ok) {
            // 合成**改变了两份正式存档**：库存（消耗+产出）与 Build（可能自动升星装备）
            // ⇒ 手里这两份都要换成落盘后的那一份，页面读的才是真实状态。
            inv = res.inventory;
            draft = res.draft;
          }
          selected = null;
          render();
        });
        cell.append(fuse);
      }
      grid.append(cell);
    }
    stage.append(grid);

    const actions = el('div', 'ph-actions');
    const equip = el('button', 'ph-btn ph-btn-primary', GARAGE_EQUIP_LABEL);
    equip.type = 'button';
    equip.dataset['phAction'] = 'equip';
    equip.disabled = selected === null;
    equip.addEventListener('click', () => {
      if (selected === null) return;
      // 装备的是**玩家点的那一档**（`selected.star`），不是 defId 的默认档
      const out = equipWeapon(selected.defId, draft, inv, selected.star);
      lastEquip = { ok: out.ok, reason: out.reason ?? null, detail: out.detail ?? '' };
      if (out.ok && out.draft) {
        draft = out.draft;
        // 库存不因装备而消耗；重读仍走正式 ensureInventory（幂等 → 不重复生成库存）
        inv = playerInventory(draft);
      }
      selected = null;
      render();
    });

    const back = el('button', 'ph-btn', GARAGE_BACK_LABEL);
    back.type = 'button';
    back.dataset['phAction'] = 'back-home';
    back.addEventListener('click', () => {
      view = 'home';
      selected = null;
      render();
    });
    actions.append(equip, back);
    stage.append(actions);

    if (lastFuse) {
      const msg = el(
        'p',
        lastFuse.ok ? 'ph-note ph-note-ok' : 'ph-note ph-note-bad',
        lastFuse.ok
          ? `合成完成：5 件 ★${String(lastFuse.fromStar)} → 1 件 ★${String(lastFuse.toStar)}` +
            (lastFuse.equippedUpgraded ? '（正在装备的那件已自动升到新星级）' : '') +
            '。'
          : `合成被拒绝（${String(lastFuse.reason)}）：${lastFuse.detail}`,
      );
      msg.dataset['phFuseMsg'] = lastFuse.ok ? 'ok' : 'fail';
      stage.append(msg);
    }

    if (lastEquip) {
      const msg = el(
        'p',
        lastEquip.ok ? 'ph-note ph-note-ok' : 'ph-note ph-note-bad',
        lastEquip.ok ? '已装备并写入正式玩家 Build 存档。' : `装备被拒绝（${lastEquip.reason}）：${lastEquip.detail}`,
      );
      msg.dataset['phEquipMsg'] = lastEquip.ok ? 'ok' : 'fail';
      stage.append(msg);
    }
  }

  function render(): void {
    screen.dataset['phView'] = view;
    stage.replaceChildren();
    const r = read();
    if (view === 'home') renderHome(r);
    else renderGarage(r);
  }

  render();

  /* -------------------------------------------------------------- 句柄 */

  const handle: ProductDebugHandle = {
    probe: () => {
      const r = read();
      const layout = vehiclePreviewLayout(draft);
      const start = stage.querySelector<HTMLAnchorElement>('[data-ph-action="start-run"]');
      const equipBtn = stage.querySelector<HTMLButtonElement>('[data-ph-action="equip"]');
      return {
        view,
        bodyName: r.bodyName,
        hp: r.hp,
        energy: r.energy,
        energyCapacity: r.energyCapacity,
        weaponSlot: r.weaponSlot,
        equippedWeaponId: r.equippedWeaponId,
        equippedWeaponName: r.equippedWeaponName,
        /**
         * PRODUCT-LOOP-R2-B｜装备的**星级**（与 `equippedWeaponId` 合起来才是完整的「装备」）。
         * ⚠️ 取 `loadoutReading()` 的同一份读数（页面禁止自行推导，见本模块顶部职责边界）。
         */
        equippedWeaponStar: r.equippedWeaponStar,
        weaponIds: r.weapons.map((w) => w.defId),
        weaponNames: r.weapons.map((w) => w.name),
        /**
         * PRODUCT-LOOP-R2-A / R2-B｜成长读数（与 Garage 卡片上画的**是同一批字段**）。
         * ⚠️ 直接取 `r.weapons`（= `playerLoadout.weaponEntries()`）而不是另算一份：
         *    探针与屏幕同源 ⇒ 「写着 4/5」与「探针说 count=4」不可能分叉。
         * ⚠️ 同一个 `defId` 可能出现多条（★1 / ★2 是两个 stack）⇒ 定位某条读数必须
         *    **同时**带 `star`。
         */
        weapons: r.weapons.map((w) => ({
          defId: w.defId,
          name: w.name,
          star: w.star,
          count: w.count,
          threshold: w.threshold,
          stackText: w.stackText,
          reachesThreshold: w.reachesThreshold,
          energyInUse: w.energyInUse,
          fusable: w.fusable,
          maxStar: w.maxStar,
          damage: w.damage,
          damageNext: w.damageNext,
          damageText: w.damageText,
        })),
        /** 与 `开始冒险` 地址里 `choices` 载荷**同源**（同一次 `rewardSpecsNow()` 读取）。 */
        rewardChoices: rewardSpecsNow(),
        growth: {
          fresh: growth.freshProfile,
          seeded: growth.seeded,
          repairedEquipped: growth.repairedEquipped,
          stackThreshold: FUSE_STACK,
        },
        selectedWeaponId: selected ? selected.defId : null,
        selectedWeaponStar: selected ? selected.star : null,
        equipEnabled: !!equipBtn && !equipBtn.disabled,
        slots: r.slots.map((s) => ({
          hardpointId: s.hardpointId,
          defId: s.defId,
          name: s.name,
          star: s.star,
          category: s.category,
          editable: s.editable,
        })),
        previewItems: layout.items.map((i) => ({
          key: i.key,
          defId: i.defId,
          visualId: i.visualId,
          onWeaponSlot: i.onWeaponSlot,
        })),
        previewSpriteCount: layout.items.filter((i) => !!i.visualId && !!SPRITE_URLS[i.visualId]).length,
        previewFallbackCount: layout.items.filter((i) => !i.visualId || !SPRITE_URLS[i.visualId]).length,
        startRunHref: start ? start.getAttribute('href') : null,
        runToken,
        adventureHref: adventureHrefNow(),
        claim: claim
          ? {
              ok: claim.ok,
              reason: claim.reason,
              defId: claim.grant?.defId ?? null,
              name: claim.grant?.name ?? null,
              countAfter: claim.grant?.countAfter ?? null,
            }
          : null,
        claimedRunCount: claimedRunCount(),
        canvasCount: root.querySelectorAll('canvas').length,
        buttonCount: root.querySelectorAll('button').length,
        lastEquip: lastEquip ? { ok: lastEquip.ok, reason: lastEquip.reason } : null,
        lastFuse: lastFuse
          ? {
              ok: lastFuse.ok,
              reason: lastFuse.reason,
              partId: lastFuse.partId,
              fromStar: lastFuse.fromStar,
              toStar: lastFuse.toStar,
              countAfter: lastFuse.countAfter,
              productCount: lastFuse.productCount,
              equippedUpgraded: lastFuse.equippedUpgraded,
            }
          : null,
        saveKey: SAVE_KEY,
      };
    },
  };
  (globalThis as { __PRODUCTHOME__?: ProductDebugHandle }).__PRODUCTHOME__ = handle;

  return handle;
}

/* -------------------------------------------------------- 挂载（在入口壳） */

/**
 * ⚠️ 本模块**不自挂载**：与 `runPage.ts` / `runMain.ts` 同一分工 ——
 * 页面逻辑保持「可在 node 下 import（无模块级 DOM）」以便直接单测，
 * 真正的挂载在入口壳 `homeMain.ts`（由 `home.html` 加载）。
 * 唯一入口 = `mountProductHome(root)`（上方已导出）。
 */
