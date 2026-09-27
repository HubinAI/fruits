# Fruits - Runtime Memory Index

**只放「不变量 + 陷阱 + 下一步」+ 指针。** 契约全文 / 实测数字 / 逐帧时间线**不在这里**。

| 要找什么 | 去哪 |
|---|---|
| 本轮做了什么、实测数字 | `.workbuddy/memory/YYYY-MM-DD.md`（最新 `2026-09-27.md`） |
| **改动前必读**：守卫 / 环境陷阱 / **§1–§18 契约全文** / **未决项台账 §A** | `.workbuddy/memory/REF_GUARDS_TRAPS_CONTRACTS.md` |
| PRP 运行时细节（战斗参数 / 相机 / 接缝 / 入口 / file:line） | `.workbuddy/memory/REF_PRP_RUNTIME.md` §A–M |
| **跨窗口续接（先读）** / 各 Queue 交付说明 / 已知未修清单 | `交接文档_<日期>_<Queue>.md`（**本地件，不入库**） |
| 更早完整版（最高权威） | `.workbuddy/memory/archive/` |

## 0. 现状 / 下一步（**新窗口先读这段**）
R2(A/B/C)、R2-RECOVERY、SETTLEMENT-CTA-LATENCY、SINGLE-CTA+音频、R2-RESEED、R4、R3、R5、Q5、
R6（武器真源 / Runtime 批次）、**Q3 三段 Encounter 序列**均已收口；
**最新一轮 = `PRODUCT-LOOP-R6-CONTENT-FOUNDATION-BATCH-GATE`（2026-09-27 · 纯门禁：零改码零 commit，
八批 E2E 全 EXIT=0）**，链尾 `e38cb01`；口径与数字 → REF §18f。

- ⚠️⚠️ **Q3 的能力边界（新窗口最容易误判的一条）**：第 3 段 `RangedTurret` 是全项目**唯一**
  `enemyDrive:'keep-distance'` 的对手，而产品可达装配只有「主武器槽一门炮」⇒ **产品侧三段序列
  必然 `RUN FAILED`**（`battles=3/3 耐久=0%`）。**能力下降，不是回归** ⇒ 产品 E2E 的「到 COMPLETE」
  判据**不删**，改成如实 FAILED + 其余记 **`BLOCKED`**（`pass:null`，三桶、退出码只看 FAIL）。
  ⚠️ **不要**为让它变绿去放宽 `FULL_RUN_SUPPORTED_WEAPON_IDS` 或改对手数值。**全文 → REF §17**。
- **Full Run Weapon 登记（当前真源）→ REF §18**：**放行 7 件**（`cannon` / `flamethrower` /
  `hammer` / `laser` / `machineGun` / `rammer` / `shotgun`）· **BLOCK 2 件**：`spear`
  （`behavior:'ram'` 无 factory ⇒ Runtime 不完整）、`saw`（挂 `frontMass` 时被车身挡住 ⇒ 打不到人）；
  另有 `ramHead` 不在 `OFFICIAL_PARTS` + `pushRod`/`lifter`/`thruster` 是 gadget。
  ⚠️ **Q5 期「唯一支持完整 Run 的是 cannon」已被 R6 / R6-BATCH 取代**（REF §16 开头有取代横幅）；
  判据 = 「**装配顺序第一件**正式武器」。
- **写内容相关断言前必读 → REF §15**：新账号基线（武器槽 **9 张卡**、`weapons` 恰 9 件）、
  `weaponDefs()` **10 件 ≠ 可拥有 9 件**、storage key 闭集 **八**、卡片表变长后点击前必须
  `scrollIntoViewIfNeeded()`。
- **下一步 = 等用户下发新 Queue**（尚未开工）。
- ⚠️ **未修 → 独立 Bug Queue，禁顺手并改**：① `validateSnapshot` 不含星级倍率
  （`runPageState.ts:114` vs `:48`）② `e2e:next-run` 崩（`_e2e_next_run.cjs:619`：
  Hub 入口期望 3 个、现有 4 个）③ Lab `playerFunctionals()` 注释与实际不符 ④ **Q3 能力缺口**
  （真人裁决 = 如实降级）：(a) 产品可达装配打不赢终局 ⇒ 浏览器端**没有**「到 COMPLETE」的路径
  (b) 由此浏览器端完整玩家闭环无证据（loop 20 + reward 42 + star-power 14 + reseed 5 条 BLOCKED）
  (c) 旧 C9 偶发红随降级变 `BLOCKED`（不再观测）。
