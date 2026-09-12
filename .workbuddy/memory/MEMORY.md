# Fruits - Runtime Memory Index

Detail -> `.workbuddy/memory/YYYY-MM-DD.md` / `archive/` / repo-root `交接文档_*.md`
Authority: `最强水果_项目核心共识与开发边界_WorkBuddy_Memory.md`

## 1. Identity
- Repo `git@github.com:HubinAI/fruits.git` | dir `D:\0818new\最强水果`
- Branch `foundation-02-wechat`（无新主线）；实验分支 `prototype-portrait-battle-lab`（可整块删除）
- 原型正式改名：**PRP｜Portrait Run Prototype**（本分支上的玩家向原型；PBL 旧名仅存于 Debug Lab）
- 主线上一交付 R3 `1bb35d7`；R2.1 体验 FAIL 基线 `8fbac75`
- PRP 链：`01915e2`(skill) → `2ee47bb`(PBL-A1) → `8c27cd0`(PBL-B1 停止) → `7532f98`(PBL-G1) →
  `e48aa1a`(PRP-F0 Run Page) → `c3c9b0f`(PRP-R1 入口/预览/比例) → `15fd7ac`(PRP-R2 启动链) →
  `0ddd8f1`(R2 memory) → **`b96a56d`(PRP-R3 信息层级重做，当前 HEAD)**

## 2. Rules
- 1 Queue = 1 problem；无静默扩范围。先调查/复现，锁定根因后再改码。
- tech pass ≠ 落进运行时 ≠ 真人体验通过。用户体验由用户裁决，不要让用户抓复杂技术日志。
- 命令自带语境；每条回复结尾说明「用户需要回什么」。
- PC 录屏常态化；手机录屏只用于大模块节点。每条 Queue 完成后停等，绝不自动续下一条。

## 3. Git / build safety
- `git stash` **禁止**；git 异常先跑 `scripts/repo-health.js`。
- 禁 `reset --hard` / `checkout --` / 删 `.git` / 手改 refs / force-push 已交付。
- 单功能 commit + push + 核对 local=ref=remote。RC 需 clean HEAD，badge/rc-build.json/runtimeInfo/HEAD 四方一致。
- ⚠️ 本机 remote-tracking refs **无法落地**（`git fetch` 报 `[new branch]` 但 `.git/refs/remotes/` 恒空）→
  四路核对以 **`git ls-remote`（真实远端）+ `.git/FETCH_HEAD`** 为权威；push 本身正常；**不要为此改 refs**。
- Memory 并入功能 commit；**不单独提交 memory**。
- vitest：cwd 盘符必须大写 `/D/…`（小写 `/d/…` → 模块图双实例 → 持久化测试静默假失败）；
  全量 `--pool=vmForks --maxWorkers=1`。
- 本机 bash PATH 可能缺 `/usr/bin`（`ls/grep/dirname` 全丢）→ 命令前加 `export PATH="/usr/bin:/bin:$PATH"`。

## 4. Stable contracts
- DPR 只乘一次（logical→backing），禁止重复乘。
- Viewport resume 只走 `syncWechatViewport`，无第二套 sizing 路径。
- safe-area / capsule / hitArea 一律逻辑坐标；Player 舞台 844×390，Lab/PRP 舞台 **390×844**。
- E2E 句柄只在 `__E2E_INTERNAL_HANDLE__` 下；RC/web 排除。
- hitArea 与绘制矩形**同源**（`computeFusionLayout` / `runPageLayout`）；E2E 命中域 = 逻辑舞台，不是 CSS viewport。
- 结果层 z 序（后注册先命中）：页控件 < dismiss(空白关) < `fusion-result-card`(点卡 no-op)。
- **像素账本口径**：只登记「不承载文字、不被描边覆盖」的纯色平铺矩形 → 面积可精确冻结；
  承载文字/描边的面改按点位精确采样。文字抗锯齿会吃掉净色面积（实测差 2018–8476px）。
