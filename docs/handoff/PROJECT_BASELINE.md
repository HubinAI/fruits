# PROJECT BASELINE｜《最强水果》当前有效底座

> **代码基线 HEAD**：`7241aab9f1df5477d0314e9283a525df153b06a4`（分支 `prototype-portrait-battle-lab`）
> **生成日期**：2026-10-03
> **口径**：本文件**只保留当前仍然有效**的结构与口径。凡被后续 Queue 推翻的旧结论**一律不收录**。
> 文档本身所在的 docs-only 提交**不改变任何代码**，故 HEAD 仍是可复现的代码基线。
>
> ⚠️ 与 `src/**`、`tests/**` 冲突时，**以代码和测试真源为准** —— 本文件是索引，不是真源。

---

## 1. 产品核心循环

```
首页 (home.html)
  → 车库 Garage（选 4 槽装备）
  → 开始完整冒险（资格校验通过才放行）
  → Run：3 场战斗 + 2 次 Build Choice（day 1→4）
  → 结算 Settlement（COMPLETE / FAILED）
  → 奖励入库 → 回到首页 / 再来一局
```

- **Run 入口资格**：车上必须有武器，且**基准武器**（装配顺序第一件）在 `FULL_RUN_SUPPORTED_WEAPON_IDS` 里。
  唯一判据函数 `canStartFullRun(draft)`（`src/product/runCompatibility.ts:242`）；不合格时**不给 href**。
- **失败终态纪律**：产品失败终态**绝不入库**（FAILED 不写库存、不发奖励）。
- **入口唯一性**：根 `/` 由 dev-only 的 `build/branchDevEntry.ts` 重写为 `/home.html`；
  该重写**不许**进 `vite.config.ts`。

---

## 2. Body / Movement / Weapon 基础结构

### 2.1 Body（车身）

| 来源 | defId | 拥有状态 |
|---|---|---|
| 默认拥有（4） | `watermelonBody` `bananaBody` `pineappleBody` `coconutBody` | 恒拥有 |
| 新增（4） | `durianBody` `pearBody` `mangoBody` `orangeBody` | 需获得后解锁 |

- 真源：`src/core/bodyOwnership.ts`（`DEFAULT_OWNED_BODIES` / `NEW_OFFICIAL_BODIES` / `OFFICIAL_BODIES`）
- 全部正式车身合计 **8**；存档 key `strongfruit.ownedBodies.v1` 只记录**新增车身**。

### 2.2 Movement（轮组）

正式轮组 **4** 档（`src/core/content.ts`），加「卸下」的 `none`/`EMPTY_SLOT` 共 **5** 种取值：

| defId | 名称 |
|---|---|
| `wheelStd` | 标准轮 |
| `smallWheel` | 小型轮组 |
| `largeWheel` | 大型轮组 |
| `heavyWheel` | 重型轮组 |

- 前轮 / 后轮**各自独立**选择（`frontWheelDefId` / `rearWheelDefId`）。

### 2.3 Weapon（武器）

- 正式武器通过 **`category === 'weapon'`** 的 `FunctionalPartDef` 定义。
- **玩家可写槽位只有一个**：`WEAPON_SLOT = 'frontMass'`（`src/product/playerLoadout.ts:166`）。
- `top` / `front` / `rear` 三个功能挂点在**真实产品链路**里恒 `EMPTY_SLOT`
  （见 §8「Hidden Top Weapon Removal」）。

---

## 3. Garage 四槽正式结构

- 槽位枚举：`GarageSlot = 'weapon' | 'body' | 'rear' | 'front'`
- **版面顺序（= DOM 顺序）**：`GARAGE_SLOT_ORDER = ['weapon','body','rear','front']`
  ```
  [ 武器 ] [ 车身 ]
  [ 后轮 ] [ 前轮 ]
  ```
