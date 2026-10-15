# GARAGE-V2-QUALITY-FOUNDATION-R1｜存量模型审计（必改 1 · 全部 file:line 实证）

> 日期：2026-10-15 · 基线 HEAD `56aa253` · 审计方式 = 逐文件读源码，零推断。
> 结论先行：**四类部件的拥有模型分四套**；旧堆叠 → 逐件投影可用**只读适配**完成（不必改公共 core）；
> **7 档品质 ≠ 旧 5 档星级**（战斗倍率只到 ★5）⇒ 本 Foundation 按.Queue 停止条款**只接数据层、不接正式 Run 战斗**。

## A. 拥有权模型（四套，逐类）

| 类别 | 存储 key | 模型 | 数量 | 星级/成长 | 证据 |
|---|---|---|---|---|---|
| **Functional（weapon+gadget）** | `strongfruit.ownedParts.v2`（`partInventory.ts:114`） | `{[defId]: {one,two,three?,four?,five?}}` 堆叠计数（`PartStack`，:68-77） | 有（每档计数） | ★1..★5（`INVENTORY_MAX_STAR=5`，:90；`starKey` :98 夹取） | `normalizeInventory` :139 只保留 OFFICIAL_PARTS+MOVEMENTS 键 |
| **Movement（轮组）** | **同一个** `ownedParts.v2` | 同 PartStack，但**只用 `one` 档**（`MOVEMENT_STAR=1`，movementInventory.ts:49；`getCount(inv, m.defId, MOVEMENT_STAR)` :135） | 有（恒 ★1 计数） | **无成长**（two..five 恒 0） | `OFFICIAL_MOVEMENTS = ['smallWheel','largeWheel','heavyWheel']`（partInventory.ts:49）；`wheelStd` **不进库存**恒 implicit 拥有（:47 注释、runMovementCanonical.ts:66-68） |
| **Body（车身）** | `strongfruit.ownedBodies.v1`（`bodyOwnership.ts:50`） | **id 数组**（`loadOwnedBodies` :56-74，只记 NEW_OFFICIAL_BODIES 4 台） | **无数量**（拥有即 1，不可堆叠） | **无星级概念** | 旧 4 台 `DEFAULT_OWNED_BODIES`（:27-34）恒拥有不落盘（`isBodyOwned` :86-90）；`grantBody` :98 幂等 |
| **Gadget** | `ownedParts.v2`（与 weapon 同池） | 同 PartStack，**只用 `one` 档**（`equipGadget` 查 `getCount(inv, defId, 1)`，playerLoadout.ts:932） | 有（★1 计数） | 无成长（gadget 无 fusion 入口） | Gadget 家族 = `thruster`/`reverseThruster`（content.ts:585/673 category:'gadget'） |

**关键差异结论**：
- A1. Functional 是唯一有真实多档星级的类；Movement/Gadget/Body 都是「单档拥有」。
- A2. Body 与其它三类**不同 key、不同形状（数组 vs 计数表）**⇒ 统一实例模型必须**投影**两个 key，不能只读一个。
- A3. `normalizeInventory`（partInventory.ts:139-151）会**丢弃非 OFFICIAL 键** ⇒ 任何新数据**不能**塞进 ownedParts.v2（会被静默清洗）——这正好支撑「新模型用独立 key」的设计。

## B. 装备引用（BuildDraft → Snapshot）

| 维度 | BuildDraft 字段 | 装备保护判据 | 证据 |
|---|---|---|---|
| Weapon | `functionalSelections[WEAPON_SLOT='frontMass']` + `functionalStars[hardpointId]`（buildEditorModel.ts:76/87） | `equippedStackKey(draft)`（playerGrowth.ts:277-287）= `(partId, star)` 对 | `equipWeapon` :1042 落盘前过 `validateSnapshot` |
| Body | `bodyDefId`（:62） | `draft.bodyDefId === defId`（bodyInventory.ts:96） | `equipBody` 过 validateSnapshot |
| Movement | `rearWheelDefId?` / `frontWheelDefId?`（:73-74）**两个独立字段 = 两个独立槽位** | `MOVEMENT_DRAFT_KEY`（playerLoadout.ts:1105-1108）rear/front 各自映射 | snapshot 里 movements 固定生成 rear/front 两条（buildEditorModel.ts:154-157） |
| Gadget | `gadgetDefId?`（:103）独立维度 | `r.equippedGadgetId`（playerLoadout.ts） | `buildSnapshotFromDraft` :186-189 gadget 平行字段 |

