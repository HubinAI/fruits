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
- **链尾**：`c0d2c5d`+`69c4d1e` R1-A → `f1b87a2`(+`fb982be`) R1-B → `4f0be1a` R1-C → `c63408c` R1-D →
  `c40977a` R2-A → `16a221f` R2-B（起点 `52f3f6d`）→ **`9e4e88c` R2-C**（起点 `2209263`）→
  **`9841274` P0**（完整 Run 装载资格：非 cannon 不再「前几日正常、DAY3 卡死」，起点 `c0429c1`）；
  更早查 `git log`。
- ⚠️ **不变量在 R2-B 起被有意打破**：`src/{physics,render,player,platform,ui,game,presentation,lab}` diff
  恒为空；**`src/core` 不再空** —— R2-B（`partInventory.ts`/`buildPersistence.ts`，见 §7a）、
  R2-C（`buildSnapshot.ts` 星级曲线唯一真源 / `types.ts` 注释，见 §8b）两处**必改**。
  **P0 core 零改动**：全落 `src/product/` + `src/lab/portraitBattleLab/` + `home.html` + tests
  （冻结目录 `git diff` 为空，`content.ts` / `contactRouter.ts` 零改动）。

## 2. 红线速查（全文 → REF_GUARDS §1–2）
- 环境：禁 `git stash`；四路 SHA 前先 `git fetch`；`git commit -F` 传 **Windows 路径**；排除 `交接文档_*.md` 用
  **显式路径** `git add`；bash 前 `export PATH="/usr/bin:/bin:$PATH"`；vitest `--pool=vmForks --maxWorkers=1`
  + **独占机器**。
- ⚠️ **入口唯一性**：根路径 `/` 由 dev-only `build/branchDevEntry.ts` 重写到默认入口（**R1-C 起 = `/home.html`**）；
  守卫禁把 dev 入口逻辑写进 `vite.config.ts`（不得含 `BRANCH_DEFAULT_DEV_ENTRY` 字面量）。
  研发入口（`/run-page.html` / Hub / Lab / `index.html`）**一个都没删**。
- ⚠️ **`R22b`：`src/`（Lab 之外）0 处 `portrait-lab` / `portraitBattleLab` 字样 —— 注释里也不能提**（含产物路径）。
- ⚠️ Lab `ALLOWED_RELATIVE_IMPORTS` 是闭集 ⇒ **Lab 内读不到正式存档 ⇒ 产品页只能放 `src/product/`**。
- ⚠️ 页面模块**级零 DOM**（自挂载放 `*Main.ts`）；导航只写常量交给 `<a href>`（`RP-25`/`RP-25b`/`PL-29`）。
- ⚠️ **加根 html 同步 5 处（挂 Hub 7 处）**；加 Hub 入口 **4 处硬断言**（最易漏**顺序断言**）。
- ⚠️ **跨轮复验 PRP 前必须先 build**（`emptyOutDir:false` ⇒ 陈旧 chunk ⇒ 假 FAIL）。
- ⚠️ 改实现导致源码守卫失败 ⇒ **强化守卫，不放宽**。
- ⚠️ **像素阈值必须按面积推导**，不要凭印象：3×362×68 = 73848 px²，实测 `cardBg` 58822 ⇒ 取 55000。
- ⚠️ **E2E 像素取证必须在「点那张卡之前」**：点中即整页导航 ⇒ `#run-canvas` 为 `null`。
- ⚠️ **HTML 注释里禁止出现注释终止序列**（两个连字符紧跟一个右尖括号）⇒ 注释提前闭合、其后文本按真标签解析
  ⇒ 真实鼠标点**任何位置**整页重载（R1-A 起埋 3 轮，`e2e:product-home` 的 `B1` 根因）；**症状极具误导性**
  （渲染 / `elementFromPoint` / `node.click()` 全正常，只有真实鼠标失效）。排查法 + 3 条 E2E 书写坑
  （件数别写死 / 探针字段别串用 / reload 后视图回默认态）→ REF_GUARDS **§4**；守卫 `PL-33`。

### 2a 终态出口（R1-D / R2-A，全文 → §5 + §6）
- 两个终态**各有唯一出口**、地址**全由产品侧给**：**COMPLETE 的出口 = 三张候选卡各自的 `choices[].href`
  （`buildClaimHref`）**，`exitHref` 在 COMPLETE 恒 `null`、底栏按钮不可用；`home` = **纯首页**
  （FAILED，`parsePendingClaim` 恒 null ⇒ 绝不入库）。Lab **不硬编码任何产品 URL**，失败**不接受任何隐式推进**
  （顺序最易写反 ⇒ `RP-D-06` 机器钉死）。
- R1-B 的「一个 `back`」已被 **`choices` 载荷**取代（`{stack, choices:[{defId,star,countBefore,href}]}`）；
  三条 href **共用同一 run token** ⇒ 幂等键是 token 不是地址。库存数量**只能由产品侧传**（Lab 读不到正式存档）。