- 槽位 → 配置字段**一一对应，没有第二张映射表**：

  | 槽 | 字段 |
  |---|---|
  | `weapon` | `functionalSelections[WEAPON_SLOT]`（= `frontMass`） |
  | `body` | `bodyDefId` |
  | `front` | `frontWheelDefId` |
  | `rear` | `rearWheelDefId` |

- 四个槽**完全同构**（同尺寸 / 同结构 / 同交互 / 同选中态）：只有**一个** `.ph-slotnode` 构造分支 + `1fr 1fr` grid。
- 唯一装备交互 = **点槽位 → 点已拥有部件 → 立即装备**（源码守卫「零 drag 事件」+ 运行时 `garageDraggableCount === 0`）。
- 槽位**不再**读挂点坐标（`vehicleSlotAnchors` 已移除）。
- 真源：`src/product/homePage.ts`（`GARAGE_SLOT_ORDER` / `GARAGE_SLOT_LABELS` / `garageSlotTitle`）。

---

## 4. Run 三段 + 两次 Choice

脚本真源：`src/lab/portraitBattleLab/runScript.ts`（`RUN_SCRIPT`，严格线性链，推进只走 `next`）。

| # | 节点 id | kind | day | encounterId |
|---|---|---|---|---|
| 1 | `d1-start` | EVENT | 1 | — |
| 2 | `d2-battle1` | BATTLE | 2 | `ProtoRusher` |
| 3 | `d2-choice1` | CHOICE (`layer1`) | 2 | — |
| 4 | `d3-battle2` | BATTLE | 3 | `Chaser` |
| 5 | `d3-choice2` | CHOICE (`layer2`) | 3 | — |
| 6 | `d4-final` | FINAL | 4 | `RangedTurret` |

- 全派生常量：`RUN_TOTAL_DAYS = 4` · `RUN_TOTAL_BATTLES = 3` · `RUN_TOTAL_CHOICES = 2`。
- 三段各自表达的**不同问题**：① 近身碰撞（`ProtoRusher` 主动冲撞）→ ② 节奏（`Chaser` 更快更黏）
  → ③ **唯一一段对手主动维持作战距离**（`RangedTurret` 声明 `enemyDrive: 'keep-distance'`）。
- **`DAY = 1` 的判定时点 = 进入 Run 的瞬间**，因此第一场战斗里 `day` 已经是 2。
- **终局判据与 encounterId 无关**：`finishRunBattle` 读的是节点 `kind === 'FINAL'`（`runPageState.ts:763`）
  —— 这是「Encounter 顺序全排列取证」能合法注入的依据（R13）。

---

## 5. Reward / Fusion / Star Growth

### 5.1 Reward（结算奖励）

- 当前产品前提：**COMPLETE 固定给 `cannon ★1 ×1`**；结算页卡片**纯展示、无可选项**
  （真源 `src/lab/portraitBattleLab/runProductReward.ts`）。
- 迁移顺序**必须**：`plan → mutate → saveInventory → 最后 mark`；
  落标记的判据是**「决策」而不是「动作」**。

### 5.2 Fusion（合成）

- 合成阈值 `FUSE_STACK = 5`（`src/product/playerGrowth.ts:177`）。
- 库存星级上限 `INVENTORY_MAX_STAR = 5`（`src/core/partInventory.ts:90`）。
- 入口 = 车库底部**持续可见且恒可点**的「合成」入口（不要求拖动 / 长按）。
- 合成进阶到 ★3..★5 走 `canFuse` 的 `maxStar` 分支。

### 5.3 Star Growth（星级伤害）

- **星级伤害唯一真源**：`1 + 0.25 × (star − 1)`
  - ★1 = 100% ，★2 = 125% …（例：玩家侧 cannon ★1 = 120 → ★2 = 150）
- ⚠️ 两个**不是**同一件事的上限，不要混：
  - `INVENTORY_MAX_STAR = 5` —— 库存数据模型的档数上限（产品 Garage 用这个）。
  - `MAX_STAR = 2`（`src/core/partInventory.ts:436`）—— **旧横屏融合规则**的策略上限（**冻结**）。

