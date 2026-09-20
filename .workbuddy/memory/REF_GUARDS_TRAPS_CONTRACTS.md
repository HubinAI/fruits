# REF｜结构守卫 · 环境陷阱 · Stable contracts

> 由 `MEMORY.md` §3/§4 迁出（2026-09-19 瘦身）。**改动前必读**。`MEMORY.md` 只留速查 + 指针。

## §1 Git / build / 环境（陷阱清单）

- `git stash` **禁止**；git 异常先 `scripts/repo-health.js`。禁 `reset --hard` / `checkout --` / 删 `.git` / 手改 refs。
- 单功能 commit + push + **四路核对**（`HEAD` = 本地 ref = `git ls-remote` = `.git/FETCH_HEAD`）；⚠️ 核对前先
  `git fetch origin <branch>`（本机 remote-tracking refs 落不了地 ⇒ 直接读会拿到陈旧值）。
- ⚠️ `git commit -F` 必须传 **Windows 路径**；**不要**用 `git commit -m @'…'@`（那是 PowerShell here-string 语法）。
- Memory 并入功能 commit（**纯 memory 补正**例外）；⚠️ memory 里别引用补正 commit **自身**的 SHA。
- ⚠️ `git status` 中文名是**八进制转义**（`"\344\272\244..."`）⇒ 排除 `交接文档_*.md` 要用**显式路径** `git add`，
  别 grep 中文关键字（转义后串里没有中文）。核对暂存集用 `git diff --cached --name-status`。
- vitest：`--pool=vmForks --maxWorkers=1`；过滤器用**子串**；⚠️ **必须独占机器**（与 E2E / 构建并发 ⇒ **无关文件**报
  `Test timed out in 5000ms`，先单独重跑复现再判定）；重型用例显式 `timeout`。
- 本机 bash 常缺 `/usr/bin` ⇒ 命令前 `export PATH="/usr/bin:/bin:$PATH"`。截图 / 日志落 `outputs/`（gitignored）。
- ⚠️ **id 改名 = 全通道同步**：`src` + `tests/*.ts` + `tests/*.cjs`（E2E 侧有**镜像字面量表**）。

### 加根目录 html 的同步面（实测口径）

- ⚠️ **每加一个根 html = 5~7 处同步**。PBL-M3-LIGHT-SWARM 实测 **7 处**：`R2-03` 不重写清单 · `R2-10` 完整清单
  （**字典序**）· `vite.portrait-lab.config.ts` 的 `input` · `constants.ts` 头部删除清单 · `package.json` 的 `dev:*`
  script · `validationHub.ts` 入口表（**仅当挂 Hub**）· 新页面自己的守卫测试。
- ⚠️ **不挂 Hub 的产品页 = 5 处**（PRODUCT-LOOP-R1-A 实测，`home.html`）：`R2-03` · `R2-10`（字典序第 3 位）·
  `vite.portrait-lab.config.ts` input（**加进去 = 与 `run-page.html` 同产物**，可用相对链接）· `package.json`
  `dev:*` · **`H-05` 非验证页排除表**（`tests/portraitValidationHub.test.ts` 的 `NON_VALIDATION_PAGES`，
  `['index.html','portrait-lab.html','home.html']`，其余新增根 html 依旧 FAIL ⇒ 守卫强度不变）。

### 加 Hub 入口的同步面

- ⚠️ **加一个 Hub 入口 = 4 处硬断言**：`validationHub.ts`（union + 表）· `tests/portraitValidationHub.test.ts`
  （`H-01` `toHaveLength(N)` + id/label 数组、`H-02` `Set.size`、`H-04` `want` 表、`H-05` `ENTRY_PAGES`、
  **`H-14`「下一个」循环**）· `tests/_e2e_validation_hub.cjs`（`EXPECT`、`ENTRY_PAGES`、**4 处 `a.vhub-card`
  计数**、**`V20` 顺序断言**、新页 probe 写进 `EXPECT[].probe`）。
  ⚠️ **最容易漏的是「顺序断言」而不是「计数断言」**。

### 需求口径陷阱

- ⚠️ **「可选 A/B / 换一个玩家」类需求先查它是不是可装配件**：`twinCannon` / `heavyShell` / `fastReload`
  是 **Run 的第一层强化**（`runModifiers.ts:95` 的 `Layer1ModifierId`；效果如 `burstRounds 1→2`），**不是部件**
  ⇒ Lab 的 `LAB_LOADOUTS`（`BuildDraft` 部件级）装不出「双联炮」，`arenaA.ts` 也无 `burst` 通道。
  凡「给 Lab 加一个带强化效果的玩家」= 给 Lab 新增 Modifier 层 = **新能力**（未授权不做，且要如实披露）。
  ⚠️ 同源推论（PRODUCT-LOOP-R1-A 钉死）：三个 Run Buff 在 `registry.functionals` 里**查无此件** ⇒
  `isWeaponDefId()` 恒 `false` ⇒ `equipWeapon()` 返回 `not-weapon` ⇒ **结构上不可能伪装成永久装备**。
- ⚠️ **体验验证入口别接进 Validation Hub**：Hub = 玩家可用验证面；Arena A = DEBUG 面（`constants.ts:13-19`）。
  混进去 = 让 DEBUG 结果看起来像正式验证 ⇒ 直接放 Lab 工具栏 + 常驻标记条幅。
- ⚠️ **「已经在该组合里」的入口按钮必须先 `reset`**：否则 `setXxx` 同值 no-op + `start` 幂等 ⇒ 点了完全没反应
  （M2-R1 的 P0 形态）。先 `reset` 再配置 = 永远有真实动作（可反复重开），且 `spawnSerial` 递增可证明是新批次。
- ⚠️ **跨轮复验 PRP 前必须先 `npm run build:portrait-lab`**：E2E 读 `dist-portrait-lab/`，`emptyOutDir:false`
  会留**陈旧 chunk** ⇒ 直接跑 = 假 FAIL。定位：`grep -rl "<新字段>" dist-portrait-lab/` 空 + 旧字段命中。
- ⚠️ **E2E 新段落别推进 `runViewport` 的 `page`**（后续 14 段会继续消费 ⇒ 过期 rect 点击 ⇒ 90s 超时假红）；
  重活用 `browser.newContext()` 另开 page + `close()`。「回到某页」判据**不要写 `location.pathname`** ⇒ 写语义。

## §1b 项目 Rules（工作纪律，最高优先级）

- **1 Queue = 1 problem**；先调查 / 复现、锁定根因再改码；**无静默扩范围**；发现的缺陷拆**独立** Queue（禁混并）。
- **tech pass ≠ 落进运行时 ≠ 真人体验通过**；体验由**用户裁决**。每条回复结尾写「用户需要回什么」；
  Queue 完成 **停等**，不自行开下一条。
- 优先「**数据 / 节点 / 声明**」而非「按计数 / 位置 / role 推断」——后者一加节点就失效（RUN-02-R2 根因）。
- 「一眼可辨」验收先找**相机追不平的物理通道**；不存在就**如实上报失败**，不加提示掩盖。
- 指令语义与禁止清单冲突 ⇒ 按**硬约束**落地并**显式上报解释与代价**（别沉默选一个）。
- PC 录屏常态化；手机录屏只用于大模块节点。
- ⚠️ 「**有按钮 ⇒ 必有 action**」：断言「禁用 / 终点态」时**必须同时断言存在一个真实出口**（M2-R1 的 P0 形态：
  三条 E2E 把缺陷当预期行为钉死 ⇒ 47/47 全绿而真人一点完全无响应）。⚠️ 配套：`runActionEnabled()` 对 `RESULT`
  是 `true` ⇒ 终点态**必须继续拦截**正式流程动作、但放行**自己的出口**；根因常是「按钮文案是**状态描述**而不是动作」。

## §2 Stable contracts（改动前必读）

