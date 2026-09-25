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
 *   - **本页自身零写盘调用**：写只发生在 `equipWeapon()` 内部，以及 `loadEquippedDraft()`
 *     内那一次**旧 starter profile 迁移**（PRODUCT-LOOP-P0，见 `migrateLegacyStarterProfile`：
 *     归一化性质的**一次为限**落盘，不是玩家动作）；两者都含 `validateSnapshot` 与 `savePlayerBuild`；
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
import { EMPTY_SLOT } from '../lab/buildEditorModel';
import type { PartInventory } from '../core/partInventory';
import {
  WEAPON_SLOT,
  equipMovement,
  equipWeapon,
  loadEquippedDraft,
  loadoutReading,
  movementReading,
  playerInventory,
  type EquipFailure,
  type LoadoutReading,
  type MovementEquipFailure,
  type MovementReading,
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
// PRODUCT-LOOP-P0-RUN-BUILD-LOADOUT-COMPATIBILITY｜「开始冒险」的资格判断（产品层唯一一处）。
// ⚠️ 页面**禁止**自己判断「这件武器支不支持完整 Run」（Queue 必改 1：不要在 UI 里靠字符串判断）
//    —— 判据来自本模块对真实 `BuildDraft` 的读取，页面只负责按读数渲染。
import { fullRunCompat, type FullRunCompat } from './runCompatibility';

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
 * PRODUCT-LOOP-R2-B｜合成动作的文案。
 *   - `可合成`：满 5 件且未到星级上限时**明确**显示的状态词（不是隐晦的进度数字）；
 *   - `合成升星`：第一版唯一的合成入口按钮 —— 点一次执行**一次** 5 合 1（必改 5：不连锁）。
 *     ⚠️ PRODUCT-LOOP-R2-RECOVERY（必改 4）把按钮从 `合成` 改成 `合成升星`：Queue 要求
 *        「必须出现明确主按钮：合成升星」，且明令「不能要求玩家猜卡片可点 / 看页面底部教程」。
 *   - `已满星`：★5 的卡不再有合成入口（Queue：「5★为当前最高星级，不可继续合成」）。
 */
export const GARAGE_FUSE_LABEL = '合成升星';
export const GARAGE_FUSE_READY_LABEL = '可合成';
export const GARAGE_MAX_STAR_LABEL = '已满星';
/**
 * PRODUCT-LOOP-R2-RECOVERY-ONBOARDING-CLARITY（必改 4）｜**成长信息必须是卡片主体**。
 *
 * 真人反馈 ④：页面底部虽然有合成说明，但真人**完全找不到** `4/5` / `5/5` / 可合成的
 * 真实成长过程 —— 因为成长信息当时只是卡片 meta 行尾的一小段（`能量 30 · 4/5`）。
 * ⇒ 本 Queue 把它提升成卡片上的**独立主信息行**：`成长 4/5`；离满还差 1 件时再补一行
 * 「还差 1 个即可升星」。两行文案都是常量（页面里不出现第二份字面量）。
 */
export const GARAGE_GROWTH_LABEL = '成长';
export const GARAGE_NEAR_FULL_LABEL = '还差 1 个即可升星';
/**
 * 首页那一行最小成长状态的收尾词（Queue 必改 5：达到 5/5 时显示「可升星」）。
 * ⚠️ 与 Garage 的 `可合成` 刻意**不是**同一个词：首页只回答「你现在能不能升级」，
 *    真正的动作词（`合成升星`）只出现在真正能点它的那张卡上。
 */
export const HOME_GROWTH_READY_LABEL = '可升星';
/**
 * PRODUCT-LOOP-R2-RECOVERY（必改 6）｜领奖之后、且这件刚好凑满时的**下一步引导**。
 *
 * Queue 原文：领取 Cannon 后返回首页，如果已达 5/5 → 首页显示「加农炮可升星」，
 * 然后玩家点「调整战车」进入 Garage。⚠️ **禁止自动替玩家合成** —— 这里只提示 + 指向
 * 那个既有入口，成长动作必须由玩家自己在 Garage 里按下（本页不新增任何自动动作）。
 */
export const CLAIM_UPGRADABLE_HINT = '已可升星 → 点「调整战车」合成';
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

/**
 * PRODUCT-LOOP-R3-MOVEMENT-GARAGE-EQUIP｜Movement 配置区的文案。
 *
 * ⚠️ 全部是常量（页面里不出现第二份字面量）—— 与 Weapon 区那批同一条纪律。
 */
export const GARAGE_MOVEMENT_SECTION_LABEL = '轮组（Movement）';
/** 每个挂点的选择按钮文案（点了只是「选中」，真正的写入在 `装备` 那一下）。 */
export const GARAGE_MOVEMENT_PICK_LABEL = '选择';
/** 选中的那一个的标记（与 Weapon 卡的 `已装备` 刻意分开：这两个词是两件事）。 */
export const GARAGE_MOVEMENT_PICKED_LABEL = '已选择';
/** 当前生效的那一个（= 正式 Snapshot 里真的装上的）。 */
export const GARAGE_MOVEMENT_EQUIPPED_LABEL = '使用中';
/** 需要库存但玩家没拥有 ⇒ 如实标注（**不**提供解锁 / 购买 / 进度）。 */
export const GARAGE_MOVEMENT_LOCKED_LABEL = '未拥有';
/** 该挂点当前**明确卸下**（`'none'`，与「缺省轮」不同）。 */
export const GARAGE_MOVEMENT_OFF_LABEL = '未装载';
/** 缺省轮在卡片上的说明（它不进库存，但恒可装备）。 */
export const GARAGE_MOVEMENT_DEFAULT_LABEL = '默认';
/**
 * PRODUCT-LOOP-R3-MOVEMENT-PRODUCT-LOOP-SURFACE｜首页「当前轮组」摘要。
 *
 * Queue 必改 1 的**判定**：Garage 的 `renderMovementSection()` 已经足够清楚地展示
 * 当前 rear / front（分行 + 逐卡「使用中」）⇒ **不再为 Garage 增加第二套 UI**。
 * 缺的是**首页**：`loadoutReading().slots` 只映射 `body.functionalHardpoints`，
 * Movement 一个都不在 ⇒ 玩家在首页看不到自己车上装的是什么轮子。
 * 这里只补首页这一处，且**沿用 Garage 已有词汇**（后轮 / 前轮 / 未装载），
 * 不引入第二套说法。
 */
export const HOME_MOVEMENT_SECTION_LABEL = '当前轮组';
/** 挂点显示名（与 Garage 的 `renderMovementSection` 逐字一致，同一套词）。 */
export const MOVEMENT_HARDPOINT_LABELS: Readonly<Record<string, string>> = {
  rear: '后轮',
  front: '前轮',
};
/**
 * Movement 装备动作的结果文案。
 * ⚠️ 与 Weapon 侧**刻意用不同的词**：两套动作写的是两个不同的正式字段
 * （`rearWheelDefId` / `frontWheelDefId` vs `functionalSelections[frontMass]`），
 * 提示里混用会让玩家以为「装轮组」和「换武器」是同一件事。
 */
export const GARAGE_MOVEMENT_EQUIP_PLACEHOLDER = '轮组';

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
    /**
     * PRODUCT-LOOP-R2-RECOVERY（必改 1）｜一次性 R2 onboarding 迁移的读数（判定结果原样报出）。
     *   - `onboardingApplied === true` ⇒ 这一次真的把历史 Profile 补到了起点；
     *   - `onboardingReason === 'already-marked'` ⇒ 曾经执行过（reload 后的形态）。
     */
    readonly onboardingApplied: boolean;
    readonly onboardingReason: string;
    readonly onboardingRaised: number;
    readonly onboardingCannon: number;
    /**
     * PRODUCT-LOOP-R2-VALIDATION-STATE-RESEED-R1｜本次挂载的**版本化一次性 reseed** 读数。
     *
     * ⚠️ 与 onboarding 那四个字段**并列但不混同**（两份 key / 两个版本）：
     *   - `reseedApplied === true` ⇒ 这一次真的把「上一轮验证已消费的起点」恢复成
     *     `cannon ★1 = 4/5` + 装备 ★1（`reseedCleared` = 清掉的 ★≥2 件数）；
     *   - `reseedReason === 'already-marked'` ⇒ 曾经执行过（reload 后的形态，库存不再被改）；
     *   - `'not-consumed'` / `'start-intact'` / `'not-prototype'` / `'equip-failed'`
     *     ⇒ **一个字节都没动**（各自的原因见 `r2Reseed` 的 reason 说明）。
     */
    readonly reseedApplied: boolean;
    readonly reseedReason: string;
    readonly reseedCleared: number;
    readonly reseedCannon: number;
    /**
     * PRODUCT-LOOP-R3-MOVEMENT-PERSISTENT-INVENTORY｜本次挂载的 **Movement 拥有读数**。
     *
     * ⚠️ 直接来自 `playerGrowth.openGrowthSession()` 的 `movementGrants` / `movements`
     *    （页面与探针**不各自再判一次**）⇒ 「屏幕上 / 探针里说拥有」与「库存里真的有几件」
     *    不可能分叉。
     *   - `movementRepaired` = 本次为「装着却不拥有」的 Movement 补的件（空数组 = 一个字节都没动）；
     *   - `movementLegal` = 「每一条装着的 Movement 都合法拥有」这条不变式（补件后恒为 `true`）；
     *   - `movements` = 全部正式 Movement 的 owned / equipped / persisted 逐条读数
     *     （**含**不进库存的缺省轮：它是 `implicit: true` 而不是「查无此件」）。
     */
    readonly movementRepaired: readonly string[];
    readonly movementLegal: boolean;
    readonly movements: readonly {
      readonly defId: string;
      readonly name: string;
      readonly kind: string;
      readonly needsInventory: boolean;
      readonly count: number;
      readonly owned: boolean;
      readonly implicit: boolean;
      readonly equipped: boolean;
      readonly hardpoints: readonly string[];
    }[];
  };
  /**
   * PRODUCT-LOOP-R2-RECOVERY（必改 5）｜首页那一行最小成长状态的真实读数
   * （`null` = 没画这一行：空槽 / 查无此 stack）。与页面上那几个 `data-ph-home-growth-*` 同源。
   */
  readonly homeGrowth: {
    readonly defId: string;
    readonly name: string;
    readonly star: number;
    readonly count: number;
    readonly threshold: number;
    readonly stackText: string;
    readonly ready: boolean;
  } | null;
  /**
   * PRODUCT-LOOP-R2-RECOVERY（必改 6）｜领奖提示里是否出现了「已可升星」引导
   * （只在**领到的这件刚好凑满**时为 true；不是「页面某处出现过这几个字」）。
   */
  readonly claimUpgradableHint: boolean;
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
  /**
   * PRODUCT-LOOP-R3-MOVEMENT-GARAGE-EQUIP｜**Movement 维度的全量读数**
   * （直接来自 `playerLoadout.movementReading()`，页面画的**就是这些字段**）。
   *
   * ⚠️ 与 Weapon 区同一条纪律：探针不另算一份 ⇒「屏幕上写着某轮组在用」与
   *    「探针说 `equippedDefIds` 含它」不可能分叉。
   *   - `slots[]` —— 逐**挂点**（rear / front）的三态读数：
   *       `storedDefId: null` = 存档里没有这个键（= 缺省轮在跑，**不是**空）；
   *       `'none'` = 明确卸下；其它 = 正式 defId。
   *     `unmounted` 只在 `'none'` 时为真（这两件事在物理上不同）。
   *   - `cards[]` —— 逐件 canonical Movement 的 owned / implicit / equipped 读数；
   *   - `available[]` —— **可装备**的 defId（= `owned === true` 的那些）
   *     ⇒ Queue「只允许装备真实 owned / implicit canonical Movement」的可断言形式。
   */
  readonly movement: {
    readonly slots: readonly {
      readonly hardpointId: string;
      readonly storedDefId: string | null;
      readonly effectiveDefId: string | null;
      readonly name: string;
      readonly unmounted: boolean;
    }[];
    readonly cards: readonly {
      readonly defId: string;
      readonly name: string;
      readonly kind: string;
      /**
       * PRODUCT-LOOP-R3-MOVEMENT-CARD-READABILITY｜卡片上那一行刻度的**三个真实数值**
       * + 成品文案。全部现读自 canonical Movement Def（页面不自行推导）。
       */
      readonly radius: number;
      readonly mass: number;
      readonly energy: number;
      readonly statsText: string;
      readonly needsInventory: boolean;
      readonly count: number;
      readonly owned: boolean;
      readonly implicit: boolean;
      readonly hardpoints: readonly string[];
    }[];
    readonly available: readonly string[];
    readonly ownedDefIds: readonly string[];
    readonly equippedDefIds: readonly string[];
    readonly legal: boolean;
    readonly defaultDefId: string;
  };
  /**
   * ⚠️ PRODUCT-LOOP-R3-MOVEMENT-DIRECT-EQUIP｜Movement 区**没有**二次确认：
   *    点已拥有卡即直接装备（rear 卡装 rear、front 卡装 front），不再有「选中态」、
   *    也不再有任何独立的「装备」按钮。`selectedMovement` / `movementEquipEnabled`
   *    这两个探针字段已在本次删除（见本文件 git 历史）。
   */
  /** 本次挂载**最后一次** Movement 装备动作的**真实**结果（`null` = 还没点过）。 */
  readonly lastMovementEquip: { readonly ok: boolean; readonly reason: MovementEquipFailure | null } | null;
  readonly slots: readonly { readonly hardpointId: string; readonly defId: string; readonly name: string; readonly star: number; readonly category: string | null; readonly editable: boolean }[];
  readonly previewItems: readonly { readonly key: string; readonly defId: string; readonly visualId: string | null; readonly onWeaponSlot: boolean }[];
  readonly previewSpriteCount: number;
  readonly previewFallbackCount: number;
  readonly startRunHref: string | null;
  /**
   * PRODUCT-LOOP-P0｜「开始冒险」当前是否**不可执行**（Queue 必改 2 / 必改 3）。
   *
   * ⚠️ 与 `startRunHref` 合起来读才是完整事实：
   *   - 可执行：`startRunBlocked === false` 且 `startRunHref` 是一条真实地址；
   *   - 不可执行：`startRunBlocked === true` 且 **`startRunHref === null`**
   *     （没有链接 = 结构上无法创建 Run，而不是「链接在但点了没用」）。
   */
  readonly startRunBlocked: boolean;
  /**
   * PRODUCT-LOOP-P0｜完整 Run 资格读数（= `fullRunCompat(draft)` 原样）。
   * ⚠️ 页面与探针取**同一次读取**，卡片上的提示文案也来自它 ⇒ 三者不可能分叉。
   */
  readonly runCompat: {
    readonly ok: boolean;
    readonly reason: string;
    readonly equippedWeaponIds: readonly string[];
    readonly supportedWeaponIds: readonly string[];
    readonly notice: string | null;
    readonly hint: string | null;
  };
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