- **明确未做**（别再ask）：Garage 观感 / 奖励动画 / 内容量 / Buff 平衡 / 挂点几何 /
  为武器补**非 Cannon 的**正式 Run Build 内容（局内成长内容仍是 Cannon 专属 ⇒ 非 cannon 拿不到伤害
  成长，见 REF §18e；`saw` 的挂点 / 几何缺口**不动**，见 §18b）。
  **均未归档**：LightSwarm 真人结论 / 各轮录屏回执；1vN 宿主 = DEBUG `arenaA.ts:814`。

## 1. Identity / 链尾
- Repo `git@github.com:HubinAI/fruits.git` | dir `D:\0818new\最强水果` | 工作分支
  `prototype-portrait-battle-lab`（实验，可整块删）；主线 `foundation-02-wechat`。
  正式名 **PRP｜Portrait Run Prototype**。舞台 844×390。
- **链尾**：R2-A `c40977a` → R2-B `16a221f` → R2-C `9e4e88c` → P0 `9841274` → PLP0-LEGACY `9078cc5` →
  R2-RECOVERY `8770c98`+`e50b95c` → SETTLEMENT-CTA-LATENCY `1931a71` → SINGLE-CTA+AUDIO
  `c2c1e2c`+`c55a285` → R2-VALIDATION-STATE-RESEED `88288b4`+`7dacd47` → R4 `3e48b16` → R4-GATE `8887ad6`
  → GARAGE-MOBILE `f357383` → GARAGE-SLOT-R2 `a51de9b` → `edd8f78` → `c76f1a2` → R3 `06e44de` →
  R5 `5baff53` → `a06f2a4` / `cf16cb9` / `99a094c`（chore(memory)） → Q5 `9dcbf7b` →
  `1b92670`（chore(memory) Q5） → R6-RUN-WEAPON-SOURCE-OF-TRUTH `fb6c922` →
  R6-RUNTIME-COMPLETE-WEAPON-BATCH `ef601b0` → **Q3 `341f2fb`**；更早查 `git log`。
- ⚠️ `src/{physics,render,player,platform,ui,game,presentation,lab}` diff 自 R2-B 起**有意打破**
  （Q3 改了 `src/lab/portraitBattleLab/runScript.ts`）；`src/core` 只许 R2-B（`partInventory.ts` /
  `buildPersistence.ts`）+ R2-C（`buildSnapshot.ts` 星级**唯一真源** + `types.ts`）两处必改，
  **此后再无 core 改动**。R3–R5 只动 `src/product/`。
  新增 `src/product/` 模块**必须**在 `tests/productLoopHomeGarage.test.ts` 的 **PL-26**
  （import 白名单、**闭集**）里**登记**（登记，不是放宽）。
- 每轮必交边界取证：`git diff --stat -- src/{core,battle,physics,render,player,platform,game,presentation,ui}`
  \+ `git diff --exit-code -- src/core/content.ts src/battle/contactRouter.ts`。

## 2. 红线速查（全文 → REF §1–§4）
- ⚠️ **环境陷阱**（PATH 加 `/usr/bin` · `git commit -F` 传 **Windows 路径** · `git status` 里中文名是
  八进制 ⇒ 排除 `交接文档_*.md` 用**显式路径** `git add` · 禁 `git stash` ·
  `refs/remotes/origin/` 可能**整个为空** ⇒ 四路核对用 **`git ls-remote`** 顶替 ·
  vitest `--pool=vmForks --maxWorkers=1` 且**必须独占机器**）—— **全文在用户级 `~/.workbuddy/MEMORY.md`**。
- ⚠️ **本宿主 `child_process.spawnSync` 被无条件拒绝**：返回 `status:null` + `error: spawnSync … EBUSY`；
  spawn `node.exe` / `cmd.exe` 全 EBUSY，从 vitest worker、普通 node 进程、**沙箱外**都一致
  （**异步 `spawn` 正常**）。受影响**恰好 2 个**文件：`tests/rcBundleCleanP0.test.ts`（6/9 红）、
  `tests/rcFusionTestEntryP0.test.ts`（T16 红）。**二者在干净 HEAD 上同样红 ⇒ 环境假失败，非回归**
  —— 判定这类红**不要**去改被测逻辑。
