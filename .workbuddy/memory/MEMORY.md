# Fruits - Memory Index（不变量+陷阱+下一步+指针）

**只放「不变量 + 陷阱 + 下一步」+ 指针。逐轮明细 / 实测数字 / 契约全文不在这里。**

| 要找什么 | 去哪 |
|---|---|
| 本轮明细 / 实测数字 | `memory/YYYY-MM-DD.md`（最新 `2026-10-13.md`） |
| **现状快照（滚动台账）** | `REF_GUARDS_TRAPS_CONTRACTS.md` **§21** |
| 守卫 / 环境陷阱 / §1–§20 契约全文 / 未决台账 §A | 同上 REF（改前必读） |
| **跨窗口续接（先读）** | `docs/handoff/NEW-WINDOW-PROMPT.md` + `archive/交接文档_*.md` ×6 |
| 结构口径 / Mac / 已证伪 | `docs/handoff/CURRENT_STATE.md` 等三件套 |

## 0. 现状 / 下一步（新窗口先读 · 明细 → REF §21）
- HEAD `DEMO-M5-WIN-PATH-RNG-ROOT-R1` 提交后；分支 `prototype-portrait-battle-lab`；Mac arm64。
- **最新轮 = `DEMO-M5-WIN-PATH-RNG-ROOT-R1`（通关胜率/失败根因调查 + E2E 证据修正）** → 日 log 同日段。
  **结论（根因判定 = B+C 混合，排除 A）**：① **产品 Run 全链零 RNG**（脚本固定线性链
  ProtoRusher→Chaser→RangedTurret，`pickOpponentForTier` 只属 Matching 不在 Run；物理固定步累加器；
  W-02 复跑 3 次逐字相同）⇒「19/19 vs GPT 14/17 五战全败」**不是随机对手、不是状态 Bug**；
  ② **装配链无丢失**（Garage存档→`equipped=`URL→Run探针→`resolveEntity.movements` 三源一致；
  `front:none rear:none` 是 E2E 误读 functionalSelections——已修：轮组读 URL 载荷+存档，A6/D4 断言）；
  ③ **真凶一 = 帧批次粒度敏感性**：W-03 实测同场战斗 16.67ms 玩家赢 / **32ms 玩家输**（mango+mg vs
  Chaser）——`runPage.ts:1612` 按帧喂 step、`planckBattleOrchestrator.ts:457` 弹丸接触事实**每帧**
  drain 一次 ⇒ 批次边界随帧率漂移（沙箱/低性能环境翻转）；本机帧健康实测 0% 长帧；
  ④ **真凶二 = 强化选择断层**：W-01a mango+mg 通用池 6 组强化**只有 4 组 COMPLETE**（**rateUp 起手
  2 组必败**）；W-01b **durian+mg 6/6 全败**；W-01c 默认 cannon 9/9 全败。
  ⚠️⚠️ **新窗口必读**：① 零产品代码改动（只修 E2E 证据 + 新增只读调查测试 8 条 +
  报告 `docs/DEMO-M5-WIN-PATH-RNG-ROOT-R1.md`）；② E2E 修后 **22/22 PASS**（含 D5 帧健康门：
  长帧≥32ms 占比 ≥20% ⇒ 胜负读数记可疑区间）；③ 两个最小修法（帧粒度鲁棒化 `DEMO-FRAME-STEP-DETERMINISM-R1` /
  Demo 出发引导精确化）**须设计拍板，未擅自改**。
- ⚠️ **上轮 = `DEMO-M5-CONTINUOUS-RUN-RC-R1`（连续3+局真实Run Demo候选验收 · RC）** → 日 log 同日段。
- ⚠️ **上上轮 = `DEMO-M5-CONTINUOUS-RUN-RC-R1` 的候选下一步已升级**：`DEMO-DEFAULT-CANNON-CLEAR-PATH-R1`
  的设计裁决项仍开放；本轮又增两个候选 `DEMO-FRAME-STEP-DETERMINISM-R1`（修法A）/ `DEMO-LOADOUT-GUIDE-R2`（修法B）。
