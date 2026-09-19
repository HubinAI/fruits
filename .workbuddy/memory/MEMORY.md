# Fruits - Runtime Memory Index

**只放「不变量 + 陷阱 + 下一步」。** 实测数字 / 逐帧时间线 / 各轮 Queue 细节**不在这里**。

| 要找什么 | 去哪 |
|---|---|
| 本轮做了什么、实测数字 | `.workbuddy/memory/YYYY-MM-DD.md`（最新 `2026-09-19.md`） |
| **改动前必读**：结构守卫 / 环境陷阱 / Stable contracts / Rules / 存档链 | `.workbuddy/memory/REF_GUARDS_TRAPS_CONTRACTS.md` |
| PRP 运行时细节（战斗参数 / 相机 / 接缝 / 入口 / file:line） | `.workbuddy/memory/REF_PRP_RUNTIME.md` §A–M |
| 每个 Queue 完整交付说明 | repo-root `交接文档_YYYY-MM-DD_<Queue>.md`（**本地件，不入库**） |
| 更早完整版 / 项目级共识与边界（最高权威） | `.workbuddy/memory/archive/` · `最强水果_项目核心共识与开发边界_WorkBuddy_Memory.md` |

## 1. Identity / 链尾
- Repo `git@github.com:HubinAI/fruits.git` | dir `D:\0818new\最强水果` | 工作分支 `prototype-portrait-battle-lab`
  （实验，可整块删）；主线 `foundation-02-wechat`。正式名 **PRP｜Portrait Run Prototype**。
- **链尾**：`c0d2c5d`+`69c4d1e` R1-A（局外配车）→ `f1b87a2`(+`fb982be`) R1-B（永久部件奖励）→
  `4f0be1a` R1-C（端到端主循环）→ `c63408c` R1-D（失败结算 → 返回主界面）→
  **`c40977a` R2-A 通关 3选1 → 数量累积**（永久成长 R2 起点；起点 `a0e9fba`）；更早查 `git log`。
- 全链对 `src/{core,physics,render,player,platform,ui,game,presentation}` diff **恒为空**（已机器取证）。

## 2. 红线速查（全文 → REF_GUARDS §1–2）
- 环境：禁 `git stash`；四路 SHA 前先 `git fetch`；`git commit -F` 传 **Windows 路径**；排除 `交接文档_*.md` 用
  **显式路径** `git add`；bash 前 `export PATH="/usr/bin:/bin:$PATH"`；vitest `--pool=vmForks --maxWorkers=1`
  + **独占机器**。
- ⚠️ **入口唯一性**：根路径 `/` 由 dev-only `build/branchDevEntry.ts` 重写到默认入口（**R1-C 起 = `/home.html`**）；
  守卫禁把 dev 入口逻辑写进 `vite.config.ts`（`vite.config.ts` 不得含 `BRANCH_DEFAULT_DEV_ENTRY` 字面量）。
  研发入口（`/run-page.html` / Hub / Lab / `index.html`）**一个都没删**。
- ⚠️ **`R22b`：`src/`（Lab 之外）0 处 `portrait-lab` / `portraitBattleLab` 字样 —— 注释里也不能提**（含产物路径）。
- ⚠️ Lab `ALLOWED_RELATIVE_IMPORTS` 是闭集 ⇒ **Lab 内读不到正式存档 ⇒ 产品页只能放 `src/product/`**。
- ⚠️ 页面模块**级零 DOM**（自挂载放 `*Main.ts`）；导航只写常量交给 `<a href>`（`RP-25`/`RP-25b`/`PL-29`）。
- ⚠️ **加根 html 同步 5 处（挂 Hub 7 处）**；加 Hub 入口 **4 处硬断言**（最易漏**顺序断言**）。
- ⚠️ **跨轮复验 PRP 前必须先 build**（`emptyOutDir:false` ⇒ 陈旧 chunk ⇒ 假 FAIL）。
- ⚠️ 改实现导致源码守卫失败 ⇒ **强化守卫，不放宽**。
- ⚠️ **两个终态各有唯一出口、地址全由产品侧给**（R1-D / R2-A）：
  **COMPLETE 的出口 = 三张候选卡各自带的 `choices[].href`（`buildClaimHref`）**，
  **`exitHref` 在 COMPLETE 恒 `null`、底栏按钮不可用**（3选1 不存在「默认那件」）；
  `home` = **纯首页**（FAILED，`parsePendingClaim` 恒 null ⇒ 绝不入库）。
  Lab **不硬编码任何产品 URL**，失败**不接受任何隐式推进**（顺序最易写反 ⇒ `RP-D-06` 机器钉死）。
  改动终态出口前必读 REF_GUARDS **§5 + §6**。
- ⚠️ **R2-A 地址层契约**：R1-B 的「一个 `back`」已被 **`choices` 载荷**取代
  （`{stack, choices:[{defId,star,countBefore,href}]}`）；三条 href **共用同一 run token**
  ⇒ 幂等键是 token 不是地址（「换一件」也领不到）。库存数量**只能由产品侧传**（Lab 读不到正式存档）。
