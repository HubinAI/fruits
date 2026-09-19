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
