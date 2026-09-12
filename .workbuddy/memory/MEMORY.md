# Fruits - Runtime Memory Index

Detail -> `.workbuddy/memory/YYYY-MM-DD.md` / repo-root `交接文档_*.md`
Authority: `最强水果_项目核心共识与开发边界_WorkBuddy_Memory.md`
（本文件只留**不变量 + 陷阱 + 下一步**；公式、账本数字、逐帧时间线一律看 daily log。）

## 1. Identity
- Repo `git@github.com:HubinAI/fruits.git` | dir `D:\0818new\最强水果`
- 主线 `foundation-02-wechat`（上一交付 R3 `1bb35d7`）；实验分支 `prototype-portrait-battle-lab`（可整块删除）
- 原型正式名 **PRP｜Portrait Run Prototype**（PBL 旧名仅存 Debug Lab）
- PRP 链尾（全链见 daily log）：`9d689dc` memory → `21ac9b7` R4 调查(0 行代码) →
  `6fbf275` **PRP-F1** 正式接入旧侧视 Planck 战斗 → `c44239b` **PRP-R5 恢复正式 Battle Camera（见 §5.5）**
- 历史事实：PRP-F1 之前 PRP 战斗区**没有物理**（纯演示脚本）；PRP 链**从未触碰正式 gameplay 目录**
  （PRP-R5 后连 `src/render` 也 0 改动——相机复用靠 PRP 侧 viewport adapter）。

## 2. Rules
- 1 Queue = 1 problem；先调查/复现、锁定根因后再改码；无静默扩范围。
- tech pass ≠ 落进运行时 ≠ 真人体验通过；体验由用户裁决，别让用户抓技术日志。
- 命令自带语境；每条回复结尾写「用户需要回什么」。
- 每条 Queue 完成后**停等**，绝不自动续下一条。PC 录屏常态化；手机录屏只用于大模块节点。

## 3. Git / build safety
- `git stash` **禁止**；git 异常先跑 `scripts/repo-health.js`（纯 ESM 库，无 CLI 输出 → 用
  `node --input-type=module -e "import {checkRepoHealth} from './scripts/repo-health.js'"` 调）。
- 禁 `reset --hard` / `checkout --` / 删 `.git` / 手改 refs / force-push 已交付。
- 单功能 commit + push + 核对 local=ref=remote。RC 需 clean HEAD，badge/rc-build.json/runtimeInfo/HEAD 四方一致。
- ⚠️ 本机 remote-tracking refs **无法落地**（`git fetch` 报 `[new branch]` 但 `.git/refs/remotes/` 恒空）→
  以 `git ls-remote` + `.git/FETCH_HEAD` 为权威；push 正常；不要为此改 refs。
- Memory 并入功能 commit；**不单独提交 memory**（例外：纯 memory 补正可单独 commit）。
- vitest：cwd 盘符必须大写 `/D/…`（小写 → 模块图双实例 → 持久化测试静默假失败）；
  全量 `--pool=vmForks --maxWorkers=1`；`--reporter=basic` 不被支持。
- 本机 bash PATH 可能缺 `/usr/bin`（`ls/grep/dirname` 全丢）→ 命令前加 `export PATH="/usr/bin:/bin:$PATH"`。
- `交接文档_*.md` 是**本地件**（`git ls-files` 无匹配），勿误提交；截图交付落 `outputs/`（gitignored）。

## 4. Stable contracts
- DPR 只乘一次（logical→backing），禁重复乘；safe-area / capsule / hitArea 一律逻辑坐标。
- Player 舞台 844×390；Lab/PRP 舞台 **390×844**（PRP 四带见 §5.3）。
- Viewport resume 只走 `syncWechatViewport`，无第二套 sizing 路径。
- E2E 句柄只在 `__E2E_INTERNAL_HANDLE__` 下；RC/web 排除。dev 下它存在且为 `false`（宏语义）→ 不是泄漏。
- hitArea 与绘制矩形**同源**（`computeFusionLayout` / `runPageLayout`）；E2E 命中域 = 逻辑舞台，非 CSS viewport。
- **像素账本口径**：只登记「不承载文字、不被描边覆盖」的纯色平铺矩形；承载文字/描边的面改点位采样。
  ⚠️ 画面含**缩放位图**时，纯色账本只能登记远离它的平涂面。
