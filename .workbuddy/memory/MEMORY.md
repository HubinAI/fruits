# Fruits - Runtime Memory Index

**只有「不变量 + 陷阱 + 下一步」。** 公式 / 实测数字 / 逐帧时间线 / 普查过程一律不在这里。

| 要找什么 | 去哪 |
|---|---|
| 本轮 / 近日做了什么、实测数字 | `.workbuddy/memory/YYYY-MM-DD.md`（最新 `2026-09-17.md`） |
| **PRP 运行时细节**（相机 / 接缝 / 参数 / 能力数值） | `.workbuddy/memory/REF_PRP_RUNTIME.md` |
| 每个 Queue 的完整交付说明 | repo-root `交接文档_YYYY-MM-DD_<Queue>.md` |
| 本文件更早的完整版本 | `.workbuddy/memory/archive/MEMORY_FULL_*.md` |
| 项目级共识与边界（最高权威） | `最强水果_项目核心共识与开发边界_WorkBuddy_Memory.md` |

## 1. Identity / 链尾
- Repo `git@github.com:HubinAI/fruits.git` | dir `D:\0818new\最强水果` | 分支 `prototype-portrait-battle-lab`
  （实验分支，可整块删除）；主线 `foundation-02-wechat`。原型正式名 **PRP｜Portrait Run Prototype**。
- **链尾**：`54fbd6f` PRP-RUN-02-FULL-RUN-VERTICAL-SLICE → **`PRP-M2-NEXT-RUN-SEED-VALIDATION`
  （独立验证入口 `next-run.html` + 三个起始种子 + `NEXT RUN VALIDATION COMPLETE`）**；更早 SHA 查 `git log`。
- 全链对 `src/core|physics|render|player|platform|battle|ui` diff **恒为空**；唯一正式 gameplay 改动 =
  `src/battle/cannonBehavior.ts` 的**可选** `burstRounds`（默认 1，逐帧不变）。

## 2. Rules
- 1 Queue = 1 problem；先调查/复现、锁定根因后再改码；无静默扩范围。
- tech pass ≠ 落进运行时 ≠ 真人体验通过；体验由用户裁决，别让用户抓技术日志。
- 每条回复结尾写「用户需要回什么」。每条 Queue 完成后**停等**，绝不自动续下一条。
- PC 录屏常态化；手机录屏只用于大模块节点。
- 「一眼可辨」验收：先找**相机追不平的物理通道**；不存在就**如实上报失败**，不加提示掩盖。
- 缺陷拆独立 Queue，**禁止混并入当前 scope**。

## 3. Git / build safety
- `git stash` **禁止**；git 异常先跑 `scripts/repo-health.js`（纯 ESM 库，无 CLI →
  `node --input-type=module -e "import {checkRepoHealth} from './scripts/repo-health.js'"`）。
- 禁 `reset --hard` / `checkout --` / 删 `.git` / 手改 refs / force-push 已交付。
- 单功能 commit + push + 四路核对 **HEAD = 本地 ref = `git ls-remote` = `.git/FETCH_HEAD`**。
  ⚠️ 本机 remote-tracking refs **无法落地** → 核对前必须先 `git fetch origin <branch>`。
- ⚠️ `git commit -F <文件>` 必须用 **Windows 路径**（`/tmp` git 读不到）；**不要** `git commit -m @'…'@`。
- Memory 并入功能 commit；**不单独提交 memory**（例外：纯 memory 补正可单独 commit）。
  ⚠️ memory 里**别引用补正 commit 自身的 SHA**（每写一次就失效）。
- vitest：全量 `--pool=vmForks --maxWorkers=1`；过滤器用**子串**；
  ⚠️ **必须独占机器**（与 E2E / 构建并发时**无关文件**会报 `Test timed out in 5000ms`）→ 先单独重跑复现；
  实测 cwd 盘符**大小写均可**（`/d/…` 与 `/D/…` 都通过）。
