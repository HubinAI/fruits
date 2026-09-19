# Fruits - Runtime Memory Index

**只放「不变量 + 陷阱 + 下一步」。** 公式 / 实测数字 / 逐帧时间线 / 普查过程不在这里。

| 要找什么 | 去哪 |
|---|---|
| 本轮 / 近日做了什么、实测数字 | `.workbuddy/memory/YYYY-MM-DD.md`（最新 `2026-09-19.md`） |
| **PRP 运行时细节**（战斗参数 / 相机 / 接缝 / 三入口 / 各轮 Queue 的 file:line 与口径） | `.workbuddy/memory/REF_PRP_RUNTIME.md` §A–L |
| 每个 Queue 的完整交付说明 | repo-root `交接文档_YYYY-MM-DD_<Queue>.md`（**本地件，不入库**） |
| 更早的完整版 | `.workbuddy/memory/archive/MEMORY_FULL_*.md` |
| 项目级共识与边界（最高权威） | `最强水果_项目核心共识与开发边界_WorkBuddy_Memory.md` |

## 1. Identity / 链尾
- Repo `git@github.com:HubinAI/fruits.git` | dir `D:\0818new\最强水果` | 分支 `prototype-portrait-battle-lab`
  （实验分支，可整块删除）；主线 `foundation-02-wechat`。原型正式名 **PRP｜Portrait Run Prototype**。
- **链尾**：`d334d0c` R1 验证中心 → `3d23091` RUN-02-R1 → `09ee631` RUN-02-R2 耐久取舍做实 →
  **M2-R1 Next Run 终点态唯一出口**；更早查 `git log`。
- 全链对 `src/core|physics|render|player|platform|battle|ui|game|presentation` diff **恒为空**；唯一正式
  gameplay 改动 = `src/battle/cannonBehavior.ts` 可选 `burstRounds`（默认 1，逐帧不变）。

## 2. Rules
- 1 Queue = 1 problem；先调查/复现、锁定根因再改码；无静默扩范围；缺陷拆独立 Queue（禁混并）。
- tech pass ≠ 落进运行时 ≠ 真人体验通过；体验由用户裁决，别让用户抓技术日志。
- 每条回复结尾写「用户需要回什么」；每条 Queue 完成后**停等**，绝不自动续下一条。
- PC 录屏常态化；手机录屏只用于大模块节点。
- 「一眼可辨」验收：先找**相机追不平的物理通道**；不存在就**如实上报失败**，不加提示掩盖。
- 指令语义与禁止清单冲突时，按**硬约束**落地并**显式上报解释与代价**（别沉默选一个）。
- 优先「**数据/节点声明**」而非「按计数/位置推断」——后者一加节点就失效（RUN-02-R2 的根因）。

## 3. Git / build / 环境
- `git stash` **禁止**；git 异常先跑 `scripts/repo-health.js`（无 CLI 用 `node --input-type=module -e
  "import {checkRepoHealth} from './scripts/repo-health.js'"`）。
- 禁 `reset --hard` / `checkout --` / 删 `.git` / 手改 refs / force-push 已交付。
- 单功能 commit + push + **四路核对**（HEAD = 本地 ref = `git ls-remote` = `.git/FETCH_HEAD`）；
  ⚠️ 核对前必须先 `git fetch origin <branch>`（本机 remote-tracking refs 落不了地）。
- ⚠️ `git commit -F` 必须用 **Windows 路径**；**不要** `git commit -m @'…'@`。
- Memory 并入功能 commit（纯 memory 补正例外）；⚠️ memory 里别引用补正 commit **自身**的 SHA。
- ⚠️ `git status` 中文文件名是八进制转义 ⇒ 排除 `交接文档_*.md` 用**显式路径** `git add`，别 grep 中文。
- vitest：`--pool=vmForks --maxWorkers=1`；过滤器用**子串**；⚠️ **必须独占机器**（与 E2E/构建并发 ⇒ 无关文件报
  `Test timed out in 5000ms`，先单独重跑复现）；重型用例**必须显式 timeout**；改路线结构后必须重测冻结表。
- 本机 bash PATH 常缺 `/usr/bin` → 命令前 `export PATH="/usr/bin:/bin:$PATH"`。
- 截图 / 日志落 `outputs/`（gitignored）。
- ⚠️ **id 改名 = 全通道同步**：`src` + `tests/*.ts` + `tests/*.cjs`（E2E 侧有镜像字面量表）。
- ⚠️ **每加一个根目录 html = 四处同步**：R2-03 不重写清单 / R2-10 完整清单（字典序）· `vite.portrait-lab.config.ts`
  的 `input` · `constants.ts` 头部删除清单 · 新页面自己的守卫测试。
