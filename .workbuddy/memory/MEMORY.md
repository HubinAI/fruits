# Fruits - Runtime Memory Index

**只放「不变量 + 陷阱 + 下一步」+ 指针。** 契约全文 / 实测数字 / 逐帧时间线**不在这里**。

| 要找什么 | 去哪 |
|---|---|
| 本轮做了什么、实测数字 | `.workbuddy/memory/YYYY-MM-DD.md`（最新 `2026-09-26.md`） |
| **改动前必读**：守卫 / 环境陷阱 / Stable contracts / §1–§14 契约全文 / **未决项台账 §A** | `.workbuddy/memory/REF_GUARDS_TRAPS_CONTRACTS.md` |
| PRP 运行时细节（战斗参数 / 相机 / 接缝 / 入口 / file:line） | `.workbuddy/memory/REF_PRP_RUNTIME.md` §A–M |
| **跨窗口续接（先读）** / 各 Queue 交付说明 / 已知未修清单 | `交接文档_<日期>_<Queue>.md`（**本地件，不入库**） |
| 更早完整版（最高权威） | `.workbuddy/memory/archive/` |

## 0. 现状 / 下一步（**新窗口先读这段**）
**R2（A/B/C）+ R2-RECOVERY + SETTLEMENT-CTA-LATENCY + SINGLE-CTA/音频 + R2-RESEED + R4（Body canonical/MVP）
+ R3（四同构槽）+ R5（正式内容池）+ **R5-MULTI-WEAPON-PRODUCT-COMPAT（统一检查，源码零改动）** 均已收口**，
无功能缺口、无 BLOCK。
**下一步 = 等用户下发新 Queue**（连续四轮 Queue 末尾都写「直接继续 Q2 / Q3 / Q4 / Q5…Q6」，但**正文均未到达** ⇒ 未开工）。
⚠️ **Q5「多武器统一检查」的结论 = 唯一支持完整 Run 的武器仍是 `cannon`（本批次无变化）**，
交付物是两条**机器守卫**（`tests/productMultiWeaponCompatR5.test.ts` 11 条 + `_e2e_product_fail.cjs` 新增
A4b 逐件守门矩阵），**不是**功能改动。详见下一条与当日日志。
⚠️⚠️ **本轮最重要的事实修正**：**`weaponDefs()` 的武器是 10 件，不是 9 件** —— 含 **`ramHead`（冲撞头）**
（`category:'weapon'` / energy 20 / behavior `ram`），但它**不在 `OFFICIAL_PARTS`** ⇒ `isOfficialPart('ramHead') === false`
⇒ **玩家永远拿不到、不进任何库存**。「本批次可接入的武器」= `OFFICIAL_PARTS.filter(isWeaponDefId)` = **9 件**。
写「武器全表」断言**必须**用后者，差集恰 `['ramHead']`。同理：**注册了 behavior 的 11 件 ≠ 可拥有的 11 件**。
⚠️ **「非 cannon 武器进完整 Run」这条线已连判两次 STOP**（`R5-SPEAR-FULL-RUN-R1` + `R5-HAMMER-FULL-RUN-R1`，
两轮均**只调查、零改码、零源码 commit**），并由 **Q5 统一收口**（判定不变、把结论变成机器守卫）。
**根因是同一个、且是产品侧明文裁决过的**：
- **阻塞点 = Run 的强化注入接缝只认 cannon**：完整 Run 唯一线性路径上 `d2-choice1`(layer1) 是**必选** CHOICE，
  池里 3 项**全是 cannon 派生**；`RUN_BASE_WEAPON_DEF_ID='cannon'`，判据 = 「装载里有没有正式 cannon」
  ⇒ 非 cannon 装载在 battle2（DAY3）创建时 **throw**（实测：`本局装载里没有 "cannon"…`）＝**P0 「Run 卡死」的形状**。
