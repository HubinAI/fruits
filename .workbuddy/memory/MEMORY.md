# Fruits - Runtime Memory Index

Detail → `.workbuddy/memory/YYYY-MM-DD.md` / repo-root `交接文档_*.md`
Authority: `最强水果_项目核心共识与开发边界_WorkBuddy_Memory.md`
（本文件只留**不变量 + 陷阱 + 下一步**；公式 / 账本数字 / 逐帧时间线 / 冻结实测值一律看 daily log 与交接文档。）

## 1. Identity / 链尾
- Repo `git@github.com:HubinAI/fruits.git` | dir `D:\0818new\最强水果`
- 主线 `foundation-02-wechat`；实验分支 `prototype-portrait-battle-lab`（可整块删除）
- 原型正式名 **PRP｜Portrait Run Prototype**（PBL 旧名仅存 Debug Lab）
- **PRP 链尾**：`6fbf275` F1 接入正式侧视 Planck 战斗 → `c44239b` R5 恢复正式 Battle Camera
  → `ca3fb43` F2 首个强化闭环 → `1a3b080` F2-R1 单变量收紧 + Cannon 真实 burst
  → `896086b` F2-R2 快速装填 400→650 → `39f6af9` BUILD-01 两层 Cannon Build
  → `8ac97a8` memory backfill → **`02becf7` PRP-RUN-R1 死亡即失败 + 单一耐久贯穿三场（本次交付）**。
- 历史事实：PRP-F1 之前 PRP 战斗区**没有物理**（纯演示脚本）。全链对
  `src/core|physics|render|player|platform` diff **恒为空**；唯一正式 gameplay 改动 = `src/battle/cannonBehavior.ts`
  的可选 burst。R5 的相机复用靠 PRP 侧 viewport adapter，不碰 `src/render`。

## 2. Rules
- 1 Queue = 1 problem；先调查/复现、锁定根因后再改码；无静默扩范围。
- tech pass ≠ 落进运行时 ≠ 真人体验通过；体验由用户裁决。
- 命令自带语境；每条回复结尾写「用户需要回什么」。每条 Queue 完成后**停等**，绝不自动续下一条。
- PC 录屏常态化；手机录屏只用于大模块节点。

## 3. Git / build safety
- `git stash` **禁止**；git 异常先跑 `scripts/repo-health.js`（纯 ESM 库，无 CLI →
  `node --input-type=module -e "import {checkRepoHealth} from './scripts/repo-health.js'"`）。
- 禁 `reset --hard` / `checkout --` / 删 `.git` / 手改 refs / force-push 已交付。
- 单功能 commit + push + 核对 local=ref=remote。RC 需 clean HEAD，badge/rc-build.json/runtimeInfo/HEAD 四方一致。
- ⚠️ 本机 remote-tracking refs **无法落地**（`.git/refs/remotes/` 恒空）→ 以 `git ls-remote` +
  `.git/FETCH_HEAD` 为权威；push 正常；不要为此改 refs。
- Memory 并入功能 commit；**不单独提交 memory**（例外：纯 memory 补正）。
- ⚠️ `git commit -F <文件>` 必须用 **Windows 路径**；**不要**用 `git commit -m @'…'@`（bash 会把首行塞进消息）。
- vitest：cwd 盘符必须**大写** `/D/…`（小写 → 模块图双实例 → 持久化测试静默假失败）；
  全量 `--pool=vmForks --maxWorkers=1`；`--reporter=basic` 不支持；过滤器用**子串**。
- 本机 bash PATH 可能缺 `/usr/bin` → 命令前加 `export PATH="/usr/bin:/bin:$PATH"`。
- `交接文档_*.md` 是**本地件**，勿误提交；截图交付落 `outputs/`（gitignored）。

## 4. Stable contracts
- DPR 只乘一次（logical→backing）；safe-area / capsule / hitArea 一律逻辑坐标。
- Player 舞台 844×390；Lab/PRP 舞台 **390×844**（顶 80 / 舞台 302 / 日志 378 / 动作 84）。
- Viewport resume 只走 `syncWechatViewport`，无第二套 sizing 路径。
- E2E 句柄只在 `__E2E_INTERNAL_HANDLE__` 下；RC/web 排除；dev 下为 `false`（宏语义）→ 不是泄漏。
- hitArea 与绘制矩形**同源**（`computeFusionLayout` / `runPageLayout`）；E2E 命中域 = 逻辑舞台。
- **像素账本口径**：只登记「不承载文字、不被描边覆盖」的纯色平铺矩形；含**缩放位图**时只能登记远离它的平涂面。
- **入口唯一性（R2 起）**：唯一玩家入口 = 根路径 `/`，由 dev-only 插件 `build/branchDevEntry.ts`
  （`apply:'serve'`）重写到 `/run-page.html`；`portrait-lab.html` = DEBUG ONLY、`index.html` = 正式横屏。