---

## 6. 当前 Full Run Weapon / BLOCK Weapon

真源：`src/product/runCompatibility.ts:150`（`FULL_RUN_SUPPORTED_WEAPON_IDS`，**显式字面量**，登记门槛 5 条）。

### 6.1 已登记（可以打完整 Run）—— 7 件

`cannon` · `flamethrower` · `hammer` · `laser` · `machineGun` · `rammer` · `shotgun`

### 6.2 明确被拒（BLOCK）—— 保持现状，**不得顺手补 behavior**

| 武器 | 不满足的门槛 | 说明 |
|---|---|---|
| `spear` 刺 | ③ Runtime 不完整 | `behavior: 'ram'`，但 `behaviorRegistry.FACTORIES` **没有注册 `'ram'`**（`src/battle/` 下无 `ramBehavior.ts`）。⚠️ 它**确实能**通过 `contactOnce` 打出伤害（实测 600~1020）—— 但「碰撞能造成伤害」≠ Runtime 完整。 |
| `saw` 圆锯 | ④ / ⑤ | Runtime 与 `contactTick` 都在，但挂在**产品主武器槽** `frontMass` 上**打不到人**：圆锯半径 28、圆心 = 挂点 ⇒ 前沿本地 x = 73，而车身 collider 前沿 x = 85 ⇒ 正面接敌**永远由车身先接触**。既有 saw 测试全挂在 `front` 槽（前沿 x = 106）所以从未测到。让它生效必须改挂点或几何 = 新规则。 |
| `ramHead` 冲撞头 | ① 不在 `OFFICIAL_PARTS` | `prototype/hold`，玩家永远拿不到。 |
| `pushRod` / `lifter` / `thruster` | ① 非武器 | `category === 'gadget'`。 |

> ⚠️ `saw` 的**挂点几何不动**（项目已冻结项）。

---

## 7. 权威 Strict Matrix 口径

**唯一权威工具**：`tests/productRunFullReachableSpaceR10.test.ts`
（**测量工具，非回归守卫**；单跑 ≈ 42 分钟 / 2504s，必须后台跑 + 独占机器）

### 7.1 搜索维度（严格全枚举，禁止「代表路线」口径）

| 维度 | 取值 |
|---|---|
| Body | 全部 `OFFICIAL_BODIES` = **8** |
| Weapon | `FULL_RUN_SUPPORTED_WEAPON_IDS` = **7** |
| Front Movement | 4 档 + `none` = **5** |
| Rear Movement | 4 档 + `none` = **5** |
| Build | 每把 Weapon 在两个 CHOICE 节点上的**全部**合法组合 |
| Star | 先只扫 ★1（`playerBaseline: true`，零 Build 起手） |

分层剪枝（**不牺牲完备性**）：E1 FAILED ⇒ 安全剪枝；否则在 CHOICE 处**全分支**展开。

### 7.2 冻结台账（⚠️ 变了必须先查清是谁改的参数，**不许直接放行**）

| 口径 | COMPLETE Path | Unique Chassis |
|---|---|---|
| R10 基线（`R10_BASELINE_*`） | **26** | **10** |
| 当前（`R11_CURRENT_*`） | **28** | **11** |

逐武器唯一 COMPLETE chassis：

| 武器 | R10 基线 | 当前 |
|---|---|---|
| `cannon` | 1 | 1 |
| `flamethrower` | 1 | 1 |
| `machineGun` | 4 | 4 |
| `shotgun` | 4 | 4 |
| `hammer` | 0 | 0 |
| `laser` | 0 | **1** |
| `rammer` | 0 | 0 |

- 参数层探针 `withR10BaselineParams`（`finally` 还原）把 `laser.cooldownMs → 1800` / `rammer.restSteps → 24`；
  **基线复现失败 ⇒ 直接红**（分母不可信 / 探针无效）。