- ⚠️ **全量 vitest 有负载抖动**（`vmForks + maxWorkers=1` 下个别重型文件偶发 5s 超时）。判定三步：
  单跑该文件 → 查 import 面有无引用 → **同一批次在干净 HEAD worktree 上再跑一次**。
  ⚠️ **新判据**：「一整个批次红出来的文件集合在两次运行之间会变」⇒ 那批红就是抖动。
  已知抖动机：`portraitLightSwarmExperience.test.ts` 的 **LSE-09**（单跑 22/22 绿）。
- ⚠️ **`e2e:product-reward` 单跑约 2m09s > Bash 工具默认 120s** ⇒ 会被 SIGTERM 掐掉、且**不打印
  `=== 结果`**（日志停在最后一条 `PASS …`）。**必须后台跑**再取日志，否则会把「跑完但被掐」误读成失败。
- ⚠️ **E2E 端口各自独立且互不复用** ⇒ 并发跑会 `EADDRINUSE`，**串行跑**。
- ⚠️ **入口唯一性**：根路径 `/` 由 dev-only `build/branchDevEntry.ts` 重写（**R1-C 起 = `/home.html`**）；
  该逻辑不许进 `vite.config.ts`。研发入口（`run-page.html` / Hub / Lab / `index.html`）**一个都没删**。
- ⚠️ **`R22b`**：`src/`（Lab 之外）0 处 `portrait-lab` / `portraitBattleLab` 字样（注释 / import 路径 /
  产物名也不行）。Lab `ALLOWED_RELATIVE_IMPORTS` 是闭集 ⇒ **Lab 读不到正式存档 ⇒ 产品页只放
  `src/product/`**。
- ⚠️ 页面模块**级零 DOM**（自挂载放 `*Main.ts`）；导航只写常量交给 `<a href>`（`RP-25` / `RP-25b` / `PL-29`）。
  **加根 html 同步 5 处（挂 Hub 7 处）**；加 Hub 入口 **4 处硬断言**（最易漏**顺序断言**）。
- ⚠️ **跨轮复验 PRP 前必须先 build**（`emptyOutDir:false` ⇒ 陈旧 chunk ⇒ 假 FAIL）；**改实现导致源码守卫
  失败 ⇒ 强化守卫，不放宽**。像素阈值**按面积推导**。
- ⚠️ **「注释提前闭合」已踩 3 处**：HTML 里 `--` 紧跟 `>` · **JS 块注释里 `*` 紧跟 `/`**
  （`**/home.html*` 这类字面量让 `node --check` 直接报错）· 源码字符串守卫匹配前**剥注释**。
- ⚠️ **E2E 假绿**：`page.waitForURL(/home\.html/)` 会被 Run 页**自身地址**当场匹配（查询串带
  `home=.%2Fhome.html`）⇒ **根本没等导航**（实测 `navMs=23ms`）。**必须用 pathname 谓词**。
- ⚠️ **负控制纪律**：新增守卫后**故意注入回归**跑一轮，确认目标断言**真的失败**，再干净回退；
  回退后**必须 grep 全仓关键词**确认零残留，不能只信「已改回」。

### 2a–2g 已收口契约 → **全文在 REF §5–§14（改前必读）**（这里只留**防回归**的那几条）
- §5 / §6 终态出口：产品失败终态**绝不入库**；Lab **不硬编码产品 URL**、失败**不接受隐式推进**
  （`RP-D-06`）；幂等键 = **run token**。
- ⚠️⚠️ **FAILED 终点的动作随宿主给的 `href` 变**（Q3 实测，**踩过**）：产品侧 Run 地址带
  `home=./home.html` ⇒ 有回程地址 ⇒ `actionEnabled === true` / `exitHref === './home.html'` /
  底栏画**可用态**「返回主界面」；**研发入口不带该参数** ⇒ `href === ''` ⇒ 「结算照常呈现，但**没有
  按钮**」（`actionEnabled === false` / `exitHref === null`，`runPage.ts:691-692`）。
  ⇒ 写失败终态断言**必须先确认跑的是哪一侧**，别把 Lab 形状抄到产品侧。