- ⚠️ `vite.config.ts` 两条守卫：R23 禁 `portrait-lab|portraitBattleLab`；RP-27 禁 `run-page|runMain`
  → dev 默认入口逻辑只能放 `build/branchDevEntry.ts`。
- `vite.portrait-lab.config.ts` 用 `emptyOutDir:false` → `dist-portrait-lab/` 会**累积旧 chunk**（已 gitignore）。
- **判定正式行为要查测试，别信注释**：正式相机口径唯一定义在 `tests/battleDynamicFramingR21.test.ts`。
- **Lab 源码守卫（必须尊重，不是绕过）**：
  - R22a-4：**正式编排器只允许 `runBattleRuntime.ts` import**；`ALLOWED_RELATIVE_IMPORTS` 是闭集且
    **要求每条都被真实命中**（死配置会 FAIL）→ 能力/辅助模块改用**极窄端口**（PRP 侧 `RunAbilityPorts`）。
  - G1-08：`arenaConditionLines()` 只豁免左侧为 `team|winner|loser|vehicle|snapshot|projectile|side|driver`
    的比较行 → ⚠️ **`ev.source !== 'A'` / `ev.target !== 'B'` 会被误判成 arena 分叉**（`ev.team !== 'A'` 不会）
    → 用 `const PLAYER_TEAM: RunTeamId = 'A'`。
- **给用户的启动指令必须两行连给**：`cd D:\0818new\最强水果` 然后 `npm run dev`。
- ⚠️ **同一文件的多条 Edit 不要并行发出**（后落盘覆盖前者 → 静默丢改动）；必须串行并 grep 复核。
- ⚠️ **开火节奏只能按 `weaponFire` 事件量，不能按弹丸数增量**（命中与下一发常同步 → 净变化 0 → 漏计）。
  本演示只有玩家（team `A`）开火，敌方无炮。
- ⚠️ **图标判据用「盒内面积统计」**（probe `choiceOptions[].iconRect` 与绘制同源）；中心单点采样必然假红。

## 5. Current truth（已冻结历史细节全在 daily log / 交接文档）

### 5.1 Pipeline 与 PBL 时代
- Lab 结构：入口 `portrait-lab.html` + `src/lab/portraitBattleLab/` + `vite.portrait-lab.config.ts`。
- 不变量：正式 src/ 全树 + 正式入口 + 4 个正式构建配置 **0 引用** `portraitBattleLab|portrait-lab`；
  数值一律 `buildSnapshotFromDraft → validateSnapshot → resolveSnapshot`，正式库缺件 → **unavailable，不造数值**。
- 陷阱：①实例 group 必须取 `-(100+i)`；②⚠️ **禁复用 `PlanckArenaRuntime`**（无条件建刺墙 + hazard，无开关）；
  ③`PBL_ARENA_RUNTIMES` 是**可用性唯一来源**，blocked 时 `plan=null` 绝不 Start，DOM 面板必须在 canvas 外。
- PBL-B1 停止结论：390 宽舞台横向接敌轴仅 **366px**，1v1 整车总宽 **410–498** → 竖屏侧视是几何硬约束。

### 5.2 PRP 页面基线
- **整个单局 = 一个持续存在的竖屏 Adventure Run Page**；战斗是**玩家左·敌人右的侧视**；全 canvas 单页。
- 顶部无「核心构建 X/5」、无固定空槽；强化行**只画实际已获得的**（`RUN_BUFF_ICON_MAX=5`）；`runBuffIconRects(0) === []`。
- **IDLE 待机近景**：`runSideViewScale = 0.7722…`；`groundInsetPx=52 → groundY=330`。
- **零纯色占位纪律**：可视件必须带正式 `visualId`，资源未就绪**整件不画**。
- **日志 = 纯自然语言**：`RunLogKind` 六值 + `formatRunLog(e)=>e.text`（恒等）→ 结构上吐不出方括号前缀。
- ⚠️ **sprite 重采样污染等色面积**：禁用态动作条改 probe 点位采样，勿入纯色账本。
- ⚠️ 分带线必须画在下一条带**首行** `band.y`；画在 `band.y−1` 会吃掉 `road` 最底一行。
- ⚠️ **E2E 隔离断言空转陷阱**：`dist-portrait-lab/` 累积旧 chunk → 「按前缀挑第一个 chunk」读到**过期产物**
  使断言恒真 → 必须从 `run-page.html` 取**真实引用**；不可断言「目录零残留」。