- **入口唯一性（PRP-R2 起）**：本分支**唯一启动命令 = `npm run dev`**，它自动打开浏览器到根路径 `/`，
  根路径被 dev-only 插件重写为玩家体验入口（`build/branchDevEntry.ts`，`apply:'serve'`）。
  用户**不需要记任何 URL**、不需要在多个 localhost 地址间选择。
  `portrait-lab.html` = DEBUG ONLY（`npm run dev:debug-lab`）；`index.html` = 正式横屏游戏（`npm run dev:legacy`，显式备用）。
  **给用户的回复永远只说一条命令：`npm run dev`。**
- ⚠️ 改 `vite.config.ts` 时注意两条守卫（勿以说明性理由破坏）：R23 禁出现 `portrait-lab`/`portraitBattleLab`；
  RP-27 禁出现 `run-page`/`runMain`。故 dev 默认入口逻辑必须放在 `build/branchDevEntry.ts`，用 `from './build/branchDevEntry.ts'` 引入。

## 5. Current truth（按模块，细节见当日 daily log）

### 5.1 PBL-F0/F1/F2（Lab 基建，冻结）
- 入口 `portrait-lab.html` + `src/lab/portraitBattleLab/` + `vite.portrait-lab.config.ts`（outDir `dist-portrait-lab/`）。
- 隔离不变量（单向）：正式 src/ 全树 + 正式入口 + 4 个正式构建配置 0 引用 `portraitBattleLab|portrait-lab`（R22b/R23）；
  Lab 只允许 import 显式白名单只读模块，禁任何 Runtime/DOM/平台/物理模块（R22a）。
- F1 数据纪律：Loadout = 正式 `BuildDraft`；敌人 = 正式 `OPPONENT_TEMPLATES`（OPP-16/OPP-03/OPP-14）；
  `履带`→`heavyWheel`(adapted)、`磁铁`/`护盾` 正式库无 → **unavailable 不引入不造数值**（模块加载时动态校验）；
  数值一律 `buildSnapshotFromDraft → validateSnapshot → resolveSnapshot`，零手写数值。
  `buildSpawnPlan(loadout, encounter)` **无 arena 入参** → A/B 共用同一 `baseKey`。
- F2 多实体（受控版 C，只在 Lab 分支）：`contactRouter.resolveVehicle` 三级规则（唯一 id → 该队恰 1 辆 → 否则 undefined 安全跳过）；
  `createPlanckVehicle` 可选第 6 参 `PlanckVehicleCollisionPolicy`；⚠️ 实例 group 必须取 `-(100+i)`，
  避开正式 projectile 占用的 `-1/-2`（否则「某敌车对弹丸免疫」静默 bug）。
- ⚠️ Lab 分层配色必须两两 RGB 互斥：曾用 `#ffd35a` 写提示文字 → 抗锯齿像素被 E2E 误计成 arena 层（虚增 ~310px）。

### 5.2 PBL-A1 纵向俯视 Arena A（已交付，Lab-local）
- 全在 Lab 目录：`arenaA.ts` / `arenaScene.ts`；`ARENA_A_BOUNDS={12,152,378,812}`（左右让出墙厚 12）、零重力、
  四边静态墙 `restitution 0.05`、`hazard {0,0}`、墙无 OwnerTag → 无刺墙/缩圈/边界伤害。
- 驱动：不调 `drivePlanckVehicle`、不伪造 `grounded`、不写速度/位置；平移 = 真实 `applyLinearImpulse`（COM, J=mass×Δv），
  转向 = COM±halfWheelbase 等大反向力偶；脱困用**净位移窗口**（瞬时速度不触发）。
- 口径：`DamageEvent.source/target` 是 **TeamId**（实例不可读）→ 用逐帧差分 + 伤害守恒判据；
  Cannon 渲染快照无 `velocity` → 用 `weaponFire.worldDirection`；`rotatePlanckVehicle` 是**相对**旋转；
  `driveTopdownVehicle(throttle=0)` 不施加冲量；穿透容差 16px。

