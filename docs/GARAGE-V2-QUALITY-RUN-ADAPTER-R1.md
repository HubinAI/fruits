# GARAGE-V2-QUALITY-RUN-ADAPTER-R1｜七档品质 → 真实战斗的最小桥接（γ：显式 quality 字段）

> 日期：2026-10-16 · 基线 HEAD `60af9fb` · 分支 `prototype-portrait-battle-lab`
> 结论先行：**七档品质的每一档都在真实 Planck 战斗里打出严格递增的真实扣血**
> （80→100→120→140→160→180→200），旧 ★1..★5 无 quality 快照读数**逐字不变**，
> 正式 Garage / fuseStack / Run / 奖励投放零改动，`equipQualityProduct` **仍** run-not-wired。

---

## 1. 追真实链（必改 1 的 file:line 实证）

```
Garage V2 ItemInstance (qv2:<defId>:<quality>:<n>，账本 products)
  → [本轮未接：正式装备链仍被 equipQualityProduct 挡住]
BuildDraft.functionalQualities[hardpointId]        ← 本轮的**唯一写入口**（隔离 Lab fixture / 测试）
  → buildSnapshotFromDraft（buildEditorModel.ts:180-185 注入 install.quality；white 不写）
  → BuildSnapshot.functionals[].quality（types.ts FunctionalInstall.quality，可选字段）
  → [RunBattleRuntime] buildSpawnPlanFromDraft → applyRunModifiersToSnapshot
     （runModifiers.ts:1081-1084 { ...install, defId } spread ⇒ quality 字段**天然穿透**，零改动）
  → resolveSnapshot（buildSnapshot.ts:220/231 → applyInstallTier，installQuality.ts 唯一实现）
  → resolved def.behaviorParams 伤害键 × 品质倍率（round）
  → PlanckPartRuntime / WeaponBehavior 构造读取
  → ContactRouter.ts:688（baseDamage 直击）/ :996（projectileDamage 弹丸）真实结算
  → DamageResolver damage 事件（RunBattleRuntime.playerWeaponHitSummary 实测记录）
```

**能量口径**：`computeEnergy` / `validateFunctionalInstall`（buildValidator.ts）走 `installEnergyOf`
= 与 `applyInstallTier` 同一 star 能量规则（>1 ⇒ ×1.10 round）；**quality 不改能量**（Queue 必改 2）。

## 2. 契约核心（必改 2/3/4 逐条落地）

| 条目 | 定案 | 证据 |
|---|---|---|
| 倍率表 | 白1.00/绿1.25/蓝1.50/紫1.75/橙2.00/红2.25/彩2.50（= 旧星曲线 n=1..7 自然延拓） | `installQuality.ts` `QUALITY_DAMAGE_MULT`；QT-01 |
| **不双乘** | quality 存在 ⇒ **替代** star 伤害倍率（80×1.75=140，不是 80×1.5×1.75）；star 能量语义保留 | `applyInstallTier` 路径二；QT-02（含 ★5+紫 能量 = round(30×1.1) 断言） |
| 旧链零漂移 | 无 quality ⇒ 走逐字复刻的 star 路径；star≤1 恒等返回**同一对象**（SP-05 引用语义保持） | QT-02b 全部件×★2..5 逐字段等价 + 引用断言 |
| 作用面 | 只有 `behaviorParams` 顶层含 `damage` 键（嵌套 saw.hitPolicy.damage 不在——与星级层同边界）；cooldownMs/muzzleSpeed/radius/mass/recoil 逐字不变 | QT-02b 非伤害键断言 |
| white 不落字段 | snapshot 构造层 white 不写 quality（与 star>1 才写 star 同构）⇒ 旧快照形状逐字节不变 | buildEditorModel.ts:180-185；QT-07 |
| 存档兼容 | `functionalQualities` 值必须是七档闭集，垃圾值 ⇒ 整份存档判非法回退默认（不半信半疑）；旧存档无字段=原状 | buildPersistence.ts `isBuildDraftShape` |
| Gadget | 同解析通道，但 **数值惰性**（thruster 等无伤害键可放大，不制造假强度）；真实 Gadget 品质属性属独立设计决策 | QT-08；types.ts GadgetInstall.quality JSDoc |
| product 零改动 | `src/product/**` 本轮一字未动 ⇒ PL-26 白名单闭集零风险；`equipQualityProduct` 仍 run-not-wired | git diff --stat |

## 3. 七档实战伤害表（真实读数，QT-03/04 + 探针复测）

同炮（cannon，正式基准 80）· 同对手（ProtoRusher）· 固定步序列 · 真实 damage 事件：

| 品质 | 倍率 | 第一发真实扣血 | 命中数 | 第一发时刻 | 胜负 |
|---|---|---|---|---|---|
| 白 white | 1.00 | **80** | 13 | 2133.33ms | A 胜 |
| 绿 green | 1.25 | **100** | 10 | 2133.33ms | A 胜 |
| 蓝 blue | 1.50 | **120** | 9 | 2133.33ms | A 胜 |
| 紫 purple | 1.75 | **140** | 8 | 2133.33ms | A 胜 |
| 橙 orange | 2.00 | **160** | 7 | 2133.33ms | A 胜 |
| 红 red | 2.25 | **180** | 6 | 2133.33ms | A 胜 |
| 彩 chrome | 2.50 | **200** | 5 | 2133.33ms | A 胜 |

- **严格单调**：每档 > 上一档（QT-03 断言）。
- **物理零漂移**：七档第一发命中时刻**逐字相同**（2133.33ms）——只有伤害进数据，
  弹道 / 节奏 / 几何 / 后坐完全一致（QT-04 断言）。
