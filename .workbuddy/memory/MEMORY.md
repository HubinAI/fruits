# Fruits - Runtime Memory Index

**只放「不变量 + 陷阱 + 下一步」+ 指针。** 契约全文 / 实测数字 / 逐帧时间线**不在这里**。

| 要找什么 | 去哪 |
|---|---|
| 本轮做了什么、实测数字 | `.workbuddy/memory/YYYY-MM-DD.md`（最新 `2026-09-21.md`） |
| **改动前必读**：守卫 / 环境陷阱 / Stable contracts / §1–§13 契约全文 / **未决项台账 §A** | `.workbuddy/memory/REF_GUARDS_TRAPS_CONTRACTS.md` |
| PRP 运行时细节（战斗参数 / 相机 / 接缝 / 入口 / file:line） | `.workbuddy/memory/REF_PRP_RUNTIME.md` §A–M |
| **跨窗口续接（先读）** / 各 Queue 交付说明 / 已知未修清单 | `交接文档_<日期>_<Queue>.md`（**本地件，不入库**） |
| 更早完整版（最高权威） | `.workbuddy/memory/archive/` |

## 1. Identity / 链尾
- Repo `git@github.com:HubinAI/fruits.git` | dir `D:\0818new\最强水果` | 工作分支 `prototype-portrait-battle-lab`
  （实验，可整块删）；主线 `foundation-02-wechat`。正式名 **PRP｜Portrait Run Prototype**。舞台 844×390。
- **链尾**：R1-A `c0d2c5d`+`69c4d1e` → R1-B `f1b87a2` → R1-C `4f0be1a` → R1-D `c63408c` → R2-A `c40977a` →
  R2-B `16a221f` → R2-C `9e4e88c` → P0 `9841274` → PLP0-LEGACY `9078cc5` → R2-RECOVERY `8770c98`+`e50b95c` →
  P0-SETTLEMENT-CTA-LATENCY `1931a71` → **P0-SETTLEMENT-SINGLE-CTA-AND-AUDIO-LIFECYCLE `c2c1e2c`**。
- ⚠️ `src/{physics,render,player,platform,ui,game,presentation,lab}` diff 恒为空（R2-B 起有意打破）；`src/core` 只许
  R2-B（`partInventory.ts`/`buildPersistence.ts`）+ R2-C（`buildSnapshot.ts` 星级**唯一真源** + `types.ts`）两处必改，
  **此后再无 core 改动**（含本轮）。
- 每轮必交边界取证：`git diff --stat -- src/{core,battle,physics,render,player,platform,game,presentation,ui}` +
  `git diff --exit-code -- src/core/content.ts src/battle/contactRouter.ts`。

## 2. 红线速查（全文 → REF_GUARDS §1–§4）
**环境陷阱（都真踩过，全文在用户级 `~/.workbuddy/MEMORY.md`）**：PATH 起手加 `/usr/bin` · `git commit -F` 传
**Windows 路径** · 中文名在 `git status` 里是八进制 ⇒ 排除 `交接文档_*.md` 用**显式路径** `git add` · 禁 `git stash` ·
`refs/remotes/origin/` 可能**整个为空** ⇒ 四路核对用 **`git ls-remote`** 顶替那一路 · vitest
`--pool=vmForks --maxWorkers=1` 且**必须独占机器**（与 E2E / 构建并发时**无关文件**报 5s 超时，不是真 bug）。

- ⚠️ **入口唯一性**：根路径 `/` 由 dev-only `build/branchDevEntry.ts` 重写（**R1-C 起 = `/home.html`**）；该逻辑不许进
  `vite.config.ts`。研发入口（`run-page.html` / Hub / Lab / `index.html`）**一个都没删**。
- ⚠️ **`R22b`**：`src/`（Lab 之外）0 处 `portrait-lab`/`portraitBattleLab` 字样（注释 / import 路径 / 产物名也不行）。
  Lab `ALLOWED_RELATIVE_IMPORTS` 是闭集 ⇒ **Lab 读不到正式存档 ⇒ 产品页只放 `src/product/`**。
