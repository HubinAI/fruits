# Fruits - Runtime Memory Index

**只放「不变量 + 陷阱 + 下一步」。** 实测数字 / 逐帧时间线 / 各轮细节**不在这里**。

| 要找什么 | 去哪 |
|---|---|
| 本轮做了什么、实测数字 | `.workbuddy/memory/YYYY-MM-DD.md`（最新 `2026-09-20.md`） |
| **改动前必读**：结构守卫 / 环境陷阱 / Stable contracts / Rules / 存档链 | `.workbuddy/memory/REF_GUARDS_TRAPS_CONTRACTS.md` |
| PRP 运行时细节（战斗参数 / 相机 / 接缝 / 入口 / file:line） | `.workbuddy/memory/REF_PRP_RUNTIME.md` §A–M |
| 每个 Queue 完整交付说明 | repo-root `交接文档_YYYY-MM-DD_<Queue>.md`（**本地件，不入库**） |
| 会话交接（跨窗口续接） | repo-root `交接文档_2026-09-20_SESSION-HANDOFF*.md` |
| 更早完整版 / 项目级共识与边界（最高权威） | `.workbuddy/memory/archive/` · `最强水果_项目核心共识与开发边界_WorkBuddy_Memory.md` |

## 1. Identity / 链尾
- Repo `git@github.com:HubinAI/fruits.git` | dir `D:\0818new\最强水果` | 工作分支 `prototype-portrait-battle-lab`
  （实验，可整块删）；主线 `foundation-02-wechat`。正式名 **PRP｜Portrait Run Prototype**。
- **链尾**：`c0d2c5d`+`69c4d1e` R1-A → `f1b87a2` R1-B → `4f0be1a` R1-C → `c63408c` R1-D → `c40977a` R2-A →
  `16a221f` R2-B → `9e4e88c` R2-C → `9841274` P0 → `9078cc5` PLP0-LEGACY → 各轮复核 doc commit
  （`1a9f4a0` R2-A / `5d47d98` R2-B / `115fe52` R2-C）；更早查 `git log`。
- ⚠️ **不变量在 R2-B 起被有意打破**：`src/{physics,render,player,platform,ui,game,presentation,lab}` diff 恒为空；
  **`src/core` 不再空** —— R2-B（`partInventory.ts` / `buildPersistence.ts`）、R2-C（`buildSnapshot.ts` 星级曲线
  唯一真源 + `types.ts` 注释）两处**必改**。**P0 / PLP0-LEGACY core 零改动**（全落 `src/product/` + tests）。
  每轮必交边界取证：冻结目录 `git diff` 为空 + `content.ts` / `contactRouter.ts` 零改动。

## 2. 红线速查（全文 → REF_GUARDS §1–2）
- **环境陷阱**（PATH / `git commit -F` Windows 路径 / 中文名八进制 / `git stash` 禁令 / vitest `--pool=vmForks
  --maxWorkers=1` 且**独占机器** —— 与 E2E / build 抢 CPU ⇒ **无关文件**报 5s 超时，**先单独重跑复现，别当真红**）
  → 用户级 `~/.workbuddy/MEMORY.md`（含 `refs/remotes/origin/` 为空时的四路口径）。
- 排除 `交接文档_*.md` 用**显式路径** `git add`（八进制转义 ⇒ grep -v 中文会失效）。
- ⚠️ **入口唯一性**：根路径 `/` 由 dev-only `build/branchDevEntry.ts` 重写到默认入口（**R1-C 起 = `/home.html`**）；
  守卫禁把 dev 入口逻辑写进 `vite.config.ts`（不得含 `BRANCH_DEFAULT_DEV_ENTRY` 字面量）。
  研发入口（`/run-page.html` / Hub / Lab / `index.html`）**一个都没删**。