- **三条出口全禁**：① 新增该武器专属强化（新设计，且冲 `LC-23`「没有新 Spear/Hammer Buff」）
  ② 让该装载跳过强化（第二套 Run 流程 / 新增特殊资格状态）③ 套用 cannon overlay
  （`composeRunWeaponDef:481-493` **会把 `behavior` 一并改成 overlay 的** ⇒ 实测 `hammer`→`cannon`／`ram`→`cannon`）。
- ⚠️ **`product/runCompatibility.ts:20-23` 已逐字裁决**：「在 Spear / Hammer 有正式 Run Build 内容之前：它们不得进入完整 Run」；
  `FULL_RUN_SUPPORTED_WEAPON_IDS = ['cannon']`（:58）。机器钉死：`LC-02` / `LC-11` / `LC-23`
  （`tests/productRunBuildLoadoutCompat.test.ts`）。
- **两件的差别**：spear **没有 behavior runtime**（`FACTORIES` 无 `'ram'`，靠 collider 直击 `baseDamage:60`）；
  hammer **攻击 Runtime 完整**（`FACTORIES.hammer` + 专属 `hammerBehavior.ts` 真实 Revolute motor+limit）。
  ⇒ **hammer 记的是「内容实现缺口」：攻击实现不缺，缺的是它的正式 Run Build 内容（强化）+ 与之匹配的可行性**。
- ⚠️ **hammer 的第二条独立证据（实测）**：产品可达形状 = **双锤**（`equipWeapon('hammer')` 只写 `WEAPON_SLOT`，
  而 starter 固定在 `top` 的那把锤仍在）⇒ **第一场就落败（0/4）**；单锤 2/4；**锤+炮 4/4**（说明 hammer 本身能打）。
- ⚠️ **强化不是可选装饰**：实测无强化时**连 cannon 都打不完第四场**（3/4）。详见 `.workbuddy/memory/2026-09-26.md` 末三节。
- **Q5 把这个结论变成了机器守卫**（`9dcbf7b`，`src/` 零改动）：`tests/productMultiWeaponCompatR5.test.ts`
  （11 条，**真源驱动**逐件矩阵 —— 集合从 `weaponDefs()` / `OFFICIAL_PARTS` **现读** ⇒ 新增武器自动进入；
  其中 **MW-03「恰好一件放行」不可省**：否则把白名单改成 `['cannon','spear']` 时 `ok` 与 `supportsFullRun`
  会**一起翻**、矩阵自洽变绿，守卫就失效了）+ `_e2e_product_fail.cjs` 的 **A4b 逐件守门矩阵**
  （8 件非支持武器各走一遍：真实点击 → **独立读 localStorage** → 车库 unsupported → 首页 `startRunHref === null`
  → **`equippedWeaponId` 仍是它**＝不自动换炮）。
  ⚠️ Q5 三条负控制（白名单放宽 / 读路径注入写盘 / `FUSE_STACK=1`）分别打红 **4 / 2 / 2** 条 —— 守卫**真的会红**。
