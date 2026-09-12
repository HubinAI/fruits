# Fruits - Runtime Memory Index

Detail -> `.workbuddy/memory/YYYY-MM-DD.md` / `archive/` / repo-root `交接文档_*.md`
Authority: `最强水果_项目核心共识与开发边界_WorkBuddy_Memory.md`

## 1. Identity
- Repo `git@github.com:HubinAI/fruits.git` | dir `D:\0818new\最强水果`
- Branch `foundation-02-wechat`（无新主线）；实验分支 `prototype-portrait-battle-lab`（可整块删除）
- 原型正式改名：**PRP｜Portrait Run Prototype**（本分支上的玩家向原型；PBL 旧名仅存于 Debug Lab）
- 主线上一交付 R3 `1bb35d7`；R2.1 体验 FAIL 基线 `8fbac75`
- PRP 链：`01915e2`(skill) → `2ee47bb`(PBL-A1) → `8c27cd0`(PBL-B1 停止) → `7532f98`(PBL-G1) → PRP-F0 见 §5.7

## 2. Rules
- 1 Queue = 1 problem；无静默扩范围。先调查/复现，锁定根因后再改码。
- tech pass ≠ 落进运行时 ≠ 真人体验通过。用户体验由用户裁决，不要让用户抓复杂技术日志。
- 命令自带语境；每条回复结尾说明「用户需要回什么」。
- PC 录屏常态化；手机录屏只用于大模块节点。每条 Queue 完成后停等，绝不自动续下一条。

## 3. Git / build safety
- `git stash` **禁止**；git 异常先跑 `scripts/repo-health.js`。
- 禁 `reset --hard` / `checkout --` / 删 `.git` / 手改 refs / force-push 已交付。
- 单功能 commit + push + 核对 local=ref=remote。RC 需 clean HEAD，badge/rc-build.json/runtimeInfo/HEAD 四方一致。
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
- **PRP-F0-RUN-PAGE-SHELL 已交付**（commit 见 §1）：
  - 入口 `run-page.html` + `runMain.ts`（玩家页面）；Debug 控制仍只在 `portrait-lab.html`（Debug control area）。
    `vite.portrait-lab.config.ts` 双入口，同一 `dist-portrait-lab/`。
  - 分层：顶部薄层 96（DAY 3/7 占位 + 7 进度节点 + 5 个 Build 图标槽）/ 中部侧视舞台 480 / 日志 200 / 最底唯一动作 68（合计 844）。
  - 侧视缩放：`runSideViewScale = min(0.6, (390−2×14−28)/(wP+wE))` → 实测恒 **0.6**；玩家固定左边缘 14、敌人固定右边缘 376；
    BATTLE 演出位移 = `sin(πp)×24`（纯表现，不变量：平移不改变任何像素面积 → 可用账本交叉核对）。
  - 五状态：IDLE→EVENT→BATTLE→(自动 2.4s)→RESULT→CHOICE→IDLE。BATTLE 期间**日志零追加**（不刷逐帧伤害），
    RESULT 一次性 +2 行（结果 + 耐久占位）。CHOICE = 画布内遮罩整页变暗 + 中央三选一（重型弹头/爆裂弹/紧急维修，
    固定不随机）；选择后回 IDLE、顶部 +1 图标、日志 +1「你选择了 X」。
  - 全 canvas 单页（无 DOM 按钮 → 结构上无法跳转）；命中区与绘制矩形同源 `runPageLayout`。
  - 门禁：PRP 单测 28/28、Lab targeted 123/123、E2E PRP **89/89**、Lab E2E 148/148、tsc 0、五路构建 EXIT 0、repo-health 9/9。
    正式源码 0 修改。
- ⚠️ 已知既有抖动（**非本 Queue 回归**，已用排除实验证明）：全量 vitest 时
  `garageFusionResultInteractionR22.test.ts` 出现 5s 超时（负载相关；单跑 11/11 全绿；
  排除本 Queue 新增测试文件后该文件仍失败）。vitest 未设 `testTimeout`（默认 5s）。
- 边界：PRP-F0 不接正式 Roguelike 数值/Day 状态机/随机强化池/永久奖励/经济/存档；不改 Garage/Fusion；
  不继续 Arena A/B、不做俯视 Movement、不做正式敌人 AI、不做美术精修。

## 6. Next action
- **停等用户回执**（PRP-F0 已提交，禁止自动开 PRP-F1）：
  1. B1 三选项仍未裁决（B1-A 确认停止 / B1-B 放宽镜头边界 / B1-C Lab-only 缩小车）；
  2. 俯视 `WEAPON_CONTACT_THRESHOLD=0.5`（`contactRouter.ts:694`）是否单开 Queue；
  3. Run Page 演示装载是否确认用「西瓜重炮 × 追猎者」。
- Low-prio backlog: KNOWN-WX-COLD-BOOT-PREVIEW-SCALE-01；mobile drive slot（F-GARAGE-TOUCH-ASSEMBLY-R2）；
  strip-scroll no clamp；O1/O2 非阻塞优化项。
