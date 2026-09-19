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
  `fb982be` 起 **R1-C 端到端主循环**（本轮收口；SHA 见当日 log）；更早查 `git log`。
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
- ⚠️ **HTML 注释里禁止出现注释终止序列**（两个连字符紧跟一个右尖括号）⇒ 注释提前闭合、
  其后文本按真标签解析 ⇒ 真实鼠标点**任何位置**整页重载（R1-A 起埋 3 轮，`e2e:product-home` 的
  `B1` 根因）；**症状极具误导性**（渲染/`elementFromPoint`/`node.click()` 全正常，只有真实鼠标失效）。
  完整排查法 + 3 条 E2E 书写坑（件数别写死 / 探针字段别串用 / reload 后视图回默认态）→ REF_GUARDS **§4**；
  守卫 `PL-33`。

## 3. 各功能面 → 细节在 REF / 交接文档
战斗参数 §A · 相机 §B · 接缝与第一层冻结值 §C · RUN-R1 §D · BUILD-01 §E · RUN-02 §F/§J/§K · M2 种子 §G ·
M3 遭遇台 §H · Hub §I · M2-R1 终点态出口 §L · PBL-RDC §M → `REF_PRP_RUNTIME.md`。
⚠️ **不在 REF、只看交接文档**：`PRP-M3-CONTENT-BATCH-01` · `PBL-M3-LIGHT-SWARM-EXPERIENCE-VALIDATION-R1` ·
`PRODUCT-LOOP-R1-A` · `PRODUCT-LOOP-R1-B` · **`PRODUCT-LOOP-R1-C`（端到端主循环）**。
启动两行：`cd D:\0818new\最强水果` → `npm run dev`（默认进**产品首页**；研发用 `dev:home` / `dev:next-run` /
`dev:encounter-lab` / `dev:validation`）。

## 4. Next action
- ✅ **产品主循环已打通并交付**（R1-C）：首页 → 调整战车 → 开始冒险 → 局内 → COMPLETE → 领永久部件 →
  回 Garage 可见 → 装上 → 第二局第一场真的用它。闭环 E2E **41/41**；门禁全绿（明细见当日 log / 交接文档）。
  ⚠️ 用户明令**停止继续扩 Validation / Lab / 局内内容**；Queue 完成即**停等**，不要自行开 Queue D。
- ⚠️ **待用户裁决（4 条，别自作主张改）**：① 装备交接口径 = 传整份 `BuildDraft`（href ≈1KB）；
  ② Weapon A 定为 `cannon`；③ 产品默认车 `front` 槽清空（主循环可达性处置，附实测矩阵）；
  ④ 第二局只跑到「第一场」为止。
- ⚠️ **明确未做（只记录不改）**：Garage 观感 / 奖励动画 / 内容量 / Buff 平衡 / 挂点几何与推杆反推的深修
  （后者属独立 Queue）。
- ⚠️ **后续段缺口**：`planckBattleOrchestrator.ts:217-218` 硬编码两车 + `battleContract.ts:96-98` 只有 A/B 胜负 +
  `runBattleRuntime.ts:355` 只取 `enemies[0]`；唯一 1vN 宿主 = DEBUG `arenaA.ts:814`。
- ⚠️ **LightSwarm 真人结论仍未收到**；真人已裁决：路边改装件 ✅ 保留；废弃修理站 ❌ 假选择、不进正式内容池。
- ⚠️ **PRP 各轮录屏回执未归档**（唯一未闭环项）。
