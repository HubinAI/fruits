# Fruits - Runtime Memory Index

**只有「不变量 + 陷阱 + 下一步」。** 公式 / 实测数字 / 逐帧时间线 / 普查过程一律不在这里。

| 要找什么 | 去哪 |
|---|---|
| 本轮 / 近日做了什么、实测数字 | `.workbuddy/memory/YYYY-MM-DD.md`（最新 `2026-09-13.md`） |
| 每个 Queue 的完整交付说明 | repo-root `交接文档_YYYY-MM-DD_<Queue>.md` |
| 本文件更早的完整版本 | `.workbuddy/memory/archive/MEMORY_FULL_*.md` |
| 项目级共识与边界（最高权威） | `最强水果_项目核心共识与开发边界_WorkBuddy_Memory.md` |

## 1. Identity / 链尾
- Repo `git@github.com:HubinAI/fruits.git` | dir `D:\0818new\最强水果`
- 当前分支 `prototype-portrait-battle-lab`（实验分支，可整块删除）；主线 `foundation-02-wechat`
- 原型正式名 **PRP｜Portrait Run Prototype**（PBL 旧名仅存 Debug Lab）
- **链尾**：`6fbf275` F1 战场接入 → `c44239b` R5 相机 → `ca3fb43` F2 → `1a3b080` F2-R1
  → `896086b` F2-R2 → `39f6af9` BUILD-01 → `8ac97a8` memory → `02becf7` RUN-R1
  → **`5c8b514` + `eda6ca9` BUILD-01-R1（本次交付）**
- 全链对 `src/core|physics|render|player|platform` diff **恒为空**；唯一正式 gameplay 改动 =
  `src/battle/cannonBehavior.ts` 的**可选** `burstRounds`（默认 1，行为逐帧不变）。
  R5 相机复用靠 PRP 侧 viewport adapter，不碰 `src/render`。

## 2. Rules
- 1 Queue = 1 problem；先调查/复现、锁定根因后再改码；无静默扩范围。
- tech pass ≠ 落进运行时 ≠ 真人体验通过；体验由用户裁决，别让用户抓技术日志。
- 每条回复结尾写「用户需要回什么」。每条 Queue 完成后**停等**，绝不自动续下一条。
- PC 录屏常态化；手机录屏只用于大模块节点。
- 「一眼可辨」类验收：先找**相机追不平的物理通道**（旋转 / 扭矩），再谈幅度。
- 发现的缺陷拆独立 Queue，**禁止混并入当前 scope**。

## 3. Git / build safety
- `git stash` **禁止**；git 异常先跑 `scripts/repo-health.js`（纯 ESM 库，无 CLI →
  `node --input-type=module -e "import {checkRepoHealth} from './scripts/repo-health.js'"`）。
- 禁 `reset --hard` / `checkout --` / 删 `.git` / 手改 refs / force-push 已交付。
- 单功能 commit + push + 核对 **HEAD = 本地 ref = `git ls-remote` = `.git/FETCH_HEAD`** 四路一致。
  RC 需 clean HEAD，badge / rc-build.json / runtimeInfo / HEAD 四方一致。
- ⚠️ `git commit -F <文件>` 必须用 **Windows 路径**（`D:/…`；`/tmp` git 读不到）；
  **不要**用 `git commit -m @'…'@`（bash 会把 here-string 首行塞进消息）。
- ⚠️ 本机 remote-tracking refs **无法落地** → 以 `git ls-remote` + `.git/FETCH_HEAD` 为权威；push 正常。
- Memory 并入功能 commit；**不单独提交 memory**（例外：纯 memory 补正可单独 commit）。
- vitest：cwd 盘符必须**大写** `/D/…`（小写 → 模块图双实例 → 持久化测试静默假失败）；
  全量 `--pool=vmForks --maxWorkers=1`；`--reporter=basic` 不支持；过滤器用**子串**（不能传绝对路径）。
- 本机 bash PATH 可能缺 `/usr/bin` → 命令前加 `export PATH="/usr/bin:/bin:$PATH"`。
- `交接文档_*.md` 是**本地件**（`git ls-files` 无匹配），勿误提交；截图 / 日志落 `outputs/`（gitignored）。
- ⚠️ **同一文件的多条 Edit 不要并行发出**（后落盘覆盖前者 → 静默丢改动）；串行 + grep 复核。
- ⚠️ 用 `Write` 整体重写文件时，**别把被替换段落之外的注释头一起吃掉**（替换前先 Read 上下 10 行）。