- 本机 bash PATH 可能缺 `/usr/bin` → 命令前 `export PATH="/usr/bin:/bin:$PATH"`。
- `交接文档_*.md` 是**本地件**，勿误提交；截图 / 日志落 `outputs/`（gitignored）。
- ⚠️ **id 改名 = 全通道同步**：`src` + `tests/*.ts` + `tests/*.cjs`（E2E 侧有镜像字面量表）。
- ⚠️ **跨轮复验 PRP 前必须先 `npm run build:portrait-lab`**：E2E 读 `dist-portrait-lab/`，
  而该目录 `emptyOutDir:false` 会留下**陈旧 chunk** ⇒ 改完源码直接跑 E2E 会拿到旧产物的假 FAIL
  （R4 实测：`suppress=undefined` 4 条，重建后 406/406 全绿）。
  ⚠️ 定位手法：`grep -rl "<新字段>" dist-portrait-lab/` 为空 + `grep -rl "<旧字段>"` 命中 ⇒ 产物陈旧。
- ⚠️ **R22a 的 `labSourceFiles()` 只扫 Lab 顶层 `.ts`**（`readdirSync(LAB_DIR)`）⇒ 新增 Lab 文件
  **必须放顶层**；放子目录 = **绕过 import 白名单守卫**（本项目明令不做）。
- ⚠️ **probe / 账本必须报「本帧真正画出来的东西」**：任何叠在 `state` 之上的临时浮层 / 临时禁用态
  都要配一个 `*Now()` 访问器，并让**绘制 / 命中 / 探针 / 账本四处同一入口** ——
  否则 probe 会报出一个屏幕上并不存在的按钮，账本会登记一批被遮罩盖掉的层（E2E 立刻假红）。
- ⚠️ **「整页压暗」类像素判据不要用高绝对阈值**：页面底色本身极暗（日志带 RGB 合计仅 57），
  0.86 深色遮罩对暗底的降幅上限很小（实测最小 26）⇒ 阈值取 ~15，并优先用**同点位前后对比**。
- ⚠️ **根目录 html 清单是冻结断言**（`tests/portraitDefaultEntry.test.ts` R2-10）⇒ 新增 html 入口必须显式更新。
- ⚠️ **改实现导致源码守卫失败时，要「强化守卫」而不是放宽它**：例 —— `runOverlayCards` 的来源
  从「多处各自直读」收紧为「全文件唯一调用点 + 绘制/命中/探针三处都经唯一入口」。

## 4. Stable contracts（改动前必读）
- DPR 只乘一次（logical→backing）；safe-area / capsule / hitArea 一律逻辑坐标。
- Player 舞台 844×390；Lab/PRP 舞台 **390×844**（四带：顶 80 / 舞台 302 / 日志 378 / 动作 84）。
- E2E 句柄只在 `__E2E_INTERNAL_HANDLE__` 下；RC/web 排除；dev 下为 `false`（宏语义）→ 不是泄漏。
- hitArea 与绘制矩形**同源**（`computeFusionLayout` / `runPageLayout`）；E2E 命中域 = 逻辑舞台。
- **像素账本口径**：只登记「不承载文字、不被描边覆盖」的纯色平铺矩形；承载文字 / 描边的面改点位采样。
  ⚠️ 含**缩放位图**时只能登记远离它的平涂面。
- **入口唯一性**：唯一玩家入口 = 根路径 `/`，由 dev-only 插件 `build/branchDevEntry.ts`（`apply:'serve'`）
  重写到 `/run-page.html`。⚠️ `vite.config.ts` 两条守卫（R23 禁 `portrait-lab|portraitBattleLab`；
  RP-27 禁 `run-page|runMain`）⇒ dev 入口逻辑只能放 `build/branchDevEntry.ts`。
  ⚠️ `vite.portrait-lab.config.ts` 用 `emptyOutDir:false` → `dist-portrait-lab/` **累积旧 chunk**（gitignored）
  → 隔离断言必须从 `run-page.html` 取**真实引用**。
- **判定正式行为要查测试，别信注释**：正式相机口径唯一定义在 `tests/battleDynamicFramingR21.test.ts`。
- **Lab 源码守卫（必须尊重，不是绕过）**：
  - `R22a-4`（`tests/portraitBattleLab.test.ts`）：**正式编排器只允许 `runBattleRuntime.ts` import**；
    `ALLOWED_RELATIVE_IMPORTS` 是闭集且**每条都要被真实命中**（死配置 FAIL）→ 能力模块只能拿**极窄端口**
    （`RunAbilityPorts`）。
  - `G1-08`：`arenaConditionLines()` 只豁免左侧为 `team|winner|loser|vehicle|snapshot|projectile|side|driver`
    的比较行 → ⚠️ **`ev.source !== 'A'` 会被误判成 arena 分叉**（`ev.team !== 'A'` 不会）→ 用 `PLAYER_TEAM`。