- ⚠️ 既有抖动（**非 Queue 回归**）：全量 vitest 时 `garageFusionResultInteractionR22.test.ts` 偶发 5s 超时。

### 5.3 PRP-F1 战场接入
- `runBattleRuntime.ts` / `runBattleView.ts`（离屏 canvas 上**零修改复用**正式 `Renderer` + `drawImage` 合成）。
- 正式 Battle 参数（唯一数值来源）：world **1600×900** / groundY **700** / spawnA `{400,640,1}` /
  spawnB `{1200,640,−1}`（中心距 **800**）/ Cannon `cd 1000 · muzzle 8 · dmg 80 · R 10 · mass 1 · recoil 30`。
  **PRP 构造传空 config `{}`（零覆盖）**。
- ⚠️ 复用坑：①**probe 坐标系不对称**（`'idle'` 绝对坐标；`'battle'` 带内相对，pixel 采样 **要** +`bands.stage.y`）；
  ②真实战斗不能单点采样 → 窗口累积观测；③车辆 sprite 特征色必须**色族匹配**（tol 16；banana `240/192/48`、
  watermelon `48/128/48`），判据 =「在该车自己外廓内计数 + 两车交叉命中 = 0」；④EVENT 起 `ground/road` 不登记，
  `LEDGER_TOLERANCE_DEFAULT = 8`；⑤压缩产物正向证据 = 可达 chunk 图 + 压缩存活标记。

### 5.4 PRP-R5 正式 Battle Camera
- **正式相机口径 = 逐帧 `reframe(snap,'battle',{phase})` → 私有 `battleCam` → `render()` 内逐帧
  `applyBattleFollow` → `this.transform`**。锚点：①Active 三段 span `0.87/0.75/0.60`；②follow「分离才拉远、
  接近不放大」+ offset clamp + 地面线零位移；③阻尼 1.5%/帧、死区 0.003、地面线锚定视口 0.68–0.72。
- **viewport adapter**：离屏视口 = 舞台带 + inset×2 = **502×358** → 正式安全区**恰好等于**舞台带 390×302
  （原点 56,28），合成时 9 参 `drawImage` 只裁安全区一块。前提 `isCompactLandscape(502,358)=false`。
- 节奏 `shouldReframeBattleCamera = phase!==lastPhase || phase==='Active'`。视图层**绝不写 `this.renderer.transform =`**。
  ⚠️ 非 Active 逐帧 reframe 会与 `applyBattleFollow` 拉扯（0.4%/帧抖动）。
  ⚠️ 结束态（`result !== null`）**不再 reframe、不再重画离屏战场** → 保住「RESULT = 战场冻结」。

### 5.5 强化接缝（F2 → F2-R1 → F2-R2 → BUILD-01）
- **Modifier 接缝 = Run-local overlay registry**（唯一；是正式既有范式的复用）：`createRegistry()`（每次全新实例）
  造副本 → 注册 `run.mod.<id>` → 本局快照武器 `defId` 重映射。正式 `content.ts` / registry 单例 / `ContactRouter` /
  `Orchestrator` 零修改。证据链见 `交接文档_2026-09-12_PRP-F2.md` 与 `runModifiers.ts` 文件头。
- **两层 Build 组合**：改武器的项按选择顺序**浅合并** `behaviorParams` 成确定性 overlay 部件；
  `runBuildDefId(build)` = `run.mod.<a>+<b>`，无改武器项 → `null` 不重映射。能力类项**不**改武器 def。
- 第一层冻结值：重型弹头 `radius 16 / mass 4 / recoil 90`（damage 不动）/ 双联炮 `burstRounds 2 /
  burstIntervalMs 100` / 快速装填 `cooldownMs 650`。**真人已通过，不得再调**。
- 第二层：`tripleLoad` / `kineticBurst`（`KINETIC_BURST_GAIN × projectileMass × relativeVelocity`，不写死专属伤害）/
  `recoilCharge`（真实 recoil 事件蓄力 → 前向冲量，**禁止定时器**）/ `emergencyRepair`（`repairBonus`，
  **不改写** `battle.playerHp`）。条件池 `RUN_LAYER2_POOLS` 由第一层决定，每层 3 选 1。