- 命中数 13→5 递减是「单发更重 ⇒ 更早打完」的自然结果，与倍率表自洽。
- QT-05 单挂点隔离：装 hammer 的双武器车上，红品质只抬 cannon（180），hammer 逐字不变。

## 4. RED → GREEN（必改 1 的「先写旧 HEAD 必红判据」）

- RED 留证：改前 HEAD 跑 `tests/productQualityRunAdapterR1.test.ts` ⇒
  `Error: Cannot find module '../src/core/installQuality'`（判据在旧 HEAD 必红，已留输出）。
- 改后 9/9 PASS（QT-01..08）。

## 5. 按部位的品质有效属性表 + 后续接入方案（必改 3）

| 部位 | 本轮状态 | 品质有效属性（候选） | 接入方案（下一 Queue） |
|---|---|---|---|
| **Weapon** | ✅ 已桥接（伤害倍率真实生效） | 伤害类键 ×品质倍率 | 正式装备链打通后即可用（snapshot 字段已就绪） |
| **Gadget** | ✅ 通道就绪、数值惰性 | 现无（无伤害键） | 候选：推力/冷却类参数 ×品质（需设计拍板 + behavior 侧验证，独立 Queue） |
| **Movement** | ❌ 未接（不伪装可穿戴） | **grip（抓地力）**：单调、不改车高/轮半径/碰撞形状/质量，只改摩擦系数映射——「更高品质抓得更稳」是自然因果；备选 driveForce（会改推撞平衡，风险高） | MovementInstall 加可选 quality → `applyMovementOverrides` 同位叠加；需独立设计拍板 |
| **Body** | ❌ 只出方案（库存无数量，**不开放消耗**） | **HP**：`body.hp × (1 + 0.1×rank)` 或直接倍率表——单体属性、不改质量/碰撞/能量容量；承重（baseMass）会连锁改操控，不推荐 | 需先解 Body 数量模型（G2-AUDIT §F 缺口），再谈品质 |

⚠️ Movement/Body 候选属性**本轮零实现**——按 Queue 必改 3「提出候选」，实际数值须独立设计拍板。

## 6. 按槽限制 API（下一条正式装备桥接的真实入口）

本轮落地的可调用契约（全部已测）：

```ts
// core/installQuality.ts（唯一倍率真源）
import { QUALITY_TIERS_CORE, qualityDamageMultiplier, applyInstallTier } from '.../core/installQuality';
applyInstallTier(def, star, quality)   // 品质替代 star 伤害倍率；无 quality ⇒ 旧 star 层

// draft → snapshot（white 不落字段）
draft.functionalQualities = { frontMass: 'purple' };   // BuildDraft（lab/buildEditorModel.ts）
buildSnapshotFromDraft(draft, registry);               // ⇒ functionals[].quality = 'purple'

// 读数同源（卡片=战斗）
import { tierDamageOf } from '.../core/buildSnapshot'; // round(base × 倍率)，quality 优先 star 兜底
```

**下一 Queue（正式装备链）的具体入口**：
1. `garageV2Quality.equipQualityProduct`（product 层，当前恒 run-not-wired）——
   打通时替换为：把 `qv2:<defId>:<quality>:<n>` 产物写成
   `draft.functionalQualities[slot] = quality` + `validateSnapshot` 校验 + `savePlayerBuild` 落盘
   （与 COH R3b 装备真实落盘同款）；
2. **前置门槛不变**：七档品质真的能穿戴并影响 Run 的独立验收 = 本轮报告 §3 表 + 下一条把
   Lab fixture 换成真实装备路径复测同表；
3. 仍冻结：Body 消耗、旧 ★2..★5 消耗、Run 奖励发品质件。

## 7. 回归证据（验收 4）

| 项 | 结果 |
|---|---|
| 新测试 `tests/productQualityRunAdapterR1.test.ts` | 9/9 PASS（隔离验证环境，正式路径不写 quality） |
| 旧星级守卫 `productStarPowerR2C` | 16/16 PASS（旧 ★1..★5 damage/energy/胜负逐字不变） |
| 品质底座 Foundation + Ledger + LabGuard + HomeGuard | 53/53 PASS |
| typecheck（tsc --noEmit） | 绿 |
| `build:portrait-lab` | 绿 |
| E2E `product-loop` | **55/55 PASS** |
| E2E `demo-continuous-run` | **22/22 PASS**（帧健康 0.2% 长帧 ≪ 20% 可疑阈值） |
| 全量 vitest（285 文件逐文件串行） | **18 failed = 预存红闭集逐字一致**（T20、R22a、F1-R1/R2、G1-05、R2-09/10、LSE-04/21、NR-14、RC-06b/c、RP-21/27、H-05、EB-04、PC-14、PR-27），零新增红 |
| 边界取证 | `src/product/**`、`src/battle/**`、`src/core/content.ts` 零改动 |

## 8. 停止条件复核

本轮**未触发**停止条件：品质桥接不需要改旧 1..5 武器的任何行为（无 quality 路径逐字保持）、
不需要改 Physics / 奖励 / 旧经济（零触碰）。

## 9. 技术通过 ≠ 体验通过（如实声明）

- 本轮只证明「七档品质在真实战斗里逐档变强」这条**方向**（隔离验证环境）；
- **正式 Garage V2 仍不能穿戴品质产物**（`equipQualityProduct` 仍 run-not-wired）——
  Lab 完成 ≠ 正式体验完成，正式装备链属下一条 Queue；
- Movement/Body 品质属性只有候选方案，未实现、未拍板；
- 彩色格子仍不代表「可出战的高品质」——在正式装备链打通并真人验收前，这一条不许反转。
