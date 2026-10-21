# Fruits - Memory Index（不变量+陷阱+下一步+指针）

**只放「不变量 + 陷阱 + 下一步」+ 指针。逐轮明细 / 实测数字 / 契约全文不在这里。**

| 要找什么 | 增量逐轮明细 | 现状快照 | 守卫/陷阱/契约全文 | 跨窗口续接 |
|---|---|---|---|---|
| 去哪 | `memory/YYYY-MM-DD.md`（最新 2026-10-21） | `REF_GUARDS_TRAPS_CONTRACTS.md` §21 | 同 REF §1–§20 | **`docs/handoff/MAC_TO_WINDOWS_20261021.md`（权威）** + `archive/交接文档_*.md` |

## 0. 现状 / 下一步（新窗口先读）
- **最新轮 = Mac→Windows 迁移交接（2026-10-21）**：HEAD `dbc5b8a`（GARAGE-V2-FUSE-MODAL-R1，功能链尾），local=remote，工作区 clean。交接文档 `docs/handoff/MAC_TO_WINDOWS_20261021.md`（仓库/分支/结构/命令/已完成/限制/方向B/PVP/冻结/陷阱 全在内）。Garage 2.0 正式接入已完成：`b13e6df` 七档→战斗桥接 → `28a8209` 武器品质穿戴 → `6435db3/b17e19c/d8e0171` 轮组+推进器 → `fe8c359/3f0316c` 正式切片与五合一 → `ad8a34f` 默认入口切换 → `2f99b88` 交互结构重做 → `d1e6764` 合成入口入背包标题行 → `dbc5b8a` 合成改居中弹窗。
- **最高门槛（等 Queue）**：产品方向 B（竖屏 / 完整冒险 >3min / 短物理战斗串联）**仅研究未立项**；真人 PVP 暂停但**不删代码与设计**。Body 无数量模型 ⇒ 品质 Body 不可穿不可合（`body-not-consumable`）；旧 ★2..5 `legacy-star-locked`；微信侧仍是旧 Canvas Garage（未接 Garage 2.0）。未部署 Pages、未合并 main。
- **预存红闭集**：全量 vitest 18 failed = 逐字一致基线（T20、R22a、F1-R1/R2、G1-05、R2-09/10、LSE-04/21、NR-14、RC-06b/c、RP-21/27、H-05、EB-04、PC-14、PR-27；PL-26 已登记修复 19→18）。**判红必先建 HEAD 独立 worktree 复现**。
- **候选下一步（等 Queue，不自动开工）**：方向 B 原型方案（未立项）、`E2E-STALE-ROUTES-REFRESH-R1`（product-home 10 条 / next-run 崩溃 = 陈旧族，独立 Queue）、`CONTENT-BATCH-EXPANSION-R2`、`CONTENT-ENCOUNTER-PLAYABLE-BATCH-R2`（每批须同步 3 处 `LAB_ENCOUNTERS` 计数守卫）。旧候选保留。

## 1. Identity / 链尾 / 边界
- Repo `HubinAI/fruits`｜分支 `prototype-portrait-battle-lab`｜舞台 844×390（竖版产品页 390×844）。
- 链尾（细 SHA 查 `git log`）：… 30a4176 Garage 2.0 四连 → b13e6df → 28a8209 → 6435db3 → b17e19c → d8e0171 → fe8c359 → 3f0316c → ad8a34f 默认入口切换 → 2f99b88 UX 三修 → d1e6764 合成入口 → **dbc5b8a 合成弹窗（功能链尾）** → 迁移交接 commit。
- ⚠️ `src/product/` 新模块**必须**在 `tests/productLoopHomeGarage.test.ts` PL-26 白名单（闭集）登记。
- 每轮必交边界取证：`git diff --stat -- src/{core,battle,physics,render,player,platform,game,presentation,ui}` + `git diff --exit-code -- src/core/content.ts src/battle/contactRouter.ts`。
- R7 防回归：通用成长只浅合并 `behaviorParams`；Cannon 三池 / `RUN_MODIFIERS` 未动；改 `nextRunValidation` 前读 REF §19d。

## 2. 红线速查（Mac + WorkBuddy 完整红线见 REF §1–§20）
- 先 `export PATH=/Users/yy/.workbuddy/binaries/node/versions/22.22.2-6/bin:$PATH`（宿主 Node 22 vs 项目 Node 24）。
- ⚠️⚠️ **vitest 池口径（踩过）**：vitest 4.1.10 无 `vmForks` 池；稳态 `--pool=forks --maxWorkers=1` **逐文件串行**——重物理文件同跑在 free mem ~867MB 下必 OOM（exit 137/SIGKILL）；`spawnSync` 必拒 ⇒ 环境假失败。
- E2E **串行**（端口不可复用）；长 E2E 后台跑（M5 ≈ 5 分钟）；`e2e:product-reward` 后台跑；`waitForURL(/home\.html/)` 假绿 ⇒ pathname 谓词；`R22b`：Lab 外零 `portrait-lab` 字样；页面模块级零 DOM；`/` 由 `branchDevEntry.ts` 重写。
- 复验 PRP 先 build（`emptyOutDir:false`）；守卫红 ⇒ 强化不放宽；新守卫负控制 + grep 零残留；node 无 localStorage ⇒ 桩；UI 入口真浏览器验证；冻结契约先 STOP；**禁 stash**；不帮起 dev server；**诊断只诊断**。
- ⚠️ **批量替换 home.html 大段 CSS 后必须逐类名核对旧块**（踩过：2f99b88 漏掉 `.g2-fuse-btn/-ready/-dot` ⇒ 合成按钮退化成浏览器默认按钮 31×38，E2E 当时只断言节点存在没抓到）。E2E 断言 UI 元素时必须同时断言**可见尺寸/父容器/对齐**，否则位置或样式崩了仍假绿。
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