- **能力类接缝**：①`PlanckBattleOrchestrator.onCombatEvent`（`:413`）是公开订阅口；②`WeaponFireEvent`
  （每次开火恰好一次）与 `DamageEvent`（`combatEvents.ts:36`，含 `relativeVelocity` / `damageSource`）是正式既有事件；
  ③`world.applyLinearImpulse` 是正式 Cannon 自己就在用的公开 API（`cannonBehavior.ts:363`）。
- ⚠️ **冲量步边界施加**：`damage` 在 `world.step` 接触回调链里发出 → 回调内只**入队**，
  `RunBattleRuntime.step()` 在 `orchestrator.step` **之前** `abilities.flush()`（延迟 ≤1 步）；`result` 非空时丢弃。
- **能力模块 = 端口，不是编排器**：`runBuildAbilities.ts` 只看 `RunAbilityPorts`；`readRunProjectileMass(orchestrator)`
  留在 `runBattleRuntime.ts`。原因 = §4 的 R22a-4 守卫。
- ⚠️ **条件池第三格复用第一层定义 → `role` 是 `'base'` 不是 `'pivot'`**（转向语义由**槽位**表达）。
- **账本随 day 变化**：三场两选使同一 phase 出现在 DAY 3/4/5 → 顶部节点 `384/512 → 512/384 → 640/256`
  （总量恒 896）、强化图标 `0 → 1 → 2` 个 → E2E 静态表已改 `ledgerExpect({day,stage,buffs,action,masked})` 生成。
- **关键缺口**：`FunctionalInstall` **只有 `star`、没有 `overrides`**（Movement 有）。将来「运行期改 Weapon 任意字段」
  的最小 Foundation 补正 = 补 `overrides?: Partial<FunctionalPartDef>`。
- **Cannon 最小 burst**（⚠️ 本分支唯一正式 gameplay 改动）：新增**可选** `burstRounds`（默认 1）/
  `burstIntervalMs`（默认 0），走 `optNum`（缺失/非法 → 默认）；6 个基准参数仍「缺失即抛错」→ 正式 `content.ts`
  零字段新增，默认行为**逐帧不变**。`stepFixed` = 连发间隔 → 主冷却 → `emitRound()`（冷却只在最后一发之后计时）。
- ⚠️ **胜负余量极窄**：只适合「方向可见」验证，**不适合数值微调对比**。
- **跨战斗耐久**：`PlanckVehicle.hp` 可写、`maxHp` 独立 → **只写 `hp`**；`BattleConfig` 里没有 HP 字段。
  ⚠️ `initialPlayerHp` 必须是**构造时捕获的 `readonly` 字段**，不能是实时读 `vehicleA.hp` 的 getter（会假红）。

### 5.6 PRP-RUN-R1 死亡与耐久连续性（已交付 `02becf7`）
- 缺陷：`finishRunBattle` 是唯一战斗出口却**从不检查真实 Player HP** + `runCarriedPlayerHp`
  把「0 HP」与「还没打过」压成同一个 `null` → `carried ?? ctx.playerHpMax` 把 0 HP 读成满耐久
  → 死亡后仍进 CHOICE / DAY 推进。
- 修复：①`finishRunBattle` 先算 `battlesCompleted` 再判 `playerHp <= 0` → 直接 goPhase `FAILED`
  （**不经过 RESULT**，日志只两行、不含「改装机会」）；②`FAILED` 下 `pressRunAction` 唯一动作 =
  `createRunPageState()`；③`runCarriedPlayerHp`「上一场已结束」时**恒返回一个数**（死亡 → `0`），
  `null` 只剩「本次遭遇还没打过」一个含义。绘制层**零改动**（FAILED 与 RESULT 同形）。
- `RunPhase` 5→6 值（新增 `FAILED`）；新增 `runFailed()` / `runStartsNewRun()`（`FAILED ||
  (RESULT && runVerificationComplete)`）= 「继续当前 Run」vs「重新开始新 Run」的唯一可观测判据。
- **Build Prototype Encounter = `ProtoRusher`（`R1-RUSH-02`，菠萝冲刺车，敌 HP 1000）**：装进既有 Lab 目录的
  第 4 条 encounter，只**引用**既有正式对手模板（`draft` 逐字段等于 `official.draft`），无任何正式数值修改。