- **入口唯一性（PRP-R2 起）**：唯一玩家入口 = 根路径 `/`，由 dev-only 插件 `build/branchDevEntry.ts`
  （`apply:'serve'`）重写到 `/run-page.html`。`portrait-lab.html` = DEBUG ONLY（`dev:debug-lab`）；
  `index.html` = 正式横屏（`dev:legacy`）。
  **给用户的启动指令必须两行连给**（npm 在「当前目录」找 package.json，缺 cd 会报 `Missing script: "dev"`）：
  ```powershell
  cd D:\0818new\最强水果
  npm run dev
  ```
- ⚠️ 改 `vite.config.ts` 注意两条守卫：R23 禁 `portrait-lab|portraitBattleLab`；RP-27 禁 `run-page|runMain`
  → dev 默认入口逻辑只能放 `build/branchDevEntry.ts`。
- `vite.portrait-lab.config.ts` 用 `emptyOutDir:false`（本机 safe-delete shim 拦 `fs.rmSync`）→
  `dist-portrait-lab/` 会**累积历次旧 chunk**（已 gitignore，不入库）。
- **判定正式行为要查测试，别信注释**：`src/` 里没有逐帧调 `reframe` 的调用点，正式相机口径唯一定义在
  `tests/battleDynamicFramingR21.test.ts`（见 §5.5）。

## 5. Current truth

### 5.1 已冻结历史（PBL F0/F1/F2/A1/B1/G1 + PRP-R4，细节全在 daily log）
- 结构：入口 `portrait-lab.html` + `src/lab/portraitBattleLab/` + `vite.portrait-lab.config.ts`（outDir `dist-portrait-lab/`）。
- 不变量：正式 src/ 全树 + 正式入口 + 4 个正式构建配置 **0 引用** `portraitBattleLab|portrait-lab`；Lab 只允许
  import 白名单只读模块；数值一律 `buildSnapshotFromDraft → validateSnapshot → resolveSnapshot`，
  正式库缺的部件 → **unavailable，不造数值**。
- 三条仍会咬人的陷阱：①实例 group 必须取 `-(100+i)`（回退由 `contactRouter.resolveVehicle` 三级规则安全跳过）；
  ②⚠️ **禁复用 `PlanckArenaRuntime`**（无条件建 Closing 刺墙 + hazard，无开关）；③G1 的 `PBL_ARENA_RUNTIMES`
  是**可用性唯一来源**，blocked 时 `plan=null` 绝不 Start，且 DOM 面板必须在 canvas 之外（否则污染像素分类）。
- B1 停止结论（已由 §5.5 的「放宽镜头边界」路径实质回答）：390 宽舞台横向接敌轴仅 **366px**，1v1 整车总宽
  **410–498** → 竖屏侧视是几何硬约束，不是参数问题。
- PRP-R4（`21ac9b7`，0 行代码）：当时 PRP 战斗 = `RUN_BATTLE_SCRIPT`(90 步线性 HP 插值) + `sin(πp)` 视觉位移。

### 5.2 PRP 产品基线（F0/R1/R2）
- **整个单局 = 一个持续存在的竖屏 Adventure Run Page**；战斗/事件/强化/结果是同一页面的不同状态；
  战斗保持**玩家左·敌人右的侧视**。全 canvas 单页（无 DOM 按钮 → 结构上无法跳转）。
- R1 FAIL 真根因 = **入口给错**；R2 FAIL 真根因 = **启动链** → 见 §4。
- ⚠️ 既有抖动（**非 Queue 回归**）：全量 vitest 时 `garageFusionResultInteractionR22.test.ts` 偶发 5s 超时
  （负载相关，单跑 11/11 全绿；对 PRP 代码 0 引用；vitest 未设 `testTimeout`）。

### 5.3 页面冻结量（RP-01b；PRP-F1/R5 均未动）
- **四带**：顶部 **80** / 舞台 **302** / 日志 **378** / 动作 **84**（合计 844）。
- 顶部无「核心构建 X/5」、无固定空槽；强化行**只画实际已获得的**（`RUN_BUFF_ICON_MAX=5`）；
  结构性证明 `runBuffIconRects(0) === []`。
