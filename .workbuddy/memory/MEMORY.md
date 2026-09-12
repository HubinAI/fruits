# Fruits - Runtime Memory Index

Detail -> `.workbuddy/memory/YYYY-MM-DD.md` / repo-root `交接文档_*.md`
Authority: `最强水果_项目核心共识与开发边界_WorkBuddy_Memory.md`

## 1. Identity
- Repo `git@github.com:HubinAI/fruits.git` | dir `D:\0818new\最强水果`
- 主线 `foundation-02-wechat`（上一交付 R3 `1bb35d7`）；实验分支 `prototype-portrait-battle-lab`（可整块删除）
- 原型正式名 **PRP｜Portrait Run Prototype**（PBL 旧名仅存 Debug Lab）
- PRP 链：`01915e2`(skill) → `2ee47bb`(A1) → `8c27cd0`(B1 停止) → `7532f98`(G1) → `e48aa1a`(F0) →
  `c3c9b0f`(R1) → `15fd7ac`(R2) → `0ddd8f1` → `b96a56d`(R3) → `9d689dc`(memory) → `21ac9b7`(PRP-R4 调查，0 行代码)
  → **PRP-F1 正式接入旧侧视 Planck 战斗（已交付，见 §5.8）**
- 历史事实：PRP-F1 之前 PRP 战斗区**没有物理**（纯演示脚本）；PRP 链**从未触碰正式 gameplay 目录**。

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
  全量 `--pool=vmForks --maxWorkers=1`。
- 本机 bash PATH 可能缺 `/usr/bin`（`ls/grep/dirname` 全丢）→ 命令前加 `export PATH="/usr/bin:/bin:$PATH"`。
- `交接文档_*.md` 是**本地件**（`git ls-files` 无匹配），勿误提交；截图交付落 `outputs/`（gitignored）。

## 4. Stable contracts
- DPR 只乘一次（logical→backing），禁重复乘；safe-area / capsule / hitArea 一律逻辑坐标。
- Player 舞台 844×390；Lab/PRP 舞台 **390×844**。
- Viewport resume 只走 `syncWechatViewport`，无第二套 sizing 路径。
- E2E 句柄只在 `__E2E_INTERNAL_HANDLE__` 下；RC/web 排除。dev 下它存在且为 `false`（宏语义）→ 不是泄漏。
- hitArea 与绘制矩形**同源**（`computeFusionLayout` / `runPageLayout`）；E2E 命中域 = 逻辑舞台，非 CSS viewport。
- **像素账本口径**：只登记「不承载文字、不被描边覆盖」的纯色平铺矩形；承载文字/描边的面改点位采样
  （文字抗锯齿实测差 2018–8476px）。⚠️ 画面含**缩放位图**时，纯色账本只能登记远离它的平涂面。
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

## 5. Current truth（细节见当日 daily log）

### 5.1 PBL-F0/F1/F2（Lab 基建，冻结）
- 入口 `portrait-lab.html` + `src/lab/portraitBattleLab/` + `vite.portrait-lab.config.ts`（outDir `dist-portrait-lab/`）。
- 隔离不变量（单向）：正式 src/ 全树 + 正式入口 + 4 个正式构建配置 **0 引用** `portraitBattleLab|portrait-lab`；
  Lab 只允许 import 白名单只读模块，禁 Runtime/DOM/平台/物理模块。
- F1 数据纪律：Loadout = 正式 `BuildDraft`；敌人 = 正式 `OPPONENT_TEMPLATES`；数值一律
  `buildSnapshotFromDraft → validateSnapshot → resolveSnapshot`，零手写数值；正式库缺的部件 → **unavailable，不造数值**。
- F2 多实体：`contactRouter.resolveVehicle` 三级规则（唯一 id → 该队恰 1 辆 → 否则 undefined 安全跳过）；
  ⚠️ 实例 group 必须取 `-(100+i)`，避开正式 projectile 占用的 `-1/-2`。

### 5.2 PBL-A1 俯视 Arena A（已交付，Lab-local）
- `arenaA.ts` / `arenaScene.ts`；`ARENA_A_BOUNDS={12,152,378,812}`、零重力、四边静态墙 `restitution 0.05`、
  墙无 OwnerTag → 无刺墙/缩圈/边界伤害。驱动用真实 `applyLinearImpulse`（COM, J=mass×Δv），不伪造 `grounded`。
- 口径：`DamageEvent.source/target` 是 **TeamId**；Cannon 快照无 `velocity` → 用 `weaponFire.worldDirection`；
  `rotatePlanckVehicle` 是**相对**旋转；脱困用**净位移窗口**。

