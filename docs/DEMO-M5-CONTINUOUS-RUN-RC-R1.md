# DEMO-M5-CONTINUOUS-RUN-RC-R1｜连续多局真实 Run · Demo 候选验收报告

> 轮次目标：把「正式首页 → Garage → 完整 Run → 胜败结算 → 奖励 → 改装再战」打包成**可集中真人验收的 Demo 候选**。
> 纪律：全新账号、**零 localStorage 注入**、不篡改 RNG / 库存 / 胜负 / 奖励、不走 Lab 控制入口、复用既有 E2E 机制。
> 验收脚本：`tests/_e2e_demo_continuous_run.cjs`（`npm run e2e:demo-continuous-run`）。

---

## 1. 单一正式试玩入口

- **正式入口**：`home.html`（产物 `dist-portrait-lab/home.html`，`dev:home` 起本地服务）。
- **唯一出发按钮**：首页「开始冒险」（`[data-ph-action="start-run"]`），其链接由产品侧生成，带当前 Equipped 装配 + 满 stack 阈值 + 每条候选各自的领奖地址；UI 唯一能发的路线是 `DEFAULT`（`buildAdventureHref` 不带 `route`），即当前唯一的「正式 Run 路线」。
- **不要**从 `run-page.html`（研发入口，无产品参数时退回 demo 装载）、`portrait-lab.html`（Debug 面）、`encounter-lab.html`（Lab 控制入口）或任何 `?batch=` / `?run=` / `?reward=` 查询入口开始 Demo —— 那些不是真实玩家路径。
- **出发前必须做的事**：进「调整战车」把默认 `cannon` 换成 **`machineGun`**（见 §5 设计风险）。

---

## 2. ≤7 步集中真人体验流程

1. 打开 `home.html`（全新账号 / 清空浏览器存储后首次进入）。
2. 在首页确认「开始冒险」可点（默认装的是 `cannon`，可出发，但**打不赢**，见 §5）。
3. 点「调整战车」→ 把武器换成 **`machineGun`**，车身换 **`mangoBody`**，前/后轮都换 **`smallWheel`**（真实点选，立即装备）。
4. 返回首页 → 点「开始冒险」→ 打完三段真实战斗（途中两次三选一强化选 **维修优先 → 伤害提升**）。
5. **胜利（COMPLETE）**：点底部唯一「领取并返回」→ 回到首页，被领武器 ★1 计数 +1。
6. **失败（FAILED）**：出现「冒险失败」结算 → 点「返回主界面」→ 回首页（**不发奖、不删档**），可立即再战。
7. 再次进「调整战车」换不同合法装配（如车身换成 `durianBody`）→ 返回 → 再点「开始冒险」：确认下一局 Build 真的变成了新装配（改装再战闭环成立）。

> 失败不当 PASS：本 Demo 候选里「失败」是真实可见的终态（失败结算面板 + 返回主界面），奖励只对胜利发放。

---

## 3. 当前 Demo 发布候选清单（已成立环节）

| 环节 | 状态 | 证据 |
|---|---|---|
| 全新账号自然初始化（fresh / seeded） | ✅ 成立 | `_e2e_demo_continuous_run.cjs` A1 + 既有 `e2e:fresh-account-slice` |
| 自然库存：cannon 4/5、smallWheel、machineGun 1/5、mango/durian 解锁 | ✅ 成立 | A2~A4 |
| Garage 真实换装（点槽→点卡）落盘到正式存档 | ✅ 成立 | 既有 `e2e:product-loop` A4~A5b |
| 完整 Run 真实战斗（EVENT→BATTLE 相位真实走） | ✅ 成立 | 既有 `e2e:product-loop` B3~B5 |
| **可通关装配真实 COMPLETE + 真实领奖** | ✅ 成立（见 §4） | 本轮 RUN-2 |
| 失败结算 → 返回主界面 → 不发奖、不删档 | ✅ 成立 | 本轮 RUN-1（默认炮 FAILED）+ 既有 `e2e:product-fail` |
| **换装确实改变下一局 Build（改装再战）** | ✅ 成立（见 §4） | 本轮 RUN-3 |
| 同一真实 Profile 数据贯通（库存跨局累积） | ✅ 成立 | 本轮 E3 |
| 回首页 / 失败重试无白屏、零运行时报错 | ✅ 成立 | 本轮 E4 + 既有 E2E |
| 领奖幂等（重复领取不重复发奖） | ✅ 成立 | 本轮 C4 + 既有 `e2e:product-loop` G1~G3 |

