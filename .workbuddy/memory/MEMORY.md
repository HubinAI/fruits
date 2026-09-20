# Fruits - Runtime Memory Index

**只放「不变量 + 陷阱 + 下一步」。** 实测数字 / 逐帧时间线 / 各轮细节**不在这里**。

| 要找什么 | 去哪 |
|---|---|
| 本轮做了什么、实测数字 | `.workbuddy/memory/YYYY-MM-DD.md`（最新 `2026-09-20.md`） |
| **改动前必读**：守卫 / 环境陷阱 / Stable contracts / Rules / 存档链 / §4–§10 契约全文 | `.workbuddy/memory/REF_GUARDS_TRAPS_CONTRACTS.md` |
| PRP 运行时细节（战斗参数 / 相机 / 接缝 / 入口 / file:line） | `.workbuddy/memory/REF_PRP_RUNTIME.md` §A–M |
| **跨窗口续接（先读）** / 各 Queue 交付说明 / 已知未修清单 | `交接文档_2026-09-20_SESSION-HANDOFF.md` · `交接文档_<日期>_<Queue>.md`（**本地件，不入库**） |
| 更早完整版（最高权威） | `.workbuddy/memory/archive/` |

## 1. Identity / 链尾
- Repo `git@github.com:HubinAI/fruits.git` | dir `D:\0818new\最强水果` | 工作分支 `prototype-portrait-battle-lab`
  （实验，可整块删）；主线 `foundation-02-wechat`。正式名 **PRP｜Portrait Run Prototype**。舞台 844×390。
- **链尾**：R1-A `c0d2c5d`+`69c4d1e` → R1-B `f1b87a2` → R1-C `4f0be1a` → R1-D `c63408c` → R2-A `c40977a` →
  R2-B `16a221f` → R2-C `9e4e88c` → P0 `9841274` → PLP0-LEGACY `9078cc5` → 复核 doc
  `1a9f4a0`/`5d47d98`/`115fe52`/`a3ea779`；更早查 `git log`。
- ⚠️ **不变量在 R2-B 起被有意打破**：`src/{physics,render,player,platform,ui,game,presentation,lab}` diff 恒为空；
  **`src/core` 不再空** —— 仅两处**必改**：R2-B（`partInventory.ts` / `buildPersistence.ts`）、R2-C
  （`buildSnapshot.ts` 星级曲线唯一真源 + `types.ts`）。**P0 / PLP0-LEGACY core 零改动** ⇒ 全落 `src/product/`。
- 每轮必交边界取证：`git diff --stat -- src/{core,battle,physics,render,player,platform,game,presentation,ui}` +
  `git diff --exit-code -- src/core/content.ts src/battle/contactRouter.ts`。

## 2. 红线速查（全文 → REF_GUARDS §1–§2）
- **环境陷阱**（PATH / `git commit -F` 传 Windows 路径 / `git status` 中文名八进制 ⇒ 排除 `交接文档_*.md` 用
  **显式路径** `git add` / 禁 `git stash` / `refs/remotes/origin/` 为空 ⇒ 用 `git ls-remote` 顶替 /
  vitest `--pool=vmForks --maxWorkers=1` 且**独占机器**：抢 CPU 时**无关文件**报 5s 超时，**先单独重跑复现**）
  → 用户级 `~/.workbuddy/MEMORY.md`（全文）。
- ⚠️ **入口唯一性**：根路径 `/` 由 dev-only `build/branchDevEntry.ts` 重写到默认入口（**R1-C 起 = `/home.html`**）；
  该逻辑不许进 `vite.config.ts`。研发入口（`run-page.html` / Hub / Lab / `index.html`）**一个都没删**。
- ⚠️ **`R22b`**：`src/`（Lab 之外）0 处 `portrait-lab` / `portraitBattleLab` 字样 —— **注释、import 路径、产物名
  里也不能提**。Lab `ALLOWED_RELATIVE_IMPORTS` 是闭集 ⇒ **Lab 读不到正式存档 ⇒ 产品页只放 `src/product/`**。
- ⚠️ 页面模块**级零 DOM**（自挂载放 `*Main.ts`）；导航只写常量交给 `<a href>`（`RP-25`/`RP-25b`/`PL-29`）。
  **加根 html 同步 5 处（挂 Hub 7 处）**；加 Hub 入口 **4 处硬断言**（最易漏**顺序断言**）。
- ⚠️ **跨轮复验 PRP 前必须先 build**（`emptyOutDir:false` ⇒ 陈旧 chunk ⇒ 假 FAIL）；**改实现导致源码守卫失败
  ⇒ 强化守卫，不放宽**。像素阈值**按面积推导**（3×362×68 = 73848 px²，实测 `cardBg` 58822 ⇒ 取 55000）。