- ⚠️ 页面模块**级零 DOM**（自挂载放 `*Main.ts`）；导航只写常量交给 `<a href>`（`RP-25`/`RP-25b`/`PL-29`）。
  **加根 html 同步 5 处（挂 Hub 7 处）**；加 Hub 入口 **4 处硬断言**（最易漏**顺序断言**）。
- ⚠️ **跨轮复验 PRP 前必须先 build**（`emptyOutDir:false` ⇒ 陈旧 chunk ⇒ 假 FAIL）；**改实现导致源码守卫失败
  ⇒ 强化守卫，不放宽**。像素阈值**按面积推导**。
- ⚠️ **「注释提前闭合」已踩到 3 处**：HTML 里 `--` 紧跟 `>`（REF §4）· **JS 块注释里 `*` 紧跟 `/`**
  （`**/home.html*` 这种字面量会让 `node --check` 直接报错，本轮实测）· 源码字符串守卫匹配前**剥注释**。
- ⚠️ **E2E 假绿**：`page.waitForURL(/home\.html/)` 会被 Run 页**自身地址**当场匹配（查询串带 `home=.%2Fhome.html`）
  ⇒ 立即返回、**根本没等导航**（实测 `navMs=23ms`）。**必须用 pathname 谓词**。

### 2a–2e 已收口契约 → **全文在 REF §5–§11（改前必读）**
- **终态出口** §5/§6：`home` = 纯首页（FAILED `exitHref` 恒 `null` ⇒ **绝不入库**）；Lab **不硬编码产品 URL**、
  失败**不接受隐式推进**（`RP-D-06`）；幂等键 = **run token**。
- **合成 / 星级** §7/§8：`1 + 0.25 × (star − 1)` 是**唯一真源**（**别加回** `STAR_TIER_DAMAGE_MULT = 1.15`：★3 与 ★2
  会同伤害）；`MAX_STAR = 2`（旧横屏融合上限）**冻结**；⚠️ **`PR-27`** 产品侧/页面/Lab **都不许自算**星级伤害；
  ⚠️ `DAY = 1` 只能用**进入 Run 瞬间**的 `runStart` 断（第一场 `d2-battle1` 的 `day` = **2**），断言名 `E1b`。
- **装载资格** §9：判据 = **存在性**（不是槽位）；拒绝在 **`new RunPage(` 之前**；不支持时**不给 href**；拒绝时
  `loadout` 必须是演示占位（`'unsupported-loadout'` ≠ `'invalid'`）。⚠️ **契约变更作废既有 E2E 路线 ⇒ 换合法路线 +
  新增守门断言，不删断言**。
- **旧 profile 迁移** §10：产品侧语义迁移（`migrateLegacyStarterProfile():350` 纯函数不落盘 +
  `loadEquippedDraft():383` 命中落盘一次）；**无存档仍不写盘**；判别式须**同时**满足两条（任一不成立 ⇒ **一字节不改**）。
  ⚠️ **「见推杆就删」是错的**；`PL-03` 钉 `savePlayerBuild(` 只准 1 次。
- **基线伤害 + onboarding** §11：`content.ts` 的 cannon 恒 **80**（零改动）；玩家侧 **120 / 150** 只经
  `createRunRegistry(build, playerBaseline = false)`（**只有 `runPage.ts:beginBattle` 传 `true`**）；
  候选池 `['cannon']`；E2E 里 `CLAIM_ID`(cannon) 与 `WEAPON_B`(spear) **必须解耦**（下标 **−1** ⇒ 崩）；
  onboarding 顺序 = `plan → raise → saveInventory → markR2Onboarding`（**标记最后**）。

### 2f 结算唯一 CTA + 战斗音频（§13；**出口契约以本节为准**）
产品前提已变：COMPLETE 奖励**固定 `cannon ★1 ×1`** ⇒「点卡选一件」不再需要。
- **卡片 = 纯展示**（点它什么都不发生）；**底栏「领取并返回」= 唯一入口**（`runSingleRewardClaim()` 取 `choices[0]`）。
  有候选视图时 `actionEnabledNow()` 恒 **`true`**；`actionLabelNow()` 顺序 = **`claiming` 优先** → 奖励 → 失败 → 终态。
  ⚠️ 上一轮那条「COMPLETE + 有候选 ⇒ 逼隐藏按钮」的**第三支守卫已删除**，**别加回来**。
  ⚠️ `exitHref` 在 COMPLETE 恒 `null`（那条按钮**不是** href 跳转）⇒ 判「有没有 CTA」看 `actionEnabled` + `actionLabel`。