- **舞台**：DPR 只乘一次（logical→backing）；safe-area / capsule / hitArea 一律**逻辑坐标**。Player 舞台 844×390；
  Lab/PRP 舞台 **390×844**（四带：顶 80 / 舞台 302 / 日志 378 / 动作 84）。**产品页沿用 390×844**
  （`PRODUCT_STAGE_W/H`，`home.html` 里 `.ph-screen` 定 390×844 + `fitStage` 做 contain 缩放）。
- hitArea 与绘制矩形**同源**（`computeFusionLayout` / `runPageLayout`）。⚠️ **相机跟双方中点** ⇒ 屏幕净位移 ≈ 0
  （头号可感知性陷阱：任何「看起来在动」的设计先算相机追平后的净量）；细节见 `REF_PRP_RUNTIME.md` §B。
- E2E 句柄只在 `__E2E_INTERNAL_HANDLE__` 下；dev 下 `false` 是宏语义，不是泄漏。
- **像素账本口径**：只登记「不承载文字、不被描边覆盖」的纯色平铺矩形；承载文字 / 描边的面改点位采样；浮层整页
  遮罩用 `ledgerExpect({ masked: N })`（N = 卡片数）。
- **入口唯一性**：根路径 `/` 由 dev-only 插件 `build/branchDevEntry.ts`（`apply:'serve'`）重写到 `/run-page.html`；
  ⚠️ `vite.config.ts` 两条守卫（`R23` 禁 `portrait-lab|portraitBattleLab`；`RP-27` 禁 `run-page|runMain`）
  ⇒ dev 入口逻辑只能放该插件。
- **判定正式行为要查测试，别信注释**（正式相机口径唯一定义在 `tests/battleDynamicFramingR21.test.ts`）。
- **Lab 源码守卫（必须尊重，不是绕过）**：`R22a-4` 正式编排器**只允许 `runBattleRuntime.ts` import**；
  `ALLOWED_RELATIVE_IMPORTS` 是**闭集**且每条要被**真实命中**（死配置 FAIL）；`labSourceFiles()` **只扫 Lab 顶层
  `.ts`** ⇒ 新增 Lab 文件必须放顶层；`G1-08` = 用 `ev.team`（`ev.source !== 'A'` 会被误判成 arena 分叉）。
- ⚠️ **`R22b`：`src/`（Lab 之外）0 处 `portrait-lab` / `portraitBattleLab` 字样 —— 注释里也不能提**
  （PRODUCT-LOOP-R1-A 实测踩到：写构建脚本名 `build:portrait-lab` 即 FAIL ⇒ 改写成「竖屏产品构建脚本（见
  package.json 的 `build:*`）」）。
- ⚠️ **Lab 白名单决定产品页归属**：`ALLOWED_RELATIVE_IMPORTS` **不放行** `core/buildPersistence` /
  `core/partInventory` ⇒ Lab 内无法写正式存档 ⇒ 产品页**必须**放 `src/product/`（既合法复用正式存档链路，
  又符合「停止扩 Lab」）。⚠️ 反向：`src/product/**` 也不得 import Lab 深层实现（现只允许
  `lab/buildEditorModel` 的 `makeStarterDraft` / `EMPTY_SLOT` / `BuildDraft`）。
- ⚠️ **probe / 账本必须报「本帧真正画出来的东西」**：叠在 `state` 之上的浮层 / 禁用态要配 `*Now()` 访问器，
  并让**绘制 / 命中 / 探针 / 账本四处同一入口**。
- ⚠️ **写断言四坑**：`toEqual` 比**键集**（写取值函数）；浮点别 round 后再去重；源码守卫匹配前**剥注释**
  （含 HTML `<!-- -->`）；「不写战斗数值」类守卫用**正则**（`includes('damage:')` 会被 `damage: cr.damage` 误伤）。
  ⚠️ 第五坑（PRODUCT-LOOP-R1-A 实测）：**别用「定界串不存在」当推断**（`code.includes("'canvas'")` 会被探针里
  合法的 `querySelectorAll('canvas')` 命中）⇒ 改成断言**具体 API**（无 `getContext` / 无 `createElement('canvas')`
  / 必须含 `querySelectorAll('canvas')`）。
- ⚠️ **页面模块级零 DOM**：产品页 / 页面逻辑必须 node 可 import（`homePage.ts` 只导出 `mountProductHome` +
  只读探针；自挂载放 `homeMain.ts`）。否则单测直接 `ReferenceError: document is not defined`
  （PRODUCT-LOOP-R1-A 实测踩到）。范式同 `runPage.ts` / `runMain.ts` / `contentBatchMain.ts`。
- ⚠️ 改实现导致源码守卫失败时**强化守卫，不放宽**（例：`runOverlayCards` 收紧为「唯一调用点 + 三处同源」；
  R2 把「`next` 目标互不重复」收紧为**入度分析**；RDC 把「第 4 实参必须 `{}`」改为两形态白名单 + 无数字断言）。
- ⚠️ **「有按钮 ⇒ 必有 action」**：断言「禁用 / 终点态」时**必须同时断言存在一个真实出口**。M2-R1 的 P0 就是
  三条 E2E（`N20`/`N22`/`N23`）**把缺陷当成预期行为**钉死 ⇒ 47/47 全绿而真人一点完全无响应。⚠️ 配套：
  `runActionEnabled()` 对 `RESULT` 是 `true` ⇒ 终点态**必须继续拦截**正式流程动作、但放行**自己的出口**；
  根因常是「按钮文案是**状态描述**而不是动作」。
- ⚠️ **导航放哪由结构守卫决定**：`runPage.ts` 与**正式玩家页面**共用 ⇒ `RP-25` 禁写 `location` / `history` /
  `window.open` / `createElement('button')` ⇒ 整页导航只能由**宿主**执行；`RunPage` 只发「出口请求」+ 文案。
  ⚠️ 产品页 `homePage.ts` 同规矩（`PL-29` 禁 `location.href` / `window.open` / `history.pushState` /
  `location.assign`）⇒「开始冒险」只写 `START_RUN_HREF` 常量，导航交给 `<a href>`。
- ⚠️ **Hub 与入口是单向关系**：`I4` 要求 `validation-hub.html` 只引用**自己的 chunk + `modulepreload-polyfill-*`**
  ⇒ 入口 `import './validationHub'` 会把 Hub 拉成**跨入口共享 chunk**（守卫直接抓到）。入口页「返回验证中心」
  的地址写**自己**的数据源，两端用交叉核对（`NR-19`）钉死。
- ⚠️ 其余断言坑：probe 字段名 ≠ 展示名（`playerBodyName` 是中文车身名，正式 id 在 `loadoutId`）；开火节奏只能按
  `weaponFire` 事件量（按弹丸数增量会漏计）；「整页压暗」不要用高绝对阈值 ⇒ ~15 + 同点位前后对比；强化图标用
  **盒内面积统计**（`choiceOptions[].iconRect` 与绘制同源）；分带线画在下一条带**首行** `band.y`。
- **启动两行连给**：`cd D:\0818new\最强水果` → `npm run dev`（或 `dev:next-run` / `dev:encounter-lab` /
  `dev:validation` / `dev:home`）。

## §3 正式存档链（产品主循环的数据源）

- `strongfruit.playerBuild.v1`（`core/buildPersistence.ts:18`）= 当前玩家 Build；`strongfruit.ownedParts.v2`
  （`core/partInventory.ts:47-48`）= 库存。读者 `playerGameRuntime.ts:442` `draftA = loadPlayerBuild() ?? silDraft('watermelonBody')`
  （`:1124` silDraft = `makeStarterDraft`）；`:444` `ensureInventory(draftA)`；写点 `:651` `savePlayerBuild`。
- **正式武器权威判据**：`FunctionalPartDef.category: 'weapon' | 'gadget'`（`core/types.ts`）。`PART_OPTIONS` 里
  weapon 共 9 件；`STARTER_PARTS = ['cannon','hammer','pushRod','spear']`（`partInventory.ts:27`）已含 3 件武器。
- **`makeStarterDraft(bodyDefId, registry)`**（`lab/buildEditorModel.ts:182`）：`front→pushRod`（gadget）、
  `frontMass→cannon`（weapon）、`top→hammer`、其余空；`rearRadius/frontRadius = 20`；`drive='forward'`。