### 5.3 PBL-B1 竖屏侧视 Arena B → **停止条件触发，0 行代码**
- 实测：390 宽舞台扣边界后横向接敌轴仅 **366px**；共享车整车外接框 205–249px，1v1 总宽 **410–498**（缺口 44–132），
  1v3 总宽 828–872。最大分离出生仍互嵌，残余 ≈ 总宽 − 可活动区（几何硬约束，非解算失败）。
- 出路全被禁 → 停止。**未来重开唯一方向 = 放宽镜头边界 或 Lab-only 缩小车，两者都必须用户先裁决。**
- 可省一次调研：B 的正式侧视链路可 Lab 内直接复用且**无需 Lab-local 驱动适配**；
  ⚠️ 禁复用 `PlanckArenaRuntime`（无条件建左右 Closing 刺墙 + hazard，无开关）。

### 5.4 PBL-G1 A/B 对照门禁（已交付）
- ⚠️ Queue 前提「A/B Runtime 已存在」对 B 不成立 → 对照只对 A 成立。
- `gate.ts`（纯逻辑）：允许差异恰好 3 类；`auditSharedCombatData()` 用正式链路独立重算 6 组合；
  `PBL_ARENA_RUNTIMES` 是**可用性唯一来源**（B 的 blocked 是派生而非写死，补上运行时即自动 ready）；
  blocked 时 `plan=null` 且绝不 Start。DOM 面板必须在 canvas 之外（否则污染像素分类）。

### 5.5 PBL-G1 之后：PRP｜Portrait Run Prototype
- 方向裁决：旧 Queue `PBL-R1-PORTRAIT-RUN-LAYOUT` **废止**。产品基线 = 「整个单局是一个持续存在的竖屏
  Adventure Run Page；战斗/事件/强化/结果是同一页面的不同状态；战斗保持**玩家左·敌人右的侧视即时物理**」。
- **PRP-F0-RUN-PAGE-SHELL 已交付**（commit 见 §1）——⚠️ 下方四带比例与 0.6 缩放**已被 §5.8 覆盖**，
  数值作历史基线保留：
  - 入口 `run-page.html` + `runMain.ts`（玩家页面）；Debug 控制仍只在 `portrait-lab.html`（Debug control area）。
    `vite.portrait-lab.config.ts` 双入口，同一 `dist-portrait-lab/`。
  - 分层：四带比例见 §5.6（PRP-R1 已按必改 3 调整为 84/414/262/84；PRP-R3 再改为 80/302/378/84）。
  - 侧视缩放：`runSideViewScale = min(0.6, (390−2×14−28)/(wP+wE))` → 实测恒 **0.6**；玩家固定左边缘 14、敌人固定右边缘 376；
    BATTLE 演出位移 = `sin(πp)×24`（纯表现，不变量：平移不改变任何像素面积 → 可用账本交叉核对）。
  - 五状态：IDLE→EVENT→BATTLE→(自动 2.4s)→RESULT→CHOICE→IDLE。BATTLE 期间**日志零追加**（不刷逐帧伤害），
    RESULT 一次性 +2 行（结果 + 耐久占位）。CHOICE = 画布内遮罩整页变暗 + 中央三选一（重型弹头/爆裂弹/紧急维修，
    固定不随机）；选择后回 IDLE、顶部 +1 图标、日志 +1「你选择了 X」。
  - 全 canvas 单页（无 DOM 按钮 → 结构上无法跳转）；命中区与绘制矩形同源 `runPageLayout`。
- ⚠️ 已知既有抖动（**非 Queue 回归**，已用排除实验证明）：全量 vitest 时
  `garageFusionResultInteractionR22.test.ts` 偶发 5s 超时（负载相关；单跑 11/11 全绿）。vitest 未设 `testTimeout`。
