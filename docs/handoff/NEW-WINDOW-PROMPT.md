# 新窗口对话指令 · Gadget 第三层体验闭环交接

> 用法：新开窗口后，把下面「---」之间的内容整段粘贴为第一条消息。

---

## 上下文

我在做《最强水果》微信小游戏的 **Battle Runtime / 玩法层**（仓库 `HubinAI/fruits`，分支 `prototype-portrait-battle-lab`）。

刚刚完成了 **Gadget（辅助装置）第三层真人体验闭环**：12 个 Queue / 12 个 commit，
从「独立装配位 Foundation」一路做到「正式 Garage 五槽 + 正式 Run 真实生效」，
最终 SHA **`6b0356a`**，工作区 clean，全部已 push。

### 已交付的 12 个 Queue

| # | SHA | Queue |
|---|---|---|
| 1 | `1be27d8` | GADGET-SLOT-FOUNDATION-R1 独立 Gadget 装配位 |
| 2 | `0e08c13` | GADGET-THRUSTER-PROTOTYPE-R1 distance-triggered Thruster（过远→前冲） |
| 3 | `3c36d59` | GADGET-REVERSE-THRUSTER-PROTOTYPE-R1 Reverse Thruster（过近→后撤） |
| 4 | `42384b3` | GADGET-VALIDATION-LAB-R1 验收预设（**接错页面**） |
| 5 | `bbb0e1b` | ↑修正：接入真实Portrait Battle Lab |
| 6 | `dbbf27a` | GADGET-VISUAL-VALIDATION-HOST-R1 视觉验收宿主 `gadget-lab.html` |
| 7 | `eb6a975` | GADGET-REVERSE-VISUAL-DIRECTION-R1 喷焰方向修正 |
| 8 | `e70ead7` | GADGET-REVERSE-VISUAL-IDENTITY-R1 独立喷口视觉身份 |
| 9 | `645c89d` | GADGET-HARDPOINT-ALL-BODIES-R1 8 个 Body 补齐挂点 |
| 10 | `8fb5978` | GADGET-GARAGE-DATA-R1 正式可选池 + 数据入口 |
| 11 | `5ecf8ce` | GADGET-GARAGE-SLOT-R2 **正式 Garage 五槽**（解冻四槽契约） |
| 12 | `6b0356a` | DEMO-GADGET-ACCESS-R1 Demo 授权（**零产品改动**） |

### 正式链已打通（附实测证据）

```
BuildDraft.gadgetDefId → BuildSnapshot.gadget → resolveSnapshot().gadget
  → createPlanckVehicle（独立 gadgetHardpoints）→ BehaviorRegistry
  → RenderSnapshot.flames → 正式 Renderer
```

正式 Run 实测（`gadgetGarageSlotR2.test.ts` GS-06）：

| 装备 | triggers | minVx |
|---|---|---|
| EMPTY | **0** | −2.17 |
| Thruster | **1** | −2.78 |
| ReverseThruster | **4** | **−5.38** |

---

## ⚠️ 开工前必须知道的 5 件事

### 1. 当前最硬的阻塞：正式玩家拿不到 Gadget（P0-1）

两种 Gadget 在正式可选池，但**无任何正式获取途径**：
- `STARTER_PARTS = ['cannon','hammer','pushRod','spear']`（`partInventory.ts:36`）不含 Gadget
- Run 奖励池**恒 0 或 1 条且只发武器**（`runReward.ts:120-126`）

⇒ **玩家在 Garage 能看到辅助槽，但装不上。**
唯一能拿到的是 Demo 途径：`home.html?resetdev=1` → 「一键全部件 ×1」。

### 2. P0-2：7 件可开局武器里 4 件打不到终局（数据可能已过时）

`runCompatibility.ts:74-82` 记录：hammer 第 3 场阵亡 / rammer 第 2 场 / laser **第 1 场**阵亡。

⚠️⚠️ **该记录已有 43 个提交未复测**，期间完成全部 Gadget 工作。**先复测再动手。**

⚠️ **P0-1 与 P0-2 可能是同一个问题**：Thruster 的原型目的正是「为近战创造接触机会」，
而 hammer 现在第 3 场阵亡。建议合并推进。

### 3. 三个必须避免重犯的坑

- **「测试通过」≠「功能可用」**：`42384b3` 我假设 Lab 有场景下拉框，实际它只有 Loadout 按钮
  ⇒ **涉及 UI 入口必须用真实浏览器验证**（`bbb0e1b` 修正）
