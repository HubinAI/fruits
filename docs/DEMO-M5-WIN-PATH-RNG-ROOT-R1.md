# DEMO-M5-WIN-PATH-RNG-ROOT-R1 — 通关胜率 / 失败根因调查报告

> Queue：`DEMO-M5-WIN-PATH-RNG-ROOT-R1`｜branch `prototype-portrait-battle-lab`｜HEAD 起点 `5ca6b02`
> 性质：**只查根因 + 修测试证据**，零产品代码改动，不改正式玩法。完成后停止，等待设计拍板。

---

## 0. 一句话结论

**战斗内核无 RNG、装配链无丢失；19/19 与 14/17 的差异来自「帧批次粒度敏感性」（环境时序）叠加「强化选择敏感的胜率断层」（策略前提）。** 本机修证后 E2E 复跑 22/22 PASS 且帧健康实测 60fps 零长帧；确定性矩阵同时证明：durian 变体 **6/6 全败**、默认 cannon **9/9 全败**、mango+machineGun 通用池 6 组强化只有 **4 组 COMPLETE**（rateUp 起手必败）。

---

## 1. 根因判定（必改 3）：混合 —— 主体 B（遇敌/时序）+ C（策略前提），排除 A（状态丢失）

### 1.1 排除 A：装配链三源一致（无 Runtime/状态丢失）

全链静态取证（file:line）：

| 环节 | 真源 | 证据 |
|---|---|---|
| Garage 存档 | `strongfruit.playerBuild.v1` 的 `frontWheelDefId`/`rearWheelDefId` | `playerLoadout.ts:1148`（`equipMovement` 唯一写入口，**同步写 radius**，:1204-1212） |
| 出发 URL | `buildAdventureHref` → `equipped=` 参数，`encodeRunLoadout` 原样携带轮组 defId | `runReward.ts:301-313, 188-200` |
| Run 页输入 | `parseExternalDraft` 保留 `rearWheelDefId`/`frontWheelDefId` | `runPlayerLoadout.ts:95-100` |
| Snapshot→Runtime | `resolveEntity` → `resolveSnapshot().movements`（radius/mass/grip 进物理） | `entities.ts:195-225`；轮体真建见 `runMovementCanonical.ts:20-24` |

浏览器实测（修正后 E2E 的 D1/D4/A6，本报告 §4）：三源逐字段相等。**「装配丢失」不存在**——上一轮日志里的 `front:none rear:none` 是**测试侧误读**（`functionalSelections` 的 `front`/`rear` 键是 functional 硬点，恒 `'none'`，与轮组无关），本轮已改读 URL `equipped` 载荷与存档。

### 1.2 判定 B 成立：战斗内核零 RNG，但**帧批次粒度改变战斗结果**

**零 RNG 的机器证明**：
- 产品 Run 脚本 = 固定线性链 `ProtoRusher → Chaser → RangedTurret`（`runScript.ts:194/216/239`），**没有随机选敌**——`pickOpponentForTier`/`OPPONENT_POOL` 属 Matching 流程（`playerGameRuntime.ts:797`），不在产品 Run 里；
- CHOICE 池结构性非随机（`runPageState.ts:545`，按节点声明 + 剔除已拥有）；
- 物理 = 固定步累加器（`planckWorld.ts:1017`，`FIXED_STEP_MS=16.67`）+ `settleToGround` 消出生分叉（`planckBattleOrchestrator.ts:292`）；战斗契约明令禁 `Math.random`（`battleContract.ts:72/117/133`）；
- W-02：同参数复跑 3 次，逐场 winner/HP/steps/逐发伤害**逐字相同**。

**但帧批次粒度是真实分叉源**（W-03 实测，mango+machineGun+双small 满血单打）：

| 对手 | 8ms | 16.67ms(60fps) | 32ms | 64ms |
|---|---|---|---|---|
| ProtoRusher | A 胜 (709) | A 胜 (709) | A 胜 (769) | A 胜 (710) |
| **Chaser** | **A 胜 (763)** | **A 胜 (763)** | **B 胜（玩家 HP=0）** | A 胜 (494) |
| RangedTurret | A 胜 (390) | A 胜 (390) | A 胜 (310) | A 胜 (470) |

机制（静态定位）：`runPage.ts:1612` 用 `dt = Math.min(64, now - lastFrameMs)` 喂 `RunBattleRuntime.step` → `world.step` 累加器把一帧切成 0~4 个固定步。批次边界（哪些固定步落在同一次 `orchestrator.step` 调用里）随帧率漂移，而：
- `drainProjectileContactFacts`（弹丸接触事实消费）在**每帧**执行一次（`planckBattleOrchestrator.ts:457`），不是每个固定步一次 ⇒ 同一物理步序列下，弹丸命中判定的**批次归属**随帧边界变化；
- arena 阶段推进 `update(steps*FIXED_DT_MS)` 也是批次粒度（:473）。

