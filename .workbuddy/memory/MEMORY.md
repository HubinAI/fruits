# Fruits - Runtime Memory Index

Detail → `.workbuddy/memory/YYYY-MM-DD.md` / repo-root `交接文档_*.md`
Authority: `最强水果_项目核心共识与开发边界_WorkBuddy_Memory.md`
（本文件只留**不变量 + 陷阱 + 下一步**；公式 / 账本数字 / 逐帧时间线 / 冻结实测值一律看 daily log 与交接文档。）

## 1. Identity
- Repo `git@github.com:HubinAI/fruits.git` | dir `D:\0818new\最强水果`
- 主线 `foundation-02-wechat`（上一交付 R3 `1bb35d7`）；实验分支 `prototype-portrait-battle-lab`（可整块删除）
- 原型正式名 **PRP｜Portrait Run Prototype**（PBL 旧名仅存 Debug Lab）
- **PRP 链尾**（全链见 daily log）：`6fbf275` F1 接入正式侧视 Planck 战斗 → `c44239b` R5 恢复正式 Battle Camera
  → `ca3fb43` F2 首个强化闭环 → `1a3b080` F2-R1 单变量收紧 + Cannon 真实 burst → **F2-R2 快速装填 400→650（本次）**。
- 历史事实：PRP-F1 之前 PRP 战斗区**没有物理**（纯演示脚本）。全链对
  `src/core|physics|render|player|platform` diff **恒为空**；唯一正式 gameplay 改动 = `src/battle/cannonBehavior.ts`
  的可选 burst（F2-R1 显式授权）。R5 的相机复用靠 PRP 侧 viewport adapter，不碰 `src/render`。

## 2. Rules
- 1 Queue = 1 problem；先调查/复现、锁定根因后再改码；无静默扩范围。
- tech pass ≠ 落进运行时 ≠ 真人体验通过；体验由用户裁决，别让用户抓技术日志。
- 命令自带语境；每条回复结尾写「用户需要回什么」。每条 Queue 完成后**停等**，绝不自动续下一条。
- PC 录屏常态化；手机录屏只用于大模块节点。

## 3. Git / build safety
- `git stash` **禁止**；git 异常先跑 `scripts/repo-health.js`（纯 ESM 库，无 CLI 输出 → 用
  `node --input-type=module -e "import {checkRepoHealth} from './scripts/repo-health.js'"` 调）。
- 禁 `reset --hard` / `checkout --` / 删 `.git` / 手改 refs / force-push 已交付。
- 单功能 commit + push + 核对 local=ref=remote。RC 需 clean HEAD，badge/rc-build.json/runtimeInfo/HEAD 四方一致。
- ⚠️ 本机 remote-tracking refs **无法落地**（`git fetch` 报 `[new branch]` 但 `.git/refs/remotes/` 恒空）→
  以 `git ls-remote` + `.git/FETCH_HEAD` 为权威；push 正常；不要为此改 refs。
- Memory 并入功能 commit；**不单独提交 memory**（例外：纯 memory 补正可单独 commit）。
- ⚠️ `git commit -F <文件>` 必须用 **Windows 路径**（`/tmp` 路径 git 读不到）；**不要**用
  `git commit -m @'…'@`（bash 会把 here-string 首行塞进消息）。
- vitest：cwd 盘符必须**大写** `/D/…`（小写 → 模块图双实例 → 持久化测试静默假失败）；
  全量 `--pool=vmForks --maxWorkers=1`；`--reporter=basic` 不支持；过滤器用**子串**（不能传文件绝对路径）。
- 本机 bash PATH 可能缺 `/usr/bin`（`ls/grep/dirname` 全丢）→ 命令前加 `export PATH="/usr/bin:/bin:$PATH"`。
- `交接文档_*.md` 是**本地件**（`git ls-files` 无匹配），勿误提交；截图交付落 `outputs/`（gitignored）。

