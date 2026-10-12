# Fruits - Memory Index（不变量+陷阱+下一步+指针）

**只放「不变量 + 陷阱 + 下一步」+ 指针。逐轮明细 / 实测数字 / 契约全文不在这里。**

| 要找什么 | 去哪 |
|---|---|
| 本轮明细 / 实测数字 | `memory/YYYY-MM-DD.md`（最新 `2026-10-12.md`） |
| **现状快照（滚动台账）** | `REF_GUARDS_TRAPS_CONTRACTS.md` **§21** |
| 守卫 / 环境陷阱 / §1–§20 契约全文 / 未决台账 §A | 同上 REF（改前必读） |
| **跨窗口续接（先读）** | `docs/handoff/NEW-WINDOW-PROMPT.md` + `archive/交接文档_*.md` ×6 |
| 结构口径 / Mac / 已证伪 | `docs/handoff/CURRENT_STATE.md` 等三件套 |

## 0. 现状 / 下一步（新窗口先读 · 明细 → REF §21）
- HEAD 段起点 `7eeb60f`；分支 `prototype-portrait-battle-lab`（实验可删）；Mac arm64。
- **最新轮 = `DEMO-DOMINANT-BUILD-ROOT-R1`（A-mango-cannon 通吃根因诊断）** → REF §21a。
- ⚠️⚠️ **该轮不可误判的一条**：A 的通吃 = **车顶高度**（不是质量/扭矩/cannon 数值）——
  `mango+small` 车顶 minY **645** > 敌机枪弹线中位 **641.3** ⇒ 弹**掠过**（唯一 0 命中格）；
  其余底盘车顶 626–637 ⇒ 被压制弹命中 37–47 次。A 因此活到**场地收束阶段**由尖刺墙收割
  （1100 掉血里武器只占 600）。**banana 更轻(mass 45<48)却输 ⇒ 「越轻越强」已证伪**；
  扭矩亦证伪；前两场对底盘 **7/7 全不敏感**。回归 = `productDominantBuildRootR1`（4 测试）。
  上一轮 `DEMO-FULL-RUN-BUILD-VALUE-R1`：A 稳定 3/3 通吃，B/C 全败、D 仅 rush ⇒ 停止条件触发。
- ⚠️ **诊断轮口径**：只诊断、不调平衡 / 不加血量 / 不做假克制；取证走
  「输入装配 → 正式逻辑 → Runtime → 实际战果」四段标注；`以可运行测试为准，不沿用文字结论`。
- ⚠️ **勘误教训（踩过）**：「HF 4/4 无解 / A,D 各丢 2 格」曾与可运行矩阵冲突 ⇒ 任何判断
  必须来自实测跑批，**禁止抄写看似等价的相邻单元格**。
- **候选下一步**：① GADGET-EARN-PATHWAY-R1 ② 默认车平衡 Queue ③ ARCHIVE-RESTORE-RESILIENCE-R1
  ④ DOC-COMPAT-REFRESH-R1 ⑤ PL-26 白名单 Bug Queue。**等 Queue，不自动开工**。
- ⚠️ **未修 → 独立 Bug Queue（禁顺手并改）**：① `validateSnapshot` 星级缺口
  （`buildValidator.ts:54`）② `e2e:next-run` 崩（期望 3 实际 4）③④ 注释陈旧 ×2 ⑤ PC-14 预存红
  ⑥ PL-26 白名单缺 `../core/partOptions`。旧「浏览器无 COMPLETE」已被 `67414d2` 取代。
- **未做别再 ask**：观感 / 动画 / 内容量 / Buff / 挂点几何 / 逐武器差异化；saw / spear 不动；
  watermelon gadget 挂点近 rear 是验收通过态；GVL 预设 = 死代码。

## 1. Identity / 链尾 / 边界
- Repo `HubinAI/fruits`｜主线 `foundation-02-wechat`｜舞台 844×390。
- 链尾（细 SHA 查 `git log`）：R8 → R9 → `67414d2` 浏览器 COMPLETE → `76faafc` 移除隐藏锤 →
  R10 → R11（laser cd 600 `content.ts:1004`；rammer restSteps 24 `:674`）→ R12 → R13 →
  Mac 迁移 + E2E 入册 → cruise → Gadget 12 连 → `fbb3e05` → 2026-10-12 段见 REF §21c。
- ⚠️ `src/product/` 新模块**必须**在 `tests/productLoopHomeGarage.test.ts` **PL-26** 白名单（闭集）登记。
- 每轮必交边界取证：`git diff --stat -- src/{core,battle,physics,render,player,platform,game,presentation,ui}`
  + `git diff --exit-code -- src/core/content.ts src/battle/contactRouter.ts`。
- R7 防回归：通用成长只浅合并 `behaviorParams`；Cannon 三池 / `RUN_MODIFIERS` 未动；
  改 `nextRunValidation` 前读 REF §19d。

## 2. 红线速查（Mac + WorkBuddy 宿主）
- 先 `export PATH=/usr/local/bin:$PATH`（宿主 Node 22 vs 项目 Node 24）；vitest 必须
  `--pool=vmForks --maxWorkers=1` **独占**；`child_process.spawnSync` 必拒 ⇒ rc 两文件红 = 环境假失败。
- `e2e:product-reward` **后台跑**；E2E **串行**；`waitForURL(/home\.html/)` 假绿 ⇒ 必须 pathname 谓词；
  `R22b`：Lab 外零 `portrait-lab` 字样；页面模块级零 DOM；`/` 由 `branchDevEntry.ts` 重写。
- 复验 PRP 先 build（`emptyOutDir:false`）；守卫红 ⇒ **强化不放宽**；新守卫必须负控制 + grep 零残留；
  node 无 localStorage ⇒ 桩；UI 入口真浏览器验证；冻结契约先 STOP；**禁 stash**；
  不帮起 dev server；**诊断只诊断**。
- 速记：星级 `1+0.25×(star−1)` 真源 `buildSnapshot.ts:33`；FAILED 动作随 `href` 变；
  装载资格 = 存在性；cannon 基线 80；奖励固定 cannon ★1；音频真凶 `stopBattleAudio()` 未被调；
  **判「够不够得着」一律用 `minGap`**（`finalGap` 会骗人）。
- ⚠️ **反向陷阱（新）**：**`minGap` 大 ≠ 没交火** —— mango+heavy 的 minGap 123 却挨了
  41 发机枪弹（远程压制不受接触与否影响）⇒ 判「有没有被打」要看**掉血事件**，不能靠 `minGap`。