- ⚠️ **上上轮 = `DEMO-FRESH-ACCOUNT-VERTICAL-SLICE-R1`（全新账号真实纵切）** → 日 log 同日段。
  **结论：全新账号（零注入）可自己把 Demo 纵切走完**：起步自然库存 → Garage 真实换装 →
  **首局即 COMPLETE** → 领奖 → 连续多胜累到 5/5 → **合成 ★2** → 第二局干净出发。**产品代码零改动**；
  新增 `tests/_e2e_fresh_account_slice.cjs`（21/21 PASS）。
  ⚠️⚠️ **新窗口必读的三条**：
  ① **全新账号自然起点**：`FRESH_STACK_SEED`→cannon★1 **4/5**；`r3MovementChoiceSeed`→**smallWheel/largeWheel/
  heavyWheel 各×1**；`r4BodyChoiceSeed`→**mangoBody+durianBody**；`r5ContentPoolSeed`→其余正式 Weapon 各×1。
  ② **默认路线（UI 唯一能发，`buildAdventureHref` 不带 route）可通关的武器只剩**：machineGun 1 / shotgun 2 /
  laser 1；**cannon=0**（cannon 只在 `rush` 有 COMPLETE，而 UI 发不出 rush）。
  ③ ⇒ **核心张力**：自然 **4/5 的恰好是不能通关的 cannon**；能通关的 machineGun 起点 **1/5**
  ⇒ **合成 ★2 必须连续多局真实胜利**（奖励池=出发武器；1→5 需 4 胜）。**这不是 bug，是引导/可玩性议题**。
  ⇒ 缺口已在本轮 `DEMO-M5-CONTINUOUS-RUN-RC-R1` 报告 §5 作为**设计裁决项**披露（两种最小修法，**须独立授权**）。
- ⚠️ **上轮 = `CONTENT-ENCOUNTER-PLAYABLE-BATCH-R1`（遭遇台差异化实战扩展批次）** → 日 log 同日段。
  **交什么**：新增 `encounterBatchExtension.ts` + 3 套 Encounter 入 `LAB_ENCOUNTERS`（登记扩展）；
  控制器改**批次参数化**（构造注入 `EncounterLabBatch`，默认 = 原三敌）；`encounterLabMain.ts` 读
  `?batch=ext`。新增 targeted 单测（10）+ 扩展 E2E（38）+ `e2e:encounter-lab-ext`。
  ⚠️⚠️ **新窗口必读**：① **遭遇台「固定三敌守卫」不在控制器** —— `encounterLab.ts` **早已是批次泛化**
  ⇒ 扩展只**注入批次**即可，**无需大重构**（stop 条件未触发）；② 真正闭集约束 = `LAB_ENCOUNTERS`
  目录 + **3 处跨文件计数守卫**（`portraitEncounterLab` M3-05 / `portraitBattleLab` R5 /
  `portraitHeightLineLab` HL-02 的 `toHaveLength`）→ 本轮登记扩展 10→13，**三处都须同步**；
  ③ 三模板映射：`R1-HVY-02`→`ExtendedHeavyContact`、`R1-CTRL-01`→`ExtendedStandoffRod`、
  `R1-MIX-02`→`ExtendedBurnSaw`；④ **只改 HL-02 的断言计数，heightLineLab 页面/控制器零改动**。
  入口 = `dev:encounter-lab` → `encounter-lab.html?batch=ext`（默认页不带参数一字不变）。
- ⚠️ **上轮 = `CONTENT-BATCH-CREATION-PIPELINE-R1`（确定性 Run 测试底座 / Foundation）** → 日 log 同日段。
  ⚠️⚠️ **新窗口必读的两条**：① **产品只有 1 个武器槽** `WEAPON_SLOT='frontMass'`；`front`/`top`/`rear`
  是 functional 硬点**不是武器槽**（把 cannon 放 `front` = 非法，能量 120>110，底座红灯**正确**）。
  ② **9 例真实结果**：mgPrimary(machineGun×3) **三路线全 COMPLETE**；cannonWalk / mangoCannon
  **三路线全 FAILED**（cannon 系打不过 heavy/rush 是真**产品结果**，非底座 bug、非伪造）。