- ⚠️ **跨轮复验 PRP 前必须先 `npm run build:portrait-lab`**：E2E 读 `dist-portrait-lab/`，其 `emptyOutDir:false`
  会留**陈旧 chunk** ⇒ 直接跑 E2E = 假 FAIL。定位：`grep -rl "<新字段>" dist-portrait-lab/` 空 + 旧字段命中。
- ⚠️ **E2E 新段落的 page 归属**：`runViewport` 的 `page` 会被 14 段（开火节奏）继续消费 ⇒ 中途推进它会让后续段
  用**过期 rect** 点击 → 90s 超时假红。重活一律 `browser.newContext()` 另开 page（13/12b 段同构）+ `close()`。
- ⚠️ E2E「回到某页」判据**不要写 `location.pathname`** ⇒ 写语义（探针 + DOM），入口 URL 单独断言。

## 4. Stable contracts（改动前必读）
- DPR 只乘一次（logical→backing）；safe-area / capsule / hitArea 一律逻辑坐标。
- Player 舞台 844×390；Lab/PRP 舞台 **390×844**（四带：顶 80 / 舞台 302 / 日志 378 / 动作 84）。
- E2E 句柄只在 `__E2E_INTERNAL_HANDLE__` 下；RC/web 排除；dev 下 `false`（宏语义）→ 不是泄漏。
- hitArea 与绘制矩形**同源**（`computeFusionLayout` / `runPageLayout`）；E2E 命中域 = 逻辑舞台。
- **像素账本口径**：只登记「不承载文字、不被描边覆盖」的纯色平铺矩形；承载文字/描边的面改点位采样；浮层整页
  遮罩用 `ledgerExpect({ masked: N })`（**N = 卡片数**）。⚠️ 卡片强调条在顶部、正文在 `card.y+72` ⇒ 改卡片文案
  **不影响**账面。
- **入口唯一性**：根路径 `/` 由 dev-only 插件 `build/branchDevEntry.ts`（`apply:'serve'`）重写到 `/run-page.html`；
  ⚠️ `vite.config.ts` 两条守卫（R23 禁 `portrait-lab|portraitBattleLab`；RP-27 禁 `run-page|runMain`）⇒ dev 入口
  逻辑只能放该插件。
- **判定正式行为要查测试，别信注释**：正式相机口径唯一定义在 `tests/battleDynamicFramingR21.test.ts`。
- **Lab 源码守卫（必须尊重，不是绕过）**：`R22a-4` = 正式编排器**只允许 `runBattleRuntime.ts` import**，
  `ALLOWED_RELATIVE_IMPORTS` 是闭集且每条都要被真实命中（死配置 FAIL）；`R22a` 的 `labSourceFiles()` **只扫 Lab
  顶层 `.ts`** ⇒ 新增 Lab 文件必须放顶层；`G1-08` = ⚠️ **`ev.source !== 'A'` 会被误判成 arena 分叉**（`ev.team`
  不会）→ 用 `PLAYER_TEAM`。
- ⚠️ **probe / 账本必须报「本帧真正画出来的东西」**：叠在 `state` 之上的临时浮层/禁用态要配 `*Now()` 访问器，
  并让**绘制 / 命中 / 探针 / 账本四处同一入口**。
- ⚠️ **写断言四坑**：`toEqual` 比**键集**（写取值函数）；浮点别 round 后再去重；源码守卫匹配前**剥注释**（含 HTML
  `<!-- -->`）；「不写战斗数值」类守卫用**正则**（`includes('damage:')` 会被 `damage: cr.damage` 误伤）。
- ⚠️ 改实现导致源码守卫失败时**强化守卫，不放宽**（例：`runOverlayCards` 收紧为「唯一调用点 + 三处同源」；
  R2 把「`next` 目标互不重复」收紧为**入度分析**）。
- ⚠️ **「有按钮 ⇒ 必有 action」**：断言「禁用 / 终点态」时**必须同时断言存在一个真实出口**。M2-R1 的 P0 就是
  三条 E2E（`N20`/`N22`/`N23`）**把缺陷当成预期行为**钉死 ⇒ 47/47 全绿，而真人一点完全无响应。
  ⚠️ 配套事实：`runActionEnabled()` 对 `RESULT` 是 `true` ⇒ 终点态**必须继续拦截**正式流程动作（否则推进下一场），
  但拦截时要放行**自己的出口**；根因常是「按钮文案是**状态描述**而不是动作」。
