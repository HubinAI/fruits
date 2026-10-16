# GARAGE-V2-LEDGER-COHERENCE-R1｜账本一致性修实 + B 队列（GARAGE-V2-INVENTORY-UI-R1）接入契约

> 本 Queue 修实 Foundation（`0a5485b`）审查发现的三类一致性问题，并给出
> **GARAGE-V2-INVENTORY-UI-R1（下一条逐件背包 UI）可安全接入的边界与 API**。

## 1. 三类一致性问题的证伪/确认与修法（Queue 必改 1/2）

| # | 问题（Queue 陈述） | 审计结论 | 修法 |
|---|---|---|---|
| ① | 非尾号 ID 消费，实际消失的是尾号 | **确认**（旧 `remaining = count − consumed` 截断尾部） | 账本 v2：`consumedIds`（具体实例 id 集合）+ `synced` 标记；投影按 id 跳过——点名 :2 只消失 :2（COH R1a） |
| ② | 新领奖重用/复活已耗 ID | **确认**（v1 只记数量，计数对冲后旧 id 复活） | `highWatermark`（每 (defId,star) 已分配最大序号）+ 投影跳过 `consumedIds` ⇒ 新件永远拿新序号；已耗实例再提交 → `unknown-instance`（fuse 内查重，R2a/R2b） |
| ③ | 双账本：合成只写账本，旧系统仍可重复使用；`equippedUpgraded` 只是布尔 | **确认** | **写桥**：fuse 成功路径把本次新消耗 delta **同步扣进 `ownedParts.v2`**（单调递减、精确守恒，QV-33 逐档验证）；Weapon 装备档被合空 ⇒ **真实落盘** `savePlayerBuild`（`functionalStars.frontMass` 持久化，R3b）；Movement/Gadget 装备中最后一件 ⇒ 仍拒绝零副作用 |
| ④ | 旧 star2..5 无声降为初始白 | **确认** | `lockedReason='legacy-star-locked'`（`legacyStar>1` 一律不可消耗），等品质↔星级映射设计决策（R4a） |

**版本兼容**：账本 v1（数量）读入自动升级为 v2 形状（前 N 序号视为已耗 + 高水位 N，`synced=false`）——旧账本不丢、语义不变。

## 2. 统一读口（Queue 必改 3）

```ts
import {
  effectiveInventory,   // ★ B UI 的唯一库存读口
  projectItemInstances, // 逐件实例投影（背包格子）
  equipQualityProduct,  // 品质产物装备尝试（当前显式拒绝）
  fuseQualityFive,      // 唯一合成写入口
} from './garageV2Quality';

// COH 定案：fuse 写桥已把消耗同步扣进 ownedParts.v2 ⇒
// raw == effective（双账本从根上消除，旧 Garage/Run 与 V2 同口径）。
const eff = effectiveInventory(draft);          // = playerInventory(draft)（保留语义封装）
const items = projectItemInstances(eff, draft); // 逐件格
```

- `effectiveInventory` 保留为 B/C UI 的**唯一读入口**（当前实现 = `playerInventory`；
  将来若引入「不同步账本条目」可在此叠加扣减，调用方零改动）；
- **未接正式 Run 的显式阻断**：`equipQualityProduct('qv2:…')` → `{ok:false, reason:'run-not-wired'}`
  —— 品质产物**不可装备/出战**，正式存档零改动；`equippedUpgraded` 现在伴随真实
  `playerBuild.v1` 落盘（不再是布尔冒充）。

## 3. 下一条 GARAGE-V2-INVENTORY-UI-R1 可实施范围

**可安全接入**（数据契约已闭环）：
- B 背包逐件格：读 `projectItemInstances(effectiveInventory(draft), draft)`；
  `consumable=false` + `lockedReason`（`legacy-star-locked` / `body-not-consumable` /
  `max-quality`）直接映射置灰文案；
- C 合成弹窗：候选分组（同 slot+quality ≥5）+ `fuseQualityFive` 唯一写入口；
  失败零写盘（含已耗实例复用拒绝）、成功后 `projectItemInstances` 直接反映新产物；
- 装备校验：`equippedStackRefs(draft)` 判「装备中的 stack」；Weapon 装备档合空由
  Foundation 自动真实落盘升星（UI 无需处理）。

**禁止接入**（无设计拍板）：
- 品质产物上正式战车 / 出战（`equipQualityProduct` 会拒绝；不要绕过）；
- 旧 ★2..★5 实例的任何消耗（`legacy-star-locked`）；
- 7 档品质 ↔ 战斗强度映射（三方案 α/β/γ 仍待决策，见 `G2-AUDIT.md §G`）；
- Body 品质消耗（无数量模型）。

**仍欠的正式 Run 兼容映射**：与上一轮相同（§G 未变化）——本 Queue 未触碰战斗侧。

## 4. 测试索引

- RED→GREEN：`tests/garageV2LedgerCoherence.test.ts`（8/8：R1a 非尾号、R2a 高水位、
  R2b 复用拒绝、R3a 有效读数、R3b 装备真实落盘、R3c 旧系统不可复用、R3d run-not-wired、
  R4a legacy-star-locked）；
- Foundation 契约升级：`tests/garageV2QualityFoundation.test.ts`（22/22，QV-03/20/30/33
  判据随 v2 账本/写桥契约同步，变更记录在测试内非放宽）。
