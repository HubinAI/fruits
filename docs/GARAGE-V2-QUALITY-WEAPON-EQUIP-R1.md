# GARAGE-V2-QUALITY-WEAPON-EQUIP-R1｜Weapon 品质产物真实穿戴（单问题底座）

> 日期：2026-10-16 · 基线 HEAD `b13e6df` · 分支 `prototype-portrait-battle-lab`
> 结论先行：**真实 fuse 造出的 qv2 武器产物 → 确认穿戴 → 真实落盘 → 重载 →
> 正式 RunBattleRuntime 第一发真实扣血 100（基准白 80）**全链打通；
> 同 defId+品质两件实例严格区分（实例绑定 + 加载真实校验）；
> 品质 ↔ 旧 ★2..★5 往返无陈旧字段；非 Weapon 部位**仍** run-not-wired。

---

## 1. 穿戴事务（必改 1）—— `equipQualityProduct(productId, draft)` 真实现

```
① id 形状：qv2:<defId>:<quality>:<seq> 四段式 + quality ∈ 七档 + seq ≥ 1
② 真实持有：账本 products 里仍有这一件（core/qualityLedger.loadGarageV2LedgerData
   —— 与加载校验**同一读口**，不是字符串猜测）
③ 部位闸门：slotKindOf(defId) !== 'weapon' ⇒ 显式 'run-not-wired'
   （Movement/Gadget/Body 产物本轮不可穿——不拿武器倍率冒充别的部位强度）
④ Weapon 复核：registry.functionals category === 'weapon'
⑤ Body 挂点：draft.bodyDefId 的 functionalHardpoints 必须含 WEAPON_SLOT('frontMass')
⑥ probe draft：functionalQualities[frontMass]=quality + equippedQualityInstances[frontMass]=instanceId
   + **删 functionalStars[frontMass]**（不双乘）→ validateSnapshot（能量超载/非法装配在此被拒）
⑦ savePlayerBuild 真实落盘；重载后 buildSnapshotFromDraft → resolveSnapshot →
   ContactRouter 真实使用品质倍率
任一失败 ⇒ 零写盘（返回 {ok:false, reason, detail}，不产生半成品存档）
```

失败原因枚举：`unknown-instance / not-owned / not-weapon / invalid-quality / unknown-slot / invalid-build / run-not-wired`。

**旧入口零改动语义**：旧 star 装备继续走 `equipWeapon`（本轮只在其中加了「装旧武器时清品质两字段」，见 §3）。

## 2. 实例绑定（必改 2）—— 最小稳定装备实例引用

- `BuildDraft.equippedQualityInstances?: Record<hardpointId, 'qv2:defId:quality:seq'>`
  （可选字段；旧存档无字段 = 原状）。
- **同 defId+quality 两件实例严格区分**：账本 seq 独立递增 ⇒ instanceId 互异
  （WQ-03：连造两件绿炮，`qv2:cannon:green:1` ≠ `qv2:cannon:green:2`）。
- **加载时真实校验**（`core/buildPersistence.loadPlayerBuild`）：
  每条绑定经 `core/qualityLedger.ledgerOwnsProduct()` 核对仍被持有——
  已被消耗 / 手工删除 ⇒ **整份存档判非法返回 null**（绝不静默回落 ★1 冒充成功，WQ-05b）。
- **装备保护（防悬空引用）**：`projectItemInstances` 给已绑定实例标
  `lockedReason='equipped'` + `consumable=false` ⇒ `fuseQualityFive` 既有 consumable 闸门
  **零新规则**地拒绝把已上槽实例当材料（WQ-05）。

## 3. 往返无残留（必改 3）

- **品质 → 旧武器**：`equipWeapon` 装旧件时原子清除该槽
  `functionalQualities[WEAPON_SLOT]` 与 `equippedQualityInstances[WEAPON_SLOT]`
  （playerLoadout.ts，仅当两字段存在时删；空表时字段整体删除，旧 draft 形状不变）。
- **旧武器 → 品质**：`equipQualityProduct` 写品质两字段 + **删该槽 star**（不双乘）。
- WQ-06 实证：绿炮 → 旧★2 cannon（快照无 quality 字段、伤害 = starTierDamage(80,2)=100）
  → 再穿绿炮（star 清除、quality 恢复）——两个方向都无陈旧。
- **旧存档兼容**：无新字段的旧存档逐字段兼容（WQ-07：★2 老档重载 + 正常 star 倍率）。

## 4. 真实战斗证据（验收 1）

WQ-01 全链（真实 fuseQualityFive 造件 → equipQualityProduct → loadPlayerBuild →
RunBattleRuntime ProtoRusher 固定对手）：

| 步骤 | 读数 |
|---|---|
| 穿戴后重载存档 | `functionalSelections.frontMass='cannon'`、`functionalQualities.frontMass='green'` |
| resolveSnapshot 主伤 | **100**（= round(80×1.25)） |
| 正式战斗第一发真实扣血 | **100**（基准白 80，上一 Queue QT-03 已钉） |
| 七档递增 | 倍率表与 80→200 全档真实战斗已由 `productQualityRunAdapterR1.test.ts` QT-03/04 钉死（本轮复跑全绿）；本轮事务证据 = 任意档 qv2 产物穿戴后存档 quality 值 = 产物档（WQ-02） |