- ⚠️ **`R22b`：`src/`（Lab 之外）0 处 `portrait-lab` / `portraitBattleLab` 字样 —— 注释里也不能提**（含产物路径）。
- ⚠️ Lab `ALLOWED_RELATIVE_IMPORTS` 是闭集 ⇒ **Lab 内读不到正式存档 ⇒ 产品页只能放 `src/product/`**。
- ⚠️ 页面模块**级零 DOM**（自挂载放 `*Main.ts`）；导航只写常量交给 `<a href>`（`RP-25`/`RP-25b`/`PL-29`）。
- ⚠️ **加根 html 同步 5 处（挂 Hub 7 处）**；加 Hub 入口 **4 处硬断言**（最易漏**顺序断言**）。
- ⚠️ **跨轮复验 PRP 前必须先 build**（`emptyOutDir:false` ⇒ 陈旧 chunk ⇒ 假 FAIL）；改实现导致源码守卫失败 ⇒
  **强化守卫，不放宽**。像素阈值**按面积推导**（3×362×68 = 73848 px²，实测 `cardBg` 58822 ⇒ 取 55000）。
- ⚠️ **E2E 像素取证必须在「点那张卡之前」**：点中即整页导航 ⇒ `#run-canvas` 为 `null`。
- ⚠️ **HTML 注释里禁止出现注释终止序列**（两个连字符紧跟一个右尖括号）⇒ 注释提前闭合、其后文本按真标签解析
  ⇒ 真实鼠标点**任何位置**整页重载（R1-A 起埋 3 轮，`e2e:product-home` `B1` 根因）；**症状极具误导性**
  （渲染 / `elementFromPoint` / `node.click()` 全正常）。排查法 + 3 条 E2E 书写坑（件数别写死 / 探针字段别串用 /
  reload 后视图回默认态）→ REF_GUARDS **§4**；守卫 `PL-33`。

### 2a 终态出口（R1-D §5 · R2-A §6）→ REF_GUARDS §5/§6
**两终态各有唯一出口、地址全由产品侧给**：**COMPLETE 出口 = 三张候选卡各自的 `choices[].href`**
（`buildClaimHref`），`exitHref` 在 COMPLETE 恒 `null`、底栏按钮不可用；`home` = **纯首页**（FAILED，
`parsePendingClaim` 恒 null ⇒ **绝不入库**）。Lab **不硬编码任何产品 URL**，失败**不接受隐式推进**（`RP-D-06`）。
三条 href **共用同一 run token** ⇒ 幂等键是 token 不是地址；库存数量**只能由产品侧传**（Lab 读不到正式存档）。

### 2b 星级 / 合成（R2-B §7 · R2-C §8）→ REF_GUARDS §7/§8 全文
**锚点**：`weaponEntries` / `migrateLegacyStarterProfile:350` / `loadEquippedDraft:383` / `persistPlayerBuild:280`
（`playerLoadout.ts`）· `FRESH_STACK_SEED:149` / `canFuseStack:343` / `fuseStack:417`（`playerGrowth.ts`）。
三条最容易踩的：
- `starDamageMultiplier = 1 + 0.25 × (star − 1)` = **唯一真源**（★1..★5 = 1/1.25/1.5/1.75/2），
  **已取代** Q22 的 `STAR_TIER_DAMAGE_MULT = 1.15`（★3 与 ★2 会同伤害 ⇒ 别加回来）。
- `MAX_STAR = 2`（`partInventory.ts:426`）是**旧横屏融合规则**的上限 ⇒ **冻结、不许动**（与产品的
  `INVENTORY_MAX_STAR = 5` 是**两件事**）；产品侧合成**不复用** core 的 `fuseSameStar`（语义相反）。
- ⚠️ **`PR-27`**：产品侧 / 页面 / Lab **都不许自算**星级伤害，只许 import core 或读 `weaponEntries.damageText`。
- ⚠️ **`DAY = 1` 用「进入 Run 的瞬间」的 `runStart` 断**（第一场节点 `d2-battle1` 的 `day` = **2** ⇒ 战斗采样
  **断不出**新局起点）→ REF_GUARDS **§8g 第 6 条**；`RUN_FIRST_DAY = RUN_SCRIPT[0].day = 1`；E2E 断言名 `E1b`。
