# GARAGE-V2-QUALITY-MOVEMENT-GADGET-BATCH-R1｜收口报告（A/B 串行双提交）

> 日期：2026-10-17 · 基线 `28a8209` → A `6435db3` → B `b17e19c`（均 local=remote，工作区 clean）
> **5 槽品质覆盖矩阵见 §1；可实测物理指标见 §2；下一条最短缺口见 §3。**

---

## 1. 五槽品质覆盖矩阵

| 槽 | 品质通道（单属性） | 真实物理路径 | 穿戴事务 | 实例绑定+加载校验 | 覆盖状态 |
|---|---|---|---|---|---|
| **Weapon**（frontMass） | projectileDamage/baseDamage ×倍率 | ContactRouter.ts:688/996 真实结算 | ✅ WEAPON-EQUIP-R1 | ✅ | **已覆盖**（80→200 实测） |
| **Movement·rear** | driveTorque ×倍率 | planckMovement.ts:54-68 Revolute motor（τ=I·α） | ✅ MOVEMENT-RUNTIME-EQUIP-R1 | ✅（成对） | **已覆盖**（起步位移 7 档单调 + 接触提前） |
| **Movement·front** | 同上（槽位独立） | 同上 | ✅（同件禁双槽） | ✅ | **已覆盖** |
| **Gadget**（gadget 槽） | thrustImpulse ×倍率（仅 behavior='thruster'） | thrusterBehavior.applyThrust:415-430 applyLinearImpulse | ✅ GADGET-THRUST-EQUIP-R1 | ✅（成对） | **已覆盖**（far 单调 / near 可分辨 / 未触发 0 影响） |
| **Gadget·pushRod** | 无可解释属性 | — | 显式 run-not-wired + 缺口说明 | — | ⛔ 明确不支持（不假成功） |
| **Body** | —（无数量模型） | — | 结构性无入口（无 qv2 产物） | — | ⛔ 独立冻结（等数量模型设计） |

## 2. 可实测物理指标（全部真实 Planck，非 resolvedDef 读数）

| 指标 | 通道 | 读数（白→彩） | 测试 |
|---|---|---|---|
| 武器第一发真实扣血（cannon 80 基准） | ContactRouter damage 事件 | 80/100/120/140/160/180/200，firstAtMs 逐档相同 | productQualityRunAdapterR1 QT-03/04 |
| 轮组起步位移（固定 120 步=2s，接触前纯驱动段） | vehicleX 位移 | 7 档严格单调递增 | qualityMovementEquipR1 QM-04 |
| 首次接触时刻（ProtoRusher，420 步窗） | contactResidue 首次 true | 7 档单调不增（跑得快⇒早接敌） | QM-04/QM-05 |
| far 前冲最大前伸位移（thruster，窗口 420 步） | vehicleX 极值 | 白/绿/紫/彩严格单调 | qualityGadgetThrustEquipR1 QG-03 |
| near 后撤（reverseThruster） | vehicleX 极值 | 出生 gap 800≫175 ⇒ 前段 0 影响；四档两两可分辨 | QG-04 |
| Gadget 冲量（resolved def = 行为消费的那份） | resolveSnapshot | 40/50/60/70/80/90/100 严格单调 | QG-05 |

## 3. 下一条「正式 Garage V2 接入」最短缺口

1. **UI 接入**（最短路径）：正式 Garage V2 五槽读 `equippedQualityInstances` /
   `functionalQualities` / `movementQualities` / `gadgetQuality`，穿戴按钮调
   `equipQualityProduct(id, draft, slot)`——**API 已齐**（Weapon/Movement/Gadget 三分支全部
   带校验落盘），UI 只是调它 + 显示 lockedReason。
2. **Body 数量模型**（独立设计 Queue）：`ownedBodies.v1` 是 id 数组无数量 ⇒ 无法「5 台合 1」；
   需先拍板生成/退坑规则与战斗倍率（HP 候选），才可开 Body 品质消耗。
3. **pushRod 属性设计**（独立小 Queue）：推程/推力候选，需 behavior 参数与状态机设计。
4. **Run 奖励发品质件**（产品决策）：当前奖励固定 ★1 旧件；品质件的产出途径只有合成。
5. **七档全 Build 实战验收 + 真人感知**：技术通过 ≠ 体验通过。

## 4. 预存红单列（两轮各自核对）

- A 轮：targeted 118/118；E2E 55/55 + 22/22。
- B 轮：targeted 128/128；E2E 55/55 + 22/22（帧健康 0.0%）；全量 vitest **18 failed =
  预存红闭集逐字一致**（T20、R22a、F1-R1/R2、G1-05、R2-09/10、LSE-04/21、NR-14、
  RC-06b/c、RP-21/27、H-05、EB-04、PC-14、PR-27，同 12 文件），零新增红。

## 5. 边界与披露

- 未动：局内 HUD / 默认敌人路线 / Physics 积分器 / 碰撞 / Weapon defs / 攻击曲线 /
  旧 ★1..5 / 奖励经济 / 合成数值 / Garage Lab / Home UI / Pages 部署 / main 合并。
- 未做：正式 Garage V2 UI（两轮都是事务+物理底座）、七档全 Build 实战、真人录屏（不要求）。
- **技术通过 ≠ 体验通过**：品质穿戴在正式产品里仍然不可见——UI 接入前玩家用不到这些 API。
