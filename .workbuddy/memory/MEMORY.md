# Fruits - Runtime Memory Index

**只有「不变量 + 陷阱 + 下一步」。** 公式 / 实测数字 / 逐帧时间线 / 普查过程一律不在这里。

| 要找什么 | 去哪 |
|---|---|
| 本轮 / 近日做了什么、实测数字 | `.workbuddy/memory/YYYY-MM-DD.md`（最新 `2026-09-17.md`） |
| **PRP 运行时细节**（相机 / 接缝 / 能力数值） | `.workbuddy/memory/REF_PRP_RUNTIME.md` |
| 每个 Queue 的完整交付说明 | repo-root `交接文档_YYYY-MM-DD_<Queue>.md` |
| 本文件更早的完整版本 | `.workbuddy/memory/archive/MEMORY_FULL_*.md` |
| 项目级共识与边界（最高权威） | `最强水果_项目核心共识与开发边界_WorkBuddy_Memory.md` |

## 1. Identity / 链尾
- Repo `git@github.com:HubinAI/fruits.git` | dir `D:\0818new\最强水果` | 分支 `prototype-portrait-battle-lab`
  （实验分支，可整块删除）；主线 `foundation-02-wechat`。原型正式名 **PRP｜Portrait Run Prototype**。
- **链尾**：`54fbd6f` RUN-02 整局竖切 → `0cb1956` M2 下一局种子 → `5df031d` M3 遭遇验证台 →
  `d334d0c` R1 验证中心 → **RUN-02-R1 维修分支修正**；更早 SHA 查 `git log`。
- 全链对 `src/core|physics|render|player|platform|battle|ui|game|presentation` diff **恒为空**；
  唯一正式 gameplay 改动 = `src/battle/cannonBehavior.ts` 的可选 `burstRounds`（默认 1，逐帧不变）。

## 2. Rules
- 1 Queue = 1 problem；先调查/复现、锁定根因再改码；无静默扩范围；缺陷拆独立 Queue（禁混并）。
- tech pass ≠ 落进运行时 ≠ 真人体验通过；体验由用户裁决，别让用户抓技术日志。
- 每条回复结尾写「用户需要回什么」；每条 Queue 完成后**停等**，绝不自动续下一条。
- PC 录屏常态化；手机录屏只用于大模块节点。
- 「一眼可辨」验收：先找**相机追不平的物理通道**；不存在就**如实上报失败**，不加提示掩盖。
- 指令语义与禁止清单冲突时，按**硬约束**落地并**显式上报解释与代价**（别沉默选一个）。

## 3. Git / build / 环境
- `git stash` **禁止**；git 异常先跑 `scripts/repo-health.js`（无 CLI →
  `node --input-type=module -e "import {checkRepoHealth} from './scripts/repo-health.js'"`）。
- 禁 `reset --hard` / `checkout --` / 删 `.git` / 手改 refs / force-push 已交付。
- 单功能 commit + push + **四路核对**（HEAD = 本地 ref = `git ls-remote` = `.git/FETCH_HEAD`）；
  ⚠️ 本机 remote-tracking refs 无法落地 ⇒ 核对前必须先 `git fetch origin <branch>`。
- ⚠️ `git commit -F` 必须用 **Windows 路径**；**不要** `git commit -m @'…'@`。
- Memory 并入功能 commit（不单独提交；纯 memory 补正例外）；⚠️ memory 里别引用补正 commit **自身**的 SHA。
- vitest：`--pool=vmForks --maxWorkers=1`；过滤器用**子串**；⚠️ **必须独占机器**（与 E2E/构建并发 ⇒
  无关文件报 `Test timed out in 5000ms`，先单独重跑复现）；⚠️ 重型用例（多路线真实物理）**必须显式 timeout**
  （实测 24 场 = 7.2s > 默认 5s ⇒ `}, 60000);`）；改路线结构后必须重测冻结表 + 重跑。
- 本机 bash PATH 常缺 `/usr/bin` → 命令前 `export PATH="/usr/bin:/bin:$PATH"`。
- `交接文档_*.md` 是**本地件**勿提交；截图 / 日志落 `outputs/`（gitignored）。
- ⚠️ **id 改名 = 全通道同步**：`src` + `tests/*.ts` + `tests/*.cjs`（E2E 侧有镜像字面量表）。
- ⚠️ **每加一个根目录 html = 四处同步**：R2-03 不重写清单 / R2-10 完整清单（字典序）· `vite.portrait-lab.config.ts`
  的 `input` · `constants.ts` 头部删除清单 · 新页面自己的守卫测试。
