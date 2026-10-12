# Fruits - Memory Index（不变量+陷阱+下一步+指针）

| 要找什么 | 去哪 |
|---|---|
| 本轮明细 | `memory/YYYY-MM-DD.md` |
| 守卫/契约/台账 | `REF_GUARDS_TRAPS_CONTRACTS.md`（止于 R7） |
| **跨窗口续接（先读）** | `docs/handoff/NEW-WINDOW-PROMPT.md` + `archive/交接文档_*.md` ×6 |
| 结构口径/Mac/已证伪 | `docs/handoff/CURRENT_STATE.md` 等三件套 |

## 0. 现状（2026-10-12 · 新窗口先读）
- HEAD=`56c3d41`+DEMO-BUILD-COUNTER-R1；分支 `prototype-portrait-battle-lab`，Mac arm64。
- ⚠️ **DEMO-BUILD-COUNTER-R1（最新）**：4×3 换装矩阵证明**假设通过**——换装真实改变战局
  （9/12 格胜负翻转，无稳定通吃）。克制①对 RushRammer 用远程/爆发；②对 HighGunPlatform
  **必须弹道武器**（hammer 0 命中全灭）；HeavyFortress 4/4 无解=平衡留白。
  下一轮多局候选集 = **RushRammer + HighGunPlatform**。回归=`productBuildCounterR1`。
  ⚠️ Garage `editable` 只有 WEAPON_SLOT（`playerLoadout.ts:979`）⇒ top/front/rear 槽不可写。
- ⚠️ **DEMO-ENCOUNTER-CONTENT-BATCH-R1（最新）**：3 套压力画像候选入 `LAB_ENCOUNTERS`
  （目录 7→**10**，LabEncounterId 闭集同步 +3）——HeavyFortress（R1-HVY-01 重型停驻，
  **mango 玩家打不过=高压**）/ RushRammer（R1-RUSH-01 冲锤贴身）/ HighGunPlatform（R1-GUN-02
  站桩远程）；全部正式模板引用 count=1、无 enemyDrive、**不进 RUN_SCRIPT**（三场未动）。
  回归 = `productEncounterContentBatchR1`；相邻断言 R5/M3-05 已同步 7→10（登记扩展非放宽）。
- ⚠️ **DEMO-REAL-ACCOUNT-PATH-R1**：疑点否定、零产品改动——**装配资格=拥有(count>0)
  非副本数**（`canEquipMovement`/`equipMovement`），smallWheel ×1 装双轮合法；
  空存档→正式初始化→装配→三段 COMPLETE→领奖→再开局已钉为回归 `productRealAccountPathR1`。
- **DEMO-PLAYABLE-PATH-R1**：通关基线 `tests/productDemoPlayablePathR1.test.ts`——
  chassis = **mangoBody+cannon+smallWheel×2**，Build = `fastReload→emergencyRepair`，余量 203.4；
  **默认 4 Body × cannon = 0 COMPLETE**（西瓜车打不完，平衡留白）。
- ⚠️ **RUN-WEAPON-GROWTH-R1**：审计前提不成立——R7 通用成长全链生效，假源头=
  runCompatibility R6-BATCH 过时注释（已修订）；当前三段链 zero 无一 COMPLETE（含 cannon）。
  ⚠️ 既有红：PL-26 白名单缺 `../core/partOptions`（`8fb5978` 引入，待独立 Bug Queue）。
- **最新轮 = Gadget 第三层闭环**（12 Queue `1be27d8`→`6b0356a`）：正式链
  gadgetDefId→…→createPlanckVehicle（独立 gadgetHardpoints）→Behavior→Renderer 已通；
  GS-06 实测与全文 → archive 最新交接文档。
- ⚠️ Thruster/ReverseThruster = 同一 `behavior:'thruster'` 两 mode（far:gap>280 冲 / near:gap<175 撤），**禁拆**；
  `gadgetHardpoints` ≠ `functionalHardpoints`。
- ⚠️ **已解冻（用户授权勿判 bug）**：`GARAGE_SLOT_ORDER` 4→5（gadget 最后，前四槽未变 `homePage.ts:179`）、
  labels+辅助、`OFFICIAL_PARTS` 11→12（+reverseThruster）。
