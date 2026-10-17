# QUALITY-MOVEMENT-RUNTIME-EQUIP-R1｜A：轮组品质 → 真实物理驱动 + 穿戴事务

> 日期：2026-10-17 · 基线 HEAD `28a8209`（GARAGE-V2-QUALITY-WEAPON-EQUIP-R1 之上）
> 结论先行：**七档品质轮在真实 Planck 里跑出严格单调的起步位移与单调提前的首次接触时刻**
> （单属性 = driveTorque，真实 Revolute motor 已有路径）；quality 轮组产物可穿前后轮、
> 真实落盘、重载进正式 Run；同件禁双槽；已装备不可被 fuse 消耗；旧轮/旧 star/旧 Run 零漂移。

---

## 1. 单属性裁定（必改 1）：driveTorque，不是 grip

| 候选 | 证据 | 裁定 |
|---|---|---|
| **driveTorque** | `planckMovement.ts:54-68`：每轮 `maxTorqueNm = I × w.def.driveTorque`（units.ts:80-85 已标定路径 τ=I·α）→ Revolute motor 直接读；content.ts:494/517/538 既有实测「2s 位移 160/145/130/123」正是扭矩+质量差异的真实物理结果 | ✅ **采用** |
| grip | 只进 friction（planckVehicleAssembly.ts:343）；content.ts:542-543 已有实测结论「Planck motor 路径下 grip（friction）对前进/推挤行为**无差异**（纯滚动无滑动）」 | ❌ 无差异通道 |

**7 档倍率**：`qualityMultiplierOf`（installQuality.ts）= 与伤害**同一张表**（白1.00→彩2.50，
`1+0.25×(n−1)` n=1..7），round 取整。`applyMovementTier`（buildSnapshot.ts）只改 `driveTorque`
一个键；radius/mass/grip/maxRPM/cruiseSpeed/energy/collider 逐字不变；**无品质恒等返回原对象**。

## 2. 真实物理读数（验收 A；真实 RunBattleRuntime + ProtoRusher 固定对手）

QM-04（起步段 = 固定 120 步 / 2s，接触前纯驱动段；接触时刻 = 全窗口 420 步）：
- **起步位移 7 档严格单调递增**（白 < 绿 < 蓝 < 紫 < 橙 < 红 < 彩；扭矩抬升 → 加速段更快到达 cruise 1.5 上限）；
- **首次接触时刻 7 档单调不增**（跑得更快 ⇒ 更早接敌）。
- ⚠️ 口径裁定（实测踩坑）：全窗口位移被「高档先接敌 → 击退交互」污染（反例 394<424），
  纯驱动读数必须取接触前的固定起步窗（与 content.ts:494 既有口径同源）。
- QM-05：彩轮接触时刻 ≤ 白轮（独立复证）。
- QM-06：只抬后轮 ⇒ 前轮 resolved def 全键不变（槽位独立）。

## 3. 穿戴事务（必改 2/3）

- `BuildDraft.movementQualities = { rear?, front? }`（可选；white 不落 snapshot 字段）；
  `MovementInstall.quality`（core 类型）；`buildSnapshotFromDraft` 按槽注入；
  `resolveSnapshot` → `applyMovementTier` 只作用本槽。
- `equipQualityProduct(productId, draft, 'rear'|'front')` movement 分支：
  账本真实持有 → Body 挂点 → **同件实例禁占另一槽** → probe draft（quality+绑定）→
  validateSnapshot → savePlayerBuild；Movement 无 star 通道 ⇒ 无双乘面。
- **加载校验**：movementQualities[slot] 必须与 equippedQualityInstances[slot] **成对**，
  绑定经 `ledgerOwnsProduct` 真实核对（幽灵绑定/半绑定 ⇒ 整份存档 null）。
- **装备保护**：已上槽 qv2 实例 `lockedReason='equipped'` ⇒ fuse 拒绝（零新规则）。
- **往返清除**：`equipMovement` 装旧轮/卸下时原子清本槽品质两字段（QM-11：另一槽不动）。
- 失败零写盘：未持有 / 形状非法 / 非法槽位（QM-09）。

## 4. 测试与守卫变更（同步非放宽）

| 项 | 结果 |
|---|---|
| 新测试 `tests/qualityMovementEquipR1.test.ts` | **12/12 PASS**（基线 RED 10/12 留证：字段不存在 + run-not-wired + 物理无差异） |
| R3d（ledgerCoherence）重订 | 「非 Weapon 拒绝」→「Weapon+Movement 可穿；Gadget/Body 属后续」 |
| WQ-04（weaponEquip）重订 | movement 拒绝段移除（已打通），零写盘由 ①②+存档逐字节断言覆盖 |
| targeted 全家 9 文件 | **118/118**（RunAdapter 9 + WeaponEquip 8 + Foundation 22 + Ledger 8 + StarPower 16 + LabGuard 3 + HomeGuard 4 + PL 35 + Movement 12） |
| typecheck / build:portrait-lab | 绿 |
| E2E product-loop / demo-continuous-run | **55/55** / **22/22**（帧健康 0.0%） |

## 5. 边界与遗留

- Gadget/Body 产物仍 run-not-wired（B 轮接 Gadget；Body 无数量模型独立冻结）。
- 正式 Garage V2 UI 未接（本轮是事务+物理底座；QV 投影的 movement 产物在 Lab 可见）。
- 旧 fuseStack 对「轮组装备中被合空」仍拒绝（COH 原语义，未动）——品质轮合成本体材料的
  路径由穿戴事务负责，不经过旧升星。

**技术通过 ≠ 体验通过**：正式 Garage V2 的轮位品质穿戴入口、七档全 Build 实战验收未做。