- ⚠️ **音频根因**：`presentation.stop()` **只解绑事件订阅、一个音源都不停**；终局对手死在蓄能途中 ⇒ 循环蓄能音一直响。
  真凶 = `SfxAudioService.stopBattleAudio()` **从未在 Lab 被调用**。修复 = `RunBattleView` 自持 `sfx` + `stopBattleAudio()`，
  调用点**两处**（终态那一帧 + `dispose()`，**复用同一幂等入口**）；`stopBattleAudio(fadeMs?)` 缺省 `220`（逐字节不变）。
- ⚠️ **窗口取证三条反直觉结论**（§13c，全部量过）：① 读必须**钉住旧文档 `contextId`**（否则 `page.evaluate`
  与裸 CDP 都去等新文档）；② **人为挂起导航反而把读毁掉**；③ 连点**同批发出**。最终 `navMsNet === navMs`（46~51 ms）。
- ⚠️ **`actionRect` 是布局常量、修前修后都非 null** ⇒ **不能**当「按钮存在」的证据，必须靠**像素**。
- ⚠️ **`src/lab/portraitBattleLab/` 全目录 0 处 `setTimeout`/`setInterval`**（`PL-P0-01`）。

## 3. 各功能面 → 细节在 REF / 交接文档
`REF_PRP_RUNTIME.md`：战斗参数 §A · 相机 §B · 接缝与第一层冻结值 §C · RUN-R1 §D · BUILD-01 §E · RUN-02 §F/§J/§K ·
M2 种子 §G · M3 遭遇台 §H · Hub §I · M2-R1 终点态出口 §L · PBL-RDC §M。
⚠️ **只在交接文档**：`R1-A/B/C` · `R1-D`(§5) · `R2-A`(§6) · `R2-B`(§7) · `R2-C`(§8) · `P0`(§9) · `PLP0-LEGACY`(§10) ·
`R2-RECOVERY`(§11) · `P0-SETTLEMENT-CTA-LATENCY`(§12) · `P0-SETTLEMENT-SINGLE-CTA-AND-AUDIO-LIFECYCLE`(§13)。
启动：`cd D:\0818new\最强水果` → `npm run dev`（默认**产品首页**；研发 `dev:home` / `dev:next-run` /
`dev:encounter-lab` / `dev:validation`）。

## 4. Next action
**R2（A/B/C）+ R2-RECOVERY + P0-SETTLEMENT-CTA-LATENCY + SINGLE-CTA/音频（`c2c1e2c`）均已收口**，无功能缺口、无 BLOCK。
门禁基线：`tsc` 零错 · vitest **219 files / 2309 tests** · `build`/`build:pages`/`build:wechat`（`game.js` 1,416.73 kB）·
reward **57/57** · loop **53/53** · star-power **22/22** · fail **34/34** · legacy **17/17** · home **30/30** · default-entry **86/86**。
⚠️ **`e2e:next-run` 仍崩**（`_e2e_next_run.cjs:619` 等 Hub 入口**恰好 3 个**而现有 **4** 个）= **既有缺陷**，非回归。
**⚠️ 发现但未修 → 独立 Bug Queue，禁顺手并改**：① `validateSnapshot` **不含星级倍率**（`:114` `def.energy` vs `:48`
`starTierEnergy`）⇒ Q22 漏改 ② `e2e:next-run` 崩溃 ③ Lab `playerFunctionals()` 注释与实际不符。
**明确未做**：Garage 观感 / 奖励动画 / 内容量 / Buff 平衡 / 挂点几何。**后续段缺口**：1vN 宿主 = DEBUG
`arenaA.ts:814`；LightSwarm 真人结论与各轮录屏回执**均未归档**。
**下一步 = 等用户裁决 REF §A 台账任一项，或下发新 Queue；用户已明令「不自行进入 R3」。**