- 其余（`weaponMainDamage` 口径 / `saw` 边界 / `playerSnapshot` 层级 / 卡片按 `defId`+`star` 取 /
  合成按钮是兄弟节点 / E2E 合成段排最后 / 未满写 `4/5` / ★2 占 33 能量 / `damage` 事件 `timestamp` 恒 0）
  → **REF_GUARDS §8c–§8i**。

### 2c 完整 Run 装载资格（P0 §9）→ REF_GUARDS §9 全文
判据 = **存在性**（**不是槽位**），创建期与运行时 `throw` **同一函数**；产品侧 `fullRunCompat` 读
`install.defId` + `category==='weapon'` —— **星级是独立字段 `install.star`、不改 `defId`** ⇒
「partId+star 被当成新武器 ID」**结构上不可能**。拒绝在 **`new RunPage(` 之前**；不支持时**不给 href**
（探针 `startRunHref === null`）；拒绝时 `loadout` **必须是演示装载占位**（`'unsupported-loadout'` ≠ `'invalid'`）；
拒绝态视图独立成模块并登记 `RUN_PAGE_FILES`；`FULL_RUN_SUPPORTED_WEAPON_IDS`（产品）与
`RUN_BASE_WEAPON_DEF_ID`（Lab）**同值但各自声明** ⇒ 一致性只由 `LC-01` 钉死。
⚠️ **`applyRunModifiersToSnapshot` 的 throw 是刻意保留的强 invariant**（禁 silent skip / 吞异常）。
⚠️ **产品契约变更作废既有 E2E 路线 ⇒ 换合法路线 + 新增守门断言，不删断言**（P0：fail 27→34、loop 48→51）。

### 2d 旧 profile 迁移（PLP0-LEGACY §10）→ REF_GUARDS §10 全文
旧 starter 的 `front='pushRod'`（`makeStarterDraft`，`buildEditorModel.ts:182`，**至今未改**）每周期反推**自家车**
⇒ 完整 Run 第一场（DAY2）**稳定失败**。⚠️ **`migrateLegacy('build',…)` 对 build 是 no-op**
（`CURRENT_SAVE_VERSION = 1`）⇒ 不是 schema 问题、**core 里没有任何一层会碰它** ⇒ 只能产品侧做语义迁移。
**判别式（用户裁决「收紧」）** = **同时**满足 ①`front`/`frontMass` == `makeStarterDraft()` 取值（**签名取自真源
函数**）②`functionalStars?.front === undefined`（**所有**玩家侧写入都盖星级印记）。任一不成立 ⇒ **一字节不改**。
⚠️ **「见推杆就删」是错的** —— `editableSlots` 返回全部硬点（含 `front`），**正常玩家车库**就用它。
落点 `migrateLegacyStarterProfile()`（`:350`，**纯函数不落盘**）+ `loadEquippedDraft()`（`:383`，命中落盘一次）；
**无存档仍不写盘**（保 `core/onboarding.ts` 的 `=== null` 语义）；**结构上一次为限** ⇒ 无需标记位；
`PL-03` 钉「`savePlayerBuild(` 只准 1 次」⇒ 收进 `persistPlayerBuild()`（**守卫红了就强化实现，不放宽守卫**）。
⚠️ **实测：`drive` / 轮径 / 轮组真的会改变战斗结果** ⇒ 迁移不碰它们 ⇒ `drive='stationary'` 的旧存档
**迁移后仍可能失败**。Reachability Gate 管的是「**标准 Cannon 基线**」。**必改 4 未触发**。

## 3. 各功能面 → 细节在 REF / 交接文档
战斗参数 §A · 相机 §B · 接缝与第一层冻结值 §C · RUN-R1 §D · BUILD-01 §E · RUN-02 §F/§J/§K · M2 种子 §G ·
M3 遭遇台 §H · Hub §I · M2-R1 终点态出口 §L · PBL-RDC §M → `REF_PRP_RUNTIME.md`。
⚠️ **只在交接文档**：`R1-A/B/C` · `R1-D`(§5) · `R2-A`(§6) · `R2-B`(§7) · `R2-C`(§8) · `P0`(§9) · `PLP0-LEGACY`(§10)。
启动两行：`cd D:\0818new\最强水果` → `npm run dev`（默认进**产品首页**；研发用 `dev:home` / `dev:next-run` /
`dev:encounter-lab` / `dev:validation`）。