- **正式 PNG 只有 5 张**：`body_watermelon.png` / `body_banana.png` / `part_cannon.png` / `part_hammer.png` /
  `part_pushRod.png`。**轮组 PNG 不存在** ⇒ 轮子必然走灰盒回退。
- **Collider 外接框口径**：box 的 `offset` 即矩形中心；circle 的 `offset` 即圆心；**polygon 的 `vertices` 相对
  offset** ⇒ 框心 = `offset + vertices` 包围盒中心（`spear` 的顶点 `x∈[-6,90]` ⇒ 框心 x = 42、宽 96）。
- **sprite 绘制约定**（与 `renderer.ts:1854` `drawVisual` 逐字一致）：`translate(position) · scale(-1,1)[mirror]
  · rotate(rotation)`，sprite 以 `(0,0)` 为中心、尺寸 = `visual.size`；`position = physPos + anchor`
  （`battleContract.ts:245` `visualWorldTransform`）。

---

## §4 页面 / E2E 书写陷阱（PRODUCT-LOOP-R1-C 实测新增）

### §4a HTML 注释里禁止出现注释终止序列（**真实事故**）

**禁止在 HTML 注释里出现注释终止序列**（两个连字符紧跟一个右尖括号，下文记作 TERM）。
浏览器遇到 TERM 就**提前闭合注释**，其后内容全部按**真标签**解析。

- 事故现场：`home.html` 头部注释里画了箭头图，箭头用 TERM 收尾 ⇒ 注释在第 10 行就结束。
  注释里那份用反引号包着的 **anchor 示例**因此变成**真锚点**，且 `href` 为空 ⇒ 解析为**当前 URL**。
  结果：**真实鼠标点击页面上任何位置都触发整页重载**（Garage 视图永远打不开）。
- ⚠️ **症状极具误导性**（这条最贵）：
  - 页面渲染完全正常；
  - `document.elementFromPoint(x, y)` 命中**正确**元素（`isSame: true`）；
  - JS 里 `node.click()` **有效**；
  - 只有 `page.mouse.click()` / `locator().click()` **无效** —— 因为它们派发**真实**鼠标事件。
- **排查顺序**（照抄即可）：
  1. **控制实验**：起一个极简空白页（只有一个铺满视口的 `div`），点同一坐标。
     空白页不重载、目标页重载 ⇒ **是页面，不是测试装置**。
  2. **跨 reload 事件日志**：用 `page.addInitScript` 注册**捕获阶段**监听并把事件写进
     **`sessionStorage`**（⚠️ **不要**在 init 里清空它，否则新文档会把证据擦掉；
     用 `page.evaluate(() => sessionStorage.setItem('__EV','[]'))` 在 `goto` 之后手动清零）。
     若看到「点了某个纯文本元素 → 紧跟 `BEFOREUNLOAD` → 新文档」，即确诊为整页导航。
  3. **数终止序列**：`grep -F -- '-->' *.html` —— 正常入口页应为 `<!-- ×1 / --> ×1`。
- **守卫**：`PL-33`（`tests/productLoopHomeGarage.test.ts`）要求 7 个根 HTML 入口的
  注释开始 / 终止序列**一一配平**；行为侧由主循环 E2E 的**真实鼠标点击**兜底。

### §4b 断言「件数」一律从数据推导，不写死数字

产品默认车（是否挂推杆）一变，所有写死 `6` 的断言立刻假红（`PL-20` 与 `e2e:product-home` 的 `F1`
双双中招）。写 `=== <从 Build/draft 推导出来的件数>`，语义反而更强（顺带证明「同源」）。
⚠️ 同理：**`previewFallbackCount === 0`** 从来不是可达状态 —— 轮组 PNG 不存在（见 §3），
轮子**必然**走灰盒回退；正确的强断言是「探针件数 === 真实 `<img>` 数、每张图 `naturalWidth > 0`、
无图件**必须**带 `data-ph-nosprite` 标注」。

### §4c 探针字段不能跨页串用

`weaponSlot` 是**首页** `ProductProbe` 的字段；**Run 探针没有它**。
写成 `p.playerLoadout.functionalSelections[p.weaponSlot]` 会恒为 `undefined`
⇒ 断言静默退化成「不比较任何东西」（日志里表现为 `undefined=undefined`）。
跨页对账要显式取**首页探针**的字段（或改用挂点级逐槽比较）。

### §4d `page.reload()` 之后视图回到默认态

`homePage` 的 `view` 在挂载时初始化为 `'home'` ⇒ **reload 之后不存在 `back-home` 按钮**
（它只在 garage 视图）。在本页 E2E 里「reload 之后再点返回首页」必然 30s 超时。
正确顺序：**先点返回首页（不刷新）→ 读链接 → 最后才 reload 验证持久化**。

## §5 两个终态的唯一出口（PRODUCT-LOOP-R1-D 固化契约）

### §5a 契约本身

Run 有两个互斥终态，**各有唯一出口**；出口地址**全部由产品侧**通过 URL 给全，**Lab 侧不硬编码任何产品 URL**
（`RP-25b` 机器钉死；唯一可导航文件 = `runMain.ts`，**两次**数据驱动整页导航，字符级钉死
`location.assign(claim.href);` 与 `location.assign(action.href);`）。

| 终态 | 出口参数 | 地址 | 回首页发生什么 |
|---|---|---|---|
| `COMPLETE` | `back` | `buildClaimHref()`（含 `run` + `reward`） | 幂等入库（**发奖**） |
| `FAILED` | `home` | `HOME_HREF` = `./home.html`（**纯首页**） | **什么都不做**（`parsePendingClaim` 恒 `null`） |

`buildAdventureHref()` **无条件**同时给两个出口（不按处境挑）⇒ 「失败也发奖」在**地址层**即不可能。

### §5b ⚠️ 失败**必须**真正终止（最容易踩的坑）

**别改状态机**：`runStartsNewRun(s) = phase==='FAILED' || 'COMPLETE'`，而 `pressRunAction()` 首位
就是 `if (runStartsNewRun(s)) return createRunPageState(ctx);` ⇒
**状态机层 FAILED 的终态动作 = 开一个全新 Run**（DAY 1 / 满耐久 / Buff 清空）。
这是 **PRP-RUN-R1 冻结规则**（`RP-R1-02`/`RP-R1-03` 显式断言），**不许动**。

⇒ 正确做法是**页面级路由改道**：在 `runPage.ts` 的 `onPointerDown` 里，失败结算分支必须
**早于**通用推进分支，并且**直接 `return`**（不接受任何推进）。

⚠️ **顺序最易在维护中写反**（写反 = 状态机的「开新局」把失败分支吃掉）⇒
由 `RP-D-06` 机器钉死：`failIdx < guardIdx < pressIdx`（`indexOf` 比较），
且 `page.slice(failIdx, guardIdx).includes('return;')` 必须为 true。文案 / 可用 / 绘制**四处同源**。

### §5c 深度链必须一起改（否则「失败结算不出来」）

`runFailSettlement.ts`（纯逻辑）→ `runPageLayout.ts`（面板几何，**复用** `runRewardCardRect()` 槽位）→
`runPage.ts`（绘制 + 命中 + 探针 + `failSettlementNow()`）→ `runMain.ts`（解析 `home` + **唯一导航**）。
`runFailSettlement.ts` 必须同时进 `tests/portraitRunPage.test.ts` 的 `RUN_PAGE_FILES`
（否则它自动脱离 `RP-24` / `RP-25` 全部禁令）。

### §5d ⚠️ 无参数入口下失败 CTA **没有出口**

失败结算**照常呈现，但不画按钮**（`failSettlement.href === ''` ⇒ `actionEnabled === false`，
`drawActionButton()` 直接短路）。这是「Lab 不硬编码产品 URL」的**必然结构性后果**，不是 bug。