### 5.3 PBL-B1 竖屏侧视 Arena B → **停止条件触发，0 行代码**
- 390 宽舞台扣边界后横向接敌轴仅 **366px**；共享车整车外接框 205–249px，1v1 总宽 **410–498**（缺口 44–132），
  1v3 总宽 828–872 → 最大分离出生仍互嵌（几何硬约束）。
- **唯一出路 = 放宽镜头边界（B1-B）或 Lab-only 缩小车（B1-C）**，两者都必须用户先裁决。
- 可省一次调研：B 的正式侧视链路可 Lab 内直接复用且**无需 Lab-local 驱动适配**；
  ⚠️ 禁复用 `PlanckArenaRuntime`（无条件建左右 Closing 刺墙 + hazard，无开关）。

### 5.4 PBL-G1 A/B 对照门禁（已交付）
- `gate.ts`（纯逻辑）：允许差异恰好 3 类；`auditSharedCombatData()` 用正式链路独立重算；
  `PBL_ARENA_RUNTIMES` 是**可用性唯一来源**（B 的 blocked 是派生）；blocked 时 `plan=null` 且绝不 Start。
  DOM 面板必须在 canvas 之外（否则污染像素分类）。

### 5.5 PRP 产品基线（F0/R1/R2）
- **整个单局 = 一个持续存在的竖屏 Adventure Run Page**；战斗/事件/强化/结果是同一页面的不同状态；
  战斗保持**玩家左·敌人右的侧视**。全 canvas 单页（无 DOM 按钮 → 结构上无法跳转）。
- R1 FAIL 真根因 = **入口给错**（一条 `--open=` 把人送进旧 Debug Lab）；R2 FAIL 真根因 = **启动链** → 见 §4。
- ⚠️ 既有抖动（**非 Queue 回归**）：全量 vitest 时 `garageFusionResultInteractionR22.test.ts` 偶发 5s 超时
  （负载相关，单跑全绿；vitest 未设 `testTimeout`）。

### 5.6 页面冻结量（RP-01b，**页控件/SKIN 部分 PRP-F1 未动**）
- **四带**：顶部 **80** / 舞台 **302** / 日志 **378** / 动作 **84**（= 9.48/35.78/44.79/9.95%）。
- **顶部减法**：无「核心构建 X/5」、无固定空槽；两行 = `DAY 3 / 7` + 7 节点；第二行**只画实际已获得的**
  强化图标（`RUN_BUFF_ICON_MAX=5`）；结构性证明 `runBuffIconRects(0) === []`。
- **IDLE 待机近景**：`runSideViewScale = min(0.9,(390−2×10−14)/(wP+wE)) = 0.7722…`；`groundInsetPx=52 → groundY=330`。
- **零纯色占位纪律**：轮组按真实半径程序化画圆；其余可视件必须带正式 `visualId`，资源未就绪**整件不画**；
  缺 `visual` 的部件整件剔除。机器判据 `hasPlaceholderVisual` / probe `allSprites`。
- **日志 = 纯自然语言**：`RunLogKind` 六值 + `formatRunLog(e)=>e.text`（恒等）→ 结构上吐不出方括号前缀。
  15px / lineH 28 / maxLines 12。累积行数：IDLE 2 → EVENT 4 → BATTLE **零追加** → RESULT 7 → CHOICE 不写 → 选后 8。
- 账本 8 层：`ground 780 / road 19500 / nodeDone 384 / nodeTodo 512 / buffIcon 0→756 / buffChip 0→144 /
  cardBar 0→3720 / actionBar 990→0`（EVENT 起 `ground/road` 不再登记 —— 见 §5.8）。
- ⚠️ **sprite 重采样污染等色面积**：禁用态动作条本应入账，但车身缩放重采样有 **1 个抗锯齿像素
  `(149,295)` 恰等于 `#2a3341`** → 删 `actionBarOff` 层，禁用态改用 probe `actionEnabled===false` + 点位采样。
- ⚠️ 分带线必须画在下一条带**首行** `band.y`；画在 `band.y−1` 会吃掉 `road` 最底一行（18889 ≠ 19500）。
- ⚠️ **E2E 隔离断言空转陷阱**：`dist-portrait-lab/` 累积旧 chunk → 「按前缀挑第一个 chunk」读到**过期产物**
  使断言恒真 → 必须从 `run-page.html` 取**真实引用**；不可断言「目录零残留」。

### 5.7 PRP-R4 调查（`21ac9b7`，0 行代码，**已被用户裁决取代**）
- 当时结论：Queue 前提「PRP-F1 已接入真实战斗」不成立 —— PRP 战斗 = `RUN_BATTLE_SCRIPT`(90 步线性 HP 插值)
  + `sin(πp)` 视觉位移；`git diff` 正式 gameplay 目录 = 空。用户裁决 **A｜确认接入** → 见 §5.8。