## 4. Stable contracts
- DPR 只乘一次（logical→backing），禁重复乘；safe-area / capsule / hitArea 一律逻辑坐标。
- Player 舞台 844×390；Lab/PRP 舞台 **390×844**（四带见 §5.2）。
- Viewport resume 只走 `syncWechatViewport`，无第二套 sizing 路径。
- E2E 句柄只在 `__E2E_INTERNAL_HANDLE__` 下；RC/web 排除。dev 下它存在且为 `false`（宏语义）→ 不是泄漏。
- hitArea 与绘制矩形**同源**（`computeFusionLayout` / `runPageLayout`）；E2E 命中域 = 逻辑舞台，非 CSS viewport。
- **像素账本口径**：只登记「不承载文字、不被描边覆盖」的纯色平铺矩形；承载文字/描边的面改点位采样。
  ⚠️ 画面含**缩放位图**时，纯色账本只能登记远离它的平涂面。
- **入口唯一性（PRP-R2 起）**：唯一玩家入口 = 根路径 `/`，由 dev-only 插件 `build/branchDevEntry.ts`
  （`apply:'serve'`）重写到 `/run-page.html`；`portrait-lab.html` = DEBUG ONLY（`dev:debug-lab`）、
  `index.html` = 正式横屏（`dev:legacy`）。
- ⚠️ 改 `vite.config.ts` 两条守卫：R23 禁 `portrait-lab|portraitBattleLab`；RP-27 禁 `run-page|runMain`
  → dev 默认入口逻辑只能放 `build/branchDevEntry.ts`。
- `vite.portrait-lab.config.ts` 用 `emptyOutDir:false`（本机 safe-delete shim 拦 `fs.rmSync`）→
  `dist-portrait-lab/` 会**累积历次旧 chunk**（已 gitignore，不入库）。
- **判定正式行为要查测试，别信注释**：`src/` 无逐帧调 `reframe` 的调用点，正式相机口径唯一定义在
  `tests/battleDynamicFramingR21.test.ts`。
- **给用户的启动指令必须两行连给**（npm 在「当前目录」找 package.json，缺 cd 会报 `Missing script: "dev"`）：
  `cd D:\0818new\最强水果` 然后 `npm run dev`。

## 5. Current truth

### 5.1 已冻结历史（PBL F0–G1 + PRP-R4，细节全在 daily log）
- Lab 结构：入口 `portrait-lab.html` + `src/lab/portraitBattleLab/` + `vite.portrait-lab.config.ts`（outDir `dist-portrait-lab/`）。
- 不变量：正式 src/ 全树 + 正式入口 + 4 个正式构建配置 **0 引用** `portraitBattleLab|portrait-lab`；Lab 只允许
  import 白名单只读模块；数值一律 `buildSnapshotFromDraft → validateSnapshot → resolveSnapshot`，
  正式库缺的部件 → **unavailable，不造数值**。
- 三条仍会咬人的陷阱：①实例 group 必须取 `-(100+i)`（回退由 `contactRouter.resolveVehicle` 三级规则安全跳过）；
  ②⚠️ **禁复用 `PlanckArenaRuntime`**（无条件建 Closing 刺墙 + hazard，无开关）；③G1 的 `PBL_ARENA_RUNTIMES`
  是**可用性唯一来源**，blocked 时 `plan=null` 绝不 Start，且 DOM 面板必须在 canvas 之外（否则污染像素分类）。
- PBL-B1 停止结论（已由 §5.4 的 adapter 路径实质回答）：390 宽舞台横向接敌轴仅 **366px**，1v1 整车总宽
  **410–498** → 竖屏侧视是几何硬约束，不是参数问题。

### 5.2 PRP 产品基线 + 页面冻结量（F0/R1/R2/RP-01b）
- **整个单局 = 一个持续存在的竖屏 Adventure Run Page**；战斗/事件/强化/结果是同一页面的不同状态，
  战斗保持**玩家左·敌人右的侧视**。全 canvas 单页（无 DOM 按钮 → 结构上无法跳转）。
- R1 FAIL 真根因 = **入口给错**；R2 FAIL 真根因 = **启动链**。
- **四带**：顶部 **80** / 舞台 **302** / 日志 **378** / 动作 **84**（合计 844）。
- 顶部无「核心构建 X/5」、无固定空槽；强化行**只画实际已获得的**（`RUN_BUFF_ICON_MAX=5`）；
  结构性证明 `runBuffIconRects(0) === []`。