- ⚠️ **导航放哪由结构守卫决定**：`runPage.ts` 与**正式玩家页面**共用 ⇒ `RP-25` 禁写 `location`/`history`/
  `window.open`/`createElement('button')` ⇒ 整页导航只能由**宿主**（`nextRunMain.ts` 的 `onExit`）执行；
  `RunPage` 只发「出口请求」+ 文案，**不认识目标路径**。
- ⚠️ **Hub 与入口是单向关系**：`I4` 要求 `validation-hub.html` 只引用**自己的 chunk + `modulepreload-polyfill-*`**
  ⇒ 入口 `import './validationHub'` 会把 Hub 拉成**跨入口共享 chunk**（从叶子页面变成被依赖模块，守卫直接抓到）。
  入口页要「返回验证中心」，地址写**自己**的数据源（`nextRunValidation.ts`），两端用交叉核对（`NR-19`）钉死。
- ⚠️ **probe 字段名 ≠ 展示名**（`playerBodyName` 是中文车身名，正式 id 在 `loadoutId`）⇒ 先读接口再写断言。
- ⚠️ **开火节奏只能按 `weaponFire` 事件量**（按弹丸数增量会漏计：命中与下一发常同步 → 净变化 0）。
- ⚠️ 「整页压暗」判据不要用高绝对阈值（底色极暗）⇒ ~15 + **同点位前后对比**。
- ⚠️ 强化图标判据用**盒内面积统计**（`choiceOptions[].iconRect` 与绘制同源）；中心单点采样必然假红。
- ⚠️ 分带线画在下一条带**首行** `band.y`（`band.y − 1` 会吃掉 `road` 最底一行）。
- **启动指令两行连给**：`cd D:\0818new\最强水果` → `npm run dev`（或 `dev:next-run` / `dev:encounter-lab` /
  `dev:validation`）。

## 5. Current truth（不变量；公式与实测见 `REF_PRP_RUNTIME.md`）
### 5.1 战斗参数 / 对手
- world **1600×900** / groundY **700** / 中心距 800；Cannon `cd 1000 · muzzle 8 · dmg 80 · R 10 · mass 1 ·
  recoil 30`；**PRP 构造传空 config `{}`**；玩家耐久上限 **1100**。详见 REF §A。
- ⚠️ probe 坐标系**不对称**（`'battle'` 是带内相对）；菠萝无 PNG → 判据用**三色互斥**（tol 16）；选型普查必须走
  **生产同构链路**。

### 5.2 相机（PRP-R5）—— 可感知性的第一约束
- ⚠️ **头号陷阱**：相机跟**双方中点** ⇒ 玩家与敌车位移互相抵消 ⇒ **屏幕位移 ≈ 0，哪怕世界位移很大**；任何
  「看起来在移动」的设计**先算相机追平后的净量**；⚠️ 视图层绝不写 `renderer.transform`。
- ⚠️ 结束态不再 reframe；`Warning` 阶段相机按设计冻结 ⇒ 断言**分阶段**写。

### 5.3 接缝 / 能力（F2 → BUILD-01）
- 接缝 = **Run-local overlay registry**；正式 `content.ts` / registry / `ContactRouter` / `Orchestrator` 零修改。
- ⚠️ **第一层冻结值（真人已通过，不得再调）**：重型弹头 `radius16/mass4/recoil90` · 双联炮 `burst 2×100ms` ·
  快速装填 `650ms` · 动能爆发 `KINETIC_BURST_GAIN=28` + 真实命中点施力 · 三连装填 `burst 3×100ms`。
- ⚠️ 冲量在**步边界**施加（`flush()` 在 `orchestrator.step` 之前）；计数点必须在**真实施加处**。
- ⚠️ 胜负余量极窄 + 强混沌：「方向可见」验证可用，**数值微调对比不可用**（证伪结论见 REF §C/§E）。

### 5.4 RUN-R1 关键行为
- 死亡 → 直接 `FAILED`（**不经过 RESULT**）；`FAILED` 下唯一动作 = `createRunPageState()`。
- ⚠️ **`runCarriedPlayerHp` 可读窗口**：`!s.battle.done` → `null` ⇒ 进 BATTLE 后读它恒 `null`；宿主必须在
  **EVENT 那一刻**读；进 BATTLE 后权威来源 = `s.battle.playerHp`。