- ⚠️ **开火节奏只能按 `weaponFire` 事件量**，不能按弹丸数增量（命中与下一发常同步 → 净变化 0 → 漏计）。
- ⚠️ **强化图标判据用「盒内面积统计」**（probe `choiceOptions[].iconRect` 与绘制同源）；中心单点采样必然假红。
- ⚠️ 分带线画在下一条带**首行** `band.y`；画在 `band.y − 1` 会吃掉 `road` 最底一行。
- **启动指令两行连给**：`cd D:\0818new\最强水果` 然后 `npm run dev`。

## 5. Current truth（不变量；细节见 `REF_PRP_RUNTIME.md`）
### 5.1 战斗参数 / 对手
- world **1600×900** / groundY **700** / spawnA `{400,640,1}` / spawnB `{1200,640,−1}`（中心距 800）；
  Cannon `cd 1000 · muzzle 8 · dmg 80 · R 10 · mass 1 · recoil 30`；**PRP 构造传空 config `{}`**。
- 演示三场全部用 **`ProtoRusher`**（菠萝冲刺车，敌 HP 1000）。⚠️ 选型普查必须走**生产同构链路**。
- ⚠️ probe 坐标系**不对称**（`'battle'` 是带内相对）；⚠️ 菠萝无 PNG → 判据用**三色互斥**（tol 16）。

### 5.2 相机（PRP-R5）—— 可感知性的第一约束
- ⚠️ **头号陷阱**：相机跟**双方中点** ⇒ **玩家与敌车位移互相抵消** ⇒ **屏幕位移 ≈ 0，哪怕世界位移很大**。
  任何「看起来在移动」的设计**必须先算相机追平后的净量**，别拿世界 px 当判据。
- ⚠️ 视图层绝不写 `renderer.transform`；⚠️ 结束态不再 reframe（保「RESULT = 战场冻结」）；
  ⚠️ `Warning` 阶段相机按设计冻结 → 断言必须**分阶段**写。

### 5.3 接缝 / 能力（F2 → BUILD-01）—— 见 REF
- 接缝 = **Run-local overlay registry**；正式 `content.ts` / registry / `ContactRouter` / `Orchestrator` 零修改。
- 第一层冻结值（**真人已通过，不得再调**）：重型弹头 `radius 16/mass 4/recoil 90` / 双联炮 `burst 2×100ms` /
  快速装填 `cooldownMs 650`。
- ⚠️ 冲量在**步边界**施加（`flush()` 在 `orchestrator.step` 之前）；计数点必须在 `flush()` 的**真实施加处**。
- **关键缺口**：`FunctionalInstall` 只有 `star`、**没有 `overrides`**（Movement 有）→ 「运行期改 Weapon 任意
  字段」的最小 Foundation 补正 = 补 `overrides?: Partial<FunctionalPartDef>`。
- ⚠️ **胜负余量极窄 + 强混沌**：只适合「方向可见」验证，**不适合数值微调对比**。
- 三条证伪结论：①质心冲量 = 纯平动 → 被相机追平（加力无用，要换作用点/通道）；②扭矩是唯一追不平的通道，
  但**重的玩家车几乎不转**；③「每 N 发蓄满一次」= 不可见状态 ⇒ 真人判失败 ⇒ **自然因果优先于幅度**。

### 5.4 RUN-R1 关键行为
- 死亡 → 直接 `FAILED`（**不经过 RESULT**）；`FAILED` 下唯一动作 = `createRunPageState()`；
  `runCarriedPlayerHp` 在「上一场已结束」时**恒返回一个数**（死亡 → 0，不伪装满耐久）。
- ⚠️ 测量口径陷阱：「后坐净后移」只在重型对手下成立 → 改**质量无关**的「开火帧位移凹陷」；
  「整场最负 vx」量到的是**接触推挤**。

### 5.5 BUILD-01 最终结论（阶段收口，`PRP-BUILD-01-CLOSEOUT-AND-FREEZE`）
- **通过并冻结**：① 两层条件池机制；② Run-local 两层 Modifier（叠加 + 浅合并）；
  ③ `重型弹头 → 动能爆发`（重炮路线）；④ `双联炮 → 三连装填`（多发路线）；⑤ `快速装填 650ms` 作为有效第一层。
  ⇒ BUILD-01 的核心假设「**过去的选择改变未来选择的价值**」已由 **2 条真实路线**支持，**不做 3/3**。