**前/后轮同类性裁定（Queue 必改 3 要求明确报告）**：
- `MovementHardpointDef`（types.ts:40-44）**无 kind 限制**；`wheelStd/smallWheel/largeWheel/heavyWheel` 全部 `kind:'wheel'`（WheelDef，types.ts:108-146；`MovementDef = WheelDef` :148）。
- 正式契约里 rear/front 是**两个独立挂点、接受任意 wheel def**（`equipMovement('rear'|'front', 任意 canonical movement)`，canEquipMovement 只查 owned）；同一 defId **可以同时装在 rear 和 front**（两个独立 draft 字段，互不排斥）。
- ⇒ **裁定：前/后轮是同一类 Movement 的两个不同槽位**。品质五合一的「同部位」判据对 Movement = `kind==='wheel'`（唯一正式 kind），**不区分 rear/front**；但「装备保护」必须按**槽位**检查（rear 与 front 各自的 defId 都可能指向被消耗的实例）。

## C. 星级倍率与 5 档上限（战斗侧真源）

- `starTierEnergy(base, star)`：`STAR_TIER_ENERGY_MULT = 1.1`（buildSnapshot.ts:44/56-59，star≤1 恒等）。
- `starTierDamage(base, star)`：`STAR_DAMAGE_STEP = 0.25`、`STAR_DAMAGE_MAX_STAR = 5`（:47/53/68-78；★2..★5 = 1.25/1.5/1.75/2.0，**★6+ 一律夹回 ★5**）。
- `productGrowth.GROWTH_MAX_STAR = INVENTORY_MAX_STAR`（playerGrowth.ts:659）= 5；`FUSE_STACK = 5`（:177）。
- `BuildSnapshot.quality: number`（types.ts:202）**存在但战斗侧零消费**（`grep quality src/battle/ src/game/` = 0 命中；buildEditorModel.ts:183 恒写 1）。
- `functionalStars` 只进 Weapon 槽（buildSnapshotFromDraft :174-177 只对 functionals 注入 star；**movements/gadget/body 无星级通道**）。

**⇒ 7 档品质 vs 旧 5 档的硬差异（Queue 必改 4 的判定）**：
1. 战斗倍率曲线只定义到 ★5（夹取在 :70）；白→彩 7 档中「紫/橙/红/彩」4 档若映射到 star>5，**战斗读数会被夹平**——「外观彩色、战斗仍按★5」正是 Queue 明令禁止假闭环的形态。
2. Body/Movement/Gadget **根本没有星级通道**（no `functionalStars` 注入、resolveSnapshot 无对应合并），7 档对它们的战斗含义=0——**需要重新设计生成与战斗倍率**（Queue 停止条款命中）。
3. ⇒ **本 Foundation 的品质模型只作为「库存/合成层数据」存在；不接正式 Run Snapshot 的战斗数值**；Run 侧桥接方案（缺口与最小兼容路径）写入 §E，等设计决策。

## D. 领奖 / 种子 / 保存版本（迁移与幂等的既有机制）

| 机制 | 证据 | 与本 Queue 的关系 |
|---|---|---|
| 版本信封 | `CURRENT_SAVE_VERSION = 1`、`STAMP_KEY='__v'`（saveVersion.ts:21/24）；`stampVersion`/`readJsonWithVersion`/`migrateLegacy`（:36-75） | 新 key 复用 `stampVersion`（r5 模式），**不抬全局版本号**（旧 key 零改动） |
| 旧 v1→v2 迁移 | `loadInventoryRaw`（partInventory.ts:154-179）：v2 优先；v1 数组→逐 id ★1×1 后 `saveInventory` | 幂等先例：迁移=「读旧→写新（同 key）→打标记」；本 Queue 的迁移是「读旧 key → 写**新独立 key**」，旧 key 永不重写 |
| 一次性种子模式 | `r5ContentPoolSeed.ts`：独立 key + `readXxx/isXxxDone/markXxx`（:278-314）+ `applyR5ContentPoolSeed` 纯函数（:338）；**先落盘后打标记**（:303-306 顺序警告） | 新实例账本迁移/重建按同一四段式：判定→执行→落盘→打标记 |
| 领奖 | `claimRunReward`（playerProfile.ts:166+）：幂等 token→`addPart(inv, defId, 1, 1)`→`saveInventory` | 领奖仍写旧堆叠 key ⇒ 实例账本必须在**读取时**与堆叠对账（见 §E 投影），不能假设账本先于领奖存在 |
| 装备原子性先例 | `fuseStack`（playerGrowth.ts:757-833）：预检→consume→add→装备升星→**失败回滚**（:800-812 `equip-failed` 分支恢复库存）→单次 `saveInventory`（:821） | 新五合一事务复用同一模式：全部变更先在内存对象上做，装备引用校验失败即回滚，成功才一次落盘 |