- ⚠️ **上轮 = `PRODUCT-FULL-LOOP-FOUNDATION-R1`（真实入口全闭环核查 + 修 2 处陈旧 E2E）** → 日 log 同日段。
  ⚠️⚠️ **核心事实（新窗口必读）**：**产品闭环逻辑完整可用**（权威矩阵 `productRunFullReachableSpaceR10`
  = **28 条 COMPLETE / 11 底盘**：cannon 1、flamethrower 1、machineGun 4、shotgun 4、laser 1；
  hammer·rammer 0）——**阻断的是「浏览器取证层」，不是产品**。根因一条：`76faafc`（2026-10-01
  「移除隐藏顶锤」）改了 `defaultPlayerDraft()`/`clearHiddenTopWeapon`，**vitest 同步了，浏览器 E2E 没同步** ⇒
  ① `e2e:product-loop` 的取胜装配（`coconutBody+后 heavyWheel`）失去隐藏锤**打不赢**，且其 `C4` 写
  `rc[0].href` **崩溃** ⇒ 静默失效；② `e2e:product-legacy` L8 期望漏清 `top`。
  该轮**只改 2 个 `tests/*.cjs`**（零产品代码）⇒ 修后 **loop 55/55 PASS、legacy 18/18 PASS**。
- ⚠️ **默认车打不赢（产品体验事实，禁改数值）**：`watermelonBody + cannon + 缺省轮` 在终局
  `RangedTurret` 控距下 **FAILED**；可通关需在 Garage 换 `mangoBody + 双 smallWheel`（machineGun 系）。
  ⇒ 「默认配置可通关性 / 引导」是独立产品议题（已登记，等 Queue）。
- 上轮 `DEMO-HEIGHT-LINE-READABILITY-R2`（Lab 取景强化：四带 302→344 + 近景裁切合成）→ REF §21a。
- ⚠️⚠️ **R2 核心数字**：官方 battle 相机 `scale` 实测 **0.41~0.64** ⇒ 3.7 世界像素车顶差在官页只渲染
  **≈1.5 逻辑像素**（看不出）。R2 近景窗 = **固定世界宽 170** ⇒ `pxPerWorld = 2.294`（恒定、与
  scale/轮径无关）、纵向锚在**车箱顶**（`roofScreenFrac = 0.35`）⇒ **相对正式取景放大 3.25~5.48×**；
  浏览器像素实测：车体宽 **315/390 逻辑px**、弹带在车顶上方 **15~17 逻辑px**（heavy 则 0 条 ⇒ 弹进入车身）。
  `RunBattleView` 新增**可选** `viewportScale`（默认 1 ⇒ 既有 Lab 页面逐像素不变）+ `blitRegion()`。
  ⚠️ 读数口径：S>1 时 `upscaleVsCamera` 会被误读，真值看 `upscaleVsOfficial`。
  ⚠️⚠️ **像素检测坑**：弹条是短亮条（~9 亮像素/行）⇒ 必须 `x += 1` + 阈值 `bc >= 3`，
  `x += 2`/`bc > 6` 在 **DPR1 下几乎全漏**（踩过）。
- ⚠️ **上轮 `DEMO-HEIGHT-LINE-VISUAL-LAB-R1`**：车高 × 水平弹道**对照台**（独立 Lab，只换轮径）→ REF §21a。
- ⚠️⚠️ **上轮 `DEMO-DOMINANT-BUILD-ROOT-R1` 不可误判的一条**：A-mango-cannon 通吃 =
  **车顶高度**（**不是**质量 / 扭矩 / cannon 数值）—— `mango+small` 车顶 **645** > 敌机枪弹线
  中位 **641.3** ⇒ 弹**掠过**（唯一 0 命中格）；其余底盘车顶 626–637 ⇒ 中弹 37–47 次。
  A 因此活到**场地收束阶段**由尖刺墙收割（1100 掉血里武器只占 600）。
  **banana 更轻(mass 45<48)却输 ⇒「越轻越强」已证伪**；扭矩亦证伪。回归 = `productDominantBuildRootR1`。
- ⚠️ **本轮口径**：Lab 只做**可玩对照**（正常速度看真实弹道/受击/收束），**不做**判定提示 /
  说明框 / 特效；装配走**既有** `playerDraft` 入口，零 config 覆盖。