## 5. 回归证据（验收 4）

| 项 | 结果 |
|---|---|
| 新测试 `tests/garageV2WeaponEquipR1.test.ts` | **9/9 PASS**（RED→GREEN；改前基线 9/9 全红，WQ-01 红 = run-not-wired，已留输出） |
| R3d 守卫重订（同步非放宽） | `garageV2LedgerCoherence.test.ts` R3d：「一律拒绝」→「Weapon 可穿（落盘三字段断言）+ 非 Weapon 仍 run-not-wired」 |
| PL-26 白名单 | garageV2Quality：+`../core/qualityLedger`（账本真源移 core）、−`../core/saveVersion`（随迁）——闭集「全部命中」保持，35/35 |
| targeted 全家（8 文件） | **106/106**（star-power 16、Foundation 22、Ledger 8、LabGuard 3、HomeGuard 4、PL 守卫 35、RunAdapter 9、WeaponEquip 9） |
| typecheck / build:portrait-lab | 绿 |
| E2E product-loop | **55/55 PASS** |
| E2E demo-continuous-run | **22/22 PASS**（帧健康 0.0% 长帧） |
| 全量 vitest（285 文件串行） | **18 failed = 预存红闭集逐字一致**（12 文件：1+1+2+1+2+2+1+2+2+1+1+2；逐文件失败断言位点回读源码核对 = T20/R22a/F1-R1/R2/G1-05/R2-09/10/LSE-04/21/NR-14/RC-06b/c/RP-21/27/H-05/EB-04/PC-14/PR-27 同族），零新增红 |
| 边界 | `src/battle/**`、`src/core/content.ts`、敌人/物理/奖励/首页/旧经济零改动 |

## 6. 本轮改动清单

| 文件 | 变更 |
|---|---|
| `src/core/qualityLedger.ts`（新） | 账本 key/类型/读写真源移入 core（loadPlayerBuild 需要同一读口；key/形状/v1→v2 升级语义逐字节不变） |
| `src/core/buildPersistence.ts` | `equippedQualityInstances` 形状白名单（qv2 四段式闭集）+ 加载时 `ledgerOwnsProduct` 真实校验（幽灵绑定 ⇒ null） |
| `src/lab/buildEditorModel.ts` | `BuildDraft.equippedQualityInstances`（可选，旧档零影响） |
| `src/product/garageV2Quality.ts` | 账本读写改 core 委托（re-export 保 import 面不变）；`projectItemInstances` 装备保护（equipped 不可消耗）；fuse 武器分支「槽位已有品质绑定 ⇒ 跳过旧 stack 升星」（防陈旧 star 幽灵注入品质槽）；`equipQualityProduct` 真实现（§1） |
| `src/product/playerLoadout.ts` | `equipWeapon` 装旧武器时清该槽品质两字段（往返无残留） |
| `tests/garageV2WeaponEquipR1.test.ts`（新） | 9 条契约测试（WQ-01..08） |
| `tests/garageV2LedgerCoherence.test.ts` | R3d 按新契约重订（Weapon 可穿 + 非 Weapon 仍拒） |
| `tests/productLoopHomeGarage.test.ts` | PL-26 登记 +1/−1（登记非放宽） |

## 7. 已知边界与缺口（如实，不冒充完成）

1. **fuseStack 陈旧 star 边缘（已披露、结构性无害）**：穿戴品质件后玩家再走**旧 fuseStack** 把该武器旧 ★1 档合空，`fuseQualityFive` 武器分支会跳过旧升星（本轮新边）——装备侧品质字段不受影响；但**旧 fuseStack 自身**（playerGrowth.ts:757，本轮未动）在极端顺序下仍可能写 `functionalStars`——quality 存在时该 star 被 resolveSnapshot 遮蔽（不双乘语义保证战斗读数**不会错**），仅是将来换回旧武器时会看到一颗陈旧 star。旧 fuseStack 属冻结项（Queue 禁改），若要根除属独立 Queue。
2. **Movement / Gadget / Body 品质产物仍 run-not-wired**：`equipQualityProduct` 对非 Weapon 显式拒绝（R3d 第二半 + WQ-04 钉死）。Movement（grip 候选）/ Gadget（推力类候选）/ Body（HP 候选，需先解数量模型）属下一轮。
3. **正式 Garage V2 UI 未接**：本轮是**事务底座**（隔离数据环境验证），正式 Garage 页面不显示品质穿戴入口——「正式体验完成」要等 5 槽完整接入 + 真人验收。
4. **7 档全档穿戴全链**：本轮对绿件做完整链（造→穿→落盘→重载→战斗 100）；其余档位的倍率/单调性由上一 Queue QT-03/04 真实战斗钉死 + 本轮 WQ-02 事务断言覆盖——两测试合并即等价于全档全链。

## 8. 技术通过 ≠ 体验通过

本轮证明的是「Weapon 品质产物的穿戴事务、实例恒等性、往返无残留」这条底座；
正式 Garage V2 穿戴入口、Movement/Gadget 品质强度、Body 消耗模型都还没做——
在 5 槽完整接入并真人验收前，正式产品体验**没有**「品质穿戴」这一步。