- ⚠️ **跨轮复验 PRP 前必须先 `npm run build:portrait-lab`**：E2E 读 `dist-portrait-lab/`，而它
  `emptyOutDir:false` 会留**陈旧 chunk** ⇒ 改完源码直接跑 E2E = 旧产物假 FAIL。
  定位：`grep -rl "<新字段>" dist-portrait-lab/` 空 + `grep -rl "<旧字段>"` 命中。
- ⚠️ **E2E 新段落的 page 归属**：`runViewport` 里的 `page` 会被 14 段（开火节奏）继续消费 ⇒ 中途推进它会让
  后续段用**过期 rect** 点击 → 90s 超时假红。重活一律 `browser.newContext()` 另开 page（13 段同构）+ `close()`。
- ⚠️ E2E「回到某页」判据**不要写 `location.pathname`**（`dev:*` 落地形式可能是根路径）⇒ 写语义（探针 + DOM），
  入口 URL 单独断言。
- ⚠️ **写断言四坑**：`toEqual` 比**键集**（`{...x,覆盖}` 键数不同 ⇒ 永远不等，写取值函数）；浮点别 round 后再去重；
  源码守卫匹配前**剥注释**（含 HTML `<!-- -->`）；「不写战斗数值」类守卫用**正则**（`includes('damage:')` 会被
  `damage: cr.damage` 误伤）。
- ⚠️ 改实现导致源码守卫失败时**强化守卫，不放宽**（例：`runOverlayCards` 收紧为「唯一调用点 + 三处同源」）。
- ⚠️ **probe 字段名 ≠ 展示名**（`EncounterLabProbe.playerBodyName` 是中文车身名，正式 id 在 `loadoutId`）
  ⇒ 写断言前先读接口，别按名字猜。

## 4. Stable contracts（改动前必读）
- DPR 只乘一次（logical→backing）；safe-area / capsule / hitArea 一律逻辑坐标。
- Player 舞台 844×390；Lab/PRP 舞台 **390×844**（四带：顶 80 / 舞台 302 / 日志 378 / 动作 84）。
- E2E 句柄只在 `__E2E_INTERNAL_HANDLE__` 下；RC/web 排除；dev 下 `false`（宏语义）→ 不是泄漏。
- hitArea 与绘制矩形**同源**（`computeFusionLayout` / `runPageLayout`）；E2E 命中域 = 逻辑舞台。
- **像素账本口径**：只登记「不承载文字、不被描边覆盖」的纯色平铺矩形（含缩放位图时只登记远离它的平涂面）；
  承载文字 / 描边的面改点位采样；浮层整页遮罩用 `ledgerExpect({ masked: N })`。
  ⚠️ 卡片强调条在顶部、正文在 `card.y+72` ⇒ 改卡片文案**不影响**账面（安全）。
- **入口唯一性**：根路径 `/` 由 dev-only 插件 `build/branchDevEntry.ts`（`apply:'serve'`）重写到 `/run-page.html`；
  ⚠️ `vite.config.ts` 两条守卫（R23 禁 `portrait-lab|portraitBattleLab`；RP-27 禁 `run-page|runMain`）
  ⇒ dev 入口逻辑只能放该插件。
- **判定正式行为要查测试，别信注释**：正式相机口径唯一定义在 `tests/battleDynamicFramingR21.test.ts`。
- **Lab 源码守卫（必须尊重，不是绕过）**：`R22a-4` = 正式编排器**只允许 `runBattleRuntime.ts` import**，
  `ALLOWED_RELATIVE_IMPORTS` 是闭集且每条都要被真实命中（死配置 FAIL）；`R22a` 的 `labSourceFiles()`
  **只扫 Lab 顶层 `.ts`** ⇒ 新增 Lab 文件必须放顶层；`G1-08` = ⚠️ **`ev.source !== 'A'` 会被误判成 arena 分叉**
  （`ev.team !== 'A'` 不会）→ 用 `PLAYER_TEAM`。
- ⚠️ **probe / 账本必须报「本帧真正画出来的东西」**：任何叠在 `state` 之上的临时浮层 / 禁用态都要配 `*Now()`
  访问器，并让**绘制 / 命中 / 探针 / 账本四处同一入口**。
- ⚠️ **开火节奏只能按 `weaponFire` 事件量**（按弹丸数增量会漏计：命中与下一发常同步 → 净变化 0）。
- ⚠️ 「整页压暗」像素判据不要用高绝对阈值（底色极暗）⇒ ~15 + **同点位前后对比**。
- ⚠️ 强化图标判据用**盒内面积统计**（`choiceOptions[].iconRect` 与绘制同源）；中心单点采样必然假红。
- ⚠️ 分带线画在下一条带**首行** `band.y`（`band.y − 1` 会吃掉 `road` 最底一行）。
- **启动指令两行连给**：`cd D:\0818new\最强水果` → `npm run dev`（或 `dev:next-run` / `dev:encounter-lab` /
  `dev:validation`）。