- ⚠️⚠️ **Lab 目录的硬约束（R22a）**：import 面是**显式白名单闭集**，**且整目录禁 `platform/**`**
  （唯一例外 `playerViewport`）⇒ 页面**结构上不能**调 `equipMovement`（它必须经 `platform.storage`
  读库存）⇒ **合法性证据只能放测试侧**（`MemStorage` 桩跑同一条正式装配链、逐字段复现快照）。
  **这是登记式边界遵守，不是放宽守卫**；新开 Lab 页面会撞这条。
- ⚠️ **勘误教训（踩过）**：「HF 4/4 无解 / A,D 各丢 2 格」曾与可运行矩阵冲突 ⇒ 任何判断
  必须来自实测跑批，**禁止抄写看似等价的相邻单元格**。
- **候选下一步**：① **`DEMO-DEFAULT-CANNON-CLEAR-PATH-R1`**（默认车 cannon 打不过默认路线 ⇒ 首关引导/可玩性；
  本轮已作为**设计裁决项**披露两种最简修法，实际改动须单独授权，**不自动开工**）；
  ② **`CONTENT-ENCOUNTER-PLAYABLE-BATCH-R2`**（同机制再收 `R1-HVY-03`/`R1-GUN-01`/`R1-MIX-01`；
  ⚠️ 每批须同步 3 处 `LAB_ENCOUNTERS` 登记守卫）；③ **`CONTENT-BATCH-EXPANSION-R2`**（用底座
  `runContentBatchCase` 扩内容批测）。旧候选保留：真人录屏判车高差 / GADGET-EARN-PATHWAY-R1 /
  默认车平衡 / ARCHIVE-RESTORE-RESILIENCE-R1 / DOC-COMPAT-REFRESH-R1。**等 Queue，不自动开工**。
  `CONTENT-ENCOUNTER-PLAYABLE-BATCH-R1` 完成 → `22e05dd`；`DEMO-FRESH-ACCOUNT-VERTICAL-SLICE-R1` 完成 → 见链尾。
- ⚠️ **未修 → 独立 Bug Queue（禁顺手并改）**：① `validateSnapshot` 星级缺口
  （`buildValidator.ts:54`）② `e2e:next-run` 崩（期望 3 实际 4）③④ 注释陈旧 ×2 ⑤ PC-14 预存红
  ⑥ PL-26 白名单缺 `../core/partOptions` ⑦ **R2-10 / H-05 预存红**：`gadget-lab.html`
  （`dbbf27a` 加入根目录）从未登记进 `portraitDefaultEntry` 清单 / `NON_VALIDATION_PAGES`
  ⇒ **HEAD 即红**（已用独立 worktree 实测）。旧「浏览器无 COMPLETE」已被 `67414d2` 取代。
  ⑧ **R2 新证同族预存红**（Lab 测试数据扩容跑赢旧守卫，均已在 HEAD worktree 逐字复现）：
  `RP-21`（期望 18 实际 72）、`F1-R1`/`F1-R2`（期望 2/7 实际 6/10）、`G1-05`（期望 42 实际 60）。
  ⑨ **浏览器 E2E 陈旧族（R3 新证，同一根因 = `76faafc` 移除隐藏锤 + Garage 第 5 槽 gadget）**：
  `e2e:product-star-power`（B4/B4b+14 BLOCKED）、`e2e:product-reseed`（R4b/R4b2+R5c 夹具带 `top:'hammer'`）、
  `e2e:product-reward`（42 BLOCKED，同路线）、`e2e:product-next-run-continuity`（6 BLOCKED，同路线）、
  `e2e:product-home`（6 FAIL，期望 4 槽 / 2×2 几何，实际第 5 槽 gadget）。**非产品缺陷**
  —— 建议独立队列 `E2E-STALE-ROUTES-REFRESH-R1` 统一按权威矩阵+当前规则刷新。
  ⇒ **判红必先建 HEAD 独立 worktree 复现**（`git worktree add /tmp/x HEAD` + symlink node_modules），
  否则会把预存红误记到本轮账上。
- **未做别再 ask**：观感 / 动画 / 内容量 / Buff / 挂点几何 / 逐武器差异化；saw / spear 不动；
  watermelon gadget 挂点近 rear 是验收通过态；GVL 预设 = 死代码。