- **正式产品入口（首页）恒带 `home`** ⇒ 玩家永不会遇到无出口：由 `PR-07`（`home === HOME_HREF`）+
  `e2e:product-home` 的 `A2`/`A4b`（地址两两不同、`home` 不含 `run`/`reward`）机器钉死。
- 受影响的是**研发 / 验证入口**（`dev:run-page`、Validation Hub 的 `Full Run`）⇒ 用浏览器后退。
- ⚠️ 写 E2E 时**不要**零参数打开 `run-page.html` 再断言失败 CTA 可点 ——
  必须按**产品真实上下文**打开（`run`/`reward`/`back`/`home` 四个参数，`home` **从真实链接里取**）。
  这样还更强：「领奖地址就摆在同一个页面上，失败依然拿不到它」。

### §5e 像素 A/B 判据要选**专属**图形，不要选共用底色

失败结算面板与 COMPLETE 奖励卡**复用同一块矩形**且都用 `cardBg` 打底 ⇒
「这块矩形有没有卡片底色」**无法**区分两个终态（R1-D 中使 `e2e:product-reward` 的 `H4` 假红）。
必须数**奖励卡专属**图形：图标框底 `pageBg`（`runPage.ts` 注释：卡片内唯一出现处）与图标本体 `wheelRim` ——
COMPLETE 成片（实测 4287 / 800），FAILED 必须为 **0**。
（全部取自**非入账**色 ⇒ 像素账本一个数字都不变。）

### §5f 守卫编号别撞号

`portraitRunPage.test.ts` 里 `RP-` 编号是**跨段落共享**的命名空间：R1-D 新增的 `RP-29`/`RP-30`
与 PRP-R3 段**既有同名守卫**撞号（同文件两个 `RP-29`）。
新增守卫请用**段落前缀**（如 `RP-D-06`/`RP-D-07`），并在改后跑
`grep -o "it('RP-[A-Za-z0-9-]*" tests/portraitRunPage.test.ts | sort | uniq -d` 验空。

### §5g 门控期发现的缺陷**不许混并 scope**

R1-D 门控时发现 `e2e:next-run` 已在 **7 个提交前**失效
（`tests/_e2e_next_run.cjs:619` 等 Hub 入口**恰好 3**个，而 `validationHub.ts` 现有 **4** 个 ——
第 4 个 `contentBatch` 由 `bab5f63` 加入）。
**判定方法（可复用）**：
1. `git log --oneline -N -- <测试文件>` 与 `-- <被测源文件>` 对比**最后修改点**；
2. `git merge-base --is-ancestor <可疑提交> HEAD` 确认它是否在链上；
3. 若「测试最后修改」**早于**「新增被断言内容的提交」⇒ 陈旧断言，与当前 Queue 无关。

**处置**：只记录 + 上报，建议独立 Bug Queue；**不要**顺手修进当前 Queue 的单功能 commit。
**修法建议**：断言值从**真实数据推导**（数 Hub 真实入口），不要写死条数。

---

## §6 通关奖励 = 3选1 + 数量累积（PRODUCT-LOOP-R2-A 固化契约）

### §6a 地址层契约（**取代** R1-B 的单件 `back`）

| 角色 | 参数 | 谁产出 | 说明 |
|---|---|---|---|
| 出发 | `choices`（JSON） | `runReward.buildRewardChoicePayload()` | `{stack, choices:[{defId,star,countBefore,href}]}`，`href = buildClaimHref(token, defId)` |
| 出发 | `equipped` | `encodeRunLoadout(draft)` | 本局装备（R1-C，未改） |
| 出发 | `home` | `HOME_HREF` | 失败回程（**纯首页**，R1-D，未改） |
| 回程 | `run` + `reward` | 玩家在终点点中那一张卡 | `parsePendingClaim()` → 首页**幂等**入库（**R2-A 完全未改**） |

- **幂等键是 `run` token，不是地址**：三条候选 href 共用同一个 token ⇒ 「同一局换一件」也落
  `already-claimed`（`e2e:product-loop` 的 `G3` 机器钉死）。
- **`countBefore` 也必须由产品侧给**：Lab 的 `ALLOWED_RELATIVE_IMPORTS` 是闭集，
  读不到 `core/partInventory` / `core/buildPersistence` ⇒ 库存读数是**产品侧传进来的事实**。
- **Lab 只做选择、不做拼装**：`runMain.ts` 里出现不了任何产品 URL 字面量（`RP-25b` 钉死）。
- ⚠️ `buildClaimHref(token, defId)` 的 `defId` **必传**（R2-A 去掉了默认值）：
  终点是三选一，再给默认值就等于「悄悄替玩家选了一件」⇒ 缺参数应当**编译不过**。

### §6b 库存 = stack 模型，`src/core/**` 一行都不用动

> ⚠️ **R2-B 起本条只在 ★1/★2 两档内成立**（要求 ★3..★5 时存储层必须泛化，见 §7a）。

`PartInventory = { [defId]: { one, two } }` 就是 `(defId, star) → 副本数`（`star 1 → one`，
`star ≥ 2 → two`），`addPart(inv, defId, star, n)` **已按 `(defId, star)` 归并**
⇒ 「同一个 `partId + star` 归并为同一个 stack」这条 Queue 要求**在数据层早已成立**。

R2-A 真正缺的两件事**全部补在产品侧** `src/product/playerGrowth.ts`：
① 新账号成长起点（`FRESH_STACK_SEED`）；② 「Equipped 仍指向有效库存实例」的**只增不减**兜底
（core `ensureInventory()` 的 `hasAnyOwned` 判据在「有库存但缺当前装备那件」时不生效）。

⚠️ 库存 key `strongfruit.ownedParts.v2` 是**旧横屏游戏与竖屏产品共用**的 ⇒
**不要**去改 core 的 `defaultInventory()`（那是旧游戏的新账号基线）。
⚠️ `CURRENT_SAVE_VERSION` **刻意不动**（1）：升级会波及 `resetPlayerSave` 与 `tests/q27SaveVersion.test.ts`；
需要迁移的现存形状只有「**无 `__v` 信封**的 inventory 对象」，读时按 v0 过 envelope ⇒ 天然兼容。

### §6c ⚠️ `openGrowthSession(draft)` 必须只收 `draft`（一参）—— 顺序陷阱

`isFreshProfile()` 读**磁盘**；而 `playerInventory()` → `ensureInventory()` **首次调用就落盘库存**。
⇒ 若调用方「先取库存、再判 fresh、再把库存传进来」，`fresh` 恒 `false`、种子**静默失效**
（现象与「一切正常」一模一样，只有读库存才发现是 `1` 而不是 `4`）。
**顺序必须收进函数内部**（先 `isFreshProfile()`，再 `playerInventory()`）。

### §6d 阈值 / 星级 / 名称的**唯一真源**

| 概念 | 真源 | 禁止 |
|---|---|---|
| 满 stack = 5 | `core/partInventory.ts` 的 `canFuse(...).need`（`playerGrowth.FUSE_STACK` 是产品侧常量） | **Lab 自造一个 5** ⇒ 由 `payload.stack` 传入 |
| 星级 | `playerLoadout.WEAPON_GROWTH_STAR = 1`（= `getCount(inv, id, 1)` 里的 `1`） | `playerLoadout` **不许** import `playerGrowth`（成模块环）⇒ 阈值改用 core `canFuse` |
| 显示名 | `registry.functionals.get(id).name`（`rewardDisplayName`，未知 → `null`） | 页面另写一份字面量 |
| `hasSprite` | `core/content.ts` 的真实值（`cannon/hammer = true`，`spear = false`） | 断言「三件都没有美术」（R2-A 曾因此假红一次） |

### §6e ⚠️ 像素阈值必须**按面积推导**，不要凭印象

R2-A 的 3选1 块：`3 × 362 × 68 = 73848 px²`；实测 `cardBg = 58822`（≈79.6%），
`iconFrame = 4467`，`glyph = 918` ⇒ 阈值取 **55000 / 2000 / 600**。
最初凭印象写 `> 60000` ⇒ 两个 E2E 同时假红（58822 vs 60000，只差 1178 px）。
**做法**：先跑一次把真实读数打进 `detail`，再按面积比例（≈75%）定阈值并**把算术写进注释**。