- 边界：PRP 不接正式 Roguelike 数值/Day 状态机/随机强化池/永久奖励/经济/存档；不改 Garage/Fusion；
  不继续 Arena A/B、不做俯视 Movement、不做正式敌人 AI、不做美术精修。

### 5.6 PRP-R1 ACTUAL-RUNTIME-ENTRY-LAYOUT-FIX（已交付）
- **真人验收 FAIL 的真根因 = 入口给错，不是 Run Page 画面错**。实测三入口（同一 dev server 5173）：
  `/` = 「最强水果 — Physics Lab」；`/portrait-lab.html` = 旧 Debug Lab（`pbl-canvas` + 11 个开发按钮 +
  1086 字调试文本 + Arena A 黄框）**← 用户录屏看到的就是这个**；`/run-page.html` = ✅ 正确的 PRP Run Page
  （`run-canvas`、0 button、正文 0 字、`__RUNPAGE__` 存在）。**`/run-page.html` 无 renderer 覆盖。**
- ⚠️ **教训**：`npm run dev:portrait-lab` 原是 `vite --open=/portrait-lab.html` → 一条命令就把人送进旧 Debug 面。
  已改名 `dev:debug-lab`；**唯一玩家体验入口 = `run-page.html`（`npm run dev:run-page`）**。
  `portrait-lab.html` 标题改为「DEBUG ONLY · …（非玩家体验入口）」+ 右下 fixed `pointer-events:none` 角标
  （脱离文档流 → 不改变 canvas 几何、不进 getImageData）。
- 四带比例（必改 3，RP-01b 冻结）：顶部 **84**(9.95%) / 舞台 **414**(49.05%) / 日志 **262**(31.04%) / 动作 **84**(9.95%)。
  日志 `maxLines` 8→10。**面积账本全部与 y 无关 → 带高调整不需要改任何冻结面积**（仍 1496/3012/288/2774/540/432/576/3920/966）。
- 桌面预览（必改 4）：`run-stage` 桌面分支 `height:min(88vh,940px)` + `width:calc(…×390/844)` 居中 + 中性背景；
  窄屏 `@media (max-width:640px),(max-height:620px)` 退回铺满。实测 1920×1080 → 434×939 居中(959.8,539.6)、
  1280×720(150%缩放真实视口) → 293×634；390×844 真机 → 铺满 scale=1。
- 门禁：PRP 单测 **29/29**（+RP-01b）、Lab targeted 124/124、tsc 0、五路构建 EXIT 0、
  PRP E2E **190/190**（4 视口，新增 R2b 居中 / R2c 88vh+比例 / R2d 主体+零开发控制 / R2e 无 Arena 调试黄框 /
  R2f 无 Debug Lab 句柄）、Lab E2E 148/148、全量 **199 files/1872 passed**、repo-health 9/9。正式源码 0 修改。
- 已知未做（诚实）：中部舞台在 390 宽竖屏下两车同框，显示缩放上限 0.6 使车体仅约 123×40 逻辑 px，
  舞台带面积占 49% 但视觉重心偏小 → 属**显示缩放的产品取舍**（≠ B1 的真实物理空间问题），是否放宽需用户裁决。

### 5.7 PRP-R2 DEFAULT-EXPERIENCE-ENTRY（已交付）
- **真人验收第二次 FAIL 的真根因 = 启动链，不是页面**：`npm run dev` = `vite`（无 `--open`）→ 根路径 `/`
  → Vite 解析为 `index.html` = 正式横屏游戏。用户「正常启动」自然进旧横屏 Home/战斗/结算；
  必须手输 `/run-page.html` 才看得到原型 → 因此「独立 URL 存在 + 测试全绿」不能算交付完成。
- 修法（最小、不重构）：`build/branchDevEntry.ts` = dev-only 插件，`configureServer` 中间件把 `/` 重写为
  `BRANCH_DEFAULT_DEV_ENTRY='/run-page.html'`；`apply:'serve'` → **构建期零影响**。
  `resolveDevEntryRewrite` 只重写目录根，`/index.html` / `/portrait-lab.html` / 资源路径一律不重写
  （旧横屏正式游戏仍是可直达的显式备用入口）。目标入口不存在时自动跳过（不会把根路径指向 404）。