/**
 * PRODUCT-LOOP-P0｜不支持完整 Run 时的**最小明确反馈**（Queue 必改 2）。
 *
 * Queue 逐字要求两句：「当前原型仅支持加农炮进行完整冒险」+「请先调整战车」，
 * 并明写「**不要做复杂弹窗**」⇒ 这里就是一个内联的普通块，紧贴在 `[调整战车]` 按钮上方。
 *
 * ⚠️ 文案**只来自** `runCompatibility`（`compat.notice` / `compat.hint`），
 *    页面里不出现第二份字面量 ⇒ 改口径只改一处。
 * ⚠️ 刻意**不在**这里再放一个「调整战车」按钮：入口是 `actions` 里那个既有的
 *    `toGarage`（`data-ph-action="open-garage"`）。多一个同功能按钮会带来第二个
 *    同值选择器（E2E 的 `clickSelector` 只取第一个），而玩家看到的仍是同一个入口。
 * ⚠️ `data-ph-compat="unsupported"` 落在 DOM 上 ⇒ E2E 断言「有明确提示」不依赖文案匹配。
 */
function renderCompatNotice(compat: FullRunCompat): HTMLElement {
  const box = el('div', 'ph-compat');
  box.dataset['phCompat'] = 'unsupported';
  box.dataset['phCompatReason'] = compat.reason;
  box.append(
    el('span', 'ph-compat-lead', compat.notice ?? ''),
    el('span', 'ph-compat-hint', compat.hint ?? ''),
  );
  return box;
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
  /*
    PRODUCT-LOOP-R3-MOVEMENT-EQUIP-PREVIEW｜把本次布局的 `scale` 如实写到 DOM 上。
    E2E 要证「换轮子 → 画出来的轮子真的变大变小」，就必须知道**本次**的本地 px → 预览 px
    换算率（`scale` 随整车包围盒变化，换大轮会同时改包围盒 ⇒ 不能写死、也不能事后复算）。
    纯只读标注：不参与任何渲染分支，也不改任何产品行为。
  */
  box.dataset['phScale'] = String(layout.scale);
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
  // 唯一读入口：正式存档 → starter 回退（⚠️ 回退值不落盘；有存档时本入口会顺带完成
  // PRODUCT-LOOP-P0 的一次性旧 starter profile 迁移，见 `loadEquippedDraft` / `migrateLegacyStarterProfile`）
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
  /**
   * ⚠️ PRODUCT-LOOP-R2-VALIDATION-STATE-RESEED-R1｜**必须把会话归一化后的 Build 收回来**。
   *
   * 成长会话里有一类改动会写 `playerBuild.v1`：版本化一次性 reseed 会把主武器槽换回
   * `cannon ★1`（上一轮验证把起点消费掉了）。若本页继续用挂载前那份 `draft`，就会出现
   * 「屏幕/车库显示 ★2、磁盘与下一局其实是 ★1」——R1-B 起产品侧反复吃亏的两处读数分叉。
   * 没有任何改动时 `growth.draft` 与入参是**同一个对象**（逐字节相同）。
   */
  draft = growth.draft;
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
  /** 最近一次 Movement 装备动作的**真实**结果（成功与失败同构地存下来，探针原样报出）。 */
  let lastMovementEquip: { ok: boolean; reason: MovementEquipFailure | null; detail: string } | null = null;
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
   * PRODUCT-LOOP-R3-MOVEMENT-GARAGE-EQUIP｜Movement 维度的**唯一读取口径**。
   *
   * ⚠️ 页面（卡片）与探针都只调它 ⇒ 与 Weapon 区同一条「不各自算一份」的纪律。
   * ⚠️ 它**零副作用**：写只发生在 `equipMovement()`（`playerLoadout` 的唯一写入口）。
   */
  function readMovement(): MovementReading {
    return movementReading(draft, inv);
  }

  /**
   * PRODUCT-LOOP-R3-MOVEMENT-DIRECT-EQUIP｜**直接装备**（无二次确认）。
   *
   * 点 rear 卡 ⇒ 装 rear；点 front 卡 ⇒ 装 front；点「未装载」卡 ⇒ 卸下该挂点。
   * 写只发生在 `playerLoadout.equipMovement()`（唯一写入口，内部过正式 `validateSnapshot`
   * 并只经那**唯一一处** `persistPlayerBuild` 落盘），本页不碰 `savePlayerBuild` /
   * `localStorage`、不自己赋值 `rearWheelDefId` / `frontWheelDefId`。
   */
  function equipMovementAndRender(hardpointId: string, defId: string): void {
    const out = equipMovement(hardpointId, defId, draft, inv);
    lastMovementEquip = { ok: out.ok, reason: out.reason ?? null, detail: out.detail ?? '' };
    if (out.ok && out.draft) {
      draft = out.draft;
      // 库存不因装备而消耗（装备是引用，不是消耗）；重读仍走正式 ensureInventory（幂等）
      inv = playerInventory(draft);
    }
    render();
  }

  /**
   * 当前**装备的那一件**在库存里的成长读数。
   *
   * ⚠️ 必须 `(defId, star)` **一起**定位：R2-B 起同一个 defId 可以有多个星级档
   *    （★1 的炮与 ★2 的炮是两张卡、两个 stack），只按 defId 取会拿到第一条。
   * `null` = 空槽（`EMPTY_SLOT`）或库存里查无此 stack —— 两种情况都**不画**成长行，
   * 而不是画一行 `0/5` 的假读数。
   */
  function equippedGrowth(r: LoadoutReading): LoadoutReading['weapons'][number] | null {
    return (
      r.weapons.find((w) => w.defId === r.equippedWeaponId && w.star === r.equippedWeaponStar) ?? null
    );
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
      const grant = claim.grant;
      const n = el('div', 'ph-claim ph-claim-ok', `${CLAIM_OK_LEAD}：${grant.name}（已进入车库）`);
      n.dataset['phClaim'] = 'ok';
      n.dataset['phClaimDef'] = grant.defId;
      /**
       * PRODUCT-LOOP-R2-RECOVERY（必改 6）｜**领取之后必须自然引导到成长动作**。
       *
       * Queue 原文：领取后返回首页，如果当前已 5/5 ⇒ 首页显示「可升星」，然后玩家点
       * 「调整战车」进 Garage 合成。本段就是那一步提示 —— 只在**这一件真的凑满了**
       * 的时候出现（`fusable`），并且**只提示、不代劳**：
       * ⚠️ 页面**不做**任何自动合成（Queue 明令「禁止自动替玩家合成。成长必须是玩家主动
       *    确认的一步」）—— 这里连 `fuseStack` 都不会被调用，提示里的动作词指向的是
       *    既有的 `[调整战车]` 入口。
       * ⚠️ 读数取自**领奖之后**重读的那份库存（见上方 `if (claim)` 的重读段）⇒ 显示的是
       *    「现在」的真实状态，不是出发时的旧快照。
       */
      const granted = read().weapons.find((w) => w.defId === grant.defId && w.star === GROWTH_STAR);
      if (granted && granted.fusable) {
        const hint = el('span', 'ph-claim-hint', `${granted.name} ${CLAIM_UPGRADABLE_HINT}`);
        hint.dataset['phClaimHint'] = 'upgradable';
        n.append(hint);
      }
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

    /**
     * PRODUCT-LOOP-R2-RECOVERY（必改 5）｜首页的**一行最小成长状态**。
     *
     * Queue 原文：首页当前 Weapon 展示区增加一行最小状态（`加农炮 ★ 4/5`；
     * 达到 5/5 ⇒ `可升星`），并且**不要新增复杂按钮** —— 点了走既有的「调整战车」，
     * 合成在 Garage 里做。目的：玩家打完一局回首页时第一眼就知道「我现在能升级了」。
     *
     * 三条边界：
     *   - 数字全部来自 `weaponEntries()`（`(defId, star)` 一起定位），**不新造读数**；
     *   - 空槽 / 查无此 stack ⇒ **不画**这一行（而不是画 `0/5`）；
     *   - 只画 `<span>`，**零新按钮**、零新跳转 ⇒ 「调整战车」仍是唯一进门方式。
     */
    const eq = equippedGrowth(r);
    if (eq) {
      const grow = el('div', 'ph-home-growth');
      grow.dataset['phHomeGrowth'] = eq.defId;
      grow.dataset['phHomeGrowthStar'] = String(eq.star);
      grow.dataset['phHomeGrowthStack'] = eq.stackText;
      grow.dataset['phHomeGrowthReady'] = String(eq.fusable);
      grow.append(
        el('span', 'ph-home-growth-name', `${eq.name} ★${eq.star}`),
        el('span', 'ph-home-growth-value', `${GARAGE_GROWTH_LABEL} ${eq.stackText}`),
      );
      if (eq.fusable) grow.append(el('span', 'ph-home-growth-ready', HOME_GROWTH_READY_LABEL));
      stage.append(grow);
    }

    /**
     * PRODUCT-LOOP-R3-MOVEMENT-PRODUCT-LOOP-SURFACE（必改 1 / 验收 1）｜
     * 首页的**当前轮组**摘要：后轮 / 前轮各一行，显示各自正在使用的 Movement 名称。
     *
     * ── 为什么这里必须有（而不是「Garage 有就够了」）─────────────────────────────
     * Movement 已是**第一等配置维度**：它有自己的永久库存、能在 Garage 独立装备、
     * 会被写进 persisted BuildDraft、并随 `equipped=` 一起进 Run Runtime。
     * 但首页的「已装备部件」（上面那个 `r.slots`）只映射 `body.functionalHardpoints`
     * —— Movement 一条都不在 ⇒ 玩家在首页**看不到**车上装的什么轮子，
     * 只能进 Garage 才知道。本段只补这一处缺口。
     *
     * ── 数据真源（零新造读数）───────────────────────────────────────────────────
     * 只读 `movementReading(draft, playerInventory(draft))` 的 `slots`
     * —— 与 Garage 的 `readMovement()` 是**同一个函数、同一份读数**，
     * 所以「首页显示」与「Garage 显示」结构上不可能分叉（验收 1 + 验收 2）。
     *
     * ── 挂点顺序与标签 ─────────────────────────────────────────────────────────
     * 顺序**现读自正式 BodyDef**（`slots` 已是 `movementHardpoints` 顺序），
     * 不写死 rear 在前；标签取自 `MOVEMENT_HARDPOINT_LABELS`（与 Garage 同一套词）。
     *
     * ── 三个硬边界 ─────────────────────────────────────────────────────────────
     *   ① 只画 `<span>` / `<li>`，**零新按钮、零新跳转** —— 改配置仍只有「调整战车」一条路；
     *   ② 不新增第二个 Garage 式的卡阵（Queue：不要重复增加第二套 UI）；
     *   ③ 与 Weapon 区一样带稳定挂点（`data-ph-home-movement`），供 E2E / 探针定位，
     *      **不依赖文案匹配**。
     */
    const movement = movementReading(draft, playerInventory(draft));
    if (movement.slots.length > 0) {
      stage.append(el('h2', 'ph-sec', HOME_MOVEMENT_SECTION_LABEL));
      const mvList = el('ul', 'ph-slots ph-home-movement');
      mvList.dataset['phHomeMovement'] = '1';
      for (const slot of movement.slots) {
        const li = el('li', 'ph-slot ph-home-movement-slot');
        li.dataset['phHomeMovementSlot'] = slot.hardpointId;
        // 「明确卸下」（storedDefId === 'none'）与「缺省轮在跑」（storedDefId === null）
        // 是**两种不同状态**，读数层已经用 `unmounted` 分开 ⇒ 这里如实画出，不合并。
        li.dataset['phHomeMovementStored'] = slot.storedDefId === null ? '' : slot.storedDefId;
        li.dataset['phHomeMovementDef'] = slot.effectiveDefId ?? '';
        li.dataset['phHomeMovementUnmounted'] = String(slot.unmounted);
        li.append(
          el('span', 'ph-slot-label', MOVEMENT_HARDPOINT_LABELS[slot.hardpointId] ?? slot.hardpointId),
          el(
            'span',
            'ph-slot-name',
            slot.unmounted ? GARAGE_MOVEMENT_OFF_LABEL : slot.name,
          ),
        );
        mvList.append(li);
      }
      stage.append(mvList);
    }

    const goGarage = (): void => {
      view = 'garage';
      selected = null;
      render();
    };
    const actions = el('div', 'ph-actions');
    const toGarage = el('button', 'ph-btn ph-btn-primary', HOME_GARAGE_LABEL);
    toGarage.type = 'button';
    toGarage.dataset['phAction'] = 'open-garage';
    toGarage.addEventListener('click', goGarage);
    /**
     * PRODUCT-LOOP-P0-RUN-BUILD-LOADOUT-COMPATIBILITY｜**「开始冒险」守门**（必改 2 / 必改 3）。
     *
     * 真人 P0：`equipped = 非 cannon` ⇒「前几日正常 → DAY3 选 heavyShell → `beginBattle`
     * → `applyRunModifiersToSnapshot()` 找不到 cannon → throw → Run 卡死」。
     * 根因是「没有开始完整 Run 的资格这一层」——局外已支持 spear / hammer，而已真人验证的
     * Run Build 内容（heavyShell / twinCannon / fastReload / kineticBurst / tripleLoad）
     * **全部**围绕 cannon 派生，且 R1-C 只验证了「非 cannon 的第一场 Battle」。
     *
     * 三条**不做**（Queue 逐字）：
     *   ① 不得进入 Run；② **不得偷偷替换成 Cannon**；③ 不得创建半残 Run。
     * ⇒ 因此这里**不是**「把 spear 换成 cannon 再放行」，而是**根本不给链接**：
     *    可执行时是 `<a href>`（地址由 `runReward.buildAdventureHref()` 产出），
     *    不可执行时是**没有 href 的 disabled 按钮** —— 「点了不会创建 Run」在结构上成立，
     *    而不是靠事件处理里 return（后者一旦漏掉一处就变成静默放行）。
     *
     * ⚠️ 判据来自 `fullRunCompat(draft)`（真实 `BuildDraft` + 正式内容库分类字段），
     *    **不是**页面里的字符串比较（必改 1）。
     * ⚠️ 提示只给 Queue 给的两句文案 + 既有的「调整战车」入口（同一个 `toGarage`），
     *    不新增第二个入口、不做弹窗。
     */
    const compat = fullRunCompat(draft);
    if (compat.ok) {
      // `开始冒险` 是同产物内的真实相对链接；地址由 `runReward.buildAdventureHref()` 产出
      // （带本局 token / 奖励 id / **当前这份装备** / 回程地址）—— 「打完一局 → 领奖 → 回首页」
      // 与「车库换装 → 下一局就用新装备」都靠同一个地址。
      const start = el('a', 'ph-btn ph-btn-start', HOME_START_LABEL);
      start.href = adventureHrefNow();
      start.dataset['phAction'] = 'start-run';
      start.dataset['phRunToken'] = runToken;
      actions.append(toGarage, start);
    } else {
      /**
       * 不可执行形态：**没有 href** ⇒ 无法导航、无法创建 Run（不是「点了没反应」）。
       * ⚠️ 保留 `data-ph-action="start-run"` + `data-ph-run-token`：探针与 E2E 用同一个
       *    选择器就能同时读「可执行」与「不可执行」两种形态，不需要第二套口径。
       * ⚠️ `disabled` 同时挡住鼠标与键盘激活。
       */
      const blocked = el('button', 'ph-btn ph-btn-start ph-btn-blocked', HOME_START_LABEL);
      blocked.type = 'button';
      blocked.disabled = true;
      blocked.dataset['phAction'] = 'start-run';
      blocked.dataset['phStartBlocked'] = '1';
      blocked.dataset['phStartBlockedReason'] = compat.reason;
      blocked.dataset['phRunToken'] = runToken;
      actions.append(toGarage, blocked);
    }
    if (!compat.ok) stage.append(renderCompatNotice(compat));
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
        '打完一局（RUN COMPLETE）会获得「加农炮 ★1 ×1」：卡片上写着当前进度与领取后的进度（例如 4/5 → 5/5）；领回来后在「调整战车」里就能看到并装上。',
      ),
    );
    stage.append(
      el('p', 'ph-note', '同一件部件可以累积数量：凑满 5 件后，那张卡会变成「可合成」并出现「合成升星」。'),
    );
    stage.append(
      el(
        'p',
        'ph-note',
        '合成规则：5 件 ★1 → 1 件 ★2。' +
          '星级越高占的能量越多；★5 是目前的上限，到了就不能再合。',
      ),
    );
  }

  /**
   * PRODUCT-LOOP-R3-MOVEMENT-GARAGE-EQUIP｜**Garage 里的 Movement 配置区**。
   *
   * ── 它接进的是既有的哪一套（Queue 必改 1「不重新设计整个 Garage」）────────────
   * 布局 / 卡片 / 装备交互**复用 Weapon 区那一套**，但**去掉二次确认**：
   *   - 区内按挂点分行，每行一个 `<span>` 标签 + 一条 `.ph-grid` 卡阵（与武器区同一个类）；
   *   - 每张**已拥有**卡是 `.ph-card`，**点击即直接装备到它所在的挂点**（rear 卡装 rear、
   *     front 卡装 front），不需要先选中再点「装备」；
   *   - 「未装载」项（`EMPTY_SLOT`）点击即卸下对应挂点 —— 同样没有独立按钮。
   * 没有新增页面、没有新增视图、没有换布局语言；Weapon 区的「先选后装备」流程**原样保留**。
   *
   * ── 三个「只画什么」的硬边界 ────────────────────────────────────────────────
   *   ① **只画 canonical Movement**（`readMovement().cards` 来自 `registry.movements`），
   *      不新增任何轮组类型；
   *   ② 未拥有（`owned === false`）的卡**如实画出但不可点**、标 `未拥有`
   *      —— **不提供**解锁 / 购买 / 进度 / 经济（Queue 禁止清单）；
   *   ③ 缺省轮（`implicit`）**照常展示、照常可装备**（它不进库存但恒拥有）。
   *
   * ── 为什么「卸下」这一项在卡阵里 ────────────────────────────────────────────
   * `rear` = `'none'`（明确卸下）与 `rear` = 没有这个键（缺省轮在跑）在**物理上不同**，
   * 而后者有它自己的一张卡（缺省轮那张）。若不给出一个显式的「卸下」项，
   * 玩家就永远无法表达前一种状态 ⇒ 三态里少一态。故每个挂点行尾补一个
   * `未装载` 项（唯一 defId 取 `EMPTY_SLOT`，真源在 `buildEditorModel`）。
   */
  function renderMovementSection(): void {
    const m = readMovement();
    stage.append(el('h2', 'ph-sec', GARAGE_MOVEMENT_SECTION_LABEL));

    for (const slot of m.slots) {
      const row = el('div', 'ph-mv-row');
      row.dataset['phMovementRow'] = slot.hardpointId;
      row.dataset['phMovementStored'] = slot.storedDefId === null ? '' : slot.storedDefId;
      row.dataset['phMovementEffective'] = slot.effectiveDefId ?? '';
      row.dataset['phMovementUnmounted'] = String(slot.unmounted);
      row.append(
        el('span', 'ph-mv-label', MOVEMENT_HARDPOINT_LABELS[slot.hardpointId] ?? slot.hardpointId),
        el('span', 'ph-mv-current', slot.unmounted ? GARAGE_MOVEMENT_OFF_LABEL : slot.name),
      );

      const grid = el('div', 'ph-grid ph-mv-grid');
      for (const c of m.cards) {
        const cell = el('div', 'ph-card-cell');
        const card = el('button', 'ph-card ph-card-mv');
        card.type = 'button';
        card.dataset['phMovement'] = c.defId;
        card.dataset['phMovementHardpoint'] = slot.hardpointId;
        card.dataset['phMovementOwned'] = String(c.owned);
        card.dataset['phMovementImplicit'] = String(c.implicit);
        card.dataset['phMovementCount'] = String(c.count);
        card.dataset['phMovementNeedsInventory'] = String(c.needsInventory);
        /*
          PRODUCT-LOOP-R3-MOVEMENT-CARD-READABILITY｜这一行是**玩家能直接读**的轮组差异
          （`轮径 12 · 质量 6 · 能耗 5`），取自 canonical Movement Def。
          ⚠️ 单独再挂一个 `data-ph-movement-stats` 是为了让 E2E 能把**屏幕上那一串**
             （而不是探针里的另一个字段）与 canonical 值逐字对账 —— 探针与 DOM 各自取证。
        */
        card.dataset['phMovementStats'] = c.statsText;
        card.dataset['phMovementRadius'] = String(c.radius);
        card.dataset['phMovementMass'] = String(c.mass);
        card.dataset['phMovementEnergy'] = String(c.energy);

        const effectiveHere = slot.effectiveDefId === c.defId;
        card.dataset['phMovementEquipped'] = String(effectiveHere);
        if (effectiveHere) card.classList.add('ph-card-equipped');
        card.append(el('span', 'ph-card-name', c.name));
        /*
          PRODUCT-LOOP-R3-MOVEMENT-CARD-READABILITY｜**卡片刻度行**（轮径 / 质量 / 能耗）。

          为什么必须有：Movement 选择种子之后玩家**已经拥有四档轮组**，但卡片此前只能
          识别「名称 + 拥有状态」⇒ 缺少最基础的比较依据（「它们到底有什么不同？」）。
          这一行就是那个依据，且全部是**真实配置数据**（canonical `WheelDef` 的
          `radius` / `mass` / `energy`），不是推导出来的效果描述。

          ⚠️ 四档（含缺省轮）**同一套规则**：`c.statsText` 对所有卡都是同一个函数生成的，
             页面里没有「这件特殊、那件不特殊」的分支。
          ⚠️ 只加这一行，不加 tooltip、不加属性面板、不加星级 / 品质（Queue 禁止清单）。
          ⚠️ 它是**纯展示**：不影响 card 的 click / disabled / 选中态 / equip / scroll。
        */
        card.append(el('span', 'ph-card-stats', c.statsText));
        if (c.implicit) card.append(el('span', 'ph-card-tag', GARAGE_MOVEMENT_DEFAULT_LABEL));
        if (effectiveHere) card.append(el('span', 'ph-card-tag', GARAGE_MOVEMENT_EQUIPPED_LABEL));
        // 未拥有 ⇒ 明确标注，并且**不可点**（结构上装不上，而不是点了给个错误提示）
        if (!c.owned) {
          card.append(el('span', 'ph-card-badge ph-card-badge-max', GARAGE_MOVEMENT_LOCKED_LABEL));
          card.disabled = true;
        } else {
          // PRODUCT-LOOP-R3-MOVEMENT-DIRECT-EQUIP｜点已拥有卡即直接装备到本挂点（无二次确认）
          card.addEventListener('click', () => equipMovementAndRender(slot.hardpointId, c.defId));
        }
        cell.append(card);
        grid.append(cell);
      }

      /*
        「卸下」项：与卡阵同一套外观，唯一区别是它的 defId = `EMPTY_SLOT`。
        ⚠️ 只对**需要库存之外**的状态有意义 —— 卸下一件事对任何挂点都成立，
           所以这一项恒在（与「缺省轮」那张卡并存：一个是「标准轮在跑」，一个是「没轮」）。
      */
      const offCell = el('div', 'ph-card-cell');
      const offCard = el('button', 'ph-card ph-card-mv');
      offCard.type = 'button';
      offCard.dataset['phMovement'] = EMPTY_SLOT;
      offCard.dataset['phMovementHardpoint'] = slot.hardpointId;
      offCard.dataset['phMovementOwned'] = 'true';
      offCard.dataset['phMovementImplicit'] = 'false';
      offCard.dataset['phMovementCount'] = '0';
      offCard.dataset['phMovementNeedsInventory'] = 'false';
      offCard.dataset['phMovementEquipped'] = String(slot.unmounted);
      offCard.dataset['phMovementOff'] = '1';
      if (slot.unmounted) {
        offCard.classList.add('ph-card-equipped');
      }
      offCard.append(el('span', 'ph-card-name', GARAGE_MOVEMENT_OFF_LABEL));
      if (slot.unmounted) offCard.append(el('span', 'ph-card-tag', GARAGE_MOVEMENT_EQUIPPED_LABEL));
      // PRODUCT-LOOP-R3-MOVEMENT-DIRECT-EQUIP｜点「未装载」即卸下本挂点（无二次确认）
      offCard.addEventListener('click', () => equipMovementAndRender(slot.hardpointId, EMPTY_SLOT));
      offCell.append(offCard);
      grid.append(offCell);

      row.append(grid);
      stage.append(row);
    }

    if (lastMovementEquip) {
      const msg = el(
        'p',
        lastMovementEquip.ok ? 'ph-note ph-note-ok' : 'ph-note ph-note-bad',
        lastMovementEquip.ok
          ? '已装备轮组并写入正式玩家 Build 存档。'
          : `轮组装备被拒绝（${String(lastMovementEquip.reason)}）：${lastMovementEquip.detail}`,
      );
      msg.dataset['phMovementMsg'] = lastMovementEquip.ok ? 'ok' : 'fail';
      stage.append(msg);
    }
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

    /**
     * PRODUCT-LOOP-P0｜**Garage 必须能识别「当前可冒险状态」**（Queue 必改 3）。
     *
     * 必改 3 的三条边界，逐条落地：
     *   - Spear / Hammer **仍然允许拥有 / 查看 / 装备**（本页一个字都没改装备流程，
     *     也没有从库存里删任何东西 —— 卡照画、按钮照点、`equipWeapon` 照旧放行）；
     *   - 但装完之后，玩家在**这里**就能看到「这辆车的当前装备跑不了完整冒险」，
     *     不必等回到首页撞上不可用的按钮；
     *   - 回到首页时「开始冒险」进入**不可执行**状态（见 `renderHome` 的守门），
     *     并给出「需要更换支持完整 Run 的武器」的明确提示。
     *
     * ⚠️ 与首页守门**同一次判断来源**（`fullRunCompat(draft)`）⇒ 不会出现
     *    「车库说可以、首页说不可以」这种自相矛盾的页面。
     */
    const garageCompat = fullRunCompat(draft);
    const runStatus = el('div', 'ph-run-status');
    runStatus.dataset['phRunCompat'] = garageCompat.ok ? 'ok' : 'unsupported';
    runStatus.dataset['phRunCompatReason'] = garageCompat.reason;
    runStatus.append(
      el('span', 'ph-run-status-label', '完整冒险'),
      el('span', 'ph-run-status-value', garageCompat.ok ? '当前装备可以出发' : '当前装备不支持'),
    );
    if (!garageCompat.ok) {
      runStatus.append(el('span', 'ph-run-status-hint', garageCompat.notice ?? ''));
    }
    stage.append(runStatus);

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
      /**
       * PRODUCT-LOOP-R2-RECOVERY（必改 4）｜**离满还差 1 件**。
       *
       * `threshold - count === 1`（且未满）正是 Queue 明写要出现的那一行
       * 「还差 1 个即可升星」。⚠️ 只在这一种情况提示：差 2 件时说「还差 1 个」是假话，
       * 差 0 件时它已经是可合成态（那时该看到的是 `可合成` + `合成升星` 按钮）。
       */
      const nearFull = !w.reachesThreshold && w.threshold - w.count === 1;
      card.dataset['phNearFull'] = String(nearFull);
      if (w.reachesThreshold) card.classList.add('ph-card-full');
      card.append(
        el('span', 'ph-card-name', `${w.name} ★${w.star}`),
        /**
         * PRODUCT-LOOP-R2-RECOVERY（必改 4）｜**成长 = 卡片主体信息**。
         *
         * 值 = `成长 4/5`（`w.stackText` 来自 `weaponEntries()`，与探针 / 库存在同一份读数上）。
         * ⚠️ R2-B 时这一段挂在 meta 行尾（`能量 30 · 4/5`）⇒ 真人反馈「完全找不到」。
         *    本 Queue 把它提成独立一行，且**仍在卡片上**（不是页面底部说明）。
         */
        el('span', 'ph-card-growth', `${GARAGE_GROWTH_LABEL} ${w.stackText}`),
        // 4/5 时明确说出「还差多少」——玩家不需要自己做减法
        ...(nearFull ? [el('span', 'ph-card-hint', GARAGE_NEAR_FULL_LABEL)] : []),
        /**
         * PRODUCT-LOOP-R2-C（Queue 必改 4）｜**最终主属性**：升星到底换来什么。
         *
         * `攻击 120 → 150` = 这一档一次命中扣多少血 → 升一星后扣多少血。
         * 数字来自 `playerLoadout.weaponEntries()`（`starTierDamage` + `weaponMainDamage`），
         * 与战斗里真实结算的伤害**同一次计算** ⇒ 卡片不会承诺一个打不出来的数。
         * 只有这一行，不加属性面板（Queue 明令）。
         * ⚠️ `damageText === ''`（该武器的伤害不在星级层的作用面上）= **不画这一行**，
         *    而不是画一个 `攻击 0`。
         */
        ...(w.damageText === '' ? [] : [el('span', 'ph-card-damage', w.damageText)]),
        // 能量是**独立**读数（成长进度已经上移到 `ph-card-growth`，这里不再重复它）
        el('span', 'ph-card-meta', `能量 ${w.energyInUse}`),
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

    /*
      ⚠️ PRODUCT-LOOP-R3-MOVEMENT-GARAGE-EQUIP｜Movement 区**必须放在武器那一组之后**。

      起初它被插在「武器卡阵」与「装备 / 返回」按钮之间，实测后果是：
      武器「装备」按钮被推到 `y=1034`，而视口只有 720 高 ⇒ **主操作落到屏幕外**
      （`elementFromPoint(center)` 返回 `null`，真实鼠标点不到）。
      这不只是 E2E 取不到坐标的问题 —— 玩家也点不到，是一处真实可用性回归。

      放到武器组之后，语义也更干净：**每组配置 = 卡阵 + 它自己的动作条**，
      中间不夹另一组的内容（武器组不再被 Movement 区截断）。
    */
    renderMovementSection();

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
      /**
       * ⚠️ PRODUCT-LOOP-P0：这里**不再**只找 `<a>` ——「不可执行」形态是一个
       *     **没有 href 的 `disabled <button>`**，它同样带 `data-ph-action="start-run"`
       *     ⇒ 同一选择器覆盖两种形态，探针不需要第二套口径。
       *     `getAttribute('href')` 对 button 恒为 `null` ⇒ `startRunHref === null`
       *     **本身就是**「点击无法创建 Run」的机器证据（不是「链接在但点了没用」）。
       */
      const start = stage.querySelector<HTMLElement>('[data-ph-action="start-run"]');
      const compat = fullRunCompat(draft);
      const equipBtn = stage.querySelector<HTMLButtonElement>('[data-ph-action="equip"]');
      const mv = readMovement();
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
          /**
           * PRODUCT-LOOP-R2-RECOVERY（必改 1）｜本次挂载的一次性 onboarding 迁移读数。
           *
           * ⚠️ 直接取成长会话的判定结果（页面 / 探针不各自再判一次），
           *    因此 E2E 可以断言「历史 Profile 第一次进来被补到 4/5」与
           *    「reload 之后 `already-marked` ⇒ 没有再补」这两条**互斥**的事实。
           */
          onboardingApplied: growth.onboarding.applied,
          onboardingReason: growth.onboarding.reason,
          onboardingRaised: growth.onboarding.raised,
          onboardingCannon: growth.onboarding.cannonAfter,
          /**
           * PRODUCT-LOOP-R2-VALIDATION-STATE-RESEED-R1｜本队列的**版本化一次性 reseed** 读数。
           *
           * ⚠️ 同样直接取成长会话的判定结果（页面 / 探针不各自再判一次）⇒ E2E 能断言
           *    「已消费起点的账号第一次进来被恢复成 4/5 + 装备 ★1」与「reload 之后
           *    `already-marked` ⇒ 没有再改库存」这两条**互斥**的事实。
           */
          reseedApplied: growth.reseed.applied,
          reseedReason: growth.reseed.reason,
          reseedCleared: growth.reseed.cleared,
          reseedCannon: growth.reseed.cannonAfter,
          /**
           * PRODUCT-LOOP-R3-MOVEMENT-PERSISTENT-INVENTORY｜本队列的 **Movement 拥有读数**
           * （owned / equipped / persisted 三侧同一口径，直接取成长会话，页面不自行推导）。
           *
           * ⚠️ `movementRepaired` = 本次挂载为「装着却不拥有」的 Movement 补的件（空 = 没动）；
           *    `movementLegal` = 「每一条装着的 Movement 都合法拥有」这条不变式。
           */
          movementRepaired: growth.movementGrants,
          movementLegal: growth.movements.legal,
          movements: growth.movements.entries.map((m) => ({
            defId: m.defId,
            name: m.name,
            kind: m.kind,
            needsInventory: m.needsInventory,
            count: m.count,
            owned: m.owned,
            implicit: m.implicit,
            equipped: m.equipped,
            hardpoints: m.hardpoints,
          })),
        },
        /**
         * PRODUCT-LOOP-R2-RECOVERY（必改 5）｜首页那一行成长状态的真实读数
         * （`null` = 当前没有装备武器 / 查无此 stack ⇒ 那一行没画）。
         */
        homeGrowth: (() => {
          const eq = equippedGrowth(r);
          return eq
            ? {
                defId: eq.defId,
                name: eq.name,
                star: eq.star,
                count: eq.count,
                threshold: eq.threshold,
                stackText: eq.stackText,
                ready: eq.fusable,
              }
            : null;
        })(),
        /**
         * PRODUCT-LOOP-R2-RECOVERY（必改 6）｜领奖提示里那条「已可升星」引导是否出现。
         */
        claimUpgradableHint: !!header.querySelector('[data-ph-claim-hint="upgradable"]'),
        selectedWeaponId: selected ? selected.defId : null,
        selectedWeaponStar: selected ? selected.star : null,
        equipEnabled: !!equipBtn && !equipBtn.disabled,
        /**
         * PRODUCT-LOOP-R3-MOVEMENT-GARAGE-EQUIP｜Movement 维度读数
         * （与 Garage 里那一片卡画的**是同一份**，页面禁止自行推导）。
         */
        movement: {
          slots: mv.slots.map((s) => ({
            hardpointId: s.hardpointId,
            storedDefId: s.storedDefId,
            effectiveDefId: s.effectiveDefId,
            name: s.name,
            unmounted: s.unmounted,
          })),
          cards: mv.cards.map((c) => ({
            defId: c.defId,
            name: c.name,
            kind: c.kind,
            radius: c.radius,
            mass: c.mass,
            energy: c.energy,
            statsText: c.statsText,
            needsInventory: c.needsInventory,
            count: c.count,
            owned: c.owned,
            implicit: c.implicit,
            hardpoints: [...c.hardpoints],
          })),
          available: [...mv.available],
          ownedDefIds: [...mv.ownedDefIds],
          equippedDefIds: [...mv.equippedDefIds],
          legal: mv.legal,
          defaultDefId: mv.defaultDefId,
        },
        lastMovementEquip: lastMovementEquip
          ? { ok: lastMovementEquip.ok, reason: lastMovementEquip.reason }
          : null,
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
        /** PRODUCT-LOOP-P0｜见 `ProductProbe.startRunBlocked`（不可执行 = 没有 href）。 */
        startRunBlocked: start ? start.dataset['phStartBlocked'] === '1' : false,
        /** PRODUCT-LOOP-P0｜完整 Run 资格读数（与页面提示、Garage 状态同一次读取）。 */
        runCompat: {
          ok: compat.ok,
          reason: compat.reason,
          equippedWeaponIds: compat.equippedWeaponIds,
          supportedWeaponIds: compat.supportedWeaponIds,
          notice: compat.notice,
          hint: compat.hint,
        },
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
