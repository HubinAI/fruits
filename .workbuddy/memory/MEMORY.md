# Fruits - Runtime Memory Index

**只有「不变量 + 陷阱 + 下一步」。** 公式 / 实测数字 / 逐帧时间线 / 普查过程一律不在这里。

| 要找什么 | 去哪 |
|---|---|
| 本轮 / 近日做了什么、实测数字 | `.workbuddy/memory/YYYY-MM-DD.md`（最新 `2026-09-16.md`） |
| **PRP 运行时细节**（相机 / 接缝 / 参数 / 能力数值） | `.workbuddy/memory/REF_PRP_RUNTIME.md` |
| 每个 Queue 的完整交付说明 | repo-root `交接文档_YYYY-MM-DD_<Queue>.md` |
| 本文件更早的完整版本 | `.workbuddy/memory/archive/MEMORY_FULL_*.md` |
| 项目级共识与边界（最高权威） | `最强水果_项目核心共识与开发边界_WorkBuddy_Memory.md` |

## 1. Identity / 链尾
- Repo `git@github.com:HubinAI/fruits.git` | dir `D:\0818new\最强水果` | 分支 `prototype-portrait-battle-lab`
  （实验分支，可整块删除）；主线 `foundation-02-wechat`。原型正式名 **PRP｜Portrait Run Prototype**。
- **链尾**：`b485a6e` BUILD-01-R2 → **`db8ad8c` BUILD-01-R3（一炮一后坐，删 charge）**；更早 SHA 查 `git log`。
- 全链对 `src/core|physics|render|player|platform` diff **恒为空**；唯一正式 gameplay 改动 =
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
- vitest：cwd 盘符必须**大写** `/D/…`；全量 `--pool=vmForks --maxWorkers=1`；过滤器用**子串**；
  ⚠️ **必须独占机器**（与 E2E / 构建并发时**无关文件**会报 `Test timed out in 5000ms`）→ 先单独重跑复现。
- 本机 bash PATH 可能缺 `/usr/bin` → 命令前 `export PATH="/usr/bin:/bin:$PATH"`。
- `交接文档_*.md` 是**本地件**，勿误提交；截图 / 日志落 `outputs/`（gitignored）。
- ⚠️ **id 改名 = 全通道同步**：`src` + `tests/*.ts` + `tests/*.cjs`（E2E 侧有镜像字面量表）。

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

### 5.5 BUILD-01-R3 强力后坐（最新交付）
- 口径 = **一炮一后坐**：每次真实 `weaponFire` → 一次追加冲量（炮口方向**取反**，作用点 = **真实炮口**）；
  旧 `recoilCharge` / `RECOIL_CHARGE_*` **整条删除**；`STRONG_RECOIL_IMPULSE = 110`。
- ⚠️ **决定性事实**：110 = 每炮 **6~10 世界 px** 后移，但敌车冲刺同时前进 ⇒ **屏幕只动 1~3 带 px**
  → 物理真实、**屏幕上几乎不可见**；已如实上报，交真人录屏裁决（**不放大数值**）。
- ⚠️ **上界由「保留真实接敌」夹住**：120 = 末场**零挨打**（= 禁止的「无法接敌」）；
  130~150 = 左缘 `bandX<0` 越界 + 被自己后坐打死（HP 0）。

## 6. Next action
- **BUILD-01-R3 已交付并停等**（基线 `29045b0`）。**按指令停止，不自动续下一 Queue。**
- **真人验收进度**：`重型弹头→动能爆发` ✅冻结 · `双联炮→三连装填` ✅冻结 ·
  `快速装填 → 强力后坐`（R2「反冲蓄能」已废弃）**待第三次裁决**。口径（正常速度、不看 Buff 文字）：
  第一层 =「它射得很快」；第二层 =「**而且每开一炮，它都会明显把自己往后踹**」。
  ⚠️ 若仍只能看出「射得快」→ **判失败，不再放大数值** → 需另开**表现层** Queue。
- ⚠️ 未裁决：`FAILED` 失败终态页面观感；「先选择 → 再条件选择 → 最终战斗」是否让玩家看出**这辆车有方向**。
- ⚠️ R3 **未覆盖**：`strongRecoil` 新图标字形无 node 侧几何测试（E2E 选项序列不含该选项）。
- **PRP 各轮录屏回执未全部归档**（本分支唯一未闭环项）。
- **PRP-R5 遗留裁决**（若真人仍嫌车小）：adapter 开局 69·84px / 峰值 172·190px 是否可感知。
  **禁止**无授权新增 PRP 专属 dynamic zoom / 镜头震动 / Kill zoom —— **恢复旧模式，不发明新模式**。
- 未裁决挂起：`WEAPON_CONTACT_THRESHOLD=0.5`（`contactRouter.ts:694`）是否单开 Queue。
- Low-prio backlog：`_e2e_portrait_battle_lab.cjs` 的 `[iso] I2` 用 `readdirSync().find()`；
  KNOWN-WX-COLD-BOOT-PREVIEW-SCALE-01；mobile drive slot（F-GARAGE-TOUCH-ASSEMBLY-R2）；strip-scroll no clamp。