- ⚠️ **P0-1 拿不到 Gadget**：`STARTER_PARTS`（`partInventory.ts:36`）无 gadget + 奖励只发武器
  ⇒ 槽可见装不上；唯一途径 Demo `?resetdev=1`。
- ⚠️ **P0-2 过时记录**：`runCompatibility.ts:74-82`（hammer D3/rammer D2/laser D1 阵亡）43 commit 未复测；
  同文件 ：60-70「强化全 Cannon 专属」与 R7 通用成长**口径冲突**，复测前勿改注释。
- **Strict Matrix = 28/11**；hammer 0/rammer 0；工具≈42min 后台独占。
  已证伪勿走：R12 开火窗口、「hammer 够不着」、Encounter 顺序主因、单场矩阵代入三段链。
- **下一步 = 等 Queue**。候选：① GADGET-EARN-PATHWAY-R1 ② 默认车平衡 Queue（mango 基线对照）
  ③ ARCHIVE-RESTORE-RESILIENCE-R1 ④ DOC-COMPAT-REFRESH-R1 ⑤ PL-26 白名单 Bug Queue。
- ⚠️ **未修→独立 Bug Queue**：① validateSnapshot 星级缺口（`buildValidator.ts:54`）② e2e:next-run 崩
  （期望 3 实际 4）③④ 注释陈旧 ×2 ⑤ PC-14 预存红。旧「浏览器无 COMPLETE」已被 `67414d2` 取代。
- **未做别再 ask**：观感/动画/内容量/Buff/挂点几何/逐武器差异化；saw/spear 不动；
  watermelon gadget 挂点近 rear 是验收通过态；GVL 预设=死代码。

## 1. Identity / 链尾
- Repo `HubinAI/fruits`｜分支 `prototype-portrait-battle-lab`（实验可删）｜主线 `foundation-02-wechat`。舞台 844×390。
- 链尾：R8 奖励源=主武器 → R9 三段节奏 → `67414d2` 浏览器 COMPLETE → `76faafc` 隐藏锤移除 → R10 →
  R11（laser cd 600 保留 `content.ts:1004`；rammer restSteps 回退 24 `:674`）→ R12 回退 → R13 →
  Mac 迁移+E2E 入册 → cruise → Gadget 12 连 → `fbb3e05`（细 SHA 查 git log）。
- `src/product/` 新模块必须 PL-26 登记（白名单闭集）。每轮边界取证：
  `git diff --stat -- src/{core,battle,physics,render,player,platform,game,presentation,ui}`
  + `--exit-code -- src/core/content.ts src/battle/contactRouter.ts`。
- R7 防回归：通用成长只浅合并 `behaviorParams`；Cannon 三池/`RUN_MODIFIERS` 未动；改 nextRunValidation 前读 REF §19d。

## 2. 红线（Mac + WorkBuddy 宿主）
- 先 `export PATH=/usr/local/bin:$PATH`（宿主 Node 22 vs 项目 24）；vitest 必须
  `--pool=vmForks --maxWorkers=1` 独占；spawnSync 必拒 ⇒ rc 两文件红=环境假失败。
- `e2e:product-reward` 后台跑；E2E 串行；`waitForURL(/home\.html/)` 假绿⇒pathname 谓词；
  R22b Lab 外零 `portrait-lab` 字样；页面模块级零 DOM；`/` 由 `branchDevEntry.ts` 重写。
- 复验 PRP 先 build；守卫红⇒强化不放宽；新守卫负控制+grep 零残留；node 无 localStorage⇒桩；
  UI 入口真浏览器验证；冻结契约先 STOP；禁 stash；不帮起 dev server；诊断只诊断。
- 速记：星级 `1+0.25×(star−1)` 真源 `buildSnapshot.ts:33`；FAILED 动作随 `href` 变；
  资格=存在性；cannon 基线 80；奖励固定 cannon ★1；音频真凶 `stopBattleAudio()` 未被调；
  判接触用 `minGap`。