- **IDLE 待机近景**：`runSideViewScale = min(0.9,(390−2×10−14)/(wP+wE)) = 0.7722…`；`groundInsetPx=52 → groundY=330`。
- **零纯色占位纪律**：可视件必须带正式 `visualId`，资源未就绪**整件不画**；缺 `visual` 的部件整件剔除。
- **日志 = 纯自然语言**：`RunLogKind` 六值 + `formatRunLog(e)=>e.text`（恒等）→ 结构上吐不出方括号前缀。
  累积行数：IDLE 2 → EVENT 4 → BATTLE **零追加** → RESULT 7 → CHOICE 不写 → 选后 **9**（强化结果 + `DAY N`）。
- ⚠️ **sprite 重采样污染等色面积**：禁用态动作条本应入账，但车身缩放重采样有 1 个抗锯齿像素
  `(149,295)` 恰等于 `#2a3341` → 删 `actionBarOff` 层，禁用态改用 probe `actionEnabled===false` + 点位采样。
- ⚠️ 分带线必须画在下一条带**首行** `band.y`；画在 `band.y−1` 会吃掉 `road` 最底一行。
- ⚠️ **E2E 隔离断言空转陷阱**：`dist-portrait-lab/` 累积旧 chunk → 「按前缀挑第一个 chunk」读到**过期产物**
  使断言恒真 → 必须从 `run-page.html` 取**真实引用**；不可断言「目录零残留」。
- ⚠️ 既有抖动（**非 Queue 回归**）：全量 vitest 时 `garageFusionResultInteractionR22.test.ts` 偶发 5s 超时
  （负载相关，单跑全绿；对 PRP 代码 0 引用；vitest 未设 `testTimeout`）。

### 5.3 PRP-F1 正式接入正式侧视 Planck 战斗（相机部分已被 §5.4 取代）
- 新增 `runBattleRuntime.ts` / `runBattleView.ts`（离屏 canvas 上**零修改复用**正式 `Renderer` + `drawImage` 合成）。
- 旧正式 Battle 参数（唯一数值来源）：world **1600×900** / groundY **700** / spawnA `{400,640,1}` /
  spawnB `{1200,640,−1}`（中心距 **800**）/ Cannon `cd 1000 · muzzle 8 · dmg 80 · R 10 · recoil 30`。
  **PRP 构造传空 config `{}`（零覆盖）**。
- ⚠️ 复用坑（已写进源码注释）：
  1. **probe 坐标系不对称**：`'idle'` 的 `ground/road/player.bounds` 是**页面绝对坐标**；
     `'battle'` 的 `player/enemy.bounds` 是**带内相对坐标**。pixel 采样 battle **要** +`bands.stage.y`，idle **不能**加。
  2. **真实战斗不能单点采样** → E2E 用窗口累积观测。
  3. **车辆 sprite 特征色必须色族匹配**（tol 16）：缩放后精确色几乎不残留；判据 =「在该车自己外廓内计数 +
     两车交叉命中 = 0」。PNG 主色团：banana `240/192/48`、watermelon `48/128/48`。
  4. 账本：EVENT 起 `ground/road` 不登记；`LEDGER_TOLERANCE_DEFAULT = 8` 兜巧合像素。
  5. 压缩产物正向证据用「可达 chunk 图 + 压缩存活标记」（`maxTOIContacts` / `hardpointId` …）。

### 5.4 PRP-R5 恢复正式 Battle Camera（已交付 `c44239b`）
- **正式相机口径 = 逐帧 `reframe(snap,'battle',{phase})` → 私有 `battleCam` → `render()` 内逐帧
  `applyBattleFollow` → `this.transform`**（权威定义 = `tests/battleDynamicFramingR21.test.ts`）。
  记忆锚点：①Active 三段 span `0.87/0.75/0.60`；②follow「**分离才拉远、接近不放大**」+ offset clamp 到
  「不露出 arena 外」+ 地面线零位移；③阻尼 1.5%/帧、死区 0.003、地面线锚定视口 0.68–0.72。
- **viewport adapter（核心设计）**：离屏视口 = 舞台带 + inset×2 = **502×358** → 正式安全区**恰好等于**
  舞台带 390×302（原点 56,28），合成时 9 参 `drawImage` 只裁安全区一块。
  前提：`isCompactLandscape(502,358) = false`（aspect 1.402 < 1.5）。
