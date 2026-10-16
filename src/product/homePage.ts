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
  bodyReading,
  equipBody,
  equipGadget,
  equipMovement,
  equipWeapon,
  loadEquippedDraft,
  loadoutReading,
  movementReading,
  playerInventory,
  unequipGadget,
  type BodyEquipFailure,
  type BodyReading,
  type EquipFailure,
  type GadgetEquipFailure,
  type LoadoutReading,
  type MovementEquipFailure,
  type MovementReading,
} from './playerLoadout';
import {
  vehiclePreviewLayout,
  type VehiclePreviewLayout,
  type VehicleSlotId,
} from './vehiclePreview';
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
  buildAdventureHref,
  buildRewardChoicePayload,
  newRunToken,
  parsePendingClaim,
  rewardChoiceIdsFor,
  type PendingClaim,
  type RewardChoiceSpec,
} from './runReward';
/**
 * UX-BAG-VISUAL-FUSION-R2｜部件图标（图标化背包 / 合成工作台的图形件）。
 * 本页只调 `partIconNode()` 拿节点：有正式美术用真 PNG，否则按 registry 真实
 * collider/radius 数据画简化矢量图 —— 图形比例与生成规则都在那个模块里，
 * 本页不自己画形状、也不第二份解释内容数据。
 */
import { partIconNode } from './partIcon';
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
/**
 * ══════════════════════════════════════════════════════════════════════════════
 * PRODUCT-LOOP-P0-GARAGE-FOUR-SLOT-CLARITY-R3｜**Garage = 四个同构装备槽的配车页**
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * 真人手机录屏（本 Queue 的问题陈述，逐字）：
 *   代码里确实有 4 个槽，但玩家实际看到的却是「上面一个独立的武器悬浮块 + 下面 3 个
 *   像页签的「后轮 / 车身 / 前轮」按钮」⇒ 视觉认知变成「3 个页签 + 1 个不知道是什么的
 *   武器块」，而不是「4 个同等级装备槽」。
 *
 * ⇒ **上一版「槽位跟随真实挂点坐标」的设计假设判定失败**（Queue 逐字），不再围绕
 *   anchor / 挂点位置微调。收敛成最普通、最清楚的一条链：
 * ```
 * .ph-main.ph-main-garage        ← 整页 overflow:hidden（本页整体不滚）
 *   .ph-header                   ← 标题 / 返回首页（返回恒可达）
 *   .ph-garage-stage             ← 战车 Preview（**固定**）
 *   .ph-garage-current           ← 「当前装备」+ 4 个**完全同构**的装备槽（固定，2×2）
 *   .ph-my-parts                 ← 「选择〈槽位名〉装备」标题（固定）
 *   .ph-garage-body              ← **唯一**滚动容器：当前槽的部件卡阵
 *   .ph-garage-foot              ← 合成入口（**持续可见且恒可点**）
 * ```
 * 2×2 的**展示顺序**（= `GARAGE_SLOT_ORDER` 的取值顺序，就是 DOM 顺序）：
 * ```
 * [ 武器 ] [ 车身 ]
 * [ 后轮 ] [ 前轮 ]
 * ```
 *
 * ── 五个槽「完全同构」的四条（Queue 必改 1 逐字）─────────────────────────────
 *   ① 同尺寸 · ② 同结构 · ③ 同交互 · ④ 同选中态 ——
 *   落地方式 = **只有一个** `.ph-slotnode` 构造分支 + 一个 grid；
 *   没有任何槽拥有专属 modifier / 专属宽高 / 绝对定位 / 悬浮块。
 *   ⚠️ Gadget 与其它四槽走**同一个** `.ph-slotnode` 规则与同一个 `GARAGE_SLOT_ORDER`
 *      循环（不新增第二个构造分支、不新增第二套 CSS 类）。
 *   ⚠️ 槽位**不再**读挂点坐标（`vehicleSlotAnchors` 已从本页移除，见 `GS-R3-02` 守卫），
 *      预览只负责「我换了东西以后车发生了什么变化」（Queue 必改 4）。
 *
 * ── 槽位 → 配置字段（一一对应，没有第二张映射表）─────────────────────────────
 *   `weapon` → `functionalSelections[WEAPON_SLOT]` / `body` → `bodyDefId` /
 *   `front` → `frontWheelDefId` / `rear` → `rearWheelDefId` /
 *   **`gadget` → `gadgetDefId`（独立字段，绝不映射回 front/top/rear）**。
 *   后两者的槽位名与 `movementHardpoints[].id` **刻意同名** ⇒ 不需要映射表。
 *
 * ⚠️ GADGET-GARAGE-SLOT-R2：**「槽位恰为 4」这条旧冻结由本 Queue 显式解除**。
 *    旧冻结写于「Gadget 尚无正式可选内容」的前提（守卫断言
 *    `GARAGE_SLOT_ORDER.length === 4` 且 `.not.toContain('gadget')`）；
 *    现 Thruster / ReverseThruster 已进入正式可选池（`gadgetGarageDataR1`），
 *    五槽版面与交互已确定 ⇒ 冻结升级为**五槽契约**，
 *    并在 `tests/productGarageMobileInteraction.test.ts` **同步更新为新契约断言**
 *    （记录契约变更原因，不是静默删断言）。
 * ⚠️ 唯一装备交互 = **点槽位 → 点已拥有部件 → 立即装备**；**不提供拖拽装备**
 *    （源码守卫「零 drag 事件」+ 运行时守卫 `garageDraggableCount === 0` 双证）。
 */
export type GarageSlot = VehicleSlotId | 'gadget';
/**
 * 5 个装备槽的**展示顺序**（= DOM 顺序，也就是玩家读到的顺序）：
 * ```
 * [ 武器 ] [ 车身 ]
 * [ 后轮 ] [ 前轮 ]
 * [ 辅助 ]← Gadget 独立占下方一行（2+2+1）
 * ```
 * ⚠️ 这不是「维度顺序」而是**版面顺序**：grid 按此顺序两两换行，
 *    第 5 项自动落到第三行并**跨满整行**（`.ph-slotnode-gadget` 的 `grid-column`）。
 */
export const GARAGE_SLOT_ORDER: readonly GarageSlot[] = ['weapon', 'body', 'rear', 'front', 'gadget'];
/** 槽位的中文名（页面里不出现第二份字面量；也是「选择〈槽位名〉装备」标题的一部分）。 */
export const GARAGE_SLOT_LABELS: Readonly<Record<GarageSlot, string>> = {
  weapon: '武器',
  body: '车身',
  front: '前轮',
  rear: '后轮',
  gadget: '辅助',
};
/** 「当前装备」小节标题 = 四个装备槽之上的唯一标题。 */
export const GARAGE_CURRENT_LABEL = '当前装备';
/**
 * 当前槽 → 下方卡片区标题（Queue 必改 2 逐字）。
 *
 * Queue 明令：点任意槽后标题**必须直接变为**「选择武器装备 / 选择车身装备 /
 * 选择后轮装备 / 选择前轮装备」，**不得**只写模糊的「我的装备」——
 * 玩家必须**无需记忆**就知道「我现在点下面的东西，会换哪个部位」。
 *
 * ⚠️ 前缀 / 后缀 + `GARAGE_SLOT_LABELS` 拼装 ⇒ 标题与槽位名不可能分叉
 *    （不写第二份「选择前轮装备」这样的字面量表）。
 */
export const GARAGE_PICK_TITLE_PREFIX = '选择';
export const GARAGE_PICK_TITLE_SUFFIX = '装备';
/** `选择` + 槽位名 + `装备`（例：`选择前轮装备`）。 */
export function garageSlotTitle(slot: GarageSlot): string {
  return `${GARAGE_PICK_TITLE_PREFIX}${GARAGE_SLOT_LABELS[slot]}${GARAGE_PICK_TITLE_SUFFIX}`;
}
/**
 * PRODUCT-LOOP-P0-GARAGE-SLOT-INTERACTION-R2（必改 4）+ R3（必改 5）｜**合成入口**。
 *
 * Queue 逐字（R2）：底部提供持续可见的「合成」入口，**不得**要求玩家通过拖动 / 长按 /
 * 猜测卡片行为发现合成；有可合成组时给一个最小可感知状态（红点 **或** 数量）；
 * 点击 → **进入现有正式 Fusion 流程**（不重做 Fusion 页面）。
 *
 * Queue 逐字（R3 必改 5）：入口**始终保持可点击** —— 不要因为当前没有 5/5 就 disable
 * 整个入口；有可合成项显示 `合成 ●` 或 `合成 1`，没有则**仍显示普通「合成」**；
 * 点进去后在正式 Fusion 流程里看到真实的 `2/5 · 4/5 · 5/5`，让玩家自己理解规则。
 *
 * ⇒ 落地：底部固定一个 `合成` 按钮（`data-ph-action="fuse-entry"`），
 *   **从不 disabled**；有可合成组时加 `ph-fuse-entry-ready`（红点 `::before`）+ 数量；
 *   点击 = 切到**武器槽**并把第一张可合成卡滚入视野 + 聚焦 —— 那里就是既有的
 *   `合成升星` 按钮（`fuseStack()` 的**唯一**调用点）与每张卡的 `成长 N/5` 进度行。
 * ⚠️ 本入口**不执行**合成、不碰库存 / 存档；规则一行都没改。
 */
export const GARAGE_FUSE_ENTRY_LABEL = '合成';
/**
 * PRODUCT-LOOP-P0-GARAGE-SLOT-INTERACTION-R1｜**配置页最核心的三种状态**。
 *
 * Queue 逐字要求：配置页只需要「使用中 / 可使用 / 未拥有」三种语义，
 * **不要**同时出现「默认 / 选中 / 已选择 / 已装备」等多套状态互相竞争。
 * ⇒ 本页四类卡片共用下面两个常量；「可使用」= 什么都不标（默认就是可点）。
 *   - `使用中`：当前真正生效的那一件（Weapon / Body / rear / front 各自唯一）；
 *   - `未拥有`：需要库存但没有 ⇒ 降级区里的不可点卡；
 *   - 「缺省轮」的 `implicit` 语义**保留在读数层**（`MovementEntry.implicit` 照旧可断言），
 *     但**不再**在卡片上画「默认」标签去跟「使用中」抢注意力。
 */
export const GARAGE_IN_USE_LABEL = '使用中';
/** 未拥有部件在卡片上的标注，也是降级区标题（同一个词，不留第二套说法）。 */
export const GARAGE_LOCKED_LABEL = '未拥有';
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
 * UX-BAG-FUSION-GRID-R1｜Garage **一级页签**文案（常量导出 ⇒ E2E 不做文案匹配）。
 */
export const GARAGE_TAB_EQUIP_LABEL = '装备';
export const GARAGE_TAB_FUSE_LABEL = '合成';
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
 * ⚠️ PRODUCT-LOOP-P0-GARAGE-MOBILE-INTERACTION-R1 删除了这里的四个常量
 *    （`GARAGE_MOVEMENT_PICK_LABEL` / `GARAGE_MOVEMENT_PICKED_LABEL` /
 *     `GARAGE_MOVEMENT_EQUIPPED_LABEL` / `GARAGE_MOVEMENT_DEFAULT_LABEL`）：
 *    「选择 / 已选择 / 已装备 / 默认」是四套互相竞争的状态语义，而本 Queue 必改 3
 *    要求配置页只保留 `使用中` / `可使用` / `未拥有` 三种 ⇒ 统一到
 *    `GARAGE_IN_USE_LABEL` + `GARAGE_LOCKED_LABEL`（文件顶部的产品状态常量）。
 * ⚠️ 同时删除了 `GARAGE_MOVEMENT_SECTION_LABEL` / `GARAGE_BODY_SECTION_LABEL`：
 *    分类 Tab（后轮 / 前轮 / 车身）**就是**这两块区域的标题 ⇒ 再画一个页内 `<h2>`
 *    只是重复一层，且要占掉固定骨架里的高度预算。
 */
