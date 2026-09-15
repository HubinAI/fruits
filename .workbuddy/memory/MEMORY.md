# Fruits - Runtime Memory Index

**只有「不变量 + 陷阱 + 下一步」。** 公式 / 实测数字 / 逐帧时间线 / 普查过程一律不在这里。

| 要找什么 | 去哪 |
|---|---|
| 本轮 / 近日做了什么、实测数字 | `.workbuddy/memory/YYYY-MM-DD.md`（最新 `2026-09-16.md`） |
| 每个 Queue 的完整交付说明 | repo-root `交接文档_YYYY-MM-DD_<Queue>.md` |
| 本文件更早的完整版本 | `.workbuddy/memory/archive/MEMORY_FULL_*.md` |
| 项目级共识与边界（最高权威） | `最强水果_项目核心共识与开发边界_WorkBuddy_Memory.md` |

## 1. Identity / 链尾
- Repo `git@github.com:HubinAI/fruits.git` | dir `D:\0818new\最强水果`
- 当前分支 `prototype-portrait-battle-lab`（实验分支，可整块删除）；主线 `foundation-02-wechat`
- 原型正式名 **PRP｜Portrait Run Prototype**（PBL 旧名仅存 Debug Lab）
- **链尾**：`6fbf275` F1 → `c44239b` R5 → `ca3fb43` F2 → `1a3b080` F2-R1 → `896086b` F2-R2
  → `39f6af9` BUILD-01 → `8ac97a8` memory → `02becf7` RUN-R1 → `5c8b514`+`eda6ca9` BUILD-01-R1
  → `72c7315` memory → `e90da08` PBL-E2E-AUDIT-COMBO-LITERAL-FIX + `0fe782f` memory
  → `b485a6e`+`29045b0` BUILD-01-R2 → **`db8ad8c` BUILD-01-R3 强力后坐（一炮一后坐，删 charge，+memory 补正）**
- 全链对 `src/core|physics|render|player|platform` diff **恒为空**；唯一正式 gameplay 改动 =
  `src/battle/cannonBehavior.ts` 的**可选** `burstRounds`（默认 1，行为逐帧不变）。
  R5 相机复用靠 PRP 侧 viewport adapter，不碰 `src/render`。

## 2. Rules
- 1 Queue = 1 problem；先调查/复现、锁定根因后再改码；无静默扩范围。
- tech pass ≠ 落进运行时 ≠ 真人体验通过；体验由用户裁决，别让用户抓技术日志。
- 每条回复结尾写「用户需要回什么」。每条 Queue 完成后**停等**，绝不自动续下一条。
- PC 录屏常态化；手机录屏只用于大模块节点。
- 「一眼可辨」类验收：先找**相机追不平的物理通道**，再谈幅度；若不存在该通道就**如实上报失败**，不加提示掩盖。
- 发现的缺陷拆独立 Queue，**禁止混并入当前 scope**。

## 3. Git / build safety
- `git stash` **禁止**；git 异常先跑 `scripts/repo-health.js`（纯 ESM 库，无 CLI →
  `node --input-type=module -e "import {checkRepoHealth} from './scripts/repo-health.js'"`）。
- 禁 `reset --hard` / `checkout --` / 删 `.git` / 手改 refs / force-push 已交付。
- 单功能 commit + push + 核对 **HEAD = 本地 ref = `git ls-remote` = `.git/FETCH_HEAD`** 四路一致。
- ⚠️ `git commit -F <文件>` 必须用 **Windows 路径**（`D:/…`；`/tmp` git 读不到）；
  **不要**用 `git commit -m @'…'@`（bash 会把 here-string 首行塞进消息）。
- ⚠️ 本机 remote-tracking refs **无法落地** → 以 `git ls-remote` + `.git/FETCH_HEAD` 为权威；push 正常。
- Memory 并入功能 commit；**不单独提交 memory**（例外：纯 memory 补正可单独 commit）。
- vitest：cwd 盘符必须**大写** `/D/…`；全量 `--pool=vmForks --maxWorkers=1`；过滤器用**子串**。
- 本机 bash PATH 可能缺 `/usr/bin` → 命令前加 `export PATH="/usr/bin:/bin:$PATH"`。
- `交接文档_*.md` 是**本地件**，勿误提交；截图 / 日志落 `outputs/`（gitignored）。
- ⚠️ **同一文件的多条 Edit 不要并行发出**（后落盘覆盖前者 → 静默丢改动）；串行 + grep 复核。
- ⚠️ 用 `Write` 整体重写文件时，**别把被替换段落之外的注释头一起吃掉**（替换前先 Read 上下 10 行）。
- ⚠️ **id 改名 = 全通道同步**：`src` + `tests/*.ts` + `tests/*.cjs`（E2E 侧有自己镜像的字面量表）。