### §6f ⚠️ 像素取证必须在「点那张卡之前」

点中候选卡 = **整页导航**回首页 ⇒ `document.querySelector('#run-canvas')` 变 `null`，
`getImageData` 抛 `TypeError: Cannot read properties of null`。
⇒ 采样点要放进「驱动到 COMPLETE」与「点卡」之间（R2-A 把采样挪进 `playOneRunAndClaim` 内）。

### §6g ⚠️ 「第二局要真的打完」是一条**内容约束**

主武器槽实测矩阵（`playerLoadout.ts` 的 `DEFAULT_CLEARED_SLOT` 注释）：
`cannon`（远程炮）→ 稳定 COMPLETE；`spear` → 第 2 场僵持**跑不完**；`hammer` → 第 1 场即死。
⇒ 任何「第二局必须走到 COMPLETE」的 E2E **必须在出发前换回 `cannon`**，
否则会在 `BATTLE` 卡到驱动超时（R2-A 实测 240s 超时）。
这是产品事实，**不要**用放宽 E2E / 加预算来绕过。

### §6h 探针字段改名对照（维护时 grep 用）

| 旧（R1-B/C） | 新（R2-A） |
|---|---|
| `rewardCard`（单件） | `rewardChoices`（数组，含逐条 `href` / `previewText` / `stackText`） |
| `rewardCardRect` | `rewardChoiceRects` |
| `rewardClaim` / `exitHref`（= 领奖地址） | `chosenDefId` / `rewardChoicesDropped`；**COMPLETE 的 `exitHref` 恒 `null`**（出口在卡片上，底栏 `actionEnabled === false`） |
| `REWARD_WEAPON_ID` | `REWARD_CHOICE_IDS = ['cannon','spear','hammer']` |
| `back` 参数 | `choices` 载荷 |
| Garage 卡无数量 | `data-ph-star` / `data-ph-count` / `data-ph-stack-text` / `data-ph-stack-threshold` + `ph-card-full` |

---

## §7 合成 = 5 合 1 → 下一星级（PRODUCT-LOOP-R2-B 固化契约）

### §7a ⚠️ 高星**必须**泛化存储层，否则是**静默腐烂**（不是报错）

扩展前 `PartInventory = {defId: {one, two}}` + 映射 `star >= 2 ? two : one`
⇒ **★3 与 ★2 落进同一个桶**：`5 × ★2` 合成出 ★3 会把 ★2 的计数一起抬上去，
而 `getCount(inv, id, 3)` 读回来正是 ★2 的数量 —— 数据已经错了，**没有一处抛错**。
`normalizeInventory()` 只搬运已知字段 ⇒ 产品侧**不可能**绕过 core 另存高星档。

| 概念 | 值 | 含义 |
|---|---|---|
| `INVENTORY_MAX_STAR`（`core/partInventory`） | **5** | **存储 / 读数结构**的档数上限 |
| `MAX_STAR`（`core/partInventory`） | **2** | **旧横屏融合规则**的策略上限（Q22 冻结，**不要动**） |

`STAR_KEYS = ['one','two','three','four','five']` + `starKey()` 是「星级 → 字段名」的**唯一映射**
（越界 / 非数**夹**到 1..5，不抛）；`three/four/five` **可选** ⇒ 旧档零迁移成本。
⚠️ 「★6 读作 0」是**错的期望**：`starKey(6)` 夹回 ★5 ⇒ 要断言「★6 不存在」只能看**桶名**。

### §7b 产品侧合成**不复用** core 的融合规则（两者语义相反）

| | core `fuseSameStar` / `fuseCategoryMaterials` | 产品 `playerGrowth.fuseStack` |
|---|---|---|
| 已装备副本 | **保护**（`available = owned - equipped`） | **允许参与**（Queue 必改 2） |
| 上限 | `MAX_STAR = 2` | `INVENTORY_MAX_STAR = 5` |
| 装备 | 不管 | 该档被合空 ⇒ **自动升星**，失败**整体回滚** |

⇒ 两份规则**故意并存**；`canFuseStack` / `fuseStack` 是产品侧唯一入口。
模块方向：`playerGrowth → playerLoadout` 单向，`playerLoadout` **不**反向 import
（星级上限改取 core 的 `INVENTORY_MAX_STAR`，「两个 5 同值」由 FB-13 钉死）。

### §7c ⚠️ `validateSnapshot` **不含**星级倍率（已探明，**未修**）

`buildValidator.ts:114` 累加 `def.energy`（无倍率）vs `:48` 的 `computeEnergy` 用 `starTierEnergy`。
git 取证：前者自 `9ced1c7`（建文件）未改，后者由 `5133a1c`（Q22）加入 ⇒ **Q22 漏改**。
⇒ 合成升星**不会**被能量校验挡住 ⇒ `fuseStack` 的回滚分支当前只能由 `unknown-slot` 触达
（构造：`wedgeBody` 无 `frontMass` 挂点）。FB-11b 把该事实机器钉死；修它属独立 Bug Queue。

### §7d 页面 / E2E 写法

- ⚠️ **HTML 不允许 `button` 嵌 `button`** ⇒ 合成按钮是卡片的**兄弟节点**（`.ph-card-cell` + 绝对定位）。
- ⚠️ 一个 `defId` 现在**可能有两张卡**（★1 / ★2 各一）⇒ 取卡必须**同时**按 `defId` + `star` 定位；
  `weaponEntries` 按星级升序遍历 ⇒ `querySelector` 默认拿到 ★1 那张。
- ⚠️ E2E 里核对磁盘的星级字段映射要**独立复刻**（不 import 被测模块），否则等于用被告的证词。
- ⚠️ 合成段放进 E2E 时**必须排在所有「跑局」断言之后**：★2 的炮真实占 33 能量（★1 = 30）
  ⇒ 插在中间会改变 Build 数值，让「确定性通关路线」不再确定性。
- ⚠️ `stackText` 契约：未满 = **`4/5`**（不是 `×4`），满 = `5/5`（不写 `6/5`）。

## §8 星级 = 真实战斗伤害（PRODUCT-LOOP-R2-C 固化契约）

### §8a 曲线唯一真源（**取代** Q22 的旧常数）

`src/core/buildSnapshot.starDamageMultiplier(star) = 1 + 0.25 × (star − 1)`
⇒ ★1/★2/★3/★4/★5 = **1.00 / 1.25 / 1.50 / 1.75 / 2.00**。
常量：`STAR_DAMAGE_STEP = 0.25` · `STAR_DAMAGE_MAX_STAR = 5` · `STAR_TIER_ENERGY_MULT = 1.1`。
⚠️ **旧 `STAR_TIER_DAMAGE_MULT = 1.15` 已删除** —— 它是 Q22 两档时代的固定常数
（`star >= 2` 一律 ×1.15），★3 与 ★2 会同伤害 ⇒ 语义崩坏。别再把它加回来。
越界 / 非数一律**夹**进 `1..5`（不抛、不 NaN）。

**两个上限刻意分开、同值但各自声明**：`STAR_DAMAGE_MAX_STAR`（伤害曲线定义域，`core`）
与 `INVENTORY_MAX_STAR`（库存档数，`partInventory`）—— `core` 是最底层纯模块，
**不能反向依赖库存模块**，由测试断言「两个 5 同值」钉死。
`partInventory.MAX_STAR = 2` 是**旧横屏融合规则**的策略上限，**不动**。

### §8b ⚠️ 为什么 R2-C 必须改 `src/core`（R2-A / R2-B 的「不动 core」不适用）

R2-A / R2-B 的「`core` 一行不用动」成立，是因为**那两轮没碰战斗数值**。
一旦要求「星级真的改变战斗」，伤害只有两个落点：改正式 def（违反「def 冻结」）
或在**解析快照时按星级改** ⇒ 后者就是 `buildSnapshot`，即 `core`。
放在产品侧算 = **第二个真源** ⇒ `PR-27` 在源码层禁止产品侧 / 页面 / Lab 自算
（`playerLoadout` 只许 import `starTierDamage` / `weaponMainDamage`）。