W-03c 抖动仿真：本机 60fps 附近 ±2/6ms 抖动 + 偶发 30-40ms 长帧，10 个 seed 全部 A 胜（Chaser 场 HP 762-763，几乎无衰减）——**本机帧率下结果稳定**；但帧节奏落入 ~32ms 区间（低性能沙箱 / 无 GPU 环境 / 后台节流）即翻转。GPT 实跑环境五战全败与此吻合（沙箱环境 rAF 慢且抖）。

### 1.3 判定 C 成立：胜率断层精确落在「强化选择」上（确定性可复测）

W-01a（mangoBody+machineGun+双smallWheel，默认路线，全部 6 组合法强化）：

| 强化序 | 终态 | 逐场 (winner: 我方HP/敌方HP, steps) |
|---|---|---|
| emergencyRepair→damageUp | **COMPLETE** | B1:A(709/0,715) B2:A(760/0,626) B3:A(390/0,875) |
| emergencyRepair→rateUp | **COMPLETE** | B1:A(709) B2:A(760) B3:A(390) |
| damageUp→emergencyRepair | **COMPLETE** | B1:A(709) B2:A(613) B3:A(291) |
| damageUp→rateUp | **COMPLETE** | B1:A(709) B2:A(613) B3:A(53) |
| **rateUp→emergencyRepair** | **FAILED** | B1:A(709) B2:A(293) **B3:B(0/360)** |
| **rateUp→damageUp** | **FAILED** | B1:A(709) B2:A(293) **B3:B(0/725)** |

关键事实：
- **rateUp（攻速）起手的两条合法路线确定性必败**：B2 Chaser 只剩 293 HP（vs 613/760），进终局被 RangedTurret 控距磨死；
- W-01b：**durianBody+machineGun+双small 6/6 全 FAILED**（满血单打连 RangedTurret 都输，W-04）——M5 E2E 的 RUN-3「变体装配」本身是死路（E2E 只断言换装传播，从未断言它能赢，但把它当「合法装配演示」是误导）；
- W-01c：默认 watermelonBody+cannon+缺省轮 **9/9 全 FAILED**（9 条 Cannon 合法强化路线全部倒在 B3 RangedTurret，敌方满 1100 未破）——与 M5 RUN-1 实测一致；
- W-04（满血零强化单打）：mango+mg 三段全胜（709/762/390）；durian+mg 输 RangedTurret（0/240）；default-cannon 输 RangedTurret（0/980，敌方几乎满血）。

### 1.4 两次浏览器实跑差异的完整解释（验收 3）

| 因素 | 19/19 那次（本机） | 14/17 那次（GPT 环境） |
|---|---|---|
| 内核 RNG | 无（固定链+确定性物理，W-02） | 同一无 RNG |
| 装配链 | 三源一致 | 同一链路（若真丢装配，D4 式断言会 FAIL——本轮修后 22/22 无一 FAIL） |
| **帧节奏** | 60fps 零长帧（本轮实测 median 16.7ms） | 沙箱/远端环境 rAF 慢且抖 → 长帧落入 32ms 翻转区间 |
| **强化选择** | POLICY = emergencyRepair→damageUp（4/6 完全相同的必胜序） | 若点击落点/时序差异导致选中 rateUp（或池首项不同）→ 确定性必败 |

⇒ **严格区分**：不是状态 Bug（A 排除）；「随机对手」的说法不成立（Run 无随机选敌）；差异 = **环境帧时序（B）** × **强化选择路径（C）** 的确定性组合。任何一次「五战全败」都可在确定性矩阵里找到对应行（rateUp 起手 / durian / cannon）。

---

## 2. 已交付的测试证据修正（必改 1 / 必改 4，全部测试侧，零产品代码）

### 2.1 `tests/_e2e_demo_continuous_run.cjs`（修正）

