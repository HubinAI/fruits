# Fruits - Memory Index（不变量+陷阱+下一步+指针）

**只放「不变量 + 陷阱 + 下一步」+ 指针。逐轮明细 / 实测数字 / 契约全文不在这里。**

| 要找什么 | 增量逐轮明细 | 现状快照 | 守卫/陷阱/契约全文 | 跨窗口续接 |
|---|---|---|---|---|
| 去哪 | `memory/YYYY-MM-DD.md`（最新 2026-10-16） | `REF_GUARDS_TRAPS_CONTRACTS.md` §21 | 同 REF §1–§20 | `docs/handoff/NEW-WINDOW-PROMPT.md` + `archive/交接文档_*.md` |

## 0. 现状 / 下一步（新窗口先读）
- **最新轮 = Garage 2.0 系列（2026-10-16）**：起点 56aa253 → 功能链尾 30a4176 → HEAD `49435f1`（交接 memory log），local=remote，工作区 clean。4 Queue：`0a5485b` GARAGE-V2-QUALITY-FOUNDATION-R1（品质/实例模型+纯逻辑五合一）、`c945453` GARAGE-V2-LEDGER-COHERENCE-R1（实例恒等性+双账本写桥+装备真实落盘）、`6880db0` GARAGE-V2-INVENTORY-LAYOUT-LAB-R1（布局 Lab，存储完全隔离）、`30a4176` HOME-V2-MINIMAL-R1（正式首页极简化）。明细 → `docs/handoff/archive/交接文档_2026-10-16_garage-v2-foundation-lab-home_5217dff.md` + `docs/garage-v2/{G2-AUDIT,COH-API,BATCH-BC-README}.md` + 日 log 2026-10-16。
- **最高门槛（等 Queue）**：正式 Garage V2 接入未做——必须等「七档品质真能穿戴并影响 Run」独立验收；`equipQualityProduct` 仍 `run-not-wired`；7 档品质↔战斗强度映射（α 降维/β 扩曲线/γ 独立字段）未拍板 ⇒ 彩色格子不代表更强战斗。Body 无数量模型不开消耗（`body-not-consumable`）；旧 ★2..5 `legacy-star-locked`。未部署 Pages、未合并 main。
- **预存红闭集**：全量 vitest 18 failed = 逐字一致基线（T20、R22a、F1-R1/R2、G1-05、R2-09/10、LSE-04/21、NR-14、RC-06b/c、RP-21/27、H-05、EB-04、PC-14、PR-27；PL-26 已登记修复 19→18）。**判红必先建 HEAD 独立 worktree 复现**。
- **候选下一步（等 Queue，不自动开工）**：`DEMO-DEFAULT-CANNON-CLEAR-PATH-R1`、`DEMO-LOADOUT-GUIDE-R2`、`CONTENT-ENCOUNTER-PLAYABLE-BATCH-R2`（每批须同步 3 处 `LAB_ENCOUNTERS` 计数守卫）、`CONTENT-BATCH-EXPANSION-R2`、`E2E-STALE-ROUTES-REFRESH-R1`。旧候选保留。

## 1. Identity / 链尾 / 边界
- Repo `HubinAI/fruits`｜分支 `prototype-portrait-battle-lab`｜舞台 844×390（竖版产品页 390×844）。
- 链尾（细 SHA 查 `git log`）：…见 REF §21c 段 → PRODUCT-FULL-LOOP-FOUNDATION-R1 → 5e9abe6 E2E 陈旧族刷新 → 644bf4a 归档 E2E 核查 → f8a699f CONTENT-BATCH-CREATION-PIPELINE-R1 → 22e05dd CONTENT-ENCOUNTER-PLAYABLE-BATCH-R1 → 64d2b26 DEMO-FRESH-ACCOUNT-VERTICAL-SLICE-R1 → 56aa253 UX 感知三连 handoff → **30a4176 Garage 2.0 四连（功能链尾）**。
- ⚠️ `src/product/` 新模块**必须**在 `tests/productLoopHomeGarage.test.ts` PL-26 白名单（闭集）登记。
- 每轮必交边界取证：`git diff --stat -- src/{core,battle,physics,render,player,platform,game,presentation,ui}` + `git diff --exit-code -- src/core/content.ts src/battle/contactRouter.ts`。
- R7 防回归：通用成长只浅合并 `behaviorParams`；Cannon 三池 / `RUN_MODIFIERS` 未动；改 `nextRunValidation` 前读 REF §19d。