门禁基线（Q5 实测）：`tsc` **零错** · targeted **41 files / 682 tests** 全绿 ·
product E2E：**home 98/98 · loop 53/53 · reward 57/57 · reseed 21/21 · fail 45/45 · star-power 22/22 ·
legacy-profile 18/18**。⚠️ **R5 起「新账号内容基线」变了**（见 §2h）⇒ 任何写死「3 件武器」的断言都会红。
⚠️ **本宿主 `child_process.spawnSync` 被无条件拒绝**（`status:null` + `error: … EBUSY`）：spawn `node.exe` /
`cmd.exe` 全 EBUSY，从 vitest worker、普通 node 进程、**沙箱外**都一致（**异步 `spawn` 正常**）。
受影响**恰好 2 个**文件 —— `tests/rcBundleCleanP0.test.ts`（6/9 红）、`tests/rcFusionTestEntryP0.test.ts`（T16 红），
**在干净 HEAD worktree 上同样红 ⇒ 环境假失败，非回归**。⇒ 绿批次**不纳入**这两个文件，但须在回执里披露。
⚠️ **全量 vitest 有负载抖动**：`vmForks + maxWorkers=1` 全量跑时个别重型文件会偶发 5s 超时。**判定三步**：
单跑该文件 → 查 import 面有无引用 → **同一批次在干净 HEAD worktree 上再跑一次**；
⚠️ **R5 实测新判据**：`一整个批次红出来的文件集合在两次运行之间会变` ⇒ 那批红就是抖动。
⚠️ **`e2e:next-run` 仍崩**（`_e2e_next_run.cjs:619` 等 Hub 入口**恰好 3 个**而现有 **4** 个）= **既有缺陷**，非回归。
⚠️ **发现但未修 → 独立 Bug Queue，禁顺手并改**：① `validateSnapshot` 不含星级倍率（`:114` `def.energy` vs `:48`
`starTierEnergy`）⇒ Q22 漏改 ② `e2e:next-run` 崩溃 ③ Lab `playerFunctionals()` 注释与实际不符
④ **`e2e:product-reward` 的 C9 偶发红**（CDP `Cannot find context with specified id`，CTA 按下即导航导致
上下文失效；实测一轮 56/57、复跑 57/57）。
**明确未做**：Garage 观感 / 奖励动画 / 内容量 / Buff 平衡 / 挂点几何 / 为武器补正式 Run Build 内容
（R5 **故意不放宽** `FULL_RUN_SUPPORTED_WEAPON_IDS`）。**均未归档**：LightSwarm 真人结论 / 各轮录屏回执；
1vN 宿主 = DEBUG `arenaA.ts:814`。

## 1. Identity / 链尾
- Repo `git@github.com:HubinAI/fruits.git` | dir `D:\0818new\最强水果` | 工作分支 `prototype-portrait-battle-lab`
  （实验，可整块删）；主线 `foundation-02-wechat`。正式名 **PRP｜Portrait Run Prototype**。舞台 844×390。
- **链尾**：R2-A `c40977a` → R2-B `16a221f` → R2-C `9e4e88c` → P0 `9841274` → PLP0-LEGACY `9078cc5` →
  R2-RECOVERY `8770c98`+`e50b95c` → SETTLEMENT-CTA-LATENCY `1931a71` → SINGLE-CTA+AUDIO `c2c1e2c`+`c55a285` →
  R2-VALIDATION-STATE-RESEED `88288b4`+`7dacd47` → R4 `3e48b16` → R4-GATE `8887ad6` →
  GARAGE-MOBILE `f357383` → GARAGE-SLOT-R2 `a51de9b` → `edd8f78` → `c76f1a2` → R3 `06e44de` →
  **R5 `5baff53`（最后一次 `src/` 改动）** → `a06f2a4` / `cf16cb9` / `99a094c`（chore(memory)）
  → **Q5 `9dcbf7b`（新增测试与 E2E 守卫，`src/` 零改动）** → 本轮 `chore(memory)`；
  更早（R1-A..R1-D）查 `git log`。
- ⚠️ `src/{physics,render,player,platform,ui,game,presentation,lab}` diff 恒为空（R2-B 起有意打破）；`src/core` 只许
  R2-B（`partInventory.ts`/`buildPersistence.ts`）+ R2-C（`buildSnapshot.ts` 星级**唯一真源** + `types.ts`）两处必改，
  **此后再无 core 改动**（含 R2-RESEED / R3 / R4 / R5 轮 —— 全部零改动）。R3–R5 只动 `src/product/`。
  ⚠️ **R5 新增 1 个 `src/product/` 模块**（`r5ContentPoolSeed.ts`）；`PL-26` 的 import 白名单是**闭集**，
  新模块必须在 `tests/productLoopHomeGarage.test.ts` 的 PL-26 里**登记**（登记，不是放宽）。
- 每轮必交边界取证：`git diff --stat -- src/{core,battle,physics,render,player,platform,game,presentation,ui}` +
  `git diff --exit-code -- src/core/content.ts src/battle/contactRouter.ts`。