---

## 4. 实际技术验收报告（真实浏览器证据）

> 以下终态由 `npm run e2e:demo-continuous-run` 在同一全新 Profile 上连续跑出，每个终态都有进入→退出的浏览器证据，失败不当 PASS。

### 4.1 连续 Run 终态一览（本轮真实跑批结果）

| 局 | 装配 | 终态 | 用时 | 领奖 |
|---|---|---|---|---|
| RUN-1（默认 cannon，不换装） | cannon + watermelonBody + 默认轮 | **FAILED** | 24.6s | 否（不发奖） |
| RUN-2（machineGun+mangoBody+双 smallWheel） | 同上 | **COMPLETE** | 38.4s | 是（machineGun ★1 1→2） |
| RUN-3（machineGun+durianBody+双 smallWheel） | 同上 | **FAILED** | 28.6s | 否（不发奖） |

> 三次真实 Run 各有唯一终态；同一真实 Profile 贯通。RUN-2 在 bounded 重试内保证至少一次真实 COMPLETE（随机对手 ⇒ 不恒胜，如实记录，失败不当 PASS）。
> RUN-3 的 FAILED 是**诚实记录**：`durianBody` 不在 machineGun 的可通关车身集合内（可通关车身是 `mangoBody`），说明「不同合法装配」不一定都能赢——这正是队列要求的「如实计入」而非「3 连胜」。

### 4.2 关键判据

- **B1** RUN-1 默认 cannon 装配在 UI 唯一默认路线下**真实 FAILED** —— 设计风险实证。
- **B2** 失败局不发证：回首页 `claim === null`、machineGun 库存零变动。
- **C1~C4** RUN-2 可通关装配真实 COMPLETE → 真实领奖（claimed=ok，被领武器 +1）→ 重新挂载首页不再重复发奖（幂等）。
- **D1~D2** RUN-3 出发装配 = durianBody + machineGun + 双 smallWheel，且与 RUN-2 的 mangoBody 不同 ⇒ **换装真实传入下一局**。
  - ⚠️ 实现注：Run 探针的 `playerLoadout.functionalSelections` **只暴露武器槽**，`durianBody` 由 `bodyDefId` 读出、轮组由正式 Build 存档的 `frontWheelDefId`/`rearWheelDefId` 读出（轮组不在 `functionalSelections` 内，与武器硬点分开存储）。本判据车身/武器读探针、轮组读存档，分别核对。
- **E1~E4** 全程 ≥1 次真实 COMPLETE + 领奖；所有失败局均未发证；machineGun ★1 终值 = 自然 1 + 真实 COMPLETE 次数；零运行时报错。

> **本轮结论**：`npm run e2e:demo-continuous-run` = **19/19 PASS，0 FAIL，0 BLOCKED**；**零产品代码改动**（仅新增验收脚本 + 本报告）。

### 4.3 预存红 / 随机 BLOCKED（诚实披露）

- **预存红（与本轮无关，HEAD 基线即存在，非本轮引入）**：`e2e:product-loop` 等历史 E2E 中已登记的陈旧族（见 REF §21 未决台账）；本轮**零产品代码改动**，未引入新红。
- **随机 BLOCKED**：本 Demo 候选不依赖固定胜局；若 RUN-2 在重试上限内仍 FAILED，则按 BLOCKED 诚实登记，不伪绿（既有 `e2e:fresh-account-slice` 同口径）。

---

## 5. 设计风险：首局 cannon 4/5 vs 可通关 machineGun 1/5

> 这是本 Demo 候选**唯一的核心体验问题**，需真人裁决，**不应由技术 PASS 默认成立**。