## 5. Current truth（不变量；细节见 `REF_PRP_RUNTIME.md`）
### 5.1 战斗参数 / 对手
- world **1600×900** / groundY **700** / spawnA `{400,640,1}` / spawnB `{1200,640,−1}`（中心距 800）；
  Cannon `cd 1000 · muzzle 8 · dmg 80 · R 10 · mass 1 · recoil 30`；**PRP 构造传空 config `{}`**。
- ⚠️ probe 坐标系**不对称**（`'battle'` 是带内相对）；菠萝无 PNG → 判据用**三色互斥**（tol 16）；
  选型普查必须走**生产同构链路**。

### 5.2 相机（PRP-R5）—— 可感知性的第一约束
- ⚠️ **头号陷阱**：相机跟**双方中点** ⇒ 玩家与敌车位移互相抵消 ⇒ **屏幕位移 ≈ 0，哪怕世界位移很大**
  ⇒ 任何「看起来在移动」的设计**先算相机追平后的净量**；⚠️ 视图层绝不写 `renderer.transform`。
- ⚠️ 结束态不再 reframe（RESULT = 战场冻结）；`Warning` 阶段相机按设计冻结 ⇒ 断言**分阶段**写。

### 5.3 接缝 / 能力（F2 → BUILD-01）
- 接缝 = **Run-local overlay registry**；正式 `content.ts` / registry / `ContactRouter` / `Orchestrator` 零修改。
- ⚠️ **第一层冻结值（真人已通过，不得再调）**：重型弹头 `radius16/mass4/recoil90` · 双联炮 `burst 2×100ms` ·
  快速装填 `650ms` · 动能爆发 `KINETIC_BURST_GAIN=28` + 真实命中点施力 · 三连装填 `burst 3×100ms`。
- ⚠️ 冲量在**步边界**施加（`flush()` 在 `orchestrator.step` 之前）；计数点必须在**真实施加处**。
- **关键缺口**：`FunctionalInstall` 只有 `star`、没有 `overrides`（Movement 有）⇒ 运行期改 Weapon 字段的最小
  补正 = 补 `overrides?: Partial<FunctionalPartDef>`。
- ⚠️ 胜负余量极窄 + 强混沌：「方向可见」验证可用，**数值微调对比不可用**；物理侧证伪结论见 REF §C。

### 5.4 RUN-R1 关键行为
- 死亡 → 直接 `FAILED`（**不经过 RESULT**）；`FAILED` 下唯一动作 = `createRunPageState()`；
  `runCarriedPlayerHp` 在「上一场已结束」时**恒返回一个数**（死亡 → 0，不伪装满耐久）。

### 5.5 BUILD-01 收口（`PRP-BUILD-01-CLOSEOUT-AND-FREEZE`）
- **通过并冻结**：两层条件池机制 · Run-local 两层 Modifier（叠加 + 浅合并）· `重弹→动能爆发` ·
  `双联→三连装填` · `快速装填 650ms`
  ⇒ 核心假设「**过去的选择改变未来选择的价值**」由 **2 条真实路线**支持，**不做 3/3**。
- **整条删除**（不是待优化，是假设已否决 → 将来当**新假设**处理）：`快速装填` 专属控距二层
  （`recoilCharge`/`strongRecoil`/`suppressionShot`）。⚠️ 清理时区分「失败实验专属」与
  「服务动能爆发的共享接缝」—— 后者（`weaponFire` 方向记录 / `damage` 入口 / `RunAbilityPorts` /
  `flush()`）**全部保留**。`快速装填` 第二层 = 通用转向池 `['heavyShell','twinCannon','emergencyRepair']`。

### 5.6 RUN-02 整局竖切（含 RUN-02-R1 修正后结构）
- **唯一 RunScript 数据源** = `runScript.ts`（纯数据 + 纯查询）。九节点：`d1-start(1) → d2-battle1(2) →
  d2-choice1(2) → d3-battle2(3) → d4-durability(4)` →（repair）`d5-tend(5)` →（汇合）`d5-choice2(5)`；
  （upgrade）直达 `d5-choice2(5)` → `d6-battle3(6) → d7-final(7)`。
- ⚠️ **`d4-durability` 与 `d5-choice2` 是两个独立节点**：维修的机会成本 = 「这一次额外改装」，**不是**整局第二层；
  两条分支都经 `branch[choice]` + `next` 走到 `d5-choice2`，`runPageState.ts` **零分支特判**（修正只在脚本数据）。
- ⚠️ **进度锚点是 `nodeId`，不是「第几场/第几选」**；页面**禁止** `if (day === X)`；战斗节点**两段式**
  （`IDLE →按一次 EVENT →再按 BATTLE`）⇒ 「点到开战」的驱动**不能写死点击次数**。
