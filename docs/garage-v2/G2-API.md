# GARAGE-V2-QUALITY-FOUNDATION-R1｜Foundation API 契约（B/C UI Queue 调用入口）

> 本文档是 **Queue A（本 Queue）交付给下一条 Garage UI Queue（B：背包逐件格 / C：合成弹窗）**
> 的**唯一调用契约**。所有 API 都在 `src/product/garageV2Quality.ts`，全部纯逻辑 /
> 只读投影（合成事务是唯一的写入口，且只写自己的账本 key）。

## 1. 模块导入

```ts
import {
  // 品质
  QUALITY_TIERS, QUALITY_LABELS, QUALITY_BASE,
  isMaxQuality, nextQuality, qualityRank,
  // 部位
  slotKindOf, itemDisplayName,
  // 投影（B 队列：逐件材料格）
  projectItemInstances, equippedStackRefs,
  type ItemInstance, type ItemSlotKind, type QualityTier,
  // 事务（C 队列：合成弹窗）
  fuseQualityFive, loadGarageV2Ledger, resetGarageV2LedgerForTest,
  type QualityFuseInput, type QualityFuseResult, type QualityFuseFailure,
} from './garageV2Quality';
```

## 2. B 队列（背包逐件格）调用形态

```ts
// 读：每件材料一格（无堆叠数量/名字/星级 —— 模型已把旧堆叠投影成逐件）
const inv = playerInventory(draft);                       // 旧堆叠真源（playerLoadout）
const items: readonly ItemInstance[] = projectItemInstances(inv, draft);
for (const it of items) {
  it.instanceId;   // 'q1:cannon:1:1'（旧件）| 'qv2:cannon:green:1'（品质产物）— 格子 key
  it.defId;        // 装备/图标走 partIconNode
  it.name;         // 目录名（零字面量）
  it.slot;         // 'weapon'|'movement'|'gadget'|'body'
  it.quality;      // 'white'..（品质框色直接映射 QUALITY_LABELS）
  it.consumable;   // false + lockedReason 时格子置灰：'equipped'|'body-not-consumable'|'max-quality'
}
```

- **旧件品质恒 white**（旧模型无品质信息，如实投影——不是「七种框色假装支持」）；
- 装备保护是 **stack 级**（装备引用是 `(defId,star)` 不是实例）：同 stack 副本可消耗；
  「是否属于装备中的 stack」UI 自行用 `equippedStackRefs(draft)` 标注弱提示；
- Body 每台 = 1 件、`consumable=false`（审计 §F：Body 无数量模型，本 Foundation 不开消耗）。

## 3. C 队列（合成弹窗）调用形态

```ts
// 读：可合成的「主件候选」= 同部位同品质数量 ≥5 的组（UI 分组展示用）
const groups = new Map<string, ItemInstance[]>();
for (const it of items.filter((i) => i.consumable)) {
  const key = `${it.slot}|${it.quality}`;
  (groups.get(key) ?? groups.set(key, []).get(key)!).push(it);
}
// 每组 ≥5 件 ⇒ 可合成；弹窗列出组（部位 + 品质 + 数量），点一组选 5 件。

// 写：唯一入口 —— 主件 + 恰 4 材料（同部位同品质、可不同 defId、五件互异）
const res: QualityFuseResult = fuseQualityFive({
  mainInstanceId: 'q1:cannon:1:1',
  materialInstanceIds: ['q1:machineGun:1:1', 'q1:shotgun:1:1', 'q1:saw:1:1', 'q1:laser:1:1'],
  draft,                                  // 当前正式 BuildDraft（装备保护用）
});
if (res.ok) {
  res.productId;          // 'qv2:cannon:green:1' —— 弹窗成功态直接展示
  res.productDefId; res.productQuality;
  res.consumedInstanceIds; // 5 件（含主件）—— UI 逐格移除
  res.equippedUpgraded;    // true = 装备中的旧档被合空且沿既有 equipWeapon 升星校验通过
} else {
  res.reason;   // 'unknown-instance'|'duplicate-instance'|'cross-slot'|'cross-quality'
                // |'max-quality'|'not-consumable'|'not-enough-materials'
                // |'legacy-star-missing'|'equip-failed'
  res.detail;   // 玩家可读原因（直接展示，零写盘已由 Foundation 保证）
}
// 成功后重读：projectItemInstances(playerInventory(draft), draft) 即见新产物。
```

- **失败零写盘是 Foundation 的硬保证**（测试 QV-22/23/25/32/33 逐 reason 钉死）——
  UI 不需要自己做回滚，直接刷新读数即可；
- 成功 = 一次原子保存（账本 key `strongfruit.garageV2Ledger.v1`）；
  `ownedParts.v2` / `ownedBodies.v1` / `playerBuild.v1` **永不重写**（QV-33 钉死）；
- 白→彩 6 次进阶、彩封顶（QV-21 六级链测试覆盖）。

## 4. 明确不支持 / 缺口（C 队列 UI 如实呈现，不假装可合成）

| 缺口 | UI 行为 |
|---|---|
| Body 不可消耗（无数量模型） | `lockedReason='body-not-consumable'`，合成弹窗不列 body 组 |
| 7 档品质**未接正式 Run 战斗**（旧倍率只到 ★5，Movement/Gadget/Body 无星级通道） | 品质件**可合成、可展示**；Run 侧强度映射等设计决策（审计 §G 三方案）。**C 队列不得把「彩色=更强战斗」画进任何 UI 文案** |
| Movement/Gadget 装备中的最后一件被消耗 | Foundation 直接拒绝（`equip-failed`），UI 提示「先卸下或换材料」 |
| Weapon 装备档被合空 | Foundation 沿既有 equipWeapon 语义校验升星（`equippedUpgraded=true`），UI 无需额外处理 |

## 5. 测试索引（`tests/garageV2QualityFoundation.test.ts`，22 条全绿）

- 品质模型 QV-10..13；投影 QV-01..05（确定性/不漂移/Body/装备 refs）；
- 五合一 QV-20..27（跨 defId 合法链、六级进阶、重复/跨部位/跨品质/数量/未知拒绝）；
- 装备保护与原子性 QV-30..34（Weapon 升星通过、Movement 拒绝、旧 key 逐字节不变、幂等）。