- ⚠️ **HTML 注释里禁止出现注释终止序列**（`--` 紧跟 `>`）⇒ 注释提前闭合 ⇒ 真实鼠标点**任何位置**整页重载；
  **症状极具误导性**（渲染 / `elementFromPoint` / `node.click()` 全正常）⇒ 排查法 REF_GUARDS **§4**。

### 2a 终态出口（R1-D §5 · R2-A §6）→ REF_GUARDS §5/§6
两终态**各有唯一出口、地址全由产品侧给**：**COMPLETE 出口 = 三张候选卡各自的 `choices[].href`**（`buildClaimHref`；
`exitHref` 恒 `null`、底栏按钮不可用）；`home` = **纯首页**（FAILED，`parsePendingClaim` 恒 null ⇒ **绝不入库**）。
Lab **不硬编码产品 URL**、失败**不接受隐式推进**（`RP-D-06`）。三条 href **共用同一 run token** ⇒ 幂等键是 token。

### 2b 星级 / 合成（R2-B §7 · R2-C §8）→ REF_GUARDS §7/§8 全文
**锚点**：`weaponEntries` · `migrateLegacyStarterProfile:350` · `loadEquippedDraft:383` · `persistPlayerBuild:280`
（`playerLoadout.ts`）· `FRESH_STACK_SEED:149` · `canFuseStack:343` · `fuseStack:417`（`playerGrowth.ts`）。
- `starDamageMultiplier = 1 + 0.25 × (star − 1)` = **唯一真源**（★1..★5 = 1/1.25/1.5/1.75/2），**已取代** Q22 的
  `STAR_TIER_DAMAGE_MULT = 1.15`（★3 与 ★2 会同伤害 ⇒ 别加回来）。
- `MAX_STAR = 2`（`partInventory.ts:426`）= **旧横屏融合规则**上限 ⇒ **冻结、不许动**（与产品的
  `INVENTORY_MAX_STAR = 5` 是**两件事**）；产品侧合成**不复用** core 的 `fuseSameStar`（语义相反）。
- ⚠️ **`PR-27`**：产品侧 / 页面 / Lab **都不许自算**星级伤害，只许 import core 或读 `weaponEntries.damageText`。
- ⚠️ **`DAY = 1` 只能用「进入 Run 的瞬间」的 `runStart` 断**（第一场节点 `d2-battle1` 的 `day` = **2**）；
  E2E 断言名 `E1b` → REF_GUARDS **§8g 第 6 条**。
- 其余（`weaponMainDamage` 口径 / `saw` 边界 / 卡片按 `defId`+`star` 取 / 合成按钮是**兄弟节点** / E2E 合成段
  **排最后** / 未满写 `4/5` / ★2 占 33 能量 / 像素取证在**点卡之前**）→ REF_GUARDS **§6e–§6h、§8c–§8i**。

### 2c 完整 Run 装载资格（P0 §9）→ REF_GUARDS §9 全文
判据 = **存在性**（**不是槽位**），创建期与运行时 `throw` **同一函数**；`fullRunCompat` 读 `install.defId` +
`category==='weapon'` —— **星级是独立字段 `install.star`、不改 `defId`** ⇒「partId+star 被当成新武器 ID」
**结构上不可能**。拒绝在 **`new RunPage(` 之前**；不支持时**不给 href**（探针 `startRunHref === null`）；拒绝时
`loadout` **必须是演示装载占位**（`'unsupported-loadout'` ≠ `'invalid'`）；拒绝态视图独立成模块并登记
`RUN_PAGE_FILES`；`FULL_RUN_SUPPORTED_WEAPON_IDS` 与 `RUN_BASE_WEAPON_DEF_ID` 同值**但各自声明**（`LC-01`）。
⚠️ **`applyRunModifiersToSnapshot` 的 throw 是刻意保留的强 invariant**；**产品契约变更作废既有 E2E 路线 ⇒
换合法路线 + 新增守门断言，不删断言**（P0：fail 27→34、loop 48→51）。

### 2d 旧 profile 迁移（PLP0-LEGACY §10）→ REF_GUARDS §10 全文
旧 starter 的 `front='pushRod'`（`makeStarterDraft`，`buildEditorModel.ts:182`，**至今未改**）每周期反推**自家车** ⇒
完整 Run 第一场稳定失败。⚠️ **`migrateLegacy('build',…)` 对 build 是 no-op**、`CURRENT_SAVE_VERSION = 1`
⇒ **core 里没有任何一层会碰它** ⇒ 只能产品侧做语义迁移。**判别式（用户裁决「收紧」）= 同时满足** ①`front` /
`frontMass` == `makeStarterDraft()` 取值（签名**取自真源函数**）②`functionalStars?.front === undefined`
（**所有**玩家侧写入都盖星级印记）；任一不成立 ⇒ **一字节不改**。⚠️ **「见推杆就删」是错的** —— `editableSlots`
返回全部硬点（含 `front`），**正常玩家车库**就用它。落点 `migrateLegacyStarterProfile()`（`:350`，**纯函数不落盘**）
+ `loadEquippedDraft()`（`:383`，命中落盘一次）；**无存档仍不写盘**；**结构上一次为限** ⇒ 无标记位；
`PL-03` 钉「`savePlayerBuild(` 只准 1 次」⇒ 收进 `persistPlayerBuild()`。
⚠️ **实测：`drive` / 轮径 / 轮组真的会改变战斗结果** ⇒ 迁移不碰它们 ⇒ `drive='stationary'` 旧存档**迁移后仍可能
失败**；Reachability Gate 只管「**标准 Cannon 基线**」。