### §8c ⚠️ 作用面边界：正式武器里**只有 `saw`** 的伤害不在顶层

`applyStarTier` 的 `isDamageKey = /damage/i.test(k)` **只遍历顶层** `behaviorParams`。
正式 10 件武器实测：**恰好 `saw`** 走嵌套 `behaviorParams.hitPolicy.damage: 8`（contactTick）
⇒ 星级倍率层**看不见它**。本轮**收紧而非放宽**：断言 `notScaled === ['saw']` /
`scaled.length === 9`（SP-03）+ SP-03b 钉死。
产品侧配套：无伤害读数 ⇒ `weaponMainDamage === 0` ⇒ `damageText === ''` ⇒
**卡片不画那一行**（不是画「攻击 0」）。
`saw` 不在 `STARTER_PARTS` / 不在 `REWARD_CHOICE_IDS` ⇒ 当前产品**结构上不可达**；
将来若进奖励池需**单独决策**。

### §8d `weaponMainDamage` 是「一次命中扣多少血」的唯一读取口径

先 `behaviorParams.projectileDamage`（弹丸类 cannon/shotgun/machineGun/laser/flamethrower），
再 `behaviorParams.baseDamage`（车身直击类 hammer/spear/ramHead/rammer），
都没有 ⇒ `0`。与 `src/battle/contactRouter.ts` 的两个伤害分支（`:996` 弹丸 / `:705` 直击）
**一一对应**；SP-04 用「先缩后读 == 先读后缩」把口径同源钉死。
配套 `weaponNumericParams(def)` = 全部顶层数值的只读快照，用于逐项证明「只有伤害变了」。

### §8e 层级顺序 = 永久装备 → 永久星级 → Run-local Buff（三者已就位）

| 层 | 谁负责 | 关键事实 |
|---|---|---|
| 永久星级 | `resolveSnapshot`（`applyStarTier(def, install.star ?? 1)`） | ★1 ⇒ **def 零 clone**（`applyStarTier(def,1) === def`） |
| Run-local overlay | `createRunRegistry` + `applyRunModifiersToSnapshot` | **只重映射 `defId`、保留 `star`** |
| Runtime 真源 | `RunBattleRuntime.playerSnapshot`（= overlay 之后那份） | `star` 从这里读，`?? 1` 夹紧 |

⚠️ `CannonBehavior` 构造时只读 `part.def.behaviorParams` ⇒ 两层对 damage 的叠加是
**乘法交换**的（脚本按「先永久星级、再乘 run 倍率」记账，数值等价；SP-06 机器断言）。
Run 结束只清 Run-local，**永久 star 保留**。

### §8f ⚠️ 星级倍率**不是物理量** ⇒ 「同条件」可被机器证明

它只改 `def.energy`（×1.1）与 `behaviorParams` 顶层 damage 类数值，**不进物理求解**。
⇒ 「同一门炮的**第一发命中时刻**在两场之间逐帧相同」是「只差星级」的客观证据
（实测两场都是 `3099.999999999994ms`）。E2E `E5` / SP-07 钉死。
⚠️ `damage` 事件的 `timestamp` **恒为 0**（`ContactRouter` 传 `0`）⇒
命中时刻必须由运行时自己用 `orchestrator.timeMs` 记（`playerWeaponHitSummary().firstAtMs`）。

### §8g ⚠️ E2E 写法陷阱（R2-C 实测新增 5 条 + 2026-09-20 复核补第 6 条）

1. **战斗运行时在离开 battle 相位时被 `dispose()`** ⇒ 必须**每帧**把 `battleWorld`
   照抄一份存采样；落到终态再读就晚了（拿到的是已释放或首帧态）。
2. **比武器参数要取两局的「第一份采样」**（= 第一场，都还没吃 Run-local overlay）。
   取最后一份会拿到 Run 1 吃到 `twinCannon` / `tripleLoad` 之后的数（`burstRounds: 3`）
   ⇒ 假红。
3. **Garage 卡片只在 garage 视图渲染**（`renderGarage` / `view === 'garage'`）
   ⇒ 读卡前必须先点 `[data-ph-action="open-garage"]`，读完点 `back-home` 回首页。
4. **★1 不写 `functionalStars` 字段**是既有约定 ⇒ 「Profile Equipped Star = 1」的
   可观测形式是**该键缺席**，不要断言 `=== 1`。
5. **第一场战斗的节点是 `d2-battle1`，其 `day` 字段 = `2`**（既有事实）⇒ 用**战斗采样**断
   「新 Run 重置」时，要比「与第一局**同起点**」（逐项比 `day` / `nodeId`），
   **不要**在那里写死 `day === 1`（会假红）；
   且第三帧才有 battle hp ⇒ 用 `samples.find(s => s.hp !== null)`。
   ⚠️ **但「新局起点 = DAY 1」本身是必须断言的**——见第 6 条，别把这条当通则。
6. ⚠️（2026-09-20 修订补入）**「DAY = 1」要用「进入 Run 的瞬间」的探针断，而不是战斗采样**。
   `enterRunAndDrive()` 的 `runStart = await probeRun(page)`（`waitRunReady` 之后、`driveRun` 之前）
   就是那个瞬间 ⇒ 应断言 `runStart.day === 1 && runStart.battlesCompleted === 0 &&
   runStart.build.length === 0 && runStart.modifier === null`。
   Queue 必改 5 STEP 6 逐字要求「必须确认 DAY = 1 / HP = 满 / Run Buff = []」；
   只用「同 day」是**代理判据**（脚本起点若漂到第 3 天，同 day 仍成立）。
   `RUN_FIRST_DAY = RUN_SCRIPT[0].day = 1`（`runScript.ts:168`）；单测 `portraitRunPage` RP-06
   已有 `expect(s.day).toBe(RUN_FIRST_DAY)` + `.toBe(1)`。E2E 那份字面量**刻意独立声明**
   （黑盒验收不引用被测方常量）。R2-C 复核新增 `E1b` 即此条，star-power E2E 20/20 → 21/21。

### §8h ⚠️ 已探明、**未修**（按纪律只记录，属独立 Bug Queue）

- **能量容量会挡人**：★2 炮占 **33** 能量（★1 = 30）。`bananaBody` 容量 90 ⇒
  ★1 三件炮恰好 90（合法），合成后 **93**（超容量）⇒ 玩家**可能装不上**。
- **`validateSnapshot` 不含星级能量倍率**：`buildValidator.ts:114` 累加 `def.energy`（无倍率）
  vs `:48` 的 `computeEnergy` 用 `starTierEnergy` ⇒ **Q22 漏改**（早于 R2-C）。
  修它之前**别**让 `equipWeapon` 依赖该校验，否则 ★2 会被静默拒绝。

### §8i `PR-27` 守卫（新增，改动星级链路前必读）

源码层禁止四处自算星级伤害：`playerLoadout`（只许 import core）、`homePage`
（只许用 `w.damageText`）、`runPage`（只许暴露 `playerWeapons`）、
`contactRouter`（仍读 `behaviorParams?.projectileDamage`，R2-C 没碰）。
新增任何「显示星级价值」的地方，一律接 `weaponEntries` 的字段，**不要自己乘**。

---

## §9 完整 Run 的**装载资格**（PRODUCT-LOOP-P0 固化契约，改动入口 / RunModifier 前必读）

真人 P0 原形：`equipped = 非 cannon` → Run 前几日正常 → DAY3 选/进入 `heavyShell` →
`beginBattle` → `applyRunModifiersToSnapshot()` 找不到 cannon → throw → **Run 卡死**。

### §9a 判据 = **存在性**，不是槽位，而且**两层同源**

`snapshotHasRunBaseWeapon(snapshot)` = `snapshot.functionals.some(i => i.defId === RUN_BASE_WEAPON_DEF_ID)`。