/** 该挂点当前**明确卸下**（`'none'`，与「缺省轮」不同）。 */
export const GARAGE_MOVEMENT_OFF_LABEL = '未装载';
/**
 * PRODUCT-LOOP-R3-MOVEMENT-PRODUCT-LOOP-SURFACE｜首页「当前轮组」摘要。
 *
 * Queue 必改 1 的**判定**：Garage 的 Movement 配置区已经足够清楚地展示
 * 当前 rear / front（逐卡「使用中」）⇒ **不再为 Garage 增加第二套 UI**。
 * 缺的是**首页**：`loadoutReading().slots` 只映射 `body.functionalHardpoints`，
 * Movement 一个都不在 ⇒ 玩家在首页看不到自己车上装的是什么轮子。
 * 这里只补首页这一处，且**沿用 Garage 已有词汇**（后轮 / 前轮 / 未装载），
 * 不引入第二套说法。
 */
export const HOME_MOVEMENT_SECTION_LABEL = '当前轮组';
/** 挂点显示名（与 Garage 的分类标签逐字一致，同一套词）。 */
export const MOVEMENT_HARDPOINT_LABELS: Readonly<Record<string, string>> = {
  rear: '后轮',
  front: '前轮',
};
/**
 * PRODUCT-LOOP-R4-BODY-CANONICAL-AND-GARAGE-MVP｜Body 配置区的文案。
 *
 * ⚠️ 全部是常量（页面里不出现第二份字面量）—— 与 Movement / Weapon 区那批同一条纪律。
 * ⚠️ PRODUCT-LOOP-P0-GARAGE-MOBILE-INTERACTION-R1 删除了 `GARAGE_BODY_SECTION_LABEL`
 *    （`车身（Body）`）：Body 现在是分类 Tab 之一，Tab 标签 `车身` 就是它的标题。
 */
/** Garage 里「当前使用中」那一行（四类分类共用同一句话术）。 */
export const GARAGE_IN_USE_LEAD = '当前使用中';
/** GADGET-GARAGE-SLOT-R2｜Gadget 卡上的能量刻度标签（唯一字面量来源）。 */
export const GARAGE_GADGET_ENERGY_LABEL = '能量';
/** GADGET-GARAGE-SLOT-R2｜EMPTY Gadget 卡的刻度文案（它不占用任何能量）。 */
export const GARAGE_GADGET_NO_COST_LABEL = '无消耗';
/* ⚠️ PRODUCT-LOOP-R4-CONFIGURATION-BATCH-GATE：原先这里还有一个 `HOME_BODY_SECTION_LABEL`
   （首页「当前车身」摘要标题）。该摘要在真实高内容态下把首页 actions 推出舞台 → 已整块删除，
   常量随之移除（首页车身读数由既有的 `.ph-spec` 行承担）。 */
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
    /**
     * PRODUCT-LOOP-R4-BODY-CANONICAL-AND-GARAGE-MVP｜本次挂载的 **Body 种子读数**。
     *
     * ⚠️ 直接来自 `playerGrowth.openGrowthSession()` 的 `bodySeed`
     *    （页面与探针**不各自再判一次**）⇒ E2E 可以断言「第一次进来被解锁 4 台新增车身」
     *    与「reload 之后 `already-marked` ⇒ 没有再发」这两条**互斥**的事实。
     */
    readonly bodySeedApplied: boolean;
    readonly bodySeedReason: string;
    readonly bodySeedDecided: boolean;
    readonly bodySeedRaised: number;
    /**
     * PRODUCT-LOOP-R5-BASIC-CONTENT-POOL-R1｜本次挂载的 **正式内容池种子读数**。
     *
     * ⚠️ 直接来自 `playerGrowth.openGrowthSession()` 的 `contentPoolSeed`
     *    （页面与探针**不各自再判一次**）⇒ E2E 可以断言「第一次进来内容池被铺满」
     *    与「reload 之后 `already-marked` ⇒ 没有再发」这两条**互斥**的事实。
     */
    readonly contentPoolSeedApplied: boolean;
    readonly contentPoolSeedReason: string;
    readonly contentPoolSeedDecided: boolean;
    /** 本次为内容池新解锁的车身台数（`NEW_OFFICIAL_BODIES` 那一半的 `raised` 求和）。 */
    readonly contentPoolSeedRaisedBodies: number;
    /** 本次为内容池新补的功能件件数（`OFFICIAL_PARTS` 那一半的 `raised` 求和）。 */
    readonly contentPoolSeedRaisedParts: number;
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
  /**
   * ══════════════════════════════════════════════════════════════════════════════
   * PRODUCT-LOOP-P0-GARAGE-FOUR-SLOT-CLARITY-R3｜Garage 当前**高亮的装备槽**。
   * ⚠️ 原先的 `selectedWeaponId` / `selectedWeaponStar` / `equipEnabled` 三个字段随
   *    R1「先选 → 再点`装备`」两步流程一并删除（四维统一为点卡即装备，
   *    「卡片已选择但还没真正装备」这种中间态在结构上不再存在）。
   * ══════════════════════════════════════════════════════════════════════════════
   */
  readonly garageSlot: GarageSlot;
  /**
   * R3 验收 3｜**当前槽 → 下方卡片区标题**的对应关系（页面真实画出来的那个字符串，
   * 例：`garageSlot === 'front'` ⇒ `'选择前轮装备'`）。
   * ⚠️ 与 `garageSlot` **同一次渲染**读出来 ⇒ 二者分叉即红（不靠人眼核对）。
   */
  readonly garageSlotTitle: string;
  /**
   * 页面上真实渲染出来的装备槽数量（本 Queue 之后恒为 **4**）。
   * ⚠️ 运行时读数（`querySelectorAll('[data-ph-slot]').length`），不是源码推断
   *    ⇒ 「4 个槽都画出来了」与「没有第 5 个未来空槽」都能被直接断言。
   */
  readonly garageSlotCount: number;
  /**
   * 页面上 `[data-ph-action="equip"]` 的**运行时**数量（本 Queue 之后恒为 0）。
   * ⚠️ 这是「二次装备按钮已删除」的运行时硬证据，不是源码里「没写」的推断。
   */
  readonly garageEquipButtonCount: number;
  /**
   * 页面上**可拖拽元素**的运行时数量（`[draggable="true"]`，恒为 0）。
   * ⚠️ 必改 2 明令「不得实现拖拽装备」⇒ 这是运行时硬证据（源码守卫另有一条）。
   */
  readonly garageDraggableCount: number;
  /**
   * 底部「合成」入口是否**可见**（必改 4：持续可见，恒为 true）。
   * 判据 = 元素存在且 `getBoundingClientRect()` 有非零面积且未被样式隐藏。
   */
  readonly garageFuseEntryVisible: boolean;
  /** 当前**可合成组数**（`weaponEntries().fusable` 的条数）——底部入口的最小状态提示。 */
  readonly garageFuseReadyCount: number;
  /** 底部合成入口是否处于「可感知」态（有可合成组时 = true）。 */
  readonly garageFuseEntryReady: boolean;
  /**
   * R3 验收 8｜底部合成入口是否**被禁用**（恒为 `false`）。
   * ⚠️ Queue 必改 5 明令「不要因为当前没有 5/5 就 disable 整个入口」⇒ 这条读数是
   *    「无条件可进入」的运行时硬证据（`el.disabled === true`，不是源码推断）。
   */
  readonly garageFuseEntryDisabled: boolean;
  /**
   * UX-BLUESTAR-EQUIP-FUSE-SIMPLIFY-R1｜当前打开的 Garage 弹窗类型
   * （`null` = 没有弹窗；`'equip'` = 当前/新装备对比确认；`'fuse'` = 图腾式合成）。
   */
  readonly garageModal: 'equip' | 'fuse' | null;
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
   * PRODUCT-LOOP-R4-BODY-CANONICAL-AND-GARAGE-MVP｜**Body 维度的全量读数**
   * （直接来自 `playerLoadout.bodyReading()`，页面画的**就是这些字段**）。
   *
   * ⚠️ 与 Weapon / Movement 区同一条纪律：探针不另算一份 ⇒「屏幕上写着某车身在用」与
   *    「探针说 `equippedDefIds` 含它」不可能分叉。
   *   - `cards[]` —— 逐台 canonical 正式车身的 owned / implicit / equipped 读数 + 三个核心数值；
   *   - `available[]` —— **可装备**的 defId（= `owned === true` 的那些）
   *     ⇒ Queue「只允许装备真实拥有的 canonical Body」的可断言形式。
   */
  readonly body: {
    readonly bodyDefId: string;
    readonly cards: readonly {
      readonly defId: string;
      readonly name: string;
      readonly hp: number;
      readonly baseMass: number;
      readonly energyCapacity: number;
      readonly statsText: string;
      readonly owned: boolean;
      readonly implicit: boolean;
      readonly equipped: boolean;
    }[];
    readonly available: readonly string[];
    readonly ownedDefIds: readonly string[];
    readonly equippedDefIds: readonly string[];
    readonly legal: boolean;
  };
  /**
   * ⚠️ PRODUCT-LOOP-R3-MOVEMENT-DIRECT-EQUIP｜Movement 区**没有**二次确认：
   *    点已拥有卡即直接装备（rear 卡装 rear、front 卡装 front），不再有「选中态」、
   *    也不再有任何独立的「装备」按钮。`selectedMovement` / `movementEquipEnabled`
   *    这两个探针字段已在本次删除（见本文件 git 历史）。
   */
  /** 本次挂载**最后一次** Movement 装备动作的**真实**结果（`null` = 还没点过）。 */
  readonly lastMovementEquip: { readonly ok: boolean; readonly reason: MovementEquipFailure | null } | null;
  /** 本次挂载**最后一次** Body 装备动作的**真实**结果（`null` = 还没点过）。 */
  readonly lastBodyEquip: { readonly ok: boolean; readonly reason: BodyEquipFailure | null } | null;
  /**
   * GADGET-GARAGE-SLOT-R2｜最近一次 Gadget 装备/卸下动作的**真实**结果（同构）。
   * ⚠️ 探针「如实报出」失败原因（`not-gadget` / `unknown-slot` / `not-owned` /
   *    `invalid-build`），不静默成功。
   */
  readonly lastGadgetEquip: { readonly ok: boolean; readonly reason: GadgetEquipFailure | null } | null;
  /** 当前装备的 Gadget defId（无 Gadget = `EMPTY_SLOT`）。 */
  readonly equippedGadgetId: string;
  /** 当前装备 Gadget 的玩家语言名（无 Gadget = 「无」）。 */
  readonly equippedGadgetName: string;
  /** Garage Gadget 槽的可选卡片读数（EMPTY + 推进器 + 反推器）。 */
  readonly gadgets: readonly {
    readonly defId: string;
    readonly name: string;
    readonly energy: number;
    readonly empty: boolean;
    readonly owned: boolean;
  }[];
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
 * Queue 逐字要求两句（主轴提示 + 「请先调整战车」），
 * 并明写「**不要做复杂弹窗**」⇒ 这里就是一个内联的普通块，紧贴在 `[调整战车]` 按钮上方。
 *
 * ⚠️ PRODUCT-LOOP-R6：主轴提示的**口径已随能力登记一起改**（本文件一字未改文案）——
 *    改前是「当前原型**仅支持加农炮**进行完整冒险」（因为 Run 底层把武器硬绑 cannon），
 *    R6 起 Run 以「玩家装备的第一件正式武器」为 base ⇒ 被拒的理由只剩
 *    「这件武器还没有完整的战斗 Runtime」⇒ 文案变成
 *    「当前原型**尚不支持这件武器**进行完整冒险」（真源仍在 `runCompatibility`）。
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
 * 预览件本地坐标 → 「以 `.ph-car` 盒心为原点」的预览 px 偏移（**唯一**一套换算）。
 *
 * ⚠️ PRODUCT-LOOP-P0-GARAGE-SLOT-INTERACTION-R2：本地 y 与屏幕 y **同向**（都向下）
 *    ⇒ 这里是 `dy = (cy - by) * scale`，**不取反**。
 *    真实链路依据：Battle 世界 `gravity.y = +10` / `visualWorldTransform` 的
 *    `position.y = physPos.y + anchor.y` / Run 舞台 `placeSideViewVisuals` 直接拿
 *    `cy` 当屏幕 y —— 三处同口径，详见 `vehiclePreview.ts` 文件头「坐标口径」。
 *    ⚠️ R1 之前这里多取了一次反 ⇒ 整车上下镜像（轮子在车身之上、武器挂在车底）。
 *    本函数同时服务 `renderPreview` 与「装备槽定位」⇒ 预览件 / 装备槽坐标不可能漂移。
 */