- 四场对手全部来自**节点的 `encounterId`**；掉血阶梯 181/221/257/482（单调递增，零数值改动）。
- ⚠️ **`runCarriedPlayerHp` 可读窗口**：`!s.battle.done` → `null` ⇒ 进 BATTLE 后读它恒 `null`；
  宿主必须在 **EVENT 那一刻**读；进 BATTLE 后权威来源 = `s.battle.playerHp`。
- ⚠️ **`projectileCount()` 是全场口径** ⇒ 反推开火节奏必须用 `battleWorld.playerProjectiles`（只数玩家）。
- ⚠️ **改路线结构 ⇒ 真实物理冻结表必须重测**（口径 = 「显式实测更新，不是就地重算」）；
  `维修` 量按缺口截断 `min(275, 上限 − 当前)`。

### 5.7 三个独立验证入口（M2 / M3 / R1）
- **M2 `next-run.html`**（`dev:next-run`）：`RunPageOptions{priorRun/seedOptions/stopAfterFirstBattle}` **全可选**
  ⇒ `new RunPage(root)` 逐字节不变；种子 = 既有第一层强化换语境（不新增奖励）；「上一局」由
  `buildPriorCompletedRun` 走真实状态机**确定性快进**。⚠️ `runPageState/runScript/runBattleRuntime` **不得含
  seed 概念**（NR-15 守卫钉死）。
- **M3 `encounter-lab.html`**（E2E 端口 8158）：固定三套 `ProtoRusher`/`Chaser`/`RangedTurret`（唯一来源
  `ENCOUNTER_BATCH_IDS`）；label/模板 id/count **从 `testData.LAB_ENCOUNTERS` 读**。
  ⚠️ **清理语义真相**：`PlanckBattleOrchestrator.dispose()` **只是丢弃引用** ⇒ 被释放的实例**仍可 `step`**；
  cleanup 靠**宿主生命周期**（`disposeRuntime()` 先于 `new`；`runtime === null` 时停 RAF）；判据 = **新实例开局
  读数干净**（开局读数必须**构造时固化**）。
- **R1 `validation-hub.html`**（`dev:validation`，端口 8159）：三入口唯一数据源 = `validationHub.ts`（**零 import**）。
  ⚠️ 切换 = **整页导航**（真实 `<a href>` 到入口页面**本身**）⇒ 保真（Full Run 就是玩家正式页面）+
  文档销毁带走全部运行时/监听器 + 不复制第二套宿主；**代价** = 入口页面无「返回」按钮（返回 = 浏览器后退）。
  ⚠️ Hub **零画布**、chunk 仅 3.4KB；「上次进入」标记 = `sessionStorage` + **`pageshow` 重读**（bfcache）。

## 6. Next action
- **RUN-02-R1（维修分支修正）已交付**。**按指令停止，不自行进入下一阶段。** 真人复验 = 录一段
  「RUN COMPLETE → 选维修 → DAY 5 条件三选一 → DAY 6 两层」。
- ⚠️ **本轮唯一待裁决**：修正后两条分支**唯一差别只剩那 275 点耐久** ⇒ `继续改装` 目前**没有**独有的强化回报
  （与维修拿到的是同一份第二层）。Queue 原文「B 继续改装：获得一次现有通用强化机会」若本意是**额外一次**，
  那需要**新增节点** = 违反本 Queue 的「不增加新事件 / 冻结两层结构」⇒ **须单开 Queue（新设计假设）**。
- **M3 待裁决**（不做平衡）：三种敌人是否提出不同问题；`RangedTurret`(OPP-03) 对基础 Build **必输** ⇒ 改即新假设。
- **M2 待裁决**：三个种子开局难度是否等价（「重炮开局」第一场濒死）；「下一局起点不同」是否真让人想再打一局。
  ⚠️ 禁改已冻结的第一层数值。**R1 待裁决**：Hub「整页导航 + 后退」够不够用（要单页切换 = 新假设）。
- **未裁决挂起**：`FAILED` 终态观感；「整局打完是否想再开一局」；`WEAPON_CONTACT_THRESHOLD=0.5`
  （`contactRouter.ts:694`）；PRP-R5 遗留（若仍嫌车小，**恢复旧模式，不发明新模式**）。
- ⚠️ 遗留缺口：PRP 选项图标**盒内笔画**无 node 侧几何测试；**PRP 各轮录屏回执未全部归档**（唯一未闭环项）。
- Low-prio backlog：`_e2e_portrait_battle_lab.cjs` 的 `[iso] I2` 用 `readdirSync().find()`；
  KNOWN-WX-COLD-BOOT-PREVIEW-SCALE-01；mobile drive slot（F-GARAGE-TOUCH-ASSEMBLY-R2）；strip-scroll no clamp。