- **未通过并删除**：`快速装填` 的**专属控距二层**。三条尝试 `反冲蓄能` → `强力后坐` → `压制射击`
  全部真人多轮判失败 ⇒ **不是「待后续优化」，而是当前设计假设已否决**；
  将来若重新设计，**作为新的内容假设处理**。
  ⇒ 已整条删除：`recoilCharge` / `strongRecoil` / `suppressionShot` 的 id、overlay、常量、
  运行时状态、probe 字段、图标、文案、E2E 采样键（**无兼容分支、无死代码**）。
- ⚠️ 清理时**必须区分**「失败实验专属」与「服务动能爆发的共享接缝」——
  共享的（`weaponFire` 方向记录 / `damage` 命中入口 / `RunAbilityPorts`
  `subscribe·isFinished·facingOf·projectileMass·applyImpulse` / `flush()` 步边界施加）
  **全部保留，不因清理误删**。
- **`快速装填` 第二层 = 通用转向池** `['heavyShell', 'twinCannon', 'emergencyRepair']`
  （语义 = 保留高频特征，同时向重炮 / 多发转型，或者选生存）。⚠️ 该池**没有** `role:'synergy'` 项，
  槽位语义与另两池不同 —— 这是有意的收口结果。**不新增第四个第一层强化，不加长任何池。**
- ⚠️ 物理侧的三条证伪结论（跨 R2~R4 累计）见 `REF_PRP_RUNTIME.md` §C，**别重犯**。

### 5.6 RUN-02 整局竖切（`PRP-RUN-02-FULL-RUN-VERTICAL-SLICE`）
- **唯一 RunScript 数据源** = `runScript.ts`（纯数据 + 纯查询，不 import 战斗/DOM）。
  九节点：`d1-start(1) → d2-battle1(2) → d2-choice1(2) → d3-battle2(3) → d4-durability(4)`
  →（repair）`d5-tend(5)` /（upgrade）`d5-choice2(5)` → `d6-battle3(6) → d7-final(7)`。
- ⚠️ **进度锚点是 `nodeId`，不是「第几场 / 第几选」**；页面里**禁止** `if (day === X)`。
  战斗节点是**两段式**：`IDLE →(按一次) EVENT →(再按) BATTLE` ⇒ 任何「点到开战」的驱动
  都**不能写死点击次数**（新局还要先过 `d1-start`）。
- 四场对手全部来自**脚本节点的 `encounterId`**（无写死的演示遭遇）；压力阶梯 =
  FireBrute 181 / SawRusher 221 / ProtoRusher 257 / RodLaser 482 掉血（单调递增，零数值改动）。
- **耐久事件**：`维修`（回耐久 · 放弃强化）/ `继续改装`（不回耐久 · 换第二次强化）；
  维修量**按缺口截断** `min(275, 上限 − 当前)`，且补偿会被 `min(maxHp, ·)` 截断。
- ⚠️ **`runCarriedPlayerHp` 的可读窗口**：`!s.battle.done` → `null` ⇒ **进 BATTLE 后读它恒为 `null`**，
  宿主必须在 **EVENT 那一刻**读；进 BATTLE 后权威来源 = `s.battle.playerHp`。
- ⚠️ **`projectileCount()` 是全场口径**（对手喷火器/镭射的弹丸也算）⇒ 反推开火节奏必须用
  `battleWorld.playerProjectiles`（只数玩家 A 方），否则基线会被量成 25ms。
- 四场真实物理耐久链（Node 冻结表）与浏览器实跑**逐项相等**（例：`twinCannon+tripleLoad`
  改装分支 `[919, 907, 699, 217]`）；同一条 `heavyShell+kineticBurst` 维修 → 终局 618，
  改装 → 终局**归零 FAILED**（「耐久改变下一步选择」的真实数值证据）。

### 5.7 下一局种子验证（M2，本轮交付）
- **M2（PRP-M2-NEXT-RUN-SEED-VALIDATION）**：`RunPageOptions{ priorRun / seedOptions /
  stopAfterFirstBattle }` —— **全部可选**，`new RunPage(root)` 行为逐字节不变
  （默认 Run E2E 476/476 复跑通过）。独立入口 `next-run.html` + `npm run dev:next-run`。