## 4. Stable contracts（改动前必读）
- DPR 只乘一次（logical→backing）；safe-area / capsule / hitArea 一律逻辑坐标。
- Player 舞台 844×390；Lab/PRP 舞台 **390×844**（四带：顶 80 / 舞台 302 / 日志 378 / 动作 84）。
- Viewport resume 只走 `syncWechatViewport`，无第二套 sizing 路径。
- E2E 句柄只在 `__E2E_INTERNAL_HANDLE__` 下；RC/web 排除；dev 下为 `false`（宏语义）→ 不是泄漏。
- hitArea 与绘制矩形**同源**（`computeFusionLayout` / `runPageLayout`）；E2E 命中域 = 逻辑舞台。
- **像素账本口径**：只登记「不承载文字、不被描边覆盖」的纯色平铺矩形；承载文字 / 描边的面改点位采样。
  ⚠️ 含**缩放位图**时只能登记远离它的平涂面。
- **入口唯一性**：唯一玩家入口 = 根路径 `/`，由 dev-only 插件 `build/branchDevEntry.ts`（`apply:'serve'`）
  重写到 `/run-page.html`；`portrait-lab.html` = DEBUG ONLY、`index.html` = 正式横屏。
  ⚠️ `vite.config.ts` 两条守卫：R23 禁 `portrait-lab|portraitBattleLab`；RP-27 禁 `run-page|runMain`
  → dev 默认入口逻辑只能放 `build/branchDevEntry.ts`。
- `vite.portrait-lab.config.ts` 用 `emptyOutDir:false` → `dist-portrait-lab/` **累积旧 chunk**（gitignored）
  → 隔离断言必须从 `run-page.html` 取**真实引用**。
- **判定正式行为要查测试，别信注释**：正式相机口径唯一定义在 `tests/battleDynamicFramingR21.test.ts`。
- **Lab 源码守卫（必须尊重，不是绕过）**：
  - `R22a-4`（`tests/portraitBattleLab.test.ts`）：**正式编排器只允许 `runBattleRuntime.ts` import**；
    `ALLOWED_RELATIVE_IMPORTS` 是闭集且**要求每条都被真实命中**（死配置会 FAIL）
    → 能力 / 辅助模块只能拿**极窄端口**（PRP 侧 `RunAbilityPorts`）。
  - `G1-08`：`arenaConditionLines()` 只豁免左侧为 `team|winner|loser|vehicle|snapshot|projectile|side|driver`
    的比较行 → ⚠️ **`ev.source !== 'A'` / `ev.target !== 'B'` 会被误判成 arena 分叉**（`ev.team !== 'A'` 不会）
    → 用 `const PLAYER_TEAM: RunTeamId = 'A'`。
- ⚠️ **开火节奏只能按 `weaponFire` 事件量，不能按弹丸数增量**（命中与下一发常同步 → 净变化 0 → 漏计）。
  本演示只有玩家（team `A`）开火，敌方无炮。
- ⚠️ **强化图标判据用「盒内面积统计」**（probe `choiceOptions[].iconRect` 与绘制同源）；中心单点采样必然假红。
- ⚠️ 分带线必须画在下一条带**首行** `band.y`；画在 `band.y − 1` 会吃掉 `road` 最底一行。
- **给用户的启动指令必须两行连给**：`cd D:\0818new\最强水果` 然后 `npm run dev`。

## 5. Current truth（只留承载不变量的关键事实）
### 5.1 正式战斗参数（PRP-F1）
- `runBattleRuntime.ts` / `runBattleView.ts`：离屏 canvas 上**零修改复用**正式 `Renderer` + `drawImage` 合成。
- world **1600×900** / groundY **700** / spawnA `{400,640,1}` / spawnB `{1200,640,−1}`（中心距 800）/
  Cannon `cd 1000 · muzzle 8 · dmg 80 · R 10 · mass 1 · recoil 30`。**PRP 构造传空 config `{}`（零覆盖）**。
- ⚠️ probe 坐标系**不对称**：`'idle'` 绝对坐标；`'battle'` 带内相对（pixel 采样要 +`bands.stage.y`）。
- ⚠️ 车辆 sprite 特征色必须**色族匹配**（tol 16）；菠萝无 PNG → 用**三色互斥**判据。
- 验证对手 = **`ProtoRusher`**（`R1-RUSH-02` 菠萝冲刺车，敌 HP 1000）；**演示三场全部用它**。
  ⚠️ **选型普查必须走生产同构链路**（漏 `RunBuildAbilities` 会低估压力）。

### 5.2 正式 Battle Camera（PRP-R5）——**可感知性的第一约束**
- 口径 = 逐帧 `reframe(snap,'battle',{phase})` → `battleCam` → `render()` 内逐帧 `applyBattleFollow`。
  节奏 `shouldReframeBattleCamera = phase !== lastPhase || phase === 'Active'`。