- **node 测试无 `localStorage`**：`WebStorage` 会静默降级为 null
  ⇒ 测持久化必须 `bindPlatformCore(createWebCore())` **且**注入 localStorage 桩
  （我曾据此得出「存档断裂」的**假阴性**）
- **契约冻结要先查再动手**：四槽契约有 5 处机器守卫，我因此在 `GADGET-GARAGE-DATA-R1` **STOP**，
  由你在新 Queue 显式授权解冻才继续

### 4. 两个 Gadget 是同一套机制的两个 mode（禁止拆开）

共用 `behavior:'thruster'` 与同一状态机，只由 `distanceTrigger.mode` 区分：
`far`（过远→前冲，sign +1）/ `near`（过近→后撤，sign −1）。
Gadget 挂点是**独立 namespace**（`gadgetHardpoints` ≠ `functionalHardpoints`）。

### 5. 已改过的冻结契约（别误判为 bug）

| 契约 | 原 | 现 |
|---|---|---|
| `GARAGE_SLOT_ORDER` | 4 项 | **5 项**（gadget 排最后，前四槽顺序未变） |
| `GARAGE_SLOT_LABELS` | 4 键 | **5 键**（+`gadget:'辅助'`） |
| `OFFICIAL_PARTS.length` | 11 | **12** |

---

## 建议的下一步（按优先级）

| # | Queue | 目标 | 影响范围 |
|---|---|---|---|
| **1** | `WEAPON-VIABILITY-REMEASURE-R1` | **只测不改**：用当前 HEAD 重跑 7 件武器通关性，替换过时记录 | 仅测试 |
| **2** | `GADGET-EARN-PATHWAY-R1` | 给两种 Gadget 一条正式获取途径 | `runReward.ts` 或 `r5ContentPoolSeed.ts` |
| **3** | `RUN-BALANCE-NON-CANNON-R1` | 非 Cannon 武器可用的 Run 内成长（**依赖 #1**） | `runModifiers.ts` |
| **4** | `ARCHIVE-RESTORE-RESILIENCE-R1` | 存档校验失败如实报错，不静默回退 | `buildPersistence.ts` |
| **5** | `DOC-COMPAT-REFRESH-R1` | 修 2 处文档腐化 | 仅注释 |

**我的建议：从 #1 开始** —— 最便宜、只测不改，且它的结论决定 #3 是否值得做。

---

## 工作方式（沿用）

- **Queue 驱动**：每条指令含 禁止 / 必改 / 验收 / 停止条件 / 提交要求
- **先查后改**：遇到「看起来要重构」的冻结契约 → **STOP 报告**，别自行放宽
- **诊断即交付**：Diagnostic Queue 就只诊断，不顺手修
- **验收逐条给证据**（file:line、实测数字），不接受「应该可以」
- **每轮收尾**：commit + push + 返回 SHA + 工作区状态
- ⚠️ **不要帮我启动 dev server**（你说过自己手动启动）
- ⚠️ 契约变更要**显式记录原因**，不要静默改断言

## 环境

```bash
cd /Users/yy/Documents/workbuddy/fruits
export PATH=/usr/local/bin:$PATH   # Node v24.21.0
```

- vitest 用 `--pool=vmForks --maxWorkers=1`
- ⚠️ 本宿主 `child_process.spawnSync` 被无条件拒绝 ⇒ `rcBundleCleanP0` / `rcFusionTestEntryP0` 的红是**环境假失败**
- ⚠️ E2E 端口不可复用 ⇒ 串行跑；`e2e:product-reward` 约 2m09s ⇒ 必须后台跑
- ⚠️ Lab 目录外不许出现 `portrait-lab` / `portraitBattleLab`（守卫 `R22b`）
- ⚠️ 新增 `src/product/` 模块必须在 `tests/productLoopHomeGarage.test.ts` 的 `PL-26` 登记

## 验收入口

```bash
npm run dev:home        # 正式 Garage（需 ?resetdev=1 才有 Gadget 库存）
npm run dev:gadget-lab  # Gadget 视觉验收（A/B/C/D 四预设）
npm run dev:run-page    # 正式 Run 战斗页
```

---

**完整交接文档**：`docs/handoff/archive/交接文档_2026-10-12_gadget-third-layer-6b0356a.md`
（含 12 个 Queue 明细、5 个修改文件清单、9 个测试资产索引、5 处冻结契约变更记录）

**请告诉我下一步做哪个 Queue，或直接给新的 Queue 指令。**

---