- 局内真正决定注入成败的就是这个存在性判断 ⇒ 创建期资格必须用**同一个函数**
  （`runLoadoutCompat.runLoadoutCompatOfDraft`），杜绝第二套「什么算兼容」的定义；
- **不要**改成「主武器槽是不是 cannon」：那样两层会在
  「主武器槽是别的、但车上另有 cannon」时分叉（一处放行、一处 throw）。
- 两层都走**正式 `buildSnapshotFromDraft`**，不自己拼 snapshot。

### §9b 拒绝必须发生在 **Run 创建之前**（位置要求，不是文案要求）

- 产品层：`src/product/runCompatibility.ts` 是**唯一**判断（`canStartFullRun` /
  `fullRunCompat`）。页面**不许**出现武器 id 字面量或支持清单（`LC-20` 逐武器 id 钉死）；
  刻意**不**断言「不许出现 `category === 'weapon'`」——那是展示用途，两个问题。
- Lab 层：`runMain.ts` 必须在 `new RunPage(` **之前**判定 `playerLoadout.blocked` 并 `return`
  ⇒ 不创建 RunPage ⇒ 无战斗运行时、无 DAY、无 canvas ⇒ **结构上到不了 DAY3**（`LC-21`）。
- `RunLoadoutResolution` 新增 `fallback: 'unsupported-loadout'`（≠ `'invalid'`：后者是
  「数据坏了」，前者是「数据合法但完整 Run 不支持」）+ `blocked` + `blockedReason`。

### §9c ⚠️「**不给 href**」而不是「点了 return」

可执行 = `<a href>`；不可执行 = **没有 href 的 disabled `<button>`**（`data-ph-start-blocked="1"`）。
「点了不会创建 Run」因此在**结构上**成立，而不是靠事件处理里 return（漏一处就变成静默放行）。
⚠️ 同一选择器 `[data-ph-action="start-run"]` 覆盖两种形态 ⇒ 探针与 E2E **不需要第二套口径**
（探针侧把 `HTMLAnchorElement` 放宽成 `HTMLElement`，用 `getAttribute('href')` 取；对 button 恒为 `null`，
**`startRunHref === null` 本身就是**「点击无法创建 Run」的机器证据）。

### §9d ⚠️ 拒绝时**必须**返回演示装载占位，不许返回玩家那份

若返回玩家那份，调用方一旦漏看 `blocked`，就退化成「照常开战、然后在 DAY3 崩」——正是要根除的形态
（`LC-06` 钉死 `loadout.source === 'demo'` 且主武器槽 ≠ 玩家那件）。

### §9e ⚠️ 两个常量必然各写一份，一致性只能靠断言

产品侧 `FULL_RUN_SUPPORTED_WEAPON_IDS` 与 Lab 侧 `RUN_BASE_WEAPON_DEF_ID` **同值但各自声明**：

- 依赖方向单向：`core` / `lab` 不许反向依赖 `src/product/`；
- 产品侧也**不许** import 那个实验原型目录（`R22b`：`src/` 里不得出现该目录名，
  **含注释与 import 路径**——本轮又在 `runCompatibility.ts` 的注释里踩过一次）。
⇒ 一致性由 `LC-01` 机器钉死（与 `STAR_DAMAGE_MAX_STAR` / `INVENTORY_MAX_STAR` 同型）。

### §9f ⚠️ 拒绝态的**视图**必须独立成模块

`RP-25b` 对**宿主**有更严约束：`runMain.ts` 必须恰好两次 `location.assign(`，
且**不得出现 `createElement`**。⇒ 拒绝态 DOM 抽到 `runBlockedView.ts`，并登记进
`tests/portraitRunPage.test.ts` 的 `RUN_PAGE_FILES`（与 R1-D 的 `runFailSettlement.ts` 同处置）。
注意 `runBlockedView.ts` 用 `import type { … }` 可避免被 `portraitRunPage.test.ts` 的
import specifier 正则（`/from\s+['"]([^'"]+)['"]/g`）计入（`type` 插在中间不匹配）。

### §9g ⚠️ 产品契约变更会**作废既有 E2E 的路线** —— 处置纪律

本轮「非 cannon 不得进入完整 Run」直接作废了 `e2e:product-fail`（hammer 第一场阵亡）与
`e2e:product-loop`（第二局用 spear）两条路线。处置方式**固定为**：

> **换合法路线 + 新增守门断言**，**不许删断言**，并在文件头注释里写明为什么换、代价是什么。

- 替代失败路线（已验证）：`cannon` + 耐久事件选「继续改装」（`upgrade`，不回耐久）
  → DAY 7 终局耐久归零（≈41.6s）。耐久选项 id = `repair` / `upgrade`
  （找不到指定 id 会回退第一个选项 ⇒ 失败路线会**静默变成通关路线**，务必让断言先红）。
- 「推杆`@front`」那条 R1-C 实测路线**在车库走不通**：车库只能装备**武器**到 `frontMass`，
  没有任何入口往 `front` 槽装 gadget（路线只能靠存档预热，不采用）。
- ⚠️ **两条排查陷阱**（都会让人误判成产品缺陷）：
  1. 把实现里的函数**抽模块**之后，源码守卫里 `indexOf('function X(')` 会返回 `-1`
     ⇒ 是**测试没跟着实现走**，先查这个再怀疑实现；
  2. 真浏览器 E2E 的崩溃头是 `SMOKE 异常：`（各文件不同），用 `grep 'E2E 运行失败'`
     过滤日志会**整条漏掉**崩溃 ⇒ 统计脚本别只匹配固定串。

### §9h 新守卫编号

`LC-01`…`LC-23`（`tests/productRunBuildLoadoutCompat.test.ts`，15 用例）。
⚠️ 编号别撞号：`LC-*` 是 R1-C 的（`productLoopEndToEndPlayerLoop.test.ts` 用 `EL-*`）；
取新前缀前先 grep 全量测试文件。

### §9i ⚠️ 已探明、**未修**（只记录，属独立清理）

`runPage.ts` 的 `playerFunctionals` 注释与 `runBattleRuntime.ts` 的 `playerFunctionals()`
注释都写「带 Run-local 武器侧强化时给的是本局 overlay 部件 id」——**实测不是**：
overlay 由 `composeRunWeaponDef()` 用 `{...正式cannon}` 浅拷贝派生 ⇒ `part.def.id`
**仍是 `'cannon'`**（只有本局 registry 的**键**是 overlay id）。
正确口径 = `runtime.playerSnapshot.functionals[].defId`（或浏览器侧比
`battleWorld.playerWeapons[].params/behavior` —— overlay 真的改了 behaviorParams）。

---

## §10 旧 profile 迁移（PRODUCT-LOOP-P0-LEGACY 固化契约，改动 starter / 读入口前必读）

### §10a 症状与真实成因

| 项 | 值 |
|---|---|
| 症状 | 旧存档打完整 Run ⇒ **第一场（DAY2）稳定失败**，进不了第一次局内强化 ⇒ 主循环结构上不可达 |
| 成因 | 旧 starter 在车身**前置挂点** `front` 装了**推杆**（`pushRod`） |
| 机制 | `pushRodBehavior` 每周期以反作用力把**自家车**向后推（R1-C 实测 **≈241px/周期**）⇒ 车被持续推离射程 |
| 为什么会失败而不是「勉强能打」 | 同车 `front`(x=78) 占位覆盖 x∈[78,158]，而 `frontMass`(x=45) 上任何主武器的 collider 都伸到 x≈85 ⇒ **两槽几何重叠 7px** |

### §10b ⚠️ 这不是存档 schema 问题（**别去动 core**）

```
localStorage['strongfruit.playerBuild.v1']
 → readJsonWithVersion()        core/saveVersion.ts:51
 → migrateLegacy('build', …)    core/saveVersion.ts:74
     ⚠️ 对 build 是 **no-op**（:98-102 只注释「形状不变，仅补 __v」）
     CURRENT_SAVE_VERSION = 1 ⇒ **今天没有任何 build 迁移步骤**
 → isBuildDraftShape() / drive 归一 / validateSnapshot   core/buildPersistence.ts:63 / :44 / :47
```

