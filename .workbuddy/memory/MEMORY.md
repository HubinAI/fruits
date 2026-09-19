# Fruits - Runtime Memory Index

**只放「不变量 + 陷阱 + 下一步」。** 公式 / 实测数字 / 逐帧时间线 / 各轮 Queue 细节**不在这里**。

- 近日做了什么、实测数字 → `.workbuddy/memory/YYYY-MM-DD.md`（最新 `2026-09-19.md`）
- ⚠️ **改动前必读**：结构守卫 / 环境陷阱 / Stable contracts / **项目 Rules** / 正式存档链 →
  `.workbuddy/memory/REF_GUARDS_TRAPS_CONTRACTS.md`
- PRP 运行时细节（战斗参数 / 相机 / 接缝 / 入口 / file:line）→ `.workbuddy/memory/REF_PRP_RUNTIME.md` §A–M
- 每个 Queue 的完整交付说明 → repo-root `交接文档_YYYY-MM-DD_<Queue>.md`（**本地件，不入库**）
- 更早的完整版 → `.workbuddy/memory/archive/`；项目级共识与边界（最高权威）→
  `最强水果_项目核心共识与开发边界_WorkBuddy_Memory.md`

## 1. Identity / 链尾
- Repo `git@github.com:HubinAI/fruits.git` | dir `D:\0818new\最强水果` | 工作分支 `prototype-portrait-battle-lab`
  （实验，可整块删）；主线 `foundation-02-wechat`。正式名 **PRP｜Portrait Run Prototype**。
- **链尾**：`c0d2c5d`+`69c4d1e` PRODUCT-LOOP-R1-A → **`f1b87a2` PRODUCT-LOOP-R1-B**（永久部件奖励）；更早查 `git log`。
- 全链对 `src/{core,physics,render,player,platform,ui,game,presentation}` diff **恒为空**（已机器取证）。

## 2. 红线速查（全文 → REF_GUARDS §1–2）
- 环境：禁 `git stash`；四路 SHA 前先 `git fetch`；`git commit -F` 传 **Windows 路径**；排除 `交接文档_*.md` 用
  **显式路径** `git add`；bash 命令前 `export PATH="/usr/bin:/bin:$PATH"`；vitest `--pool=vmForks --maxWorkers=1`
  + **独占机器**。
- ⚠️ **入口唯一性**：根路径 `/` 由 dev-only `build/branchDevEntry.ts` 重写到 `/run-page.html`
  （守卫禁把 dev 入口逻辑写进 `vite.config.ts`）。
- ⚠️ **`R22b`：`src/`（Lab 之外）0 处 `portrait-lab` / `portraitBattleLab` 字样 —— 注释里也不能提**。
- ⚠️ Lab `ALLOWED_RELATIVE_IMPORTS` 是闭集 ⇒ **Lab 内写不了正式存档 ⇒ 产品页只能放 `src/product/`**。
- ⚠️ 页面模块**级零 DOM**（自挂载放 `*Main.ts`）；导航只写常量交给 `<a href>`（`RP-25`/`RP-25b`/`PL-29`）。
- ⚠️ **加根 html 同步 5 处（挂 Hub 7 处）**；加 Hub 入口 **4 处硬断言**（最易漏**顺序断言**）。
- ⚠️ **跨轮复验 PRP 前必须先 build**（`emptyOutDir:false` ⇒ 陈旧 chunk ⇒ 假 FAIL）。
- ⚠️ 改实现导致源码守卫失败 ⇒ **强化守卫，不放宽**。

## 3. 各功能面 → 细节在 REF / 交接文档
战斗参数 §A · 相机 §B · 接缝与第一层冻结值 §C · RUN-R1 §D · BUILD-01 §E · RUN-02 §F/§J/§K · M2 种子 §G ·
M3 遭遇台 §H · Hub §I · M2-R1 终点态出口 §L · **PBL-RDC §M** → `REF_PRP_RUNTIME.md`。
⚠️ **不在 REF、只看交接文档**：`PRP-M3-CONTENT-BATCH-01` · `PBL-M3-LIGHT-SWARM-EXPERIENCE-VALIDATION-R1` ·
**`PRODUCT-LOOP-R1-A`（局外配车）** · **`PRODUCT-LOOP-R1-B`（本轮：永久部件奖励）**。
启动两行：`cd D:\0818new\最强水果` → `npm run dev`（或 `dev:home` / `dev:next-run` / `dev:encounter-lab`）。

## 4. Next action
- ⚠️ **主线已切换**：用户明令「**停止继续扩 Validation / Lab / 局内内容**」，转入**正式产品主循环**
  （首页 → 调整战车 → 开始冒险 → 局内 → COMPLETE → 领永久部件 → 回 Garage 可见）。
- ⚠️ **B 轮已交付**：`RUN COMPLETE` 显示「本局获得（真实已有部件）」+ `领取并返回` ⇒ 写 Profile Inventory
  ⇒ 返回首页 ⇒ Garage 可见（`f1b87a2`，四路 SHA 一致）。
- ⚠️ **下一步 = Queue C** —— ⛔ 本对话**从未给出 Queue C 内容** ⇒ **必须向用户索取，不得自行开发 / 扩范围**。
- ⚠️ **待裁决 A 轮 4 条 + B 轮 4 条** / 挂起项 / low-prio → 明细见 `2026-09-19.md`。
- ⚠️ **后续段缺口**：`planckBattleOrchestrator.ts:217-218` 硬编码两车 + `battleContract.ts:96-98` 只有 A/B 胜负 +
  `runBattleRuntime.ts:355` 只取 `enemies[0]`；唯一 1vN 宿主 = DEBUG `arenaA.ts:814`。
- ⚠️ **LightSwarm 真人结论仍未收到**；真人已裁决：路边改装件 ✅ 保留；废弃修理站 ❌ 假选择、不进正式内容池。
- ⚠️ **PRP 各轮录屏回执未归档**（唯一未闭环项）。