## 4. Stable contracts（改动前必读）
- DPR 只乘一次（logical→backing）；safe-area / capsule / hitArea 一律逻辑坐标。
- Player 舞台 844×390；Lab/PRP 舞台 **390×844**（四带：顶 80 / 舞台 302 / 日志 378 / 动作 84）。
- Viewport resume 只走 `syncWechatViewport`，无第二套 sizing 路径。
- E2E 句柄只在 `__E2E_INTERNAL_HANDLE__` 下；RC/web 排除；dev 下为 `false`（宏语义）→ 不是泄漏。
- hitArea 与绘制矩形**同源**（`computeFusionLayout` / `runPageLayout`）；E2E 命中域 = 逻辑舞台，非 CSS viewport。
- **像素账本口径**：只登记「不承载文字、不被描边覆盖」的纯色平铺矩形；承载文字 / 描边的面改点位采样。
  ⚠️ 含**缩放位图**时只能登记远离它的平涂面。
- **入口唯一性**：唯一玩家入口 = 根路径 `/`，由 dev-only 插件 `build/branchDevEntry.ts`（`apply:'serve'`）
  重写到 `/run-page.html`；`portrait-lab.html` = DEBUG ONLY、`index.html` = 正式横屏。
  ⚠️ `vite.config.ts` 两条守卫：R23 禁 `portrait-lab|portraitBattleLab`；RP-27 禁 `run-page|runMain`
  → dev 默认入口逻辑只能放 `build/branchDevEntry.ts`。
- `vite.portrait-lab.config.ts` 用 `emptyOutDir:false` → `dist-portrait-lab/` **累积旧 chunk**（gitignored）
  → 隔离断言必须从 `run-page.html` 取**真实引用**，不可按前缀挑 chunk、也不可断言「目录零残留」。
- **判定正式行为要查测试，别信注释**：正式相机口径唯一定义在 `tests/battleDynamicFramingR21.test.ts`。
- **Lab 源码守卫（必须尊重，不是绕过）**：
  - `R22a-4`（`tests/portraitBattleLab.test.ts`）：**正式编排器只允许 `runBattleRuntime.ts` import**；
    `ALLOWED_RELATIVE_IMPORTS` 是闭集且**要求每条都被真实命中**（死配置会 FAIL）
    → 能力 / 辅助模块只能拿**极窄端口**（PRP 侧 `RunAbilityPorts`），不得 import `planckBattleOrchestrator`。
  - `G1-08`：`arenaConditionLines()` 只豁免左侧为 `team|winner|loser|vehicle|snapshot|projectile|side|driver`
    的比较行 → ⚠️ **`ev.source !== 'A'` / `ev.target !== 'B'` 会被误判成 arena 分叉**（`ev.team !== 'A'` 不会）
    → 用 `const PLAYER_TEAM: RunTeamId = 'A'`。
- ⚠️ **开火节奏只能按 `weaponFire` 事件量，不能按弹丸数增量**（命中与下一发常同步 → 净变化 0 → 漏计）。
  本演示只有玩家（team `A`）开火，敌方无炮。
- ⚠️ **强化图标判据用「盒内面积统计」**（probe `choiceOptions[].iconRect` 与绘制同源）；中心单点采样必然假红。
- ⚠️ 分带线必须画在下一条带**首行** `band.y`；画在 `band.y − 1` 会吃掉 `road` 最底一行。
- **给用户的启动指令必须两行连给**：`cd D:\0818new\最强水果` 然后 `npm run dev`。

## 5. Current truth（只留承载不变量的关键事实）
### 5.1 正式战斗参数（PRP-F1，唯一数值来源）
- `runBattleRuntime.ts` / `runBattleView.ts`：离屏 canvas 上**零修改复用**正式 `Renderer` + `drawImage` 合成。
- world **1600×900** / groundY **700** / spawnA `{400,640,1}` / spawnB `{1200,640,−1}`（中心距 800）/
  Cannon `cd 1000 · muzzle 8 · dmg 80 · R 10 · mass 1 · recoil 30`。**PRP 构造传空 config `{}`（零覆盖）**。
- ⚠️ probe 坐标系**不对称**：`'idle'` 绝对坐标；`'battle'` 带内相对（pixel 采样要 +`bands.stage.y`）。
- ⚠️ 车辆 sprite 特征色必须**色族匹配**（tol 16）；菠萝无 PNG → 正式 Renderer 程序化绘制并与天空混合
  → 判据用**三色互斥**（西瓜 / 菠萝 / 香蕉交叉命中必须为 0）。