- **自然 4/5 的恰好是不能通关的 `cannon`**：`FRESH_STACK_SEED` 把 cannon 抬到 ★1 4/5（让「首胜即满」体验成立的前提），但 cannon 在 UI 唯一能发的 DEFAULT 路线下**零命中 / 恒 FAILED**（终局 `RangedTurret` 控距）。
- **能通关的 `machineGun` 起点只有 1/5**：R5 内容池只给保底 1 件 ⇒ 玩家要合成 ★2 需连续 **4 次真实胜利**（奖励池 = 出发武器，1→5 需 +4）。
- **后果**：全新账号若不**主动**进 Garage 换装（默认 cannon），第一局必败；即便换 machineGun，首局也只 1/5，体验不到「满 stack / 合成」的爽点。
- **这不是 bug**（Physics / 伤害 / 数值 / 库存全部未动），是**引导 / 可玩性议题**。

### 两个最简单方案（供设计负责人决定，本 Queue 不擅自改）

1. **暴露路线选择 UI**：让玩家在首页/出征前能选 `rush` / `heavy` 等路线（cannon 在 `rush` 有 COMPLETE）→ 默认 cannon 也能赢，但会改变「UI 唯一默认路线」契约。
2. **调整初始配置 / 奖励密度**：把 machineGun 起始也抬到 4/5，或把 cannon 在 DEFAULT 终局的命中补上（改数值 / 初始种子）—— 直接动「首局初始装备 / 通关难度 / 奖励经济」，需单独授权。

---

## 6. 全部已存在的局外功能（out-of-run features）

按真实首页 / 车库探针与既有 E2E 盘点（均为**已存在**、本队列未新增未删改）：

- **首页（Home）**：当前装备展示、可通关资格判读（`runCompat`）、开始冒险链接生成、领奖回执（`claim`）、自然成长初始化入口。
- **调整战车（Garage）**：车身 / 前轮 / 后轮 / 武器 四槽真实点选装配；当前装备展示；星级 + 数量 / 5 读数；**满 5/5 出现「可合成」徽标 + 合成按钮**；对非完整-Run 武器给出明确守门提示（「尚不支持这件武器进行完整冒险 / 请先调整战车」）。
- **合成（Fuse）**：★1→★2（满 stack 阈值 5），合成后 equipped 自动升星、装配保留。
- **奖励领奖（Reward）**：终点三选一候选收窄为「本局装备的主武器」一件；底部唯一 CTA「领取并返回」；账本 token 幂等（同一 Run 不可重复领、换件也领不到）。
- **失败结算（Fail）**：「冒险失败」面板（标题 + 失败 DAY + 最终改装 + 耐久耗尽）+ 唯一 CTA「返回主界面」→ 纯首页、不发奖、不删档。
- **研发 / 调试入口（非玩家路径，仅列示）**：`run-page.html`（demo 装载）、`portrait-lab.html`、`encounter-lab.html`、`validation-hub.html`、`height-line-lab.html`、`gadget-lab.html`、`content-batch.html`、`next-run.html`。
- **验证中心（Validation Hub）**：独立入口，含「完整一局」等四张卡片。

---

## 7. 结论：哪些真已成立 / 哪些需真人裁决

**真已成立（技术验收通过）**：全新账号零注入即可走完「Garage→完整 Run→胜败结算→奖励→改装再战」连续闭环；可通关装配真实 COMPLETE 并真实领奖；失败真实结算且不发奖；换装真实改变下一局 Build；同一 Profile 数据贯通；无白屏 / 零运行时报错。

**需真人裁决（核心体验问题，非技术缺陷）**：
1. **默认 cannon 打不赢 UI 唯一默认路线** ⇒ 全新玩家第一局必败，除非主动换装。
2. **可通关 machineGun 起点仅 1/5** ⇒ 合成 ★2 须连续 4 胜，首局体验不到满 stack 爽点。
3. 这两个是**引导 / 起始配置 / 路线可选性**议题，已由 §5 给出两个最简方案，待设计负责人定夺；本 Queue 依纪律**未改任何产品代码 / 数值 / 初始配置**。