- 选型依据（两轮普查）：轮 1 = 49 套正式模板各一场（仅 12 存活；旧 `Chaser` 第一场剩 269.78/1100 ≈ 24.5%，
  `RangedTurret` 第一场就死）；轮 2 = 6 套存活低压 × 9 组合**带 `RunBuildAbilities`**（`OPP-20` 0/9、`OPP-29` 7/9、
  `OPP-14` 8/9、`OPP-35` 8/9、`OPP-31` 9/9 但是沙包、`R1-RUSH-02` **9/9 且终局仍是对打**）。
  ⚠️ **普查必须走生产同构链路**（漏 `RunBuildAbilities` 会低估压力 → 曾误判 OPP-14）。
- 三场路线 ΔHP（已冻结在 `portraitRunPage.test.ts` RP-F2-14）：`heavyShell+kineticBurst` 843/714/537、
  `twinCannon+tripleLoad` 843/678/470、`fastReload+recoilCharge` 843/622/350。
- 换对手引起的连锁：`enemyHpMax` 900→1000、encounter 目录 3→4 项、开局 gap 529→**563.66**、
  首次命中 132→**129**、首次接触 157→**147**、整场 921→**841** 帧、余量 269.78(25%)→**843.05(77%)**、
  开局 scale 0.3310→**0.3408**、峰值变焦 2.74×→**1.944×**、E2E `R17b` 敌人特征色 香蕉→**菠萝**。
- ⚠️ **换对手暴露两处「测量口径失效」（可复用教训）**：
  ①`portraitRunBattle` PB-06「后坐让车身净后移」**只在重型对手下成立**（靠对手把人顶回去）
  → 改「质量无关」的**开火帧位移凹陷**（13/13 可测，0.111~0.153；开火帧剖线 0.146→**0.0073**）；
  ②`portraitRunModifier` RP-MOD-02「整场 chassis 最负 vx」量到的是**接触推挤**（最负值落在非开火帧）
  → 同口径改法：base 0.0640 vs heavy 0.2651（**4.14×**）。
  ⚠️ **`world.getLinearVelocity(body)` 的开火帧跃变 ≈ +0.02（正）→ 看不到冲量**；位置差分才可靠。
- ⚠️ **开火节奏只能用 `weaponFire` 事件，绝不能用「弹丸数增量」**（本遭遇真实 15 次只数到 3 次；
  `projCount>0` 全 842 帧仅 38 帧且全在前 128 帧，与开火 0/60/120 严格 1:1；接触后一发都进不了快照）。
- 另：弹丸**真实弹道下坠**，开局 564 px 外前两发落地，第 3 发才命中（首次命中恰掉 **80** = 单发值）。

## 6. Next action
- **PRP-RUN-R1 已交付并停等**（`02becf7`，基线 `8ac97a8`，16 文件 / +973 −278，单功能 commit + push）。
  必改 1/2/3/4 + 验收 1~5 全部完成；**按指令停止，不继续修改 Build 表现**。
- **待真人录屏裁决（两条）**：
  ①`FAILED` 失败终态页面的观感（只显示失败 Day / 最终 Build / 重新开始验证，不自动恢复耐久）；
  ②低压验证对手下「第一次选择 → 第二次条件选择 → 最终真实战斗」是否仍让玩家看出**这辆车形成了一个方向**。
  判定口径：**不看顶部文字/图标**，只看最终战斗。
- ⚠️ **需真人确认的既存余量问题已实质缓解**（PRP-RUN-R1 换低压对手后）：第一场 1100→843（77%），
  三场可打完（678 / 470），不再出现「强化后那场看不到赢」。**Queue 仍禁止调参。**
- **PRP-R5 遗留裁决**（若真人仍嫌车小）：adapter 口径开局 69·84px / 峰值 172·190px 是否可感知。
  候选（均需重新授权）：调大 `RUN_BATTLE_VIEW_INSET` 或分段取景。**禁止**无授权新增 PRP 专属
  dynamic zoom / 镜头震动 / Kill zoom —— **恢复旧模式，不发明新模式**。
- 未裁决挂起：俯视 `WEAPON_CONTACT_THRESHOLD=0.5`（`contactRouter.ts:694`）是否单开 Queue。
- **PRP-R3 / F1 / R5 / F2 / F2-R1 / F2-R2 / BUILD-01 / RUN-R1 八轮电脑录屏真人回执仍未全部归档**
  （本分支唯一未闭环项）。
- Low-prio backlog：`tests/_e2e_portrait_battle_lab.cjs` 的 `[iso] I2` 仍用 `readdirSync().find()`；
  KNOWN-WX-COLD-BOOT-PREVIEW-SCALE-01；mobile drive slot（F-GARAGE-TOUCH-ASSEMBLY-R2）；strip-scroll no clamp。
  **Foundation 补正候选**：给 `FunctionalInstall` 补 `overrides`。