### 5.2 正式 Battle Camera（PRP-R5）
- 正式相机口径 = 逐帧 `reframe(snap,'battle',{phase})` → 私有 `battleCam` → `render()` 内逐帧
  `applyBattleFollow` → `this.transform`。节奏 `shouldReframeBattleCamera = phase !== lastPhase || phase === 'Active'`。
- viewport adapter：离屏视口 = 舞台带 + inset×2 = 502×358 → 正式安全区**恰好等于**舞台带 390×302（原点 56,28）。
- ⚠️ 视图层**绝不写** `this.renderer.transform =`；非 Active 逐帧 reframe 会与 `applyBattleFollow` 拉扯。
- ⚠️ 结束态（`result !== null`）**不再 reframe、不再重画离屏战场** → 保住「RESULT = 战场冻结」。
- ⚠️ **`Warning` 阶段相机按设计冻结**（只 Active 逐帧 reframe），而车辆仍在运动 & 物理仍在推进
  → 任何「全程都要在带内」的断言必须**分阶段**写（`Active` 严格；其余阶段只允许贴墙的亚像素溢出）。

### 5.3 强化接缝（F2 → BUILD-01 → BUILD-01-R1）
- **接缝 = Run-local overlay registry**（正式既有范式的复用）：`createRegistry()` 造副本 → 注册
  `run.mod.<id>` → 本局快照武器 `defId` 重映射。正式 `content.ts` / registry 单例 / `ContactRouter` /
  `Orchestrator` **零修改**。
- 两层 Build：改武器的项按选择顺序**浅合并** `behaviorParams`；能力类项**不改武器 def**。
  第二层条件池 `RUN_LAYER2_POOLS`（每层 3 选 1，由第一层决定）：`heavyShell → [kineticBurst,
  emergencyRepair, fastReload]`、`twinCannon → [tripleLoad, …]`、`fastReload → [recoilCharge, …]`。
- 第一层冻结值（**真人已通过，不得再调**）：重型弹头 `radius 16/mass 4/recoil 90`（damage 不动）/
  双联炮 `burstRounds 2/burstIntervalMs 100` / 快速装填 `cooldownMs 650`。
- 能力类接缝：`PlanckBattleOrchestrator.onCombatEvent`（公开订阅口）+ `WeaponFireEvent` / `DamageEvent`
  （正式既有，含 `relativeVelocity` / `damageSource` / `contactPoint`）+ `world.applyLinearImpulse`。
- ⚠️ **冲量在步边界施加**：回调只入队 → `RunBattleRuntime.step()` 在 `orchestrator.step` **之前** `flush()`；
  `result` 非空时丢弃。⇒ 冲量落在**下一次** `rt.step`（`dvx` 要比 `next − base`）。
- ⚠️ `world.getLinearVelocity(body)` 在开火帧跃变 ≈ +0.02 → **看不到冲量；位置差分才可靠**。
- **跨战斗耐久**：`PlanckVehicle.hp` 可写、`maxHp` 独立 → **只写 `hp`**。
  ⚠️ `initialPlayerHp` 必须是**构造时捕获的 readonly 字段**，不能是实时读 `vehicleA.hp` 的 getter。
- **关键缺口**：`FunctionalInstall` **只有 `star`、没有 `overrides`**（Movement 有）→ 将来「运行期改 Weapon
  任意字段」的最小 Foundation 补正 = 补 `overrides?: Partial<FunctionalPartDef>`。
- ⚠️ **胜负余量极窄**：只适合「方向可见」验证，**不适合数值微调对比**。

### 5.4 PRP-RUN-R1（已交付 `02becf7`）
- `finishRunBattle` 先算 `battlesCompleted` 再判 `playerHp <= 0` → 直接 `FAILED`（**不经过 RESULT**）；
  `FAILED` 下 `pressRunAction` 唯一动作 = `createRunPageState()`；`runCarriedPlayerHp` 在「上一场已结束」时
  **恒返回一个数**（死亡 → 0，绝不伪装成满耐久）。`RunPhase` 6 值；`runStartsNewRun()` 是
  「继续当前 Run」vs「重新开始」的唯一判据。
- 验证对手 = **`ProtoRusher`**（`R1-RUSH-02`，菠萝冲刺车，敌 HP 1000），装进 Lab 目录第 4 条 encounter，
  只引用既有正式模板。⚠️ **选型普查必须走生产同构链路**（漏 `RunBuildAbilities` 会低估压力）。