- ⚠️ **像素阈值必须按面积推导**，不要凭印象：3×362×68 = 73848 px²，实测 `cardBg` 58822 ⇒ 取 55000。
- ⚠️ **E2E 像素取证必须在「点那张卡之前」**：点中即整页导航 ⇒ `#run-canvas` 为 `null`。
- ⚠️ **HTML 注释里禁止出现注释终止序列**（两个连字符紧跟一个右尖括号）⇒ 注释提前闭合、
  其后文本按真标签解析 ⇒ 真实鼠标点**任何位置**整页重载（R1-A 起埋 3 轮，`e2e:product-home` 的
  `B1` 根因）；**症状极具误导性**（渲染/`elementFromPoint`/`node.click()` 全正常，只有真实鼠标失效）。
  完整排查法 + 3 条 E2E 书写坑（件数别写死 / 探针字段别串用 / reload 后视图回默认态）→ REF_GUARDS **§4**；
  守卫 `PL-33`。

## 3. 各功能面 → 细节在 REF / 交接文档
战斗参数 §A · 相机 §B · 接缝与第一层冻结值 §C · RUN-R1 §D · BUILD-01 §E · RUN-02 §F/§J/§K · M2 种子 §G ·
M3 遭遇台 §H · Hub §I · M2-R1 终点态出口 §L · PBL-RDC §M → `REF_PRP_RUNTIME.md`。
⚠️ **不在 REF、只看交接文档**：`PRP-M3-CONTENT-BATCH-01` · `PBL-M3-LIGHT-SWARM-EXPERIENCE-VALIDATION-R1` ·
`PRODUCT-LOOP-R1-A` · `PRODUCT-LOOP-R1-B` · `PRODUCT-LOOP-R1-C`（端到端主循环）·
`PRODUCT-LOOP-R1-D`（失败链 / 终态出口，契约见 REF_GUARDS §5）·
**`PRODUCT-LOOP-R2-A`（3选1 / 数量累积 / 成长模型，契约见 REF_GUARDS §6）**。
启动两行：`cd D:\0818new\最强水果` → `npm run dev`（默认进**产品首页**；研发用 `dev:home` / `dev:next-run` /
`dev:encounter-lab` / `dev:validation`）。

## 4. Next action
- ✅ **永久成长 R2 的起点已落地（R2-A）**：通关 → **3选1** 真实武器 → 选中那件**进局外库存并累积数量** →
  回车库看到 `★1 ×N`（满 5 显示 `5/5`）→ 装上 → 下一局真的用它。失败侧继续完全冻结（零 count 变化）。
  新 E2E：`e2e:product-reward` **39/39**（本轮重写，含真实像素 A/B）、`e2e:product-loop` **48/48**；
  全量 vitest **2213/2213**；`src/core/**` **一行未动**。门禁全绿（明细见当日 log / 交接文档）。
  ⚠️ 用户明令**停止继续扩 Validation / Lab / 局内内容**；Queue 完成即**停等**，不要自行开下一条 Queue。
- ⚠️ **下一步（等用户下令）**：**Queue B = 合成动作**（5 件 → 升星）。当前已备好的接口：
  `playerLoadout.weaponEntries()` 的 `threshold` / `stackText` / `reachesThreshold`（与卡片同源）、
  core 既有 `canFuse(...).need = 5`（真源）。**不要**自行开工。
- ⚠️ **待用户裁决（R2-A 新增 3 条，别自作主张改）**：① `openGrowthSession(draft)` **一参**签名
  （把「先判 fresh 再取库存」的顺序收进函数内部，否则种子静默失效）；② 新账号起点 `cannon ×4`
  是产品数值决策；③ 第二局验证**必须换回 cannon**（内容强度矩阵：只有远程炮能稳定通关）。
- ⚠️ **待用户裁决（R1-D 新增 4 条，别自作主张改）**：① 路 A（页面级改道）而非改状态机
  （`runStartsNewRun` 对 FAILED 的返回保持原样）；② 两个回程地址 `home` vs 候选地址的新接口口径；
  ③ 失败结算面板复用 COMPLETE 卡片槽位（零新常量）；④ E2E 失败路线取 `hammer`（第一场即死 ≈16s）。
- ⚠️ **R1-C 遗留待裁决（4 条）**：① 装备交接口径 = 传整份 `BuildDraft`（href ≈1KB）；② Weapon A 定为 `cannon`；
  ③ 产品默认车 `front` 槽清空；④ 第二局只跑到「第一场」为止。
- ⚠️ **发现但未修（先前遗留，建议独立 Bug Queue）**：`e2e:next-run` 在 `N29` 后崩溃
  （`tests/_e2e_next_run.cjs:619` 等 Hub 入口**恰好 3 个**，但 `validationHub.ts` 现有 **4** 个 ——
  第 4 个 `contentBatch` 由 `bab5f63` 加入，早于 R1-D **7 个提交**，已 `merge-base --is-ancestor` 取证）。
  按「门控缺陷拆独立 Queue、禁混并 scope」**只记录不修**。
- ⚠️ **明确未做（只记录不改）**：Garage 观感 / 奖励动画 / 内容量 / Buff 平衡 / 挂点几何与推杆反推的深修
  （后者属独立 Queue）。
- ⚠️ **后续段缺口**：`planckBattleOrchestrator.ts:217-218` 硬编码两车 + `battleContract.ts:96-98` 只有 A/B 胜负 +
  `runBattleRuntime.ts:355` 只取 `enemies[0]`；唯一 1vN 宿主 = DEBUG `arenaA.ts:814`。
- ⚠️ **LightSwarm 真人结论仍未收到**；真人已裁决：路边改装件 ✅ 保留；废弃修理站 ❌ 假选择、不进正式内容池。
- ⚠️ **PRP 各轮录屏回执未归档**（唯一未闭环项）。
