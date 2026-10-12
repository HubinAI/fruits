# 交接文档｜Gadget 第三层真人体验闭环（12 个 Queue）

- 日期：2026-10-12
- 分支：`prototype-portrait-battle-lab`
- 起点：`1be27d8`（Gadget 装配位Foundation）
- 终点：**`6b0356a`**（Demo 授权既有能力锁定）
- 覆盖：**12 个 Queue / 12 个 commit**，工作区 clean，全部已 push

| # | SHA | Queue | 一句话 |
|---|---|---|---|
| 1 | `1be27d8` | GADGET-SLOT-FOUNDATION-R1 | 独立 Gadget 装配位 Foundation |
| 2 | `0e08c13` | GADGET-THRUSTER-PROTOTYPE-R1 | distance-triggered Thruster（过远→前冲） |
| 3 | `3c36d59` | GADGET-REVERSE-THRUSTER-PROTOTYPE-R1 | Reverse Thruster（过近→后撤） |
| 4 | `42384b3` | GADGET-VALIDATION-LAB-R1 | Gadget 验收预设（**接错页面，见 §4.1**） |
| 5 | `bbb0e1b` | GADGET-VALIDATION-LAB-R1 修正 | 接入真实 Portrait Battle Lab |
| 6 | `dbbf27a` | GADGET-VISUAL-VALIDATION-HOST-R1 | **视觉验收宿主** gadget-lab.html |
| 7 | `eb6a975` | GADGET-REVERSE-VISUAL-DIRECTION-R1 | 反推器喷焰方向修正 |
| 8 | `e70ead7` | GADGET-REVERSE-VISUAL-IDENTITY-R1 | 反推器独立喷口视觉身份 |
| 9 | `645c89d` | GADGET-HARDPOINT-ALL-BODIES-R1 | 8 个正式 Body 补齐 gadgetHardpoint |
| 10 | `8fb5978` | GADGET-GARAGE-DATA-R1 | 正式可选池 + Garage 数据入口 |
| 11 | `5ecf8ce` | GADGET-GARAGE-SLOT-R2 | **正式 Garage 五槽**（解冻四槽契约） |
| 12 | `6b0356a` | DEMO-GADGET-ACCESS-R1 | Demo 授权既有能力（**零产品改动**） |

---

## 一、当前状态：Gadget 正式链已完整打通

```
BuildDraft.gadgetDefId
  → BuildSnapshot.gadget
  → resolveSnapshot().gadget        （装配层解析出 Gadget part）
  → createPlanckVehicle            （独立 gadgetHardpoints 挂点 + Weld）
  → BehaviorRegistry               （behavior:'thruster'，mode far/near）
  → RenderSnapshot.flames          （正式 Renderer）
```

**已验证的正式链证据**（`tests/gadgetGarageSlotR2.test.ts` GS-06）：

| 装备 | snapshotGadget | triggers | minVx |
|---|---|---|---|
| EMPTY | （无） | **0** | −2.17 |
| Thruster | thruster | **1** | −2.78 |
| ReverseThruster | reverseThruster | **4** | **−5.38** |

⇒ EMPTY 无 Gadget 行为；Reverse 真实后撤。

### 内容规模
- **Body 8 台**（`bodyOwnership.ts:29-42`）：watermelon/banana/pineapple/coconut（默认拥有）+ durian/pear/mango/orange（需解锁）
- **Movement 3 档**（`partInventory.ts:49`）：smallWheel/largeWheel/heavyWheel（+ wheelStd 默认）
- **Weapon 9 件**，其中 **7 件**登记为可完整 Run（`runCompatibility.ts:150-158`）
- **Gadget 2 件**（Garage 可见白名单 `GADGET_GARAGE_VISIBLE_IDS`）
- **正式对手模板 49 套**（`opponentPool.ts:186-196`：旧 36 + 新 13）

---

## 二、三个关键设计决策（后续开发必须知道）

### 2.1 Thruster 与 ReverseThruster 是**同一套机制的两个 mode**

不是两套实现。共用 `behavior: 'thruster'` 与同一状态机，只由
`behaviorParams.distanceTrigger.mode` 区分：

| | mode | 触发条件 | 冲量符号 | 喷焰方向 |
|---|---|---|---|---|
| Thruster | `far` | gap > 280 | +1（前冲） | 车尾朝车尾 |
| ReverseThruster | `near` | gap < 175 | **−1（后撤）** | **车头朝车头** |

⚠️ **禁止把它们拆成两套 behavior** —— 会破坏 `mode` 单一真源。

### 2.2 Gadget 挂点是**独立 namespace**

`BodyDef.gadgetHardpoints` 与 `functionalHardpoints` 的 front/top/rear
**同名不同义**（不同字段、不同解析路径）。

⚠️ 实测陷阱：`watermelonBody` 的挂点 (−72,−4) 距`rear` 功能槽仅 **7.2px**、
且与后轮 collider **相交** —— 但那是真人验收**已通过**的状态，多轮 Queue 明令不得改动。