- `applyBattleFollow` = 取**双方 envelope** → `midX` 居中 + `offsetX` 0.2/帧平滑 + 左界 clamp
  （世界 x=0 不露白）+ `offsetY` 补偿使地面线恒定。
- ⚠️ **头号陷阱**：相机跟的是**双方中点**，所以**玩家与敌车的位移会互相抵消**。
  「玩家被后坐推退」+「敌车冲刺前进」≈ 不变 ⇒ **屏幕位移 ≈ 0，哪怕世界位移很大**。
  ⇒ 任何「让玩家/敌方看起来移动」的设计，**必须先算相机追平后的净量**，别拿世界 px 当判据。
- viewport adapter：离屏视口 = 舞台带 + inset×2 = 502×358 → 正式安全区**恰好等于**舞台带 390×302（原点 56,28）。
- ⚠️ 视图层**绝不写** `this.renderer.transform =`。
- ⚠️ 结束态（`result !== null`）**不再 reframe、不再重画离屏战场** → 保住「RESULT = 战场冻结」。
- ⚠️ **`Warning` 阶段相机按设计冻结**（只 Active 逐帧 reframe）→ 「全程都在带内」的断言必须**分阶段**写。

### 5.3 强化接缝（F2 → BUILD-01）
- **接缝 = Run-local overlay registry**：`createRegistry()` 造副本 → 注册 `run.mod.<id>` → 本局快照武器
  `defId` 重映射。正式 `content.ts` / registry 单例 / `ContactRouter` / `Orchestrator` **零修改**。
- 两层 Build：改武器的项按选择顺序**浅合并** `behaviorParams`；能力类项**不改武器 def**。
  第二层条件池 `RUN_LAYER2_POOLS`（每层 3 选 1，由第一层决定）：`heavyShell → [kineticBurst, emergencyRepair,
  fastReload]`、`twinCannon → [tripleLoad, …]`、`fastReload → [strongRecoil, …]`。
- 第一层冻结值（**真人已通过，不得再调**）：重型弹头 `radius 16/mass 4/recoil 90`（damage 不动）/
  双联炮 `burstRounds 2/burstIntervalMs 100` / 快速装填 `cooldownMs 650`。
- 能力类接缝：`PlanckBattleOrchestrator.onCombatEvent` + `WeaponFireEvent` / `DamageEvent`
  （含 `worldDirection` / `worldPosition` / `relativeVelocity` / `damageSource` / `contactPoint`）
  + `world.applyLinearImpulse(body, impulse, point)`（`point` = **世界作用点**）。
- ⚠️ **冲量在步边界施加**：回调只入队 → `RunBattleRuntime.step()` 在 `orchestrator.step` **之前** `flush()`；
  `result` 非空时丢弃。⇒ 冲量落在**下一次** `rt.step`（`dvx` 要比 `next − base`）。
- ⚠️ `world.getLinearVelocity(body)` 在开火帧跃变 ≈ +0.02 → **看不到冲量；位置差分才可靠**。
  实测换算：`Δv ≈ 冲量 / 200`（世界 px/帧）⇒ 110 冲量 = 基础后坐(30) 的 3.67×。
- **跨战斗耐久**：`PlanckVehicle.hp` 可写、`maxHp` 独立 → **只写 `hp`**。
  ⚠️ `initialPlayerHp` 必须是**构造时捕获的 readonly 字段**，不能是实时读 `vehicleA.hp` 的 getter。
- **关键缺口**：`FunctionalInstall` **只有 `star`、没有 `overrides`**（Movement 有）→ 将来「运行期改 Weapon
  任意字段」的最小 Foundation 补正 = 补 `overrides?: Partial<FunctionalPartDef>`。
- ⚠️ **胜负余量极窄 + 强混沌**：只适合「方向可见」验证，**不适合数值微调对比**
  （实测同一参数下末场残血非单调：60→506 / 80→582 / 100→614 / 110→554 / 120→622）。

### 5.4 PRP-RUN-R1
- `finishRunBattle` 先算 `battlesCompleted` 再判 `playerHp <= 0` → 直接 `FAILED`（**不经过 RESULT**）；
  `FAILED` 下 `pressRunAction` 唯一动作 = `createRunPageState()`；`runCarriedPlayerHp` 在「上一场已结束」时
  **恒返回一个数**（死亡 → 0）。`runStartsNewRun()` 是「继续当前 Run」vs「重新开始」的唯一判据。
- ⚠️ 两条「测量口径失效」教训：①「后坐让车身净后移」只在重型对手下成立 → 改「质量无关」的**开火帧位移凹陷**；
  ②「整场最负 vx」量到的是**接触推挤**。