### 5.8 PRP-F1 正式接入旧侧视 Planck 战斗（已交付，门禁全绿）
- 新增 `runBattleRuntime.ts`（正式 `PlanckBattleOrchestrator` 薄适配 + 固定远摄相机）、
  `runBattleView.ts`（离屏 390×302 canvas 上**零修改复用**正式 `Renderer` + `drawImage` 合成）、
  `tests/portraitRunBattle.test.ts`；`runPage/State/Scene/Layout` 大改并**删尽**旧假战斗死代码
  （`RUN_BATTLE_SCRIPT` / 线性 HP 插值 / `sin` 位移 / `translateRunGroup` 系已移除）。
- 旧正式 Battle 参数（唯一数值来源）：world **1600×900** / groundY **700** / spawnA `{400,640,1}` /
  spawnB `{1200,640,−1}`（中心距 **800**）/ phases 10s·3s·5s / Cannon `cd 1000 · muzzle 8 · dmg 80 · R 10 · recoil 30`。
  **PRP 构造传空 config `{}`（零覆盖）**；`src/core|battle|physics|render|player|platform` diff = **空**。
- 实测时间线：开局外廓间距 **529**；firstShot step **1**；firstDamage step **132**（此刻间距仍 **+91.7 > 0**
  → 必为飞行弹丸）；firstContact step **157**；整场 **921 步 ≈15.37s**，9 轮开火，`hpA 269.78 / hpB 0`；
  最强后坐回退 **14.9**；玩家车回退 **313.7**（收束阶段 `aMinX` 最小 **−3.98** → **相机必须覆盖完整世界**）。
- 相机：`scale = 390/1600 = 0.24375`、`offsetX = 0`、`groundScreenY = 302×0.72 = 217.44`。
  **只写 `renderer.transform`，绝不调 `reframe(snap,'battle')`** → `battleCam` 恒 null →
  `applyBattleFollow` 每帧 return → **结构上无追踪 / 无动态 zoom**（E2E 窗口内相机取值种类 = 1）。
  ⚠️ 车显示约 **50×19 逻辑 px**（完整世界 × 完整接敌纵深的代价，待用户裁决是否接受）。
- ⚠️ 复用坑（已写进源码注释）：
  1. **probe 坐标系不对称**：`'idle'` 的 `ground/road/player.bounds` 是**页面绝对坐标**；
     `'battle'` 的 `player/enemy.bounds` 是**带内相对坐标**。采样像素时 battle **要** +`bands.stage.y`，idle **不能**加。
  2. **真实战斗不能单点采样**（首命中 step 132、弹丸寿命 ≈40 帧）→ E2E 改 5s 窗口累积观测。
  3. **车辆 sprite 特征色必须色族匹配**（tol 16）：0.24375 缩放下精确色几乎不残留（香蕉仅 5px）；
     判据 = 「在该车自己外廓内计数 + 两车交叉命中 = 0」。PNG 主色团：banana `240/192/48`、watermelon `48/128/48`。
  4. 账本：EVENT 起 `ground/road` 不登记；`LEDGER_TOLERANCE_DEFAULT = 8` 兜巧合像素（RESULT `nodeTodo` 实测 513 vs 512）。
  5. 压缩产物正向证据用「可达 chunk 图 + 压缩存活标记」（`maxTOIContacts` / `hardpointId` …）。

## 6. Next action
- **PRP-F1 已交付并停等**（单功能 commit + push，见 §1 链尾）。
- **待用户裁决**：车在屏幕约 **50×19 逻辑 px**（完整世界 × 完整接敌纵深的代价）→ 维持 / 调 `RUN_BATTLE_GROUND_FRAC`
  与取景（不动世界）/ 分段取景（后者违反「相机第一版固定 framing」的冻结，需重新授权）。
- 未裁决挂起：B1 三选项已由「A」隐式覆盖（等价 B1-B）；俯视 `WEAPON_CONTACT_THRESHOLD=0.5`
  （`contactRouter.ts:694`）是否单开 Queue。
- **PRP-R3 与 PRP-F1 的电脑录屏真人验收回执均缺**（本分支唯一未闭环项）。
- Low-prio backlog：`tests/_e2e_portrait_battle_lab.cjs` 的 `[iso] I2` 仍用 `readdirSync().find()`（与 PRP-R3
  修掉的同类「读到过期 chunk」缺陷，修法已有范式）；KNOWN-WX-COLD-BOOT-PREVIEW-SCALE-01；
  mobile drive slot（F-GARAGE-TOUCH-ASSEMBLY-R2）；strip-scroll no clamp；O1/O2 非阻塞优化项。
