# Fruits - Runtime Memory Index

**只放「不变量 + 陷阱 + 下一步」。** 公式 / 实测数字 / 逐帧时间线 / 各轮 Queue 细节**不在这里**。

| 要找什么 | 去哪 |
|---|---|
| 本轮/近日做了什么、实测数字 | `.workbuddy/memory/YYYY-MM-DD.md`（最新 `2026-09-19.md`） |
| **PRP 运行时细节**（战斗参数 / 相机 / 接缝 / 三入口 / 各轮 Queue 的 file:line 与口径） | `.workbuddy/memory/REF_PRP_RUNTIME.md` §A–M |
| 每个 Queue 的完整交付说明 | repo-root `交接文档_YYYY-MM-DD_<Queue>.md`（**本地件，不入库**） |
| 更早的完整版 | `.workbuddy/memory/archive/MEMORY_FULL_*.md` |
| 项目级共识与边界（最高权威） | `最强水果_项目核心共识与开发边界_WorkBuddy_Memory.md` |

## 1. Identity / 链尾
- Repo `git@github.com:HubinAI/fruits.git` | dir `D:\0818new\最强水果` | 分支 `prototype-portrait-battle-lab`
  （实验分支，可整块删除）；主线 `foundation-02-wechat`。正式名 **PRP｜Portrait Run Prototype**。
- **链尾**：`d334d0c` R1 验证中心 → `3d23091` RUN-02-R1 → `09ee631` RUN-02-R2 → `0ff259f` M2-R1 →
  `d1a9d67` PBL-RDC 远程维持作战距离 → `bab5f63` M3-CONTENT-BATCH-01 →
  **`092e376` PBL-M3-LIGHT-SWARM 体验验证入口**；更早查 `git log`。
- 全链对 `src/{core,physics,render,player,platform,ui,game,presentation}` diff **恒为空**。正式 gameplay 改动仅：
  `cannonBehavior.ts` 可选 `burstRounds`（默认 1，逐帧不变）+ `battle/` 内**可选**驱动档（缺省逐帧不变）。

## 2. Rules
- 1 Queue = 1 problem；先调查/复现、锁定根因再改码；无静默扩范围；缺陷拆独立 Queue（禁混并）。
- tech pass ≠ 落进运行时 ≠ 真人体验通过；体验由用户裁决。每条回复结尾写「用户需要回什么」；Queue 完成**停等**。
- 优先「**数据 / 节点 / 声明**」而非「按计数、位置、role 推断」——后者一加节点就失效（RUN-02-R2 根因）。
- 「一眼可辨」验收先找**相机追不平的物理通道**；不存在就**如实上报失败**，不加提示掩盖。
- 指令语义与禁止清单冲突时按**硬约束**落地并**显式上报解释与代价**（别沉默选一个）。
- PC 录屏常态化；手机录屏只用于大模块节点。

## 3. Git / build / 环境
- `git stash` **禁止**；git 异常先 `scripts/repo-health.js`。禁 `reset --hard` / `checkout --` / 删 `.git` / 手改 refs。
- 单功能 commit + push + **四路核对**（HEAD = 本地 ref = `git ls-remote` = `.git/FETCH_HEAD`）；⚠️ 核对前先
  `git fetch origin <branch>`（本机 remote-tracking refs 落不了地）。
- ⚠️ `git commit -F` 必须 **Windows 路径**；**不要** `git commit -m @'…'@`。Memory 并入功能 commit（纯 memory
  补正例外）；⚠️ memory 里别引用补正 commit **自身**的 SHA。
- ⚠️ `git status` 中文名是八进制转义 ⇒ 排除 `交接文档_*.md` 用**显式路径** `git add`，别 grep 中文。
- vitest：`--pool=vmForks --maxWorkers=1`；过滤器用**子串**；⚠️ **必须独占机器**（与 E2E / 构建并发 ⇒ 无关文件报
  `Test timed out in 5000ms`，先单独重跑复现）；重型用例显式 timeout。