## 2. 红线速查（全文 → REF_GUARDS §1–§4）
- ⚠️ **环境陷阱**（PATH 加 `/usr/bin` · `git commit -F` 传 **Windows 路径** · `git status` 里中文名是八进制 ⇒ 排除
  `交接文档_*.md` 用**显式路径** `git add` · 禁 `git stash` · `refs/remotes/origin/` 可能**整个为空** ⇒ 四路核对用
  **`git ls-remote`** 顶替 · vitest `--pool=vmForks --maxWorkers=1` 且**必须独占机器**，否则**无关文件**报 5s 超时）
  —— **全文在用户级 `~/.workbuddy/MEMORY.md`**。
- ⚠️ **本宿主 `child_process.spawnSync` 被无条件拒绝**（R5 实测）：返回 `status:null` +
  `error: spawnSync … EBUSY`。spawn `node.exe` / `cmd.exe` 全 EBUSY；从 vitest worker 内、从普通 node 进程、
  **沙箱外**都一致；**异步 `spawn` 正常**。受影响**恰好 2 个**文件：`tests/rcBundleCleanP0.test.ts`（6/9 红）、
  `tests/rcFusionTestEntryP0.test.ts`（T16 红）。**二者在干净 HEAD 上同样红 ⇒ 环境假失败，不是回归**
  —— 判定这类红**不要**去改被测逻辑。
- ⚠️ **`e2e:product-reward` 单跑约 2m09s > Bash 工具默认 120s** ⇒ 会被 SIGTERM 掐掉、且**不打印
  `=== 结果`**（日志停在最后一条 `PASS …`）。**必须后台跑**再取日志，否则会把「跑完但被掐」误读成失败。
- ⚠️ **入口唯一性**：根路径 `/` 由 dev-only `build/branchDevEntry.ts` 重写（**R1-C 起 = `/home.html`**）；该逻辑不许进
  `vite.config.ts`。研发入口（`run-page.html` / Hub / Lab / `index.html`）**一个都没删**。
- ⚠️ **`R22b`**：`src/`（Lab 之外）0 处 `portrait-lab`/`portraitBattleLab` 字样（注释 / import 路径 / 产物名也不行）。
  Lab `ALLOWED_RELATIVE_IMPORTS` 是闭集 ⇒ **Lab 读不到正式存档 ⇒ 产品页只放 `src/product/`**。
- ⚠️ 页面模块**级零 DOM**（自挂载放 `*Main.ts`）；导航只写常量交给 `<a href>`（`RP-25`/`RP-25b`/`PL-29`）。
  **加根 html 同步 5 处（挂 Hub 7 处）**；加 Hub 入口 **4 处硬断言**（最易漏**顺序断言**）。
- ⚠️ **跨轮复验 PRP 前必须先 build**（`emptyOutDir:false` ⇒ 陈旧 chunk ⇒ 假 FAIL）；**改实现导致源码守卫失败
  ⇒ 强化守卫，不放宽**。像素阈值**按面积推导**。
- ⚠️ **「注释提前闭合」已踩 3 处**：HTML 里 `--` 紧跟 `>`（REF §4）· **JS 块注释里 `*` 紧跟 `/`**（`**/home.html*`
  这类字面量让 `node --check` 直接报错）· 源码字符串守卫匹配前**剥注释**。
- ⚠️ **E2E 假绿**：`page.waitForURL(/home\.html/)` 会被 Run 页**自身地址**当场匹配（查询串带 `home=.%2Fhome.html`）
  ⇒ **根本没等导航**（实测 `navMs=23ms`）。**必须用 pathname 谓词**。
- ⚠️ **负控制纪律**：新增守卫后**故意注入回归**跑一轮，确认目标断言**真的失败**，再干净回退；回退后**必须 grep
  全仓关键词**确认零残留，不能只信「已改回」。