## 2. 红线速查（Mac + WorkBuddy 完整红线见 REF §1–§20）
- 先 `export PATH=/Users/yy/.workbuddy/binaries/node/versions/22.22.2-6/bin:$PATH`（宿主 Node 22 vs 项目 Node 24）。
- ⚠️⚠️ **vitest 池口径（踩过）**：vitest 4.1.10 无 `vmForks` 池；稳态 `--pool=forks --maxWorkers=1` **逐文件串行**——重物理文件同跑在 free mem ~867MB 下必 OOM（exit 137/SIGKILL）；`spawnSync` 必拒 ⇒ 环境假失败。
- E2E **串行**（端口不可复用）；长 E2E 后台跑（M5 ≈ 5 分钟）；`e2e:product-reward` 后台跑；`waitForURL(/home\.html/)` 假绿 ⇒ pathname 谓词；`R22b`：Lab 外零 `portrait-lab` 字样；页面模块级零 DOM；`/` 由 `branchDevEntry.ts` 重写。
- 复验 PRP 先 build（`emptyOutDir:false`）；守卫红 ⇒ 强化不放宽；新守卫负控制 + grep 零残留；node 无 localStorage ⇒ 桩；UI 入口真浏览器验证；冻结契约先 STOP；**禁 stash**；不帮起 dev server；**诊断只诊断**。
- 速记：星级 `1+0.25×(star−1)` 真源 `buildSnapshot.ts:33`；FAILED 动作随 `href` 变；装载资格 = 存在性；cannon 基线 80；奖励固定 cannon ★1；音频真凶 `stopBattleAudio()` 未被调；**判「够不够得着」一律用 `minGap`**（`finalGap` 会骗人）；**`minGap` 大 ≠ 没交火**（远程压制不受接触影响，判被打要看掉血事件）。
- Lab 入口速查：`dev:height-line-lab`（端口 8159）/ `e2e:height-line-lab` / `dev:encounter-lab` / `dev:gadget-lab` / `dev:next-run` / `dev:run-page` / `dev:garage-v2-lab`。

## 3. 不可误判的产品事实（已证伪，别再翻案）
- **默认车打不赢（产品体验事实，禁改数值）**：`watermelonBody+cannon+缺省轮` 终局 RangedTurret 控距下 FAILED；可通关需换 `mangoBody+双 smallWheel`（machineGun 系）。可通关武器（默认路线）：machineGun 1 / shotgun 2 / laser 1；cannon=0（rush 路线 UI 发不出）。自然起点 cannon★1 4/5 vs machineGun 1/5 ⇒ ★2 需连续 4 胜——引导/可玩性议题，非 bug。
- **武器/挂点**：产品只有 1 个武器槽 `WEAPON_SLOT='frontMass'`；`front`/`top`/`rear` 是 functional 硬点不是武器槽。Movement 缺省轮 = `wheelStd`（不进库存）；真实轮组 = smallWheel/largeWheel/heavyWheel。
- **权威矩阵** `productRunFullReachableSpaceR10` = 28 COMPLETE / 11 底盘：cannon 1、flamethrower 1、machineGun 4、shotgun 4、laser 1；hammer·rammer 0。
- **车顶高度证伪链**：A-mango-cannon 通吃 = 车顶高度（非质量/扭矩）——mango+small 车顶 645 > 敌弹线 641.3 ⇒ 弹掠过；banana 更轻(mass 45<48)却输 ⇒「越轻越强」证伪。回归 = `productDominantBuildRootR1`。
- **Lab 取景/像素陷阱（R2 踩过）**：官方相机 scale 0.41~0.64；R2 近景窗固定世界宽 170 ⇒ pxPerWorld 2.294 恒定，纵向锚车箱顶（roofScreenFrac 0.35）；读数看 `upscaleVsOfficial` 不看 `upscaleVsCamera`；弹条像素检测必须 `x+=1` + 阈值 `bc>=3`（`x+=2`/`bc>6` 在 DPR1 下几乎全漏）。
- **Lab 目录硬约束（R22a）**：import 面显式白名单闭集 + 整目录禁 `platform/**`（唯一例外 playerViewport）⇒ Lab 页面结构上不能调 `equipMovement`；合法性证据只能放测试侧（MemStorage 桩跑正式装配链）。登记式边界遵守，非放宽；新开 Lab 页面会撞这条。
- **勘误教训**：任何判断必须来自实测跑批，禁止抄写看似等价的相邻单元格。

## 4. 未修 → 独立 Bug Queue（禁顺手并改）
- ① validateSnapshot 星级缺口（buildValidator.ts:54）② e2e:next-run 崩（期望 3 实际 4）③④ 注释陈旧 ×2 ⑤ PC-14 ⑥ R2-10/H-05：gadget-lab.html（dbbf27a）未登记 portraitDefaultEntry/NON_VALIDATION_PAGES ⑦ RP-21/F1-R1/F1-R2/G1-05（Lab 测试数据扩容跑赢旧守卫，HEAD worktree 已复现）⑧ 浏览器 E2E 陈旧族（根因 76faafc 移除隐藏锤 + 第 5 槽 gadget）：star-power/reseed/reward/next-run-continuity/product-home。
- 判红流程：HEAD worktree 复现 → 预存红记基线账，非本轮；真缺陷拆独立 Bug Queue，禁混并 scope。

## 5. 未做别再 ask
观感/动画/内容量/Buff/挂点几何/逐武器差异化；saw/spear 不动；watermelon gadget 挂点近 rear 是验收通过态；GVL 预设 = 死代码。