- 本机 bash 常缺 `/usr/bin` ⇒ 命令前 `export PATH="/usr/bin:/bin:$PATH"`。截图 / 日志落 `outputs/`（gitignored）。
- ⚠️ **id 改名 = 全通道同步**：`src` + `tests/*.ts` + `tests/*.cjs`（E2E 侧有镜像字面量表）。
- ⚠️ **每加一个根目录 html = 七处同步**（M3-CB 实测补两处）：R2-03 不重写清单 / R2-10 完整清单（字典序）·
  `vite.portrait-lab.config.ts` 的 `input` · `constants.ts` 头部删除清单 · **`package.json` 的 `dev:*` script** ·
  **`validationHub.ts` 入口表（若挂 Hub）** · 新页面自己的守卫测试。
- ⚠️ **加一个 Hub 入口 = 4 处硬断言**：`validationHub.ts`（union + 表）· `tests/portraitValidationHub.test.ts`
  （`H-01` `toHaveLength(N)` + id/label 数组、`H-02` `Set.size`、`H-04` `want` 表、`H-05` `ENTRY_PAGES`、
  **`H-14` 「下一个」循环**）· `tests/_e2e_validation_hub.cjs`（`EXPECT`、`ENTRY_PAGES`、**4 处 `a.vhub-card`
  计数**、**`V20` 顺序断言**、新页 probe 写进 `EXPECT[].probe`）。⚠️ **最容易漏的是「顺序断言」而不是「计数断言」**。
- ⚠️ **「可选 A/B / 换一个玩家」类需求先查它是不是可装配件**：`twinCannon` / `heavyShell` / `fastReload`
  是 **Run 的第一层强化**（`runModifiers.ts:95` 的 `Layer1ModifierId`；效果如 `burstRounds 1→2`），
  **不是部件** ⇒ Lab 的 `LAB_LOADOUTS`（`BuildDraft` 部件级）装不出「双联炮」，`arenaA.ts` 也无 `burst` 通道。
  凡「给 Lab 加一个带强化效果的玩家」= 给 Lab 新增 Modifier 层 = **新能力**（未授权不做，且要如实披露）。
- ⚠️ **体验验证入口别接进 Validation Hub**：Hub = 玩家可用验证面；Arena A = DEBUG 面
  （`constants.ts:13-19`）。混进去 = 让 DEBUG 结果看起来像正式验证 ⇒ 直接放 Lab 工具栏 + 常驻标记条幅。
- ⚠️ **「已经在该组合里」的入口按钮必须先 `reset`**：否则 `setXxx` 同值 no-op + `start` 幂等
  ⇒ 点了完全没反应（M2-R1 的 P0 形态）。先 `reset` 再配置 = 永远有真实动作（可反复重开），
  且 `spawnSerial` 递增可证明是新批次。
- ⚠️ **跨轮复验 PRP 前必须先 `npm run build:portrait-lab`**：E2E 读 `dist-portrait-lab/`，`emptyOutDir:false` 会留
  **陈旧 chunk** ⇒ 直接跑 = 假 FAIL。定位：`grep -rl "<新字段>" dist-portrait-lab/` 空 + 旧字段命中。
- ⚠️ **E2E 新段落别推进 `runViewport` 的 `page`**（后续 14 段会继续消费 ⇒ 过期 rect 点击 ⇒ 90s 超时假红）；
  重活用 `browser.newContext()` 另开 page + `close()`。「回到某页」判据**不要写 `location.pathname`** ⇒ 写语义。

## 4. Stable contracts（改动前必读）
- DPR 只乘一次（logical→backing）；safe-area / capsule / hitArea 一律逻辑坐标。Player 舞台 844×390；
  Lab/PRP 舞台 **390×844**（四带：顶 80 / 舞台 302 / 日志 378 / 动作 84）。
- hitArea 与绘制矩形**同源**（`computeFusionLayout` / `runPageLayout`）。⚠️ **相机跟双方中点** ⇒ 屏幕净位移 ≈ 0
  （头号可感知性陷阱：任何「看起来在动」的设计先算相机追平后的净量）；细节见 REF §B。
- E2E 句柄只在 `__E2E_INTERNAL_HANDLE__` 下；dev 下 `false` 是宏语义，不是泄漏。
- **像素账本口径**：只登记「不承载文字、不被描边覆盖」的纯色平铺矩形；承载文字 / 描边的面改点位采样；浮层整页
  遮罩用 `ledgerExpect({ masked: N })`（N = 卡片数）。
