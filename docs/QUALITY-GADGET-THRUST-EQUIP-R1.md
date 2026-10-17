# QUALITY-GADGET-THRUST-EQUIP-R1｜B：推进类 Gadget 品质 → 真实物理冲量 + 穿戴事务

> 日期：2026-10-17 · 基线 HEAD `6435db3`（QUALITY-MOVEMENT-RUNTIME-EQUIP-R1 之上）
> 结论先行：**推进器/反推器的品质只放大 `behaviorParams.thrustImpulse`（真实
> `world.applyLinearImpulse` 路径）**，far 前冲/近后撤两方向的真实 Planck 位移逐档可追溯；
> qv2 推进类产物可穿戴、落盘、重载进正式 Run；pushRod 明确不支持（不假成功）；Body 仍冻结。

---

## 1. 单参数裁定（必改 1）：thrustImpulse

| 项 | 证据 |
|---|---|
| 真实消费链 | `thrusterBehavior.applyThrust`（thrusterBehavior.ts:415-430）：`applyLinearImpulse(chassis, thrust×sign×thrustImpulse, 安装点)` 每固定步一次——冲量**线性**进物理 |
| 只改这一个键 | `applyGadgetTier`（buildSnapshot.ts）：`behavior === 'thruster'` 且有 `thrustImpulse` ⇒ round(raw × 倍率)；windupMs/thrustMs/cooldownMs/distanceTrigger/喷焰/质量/collider **逐字不变** |
| 触发距离/方向/冷却 | distanceTrigger 对象**整体透传**（QG-01 断言 toEqual 原对象）——触发阈值/方向/冷却零改动 |
| 非推进类双保险 | 解析层：非 thruster behavior ⇒ 品质数值惰性（原对象）；穿戴层：显式拒绝（§3） |
| 倍率真源 | `qualityMultiplierOf`（installQuality.ts）同一张表 白1.00→彩2.50 |

## 2. 真实物理读数（验收 B；真实 RunBattleRuntime + ProtoRusher）

- **QG-03 far 前冲**（thruster，threshold 280，出生 gap 800 立即触发）：白/绿/紫/彩同窗口
  **最大前伸位移严格单调**（冲量更大 ⇒ 前冲更深）。
- **QG-04 near 后撤**（reverseThruster，threshold 175）：出生 gap 800 ≫ 175 ⇒ **前段未触发
  （0 影响段）**，接敌后触发后撤；四档窗口读数**两两可分辨**（distinct=4）——
  后撤幅度与轮驱合成，严格单调不作主张，以「可分辨」为判据。
- **QG-05 七档冲量读数**：正式链 resolved def（= ThrusterBehavior 消费的那份）
  40→50→60→70→80→90→100 严格单调。
- QG-06：真实 Run 跑到终局（穿戴产物合法进战斗）。

## 3. 穿戴事务（必改 2/3）

- `BuildDraft.gadgetQuality`（单值）+ `equippedQualityInstances.gadget`（实例绑定）；
  `GadgetInstall.quality` 上一 Queue 已有类型；`buildSnapshotFromDraft` 注入（white 不写）。
- `equipQualityProduct` gadget 分支：账本真实持有 → **推进类判据**（behavior==='thruster'）→
  Body gadgetHardpoints → probe draft → validateSnapshot → savePlayerBuild。
- **pushRod 显式拒绝**（QG-10）：`run-not-wired` + 最小设计缺口说明
  （「无可解释的成长属性；需单独设计如推程/推力」）——不假成功。
- **加载成对校验**：gadgetQuality ⇔ equippedQualityInstances.gadget（幽灵/半绑定 ⇒ null）。
- **往返清除**：`equipGadget`（装旧件）/`unequipGadget`（卸下）原子清 gadget 品质两字段（QG-09）。
- **装备保护**：已上槽 qv2 实例 `lockedReason='equipped'` ⇒ fuse 拒绝（零新规则，QG-07）。
- 失败零写盘（QG-08）。

## 4. 测试与守卫（同步非放宽）

| 项 | 结果 |
|---|---|
| 新测试 `tests/qualityGadgetThrustEquipR1.test.ts` | **10/10 PASS**（基线 RED 8/10 留证：run-not-wired + 字段缺失） |
| targeted 全家 10 文件 | **128/128**（Movement 12 + Gadget 10 + RunAdapter 9 + WeaponEquip 8 + Foundation 22 + Ledger 8 + StarPower 16 + LabGuard 3 + HomeGuard 4 + PL 35） |
| typecheck / build:portrait-lab | 绿 |
| E2E product-loop / demo-continuous-run | **55/55** / **22/22**（帧健康 0.0%） |
| 全量 vitest（285 文件） | **18 failed = 预存红闭集逐字一致**（同 12 文件），零新增红 |
| 边界 | HUD/敌人/Physics/Weapon defs/攻击曲线/旧★1..5/奖励经济/合成数值零改动 |

## 5. 最小设计缺口（QG-10 如实登记）

- **pushRod（推杆）**：behaviorParams 无 thrustImpulse；其可成长属性候选 = 推程（Prismatic
  上限）/推力（motor force），但两者都需要行为参数与状态机设计——**列缺口，不实现**。
- **Body**：无数量模型（不可合成产物）⇒ 无 qv2 实例 ⇒ 结构上不存在穿戴入口，独立冻结。

**技术通过 ≠ 体验通过**：正式 Garage V2 的 Gadget 槽品质穿戴入口、真人感知验收未做。