1. **轮组来源纠正**：`startLoadout.front/rear` 不再读 `functionalSelections['front'/'rear']`（functional 硬点，恒 'none'——上一轮 `front:none rear:none` 误导日志的根源），改读**出发 URL `equipped` 载荷**的 `frontWheelDefId`/`rearWheelDefId`（Run 页实际收到的输入）；
2. **三源一致性断言**（A6 出发预检 + D4）：存档 BUILD_KEY ↔ URL `equipped` 载荷 ↔ Run 探针逐字段相等，任一分叉 = 装配丢失（明确 FAIL）；
3. **缺键语义**：全新账号首次装备前 BUILD_KEY 不落盘 ⇒ 按「缺省 draft（watermelonBody+cannon、无轮组键）」对待；
4. **帧健康采样**（D5，新增 `sampleFrameHealth`）：在真实 BATTLE 期间采 rAF 帧时长，长帧（≥32ms）占比 ≥20% ⇒ 判「胜负读数处于可被帧时序翻转的区间」（PASS 门槛 <20%；本机实测 0.0%，median 16.7ms）；
5. 帧采样在 **Run 页上下文**启动（先导航后采样）+ 20s 超时竞速，避免跨页导航销毁执行上下文。

### 2.2 `tests/productDemoWinPathRngRootR1.test.ts`（新增只读调查，8 测试）

W-01a/b/c 确定性胜负矩阵（默认路线 × 全合法强化组合）、W-02 复跑一致性（内核无 RNG 证明）、W-03/03b/03c 帧批次粒度敏感性 + rAF 抖动仿真、W-04 三 chassis × 三对手满血单打普查。全部走 M2 底座（`runContentBatchCase`/`runSingleBattle`，真物理零 RNG），不复制长 E2E。

### 2.3 E2E 修正后本机复跑（22/22 PASS，0 FAIL，0 BLOCKED）

- RUN-1 默认 cannon **FAILED** 24.9s（末探针 hp=18/1100）→ 不发证 → 干净回首页；
- RUN-2 mango+machineGun+双small **COMPLETE** 39.4s → 真实领奖 machineGun 1→2 → 幂等 ok；
- RUN-3 durian+machineGun+双small **FAILED** 26.5s → 换装传播三源一致 → 不发证；
- 帧健康：n=481，median=16.7ms，p95=17.6ms，**长帧 0（0.0%）**——与本机 W-03 60fps 轨道（全胜）自洽。

---

## 3. 预存红 / 已知限制（如实）

- 本轮新增/修改的测试全部通过（8/8 调查 + 22/22 E2E），**未引入新红**；
- 仓库既有预存红（HEAD 基线即存在，见 MEMORY §0 未修清单：`validateSnapshot` 星级缺口、`e2e:next-run`、`gadget-lab` 登记、RP-21/F1/G1-05 等族）本轮未触碰、未扩大；
- W-03c 抖动仿真只覆盖 ±6ms + 40ms 长帧档位；「GPT 环境帧分布」无法本机复现，结论以其「五战全败」与确定性矩阵的行匹配为准；
- E2E 的 RUN-3 仍选 durian 变体（保持与上一轮可对照）；确定性矩阵已证其为死路，是否换成可胜变体属设计裁决（见 §4-B）。

---

## 4. 最小产品修法建议（≤2，**须拍板，未擅自改**）

### A. 帧粒度鲁棒化（治「同装配同强化不同结果」）
把弹丸接触事实消费从「每帧一次」（`planckBattleOrchestrator.ts:457`）改为「每个固定步末尾一次」，并让 `RunPage.startLoop` 按固定步切分长帧（每步独立 `step` 调用）——批次边界不再影响战斗结果，任何设备帧率下「同装配同强化」必然同结果。
**预期玩家体验变化**：胜负只由装配与强化选择决定；低端机不再出现「同样的车换台手机就打不过」。

### B. Demo 出发引导精确化（治「玩家落入必败装配/强化」）
把可通关口径从「machineGun 系」收敛到精确配方：**mangoBody + machineGun + 双 smallWheel + 强化选 修耐久/加伤害 起手（勿先选攻速）**；在 Garage/出发前做纯 UI 提示（不改数值），并把 Demo 变体装配从 durian 换成可胜底盘。
**预期玩家体验变化**：首局不再「合法却必败」；玩家按提示装配即进入可通关区间，成长闭环（5/5→★2）在 4~5 局内可达。

> 两者正交：A 治「确定性被时序污染」，B 治「确定性结果是坏结局」。均须设计负责人单独授权。

---

## 5. 下一 Queue 建议

- **`DEMO-FRAME-STEP-DETERMINISM-R1`**（若拍板修法 A）：targeted 触达 `planckBattleOrchestrator` 的 drain 时机 + `RunPage.startLoop` 步进切分，冻结「16.67/32/64ms 三粒度同结果」为回归锁（复用本轮 W-03 轨道）。
- **`DEMO-LOADOUT-GUIDE-R2`**（若拍板修法 B）：UI 提示 + E2E 变体装配替换，零数值改动。
- 无论拍板与否：`e2e:demo-continuous-run` 现在自带三源装配断言与帧健康门，后续任何「胜负翻转」先看 D5 读数再下结论。