### 2.3 「Formal vs Demo」的库存分界

| | 正式玩家 | Demo（`?resetdev=1`） |
|---|---|---|
| 拿 Gadget | ❌ **无途径**（见 §5 P0-1） | ✅ `core/debugGrants.grantAllPartsOnce()` |
| 机制 | `debugGrants` 按 `OFFICIAL_PARTS` 泛化遍历，无需为 Gadget 特判 |

---

## 三、本轮踩过的三个坑（避免重犯）

### 3.1 ⚠️ 「测试通过」≠「功能可用」

`42384b3` 我把预设加进 `src/lab/scenarios.ts`，并**假设**「Lab 已有场景下拉框」。
真实浏览器验证（Playwright）发现：`portrait-lab.html` 的入口是
`src/lab/portraitBattleLab/main.ts` → `PortraitBattleLab`，
它用**Loadout 按钮 + Encounter 按钮**，**根本没有场景下拉框**。

⇒ 任何涉及**UI 入口**的 Queue，必须用真实浏览器验证，不能只跑测试。
（`bbb0e1b` 修正）

### 3.2 ⚠️ node 测试环境无 `localStorage`

`WebStorage` 在 `typeof localStorage === 'undefined'` 时**静默降级为 null**。
我曾据此得出「存档往返断裂」的**假阴性**结论。

⇒ 测持久化必须：`bindPlatformCore(createWebCore())` **且**注入 localStorage 桩。

### 3.3 ⚠️ 契约冻结要先查再动手

`GADGET-GARAGE-SLOT-R2` 之前，四槽契约有 **5 处机器守卫**（含
`GARAGE_SLOT_ORDER).not.toContain('gadget')`），且 `homePage.ts:141` 明写
「Queue 冻结：不得增加未来 Gadget 等空槽」。

我因此在 `GADGET-GARAGE-DATA-R1` **STOP**（未改任何代码），由用户在新 Queue 显式授权解冻。

⇒ 遇到「看起来要重构」的冻结，先 STOP 报告，别自行放宽。

---

## 四、修改过的冻结契约（必须知道，避免误判为 bug）

| 契约 | 原值 | 现值 | 授权 |
|---|---|---|---|
| `GARAGE_SLOT_ORDER` | 4 项，断言不含 gadget | **5 项**（+gadget 排最后） | `5ecf8ce` |
| `GARAGE_SLOT_LABELS` | 4 键 | **5 键**（+`gadget:'辅助'`） | `5ecf8ce` |
| `OFFICIAL_PARTS.length` | 11 | **12**（+reverseThruster） | `8fb5978` |
| `collectIds('combat').length` | 11 | **12** | `8fb5978` |

⚠️ 前两项的前四槽**顺序逐字未变**（仍是 2×2 的 DOM 次序），
Gadget 只加一条 CSS `.ph-slotnode-gadget { grid-column: 1 / -1; }` 独占第三行。

### 4.1 已知遗留：scenarios.ts 里的死代码

`42384b3` 的 4 套 GVL预设**仍留在** `src/lab/scenarios.ts`，
只在 `index.html`（`npm run dev:legacy`）生效，`portrait-lab.html` 看不到它们。
已被 `5ecf8ce` 的 `LAB_LOADOUTS` 方案取代，但**未删除**（删除属独立 Queue）。

---

## 五、当前缺口（来自 DEMO-READINESS-AUDIT-R1，只读审计）

### 🔴 P0-1｜正式玩家拿不到 Gadget（最硬阻塞）

两种 Gadget 在正式可选池，但**无任何正式获取途径**：
- `STARTER_PARTS = ['cannon','hammer','pushRod','spear']`（`partInventory.ts:36`）
- Run 奖励池**恒 0 或 1 条且只发武器**：`rewardChoiceIdsFor` 返回 `[baseWeaponDefId]`（`runReward.ts:120-126`）

⇒ **玩家在 Garage 能看到辅助槽，但装不上。**

### 🔴 P0-2｜7 件可开局武器里 4 件打不到终局

`runCompatibility.ts:74-82` 的实测记录：

| 武器 | 结果 |
|---|---|
| cannon / flamethrower / machineGun | ✅ COMPLETE |
| shotgun | ⚠️ 余量极薄（16.8） |
| hammer | ❌ 第 3 场阵亡 |
| rammer | ❌ 第 2 场阵亡 |
| laser | ❌ **第 1 场阵亡** |

⚠️⚠️ **该记录已有 43 个提交未复测**（`ef601b0` 之后），期间完成全部 Gadget 工作
（含 `eb6a975` 改喷焰方向、`5ecf8ce` 改装配）。**数据可能已过时，但从未复验。**

根因（`runCompatibility.ts:60-70`）：Run 强化内容全是 **Cannon 专属字段**，
非 Cannon 武器拿不到任何伤害成长。