## E. 投影/桥接设计判定（必改 2 的「适配优先」）

**判定：只读适配足够，不改公共 core。**理由：
1. 旧堆叠里**不存在实例身份**（`(defId,star)→count`）；逐件投影只能是**确定性枚举**（同 defId+star 的 N 件 → instanceId `q1:<defId>:<star>:<ordinal>`，ordinal 按 defId 在 OFFICIAL 列表序 + star 升序分配）。投影是纯函数 ⇒ 旧数据永远是真源，无复制/丢件可能（验收 1 的结构性保证）。
2. 新账本 key 只存「**消耗/合成产生的偏差**」（哪些实例已被品质五合一消耗、产出挂在哪个新品质档），不复制全量库存 ⇒ 不覆盖 `ownedParts.v2`/`ownedBodies.v1`（Queue 明令），且不需要双向同步。
3. 已装备保护：投影时给「当前 BuildDraft 引用的 (defId,star) 所对应的全部实例」打 `equipped` 标（Weapon 按 (partId,star)；Body 按 defId；Movement 按 rear/front 两个 defId；Gadget 按 defId）——装备是引用而非实例，因此**同 stack 的未装备副本与装备副本在旧模型里不可区分** ⇒ 装备保护采用「**stack 级保护**」：主件若是已装备 (defId,star) 的成员，消耗任意该 stack 副本都合法（装备引用是 (defId,star)，不是实例），但**合成产物的引用升星走既有 equip 路径校验**。

## F. 「可消耗单件材料」可行性结论（必改 1 的逐类答案）

| 类别 | 能否成为可消耗单件材料 | 前提/缺口 |
|---|---|---|
| Weapon | ✅ 完全可行 | 堆叠有数量、有 (defId,star)；实例投影 + 品质档映射即可；装备保护走 stack 级 + fuseStack 同款回滚 |
| Movement | ✅ 可行（单档） | 只有 ★1 档；实例=每次 `addPart(one,+1)` 的抽象件；**前后轮同类**（§B 裁定），同部位=kind:wheel |
| Gadget | ✅ 可行（单档） | 同 Movement；`equipGadget` 查 ★1 计数（playerLoadout.ts:932） |
| Body | ⚠️ 需谨慎 | **无数量模型**（拥有即永久解锁，不可消耗）；若参与「五合一」，消耗的其实是「解锁权」——与「车身不可弃」的既有产品语义冲突；本 Foundation **不为 Body 开品质消耗**（列入缺口 §E），只把 Body 纳入实例投影（只读展示） |

## G. 最小兼容方案 / 缺口（停止条款的正式报告，等设计决策）

1. **战斗强度映射缺口**：7 档品质 → 旧 star 倍率只有 5 档可用。最小兼容方案（下一轮拍板，本轮**不实现**）：
   - 方案 α：品质只驱动**库存与合成层**；装备时把品质**降维映射**到现有 star 1..5（白=1、绿=2、蓝=3、紫=4、橙=5，红/彩=5+专属外观），战斗零改动——成本最低但红/彩无独立强度。
   - 方案 β：扩展 `STAR_DAMAGE_MAX_STAR` 与倍率曲线到 7 档——**动正式战斗数值**，属 Queue 明令禁止项，必须独立设计 Queue。
   - 方案 γ：品质加成走新增独立字段（非 star），resolveSnapshot 增加品质合并——同样动战斗，需独立 Queue。
2. **Body 品质消耗缺口**：Body 无数量模型，「5 台车身合 1 台」需要新的 Body 生成/退坑规则（§F），本轮不做。
3. **Run 奖励与品质**：`claimRunReward` 只发 ★1 武器（playerProfile.ts）；品质物品的产出途径（Run 掉品质件？）属产品决策，本轮不发。

---

## 附：审计复验补充（实现后回读）

- `playerLoadout.PART_OPTIONS` import（审计时为预存红 PL-26）经复核为**合法只读真源复用**
  （`gadgetDefs()` = PART_OPTIONS ∩ registry category，playerLoadout.ts:721）⇒ 本 Queue 登记
  进 PL-26 白名单（tests/productLoopHomeGarage.test.ts）——**登记非放宽**；
- 同守卫发现第二个**潜在红**：`homePage.ts` 的 `./partIcon` import（UX-BAG-VISUAL-FUSION-R2
  commit 22a15d1 引入但漏登记，被 playerLoadout 红遮蔽）⇒ 同步登记。PL-26 现 35/35 全绿；
- 本 Queue 后全量 vitest：18 failed = 基线 19 − PL-26（唯一差异，diff 逐字核对），零新增红。