### 2b 星级 / 合成（R2-B §7 · R2-C §8）
- 两个「上限」是**两件事**：`INVENTORY_MAX_STAR = 5`（存储结构）vs `MAX_STAR = 2`（**旧横屏融合规则**，冻结，**不许动**）。
  产品合成**不复用** core 的 `fuseSameStar`（语义相反）。`stackText` 未满 = **`4/5`**（不是 `×4`）。
  一个 `defId` 可能**两张卡** ⇒ 取卡要按 `defId` **+ `star`**；合成按钮是卡片的**兄弟节点**（不许 `button` 嵌 `button`）；
  E2E 合成段**必须排在所有跑局断言之后**（★2 真实占 33 能量 ⇒ 插中间会毁掉「确定性通关」）。
- ⚠️ `starDamageMultiplier(star) = 1 + 0.25 × (star − 1)` = **唯一真源**，**已取代** Q22 的 `STAR_TIER_DAMAGE_MULT = 1.15`
  （★3 与 ★2 会同伤害 ⇒ 别再加回来）。`STAR_DAMAGE_MAX_STAR = 5` 与 `INVENTORY_MAX_STAR = 5` **同值但各自声明**。
- ⚠️ **`weaponMainDamage` 是「一次命中扣多少血」的唯一口径**（先 `projectileDamage` 再 `baseDamage`），与
  `contactRouter` 两个伤害分支一一对应。**作用面边界：正式武器里只有 `saw` 的伤害在嵌套 `hitPolicy` 里** ⇒
  星级看不见它（断言 `notScaled === ['saw']`；产品侧无读数就**不画那一行**）。当前**结构上不可达**。
- ⚠️ `playerSnapshot`（overlay 之后那份）是 **Runtime Weapon Star 真源**；层级 = 永久装备 → 永久星级 →
  Run-local Buff（overlay **只重映射 defId、保留 star**）。
- ⚠️ **`damage` 事件的 `timestamp` 恒为 0** ⇒ 命中时刻必须用 `orchestrator.timeMs` 自己记；星级只改伤害、
  **不进物理** ⇒ 「两局首中同一时刻」是「同条件」的机器证据。
- ⚠️ **`PR-27`**：产品侧 / 页面 / Lab **都不许自算**星级伤害，只许 import core 或读 `weaponEntries` 的
  `damageText`。新增「显示星级价值」的地方一律接字段，**不要自己乘**。

### 2c 完整 Run 装载资格（P0 → §9）
- ① 判据 `snapshotHasRunBaseWeapon(snapshot)` = **存在性**（`functionals.some(defId === 'cannon')`），**不是槽位**；
  创建期资格与运行时 `throw` **同一个函数**（不存在第二套「什么算兼容」）。
- ② 拒绝必须发生在 **`new RunPage(` 之前**（`runMain.ts` 里 `return`）⇒ 结构上到不了 DAY3。
- ③ ⚠️ 不支持时**不给 href**（disabled `<button>`），**不是**「点了 return」⇒ 探针 `startRunHref === null`
  本身就是机器证据；同一选择器覆盖两种形态。
- ④ ⚠️ 拒绝时 `loadout` 必须返回**演示装载占位**（返回玩家那份 = 漏看 `blocked` 就退化成「照常开战然后 DAY3 崩」）；
  `fallback: 'unsupported-loadout'` ≠ `'invalid'`。
- ⑤ `FULL_RUN_SUPPORTED_WEAPON_IDS`（产品侧）与 `RUN_BASE_WEAPON_DEF_ID`（Lab 侧）**同值但各自声明**
  （依赖单向 + `R22b` 禁产品侧 import 那个原型目录，**注释里也不能提**）⇒ 一致性只由 `LC-01` 钉死。
- ⑥ 拒绝态视图必须独立成模块（`RP-25b` 禁宿主 `createElement`）并登记进 `RUN_PAGE_FILES`。
- ⑦ ⚠️ **`applyRunModifiersToSnapshot` 的 throw 是刻意保留的强 invariant**，禁止改成 silently skip /
  `return snapshot` / try-catch 吞。真正修复在「产品开始 Run 资格 + Run 创建资格」。
- ⚠️ **产品契约变更会作废既有 E2E 路线 —— 固定处置 = 换合法路线 + 新增守门断言，不删断言**
  （P0 实测：`product-fail` 27/27→34/34、`product-loop` 48/48→51/51）。替代失败路线 = `cannon` +
  耐久事件选 `upgrade`（不回耐久）→ DAY7 归零（≈41.6s）；「推杆`@front`」路线**车库走不通**
  （车库只能往 `frontMass` 装武器）。详见 §9g。