- §7 / §8 合成 / 星级：`1 + 0.25 × (star − 1)` = **唯一真源**（**别加回**
  `STAR_TIER_DAMAGE_MULT = 1.15`，否则 ★3 与 ★2 同伤害）；`MAX_STAR = 2` **冻结**（与产品
  `INVENTORY_MAX_STAR = 5` 是**两件事**）；`PR-27` 产品侧 / 页面 / Lab **都不许自算**星级伤害；
  `DAY = 1` 只能用**进入 Run 瞬间**的 `runStart` 断（第一场 `d2-battle1` 的 `day` = **2**，断言名 `E1b`）。
- §9 装载资格：判据 = **存在性**（**不是槽位**）；拒绝在 **`new RunPage(` 之前**；不支持时**不给 href**；
  拒绝时 `loadout` 必须是演示占位（`'unsupported-loadout'` ≠ `'invalid'`）；两常量同值**但各自声明**。
  ⚠️ **契约变更作废既有 E2E 路线 ⇒ 换合法路线 + 新增守门断言，不删断言**。
- §10 旧 profile 迁移：`migrateLegacyStarterProfile():350` 纯函数不落盘 + `loadEquippedDraft():383`
  命中落盘一次；**无存档仍不写盘**；判别式 = **同时**满足 ①`front`/`frontMass` ==
  `makeStarterDraft()` ②`functionalStars?.front === undefined`（任一不成立 ⇒ **一字节不改**）。
  ⚠️ **「见推杆就删」是错的**；`PL-03` 钉 `savePlayerBuild(` 只准 1 次。
- §11 基线伤害 + onboarding：`content.ts` cannon 恒 **80**（零改动）；玩家侧 **120 / 150** 只经
  `createRunRegistry(build, playerBaseline = false)`（**只有 `runPage.ts:beginBattle` 传 `true`**）；
  候选池 `['cannon']`；E2E 里 `CLAIM_ID`(cannon) 与 `WEAPON_B`(spear) **必须解耦**（下标 −1 ⇒ 崩）。
- §13 结算 / 音频：COMPLETE 奖励**固定 `cannon ★1 ×1`** ⇒ **卡片 = 纯展示**、**底栏「领取并返回」=
  唯一入口**；有候选视图时 `actionEnabledNow()` 恒 `true`。⚠️「COMPLETE + 有候选 ⇒ 逼隐藏按钮」的
  **第三支守卫已删，别加回来**。⚠️ 音频真凶 = `stopBattleAudio()` **从未在 Lab 被调用**
  （`presentation.stop()` **只解绑订阅、不停音源**）。
- §11 / §14 一次性迁移三兄弟（`r2Onboarding` **只增不减** / `r2Reseed` **必须删** cannon ★≥2 /
  `migrateLegacy…`）：顺序 = `plan → mutate → saveInventory → 最后 mark`。
  ⚠️ **落标记的判据是「决策」不是「动作」**：`r2Reseed` 用 `decided`（四个「不动」的出口也要落标记，
  否则玩家**自己合出来**的 ★2 会被下一次挂载误清；唯一不落标记的是可重试的 `equip-failed`）。
  ⚠️ 写语义相反的两件事**不共用一个 key / 模块**。

## 3. 指向
`REF_GUARDS_TRAPS_CONTRACTS.md`：§1–§4 环境 / 契约 / 存档链 / E2E 书写陷阱 · §5–§14 各轮固化契约 ·
**§15 R5 内容池种子 + 新账号内容基线** · **§16 非 cannon 武器两次 STOP（Q5 期历史，已被取代）** ·
**§17 三段 Encounter Sequence + 「如实降级」口径（含 `BLOCKED` 写法与门控陷阱）** ·
**§18 Full Run Weapon 能力登记表（当前真源：放行 7 / BLOCK 2）+ R6-BATCH + BATCH-GATE 门禁** ·
§A 未决项台账。
`REF_PRP_RUNTIME.md` §A 战斗参数 · §B 相机 · §C 接缝 / 第一层冻结值 · §D RUN-R1 · §E BUILD-01 ·
§F / §J / §K RUN-02 · §G M2 种子 · §H M3 遭遇台 · §I Hub · §L M2-R1 终点态出口 · §M PBL-RDC。
各轮交付细节**只在同名交接文档**（§5 `R1-D` … §14 `R2-RESEED-R1`，§15 `R5`）。
启动：`npm run dev`（默认**产品首页**；研发 `dev:home` / `dev:next-run` / `dev:encounter-lab` /
`dev:validation`）。