- **入口唯一性**：根路径 `/` 由 dev-only 插件 `build/branchDevEntry.ts`（`apply:'serve'`）重写到 `/run-page.html`；
  ⚠️ `vite.config.ts` 两条守卫（R23 禁 `portrait-lab|portraitBattleLab`；RP-27 禁 `run-page|runMain`）⇒ dev 入口
  逻辑只能放该插件。
- **判定正式行为要查测试，别信注释**（正式相机口径唯一定义在 `tests/battleDynamicFramingR21.test.ts`）。
- **Lab 源码守卫（必须尊重，不是绕过）**：`R22a-4` 正式编排器**只允许 `runBattleRuntime.ts` import**；
  `ALLOWED_RELATIVE_IMPORTS` 是闭集且每条要被**真实命中**（死配置 FAIL）；`labSourceFiles()` **只扫 Lab 顶层
  `.ts`** ⇒ 新增 Lab 文件必须放顶层；`G1-08` = 用 `ev.team`（`ev.source !== 'A'` 会被误判成 arena 分叉）。
  ⚠️ `R22b`：`src/`（Lab 之外）**0 处** `portrait-lab` / `portraitBattleLab` 字样 —— **注释里也不能提**。
- ⚠️ **probe / 账本必须报「本帧真正画出来的东西」**：叠在 `state` 之上的浮层 / 禁用态要配 `*Now()` 访问器，
  并让**绘制 / 命中 / 探针 / 账本四处同一入口**。
- ⚠️ **写断言四坑**：`toEqual` 比**键集**（写取值函数）；浮点别 round 后再去重；源码守卫匹配前**剥注释**（含 HTML
  `<!-- -->`）；「不写战斗数值」类守卫用**正则**（`includes('damage:')` 会被 `damage: cr.damage` 误伤）。
- ⚠️ 改实现导致源码守卫失败时**强化守卫，不放宽**（例：`runOverlayCards` 收紧为「唯一调用点 + 三处同源」；
  R2 把「`next` 目标互不重复」收紧为**入度分析**；RDC 把「第 4 实参必须 `{}`」改为两形态白名单 + 无数字断言）。
- ⚠️ **「有按钮 ⇒ 必有 action」**：断言「禁用 / 终点态」时**必须同时断言存在一个真实出口**。M2-R1 的 P0 就是
  三条 E2E（`N20`/`N22`/`N23`）**把缺陷当成预期行为**钉死 ⇒ 47/47 全绿而真人一点完全无响应。⚠️ 配套：
  `runActionEnabled()` 对 `RESULT` 是 `true` ⇒ 终点态**必须继续拦截**正式流程动作、但放行**自己的出口**；
  根因常是「按钮文案是**状态描述**而不是动作」。
- ⚠️ **导航放哪由结构守卫决定**：`runPage.ts` 与**正式玩家页面**共用 ⇒ `RP-25` 禁写 `location`/`history`/
  `window.open`/`createElement('button')` ⇒ 整页导航只能由**宿主**执行；`RunPage` 只发「出口请求」+ 文案。
- ⚠️ **Hub 与入口是单向关系**：`I4` 要求 `validation-hub.html` 只引用**自己的 chunk + `modulepreload-polyfill-*`**
  ⇒ 入口 `import './validationHub'` 会把 Hub 拉成**跨入口共享 chunk**（守卫直接抓到）。入口页「返回验证中心」
  的地址写**自己**的数据源，两端用交叉核对（`NR-19`）钉死。
- ⚠️ 其余断言坑：probe 字段名 ≠ 展示名（`playerBodyName` 是中文车身名，正式 id 在 `loadoutId`）；开火节奏只能按
  `weaponFire` 事件量（按弹丸数增量会漏计）；「整页压暗」不要用高绝对阈值 ⇒ ~15 + 同点位前后对比；强化图标用
  **盒内面积统计**（`choiceOptions[].iconRect` 与绘制同源）；分带线画在下一条带**首行** `band.y`。
- **启动两行连给**：`cd D:\0818new\最强水果` → `npm run dev`（或 `dev:next-run` / `dev:encounter-lab` /
  `dev:validation`）。