function previewOffset(layout: VehiclePreviewLayout, cx: number, cy: number): { dx: number; dy: number } {
  const bx = (layout.minX + layout.maxX) / 2;
  const by = (layout.minY + layout.maxY) / 2;
  return { dx: (cx - bx) * layout.scale, dy: (cy - by) * layout.scale };
}

/**
 * 车辆预览（纯 DOM，零画布）：每个 item 一个绝对定位元素；
 * 有正式 sprite → `<img>`，无 → 按真实 Collider 外接框画灰盒并带 `data-ph-nosprite` 标注。
 *
 * 定位口径：元素以 `.ph-car` **盒心**为原点（`calc(50% + Δpx)`），Δ 由
 * `previewOffset()` 给出（本地 y 与屏幕 y 同向 ⇒ **不翻转**）。
 * 盒子宽度与布局无关 ⇒ 不会被父级内边距挤偏。
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
  const ordered = [...layout.items].sort((a, b) => a.layer - b.layer);
  for (const it of ordered) {
    const url = it.visualId ? SPRITE_URLS[it.visualId] : undefined;
    const node = url ? el('img', 'ph-car-item') : el('div', 'ph-car-item ph-car-fallback');
    const w = it.w * layout.scale;
    const h = it.h * layout.scale;
    const { dx, dy } = previewOffset(layout, it.cx, it.cy);
    node.style.left = `calc(50% + ${dx - w / 2}px)`;
    node.style.top = `calc(50% + ${dy - h / 2}px)`;
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
   * PRODUCT-LOOP-P0-GARAGE-SLOT-INTERACTION-R2｜当前**高亮的装备槽**。
   *
   * 槽位 = 真实的配置维度（`weapon` / `body` / `front` / `rear`），不是 UI 分组：
   * 点某个槽 ⇒ 该槽高亮 ⇒ 中下区「我的装备」只列**该槽兼容**的部件。
   *
   * ⚠️ 替换掉了 R2-B 起那个 `selected: {defId,star} | null`（「先选后装备」的中间态）：
   *    「已选择但还没装备」这种状态在结构上不允许存在，`selected` 变量随之删除。
   */
  let garageSlot: GarageSlot = 'weapon';
  /**
   * UX-BLUESTAR-EQUIP-FUSE-SIMPLIFY-R1｜**当前打开的弹窗**（单一状态，互斥）：
   *   - `equip`：点库存格 → 「当前装备 / 新装备」对比确认弹窗（取消零写盘）；
   *   - `fuse`：点【合成】→ 图腾式可合成组列表弹窗（只列 count>=5 且未满星）。
   * ⚠️ 只是**视图状态**：两个弹窗的全部写动作都走既有正式入口
   *    （装备 = `equipWeapon/Body/Movement/Gadget`；合成 = `fuseStack` 唯一动作），
   *    本变量不产生任何第二套数据流。旧「装备/合成」双页签删除。
   */
  let garageModal:
    | { kind: 'equip'; slot: GarageSlot; defId: string; star: number }
    | { kind: 'fuse' }
    | null = null;
  /**
   * UX-BLUESTAR-EQUIP-FUSE-SIMPLIFY-R1｜合成弹窗内当前点选的组（弹窗关闭即清空）。
   * 仅一组自动选中；写操作仍只发生在弹窗确认按钮那一次 `fuseStack`。
   */
  let fuseModalSel: { defId: string; star: number } | null = null;
  let lastEquip: { ok: boolean; reason: EquipFailure | null; detail: string } | null = null;
  /** 最近一次 Movement 装备动作的**真实**结果（成功与失败同构地存下来，探针原样报出）。 */
  let lastMovementEquip: { ok: boolean; reason: MovementEquipFailure | null; detail: string } | null = null;
  /** 最近一次 Body 装备动作的**真实**结果（成功与失败同构地存下来，探针原样报出）。 */
  let lastBodyEquip: { ok: boolean; reason: BodyEquipFailure | null; detail: string } | null = null;
  /** GADGET-GARAGE-SLOT-R2｜最近一次 Gadget 装备/卸下动作的**真实**结果（同构）。 */
  let lastGadgetEquip: { ok: boolean; reason: GadgetEquipFailure | null; detail: string } | null = null;
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
   * PRODUCT-LOOP-R8-EQUIPPED-WEAPON-REWARD-R1｜候选池改由 **`draft` 自己**回答
   * （`rewardChoiceIdsFor(draft)` = 本局的基准武器；车上没武器 / 那件武器不能跑完整 Run
   * ⇒ 空池），不再是一个固定常量。
   *
   * ⚠️ 数量读数来自**当前这份** `inv` ⇒ 与地址里 `choices` 载荷、与探针三者同源。
   * ⚠️ 必须每次重算（与 `adventureHrefNow` 绑在一起）：玩家可以「进车库 → 换武器 →
   *    回首页 → 直接点开始冒险」（**不刷新**），地址必须与屏幕上那辆车**同一次读取**产出。
   *    数量同理 —— 领奖后本页会重读库存（见下方 `claim` 段），旧快照会显示成没领到货。
   * ⚠️ **奖励池与出发装备读的是同一个 `draft`**（`adventureHrefNow()` 把它编码进
   *    `equipped`）⇒「本局用哪件武器打赢 ⇒ 发哪一件」在结构上成立，而不是靠两处协调。
   */
  const rewardSpecsNow = (): readonly RewardChoiceSpec[] =>
    growthStacks(inv, rewardChoiceIdsFor(draft), GROWTH_STAR).map((s) => ({
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
   * PRODUCT-LOOP-R4-BODY-CANONICAL-AND-GARAGE-MVP｜Body 维度的**唯一读取口径**。
   *
   * ⚠️ 页面（卡片）与探针都只调它 ⇒ 与 Weapon / Movement 区同一条「不各自算一份」的纪律。
   * ⚠️ 它**零副作用**：写只发生在 `equipBody()`（`playerLoadout` 的唯一写入口）。
   */
  function readBody(): BodyReading {
    return bodyReading(draft);
  }

  /**
   * PRODUCT-LOOP-P0-GARAGE-MOBILE-INTERACTION-R1｜**直接装备武器**（与 Movement / Body 同规则）。
   *
   * 点库存里的某一张武器卡 ⇒ 装**玩家点的那一档**（`(defId, star)` 一起给，
   * ★1 的炮与 ★2 的炮是两张卡）⇒ 立即落盘 + 同次重渲（Preview 一起刷新）。
   *
   * ⚠️ 本 Queue 必改 2 删除了「先选中 → 再点`装备`」这条两步流程：四个配置维度现在
   *    **同一条规则**（点卡即装备）。「卡片已选择但还没真正装备」这种中间态不再存在。
   * ⚠️ 写只发生在 `playerLoadout.equipWeapon()`（唯一写入口，内部过正式 `validateSnapshot`
   *    并只经那**唯一一处** `persistPlayerBuild` 落盘），本页不碰 `savePlayerBuild` /
   *    `localStorage`、不自己赋值 `functionalSelections`。
   */
  function equipWeaponAndRender(defId: string, star: number): void {
    const out = equipWeapon(defId, draft, inv, star);
    lastEquip = { ok: out.ok, reason: out.reason ?? null, detail: out.detail ?? '' };
    if (out.ok && out.draft) {
      draft = out.draft;
      // 库存不因装备而消耗；重读仍走正式 ensureInventory（幂等 → 不重复生成库存）
      inv = playerInventory(draft);
    }
    render();
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
   * PRODUCT-LOOP-R4-BODY-CANONICAL-AND-GARAGE-MVP｜**直接装备车身**（无二次确认）。
   *
   * 点车身卡 ⇒ 装那台车身。写只发生在 `playerLoadout.equipBody()`（唯一写入口，内部过
   * 正式 `validateSnapshot` 并只经那**唯一一处** `persistPlayerBuild` 落盘），本页不碰
   * `savePlayerBuild` / `localStorage`、不自己赋值 `bodyDefId`。
   *
   * ⚠️ Body 是**单一字段**：`equipBody` 只写 `draft.bodyDefId`，**绝不碰** Weapon 槽
   *    （`functionalSelections`）与 rear / front Movement（`rearWheelDefId` /
   *    `frontWheelDefId`）⇒ 换车身结构上不可能覆盖它们（Queue 必改 6）。
   */
  function equipBodyAndRender(defId: string): void {
    const out = equipBody(defId, draft);
    lastBodyEquip = { ok: out.ok, reason: out.reason ?? null, detail: out.detail ?? '' };
    if (out.ok && out.draft) {
      draft = out.draft;
      // 换车身不消耗任何东西（装备是引用）；库存与 Weapon / Movement 读数不受影响
      inv = playerInventory(draft);
    }
    render();
  }

  /**
   * GADGET-GARAGE-SLOT-R2｜**Gadget 装备 / 卸下**的唯一页面入口。
   *
   * ⚠️ 走**既有**写入口（`equipGadget` / `unequipGadget`）⇒ 库存判定、Energy 校验、
   *    落盘 / 恢复全部复用现有机制，**页面不自己算**任何一条。
   * ⚠️ `EMPTY_SLOT` 走「卸下」分支（不需要库存）—— 与选 EMPTY 卡的语义一致。
   */
  function equipGadgetAndRender(defId: string): void {
    const out = defId === EMPTY_SLOT ? unequipGadget(draft) : equipGadget(defId, draft, inv);
    lastGadgetEquip = { ok: out.ok, reason: out.reason ?? null, detail: out.detail ?? '' };
    if (out.ok && out.draft) {
      draft = out.draft;
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

    /*
      ══════════════════════════════════════════════════════════════════════════
      HOME-V2-MINIMAL-R1｜正式首页 = 产品首页（不再是大段零件参数清单）。
      只保留：层次背景 / 中央当前真实战车外观 / 【开始关卡】唯一主 CTA /
      【调整战车】次级入口。领奖 banner（claimNotice）在 header 里继续可达；
      「不可冒险」兼容提示（renderCompatNotice）继续如实出现。

      保留的产品契约（一字未动）：
        - `data-ph-action="open-garage"`（进入 Garage 视图，整页零跳转）；
        - `data-ph-action="start-run"`（可执行 = `<a href>`，地址由
          `adventureHrefNow()` 实时产出 ⇒ 与 Garage 换装同源；不可执行 =
          无 href 的 disabled 按钮 —— 结构上「点了不会创建 Run」）；
        - 新手初始化 / 领奖（`claimRunReward`，挂载时一次）→ 重读 draft/inv；
        - 探针读数（`phView` / preview / slots 读数等）不动 Garage 一字。
      删除的重复读数（同一信息 Garage 里仍可见）：耐久/能量数值行、
      「已装备部件」`<ul>`、成长行（ph-home-growth）、movement 摘要、
      底部 4 段说明文字。
      ══════════════════════════════════════════════════════════════════════════
    */

    /* ── 中央：当前真实战车外观（正式 preview 管线，零画布） ── */
    const car = el('div', 'ph-car-wrap ph-home-car');
    car.dataset['phHomeCar'] = '1';
    car.append(renderPreview(vehiclePreviewLayout(draft)));
    // 一行轻量身份（车身名）：不是参数清单，只是让「这台车」可被认出
    const carName = el('div', 'ph-home-car-name', r.bodyName);
    carName.dataset['phHomeCarName'] = '1';
    car.append(carName);
    stage.append(car);

    /* ── 行动区：主 CTA = 开始关卡；次级 = 调整战车 ── */
    const goGarage = (): void => {
      view = 'garage';
      render();
    };
    const actions = el('div', 'ph-actions ph-home-actions');
    actions.dataset['phHomeActions'] = '1';
    const compat = fullRunCompat(draft);
    if (compat.ok) {
      // `开始冒险` 是同产物内的真实相对链接；地址由 `adventureHrefNow()` 实时产出
      //（带本局 token / 奖励 id / **当前这份装备** / 回程地址）—— 与 Garage 换装同源。
      const start = el('a', 'ph-btn ph-btn-start ph-home-start', HOME_START_LABEL);
      start.href = adventureHrefNow();
      start.dataset['phAction'] = 'start-run';
      start.dataset['phRunToken'] = runToken;
      actions.append(start);
    } else {
      // 不可执行形态：**没有 href** ⇒ 无法导航、无法创建 Run（结构上成立）。
      // 保留 `data-ph-action="start-run"` + 阻断原因读数（探针同一选择器双形态）。
      const blocked = el('button', 'ph-btn ph-btn-start ph-btn-blocked ph-home-start', HOME_START_LABEL);
      blocked.type = 'button';
      blocked.disabled = true;
      blocked.dataset['phAction'] = 'start-run';
      blocked.dataset['phStartBlocked'] = '1';
      blocked.dataset['phStartBlockedReason'] = compat.reason;
      blocked.dataset['phRunToken'] = runToken;
      actions.append(blocked);
    }
    const toGarage = el('button', 'ph-btn ph-btn-garage ph-home-garage', HOME_GARAGE_LABEL);
    toGarage.type = 'button';
    toGarage.dataset['phAction'] = 'open-garage';
    toGarage.addEventListener('click', goGarage);
    actions.append(toGarage);
    if (!compat.ok) stage.append(renderCompatNotice(compat));
    stage.append(actions);
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
  function renderMovementSection(box: HTMLElement, hardpointId: string): void {
    const m = readMovement();

    for (const slot of m.slots) {
      // PRODUCT-LOOP-P0-GARAGE-MOBILE-INTERACTION-R1｜**只渲染当前分类那一个挂点**
      // （分类 Tab 就是 `front` / `rear`，与 `movementHardpoints[].id` 同名 ⇒ 无需映射表）
      if (slot.hardpointId !== hardpointId) continue;
      const row = el('div', 'ph-mv-row');
      row.dataset['phMovementRow'] = slot.hardpointId;
      row.dataset['phGarageCurrent'] = slot.hardpointId;
      row.dataset['phGarageCurrentDef'] = slot.storedDefId === null ? '' : slot.storedDefId;
      row.dataset['phMovementStored'] = slot.storedDefId === null ? '' : slot.storedDefId;
      row.dataset['phMovementEffective'] = slot.effectiveDefId ?? '';
      row.dataset['phMovementUnmounted'] = String(slot.unmounted);
      row.append(
        el('span', 'ph-mv-label', MOVEMENT_HARDPOINT_LABELS[slot.hardpointId] ?? slot.hardpointId),
        el('span', 'ph-mv-current', slot.unmounted ? GARAGE_MOVEMENT_OFF_LABEL : slot.name),
      );
      /**
       * UX-BAG-VISUAL-FUSION-R2｜**固定详情位**（Queue 必改 1）：
       *   生效轮组的必要属性（`轮径 N · 质量 N · 能耗 N`，读数层 `statsText`）
       *   画在挂点行这里 —— 卡面（下方卡阵）只留图标 + 短名称，不再每张卡都堆刻度。
       *   `data-ph-movement-detail` 供 E2E 把屏幕上那一串与 canonical 对账。
       */
      const mvDetail = m.cards.find((c) => c.defId === slot.effectiveDefId);
      if (mvDetail) {
        row.dataset['phMovementDetail'] = mvDetail.statsText;
        row.append(el('span', 'ph-mv-detail', mvDetail.statsText));
      }

      const grid = el('div', 'ph-grid ph-grid-3 ph-mv-grid');
      /** 未拥有内容的目的地（Queue 必改 4 的降级区）。 */
      const lockedGrid = el('div', 'ph-grid ph-grid-3 ph-mv-grid ph-locked-grid');
      let lockedCount = 0;
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
        // UX-BAG-VISUAL-FUSION-R2｜图标优先卡面（Queue 必改 1）：轮径圆环用真 radius
        // 定大小（见 partIcon.ts）；MVR-15 接线守卫的 ph-card-stats append 形态保留
        //（仍在卡片循环内、内容仍是读数层 c.statsText），视觉降为图标陪衬。
        card.append(partIconNode('movement', c.defId, c.name));
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
        /*
          ⚠️ PRODUCT-LOOP-P0-GARAGE-MOBILE-INTERACTION-R1（必改 3）：卡片上**只保留一种**
             与「使用中」竞争的状态词。原先这里还会给缺省轮画一个「默认」标签 ——
             它正是 Queue 点名要清掉的多套状态语义之一（配置页只保留
             使用中 / 可使用 / 未拥有）。缺省轮语义**完整保留在读数层**
             （`MovementEntry.implicit`，探针照旧可断言），只是不再画到卡面上。
        */
        if (effectiveHere) card.append(el('span', 'ph-card-tag', GARAGE_IN_USE_LABEL));
        // 未拥有 ⇒ 标 `未拥有` 且**不可点**（结构上装不上，而不是点了给个错误提示）
        if (!c.owned) {
          card.classList.add('ph-card-locked');
          card.append(el('span', 'ph-card-badge ph-card-badge-max', GARAGE_LOCKED_LABEL));
          card.disabled = true;
      } else {
        /**
         * UX-BLUESTAR-EQUIP-FUSE-SIMPLIFY-R1（必改 2）：点卡打开对比确认弹窗
         * （轮组对应当前选中的前/后轮槽；【替换】才调 `equipMovementAndRender`）。
         */
        card.addEventListener('click', () => {
          garageModal = { kind: 'equip', slot: slot.hardpointId as GarageSlot, defId: c.defId, star: 1 };
          render();
        });
      }
        cell.append(card);
        // 必改 4：**可用内容进主卡阵，未拥有内容进降级区**（不与可用内容同权重）
        if (c.owned) grid.append(cell);
        else {
          lockedGrid.append(cell);
          lockedCount += 1;
        }
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
      if (slot.unmounted) offCard.append(el('span', 'ph-card-tag', GARAGE_IN_USE_LABEL));
      // UX-BLUESTAR-EQUIP-FUSE-SIMPLIFY-R1（必改 2）：「未装载」也走对比确认弹窗（卸下 = 装备空槽）。
      offCard.addEventListener('click', () => {
        garageModal = { kind: 'equip', slot: slot.hardpointId as GarageSlot, defId: EMPTY_SLOT, star: 1 };
        render();
      });
      offCell.append(offCard);
      grid.append(offCell);

      row.append(grid);
      if (lockedCount > 0) row.append(lockedSection(lockedGrid, lockedCount));
      box.append(row);
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
      box.append(msg);
    }
  }

  /**
   * PRODUCT-LOOP-R4-BODY-CANONICAL-AND-GARAGE-MVP｜**Garage 里的 Body 配置区**。
   *
   * ── 它接进的是既有的哪一套 ────────────────────────────────────────────────
   * 布局 / 卡片 / 装备交互**复用 Movement 区那一套**，但**更简单**（Body 是单一字段，
   * 不需要按挂点分行）：一个 `<span>` 标题 + 一条 `.ph-grid` 卡阵（与轮组区同一个类）。
   * 每张**已拥有**卡是 `.ph-card`，**点击即直接装备**（无二次确认、无独立「装备」按钮）。
   * 没有新增页面、没有新增视图、没有换布局语言。
   *
   * ── 三个「只画什么」的硬边界 ───────────────────────────────────────────────
   *   ① **只画 canonical Body**（`readBody().cards` 来自 `OFFICIAL_BODIES` ∩ `registry.bodies`），
   *      不新增任何车身类型；
   *   ② 未拥有（`owned === false`）的卡**如实画出但不可点**、标 `未拥有`
   *      —— **不提供**解锁 / 购买 / 进度 / 经济（Queue 禁止清单）；
   *   ③ 旧 4 台恒默认拥有（`implicit`）**照常展示、照常可装备**。
   *
   * ── 卡片上只展示真实 canonical 核心属性（必改 4）──────────────────────────
   *   耐久 / 质量 / 能量容量 三个数全部现读自 `BodyEntry`（→ `registry.bodies`），
   *   不编造任何推导 / 评级 / 百分比标签。
   */
  function renderBodySection(box: HTMLElement): void {
    const b = readBody();

    // 「当前使用中」一行（必改 3：当前状态一眼可见，四类分类共用同一句话术）
    const cur = el('div', 'ph-current ph-garage-current');
    cur.dataset['phGarageCurrent'] = 'body';
    cur.dataset['phGarageCurrentDef'] = b.bodyDefId;
    const inUse = b.cards.find((c) => c.defId === b.bodyDefId);
    cur.append(
      el('span', 'ph-current-label', GARAGE_IN_USE_LEAD),
      el('span', 'ph-current-name', inUse ? inUse.name : b.bodyDefId),
    );
    /**
     * UX-BAG-VISUAL-FUSION-R2｜必要属性（耐久/质量/能量容量，`bodyEntries()` 的 statsText）
     * 移到**固定详情位**（当前装备行）—— 卡面只留图标 + 短名称 + 装备中。
     */
    cur.dataset['phCurrentDetail'] = inUse?.statsText ?? '';
    if (inUse) cur.append(el('span', 'ph-current-detail', inUse.statsText));
    box.append(cur);

    const grid = el('div', 'ph-grid ph-grid-3 ph-body-grid');
    /** 未拥有内容的目的地（Queue 必改 4 的降级区）。 */
    const lockedGrid = el('div', 'ph-grid ph-grid-3 ph-body-grid ph-locked-grid');
    let lockedCount = 0;
    for (const c of b.cards) {
      const cell = el('div', 'ph-card-cell');
      const card = el('button', 'ph-card ph-card-body');
      card.type = 'button';
      card.dataset['phBody'] = c.defId;
      card.dataset['phBodyOwned'] = String(c.owned);
      card.dataset['phBodyImplicit'] = String(c.implicit);
      card.dataset['phBodyHp'] = String(c.hp);
      card.dataset['phBodyMass'] = String(c.baseMass);
      card.dataset['phBodyEnergy'] = String(c.energyCapacity);
      /*
        PRODUCT-LOOP-R4-BODY-CARD-READABILITY｜这一行是**玩家能直接读**的车身差异
        （`耐久 1100 · 质量 120 · 能量容量 110`），取自 canonical Body Def。
        ⚠️ 单独再挂一个 `data-ph-body-stats` 是为了让 E2E 能把**屏幕上那一串**
           （而不是探针里的另一个字段）与 canonical 值逐字对账 —— 探针与 DOM 各自取证。
      */
      card.dataset['phBodyStats'] = c.statsText;

      const equippedHere = b.bodyDefId === c.defId;
      card.dataset['phBodyEquipped'] = String(equippedHere);
      if (equippedHere) card.classList.add('ph-card-equipped');
      /**
       * UX-BAG-VISUAL-FUSION-R2｜**图标优先的卡面**（Queue 必改 1）：
       *   图形（真 Sprite / 按 canonical collider 画的简化矢量，见 `partIcon.ts`）
       *   + 短名称 + 装备中。卡内不再堆完整刻度行 —— 必要属性移到**固定详情位**
       *   （上方当前装备行，`ph-current-detail`），卡上只留 `data-ph-body-stats`
       *   探针（E2E 逐字对账的读数通道不变，只是不再画成长/数值文字堆叠）。
       * ⚠️ BG-15 接线守卫的 `card.append(el('span','ph-card-stats', …))` 形态保留：
       *    刻度行仍在卡片循环内 append，只是视觉降为图标下的短名称陪衬（卡面排版
       *    由 CSS 决定：图标在上、名称其次）。文字内容仍是读数层 `c.statsText`。
       */
      card.append(partIconNode('body', c.defId, c.name));
      card.append(el('span', 'ph-card-name', c.name));
      card.append(el('span', 'ph-card-stats', c.statsText));
      /*
        ⚠️ PRODUCT-LOOP-P0-GARAGE-MOBILE-INTERACTION-R1（必改 3）：与 Movement 卡同一条纪律 ——
           卡片上只出现一种与「使用中」竞争的状态词。`implicit`（旧 4 台恒默认拥有）
           语义仍保留在读数层与 `data-ph-body-implicit` 上，只是不再画「默认」标签。
      */
      if (equippedHere) card.append(el('span', 'ph-card-tag', GARAGE_IN_USE_LABEL));
      // 未拥有 ⇒ 标 `未拥有` 且**不可点**（结构上装不上，而不是点了给个错误提示）
      if (!c.owned) {
        card.classList.add('ph-card-locked');
        card.append(el('span', 'ph-card-badge ph-card-badge-max', GARAGE_LOCKED_LABEL));
        card.disabled = true;
      } else {
        // UX-BLUESTAR-EQUIP-FUSE-SIMPLIFY-R1（必改 2）：点卡打开对比确认弹窗（【替换】才写）。
        card.addEventListener('click', () => {
          garageModal = { kind: 'equip', slot: 'body', defId: c.defId, star: 1 };
          render();
        });
      }
      cell.append(card);
      // 必改 4：**可用内容进主卡阵，未拥有内容进降级区**（不与可用内容同权重）
      if (c.owned) grid.append(cell);
      else {
        lockedGrid.append(cell);
        lockedCount += 1;
      }
    }
    box.append(grid);
    if (lockedCount > 0) box.append(lockedSection(lockedGrid, lockedCount));

    if (lastBodyEquip) {
      const msg = el(
        'p',
        lastBodyEquip.ok ? 'ph-note ph-note-ok' : 'ph-note ph-note-bad',
        lastBodyEquip.ok
          ? '已装备车身并写入正式玩家 Build 存档。'
          : `车身装备被拒绝（${String(lastBodyEquip.reason)}）：${lastBodyEquip.detail}`,
      );
      msg.dataset['phBodyMsg'] = lastBodyEquip.ok ? 'ok' : 'fail';
      box.append(msg);
    }
  }

  /**
   * GADGET-GARAGE-SLOT-R2｜**Garage 里的 Gadget 配置区**。
   *
   * ── 它接进的是既有的哪一套（与 Body 区完全同构）──────────────────────────
   * 布局 / 卡片 / 装备交互**复用 Body 区那一套**：一个「当前使用中」行 +
   * 一条 `.ph-grid` 卡阵；点**已拥有**卡即直接装备（无二次确认、无独立按钮）。
   * ⚠️ 没有新增页面、没有新增视图、没有换布局语言、没有第二套 CSS 类。
   *
   * ── 三个「只画什么」的硬边界 ───────────────────────────────────────────────
   *   ① 只画 `gadgetEntries()`（= EMPTY + 推进器 + 反推器；白名单在读数层）；
   *   ② 未拥有（`owned === false`）的卡**如实画出但不可点**、标 `未拥有`
   *      —— **不提供**解锁 / 购买 / 进度 / 经济（Queue 禁止清单）；
   *   ③ EMPTY 卡恒可选（它是「什么都不装」，不是一件部件 ⇒ 不需要库存）。
   *
   * ⚠️ 卡片刻度只有**能量**一个数（取自 `GadgetEntry.energy`，= 正式内容
   *    `FunctionalPartDef.energy`），不编造任何推导描述。
   */
  function renderGadgetSection(box: HTMLElement): void {
    const r = read();

    const cur = el('div', 'ph-current ph-garage-current');
    cur.dataset['phGarageCurrent'] = 'gadget';
    cur.dataset['phGarageCurrentDef'] = r.equippedGadgetId;
    cur.append(
      el('span', 'ph-current-label', GARAGE_IN_USE_LEAD),
      el('span', 'ph-current-name', r.equippedGadgetName),
    );
    box.append(cur);

    const grid = el('div', 'ph-grid ph-grid-3 ph-gadget-grid');
    /** 未拥有内容的降级区（与 Body 区同一套 `lockedSection`）。 */
    const lockedGrid = el('div', 'ph-grid ph-grid-3 ph-gadget-grid ph-locked-grid');
    let lockedCount = 0;
    for (const g of r.gadgets) {
      const cell = el('div', 'ph-card-cell');
      const card = el('button', 'ph-card ph-card-gadget');
      card.type = 'button';
      card.dataset['phGadget'] = g.defId;
      card.dataset['phGadgetOwned'] = String(g.owned);
      card.dataset['phGadgetEnergy'] = String(g.energy);
      card.dataset['phGadgetEmpty'] = String(g.empty);

      const equippedHere = r.equippedGadgetId === g.defId;
      card.dataset['phGadgetEquipped'] = String(equippedHere);
      if (equippedHere) card.classList.add('ph-card-equipped');
      // UX-BAG-VISUAL-FUSION-R2｜图标优先卡面（Queue 必改 1）：Gadget 走 weapon 家族
      // 矢量图（thruster / reverseThruster 各自可辨；EMPTY 走通用件兜底）。
      if (!g.empty) card.append(partIconNode('gadget', g.defId, g.name));
      card.append(el('span', 'ph-card-name', g.name));
      // 能量刻度行：EMPTY 显示「无消耗」，其余显示真实 energy（读数层给的）
      card.append(
        el('span', 'ph-card-stats', g.empty ? `${GARAGE_GADGET_NO_COST_LABEL}` : `${GARAGE_GADGET_ENERGY_LABEL} ${g.energy}`),
      );
      if (equippedHere) card.append(el('span', 'ph-card-tag', GARAGE_IN_USE_LABEL));
      if (!g.owned) {
        // 未拥有 ⇒ 标 `未拥有` 且**不可点**（结构上装不上，而不是点了给个错误提示）
        card.classList.add('ph-card-locked');
        card.append(el('span', 'ph-card-badge ph-card-badge-max', GARAGE_LOCKED_LABEL));
        card.disabled = true;
      } else {
        // UX-BLUESTAR-EQUIP-FUSE-SIMPLIFY-R1（必改 2）：点卡打开对比确认弹窗（【替换】才写；
        // EMPTY = 「无 Gadget」这项也可经弹窗【替换】= 卸下，语义与旧直接装备一致）。
        card.addEventListener('click', () => {
          garageModal = { kind: 'equip', slot: 'gadget', defId: g.defId, star: 1 };
          render();
        });
      }
      cell.append(card);
      if (g.owned) grid.append(cell);
      else {
        lockedGrid.append(cell);
        lockedCount += 1;
      }
    }
    box.append(grid);
    if (lockedCount > 0) box.append(lockedSection(lockedGrid, lockedCount));

    if (lastGadgetEquip) {
      const msg = el(
        'p',
        lastGadgetEquip.ok ? 'ph-note ph-note-ok' : 'ph-note ph-note-bad',
        lastGadgetEquip.ok
          ? '已装备辅助装置并写入正式玩家 Build 存档。'
          : `辅助装置装备被拒绝（${String(lastGadgetEquip.reason)}）：${lastGadgetEquip.detail}`,
      );
      msg.dataset['phGadgetMsg'] = lastGadgetEquip.ok ? 'ok' : 'fail';
      box.append(msg);
    }
  }

  /**
   * 未拥有内容的**降级区**（Queue 必改 4：折叠 / 降级，不与可用内容同权重）。
   *
   * 用原生 `<details>`：零 JS 交互、零新入口、零商城 / 解锁 / 经济系统。
   * ⚠️ 折叠**只是视觉降级**：卡片仍在 DOM 里（只是不可见）⇒ 未拥有卡的
   *    `data-ph-*-owned="false"` 与 `disabled` 属性照旧可被读（探针 / E2E 不受影响）。
   */
  function lockedSection(grid: HTMLElement, count: number): HTMLElement {
    const det = el('details', 'ph-locked');
    det.dataset['phLocked'] = String(count);
    det.append(
      el('summary', 'ph-locked-summary', `${GARAGE_LOCKED_LABEL} · ${count}`),
      grid,
    );
    return det;
  }

  /**
   * Weapon 分类（Queue 必改 2）｜**点已拥有卡即装备**。
   *
   * ⚠️ 这里删掉了 R2-B 起的「先选中一张卡 → 再点底部`装备`按钮」两步流程：
   *    四个配置维度现在**同一条规则**，而「卡片已选择但还没真正装备」这种中间态
   *    在结构上不再存在（`selected` 状态与 `[data-ph-action="equip"]` 按钮一并移除）。
   *    装备的是**玩家点的那一档**（`(defId, star)`，★1 的炮与 ★2 的炮是两张卡）。
   */
  function renderWeaponTab(box: HTMLElement, r: LoadoutReading): void {
    const cur = el('div', 'ph-current ph-garage-current');
    cur.dataset['phCurrent'] = r.equippedWeaponId;
    cur.dataset['phGarageCurrent'] = 'weapon';
    cur.dataset['phGarageCurrentDef'] = r.equippedWeaponId;
    cur.append(
      el('span', 'ph-current-label', GARAGE_IN_USE_LEAD),
      el('span', 'ph-current-name', r.equippedWeaponName),
    );
    /**
     * UX-BAG-VISUAL-FUSION-R2｜**必要属性移到固定详情位**（当前装备行）：
     *   卡面只保留「图标 + 短名称 + 星级 + 真实数量 + 装备中」（ Queue 必改 1），
     *   攻击成长（`攻击 120 → 150`，唯一真源 = `weaponEntries().damageText`）改在这里展示
     *   —— 玩家点哪张卡（= 装备哪件）就在这唯一位置看到它的必要属性。
     */
    const equippedStack = r.weapons.find(
      (w) => w.defId === r.equippedWeaponId && w.star === r.equippedWeaponStar,
    );
    cur.dataset['phCurrentDetail'] = equippedStack?.damageText ?? '';
    if (equippedStack && equippedStack.damageText !== '') {
      cur.append(el('span', 'ph-current-detail', equippedStack.damageText));
    }
    box.append(cur);

    /**
     * PRODUCT-LOOP-P0｜**Garage 必须能识别「当前可冒险状态」**（Queue 必改 3）。
     *
     * 必改 3 的三条边界，逐条落地：
     *   - **所有**武器**仍然允许拥有 / 查看 / 装备**（本页一个字都没改装备流程，
     *     也没有从库存里删任何东西 —— 卡照画、按钮照点、`equipWeapon` 照旧放行）；
     *   - 但装完之后，玩家在**这里**就能看到「这辆车的当前装备跑不了完整冒险」，
     *     不必等回到首页撞上不可用的按钮；
     *   - 回到首页时「开始冒险」进入**不可执行**状态（见 `renderHome` 的守门），
     *     并给出「需要更换支持完整 Run 的武器」的明确提示。
     *
     * ⚠️ PRODUCT-LOOP-R6：上面第二 / 第三条**只在真的不支持时**成立。改前判据是
     *    「不是 cannon ⇒ 不支持」，所以 `Spear / Hammer` 恒落在这一支；R6 起判据是
     *    「第一件武器的 behavior Runtime 存不存在」⇒ 8 件登记武器（含 Hammer）在这里
     *    读到的是 `ok` / 「当前装备可以出发」，只有 `spear` 这一类还落在不支持支。
     *    本段**只看 `fullRunCompat`**，没有自己的第二套口径。
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
    box.append(runStatus);

    box.append(el('h2', 'ph-sec', `拥有的 Weapon（${r.weapons.length}）`));
    if (r.weapons.length === 0) {
      box.append(el('p', 'ph-note', '库存里没有可装备的武器。'));
    }
    // UX-BAG-FUSION-GRID-R1：武器区同样 3 列紧凑网格（点格即装备语义不变，卡片探针全保留）。
    const grid = el('div', 'ph-grid ph-grid-3');
    for (const w of r.weapons) {
      const equippedHere = w.defId === r.equippedWeaponId && w.star === r.equippedWeaponStar;
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
      /**
       * UX-BAG-VISUAL-FUSION-R2｜**图标优先的紧凑卡面**（Queue 必改 1）：
       *   图形（真 Sprite / 简化矢量，见 `partIcon.ts`）+ 短名称 + 星级 + 真实数量 + 装备中。
       *   卡内**不再堆**成长行 / 预计数值 / 能量（必要属性在固定详情位 = 上方当前装备行）。
       * ⚠️ 全部 `data-ph-*` 探针原样保留（E2E / 守卫照旧可取证，不伪绿）。
       */
      card.append(
        partIconNode('weapon', w.defId, `${w.name} ★${w.star}`),
        el('span', 'ph-card-name', w.name),
        el('span', 'ph-card-star', `★${w.star}`),
        el('span', 'ph-card-count', w.stackText),
      );
      if (w.fusable) card.append(el('span', 'ph-card-badge', GARAGE_FUSE_READY_LABEL));
      if (w.maxStar) card.append(el('span', 'ph-card-badge ph-card-badge-max', GARAGE_MAX_STAR_LABEL));
      if (equippedHere) card.append(el('span', 'ph-card-tag', GARAGE_IN_USE_LABEL));
      /**
       * UX-BLUESTAR-EQUIP-FUSE-SIMPLIFY-R1（必改 2）：点卡**不再立即写装备** ——
       * 打开「当前装备 / 新装备」对比确认弹窗；【替换】才调 `equipWeaponAndRender`（既有唯一写入口）。
       */
      card.addEventListener('click', () => {
        garageModal = { kind: 'equip', slot: 'weapon', defId: w.defId, star: w.star };
        render();
      });
      cell.append(card);

      grid.append(cell);
    }
    box.append(grid);

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
      box.append(msg);
    }

    if (lastEquip) {
      const msg = el(
        'p',
        lastEquip.ok ? 'ph-note ph-note-ok' : 'ph-note ph-note-bad',
        lastEquip.ok ? '已装备并写入正式玩家 Build 存档。' : `装备被拒绝（${lastEquip.reason}）：${lastEquip.detail}`,
      );
      msg.dataset['phEquipMsg'] = lastEquip.ok ? 'ok' : 'fail';
      box.append(msg);
    }
  }

  /**
   * ══════════════════════════════════════════════════════════════════════════════
   * PRODUCT-LOOP-P0-GARAGE-FOUR-SLOT-CLARITY-R3｜**四个同构装备槽的配车页**
   * ══════════════════════════════════════════════════════════════════════════════
   *
   * 本轮的真人录屏结论（Queue 逐字）：代码里有 4 个槽，但玩家看到的是
   * **「上面一个独立的 Weapon 悬浮块 + 下面 3 个像页签的「后轮 / 车身 / 前轮」按钮」**
   * ⇒ 认知变成「3 个页签 + 1 个不知道是什么的武器块」，而不是「4 个同等级装备槽」。
   * **上一版「槽位跟随真实挂点坐标」的设计假设判定失败**，不再围绕 anchor 微调。
   *
   * ── 结构骨架（DOM 层就固定住）────────────────────────────────────────────────
   * ```
   * .ph-main.ph-main-garage        ← 整页 overflow:hidden（本页整体不滚）
   *   .ph-header                   ← 标题 / 返回首页（返回恒可达）
   *   .ph-garage-stage             ← 战车 Preview（**固定**）
   *   .ph-garage-current           ← 「当前装备」+ 2×2 装备槽（**固定**）
   *   .ph-my-parts                 ← 「选择〈槽位名〉装备」（固定）
   *   .ph-garage-body              ← **唯一**滚动容器：当前槽的部件卡阵
   *   .ph-garage-foot              ← 合成入口（持续可见 + **恒可点**）
   * ```
   * ⚠️ 「固定」是**结构保证**（兄弟节点里只有中间那个 `overflow-y:auto`），
   *    不是「滚回去看一眼」⇒ 「点卡 → Preview 同次变化」在**当前屏幕内**成立。
   *
   * ── 2×2 版面（`GARAGE_SLOT_ORDER` 就是 DOM 顺序）─────────────────────────────
   * ```
   * [ 武器 ] [ 车身 ]
   * [ 后轮 ] [ 前轮 ]
   * ```
   *   四个槽走**同一个** `.ph-slotnode` 构造分支、同一个 `1fr 1fr` grid
   *   ⇒ 同尺寸 / 同结构 / 同交互 / 同选中态是**版面保证**（不是靠人工对齐）。
   *
   * ── 槽位 → 配置字段（一一对应，没有第二张映射表）─────────────────────────────
   *   `weapon` → `functionalSelections[WEAPON_SLOT]` / `body` → `bodyDefId` /
   *   `front` → `frontWheelDefId` / `rear` → `rearWheelDefId`。
   *   四者各自有**唯一写入口**（`equipWeapon` / `equipBody` / `equipMovement`）
   *   ⇒ 「换一个槽位不会覆盖另一个槽位」是结构性的，不靠人工核对。
   *
   * ── 预览的职责被收敛（Queue 必改 4）──────────────────────────────────────────
   *   Preview **只**回答「我换了东西以后，车发生了什么变化」。
   *   Front / Rear 的认知由**明确槽名**（`选择前轮装备`）+ **Preview 实际变化**共同建立，
   *   ⚠️ **不再**由「槽位贴到挂点坐标上」承担 ⇒ 本函数已不再读 `vehicleSlotAnchors()`，
   *      也不再把槽位绝对定位到车体上（R2 的 `data-ph-slot-dx` / `GARAGE_SLOT_MAX_DX` 全删）。
   *
   * ── 硬边界（Queue 冻结清单）────────────────────────────────────────────────
   *   不新增第 5 个槽（**没有** Gadget 等未来空槽）、不改任何数值 / 部件 / 库存 / Seed /
   *   Reward / Fusion 规则 / Star 规则 / Battle / Physics / Camera / Product Run / Economy、
   *   不做商城 / 教程 / 属性评分 / 推荐 / 红绿对比、不做拖拽；**只有部件卡阵内部滚动**。
   */
  function renderGarage(r: LoadoutReading): void {
    renderHeader(GARAGE_TITLE);
    /* ---- 顶部：返回（恒可达）。Queue 结构 = 「顶部：标题 / 返回」 ---- */
    const back = el('button', 'ph-back', GARAGE_BACK_LABEL);
    back.type = 'button';
    back.dataset['phAction'] = 'back-home';
    back.addEventListener('click', () => {
      view = 'home';
      render();
    });
    header.append(back);

    /* ---- UX-BLUESTAR-EQUIP-FUSE-SIMPLIFY-R1：单一背包主视图（删双页签） ---- */

    /* ---- 中上（固定）：战车 Preview。⚠️ 槽位**已经不在它里面**（R3 删除挂点定位） ---- */
    const stageBox = el('div', 'ph-garage-stage');
    stageBox.dataset['phGarageStage'] = '1';
    const car = el('div', 'ph-car-wrap ph-car-wrap-sm');
    car.append(renderPreview(vehiclePreviewLayout(draft)));
    stageBox.append(car);
    stage.append(stageBox);

    /* ---- 中上（固定）：「当前装备」+ 4 个**完全同构**的装备槽（2×2） ---- */
    const current = el('div', 'ph-garage-current');
    current.dataset['phGarageCurrent'] = '1';
    current.append(el('span', 'ph-garage-current-label', GARAGE_CURRENT_LABEL));
    const slots = el('div', 'ph-garage-slots');
    slots.dataset['phGarageSlots'] = '1';
    const mv = readMovement();
    /*
      ⚠️ 四个槽走**同一个**构造分支：没有 `if (slot === 'weapon')` 这种分支，
         也没有 `-above` / `-below` 之类的专属 modifier ⇒ 「同尺寸 / 同结构 / 同交互 /
         同选中态」是版面保证，而不是四个各自排版后再人工对齐。
      ⚠️ 槽位坐标由 **CSS grid** 决定；这里**不**写任何 `style.left` / `style.top`
         （R2 的挂点定位已按 Queue 删除）。
    */
    for (const slot of GARAGE_SLOT_ORDER) {
      const btn = el('button', 'ph-slotnode');
      // GADGET-GARAGE-SLOT-R2：Gadget 槽**只**多一个「跨满整行」的 modifier
      //（CSS 的 grid-column）⇒ 它与其它四槽共用同一个 `.ph-slotnode` 规则，
      // 尺寸 / 结构 / 交互 / 选中态完全一致，只是独占第三行。
      if (slot === 'gadget') btn.classList.add('ph-slotnode-gadget');
      btn.type = 'button';
      btn.dataset['phSlot'] = slot;
      btn.dataset['phSlotActive'] = String(slot === garageSlot);
      btn.dataset['phSlotDef'] = garageSlotDefId(slot, r, mv);
      if (slot === garageSlot) btn.classList.add('ph-slotnode-active');
      btn.append(
        el('span', 'ph-slotnode-label', GARAGE_SLOT_LABELS[slot]),
        el('span', 'ph-slotnode-value', garageSlotValue(slot, r, mv)),
      );
      btn.addEventListener('click', () => {
        if (garageSlot === slot) return;
        // 纯视图切换：不写任何存档、不碰 draft / inv ⇒ 切槽位不可能改变配置
        garageSlot = slot;
        render();
      });
      slots.append(btn);
    }
    current.append(slots);
    stage.append(current);

    /* ---- 中下：「选择〈槽位名〉装备」—— 只列**当前槽**兼容的部件（标题固定，卡片阵滚动） ---- */
    const myParts = el('div', 'ph-my-parts');
    myParts.dataset['phMyParts'] = garageSlot;
    myParts.append(el('span', 'ph-my-parts-title', garageSlotTitle(garageSlot)));
    stage.append(myParts);

    const body = el('div', 'ph-garage-body');
    body.dataset['phGarageBody'] = garageSlot;
    if (garageSlot === 'weapon') renderWeaponTab(body, r);
    else if (garageSlot === 'body') renderBodySection(body);
    else if (garageSlot === 'gadget') renderGadgetSection(body);
    else renderMovementSection(body, garageSlot);
    stage.append(body);

    /*
      UX-BLUESTAR-EQUIP-FUSE-SIMPLIFY-R1（必改 1）：**【合成】独立按钮**（背包主视图唯一合成入口）。
      - 只有存在 `fusable === true`（= `canFuseStack` 同判据：count>=5 且未满星）的合法组
        才亮红点 + 数量（`ph-fuse-btn-ready`）；没有合法组时普通「合成」二字照旧画出、
        点开弹窗明确说「没有可合成的武器」—— 从不 disabled（必改 5 语义延续）。
      - 点击 → 打开图腾式合成弹窗（`garageModal = {kind:'fuse'}`），不在主视图陈列星级/材料。
    */
    const fuseReadyCount = r.weapons.filter((w) => w.fusable).length;
    const fuseBtn = el('button', 'ph-fuse-btn' + (fuseReadyCount > 0 ? ' ph-fuse-btn-ready' : ''));
    fuseBtn.type = 'button';
    fuseBtn.dataset['phAction'] = 'fuse-entry';
    fuseBtn.dataset['phFuseReadyCount'] = String(fuseReadyCount);
    fuseBtn.append(
      el('span', 'ph-fuse-btn-label', GARAGE_FUSE_ENTRY_LABEL),
      ...(fuseReadyCount > 0 ? [el('span', 'ph-fuse-btn-badge', String(fuseReadyCount))] : []),
    );
    fuseBtn.addEventListener('click', () => {
      garageModal = { kind: 'fuse' };
      render();
    });
    stage.append(fuseBtn);

    /*
      UX-BLUESTAR-EQUIP-FUSE-SIMPLIFY-R1：弹窗调度（对比确认 / 图腾合成）。
      ⚠️ 弹窗画在 Garage 渲染**之后**（覆盖层，不属于五段骨架）；打开时主视图仍完整在
      DOM 里 ⇒ E2E 可同时取证「弹窗内容」与「背后网格」。
    */
    if (garageModal?.kind === 'equip') renderEquipConfirmModal(r);
    else if (garageModal?.kind === 'fuse') renderFuseModal(r);
  }

  /** 槽位上「当前装的是哪一件」的 defId（`''` = 该槽没有可读 defId）。 */
  function garageSlotDefId(slot: GarageSlot, r: LoadoutReading, mv: MovementReading): string {
    if (slot === 'weapon') return r.equippedWeaponId;
    if (slot === 'body') return r.bodyDefId;
    // GADGET-GARAGE-SLOT-R2：Gadget 走**独立字段**，与 Movement 的读法分开
    if (slot === 'gadget') return r.equippedGadgetId;
    const s = mv.slots.find((x) => x.hardpointId === slot);
    return s ? (s.effectiveDefId ?? '') : '';
  }

  /** 槽位上显示的**当前装备名**（读数层给的，页面不自己拼）。 */
  function garageSlotValue(slot: GarageSlot, r: LoadoutReading, mv: MovementReading): string {
    if (slot === 'weapon') return r.equippedWeaponId === EMPTY_SLOT ? GARAGE_MOVEMENT_OFF_LABEL : r.equippedWeaponName;
    if (slot === 'body') return r.bodyName;
    // GADGET-GARAGE-SLOT-R2：EMPTY 读数层已给「无」，页面不另写一份空槽字面量
    if (slot === 'gadget') return r.equippedGadgetName;
    const s = mv.slots.find((x) => x.hardpointId === slot);
    if (!s) return GARAGE_MOVEMENT_OFF_LABEL;
    return s.unmounted ? GARAGE_MOVEMENT_OFF_LABEL : s.name;
  }

  /* ════════════════════════════════════════════════════════════════════════
   * UX-BLUESTAR-EQUIP-FUSE-SIMPLIFY-R1｜**两个 Garage 弹窗**（对比确认 / 图腾合成）。
   * ════════════════════════════════════════════════════════════════════════ */

  /**
   * 弹窗骨架（覆盖层）：遮罩点击 = 关闭（零写盘）；`data-ph-modal` = 弹窗类型探针。
   * ⚠️ 只做视图：关闭/打开都不写任何存档；写动作只在两个弹窗各自的确认按钮里。
   */
  function modalShell(kind: 'equip' | 'fuse'): { wrap: HTMLElement; card: HTMLElement } {
    const wrap = el('div', 'ph-modal');
    wrap.dataset['phModal'] = kind;
    const card = el('div', 'ph-modal-card');
    const mask = el('div', 'ph-modal-mask');
    mask.addEventListener('click', () => {
      garageModal = null;
      render();
    });
    wrap.append(mask, card);
    stage.append(wrap);
    return { wrap, card };
  }

  /** 弹窗里的「部件图形 + 名称（+ 星级）」一列。 */
  function modalPartFigure(
    kind: 'weapon' | 'body' | 'movement' | 'gadget',
    defId: string,
    name: string,
    star: number | null,
  ): HTMLElement {
    const fig = el('div', 'ph-modal-fig');
    if (defId !== EMPTY_SLOT) fig.append(partIconNode(kind, defId, name));
    else fig.append(el('span', 'ph-modal-fig-empty', '—'));
    const cap = el('span', 'ph-modal-fig-name', name);
    if (star !== null) cap.textContent = `${name} ★${star}`;
    fig.append(cap);
    return fig;
  }

  /**
   * UX-BLUESTAR-EQUIP-FUSE-SIMPLIFY-R1（必改 2）｜**「当前装备 / 新装备」对比确认弹窗**。
   *
   *   - 只展示**真实可计算**的属性对比（全部来自读数层，页面零自算）：
   *     Weapon = 攻击（damage）+ 能量（energyInUse）；Body = 耐久/质量/能量容量；
   *     Movement = 轮径/质量/能耗；Gadget = 能量。变化用 `ph-cmp-up/down` 着色
   *     （↑↓ 是**真实数值差**的方向，不是评价）；无法比较的只显示名称/图形（不虚构战力）。
   *   - 【取消】= 关弹窗，**零写盘**；【替换】/ 空槽【装备】= 调既有 `equip*AndRender`
   *     **一次**（唯一写入口）→ 弹窗自动关闭、预览同次刷新。
   *   - 合法性失败（`equip*` 返回 not-ok）由页面已有的 `ph-note-bad` 消息如实展示，
   *     装配保持原样（写入口内部已保证）—— 弹窗不假装成功。
   */
  function renderEquipConfirmModal(r: LoadoutReading): void {
    const m = garageModal;
    if (!m || m.kind !== 'equip') return;
    const { card } = modalShell('equip');
    card.dataset['phModalSlot'] = m.slot;
    card.dataset['phModalDef'] = m.defId;

    const mv = readMovement();
    const b = readBody();
    const isOff = m.defId === EMPTY_SLOT;

    // —— 新装备候选读数（每类从各自读数层取；EMPTY 特判）——
    type CmpRow = { label: string; cur: number | null; next: number | null };
    const cand: {
      name: string;
      iconKind: 'weapon' | 'body' | 'movement' | 'gadget';
      rows: readonly CmpRow[] | null;
    } = (() => {
      if (m.slot === 'weapon') {
        const w = r.weapons.find((x) => x.defId === m.defId && x.star === m.star);
        return {
          name: w?.name ?? m.defId,
          iconKind: 'weapon',
          rows: w
            ? [
                { label: '攻击', cur: null, next: w.damage },
                { label: '能量', cur: null, next: w.energyInUse },
              ]
            : null,
        };
      }
      if (m.slot === 'body') {
        const c = b.cards.find((x) => x.defId === m.defId);
        return {
          name: c?.name ?? m.defId,
          iconKind: 'body',
          rows: c
            ? [
                { label: '耐久', cur: null, next: c.hp },
                { label: '质量', cur: null, next: c.baseMass },
                { label: '能量容量', cur: null, next: c.energyCapacity },
              ]
            : null,
        };
      }
      if (m.slot === 'gadget') {
        const g = r.gadgets.find((x) => x.defId === m.defId);
        return {
          name: g?.name ?? m.defId,
          iconKind: 'gadget',
          rows: g && !g.empty ? [{ label: '能量', cur: null, next: g.energy }] : null,
        };
      }
      const c = mv.cards.find((x) => x.defId === m.defId);
      return {
        name: c?.name ?? m.defId,
        iconKind: 'movement',
        rows: c
          ? [
              { label: '轮径', cur: null, next: c.radius },
              { label: '质量', cur: null, next: c.mass },
              { label: '能耗', cur: null, next: c.energy },
            ]
          : null,
      };
    })();

    // —— 当前装备读数（同一槽位的生效件；EMPTY = 无）——
    const curDefId = garageSlotDefId(m.slot, r, mv);
    const cur: { name: string; iconKind: 'weapon' | 'body' | 'movement' | 'gadget'; star: number | null; rows: (number | null)[] } = (() => {
      if (m.slot === 'weapon') {
        const w = r.weapons.find((x) => x.defId === curDefId && x.star === r.equippedWeaponStar);
        return {
          name: curDefId === EMPTY_SLOT ? GARAGE_MOVEMENT_OFF_LABEL : r.equippedWeaponName,
          iconKind: 'weapon',
          star: curDefId === EMPTY_SLOT ? null : r.equippedWeaponStar,
          rows: w ? [w.damage, w.energyInUse] : [null, null],
        };
      }
      if (m.slot === 'body') {
        const c = b.cards.find((x) => x.defId === curDefId);
        return { name: r.bodyName, iconKind: 'body', star: null, rows: c ? [c.hp, c.baseMass, c.energyCapacity] : [null, null, null] };
      }
      if (m.slot === 'gadget') {
        const g = r.gadgets.find((x) => x.defId === curDefId);
        return {
          name: r.equippedGadgetName,
          iconKind: 'gadget',
          star: null,
          rows: g && !g.empty ? [g.energy] : [null],
        };
      }
      const c = mv.cards.find((x) => x.defId === curDefId);
      return {
        name: garageSlotValue(m.slot, r, mv),
        iconKind: 'movement',
        star: null,
        rows: c ? [c.radius, c.mass, c.energy] : [null, null, null],
      };
    })();

    card.append(el('span', 'ph-modal-title', isOff ? '卸下确认' : '装备确认'));

    // —— 对比两列（当前 | 新）——
    const cmp = el('div', 'ph-modal-cmp');
    cmp.dataset['phModalCmp'] = '1';
    const curCol = el('div', 'ph-modal-col');
    curCol.dataset['phModalCol'] = 'current';
    curCol.append(el('span', 'ph-modal-col-label', '当前装备'));
    curCol.append(modalPartFigure(cur.iconKind, curDefId, cur.name, cur.star));
    const newCol = el('div', 'ph-modal-col');
    newCol.dataset['phModalCol'] = 'new';
    newCol.dataset['phModalNewDef'] = m.defId;
    newCol.append(el('span', 'ph-modal-col-label', isOff ? '卸下后' : '新装备'));
    newCol.append(
      modalPartFigure(cand.iconKind, m.defId, cand.name, m.slot === 'weapon' && !isOff ? m.star : null),
    );
    cmp.append(curCol, newCol);
    card.append(cmp);

    // —— 属性行（真实数值 + 方向着色；无法比较 = 只显示名称，不虚构）——
    if (cand.rows) {
      const rowsBox = el('div', 'ph-modal-rows');
      rowsBox.dataset['phModalRows'] = '1';
      cand.rows.forEach((row, i) => {
        const line = el('div', 'ph-modal-row');
        line.dataset['phModalRow'] = row.label;
        line.append(el('span', 'ph-modal-row-label', row.label));
        const cVal = cur.rows[i] ?? null;
        const nVal = row.next;
        if (cVal === null || nVal === null || cVal === nVal) {
          // 无法比较（空槽/查无此件）或数值相同：如实显示，不上色
          line.append(el('span', 'ph-modal-row-val', `${fmtVal(cVal)} → ${fmtVal(nVal)}`));
        } else {
          const up = nVal > cVal;
          const dir = el('span', `ph-modal-row-val ${up ? 'ph-cmp-up' : 'ph-cmp-down'}`, `${fmtVal(cVal)} → ${fmtVal(nVal)} ${up ? '↑' : '↓'}`);
          dir.dataset['phModalDelta'] = up ? 'up' : 'down';
          line.append(dir);
        }
        rowsBox.append(line);
      });
      card.append(rowsBox);
    }

    // —— 动作行：【取消】零写盘 + 【替换/装备】唯一写入口 ——
    const actions = el('div', 'ph-modal-actions');
    const cancel = el('button', 'ph-modal-btn', '取消');
    cancel.type = 'button';
    cancel.dataset['phAction'] = 'modal-cancel';
    cancel.addEventListener('click', () => {
      garageModal = null;
      render();
    });
    const go = el('button', 'ph-modal-btn ph-modal-btn-primary', isOff ? '卸下' : curDefId === EMPTY_SLOT ? '装备' : '替换');
    go.type = 'button';
    go.dataset['phAction'] = 'modal-replace';
    go.dataset['phModalDef'] = m.defId;
    go.dataset['phModalStar'] = String(m.star);
    go.addEventListener('click', () => {
      garageModal = null;
      if (m.slot === 'weapon') equipWeaponAndRender(m.defId, m.star);
      else if (m.slot === 'body') equipBodyAndRender(m.defId);
      else if (m.slot === 'gadget') equipGadgetAndRender(m.defId);
      else equipMovementAndRender(m.slot, m.defId);
    });
    actions.append(cancel, go);
    card.append(actions);
  }

  /** 数值显示（`null` → `—`；整数直接显示）。 */
  function fmtVal(v: number | null): string {
    return v === null ? '—' : String(Math.round(v * 10) / 10);
  }

  /**
   * UX-BLUESTAR-EQUIP-FUSE-SIMPLIFY-R1（必改 3）｜**图腾式合成弹窗**。
   *
   *   - **只列** `fusable === true`（= `canFuseStack` 同判据：count>=5 且未满星）的组：
     每组 = 武器图形 + 短名称 + `★N → ★N+1` + 5 枚材料缩略图（min(count,5) 个满格）；
   *   - **不画** ★1..★5 切换栏、**不显示** 4/5、1/5 等不可合成组、**无常驻 5 槽台**；
   *   - 仅一组自动选中；多组点选（`data-ph-fuse-option`）；底部唯一【合成】确认
   *     —— 点击只对选中组调 `fuseStack` **一次 5→1**（不批量消耗其它组）；
   *   - 成功即时刷新（合成后重读 `inv/draft`，红点/装备星级同次更新）；失败如实说明。
   */
  function renderFuseModal(r: LoadoutReading): void {
    const { card } = modalShell('fuse');
    card.dataset['phModalKind'] = 'fuse';

    const groups = r.weapons.filter((w) => w.fusable);
    card.append(el('span', 'ph-modal-title', '合成'));

    if (groups.length === 0) {
      card.append(el('p', 'ph-modal-empty', '还没有可合成的武器：同类同星武器集满 5 件才能合成。'));
      const actions = el('div', 'ph-modal-actions');
      const close = el('button', 'ph-modal-btn', '知道了');
      close.type = 'button';
      close.dataset['phAction'] = 'modal-cancel';
      close.addEventListener('click', () => {
        garageModal = null;
        render();
      });
      actions.append(close);
      card.append(actions);
      return;
    }

    // —— 选中状态：单组自动选中；多组保持上次选择（仍合法）或默认第一组 ——
    if (fuseModalSel === null || !groups.some((w) => w.defId === fuseModalSel!.defId && w.star === fuseModalSel!.star)) {
      fuseModalSel = { defId: groups[0]!.defId, star: groups[0]!.star };
    }
    const sel = fuseModalSel!;

    // —— 可合成组列表（点选）——
    const list = el('div', 'ph-fuse-list');
    list.dataset['phFuseList'] = '1';
    for (const w of groups) {
      const selectedHere = sel.defId === w.defId && sel.star === w.star;
      const opt = el('button', 'ph-fuse-option' + (selectedHere ? ' ph-fuse-option-active' : ''));
      opt.type = 'button';
      opt.dataset['phFuseOption'] = w.defId;
      opt.dataset['phFuseOptionStar'] = String(w.star);
      opt.dataset['phFuseOptionSelected'] = String(selectedHere);
      const head = el('div', 'ph-fuse-option-head');
      head.append(
        partIconNode('weapon', w.defId, `${w.name} ★${w.star}`),
        el('span', 'ph-fuse-option-name', w.name),
        el('span', 'ph-fuse-option-star', `★${w.star} → ★${w.star + 1}`),
      );
      const mats = el('div', 'ph-fuse-option-mats');
      mats.dataset['phFuseMats'] = '1';
      for (let i = 0; i < FUSE_STACK; i++) {
        const cell = el('span', 'ph-fuse-mat' + (i < Math.min(w.count, FUSE_STACK) ? ' ph-fuse-mat-filled' : ''));
        cell.dataset['phFuseMat'] = String(i);
        if (i < Math.min(w.count, FUSE_STACK)) cell.append(partIconNode('weapon', w.defId, w.name));
        mats.append(cell);
      }
      opt.append(head, mats);
      opt.addEventListener('click', () => {
        fuseModalSel = { defId: w.defId, star: w.star };
        render();
      });
      list.append(opt);
    }
    card.append(list);

    // —— 底部唯一【合成】确认（只对选中组调一次 fuseStack）——
    const selEntry = groups.find((w) => w.defId === sel.defId && w.star === sel.star)!;
    const actions = el('div', 'ph-modal-actions');
    const cancel = el('button', 'ph-modal-btn', '取消');
    cancel.type = 'button';
    cancel.dataset['phAction'] = 'modal-cancel';
    cancel.addEventListener('click', () => {
      garageModal = null;
      fuseModalSel = null;
      render();
    });
    const go = el('button', 'ph-modal-btn ph-modal-btn-primary', GARAGE_FUSE_LABEL);
    go.type = 'button';
    go.dataset['phAction'] = 'fuse';
    go.dataset['phFuseDef'] = sel.defId;
    go.dataset['phFuseStar'] = String(sel.star);
    go.dataset['phFuseCount'] = String(selEntry.count);
    go.addEventListener('click', () => {
      const res: FusionResult = fuseStack(inv, sel.defId, sel.star, draft);
      lastFuse = res.ok
        ? { ok: true, reason: null, partId: res.partId, fromStar: res.fromStar, toStar: res.toStar, countAfter: res.countAfter, productCount: res.productCount, equippedUpgraded: res.equippedUpgraded, detail: '' }
        : { ok: false, reason: res.reason, partId: sel.defId, fromStar: sel.star, toStar: null, countAfter: null, productCount: null, equippedUpgraded: false, detail: res.detail };
      if (res.ok) {
        inv = res.inventory;
        draft = res.draft;
      }
      // 合成后重开弹窗：剩余组实时可见（红点/库存同次刷新）；无剩余组则回主视图。
      const rest = read().weapons.filter((w) => w.fusable);
      garageModal = rest.length > 0 ? { kind: 'fuse' } : null;
      fuseModalSel = null;
      render();
    });
    actions.append(cancel, go);
    card.append(actions);
  }

  function render(): void {
    screen.dataset['phView'] = view;
    /**
     * ⚠️ PRODUCT-LOOP-P0-GARAGE-MOBILE-INTERACTION-R1｜Garage 用**另一套滚动契约**：
     * 首页是「整页滚动」，Garage 是「固定骨架 + 只有卡片区内部滚动」（`overflow:hidden`）。
     * 这个类就是两者唯一的开关 —— 结构与样式都挂在它上面，不靠行内样式。
     */
    stage.classList.toggle('ph-main-garage', view === 'garage');
    stage.replaceChildren();
    const r = read();
    if (view === 'home') renderHome(r);
    else renderGarage(r);
  }

  render();

  /* -------------------------------------------------------------- 句柄 */

  /**
   * UX-BLUESTAR-EQUIP-FUSE-SIMPLIFY-R1｜背包主视图的【合成】独立按钮是否**真的可见**。
   * 判据三条同时成立：元素存在 + 真实布局面积 > 0 + 未被 `display` / `visibility` 藏掉
   * ⇒ 「可见」不是靠源码里写了这个元素，而是浏览器现场量出来的。
   */
  function fuseEntryVisibleNow(): boolean {
    // 双页签已删除；入口 = 主视图【合成】独立按钮（`data-ph-action="fuse-entry"`）。
    const n = stage.querySelector<HTMLElement>('[data-ph-action="fuse-entry"]');
    if (!n) return false;
    const rect = n.getBoundingClientRect();
    const cs = window.getComputedStyle(n);
    return rect.width > 0 && rect.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden';
  }

  /**
   * 【合成】按钮是否**被禁用**（恒为 `false`：没有合法组也照常可点开弹窗、弹窗里明确说没有）。
   * ⚠️ 「无条件可进入」必须是**查得到的事实**：读元素自身的 `disabled` 属性，
   *    没有元素按「不可进入」处理（返回 `true`）⇒ 入口被删掉不会假绿。
   */
  function fuseEntryDisabledNow(): boolean {
    const n = stage.querySelector<HTMLButtonElement>('[data-ph-action="fuse-entry"]');
    return n ? n.disabled === true : true;
  }

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
          /**
           * PRODUCT-LOOP-R4-BODY-CANONICAL-AND-GARAGE-MVP｜本次挂载的**一次性 Body 种子**读数。
           * 直接取成长会话的判定结果（页面 / 探针不各自再判一次）。
           */
          bodySeedApplied: growth.bodySeed.applied,
          bodySeedReason: growth.bodySeed.reason,
          bodySeedDecided: growth.bodySeed.decided,
          bodySeedRaised: growth.bodySeed.raised,
          /*
           * PRODUCT-LOOP-R5-BASIC-CONTENT-POOL-R1｜本次挂载的**一次性正式内容池种子**读数。
           * 直接取成长会话的判定结果（页面 / 探针不各自再判一次）。
           */
          contentPoolSeedApplied: growth.contentPoolSeed.applied,
          contentPoolSeedReason: growth.contentPoolSeed.reason,
          contentPoolSeedDecided: growth.contentPoolSeed.decided,
          contentPoolSeedRaisedBodies: growth.contentPoolSeed.raisedBodies,
          contentPoolSeedRaisedParts: growth.contentPoolSeed.raisedParts,
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
        /**
         * ══════════════════════════════════════════════════════════════════════
         * PRODUCT-LOOP-P0-GARAGE-FOUR-SLOT-CLARITY-R3｜Garage 的**当前高亮装备槽**。
         * ⚠️ 原来这里的 `selectedWeaponId` / `selectedWeaponStar` / `equipEnabled`
         *    三个字段已随「先选后装备」两步流程一并删除。
         * ══════════════════════════════════════════════════════════════════════
         */
        garageSlot,
        /**
         * R3 验收 3｜当前槽 → 卡片区标题（**读页面真实画出来的那个节点**，
         * 不是重算一遍函数）⇒ 「槽位高亮」与「下方标题」不可能各说各话。
         */
        garageSlotTitle:
          stage.querySelector('.ph-my-parts-title')?.textContent ?? '',
        /**
         * ⚠️ 运行时读数：页面上**真的画出来**几个装备槽（恒 4）。
         * 与固定顺序常量一起构成「4 个真实槽、没有第 5 个空槽」的双证。
         */
        garageSlotCount: stage.querySelectorAll('[data-ph-slot]').length,
        /**
         * ⚠️ 硬证据：页面上**不存在**独立的「装备」二次确认按钮。
         *    探针直接数 DOM ⇒ 「已删除」不是靠源码里没写，而是**运行时真的数不到**。
         */
        garageEquipButtonCount: stage.querySelectorAll('[data-ph-action="equip"]').length,
        /**
         * ⚠️ 必改 2 的运行时硬证据：整个 Garage 里**没有任何可拖拽元素**
         *    （`[draggable="true"]` 恒 0）⇒ 「不提供拖拽装备」可被直接断言。
         */
        garageDraggableCount: stage.querySelectorAll('[draggable="true"]').length,
        /**
         * 必改 4 的三条读数（同一份 DOM）：入口是否可见 / 可合成组数 / 是否处于可感知态。
         */
        garageFuseEntryVisible: fuseEntryVisibleNow(),
        garageFuseReadyCount: r.weapons.filter((w) => w.fusable).length,
        // UX-BLUESTAR-EQUIP-FUSE-SIMPLIFY-R1：「可感知态」= 按钮带红点数量徽标（真实可合成组存在）。
        garageFuseEntryReady:
          stage.querySelector('[data-ph-action="fuse-entry"]')?.classList.contains('ph-fuse-btn-ready') === true,
        /**
         * R3 验收 8｜入口**从未** disabled（Queue 必改 5：无条件可进入）。
         */
        garageFuseEntryDisabled: fuseEntryDisabledNow(),
        // UX-BLUESTAR-EQUIP-FUSE-SIMPLIFY-R1：弹窗读数（类型 + 逐条真实内容，E2E 逐字对账）。
        garageModal: garageModal?.kind ?? null,
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
        /**
         * PRODUCT-LOOP-R4-BODY-CANONICAL-AND-GARAGE-MVP｜Body 维度读数（与 Garage 卡片同源）。
         * 直接取 `readBody()`（= `playerLoadout.bodyReading(draft)`），页面不自行推导。
         */
        body: (() => {
          const b = readBody();
          return {
            bodyDefId: b.bodyDefId,
            cards: b.cards.map((c) => ({
              defId: c.defId,
              name: c.name,
              hp: c.hp,
              baseMass: c.baseMass,
              energyCapacity: c.energyCapacity,
              statsText: c.statsText,
              owned: c.owned,
              implicit: c.implicit,
              equipped: c.equipped,
            })),
            available: [...b.available],
            ownedDefIds: [...b.ownedDefIds],
            equippedDefIds: [...b.equippedDefIds],
            legal: b.legal,
          };
        })(),
        lastMovementEquip: lastMovementEquip
          ? { ok: lastMovementEquip.ok, reason: lastMovementEquip.reason }
          : null,
        lastBodyEquip: lastBodyEquip
          ? { ok: lastBodyEquip.ok, reason: lastBodyEquip.reason }
          : null,
        // GADGET-GARAGE-SLOT-R2｜Gadget 装备动作读数 + 当前选中项（E2E 可断言）
        lastGadgetEquip: lastGadgetEquip
          ? { ok: lastGadgetEquip.ok, reason: lastGadgetEquip.reason }
          : null,
        equippedGadgetId: r.equippedGadgetId,
        equippedGadgetName: r.equippedGadgetName,
        gadgets: r.gadgets.map((g) => ({
          defId: g.defId,
          name: g.name,
          energy: g.energy,
          empty: g.empty,
          owned: g.owned,
        })),
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
