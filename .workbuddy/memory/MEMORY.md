# 《最强水果》项目长期开发基线

> **基线源文件**：`最强水果_项目核心共识与开发边界_WorkBuddy_Memory.md`（V1.0）
> 完整内容以源文件为准，此处为长期上下文速查。

## 核心定位（一句话）

极简策略 + 事前组装 + 自动物理战斗。玩家循环：「我觉得这样能赢 → 看它自己打 → 原来问题在这 → 改一下再试」。判断机制是否保留的唯一标准：**它是否让玩家做出不同的下一步动作？**

## 指令优先级（3 级）

1. **最新明确的单次 WorkBuddy 执行指令**（最高）
2. **本文的稳定项目边界**
3. 历史设计草稿 / 旧方案

## 冲突处理（硬规则）

最新任务与本基线核心定位冲突时：**不自行默默实现冲突方案**，必须先指出「冲突点 + 体验/架构后果 + 最小建议修正」。

## 关键边界速查

- **物理**：2D 侧视（X/Y 平移 + Z 轴旋转），禁 3D Roll/Yaw。数字定能力，Physics 定能力能否表达。同 Build 同条件结果大体稳定，禁随机命中/伤害/散布。
- **四类结构**：Body（碰撞几何/质量分布，无主动攻击）、Movement（V1 只 Wheel，真实 Ground Contact 驱动）、Weapon（直接 HP 伤害）、Gadget（改碰撞/距离/姿态，不带大额 Direct Damage）。
- **Slot/Energy/Mass 分工**：Slot 限空间、Energy 限装配预算（超载直接拒绝穿戴）、Mass 制造 Runtime 物理后果（禁 MaxWeight 硬门槛）。
- **Auto Battle**：玩家不操作，AI 不替玩家聪明赢。V1 持续朝唯一敌人驱动，不后退/拉距/自动瞄准。攻击方向来自 Body 姿态 + Hardpoint 世界方向。允许挥空/射空/互扰。
- **Damage/Force 独立**：Damage 不自动映射 Knockback。Physics Contact 统一进 Contact Router，Damage 统一进 Damage Resolver，Renderer 不参与判定。
- **Arena**：V1 平地 + 左右普通墙。Convergence = Active→Warning→Closing→End，刺墙真实 Collider + Hazard。结果只有 Win/Lose，不建 Draw（同帧双死随机兜底）。
- **Quality**：白绿蓝紫橙红粉彩。跨品质核心 Behavior/物理身份稳定，尺寸/Collider/Mass/COM 基本不变，成长走 HP/Energy/Functional Hardpoint。
- **Physics Lab**：必须直接调正式 Battle Runtime，禁测试场专用物理。第三层体验验收必须 1x + Debug 关闭。

## 三层验收

1. 技术正确（tests/build/Runtime）
2. 方案落地（设计进正式 Runtime）
3. 实际体验成立（正常速度 + Debug 关 + 不听解释，玩家能感知/理解/归因/决策）

只有第三层通过才算设计完成。**开发完成 ≠ 体验通过 ≠ 进入正式主线。**

## 方案漂移红线（出现即主动提醒，不默认实现）

复杂职业 AI / 自动瞄准 / 自动拉距 / 大量隐藏 Buff / Body 免费攻击 / Weapon-Gadget 独立槽 / 高品质全维度碾压 / 复杂机关成胜负主体 / MaxWeight 硬限制 / 动画保证命中 / Gadget 偷偷大额伤害 / 大量例外规则 / 稳定最优 Build 通吃但只加 Content / Debug 成立但玩家感知不到。

## 开发节奏

P0 Bug / 公共 Foundation / 复杂根因 / 多模块迁移 → 单点深入。独立新机制/Content → 允许批量队列。推荐：批量设计 → 多队列顺序开发 → Physics Lab 集中验证 → 一段录像批量验收 → 只返修失败项。