- PRP 侧只做三件事：接线 + clip + 合成。节奏 `shouldReframeBattleCamera(phase,lastPhase) = phase!==lastPhase || phase==='Active'`。
  视图层**绝不写 `this.renderer.transform =`**，`battleCam` 恒由正式 Renderer 私管。
  ⚠️ 非 Active 逐帧 reframe 会与 `applyBattleFollow` 互相拉扯（0.4%/帧 抖动）→ 必须按上述节奏。
  ⚠️ 结束态（`result !== null`）**不再 reframe、不再重画离屏战场**（复用结束帧）→ 保住「RESULT = 战场冻结」；
  `applySize()` 变化时强制解冻重画。
- 已删除的固定远摄逻辑：`RUN_BATTLE_GROUND_FRAC` / `RunBattleCamera` / `runBattleCamera()` /
  `battleViewX/battleViewY` / `scale=390/1600` 与 `offsetX=0` 常量 / 刻意绕开 `reframe` 的设计。
- 冻结实测值（adapter 口径，已进单测字面量，改动即需同步）与同场对照见我 `交接文档_2026-09-12_PRP-R5.md`。

### 5.5 PRP-F2 强化闭环（`ca3fb43` F2 → `1a3b080` F2-R1 → F2-R2 本轮）
- **Modifier 接缝 = Run-local overlay registry**（唯一；是**正式既有范式的复用**，不是新造机制）：
  `createRegistry()`（`content.ts:1012`，已导出、每次全新实例）造副本 → 注册 `run.mod.<id>`（以正式 `cannon`
  为基准派生）→ 本局快照里武器 `defId` 重映射过去。正式 `content.ts` / `registry` 单例 / `ContactRouter` /
  `Orchestrator` 零修改。**完整 file:line 证据链见 `交接文档_2026-09-12_PRP-F2.md` 与 `runModifiers.ts` 文件头**
  （要点：`types.ts:186` 注册表是可变 Map；`buildSnapshot.ts:119`+`types.ts:150` `MovementInstall.overrides`
  证明 override 是正式既有范式；`cannonBehavior.ts:68` `readCannonParams` 只读 `part.def.behaviorParams`）。
- **关键缺口**：`FunctionalInstall` **只有 `star`、没有 `overrides`**（Movement 有）。
  将来「运行期改 Weapon 任意字段」的最小 Foundation 补正 = 补 `overrides?: Partial<FunctionalPartDef>`。
- **三项 overlay 当前冻结值**（`runModifiers.ts` 的 `RUN_MODIFIER_OVERLAY`）：
  重型弹头 `radius 16 / mass 4 / recoil 90`（**damage 刻意不动**，真人已通过）/ 双联炮
  `burstRounds 2 / burstIntervalMs 100`（真人已通过）/ 快速装填 `cooldownMs 650`（F2-R2 从 400 回收，≈1.54×）。
- **Cannon 最小 burst**（`src/battle/cannonBehavior.ts`，F2-R1）—— ⚠️ **本分支唯一正式 gameplay 改动，Queue 显式授权**：
  新增**可选** `burstRounds`（默认 1）/ `burstIntervalMs`（默认 0）；6 个基准参数仍「缺失即抛错」，这两个走
  `optNum`（缺失/非法 → 默认）→ **正式 `content.ts` 零字段新增**，默认行为**逐帧不变**（回归 27/27）。
  `stepFixed` = 连发间隔 → 主冷却 → `emitRound()`（**冷却只在最后一发之后计时**）。
  实测步差：正式 cannon **60 步**（1000ms）/ 双联炮 **6 步**（100ms）；两发**弹道同向**（出生 y 差 <3px）、
  渲染回正式 cannon 弹丸（不再借 shotgun 的 `'tracer'`）。
  历史教训：第一版双联炮借官方 `shotgun` 的 `fanAnglesDeg [-4,4]` 同步齐射 → 两发轨迹重叠，真人判**不通过**
  （当时 `getBehaviorFactory`（`behaviorRegistry.ts:41`）是静态表不可注入）。