### 2a–2g 已收口契约 → **全文在 REF §5–§14（改前必读）**（这里只留**防回归**的那几条）
- §5/§6 终态出口：`home` = 纯首页（FAILED `exitHref` 恒 `null` ⇒ **绝不入库**）；Lab **不硬编码产品 URL**、失败
  **不接受隐式推进**（`RP-D-06`）；幂等键 = **run token**。
- §7/§8 合成/星级：`1 + 0.25 × (star − 1)` = **唯一真源**（**别加回** `STAR_TIER_DAMAGE_MULT = 1.15`，★3 与 ★2
  会同伤害）；`MAX_STAR = 2` **冻结**（与产品 `INVENTORY_MAX_STAR = 5` 是**两件事**）；⚠️ `PR-27` 产品侧/页面/Lab
  **都不许自算**星级伤害；⚠️ `DAY = 1` 只能用**进入 Run 瞬间**的 `runStart` 断（第一场 `d2-battle1` 的 `day` = **2**，
  断言名 `E1b`）。
- §9 装载资格：判据 = **存在性**（**不是槽位**）；拒绝在 **`new RunPage(` 之前**；不支持时**不给 href**；拒绝时
  `loadout` 必须是演示占位（`'unsupported-loadout'` ≠ `'invalid'`）；两常量同值**但各自声明**（`LC-01`）。
  ⚠️ **契约变更作废既有 E2E 路线 ⇒ 换合法路线 + 新增守门断言，不删断言**。
- §10 旧 profile 迁移：`migrateLegacyStarterProfile():350` 纯函数不落盘 + `loadEquippedDraft():383` 命中落盘一次；
  **无存档仍不写盘**；判别式 = **同时**满足 ①`front`/`frontMass` == `makeStarterDraft()` ②`functionalStars?.front
  === undefined`（任一不成立 ⇒ **一字节不改**）。⚠️ **「见推杆就删」是错的**；`PL-03` 钉 `savePlayerBuild(` 只准 1 次。
- §11 基线伤害 + onboarding：`content.ts` cannon 恒 **80**（零改动）；玩家侧 **120 / 150** 只经
  `createRunRegistry(build, playerBaseline = false)`（**只有 `runPage.ts:beginBattle` 传 `true`**）；候选池
  `['cannon']`；E2E 里 `CLAIM_ID`(cannon) 与 `WEAPON_B`(spear) **必须解耦**（下标 **−1** ⇒ 崩）。
- §13 结算/音频：COMPLETE 奖励**固定 `cannon ★1 ×1`** ⇒ **卡片 = 纯展示**、**底栏「领取并返回」= 唯一入口**；
  有候选视图时 `actionEnabledNow()` 恒 `true`。⚠️ 「COMPLETE + 有候选 ⇒ 逼隐藏按钮」的**第三支守卫已删，别加回来**。
  ⚠️ 音频真凶 = `stopBattleAudio()` **从未在 Lab 被调用**（`presentation.stop()` **只解绑订阅、不停音源**）。
- §11/§14 一次性迁移三兄弟（`r2Onboarding` **只增不减** / `r2Reseed` **必须删** cannon ★≥2 / `migrateLegacy…`）：
  顺序 = `plan → mutate → saveInventory → 最后 mark`。⚠️ **落标记的判据是「决策」不是「动作」**：
  `r2Reseed` 用 `decided`（四个「不动」的出口也要落标记，否则玩家**自己合出来**的 ★2 会被下一次挂载误清
  —— 门禁真实丢档，REF §14f-2/§14g）；唯一不落标记的是可重试的 `equip-failed`。
  ⚠️ 写语义相反的两件事**不共用一个 key / 模块**。

### 2h R5 起：**新账号内容基线 + 内容池种子契约**（写任何内容相关断言前必读）
- **一次性的第五份种子** `src/product/r5ContentPoolSeed.ts`（R5），key `strongfruit.r5ContentPoolSeed.v1`，
  版本 `R5_CONTENT_POOL_VERSION = 1`。与 R2/R3/R4 三份**逐条同构**：判定（纯读）→ 变更 → 落盘 → **最后**落标记；
  标记语义 = **`decided`（决策已做出）**⇒ `already-complete` 出口**也必须落标记**（否则玩家自己消耗一件会被重发）。