- ⚠️ **代表路线口径不安全**：严格全枚举 11 chassis vs `policyPicks` 代表路线只有 5 ⇒ 漏 6/11。
  写「产品可达空间」结论**必须用严格口径**。
- ⚠️ **基线不许用记忆值做分母** —— 必须现算复现。

---

## 8. 已冻结且不能顺手修改的底座

### 8.1 `content.ts` 冻结是**逐字段授权**打破的

- 迄今仅两个字段被授权改过：`laser.cooldownMs`（`1800 → 600`，**保留**）·
  `rammer.restSteps`（`24 → 12 → 24`，**已整块回退**）。
- 再动**必须有 Queue 明文授权**。

### 8.2 `src/battle/contactRouter.ts` 全程冻结

- 任何 Queue 都不得改；每轮必交 `git diff --exit-code -- src/core/content.ts src/battle/contactRouter.ts`。

### 8.3 Hidden Top Weapon Removal（P0）

- `top` 槽在真实产品链路**恒 EMPTY**：`defaultPlayerDraft()` 清 + `loadEquippedDraft → clearHiddenTopWeapon` 清旧存档。
- 其它功能槽（`front` / `rear`）同样恒 EMPTY（产品只暴露 `frontMass` 主武器槽）。

### 8.4 其它不可顺手改的契约

| 契约 | 内容 |
|---|---|
| 星级伤害 | `1 + 0.25 × (star − 1)`，唯一真源，不得另立第二份 |
| 玩家侧 cannon 数值 | cannon 恒 **80**；玩家侧 **120 / 150** 只经 `createRunRegistry(build, true)`（**只有 `runPage.ts:beginBattle` 传 `true`**） |
| 跨段耐久 | 必须走 `runCarriedPlayerHp(s)`（`runPageState.ts:609`） = `min(maxHp, 上一场剩余 HP + repairBonus)`；⚠️ 自己算会**静默丢掉 `emergencyRepair` 的维修补偿** |
| 失败终态 | 产品失败终态**绝不入库** |
| 敌人决策对象 | `{ band, enabled, worldDirection, targetSpeedPxPerStep }` **恰好 4 键**（`RDC-07` 用 `Object.keys().sort()` 钉死 ⇒ 不得新增字段） |
| 模块边界 | 产品页只放 `src/product/`；`src/`（Lab 外）**0 处** `portraitBattleLab` 字样 |
| 新增 `src/product/` 模块 | **必须**在 `tests/productLoopHomeGarage.test.ts` 的 **PL-26**（import 白名单，**闭集**）登记 |
| 页面模块 | **级零 DOM**（自挂载放 `*Main.ts`）；导航只写常量交给 `<a href>` |
| storage key | 一批「闭集」守卫钉着「官方 storage 恰好是这几个 key」⇒ 新增 key **必须**全量门禁抓（定向用例必漏） |
| `src/core` 改动 | 只许 R2-B / R2-C / R11 系列授权字段；其余只动 `src/product/` |

---

## 9. 真源索引（不要凭记忆）

| 要找什么 | 去哪 |
|---|---|
| 内容库（Body / Movement / Weapon 定义） | `src/core/content.ts` |
| 车身拥有模型 | `src/core/bodyOwnership.ts` |
| 完整 Run 资格 | `src/product/runCompatibility.ts` |
| 玩家槽位 / 装备 | `src/product/playerLoadout.ts` |
| 成长 / 合成 / 星级 | `src/product/playerGrowth.ts` · `src/core/partInventory.ts` |
| Garage 四槽 UI | `src/product/homePage.ts` |
| Run 脚本 | `src/lab/portraitBattleLab/runScript.ts` |
| Run 状态机 / 跨段耐久 | `src/lab/portraitBattleLab/runPageState.ts` |
| 结算奖励 | `src/lab/portraitBattleLab/runProductReward.ts` |
| 权威 Strict Matrix | `tests/productRunFullReachableSpaceR10.test.ts` |
| 敌人 keep-distance 守卫 | `tests/pblRangedDistanceControl.test.ts` |