### 5.5 BUILD-01 收口（已冻结，别重开）
- **冻结**：两层条件池 · Run-local 两层 Modifier（**顺序浅合并、支持 N 项**）· `重弹→动能爆发` ·
  `双联→三连装填` · `快速装填 650ms` ⇒ 「过去的选择改变未来选择的价值」由 **2 条真实路线**支持，不做 3/3。
- **整条删除**（假设已否决，将来当**新假设**）：`快速装填` 专属控距二层（`recoilCharge`/`strongRecoil`/
  `suppressionShot`）。⚠️ 服务动能爆发的**共享接缝**（`weaponFire` 方向记录 / `damage` 入口 / `RunAbilityPorts`
  / `flush()`）**全部保留**。

### 5.6 RUN-02 整局竖切（R1 修正 + R2 横向改装）
- **唯一 RunScript 数据源** = `runScript.ts`（纯数据 + 纯查询）。**十节点**：
  `d1-start(1) → d2-battle1(2) → d2-choice1(2) → d3-battle2(3) → d4-durability(4)`
  →（repair）`d5-tend(5)`；（upgrade）`d4-lateral(4)` →（汇合）`d5-choice2(5)` → `d6-battle3(6) → d7-final(7)`。
- ⚠️ **候选池由 CHOICE 节点声明，不是按 `buffs.length` 数数**（R2 根因）：`RunScriptNode.choicePool` =
  `'layer1' | 'lateral' | 'layer2'`；`runChoicePoolKind()` 读节点，`runChoicePoolLayer()` 只 `layer2 → 2`；状态机
  **零分支特判**（禁 `if (day === X)`）。**进度锚点是 `nodeId`，不是「第几场/第几选」**。
- ⚠️ **`d4-lateral` 与 `d4-durability` 同为 DAY 4** ⇒ 进它不追加 `DAY 4` 行（DAY 未变）；`d5-tend`/`d5-choice2`
  是 DAY 5。战斗节点**两段式**（IDLE → EVENT → BATTLE）⇒ 驱动不能写死点击次数。
- ⚠️ **`d4-durability` 与 `d5-choice2` 是两个独立节点**：两条分支都经 `branch[choice]` + `next` 汇入
  `d5-choice2`（**唯一汇合点，恰好两个前驱**）。
- ⚠️ **横向改装（R2）只复用现有第一层**：`runLateralPoolDefs(owned)` = 另**外两个**未拥有一层（二选一，**不含
  `emergencyRepair`**）。⚠️ **全池统一去重**的运行期后果：改装分支先横拿某项后，第二层条件池若含该项会**自动
  消失**（双联路线横拿重型弹头 ⇒ 第二层池 3→2）—— 已接受，须显式上报。
- ⚠️ **`runMainRouteId(s)`** = 最早拿到的一层强化 ⇒ 决定第二层条件池（与中途多拿多少横向项无关）。
- ⚠️ **`RUN_MAX_CHOICES` = CHOICE 节点数 = 3**（维修分支只拿 2 项，改装 3 项 = 「构筑数量优势」口径）；
  `RUN_BUFF_ICON_MAX = 5` ⇒ 3 图标安全。
- ⚠️ 四场对手全部来自**节点的 `encounterId`**（掉血阶梯单调递增，零数值改动）。
- ⚠️ **`projectileCount()` 是全场口径** ⇒ 反推开火节奏必须用 `battleWorld.playerProjectiles`（只数玩家）。
- ⚠️ **改路线结构 ⇒ 真实物理冻结表必须重测**（口径 = 「**显式实测更新，不是就地重算**」，用临时探针跑真实物理
  打印逐场终局、跑完删除）；`维修` 量按缺口截断 `min(275, 上限 − 当前)`。

### 5.7 三个独立验证入口（细节见 REF §G–I）
- **M2 `next-run.html`**：`RunPageOptions` **全可选** ⇒ `new RunPage(root)` 逐字节不变；种子 = 既有第一层换语境；
  上一局走真实状态机**确定性快进**。⚠️ `runPageState/runScript/runBattleRuntime` **不得含 seed 概念**（NR-15）。
  ⚠️ **R2 连带**：脚手架 `PRIOR_RUN_DURABILITY` 由 `'upgrade'` 改 `'repair'`（走横向节点会多拿一项 ⇒
  `priorRunSummary` 变 ⇒ M2 断言破裂）⇒ 摘要零变化、M2 单测零改动；**代价** = carry 含 275 补偿。