## 1. Identity / 链尾 / 边界
- Repo `HubinAI/fruits`｜主线 `foundation-02-wechat`｜舞台 844×390。
- 链尾（细 SHA 查 `git log`）：R8 → R9 → `67414d2` 浏览器 COMPLETE → `76faafc` 移除隐藏锤 →
  R10 → R11（laser cd 600 `content.ts:1004`；rammer restSteps 24 `:674`）→ R12 → R13 →
  Mac 迁移 + E2E 入册 → cruise → Gadget 12 连 → `fbb3e05` → 2026-10-12 段见 REF §21c →
  `PRODUCT-FULL-LOOP-FOUNDATION-R1` → `5e9abe6` E2E 陈旧族刷新 → `644bf4a` 归档 E2E 核查 →
  `f8a699f` CONTENT-BATCH-CREATION-PIPELINE-R1（确定性 Run 测试底座）→
  `22e05dd` CONTENT-ENCOUNTER-PLAYABLE-BATCH-R1（遭遇台扩展批次）→
  **`64d2b26` DEMO-FRESH-ACCOUNT-VERTICAL-SLICE-R1（全新账号真实纵切取证）**。
- ⚠️ `src/product/` 新模块**必须**在 `tests/productLoopHomeGarage.test.ts` **PL-26** 白名单（闭集）登记。
- 每轮必交边界取证：`git diff --stat -- src/{core,battle,physics,render,player,platform,game,presentation,ui}`
  + `git diff --exit-code -- src/core/content.ts src/battle/contactRouter.ts`。
- R7 防回归：通用成长只浅合并 `behaviorParams`；Cannon 三池 / `RUN_MODIFIERS` 未动；
  改 `nextRunValidation` 前读 REF §19d。

## 2. 红线速查（Mac + WorkBuddy 宿主）
- 先 `export PATH=/Users/yy/.workbuddy/binaries/node/versions/22.22.2-6/bin:$PATH`（宿主 Node 22 vs 项目 Node 24）。
- ⚠️⚠️ **vitest 池口径勘误（踩过）**：vitest **4.1.10 无 `vmForks` 池**（合法 = `forks`/`threads`/`vmThreads`）。
  旧文档写的 `--pool=vmForks` 是**陈旧口径**。稳态用法：`--pool=forks --maxWorkers=1`，且**逐文件串行**——
  R10 全枚举单文件约 **232s**、3 个重物理文件同跑在 free mem ~867MB 下**必 OOM 被杀（exit 137 / SIGKILL）**。
  `child_process.spawnSync` 必拒 ⇒ rc 两文件红 = 环境假失败。
- `e2e:product-reward` **后台跑**；E2E **串行**；`waitForURL(/home\.html/)` 假绿 ⇒ 必须 pathname 谓词；
  `R22b`：Lab 外零 `portrait-lab` 字样；页面模块级零 DOM；`/` 由 `branchDevEntry.ts` 重写。
- 复验 PRP 先 build（`emptyOutDir:false`）；守卫红 ⇒ **强化不放宽**；新守卫必须负控制 + grep 零残留；
  node 无 localStorage ⇒ 桩；UI 入口真浏览器验证；冻结契约先 STOP；**禁 stash**；
  不帮起 dev server；**诊断只诊断**。
- 速记：星级 `1+0.25×(star−1)` 真源 `buildSnapshot.ts:33`；FAILED 动作随 `href` 变；
  装载资格 = 存在性；cannon 基线 80；奖励固定 cannon ★1；音频真凶 `stopBattleAudio()` 未被调；
  **判「够不够得着」一律用 `minGap`**（`finalGap` 会骗人）。
- Lab 入口速查：`dev:height-line-lab` / `e2e:height-line-lab`（端口 8159，`await launchBrowser(chromium)`）；
  同族 `dev:encounter-lab` / `dev:gadget-lab` / `dev:next-run` / `dev:run-page`。
- ⚠️ **反向陷阱（新）**：**`minGap` 大 ≠ 没交火** —— mango+heavy 的 minGap 123 却挨了
  41 发机枪弹（远程压制不受接触与否影响）⇒ 判「有没有被打」要看**掉血事件**，不能靠 `minGap`。