## Canonical Physics Foundation（2026-08-17，feature/foundation-02-canonical）

统一后的物理基线，后续所有 Queue 必须基于此（勿再用旧 gravity 0.01）：

- **gravity.scale = 0.0001**（唯一值）。根因：Matter Verlet 积分 `velocity += (force/mass)*deltaTime²`，FIXED_DT²≈277.8 放大 gravity.scale；0.01 会让 body.velocity.y 单调累积到 ~278（碰撞求解器只改 positionPrev 不回写 velocity）。
- **固定步进**：Drive/Behavior 必须在每个 FIXED_DT 的 Engine.update 之前执行（PhysWorld.step 的 onBeforeStep 回调）；战斗时间按 steps*FIXED_DT 推进，不按渲染帧累计。
- **setMeta 已传播到 compound sub-part**：Matter 碰撞事件 pair.bodyA/bodyB 是 sub-part（parts[0]=parent 被 Detector 跳过），不传 meta 则 Contact Router 读不到 Owner。
- **【F-02A 已解决】接触相对速度**：dispatch 改用 `collision.parentA/parentB`（父刚体 COM）+ 接触点公式 `vPoint = vCOM + ω×r`（r = supports[0] − COM），bodyA/bodyB 仍传 sub-part。纯平移 3.6910=COM 投影（旧值恒 0）；旋转 ω=0.373 时报 26.39 vs 仅 COM 0.81（差 32 倍）。
- **Matter 速度读取时机铁律**：collisionStart/collisionActive 事件回调内 velocity 才是真实值（积分后、求解前）；Resolver.solveVelocity 在事件之后回写 velocity（实测 1.845 → 0.00014），事件外读到的不是真实接近速度。beforeSolve 事件参数不含 collision pairs（在 Detector 之前触发）。
- git 身份：本仓库 `xiaoyue <xiaoyue@local>`（新会话需 `git config user.name/email` 重新设置）。push 走 SSH。
- **git ref 写入不可靠（重要）**：此环境 `git commit` 后分支 ref 常不落盘；`git update-ref` / `git branch -f` 也静默失败（exit 0 但不写文件，还会清掉已建 refs/heads 子目录）。**可靠恢复路径（大海已授权，项目惯例）**：`mkdir -p .git/refs/heads/<branch> && printf '%s\n' <full-sha> > .git/refs/heads/<branch>`，commit 后必须立刻 `git log` 验证 ref 落盘，未落盘则用 fsck/cat-file 确认 commit 对象完整后手动写 ref，再 push。

## vitest 运行环境问题（2026-08-18 发现，重要）

- **症状**：`node node_modules/vitest/vitest.mjs run <file> --maxWorkers=1`（默认 forks/threads 池）所有测试文件报 `TypeError: Cannot read properties of undefined (reading 'config')`，0 test 全部失败；与项目代码无关（最小 `import {describe} from 'vitest'` 测试同样复现）。
- **根因定位**：@vitest/runner 的 `runner` 全局为 undefined → describe → createSuiteCollector → initSuite → `validateTags(runner.config, ...)` 抛 reading 'config'。属于 vitest 4.1.10 native/ServerModuleRunner 在此环境（Node 24.18 / Windows）的双实例/初始化类故障。
- **规避（已实测 10/10 通过）**：加 `--pool=vmThreads`（或 `--pool=vmForks`）即恢复正常；单 worker 语义不变（`--maxWorkers=1`）。**后续所有 vitest 命令必须带 `--pool=vmThreads`**，否则会误报"测试失败"。
- vm 池下 planckWorldCore 10/10（含 B12A 新测试）、B11 相关测试均正常；scoped strict tsc（--ignoreConfig）不受影响。

## Git push / 凭据经验（2026-08-19 B16BS 实战）