### 5.5 能力类强化的三条物理结论（R1 → R2 → R3 逐轮证伪出来）
1. **作用在质心 → 只产生平动 → 被相机追平**（世界 +20.7px → 带内 1~4px；R2 复现：退 20~32px → 带内 3~5px）。
   ⇒ 想被看见必须**换作用点或换通道**，不是加力。
2. **扭矩是唯一相机追不平的通道，但重的玩家车几乎不转**：决定性实验 3000 冲量 → 一步 −4.56°；
   换算到 110~450 只有 **0~1.2°** ⇒ 玩家侧不能靠扭矩（轻的敌车可以，R1 就是这么过的）。
3. **改成「每 N 发蓄满一次」= 引入不可见状态 ⇒ 真人判失败**（R2 的 450 物理生效但读不出因果）。
   ⇒ 自然因果优先于幅度：**一炮一后坐** 胜过「每 3 发一次强后坐」。
- 命中反馈 `runImpactVfx.ts`：纯几何 / 无 DOM / 无时间源（node 可冻结断言）；280ms 两道细环 + 140ms 核心亮点。
  触发 = `kineticHits` **计数增加**；位置 = `lastKineticHit`（与冲量作用点**同源**）。
  ⚠️ `impactMark` **过期即清空**；绘制在 `blit` 之后、**分带线之前** + `clip` 到舞台带 → 不污染入账面积。

### 5.6 PRP-BUILD-01-R3 强力后坐（本次交付）
- 口径 = **一炮一后坐**：每次真实 `weaponFire` → 一次追加冲量（方向 = 炮口方向**取反**，作用点 = **真实炮口**）。
  旧 `recoilCharge` id 与 `RECOIL_CHARGE_THRESHOLD/IMPULSE` **整条删除**（无计数、无阈值、无「第 N 发」）。
  `STRONG_RECOIL_IMPULSE = 110`。UI 只做**最小语义同步**：字形改「炮口 + 向后箭头」（盒位/尺寸/颜色冻结）。
- ⚠️ **决定性新事实**：110 冲量 = 每炮 **6~10 世界 px** 后移（相机链实测），
  但敌车冲刺同时前进 ⇒ **屏幕只动 1~3 带 px**。「一炮一后坐」在物理上真实、**在屏幕上几乎不可见**。
- ⚠️ **上界由「保留真实接敌」先夹住，而不是越界**：120 时第三场**零挨打**（= Queue 禁止的「无法接敌」）；
  130/140/150 把玩家推到左缘（`bandX<0` 越界）并**在末段被后坐打死**（HP 0）。
  ⇒ 选 110 的理由是「末场仍留 4 次真实接触（比 R2 已验收的 2~3 次还多）」。

## 6. Next action
- **BUILD-01-R3 已交付并停等**（基线 `29045b0`）。**按指令停止，不自动续下一 Queue。**
- **真人批量验收进度**：`重型弹头→动能爆发` ✅冻结 · `双联炮→三连装填` ✅冻结 ·
  `快速装填 → 强力后坐`（R2 的「反冲蓄能」已废弃）**待第三次裁决**。口径（正常速度、不看 Buff 文字）：
  第一层 =「它射得很快」；第二层 =「**而且每开一炮，它都会明显把自己往后踹**」。
  ⚠️ 若仍只能看出「射得快」→ **这条方向判失败，不再放大数值**（已写在 Queue 里）。
- ⚠️ 已归档但未裁决：`FAILED` 失败终态页面观感；低压对手下「先选择 → 再条件选择 → 最终真实战斗」
  是否让玩家看出**这辆车形成了一个方向**。
- ⚠️ 本轮**未覆盖**：新图标字形没有 node 侧几何测试（E2E 的选项序列里不含该选项）—— 待需要时补。
- **PRP-R3 / F1 / R5 / F2 / F2-R1 / F2-R2 / BUILD-01 / RUN-R1 / BUILD-01-R1 / R2 / R3 录屏回执未全部归档**
  （本分支唯一未闭环项）。
- **PRP-R5 遗留裁决**（若真人仍嫌车小）：adapter 口径开局 69·84px / 峰值 172·190px 是否可感知。
  **禁止**无授权新增 PRP 专属 dynamic zoom / 镜头震动 / Kill zoom —— **恢复旧模式，不发明新模式**。
- 未裁决挂起：俯视 `WEAPON_CONTACT_THRESHOLD=0.5`（`contactRouter.ts:694`）是否单开 Queue。
- Low-prio backlog：`tests/_e2e_portrait_battle_lab.cjs` 的 `[iso] I2` 仍用 `readdirSync().find()`；
  KNOWN-WX-COLD-BOOT-PREVIEW-SCALE-01；mobile drive slot（F-GARAGE-TOUCH-ASSEMBLY-R2）；strip-scroll no clamp。
- 既有抖动（**非 Queue 回归**）：全量 vitest 时 `garageFusionResultInteractionR22.test.ts` 偶发 5s 超时。