- ⚠️ **RUN-02 的三个文件本轮零改动**：`runPageState.ts` / `runScript.ts` / `runBattleRuntime.ts`
  逐字节不含 seed 概念（NR-15 守卫钉死）⇒ **新语义只加在 `nextRunValidation.ts` + `runPage.ts` 的可选分支**。
- ⚠️ 种子 = **既有第一层强化换个语境**（`heavyShell` / `twinCannon` / `fastReload`），**不新增奖励**；
  新 Run 由 `createSeededNewRun` 从零构造（满耐久 / DAY 1 / 日志重置 / `buffs` 只有这一个 seed）
  ⇒ 第一场注入的就是 `[seed]`；**「上一局」由 `buildPriorCompletedRun` 走真实状态机快进产出**（确定性）。
- ⚠️ 验证流程只有四拍：`RUN COMPLETE → 种子三选一 → 新 Run 第一场 → NEXT RUN VALIDATION COMPLETE`
  （第一场结束即停；种子选择浮层**复用 CHOICE 卡片几何**，零布局新增）。

## 6. Next action
- **M2 阶段已交付**（`PRP-M2-NEXT-RUN-SEED-VALIDATION`）。**按指令停止，不自动开下一阶段。**
- **下一步取决于真人裁决**：① 三个种子的**开局难度是否等价** —— 实测「重炮开局」第一场只活下
  **13/1100**（另两个 1009 / 919），战斗也更长（1018 步 vs 727/710）⇒ 这是「下一局起点不同」
  还是「选错就死」？⚠️ **禁止**顺手改第一层数值（已冻结），要改就是**新的设计假设**、单开 Queue。
  ② 「下一局起点不同」是否真的让人想立刻再打一局（元体验本身）。
- **RUN-02 阶段已完成并交付**（`PRP-RUN-02-FULL-RUN-VERTICAL-SLICE`）。
  **不自行进入永久奖励 / 下一局系统。**
- **当前脚本与池结构**：九节点固定脚本（见 §5.6）；第一层 `[heavyShell, twinCannon, fastReload]`（固定三项）；
  第二层条件池 `heavyShell → [kineticBurst, emergencyRepair, fastReload]`、
  `twinCannon → [tripleLoad, emergencyRepair, heavyShell]`、
  `fastReload → [heavyShell, twinCannon, emergencyRepair]`。**不新增第四个第一层，不加长任何池。**
- **已通过真人验收的冻结项**（一律**不得**再调）：重型弹头 `radius16/mass4/recoil90` /
  双联炮 `burst 2×100ms` / 快速装填 `650ms` / 动能爆发 `KINETIC_BURST_GAIN=28` + 真实命中点施力 /
  三连装填 `burst 3×100ms`。
- ⚠️ **未裁决**：`FAILED` 失败终态页面观感；「整局打完是否让人**想再开一局**」；
  RUN-02 的真人验收（战斗与选择是否自然交替 / 耐久是否真的影响选择 / Build 是否局内成形）。
- ⚠️ **RUN-02 已知边界**：浏览器 E2E **只跑「继续改装」分支**（维修分支由 Node 端真实物理冻结值覆盖）；
  两条分支共用同一套浮层几何与绘制代码。
- ⚠️ **遗留缺口**：PRP 选项图标的**盒内笔画**仍无 node 侧几何测试（E2E 选项序列覆盖不到全部选项）。
- **PRP 各轮录屏回执未全部归档**（本分支唯一未闭环项）。
- **PRP-R5 遗留裁决**（若真人仍嫌车小）：adapter 开局 69·84px / 峰值 172·190px 是否可感知。
  **禁止**无授权新增 PRP 专属 dynamic zoom / 镜头震动 / Kill zoom —— **恢复旧模式，不发明新模式**。
- 未裁决挂起：`WEAPON_CONTACT_THRESHOLD=0.5`（`contactRouter.ts:694`）是否单开 Queue。
- Low-prio backlog：`_e2e_portrait_battle_lab.cjs` 的 `[iso] I2` 用 `readdirSync().find()`；
  KNOWN-WX-COLD-BOOT-PREVIEW-SCALE-01；mobile drive slot（F-GARAGE-TOUCH-ASSEMBLY-R2）；strip-scroll no clamp。