## 3. 各功能面 → 细节在 REF / 交接文档
`REF_PRP_RUNTIME.md`：战斗参数 §A · 相机 §B · 接缝与第一层冻结值 §C · RUN-R1 §D · BUILD-01 §E · RUN-02
§F/§J/§K · M2 种子 §G · M3 遭遇台 §H · Hub §I · M2-R1 终点态出口 §L · PBL-RDC §M。
⚠️ **只在交接文档**：`R1-A/B/C` · `R1-D`(§5) · `R2-A`(§6) · `R2-B`(§7) · `R2-C`(§8) · `P0`(§9) · `PLP0-LEGACY`(§10)。
启动：`cd D:\0818new\最强水果` → `npm run dev`（默认**产品首页**；研发 `dev:home` / `dev:next-run` /
`dev:encounter-lab` / `dev:validation`）。

## 4. Next action
**R2 milestone（A/B/C）已复核收口**，无功能缺口、无 BLOCK。门禁基线：`tsc` 零错 · 全量 vitest **218 files /
2287 tests** · `build` / `build:pages` / `build:wechat`（`game.js` 1,415.83 kB）· star-power **21/21** · reward 48/48 ·
loop 51/51 · fail 34/34 · home 30/30 · legacy 17/17 · default-entry 86/86。
**下一步 = 等用户裁决下表任一项，或下发新 Queue；用户已明令「不自行进入 R3」。**

| Queue | 未决项 |
|---|---|
| **R2-C**（4） | ① `validateSnapshot` 星级能量盲开 Bug Queue ② ★2 炮 33 能量超 `bananaBody` 90 是否加提示 ③ `saw` 边界是否提前处理 ④ 是否开 Body/Gadget 成长 |
| **PLP0-LEGACY**（4） | ① 判别式是否接受为**长期契约**（Q22 前旧档仍不可区分）② `drive='stationary'` 自改致败是否开独立 Queue ③ 首页是否给迁移提示（本轮**静默**）④ P0 4 条仍有效 |
| **P0**（4） | ① 两条 E2E 路线替换是否接受 ② 支持清单粒度 `['cannon']` ③ 拒绝态文案落点 ④ `runBlockedView` 出口口径 |
| **R2-A**（1） | 「**必须**增加 schema version」= **唯一真实字面缺口**。⚠️ **硬冲突**：`saveVersion.ts:20` 明写「下次**破坏性**变更才 +1」，而 R2-A/B 都是**非破坏性扩展**。若提：`= 2` + no-op `upgrade_v1_to_v2` + 改写注释。它是**全局**版本号（`build`/`inventory`/`progress`，与旧横屏共用）⇒ **已上报，未改** |
| **R2-B**（1） | 「禁止再次出现 `MAX_STAR = 2`」冲突：仍在 `core/partInventory.ts:426`（旧横屏，Q22 冻结，旧横屏测试当**域不变量**）；产品侧**完全不依赖** ⇒ 删它 = 改旧横屏 + Q22 全红 ⇒ **已上报，未改** |
| **R1-C/D** | 只升 `WEAPON_SLOT` 的星；`openGrowthSession(draft)` 一参签名；新账号起点 `cannon ×4` 是数值决策 |

**⚠️ 发现但未修 → 独立 Bug Queue，禁顺手并改**：① `validateSnapshot` **不含星级倍率**（`:114` `def.energy`
vs `:48` `starTierEnergy`）⇒ Q22 漏改 ② `e2e:next-run` 在 `N29` 后崩溃（Hub 入口 3 → 4）③ Lab
`playerFunctionals()` 注释与实际不符 ⇒ 口径用 `runtime.playerSnapshot.functionals[].defId`。
**明确未做**（只记录不改）：Garage 观感 / 奖励动画 / 内容量 / Buff 平衡 / 挂点几何与推杆反推深修。
**后续段缺口**（1vN 宿主 = DEBUG `arenaA.ts:814`）与 **LightSwarm 真人结论未收到**、**各轮录屏回执未归档**
（唯一未闭环项）→ 全文见 `交接文档_2026-09-20_SESSION-HANDOFF.md` §7。