- **`.gitconfig` 可能含外部命令路径行**：本机发现 `[credential] helper = !"C:/.../git-credential-manager.exe"`（`!` 前缀 = git 外部 helper 语法）。要切回 `manager` 时**必须覆盖该行**（不是追加），否则 git 取最后一行，但 file 内两行并存显得脏。`git config --global credential.helper manager` 是单键写入，会覆盖。
- **凭据对话框类型**：
  - `CredentialHelperSelect` dialog（带 `<no helper>/manager/wincred`）：**GCM 自身首次启动的后端选择 dialog**，与 git 的 `[credential] helper` 是两层独立设置。本会话 bash 无法程序化点 Select。
    - **Git 侧硬化**（推荐但不是阻止 dialog 的根本）：`git config --global credential.helper manager`（单键覆盖，**必须整行覆盖**，否则 `!` 前缀的显式 exe 路径行与 `manager` 并存，git 取最后一行看似 OK 但 file 内两行并存显得脏）。
    - **真正阻止 dialog 再次弹出的是 GCM 侧**：用户在 dialog 里**勾选 `Always use this from now on` + 点 Select**，GCM 把所选后端持久化到自己的 config，之后同后端不再问。**2026-08-19 实测反例**：即使 git 侧早已 `helper = manager`，该 dialog 仍会再次弹出 → 证明 dialog 与 git config 无关，必须靠用户 GUI 那次勾选根除。原始 MEMORY 该条「`git config ... manager` 即可让 dialog 不再出现」**是不准确记忆**，已据此修正。
    - **沙箱 bash 处理路径**：检测到 dialog 出现 → 不尝试点（OS GUI 程序不可达）→ 用 `git config --global credential.helper manager` 清理 `.gitconfig`（单行覆盖 `!` 行）→ 告知用户后续再出现时直接在 dialog 里勾 `Always use this from now on` 一次性根除。
  - GCM 自身的认证 dialog（要 token）：push 时首次索要 PAT，PAT 一旦喂进 GCM 就入 Windows 凭据库加密缓存，后续 push 自动取。
- **本机凭据缓存盘点（2026-08-19 实测）**：`~/.git-credentials` / `~/.config/git` 均不存在。HTTPS push 唯一非交互路径是 inline token URL（`https://<PAT>@github.com/owner/repo.git`），不写盘、不改 config，push 单次使用。
- **`git push --dry-run` 失败 ≥ 退出码分类**：124 = 命令超时（多因 `credential helper` 挂起在 tty）/ 128 = git fatal / 0 = 通过。判定标准化异常时按 exit 分流。
- **auth 用户授权后不再反复用 AskUserQuestion**：能直接做的（git config、helper 配置、缓存检查）一次做完；唯一不可绕过的是用户必须点 OS GUI 的 Select（一次）和必须贴 PAT（一次）——这两件明确告知，不再用对话框等回。

## 工具层坑（中文路径 + plank/planck 显示伪影，2026-08-19）

- **git status 把 `planck` 显示成 `plank`（无 c）**：本质是中文路径显示伪影，**真实文件名始终是 `planck`（有 c）**。用 git status 显示的"plank"去 `ls`/`grep`/`cat`/Read 会全部失败（No such file）。正确做法：用 `ls <dir>/` 拿真实拼写，或用 `Grep`/`Read` 直接按队列里的"plank"猜的实际路径读。
- **Git Bash 对中文目录的相对/绝对路径不稳**：`cd /d/0818new/最强水果/子目录` 后用相对 `src/battle/...` 偶发"No such file"；绝对 `/d/0818new/最强水果/...` 经 git -C 变量展开偶发失败。但 **git 命令用裸相对路径** `git diff HEAD -- <file>` 因 git 自身按 `.git` 自寻仓库根，几乎都稳。
- **Read 工具对绝对中文路径偶发解析失败**：表现为"Not found"；Bash 用相对 `cat`/`ls` 立即兜底成功；已知稳定路径优先用 Bash + cat 读。