## 5. 各功能面现状 → 细节全在 REF
战斗参数 / 耐久 §A · 相机 §B · 接缝与**第一层冻结值** §C · RUN-R1 §D · BUILD-01（含已废弃假设）§E ·
RUN-02 脚本 / 状态机 §F · §J · §K · M2 种子 §G · M3 遭遇台 §H · Hub §I · M2-R1 终点态出口 §L ·
**PBL-RDC 远程维持距离 §M**。
⚠️ **M3-CONTENT-BATCH-01 不在 REF** ⇒ 看 `交接文档_2026-09-19_PRP-M3-CONTENT-BATCH-01.md`
（Content A BLOCK 的六层证据 / B+C 复用口径 / Hub 第 4 入口）。
⚠️ **PBL-M3-LIGHT-SWARM 也不在 REF** ⇒ 看 `交接文档_2026-09-19_PBL-M3-LIGHT-SWARM-EXPERIENCE-VALIDATION-R1.md`
（一键入口 / 两条如实上报 / `vehicleId` 只读通道 / L 段 E2E）。

## 6. Next action
- ⚠️ **最高优先（等真人一条结论）**：LightSwarm 体验验证**已交付**（Lab 工具栏一键入口 `3 弱敌·体验验证`）。
  真人只看 10~20s 并回答：**「面对 3 个弱敌，战斗问题是否明显从『打赢一辆车』变成『处理数量与拥挤』？」**
  - 成立 ⇒ 下一轮**才**开正式 **1vN Foundation**（N 车正式编排 + N 方胜负 + 相机）；
  - 不成立 ⇒ **LightSwarm 方向停止**，不为它开发 Foundation（`LightSwarm3` 继续零改动）。
  ⚠️ 配套两条待裁决：① Queue 前提「单体明显弱」在 **HP 维度不成立**（`LightSwarm3` 单敌 900 =
  `Chaser` 900；真实差异只有质量 105<120 + 武器 圆锯 vs 锤）—— 甲 接受 / 乙 另开数值 Queue / 丙 看录屏再定；
  ② 可选 A/B（Twin Cannon）**未做**（`twinCannon` 是 Run 的强化而非可装配部件 ⇒ 要做得先开
  「给 Lab 加 Modifier 层」的 Queue）。
- ⚠️ **Content A 的正式宿主缺口没变**（未被本 Queue 触碰）：`planckBattleOrchestrator.ts:217-218` 硬编码两车 +
  `battleContract.ts:96-98` 只有 A/B 胜负 + `runBattleRuntime.ts:355` 只取 `enemies[0]`；唯一 1vN 宿主是
  DEBUG 的 Arena A（`arenaA.ts:814`）。⇒ 「要不要做正式 1vN Foundation」由上面那条体验结论决定。
- ⚠️ **真人已裁决（M3-CB 收尾）**：路边改装件 ✅ **通过并保留**；废弃修理站 ❌ **假选择，不进正式内容池**；
  详情见 `交接文档_2026-09-19_PRP-M3-CONTENT-BATCH-01.md`。
- ⚠️ **本体**：PBL-RDC 把「敌人恒冲锋」修成三段距离档，但**实测暴露几何死结**——敌人会被玩家一路压到**右墙
  1600（终点栏杆）**，可用域宽仅 800px ⇒ 这正是 `PRP-P0-FOUNDATION-BEHAVIOR-EXIT-INTERRUPT-R1` 的对象。
- ⚠️ **待用户裁决**（不得自行决定）：① 第二层池被统一去重砍成 2 项；② M2 脚手架 `PRIOR_RUN_DURABILITY`
  由 `upgrade` 改 `repair`（carry 含 275 补偿）；③ `RUN_MAX_CHOICES` 2→3；④ 终点按钮文案是否够清楚。
- 未裁决挂起：`FAILED` 终态观感；「整局打完是否想再开一局」；`WEAPON_CONTACT_THRESHOLD=0.5`；PRP-R5 遗留
  （若仍嫌车小，**恢复旧模式，不发明新模式**）；Hub「整页导航 + 后退」够不够用（要单页切换 = 新假设）。
- ⚠️ 遗留缺口：PRP 选项图标**盒内笔画**无 node 侧几何测试；**PRP 各轮录屏回执未全部归档**（唯一未闭环项）。
- Low-prio：`_e2e_portrait_battle_lab.cjs` 的 `[iso] I2` 用 `readdirSync().find()`；
  KNOWN-WX-COLD-BOOT-PREVIEW-SCALE-01；mobile drive slot（F-GARAGE-TOUCH-ASSEMBLY-R2）；strip-scroll no clamp。