- **IDLE 待机近景**：`runSideViewScale = min(0.9,(390−2×10−14)/(wP+wE)) = 0.7722…`；`groundInsetPx=52 → groundY=330`。
- **零纯色占位纪律**：可视件必须带正式 `visualId`，资源未就绪**整件不画**；缺 `visual` 的部件整件剔除。
- **日志 = 纯自然语言**：`RunLogKind` 六值 + `formatRunLog(e)=>e.text`（恒等）→ 结构上吐不出方括号前缀。
  累积行数：IDLE 2 → EVENT 4 → BATTLE **零追加** → RESULT 7 → CHOICE 不写 → 选后 8。
- ⚠️ **sprite 重采样污染等色面积**：禁用态动作条本应入账，但车身缩放重采样有 **1 个抗锯齿像素
  `(149,295)` 恰等于 `#2a3341`** → 删 `actionBarOff` 层，禁用态改用 probe `actionEnabled===false` + 点位采样。
- ⚠️ 分带线必须画在下一条带**首行** `band.y`；画在 `band.y−1` 会吃掉 `road` 最底一行。
- ⚠️ **E2E 隔离断言空转陷阱**：`dist-portrait-lab/` 累积旧 chunk → 「按前缀挑第一个 chunk」读到**过期产物**
  使断言恒真 → 必须从 `run-page.html` 取**真实引用**；不可断言「目录零残留」。

### 5.4 PRP-F1 正式接入旧侧视 Planck 战斗（**相机部分已被 §5.5 取代**）
- 新增 `runBattleRuntime.ts` / `runBattleView.ts`（离屏 canvas 上**零修改复用**正式 `Renderer` + `drawImage` 合成）
  / `tests/portraitRunBattle.test.ts`；`runPage/State/Scene/Layout` 大改并**删尽**旧假战斗死代码。
- 旧正式 Battle 参数（唯一数值来源）：world **1600×900** / groundY **700** / spawnA `{400,640,1}` /
  spawnB `{1200,640,−1}`（中心距 **800**）/ Cannon `cd 1000 · muzzle 8 · dmg 80 · R 10 · recoil 30`。
  **PRP 构造传空 config `{}`（零覆盖）**；`src/core|battle|physics|render|player|platform` diff = **空**。
- 实测时间线（逐场稳定）：firstShot step **1** → firstDamage step **132**（此刻间距仍 **+91.7 > 0** → 必为飞行弹丸）
  → firstContact step **157** → 整场 **921 步 ≈15.37s**，9 轮开火，`hpA 269.78 / hpB 0`；最强后坐 **14.9**。
- ⚠️ 复用坑（已写进源码注释）：
  1. **probe 坐标系不对称**：`'idle'` 的 `ground/road/player.bounds` 是**页面绝对坐标**；
     `'battle'` 的 `player/enemy.bounds` 是**带内相对坐标**。pixel 采样 battle **要** +`bands.stage.y`，idle **不能**加。
  2. **真实战斗不能单点采样**（首命中 step 132、弹丸寿命 ≈40 帧）→ E2E 用 5s 窗口累积观测。
  3. **车辆 sprite 特征色必须色族匹配**（tol 16）：缩放后精确色几乎不残留；判据 =「在该车自己外廓内计数 +
     两车交叉命中 = 0」。PNG 主色团：banana `240/192/48`、watermelon `48/128/48`。
  4. 账本：EVENT 起 `ground/road` 不登记；`LEDGER_TOLERANCE_DEFAULT = 8` 兜巧合像素。
  5. 压缩产物正向证据用「可达 chunk 图 + 压缩存活标记」（`maxTOIContacts` / `hardpointId` …）。

### 5.5 PRP-R5 恢复正式 Battle Camera（已交付，门禁全绿）
- 目标：保住 F1 的正式物理世界，只换回**正式 Battle Camera 的 framing/follow 体验**（F1 的固定远摄被真人判定不可感知）。
- **正式相机口径 = 逐帧 `reframe(snap,'battle',{phase})` → 私有 `battleCam` → `render()` 内逐帧
  `applyBattleFollow` → `this.transform`**（权威定义 = `tests/battleDynamicFramingR21.test.ts`，不在 `src/`）。
  记忆锚点三条：①Active 三段 span `0.87/0.75/0.60`；②follow「**分离才拉远、接近不放大**」+ offset clamp 到
  「不露出 arena 外」+ 地面线零位移；③阻尼 1.5%/帧、死区 0.003、地面线锚定视口 0.68–0.72。
  **公式细节见 `交接文档_2026-09-12_PRP-R5.md` 与当日 daily log。**