- ⚠️ **M2-R1（终点态出口）**：第一场结束后唯一动作 = `返回验证中心`（`NEXT_RUN_EXIT_HREF`，
  宿主 `nextRunMain.ts` 整页导航）。出口规格 = `nextRunFinalAction(validationComplete, exitHref)` →
  `{label,href}|null`，`RunPage` 的**文案 / 可用性 / 命中 / 绘制四处同读**；缺 `exitHref` 或 `onExit`
  ⇒ **一个按钮都不画**。⚠️ `requestExit()` = `dispose()` → 清浮层引用 → 交宿主；**不复位** `validationDone`
  （导航若被拦下，页面仍停在安全终点态）。
- **M3 `encounter-lab.html`**（端口 8158）：固定三套（唯一来源 `ENCOUNTER_BATCH_IDS`）。⚠️ **清理语义真相**：
  `dispose()` **只是丢弃引用** ⇒ 被释放实例**仍可 `step`**；cleanup 靠**宿主生命周期**；判据 = **新实例开局读数
  干净**（读数必须**构造时固化**）。
- **R1 `validation-hub.html`**（端口 8159）：唯一数据源 = `validationHub.ts`（**零 import**）。⚠️ 切换 = **整页
  导航**（真实 `<a href>`）⇒ 保真 + 销毁带走全部运行时/监听器；**代价** = 入口页默认无「返回」
  （M2 例外：PRP-M2-R1 起 `next-run` 终点有真实出口；`run-page.html` 是玩家正式页面，**仍不加**）。
  ⚠️ Hub **零画布**；「上次进入」= `sessionStorage` + **`pageshow` 重读**（bfcache）。

## 6. Next action
- **M2-R1 已交付**（Next Run 终点态唯一出口：`返回验证中心` → 整页回 Hub）。**按指令停止，不继续其它内容。**
  真人复验 = 录一段「Next Run → 第一场结束 → 点**一次**『返回验证中心』→ 回 Hub → 继续开 Encounter Batch」。
- ⚠️ **本轮待用户裁决**：① 终点按钮文案 `返回验证中心` 是否够清楚（旧文案是状态描述）；② 「终点态拿不到出口地址
  就**不画按钮**」这条防呆策略是否认可；③ 上一轮遗留三条副作用（第二层池去重 / M2 carry 含 275 补偿 /
  `RUN_MAX_CHOICES` 2→3）。
- **RUN-02-R2 已交付**（DAY 4 取舍做实：维修 = 生存优势 · 继续改装 = 构筑数量优势）。
  真人复验 = 录一段「DAY 4 选继续改装 → 二选一横向改装 → DAY 5 第二层 → DAY 6 两层」。
- **待裁决**：R2 后「继续改装」在装配上是真优势，但**终局耐久常更低甚至 FAILED**（三条路线里两条改装即失败）
  ⇒ 「是否补偿改装分支的生存」属**新设计假设**，须单开 Queue。
- **M3 待裁决**（不做平衡）：三种敌人是否提出不同问题；`RangedTurret`(OPP-03) 对基础 Build **必输** ⇒ 改即新假设。
- **M2 待裁决**：三种子开局难度是否等价；「下一局起点不同」是否真让人想再打一局。⚠️ 禁改已冻结的第一层数值。
- **R2 后新假设**：改装分支装配占优但**终局耐久常更低（三条路线两条 FAILED）** ⇒ 「是否补偿生存」须单开 Queue。
- **未裁决挂起**：`FAILED` 终态观感；「整局打完是否想再开一局」；`WEAPON_CONTACT_THRESHOLD=0.5`
  （`contactRouter.ts:694`）；PRP-R5 遗留（若仍嫌车小，**恢复旧模式，不发明新模式**）；Hub「整页导航 + 后退」够不够用
  （要单页切换 = 新假设）。
- ⚠️ 遗留缺口：PRP 选项图标**盒内笔画**无 node 侧几何测试；**PRP 各轮录屏回执未全部归档**（唯一未闭环项）。
- Low-prio：`_e2e_portrait_battle_lab.cjs` 的 `[iso] I2` 用 `readdirSync().find()`；
  KNOWN-WX-COLD-BOOT-PREVIEW-SCALE-01；mobile drive slot（F-GARAGE-TOUCH-ASSEMBLY-R2）；strip-scroll no clamp。