- `package.json`：`dev` → `vite --open`（自动打开根路径）；新增 `dev:legacy`（`--open=/index.html`）与
  `e2e:default-entry`。旧 `dev:debug-lab` / `dev:run-page` 保留为显式备用。
- 实测（`node tests/_e2e_prp_default_entry.cjs`，**只访问根路径 `/`，禁止直连 run-page.html 绕过启动链**）：
  Vite 启动日志 `Local=http://127.0.0.1:5173/`；根路径 HTTP 响应体就是 PRP（含 PRP 标题 + `#run-root`，
  不含 `/src/main.ts`）；浏览器 1920×1080@1 与 1280×720@1.5 两视口第一屏即 PRP（title / `#run-root` /
  `#run-canvas`；`#app`、`#pbl-root`、`__PBL__` 全无；debugControls=0、domButtons=0；Arena 调试黄 **0px**；
  四带比例 9.95/49.05/31.04/9.95；URL 恒为 `/`），并跑完 IDLE→EVENT→BATTLE→RESULT→CHOICE→IDLE；
  另验 `/index.html` 仍是「最强水果 — Physics Lab」且 `#app` 存在。**59/59 PASS**。
- 门禁：新单测 `tests/portraitDefaultEntry.test.ts` **10/10**（含「插件已真实注册」「dev-only」「R23/RP-27 复检」
  「根目录只有三个 HTML 入口」）；Portrait targeted **134/134**；tsc 0；五路构建 EXIT 0；
  `dist`/`dist-pages`/`dist-wechat`/`dist-e2e` **零** `run-page|run-root` 字样（正式产物未被原型污染）；
  Run Page E2E 190/190；Lab E2E 148/148；bundle-clean wechat/e2e PASS；全量 **200 files/1882 passed**；
  repo-health 9/9。**正式源码 0 修改**（index.html 与四个正式构建配置未动）。
- ⚠️ 排查记录：dev 模式下 `window.__E2E_INTERNAL_HANDLE__` 存在且为 `false`（宏语义），
  全仓无源码赋值、`dist-portrait-lab` 产物**完全不含**该字符串 → 不构成句柄泄漏，不要再当问题排查。

### 5.8 PRP-R3 CAPYBARA-UI-HIERARCHY-REBUILD（已交付 `b96a56d`，**当前页面真相**）
- 第三次「技术通过 / 真人 FAIL」的修复，这次是**页面信息层级**：删掉 Debug 味（顶部空槽 + 方括号日志 + 红蓝矩形车）。
- **四带已改**（覆盖 §5.5/§5.6 的旧值，RP-01b 冻结）：顶部 **80** / 舞台 **302** / 日志 **378** / 动作 **84**
  = 9.4787% / 35.782% / 44.7867% / 9.9526%。
- **车辆 = 正式 sprite 只读复用**：正式 `visualWorldTransform()`（`battle/battleContract.ts`）+ 正式
  `assets/visuals/*.png` + Lab-local 最小绘制胶水（复刻 `Renderer.drawVisual` 的
  `translate(中心)·scale(-1,1)[mirror]·rotate` + `drawImage(img,-w/2,-h/2,w,h)`）。
  ⚠️ **不复用正式 `Renderer`**（3367 行、强耦合 camera/battleSnapshot/backdrop/特效池 → 属 Queue 点名的
  「必须大规模修改正式模块」停止条件）。**正式源码 0 修改。**
- **零纯色占位纪律**：轮组按真实半径程序化画圆（正式 Renderer 亦如此）；其余可视件必须带正式 `visualId`，
  资源未就绪**整件不画**；缺 `visual` 的部件整件剔除。机器判据 `hasPlaceholderVisual` / probe `allSprites`。