- **viewport adapter（核心设计）**：离屏视口 = 舞台带 + inset×2 = **502×358** → 正式安全区**恰好等于**
  舞台带 390×302（原点 56,28），合成时 9 参 `drawImage` 只裁安全区一块。
  前提：`isCompactLandscape(502,358) = false`（aspect 1.402 < 1.5），否则走 compact inset 就不是 28/28。
- **PRP 侧只做三件事**：接线 + clip + 合成。节奏 `shouldReframeBattleCamera(phase,lastPhase) = phase!==lastPhase || phase==='Active'`。
  视图层**绝不写 `this.renderer.transform =`**，`battleCam` 恒由正式 Renderer 私管。
  ⚠️ 非 Active 逐帧 reframe 会与 `applyBattleFollow` 互相拉扯（0.4%/帧 抖动）→ 必须按上述节奏。
  ⚠️ 结束态（`result !== null`）**不再 reframe、不再重画离屏战场**（复用结束帧）→ 保住「RESULT = 战场冻结」+
  顺带消除 transform 写入。`applySize()` 变化时强制解冻重画。
- **已删除的固定远摄逻辑**：`RUN_BATTLE_GROUND_FRAC`、`RunBattleCamera` 接口 / `runBattleCamera()` /
  `battleViewX/battleViewY`、`scale=390/1600` 与 `offsetX=0` 常量、刻意绕开 `reframe` 与刻意 `battleCam=null` 的设计。
- **冻结实测值**（adapter 口径，全部已进单测字面量，改动即需同步）：开局 span **84.0293%** / scale **0.331024** /
  可见世界宽 **1178.161**；三段帧数 **57 / 93 / 755**；碰撞段单车 **28.8~54.2%** 舞台（≥16%）；峰值 scale **0.908035**（≈2.74×）；
  可见世界宽最小 **429.499**（< 1600 → 不再全世界）；Active 单帧 **1.5000%**；地面线带内 **215.44** 恒定（漂移 0）；
  B 右缘 **360.474**；A 左缘最小 **−0.329**（正式 clamp 亚像素溢出，`>= -1`）。
- **同场对照**（开局 scale / 车宽）：正式横屏 844×390 = 0.7164 / 149·181px；**PRP adapter 502×358 = 0.3310 / 69·84px**；
  裸注入 390×302 = 0.2360 / 49·60px（比原方案更差）；F1 固定远摄 = 0.24375 / 34px。
- 门禁：`tsc` 0 错；定向单测 **93/93**；全量 vitest 200/201 文件 · **1891 passed**（唯一失败为 §5.2 已知偶发）；
  五路构建 + `repo-health` 全 EXIT 0；E2E Run Page（4 视口）**267/267**、E2E 默认入口 **77/77**（复跑两次全绿）。

## 6. Next action
- **PRP-R5 已交付并停等**（`c44239b`，单功能 commit + push，三路 SHA 四方一致，见 §1 链尾）。
- **待用户裁决（真人录屏）**：adapter 口径开局车宽 69·84px / 峰值 172·190px 是否达到「物理可感知」。
  若仍偏小 → 候选（均需重新授权）：调大 `RUN_BATTLE_VIEW_INSET`（视口更宽 → scale 更大，代价是裁切）或分段取景。
  **禁止**在无授权时新增 PRP 专属动态 zoom / 镜头震动 / Kill zoom——**恢复旧模式，不发明新模式**。
- 未裁决挂起：俯视 `WEAPON_CONTACT_THRESHOLD=0.5`（`contactRouter.ts:694`）是否单开 Queue。
- **PRP-R3 / PRP-F1 / PRP-R5 三轮电脑录屏真人验收回执均缺**（本分支唯一未闭环项）。
- Low-prio backlog：`tests/_e2e_portrait_battle_lab.cjs` 的 `[iso] I2` 仍用 `readdirSync().find()`（同类「读到过期 chunk」
  缺陷，修法已有范式）；KNOWN-WX-COLD-BOOT-PREVIEW-SCALE-01；mobile drive slot（F-GARAGE-TOUCH-ASSEMBLY-R2）；
  strip-scroll no clamp；O1/O2 非阻塞优化项。