- ⚠️ 两条「测量口径失效」教训（换对手时暴露）：①「后坐让车身净后移」只在重型对手下成立 → 改「质量无关」的
  **开火帧位移凹陷**；②「整场最负 vx」量到的是**接触推挤**（最负值落在非开火帧）。

### 5.5 PRP-BUILD-01-R1（本次交付 `5c8b514`）
- 问题 = **存在 ≠ 可感知**。两条根因：①冲量作用在**质心** → 只产生平动 → 被「跟随双方中点」的相机**追平**
  （世界位移 +20.7px → 舞台带只动 1~4px）；②增益不足（GAIN=12 旋转达标 0/12）。
- 修法：作用点 → **真实命中点**（`damage.contactPoint`，经 `RunAbilityPorts.applyImpulse` 的 `at` 直通）；
  `KINETIC_BURST_GAIN 12 → 28`。**唯一可感知通道 = 绕质心的扭矩（仰俯 / 旋转），相机平移追不平。**
- 上界由两条**既有不变量**夹住（不是口味）：40/48 会真越界（417/402）+ 单帧瞬转 116°；
  32/36 把第三场残血砸到 ≈8%（伤 RUN-R1）。⚠️ 增益与战果**强混沌** → **不能靠调增益凑平衡**。
- 命中反馈 `runImpactVfx.ts`：纯几何、无 DOM / 无时间源（node 可冻结断言）；280ms 两道细环 + 140ms 核心亮点。
  触发判据 = `kineticHits` **计数增加**；位置 = `lastKineticHit`（与冲量作用点**同源**）。
  ⚠️ `impactMark` **过期即清空**（否则 probe 留下 `ageMs` 无上限增长的僵尸标记）。
- 绘制顺序：`drawKineticImpact` 在 `blit` 之后、**分带线之前** + `clip` 到舞台带 → 不可能污染入账面积。

## 6. Next action
- ⚠️ **待裁决：一条既存红（非本 Queue 引入）** —— `npm run e2e:portrait-lab` **146/148**。
  `tests/_e2e_portrait_battle_lab.cjs:338` 的冻结字面量 `auditCombos === 6` 与源码不符
  （`gate.ts:387`「2 Loadout × **4** Encounter = **8**」；`LAB_ENCOUNTERS` 含 ProtoRusher）；
  归属 `02becf7`（RUN-R1 加第 4 个遭遇时改了源码、漏改该 E2E 字面量），且 RUN-R1 门禁清单里没有
  `e2e:portrait-lab` → 一直红到本轮才被发现。**按纪律未混并修复**；需要则单开一条 Bug Queue
  （改 1 行字面量 + 1 处标签文案）。
- **BUILD-01-R1 已交付并停等**（`5c8b514` + memory `eda6ca9`，基线 `02becf7`，11 文件 / +1333 −97）。
  **按指令停止，不自动续下一 Queue。**
- **待真人录屏裁决（三条）**：①不看顶部文字，`重型弹头` vs `重型弹头 + 动能爆发` 的最终战斗是否
  **一眼可辨**（本 Queue 唯一验收口径，若仍需解释 → 失败）；②`FAILED` 失败终态页面的观感；
  ③低压对手下「先选择 → 再条件选择 → 最终真实战斗」是否仍让玩家看出**这辆车形成了一个方向**。
- **PRP-R3 / F1 / R5 / F2 / F2-R1 / F2-R2 / BUILD-01 / RUN-R1 / BUILD-01-R1 九轮真人录屏回执仍未全部归档**
  （本分支唯一未闭环项）。
- **PRP-R5 遗留裁决**（若真人仍嫌车小）：adapter 口径开局 69·84px / 峰值 172·190px 是否可感知。
  候选（均需重新授权）：调大 `RUN_BATTLE_VIEW_INSET` 或分段取景。**禁止**无授权新增 PRP 专属 dynamic zoom /
  镜头震动 / Kill zoom —— **恢复旧模式，不发明新模式**。
- 未裁决挂起：俯视 `WEAPON_CONTACT_THRESHOLD=0.5`（`contactRouter.ts:694`）是否单开 Queue。
- Low-prio backlog：`tests/_e2e_portrait_battle_lab.cjs` 的 `[iso] I2` 仍用 `readdirSync().find()`；
  KNOWN-WX-COLD-BOOT-PREVIEW-SCALE-01；mobile drive slot（F-GARAGE-TOUCH-ASSEMBLY-R2）；strip-scroll no clamp。
- 既有抖动（**非 Queue 回归**）：全量 vitest 时 `garageFusionResultInteractionR22.test.ts` 偶发 5s 超时。