- **流程 = 严格单变量**（`runPageState.ts`）：`battlesCompleted`(0/1/2) + `RUN_MAX_BATTLES=2`；第一场 RESULT → CHOICE
  （**唯一一次**改装机会）；第二场 RESULT → **全新 Run**（`createRunPageState`）。终局标签 `RUN_RESTART_LABEL='重新开始验证'`；
  `chooseRunBuff` 守卫 `modifier!==null || buffs.length>0 → no-op`。
  → `DAY 8/7` / 多 Buff 累计 / 重复叠加强化 **结构上不可能**。终局第三行叙事 = 「本次改装的验证到此结束。」
- ⚠️ **胜负余量极窄**：演示遭遇基础只多剩 `228~280 / 1100` → **提 DPS 就碾压、降 DPS 就必败**；
  只适合「方向可见」验证，**不适合数值微调对比**（`projectileDamage: 40` 的双联炮实测必败）。
- **跨战斗耐久**：`PlanckVehicle.hp` 可写、`maxHp` 独立（`planckVehicleAssembly.ts:76-77`）→ **只写 `hp`**；
  `BattleConfig` 里**没有 HP 字段**。⚠️ `initialPlayerHp` 必须是**构造时捕获的 `readonly` 字段**，
  不能是实时读 `vehicleA.hp` 的 getter（会假红）。
- ⚠️ **开火节奏只能按 `weaponFire` 事件量，不能按弹丸数增量**：本演示「弹丸命中销毁的那一步」常常正好等于
  「下一发的开火步」→ 计数净变化 0 → **漏计**（实测 `birthGaps` 出现 120/240 步）。单测用事件时间差；
  E2E 只能用**最小观测间隔**（漏计只让间隔变大 → 最小值是稳健下界）。
  另：**本演示只有玩家（team `A`）开火，敌方无炮**。
- 冻结量变化（**预期后果**，非放开断言）：选后 `DAY 3→4` → `nodeDone 384→512 / nodeTodo 512→384`（**总量恒 896**）、
  日志 `+6 → +7`；图标配色键改名 `iconShell/iconTwin/iconReload`（**色值未动**）。
- ⚠️ **图标判据用「盒内面积统计」**：probe 有 `choiceOptions[].iconRect`（与绘制同源 `runChoiceIconRect`）。
  双联炮图标 = 两根并排炮管 → 46×46 盒的几何中心落在**两管空隙**里 → **中心单点采样必然假红**。
- ⚠️ **同一文件的多条 Edit 不要并行发出**（后落盘覆盖前者 → 静默丢改动，改完 grep 仍是旧值）；必须串行。

## 6. Next action
- **PRP-F2-R2 已交付并停等**（单功能 commit + push，SHA 见 daily log）。
- **待用户裁决（真人录屏）**：快速装填回收后（650ms）是否「仍明显更快、但不再压缩接敌节奏」。
  重型弹头 / 双联炮两轮真人 ✅ 已通过并冻结 → **不得再调**。
- **PRP-R5 遗留裁决**（若真人仍嫌车小）：adapter 口径开局 69·84px / 峰值 172·190px 是否可感知。
  候选（均需重新授权）：调大 `RUN_BATTLE_VIEW_INSET`（代价是裁切）或分段取景。
  **禁止**在无授权时新增 PRP 专属动态 zoom / 镜头震动 / Kill zoom —— **恢复旧模式，不发明新模式**。
- 未裁决挂起：俯视 `WEAPON_CONTACT_THRESHOLD=0.5`（`contactRouter.ts:694`）是否单开 Queue。
- **PRP-R3 / F1 / R5 / F2 / F2-R1 / F2-R2 六轮电脑录屏真人验收回执仍未全部归档**（本分支唯一未闭环项）。
- Low-prio backlog：`tests/_e2e_portrait_battle_lab.cjs` 的 `[iso] I2` 仍用 `readdirSync().find()`（同类「读到过期
  chunk」缺陷，修法已有范式）；KNOWN-WX-COLD-BOOT-PREVIEW-SCALE-01；mobile drive slot（F-GARAGE-TOUCH-ASSEMBLY-R2）；
  strip-scroll no clamp；O1/O2 非阻塞优化项。**Foundation 补正候选**：给 `FunctionalInstall` 补 `overrides`（见 §5.5）。