## 4. Next action
**R2 milestone（A/B/C）已全部复核并收口**，无功能缺口、无 BLOCK。近期门禁基线：`tsc` 零错 · 全量 vitest
**218 files / 2287 tests** · `build` / `build:pages` / `build:wechat`（`game.js` 1,415.83 kB） ·
`e2e:product-star-power` **21/21** · reward 48/48 · loop 51/51 · fail 34/34 · home 30/30 · legacy 17/17 ·
default-entry 86/86。**下一步 = 等用户裁决下表任一项，或下发新 Queue；用户已明令「不自行进入 R3」。**

| Queue | 未决项（全文在各自交接文档） |
|---|---|
| **R2-C**（4） | ① `validateSnapshot` 星级能量盲开 Bug Queue；② ★2 炮 33 能量 > `bananaBody` 90 容量是否加提示；③ `saw` 边界是否提前处理；④ 是否开 Body/Gadget 成长 |
| **PLP0-LEGACY**（4） | ① 判别式条件 ② 是否接受为**长期契约**（Q22 前旧档仍不可区分）；② `drive='stationary'` 自改致败是否开独立 Queue；③ 迁移是否在首页给提示（本轮**静默**）；④ P0 4 条仍有效 |
| **P0**（4） | ① 两条 E2E 路线替换是否接受；② 支持清单粒度 `['cannon']`；③ 拒绝态文案落点；④ `runBlockedView` 出口口径 |
| **R2-A**（1） | 必改 1「**必须**增加 schema version」= **唯一真实字面缺口**。⚠️ **硬冲突**：`saveVersion.ts:20` 明写「下次**破坏性**变更才 +1」，而 R2-A/B 都是**非破坏性扩展**。若提：`= 2` + no-op `upgrade_v1_to_v2` + 改写该注释。它是**全局**版本号（`build`/`inventory`/`progress`，`ownedParts` 与旧横屏共用）⇒ **已上报，未改** |
| **R2-B**（1） | 「**禁止再次出现 `MAX_STAR = 2`**」与现状冲突：它仍在 `core/partInventory.ts:426`（旧横屏，Q22 冻结，旧横屏测试当**域不变量**）；产品侧**完全不依赖** ⇒ 删它 = 改旧横屏 + Q22 系列全红 ⇒ **已上报，未改** |
| **R1-C/D** | 只升 `WEAPON_SLOT` 的星；`openGrowthSession(draft)` 一参签名；新账号起点 `cannon ×4` 是数值决策 |

**⚠️ 发现但未修（独立 Bug Queue，禁顺手并改）**：① `validateSnapshot` **不含星级倍率**（`:114` `def.energy`
vs `:48` `starTierEnergy`）⇒ Q22 漏改，由 FB-11b 钉死 ② `e2e:next-run` 在 `N29` 后崩溃（Hub 入口数 3 → 4，
`bab5f63` 加入）③ Lab `playerFunctionals()` 注释与实际不符 ⇒ 正确口径 = `runtime.playerSnapshot.functionals[].defId`。

**⚠️ 其它**：**明确未做**（只记录不改）= Garage 观感 / 奖励动画 / 内容量 / Buff 平衡 / 挂点几何与推杆反推深修。
**后续段缺口**：`planckBattleOrchestrator.ts:217-218` 硬编码两车 · `battleContract.ts:96-98` 只有 A/B 胜负 ·
`runBattleRuntime.ts:355` 只取 `enemies[0]`；唯一 1vN 宿主 = DEBUG `arenaA.ts:814`。
**LightSwarm** 真人结论仍未收到（已裁决：路边改装件 ✅ 保留；废弃修理站 ❌ 不进正式内容池）。
**PRP 各轮录屏回执未归档**（唯一未闭环项）。