### ⚠️ P0-1 与 P0-2 可能是同一个问题

Thruster 原型目的正是「为近战创造接触机会」，而 hammer 现在第 3 场阵亡。
**建议合并推进**（先复测，再决定是否需要给非 Cannon 武器做成长）。

### 🟡 P1
- **单局完全固定**：`runPageState.ts:77-79` 不做随机/权重/稀有度
- **「耐久取舍」已退役**：`DURABILITY` 无脚本节点 ⇒ `runDurabilityOpen` 恒 false（`runPageState.ts:64`）
- **存档损坏静默吞装备**：`buildPersistence.ts:46-48` 校验失败返回 null ⇒ 无报错

### 🟢 P2
- `spear` / `saw` / `ramHead` 永久不可用（`runCompatibility.ts:122-148`）
- **文档腐化 2 处**：`r5ContentPoolSeed.ts:73-81` 仍写武器表只有 cannon；`runPageState.ts:332` 说「不接永久奖励」（实际已实现）—— **会误导后续开发**

---

## 六、验收入口（真人）

```bash
cd /Users/yy/Documents/workbuddy/fruits
export PATH=/usr/local/bin:$PATH

npm run dev:home# 正式 Garage（需 ?resetdev=1 才有库存）
npm run dev:gadget-lab   # Gadget 视觉验收（4 预设 A/B/C/D）
npm run dev:debug-lab    # Physics / Protocol Lab（红蓝矩形那个）
npm run dev:run-page     # 正式 Run 战斗页
```

⚠️ **不要用 `?resetdev=1` 之外的方式拿 Gadget** —— 那是唯一的 Demo 途径。

---

## 七、建议的下一批 Queue

| # | Queue | 目标 | 影响范围 |
|---|---|---|---|
| **1** | `WEAPON-VIABILITY-REMEASURE-R1` | **只测不改**：用当前 HEAD 重跑 7 件武器通关性，替换过时记录 | 仅测试 |
| **2** | `GADGET-EARN-PATHWAY-R1` | 给两种 Gadget 一条正式获取途径 | `runReward.ts` 或 `r5ContentPoolSeed.ts` |
| **3** | `RUN-BALANCE-NON-CANNON-R1` | 非 Cannon 武器可用的 Run 内成长（**依赖 #1 结论**） | `runModifiers.ts` |
| **4** | `ARCHIVE-RESTORE-RESILIENCE-R1` | 存档校验失败如实报错，不静默回退 | `buildPersistence.ts` |
| **5** | `DOC-COMPAT-REFRESH-R1` | 修 2 处文档腐化 | 仅注释 |

**顺序建议**：先做 #1（最便宜、只测不改，且决定 #3 是否值得做），再定 #2 与 #3 的关系。

---

## 八、测试资产索引

| 文件 | 覆盖 |
|---|---|
| `gadgetSlotFoundationR1.test.ts` | 独立装配位、EMPTY 前后一致 |
| `gadgetThrusterPrototypeR1.test.ts` | 前冲原型 6 项 |
| `gadgetReverseThrusterPrototypeR1.test.ts` | 后撤原型 7 项 |
| `gadgetReverseVisualDirectionR1.test.ts` | 喷焰方向与 thrustSign 一致 6 项 |
| `gadgetReverseVisualIdentityR1.test.ts` | 喷口与炮口错开 7 项 |
| `gadgetHardpointAllBodiesR1.test.ts` | 8 Body 挂点几何 7 项 |
| `gadgetGarageDataR1.test.ts` | 正式可选池 + 数据入口 8 项 |
| `gadgetGarageSlotR2.test.ts` | **五槽 + 正式 Run 全链** 7 项 |
| `demoGadgetAccessR1.test.ts` | Demo 授权既有能力 7 项 |

---

## 九、环境注意事项

- `export PATH=/usr/local/bin:$PATH` 后再跑 npm
- Node v24.21.0
- vitest：`--pool=vmForks --maxWorkers=1`
- ⚠️ **本宿主 `child_process.spawnSync` 被无条件拒绝**（返回 `status:null` + EBUSY）
  ⇒ 受影响测试：`rcBundleCleanP0.test.ts`、`rcFusionTestEntryP0.test.ts`（干净 HEAD 上同样红 = 环境假失败）
- ⚠️ `e2e:product-reward` 单跑约 2m09s > Bash 默认 120s ⇒ **必须后台跑**
- ⚠️ E2E 端口各自独立、**不可复用** ⇒ 并发跑会 `EADDRINUSE`，必须串行
- ⚠️ Lab 目录之外**不许出现** `portrait-lab` / `portraitBattleLab` 字样（守卫 `R22b`）
- ⚠️ 新增 `src/product/` 模块**必须**在 `tests/productLoopHomeGarage.test.ts` 的 `PL-26` 登记