## 3. 各功能面 → 细节在 REF / 交接文档
战斗参数 §A · 相机 §B · 接缝与第一层冻结值 §C · RUN-R1 §D · BUILD-01 §E · RUN-02 §F/§J/§K · M2 种子 §G ·
M3 遭遇台 §H · Hub §I · M2-R1 终点态出口 §L · PBL-RDC §M → `REF_PRP_RUNTIME.md`。
⚠️ **不在 REF、只看交接文档**：`PRP-M3-CONTENT-BATCH-01` · `PBL-M3-LIGHT-SWARM-EXPERIENCE-VALIDATION-R1` ·
`PRODUCT-LOOP-R1-A/B/C` · `R1-D`（§5）· `R2-A`（§6）· `R2-B`（§7）· `R2-C-STAR-POWER-END-TO-END`（§8）·
**`P0-RUN-BUILD-LOADOUT-COMPATIBILITY`（§9）**。
启动两行：`cd D:\0818new\最强水果` → `npm run dev`（默认进**产品首页**；研发用 `dev:home` / `dev:next-run` /
`dev:encounter-lab` / `dev:validation`）。

## 4. Next action
- ✅ **P0 已收口**（`9841274`，15 files +1389/−106）：两层守门 + 拒绝态独立视图 + Case A–E；
  `product-fail` **34/34** · `product-loop` **51/51** · home 30/30 · reward 48/48 · star-power 20/20 ·
  default-entry 86/86 · 全量 vitest **217 files / 2272 tests** · 4 个 build 全绿（wechat `game.js` 1,415.83 kB，
  与 R2-C 持平 —— 产品侧/Lab 侧不入 wechat 包）。
  **最强活证据 = E2E C0b**：同一门炮 `frontMass` 定义为 `projectileRadius:10, mass:1, recoil:30`（DAY2, build=[]）
  → `16 / 4 / 90`（DAY3, build=["heavyShell"]）⇒ 强化**真的注入生效**，DAY3 不再 throw。
- ⚠️ **待用户裁决（P0 新增 4 条，别自作主张改）**：① 两条 E2E 路线替换（`product-fail` 改 cannon+`upgrade` ；
  `product-loop` 的 `WEAPON_B` 角色缩小）是否接受；② 支持清单粒度（=`['cannon']` 是否够）；
  ③ 拒绝态文案落点（首页条 / 车库条 / Run 内拒绝页三处是否都要）；④ `runBlockedView` 的出口口径（只给
  `返回主界面` 一条是否够）。详见 `交接文档_2026-09-19_PRODUCT-LOOP-P0-*.md` §10。
- ⚠️ **待用户裁决（R2-C 4 条）**：① 是否现在开 Bug Queue 修 `validateSnapshot` 星级能量盲；② ★2 炮占 33 能量
  超 `bananaBody` 90 容量，要不要「容量提示」；③ `saw` 边界是否在它进奖励池前处理；④ 下一条 Queue 是否开
  Body/Gadget 成长。
- ⚠️ **历史待裁决（R1-C/R1-D/R2-A/R2-B）**：多数已被后续轮次吸收或由守门强制（如 R1-D 的「失败路线取 `hammer`」
  被 P0 作废、R2-A 的「第二局必须换回 cannon」被 P0 结构挡）。逐条见各交接文档的「待裁决」节。
  仍未决的实质项：只升 `WEAPON_SLOT` 的星（不动其它挂点，避免动 Battle 数值）；`openGrowthSession(draft)` 一参签名；
  新账号起点 `cannon ×4` 是数值决策。
- ⚠️ **发现但未修（独立 Bug Queue）**：① `buildValidator.validateSnapshot` **不含星级倍率**（`:114` 累加
  `def.energy`，而 `:48` 的 `computeEnergy` 用 `starTierEnergy`）—— 前者自 `9ced1c7` 未改、后者由 `5133a1c`(Q22)
  加入 ⇒ **Q22 漏改**，早于本轮；由 `productFusionR2B` 的 FB-11b 钉死。② `e2e:next-run` 在 `N29` 后崩溃
  （`tests/_e2e_next_run.cjs:619` 等 Hub 入口**恰好 3 个**，`validationHub.ts` 现有 **4** 个；第 4 个由 `bab5f63`
  加入，早于 R1-D 7 个提交，已 `merge-base --is-ancestor` 取证）。③ Lab 注释与实际不符：`playerFunctionals()`
  注释称返回 overlay 部件 id，**实测 overlay 由 `{...正式cannon}` 浅拷贝派生 ⇒ `part.def.id` 仍是 `'cannon'`**
  （只有 registry **键**是 overlay id）⇒ 正确口径 = `runtime.playerSnapshot.functionals[].defId`。
- ⚠️ **明确未做（只记录不改）**：Garage 观感 / 奖励动画 / 内容量 / Buff 平衡 / 挂点几何与推杆反推的深修。
- ⚠️ **后续段缺口**：`planckBattleOrchestrator.ts:217-218` 硬编码两车 + `battleContract.ts:96-98` 只有 A/B 胜负 +
  `runBattleRuntime.ts:355` 只取 `enemies[0]`；唯一 1vN 宿主 = DEBUG `arenaA.ts:814`。
- ⚠️ **LightSwarm 真人结论仍未收到**；真人已裁决：路边改装件 ✅ 保留；废弃修理站 ❌ 假选择、不进正式内容池。
- ⚠️ **PRP 各轮录屏回执未归档**（唯一未闭环项）。