- **它发什么**：`R5_POOL_BODY_IDS = NEW_OFFICIAL_BODIES`（4 台全解锁）+ `R5_POOL_PART_IDS = OFFICIAL_PARTS`
  （11 件各补到 ★1 ≥1）。**只补缺的**；唯一写动作 `grantBody` + `addPart(inv,id,1,n)` ⇒ **只增不减、不发 ★2+**。
- ⚠️ **新账号内容基线（照这个写断言）**：Garage 武器槽 **9 张卡**（3 → 9）、车身槽 **8 张**、后轮/前轮各 **5 张**，
  四个槽 **`locked = 0`**。`weapons` = `playerLoadout.weaponEntries()` = 仅 `category === 'weapon'`，
  按 id 字典序：`cannon, flamethrower, hammer, laser, machineGun, rammer, saw, shotgun, spear`（9 件；
  `pushRod`/`thruster` 是 **gadget**、不在其中）。
- ⚠️ **storage key 闭集 七 → 八**（+`r5ContentPoolSeed.v1`）。既有两处闭集断言已 +1：
  `_e2e_product_home.cjs` 的 **E5**、`_e2e_product_reseed.cjs` 的 **R2g**（另 product-loop **A1b** /
  product-reward **A3、G1** 已改为「9 件逐 id 相等」）。
- ⚠️ **内容化之后会「失效」的既有前提**：`product-home` 的 **GS6** 原靠「Body 槽天然有未拥有样本」——
  已被内容池作废 ⇒ 现改为**受控样本**（同会话内临时写正式 `ownedBodies.v1` 去掉一台，取证后恢复，
  新增 **GS6b** 证明复原）。**手法与 M2b 一致**；**契约变更作废 E2E 路线时，换合法路线 + 加守门断言，不删断言**。
- ⚠️ **卡片表变长 ⇒ 真实鼠标点击必须先 `scrollIntoViewIfNeeded()`**：9 张卡后
  `[data-ph-weapon="spear"]` 落在滚动区外，`boundingBox()` 仍给矩形但点空（实测 `lastEquip=null`）。
  `product-reward` 的 `clickSelector` 已按 `product-loop` 同法补齐。
- **canonical 内容事实（沿 Runtime 查过，别重查）**：`contactRouter.ts` 弹丸读 `projectileDamage`(:996)、
  直击读 `baseDamage`(:688)，**grep `'cannon'` 为空** ⇒ 伤害链共用、**无 cannon 专属 modifier**；
  `behaviorRegistry.FACTORIES` **11 项已注册**、**`'ram'` 未注册** ⇒ `spear` 靠 collider 直击、无 behavior runtime；
  `buildSnapshotFromDraft` **无 behavior/category 过滤** ⇒ 11 件全部可进 Snapshot。
- ⚠️ **仍未放宽** `runCompatibility.FULL_RUN_SUPPORTED_WEAPON_IDS = ['cannon']`（与
  `runModifiers.RUN_BASE_WEAPON_DEF_ID` 同值但**各自声明**）。为武器补正式 Run Build 内容是**另一条 Queue**。

## 3. 指向
`REF_PRP_RUNTIME.md` §A 战斗参数 · §B 相机 · §C 接缝/第一层冻结值 · §D RUN-R1 · §E BUILD-01 · §F/§J/§K RUN-02 ·
§G M2 种子 · §H M3 遭遇台 · §I Hub · §L M2-R1 终点态出口 · §M PBL-RDC。各轮交付细节**只在同名交接文档**
（§5 `R1-D` … §14 `R2-RESEED-R1`，§15 `R5`）。启动：`npm run dev`（默认**产品首页**；研发 `dev:home` / `dev:next-run` /
`dev:encounter-lab` / `dev:validation`）。