- 实测冻结：`runSideViewScale = min(0.9, (390−2×10−14)/(wP+wE)) = 0.7722342733188721`；
  `groundInsetPx=52 → groundY=330`；`baselineLiftPx=2 → baselineY=328`；车辆纵向占舞台带 **62%~82%**。
- **日志 = 纯自然语言**：`RunLogKind` 六值 + `formatRunLog(e)=>e.text`（恒等）→ 结构上吐不出方括号前缀。
  实测累积行数：IDLE 2 → EVENT 4 → BATTLE **零追加** → RESULT 7 → CHOICE 不写 → 选后 8。
- 账本 8 层：`ground 780 / road 19500 / nodeDone 384 / nodeTodo 512 / buffIcon 0→756 / buffChip 0→144 /
  cardBar 0→3720 / actionBar 990→0`。
- ⚠️ **sprite 重采样会污染「精确等色面积」断言**：禁用态动作条本应入账，但西瓜车身缩放重采样产生了
  **1 个抗锯齿像素 `(149,295)` 恰等于 `#2a3341`** → 精确面积不可能冻结，故删除 `actionBarOff` 层；
  禁用态改用 probe `actionEnabled===false` + 填充色点位采样。**凡画面含缩放位图，纯色账本只能登记远离它的平涂面。**
- ⚠️ 分带线必须画在下一条带的**首行** `band.y`；画在 `band.y−1` 会吃掉 `road` 最底一行（18889 ≠ 19500）。
- ⚠️ **E2E 隔离断言空转陷阱**：`dist-portrait-lab/` 因 `emptyOutDir:false`（本机 safe-delete shim 拦截
  `fs.rmSync`）累积历次构建旧 chunk → 「按前缀挑第一个 chunk」会读到**过期产物**使断言恒真。
  → 必须从 `run-page.html` 正则取**真实引用**；相应地不可断言「目录零残留」（那是构建配置既知约束）。
- 门禁：tsc 0｜`portraitRunPage` **34/34**（新增 RP-29~RP-33）｜`portraitBattleLab` **28/28**｜
  Portrait 定向 6 文件 **139/139**｜全量 **200 files / 1887 passed**｜Run Page E2E **217/217**｜
  default-entry E2E **65/65**｜Lab E2E **148/148**｜五路构建 EXIT 0｜repo-health 9/9。
- 边界：不接正式 Roguelike 数值/Day 状态机/随机强化池/永久奖励/经济/存档；车辆只有真实外观 + 待机 +
  简单左右位移 + BATTLE 演出位移 `sin(πp)×24`；无敌方 AI / 无射击动画 / 无击飞特效。

## 6. Next action
- **停等用户回执**（PRP-R3 已提交 `b96a56d`，**禁止自动开 PRP-F1**）：
  1. **电脑录屏真人验收 PRP-R3**（技术门禁 ≠ 体验通过）；启动命令仍只有一条：`npm run dev`；
  2. 历史挂起未裁决：B1 三选项（B1-A 确认停止 / B1-B 放宽镜头边界 / B1-C Lab-only 缩小车）；
  3. 俯视 `WEAPON_CONTACT_THRESHOLD=0.5`（`contactRouter.ts:694`）是否单开 Queue。
- Low-prio backlog: ⚠️ `tests/_e2e_portrait_battle_lab.cjs` 的 `[iso] I2` 仍用 `readdirSync().find()` 取
  「第一个 .js」→ 与 PRP-R3 修掉的**同一类**「隔断断言读到过期 chunk」缺陷（守卫强度弱化，结论未受影响，
  尚未修；修法已有现成范式：改从 `portrait-lab.html` 正则取真实引用）；
  KNOWN-WX-COLD-BOOT-PREVIEW-SCALE-01；mobile drive slot（F-GARAGE-TOUCH-ASSEMBLY-R2）；
  strip-scroll no clamp；O1/O2 非阻塞优化项。