**⇒ `front = pushRod` 是内容语义，core 里没有任何一层会碰它。** 迁移只能在产品侧做
（本 Queue **core 零改动**已取证）。旧 starter 真源 = `makeStarterDraft()`
（`src/lab/buildEditorModel.ts:182-203`，Q26，**Lab 侧至今未改**）。

### §10c ⚠️⚠️ 「见到推杆就删」是**错的**（本契约最重要的一条）

Queue 给的前提「如果历史正式产品从未开放 front 槽给玩家编辑」**不成立**：

1. `editableSlots(body)`（`lab/buildEditorModel.ts:91-93`）返回**全部** functional hardpoint（含 `front`）。
2. **面向正常玩家的车库**就用它 —— `ui/webDomPlayerUIHost.ts:429`；`src/main.ts:4` 明写
   「正常玩家 UI 已抽到唯一 PlayerUIHost 边界（WebDomPlayerUIHost / CanvasPlayerUIHost）」⇒ **不是 debug 面板**。
   `canvasPlayerUIHost` 同构；旧横屏装配页同（`main.ts:678`）。
3. `playerGameRuntime.applyBuildEdit` 对**任意** `slotKey`（含 `front`）写
   `functionalSelections[slotKey]` + `functionalStars[slotKey]`（`:299-305`），并经
   `savePlayerBuild(this.draftA)`（`:651`）落到**与当前产品同一个 key**。
4. `pushRod ∈ OFFICIAL_PARTS`（`core/partOptions.ts:24`）且 `∈ STARTER_PARTS`（`partInventory.ts:36`）
   ⇒ `canEquipPart('pushRod', 1)` **恒真** ⇒ 玩家能主动装上/卸下。
5. 入口身份：`build/branchDevEntry.ts:6,30` —— `index.html` =「**旧横屏正式游戏**」，且 **R1-C 之前根路径 `/` 指向它**
   ⇒ 真人 profile 极可能出自该时代。

**⇒ 纪律：分辨不出「旧默认」与「玩家主动装备」时，按 Queue 明写规则停下上报，不允许粗暴批量删。**

### §10d 判别式（用户裁决「收紧」后的固化版本）

**两个条件同时成立**才迁移：

| # | 条件 | 为什么可靠 |
|---|---|---|
| ① | `sel['front']` **且** `sel[WEAPON_SLOT]` == `makeStarterDraft(body, registry).functionalSelections` 的同名字段 | 签名**直接取自真源函数**，不在产品侧抄常量表 ⇒ **不产生第二份真源** |
| ② | `draft.functionalStars?.['front'] === undefined` | **所有**玩家侧槽位写入路径都**同时**盖星级印记（`main.ts:757-758` · `playerGameRuntime.ts:303-304` · `canvasPlayerUIHost.ts:1291-1292`），而 `makeStarterDraft` **完全不写** `functionalStars` |

任一不成立 ⇒ **原样返回、一个字节不改**（宁可不迁移）。
**⚠️ 已知缺口（已上报）**：Q22（引入星级）**之前**的存档无法被条件 ② 区分。

迁移形状：`front = EMPTY_SLOT`，`frontMass` **不动**；inventory / 星级 / 数量 / 已装备武器 / 领奖 / 进度
**一字不动**（它们是**独立 localStorage key**，本模块根本不碰）。**禁止 reset 整个 Profile。**

### §10e 落点与「一次为限」

- `migrateLegacyStarterProfile(draft)`（`playerLoadout.ts:350`）—— **纯判定 + 纯变换，不落盘、不改入参**，
  返回 `LegacyProfileMigration { migrated, reason: 'legacy-starter'|'not-legacy-shape'|'player-chosen'|'invalid'|'no-profile', draft, selections }`。
  写入前必须过正式 `validateSnapshot`（与 `equipWeapon` **同一纪律**）：不合法 ⇒ `'invalid'` ⇒ 不动它。
- `loadEquippedDraft()`（`:383`）—— **唯一挂载点**。有存档 ⇒ 迁移 + 命中时**落盘一次**；
  **无存档 ⇒ 仍 `return defaultPlayerDraft()` 且不写盘**（保住 `core/onboarding.ts` 的 `loadPlayerBuild() === null` 语义）。
- **为什么落盘**：Home 与 Run 读的都是**已存储**那份 ⇒ 只做读时投影 = 旧存档永远停在旧形态。
- **为什么不需要「已迁移」标记位**：迁移后 `front` 已是空槽 ⇒ 条件 ① 不再成立 ⇒ **结构上一次为限**。

### §10f ⚠️ 落盘点纪律（`PL-03`）：**强化实现，不放宽守卫**

本 Queue 让本模块出现了**第二个语义写入时机**（加载期归一化），而
`tests/productLoopHomeGarage.test.ts` 的 `PL-03` 原样断言「本文件 `savePlayerBuild(` 只准出现 **1** 次」。
**处置 = 新增私有 `persistPlayerBuild(draft)`（`:280`）把两条语义收进一处**，守卫**一字未改、原样通过**；
`PL-02` 三个禁词（`localStorage` / `platform` / `STORAGE_KEY`）全 false。

### §10g ⚠️ 实测陷阱（本轮新发现，**会毁掉你的夹具**）

**`drive` / 轮径 / 轮组真的会改变战斗结果。**
第一版 E2E 把 `drive:'stationary'` + 非默认轮径塞进**战斗夹具** ⇒ 直接 `phase=FAILED pool=null battles=1/4`。
⇒ **拆夹具**：① **战斗夹具**（用默认/合法驱动，只证可达性）② **保留性夹具**（放各种玩家自有字段，**不跑战斗**）。

**产品含义（需上报）**：迁移**不碰**这些字段（必改 1 明令保留）⇒ **`drive` 被自改成 `stationary` 的旧存档，
即便迁移清空了 `front`，第一场仍可能失败**。Reachability Gate 管的是「**标准 Cannon 产品基线**」，
不是「任意用户自改配置」。

### §10h E2E 书写坑（`tests/_e2e_product_legacy_profile.cjs` 实测）

- 探针 `ProductProbe` 只有 `slots[]`（**无** `occupied`）⇒ 判空槽要
  `slots.find(s => s.hardpointId === FRONT_SLOT).defId === 'none'`。
- 「第一次局内强化」的**数据层判据** = `choiceOpen && choicePoolKind === 'layer1'`
  （**不要**按「第几选」数数）。
- 断言「迁移不丢玩家数据」用**键序无关规范化比较**（`canon(stripStamp(x))`），别手搓期望对象。
- 断言「迁移落盘」用**正式读路径** `loadPlayerBuild()`，不要自己在测试里 `JSON.parse` localStorage。
- 「不重复修改」要断言 **write 计数不增**（`LM-14`）或 reload 后形态不变（`L7`），二者都写更硬。

### §10i 守门清单

| 守卫 / 用例 | 钉什么 |
|---|---|
| `PL-03` | 本模块 `savePlayerBuild(` **恰好 1 次**（落盘点唯一） |
| `PL-02` | 本模块不含 `localStorage` / `platform` / `STORAGE_KEY` |
| `LM-20` | 迁移不引入 `removeItem` / `resetPlayerSave`，且**确实**用 `makeStarterDraft(` |
| `LM-21` | 明文冻结的 `LEGACY_FIXTURE` 仍与 `makeStarterDraft` 一致（**旧 starter 漂移报警**） |
| `LM-30` | Reachability：第一场 `resolved` + `phase === 'CHOICE'` + `runChoicePoolKind === 'layer1'` |
| `LM-41` | Spear/Hammer 仍被完整 Run 入口守门（`unsupported-loadout` / `startRunHref === null`） |
| `LM-42` | `applyRunModifiersToSnapshot` 的 `throw` **未被动过** |
| `e2e:product-legacy` | 真实浏览器 + 真实 localStorage + 真实鼠标，17 条 |

